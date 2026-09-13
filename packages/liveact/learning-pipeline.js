/**
 * Learning Pipeline (DPIP) — versioned dataset builder + approval gate.
 *
 * No model training exists in this codebase yet, so this deliberately stops
 * at "produce a structured, versioned, reviewable dataset" rather than
 * pretending to fine-tune anything. That keeps it honest and gives a real
 * seat for the governance rule: a dataset version is written as unapproved,
 * and nothing downstream (Expert Pattern Discovery, a future model) should
 * treat it as usable until an SME approves that specific version.
 *
 * Sources per version:
 *   - Mistake-free executions (positive fill examples) via generate-sql.js
 *   - Approved / edited agent-fill proposals from the Feedback Service log
 *     (positive signal on what a human accepted)
 *   - Rejected proposals are recorded too, as negative examples — useful for
 *     future model training, but still gated behind the same dataset approval.
 */
const fs = require("fs");
const path = require("path");
const { defaultProjectRoot } = require("./documents");
const { loadAllExecutions, defaultDateRangeDays } = require("./generate-sql");
const { readAllFeedback } = require("./feedback-log");
const workbookStore = require("./workbook");

function datasetsRoot() {
  return path.join(defaultProjectRoot(), "datasets");
}

function versionDir(version) {
  return path.join(datasetsRoot(), `v${String(version).padStart(3, "0")}`);
}

async function nextVersion() {
  const datasets = await listDatasets();
  const versions = datasets.map((d) => Number(d.version)).filter((n) => Number.isFinite(n) && n > 0);
  return (versions.length ? Math.max(...versions) : 0) + 1;
}

function executionExamples(runs) {
  const examples = [];
  for (const run of runs) {
    const mistakeCount = (run.mistakes || []).length;
    if (mistakeCount > 0) continue; // only mistake-free runs are positive examples
    const answers = run.answers || {};
    const fields = Object.entries(answers)
      .filter(([, v]) => v != null && String(v).trim() !== "")
      .map(([key, value]) => ({ key, value: String(value) }));
    if (!fields.length) continue;
    examples.push({
      type: "execution",
      label: "positive",
      cardKey: run.queue_card_id || run.queue_card || "(unknown)",
      fillMode: run.fill_mode || "automated",
      completedAt: run.completed_at || run.run_date || "",
      fields,
    });
  }
  return examples;
}

function feedbackExamples(feedbackRows) {
  const examples = [];
  for (const row of feedbackRows) {
    if (row.source !== "autofill" && row.source !== "coach") continue;
    if (row.action === "approve" || row.action === "edit") {
      examples.push({
        type: "feedback",
        label: row.editedCount > 0 ? "positive_edited" : "positive",
        cardKey: row.cardId || "(unknown)",
        ts: row.ts,
        proposalCount: row.proposalCount,
        editedCount: row.editedCount,
      });
    } else if (row.action === "reject") {
      examples.push({
        type: "feedback",
        label: "negative",
        cardKey: row.cardId || "(unknown)",
        ts: row.ts,
        proposalCount: row.proposalCount,
      });
    }
  }
  return examples;
}

/**
 * Build and persist a new dataset version from the last `days` of history.
 * The new version starts unapproved — see approveDataset().
 */
async function buildDataset({ days = 30, executionsRoot } = {}) {
  const range = defaultDateRangeDays(days);
  const { runs } = await loadAllExecutions({
    includeAnswers: true,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    executionsRoot,
  });
  const feedbackRows = await readAllFeedback({ dateFrom: range.dateFrom, dateTo: range.dateTo });

  const examples = [...executionExamples(runs), ...feedbackExamples(feedbackRows)];
  const version = await nextVersion();
  const projectRoot = defaultProjectRoot();
  const manifest = {
    version,
    createdAt: new Date().toISOString(),
    sourceRange: { from: range.dateFrom, to: range.dateTo },
    exampleCount: examples.length,
    positiveCount: examples.filter((e) => String(e.label).startsWith("positive")).length,
    negativeCount: examples.filter((e) => e.label === "negative").length,
    approved: false,
    approvedAt: null,
    approvedBy: null,
    rejected: false,
  };
  const { Datasets, DatasetExamples } = await workbookStore.readTables(
    ["Datasets", "DatasetExamples"],
    projectRoot
  );
  await workbookStore.replaceRows(
    "Datasets",
    [
      ...(Datasets || []).filter((d) => Number(d.version) !== version),
      {
        version: String(version),
        createdAt: manifest.createdAt,
        source_from: range.dateFrom,
        source_to: range.dateTo,
        exampleCount: String(manifest.exampleCount),
        positiveCount: String(manifest.positiveCount),
        negativeCount: String(manifest.negativeCount),
        approved: "false",
        approvedAt: "",
        approvedBy: "",
        rejected: "false",
        payload_json: workbookStore.jsonCell(manifest),
      },
    ],
    projectRoot
  );
  await workbookStore.replaceRows(
    "DatasetExamples",
    [
      ...(DatasetExamples || []).filter((e) => Number(e.version) !== version),
      ...examples.map((e) => ({
        version: String(version),
        type: e.type || "",
        label: e.label || "",
        cardKey: e.cardKey || "",
        payload_json: workbookStore.jsonCell(e),
      })),
    ],
    projectRoot
  );

  return { ok: true, manifest, path: workbookStore.workbookPath(projectRoot) };
}

function rowToManifest(row) {
  const extra = workbookStore.parseJsonCell(row.payload_json);
  const base = extra && typeof extra === "object" ? extra : {};
  return {
    ...base,
    version: Number(row.version),
    createdAt: row.createdAt || base.createdAt,
    sourceRange: base.sourceRange || { from: row.source_from, to: row.source_to },
    exampleCount: Number(row.exampleCount) || 0,
    positiveCount: Number(row.positiveCount) || 0,
    negativeCount: Number(row.negativeCount) || 0,
    approved: String(row.approved) === "true" || row.approved === true,
    approvedAt: row.approvedAt || null,
    approvedBy: row.approvedBy || null,
    rejected: String(row.rejected) === "true" || row.rejected === true,
  };
}

async function listDatasets() {
  const { Datasets } = await workbookStore.readTables(["Datasets"]);
  const manifests = (Datasets || []).map(rowToManifest);
  manifests.sort((a, b) => b.version - a.version);
  return manifests;
}

async function writeManifest(version, manifest) {
  const projectRoot = defaultProjectRoot();
  const { Datasets } = await workbookStore.readTables(["Datasets"], projectRoot);
  const next = (Datasets || []).map((row) => {
    if (Number(row.version) !== Number(version)) return row;
    return {
      ...row,
      approved: manifest.approved ? "true" : "false",
      approvedAt: manifest.approvedAt || "",
      approvedBy: manifest.approvedBy || "",
      rejected: manifest.rejected ? "true" : "false",
      payload_json: workbookStore.jsonCell(manifest),
    };
  });
  await workbookStore.replaceRows("Datasets", next, projectRoot);
  return manifest;
}

async function getManifest(version) {
  const datasets = await listDatasets();
  return datasets.find((d) => d.version === Number(version)) || null;
}

async function approveDataset(version, approvedBy = "") {
  const manifest = await getManifest(version);
  if (!manifest) return { ok: false, error: "dataset_not_found" };
  manifest.approved = true;
  manifest.rejected = false;
  manifest.approvedAt = new Date().toISOString();
  manifest.approvedBy = approvedBy || null;
  await writeManifest(version, manifest);
  return { ok: true, manifest };
}

async function rejectDataset(version, reason = "") {
  const manifest = await getManifest(version);
  if (!manifest) return { ok: false, error: "dataset_not_found" };
  manifest.approved = false;
  manifest.rejected = true;
  manifest.rejectedReason = reason || null;
  manifest.rejectedAt = new Date().toISOString();
  await writeManifest(version, manifest);
  return { ok: true, manifest };
}

async function latestApprovedDataset() {
  const datasets = await listDatasets();
  return datasets.find((m) => m.approved && !m.rejected) || null;
}

module.exports = {
  datasetsRoot,
  buildDataset,
  listDatasets,
  approveDataset,
  rejectDataset,
  latestApprovedDataset,
  getManifest,
};
