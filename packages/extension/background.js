// Must match packages/shared/protocol.js (BRIDGE_PORT / BRIDGE_URL).
// Extension cannot require Node modules — keep these in sync manually.
// 127.0.0.1 is intentional: liveAct + extension always run on the SAME machine.
// That is each PC's own loopback — never hardcode someone else's LAN IP.
// Optional rare remote overrides (chrome.storage.local):
//   bridgeHost: "192.168.x.x"  → ws://that-host:17321
//   bridgeUrl:  "ws://host:17321" (full URL wins over bridgeHost)
const DEFAULT_BRIDGE_HOST = "127.0.0.1";
const DEFAULT_BRIDGE_PORT = 17321;
const DEFAULT_BRIDGE_URL = `ws://${DEFAULT_BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}`;
let BRIDGE_URL = DEFAULT_BRIDGE_URL;
let BRIDGE_HEALTH = `http://${DEFAULT_BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}/health`;

function applyBridgeUrl(wsUrl) {
  const url = String(wsUrl || "").trim() || DEFAULT_BRIDGE_URL;
  BRIDGE_URL = url;
  try {
    const httpBase = url.replace(/^ws/i, "http");
    const u = new URL(httpBase);
    BRIDGE_HEALTH = `${u.origin}/health`;
  } catch {
    BRIDGE_HEALTH = `http://${DEFAULT_BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}/health`;
  }
}

function applyBridgeHost(host) {
  const h = String(host || "").trim() || DEFAULT_BRIDGE_HOST;
  applyBridgeUrl(`ws://${h}:${DEFAULT_BRIDGE_PORT}`);
}

chrome.storage.local.get(["bridgeHost", "bridgeUrl"]).then((stored) => {
  if (stored?.bridgeUrl) applyBridgeUrl(stored.bridgeUrl);
  else if (stored?.bridgeHost) applyBridgeHost(stored.bridgeHost);
  if (stored?.bridgeUrl || stored?.bridgeHost) connect(true);
});

// Stable per browser profile so desktop can rebind after SW restarts.
let bridgeClientId = `${chrome.runtime.id}:boot`;
chrome.storage.session.get(["bridgeClientId"]).then((stored) => {
  if (stored?.bridgeClientId) {
    bridgeClientId = stored.bridgeClientId;
    return;
  }
  bridgeClientId = `${chrome.runtime.id}:${
    crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }`;
  chrome.storage.session.set({ bridgeClientId }).catch(() => {});
});
const MessageType = {
  HELLO: "hello",
  PING: "ping",
  PONG: "pong",
  RUN_CARD: "run_card",
  WATCH_CARD: "watch_card",
  APPLY_STEP: "apply_step",
  REPAIR_PLAN: "repair_plan",
  VALUE_CHECK_RESULT: "value_check_result",
  STEP_UPDATE: "step_update",
  CONTROL: "control",
  STATUS: "status",
  CAPTURE_SNIPPET: "capture_snippet",
  SNIPPET: "snippet",
  REQUEST_STATUS: "request_status",
  OPEN_URL: "open_url",
};

let socket = null;
let reconnectTimer = null;
let keepAliveTimer = null;
let handshakeTimer = null;
let connected = false;
let lastError = "";
let connecting = false;
/** Quiet waiting for liveAct — not an error */
let waitingForApp = true;
let reconnectAttempt = 0;
/** Last time desktop answered (HELLO / PONG / PING). Stale means orphaned WS. */
let lastDesktopSeenAt = 0;
const SILENCE_MS = 45000;
const HANDSHAKE_MS = 8000;
/** Last watch sent to the focused tab (for reconnect). Never cross-apply to other tabs. */
let lastWatchPayload = null;
/** @type {Map<number, { type: string, cardId: string, sop: object }>} */
const watchByTabId = new Map();
/** Active multi-page SOP run waiting to resume after navigation */
let sopRunResume = null;
let tabStatusTimer = null;
/** @type {Map<string, { resolve: Function, timer: any, tabId: number|null }>} */
const pendingRepairs = new Map();
/** @type {Map<string, { resolve: Function, timer: any, tabId: number|null }>} */
const pendingValueChecks = new Map();

function resolveRepair(repairId, plan) {
  const pending = pendingRepairs.get(repairId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingRepairs.delete(repairId);
  pending.resolve(plan);
  return true;
}

function resolveValueCheck(checkId, result) {
  const pending = pendingValueChecks.get(checkId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingValueChecks.delete(checkId);
  pending.resolve(result);
  return true;
}

function isInjectableUrl(url) {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

function setConnected(value) {
  connected = value;
  if (value) {
    waitingForApp = false;
    lastError = "";
    reconnectAttempt = 0;
  }
  chrome.storage.session.set({
    bridgeConnected: value,
    waitingForApp: !value,
    lastError: value ? "" : lastError,
  });
  // Quiet offline: no alarming badge text while liveAct is simply closed
  if (value) {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#d71e28" });
  } else {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setBadgeBackgroundColor({ color: "#666666" });
  }
}

/** Probe HTTP first so we don't open a WebSocket (and spam console) when liveAct is closed. */
async function liveActIsUp() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 700);
    const res = await fetch(BRIDGE_HEALTH, {
      method: "GET",
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

function send(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function clearHandshakeTimer() {
  if (handshakeTimer) {
    clearTimeout(handshakeTimer);
    handshakeTimer = null;
  }
}

function markDesktopAlive() {
  lastDesktopSeenAt = Date.now();
  clearHandshakeTimer();
  if (!connected) {
    setConnected(true);
    lastError = "";
    reportTabStatus().catch(() => {});
  }
}

function forceReconnect(reason) {
  const soft =
    !reason ||
    /silent|not open|not reachable|no handshake|reconnecting|send failed/i.test(String(reason));
  lastError = soft ? "" : reason || lastError;
  waitingForApp = true;
  stopKeepAlive();
  clearHandshakeTimer();
  cleanupSocket();
  setConnected(false);
  scheduleReconnect();
}

function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    // A desktop restart can leave a stale TCP socket open; reconnect when it goes silent.
    if (lastDesktopSeenAt && Date.now() - lastDesktopSeenAt > SILENCE_MS) {
      forceReconnect("Bridge went silent — reconnecting");
      return;
    }
    if (!send({ type: MessageType.PING })) {
      forceReconnect(lastError || "WebSocket send failed");
    }
  }, 20000);
}

async function getActiveTab() {
  // Prefer the last focused Chrome/Edge window (Coact steals OS focus)
  const lastFocused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const preferred = lastFocused.find((t) => isInjectableUrl(t.url));
  if (preferred) return preferred;

  const actives = await chrome.tabs.query({ active: true });
  const injectable = actives.find((t) => isInjectableUrl(t.url));
  if (injectable) return injectable;

  const [fallback] = await chrome.tabs.query({ active: true, currentWindow: true });
  return fallback || null;
}

async function getSnippetTab() {
  const active = await getActiveTab();
  if (active?.id != null && isInjectableUrl(active.url)) return active;

  // Fall back to any open http(s) tab (prefer Google Forms)
  const all = await chrome.tabs.query({});
  const forms = all.find((t) => /docs\.google\.com\/forms|forms\.gle/i.test(t.url || ""));
  if (forms) return forms;
  return all.find((t) => isInjectableUrl(t.url)) || null;
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make sure the form tab is active and its window is not minimized.
 * Do NOT steal OS focus from Coact — focusing Chrome was hiding the panel.
 */
async function ensureBrowserVisible(tab, { cardId = null, timeoutMs = 45000 } = {}) {
  if (!tab?.windowId) return false;

  const started = Date.now();
  let announced = false;

  while (Date.now() - started < timeoutMs) {
    try {
      let win = await chrome.windows.get(tab.windowId);
      if (win?.state === "minimized") {
        await chrome.windows.update(tab.windowId, { state: "normal", focused: false });
      }
      if (tab.id != null) {
        await chrome.tabs.update(tab.id, { active: true });
      }

      win = await chrome.windows.get(tab.windowId);
      if (win && win.state !== "minimized") {
        await sleep(200);
        return true;
      }
    } catch {
      /* retry */
    }

    if (cardId && !announced) {
      announced = true;
      send({
        type: MessageType.STEP_UPDATE,
        cardId,
        status: "reasoning",
        reason: "Un-minimize the form window (liveAct stays open).",
      });
    }
    await sleep(400);
  }

  if (cardId) {
    send({
      type: MessageType.STEP_UPDATE,
      cardId,
      status: "run_failed",
      error: "Browser not visible",
      reason:
        "Form window is minimized. Restore Chrome/Edge, keep the form tab open, then press Start.",
    });
  }
  return false;
}

async function reportTabStatus(explicitTab = null, { activated = false } = {}) {
  try {
    // If no Chrome/Edge window is focused (user is in Cursor, Slack, etc.), clear UI focus
    const windows = await chrome.windows.getAll();
    const browserFocused = windows.some((w) => w.focused);
    if (!browserFocused) {
      reportBrowserBlurred();
      return;
    }

    const tab = explicitTab || (await getActiveTab());
    send({
      type: MessageType.STATUS,
      clientId: bridgeClientId,
      tabUrl: isInjectableUrl(tab?.url) ? tab.url : null,
      tabTitle: tab?.title || null,
      activated: Boolean(activated),
      browserFocused: true,
    });
  } catch {
    /* ignore */
  }
}

/** Browser lost OS focus to another app (Cursor, Slack, liveAct, etc.) */
function reportBrowserBlurred() {
  // Keep last tab URL so desktop can still Clear / Approve the form tab.
  getActiveTab()
    .then((tab) => {
      send({
        type: MessageType.STATUS,
        clientId: bridgeClientId,
        tabUrl: tab?.url && isInjectableUrl(tab.url) ? tab.url : undefined,
        tabTitle: tab?.title || undefined,
        activated: false,
        browserFocused: false,
        blurred: true,
      });
    })
    .catch(() => {
      send({
        type: MessageType.STATUS,
        clientId: bridgeClientId,
        activated: false,
        browserFocused: false,
        blurred: true,
      });
    });
}

function cleanupSocket() {
  if (!socket) return;
  try {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
  } catch {
    /* ignore */
  }
  socket = null;
  connecting = false;
}

function connect(force = false) {
  if (!force && (connected || connecting)) return;
  if (
    !force &&
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  cleanupSocket();
  stopKeepAlive();
  connecting = true;
  waitingForApp = true;
  lastError = "";

  // Don't open WebSocket until liveAct is up — avoids ERR_CONNECTION_REFUSED spam
  liveActIsUp().then((up) => {
    if (!up) {
      connecting = false;
      setConnected(false);
      scheduleReconnect();
      return;
    }
    openWebSocket();
  });
}

function openWebSocket() {
  connecting = true;
  let ws;
  try {
    ws = new WebSocket(BRIDGE_URL);
  } catch {
    connecting = false;
    lastError = "";
    waitingForApp = true;
    setConnected(false);
    scheduleReconnect();
    return;
  }

  socket = ws;

  ws.addEventListener("open", () => {
    if (socket !== ws) return;
    connecting = false;
    lastError = "";
    // Do NOT mark connected on TCP open — wait for desktop HELLO/PING/PONG.
    lastDesktopSeenAt = 0;
    send({
      type: MessageType.HELLO,
      role: "extension",
      clientId: bridgeClientId,
      version: "0.1.30",
    });
    if (tabStatusTimer) clearInterval(tabStatusTimer);
    tabStatusTimer = setInterval(() => {
      if (connected) reportTabStatus();
    }, 1500);
    startKeepAlive();
    clearHandshakeTimer();
    handshakeTimer = setTimeout(() => {
      handshakeTimer = null;
      if (!connected) {
        forceReconnect("No handshake from liveAct — reconnecting");
      }
    }, HANDSHAKE_MS);
  });

  ws.addEventListener("message", async (event) => {
    if (socket !== ws) return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (
      msg.type === MessageType.PING ||
      msg.type === MessageType.PONG ||
      msg.type === MessageType.HELLO
    ) {
      markDesktopAlive();
      if (msg.type === MessageType.HELLO) {
        send({
          type: MessageType.HELLO,
          role: "extension",
          clientId: bridgeClientId,
          version: "0.1.30",
        });
        if (connected) reportTabStatus().catch(() => {});
      }
      if (msg.type === MessageType.PING) send({ type: MessageType.PONG });
      return;
    }

    if (msg.type === MessageType.RUN_CARD) {
      await handleRunCard(msg);
      return;
    }

    if (msg.type === MessageType.WATCH_CARD) {
      await handleWatchCard(msg);
      return;
    }

    if (msg.type === MessageType.APPLY_STEP) {
      await handleApplyStep(msg);
      return;
    }

    if (msg.type === MessageType.REPAIR_PLAN) {
      const repairId = msg.repairId;
      if (repairId) {
        resolveRepair(repairId, {
          action: msg.action || "retry_broad",
          broadMatch: Boolean(msg.broadMatch),
          valueOverride: msg.valueOverride || null,
          stepPatch: msg.stepPatch || null,
          altFindByText: msg.altFindByText || null,
          reason: msg.reason || "",
          ok: msg.ok !== false,
        });
      }
      return;
    }

    if (msg.type === MessageType.VALUE_CHECK_RESULT) {
      const checkId = msg.checkId;
      if (checkId) {
        resolveValueCheck(checkId, {
          match: Boolean(msg.match),
          reason: msg.reason || "",
          ok: msg.ok !== false,
        });
      }
      return;
    }

    if (msg.type === MessageType.CONTROL) {
      if (msg.action === "cancel") clearSopRunResume();
      const tab = await getActiveTab();
      if (tab?.id != null && isInjectableUrl(tab.url)) {
        chrome.tabs.sendMessage(tab.id, { type: "control", action: msg.action }).catch(() => {});
      }
      return;
    }

    if (msg.type === MessageType.CAPTURE_SNIPPET) {
      await handleCaptureSnippet(msg);
      return;
    }

    if (msg.type === MessageType.REQUEST_STATUS) {
      await reportTabStatus();
      return;
    }

    if (msg.type === MessageType.OPEN_URL) {
      await handleOpenUrl(msg);
    }
  });

  ws.addEventListener("close", () => {
    if (socket !== ws) return;
    connecting = false;
    stopKeepAlive();
    clearHandshakeTimer();
    socket = null;
    waitingForApp = true;
    lastError = "";
    setConnected(false);
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    if (socket !== ws) return;
    // Expected when liveAct quits — not a user-facing error
    lastError = "";
    waitingForApp = true;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempt = Math.min((reconnectAttempt || 0) + 1, 8);
  const delay = Math.min(1500 * Math.pow(1.45, reconnectAttempt - 1), 12000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(true);
  }, delay);
}

async function sendToTab(tabId, payload, { failCardId = null } = {}) {
  if (tabId == null) {
    if (failCardId) {
      send({
        type: MessageType.STEP_UPDATE,
        cardId: failCardId,
        status: "run_failed",
        error: "No Chrome tab found.",
      });
    }
    return false;
  }

  try {
    await chrome.tabs.sendMessage(tabId, payload);
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tabId, payload);
      return true;
    } catch (err) {
      if (failCardId) {
        send({
          type: MessageType.STEP_UPDATE,
          cardId: failCardId,
          status: "run_failed",
          error: err?.message || "Could not inject into this page.",
        });
      }
      return false;
    }
  }
}

async function sendToActiveTab(payload, { failCardId = null } = {}) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    if (failCardId) {
      send({
        type: MessageType.STEP_UPDATE,
        cardId: failCardId,
        status: "run_failed",
        error: "No active Chrome tab found.",
      });
    }
    return false;
  }

  if (!isInjectableUrl(tab.url)) {
    if (failCardId) {
      send({
        type: MessageType.STEP_UPDATE,
        cardId: failCardId,
        status: "run_failed",
        error: "Open the form page (http/https) — cannot fill chrome:// pages.",
      });
    }
    return false;
  }

  return sendToTab(tab.id, payload, { failCardId });
}

function clearSopRunResume() {
  sopRunResume = null;
}

async function resumeSopRunIfReady(tabId, tabUrl) {
  if (!sopRunResume || sopRunResume.tabId !== tabId) return;
  if (!isInjectableUrl(tabUrl)) return;

  const hint = sopRunResume.urlIncludes;
  const equals = sopRunResume.urlEquals;
  if (equals && tabUrl !== equals) return;
  if (hint && !tabUrl.includes(hint)) {
    // serve may keep or strip .html — accept either form of the hint
    const alt = hint.endsWith(".html") ? hint.slice(0, -5) : `${hint}.html`;
    if (!tabUrl.includes(alt)) return;
  }

  const resume = sopRunResume;
  clearSopRunResume();

  const steps = resume.sop?.steps || [];
  if (resume.nextIndex >= steps.length) {
    send({
      type: MessageType.STEP_UPDATE,
      cardId: resume.cardId,
      status: "run_complete",
    });
    return;
  }

  send({
    type: MessageType.STEP_UPDATE,
    cardId: resume.cardId,
    status: "reasoning",
    reason: `Continuing on next page (step ${resume.nextIndex + 1})…`,
  });

  // Keep watch attached across pages (include case data for mandatory checks)
  if (resume.sop) {
    const watchPayload = {
      type: "watch_sop",
      cardId: resume.cardId,
      sop: resume.sop,
      data: resume.data || {},
    };
    watchByTabId.set(tabId, watchPayload);
    lastWatchPayload = watchPayload;
  }

  await sleep(350);
  await sendToTab(
    tabId,
    {
      type: "run_sop",
      cardId: resume.cardId,
      data: resume.data,
      sop: resume.sop,
      startIndex: resume.nextIndex,
      // Background already activated this tab for the run
      bypassVisibilityGate: true,
    },
    { failCardId: resume.cardId }
  );
}

async function handleOpenUrl(msg) {
  const url = String(msg.url || "").trim();
  if (!url) return;

  const base = url.split("?")[0];
  const matchHint = String(msg.matchIncludes || msg.cardId || "").trim();

  try {
    const tabs = await chrome.tabs.query({});
    const existing =
      tabs.find((t) => {
        const u = t.url || "";
        if (!u) return false;
        if (u.split("?")[0] === base) return true;
        if (matchHint && u.includes(matchHint) && /\/pdf\//i.test(u)) return true;
        return false;
      }) || null;

    if (existing?.id != null) {
      // Reload same tab with cache-busted URL — do not create a second tab
      await chrome.tabs.update(existing.id, { url, active: true });
      if (existing.windowId != null) {
        await chrome.windows.update(existing.windowId, { focused: false }).catch(() => {});
      }
    } else {
      const created = await chrome.tabs.create({ url, active: true });
      if (created?.windowId != null) {
        await chrome.windows.update(created.windowId, { focused: false }).catch(() => {});
      }
    }

    // Keep liveAct pinned above Chrome after navigation
    send({
      type: MessageType.STATUS,
      kind: "open_url",
      ok: true,
      url,
      cardId: msg.cardId || null,
    });
  } catch (err) {
    console.warn("[coact] open_url failed", err);
  }
}

async function handleRunCard(msg) {
  clearSopRunResume();
  const tab = await getActiveTab();
  if (!tab?.id) {
    send({
      type: MessageType.STEP_UPDATE,
      cardId: msg.cardId,
      status: "run_failed",
      error: "No active Chrome tab found.",
    });
    return;
  }

  send({
    type: MessageType.STEP_UPDATE,
    cardId: msg.cardId,
    status: "reasoning",
    reason: "Waiting for Chrome/Edge…",
  });

  const visible = await ensureBrowserVisible(tab, { cardId: msg.cardId });
  if (!visible) return;

  await sendToActiveTab(
    {
      type: "run_sop",
      cardId: msg.cardId,
      data: msg.data,
      sop: msg.sop,
      startIndex: Math.max(0, Number(msg.startIndex) || 0),
      completedStepIds: Array.isArray(msg.completedStepIds) ? msg.completedStepIds : [],
      // ensureBrowserVisible already made the tab active; Coact may occlude Chrome
      bypassVisibilityGate: true,
    },
    { failCardId: msg.cardId }
  );
}

async function handleApplyStep(msg) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    send({
      type: MessageType.STEP_UPDATE,
      cardId: msg.cardId,
      stepId: msg.step?.id,
      status: "failed",
      error: "No active browser tab found.",
    });
    return;
  }

  await sendToActiveTab(
    {
      type: "apply_step",
      cardId: msg.cardId,
      data: msg.data || {},
      step: msg.step,
      valueOverride: msg.valueOverride,
      broadMatch: Boolean(msg.broadMatch),
      bypassVisibilityGate: true,
    },
    { failCardId: msg.cardId }
  );
}

async function handleWatchCard(msg) {
  const tab = await getActiveTab();

  if (!msg.cardId || !msg.sop) {
    lastWatchPayload = null;
    if (tab?.id != null) watchByTabId.delete(tab.id);
    await sendToActiveTab({ type: "watch_sop", cardId: null, sop: null });
    return;
  }

  lastWatchPayload = {
    type: "watch_sop",
    cardId: msg.cardId,
    sop: msg.sop,
    data: msg.data || {},
  };
  if (tab?.id != null) watchByTabId.set(tab.id, lastWatchPayload);

  const ok = await sendToActiveTab({
    ...lastWatchPayload,
    resetProgress: Boolean(msg.resetProgress),
    clearFields: Boolean(msg.clearFields),
  });
  if (!ok) {
    send({
      type: MessageType.STEP_UPDATE,
      cardId: msg.cardId,
      status: "reasoning",
      reason: "Focus the form tab, then press Refresh.",
    });
  }
}

async function handleCaptureSnippet(msg) {
  const requestId = msg.requestId || `snip-${Date.now()}`;
  const tab = await getSnippetTab();
  if (!tab?.id || !isInjectableUrl(tab.url)) {
    send({
      type: MessageType.SNIPPET,
      requestId,
      ok: false,
      error: "Focus an http(s) form tab first.",
    });
    return;
  }

  try {
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, { type: "capture_snippet" });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      result = await chrome.tabs.sendMessage(tab.id, { type: "capture_snippet" });
    }

    if (!result?.text) {
      // Direct in-page capture if messaging returned empty
      const [{ result: injected } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const title = document.title || "";
          const url = location.href;
          const items = Array.from(
            document.querySelectorAll(
              'div[role="listitem"], .Qr7Oae, .freebirdFormviewerComponentsQuestionBaseRoot'
            )
          ).slice(0, 12);
          const lines = [`URL: ${url}`, `Title: ${title}`, "Visible questions:"];
          for (const item of items) {
            const heading =
              item.querySelector('[role="heading"]')?.textContent ||
              item.innerText?.split("\n").find((l) => l.trim()) ||
              "";
            lines.push(`- ${String(heading).trim().slice(0, 160) || "(untitled)"}`);
          }
          return lines.join("\n");
        },
      });
      result = { ok: true, text: injected || "" };
    }

    send({
      type: MessageType.SNIPPET,
      requestId,
      ok: Boolean(result?.text),
      text: result?.text || "",
      title: tab.title || null,
      url: tab.url || null,
      error: result?.text ? null : "No form content found on this tab.",
    });
  } catch (err) {
    send({
      type: MessageType.SNIPPET,
      requestId,
      ok: false,
      error: err?.message || "Could not capture snippet",
    });
  }
}

/**
 * Re-inject watch only for THIS tab's own card (e.g. after refresh).
 * Never apply another form's watch — that caused the queue to thrash with 3 tabs.
 */
async function reapplyWatchForTab(tabId) {
  if (tabId == null) return;
  const payload = watchByTabId.get(tabId);
  if (!payload) return;
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tabId, payload);
    } catch {
      /* page not injectable yet */
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "page_context") {
    // Only the focused / visible tab may change which queue card is shown
    const tab = sender?.tab;
    if (tab && tab.active === false) {
      sendResponse({ ok: true, ignored: true });
      return true;
    }
    const tabUrl = message.url || tab?.url || null;
    const tabTitle = message.title || tab?.title || null;
    if (isInjectableUrl(tabUrl)) {
      send({
        type: MessageType.STATUS,
        tabUrl,
        tabTitle,
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "step_update") {
    send({
      type: MessageType.STEP_UPDATE,
      ...message.payload,
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "await_repair") {
    const repairId =
      message.repairId || `repair-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tabId = sender?.tab?.id ?? null;
    const payload = message.payload || {};

    send({
      type: MessageType.STEP_UPDATE,
      cardId: payload.cardId,
      stepId: payload.stepId || payload.step?.id,
      status: "needs_repair",
      repairId,
      error: payload.error || null,
      reason: payload.reason || "AI repairing step…",
      step: payload.step || null,
      snippet: payload.snippet || null,
    });

    const planPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingRepairs.delete(repairId);
        resolve({
          action: "retry_broad",
          broadMatch: true,
          reason: "Repair timed out — broader locator",
          ok: true,
        });
      }, 14000);
      pendingRepairs.set(repairId, { resolve, timer, tabId });
    });

    planPromise.then((plan) => sendResponse(plan));
    return true;
  }

  if (message?.type === "await_value_check") {
    const checkId =
      message.checkId || `vcheck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tabId = sender?.tab?.id ?? null;
    const payload = message.payload || {};

    send({
      type: MessageType.STEP_UPDATE,
      cardId: payload.cardId || null,
      stepId: payload.stepId || null,
      status: "value_check",
      checkId,
      expected: payload.expected ?? null,
      actual: payload.actual ?? null,
      suggestedValue: payload.expected ?? null,
      stepLabel: payload.stepLabel || null,
      valueFrom: payload.valueFrom || null,
      reason: "Checking value against case…",
    });

    const checkPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingValueChecks.delete(checkId);
        resolve({
          match: false,
          reason: "Value check timed out",
          ok: false,
        });
      }, 12000);
      pendingValueChecks.set(checkId, { resolve, timer, tabId });
    });

    checkPromise.then((result) => sendResponse(result));
    return true;
  }

  if (message?.type === "run_checkpoint") {
    const tab = sender?.tab;
    const p = message.payload || {};
    if (tab?.id != null && p.cardId && p.sop) {
      sopRunResume = {
        tabId: tab.id,
        cardId: p.cardId,
        data: p.data || {},
        sop: p.sop,
        nextIndex: Number(p.nextIndex) || 0,
        urlIncludes: p.urlIncludes || null,
        urlEquals: p.urlEquals || null,
        savedAt: Date.now(),
      };
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "run_checkpoint_cancel") {
    clearSopRunResume();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "get_bridge_status") {
    const handshaking =
      !connected &&
      (connecting ||
        (socket &&
          (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)));
    sendResponse({
      connected,
      connecting: handshaking,
      waitingForApp: !connected,
      lastError: connected ? "" : lastError,
      bridgeUrl: BRIDGE_URL,
    });
    return true;
  }

  if (message?.type === "reconnect_bridge") {
    connect(true);
    setTimeout(() => {
      const handshaking =
        !connected &&
        (connecting ||
          (socket &&
            (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)));
      sendResponse({
        connected,
        connecting: handshaking,
        waitingForApp: !connected,
        lastError: connected ? "" : lastError,
        bridgeUrl: BRIDGE_URL,
      });
    }, 1200);
    return true;
  }

  return false;
});

chrome.tabs.onActivated.addListener(async (info) => {
  try {
    const tab = await chrome.tabs.get(info.tabId);
    if (connected) await reportTabStatus(tab, { activated: true });
  } catch {
    if (connected) await reportTabStatus(null, { activated: true });
  }
  // Restore this tab's own watch only — other tabs keep running in background
  await reapplyWatchForTab(info.tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (!connected) return;
  // Left Chrome/Edge for any other app → clear focus so liveAct returns to main menu
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    reportBrowserBlurred();
    return;
  }
  // Switching back to this browser (same tab) must re-trigger auto-pick
  await reportTabStatus(null, { activated: true });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  // Only the focused tab updates the Coact queue pin
  if (connected && tab?.active) reportTabStatus(tab, { activated: Boolean(changeInfo.url) });
  if (tab?.active && isInjectableUrl(tab.url)) {
    reapplyWatchForTab(tabId);
  }
  // Resume click-stream after page navigation
  if (isInjectableUrl(tab?.url)) {
    resumeSopRunIfReady(tabId, tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  watchByTabId.delete(tabId);
  if (sopRunResume?.tabId === tabId) clearSopRunResume();
});

chrome.runtime.onInstalled.addListener(() => connect(true));
chrome.runtime.onStartup.addListener(() => connect(true));

chrome.alarms.create("coact-bridge", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "coact-bridge") return;
  // Alarms survive long idle / SW sleep — enforce silence here, not only in setInterval.
  if (lastDesktopSeenAt && Date.now() - lastDesktopSeenAt > SILENCE_MS) {
    forceReconnect("Bridge went silent — reconnecting");
    return;
  }
  if (socket && socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING) {
    forceReconnect("Socket not open — reconnecting");
    return;
  }
  if (!connected && !connecting) {
    connect(true);
    return;
  }
  if (connected || socket?.readyState === WebSocket.OPEN) {
    if (!send({ type: MessageType.PING })) {
      forceReconnect(lastError || "WebSocket send failed");
    }
  }
});

setConnected(false);
connect(true);
