/**
 * Read/write Google Chrome tabs on macOS without the extension and without
 * launching extra Chrome profiles.
 */
const { execFile } = require("child_process");

function runOsa(source, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", source],
      { timeout, maxBuffer: 512 * 1024 },
      (err, stdout) => {
        if (err) return resolve("");
        resolve(String(stdout || "").replace(/\r/g, "").trim());
      },
    );
  });
}

const BROWSER_APPS = ["Google Chrome", "Microsoft Edge", "Chromium"];

let preferredUrl = "";

function setPreferredUrl(url) {
  preferredUrl = String(url || "").trim();
}

function urlMatchesPreferred(url) {
  const pref = preferredUrl.toLowerCase();
  const u = String(url || "").toLowerCase();
  if (!pref || !u) return false;
  if (u === pref) return true;
  const file = pref.split("/").pop()?.split("?")[0] || "";
  return Boolean(file && u.includes(file));
}

function isInjectableUrl(url) {
  const u = String(url || "").trim();
  if (!u) return false;
  if (/^(chrome|edge|about|devtools|chrome-extension|brave):/i.test(u)) return false;
  return /^(https?:|file:)/i.test(u);
}

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/\s+[—–-]\s+Google Chrome.*$/i, "")
    .replace(/\s+Google Chrome.*$/i, "")
    .trim();
}

function jsLiteral(code) {
  return JSON.stringify(String(code));
}

async function chromeWindowTitles() {
  if (process.platform !== "darwin") return [];
  const raw = await runOsa(`
tell application "System Events"
  set out to ""
  set names to {"Google Chrome", "Microsoft Edge", "Chromium"}
  repeat with n in names
    try
      repeat with proc in (every process whose name is n)
        try
          tell proc
            repeat with w in windows
              set out to out & (name of w) & linefeed
            end repeat
          end tell
        end try
      end repeat
    end try
  end repeat
  return out
end tell
`);
  return raw
    .split("\n")
    .map((t) => cleanTitle(t))
    .filter(Boolean);
}

async function listTabs() {
  if (process.platform !== "darwin") return [];
  const tabs = [];
  for (const appName of BROWSER_APPS) {
    const raw = await runOsa(`
tell application ${JSON.stringify(appName)}
  set out to ""
  if (count of windows) is 0 then return out
  repeat with w in windows
    try
      set t to active tab of w
      set out to out & (URL of t) & character id 9 & (title of t) & linefeed
    end try
  end repeat
  return out
end tell
`);
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const tab = line.indexOf("\t");
      const url = tab === -1 ? line.trim() : line.slice(0, tab).trim();
      const title = cleanTitle(tab === -1 ? "" : line.slice(tab + 1));
      tabs.push({ url, title, app: appName });
    }
  }
  return tabs;
}

async function frontTab(hints = []) {
  if (process.platform !== "darwin") return null;
  const [tabs, titles] = await Promise.all([listTabs(), chromeWindowTitles()]);
  const hintList = (hints || [])
    .map((h) => String(h || "").toLowerCase())
    .filter((h) => h.length > 4);

  const score = (url, title) => {
    const blob = `${url} ${title}`.toLowerCase();
    let n = 0;
    for (const h of hintList) {
      if (blob.includes(h)) n += 10 + Math.min(h.length, 20);
    }
    return n;
  };

  let best = null;
  let bestN = 0;
  for (const t of tabs) {
    let n = score(t.url, t.title);
    if (urlMatchesPreferred(t.url)) n += 500;
    if (n > bestN) {
      bestN = n;
      best = t;
    }
  }
  if (best) return { url: isInjectableUrl(best.url) ? best.url : "", title: best.title };

  for (const title of titles) {
    if (score("", title) > 0) return { url: "", title };
  }

  const first = tabs[0];
  if (first) {
    return {
      url: isInjectableUrl(first.url) ? first.url : "",
      title: first.title || titles[0] || "",
    };
  }
  if (titles[0]) return { url: "", title: titles[0] };
  return null;
}

/**
 * Run JS in Chrome/Edge tabs. Prefer the URL the user is working on, then each
 * window's active tab, then remaining tabs.
 */
async function evalInAnyTab(javascript, { matchPreferred = true } = {}) {
  if (process.platform !== "darwin") return "";
  const needle = matchPreferred
    ? preferredUrl
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
    : "";
  const wrapped = `(function(){try{
    var needle=${JSON.stringify(needle)};
    var href=String(location.href||"").toLowerCase().replace(/^https?:\\/\\//,"").replace(/\\/$/,"");
    if(needle && needle.length>3 && href.indexOf(needle)===-1) return "";
    var r=(${javascript});
    return r==null?"":String(r);
  }catch(e){return "";}})()`;
  const lit = jsLiteral(wrapped);

  for (const appName of BROWSER_APPS) {
    const src = `
tell application ${JSON.stringify(appName)}
  if (count of windows) is 0 then return ""
  repeat with w in windows
    try
      set t to active tab of w
      set r to execute javascript ${lit} in t
      if r is not missing value and r is not "" then return r
    end try
  end repeat
  repeat with w in windows
    try
      repeat with t in tabs of w
        try
          set r to execute javascript ${lit} in t
          if r is not missing value and r is not "" then return r
        end try
      end repeat
    end try
  end repeat
  return ""
end tell
`;
    const out = await runOsa(src, 5000);
    if (out && out !== "missing value") return out;
  }
  if (matchPreferred && needle) {
    return evalInAnyTab(javascript, { matchPreferred: false });
  }
  return "";
}

/**
 * Run JS in every injectable active tab across Chrome/Edge windows.
 * Returns count of tabs that returned a non-empty result.
 */
async function evalInAllTabs(javascript) {
  if (process.platform !== "darwin") return 0;
  const lit = jsLiteral(
    `(function(){try{var r=(${javascript});return r==null?"":String(r);}catch(e){return "";}})()`,
  );
  let hits = 0;
  for (const appName of BROWSER_APPS) {
    const src = `
tell application ${JSON.stringify(appName)}
  set hit to 0
  if (count of windows) is 0 then return hit
  repeat with w in windows
    try
      repeat with t in tabs of w
        try
          set u to URL of t
          if u does not start with "chrome:" and u does not start with "edge:" and u does not start with "about:" and u does not start with "devtools:" then
            set r to execute javascript ${lit} in t
            if r is not missing value and r is not "" then set hit to hit + 1
          end if
        end try
      end repeat
    end try
  end repeat
  return hit
end tell
`;
    const out = await runOsa(src, 8000);
    const n = Number(out) || 0;
    hits += n;
  }
  return hits;
}

async function readSelector(selector) {
  if (!selector) return "";
  const sel = JSON.stringify(String(selector));
  const js = `(() => {
    const el = document.querySelector(${sel});
    if (!el) return "";
    const type = String(el.type || "").toLowerCase();
    if (type === "checkbox" || type === "radio") return el.checked ? "true" : "";
    if ("value" in el) return String(el.value || "");
    return String(el.textContent || "").trim();
  })()`;
  return evalInAnyTab(js);
}

async function readSelectors(selectors) {
  const list = (selectors || []).map((s) => String(s || "")).filter(Boolean);
  if (!list.length) return {};
  const js = `(() => {
    const sels = ${JSON.stringify(list)};
    const out = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = ""; continue; }
      const type = String(el.type || "").toLowerCase();
      if (type === "checkbox" || type === "radio") out[sel] = el.checked ? "true" : "";
      else if ("value" in el) out[sel] = String(el.value || "");
      else out[sel] = String(el.textContent || "").trim();
    }
    return JSON.stringify(out);
  })()`;
  const raw = await evalInAnyTab(js);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function fillSelector(selector, value) {
  if (!selector) return { ok: false, error: "no_selector" };
  const sel = JSON.stringify(String(selector));
  const val = JSON.stringify(String(value ?? ""));
  const js = `(() => {
    const el = document.querySelector(${sel});
    if (!el) return "";
    el.focus();
    const type = String(el.type || "").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      el.checked = true;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return "ok";
    }
    el.value = ${val};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  })()`;
  const out = await evalInAnyTab(js);
  return out === "ok" ? { ok: true } : { ok: false, error: "not_on_page" };
}

async function hasChromeWindows() {
  const titles = await chromeWindowTitles();
  return titles.length > 0;
}

module.exports = {
  isInjectableUrl,
  setPreferredUrl,
  frontTab,
  chromeWindowTitles,
  listTabs,
  evalInAnyTab,
  evalInAllTabs,
  readSelector,
  readSelectors,
  fillSelector,
  hasChromeWindows,
};
