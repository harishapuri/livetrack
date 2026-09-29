/**
 * Read/write the Microsoft Teams desktop compose box on macOS.
 * Prefer Accessibility AXValue; fall back to Cmd+A / Cmd+C / paste.
 * Never sends Return.
 */
const { execFile } = require("child_process");
const { clipboard, screen, systemPreferences } = require("electron");
const {
  conversationTitleFromWindowName,
  isTeamsAppWindowName,
  isTeamsOwnerName,
  isTeamsHelperName,
  isTeamsBundleId,
  pickBestTeamsWindow,
} = require("./mom-teams");

const TEAMS_PROCESS_NAMES = [
  "Microsoft Teams",
  "Microsoft Teams (work or school)",
  "Microsoft Teams WebView",
  "MSTeams",
  "Teams",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runOsa(source, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", source],
      { timeout, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve("");
        resolve(String(stdout || "").replace(/\r/g, "").trim());
      },
    );
  });
}

function runJxa(source, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", source],
      { timeout, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          return resolve(JSON.parse(String(stdout || "").trim() || "null"));
        } catch {
          return resolve(null);
        }
      },
    );
  });
}

function applescriptString(text) {
  return `"${String(text || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function ensureAccessibility() {
  if (process.platform !== "darwin") {
    return { ok: false, error: "Teams compose refine is only available on macOS." };
  }
  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!trusted) {
      return {
        ok: false,
        error: "Allow LiveTrack in System Settings → Privacy & Security → Accessibility, then try again.",
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not check Accessibility permission." };
  }
}

function normalizeCompose(data) {
  const composeWidth = Number(data?.composeWidth) || 0;
  const composeHeight = Number(data?.composeHeight) || 0;
  if (!composeWidth || !composeHeight) return null;
  return {
    x: Number(data.composeX) || 0,
    y: Number(data.composeY) || 0,
    width: composeWidth,
    height: composeHeight,
  };
}

function finishTeamsRecord(data, via) {
  const title = String(data?.title || data?.name || "");
  const processName = String(data?.process || data?.owner || "MSTeams");
  return {
    ok: true,
    via: via || data?.via || "ax",
    process: processName,
    title,
    conversation: conversationTitleFromWindowName(title),
    x: Number(data.x) || 0,
    y: Number(data.y) || 0,
    width: Number(data.width) || 0,
    height: Number(data.height) || 0,
    compose: data.compose || normalizeCompose(data),
    frontmost: Boolean(data.frontmost),
    isTeams: isTeamsAppWindowName(title) || isTeamsOwnerName(processName) || Boolean(processName),
  };
}

function displayBoundsForFrontmostTeams(processName) {
  try {
    const pt = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(pt) || screen.getPrimaryDisplay();
    const area = display.workArea || display.bounds;
    return finishTeamsRecord(
      {
        process: processName || "MSTeams",
        title: "",
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
        frontmost: true,
      },
      "display",
    );
  } catch {
    return { ok: false };
  }
}

const JXA_TEAMS_MATCHERS = `
${isTeamsHelperName.toString()}
${isTeamsOwnerName.toString()}
${isTeamsBundleId.toString()}
`.trim();

async function probeTeamsAx() {
  return runJxa(`
${JXA_TEAMS_MATCHERS}
(function () {
  var se = Application("System Events");
  var procs = se.processes();
  var windows = [];
  var processName = "";
  var frontmost = false;
  var focusedIsTeams = false;
  try {
    var fp = se.applicationProcesses.whose({ frontmost: true })();
    if (fp && fp.length) {
      var fn = String(fp[0].name() || "");
      var fb = "";
      try { fb = String(fp[0].bundleIdentifier()); } catch (be) {}
      focusedIsTeams = isTeamsOwnerName(fn) || isTeamsBundleId(fb);
      if (focusedIsTeams) processName = fn;
    }
  } catch (fe) {}
  for (var i = 0; i < procs.length; i++) {
    var proc = procs[i];
    var name = "";
    var bundle = "";
    try { name = String(proc.name() || ""); } catch (nerr) { continue; }
    try { bundle = String(proc.bundleIdentifier() || ""); } catch (berr) {}
    if (isTeamsHelperName(name)) continue;
    if (!(isTeamsOwnerName(name) || isTeamsBundleId(bundle))) continue;
    var vis = false;
    var fm = false;
    try { vis = proc.visible(); } catch (ve) {}
    try { fm = proc.frontmost(); } catch (ff) {}
    if (fm || (vis && !processName)) processName = name;
    if (fm) frontmost = true;
    try {
      var wins = proc.windows();
      for (var w = 0; w < wins.length; w++) {
        var win = wins[w];
        var pos = win.position();
        var size = win.size();
        if (!size || size[0] < 240 || size[1] < 200) continue;
        windows.push({
          owner: name,
          process: name,
          title: String(win.name() || ""),
          x: pos[0],
          y: pos[1],
          width: size[0],
          height: size[1],
          frontmost: fm
        });
      }
    } catch (we) {}
  }
  var compose = null;
  if (focusedIsTeams) {
    try {
      var el = se.focusedUIElement();
      if (el) {
        var epos = el.position();
        var esize = el.size();
        if (esize && esize[0] > 0 && esize[1] > 0) {
          compose = { x: epos[0], y: epos[1], width: esize[0], height: esize[1] };
        }
      }
    } catch (e2) {}
  }
  return JSON.stringify({
    ok: Boolean(processName),
    process: processName,
    frontmost: frontmost || focusedIsTeams,
    windows: windows,
    compose: compose
  });
})()
`);
}

async function probeTeamsCg() {
  return runJxa(`
ObjC.import("CoreGraphics");
ObjC.import("Foundation");
${JXA_TEAMS_MATCHERS}
(function () {
  var arr = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID));
  var n = Number(arr.count);
  var windows = [];
  var topOwner = "";
  for (var i = 0; i < n; i++) {
    var w = arr.objectAtIndex(i);
    var owner = String(ObjC.unwrap(w.objectForKey("kCGWindowOwnerName")) || "");
    var layer = Number(ObjC.unwrap(w.objectForKey("kCGWindowLayer")));
    if (layer !== 0) continue;
    var alpha = Number(ObjC.unwrap(w.objectForKey("kCGWindowAlpha")));
    if (!(alpha >= 0.1)) continue;
    var bounds = w.objectForKey("kCGWindowBounds");
    var width = Number(ObjC.unwrap(bounds.objectForKey("Width")));
    var height = Number(ObjC.unwrap(bounds.objectForKey("Height")));
    if (width < 240 || height < 200) continue;
    if (!topOwner) topOwner = owner;
    if (!isTeamsOwnerName(owner)) continue;
    windows.push({
      owner: owner,
      process: owner,
      title: String(ObjC.unwrap(w.objectForKey("kCGWindowName")) || ""),
      x: Number(ObjC.unwrap(bounds.objectForKey("X"))),
      y: Number(ObjC.unwrap(bounds.objectForKey("Y"))),
      width: width,
      height: height
    });
  }
  return JSON.stringify({
    ok: windows.length > 0,
    windows: windows,
    topOwner: topOwner,
    frontmost: isTeamsOwnerName(topOwner)
  });
})()
`);
}

function teamsIsFrontmost(axSnap, cgSnap) {
  return Boolean(axSnap?.frontmost || cgSnap?.frontmost);
}

function keystrokeProcessName(processName) {
  const name = String(processName || "").trim();
  if (/webview/i.test(name) || !name) return "MSTeams";
  return name;
}

async function findTeamsWindow() {
  if (process.platform !== "darwin") return { ok: false };
  const [axSnap, cgSnap] = await Promise.all([probeTeamsAx(), probeTeamsCg()]);
  const cgBest = pickBestTeamsWindow(cgSnap?.windows);
  const axBest = pickBestTeamsWindow(axSnap?.windows);
  const compose = axSnap?.compose || null;
  const frontmost = teamsIsFrontmost(axSnap, cgSnap);
  const processName = axSnap?.process || cgBest?.process || cgBest?.owner || axBest?.process || "";
  if (cgBest) {
    return finishTeamsRecord(
      {
        ...cgBest,
        process: processName || cgBest.process || cgBest.owner,
        compose,
        frontmost,
      },
      "cg",
    );
  }
  if (axBest) {
    return finishTeamsRecord(
      {
        ...axBest,
        process: processName || axBest.process || axBest.owner,
        compose,
        frontmost,
      },
      "ax",
    );
  }
  if (axSnap?.ok && frontmost && axSnap.process) {
    const rec = displayBoundsForFrontmostTeams(axSnap.process);
    if (rec.ok) rec.compose = compose;
    return rec;
  }
  return {
    ok: false,
    frontmost,
    process: processName,
  };
}

async function activateTeams(processName) {
  const proc = keystrokeProcessName(processName);
  await runOsa(`
tell application "System Events"
  try
    set frontmost of process ${applescriptString(proc)} to true
  end try
end tell
`);
  await sleep(180);
}

async function axFocusedValue() {
  const text = await runOsa(`
tell application "System Events"
  try
    set el to focused UI element
    try
      return value of el as text
    end try
  end try
end tell
return ""
`);
  return String(text || "").trim();
}

async function axSetFocusedValue(text) {
  const escaped = applescriptString(text);
  const out = await runOsa(`
tell application "System Events"
  try
    set el to focused UI element
    set value of el to ${escaped}
    return "ok"
  end try
end tell
return "fail"
`);
  return out === "ok";
}

async function keystrokeCommand(letter, processName) {
  const proc = keystrokeProcessName(processName);
  const ch = String(letter || "a").slice(0, 1).toLowerCase();
  await runOsa(`
tell application "System Events"
  tell process ${applescriptString(proc)}
    set frontmost to true
    keystroke "${ch}" using command down
  end tell
end tell
`);
}

async function readCompose({ processName } = {}) {
  await activateTeams(processName);
  const ax = await axFocusedValue();
  if (ax) return { ok: true, text: ax, via: "ax" };

  const previous = clipboard.readText();
  try {
    await keystrokeCommand("a", processName);
    await sleep(70);
    await keystrokeCommand("c", processName);
    await sleep(90);
    const copied = String(clipboard.readText() || "");
    return { ok: Boolean(copied.trim()), text: copied, via: "clipboard" };
  } finally {
    try {
      clipboard.writeText(previous);
    } catch {
      /* ignore */
    }
  }
}

async function writeCompose(text, { processName } = {}) {
  const next = String(text || "");
  await activateTeams(processName);
  const axOk = await axSetFocusedValue(next);
  if (axOk) {
    const check = await axFocusedValue();
    if (check === next || (next && check && check.includes(next.slice(0, 40)))) {
      return { ok: true, via: "ax" };
    }
  }
  const previous = clipboard.readText();
  try {
    clipboard.writeText(next);
    await keystrokeCommand("a", processName);
    await sleep(70);
    await keystrokeCommand("v", processName);
    await sleep(90);
    return { ok: true, via: "clipboard" };
  } finally {
    try {
      clipboard.writeText(previous);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  TEAMS_PROCESS_NAMES,
  ensureAccessibility,
  findTeamsWindow,
  readCompose,
  writeCompose,
  activateTeams,
};
