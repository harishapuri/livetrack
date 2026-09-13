const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, session, systemPreferences, clipboard, nativeImage, desktopCapturer } = require("electron");
if (!app || typeof app.requestSingleInstanceLock !== "function") {
  console.error("LiveTrack must run as the Electron app, not Node.");
  process.exit(1);
}
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { createBridge } = require("./bridge");

try {
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
} catch {
  /* ignore */
}

// second-instance can fire during startup — declare these before that handler (avoid TDZ).
let mainWindow = null;
let tailMode = false;

// One Electron instance — multiple copies fight for always-on-top / focus (flicker)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.exit(0);
} else {
  app.on("second-instance", () => {
    if (tailMode) {
      try {
        exitTailMode();
      } catch {
        /* ignore */
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      applyAlwaysOnTop(true);
      mainWindow.focus();
    }
  });
}
const {
  defaultDocumentsRoot,
  defaultExtensionDir,
  defaultUserSopsDir,
  migrateLegacyDocumentsCoact,
  writeCardFiles,
  lobCardDir,
  loadQueueFromDocuments,
  seedSampleCases,
  updateQueueCardStatus,
} = require("./documents");
const {
  getOpenAiConfig,
  saveSettings,
  getAppSettings,
  getJiraConfig,
  isBlankJiraSecret,
} = require("./settings");
const {
  searchIssues,
  testConnection,
  sanitizeJiraSecret,
  isConfigured: isJiraConfigured,
  addComment,
  appendIssueDescription,
  createIssue,
  cloneIssue,
  attachFile,
  collectDeskAttachmentPaths,
  appendJiraAction,
  recentJiraActions,
  isJiraDoneStatus,
  findLinkedCardId,
  ensureLinkedIssues,
} = require("./jira");
const {
  buildAgentDashboard,
  loadMandatorySummaryForTicket,
  extractJiraKey,
  isGeneratedJiraKey,
} = require("./dashboard-stats");
const {
  streamChat,
  transcribeAudio,
  synthesizeSpeech,
  refineMeetingMinutes,
  readTeamsMeetingFrame,
  coachStuckStep,
  proposeAgentFill,
  repairFailedStep,
  judgeValueMatch,
  polishJiraCommentDraft,
  explainPage,
  isUsefulExplainSnippet,
  draftJiraFromScreenshot,
  draftMailFromScreenshot,
} = require("./openai-chat");
const { captureRegionSnip, captureFrontmostWindow, isChromeOwnerName } = require("./snipper");
const {
  resolvePdfPath,
  fillPdfForm,
  clearPdfForm,
  applyPdfStep,
  isPdfPath,
  cardPrefersPdf,
  workingPdfPath,
} = require("./pdf-fill");
const { saveExecutionArtifacts } = require("./audit-pdf");
const { createPdfViewServer } = require("./pdf-server");
const { loadCaptureDashRows, setCaptureRecording, getCaptureStatus } = require("./capture-forward");
const { resolveExplainPastWork } = require("./explain-context");
const browserAgent = require("./browser-agent");
const outlook = require("./outlook");
const mom = require("./mom");
const momSpeakers = require("./mom-speakers");
const momTeams = require("./mom-teams");
const { recordFeedback } = require("./feedback-log");
const inbox = require("./inbox");
const actionsStore = require("./actions-store");
const {
  discoverFromActivePage,
  draftUnmatchedCaptures,
  promoteSopToQueueCard,
  synthesizeDraftFromCapture,
  loadSopOrRegenerateFromCapture,
} = require("./process-discovery");
const { loadLatestReport } = require("./process-intelligence");
const sopsStore = require("./sops-store");
const { execFile } = require("child_process");

function bundledSopsDir() {
  // Packaged app: extraResources/shared/sops
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "shared", "sops");
    if (fs.existsSync(packaged)) return packaged;
  }
  // Dev monorepo: packages/shared/sops
  return path.join(__dirname, "..", "shared", "sops");
}

/** Packaged/dev path to the Chrome/Edge extension folder */
function bundledExtensionDir() {
  if (app.isPackaged && process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "extension");
    if (fs.existsSync(path.join(packaged, "manifest.json"))) return packaged;
  }
  const dev = path.join(__dirname, "..", "extension");
  if (fs.existsSync(path.join(dev, "manifest.json"))) return dev;
  return null;
}

/** Stable project copy so Load unpacked keeps working across app updates */
function userExtensionDir() {
  return defaultExtensionDir();
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === ".DS_Store") continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

/**
 * Copy bundled extension → <project>/extension and optionally open
 * Chrome / Edge extension pages + reveal the folder for Load unpacked.
 */
function installBrowserExtension(browser = "chrome") {
  const src = bundledExtensionDir();
  if (!src) {
    return { ok: false, error: "Extension folder not found in this install" };
  }
  const dest = userExtensionDir();
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    copyDirRecursive(src, dest);
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }

  try {
    shell.showItemInFolder(path.join(dest, "manifest.json"));
  } catch {
    /* ignore */
  }

  const page =
    browser === "edge"
      ? "edge://extensions"
      : browser === "both"
        ? null
        : "chrome://extensions";
  if (page) {
    shell.openExternal(page).catch(() => {});
  } else if (browser === "both") {
    shell.openExternal("chrome://extensions").catch(() => {});
    setTimeout(() => {
      shell.openExternal("edge://extensions").catch(() => {});
    }, 400);
  }

  return {
    ok: true,
    path: dest,
    source: src,
    browser,
    hint:
      "Developer mode → Load unpacked → select Desktop/livetrack app/packages/extension (folder already opened).",
  };
}

/** User-writable SOPs (SOP builder overrides under <project>/sops) */
function userSopsDir() {
  return defaultUserSopsDir();
}

function sopsSearchDirs() {
  const dirs = [bundledSopsDir(), userSopsDir()];
  // Dedupe while preserving order (later dirs override earlier)
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

/**
 * Governance gate (DPIP): a SOP with status "draft" or "rejected" (e.g. one
 * synthesized by the Process Discovery Agent, or a hand-edited draft awaiting
 * SME sign-off) must never reach liveAct's runtime map — only an SME
 * approving it via the dashboard "Reviews" page flips it to "published".
 * SOPs with no status field are treated as published for backward
 * compatibility with everything authored before this gate existed.
 */
function isPublishedSopStatus(sop) {
  return sop?.status !== "draft" && sop?.status !== "rejected";
}

function loadSopsFromDir(sopsDir, map) {
  if (!fs.existsSync(sopsDir)) return;
  for (const name of fs.readdirSync(sopsDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const filePath = path.join(sopsDir, name);
      const sop = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (sop?.id && isPublishedSopStatus(sop)) map[sop.id] = sop;
    } catch (err) {
      console.error("[livetrack] failed to load sop", name, err.message);
    }
  }
}

async function loadAllSops() {
  try {
    const fromWorkbook = await sopsStore.loadPublishedSopMap();
    if (Object.keys(fromWorkbook).length) return fromWorkbook;
  } catch (err) {
    console.error("[livetrack] workbook SOP load failed", err.message);
  }
  const map = {};
  for (const dir of sopsSearchDirs()) {
    loadSopsFromDir(dir, map);
  }
  return map;
}

let sops = {};
/** Sync copy of process-intelligence failures for IPC (riskForCard is async). */
let cardRiskById = new Map();

function ipcSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

async function refreshCardRiskCache() {
  cardRiskById = new Map();
  try {
    const report = await loadLatestReport();
    for (const f of report?.failures || []) {
      const key = String(f.cardKey || f.queue_card_id || "").trim();
      if (key) cardRiskById.set(key, f);
    }
  } catch {
    /* optional until a PI report exists */
  }
}

async function reloadSops() {
  sops = await loadAllSops();
  return sops;
}

function watchSopsDir() {
  const workbookPath = require("./workbook").workbookPath();
  try {
    fs.watch(path.dirname(workbookPath), { persistent: false }, (_event, filename) => {
      if (filename && filename !== path.basename(workbookPath)) return;
      reloadSops().catch((err) => console.error("[livetrack] reload SOPs", err.message));
    });
  } catch (err) {
    console.error("[livetrack] workbook watch failed", err.message);
  }
}

let tailWindow = null;
let bridge = null;
let pdfViewServer = null;
let activeRun = null;
/** Agent-approved values for the current run — edits here are intentional, not mistakes. */
let activeRunAgentApproved = null;
let activeWatch = null;
/** @type {Map<string, Map<string, object>>} cardId → stepId → action record */
const cardActions = new Map();
/** @type {Map<string, Map<string, { step_id: string, step_start_time?: string, step_end_time?: string, label?: string }>>} */
const cardStepTiming = new Map();
/** @type {Map<string, string>} cardId → ISO when current run/session started */
const cardRunStartedAt = new Map();
/** @type {Map<string, object[]>} cardId → wrong-value attempts (for tracking) */
const cardMistakes = new Map();
/** Prevent double-save for the same card in a short window */
const finalizedAt = new Map();
/** @type {Map<string, { pageUrl?: string, formReference?: string }>} */
const cardPageContext = new Map();
let lastExtensionTabUrl = null;
let documentsRoot = defaultDocumentsRoot();
let queue = [];
let normalBounds = null;
/** True while region snip is running — do not re-pin always-on-top over the crosshair. */
let screenCaptureActive = false;
/** @type {{ ok: boolean, issues: any[], staleCount: number, error?: string, fetchedAt?: string } | null} */
let jiraSnapshot = null;
let jiraPollTimer = null;
let jiraPollInFlight = false;
/** @type {Promise<object|null>|null} */
let jiraRefreshPromise = null;
/** Faster poll while the Jira sidebar pane is visible */
let jiraPaneActive = false;
const JIRA_ACTIVE_POLL_MS = 15_000;

let outlookEvents = [];
let outlookMeta = { ok: false, connected: false, error: "" };
let outlookPollTimer = null;
let momTickTimer = null;
let momSession = null;
const momAlertedIds = new Set();
const momPreAlertedIds = new Set();
const actionAlertedIds = new Set();
const momAutoStopIds = new Set();
let momRefineInFlight = false;
let momAlertTickInFlight = false;
let tailStatusState = { ok: false, bad: false, speaking: false };
const MOM_TICK_MS = 15_000;
const OUTLOOK_POLL_MS = 120_000;

function recordCardAction(cardId, update) {
  if (!cardId || !update?.stepId) return;
  if (update.status !== "done") return;
  const action = update.action;
  if (action && action !== "fill" && action !== "click" && action !== "check") {
    return;
  }
  // Accept captures that include action/key, or infer from SOP later at finalize
  if (!action && update.key == null && update.value == null) return;

  let map = cardActions.get(cardId);
  if (!map) {
    map = new Map();
    cardActions.set(cardId, map);
  }
  map.set(update.stepId, {
    stepId: update.stepId,
    action: action || "fill",
    key: update.key || update.stepId,
    value: update.value != null ? String(update.value) : "",
    label: update.label || "",
    source: update.source || "automated",
  });
}

function markCardRunStarted(cardId, when = new Date().toISOString()) {
  if (!cardId) return;
  if (!cardRunStartedAt.has(cardId)) {
    cardRunStartedAt.set(cardId, when);
  }
}

function clearCardRunStarted(cardId) {
  if (cardId) cardRunStartedAt.delete(cardId);
}

/** Track step_start_time / step_end_time for weekly digest avg time-per-step. */
function recordStepTiming(cardId, update) {
  if (!cardId || !update?.stepId) return;
  const status = String(update.status || "");
  if (status !== "running" && status !== "done" && status !== "failed") return;

  markCardRunStarted(cardId);

  let map = cardStepTiming.get(cardId);
  if (!map) {
    map = new Map();
    cardStepTiming.set(cardId, map);
  }
  const now = new Date().toISOString();
  let row = map.get(update.stepId);
  if (!row) {
    row = {
      step_id: update.stepId,
      label: update.label || "",
    };
    map.set(update.stepId, row);
  }
  if (update.label) row.label = update.label;
  if (status === "running") {
    if (!row.step_start_time) row.step_start_time = now;
  } else {
    if (!row.step_start_time) {
      // Prefer run start for first step; otherwise previous step end
      const started = cardRunStartedAt.get(cardId);
      const prevEnds = [...map.values()]
        .map((r) => Date.parse(r.step_end_time || ""))
        .filter((t) => Number.isFinite(t));
      const prev = prevEnds.length ? new Date(Math.max(...prevEnds)).toISOString() : null;
      row.step_start_time = prev || started || now;
    }
    row.step_end_time = now;
  }
}

function stepsTimingListForCard(cardId) {
  const map = cardStepTiming.get(cardId);
  if (!map) return [];
  return [...map.values()].filter((r) => r.step_start_time || r.step_end_time);
}

function clearCardStepTiming(cardId) {
  if (cardId) cardStepTiming.delete(cardId);
}

/**
 * Capture wrong fills on mandatory (key-symbol) steps only.
 * Keeps attempts even when the user later Approves the correct value.
 * Agent-approved (possibly user-edited) fills are intentional — never scored as mistakes.
 */
function recordCardMistake(cardId, update) {
  if (!cardId || !update?.stepId) return;
  if (update.status !== "mismatch") return;
  if (update.agentApproved || update.source === "agent" || update.skipMistake) return;

  const card = queue.find((c) => c.id === cardId);
  const sop = card ? sops[card.sopId] : null;
  const step = sop?.steps?.find((s) => s.id === update.stepId);
  // Only steps marked mandatory (key icon in liveAct)
  if (!step?.mandatory) return;

  // Values intentionally approved in the Agent popup for this run
  if (activeRunAgentApproved?.cardId === cardId) {
    const approved = activeRunAgentApproved.values || {};
    const overrides = activeRunAgentApproved.dataOverrides || {};
    const actual = String(update.actual ?? "").trim();
    const byStep = approved[update.stepId];
    const byKey =
      update.key != null && overrides[update.key] != null
        ? overrides[update.key]
        : null;
    for (const intentional of [byStep, byKey]) {
      if (
        intentional != null &&
        actual &&
        normalizeMistakeCompare(actual) === normalizeMistakeCompare(intentional)
      ) {
        return;
      }
    }
  }

  const expected = String(
    update.expected ?? update.suggestedValue ?? "",
  ).trim();
  const actual = String(update.actual ?? "").trim();
  if (!expected && !actual) return;
  if (expected && actual && normalizeMistakeCompare(actual) === normalizeMistakeCompare(expected)) {
    return;
  }

  let list = cardMistakes.get(cardId);
  if (!list) {
    list = [];
    cardMistakes.set(cardId, list);
  }

  const fingerprint = `${update.stepId}|${actual}|${expected}`;
  if (list.some((m) => m._fp === fingerprint)) return;

  const key =
    update.key ||
    step?.valueFrom ||
    update.stepId;

  list.push({
    _fp: fingerprint,
    step_id: update.stepId,
    field_key: key,
    label: update.label || step?.label || "",
    expected,
    actual,
    at: new Date().toISOString(),
  });
  console.log(
    "[coact] mistake recorded",
    cardId,
    key,
    `typed="${actual}" expected="${expected}"`,
  );
}

function actionsListForCard(cardId) {
  const map = cardActions.get(cardId);
  if (!map) return [];
  return [...map.values()];
}

function mistakesListForCard(cardId) {
  const list = cardMistakes.get(cardId);
  if (!list?.length) return [];
  return list.map(({ _fp, ...rest }) => rest);
}

function normalizeMistakeCompare(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function fuzzyMistakeMatch(actual, expected) {
  const act = String(actual ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const exp = String(expected ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!exp) return true;
  if (!act) return false;

  const a = normalizeMistakeCompare(act);
  const e = normalizeMistakeCompare(exp);
  if (a === e) return true;

  const aAlnum = a.replace(/[^a-z0-9]/g, "");
  const eAlnum = e.replace(/[^a-z0-9]/g, "");
  if (aAlnum && aAlnum === eAlnum) return true;
  if (aAlnum.length >= 3 && eAlnum.length >= 3) {
    if (aAlnum.includes(eAlnum) || eAlnum.includes(aAlnum)) return true;
  }

  const aTokens = a.split(" ").filter(Boolean).sort().join(" ");
  const eTokens = e.split(" ").filter(Boolean).sort().join(" ");
  if (aTokens && aTokens === eTokens) return true;

  // light edit distance for typos
  const s = a;
  const t = e;
  const prev = new Array(t.length + 1);
  const cur = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i;
    const sc = s.charCodeAt(i - 1);
    for (let j = 1; j <= t.length; j++) {
      const cost = sc === t.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= t.length; j++) prev[j] = cur[j];
  }
  const dist = prev[t.length];
  const maxLen = Math.max(s.length, t.length);
  const maxDist = maxLen <= 4 ? 1 : maxLen <= 12 ? 2 : 3;
  return maxLen > 0 && dist <= maxDist;
}

/**
 * Also flag final fill values on mandatory steps that still don't match case/SOP data.
 * Non-mandatory wrong fills are ignored for tracking.
 */
function mergeFinalValueMistakes(card, sop, actions, existing) {
  const data = card?.data || {};
  if (!sop?.steps?.length) {
    return Array.isArray(existing) ? [...existing] : [];
  }

  // Drop any non-mandatory mistakes that slipped in from live events
  const out = (Array.isArray(existing) ? existing : []).filter((m) => {
    const step = sop.steps.find((s) => s.id === m.step_id);
    return Boolean(step?.mandatory);
  });
  const seen = new Set(
    out.map((m) => `${m.step_id}|${m.actual}|${m.expected}`),
  );

  for (const a of actions) {
    const stepId = a.stepId || a.step_id;
    const step = sop.steps.find((s) => s.id === stepId);
    if (!step || step.action !== "fill" || !step.mandatory) continue;

    const key = step.valueFrom || a.key || step.id;
    let expected = "";
    if (Array.isArray(step.allowedValues) && step.allowedValues.length) {
      expected = String(step.allowedValues[0] ?? "");
    } else if (key && Object.prototype.hasOwnProperty.call(data, key)) {
      const v = data[key];
      expected = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
    } else if (step.value != null) {
      expected = String(step.value);
    }
    expected = expected.trim();
    const actual = String(a.value ?? a.field_value ?? "").trim();
    if (!expected || !actual) continue;
    if (fuzzyMistakeMatch(actual, expected)) {
      continue;
    }

    const fp = `${step.id}|${actual}|${expected}`;
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push({
      step_id: step.id,
      field_key: key,
      label: step.label || a.label || "",
      expected,
      actual,
      at: new Date().toISOString(),
    });
  }
  return out;
}

function clearCardActions(cardId) {
  if (cardId) cardActions.delete(cardId);
}

function clearCardMistakes(cardId) {
  if (cardId) cardMistakes.delete(cardId);
}

function allGatingActionsCaptured(cardId) {
  const card = queue.find((c) => c.id === cardId);
  if (!card) return false;
  const sop = sops[card.sopId];
  if (!sop?.steps?.length) return false;
  const gating = sop.steps.filter(
    (s) =>
      (s.action === "fill" || s.action === "click" || s.action === "check") &&
      !s.optional
  );
  if (!gating.length) return false;
  const map = cardActions.get(cardId);
  if (!map) return false;
  return gating.every((s) => map.has(s.id));
}

async function finalizeExecutionArtifacts(
  cardId,
  { filledPdfSource = null, fillMode = null, status = "complete" } = {},
) {
  if (!cardId) return null;

  const outcome = String(status || "complete").trim().toLowerCase();
  const isComplete =
    !outcome ||
    outcome === "complete" ||
    outcome === "completed" ||
    outcome === "done" ||
    outcome === "run_complete";

  // Incomplete = user started a run but did not finish (failed / cancelled / abandoned).
  if (!isComplete && !cardRunStartedAt.has(cardId)) {
    clearCardActions(cardId);
    clearCardMistakes(cardId);
    clearCardStepTiming(cardId);
    clearCardRunStarted(cardId);
    cardPageContext.delete(cardId);
    return null;
  }

  const now = Date.now();
  const prev = finalizedAt.get(cardId) || 0;
  if (now - prev < 5000) return null;
  finalizedAt.set(cardId, now);

  await refreshQueue();
  const card = queue.find((c) => c.id === cardId);
  if (!card) return null;

  let actions = actionsListForCard(cardId);
  const sop = sops[card.sopId];
  const mistakes = isComplete
    ? mergeFinalValueMistakes(card, sop, actions, mistakesListForCard(cardId))
    : mistakesListForCard(cardId);

  // Fallback: if extension didn't send values, use case data for fill steps
  if (isComplete && !actions.length && sop?.steps?.length) {
    actions = sop.steps
      .filter((s) => s.action === "fill" || s.action === "click" || s.action === "check")
      .map((s) => ({
        stepId: s.id,
        action: s.action,
        key: s.valueFrom || s.id,
        value:
          s.action === "fill"
            ? String(card.data?.[s.valueFrom] ?? card.data?.[s.id] ?? "")
            : s.findByText || s.label || "clicked",
        label: s.label || s.id,
        source: fillMode === "manual" ? "manual" : "automated",
      }));
  } else if (isComplete && sop?.steps?.length) {
    // Enrich missing labels from SOP
    for (const a of actions) {
      const step = sop.steps.find((s) => s.id === a.stepId);
      if (step && !a.label) a.label = step.label || "";
      if (step && (!a.key || a.key === a.stepId) && step.valueFrom) {
        a.key = step.valueFrom;
      }
      if (step?.action === "fill" && !a.value && card.data) {
        a.value = String(card.data[step.valueFrom] ?? card.data[step.id] ?? "");
      }
    }
  }

  let filledSource = filledPdfSource;
  if (isComplete && !filledSource && sop) {
    const { prefer, pdfPath } = cardPrefersPdf(card, sop);
    if (prefer && pdfPath) {
      const working = workingPdfPath(pdfPath);
      if (fs.existsSync(working)) filledSource = working;
    }
  }

  try {
    const jiraCfg = getJiraConfig();
    const field = jiraCfg.jiraCardKeyField || "jiraKey";
    const realKey = extractJiraKey(card.data?.[field], card.title, card.id);
    const pageCtx = cardPageContext.get(cardId) || {};
    const pageUrl = pageCtx.pageUrl || lastExtensionTabUrl || "";
    const result = await saveExecutionArtifacts({
      lob: card.lob || "TCOO",
      queueCard: card.id,
      cardTitle: card.title,
      actions: isComplete ? actions : [],
      mistakes: isComplete ? mistakes : [],
      fillMode,
      filledPdfSource: isComplete ? filledSource : null,
      jiraKey: realKey || "",
      formReference: pageCtx.formReference || "",
      pageUrl,
      stepsTiming: stepsTimingListForCard(cardId),
      runStartedAt: cardRunStartedAt.get(cardId) || "",
      status: isComplete ? "complete" : outcome === "run_failed" ? "failed" : outcome === "run_cancelled" ? "cancelled" : outcome,
    });
    console.log(
      "[coact] saved execution",
      result.status || "complete",
      result.fillMode,
      `mistakes=${isComplete ? mistakes.length : 0}`,
      `ref=${result.formReference || "—"}`,
      result.excelPath,
      result.sqlResult
        ? `(sql rows=${result.sqlResult.runCount})`
        : "",
    );

    // Mandatory: append a NEW Jira comment for every completed execution (never overwrite)
    if (isComplete) {
      const answers = {};
      for (const a of actions) {
        const k = a.key || a.stepId;
        if (k && a.value != null && String(a.value).trim() !== "") {
          answers[k] = String(a.value);
        }
      }
      Object.assign(answers, card.data || {});
      postExecutionJiraComment({
        card,
        fillMode: result.fillMode || fillMode || "automated",
        mistakes,
        answers,
        runId: result.runId,
        storyKey: result.jiraKey || realKey || "",
        formReference: result.formReference || "",
      }).catch((err) => console.error("[coact] execution jira comment", err?.message || err));
    }

    clearCardActions(cardId);
    clearCardMistakes(cardId);
    clearCardStepTiming(cardId);
    clearCardRunStarted(cardId);
    cardPageContext.delete(cardId);
    return result;
  } catch (err) {
    console.error("[coact] save execution artifacts failed", err.message);
    return null;
  }
}

/** Prefer a real Jira issue key for this card (not LACT-*). */
function resolveJiraIssueKeyForCard(card) {
  if (!card) return "";
  const field = getJiraConfig().jiraCardKeyField || "jiraKey";
  const fromCard = extractJiraKey(card.data?.[field], card.title, card.id);
  if (fromCard && !isGeneratedJiraKey(fromCard)) return fromCard;

  const issues = jiraSnapshot?.issues || [];
  const byLink = issues.find((i) => i.linkedCardId === card.id);
  if (byLink?.key) return byLink.key;

  const title = String(card.title || "").toLowerCase();
  const idBits = String(card.id || "")
    .toLowerCase()
    .split(/[-_]+/)
    .filter((t) => t.length > 3);
  const titleBits = title.split(/[^a-z0-9]+/).filter((t) => t.length > 4);
  const tokens = [...new Set([...idBits, ...titleBits])];
  if (!tokens.length) return "";

  const hit = issues.find((i) => {
    const s = String(i.summary || "").toLowerCase();
    const matches = tokens.filter((t) => s.includes(t));
    return matches.length >= Math.min(2, tokens.length);
  });
  return hit?.key || "";
}

/**
 * After every execution, POST a new Jira comment (append-only).
 * Never updates or replaces prior comments.
 */
async function postExecutionJiraComment({
  card,
  fillMode,
  mistakes,
  answers,
  runId,
  storyKey,
  formReference,
}) {
  const config = getJiraConfig();
  if (!isJiraConfigured(config)) {
    return { ok: false, error: "jira_not_configured" };
  }

  const issueKey =
    (storyKey && !isGeneratedJiraKey(storyKey) ? storyKey : "") ||
    resolveJiraIssueKeyForCard(card);
  if (!issueKey) {
    console.warn(
      "[coact] execution jira comment skipped — no linked Jira issue for",
      card?.id
    );
    appendJiraAction({
      issueKey: card?.id || "?",
      action: "execution_comment_skipped",
      bodyPreview: "No linked Jira issue key",
      ok: false,
      conflict: false,
      error: "no_linked_issue",
    });
    return { ok: false, error: "no_linked_issue" };
  }

  const queueCard = `${card.title || card.id}${card.id ? ` (${card.id})` : ""}`;
  const loaded = await loadMandatorySummaryForTicket({
    cardId: card.id,
    answers: answers || {},
    queueCards: queue,
  });
  const mistakeCount = Array.isArray(mistakes) ? mistakes.length : 0;
  const draft = [
    `Execution complete (${fillMode || "automated"}).`,
    formReference ? `Form reference: ${formReference}.` : null,
    mistakeCount ? `${mistakeCount} mistake(s) recorded.` : "No mistakes recorded.",
    runId ? `Run id: ${runId}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const polish = await polishJiraCommentDraft({
    draft,
    issueKey,
    summary: card.title || "",
    ticketKey: formReference || issueKey,
    queueCard,
    mandatorySummary: loaded?.text || "",
  });
  const body = String(polish.polished || draft).trim();

  // Always POST a new comment — never overwrite
  const result = await addComment(config, issueKey, body);
  appendJiraAction({
    issueKey,
    action: "execution_comment",
    bodyPreview: body.slice(0, 120),
    ok: Boolean(result.ok),
    httpStatus: result.httpStatus || null,
    conflict: false,
    error: result.error || null,
    appendOnly: true,
    runId: runId || null,
  });
  if (result.ok) {
    await refreshJira({ force: true }).catch(() => {});
  } else {
    console.warn("[coact] execution jira comment failed", result.error);
  }
  return result;
}

// Packaged builds show LiveTrack in the Dock and in Screen Recording.
// `npm start` runs Electron.app — TCC lists "Electron", not LiveTrack. Keep the
// unpackaged name so System Settings matches the Dock / permission prompt.
if (typeof app?.setName === "function" && app.isPackaged) {
  app.setName("LiveTrack");
}

function defaultMainBounds() {
  const { screen } = require("electron");
  const display = screen.getPrimaryDisplay().workArea;
  // Compact floating panel — fits sidebar + chat without dominating the desktop
  const width = 400;
  const height = Math.min(520, Math.max(420, display.height - 80));
  return {
    width,
    height,
    x: display.x + display.width - width - 16,
    y: display.y + display.height - height - 16,
  };
}

async function refreshQueue() {
  migrateLegacyDocumentsCoact();
  await seedSampleCases(documentsRoot);
  let userId = "";
  try {
    userId = os.userInfo().username || "";
  } catch {
    userId = "";
  }
  const loaded = await loadQueueFromDocuments(documentsRoot, {
    userId,
    filterByUser: false,
  });
  documentsRoot = loaded.rootDir;
  queue = loaded.cards;
  await refreshCardRiskCache();
  // NOTE: match hints for browser-agent page picking are intentionally scoped
  // to the single card currently being watched/run (see beginAppWatch /
  // startAppHtmlRun). Do NOT merge hints from every queue card here — that
  // previously made the CDP page-picker latch onto whichever unrelated card's
  // tab happened to already be open (e.g. picking "CloudHelp" while trying to
  // track "New Hire"), since every card's hints were always in scope.
  return loaded;
}

/** Windows already registered as visible on every Space. */
const workspacePinned = new WeakSet();

function pinToAllWorkspaces(win) {
  if (!win || win.isDestroyed() || workspacePinned.has(win)) return;
  // skipTransformProcessType: calling this without it (or calling it on a
  // timer) toggles LSUIElement and the window flickers front/back.
  try {
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    workspacePinned.add(win);
  } catch {
    try {
      win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true });
      workspacePinned.add(win);
    } catch {
      /* ignore */
    }
  }
}

/** Restore always-on-top only if macOS dropped it. Never raise or re-parent. */
function assertAlwaysOnTop(win) {
  if (screenCaptureActive) return;
  if (!win || win.isDestroyed()) return;
  try {
    if (win.isAlwaysOnTop()) return;
  } catch {
    /* fall through and set */
  }
  try {
    win.setAlwaysOnTop(true, "floating");
  } catch {
    try {
      win.setAlwaysOnTop(true);
    } catch {
      /* ignore */
    }
  }
  try {
    win.setFullScreenable(false);
  } catch {
    /* ignore */
  }
}

function pinFloatingWindow(win) {
  if (screenCaptureActive) return;
  if (!win || win.isDestroyed()) return;
  pinToAllWorkspaces(win);
  assertAlwaysOnTop(win);
  try {
    win.moveTop();
  } catch {
    /* ignore */
  }
}

function applyAlwaysOnTop(enabled) {
  if (screenCaptureActive && enabled) return false;
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const on = Boolean(enabled);
  if (on) {
    pinToAllWorkspaces(mainWindow);
    assertAlwaysOnTop(mainWindow);
  } else {
    mainWindow.setAlwaysOnTop(false);
    try {
      workspacePinned.delete(mainWindow);
      mainWindow.setVisibleOnAllWorkspaces(false);
    } catch {
      /* ignore */
    }
  }
  return true;
}

let alwaysOnTopTimer = null;
function startAlwaysOnTopKeepAlive() {
  if (alwaysOnTopTimer) return;
  // Re-assert level only if it dropped. Never call setVisibleOnAllWorkspaces
  // or moveTop here — those make the overlay flicker in front of Chrome.
  alwaysOnTopTimer = setInterval(() => {
    if (app.isQuitting || screenCaptureActive) return;
    if (tailMode) {
      if (tailWindow && !tailWindow.isDestroyed() && tailWindow.isVisible()) {
        assertAlwaysOnTop(tailWindow);
      }
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) return;
    assertAlwaysOnTop(mainWindow);
  }, 5000);
}

function stopAlwaysOnTopKeepAlive() {
  if (!alwaysOnTopTimer) return;
  clearInterval(alwaysOnTopTimer);
  alwaysOnTopTimer = null;
}

function quitLiveActApp() {
  if (app.isQuitting) return;
  app.isQuitting = true;
  stopAlwaysOnTopKeepAlive();
  stopJiraPolling();
  try {
    if (bridge) bridge.close();
  } catch {
    /* ignore */
  }
  try {
    if (pdfViewServer) pdfViewServer.close();
  } catch {
    /* ignore */
  }
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.removeAllListeners("close");
      win.destroy();
    } catch {
      /* ignore */
    }
  }
  // exit is more reliable than quit for panel windows that intercept close
  app.exit(0);
}

function createWindow() {
  const bounds = defaultMainBounds();

  mainWindow = new BrowserWindow({
    ...bounds,
    width: bounds.width,
    height: bounds.height,
    minWidth: bounds.width,
    maxWidth: bounds.width,
    minHeight: bounds.height,
    maxHeight: bounds.height,
    movable: true,
    resizable: false,
    maximizable: false,
    minimizable: true,
    closable: true,
    fullscreenable: false,
    // Frameless + panel = floating overlay above Chrome / other apps
    frame: false,
    title: "LiveTrack",
    backgroundColor: "#ffffff",
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    acceptFirstMouse: true,
    ...(process.platform === "darwin"
      ? {
          type: "panel",
          hiddenInMissionControl: false,
          roundedCorners: true,
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  startAlwaysOnTopKeepAlive();

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    pinFloatingWindow(mainWindow);
    try {
      mainWindow.setFullScreenable(false);
    } catch {
      /* ignore */
    }
    mainWindow.show();
    try {
      mainWindow.focus();
    } catch {
      /* ignore */
    }
    pinFloatingWindow(mainWindow);
    normalBounds = mainWindow.getBounds();
    console.log(
      "[coact] floating",
      mainWindow.isAlwaysOnTop() ? "on-top" : "NOT-on-top",
      `${normalBounds.width}x${normalBounds.height}`
    );
  });

  // Keep chatbot size — ignore OS zoom / green expand
  const lockChatbotSize = () => {
    if (!mainWindow || mainWindow.isDestroyed() || tailMode) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    }
    const target = normalBounds || defaultMainBounds();
    const cur = mainWindow.getBounds();
    if (cur.width !== target.width || cur.height !== target.height) {
      mainWindow.setBounds({
        x: cur.x,
        y: cur.y,
        width: target.width,
        height: target.height,
      });
    }
  };
  mainWindow.on("maximize", lockChatbotSize);
  mainWindow.on("enter-full-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(false);
    lockChatbotSize();
  });
  mainWindow.on("will-resize", (event) => {
    event.preventDefault();
  });

  // Remember position only (size stays fixed)
  const rememberBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed() || tailMode) return;
    const cur = mainWindow.getBounds();
    const size = defaultMainBounds();
    normalBounds = {
      x: cur.x,
      y: cur.y,
      width: size.width,
      height: size.height,
    };
  };
  mainWindow.on("moved", rememberBounds);

  // Yellow (−) / native minimize → floating tail
  let collapsingToTail = false;
  mainWindow.on("minimize", () => {
    if (app.isQuitting || tailMode || collapsingToTail) return;
    collapsingToTail = true;
    try {
      mainWindow.setOpacity(0);
      enterTailMode({ keepBounds: true });
    } catch (err) {
      console.error("[coact] minimize→tail failed", err.message);
      try {
        enterTailMode({ keepBounds: true });
      } catch {
        /* ignore */
      }
    } finally {
      collapsingToTail = false;
    }
  });

  // Red X / native close → quit completely
  mainWindow.on("close", (event) => {
    if (app.isQuitting) return;
    event.preventDefault();
    quitLiveActApp();
  });

  mainWindow.on("blur", () => {
    if (app.isQuitting || tailMode) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Do not raise or re-parent on blur — that fights Chrome for z-order.
    setTimeout(() => {
      if (app.isQuitting || tailMode) return;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      assertAlwaysOnTop(mainWindow);
    }, 80);
  });

  mainWindow.on("show", () => {
    if (tailMode) return;
    pinToAllWorkspaces(mainWindow);
    assertAlwaysOnTop(mainWindow);
  });

  mainWindow.on("focus", () => {
    if (!tailMode) assertAlwaysOnTop(mainWindow);
  });

  // After load, lock size + pin again (panel type sometimes drops level on first paint)
  mainWindow.webContents.once("did-finish-load", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const size = defaultMainBounds();
      const cur = mainWindow.getBounds();
      mainWindow.setBounds({
        x: cur.x,
        y: cur.y,
        width: size.width,
        height: size.height,
      });
      mainWindow.setMinimumSize(size.width, size.height);
      mainWindow.setMaximumSize(size.width, size.height);
      normalBounds = {
        x: cur.x,
        y: cur.y,
        width: size.width,
        height: size.height,
      };
      pinToAllWorkspaces(mainWindow);
      assertAlwaysOnTop(mainWindow);
      try {
        mainWindow.setIgnoreMouseEvents(false);
      } catch {
        /* ignore */
      }
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function tailBounds() {
  // Proportional placement from the user's reference on a 1440×900 MacBook
  // (center at 1325×766). Same relative spot on any inch / resolution / DPI.
  // Window is 120×120 so badge + gold ripples fit; clamped inside workArea
  // so we never sit on the Dock / taskbar / menu bar.
  const { screen } = require("electron");
  const size = 120;
  const edge = 8;
  // Reference: built-in 1440×900, desired circle CENTER at 1325×766
  const REF_W = 1440;
  const REF_H = 900;
  const REF_CX = 1325;
  const REF_CY = 766;
  const nx = REF_CX / REF_W;
  const ny = REF_CY / REF_H;

  let display;
  try {
    const anchor =
      (normalBounds &&
        Number.isFinite(normalBounds.x) &&
        Number.isFinite(normalBounds.y) &&
        normalBounds) ||
      (mainWindow && !mainWindow.isDestroyed() && mainWindow.getBounds()) ||
      null;
    if (anchor) display = screen.getDisplayMatching(anchor);
  } catch {
    /* ignore */
  }
  if (!display) display = screen.getPrimaryDisplay();

  const full = display.bounds;
  const work = display.workArea || full;
  // Map reference center as a fraction of this display's full bounds, then
  // convert to top-left of the 120×120 window.
  const cx = full.x + full.width * nx;
  const cy = full.y + full.height * ny;
  let x = Math.round(cx - size / 2);
  let y = Math.round(cy - size / 2);

  const maxX = work.x + Math.max(0, work.width - size);
  const maxY = work.y + Math.max(0, work.height - size);
  x = Math.min(Math.max(work.x + edge, x), maxX);
  y = Math.min(Math.max(work.y + edge, y), maxY);
  return { width: size, height: size, x, y };
}

function ensureTailWindow() {
  if (tailWindow && !tailWindow.isDestroyed()) return tailWindow;

  const bounds = tailBounds();
  tailWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Shadow draws a rectangular halo on transparent windows — keep circle-only.
    hasShadow: false,
    focusable: true,
    show: false,
    acceptFirstMouse: true,
    backgroundColor: "#00000000",
    ...(process.platform === "darwin"
      ? { type: "panel", roundedCorners: true }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "tail-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  pinFloatingWindow(tailWindow);
  tailWindow.loadFile(path.join(__dirname, "renderer", "tail.html"));

  tailWindow.on("closed", () => {
    tailWindow = null;
  });

  return tailWindow;
}

function enterTailMode(opts = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (tailMode) {
    const existing = ensureTailWindow();
    if (!existing.isVisible()) {
      existing.setBounds(tailBounds());
      existing.showInactive();
      existing.moveTop();
    }
    return;
  }

  // keepBounds: coming from minimize — getBounds() is unreliable while minimized
  if (!opts.keepBounds || !normalBounds) {
    try {
      if (!mainWindow.isMinimized()) {
        normalBounds = mainWindow.getBounds();
      }
    } catch {
      /* ignore */
    }
    if (!normalBounds) normalBounds = defaultMainBounds();
  }
  tailMode = true;

  const tw = ensureTailWindow();
  tw.setBounds(tailBounds());

  try {
    if (mainWindow.isMinimized()) {
      mainWindow.setOpacity(0);
      mainWindow.restore();
    }
    mainWindow.hide();
    mainWindow.setOpacity(1);
  } catch {
    try {
      mainWindow.hide();
    } catch {
      /* ignore */
    }
  }

  const reveal = () => {
    if (!tailMode || !tw || tw.isDestroyed()) return;
    tw.showInactive();
    tw.moveTop();
  };

  if (tw.webContents.isLoading()) {
    tw.webContents.once("did-finish-load", reveal);
  } else {
    reveal();
  }

  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send("tail-mode", true);
  }
}

function exitTailMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!tailMode && mainWindow.isVisible()) return;

  tailMode = false;

  if (tailWindow && !tailWindow.isDestroyed()) {
    tailWindow.hide();
  }

  if (normalBounds) {
    mainWindow.setBounds(normalBounds);
  } else {
    mainWindow.setBounds(defaultMainBounds());
  }

  mainWindow.show();
  applyAlwaysOnTop(true);
  mainWindow.focus();
  mainWindow.webContents.send("tail-mode", false);
}

function updateTailStatus(payload) {
  if (payload && typeof payload === "object") {
    tailStatusState = { ...tailStatusState, ...payload };
  }
  if (tailWindow && !tailWindow.isDestroyed()) {
    tailWindow.webContents.send("tail-status", { ...tailStatusState });
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function trackerAppOnline() {
  try {
    return Boolean(browserAgent.isTracking() || browserAgent.isConnected());
  } catch {
    return false;
  }
}

function publishTrackerStatus(extra = {}) {
  const extensionConnected = Boolean(bridge?.isExtensionConnected());
  const appConnected = trackerAppOnline();
  sendToRenderer("extension-status", {
    connected: extensionConnected || appConnected,
    extensionConnected,
    appConnected,
    via: appConnected ? "app" : extensionConnected ? "extension" : null,
    bridgeUp: true,
    ...extra,
  });
}

function handleAppStep(update) {
  if (!update?.cardId) return;
  recordCardAction(update.cardId, update);
  recordStepTiming(update.cardId, update);
  sendToRenderer("step-update", update);
}

function handleAppRunFinished(result) {
  const cardId = result.cardId;
  sendToRenderer("run-finished", {
    cardId,
    status: result.status,
    reason: result.reason || null,
    failedStepLabel: result.failedStepLabel || null,
  });
  if (result.status === "run_complete" && cardId) {
    finalizeExecutionArtifacts(cardId, { fillMode: "automated" }).catch((err) => {
      console.error("[coact] app fill finalize", err);
    });
  } else if (
    (result.status === "run_failed" || result.status === "run_cancelled") &&
    cardId
  ) {
    finalizeExecutionArtifacts(cardId, {
      fillMode: "automated",
      status: result.status,
    }).catch((err) => {
      console.error("[coact] app fill incomplete", err);
    });
  }
  if (activeRun?.cardId === cardId && activeRun?.mode === "app") {
    activeRun = null;
  }
}

async function startAppHtmlRun(card, sop, options = {}) {
  const htmlUrl = webFormUrl(card, sop);
  if (htmlUrl) {
    const opened = await browserAgent.openOrFocus(htmlUrl);
    if (!opened?.ok) return opened;
  } else {
    await browserAgent.connect({ launch: true });
  }

  const startIndex = Math.max(
    0,
    Math.min(Number(options?.startIndex) || 0, sop.steps.length),
  );
  const completedStepIds = Array.isArray(options?.completedStepIds)
    ? options.completedStepIds
    : [];

  clearCardActions(card.id);
  clearCardMistakes(card.id);
  clearCardStepTiming(card.id);
  clearCardRunStarted(card.id);
  finalizedAt.delete(card.id);
  activeRun = { cardId: card.id, mode: "app" };
  activeWatch = { cardId: card.id, mode: "app" };
  markCardRunStarted(card.id);
  startCdpUrlPoll();
  publishTrackerStatus();

  setImmediate(() => {
    browserAgent
      .runSop({
        cardId: card.id,
        sop,
        data: mergeRunData(card.data, options?.dataOverrides),
        startIndex,
        completedStepIds,
        agentApprovedValues: options?.agentApprovedValues || {},
        onStep: handleAppStep,
        onFinished: handleAppRunFinished,
      })
      .catch((err) => {
        handleAppRunFinished({
          cardId: card.id,
          status: "run_failed",
          reason: err?.message || String(err),
        });
      });
  });

  return {
    ok: true,
    mode: "app",
    startIndex,
    steps: sop.steps.map((step) => stepForUi(step, "pending")),
  };
}

let lastCdpUrl = "";
let lastCdpTitle = "";
let pendingAppWatch = null;
let cdpKeepaliveTimer = null;

function startCdpUrlPoll() {
  browserAgent.startUrlPoll((meta) => {
    const url = String(meta?.url || "");
    const title = String(meta?.title || "");
    if (/^(chrome|edge|about|devtools):/i.test(url)) {
      if (!title) return;
    } else if (!url && !title) {
      return;
    }
    const publishUrl = /^(https?:|file:)/i.test(url) ? url : "";
    const changed = publishUrl !== lastCdpUrl || title !== lastCdpTitle;
    if (publishUrl) lastCdpUrl = publishUrl;
    lastCdpTitle = title;
    if (publishUrl) lastExtensionTabUrl = publishUrl;
    publishTrackerStatus({
      tabUrl: publishUrl || null,
      tabTitle: title,
      activated: changed,
    });
  });
}

function beginAppWatch(card, sop) {
  pendingAppWatch = null;
  const htmlUrl = webFormUrl(card, sop);
  if (htmlUrl) browserAgent.setPreferredUrl(htmlUrl);
  const hints = [
    htmlUrl,
    card.formUrl,
    sop?.formUrl,
    ...(Array.isArray(card.formMatch) ? card.formMatch : []),
    ...(Array.isArray(sop?.formMatch) ? sop.formMatch : []),
  ].filter(Boolean);
  browserAgent.setMatchHints(hints);
  activeWatch = { cardId: card.id, mode: "app" };
  browserAgent.watchSop({
    cardId: card.id,
    sop,
    data: card.data || {},
    onStep: handleAppStep,
  });
  startCdpUrlPoll();
  publishTrackerStatus();
}

function startCdpKeepalive() {
  startCdpUrlPoll();
}

/** Stable fingerprint so unchanged polls skip renderer / bridge thrash */
let lastJiraPublishFp = "";
function jiraSnapshotFingerprint(snap, recentActions) {
  const issues = (snap?.issues || []).map((i) => ({
    key: i.key,
    status: i.status,
    done: i.done,
    sopStage: i.sopStage,
    urgencyScore: i.urgencyScore,
    linkedCardId: i.linkedCardId,
    updated: i.updated || i.updatedAt || null,
  }));
  const recent = (recentActions || []).map((a) => ({
    t: a.at || a.ts || a.time,
    k: a.issueKey,
    a: a.action,
  }));
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        ok: Boolean(snap?.ok),
        configured: snap?.configured,
        error: snap?.error || "",
        staleCount: snap?.staleCount || 0,
        issues,
        recent,
      })
    )
    .digest("hex");
}

function publishJiraSnapshot({ force = false } = {}) {
  const snap = jiraSnapshot || { ok: false, issues: [], staleCount: 0 };
  const recent = recentJiraActions(5);
  const fp = jiraSnapshotFingerprint(snap, recent);
  if (!force && fp === lastJiraPublishFp) return false;
  lastJiraPublishFp = fp;
  sendToRenderer("jira-updated", {
    ...snap,
    recentActions: recent,
  });
  try {
    if (bridge?.sendJiraSnapshot) {
      bridge.sendJiraSnapshot(snap);
    }
  } catch (err) {
    console.error("[coact] jira snapshot bridge", err);
  }
  return true;
}

async function refreshJira({ force = false } = {}) {
  // Coalesce concurrent polls; force waits for in-flight then runs a fresh pull
  if (jiraRefreshPromise) {
    if (!force) return jiraRefreshPromise;
    try {
      await jiraRefreshPromise;
    } catch {
      /* ignore prior failure */
    }
  }

  const run = async () => {
    const config = getJiraConfig();
    if (!isJiraConfigured(config)) {
      jiraSnapshot = {
        ok: false,
        configured: false,
        issues: [],
        staleCount: 0,
        sopStages: config.jiraStatusMap || null,
        error: "Configure Jira in Settings (base URL, email, API token).",
      };
      publishJiraSnapshot();
      return jiraSnapshot;
    }
    jiraPollInFlight = true;
    try {
      let result = await searchIssues(config, { queueCards: queue });
      // Always pull queue-linked keys so Done sync works even if JQL hid them
      result = await ensureLinkedIssues(config, result, queue);
      jiraSnapshot = { ...result, configured: true };
      const synced = await syncQueueCardsFromJira(jiraSnapshot.issues || []);
      if (synced > 0) {
        refreshQueue();
        sendToRenderer("queue-updated", ipcSafe({
          queue: queue.map(enrichCard),
          publishedAt: Date.now(),
          rootDir: documentsRoot,
          jiraSync: true,
        }));
      }
      publishJiraSnapshot();
      return jiraSnapshot;
    } catch (err) {
      const raw = String(err?.message || err || "Could not refresh Jira");
      const error =
        /Unexpected token\s+'<'/.test(raw) || /is not valid JSON/i.test(raw)
          ? "Jira returned HTML instead of JSON. Set Site URL to https://your-domain.atlassian.net or http://127.0.0.1:4176 (local mock), not a login, /browse, or dashboard page."
          : raw;
      jiraSnapshot = {
        ok: false,
        configured: true,
        issues: [],
        staleCount: 0,
        error,
      };
      publishJiraSnapshot({ force: true });
      return jiraSnapshot;
    } finally {
      jiraPollInFlight = false;
    }
  };

  jiraRefreshPromise = run().finally(() => {
    jiraRefreshPromise = null;
  });
  return jiraRefreshPromise;
}

/**
 * When Jira marks a story Done/Closed/…, mark the linked queue card done (and reverse on reopen).
 */
async function syncQueueCardsFromJira(issues) {
  const field = getJiraConfig().jiraCardKeyField || "jiraKey";
  let changed = 0;
  for (const issue of issues || []) {
    let cardId = issue.linkedCardId || "";
    if (!cardId && issue.key) {
      cardId = findLinkedCardId(issue.key, queue, field) || "";
    }
    if (!cardId) continue;
    const done =
      issue.done === true || isJiraDoneStatus(issue.status, issue.sopStage);
    const desired = done ? "done" : "queued";
    try {
      const res = await updateQueueCardStatus(cardId, desired, queue);
      if (res?.changed) {
        changed += 1;
        console.log(
          `[coact] jira sync ${issue.key} → card ${cardId} status=${desired}`
        );
        appendJiraAction({
          issueKey: issue.key,
          action: "status_sync",
          bodyPreview: `Queue card ${cardId} → ${desired}`,
          ok: true,
          conflict: false,
          cardId,
          status: desired,
        });
      }
    } catch (err) {
      console.warn("[coact] jira status sync", err?.message || err);
    }
  }
  return changed;
}

function stopJiraPolling() {
  if (jiraPollTimer) {
    clearTimeout(jiraPollTimer);
    jiraPollTimer = null;
  }
}

function jiraPollDelayMs() {
  if (jiraPaneActive) return JIRA_ACTIVE_POLL_MS;
  const minutes = Math.max(1, Number(getJiraConfig().jiraPollMinutes) || 5);
  return minutes * 60 * 1000;
}

function resolveJiraMockServerPath() {
  const candidates = [
    path.join(__dirname, "..", "jira-mock", "server.js"),
    path.join(process.resourcesPath || "", "jira-mock", "server.js"),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || "";
}

function isLocalDemoJiraUrl(baseUrl) {
  try {
    const url = new URL(String(baseUrl || "").trim());
    const host = url.hostname;
    if (host !== "127.0.0.1" && host !== "localhost") return false;
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return port === 4176;
  } catch {
    return false;
  }
}

async function ensureLocalJiraMock(config = getJiraConfig()) {
  if (!isLocalDemoJiraUrl(config?.jiraBaseUrl)) return { ok: true, skipped: true };
  const mockPath = resolveJiraMockServerPath();
  if (!mockPath) return { ok: false, error: "jira_mock_missing" };
  const { startLocalJiraMock } = require(mockPath);
  return startLocalJiraMock(4176);
}

function scheduleNextJiraPoll() {
  stopJiraPolling();
  jiraPollTimer = setTimeout(() => {
    refreshJira()
      .catch((err) => console.error("[coact] jira poll", err))
      .finally(() => scheduleNextJiraPoll());
  }, jiraPollDelayMs());
}

async function startJiraPolling() {
  stopJiraPolling();
  try {
    await ensureLocalJiraMock();
  } catch (err) {
    console.warn("[livetrack] jira mock", err?.message || err);
  }
  refreshJira().catch((err) => console.error("[coact] jira initial", err));
  scheduleNextJiraPoll();
}

function setJiraPaneActive(active) {
  const next = Boolean(active);
  const was = jiraPaneActive;
  jiraPaneActive = next;
  if (next !== was) {
    scheduleNextJiraPoll();
  }
}

function momSnapshot() {
  const settings = getAppSettings();
  const marks = mom.loadMarks();
  const nowMs = Date.now();
  const outputs = mom.loadDayOutputs();
  const events = mom.mergeEventsWithOutputs(outlookEvents, outputs, {
    marks,
    session: momSession,
    nowMs,
  });
  const greet = mom.greetingName({
    givenName: outlook.getOutlookConfig().accountGivenName,
    greetingSetting: settings.momGreetingName,
  });
  return {
    ok: outlookMeta.ok,
    connected: outlook.isConnected(),
    configured: outlook.isConfigured(),
    accountName: settings.outlookAccountName || "",
    error: outlookMeta.error || "",
    greetingName: greet,
    events,
    session: momSession
      ? {
          id: momSession.id,
          eventId: momSession.eventId,
          recording: Boolean(momSession.recording),
          refining: Boolean(momSession.refining),
          refined: Boolean(momSession.refined),
          approved: Boolean(momSession.approved),
          pendingApproval: Boolean(momSession.pendingApproval),
          startedAt: momSession.startedAt,
          transcript: momSession.transcript || "",
          turns: Array.isArray(momSession.turns) ? momSession.turns : [],
          refinedText: momSession.refinedText || "",
          meeting: momSession.meeting || null,
        }
      : null,
    outputs,
    fetchedAt: outlookMeta.fetchedAt || "",
  };
}

function publishMomSnapshot() {
  sendToRenderer("mom-updated", ipcSafe(momSnapshot()));
}

function findMomEvent(eventId) {
  const id = String(eventId || "").trim();
  if (!id) return null;
  return outlookEvents.find((event) => event.id === id) || momSession?.meeting || null;
}

function raiseLiveTrackWindow() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (tailMode) exitTailMode();
    if (!mainWindow.isVisible()) mainWindow.show();
    applyAlwaysOnTop(true);
    mainWindow.moveTop();
    mainWindow.focus();
  } catch {
    /* ignore */
  }
}

async function refreshMomCalendar() {
  if (!outlook.isConnected()) {
    outlookEvents = [];
    outlookMeta = {
      ok: false,
      connected: false,
      error: outlook.isConfigured()
        ? "Connect Outlook in Settings."
        : "Add the Azure client ID in Settings, then connect Outlook.",
      fetchedAt: new Date().toISOString(),
    };
    publishMomSnapshot();
    return outlookMeta;
  }
  const cal = await outlook.fetchCalendarView();
  if (!cal.ok) {
    outlookMeta = {
      ok: false,
      connected: true,
      error: cal.error || "Could not load Outlook calendar.",
      fetchedAt: new Date().toISOString(),
    };
    publishMomSnapshot();
    return outlookMeta;
  }
  outlookEvents = cal.events || [];
  outlookMeta = { ok: true, connected: true, error: "", fetchedAt: new Date().toISOString() };
  publishMomSnapshot();
  tickMomAlerts();
  return outlookMeta;
}

async function tickMomAlerts() {
  if (momAlertTickInFlight) return;
  momAlertTickInFlight = true;
  try {
    const settings = getAppSettings();
    const nowMs = Date.now();
    const greet = mom.greetingName({
      givenName: outlook.getOutlookConfig().accountGivenName,
      greetingSetting: settings.momGreetingName,
    });
    let voiceSent = false;
    for (const event of outlookEvents) {
      if (
        !voiceSent &&
        mom.shouldAlertSoon(event, {
          alreadyAlerted: momPreAlertedIds.has(event.id),
          nowMs,
        })
      ) {
        momPreAlertedIds.add(event.id);
        voiceSent = true;
        sendToRenderer(
          "mom-alert",
          ipcSafe({
            kind: "soon",
            event,
            greeting: mom.greetingText(greet, event.subject, { kind: "soon" }),
          }),
        );
      }
      if (
        !voiceSent &&
        mom.shouldAlertStart(event, {
          alreadyAlerted: momAlertedIds.has(event.id),
          nowMs,
        })
      ) {
        momAlertedIds.add(event.id);
        voiceSent = true;
        sendToRenderer(
          "mom-alert",
          ipcSafe({
            kind: "start",
            event,
            greeting: mom.greetingText(greet, event.subject, { kind: "start" }),
          }),
        );
      }
      const sessionMatches = momSession?.recording && momSession.eventId === event.id;
      if (
        sessionMatches &&
        mom.shouldAutoRefine(momSession, event, nowMs) &&
        !momAutoStopIds.has(event.id)
      ) {
        momAutoStopIds.add(event.id);
        sendToRenderer("mom-should-stop", ipcSafe({ eventId: event.id, reason: "ended" }));
      }
    }

    if (!voiceSent) {
      try {
        const overdue = await actionsStore.overduePending({ user: localUsername() });
        for (const action of overdue || []) {
          const id = String(action?.id || "").trim();
          if (!id || actionAlertedIds.has(id)) continue;
          actionAlertedIds.add(id);
          sendToRenderer(
            "mom-alert",
            ipcSafe({
              kind: "action_overdue",
              action,
              greeting: mom.actionOverdueGreetingText(greet, action.title),
            }),
          );
          break;
        }
      } catch (err) {
        console.error("[livetrack] action overdue alerts", err);
      }
    }

    publishMomSnapshot();
  } finally {
    momAlertTickInFlight = false;
  }
}

function startMomPolling() {
  stopMomPolling();
  refreshMomCalendar().catch((err) => console.error("[livetrack] outlook initial", err));
  outlookPollTimer = setInterval(() => {
    refreshMomCalendar().catch((err) => console.error("[livetrack] outlook poll", err));
  }, OUTLOOK_POLL_MS);
  momTickTimer = setInterval(() => {
    try {
      tickMomAlerts();
    } catch (err) {
      console.error("[livetrack] mom tick", err);
    }
  }, MOM_TICK_MS);
}

function stopMomPolling() {
  if (outlookPollTimer) {
    clearInterval(outlookPollTimer);
    outlookPollTimer = null;
  }
  if (momTickTimer) {
    clearInterval(momTickTimer);
    momTickTimer = null;
  }
}

async function refineMomSession({ transcript, source, turns, draftText } = {}) {
  if (momRefineInFlight) return { ok: false, error: "Already refining this meeting." };
  const meeting = momSession?.meeting || null;
  const operatorName = mom.greetingName({
    givenName: outlook.getOutlookConfig().accountGivenName,
    greetingSetting: getAppSettings().momGreetingName,
  });
  const editedDraft = String(draftText || "").trim();
  let text = editedDraft;
  if (!text) {
    const incoming = Array.isArray(turns) && turns.length
      ? turns
      : momSpeakers.parseTurnsFromTranscript(transcript || momSession?.transcript || "");
    const mapped = momSpeakers.mapSpeakerTurns(incoming, { operatorName, meeting });
    text = momSpeakers.formatTurns(mapped, { operatorName, meeting });
    if (momSession) {
      momSession.transcript = text;
      if (mapped.length) {
        momSession.turns = momSpeakers.mergeAdjacentTurns(mapped, { operatorName, meeting });
      }
    }
  }
  if (!text) return { ok: false, error: "No transcript to refine. Start MOM during the call." };
  if (momSession) {
    momSession.recording = false;
    momSession.refining = true;
    momSession.approved = false;
    momSession.pendingApproval = false;
  }
  publishMomSnapshot();
  momRefineInFlight = true;
  try {
    const result = await refineMeetingMinutes({ transcript: text, meeting });
    if (!result.ok) {
      if (momSession) momSession.refining = false;
      publishMomSnapshot();
      return result;
    }
    if (momSession) {
      momSession.refining = false;
      momSession.refined = true;
      momSession.refinedText = result.text;
      momSession.approved = false;
      momSession.pendingApproval = true;
      momSession.refineSource = source || "manual";
    }
    // Draft only — day temp memory + Actions wait for explicit approve.
    sendToRenderer(
      "mom-refined",
      ipcSafe({
        text: result.text,
        meeting,
        source,
        pendingApproval: true,
        actionsImported: 0,
      }),
    );
    publishMomSnapshot();
    return {
      ok: true,
      text: result.text,
      meeting,
      pendingApproval: true,
      actionsImported: 0,
    };
  } finally {
    momRefineInFlight = false;
    if (momSession) momSession.refining = false;
  }
}

async function approveMomSession({ text } = {}) {
  if (!momSession) return { ok: false, error: "No MOM session to approve." };
  if (momSession.approved) {
    return {
      ok: true,
      alreadyApproved: true,
      text: momSession.refinedText || "",
      meeting: momSession.meeting || null,
      actionsImported: 0,
    };
  }
  const refined = String(text || momSession.refinedText || "").trim();
  if (!refined) return { ok: false, error: "No minutes to approve." };
  const meeting = momSession.meeting || null;
  const transcript = momSession.transcript || "";
  const source = momSession.refineSource || "manual";
  momSession.refinedText = refined;
  momSession.refined = true;
  momSession.pendingApproval = false;
  momSession.approved = true;
  try {
    mom.saveMomArtifact({
      meeting,
      transcript,
      turns: momSession.turns || [],
      refined,
      source,
      user: localUsername(),
    });
    mom.upsertDayOutput({
      eventId: momSession.eventId || meeting?.id || "adhoc",
      subject: meeting?.subject || "Ad-hoc meeting",
      meeting,
      transcript,
      refined,
      user: localUsername(),
    });
  } catch (err) {
    console.warn("[livetrack] mom save", err?.message || err);
  }
  let actionsImport = { imported: 0, skipped: 0 };
  try {
    actionsImport = await actionsStore.importFromMomRefined({
      refinedText: refined,
      meeting,
      user: localUsername(),
      dueKind: "week",
    });
    if (actionsImport.imported > 0) {
      sendToRenderer(
        "actions-updated",
        ipcSafe({
          reason: "mom",
          imported: actionsImport.imported,
          pending: await actionsStore.pendingCount({ user: localUsername() }),
        }),
      );
    }
  } catch (err) {
    console.warn("[livetrack] mom actions import", err?.message || err);
  }
  sendToRenderer(
    "mom-approved",
    ipcSafe({
      text: refined,
      meeting,
      actionsImported: actionsImport.imported || 0,
    }),
  );
  publishMomSnapshot();
  return {
    ok: true,
    text: refined,
    meeting,
    actionsImported: actionsImport.imported || 0,
  };
}

/** UI/coach steps must keep valueFrom / allowedValues / mandatory so Approve can resolve. */
function stepForUi(step, status = "pending") {
  if (!step) return null;
  return {
    id: step.id,
    label: step.label,
    action: step.action,
    status,
    valueFrom: step.valueFrom ?? null,
    value: step.value ?? null,
    allowedValues: Array.isArray(step.allowedValues)
      ? step.allowedValues
      : undefined,
    mandatory: Boolean(step.mandatory),
    optional: Boolean(step.optional),
  };
}

function dummyStepsFor(card) {
  const sop = sops[card.sopId];
  if (sop?.steps?.length) {
    return sop.steps.map((step) => stepForUi(step, "pending"));
  }
  return [
    {
      id: "open-form",
      label: "Confirm form page is open in Chrome",
      action: "check",
      status: "pending",
    },
    {
      id: "fill-fields",
      label: "Fill mapped form fields",
      action: "fill",
      status: "pending",
    },
    {
      id: "review",
      label: "Highlight submit for human review",
      action: "highlight",
      status: "pending",
    },
  ];
}

function enrichCard(card) {
  const sop = sops[card.sopId];
  const steps = dummyStepsFor(card);
  const formMatch = [
    ...(Array.isArray(card.formMatch) ? card.formMatch : []),
    ...(Array.isArray(sop?.formMatch) ? sop.formMatch : []),
  ];
  // Include case data so the quest coach can Approve-fill (Fill with: …).
  // Omit document paths from the renderer payload.
  return {
    id: card.id,
    title: card.title,
    status: card.status || "queued",
    lob: card.lob || "TCOO",
    sopName: sop ? sop.name : "Form workflow",
    stepCount: steps.length,
    steps,
    data: card.data && typeof card.data === "object" ? { ...card.data } : {},
    formUrl: (() => {
      const cardUrl = card.formUrl || null;
      const sopUrl = sop?.formUrl || null;
      const sopWeb = sopUrl && !urlLooksLikePdf(sopUrl) ? sopUrl : null;
      const cardWeb = cardUrl && !urlLooksLikePdf(cardUrl) ? cardUrl : null;
      if (sop?.targetType === "web") return sopWeb || cardWeb || sopUrl || cardUrl;
      return cardWeb || sopWeb || cardUrl || sopUrl;
    })(),
    pdfPath: card.pdfPath || sop?.pdfPath || null,
    formMatch,
    // Digital Employee Agent (DPIP future phase) — opt-in per SOP, and only
    // ever offered to the user as a one-click action (never triggered
    // automatically) so the already-sensitive run pipeline keeps requiring
    // an explicit human action to start.
    autonomous: Boolean(sop?.autonomous),
    // Failure Prediction Agent — historical mistake-rate flag, read from the
    // last process-intelligence report (see process-intelligence.js). Null
    // until a report has been generated (dashboard runs this on startup).
    risk: cardRiskById.get(String(card.id)) || null,
  };
}

function browserTargetFor(card, sop) {
  return {
    formUrl: card.formUrl || sop?.formUrl || null,
    formMatch: [
      ...(Array.isArray(card.formMatch) ? card.formMatch : []),
      ...(Array.isArray(sop?.formMatch) ? sop.formMatch : []),
      "new-hire.html",
      "17322/demo/new-hire",
      "4173/new-hire",
    ],
  };
}

function urlLooksLikePdf(url) {
  const u = String(url || "").toLowerCase();
  return /\.pdf(\?|#|$)/.test(u) || /\/pdf\//.test(u);
}

function webFormUrl(card, sop) {
  const raw = [card?.formUrl, sop?.formUrl].map((u) => String(u || "").trim());
  for (const u of raw) {
    if (u && !urlLooksLikePdf(u)) return u;
  }
  if (String(card?.id || sop?.id || "").includes("new-hire")) {
    return "http://127.0.0.1:17322/demo/new-hire.html";
  }
  return null;
}

async function ensureWebFormTab(card, sop) {
  const url = webFormUrl(card, sop);
  if (!url) return false;
  if (htmlFormTabOpen(card, sop)) return true;
  if (!bridge?.isExtensionConnected()) return false;
  bridge.sendOpenUrl({
    url,
    cardId: card.id,
    matchIncludes: "new-hire.html",
  });
  await sleep(900);
  return true;
}

/** HTML form tab is focused — fill in Chrome instead of the PDF file. */
function htmlFormTabOpen(card, sop) {
  const target = browserTargetFor(card, sop);
  if (bridge?.isExtensionConnected()) {
    const match = bridge.matchingTab?.(target);
    if (match?.tabUrl && !urlLooksLikePdf(match.tabUrl)) return true;
  }
  const url = String(lastExtensionTabUrl || lastCdpUrl || "");
  if (!url || urlLooksLikePdf(url)) return false;
  const hay = url.toLowerCase();
  return (target.formMatch || []).some((hint) => {
    const h = String(hint || "").toLowerCase().trim();
    return h && hay.includes(h);
  });
}

async function handleNeedsRepair(update) {
  if (!bridge || !update.repairId) return;

  refreshQueue();
  const card = queue.find((c) => c.id === update.cardId);
  const sop = card ? sops[card.sopId] : null;
  const stepFromSop = sop?.steps?.find((s) => s.id === update.stepId);
  const step = stepFromSop || update.step || { id: update.stepId };

  let snippet = update.snippet || "";
  if (!snippet && bridge.isExtensionConnected()) {
    try {
      const requestId = `nr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const snip = await bridge.requestSnippet(
        requestId,
        update.clientId || activeRun?.clientId || activeWatch?.clientId,
      );
      if (snip?.ok && snip.text) snippet = snip.text;
    } catch {
      /* optional */
    }
  }

  const stepContext = (sop?.steps || [])
    .map((s) => `- ${s.id}: ${s.label} (${s.action})`)
    .join("\n");

  const plan = await repairFailedStep({
    step,
    error: update.error || update.reason || "",
    stepContext,
    snippet,
    questData: card?.data || {},
  });

  bridge.sendRepairPlan({
    repairId: update.repairId,
    action: plan.action || (plan.broadMatch ? "retry_broad" : "apply_value"),
    broadMatch: Boolean(plan.broadMatch),
    valueOverride: plan.valueOverride,
    stepPatch: plan.stepPatch,
    altFindByText: plan.altFindByText,
    reason: plan.reason || "AI repair",
    ok: plan.ok !== false,
    clientId: update.clientId || activeRun?.clientId || activeWatch?.clientId,
    target: card && sop ? browserTargetFor(card, sop) : undefined,
  });
}

async function handleValueCheck(update) {
  if (!bridge || !update.checkId) return;

  let result;
  try {
    result = await judgeValueMatch({
      expected: update.expected,
      actual: update.actual,
      stepLabel: update.stepLabel || update.step?.label || null,
      valueFrom: update.valueFrom || update.step?.valueFrom || null,
    });
  } catch (err) {
    result = {
      ok: false,
      match: false,
      reason: err?.message || "Value check failed",
    };
  }

  bridge.sendValueCheckResult({
    checkId: update.checkId,
    match: Boolean(result.match),
    reason:
      result.reason || (result.match ? "Values match" : "Values do not match"),
    ok: result.ok !== false,
    clientId: update.clientId || activeRun?.clientId || activeWatch?.clientId,
  });
}

function allowAskLiveTrackMicrophone() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true);
  });
  ses.setPermissionCheckHandler(() => true);
  if (typeof ses.setDisplayMediaRequestHandler === "function") {
    ses.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 1, height: 1 },
        });
        const source = sources[0];
        if (!source) {
          callback({});
          return;
        }
        callback({ video: source, audio: "loopback" });
      } catch {
        callback({});
      }
    });
  }
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  nativeTheme.themeSource = "light";
  allowAskLiveTrackMicrophone();
  await reloadSops();
  await refreshQueue();
  watchSopsDir();

  try {
    const { screen } = require("electron");
    screen.on("display-metrics-changed", () => {
      if (!tailMode || !tailWindow || tailWindow.isDestroyed()) return;
      try {
        tailWindow.setBounds(tailBounds());
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }

  pdfViewServer = createPdfViewServer();
  pdfViewServer.start()
    .then(() => setCaptureRecording({ action: "stop" }).catch(() => {}))
    .catch((err) => {
      console.error("[coact] pdf view server failed", err.message);
      pdfViewServer = null;
      setCaptureRecording({ action: "stop" }).catch(() => {});
    });

  try {
    bridge = createBridge({
      onCaptureEvent(event) {
        try {
          pdfViewServer?.capture?.ingest(event);
        } catch {
          /* ignore */
        }
      },
      onReloadQueue() {
        return publishQueueToRenderer();
      },
      onListening(info) {
        publishTrackerStatus({
          bridgeHost: info?.host || null,
          bridgePort: info?.port || 17321,
          bridgeWsUrl: info?.localWsUrl || null,
          bridgeLanWsUrl: info?.wsUrl || null,
        });
      },
      onError(err) {
        const code = err?.code || "";
        const bridgeError =
          code === "EADDRINUSE"
            ? `Port 17321 in use — quit other LiveTrack windows, then restart`
            : code || err?.message || "bridge_error";
        const appConnected = browserAgent.isConnected();
        sendToRenderer("extension-status", {
          connected: appConnected,
          extensionConnected: false,
          appConnected,
          via: appConnected ? "app" : null,
          bridgeUp: false,
          bridgeError,
        });
      },
      onExtensionStatus(status) {
        const connectedNow = Boolean(status?.connected);
        const payload = {
          connected: connectedNow || trackerAppOnline(),
          extensionConnected: connectedNow,
          appConnected: trackerAppOnline(),
          via: trackerAppOnline()
            ? "app"
            : connectedNow
              ? "extension"
              : null,
          bridgeUp: true,
        };
        if (status?.clients != null) payload.extensionClients = status.clients;
        if (status?.clientId) payload.clientId = status.clientId;
        if (status?.reconnected) payload.reconnected = true;
        if (Object.prototype.hasOwnProperty.call(status || {}, "tabUrl")) {
          if (status.tabUrl) {
            payload.tabUrl = status.tabUrl;
            payload.tabTitle = status.tabTitle || null;
            lastExtensionTabUrl = status.tabUrl;
            browserAgent.setPreferredUrl(status.tabUrl);
          } else if (lastCdpUrl && browserAgent.isConnected()) {
            payload.tabUrl = lastCdpUrl;
          } else {
            payload.tabUrl = status.tabUrl || null;
            payload.tabTitle = status.tabTitle || null;
          }
          if (status.activated) payload.activated = true;
        }

        if (!connectedNow && activeRun?.mode !== "app") {
          activeRun = null;
          if (activeWatch?.cardId && activeWatch.mode !== "app") {
            activeWatch = { cardId: activeWatch.cardId, clientId: null };
          }
        } else if (status?.clientId) {
          if (activeWatch?.cardId && activeWatch.clientId !== status.clientId) {
            activeWatch = {
              cardId: activeWatch.cardId,
              clientId: status.clientId,
            };
          }
          if (activeRun?.clientId && activeRun.clientId !== status.clientId && activeRun.mode !== "app") {
            activeRun = null;
          }
        }

        sendToRenderer("extension-status", payload);
        if (connectedNow && jiraSnapshot && bridge?.sendJiraSnapshot) {
          try {
            bridge.sendJiraSnapshot(jiraSnapshot);
          } catch {
            /* ignore */
          }
        }
      },
      onStepUpdate(update) {
        const watched =
          (activeRun &&
            update.cardId === activeRun.cardId &&
            update.clientId === activeRun.clientId) ||
          (activeWatch &&
            update.cardId === activeWatch.cardId &&
            update.clientId === activeWatch.clientId) ||
          update.status === "reasoning" ||
          update.status === "mismatch" ||
          update.status === "value_check" ||
          update.status === "needs_repair" ||
          Boolean(update.reason) ||
          // Background tabs keep reporting while another form is focused
          (update.cardId && update.stepId);

        if (!watched) return;

        recordCardMistake(update.cardId, update);
        recordStepTiming(update.cardId, update);
        recordCardAction(update.cardId, update);

        if (update.cardId && (update.pageUrl || update.formReference)) {
          const prev = cardPageContext.get(update.cardId) || {};
          cardPageContext.set(update.cardId, {
            pageUrl: update.pageUrl || prev.pageUrl || "",
            formReference: update.formReference || prev.formReference || "",
          });
        }

        if (
          update.status === "done" &&
          update.cardId &&
          allGatingActionsCaptured(update.cardId)
        ) {
          const mode =
            activeRun?.cardId === update.cardId ? "automated" : "manual";
          const cardId = update.cardId;
          // Brief delay so a mismatch reported just before "done" is flushed into Excel
          setTimeout(() => {
            finalizeExecutionArtifacts(cardId, { fillMode: mode }).catch(
              (err) => {
                console.error("[coact] finalize on last step", err);
              },
            );
          }, 450);
        }

        if (update.status === "needs_repair" && update.repairId) {
          handleNeedsRepair(update).catch((err) => {
            console.error("[coact] needs_repair", err);
            bridge?.sendRepairPlan({
              repairId: update.repairId,
              action: "retry_broad",
              broadMatch: true,
              reason: err?.message || "Repair failed",
              clientId:
                update.clientId || activeRun?.clientId || activeWatch?.clientId,
            });
          });
        }

        if (update.status === "value_check" && update.checkId) {
          handleValueCheck(update).catch((err) => {
            console.error("[coact] value_check", err);
            bridge?.sendValueCheckResult({
              checkId: update.checkId,
              match: false,
              reason: err?.message || "Value check failed",
              ok: false,
              clientId:
                update.clientId || activeRun?.clientId || activeWatch?.clientId,
            });
          });
        }

        sendToRenderer("step-update", {
          cardId: update.cardId,
          stepId: update.stepId,
          status: update.status,
          reason: update.reason || null,
          error: update.error || null,
          source: update.source || null,
          expected: update.expected || null,
          actual: update.actual || null,
          suggestedValue: update.suggestedValue || update.expected || null,
          key: update.key || null,
          label: update.label || null,
          valueMatched: update.valueMatched === true,
        });

        if (
          update.stepId &&
          activeWatch &&
          update.cardId === activeWatch.cardId
        ) {
          updateTailStatus({
            ok: update.status === "done",
            bad: update.status === "failed",
          });
        }
      },
      onRunFinished(result) {
        if (
          activeRun &&
          result.cardId === activeRun.cardId &&
          (!activeRun.clientId ||
            !result.clientId ||
            result.clientId === activeRun.clientId)
        ) {
          const finishedCardId = result.cardId;
          activeRun = null;
          sendToRenderer("run-finished", {
            cardId: result.cardId,
            status: result.status,
            failedStepLabel: result.failedStepLabel || null,
            reason: result.reason || null,
          });
          if (result.status === "run_complete") {
            finalizeExecutionArtifacts(finishedCardId, {
              fillMode: "automated",
            }).catch((err) => {
              console.error("[coact] finalize execution", err);
            });
          } else if (
            result.status === "run_failed" ||
            result.status === "run_cancelled"
          ) {
            finalizeExecutionArtifacts(finishedCardId, {
              fillMode: "automated",
              status: result.status,
            }).catch((err) => {
              console.error("[coact] finalize incomplete execution", err);
            });
          }
        }
      },
    });
  } catch (err) {
    console.error("[coact] bridge failed to start", err);
    bridge = null;
  }

  // Prefer accessory policy (above) over dock-hide dance for floating
  createWindow();
  startJiraPolling();
  startMomPolling();
  browserAgent.connect({ launch: false }).then((res) => {
    if (res.ok) startCdpUrlPoll();
    publishTrackerStatus();
  });
  publishTrackerStatus();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow && !mainWindow.isDestroyed()) {
      if (tailMode) {
        try {
          exitTailMode();
        } catch {
          /* ignore */
        }
      }
      mainWindow.show();
      pinFloatingWindow(mainWindow);
    }
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopAlwaysOnTopKeepAlive();
  stopJiraPolling();
  if (cdpKeepaliveTimer) {
    clearInterval(cdpKeepaliveTimer);
    cdpKeepaliveTimer = null;
  }
  browserAgent.disconnect();
});

app.on("window-all-closed", () => {
  if (bridge) bridge.close();
  if (pdfViewServer) pdfViewServer.close();
  app.quit();
});

ipcMain.handle("get-bootstrap", async () => {
  await reloadSops();
  await refreshQueue();
  const ai = getOpenAiConfig();
  return ipcSafe({
    queue: queue.map(enrichCard),
    extensionConnected: bridge ? bridge.isExtensionConnected() : false,
    appConnected: trackerAppOnline(),
    openai: { hasKey: ai.hasKey, model: ai.model },
    jira: jiraSnapshot,
    mom: momSnapshot(),
    recording: false,
    dashboardUrl: String(getAppSettings().digestDashboardUrl || "http://127.0.0.1:4175").replace(
      /\/+$/,
      ""
    ),
  });
});

async function publishQueueToRenderer({ raise = false } = {}) {
  reloadSops();
  const loaded = await refreshQueue();
  const payload = {
    queue: queue.map(enrichCard),
    publishedAt: Date.now(),
    rootDir: loaded?.rootDir || documentsRoot,
    allCardCount: loaded?.allCardCount ?? queue.length,
  };
  sendToRenderer("queue-updated", ipcSafe(payload));
  // Only raise on explicit user refresh — background syncs must not steal focus
  if (raise) {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (tailMode) {
          exitTailMode();
        } else if (!mainWindow.isVisible()) {
          mainWindow.show();
        }
        applyAlwaysOnTop(true);
        mainWindow.moveTop();
      }
    } catch {
      /* ignore */
    }
  }
  return {
    cardCount: queue.length,
    allCardCount: payload.allCardCount,
    rootDir: payload.rootDir,
    cardIds: queue.map((c) => c.id),
  };
}

ipcMain.handle("refresh-queue", async () => {
  const result = await publishQueueToRenderer({ raise: true });
  return ipcSafe({
    queue: queue.map(enrichCard),
    ...result,
  });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Open/reload the PDF view URL in Chrome (same tab when possible). Keep liveAct pinned. */
async function showPdfInBrowser(card, filePath) {
  if (!pdfViewServer) return { ok: false, error: "pdf_server_down" };
  const published = pdfViewServer.publish(card.id, filePath);
  if (!published) return { ok: false, error: "pdf_publish_failed" };

  applyAlwaysOnTop(true);

  if (bridge && bridge.isExtensionConnected()) {
    const opened = bridge.sendOpenUrl({
      url: published.url,
      cardId: card.id,
      matchIncludes: `/pdf/${published.id}.pdf`,
    });
    if (opened.ok) {
      setTimeout(() => applyAlwaysOnTop(true), 400);
      return { ok: true, ...published, via: "extension" };
    }
  }

  // Fallback without extension: open Chrome to the http URL (cache-busted)
  await new Promise((resolve) => {
    if (process.platform === "darwin") {
      execFile("open", ["-a", "Google Chrome", published.url], () => resolve());
    } else {
      shell.openExternal(published.url).finally(() => resolve());
    }
  });
  setTimeout(() => applyAlwaysOnTop(true), 400);
  return { ok: true, ...published, via: "shell" };
}

async function runPdfCard(card, sop, options = {}) {
  const pdfPath = resolvePdfPath(card, sop);
  if (!pdfPath) return { ok: false, error: "pdf_missing" };

  const runData = mergeRunData(card.data, options?.dataOverrides);

  const startIndex = Math.max(
    0,
    Math.min(Number(options?.startIndex) || 0, sop.steps.length),
  );
  const completedStepIds = new Set(
    Array.isArray(options?.completedStepIds) ? options.completedStepIds : [],
  );

  clearCardActions(card.id);
  clearCardMistakes(card.id);
  clearCardStepTiming(card.id);
  clearCardRunStarted(card.id);
  finalizedAt.delete(card.id);
  markCardRunStarted(card.id);
  activeRun = { cardId: card.id, mode: "pdf" };
  activeWatch = { cardId: card.id, mode: "pdf" };

  const stepsUi = sop.steps.map((step, i) => {
    if (i < startIndex || completedStepIds.has(step.id)) {
      return stepForUi(step, "done");
    }
    return stepForUi(step, "pending");
  });

  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || tailMode) return;
    applyAlwaysOnTop(true);
    mainWindow.showInactive();
    mainWindow.moveTop();
  }, 100);

  setImmediate(async () => {
    try {
      for (let i = 0; i < startIndex; i++) {
        const step = sop.steps[i];
        sendToRenderer("step-update", {
          cardId: card.id,
          stepId: step.id,
          status: "done",
          source: "pdf",
        });
      }

      const result = await fillPdfForm({
        pdfPath,
        sop: {
          ...sop,
          steps: sop.steps.filter(
            (s, i) => i >= startIndex && !completedStepIds.has(s.id),
          ),
        },
        data: runData,
        onStep: async ({ stepId, status, error }) => {
          const step = sop.steps.find((s) => s.id === stepId);
          if (status === "done" && step) {
            recordCardAction(card.id, {
              stepId,
              status: "done",
              action: step.action,
              key: step.valueFrom || step.id,
              value:
                step.action === "fill"
                  ? String(runData?.[step.valueFrom] ?? runData?.[step.id] ?? "")
                  : step.label || "done",
              label: step.label || step.id,
              source: "pdf",
            });
          }
          sendToRenderer("step-update", {
            cardId: card.id,
            stepId,
            status: status === "done" ? "done" : "failed",
            error: error || null,
            source: "pdf",
          });
          updateTailStatus({
            ok: status === "done",
            bad: status !== "done",
          });
          await sleep(80);
        },
      });

      for (const step of sop.steps) {
        if (step.action === "highlight" || step.action === "wait") {
          sendToRenderer("step-update", {
            cardId: card.id,
            stepId: step.id,
            status: "done",
            source: "pdf",
          });
        }
      }

      const viewPath =
        (result.outPath && fs.existsSync(result.outPath) && result.outPath) ||
        pdfPath;
      await showPdfInBrowser(card, viewPath);

      activeRun = null;
      sendToRenderer("run-finished", {
        cardId: card.id,
        status: result.ok ? "completed" : "failed",
        reason: result.ok
          ? "Filled PDF opened in Chrome (same tab on re-run)"
          : "Some PDF fields failed",
        failedStepLabel: result.ok
          ? null
          : result.results.find((r) => !r.ok)?.id || null,
      });
      if (result.ok) {
        finalizeExecutionArtifacts(card.id, {
          filledPdfSource: result.outPath || viewPath,
          fillMode: "automated",
        }).catch((err) => {
          console.error("[coact] finalize pdf execution", err);
        });
      } else {
        finalizeExecutionArtifacts(card.id, {
          fillMode: "automated",
          status: "failed",
        }).catch((err) => {
          console.error("[coact] finalize incomplete pdf execution", err);
        });
      }
    } catch (err) {
      console.error("[coact] pdf fill failed", err);
      activeRun = null;
      sendToRenderer("run-finished", {
        cardId: card.id,
        status: "failed",
        reason: err.message || String(err),
      });
      finalizeExecutionArtifacts(card.id, {
        fillMode: "automated",
        status: "failed",
      }).catch((e) => {
        console.error("[coact] finalize incomplete pdf execution", e);
      });
    }
  });

  return {
    ok: true,
    mode: "pdf",
    pdfPath,
    startIndex,
    steps: stepsUi,
  };
}

async function clearPdfCard(card, sop) {
  const { prefer, pdfPath } = cardPrefersPdf(card, sop);
  if (!prefer || !pdfPath) return { ok: false, error: "not_pdf" };

  const result = await clearPdfForm({ pdfPath, sop });
  const viewPath =
    (result.outPath && fs.existsSync(result.outPath) && result.outPath) ||
    pdfPath;
  await showPdfInBrowser(card, viewPath);

  for (const step of sop.steps || []) {
    sendToRenderer("step-update", {
      cardId: card.id,
      stepId: step.id,
      status: "pending",
      source: "pdf",
    });
  }

  return {
    ok: true,
    mode: "pdf",
    cleared: true,
    path: viewPath,
    steps: (sop.steps || []).map((step) => stepForUi(step, "pending")),
  };
}

ipcMain.handle("run-card", async (_event, cardId, options = {}) => {
  refreshQueue();
  reloadSops();
  const card = queue.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: "not_found" };

  const sop = sops[card.sopId];
  if (!sop) return { ok: false, error: "sop_missing" };

  if (!card.data || Object.keys(card.data).length === 0) {
    return { ok: false, error: "data_missing" };
  }

  const runData = mergeRunData(card.data, options?.dataOverrides);
  const agentApprovedValues =
    options?.agentApprovedValues && typeof options.agentApprovedValues === "object"
      ? Object.fromEntries(
          Object.entries(options.agentApprovedValues)
            .map(([k, v]) => [k, String(v ?? "").trim()])
            .filter(([, v]) => v),
        )
      : {};
  const agentApproved = Boolean(
    options?.agentApproved || Object.keys(agentApprovedValues).length,
  );
  // When Agent approved, ensure every fill step has a stepId → value for the extension fill loop
  if (agentApproved) {
    for (const step of sop.steps || []) {
      if (String(step?.action || "").toLowerCase() !== "fill" || !step?.id) continue;
      if (agentApprovedValues[step.id]) continue;
      const key = step.valueFrom != null ? step.valueFrom : step.id;
      const fromRun =
        key != null && runData && Object.prototype.hasOwnProperty.call(runData, key)
          ? runData[key]
          : null;
      const raw = Array.isArray(fromRun)
        ? fromRun.map((x) => String(x ?? "").trim()).find(Boolean)
        : fromRun != null
          ? String(fromRun).trim()
          : "";
      if (raw) agentApprovedValues[step.id] = raw;
    }
  }
  const { prefer, pdfPath } = cardPrefersPdf(card, sop);
  const htmlOpen = htmlFormTabOpen(card, sop);
  const onPdfTab = urlLooksLikePdf(lastExtensionTabUrl);
  const htmlUrl = webFormUrl(card, sop);

  // PDF file tab, or no HTML mapping: fill on disk
  if (pdfPath && prefer && !htmlOpen && !htmlUrl) {
    activeRunAgentApproved = agentApproved
      ? {
          cardId: card.id,
          values: agentApprovedValues,
          dataOverrides: options?.dataOverrides || {},
        }
      : null;
    return runPdfCard(card, sop, options);
  }

  const wantHtml = !onPdfTab || htmlOpen || Boolean(htmlUrl);
  if (wantHtml) {
    const cdp = await browserAgent.connect({ launch: false });
    if (cdp.ok) {
      const appRun = await startAppHtmlRun(card, sop, {
        ...options,
        startIndex: Math.max(
          0,
          Math.min(Number(options?.startIndex) || 0, sop.steps.length),
        ),
        completedStepIds: Array.isArray(options?.completedStepIds)
          ? options.completedStepIds
          : [],
        agentApprovedValues,
      });
      if (appRun.ok) {
        activeRunAgentApproved = agentApproved
          ? {
              cardId: card.id,
              values: agentApprovedValues,
              dataOverrides: options?.dataOverrides || {},
            }
          : null;
        setTimeout(() => {
          if (!mainWindow || mainWindow.isDestroyed() || tailMode) return;
          applyAlwaysOnTop(true);
          mainWindow.showInactive();
        }, 250);
        return appRun;
      }
    }
  }

  if (!bridge || !bridge.isExtensionConnected()) {
    if (pdfPath && !htmlUrl) {
      activeRunAgentApproved = agentApproved
        ? {
            cardId: card.id,
            values: agentApprovedValues,
            dataOverrides: options?.dataOverrides || {},
          }
        : null;
      return runPdfCard(card, sop, options);
    }
    return {
      ok: false,
      error: "browser_offline",
      reason:
        "Chrome is not on port 9222. Quit Chrome, relaunch with --remote-debugging-port=9222 --remote-allow-origins='*', then retry. The extension is optional when that port is open.",
    };
  }

  // New Hire HTML: open http form (file:// cannot be filled)
  if (!onPdfTab || htmlOpen || webFormUrl(card, sop)) {
    await ensureWebFormTab(card, sop);
  }

  const startIndex = Math.max(
    0,
    Math.min(Number(options?.startIndex) || 0, sop.steps.length),
  );
  const completedStepIds = Array.isArray(options?.completedStepIds)
    ? options.completedStepIds
    : [];

  const delivery = bridge.sendRunCard({
    cardId: card.id,
    title: card.title,
    data: runData,
    sop,
    target: browserTargetFor(card, sop),
    startIndex,
    completedStepIds,
    agentApproved,
    agentApprovedValues,
  });
  if (!delivery.ok) return delivery;

  clearCardActions(card.id);
  clearCardMistakes(card.id);
  clearCardStepTiming(card.id);
  clearCardRunStarted(card.id);
  finalizedAt.delete(card.id);
  activeRun = { cardId: card.id, clientId: delivery.clientId };
  activeWatch = { cardId: card.id, clientId: delivery.clientId };
  markCardRunStarted(card.id);
  activeRunAgentApproved = agentApproved
    ? {
        cardId: card.id,
        values: agentApprovedValues,
        dataOverrides: options?.dataOverrides || {},
      }
    : null;

  // Start must not collapse Coact — keep the panel visible above Chrome
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || tailMode) return;
    applyAlwaysOnTop(true);
    mainWindow.showInactive();
    mainWindow.moveTop();
  }, 250);

  return {
    ok: true,
    startIndex,
    steps: sop.steps.map((step) => stepForUi(step, "pending")),
  };
});

ipcMain.handle("update-queue-card-status", async (_event, cardId, status) => {
  try {
    const res = await updateQueueCardStatus(cardId, status, queue);
    if (res?.ok && res.changed) {
      const card = queue.find((c) => c.id === cardId);
      if (card) card.status = res.status;
      try {
        await publishQueueToRenderer({ raise: false });
      } catch {
        /* ignore */
      }
    }
    return res;
  } catch (err) {
    return { ok: false, error: err?.message || "status_update_failed" };
  }
});

/** Mark a card incomplete and write an Executions row so Stats Incomplete KPI updates. */
ipcMain.handle("abandon-card", async (_event, cardId, options = {}) => {
  const id = String(cardId || "").trim();
  if (!id) return { ok: false, error: "missing_card" };
  try {
    markCardRunStarted(id);
    const statusRes = await updateQueueCardStatus(id, "incomplete", queue);
    const card = queue.find((c) => c.id === id);
    if (card) card.status = "incomplete";
    const fillMode =
      String(options?.fillMode || "").trim() ||
      (activeRun?.cardId === id ? "automated" : "manual");
    await finalizeExecutionArtifacts(id, {
      fillMode,
      status: "incomplete",
    });
    try {
      await publishQueueToRenderer({ raise: false });
    } catch {
      /* ignore */
    }
    return { ok: true, status: "incomplete", cardStatus: statusRes };
  } catch (err) {
    return { ok: false, error: err?.message || "abandon_failed" };
  }
});

ipcMain.handle("watch-card", async (_event, cardId, options = {}) => {
  refreshQueue();
  reloadSops();
  if (!cardId) {
    activeWatch = null;
    pendingAppWatch = null;
    browserAgent.stopWatch();
    browserAgent.setMatchHints([]);
    browserAgent.setPreferredUrl("");
    if (bridge) bridge.sendWatchCard({ cardId: null, sop: null });
    return { ok: true, watching: false };
  }

  const card = queue.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: "not_found" };
  const sop = sops[card.sopId];
  if (!sop) return { ok: false, error: "sop_missing" };

  activeWatch = { cardId: card.id, mode: undefined };

  // PDF quests: Clear fields must reset the AcroForm (extension cannot touch Chrome's PDF viewer)
  if (options?.clearFields) {
    const { prefer, pdfPath } = cardPrefersPdf(card, sop);
    if (prefer && pdfPath) {
      try {
        const cleared = await clearPdfCard(card, sop);
        activeWatch = { cardId: card.id, mode: "pdf" };
        return cleared;
      } catch (err) {
        console.error("[coact] clear pdf failed", err);
        return { ok: false, error: err.message || "pdf_clear_failed" };
      }
    }
  }

  const htmlUrl = webFormUrl(card, sop);
  const cdp = await browserAgent.connect({ launch: false });
  if (cdp.ok) {
    if (htmlUrl) await browserAgent.openOrFocus(htmlUrl);
    beginAppWatch(card, sop);
    return {
      ok: true,
      watching: true,
      via: "playwright",
      steps: sop.steps.map((step) => stepForUi(step, "pending")),
    };
  }

  if (bridge?.isExtensionConnected()) {
    if (htmlUrl && !htmlFormTabOpen(card, sop)) {
      bridge.sendOpenUrl?.({
        url: htmlUrl,
        cardId: card.id,
      });
    }
    const delivery = bridge.sendWatchCard({
      cardId: card.id,
      title: card.title,
      sop,
      data: card.data || {},
      target: browserTargetFor(card, sop),
      resetProgress: Boolean(options?.resetProgress),
      clearFields: Boolean(options?.clearFields),
    });
    activeWatch = {
      cardId: card.id,
      clientId: delivery.clientId,
      mode: "extension",
    };
    browserAgent.connect({ launch: false }).then((res) => {
      if (res.ok) startCdpUrlPoll();
    });
    return {
      ok: Boolean(delivery.ok),
      watching: Boolean(delivery.ok),
      error: delivery.error || null,
      steps: sop.steps.map((step) => stepForUi(step, "pending")),
    };
  }

  return {
    ok: false,
    error: "browser_offline",
    reason:
      "Chrome is not on port 9222. Quit Chrome, relaunch with --remote-debugging-port=9222 --remote-allow-origins='*', then retry.",
  };
});

ipcMain.handle("control-run", (_event, action) => {
  if (activeRun?.mode === "app" || activeWatch?.mode === "app") {
    browserAgent.control(action);
  }
  if (!bridge) return { ok: true };
  return {
    ok: bridge.sendControl(
      action,
      activeRun?.clientId || activeWatch?.clientId,
    ),
  };
});

function persistCardData(card) {
  if (!card?.data || !card.id) return;
  try {
    const dir =
      card.sourceDir ||
      lobCardDir(documentsRoot, card.id, card.lob || "TCOO");
    writeCardFiles(dir, {
      data: card.data,
      meta: {
        id: card.id,
        title: card.title,
        sopId: card.sopId,
        status: card.status,
        lob: card.lob,
        formUrl: card.formUrl,
        pdfPath: card.pdfPath,
        formMatch: card.formMatch,
        assignees: card.assignees,
      },
    }).catch((err) => console.error("[livetrack] persist card data failed", err.message));
  } catch (err) {
    console.error("[livetrack] persist card data failed", err.message);
  }
}

/**
 * Apply one step to either a PDF AcroForm or the Chrome page — same Approve / tool path.
 */
async function applyStepCompatible(card, sop, step, options = {}) {
  const valueOverride = options.valueOverride;
  const broadMatch = Boolean(options.broadMatch);

  if (valueOverride != null && valueOverride !== "" && step?.valueFrom) {
    card.data = { ...(card.data || {}), [step.valueFrom]: valueOverride };
    persistCardData(card);
  }

  const { prefer, pdfPath } = cardPrefersPdf(card, sop);
  if (prefer && pdfPath) {
    const result = await applyPdfStep({
      pdfPath,
      step,
      data: card.data || {},
      valueOverride,
      onStep: ({ stepId, status, error }) => {
        sendToRenderer("step-update", {
          cardId: card.id,
          stepId,
          status: status === "done" ? "done" : "failed",
          error: error || null,
          source: "pdf",
        });
      },
    });
    if (result.ok && result.outPath) {
      await showPdfInBrowser(card, result.outPath);
    }
    return {
      ok: Boolean(result.ok),
      mode: "pdf",
      error: result.error || null,
      field: result.field || null,
    };
  }

  if (browserAgent.isConnected()) {
    const value =
      valueOverride != null && valueOverride !== ""
        ? String(valueOverride)
        : browserAgent.stepValue(step, card.data || {});
    const result = await browserAgent.applyStep(step, value);
    sendToRenderer("step-update", {
      cardId: card.id,
      stepId: step.id,
      status: result.ok ? "done" : "failed",
      error: result.error || null,
      source: "app",
    });
    return { ok: Boolean(result.ok), mode: "app", error: result.error || null };
  }

  if (!bridge || !bridge.isExtensionConnected()) {
    // Last resort: if a PDF exists, use it even when prefer was false
    if (pdfPath) {
      const result = await applyPdfStep({
        pdfPath,
        step,
        data: card.data || {},
        valueOverride,
      });
      if (result.ok && result.outPath) await showPdfInBrowser(card, result.outPath);
      return { ok: Boolean(result.ok), mode: "pdf", error: result.error || null };
    }
    return { ok: false, error: "extension_offline" };
  }

  return bridge.sendApplyStep({
    cardId: card.id,
    data: card.data || {},
    step,
    valueOverride,
    broadMatch,
    target: browserTargetFor(card, sop),
    clientId: activeWatch?.clientId || activeRun?.clientId,
  });
}

ipcMain.handle("apply-step", async (_event, payload = {}) => {
  refreshQueue();
  reloadSops();
  const cardId = payload.cardId || activeWatch?.cardId || activeRun?.cardId;
  const card = queue.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: "not_found" };
  const sop = sops[card.sopId];
  if (!sop) return { ok: false, error: "sop_missing" };
  const step =
    sop.steps.find(
      (s) => s.id === payload.stepId || s.id === payload.step?.id,
    ) ||
    payload.step ||
    null;
  if (!step) return { ok: false, error: "step_missing" };

  try {
    return await applyStepCompatible(card, sop, step, {
      valueOverride: payload.valueOverride,
      broadMatch: Boolean(payload.broadMatch),
    });
  } catch (err) {
    console.error("[coact] apply-step failed", err);
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle("repair-failed-step", async (_event, payload = {}) => {
  try {
    let snippet = payload?.snippet || "";
    if (!snippet && bridge && bridge.isExtensionConnected()) {
      try {
        const requestId = `repair-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const snip = await bridge.requestSnippet(
          requestId,
          activeWatch?.clientId || activeRun?.clientId,
        );
        if (snip?.ok && snip.text) snippet = snip.text;
      } catch {
        /* optional */
      }
    }

    const cardId = payload.cardId || activeRun?.cardId || activeWatch?.cardId;
    const card = queue.find((c) => c.id === cardId);
    const sop = card ? sops[card.sopId] : null;
    const step =
      payload.step ||
      sop?.steps?.find((s) => s.id === payload.stepId) ||
      payload.failedStep ||
      {};

    const plan = await repairFailedStep({
      step,
      error: payload.error || payload.reason || "",
      stepContext: payload.stepContext || "",
      snippet,
      questData: card?.data || {},
    });

    if (!plan.ok || !plan.retry) {
      return { ...plan, applied: false };
    }

    if (!card || !step?.id) {
      return { ...plan, applied: false, error: "browser_unavailable" };
    }

    const delivery = await applyStepCompatible(card, sop, step, {
      valueOverride: plan.valueOverride,
      broadMatch: plan.broadMatch || plan.action === "retry_broad",
    });

    return { ...plan, applied: Boolean(delivery.ok), delivery };
  } catch (err) {
    return { ok: false, retry: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("set-always-on-top", (_event, enabled) => {
  const on = Boolean(enabled);
  const ok = applyAlwaysOnTop(on);
  if (on) startAlwaysOnTopKeepAlive();
  else stopAlwaysOnTopKeepAlive();
  return { ok, enabled: on };
});

ipcMain.handle("set-tail-mode", (_event, enabled) => {
  if (enabled) enterTailMode();
  else exitTailMode();
  return { ok: true, enabled: Boolean(enabled) };
});

ipcMain.handle("get-main-bounds", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    return mainWindow.getBounds();
  } catch {
    return null;
  }
});

ipcMain.handle("copy-text", (_event, text) => {
  const value = String(text || "").trim();
  if (!value) return { ok: false };
  clipboard.writeText(value);
  return { ok: true, text: value };
});

ipcMain.handle("quit-app", () => {
  quitLiveActApp();
  return { ok: true };
});

ipcMain.handle("tail-open-main", () => {
  exitTailMode();
  return { ok: true };
});

ipcMain.handle("set-tail-status", (_event, status) => {
  updateTailStatus(status || {});
  return { ok: true };
});

ipcMain.handle("request-tab-status", async () => {
  if (browserAgent.isConnected()) {
    const meta = await browserAgent.currentPageMeta();
    if (meta?.url) {
      lastExtensionTabUrl = meta.url;
      publishTrackerStatus({
        tabUrl: meta.url,
        tabTitle: meta.title || "",
        activated: false,
      });
    }
  }
  if (!bridge) return { ok: browserAgent.isConnected() };
  return { ok: bridge.requestStatus() };
});

ipcMain.handle("get-openai-settings", () => {
  return getAppSettings();
});

ipcMain.handle("ensure-microphone", async () => {
  if (process.platform === "darwin" && systemPreferences?.askForMediaAccess) {
    const granted = await systemPreferences.askForMediaAccess("microphone");
    const status = systemPreferences.getMediaAccessStatus?.("microphone") || (granted ? "granted" : "denied");
    return { ok: Boolean(granted), status };
  }
  return { ok: true, status: "granted" };
});

ipcMain.handle("ensure-screen-capture", async () => {
  if (process.platform === "darwin" && systemPreferences?.getMediaAccessStatus) {
    const status = systemPreferences.getMediaAccessStatus("screen") || "unknown";
    return { ok: status === "granted" || status === "unknown", status };
  }
  return { ok: true, status: "granted" };
});

ipcMain.handle("mom-loopback-source", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1, height: 1 },
    });
    const source = sources[0];
    if (!source?.id) return { ok: false, error: "No screen source for meeting audio." };
    return { ok: true, id: source.id };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not capture system audio." };
  }
});

let momTeamsFrameInFlight = null;

async function captureMeetingFrameJpeg() {
  const { screen } = require("electron");
  const liveBounds =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
  const display = screen.getDisplayMatching(liveBounds);
  const scale = display.scaleFactor || 1;
  const fullW = Math.round(display.size.width * scale);
  const fullH = Math.round(display.size.height * scale);
  const fit = Math.min(1, 1280 / Math.max(fullW, 1));
  const thumbW = Math.max(320, Math.round(fullW * fit));
  const thumbH = Math.max(180, Math.round(fullH * fit));
  const screens = await Promise.race([
    desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: thumbW, height: thumbH },
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Screen capture timed out")), 4000)),
  ]);
  const screenSrc =
    screens.find((row) => String(row.display_id) === String(display.id)) || screens[0];
  if (screenSrc?.thumbnail && !screenSrc.thumbnail.isEmpty()) {
    const image = screenSrc.thumbnail;
    const size = image.getSize();
    const imageScale = size.width / Math.max(1, display.size.width);
    const crop = momTeams.cropRectForMeeting(size, display.bounds, liveBounds, imageScale);
    const clipped = image.crop({
      x: Math.max(0, Math.floor(crop.x)),
      y: Math.max(0, Math.floor(crop.y)),
      width: Math.max(80, Math.min(size.width - Math.max(0, crop.x), crop.width)),
      height: Math.max(80, Math.min(size.height - Math.max(0, crop.y), crop.height)),
    });
    const jpeg = clipped.resize({ width: 1280, height: 720, quality: "better" }).toJPEG(72);
    return { jpeg, windowName: screenSrc.name || "screen" };
  }

  const windows = await Promise.race([
    desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 1280, height: 720 },
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Window capture timed out")), 4000)),
  ]);
  const match = momTeams.pickMeetingSource(windows);
  if (match?.thumbnail && !match.thumbnail.isEmpty()) {
    const jpeg = match.thumbnail.resize({ width: 1280, height: 720, quality: "better" }).toJPEG(72);
    return { jpeg, windowName: match.name || "" };
  }
  return { jpeg: null, windowName: "" };
}

ipcMain.handle("mom-teams-frame", async () => {
  if (momTeamsFrameInFlight) return momTeamsFrameInFlight;
  momTeamsFrameInFlight = (async () => {
    try {
      const captured = await captureMeetingFrameJpeg();
      if (!captured?.jpeg) {
        return { ok: false, error: "Meeting window not found. Keep Teams visible beside LiveTrack." };
      }
      const dataUrl = `data:image/jpeg;base64,${Buffer.from(captured.jpeg).toString("base64")}`;
      const read = await readTeamsMeetingFrame({ dataUrl });
      const ok = Boolean(read?.ok) && Boolean((read?.speaking || (read?.participants || []).length));
      return {
        ok,
        windowName: captured.windowName || "",
        participants: read?.participants || [],
        speaking: read?.speaking || "",
        speakingFirst: read?.speakingFirst || "",
        error: read?.error || (!ok ? "No names on the Teams stage yet." : ""),
      };
    } catch (err) {
      return { ok: false, error: err?.message || "Could not read Teams tiles." };
    } finally {
      momTeamsFrameInFlight = null;
    }
  })();
  return momTeamsFrameInFlight;
});

ipcMain.handle("transcribe-audio", async (_event, payload) => {
  const base64 = String(payload?.base64 || "").trim();
  if (!base64) return { ok: false, error: "No audio captured." };
  const bytes = Buffer.from(base64, "base64");
  return transcribeAudio({
    bytes,
    mimeType: payload?.mimeType,
    diarize: Boolean(payload?.diarize),
    model: payload?.model,
    knownSpeakerNames: payload?.knownSpeakerNames,
    knownSpeakerReferences: payload?.knownSpeakerReferences,
    whisperFallback: payload?.whisperFallback,
  });
});

ipcMain.handle("synthesize-speech", async (_event, payload) => {
  return synthesizeSpeech({
    text: payload?.text,
    voice: payload?.voice,
    speed: payload?.speed,
  });
});

function jiraTokenFromPayload(payload) {
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, "jiraApiToken")) {
    return undefined;
  }
  const tok = sanitizeJiraSecret(payload.jiraApiToken);
  if (!tok || isBlankJiraSecret(tok)) return undefined;
  return tok;
}

ipcMain.handle("save-openai-settings", (_event, payload) => {
  const result = saveSettings({
    openaiApiKey: payload?.apiKey != null ? String(payload.apiKey) : undefined,
    openaiModel: payload?.model != null ? String(payload.model) : undefined,
    executionsRoot:
      payload?.executionsRoot != null ? String(payload.executionsRoot) : undefined,
    jiraBaseUrl: payload?.jiraBaseUrl != null ? String(payload.jiraBaseUrl) : undefined,
    jiraEmail: payload?.jiraEmail != null ? String(payload.jiraEmail) : undefined,
    jiraApiToken: jiraTokenFromPayload(payload),
    jiraJql: payload?.jiraJql != null ? String(payload.jiraJql) : undefined,
    jiraStaleDays: payload?.jiraStaleDays != null ? payload.jiraStaleDays : undefined,
    jiraPollMinutes: payload?.jiraPollMinutes != null ? payload.jiraPollMinutes : undefined,
    jiraStatusMap: payload?.jiraStatusMap != null ? payload.jiraStatusMap : undefined,
    jiraCardKeyField:
      payload?.jiraCardKeyField != null ? String(payload.jiraCardKeyField) : undefined,
    jiraProjectKey:
      payload?.jiraProjectKey != null ? String(payload.jiraProjectKey) : undefined,
    digestOptIn: payload?.digestOptIn != null ? Boolean(payload.digestOptIn) : undefined,
    digestSlackWebhookUrl:
      payload?.digestSlackWebhookUrl != null
        ? String(payload.digestSlackWebhookUrl)
        : undefined,
    digestRecipients:
      payload?.digestRecipients != null ? String(payload.digestRecipients) : undefined,
    digestDashboardUrl:
      payload?.digestDashboardUrl != null ? String(payload.digestDashboardUrl) : undefined,
    digestSmtp: payload?.digestSmtp != null ? payload.digestSmtp : undefined,
    chromeDebugUrl:
      payload?.chromeDebugUrl != null ? String(payload.chromeDebugUrl) : undefined,
    digitalEmployeeEnabled:
      payload?.digitalEmployeeEnabled != null ? Boolean(payload.digitalEmployeeEnabled) : undefined,
    voiceAutoSpeak: payload?.voiceAutoSpeak != null ? Boolean(payload.voiceAutoSpeak) : undefined,
    voiceRate: payload?.voiceRate != null ? payload.voiceRate : undefined,
    voicePitch: payload?.voicePitch != null ? payload.voicePitch : undefined,
    voiceName: payload?.voiceName != null ? String(payload.voiceName) : undefined,
    outlookTenantId:
      payload?.outlookTenantId != null ? String(payload.outlookTenantId) : undefined,
    outlookClientId:
      payload?.outlookClientId != null ? String(payload.outlookClientId) : undefined,
    momGreetingName:
      payload?.momGreetingName != null ? String(payload.momGreetingName) : undefined,
  });
  startJiraPolling();
  startMomPolling();
  if (payload?.chromeDebugUrl) {
    browserAgent.disconnect();
    browserAgent.connect({ launch: false }).then((res) => {
      if (res.ok) startCdpUrlPoll();
      publishTrackerStatus();
    });
  }
  return { ok: true, ...result };
});

ipcMain.handle("outlook-connect", async () => {
  const cfg = outlook.getOutlookConfig();
  // Drop tokens from a previous Azure app so device-code uses the new client cleanly
  const stored = require("./settings").loadSettings();
  const storedClient = String(stored.outlookClientId || "").trim();
  if (storedClient && storedClient !== cfg.clientId) {
    outlook.disconnect();
  }
  const started = await outlook.startDeviceCode({
    tenantId: cfg.tenantId,
    clientId: cfg.clientId,
  });
  if (!started.ok) return started;
  sendToRenderer(
    "outlook-device-code",
    ipcSafe({
      userCode: started.userCode,
      verificationUri: started.verificationUri,
      message: started.message,
    }),
  );
  const openUrl = started.verificationUriComplete || started.verificationUri;
  if (openUrl) {
    try {
      await shell.openExternal(openUrl);
    } catch {
      /* user can open the URL from the MOM pane */
    }
  }
  const tokened = await outlook.pollDeviceCode(started);
  if (!tokened.ok) return { ...tokened, ...outlook.publicStatus() };
  const me = await outlook.fetchMe();
  await refreshMomCalendar();
  return { ok: true, ...outlook.publicStatus(), accountName: me.accountName || "" };
});

ipcMain.handle("outlook-cancel-connect", () => {
  outlook.cancelDeviceLogin();
  return { ok: true };
});

ipcMain.handle("outlook-disconnect", () => {
  outlook.disconnect();
  outlookEvents = [];
  outlookMeta = { ok: false, connected: false, error: "Outlook disconnected.", fetchedAt: new Date().toISOString() };
  publishMomSnapshot();
  return { ok: true, ...outlook.publicStatus() };
});

ipcMain.handle("outlook-refresh", async () => {
  const meta = await refreshMomCalendar();
  return { ok: Boolean(meta?.ok), ...momSnapshot() };
});

ipcMain.handle("mom-get-snapshot", () => momSnapshot());

ipcMain.handle("mom-mark", (_event, payload) => {
  const eventId = String(payload?.eventId || "").trim();
  if (!eventId) return { ok: false, error: "Missing meeting." };
  mom.setMarked(eventId, payload?.marked !== false);
  publishMomSnapshot();
  return { ok: true, ...momSnapshot() };
});

ipcMain.handle("mom-start", (_event, payload) => {
  const rawId = String(payload?.eventId || "").trim();
  const eventId =
    !rawId || rawId === "adhoc" ? `adhoc-${Date.now()}` : rawId;
  const event = eventId.startsWith("adhoc") ? null : findMomEvent(eventId);
  if (event && !mom.canStartRecording(event)) {
    return { ok: false, error: "Wait until the meeting start time to record MOM." };
  }
  momSession = {
    id: `mom-${Date.now()}`,
    eventId,
        meeting: event
      ? event
      : {
          id: eventId,
          subject: "Ad-hoc meeting",
          start: new Date().toISOString(),
          end: "",
          startMs: Date.now(),
          endMs: 0,
        },
    recording: true,
    refining: false,
    refined: false,
    approved: false,
    pendingApproval: false,
    refineSource: "",
    transcript: "",
    turns: [],
    refinedText: "",
    startedAt: new Date().toISOString(),
  };
  if (event?.id) momAutoStopIds.delete(event.id);
  publishMomSnapshot();
  return { ok: true, session: momSnapshot().session };
});

ipcMain.handle("mom-append-transcript", (_event, payload) => {
  if (!momSession) return { ok: false, error: "No MOM session." };
  if (!momSession.recording) {
    return { ok: true, transcript: momSession.transcript || "", turns: momSession.turns || [] };
  }
  const meeting = momSession.meeting || null;
  const operatorName = mom.greetingName({
    givenName: outlook.getOutlookConfig().accountGivenName,
    greetingSetting: getAppSettings().momGreetingName,
  });
  if (Array.isArray(payload?.turns) && payload.turns.length) {
    const mapped = momSpeakers.mapSpeakerTurns(payload.turns, { operatorName, meeting });
    momSession.turns = momSpeakers.mergeAdjacentTurns(mapped, { operatorName, meeting });
    momSession.transcript = momSpeakers.formatTurns(momSession.turns, { operatorName, meeting });
    publishMomSnapshot();
    return { ok: true, transcript: momSession.transcript, turns: momSession.turns };
  }
  const chunk = String(payload?.text || "").trim();
  if (!chunk) return { ok: true, transcript: momSession.transcript || "" };
  if (payload?.replace) {
    momSession.transcript = chunk;
  } else {
    momSession.transcript = momSession.transcript
      ? `${momSession.transcript}\n${chunk}`
      : chunk;
  }
  publishMomSnapshot();
  return { ok: true, transcript: momSession.transcript };
});

ipcMain.handle("mom-stop-refine", async (_event, payload) => {
  const transcript = String(payload?.transcript || momSession?.transcript || "");
  return refineMomSession({
    transcript,
    turns: payload?.turns,
    draftText: payload?.draftText,
    source: payload?.source || "manual",
  });
});

ipcMain.handle("mom-approve", async (_event, payload) => {
  return approveMomSession({ text: payload?.text });
});

ipcMain.handle("mom-re-refine", async (_event, payload) => {
  const draftText = String(payload?.text || momSession?.refinedText || "").trim();
  if (!draftText) return { ok: false, error: "No minutes to refine." };
  return refineMomSession({
    draftText,
    source: payload?.source || "edit",
  });
});

ipcMain.handle("mom-cancel", () => {
  if (momSession) mom.cancelSession(momSession);
  publishMomSnapshot();
  return { ok: true, discarded: true, ...momSnapshot() };
});

ipcMain.handle("mom-list", async (_event, payload = {}) => {
  try {
    const items = mom.listMomArtifacts({
      user: localUsername(),
      limit: payload?.limit,
    });
    return { ok: true, user: localUsername(), items };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), items: [] };
  }
});

ipcMain.handle("mom-get-artifact", async (_event, payload = {}) => {
  try {
    const item = mom.loadMomArtifact(payload?.id);
    if (!item) return { ok: false, error: "Minutes not found." };
    const owner = String(item.user || "").trim().toLowerCase();
    const me = String(localUsername() || "").trim().toLowerCase();
    if (owner && me && owner !== me) {
      return { ok: false, error: "Those minutes belong to another user." };
    }
    return { ok: true, item };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("jira-test-connection", async (_event, payload) => {
  const saved = getJiraConfig();
  const fromPayload = jiraTokenFromPayload(payload);
  const config = {
    jiraBaseUrl:
      payload?.jiraBaseUrl != null ? String(payload.jiraBaseUrl) : saved.jiraBaseUrl,
    jiraEmail: payload?.jiraEmail != null ? String(payload.jiraEmail) : saved.jiraEmail,
    jiraApiToken: fromPayload || saved.jiraApiToken,
    jiraProjectKey:
      payload?.jiraProjectKey != null ? String(payload.jiraProjectKey) : saved.jiraProjectKey,
    jiraJql: saved.jiraJql,
    jiraStaleDays: saved.jiraStaleDays,
    jiraStatusMap: saved.jiraStatusMap,
    jiraCardKeyField: saved.jiraCardKeyField,
  };
  try {
    const result = await testConnection(config);
    if (result?.ok) {
      const persist = {};
      if (result.projectKey) persist.jiraProjectKey = result.projectKey;
      if (config.jiraBaseUrl) persist.jiraBaseUrl = config.jiraBaseUrl;
      if (config.jiraEmail) persist.jiraEmail = config.jiraEmail;
      if (!isBlankJiraSecret(config.jiraApiToken)) {
        persist.jiraApiToken = sanitizeJiraSecret(config.jiraApiToken);
      }
      if (Object.keys(persist).length) saveSettings(persist);
    }
    return result;
  } catch (err) {
    return { ok: false, error: err?.message || "Could not reach Jira" };
  }
});

ipcMain.handle("jira-refresh", async () => {
  try {
    await ensureLocalJiraMock();
  } catch (err) {
    console.warn("[livetrack] jira mock", err?.message || err);
  }
  try {
    const snap = await refreshJira({ force: true });
    return {
      ...(snap || { ok: false, issues: [], staleCount: 0 }),
      recentActions: recentJiraActions(5),
    };
  } catch (err) {
    const raw = String(err?.message || err || "Could not refresh Jira");
    const error =
      /Unexpected token\s+'<'/.test(raw) || /is not valid JSON/i.test(raw)
        ? "Jira returned HTML instead of JSON. Set Site URL to https://your-domain.atlassian.net or http://127.0.0.1:4176 (local mock), not a login, /browse, or dashboard page."
        : raw;
    return {
      ok: false,
      configured: true,
      issues: [],
      staleCount: 0,
      error,
      recentActions: recentJiraActions(5),
    };
  }
});

ipcMain.handle("jira-set-pane-active", (_event, active) => {
  setJiraPaneActive(Boolean(active));
  return { ok: true, active: jiraPaneActive, pollMs: jiraPollDelayMs() };
});

ipcMain.handle("jira-get-snapshot", () => {
  return {
    ...(jiraSnapshot || { ok: false, issues: [], staleCount: 0 }),
    recentActions: recentJiraActions(5),
  };
});

ipcMain.handle("jira-open-issue", async (_event, url) => {
  const href = String(url || "").trim();
  if (!/^https?:\/\//i.test(href)) return { ok: false, error: "invalid_url" };
  await shell.openExternal(href);
  return { ok: true };
});

ipcMain.handle("open-dashboard", async (_event, payload = {}) => {
  const base = String(getAppSettings().digestDashboardUrl || "http://127.0.0.1:4175").replace(
    /\/+$/,
    ""
  );
  const raw = String(payload.hash || payload.path || "#/studio").trim();
  const href = /^https?:\/\//i.test(raw)
    ? raw
    : raw.startsWith("#")
      ? `${base}/${raw}`
      : `${base}${raw.startsWith("/") ? raw : `/${raw}`}`;
  await shell.openExternal(href);
  return { ok: true, href };
});

ipcMain.handle("jira-add-comment", async (_event, payload) => {
  const config = getJiraConfig();
  const issueKey = String(payload?.issueKey || "").trim();
  const body = String(payload?.body || "").trim();
  const result = await addComment(config, issueKey, body);
  appendJiraAction({
    issueKey,
    action: "comment",
    bodyPreview: body.slice(0, 120),
    ok: Boolean(result.ok),
    httpStatus: result.httpStatus || null,
    conflict: false,
    error: result.error || null,
  });
  if (result.ok) {
    await refreshJira({ force: true });
  }
  return {
    ...result,
    recentActions: recentJiraActions(5),
  };
});

function isChromeOwner(owner) {
  return isChromeOwnerName(owner);
}

async function deskExplainOptionalSnippet() {
  let snippet = "";
  let pageUrl = "";
  let pageTitle = "";
  if (bridge && bridge.isExtensionConnected()) {
    const requestId = `desk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const snip = await bridge.requestSnippet(requestId, activeWatch?.clientId || activeRun?.clientId);
      if (snip?.ok && snip.text) snippet = snip.text;
      pageUrl = String(snip?.url || "").trim();
      pageTitle = String(snip?.title || "").trim();
    } catch {
      /* try CDP */
    }
  }
  if (!isUsefulExplainSnippet(snippet) || !pageUrl) {
    try {
      const page = await browserAgent.currentPageSnippet();
      const text = String(page?.text || "").trim();
      if (isUsefulExplainSnippet(text)) snippet = text;
      else if (!snippet && text) snippet = text;
      const meta = await browserAgent.currentPageMeta();
      pageUrl = pageUrl || String(meta?.url || page?.url || "").trim();
      pageTitle = pageTitle || String(meta?.title || page?.title || "").trim();
      if (!snippet && pageUrl) snippet = `URL: ${pageUrl}\nTitle: ${pageTitle}`;
    } catch {
      /* none */
    }
  }
  if (pageUrl || pageTitle) {
    const hasUrl = /^URL:/im.test(snippet);
    const hasTitle = /^Title:/im.test(snippet);
    const head = [
      !hasUrl && pageUrl ? `URL: ${pageUrl}` : "",
      !hasTitle && pageTitle ? `Title: ${pageTitle}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (head) snippet = snippet ? `${head}\n${snippet}` : head;
  }
  return { text: String(snippet || "").trim(), pageUrl, pageTitle };
}

function formatExplainConfidenceFooter(past = {}) {
  const conf = Number(past?.confidence);
  const confidence = Number.isFinite(conf) && conf > 0 ? conf : 55;
  const label = String(past?.confidenceLabel || "low").trim() || "low";
  const matches = Array.isArray(past?.matches) ? past.matches : [];
  const lines = [`Confidence: ${confidence}% (${label})`];
  if (matches.length) {
    lines.push(
      `Past refs: ${matches
        .slice(0, 5)
        .map((m) => `${m.ref} ${m.confidence}%`)
        .join(" · ")}`,
    );
  } else {
    lines.push(
      "Past refs: none matched — field values above are from the screenshot only, not prior executions.",
    );
  }
  return lines.join("\n");
}

ipcMain.handle("desk-explain-page", async (_event, payload) => {
  const screenshotPath = String(payload?.screenshotPath || payload?.path || "").trim();
  const dataUrl = String(payload?.dataUrl || "").trim();

  async function briefWithPastWork({
    snippet,
    screenshotPath: shotPath,
    dataUrl: shotData,
    pageTitle = "",
    pageUrl = "",
  }) {
    let past = {
      historyBlock: "",
      issueKey: "",
      intent: "other",
      captures: [],
      matches: [],
      confidence: 55,
      confidenceLabel: "low",
    };
    try {
      past = await resolveExplainPastWork({ snippet, pageTitle, pageUrl });
    } catch {
      /* Explain still works screenshot-only */
    }
    const briefing = await explainPage({
      snippet,
      screenshotPath: shotPath,
      dataUrl: shotData,
      historyBlock: past?.historyBlock || "",
    });
    if (!briefing?.ok) return briefing;
    const footer = formatExplainConfidenceFooter(past);
    const body = String(briefing.text || "").trim();
    return {
      ...briefing,
      text: body ? `${body}\n\n${footer}` : footer,
      issueKey: past?.issueKey || "",
      intent: past?.intent || "other",
      pastWork: Boolean(String(past?.historyBlock || "").trim()),
      similarCount: Array.isArray(past?.captures) ? past.captures.length : 0,
      confidence: past?.confidence ?? 55,
      confidenceLabel: past?.confidenceLabel || "low",
      matches: Array.isArray(past?.matches) ? past.matches : [],
    };
  }

  if (screenshotPath || dataUrl) {
    const briefing = await briefWithPastWork({
      snippet: "",
      screenshotPath,
      dataUrl,
    });
    if (!briefing?.ok) return briefing;
    return { ...briefing, source: "screenshot", capture: "provided" };
  }

  // Frontmost window first — any app the operator is using. Region snip only if that fails.
  // Do not hide LiveTrack; CGWindowList skips this process and captures the other window.
  const shot = await captureFrontmostWindow(liveActExplainCaptureHooks());
  let used = shot;
  let captureKind = "frontmost";
  if (!shot?.ok || !shot.path) {
    captureKind = "region";
    used = await captureRegionSnipWithPreview();
  }
  if (used?.cancelled) {
    return { ok: false, cancelled: true, error: "Capture cancelled." };
  }
  if (!used?.ok || !used.path) {
    return {
      ok: false,
      error: used?.error || shot?.error || "Could not capture the window you are using.",
    };
  }
  // Prefer browser page text/URL whenever the extension/CDP is available (not only when
  // the captured owner string looks like Chrome — Workday titles vary).
  let snippet = "";
  let pageUrl = "";
  let pageTitle = String(used.windowName || used.owner || "").trim();
  try {
    const snip = await deskExplainOptionalSnippet();
    snippet = snip?.text || "";
    pageUrl = snip?.pageUrl || "";
    if (snip?.pageTitle) pageTitle = snip.pageTitle;
  } catch {
    if (isChromeOwner(used.owner)) {
      /* keep empty */
    }
  }
  const briefing = await briefWithPastWork({
    snippet,
    screenshotPath: used.path,
    pageTitle,
    pageUrl,
  });
  if (!briefing?.ok) return briefing;
  return {
    ...briefing,
    source: "screenshot",
    capture: captureKind,
    owner: used.owner || "",
  };
});

function writeDeskPng(buffer) {
  const dir = path.join(os.tmpdir(), "livetrack-desk");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(
    dir,
    `desk-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.png`,
  );
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function pngPreviewDataUrl(filePath, buffer) {
  try {
    const img = buffer
      ? nativeImage.createFromBuffer(buffer)
      : nativeImage.createFromPath(filePath);
    if (!img || img.isEmpty()) {
      const b64 = (buffer || fs.readFileSync(filePath)).toString("base64");
      return `data:image/png;base64,${b64}`;
    }
    const preview = img.resize({ width: Math.min(480, img.getSize().width || 480) });
    return preview.toDataURL();
  } catch {
    try {
      const b64 = (buffer || fs.readFileSync(filePath)).toString("base64");
      return `data:image/png;base64,${b64}`;
    } catch {
      return "";
    }
  }
}

/**
 * Explain-the-window capture: Desk stays visible. Never hide windows or the Electron app.
 * Only drop always-on-top so z-order can name the previously focused other window.
 */
function liveActExplainCaptureHooks() {
  /** @type {{ win: Electron.BrowserWindow, alwaysOnTop: boolean }[]} */
  let snapshot = [];
  return {
    hide: async () => {
      snapshot = [];
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win || win.isDestroyed()) continue;
        let alwaysOnTop = false;
        try {
          alwaysOnTop = win.isAlwaysOnTop();
        } catch {
          /* ignore */
        }
        snapshot.push({ win, alwaysOnTop });
        if (alwaysOnTop) {
          try {
            win.setAlwaysOnTop(false);
          } catch {
            /* ignore */
          }
        }
      }
    },
    restore: async () => {
      try {
        for (const item of snapshot) {
          const { win } = item;
          if (!win || win.isDestroyed()) continue;
          if (!item.alwaysOnTop) continue;
          try {
            if (win === mainWindow) applyAlwaysOnTop(true);
            else pinFloatingWindow(win);
          } catch {
            /* ignore */
          }
        }
      } finally {
        snapshot = [];
      }
    },
  };
}

function liveActCaptureHooks() {
  const wasTail = Boolean(tailMode);
  /** @type {{ win: Electron.BrowserWindow, visible: boolean, alwaysOnTop: boolean, opacity: number }[]} */
  let snapshot = [];
  return {
    hide: async () => {
      screenCaptureActive = true;
      snapshot = [];
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win || win.isDestroyed()) continue;
        let opacity = 1;
        try {
          opacity = win.getOpacity();
        } catch {
          /* ignore */
        }
        snapshot.push({
          win,
          visible: win.isVisible(),
          alwaysOnTop: win.isAlwaysOnTop(),
          opacity,
        });
        try {
          win.setAlwaysOnTop(false);
        } catch {
          /* ignore */
        }
        try {
          win.setIgnoreMouseEvents(true);
        } catch {
          /* ignore */
        }
        try {
          workspacePinned.delete(win);
          win.setVisibleOnAllWorkspaces(false);
        } catch {
          /* ignore */
        }
        try {
          win.setOpacity(0);
        } catch {
          /* ignore */
        }
        if (win.isVisible()) win.hide();
      }
    },
    restore: async () => {
      try {
        for (const item of snapshot) {
          const { win } = item;
          if (!win || win.isDestroyed()) continue;
          try {
            win.setIgnoreMouseEvents(false);
          } catch {
            /* ignore */
          }
          try {
            win.setOpacity(item.opacity == null ? 1 : item.opacity);
          } catch {
            /* ignore */
          }
        }
        screenCaptureActive = false;
        if (wasTail) {
          const tw = ensureTailWindow();
          tw.setBounds(tailBounds());
          tw.show();
          pinFloatingWindow(tw);
          tw.moveTop();
          return;
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          const mainState = snapshot.find((item) => item.win === mainWindow);
          if (!mainState || mainState.visible) {
            mainWindow.show();
            applyAlwaysOnTop(true);
            mainWindow.focus();
          }
        }
        for (const item of snapshot) {
          const { win } = item;
          if (!win || win.isDestroyed() || win === mainWindow || win === tailWindow) {
            continue;
          }
          if (item.visible) {
            try {
              win.show();
            } catch {
              /* ignore */
            }
          }
          if (item.alwaysOnTop) pinFloatingWindow(win);
        }
      } finally {
        screenCaptureActive = false;
        snapshot = [];
      }
    },
  };
}

let pendingDeskDraft = null;
let lastDeskShotPath = "";

function deskDraftPayload(draft) {
  return {
    ok: true,
    summary: draft?.summary || "",
    description: draft?.description || "",
    acceptanceCriteria: draft?.acceptanceCriteria || "",
    usedAi: Boolean(draft?.usedAi),
    note: draft?.note || "",
  };
}

function liveActSnipHooks() {
  const wasTail = Boolean(tailMode);
  return {
    hide: async () => {
      screenCaptureActive = true;
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.setAlwaysOnTop(false);
        } catch {
          /* ignore */
        }
        try {
          mainWindow.setIgnoreMouseEvents(false);
        } catch {
          /* ignore */
        }
      }
    },
    restore: async () => {
      screenCaptureActive = false;
      if (wasTail) {
        const tw = ensureTailWindow();
        tw.setBounds(tailBounds());
        tw.show();
        pinFloatingWindow(tw);
        tw.moveTop();
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.setIgnoreMouseEvents(false);
        } catch {
          /* ignore */
        }
        mainWindow.show();
        applyAlwaysOnTop(true);
      }
    },
  };
}

async function captureRegionSnipWithPreview() {
  const result = await captureRegionSnip(liveActSnipHooks());
  if (result?.ok && result.path && fs.existsSync(result.path)) {
    result.dataUrl = pngPreviewDataUrl(result.path);
  }
  return result;
}

ipcMain.handle("desk-capture-page", async () => {
  const result = await captureRegionSnipWithPreview();
  if (result?.cancelled) {
    pendingDeskDraft = null;
    return { ok: false, cancelled: true, error: "Capture cancelled." };
  }
  if (!result?.ok || !result.path || !fs.existsSync(result.path)) {
    pendingDeskDraft = null;
    lastDeskShotPath = "";
    return {
      ok: false,
      cancelled: Boolean(result?.cancelled),
      error: result?.error || "Snip failed",
    };
  }

  lastDeskShotPath = result.path;
  pendingDeskDraft = draftJiraFromScreenshot({ screenshotPath: result.path });

  return {
    ok: true,
    path: result.path,
    dataUrl: result.dataUrl || "",
    source: "snipper",
  };
});

ipcMain.handle("desk-draft-from-screenshot", async (_event, payload) => {
  const screenshotPath = String(payload?.screenshotPath || payload?.path || "").trim();
  if (!screenshotPath && !lastDeskShotPath) {
    return { ok: false, error: "No screenshot to draft from." };
  }
  const file = screenshotPath || lastDeskShotPath;
  if (pendingDeskDraft && file === lastDeskShotPath) {
    const draft = await pendingDeskDraft;
    pendingDeskDraft = null;
    return deskDraftPayload(draft);
  }
  const draft = await draftJiraFromScreenshot({
    screenshotPath: file,
    pageUrl: String(payload?.pageUrl || "").trim(),
    pageTitle: String(payload?.pageTitle || "").trim(),
  });
  return deskDraftPayload(draft);
});

ipcMain.handle("desk-create-jira-issue", async (_event, payload) => {
  const config = getJiraConfig();
  if (!isJiraConfigured(config)) {
    return {
      ok: false,
      error:
        "Configure your real Jira site in Settings: site URL (https://your-domain.atlassian.net), email, API token, and project key.",
    };
  }
  const summary = String(payload?.summary || "").trim() || "Issue from LiveTrack Desk";
  const pageUrl = String(payload?.pageUrl || "").trim();
  const pageTitle = String(payload?.pageTitle || "").trim();
  const screenshotPath = String(payload?.screenshotPath || "").trim();
  const sourceKey = String(payload?.sourceKey || payload?.cloneFrom || "").trim();
  const mode = payload?.mode === "clone" ? "clone" : "create";
  let description = String(payload?.description || "").trim();
  const acceptanceCriteria = String(payload?.acceptanceCriteria || "").trim();
  if (!description) {
    description = [
      pageTitle ? `Page: ${pageTitle}` : "",
      pageUrl ? `URL: ${pageUrl}` : "",
      "Created from LiveTrack Desk (no SOP).",
    ]
      .filter(Boolean)
      .join("\n");
  } else if (pageUrl && !description.includes(pageUrl)) {
    description = `${description}\n\nURL: ${pageUrl}`;
  }
  const extraFiles = payload?.extraFiles || payload?.attachments || [];
  const attachPaths = collectDeskAttachmentPaths({ screenshotPath, extraFiles });
  let created;
  if (mode === "clone") {
    if (!sourceKey) {
      return { ok: false, error: "Pick an existing ticket to clone." };
    }
    const extraNote = [
      `Cloned from ${sourceKey} via LiveTrack Desk. Source ticket was not changed.`,
      pageTitle ? `Page: ${pageTitle}` : "",
      pageUrl ? `URL: ${pageUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    created = await cloneIssue(config, { sourceKey, extraNote, acceptanceCriteria });
  } else {
    created = await createIssue(config, {
      summary,
      description,
      acceptanceCriteria,
      projectKey: config.jiraProjectKey,
    });
  }
  if (!created.ok) {
    appendJiraAction({
      action: mode,
      issueKey: "",
      ok: false,
      error: created.error,
      httpStatus: created.httpStatus || null,
      bodyPreview: (mode === "clone" ? sourceKey : summary).slice(0, 80),
    });
    return created;
  }
  const attachments = [];
  for (const file of attachPaths) {
    const attached = await attachFile(config, created.issueKey, file);
    attachments.push({
      path: file,
      name: path.basename(file),
      ok: Boolean(attached?.ok),
      error: attached?.ok ? null : attached?.error || null,
      httpStatus: attached?.httpStatus || null,
    });
  }
  const attachError = attachments.find((item) => !item.ok && item.error);
  appendJiraAction({
    action: mode,
    issueKey: created.issueKey,
    clonedFrom: created.clonedFrom || (mode === "clone" ? sourceKey : ""),
    ok: true,
    bodyPreview: (created.issueKey || summary).slice(0, 80),
  });
  try {
    await refreshJira({ force: true });
  } catch {
    /* snapshot optional */
  }
  return {
    ...created,
    mode,
    attached: attachments.some((item) => item.ok),
    attachments,
    attachError: attachError?.error || null,
    recentActions: recentJiraActions(5),
  };
});

/** Polish a draft with AI (if OpenAI key set), then APPEND as a new Jira comment (never replaces). */
ipcMain.handle("jira-ai-comment", async (_event, payload) => {
  const config = getJiraConfig();
  const issueKey = String(payload?.issueKey || "").trim();
  const draft = String(payload?.draft || payload?.body || "").trim();
  if (!issueKey) return { ok: false, error: "missing_issue" };
  if (!draft) return { ok: false, error: "empty_draft" };
  // Refuse any update/replace request — comments are append-only
  if (payload?.commentId || payload?.replace || payload?.update) {
    return {
      ok: false,
      error: "Comments are append-only; updates are not allowed.",
      recentActions: recentJiraActions(5),
    };
  }

  const polish = await polishJiraCommentDraft({
    draft,
    issueKey,
    summary: payload?.summary || "",
    status: payload?.status || "",
    sopStage: payload?.sopStage || "",
    ticketKey: payload?.ticketKey || issueKey,
    queueCard: payload?.queueCard || "",
    mandatorySummary: payload?.mandatorySummary || "",
  });
  if (!polish.ok) {
    return { ok: false, error: polish.error || "polish_failed", recentActions: recentJiraActions(5) };
  }

  const body = String(polish.polished || draft).trim();
  // Always POST a new comment — never update/delete existing comments
  const result = await addComment(config, issueKey, body);
  appendJiraAction({
    issueKey,
    action: "ai_comment",
    bodyPreview: body.slice(0, 120),
    ok: Boolean(result.ok),
    httpStatus: result.httpStatus || null,
    conflict: false,
    error: result.error || null,
    usedAi: Boolean(polish.usedAi),
  });
  if (result.ok) {
    await refreshJira({ force: true });
  }
  return {
    ...result,
    polished: body,
    usedAi: Boolean(polish.usedAi),
    polishNote: polish.note || null,
    appended: true,
    recentActions: recentJiraActions(5),
  };
});

ipcMain.handle("jira-draft-mail-screenshot", async (_event, payload) => {
  const issueKey = String(payload?.issueKey || "").trim();
  const screenshotPath = String(payload?.screenshotPath || payload?.path || "").trim();
  if (!issueKey) return { ok: false, error: "missing_issue" };
  if (!screenshotPath || !fs.existsSync(screenshotPath)) {
    return { ok: false, error: "Capture a mail screenshot first." };
  }
  const draft = await draftMailFromScreenshot({
    screenshotPath,
    issueKey,
    summary: String(payload?.summary || "").trim(),
  });
  return {
    ok: Boolean(draft?.ok),
    issueKey,
    story: draft?.story || "",
    comment: draft?.comment || "",
    mail: draft?.mail || null,
    usedAi: Boolean(draft?.usedAi),
    note: draft?.note || null,
    error: draft?.ok ? null : draft?.error || "draft_failed",
  };
});

ipcMain.handle("jira-apply-mail-screenshot", async (_event, payload) => {
  const config = getJiraConfig();
  const issueKey = String(payload?.issueKey || "").trim();
  const screenshotPath = String(payload?.screenshotPath || payload?.path || "").trim();
  const story = String(payload?.story || payload?.description || "").trim();
  const comment = String(payload?.comment || payload?.draft || "").trim();
  if (!issueKey) return { ok: false, error: "missing_issue", recentActions: recentJiraActions(5) };
  if (!story && !comment && !screenshotPath) {
    return {
      ok: false,
      error: "Nothing to add. Capture a screenshot or keep the AI draft.",
      recentActions: recentJiraActions(5),
    };
  }
  if (!isJiraConfigured(config)) {
    return {
      ok: false,
      error: "Configure Jira in Settings (base URL, email, API token).",
      recentActions: recentJiraActions(5),
    };
  }

  let descriptionResult = { ok: true, skipped: true };
  if (story) {
    descriptionResult = await appendIssueDescription(config, issueKey, story);
    if (!descriptionResult.ok) {
      appendJiraAction({
        issueKey,
        action: "mail_story",
        ok: false,
        error: descriptionResult.error || null,
      });
      return {
        ok: false,
        error: descriptionResult.error || "Could not update the story.",
        recentActions: recentJiraActions(5),
      };
    }
  }

  let commentResult = { ok: true, skipped: true };
  if (comment) {
    commentResult = await addComment(config, issueKey, comment);
    if (!commentResult.ok) {
      appendJiraAction({
        issueKey,
        action: "mail_comment",
        ok: false,
        error: commentResult.error || null,
      });
      return {
        ok: false,
        error: commentResult.error || "Story updated, but the comment failed.",
        descriptionOk: Boolean(descriptionResult.ok) && !descriptionResult.skipped,
        recentActions: recentJiraActions(5),
      };
    }
  }

  let attached = { ok: false, skipped: true };
  if (screenshotPath && fs.existsSync(screenshotPath)) {
    attached = await attachFile(config, issueKey, screenshotPath);
  }

  appendJiraAction({
    issueKey,
    action: "mail_screenshot",
    ok: true,
    bodyPreview: (comment || story).slice(0, 120),
    attached: Boolean(attached?.ok),
  });
  try {
    await refreshJira({ force: true });
  } catch {
    /* snapshot optional */
  }
  return {
    ok: true,
    issueKey,
    descriptionOk: Boolean(story) && Boolean(descriptionResult.ok),
    commentOk: Boolean(comment) && Boolean(commentResult.ok),
    commentId: commentResult.commentId || null,
    attached: Boolean(attached?.ok),
    attachError: attached?.ok || attached?.skipped ? null : attached?.error || null,
    recentActions: recentJiraActions(5),
  };
});

ipcMain.handle("jira-recent-actions", () => {
  return { ok: true, actions: recentJiraActions(5) };
});

ipcMain.handle("set-capture-recording", async (_event, payload) => {
  const cardId = String(payload?.cardId || "").trim();
  const card = cardId ? queue.find((c) => c.id === cardId) : null;
  const action = String(payload?.action || "").toLowerCase();
  const result = await setCaptureRecording({
    action:
      action === "pause" || action === "resume" || action === "start"
        ? action
        : "stop",
    cardId,
    queueCard: String(payload?.queueCard || card?.title || ""),
    lob: String(payload?.lob || card?.lob || ""),
    user: os.userInfo().username || "",
  });
  const extensionOn = Boolean(bridge?.isExtensionConnected());
  let playwright = null;
  try {
    if (extensionOn) {
      // Prefer extension capture; tear down any leftover Playwright listeners.
      if (browserAgent.captureRecordingStatus?.()?.active) {
        await browserAgent.stopCaptureRecording();
      }
      playwright = { ok: true, via: "extension", active: false };
    } else if (
      (action === "start" || action === "resume") &&
      result?.recording
    ) {
      playwright = await browserAgent.startCaptureRecording();
    } else if (action === "stop" || action === "pause" || !result?.recording) {
      playwright = await browserAgent.stopCaptureRecording();
    } else {
      playwright = browserAgent.captureRecordingStatus?.() || null;
    }
  } catch (err) {
    playwright = {
      ok: false,
      error: err?.message || String(err),
    };
    console.warn("[livetrack] playwright capture", err?.message || err);
  }
  let drafted = [];
  let txnCount = 0;
  if (action !== "pause" && action !== "resume" && action !== "start") {
    try {
      const out = await draftUnmatchedCaptures(queue);
      drafted = out?.drafted || [];
      txnCount = Array.isArray(out?.transactions) ? out.transactions.length : 0;
      if (drafted.length) {
        try {
          await reloadSops();
        } catch (err) {
          console.warn("[livetrack] reload SOPs after capture draft", err?.message || err);
        }
      }
    } catch (err) {
      console.warn("[livetrack] unmatched capture draft", err?.message || err);
    }
  }
  try {
    bridge?.sendCaptureRecording?.({
      recording: Boolean(result?.recording),
      recordingSessionId: result?.recordingSessionId || null,
      cardId,
    });
  } catch {
    /* extension notify is optional */
  }
  return { ...result, draftedCount: drafted.length, txnCount, playwright };
});

ipcMain.handle("get-capture-status", async () => {
  try {
    const status = await getCaptureStatus();
    const playwright = browserAgent.captureRecordingStatus?.() || status.playwright || null;
    return { ...status, playwright };
  } catch (err) {
    return { ok: false, recording: false, transactions: [], error: err?.message || String(err) };
  }
});

ipcMain.handle("get-analytics", async (_event, payload = {}) => {
  try {
    // Always reload so Day/Month/Year period filtering picks up analytics.js edits.
    delete require.cache[require.resolve("./analytics")];
    const { buildAnalytics, normalizeGrain } = require("./analytics");
    const grain = normalizeGrain(payload.grain);
    const work = buildAnalytics({
      grain,
      from: payload.from || "",
      to: payload.to || "",
    });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Analytics timed out")), 12000),
    );
    return { ok: true, ...(await Promise.race([work, timeout])) };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("get-execution-dashboard", async () => {
  const config = getJiraConfig();
  try {
    let captureDashRows = [];
    try {
      captureDashRows = await loadCaptureDashRows();
    } catch (err) {
      console.warn("[coact] capture dash", err?.message || err);
    }
    captureDashRows = (captureDashRows || []).map((row) => {
      const sopId = String(row.draftSopId || "").trim();
      const published = sopId && sops[sopId];
      if (published && published.status && published.status !== "draft" && published.status !== "rejected") {
        return { ...row, discoveryStatus: "approved", unmatched: false };
      }
      return row;
    });
    return await buildAgentDashboard({
      queueCards: queue,
      days: 365,
      jiraBaseUrl: config.jiraBaseUrl || "",
      jiraCardKeyField: config.jiraCardKeyField || "jiraKey",
      captureDashRows,
    });
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      rows: [],
      total: 0,
    };
  }
});

ipcMain.handle("jira-mandatory-summary", async (_event, payload) => {
  let cardId = String(payload?.cardId || activeWatch?.cardId || activeRun?.cardId || "").trim();
  const issueKey = String(payload?.issueKey || "").trim();
  if (!cardId && issueKey) {
    try {
      const { findLinkedCardId } = require("./jira");
      const field = getJiraConfig().jiraCardKeyField || "jiraKey";
      cardId = findLinkedCardId(issueKey, queue, field) || "";
    } catch {
      /* ignore */
    }
  }
  const answers = payload?.answers && typeof payload.answers === "object" ? payload.answers : {};
  const summary = await loadMandatorySummaryForTicket({
    cardId,
    issueKey,
    answers,
    queueCards: queue,
  });
  return { ok: true, ...summary };
});

ipcMain.handle("pick-executions-folder", async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win, {
    title: "Shared executions folder (Excel)",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle("get-extension-install-info", () => {
  return {
    ok: true,
    bundled: bundledExtensionDir(),
    userPath: userExtensionDir(),
    installed: fs.existsSync(path.join(userExtensionDir(), "manifest.json")),
  };
});

ipcMain.handle("install-browser-extension", (_event, browser) => {
  return installBrowserExtension(browser === "edge" || browser === "both" ? browser : "chrome");
});

ipcMain.handle("pick-desk-files", async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win, {
    title: "Attach files to ticket",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Documents & images",
        extensions: ["pdf", "xlsx", "xls", "csv", "png", "jpg", "jpeg", "webp"],
      },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled) return { ok: true, files: [] };
  return {
    ok: true,
    files: (result.filePaths || []).map((p) => ({
      path: p,
      name: path.basename(p),
    })),
  };
});

ipcMain.handle("pick-error-files", async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win, {
    title: "Attach error file",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Errors & screenshots",
        extensions: [
          "png",
          "jpg",
          "jpeg",
          "gif",
          "webp",
          "pdf",
          "xlsx",
          "xls",
          "txt",
          "log",
          "json",
          "csv",
        ],
      },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled) return { ok: true, files: [] };
  return {
    ok: true,
    files: (result.filePaths || []).map((p) => ({
      path: p,
      name: path.basename(p),
    })),
  };
});

ipcMain.handle("capture-live-snippet", async () => {
  if (!bridge || !bridge.isExtensionConnected()) {
    return { ok: false, error: "extension_offline" };
  }
  const requestId = `snip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return bridge.requestSnippet(
    requestId,
    activeWatch?.clientId || activeRun?.clientId,
  );
});

ipcMain.handle("capture-region-snip", async () => captureRegionSnipWithPreview());

const chatAbortControllers = new Map();

ipcMain.handle("chat-stop", (_event, chatId) => {
  const ctrl = chatAbortControllers.get(chatId);
  if (ctrl) {
    ctrl.abort();
    chatAbortControllers.delete(chatId);
  }
  return { ok: true };
});

ipcMain.handle("chat-prompt", async (event, payload) => {
  const chatId = payload?.chatId || `chat-${Date.now()}`;
  const ctrl = new AbortController();
  chatAbortControllers.set(chatId, ctrl);

  try {
    const cardId =
      payload?.mode === "general"
        ? null
        : payload?.cardId || activeWatch?.cardId || activeRun?.cardId || null;
    const card = cardId ? queue.find((c) => c.id === cardId) : null;
    const sop = card ? sops[card.sopId] : null;

    const executeTool = async (name, args = {}) => {
      refreshQueue();
      const liveCard = cardId ? queue.find((c) => c.id === cardId) : null;
      const liveSop = liveCard ? sops[liveCard.sopId] : null;

      if (name === "get_live_state") {
        let snipText = "";
        if (bridge && bridge.isExtensionConnected()) {
          const requestId = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const snip = await bridge.requestSnippet(
            requestId,
            activeWatch?.clientId || activeRun?.clientId,
          );
          if (snip?.ok) snipText = snip.text || "";
        }
        return {
          ok: true,
          cardId: liveCard?.id || null,
          title: liveCard?.title || null,
          steps: (liveSop?.steps || []).map((s) => ({
            id: s.id,
            label: s.label,
            action: s.action,
          })),
          snippet: snipText.slice(0, 6000),
        };
      }

      if (name === "fill_step" || name === "click_step") {
        if (!liveCard || !liveSop)
          return { ok: false, error: "no_active_card" };
        const step = liveSop.steps.find((s) => s.id === args.stepId);
        if (!step) return { ok: false, error: "step_missing" };
        return applyStepCompatible(liveCard, liveSop, step, {
          valueOverride: args.value,
          broadMatch: Boolean(args.broadMatch),
        });
      }

      if (name === "start_run") {
        if (!liveCard || !liveSop)
          return { ok: false, error: "no_active_card" };
        if (!liveCard.data || Object.keys(liveCard.data).length === 0) {
          return { ok: false, error: "data_missing" };
        }
        const delivery = bridge.sendRunCard({
          cardId: liveCard.id,
          title: liveCard.title,
          data: liveCard.data,
          sop: liveSop,
          target: browserTargetFor(liveCard, liveSop),
          startIndex: 0,
          completedStepIds: [],
        });
        if (delivery.ok) {
          activeRun = { cardId: liveCard.id, clientId: delivery.clientId };
          activeWatch = { cardId: liveCard.id, clientId: delivery.clientId };
        }
        return delivery;
      }

      if (name === "pause_run") {
        return {
          ok: bridge?.sendControl(
            "pause",
            activeRun?.clientId || activeWatch?.clientId,
          ),
        };
      }

      if (name === "cancel_run") {
        return {
          ok: bridge?.sendControl(
            "cancel",
            activeRun?.clientId || activeWatch?.clientId,
          ),
        };
      }

      if (name === "rescan") {
        if (!liveCard || !liveSop)
          return { ok: false, error: "no_active_card" };
        return bridge.sendWatchCard({
          cardId: liveCard.id,
          title: liveCard.title,
          sop: liveSop,
          target: browserTargetFor(liveCard, liveSop),
          resetProgress: false,
        });
      }

      if (name === "clear_fields") {
        if (!liveCard || !liveSop)
          return { ok: false, error: "no_active_card" };
        return bridge.sendWatchCard({
          cardId: liveCard.id,
          title: liveCard.title,
          sop: liveSop,
          target: browserTargetFor(liveCard, liveSop),
          clearFields: true,
          resetProgress: true,
        });
      }

      return { ok: false, error: `unknown_tool:${name}` };
    };

    const result = await streamChat({
      messages: payload?.messages || [],
      prompt: payload?.prompt || "",
      snippet: payload?.snippet || "",
      attachments: payload?.attachments || [],
      stepContext: payload?.stepContext || "",
      signal: ctrl.signal,
      executeTool,
      autoApplyTools: payload?.mode === "general" ? false : payload?.autoApplyTools !== false,
      mode: payload?.mode === "general" ? "general" : "form",
      onDelta(_delta, full) {
        if (!event.sender.isDestroyed()) {
          event.sender.send("chat-delta", { chatId, text: full });
        }
      },
    });
    chatAbortControllers.delete(chatId);
    return {
      ok: true,
      chatId,
      text: result.text,
      model: result.model,
      toolRounds: result.toolRounds,
    };
  } catch (err) {
    chatAbortControllers.delete(chatId);
    if (err?.name === "AbortError") {
      return { ok: false, chatId, error: "cancelled" };
    }
    return { ok: false, chatId, error: err?.message || String(err) };
  }
});

ipcMain.handle("coach-stuck-step", async (_event, payload) => {
  try {
    let snippet = payload?.snippet || "";
    if (!snippet && bridge && bridge.isExtensionConnected()) {
      try {
        const requestId = `coach-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const snip = await bridge.requestSnippet(
          requestId,
          activeWatch?.clientId || activeRun?.clientId,
        );
        if (snip?.ok && snip.text) snippet = snip.text;
      } catch {
        /* optional */
      }
    }

    const cardId = payload?.cardId || activeWatch?.cardId || activeRun?.cardId;
    const card = queue.find((c) => c.id === cardId);
    const sop = card ? sops[card.sopId] : null;
    const fromSop = sop?.steps?.find(
      (s) => s.id === payload?.step?.id || s.id === payload?.stepId,
    );
    // Prefer full SOP step (valueFrom / allowedValues) so Approve always has a case value
    const step = fromSop
      ? { ...fromSop, ...(payload?.step || {}) }
      : payload?.step || {};

    const result = await coachStuckStep({
      step,
      stepContext: payload?.stepContext || "",
      snippet,
      questData: card?.data || payload?.questData || {},
    });
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      text: err?.message || "Coach failed.",
    };
  }
});

ipcMain.handle("propose-agent-fill", async (_event, payload) => {
  try {
    refreshQueue();
    reloadSops();
    const cardId = payload?.cardId || activeWatch?.cardId || activeRun?.cardId;
    const card = queue.find((c) => c.id === cardId);
    if (!card) return { ok: false, error: "not_found", proposals: [] };
    const sop = sops[card.sopId];
    if (!sop) return { ok: false, error: "sop_missing", proposals: [] };

    let snippet = payload?.snippet || "";
    if (!snippet && bridge && bridge.isExtensionConnected()) {
      try {
        const requestId = `propose-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const snip = await bridge.requestSnippet(
          requestId,
          activeWatch?.clientId || activeRun?.clientId,
        );
        if (snip?.ok && snip.text) snippet = snip.text;
      } catch {
        /* optional */
      }
    }

    const completed = new Set(
      Array.isArray(payload?.completedStepIds) ? payload.completedStepIds : [],
    );
    const fromPayload = Array.isArray(payload?.steps) ? payload.steps : null;
    const steps = (fromPayload?.length ? fromPayload : sop.steps || [])
      .map((s) => {
        const full = sop.steps?.find((x) => x.id === s.id) || s;
        return { ...full, ...s };
      })
      .filter((s) => s?.id && !completed.has(s.id));

    const result = await proposeAgentFill({
      steps,
      questData: card.data || {},
      cardTitle: card.title || card.id,
      snippet,
    });

    const dataOverrides = {};
    for (const p of result.proposals || []) {
      const key = p.valueKey || p.stepId;
      if (key && p.value != null && String(p.value).trim()) {
        dataOverrides[key] = String(p.value).trim();
      }
    }

    return {
      ...result,
      ok: result.ok !== false,
      dataOverrides,
      cardId: card.id,
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      proposals: [],
      dataOverrides: {},
    };
  }
});

/** Feedback Service (DPIP) — logs approve/edit/reject for every AI proposal, including rejects. */
ipcMain.handle("log-agent-feedback", async (_event, payload) => {
  try {
    let user = "";
    try {
      user = os.userInfo().username || "";
    } catch {
      user = "";
    }
    return await recordFeedback({
      source: payload?.source || "autofill",
      action: payload?.action || "approve",
      cardId: payload?.cardId || activeWatch?.cardId || activeRun?.cardId || null,
      user,
      proposals: payload?.proposals || [],
      edited: payload?.edited || null,
      reason: payload?.reason || null,
    });
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

function localUsername() {
  try {
    return os.userInfo().username || "";
  } catch {
    return "";
  }
}

ipcMain.handle("inbox-submit", async (_event, payload) => {
  try {
    return await inbox.submitNote({
      ...payload,
      user: localUsername(),
    });
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("inbox-list", async () => {
  try {
    const notes = await inbox.listNotes({ user: localUsername() });
    return { ok: true, notes };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), notes: [] };
  }
});

ipcMain.handle("actions-list", async (_event, payload = {}) => {
  try {
    const includeDone = payload?.includeDone !== false;
    const actions = await actionsStore.listActions({
      user: localUsername(),
      includeDone,
    });
    const pending = actions.filter((a) => a.status !== "done").length;
    const overdue = (await actionsStore.overduePending({ user: localUsername() })).length;
    return { ok: true, actions, pending, overdue };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      actions: [],
      pending: 0,
      overdue: 0,
    };
  }
});

ipcMain.handle("actions-add", async (_event, payload = {}) => {
  try {
    const res = await actionsStore.addAction({
      ...payload,
      user: localUsername(),
      source: payload?.source || "manual",
    });
    if (res.ok) {
      sendToRenderer(
        "actions-updated",
        ipcSafe({
          reason: "add",
          pending: await actionsStore.pendingCount({ user: localUsername() }),
        }),
      );
    }
    return res;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("actions-done", async (_event, payload = {}) => {
  try {
    const res = await actionsStore.markDone(payload?.id, { user: localUsername() });
    if (res.ok) {
      sendToRenderer(
        "actions-updated",
        ipcSafe({
          reason: "done",
          pending: await actionsStore.pendingCount({ user: localUsername() }),
        }),
      );
    }
    return res;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("actions-reopen", async (_event, payload = {}) => {
  try {
    const res = await actionsStore.reopenAction(payload?.id, { user: localUsername() });
    if (res.ok) {
      sendToRenderer(
        "actions-updated",
        ipcSafe({
          reason: "reopen",
          pending: await actionsStore.pendingCount({ user: localUsername() }),
        }),
      );
    }
    return res;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("actions-pending-count", async () => {
  try {
    const pending = await actionsStore.pendingCount({ user: localUsername() });
    const overdue = (await actionsStore.overduePending({ user: localUsername() })).length;
    return { ok: true, pending, overdue };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), pending: 0, overdue: 0 };
  }
});

/**
 * Process Discovery Agent (DPIP Path 2) — scan the active tracked page and
 * draft a new SOP. The draft's approve/reject decision (the actual feedback
 * event) happens later in the dashboard "Reviews" page, not here — creating
 * a draft is a proposal, not a decision.
 */
ipcMain.handle("discover-sop", async () => {
  try {
    return await discoverFromActivePage(browserAgent);
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("approve-capture-draft", async (_event, payload = {}) => {
  try {
    const capture = require("./capture-forward");
    let sop = payload.sop && typeof payload.sop === "object" ? { ...payload.sop } : null;
    const sopId = String(payload.sopId || sop?.id || "").trim();
    if (sopId) {
      const loaded = await loadSopOrRegenerateFromCapture(sopId, {
        transactionId: payload.transactionId,
      });
      if (loaded?.ok && loaded.sop) {
        sop = {
          ...loaded.sop,
          ...(sop || {}),
          id: loaded.sop.id,
          steps:
            Array.isArray(sop?.steps) && sop.steps.length ? sop.steps : loaded.sop.steps,
        };
      } else if (sop) {
        sop.id = sopId;
      }
    }
    if (!sop?.id) {
      const drafted = synthesizeDraftFromCapture({
        pageUrl: payload.formUrl || payload.pageUrl || sop?.formUrl || "",
        pageTitle: payload.title || sop?.name || "",
        steps: payload.steps || sop?.steps,
        transactionId: payload.transactionId,
      });
      if (Array.isArray(sop?.steps) && sop.steps.length) drafted.steps = sop.steps;
      if (sop?.name) drafted.name = sop.name;
      if (sop?.formUrl) drafted.formUrl = sop.formUrl;
      sop = drafted;
    }
    if (Array.isArray(payload.steps)) sop.steps = payload.steps;
    if (payload.title) sop.name = String(payload.title);
    if (payload.formUrl) sop.formUrl = String(payload.formUrl);
    if (Array.isArray(payload.formMatch)) sop.formMatch = payload.formMatch;
    sop.approvedBy = os.userInfo().username || payload.user || "";
    const result = await promoteSopToQueueCard(sop, {
      data: payload.data,
      lob: payload.lob,
      title: payload.title || sop.name,
      cardId: payload.cardId,
    });
    if (!result.ok) return result;
    const txnId = String(payload.transactionId || "").trim();
    if (txnId) {
      const txns = await capture.mergeLiveAndPersistedTransactions();
      await capture.persistCaptureTransactions(
        txns.map((t) =>
          String(t.transactionId || "") === txnId
            ? capture.applyTxnPatch(t, {
                discoveryStatus: "approved",
                unmatched: false,
                queueCard: result.card?.title || sop.name,
                cardId: result.card?.id || "",
              })
            : t
        )
      );
    }
    await recordFeedback({
      source: "discovery",
      action: "approve",
      sopId: sop.id,
      user: sop.approvedBy,
    }).catch(() => {});
    sops = await loadAllSops();
    await publishQueueToRenderer({ raise: false });
    return result;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("dismiss-capture-draft", async (_event, payload = {}) => {
  try {
    const capture = require("./capture-forward");
    const txnId = String(payload.transactionId || "").trim();
    const sopId = String(payload.sopId || "").trim();
    if (sopId) {
      const all = await sopsStore.loadAllSopObjects();
      const sop = all.find((s) => s.id === sopId);
      if (sop) {
        await sopsStore.upsertSop({
          ...sop,
          status: "rejected",
          rejectedAt: new Date().toISOString(),
          rejectedReason: payload.reason || "Dismissed from Dash",
        });
      }
    }
    if (txnId) {
      const txns = await capture.mergeLiveAndPersistedTransactions();
      await capture.persistCaptureTransactions(
        txns.map((t) =>
          String(t.transactionId || "") === txnId
            ? capture.applyTxnPatch(t, { discoveryStatus: "dismissed" })
            : t
        )
      );
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

/** Merge approved Agent overrides onto case data for a single run (non-persistent). */
function mergeRunData(base, overrides) {
  const data = base && typeof base === "object" ? { ...base } : {};
  if (!overrides || typeof overrides !== "object") return data;
  for (const [key, value] of Object.entries(overrides)) {
    if (key == null || key === "") continue;
    if (value == null) continue;
    const s = String(value).trim();
    if (!s) continue;
    data[key] = s;
  }
  return data;
}