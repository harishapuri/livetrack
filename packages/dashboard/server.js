#!/usr/bin/env node
/**
 * Supervisor dashboard + queue studio + SOP converter
 *
 *   npm run dashboard
 *   → http://127.0.0.1:4175/              executions
 *   → http://127.0.0.1:4175/queue-studio/ create/clone queue cards
 *   → http://127.0.0.1:4175/assignments/  assign users to LOB / queue cards
 *   → http://127.0.0.1:4175/converter/    PPT/PDF → SOP JSON
 *
 *   node dashboard/server.js --from=2026-07-01 --to=2026-07-18
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { URL } = require("url");
const { generateDashboardData } = require("../liveact/dashboard-stats");
const {
  DEFAULT_LOB,
  defaultDocumentsRoot,
  loadQueueFromDocuments,
  writeCardFiles,
  lobCardDir,
  loadCardFromDir,
  isCardDir,
  loadLobConfig,
  saveLobConfig,
  normalizeAssignees,
} = require("../liveact/documents");

const PORT = 4175;
const REPO_ROOT = path.join(__dirname, "..", "..");
const dashRoot = path.join(__dirname);
const converterRoot = path.join(__dirname, "converter");
const SOPS_DIR = path.join(__dirname, "..", "shared", "sops");
const USER_SOPS_DIR = path.join(require("os").homedir(), "Documents", "Coact", "sops");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function parseArgs(argv) {
  const args = argv.slice(2);
  let dateFrom = null;
  let dateTo = null;
  let dateFilter = null;
  let days = 7;
  for (const a of args) {
    if (a.startsWith("--from=")) dateFrom = a.slice("--from=".length);
    else if (a.startsWith("--to=")) dateTo = a.slice("--to=".length);
    else if (a.startsWith("--date=")) dateFilter = a.slice("--date=".length);
    else if (a.startsWith("--days=")) days = Number(a.slice("--days=".length)) || 7;
  }
  return { dateFrom, dateTo, dateFilter, days };
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeId(id) {
  const cleaned = String(id || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || null;
}

function safeLob(lob) {
  const cleaned = String(lob || DEFAULT_LOB)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || DEFAULT_LOB;
}

function listSops() {
  if (!fs.existsSync(SOPS_DIR)) return [];
  return fs
    .readdirSync(SOPS_DIR)
    .filter((n) => n.endsWith(".json"))
    .map((file) => {
      try {
        const sop = JSON.parse(fs.readFileSync(path.join(SOPS_DIR, file), "utf8"));
        return {
          file,
          id: sop.id || file.replace(/\.json$/, ""),
          name: sop.name || "",
          steps: Array.isArray(sop.steps) ? sop.steps.length : 0,
        };
      } catch {
        return { file, id: file.replace(/\.json$/, ""), name: "", steps: 0 };
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function validateSop(sop) {
  if (!sop || typeof sop !== "object") return "SOP must be a JSON object";
  const id = safeId(sop.id);
  if (!id) return "SOP id is required (letters, numbers, -, _)";
  if (!Array.isArray(sop.steps) || !sop.steps.length) return "SOP must include a non-empty steps array";
  for (const [i, step] of sop.steps.entries()) {
    if (!step || typeof step !== "object") return `steps[${i}] is invalid`;
    if (!step.id) return `steps[${i}] needs an id`;
    if (!step.action) return `steps[${i}] needs an action`;
    if (!step.label) return `steps[${i}] needs a label`;
  }
  return null;
}

function cardSummary(card) {
  return {
    id: card.id,
    title: card.title,
    sopId: card.sopId,
    status: card.status,
    lob: card.lob,
    formUrl: card.formUrl || null,
    formMatch: card.formMatch || [],
    assignees: card.assignees || [],
    sourceDir: card.sourceDir,
    fieldCount: Object.keys(card.data || {}).length,
  };
}

function collectKnownUsers(cards) {
  const set = new Set();
  try {
    set.add(os.userInfo().username);
  } catch {
    /* ignore */
  }
  for (const c of cards || []) {
    for (const u of c.assignees || []) set.add(u);
  }
  // From latest dashboard data.json if present
  try {
    const dataPath = path.join(dashRoot, "data.json");
    if (fs.existsSync(dataPath)) {
      const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
      for (const u of data.byUser || []) {
        if (u?.name) set.add(String(u.name));
      }
      for (const r of data.recent || []) {
        if (r?.user_id) set.add(String(r.user_id));
      }
    }
  } catch {
    /* ignore */
  }
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function listLobNames(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !isCardDir(path.join(rootDir, e.name)))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

function findCard(lob, id) {
  const root = defaultDocumentsRoot();
  const dir = lobCardDir(root, id, lob);
  if (!fs.existsSync(dir) || !isCardDir(dir)) return null;
  return loadCardFromDir(dir, id, lob);
}

function serveFile(filePath, root, res) {
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

function injectConverterNav(html) {
  // Converter ships with dashboard nav; remap for /converter/ mount
  if (html.includes('data-nav="converter"')) {
    html = html.replace(
      /<script src="\.\.\/nav\.js"><\/script>/,
      '<script src="/nav.js"></script>'
    );
    return html;
  }
  const nav = `
<nav class="dash-nav" aria-label="Dashboard">
  <a href="/" data-nav="executions">Executions</a>
  <a href="/queue-studio/" data-nav="studio">Queue studio</a>
  <a href="/assignments/" data-nav="assignments">Assignments</a>
  <a href="/converter/" data-nav="converter" class="active">SOP converter</a>
</nav>
<script src="/nav.js"></script>`;
  if (html.includes("<body>")) return html.replace("<body>", `<body>${nav}`);
  if (html.includes("<body ")) return html.replace(/<body([^>]*)>/, `<body$1>${nav}`);
  return nav + html;
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/sops" && req.method === "GET") {
    send(res, 200, { sops: listSops(), dir: path.relative(REPO_ROOT, SOPS_DIR) });
    return true;
  }

  const sopGet = pathname.match(/^\/api\/sops\/([^/]+)$/);
  if (sopGet && req.method === "GET") {
    const id = safeId(decodeURIComponent(sopGet[1]));
    if (!id) {
      send(res, 400, { error: "Invalid SOP id" });
      return true;
    }
    const filePath = path.join(SOPS_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      send(res, 404, { error: `SOP not found: ${id}` });
      return true;
    }
    try {
      const sop = JSON.parse(fs.readFileSync(filePath, "utf8"));
      send(res, 200, { sop, path: path.join("shared", "sops", `${id}.json`) });
    } catch (e) {
      send(res, 400, { error: e.message || "Invalid SOP file" });
    }
    return true;
  }

  if (pathname === "/api/sops" && req.method === "POST") {
    try {
      const sop = JSON.parse(await readBody(req));
      const err = validateSop(sop);
      if (err) {
        send(res, 400, { error: err });
        return true;
      }
      const id = safeId(sop.id);
      sop.id = id;
      fs.mkdirSync(SOPS_DIR, { recursive: true });
      fs.mkdirSync(USER_SOPS_DIR, { recursive: true });
      const fileName = `${id}.json`;
      const filePath = path.join(SOPS_DIR, fileName);
      const payload = `${JSON.stringify(sop, null, 2)}\n`;
      fs.writeFileSync(filePath, payload, "utf8");
      // liveAct also reads ~/Documents/Coact/sops
      fs.writeFileSync(path.join(USER_SOPS_DIR, fileName), payload, "utf8");
      send(res, 200, {
        ok: true,
        id,
        path: path.join("shared", "sops", fileName),
        userPath: path.join("Documents", "Coact", "sops", fileName),
        absolutePath: filePath,
      });
    } catch (e) {
      send(res, 400, { error: e.message || "Invalid JSON" });
    }
    return true;
  }

  if (pathname === "/api/queue-cards" && req.method === "GET") {
    const { rootDir, cards, lobs } = loadQueueFromDocuments();
    send(res, 200, {
      rootDir,
      cards: cards.map((c) => ({ ...cardSummary(c), data: c.data })),
      lobs: lobs || [],
      knownUsers: collectKnownUsers(cards),
    });
    return true;
  }

  if (pathname === "/api/assignments" && req.method === "GET") {
    const { rootDir, cards, lobs } = loadQueueFromDocuments();
    const lobMap = {};
    for (const lob of listLobNames(rootDir)) {
      const cfg = loadLobConfig(path.join(rootDir, lob));
      lobMap[lob] = cfg.assignees;
    }
    // Include any from loadQueueFromDocuments.lobs
    for (const l of lobs || []) {
      if (!lobMap[l.name]) lobMap[l.name] = l.assignees || [];
    }
    const cardMap = {};
    for (const c of cards) {
      cardMap[`${c.lob}/${c.id}`] = c.assignees || [];
    }
    send(res, 200, {
      rootDir,
      lobs: lobMap,
      cards: cardMap,
      cardList: cards.map(cardSummary),
      knownUsers: collectKnownUsers(cards),
    });
    return true;
  }

  const lobAssign = pathname.match(/^\/api\/assignments\/lob\/([^/]+)$/);
  if (lobAssign && req.method === "PUT") {
    try {
      const lob = safeLob(decodeURIComponent(lobAssign[1]));
      const body = JSON.parse(await readBody(req));
      const root = defaultDocumentsRoot();
      const lobDir = path.join(root, lob);
      fs.mkdirSync(lobDir, { recursive: true });
      const cfg = saveLobConfig(lobDir, { assignees: body.assignees || [] });
      send(res, 200, { ok: true, lob, assignees: cfg.assignees });
    } catch (e) {
      send(res, 400, { error: e.message || "Invalid request" });
    }
    return true;
  }

  const cardAssign = pathname.match(/^\/api\/assignments\/card\/([^/]+)\/([^/]+)$/);
  if (cardAssign && req.method === "PUT") {
    try {
      const lob = safeLob(decodeURIComponent(cardAssign[1]));
      const id = safeId(decodeURIComponent(cardAssign[2]));
      if (!id) {
        send(res, 400, { error: "Invalid card id" });
        return true;
      }
      const body = JSON.parse(await readBody(req));
      const card = findCard(lob, id);
      if (!card) {
        send(res, 404, { error: "Card not found" });
        return true;
      }
      const assignees = normalizeAssignees(body.assignees || []);
      const metaPath = path.join(card.sourceDir, "meta.json");
      const meta = fs.existsSync(metaPath)
        ? JSON.parse(fs.readFileSync(metaPath, "utf8"))
        : { id, title: card.title, sopId: card.sopId, status: card.status, lob };
      meta.assignees = assignees;
      meta.id = meta.id || id;
      meta.lob = meta.lob || lob;
      fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
      send(res, 200, { ok: true, lob, id, assignees });
    } catch (e) {
      send(res, 400, { error: e.message || "Invalid request" });
    }
    return true;
  }

  const cardGet = pathname.match(/^\/api\/queue-cards\/([^/]+)\/([^/]+)$/);
  if (cardGet && req.method === "GET") {
    const lob = safeLob(decodeURIComponent(cardGet[1]));
    const id = safeId(decodeURIComponent(cardGet[2]));
    if (!id) {
      send(res, 400, { error: "Invalid card id" });
      return true;
    }
    const card = findCard(lob, id);
    if (!card) {
      send(res, 404, { error: "Card not found" });
      return true;
    }
    send(res, 200, { card });
    return true;
  }

  if (pathname === "/api/queue-cards" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const lob = safeLob(body.lob);
      const id = safeId(body.id);
      if (!id) {
        send(res, 400, { error: "Card id is required (letters, numbers, -, _)" });
        return true;
      }

      let baseMeta = {};
      let baseData = {};
      if (body.cloneFrom?.lob && body.cloneFrom?.id) {
        const src = findCard(safeLob(body.cloneFrom.lob), safeId(body.cloneFrom.id));
        if (!src) {
          send(res, 400, { error: "cloneFrom card not found" });
          return true;
        }
        baseMeta = {
          sopId: src.sopId,
          formUrl: src.formUrl,
          formMatch: src.formMatch,
          pdfPath: src.pdfPath,
        };
        baseData = { ...(src.data || {}) };
      }

      const data =
        body.data && typeof body.data === "object" && !Array.isArray(body.data)
          ? body.data
          : baseData;
      const sopId = safeId(body.sopId || baseMeta.sopId || "vendor-onboarding") || "vendor-onboarding";
      const title = String(body.title || id).trim() || id;
      const status = String(body.status || "queued").trim() || "queued";
      const formUrl =
        body.formUrl != null && String(body.formUrl).trim()
          ? String(body.formUrl).trim()
          : baseMeta.formUrl || null;

      const root = defaultDocumentsRoot();
      const dir = lobCardDir(root, id, lob);
      if (fs.existsSync(dir) && isCardDir(dir) && !body.overwrite) {
        send(res, 409, { error: `Card already exists: ${lob}/${id}` });
        return true;
      }

      const meta = {
        id,
        title,
        sopId,
        status,
        lob,
      };
      if (formUrl) meta.formUrl = formUrl;
      if (Array.isArray(body.formMatch) && body.formMatch.length) {
        meta.formMatch = body.formMatch;
      } else if (Array.isArray(baseMeta.formMatch) && baseMeta.formMatch.length) {
        meta.formMatch = baseMeta.formMatch;
      }
      if (baseMeta.pdfPath && body.pdfPath !== null) meta.pdfPath = baseMeta.pdfPath;
      if (body.pdfPath) meta.pdfPath = body.pdfPath;
      if (body.assignees != null) {
        meta.assignees = normalizeAssignees(body.assignees);
      }

      writeCardFiles(dir, {
        data,
        meta,
        readme:
          body.cloneFrom
            ? `Cloned from ${body.cloneFrom.lob}/${body.cloneFrom.id} via Queue studio.\n`
            : `Created via Queue studio.\n`,
      });

      send(res, 200, {
        ok: true,
        lob,
        id,
        path: dir,
        meta,
      });
    } catch (e) {
      send(res, 400, { error: e.message || "Invalid request" });
    }
    return true;
  }

  return false;
}

async function handler(req, res) {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Private-Network": "true",
    });
    res.end();
    return;
  }

  if (await handleApi(req, res, pathname)) return;

  if (req.method !== "GET") {
    send(res, 405, { error: "Method not allowed" });
    return;
  }

  // SOP JSON converter under /converter/
  if (pathname === "/converter" || pathname.startsWith("/converter/")) {
    let rel = pathname === "/converter" || pathname === "/converter/" ? "/index.html" : pathname.slice("/converter".length);
    if (rel.includes("..")) {
      res.writeHead(400);
      res.end("bad path");
      return;
    }
    const file = path.join(converterRoot, rel);
    if (path.extname(file).toLowerCase() === ".html" && fs.existsSync(file)) {
      let html = fs.readFileSync(file, "utf8");
      html = injectConverterNav(html);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
      return;
    }
    serveFile(file, converterRoot, res);
    return;
  }

  // Queue studio + main dashboard static files
  let rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  if (rel.includes("..")) {
    res.writeHead(400);
    res.end("bad path");
    return;
  }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(dashRoot, rel);
  serveFile(file, dashRoot, res);
}

async function main() {
  const args = parseArgs(process.argv);
  await generateDashboardData({
    quiet: false,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    dateFilter: args.dateFilter,
    defaultLastDays: args.dateFrom || args.dateTo || args.dateFilter ? undefined : args.days,
  });

  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error("[dashboard]", err);
      send(res, 500, { error: "Internal error" });
    });
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Dashboard:     http://127.0.0.1:${PORT}/`);
    console.log(`Queue studio:  http://127.0.0.1:${PORT}/queue-studio/`);
    console.log(`Assignments:   http://127.0.0.1:${PORT}/assignments/`);
    console.log(`SOP converter: http://127.0.0.1:${PORT}/converter/`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
