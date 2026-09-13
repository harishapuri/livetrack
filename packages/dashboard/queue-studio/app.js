(function () {
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(el, msg, kind) {
  if (!el) return;
  el.textContent = msg || "";
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

let cardsCache = [];
let sopsCache = [];
/** @type {object|null} */
let sopDraft = null;
/** @type {Array<object>} */
let steps = [];
/** When set, cards table shows only this lob/id */
let focusCardKey = null;
/** @type {"edit"|"create"} */
let studioMode = "edit";
/** Original card identity while editing (before rename/move) */
let editingKey = null; // "LOB/id"

function apiBase() {
  if (location.protocol === "http:" || location.protocol === "https:") {
    return "";
  }
  return "http://127.0.0.1:4175";
}

function preferHttpServer(pathSuffix) {
  if (document.getElementById("dashShell")) return false;
  if (location.protocol !== "file:") return false;
  location.replace(`http://127.0.0.1:4175${pathSuffix}`);
  return true;
}

async function api(path, opts) {
  const url = `${apiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
      ...opts,
    });
  } catch {
    throw new Error(
      `Cannot reach dashboard API. Open http://127.0.0.1:4175/queue-studio/ (not file://). Run: npm run dashboard`
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function parseDataJson() {
  const raw = document.getElementById("dataJson").value.trim();
  if (!raw) return {};
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("data.json must be a JSON object");
  }
  return data;
}

function writeDataJson(obj) {
  document.getElementById("dataJson").value = JSON.stringify(obj || {}, null, 2);
  renderFieldEditor(obj || {});
}

function renderFieldEditor(data) {
  const el = document.getElementById("fieldEditor");
  const keys = Object.keys(data || {});
  if (!keys.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = keys
    .map(
      (k) => `
    <label>
      <span class="key">${esc(k)}</span>
      <div class="field-row">
        <input data-field-key="${esc(k)}" value="${esc(data[k] == null ? "" : String(data[k]))}" />
        <button type="button" class="btn-ghost btn-sm" data-del-key="${esc(k)}" title="Remove field">✕</button>
      </div>
    </label>`
    )
    .join("");

  el.querySelectorAll("input[data-field-key]").forEach((input) => {
    input.addEventListener("input", syncFieldsToJson);
  });
  el.querySelectorAll("[data-del-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      let data;
      try {
        data = parseDataJson();
      } catch {
        data = {};
      }
      delete data[btn.getAttribute("data-del-key")];
      writeDataJson(data);
    });
  });
}

function syncFieldsToJson() {
  let data;
  try {
    data = parseDataJson();
  } catch {
    data = {};
  }
  document.querySelectorAll("#fieldEditor input[data-field-key]").forEach((input) => {
    data[input.getAttribute("data-field-key")] = input.value;
  });
  document.getElementById("dataJson").value = JSON.stringify(data, null, 2);
}

function findByTextValue(step) {
  if (Array.isArray(step.findByText)) return step.findByText.join(", ");
  return step.findByText || "";
}

function parseFindByText(raw) {
  return String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function renderSteps() {
  const list = document.getElementById("stepsList");
  if (!steps.length) {
    list.innerHTML = `<p class="hint">No steps loaded — pick an SOP and click Reload, or add a step.</p>`;
    return;
  }

  list.innerHTML = steps
    .map((step, index) => {
      const action = step.action || "click";
      return `
    <div class="step-row" data-index="${index}">
      <div class="step-head">
        <span class="num">#${index + 1}</span>
        <select data-k="action">
          ${["click", "fill", "check", "highlight", "wait"]
            .map(
              (a) =>
                `<option value="${a}" ${action === a ? "selected" : ""}>${a}</option>`
            )
            .join("")}
        </select>
        <input data-k="label" value="${esc(step.label || "")}" placeholder="Label" />
        <button type="button" class="btn-ghost btn-sm" data-up="${index}" title="Move up">↑</button>
        <button type="button" class="btn-ghost btn-sm" data-down="${index}" title="Move down">↓</button>
        <button type="button" class="btn-ghost btn-sm" data-remove="${index}" title="Remove">✕</button>
      </div>
      <div class="step-fields">
        <label><span>id</span><input data-k="id" value="${esc(step.id || "")}" placeholder="step-id" /></label>
        <label><span>selector</span><input data-k="selector" value="${esc(
          step.selector || ""
        )}" placeholder="#btnAccept" /></label>
        <label class="${action === "click" ? "" : "dim"}"><span>findByText</span><input data-k="findByText" value="${esc(
          findByTextValue(step)
        )}" placeholder="Accept, Continue" /></label>
        <label class="${action === "fill" ? "" : "dim"}"><span>valueFrom</span><input data-k="valueFrom" value="${esc(
          step.valueFrom || ""
        )}" placeholder="email" /></label>
        <label><span>findByLabel</span><input data-k="findByLabel" value="${esc(
          step.findByLabel || ""
        )}" placeholder="Email" /></label>
        <label><span>value (literal)</span><input data-k="value" value="${esc(
          step.value == null ? "" : String(step.value)
        )}" placeholder="optional fixed value" /></label>
        <label class="check-inline"><input type="checkbox" data-k="mandatory" ${
          step.mandatory ? "checked" : ""
        } /> mandatory</label>
        <label class="check-inline"><input type="checkbox" data-k="optional" ${
          step.optional ? "checked" : ""
        } /> optional</label>
        <label class="check-inline"><input type="checkbox" data-k="navigates" ${
          step.navigates ? "checked" : ""
        } /> navigates</label>
      </div>
    </div>`;
    })
    .join("");

  list.querySelectorAll(".step-row").forEach((row) => {
    const index = Number(row.getAttribute("data-index"));
    row.querySelectorAll("[data-k]").forEach((el) => {
      const apply = () => {
        const key = el.getAttribute("data-k");
        if (el.type === "checkbox") {
          steps[index][key] = el.checked;
        } else {
          steps[index][key] = el.value;
        }
        markSopDirty();
        if (key === "action") renderSteps();
      };
      el.addEventListener("input", apply);
      el.addEventListener("change", apply);
    });
  });

  list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      steps.splice(Number(btn.getAttribute("data-remove")), 1);
      markSopDirty();
      renderSteps();
    });
  });
  list.querySelectorAll("[data-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-up"));
      if (i <= 0) return;
      [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
      markSopDirty();
      renderSteps();
    });
  });
  list.querySelectorAll("[data-down]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-down"));
      if (i >= steps.length - 1) return;
      [steps[i], steps[i + 1]] = [steps[i + 1], steps[i]];
      markSopDirty();
      renderSteps();
    });
  });
}

function markSopDirty() {
  const mode = document.getElementById("sopSaveMode");
  if (mode.value === "none") {
    mode.value = studioMode === "edit" ? "update" : "new";
  }
}

function normalizeStepsForSave() {
  return steps.map((s, i) => {
    const action = s.action || "click";
    const id = slugify(s.id || s.label || `step-${i + 1}`) || `step-${i + 1}`;
    const step = {
      id,
      action,
      label: String(s.label || id).trim() || id,
    };
    if (s.selector) step.selector = String(s.selector).trim();
    if (action === "fill" && s.valueFrom) step.valueFrom = String(s.valueFrom).trim();
    if (action === "click") {
      const texts = parseFindByText(s.findByText);
      if (texts.length) step.findByText = texts;
    }
    if (s.findByLabel) step.findByLabel = String(s.findByLabel).trim();
    if (s.value != null && s.value !== "") step.value = s.value;
    if (s.waitAfter && typeof s.waitAfter === "object") step.waitAfter = s.waitAfter;
    if (s.navigates) step.navigates = true;
    if (s.mandatory) step.mandatory = true;
    if (s.optional) step.optional = true;
    if (Array.isArray(s.allowedValues) && s.allowedValues.length) {
      step.allowedValues = s.allowedValues;
    }
    return step;
  });
}

function applySopDraft(sop) {
  sopDraft = sop ? { ...sop } : null;
  steps = Array.isArray(sop?.steps)
    ? sop.steps.map((s) => ({
        ...s,
        findByText: Array.isArray(s.findByText)
          ? s.findByText.join(", ")
          : s.findByText || "",
      }))
    : [];
  document.getElementById("newSopName").value = sop?.name || "";
  if (!document.getElementById("newSopId").value && sop?.id) {
    document.getElementById("newSopId").placeholder = `${sop.id}-copy`;
  }
  renderSteps();
}

async function loadSopById(sopId) {
  const status = document.getElementById("sopStatus");
  if (!sopId) {
    setStatus(status, "Pick an SOP first", "err");
    return;
  }
  setStatus(status, "Loading SOP…");
  try {
    const { sop } = await api(`/api/sops/${encodeURIComponent(sopId)}`);
    applySopDraft(sop);
    if (!document.getElementById("cardFormUrl").value && sop.formUrl) {
      document.getElementById("cardFormUrl").value = sop.formUrl;
    }
    setStatus(status, `Loaded ${sop.steps?.length || 0} steps from ${sop.id}`, "ok");
  } catch (err) {
    applySopDraft(null);
    setStatus(status, err.message, "err");
  }
}

function addStep(action) {
  const n = steps.length + 1;
  if (action === "fill") {
    steps.push({
      id: `field-${n}`,
      action: "fill",
      label: `Fill field ${n}`,
      selector: "",
      valueFrom: "",
      findByText: "",
    });
  } else if (action === "check") {
    steps.push({
      id: `check-${n}`,
      action: "check",
      label: `Check ${n}`,
      selector: "",
      findByText: "",
      valueFrom: "",
    });
  } else {
    steps.push({
      id: `click-${n}`,
      action: "click",
      label: `Click step ${n}`,
      selector: "",
      findByText: "",
      valueFrom: "",
    });
  }
  markSopDirty();
  renderSteps();
  setStatus(document.getElementById("sopStatus"), `Added ${action} step`, "ok");
}

function suggestNewSopId() {
  const cardId = slugify(document.getElementById("cardId").value);
  const base = slugify(document.getElementById("cardSopId").value);
  if (cardId) return cardId.startsWith("demo-") ? cardId : `demo-${cardId}`;
  if (base) return `${base}-copy`;
  return "";
}

function setMode(mode) {
  studioMode = mode === "create" ? "create" : "edit";
  document.getElementById("modeEdit").classList.toggle("active", studioMode === "edit");
  document.getElementById("modeCreate").classList.toggle("active", studioMode === "create");
  document.getElementById("btnSave").hidden = studioMode !== "edit";
  document.getElementById("btnSavePublish").hidden = studioMode !== "edit";
  document.getElementById("btnDelete").hidden = studioMode !== "edit";
  document.getElementById("btnSaveAsCopy").hidden = studioMode !== "edit";
  document.getElementById("btnCreate").hidden = studioMode !== "create";
  document.getElementById("btnCreatePublish").hidden = studioMode !== "create";
  document.getElementById("pickHint").textContent =
    studioMode === "edit"
      ? "Load a card to edit every field below"
      : "Load a card as a template, or start blank and create";
  const banner = document.getElementById("editBanner");
  if (studioMode === "edit" && editingKey) {
    banner.hidden = false;
    banner.textContent = `Editing ${editingKey} — Save writes over this card (rename LOB/id to move).`;
  } else {
    banner.hidden = true;
  }
  if (studioMode === "create") {
    document.getElementById("sopSaveMode").value = "none";
  }
}

async function fillFormFromCard(card, opts = {}) {
  const asCopy = opts.asCopy === true;
  document.getElementById("cardLob").value = card.lob || "TCOO";
  document.getElementById("cardId").value = asCopy ? `${card.id}-copy` : card.id;
  document.getElementById("cardTitle").value = asCopy
    ? `${card.title || card.id} (copy)`
    : card.title || card.id;
  document.getElementById("cardSopId").value = card.sopId || "";
  document.getElementById("cardStatus").value = card.status || "queued";
  document.getElementById("cardFormUrl").value = card.formUrl || "";
  document.getElementById("cardPdfPath").value = card.pdfPath || "";
  document.getElementById("cardFormMatch").value = Array.isArray(card.formMatch)
    ? card.formMatch.join(", ")
    : "";
  document.getElementById("cardAssignees").value = Array.isArray(card.assignees)
    ? card.assignees.join(", ")
    : "";
  const sopIdInput = document.getElementById("newSopId");
  sopIdInput.dataset.touched = "";
  sopIdInput.value = asCopy ? suggestNewSopId() : "";
  document.getElementById("sopSaveMode").value = asCopy ? "none" : "update";
  writeDataJson(card.data || {});
  if (asCopy) {
    editingKey = null;
  } else {
    editingKey = `${card.lob}/${card.id}`;
  }
  setMode(asCopy ? "create" : "edit");
  if (card.sopId) await loadSopById(card.sopId);
  // Keep update mode after SOP load (load shouldn't reset intent)
  if (!asCopy) document.getElementById("sopSaveMode").value = "update";
}

function collectCardPayload() {
  syncFieldsToJson();
  const data = parseDataJson();
  const cardId = slugify(document.getElementById("cardId").value);
  if (!cardId) throw new Error("Card id is required");
  const lob = document.getElementById("cardLob").value.trim() || "TCOO";
  const sopId = slugify(document.getElementById("cardSopId").value);
  if (!sopId && document.getElementById("sopSaveMode").value === "none") {
    throw new Error("Pick an SOP (or choose Update / Save new SOP)");
  }
  return {
    lob,
    id: cardId,
    title: document.getElementById("cardTitle").value.trim() || cardId,
    sopId,
    status: document.getElementById("cardStatus").value,
    formUrl: document.getElementById("cardFormUrl").value.trim() || null,
    pdfPath: document.getElementById("cardPdfPath").value.trim() || null,
    formMatch: parseCsv(document.getElementById("cardFormMatch").value),
    assignees: parseCsv(document.getElementById("cardAssignees").value),
    data,
  };
}

async function maybeSaveSop(cardPayload, { forcePublish = false } = {}) {
  let mode = document.getElementById("sopSaveMode").value;
  // Publish must push current step editor (mandatory flags, clicks, etc.) into the SOP file
  if (forcePublish && mode === "none" && steps.length) {
    mode = studioMode === "edit" ? "update" : "new";
    document.getElementById("sopSaveMode").value = mode;
  }
  if (mode === "none") {
    if (!cardPayload.sopId) throw new Error("Pick an SOP");
    return { sopId: cardPayload.sopId, sopMsg: "", mandatoryCount: null };
  }

  const normalized = normalizeStepsForSave();
  if (!normalized.length) {
    throw new Error("Add at least one SOP step before saving SOP changes");
  }

  const formUrl = cardPayload.formUrl;
  const title = cardPayload.title;
  const mandatoryCount = normalized.filter((s) => s.mandatory).length;

  if (mode === "update") {
    const sopId = cardPayload.sopId || slugify(document.getElementById("cardSopId").value);
    if (!sopId) throw new Error("SOP id required to update in place");
    const sop = {
      id: sopId,
      name: document.getElementById("newSopName").value.trim() || sopDraft?.name || title || sopId,
      description: sopDraft?.description || `Updated from Queue studio for card ${cardPayload.id}`,
      steps: normalized,
      status: forcePublish ? "published" : sopDraft?.status || "published",
    };
    if (formUrl) sop.formUrl = formUrl;
    if (Array.isArray(sopDraft?.formMatch) && sopDraft.formMatch.length) {
      sop.formMatch = sopDraft.formMatch;
    } else if (cardPayload.formMatch?.length) {
      sop.formMatch = cardPayload.formMatch;
    }
    await api(`/api/sops/${encodeURIComponent(sopId)}`, {
      method: "PUT",
      body: JSON.stringify(sop),
    });
    sopDraft = sop;
    return {
      sopId,
      sopMsg: ` · SOP ${sopId} updated (${mandatoryCount} mandatory)`,
      mandatoryCount,
    };
  }

  // new
  const newSopId =
    slugify(document.getElementById("newSopId").value) ||
    suggestNewSopId() ||
    `${cardPayload.id}-sop`;
  const sopName =
    document.getElementById("newSopName").value.trim() || title || newSopId;
  const sop = {
    id: newSopId,
    name: sopName,
    description: sopDraft?.description || `Created from Queue studio for card ${cardPayload.id}`,
    steps: normalized,
    status: "published",
  };
  if (formUrl) sop.formUrl = formUrl;
  if (Array.isArray(sopDraft?.formMatch) && sopDraft.formMatch.length) {
    sop.formMatch = sopDraft.formMatch;
  } else if (cardPayload.formMatch?.length) {
    sop.formMatch = cardPayload.formMatch;
  }
  const sopRes = await api("/api/sops", {
    method: "POST",
    body: JSON.stringify(sop),
  });
  sopDraft = sop;
  document.getElementById("cardSopId").value = sopRes.id;
  return {
    sopId: sopRes.id,
    sopMsg: ` · new SOP ${sopRes.id} (${mandatoryCount} mandatory)`,
    mandatoryCount,
  };
}

function renderCardsTable(cards) {
  const body = document.getElementById("cardsBody");
  const filterBar = document.getElementById("cardsFilterBar");
  let view = cards;
  if (focusCardKey) {
    view = cards.filter((c) => `${c.lob}/${c.id}` === focusCardKey);
    if (filterBar) filterBar.hidden = false;
  } else if (filterBar) {
    filterBar.hidden = true;
  }

  if (!view.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">${
      focusCardKey ? "Card not found — try Show all" : "No queue cards found"
    }</td></tr>`;
    return;
  }
  body.innerHTML = view
    .map(
      (c) => `
    <tr>
      <td>${esc(c.lob)}</td>
      <td><code>${esc(c.id)}</code></td>
      <td>${esc(c.title)}</td>
      <td>${esc(c.sopId)}</td>
      <td>${esc(c.status)}</td>
      <td class="row-actions">
        <button type="button" data-edit="${esc(c.lob)}/${esc(c.id)}">Edit</button>
        <button type="button" data-use="${esc(c.lob)}/${esc(c.id)}">Clone</button>
      </td>
    </tr>`
    )
    .join("");

  body.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openCard(btn.getAttribute("data-edit"), { asCopy: false }));
  });
  body.querySelectorAll("button[data-use]").forEach((btn) => {
    btn.addEventListener("click", () => openCard(btn.getAttribute("data-use"), { asCopy: true }));
  });
}

async function openCard(key, { asCopy }) {
  const [lob, id] = key.split("/");
  let card = cardsCache.find((c) => c.lob === lob && c.id === id);
  if (!card) {
    try {
      const res = await api(
        `/api/queue-cards/${encodeURIComponent(lob)}/${encodeURIComponent(id)}`
      );
      card = res.card;
    } catch (err) {
      setStatus(document.getElementById("sourceStatus"), err.message, "err");
      return;
    }
  }
  await fillFormFromCard(card, { asCopy });
  document.getElementById("sourceCard").value = key;
  document.getElementById("sourceMeta").hidden = false;
  document.getElementById("sourceMeta").innerHTML = `${
    asCopy ? "Template" : "Editing"
  } <strong>${esc(card.title || id)}</strong> · <code>${esc(key)}</code>`;
  setStatus(
    document.getElementById("sourceStatus"),
    asCopy ? "Loaded as clone template — change id, then Create" : "Loaded for edit — Save changes",
    "ok"
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function fillSourceSelect(cards) {
  const sel = document.getElementById("sourceCard");
  const keep = sel.value;
  sel.innerHTML =
    `<option value="">— Select a card —</option>` +
    cards
      .map(
        (c) =>
          `<option value="${esc(c.lob)}/${esc(c.id)}">${esc(c.lob)} / ${esc(c.id)} — ${esc(
            c.title
          )}</option>`
      )
      .join("");
  if (keep) sel.value = keep;
}

function fillSopSelect(sops) {
  const sel = document.getElementById("cardSopId");
  const keep = sel.value;
  sel.innerHTML =
    `<option value="">— Select SOP —</option>` +
    sops
      .map(
        (s) =>
          `<option value="${esc(s.id)}">${esc(s.id)}${s.name ? ` — ${esc(s.name)}` : ""} (${
            s.steps
          } steps)</option>`
      )
      .join("");
  if (keep) sel.value = keep;
}

async function refreshLists() {
  const [queue, sops] = await Promise.all([api("/api/queue-cards"), api("/api/sops")]);
  cardsCache = queue.cards || [];
  sopsCache = sops.sops || [];
  fillSourceSelect(cardsCache);
  fillSopSelect(sopsCache);
  renderCardsTable(cardsCache);
  document.getElementById("queueRootHint").textContent = focusCardKey
    ? `Showing ${focusCardKey} · ${cardsCache.length} total on disk`
    : `Root: ${queue.rootDir || "—"} · ${cardsCache.length} cards`;
}

async function loadSelectedSource() {
  const val = document.getElementById("sourceCard").value;
  const status = document.getElementById("sourceStatus");
  if (!val) {
    setStatus(status, "Pick a card first", "err");
    return;
  }
  await openCard(val, { asCopy: studioMode === "create" });
}

async function publishLiveAct() {
  try {
    const res = await api("/api/publish-liveact", { method: "POST", body: "{}" });
    if (!res.ok && res.liveAct === false) {
      return { ok: false, message: res.error || "LiveTrack not updated" };
    }
    const n = res.cardCount != null ? Number(res.cardCount) : null;
    const all = res.allCardCount != null ? Number(res.allCardCount) : null;
    let message = "Published to LiveTrack";
    if (n != null) message += ` · ${n} card${n === 1 ? "" : "s"} visible`;
    if (all != null && n != null && all > n) {
      message += ` (${all} on disk — assignees filter hides the rest)`;
    }
    return { ok: true, message, cardIds: res.cardIds || [] };
  } catch (err) {
    return { ok: false, message: err.message || "Publish failed" };
  }
}

async function saveExistingCard({ publish = false } = {}) {
  const status = document.getElementById("createStatus");
  if (!editingKey) {
    setStatus(status, "Load a card in Edit mode first", "err");
    return;
  }
  setStatus(status, publish ? "Saving & publishing…" : "Saving…");
  try {
    const [fromLob, fromId] = editingKey.split("/");
    const payload = collectCardPayload();
    const { sopId, sopMsg } = await maybeSaveSop(payload, { forcePublish: publish });
    payload.sopId = sopId;

    const res = await api(
      `/api/queue-cards/${encodeURIComponent(fromLob)}/${encodeURIComponent(fromId)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      }
    );

    editingKey = `${res.lob}/${res.id}`;
    focusCardKey = editingKey;
    setMode("edit");

    let pubMsg = "";
    if (publish) {
      const pub = await publishLiveAct();
      pubMsg = pub.ok ? ` · ${pub.message}` : ` · saved, but ${pub.message}`;
      if (pub.ok && Array.isArray(pub.cardIds) && !pub.cardIds.includes(res.id)) {
        pubMsg += ` · note: ${res.id} is not in your LiveTrack list (assignees)`;
      }
    }

    setStatus(
      status,
      `Saved ${res.lob}/${res.id}${res.moved ? " (moved)" : ""}${sopMsg}${pubMsg}`,
      publish && pubMsg.includes("but") ? "err" : "ok"
    );
    await refreshLists();
    const updated = cardsCache.find((c) => c.lob === res.lob && c.id === res.id);
    if (updated) await fillFormFromCard(updated, { asCopy: false });
    document.getElementById("sourceMeta").hidden = false;
    document.getElementById("sourceMeta").innerHTML = `Saved <strong>${esc(
      payload.title
    )}</strong> · <code>${esc(editingKey)}</code>`;
  } catch (err) {
    setStatus(status, err.message, "err");
  }
}

async function createCard({ publish = false } = {}) {
  const status = document.getElementById("createStatus");
  setStatus(status, publish ? "Creating & publishing…" : "Creating…");
  try {
    const payload = collectCardPayload();
    const { sopId, sopMsg } = await maybeSaveSop(payload, { forcePublish: publish });
    payload.sopId = sopId;

    const res = await api("/api/queue-cards", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    focusCardKey = `${res.lob}/${res.id}`;
    editingKey = focusCardKey;

    let pubMsg = "";
    if (publish) {
      const pub = await publishLiveAct();
      pubMsg = pub.ok ? ` · ${pub.message}` : ` · created, but ${pub.message}`;
      if (pub.ok && Array.isArray(pub.cardIds) && !pub.cardIds.includes(res.id)) {
        pubMsg += ` · note: ${res.id} is not in your LiveTrack list (assignees)`;
      }
    }

    setStatus(status, `Created ${res.lob}/${res.id}${sopMsg}${pubMsg}`, publish && pubMsg.includes("but") ? "err" : "ok");
    await refreshLists();
    const created = cardsCache.find((c) => c.lob === res.lob && c.id === res.id);
    if (created) await fillFormFromCard(created, { asCopy: false });
    document.getElementById("sopSaveMode").value = "none";
    document.getElementById("sourceMeta").hidden = false;
    document.getElementById("sourceMeta").innerHTML = `Created <strong>${esc(
      payload.title
    )}</strong> · <code>${esc(focusCardKey)}</code>`;
  } catch (err) {
    setStatus(status, err.message, "err");
  }
}

async function saveAsCopy() {
  setMode("create");
  const idEl = document.getElementById("cardId");
  if (!idEl.value.endsWith("-copy")) idEl.value = `${slugify(idEl.value) || "card"}-copy`;
  document.getElementById("sopSaveMode").value = "none";
  await createCard({ publish: true });
}

async function deleteCard() {
  const status = document.getElementById("createStatus");
  if (!editingKey) {
    setStatus(status, "Load a card in Edit mode first", "err");
    return;
  }
  const [lob, id] = editingKey.split("/");
  if (!confirm(`Delete queue card ${lob}/${id}? This cannot be undone.`)) return;
  setStatus(status, "Deleting…");
  try {
    await api(`/api/queue-cards/${encodeURIComponent(lob)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    editingKey = null;
    focusCardKey = null;
    setMode("edit");
    writeDataJson({});
    applySopDraft(null);
    document.getElementById("cardId").value = "";
    document.getElementById("cardTitle").value = "";
    document.getElementById("sourceMeta").hidden = true;
    document.getElementById("editBanner").hidden = true;
    setStatus(status, `Deleted ${lob}/${id}`, "ok");
    await refreshLists();
  } catch (err) {
    setStatus(status, err.message, "err");
  }
}

function bind() {
  document.getElementById("modeEdit").addEventListener("click", () => setMode("edit"));
  document.getElementById("modeCreate").addEventListener("click", () => {
    editingKey = null;
    setMode("create");
  });

  document.getElementById("btnRefreshCards").addEventListener("click", () => {
    focusCardKey = null;
    refreshLists().catch((err) =>
      setStatus(document.getElementById("sourceStatus"), err.message, "err")
    );
  });
  document.getElementById("btnShowAllCards")?.addEventListener("click", () => {
    focusCardKey = null;
    renderCardsTable(cardsCache);
    document.getElementById("queueRootHint").textContent = `Root: showing all · ${cardsCache.length} cards`;
  });
  document.getElementById("btnLoadSource").addEventListener("click", loadSelectedSource);
  document.getElementById("btnSave").addEventListener("click", () => saveExistingCard({ publish: false }));
  document.getElementById("btnSavePublish").addEventListener("click", () =>
    saveExistingCard({ publish: true })
  );
  document.getElementById("btnCreate").addEventListener("click", () => createCard({ publish: false }));
  document.getElementById("btnCreatePublish").addEventListener("click", () =>
    createCard({ publish: true })
  );
  document.getElementById("btnSaveAsCopy").addEventListener("click", saveAsCopy);
  document.getElementById("btnDelete").addEventListener("click", deleteCard);
  document.getElementById("btnLoadSop").addEventListener("click", () => {
    loadSopById(document.getElementById("cardSopId").value);
  });
  document.getElementById("btnAddClick").addEventListener("click", () => addStep("click"));
  document.getElementById("btnAddFill").addEventListener("click", () => addStep("fill"));
  document.getElementById("btnAddCheck").addEventListener("click", () => addStep("check"));
  document.getElementById("cardSopId").addEventListener("change", () => {
    const id = document.getElementById("cardSopId").value;
    if (id) loadSopById(id);
  });
  document.getElementById("cardId").addEventListener("input", () => {
    const el = document.getElementById("newSopId");
    if (!el.dataset.touched) el.value = suggestNewSopId();
  });
  document.getElementById("newSopId").addEventListener("input", () => {
    document.getElementById("newSopId").dataset.touched = "1";
  });
  document.getElementById("btnPrettyJson").addEventListener("click", () => {
    try {
      writeDataJson(parseDataJson());
      setStatus(document.getElementById("createStatus"), "Formatted", "ok");
    } catch (err) {
      setStatus(document.getElementById("createStatus"), err.message, "err");
    }
  });
  document.getElementById("btnClearData").addEventListener("click", () => writeDataJson({}));
  document.getElementById("btnAddDataField").addEventListener("click", () => {
    const key = prompt("New field key (valueFrom name):");
    if (!key) return;
    let data;
    try {
      data = parseDataJson();
    } catch {
      data = {};
    }
    const k = String(key).trim();
    if (!k) return;
    if (!(k in data)) data[k] = "";
    writeDataJson(data);
  });
  document.getElementById("dataJson").addEventListener("change", () => {
    try {
      renderFieldEditor(parseDataJson());
    } catch {
      /* ignore until valid */
    }
  });
}

async function boot() {
  if (preferHttpServer("/queue-studio/")) return;
  bind();
  setMode("edit");
  renderSteps();
  try {
    await refreshLists();
    await openFromHashQuery();
  } catch (err) {
    setStatus(document.getElementById("sourceStatus"), err.message, "err");
  }
}

function studioQueryFromHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  const q = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

function cardIdFromSop(sop) {
  const fromName = slugify(String(sop?.name || "").replace(/^draft:\s*/i, ""));
  if (fromName) return fromName;
  return (
    slugify(String(sop?.id || "").replace(/^discovered-/, "").replace(/-[a-z0-9]+$/i, "")) ||
    sop?.id ||
    "recorded-process"
  );
}

async function openRecordedSop(sopId) {
  // Keep the raw id (only normalize separators). Truncating/slug-chopping
  // discovered-* ids caused Queue studio 404s against the workbook catalog.
  const id = String(sopId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) return;
  setMode("create");
  editingKey = null;
  const status = document.getElementById("sourceStatus");
  setStatus(status, "Loading recorded SOP…");
  const { sop } = await api(`/api/sops/${encodeURIComponent(id)}`);
  applySopDraft(sop);
  const sel = document.getElementById("cardSopId");
  if (sop.id && ![...sel.options].some((o) => o.value === sop.id)) {
    const opt = document.createElement("option");
    opt.value = sop.id;
    opt.textContent = `${sop.name || sop.id} (draft)`;
    sel.appendChild(opt);
  }
  const title = String(sop.name || "").replace(/^Draft:\s*/i, "") || sop.id;
  document.getElementById("cardLob").value = "TCOO";
  document.getElementById("cardId").value = cardIdFromSop(sop);
  document.getElementById("cardTitle").value = title;
  document.getElementById("cardSopId").value = sop.id;
  document.getElementById("cardStatus").value = "queued";
  document.getElementById("cardFormUrl").value = sop.formUrl || "";
  document.getElementById("cardPdfPath").value = "";
  document.getElementById("cardFormMatch").value = Array.isArray(sop.formMatch)
    ? sop.formMatch.join(", ")
    : "";
  document.getElementById("cardAssignees").value = "";
  document.getElementById("newSopId").value = sop.id;
  document.getElementById("newSopName").value = title;
  document.getElementById("sopSaveMode").value = "update";
  writeDataJson(sop.sampleData && typeof sop.sampleData === "object" ? sop.sampleData : {});
  document.getElementById("sourceMeta").hidden = false;
  document.getElementById("sourceMeta").innerHTML = `Recorded process <strong>${esc(
    sop.name || sop.id
  )}</strong> — edit steps, then <strong>Create &amp; publish</strong> to the queue.`;
  document.getElementById("pickHint").textContent =
    "Loaded from LiveTrack Record. Edit SOP steps, then Create & publish.";
  setStatus(status, `Loaded ${sop.steps?.length || 0} recorded steps`, "ok");
}

async function openFromHashQuery(detailQuery) {
  const query = detailQuery
    ? new URLSearchParams(detailQuery)
    : studioQueryFromHash();
  const sopId = query.get("sop") || query.get("sopId") || "";
  if (!sopId) return;
  await openRecordedSop(sopId);
}

window.addEventListener("dash:route", (e) => {
  if (e.detail?.id !== "studio") return;
  openFromHashQuery(e.detail.query).catch((err) =>
    setStatus(document.getElementById("sourceStatus"), err.message, "err")
  );
});

boot();
})();
