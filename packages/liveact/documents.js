const fs = require("fs");
const path = require("path");
const os = require("os");

const DOC_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".tif",
  ".tiff",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".rtf",
]);

const DEFAULT_LOB = "TCOO";

function defaultDocumentsRoot() {
  return path.join(os.homedir(), "Documents", "Coact", "queue");
}

/**
 * Writable project root for executions / sql (keeps artifacts with the coact repo).
 * Dev: monorepo root (packages/liveact → ../..). Packaged: ~/Projects/coact when present.
 */
function defaultProjectRoot() {
  const fromPackage = path.resolve(__dirname, "..", "..");
  const inAsar = fromPackage.includes(`${path.sep}app.asar`) || __dirname.includes(`${path.sep}app.asar`);
  if (!inAsar) {
    if (fs.existsSync(path.join(fromPackage, "packages", "liveact"))) return fromPackage;
    const siblingRoot = path.resolve(__dirname, "..");
    if (fs.existsSync(path.join(siblingRoot, "package.json"))) return siblingRoot;
    return fromPackage;
  }
  const preferred = path.join(os.homedir(), "Projects", "coact");
  if (fs.existsSync(preferred)) return preferred;
  return path.join(os.homedir(), "Documents", "Coact");
}

function defaultExecutionsRoot() {
  return path.join(defaultProjectRoot(), "executions");
}

function defaultSqlRoot() {
  return path.join(defaultProjectRoot(), "sql");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listFilesRecursive(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else {
      out.push({
        name,
        relativePath: path.relative(base, full),
        absolutePath: full,
        ext: path.extname(name).toLowerCase(),
      });
    }
  }
  return out;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function titleFromFolder(folderName, data) {
  if (data?.companyName) return `New vendor — ${data.companyName}`;
  if (data?.title) return data.title;
  return folderName
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isCardDir(dir) {
  return (
    fs.existsSync(path.join(dir, "data.json")) ||
    fs.existsSync(path.join(dir, "meta.json"))
  );
}

function loadCardFromDir(caseDir, folderName, lob) {
  const dataPath = path.join(caseDir, "data.json");
  const metaPath = path.join(caseDir, "meta.json");
  const data = fs.existsSync(dataPath) ? readJsonSafe(dataPath) || {} : {};
  const meta = fs.existsSync(metaPath) ? readJsonSafe(metaPath) || {} : {};

  const allFiles = listFilesRecursive(caseDir);
  const documents = allFiles
    .filter((f) => f.name !== "data.json" && f.name !== "meta.json")
    .filter((f) => DOC_EXTENSIONS.has(f.ext) || f.ext === "")
    .map((f) => ({
      name: f.name,
      path: f.absolutePath,
      relativePath: f.relativePath,
    }));

  return {
    id: meta.id || folderName,
    title: meta.title || titleFromFolder(folderName, data),
    sopId: meta.sopId || "vendor-onboarding",
    status: meta.status || "queued",
    lob: meta.lob || lob,
    sourceDir: caseDir,
    formUrl: meta.formUrl || null,
    pdfPath: meta.pdfPath || null,
    formMatch: Array.isArray(meta.formMatch) ? meta.formMatch : [],
    assignees: normalizeAssignees(meta.assignees),
    data,
    documents,
  };
}

function normalizeAssignees(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((u) => String(u || "").trim())
        .filter(Boolean)
    ),
  ];
}

/** LOB config: queue/<LOB>/.lob.json → { assignees: string[] } */
function lobConfigPath(lobDir) {
  return path.join(lobDir, ".lob.json");
}

function loadLobConfig(lobDir) {
  const raw = readJsonSafe(lobConfigPath(lobDir)) || {};
  return {
    assignees: normalizeAssignees(raw.assignees),
  };
}

function saveLobConfig(lobDir, partial) {
  ensureDir(lobDir);
  const prev = loadLobConfig(lobDir);
  const next = {
    assignees:
      partial.assignees != null ? normalizeAssignees(partial.assignees) : prev.assignees,
  };
  fs.writeFileSync(lobConfigPath(lobDir), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

function userAllowed(userId, assignees) {
  if (!assignees || !assignees.length) return true; // empty = everyone
  if (!userId) return true;
  const u = String(userId).trim().toLowerCase();
  return assignees.some((a) => String(a).trim().toLowerCase() === u);
}

function userExplicitlyAssigned(userId, assignees) {
  if (!userId || !assignees || !assignees.length) return false;
  const u = String(userId).trim().toLowerCase();
  return assignees.some((a) => String(a).trim().toLowerCase() === u);
}

/**
 * Agent queue rules:
 * - If this user is listed on any card → show ONLY those cards (assigned work).
 * - Otherwise → empty assignees = everyone; cards assigned to others are hidden.
 * - LOB assignees still apply first (empty LOB = everyone).
 */
function filterCardsForUser(cards, lobAssigneeMap, userId) {
  if (!userId) return cards;

  const afterLob = cards.filter((c) => {
    const lobAssignees = lobAssigneeMap.get(c.lob) || [];
    return userAllowed(userId, lobAssignees);
  });

  const mine = afterLob.filter((c) => userExplicitlyAssigned(userId, c.assignees));
  if (mine.length > 0) {
    return mine;
  }

  return afterLob.filter((c) => userAllowed(userId, c.assignees));
}

/**
 * Migrate legacy flat cards (queue/<card>/) into queue/TCOO/<card>/.
 */
function migrateFlatCardsToLob(rootDir, lob = DEFAULT_LOB) {
  ensureDir(rootDir);
  const lobDir = path.join(rootDir, lob);
  ensureDir(lobDir);

  for (const name of fs.readdirSync(rootDir)) {
    if (name.startsWith(".")) continue;
    const full = path.join(rootDir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (name === lob) continue;
    // Skip other LOB folders (directories that contain card subdirs, not data.json)
    if (!isCardDir(full)) continue;

    const dest = path.join(lobDir, name);
    if (fs.existsSync(dest)) {
      console.warn(`[coact] skip migrate ${name}: already under ${lob}`);
      continue;
    }
    try {
      fs.renameSync(full, dest);
      console.log(`[coact] migrated queue card ${name} → ${lob}/${name}`);
    } catch (err) {
      console.error(`[coact] migrate failed ${name}`, err.message);
    }
  }
}

/**
 * Nested layout:
 *   ~/Documents/Coact/queue/<LOB>/<case-id>/
 *     data.json
 *     meta.json
 *     *.pdf, *.docx
 *
 * @param {string} [rootDir]
 * @param {{ userId?: string|null, filterByUser?: boolean }} [opts]
 *   When filterByUser + userId:
 *   - If user is on any card assignees list → only those cards appear in liveAct
 *   - Else empty assignees = everyone; hide cards assigned only to other users
 *   - LOB .lob.json assignees still gate the whole LOB when set
 */
function loadQueueFromDocuments(rootDir = defaultDocumentsRoot(), opts = {}) {
  ensureDir(rootDir);
  migrateFlatCardsToLob(rootDir, DEFAULT_LOB);

  const filterByUser = Boolean(opts.filterByUser);
  const userId = opts.userId != null ? String(opts.userId).trim() : "";

  const cards = [];
  const lobs = [];
  const lobAssigneeMap = new Map();
  const lobEntries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const lobEntry of lobEntries) {
    if (!lobEntry.isDirectory() || lobEntry.name.startsWith(".")) continue;
    const lobName = lobEntry.name;
    const lobPath = path.join(rootDir, lobName);

    // Defensive: if somehow still a flat card at root, load under DEFAULT_LOB
    if (isCardDir(lobPath)) {
      cards.push(loadCardFromDir(lobPath, lobName, DEFAULT_LOB));
      continue;
    }

    const lobConfig = loadLobConfig(lobPath);
    lobs.push({ name: lobName, assignees: lobConfig.assignees });
    lobAssigneeMap.set(lobName, lobConfig.assignees);

    for (const cardEntry of fs.readdirSync(lobPath, { withFileTypes: true })) {
      if (!cardEntry.isDirectory() || cardEntry.name.startsWith(".")) continue;
      const caseDir = path.join(lobPath, cardEntry.name);
      if (!isCardDir(caseDir)) continue;
      cards.push(loadCardFromDir(caseDir, cardEntry.name, lobName));
    }
  }

  const visible = filterByUser
    ? filterCardsForUser(cards, lobAssigneeMap, userId)
    : cards;

  visible.sort((a, b) => {
    const lobCmp = (a.lob || "").localeCompare(b.lob || "");
    if (lobCmp !== 0) return lobCmp;
    return a.title.localeCompare(b.title);
  });
  return { rootDir, cards: visible, lobs, allCardCount: cards.length };
}

function writeCardFiles(dir, { data, meta, readme }) {
  ensureDir(dir);
  if (data != null) {
    fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(data, null, 2));
  }
  if (meta != null) {
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  }
  if (readme != null) {
    fs.writeFileSync(path.join(dir, "README.txt"), readme);
  }
}

function lobCardDir(rootDir, cardId, lob = DEFAULT_LOB) {
  return path.join(rootDir, lob, cardId);
}

function seedSampleCases(rootDir = defaultDocumentsRoot()) {
  ensureDir(rootDir);
  migrateFlatCardsToLob(rootDir, DEFAULT_LOB);
  const lobRoot = path.join(rootDir, DEFAULT_LOB);
  ensureDir(lobRoot);

  const existing = fs.readdirSync(lobRoot).filter((n) => !n.startsWith("."));
  if (existing.length === 0) {
    const samples = [
      {
        folder: "acme-supplies",
        data: {
          companyName: "Acme Supplies",
          contactName: "Jordan Lee",
          email: "jordan@acmesupplies.example",
          phone: "555-0142",
          taxId: "12-3456789",
          address: "100 Market Street",
          city: "Austin",
          state: "TX",
          zip: "78701",
        },
        note: "Put W9, COI, and other vendor docs in this folder.",
      },
      {
        folder: "blue-river-parts",
        data: {
          companyName: "Blue River Parts",
          contactName: "Sam Rivera",
          email: "sam@blueriver.example",
          phone: "555-0199",
          taxId: "98-7654321",
          address: "42 Harbor Ave",
          city: "Seattle",
          state: "WA",
          zip: "98101",
        },
        note: "Put supporting PDFs here. Fill values live in data.json.",
      },
    ];

    for (const sample of samples) {
      const dir = lobCardDir(rootDir, sample.folder);
      writeCardFiles(dir, {
        data: sample.data,
        meta: {
          id: sample.folder,
          title: titleFromFolder(sample.folder, sample.data),
          sopId: "vendor-onboarding",
          status: "queued",
          lob: DEFAULT_LOB,
        },
        readme: `${sample.note}\n\nEdit data.json — those fields are what liveAct fills into the form.\n`,
      });
    }
  }

  // Always ensure the multi-site demo queue cards exist (idempotent)
  try {
    const { DEMO_SITES } = require("@coact/shared/demo-catalog");
    for (const site of DEMO_SITES) {
      const dir = lobCardDir(rootDir, site.id);
      if (fs.existsSync(path.join(dir, "data.json"))) continue;
      writeCardFiles(dir, {
        data: site.answers,
        meta: {
          id: site.id,
          title: site.title,
          sopId: `demo-${site.id}`,
          status: "queued",
          lob: DEFAULT_LOB,
          formUrl: `http://127.0.0.1:4173/${site.path.replace(/\.html$/, "")}`,
        },
        readme: `${site.title}\n\nOpen http://127.0.0.1:4173/${site.path.replace(/\.html$/, "")} then Start in liveAct.\n`,
      });
    }

    const clickStreamCases = [
      {
        id: "orbit-onboard",
        data: {
          fullName: "Jordan Blake",
          email: "jordan.blake@orbit.example",
          role: "Operations Analyst",
        },
        meta: {
          id: "orbit-onboard",
          title: "Orbit Onboard — Click-stream wizard",
          sopId: "demo-orbit-onboard",
          status: "queued",
          lob: DEFAULT_LOB,
          formUrl: "http://127.0.0.1:4173/sites/orbit-onboard/",
          formMatch: ["orbit-onboard", "Orbit Onboard"],
        },
        readme:
          "Orbit Onboard multi-page click stream.\n\nOpen http://127.0.0.1:4173/sites/orbit-onboard/ then Start in liveAct.\n",
      },
      {
        id: "gateform-access",
        data: {
          fullName: "Alex Rivera",
          email: "alex.rivera@gateform.example",
          company: "Northwind Labs",
          accessType: "Staging VPN",
          reason: "Quarterly release verification",
        },
        meta: {
          id: "gateform-access",
          title: "Gateform Access — Click gate then form",
          sopId: "demo-gateform-access",
          status: "queued",
          lob: DEFAULT_LOB,
          formUrl: "http://127.0.0.1:4173/sites/gateform-access/",
          formMatch: ["gateform-access", "Gateform Access"],
        },
        readme:
          "Gateform Access single-page click gate.\n\nOpen http://127.0.0.1:4173/sites/gateform-access/ then Start in liveAct.\n",
      },
      {
        id: "planstream-apply",
        data: {
          fullName: "Casey Morgan",
          email: "casey.morgan@planstream.example",
          company: "Cedar Peak Labs",
          teamSize: "12",
          useCase: "Roll out shared onboarding for the ops team",
        },
        meta: {
          id: "planstream-apply",
          title: "PlanStream Apply — 3 clicks per page then form",
          sopId: "demo-planstream-apply",
          status: "queued",
          lob: DEFAULT_LOB,
          formUrl: "http://127.0.0.1:4173/sites/planstream-apply/",
          formMatch: ["planstream-apply", "PlanStream Apply", "sites/planstream-apply"],
        },
        readme:
          "PlanStream Apply: Landing (Accept → Choose plan → Continue) → Eligibility (Confirm → Select workspace → Open application) → form.\n\nOpen http://127.0.0.1:4173/sites/planstream-apply/ then Start in liveAct.\n",
      },
      {
        id: "section-select",
        data: {
          fullName: "Riley Chen",
          email: "riley.chen@segue.example",
          company: "Lakeview Systems",
          teamSize: "8",
          notes: "Ready after Region → Product → Intent → Plan → Confirm",
        },
        meta: {
          id: "section-select",
          title: "Segue Select — 5 section selects then form",
          sopId: "demo-section-select",
          status: "queued",
          lob: DEFAULT_LOB,
          formUrl: "http://127.0.0.1:4173/sites/section-select/",
          formMatch: ["section-select", "Segue Select", "sites/section-select"],
        },
        readme:
          "Segue Select: Region → Product → Intent → Plan → Confirm (same page), then form.\n\nOpen http://127.0.0.1:4173/sites/section-select/ then Start in liveAct.\n",
      },
    ];

    for (const c of clickStreamCases) {
      const dir = lobCardDir(rootDir, c.id);
      if (fs.existsSync(path.join(dir, "data.json"))) continue;
      writeCardFiles(dir, { data: c.data, meta: c.meta, readme: c.readme });
    }
  } catch (err) {
    console.error("[coact] demo site seed failed", err.message);
  }

  return { seeded: true, rootDir };
}

module.exports = {
  DEFAULT_LOB,
  defaultDocumentsRoot,
  defaultProjectRoot,
  defaultExecutionsRoot,
  defaultSqlRoot,
  loadQueueFromDocuments,
  seedSampleCases,
  migrateFlatCardsToLob,
  writeCardFiles,
  lobCardDir,
  loadCardFromDir,
  isCardDir,
  loadLobConfig,
  saveLobConfig,
  normalizeAssignees,
  userAllowed,
  userExplicitlyAssigned,
  filterCardsForUser,
};
