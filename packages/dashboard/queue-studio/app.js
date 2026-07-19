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

function apiBase() {
  if (location.protocol === "http:" || location.protocol === "https:") {
    return "";
  }
  return "http://127.0.0.1:4175";
}

function preferHttpServer(pathSuffix) {
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
    .slice(0, 80);
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
      <input data-field-key="${esc(k)}" value="${esc(data[k] == null ? "" : String(data[k]))}" />
    </label>`
    )
    .join("");

  el.querySelectorAll("input[data-field-key]").forEach((input) => {
    input.addEventListener("input", syncFieldsToJson);
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

function renderSteps() {
  const list = document.getElementById("stepsList");
  if (!steps.length) {
    list.innerHTML = `<p class="hint">No steps loaded — pick a Base SOP and click Reload, or add a click.</p>`;
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
        <label class="${action === "click" ? "" : "dim"}"><span>findByText (click)</span><input data-k="findByText" value="${esc(
          findByTextValue(step)
        )}" placeholder="Accept, Continue" /></label>
        <label class="${action === "fill" ? "" : "dim"}"><span>valueFrom (fill)</span><input data-k="valueFrom" value="${esc(
          step.valueFrom || ""
        )}" placeholder="email" /></label>
      </div>
    </div>`;
    })
    .join("");

  list.querySelectorAll(".step-row").forEach((row) => {
    const index = Number(row.getAttribute("data-index"));
    row.querySelectorAll("[data-k]").forEach((el) => {
      const apply = () => {
        const key = el.getAttribute("data-k");
        steps[index][key] = el.value;
        if (key === "action") renderSteps();
      };
      el.addEventListener("input", apply);
      el.addEventListener("change", apply);
    });
  });

  list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      steps.splice(Number(btn.getAttribute("data-remove")), 1);
      renderSteps();
    });
  });
  list.querySelectorAll("[data-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-up"));
      if (i <= 0) return;
      [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
      renderSteps();
    });
  });
  list.querySelectorAll("[data-down]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-down"));
      if (i >= steps.length - 1) return;
      [steps[i], steps[i + 1]] = [steps[i + 1], steps[i]];
      renderSteps();
    });
  });
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
    // Preserve advanced fields from original SOP when present
    if (s.waitAfter && typeof s.waitAfter === "object") step.waitAfter = s.waitAfter;
    if (s.navigates) step.navigates = true;
    if (s.mandatory) step.mandatory = true;
    if (s.optional) step.optional = true;
    if (s.findByLabel) step.findByLabel = s.findByLabel;
    if (s.value != null && s.value !== "") step.value = s.value;
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
    setStatus(status, "Pick a Base SOP first", "err");
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
  document.getElementById("saveNewSop").checked = true;
  renderSteps();
  setStatus(document.getElementById("sopStatus"), `Added ${action} step — Save new SOP checked`, "ok");
}

function suggestNewSopId() {
  const cardId = slugify(document.getElementById("cardId").value);
  const base = slugify(document.getElementById("cardSopId").value);
  if (cardId) return cardId.startsWith("demo-") ? cardId : `demo-${cardId}`;
  if (base) return `${base}-copy`;
  return "";
}

async function fillFormFromCard(card, opts = {}) {
  const asCopy = opts.asCopy !== false;
  document.getElementById("cardLob").value = card.lob || "TCOO";
  document.getElementById("cardId").value = asCopy ? `${card.id}-copy` : card.id;
  document.getElementById("cardTitle").value = asCopy
    ? `${card.title || card.id} (copy)`
    : card.title || card.id;
  document.getElementById("cardSopId").value = card.sopId || "";
  document.getElementById("cardStatus").value = card.status || "queued";
  document.getElementById("cardFormUrl").value = card.formUrl || "";
  const sopIdInput = document.getElementById("newSopId");
  sopIdInput.dataset.touched = "";
  sopIdInput.value = asCopy ? suggestNewSopId() : "";
  document.getElementById("saveNewSop").checked = false;
  writeDataJson(card.data || {});
  if (card.sopId) await loadSopById(card.sopId);
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
      focusCardKey ? "New card not found — try Show all" : "No queue cards found"
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
      <td><button type="button" data-use="${esc(c.lob)}/${esc(c.id)}">Use</button></td>
    </tr>`
    )
    .join("");

  body.querySelectorAll("button[data-use]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.getAttribute("data-use");
      const [lob, id] = key.split("/");
      const card = cardsCache.find((c) => c.lob === lob && c.id === id);
      if (!card) return;
      document.getElementById("sourceCard").value = key;
      // If this is the card we just created / focused, load it as-is
      const asCopy = focusCardKey !== key;
      await fillFormFromCard(card, { asCopy });
      document.getElementById("sourceMeta").hidden = false;
      document.getElementById("sourceMeta").innerHTML = `Loaded <strong>${esc(
        card.title
      )}</strong> · ${esc(card.lob)}/<code>${esc(card.id)}</code> · SOP <code>${esc(
        card.sopId
      )}</code>`;
      setStatus(
        document.getElementById("sourceStatus"),
        asCopy ? "Loaded as template — edit names, then create" : "Loaded created card",
        "ok"
      );
    });
  });
}

function fillSourceSelect(cards) {
  const sel = document.getElementById("sourceCard");
  const keep = sel.value;
  sel.innerHTML =
    `<option value="">— Select a stored card —</option>` +
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
    ? `Showing only new card ${focusCardKey} · ${cardsCache.length} total on disk`
    : `Root: ${queue.rootDir || "—"} · ${cardsCache.length} cards`;
}

async function loadSelectedSource() {
  const val = document.getElementById("sourceCard").value;
  const status = document.getElementById("sourceStatus");
  if (!val) {
    setStatus(status, "Pick a source card first", "err");
    return;
  }
  const [lob, id] = val.split("/");
  try {
    const { card } = await api(
      `/api/queue-cards/${encodeURIComponent(lob)}/${encodeURIComponent(id)}`
    );
    await fillFormFromCard(card, { asCopy: true });
    document.getElementById("sourceMeta").hidden = false;
    document.getElementById("sourceMeta").innerHTML = `Loaded <strong>${esc(
      card.title
    )}</strong> · path <code>${esc(card.sourceDir || "")}</code>`;
    setStatus(status, "Loaded — edit clicks / data, then create", "ok");
  } catch (err) {
    setStatus(status, err.message, "err");
  }
}

async function createCard() {
  const status = document.getElementById("createStatus");
  setStatus(status, "Creating…");
  try {
    syncFieldsToJson();
    const data = parseDataJson();
    const cardId = slugify(document.getElementById("cardId").value);
    if (!cardId) throw new Error("Card id is required");

    const baseSopId = slugify(document.getElementById("cardSopId").value);
    const saveNewSop = document.getElementById("saveNewSop").checked;
    const formUrl = document.getElementById("cardFormUrl").value.trim() || null;
    const title = document.getElementById("cardTitle").value.trim() || cardId;
    const lob = document.getElementById("cardLob").value.trim() || "TCOO";

    let sopId = baseSopId;
    let sopMsg = "";

    if (saveNewSop) {
      const normalized = normalizeStepsForSave();
      if (!normalized.length) {
        throw new Error("Add at least one SOP step before saving a new SOP");
      }
      const newSopId =
        slugify(document.getElementById("newSopId").value) ||
        suggestNewSopId() ||
        `${cardId}-sop`;
      const sopName =
        document.getElementById("newSopName").value.trim() || title || newSopId;
      const sop = {
        id: newSopId,
        name: sopName,
        description: sopDraft?.description || `Created from Queue studio for card ${cardId}`,
        steps: normalized,
      };
      if (formUrl) sop.formUrl = formUrl;
      if (Array.isArray(sopDraft?.formMatch) && sopDraft.formMatch.length) {
        sop.formMatch = sopDraft.formMatch;
      }
      const sopRes = await api("/api/sops", {
        method: "POST",
        body: JSON.stringify(sop),
      });
      sopId = sopRes.id;
      sopMsg = ` · new SOP ${sopRes.id}`;
    } else if (!sopId) {
      throw new Error("Pick a Base SOP (or check Save new SOP)");
    }

    // Create only the new card with the names you entered (no clone of other cards)
    const body = {
      lob,
      id: cardId,
      title,
      sopId,
      status: document.getElementById("cardStatus").value,
      formUrl,
      data,
    };
    const res = await api("/api/queue-cards", {
      method: "POST",
      body: JSON.stringify(body),
    });

    focusCardKey = `${res.lob}/${res.id}`;
    setStatus(status, `Created only ${res.lob}/${res.id}${sopMsg}`, "ok");
    await refreshLists();

    // Load the new card as-is (not another -copy draft)
    const created = cardsCache.find((c) => c.lob === res.lob && c.id === res.id);
    if (created) {
      await fillFormFromCard(created, { asCopy: false });
    } else {
      document.getElementById("sourceCard").value = focusCardKey;
      document.getElementById("cardLob").value = res.lob;
      document.getElementById("cardId").value = res.id;
      document.getElementById("cardTitle").value = title;
      document.getElementById("cardSopId").value = sopId;
    }
    document.getElementById("saveNewSop").checked = false;
    document.getElementById("sourceMeta").hidden = false;
    document.getElementById("sourceMeta").innerHTML = `Created <strong>${esc(
      title
    )}</strong> · <code>${esc(focusCardKey)}</code> · SOP <code>${esc(sopId)}</code>`;
    setStatus(
      document.getElementById("sourceStatus"),
      "New card ready — in liveAct click Refresh queue. Showing only this card here.",
      "ok"
    );
  } catch (err) {
    setStatus(status, err.message, "err");
  }
}

function bind() {
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
    setStatus(document.getElementById("sourceStatus"), "Showing all cards", "ok");
  });
  document.getElementById("btnLoadSource").addEventListener("click", loadSelectedSource);
  document.getElementById("btnCreate").addEventListener("click", createCard);
  document.getElementById("btnLoadSop").addEventListener("click", () => {
    loadSopById(document.getElementById("cardSopId").value);
  });
  document.getElementById("btnAddClick").addEventListener("click", () => addStep("click"));
  document.getElementById("btnAddFill").addEventListener("click", () => addStep("fill"));
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
  document.getElementById("btnClearData").addEventListener("click", () => {
    writeDataJson({});
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
  renderSteps();
  try {
    await refreshLists();
  } catch (err) {
    setStatus(document.getElementById("sourceStatus"), err.message, "err");
  }
}

boot();
