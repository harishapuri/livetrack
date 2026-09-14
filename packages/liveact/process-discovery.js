/**
 * Process Discovery (DPIP Path 2 — no queue card matches).
 *
 * Two inputs:
 *   1. Record button click-stream (clicks + field keys/values) when the
 *      operator works a page that matches no queue card.
 *   2. On-demand Playwright scan of the active page (legacy).
 *
 * Draft SOPs stay status "draft" until an SME edits and approves them in
 * LiveTrack Dash or the dashboard Reviews page. Approve publishes the SOP
 * and creates a queue card.
 */

function slugify(text, maxLen = 48) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/, "");
}

/** Runs inside the page via Playwright's page.evaluate — pure browser JS, no Node APIs. */
/* istanbul ignore next -- executed in-page, not in Node */
function inPageFieldScan() {
  function visibleLabelFor(el) {
    if (el.id) {
      const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (byFor?.textContent?.trim()) return byFor.textContent.trim();
    }
    const wrappingLabel = el.closest("label");
    if (wrappingLabel?.textContent?.trim()) {
      return wrappingLabel.textContent.replace(el.value || "", "").trim();
    }
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel?.trim()) return ariaLabel.trim();
    const ariaLabelledBy = el.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      const ref = document.getElementById(ariaLabelledBy);
      if (ref?.textContent?.trim()) return ref.textContent.trim();
    }
    if (el.placeholder?.trim()) return el.placeholder.trim();
    // Nearest preceding text (common in hand-built forms without <label>)
    let node = el.previousElementSibling;
    let hops = 0;
    while (node && hops < 3) {
      const text = node.textContent?.trim();
      if (text && text.length < 80) return text;
      node = node.previousElementSibling;
      hops += 1;
    }
    return el.name || el.id || el.type || "Field";
  }

  function selectorFor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `[name="${CSS.escape(el.name)}"]`;
    const tag = el.tagName.toLowerCase();
    const siblings = Array.from(document.querySelectorAll(tag));
    const index = siblings.indexOf(el);
    return `${tag}:nth-of-type(${index + 1})`;
  }

  const nodes = Array.from(document.querySelectorAll("input, select, textarea"));
  const fields = [];
  for (const el of nodes) {
    const type = (el.getAttribute("type") || el.tagName.toLowerCase()).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "file"].includes(type)) continue;
    if (el.disabled) continue;

    const label = visibleLabelFor(el);
    const selector = selectorFor(el);
    const mandatory = el.required || el.getAttribute("aria-required") === "true";

    if (el.tagName.toLowerCase() === "select") {
      const options = Array.from(el.options)
        .map((o) => o.textContent.trim())
        .filter((t) => t && !/^(select|choose|--)/i.test(t));
      fields.push({ label, selector, type: "select", mandatory, options });
    } else if (type === "checkbox" || type === "radio") {
      fields.push({ label, selector, type: "check", mandatory });
    } else {
      fields.push({ label, selector, type: "fill", mandatory });
    }
  }
  return fields;
}

async function scanPageFields(page) {
  return page.evaluate(inPageFieldScan);
}

function fieldsToSteps(fields) {
  const seen = new Set();
  return fields.map((f, i) => {
    let id = slugify(f.label) || `field-${i + 1}`;
    let unique = id;
    let n = 2;
    while (seen.has(unique)) {
      unique = `${id}-${n}`;
      n += 1;
    }
    seen.add(unique);

    const step = {
      id: unique,
      action: f.type === "select" ? "fill" : f.type,
      label: f.label,
      selector: f.selector,
      valueFrom: unique,
      mandatory: Boolean(f.mandatory),
    };
    if (f.type === "select" && Array.isArray(f.options) && f.options.length) {
      step.allowedValues = f.options;
    }
    return step;
  });
}

/**
 * @param {{url:string, title:string, fields: Array}} input
 * @returns full draft SOP JSON (status: "draft")
 */
function synthesizeDraftSop({ url, title, fields }) {
  let host = "";
  let slug = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    slug = slugify(`${host}${u.pathname}`, 40) || slugify(title, 40);
  } catch {
    slug = slugify(title, 40) || "discovered-form";
  }
  const id = `discovered-${slug || "form"}-${Date.now().toString(36)}`;
  const steps = fieldsToSteps(fields);

  return {
    id,
    name: `Draft: ${title || host || "Discovered form"}`,
    description:
      "Auto-discovered by the Process Discovery Agent from an unrecognized page. Review, edit, and approve before it becomes available to end users.",
    status: "draft",
    discoveredAt: new Date().toISOString(),
    formUrl: url,
    formMatch: host ? [host] : [],
    steps,
  };
}

function uniqueStepId(label, seen, fallback) {
  let id = slugify(label) || fallback;
  let unique = id;
  let n = 2;
  while (seen.has(unique)) {
    unique = `${id}-${n}`;
    n += 1;
  }
  seen.add(unique);
  return unique;
}

function formMatchHints(url, title) {
  const hints = [];
  try {
    const u = new URL(url);
    if (u.hostname) hints.push(u.hostname);
    const parts = String(u.pathname || "")
      .split("/")
      .map((p) => p.replace(/\.html?$/i, ""))
      .filter((p) => p && p !== "index" && p.length > 2);
    hints.push(...parts.slice(-2));
  } catch {
    /* ignore */
  }
  const t = String(title || "").trim();
  if (t && t.length < 80) hints.push(t);
  return [...new Set(hints.filter(Boolean))];
}

// Delegate to pdf-server.js's canonical, actively-maintained detectors
// instead of keeping a second copy here that silently drifts out of sync
// (this is what let junk keys like "one"/"select-one" reach case data
// after they'd already been fixed everywhere else).
function looksLikeOpaqueToken(value) {
  return require("./pdf-server").looksLikeOpaqueId(value);
}

function isShortOptionLabel(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 40) return false;
  return /^(yes|no|y|n|true|false|on|off)$/i.test(t);
}

function isJunkFieldKey(text) {
  return require("./pdf-server").isJunkCaptureName(text);
}

function humanQuestionLabel(raw) {
  const fromFind = Array.isArray(raw?.findByLabel) ? raw.findByLabel[0] : raw?.findByLabel;
  for (const candidate of [raw?.question, fromFind, raw?.fieldName, raw?.label]) {
    const t = String(candidate || "").replace(/\s+/g, " ").trim();
    if (!t || isShortOptionLabel(t) || isJunkFieldKey(t)) continue;
    return t.replace(/^(fill|select|check|click)\s+/i, "").trim();
  }
  return "";
}

function captureEventsToSopSteps(rawSteps) {
  const seen = new Set();
  const steps = [];
  const data = {};
  // A hidden accessibility-shim control synced behind the real widget often
  // resolves to the SAME real question as a separate raw step. Track steps
  // by their base (pre-uniqueStepId) key so a repeat merges into the
  // existing step instead of becoming a "-2"/"-3" duplicate.
  const fieldStepByKey = new Map();
  let choiceN = 0;
  for (const raw of rawSteps || []) {
    const action = String(raw.action || "fill").toLowerCase();
    const optionText = String(raw.selectedText || raw.value || "").trim();
    const label = String(raw.label || raw.fieldName || raw.selectedText || raw.value || "").trim();
    if (!label && !raw.fieldName) continue;

    const keyHint = String(raw.fieldName || raw.label || "").trim();
    if (
      (action === "fill" || action === "input" || action === "change") &&
      (looksLikeOpaqueToken(raw.value) || isJunkFieldKey(keyHint)) &&
      (isJunkFieldKey(keyHint) || looksLikeOpaqueToken(raw.value))
    ) {
      continue;
    }

    const question = humanQuestionLabel(raw);
    const option =
      isShortOptionLabel(optionText) ? optionText : isShortOptionLabel(label) ? label : "";

    // Yes/No (or similar) → check step with question key + option value.
    // Keep native <select> as select (not check).
    if (
      action !== "select" &&
      option &&
      (action === "check" ||
        action === "click" ||
        (action === "fill" && question))
    ) {
      const human = question || `Choice ${choiceN + 1}`;
      const fieldKey = slugify(human) || `choice-${choiceN + 1}`;
      const existingChoice = fieldStepByKey.get(fieldKey);
      if (existingChoice) {
        data[existingChoice.id] = option;
        existingChoice.allowedValues = [option];
        continue;
      }
      choiceN += 1;
      const id = uniqueStepId(fieldKey, seen, fieldKey);
      data[id] = option;
      const choiceStep = {
        id,
        action: "check",
        label: human,
        selector: String(raw.selector || "").trim(),
        valueFrom: id,
        mandatory: true,
        findByLabel: [human],
        allowedValues: [option],
      };
      steps.push(choiceStep);
      fieldStepByKey.set(fieldKey, choiceStep);
      continue;
    }

    if (action === "click") {
      if (isJunkFieldKey(label) || looksLikeOpaqueToken(label)) continue;
      const clickLabel = label || "control";
      const id = uniqueStepId(`click-${clickLabel}`, seen, `click-${steps.length + 1}`);
      steps.push({
        id,
        action: "click",
        label: clickLabel.replace(/^click\s+/i, ""),
        selector: String(raw.selector || "").trim(),
        findByText: [clickLabel.replace(/^click\s+/i, "")],
      });
      continue;
    }
    if (isJunkFieldKey(label) && isJunkFieldKey(raw.fieldName)) continue;
    const human = question || label || `Field ${steps.length + 1}`;
    if (isJunkFieldKey(human) && looksLikeOpaqueToken(raw.value)) continue;
    const fieldKey = slugify(raw.fieldName || human) || `field-${steps.length + 1}`;
    if (isJunkFieldKey(fieldKey) && looksLikeOpaqueToken(raw.value)) continue;
    const fillAction = action === "check" || action === "select" ? action : "fill";
    const value = String(raw.value || raw.selectedText || "").trim();
    if (looksLikeOpaqueToken(value)) continue;
    const existingField = fieldStepByKey.get(fieldKey);
    if (existingField) {
      if (value) data[existingField.id] = value;
      if ((fillAction === "select" || fillAction === "check") && value) {
        existingField.allowedValues = [value];
      }
      continue;
    }
    const id = uniqueStepId(fieldKey, seen, fieldKey);
    if (value) data[id] = value;
    const step = {
      id,
      action: fillAction,
      label: human,
      selector: String(raw.selector || "").trim(),
      valueFrom: id,
      mandatory: Boolean(value),
    };
    if (raw.findByLabel) step.findByLabel = raw.findByLabel;
    else if (human) step.findByLabel = [human];
    if ((fillAction === "select" || fillAction === "check") && value) step.allowedValues = [value];
    steps.push(step);
    fieldStepByKey.set(fieldKey, step);
  }
  return { steps, data };
}

function synthesizeDraftFromCapture(txn) {
  const capture = require("./capture-forward");
  const payload = capture.payloadOf(txn);
  const url = String(txn.pageUrl || payload.url || "").trim();
  const title = String(txn.pageTitle || payload.title || payload.queueCard || "").trim();
  const ordered = capture.stepsOf(txn);
  const { steps, data } = captureEventsToSopSteps(ordered);
  const base = synthesizeDraftSop({
    url,
    title: title || "Recorded process",
    fields: [],
  });
  base.steps = steps;
  base.source = "capture";
  base.description =
    "Recorded with the LiveTrack Record button because no queue card matched this page. Edit steps and values, then approve to add a queue card.";
  base.sampleData = data;
  base.recordingSessionId = String(txn.transactionId || payload.recordingSessionId || "");
  const hints = formMatchHints(url, title);
  if (hints.length) base.formMatch = hints;
  if (!steps.length) {
    return { ...base, error: "No click or field steps recorded" };
  }
  return base;
}

function txnMatchesExistingCard(txn, queue) {
  const capture = require("./capture-forward");
  const payload = capture.payloadOf(txn);
  const cardId = String(payload.cardId || txn.cardId || "").trim();
  if (cardId && (queue || []).some((c) => c.id === cardId)) return true;
  const url = String(txn.pageUrl || payload.url || "").toLowerCase();
  const title = String(txn.pageTitle || payload.title || "").toLowerCase();
  if (!url && !title) return false;
  for (const card of queue || []) {
    const form = String(card.formUrl || "").toLowerCase().replace(/\/$/, "");
    if (form && url.replace(/\/$/, "") === form) return true;
    for (const hint of card.formMatch || []) {
      const h = String(hint || "").toLowerCase().trim();
      if (h.length <= 3) continue;
      if (/^[\w.-]+(:\d+)?\/?$/.test(h.replace(/^https?:\/\//, ""))) continue;
      if (url.includes(h) || title.includes(h)) return true;
    }
    const id = String(card.id || "").toLowerCase();
    if (id && url.includes(id)) return true;
  }
  return false;
}

async function draftUnmatchedCaptures(queue = []) {
  const capture = require("./capture-forward");
  const sopsStore = require("./sops-store");
  const pdf = require("./pdf-server");
  const txns = await capture.mergeLiveAndPersistedTransactions();
  const allSops = await sopsStore.loadAllSopObjects().catch(() => []);
  const sopIds = new Set((allSops || []).map((s) => s.id).filter(Boolean));
  const next = [];
  const drafted = [];
  for (const txn of txns) {
    const payload = capture.payloadOf(txn);
    const status = String(payload.discoveryStatus || txn.discoveryStatus || "");
    if (status === "approved" || status === "dismissed") {
      next.push(ensureTxnRef(txn, capture, pdf));
      continue;
    }
    const existingDraftId = String(payload.draftSopId || txn.draftSopId || "").trim();
    if (existingDraftId && sopIds.has(existingDraftId)) {
      next.push(ensureTxnRef(txn, capture, pdf));
      continue;
    }
    // Recording was attached to a queue card — not a discovery draft
    const cardId = String(payload.cardId || txn.cardId || "").trim();
    if (cardId) {
      next.push(ensureTxnRef(txn, capture, pdf));
      continue;
    }
    // Explicit unmatched Record (no cardId): always draft when there are steps.
    // formMatch alone must not suppress drafts — operators use Record precisely
    // when the existing card did not apply to their session.
    const unmatched = Boolean(payload.unmatched || txn.unmatched || !cardId);
    if (!unmatched && txnMatchesExistingCard(txn, queue)) {
      next.push(ensureTxnRef(txn, capture, pdf));
      continue;
    }
    const steps = capture.stepsOf(txn);
    if (!steps.length) {
      next.push(ensureTxnRef(txn, capture, pdf));
      continue;
    }
    const withRef = ensureTxnRef(txn, capture, pdf);
    const sop = synthesizeDraftFromCapture(withRef);
    if (!sop.steps?.length) {
      next.push(withRef);
      continue;
    }
    // Keep a stable id when re-saving a missing draft so studio links still work
    if (existingDraftId) sop.id = existingDraftId;
    const saved = await saveDraftSop(sop);
    if (saved.ok === false) {
      console.warn("[livetrack] draft SOP save failed", saved.error || "");
      // Still surface capture keys/values on Dash without a draftSopId pointer
      next.push(
        capture.applyTxnPatch(withRef, {
          unmatched: true,
          discoveryStatus: "pending",
        })
      );
      continue;
    }
    sopIds.add(sop.id);
    const patched = capture.applyTxnPatch(withRef, {
      unmatched: true,
      discoveryStatus: "pending",
      draftSopId: sop.id,
    });
    next.push(patched);
    drafted.push({ sop, saved, transactionId: txn.transactionId });
  }
  await capture.persistCaptureTransactions(next);
  return { ok: true, drafted, transactions: next, txnCount: next.length };
}

function ensureTxnRef(txn, capture, pdf) {
  const payload = capture.payloadOf(txn);
  const resolved = capture.resolveCaptureTicket
    ? capture.resolveCaptureTicket(txn, payload)
    : {
        ticket: pdf.captureTicketFor({
          ...txn,
          pageUrl: txn.pageUrl || payload.url,
          transactionId: txn.transactionId,
        }),
        generated: true,
      };
  if (!resolved.ticket) return txn;
  if (String(payload.formReference || txn.formReference || "") === resolved.ticket) return txn;
  return capture.applyTxnPatch(txn, {
    formReference: resolved.ticket,
    ticket: resolved.ticket,
    formReferenceGenerated: resolved.generated,
  });
}

async function loadSopOrRegenerateFromCapture(sopId, { transactionId } = {}) {
  const sopsStore = require("./sops-store");
  const capture = require("./capture-forward");
  const id = String(sopId || "").trim();
  if (id) {
    const all = await sopsStore.loadAllSopObjects();
    const found = all.find((s) => s.id === id);
    if (found) return { ok: true, sop: found, regenerated: false };
  }
  const txns = await capture.mergeLiveAndPersistedTransactions();
  const match = txns.find((t) => {
    const p = capture.payloadOf(t);
    if (transactionId && String(t.transactionId || "") === String(transactionId)) return true;
    if (id && String(p.draftSopId || t.draftSopId || "") === id) return true;
    return false;
  });
  if (!match) return { ok: false, error: id ? `SOP not found: ${id}` : "SOP not found" };
  const sop = synthesizeDraftFromCapture(match);
  if (id) sop.id = id;
  if (!sop.steps?.length) {
    return { ok: false, error: id ? `SOP not found: ${id}` : "SOP not found", sop };
  }
  const saved = await saveDraftSop(sop);
  return { ok: saved.ok !== false, sop, regenerated: true, ...saved };
}

function cardIdFromSop(sop) {
  const fromName = slugify(String(sop?.name || "").replace(/^draft:\s*/i, ""), 40);
  if (fromName) return fromName;
  return slugify(String(sop?.id || "").replace(/^discovered-/, "").replace(/-[a-z0-9]+$/i, ""), 40) ||
    `recorded-${Date.now().toString(36)}`;
}

async function promoteSopToQueueCard(sop, { data, lob, title, cardId } = {}) {
  const documents = require("./documents");
  const sopsStore = require("./sops-store");
  if (!sop?.id) return { ok: false, error: "missing_sop" };
  const published = {
    ...sop,
    status: "published",
    approvedAt: sop.approvedAt || new Date().toISOString(),
  };
  await sopsStore.upsertSop(published);
  const useLob = documents.normalizeLob(lob || documents.DEFAULT_LOB);
  let id = slugify(cardId || cardIdFromSop(published), 48) || cardIdFromSop(published);
  const loaded = await documents.loadQueueFromDocuments(documents.defaultDocumentsRoot(), {
    filterByUser: false,
  });
  const taken = new Set((loaded.cards || []).map((c) => `${c.lob}/${c.id}`));
  let unique = id;
  let n = 2;
  while (taken.has(`${useLob}/${unique}`)) {
    unique = `${id}-${n}`;
    n += 1;
  }
  const dir = documents.lobCardDir(documents.defaultDocumentsRoot(), unique, useLob);
  const values =
    data && typeof data === "object" && !Array.isArray(data)
      ? data
      : published.sampleData || {};
  await documents.writeCardFiles(dir, {
    data: values,
    meta: {
      id: unique,
      title: String(title || published.name || unique).replace(/^Draft:\s*/i, ""),
      sopId: published.id,
      status: "queued",
      lob: useLob,
      formUrl: published.formUrl || "",
      formMatch: Array.isArray(published.formMatch) ? published.formMatch : [],
    },
  });
  return {
    ok: true,
    sop: published,
    card: { id: unique, lob: useLob, sopId: published.id, title: title || published.name },
  };
}

function saveDraftSop(sop) {
  return require("./sops-store")
    .upsertSop({ ...sop, status: sop.status || "draft" })
    .then((saved) => ({ ok: true, path: saved.path }))
    .catch((err) => ({ ok: false, error: err.message }));
}

/**
 * @param {{activePage: () => Promise<import('playwright-core').Page|null>}} browserAgent
 */
async function discoverFromActivePage(browserAgent) {
  const page = await browserAgent.activePage();
  if (!page) return { ok: false, error: "no_active_page" };

  let url = "";
  let title = "";
  try {
    url = page.url() || "";
    title = (await page.title().catch(() => "")) || "";
  } catch (err) {
    return { ok: false, error: err?.message || "Could not read the active page" };
  }
  if (!/^https?:|^file:/i.test(url)) {
    return { ok: false, error: "The active page isn't a web form (chrome://, devtools, etc.)" };
  }

  let fields = [];
  try {
    fields = await scanPageFields(page);
  } catch (err) {
    return { ok: false, error: err?.message || "Could not scan the page" };
  }
  if (!fields.length) {
    return { ok: false, error: "No fillable fields found on this page" };
  }

  const sop = synthesizeDraftSop({ url, title, fields });
  const saved = await saveDraftSop(sop);
  return { ok: saved.ok !== false, sop, ...saved, fieldCount: fields.length };
}

module.exports = {
  scanPageFields,
  fieldsToSteps,
  synthesizeDraftSop,
  saveDraftSop,
  discoverFromActivePage,
  captureEventsToSopSteps,
  synthesizeDraftFromCapture,
  txnMatchesExistingCard,
  draftUnmatchedCaptures,
  promoteSopToQueueCard,
  cardIdFromSop,
  loadSopOrRegenerateFromCapture,
};
