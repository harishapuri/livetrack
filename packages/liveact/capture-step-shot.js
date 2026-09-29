/**
 * Step screenshots are off while Record is on.
 * A capture flashes a dim overlay and can pull the browser to another window
 * while the user is typing. Clicks and field values are still recorded.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEBOUNCE_MS = 200;
const SHOT_TIMEOUT_MS = 8000;

const deps = {
  isExtensionConnected: null,
  requestTabShot: null,
  captureVisiblePng: null,
};

const pending = new Set();
const delayed = new Map();
const seqBySession = new Map();
let captureChain = Promise.resolve();

function configureStepShots(next = {}) {
  Object.assign(deps, next);
}

function shouldCaptureStepShot() {
  return false;
}

function copyScreenshotMeta(from, to = {}) {
  if (!from || typeof from !== "object" || !to || typeof to !== "object") return to;
  const screenshotPath = String(from.screenshotPath || "").trim();
  if (screenshotPath) {
    to.screenshotPath = screenshotPath;
    if (from.screenshotAt) to.screenshotAt = from.screenshotAt;
    if (from.screenshotSource) to.screenshotSource = from.screenshotSource;
  }
  if (from.elementRect && typeof from.elementRect === "object") {
    to.elementRect = { ...from.elementRect };
  }
  const explanation = String(from.explanation || "").replace(/\s+/g, " ").trim();
  if (explanation) to.explanation = explanation;
  return to;
}

function captureShotsRoot() {
  try {
    const { resolveExecutionsRoot } = require("./settings");
    return path.join(resolveExecutionsRoot(), "capture", "shots");
  } catch {
    return path.join(os.homedir(), ".coact", "capture", "shots");
  }
}

function shotKey(event) {
  const session = String(event?.recordingSessionId || event?.sessionId || "");
  const field = String(event?.selector || event?.fieldName || event?.label || "");
  const action = String(event?.action || "").toLowerCase();
  return `${session}|${field}|${action}`;
}

function slugPart(event) {
  return (
    String(event?.label || event?.fieldName || event?.value || "step")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "step"
  );
}

function nextSeq(sessionId) {
  const key = String(sessionId || "session");
  const n = (seqBySession.get(key) || 0) + 1;
  seqBySession.set(key, n);
  return n;
}

function bufferFromDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
  if (!m) return null;
  try {
    return Buffer.from(m[1], "base64");
  } catch {
    return null;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

async function capturePngBuffer() {
  if (typeof deps.isExtensionConnected === "function" && deps.isExtensionConnected() && deps.requestTabShot) {
    const requestId = `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await withTimeout(deps.requestTabShot(requestId), SHOT_TIMEOUT_MS);
    if (res?.ok && res.dataUrl) {
      const buffer = bufferFromDataUrl(res.dataUrl);
      if (buffer?.length) return { buffer, source: "extension" };
    }
  }
  if (typeof deps.captureVisiblePng === "function") {
    const res = await withTimeout(deps.captureVisiblePng(), SHOT_TIMEOUT_MS);
    if (res?.ok && res.buffer?.length) return { buffer: res.buffer, source: "playwright" };
  }
  if (typeof deps.captureDesktopPng === "function") {
    const res = await withTimeout(deps.captureDesktopPng(), SHOT_TIMEOUT_MS);
    if (res?.ok && res.buffer?.length) return { buffer: res.buffer, source: "desktop" };
  }
  return null;
}

function enqueueCapture(event) {
  const run = captureChain.then(
    () => takeAndAttachShot(event),
    () => takeAndAttachShot(event)
  );
  captureChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function appendShotPatch(event) {
  const id = String(event?.captureEventId || "").trim();
  const shot = String(event?.screenshotPath || "").trim();
  if (!id || !shot) return;
  try {
    const dir = path.join(captureShotsRoot(), "..");
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(
      path.join(dir, `events-${day}.jsonl`),
      `${JSON.stringify({
        kind: "step_screenshot",
        captureEventId: id,
        screenshotPath: shot,
        screenshotAt: event.screenshotAt || new Date().toISOString(),
        screenshotSource: event.screenshotSource || "",
        recordingSessionId: event.recordingSessionId || event.sessionId || "",
        ts: new Date().toISOString(),
      })}\n`
    );
  } catch {
    /* disk optional */
  }
}

function persistScreenshotDataUrl(event) {
  if (!event || typeof event !== "object") return event;
  const dataUrl = event.screenshotDataUrl;
  delete event.screenshotDataUrl;
  if (!dataUrl || String(event.screenshotPath || "").trim()) return event;
  const buffer = bufferFromDataUrl(dataUrl);
  if (!buffer?.length) return event;
  const sessionId = String(event.recordingSessionId || event.sessionId || "session");
  const dir = path.join(captureShotsRoot(), sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const action =
    String(event.action || "step")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 12) || "step";
  const file = `${String(nextSeq(sessionId)).padStart(3, "0")}-${action}-${slugPart(event)}.png`;
  const dest = path.join(dir, file);
  fs.writeFileSync(dest, buffer);
  event.screenshotPath = dest;
  event.screenshotAt = event.screenshotAt || new Date().toISOString();
  event.screenshotSource = event.screenshotSource || "extension";
  return event;
}

async function takeAndAttachShot(event) {
  if (!event || typeof event !== "object") return event;
  persistScreenshotDataUrl(event);
  if (String(event.screenshotPath || "").trim()) return event;
  const captured = await capturePngBuffer();
  if (!captured?.buffer) return event;
  const sessionId = String(event.recordingSessionId || event.sessionId || "session");
  const dir = path.join(captureShotsRoot(), sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const action = String(event.action || "step")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12) || "step";
  const file = `${String(nextSeq(sessionId)).padStart(3, "0")}-${action}-${slugPart(event)}.png`;
  const dest = path.join(dir, file);
  fs.writeFileSync(dest, captured.buffer);
  event.screenshotPath = dest;
  event.screenshotAt = new Date().toISOString();
  event.screenshotSource = captured.source;
  appendShotPatch(event);
  return event;
}

async function fireDelayed(key) {
  const entry = delayed.get(key);
  if (!entry) return;
  delayed.delete(key);
  try {
    await enqueueCapture(entry.event);
  } catch {
    /* shot is optional */
  } finally {
    entry.resolve();
    pending.delete(entry.promise);
  }
}

function scheduleStepShot(event) {
  if (!shouldCaptureStepShot(event) || String(event?.screenshotPath || "").trim()) {
    return Promise.resolve(event);
  }
  const key = shotKey(event);
  const prev = delayed.get(key);
  if (prev) {
    clearTimeout(prev.timer);
    prev.event = event;
    prev.timer = setTimeout(() => {
      fireDelayed(key).catch(() => {});
    }, DEBOUNCE_MS);
    return prev.promise;
  }
  let resolveFn;
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
  });
  pending.add(promise);
  delayed.set(key, {
    event,
    resolve: resolveFn,
    promise,
    timer: setTimeout(() => {
      fireDelayed(key).catch(() => {});
    }, DEBOUNCE_MS),
  });
  return promise;
}

async function flushStepShots() {
  const keys = [...delayed.keys()];
  for (const key of keys) {
    const entry = delayed.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    await fireDelayed(key);
  }
  if (pending.size) await Promise.allSettled([...pending]);
}

function resolveExistingShot(raw, extraRoots = []) {
  const p = String(raw || "").trim();
  if (!p) return "";
  const candidates = [];
  if (path.isAbsolute(p)) candidates.push(p);
  const captureRoot = path.join(captureShotsRoot(), "..");
  candidates.push(path.join(captureShotsRoot(), p));
  candidates.push(path.join(captureRoot, p));
  for (const root of extraRoots) {
    if (root) candidates.push(path.resolve(root, p));
  }
  for (const file of candidates) {
    try {
      if (file && fs.existsSync(file) && fs.statSync(file).isFile()) return path.resolve(file);
    } catch {
      /* skip */
    }
  }
  return "";
}

function relocateStepList(steps, destDir) {
  if (!Array.isArray(steps)) return steps;
  fs.mkdirSync(destDir, { recursive: true });
  return steps.map((step, i) => {
    if (!step || typeof step !== "object") return step;
    const src = resolveExistingShot(step.screenshotPath, [path.dirname(destDir), path.dirname(path.dirname(destDir))]);
    if (!src) return step;
    const destName = path.basename(src) || `${String(i + 1).padStart(3, "0")}-step.png`;
    const dest = path.join(destDir, destName);
    try {
      if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
    } catch {
      return step;
    }
    const next = { ...step };
    next.screenshotPath = path.join("play", "shots", destName).split(path.sep).join("/");
    return next;
  });
}

function relocateShotsOntoCard(payload, cardDir) {
  const destDir = path.join(cardDir, "play", "shots");
  const steps = relocateStepList(payload?.steps, destDir);
  let playwright = payload?.playwright;
  if (playwright && typeof playwright === "object") {
    playwright = { ...playwright };
    if (Array.isArray(playwright.steps)) {
      playwright.steps = relocateStepList(playwright.steps, destDir);
    }
    if (Array.isArray(playwright.clicks)) {
      playwright.clicks = relocateStepList(playwright.clicks, destDir);
    }
    if (playwright.playwright && typeof playwright.playwright === "object") {
      const nested = { ...playwright.playwright };
      if (Array.isArray(nested.steps)) nested.steps = relocateStepList(nested.steps, destDir);
      playwright.playwright = nested;
    }
  }
  return { steps, playwright };
}

function isInsideRoot(file, root) {
  const a = path.resolve(file);
  const b = path.resolve(root);
  return a === b || a.startsWith(b + path.sep);
}

function allowedShotRoots(cardDir) {
  const roots = [captureShotsRoot(), path.join(captureShotsRoot(), "..")];
  try {
    const { defaultDocumentsRoot } = require("./documents");
    roots.push(defaultDocumentsRoot());
  } catch {
    /* optional */
  }
  if (cardDir) roots.push(path.resolve(cardDir));
  return roots;
}

function resolveAllowedShotPath(raw, { cardDir } = {}) {
  const file = resolveExistingShot(raw, cardDir ? [cardDir] : []);
  if (!file) return "";
  if (path.isAbsolute(String(raw || "").trim()) && fs.existsSync(file)) return file;
  const roots = allowedShotRoots(cardDir);
  if (roots.some((root) => isInsideRoot(file, root))) return file;
  return file;
}

function fileMatchesSlug(file, slug) {
  const base = path.basename(String(file || "")).toLowerCase();
  return base.endsWith(`-${slug}.png`);
}

function attachSessionShots(steps, recordingSessionId) {
  const files = listSessionShotFiles(recordingSessionId);
  if (!files.length || !Array.isArray(steps)) return steps || [];
  const used = new Set();
  const out = steps.map((step) => (step && typeof step === "object" ? { ...step } : step));
  for (const step of out) {
    if (!step || typeof step !== "object") continue;
    const existing = resolveExistingShot(step.screenshotPath);
    if (existing) {
      used.add(existing);
      continue;
    }
    const slug = slugPart(step);
    if (!slug || slug === "step") continue;
    const file = files.find((candidate) => !used.has(candidate) && fileMatchesSlug(candidate, slug));
    if (!file) continue;
    used.add(file);
    copyScreenshotMeta({ screenshotPath: file, screenshotSource: "session" }, step);
  }
  out.forEach((step, index) => {
    if (!step || typeof step !== "object") return;
    if (resolveExistingShot(step.screenshotPath)) return;
    const file = files[index] && !used.has(files[index]) ? files[index] : "";
    if (!file) return;
    used.add(file);
    copyScreenshotMeta({ screenshotPath: file, screenshotSource: "session" }, step);
  });
  return out;
}

function listSessionShotFiles(recordingSessionId) {
  const id = String(recordingSessionId || "").trim();
  if (!id) return [];
  const dir = path.join(captureShotsRoot(), id);
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((n) => /\.png$/i.test(n))
      .sort()
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

module.exports = {
  configureStepShots,
  shouldCaptureStepShot,
  copyScreenshotMeta,
  scheduleStepShot,
  flushStepShots,
  persistScreenshotDataUrl,
  takeAndAttachShot,
  captureShotsRoot,
  relocateShotsOntoCard,
  relocateStepList,
  resolveExistingShot,
  resolveAllowedShotPath,
  listSessionShotFiles,
  attachSessionShots,
};
