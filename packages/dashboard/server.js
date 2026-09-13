#!/usr/bin/env node
/**
 * Supervisor dashboard (single UI)
 *
 *   npm run dashboard
 *   → http://127.0.0.1:4175/              all sections (hash routes)
 *   → /#/executions /#/analytics /#/digest /#/studio /#/assignments /#/reviews /#/converter
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
  defaultUserSopsDir,
  loadQueueFromDocuments,
  writeCardFiles,
  lobCardDir,
  loadCardFromDir,
  isCardDir,
  loadLobConfig,
  saveLobConfig,
  normalizeAssignees,
} = require("../liveact/documents");
const { BRIDGE_PORT } = require("../shared/protocol");
const learningPipeline = require("../liveact/learning-pipeline");
const processIntelligence = require("../liveact/process-intelligence");
const {
  readAllFeedback,
  summarizeFeedback,
  recordFeedback,
} = require("../liveact/feedback-log");
const { loadCaptureLiveSummary } = require("../liveact/capture-forward");
const inbox = require("../liveact/inbox");
const sopsStore = require("../liveact/sops-store");
const workbookStore = require("../liveact/workbook");
const { buildAnalytics } = require("../liveact/analytics");

const PORT = 4175;
let lastDashboardPayload = null;
// Same machine by default; override only for rare remote publish (never hardcode a personal LAN IP).
const LIVEACT_BRIDGE_HOST = String(process.env.LIVEACT_BRIDGE_HOST || "127.0.0.1").trim() || "127.0.0.1";
const LIVEACT_BRIDGE = `http://${LIVEACT_BRIDGE_HOST}:${BRIDGE_PORT}`;
const REPO_ROOT = path.join(__dirname, "..", "..");
const dashRoot = path.join(__dirname);
const converterRoot = path.join(__dirname, "converter");
const SOPS_DIR = path.join(__dirname, "..", "shared", "sops");
const USER_SOPS_DIR = defaultUserSopsDir();
const DIGESTS_DIR = path.join(REPO_ROOT, "digests");

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
  let days = null;
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
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
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
    // discovered-<host-path-40>-<ts> IDs can exceed 80; keep them intact
    .slice(0, 120);
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

function findSopFile(id) {
  const user = path.join(USER_SOPS_DIR, `${id}.json`);
  const shared = path.join(SOPS_DIR, `${id}.json`);
  if (fs.existsSync(user)) return user;
  if (fs.existsSync(shared)) return shared;
  return null;
}

function loadSopJson(filePath) {
  const sop = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (sop && typeof sop === "object") {
    sop.id = sop.id || path.basename(filePath, ".json");
  }
  return sop;
}

function listSopsFromDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((file) => {
      const filePath = path.join(dir, file);
      try {
        const sop = loadSopJson(filePath);
        return { file, filePath, sop };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function allSopsById() {
  const map = new Map();
  const xlsx = workbookStore.workbookPath();
  for (const sop of await sopsStore.loadAllSopObjects()) {
    map.set(sop.id, { sop, filePath: xlsx, file: `${sop.id}.json` });
  }
  return map;
}

async function resolveSopRecord(id, { regenerate = true } = {}) {
  const cleaned = safeId(id);
  if (!cleaned) return null;
  const map = await allSopsById();
  if (map.has(cleaned)) return map.get(cleaned);
  // Exact id match without safeId truncation quirks
  for (const [key, rec] of map) {
    if (key === id || safeId(key) === cleaned) return rec;
  }
  if (!regenerate) return null;
  try {
    const discovery = require("../liveact/process-discovery");
    const out = await discovery.loadSopOrRegenerateFromCapture(cleaned);
    if (out?.ok && out.sop) {
      const xlsx = workbookStore.workbookPath();
      return { sop: out.sop, filePath: xlsx, file: `${out.sop.id}.json`, regenerated: true };
    }
  } catch (err) {
    console.warn("[dashboard] regenerate SOP", err?.message || err);
  }
  return null;
}

async function listSops() {
  const list = await sopsStore.loadAllSopObjects();
  return list
    .map((sop) => ({
      file: `${sop.id}.json`,
      id: sop.id,
      name: sop.name || "",
      steps: Array.isArray(sop.steps) ? sop.steps.length : 0,
    }))
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
  // From latest in-memory dashboard payload
  try {
    for (const u of lastDashboardPayload?.byUser || []) {
      if (u?.name) set.add(String(u.name));
    }
    for (const r of lastDashboardPayload?.recent || []) {
      if (r?.user_id) set.add(String(r.user_id));
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
  <a href="/assignments/" data-nav="assignments">Assignments</a>
  <a href="/converter/" data-nav="converter" class="active">SOP converter</a>
</nav>
<script src="/nav.js"></script>`;
  if (html.includes("<body>")) return html.replace("<body>", `<body>${nav}`);
  if (html.includes("<body ")) return html.replace(/<body([^>]*)>/, `<body$1>${nav}`);
  return nav + html;
}

async function writeSopFile(sop) {
  const id = safeId(sop.id);
  if (!id) throw new Error("SOP id is required");
  sop.id = id;
  const saved = await require("../liveact/sops-store").upsertSop(sop);
  return {
    ok: true,
    id,
    path: saved.path,
    absolutePath: saved.path,
  };
}

function removeDirRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function buildCardMeta(body, existing = {}) {
  const id = safeId(body.id || existing.id);
  const lob = safeLob(body.lob || existing.lob);
  const title = String(body.title != null ? body.title : existing.title || id).trim() || id;
  const status = String(body.status != null ? body.status : existing.status || "queued").trim() || "queued";
  const sopId =
    safeId(body.sopId != null ? body.sopId : existing.sopId || "vendor-onboarding") ||
    "vendor-onboarding";
  const meta = { id, title, sopId, status, lob };

  const formUrlRaw = body.formUrl !== undefined ? body.formUrl : existing.formUrl;
  if (formUrlRaw != null && String(formUrlRaw).trim()) {
    meta.formUrl = String(formUrlRaw).trim();
  }

  if (body.formMatch !== undefined) {
    if (Array.isArray(body.formMatch) && body.formMatch.length) {
      meta.formMatch = body.formMatch.map(String);
    }
  } else if (Array.isArray(existing.formMatch) && existing.formMatch.length) {
    meta.formMatch = existing.formMatch;
  }

  const pdfPath = body.pdfPath !== undefined ? body.pdfPath : existing.pdfPath;
  if (pdfPath != null && String(pdfPath).trim()) {
    meta.pdfPath = String(pdfPath).trim();
  }

  if (body.assignees !== undefined) {
    meta.assignees = normalizeAssignees(body.assignees);
  } else if (existing.assignees?.length) {
    meta.assignees = normalizeAssignees(existing.assignees);
  }

  return meta;
}

function publishToLiveAct() {
  return new Promise((resolve) => {
    const url = new URL("/publish", LIVEACT_BRIDGE);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        timeout: 4000,
        headers: { "Content-Type": "application/json", "Content-Length": 2 },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let body = {};
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          } catch {
            body = {};
          }
          if (res.statusCode >= 200 && res.statusCode < 300 && body.ok !== false) {
            resolve({
              ok: true,
              liveAct: true,
              cardCount: body.cardCount ?? null,
              allCardCount: body.allCardCount ?? null,
              cardIds: body.cardIds || [],
              ...body,
            });
          } else {
            resolve({
              ok: false,
              liveAct: false,
              error: body.error || `liveAct HTTP ${res.statusCode}`,
            });
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        liveAct: false,
        error: "liveAct did not respond — is the app running?",
      });
    });
    req.on("error", (err) => {
      resolve({
        ok: false,
        liveAct: false,
        error:
          err?.code === "ECONNREFUSED"
            ? "liveAct is not running (start the desktop app, then publish again)"
            : err?.message || "Cannot reach liveAct",
      });
    });
    req.write("{}");
    req.end();
  });
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/publish-liveact" && (req.method === "POST" || req.method === "GET")) {
    const result = await publishToLiveAct();
    send(res, result.ok ? 200 : 503, result);
    return true;
  }

  if (pathname === "/api/sops/pending" && req.method === "GET") {
    const pending = [...(await allSopsById()).values()]
      .map((rec) => rec.sop)
      .filter((sop) => sop.status === "draft")
      .map((sop) => ({
        id: sop.id,
        name: sop.name || sop.id,
        formUrl: sop.formUrl || "",
        steps: sop.steps || [],
        sampleData: sop.sampleData && typeof sop.sampleData === "object" ? sop.sampleData : {},
        source: sop.source || "",
        description: sop.description || "",
        recordingSessionId: sop.recordingSessionId || "",
        discoveredAt: sop.discoveredAt || "",
        status: sop.status,
      }));
    send(res, 200, { pending });
    return true;
  }

  const sopAction = pathname.match(/^\/api\/sops\/([^/]+)\/(approve|reject)$/);
  if (sopAction && req.method === "POST") {
    try {
      const id = safeId(decodeURIComponent(sopAction[1]));
      const action = sopAction[2];
      const body = JSON.parse((await readBody(req)) || "{}");
      const rec = await resolveSopRecord(id);
      if (!rec) {
        send(res, 404, { ok: false, error: `SOP not found: ${id}` });
        return true;
      }
      const sop = rec.sop;
      if (action === "approve") {
        sop.status = "published";
        sop.approvedAt = new Date().toISOString();
        sop.approvedBy = body.user || null;
        delete sop.rejectedReason;
      } else {
        sop.status = "rejected";
        sop.rejectedAt = new Date().toISOString();
        sop.rejectedReason = body.reason || "";
      }
      await writeSopFile(sop);
      let card = null;
      if (action === "approve") {
        try {
          const promoted = await require("../liveact/process-discovery").promoteSopToQueueCard(
            sop,
            { user: body.user, data: sop.sampleData, title: sop.name }
          );
          card = promoted.card || null;
        } catch (err) {
          send(res, 200, {
            ok: true,
            sop,
            cardError: err.message || "SOP published, but queue card was not created",
          });
          return true;
        }
      }
      await recordFeedback({
        source: "discovery",
        action: action === "approve" ? "approve" : "reject",
        sopId: id,
        user: body.user,
        reason: body.reason,
      });
      publishToLiveAct().catch(() => {});
      send(res, 200, { ok: true, sop, card });
    } catch (e) {
      send(res, 400, { ok: false, error: e.message || "Invalid request" });
    }
    return true;
  }

  if (pathname === "/api/datasets" && req.method === "GET") {
    send(res, 200, { datasets: await learningPipeline.listDatasets() });
    return true;
  }

  if (pathname === "/api/datasets/build" && req.method === "POST") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = await learningPipeline.buildDataset({ days: Number(body.days) || 30 });
      send(res, 200, result);
    } catch (e) {
      send(res, 400, { ok: false, error: e.message || "Build failed" });
    }
    return true;
  }

  const datasetAction = pathname.match(/^\/api\/datasets\/([^/]+)\/(approve|reject)$/);
  if (datasetAction && req.method === "POST") {
    try {
      const version = Number(datasetAction[1]);
      const body = JSON.parse((await readBody(req)) || "{}");
      const result =
        datasetAction[2] === "approve"
          ? await learningPipeline.approveDataset(version, body.user || "")
          : await learningPipeline.rejectDataset(version, body.reason || "");
      if (result.ok) {
        await recordFeedback({
          source: "dataset",
          action: datasetAction[2] === "approve" ? "approve" : "reject",
          user: body.user,
          reason: body.reason,
          meta: { version },
        });
      }
      send(res, result.ok ? 200 : 404, result);
    } catch (e) {
      send(res, 400, { ok: false, error: e.message || "Invalid request" });
    }
    return true;
  }

  if (pathname === "/api/process-intelligence" && req.method === "GET") {
    send(res, 200, { report: await processIntelligence.loadLatestReport() });
    return true;
  }

  if (pathname === "/api/process-intelligence/run" && req.method === "POST") {
    try {
      await readBody(req);
      const report = await processIntelligence.runProcessIntelligence();
      send(res, 200, { ok: true, report });
    } catch (e) {
      send(res, 500, { ok: false, error: e.message || "Run failed" });
    }
    return true;
  }

  if (pathname === "/api/ai-metrics" && req.method === "GET") {
    send(res, 200, { summary: summarizeFeedback(await readAllFeedback()) });
    return true;
  }

  if (pathname === "/api/analytics" && req.method === "GET") {
    try {
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      const grain = url.searchParams.get("grain") || "month";
      const payload = await buildAnalytics({
        grain,
        from: url.searchParams.get("from") || "",
        to: url.searchParams.get("to") || "",
        user: url.searchParams.get("user") || "",
        lob: url.searchParams.get("lob") || "",
        card: url.searchParams.get("card") || "",
      });
      send(res, 200, payload);
    } catch (e) {
      send(res, 500, { error: e.message || "Analytics failed" });
    }
    return true;
  }

  if (pathname === "/api/inbox" && req.method === "GET") {
    try {
      send(res, 200, { notes: await inbox.listNotes() });
    } catch (e) {
      send(res, 500, { ok: false, error: e.message || "Inbox failed", notes: [] });
    }
    return true;
  }

  const inboxAction = pathname.match(/^\/api\/inbox\/([^/]+)$/);
  if (inboxAction && req.method === "POST") {
    try {
      const id = decodeURIComponent(inboxAction[1]);
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = await inbox.updateNote(id, {
        status: body.status,
        smeNote: body.smeNote,
        sme: body.sme,
      });
      send(res, result.ok ? 200 : 404, result);
    } catch (e) {
      send(res, 400, { ok: false, error: e.message || "Invalid request" });
    }
    return true;
  }

  if (pathname === "/api/capture/live" && req.method === "GET") {
    try {
      send(res, 200, await loadCaptureLiveSummary());
    } catch (e) {
      send(res, 200, {
        ok: false,
        recording: false,
        users: [],
        error: e.message || "Capture summary failed",
      });
    }
    return true;
  }

  if (pathname === "/api/digests" && req.method === "GET") {
    const indexPath = path.join(DIGESTS_DIR, "index.json");
    if (fs.existsSync(indexPath)) {
      try {
        const digests = JSON.parse(fs.readFileSync(indexPath, "utf8"));
        send(res, 200, { digests: Array.isArray(digests) ? digests : [] });
        return true;
      } catch {
        /* fall through to directory listing */
      }
    }
    const digests = fs.existsSync(DIGESTS_DIR)
      ? fs
          .readdirSync(DIGESTS_DIR)
          .filter((n) => n.endsWith(".json") && n !== "index.json")
          .map((file) => ({ digestId: file.replace(/\.json$/, ""), path: file }))
      : [];
    send(res, 200, { digests });
    return true;
  }

  const digestGet = pathname.match(/^\/api\/digests\/([^/]+)$/);
  if (digestGet && req.method === "GET") {
    const id = String(digestGet[1] || "").replace(/[^a-zA-Z0-9._-]/g, "");
    const filePath = path.join(DIGESTS_DIR, `${id}.json`);
    if (!id || !filePath.startsWith(DIGESTS_DIR) || !fs.existsSync(filePath)) {
      send(res, 404, { error: `Digest not found: ${id}` });
      return true;
    }
    try {
      send(res, 200, { digest: JSON.parse(fs.readFileSync(filePath, "utf8")) });
    } catch (e) {
      send(res, 400, { error: e.message || "Invalid digest file" });
    }
    return true;
  }

  if (pathname === "/api/sops" && req.method === "GET") {
    send(res, 200, { sops: await listSops(), dir: "livetrack.xlsx" });
    return true;
  }

  const sopGet = pathname.match(/^\/api\/sops\/([^/]+)$/);
  if (sopGet && req.method === "GET") {
    const id = safeId(decodeURIComponent(sopGet[1]));
    if (!id) {
      send(res, 400, { error: "Invalid SOP id" });
      return true;
    }
    const rec = await resolveSopRecord(id);
    if (!rec) {
      send(res, 404, { error: `SOP not found: ${id}` });
      return true;
    }
    send(res, 200, { sop: rec.sop, path: "livetrack.xlsx", regenerated: Boolean(rec.regenerated) });
    return true;
  }

  if (sopGet && req.method === "PUT") {
    try {
      const id = safeId(decodeURIComponent(sopGet[1]));
      if (!id) {
        send(res, 400, { error: "Invalid SOP id" });
        return true;
      }
      const rec = await resolveSopRecord(id);
      if (!rec) {
        send(res, 404, { error: `SOP not found: ${id}` });
        return true;
      }
      const sop = JSON.parse(await readBody(req));
      sop.id = id;
      const err = validateSop(sop);
      if (err) {
        send(res, 400, { error: err });
        return true;
      }
      send(res, 200, await writeSopFile(sop));
    } catch (e) {
      send(res, 400, { error: e.message || "Invalid JSON" });
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
      const result = await writeSopFile(sop);
      if (!result.id) {
        send(res, 400, { error: "SOP id is required" });
        return true;
      }
      send(res, 200, result);
    } catch (e) {
      send(res, 400, { error: e.message || "Invalid JSON" });
    }
    return true;
  }

  if (pathname === "/api/queue-cards" && req.method === "GET") {
    const { rootDir, cards, lobs } = await loadQueueFromDocuments();
    send(res, 200, {
      rootDir,
      cards: cards.map((c) => ({ ...cardSummary(c), data: c.data })),
      lobs: lobs || [],
      knownUsers: collectKnownUsers(cards),
    });
    return true;
  }

  if (pathname === "/api/assignments" && req.method === "GET") {
    const { rootDir, cards, lobs } = await loadQueueFromDocuments();
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
      const cfg = await saveLobConfig(lobDir, { assignees: body.assignees || [] });
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
      const dir = card.sourceDir || lobCardDir(defaultDocumentsRoot(), id, lob);
      await writeCardFiles(dir, {
        data: card.data || {},
        meta: {
          id,
          title: card.title,
          sopId: card.sopId,
          status: card.status,
          lob,
          formUrl: card.formUrl,
          pdfPath: card.pdfPath,
          formMatch: card.formMatch,
          assignees,
        },
      });
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

  if (cardGet && req.method === "PUT") {
    try {
      const lob = safeLob(decodeURIComponent(cardGet[1]));
      const id = safeId(decodeURIComponent(cardGet[2]));
      if (!id) {
        send(res, 400, { error: "Invalid card id" });
        return true;
      }
      const existing = findCard(lob, id);
      if (!existing) {
        send(res, 404, { error: "Card not found" });
        return true;
      }

      const body = JSON.parse(await readBody(req));
      const nextLob = safeLob(body.lob != null ? body.lob : lob);
      const nextId = safeId(body.id != null ? body.id : id);
      if (!nextId) {
        send(res, 400, { error: "Card id is required" });
        return true;
      }

      const root = defaultDocumentsRoot();
      const fromDir = lobCardDir(root, id, lob);
      const toDir = lobCardDir(root, nextId, nextLob);
      const moving = path.resolve(fromDir) !== path.resolve(toDir);

      if (moving && fs.existsSync(toDir) && isCardDir(toDir) && !body.overwrite) {
        send(res, 409, { error: `Target card already exists: ${nextLob}/${nextId}` });
        return true;
      }

      const data =
        body.data && typeof body.data === "object" && !Array.isArray(body.data)
          ? body.data
          : existing.data || {};

      const meta = buildCardMeta(
        {
          ...body,
          id: nextId,
          lob: nextLob,
        },
        existing
      );

      if (moving) {
        fs.mkdirSync(path.dirname(toDir), { recursive: true });
        if (fs.existsSync(toDir)) removeDirRecursive(toDir);
        fs.renameSync(fromDir, toDir);
      }

      writeCardFiles(toDir, {
        data,
        meta,
        readme: body.readme != null ? String(body.readme) : undefined,
      });

      send(res, 200, {
        ok: true,
        lob: nextLob,
        id: nextId,
        moved: moving,
        path: toDir,
        meta,
      });
    } catch (e) {
      send(res, 400, { error: e.message || "Invalid request" });
    }
    return true;
  }

  if (cardGet && req.method === "DELETE") {
    const lob = safeLob(decodeURIComponent(cardGet[1]));
    const id = safeId(decodeURIComponent(cardGet[2]));
    if (!id) {
      send(res, 400, { error: "Invalid card id" });
      return true;
    }
    const existing = findCard(lob, id);
    if (!existing) {
      send(res, 404, { error: "Card not found" });
      return true;
    }
    const dir = lobCardDir(defaultDocumentsRoot(), id, lob);
    removeDirRecursive(dir);
    send(res, 200, { ok: true, lob, id, deleted: true });
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
          assignees: src.assignees,
        };
        baseData = { ...(src.data || {}) };
      }

      const data =
        body.data && typeof body.data === "object" && !Array.isArray(body.data)
          ? body.data
          : baseData;

      const root = defaultDocumentsRoot();
      const dir = lobCardDir(root, id, lob);
      if (fs.existsSync(dir) && isCardDir(dir) && !body.overwrite) {
        send(res, 409, { error: `Card already exists: ${lob}/${id}` });
        return true;
      }

      const meta = buildCardMeta(body, { ...baseMeta, id, lob });

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
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Private-Network": "true",
    });
    res.end();
    return;
  }

  if (await handleApi(req, res, pathname)) return;

  if (req.method === "GET" && (pathname === "/data.json" || pathname === "/data.js")) {
    if (!lastDashboardPayload) {
      lastDashboardPayload = await generateDashboardData({ quiet: true, writeFiles: false });
    }
    if (pathname === "/data.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(`window.DASHBOARD_DATA = ${JSON.stringify(lastDashboardPayload)};\n`);
      return;
    }
    send(res, 200, lastDashboardPayload);
    return;
  }

  if (req.method !== "GET") {
    send(res, 405, { error: "Method not allowed" });
    return;
  }

  const pageRedirects = {
    "/queue-studio": "/#/studio",
    "/queue-studio/": "/#/studio",
    "/queue-studio/index.html": "/#/studio",
    "/assignments": "/#/assignments",
    "/assignments/": "/#/assignments",
    "/assignments/index.html": "/#/assignments",
    "/converter": "/#/converter",
    "/converter/": "/#/converter",
    "/converter/index.html": "/#/converter",
    "/digest": "/#/digest",
    "/digest/": "/#/digest",
    "/digest/index.html": "/#/digest",
    "/approvals": "/#/approvals",
    "/approvals/": "/#/approvals",
    "/approvals/index.html": "/#/approvals",
    "/reviews": "/#/reviews",
    "/reviews/": "/#/reviews",
    "/reviews/index.html": "/#/reviews",
    "/analytics": "/#/analytics",
    "/analytics/": "/#/analytics",
    "/analytics/index.html": "/#/analytics",
  };
  if (pageRedirects[pathname]) {
    res.writeHead(302, { Location: pageRedirects[pathname], "Cache-Control": "no-store" });
    res.end();
    return;
  }

  if (pathname.startsWith("/converter/")) {
    let rel = pathname.slice("/converter".length);
    if (rel.includes("..")) {
      res.writeHead(400);
      res.end("bad path");
      return;
    }
    serveFile(path.join(converterRoot, rel), converterRoot, res);
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
  lastDashboardPayload = await generateDashboardData({
    quiet: false,
    writeFiles: false,
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
    console.log(`LiveTrack dashboard: http://127.0.0.1:${PORT}/`);
    console.log(`  Executions     http://127.0.0.1:${PORT}/#/executions`);
    console.log(`  Analytics      http://127.0.0.1:${PORT}/#/analytics`);
    console.log(`  Weekly digest  http://127.0.0.1:${PORT}/#/digest`);
    console.log(`  Assignments    http://127.0.0.1:${PORT}/#/assignments`);
    console.log(`  Reviews        http://127.0.0.1:${PORT}/#/reviews`);
    console.log(`  SOP converter  http://127.0.0.1:${PORT}/#/converter`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
