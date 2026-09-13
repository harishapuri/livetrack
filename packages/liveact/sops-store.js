/**
 * SOP catalog in livetrack.xlsx (Sops + SopSteps sheets).
 */
const { defaultProjectRoot } = require("./documents");
const workbookStore = require("./workbook");

function stepFromRow(row) {
  const parsed = workbookStore.parseJsonCell(row.payload_json);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  return {
    id: row.step_id,
    action: row.action,
    label: row.label,
    selector: row.selector,
    valueFrom: row.valueFrom,
    mandatory: String(row.mandatory) === "true",
  };
}

function sopFromRow(row, steps) {
  const parsed = workbookStore.parseJsonCell(row.payload_json);
  const sop = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...parsed } : {};
  sop.id = row.id || sop.id;
  if (row.name) sop.name = row.name;
  if (row.status) sop.status = row.status;
  if (row.formUrl) sop.formUrl = row.formUrl;
  if (row.targetType) sop.targetType = row.targetType;
  sop.steps = steps.length ? steps : sop.steps || [];
  return sop;
}

async function loadAllSopObjects(projectRoot = defaultProjectRoot()) {
  const { Sops, SopSteps } = await workbookStore.readTables(["Sops", "SopSteps"], projectRoot);
  const stepsBy = new Map();
  for (const row of SopSteps || []) {
    if (!row.sop_id) continue;
    if (!stepsBy.has(row.sop_id)) stepsBy.set(row.sop_id, []);
    stepsBy.get(row.sop_id).push(stepFromRow(row));
  }
  return (Sops || [])
    .filter((row) => row.id)
    .map((row) => sopFromRow(row, stepsBy.get(row.id) || []));
}

async function loadPublishedSopMap(projectRoot = defaultProjectRoot()) {
  const map = {};
  for (const sop of await loadAllSopObjects(projectRoot)) {
    if (!sop?.id) continue;
    if (sop.status === "draft" || sop.status === "rejected") continue;
    map[sop.id] = sop;
  }
  return map;
}

async function upsertSop(sop, projectRoot = defaultProjectRoot()) {
  const id = String(sop?.id || "").trim();
  if (!id) throw new Error("SOP id is required");
  await workbookStore.withWorkbook(projectRoot, async (workbook) => {
    const headers = workbookStore.readSheetObjects(workbook, workbookStore.SHEETS.Sops);
    const steps = workbookStore.readSheetObjects(workbook, workbookStore.SHEETS.SopSteps);
    workbookStore.replaceSheet(workbook, workbookStore.SHEETS.Sops, [
      ...headers.filter((r) => r.id !== id),
      {
        id,
        name: sop.name || id,
        status: sop.status || "published",
        source: sop.status === "draft" ? "discovery" : sop.source || "user",
        formUrl: sop.formUrl || "",
        targetType: sop.targetType || "",
        payload_json: workbookStore.jsonCell(sop),
      },
    ]);
    workbookStore.replaceSheet(workbook, workbookStore.SHEETS.SopSteps, [
      ...steps.filter((r) => r.sop_id !== id),
      ...(Array.isArray(sop.steps) ? sop.steps : []).map((step) => ({
        sop_id: id,
        step_id: step.id || "",
        action: step.action || "",
        label: step.label || "",
        selector: step.selector || "",
        valueFrom: step.valueFrom || "",
        mandatory: step.mandatory ? "true" : "false",
        payload_json: workbookStore.jsonCell(step),
      })),
    ]);
  });
  return { ok: true, id, path: workbookStore.workbookPath(projectRoot) };
}

module.exports = {
  loadAllSopObjects,
  loadPublishedSopMap,
  upsertSop,
};
