const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_PORT = 17322;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Access-Control-Request-Private-Network",
  "Access-Control-Allow-Private-Network": "true",
};

function demoHtmlPath(name) {
  const file = String(name || "").replace(/[^a-z0-9._-]+/gi, "");
  if (!file.endsWith(".html")) return null;
  const candidates = [
    path.join(__dirname, "..", "demo", file),
    path.join(process.resourcesPath || "", "demo", file),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    ...CORS,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function captureDataDir() {
  try {
    const { resolveExecutionsRoot } = require("./settings");
    return path.join(resolveExecutionsRoot(), "capture");
  } catch {
    return path.join(os.homedir(), ".coact", "capture");
  }
}

function dayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function issueKeyFromUrl(url) {
  const m = String(url || "").match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
  return m ? m[1].toUpperCase() : "";
}

function looksLikeOpaqueId(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{18,}$/i.test(v)) return true;
  if (/^[0-9a-f]{20,}$/i.test(v)) return true;
  return false;
}

/**
 * Stable REF for capture sessions without a Jira browse key.
 * Format: REF-YYYYMMDD-XXXXX
 */
function generateCaptureRef(seed, at = new Date()) {
  const when = at instanceof Date ? at : new Date(at || Date.now());
  const day = Number.isNaN(when.getTime())
    ? new Date().toISOString().slice(0, 10).replace(/-/g, "")
    : when.toISOString().slice(0, 10).replace(/-/g, "");
  const s = String(seed || "").trim() || `ref-${Date.now()}`;
  let hash = 2166136261;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (Math.abs(hash) % 1_048_575).toString(36).toUpperCase().padStart(4, "0").slice(0, 5);
  return `REF-${day}-${suffix}`;
}

function isJiraBrowseKey(ticket) {
  return /^[A-Z][A-Z0-9]+-\d+$/i.test(String(ticket || "").trim());
}

function isCaptureRefKey(ticket) {
  return /^REF-\d{8}-[A-Z0-9]+$/i.test(String(ticket || "").trim()) || /^REF-\d{6}$/i.test(String(ticket || "").trim());
}

function isNoiseCaptureUrl(url) {
  const href = String(url || "");
  if (/127\.0\.0\.1:17322|localhost:17322/.test(href)) return true;
  if (/\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(href)) return true;
  if (/cloudhelp|jira-mock/i.test(href)) return true;
  return false;
}

function truncateCaptureText(value, max = 200) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max);
}

/** Workday/internal option ids and bare tag selectors are not human field keys. */
function isJunkCaptureName(name) {
  const n = String(name || "").replace(/\s+/g, " ").trim();
  if (!n) return true;
  const bareId = n.replace(/^#/, "");
  if (/^react-select-\d+/i.test(bareId)) return true;
  if (/use up and down to choose/i.test(n)) return true;
  if (/check all that apply|select all that apply|choose all that apply/i.test(n)) return true;
  if (/^\([^)]*\)$/.test(n)) return true;
  if (/press enter to select/i.test(n) && /press (escape|tab)/i.test(n)) return true;
  if (/press tab to select the option/i.test(n)) return true;
  if (/^(input|select|textarea|button|div|span|label)$/i.test(n)) return true;
  // Generic test-automation ids some sites assign in place of real names
  // ("select-one", "input-two", "field3", bare "one"/"two", ...) — never a
  // real question, so never worth showing as a field's name. Strip CSS
  // selector wrapping (#id, [name="..."]) first so the fallback selector
  // string doesn't just re-leak the same generic token in disguise, and
  // check this BEFORE the generic "[name=...] is fine" rule below, which
  // would otherwise let it through unexamined.
  const bare = n
    .replace(/^#/, "")
    .replace(/^\[[\w-]+=["']?/, "")
    .replace(/["'\]]+$/, "");
  if (
    /^(select|input|field|option|choice|dropdown|radio|checkbox|text|textbox|combo|combobox)[-_]?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,3})([-_]?\d{1,3})?$/i.test(
      bare,
    )
  ) {
    return true;
  }
  if (/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)([-_]?\d{1,3})?$/i.test(bare)) return true;
  // Long unbroken alphanumeric blobs with several embedded digit groups look
  // like concatenated codes (e.g. a checkbox group's id built by joining
  // each option's short code, "s6s7s63s65s66s24no"), not a real word.
  if (!/[\s_-]/.test(bare) && bare.length > 12 && (bare.match(/\d+/g) || []).length >= 2) return true;
  if (/^\[?(name|id|type)=/i.test(n)) return false;
  if (/^[a-f0-9]{16,}$/i.test(n)) return true;
  if (/^(primaryquestionnaire--|wd-|input-|select-)/i.test(n) && n.length > 24) return true;
  return false;
}

function isJunkCaptureValue(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  // Opaque Workday option / widget ids (not typed user text)
  if (/^[a-f0-9]{20,}$/i.test(v)) return true;
  if (/^[a-f0-9]{8,}(-[a-f0-9]{4,}){2,}$/i.test(v)) return true;
  return false;
}

const NAV_CLICK_LABEL_RE =
  /^(save and continue|save & continue|submit|next|continue|back|previous|cancel|apply|add another|add|sign in|search|upload|remove|edit|delete)$/i;
const NAV_CLICK_SELECTOR_RE =
  /pageFooterNextButton|add-button|signInSubmitButton|bottom-navigation|wizardNext|continueButton/i;

function isNavigationClickLabel(text) {
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 48) return false;
  return NAV_CLICK_LABEL_RE.test(t);
}

function isNavigationSelector(selector) {
  return NAV_CLICK_SELECTOR_RE.test(String(selector || ""));
}

function navigationClickName(step = {}) {
  for (const candidate of [step.value, step.selectedText, step.label, step.fieldName]) {
    if (isNavigationClickLabel(candidate)) return String(candidate).replace(/\s+/g, " ").trim();
  }
  return "";
}

/** Footer / Add / Submit clicks — never store as a field value on a nearby question. */
function isNavigationClick(step = {}) {
  if (isNavigationSelector(step.selector)) return true;
  return Boolean(navigationClickName(step));
}

function shouldKeepCaptureEvent(event) {
  if (!event || typeof event !== "object") return false;
  if (isNoiseCaptureUrl(event.pageUrl)) return false;
  const action = String(event.action || "").toLowerCase();
  if (action === "click") {
    return Boolean(truncateCaptureText(event.label || event.value || event.fieldName, 120));
  }
  if (!["input", "change", "select", "check", "fill"].includes(action)) return false;
  const rawValue = event.value != null && String(event.value).trim() !== "" ? event.value : event.selectedText;
  const value = truncateCaptureText(rawValue, 2000);
  if (!value && action !== "check") return false;
  // Choice events: keep whenever there is an option value (question may arrive later / be resolved in UI)
  if ((action === "check" || action === "select") && value) return true;
  const humanName = String(event.fieldName || event.label || event.key || "").trim();
  if (humanName && !isJunkCaptureName(humanName)) {
    if (isJunkCaptureValue(value) && action !== "check") return false;
    return true;
  }
  // Bare CSS tag selectors are not field keys (Workday fires change on anonymous inputs)
  const fallback = String(event.selector || "").trim();
  if (isJunkCaptureName(fallback) || isJunkCaptureValue(value)) return false;
  return Boolean(fallback);
}

function applyExplanationPatches(eventList) {
  const byId = new Map();
  const out = [];
  for (const event of eventList || []) {
    if (!event || typeof event !== "object") continue;
    if (String(event.kind || "") === "step_explanation") {
      const id = String(event.captureEventId || "").trim();
      const text = String(event.explanation || "").replace(/\s+/g, " ").trim();
      const prev = id ? byId.get(id) : null;
      if (prev && text) prev.explanation = text;
      continue;
    }
    if (String(event.kind || "") === "step_screenshot") {
      const id = String(event.captureEventId || "").trim();
      const prev = id ? byId.get(id) : null;
      if (prev) require("./capture-step-shot").copyScreenshotMeta(event, prev);
      continue;
    }
    const id = String(event.captureEventId || "").trim();
    if (id) byId.set(id, event);
    out.push(event);
  }
  return out;
}

function stableGuiSelector(sel) {
  const s = String(sel || "").trim();
  if (!s) return "";
  if (/^(input|select|textarea|button|div|span|label|a)(\[type=.*\])?$/i.test(s)) return "";
  if (s.startsWith("#") || /\[(name|id|data-automation-id|data-testid|data-test)=/i.test(s)) return s;
  return "";
}

function stampShot(target, event) {
  const next = require("./capture-step-shot").copyScreenshotMeta(event, target);
  if (event?.captureEventId) next.captureEventId = String(event.captureEventId);
  if (event?.ts && !next.stepAt) next.stepAt = event.ts;
  const finder = truncateCaptureText(event?.finder || "", 240);
  const label = String(next.label || next.fieldName || "").trim();
  if (finder && finder.toLowerCase() !== label.toLowerCase()) next.finder = finder;
  const guiId = String(event?.guiId || "").trim() || stableGuiSelector(event?.selector) || stableGuiSelector(next.selector);
  if (guiId) next.guiId = guiId;
  return next;
}

function upsertClick(row, event, click) {
  const label = String(click?.label || "").trim();
  const selector = String(click?.selector || "");
  const prev = row.clicks[row.clicks.length - 1];
  if (prev && prev.label === label && prev.selector === selector) {
    stampShot(prev, event);
    const last = row.steps[row.steps.length - 1];
    if (
      last &&
      last.action === "click" &&
      last.label === label &&
      String(last.selector || "") === selector
    ) {
      stampShot(last, event);
    }
    return;
  }
  const stamped = stampShot({ ...click, label, selector }, event);
  row.clicks.push(stamped);
  row.steps.push(stampShot({ ...stamped, pageUrl: event.pageUrl || row.pageUrl }, event));
}

function writeCaptureSnapshot(transactions) {
  try {
    const dir = captureDataDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "transactions.json"),
      `${JSON.stringify({
        savedAt: new Date().toISOString(),
        transactions: Array.isArray(transactions) ? transactions : [],
      })}\n`
    );
  } catch {
    /* disk optional */
  }
}

function nameFromFieldSelector(selector) {
  const raw = String(selector || "").trim();
  const named = raw.match(/^\[name="([^"]+)"\]$/);
  if (named) {
    const name = named[1].replace(/\s+/g, " ").trim();
    if (name && !isJunkCaptureName(name)) return name;
  }
  if (raw === 'input[type="tel"]') return "Phone";
  if (raw === 'input[type="email"]') return "Email";
  const id = raw.match(/^#([A-Za-z][A-Za-z0-9_]*)$/);
  if (id && !/metadata|group|label|input|button/i.test(id[1])) {
    const words = id[1].replace(/^field_/, "").replace(/_/g, " ").trim();
    if (words.length >= 3 && !isJunkCaptureName(words)) {
      return words.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
    }
  }
  return "";
}

function questionLabelScore(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s || isJunkCaptureName(s)) return -1;
  let score = Math.min(s.length, 180);
  if (/[?]/.test(s)) score += 1000;
  if (/\*/.test(s)) score += 80;
  if (/\s/.test(s)) score += 200;
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(s)) score -= 400;
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(s)) score -= 250;
  return score;
}

function betterQuestionLabel(current, incoming) {
  return questionLabelScore(incoming) >= questionLabelScore(current) ? incoming || current : current || incoming;
}

function selectWithin(events, index) {
  const start = Date.parse(events[index]?.ts || "") || 0;
  for (let j = index + 1; j < events.length && j < index + 8; j += 1) {
    const next = events[j];
    const at = Date.parse(next?.ts || "") || 0;
    if (start && at && at - start > 500) return null;
    if (String(next?.action || "").toLowerCase() === "select") return next;
  }
  return null;
}

function groupCaptureEvents(eventList) {
  const groups = new Map();
  const patched = applyExplanationPatches(eventList);
  for (let index = 0; index < patched.length; index += 1) {
    const event = patched[index];
    if (!shouldKeepCaptureEvent(event)) continue;
    const id = String(
      event.recordingSessionId || event.sessionId || event.cardId || event.transactionId || "session"
    );
    if (!groups.has(id)) {
      groups.set(id, {
        transactionId: id,
        startedAt: event.ts,
        completedAt: event.ts,
        pageUrl: event.pageUrl || "",
        pageTitle: event.pageTitle || "",
        cardId: String(event.cardId || ""),
        queueCard: String(event.queueCard || ""),
        lob: String(event.lob || ""),
        user: String(event.user || event.user_id || ""),
        fields: {},
        clicks: [],
        steps: [],
      });
    }
    const row = groups.get(id);
    row.completedAt = event.ts;
    if (event.pageUrl) row.pageUrl = event.pageUrl;
    if (event.pageTitle) row.pageTitle = event.pageTitle;
    if (event.cardId) row.cardId = String(event.cardId);
    if (event.queueCard) row.queueCard = String(event.queueCard);
    if (event.user || event.user_id) row.user = String(event.user || event.user_id);
    const action = String(event.action || "").toLowerCase();
    const selector = String(event.selector || "").trim();
    const isBareOption = (t) =>
      /^(yes|no|y|n|true|false|on|off)$/i.test(String(t || "").trim());
    const isShortOption = (t) => {
      const s = String(t || "").trim();
      if (!s || s.length > 64) return false;
      if (isBareOption(s)) return true;
      if (/^https?:/i.test(s)) return false;
      if (/save and continue|submit|next|continue|back|cancel|apply|sign in/i.test(s)) return false;
      // Only treat very short tokens as "option answers" when deciding Field vs Value
      return false;
    };
    if (action === "click" || (action === "check" && isNavigationClick(event))) {
      const fieldName = truncateCaptureText(event.fieldName || "", 240);
      const value = truncateCaptureText(
        event.value != null && String(event.value).trim() !== ""
          ? event.value
          : event.selectedText || "",
        200
      );
      const label = truncateCaptureText(event.label || value || fieldName, 120);
      if (!label && !value && !fieldName) continue;
      const navName = navigationClickName({ ...event, label, value, selector }) || (isNavigationSelector(selector) ? value || label : "");
      if (navName || isNavigationSelector(selector)) {
        const clickLabel = navName || value || label || "click";
        upsertClick(
          row,
          event,
          {
            action: "click",
            label: clickLabel,
            selector,
            value: clickLabel,
          }
        );
        continue;
      }
      const question =
        fieldName && !isJunkCaptureName(fieldName) && !isBareOption(fieldName)
          ? fieldName
          : label && !isJunkCaptureName(label) && !isBareOption(label)
            ? label
            : "";
      const answer = value || (isBareOption(label) ? label : "");
      // Question + chosen option → store as check (keeps Field/Value distinct)
      if (question && answer && question.toLowerCase() !== String(answer).toLowerCase()) {
        row.fields[question] = answer;
        const last = row.steps[row.steps.length - 1];
        if (
          last &&
          (last.action === "check" || last.action === "click") &&
          (last.fieldName === question || last.label === question) &&
          last.selector === selector
        ) {
          last.action = "check";
          last.fieldName = question;
          last.label = question;
          last.value = answer;
          last.selectedText = answer;
          last.selector = selector || last.selector;
          stampShot(last, event);
        } else {
          row.steps.push(
            stampShot(
              {
                action: "check",
                label: question,
                fieldName: question,
                selector,
                value: answer,
                selectedText: answer,
                pageUrl: event.pageUrl || row.pageUrl,
              },
              event
            )
          );
        }
        continue;
      }
      const click = {
        action: "click",
        label: label || answer || fieldName,
        selector,
      };
      if (fieldName && !isJunkCaptureName(fieldName)) click.fieldName = fieldName;
      if (value) click.value = value;
      upsertClick(row, event, click);
      continue;
    }
    const humanFromSelector = nameFromFieldSelector(selector);
    const explicitName = String(event.fieldName || event.label || event.key || "").trim();
    const humanName =
      explicitName && !isJunkCaptureName(explicitName) ? explicitName : humanFromSelector || explicitName;
    const name = !isJunkCaptureName(humanName)
      ? humanName
      : !isJunkCaptureName(selector)
        ? selector
        : "";
    const value = truncateCaptureText(
      event.value != null && String(event.value).trim() !== "" ? event.value : event.selectedText,
      200
    );
    const selectedText = truncateCaptureText(event.selectedText, 200);
    // Keep real typed/selected values even when the DOM id is opaque — use label if human
    if ((!name || isJunkCaptureName(name)) && value && !isJunkCaptureValue(value)) {
      const alt = String(event.label || "").trim();
      if (alt && !isJunkCaptureName(alt) && !isShortOption(alt)) {
        // fall through with alt as name below
      } else if (action === "check" || action === "select") {
        /* choice without question kept via Answer N in display cleaner */
      } else {
        continue;
      }
    }
    const resolvedName =
      name && !isJunkCaptureName(name)
        ? name
        : (() => {
            const alt = String(event.label || "").trim();
            return alt && !isJunkCaptureName(alt) ? alt : name;
          })();
    if (!resolvedName || isJunkCaptureName(resolvedName)) {
      if (!(action === "check" || action === "select") || !value) continue;
    }
    const finalNameRaw =
      resolvedName && !isJunkCaptureName(resolvedName) ? resolvedName : String(event.label || value || "Answer").trim();
    let finalName = finalNameRaw;
    // Avoid Field=Yes / Value=Yes — use Answer placeholder until question is known
    if (
      finalName &&
      value &&
      isBareOption(finalName) &&
      String(finalName).toLowerCase() === String(value).toLowerCase()
    ) {
      finalName = "Answer";
    }
    if (isJunkCaptureName(finalName)) {
      const finder = String(event.finder || "").trim();
      if (finder && !isJunkCaptureName(finder)) finalName = finder;
      else {
        const guiTry = String(event.guiId || stableGuiSelector(String(event.selector || "")) || "").trim();
        if (guiTry && value && (action === "check" || action === "select")) {
          for (let i = row.steps.length - 1; i >= 0; i -= 1) {
            const prev = row.steps[i];
            if (!prev || prev.guiId !== guiTry || isJunkCaptureName(prev.label)) continue;
            prev.value = String(value);
            if (prev.label) row.fields[prev.label] = String(value);
            break;
          }
        }
        continue;
      }
    }
    if (!finalName) continue;
    // A dropdown click emits a change whose label is the option and whose value
    // is a 1-character code, then the real select ~60ms later. The short change
    // is not a field. If the select only kept the search fragment, use the option.
    if (action === "change" && String(value || "").length <= 1 && questionLabelScore(finalName) < 400) {
      const upcoming = selectWithin(patched, index);
      if (upcoming) {
        const selVal = String(upcoming.value || upcoming.selectedText || "").trim();
        if (
          selVal &&
          selVal.length <= 12 &&
          finalName.length > selVal.length &&
          finalName.toLowerCase() !== selVal.toLowerCase()
        ) {
          upcoming.value = finalName;
          upcoming.selectedText = finalName;
        }
        continue;
      }
    }
    if (isJunkCaptureValue(value) && action !== "check" && action !== "select") continue;
    if (finalName && (value || action === "check" || action === "select")) {
      const fillAction = action === "check" || action === "select" ? action : "fill";
      const displayValue = value || selectedText || "checked";
      if (
        fillAction === "check" &&
        /\*$/.test(finalName) &&
        /\*$/.test(displayValue) &&
        finalName.toLowerCase() !== displayValue.toLowerCase()
      ) {
        continue;
      }
      if (isNavigationClick({ label: finalName, value: displayValue, selector, selectedText })) {
        const clickLabel = navigationClickName({ label: finalName, value: displayValue, selector }) || displayValue;
        upsertClick(row, event, {
          action: "click",
          label: clickLabel,
          selector,
          value: clickLabel,
        });
        continue;
      }
      // Prefer human labels over opaque ids in the fields map
      row.fields[finalName] = displayValue;
      const last = row.steps[row.steps.length - 1];
      const stepLabel =
        humanFromSelector && (!explicitName || isJunkCaptureName(explicitName))
          ? humanFromSelector
          : String(event.label || finalName).trim() &&
              !isJunkCaptureName(String(event.label || "").trim()) &&
              !isShortOption(event.label)
            ? String(event.label || finalName).trim()
            : finalName;
      const gui = String(event.guiId || stableGuiSelector(selector) || "").trim();
      if (fillAction === "check" || fillAction === "select") {
        let prior = null;
        for (let i = row.steps.length - 1; i >= 0; i -= 1) {
          const prev = row.steps[i];
          if (!prev || (prev.action !== "check" && prev.action !== "select")) continue;
          const sameGui = gui && prev.guiId && prev.guiId === gui;
          const sameName =
            (finalName && (prev.fieldName === finalName || prev.label === finalName)) ||
            (stepLabel && (prev.label === stepLabel || prev.fieldName === stepLabel));
          if (!sameGui && !sameName) continue;
          const priorText = prev.label || prev.fieldName || "";
          const nextText = stepLabel || finalName || "";
          const distinctQuestions =
            sameGui &&
            !sameName &&
            questionLabelScore(priorText) >= 400 &&
            questionLabelScore(nextText) >= 400 &&
            String(priorText).toLowerCase() !== String(nextText).toLowerCase();
          if (distinctQuestions) continue;
          prior = prev;
          break;
        }
        if (prior) {
          const oldLabel = prior.label;
          const kept = betterQuestionLabel(oldLabel || prior.fieldName, stepLabel || finalName);
          prior.value = displayValue;
          prior.action = fillAction;
          prior.selector = selector || prior.selector;
          prior.label = kept || prior.label;
          prior.fieldName = kept || finalName || prior.fieldName;
          if (selectedText) prior.selectedText = selectedText;
          if (gui) prior.guiId = gui;
          if (oldLabel && oldLabel !== prior.label) delete row.fields[oldLabel];
          row.fields[prior.label || finalName] = displayValue;
          stampShot(prior, event);
          continue;
        }
      }
      // Collapse "Click Yes" + following check into one check step when labels match
      if (
        last &&
        last.action === "click" &&
        fillAction === "check" &&
        isShortOption(last.label) &&
        (isShortOption(displayValue) ||
          String(last.label || "").toLowerCase() === String(displayValue).toLowerCase())
      ) {
        last.action = "check";
        last.value = displayValue;
        last.selectedText = selectedText || displayValue;
        last.fieldName = finalName;
        last.label = isShortOption(stepLabel) ? finalName : stepLabel;
        last.selector = selector || last.selector;
        row.fields[last.label] = displayValue;
        stampShot(last, event);
        continue;
      }
      if (
        last &&
        last.action !== "click" &&
        (last.fieldName === finalName || last.label === finalName || last.label === stepLabel)
      ) {
        last.value = value || last.value;
        last.action = fillAction;
        last.selector = selector || last.selector;
        last.label = stepLabel;
        last.fieldName = finalName || last.fieldName;
        if (selectedText) last.selectedText = selectedText;
        stampShot(last, event);
      } else {
        row.steps.push(
          stampShot(
            {
              action: fillAction,
              label: stepLabel,
              fieldName: finalName,
              selector,
              value: displayValue,
              selectedText,
              pageUrl: event.pageUrl || row.pageUrl,
            },
            event
          )
        );
      }
    }
  }
  return [...groups.values()]
    .map((row) => {
      const values = Object.fromEntries(
        Object.entries(row.fields).filter(([, value]) => String(value || "").trim())
      );
      const ticket = captureTicketFor(row);
      const formReferenceGenerated = !issueKeyFromUrl(row.pageUrl) && !isJiraBrowseKey(ticket);
      const unmatched = !String(row.cardId || "").trim();
      const payload = {
        ticket,
        formReference: ticket,
        formReferenceGenerated,
        recordingSessionId: row.transactionId,
        cardId: row.cardId,
        queueCard: row.queueCard,
        lob: row.lob,
        user: row.user || "",
        url: row.pageUrl,
        title: row.pageTitle,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        values,
        clicks: row.clicks,
        steps: row.steps,
        unmatched,
      };
      return {
        ticket,
        formReference: ticket,
        formReferenceGenerated,
        transactionId: row.transactionId,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        pageUrl: row.pageUrl,
        pageTitle: row.pageTitle,
        cardId: row.cardId,
        queueCard: row.queueCard,
        unmatched,
        fields: values,
        clicks: row.clicks,
        steps: row.steps,
        payload: JSON.stringify(payload),
      };
    })
    .filter((row) => Object.keys(row.fields).length > 0 || row.clicks.length > 0);
}

function captureTicketFor(row) {
  const existing = String(row?.formReference || row?.ticket || "").trim();
  if (existing && (isJiraBrowseKey(existing) || isCaptureRefKey(existing))) return existing;
  if (existing && !/^CAP-[0-9a-f-]+$/i.test(existing)) return existing;
  const fromUrl = issueKeyFromUrl(row?.pageUrl);
  if (fromUrl) return fromUrl;
  const seed = String(row?.transactionId || row?.recordingSessionId || row?.pageUrl || Date.now()).trim();
  const at = row?.startedAt || row?.completedAt || Date.now();
  return generateCaptureRef(seed, at);
}

function createCaptureStore() {
  /** @type {object[]} */
  const events = [];
  let recording = false;
  let recordingSessionId = "";
  let recordingCardId = "";
  let recordingQueueCard = "";
  let recordingLob = "";
  let recordingUser = "";

  function recordingPayload() {
    return {
      recording,
      paused: !recording && Boolean(recordingSessionId),
      ready: true,
      chromeLive: true,
      playwright: null,
      recordingSessionId: recordingSessionId || null,
      cardId: recordingCardId || null,
    };
  }

  function setRecording(body = {}) {
    const action = String(body.action || "").toLowerCase();
    const start =
      body.recording === true || action === "start" || body.start === true;
    const stop =
      body.recording === false || action === "stop" || body.stop === true;
    const pause = action === "pause" || body.pause === true;
    const resume = action === "resume" || body.resume === true;

    if (pause) {
      recording = false;
      return recordingPayload();
    }
    if (resume) {
      recording = true;
      if (!recordingSessionId) recordingSessionId = crypto.randomUUID();
      if (body.cardId) recordingCardId = String(body.cardId || "").trim();
      if (body.queueCard) recordingQueueCard = String(body.queueCard || "").trim();
      if (body.lob) recordingLob = String(body.lob || "").trim();
      if (body.user || body.user_id) {
        recordingUser = String(body.user || body.user_id || "").trim();
      }
      return recordingPayload();
    }
    if (start && !stop) {
      recording = true;
      recordingSessionId = crypto.randomUUID();
      recordingCardId = String(body.cardId || "").trim();
      recordingQueueCard = String(body.queueCard || "").trim();
      recordingLob = String(body.lob || "").trim();
      recordingUser = String(body.user || body.user_id || "").trim();
    } else if (stop) {
      recording = false;
      try {
        writeCaptureSnapshot(groupCaptureEvents(events));
      } catch {
        /* persist even if live memory is about to be unused */
      }
      recordingSessionId = "";
      recordingCardId = "";
      recordingQueueCard = "";
      recordingLob = "";
      recordingUser = "";
    }
    return recordingPayload();
  }

  async function setRecordingAsync(body = {}) {
    const action = String(body.action || "").toLowerCase();
    const stop = body.recording === false || action === "stop" || body.stop === true;
    if (stop) {
      recording = false;
      try {
        const flush = require("./capture-step-shot").flushStepShots();
        await Promise.race([
          Promise.resolve(flush).catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
      } catch {
        /* shots optional */
      }
    }
    return setRecording(body);
  }

  function appendJsonl(event) {
    try {
      const dir = captureDataDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(
        path.join(dir, `events-${dayStamp()}.jsonl`),
        `${JSON.stringify(event)}\n`
      );
    } catch {
      /* disk optional */
    }
  }

  function ingest(raw) {
    if (!recording) return null;
    const event = raw && typeof raw === "object" ? { ...raw } : {};
    event.ts = event.ts || new Date().toISOString();
    event.captureEventId = String(event.captureEventId || crypto.randomUUID());
    event.sessionId = recordingSessionId || event.sessionId || event.cardId || "";
    event.recordingSessionId = recordingSessionId || event.recordingSessionId || "";
    event.cardId = recordingCardId || event.cardId || "";
    event.queueCard = recordingQueueCard || event.queueCard || "";
    event.lob = recordingLob || event.lob || "";
    if (recordingUser) {
      event.user = event.user || recordingUser;
      event.user_id = event.user_id || recordingUser;
    }
    if (!shouldKeepCaptureEvent(event)) return [];
    try {
      require("./capture-step-shot").persistScreenshotDataUrl(event);
    } catch {
      /* shots optional */
    }
    events.push(event);
    if (events.length > 8000) events.splice(0, events.length - 8000);
    appendJsonl(event);
    try {
      const shot = require("./capture-step-shot");
      if (shot.shouldCaptureStepShot(event) && !String(event.screenshotPath || "").trim()) {
        shot.scheduleStepShot(event);
      }
    } catch {
      /* screenshots optional */
    }
    return [event];
  }

  function listTransactions() {
    return groupCaptureEvents(events);
  }

  function attachStepExplanation(body = {}) {
    const id = String(body.captureEventId || "").trim();
    const text = String(body.explanation || "").replace(/\s+/g, " ").trim();
    if (!id || !text) return { ok: false, error: "missing_explanation" };
    const event = events.find((row) => String(row?.captureEventId || "") === id);
    if (!event) return { ok: false, error: "step_not_found" };
    event.explanation = text;
    appendJsonl({
      kind: "step_explanation",
      captureEventId: id,
      explanation: text,
      ts: new Date().toISOString(),
      recordingSessionId: event.recordingSessionId || recordingSessionId || "",
      sessionId: event.sessionId || event.recordingSessionId || recordingSessionId || "",
    });
    return { ok: true, captureEventId: id, explanation: text };
  }

  return {
    recordingPayload,
    setRecording,
    setRecordingAsync,
    ingest,
    listTransactions,
    attachStepExplanation,
    isRecording: () => recording,
  };
}

/**
 * Tiny local server so Chrome can view filled/cleared PDFs over http
 * (file:// tabs do not refresh when the file changes on disk).
 * Also hosts the capture recording API the Chrome extension polls.
 */
function createPdfViewServer({ port = DEFAULT_PORT } = {}) {
  /** @type {Map<string, { filePath: string, updatedAt: number }>} */
  const views = new Map();
  const capture = createCaptureStore();
  let server = null;

  function publish(cardId, filePath) {
    const id = String(cardId || "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id || !filePath || !fs.existsSync(filePath)) {
      return null;
    }
    const updatedAt = Date.now();
    views.set(id, { filePath, updatedAt });
    return {
      id,
      url: `http://127.0.0.1:${port}/pdf/${id}.pdf?t=${updatedAt}`,
      baseUrl: `http://127.0.0.1:${port}/pdf/${id}.pdf`,
      updatedAt,
    };
  }

  function getView(cardId) {
    const id = String(cardId || "");
    return views.get(id) || null;
  }

  async function handleCaptureApi(req, res, pathname) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return true;
    }

    if (pathname === "/health" || pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        service: "livetrack-capture",
        port,
        ...capture.recordingPayload(),
      });
      return true;
    }

    if ((pathname === "/capture" || pathname === "/api/capture") && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        const ingested = capture.ingest(body);
        json(res, 200, {
          ok: true,
          count: ingested ? ingested.length : 0,
          recording: capture.isRecording(),
        });
      } catch (err) {
        json(res, 400, { ok: false, error: err?.message || String(err) });
      }
      return true;
    }

    if (
      (pathname === "/api/recording" || pathname === "/api/record") &&
      (req.method === "GET" || req.method === "POST")
    ) {
      if (req.method === "POST") {
        let body = {};
        try {
          body = JSON.parse((await readBody(req)) || "{}");
        } catch {
          body = {};
        }
        json(res, 200, { ok: true, ...(await capture.setRecordingAsync(body)) });
        return true;
      }
      json(res, 200, { ok: true, ...capture.recordingPayload() });
      return true;
    }

    if (pathname === "/api/transactions" && req.method === "GET") {
      json(res, 200, { ok: true, transactions: capture.listTransactions() });
      return true;
    }

    return false;
  }

  function start() {
    if (server) return Promise.resolve(port);
    return new Promise((resolve, reject) => {
      server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
          if (await handleCaptureApi(req, res, url.pathname)) return;

          const demoMatch = url.pathname.match(/^\/demo\/([a-z0-9._-]+\.html)$/i);
          if (demoMatch) {
            const htmlPath = demoHtmlPath(demoMatch[1]);
            if (!htmlPath) {
              res.writeHead(404, { "Content-Type": "text/plain" });
              res.end("Demo page not found");
              return;
            }
            const html = fs.readFileSync(htmlPath);
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Length": html.length,
              "Cache-Control": "no-store",
              "Access-Control-Allow-Origin": "*",
            });
            res.end(html);
            return;
          }
          const match = url.pathname.match(/^\/pdf\/([a-z0-9_-]+)\.pdf$/i);
          if (!match) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
            return;
          }
          const id = match[1].toLowerCase();
          const view = views.get(id);
          if (!view || !fs.existsSync(view.filePath)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("PDF not published");
            return;
          }
          const data = fs.readFileSync(view.filePath);
          res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Length": data.length,
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            Pragma: "no-cache",
            Expires: "0",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(data);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(err.message || "error");
        }
      });
      server.on("error", reject);
      server.listen(port, "127.0.0.1", () => {
        console.log(`[coact] PDF + capture server http://127.0.0.1:${port}`);
        resolve(port);
      });
    });
  }

  function close() {
    if (!server) return;
    try {
      server.close();
    } catch {
      /* ignore */
    }
    server = null;
  }

  return { start, close, publish, getView, port, capture };
}

module.exports = {
  createPdfViewServer,
  createCaptureStore,
  shouldKeepCaptureEvent,
  groupCaptureEvents,
  truncateCaptureText,
  writeCaptureSnapshot,
  captureDataDir,
  captureTicketFor,
  generateCaptureRef,
  issueKeyFromUrl,
  looksLikeOpaqueId,
  isJiraBrowseKey,
  isCaptureRefKey,
  isJunkCaptureName,
  isJunkCaptureValue,
  isNavigationClickLabel,
  isNavigationSelector,
  isNavigationClick,
  navigationClickName,
  DEFAULT_PORT,
};
