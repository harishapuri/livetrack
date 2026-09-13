function isMeetingWindowName(name) {
  const s = String(name || "").trim();
  if (!s || /livetrack/i.test(s)) return false;
  if (/teams\.microsoft|microsoft teams|\| microsoft teams|teams meeting/i.test(s)) return true;
  if (/zoom meeting|zoom workplace|zoom\.us/i.test(s)) return true;
  if (/google meet|\bmeet –|\bmeet -|meet\.google|webex/i.test(s)) return true;
  if (/\(guest\)/i.test(s)) return true;
  return false;
}

function pickMeetingSource(sources) {
  const list = Array.isArray(sources) ? sources : [];
  return list.find((row) => isMeetingWindowName(row?.name)) || null;
}

function firstName(raw) {
  return String(raw || "")
    .trim()
    .split(/[\s,/|]+/)
    .filter(Boolean)[0] || "";
}

function isPlaceholderName(raw) {
  const s = String(raw ?? "").trim();
  return !s || /^(null|undefined|none|unknown|n\/a|nan|speaker|you)$/i.test(s);
}

function cleanName(raw) {
  if (raw == null || typeof raw === "boolean") return "";
  let name = String(raw).trim();
  if (isPlaceholderName(name)) return "";
  if (!/\(guest\)/i.test(name)) {
    name = name.replace(/\s+\(.*?\)\s*$/, "");
  }
  name = name.replace(/\s+\|\s*microsoft teams.*$/i, "").trim();
  if (!name || isPlaceholderName(name)) return "";
  if (/^(chat|leave|share|mute|camera|participants|live transcript|outlook meetings)$/i.test(name)) {
    return "";
  }
  return name.slice(0, 60);
}

function parseTeamsFrameJson(text) {
  let raw = String(text || "").trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        data = JSON.parse(match[0]);
      } catch {
        data = null;
      }
    }
  }
  if (!data || typeof data !== "object") {
    return { ok: false, participants: [], speaking: "" };
  }
  const participants = [...new Set((Array.isArray(data.participants) ? data.participants : []).map(cleanName).filter(Boolean))];
  const speaking = cleanName(data.speaking || data.speaker || data.active || "");
  return {
    ok: true,
    participants,
    speaking,
    speakingFirst: firstName(speaking),
  };
}

function cropRectForMeeting(imageSize, displayBounds, liveBounds, scale = 1) {
  const width = Number(imageSize?.width) || 0;
  const height = Number(imageSize?.height) || 0;
  if (!width || !height) return { x: 0, y: 0, width, height };
  const factor = Number(scale) || 1;
  const live = {
    x: ((Number(liveBounds?.x) || 0) - (Number(displayBounds?.x) || 0)) * factor,
    y: ((Number(liveBounds?.y) || 0) - (Number(displayBounds?.y) || 0)) * factor,
    width: (Number(liveBounds?.width) || 0) * factor,
    height: (Number(liveBounds?.height) || 0) * factor,
  };
  if (live.width > 40 && live.x > width * 0.4) {
    return { x: 0, y: 0, width: Math.max(80, Math.floor(live.x)), height };
  }
  if (live.width > 40 && live.x + live.width < width * 0.6) {
    const x = Math.max(0, Math.floor(live.x + live.width));
    return { x, y: 0, width: Math.max(80, width - x), height };
  }
  return { x: 0, y: 0, width, height };
}

module.exports = {
  isMeetingWindowName,
  pickMeetingSource,
  parseTeamsFrameJson,
  cleanName,
  firstName,
  isPlaceholderName,
  cropRectForMeeting,
};
