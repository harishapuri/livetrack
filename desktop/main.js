const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { createBridge } = require("./bridge");
const queue = require("../shared/sample-queue.json");
const vendorSop = require("../shared/sops/vendor-onboarding.json");

const sops = {
  [vendorSop.id]: vendorSop,
};

let mainWindow = null;
let bridge = null;
let activeRun = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    title: "Coact",
    backgroundColor: "#0f1419",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function enrichCard(card) {
  const sop = sops[card.sopId];
  return {
    ...card,
    sopName: sop ? sop.name : card.sopId,
    stepCount: sop ? sop.steps.length : 0,
  };
}

app.whenReady().then(() => {
  bridge = createBridge({
    onExtensionStatus(status) {
      sendToRenderer("extension-status", status);
    },
    onStepUpdate(update) {
      if (activeRun && update.cardId === activeRun.cardId) {
        sendToRenderer("step-update", update);
      }
    },
    onRunFinished(result) {
      if (activeRun && result.cardId === activeRun.cardId) {
        activeRun = null;
        sendToRenderer("run-finished", result);
      }
    },
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (bridge) bridge.close();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("get-bootstrap", () => ({
  queue: queue.map(enrichCard),
  extensionConnected: bridge ? bridge.isExtensionConnected() : false,
  bridgePort: bridge ? bridge.port : null,
}));

ipcMain.handle("run-card", async (_event, cardId) => {
  const card = queue.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: "Card not found" };

  const sop = sops[card.sopId];
  if (!sop) return { ok: false, error: `SOP not found: ${card.sopId}` };

  if (!bridge || !bridge.isExtensionConnected()) {
    return {
      ok: false,
      error: "Chrome extension not connected. Load the extension and open the form page.",
    };
  }

  activeRun = { cardId: card.id };
  const payload = {
    cardId: card.id,
    title: card.title,
    data: card.data,
    sop,
  };

  bridge.sendRunCard(payload);
  return {
    ok: true,
    steps: sop.steps.map((step) => ({
      id: step.id,
      label: step.label,
      action: step.action,
      status: "pending",
    })),
  };
});

ipcMain.handle("control-run", (_event, action) => {
  if (!bridge) return { ok: false };
  bridge.sendControl(action);
  return { ok: true };
});
