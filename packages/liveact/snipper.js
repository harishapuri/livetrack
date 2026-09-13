/**
 * Manual region snipping (classic snipping-tool UX).
 * macOS uses native screencapture -i; other platforms use an Electron overlay.
 */

const { app, BrowserWindow, desktopCapturer, nativeImage, screen, ipcMain, systemPreferences, shell } = require("electron");
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

function isUnpackagedElectron() {
  try {
    return !app.isPackaged;
  } catch {
    return true;
  }
}

const SCREEN_RECORDING_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

// npm start → Electron.app (no LiveTrack row in Screen Recording). Packaged → LiveTrack.app.
const SCREEN_RECORDING_HELP = isUnpackagedElectron()
  ? "macOS is hiding other apps behind your wallpaper. Open System Settings → Privacy & Security → Screen Recording, turn on Electron (npm start does not create a LiveTrack row). If Electron is not listed, also enable Terminal. Then fully quit Electron and run npm start again."
  : "macOS is hiding other apps behind your wallpaper. Open System Settings → Privacy & Security → Screen Recording, turn on LiveTrack, then fully quit this app and open it again.";

async function openMacScreenRecordingSettings() {
  try {
    await shell.openExternal(SCREEN_RECORDING_SETTINGS_URL);
  } catch {
    /* ignore */
  }
}

async function macScreenRecordingStatus() {
  try {
    return systemPreferences.getMediaAccessStatus("screen") || "unknown";
  } catch {
    return "unknown";
  }
}

async function ensureMacScreenRecording() {
  if (process.platform !== "darwin") return { ok: true };
  let status = await macScreenRecordingStatus();
  if (status === "granted") return { ok: true, status };

  // Triggers the system prompt. Other apps look like wallpaper until this is granted
  // and the app is restarted.
  try {
    await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 2, height: 2 },
    });
  } catch {
    /* prompt may still have been shown */
  }
  await delay(200);
  status = await macScreenRecordingStatus();
  if (status === "granted") return { ok: true, status };
  if (status === "denied" || status === "restricted") {
    await openMacScreenRecordingSettings();
    return { ok: false, error: SCREEN_RECORDING_HELP };
  }
  // not-determined / unknown: do not snip — that PNG is wallpaper, not Chrome/Jira.
  await openMacScreenRecordingSettings();
  return { ok: false, error: SCREEN_RECORDING_HELP };
}

function screencaptureBin() {
  return fs.existsSync("/usr/sbin/screencapture") ? "/usr/sbin/screencapture" : "screencapture";
}

async function snipNativeMac() {
  const outPath = snipOutPath();
  try {
    // Same crosshair as ⌘⇧4 (`screencapture -i -s`). Do not fake the hotkey
    // with System Events — that often "succeeds" with no UI, then hangs 120s.
    await execFileAsync(screencaptureBin(), ["-i", "-s", "-x", outPath], {
      timeout: 120000,
    });
  } catch (err) {
    if (err?.code === 1 || err?.killed) {
      return { ok: false, cancelled: true };
    }
    return {
      ok: false,
      error:
        err?.message ||
        "Screenshot failed. Grant Screen Recording to LiveTrack, then quit and reopen this app.",
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
    // Transparent Mac windows swallow clicks; keep the snipper opaque.
    transparent: false,
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
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(__dirname, "snipper-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver", 1);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(false);

  const htmlPath = path.join(__dirname, "renderer", "snipper.html");
  win.loadFile(htmlPath, {
    query: {
      displayId: String(display.id),
      frame: encodeURIComponent(pathToFileURL(framePath).href),
    },
  });
  win.webContents.once("did-finish-load", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.moveTop();
      win.focus();
    }
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
      }
    } catch (err) {
      finish({ ok: false, error: err?.message || String(err) });
    }
  });
}

function joinNativeImages(images) {
  const usable = (images || []).filter((img) => img && !img.isEmpty());
  if (!usable.length) return null;
  if (usable.length === 1) return usable[0];
  const sizes = usable.map((img) => img.getSize());
  const width = sizes.reduce((sum, s) => sum + s.width, 0);
  const height = Math.max(...sizes.map((s) => s.height));
  if (!width || !height) return usable[0];
  const out = Buffer.alloc(width * height * 4, 0);
  let xOff = 0;
  for (let i = 0; i < usable.length; i++) {
    const bmp = usable[i].toBitmap();
    const { width: w, height: h } = sizes[i];
    for (let y = 0; y < h; y++) {
      const srcStart = y * w * 4;
      bmp.copy(out, (y * width + xOff) * 4, srcStart, srcStart + w * 4);
    }
    xOff += w;
  }
  return nativeImage.createFromBitmap(out, { width, height });
}

async function captureMacFullScreen() {
  const outPath = snipOutPath();
  try {
    await execFileAsync("screencapture", ["-x", outPath], { timeout: 30000 });
  } catch (err) {
    return {
      ok: false,
      error:
        err?.message ||
        SCREEN_RECORDING_HELP,
    };
  }
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
    return { ok: false, error: "Desktop screenshot was empty." };
  }
  return { ok: true, path: outPath, name: path.basename(outPath) };
}

async function captureDesktopViaCapturer() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const ordered = [
    ...displays.filter((d) => d.id === primary.id),
    ...displays.filter((d) => d.id !== primary.id),
  ];
  const images = [];
  for (const display of ordered) {
    try {
      images.push(await captureDisplayImage(display));
    } catch {
      /* skip a display that failed */
    }
  }
  const joined = joinNativeImages(images);
  if (!joined || joined.isEmpty()) {
    throw new Error(
      SCREEN_RECORDING_HELP,
    );
  }
  const outPath = snipOutPath();
  fs.writeFileSync(outPath, joined.toPNG());
  return { ok: true, path: outPath, name: path.basename(outPath) };
}

/**
 * Full-desktop PNG of whatever is on screen (any app), not a Chrome tab.
 * @param {{ hide: () => void | Promise<void>, restore: () => void | Promise<void> }} hooks
 */
async function captureFullDesktop(hooks = {}) {
  if (snipBusy) {
    return { ok: false, error: "Capture already in progress" };
  }
  snipBusy = true;
  let hiddenApp = false;
  try {
    if (typeof hooks.hide === "function") await hooks.hide();
    if (process.platform === "darwin") {
      try {
        app.hide();
        hiddenApp = true;
      } catch {
        /* ignore */
      }
    }
    await delay(280);

    let result;
    if (process.platform === "darwin") {
      result = await captureMacFullScreen();
      if (!result?.ok) {
        try {
          result = await captureDesktopViaCapturer();
        } catch (err) {
          result = {
            ok: false,
            error:
              result?.error ||
              err?.message ||
              SCREEN_RECORDING_HELP,
          };
        }
      }
    } else {
      try {
        result = await captureDesktopViaCapturer();
      } catch (err) {
        result = { ok: false, error: err?.message || String(err) };
      }
    }

    if (hiddenApp) {
      try {
        app.show();
      } catch {
        /* ignore */
      }
      hiddenApp = false;
    }
    if (typeof hooks.restore === "function") await hooks.restore();
    return result;
  } catch (err) {
    if (hiddenApp) {
      try {
        app.show();
      } catch {
        /* ignore */
      }
    }
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

/**
 * @param {{ hide: () => void | Promise<void>, restore: () => void | Promise<void> }} hooks
 */
async function captureRegionSnip(hooks = {}) {
  if (snipBusy) {
    return { ok: false, error: "Snip already in progress" };
  }
  snipBusy = true;
  let hidden = false;
  try {
    // ⌘⇧4 is the system Screenshot tool (has Screen Recording). Do not gate
    // on Electron's TCC — that is why Capture used to save wallpaper.
    if (process.platform !== "darwin") {
      const access = await ensureMacScreenRecording();
      if (!access.ok) return access;
    }

    if (typeof hooks.hide === "function") {
      hidden = true;
      await hooks.hide();
    }
    await delay(400);

    let result;
    if (process.platform === "darwin") {
      result = await snipNativeMac();
    } else {
      result = await snipWithOverlay();
    }
    return result;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    if (hidden && typeof hooks.restore === "function") {
      try {
        await hooks.restore();
      } catch {
        /* ignore */
      }
    }
    snipBusy = false;
    closeOverlays();
  }
}

const SKIP_FRONTMOST_OWNER =
  /^(LiveTrack|Electron|Window Server|Dock|Control Center|Notification Center|NotificationCenter|Screenshot|SystemUIServer|loginwindow|Spotlight|Wallpaper|Item-0)$/i;

function isChromeOwnerName(owner) {
  return /\b(Google Chrome|Chromium|Chrome Canary|Chrome Dev)\b/i.test(String(owner || ""));
}

function frontmostSkipOwners() {
  const names = [
    "LiveTrack",
    "Electron",
    "Window Server",
    "Dock",
    "Control Center",
    "Notification Center",
    "Notification Centre",
    "SystemUIServer",
    "Screenshot",
    "screencaptureui",
    "loginwindow",
    "Spotlight",
    "CoreServicesUIAgent",
    "UserNotificationCenter",
  ];
  try {
    const n = app.getName();
    if (n && !names.includes(n)) names.push(n);
  } catch {
    /* ignore */
  }
  return names;
}

/**
 * Frontmost on-screen window that is not LiveTrack/Electron (CGWindowList z-order).
 * `screencapture -l` needs this Quartz CGWindowID, not System Events' AX id.
 * ObjC.deepUnwrap fails on this CG list; ObjC.castRefToObject works.
 */
async function frontmostMacWindowMeta(skipPid) {
  const jxa = `
ObjC.import("CoreGraphics");
ObjC.import("Foundation");
function run(argv) {
  var skipPid = parseInt(argv[0] || "0", 10);
  var skip = {};
  var names = ${JSON.stringify(frontmostSkipOwners())};
  for (var s = 0; s < names.length; s++) skip[names[s]] = 1;
  var arr = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID));
  var n = Number(arr.count);
  for (var i = 0; i < n; i++) {
    var w = arr.objectAtIndex(i);
    var layer = Number(ObjC.unwrap(w.objectForKey("kCGWindowLayer")));
    if (layer !== 0) continue;
    var alpha = Number(ObjC.unwrap(w.objectForKey("kCGWindowAlpha")));
    if (!(alpha >= 0.1)) continue;
    var pid = Number(ObjC.unwrap(w.objectForKey("kCGWindowOwnerPID")));
    if (skipPid && pid === skipPid) continue;
    var owner = String(ObjC.unwrap(w.objectForKey("kCGWindowOwnerName")) || "");
    if (!owner || skip[owner]) continue;
    var bounds = w.objectForKey("kCGWindowBounds");
    var width = Number(ObjC.unwrap(bounds.objectForKey("Width")));
    var height = Number(ObjC.unwrap(bounds.objectForKey("Height")));
    if (width < 64 || height < 64) continue;
    var id = Number(ObjC.unwrap(w.objectForKey("kCGWindowNumber")));
    if (!id) continue;
    var name = String(ObjC.unwrap(w.objectForKey("kCGWindowName")) || "");
    return JSON.stringify({ id: id, owner: owner, name: name, pid: pid });
  }
  return "";
}
`.trim();
  const { stdout } = await execFileAsync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", jxa, String(skipPid || process.pid)],
    { timeout: 8000 },
  );
  const raw = String(stdout || "").trim();
  if (!raw) return null;
  try {
    const meta = JSON.parse(raw);
    return meta?.id ? meta : null;
  } catch {
    return null;
  }
}

async function captureMacWindowById(windowId, outPath) {
  await execFileAsync(
    screencaptureBin(),
    ["-x", "-o", `-l${windowId}`, outPath],
    { timeout: 20000 },
  );
}

async function captureMacMainDisplay(outPath) {
  await execFileAsync(screencaptureBin(), ["-x", "-m", outPath], { timeout: 20000 });
}

async function captureMacFrontmostWindow() {
  const outPath = snipOutPath();
  let meta;
  try {
    meta = await frontmostMacWindowMeta(process.pid);
  } catch (err) {
    return { ok: false, error: err?.message || "Could not find the frontmost window." };
  }
  if (!meta?.id) {
    return { ok: false, error: "No frontmost window found." };
  }
  try {
    await captureMacWindowById(meta.id, outPath);
  } catch (err) {
    return {
      ok: false,
      error: err?.message || SCREEN_RECORDING_HELP,
    };
  }
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 80) {
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
    return { ok: false, error: "Frontmost window screenshot was empty." };
  }
  return {
    ok: true,
    path: outPath,
    name: path.basename(outPath),
    owner: String(meta.owner || ""),
    windowName: String(meta.name || ""),
  };
}

async function captureMacMainDisplayShot() {
  const outPath = snipOutPath();
  try {
    await captureMacMainDisplay(outPath);
  } catch (err) {
    return { ok: false, error: err?.message || SCREEN_RECORDING_HELP };
  }
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
    return { ok: false, error: "Desktop screenshot was empty." };
  }
  return { ok: true, path: outPath, name: path.basename(outPath) };
}

async function captureFrontmostViaCapturer() {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 2560, height: 1600 },
  });
  for (const src of sources || []) {
    const label = String(src?.name || "");
    if (!label || SKIP_FRONTMOST_OWNER.test(label)) continue;
    if (/^LiveTrack|^Electron\b/i.test(label)) continue;
    const img = src.thumbnail;
    if (!img || img.isEmpty()) continue;
    const { width, height } = img.getSize();
    if (width < 80 || height < 80) continue;
    const outPath = snipOutPath();
    fs.writeFileSync(outPath, img.toPNG());
    return {
      ok: true,
      path: outPath,
      name: path.basename(outPath),
      owner: label,
      windowName: label,
    };
  }
  return { ok: false, error: "No frontmost window found." };
}

/**
 * Capture the previously focused / frontmost window that is not LiveTrack.
 * Uses Quartz CGWindowID (`screencapture -l`) so LiveTrack can stay visible.
 * Never hide the Electron app — Desk must not disappear. Hooks may drop always-on-top only.
 * Does not ask the user to drag a box or click a window.
 * @param {{ hide: () => void | Promise<void>, restore: () => void | Promise<void> }} hooks
 */
async function captureFrontmostWindow(hooks = {}) {
  if (snipBusy) {
    return { ok: false, error: "Capture already in progress" };
  }
  snipBusy = true;
  try {
    const access = await ensureMacScreenRecording();
    if (!access.ok) return access;
    // Do not hide the Electron app or BrowserWindows. Optional hook drops always-on-top.
    if (typeof hooks.hide === "function") await hooks.hide();
    await delay(120);

    let result;
    if (process.platform === "darwin") {
      result = await captureMacFrontmostWindow();
      if (!result?.ok) {
        try {
          result = await captureFrontmostViaCapturer();
        } catch (err) {
          result = {
            ok: false,
            error: result?.error || err?.message || SCREEN_RECORDING_HELP,
          };
        }
      }
    } else {
      try {
        result = await captureFrontmostViaCapturer();
      } catch (err) {
        result = { ok: false, error: err?.message || String(err) };
      }
    }
    return result;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    if (typeof hooks.restore === "function") {
      try {
        await hooks.restore();
      } catch {
        /* ignore */
      }
    }
    snipBusy = false;
  }
}

module.exports = {
  captureRegionSnip,
  captureFullDesktop,
  captureFrontmostWindow,
  isChromeOwnerName,
  joinNativeImages,
};
