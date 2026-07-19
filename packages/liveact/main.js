const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { createBridge } = require("./bridge");
const {
  defaultDocumentsRoot,
  loadQueueFromDocuments,
  seedSampleCases,
} = require("./documents");
const { getOpenAiConfig, saveSettings, getAppSettings } = require("./settings");
const {
  streamChat,
  coachStuckStep,
  repairFailedStep,
  judgeValueMatch,
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

/** User-writable SOPs (SOP builder + installed app) */
function userSopsDir() {
  return path.join(os.homedir(), "Documents", "Coact", "sops");
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
let activeWatch = null;
/** @type {Map<string, Map<string, object>>} cardId → stepId → action record */
const cardActions = new Map();
/** @type {Map<string, object[]>} cardId → wrong-value attempts (for tracking) */
const cardMistakes = new Map();
/** Prevent double-save for the same card in a short window */
const finalizedAt = new Map();
let documentsRoot = defaultDocumentsRoot();
let queue = [];
let normalBounds = null;
let tailMode = false;

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
 */
function recordCardMistake(cardId, update) {
  if (!cardId || !update?.stepId) return;
  if (update.status !== "mismatch") return;

  const card = queue.find((c) => c.id === cardId);
  const sop = card ? sops[card.sopId] : null;
  const step = sop?.steps?.find((s) => s.id === update.stepId);
  // Only steps marked mandatory (key icon in liveAct)
  if (!step?.mandatory) return;

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
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
    if (normalizeMistakeCompare(actual) === normalizeMistakeCompare(expected)) {
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
    const result = await saveExecutionArtifacts({
      lob: card.lob || "TCOO",
      queueCard: card.id,
      cardTitle: card.title,
      actions,
      mistakes,
      fillMode,
      filledPdfSource: filledSource,
    });
    console.log(
      "[coact] saved execution",
      result.fillMode,
      `mistakes=${mistakes.length}`,
      result.excelPath,
      result.sqlResult
        ? `(sql rows=${result.sqlResult.runCount})`
        : "",
    );
    clearCardActions(cardId);
    clearCardMistakes(cardId);
    return result;
  } catch (err) {
    console.error("[coact] save execution artifacts failed", err.message);
    return null;
  }
}

// User-facing Dock / menu name (packaged builds use productName from package.json)
if (typeof app?.setName === "function") {
  app.setName("liveAct");
}

function defaultMainBounds() {
  const { screen } = require("electron");
  const display = screen.getPrimaryDisplay().workArea;
  const width = 420;
  const height = Math.min(640, display.height - 40);
  return {
    width,
    height,
    x: display.x + display.width - width - 16,
    y: display.y + display.height - height - 16,
  };
}

function refreshQueue() {
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
  // Re-assert level only — avoid re-calling setVisibleOnAllWorkspaces (dock flicker)
  alwaysOnTopTimer = setInterval(() => {
    if (app.isQuitting) return;
    if (tailMode) {
      if (tailWindow && !tailWindow.isDestroyed() && tailWindow.isVisible()) {
        try {
          tailWindow.setAlwaysOnTop(true, "screen-saver", 1);
          tailWindow.moveTop();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) return;
    try {
      mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
      mainWindow.moveTop();
    } catch {
      /* ignore */
    }
  }, 400);
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
      onListening() {
        sendToRenderer("extension-status", {
          connected: false,
          bridgeUp: true,
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopAlwaysOnTopKeepAlive();
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
  };
});

ipcMain.handle("refresh-queue", () => {
  reloadSops();
  refreshQueue();
  return {
    queue: queue.map(enrichCard),
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
        data: card.data || {},
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
                  ? String(card.data?.[step.valueFrom] ?? card.data?.[step.id] ?? "")
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

  const { prefer, pdfPath } = cardPrefersPdf(card, sop);

  // Fillable PDFs: fill on disk and open the result in Chrome
  if (pdfPath && prefer) {
    return runPdfCard(card, sop, options);
  }

  if (!bridge || !bridge.isExtensionConnected()) {
    if (pdfPath) return runPdfCard(card, sop, options);
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
    data: card.data,
    sop,
    target: browserTargetFor(card, sop),
    startIndex,
    completedStepIds,
  });
  if (!delivery.ok) return delivery;

  clearCardActions(card.id);
  clearCardMistakes(card.id);
  finalizedAt.delete(card.id);
  activeRun = { cardId: card.id, clientId: delivery.clientId };
  activeWatch = { cardId: card.id, clientId: delivery.clientId };

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
  });
  return { ok: true, ...result };
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
