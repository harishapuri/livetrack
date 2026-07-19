const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { createBridge } = require("./bridge");

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
  loadQueueFromDocuments,
  seedSampleCases,
  updateQueueCardStatus,
} = require("./documents");
const {
  getOpenAiConfig,
  saveSettings,
  getAppSettings,
  getJiraConfig,
} = require("./settings");
const {
  searchIssues,
  isConfigured: isJiraConfigured,
  addComment,
  appendJiraAction,
  recentJiraActions,
  isJiraDoneStatus,
  findLinkedCardId,
  ensureLinkedIssues,
} = require("./jira");
const {
  buildAgentDashboard,
  loadMandatorySummaryForTicket,
  mandatorySummaryForCard,
  extractJiraKey,
  isGeneratedJiraKey,
} = require("./dashboard-stats");
const {
  streamChat,
  coachStuckStep,
  proposeAgentFill,
  repairFailedStep,
  judgeValueMatch,
  polishJiraCommentDraft,
} = require("./openai-chat");
const { captureRegionSnip } = require("./snipper");
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
      "Developer mode → Load unpacked → select Projects/coact/extension (folder already opened).",
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

function loadSopsFromDir(sopsDir, map) {
  if (!fs.existsSync(sopsDir)) return;
  for (const name of fs.readdirSync(sopsDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const filePath = path.join(sopsDir, name);
      const sop = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (sop?.id) map[sop.id] = sop;
    } catch (err) {
      console.error("[coact] failed to load sop", name, err.message);
    }
  }
}

function loadAllSops() {
  const map = {};
  for (const dir of sopsSearchDirs()) {
    loadSopsFromDir(dir, map);
  }
  return map;
}

let sops = loadAllSops();

function reloadSops() {
  sops = loadAllSops();
  return sops;
}

function watchSopsDir() {
  for (const sopsDir of sopsSearchDirs()) {
    try {
      if (!fs.existsSync(sopsDir)) fs.mkdirSync(sopsDir, { recursive: true });
      let timer = null;
      fs.watch(sopsDir, { persistent: false }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          reloadSops();
          console.log("[coact] reloaded SOPs from", sopsDir);
        }, 250);
      });
    } catch (err) {
      console.error("[coact] sop watch failed", sopsDir, err.message);
    }
  }
}

let mainWindow = null;
let tailWindow = null;
let bridge = null;
let pdfViewServer = null;
let activeRun = null;
/** Agent-approved values for the current run — edits here are intentional, not mistakes. */
let activeRunAgentApproved = null;
let activeWatch = null;
/** @type {Map<string, Map<string, object>>} cardId → stepId → action record */
const cardActions = new Map();
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
let tailMode = false;
/** @type {{ ok: boolean, issues: any[], staleCount: number, error?: string, fetchedAt?: string } | null} */
let jiraSnapshot = null;
let jiraPollTimer = null;
let jiraPollInFlight = false;
/** @type {Promise<object|null>|null} */
let jiraRefreshPromise = null;
/** Faster poll while the Jira sidebar pane is visible */
let jiraPaneActive = false;
const JIRA_ACTIVE_POLL_MS = 15_000;

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
  { filledPdfSource = null, fillMode = null } = {},
) {
  if (!cardId) return null;
  const now = Date.now();
  const prev = finalizedAt.get(cardId) || 0;
  if (now - prev < 5000) return null;
  finalizedAt.set(cardId, now);

  refreshQueue();
  const card = queue.find((c) => c.id === cardId);
  if (!card) return null;

  let actions = actionsListForCard(cardId);
  const sop = sops[card.sopId];
  const mistakes = mergeFinalValueMistakes(
    card,
    sop,
    actions,
    mistakesListForCard(cardId),
  );

  // Fallback: if extension didn't send values, use case data for fill steps
  if (!actions.length && sop?.steps?.length) {
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
  } else if (sop?.steps?.length) {
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
  if (!filledSource && sop) {
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
      actions,
      mistakes,
      fillMode,
      filledPdfSource: filledSource,
      jiraKey: realKey || "",
      formReference: pageCtx.formReference || "",
      pageUrl,
    });
    console.log(
      "[coact] saved execution",
      result.fillMode,
      `mistakes=${mistakes.length}`,
      `ref=${result.formReference || "—"}`,
      result.excelPath,
      result.sqlResult
        ? `(sql rows=${result.sqlResult.runCount})`
        : "",
    );

    // Mandatory: append a NEW Jira comment for every execution (never overwrite)
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

    clearCardActions(cardId);
    clearCardMistakes(cardId);
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
  const summary = mandatorySummaryForCard(card.id, answers || {}, queue);
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
    mandatorySummary: summary?.text || "",
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

// User-facing Dock / menu name (packaged builds use productName from package.json)
if (typeof app?.setName === "function") {
  app.setName("liveAct");
}

function defaultMainBounds() {
  const { screen } = require("electron");
  const display = screen.getPrimaryDisplay().workArea;
  const width = 520;
  const height = Math.min(640, display.height - 40);
  return {
    width,
    height,
    x: display.x + display.width - width - 16,
    y: display.y + display.height - height - 16,
  };
}

function refreshQueue() {
  migrateLegacyDocumentsCoact();
  seedSampleCases(documentsRoot);
  let userId = "";
  try {
    userId = os.userInfo().username || "";
  } catch {
    userId = "";
  }
  const loaded = loadQueueFromDocuments(documentsRoot, {
    userId,
    filterByUser: true,
  });
  documentsRoot = loaded.rootDir;
  queue = loaded.cards;
  return loaded;
}

function pinFloatingWindow(win) {
  if (!win || win.isDestroyed()) return;
  // Highest practical always-on-top level above Chrome / Cursor
  win.setAlwaysOnTop(true, "screen-saver", 1);
  try {
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  } catch {
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      /* ignore */
    }
  }
  try {
    win.moveTop();
  } catch {
    /* ignore */
  }
}

function applyAlwaysOnTop(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const on = Boolean(enabled);
  if (on) {
    pinFloatingWindow(mainWindow);
  } else {
    mainWindow.setAlwaysOnTop(false);
    try {
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
  // Soft keep-alive: re-assert level only when lost. Never moveTop/show/focus here —
  // those every few hundred ms cause visible flicker and steal focus from Chrome.
  alwaysOnTopTimer = setInterval(() => {
    if (app.isQuitting) return;
    if (tailMode) {
      if (tailWindow && !tailWindow.isDestroyed() && tailWindow.isVisible()) {
        try {
          if (!tailWindow.isAlwaysOnTop()) {
            tailWindow.setAlwaysOnTop(true, "screen-saver", 1);
          }
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) return;
    try {
      if (!mainWindow.isAlwaysOnTop()) {
        mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
      }
    } catch {
      /* ignore */
    }
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
    // Frameless + panel = true floating overlay (titleBarStyle breaks panel mask)
    frame: false,
    title: "liveAct",
    backgroundColor: "#ffffff",
    alwaysOnTop: true,
    hasShadow: true,
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
    },
  });

  pinFloatingWindow(mainWindow);
  startAlwaysOnTopKeepAlive();
  normalBounds = mainWindow.getBounds();

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
    setTimeout(() => {
      if (app.isQuitting || tailMode) return;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      applyAlwaysOnTop(true);
    }, 50);
  });

  mainWindow.on("show", () => {
    if (!tailMode) applyAlwaysOnTop(true);
  });

  mainWindow.on("focus", () => {
    if (!tailMode) applyAlwaysOnTop(true);
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function tailBounds() {
  const { screen } = require("electron");
  const display = screen.getPrimaryDisplay().workArea;
  const size = 72;
  return {
    width: size,
    height: size,
    x: display.x + display.width - size - 20,
    y: display.y + display.height - size - 20,
  };
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
    hasShadow: true,
    focusable: true,
    show: false,
    acceptFirstMouse: true,
    backgroundColor: "#00000000",
    ...(process.platform === "darwin"
      ? { type: "panel", roundedCorners: false }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "tail-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
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
  if (tailWindow && !tailWindow.isDestroyed()) {
    tailWindow.webContents.send("tail-status", payload);
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
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
      const synced = syncQueueCardsFromJira(jiraSnapshot.issues || []);
      if (synced > 0) {
        refreshQueue();
        sendToRenderer("queue-updated", {
          queue: queue.map(enrichCard),
          publishedAt: Date.now(),
          rootDir: documentsRoot,
          jiraSync: true,
        });
      }
      publishJiraSnapshot();
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
function syncQueueCardsFromJira(issues) {
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
      const res = updateQueueCardStatus(cardId, desired, queue);
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

function scheduleNextJiraPoll() {
  stopJiraPolling();
  jiraPollTimer = setTimeout(() => {
    refreshJira()
      .catch((err) => console.error("[coact] jira poll", err))
      .finally(() => scheduleNextJiraPoll());
  }, jiraPollDelayMs());
}

function startJiraPolling() {
  stopJiraPolling();
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
    formUrl: card.formUrl || sop?.formUrl || null,
    pdfPath: card.pdfPath || sop?.pdfPath || null,
    formMatch,
  };
}

function browserTargetFor(card, sop) {
  return {
    formUrl: card.formUrl || sop?.formUrl || null,
    formMatch: [
      ...(Array.isArray(card.formMatch) ? card.formMatch : []),
      ...(Array.isArray(sop?.formMatch) ? sop.formMatch : []),
    ],
  };
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

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  nativeTheme.themeSource = "light";
  refreshQueue();
  watchSopsDir();

  pdfViewServer = createPdfViewServer();
  pdfViewServer.start().catch((err) => {
    console.error("[coact] pdf view server failed", err.message);
    pdfViewServer = null;
  });

  try {
    bridge = createBridge({
      onReloadQueue() {
        return publishQueueToRenderer();
      },
      onListening(info) {
        sendToRenderer("extension-status", {
          connected: false,
          bridgeUp: true,
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
            ? `Port 17321 in use — quit other liveAct windows, then restart`
            : code || err?.message || "bridge_error";
        sendToRenderer("extension-status", {
          connected: false,
          bridgeUp: false,
          bridgeError,
        });
      },
      onExtensionStatus(status) {
        const connectedNow = Boolean(status?.connected);
        const payload = {
          connected: connectedNow,
          bridgeUp: true,
        };
        if (status?.clientId) payload.clientId = status.clientId;
        if (status?.reconnected) payload.reconnected = true;
        // Only forward tab fields when present — connection events must not wipe tabUrl
        if (Object.prototype.hasOwnProperty.call(status || {}, "tabUrl")) {
          payload.tabUrl = status.tabUrl || null;
          payload.tabTitle = status.tabTitle || null;
          if (status.activated) payload.activated = true;
          if (status.tabUrl) lastExtensionTabUrl = status.tabUrl;
        }

        // Drop stale bindings after long idle / extension SW restart
        if (!connectedNow) {
          activeRun = null;
          if (activeWatch?.cardId) {
            activeWatch = { cardId: activeWatch.cardId, clientId: null };
          }
        } else if (status?.clientId) {
          if (activeWatch?.cardId && activeWatch.clientId !== status.clientId) {
            activeWatch = {
              cardId: activeWatch.cardId,
              clientId: status.clientId,
            };
          }
          if (activeRun?.clientId && activeRun.clientId !== status.clientId) {
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
          }
        }
      },
    });
  } catch (err) {
    console.error("[coact] bridge failed to start", err);
    bridge = null;
  }

  createWindow();
  startJiraPolling();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopAlwaysOnTopKeepAlive();
  stopJiraPolling();
});

app.on("window-all-closed", () => {
  if (bridge) bridge.close();
  if (pdfViewServer) pdfViewServer.close();
  app.quit();
});

ipcMain.handle("get-bootstrap", () => {
  reloadSops();
  refreshQueue();
  const ai = getOpenAiConfig();
  return {
    queue: queue.map(enrichCard),
    extensionConnected: bridge ? bridge.isExtensionConnected() : false,
    openai: { hasKey: ai.hasKey, model: ai.model },
    jira: jiraSnapshot,
  };
});

function publishQueueToRenderer({ raise = false } = {}) {
  reloadSops();
  const loaded = refreshQueue();
  const payload = {
    queue: queue.map(enrichCard),
    publishedAt: Date.now(),
    rootDir: loaded?.rootDir || documentsRoot,
    allCardCount: loaded?.allCardCount ?? queue.length,
  };
  sendToRenderer("queue-updated", payload);
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

ipcMain.handle("refresh-queue", () => {
  const result = publishQueueToRenderer({ raise: true });
  return {
    queue: queue.map(enrichCard),
    ...result,
  };
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

  activeRun = { cardId: card.id, mode: "pdf" };
  activeWatch = { cardId: card.id, mode: "pdf" };
  clearCardActions(card.id);
  clearCardMistakes(card.id);
  finalizedAt.delete(card.id);

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
      }
    } catch (err) {
      console.error("[coact] pdf fill failed", err);
      activeRun = null;
      sendToRenderer("run-finished", {
        cardId: card.id,
        status: "failed",
        reason: err.message || String(err),
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

  // Fillable PDFs: fill on disk and open the result in Chrome
  if (pdfPath && prefer) {
    activeRunAgentApproved = agentApproved
      ? {
          cardId: card.id,
          values: agentApprovedValues,
          dataOverrides: options?.dataOverrides || {},
        }
      : null;
    return runPdfCard(card, sop, options);
  }

  if (!bridge || !bridge.isExtensionConnected()) {
    if (pdfPath) {
      activeRunAgentApproved = agentApproved
        ? {
            cardId: card.id,
            values: agentApprovedValues,
            dataOverrides: options?.dataOverrides || {},
          }
        : null;
      return runPdfCard(card, sop, options);
    }
    return { ok: false, error: "extension_offline" };
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
  finalizedAt.delete(card.id);
  activeRun = { cardId: card.id, clientId: delivery.clientId };
  activeWatch = { cardId: card.id, clientId: delivery.clientId };
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

ipcMain.handle("watch-card", async (_event, cardId, options = {}) => {
  refreshQueue();
  reloadSops();
  if (!cardId) {
    activeWatch = null;
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

  if (bridge && bridge.isExtensionConnected()) {
    const delivery = bridge.sendWatchCard({
      cardId: card.id,
      title: card.title,
      sop,
      data: card.data || {},
      target: browserTargetFor(card, sop),
      clientId: activeWatch?.clientId || null,
      resetProgress: Boolean(options?.resetProgress),
      clearFields: Boolean(options?.clearFields),
    });
    if (!delivery.ok) return delivery;
    activeWatch = { cardId: card.id, clientId: delivery.clientId };
  } else if (options?.clearFields || options?.resetProgress) {
    const { prefer, pdfPath } = cardPrefersPdf(card, sop);
    if (prefer && pdfPath) {
      try {
        return await clearPdfCard(card, sop);
      } catch (err) {
        return { ok: false, error: err.message || "pdf_clear_failed" };
      }
    }
    return { ok: false, error: "extension_offline" };
  }

  return {
    ok: true,
    watching: true,
    steps: sop.steps.map((step) => stepForUi(step, "pending")),
  };
});

ipcMain.handle("control-run", (_event, action) => {
  if (!bridge) return { ok: false };
  return {
    ok: bridge.sendControl(
      action,
      activeRun?.clientId || activeWatch?.clientId,
    ),
  };
});

function persistCardData(card) {
  if (!card?.sourceDir || !card.data) return;
  try {
    fs.writeFileSync(
      path.join(card.sourceDir, "data.json"),
      `${JSON.stringify(card.data, null, 2)}\n`,
      "utf8"
    );
  } catch (err) {
    console.error("[coact] persist card data failed", err.message);
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

ipcMain.handle("request-tab-status", () => {
  if (!bridge) return { ok: false };
  return { ok: bridge.requestStatus() };
});

ipcMain.handle("get-openai-settings", () => {
  return getAppSettings();
});

ipcMain.handle("save-openai-settings", (_event, payload) => {
  const result = saveSettings({
    openaiApiKey: payload?.apiKey != null ? String(payload.apiKey) : undefined,
    openaiModel: payload?.model != null ? String(payload.model) : undefined,
    executionsRoot:
      payload?.executionsRoot != null ? String(payload.executionsRoot) : undefined,
    jiraBaseUrl: payload?.jiraBaseUrl != null ? String(payload.jiraBaseUrl) : undefined,
    jiraEmail: payload?.jiraEmail != null ? String(payload.jiraEmail) : undefined,
    jiraApiToken: payload?.jiraApiToken != null ? String(payload.jiraApiToken) : undefined,
    jiraJql: payload?.jiraJql != null ? String(payload.jiraJql) : undefined,
    jiraStaleDays: payload?.jiraStaleDays != null ? payload.jiraStaleDays : undefined,
    jiraPollMinutes: payload?.jiraPollMinutes != null ? payload.jiraPollMinutes : undefined,
    jiraStatusMap: payload?.jiraStatusMap != null ? payload.jiraStatusMap : undefined,
    jiraCardKeyField:
      payload?.jiraCardKeyField != null ? String(payload.jiraCardKeyField) : undefined,
  });
  startJiraPolling();
  return { ok: true, ...result };
});

ipcMain.handle("jira-refresh", async () => {
  const snap = await refreshJira({ force: true });
  return {
    ...(snap || { ok: false, issues: [], staleCount: 0 }),
    recentActions: recentJiraActions(5),
  };
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

ipcMain.handle("jira-recent-actions", () => {
  return { ok: true, actions: recentJiraActions(5) };
});

ipcMain.handle("get-execution-dashboard", async () => {
  const config = getJiraConfig();
  try {
    return await buildAgentDashboard({
      queueCards: queue,
      days: 14,
      jiraBaseUrl: config.jiraBaseUrl || "",
      jiraCardKeyField: config.jiraCardKeyField || "jiraKey",
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

ipcMain.handle("capture-region-snip", async () => {
  const wasTail = Boolean(tailMode);
  const mainVisible =
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  const tailVisible =
    tailWindow && !tailWindow.isDestroyed() && tailWindow.isVisible();

  return captureRegionSnip({
    hide: async () => {
      if (mainWindow && !mainWindow.isDestroyed() && mainVisible) {
        mainWindow.hide();
      }
      if (tailWindow && !tailWindow.isDestroyed() && tailVisible) {
        tailWindow.hide();
      }
    },
    restore: async () => {
      if (wasTail) {
        const tw = ensureTailWindow();
        tw.setBounds(tailBounds());
        tw.show();
        tw.moveTop();
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed() && mainVisible) {
        mainWindow.show();
        applyAlwaysOnTop(mainWindow.isAlwaysOnTop());
        mainWindow.focus();
      }
    },
  });
});

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
      payload?.cardId || activeWatch?.cardId || activeRun?.cardId || null;
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
      autoApplyTools: payload?.autoApplyTools !== false,
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