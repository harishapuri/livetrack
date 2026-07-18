const BRIDGE_URL = "ws://127.0.0.1:17321";
const MessageType = {
  HELLO: "hello",
  PING: "ping",
  PONG: "pong",
  RUN_CARD: "run_card",
  STEP_UPDATE: "step_update",
  CONTROL: "control",
  STATUS: "status",
};

let socket = null;
let reconnectTimer = null;
let connected = false;

function setConnected(value) {
  connected = value;
  chrome.storage.session.set({ bridgeConnected: value });
  chrome.action.setBadgeText({ text: value ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: value ? "#3ecf8e" : "#666666" });
}

function send(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

async function reportTabStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  send({
    type: MessageType.STATUS,
    tabUrl: tab?.url || null,
    tabTitle: tab?.title || null,
  });
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    socket = new WebSocket(BRIDGE_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  socket.addEventListener("open", () => {
    setConnected(true);
    send({ type: MessageType.HELLO, role: "extension", version: "0.1.0" });
    reportTabStatus();
  });

  socket.addEventListener("message", async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === MessageType.PING) {
      send({ type: MessageType.PONG });
      return;
    }

    if (msg.type === MessageType.RUN_CARD) {
      await handleRunCard(msg);
      return;
    }

    if (msg.type === MessageType.CONTROL) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: "control", action: msg.action });
      }
    }
  });

  socket.addEventListener("close", () => {
    setConnected(false);
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 1500);
}

async function handleRunCard(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    send({
      type: MessageType.STEP_UPDATE,
      cardId: msg.cardId,
      status: "run_failed",
      error: "No active Chrome tab found.",
    });
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "run_sop",
      cardId: msg.cardId,
      data: msg.data,
      sop: msg.sop,
    });
  } catch (err) {
    // Content script may not be injected yet (e.g. fresh navigation).
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    await chrome.tabs.sendMessage(tab.id, {
      type: "run_sop",
      cardId: msg.cardId,
      data: msg.data,
      sop: msg.sop,
    });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "step_update") {
    send({
      type: MessageType.STEP_UPDATE,
      ...message.payload,
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "get_bridge_status") {
    sendResponse({ connected });
    return true;
  }

  return false;
});

chrome.tabs.onActivated.addListener(() => {
  if (connected) reportTabStatus();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (connected && changeInfo.status === "complete") reportTabStatus();
});

connect();

// Reconnect when the service worker wakes.
self.addEventListener("activate", () => connect());
