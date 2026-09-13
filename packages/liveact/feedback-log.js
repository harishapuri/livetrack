/**
 * Feedback Service — approve / edit / reject log in livetrack.xlsx (Feedback table).
 */
const { defaultProjectRoot } = require("./documents");
const workbookStore = require("./workbook");

async function recordFeedback(entry) {
  try {
    const row = {
      ts: new Date().toISOString(),
      source: String(entry?.source || "autofill"),
      action: String(entry?.action || "approve"),
      cardId: entry?.cardId || "",
      sopId: entry?.sopId || "",
      user: entry?.user || "",
      proposalCount: Array.isArray(entry?.proposals) ? entry.proposals.length : 0,
      editedCount: entry?.edited ? Object.keys(entry.edited).length : 0,
      reason: entry?.reason || "",
      payload_json: workbookStore.jsonCell(entry?.meta),
    };
    await workbookStore.appendRows("Feedback", [row], defaultProjectRoot());
    return { ok: true };
  } catch (err) {
    console.error("[livetrack] feedback log failed", err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

async function readAllFeedback({ dateFrom = null, dateTo = null } = {}) {
  const { Feedback } = await workbookStore.readTables(["Feedback"], defaultProjectRoot());
  const rows = (Feedback || []).map((row) => ({
    ts: row.ts,
    source: row.source,
    action: row.action,
    cardId: row.cardId || null,
    sopId: row.sopId || null,
    user: row.user || null,
    proposalCount: Number(row.proposalCount) || 0,
    editedCount: Number(row.editedCount) || 0,
    reason: row.reason || null,
    meta: workbookStore.parseJsonCell(row.payload_json) || undefined,
  }));
  const filtered = rows.filter((row) => {
    const day = String(row.ts || "").slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    return true;
  });
  filtered.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return filtered;
}

function summarizeFeedback(rows) {
  const bySource = {};
  for (const row of rows) {
    const key = row.source || "autofill";
    if (!bySource[key]) {
      bySource[key] = { source: key, approve: 0, edit: 0, reject: 0, total: 0 };
    }
    const bucket = bySource[key];
    bucket.total += 1;
    if (row.action === "approve") bucket.approve += row.editedCount > 0 ? 0 : 1;
    if (row.action === "approve" && row.editedCount > 0) bucket.edit += 1;
    if (row.action === "edit") bucket.edit += 1;
    if (row.action === "reject") bucket.reject += 1;
  }
  const list = Object.values(bySource).map((b) => ({
    ...b,
    acceptanceRate: b.total ? Math.round(((b.approve + b.edit) / b.total) * 100) : null,
  }));
  list.sort((a, b) => b.total - a.total);
  return list;
}

module.exports = {
  recordFeedback,
  readAllFeedback,
  summarizeFeedback,
};
