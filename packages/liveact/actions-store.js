/**
 * Action Items — permanent personal to-dos (from MoM + manual).
 * Stored in livetrack.xlsx Actions sheet until the user marks Done.
 */
const crypto = require("crypto");
const { defaultProjectRoot } = require("./documents");
const workbookStore = require("./workbook");

const STATUSES = new Set(["pending", "done"]);
const DUE_KINDS = new Set(["today", "week", "none"]);

function normalizeStatus(value) {
  const key = String(value || "pending").trim().toLowerCase();
  return STATUSES.has(key) ? key : "pending";
}

function normalizeDueKind(value) {
  const key = String(value || "week").trim().toLowerCase();
  return DUE_KINDS.has(key) ? key : "week";
}

function newId() {
  if (typeof crypto.randomUUID === "function") return `act_${crypto.randomUUID()}`;
  return `act_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function endOfLocalDay(base = new Date()) {
  const d = new Date(base);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function endOfLocalWeek(base = new Date()) {
  const d = new Date(base);
  const day = d.getDay(); // 0 Sun
  const daysUntilFri = day <= 5 ? 5 - day : 6; // Fri end-of-week default
  d.setDate(d.getDate() + daysUntilFri);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function dueAtForKind(kind, base = new Date()) {
  const k = normalizeDueKind(kind);
  if (k === "today") return endOfLocalDay(base);
  if (k === "week") return endOfLocalWeek(base);
  return "";
}

function rowToAction(row) {
  const meta = workbookStore.parseJsonCell(row.payload_json);
  return {
    id: row.id || "",
    ts: row.ts || "",
    user: row.user || "",
    title: row.title || "",
    owner: row.owner || "",
    status: normalizeStatus(row.status),
    dueKind: normalizeDueKind(row.dueKind),
    dueAt: row.dueAt || "",
    source: row.source || "manual",
    meetingId: row.meetingId || "",
    meetingSubject: row.meetingSubject || "",
    doneAt: row.doneAt || "",
    meta: meta && typeof meta === "object" ? meta : {},
  };
}

function actionToRow(action) {
  const { meta, ...rest } = action;
  return {
    id: rest.id || "",
    ts: rest.ts || "",
    user: rest.user || "",
    title: rest.title || "",
    owner: rest.owner || "",
    status: normalizeStatus(rest.status),
    dueKind: normalizeDueKind(rest.dueKind),
    dueAt: rest.dueAt || "",
    source: rest.source || "manual",
    meetingId: rest.meetingId || "",
    meetingSubject: rest.meetingSubject || "",
    doneAt: rest.doneAt || "",
    payload_json: workbookStore.jsonCell(meta && typeof meta === "object" ? meta : {}),
  };
}

function sortActions(actions) {
  return [...actions].sort((a, b) => {
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const dueA = a.dueAt || "9999";
    const dueB = b.dueAt || "9999";
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    return String(b.ts).localeCompare(String(a.ts));
  });
}

async function readActionRows() {
  const { Actions } = await workbookStore.readTables(["Actions"], defaultProjectRoot());
  return (Actions || []).map(rowToAction).filter((a) => a.id && a.title);
}

/**
 * Parse MoM refined text Action items section.
 * Lines like: "Harish — Send CR" or "- Owner - task" or "None stated"
 */
function parseMomActionItems(refinedText) {
  const raw = String(refinedText || "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return [];
  const lines = raw.split("\n");
  let inSection = false;
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^action\s*items?\s*:?\s*$/i.test(trimmed)) {
      inSection = true;
      continue;
    }
    if (inSection && /^(meeting|discussed|decisions|open\s*questions)\s*:?\s*$/i.test(trimmed)) {
      break;
    }
    if (!inSection || !trimmed) continue;
    if (/^none(\s+stated)?\.?$/i.test(trimmed)) continue;
    const cleaned = trimmed.replace(/^[-*•]\s+/, "");
    const m = cleaned.match(/^(.+?)\s*[—–\-:]\s+(.+)$/);
    if (m) {
      const owner = m[1].trim();
      const title = m[2].trim();
      // Reject time-like "12:30 …" as owner
      if (title && owner && !/^\d{1,2}$/.test(owner)) {
        out.push({ owner, title });
        continue;
      }
    }
    // Bare task line without owner
    if (cleaned.length >= 3) out.push({ owner: "", title: cleaned });
  }
  return out;
}

function fingerprint(title, owner, meetingId) {
  return [
    String(meetingId || "").trim().toLowerCase(),
    String(owner || "").trim().toLowerCase(),
    String(title || "").trim().toLowerCase(),
  ].join("|");
}

async function listActions({ user = null, includeDone = true } = {}) {
  let actions = await readActionRows();
  const needle = user != null ? String(user).trim().toLowerCase() : "";
  if (needle) actions = actions.filter((a) => String(a.user).toLowerCase() === needle);
  if (!includeDone) actions = actions.filter((a) => a.status !== "done");
  return sortActions(actions);
}

async function pendingCount({ user = null } = {}) {
  const list = await listActions({ user, includeDone: false });
  return list.length;
}

async function overduePending({ user = null, now = new Date() } = {}) {
  const iso = now.toISOString();
  const list = await listActions({ user, includeDone: false });
  return list.filter((a) => a.dueAt && a.dueAt < iso);
}

async function addAction(entry = {}) {
  const title = String(entry.title || "").trim();
  if (!title) return { ok: false, error: "Title is required" };
  const dueKind = normalizeDueKind(entry.dueKind || "week");
  const action = {
    id: newId(),
    ts: new Date().toISOString(),
    user: String(entry.user || "").trim(),
    title,
    owner: String(entry.owner || "").trim(),
    status: "pending",
    dueKind,
    dueAt: entry.dueAt || dueAtForKind(dueKind),
    source: String(entry.source || "manual").trim() || "manual",
    meetingId: String(entry.meetingId || "").trim(),
    meetingSubject: String(entry.meetingSubject || "").trim(),
    doneAt: "",
    meta: entry.meta && typeof entry.meta === "object" ? entry.meta : {},
  };
  await workbookStore.appendRows("Actions", [actionToRow(action)], defaultProjectRoot());
  return { ok: true, action };
}

async function markDone(id, { user = null } = {}) {
  const actionId = String(id || "").trim();
  if (!actionId) return { ok: false, error: "Missing id" };
  const { Actions } = await workbookStore.readTables(["Actions"], defaultProjectRoot());
  const rows = Actions || [];
  const idx = rows.findIndex((r) => String(r.id) === actionId);
  if (idx < 0) return { ok: false, error: "Action not found" };
  if (user != null) {
    const u = String(user).trim().toLowerCase();
    if (u && String(rows[idx].user || "").toLowerCase() !== u) {
      return { ok: false, error: "Action not found" };
    }
  }
  const next = {
    ...rows[idx],
    status: "done",
    doneAt: new Date().toISOString(),
  };
  rows[idx] = next;
  await workbookStore.replaceRows("Actions", rows, defaultProjectRoot());
  return { ok: true, action: rowToAction(next) };
}

async function reopenAction(id, { user = null } = {}) {
  const actionId = String(id || "").trim();
  if (!actionId) return { ok: false, error: "Missing id" };
  const { Actions } = await workbookStore.readTables(["Actions"], defaultProjectRoot());
  const rows = Actions || [];
  const idx = rows.findIndex((r) => String(r.id) === actionId);
  if (idx < 0) return { ok: false, error: "Action not found" };
  if (user != null) {
    const u = String(user).trim().toLowerCase();
    if (u && String(rows[idx].user || "").toLowerCase() !== u) {
      return { ok: false, error: "Action not found" };
    }
  }
  const next = { ...rows[idx], status: "pending", doneAt: "" };
  rows[idx] = next;
  await workbookStore.replaceRows("Actions", rows, defaultProjectRoot());
  return { ok: true, action: rowToAction(next) };
}

/**
 * Import MoM refined action lines into permanent Actions memory.
 * Dedupes by meetingId + owner + title for pending items.
 */
async function importFromMomRefined({
  refinedText,
  meeting = null,
  user = "",
  dueKind = "week",
} = {}) {
  const items = parseMomActionItems(refinedText);
  if (!items.length) {
    return { ok: true, imported: 0, skipped: 0, actions: [] };
  }
  const meetingId = String(meeting?.id || meeting?.eventId || "").trim();
  const meetingSubject = String(meeting?.subject || "").trim();
  const existing = await readActionRows();
  const pendingFp = new Set(
    existing
      .filter((a) => a.status === "pending")
      .map((a) => fingerprint(a.title, a.owner, a.meetingId)),
  );
  const created = [];
  let skipped = 0;
  for (const item of items) {
    const fp = fingerprint(item.title, item.owner, meetingId);
    if (pendingFp.has(fp)) {
      skipped += 1;
      continue;
    }
    const res = await addAction({
      title: item.title,
      owner: item.owner,
      user,
      dueKind,
      source: "mom",
      meetingId,
      meetingSubject,
      meta: { fromMom: true },
    });
    if (res.ok) {
      created.push(res.action);
      pendingFp.add(fp);
    }
  }
  return { ok: true, imported: created.length, skipped, actions: created };
}

module.exports = {
  parseMomActionItems,
  importFromMomRefined,
  addAction,
  listActions,
  markDone,
  reopenAction,
  pendingCount,
  overduePending,
  dueAtForKind,
  normalizeDueKind,
  normalizeStatus,
  sortActions,
};
