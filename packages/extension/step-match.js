/**
 * Pure helpers for queue-card step tracking.
 * A later step must not turn green just because an earlier Yes/No (or a
 * generic selector like promptOption / OneYesNo) is already filled.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.__ltStepMatch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isShortOptionLabel(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 40) return false;
    return /^(yes|no|y|n|true|false|on|off)$/i.test(t);
  }

  function isWeakQuestionHint(text) {
    const t = normalize(text).replace(/[^a-z0-9]+/g, "");
    if (!t) return true;
    return /^(one|two|three|four|five|six)?(yesno|text|textarea|dropdown|multiselect|checkbox|radio|date|number|integer)$/.test(
      t
    );
  }

  function matchModeForHint(hint) {
    return normalize(hint).length <= 8 ? "exact" : "includes";
  }

  function titleMatches(title, hint, mode) {
    const h = normalize(hint);
    const t = normalize(title);
    if (!h || !t) return false;
    if (mode === "exact") return t === h || t === `${h} *` || t.startsWith(`${h} `);
    if (mode === "startsWith") return t.startsWith(h);
    if (t.includes(h)) return true;
    return t.length >= 20 && h.includes(t);
  }

  function isStableGuiSelector(sel) {
    const s = String(sel || "").trim();
    if (!s) return false;
    if (/^(input|select|textarea|button|div|span|label|a)(\[type=(["'])?.+\3\])?$/i.test(s)) return false;
    return s.startsWith("#") || /\[(name|id|data-automation-id|data-testid|data-test)=/i.test(s);
  }

  function distinctiveQuestionHints(step) {
    const raw = [];
    const push = (value) => {
      if (value == null || value === "") return;
      if (Array.isArray(value)) {
        value.forEach(push);
        return;
      }
      raw.push(value);
    };
    push(step?.findByLabel);
    push(step?.label);
    push(step?.finder);
    const boxes = step?.findCheckboxByLabel;
    if (Array.isArray(boxes)) boxes.forEach((b) => (!isShortOptionLabel(b) ? push(b) : null));
    else if (boxes && !isShortOptionLabel(boxes)) push(boxes);

    const out = [];
    const seen = new Set();
    for (const item of raw) {
      const h = normalize(item);
      if (!h || isShortOptionLabel(h) || isWeakQuestionHint(h)) continue;
      if (seen.has(h)) continue;
      seen.add(h);
      out.push(h);
    }
    return out;
  }

  function titleMatchScore(title, hints) {
    const t = normalize(title);
    if (!t || !hints || !hints.length) return 0;
    let best = 0;
    for (const hint of hints) {
      const h = normalize(hint);
      if (!h) continue;
      if (!titleMatches(t, h, matchModeForHint(h))) continue;
      best = Math.max(best, h.length);
    }
    return best;
  }

  function looksLikePlaceholder(text) {
    const t = normalize(text);
    if (!t) return true;
    return /^(yyyy|yy|mm|dd|select(\s+one)?|select an option|select\.\.\.|please select( one)?|choose(\s+one)?|choose an option|required|\*+|–|—|-)$/.test(
      t
    );
  }

  function containsUnselectedPrompt(text) {
    const t = normalize(text);
    if (!t) return true;
    return /\b(select one|select an option|please select( one)?|choose one|choose an option)\b/.test(
      t
    );
  }

  function stripQuestionPrefix(value, questions) {
    let t = normalize(value);
    if (!t) return "";
    const titles = (Array.isArray(questions) ? questions : [questions])
      .map((q) => normalize(q))
      .filter((q) => q.length >= 12)
      .sort((a, b) => b.length - a.length);
    for (const q of titles) {
      if (t === q) return "";
      if (t.startsWith(q)) {
        t = t.slice(q.length).replace(/^[\s:*–—-]+/, "").trim();
        break;
      }
    }
    return t;
  }

  /**
   * Visible widget copy is not a chosen answer when it is still the
   * placeholder, the question prompt, or a dumped option list.
   */
  function effectiveChoiceValue(raw, questions) {
    const source = normalize(raw);
    if (!source) return "";
    if (containsUnselectedPrompt(source) || looksLikePlaceholder(source)) return "";
    let t = stripQuestionPrefix(source, questions);
    if (!t || looksLikePlaceholder(t) || containsUnselectedPrompt(t)) return "";
    if (t.endsWith("?") && t.length > 24) return "";
    return t;
  }

  function stepValueHints(step) {
    const raw = [];
    const push = (value) => {
      if (value == null || value === "") return;
      if (Array.isArray(value)) {
        value.forEach(push);
        return;
      }
      raw.push(value);
    };
    push(step?.findByLabel);
    push(step?.label);
    push(step?.finder);
    push(step?.allowedValues);
    push(step?.findByText);
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      const h = normalize(item);
      if (!h || isShortOptionLabel(h) || isWeakQuestionHint(h)) continue;
      if (seen.has(h)) continue;
      seen.add(h);
      out.push(h);
    }
    return out;
  }

  function controlMatchScore(control, hints) {
    const list = hints || [];
    if (!list.length) return 0;
    const parts = [control?.title, control?.aria, control?.placeholder]
      .map((v) => normalize(v))
      .filter(Boolean);
    let best = 0;
    for (const part of parts) {
      best = Math.max(best, titleMatchScore(part, list));
      const compact = part.replace(/[^a-z0-9]+/g, "");
      for (const hint of list) {
        const h = normalize(hint).replace(/[^a-z0-9]+/g, "");
        if (h && compact === h) best = Math.max(best, hint.length || h.length);
        if (h === "yyyy" && /\b(year|yyyy|from|to)\b/.test(part)) best = Math.max(best, 4);
      }
    }
    const value = effectiveChoiceValue(control?.value, [control?.title, control?.aria]);
    if (value && !isShortOptionLabel(value) && value.length >= 2) {
      for (const hint of list) {
        const h = normalize(hint);
        if (!h || isShortOptionLabel(h)) continue;
        if (value === h || value.includes(h) || (h.length >= 4 && h.includes(value))) {
          best = Math.max(best, h.length);
        }
        if (h === "yyyy" && /^\d{4}$/.test(value)) best = Math.max(best, 4);
      }
    }
    return best;
  }

  function pickBestStepForControl(steps, control) {
    let best = null;
    let bestScore = 0;
    for (const step of steps || []) {
      const action = String(step?.action || "");
      if (action === "highlight" || action === "wait") continue;
      const hints = stepValueHints(step);
      const score = controlMatchScore(control, hints);
      if (score > bestScore) {
        bestScore = score;
        best = step;
      }
    }
    return bestScore > 0 ? best : null;
  }

  /**
   * Words on a click step's button. A short label counts, because the studio
   * renames the step ("Clear form") without updating findByText ("Submit").
   * Question-length labels are not button text.
   */
  function clickButtonHints(step) {
    const raw = [];
    const push = (value) => {
      if (value == null || value === "") return;
      if (Array.isArray(value)) {
        value.forEach(push);
        return;
      }
      raw.push(value);
    };
    push(step?.findByText);
    push(step?.findButtonByText);
    const label = String(step?.label || "")
      .replace(/\s+/g, " ")
      .trim();
    if (label && label.length <= 48 && !/[?]/.test(label)) push(label);
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      const h = normalize(item);
      if (!h || seen.has(h)) continue;
      seen.add(h);
      out.push(h);
    }
    return out;
  }

  function buttonTextMatchesHint(text, hint) {
    const t = normalize(text);
    const h = normalize(hint);
    if (!t || !h || t.length > 120) return false;
    if (t === h) return true;
    if (h.length < 4 || h.length > 48) return false;
    if (t.includes(h)) return true;
    return t.length <= 48 && h.includes(t);
  }

  /** Click step whose button text is what the user clicked. Prefer preferId when several match. */
  function pickClickStepByButtonText(steps, text, { preferId = "" } = {}) {
    const matches = [];
    for (const step of steps || []) {
      if (String(step?.action || "") !== "click") continue;
      if (clickButtonHints(step).some((h) => buttonTextMatchesHint(text, h))) matches.push(step);
    }
    if (!matches.length) return null;
    if (preferId) {
      const preferred = matches.find((step) => step.id === preferId);
      if (preferred) return preferred;
    }
    return matches[matches.length - 1];
  }

  function pickBestStepForTitle(steps, title) {
    let best = null;
    let bestScore = 0;
    for (const step of steps || []) {
      const action = String(step?.action || "");
      if (action === "highlight" || action === "wait") continue;
      const score = titleMatchScore(title, distinctiveQuestionHints(step));
      if (score > bestScore) {
        bestScore = score;
        best = step;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function optionMatchesExpected(actual, expectedList) {
    const a = normalize(actual);
    if (!a) return false;
    const list = (Array.isArray(expectedList) ? expectedList : [])
      .map((v) => normalize(v))
      .filter(Boolean);
    if (!list.length) return true;
    return list.some((e) => {
      if (a === e) return true;
      if (e.length <= 12 && (a.startsWith(`${e} `) || a.endsWith(` ${e}`) || a.includes(` ${e} `))) {
        return true;
      }
      return a.includes(e) || (e.length >= 4 && e.includes(a));
    });
  }

  function evaluateCheckSelection(actual, expectedList) {
    const a = String(actual || "").trim();
    if (!a) return { ok: false, empty: true };
    if (!optionMatchesExpected(a, expectedList)) {
      const list = (Array.isArray(expectedList) ? expectedList : []).filter((v) => String(v || "").trim());
      return { ok: false, wrong: true, expected: String(list[0] || "") };
    }
    return { ok: true };
  }

  return {
    normalize,
    isShortOptionLabel,
    isWeakQuestionHint,
    matchModeForHint,
    titleMatches,
    distinctiveQuestionHints,
    titleMatchScore,
    pickBestStepForTitle,
    looksLikePlaceholder,
    containsUnselectedPrompt,
    effectiveChoiceValue,
    stepValueHints,
    controlMatchScore,
    pickBestStepForControl,
    clickButtonHints,
    buttonTextMatchesHint,
    pickClickStepByButtonText,
    optionMatchesExpected,
    evaluateCheckSelection,
    isStableGuiSelector,
  };
});
