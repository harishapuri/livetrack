/**
 * Attach extension-parity page capture via Playwright CDP (exposeBinding) or,
 * on macOS without CDP, Chrome AppleScript inject + buffer poll.
 */
const chromeMac = require("./chrome-mac");
const {
  pageCaptureEnableSource,
  pageCaptureInstallerSource,
  pageCaptureDrainSource,
} = require("./capture-dom");
const { forwardCaptureEvent } = require("./capture-forward");

let active = false;
let via = "";
/** @type {WeakSet<object>} */
const boundPages = new WeakSet();
/** @type {WeakSet<object>} */
const initContexts = new WeakSet();
/** @type {ReturnType<typeof setInterval>|null} */
let pollTimer = null;
/** @type {((page: object) => void)|null} */
let pageListener = null;
/** @type {object|null} */
let browserRef = null;
let lastError = "";

function status() {
  return {
    active,
    via: active ? via : null,
    error: lastError || "",
  };
}

function isActive() {
  return active;
}

function forward(event) {
  if (!event || typeof event !== "object") return;
  forwardCaptureEvent({
    kind: "playwright",
    source: "human",
    actor: "user",
    ...event,
  }).catch(() => {});
}

async function bindPage(page) {
  if (!page) return;
  const first = !boundPages.has(page);
  if (first) {
    try {
      await page.exposeBinding("__ltCaptureEvent", (_source, event) => {
        forward(event);
      });
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (!/has been already registered|Target closed|closed/i.test(msg)) {
        lastError = msg;
      }
    }
    try {
      boundPages.add(page);
    } catch {
      /* WeakSet ok */
    }
    page.on("load", () => {
      if (!active) return;
      page.evaluate(pageCaptureEnableSource(true)).catch(() => {});
    });
    page.on("framenavigated", (frame) => {
      if (!active || frame !== page.mainFrame()) return;
      page.evaluate(pageCaptureEnableSource(true)).catch(() => {});
    });
  }
  if (!active) return;
  try {
    await page.evaluate(pageCaptureEnableSource(true));
  } catch {
    /* chrome:// or closed */
  }
}

async function installOnContext(ctx) {
  if (!ctx) return;
  if (!initContexts.has(ctx)) {
    try {
      await ctx.addInitScript(pageCaptureInstallerSource());
      await ctx.addInitScript("window.__ltPwCaptureOn=true;");
      initContexts.add(ctx);
    } catch {
      /* ignore */
    }
    if (!pageListener) {
      pageListener = (page) => {
        if (!active) return;
        bindPage(page).catch(() => {});
      };
    }
    try {
      ctx.on("page", pageListener);
    } catch {
      /* ignore */
    }
  }
  for (const page of ctx.pages() || []) {
    await bindPage(page);
  }
}

async function attachPlaywright(browserAgent) {
  const ready = await browserAgent.connect({ launch: false });
  if (!ready?.ok) {
    lastError = ready?.error || "no_cdp";
    return { ok: false, via: "", error: lastError };
  }
  browserRef = browserAgent;
  const contexts = [];
  try {
    const b = browserAgent._browserForCapture?.() || null;
    if (b?.contexts) {
      for (const c of b.contexts() || []) {
        if (c && !contexts.includes(c)) contexts.push(c);
      }
    }
  } catch {
    /* ignore */
  }
  if (!contexts.length) {
    try {
      const page = await browserAgent.activePage();
      if (page?.context) contexts.push(page.context());
    } catch {
      /* ignore */
    }
  }
  if (!contexts.length) {
    const pages = typeof browserAgent.allPages === "function" ? browserAgent.allPages() : [];
    for (const page of pages || []) {
      await bindPage(page);
    }
    if (!pages?.length) {
      lastError = "no_page";
      return { ok: false, via: "playwright", error: lastError };
    }
  } else {
    for (const ctx of contexts) {
      await installOnContext(ctx);
    }
  }
  via = "playwright";
  lastError = "";
  return { ok: true, via };
}

async function drainMacBuffer() {
  if (!active || via !== "chrome-mac") return;
  try {
    const raw = await chromeMac.evalInAnyTab(pageCaptureDrainSource(), {
      matchPreferred: false,
    });
    if (!raw || raw === "[]") return;
    let events;
    try {
      events = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(events)) return;
    for (const ev of events) forward(ev);
  } catch {
    /* ignore */
  }
}

async function attachChromeMac() {
  if (process.platform !== "darwin") {
    return { ok: false, via: "", error: "chrome_mac_unsupported" };
  }
  const src = pageCaptureEnableSource(true);
  let hits = 0;
  if (typeof chromeMac.evalInAllTabs === "function") {
    hits = await chromeMac.evalInAllTabs(src);
  }
  if (!hits) {
    const out = await chromeMac.evalInAnyTab(src, { matchPreferred: false });
    if (out !== "ok" && out !== "installed" && out !== "already") {
      // Still treat as ok if Chrome returned empty on a restricted page; keep trying via poll
      lastError = "chrome_mac_inject_pending";
    }
  }
  via = "chrome-mac";
  lastError = "";
  if (pollTimer) clearInterval(pollTimer);
  let ticks = 0;
  pollTimer = setInterval(() => {
    ticks += 1;
    if (ticks % 8 === 0) {
      // Re-attach after navigations (~2s)
      chromeMac.evalInAllTabs?.(pageCaptureEnableSource(true)).catch(() => {});
    }
    drainMacBuffer().catch(() => {});
  }, 250);
  return { ok: true, via };
}

async function startCaptureRecording(browserAgent) {
  if (active) return { ok: true, ...status() };
  active = true;
  lastError = "";
  via = "";

  const pw = await attachPlaywright(browserAgent);
  if (pw.ok) return { ok: true, ...status() };

  const mac = await attachChromeMac();
  if (mac.ok) return { ok: true, ...status(), cdpError: pw.error };

  active = false;
  lastError = pw.error || mac.error || "capture_attach_failed";
  return { ok: false, ...status() };
}

async function stopCaptureRecording(browserAgent) {
  active = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const agent = browserAgent || browserRef;
  if (via === "playwright" && agent) {
    try {
      const pages = [];
      const p = await agent.activePage?.();
      if (p) pages.push(p);
      try {
        const b = agent._browserForCapture?.();
        for (const ctx of b?.contexts?.() || []) {
          for (const page of ctx.pages() || []) {
            if (!pages.includes(page)) pages.push(page);
          }
        }
      } catch {
        /* ignore */
      }
      for (const page of pages) {
        try {
          await page.evaluate(`(() => { window.__ltPwCaptureOn=false; return "ok"; })()`);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (via === "chrome-mac") {
    try {
      await chromeMac.evalInAnyTab(`(() => { window.__ltPwCaptureOn=false; return "ok"; })()`, {
        matchPreferred: false,
      });
    } catch {
      /* ignore */
    }
  }
  via = "";
  browserRef = null;
  return { ok: true, ...status() };
}

module.exports = {
  startCaptureRecording,
  stopCaptureRecording,
  isActive,
  status,
};
