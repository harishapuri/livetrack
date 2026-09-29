/**
 * Forward user/agent form actions to the local capture API on port 17322
 * (LiveTrack PDF/capture server, or a standalone liveact-capture agent if that
 * process already owns the port). Failures are silent when the API is down.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CAPTURE_PORT, CAPTURE_URL } = require("@coact/shared/protocol");

function captureBaseUrl() {
  const fromEnv = String(process.env.LIVEACT_CAPTURE_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return CAPTURE_URL;
}

function defaultCaptureDataDir() {
  const fromEnv = String(process.env.LIVEACT_CAPTURE_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), "Desktop", "liveact-capture", "data");
}

function localUsername() {
  try {
    return os.userInfo().username || process.env.USER || "";
  } catch {
    return process.env.USER || "";
  }
}

function payloadOf(row) {
  if (!row || typeof row !== "object") return {};
  if (row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)) return row.payload;
  if (typeof row.payload === "string") {
    try {
      const parsed = JSON.parse(row.payload);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

const NON_USER_ACTORS = new Set([
  "playwright",
  "liveact",
  "user",
  "human",
  "agent",
  "capture",
  "system",
  "browser",
]);

function sanitizeUser(name) {
  const n = String(name || "").trim();
  if (!n || NON_USER_ACTORS.has(n.toLowerCase())) return "";
  return n;
}

function userOf(row) {
  const payload = payloadOf(row);
  const name = sanitizeUser(
    row?.user_id ||
      row?.userId ||
      row?.user ||
      payload.user_id ||
      payload.userId ||
      payload.user ||
      row?.actor ||
      ""
  );
  return name || localUsername() || "(unknown)";
}

function stepUpdateToCaptureEvent(update) {
  const src = update && typeof update === "object" ? update : {};
  const manual = src.source === "manual" || src.source === "human";
  const user = String(src.user || src.userId || src.user_id || localUsername() || "").trim();
  return {
    ts: src.ts || new Date().toISOString(),
    kind: "sop_step",
    source: manual ? "human" : "liveact",
    actor: manual ? "user" : "liveact",
    user,
    user_id: user,
    action: src.action || src.status || "step",
    pageUrl: src.pageUrl || "",
    pageTitle: src.pageTitle || "",
    label: src.label || "",
    fieldName: src.key || src.stepId || "",
    value: src.value,
    cardId: src.cardId || "",
    sopId: src.sopId || "",
    stepId: src.stepId || "",
    status: src.status || "",
    sessionId: src.cardId ? `card:${src.cardId}` : src.sessionId || "",
    selector: src.selector || src.step?.selector || "",
  };
}

function forwardCaptureEvent(event) {
  if (!event || typeof event !== "object") return Promise.resolve({ ok: false, skipped: true });
  const base = captureBaseUrl();
  let url;
  try {
    url = new URL("/capture", `${base}/`);
  } catch {
    return Promise.resolve({ ok: false, error: "bad_capture_url" });
  }
  const body = JSON.stringify(event);
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || CAPTURE_PORT,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 800,
      },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.on("error", (err) => resolve({ ok: false, error: err?.message || String(err) }));
    req.write(body);
    req.end();
  });
}

function parseCaptureResponse(res, chunks) {
  const raw = Buffer.concat(chunks).toString("utf8");
  let parsed = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { raw };
  }
  return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: parsed };
}

function captureAgentDown(err) {
  return {
    ok: false,
    status: 503,
    body: {
      ok: false,
      error:
        err?.code === "ECONNREFUSED"
          ? "Capture agent is not running (cd ~/Desktop/liveact-capture && npm start)"
          : err?.message || "Capture agent did not respond — start ~/Desktop/liveact-capture (npm start)",
    },
  };
}

function requestCapture(pathname, { method = "GET", body = null, timeout = 1500 } = {}) {
  const base = captureBaseUrl();
  let url;
  try {
    url = new URL(pathname, `${base}/`);
  } catch {
    return Promise.resolve({ ok: false, status: 502, body: { ok: false, error: "bad_capture_url" } });
  }
  const payload = body == null ? "" : JSON.stringify(body);
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || CAPTURE_PORT,
        path: `${url.pathname}${url.search}`,
        method,
        headers:
          method === "GET"
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              },
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(parseCaptureResponse(res, chunks)));
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(captureAgentDown({ message: "timeout" }));
    });
    req.on("error", (err) => resolve(captureAgentDown(err)));
    if (method !== "GET" && payload) req.write(payload);
    req.end();
  });
}

function proxyCapture(pathname, search = "") {
  return requestCapture(`${pathname}${search || ""}`);
}

function captureEventsDir() {
  try {
    const { resolveExecutionsRoot } = require("./settings");
    return path.join(resolveExecutionsRoot(), "capture");
  } catch {
    return defaultCaptureDataDir();
  }
}

function readCaptureJsonl({ dateFrom = null, dateTo = null, dataDir = captureEventsDir() } = {}) {
  if (!dataDir || !fs.existsSync(dataDir)) return [];
  const rows = [];
  for (const name of fs.readdirSync(dataDir)) {
    if (!name.startsWith("events-") || !name.endsWith(".jsonl")) continue;
    const day = name.slice("events-".length, "events-YYYY-MM-DD".length);
    if (dateFrom && day < dateFrom) continue;
    if (dateTo && day > dateTo) continue;
    let text = "";
    try {
      text = fs.readFileSync(path.join(dataDir, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
  }
  return rows;
}

function captureRowsToExamples(rows) {
  const bySession = new Map();
  for (const row of rows) {
    const sessionId = row.sessionId || row.cardId;
    if (!sessionId) continue;
    if (!bySession.has(sessionId)) bySession.set(sessionId, []);
    bySession.get(sessionId).push(row);
  }
  const examples = [];
  for (const [sessionId, list] of bySession) {
    const latest = new Map();
    for (const row of list) {
      const action = String(row.action || "");
      if (!["input", "change", "select", "check", "fill", "click"].includes(action)) continue;
      const key = row.fieldName || row.key || row.fieldId || row.label || row.selector;
      if (!key) continue;
      const value = row.value != null ? String(row.value) : row.selectedText || "";
      if (!value && action !== "click" && action !== "check") continue;
      latest.set(key, {
        key,
        label: row.label || key,
        value: value || (action === "click" ? "clicked" : ""),
        selector: row.selector || "",
        action,
        source: row.source || "human",
      });
    }
    const fields = [...latest.values()];
    if (!fields.length) continue;
    const last = list[list.length - 1];
    examples.push({
      type: "capture",
      label: "positive",
      sessionId,
      cardKey: last.cardId || sessionId,
      pageUrl: last.pageUrl || "",
      capturedAt: last.ts || "",
      fields,
    });
  }
  return examples;
}

function loadCaptureExamples(opts = {}) {
  return captureRowsToExamples(readCaptureJsonl(opts));
}

function ticketOf(txn) {
  if (!txn || typeof txn !== "object") return "";
  let payloadTicket = "";
  let payloadRef = "";
  try {
    const payload = typeof txn.payload === "string" ? JSON.parse(txn.payload) : txn.payload || {};
    payloadTicket = String(payload.ticket || "").trim();
    payloadRef = String(payload.formReference || "").trim();
  } catch {
    /* ignore */
  }
  const colTicket = String(txn.ticket || "").trim();
  const colRef = String(txn.formReference || "").trim();
  const candidates = [payloadRef, colRef, payloadTicket, colTicket].filter(Boolean);
  const prefer = candidates.find(
    (c) =>
      /^(REF|RD|CONF|TXN|SUB|RECEIPT)[-_]/i.test(c) ||
      (/^[A-Z][A-Z0-9]+-\d+$/i.test(c) && !/^[0-9a-f-]{36}$/i.test(c)),
  );
  if (prefer) return prefer;
  const nonUuid = candidates.find(
    (c) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c),
  );
  return nonUuid || candidates[0] || "";
}

function valuesOf(txn) {
  if (!txn || typeof txn !== "object") return {};
  if (txn.fields && typeof txn.fields === "object" && !Array.isArray(txn.fields)) {
    return Object.fromEntries(
      Object.entries(txn.fields).filter(([, value]) => value != null && String(value).trim() !== "")
    );
  }
  try {
    const payload = typeof txn.payload === "string" ? JSON.parse(txn.payload) : txn.payload || {};
    const values = payload.values && typeof payload.values === "object" ? payload.values : {};
    return Object.fromEntries(
      Object.entries(values).filter(([, value]) => value != null && String(value).trim() !== "")
    );
  } catch {
    return {};
  }
}

function payloadOf(txn) {
  if (!txn || typeof txn !== "object") return {};
  try {
    return typeof txn.payload === "string" ? JSON.parse(txn.payload) : txn.payload || {};
  } catch {
    return {};
  }
}

function clicksOf(txn) {
  const payload = payloadOf(txn);
  const raw = Array.isArray(txn.clicks) ? txn.clicks : payload.clicks;
  return (Array.isArray(raw) ? raw : [])
    .map((click) => ({
      action: "click",
      label: String(click?.label || click?.value || "").trim(),
      selector: String(click?.selector || "").trim(),
      value: String(click?.value || click?.label || "").trim(),
      pageUrl: String(click?.pageUrl || "").trim(),
    }))
    .filter((click) => click.label);
}

function cleanQuestionLabel(text) {
  let t = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/\*+$/, "").trim();
  const cut = t.search(/\d+\s+items?\s+selected/i);
  if (cut > 8) t = t.slice(0, cut).trim();
  return t;
}

function isPlaceholderCaptureStep(step) {
  const t = String(step?.value || step?.label || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return /^(select one|select an option|select\.\.\.|select…|please select( one)?|choose one|choose an option)$/.test(
    t,
  );
}

function playwrightLocator(step, action) {
  const selector = String(step.selector || "").trim();
  const label = cleanQuestionLabel(step.label || step.fieldName);
  const name = String(step.value || step.label || "").trim();
  const locator = {};
  if (selector && !/^(button|input|a|div|span|label|select|textarea)$/i.test(selector)) {
    locator.css = selector;
  }
  if (action === "click") {
    locator.getByRole = { role: "button", name };
    locator.getByText = name;
  } else if (action === "check") {
    if (label) locator.getByLabel = label;
    if (name) locator.getByRole = { role: "radio", name };
  } else if (action === "select") {
    if (label) locator.getByLabel = label;
    locator.getByRole = { role: "combobox", name: label || name };
  } else if (label) {
    locator.getByLabel = label;
  }
  return locator;
}

/**
 * Collapsed, ordered steps for writing a Playwright script from a recording.
 * Reclassifies footer/Add/Submit that were stored as field values.
 */
function playwrightFromTxn(txn) {
  const pdf = require("./pdf-server");
  const payload = payloadOf(txn);
  const startUrl = String(txn.pageUrl || payload.url || "").trim();
  const raw = stepsOf(txn);
  const out = [];
  const lastFillAt = new Map();
  const pages = [];

  function rememberPage(url) {
    const u = String(url || "").trim();
    if (u && pages[pages.length - 1] !== u) pages.push(u);
  }

  function pushClick(step) {
    const name =
      pdf.navigationClickName(step) ||
      String(step.value || step.label || "click").trim();
    const last = out[out.length - 1];
    const selector = String(step.selector || "").trim();
    if (last && last.action === "click" && last.value === name && last.selector === selector) {
      return;
    }
    lastFillAt.clear();
    const pageUrl = String(step.pageUrl || startUrl).trim();
    rememberPage(pageUrl);
    out.push(
      require("./capture-step-shot").copyScreenshotMeta(step, {
        action: "click",
        label: name,
        value: name,
        selector,
        pageUrl,
        findByText: [name],
        locator: playwrightLocator({ ...step, label: name, value: name }, "click"),
      })
    );
  }

  for (const step of raw) {
    if (isPlaceholderCaptureStep(step)) continue;
    if (pdf.isNavigationClick(step)) {
      pushClick(step);
      continue;
    }
    const actionRaw = String(step.action || "fill").toLowerCase();
    const action =
      actionRaw === "check" || actionRaw === "select" || actionRaw === "click"
        ? actionRaw
        : "fill";
    if (action === "click") {
      pushClick(step);
      continue;
    }
    const value = String(step.value != null ? step.value : step.selectedText || "").trim();
    if (pdf.isNavigationClickLabel(value)) {
      pushClick({ ...step, value, label: value });
      continue;
    }
    if (!value) continue;
    const label = cleanQuestionLabel(step.label || step.fieldName) || String(step.label || "").trim();
    const finder = cleanQuestionLabel(step.finder || "");
    const selector = String(step.selector || "").trim();
    const pageUrl = String(step.pageUrl || startUrl).trim();
    rememberPage(pageUrl);
    const key = `${pageUrl}|${selector || label}|${action}`;
    const next = require("./capture-step-shot").copyScreenshotMeta(step, {
      action,
      label,
      fieldName: String(step.fieldName || "").trim(),
      value,
      selector: step.guiId || selector,
      guiId: String(step.guiId || "").trim(),
      pageUrl,
      locator: playwrightLocator({ ...step, label, selector: step.guiId || selector }, action),
    });
    const findByLabel = [label, finder].filter((item, index, all) => {
      const text = String(item || "").trim();
      if (!text) return false;
      return all.findIndex((other) => String(other || "").trim().toLowerCase() === text.toLowerCase()) === index;
    });
    if (finder && finder.toLowerCase() !== label.toLowerCase()) next.finder = finder;
    if (action === "fill" || action === "select") next.findByLabel = findByLabel;
    if (action === "check") {
      next.findByLabel = findByLabel;
      next.findByText = value ? [value] : [];
    }
    const prevIdx = lastFillAt.get(key);
    if (prevIdx != null && out[prevIdx] && out[prevIdx].action === action) {
      out[prevIdx] = next;
    } else {
      lastFillAt.set(key, out.length);
      out.push(next);
    }
  }

  return {
    startUrl,
    pages,
    steps: out.map((s, i) => ({ n: i + 1, ...s })),
  };
}

function stepsOf(txn) {
  const payload = payloadOf(txn);
  const raw = Array.isArray(txn.steps) ? txn.steps : payload.steps;
  if (Array.isArray(raw) && raw.length) {
    return raw
      .map((step) => {
        const row = {
          action: String(step?.action || "fill"),
          label: String(step?.label || step?.fieldName || step?.value || "").trim(),
          fieldName: String(step?.fieldName || "").trim(),
          selector: String(step?.selector || "").trim(),
          value: step?.value != null && String(step.value).trim() !== ""
            ? String(step.value)
            : String(step?.selectedText || ""),
          selectedText: String(step?.selectedText || "").trim(),
          pageUrl: String(step?.pageUrl || "").trim(),
          finder: String(step?.finder || "").trim(),
          guiId: String(step?.guiId || "").trim(),
        };
        require("./capture-step-shot").copyScreenshotMeta(step, row);
        return row;
      })
      .filter((step) => step.label || step.fieldName);
  }
  const clicks = clicksOf(txn);
  const values = valuesOf(txn);
  return [
    ...clicks,
    ...Object.entries(values).map(([key, value]) => ({
      action: "fill",
      label: key,
      fieldName: key,
      selector: "",
      value: String(value),
      pageUrl: "",
    })),
  ];
}

function pageUrlParts(rawUrl) {
  try {
    const u = new URL(String(rawUrl || "").trim());
    const path = (u.pathname || "").toLowerCase().replace(/\/+$/, "");
    return {
      host: (u.host || "").toLowerCase(),
      path,
      segments: path.split("/").filter(Boolean),
    };
  } catch {
    return null;
  }
}

/** Score how closely a stored capture URL matches the page being explained. */
function pageUrlMatchScore(txnUrl, queryUrl) {
  const a = pageUrlParts(txnUrl);
  const b = pageUrlParts(queryUrl);
  if (!a || !b || !a.host || !b.host) return 0;
  const sameHost = a.host === b.host;
  const relatedHost =
    sameHost ||
    (a.host.includes("vanguard") && b.host.includes("vanguard")) ||
    (a.host.includes("myworkdayjobs") && b.host.includes("myworkdayjobs"));
  if (!relatedHost) return 0;
  if (sameHost && a.path && a.path === b.path) return 12;
  const jobA = a.segments.find((s) => /_[0-9]{4,}/.test(s));
  const jobB = b.segments.find((s) => /_[0-9]{4,}/.test(s));
  if (jobA && jobB && jobA === jobB) return 11;
  const setB = new Set(b.segments);
  let shared = 0;
  for (const s of a.segments) {
    if (s.length > 4 && setB.has(s)) shared += 1;
  }
  if (sameHost && shared >= 3) return 8;
  if (sameHost && a.path.includes("/apply") && b.path.includes("/apply")) return 6;
  if (sameHost && shared >= 1) return 4;
  if (!sameHost && shared >= 2) return 3;
  return relatedHost && sameHost ? 2 : 0;
}

function titleAgainstUrlScore(title, txnUrl) {
  const t = String(title || "").toLowerCase().trim();
  const url = String(txnUrl || "").toLowerCase();
  if (!t || !url) return 0;
  const slug = t.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (slug.length >= 10 && url.includes(slug.slice(0, Math.min(slug.length, 40)))) return 8;
  const words = t.split(/[^a-z0-9]+/).filter((w) => w.length > 4);
  let hits = 0;
  for (const w of words) {
    if (url.includes(w)) hits += 1;
  }
  if (hits >= 2) return 6;
  if (hits === 1 && url.includes("vanguard") && t.includes("vanguard")) return 4;
  return 0;
}

function captureMatchScore(
  txn,
  {
    cardId = "",
    issueKey = "",
    queueCard = "",
    similarKeys = [],
    labels = [],
    pageUrl = "",
    pageTitle = "",
  } = {},
) {
  const payload = payloadOf(txn);
  const cid = String(payload.cardId || txn.cardId || "").trim();
  const title = String(payload.queueCard || txn.queueCard || txn.pageTitle || payload.title || "");
  const url = String(txn.pageUrl || payload.url || "");
  const ticket = ticketOf(txn);
  const ticketUp = String(ticket || "").toUpperCase();
  const titleUp = title.toUpperCase();
  const urlUp = url.toUpperCase();
  let score = 0;
  if (cardId && cid === cardId) score += 10;
  if (cardId && (url.includes(cardId) || title.includes(cardId))) score += 8;
  if (issueKey && ticketUp && ticketUp === String(issueKey).toUpperCase()) score += 9;
  if (issueKey) {
    const keyUp = String(issueKey).toUpperCase();
    if (titleUp.includes(keyUp) || urlUp.includes(keyUp)) score += 6;
  }
  const similar = [
    ...new Set(
      (Array.isArray(similarKeys) ? similarKeys : [])
        .map((k) => String(k || "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  for (const sk of similar) {
    if (ticketUp && ticketUp === sk) score += 7;
    else if (titleUp.includes(sk) || urlUp.includes(sk)) score += 5;
  }
  for (const label of Array.isArray(labels) ? labels : []) {
    const l = String(label || "").trim().toLowerCase();
    if (l.length >= 3 && title.toLowerCase().includes(l)) score += 2;
  }
  const q = String(queueCard || pageTitle || "").toLowerCase();
  if (q && title.toLowerCase().includes(q.slice(0, 24))) score += 4;
  score += pageUrlMatchScore(url, pageUrl);
  score += titleAgainstUrlScore(pageTitle || queueCard, url);
  score += titleAgainstUrlScore(title, pageUrl);
  return score;
}

function captureActivityFromTxn(txn) {
  if (!txn) return null;
  const payload = payloadOf(txn);
  return {
    ticket: ticketOf(txn),
    values: valuesOf(txn),
    clicks: clicksOf(txn),
    pageUrl: String(txn.pageUrl || payload.url || ""),
    cardId: String(payload.cardId || txn.cardId || ""),
    queueCard: String(payload.queueCard || txn.queueCard || ""),
  };
}

async function loadAllCaptureTransactions() {
  let live = [];
  try {
    live = await fetchCaptureTransactions();
  } catch {
    live = [];
  }
  return [...(await loadPersistedCaptureTransactions()), ...live];
}

async function findLatestCaptureActivity({ cardId = "", issueKey = "", queueCard = "" } = {}) {
  const all = await loadAllCaptureTransactions();
  let best = null;
  let bestRank = 0;
  for (const txn of all) {
    const score = captureMatchScore(txn, { cardId, issueKey, queueCard });
    if (!score) continue;
    const payload = payloadOf(txn);
    const when = Date.parse(txn.completedAt || payload.completedAt || txn.startedAt || 0) || 0;
    const rank = score * 1e15 + when;
    if (rank >= bestRank) {
      bestRank = rank;
      best = txn;
    }
  }
  return captureActivityFromTxn(best);
}

/**
 * Rank past capture transactions for Explain-page context.
 * Prefers exact ticket match, then linked/similar keys, then label/title overlap.
 */
async function findSimilarCaptures({
  cardId = "",
  issueKey = "",
  queueCard = "",
  similarKeys = [],
  labels = [],
  pageUrl = "",
  pageTitle = "",
  limit = 3,
} = {}) {
  const max = Math.max(1, Math.min(Number(limit) || 3, 5));
  const all = await loadAllCaptureTransactions();
  const ranked = [];
  const seen = new Set();
  for (const txn of all) {
    const score = captureMatchScore(txn, {
      cardId,
      issueKey,
      queueCard,
      similarKeys,
      labels,
      pageUrl,
      pageTitle,
    });
    if (!score) continue;
    const payload = payloadOf(txn);
    const when = Date.parse(txn.completedAt || payload.completedAt || txn.startedAt || 0) || 0;
    const ticket = ticketOf(txn);
    const dedupe =
      String(txn.id || txn.transactionId || payload.recordingSessionId || "").trim() ||
      `${ticket}|${when}|${String(txn.pageUrl || payload.url || "")}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    ranked.push({ txn, score, when, ticket });
  }
  ranked.sort((a, b) => b.score - a.score || b.when - a.when);
  return ranked.slice(0, max).map(({ txn, score, when, ticket }) => {
    const activity = captureActivityFromTxn(txn);
    const confidence = matchConfidencePercent(score);
    return {
      ...activity,
      score,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      when: when || 0,
      ticket: ticket || activity?.ticket || "",
      formReference: ticket || activity?.ticket || "",
      steps: stepsOf(txn).slice(0, 12),
    };
  });
}

function truncateExampleValue(value, max = 48) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (/@/.test(raw) && raw.length > 6) return "[email]";
  if (/^\d{10,}$/.test(raw.replace(/[\s-]/g, ""))) return "[number]";
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}

/**
 * Map capture match score → 0–100 confidence.
 * Exact/same-job URL matches land in the 90s; weaker host overlap lower.
 */
function matchConfidencePercent(score) {
  const s = Number(score) || 0;
  if (s <= 0) return 0;
  if (s >= 12) return 96;
  if (s >= 11) return 92;
  if (s >= 9) return 85;
  if (s >= 8) return 78;
  if (s >= 6) return 68;
  if (s >= 4) return 55;
  if (s >= 2) return 42;
  return 30;
}

function confidenceLabel(percent) {
  const p = Number(percent) || 0;
  if (p >= 85) return "high";
  if (p >= 60) return "medium";
  if (p >= 40) return "low";
  return "weak";
}

function humanizeFieldKey(key) {
  return String(key || "")
    .replace(/^#+/, "")
    .replace(/^primaryQuestionnaire--[a-f0-9]+$/i, "questionnaire answer")
    .replace(/--/g, " / ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compact past-recording lines for the Explain model (not a full SOP). */
function formatCaptureHistoryBlock(captures = [], { maxSteps = 8, maxFields = 8 } = {}) {
  const list = Array.isArray(captures) ? captures : [];
  if (!list.length) return "";
  const lines = [
    "Similar past recordings (from clickstreams — cite only these; keep each ref's confidence % when you mention it):",
  ];
  list.forEach((cap, idx) => {
    const key = String(cap?.formReference || cap?.ticket || "").trim() || `recording-${idx + 1}`;
    const confidence =
      cap?.confidence != null
        ? Number(cap.confidence)
        : matchConfidencePercent(cap?.score);
    const label = confidenceLabel(confidence);
    lines.push(`- Reference ${key} (confidence ${confidence}%, ${label}):`);
    const clicks = (Array.isArray(cap?.clicks) ? cap.clicks : [])
      .map((c) => (typeof c === "string" ? c : c?.label || c?.value || ""))
      .map((l) => String(l || "").trim())
      .filter(Boolean);
    const values = cap?.values && typeof cap.values === "object" ? cap.values : {};
    const fillSteps = Object.entries(values)
      .map(([k, v]) => {
        const shown = truncateExampleValue(v);
        const fieldLabel = humanizeFieldKey(k);
        if (!shown || !fieldLabel || fieldLabel === "questionnaire answer") return "";
        return `${fieldLabel}=${shown}`;
      })
      .filter(Boolean);
    const clickPath = clicks.filter((c) => !/^(yes|no)$/i.test(c));
    const path = [...clickPath, ...fillSteps].slice(0, maxSteps);
    if (path.length) lines.push(`  Steps / values: ${path.join(" → ")}`);
    else if (clicks.length) lines.push(`  Clicks: ${clicks.slice(0, maxSteps).join(" → ")}`);
    const fieldNotes = Object.entries(values)
      .map(([k, v]) => {
        const shown = truncateExampleValue(v);
        const fieldLabel = humanizeFieldKey(k);
        return shown && fieldLabel ? `${fieldLabel}: ${shown}` : "";
      })
      .filter(Boolean)
      .slice(0, maxFields);
    if (fieldNotes.length) lines.push(`  Example fields: ${fieldNotes.join("; ")}`);
    if (cap?.pageUrl) lines.push(`  Page: ${String(cap.pageUrl).slice(0, 120)}`);
  });
  return lines.join("\n");
}

function fetchCaptureTransactions() {
  return proxyCapture("/api/transactions").then((res) => {
    if (!res.ok || !Array.isArray(res.body?.transactions)) return [];
    return res.body.transactions;
  });
}

function setCaptureRecording({
  action = "stop",
  cardId = "",
  queueCard = "",
  lob = "",
  user = "",
} = {}) {
  const userId = String(user || localUsername() || "").trim();
  return requestCapture("/api/recording", {
    method: "POST",
    timeout: 4000,
    body: {
      action:
        action === "pause" || action === "resume" || action === "start"
          ? action
          : "stop",
      cardId: String(cardId || ""),
      queueCard: String(queueCard || ""),
      lob: String(lob || ""),
      user: userId,
      user_id: userId,
    },
  }).then((res) => ({
    ok: res.ok,
    recording: Boolean(res.body?.recording),
    paused: Boolean(res.body?.paused),
    ready: res.body?.ready !== false,
    recordingSessionId: res.body?.recordingSessionId || null,
    error: res.ok ? "" : res.body?.error || "capture_unavailable",
    playwright: res.body?.playwright || null,
  }));
}

function startCaptureRecording() {
  return setCaptureRecording({ action: "start" });
}

async function getCaptureStatus() {
  // Step capture can keep the agent busy. A short health timeout looked like
  // "not recording" and the desktop then stopped the session.
  const health = await requestCapture("/health", { timeout: 8000 });
  let transactions = [];
  if (health.ok) {
    try {
      transactions = await fetchCaptureTransactions();
    } catch {
      transactions = [];
    }
  }
  return {
    ok: health.ok,
    recording: Boolean(health.body?.recording),
    paused: Boolean(health.body?.paused),
    recordingSessionId: health.body?.recordingSessionId || null,
    ready: health.body?.ready !== false,
    error: health.ok ? "" : health.body?.error || "",
    playwright: health.body?.playwright || null,
    transactions,
  };
}

function captureSnapshotDir() {
  try {
    const { resolveExecutionsRoot } = require("./settings");
    return path.join(resolveExecutionsRoot(), "capture");
  } catch {
    return path.join(defaultCaptureDataDir(), "dash-snapshots");
  }
}

function writeCaptureTxnSnapshot(transactions) {
  try {
    const dir = captureSnapshotDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "transactions.json"),
      `${JSON.stringify({
        savedAt: new Date().toISOString(),
        transactions: Array.isArray(transactions) ? transactions : [],
      })}\n`
    );
  } catch {
    /* disk optional */
  }
}

function loadSnapshotCaptureTransactions() {
  try {
    const file = path.join(captureSnapshotDir(), "transactions.json");
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed?.transactions) ? parsed.transactions : [];
  } catch {
    return [];
  }
}

function transactionsFromJsonl(opts = {}) {
  const { groupCaptureEvents } = require("./pdf-server");
  const from = opts.dateFrom || new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return groupCaptureEvents(readCaptureJsonl({ ...opts, dateFrom: from, dataDir: opts.dataDir || captureEventsDir() }));
}

function txnKey(txn) {
  return String(txn?.transactionId || ticketOf(txn) || "").trim();
}

function txnRichness(txn) {
  if (!txn) return 0;
  return (
    stepsOf(txn).length +
    clicksOf(txn).length +
    Object.keys(valuesOf(txn)).length
  );
}

function mergeTxn(prev, next) {
  if (!prev) return withCaptureRef(next);
  if (!next) return withCaptureRef(prev);
  const richer = txnRichness(next) >= txnRichness(prev) ? next : prev;
  const other = richer === next ? prev : next;
  const payload = {
    ...payloadOf(other),
    ...payloadOf(richer),
    unmatched: Boolean(payloadOf(richer).unmatched || payloadOf(other).unmatched || richer.unmatched || other.unmatched),
    discoveryStatus:
      payloadOf(richer).discoveryStatus ||
      richer.discoveryStatus ||
      payloadOf(other).discoveryStatus ||
      other.discoveryStatus ||
      "",
    draftSopId:
      payloadOf(richer).draftSopId || richer.draftSopId || payloadOf(other).draftSopId || other.draftSopId || "",
  };
  const preferredTicket =
    [richer, other]
      .map((t) => String(t.formReference || t.ticket || payloadOf(t).formReference || payloadOf(t).ticket || "").trim())
      .find((t) => t && !isSyntheticCaptureTicket(t) && !/^[0-9a-f-]{32,}$/i.test(t)) || "";
  if (preferredTicket) {
    payload.ticket = preferredTicket;
    payload.formReference = preferredTicket;
  }
  return withCaptureRef({
    ...other,
    ...richer,
    ticket: preferredTicket || richer.ticket || other.ticket || "",
    formReference: preferredTicket || richer.formReference || other.formReference || "",
    unmatched: Boolean(richer.unmatched || other.unmatched || payload.unmatched),
    discoveryStatus: payload.discoveryStatus,
    draftSopId: payload.draftSopId,
    payload: JSON.stringify(payload),
  });
}

function persistCaptureTransactions(transactions) {
  const stamped = (transactions || []).map((txn) => enrichTxnWithPlaywright(withCaptureRef(txn)));
  writeCaptureTxnSnapshot(stamped);
  const wb = require("./workbook");
  const txnRows = [];
  const fieldRows = [];
  for (const txn of stamped) {
    const id = String(txn.transactionId || ticketOf(txn) || "session")
      .trim()
      .replace(/[^\w.-]+/g, "_");
    if (!id) continue;
    const payload = {
      ...payloadOf(txn),
      recordingSessionId: txn.transactionId || payloadOf(txn).recordingSessionId,
      ticket: txn.ticket || payloadOf(txn).ticket || "",
      formReference: txn.formReference || payloadOf(txn).formReference || "",
      formReferenceGenerated: Boolean(txn.formReferenceGenerated || payloadOf(txn).formReferenceGenerated),
    };
    const stored = {
      ...txn,
      ticket: payload.ticket,
      formReference: payload.formReference,
      formReferenceGenerated: payload.formReferenceGenerated,
      transactionId: txn.transactionId || id,
      payload: JSON.stringify(payload),
    };
    txnRows.push({
      ticket: id,
      cardId: txn.cardId || "",
      queueCard: txn.queueCard || "",
      startedAt: txn.startedAt || "",
      completedAt: txn.completedAt || "",
      pageUrl: txn.pageUrl || "",
      payload_json: wb.jsonCell(stored),
    });
    const values = valuesOf(txn);
    for (const [key, value] of Object.entries(values || {})) {
      fieldRows.push({
        ticket: id,
        field_key: key,
        field_value: value == null ? "" : String(value),
      });
    }
  }
  if (!txnRows.length) return Promise.resolve();
  return wb
    .withWorkbook(undefined, async (workbook) => {
      const existingTx = wb.readSheetObjects(workbook, wb.SHEETS.CaptureTxns);
      const existingFields = wb.readSheetObjects(workbook, wb.SHEETS.CaptureFields);
      const tickets = new Set(txnRows.map((r) => r.ticket));
      wb.replaceSheet(workbook, wb.SHEETS.CaptureTxns, [
        ...existingTx.filter((r) => !tickets.has(r.ticket)),
        ...txnRows,
      ]);
      wb.replaceSheet(workbook, wb.SHEETS.CaptureFields, [
        ...existingFields.filter((r) => !tickets.has(r.ticket)),
        ...fieldRows,
      ]);
    })
    .catch((err) => {
      console.warn("[livetrack] persist capture", err?.message || err);
    });
}

async function loadPersistedCaptureTransactions() {
  try {
    const wb = require("./workbook");
    const { CaptureTxns } = await wb.readTables(["CaptureTxns"]);
    return (CaptureTxns || [])
      .map((row) => {
        const parsed = wb.parseJsonCell(row.payload_json);
        if (!parsed || typeof parsed !== "object") return null;
        if (!parsed.transactionId && row.ticket) parsed.transactionId = row.ticket;
        return parsed;
      })
      .filter((txn) => txn && typeof txn === "object");
  } catch {
    return [];
  }
}

function applyTxnPatch(txn, patch) {
  const next = { ...(txn && typeof txn === "object" ? txn : {}), ...(patch || {}) };
  const payload = { ...payloadOf(txn), ...(patch || {}) };
  next.payload = JSON.stringify(payload);
  return next;
}

async function mergeLiveAndPersistedTransactions() {
  let live = [];
  try {
    live = await fetchCaptureTransactions();
  } catch {
    live = [];
  }
  const persisted = await loadPersistedCaptureTransactions();
  const snapshot = loadSnapshotCaptureTransactions();
  let fromJsonl = [];
  try {
    fromJsonl = transactionsFromJsonl();
  } catch {
    fromJsonl = [];
  }
  const byId = new Map();
  for (const txn of [...persisted, ...snapshot, ...fromJsonl, ...live]) {
    const id = txnKey(txn);
    if (!id) continue;
    byId.set(id, mergeTxn(byId.get(id), txn));
  }
  const all = [...byId.values()];
  await persistCaptureTransactions(all);
  return all;
}

function isNoiseCaptureUrl(url) {
  const href = String(url || "");
  if (/127\.0\.0\.1:17322|localhost:17322/.test(href)) return true;
  if (/\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(href)) return true;
  if (/cloudhelp|jira-mock/i.test(href)) return true;
  return false;
}

function isSyntheticCaptureTicket(ticket) {
  return /^CAP-[0-9a-f-]+$/i.test(String(ticket || "").trim());
}

function resolveCaptureTicket(txn, payload = {}) {
  const pdf = require("./pdf-server");
  const raw = String(
    ticketOf(txn) || payload.ticket || payload.formReference || txn.formReference || ""
  ).trim();
  if (raw && !isSyntheticCaptureTicket(raw)) {
    if (pdf.isJiraBrowseKey(raw) || pdf.isCaptureRefKey(raw)) {
      return { ticket: raw, generated: Boolean(payload.formReferenceGenerated) };
    }
    // Keep real form refs (not session UUIDs / opaque ids)
    if (
      !/^CAP-/i.test(raw) &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) &&
      raw.length <= 64
    ) {
      return { ticket: raw, generated: Boolean(payload.formReferenceGenerated) };
    }
  }
  const ticket = pdf.captureTicketFor({
    formReference: raw,
    ticket: raw,
    pageUrl: txn.pageUrl || payload.url || "",
    transactionId: txn.transactionId || payload.recordingSessionId || "",
    recordingSessionId: payload.recordingSessionId || txn.transactionId || "",
    startedAt: txn.startedAt || payload.startedAt,
    completedAt: txn.completedAt || payload.completedAt,
  });
  return { ticket, generated: !pdf.isJiraBrowseKey(ticket) };
}

/** Stamp a stable REF (or Jira key) onto a capture transaction + payload. */
function withCaptureRef(txn) {
  if (!txn || typeof txn !== "object") return txn;
  const payload = payloadOf(txn);
  const resolved = resolveCaptureTicket(txn, payload);
  const ticket = resolved.ticket;
  if (!ticket) return txn;
  const nextPayload = {
    ...payload,
    ticket,
    formReference: ticket,
    formReferenceGenerated: resolved.generated,
    recordingSessionId: payload.recordingSessionId || txn.transactionId || "",
  };
  return {
    ...txn,
    ticket,
    formReference: ticket,
    formReferenceGenerated: resolved.generated,
    transactionId: txn.transactionId || payload.recordingSessionId || "",
    payload: JSON.stringify(nextPayload),
  };
}

/**
 * Clean {key, value, type} rows for LiveAct Dash — prefer human labels, drop noise.
 */
function cleanCaptureDisplayPairs(steps = [], values = {}) {
  const pdf = require("./pdf-server");
  const pairs = [];
  const seen = new Set();
  let answerN = 0;

  function pushPair(key, value, type) {
    let k = String(key || "").replace(/\s+/g, " ").trim();
    const v = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    if (!k) return;
    if (/^https?:\/\//i.test(k)) return;
    if (/password/i.test(k)) return;
    if (pdf.isJunkCaptureName?.(k) || /^(input|select|textarea|field)$/i.test(k)) return;
    if (/Questionnaire--/i.test(k) && pdf.looksLikeOpaqueId?.(v)) return;
    if (!v && type !== "click") return;
    if (v && pdf.looksLikeOpaqueId?.(v) && k.length < 8) return;
    if (/^answer$/i.test(k)) {
      answerN += 1;
      k = `Answer ${answerN}`;
    }
    const dedupe = `${type}|${k.toLowerCase()}|${v.toLowerCase()}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    pairs.push({ key: k, value: v || (type === "click" ? "click" : ""), type });
  }

  for (const step of steps || []) {
    const action = String(step.action || "fill").toLowerCase();
    let key = String(step.label || step.fieldName || "").trim();
    let value = String(step.value != null ? step.value : step.selectedText || "").trim();
    const fieldName = String(step.fieldName || "").trim();

    if (action === "click") {
      const short =
        /^(yes|no|y|n|true|false)$/i.test(key) || /^(yes|no|y|n|true|false)$/i.test(value);
      if (short || (value && fieldName && fieldName !== value && !pdf.isJunkCaptureName?.(fieldName))) {
        value = value || (/^(yes|no|y|n|true|false)$/i.test(key) ? key : value);
        key =
          fieldName && !/^(yes|no|y|n|true|false)$/i.test(fieldName) && !pdf.isJunkCaptureName?.(fieldName)
            ? fieldName
            : key;
        if (/^(yes|no|y|n|true|false)$/i.test(key) || pdf.isJunkCaptureName?.(key)) {
          pushPair("Answer", value, "choice");
          continue;
        }
        pushPair(key, value, "choice");
        continue;
      }
      pushPair(key, value || "click", "click");
      continue;
    }

    if (action === "check" || action === "select") {
      if (/^(yes|no|true|false)$/i.test(key) && value && !/^(yes|no|true|false)$/i.test(value)) {
        // swapped
        pushPair(value, key, action === "select" ? "select" : "choice");
        continue;
      }
      if (
        fieldName &&
        !pdf.isJunkCaptureName?.(fieldName) &&
        (/^(yes|no|true|false)$/i.test(key) || key === value)
      ) {
        key = fieldName;
      }
      pushPair(key, value || "checked", action === "select" ? "select" : "choice");
      continue;
    }

    if (pdf.looksLikeOpaqueId?.(value)) continue;
    if (pdf.isJunkCaptureName?.(key) && fieldName && !pdf.isJunkCaptureName?.(fieldName)) key = fieldName;
    if (pdf.isJunkCaptureName?.(key)) continue;
    pushPair(key, value, "field entry");
  }

  const answered = new Set(
    pairs
      .filter(
        (p) =>
          p.type !== "click" &&
          p.key.toLowerCase() !== p.value.toLowerCase() &&
          p.value.toLowerCase() !== "checked",
      )
      .map((p) => p.value.toLowerCase()),
  );
  const kept = pairs.filter((p) => {
    if (p.type === "click") return true;
    if (p.value.toLowerCase() === "checked" && answered.has(p.key.toLowerCase())) return false;
    if (p.key.toLowerCase() === p.value.toLowerCase() && answered.has(p.value.toLowerCase())) return false;
    return true;
  });
  pairs.length = 0;
  pairs.push(...kept);

  if (!pairs.length && values && typeof values === "object") {
    for (const [key, value] of Object.entries(values)) {
      if (pdf.looksLikeOpaqueId?.(value)) continue;
      pushPair(key, value, "field entry");
    }
  }
  return pairs;
}

function captureTransactionsToDashRows(transactions) {
  return (transactions || [])
    .map((txn) => {
      const values = valuesOf(txn);
      let payload = {};
      try {
        payload = typeof txn.payload === "string" ? JSON.parse(txn.payload) : txn.payload || {};
      } catch {
        payload = {};
      }
      const pageUrl = txn.pageUrl || payload.url || "";
      if (isNoiseCaptureUrl(pageUrl)) return null;
      const resolved = resolveCaptureTicket(txn, payload);
      const ticket = resolved.ticket;
      const playwright = playwrightFromTxn(txn);
      const clicks = playwrightClicks(playwright);
      const steps = stepsOf(txn);
      const pairs = cleanCaptureDisplayPairs(steps, valuesWithoutNav(values));
      const mandatory = (pairs.length
        ? pairs
            .filter((p) => p.type !== "click")
            .map((p) => ({
              key: p.key,
              label: p.key,
              value: p.value,
              filled: true,
              type: p.type,
            }))
        : Object.entries(values)
            .filter(([, value]) => String(value || "").trim() && String(value).length <= 200)
            .map(([label, value]) => ({
              key: label,
              label,
              value: String(value),
              filled: true,
            }))
      ).filter((m) => m.value);
      if (!mandatory.length && !clicks.length && !steps.length && !pairs.length) return null;
      const completed = txn.completedAt || payload.completedAt || "";
      const cardId = String(payload.cardId || txn.cardId || "").trim();
      const queueCard = String(payload.queueCard || txn.queueCard || "").trim();
      const unmatched = Boolean(
        payload.unmatched || txn.unmatched || (!cardId && !queueCard)
      );
      const discoveryStatus = String(
        payload.discoveryStatus || txn.discoveryStatus || (unmatched ? "pending" : "")
      );
      return {
        run_id: `capture:${ticket || txn.transactionId || pageUrl || completed}`,
        transactionId: txn.transactionId || payload.recordingSessionId || "",
        lob: String(payload.lob || txn.lob || ""),
        queue_card_id: cardId || "website-capture",
        queue_card: queueCard || txn.pageTitle || payload.title || "Form capture",
        user_id: userOf(txn),
        fill_mode: "capture",
        run_date: String(completed).slice(0, 10),
        completed_at: completed,
        formReference: ticket,
        formReferenceGenerated: resolved.generated,
        jiraKey: ticket,
        jiraKeyGenerated: resolved.generated,
        jiraStoryKey: "",
        jiraUrl: null,
        mistake_count: 0,
        mandatory,
        mandatoryFilled: mandatory.length,
        mandatoryTotal: mandatory.length,
        pairs,
        pageUrl,
        clicks,
        steps,
        playwright,
        unmatched,
        discoveryStatus,
        draftSopId: payload.draftSopId || txn.draftSopId || "",
      };
    })
    .filter(Boolean);
}

function txnCompletedStamp(txn) {
  return String(txn?.completedAt || txn?.ts || txn?.startedAt || "");
}

function latestCaptureTransactions(list, limit = 5) {
  return [...(list || [])]
    .sort((a, b) => txnCompletedStamp(b).localeCompare(txnCompletedStamp(a)))
    .slice(0, limit);
}

function preferNewerTxn(prev, next) {
  if (!prev) return next;
  if (!next) return prev;
  const prevStamp = txnCompletedStamp(prev);
  const nextStamp = txnCompletedStamp(next);
  const nextRich = txnRichness(next);
  const prevRich = txnRichness(prev);
  if (nextStamp > prevStamp && nextRich > 0) return next;
  if (prevStamp > nextStamp && prevRich > 0) return prev;
  return nextRich >= prevRich ? next : prev;
}

/**
 * Dash open path. Latest values come from today's event log and the live
 * capture agent. The snapshot file is only a backup — it stays on the last
 * recording that was fully saved, so reading it alone shows old fields.
 * Do not scan Excel or rewrite the workbook on open.
 */
async function loadCaptureDashRows() {
  const snapshot = latestCaptureTransactions(loadSnapshotCaptureTransactions(), 5);
  let live = [];
  try {
    live = await fetchCaptureTransactions();
  } catch {
    live = [];
  }
  let recent = [];
  try {
    const from = new Date();
    from.setDate(from.getDate() - 1);
    recent = transactionsFromJsonl({ dateFrom: from.toISOString().slice(0, 10) });
  } catch {
    recent = [];
  }
  const byId = new Map();
  for (const txn of [...snapshot, ...recent, ...latestCaptureTransactions(live, 5)]) {
    const id = txnKey(txn);
    if (!id) continue;
    byId.set(id, preferNewerTxn(byId.get(id), txn));
  }
  let all = [...byId.values()];
  if (!all.length) {
    try {
      all = await loadPersistedCaptureTransactions();
    } catch {
      all = [];
    }
  }
  return captureTransactionsToDashRows(latestCaptureTransactions(all, 5));
}

const VALUE_ACTIONS = new Set(["input", "change", "select", "check", "fill"]);
const LIVE_MS = 3 * 60 * 1000;

function summarizeCaptureByUser({ transactions = [], events = [], now = Date.now() } = {}) {
  const byUser = new Map();

  function bucketFor(user) {
    const name = String(user || "").trim() || localUsername() || "(unknown)";
    if (!byUser.has(name)) {
      byUser.set(name, {
        name,
        live: false,
        lastAt: "",
        pageUrl: "",
        pageTitle: "",
        cardId: "",
        queueCard: "",
        values: {},
        sessions: new Set(),
      });
    }
    return byUser.get(name);
  }

  function ingest({
    user,
    field,
    label,
    value,
    at,
    source,
    pageUrl,
    pageTitle,
    cardId,
    queueCard,
    sessionId,
  }) {
    const key = String(field || label || "").trim();
    if (!key) return;
    const text = value == null ? "" : String(value);
    if (!text.trim() && source !== "check") return;
    const bucket = bucketFor(user);
    const prev = bucket.values[key];
    const stamp = String(at || "");
    if (!prev || stamp >= String(prev.at || "")) {
      bucket.values[key] = {
        key,
        label: String(label || key),
        value: text,
        at: stamp,
        source: source || "capture",
        pageUrl: pageUrl || "",
        cardId: cardId || "",
      };
    }
    if (stamp && stamp > bucket.lastAt) {
      bucket.lastAt = stamp;
      if (pageUrl) bucket.pageUrl = pageUrl;
      if (pageTitle) bucket.pageTitle = pageTitle;
      if (cardId) bucket.cardId = cardId;
      if (queueCard) bucket.queueCard = queueCard;
    }
    if (sessionId) bucket.sessions.add(String(sessionId));
    const ts = Date.parse(stamp);
    if (Number.isFinite(ts) && now - ts <= LIVE_MS) bucket.live = true;
  }

  for (const txn of transactions || []) {
    const payload = payloadOf(txn);
    const values = valuesOf(txn);
    const user = userOf(txn);
    const at = txn.completedAt || payload.completedAt || txn.ts || "";
    const pageUrl = txn.pageUrl || payload.url || "";
    const pageTitle = txn.pageTitle || payload.title || "";
    const cardId = String(payload.cardId || txn.cardId || "").trim();
    const queueCard = String(payload.queueCard || txn.queueCard || pageTitle || "").trim();
    const sessionId = txn.transactionId || ticketOf(txn) || cardId;
    for (const [field, value] of Object.entries(values)) {
      ingest({
        user,
        field,
        label: field,
        value,
        at,
        source: "capture",
        pageUrl,
        pageTitle,
        cardId,
        queueCard,
        sessionId,
      });
    }
  }

  for (const row of events || []) {
    const action = String(row.action || "");
    if (!VALUE_ACTIONS.has(action)) continue;
    const field = row.fieldName || row.key || row.fieldId || row.label || row.selector;
    ingest({
      user: userOf(row),
      field,
      label: row.label || field,
      value: row.value != null ? row.value : row.selectedText || "",
      at: row.ts || "",
      source: row.source || action,
      pageUrl: row.pageUrl || "",
      pageTitle: row.pageTitle || "",
      cardId: row.cardId || "",
      queueCard: row.queueCard || "",
      sessionId: row.sessionId || row.cardId || "",
    });
  }

  return [...byUser.values()]
    .map((b) => {
      const values = Object.values(b.values).sort((a, c) => String(c.at).localeCompare(String(a.at)));
      return {
        name: b.name,
        live: b.live,
        lastAt: b.lastAt,
        pageUrl: b.pageUrl,
        pageTitle: b.pageTitle,
        cardId: b.cardId,
        queueCard: b.queueCard,
        fieldCount: values.length,
        sessionCount: b.sessions.size,
        values,
      };
    })
    .filter((u) => u.fieldCount > 0)
    .sort(
      (a, b) => Number(b.live) - Number(a.live) || String(b.lastAt).localeCompare(String(a.lastAt))
    );
}

function valuesWithoutNav(values) {
  const pdf = require("./pdf-server");
  const out = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (pdf.isNavigationClickLabel(value)) continue;
    out[key] = value;
  }
  return out;
}

function playwrightClicks(playwright) {
  return (playwright?.steps || [])
    .filter((s) => s.action === "click")
    .map((s) =>
      require("./capture-step-shot").copyScreenshotMeta(s, {
        action: "click",
        label: s.label,
        selector: s.selector,
        value: s.value,
        pageUrl: s.pageUrl,
        locator: s.locator,
      })
    );
}

function enrichTxnWithPlaywright(txn) {
  if (!txn || typeof txn !== "object") return txn;
  const pdf = require("./pdf-server");
  const playwright = playwrightFromTxn(txn);
  const clicks = playwrightClicks(playwright).map(({ locator, ...click }) => click);
  const values = valuesWithoutNav(valuesOf(txn));
  const steps = stepsOf(txn).map((step) => {
    if (!pdf.isNavigationClick(step) && !pdf.isNavigationClickLabel(step.value)) return step;
    const name = pdf.navigationClickName(step) || String(step.value || step.label || "click").trim();
    return require("./capture-step-shot").copyScreenshotMeta(step, {
      action: "click",
      label: name,
      selector: String(step.selector || "").trim(),
      value: name,
      pageUrl: String(step.pageUrl || "").trim(),
    });
  });
  const payload = {
    ...payloadOf(txn),
    values,
    clicks,
    steps,
  };
  return {
    ...txn,
    fields: values,
    clicks,
    steps,
    payload: JSON.stringify(payload),
  };
}

function captureTransactionRecord(txn, { now = Date.now() } = {}) {
  const payload = payloadOf(txn);
  const values = valuesWithoutNav(valuesOf(txn));
  const playwright = playwrightFromTxn(txn);
  const clicks = playwrightClicks(playwright);
  const completedAt = String(txn.completedAt || payload.completedAt || txn.ts || "");
  const ts = Date.parse(completedAt);
  const ticket = ticketOf(txn) || "";
  return {
    user: userOf(txn),
    ticket: ticket || null,
    transactionId: txn.transactionId || null,
    cardId: String(payload.cardId || txn.cardId || "") || null,
    queueCard: String(payload.queueCard || txn.queueCard || "") || null,
    pageTitle: txn.pageTitle || payload.title || null,
    pageUrl: txn.pageUrl || payload.url || null,
    completedAt: completedAt || null,
    live: Number.isFinite(ts) && now - ts <= LIVE_MS,
    values,
    clicks,
    playwright,
  };
}

function listCaptureTransactionRecords(transactions, opts = {}) {
  const byKey = new Map();
  for (const txn of transactions || []) {
    const rec = captureTransactionRecord(txn, opts);
    if (
      (!rec.values || !Object.keys(rec.values).length) &&
      !(rec.clicks && rec.clicks.length) &&
      !(rec.playwright && rec.playwright.steps && rec.playwright.steps.length)
    )
      continue;
    const key =
      rec.ticket || rec.transactionId || `${rec.user}|${rec.pageUrl}|${rec.completedAt}`;
    const prev = byKey.get(key);
    if (!prev || String(rec.completedAt || "") >= String(prev.completedAt || "")) {
      byKey.set(key, rec);
    }
  }
  return [...byKey.values()].sort((a, b) =>
    String(b.completedAt || "").localeCompare(String(a.completedAt || ""))
  );
}

async function loadCaptureLiveSummary() {
  const status = await getCaptureStatus();
  const from = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const events = readCaptureJsonl({ dateFrom: from });
  const persisted = await loadPersistedCaptureTransactions();
  const snapshot = loadSnapshotCaptureTransactions();
  let fromJsonl = [];
  try {
    fromJsonl = transactionsFromJsonl({ dateFrom: from });
  } catch {
    fromJsonl = [];
  }
  const byId = new Map();
  for (const txn of [...persisted, ...snapshot, ...fromJsonl, ...(status.transactions || [])]) {
    const id = txnKey(txn);
    if (!id) continue;
    byId.set(id, mergeTxn(byId.get(id), txn));
  }
  const transactions = [...byId.values()];
  const users = summarizeCaptureByUser({ transactions, events });
  return {
    ok: status.ok,
    recording: Boolean(status.recording),
    ready: status.ready !== false,
    error: status.error || "",
    generatedAt: new Date().toISOString(),
    users,
    transactions: listCaptureTransactionRecords(transactions),
  };
}

async function loadMergedCaptureTransactions(opts = {}) {
  const persisted = await loadPersistedCaptureTransactions();
  const snapshot = loadSnapshotCaptureTransactions();
  let fromJsonl = [];
  try {
    fromJsonl = transactionsFromJsonl();
  } catch {
    fromJsonl = [];
  }
  let live = [];
  if (opts.live !== false) {
    try {
      live = await fetchCaptureTransactions();
    } catch {
      live = [];
    }
  }
  const byId = new Map();
  for (const txn of [...persisted, ...snapshot, ...fromJsonl, ...live]) {
    const id = txnKey(txn);
    if (!id) continue;
    byId.set(id, mergeTxn(byId.get(id), txn));
  }
  return [...byId.values()];
}

function playwrightLocatorFromSopStep(step, value) {
  const action = String(step?.action || "fill").toLowerCase();
  const selector = String(step?.selector || "").trim();
  const label = String(step?.label || "").replace(/\*+$/, "").trim();
  const name = String(
    (Array.isArray(step?.findByText) && step.findByText[0]) || value || label
  ).trim();
  const locator = {};
  if (selector && !/^(button|input|a|div|span|label|select|textarea)$/i.test(selector)) {
    locator.css = selector;
  }
  if (action === "click") {
    locator.getByRole = { role: "button", name };
    locator.getByText = name;
  } else if (action === "check") {
    if (label) locator.getByLabel = label;
    if (name) locator.getByRole = { role: "radio", name };
  } else if (label) {
    locator.getByLabel = label;
  }
  return locator;
}

function playwrightScriptFromTxn(txn) {
  if (!txn) return null;
  const rec = captureTransactionRecord(txn);
  return {
    ticket: rec.ticket || null,
    startUrl: rec.playwright?.startUrl || rec.pageUrl || "",
    pageTitle: rec.pageTitle || "",
    clicks: (rec.clicks || []).map((c) =>
      require("./capture-step-shot").copyScreenshotMeta(c, {
        action: "click",
        label: c.label,
        selector: c.selector,
        locator: c.locator,
      })
    ),
    values: rec.values || {},
    playwright: rec.playwright || { startUrl: rec.pageUrl || "", pages: [], steps: [] },
  };
}

function choiceOnStep(step) {
  if (!Array.isArray(step?.allowedValues)) return "";
  return step.allowedValues.map((v) => String(v ?? "").trim()).find(Boolean) || "";
}

function playwrightScriptFromSop(sop, txn = null) {
  if (txn) return playwrightScriptFromTxn(txn);
  const steps = Array.isArray(sop?.steps) ? sop.steps : [];
  const values = sop?.sampleData && typeof sop.sampleData === "object" ? sop.sampleData : {};
  const startUrl = String(sop?.formUrl || "").trim();
  const clicks = [];
  const pwSteps = steps.map((step, i) => {
    const keyed = values[step.valueFrom || step.id];
    const value =
      choiceOnStep(step) ||
      (keyed != null && keyed !== "" && typeof keyed !== "object" ? String(keyed) : "") ||
      (step.value != null ? String(step.value).trim() : "");
    const action = String(step.action || "fill").toLowerCase();
    const row = {
      n: i + 1,
      action,
      label: String(step.label || step.id || "").trim(),
      selector: String(step.selector || "").trim(),
      value: String(value || ""),
      pageUrl: startUrl,
      locator: playwrightLocatorFromSopStep(step, value),
    };
    if (action === "click") {
      clicks.push(
        require("./capture-step-shot").copyScreenshotMeta(step, {
          action: "click",
          label: row.label,
          selector: row.selector,
          locator: row.locator,
        })
      );
    }
    require("./capture-step-shot").copyScreenshotMeta(step, row);
    return row;
  });
  return {
    ticket: sop?.ticket || null,
    startUrl,
    pageTitle: String(sop?.name || "").replace(/^Draft:\s*/i, ""),
    clicks,
    values,
    playwright: { startUrl, pages: startUrl ? [startUrl] : [], steps: pwSteps },
  };
}

function compactPlaywrightScript(script) {
  if (!script) return null;
  return {
    ticket: script.ticket || null,
    startUrl: script.startUrl || "",
    clicks: Array.isArray(script.clicks) ? script.clicks : [],
  };
}

function parseMaybeJson(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  const s = String(value ?? "").trim();
  if (!s || s.includes("[object Object]")) return null;
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  return null;
}

function playwrightStepsOf(script) {
  if (!script || typeof script !== "object") return [];
  const nested =
    script.playwright && Array.isArray(script.playwright.steps) ? script.playwright.steps : [];
  if (nested.length) return nested;
  return Array.isArray(script.steps) ? script.steps : [];
}

function cardHasAttachedPlaywright(card) {
  return playwrightStepsOf(card?.playwright).length > 0;
}

function shouldAutoRunCardPlaywright(card) {
  return cardHasAttachedPlaywright(card);
}

function slugStepId(label, action, index) {
  const slug = String(label || action || "step")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "step"}-${index + 1}`;
}

function valueKeyForPlayStep(step, index) {
  const from = String(step?.valueFrom || "").trim();
  if (from) return from;
  const label = String(step?.label || "").replace(/\*+$/, "").trim();
  if (label) return label;
  return slugStepId(step?.label, step?.action, index);
}

function locatorCss(locator, selector) {
  const css = String(locator?.css || selector || "").trim();
  return css;
}

function jobFieldSteps(step, startIndex) {
  const job = step?.job && typeof step.job === "object" ? step.job : {};
  const fields = [
    ["jobTitle", "Job Title", `[id$="--jobTitle"]`, "fill"],
    ["company", "Company", `[id$="--companyName"]`, "fill"],
    ["location", "Location", `[id$="--location"]`, "fill"],
    ["startMonth", "Start Month", `[id$="--startDate-dateSectionMonth-input"]`, "fill"],
    ["startYear", "Start Year", `[id$="--startDate-dateSectionYear-input"]`, "fill"],
    ["currentlyWorkHere", "Currently work here", `[id$="--currentlyWorkHere"]`, "check"],
    ["endMonth", "End Month", `[id$="--endDate-dateSectionMonth-input"]`, "fill"],
    ["endYear", "End Year", `[id$="--endDate-dateSectionYear-input"]`, "fill"],
    ["roleDescription", "Role Description", `[id$="--roleDescription"]`, "fill"],
  ];
  const out = [];
  let i = startIndex;
  for (const [key, label, css, action] of fields) {
    if (job[key] == null || job[key] === "") continue;
    if (key === "currentlyWorkHere" && !job[key]) continue;
    if ((key === "endMonth" || key === "endYear") && job.currentlyWorkHere) continue;
    out.push({
      raw: {
        action,
        label,
        value: job[key] === true ? "true" : String(job[key]),
        locator: { css, getByLabel: label },
        selector: css,
        pageUrl: step.pageUrl || "",
      },
      index: i,
    });
    i += 1;
  }
  return out;
}

function normalizePlayAction(action) {
  const a = String(action || "fill").toLowerCase();
  if (a === "typeahead" || a === "answer") return a;
  if (a === "answerremaining") return "click";
  if (a === "filljob") return "fill";
  return a;
}

/**
 * Convert a card-owned Playwright JSON into runnable SOP steps.
 * Locators stay on the step; values come from extraData then the script.
 */
function sopStepsFromPlaywright(script, extraData = {}) {
  const rows = playwrightStepsOf(script);
  const extra = extraData && typeof extraData === "object" && !Array.isArray(extraData) ? extraData : {};
  const expanded = [];
  for (const step of rows) {
    if (String(step?.action || "").toLowerCase() === "filljob") {
      expanded.push(...jobFieldSteps(step, expanded.length).map((x) => x.raw));
    } else {
      expanded.push(step);
    }
  }
  const startUrl = String(script?.startUrl || script?.playwright?.startUrl || extra.startUrl || "").trim();
  const values = { ...extra };
  if (script?.values && typeof script.values === "object") {
    for (const [k, v] of Object.entries(script.values)) {
      if (v == null || v === "" || typeof v === "object") continue;
      if (values[k] == null || values[k] === "") values[k] = v;
    }
  }

  const steps = expanded.map((step, i) => {
    const action = normalizePlayAction(step.action);
    const label = String(step.label || step.job?.jobTitle || action).trim();
    const locator =
      step.locator && typeof step.locator === "object" ? { ...step.locator } : {};
    const selector = locatorCss(locator, step.selector);
    const valueFrom = valueKeyForPlayStep(step, i);
    const ownChoice =
      choiceOnStep(step) ||
      (step?.value != null && step.value !== "" && typeof step.value !== "object"
        ? String(step.value).trim()
        : "");
    const keyed = extra[valueFrom] ?? extra[step.id] ?? values[valueFrom] ?? "";
    const keyedText =
      keyed != null && keyed !== "" && typeof keyed !== "object" ? String(keyed).trim() : "";
    // The value recorded on this step wins over a shared field-name key.
    const choice = ownChoice || keyedText;
    if (choice && (values[valueFrom] == null || values[valueFrom] === "")) {
      values[valueFrom] = choice;
    }
    const pageUrl = String(step.pageUrl || startUrl || "").trim();
    const nextUrl = String(expanded[i + 1]?.pageUrl || "").trim();
    const waitAfter =
      step.waitAfter && typeof step.waitAfter === "object"
        ? { ...step.waitAfter }
        : nextUrl && pageUrl && nextUrl !== pageUrl
          ? { urlIncludes: nextUrl }
          : undefined;
    const row = {
      id: String(step.id || slugStepId(label, action, i)),
      action,
      label,
      selector,
      locator,
      valueFrom,
      pageUrl,
    };
    if (choice && /^(fill|check|select|answer|typeahead)$/.test(action)) {
      row.allowedValues = [choice];
      row.value = choice;
    }
    if (step.option) row.option = step.option;
    if (step.kind) row.kind = step.kind;
    if (step.section) row.section = step.section;
    if (waitAfter) row.waitAfter = waitAfter;
    require("./capture-step-shot").copyScreenshotMeta(step, row);
    return row;
  });
  return { steps, values, startUrl };
}

function playwrightCaseData(script, extra = {}) {
  const compact = compactPlaywrightScript(script) || { ticket: null, startUrl: "", clicks: [] };
  const src = extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {};
  const existingClicks = Array.isArray(src.clicks) ? src.clicks : parseMaybeJson(src.clicks);
  const clicks =
    compact.clicks && compact.clicks.length
      ? compact.clicks
      : Array.isArray(existingClicks)
        ? existingClicks
        : [];
  const out = {
    ticket: compact.ticket || src.ticket || null,
    startUrl: compact.startUrl || src.startUrl || "",
    clicks,
  };
  const skip = new Set(["ticket", "startUrl", "clicks", "playwright", "values"]);
  for (const [k, v] of Object.entries(src)) {
    if (skip.has(k) || v == null || v === "") continue;
    if (typeof v === "object") continue;
    out[k] = v;
  }
  if (src.values && typeof src.values === "object" && !Array.isArray(src.values)) {
    for (const [k, v] of Object.entries(src.values)) {
      if (skip.has(k) || v == null || v === "") continue;
      if (out[k] == null || out[k] === "") out[k] = v;
    }
  }
  if (script?.values && typeof script.values === "object") {
    for (const [k, v] of Object.entries(script.values)) {
      if (skip.has(k) || v == null || v === "") continue;
      if (out[k] == null || out[k] === "") out[k] = v;
    }
  }
  return out;
}

function findCaptureTxnForCard(card, txns) {
  const cid = String(card?.id || card?.cardId || "").trim();
  const url = String(card?.formUrl || "").trim();
  let best = null;
  let bestScore = 0;
  for (const txn of txns || []) {
    const payload = payloadOf(txn);
    let score = 0;
    const pc = String(payload.cardId || txn.cardId || "").trim();
    if (cid && pc && cid === pc) score += 50;
    const turl = String(txn.pageUrl || payload.url || "").trim();
    score += pageUrlMatchScore(turl, url);
    if (score > bestScore) {
      bestScore = score;
      best = txn;
    }
  }
  return bestScore >= 8 ? best : null;
}

function findCaptureTxnForSop(sop, txns) {
  const sid = String(sop?.id || "").trim();
  const rec = String(sop?.recordingSessionId || "").trim();
  const url = String(sop?.formUrl || "").trim();
  let best = null;
  let bestScore = 0;
  for (const txn of txns || []) {
    const payload = payloadOf(txn);
    let score = 0;
    const tid = String(txn.transactionId || payload.recordingSessionId || "").trim();
    if (rec && tid && rec === tid) score += 50;
    const draft = String(payload.draftSopId || txn.draftSopId || "").trim();
    if (sid && draft && sid === draft) score += 50;
    const turl = String(txn.pageUrl || payload.url || "").trim();
    score += pageUrlMatchScore(turl, url);
    if (score > bestScore) {
      bestScore = score;
      best = txn;
    }
  }
  return bestScore >= 8 ? best : null;
}

module.exports = {
  captureBaseUrl,
  defaultCaptureDataDir,
  stepUpdateToCaptureEvent,
  forwardCaptureEvent,
  proxyCapture,
  readCaptureJsonl,
  loadCaptureExamples,
  fetchCaptureTransactions,
  setCaptureRecording,
  startCaptureRecording,
  getCaptureStatus,
  persistCaptureTransactions,
  loadPersistedCaptureTransactions,
  applyTxnPatch,
  mergeLiveAndPersistedTransactions,
  transactionsFromJsonl,
  captureEventsDir,
  captureTransactionsToDashRows,
  loadCaptureDashRows,
  cleanCaptureDisplayPairs,
  resolveCaptureTicket,
  ticketOf,
  valuesOf,
  payloadOf,
  clicksOf,
  stepsOf,
  playwrightFromTxn,
  enrichTxnWithPlaywright,
  captureMatchScore,
  pageUrlMatchScore,
  findLatestCaptureActivity,
  findSimilarCaptures,
  formatCaptureHistoryBlock,
  matchConfidencePercent,
  confidenceLabel,
  truncateExampleValue,
  captureActivityFromTxn,
  userOf,
  localUsername,
  summarizeCaptureByUser,
  captureTransactionRecord,
  listCaptureTransactionRecords,
  loadCaptureLiveSummary,
  loadMergedCaptureTransactions,
  playwrightScriptFromTxn,
  playwrightScriptFromSop,
  compactPlaywrightScript,
  playwrightCaseData,
  playwrightStepsOf,
  cardHasAttachedPlaywright,
  shouldAutoRunCardPlaywright,
  sopStepsFromPlaywright,
  findCaptureTxnForSop,
  findCaptureTxnForCard,
  CAPTURE_PORT,
};
