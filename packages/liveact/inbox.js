/**
 * Operator inbox — notes to SMEs / product owners in livetrack.xlsx (Inbox table).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { defaultProjectRoot, defaultExecutionsRoot } = require("./documents");
const workbookStore = require("./workbook");

const CATEGORIES = new Set(["process", "product", "bug", "other"]);
const STATUSES = new Set(["open", "ack", "done"]);
const STATUS_RANK = { open: 0, ack: 1, done: 2 };

function normalizeCategory(value) {
  const key = String(value || "other").trim().toLowerCase();
  return CATEGORIES.has(key) ? key : "other";
}

function normalizeStatus(value) {
  const key = String(value || "open").trim().toLowerCase();
  return STATUSES.has(key) ? key : "open";
}

function newId() {
  if (typeof crypto.randomUUID === "function") return `inb_${crypto.randomUUID()}`;
  return `inb_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function inboxDir() {
  return path.join(defaultExecutionsRoot(), "inbox");
}

function copyScreenshot(srcPath, id) {
  const src = String(srcPath || "").trim();
  if (!src || !fs.existsSync(src)) return null;
  const dir = inboxDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${id}${path.extname(src) || ".png"}`);
  fs.copyFileSync(src, dest);
  return path.relative(defaultProjectRoot(), dest);
}

function rowToNote(row) {
  const meta = workbookStore.parseJsonCell(row.payload_json);
  return {
    id: row.id || "",
    ts: row.ts || "",
    user: row.user || "",
    category: normalizeCategory(row.category),
    title: row.title || "",
    body: row.body || "",
    lob: row.lob || "",
    cardId: row.cardId || "",
    status: normalizeStatus(row.status),
    sme: row.sme || "",
    smeNote: row.smeNote || "",
    meta: meta && typeof meta === "object" ? meta : {},
  };
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (rank) return rank;
    return String(b.ts).localeCompare(String(a.ts));
  });
}

async function readInboxRows() {
  const { Inbox } = await workbookStore.readTables(["Inbox"], defaultProjectRoot());
  return (Inbox || []).map(rowToNote).filter((n) => n.id);
}

async function submitNote(entry) {
  const title = String(entry?.title || "").trim();
  if (!title) return { ok: false, error: "Title is required" };
  const id = newId();
  const screenshot = copyScreenshot(entry?.screenshotPath, id);
  const meta = {
    ...(entry?.meta && typeof entry.meta === "object" ? entry.meta : {}),
    ...(screenshot ? { screenshot: screenshot } : {}),
  };
  const note = {
    id,
    ts: new Date().toISOString(),
    user: String(entry?.user || "").trim(),
    category: normalizeCategory(entry?.category),
    title,
    body: String(entry?.body || "").trim(),
    lob: String(entry?.lob || "").trim(),
    cardId: String(entry?.cardId || "").trim(),
    status: "open",
    sme: "",
    smeNote: "",
    payload_json: workbookStore.jsonCell(meta),
  };
  await workbookStore.appendRows("Inbox", [note], defaultProjectRoot());
  return { ok: true, note: rowToNote(note) };
}

async function listNotes({ user = null } = {}) {
  const notes = await readInboxRows();
  const needle = user != null ? String(user).trim().toLowerCase() : "";
  const filtered = needle ? notes.filter((n) => String(n.user).toLowerCase() === needle) : notes;
  return sortNotes(filtered);
}

async function updateNote(id, patch = {}) {
  const noteId = String(id || "").trim();
  if (!noteId) return { ok: false, error: "Missing id" };
  const { Inbox } = await workbookStore.readTables(["Inbox"], defaultProjectRoot());
  const rows = Inbox || [];
  const idx = rows.findIndex((r) => String(r.id) === noteId);
  if (idx < 0) return { ok: false, error: "Note not found" };
  const current = rows[idx];
  const next = {
    ...current,
    status: patch.status != null ? normalizeStatus(patch.status) : current.status,
    sme: patch.sme != null ? String(patch.sme).trim() : current.sme,
    smeNote: patch.smeNote != null ? String(patch.smeNote).trim() : current.smeNote,
  };
  rows[idx] = next;
  await workbookStore.replaceRows("Inbox", rows, defaultProjectRoot());
  return { ok: true, note: rowToNote(next) };
}

module.exports = {
  CATEGORIES: [...CATEGORIES],
  submitNote,
  listNotes,
  updateNote,
  sortNotes,
  normalizeCategory,
  normalizeStatus,
};
