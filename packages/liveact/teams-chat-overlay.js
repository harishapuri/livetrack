const path = require("path");
const { BrowserWindow } = require("electron");
const { findTeamsWindow } = require("./teams-chat-ax");
const { canShowTeamsChatOverlay, looksLikeComposeFrame, overlayBoundsFor } = require("./mom-teams");

const OVERLAY_W = 24;
const OVERLAY_H = 24;
const POLL_MS = 500;

let overlayWin = null;
let pollTimer = null;
let lastKey = "";
let lastCompose = null;
let tickInFlight = false;
let getCaptureActive = () => false;

function overlayBoundsForTeams(teams) {
  return overlayBoundsFor(
    teams,
    { width: OVERLAY_W, height: OVERLAY_H },
    teams?.compose || null,
  );
}

function raiseOverlay(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setAlwaysOnTop(true, "pop-up-menu", 1);
  } catch {
    try {
      win.setAlwaysOnTop(true, "screen-saver", 1);
    } catch {
      win.setAlwaysOnTop(true);
    }
  }
}

function ensureWindow() {
  if (overlayWin && !overlayWin.isDestroyed()) return overlayWin;
  overlayWin = new BrowserWindow({
    width: OVERLAY_W,
    height: OVERLAY_H,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    show: false,
    acceptFirstMouse: true,
    backgroundColor: "#00000000",
    ...(process.platform === "darwin" ? { type: "panel", roundedCorners: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, "teams-chat-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  raiseOverlay(overlayWin);
  try {
    overlayWin.setVisibleOnAllWorkspaces(false);
  } catch {
    /* keep the star on the Teams space only */
  }
  overlayWin.setIgnoreMouseEvents(false);
  overlayWin.loadFile(path.join(__dirname, "renderer", "teams-chat.html"));
  overlayWin.on("closed", () => {
    overlayWin = null;
  });
  return overlayWin;
}

function hideOverlay() {
  lastKey = "";
  if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) {
    try {
      overlayWin.setVisibleOnAllWorkspaces(false);
    } catch {
      /* ignore */
    }
    overlayWin.hide();
  }
}

function composeSnapshot(teams, compose) {
  if (!compose) return null;
  return {
    x: Number(compose.x) - Number(teams.x || 0),
    y: Number(compose.y) - Number(teams.y || 0),
    width: Number(compose.width),
    height: Number(compose.height),
  };
}

function composeOnWindow(teams, rel) {
  if (!rel) return null;
  return {
    x: Number(teams.x || 0) + rel.x,
    y: Number(teams.y || 0) + rel.y,
    width: rel.width,
    height: rel.height,
  };
}

function teamsChatIsActive(teams) {
  if (!teams?.ok || !teams.width || !teams.height) return false;
  if (teams.frontmost === false) return false;
  return true;
}

async function tick() {
  if (process.platform !== "darwin") return;
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    if (getCaptureActive()) {
      hideOverlay();
      return;
    }
    const teams = await findTeamsWindow();
    if (!teamsChatIsActive(teams) || !canShowTeamsChatOverlay(teams)) {
      lastCompose = null;
      hideOverlay();
      return;
    }
    if (looksLikeComposeFrame(teams, teams.compose)) {
      lastCompose = composeSnapshot(teams, teams.compose);
    }
    const liveCompose = composeOnWindow(teams, lastCompose) || teams.compose || null;
    const bounds = overlayBoundsForTeams({ ...teams, compose: liveCompose });
    const key = `${bounds.x},${bounds.y},${teams.title},${teams.via || ""}`;
    const win = ensureWindow();
    if (key !== lastKey) {
      lastKey = key;
      try {
        win.setBounds(bounds);
      } catch {
        /* ignore */
      }
    }
    raiseOverlay(win);
    try {
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    } catch {
      /* ignore */
    }
    if (!win.isVisible()) {
      try {
        win.showInactive();
      } catch {
        win.show();
      }
    }
  } finally {
    tickInFlight = false;
  }
}

function setBusy(busy, note) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.webContents.send("teams-chat-busy", { busy: Boolean(busy), note: note || "" });
}

function startTeamsChatOverlay({ isCaptureActive } = {}) {
  if (process.platform !== "darwin") return;
  getCaptureActive = typeof isCaptureActive === "function" ? isCaptureActive : () => false;
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    tick().catch(() => {});
  }, POLL_MS);
  tick().catch(() => {});
}

function stopTeamsChatOverlay() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastKey = "";
  lastCompose = null;
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.destroy();
  }
  overlayWin = null;
}

function getOverlayWindow() {
  return overlayWin;
}

module.exports = {
  startTeamsChatOverlay,
  stopTeamsChatOverlay,
  setBusy,
  getOverlayWindow,
};
