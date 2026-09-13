/**
 * Playwright CDP against the user's real Chrome/Edge when remote debugging
 * is already on. Never launches ~/.coact/chrome-cdp (that empty profile is
 * what users see as "only Chromium works"). If Chrome is already running
 * without a debug port, callers should use the extension instead.
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");
const chromeMac = require("./chrome-mac");
const { loadSettings } = require("./settings");
const playwrightCapture = require("./playwright-capture");

const DEFAULT_CDP = "http://127.0.0.1:9222";

let browser = null;
let context = null;
let connecting = null;
let launching = null;
let watchTimer = null;
let urlPollTimer = null;
let lastError = "";
let runCtl = { cancelled: false, paused: false };
let lastPageMeta = { url: "", title: "" };
let preferredUrl = "";
let matchHints = [];

function setMatchHints(hints) {
  matchHints = Array.isArray(hints)
    ? hints.map((h) => String(h || "").trim()).filter(Boolean)
    : [];
}

function setPreferredUrl(url) {
  preferredUrl = String(url || "").trim();
  if (typeof chromeMac.setPreferredUrl === "function") {
    chromeMac.setPreferredUrl(preferredUrl);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cdpHttpUrl() {
  const raw = String(loadSettings().chromeDebugUrl || DEFAULT_CDP).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_CDP;
}

function cdpCandidates() {
  const primary = cdpHttpUrl();
  const extras = [
    "http://127.0.0.1:9222",
    "http://127.0.0.1:9223",
    "http://127.0.0.1:9229",
  ];
  const out = [];
  for (const url of [primary, ...extras]) {
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

async function firstOpenCdp() {
  if (await dedicatedProfileOwnsCdp()) {
    await stopDedicatedProfile();
    await sleep(400);
  }
  for (const url of cdpCandidates()) {
    if (await probeCdp(url)) return url;
  }
  return "";
}

/** True if a leftover dedicated tracking Chrome is still running. */
function dedicatedProfileRunning() {
  return dedicatedProfileOwnsCdp();
}

/**
 * Only start the user's real Chrome/Edge with remote debugging when that
 * browser is not already open. Never uses ~/.coact/chrome-cdp.
 */
async function ensureChromeLaunched(cdpUrl) {
  if (await dedicatedProfileOwnsCdp()) {
    await stopDedicatedProfile();
    await sleep(400);
  }
  if (await probeCdp(cdpUrl)) return true;
  if (await userBrowserRunning()) {
    return false;
  }
  if (launching) return launching;

  launching = (async () => {
    let port = 9222;
    try {
      port = Number(new URL(cdpUrl).port) || 9222;
    } catch {
      /* keep default */
    }
    const dataDir = userBrowserDataDir();
    const args = [
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${dataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ];
    const child = spawn(chromeLaunchPath(), args, { detached: true, stdio: "ignore" });
    child.unref();
    for (let i = 0; i < 40; i++) {
      if (await probeCdp(cdpUrl)) return true;
      await sleep(300);
    }
    return probeCdp(cdpUrl);
  })();

  try {
    return await launching;
  } finally {
    launching = null;
  }
}

function chromeLaunchPath() {
  if (process.platform === "darwin") {
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const edge = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    if (fs.existsSync(chrome)) return chrome;
    if (fs.existsSync(edge)) return edge;
    return chrome;
  }
  if (process.platform === "win32") {
    const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    if (fs.existsSync(chrome)) return chrome;
    if (fs.existsSync(edge)) return edge;
    return chrome;
  }
  return "google-chrome";
}

function dedicatedUserDataDir() {
  return path.join(os.homedir(), ".coact", "chrome-cdp");
}

function userBrowserDataDir() {
  if (process.platform === "darwin") {
    const chrome = path.join(os.homedir(), "Library", "Application Support", "Google Chrome");
    const edge = path.join(os.homedir(), "Library", "Application Support", "Microsoft Edge");
    if (fs.existsSync(chrome)) return chrome;
    if (fs.existsSync(edge)) return edge;
    return chrome;
  }
  if (process.platform === "win32") {
    const root = process.env.LOCALAPPDATA || "";
    const chrome = path.join(root, "Google", "Chrome", "User Data");
    const edge = path.join(root, "Microsoft", "Edge", "User Data");
    if (fs.existsSync(chrome)) return chrome;
    return edge;
  }
  return path.join(os.homedir(), ".config", "google-chrome");
}

function pgrep(pattern) {
  return new Promise((resolve) => {
    execFile("pgrep", ["-f", pattern], (err, stdout) => {
      resolve(Boolean(String(stdout || "").trim()));
    });
  });
}

function userBrowserRunning() {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("tasklist", (err, stdout) => {
        const s = String(stdout || "");
        resolve(/chrome\.exe/i.test(s) || /msedge\.exe/i.test(s));
      });
    });
  }
  return new Promise((resolve) => {
    execFile("ps", ["-ax", "-o", "command="], (err, stdout) => {
      const lines = String(stdout || "").split("\n");
      const real = lines.some(
        (line) =>
          (/Google Chrome\.app|Microsoft Edge\.app/.test(line) &&
            !line.includes(".coact/chrome-cdp")),
      );
      resolve(real);
    });
  });
}

function stopDedicatedProfile() {
  const dir = dedicatedUserDataDir();
  return new Promise((resolve) => {
    const done = () => resolve();
    if (process.platform === "win32") {
      execFile("taskkill", ["/F", "/IM", "chrome.exe", "/FI", `WINDOWTITLE eq *chrome-cdp*`], () => done());
      return;
    }
    execFile("pkill", ["-f", `user-data-dir=${dir}`], () => done());
  });
}

async function dedicatedProfileOwnsCdp() {
  return pgrep(`user-data-dir=${dedicatedUserDataDir()}`);
}

function probeCdp(cdpUrl) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(Boolean(ok));
    };
    try {
      const u = new URL("/json/version", cdpUrl);
      const req = http.get(u, { timeout: 800 }, (res) => {
        res.resume();
        done(res.statusCode === 200);
      });
      req.on("error", () => done(false));
      req.on("timeout", () => {
        req.destroy();
        done(false);
      });
    } catch {
      done(false);
    }
  });
}

/** True if a Chrome process is already running against our dedicated profile dir. */
function dedicatedProfileRunning() {
  return new Promise((resolve) => {
    const dir = chromeUserDataDir();
    execFile("pgrep", ["-f", `user-data-dir=${dir}`], (err, stdout) => {
      resolve(Boolean(String(stdout || "").trim()));
    });
  });
}

/** Launches the dedicated CDP profile at most once, even under concurrent callers. */
async function ensureChromeLaunched(cdpUrl) {
  if (await probeCdp(cdpUrl)) return true;
  if (await dedicatedProfileRunning()) {
    // Already starting up — just wait for the port.
    for (let i = 0; i < 25; i++) {
      if (await probeCdp(cdpUrl)) return true;
      await sleep(300);
    }
    return probeCdp(cdpUrl);
  }
  if (launching) return launching;

  launching = (async () => {
    let port = 9222;
    try {
      port = Number(new URL(cdpUrl).port) || 9222;
    } catch {
      /* keep default */
    }
    const args = [
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${chromeUserDataDir()}`,
      "--no-first-run",
      "--no-default-browser-check",
    ];
    const child = spawn(chromeLaunchPath(), args, { detached: true, stdio: "ignore" });
    child.unref();
    for (let i = 0; i < 40; i++) {
      if (await probeCdp(cdpUrl)) return true;
      await sleep(300);
    }
    return probeCdp(cdpUrl);
  })();

  try {
    return await launching;
  } finally {
    launching = null;
  }
}

async function playwright() {
  return require("playwright-core");
}

function isConnected() {
  try {
    return Boolean(browser && browser.isConnected());
  } catch {
    return false;
  }
}

function isTracking() {
  return isConnected();
}

function lastConnectError() {
  return lastError;
}

async function attachContexts() {
  if (!browser) return;
  for (let i = 0; i < 25; i++) {
    const ctxs = browser.contexts() || [];
    if (ctxs.length) {
      context = ctxs[0];
      return;
    }
    await sleep(150);
  }
  context = (browser.contexts() || [])[0] || null;
}

function allPages() {
  const ctxs = browser?.contexts?.() || (context ? [context] : []);
  const pages = [];
  for (const c of ctxs) {
    try {
      pages.push(...(c.pages() || []));
    } catch {
      /* closed */
    }
  }
  return pages;
}

function usableUrl(u) {
  return chromeMac.isInjectableUrl(u);
}

async function connect({ launch = false } = {}) {
  if (isConnected()) {
    if (await dedicatedProfileOwnsCdp()) {
      disconnect();
    } else {
      lastError = "";
      return { ok: true };
    }
  }
  if (connecting) return connecting;

  connecting = (async () => {
    let url = await firstOpenCdp();
    if (!url && launch) {
      const launched = await ensureChromeLaunched(cdpHttpUrl());
      url = launched ? cdpHttpUrl() : await firstOpenCdp();
    }
    if (!url) {
      lastError = launch
        ? `Could not start the tracking Chrome/Edge at ${cdpHttpUrl()}`
        : "no_cdp";
      return { ok: false, error: lastError };
    }
    try {
      const { chromium } = await playwright();
      browser = await chromium.connectOverCDP(url);
      await attachContexts();
      await installActivityProbe();
      browser.on("disconnected", () => {
        browser = null;
        context = null;
      });
      lastError = "";
      return { ok: true, url };
    } catch (err) {
      browser = null;
      context = null;
      lastError = err?.message || "cdp_attach_failed";
      return { ok: false, error: lastError };
    }
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

function disconnect() {
  stopWatch();
  stopUrlPoll();
  const b = browser;
  browser = null;
  context = null;
  if (!b) return;
  // Disconnect only — do not send Browser.close (that would quit the tracking Chrome).
  try {
    const conn = b._connection || b._wrappedConnection;
    if (conn && typeof conn.close === "function") {
      conn.close();
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    b.close().catch(() => {});
  } catch {
    /* ignore */
  }
}

function hintScore(url) {
  const u = String(url || "").toLowerCase();
  if (!usableUrl(u)) return -1;
  let n = 1;
  if (preferredUrl) {
    const pref = preferredUrl.toLowerCase();
    const file = pref.split("/").pop()?.split("?")[0] || "";
    if (u === pref) n += 400;
    else if (file && u.includes(file)) n += 180;
  }
  for (const h of matchHints) {
    const hint = String(h).toLowerCase();
    if (hint.length < 4) continue;
    if (u.includes(hint)) n += 8 + Math.min(hint.length, 24);
  }
  return n;
}

const ACTIVITY_PROBE = () => {
  if (window.__ltActInstalled) return;
  window.__ltActInstalled = true;
  window.__ltActivity = Date.now();
  const bump = () => {
    window.__ltActivity = Date.now();
  };
  for (const ev of ["pointerdown", "keydown", "input", "focus"]) {
    window.addEventListener(ev, bump, true);
  }
};

async function installActivityProbe() {
  const ctxs = browser?.contexts?.() || [];
  for (const ctx of ctxs) {
    try {
      await ctx.addInitScript(ACTIVITY_PROBE);
    } catch {
      /* ignore */
    }
    for (const p of ctx.pages() || []) {
      try {
        await p.evaluate(ACTIVITY_PROBE);
      } catch {
        /* closed or origin */
      }
    }
  }
}

async function pageLiveScore(page) {
  let u = "";
  try {
    u = page.url() || "";
  } catch {
    return { page, score: -1 };
  }
  let score = hintScore(u);
  if (score < 0) return { page, score };
  try {
    const info = await page.evaluate(() => ({
      focused: document.hasFocus(),
      visible: document.visibilityState === "visible",
      activity: Number(window.__ltActivity || 0),
    }));
    if (info.visible) score += 50;
    if (info.focused) score += 120;
    if (info.activity && Date.now() - info.activity < 15000) score += 200;
    else if (info.activity && Date.now() - info.activity < 60000) score += 40;
  } catch {
    /* not injectable */
  }
  return { page, score };
}

async function pickPage(pages) {
  const list = pages || [];
  if (!list.length) return null;
  const scored = await Promise.all(list.map((p) => pageLiveScore(p)));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 0 ? scored[0].page : null;
}

async function activePage() {
  const ready = await connect({ launch: false });
  if (!ready.ok) return null;
  return pickPage(allPages());
}

async function currentPageMeta() {
  try {
    const p = await activePage();
    if (!p) return { url: lastPageMeta.url, title: lastPageMeta.title };
    const url = p.url() || "";
    if (!usableUrl(url)) return lastPageMeta;
    const title = (await p.title().catch(() => "")) || "";
    lastPageMeta = { url, title };
    return { url, title };
  } catch {
    return { url: lastPageMeta.url, title: lastPageMeta.title };
  }
}

/** Runs in the page. Collects errors, validation, and plain form fields. */
function collectExplainSnippetInPage() {
  const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const seen = new Set();
  const errorLines = [];
  const pushError = (value) => {
    const text = compact(value);
    if (text.length < 2 || text.length > 280) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    errorLines.push(`- ${text}`);
  };

  document
    .querySelectorAll(
      '[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"], [aria-invalid="true"], [class*="error"], [class*="invalid"], [class*="toast"], [class*="alert"], .validation-message, .field-error, .invalid-feedback, [data-error]',
    )
    .forEach((el) => {
      pushError(el.innerText || el.textContent || el.getAttribute("data-error") || "");
    });
  document.querySelectorAll("[aria-errormessage], [aria-describedby]").forEach((el) => {
    const ids = `${el.getAttribute("aria-errormessage") || ""} ${el.getAttribute("aria-describedby") || ""}`;
    ids.split(/\s+/).forEach((id) => {
      if (!id) return;
      const node = document.getElementById(id);
      if (node) pushError(node.innerText || node.textContent || "");
    });
  });
  document.querySelectorAll("input, textarea, select").forEach((el) => {
    try {
      if (el.validationMessage && el.validity && !el.validity.valid) {
        const lab = compact(
          (el.closest("label")?.innerText || el.getAttribute("aria-label") || el.name || el.id || "field").split(
            "\n",
          )[0],
        );
        pushError(`${lab}: ${el.validationMessage}`);
      }
    } catch {
      /* ignore */
    }
  });

  const fieldLines = [];
  document
    .querySelectorAll(
      'input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]), textarea, select',
    )
    .forEach((el) => {
      const lab = compact(
        (
          el.closest("label")?.innerText ||
          el.getAttribute("aria-label") ||
          el.placeholder ||
          el.name ||
          el.id ||
          "field"
        ).split("\n")[0],
      ).slice(0, 80);
      let val = "";
      const type = String(el.type || "").toLowerCase();
      if (type === "checkbox" || type === "radio") val = el.checked ? "checked" : "";
      else val = compact(el.value).slice(0, 120);
      fieldLines.push(`- ${lab || "field"}${val ? ` = ${val}` : ""}`);
    });

  const lines = [];
  if (errorLines.length) {
    lines.push("Visible errors:");
    lines.push(...errorLines.slice(0, 12));
  }
  if (fieldLines.length) {
    lines.push("Visible questions:");
    lines.push(...fieldLines.slice(0, 20));
  }
  if (!lines.length) {
    const body = compact(document.body?.innerText || "").slice(0, 1200);
    if (body) {
      lines.push("Visible text:");
      lines.push(body);
    }
  }
  return lines.join("\n");
}

async function currentPageSnippet() {
  const meta = await currentPageMeta();
  const url = String(meta?.url || "").trim();
  const title = String(meta?.title || "").trim();
  const header = [url ? `URL: ${url}` : "", title ? `Title: ${title}` : ""].filter(Boolean);
  try {
    const p = await activePage();
    if (!p) return { url, title, text: header.join("\n") };
    const body = await p.evaluate(collectExplainSnippetInPage).catch(() => "");
    const text = [...header, String(body || "").trim()].filter(Boolean).join("\n");
    return { url: p.url() || url, title: (await p.title().catch(() => title)) || title, text };
  } catch {
    return { url, title, text: header.join("\n") };
  }
}

async function openOrFocus(url) {
  const target = String(url || "").trim();
  if (target) preferredUrl = target;
  const ready = await connect({ launch: true });
  if (!ready.ok) return ready;
  if (!target) return { ok: false, error: "no_url" };

  const file = target.split("/").pop()?.split("?")[0] || "";
  const pages = allPages();
  let hit = pages.find((p) => {
    const u = p.url() || "";
    return u === target || (file && u.includes(file));
  });
  if (!hit) {
    const ctx = context || (browser.contexts() || [])[0];
    if (!ctx) return { ok: false, error: "no_chrome_context" };
    context = ctx;
    hit = await ctx.newPage();
    await hit.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
  } else {
    context = hit.context();
    await hit.bringToFront().catch(() => {});
    const u = hit.url() || "";
    if (file && !u.includes(file)) {
      await hit.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
    }
  }
  lastPageMeta = { url: hit.url(), title: await hit.title().catch(() => "") };
  return { ok: true, url: hit.url() };
}

function stepValue(step, data, approved = {}) {
  if (step?.id != null && approved[step.id] != null) {
    return String(approved[step.id] ?? "");
  }
  const key = step?.valueFrom || step?.id;
  const raw = data?.[key] ?? data?.[step?.id];
  return raw == null ? "" : String(raw);
}

async function locatorFor(page, step) {
  if (step?.selector) {
    const loc = page.locator(String(step.selector));
    if ((await loc.count()) > 0) return loc.first();
  }
  const labels = [
    ...(Array.isArray(step?.findByLabel) ? step.findByLabel : []),
    step?.label,
  ].filter(Boolean);
  for (const label of labels) {
    const byLabel = page.getByLabel(String(label), { exact: false });
    if ((await byLabel.count()) > 0) return byLabel.first();
    const byText = page.getByRole("textbox", { name: String(label), exact: false });
    if ((await byText.count()) > 0) return byText.first();
  }
  return null;
}

async function applyOneStep(page, step, value) {
  const action = String(step?.action || "fill").toLowerCase();
  if (action === "highlight" || action === "wait") return { ok: true };

  if (page) {
    const loc = await locatorFor(page, step);
    if (loc) {
      try {
        if (action === "fill") {
          await loc.fill(value, { timeout: 8000 });
        } else if (action === "check") {
          await loc.check({ force: true, timeout: 8000 }).catch(() => loc.click());
        } else if (action === "click") {
          await loc.click({ timeout: 8000 });
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || "step_failed" };
      }
    }
  }
  if (step?.selector) {
    const mac = await chromeMac.fillSelector(step.selector, value);
    if (mac.ok) return mac;
  }
  return { ok: false, error: `No control for ${step.label || step.id}` };
}

async function readField(page, step) {
  const loc = await locatorFor(page, step);
  if (!loc) return "";
  try {
    return await loc.evaluate((el) => {
      if (!el) return "";
      const type = String(el.type || "").toLowerCase();
      if (type === "checkbox" || type === "radio") return el.checked ? "true" : "";
      if ("value" in el) return String(el.value || "");
      return String(el.textContent || "").trim();
    });
  } catch {
    return "";
  }
}

function valuesMatch(expected, actual) {
  const e = String(expected || "").trim().toLowerCase();
  const a = String(actual || "").trim().toLowerCase();
  if (!e) return Boolean(a);
  if (!a) return false;
  return a === e || a.includes(e) || e.includes(a);
}

async function runSop({
  cardId,
  sop,
  data = {},
  startIndex = 0,
  completedStepIds = [],
  agentApprovedValues = {},
  onStep,
  onFinished,
}) {
  const ready = await connect({ launch: true });
  if (!ready.ok) {
    onFinished?.({ cardId, status: "run_failed", reason: ready.error });
    return ready;
  }

  runCtl = { cancelled: false, paused: false };
  const firstPage = await activePage();
  if (!firstPage) {
    onFinished?.({ cardId, status: "run_failed", reason: "No Chrome/Edge page open" });
    return { ok: false, error: "no_page" };
  }

  const steps = sop?.steps || [];
  const doneSet = new Set(completedStepIds || []);

  for (let i = Math.max(0, startIndex); i < steps.length; i++) {
    while (runCtl.paused && !runCtl.cancelled) await sleep(120);
    if (runCtl.cancelled) {
      onFinished?.({ cardId, status: "run_cancelled", reason: "Take over" });
      return { ok: false, cancelled: true };
    }

    const page = (await activePage()) || firstPage;
    const step = steps[i];
    if (doneSet.has(step.id)) continue;

    const action = String(step.action || "").toLowerCase();
    const pageUrl = page.url();
    onStep?.({
      cardId,
      stepId: step.id,
      status: "running",
      source: "app",
      action: step.action,
      label: step.label,
      pageUrl,
    });

    const value = stepValue(step, data, agentApprovedValues);
    const result = await applyOneStep(page, step, value);
    onStep?.({
      cardId,
      stepId: step.id,
      status: result.ok ? "done" : "failed",
      error: result.error || null,
      source: "app",
      action: step.action,
      key: step.valueFrom || step.id,
      value: action === "fill" ? value : step.label || "done",
      label: step.label,
      pageUrl,
    });

    if (!result.ok && step.mandatory) {
      onFinished?.({
        cardId,
        status: "run_failed",
        failedStepLabel: step.label || step.id,
        reason: result.error,
      });
      return result;
    }
    await sleep(350);
  }

  onFinished?.({ cardId, status: "run_complete", reason: "Filled from LiveTrack" });
  return { ok: true };
}

function stopWatch() {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

function watchSop({ cardId, sop, data = {}, onStep }) {
  stopWatch();
  const last = new Map();
  let inflight = false;
  watchTimer = setInterval(async () => {
    if (inflight) return;
    inflight = true;
    try {
      const page = await activePage();
      for (const step of sop?.steps || []) {
        const action = String(step.action || "").toLowerCase();
        if (action === "highlight" || action === "wait") continue;
        const expected = stepValue(step, data);
        const actual = page
          ? await readField(page, step)
          : step.selector
            ? await chromeMac.readSelector(step.selector)
            : "";
        let done = false;
        if (action === "check") done = actual === "true" || actual === "on";
        else if (action === "click") done = Boolean(String(actual).trim());
        else done = Boolean(String(actual).trim());
        const prev = last.get(step.id);
        if (done && prev === "done") continue;
        if (!done && prev !== "done") continue;
        last.set(step.id, done ? "done" : "pending");
        onStep?.({
          cardId,
          stepId: step.id,
          status: done ? "done" : "pending",
          source: "app",
          action: step.action,
          key: step.valueFrom || step.id,
          value: actual || expected,
          label: step.label,
          pageUrl: page ? page.url() : lastPageMeta.url,
        });
      }
    } catch {
      /* page closed */
    } finally {
      inflight = false;
    }
  }, 400);
  return { ok: true };
}

function control(action) {
  const a = String(action || "").toLowerCase();
  if (a === "pause") runCtl.paused = true;
  else if (a === "resume") runCtl.paused = false;
  else if (a === "cancel" || a === "stop") {
    runCtl.cancelled = true;
    runCtl.paused = false;
  }
  return { ok: true, action: a };
}

function startUrlPoll(onMeta, intervalMs = 800) {
  stopUrlPoll();
  const tick = async () => {
    if (!isConnected()) return;
    const meta = await currentPageMeta();
    if (!usableUrl(meta?.url)) return;
    onMeta?.(meta);
  };
  tick();
  urlPollTimer = setInterval(tick, intervalMs);
}

function stopUrlPoll() {
  if (urlPollTimer) {
    clearInterval(urlPollTimer);
    urlPollTimer = null;
  }
}

async function applyStep(step, value) {
  const page = await activePage();
  return applyOneStep(page, step, value);
}

async function captureVisiblePng() {
  try {
    const page = await activePage();
    if (!page) return { ok: false, error: "no_page" };
    const buffer = await page.screenshot({ type: "png" });
    const meta = await currentPageMeta();
    return {
      ok: true,
      buffer,
      url: meta.url || "",
      title: meta.title || "",
    };
  } catch (err) {
    return { ok: false, error: err?.message || "screenshot_failed" };
  }
}

function _browserForCapture() {
  return browser;
}

async function startCaptureRecording() {
  return playwrightCapture.startCaptureRecording(module.exports);
}

async function stopCaptureRecording() {
  return playwrightCapture.stopCaptureRecording(module.exports);
}

function captureRecordingStatus() {
  return playwrightCapture.status();
}

module.exports = {
  DEFAULT_CDP,
  cdpHttpUrl,
  isConnected,
  isTracking,
  lastConnectError,
  connect,
  disconnect,
  currentPageMeta,
  currentPageSnippet,
  openOrFocus,
  runSop,
  watchSop,
  stopWatch,
  applyOneStep,
  applyStep,
  captureVisiblePng,
  activePage,
  allPages,
  stepValue,
  valuesMatch,
  control,
  startUrlPoll,
  stopUrlPoll,
  setMatchHints,
  setPreferredUrl,
  startCaptureRecording,
  stopCaptureRecording,
  captureRecordingStatus,
  _browserForCapture,
};
