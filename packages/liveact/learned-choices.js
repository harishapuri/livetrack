/**
 * Extra answers typed on marked (mandatory) fill/select steps.
 * Stored in livetrack.xlsx LearnedChoices. Static SOP allowedValues are never rewritten.
 */
const { defaultProjectRoot } = require("./documents");
const workbookStore = require("./workbook");

/** Same step edited again within this window updates the row instead of adding another. */
const REVISE_MS = 12000;

function normalizeChoice(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanChoiceList(values) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const text = String(raw ?? "").trim();
    const key = normalizeChoice(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** SME-authored choices. allowedValues win; a single step.value is the static fallback. */
function staticChoiceList(step) {
  const allowed = cleanChoiceList(step?.allowedValues);
  if (allowed.length) return allowed;
  const literal = String(step?.value ?? "").trim();
  return literal ? [literal] : [];
}

function isMarkedChoiceStep(step) {
  if (!step?.mandatory) return false;
  const action = String(step.action || "").toLowerCase();
  return action === "fill" || action === "select";
}

function savedValuesForStep(stepId, rows) {
  const id = String(stepId || "");
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.step_id || "") === id)
    .map((row) => row.value);
}

/** Static choices first, then each saved value once. */
function mergeChoiceLists(staticValues, savedValues) {
  return cleanChoiceList([...(staticValues || []), ...(savedValues || [])]);
}

/**
 * Merged list for a marked step, or null when the step is not marked
 * (caller keeps the SOP choices unchanged).
 */
function mergedChoicesForStep(step, savedRows) {
  if (!isMarkedChoiceStep(step)) return null;
  return mergeChoiceLists(staticChoiceList(step), savedValuesForStep(step?.id, savedRows));
}

function isDuplicateChoice(sopId, stepId, value, staticValues, savedRows) {
  const key = normalizeChoice(value);
  if (!key) return true;
  const id = String(sopId || "");
  const sid = String(stepId || "");
  if ((staticValues || []).some((item) => normalizeChoice(item) === key)) return true;
  return (Array.isArray(savedRows) ? savedRows : []).some(
    (row) =>
      String(row?.sop_id || "") === id &&
      String(row?.step_id || "") === sid &&
      normalizeChoice(row.value) === key,
  );
}

function groupRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const id = String(row?.sop_id || "").trim();
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

function sameChoiceList(step, merged) {
  const current = cleanChoiceList(step?.allowedValues);
  if (current.length !== merged.length) return false;
  return current.every((item, index) => item === merged[index]);
}

/** Copy of the SOP whose marked steps include saved answers. Original steps stay as authored. */
function applyLearnedToSop(sop, rows) {
  if (!sop || !Array.isArray(sop.steps)) return sop;
  let changed = false;
  const steps = sop.steps.map((step) => {
    const merged = mergedChoicesForStep(step, rows);
    if (!merged || sameChoiceList(step, merged)) return step;
    changed = true;
    return { ...step, allowedValues: merged };
  });
  if (!changed) return sop;
  return { ...sop, steps };
}

async function listAll(projectRoot = defaultProjectRoot()) {
  const { LearnedChoices } = await workbookStore.readTables(["LearnedChoices"], projectRoot);
  return LearnedChoices || [];
}

async function groupedBySop(projectRoot = defaultProjectRoot()) {
  return groupRows(await listAll(projectRoot));
}

function rowStamp(row) {
  const at = Date.parse(String(row?.created_at || ""));
  return Number.isFinite(at) ? at : 0;
}

/** Last saved row for this step, if it was written during the same edit. */
function recentRowIndex(rows, sopId, stepId, now = Date.now()) {
  let idx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (String(row?.sop_id || "") !== sopId || String(row?.step_id || "") !== stepId) continue;
    idx = i;
  }
  if (idx < 0) return -1;
  const age = now - rowStamp(rows[idx]);
  if (age < 0 || age > REVISE_MS) return -1;
  return idx;
}

/**
 * Walk rows in order. A later value for the same step inside the edit window
 * replaces the previous row, so half-typed answers are not kept.
 */
function collapseRecentRows(rows, now = Date.now()) {
  const out = [];
  for (const row of rows || []) {
    const id = String(row?.sop_id || "").trim();
    const sid = String(row?.step_id || "").trim();
    const text = String(row?.value || "").trim();
    if (!id || !sid || !text) continue;
    const key = normalizeChoice(text);
    const dup = out.some(
      (item) =>
        item.sop_id === id && item.step_id === sid && normalizeChoice(item.value) === key,
    );
    if (dup) continue;
    const idx = recentRowIndex(out, id, sid, rowStamp(row) || now);
    if (idx >= 0) {
      out[idx] = { ...row, sop_id: id, step_id: sid, value: text };
      continue;
    }
    out.push({ ...row, sop_id: id, step_id: sid, value: text });
  }
  return out;
}

async function rememberChoice({
  sopId,
  stepId,
  value,
  staticValues = [],
  projectRoot = defaultProjectRoot(),
} = {}) {
  const text = String(value ?? "").trim();
  const id = String(sopId || "").trim();
  const sid = String(stepId || "").trim();
  if (!text || !id || !sid) return { saved: false, reason: "empty" };
  if (isDuplicateChoice(id, sid, text, staticValues, [])) {
    return { saved: false, reason: "static" };
  }

  let saved = false;
  let revised = false;
  let row = null;
  await workbookStore.withWorkbook(projectRoot, async (workbook) => {
    const spec = workbookStore.SHEETS.LearnedChoices;
    const existing = workbookStore.readSheetObjects(workbook, spec);
    if (isDuplicateChoice(id, sid, text, staticValues, existing)) return;
    const idx = recentRowIndex(existing, id, sid);
    row = {
      sop_id: id,
      step_id: sid,
      value: text,
      created_at: new Date().toISOString(),
    };
    if (idx >= 0) {
      const next = existing.slice();
      next[idx] = row;
      workbookStore.replaceSheet(workbook, spec, next);
      revised = true;
    } else {
      workbookStore.replaceSheet(workbook, spec, existing.concat([row]));
    }
    saved = true;
  });
  if (!saved) return { saved: false, reason: "duplicate" };
  return { saved: true, revised, row };
}

module.exports = {
  normalizeChoice,
  staticChoiceList,
  isMarkedChoiceStep,
  mergeChoiceLists,
  mergedChoicesForStep,
  isDuplicateChoice,
  groupRows,
  applyLearnedToSop,
  listAll,
  groupedBySop,
  collapseRecentRows,
  rememberChoice,
};
