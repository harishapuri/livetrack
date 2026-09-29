const crypto = require("crypto");
const { defaultProjectRoot } = require("./documents");
const workbookStore = require("./workbook");

function newId() {
  if (typeof crypto.randomUUID === "function") return `tch_${crypto.randomUUID()}`;
  return `tch_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function rowToRecord(row) {
  const src = row && typeof row === "object" ? row : {};
  return {
    id: String(src.id || ""),
    ts: String(src.ts || ""),
    user: String(src.user || ""),
    conversation: String(src.conversation || ""),
    original: String(src.original || ""),
    refined: String(src.refined || ""),
    usedAi: src.usedAi === true || src.usedAi === "true" || src.usedAi === "TRUE",
  };
}

function recordToRow(record) {
  const rec = rowToRecord(record);
  return {
    id: rec.id,
    ts: rec.ts,
    user: rec.user,
    conversation: rec.conversation,
    original: rec.original,
    refined: rec.refined,
    usedAi: rec.usedAi ? "true" : "false",
  };
}

function sortRecords(rows) {
  return [...rows].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
}

async function listTeamsChat({ user = null, limit = 80 } = {}) {
  const { TeamsChat } = await workbookStore.readTables(["TeamsChat"], defaultProjectRoot());
  let records = (TeamsChat || []).map(rowToRecord).filter((r) => r.id);
  const needle = user != null ? String(user).trim().toLowerCase() : "";
  if (needle) records = records.filter((r) => String(r.user).toLowerCase() === needle);
  const cap = Number(limit);
  const sorted = sortRecords(records);
  return Number.isFinite(cap) && cap > 0 ? sorted.slice(0, cap) : sorted;
}

async function addTeamsChat(entry = {}) {
  const original = String(entry.original || "").trim();
  const refined = String(entry.refined || "").trim();
  if (!original || !refined) return { ok: false, error: "Missing original or refined text" };
  const record = {
    id: newId(),
    ts: new Date().toISOString(),
    user: String(entry.user || "").trim(),
    conversation: String(entry.conversation || "").trim() || "Teams",
    original,
    refined,
    usedAi: Boolean(entry.usedAi),
  };
  await workbookStore.appendRows("TeamsChat", [recordToRow(record)], defaultProjectRoot());
  return { ok: true, record };
}

module.exports = {
  rowToRecord,
  recordToRow,
  sortRecords,
  listTeamsChat,
  addTeamsChat,
};
