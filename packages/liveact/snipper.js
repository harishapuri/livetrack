/**
 * Manual region snipping (classic snipping-tool UX).
 * macOS uses native screencapture -i; other platforms use an Electron overlay.
 */

const { BrowserWindow, desktopCapturer, screen, ipcMain } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

let snipBusy = false;
let overlayWindows = [];
/** @type {Map<string, Electron.NativeImage>} */
const frozenByDisplay = new Map();
const tempFrameFiles = [];

function snipOutPath() {
  return path.join(os.tmpdir(), `coact-snip-${Date.now()}.png`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupTempFrames() {
  for (const file of tempFrameFiles) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
  tempFrameFiles.length = 0;
}

async function snipNativeMac() {
  const outPath = snipOutPath();
  try {
    await execFileAsync("screencapture", ["-i", "-x", outPath], {
      timeout: 120000,
    });
  } catch (err) {
    // Exit code 1 = user cancelled (Esc) or no selection
    if (err?.code === 1 || err?.killed) {
      return { ok: false, cancelled: true };
    }
    return {
      ok: false,
      error:
        err?.message ||
        "Screenshot failed. Grant Screen Recording permission to liveAct in System Settings.",
    };
  }

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
    return { ok: false, cancelled: true };
  }

  return {
    ok: true,
    path: outPath,
    name: path.basename(outPath),
  };
}

function closeOverlays() {
  for (const win of overlayWindows) {
    if (win && !win.isDestroyed()) win.destroy();
  }
  overlayWindows = [];
  frozenByDisplay.clear();
  cleanupTempFrames();
}

/**
 * Capture a full-resolution screen source matching a display.
 */
async function captureDisplayImage(display) {
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;
  const thumbW = Math.round(width * scale);
  const thumbH = Math.round(height * scale);

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: thumbW, height: thumbH },
  });

  const match =
    sources.find((s) => String(s.display_id) === String(display.id)) ||
    sources.find((s) => s.id.startsWith("screen:0")) ||
    sources[0];

  if (!match?.thumbnail || match.thumbnail.isEmpty()) {
    throw new Error("Could not capture screen. Check screen recording permissions.");
  }
  return match.thumbnail;
}

function createOverlayWindow(display, framePath) {
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "snipper-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow loading the frozen frame from a temp file path
      webSecurity: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(false);

  const htmlPath = path.join(__dirname, "renderer", "snipper.html");
  win.loadFile(htmlPath, {
    query: {
      displayId: String(display.id),
      frame: encodeURIComponent(pathToFileURL(framePath).href),
    },
  });

  return win;
}

function snipWithOverlay() {
  return new Promise(async (resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      closeOverlays();
      ipcMain.removeListener("snipper-result", onResult);
      ipcMain.removeListener("snipper-cancel", onCancel);
      resolve(result);
    };

    const onResult = (_event, payload) => {
      try {
        const { displayId, x, y, width, height } = payload || {};
        if (!width || !height) {
          finish({ ok: false, cancelled: true });
          return;
        }

        const display =
          screen.getAllDisplays().find((d) => String(d.id) === String(displayId)) ||
          screen.getPrimaryDisplay();
        const image = frozenByDisplay.get(String(display.id));
        if (!image || image.isEmpty()) {
          finish({ ok: false, error: "Frozen screen frame missing" });
          return;
        }

        const scale = display.scaleFactor || 1;
        const size = image.getSize();
        const crop = {
          x: Math.max(0, Math.min(size.width - 1, Math.round(x * scale))),
          y: Math.max(0, Math.min(size.height - 1, Math.round(y * scale))),
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
        };
        crop.width = Math.min(crop.width, size.width - crop.x);
        crop.height = Math.min(crop.height, size.height - crop.y);

        const cropped = image.crop(crop);
        const outPath = snipOutPath();
        fs.writeFileSync(outPath, cropped.toPNG());
        finish({ ok: true, path: outPath, name: path.basename(outPath) });
      } catch (err) {
        finish({ ok: false, error: err?.message || String(err) });
      }
    };

    const onCancel = () => finish({ ok: false, cancelled: true });

    ipcMain.on("snipper-result", onResult);
    ipcMain.on("snipper-cancel", onCancel);

    try {
      const displays = screen.getAllDisplays();
      for (const display of displays) {
        const image = await captureDisplayImage(display);
        frozenByDisplay.set(String(display.id), image);
        const framePath = path.join(
          os.tmpdir(),
          `coact-snip-frame-${display.id}-${Date.now()}.png`
        );
        fs.writeFileSync(framePath, image.toPNG());
        tempFrameFiles.push(framePath);
        const win = createOverlayWindow(display, framePath);
        overlayWindows.push(win);
        win.once("ready-to-show", () => {
          win.show();
          win.focus();
        });
      }
    } catch (err) {
      finish({ ok: false, error: err?.message || String(err) });
    }
  });
}

/**
 * @param {{ hide: () => void | Promise<void>, restore: () => void | Promise<void> }} hooks
 */
async function captureRegionSnip(hooks = {}) {
  if (snipBusy) {
    return { ok: false, error: "Snip already in progress" };
  }
  snipBusy = true;
  try {
    if (typeof hooks.hide === "function") await hooks.hide();
    // Let windows disappear before capture
    await delay(180);

    const result =
      process.platform === "darwin" ? await snipNativeMac() : await snipWithOverlay();

    if (typeof hooks.restore === "function") await hooks.restore();
    return result;
  } catch (err) {
    if (typeof hooks.restore === "function") {
      try {
        await hooks.restore();
      } catch {
        /* ignore */
      }
    }
    return { ok: false, error: err?.message || String(err) };
  } finally {
    snipBusy = false;
    closeOverlays();
  }
}

module.exports = { captureRegionSnip };
