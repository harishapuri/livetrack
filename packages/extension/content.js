(() => {
  const EXT_ID = chrome.runtime?.id || "";
  // After extension reload, an old content script stays alive with a dead context.
  // Tear it down so a reinjected script can take over (page reload not required).
  if (window.__coactContentLoaded) {
    if (window.__coactContentExtId === EXT_ID && EXT_ID) return;
    try {
      window.__coactTeardown?.();
    } catch {
      /* ignore */
    }
  }
  window.__coactContentLoaded = true;
  window.__coactContentExtId = EXT_ID;

  const HIGHLIGHT_STYLE_ID = "coact-highlight-style";
  const STEP_DELAY_MS = 700;
  let tornDown = false;

  function extensionAlive() {
    try {
      return Boolean(chrome.runtime?.id) && !tornDown;
    } catch {
      return false;
    }
  }

  function safeRuntimeSend(message, callback) {
    if (!extensionAlive()) {
      if (typeof callback === "function") callback(undefined);
      return false;
    }
    try {
      if (typeof callback === "function") {
        chrome.runtime.sendMessage(message, (res) => {
          try {
            // Accessing lastError clears it; also detects invalidated context
            void chrome.runtime.lastError;
          } catch {
            handleContextInvalidated();
            callback(undefined);
            return;
          }
          callback(res);
        });
      } else {
        const p = chrome.runtime.sendMessage(message);
        if (p && typeof p.catch === "function") p.catch(() => handleContextInvalidated());
      }
      return true;
    } catch {
      handleContextInvalidated();
      if (typeof callback === "function") callback(undefined);
      return false;
    }
  }

  let runner = {
    cancelled: false,
    paused: false,
    cardId: null,
    // Set when background already activated the tab (Coact may occlude Chrome)
    bypassVisibilityGate: false,
  };

  let watch = {
    cardId: null,
    steps: [],
    data: {},
    attached: false,
    lastStatus: new Map(),
    pollTimer: null,
    muteReports: false,
    /** Intentional Agent-approved values for this run (stepId -> value). Not mistakes. */
    agentApproved: false,
    agentApprovedValues: {},
  };

  // Persist progress per card so switching tabs doesn't lose greens
  const progressByCard = new Map();

  // Agent run suspends sequential locks so Start can fill in order
  let agentRunning = false;
  let seqTipTimer = null;
  let lastMismatchKey = "";
  let tipAnchorEl = null;
  let tipRepositionBound = null;
  const lockMetaByEl = new WeakMap();
  let valueCheckTimer = null;
  let valueCheckSeq = 0;

  function ensureHighlightStyle() {
    let style = document.getElementById(HIGHLIGHT_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = HIGHLIGHT_STYLE_ID;
      document.documentElement.appendChild(style);
    }
    style.textContent = `
      .coact-active-field {
        outline: 3px solid #d71e28 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(215, 30, 40, 0.25) !important;
      }
      /* Red outline only for wrong value / wrong click — not the normal current step */
      .coact-wrong-field {
        outline: 3px solid #d71e28 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(215, 30, 40, 0.32) !important;
        animation: coact-wrong-pulse 1.4s ease-in-out infinite;
      }
      @keyframes coact-wrong-pulse {
        0%, 100% { box-shadow: 0 0 0 4px rgba(215, 30, 40, 0.22); }
        50% { box-shadow: 0 0 0 7px rgba(215, 30, 40, 0.38); }
      }
      .coact-locked-field {
        opacity: 0.55 !important;
        filter: grayscale(0.15);
        cursor: not-allowed !important;
        caret-color: transparent !important;
      }
      .coact-seq-tip {
        position: fixed;
        left: 50%;
        bottom: 28px;
        transform: translateX(-50%) translateY(12px);
        z-index: 2147483646;
        max-width: min(420px, calc(100vw - 32px));
        padding: 12px 16px;
        border-radius: 10px;
        background: #1c1917;
        color: #fafaf9;
        font: 600 13px/1.4 "Segoe UI", system-ui, sans-serif;
        box-shadow: 0 10px 28px rgba(0,0,0,0.28);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.18s ease, transform 0.18s ease;
      }
      .coact-seq-tip.coact-wrong-tip {
        border: 1px solid rgba(215, 30, 40, 0.55);
        background: #2a1214;
        color: #fecaca;
      }
      .coact-seq-tip.coact-seq-tip-visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .coact-seq-tip.coact-seq-tip-anchored {
        bottom: auto;
        right: auto;
        transform: none;
        max-width: min(360px, calc(100vw - 24px));
      }
      .coact-seq-tip.coact-seq-tip-anchored.coact-seq-tip-visible {
        transform: none;
      }
      .coact-seq-tip.coact-seq-tip-anchored::after {
        content: "";
        position: absolute;
        left: var(--coact-tip-arrow-left, 50%);
        width: 10px;
        height: 10px;
        background: inherit;
        border: inherit;
        transform: translateX(-50%) rotate(45deg);
        pointer-events: none;
      }
      .coact-seq-tip.coact-tip-below::after {
        top: -5px;
        border-bottom: none;
        border-right: none;
      }
      .coact-seq-tip.coact-tip-above::after {
        bottom: -5px;
        border-top: none;
        border-left: none;
      }
    `;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitWhilePaused() {
    while (runner.paused && !runner.cancelled) {
      await sleep(120);
    }
  }

  function pageIsVisibleToUser() {
    // After ensureBrowserVisible, Coact may sit on top and mark the page "hidden"
    // even though the form tab is active — still allow the click-stream to run.
    if (runner.bypassVisibilityGate) return true;
    if (document.visibilityState !== "visible") return false;
    // Hidden iframe / background tab — do not fill
    if (document.hidden) return false;
    return true;
  }

  /**
   * Block filling until this tab is actually on-screen so the user can track it.
   */
  async function waitUntilBrowserVisible(cardId, { timeoutMs = 60000 } = {}) {
    if (pageIsVisibleToUser()) return true;

    report({
      cardId,
      status: "reasoning",
      reason: "Switch to the form tab.",
    });

    const started = Date.now();
    while (!runner.cancelled && Date.now() - started < timeoutMs) {
      await waitWhilePaused();
      if (runner.cancelled) return false;
      if (pageIsVisibleToUser()) {
        await sleep(200);
        return true;
      }
      await sleep(250);
    }

    if (!runner.cancelled) {
      report({
        cardId,
        status: "run_failed",
        error: "Form tab not visible",
        reason:
          "Stopped — the form was not visible. Put Chrome/Edge on your main screen, focus the form tab, then Start again.",
      });
    }
    return false;
  }

  function extractFormReferenceFromHref(href) {
    try {
      const u = new URL(String(href || ""));
      const names = [
        "ref",
        "reference",
        "referenceNumber",
        "reference_number",
        "confirmation",
        "confirmationNumber",
        "confirmation_number",
        "confirm",
        "receipt",
        "receiptId",
        "receipt_id",
        "submissionId",
        "submission_id",
        "submission",
        "entry",
        "requestId",
        "request_id",
        "tracking",
        "trackingId",
        "tracking_id",
        "txn",
        "transactionId",
        "id",
      ];
      for (const name of names) {
        const val = u.searchParams.get(name);
        if (val && String(val).trim().length >= 4 && !/^(true|false|0|1)$/i.test(val)) {
          return String(val).trim().slice(0, 64);
        }
      }
      const parts = u.pathname.split("/").filter(Boolean);
      const skip = new Set([
        "sites",
        "forms",
        "form",
        "pages",
        "page",
        "app",
        "index",
        "confirm",
        "confirmation",
        "thank-you",
        "thanks",
        "success",
        "done",
        "complete",
        "submitted",
      ]);
      for (let i = parts.length - 1; i >= 0; i--) {
        let seg = decodeURIComponent(parts[i] || "").replace(/\.html?$/i, "");
        if (!seg || skip.has(seg.toLowerCase())) continue;
        if (/^(REF|RD|CONF|TXN|SUB|RECEIPT)[-_]/i.test(seg) && seg.length >= 6) return seg;
        if (/\d/.test(seg) && /[A-Za-z]/.test(seg) && seg.length >= 6 && seg.length <= 64) return seg;
        if (/^\d{6,}$/.test(seg)) return seg;
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  function report(payload) {
    const pageUrl = location.href;
    const enriched = { ...payload, pageUrl };
    if (payload?.status === "run_complete" || payload?.status === "done") {
      const ref = extractFormReferenceFromHref(pageUrl);
      if (ref) enriched.formReference = ref;
    }
    safeRuntimeSend({ type: "step_update", payload: enriched });
  }

  /** Build key/value capture fields for audit logging */
  function captureFieldsForStep(step, valueOverride) {
    if (!step) return {};
    const action = step.action || "fill";
    const key = step.valueFrom || step.id || "";
    let value = valueOverride;
    if (value == null || value === "") {
      if (action === "fill") {
        try {
          value = readStepActualValue(step) || "";
        } catch {
          value = "";
        }
      } else if (action === "click" || action === "check") {
        value =
          step.findByText ||
          (Array.isArray(step.findByLabel) ? step.findByLabel[0] : step.findByLabel) ||
          step.label ||
          "clicked";
      } else {
        value = step.label || action;
      }
    }
    return {
      action,
      key: String(key),
      value: value == null ? "" : String(value),
      label: step.label || step.id || "",
    };
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clearHighlights() {
    document.querySelectorAll(".coact-active-field").forEach((node) => {
      node.classList.remove("coact-active-field");
    });
  }

  function questionBlocks() {
    const nodes = Array.from(
      document.querySelectorAll(
        'div[role="listitem"], .Qr7Oae, .freebirdFormviewerComponentsQuestionBaseRoot, div[data-params]'
      )
    );
    // Prefer leaf-ish items with an input inside
    return nodes.filter((n) =>
      n.querySelector(
        'input:not([type="hidden"]):not([type="file"]), textarea, [role="checkbox"], [role="radio"]'
      )
    );
  }

  function questionTitle(block) {
    const titleEl =
      block.querySelector('[role="heading"]') ||
      block.querySelector(".M7eMe") ||
      block.querySelector(".HoXoMd") ||
      block.querySelector("span");
    if (titleEl) return normalize(titleEl.textContent);
    const lines = String(block.innerText || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return normalize(lines[0] || "");
  }

  function fieldInBlock(block) {
    return (
      block.querySelector("textarea") ||
      block.querySelector('input[type="text"]') ||
      block.querySelector('input[type="email"]') ||
      block.querySelector('input[type="date"]') ||
      block.querySelector('input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])') ||
      block.querySelector('[contenteditable="true"]')
    );
  }

  function titleMatches(title, hint, mode) {
    const h = normalize(hint);
    const t = normalize(title);
    if (!h || !t) return false;
    if (mode === "exact") return t === h || t === `${h} *` || t.startsWith(`${h} `);
    if (mode === "startsWith") return t.startsWith(h);
    return t.includes(h);
  }

  function findByLabel(labelHints, mode = "includes") {
    const hints = (Array.isArray(labelHints) ? labelHints : [labelHints]).filter(Boolean);
    if (!hints.length) return null;

    const blocks = questionBlocks();
    for (const hint of hints) {
      for (const block of blocks) {
        const title = questionTitle(block);
        if (!titleMatches(title, hint, mode)) continue;
        const field = fieldInBlock(block);
        if (field) return field;
      }
    }

    // Fallback: whole block text contains hint (longer hints only)
    for (const hint of hints) {
      if (normalize(hint).length < 10 && mode !== "includes") continue;
      for (const block of blocks) {
        const text = normalize(block.innerText || "");
        if (!text.includes(normalize(hint))) continue;
        const field = fieldInBlock(block);
        if (field) return field;
      }
    }
    return null;
  }

  function findCheckboxByLabel(labelHints) {
    const hints = (Array.isArray(labelHints) ? labelHints : [labelHints])
      .map(normalize)
      .filter(Boolean);

    const options = Array.from(
      document.querySelectorAll(
        '[role="listitem"] label, [role="listitem"] [role="checkbox"], .docssharedWizToggleLabeledContainer, label'
      )
    );

    for (const hint of hints) {
      for (const opt of options) {
        const text = normalize(opt.innerText || opt.textContent || "");
        if (!text.includes(hint)) continue;
        const box =
          opt.matches('[role="checkbox"]')
            ? opt
            : opt.querySelector('[role="checkbox"]') || opt;
        return box;
      }
    }
    return null;
  }

  function findClickableByText(labelHints) {
    const hints = (Array.isArray(labelHints) ? labelHints : [labelHints])
      .map(normalize)
      .filter(Boolean);
    if (!hints.length) return null;

    const candidates = Array.from(
      document.querySelectorAll(
        'button, a[href], [role="button"], input[type="submit"], input[type="button"], input[type="reset"]'
      )
    );
    for (const hint of hints) {
      for (const el of candidates) {
        if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
        const text = normalize(
          el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || ""
        );
        if (!text) continue;
        // Exact / contains hint. Avoid hint.includes(shortText) — "accept".includes("a") is true.
        if (text === hint || text.includes(hint)) return el;
        if (text.length >= 4 && hint.startsWith(text)) return el;
      }
    }
    return null;
  }

  function querySelectorSafe(selector) {
    if (!selector) return null;
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function resolveElement(step) {
    // Prefer explicit selectors for clicks — fuzzy text can hit the wrong control
    if ((step.action === "click" || step.action === "check") && step.selector) {
      const bySel = querySelectorSafe(step.selector);
      if (bySel) return bySel;
    }
    if (step.findByText || step.findButtonByText) {
      const el = findClickableByText(step.findByText || step.findButtonByText);
      if (el) return el;
    }
    if (step.action === "click" && step.findByLabel) {
      const el = findClickableByText(step.findByLabel);
      if (el) return el;
    }
    if (step.findByLabel) {
      const mode = step.matchMode || (normalize(String(step.findByLabel[0] || "")).length <= 8 ? "exact" : "includes");
      const el = findByLabel(step.findByLabel, mode);
      if (el) return el;
    }
    if (step.findCheckboxByLabel) {
      const el = findCheckboxByLabel(step.findCheckboxByLabel);
      if (el) return el;
    }
    if (step.selector) {
      const el = querySelectorSafe(step.selector);
      if (el) return el;
    }
    return null;
  }

  function performClick(el) {
    if (!el) return false;
    try {
      el.focus?.({ preventScroll: true });
    } catch {
      try {
        el.focus?.();
      } catch {
        /* ignore */
      }
    }
    const opts = { bubbles: true, cancelable: true, view: window, composed: true, buttons: 1 };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    } catch {
      /* PointerEvent may be missing — fall through to .click() */
    }
    try {
      el.click();
      return true;
    } catch {
      return false;
    }
  }

  function stepMayNavigate(step) {
    return Boolean(
      step?.navigates ||
        step?.waitAfter?.urlIncludes ||
        step?.waitAfter?.urlPath ||
        step?.waitAfter?.urlEquals
    );
  }

  async function waitForPredicate(predicate, timeoutMs = 15000, intervalMs = 150) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (runner.cancelled) throw new Error("Cancelled");
      try {
        if (predicate()) return true;
      } catch {
        /* keep waiting */
      }
      await sleep(intervalMs);
    }
    return false;
  }

  async function waitUntilStepReady(step, cardId) {
    const timeoutMs = step.timeoutMs || step.waitAfter?.timeoutMs || 20000;
    if (step.action === "wait") return true;

    const ready = await waitForPredicate(() => Boolean(resolveElement(step)), timeoutMs);
    if (!ready) {
      throw new Error(`Could not find: ${step.label || step.id}`);
    }
    if (cardId && !pageIsVisibleToUser()) {
      const ok = await waitUntilBrowserVisible(cardId, { timeoutMs: 30000 });
      if (!ok) throw new Error("Form tab not visible on screen");
    }
    return true;
  }

  async function settleAfterStep(step) {
    const w = step.waitAfter || {};
    if (w.ms) await sleep(w.ms);

    const timeoutMs = w.timeoutMs || step.timeoutMs || 15000;

    if (w.urlIncludes || w.urlPath || w.urlEquals) {
      const ok = await waitForPredicate(() => {
        const href = location.href;
        if (w.urlEquals && href === w.urlEquals) return true;
        if (w.urlIncludes) {
          if (href.includes(w.urlIncludes)) return true;
          const alt = w.urlIncludes.endsWith(".html")
            ? w.urlIncludes.slice(0, -5)
            : `${w.urlIncludes}.html`;
          if (href.includes(alt)) return true;
        }
        if (w.urlPath && (location.pathname.includes(w.urlPath) || href.includes(w.urlPath))) return true;
        return false;
      }, Math.min(timeoutMs, 2500));
      // Short wait only — full navigations unload this script; background resumes
      return ok ? "url-matched" : "url-pending";
    }

    if (w.selector || w.hideSelector) {
      const ok = await waitForPredicate(() => {
        if (w.selector) {
          try {
            if (!document.querySelector(w.selector)) return false;
          } catch {
            return false;
          }
        }
        if (w.hideSelector) {
          try {
            if (document.querySelector(w.hideSelector)) return false;
          } catch {
            return false;
          }
        }
        return true;
      }, timeoutMs);
      if (!ok) throw new Error(`Timed out waiting after “${step.label || step.id}”`);
      return "dom-ready";
    }

    return "ok";
  }

  function postCheckpoint(payload) {
    return new Promise((resolve) => {
      const ok = safeRuntimeSend({ type: "run_checkpoint", payload }, () => resolve(true));
      if (!ok) resolve(false);
    });
  }

  function cancelCheckpoint() {
    safeRuntimeSend({ type: "run_checkpoint_cancel" });
  }

  async function fillGoogleStyle(el, value) {
    const text = String(value ?? "");
    el.focus();
    await sleep(80);

    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return;
    }

    // Clear existing
    el.select?.();
    const ok = document.execCommand("insertText", false, text);
    if (!ok || el.value !== text) {
      const proto =
        el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor?.set) descriptor.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" })
      );
    }

    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function runStep(step, data, cardId) {
    ensureHighlightStyle();

    const visible = await waitUntilBrowserVisible(cardId);
    if (!visible || runner.cancelled) {
      throw new Error("Form tab not visible on screen");
    }

    if (step.action === "wait") {
      const w = step.waitAfter || step;
      if (w.ms) await sleep(w.ms);
      if (w.selector || w.urlIncludes || w.urlPath || w.urlEquals) {
        await settleAfterStep({ waitAfter: w, label: step.label, id: step.id, timeoutMs: step.timeoutMs });
      }
      return;
    }

    await waitUntilStepReady(step, cardId);
    const el = resolveElement(step);
    if (!el) {
      throw new Error(`Could not find: ${step.label || step.id}`);
    }

    clearHighlights();
    el.classList.add("coact-active-field");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    await sleep(250);

    // Re-check right before typing — user may have switched away
    if (!pageIsVisibleToUser()) {
      const again = await waitUntilBrowserVisible(cardId);
      if (!again || runner.cancelled) {
        throw new Error("Form tab not visible on screen");
      }
    }

    if (step.action === "fill") {
      // Primary: first allowedValues / first valueFrom array entry / scalar valueFrom / step.value
      const value = fillValueForStep(step, data);
      await fillGoogleStyle(el, value);
    } else if (step.action === "click" || step.action === "check") {
      const checked = el.getAttribute("aria-checked");
      if (checked === "true") return;
      performClick(el);
      // Some Google Forms checkboxes need a second click target
      if (el.getAttribute("aria-checked") !== "true" && step.action === "check") {
        performClick(el.parentElement);
      }
    } else if (step.action === "highlight") {
      el.focus?.();
    } else {
      throw new Error(`Unknown action: ${step.action}`);
    }
  }

  function reasonAboutFailure(step, err) {
    const label = step.label || step.id;
    const msg = err?.message || String(err || "unknown error");
    if (/not find|not found/i.test(msg)) {
      return `Red: “${label}”. I couldn’t find that field on the page. Is the Google Form tab focused, and is that question visible (not on another section)?`;
    }
    if (/chrome:\/\//i.test(msg)) {
      return `Red: “${label}”. Chrome is on a system page. Switch to the form URL (https://docs.google.com/forms/...).`;
    }
    if (/No form found/i.test(msg)) {
      return `Red: form missing. Open the reference letter Google Form first, then press Start.`;
    }
    return `Red: “${label}”. ${msg} I’ll try another way to fill it.`;
  }

  function alternateStep(step) {
    const copy = { ...step };
    if (step.findByLabel) {
      copy.matchMode = "includes";
      copy.findByLabel = step.findByLabel.map((h) => String(h).split(" ")[0]).filter(Boolean);
    }
    if (step.action === "fill" && !copy.selector) {
      copy.selector = "input[type='text'], textarea, input:not([type='hidden'])";
    }
    return copy;
  }

  /** In-memory locator patches for this Start run only */
  const sessionStepPatches = new Map();

  function mergeStepPatch(step) {
    const patch = sessionStepPatches.get(step.id);
    if (!patch) return step;
    return { ...step, ...patch };
  }

  function requestAiRepair({ cardId, step, error, reason }) {
    let snippet = "";
    try {
      snippet = captureLiveSnippet();
    } catch {
      snippet = "";
    }
    return new Promise((resolve) => {
      const ok = safeRuntimeSend(
        {
          type: "await_repair",
          payload: {
            cardId,
            stepId: step.id,
            step: {
              id: step.id,
              label: step.label,
              action: step.action,
              valueFrom: step.valueFrom,
              selector: step.selector,
              findByLabel: step.findByLabel,
              findByText: step.findByText,
              findButtonByText: step.findButtonByText,
            },
            error: error?.message || String(error || ""),
            reason,
            snippet: String(snippet || "").slice(0, 6000),
          },
        },
        (plan) => {
          try {
            if (!extensionAlive() || !plan) {
              resolve({ action: "retry_broad", broadMatch: true, reason: "Repair unavailable" });
              return;
            }
            resolve(plan);
          } catch {
            resolve({ action: "retry_broad", broadMatch: true, reason: "Repair unavailable" });
          }
        }
      );
      if (!ok) {
        resolve({ action: "retry_broad", broadMatch: true, reason: "Repair unavailable" });
      }
    });
  }

  async function applyRepairPlan(plan, step, data, cardId) {
    const action = plan?.action || "retry_broad";
    report({
      cardId,
      status: "reasoning",
      reason: plan?.reason || `AI repair: ${action}`,
    });

    if (action === "skip") {
      report({ cardId, stepId: step.id, status: "done" });
      return;
    }

    let useStep = mergeStepPatch(step);
    const useData = { ...(data || {}) };

    if (action === "rewrite_step" && plan.stepPatch) {
      const patch = {};
      if (plan.stepPatch.selector) patch.selector = plan.stepPatch.selector;
      if (Array.isArray(plan.stepPatch.findByLabel) && plan.stepPatch.findByLabel.length) {
        patch.findByLabel = plan.stepPatch.findByLabel;
      }
      if (Array.isArray(plan.stepPatch.findByText) && plan.stepPatch.findByText.length) {
        patch.findByText = plan.stepPatch.findByText;
      }
      if (Array.isArray(plan.stepPatch.findButtonByText) && plan.stepPatch.findButtonByText.length) {
        patch.findButtonByText = plan.stepPatch.findButtonByText;
      }
      sessionStepPatches.set(step.id, { ...(sessionStepPatches.get(step.id) || {}), ...patch });
      useStep = mergeStepPatch(step);
    }

    if (action === "click_alt" && plan.altFindByText) {
      useStep = {
        ...useStep,
        findButtonByText: [plan.altFindByText],
        findByText: [plan.altFindByText],
      };
    }

    if (action === "retry_broad" || plan.broadMatch) {
      useStep = alternateStep(useStep);
    }

    if (plan.valueOverride != null && plan.valueOverride !== "") {
      if (step.valueFrom) useData[step.valueFrom] = plan.valueOverride;
      else useStep = { ...useStep, value: plan.valueOverride };
    }

    await runStep(useStep, useData, cardId);
    if (step.waitAfter) await settleAfterStep(step);
    report({
      cardId,
      status: "reasoning",
      reason: `Recovered “${step.label || step.id}” via AI (${action}).`,
    });
  }

  async function runStepWithRepair(step, data, cardId) {
    const patched = mergeStepPatch(step);
    try {
      await runStep(patched, data, cardId);
      return;
    } catch (err) {
      if (/not visible/i.test(err?.message || "")) throw err;
      if (step.optional) throw err;
      const reason = reasonAboutFailure(step, err);
      report({
        cardId,
        stepId: step.id,
        status: "failed",
        error: err.message || String(err),
        reason,
      });
      report({
        cardId,
        status: "reasoning",
        reason: `${reason} Asking AI how to recover…`,
      });

      const plan = await requestAiRepair({ cardId, step, error: err, reason });
      try {
        await applyRepairPlan(plan, step, data, cardId);
      } catch (repairErr) {
        report({
          cardId,
          stepId: step.id,
          status: "failed",
          error: repairErr?.message || String(repairErr),
          reason: `AI repair failed for “${step.label || step.id}”. Take over.`,
        });
        throw repairErr;
      }
    }
  }

  function isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    if (el.closest("[hidden], [aria-hidden='true']")) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function clickStepLooksDone(step) {
    const w = step.waitAfter || {};
    const href = location.href;
    if (w.urlEquals && href === w.urlEquals) return true;
    if (w.urlIncludes && href.includes(w.urlIncludes)) return true;
    if (w.urlPath && (location.pathname.includes(w.urlPath) || href.includes(w.urlPath))) return true;
    if (w.selector || w.hideSelector) {
      if (w.selector) {
        try {
          const el = document.querySelector(w.selector);
          if (!el || !isElementVisible(el)) return false;
        } catch {
          return false;
        }
      }
      if (w.hideSelector) {
        try {
          const hidden = document.querySelector(w.hideSelector);
          if (hidden && isElementVisible(hidden)) return false;
        } catch {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  function stepAlreadyComplete(step) {
    if (!step) return false;
    if (watch.lastStatus.get(step.id) === "done") return true;
    if (step.action === "highlight" || step.action === "wait") return false;
    try {
      // Fill: any non-empty value; click/check: correct control completed
      if (step.action === "fill") return stepFieldFilled(step);
      if (step.action === "click" || step.action === "check") return clickStepLooksDone(step);
    } catch {
      return false;
    }
    return false;
  }

  function stepFindableOnPage(step) {
    if (!step) return false;
    if (step.action === "wait") return true;
    if (step.action === "highlight") {
      try {
        const el = resolveElement(step);
        return Boolean(el && isElementVisible(el));
      } catch {
        return false;
      }
    }
    try {
      const el = resolveElement(step);
      return Boolean(el && isElementVisible(el));
    } catch {
      return false;
    }
  }

  /**
   * Resume index: skip done steps + skip earlier-page clicks that aren't here anymore.
   */
  function findResumeIndex(steps, hintedStart = 0, completedStepIds = []) {
    const doneIds = new Set(completedStepIds || []);
    for (const id of doneIds) markWatchStatus(id, "done");
    const hint = Math.max(0, Math.min(Number(hintedStart) || 0, steps.length));
    for (let j = 0; j < hint && j < steps.length; j++) {
      markWatchStatus(steps[j].id, "done");
    }

    let i = 0;
    while (i < steps.length) {
      const step = steps[i];
      if (stepAlreadyComplete(step)) {
        i += 1;
        continue;
      }
      if (stepFindableOnPage(step)) break;

      // Target missing — if a later step is findable, we already passed this page
      const laterOk = steps.slice(i + 1).some(
        (s) => stepAlreadyComplete(s) || stepFindableOnPage(s)
      );
      if (laterOk && (step.action === "click" || step.action === "check" || stepMayNavigate(step))) {
        markWatchStatus(step.id, "done");
        i += 1;
        continue;
      }
      break;
    }
    return i;
  }

  async function runSop({
    cardId,
    data,
    sop,
    startIndex = 0,
    completedStepIds = [],
    bypassVisibilityGate = false,
    agentApproved = false,
    agentApprovedValues = {},
  }) {
    runner = {
      cancelled: false,
      paused: false,
      cardId,
      bypassVisibilityGate: Boolean(bypassVisibilityGate),
    };
    agentRunning = true;
    sessionStepPatches.clear();
    clearSequentialLocks();
    hideSeqTip();
    ensureHighlightStyle();
    watch.agentApproved = Boolean(agentApproved);
    watch.agentApprovedValues =
      agentApprovedValues && typeof agentApprovedValues === "object"
        ? { ...agentApprovedValues }
        : {};

    try {
      await runSopBody({
        cardId,
        data,
        sop,
        startIndex,
        completedStepIds,
      });
    } finally {
      agentRunning = false;
      applySequentialLocks();
    }
  }

  async function runSopBody({
    cardId,
    data,
    sop,
    startIndex = 0,
    completedStepIds = [],
  }) {
    const steps = sop?.steps || [];
    if (!steps.length) {
      report({
        cardId,
        status: "run_failed",
        error: "SOP has no steps",
        failedStepLabel: "Workflow",
      });
      return;
    }

    if (!document.querySelector("form, div[role='list'], input, textarea, button, a[href]")) {
      report({
        cardId,
        status: "run_failed",
        error: "No interactive page content found.",
        failedStepLabel: "Open form page",
        reason:
          "Red: nothing to automate on this tab. Open the workflow page, keep that tab focused, then Start again.",
      });
      return;
    }

    const visible = await waitUntilBrowserVisible(cardId);
    if (!visible || runner.cancelled) {
      if (runner.cancelled) report({ cardId, status: "run_cancelled" });
      clearHighlights();
      return;
    }

    const from = findResumeIndex(steps, startIndex, completedStepIds);
    if (from >= steps.length) {
      for (const step of steps) {
        report({ cardId, stepId: step.id, status: "done", source: "resume" });
      }
      report({ cardId, status: "run_complete" });
      return;
    }

    if (from > 0) {
      report({
        cardId,
        status: "reasoning",
        reason: `Resuming from step ${from + 1}…`,
      });
      for (let j = 0; j < from; j++) {
        report({ cardId, stepId: steps[j].id, status: "done", source: "resume" });
        markWatchStatus(steps[j].id, "done");
      }
    }

    for (let i = from; i < steps.length; i++) {
      const step = steps[i];
      if (runner.cancelled) {
        cancelCheckpoint();
        report({ cardId, status: "run_cancelled" });
        clearHighlights();
        return;
      }

      await waitWhilePaused();
      if (runner.cancelled) {
        cancelCheckpoint();
        report({ cardId, status: "run_cancelled" });
        clearHighlights();
        return;
      }

      // Skip work already done on this page (DOM / prior tracking)
      if (stepAlreadyComplete(step)) {
        report({ cardId, stepId: step.id, status: "done", source: "resume" });
        markWatchStatus(step.id, "done");
        continue;
      }

      // Skip earlier-page controls that are gone but later steps exist
      if (!stepFindableOnPage(step) && stepMayNavigate(step)) {
        const laterOk = steps.slice(i + 1).some((s) => stepFindableOnPage(s) || stepAlreadyComplete(s));
        if (laterOk) {
          report({ cardId, stepId: step.id, status: "done", source: "resume" });
          markWatchStatus(step.id, "done");
          continue;
        }
      }

      report({ cardId, stepId: step.id, status: "running" });
      markWatchStatus(step.id, "running");

      const willNav = stepMayNavigate(step);

      try {
        if (willNav) {
          await postCheckpoint({
            cardId,
            data: data || {},
            sop,
            nextIndex: i + 1,
            urlIncludes: step.waitAfter?.urlIncludes || step.waitAfter?.urlPath || null,
            urlEquals: step.waitAfter?.urlEquals || null,
            agentApproved: Boolean(watch.agentApproved),
            agentApprovedValues: watch.agentApprovedValues || {},
          });
        }

        await runStepWithRepair(step, data || {}, cardId);

        if (willNav) {
          report({
            cardId,
            stepId: step.id,
            status: "done",
            ...captureFieldsForStep(step),
          });
          markWatchStatus(step.id, "done");
          const settled = await settleAfterStep(step);
          if (settled === "url-matched") {
            // Same document / SPA — keep going here
            cancelCheckpoint();
            await sleep(STEP_DELAY_MS);
            continue;
          }
          // Full navigation likely — background resumes on next page
          report({
            cardId,
            status: "reasoning",
            reason: "Waiting for next page…",
          });
          return;
        }

        await settleAfterStep(step);
        await sleep(STEP_DELAY_MS);
        if (runner.cancelled) {
          cancelCheckpoint();
          report({ cardId, status: "run_cancelled" });
          clearHighlights();
          return;
        }

        // Fill: any non-empty value is enough — exact SOP match is not required.
        // Mandatory steps still complete on fill; Approve values are offered from liveAct UI.
        if (step.action === "fill") {
          let actual = readStepActualValue(step);
          // Agent-approved run: retry once from approved/case data if the first fill missed
          if (!actual && watch.agentApproved) {
            const retryVal = fillValueForStep(step, data || {});
            if (retryVal) {
              try {
                const el = resolveElement(step);
                if (el) await fillGoogleStyle(el, retryVal);
              } catch {
                /* soft */
              }
              actual = readStepActualValue(step);
            }
          }
          if (!actual) {
            markWatchStatus(step.id, "pending");
            report({
              cardId,
              stepId: step.id,
              status: "pending",
              reason: `“${step.label || step.id}” still empty — fill the field to continue.`,
            });
            continue;
          }
        }

        report({
          cardId,
          stepId: step.id,
          status: "done",
          ...captureFieldsForStep(step),
        });
        markWatchStatus(step.id, "done");
      } catch (err) {
        cancelCheckpoint();
        if (step.optional) {
          report({
            cardId,
            stepId: step.id,
            status: "done",
            ...captureFieldsForStep(step),
          });
          markWatchStatus(step.id, "done");
          continue;
        }
        const label = step.label || step.id;
        const reason = reasonAboutFailure(step, err);
        report({
          cardId,
          stepId: step.id,
          status: "failed",
          error: err.message || String(err),
          reason,
        });
        markWatchStatus(step.id, "failed");
        report({
          cardId,
          status: "run_failed",
          error: err.message || String(err),
          failedStepLabel: label,
          reason: `${reason} You can fix that field in Chrome, or ask me to try again after the question is visible.`,
        });
        return;
      }
    }

    cancelCheckpoint();
    report({ cardId, status: "run_complete" });
  }

  function fieldValue(el) {
    if (!el) return "";
    if (el.getAttribute && el.getAttribute("role") === "checkbox") {
      return el.getAttribute("aria-checked") === "true" ? "checked" : "";
    }
    if (el.isContentEditable) return String(el.textContent || "").trim();
    return String(el.value || "").trim();
  }

  function matchStepForElement(el) {
    if (!watch.steps.length || !el) return null;
    const block =
      el.closest('div[role="listitem"], .Qr7Oae, .freebirdFormviewerComponentsQuestionBaseRoot, div[data-params]') ||
      el.parentElement;
    const title = block ? questionTitle(block) : "";
    const text = normalize((block && block.innerText) || "");

    for (const step of watch.steps) {
      if (step.action === "highlight" || step.action === "wait") continue;
      if (step.selector) {
        try {
          const resolved = querySelectorSafe(step.selector);
          if (resolved && (resolved === el || resolved.contains(el))) return step;
          if (el.matches?.(step.selector)) return step;
        } catch {
          /* ignore */
        }
      }
      if (step.findCheckboxByLabel && (el.getAttribute("role") === "checkbox" || el.closest('[role="checkbox"]'))) {
        const hints = (Array.isArray(step.findCheckboxByLabel) ? step.findCheckboxByLabel : [step.findCheckboxByLabel]).map(normalize);
        const optText = normalize(el.innerText || el.textContent || text);
        if (hints.some((h) => optText.includes(h))) return step;
      }
      if (step.findByLabel) {
        const hints = Array.isArray(step.findByLabel) ? step.findByLabel : [step.findByLabel];
        const mode = step.matchMode || (normalize(String(hints[0] || "")).length <= 8 ? "exact" : "includes");
        if (hints.some((h) => titleMatches(title, h, mode) || (normalize(h).length >= 10 && text.includes(normalize(h))))) {
          return step;
        }
      }
    }
    return null;
  }

  function reportManual(step, status, { force = false, value, valueMatched = null } = {}) {
    if (!watch.cardId || !step) return;
    if (watch.muteReports && !force) return;
    const prev = watch.lastStatus.get(step.id);
    if (!force && prev === status && valueMatched == null) return;
    watch.lastStatus.set(step.id, status);
    let saved = progressByCard.get(watch.cardId);
    if (!saved) {
      saved = new Map();
      progressByCard.set(watch.cardId, saved);
    }
    saved.set(step.id, status);
    const capture =
      status === "done" && (step.action === "fill" || step.action === "click" || step.action === "check")
        ? captureFieldsForStep(step, value)
        : {};
    report({
      cardId: watch.cardId,
      stepId: step.id,
      status,
      source: "manual",
      ...(valueMatched != null ? { valueMatched: Boolean(valueMatched) } : {}),
      ...capture,
    });
  }

  /** Keep lastStatus aligned with agent reports so clears can flip greens off */
  function markWatchStatus(stepId, status) {
    if (!stepId) return;
    watch.lastStatus.set(stepId, status);
    if (watch.cardId) {
      let saved = progressByCard.get(watch.cardId);
      if (!saved) {
        saved = new Map();
        progressByCard.set(watch.cardId, saved);
      }
      saved.set(stepId, status);
    }
  }

  function isGatingAction(step) {
    return step?.action === "fill" || step?.action === "click" || step?.action === "check";
  }

  function stepCompleteForGate(step) {
    if (!step) return false;
    try {
      // Fill: live value, or trust an Approve/manual "done" mark so the next field unlocks
      if (step.action === "fill") {
        if (stepFieldFilled(step)) return true;
        return watch.lastStatus.get(step.id) === "done";
      }
      if (watch.lastStatus.get(step.id) === "done") return true;
      if (step.action === "click" || step.action === "check") return clickStepLooksDone(step);
    } catch {
      return false;
    }
    return false;
  }

  /**
   * First incomplete required fill/click/check. Optional / wait / highlight never gate.
   * Steps after this index stay locked until it completes.
   */
  function getGateIndex() {
    const steps = watch.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!isGatingAction(step)) continue;
      if (step.optional) continue;
      if (stepCompleteForGate(step)) continue;
      // Left-behind click/nav (page already advanced) — don't block later fields
      if (
        (step.action === "click" || step.action === "check" || stepMayNavigate(step)) &&
        !stepFindableOnPage(step)
      ) {
        const laterOk = steps.slice(i + 1).some(
          (s) => stepCompleteForGate(s) || stepFindableOnPage(s)
        );
        if (laterOk) continue;
      }
      return i;
    }
    return steps.length;
  }

  function stepIndexOf(step) {
    if (!step?.id) return -1;
    return watch.steps.findIndex((s) => s.id === step.id);
  }

  function isStepLocked(step) {
    if (agentRunning || !watch.cardId || !step) return false;
    const idx = stepIndexOf(step);
    if (idx < 0) return false;
    return idx > getGateIndex();
  }

  function unlockElement(el) {
    if (!el) return;
    const meta = lockMetaByEl.get(el);
    if (meta) {
      if ("contentEditable" in meta) {
        if (meta.contentEditable == null) el.removeAttribute("contenteditable");
        else el.setAttribute("contenteditable", meta.contentEditable);
      }
      if ("disabled" in meta) el.disabled = meta.disabled;
      if ("readOnly" in meta) el.readOnly = meta.readOnly;
      if ("ariaDisabled" in meta) {
        if (meta.ariaDisabled == null) el.removeAttribute("aria-disabled");
        else el.setAttribute("aria-disabled", meta.ariaDisabled);
      }
      if ("tabIndex" in meta) el.tabIndex = meta.tabIndex;
      lockMetaByEl.delete(el);
    }
    el.classList.remove("coact-locked-field");
    el.removeAttribute("data-coact-locked");
  }

  function lockElement(el) {
    if (!el) return;
    if (!lockMetaByEl.has(el)) {
      const meta = {};
      const tag = el.tagName;
      const type = String(el.type || "").toLowerCase();
      if (el.isContentEditable) {
        meta.contentEditable = el.getAttribute("contenteditable");
        el.setAttribute("contenteditable", "false");
      } else if (tag === "SELECT" || type === "checkbox" || type === "radio" || type === "file") {
        meta.disabled = el.disabled;
        el.disabled = true;
      } else if (tag === "INPUT" || tag === "TEXTAREA") {
        meta.readOnly = el.readOnly;
        el.readOnly = true;
      } else if (tag === "BUTTON" || type === "submit" || type === "button" || type === "reset") {
        meta.disabled = el.disabled;
        el.disabled = true;
      } else if (tag === "A" || el.getAttribute("role") === "button" || el.getAttribute("role") === "checkbox") {
        meta.ariaDisabled = el.getAttribute("aria-disabled");
        el.setAttribute("aria-disabled", "true");
        meta.tabIndex = el.tabIndex;
        el.tabIndex = -1;
      } else {
        try {
          meta.readOnly = el.readOnly;
          el.readOnly = true;
        } catch {
          /* ignore */
        }
      }
      lockMetaByEl.set(el, meta);
    }
    el.classList.add("coact-locked-field");
    el.setAttribute("data-coact-locked", "1");
  }

  function clearSequentialLocks() {
    document.querySelectorAll(".coact-locked-field").forEach((el) => {
      unlockElement(el);
    });
    document.querySelectorAll(".coact-gate-field").forEach((el) => {
      el.classList.remove("coact-gate-field");
    });
  }

  function clearTipAnchorListeners() {
    if (tipRepositionBound) {
      window.removeEventListener("scroll", tipRepositionBound, true);
      window.removeEventListener("resize", tipRepositionBound);
      tipRepositionBound = null;
    }
    tipAnchorEl = null;
  }

  function resetTipPositionStyles(tip) {
    if (!tip) return;
    tip.classList.remove("coact-seq-tip-anchored", "coact-tip-below", "coact-tip-above");
    tip.style.left = "";
    tip.style.top = "";
    tip.style.bottom = "";
    tip.style.right = "";
    tip.style.transform = "";
    tip.style.removeProperty("--coact-tip-arrow-left");
  }

  function positionTipNearElement(tip, el) {
    if (!tip) return;
    if (!el || !isElementVisible(el)) {
      resetTipPositionStyles(tip);
      return;
    }

    tip.classList.add("coact-seq-tip-anchored");
    tip.style.bottom = "auto";
    tip.style.right = "auto";
    tip.style.transform = "none";
    tip.style.left = "0px";
    tip.style.top = "0px";

    const gap = 10;
    const rect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const tipW = tipRect.width || Math.min(360, window.innerWidth - 24);
    const tipH = tipRect.height || 52;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placeBelow = !(spaceBelow < tipH + gap + 8 && spaceAbove > spaceBelow);

    let top = placeBelow ? rect.bottom + gap : rect.top - tipH - gap;
    top = Math.max(8, Math.min(top, window.innerHeight - tipH - 8));

    let left = rect.left + rect.width / 2 - tipW / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - tipW - 12));

    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tip.style.bottom = "auto";
    tip.style.transform = "none";

    const arrowLeft = rect.left + rect.width / 2 - left;
    tip.style.setProperty(
      "--coact-tip-arrow-left",
      `${Math.round(Math.max(16, Math.min(arrowLeft, tipW - 16)))}px`
    );
    tip.classList.toggle("coact-tip-below", placeBelow);
    tip.classList.toggle("coact-tip-above", !placeBelow);
  }

  function attachTipAnchor(tip, el) {
    clearTipAnchorListeners();
    tipAnchorEl = el || null;
    if (!el) {
      resetTipPositionStyles(tip);
      return;
    }
    tipRepositionBound = () => {
      const t = document.getElementById("coact-seq-tip");
      if (!t || !t.classList.contains("coact-seq-tip-visible")) return;
      positionTipNearElement(t, tipAnchorEl);
    };
    window.addEventListener("scroll", tipRepositionBound, true);
    window.addEventListener("resize", tipRepositionBound);
    positionTipNearElement(tip, el);
  }

  function ensureSeqTipEl() {
    let tip = document.getElementById("coact-seq-tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "coact-seq-tip";
      tip.className = "coact-seq-tip";
      tip.setAttribute("role", "status");
      document.documentElement.appendChild(tip);
    }
    return tip;
  }

  function hideSeqTip() {
    if (seqTipTimer) {
      clearTimeout(seqTipTimer);
      seqTipTimer = null;
    }
    clearTipAnchorListeners();
    const tip = document.getElementById("coact-seq-tip");
    if (tip) {
      tip.classList.remove("coact-seq-tip-visible", "coact-wrong-tip");
      resetTipPositionStyles(tip);
    }
  }

  function showSeqTip(gateStep) {
    ensureHighlightStyle();
    const label = String(gateStep?.label || gateStep?.id || "the earlier step").trim();
    const tip = ensureSeqTipEl();
    tip.classList.remove("coact-wrong-tip");
    tip.textContent = `Complete “${label}” first — later steps stay locked until then.`;
    tip.classList.add("coact-seq-tip-visible");

    let el = null;
    try {
      el = resolveElement(gateStep);
    } catch {
      el = null;
    }
    attachTipAnchor(tip, el);

    if (seqTipTimer) clearTimeout(seqTipTimer);
    seqTipTimer = setTimeout(() => {
      tip.classList.remove("coact-seq-tip-visible");
      clearTipAnchorListeners();
      resetTipPositionStyles(tip);
      seqTipTimer = null;
    }, 3400);
  }

  function showWrongTip(step, expected, actual) {
    if (watch.agentApproved) return;
    const key = `${step?.id || ""}|${actual}|${expected}`;
    const isRepeat = key === lastMismatchKey;
    lastMismatchKey = key;

    let el = null;
    try {
      el = resolveElement(step);
    } catch {
      el = null;
    }

    const label = String(step?.label || step?.id || "this field").trim();
    const expectedStr = String(expected ?? "");
    const actualStr = String(actual ?? "");

    // Soft mismatch only — always notify desktop with suggestedValue so Approve works
    try {
      if (watch.cardId && expectedStr) {
        report({
          cardId: watch.cardId,
          stepId: step.id,
          status: "mismatch",
          reason: `Wrong “${label}” (${step.valueFrom || step.id}): you typed “${actualStr}” — expected “${expectedStr}”. Approve to fill the correct value.`,
          expected: expectedStr,
          actual: actualStr,
          suggestedValue: expectedStr,
          key: step.valueFrom || step.id,
          label,
          action: step.action || "fill",
        });
      }
    } catch {
      /* never crash the page on a wrong value */
    }

    if (isRepeat) {
      // Still wrong — keep red highlight, don't re-spam page toast
      try {
        el?.classList.add("coact-wrong-field");
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      ensureHighlightStyle();
      const tip = ensureSeqTipEl();
      tip.classList.add("coact-wrong-tip");
      tip.textContent = `“${label}” doesn’t match the suggested value. You entered “${actualStr}” — expected “${expectedStr}”.`;
      tip.classList.add("coact-seq-tip-visible");

      if (el) {
        document.querySelectorAll(".coact-wrong-field").forEach((n) => n.classList.remove("coact-wrong-field"));
        el.classList.add("coact-wrong-field");
        try {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch {
          /* ignore */
        }
      }
      attachTipAnchor(tip, el);

      if (seqTipTimer) clearTimeout(seqTipTimer);
      seqTipTimer = setTimeout(() => {
        tip.classList.remove("coact-seq-tip-visible");
        clearTipAnchorListeners();
        resetTipPositionStyles(tip);
        seqTipTimer = null;
      }, 5200);
    } catch {
      /* soft red tip only — never throw to the page */
    }
  }

  function clearWrongHighlight(step) {
    let el = null;
    try {
      el = step ? resolveElement(step) : null;
    } catch {
      el = null;
    }
    try {
      el?.classList.remove("coact-wrong-field");
    } catch {
      /* ignore */
    }
  }

  function flashWrongClick(el) {
    // Red borders are reserved for wrong values on the last step — not mid-form clicks.
    void el;
  }

  function focusGateField(gateStep) {
    if (!gateStep) return;
    let el = null;
    try {
      el = resolveElement(gateStep);
    } catch {
      el = null;
    }
    if (!el || !isElementVisible(el)) return;
    // No red outline on the normal current step — red is wrong-only
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      /* ignore */
    }
    try {
      el.focus?.({ preventScroll: true });
    } catch {
      try {
        el.focus?.();
      } catch {
        /* ignore */
      }
    }
  }

  function blockWithGateTip(wrongEl) {
    const gate = getGateIndex();
    const gateStep = watch.steps[gate];
    if (!gateStep) return;
    showSeqTip(gateStep);
    // Red border only on the control the user wrongly clicked/typed into
    if (wrongEl) flashWrongClick(wrongEl);

    let el = null;
    try {
      el = resolveElement(gateStep);
    } catch {
      el = null;
    }
    const alreadyFocused =
      el && (document.activeElement === el || el.contains?.(document.activeElement));
    const hasMismatch = Boolean(el?.classList?.contains("coact-wrong-field"));
    // Don't steal focus when the gate field is already active / wrong-highlighted
    if (!alreadyFocused && !hasMismatch) {
      focusGateField(gateStep);
    }
    // Avoid reportManual("running") — thrashing done/pending/running unlocks later steps briefly
  }

  function applySequentialLocks() {
    if (agentRunning || !watch.cardId || !watch.steps.length) {
      clearSequentialLocks();
      return;
    }
    ensureHighlightStyle();
    const gate = getGateIndex();
    const shouldLock = new Set();

    for (let i = 0; i < watch.steps.length; i++) {
      const step = watch.steps[i];
      if (!isGatingAction(step)) continue;
      let el = null;
      try {
        el = resolveElement(step);
      } catch {
        el = null;
      }
      if (!el) continue;
      if (i > gate) shouldLock.add(el);
    }

    document.querySelectorAll(".coact-locked-field").forEach((el) => {
      if (!shouldLock.has(el)) unlockElement(el);
    });
    for (const el of shouldLock) lockElement(el);

    // Never paint a red "current step" outline — that caused flicker and blocked typing
    document.querySelectorAll(".coact-gate-field").forEach((el) => {
      el.classList.remove("coact-gate-field");
    });
  }

  function matchClickStepForTarget(el) {
    if (!el || !watch.steps.length) return null;
    const clickable =
      (el.closest &&
        el.closest(
          'button, a[href], [role="button"], input[type="submit"], input[type="button"], [role="checkbox"]'
        )) ||
      null;
    if (!clickable) return null;

    const text = normalize(
      clickable.innerText ||
        clickable.textContent ||
        clickable.value ||
        clickable.getAttribute("aria-label") ||
        ""
    );

    for (const step of watch.steps) {
      if (step.action !== "click" && step.action !== "check") continue;
      if (step.selector) {
        try {
          if (clickable.matches(step.selector)) return step;
        } catch {
          /* ignore */
        }
      }
      const hints = []
        .concat(step.findByText || [], step.findButtonByText || [], step.findByLabel || [], step.findCheckboxByLabel || [])
        .map(normalize)
        .filter(Boolean);
      if (hints.some((h) => text === h || text.includes(h))) return step;
    }
    return null;
  }

  function onManualFieldEvent(event) {
    if (!extensionAlive()) return;
    if (!watch.cardId || !watch.steps.length) return;
    if (agentRunning) return;
    if (watch.muteReports) watch.muteReports = false;
    const el = event.target;
    if (!el || !el.closest) return;

    if (event.type === "click") {
      const clickStep = matchClickStepForTarget(el);
      if (clickStep && isStepLocked(clickStep)) {
        event.preventDefault();
        event.stopPropagation();
        try {
          event.stopImmediatePropagation();
        } catch {
          /* ignore */
        }
        blockWithGateTip(el);
        return;
      }
      if (clickStep) {
        reportManual(clickStep, "done");
        applySequentialLocks();
        // Re-scan shortly in case waitAfter DOM/url updates
        setTimeout(() => scanManualProgress(), 300);
        setTimeout(() => scanManualProgress(), 1000);
        return;
      }
    }

    // Google Forms often targets inner divs — climb to a real field
    const target =
      (el.closest && el.closest("input, textarea, [contenteditable='true'], [role='checkbox']")) ||
      (el.matches && el.matches("input, textarea, [contenteditable='true'], [role='checkbox']") ? el : null);
    if (!target) return;

    const step = matchStepForElement(target) || matchStepByNearbyTitle(target);
    if (step && isStepLocked(step)) {
      event.preventDefault();
      event.stopPropagation();
      try {
        event.stopImmediatePropagation();
      } catch {
        /* ignore */
      }
      if (event.type === "focusin" || event.type === "click") {
        try {
          target.blur?.();
        } catch {
          /* ignore */
        }
      }
      blockWithGateTip(target);
      return;
    }
    if (!step) {
      // Fallback: poll all steps after any keystroke / clear
      scanManualProgress();
      return;
    }

    const value = fieldValue(target);
    if (event.type === "focusin") {
      reportManual(step, "running");
      return;
    }
    if (!value) {
      reportManual(step, "pending");
      clearWrongHighlight(step);
      lastMismatchKey = "";
      applySequentialLocks();
      return;
    }
    if (step.action === "fill") {
      // Mandatory wrong values: notify mismatch+Approve BEFORE done so the coach is not cleared
      // Skip when this run was already approved in the Agent modal
      const expectedList = expectedListForStep(step);
      if (
        !watch.agentApproved &&
        step.mandatory &&
        expectedList.length &&
        value &&
        !valuesMatchAny(value, expectedList)
      ) {
        reportMistakeIfWrong(step, value, expectedList[0]);
      }
      // Unlock the next field as soon as this one has any value (don't wait on debounce)
      reportManual(step, "done", { value });
      applySequentialLocks();
      const immediate = event.type === "change" || event.type === "blur";
      scheduleFillEvaluation(step, target, { immediate });
      return;
    }
    lastMismatchKey = "";
    hideSeqTip();
    clearWrongHighlight(step);
    reportManual(step, "done");
    applySequentialLocks();
  }

  function matchStepByNearbyTitle(el) {
    const block = el.closest('div[role="listitem"], .Qr7Oae, div[data-params]') || el.parentElement;
    if (!block) return null;
    const title = questionTitle(block);
    const text = normalize(block.innerText || "");
    for (const step of watch.steps) {
      if (!step.findByLabel) continue;
      const hints = (Array.isArray(step.findByLabel) ? step.findByLabel : [step.findByLabel]).map(normalize);
      if (hints.some((h) => title.includes(h) || text.includes(h))) return step;
    }
    return null;
  }

  /**
   * Coerce a raw SOP/case value into a non-empty string list.
   * Scalars → [string]; arrays → each entry stringified.
   */
  function coerceValueList(raw) {
    if (raw == null) return [];
    if (Array.isArray(raw)) {
      return raw
        .map((v) => String(v ?? "").trim())
        .filter((v) => v !== "");
    }
    const s = String(raw).trim();
    return s ? [s] : [];
  }

  /**
   * Suggested / Approve values for a fill step (not required to match for completion).
   * Priority:
   * 1. step.allowedValues (array) — author-declared list
   * 2. valueFrom → array in case data
   * 3. valueFrom → scalar / step.value
   * Authors: set mandatory:true to surface Approve values in liveAct.
   * @returns {string[]}
   */
  function expectedListForStep(step, data) {
    if (!step) return [];
    const bag = data != null ? data : watch.data;

    // Agent-approved (possibly user-edited) values win for this run — never treat as mistakes
    if (watch.agentApprovedValues && step.id != null && watch.agentApprovedValues[step.id] != null) {
      const approved = coerceValueList(watch.agentApprovedValues[step.id]);
      if (approved.length) return approved;
    }

    if (Array.isArray(step.allowedValues) && step.allowedValues.length) {
      return coerceValueList(step.allowedValues);
    }

    if (step.valueFrom != null && bag && Object.prototype.hasOwnProperty.call(bag, step.valueFrom)) {
      const v = bag[step.valueFrom];
      if (v == null) return [];
      return coerceValueList(v);
    }

    if (step.value != null && String(step.value) !== "") {
      return coerceValueList(step.value);
    }
    return [];
  }

  /** Primary suggested / auto-fill value = first of the allowed list. */
  function expectedValueForStep(step, data) {
    const list = expectedListForStep(step, data);
    return list.length ? list[0] : null;
  }

  function fillValueForStep(step, data) {
    // Prefer agent-approved step values, then merged run data / SOP
    if (watch.agentApprovedValues && step?.id != null && watch.agentApprovedValues[step.id] != null) {
      const approved = String(watch.agentApprovedValues[step.id] ?? "").trim();
      if (approved) return approved;
    }
    return expectedValueForStep(step, data) ?? "";
  }

  function normalizeCompare(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  /** True when the whole string is a plain number (not a leading-zero ID). */
  function looksPlainNumeric(value) {
    const t = String(value ?? "")
      .trim()
      .replace(/,/g, "");
    if (!t) return false;
    // Leading zeros on integer-like values → treat as ID/code, not quantity
    if (/^-?0\d+$/.test(t)) return false;
    return /^-?\d+(\.\d+)?$/.test(t);
  }

  function levenshtein(a, b) {
    const s = String(a || "");
    const t = String(b || "");
    if (s === t) return 0;
    if (!s.length) return t.length;
    if (!t.length) return s.length;
    const rows = s.length + 1;
    const cols = t.length + 1;
    const prev = new Array(cols);
    const cur = new Array(cols);
    for (let j = 0; j < cols; j++) prev[j] = j;
    for (let i = 1; i < rows; i++) {
      cur[0] = i;
      const sc = s.charCodeAt(i - 1);
      for (let j = 1; j < cols; j++) {
        const cost = sc === t.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j < cols; j++) prev[j] = cur[j];
    }
    return prev[cols - 1];
  }

  /**
   * Fuzzy compare for mandatory field values.
   * Case-insensitive + accent-fold + whitespace; allows small typos,
   * token reorder, and containment. Numbers/phones stay exact.
   * @returns {{ verdict: 'match'|'mismatch' }}
   */
  function compareValues(actual, expected) {
    const aRaw = String(actual ?? "")
      .trim()
      .replace(/\s+/g, " ");
    const eRaw = String(expected ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (!eRaw) return { verdict: "match" };
    if (!aRaw) return { verdict: "mismatch" };

    const a = normalizeCompare(aRaw);
    const e = normalizeCompare(eRaw);
    if (a === e) return { verdict: "match" };

    if (looksPlainNumeric(aRaw) && looksPlainNumeric(eRaw)) {
      const an = Number(aRaw.replace(/,/g, ""));
      const en = Number(eRaw.replace(/,/g, ""));
      if (Number.isFinite(an) && Number.isFinite(en) && an === en) {
        return { verdict: "match" };
      }
      return { verdict: "mismatch" };
    }

    const ad = aRaw.replace(/\D/g, "");
    const ed = eRaw.replace(/\D/g, "");
    if (ed.length >= 7 && ad.length >= 7 && ad === ed) {
      return { verdict: "match" };
    }

    // Formatting only (hyphens/spaces/punctuation)
    const aAlnum = a.replace(/[^a-z0-9]/g, "");
    const eAlnum = e.replace(/[^a-z0-9]/g, "");
    if (aAlnum && aAlnum === eAlnum) return { verdict: "match" };

    // Containment (e.g. "Acme Inc" vs "acme")
    if (aAlnum.length >= 3 && eAlnum.length >= 3) {
      if (aAlnum.includes(eAlnum) || eAlnum.includes(aAlnum)) {
        return { verdict: "match" };
      }
    }

    // Same words, different order
    const aTokens = a.split(" ").filter(Boolean).sort().join(" ");
    const eTokens = e.split(" ").filter(Boolean).sort().join(" ");
    if (aTokens && aTokens === eTokens) return { verdict: "match" };

    // Small typos / fuzzy edit distance
    const maxLen = Math.max(a.length, e.length);
    const maxDist = maxLen <= 4 ? 1 : maxLen <= 12 ? 2 : 3;
    if (maxLen > 0 && levenshtein(a, e) <= maxDist) {
      return { verdict: "match" };
    }
    if (
      aAlnum.length >= 3 &&
      eAlnum.length >= 3 &&
      levenshtein(aAlnum, eAlnum) <= Math.min(maxDist, 2)
    ) {
      return { verdict: "match" };
    }

    return { verdict: "mismatch" };
  }

  /** Fuzzy match against a single expected string (or list via valuesMatchAny). */
  function valuesMatch(actual, expected) {
    return compareValues(actual, expected).verdict === "match";
  }

  /** Fuzzy match if actual matches any entry in the allowed list. */
  function valuesMatchAny(actual, expectedList) {
    const list = Array.isArray(expectedList) ? expectedList : [];
    if (!list.length) return true;
    return list.some((expected) => valuesMatch(actual, expected));
  }

  /**
   * Fill correctness: any non-empty value completes the step.
   * Wrong SOP values are tracked only on mandatory steps.
   * @returns {{ ok: boolean, empty?: boolean, wrong?: boolean, expected?: string }}
   */
  function evaluateFillValue(step, actual) {
    if (!actual) {
      clearWrongHighlight(step);
      return { ok: false, empty: true };
    }
    if (watch.agentApproved) return { ok: true };
    if (!step.mandatory) return { ok: true };
    const list = expectedListForStep(step);
    if (list.length && !valuesMatchAny(actual, list)) {
      return { ok: true, wrong: true, expected: list[0] };
    }
    return { ok: true };
  }

  /**
   * Notify desktop of a wrong fill on a mandatory step only.
   * Must run BEFORE status "done" so finalize can include the mistake.
   */
  function reportMistakeIfWrong(step, actual, expectedHint) {
    if (!watch.cardId || !step || !step.mandatory) return false;
    // Agent modal already approved this run — never emit mismatch / Approve prompts
    if (watch.agentApproved) return false;
    const actualStr = String(actual ?? "").trim();
    if (!actualStr) return false;

    // Agent-approved (user-edited) values are intentional — never emit mismatch
    if (step.id != null && watch.agentApprovedValues?.[step.id] != null) {
      const approved = String(watch.agentApprovedValues[step.id] ?? "").trim();
      if (approved && valuesMatch(actualStr, approved)) return false;
    }

    const list = expectedListForStep(step);
    const expected =
      expectedHint != null && String(expectedHint) !== ""
        ? String(expectedHint)
        : list[0];
    if (!expected) return false;
    if (list.length ? valuesMatchAny(actualStr, list) : valuesMatch(actualStr, expected)) {
      return false;
    }
    try {
      showWrongTip(step, expected, actualStr);
    } catch {
      /* soft */
    }
    return true;
  }

  function lastGatingStepIndex() {
    let last = -1;
    const steps = watch.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!isGatingAction(step) || step.optional) continue;
      last = i;
    }
    return last;
  }

  function isAtLastGatingStep() {
    const last = lastGatingStepIndex();
    if (last < 0) return false;
    return getGateIndex() >= last;
  }

  /** Red outline only while the user is on the last gating step — check that step only. */
  function highlightWrongValuesIfLastStep() {
    if (!watch.cardId || !watch.steps.length) return;
    if (!isAtLastGatingStep()) {
      document.querySelectorAll(".coact-wrong-field").forEach((n) => {
        try {
          n.classList.remove("coact-wrong-field");
        } catch {
          /* ignore */
        }
      });
      return;
    }

    const last = lastGatingStepIndex();
    const step = watch.steps[last];
    if (!step || step.action !== "fill" || !step.mandatory) {
      document.querySelectorAll(".coact-wrong-field").forEach((n) => {
        try {
          n.classList.remove("coact-wrong-field");
        } catch {
          /* ignore */
        }
      });
      return;
    }

    const list = expectedListForStep(step);
    const actual = readStepActualValue(step);
    if (!list.length || !actual || valuesMatchAny(actual, list)) {
      clearWrongHighlight(step);
      document.querySelectorAll(".coact-wrong-field").forEach((n) => {
        try {
          n.classList.remove("coact-wrong-field");
        } catch {
          /* ignore */
        }
      });
      return;
    }

    let el = null;
    try {
      el = resolveElement(step);
    } catch {
      el = null;
    }
    try {
      document.querySelectorAll(".coact-wrong-field").forEach((n) => {
        if (n !== el) n.classList.remove("coact-wrong-field");
      });
      el?.classList.add("coact-wrong-field");
    } catch {
      /* ignore */
    }
    try {
      showWrongTip(step, list[0], actual);
    } catch {
      /* soft warn */
    }
  }

  function applyFillEvaluationResult(step, result) {
    if (result.ok) {
      if (result.wrong) {
        // Report mismatch for tracking + Approve UI; do NOT re-send "done"
        // (already unlocked) — a second "done" was clearing the Approve coach.
        const actual = readStepActualValue(step);
        reportMistakeIfWrong(step, actual, result.expected);
        applySequentialLocks();
        highlightWrongValuesIfLastStep();
        return;
      }
      lastMismatchKey = "";
      if (!isAtLastGatingStep()) hideSeqTip();
      clearWrongHighlight(step);
      reportManual(step, "done", { force: true, valueMatched: true });
      applySequentialLocks();
      highlightWrongValuesIfLastStep();
      return;
    }
    clearWrongHighlight(step);
    reportManual(step, "pending", { force: true });
    applySequentialLocks();
    highlightWrongValuesIfLastStep();
  }

  function scheduleFillEvaluation(step, target, { immediate = false } = {}) {
    if (valueCheckTimer) {
      clearTimeout(valueCheckTimer);
      valueCheckTimer = null;
    }
    const seq = ++valueCheckSeq;
    const run = () => {
      valueCheckTimer = null;
      if (!watch.cardId || agentRunning) return;
      try {
        const value = fieldValue(target);
        if (!value) {
          if (seq !== valueCheckSeq) return;
          reportManual(step, "pending");
          clearWrongHighlight(step);
          lastMismatchKey = "";
          applySequentialLocks();
          return;
        }
        const result = evaluateFillValue(step, value);
        if (seq !== valueCheckSeq) return;
        applyFillEvaluationResult(step, result);
      } catch {
        if (seq !== valueCheckSeq) return;
        const value = fieldValue(target);
        applyFillEvaluationResult(step, {
          ok: Boolean(value),
          empty: !value,
        });
      }
    };
    if (immediate) {
      run();
    } else {
      valueCheckTimer = setTimeout(run, 150);
    }
  }

  function readStepActualValue(step) {
    let el = null;
    try {
      el = resolveElement(step);
    } catch {
      el = null;
    }
    if (!el && step.findCheckboxByLabel) {
      el = findCheckboxByLabel(step.findCheckboxByLabel);
    }
    if (el && fieldValue(el)) return fieldValue(el);

    const fields = Array.from(
      document.querySelectorAll(
        'input:not([type="hidden"]):not([type="file"]), textarea, [contenteditable="true"], [role="checkbox"]'
      )
    );
    for (const field of fields) {
      const matched = matchStepForElement(field) || matchStepByNearbyTitle(field);
      if (matched?.id !== step.id) continue;
      const v = fieldValue(field);
      if (v) return v;
    }
    return "";
  }

  /** True when the field has any non-empty value */
  function stepFieldFilled(step) {
    return Boolean(readStepActualValue(step));
  }

  /** @deprecated alias — fills no longer require exact SOP match */
  function stepFieldCorrect(step) {
    return stepFieldFilled(step);
  }

  function stepFieldMismatch() {
    return false;
  }

  function scanManualProgress({ force = false } = {}) {
    if (!extensionAlive()) return;
    if (!watch.cardId || !watch.steps.length) return;
    if (watch.muteReports && !force) return;
    if (agentRunning && !force) return;

    const gate = getGateIndex();

    for (let i = 0; i < watch.steps.length; i++) {
      const step = watch.steps[i];
      if (step.action === "highlight" || step.action === "wait") continue;

      // Strict sequential: never accept greens for steps past the current gate
      if (!agentRunning && i > gate) {
        if (watch.lastStatus.get(step.id) === "done") {
          reportManual(step, "pending", { force: true });
        }
        continue;
      }

      if (step.action === "click" || step.action === "check") {
        if (clickStepLooksDone(step)) {
          reportManual(step, "done", { force });
        } else if (
          !stepFindableOnPage(step) &&
          watch.steps.slice(i + 1).some((s) => stepCompleteForGate(s) || stepFindableOnPage(s))
        ) {
          reportManual(step, "done", { force });
        }
        continue;
      }

      if (step.action === "fill") {
        if (stepFieldFilled(step)) {
          reportManual(step, "done", { force });
        } else if (watch.lastStatus.get(step.id) === "done") {
          reportManual(step, "pending", { force: true });
        } else {
          reportManual(step, "pending", { force });
        }
        continue;
      }

      if (stepFieldFilled(step)) {
        reportManual(step, "done", { force });
      } else {
        reportManual(step, "pending", { force });
      }
    }

    applySequentialLocks();
    highlightWrongValuesIfLastStep();
  }

  function stopWatching() {
    if (watch.cardId && watch.lastStatus.size) {
      progressByCard.set(watch.cardId, new Map(watch.lastStatus));
    }
    if (watch.pollTimer) {
      clearInterval(watch.pollTimer);
      watch.pollTimer = null;
    }
    if (valueCheckTimer) {
      clearTimeout(valueCheckTimer);
      valueCheckTimer = null;
    }
    valueCheckSeq += 1;
    lastMismatchKey = "";
    if (watch.attached) {
      document.removeEventListener("input", onManualFieldEvent, true);
      document.removeEventListener("change", onManualFieldEvent, true);
      document.removeEventListener("focusin", onManualFieldEvent, true);
      document.removeEventListener("click", onManualFieldEvent, true);
      document.removeEventListener("keyup", onManualFieldEvent, true);
      watch.attached = false;
    }
    document.querySelectorAll(".coact-wrong-field").forEach((n) => n.classList.remove("coact-wrong-field"));
    clearSequentialLocks();
    hideSeqTip();
    watch.cardId = null;
    watch.steps = [];
    watch.data = {};
    watch.lastStatus = new Map();
  }

  function setNativeValue(el, value) {
    if (!el) return;
    const text = String(value ?? "");
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return;
    }
    el.focus?.();
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) descriptor.set.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function clearOneField(el) {
    if (!el) return;
    const role = el.getAttribute?.("role");
    const type = (el.type || "").toLowerCase();
    if (role === "checkbox" || type === "checkbox") {
      const on =
        el.checked === true || el.getAttribute("aria-checked") === "true";
      if (on) el.click();
      return;
    }
    if (type === "radio") {
      el.checked = false;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (el.tagName === "SELECT") {
      el.selectedIndex = 0;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    setNativeValue(el, "");
  }

  /** Wipe watched fields + all visible form controls on this page */
  function clearPageFormFields() {
    for (const step of watch.steps || []) {
      if (step.action !== "fill" && step.action !== "check") continue;
      try {
        clearOneField(resolveElement(step));
      } catch {
        /* ignore */
      }
    }
    const nodes = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]):not([type="image"]), textarea, select, [contenteditable="true"]'
    );
    nodes.forEach((el) => {
      try {
        clearOneField(el);
      } catch {
        /* ignore */
      }
    });
  }

  function startWatching({ cardId, sop, data = null, resetProgress = false, clearFields = false }) {
    if (!cardId || !sop?.steps?.length) {
      stopWatching();
      return;
    }
    // Persist prior card before switching (multi-tab / wrong re-apply safety)
    if (watch.cardId && watch.cardId !== cardId && watch.lastStatus.size && !resetProgress && !clearFields) {
      progressByCard.set(watch.cardId, new Map(watch.lastStatus));
    }
    const sameCard = watch.cardId === cardId;
    watch.cardId = cardId;
    watch.steps = sop.steps;
    watch.data = data && typeof data === "object" ? { ...data } : {};
    // Keep agentApprovedValues when re-watching same card mid-run; clear on fresh watch without them
    if (!watch.agentApproved) {
      watch.agentApprovedValues = {};
    }
    lastMismatchKey = "";

    if (resetProgress || clearFields) {
      progressByCard.delete(cardId);
      watch.lastStatus = new Map();
    } else if (sameCard && watch.lastStatus.size) {
      /* keep in-progress status on this tab */
    } else if (progressByCard.has(cardId)) {
      watch.lastStatus = new Map(progressByCard.get(cardId));
    } else {
      watch.lastStatus = new Map();
    }

    if (clearFields) {
      clearPageFormFields();
      watch.muteReports = false;
    } else if (resetProgress) {
      watch.muteReports = true;
    } else {
      watch.muteReports = false;
    }

    if (!watch.attached) {
      document.addEventListener("input", onManualFieldEvent, true);
      document.addEventListener("change", onManualFieldEvent, true);
      document.addEventListener("focusin", onManualFieldEvent, true);
      document.addEventListener("click", onManualFieldEvent, true);
      document.addEventListener("keyup", onManualFieldEvent, true);
      watch.attached = true;
    }
    if (watch.pollTimer) clearInterval(watch.pollTimer);
    watch.pollTimer = setInterval(() => scanManualProgress(), 800);

    if (clearFields) {
      // Fields are empty — force pending in Coact
      scanManualProgress({ force: true });
      setTimeout(() => scanManualProgress({ force: true }), 200);
      return;
    }
    if (resetProgress) {
      // Keep marks cleared until Refresh or the user edits the form
      applySequentialLocks();
      return;
    }
    // Force re-emit so Refresh / re-watch repaints greens even when status unchanged
    scanManualProgress({ force: true });
    setTimeout(() => scanManualProgress({ force: true }), 200);
    setTimeout(() => scanManualProgress({ force: true }), 1000);
  }

  function captureLiveSnippet() {
    const active =
      document.activeElement &&
      (document.activeElement.matches("input, textarea, [contenteditable='true'], [role='checkbox']")
        ? document.activeElement
        : null);
    const highlighted = document.querySelector(".coact-active-field");
    const focusEl = highlighted || active;

    const blocks = questionBlocks().slice(0, 12);
    const lines = [];
    lines.push(`URL: ${location.href}`);
    lines.push(`Title: ${document.title}`);
    if (focusEl) {
      const block = focusEl.closest(
        'div[role="listitem"], .Qr7Oae, .freebirdFormviewerComponentsQuestionBaseRoot, div[data-params], label, form'
      );
      const title = block ? questionTitle(block) : "";
      const val = fieldValue(focusEl);
      lines.push(`Focused: ${title || focusEl.getAttribute("aria-label") || focusEl.name || focusEl.id || "field"}`);
      if (val) lines.push(`Focused value: ${String(val).slice(0, 200)}`);
    }
    lines.push("Visible questions:");
    for (const block of blocks) {
      const title = questionTitle(block) || "(untitled)";
      const field = fieldInBlock(block);
      const val = field ? fieldValue(field) : "";
      const box = block.querySelector('[role="checkbox"], [role="radio"]');
      const checked = box?.getAttribute("aria-checked");
      lines.push(
        `- ${title}${val ? ` = ${String(val).slice(0, 120)}` : ""}${
          checked != null ? ` [checked=${checked}]` : ""
        }`
      );
    }
    return lines.join("\n");
  }

  function announcePageContext() {
    // Background tabs must not steal the pinned queue card
    if (!extensionAlive()) return;
    if (document.hidden || document.visibilityState !== "visible") return;
    safeRuntimeSend({
      type: "page_context",
      url: location.href,
      title: document.title || "",
    });
  }

  function teardownContentScript() {
    if (tornDown) return;
    tornDown = true;
    try {
      runner.cancelled = true;
      stopWatching();
      clearHighlights();
      window.removeEventListener("focus", announcePageContext);
      document.removeEventListener("visibilitychange", onVisibilityAnnounce);
      if (onMessageListener) {
        try {
          chrome.runtime.onMessage.removeListener(onMessageListener);
        } catch {
          /* context already dead */
        }
      }
    } catch {
      /* ignore */
    }
    if (window.__coactContentExtId === EXT_ID) {
      window.__coactContentLoaded = false;
      window.__coactContentExtId = null;
    }
    window.__coactTeardown = null;
  }

  function handleContextInvalidated() {
    teardownContentScript();
  }

  window.__coactTeardown = teardownContentScript;

  function onVisibilityAnnounce() {
    if (document.visibilityState === "visible") announcePageContext();
  }

  announcePageContext();
  window.addEventListener("focus", announcePageContext);
  document.addEventListener("visibilitychange", onVisibilityAnnounce);

  function onMessageListener(message, _sender, sendResponse) {
    if (!extensionAlive()) return false;

    if (message?.type === "run_sop") {
      watch.agentApproved = Boolean(message.agentApproved);
      watch.agentApprovedValues =
        message.agentApprovedValues && typeof message.agentApprovedValues === "object"
          ? { ...message.agentApprovedValues }
          : {};
      startWatching(message);
      runSop(message);
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "watch_sop") {
      // Fresh watch (not an Agent run) clears the agent-approved gate skip
      if (!message.agentApproved) {
        watch.agentApproved = false;
        watch.agentApprovedValues = {};
      } else {
        watch.agentApproved = true;
        watch.agentApprovedValues =
          message.agentApprovedValues && typeof message.agentApprovedValues === "object"
            ? { ...message.agentApprovedValues }
            : {};
      }
      startWatching(message);
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "apply_step") {
      (async () => {
        const cardId = message.cardId;
        const step =
          (message.step?.id && watch.steps.find((s) => s.id === message.step.id)) ||
          message.step;
        if (!step?.id) {
          sendResponse({ ok: false, error: "missing_step" });
          return;
        }
        const prevAgent = agentRunning;
        const prevBypass = runner.bypassVisibilityGate;
        agentRunning = true;
        runner.bypassVisibilityGate = true;
        clearSequentialLocks();
        try {
          reportManual(step, "running", { force: true });
          // Keep case data from desktop so mandatory expected values are known
          if (message.data && typeof message.data === "object") {
            watch.data = { ...watch.data, ...message.data };
          }
          const useStep = {
            ...(message.broadMatch ? alternateStep(step) : step),
          };
          const data = { ...(message.data || watch.data || {}) };
          const approved = String(message.valueOverride ?? "").trim();
          // Wrong → AI Approve: count the prior wrong value as a mistake (mandatory / key steps only)
          if (step.mandatory && approved) {
            let prior = "";
            try {
              prior = String(readStepActualValue(step) || "").trim();
            } catch {
              prior = "";
            }
            if (prior && !valuesMatch(prior, approved)) {
              reportMistakeIfWrong(step, prior, approved);
            }
          }
          if (approved) {
            if (step.valueFrom) data[step.valueFrom] = approved;
            else useStep.value = approved;
            // Keep watch data in sync so last-step checks match the approved value
            if (step.valueFrom) {
              watch.data = { ...watch.data, [step.valueFrom]: approved };
            }
          }
          await runStep(useStep, data, cardId);
          if (step.waitAfter) await settleAfterStep(step);
          clearHighlights();
          clearWrongHighlight(step);
          document.querySelectorAll(".coact-wrong-field").forEach((n) => {
            try {
              n.classList.remove("coact-wrong-field");
            } catch {
              /* ignore */
            }
          });
          hideSeqTip();
          lastMismatchKey = "";
          markWatchStatus(step.id, "done");
          // Approved correct value — clear mismatch coach hold, keep prior mistake in desktop log
          reportManual(step, "done", { force: true, valueMatched: true, value: approved || undefined });
          sendResponse({ ok: true });
        } catch (err) {
          clearHighlights();
          report({
            cardId,
            stepId: step.id,
            status: "failed",
            error: err?.message || String(err),
          });
          sendResponse({ ok: false, error: err?.message || String(err) });
        } finally {
          agentRunning = prevAgent;
          runner.bypassVisibilityGate = prevBypass;
          applySequentialLocks();
          highlightWrongValuesIfLastStep();
          setTimeout(() => {
            applySequentialLocks();
            scanManualProgress({ force: true });
          }, 50);
          setTimeout(() => {
            applySequentialLocks();
            scanManualProgress({ force: true });
          }, 300);
        }
      })();
      return true;
    }

    if (message?.type === "capture_snippet") {
      try {
        sendResponse({ ok: true, text: captureLiveSnippet() });
      } catch (err) {
        sendResponse({ ok: false, text: "", error: err?.message || String(err) });
      }
      return true;
    }

    if (message?.type === "control") {
      if (message.action === "pause") runner.paused = true;
      if (message.action === "resume") runner.paused = false;
      if (message.action === "cancel") {
        runner.cancelled = true;
        cancelCheckpoint();
      }
      sendResponse({ ok: true });
      return true;
    }

    return false;
  }

  try {
    chrome.runtime.onMessage.addListener(onMessageListener);
  } catch {
    handleContextInvalidated();
  }
})();
