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

/** React Select live-region copy and generated listbox ids are not field names. */
function captureLooksLikeWidgetChrome(text) {
  const t = captureNormalizeText(text);
  if (!t) return false;
  if (/^react-select-\d+/i.test(t)) return true;
  if (/react-select-\d+-(listbox|input|option|live-region|placeholder)/i.test(t)) return true;
  if (/use up and down to choose/i.test(t)) return true;
  if (/press enter to select/i.test(t) && /press (escape|tab)/i.test(t)) return true;
  if (/press tab to select the option/i.test(t)) return true;
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

  function emitNavigationClick(el, name) {
    const label = captureNormalizeText(name).slice(0, 80);
    if (!label) return;
    postCaptureEvent({
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

  function captureLooksLikeWidgetChrome(text) {
    const t = captureNormalizeText(text);
    if (!t) return false;
    if (/^react-select-\d+/i.test(t)) return true;
    if (/react-select-\d+-(listbox|input|option|live-region|placeholder)/i.test(t)) return true;
    if (/use up and down to choose/i.test(t)) return true;
    if (/press enter to select/i.test(t) && /press (escape|tab)/i.test(t)) return true;
    if (/press tab to select the option/i.test(t)) return true;
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
      const shown = comboboxShownValue(combo) || captureNormalizeText(fallbackOpt).slice(0, 80);
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

  function genericClickFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const nodes = path.length ? path : [event.target];
    for (const node of nodes) {
      if (!node || node.nodeType !== 1) continue;
      if (isTextEntryTarget(node)) return null;
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
      action: "click",
      pageUrl: location.href,
      pageTitle: document.title || "",
      tag: (el?.tagName || "button").toLowerCase(),
      selector: guiId || captureSelectorFor(el),
      ...(guiId ? { guiId } : {}),
      fieldName: el?.name || el?.id || text,
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
      // Workday often paints option text on a nested span — climb to questionnaire control
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
    // A combobox trigger not caught by isComboboxTrigger() still shows its OLD
    // value ("Select One" etc.) at click time — never record that as an answer.
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
    function captureFinderTag(liveName, websiteLabel) {
      const site = captureNormalizeText(websiteLabel).replace(/[*:\s]+$/g, "").trim();
      const live = captureNormalizeText(liveName);
      if (!site || !live) return "";
      if (captureLooksLikeOptionOnly(site) || captureLooksLikeJunkFieldKey(site)) return "";
      const compact = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (!compact(site) || compact(site) === compact(live)) return "";
      return site;
    }

    const ownName = (function captureOwnFieldName(node) {
      const name = captureNormalizeText(node?.name || "");
      if (name && !captureLooksLikeJunkFieldKey(name)) {
        const bare = name.replace(/[*:\s]+$/g, "");
        if (bare.length >= 2 && !captureLooksLikeOpaqueToken(bare)) return name;
      }
      const kind = String(node?.getAttribute?.("type") || "").toLowerCase();
      if (kind === "tel") return "Phone";
      if (kind === "email") return "Email";
      return "";
    })(el);
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
      elementRect: (function captureElementRect(node) {
        if (!node || typeof node.getBoundingClientRect !== "function") return null;
        const r = node.getBoundingClientRect();
        if (!r || (r.width < 2 && r.height < 2)) return null;
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          dpr: window.devicePixelRatio || 1,
        };
      })(el),
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

  let phoneCaptureTimer = 0;
  let phoneCaptureEl = null;
  function schedulePhoneCapture(el) {
    if (!el) return;
    phoneCaptureEl = el;
    if (phoneCaptureTimer) clearTimeout(phoneCaptureTimer);
    phoneCaptureTimer = setTimeout(() => {
      phoneCaptureTimer = 0;
      const target = phoneCaptureEl;
      phoneCaptureEl = null;
      if (!target) return;
      const payload = captureDescribe(target, "input");
      if (payload) postCaptureEvent(payload);
    }, 350);
  }

  function onCapturePhoneInput(event) {
    const tel = captureTelFromEvent(event);
    if (tel) schedulePhoneCapture(tel);
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

  document.addEventListener("change", onCaptureChange, true);
  document.addEventListener("focusout", onCaptureChange, true);
  document.addEventListener("input", onCapturePhoneInput, true);
  document.addEventListener("click", onCaptureClick, true);
  if (!window.__ltValueHook && EventTarget?.prototype?.dispatchEvent) {
    const origDispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function ltCaptureDispatch(event) {
      try {
        const type = String(event?.type || "");
        if (/(change|commit)$/i.test(type) && !/input$/i.test(type) && !/^(change|focusout|blur)$/i.test(type) && !/selection/i.test(type)) {
          onCaptureChange(event);
        }
      } catch {
        /* ignore */
      }
      return origDispatch.call(this, event);
    };
    window.__ltValueHook = true;
  }
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
  isNavigationClickLabel,
  isNavigationSelector,
  captureIsUsefulQuestionLabel,
  capturePickQuestionCandidate,
  captureParseOptionAriaQuestion,
  installLiveTrackPageCapture,
  pageCaptureInstallerSource,
  pageCaptureEnableSource,
  pageCaptureDrainSource,
};
