function isTeamsHelperName(name) {
  const s = String(name || "").trim();
  return /helper|renderer|gpu-process|notificationcenter|respawn|crashpad|webview helper/i.test(
    s,
  );
}

/** Process / CGWindow owner for desktop Teams, including new Teams (MSTeams). */
function isTeamsOwnerName(name) {
  const s = String(name || "").trim();
  if (!s || isTeamsHelperName(s)) return false;
  if (/^msteams$/i.test(s)) return true;
  if (/^microsoft teams webview$/i.test(s)) return true;
  if (/microsoft teams/i.test(s)) return true;
  if (/^teams$/i.test(s)) return true;
  return false;
}

function isTeamsBundleId(id) {
  const s = String(id || "").trim().toLowerCase();
  if (!s) return false;
  if (s === "com.microsoft.teams" || s === "com.microsoft.teams2") return true;
  if (s.startsWith("com.microsoft.teams2.") && /helper|notification|agent/.test(s)) {
    return false;
  }
  return s.startsWith("com.microsoft.teams");
}

function pickBestTeamsWindow(windows) {
  const list = Array.isArray(windows) ? windows : [];
  let best = null;
  for (const win of list) {
    const width = Number(win?.width) || 0;
    const height = Number(win?.height) || 0;
    if (width < 240 || height < 200) continue;
    const owner = String(win?.owner || win?.process || "");
    const title = String(win?.title || win?.name || "");
    if (!isTeamsOwnerName(owner) && !isTeamsAppWindowName(title)) continue;
    const area = width * height;
    if (!best || area > best.width * best.height) {
      best = { ...win, width, height, owner, title };
    }
  }
  return best;
}

function isTeamsAppWindowName(name) {
  const s = String(name || "").trim();
  if (!s || /livetrack/i.test(s)) return false;
  if (/teams\.microsoft\.com|teams\.live\.com/i.test(s)) return true;
  if (/microsoft teams|\| microsoft teams|teams meeting/i.test(s)) return true;
  if (/^teams$/i.test(s) || /\bmsteams\b/i.test(s)) return true;
  return false;
}

function conversationTitleFromWindowName(name) {
  let s = String(name || "").trim();
  if (!s) return "Teams";
  s = s.replace(/\s+\|\s*microsoft teams.*$/i, "");
  s = s.replace(/\s+[-—–]\s*microsoft teams.*$/i, "");
  s = s.replace(/^microsoft teams(?:\s*\(work or school\))?\s*[-—|:]*\s*/i, "");
  s = s.replace(/\s+microsoft teams(?:\s*\(work or school\))?$/i, "");
  s = s.trim();
  return s || "Teams";
}

function looksLikeComposeFrame(teams, compose) {
  const tw = Number(teams?.width) || 0;
  const th = Number(teams?.height) || 0;
  const tx = Number(teams?.x) || 0;
  const ty = Number(teams?.y) || 0;
  const x = Number(compose?.x);
  const y = Number(compose?.y);
  const w = Number(compose?.width);
  const h = Number(compose?.height);
  if (![x, y, w, h, tw, th].every(Number.isFinite)) return false;
  if (w < 160 || h < 18 || h > 280) return false;
  if (x < tx - 12 || x > tx + tw - 80) return false;
  const bottom = y + h;
  if (bottom < ty + th * 0.45 || bottom > ty + th + 24) return false;
  return true;
}

/** Inner Teams message box used to park the star above the typed line. */
function innerComposeSlot(teams, compose) {
  const tx = Number(teams?.x) || 0;
  const ty = Number(teams?.y) || 0;
  const tw = Number(teams?.width) || 0;
  const th = Number(teams?.height) || 0;
  if (looksLikeComposeFrame(teams, compose)) {
    return {
      x: Number(compose.x),
      y: Number(compose.y),
      width: Number(compose.width),
      height: Number(compose.height),
    };
  }
  const cx = Number(compose?.x);
  const cy = Number(compose?.y);
  const cw = Number(compose?.width);
  const ch = Number(compose?.height);
  const chatPane =
    Number.isFinite(cw) &&
    Number.isFinite(ch) &&
    cw >= 280 &&
    ch >= 200 &&
    cx >= tx - 12 &&
    cx + cw <= tx + tw + 32;
  if (chatPane) {
    return {
      x: cx + 36,
      y: cy + ch - 88,
      width: Math.max(220, cw - 72),
      height: 72,
    };
  }
  const chatLeft = Math.min(430, Math.max(160, tw * 0.36)) + 40;
  return {
    x: tx + chatLeft,
    y: ty + th - 96,
    width: Math.max(240, tw - chatLeft - 80),
    height: 72,
  };
}

/** Show over the Teams window — never a display-wide guess, never when Teams is in back. */
function canShowTeamsChatOverlay(teams) {
  if (!teams?.ok || !teams.width || !teams.height) return false;
  if (teams.frontmost === false) return false;
  if (String(teams.via || "") === "display") return false;
  return true;
}

/** Red star just above the compose box so it never covers the typed sentence. */
function overlayBoundsFor(teams, size = { width: 24, height: 24 }, compose = null) {
  const w = Number(size.width) || 24;
  const h = Number(size.height) || 24;
  const slot = innerComposeSlot(teams, compose);
  const tx = Number(teams?.x) || slot.x;
  const ty = Number(teams?.y) || slot.y;
  const tw = Number(teams?.width) || slot.width;
  const x = Math.round(slot.x + 8);
  const y = Math.round(slot.y - h - 6);
  const minX = tx + 8;
  const maxX = tx + Math.max(w, tw - w - 8);
  const minY = ty + 8;
  const maxY = Math.round(slot.y - 2);
  return {
    width: w,
    height: h,
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), Math.max(minY, maxY)),
  };
}

function isMeetingWindowName(name) {
  const s = String(name || "").trim();
  if (!s || /livetrack/i.test(s)) return false;
  if (isTeamsAppWindowName(s)) return true;
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
  isTeamsAppWindowName,
  isTeamsOwnerName,
  isTeamsHelperName,
  isTeamsBundleId,
  pickBestTeamsWindow,
  conversationTitleFromWindowName,
  overlayBoundsFor,
  innerComposeSlot,
  looksLikeComposeFrame,
  canShowTeamsChatOverlay,
  pickMeetingSource,
  parseTeamsFrameJson,
  cleanName,
  firstName,
  isPlaceholderName,
  cropRectForMeeting,
};
