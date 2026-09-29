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
/** Step indexes currently expanded in the SOP editor */
let openSteps = new Set();

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
  const keys = Object.keys(data || {}).filter((k) => {
    const v = data[k];
    return v == null || typeof v !== "object";
  });
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

function cleanedChoiceList(values) {
  if (!Array.isArray(values)) return [];
  return values.map((v) => String(v ?? "").trim()).filter(Boolean);
}

function fillModeOf(step) {
  if (step?.fillMode === "several" || step?.fillMode === "one") return step.fillMode;
  return cleanedChoiceList(step?.allowedValues).length >= 2 ? "several" : "one";
}

function oneFillValue(step) {
  const choices = cleanedChoiceList(step?.allowedValues);
  if (choices.length) return choices[0];
  return step?.value != null ? String(step.value) : "";
}

function fillChoicesMarkup(step, index) {
  const mode = fillModeOf(step);
  const oneValue = mode === "one" ? oneFillValue(step) : "";
  const rows = Array.isArray(step.allowedValues) ? step.allowedValues.map((v) => String(v ?? "")) : [];
  const choiceRows = rows.length ? rows : [""];
  const several = mode === "several"
    ? `<div class="choice-list">
        ${choiceRows
          .map(
            (value, rowIndex) => `<div class="choice-row">
              <input data-choice-index="${rowIndex}" value="${esc(value)}" placeholder="Choice ${rowIndex + 1}" />
              <button type="button" class="btn-ghost btn-sm" data-choice-remove="${rowIndex}" title="Remove choice">Remove</button>
            </div>`
          )
          .join("")}
        <button type="button" class="btn-ghost btn-sm" data-choice-add>Add choice</button>
      </div>`
    : `<label><span>Value</span><input data-fill-one value="${esc(oneValue)}" placeholder="Value to fill" /></label>`;
  return `<div class="fill-choices">
      <span class="fill-choices-title">Choices</span>
      <p class="hint">LiveTrack fills the first choice. Renaming the field keeps these. Leave empty to use case data.</p>
      <div class="fill-mode">
        <label class="check-inline"><input type="radio" name="fill-mode-${index}" data-fill-mode="one" ${
          mode === "one" ? "checked" : ""
        } /> One value</label>
        <label class="check-inline"><input type="radio" name="fill-mode-${index}" data-fill-mode="several" ${
          mode === "several" ? "checked" : ""
        } /> Several choices</label>
      </div>
      ${several}
    </div>`;
}

function renderSteps() {
  const list = document.getElementById("stepsList");
  syncRemoveChecksButtons();
  if (!steps.length) {
    list.innerHTML = `<p class="hint">No steps loaded — pick an SOP and click Reload, or add a step.</p>`;
    return;
  }

  list.innerHTML = steps
    .map((step, index) => {
      const action = step.action || "click";
      const shotQs = new URLSearchParams();
      if (step.screenshotPath) shotQs.set("path", step.screenshotPath);
      const lob = document.getElementById("cardLob")?.value?.trim();
      const cardId = document.getElementById("cardId")?.value?.trim();
      if (lob) shotQs.set("lob", lob);
      if (cardId) shotQs.set("cardId", cardId);
      const thumb = step.screenshotPath
        ? `<img class="step-thumb" alt="" src="${esc(`${apiBase()}/api/step-shots?${shotQs}`)}" />`
        : "";
      return `
    <div class="step-row${openSteps.has(index) ? " is-open" : ""}" data-index="${index}">
      <div class="step-head">
        ${thumb}
        <button type="button" class="fold-btn" data-toggle-step aria-expanded="${openSteps.has(index) ? "true" : "false"}" title="${openSteps.has(index) ? "Collapse step" : "Expand step"}"></button>
        <span class="num">#${index + 1}</span>
        <select data-k="action">
          ${["click", "fill", "check", "select", "highlight", "wait"]
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
        <label class="span-2"><span>finder</span><input data-k="finder" value="${esc(
          step.finder || ""
        )}" placeholder="Website label if the LiveTrack name does not match" /></label>
        <label class="span-2"><span>GUI id</span><input data-k="guiId" value="${esc(
          step.guiId || ""
        )}" placeholder="#fieldId or [name=&quot;field&quot;]" /></label>
        ${
          action === "fill" || action === "check" || action === "select"
            ? fillChoicesMarkup(step, index)
            : `<label><span>value (literal)</span><input data-k="value" value="${esc(
                step.value == null ? "" : String(step.value)
              )}" placeholder="optional fixed value" /></label>`
        }
        <label class="check-inline"><input type="checkbox" data-k="mandatory" ${
          step.mandatory ? "checked" : ""
        } /> mandatory</label>
        <label class="check-inline"><input type="checkbox" data-k="optional" ${
          step.optional ? "checked" : ""
        } /> optional</label>
        <label class="check-inline"><input type="checkbox" data-k="navigates" ${
          step.navigates ? "checked" : ""
        } /> navigates</label>
        <label class="span-2"><span>LiveTrack explanation</span><textarea data-k="explanation" rows="2" placeholder="What to say for this step">${esc(
          step.explanation || ""
        )}</textarea></label>
      </div>
    </div>`;
    })
    .join("");

  list.querySelectorAll(".step-row").forEach((row) => {
    const index = Number(row.getAttribute("data-index"));
    row.querySelector("[data-toggle-step]")?.addEventListener("click", () => {
      if (openSteps.has(index)) openSteps.delete(index);
      else openSteps.add(index);
      const open = openSteps.has(index);
      row.classList.toggle("is-open", open);
      const btn = row.querySelector("[data-toggle-step]");
      if (btn) {
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.title = open ? "Collapse step" : "Expand step";
      }
    });
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
        if (key === "mandatory") syncMasterMandatory();
      };
      el.addEventListener("input", apply);
      el.addEventListener("change", apply);
    });
    row.querySelectorAll("[data-fill-mode]").forEach((el) => {
      el.addEventListener("change", () => {
        const mode = el.getAttribute("data-fill-mode") === "several" ? "several" : "one";
        const current = cleanedChoiceList(steps[index].allowedValues);
        steps[index].fillMode = mode;
        if (mode === "several") {
          const seed = current.length ? current : oneFillValue(steps[index]).trim() ? [oneFillValue(steps[index]).trim()] : [];
          steps[index].allowedValues = seed.length ? [...seed, ""] : [""];
        } else {
          const first = current[0] || "";
          steps[index].value = first;
          steps[index].allowedValues = first ? [first] : [];
        }
        markSopDirty();
        renderSteps();
        const next = document
          .getElementById("stepsList")
          ?.querySelector(`.step-row[data-index="${index}"] [data-fill-one], .step-row[data-index="${index}"] [data-choice-index]`);
        next?.focus();
      });
    });
    row.querySelector("[data-fill-one]")?.addEventListener("input", (event) => {
      const text = String(event.target.value || "");
      steps[index].fillMode = "one";
      steps[index].value = text;
      steps[index].allowedValues = text.trim() ? [text] : [];
      markSopDirty();
    });
    row.querySelectorAll("[data-choice-index]").forEach((el) => {
      el.addEventListener("input", () => {
        const rowIndex = Number(el.getAttribute("data-choice-index"));
        const rows = Array.isArray(steps[index].allowedValues)
          ? [...steps[index].allowedValues]
          : [];
        while (rows.length <= rowIndex) rows.push("");
        rows[rowIndex] = el.value;
        steps[index].fillMode = "several";
        steps[index].allowedValues = rows;
        steps[index].value = cleanedChoiceList(rows)[0] || "";
        markSopDirty();
      });
    });
    row.querySelector("[data-choice-add]")?.addEventListener("click", () => {
      const rows = Array.isArray(steps[index].allowedValues) ? [...steps[index].allowedValues] : [];
      rows.push("");
      steps[index].fillMode = "several";
      steps[index].allowedValues = rows;
      markSopDirty();
      openSteps.add(index);
      renderSteps();
      const inputs = document
        .getElementById("stepsList")
        ?.querySelectorAll(`.step-row[data-index="${index}"] [data-choice-index]`);
      inputs?.[inputs.length - 1]?.focus();
    });
    row.querySelectorAll("[data-choice-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rowIndex = Number(btn.getAttribute("data-choice-remove"));
        const rows = Array.isArray(steps[index].allowedValues) ? [...steps[index].allowedValues] : [];
        rows.splice(rowIndex, 1);
        steps[index].fillMode = "several";
        steps[index].allowedValues = rows.length ? rows : [""];
        steps[index].value = cleanedChoiceList(steps[index].allowedValues)[0] || "";
        markSopDirty();
        openSteps.add(index);
        renderSteps();
      });
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
  syncMasterMandatory();
}

function syncMasterMandatory() {
  const el = document.getElementById("chkAllMandatory");
  const btn = document.getElementById("btnUncheckMandatory");
  const total = steps.length;
  const on = steps.filter((s) => s.mandatory).length;
  if (el) {
    el.checked = total > 0 && on === total;
    el.indeterminate = on > 0 && on < total;
  }
  if (btn) btn.disabled = on === 0;
}

function setAllMandatory(on) {
  steps.forEach((s) => {
    s.mandatory = Boolean(on);
  });
  markSopDirty();
  renderSteps();
}

function markSopDirty() {
  const mode = document.getElementById("sopSaveMode");
  if (mode.value === "none") {
    mode.value = studioMode === "edit" ? "update" : "new";
  }
}

function normalizeStepsForSave() {
  const impl = globalThis.LtNormalizeSteps?.normalizeStepsForSave;
  if (typeof impl === "function") return impl(steps);
  return steps.map((s, i) => {
    const action = s.action || "click";
    const id = slugify(s.id || s.label || `step-${i + 1}`) || `step-${i + 1}`;
    const step = {
      id,
      action,
      label: String(s.label || id).trim() || id,
    };
    if (s.selector) step.selector = String(s.selector).trim();
    const keepsChoices = action === "fill" || action === "check" || action === "select";
    if (keepsChoices && s.valueFrom) step.valueFrom = String(s.valueFrom).trim();
    if (action === "click") {
      const texts = parseFindByText(s.findByText);
      if (texts.length) step.findByText = texts;
    }
    const labelHints = Array.isArray(s.findByLabel)
      ? s.findByLabel.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    if (labelHints.length) step.findByLabel = labelHints[0];
    else if (s.findByLabel) step.findByLabel = String(s.findByLabel).trim();
    const finder =
      String(s.finder || "").replace(/\s+/g, " ").trim() ||
      labelHints.find((item) => item.toLowerCase() !== String(step.label || "").trim().toLowerCase()) ||
      "";
    if (finder && finder.toLowerCase() !== String(step.label || "").trim().toLowerCase()) {
      step.finder = finder;
    }
    const guiId = String(s.guiId || s.selector || "").trim();
    if (
      guiId &&
      (guiId.startsWith("#") || /\[(name|id|data-automation-id|data-testid|data-test)=/i.test(guiId)) &&
      !/^(input|select|textarea|button)\[type=/i.test(guiId)
    ) {
      step.guiId = guiId;
      step.selector = guiId;
    }
    const allowed = Array.isArray(s.allowedValues)
      ? s.allowedValues.map((v) => String(v ?? "").trim()).filter(Boolean)
      : null;
    if (keepsChoices && allowed) {
      if (allowed.length) {
        step.allowedValues = allowed;
        step.value = allowed[0];
      }
    } else if (keepsChoices && s.value != null && String(s.value).trim()) {
      const literal = String(s.value).trim();
      step.allowedValues = [literal];
      step.value = literal;
    } else if (s.value != null && s.value !== "") {
      step.value = s.value;
    }
    if (s.waitAfter && typeof s.waitAfter === "object") step.waitAfter = s.waitAfter;
    if (s.navigates) step.navigates = true;
    if (s.mandatory) step.mandatory = true;
    if (s.optional) step.optional = true;
    const explanation = String(s.explanation || "").replace(/\s+/g, " ").trim();
    if (explanation) step.explanation = explanation;
    const screenshotPath = String(s.screenshotPath || "").trim();
    if (screenshotPath) step.screenshotPath = screenshotPath;
    return step;
  });
}

function scalarCaseValue(data, key) {
  if (!data || key == null || key === "") return "";
  if (!Object.prototype.hasOwnProperty.call(data, key)) return "";
  const raw = data[key];
  if (raw == null || typeof raw === "object") return "";
  return String(raw).trim();
}

function applySopDraft(sop) {
  sopDraft = sop ? { ...sop } : null;
  openSteps = new Set();
  let caseData = {};
  try {
    caseData = parseDataJson();
  } catch {
    caseData = {};
  }
  const sample = sop?.sampleData && typeof sop.sampleData === "object" ? sop.sampleData : {};
  steps = Array.isArray(sop?.steps)
    ? sop.steps.map((s) => {
        const action = s.action || "click";
        const choices = cleanedChoiceList(s.allowedValues);
        const literal = s.value != null ? String(s.value).trim() : "";
        const keepsChoices = action === "fill" || action === "check" || action === "select";
        const recorded =
          scalarCaseValue(caseData, s.id) ||
          scalarCaseValue(sample, s.id) ||
          scalarCaseValue(caseData, s.valueFrom) ||
          scalarCaseValue(sample, s.valueFrom) ||
          literal;
        const allowedValues = keepsChoices
          ? choices.length
            ? choices
            : recorded
              ? [recorded]
              : []
          : s.allowedValues;
        return {
          ...s,
          findByText: Array.isArray(s.findByText) ? s.findByText.join(", ") : s.findByText || "",
          fillMode: keepsChoices && allowedValues.length >= 2 ? "several" : "one",
          allowedValues,
          value: keepsChoices && allowedValues.length ? allowedValues[0] : s.value,
        };
      })
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
    if (sop.sampleData && typeof sop.sampleData === "object") {
      let current = {};
      try {
        current = parseDataJson();
      } catch {
        current = {};
      }
      const clicks = Array.isArray(current.clicks) ? current.clicks : [];
      if (!clicks.length && Array.isArray(sop.sampleData.clicks)) {
        writeDataJson({
          ...sop.sampleData,
          ...current,
          ticket: current.ticket || sop.sampleData.ticket || null,
          startUrl: current.startUrl || sop.sampleData.startUrl || sop.formUrl || "",
          clicks: sop.sampleData.clicks,
        });
      } else if (!current.ticket && !current.startUrl) {
        writeDataJson({
          ticket: sop.sampleData.ticket || sop.ticket || null,
          startUrl: sop.sampleData.startUrl || sop.formUrl || "",
          clicks: clicks.length ? clicks : sop.sampleData.clicks || [],
          ...current,
        });
      }
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
      fillMode: "one",
      allowedValues: [],
      value: "",
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
  openSteps.add(steps.length - 1);
  renderSteps();
  setStatus(document.getElementById("sopStatus"), `Added ${action} step`, "ok");
}

function isCheckStep(step) {
  const action = String(step?.action || "").toLowerCase();
  if (action === "check") return true;
  const labels = []
    .concat(step?.findCheckboxByLabel || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return labels.length > 0;
}

function syncRemoveChecksButtons() {
  const busy = Boolean(document.getElementById("btnRemoveChecksTop")?.dataset.busy);
  for (const id of ["btnRemoveChecks", "btnRemoveChecksTop"]) {
    const el = document.getElementById(id);
    if (el && !busy) el.disabled = false;
  }
}

function setRemoveChecksStatus(msg, kind) {
  setStatus(document.getElementById("studioTopStatus"), msg, kind);
  setStatus(document.getElementById("sopStatus"), msg, kind);
}

function setRemoveChecksBusy(busy) {
  for (const id of ["btnRemoveChecks", "btnRemoveChecksTop"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.disabled = Boolean(busy);
    if (busy) el.dataset.busy = "1";
    else delete el.dataset.busy;
  }
}

async function ensureStudioCardLoaded() {
  if (steps.length && (editingKey || studioMode === "create")) return true;
  const sel = document.getElementById("sourceCard")?.value;
  if (sel) {
    await loadSelectedSource();
    return steps.length > 0 || Boolean(editingKey);
  }
  const sopId = document.getElementById("cardSopId")?.value;
  if (sopId) {
    await loadSopById(sopId);
    return steps.length > 0;
  }
  return false;
}

function dropCheckValuesFromData(removed) {
  const keys = new Set(
    removed
      .map((s) => String(s.valueFrom || s.id || "").trim())
      .filter(Boolean)
  );
  if (!keys.size) return;
  let data;
  try {
    data = parseDataJson();
  } catch {
    return;
  }
  let changed = false;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      delete data[key];
      changed = true;
    }
  }
  if (changed) writeDataJson(data);
}

async function removeCheckStepsAndPublish() {
  setRemoveChecksBusy(true);
  try {
    if (typeof window.dashNavigate === "function") {
      const hash = String(location.hash || "");
      if (!hash.includes("/studio")) window.dashNavigate("studio", { push: true });
    }
    const ready = await ensureStudioCardLoaded();
    if (!ready && !steps.length) {
      setRemoveChecksStatus("Load a queue card first, then remove checks", "err");
      return;
    }
    const checks = steps.filter(isCheckStep);
    if (!checks.length) {
      setRemoveChecksStatus("No check (Yes/No) steps to remove", "ok");
      return;
    }
    const kept = steps.filter((s) => !isCheckStep(s));
    if (!kept.length) {
      setRemoveChecksStatus(
        "That would remove every step. Keep at least one fill, click, or navigate step.",
        "err"
      );
      return;
    }
    const n = checks.length;
    if (
      !confirm(
        `Remove ${n} Yes/No check step${n === 1 ? "" : "s"} and keep ${kept.length} other step${
          kept.length === 1 ? "" : "s"
        }? This will save and publish the SOP.`
      )
    ) {
      return;
    }
    steps = kept;
    openSteps = new Set();
    dropCheckValuesFromData(checks);
    const mode = document.getElementById("sopSaveMode");
    if (mode) mode.value = studioMode === "edit" && editingKey ? "update" : "new";
    markSopDirty();
    renderSteps();
    setRemoveChecksStatus(`Removed ${n} check step${n === 1 ? "" : "s"} — publishing…`, "ok");
    if (studioMode === "edit" && editingKey) {
      await saveExistingCard({ publish: true });
    } else {
      await createCard({ publish: true });
    }
    const createStatus = document.getElementById("createStatus");
    setRemoveChecksStatus(
      createStatus?.textContent || "Published",
      createStatus?.classList.contains("err") ? "err" : "ok"
    );
  } finally {
    setRemoveChecksBusy(false);
    syncRemoveChecksButtons();
  }
}

function suggestNewSopId() {
  const cardId = slugify(document.getElementById("cardId").value);
  const base = slugify(document.getElementById("cardSopId").value);
  if (cardId) return cardId.startsWith("demo-") ? cardId : `demo-${cardId}`;
  if (base) return `${base}-copy`;
  return "";
}

function setMode(mode) {
  resetDeleteArm();
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
  const resolvedKey = `${card.lob}/${card.id}`;
  const sel = document.getElementById("sourceCard");
  if (![...sel.options].some((o) => o.value === resolvedKey)) {
    const opt = document.createElement("option");
    opt.value = resolvedKey;
    opt.textContent = `${card.lob} / ${card.id} — ${card.title || card.id}`;
    sel.appendChild(opt);
  }
  sel.value = resolvedKey;
  document.getElementById("sourceMeta").hidden = false;
  document.getElementById("sourceMeta").innerHTML = `${
    asCopy ? "Template" : "Editing"
  } <strong>${esc(card.title || card.id)}</strong> · <code>${esc(asCopy ? key : resolvedKey)}</code>`;
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

async function retargetFocusCard(cards) {
  if (!focusCardKey) return;
  if (cards.some((c) => `${c.lob}/${c.id}` === focusCardKey)) return;
  const slash = focusCardKey.indexOf("/");
  if (slash <= 0) return;
  const lob = focusCardKey.slice(0, slash);
  const id = focusCardKey.slice(slash + 1);
  try {
    const res = await api(
      `/api/queue-cards/${encodeURIComponent(lob)}/${encodeURIComponent(id)}`
    );
    const resolved = `${res.card.lob}/${res.card.id}`;
    if (!cards.some((c) => `${c.lob}/${c.id}` === resolved)) return;
    focusCardKey = resolved;
    if (editingKey && editingKey !== resolved) editingKey = resolved;
  } catch {
    /* keep the empty-state message */
  }
}

async function refreshLists() {
  const [queue, sops] = await Promise.all([api("/api/queue-cards"), api("/api/sops")]);
  cardsCache = queue.cards || [];
  sopsCache = sops.sops || [];
  await retargetFocusCard(cardsCache);
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

function offlinePublishMessage(text) {
  return /not running|not open/i.test(String(text || ""));
}

async function publishLiveAct() {
  try {
    const res = await api("/api/publish-liveact", { method: "POST", body: "{}" });
    if (res.offline) {
      return {
        ok: true,
        offline: true,
        message: res.note || "LiveTrack is not open; it will load this update when it starts.",
      };
    }
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
    const message = err.message || "Publish failed";
    if (offlinePublishMessage(message)) {
      return {
        ok: true,
        offline: true,
        message: "LiveTrack is not open; it will load this update when it starts.",
      };
    }
    return { ok: false, message };
  }
}

let cardSaveInFlight = false;

async function saveExistingCard({ publish = false } = {}) {
  const status = document.getElementById("createStatus");
  if (cardSaveInFlight) return;
  if (!editingKey) {
    setStatus(status, "Load a card in Edit mode first", "err");
    return;
  }
  cardSaveInFlight = true;
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

    const savedLine = `Saved ${res.lob}/${res.id}${res.moved ? " (moved)" : ""}${sopMsg}`;
    // The card is already on disk. LiveTrack's reload can take a while after the app has updated.
    setStatus(status, savedLine, "ok");

    let pubMsg = "";
    if (publish) {
      const pub = await publishLiveAct();
      pubMsg = pub.ok ? ` · ${pub.message}` : ` · saved, but ${pub.message}`;
      if (pub.ok && Array.isArray(pub.cardIds) && !pub.cardIds.includes(res.id)) {
        pubMsg += ` · note: ${res.id} is not in your LiveTrack list (assignees)`;
      }
      setStatus(status, `${savedLine}${pubMsg}`, pubMsg.includes("but") ? "err" : "ok");
    }
    await refreshLists();
    const updated = cardsCache.find((c) => c.lob === res.lob && c.id === res.id);
    if (updated) await fillFormFromCard(updated, { asCopy: false });
    document.getElementById("sourceMeta").hidden = false;
    document.getElementById("sourceMeta").innerHTML = `Saved <strong>${esc(
      payload.title
    )}</strong> · <code>${esc(editingKey)}</code>`;
  } catch (err) {
    setStatus(status, err.message, "err");
  } finally {
    cardSaveInFlight = false;
  }
}

async function createCard({ publish = false } = {}) {
  const status = document.getElementById("createStatus");
  if (cardSaveInFlight) return;
  cardSaveInFlight = true;
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

    const savedLine = `Created ${res.lob}/${res.id}${sopMsg}`;
    setStatus(status, savedLine, "ok");

    let pubMsg = "";
    if (publish) {
      const pub = await publishLiveAct();
      pubMsg = pub.ok ? ` · ${pub.message}` : ` · created, but ${pub.message}`;
      if (pub.ok && Array.isArray(pub.cardIds) && !pub.cardIds.includes(res.id)) {
        pubMsg += ` · note: ${res.id} is not in your LiveTrack list (assignees)`;
      }
      setStatus(status, `${savedLine}${pubMsg}`, pubMsg.includes("but") ? "err" : "ok");
    }
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
  } finally {
    cardSaveInFlight = false;
  }
}

async function saveAsCopy() {
  setMode("create");
  const idEl = document.getElementById("cardId");
  if (!idEl.value.endsWith("-copy")) idEl.value = `${slugify(idEl.value) || "card"}-copy`;
  document.getElementById("sopSaveMode").value = "none";
  await createCard({ publish: true });
}

let deleteArmedKey = null;

function resetDeleteArm() {
  deleteArmedKey = null;
  const btn = document.getElementById("btnDelete");
  if (btn) btn.textContent = "Delete card";
}

async function deleteCard() {
  const status = document.getElementById("createStatus");
  if (!editingKey) {
    resetDeleteArm();
    setStatus(status, "Load a card in Edit mode first", "err");
    return;
  }
  const [lob, id] = editingKey.split("/");
  if (deleteArmedKey !== editingKey) {
    deleteArmedKey = editingKey;
    const btn = document.getElementById("btnDelete");
    if (btn) btn.textContent = "Confirm delete";
    setStatus(status, `Click Confirm delete to remove ${lob}/${id}. This cannot be undone.`, "err");
    return;
  }
  resetDeleteArm();
  setStatus(status, "Deleting…");
  try {
    await api(`/api/queue-cards/${encodeURIComponent(lob)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const removed = `${lob}/${id}`;
    cardsCache = cardsCache.filter((c) => `${c.lob}/${c.id}` !== removed);
    fillSourceSelect(cardsCache);
    renderCardsTable(cardsCache);
    editingKey = null;
    focusCardKey = null;
    setMode("edit");
    writeDataJson({});
    applySopDraft(null);
    document.getElementById("cardId").value = "";
    document.getElementById("cardTitle").value = "";
    document.getElementById("sourceMeta").hidden = true;
    document.getElementById("editBanner").hidden = true;
    document.getElementById("queueRootHint").textContent = `Root: ${cardsCache.length} cards`;
    setStatus(status, `Deleted ${lob}/${id}`, "ok");
    refreshLists().catch((err) => setStatus(status, err.message, "err"));
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
  const onRemoveChecks = () => {
    removeCheckStepsAndPublish().catch((err) =>
      setStatus(document.getElementById("sopStatus"), err.message, "err")
    );
  };
  document.getElementById("btnRemoveChecks")?.addEventListener("click", onRemoveChecks);
  document.getElementById("btnRemoveChecksTop")?.addEventListener("click", onRemoveChecks);
  document.getElementById("chkAllMandatory")?.addEventListener("change", (event) => {
    setAllMandatory(Boolean(event.target.checked));
  });
  document.getElementById("btnUncheckMandatory")?.addEventListener("click", () => {
    setAllMandatory(false);
  });
  document.getElementById("btnExpandSteps")?.addEventListener("click", () => {
    openSteps = new Set(steps.map((_, i) => i));
    renderSteps();
  });
  document.getElementById("btnCollapseSteps")?.addEventListener("click", () => {
    openSteps = new Set();
    renderSteps();
  });
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
  writeDataJson(
    sop.sampleData && typeof sop.sampleData === "object"
      ? sop.sampleData
      : { ticket: sop.ticket || null, startUrl: sop.formUrl || "", clicks: [] }
  );
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
  const cardKey = String(query.get("card") || "").trim();
  if (cardKey.includes("/")) {
    setMode("edit");
    await openCard(cardKey, { asCopy: false });
    return;
  }
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
