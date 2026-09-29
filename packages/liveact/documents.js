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

/** Legacy runtime home (pre–Projects/coact consolidation). */
function legacyDocumentsCoactRoot() {
  return path.join(os.homedir(), "Documents", "Coact");
}

function liveActSharedRoot() {
  return path.join(os.homedir(), "Projects", "coact");
}

/**
 * Runtime data home for queue, settings, and executions (~/Projects/coact).
 * The mother workbook is ~/Desktop/livetrack/livetrack.xlsx.
 *
 * Packaged LiveTrack and `npm run dashboard` must share one root — otherwise
 * Record drafts land in ~/Projects/coact while the dashboard looks in the
 * repo and operators see "SOP not found". COACT_PROJECT_ROOT overrides (tests).
 */
function isPackagedRuntime() {
  const dir = String(__dirname || "");
  if (dir.includes(`${path.sep}app.asar`)) return true;
  if (dir.includes(`${path.sep}app.asar.unpacked`)) return true;
  if (/\.app[\\/]Contents[\\/]/i.test(dir)) return true;
  try {
    const electron = require("electron");
    if (electron && typeof electron === "object") {
      return Boolean(electron.app && electron.app.isPackaged);
    }
  } catch {
    /* node tests / unpackaged `npm start` */
  }
  return false;
}

function defaultProjectRoot() {
  const envRoot = String(process.env.COACT_PROJECT_ROOT || "").trim();
  if (envRoot) return path.resolve(envRoot);
  // Shared runtime for packaged app + dashboard + unpackaged electron.
  const shared = liveActSharedRoot();
  ensureDir(shared);
  return shared;
}

/** Queue cards: <project>/queue/<LOB>/<case-id>/ */
function defaultDocumentsRoot() {
  return path.join(defaultProjectRoot(), "queue");
}

function defaultExecutionsRoot() {
  return path.join(defaultProjectRoot(), "executions");
}

function defaultSqlRoot() {
  return path.join(defaultProjectRoot(), "sql");
}

function defaultSettingsPath() {
  return path.join(defaultProjectRoot(), "settings.json");
}

function defaultJiraActionsPath() {
  return path.join(defaultProjectRoot(), "jira-actions.jsonl");
}

function defaultExtensionDir() {
  return path.join(defaultProjectRoot(), "extension");
}

/** User/override SOPs beside the repo (optional); bundled SOPs stay in packages/shared/sops. */
function defaultUserSopsDir() {
  return path.join(defaultProjectRoot(), "sops");
}

function copyFileIfMissing(src, dest) {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

function copyDirMissingLeaves(src, dest) {
  if (!fs.existsSync(src)) return 0;
  ensureDir(dest);
  let n = 0;
  for (const name of fs.readdirSync(src)) {
    if (name.startsWith(".")) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) {
      if (!fs.existsSync(to)) {
        fs.cpSync(from, to, { recursive: true });
        n += 1;
      } else {
        n += copyDirMissingLeaves(from, to);
      }
    } else if (!fs.existsSync(to)) {
      fs.copyFileSync(from, to);
      n += 1;
    }
  }
  return n;
}

/**
 * One-time: copy queue / settings / jira log / extension / sops from ~/Documents/Coact
 * into Projects/coact when the project-side path is missing.
 */
function migrateLegacyDocumentsCoact() {
  // Test suite sets COACT_PROJECT_ROOT to a throwaway tmp dir — never copy
  // the real ~/Documents/Coact (queue data, settings, Jira tokens) into it.
  if (process.env.COACT_PROJECT_ROOT) return { migrated: false, reason: "test_isolated_root" };
  const legacy = legacyDocumentsCoactRoot();
  if (!fs.existsSync(legacy)) return { migrated: false, reason: "no_legacy" };
  const root = defaultProjectRoot();
  const report = { migrated: true, root, copied: {} };

  report.copied.queue = 0;
  report.copied.settings = copyFileIfMissing(
    path.join(legacy, "settings.json"),
    defaultSettingsPath()
  );
  report.copied.jiraActions = false;
  report.copied.extension = copyDirMissingLeaves(
    path.join(legacy, "extension"),
    defaultExtensionDir()
  );
  report.copied.sops = 0;

  if (report.copied.queue || report.copied.settings || report.copied.jiraActions) {
    console.log("[coact] migrated Documents/Coact →", root, report.copied);
  }
  return report;
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

function cardPlayDir(caseDir) {
  return path.join(caseDir, "play");
}

function playwrightStepsOf(script) {
  if (!script || typeof script !== "object") return [];
  const nested = script.playwright && Array.isArray(script.playwright.steps)
    ? script.playwright.steps
    : [];
  if (nested.length) return nested;
  return Array.isArray(script.steps) ? script.steps : [];
}

/** Load THIS card's play/*.json only — never sibling folders or SOP/URL matches. */
function loadPlaywrightFromCardDir(caseDir) {
  const playDir = cardPlayDir(caseDir);
  if (!caseDir || !fs.existsSync(playDir)) {
    return { playwright: null, playDir: null };
  }
  let stat;
  try {
    stat = fs.statSync(playDir);
  } catch {
    return { playwright: null, playDir: null };
  }
  if (!stat.isDirectory()) return { playwright: null, playDir: null };

  const preferred = path.join(playDir, "playwright.json");
  let file = fs.existsSync(preferred) ? preferred : "";
  if (!file) {
    const names = fs
      .readdirSync(playDir)
      .filter((n) => n.toLowerCase().endsWith(".json") && !n.startsWith("."))
      .sort((a, b) => a.localeCompare(b));
    if (names.length) file = path.join(playDir, names[0]);
  }
  if (!file) return { playwright: null, playDir };
  const script = readJsonSafe(file);
  if (!script || typeof script !== "object") return { playwright: null, playDir };
  return { playwright: script, playDir };
}

function attachCardPlaywright(card, caseDir) {
  if (!card) return card;
  const dirs = [];
  const primary = caseDir || card.sourceDir;
  if (primary) dirs.push(primary);
  if (card.id) {
    try {
      const fallback = lobCardDir(defaultDocumentsRoot(), card.id, card.lob || DEFAULT_LOB);
      if (fallback && fallback !== primary) dirs.push(fallback);
    } catch {
      /* ignore */
    }
  }
  let loaded = { playwright: null, playDir: null };
  for (const dir of dirs) {
    loaded = loadPlaywrightFromCardDir(dir);
    if (playwrightStepsOf(loaded.playwright).length) break;
  }
  card.playDir = loaded.playDir;
  card.playwright = loaded.playwright;
  return card;
}

function cardHasAttachedPlaywright(card) {
  return playwrightStepsOf(card?.playwright).length > 0;
}

/**
 * Write a Playwright script into one card folder's play/ only.
 * Never fans out by SOP id or form URL onto other cards.
 */
function persistQueuePlaywrightCaseData(cardDir, script, extraData = null) {
  if (!cardDir) return { ok: false, error: "missing_card_dir" };
  const playDir = cardPlayDir(cardDir);
  ensureDir(playDir);
  let toWrite = script;
  if (script != null && typeof script === "object") {
    try {
      const { relocateShotsOntoCard } = require("./capture-step-shot");
      const relocated = relocateShotsOntoCard(
        { playwright: script, steps: script.steps },
        cardDir
      );
      toWrite = relocated.playwright || script;
    } catch {
      toWrite = script;
    }
  }
  if (toWrite != null) {
    fs.writeFileSync(
      path.join(playDir, "playwright.json"),
      `${JSON.stringify(toWrite, null, 2)}\n`,
      "utf8"
    );
  }
  if (extraData && typeof extraData === "object" && !Array.isArray(extraData)) {
    const dataPath = path.join(cardDir, "data.json");
    const prev = fs.existsSync(dataPath) ? readJsonSafe(dataPath) || {} : {};
    const next = { ...prev };
    for (const [k, v] of Object.entries(extraData)) {
      if (QUEUE_DATA_SKIP.has(k) || v == null || typeof v === "object") continue;
      next[k] = v;
    }
    fs.writeFileSync(dataPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }
  return { ok: true, playDir, cardDir };
}

const QUEUE_DATA_SKIP = new Set([
  "clicks",
  "playwright",
  "locator",
  "steps",
  "pages",
  "values",
  "job",
]);

function scalarQueueData(data) {
  const out = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [k, v] of Object.entries(data)) {
    if (QUEUE_DATA_SKIP.has(k) || v == null || v === "") continue;
    if (typeof v === "object") continue;
    out[k] = v;
  }
  return out;
}

function writeCardDiskSidecars(dir, { data, meta }) {
  ensureDir(dir);
  if (meta && typeof meta === "object") {
    fs.writeFileSync(path.join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  }
  if (data != null) {
    fs.writeFileSync(
      path.join(dir, "data.json"),
      `${JSON.stringify(scalarQueueData(data), null, 2)}\n`,
      "utf8"
    );
  }
}

function desktopPlaywrightCapturePath() {
  const names = ["playwright", "playwrite"];
  for (const name of names) {
    const file = path.join(os.homedir(), "Desktop", name, "data", "sop.json");
    if (fs.existsSync(file)) return file;
  }
  return "";
}

function desktopApplicationPath(sopPath) {
  if (!sopPath) return "";
  const file = path.join(path.dirname(sopPath), "application.json");
  return fs.existsSync(file) ? file : "";
}

function flattenApplicationData(app, sop) {
  const info = app?.myInformation && typeof app.myInformation === "object" ? app.myInformation : {};
  const edu = app?.education && typeof app.education === "object" ? app.education : {};
  const vol =
    app?.voluntaryDisclosures && typeof app.voluntaryDisclosures === "object"
      ? app.voluntaryDisclosures
      : {};
  const out = {
    ticket: sop?.ticket || "",
    startUrl: sop?.startUrl || app?.jobUrl || "",
    firstName: info.firstName || "",
    lastName: info.lastName || "",
    addressLine1: info.addressLine1 || "",
    city: info.city || "",
    state: info.state || "",
    postalCode: info.postalCode || "",
    phoneType: info.phoneType || "",
    phoneNumber: info.phoneNumber || "",
    howDidYouHear: info.howDidYouHearSearch || info.howDidYouHear || "",
    school: edu.school || "",
    degree: edu.degree || "",
    fieldOfStudy: edu.fieldOfStudy || "",
    lastYear: edu.lastYear || "",
    gpa: edu.gpa || "",
    gender: vol.gender || "",
    veteran: vol.veteran || "",
  };
  if (Array.isArray(app?.websites) && app.websites[0]) out.url = app.websites[0];
  if (Array.isArray(app?.skills) && app.skills[0]) out.skills = app.skills[0];
  return scalarQueueData(out);
}

function seedFullstackPlaywrightCard(rootDir) {
  const dir = lobCardDir(rootDir, "fullstack");
  if (!fs.existsSync(dir)) return dir;
  const capturePath = desktopPlaywrightCapturePath();
  const sop = capturePath ? readJsonSafe(capturePath) : null;
  const playFile = path.join(cardPlayDir(dir), "playwright.json");
  if (sop && playwrightStepsOf(sop).length && !fs.existsSync(playFile)) {
    persistQueuePlaywrightCaseData(dir, sop);
  }
  return dir;
}

function loadCardFromDir(caseDir, folderName, lob) {
  const dataPath = path.join(caseDir, "data.json");
  const metaPath = path.join(caseDir, "meta.json");
  const data = fs.existsSync(dataPath) ? readJsonSafe(dataPath) || {} : {};
  const meta = fs.existsSync(metaPath) ? readJsonSafe(metaPath) || {} : {};

  const allFiles = listFilesRecursive(caseDir);
  const documents = allFiles
    .filter((f) => f.name !== "data.json" && f.name !== "meta.json")
    .filter((f) => String(f.relativePath || "").split(path.sep)[0] !== "play")
    .filter((f) => DOC_EXTENSIONS.has(f.ext) || f.ext === "")
    .map((f) => ({
      name: f.name,
      path: f.absolutePath,
      relativePath: f.relativePath,
    }));

  const card = {
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
    data: scalarQueueData(data),
    documents,
  };
  return attachCardPlaywright(card, caseDir);
}

/**
 * Update queue card status in livetrack.xlsx (QueueCards).
 */
async function updateQueueCardStatus(cardId, status, queueCards = []) {
  const raw = String(status || "")
    .trim()
    .toLowerCase();
  const next = raw === "done" ? "done" : raw === "incomplete" ? "incomplete" : "queued";
  const id = String(cardId || "").trim();
  if (!id) return { ok: false, error: "missing_card" };

  const workbookStore = require("./workbook");
  const { QueueCards } = await workbookStore.readTables(["QueueCards"]);
  const rows = QueueCards || [];
  const idx = rows.findIndex((r) => String(r.card_id) === id);
  const mem = (queueCards || []).find((c) => c.id === id) || null;
  if (idx < 0 && !mem) return { ok: false, error: "card_not_found", cardId: id };

  const normalize = (value) => {
    const s = String(value || "queued").toLowerCase();
    if (s === "done") return "done";
    if (s === "incomplete") return "incomplete";
    return "queued";
  };
  const prev = normalize(idx >= 0 ? rows[idx].status : mem.status);
  if (prev === next) {
    return { ok: true, changed: false, cardId: id, status: next, sourceDir: mem?.sourceDir };
  }
  if (idx >= 0) {
    rows[idx].status = next;
    rows[idx].updated_at = new Date().toISOString();
    await workbookStore.replaceRows("QueueCards", rows);
  } else {
    await writeCardFiles(mem.sourceDir || lobCardDir(defaultDocumentsRoot(), id, mem.lob), {
      data: mem.data || {},
      meta: {
        id,
        title: mem.title,
        sopId: mem.sopId,
        status: next,
        lob: mem.lob,
        formUrl: mem.formUrl,
        pdfPath: mem.pdfPath,
        formMatch: mem.formMatch,
        assignees: mem.assignees,
      },
    });
  }
  if (mem) mem.status = next;
  return { ok: true, changed: true, cardId: id, status: next, sourceDir: mem?.sourceDir, previous: prev };
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

async function saveLobConfig(lobDir, partial) {
  const lob = path.basename(lobDir);
  ensureDir(lobDir);
  const workbookStore = require("./workbook");
  const { QueueLobs } = await workbookStore.readTables(["QueueLobs"]);
  const rows = QueueLobs || [];
  const prev = rows.find((r) => r.lob === lob);
  const assignees =
    partial.assignees != null
      ? normalizeAssignees(partial.assignees)
      : normalizeAssignees(String(prev?.assignees || "").split(","));
  await workbookStore.replaceRows("QueueLobs", [
    ...rows.filter((r) => r.lob !== lob),
    { lob, assignees: assignees.join(",") },
  ]);
  return { assignees };
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

function normalizeLob(lob) {
  const s = String(lob || "").trim();
  return s || DEFAULT_LOB;
}

function cardKey(lob, cardId) {
  return `${normalizeLob(lob)}/${String(cardId || "").trim()}`;
}

/**
 * Walk queue/<LOB>/<card>/ (and leftover flat card dirs).
 * @returns {{ lob: string, id: string, dir: string, lobConfig?: { assignees: string[] } }[]}
 */
function listLobCardDirs(rootDir) {
  const found = [];
  if (!rootDir || !fs.existsSync(rootDir)) return found;
  for (const lobEntry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!lobEntry.isDirectory() || lobEntry.name.startsWith(".")) continue;
    const lobName = lobEntry.name;
    const lobPath = path.join(rootDir, lobName);
    if (isCardDir(lobPath)) {
      found.push({ lob: DEFAULT_LOB, id: lobName, dir: lobPath });
      continue;
    }
    const lobConfig = loadLobConfig(lobPath);
    for (const cardEntry of fs.readdirSync(lobPath, { withFileTypes: true })) {
      if (!cardEntry.isDirectory() || cardEntry.name.startsWith(".")) continue;
      const caseDir = path.join(lobPath, cardEntry.name);
      if (!isCardDir(caseDir)) continue;
      found.push({
        lob: normalizeLob(lobName),
        id: cardEntry.name,
        dir: caseDir,
        lobConfig,
      });
    }
  }
  return found;
}

function documentsForCardDir(caseDir) {
  if (!caseDir || !fs.existsSync(caseDir)) return [];
  return listFilesRecursive(caseDir)
    .filter((f) => f.name !== "data.json" && f.name !== "meta.json")
    .filter((f) => DOC_EXTENSIONS.has(f.ext) || f.ext === "")
    .map((f) => ({
      name: f.name,
      path: f.absolutePath,
      relativePath: f.relativePath,
    }));
}

function cardFromWorkbookRow(row, rootDir, dataByCard) {
  const lob = normalizeLob(row.lob);
  const id = String(row.card_id || "").trim();
  let caseDir = row.source_dir || "";
  if (!caseDir || !fs.existsSync(caseDir)) {
    const fallback = lobCardDir(rootDir, id, lob);
    if (fs.existsSync(fallback)) caseDir = fallback;
  }
  const exists = Boolean(caseDir && fs.existsSync(caseDir) && isCardDir(caseDir));
  const card = {
    id,
    title: row.title || id,
    sopId: row.sop_id || "vendor-onboarding",
    status: row.status || "queued",
    lob,
    sourceDir: caseDir,
    formUrl: row.form_url || null,
    pdfPath: row.pdf_path || null,
    formMatch: row.form_match ? String(row.form_match).split("|").filter(Boolean) : [],
    assignees: normalizeAssignees(String(row.assignees || "").split(",")),
    data: scalarQueueData(dataByCard.get(cardKey(lob, id)) || {}),
    documents: documentsForCardDir(caseDir),
    _sourceExists: exists,
  };
  return attachCardPlaywright(card, exists ? caseDir : "");
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
 *   <project>/queue/<LOB>/<case-id>/
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
function parseQueueFieldValue(value) {
  if (value == null) return "";
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (s.includes("[object Object]")) return "";
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      return JSON.parse(s);
    } catch {
      return value;
    }
  }
  return value;
}

function serializeQueueFieldValue(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function loadQueueFromDocuments(rootDir = defaultDocumentsRoot(), opts = {}) {
  migrateLegacyDocumentsCoact();
  if (fs.existsSync(rootDir)) {
    migrateFlatCardsToLob(rootDir, DEFAULT_LOB);
  }

  const filterByUser = Boolean(opts.filterByUser);
  const userId = opts.userId != null ? String(opts.userId).trim() : "";
  const workbookStore = require("./workbook");
  const projectRoot = defaultProjectRoot();
  const { QueueCards, QueueData, QueueLobs } = await workbookStore.readTables(
    ["QueueCards", "QueueData", "QueueLobs"],
    projectRoot
  );

  const dataByCard = new Map();
  for (const row of QueueData || []) {
    const key = cardKey(row.lob, row.card_id);
    if (!dataByCard.has(key)) dataByCard.set(key, {});
    if (row.field_key) dataByCard.get(key)[row.field_key] = parseQueueFieldValue(row.field_value);
  }

  const lobs = [];
  const lobAssigneeMap = new Map();
  for (const row of QueueLobs || []) {
    const name = normalizeLob(row.lob);
    if (lobAssigneeMap.has(name)) continue;
    const assignees = normalizeAssignees(String(row.assignees || "").split(","));
    lobs.push({ name, assignees });
    lobAssigneeMap.set(name, assignees);
  }

  // Workbook wins; drop duplicate lob/card_id rows (prefer a source_dir that exists).
  const byKey = new Map();
  for (const row of QueueCards || []) {
    const id = String(row.card_id || "").trim();
    if (!id) continue;
    const mapped = cardFromWorkbookRow(row, rootDir, dataByCard);
    if (!mapped._sourceExists) continue;
    const key = cardKey(mapped.lob, mapped.id);
    const prev = byKey.get(key);
    if (!prev || (!prev._sourceExists && mapped._sourceExists)) {
      byKey.set(key, mapped);
    }
  }

  // Partial workbooks (e.g. packaged ~/Projects/coact with one leftover row)
  // must still surface on-disk TCOO / other LOB cards.
  for (const entry of listLobCardDirs(rootDir)) {
    const key = cardKey(entry.lob, entry.id);
    if (entry.lobConfig && !lobAssigneeMap.has(entry.lob)) {
      lobs.push({ name: entry.lob, assignees: entry.lobConfig.assignees });
      lobAssigneeMap.set(entry.lob, entry.lobConfig.assignees);
    }
    if (byKey.has(key)) continue;
    const fromDisk = loadCardFromDir(entry.dir, entry.id, entry.lob);
    fromDisk.id = entry.id;
    fromDisk.lob = normalizeLob(fromDisk.lob || entry.lob);
    if (!fromDisk.data || !Object.keys(fromDisk.data).length) {
      fromDisk.data = dataByCard.get(key) || fromDisk.data || {};
    }
    byKey.set(key, fromDisk);
  }

  if (!lobAssigneeMap.has(DEFAULT_LOB)) {
    lobs.push({ name: DEFAULT_LOB, assignees: [] });
    lobAssigneeMap.set(DEFAULT_LOB, []);
  }

  let cards = [...byKey.values()].map((c) => {
    const { _sourceExists, ...card } = c;
    return card;
  });

  const visible = filterByUser
    ? filterCardsForUser(cards, lobAssigneeMap, userId)
    : cards;

  visible.sort((a, b) => {
    const lobCmp = (a.lob || "").localeCompare(b.lob || "");
    if (lobCmp !== 0) return lobCmp;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
  return { rootDir, cards: visible, lobs, allCardCount: cards.length };
}

function writeCardFiles(dir, { data, meta, previous } = {}) {
  ensureDir(dir);
  writeCardDiskSidecars(dir, { data, meta });
  const workbookStore = require("./workbook");
  const projectRoot = defaultProjectRoot();
  const lob = normalizeLob(meta?.lob);
  const cardId = String(meta?.id || path.basename(dir)).trim();
  const now = new Date().toISOString();
  const job = (async () => {
    const { QueueCards, QueueData } = await workbookStore.readTables(
      ["QueueCards", "QueueData"],
      projectRoot
    );
    const cardRow = {
      lob,
      card_id: cardId,
      title: meta?.title || cardId,
      sop_id: meta?.sopId || "",
      status: meta?.status || "queued",
      form_url: meta?.formUrl || "",
      pdf_path: meta?.pdfPath || "",
      form_match: Array.isArray(meta?.formMatch) ? meta.formMatch.join("|") : "",
      assignees: normalizeAssignees(meta?.assignees).join(","),
      source_dir: dir,
      updated_at: now,
    };
    const drop = new Set([cardKey(lob, cardId)]);
    if (previous?.id) drop.add(cardKey(previous.lob || lob, previous.id));
    const nextCards = [
      ...(QueueCards || []).filter((r) => !drop.has(cardKey(r.lob, r.card_id))),
      cardRow,
    ];
    await workbookStore.replaceRows("QueueCards", nextCards, projectRoot);
    if (data != null) {
      const nextData = [
        ...(QueueData || []).filter((r) => !drop.has(cardKey(r.lob, r.card_id))),
        ...Object.entries(scalarQueueData(data)).map(([field_key, field_value]) => ({
          lob,
          card_id: cardId,
          field_key,
          field_value: serializeQueueFieldValue(field_value),
        })),
      ];
      await workbookStore.replaceRows("QueueData", nextData, projectRoot);
    }
  })();
  return job;
}

function lobCardDir(rootDir, cardId, lob = DEFAULT_LOB) {
  return path.join(rootDir, lob, cardId);
}

async function seedSampleCases(rootDir = defaultDocumentsRoot()) {
  migrateLegacyDocumentsCoact();
  ensureDir(rootDir);
  migrateFlatCardsToLob(rootDir, DEFAULT_LOB);
  const lobRoot = path.join(rootDir, DEFAULT_LOB);
  ensureDir(lobRoot);

  const workbookStore = require("./workbook");
  const projectRoot = defaultProjectRoot();
  let existingKeys = new Set();
  try {
    const { QueueCards } = await workbookStore.readTables(["QueueCards"], projectRoot);
    existingKeys = new Set(
      (QueueCards || [])
        .filter((r) => String(r.card_id || "").trim())
        .map((r) => cardKey(r.lob, r.card_id))
    );
  } catch {
    existingKeys = new Set();
  }

  async function seedIfMissing(dir, payload) {
    const meta = payload.meta || {};
    const lob = normalizeLob(meta.lob);
    const id = String(meta.id || path.basename(dir)).trim();
    if (!id || existingKeys.has(cardKey(lob, id))) return false;
    await writeCardFiles(dir, payload);
    existingKeys.add(cardKey(lob, id));
    return true;
  }

  // Rehydrate cards that still live on disk (queue/TCOO/…) but vanished from the workbook.
  for (const entry of listLobCardDirs(rootDir)) {
    const disk = loadCardFromDir(entry.dir, entry.id, entry.lob);
    await seedIfMissing(entry.dir, {
      data: disk.data || {},
      meta: {
        id: disk.id,
        title: disk.title,
        sopId: disk.sopId,
        status: disk.status,
        lob: normalizeLob(disk.lob || entry.lob),
        formUrl: disk.formUrl,
        pdfPath: disk.pdfPath,
        formMatch: disk.formMatch,
        assignees: disk.assignees,
      },
    });
  }

  try {
    const { QueueLobs } = await workbookStore.readTables(["QueueLobs"], projectRoot);
    const nextLobs = [];
    const seenLobs = new Set();
    for (const row of QueueLobs || []) {
      const name = normalizeLob(row.lob);
      if (seenLobs.has(name)) continue;
      seenLobs.add(name);
      nextLobs.push({ ...row, lob: name });
    }
    if (!seenLobs.has(DEFAULT_LOB)) {
      nextLobs.push({
        lob: DEFAULT_LOB,
        assignees: "",
        updated_at: new Date().toISOString(),
      });
    }
    if (nextLobs.length !== (QueueLobs || []).length) {
      await workbookStore.replaceRows("QueueLobs", nextLobs, projectRoot);
    }
  } catch {
    /* QueueLobs is optional until the workbook exists */
  }

  // Operators can drop this file to stop demo/sample cards from coming back
  // after they are removed from the queue.
  if (!fs.existsSync(path.join(rootDir, ".skip-demo-seed"))) {
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
      note: "Put supporting PDFs here. Field values live in livetrack.xlsx.",
    },
  ];

  for (const sample of samples) {
    const dir = lobCardDir(rootDir, sample.folder);
    await seedIfMissing(dir, {
      data: sample.data,
      meta: {
        id: sample.folder,
        title: titleFromFolder(sample.folder, sample.data),
        sopId: "vendor-onboarding",
        status: "queued",
        lob: DEFAULT_LOB,
      },
      readme: `${sample.note}\n\nCase field values live in livetrack.xlsx (QueueData).\n`,
    });
  }

  // Always ensure the multi-site demo queue cards exist (idempotent; never wipe user rows)
  try {
    const { DEMO_SITES } = require("@coact/shared/demo-catalog");
    for (const site of DEMO_SITES) {
      const dir = lobCardDir(rootDir, site.id);
      await seedIfMissing(dir, {
        data: site.answers,
        meta: {
          id: site.id,
          title: site.title,
          sopId: `demo-${site.id}`,
          status: "queued",
          lob: DEFAULT_LOB,
          formUrl: `http://127.0.0.1:4173/${site.path.replace(/\.html$/, "")}`,
        },
        readme: `${site.title}\n\nOpen http://127.0.0.1:4173/${site.path.replace(/\.html$/, "")} then Start in LiveTrack.\n`,
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
          "Orbit Onboard multi-page click stream.\n\nOpen http://127.0.0.1:4173/sites/orbit-onboard/ then Start in LiveTrack.\n",
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
          "Gateform Access single-page click gate.\n\nOpen http://127.0.0.1:4173/sites/gateform-access/ then Start in LiveTrack.\n",
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
          "PlanStream Apply: Landing (Accept → Choose plan → Continue) → Eligibility (Confirm → Select workspace → Open application) → form.\n\nOpen http://127.0.0.1:4173/sites/planstream-apply/ then Start in LiveTrack.\n",
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
          "Segue Select: Region → Product → Intent → Plan → Confirm (same page), then form.\n\nOpen http://127.0.0.1:4173/sites/section-select/ then Start in LiveTrack.\n",
      },
    ];

    for (const c of clickStreamCases) {
      const dir = lobCardDir(rootDir, c.id);
      await seedIfMissing(dir, { data: c.data, meta: c.meta, readme: c.readme });
    }
  } catch (err) {
    console.error("[coact] demo site seed failed", err.message);
  }

  await seedIfMissing(lobCardDir(rootDir, "servicenow-cr-search"), {
    data: { query: "" },
    meta: {
      id: "servicenow-cr-search",
      title: "ServiceNow — Search change requests",
      sopId: "servicenow-change-request-search",
      status: "queued",
      lob: DEFAULT_LOB,
      formMatch: [
        "service-now.com",
        "servicenow.com",
        "change_request",
        "ServiceNow",
      ],
    },
    readme:
      "Open a logged-in ServiceNow tab. In LiveTrack, enter a CHG number or keywords, Approve, then Start. LiveTrack filters the change request list in the browser (no ServiceNow API).",
  });
  }

  try {
    seedFullstackPlaywrightCard(rootDir);
  } catch (err) {
    console.error("[coact] fullstack playwright seed failed", err.message);
  }

  return { seeded: true, rootDir };
}

module.exports = {
  DEFAULT_LOB,
  defaultDocumentsRoot,
  defaultProjectRoot,
  defaultExecutionsRoot,
  defaultSqlRoot,
  defaultSettingsPath,
  defaultJiraActionsPath,
  defaultExtensionDir,
  defaultUserSopsDir,
  legacyDocumentsCoactRoot,
  migrateLegacyDocumentsCoact,
  loadQueueFromDocuments,
  seedSampleCases,
  migrateFlatCardsToLob,
  writeCardFiles,
  lobCardDir,
  loadCardFromDir,
  loadPlaywrightFromCardDir,
  persistQueuePlaywrightCaseData,
  playwrightStepsOf,
  cardHasAttachedPlaywright,
  attachCardPlaywright,
  cardPlayDir,
  cardKey,
  normalizeLob,
  updateQueueCardStatus,
  isCardDir,
  loadLobConfig,
  saveLobConfig,
  normalizeAssignees,
  userAllowed,
  userExplicitlyAssigned,
  filterCardsForUser,
};
