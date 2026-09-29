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

function shouldShotAction() {
  return false;
}

async function highlightAndScreenshotPage(page, event) {
  if (!page || !event) return event;
  const rect = event.elementRect && typeof event.elementRect === "object" ? event.elementRect : {};
  try {
    await page.evaluate((r) => {
      document.getElementById("lt-step-shot-hl")?.remove();
      const box = document.createElement("div");
      box.id = "lt-step-shot-hl";
      Object.assign(box.style, {
        position: "fixed",
        left: `${Number(r?.x) || 0}px`,
        top: `${Number(r?.y) || 0}px`,
        width: `${Math.max(8, Number(r?.width) || 0)}px`,
        height: `${Math.max(8, Number(r?.height) || 0)}px`,
        border: "3px solid #f59e0b",
        borderRadius: "4px",
        boxShadow: "0 0 0 4px rgba(245,158,11,0.45), 0 0 0 9999px rgba(15,23,42,0.28)",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      document.documentElement.appendChild(box);
    }, rect);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const buffer = await page.screenshot({ type: "png" });
    if (buffer?.length) {
      event.screenshotDataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
      event.screenshotSource = "playwright";
    }
  } catch {
    /* page closed */
  }
  try {
    await page.evaluate(() => document.getElementById("lt-step-shot-hl")?.remove());
  } catch {
    /* ignore */
  }
  return event;
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
      await page.exposeBinding("__ltCaptureEvent", async (_source, event) => {
        if (shouldShotAction(event?.action)) {
          try {
            await highlightAndScreenshotPage(page, event);
          } catch {
            /* shot optional */
          }
        }
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

async function attachToBrowser(pwBrowser) {
  if (!pwBrowser) return { ok: false, error: "no_browser" };
  active = true;
  lastError = "";
  browserRef = {
    connect: async () => ({ ok: true }),
    _browserForCapture: () => pwBrowser,
    activePage: async () => {
      for (const ctx of pwBrowser.contexts() || []) {
        const pages = ctx.pages() || [];
        if (pages.length) return pages[pages.length - 1];
      }
      return null;
    },
    allPages: () => {
      const pages = [];
      for (const ctx of pwBrowser.contexts() || []) {
        pages.push(...(ctx.pages() || []));
      }
      return pages;
    },
  };
  try {
    pwBrowser.on("context", (ctx) => {
      if (!active) return;
      installOnContext(ctx).catch(() => {});
    });
  } catch {
    /* ignore */
  }
  for (const ctx of pwBrowser.contexts() || []) {
    await installOnContext(ctx);
  }
  via = "playwright";
  return { ok: true, via };
}

function withDeadline(promise, ms, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

let startGen = 0;

async function startCaptureRecording(browserAgent) {
  const gen = ++startGen;
  active = true;
  lastError = "";
  via = "";

  const pw = await withDeadline(
    attachPlaywright(browserAgent),
    9000,
    { ok: false, via: "", error: "cdp_attach_timeout" }
  );
  if (gen !== startGen) {
    active = false;
    return { ok: false, error: "superseded", ...status() };
  }
  if (pw.ok) return { ok: true, ...status() };

  const mac = await withDeadline(
    attachChromeMac(),
    6000,
    { ok: false, via: "", error: "chrome_mac_timeout" }
  );
  if (gen !== startGen) {
    active = false;
    return { ok: false, error: "superseded", ...status() };
  }
  if (mac.ok) return { ok: true, ...status(), cdpError: pw.error };

  active = false;
  lastError = pw.error || mac.error || "capture_attach_failed";
  return { ok: false, ...status() };
}

async function stopCaptureRecording(browserAgent) {
  startGen += 1;
  active = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const agent = browserAgent || browserRef;
  const teardown = (async () => {
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
            await withDeadline(
              page.evaluate(`(() => { window.__ltPwCaptureOn=false; return "ok"; })()`),
              1500,
              null
            );
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
  })();
  await withDeadline(teardown, 4000, null);
  via = "";
  browserRef = null;
  return { ok: true, ...status() };
}

module.exports = {
  startCaptureRecording,
  attachToBrowser,
  stopCaptureRecording,
  isActive,
  status,
};
