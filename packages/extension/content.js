(() => {
  const EXT_ID = chrome.runtime?.id || "";
  const INSTANCE = `${EXT_ID}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  // After Reload on chrome://extensions the id stays the same, but the old
  // listener is a dead context. Always tear down so this instance can take over
  // (page refresh is not required).
  if (window.__coactContentLoaded) {
    try {
      window.__coactTeardown?.();
    } catch {
      /* ignore */
    }
  }
  window.__coactContentLoaded = true;
  window.__coactContentExtId = EXT_ID;
  window.__coactContentInstance = INSTANCE;

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
    /** Last step_update signature so identical fills are not re-sent. */
    lastReport: new Map(),
    pendingReport: new Map(),
    /** Intentional Agent-approved values for this run (stepId -> value). Not mistakes. */
    agentApproved: false,
    agentApprovedValues: {},
    /** User dismissed the coach — keep their click/fill and advance. */
    acceptOwnValue: new Set(),
    /** After skip/Next: empty mandatory fields stay red until filled. */
    mandatoryAlert: false,
    /** Href when watching started — URL waitAfter must change from this. */
    startHref: "",
  };

  const StepMatch = globalThis.__ltStepMatch || {};
  const QUESTION_BLOCK_SEL =
    'div[role="listitem"], .Qr7Oae, .freebirdFormviewerComponentsQuestionBaseRoot, div[data-params], [data-automation-id*="formField"], [data-automation-id*="primaryQuestionnaire"], [data-automation-id*="questionnaire"], fieldset, [role="radiogroup"]';
  const QUESTION_FIELD_SEL =
    'input:not([type="hidden"]):not([type="file"]), textarea, select, [role="checkbox"], [role="radio"], [role="option"], [role="combobox"], [role="listbox"], [role="spinbutton"], [data-automation-id*="promptOption"]';

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
  let valueFlushTimer = null;
  let manualScanTimer = null;
  let lastStepCommitTimer = null;
  let selectorMatchCache = null;
  let scanUniqueHits = null;
  let scanFieldIndex = null;
  let shadowRootsCache = null;
  let shadowRootsAt = 0;

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
      /* Red outline for wrong value, skipped required, or blocked Next/Submit */
      .coact-wrong-field,
      .coact-required-empty {
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
      if (action === "fill" || action === "navigate" || action === "select") {
        try {
          value = readStepActualValue(step) || "";
        } catch {
          value = "";
        }
      } else if (action === "click") {
        value =
          step.findByText ||
          (Array.isArray(step.findByLabel) ? step.findByLabel[0] : step.findByLabel) ||
          step.label ||
          "clicked";
      } else if (action === "check") {
        try {
          value = readStepActualValue(step) || "";
        } catch {
          value = "";
        }
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
    const nodes = Array.from(document.querySelectorAll(QUESTION_BLOCK_SEL));
    const withFields = nodes.filter((n) => n.querySelector(QUESTION_FIELD_SEL));
    // Leaf blocks only — a page wrapper that contains later questions must not
    // make those later labels look "filled" via the first input in the wrapper.
    return withFields.filter(
      (n) => !withFields.some((other) => other !== n && n.contains(other))
    );
  }

  function questionTitle(block) {
    if (!block) return "";
    const labelledBy = block.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      const parts = String(labelledBy)
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .filter(Boolean);
      const joined = normalize(parts.join(" "));
      if (joined) return joined;
    }
    const titleEl =
      block.querySelector('[role="heading"]') ||
      block.querySelector('[data-automation-id*="label"]') ||
      block.querySelector('[data-automation-id*="Label"]') ||
      block.querySelector('[data-automation-id*="formLabel"]') ||
      block.querySelector("legend") ||
      block.querySelector(".M7eMe") ||
      block.querySelector(".HoXoMd") ||
      block.querySelector("label") ||
      block.querySelector("abbr");
    if (titleEl) return normalize(titleEl.textContent);
    const aria = normalize(block.getAttribute?.("aria-label") || "");
    if (aria && !(StepMatch.isShortOptionLabel && StepMatch.isShortOptionLabel(aria))) return aria;
    const lines = String(block.innerText || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return normalize(lines[0] || "");
  }

  function fieldInBlock(block) {
    return (
      block.querySelector("textarea") ||
      block.querySelector("select") ||
      block.querySelector('[role="combobox"]') ||
      block.querySelector('[role="spinbutton"]') ||
      block.querySelector('[role="listbox"]') ||
      block.querySelector('input[type="text"]') ||
      block.querySelector('input[type="email"]') ||
      block.querySelector('input[type="date"]') ||
      block.querySelector('input[type="number"]') ||
      block.querySelector('input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])') ||
      block.querySelector('[contenteditable="true"]') ||
      block.querySelector('input[type="radio"]:checked') ||
      block.querySelector('input[type="radio"]')
    );
  }

  function titleMatches(title, hint, mode) {
    if (StepMatch.titleMatches) return StepMatch.titleMatches(title, hint, mode);
    const h = normalize(hint);
    const t = normalize(title);
    if (!h || !t) return false;
    if (mode === "exact") return t === h || t === `${h} *` || t.startsWith(`${h} `);
    if (mode === "startsWith") return t.startsWith(h);
    return t.includes(h);
  }

  function stepQuestionHints(step) {
    if (StepMatch.distinctiveQuestionHints) return StepMatch.distinctiveQuestionHints(step);
    return (Array.isArray(step?.findByLabel) ? step.findByLabel : [step?.findByLabel || step?.label || ""])
      .map(normalize)
      .filter(Boolean);
  }

  function findByLabel(labelHints, mode = "includes") {
    const hints = (Array.isArray(labelHints) ? labelHints : [labelHints]).filter(Boolean);
    if (!hints.length) return null;

    const blocks = questionBlocks();
    let best = null;
    let bestScore = 0;
    for (const block of blocks) {
      const field = fieldInBlock(block);
      if (!field) continue;
      const snap = {
        title: questionTitle(block),
        aria: String(field.getAttribute?.("aria-label") || "").trim(),
        placeholder: String(field.getAttribute?.("placeholder") || field.placeholder || "").trim(),
        value: fieldValue(field),
      };
      const score = StepMatch.controlMatchScore
        ? StepMatch.controlMatchScore(snap, hints.map(normalize))
        : StepMatch.titleMatchScore
          ? StepMatch.titleMatchScore(snap.title, hints)
          : hints.some((h) => titleMatches(snap.title, h, mode))
            ? normalize(hints[0]).length
            : 0;
      if (score <= bestScore) continue;
      bestScore = score;
      best = field;
    }
    if (best) return best;

    // Fallback: block text contains a long hint, but only on small leaf blocks.
    for (const hint of hints) {
      const h = normalize(hint);
      if (h.length < 16) continue;
      for (const block of blocks) {
        const text = normalize(block.innerText || "");
        if (text.length > 360 || !text.includes(h)) continue;
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

  function findClickableByText(labelHints, root = document) {
    const hints = (Array.isArray(labelHints) ? labelHints : [labelHints])
      .map(normalize)
      .filter(Boolean);
    if (!hints.length) return null;

    const scope = root && root.querySelectorAll ? root : document;
    const candidates = Array.from(
      scope.querySelectorAll(
        'button, a[href], [role="button"], [role="radio"], [role="checkbox"], [role="option"], input[type="submit"], input[type="button"], input[type="reset"], input[type="radio"], input[type="checkbox"]'
      )
    );
    for (const hint of hints) {
      for (const el of candidates) {
        if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
        const text = normalize(
          el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || ""
        );
        if (!text) continue;
        if (text === hint || text.includes(hint)) return el;
        if (text.length >= 4 && hint.startsWith(text)) return el;
      }
    }
    return null;
  }

  function querySelectorSafe(selector, root = document) {
    if (!selector || !root?.querySelector) return null;
    try {
      return root.querySelector(selector);
    } catch {
      return null;
    }
  }

  function shadowRoots() {
    const now = Date.now();
    if (shadowRootsCache && now - shadowRootsAt < 1500) return shadowRootsCache;
    const roots = [];
    const stack = [document];
    const seen = new Set();
    while (stack.length) {
      const root = stack.pop();
      let nodes = [];
      try {
        nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
      } catch {
        nodes = [];
      }
      for (const node of nodes) {
        if (node.shadowRoot && !seen.has(node.shadowRoot)) {
          seen.add(node.shadowRoot);
          roots.push(node.shadowRoot);
          stack.push(node.shadowRoot);
        }
      }
    }
    shadowRootsCache = roots;
    shadowRootsAt = now;
    return roots;
  }

  function queryDeep(selector) {
    const found = querySelectorSafe(selector, document);
    if (found) return found;
    for (const root of shadowRoots()) {
      const hit = querySelectorSafe(selector, root);
      if (hit) return hit;
    }
    return null;
  }

  function selectorList(step) {
    const list = [];
    if (Array.isArray(step?.selectors)) list.push(...step.selectors);
    if (step?.selector) list.push(step.selector);
    return [...new Set(list.map((s) => String(s || "").trim()).filter(Boolean))];
  }

  function resolveBySelectors(step) {
    for (const sel of selectorList(step)) {
      const el = queryDeep(sel);
      if (el) return el;
    }
    return null;
  }

  function visibleMatches(selector) {
    if (selectorMatchCache?.has(selector)) return selectorMatchCache.get(selector);
    let els = [];
    try {
      els = Array.from(document.querySelectorAll(selector)).filter((el) => isElementVisible(el));
    } catch {
      els = [];
    }
    if (selectorMatchCache) selectorMatchCache.set(selector, els);
    return els;
  }

  function uniqueSelectorHit(step) {
    for (const sel of selectorList(step)) {
      const els = visibleMatches(sel);
      if (els.length === 1) return els[0];
    }
    return null;
  }

  function associatedControlLabel(el) {
    if (!el) return "";
    const labelledBy = el.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      const text = String(labelledBy)
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      const named = normalize(text);
      if (named) return named;
    }
    if (el.id) {
      try {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const named = normalize(lab?.textContent || "");
        if (named) return named;
      } catch {
        /* ignore bad ids */
      }
    }
    const wrap = el.closest?.("label");
    if (wrap) {
      const named = normalize(String(wrap.textContent || "").replace(String(el.value || ""), ""));
      if (named && named.length < 180) return named;
    }
    return "";
  }

  function controlSnapshot(el) {
    const block = questionBlockFor(el);
    const fromBlock = block ? questionTitle(block) : "";
    return {
      title: fromBlock || associatedControlLabel(el),
      aria: String(el?.getAttribute?.("aria-label") || "").trim(),
      placeholder: String(el?.getAttribute?.("placeholder") || el?.placeholder || "").trim(),
      value: fieldValue(el),
    };
  }

  function elementMatchesStep(el, step) {
    if (!el || !step) return false;
    const hints = StepMatch.stepValueHints ? StepMatch.stepValueHints(step) : stepQuestionHints(step);
    if (!hints.length) {
      const unique = uniqueSelectorHit(step);
      return Boolean(unique && (unique === el || unique.contains(el) || el.contains?.(unique)));
    }
    if (StepMatch.controlMatchScore) {
      return StepMatch.controlMatchScore(controlSnapshot(el), hints) > 0;
    }
    const block = questionBlockFor(el);
    const title = block ? questionTitle(block) : "";
    if (StepMatch.titleMatchScore) return StepMatch.titleMatchScore(title, hints) > 0;
    return hints.some((h) => titleMatches(title, h, StepMatch.matchModeForHint ? StepMatch.matchModeForHint(h) : "includes"));
  }

  function looksLikeServiceNow() {
    const u = String(location.href || "").toLowerCase();
    const t = String(document.title || "").toLowerCase();
    if (u.includes("service-now") || u.includes("servicenow") || t.includes("servicenow")) {
      return true;
    }
    return /\/(nav_to\.do|change_request|incident\.do|now\/nav|textsearch\.do)/i.test(u);
  }

  function changeRequestSearchUrl(query) {
    const origin = location.origin;
    const q = String(query || "").replace(/\s+/g, " ").trim();
    if (!origin || !q) return "";
    const compact = q.replace(/\s/g, "");
    let encodedQuery;
    if (/^(chg)?\d{5,}$/i.test(compact)) {
      let number = compact.toUpperCase();
      if (/^\d+$/.test(number)) number = `CHG${number}`;
      encodedQuery = `number=${encodeURIComponent(number)}^ORnumberLIKE${encodeURIComponent(number)}`;
    } else {
      const like = encodeURIComponent(q);
      encodedQuery = `numberLIKE${like}^ORshort_descriptionLIKE${like}^ORdescriptionLIKE${like}`;
    }
    return `${origin}/change_request_list.do?sysparm_query=${encodedQuery}&sysparm_first_row=1&sysparm_view=`;
  }

  function guiSelectorHit(step) {
    const list = [];
    if (step?.guiId) list.push(String(step.guiId));
    for (const sel of selectorList(step)) {
      if (StepMatch.isStableGuiSelector && StepMatch.isStableGuiSelector(sel)) list.push(sel);
    }
    const wanted = normalize(
      (Array.isArray(step?.allowedValues) && step.allowedValues.find(Boolean)) ||
        step?.value ||
        (Array.isArray(step?.findByText) ? step.findByText[0] : step?.findByText) ||
        "",
    );
    for (const sel of [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))]) {
      const els = visibleMatches(sel);
      if (els.length === 1) return els[0];
      if (!wanted || els.length < 2) continue;
      const hit = els.find((el) => {
        const bits = [el.getAttribute?.("aria-label"), el.getAttribute?.("value"), el.value, el.innerText]
          .map(normalize)
          .filter(Boolean);
        return bits.some((text) => text === wanted || text.includes(wanted));
      });
      if (hit) return hit;
    }
    return null;
  }

  function resolveElement(step) {
    if (!step) return null;
    const byGui = guiSelectorHit(step);
    if (byGui) return byGui;
    const hints = stepQuestionHints(step);
    const optionHints = []
      .concat(step.findByText || [], step.findButtonByText || [])
      .filter(Boolean);

    // Unique CSS only when the control actually belongs to this question
    const unique = uniqueSelectorHit(step);
    if (unique && (!hints.length || elementMatchesStep(unique, step))) return unique;

    if (hints.length) {
      const mode =
        step.matchMode ||
        (StepMatch.matchModeForHint ? StepMatch.matchModeForHint(hints[0]) : "includes");
      const byLabel = findByLabel(hints, mode);
      if (byLabel) {
        if (optionHints.length && (step.action === "click" || step.action === "check")) {
          const block = questionBlockFor(byLabel) || byLabel.parentElement;
          const inBlock = findClickableByText(optionHints, block || document);
          if (inBlock) return inBlock;
        }
        return byLabel;
      }
    }

    // Never search the whole page for "Yes" / "No" — that greens later questions.
    const optionOnly = optionHints.filter(
      (h) => !(StepMatch.isShortOptionLabel && StepMatch.isShortOptionLabel(h))
    );
    if (optionOnly.length && (step.action === "click" || step.action === "check")) {
      const el = findClickableByText(optionOnly);
      if (el && elementMatchesStep(el, step)) return el;
    }
    if ((step.action === "click" || step.action === "check") && optionOnly.length === 0 && hints.length) {
      /* option Yes scoped above via findByLabel */
    } else if (step.action === "click" && hints.length) {
      const el = findClickableByText(hints);
      if (el) return el;
    }

    if (step.findCheckboxByLabel && hints.length) {
      const el = findCheckboxByLabel(step.findCheckboxByLabel);
      if (el && elementMatchesStep(el, step)) return el;
    }

    const bySel = resolveBySelectors(step);
    if (bySel && elementMatchesStep(bySel, step)) return bySel;
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
        step?.fallbackNavigate ||
        String(step?.action || "").toLowerCase() === "navigate" ||
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
    const snowNav =
      String(step.action || "").toLowerCase() === "navigate" ||
      step.fallbackNavigate === "servicenow-change-request";
    if (snowNav) {
      await waitForPredicate(() => Boolean(resolveElement(step)), Math.min(timeoutMs, 1200));
      return true;
    }

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

    if ((el.tagName || "").toLowerCase() === "select") {
      const want = text.trim();
      const opts = Array.from(el.options || []);
      let idx = opts.findIndex(
        (o) => String(o.value) === want || String(o.textContent || "").replace(/\s+/g, " ").trim() === want
      );
      if (idx < 0 && want) {
        const lower = want.toLowerCase();
        idx = opts.findIndex((o) =>
          String(o.textContent || "").replace(/\s+/g, " ").trim().toLowerCase().includes(lower)
        );
      }
      if (idx >= 0) {
        el.selectedIndex = idx;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

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
    const snowNav =
      String(step.action || "").toLowerCase() === "navigate" ||
      step.fallbackNavigate === "servicenow-change-request";
    const el = resolveElement(step);
    if (!el && !snowNav) {
      throw new Error(`Could not find: ${step.label || step.id}`);
    }

    if (el) {
      clearHighlights();
      el.classList.add("coact-active-field");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      await sleep(250);
    }

    // Re-check right before typing — user may have switched away
    if (!pageIsVisibleToUser()) {
      const again = await waitUntilBrowserVisible(cardId);
      if (!again || runner.cancelled) {
        throw new Error("Form tab not visible on screen");
      }
    }

    if (snowNav) {
      const value = fillValueForStep(step, data);
      if (!looksLikeServiceNow()) {
        throw new Error("Open a logged-in ServiceNow tab, then Start.");
      }
      const href = changeRequestSearchUrl(value);
      if (!href) {
        throw new Error("Enter a change request number or keywords.");
      }
      if (el && (step.action === "fill" || step.action === "select")) {
        await fillGoogleStyle(el, value);
        await sleep(200);
      }
      location.assign(href);
      return;
    }

    if (step.action === "fill" || step.action === "select") {
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

  function urlWaitAlreadyTrueAtStart(step) {
    const w = step?.waitAfter || {};
    const start = String(watch.startHref || "");
    if (!start) return false;
    try {
      if (w.urlEquals && start === w.urlEquals) return true;
      if (w.urlIncludes && start.includes(w.urlIncludes)) return true;
      if (w.urlPath && (start.includes(w.urlPath) || new URL(start).pathname.includes(w.urlPath))) return true;
    } catch {
      if (w.urlPath && start.includes(w.urlPath)) return true;
    }
    return false;
  }

  function clickStepLooksDone(step) {
    const w = step.waitAfter || {};
    const href = location.href;
    if (!urlWaitAlreadyTrueAtStart(step)) {
      if (w.urlEquals && href === w.urlEquals) return true;
      if (w.urlIncludes && href.includes(w.urlIncludes)) return true;
      if (w.urlPath && (location.pathname.includes(w.urlPath) || href.includes(w.urlPath))) return true;
    }
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

  function choiceLooksSelected(el) {
    if (!el) return false;
    const role = String(el.getAttribute?.("role") || "").toLowerCase();
    if (el.getAttribute?.("aria-checked") === "true" || el.getAttribute?.("aria-pressed") === "true") {
      return true;
    }
    if (el.checked) return true;
    if (role === "radio" || role === "option") {
      return el.getAttribute("aria-selected") === "true";
    }
    return Boolean(fieldValue(el));
  }

  function stepControlCompleted(step) {
    if (!step) return false;
    if (step.action === "fill" || step.action === "select") return stepFieldFilled(step);
    if (step.action === "click") return clickStepLooksDone(step);
    if (step.action === "check") {
      const el = resolveElement(step);
      if (!el || !choiceLooksSelected(el)) return false;
      return Boolean(fieldValue(el) || readStepActualValue(step));
    }
    return false;
  }

  function stepAlreadyComplete(step) {
    if (!step) return false;
    if (step.action === "highlight" || step.action === "wait") return false;
    try {
      if (step.action === "fill" || step.action === "select") {
        if (stepFieldFilled(step)) return true;
        return watch.lastStatus.get(step.id) === "done" && !stepFindableOnPage(step);
      }
      if (step.action === "check") {
        if (stepControlCompleted(step)) return true;
        return watch.lastStatus.get(step.id) === "done" && !stepFindableOnPage(step);
      }
      if (step.action === "click") {
        if (clickStepLooksDone(step)) return true;
        return watch.lastStatus.get(step.id) === "done" && !stepFindableOnPage(step);
      }
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
      if (laterOk && stepMayNavigate(step)) {
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
            ...captureFieldsForStep(step, fillValueForStep(step, data || {})),
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

        if (step.action === "check") {
          const checked = readStepActualValue(step);
          const checkResult = evaluateCheckValue(step, checked);
          if (checkResult.empty) {
            markWatchStatus(step.id, "pending");
            report({
              cardId,
              stepId: step.id,
              status: "pending",
              action: "check",
              key: step.valueFrom || step.id,
              label: step.label || step.id,
              reason: `“${step.label || step.id}” is not selected.`,
            });
            continue;
          }
          if (checkResult.wrong) {
            reportMistakeIfWrong(
              step,
              checked,
              checkResult.expected || expectedValueForStep(step, data || {}),
            );
          }
        }

        report({
          cardId,
          stepId: step.id,
          status: "done",
          valueMatched: step.action !== "check" || evaluateCheckValue(step, readStepActualValue(step)).ok,
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

  function choiceQuestionContext(el) {
    const titles = [];
    const block = questionBlockFor(el);
    const title = block ? questionTitle(block) : "";
    // The control's own aria-label is the option the user picked (Google Forms
    // puts the whole choice sentence there). Treating it as the question makes
    // a checked box look empty.
    const own = String(el?.getAttribute?.("aria-label") || el?.innerText || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (title && title.toLowerCase() !== own) titles.push(title);
    return titles;
  }

  function choiceToggle(el) {
    if (!el) return null;
    const role = String(el.getAttribute?.("role") || "").toLowerCase();
    const type = String(el.type || "").toLowerCase();
    if (role === "checkbox" || role === "radio" || type === "checkbox" || type === "radio") return el;
    const inner = el.querySelector?.(
      '[role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"]'
    );
    if (inner) return inner;
    return (
      el.closest?.(
        '[role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"]'
      ) || null
    );
  }

  function choiceIsOn(el) {
    const node = choiceToggle(el);
    if (!node) return false;
    if (node.checked) return true;
    if (node.getAttribute("aria-checked") === "true" || node.getAttribute("aria-pressed") === "true") {
      return true;
    }
    if (node.querySelector?.('[aria-checked="true"], [aria-pressed="true"]')) return true;
    const parent = node.parentElement?.closest?.('[aria-checked="true"], [aria-pressed="true"]');
    return Boolean(parent);
  }

  function choiceLabelText(el) {
    const node = choiceToggle(el) || el;
    if (!node) return "";
    const aria = String(node.getAttribute?.("aria-label") || "").replace(/\s+/g, " ").trim();
    if (aria) return aria;
    const labelledBy = node.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      const text = String(labelledBy)
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) return text;
    }
    const row = node.closest?.("label") || node.parentElement;
    const raw = String(row?.innerText || node.innerText || node.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    return raw;
  }

  function cleanedChoiceValue(raw, el) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (StepMatch.effectiveChoiceValue) {
      return StepMatch.effectiveChoiceValue(text, choiceQuestionContext(el));
    }
    if (StepMatch.looksLikePlaceholder && StepMatch.looksLikePlaceholder(text)) return "";
    return text;
  }

  function comboboxTriggerText(el) {
    const valuetext = String(el.getAttribute("aria-valuetext") || "").replace(/\s+/g, " ").trim();
    if (valuetext) return valuetext;
    try {
      const clone = el.cloneNode(true);
      clone
        .querySelectorAll(
          '[role="listbox"], [role="list"], [role="option"], ul, ol, [data-automation-id*="popupList"], [data-automation-id*="promptOption"]'
        )
        .forEach((n) => n.remove());
      const lines = String(clone.innerText || "")
        .split("\n")
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (lines[0]) return lines[0];
    } catch {
      /* ignore */
    }
    const lines = String(el.innerText || "")
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return lines[0] || String(el.value || "").trim();
  }

  function fieldValue(el) {
    if (!el) return "";
    const toggle = choiceToggle(el);
    if (toggle && choiceIsOn(toggle)) {
      const raw = choiceLabelText(toggle);
      return cleanedChoiceValue(raw, toggle) || raw || "checked";
    }
    const role = el.getAttribute?.("role") || "";
    if (role === "checkbox" || role === "radio" || role === "option" || role === "button" || role === "switch") {
      const on =
        el.getAttribute("aria-checked") === "true" ||
        el.getAttribute("aria-pressed") === "true" ||
        el.getAttribute("aria-selected") === "true";
      if (on) {
        const raw = String(el.innerText || el.textContent || el.getAttribute("aria-label") || "checked")
          .replace(/\s+/g, " ")
          .trim();
        return cleanedChoiceValue(raw, el) || raw || "checked";
      }
      if (role === "option" || role === "button" || role === "switch") return "";
    }
    const tag = (el.tagName || "").toLowerCase();
    const type = String(el.type || "").toLowerCase();
    if (tag === "select") {
      const opt = el.selectedOptions && el.selectedOptions[0];
      if (!opt) return "";
      const text = String(opt.textContent || "").replace(/\s+/g, " ").trim();
      const value = String(opt.value || el.value || "").trim();
      if (opt.disabled) return "";
      const visible = cleanedChoiceValue(text, el);
      if (visible) return visible;
      if (!text && value && !(StepMatch.looksLikePlaceholder && StepMatch.looksLikePlaceholder(value))) {
        return value;
      }
      return "";
    }
    if (role === "combobox" || role === "listbox" || role === "spinbutton") {
      const nested = el.querySelector?.(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea'
      );
      const nestedVal = nested ? String(nested.value || "").trim() : "";
      if (nestedVal) return cleanedChoiceValue(nestedVal, el) || nestedVal;
      if (role === "listbox") {
        const selected = el.querySelector?.('[aria-selected="true"], [aria-checked="true"]');
        if (!selected) return "";
        return cleanedChoiceValue(
          String(selected.innerText || selected.textContent || "").replace(/\s+/g, " ").trim(),
          el
        );
      }
      const raw = comboboxTriggerText(el);
      return cleanedChoiceValue(raw, el);
    }
    if (type === "radio" || type === "checkbox") {
      if (!el.checked) return "";
      const lab = el.closest("label");
      const labText = lab
        ? String(lab.innerText || "").replace(/\s+/g, " ").trim()
        : "";
      return labText || String(el.value || "checked").trim();
    }
    if (el.isContentEditable) return String(el.textContent || "").trim();
    const direct = String(el.value || "").trim();
    if (direct) return direct;
    const inner = el.shadowRoot?.querySelector?.(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea'
    );
    if (inner) {
      const nested = String(inner.value || inner.textContent || "").trim();
      if (nested) return nested;
    }
    return "";
  }

  function questionBlockFor(el) {
    if (!el?.closest) return null;
    return el.closest(QUESTION_BLOCK_SEL) || null;
  }

  function labelHints(step) {
    return stepQuestionHints(step);
  }

  function stepMatchesQuestion(step, el) {
    const hints = stepQuestionHints(step);
    if (!hints.length || !el) return false;
    const block = questionBlockFor(el);
    const title = block ? questionTitle(block) : "";
    if (StepMatch.titleMatchScore) return StepMatch.titleMatchScore(title, hints) > 0;
    const mode = step.matchMode || (hints[0].length <= 8 ? "exact" : "includes");
    return hints.some((h) => titleMatches(title, h, mode));
  }

  function isChoiceControl(el) {
    if (!el) return false;
    const type = String(el.type || "").toLowerCase();
    if (type === "radio" || type === "checkbox" || type === "button") return true;
    const role = String(el.getAttribute?.("role") || "").toLowerCase();
    if (role === "radio" || role === "checkbox" || role === "option" || role === "switch") {
      return true;
    }
    return Boolean(
      el.closest?.(
        'button, [role="button"], [role="radio"], [role="checkbox"], [role="option"], label, input[type="radio"], input[type="checkbox"]'
      )
    );
  }

  function completeStepFromUser(step, { value } = {}) {
    if (!step) return;
    if (lastStepCommitTimer) {
      clearTimeout(lastStepCommitTimer);
      lastStepCommitTimer = null;
    }
    if (step.action === "check") {
      finishCheckFromUser(step, value);
      return;
    }
    const actual = String(value || "").trim();
    // A click is done when the user hits the button. The button caption is not a field value.
    if (step.action === "click") {
      markStepAcceptedByUser(step.id);
      hideSeqTip();
      clearWrongHighlight(step);
      lastMismatchKey = "";
      reportManual(step, "done", {
        force: true,
        value: actual || undefined,
        valueMatched: true,
      });
      noteSkippedMandatory(step);
      applySequentialLocks();
      return;
    }
    const judged = fillMatchResult(step, actual);
    if (actual && !judged.matched) {
      if (!reportMistakeIfWrong(step, actual, judged.expected)) {
        try {
          showWrongTip(step, judged.expected, actual);
        } catch {
          /* soft */
        }
      }
    }
    markStepAcceptedByUser(step.id);
    hideSeqTip();
    clearWrongHighlight(step);
    lastMismatchKey = "";
    reportManual(step, "done", {
      force: true,
      value: actual || undefined,
      valueMatched: judged.matched,
    });
    noteSkippedMandatory(step);
    applySequentialLocks();
  }

  function evaluateCheckValue(step, actual) {
    if (userAcceptedStep(step) || watch.agentApproved) {
      return actual ? { ok: true } : { ok: false, empty: true };
    }
    const list = expectedListForStep(step);
    if (StepMatch.evaluateCheckSelection) {
      return StepMatch.evaluateCheckSelection(actual, list);
    }
    if (!actual) return { ok: false, empty: true };
    if (list.length && !valuesMatchAny(actual, list)) {
      return { ok: false, wrong: true, expected: list[0] };
    }
    return { ok: true };
  }

  function finishCheckFromUser(step, value) {
    const actual = String(value || readStepActualValue(step) || "").trim();
    const result = evaluateCheckValue(step, actual);
    if (result.empty) {
      reportManual(step, "pending", { force: true, fieldPresent: true });
      applySequentialLocks();
      return;
    }
    if (result.wrong) {
      reportMistakeIfWrong(step, actual, result.expected);
      try {
        showWrongTip(step, result.expected, actual);
      } catch {
        /* soft */
      }
    } else {
      hideSeqTip();
      clearWrongHighlight(step);
      lastMismatchKey = "";
    }
    reportManual(step, "done", {
      force: true,
      value: actual,
      valueMatched: !result.wrong,
    });
    applySequentialLocks();
  }

  function pickStepByTitleFallback(title) {
    let best = null;
    let bestScore = 0;
    for (const step of watch.steps || []) {
      if (step.action === "highlight" || step.action === "wait") continue;
      const hints = stepQuestionHints(step);
      const score = StepMatch.titleMatchScore
        ? StepMatch.titleMatchScore(title, hints)
        : hints.reduce(
            (n, h) => (titleMatches(title, h, StepMatch.matchModeForHint?.(h) || "includes") ? Math.max(n, String(h).length) : n),
            0
          );
      if (score > bestScore) {
        bestScore = score;
        best = step;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function matchStepForElement(el) {
    if (!watch.steps.length || !el) return null;
    const snap = controlSnapshot(el);
    const byControl = StepMatch.pickBestStepForControl
      ? StepMatch.pickBestStepForControl(watch.steps, snap)
      : StepMatch.pickBestStepForTitle
        ? StepMatch.pickBestStepForTitle(watch.steps, snap.title)
        : pickStepByTitleFallback(snap.title);
    if (byControl) return byControl;

    let uniqueHit = null;
    for (const step of watch.steps) {
      if (step.action === "highlight" || step.action === "wait") continue;
      const unique = scanUniqueHits ? scanUniqueHits.get(step.id) || null : uniqueSelectorHit(step);
      if (unique && (unique === el || unique.contains(el) || el.contains?.(unique))) {
        uniqueHit = step;
        break;
      }
    }
    return uniqueHit;
  }

  function userAcceptedStep(step) {
    return Boolean(step?.id && watch.acceptOwnValue instanceof Set && watch.acceptOwnValue.has(step.id));
  }

  function markStepAcceptedByUser(stepId) {
    if (!stepId) return;
    if (!(watch.acceptOwnValue instanceof Set)) watch.acceptOwnValue = new Set();
    watch.acceptOwnValue.add(stepId);
  }

  /** User chose to continue — accept the step they are on, and leave the rest for later. */
  function acceptFilledStepsOnProceed() {
    const gate = watch.steps[actionGateIndex()];
    if (gate && (stepFieldFilled(gate) || watch.lastStatus.get(gate.id) === "running")) {
      markStepAcceptedByUser(gate.id);
      clearWrongHighlight(gate);
      reportManual(gate, "done", { force: true, valueMatched: true });
    }
    lastMismatchKey = "";
    hideSeqTip();
  }

  function acceptOwnValueForStep(stepId) {
    if (!stepId) return;
    markStepAcceptedByUser(stepId);
    const step = watch.steps.find((s) => s.id === stepId);
    if (!step) return;
    hideSeqTip();
    clearWrongHighlight(step);
    lastMismatchKey = "";
    const prev = watch.lastStatus.get(step.id);
    const filled =
      step.action === "fill" || step.action === "select"
        ? stepFieldFilled(step)
        : Boolean(stepFieldFilled(step) || clickStepLooksDone(step));
    if (filled || prev === "done" || prev === "running") {
      reportManual(step, "done", { force: true, valueMatched: true });
    }
    applySequentialLocks();
  }

  function reportSignature(status, value, valueMatched, fieldPresent) {
    return [
      status,
      value == null ? "" : String(value),
      valueMatched == null ? "" : valueMatched ? "1" : "0",
      fieldPresent == null ? "" : fieldPresent ? "1" : "0",
    ].join("\u0001");
  }

  function emitManualReport(step, status, { value, valueMatched = null, reason, fieldPresent = null } = {}) {
    const sig = reportSignature(status, value, valueMatched, fieldPresent);
    if (!(watch.lastReport instanceof Map)) watch.lastReport = new Map();
    if (watch.lastReport.get(step.id) === sig) return;
    watch.lastReport.set(step.id, sig);
    watch.lastStatus.set(step.id, status);
    let saved = progressByCard.get(watch.cardId);
    if (!saved) {
      saved = new Map();
      progressByCard.set(watch.cardId, saved);
    }
    saved.set(step.id, status);
    const capture =
      status === "done" &&
      (step.action === "fill" ||
        step.action === "select" ||
        step.action === "click" ||
        step.action === "check")
        ? captureFieldsForStep(step, value)
        : {};
    report({
      cardId: watch.cardId,
      stepId: step.id,
      status,
      source: "manual",
      ...(reason ? { reason } : {}),
      ...(valueMatched != null ? { valueMatched: Boolean(valueMatched) } : {}),
      ...(fieldPresent != null ? { fieldPresent: Boolean(fieldPresent) } : {}),
      ...capture,
    });
  }

  function flushPendingReports() {
    valueFlushTimer = null;
    const pending = watch.pendingReport;
    watch.pendingReport = new Map();
    if (!pending?.size || !watch.cardId) return;
    for (const item of pending.values()) {
      emitManualReport(item.step, item.status, item);
    }
  }

  function     reportManual(step, status, { force = false, value, valueMatched = null, reason, fieldPresent = null, repaint = false } = {}) {
    if (!watch.cardId || !step) return;
    if (watch.muteReports && !force) return;
    const prev = watch.lastStatus.get(step.id);
    const sig = reportSignature(status, value, valueMatched, fieldPresent);
    if (!(watch.lastReport instanceof Map)) watch.lastReport = new Map();
    if (watch.lastReport.get(step.id) === sig) return;
    // First paint of a status is immediate. Later keystrokes only refresh the captured value.
    if (prev === status && !repaint) {
      if (!(watch.pendingReport instanceof Map)) watch.pendingReport = new Map();
      watch.pendingReport.set(step.id, { step, status, value, valueMatched, reason, fieldPresent });
      if (!valueFlushTimer) valueFlushTimer = setTimeout(flushPendingReports, 180);
      return;
    }
    if (watch.pendingReport instanceof Map) watch.pendingReport.delete(step.id);
    emitManualReport(step, status, { value, valueMatched, reason, fieldPresent });
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
    return (
      step?.action === "fill" ||
      step?.action === "select" ||
      step?.action === "click" ||
      step?.action === "check" ||
      step?.action === "navigate"
    );
  }

  function stepCompleteForGate(step) {
    if (!step) return false;
    try {
      // Fill/select: live value, or trust an Approve/manual "done" mark so the next field unlocks
      if (step.action === "fill" || step.action === "select" || step.action === "check") {
        if (stepFieldFilled(step)) return true;
        return watch.lastStatus.get(step.id) === "done";
      }
      if (watch.lastStatus.get(step.id) === "done") return true;
      if (step.action === "click") return clickStepLooksDone(step);
    } catch {
      return false;
    }
    return false;
  }

  /**
   * First incomplete fill/click/check (optional / wait / highlight ignored).
   * Used only for last-step mismatch preview — later fields are never locked.
   */
  function getGateIndex() {
    const steps = watch.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!isGatingAction(step)) continue;
      if (step.optional) continue;
      if (stepCompleteForGate(step)) continue;
      if (
        stepMayNavigate(step) &&
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

  /** First step the user has not finished. Ignores values sitting in later fields. */
  function actionGateIndex() {
    const steps = watch.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!isGatingAction(step) || step.optional) continue;
      if (watch.lastStatus.get(step.id) === "done") continue;
      return i;
    }
    return steps.length;
  }

  function stepIndexOf(step) {
    if (!step?.id) return -1;
    return watch.steps.findIndex((s) => s.id === step.id);
  }

  /** Later fields stay editable so tracking can follow wherever the user fills. */
  function isStepLocked() {
    return false;
  }

  function isMandatoryFieldStep(step) {
    if (!step?.mandatory || step.optional) return false;
    return step.action === "fill" || step.action === "select" || step.action === "check";
  }

  function incompleteMandatoryOnPage() {
    const missing = [];
    for (const step of watch.steps || []) {
      if (!isMandatoryFieldStep(step)) continue;
      if (!stepFindableOnPage(step)) continue;
      if (step.action === "check") {
        if (clickStepLooksDone(step) || watch.lastStatus.get(step.id) === "done") continue;
      } else if (stepFieldFilled(step)) {
        continue;
      }
      missing.push(step);
    }
    return missing;
  }

  function controlLabelText(el) {
    if (!el) return "";
    const node =
      (el.closest &&
        el.closest(
          'button, a[href], [role="button"], input[type="submit"], input[type="button"], input[type="reset"]'
        )) ||
      el;
    return String(
      node.innerText ||
        node.textContent ||
        node.value ||
        node.getAttribute?.("aria-label") ||
        node.getAttribute?.("title") ||
        ""
    ).replace(/\s+/g, " ").trim();
  }

  function isProceedLabel(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 48) return false;
    if (/^(back|previous|cancel|close|delete|remove|edit|search|upload|add another|add)$/i.test(t)) {
      return false;
    }
    return /^(save and continue|save & continue|submit|next|continue|apply|finish|send|save and submit|review and submit)$/i.test(
      t
    ) || /^(next|continue)\b/i.test(t);
  }

  function isProceedAttempt(el, clickStep) {
    if (clickStep?.navigates) return true;
    if (clickStep && isNavigationSelector(clickStep.selector)) {
      const lab = String(clickStep.label || "");
      if (!/back|previous|cancel/i.test(lab)) return true;
    }
    const type = String(el?.type || "").toLowerCase();
    if (type === "submit") return true;
    if (isProceedLabel(controlLabelText(el))) return true;
    const stepLabel = []
      .concat(
        clickStep?.label || [],
        clickStep?.findByText || [],
        clickStep?.findButtonByText || []
      )
      .map(String)
      .find(Boolean);
    return isProceedLabel(stepLabel);
  }

  function clearRequiredEmptyHighlights() {
    document.querySelectorAll(".coact-required-empty").forEach((n) => {
      try {
        n.classList.remove("coact-required-empty");
      } catch {
        /* ignore */
      }
    });
  }

  function refreshMandatoryEmptyHighlights() {
    if (!watch.cardId || !watch.mandatoryAlert) {
      clearRequiredEmptyHighlights();
      return;
    }
    ensureHighlightStyle();
    const gateIdx = getGateIndex();
    const step = watch.steps[gateIdx];
    const keep = new Set();
    if (step && isMandatoryFieldStep(step) && !stepFieldFilled(step)) {
      let el = null;
      try {
        el = resolveElement(step);
      } catch {
        el = null;
      }
      if (el) {
        keep.add(el);
        el.classList.add("coact-required-empty");
      }
    } else {
      watch.mandatoryAlert = false;
    }
    document.querySelectorAll(".coact-required-empty").forEach((n) => {
      if (!keep.has(n)) n.classList.remove("coact-required-empty");
    });
  }

  function showMandatoryTip(step, missingCount) {
    ensureHighlightStyle();
    const label = String(step?.label || step?.id || "required field").trim();
    const tip = ensureSeqTipEl();
    tip.classList.add("coact-wrong-tip");
    tip.textContent =
      missingCount > 1
        ? `Fill required “${label}” and ${missingCount - 1} more before continuing.`
        : `Fill required “${label}” before continuing.`;
    tip.classList.add("coact-seq-tip-visible");
    let el = null;
    try {
      el = resolveElement(step);
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
    }, 4200);
  }

  function blockForMissingMandatory() {
    const gateIdx = getGateIndex();
    const step = watch.steps[gateIdx];
    if (!step || !isMandatoryFieldStep(step) || stepFieldFilled(step)) return;
    watch.mandatoryAlert = true;
    reportManual(step, "missing", {
      force: true,
      reason: `Required “${step.label || step.id}” is empty.`,
    });
    refreshMandatoryEmptyHighlights();
    showMandatoryTip(step, 1);
  }

  function noteSkippedMandatory(currentStep) {
    const gateIdx = getGateIndex();
    const curIdx = stepIndexOf(currentStep);
    const gate = watch.steps[gateIdx];
    if (
      !gate ||
      gateIdx < 0 ||
      curIdx < 0 ||
      gateIdx >= curIdx ||
      !isMandatoryFieldStep(gate) ||
      stepFieldFilled(gate)
    ) {
      refreshMandatoryEmptyHighlights();
      return;
    }
    watch.mandatoryAlert = true;
    reportManual(gate, "missing", {
      force: false,
      reason: `Required “${gate.label || gate.id}” is empty.`,
    });
    refreshMandatoryEmptyHighlights();
  }

  function stopEvent(event) {
    try {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    } catch {
      /* ignore */
    }
  }

  function onFormSubmit(event) {
    if (!extensionAlive() || !watch.cardId || agentRunning) return;
    const missing = incompleteMandatoryOnPage();
    if (!missing.length) return;
    const form = event.target;
    const submitter = event.submitter || null;
    const inForm = missing.some((step) => {
      try {
        const node = resolveElement(step);
        return Boolean(form && node && form.contains(node));
      } catch {
        return false;
      }
    });
    const proceed = submitter
      ? isProceedAttempt(submitter, matchClickStepForTarget(submitter))
      : false;
    if (!inForm && !proceed) return;
    stopEvent(event);
    blockForMissingMandatory(missing);
  }

  function onProceedKey(event) {
    if (!extensionAlive() || !watch.cardId || agentRunning) return;
    if (event.key !== "Enter") return;
    const type = String(event.target?.type || "").toLowerCase();
    if (type !== "submit") return;
    const missing = incompleteMandatoryOnPage();
    if (!missing.length) return;
    stopEvent(event);
    blockForMissingMandatory(missing);
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
    if (!watch.mandatoryAlert) clearRequiredEmptyHighlights();
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
    tip.textContent = `Fill required “${label}” before continuing.`;
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
    if (userAcceptedStep(step)) return;
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

    // Record mismatch once for analytics. Do not re-emit — that would undo a green "done".
    if (!isRepeat) {
      try {
        if (watch.cardId && expectedStr) {
          report({
            cardId: watch.cardId,
            stepId: step.id,
            status: "mismatch",
            reason: `Wrong “${label}” (${step.valueFrom || step.id}): you typed “${actualStr}” — expected “${expectedStr}”. Continue with your value, or Approve to fill the suggested one.`,
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

  function focusGateField() {
    // Focusing or scrolling an untouched question makes sites such as Google
    // Forms mark every later required field red. The user moves themselves.
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
    document.querySelectorAll(".coact-locked-field").forEach((el) => {
      unlockElement(el);
    });
    document.querySelectorAll(".coact-gate-field").forEach((el) => {
      el.classList.remove("coact-gate-field");
    });
    refreshMandatoryEmptyHighlights();
  }

  function matchClickStepForTarget(el) {
    if (!el || !watch.steps.length) return null;
    const clickable =
      (el.closest &&
        el.closest(
          'button, a, [role="button"], [role="link"], [role="tab"], [role="option"], [role="radio"], [role="checkbox"], label, input[type="submit"], input[type="button"], input[type="radio"], input[type="checkbox"], select, [jsaction*="click"]'
        )) ||
      null;

    const gate = watch.steps[actionGateIndex()];
    const lastIdx = lastGatingStepIndex();
    const lastStep = lastIdx >= 0 ? watch.steps[lastIdx] : null;
    const preferId =
      gate?.action === "click"
        ? gate.id
        : lastStep?.action === "click"
          ? lastStep.id
          : "";

    const textOf = (node) =>
      normalize(
        node?.innerText ||
          node?.textContent ||
          node?.value ||
          node?.getAttribute?.("aria-label") ||
          ""
      );

    const byButtonText = (text) => {
      if (!text || (StepMatch.isShortOptionLabel && StepMatch.isShortOptionLabel(text))) return null;
      if (StepMatch.pickClickStepByButtonText) {
        return StepMatch.pickClickStepByButtonText(watch.steps, text, { preferId });
      }
      return null;
    };

    if (clickable) {
      // Button label wins over a nearby question. "Clear form" must not be
      // scored as the previous field just because findByText still says Submit.
      const byText = byButtonText(textOf(clickable));
      if (byText) return byText;

      const byQuestion = matchStepForElement(clickable) || matchStepByNearbyTitle(clickable);
      if (byQuestion) return byQuestion;

      for (const step of watch.steps) {
        if (step.action !== "click") continue;
        const unique = uniqueSelectorHit(step);
        if (unique && (unique === clickable || unique.contains(clickable))) return step;
      }
      return null;
    }

    // Google Forms "Clear form" is often a plain div/span, not a <button>.
    let node = el;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const text = textOf(node);
      if (!text || text.length > 48) continue;
      const byText = byButtonText(text);
      if (byText) return byText;
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
      if (isProceedAttempt(el, clickStep)) {
        const missing = incompleteMandatoryOnPage();
        if (missing.length) {
          stopEvent(event);
          blockForMissingMandatory(missing);
          return;
        }
        acceptFilledStepsOnProceed();
      }
      if (clickStep && userAcceptedStep(clickStep)) {
        completeStepFromUser(clickStep);
        scheduleManualScan(120);
        return;
      }
      if (clickStep) {
        const value =
          fieldValue(el) ||
          String(el.innerText || el.textContent || el.value || "").trim();
        const gateIdx = actionGateIndex();
        const idx = stepIndexOf(clickStep);
        if (idx === gateIdx || isLastGatingStep(clickStep)) {
          if (lastStepCommitTimer) {
            clearTimeout(lastStepCommitTimer);
            lastStepCommitTimer = null;
          }
          completeStepFromUser(clickStep, { value });
        } else if (idx > gateIdx && stepFieldFilled(watch.steps[gateIdx])) {
          completeStepFromUser(watch.steps[gateIdx], {
            value: readStepActualValue(watch.steps[gateIdx]),
          });
        }
        return;
      }
    }

    // Google Forms / custom selects often target inner divs — climb to a real field
    const FIELD_SEL =
      "input, textarea, select, [contenteditable='true'], [role='checkbox'], [role='radio'], [role='option'], [role='combobox'], [role='listbox'], [role='spinbutton'], [role='switch']";
    const target =
      (el.closest && el.closest(FIELD_SEL)) ||
      (el.matches && el.matches(FIELD_SEL) ? el : null);
    if (!target) {
      // Custom widgets may not match the field selector — scan once, not per key.
      if (event.type === "change" || event.type === "input" || event.type === "keyup") {
        scheduleManualScan(80);
      }
      return;
    }

    const step = matchStepForElement(target) || matchStepByNearbyTitle(target);
    if (!step) {
      scheduleManualScan(80);
      return;
    }

    const value = fieldValue(target);
    // Text fields commit when the user leaves them. change/click finish selects and checks.
    const committing =
      event.type === "focusout" ||
      ((event.type === "change" || event.type === "click") && step.action !== "fill");

    if (userAcceptedStep(step)) {
      if (!committing && event.type !== "focusin") return;
      if (!committing) {
        if (watch.lastStatus.get(step.id) !== "done") reportManual(step, "running");
        return;
      }
      completeStepFromUser(step, { value: fieldValue(target) });
      return;
    }

    if (event.type === "focusin") {
      if (watch.lastStatus.get(step.id) !== "done") reportManual(step, "running");
      return;
    }
    if ((step.action === "fill" || step.action === "select") && !committing) {
      if (value && watch.lastStatus.get(step.id) !== "done") {
        reportManual(step, "running");
        if (isLastGatingStep(step)) scheduleLastStepCommit(step, value);
      }
      return;
    }
    if (!value) {
      const prev = watch.lastStatus.get(step.id);
      if (prev === "done") {
        const active = document.activeElement;
        const clearedHere = active === target || Boolean(target.contains?.(active));
        if (!clearedHere || readStepActualValue(step)) return;
      }
      if (step.mandatory && watch.mandatoryAlert) {
        reportManual(step, "missing", {
          fieldPresent: true,
          reason: `Required “${step.label || step.id}” is empty.`,
        });
      } else if (prev !== "done") {
        reportManual(step, "pending", { fieldPresent: true });
      }
      clearWrongHighlight(step);
      lastMismatchKey = "";
      applySequentialLocks();
      return;
    }
    completeStepFromUser(step, { value });
  }

  function matchStepByNearbyTitle(el) {
    const snap = controlSnapshot(el);
    if (StepMatch.pickBestStepForControl) return StepMatch.pickBestStepForControl(watch.steps, snap);
    if (StepMatch.pickBestStepForTitle) return StepMatch.pickBestStepForTitle(watch.steps, snap.title);
    return pickStepByTitleFallback(snap.title);
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
   * Compare a typed value with the live-tracking expected value.
   * No expected list means any non-empty value matches.
   * @returns {{ empty?: boolean, matched: boolean, expected?: string }}
   */
  function fillMatchResult(step, actual) {
    const actualStr = String(actual ?? "").trim();
    if (!actualStr) return { empty: true, matched: true };
    if (watch.agentApproved || userAcceptedStep(step)) return { matched: true };
    if (step?.id != null && watch.agentApprovedValues?.[step.id] != null) {
      const approved = String(watch.agentApprovedValues[step.id] ?? "").trim();
      if (approved && valuesMatch(actualStr, approved)) return { matched: true };
    }
    const list = expectedListForStep(step);
    if (!list.length) return { matched: true };
    if (valuesMatchAny(actualStr, list)) return { matched: true };
    return { matched: false, expected: list[0] };
  }

  /**
   * Fill correctness: any non-empty value completes the step.
   * A value that is not the live-tracking value is still complete, but wrong.
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
    if (userAcceptedStep(step)) return false;
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

  function isLastGatingStep(step) {
    if (!step?.id) return false;
    const last = lastGatingStepIndex();
    return last >= 0 && watch.steps[last]?.id === step.id;
  }

  /** Last step has nothing after it, so finish it once the user is done with it. */
  function scheduleLastStepCommit(step, value) {
    if (!isLastGatingStep(step)) return;
    if (lastStepCommitTimer) clearTimeout(lastStepCommitTimer);
    const stepId = step.id;
    lastStepCommitTimer = setTimeout(() => {
      lastStepCommitTimer = null;
      if (!watch.cardId || watch.lastStatus.get(stepId) === "done") return;
      const current = watch.steps.find((s) => s.id === stepId);
      if (!current || !isLastGatingStep(current)) return;
      const latest = readStepActualValue(current) || value || "";
      if (!String(latest).trim() && current.action !== "click") return;
      completeStepFromUser(current, { value: latest });
    }, 1000);
  }

  function isAtLastGatingStep() {
    const last = lastGatingStepIndex();
    if (last < 0) return false;
    return getGateIndex() >= last;
  }

  /** Red outline only while the user is on the last gating step — check that step only. */
  function highlightWrongValuesIfLastStep() {
    if (!watch.cardId || !watch.steps.length) return;
    const lastPreview = lastGatingStepIndex();
    const lastPreviewStep = lastPreview >= 0 ? watch.steps[lastPreview] : null;
    if (userAcceptedStep(lastPreviewStep)) {
      document.querySelectorAll(".coact-wrong-field").forEach((n) => {
        try {
          n.classList.remove("coact-wrong-field");
        } catch {
          /* ignore */
        }
      });
      return;
    }
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
      if (!result.wrong) {
        lastMismatchKey = "";
        hideSeqTip();
        clearWrongHighlight(step);
      }
      reportManual(step, "done", { force: true, valueMatched: !result.wrong });
      applySequentialLocks();
      return;
    }
    clearWrongHighlight(step);
    reportManual(step, "pending", { force: true });
    applySequentialLocks();
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
    if (scanFieldIndex && step?.id) return scanFieldIndex.get(step.id)?.value || "";
    let el = null;
    try {
      el = resolveElement(step);
    } catch {
      el = null;
    }
    if (el && !elementMatchesStep(el, step) && stepQuestionHints(step).length) {
      el = null;
    }
    if (el && fieldValue(el)) return fieldValue(el);

    const fields = Array.from(
      document.querySelectorAll(
        'input:not([type="hidden"]):not([type="file"]), textarea, select, [contenteditable="true"], [role="checkbox"], [role="radio"], [role="option"], [role="combobox"], [role="listbox"], [role="spinbutton"]'
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

  function stepBeingEdited(step) {
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) return false;
    try {
      const el = resolveElement(step);
      if (el && (el === active || el.contains(active) || active.contains?.(el))) return true;
    } catch {
      /* field not on this page */
    }
    const indexed = scanFieldIndex?.get(step.id)?.field;
    return Boolean(indexed && (indexed === active || indexed.contains?.(active)));
  }

  /** Mark filled, unfocused steps done so the queue card follows the form. */
  function advanceFilledSteps() {
    const steps = watch.steps || [];
    for (const step of steps) {
      if (!step || step.optional || !isGatingAction(step)) continue;
      if (watch.lastStatus.get(step.id) === "done") continue;
      if (step.action === "click" || step.action === "navigate") {
        if (clickStepLooksDone(step)) completeStepFromUser(step);
        continue;
      }
      // Fills and selects wait until the user leaves the field (focusout/change).
      if (step.action === "fill" || step.action === "select") continue;
      if (step.action !== "check") continue;
      if (!stepFindableOnPage(step) && !scanFieldIndex?.has(step.id)) continue;
      if (stepBeingEdited(step)) return;
      const value = readStepActualValue(step);
      if (!value) return;
      const before = watch.lastStatus.get(step.id);
      completeStepFromUser(step, { value });
      if (watch.lastStatus.get(step.id) === before) return;
    }
  }

  /** @deprecated alias — fills no longer require exact SOP match */
  function stepFieldCorrect(step) {
    return stepFieldFilled(step);
  }

  function stepFieldMismatch() {
    return false;
  }

  function beginScanCache() {
    selectorMatchCache = new Map();
    scanUniqueHits = new Map();
    for (const step of watch.steps || []) {
      if (!step?.id || step.action === "highlight" || step.action === "wait") continue;
      const hit = uniqueSelectorHit(step);
      if (hit) scanUniqueHits.set(step.id, hit);
    }
  }

  function endScanCache() {
    selectorMatchCache = null;
    scanUniqueHits = null;
    scanFieldIndex = null;
  }

  function indexFilledSteps() {
    const byId = new Map();
    const fields = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="file"]), textarea, select, [contenteditable="true"], [role="checkbox"], [role="radio"], [role="option"], [role="combobox"], [role="listbox"], [role="spinbutton"], [role="switch"]'
    );
    for (const field of fields) {
      if (!isElementVisible(field)) continue;
      let step = null;
      try {
        step = matchStepForElement(field) || matchStepByNearbyTitle(field);
      } catch {
        step = null;
      }
      if (!step?.id) continue;
      const value = fieldValue(field);
      const prev = byId.get(step.id);
      if (!prev || (value && !prev.value)) byId.set(step.id, { value, field });
    }
    return byId;
  }

  function scheduleManualScan(delay = 80) {
    if (manualScanTimer) return;
    manualScanTimer = setTimeout(() => {
      manualScanTimer = null;
      scanManualProgress();
    }, delay);
  }

  function scanManualProgress({ force = false, repaint = false } = {}) {
    if (!extensionAlive()) return;
    if (!watch.cardId || !watch.steps.length) return;
    if (watch.muteReports && !force) return;
    if (agentRunning && !force) return;

    beginScanCache();
    try {
      scanFieldIndex = indexFilledSteps();
      advanceFilledSteps();
      const gateIdx = actionGateIndex();
      const step = watch.steps[gateIdx];
      if (
        step &&
        watch.mandatoryAlert &&
        isMandatoryFieldStep(step) &&
        !stepFieldFilled(step) &&
        step.action !== "click"
      ) {
        reportManual(step, "missing", {
          force,
          repaint,
          fieldPresent: true,
          reason: `Required “${step.label || step.id}” is empty.`,
        });
      }
      applySequentialLocks();
      highlightWrongValuesIfLastStep();
    } finally {
      endScanCache();
    }
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
    if (valueFlushTimer) {
      clearTimeout(valueFlushTimer);
      valueFlushTimer = null;
      flushPendingReports();
    }
    if (manualScanTimer) {
      clearTimeout(manualScanTimer);
      manualScanTimer = null;
    }
    if (lastStepCommitTimer) {
      clearTimeout(lastStepCommitTimer);
      lastStepCommitTimer = null;
    }
    valueCheckSeq += 1;
    lastMismatchKey = "";
    if (watch.attached) {
      document.removeEventListener("input", onManualFieldEvent, true);
      document.removeEventListener("change", onManualFieldEvent, true);
      document.removeEventListener("focusin", onManualFieldEvent, true);
      document.removeEventListener("click", onManualFieldEvent, true);
      document.removeEventListener("keyup", onManualFieldEvent, true);
      document.removeEventListener("submit", onFormSubmit, true);
      document.removeEventListener("keydown", onProceedKey, true);
      watch.attached = false;
    }
    document.querySelectorAll(".coact-wrong-field").forEach((n) => n.classList.remove("coact-wrong-field"));
    watch.mandatoryAlert = false;
    clearRequiredEmptyHighlights();
    clearSequentialLocks();
    hideSeqTip();
    watch.cardId = null;
    watch.steps = [];
    watch.data = {};
    watch.lastStatus = new Map();
    watch.startHref = "";
  }

  function setNativeValue(el, value) {
    if (!el) return;
    const text = String(value ?? "");
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return;
    }
    if ((el.tagName || "").toLowerCase() === "select") {
      const want = text.trim();
      const opts = Array.from(el.options || []);
      let idx = opts.findIndex(
        (o) => String(o.value) === want || String(o.textContent || "").replace(/\s+/g, " ").trim() === want
      );
      if (idx < 0 && want) {
        const lower = want.toLowerCase();
        idx = opts.findIndex((o) =>
          String(o.textContent || "").replace(/\s+/g, " ").trim().toLowerCase().includes(lower)
        );
      }
      if (idx >= 0) {
        el.selectedIndex = idx;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
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

  function startWatching({
    cardId,
    sop,
    data = null,
    resetProgress = false,
    clearFields = false,
    resetAllProgress = false,
    acceptStepId = "",
    completedStepIds = [],
  }) {
    if (resetAllProgress) {
      progressByCard.clear();
      resetProgress = true;
    }
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
    watch.startHref = location.href;
    if (!(watch.acceptOwnValue instanceof Set) || !sameCard || resetProgress || clearFields) {
      watch.acceptOwnValue = new Set();
    }
    if (acceptStepId) watch.acceptOwnValue.add(acceptStepId);
    watch.data = data && typeof data === "object" ? { ...data } : {};
    // Keep agentApprovedValues when re-watching same card mid-run; clear on fresh watch without them
    if (!watch.agentApproved) {
      watch.agentApprovedValues = {};
    }
    lastMismatchKey = "";
    if (!sameCard || resetProgress || clearFields) watch.mandatoryAlert = false;

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
    if (!(resetProgress || clearFields)) {
      for (const id of completedStepIds || []) {
        if (id) markWatchStatus(id, "done");
      }
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
      document.addEventListener("focusout", onManualFieldEvent, true);
      document.addEventListener("click", onManualFieldEvent, true);
      document.addEventListener("keyup", onManualFieldEvent, true);
      document.addEventListener("submit", onFormSubmit, true);
      document.addEventListener("keydown", onProceedKey, true);
      watch.attached = true;
    }
    if (watch.pollTimer) clearInterval(watch.pollTimer);
    watch.lastReport = new Map();
    watch.pendingReport = new Map();
    watch.pollTimer = setInterval(() => scanManualProgress(), 400);

    if (clearFields) {
      // Fields are empty — force pending in Coact
      scanManualProgress({ force: true, repaint: true });
      setTimeout(() => scanManualProgress({ force: true }), 200);
      return;
    }
    if (resetProgress) {
      // Keep marks cleared until Refresh or the user edits the form
      applySequentialLocks();
      return;
    }
    if (acceptStepId) acceptOwnValueForStep(acceptStepId);
    // Force re-emit so Refresh / re-watch repaints greens even when status unchanged
    scanManualProgress({ force: true, repaint: true });
    setTimeout(() => scanManualProgress({ force: true }), 200);
  }

  function compactSnippetText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function collectVisibleErrors() {
    const seen = new Set();
    const lines = [];
    const push = (value) => {
      const text = compactSnippetText(value);
      if (text.length < 2 || text.length > 280) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      lines.push(`- ${text}`);
    };
    document
      .querySelectorAll(
        '[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"], [aria-invalid="true"], [class*="error"], [class*="invalid"], [class*="toast"], [class*="alert"], .validation-message, .field-error, .invalid-feedback, [data-error]'
      )
      .forEach((el) => {
        push(el.innerText || el.textContent || el.getAttribute("data-error") || "");
      });
    document.querySelectorAll("[aria-errormessage], [aria-describedby]").forEach((el) => {
      const ids = `${el.getAttribute("aria-errormessage") || ""} ${el.getAttribute("aria-describedby") || ""}`;
      ids.split(/\s+/).forEach((id) => {
        if (!id) return;
        const node = document.getElementById(id);
        if (node) push(node.innerText || node.textContent || "");
      });
    });
    document.querySelectorAll("input, textarea, select").forEach((el) => {
      try {
        if (el.validationMessage && el.validity && !el.validity.valid) {
          const lab = compactSnippetText(
            (el.closest("label")?.innerText || el.getAttribute("aria-label") || el.name || el.id || "field").split(
              "\n"
            )[0]
          );
          push(`${lab}: ${el.validationMessage}`);
        }
      } catch {
        /* ignore */
      }
    });
    return lines.slice(0, 12);
  }

  function collectPlainFormLines() {
    const lines = [];
    document
      .querySelectorAll(
        'input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]), textarea, select'
      )
      .forEach((el) => {
        const lab = compactSnippetText(
          (
            el.closest("label")?.innerText ||
            el.getAttribute("aria-label") ||
            el.placeholder ||
            el.name ||
            el.id ||
            "field"
          ).split("\n")[0]
        ).slice(0, 80);
        let val = "";
        const type = String(el.type || "").toLowerCase();
        if (type === "checkbox" || type === "radio") val = el.checked ? "checked" : "";
        else val = compactSnippetText(el.value).slice(0, 120);
        lines.push(`- ${lab || "field"}${val ? ` = ${val}` : ""}`);
      });
    return lines.slice(0, 20);
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
    const errors = collectVisibleErrors();
    if (errors.length) {
      lines.push("Visible errors:");
      lines.push(...errors);
    }
    lines.push("Visible questions:");
    if (blocks.length) {
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
    } else {
      const plain = collectPlainFormLines();
      if (plain.length) lines.push(...plain);
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

  let lastActivitySent = 0;
  function pingUserActivity() {
    if (!extensionAlive()) return;
    if (document.hidden || document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - lastActivitySent < 250) return;
    lastActivitySent = now;
    safeRuntimeSend({
      type: "user_activity",
      url: location.href,
      title: document.title || "",
    });
  }

  const CAPTURE_AGENT = "http://127.0.0.1:17322";
  let captureRecording = false;
  let captureHealthTimer = null;

  function captureSkipPage() {
    const href = String(location.href || "");
    const title = String(document.title || "");
    if (/127\.0\.0\.1:17322|localhost:17322/.test(href)) return true;
    if (/\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(href)) return true;
    if (/cloudhelp|jira-mock/i.test(`${href} ${title}`)) return true;
    return false;
  }

  async function refreshCaptureRecording() {
    const wasRecording = captureRecording;
    try {
      const res = await chrome.runtime.sendMessage({ type: "capture_get_recording" });
      captureRecording = Boolean(res?.recording);
    } catch {
      captureRecording = false;
    }
    if (captureRecording && !wasRecording) snapshotFilledControls();
  }

  let lastCapturePost = null;
  function postCaptureEvent(event) {
    if (captureSkipPage() || tornDown || !event || !captureRecording) return;
    const sig = `${event.action}|${event.fieldName}|${event.label}|${event.value}|${event.selector}`;
    const now = Date.now();
    if (lastCapturePost && lastCapturePost.sig === sig && now - lastCapturePost.at < 100) return;
    lastCapturePost = { sig, at: now };
    safeRuntimeSend({ type: "capture_event", event });
  }

  window.__ltFieldInventory = window.__ltFieldInventory || new Map();

  function captureNormalizeText(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function captureLooksLikeOptionOnly(text) {
    const t = captureNormalizeText(text);
    if (!t || t.length > 48) return false;
    return /^(yes|no|y|n|true|false|on|off)$/i.test(t);
  }

  function captureLooksLikePlaceholderValue(text) {
    const t = captureNormalizeText(text).toLowerCase();
    if (!t) return false;
    return /^(select one|select an option|select\.\.\.|select…|please select( one)?|choose one|choose an option|-\s*select\s*-|--\s*select\s*--)$/.test(
      t,
    );
  }

  function captureLooksLikeOpaqueToken(value) {
    const s = captureNormalizeText(value);
    if (!s) return false;
    if (/^[a-f0-9]{20,}$/i.test(s.replace(/-/g, ""))) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
      return true;
    }
    return false;
  }

  function captureLooksLikeChoiceValue(text) {
    const t = captureNormalizeText(text);
    if (!t || t.length > 64) return false;
    if (captureLooksLikeOptionOnly(t)) return true;
    if (captureLooksLikeOpaqueToken(t)) return false;
    if (captureLooksLikePlaceholderValue(t)) return false;
    if (/[?]/.test(t)) return false;
    if (isNavigationClickLabel(t)) return false;
    if (t.length <= 40 && !/\.\s/.test(t) && /^[\w .,'\-+/&()]+$/i.test(t)) return true;
    return false;
  }

  function isNavigationClickLabel(text) {
    const t = captureNormalizeText(text);
    if (!t || t.length > 48) return false;
    return /^(save and continue|save & continue|submit|next|continue|back|previous|cancel|apply|add another|add|sign in|search|upload|remove|edit|delete)$/i.test(
      t,
    );
  }

  function isNavigationSelector(selector) {
    return /pageFooterNextButton|add-button|signInSubmitButton|bottom-navigation|wizardNext|continueButton/i.test(
      String(selector || ""),
    );
  }

  function captureLooksLikeWidgetChrome(text) {
    const t = captureNormalizeText(text);
    if (!t) return false;
    if (/^react-select-\d+/i.test(t)) return true;
    if (/react-select-\d+-(listbox|input|option|live-region|placeholder)/i.test(t)) return true;
    if (/use up and down to choose/i.test(t)) return true;
    if (/press enter to select/i.test(t) && /press (escape|tab)/i.test(t)) return true;
    if (/press tab to select the option/i.test(t)) return true;
    if (/check all that apply|select all that apply|choose all that apply/i.test(t)) return true;
    if (/^\([^)]*\)$/.test(t)) return true;
    return false;
  }

  function captureLooksLikeJunkFieldKey(text) {
    const t = captureNormalizeText(text);
    if (!t) return true;
    if (captureLooksLikeWidgetChrome(t)) return true;
    if (captureLooksLikeOpaqueToken(t)) return true;
    if (/^(input|select|textarea|field|button|div|span)$/i.test(t)) return true;
    if (/^#?(primaryQuestionnaire--|wd-|ember\d)/i.test(t)) return true;
    if (/^primaryQuestionnaire--/i.test(t)) return true;
    // Generic test-automation ids some sites assign in place of real names
    // ("select-one", "input-two", "field3", bare "one"/"two", ...) — never a
    // real question, so never worth showing as a field's name.
    if (
      /^(select|input|field|option|choice|dropdown|radio|checkbox|text|textbox|combo|combobox)[-_]?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,3})([-_]?\d{1,3})?$/i.test(
        t,
      )
    ) {
      return true;
    }
    if (/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)([-_]?\d{1,3})?$/i.test(t)) return true;
    // Long unbroken alphanumeric blobs with several embedded digit groups look
    // like concatenated codes (e.g. a checkbox group's id built by joining
    // each option's short code, "s6s7s63s65s66s24no"), not a real word.
    if (!/[\s_-]/.test(t) && t.length > 12 && (t.match(/\d+/g) || []).length >= 2) return true;
    if (/__/.test(t) && (t.match(/[_-]/g) || []).length >= 2) return true;
    if (/^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(t)) return true;
    return false;
  }

  function captureIsUsefulQuestionLabel(text, optionText) {
    const t = captureNormalizeText(text);
    if (!t || t.length < 3 || t.length > 240) return false;
    if (captureLooksLikeOptionOnly(t)) return false;
    if (captureLooksLikeJunkFieldKey(t)) return false;
    const opt = captureNormalizeText(optionText).toLowerCase();
    if (opt && t.toLowerCase() === opt) return false;
    if (
      /\?|\*|required|months|agency|consideration|employee|authorized|experience|relocat|citizen|sponsor|visa|gender|disability|veteran|race|ethnicity/i.test(
        t,
      )
    ) {
      return true;
    }
    if (t.length >= 12) return true;
    const bare = t.replace(/[*:\s]+$/g, "");
    if (bare.length >= 4 && /^[A-Za-z][A-Za-z0-9 /,'&\-().]+$/.test(bare) && !/questionnaire/i.test(bare)) {
      return true;
    }
    return false;
  }

  function capturePickQuestionCandidate(candidates, optionText) {
    const opt = captureNormalizeText(optionText).toLowerCase();
    const cleaned = [];
    for (const raw of candidates || []) {
      let t = captureNormalizeText(raw);
      if (!t) continue;
      if (opt) t = t.replace(new RegExp(`\\b${opt}\\b`, "ig"), "").replace(/\s+/g, " ").trim();
      t = t.replace(/\b(yes|no)\b/gi, "").replace(/\s+/g, " ").trim();
      t = t.split("\n")[0].trim();
      if (!captureIsUsefulQuestionLabel(t, optionText)) continue;
      cleaned.push(t);
    }
    if (!cleaned.length) return "";
    const withQ = cleaned.filter((t) => t.includes("?"));
    const pool = withQ.length ? withQ : cleaned;
    pool.sort((a, b) => {
      const score = (t) => (t.includes("?") ? 1000 : 0) + Math.min(t.length, 180);
      return score(b) - score(a);
    });
    return pool[0].slice(0, 240);
  }

  function captureParseOptionAriaQuestion(ariaLabel, optionText) {
    const aria = captureNormalizeText(ariaLabel);
    if (!aria || aria.length < 8) return "";
    const patterns = [
      /^(?:select\s+)?(?:yes|no)\s+for\s+(.+)$/i,
      /^(?:yes|no)[,:\s\-–—]+(.+)$/i,
      /^(?:option\s+)?(?:yes|no)\s*[-–—:]\s*(.+)$/i,
      /^(?:select\s+)?(.{1,40}?)\s+for\s+(.+)$/i,
    ];
    for (const re of patterns) {
      const m = aria.match(re);
      if (!m) continue;
      const q = m[2] || m[1];
      if (captureIsUsefulQuestionLabel(q, optionText)) {
        return captureNormalizeText(q).slice(0, 240);
      }
    }
    if (!captureLooksLikeOptionOnly(aria) && captureIsUsefulQuestionLabel(aria, optionText)) {
      return aria.slice(0, 240);
    }
    return "";
  }


  function captureQuestionFromContainer(container, optionText) {
    if (!container) return "";
    const opt = captureNormalizeText(optionText).toLowerCase();
    const preferNodes = container.querySelectorAll?.(
      '[data-automation-id*="label"], [data-automation-id*="Label"], [data-automation-id*="question"], [data-automation-id*="Question"], [data-automation-id*="richText"], legend, [role="heading"], h1, h2, h3, h4, label, abbr, p, span',
    );
    const candidates = [];
    preferNodes?.forEach?.((n) => {
      candidates.push(n.textContent || "");
    });
    container.querySelectorAll?.("legend, label, [role='heading'], h1, h2, h3, h4, p, span, div").forEach((n) => {
      if (n.closest?.("button, a, input, select, textarea, [role='radio'], [role='checkbox']")) {
        /* still allow; pickQuestion filters Yes/No */
      }
      candidates.push(n.textContent || "");
    });
    const picked = capturePickQuestionCandidate(candidates, optionText);
    if (picked) return picked;

    let blob = captureNormalizeText(container.textContent || "");
    if (opt) blob = blob.replace(new RegExp(`\\b${opt}\\b`, "ig"), "").replace(/\s+/g, " ").trim();
    blob = blob.replace(/\b(yes|no)\b/gi, "").replace(/\s+/g, " ").trim();
    const qMatch = blob.match(/([^?]{8,200}\?)/);
    if (qMatch && captureIsUsefulQuestionLabel(qMatch[1], optionText)) {
      return captureNormalizeText(qMatch[1]);
    }
    if (blob.length >= 12 && blob.length <= 240 && captureIsUsefulQuestionLabel(blob, optionText)) {
      return blob.split("\n")[0].trim();
    }
    return "";
  }

  /** Visible caption above a control. Skips sibling options and widget chrome. */
  function captureCaptionAbove(el, optionText) {
    if (!el) return "";
    const own = captureNormalizeText(el.getAttribute?.("name") || el.name || el.id || "").toLowerCase();
    let node = el;
    for (let depth = 0; depth < 9 && node; depth += 1) {
      let sib = node.previousElementSibling;
      for (let i = 0; i < 6 && sib; i += 1) {
        const hasControl = sib.querySelector?.(
          "input, textarea, select, [role='listbox'], [role='option'], [role='radio'], [role='checkbox']",
        );
        const text = captureNormalizeText(sib.innerText || sib.textContent || "").split("\n")[0].trim();
        if (
          !hasControl &&
          text &&
          text.length <= 240 &&
          text.toLowerCase() !== own &&
          !captureLooksLikeWidgetChrome(text) &&
          captureIsUsefulQuestionLabel(text, optionText)
        ) {
          return text.replace(/[*:\s]+$/g, "").trim();
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  }

  function captureQuestionNear(el, optionText) {
    if (!el) return "";
    const ariaQ = captureParseOptionAriaQuestion(
      el.getAttribute?.("aria-label") || el.getAttribute?.("title") || "",
      optionText,
    );
    if (ariaQ) return ariaQ;

    let node = el;
    for (let depth = 0; depth < 8 && node; depth += 1) {
      let sib = node.previousElementSibling;
      for (let i = 0; i < 5 && sib; i += 1) {
        const fromSib = captureQuestionFromContainer(sib, optionText);
        if (fromSib) return fromSib;
        const rich = sib.querySelector?.(
          '[data-automation-id*="richText"], [data-automation-id*="label"], [data-automation-id*="Label"], [data-automation-id*="question"], legend, label, p, [role="heading"], h1, h2, h3, h4',
        );
        if (rich) {
          const t = captureNormalizeText(rich.textContent || "");
          if (captureIsUsefulQuestionLabel(t, optionText)) return t.split("\n")[0].trim();
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  }

  function captureWorkdayQuestion(el, optionText) {
    if (!el) return "";
    let node = el;
    for (let depth = 0; depth < 16 && node; depth += 1) {
      const auto = String(node.getAttribute?.("data-automation-id") || "");
      const role = String(node.getAttribute?.("role") || "");
      if (
        /formField|questionPanel|questionnaire|multiSelect|dropDown|selectOne|formField-/i.test(auto) ||
        role === "group" ||
        role === "radiogroup"
      ) {
        const rich = [];
        node
          .querySelectorAll?.(
            '[data-automation-id*="richText"], [data-automation-id*="label"], [data-automation-id*="Label"], [data-automation-id*="question"], legend, [role="heading"], label',
          )
          ?.forEach?.((n) => {
            rich.push(n.textContent || "");
          });
        const picked = capturePickQuestionCandidate(rich, optionText);
        if (picked) return picked;
        const from = captureQuestionFromContainer(node, optionText);
        if (from) return from;
        const lb = node.getAttribute?.("aria-labelledby");
        if (lb) {
          const parts = String(lb)
            .split(/\s+/)
            .map((id) => captureNormalizeText(document.getElementById(id)?.textContent || ""));
          const fromLb = capturePickQuestionCandidate(parts, optionText);
          if (fromLb) return fromLb;
        }
      }
      node = node.parentElement;
    }
    return "";
  }

  function captureQuestionLabel(el, optionText) {
    if (!el) return "";
    const wd = captureWorkdayQuestion(el, optionText);
    if (wd) return wd;
    const group =
      el.closest?.(
        '[role="radiogroup"], [role="group"], fieldset, [data-automation-id*="formField"], [data-automation-id*="question"], [data-automation-id*="questionnaire"], .WDGO, [class*="formField"]',
      ) || null;
    const fromGroup = captureQuestionFromContainer(group, optionText);
    if (fromGroup) return fromGroup;
    if (group) {
      const lb = group.getAttribute?.("aria-labelledby");
      if (lb) {
        const parts = String(lb)
          .split(/\s+/)
          .map((id) => captureNormalizeText(document.getElementById(id)?.textContent || ""));
        const picked = capturePickQuestionCandidate(parts, optionText);
        if (picked) return picked;
      }
    }

    const near = captureQuestionNear(el, optionText);
    if (near) return near;

    let node = el.parentElement;
    for (let i = 0; i < 14 && node; i += 1) {
      const t = captureQuestionFromContainer(node, optionText);
      if (t) return t;
      node = node.parentElement;
    }

    const labelledBy = el.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      const parts = String(labelledBy)
        .split(/\s+/)
        .map((id) => captureNormalizeText(document.getElementById(id)?.textContent || ""))
        .filter((t) => t && !captureLooksLikeOptionOnly(t));
      const picked = capturePickQuestionCandidate(parts, optionText);
      if (picked) return picked;
    }
    return "";
  }

  function captureHostLabel(node) {
    if (!node || node.nodeType !== 1) return "";
    const raw = node.getAttribute?.("label") || (typeof node.label === "string" ? node.label : "");
    const t = captureNormalizeText(String(raw || ""));
    if (!t || captureLooksLikeJunkFieldKey(t) || captureLooksLikeOptionOnly(t)) return "";
    return t.split("\n")[0].trim().slice(0, 180);
  }

  function captureIdIsUnique(id) {
    if (!id) return false;
    try {
      return document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length === 1;
    } catch {
      return false;
    }
  }

  function captureControlHost(el) {
    try {
      const host = el?.getRootNode?.()?.host;
      if (host && host.nodeType === 1) return host;
    } catch {
      /* ignore */
    }
    return null;
  }

  function captureFieldLabel(el) {
    if (!el) return "";
    const host = captureControlHost(el);
    const hostLabel = captureHostLabel(host) || captureHostLabel(el);
    if (hostLabel) return hostLabel;
    const labelTarget = host?.id && captureIdIsUnique(host.id) ? host : el.id && captureIdIsUnique(el.id) ? el : null;
    if (labelTarget?.id) {
      try {
        const byFor = document.querySelector(`label[for="${CSS.escape(labelTarget.id)}"]`);
        const t = captureNormalizeText(byFor?.textContent || "");
        if (t && !captureLooksLikeOptionOnly(t) && !captureLooksLikeJunkFieldKey(t)) {
          return t.split("\n")[0].trim();
        }
      } catch {
        /* ignore */
      }
    }
    const aria = captureNormalizeText(el.getAttribute("aria-label") || "");
    const ariaQ = captureParseOptionAriaQuestion(aria, "");
    if (ariaQ) return ariaQ;
    if (aria && !captureLooksLikeOptionOnly(aria) && !captureLooksLikeJunkFieldKey(aria)) return aria;
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const ref = document.getElementById(labelledBy);
      const t = captureNormalizeText(ref?.textContent || "");
      if (t && !captureLooksLikeOptionOnly(t) && !captureLooksLikeJunkFieldKey(t)) return t;
    }
    const wrap = el.closest("label");
    if (wrap) {
      const clone = wrap.cloneNode(true);
      clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
      const t = captureNormalizeText(clone.textContent || "");
      if (t && t.length <= 180 && !captureLooksLikeOptionOnly(t) && !captureLooksLikeJunkFieldKey(t)) {
        return t.split("\n")[0].trim();
      }
    }
    const question = captureQuestionLabel(el, "");
    if (question) return question;
    const section = el.closest("section, fieldset, [role='group'], [role='radiogroup'], .section, .options");
    const heading = section?.querySelector?.("h1, h2, h3, legend, [role='heading']");
    if (heading) {
      const t = captureNormalizeText(heading.textContent || "");
      if (t && !captureLooksLikeJunkFieldKey(t)) return t;
    }
    let node = (captureControlHost(el) || el).previousElementSibling;
    let hops = 0;
    while (node && hops < 3) {
      const t = captureNormalizeText(node.textContent || "");
      if (t && t.length < 120 && !captureLooksLikeOptionOnly(t) && !captureLooksLikeJunkFieldKey(t)) {
        return t;
      }
      node = node.previousElementSibling;
      hops += 1;
    }
    const fallback = captureNormalizeText(el.placeholder || el.name || el.id || "");
    return captureLooksLikeJunkFieldKey(fallback) ? "" : fallback;
  }

  function captureSelectorFor(el) {
    if (!el) return "";
    const host = captureControlHost(el);
    if (el.id && captureIdIsUnique(el.id)) return `#${el.id}`;
    if (host?.id && captureIdIsUnique(host.id)) return `#${host.id}`;
    const auto = el.getAttribute?.("data-automation-id") || host?.getAttribute?.("data-automation-id");
    if (auto) return `[data-automation-id="${auto}"]`;
    if (el.name) return `[name="${el.name}"]`;
    const tag = (el.tagName || "").toLowerCase();
    const type = String(el.getAttribute("type") || "").toLowerCase();
    if (type) return `${tag}[type="${type}"]`;
    return tag;
  }

  function inventoryKeysFor(el) {
    const keys = [];
    if (!el) return keys;
    if (el.id && captureIdIsUnique(el.id)) keys.push(`id:${el.id}`);
    const auto = el.getAttribute?.("data-automation-id");
    if (auto) keys.push(`auto:${auto}`);
    if (el.name) keys.push(`name:${el.name}`);
    const sel = captureSelectorFor(el);
    if (sel) keys.push(`sel:${sel}`);
    const group =
      el.closest?.(
        '[role="radiogroup"], [role="group"], fieldset, [data-automation-id*="formField"], [data-automation-id*="question"], [data-automation-id*="questionnaire"]',
      ) || null;
    if (group) {
      const gid =
        group.id ||
        group.getAttribute?.("data-automation-id") ||
        group.getAttribute?.("aria-labelledby") ||
        "";
      if (gid) keys.push(`group:${gid}`);
    }
    return keys;
  }

  function rememberField(el, label, kind) {
    const question = captureNormalizeText(label);
    if (!question || !captureIsUsefulQuestionLabel(question, "")) return;
    if (captureLooksLikeJunkFieldKey(question)) return;
    const entry = {
      fieldKey: question,
      label: question,
      selector: captureSelectorFor(el),
      kind: kind || "field",
    };
    const map = window.__ltFieldInventory;
    for (const k of inventoryKeysFor(el)) {
      map.set(k, entry);
    }
  }

  function lookupInventory(el) {
    const map = window.__ltFieldInventory;
    if (!map || !el) return "";
    const keys = inventoryKeysFor(el);
    const ordered = [
      ...keys.filter((k) => k.startsWith("name:")),
      ...keys.filter((k) => !k.startsWith("name:") && !k.startsWith("group:")),
    ];
    for (const k of ordered) {
      const hit = map.get(k);
      if (hit?.label && captureIsUsefulQuestionLabel(hit.label, "")) return hit.label;
    }
    return "";
  }

  function resolveFieldQuestion(el, optionHint) {
    const caption = captureCaptionAbove(el, optionHint);
    const own = captureNormalizeText(el?.getAttribute?.("name") || el?.name || el?.id || "");
    if (caption && (/[?*]/.test(caption) || caption.length >= 8) && !captureLooksLikeWidgetChrome(caption)) {
      return caption;
    }
    const inventoried = lookupInventory(el);
    if (
      inventoried &&
      inventoried.toLowerCase() !== own.toLowerCase() &&
      !captureLooksLikeWidgetChrome(inventoried)
    ) {
      return inventoried;
    }
    if (caption && !captureLooksLikeWidgetChrome(caption)) return caption;
    const live = captureQuestionLabel(el, optionHint) || captureFieldLabel(el);
    if (
      live &&
      live.toLowerCase() !== own.toLowerCase() &&
      !captureLooksLikeWidgetChrome(live) &&
      captureIsUsefulQuestionLabel(live, optionHint)
    ) {
      return live;
    }
    if (inventoried && !captureLooksLikeWidgetChrome(inventoried)) return inventoried;
    return "";
  }

  function scanPageFieldInventory() {
    if (captureSkipPage() || !document?.querySelectorAll) return 0;
    let n = 0;
    const groupSel =
      '[role="radiogroup"], [role="group"], fieldset, [data-automation-id*="formField"], [data-automation-id*="question"], [data-automation-id*="questionnaire"], .WDGO, [class*="formField"]';
    document.querySelectorAll(groupSel).forEach((group) => {
      const question =
        captureQuestionFromContainer(group, "") ||
        captureQuestionNear(group, "") ||
        captureNormalizeText(
          group.getAttribute?.("aria-label") ||
            document.getElementById(group.getAttribute?.("aria-labelledby") || "")?.textContent ||
            "",
        );
      if (!question || !captureIsUsefulQuestionLabel(question, "")) return;
      const ctrls = group.querySelectorAll?.(
        'input:not([type="hidden"]):not([type="password"]), textarea, select, button, [role="radio"], [role="checkbox"], [role="button"], [data-automation-id*="primaryQuestionnaire"], [data-automation-id*="option"]',
      );
      for (const ctrl of ctrls || []) {
        rememberField(ctrl, question, "choice");
        n += 1;
      }
    });

    const controlSel =
      'input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"]';
    document.querySelectorAll(controlSel).forEach((el) => {
      if (lookupInventory(el)) return;
      const type = String(el.getAttribute?.("type") || "").toLowerCase();
      if (type === "radio" || type === "checkbox") {
        const q = resolveFieldQuestion(el, "");
        if (q) {
          rememberField(el, q, "choice");
          n += 1;
        }
        return;
      }
      const label = resolveFieldQuestion(el, "") || captureFieldLabel(el);
      if (label && captureIsUsefulQuestionLabel(label, "")) {
        rememberField(el, label, "field");
        n += 1;
      }
    });

    // Workday-style option widgets that are not classic inputs
    document
      .querySelectorAll?.(
        '[data-automation-id*="primaryQuestionnaire"], [role="radio"], [role="checkbox"], button[aria-label], [role="button"][aria-label]',
      )
      ?.forEach?.((el) => {
        if (lookupInventory(el)) return;
        const optionHint = captureNormalizeText(el.innerText || el.getAttribute("aria-label") || "").slice(0, 48);
        const q = resolveFieldQuestion(el, optionHint);
        if (q) {
          rememberField(el, q, "choice");
          n += 1;
        }
      });

    return n;
  }

  function scheduleFieldInventory() {
    if (window.__ltInvTimer) clearTimeout(window.__ltInvTimer);
    window.__ltInvTimer = setTimeout(() => {
      try {
        scanPageFieldInventory();
      } catch {
        /* ignore */
      }
    }, 200);
  }

  function setupFieldInventoryObservers() {
    if (window.__ltInvObserversReady) return;
    window.__ltInvObserversReady = true;
    try {
      const mo = new MutationObserver(() => scheduleFieldInventory());
      mo.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
      window.__ltFieldInventoryObserver = mo;
    } catch {
      /* ignore */
    }
    window.addEventListener("popstate", scheduleFieldInventory);
    window.addEventListener("hashchange", scheduleFieldInventory);
    try {
      const wrap = (fn) =>
        function patchedHistory() {
          const ret = fn.apply(this, arguments);
          scheduleFieldInventory();
          return ret;
        };
      history.pushState = wrap(history.pushState.bind(history));
      history.replaceState = wrap(history.replaceState.bind(history));
    } catch {
      /* ignore */
    }
    scheduleFieldInventory();
  }

  window.__ltScanFieldInventory = scanPageFieldInventory;
  window.__ltLookupFieldInventory = lookupInventory;

  function captureLooksLikeGeneratedId(id) {
    const s = String(id || "").trim();
    if (!s || s.length < 2) return true;
    if (/^(ember\d+|react-select-|mui-|:r[0-9a-z]+:|headlessui-)/i.test(s)) return true;
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s)) return true;
    if (/^[a-f0-9]{16,}$/i.test(s)) return true;
    if (/^\d+$/.test(s)) return true;
    return false;
  }

  function captureCssAttr(name, value) {
    const v = String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `[${name}="${v}"]`;
  }

  function captureGuiId(el) {
    if (!el || el.nodeType !== 1) return "";
    const host = captureControlHost(el);
    const inner = el.matches?.("input, select, textarea, [role='radio'], [role='checkbox'], [role='combobox']")
      ? null
      : el.querySelector?.("input, select, textarea, [role='radio'], [role='checkbox']");
    const nodes = [inner, el, host].filter((node) => node && node.nodeType === 1);
    for (const node of nodes) {
      const id = String(node.id || "").trim();
      if (
        id &&
        !captureLooksLikeGeneratedId(id) &&
        !captureLooksLikeJunkFieldKey(id) &&
        captureIdIsUnique(id)
      ) {
        const ident = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
        return `#${ident}`;
      }
    }
    for (const node of nodes) {
      const testid = node.getAttribute?.("data-testid") || node.getAttribute?.("data-test") || "";
      if (testid && !captureLooksLikeGeneratedId(testid)) {
        return captureCssAttr(node.getAttribute?.("data-testid") ? "data-testid" : "data-test", testid);
      }
    }
    for (const node of nodes) {
      const auto = node.getAttribute?.("data-automation-id") || "";
      if (auto && !captureLooksLikeJunkFieldKey(auto) && !captureLooksLikeGeneratedId(auto)) {
        return captureCssAttr("data-automation-id", auto);
      }
    }
    for (const node of nodes) {
      const name = String(node.getAttribute?.("name") || node.name || "").trim();
      if (name && !captureLooksLikeJunkFieldKey(name) && !captureLooksLikeGeneratedId(name)) {
        return captureCssAttr("name", name);
      }
    }
    return "";
  }

  function captureFinderTag(liveName, websiteLabel) {
    const site = captureNormalizeText(websiteLabel).replace(/[*:\s]+$/g, "").trim();
    const live = captureNormalizeText(liveName);
    if (!site || !live) return "";
    if (captureLooksLikeOptionOnly(site) || captureLooksLikeJunkFieldKey(site)) return "";
    const compact = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!compact(site) || compact(site) === compact(live)) return "";
    return site;
  }

  function captureOwnFieldName(el) {
    const name = captureNormalizeText(el?.name || "");
    if (name && !captureLooksLikeJunkFieldKey(name)) {
      const bare = name.replace(/[*:\s]+$/g, "");
      if (bare.length >= 2 && !captureLooksLikeOpaqueToken(bare)) return name;
    }
    const type = String(el?.getAttribute?.("type") || "").toLowerCase();
    if (type === "tel") return "Phone";
    if (type === "email") return "Email";
    return "";
  }

  function captureDescribe(el, action, labelHint) {
    if (!el || el.nodeType !== 1) return null;
    const tag = (el.tagName || "").toLowerCase();
    const type = (el.getAttribute("type") || tag).toLowerCase();
    const role = String(el.getAttribute("role") || "").toLowerCase();
    const customEl = tag.includes("-");
    if (type === "password" || type === "hidden") return null;
    if (el.readOnly && !customEl && type !== "radio" && type !== "checkbox" && tag !== "select" && type !== "tel") return null;
    if (el.disabled && type !== "radio" && type !== "checkbox") return null;

    let value = el.value != null ? String(el.value) : "";
    if (el.isContentEditable) value = String(el.textContent || "").trim();
    if (value.length > 200) value = value.slice(0, 200);
    let selectedText = "";

    if (role === "listbox" && captureLooksLikeWidgetChrome(el.id || el.getAttribute?.("aria-label") || "")) return null;
    if (tag === "select" || role === "listbox" || role === "combobox") {
      action = "select";
      const opt = el.selectedOptions && el.selectedOptions[0];
      selectedText = opt ? captureNormalizeText(opt.textContent || "") : "";
      // A chosen option with no visible text is not a real human-facing
      // selection — often a hidden native <select> Workday syncs behind its
      // custom combobox purely for form submission, whose placeholder option
      // has an empty label and a raw sentinel value (e.g. value="0"). Falling
      // back to that raw value would report the sentinel as if it were the
      // user's answer, so skip entirely rather than guess from opt.value.
      if (!selectedText) return null;
      value = selectedText;
      // Still on the unselected placeholder option — nothing was actually chosen.
      if (captureLooksLikePlaceholderValue(selectedText) || captureLooksLikeWidgetChrome(selectedText)) return null;
    } else if (type === "checkbox" || type === "radio" || role === "checkbox" || role === "radio") {
      action = "check";
      const on =
        type === "checkbox" || type === "radio"
          ? Boolean(el.checked)
          : el.getAttribute("aria-checked") === "true";
      if (!on) return null;
      const lab = el.closest("label");
      const strong = lab?.querySelector?.("strong");
      selectedText = captureNormalizeText(
        (strong && strong.textContent) ||
          el.getAttribute("aria-label") ||
          (lab &&
            (() => {
              const clone = lab.cloneNode(true);
              clone.querySelectorAll("input, select, textarea").forEach((n) => n.remove());
              return clone.textContent;
            })()) ||
          "",
      );
      if (!captureLooksLikeOptionOnly(selectedText)) {
        const short =
          captureNormalizeText(el.value) ||
          captureNormalizeText(el.getAttribute("data-automation-label") || "") ||
          "";
        if (captureLooksLikeOptionOnly(short)) selectedText = short;
        else {
          const ariaQ = captureParseOptionAriaQuestion(selectedText, "");
          if (ariaQ) {
            /* selectedText was full aria — keep option short if possible */
            const optOnly = captureLooksLikeOptionOnly(
              captureNormalizeText(el.value || el.getAttribute("data-automation-label") || ""),
            )
              ? captureNormalizeText(el.value || el.getAttribute("data-automation-label") || "")
              : "";
            if (optOnly) selectedText = optOnly;
          }
        }
      }
      if (captureLooksLikeOpaqueToken(selectedText)) selectedText = "";
      if (/^(true|false|on|off)$/i.test(selectedText)) {
        const visible = captureNormalizeText(String(el.innerText || el.textContent || "").split("\n")[0]);
        if (visible && visible.length <= 48 && !/[?]/.test(visible) && !/^(true|false|on|off)$/i.test(visible)) {
          selectedText = visible;
        }
      }
      if (!selectedText) selectedText = "true";
      value = selectedText;
    }

    if (
      (action === "input" || action === "change" || action === "fill") &&
      captureLooksLikeOpaqueToken(value) &&
      (/^(input|text)?$/i.test(String(el.name || el.id || "input")) ||
        captureLooksLikeJunkFieldKey(el.name || el.id || ""))
    ) {
      return null;
    }

    const optionHint = selectedText || value;
    const ownName = captureOwnFieldName(el);
    const hint = captureHostLabel(el) || captureNormalizeText(labelHint || "");
    const visibleQuestion = (function captureVisibleQuestion() {
      const caption = captureCaptionAbove(el, optionHint);
      if (caption && captureIsUsefulQuestionLabel(caption, optionHint) && !captureLooksLikeWidgetChrome(caption)) {
        return caption;
      }
      const live = captureQuestionLabel(el, optionHint) || captureFieldLabel(el);
      if (
        live &&
        live.toLowerCase() !== captureNormalizeText(el.name || el.id || "").toLowerCase() &&
        captureIsUsefulQuestionLabel(live, optionHint) &&
        !captureLooksLikeOptionOnly(live) &&
        !captureLooksLikeWidgetChrome(live)
      ) {
        return live;
      }
      if (hint && captureIsUsefulQuestionLabel(hint, optionHint) && !captureLooksLikeOptionOnly(hint)) {
        return hint;
      }
      return "";
    })();
    const question =
      (visibleQuestion && captureIsUsefulQuestionLabel(visibleQuestion, optionHint) ? visibleQuestion : "") ||
      ownName ||
      (hint && captureIsUsefulQuestionLabel(hint, optionHint) ? hint : "");
    const label = question || captureFieldLabel(el) || hint;
    let fieldName = String(
      (question && !captureLooksLikeOptionOnly(question) ? question : "") ||
        (label && !captureLooksLikeJunkFieldKey(label) ? label : "") ||
        (!captureLooksLikeJunkFieldKey(el.name || "") ? el.name : "") ||
        (!captureLooksLikeJunkFieldKey(el.id || "") ? el.id : "") ||
        "",
    ).trim();
    if (captureLooksLikeJunkFieldKey(fieldName)) fieldName = question || label || "";
    if (!value && action !== "check") return null;
    if (!fieldName && !label) return null;
    if (question && captureIsUsefulQuestionLabel(question, optionHint)) {
      rememberField(el, question, action === "check" || action === "select" ? "choice" : "field");
    }
    const shown =
      (question && !captureLooksLikeOptionOnly(question) ? question : "") || label || fieldName;
    const finder = captureFinderTag(shown, visibleQuestion);
    const guiId = captureGuiId(el);
    return {
      kind: "extension",
      source: "human",
      actor: "user",
      action,
      pageUrl: location.href,
      pageTitle: document.title || "",
      tag: tag || role || "field",
      selector: guiId || captureSelectorFor(el),
      ...(guiId ? { guiId } : {}),
      fieldName: fieldName || label,
      fieldId: el.id || "",
      label: shown,
      ...(finder ? { finder } : {}),
      value,
      selectedText,
      elementRect: captureElementRect(el),
    };
  }

  function captureElementRect(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return null;
    const r = el.getBoundingClientRect();
    if (!r || (r.width < 2 && r.height < 2)) return null;
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      dpr: window.devicePixelRatio || 1,
    };
  }

  const CAPTURE_TEXT_SEL =
    'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select, [contenteditable="true"]';
  const CAPTURE_WIDGET_SEL =
    "[role='checkbox'], [role='radio'], [role='combobox'], [role='listbox'], [role='option']";

  function captureCustomHost(event, el) {
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (String(node?.tagName || "").includes("-")) return node;
    }
    try {
      const parent = el?.getRootNode?.()?.host;
      if (parent && String(parent.tagName || "").includes("-")) return parent;
    } catch {
      /* ignore */
    }
    if (String(el?.tagName || "").includes("-")) return el;
    return null;
  }

  function captureControlFromEvent(event, includeWidgets) {
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    const hostTarget = event?.target && event.target.nodeType === 1 ? event.target : null;
    let inner = null;
    for (const node of path) {
      if (node?.matches?.(CAPTURE_TEXT_SEL) || (includeWidgets && node?.matches?.(CAPTURE_WIDGET_SEL))) {
        inner = node;
        break;
      }
    }
    if (!inner && hostTarget?.matches?.(CAPTURE_TEXT_SEL)) inner = hostTarget;
    if (!inner && includeWidgets && hostTarget?.matches?.(CAPTURE_WIDGET_SEL)) inner = hostTarget;
    if (!inner && hostTarget?.shadowRoot) {
      try {
        inner = hostTarget.shadowRoot.querySelector(includeWidgets ? `${CAPTURE_TEXT_SEL}, ${CAPTURE_WIDGET_SEL}` : CAPTURE_TEXT_SEL);
      } catch {
        /* ignore */
      }
    }
    const custom = captureCustomHost(event, inner || hostTarget);
    const innerValue = inner && inner.value != null && typeof inner.value !== "object" ? String(inner.value).trim() : "";
    const hostValue =
      custom && custom.value != null && typeof custom.value !== "object" ? String(custom.value).trim() : "";
    if (custom && hostValue && !innerValue) return { el: custom, host: custom };
    if (inner) return { el: inner, host: custom || hostTarget };
    for (const node of path) {
      if (!node || node.nodeType !== 1) continue;
      const tag = String(node.tagName || "").toLowerCase();
      if (!tag || tag === "html" || tag === "body" || tag === "button" || tag === "a") continue;
      if (node.matches?.("[role='button'], [role='link']")) continue;
      const nodeValue = node.value != null && typeof node.value !== "object" ? String(node.value).trim() : "";
      if (nodeValue || node.isContentEditable || captureHostLabel(node)) return { el: node, host: custom || node };
    }
    return null;
  }

  function captureTelFromEvent(event) {
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    const nodes = path.length ? path : [event?.target];
    for (const node of nodes) {
      if (node?.matches?.("input[type='tel'], input[inputmode='tel']")) return node;
    }
    const target = event?.target;
    const root =
      target?.closest?.(".iti, [class*='intl'], [class*='phone'], [class*='Phone']") || target?.parentElement;
    return root?.querySelector?.("input[type='tel'], input[inputmode='tel']") || null;
  }

  const textCaptureTimers = new WeakMap();
  function scheduleTextCapture(el) {
    if (!el) return;
    const prev = textCaptureTimers.get(el);
    if (prev) clearTimeout(prev);
    textCaptureTimers.set(
      el,
      setTimeout(() => {
        textCaptureTimers.delete(el);
        const payload = captureDescribe(el, "input");
        if (payload) postCaptureEvent(payload);
      }, 350),
    );
  }

  function onCaptureTextInput(event) {
    const tel = captureTelFromEvent(event);
    if (tel && captureControlVisible(tel)) {
      scheduleTextCapture(tel);
      return;
    }
    const found = captureControlFromEvent(event, false);
    if (found?.el && captureControlVisible(found.el)) scheduleTextCapture(found.el);
  }

  function captureControlVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.disabled) return false;
    const type = String(el.getAttribute?.("type") || "").toLowerCase();
    if (type === "hidden" || type === "password") return false;
    try {
      const style = window.getComputedStyle?.(el);
      if (style && (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0)) {
        return false;
      }
      const box = el.getBoundingClientRect?.();
      if (!box || box.width < 8 || box.height < 8) return false;
    } catch {
      return false;
    }
    return true;
  }

  function snapshotFilledControls() {
    if (document.hidden) return;
    const nodes = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [role="combobox"]',
    );
    nodes.forEach((el) => {
      try {
        if (!captureControlVisible(el)) return;
        if (String(el.getAttribute?.("role") || "").toLowerCase() === "combobox") {
          const shown = comboboxShownValue(el);
          if (!shown) return;
          const question = captureCaptionAbove(el, shown) || resolveFieldQuestion(el, shown) || "";
          const q = question && !captureLooksLikeWidgetChrome(question) ? question : shown;
          const guiId = captureGuiId(el);
          postCaptureEvent({
            kind: "extension",
            source: "human",
            actor: "user",
            action: "select",
            pageUrl: location.href,
            pageTitle: document.title || "",
            tag: (el.tagName || "input").toLowerCase(),
            selector: guiId || captureSelectorFor(el),
            ...(guiId ? { guiId } : {}),
            fieldName: q,
            label: q,
            value: shown,
            selectedText: shown,
          });
          return;
        }
        const payload = captureDescribe(el, "change");
        if (payload) postCaptureEvent(payload);
      } catch {
        /* one bad control should not stop the rest */
      }
    });
  }

  function onCaptureInput(event) {
    const found = captureControlFromEvent(event, false);
    if (!found) return;
    const hint = captureHostLabel(found.host) || captureHostLabel(found.el);
    const payload = captureDescribe(found.el, "input", hint);
    if (payload) postCaptureEvent(payload);
  }

  function onCaptureChange(event) {
    const found = captureControlFromEvent(event, true);
    let el = found?.el || null;
    if (!el) {
      el = event.target;
      if (!el || el.nodeType !== 1) return;
      if (el.matches?.("option")) el = el.closest("select") || el;
      if (
        !el.matches?.(
          "input, textarea, select, [contenteditable='true'], [role='checkbox'], [role='radio'], [role='combobox'], [role='listbox']",
        )
      ) {
        const missed = captureTelFromEvent(event);
        if (missed) {
          const phone = captureDescribe(missed, "change");
          if (phone) postCaptureEvent(phone);
        }
        return;
      }
    }
    const hint = captureHostLabel(found?.host) || captureHostLabel(el);
    const payload = captureDescribe(el, "change", hint);
    if (payload) postCaptureEvent(payload);
    const tel = captureTelFromEvent(event);
    if (tel && tel !== el) {
      const phone = captureDescribe(tel, "change");
      if (phone) postCaptureEvent(phone);
    }
  }

  function isWorkdayChoiceControl(el) {
    if (!el || el.nodeType !== 1) return false;
    const id = String(el.id || "");
    const auto = String(el.getAttribute?.("data-automation-id") || "");
    if (/primaryQuestionnaire--/i.test(id) || /primaryQuestionnaire--/i.test(auto)) return true;
    if (/promptOption|optionRenderer|radioBtn|checkBox|selectOneOption/i.test(auto)) return true;
    if (el.getAttribute?.("role") === "radio" || el.getAttribute?.("role") === "option") return true;
    if (el.matches?.("input[type='radio'], input[type='checkbox']")) return true;
    return false;
  }

  function optionTextFromControl(el) {
    if (!el) return "";
    const aria = captureNormalizeText(el.getAttribute?.("aria-label") || "");
    const ariaQ = captureParseOptionAriaQuestion(aria, "");
    const fromAria = ariaQ ? "" : captureLooksLikeChoiceValue(aria) ? aria : "";
    // Visible text (what the user actually reads and clicked on) ranks above
    // el.value — a form control's raw value attribute is very often an
    // internal boolean/index code (e.g. "0"/"1"), not the human answer, and
    // would otherwise win just because it happens to look choice-shaped.
    const candidates = [
      fromAria,
      captureNormalizeText(el.getAttribute?.("data-automation-label") || ""),
      captureNormalizeText((el.innerText || el.textContent || "").split("\n")[0]),
      captureNormalizeText(el.value || ""),
    ];
    // Validate the FULL candidate before truncating — slicing a 65-char opaque
    // token down to 64 chars first would let it slip past the length check.
    for (const c of candidates) {
      if (c && captureLooksLikeChoiceValue(c)) return c.slice(0, 64);
    }
    // No candidate looked like a real choice — never fall back to a bare
    // opaque id / placeholder just because it happened to be non-empty.
    const first = captureNormalizeText(candidates.find(Boolean) || "");
    if (first && !captureLooksLikeOpaqueToken(first) && !captureLooksLikePlaceholderValue(first)) {
      return first.slice(0, 64);
    }
    return "";
  }

  function emitNavigationClick(el, name) {
    const label = captureNormalizeText(name).slice(0, 80);
    if (!label) return;
    postCaptureEvent({
      kind: "extension",
      source: "human",
      actor: "user",
      action: "click",
      pageUrl: location.href,
      pageTitle: document.title || "",
      tag: (el?.tagName || "button").toLowerCase(),
      selector: captureSelectorFor(el),
      fieldName: label,
      label,
      value: label,
    });
  }

  function emitChoiceCapture(el, optionLabel) {
    const opt = captureNormalizeText(optionLabel).slice(0, 80);
    if (!opt) return;
    if (captureLooksLikeOpaqueToken(opt) || captureLooksLikePlaceholderValue(opt)) return;
    const selector = captureSelectorFor(el);
    const guiId = captureGuiId(el);
    if (isNavigationClickLabel(opt) || isNavigationSelector(selector)) {
      emitNavigationClick(el, isNavigationClickLabel(opt) ? opt : captureNormalizeText(el?.innerText || opt));
      return;
    }
    const question =
      resolveFieldQuestion(el, opt) ||
      captureWorkdayQuestion(el, opt) ||
      captureParseOptionAriaQuestion(el.getAttribute?.("aria-label") || "", opt) ||
      pendingComboboxQuestion();
    let q =
      question && !captureLooksLikeOptionOnly(question) && !captureLooksLikeJunkFieldKey(question)
        ? question
        : "";
    if (captureLooksLikeWidgetChrome(q)) q = "";
    if (!q || q.toLowerCase() === opt.toLowerCase()) {
      const fromLabel = captureCaptionAbove(el, opt) || captureFieldLabel(el);
      if (
        fromLabel &&
        fromLabel.toLowerCase() !== opt.toLowerCase() &&
        !captureLooksLikeJunkFieldKey(fromLabel) &&
        !captureLooksLikeWidgetChrome(fromLabel)
      ) {
        q = fromLabel;
      }
    }
    if (
      q &&
      opt &&
      captureLooksLikeChoiceValue(q) &&
      captureLooksLikeChoiceValue(opt) &&
      q.toLowerCase() !== opt.toLowerCase()
    ) {
      const hostQ = captureHostLabel(captureControlHost(el)) || captureHostLabel(el) || pendingComboboxQuestion();
      q =
        hostQ &&
        hostQ.toLowerCase() !== opt.toLowerCase() &&
        hostQ.toLowerCase() !== q.toLowerCase() &&
        !captureLooksLikeJunkFieldKey(hostQ)
          ? hostQ
          : "";
    }
    postCaptureEvent({
      kind: "extension",
      source: "human",
      actor: "user",
      action: "check",
      pageUrl: location.href,
      pageTitle: document.title || "",
      tag: (el.tagName || "").toLowerCase(),
      selector: guiId || selector,
      ...(guiId ? { guiId } : {}),
      fieldName: q || "",
      label: q || opt,
      value: opt,
      selectedText: opt,
    });
    if (q) rememberField(el, q, "choice");
    pendingCombobox = null;
  }

  /**
   * Buttons that just open a Workday-style combobox popup. Clicking one does not
   * choose a value — the button's displayed text at click time is still the OLD
   * value — so it must never be captured as if it were the answer. The real
   * selection is a later click on a popup option, which is often rendered in a
   * floating panel detached from the field's own DOM subtree and can't resolve
   * its own question; remember the field here (while ancestry is intact) so that
   * later option click can fall back to it.
   */
  function isComboboxTrigger(el) {
    if (!el || el.nodeType !== 1) return false;
    if (String(el.getAttribute?.("role") || "").toLowerCase() === "combobox") return true;
    const auto = String(el.getAttribute?.("data-automation-id") || "");
    if (/selectOne|dropDown|promptButton|multiselect/i.test(auto)) return true;
    const haspopup = String(el.getAttribute?.("aria-haspopup") || "").toLowerCase();
    // Only "listbox" — aria-haspopup="true"/"menu"/"dialog" cover plain menu
    // and dialog buttons too, which are not dropdown/select controls.
    if (haspopup === "listbox" && el.hasAttribute?.("aria-expanded")) return true;
    return false;
  }

  /** {el, question, ts} for the combobox popup most recently opened. */
  let pendingCombobox = null;

  function rememberComboboxOpen(el) {
    const caption = captureCaptionAbove(el, "");
    const question = caption || resolveFieldQuestion(el, "") || captureWorkdayQuestion(el, "");
    pendingCombobox = {
      el,
      question: question && !captureLooksLikeWidgetChrome(question) ? question : "",
      ts: Date.now(),
    };
  }

  function pendingComboboxQuestion() {
    if (!pendingCombobox) return "";
    if (Date.now() - pendingCombobox.ts > 15000) return "";
    const q = pendingCombobox.question;
    return q && !captureLooksLikeWidgetChrome(q) ? q : "";
  }

  function owningCombobox(el) {
    const list = el?.closest?.("[role='listbox']") || (el?.getAttribute?.("role") === "listbox" ? el : null);
    const listId = String(list?.id || "");
    if (listId) {
      try {
        const owner = document.querySelector(
          `[aria-controls="${CSS.escape(listId)}"], [aria-owns="${CSS.escape(listId)}"]`,
        );
        if (owner) return owner;
      } catch {
        /* ignore */
      }
    }
    if (pendingCombobox?.el && Date.now() - pendingCombobox.ts < 15000) return pendingCombobox.el;
    return null;
  }

  function comboboxShownValue(combo) {
    if (!combo) return "";
    const root = combo.closest?.("[class*='container']") || combo.parentElement || combo;
    const single = root.querySelector?.("[class*='singleValue'], [class*='single-value']");
    const shown = captureNormalizeText(single?.textContent || "");
    if (shown && !captureLooksLikeWidgetChrome(shown) && !captureLooksLikePlaceholderValue(shown)) {
      return shown.slice(0, 80);
    }
    const val = captureNormalizeText(typeof combo.value === "string" ? combo.value : "");
    if (val && !captureLooksLikeWidgetChrome(val) && !captureLooksLikePlaceholderValue(val)) return val.slice(0, 80);
    return "";
  }

  let comboCommitTimer = null;
  function scheduleComboboxCommit(optionEl, fallbackOpt) {
    const combo = owningCombobox(optionEl) || pendingCombobox?.el || null;
    if (comboCommitTimer) clearTimeout(comboCommitTimer);
    comboCommitTimer = setTimeout(() => {
      comboCommitTimer = null;
      const clicked = captureNormalizeText(fallbackOpt).slice(0, 80);
      let shown = comboboxShownValue(combo);
      if (
        clicked &&
        (!shown ||
          (shown.toLowerCase() !== clicked.toLowerCase() && shown.length <= 12 && clicked.length > shown.length))
      ) {
        shown = clicked;
      }
      if (!shown || captureLooksLikeWidgetChrome(shown) || captureLooksLikePlaceholderValue(shown)) return;
      const question =
        (combo && captureCaptionAbove(combo, shown)) ||
        pendingComboboxQuestion() ||
        (combo && resolveFieldQuestion(combo, shown)) ||
        captureCaptionAbove(optionEl, shown) ||
        "";
      const q =
        question && !captureLooksLikeWidgetChrome(question) && !captureLooksLikeJunkFieldKey(question)
          ? question
          : "";
      const guiSource = combo || optionEl;
      const guiId = captureGuiId(guiSource);
      postCaptureEvent({
        kind: "extension",
        source: "human",
        actor: "user",
        action: "select",
        pageUrl: location.href,
        pageTitle: document.title || "",
        tag: (guiSource?.tagName || "select").toLowerCase(),
        selector: guiId || captureSelectorFor(guiSource),
        ...(guiId ? { guiId } : {}),
        fieldName: q || shown,
        label: q || shown,
        value: shown,
        selectedText: shown,
      });
      if (q) rememberField(guiSource, q, "choice");
      pendingCombobox = null;
    }, 60);
  }

  function captureAccessibleName(node) {
    if (!node || node.nodeType !== 1) return "";
    const labelledBy = node.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      const text = captureNormalizeText(
        String(labelledBy)
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent || "")
          .join(" "),
      );
      if (text && text.length <= 180 && !captureLooksLikeOpaqueToken(text) && !captureLooksLikeWidgetChrome(text)) return text;
    }
    const named = captureNormalizeText(
      node.getAttribute?.("aria-label") ||
        node.getAttribute?.("title") ||
        node.getAttribute?.("alt") ||
        (typeof node.value === "string" && /^(button|submit|reset|image)$/i.test(String(node.type || ""))
          ? node.value
          : "") ||
        "",
    );
    if (named && named.length <= 180 && !captureLooksLikeOpaqueToken(named) && !captureLooksLikeWidgetChrome(named)) return named;
    const text = captureNormalizeText(node.innerText || node.textContent || "");
    if (text && text.length <= 180 && !captureLooksLikeOpaqueToken(text) && !captureLooksLikeWidgetChrome(text)) return text;
    const first = captureNormalizeText(String(node.innerText || node.textContent || "").split("\n")[0] || "");
    if (first && first.length <= 180 && !captureLooksLikeOpaqueToken(first) && !captureLooksLikeWidgetChrome(first)) return first;
    return "";
  }

  function isChoiceControl(node) {
    if (!node?.matches) return false;
    return (
      node.matches(
        "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox'], [role='option'], [role='switch'], [data-automation-id*='promptOption']",
      ) ||
      (node.matches("label") &&
        node.querySelector?.("input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']"))
    );
  }

  function isActionControl(node) {
    if (!node?.matches || isChoiceControl(node) || isTextEntryTarget(node)) return false;
    if (
      node.matches(
        "button, a[href], summary, [role='button'], [role='link'], [role='tab'], [role='menuitem'], input[type='button'], input[type='submit'], input[type='reset'], input[type='image']",
      )
    ) {
      return true;
    }
    const tag = String(node.tagName || "");
    if (tag.includes("-") && !node.querySelector?.("input, textarea, select, [role='radio'], [role='checkbox']")) {
      return true;
    }
    if (node.hasAttribute?.("onclick") || node.hasAttribute?.("jsaction")) return true;
    try {
      const cursor = window.getComputedStyle?.(node)?.cursor;
      if (cursor === "pointer") {
        const box = node.getBoundingClientRect?.();
        const small = !box || (box.width > 0 && box.width <= 520 && box.height > 0 && box.height <= 120);
        const hasField = node.querySelector?.("input, textarea, select, [role='radio'], [role='checkbox']");
        if (small && !hasField) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  function captureVisibleClickLabel(node) {
    return captureAccessibleName(node);
  }

  function isTextEntryTarget(node) {
    if (!node?.matches) return false;
    return node.matches(
      'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, [contenteditable="true"]',
    );
  }

  function captureIsLayoutClick(node) {
    if (!node || node.nodeType !== 1) return false;
    const id = String(node.id || "");
    if (captureLooksLikeJunkFieldKey(id)) return true;
    if (/__(group|field|form)__/i.test(id)) return true;
    try {
      if (node.querySelector?.("input, textarea, select, [role='radio'], [role='checkbox']")) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function genericClickFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const nodes = path.length ? path : [event.target];
    for (const node of nodes) {
      if (!node || node.nodeType !== 1) continue;
      if (isTextEntryTarget(node)) return null;
      if (captureIsLayoutClick(node)) continue;
      const label = captureVisibleClickLabel(node);
      if (label) return { el: node, label };
    }
    return null;
  }

  function emitPlainClick(el, label) {
    const text = captureNormalizeText(label).slice(0, 180);
    if (!text || captureLooksLikeWidgetChrome(text)) return;
    if (el?.getAttribute?.("role") === "listbox" || el?.closest?.("[role='listbox']")) return;
    if (isNavigationClickLabel(text)) {
      emitNavigationClick(el, text);
      return;
    }
    const guiId = captureGuiId(el);
    postCaptureEvent({
      kind: "extension",
      source: "human",
      actor: "user",
      action: "click",
      pageUrl: location.href,
      pageTitle: document.title || "",
      tag: (el?.tagName || "button").toLowerCase(),
      selector: guiId || captureSelectorFor(el),
      ...(guiId ? { guiId } : {}),
      fieldName: captureLooksLikeJunkFieldKey(el?.id || el?.name || "") ? text : el?.name || el?.id || text,
      label: text,
      value: text,
    });
  }

  function onCaptureClick(event) {
    const clickSel =
      "button, a[href], [role='button'], [role='tab'], [role='option'], [role='radio'], [role='menuitem'], [role='checkbox'], input[type='submit'], input[type='button'], input[type='radio'], input[type='checkbox'], label, [data-automation-id*='primaryQuestionnaire'], [data-automation-id*='promptOption'], [data-automation-id*='optionRenderer']";
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    let el = null;
    for (const node of path) {
      if (node?.matches?.(clickSel)) {
        el = node;
        break;
      }
    }
    if (!el) el = event.target?.closest?.(clickSel) || null;
    if (!el) {
      for (const node of path) {
        if (node?.nodeType === 1 && isActionControl(node)) {
          el = node;
          break;
        }
      }
    }
    if (!el) {
      const raw = event.target;
      const climb =
        raw?.closest?.("[id*='primaryQuestionnaire'], [data-automation-id*='primaryQuestionnaire']") || null;
      if (climb) {
        const opt = optionTextFromControl(climb) || captureNormalizeText(raw?.textContent || "").slice(0, 40);
        if (opt && captureLooksLikeChoiceValue(opt)) {
          emitChoiceCapture(climb, opt);
          return;
        }
      }
      // No Workday-shaped markup matched at all. If a combobox popup was just
      // opened, this click almost certainly lands on that popup's chosen
      // option — capture it by its visible text rather than dropping it, even
      // though it doesn't match any automation-id/role pattern we recognize.
      if (raw && pendingComboboxQuestion()) {
        const opt = captureNormalizeText((raw.innerText || raw.textContent || "").split("\n")[0]).slice(0, 64);
        if (opt && captureLooksLikeChoiceValue(opt)) emitChoiceCapture(raw, opt);
        else {
          const generic = genericClickFromEvent(event);
          if (generic) emitPlainClick(generic.el, generic.label);
        }
        return;
      }
      const generic = genericClickFromEvent(event);
      if (generic) emitPlainClick(generic.el, generic.label);
      return;
    }

    if (isComboboxTrigger(el)) {
      rememberComboboxOpen(el);
      return;
    }

    if (
      el.getAttribute?.("role") === "option" ||
      el.getAttribute?.("role") === "listbox" ||
      el.closest?.("[role='listbox']")
    ) {
      const opt = optionTextFromControl(el);
      if (opt && !captureLooksLikeWidgetChrome(opt)) scheduleComboboxCommit(el, opt);
      return;
    }

    if (
      isWorkdayChoiceControl(el) ||
      el.matches?.(
        "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox'], [role='option'], [data-automation-id*='promptOption']",
      ) ||
      (el.matches?.("label") &&
        el.querySelector?.(
          "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']",
        ))
    ) {
      const input = el.matches?.("input, [role='radio'], [role='checkbox'], [role='option']")
        ? el
        : el.querySelector?.(
            "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']",
          ) || el;
      const optionLabel = optionTextFromControl(input) || optionTextFromControl(el);
      const selector = captureSelectorFor(input);
      if (isNavigationSelector(selector) || isNavigationClickLabel(optionLabel)) {
        emitNavigationClick(input, optionLabel || captureNormalizeText(input.innerText || ""));
        return;
      }
      if (optionLabel) {
        emitChoiceCapture(input, optionLabel);
        setTimeout(() => {
          const payload = captureDescribe(input, "check");
          if (payload) postCaptureEvent(payload);
        }, 0);
        return;
      }
    }
    if (el.matches?.("label") && el.querySelector?.("input, textarea, select")) return;
    if (isActionControl(el)) {
      const name = captureAccessibleName(el);
      if (name && !captureLooksLikePlaceholderValue(name)) {
        emitPlainClick(el, name);
        return;
      }
    }
    const selector = captureSelectorFor(el);
    const label = captureNormalizeText(
      el.innerText ||
        el.value ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.id ||
        el.name ||
        "",
    );
    if (!label || label.length > 120) {
      const generic = genericClickFromEvent(event);
      if (generic) emitPlainClick(generic.el, generic.label);
      return;
    }
    if (isNavigationClickLabel(label) || isNavigationSelector(selector)) {
      emitNavigationClick(el, isNavigationClickLabel(label) ? label : label.split("\n")[0]);
      return;
    }
    if (captureLooksLikePlaceholderValue(label) || captureLooksLikeOpaqueToken(label)) {
      const generic = genericClickFromEvent(event);
      if (
        generic &&
        !captureLooksLikePlaceholderValue(generic.label) &&
        !captureLooksLikeOpaqueToken(generic.label)
      ) {
        emitPlainClick(generic.el, generic.label);
      }
      return;
    }
    const name = captureAccessibleName(el) || label;
    if (captureLooksLikeWidgetChrome(name) || captureLooksLikeWidgetChrome(label)) return;
    const guiId = captureGuiId(el);
    const idName = el.name || el.id || "";
    postCaptureEvent({
      kind: "extension",
      source: "human",
      actor: "user",
      action: "click",
      pageUrl: location.href,
      pageTitle: document.title || "",
      tag: (el.tagName || "").toLowerCase(),
      selector: guiId || selector,
      ...(guiId ? { guiId } : {}),
      fieldName: !idName || captureLooksLikeJunkFieldKey(idName) ? name : idName,
      label: name,
      value: name,
    });
  }

  function onPageValueMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "lt-capture" || data.action !== "change") return;
    const value = captureNormalizeText(data.value || "");
    const label = captureNormalizeText(data.label || "");
    if (!value || data.type === "password" || data.type === "hidden") return;
    if (captureLooksLikeOpaqueToken(value) && !label) return;
    const fieldName = label && !captureLooksLikeJunkFieldKey(label) ? label : captureNormalizeText(data.name || data.id || "");
    if (!fieldName || captureLooksLikeJunkFieldKey(fieldName)) return;
    postCaptureEvent({
      kind: "extension",
      source: "human",
      actor: "user",
      action: "change",
      pageUrl: location.href,
      pageTitle: document.title || "",
      tag: String(data.tag || "field").toLowerCase(),
      selector: fieldName,
      fieldName,
      label: fieldName,
      value,
    });
  }

  function startCapturePageRecorder() {
    document.addEventListener("change", onCaptureChange, true);
    document.addEventListener("focusout", onCaptureChange, true);
    document.addEventListener("input", onCaptureTextInput, true);
    document.addEventListener("click", onCaptureClick, true);
    window.addEventListener("message", onPageValueMessage);
    safeRuntimeSend({ type: "capture_install_value_hook" });
    setupFieldInventoryObservers();
    scanPageFieldInventory();
    captureHealthTimer = setInterval(refreshCaptureRecording, 1000);
    refreshCaptureRecording();
  }


  function stopCapturePageRecorder() {
    document.removeEventListener("change", onCaptureChange, true);
    document.removeEventListener("focusout", onCaptureChange, true);
    document.removeEventListener("input", onCaptureTextInput, true);
    document.removeEventListener("click", onCaptureClick, true);
    window.removeEventListener("message", onPageValueMessage);
    if (captureHealthTimer) clearInterval(captureHealthTimer);
    captureHealthTimer = null;
    try {
      window.__ltFieldInventoryObserver?.disconnect?.();
    } catch {
      /* ignore */
    }
    window.__ltFieldInventoryObserver = null;
    window.__ltInvObserversReady = false;
    if (window.__ltInvTimer) clearTimeout(window.__ltInvTimer);
  }

  function teardownContentScript() {
    if (tornDown) return;
    tornDown = true;
    try {
      runner.cancelled = true;
      stopWatching();
      stopCapturePageRecorder();
      clearHighlights();
      window.removeEventListener("focus", announcePageContext);
      document.removeEventListener("visibilitychange", onVisibilityAnnounce);
      document.removeEventListener("pointerdown", pingUserActivity, true);
      document.removeEventListener("keydown", pingUserActivity, true);
      document.removeEventListener("input", pingUserActivity, true);
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
    if (window.__coactContentInstance === INSTANCE) {
      window.__coactContentLoaded = false;
      window.__coactContentExtId = null;
      window.__coactContentInstance = null;
      window.__coactTeardown = null;
    }
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
  document.addEventListener("pointerdown", pingUserActivity, true);
  document.addEventListener("keydown", pingUserActivity, true);
  document.addEventListener("input", pingUserActivity, true);

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
            useStep.allowedValues = [approved];
            useStep.value = approved;
            if (!watch.agentApprovedValues || typeof watch.agentApprovedValues !== "object") {
              watch.agentApprovedValues = {};
            }
            watch.agentApprovedValues[step.id] = approved;
            if (step.valueFrom) data[step.valueFrom] = approved;
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

    if (message?.type === "capture_recording") {
      const wasRecording = captureRecording;
      captureRecording = Boolean(message.recording);
      if (captureRecording) {
        try {
          scanPageFieldInventory();
        } catch {
          /* ignore */
        }
        if (!wasRecording) snapshotFilledControls();
      }
      sendResponse({ ok: true, recording: captureRecording });
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
  startCapturePageRecorder();
})();
