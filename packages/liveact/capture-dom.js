/**
 * DOM capture helpers shared by Playwright (and unit tests).
 * The page installer mirrors packages/extension/content.js captureDescribe /
 * Yes-No question resolution so Record without the extension stays Dash/SOP ready.
 *
 * Land-then-fill: on page load / SPA mutation we inventory visible field labels
 * (questions), then attach value + action type on input/click.
 */

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

/** Unselected dropdown placeholder text — never a real answer. */
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

/** Short choice *values* (Yes/No, Full-time, India) — not used to reject question labels. */
function captureLooksLikeChoiceValue(text) {
  const t = captureNormalizeText(text);
  if (!t || t.length > 64) return false;
  if (captureLooksLikeOptionOnly(t)) return true;
  if (captureLooksLikeOpaqueToken(t)) return false;
  if (captureLooksLikePlaceholderValue(t)) return false;
  if (/[?]/.test(t)) return false;
  if (
    /^(save and continue|submit|next|continue|back|cancel|apply|sign in|search|upload|remove|add|edit|delete)$/i.test(
      t,
    )
  ) {
    return false;
  }
  if (t.length <= 40 && !/\.\s/.test(t) && /^[\w .,'\-+/&()]+$/i.test(t)) return true;
  return false;
}

function captureLooksLikeJunkFieldKey(text) {
  const t = captureNormalizeText(text);
  if (!t) return true;
  if (captureLooksLikeOpaqueToken(t)) return true;
  if (/^(input|select|textarea|field|button|div|span)$/i.test(t)) return true;
  if (/^#?(primaryQuestionnaire--|wd-|ember\d)/i.test(t)) return true;
  if (/^primaryQuestionnaire--/i.test(t)) return true;
  return false;
}

/** True when text looks like a human question / field label (not Yes/No / id junk). */
function captureIsUsefulQuestionLabel(text, optionText) {
  const t = captureNormalizeText(text);
  if (!t || t.length < 3 || t.length > 240) return false;
  if (captureLooksLikeOptionOnly(t)) return false;
  if (captureLooksLikeJunkFieldKey(t)) return false;
  const opt = captureNormalizeText(optionText).toLowerCase();
  if (opt && t.toLowerCase() === opt) return false;
  if (/\?|\*|required|months|agency|consideration|employee|authorized|experience|relocat|citizen|sponsor|visa|gender|disability|veteran|race|ethnicity/i.test(t)) {
    return true;
  }
  if (t.length >= 12) return true;
  // Short but human labels: "Email", "Phone", "Country"
  if (t.length >= 4 && /^[A-Za-z][A-Za-z0-9 /,'&\-().]+$/.test(t) && !/questionnaire/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Pick the best question string from candidate texts (page inventory / Workday walk).
 * Prefers sentences with "?", then longer human labels.
 */
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

/**
 * Workday / ARIA often puts "Yes for <question>" or "Yes, <question>" on the control.
 */
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

/**
 * Runs inside the browser page. Idempotent. Gates posts on window.__ltPwCaptureOn.
 * Prefer window.__ltCaptureEvent (Playwright exposeBinding); else buffer for Mac poll.
 */
function installLiveTrackPageCapture() {
  if (window.__ltPwCaptureInstalled) return "already";
  window.__ltPwCaptureInstalled = true;
  window.__ltCaptureBuf = window.__ltCaptureBuf || [];
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
    if (
      /^(save and continue|submit|next|continue|back|cancel|apply|sign in|search|upload|remove|add|edit|delete)$/i.test(
        t,
      )
    ) {
      return false;
    }
    if (t.length <= 40 && !/\.\s/.test(t) && /^[\w .,'\-+/&()]+$/i.test(t)) return true;
    return false;
  }

  function captureLooksLikeJunkFieldKey(text) {
    const t = captureNormalizeText(text);
    if (!t) return true;
    if (captureLooksLikeOpaqueToken(t)) return true;
    if (/^(input|select|textarea|field|button|div|span)$/i.test(t)) return true;
    if (/^#?(primaryQuestionnaire--|wd-|ember\d)/i.test(t)) return true;
    if (/^primaryQuestionnaire--/i.test(t)) return true;
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
    if (t.length >= 4 && /^[A-Za-z][A-Za-z0-9 /,'&\-().]+$/.test(t) && !/questionnaire/i.test(t)) {
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

  function captureSkipPage() {
    const href = String(location.href || "");
    const title = String(document.title || "");
    if (/127\.0\.0\.1:17322|localhost:17322/.test(href)) return true;
    if (/\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(href)) return true;
    if (/cloudhelp|jira-mock/i.test(`${href} ${title}`)) return true;
    return false;
  }

  function postCaptureEvent(event) {
    if (!window.__ltPwCaptureOn || captureSkipPage() || !event) return;
    const payload = {
      kind: "playwright",
      source: "human",
      actor: "user",
      ...event,
    };
    try {
      if (typeof window.__ltCaptureEvent === "function") {
        window.__ltCaptureEvent(payload);
        return;
      }
    } catch {
      /* fall through to buffer */
    }
    window.__ltCaptureBuf.push(payload);
    if (window.__ltCaptureBuf.length > 400) {
      window.__ltCaptureBuf.splice(0, window.__ltCaptureBuf.length - 400);
    }
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
            if (
              n.closest?.(
                'input, button, [role="radio"], [role="checkbox"], [data-automation-id*="primaryQuestionnaire"], [data-automation-id*="promptOption"]',
              ) &&
              !n.matches?.(
                '[data-automation-id*="richText"], [data-automation-id*="label"], [data-automation-id*="question"], legend, [role="heading"]',
              )
            ) {
              return;
            }
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

    // Parent radiogroup aria-labelledby
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
    const fromAria = ariaQ
      ? ""
      : captureLooksLikeChoiceValue(aria)
        ? aria
        : "";
    const candidates = [
      fromAria,
      captureNormalizeText(el.getAttribute?.("data-automation-label") || ""),
      captureNormalizeText(el.value || ""),
      captureNormalizeText((el.innerText || el.textContent || "").split("\n")[0]),
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

  function emitChoiceCapture(el, optionLabel) {
    const opt = captureNormalizeText(optionLabel).slice(0, 80);
    if (!opt) return;
    if (captureLooksLikeOpaqueToken(opt) || captureLooksLikePlaceholderValue(opt)) return;
    const question =
      resolveFieldQuestion(el, opt) ||
      captureWorkdayQuestion(el, opt) ||
      captureParseOptionAriaQuestion(el.getAttribute?.("aria-label") || "", opt) ||
      pendingComboboxQuestion();
    const q =
      question && !captureLooksLikeOptionOnly(question) && !captureLooksLikeJunkFieldKey(question)
        ? question
        : "";
    postCaptureEvent({
      action: "check",
      pageUrl: location.href,
      pageTitle: document.title || "",
      tag: (el.tagName || "").toLowerCase(),
      selector: captureSelectorFor(el),
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
    const question = resolveFieldQuestion(el, "") || captureWorkdayQuestion(el, "");
    pendingCombobox = { el, question: question || "", ts: Date.now() };
  }

  function pendingComboboxQuestion() {
    if (!pendingCombobox) return "";
    if (Date.now() - pendingCombobox.ts > 15000) return "";
    return pendingCombobox.question;
  }

  function onCaptureClick(event) {
    const el = event.target?.closest?.(
      "button, a[href], [role='button'], [role='tab'], [role='option'], [role='radio'], [role='menuitem'], [role='checkbox'], input[type='submit'], input[type='button'], input[type='radio'], input[type='checkbox'], label, [data-automation-id*='primaryQuestionnaire'], [data-automation-id*='promptOption'], [data-automation-id*='optionRenderer']",
    );
    if (!el) {
      // Workday often paints option text on a nested span — climb to questionnaire control
      const raw = event.target;
      const climb =
        raw?.closest?.("[id*='primaryQuestionnaire'], [data-automation-id*='primaryQuestionnaire']") || null;
      if (climb) {
        const opt = optionTextFromControl(climb) || captureNormalizeText(raw?.textContent || "").slice(0, 40);
        if (opt && captureLooksLikeChoiceValue(opt)) emitChoiceCapture(climb, opt);
        return;
      }
      // No Workday-shaped markup matched at all. If a combobox popup was just
      // opened, this click almost certainly lands on that popup's chosen
      // option — capture it by its visible text rather than dropping it, even
      // though it doesn't match any automation-id/role pattern we recognize.
      if (raw && pendingComboboxQuestion()) {
        const opt = captureNormalizeText((raw.innerText || raw.textContent || "").split("\n")[0]).slice(0, 64);
        if (opt && captureLooksLikeChoiceValue(opt)) emitChoiceCapture(raw, opt);
      }
      return;
    }

    if (isComboboxTrigger(el)) {
      rememberComboboxOpen(el);
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
      if (optionLabel) {
        emitChoiceCapture(input, optionLabel);
        setTimeout(() => {
          const payload = captureDescribe(input, "check");
          if (payload) postCaptureEvent(payload);
        }, 0);
      }
      return;
    }
    if (el.matches?.("label") && el.querySelector?.("input, textarea, select")) return;
    const label = captureNormalizeText(
      el.innerText ||
        el.value ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.id ||
        el.name ||
        "",
    );
    if (!label || label.length > 120) return;
    // A combobox trigger not caught by isComboboxTrigger() still shows its OLD
    // value ("Select One" etc.) at click time — never record that as an answer.
    if (captureLooksLikePlaceholderValue(label) || captureLooksLikeOpaqueToken(label)) return;
    if (captureLooksLikeChoiceValue(label) || captureParseOptionAriaQuestion(label, "")) {
      const optionValue = captureLooksLikeChoiceValue(label)
        ? label.split(/\s+/).slice(0, 4).join(" ").slice(0, 64)
        : captureLooksLikeChoiceValue(captureNormalizeText(el.innerText || "").slice(0, 48))
          ? captureNormalizeText(el.innerText || "").slice(0, 48)
          : /^(yes|no)\b/i.test(label)
            ? label.match(/^(yes|no)/i)[1]
            : label.slice(0, 64);
      emitChoiceCapture(el, optionValue);
      return;
    }
    postCaptureEvent({
      action: "click",
      pageUrl: location.href,
      pageTitle: document.title || "",
      tag: (el.tagName || "").toLowerCase(),
      selector: captureSelectorFor(el),
      fieldName: el.name || el.id || label,
      label,
      value: label,
    });
  }

  function captureFieldLabel(el) {
    if (!el) return "";
    if (el.id) {
      try {
        const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
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
    let node = el.previousElementSibling;
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
    if (el.id) return `#${el.id}`;
    const auto = el.getAttribute?.("data-automation-id");
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
    if (el.id) keys.push(`id:${el.id}`);
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
    for (const k of inventoryKeysFor(el)) {
      const hit = map.get(k);
      if (hit?.label && captureIsUsefulQuestionLabel(hit.label, "")) return hit.label;
    }
    const group =
      el.closest?.(
        '[role="radiogroup"], [role="group"], fieldset, [data-automation-id*="formField"], [data-automation-id*="question"], [data-automation-id*="questionnaire"]',
      ) || null;
    if (group) {
      const ctrls = group.querySelectorAll?.(
        "input, textarea, select, button, [role='radio'], [role='checkbox'], [role='button'], [data-automation-id]",
      );
      for (const ctrl of ctrls || []) {
        for (const k of inventoryKeysFor(ctrl)) {
          const hit = map.get(k);
          if (hit?.label && captureIsUsefulQuestionLabel(hit.label, "")) return hit.label;
        }
      }
    }
    return "";
  }

  function resolveFieldQuestion(el, optionHint) {
    const inventoried = lookupInventory(el);
    if (inventoried) return inventoried;
    const live = captureQuestionLabel(el, optionHint) || captureFieldLabel(el);
    if (live && captureIsUsefulQuestionLabel(live, optionHint)) return live;
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

  function captureDescribe(el, action) {
    if (!el || el.nodeType !== 1) return null;
    const tag = (el.tagName || "").toLowerCase();
    const type = (el.getAttribute("type") || tag).toLowerCase();
    const role = String(el.getAttribute("role") || "").toLowerCase();
    if (type === "password" || type === "hidden") return null;
    if (el.readOnly && type !== "radio" && type !== "checkbox" && tag !== "select") return null;
    if (el.disabled && type !== "radio" && type !== "checkbox") return null;

    let value = el.value != null ? String(el.value) : "";
    if (el.isContentEditable) value = String(el.textContent || "").trim();
    if (value.length > 200) value = value.slice(0, 200);
    let selectedText = "";

    if (tag === "select" || role === "listbox" || role === "combobox") {
      action = "select";
      const opt = el.selectedOptions && el.selectedOptions[0];
      selectedText = opt ? captureNormalizeText(opt.textContent || "") : "";
      value = selectedText || String((opt && opt.value) || value);
      // Still on the unselected placeholder option — nothing was actually chosen.
      if (captureLooksLikePlaceholderValue(selectedText || value)) return null;
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
    const question = resolveFieldQuestion(el, optionHint);
    const label = question || captureFieldLabel(el);
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
    return {
      action,
      pageUrl: location.href,
      pageTitle: document.title || "",
      tag: tag || role || "field",
      selector: captureSelectorFor(el),
      fieldName: fieldName || label,
      fieldId: el.id || "",
      label: (question && !captureLooksLikeOptionOnly(question) ? question : "") || label || fieldName,
      value,
      selectedText,
    };
  }

  function onCaptureInput(event) {
    const el = event.target;
    if (!el?.matches) return;
    if (
      !el.matches(
        "input:not([type=password]):not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [contenteditable='true']",
      )
    ) {
      return;
    }
    const payload = captureDescribe(el, "input");
    if (payload) postCaptureEvent(payload);
  }

  function onCaptureChange(event) {
    let el = event.target;
    if (!el || el.nodeType !== 1) return;
    if (el.matches?.("option")) el = el.closest("select") || el;
    if (
      !el.matches?.(
        "input, textarea, select, [contenteditable='true'], [role='checkbox'], [role='radio'], [role='combobox'], [role='listbox']",
      )
    ) {
      return;
    }
    const payload = captureDescribe(el, "change");
    if (payload) postCaptureEvent(payload);
  }

  document.addEventListener("input", onCaptureInput, true);
  document.addEventListener("change", onCaptureChange, true);
  document.addEventListener("click", onCaptureClick, true);
  setupFieldInventoryObservers();
  return "installed";
}

/** Source string for Playwright addInitScript / Chrome execute javascript. */
function pageCaptureInstallerSource() {
  return `(${installLiveTrackPageCapture.toString()})()`;
}

function pageCaptureEnableSource(on) {
  const flag = on ? "true" : "false";
  return `(() => { window.__ltPwCaptureOn=${flag}; (${installLiveTrackPageCapture.toString()})(); try { if (${flag} && typeof window.__ltScanFieldInventory === "function") window.__ltScanFieldInventory(); } catch (e) {} return "ok"; })()`;
}

function pageCaptureDrainSource() {
  return `(() => {
    var buf = window.__ltCaptureBuf;
    if (!buf || !buf.length) return "[]";
    var out = buf.splice(0, buf.length);
    try { return JSON.stringify(out); } catch (e) { return "[]"; }
  })()`;
}

module.exports = {
  captureNormalizeText,
  captureLooksLikeOptionOnly,
  captureLooksLikeChoiceValue,
  captureLooksLikeOpaqueToken,
  captureLooksLikePlaceholderValue,
  captureLooksLikeJunkFieldKey,
  captureIsUsefulQuestionLabel,
  capturePickQuestionCandidate,
  captureParseOptionAriaQuestion,
  installLiveTrackPageCapture,
  pageCaptureInstallerSource,
  pageCaptureEnableSource,
  pageCaptureDrainSource,
};
