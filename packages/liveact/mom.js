const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveExecutionsRoot } = require("./settings");

function momDir() {
  return path.join(resolveExecutionsRoot(), "mom");
}

function marksPath() {
  return path.join(momDir(), "marks.json");
}

function ensureMomDir() {
  fs.mkdirSync(momDir(), { recursive: true });
}

function loadMarks() {
  try {
    const raw = JSON.parse(fs.readFileSync(marksPath(), "utf8"));
    const ids = Array.isArray(raw?.eventIds) ? raw.eventIds : [];
    return {
      eventIds: [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))],
    };
  } catch {
    return { eventIds: [] };
  }
}

function saveMarks(eventIds) {
  ensureMomDir();
  const ids = [...new Set((eventIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  fs.writeFileSync(marksPath(), JSON.stringify({ eventIds: ids, updatedAt: new Date().toISOString() }, null, 2));
  return { eventIds: ids };
}

function setMarked(eventId, marked) {
  const id = String(eventId || "").trim();
  if (!id) return loadMarks();
  const current = new Set(loadMarks().eventIds);
  if (marked) current.add(id);
  else current.delete(id);
  return saveMarks([...current]);
}

function isMarked(eventId, marks = loadMarks()) {
  return marks.eventIds.includes(String(eventId || "").trim());
}

function eventPhase(event, nowMs = Date.now()) {
  const start = Number(event?.startMs) || 0;
  const end = Number(event?.endMs) || 0;
  if (!start || !end) return "unknown";
  if (nowMs < start) return "upcoming";
  if (nowMs >= end) return "ended";
  return "in_progress";
}

function canStartRecording(event, nowMs = Date.now()) {
  if (!event) return true;
  return eventPhase(event, nowMs) === "in_progress";
}

function greetingName({ givenName, greetingSetting, osUser } = {}) {
  const fromSetting = String(greetingSetting || "").trim();
  if (fromSetting) return fromSetting.slice(0, 40);
  const fromGraph = String(givenName || "").trim();
  if (fromGraph) return fromGraph.slice(0, 40);
  const raw = String(osUser || os.userInfo()?.username || process.env.USER || "there")
    .replace(/[0-9]+/g, " ")
    .split(/[.\s_-]+/)
    .filter(Boolean)[0] || "there";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

const PRE_ALERT_MS = 15 * 60 * 1000;

function meetingTitle(subject) {
  const title = String(subject || "").trim();
  if (!title || title === "(No subject)") return "";
  return title;
}

function greetingText(name, subject, { kind = "start" } = {}) {
  const who = String(name || "there").trim() || "there";
  const title = meetingTitle(subject);
  if (kind === "soon") {
    if (title) return `Hi ${who}, you have meeting ${title} in 15 minutes. Please join.`;
    return `Hi ${who}, you have a meeting in 15 minutes. Please join.`;
  }
  if (title) return `Hi ${who}, you have meeting ${title}. Please join.`;
  return `Hi ${who}, you have a meeting. Please join.`;
}

function actionOverdueGreetingText(name, title) {
  const who = String(name || "there").trim() || "there";
  const item = String(title || "").trim();
  if (item) return `Hi ${who}, you have action item ${item} due. Please complete it.`;
  return `Hi ${who}, you have an action item due. Please complete it.`;
}

function isAlertableMeeting(event) {
  if (!event?.id) return false;
  if (event.isCancelled) return false;
  if (event.isAllDay) return false;
  return Boolean(Number(event.startMs) && Number(event.endMs));
}

function shouldAlertSoon(event, { alreadyAlerted, nowMs = Date.now(), windowMs = PRE_ALERT_MS } = {}) {
  if (!isAlertableMeeting(event) || alreadyAlerted) return false;
  const start = Number(event.startMs);
  if (nowMs >= start) return false;
  return nowMs >= start - Number(windowMs || PRE_ALERT_MS);
}

function shouldAlertStart(event, { alreadyAlerted, nowMs = Date.now() } = {}) {
  if (!isAlertableMeeting(event) || alreadyAlerted) return false;
  return eventPhase(event, nowMs) === "in_progress";
}

function shouldAutoRefine(session, event, nowMs = Date.now()) {
  if (!session?.recording || session.refined) return false;
  if (!event?.endMs) return false;
  return nowMs >= Number(event.endMs);
}

function cancelSession(session) {
  if (!session) return null;
  session.recording = false;
  session.refining = false;
  session.transcript = "";
  session.turns = [];
  return session;
}

function fileSafe(value) {
  return String(value || "meeting")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "meeting";
}

function saveMomArtifact({ meeting, transcript, refined, source, turns, user }) {
  ensureMomDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = fileSafe(meeting?.subject || meeting?.id || "adhoc");
  const filePath = path.join(momDir(), `${stamp}_${name}.json`);
  const who = String(user || "").trim();
  const payload = {
    savedAt: new Date().toISOString(),
    source: source || "manual",
    user: who || null,
    meeting: meeting || null,
    transcript: String(transcript || ""),
    turns: Array.isArray(turns) ? turns : [],
    refined: String(refined || ""),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return { ok: true, path: filePath, id: path.basename(filePath) };
}

function isMomArtifactName(name) {
  const n = String(name || "");
  if (!n.endsWith(".json")) return false;
  if (n === "marks.json" || n.startsWith("outputs-")) return false;
  return true;
}

function summarizeMomArtifact(raw, fileName) {
  const refined = String(raw?.refined || "").trim();
  if (!refined) return null;
  const subject =
    String(raw?.meeting?.subject || "").trim() ||
    String(fileName || "")
      .replace(/\.json$/i, "")
      .replace(/^\d{4}-\d{2}-\d{2}T[^_]*_/, "")
      .replace(/-/g, " ") ||
    "Meeting minutes";
  const preview = refined.length > 160 ? `${refined.slice(0, 157)}…` : refined;
  return {
    id: String(fileName || ""),
    savedAt: String(raw?.savedAt || ""),
    user: String(raw?.user || "").trim() || null,
    source: String(raw?.source || "manual"),
    subject,
    eventId: String(raw?.meeting?.id || "").trim() || null,
    preview,
    refined,
  };
}

/**
 * List saved MOM artifacts for one user (newest first).
 * Legacy files without `user` stay visible on this machine.
 */
function listMomArtifacts({ user, limit = 40 } = {}) {
  ensureMomDir();
  const want = String(user || "").trim().toLowerCase();
  const cap = Math.max(1, Math.min(200, Number(limit) || 40));
  const rows = [];
  for (const name of fs.readdirSync(momDir())) {
    if (!isMomArtifactName(name)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(momDir(), name), "utf8"));
      const item = summarizeMomArtifact(raw, name);
      if (!item) continue;
      const owner = String(item.user || "").trim().toLowerCase();
      if (want && owner && owner !== want) continue;
      rows.push(item);
    } catch {
      /* skip bad files */
    }
  }
  rows.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  return rows.slice(0, cap);
}

function loadMomArtifact(id) {
  const name = path.basename(String(id || "").trim());
  if (!isMomArtifactName(name)) return null;
  const filePath = path.join(momDir(), name);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return summarizeMomArtifact(raw, name);
  } catch {
    return null;
  }
}

function localDayKey(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isTodayOutput(entry, now = new Date()) {
  if (!entry?.savedAt) return false;
  const saved = new Date(entry.savedAt);
  if (Number.isNaN(saved.getTime())) return false;
  return localDayKey(saved) === localDayKey(now);
}

function outputsPath(now = new Date()) {
  return path.join(momDir(), `outputs-${localDayKey(now)}.json`);
}

function pruneExpiredOutputs(now = new Date()) {
  ensureMomDir();
  const keep = path.basename(outputsPath(now));
  for (const name of fs.readdirSync(momDir())) {
    if (!name.startsWith("outputs-") || !name.endsWith(".json") || name === keep) continue;
    try {
      fs.unlinkSync(path.join(momDir(), name));
    } catch {
      /* ignore */
    }
  }
}

function loadDayOutputs(now = new Date()) {
  pruneExpiredOutputs(now);
  try {
    const raw = JSON.parse(fs.readFileSync(outputsPath(now), "utf8"));
    const items = Array.isArray(raw?.items) ? raw.items : [];
    return items.filter((item) => isTodayOutput(item, now) && String(item?.refined || "").trim());
  } catch {
    return [];
  }
}

function upsertDayOutput(entry, now = new Date()) {
  const refined = String(entry?.refined || "").trim();
  if (!refined) return null;
  const items = loadDayOutputs(now);
  const eventId = String(entry.eventId || entry.meeting?.id || "adhoc").trim() || "adhoc";
  const next = {
    eventId,
    subject: String(entry.subject || entry.meeting?.subject || "Ad-hoc meeting").trim() || "Ad-hoc meeting",
    refined,
    transcript: String(entry.transcript || ""),
    savedAt: new Date(now).toISOString(),
    meeting: entry.meeting || null,
    user: String(entry.user || "").trim() || null,
  };
  const idx = items.findIndex((row) => row.eventId === eventId);
  if (idx >= 0) items[idx] = next;
  else items.push(next);
  ensureMomDir();
  fs.writeFileSync(
    outputsPath(now),
    JSON.stringify({ day: localDayKey(now), items }, null, 2),
    "utf8",
  );
  return next;
}

function mergeEventsWithOutputs(events, outputs, { marks, session, nowMs = Date.now() } = {}) {
  const byId = new Map((outputs || []).map((row) => [String(row.eventId), row]));
  const annotated = annotateEvents(events, { marks, session, nowMs }).map((event) => {
    const saved = byId.get(String(event.id));
    return {
      ...event,
      hasMinutes: Boolean(saved?.refined),
      refinedText: saved?.refined || "",
    };
  });
  const seen = new Set(annotated.map((event) => String(event.id)));
  for (const saved of outputs || []) {
    if (seen.has(String(saved.eventId))) continue;
    annotated.push({
      id: saved.eventId,
      subject: saved.subject || "Ad-hoc meeting",
      start: saved.savedAt || "",
      end: "",
      startMs: Date.parse(saved.savedAt || "") || 0,
      endMs: 0,
      organizer: "",
      location: "",
      marked: false,
      phase: "saved",
      recording: false,
      canStart: false,
      hasMinutes: true,
      refinedText: saved.refined || "",
    });
  }
  return annotated;
}

function annotateEvents(events, { marks, session, nowMs = Date.now() } = {}) {
  const markedIds = new Set(marks?.eventIds || []);
  return (events || []).map((event) => {
    const phase = eventPhase(event, nowMs);
    const recording = Boolean(session?.recording && session.eventId === event.id);
    return {
      ...event,
      marked: markedIds.has(event.id),
      phase,
      recording,
      canStart: phase === "in_progress",
    };
  });
}

module.exports = {
  momDir,
  loadMarks,
  saveMarks,
  setMarked,
  isMarked,
  eventPhase,
  canStartRecording,
  greetingName,
  greetingText,
  actionOverdueGreetingText,
  PRE_ALERT_MS,
  shouldAlertSoon,
  shouldAlertStart,
  shouldAutoRefine,
  cancelSession,
  saveMomArtifact,
  listMomArtifacts,
  loadMomArtifact,
  localDayKey,
  isTodayOutput,
  loadDayOutputs,
  upsertDayOutput,
  mergeEventsWithOutputs,
  annotateEvents,
};
