/**
 * Jira Cloud client + urgency scoring for liveAct.
 * Auth: email + API token (Basic) against REST API v3.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const { File } = require("buffer");
const { defaultJiraActionsPath, migrateLegacyDocumentsCoact } = require("./documents");
const { sanitizeJqlPhrase } = require("./past-work-ai");
const { snowNumberQuery, snowNumberInQuery } = require("./servicenow-search");

const STATUS_WEIGHTS = {
  "to do": 1,
  open: 1,
  backlog: 0.8,
  "in progress": 1.5,
  "in review": 2,
  review: 2,
  "code review": 2,
  "peer review": 2,
  blocked: 2.5,
  done: 0.1,
  closed: 0.1,
  resolved: 0.1,
};

const PRIORITY_WEIGHTS = {
  highest: 3,
  blocker: 3,
  critical: 2.8,
  high: 2,
  medium: 1,
  low: 0.5,
  lowest: 0.25,
  trivial: 0.25,
};

const DEFAULT_STATUS_MAP = {
  "To Do": "Step 1 – Intake",
  Open: "Step 1 – Intake",
  "In Progress": "Step 2 – Working",
  "In Review": "Step 3 – Review",
  Done: "Step 4 – Complete",
  Blocked: "Blocked",
};

function jiraActionsPath() {
  migrateLegacyDocumentsCoact();
  return defaultJiraActionsPath();
}

function daysSince(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24));
}

function statusWeight(name) {
  const key = String(name || "")
    .trim()
    .toLowerCase();
  if (!key) return 1;
  if (STATUS_WEIGHTS[key] != null) return STATUS_WEIGHTS[key];
  if (key.includes("progress")) return 1.5;
  if (key.includes("review")) return 2;
  if (key.includes("block")) return 2.5;
  if (key.includes("done") || key.includes("close")) return 0.1;
  return 1;
}

function priorityWeight(name) {
  const key = String(name || "")
    .trim()
    .toLowerCase();
  return PRIORITY_WEIGHTS[key] != null ? PRIORITY_WEIGHTS[key] : 1;
}

function scoreIssue(fields) {
  const days = daysSince(fields?.updated);
  const sw = statusWeight(fields?.status?.name);
  const pw = priorityWeight(fields?.priority?.name);
  const score = Math.round(days * sw * pw * 10) / 10;
  return { days, score, statusWeight: sw, priorityWeight: pw };
}

function issueBrowseUrl(baseUrl, key) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  return `${root}/browse/${key}`;
}

function normalizeStatusMap(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = String(k || "").trim();
      const val = String(v || "").trim();
      if (key && val) out[key] = val;
    }
    if (Object.keys(out).length) return out;
  }
  return { ...DEFAULT_STATUS_MAP };
}

function mapSopStage(statusName, statusMap) {
  const map = normalizeStatusMap(statusMap);
  const name = String(statusName || "").trim();
  if (!name) return "—";
  if (map[name]) return map[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (k.toLowerCase() === lower) return v;
  }
  return name;
}

/**
 * Strip common "open only" status filters so Done/Closed still appear for sync + demo.
 * Keeps assignee = currentUser() and ORDER BY.
 */
function stripDoneExclusionsFromJql(jql) {
  let s = String(jql || "").trim();
  if (!s) return s;
  // status != Done / status != "Done" / status !== Done
  s = s.replace(
    /\s*(AND|OR)?\s*status\s*!=\s*"?(Done|Closed|Resolved|Complete|Completed)"?/gi,
    ""
  );
  // status not in (Done, Closed, …)
  s = s.replace(
    /\s*(AND|OR)?\s*status\s+not\s+in\s*\([^)]*\)/gi,
    ""
  );
  // statusCategory != Done / statusCategory != "Done"
  s = s.replace(
    /\s*(AND|OR)?\s*statusCategory\s*!=\s*"?Done"?/gi,
    ""
  );
  // statusCategory != Done equivalent: statusCategory = "To Do" OR … — leave alone
  s = s.replace(/(?<!currentUser)\(\s*\)/gi, "");
  s = s.replace(/\bAND\s+AND\b/gi, "AND");
  s = s.replace(/\bOR\s+OR\b/gi, "OR");
  s = s.replace(/\bAND\s+ORDER\b/gi, "ORDER");
  s = s.replace(/\bOR\s+ORDER\b/gi, "ORDER");
  s = s.replace(/^\s*(AND|OR)\s+/i, "");
  s = s.replace(/\s+(AND|OR)\s*$/i, "");
  return s.replace(/\s{2,}/g, " ").trim();
}

function collapseNestedAssigneeJql(jql) {
  const raw = String(jql || "").trim();
  if (!raw) return raw;
  const orderMatch = raw.match(/\s+(ORDER\s+BY\s+.+)$/i);
  const order = orderMatch ? orderMatch[1] : "ORDER BY updated ASC";
  const core = (orderMatch ? raw.slice(0, orderMatch.index) : raw).trim();
  const stripped = core.replace(/[()]/g, " ").replace(/\bAND\b/gi, " ").replace(/\s+/g, " ").trim();
  if (/^(assignee\s*=\s*currentUser(?:\s*\(\s*\))?\s*)+$/i.test(`${stripped} `)) {
    return `assignee = currentUser() ${order}`.trim();
  }
  return raw;
}

function ensureAssigneeOnlyJql(jql) {
  const raw = collapseNestedAssigneeJql(stripDoneExclusionsFromJql(String(jql || "").trim()));
  const defaultJql = "assignee = currentUser() ORDER BY updated ASC";
  if (!raw) return defaultJql;
  if (/\bassignee\s*=\s*currentUser/i.test(raw)) return collapseNestedAssigneeJql(raw);
  // Force assigned-to-me even if user cleared/changed the assignee clause
  const withoutOrder = raw.replace(/\s+ORDER\s+BY\s+.+$/i, "").trim();
  const orderMatch = raw.match(/\s+(ORDER\s+BY\s+.+)$/i);
  const order = orderMatch ? orderMatch[1] : "ORDER BY updated ASC";
  const core = withoutOrder
    ? `assignee = currentUser() AND (${withoutOrder})`
    : "assignee = currentUser()";
  return `${core} ${order}`.trim();
}

/** Cloud / local-mock Site URL must be the API origin so we hit /rest/api/3/search/jql, not HTML. */
function originFromJiraSiteUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProto);
    const host = u.hostname.toLowerCase();
    if (
      host.endsWith(".atlassian.net") ||
      host === "atlassian.net" ||
      host === "127.0.0.1" ||
      host === "localhost"
    ) {
      return `${u.protocol}//${u.host}`;
    }
    let pathName = String(u.pathname || "").replace(/\/+$/, "");
    pathName = pathName.replace(/\/browse\/.*$/i, "");
    pathName = pathName.replace(/\/jira\/(software|servicedesk|core)\/.*$/i, "");
    return `${u.protocol}//${u.host}${pathName}`.replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

/**
 * Strip BOM, wrapping quotes, Bearer prefix, and newlines from pasted email/API tokens.
 * Atlassian tokens copied from JSON or docs often arrive as `"ATATT…"` or `Bearer ATATT…`.
 */
function sanitizeJiraSecret(value) {
  let s = String(value ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  s = s.replace(/^Bearer\s+/i, "").trim();
  for (let i = 0; i < 4; i++) {
    const q = s[0];
    if ((q === '"' || q === "'") && s.length >= 2 && s[s.length - 1] === q) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return s.replace(/^Bearer\s+/i, "").replace(/[\r\n]+/g, "").trim();
}

function logJiraAuth(c, extra = {}) {
  const tokenLen = String(c?.apiToken || "").length;
  console.log("[livetrack] jira auth", {
    hasToken: tokenLen > 0,
    tokenLen,
    hasEmail: Boolean(c?.email),
    host: c?.baseUrl || "",
    ...extra,
  });
}

function isAtlassianCloudHost(baseUrl) {
  try {
    return new URL(String(baseUrl || "")).hostname.toLowerCase().endsWith(".atlassian.net");
  } catch {
    return false;
  }
}

function stripJiraCookieHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (/^cookie$/i.test(key) || /^set-cookie$/i.test(key) || /^credentials$/i.test(key)) continue;
    if (value == null || value === "") continue;
    out[key] = value;
  }
  return out;
}

function incomingToFetchHeaders(nodeHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders || {})) {
    if (value == null || /^set-cookie$/i.test(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, String(item));
    } else {
      headers.set(key, String(value));
    }
  }
  return headers;
}

async function serializeJiraBody(init, headers) {
  const body = init?.body;
  if (body == null || body === "") return { headers, buffer: null };
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    delete headers["Content-Type"];
    delete headers["content-type"];
    const boundary = `----LiveTrackFormBoundary${process.hrtime.bigint()}`;
    const chunks = [];
    for (const [name, value] of body.entries()) {
      chunks.push(Buffer.from(`--${boundary}\r\n`, "utf8"));
      if (typeof value === "string") {
        chunks.push(
          Buffer.from(
            `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
            "utf8"
          )
        );
      } else {
        const filename = String(value.name || "file").replace(/["\r\n]/g, "_");
        const type = value.type || "application/octet-stream";
        chunks.push(
          Buffer.from(
            `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
            "utf8"
          )
        );
        chunks.push(Buffer.from(await value.arrayBuffer()));
        chunks.push(Buffer.from("\r\n", "utf8"));
      }
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
    headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
    return { headers, buffer: Buffer.concat(chunks) };
  }
  if (Buffer.isBuffer(body)) return { headers, buffer: body };
  if (body instanceof Uint8Array) return { headers, buffer: Buffer.from(body) };
  if (typeof body === "string") return { headers, buffer: Buffer.from(body, "utf8") };
  return { headers, buffer: Buffer.from(String(body), "utf8") };
}

/**
 * Cookie-free Jira HTTP via Node http/https — never Chromium session cookies.
 * Classic Atlassian XSRF fires when Basic auth is sent together with browser Atlassian cookies.
 */
async function jiraNodeFetch(url, init = {}, redirectCount = 0) {
  const { headers: rawHeaders, buffer } = await serializeJiraBody(init, {
    ...(init.headers || {}),
  });
  const headers = stripJiraCookieHeaders(rawHeaders);
  if (buffer) headers["Content-Length"] = String(buffer.length);

  const u = new URL(String(url));
  const lib = u.protocol === "https:" ? https : http;
  const method = String(init.method || "GET").toUpperCase() || "GET";

  const timeoutMs = Math.max(1000, Number(init.timeout) || 8000);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method,
        headers,
      },
      (res) => {
        const status = Number(res.statusCode) || 0;
        const location = res.headers?.location;
        if (location && status >= 301 && status <= 308 && redirectCount < 4) {
          res.resume();
          const nextUrl = new URL(String(location), u).toString();
          const nextInit =
            (status === 301 || status === 302 || status === 303) && method !== "GET" && method !== "HEAD"
              ? { ...init, method: "GET", body: undefined }
              : init;
          jiraNodeFetch(nextUrl, nextInit, redirectCount + 1).then(
            (value) => finish(resolve, value),
            (err) => finish(reject, err)
          );
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          finish(
            resolve,
            new Response(Buffer.concat(chunks), {
              status: status || 502,
              statusText: res.statusMessage || "",
              headers: incomingToFetchHeaders(res.headers),
            })
          );
        });
        res.on("error", (err) => finish(reject, err));
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(reject, new Error("Jira request timed out"));
    });
    req.on("error", (err) => finish(reject, err));
    if (buffer) req.write(buffer);
    req.end();
  });
}

/**
 * Node tests stub globalThis.fetch. Electron Chromium/session fetch shares
 * session.defaultSession cookies and Classic Jira returns XSRF 403 on POST.
 */
function resolveJiraFetch() {
  if (process.versions.electron) return jiraNodeFetch;
  return globalThis.fetch.bind(globalThis);
}

async function resolveCloudApiBase(siteOrigin, headers) {
  const origin = String(siteOrigin || "").replace(/\/+$/, "");
  if (!origin || !isAtlassianCloudHost(origin)) return "";
  try {
    const res = await resolveJiraFetch()(`${origin}/_edge/tenant_info`, {
      method: "GET",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        "X-Atlassian-Token": "no-check",
        ...(headers || {}),
      },
    });
    const text = await res.text();
    const data = JSON.parse(text);
    const id = String(data?.cloudId || data?.cloudid || "").trim();
    return id ? `https://api.atlassian.com/ex/jira/${id}` : "";
  } catch {
    return "";
  }
}

function withGatewayOrigin(url, siteOrigin, gatewayBase) {
  const from = String(siteOrigin || "").replace(/\/+$/, "");
  const to = String(gatewayBase || "").replace(/\/+$/, "");
  const raw = String(url || "");
  if (!from || !to || !raw.startsWith(from)) return raw;
  return `${to}${raw.slice(from.length)}`;
}

/**
 * All Jira REST calls: Basic auth, JSON Accept, no cookies.
 * Electron uses Node https (jiraNodeFetch) so Atlassian session cookies never attach.
 * On Cloud 401, retry once via api.atlassian.com/ex/jira/{cloudId} (scoped API tokens).
 */
async function jiraFetch(c, urlOrPath, init = {}) {
  const fetchImpl = resolveJiraFetch();
  const site = String(c.baseUrl || "").replace(/\/+$/, "");
  const raw = String(urlOrPath || "");
  const url = /^https?:\/\//i.test(raw) ? raw : `${site}${raw.startsWith("/") ? raw : `/${raw}`}`;
  const { forceRefresh = false, timeout, ...rest } = init;
  const headers = stripJiraCookieHeaders({ ...authHeaders(c), ...(rest.headers || {}) });
  headers["X-Atlassian-Token"] = "no-check";
  if (forceRefresh) {
    headers["Cache-Control"] = "no-cache, no-store";
    headers["Pragma"] = "no-cache";
  }
  if (rest.body && typeof FormData !== "undefined" && rest.body instanceof FormData) {
    delete headers["Content-Type"];
  }
  const attempt = (target) => {
    const opts = {
      ...rest,
      headers,
      credentials: "omit",
    };
    if (fetchImpl === jiraNodeFetch) {
      opts.timeout = Number(timeout) > 0 ? Number(timeout) : 8000;
    }
    return fetchImpl(target, opts);
  };

  let res = await attempt(url);
  if (
    (Number(res?.status) === 401 || Number(res?.status) === 403) &&
    isAtlassianCloudHost(site) &&
    !/api\.atlassian\.com/i.test(url)
  ) {
    logJiraAuth(c, { event: "cloud-401-retry-gateway", httpStatus: res.status });
    const gateway = await resolveCloudApiBase(site, headers);
    if (gateway) {
      res = await attempt(withGatewayOrigin(url, site, gateway));
    }
  }
  return res;
}

function missingAuthError(config) {
  const c = normalizeConfig(config);
  if (!c.apiToken) return "API token is missing in Settings.";
  if (!c.email) return "Jira email is missing in Settings.";
  if (!c.baseUrl) return "Jira site URL is missing in Settings.";
  return "";
}

function normalizeConfig(raw) {
  return {
    baseUrl: originFromJiraSiteUrl(raw?.jiraBaseUrl || raw?.baseUrl || ""),
    email: sanitizeJiraSecret(raw?.jiraEmail || raw?.email || ""),
    apiToken: sanitizeJiraSecret(raw?.jiraApiToken || raw?.apiToken || ""),
    jql: ensureAssigneeOnlyJql(
      raw?.jiraJql || raw?.jql || "assignee = currentUser() ORDER BY updated ASC"
    ),
    staleDays: Math.max(0.5, Number(raw?.jiraStaleDays ?? raw?.staleDays ?? 2) || 2),
    pollMinutes: Math.max(1, Number(raw?.jiraPollMinutes ?? raw?.pollMinutes ?? 5) || 5),
    statusMap: normalizeStatusMap(raw?.jiraStatusMap ?? raw?.statusMap),
    cardKeyField: String(raw?.jiraCardKeyField || raw?.cardKeyField || "jiraKey").trim() || "jiraKey",
    projectKey: normalizeProjectRef(raw?.jiraProjectKey || raw?.projectKey, "LIVEACT"),
  };
}

function looksLikeJiraProjectKey(value) {
  const v = String(value || "").trim();
  return Boolean(v) && !/\s/.test(v) && /^[A-Za-z][A-Za-z0-9_]*$/.test(v);
}

/** Keys like MBA are uppercased; space names like "MOBILE BANKING APP" are kept for name match. */
function normalizeProjectRef(raw, fallback = "LIVEACT") {
  const v = String(raw || "").trim();
  if (!v) return fallback;
  if (looksLikeJiraProjectKey(v)) return v.toUpperCase();
  return v;
}

function isConfigured(config) {
  const c = normalizeConfig(config);
  return Boolean(c.baseUrl && c.email && c.apiToken);
}

function authHeader(email, apiToken) {
  const user = sanitizeJiraSecret(email);
  const token = sanitizeJiraSecret(apiToken);
  return `Basic ${Buffer.from(`${user}:${token}`, "utf8").toString("base64")}`;
}

/**
 * Jira REST headers: Basic auth, JSON Accept, and Classic XSRF bypass.
 * Writes (and POST search fallback) require X-Atlassian-Token: no-check and no Cookie.
 */
function authHeaders(c) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: authHeader(c.email, c.apiToken),
    "X-Atlassian-Token": "no-check",
  };
}

function looksLikeHtmlBody(text) {
  const s = String(text || "")
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (!s) return false;
  return s.startsWith("<") || /^<!doctype/i.test(s);
}

function explainJiraHtmlBody(text, { baseUrl, httpStatus, pathname } = {}) {
  const origin = String(baseUrl || "").replace(/\/+$/, "");
  let host = "";
  let port = 0;
  try {
    const u = new URL(origin);
    host = u.hostname.toLowerCase();
    port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  } catch {
    /* ignore */
  }
  const pathHint = pathname ? ` (${pathname})` : "";
  if (host === "127.0.0.1" || host === "localhost") {
    if (port === 4175) {
      return [
        "Jira returned HTML from the LiveTrack dashboard at http://127.0.0.1:4175, not the REST API.",
        "Set Site URL to https://your-domain.atlassian.net (Cloud) or http://127.0.0.1:4176 (local mock).",
        "Do not use the dashboard port.",
      ].join(" ");
    }
    if (port === 4176) {
      return [
        "Local Jira mock returned an HTML page instead of JSON.",
        "Site URL must be the API origin http://127.0.0.1:4176 with no /browse path.",
        "LiveTrack calls GET /rest/api/3/search/jql — that path must return JSON, not the dashboard HTML at /.",
      ].join(" ");
    }
    return `Got HTML instead of Jira JSON from ${origin}${pathHint}. Use http://127.0.0.1:4176 for the local mock, or https://your-domain.atlassian.net for Cloud.`;
  }
  const snippet = String(text || "")
    .slice(0, 400)
    .toLowerCase();
  const loginish = /log\s*in|sign in|atlassian account|id\.atlassian/.test(snippet);
  // Site URL / HTML hints are for successful HTML pages (wrong host or login page), not 401/403.
  if (Number(httpStatus) === 200 && loginish) {
    return [
      `Jira returned a login/HTML page instead of JSON from ${origin}${pathHint}.`,
      "Use the Cloud site origin (https://your-domain.atlassian.net), not a board, /browse, or login URL.",
    ].join(" ");
  }
  if (Number(httpStatus) === 200) {
    return [
      `Jira returned HTML instead of JSON from ${origin}${pathHint}.`,
      "Site URL should be https://your-domain.atlassian.net with no /jira, /browse, or board path.",
      "HTML usually means a login page, 404 page, or the wrong host (dashboard vs REST).",
    ].join(" ");
  }
  return `Jira returned HTML instead of JSON (HTTP ${httpStatus || "error"}) from ${origin}${pathHint}.`;
}

/**
 * Parse a Jira HTTP body as JSON only after checking Content-Type / peeking for HTML.
 * Never throws SyntaxError.
 */
async function parseJiraHttpResponse(res, { baseUrl, pathname } = {}) {
  const httpStatus = Number(res?.status) || 0;
  const contentType = String(res?.headers?.get?.("content-type") || "").toLowerCase();
  let text = "";
  try {
    text = await res.text();
  } catch (err) {
    return {
      parseOk: false,
      html: false,
      data: null,
      httpStatus,
      error: err?.message || "Could not read Jira response",
    };
  }
  const trimmed = String(text || "").trim();
  const html = looksLikeHtmlBody(text) || contentType.includes("text/html");
  // Atlassian 401/403 is often plaintext ("Client must be authenticated…"), not JSON.
  if (httpStatus === 401 || httpStatus === 403) {
    let detail = "";
    if (trimmed && !html) {
      try {
        detail = parseJiraErrorBody(JSON.parse(trimmed));
      } catch {
        detail = trimmed.slice(0, 240);
      }
    }
    return {
      parseOk: false,
      html,
      data: null,
      httpStatus,
      error: formatJiraHttpError(httpStatus, detail, "auth"),
    };
  }
  if (html) {
    return {
      parseOk: false,
      html: true,
      data: null,
      httpStatus,
      error: explainJiraHtmlBody(text, { baseUrl, httpStatus, pathname }),
    };
  }
  if (!trimmed) {
    return { parseOk: true, html: false, data: {}, httpStatus, error: null };
  }
  if (
    contentType &&
    !contentType.includes("json") &&
    !trimmed.startsWith("{") &&
    !trimmed.startsWith("[")
  ) {
    return {
      parseOk: false,
      html: false,
      data: null,
      httpStatus,
      error: `Jira response was not JSON (${contentType || "unknown type"}) from ${baseUrl || "the site URL"}. Use https://your-domain.atlassian.net or http://127.0.0.1:4176.`,
    };
  }
  try {
    return { parseOk: true, html: false, data: JSON.parse(trimmed), httpStatus, error: null };
  } catch (err) {
    return {
      parseOk: false,
      html: looksLikeHtmlBody(text),
      data: null,
      httpStatus,
      error: looksLikeHtmlBody(text)
        ? explainJiraHtmlBody(text, { baseUrl, httpStatus, pathname })
        : `Jira response was not JSON (${err?.message || "parse error"}). Check Site URL ${baseUrl || ""}.`,
    };
  }
}

function parseJiraErrorBody(body) {
  if (!body || typeof body !== "object") return "";
  const messages = [];
  if (Array.isArray(body.errorMessages)) messages.push(...body.errorMessages.map(String));
  if (body.errors && typeof body.errors === "object") {
    for (const [key, value] of Object.entries(body.errors)) {
      messages.push(`${key}: ${value}`);
    }
  }
  if (body.message) messages.push(String(body.message));
  return messages.filter(Boolean).join("; ");
}

function looksLikeXsrfFailure(detail) {
  return /xsrf/i.test(String(detail || ""));
}

function formatJiraHttpError(status, detail, kind = "write") {
  const code = Number(status) || 0;
  const extra = String(detail || "").trim();
  if (code === 401) {
    return [
      "Jira 401: email or API token was rejected.",
      "Check the Atlassian account email and an API token (not the account password).",
      "Create a token at https://id.atlassian.com/manage-profile/security/api-tokens.",
      "Basic auth is email:apiToken encoded as base64.",
      extra,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (code === 403) {
    if (looksLikeXsrfFailure(extra)) {
      return [
        "Jira 403: XSRF check failed.",
        "Classic Atlassian POST needs header X-Atlassian-Token: no-check and must not send Atlassian session cookies (Node HTTPS, no cookie jar).",
        extra,
      ]
        .filter(Boolean)
        .join(" ");
    }
    if (kind === "auth") {
      return [
        "Jira 403: this account cannot access that site.",
        "Check the site URL, email, and API token (API key).",
        extra,
      ]
        .filter(Boolean)
        .join(" ");
    }
    return [
      "Jira 403: this account cannot create or attach on that site/project.",
      "Check the project key and Create Issues / Attachments permissions.",
      extra,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (code === 400) {
    return extra
      ? `Jira 400: the ticket payload was rejected — ${extra}`
      : "Jira 400: the ticket payload was rejected. Check project key and issue type.";
  }
  return `Jira ${code || "error"}${extra ? `: ${extra}` : ""}`;
}

function pushAttrText(parts, value) {
  const text = String(value || "").trim();
  if (text) parts.push(` ${text} `);
}

function jiraAdfToText(adf) {
  if (typeof adf === "string") return adf;
  if (!adf || typeof adf !== "object") return "";
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object") return;
    if (node.type === "text" && node.text) parts.push(node.text);
    if (node.type === "hardBreak") parts.push("\n");
    if (node.type === "mention") {
      pushAttrText(parts, node.attrs?.text || node.attrs?.displayName);
    }
    const attrs = node.attrs || {};
    pushAttrText(parts, attrs.url);
    pushAttrText(parts, attrs.href);
    pushAttrText(parts, attrs.title);
    pushAttrText(parts, attrs.filename);
    pushAttrText(parts, attrs.alt);
    pushAttrText(parts, attrs.text);
    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        pushAttrText(parts, mark?.attrs?.href);
        pushAttrText(parts, mark?.attrs?.url);
        pushAttrText(parts, mark?.attrs?.title);
        pushAttrText(parts, mark?.attrs?.id);
      }
    }
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
      if (node.type === "paragraph" || node.type === "heading") parts.push("\n");
    }
  };
  walk(adf);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

const TICKET_PREFIX =
  "RITM|INC|CHG|CRQ|SCTASK|STASK|PRB|CTASK|PTASK|KB|REQ|RFC|INT|WO|CALL|TASK|CR";
const SNOW_TICKET_RE = new RegExp(
  `(?<![A-Z0-9])((?:${TICKET_PREFIX})[\\s.\\-#]*\\d{2,})(?![0-9])`,
  "gi"
);
const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
const SCTASK_ALIAS_RE = /\bstask[\s.\-#]*(\d{5,})/gi;
const CHG_SEVEN_RE = /\bchg[\s.\-#]*(\d{7})\b/gi;

function canonicalTicketPrefix(prefix) {
  const up = String(prefix || "").toUpperCase();
  if (up === "STASK") return "SCTASK";
  return up;
}

function normalizeScrapedTicketKey(raw) {
  const compact = String(raw || "")
    .toUpperCase()
    .replace(/[\s.#]+/g, "");
  const snow = compact.match(
    new RegExp(`^(${TICKET_PREFIX})-?(\\d+)$`, "i")
  );
  if (snow) {
    return `${canonicalTicketPrefix(snow[1])}${snow[2]}`;
  }
  return compact;
}

function isJiraIssueKey(key) {
  return /^[A-Z][A-Z0-9]{1,9}-\d+$/i.test(String(key || "").trim());
}

function isOpsTicketKey(key) {
  const up = normalizeScrapedTicketKey(key);
  if (!up || isJiraIssueKey(up)) return false;
  return new RegExp(`^(?:${TICKET_PREFIX})\\d+$`).test(up);
}

function ticketKindLabel(key) {
  const raw = String(key || "").trim();
  const up = normalizeScrapedTicketKey(raw);
  if (isJiraIssueKey(raw) || isJiraIssueKey(up)) return "Jira issue";
  const prefix = canonicalTicketPrefix((up.match(/^([A-Z]+)\d+$/) || [])[1] || "");
  const labels = {
    RITM: "request",
    REQ: "request",
    INC: "incident",
    CHG: "change",
    CRQ: "change request",
    CR: "change request",
    RFC: "change",
    SCTASK: "catalog task",
    STASK: "catalog task",
    PRB: "problem",
    CTASK: "change task",
    PTASK: "problem task",
    KB: "knowledge article",
    INT: "interaction",
    WO: "work order",
    CALL: "call",
    TASK: "task",
  };
  return labels[prefix] || "ticket";
}

function ticketLookupQuery(key) {
  const raw = String(key || "").trim();
  const up = normalizeScrapedTicketKey(raw);
  if (isJiraIssueKey(raw)) return `key = ${raw.toUpperCase()}`;
  if (isJiraIssueKey(up)) return `key = ${up}`;
  if (isOpsTicketKey(up)) return snowNumberQuery(up);
  return "";
}

function ticketMentionRegex(key) {
  const up = normalizeScrapedTicketKey(key);
  const snow = up.match(/^([A-Z]+)(\d+)$/);
  if (snow && !isJiraIssueKey(up)) {
    const prefix = snow[1] === "SCTASK" ? "(?:SCTASK|STASK)" : snow[1];
    return new RegExp(`\\b${prefix}[\\s.\\-#]*${snow[2]}\\b`, "i");
  }
  const escaped = String(key || up).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

function sameParentText(snippet, parent) {
  const a = String(snippet || "").replace(/\s+/g, " ").trim();
  const b = String(parent || "").replace(/\s+/g, " ").trim();
  if (!a || !b) return false;
  return a === b;
}

const WEAK_TICKET_SNIPPETS = new Set([
  "completed the task",
  "complete the task",
  "completed",
  "please close",
  "please close this",
  "please close this ticket",
  "please close the ticket",
  "kindly close",
  "request",
  "change",
  "change request",
  "catalog task",
  "incident",
  "ticket",
  "done",
  "closed",
  "resolved",
  "thanks",
  "thank you",
  "see above",
  "see below",
  "as requested",
  "as discussed",
]);

const LEADING_TICKET_BOILERPLATE_RE =
  /^(please\s+close(?:\s+this(?:\s+(?:ticket|request|item))?)?|kindly\s+close|completed?\s+the\s+task)\b[\s,.:;–—-]*/i;

const COMMENT_TICKETS_HEADING = "Comment tickets:";

function stripCommentTicketsBundle(description) {
  const text = String(description || "").replace(/\r\n/g, "\n");
  const idx = text.search(/Comment tickets:\s*/i);
  if (idx >= 0) return text.slice(0, idx).trim();
  return text.trim();
}

function isWeakTicketSnippet(snippet, { parentSummary = "", parentDescription = "" } = {}) {
  const s = String(snippet || "").replace(/\s+/g, " ").trim();
  if (!s) return true;
  if (sameParentText(s, parentSummary) || sameParentText(s, parentDescription)) return true;
  const compact = s.replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (WEAK_TICKET_SNIPPETS.has(compact)) return true;
  if (/^(request|change|change request|catalog task|incident|ticket)(\s+[—\-].*)?$/i.test(s)) return true;
  const withoutIds = s
    .replace(/\b(?:RITM|INC|CHG|CRQ|SCTASK|STASK|PRB|CTASK|PTASK|KB|REQ|RFC|INT|WO|CALL|TASK|CR)\s*\d+\b/gi, " ")
    .replace(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g, " ")
    .replace(/\bnumber\s*=\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutIds) return true;
  if (withoutIds.length < 12 && /^(also|and|see|for|the|a|an|this|that|with|via)[\s.]*$/i.test(withoutIds)) {
    return true;
  }
  const words = withoutIds.replace(/[.,!?]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length <= 2 && withoutIds.replace(/[.,!?]/g, "").trim().length < 14) return true;
  return false;
}

function tidyTicketSnippet(snippet, key, { parentSummary = "", parentDescription = "" } = {}) {
  let text = String(snippet || "");
  if (key) text = text.replace(ticketMentionRegex(key), " ");
  text = text.replace(
    /\b(?:RITM|INC|CHG|CRQ|SCTASK|STASK|PRB|CTASK|PTASK|KB|REQ|RFC|INT|WO|CALL|TASK|CR)[\s.\-#]*\d+\b/gi,
    " "
  );
  text = text.replace(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g, " ");
  text = text.replace(/\bnumber\s*=\s*[A-Z0-9-]+/gi, " ");
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(LEADING_TICKET_BOILERPLATE_RE, "").trim();
  text = text.replace(/^[\s:;,\-–—|/]+|[\s:;,\-–—|/]+$/g, "").trim();
  text = text.replace(/\b(?:is|are|was|were)\s*[.]*$/i, "").trim();
  text = text.replace(/\s+\./g, ".").replace(/\s+/g, " ").trim();
  const parentS = String(parentSummary || "").replace(/\s+/g, " ").trim();
  if (parentS && parentS.length >= 12 && text.includes(parentS)) {
    text = text.replace(parentS, " ").replace(/\s+/g, " ").trim();
  }
  text = text.slice(0, 160).trim();
  if (isWeakTicketSnippet(text, { parentSummary, parentDescription })) return "";
  return text;
}

function sentenceWindowsAround(raw, idx, end) {
  const before = raw.slice(0, idx);
  const after = raw.slice(end);
  const breakBefore = Math.max(
    before.lastIndexOf("\n"),
    before.lastIndexOf(". "),
    before.lastIndexOf("! "),
    before.lastIndexOf("? ")
  );
  const nextBreak = after.search(/[.!?\n]/);
  const sentenceStart = breakBefore >= 0 ? breakBefore + 1 : Math.max(0, idx - 180);
  const sentenceEnd = nextBreak >= 0 ? end + nextBreak + 1 : Math.min(raw.length, end + 220);
  const prevSlice = breakBefore >= 0 ? before.slice(0, Math.max(0, breakBefore)) : "";
  const prevBreak = Math.max(prevSlice.lastIndexOf("\n"), prevSlice.lastIndexOf(". "), prevSlice.lastIndexOf("! "), prevSlice.lastIndexOf("? "));
  const prevStart = prevBreak >= 0 ? prevBreak + 1 : Math.max(0, sentenceStart - 180);
  const afterTail = raw.slice(sentenceEnd);
  const followingBreak = afterTail.search(/[.!?\n]/);
  const nextEnd = followingBreak >= 0 ? sentenceEnd + followingBreak + 1 : Math.min(raw.length, sentenceEnd + 180);
  return [
    raw.slice(end, sentenceEnd),
    raw.slice(sentenceStart, sentenceEnd),
    raw.slice(sentenceEnd, nextEnd),
    raw.slice(prevStart, sentenceStart),
    raw.slice(Math.max(0, idx - 160), Math.min(raw.length, end + 200)),
  ];
}

/** Deterministic one-line description from comment text around a known ticket id. */
function extractTicketDescription(text, key, { parentSummary = "", parentDescription = "" } = {}) {
  const raw = String(text || "");
  const ticket = String(key || "").trim();
  if (!raw || !ticket) return "";
  const re = new RegExp(ticketMentionRegex(ticket).source, "gi");
  const parent = { parentSummary, parentDescription };
  for (const match of raw.matchAll(re)) {
    const windows = sentenceWindowsAround(raw, match.index, match.index + match[0].length);
    for (const window of windows) {
      const others = extractTicketRefs(window, { excludeKey: ticket });
      if (others.length) continue;
      const snippet = tidyTicketSnippet(window, ticket, parent);
      if (snippet) return snippet;
    }
  }
  return "";
}

function relatedTicketKeys(tickets, { parentKey = "" } = {}) {
  const skip = normalizeScrapedTicketKey(parentKey);
  const seen = new Set();
  const keys = [];
  for (const item of Array.isArray(tickets) ? tickets : []) {
    const key = String(item?.key || item || "").trim();
    if (!key) continue;
    const norm = normalizeScrapedTicketKey(key);
    if (!norm || seen.has(norm) || (skip && norm === skip)) continue;
    seen.add(norm);
    keys.push(key);
  }
  return keys;
}

const ISO_TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}T[0-9:.+-]+\b/g;

function scrubCommentSourceLine(line) {
  return String(line || "")
    .replace(ISO_TIMESTAMP_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseSourceLine(line, { parentSummary = "", parentDescription = "" } = {}) {
  const s = scrubCommentSourceLine(line);
  if (!s) return true;
  if (sameParentText(s, parentSummary) || sameParentText(s, parentDescription)) return true;
  return false;
}

/** Comment lines that actually mention harvested ticket keys (not the Jira description field). */
function commentSourceForTickets(
  commentText,
  tickets,
  { parentKey = "", parentSummary = "", parentDescription = "" } = {}
) {
  const raw = String(commentText || "").replace(/\r\n/g, "\n");
  const keys = relatedTicketKeys(tickets, { parentKey });
  if (!raw || !keys.length) return "";
  const parent = { parentSummary, parentDescription };
  const lines = raw.split("\n");
  const keepIdx = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!keys.some((key) => ticketMentionRegex(key).test(line))) continue;
    if (isNoiseSourceLine(line, parent)) continue;
    keepIdx.add(i);
  }
  const blocks = [];
  let cur = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!keepIdx.has(i)) {
      if (cur.length) {
        blocks.push(cur.join("\n"));
        cur = [];
      }
      continue;
    }
    const cleaned = scrubCommentSourceLine(lines[i]);
    if (cleaned) cur.push(cleaned);
  }
  if (cur.length) blocks.push(cur.join("\n"));
  const seen = new Set();
  const out = [];
  for (const block of blocks) {
    const norm = block.replace(/\s+/g, " ").trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    if (sameParentText(norm, parentSummary) || sameParentText(norm, parentDescription)) continue;
    seen.add(norm);
    out.push(block);
  }
  return out.join("\n\n").slice(0, 4000);
}

function attachCommentSource(issue) {
  const parentDesc = stripCommentTicketsBundle(issue?.description);
  const opts = {
    parentKey: issue?.key,
    parentSummary: issue?.summary,
    parentDescription: parentDesc,
  };
  issue.commentSource =
    commentSourceForTickets(issue?.commentBodies, issue?.relatedTickets, opts) ||
    commentSourceForTickets(issue?.commentText, issue?.relatedTickets, opts);
  delete issue.commentBodies;
  return issue;
}

function formatCommentTicketsBundle(tickets, { parentKey = "", parentSummary = "", parentDescription = "" } = {}) {
  const skip = normalizeScrapedTicketKey(parentKey);
  const lines = [];
  const seen = new Set();
  for (const item of Array.isArray(tickets) ? tickets : []) {
    const key = String(item?.key || "").trim();
    if (!key) continue;
    const norm = normalizeScrapedTicketKey(key);
    if (!norm || seen.has(norm) || (skip && norm === skip)) continue;
    seen.add(norm);
    const snippet = tidyTicketSnippet(item?.summary, "", {
      parentSummary,
      parentDescription,
    });
    lines.push(snippet ? `${key} — ${snippet}` : key);
  }
  if (!lines.length) return "";
  return `${COMMENT_TICKETS_HEADING}\n${lines.join("\n")}`;
}

function bundledTicketLookupQuery(tickets, { parentKey = "" } = {}) {
  const ops = relatedTicketKeys(tickets, { parentKey }).filter((key) => isOpsTicketKey(key));
  return snowNumberInQuery(ops);
}

function bundledParentDescription(issue) {
  return stripCommentTicketsBundle(issue?.description);
}

function enrichRelatedTicketsFromComments(issue) {
  const parentSummary = String(issue?.summary || "").replace(/\s+/g, " ").trim();
  const parentDesc = stripCommentTicketsBundle(issue?.description).replace(/\s+/g, " ").trim();
  const parent = { parentSummary, parentDescription: parentDesc };
  const related = Array.isArray(issue?.relatedTickets) ? issue.relatedTickets : [];
  issue.relatedTickets = related.map((item) => {
    const kind = String(item?.kind || "").trim() || ticketKindLabel(item?.key);
    const autoQuery = String(item?.autoQuery || "").trim() || ticketLookupQuery(item?.key);
    let summary = String(item?.summary || "").replace(/\s+/g, " ").trim();
    if (sameParentText(summary, parentSummary) || sameParentText(summary, parentDesc)) summary = "";
    const ops = isOpsTicketKey(item?.key);
    const blob = ops
      ? [issue?.commentText, parentDesc].filter(Boolean).join("\n")
      : [issue?.commentText, parentDesc, issue?.summary].filter(Boolean).join("\n");
    const extracted = extractTicketDescription(blob, item?.key, parent);
    if (ops) {
      summary = extracted || (isWeakTicketSnippet(summary, parent) ? "" : summary);
    } else if (!summary && extracted) {
      summary = extracted;
    }
    if (isWeakTicketSnippet(summary, parent)) summary = "";
    return { ...item, summary, kind, autoQuery };
  });
  return issue;
}

/** Pull RITM / CR / INC / CHG / Jira keys from summary, description, and comments. */
function extractTicketRefs(text, { excludeKey = "", excludeKeys = [] } = {}) {
  const raw = String(text || "");
  const exclude = new Set(
    [excludeKey, ...(Array.isArray(excludeKeys) ? excludeKeys : [])]
      .map((value) => normalizeScrapedTicketKey(value))
      .filter(Boolean)
  );
  const seen = new Set();
  const out = [];
  const add = (value) => {
    const key = normalizeScrapedTicketKey(value);
    if (!key || exclude.has(key) || seen.has(key)) return;
    if (key.length < 4) return;
    seen.add(key);
    out.push({ key });
  };
  for (const match of raw.matchAll(SNOW_TICKET_RE)) add(match[1]);
  for (const match of raw.matchAll(SCTASK_ALIAS_RE)) add(`SCTASK${match[1]}`);
  for (const match of raw.matchAll(CHG_SEVEN_RE)) add(`CHG${match[1]}`);
  const siblingRe = new RegExp(
    `(${TICKET_PREFIX})[\\s.\\-#]*(\\d{2,})((?:\\s*(?:and|,|/|&|;|\\+|\\\\)\\s*(?:(?:${TICKET_PREFIX})[\\s.\\-#]*)?\\d{2,})+)`,
    "gi"
  );
  for (const block of raw.matchAll(siblingRe)) {
    const prefix = canonicalTicketPrefix(block[1] || "RITM");
    add(`${prefix}${block[2]}`);
    const tail = String(block[3] || "");
    for (const extra of tail.matchAll(/\d{2,}/g)) {
      const before = tail.slice(Math.max(0, extra.index - 16), extra.index);
      if (new RegExp(`(?:${TICKET_PREFIX})[\\s.\\-#]*$`, "i").test(before)) continue;
      add(`${prefix}${extra[0]}`);
    }
    for (const prefixed of String(block[0] || "").matchAll(SNOW_TICKET_RE)) add(prefixed[1]);
  }
  const changePhraseRe =
    /\bchange\s*(?:request|number|req|#)?\s*[:=\-]*\s*((?:CHG|CRQ)?[\s.\-#]*\d{4,})/gi;
  for (const match of raw.matchAll(changePhraseRe)) {
    const token = String(match[1] || "").replace(/[\s.\-#]+/g, "").toUpperCase();
    if (!token) continue;
    add(/^(?:CHG|CRQ)\d+$/.test(token) ? token : `CHG${token}`);
  }
  for (const match of raw.matchAll(JIRA_KEY_RE)) add(match[1]);
  return out;
}

function ensureOpenSprintJql(jql) {
  const raw = String(jql || "").trim();
  if (!raw) return "assignee = currentUser() AND sprint in openSprints() ORDER BY updated ASC";
  if (/\bsprint\b/i.test(raw)) return raw;
  const withoutOrder = raw.replace(/\s+ORDER\s+BY\s+.+$/i, "").trim();
  const orderMatch = raw.match(/\s+(ORDER\s+BY\s+.+)$/i);
  const order = orderMatch ? orderMatch[1] : "ORDER BY updated ASC";
  const core = withoutOrder || "assignee = currentUser()";
  return `${core} AND sprint in openSprints() ${order}`.trim();
}

function stripOpenSprintFromJql(jql) {
  let s = String(jql || "").trim();
  if (!s) return s;
  s = s.replace(/\s*(AND|OR)?\s*sprint\s+in\s+openSprints\s*(?:\(\s*\))?/gi, "");
  s = s.replace(/(?<!currentUser)\(\s*\)/gi, "");
  s = s.replace(/\bAND\s+AND\b/gi, "AND");
  s = s.replace(/\bOR\s+OR\b/gi, "OR");
  s = s.replace(/\bAND\s+ORDER\b/gi, "ORDER");
  s = s.replace(/\bOR\s+ORDER\b/gi, "ORDER");
  s = s.replace(/^\s*(AND|OR)\s+/i, "");
  s = s.replace(/\s+(AND|OR)\s*$/i, "");
  return s.replace(/\s{2,}/g, " ").trim();
}

function splitJqlOrder(jql) {
  const raw = String(jql || "").trim();
  const orderMatch = raw.match(/\s+(ORDER\s+BY\s+.+)$/i);
  return {
    core: (orderMatch ? raw.slice(0, orderMatch.index) : raw).trim(),
    order: orderMatch ? orderMatch[1] : "ORDER BY updated DESC",
  };
}

function ensurePastWorkJql(jql) {
  // Strip openSprints() first — stripDoneExclusionsFromJql also removes empty (),
  // which would turn openSprints() into openSprints and hide the clause.
  // Newest first so a ticket closed this session is in the match set.
  const assigned = pastWorkJqlWithoutSprint(stripOpenSprintFromJql(jql));
  const { core } = splitJqlOrder(assigned);
  const body = core || "assignee = currentUser()";
  return `${body} ORDER BY updated DESC`.trim();
}

function pastWorkJqlWithoutSprint(jql) {
  return ensureAssigneeOnlyJql(
    String(jql || "")
      .replace(/\s*(AND|OR)?\s*sprint\s+not\s+in\s+openSprints\s*(?:\(\s*\))?/gi, "")
      .replace(/\s*(AND|OR)?\s*sprint\s+is\s+EMPTY/gi, "")
  );
}

/** AND a sanitized phrase search. Never accepts raw AI JQL operators. */
function applyPastWorkTextQuery(jql, textQuery) {
  const phrase = sanitizeJqlPhrase(textQuery);
  const incoming = String(jql || "").trim();
  const base = incoming || ensurePastWorkJql("");
  if (!phrase) return ensurePastWorkJql(base);
  const guarded = ensurePastWorkJql(base);
  const { core, order } = splitJqlOrder(guarded);
  if (/\btext\s*~/i.test(core) || /\bsummary\s*~/i.test(core)) return guarded;
  const clause = `(summary ~ "${phrase}" OR description ~ "${phrase}" OR text ~ "${phrase}")`;
  return `${core} AND ${clause} ${order}`.trim();
}

function jqlLooksLikeBadTextQuery(error) {
  const text = String(error || "").toLowerCase();
  return (
    text.includes("unable to parse") ||
    text.includes("error in the jql") ||
    (text.includes("text") && (text.includes("does not exist") || text.includes("unknown"))) ||
    (text.includes("summary") && text.includes("~") && text.includes("error"))
  );
}

function sprintListFromField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(sprintListFromField);
  if (typeof value === "string") {
    const state = (/state=([A-Za-z]+)/i.exec(value) || [])[1] || "";
    return [{ state, raw: value }];
  }
  if (typeof value === "object") return [value];
  return [];
}

function issueInOpenSprint(fieldsOrIssue) {
  if (fieldsOrIssue?.inOpenSprint === true) return true;
  const fields =
    fieldsOrIssue?.fields && fieldsOrIssue.fields.sprint !== undefined
      ? fieldsOrIssue.fields
      : fieldsOrIssue;
  return sprintListFromField(fields?.sprint).some((sprint) => {
    const state = String(sprint?.state || sprint?.status || "").toLowerCase();
    return state === "active" || state === "open";
  });
}

function issueStatusCategoryKey(issue) {
  if (!issue || typeof issue !== "object") return "";
  if (issue.statusCategory && typeof issue.statusCategory === "object") {
    return String(issue.statusCategory.key || issue.statusCategory.name || "").toLowerCase();
  }
  if (issue.status && typeof issue.status === "object") {
    return String(issue.status.statusCategory?.key || issue.status.statusCategory?.name || "").toLowerCase();
  }
  return String(issue.statusCategory || issue.statusCategoryKey || "").toLowerCase();
}

function issueStatusName(issue) {
  if (typeof issue === "string") return issue;
  if (issue?.status && typeof issue.status === "object") return String(issue.status.name || "");
  return String(issue?.status || "");
}

/** Done category or Done/Closed/Resolved/Complete — never a Past work sample card. */
function isPastWorkDoneIssue(issue) {
  if (issue?.done === true) return true;
  if (issueStatusCategoryKey(issue) === "done") return true;
  return isJiraDoneStatus(issueStatusName(issue), issue?.sopStage);
}

function filterPastWorkIssues(
  issues,
  { excludeKeys = [], includeDone = false, includeOpenSprint = false } = {}
) {
  const drop = new Set(
    (Array.isArray(excludeKeys) ? excludeKeys : [])
      .map((value) => normalizeScrapedTicketKey(value))
      .filter(Boolean)
  );
  return (issues || []).filter((issue) => {
    const key = normalizeScrapedTicketKey(issue?.key);
    if (!key) return false;
    if (drop.has(key)) return false;
    if (
      !includeOpenSprint &&
      (issue?.inOpenSprint === true || issueInOpenSprint(issue))
    ) {
      return false;
    }
    if (!includeDone && isPastWorkDoneIssue(issue)) return false;
    return true;
  });
}

function withNoCacheQuery(path, enabled) {
  if (!enabled) return path;
  const join = String(path).includes("?") ? "&" : "?";
  return `${path}${join}_=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function jqlLooksLikeMissingSprint(error) {
  const text = String(error || "").toLowerCase();
  return (
    text.includes("sprint") &&
    (text.includes("does not exist") ||
      text.includes("unknown field") ||
      text.includes("not on the board") ||
      text.includes("field 'sprint'") ||
      text.includes('field "sprint"'))
  );
}

/** Match queue cards to a Jira key via data[field] or KEY-123 in title. */
function findLinkedCardId(issueKey, queueCards, cardKeyField = "jiraKey") {
  const key = String(issueKey || "").trim().toUpperCase();
  if (!key || !Array.isArray(queueCards)) return null;
  const field = String(cardKeyField || "jiraKey").trim() || "jiraKey";
  const keyRe = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  for (const card of queueCards) {
    const fromData = String(card?.data?.[field] || "").trim().toUpperCase();
    if (fromData === key) return card.id || null;
    if (keyRe.test(String(card?.title || ""))) return card.id || null;
    if (keyRe.test(String(card?.id || ""))) return card.id || null;
  }
  return null;
}

function isJiraDoneStatus(statusName, sopStage = "") {
  const s = String(statusName || "").trim().toLowerCase();
  const stage = String(sopStage || "").trim().toLowerCase();
  if (!s && !stage) return false;
  if (
    /^(done|closed|resolved|complete|completed|cancelled|canceled)$/i.test(s) ||
    /\b(done|closed|resolved|complete)\b/i.test(s)
  ) {
    return true;
  }
  if (/complete|done|closed|resolved/.test(stage)) return true;
  return false;
}

function enrichIssues(issues, { statusMap, queueCards, cardKeyField } = {}) {
  const map = normalizeStatusMap(statusMap);
  return (issues || []).map((issue) => {
    const sopStage = mapSopStage(issue.status, map);
    const row = { ...issue, sopStage };
    return {
      ...row,
      linkedCardId: findLinkedCardId(issue.key, queueCards, cardKeyField),
      done: isPastWorkDoneIssue(row) || isJiraDoneStatus(issue.status, sopStage),
    };
  });
}

function foldProjectText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function collapseProjectText(value) {
  return foldProjectText(value).replace(/\s+/g, "");
}

function normalizeProjectRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      key: String(row?.key || "").trim(),
      name: String(row?.name || "").trim(),
    }))
    .filter((row) => row.key);
}

function matchProjectFromList(projects, raw) {
  const list = Array.isArray(projects) ? projects : [];
  const folded = foldProjectText(raw);
  const collapsed = collapseProjectText(raw);
  if (!folded) return null;
  const byKey = list.find(
    (p) => foldProjectText(p.key) === folded || collapseProjectText(p.key) === collapsed
  );
  if (byKey) return { ...byKey, matchedBy: "key" };
  const byName = list.filter((p) => foldProjectText(p.name) === folded);
  if (byName.length === 1) return { ...byName[0], matchedBy: "name" };
  if (byName.length > 1) return { ambiguous: true, matches: byName };
  const byCollapsed = list.filter((p) => collapseProjectText(p.name) === collapsed);
  if (byCollapsed.length === 1) return { ...byCollapsed[0], matchedBy: "name" };
  if (byCollapsed.length > 1) return { ambiguous: true, matches: byCollapsed };
  return null;
}

function nearbyProjects(projects, raw) {
  const folded = foldProjectText(raw);
  const collapsed = collapseProjectText(raw);
  const tokens = folded.split(" ").filter((t) => t.length > 2);
  return (Array.isArray(projects) ? projects : [])
    .map((p) => {
      const name = foldProjectText(p.name);
      const key = foldProjectText(p.key);
      const nameCollapsed = collapseProjectText(p.name);
      let score = 0;
      if (folded && (name === folded || key === folded || nameCollapsed === collapsed)) score += 5;
      if (folded && (name.includes(folded) || folded.includes(name))) score += 3;
      if (collapsed && nameCollapsed.includes(collapsed)) score += 2;
      if (folded && (key.includes(folded) || folded.includes(key))) score += 2;
      if (tokens.some((t) => name.split(" ").includes(t) || key.includes(t))) score += 1;
      return { key: p.key, name: p.name, score };
    })
    .sort((a, b) => b.score - a.score || String(a.key).localeCompare(String(b.key)));
}

function formatProjectCatalog(projects) {
  return (Array.isArray(projects) ? projects : [])
    .slice(0, 12)
    .map((p) => `${p.key} — ${p.name || p.key}`)
    .join(", ");
}

function formatProjectNotFoundError(raw, projects, { displayName, baseUrl } = {}) {
  const query = String(raw || "").trim() || "that value";
  const nearby = nearbyProjects(projects, query);
  const catalog = formatProjectCatalog(nearby);
  const site = String(baseUrl || "").replace(/\/+$/, "");
  const who = displayName ? `Signed in as ${displayName}, but ` : "";
  const where = site ? ` on ${site}` : "";
  const nearBit = catalog
    ? ` Nearby projects: ${catalog}.`
    : site
      ? ` No projects were visible on ${site}.`
      : "";
  return `${who}project ${query} was not found${where}.${nearBit}`.trim();
}

async function searchProjectPages(c, searchPath) {
  const search = await jiraGetJson(c, searchPath);
  if (!search.ok) return search;
  let values = Array.isArray(search.data?.values)
    ? search.data.values
    : Array.isArray(search.data)
      ? search.data
      : [];
  let startAt = Number(search.data?.startAt || 0) + values.length;
  const total = Number(search.data?.total || values.length);
  let isLast = search.data?.isLast !== false;
  const qIndex = searchPath.indexOf("?");
  const extra = qIndex >= 0 ? searchPath.slice(qIndex + 1).replace(/(^|&)startAt=\d+/g, "").replace(/^&/, "") : "";
  while (!isLast && values.length < 200 && startAt < total) {
    const pageQs = `maxResults=100&startAt=${encodeURIComponent(String(startAt))}${extra ? `&${extra}` : ""}`;
    const page = await jiraGetJson(c, `/rest/api/3/project/search?${pageQs}`);
    if (!page.ok) break;
    const more = Array.isArray(page.data?.values) ? page.data.values : [];
    if (!more.length) break;
    values = values.concat(more);
    startAt += more.length;
    isLast = page.data?.isLast !== false;
  }
  return { ok: true, projects: normalizeProjectRows(values) };
}

async function fetchAccessibleProjects(c, { query } = {}) {
  const q = String(query || "").trim();
  if (q) {
    const filtered = await searchProjectPages(
      c,
      `/rest/api/3/project/search?query=${encodeURIComponent(q)}&maxResults=100&startAt=0`
    );
    if (filtered.ok && filtered.projects.length) return filtered;
  }

  const search = await searchProjectPages(c, "/rest/api/3/project/search?maxResults=100&startAt=0");
  if (search.ok) return search;

  const list = await jiraGetJson(c, "/rest/api/3/project");
  if (list.ok) {
    const rows = Array.isArray(list.data) ? list.data : [];
    return { ok: true, projects: normalizeProjectRows(rows) };
  }

  return {
    ok: false,
    httpStatus: list.httpStatus || search.httpStatus || 0,
    error: list.error || search.error,
  };
}

function matchOrAmbiguousError(query, listed, { displayName, baseUrl } = {}) {
  const matched = matchProjectFromList(listed.projects, query);
  if (matched?.ambiguous) {
    const keys = matched.matches.map((p) => p.key).join(", ");
    return {
      ok: false,
      httpStatus: 404,
      error: `Signed in as ${displayName || "your account"}, but several projects are named "${query}". Use a project key: ${keys}.`,
      projects: listed.projects,
    };
  }
  if (matched) {
    return {
      ok: true,
      key: matched.key,
      name: matched.name,
      matchedBy: matched.matchedBy,
      projects: listed.projects,
    };
  }
  return {
    ok: false,
    httpStatus: 404,
    error: formatProjectNotFoundError(query, listed.projects, { displayName, baseUrl }),
    projects: listed.projects,
  };
}

/**
 * Map Settings project field to a real Jira Cloud key.
 * GET /project/{key} first; on 404, list projects and match name (case-insensitive, collapsed spaces).
 */
async function resolveProjectKey(config, rawKey, { displayName } = {}) {
  const c = normalizeConfig(config);
  const query = String(rawKey || c.projectKey || "").trim();
  if (!query) {
    return {
      ok: false,
      error: 'Set a project key in Settings (e.g. MBA). A space name like "MOBILE BANKING APP" is also OK — we resolve it.',
    };
  }

  const encoded = encodeURIComponent(looksLikeJiraProjectKey(query) ? query.toUpperCase() : query);
  const proj = await jiraGetJson(c, `/rest/api/3/project/${encoded}`);
  if (proj.ok) {
    return {
      ok: true,
      key: String(proj.data?.key || query).trim() || query.toUpperCase(),
      name: String(proj.data?.name || "").trim(),
      matchedBy: "key",
    };
  }

  const listed = await fetchAccessibleProjects(c, { query });
  if (listed.ok) {
    return matchOrAmbiguousError(query, listed, { displayName, baseUrl: c.baseUrl });
  }

  return {
    ok: false,
    httpStatus: listed.httpStatus || proj.httpStatus || 0,
    error: listed.error
      ? `${listed.error} Project ${query} was not found.`
      : formatProjectNotFoundError(query, [], { displayName, baseUrl: c.baseUrl }),
  };
}

/** Keys are unquoted (`project = MBA`); names with spaces need quotes. Prefer a resolved key. */
function jqlProjectEquals(projectKey) {
  const key = String(projectKey || "").trim();
  if (!key) return "";
  if (looksLikeJiraProjectKey(key)) return `project = ${key.toUpperCase()}`;
  const escaped = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `project = "${escaped}"`;
}

function extractJqlProjectRefs(jql) {
  const raw = String(jql || "");
  const out = [];
  const re = /\bproject\s*=\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z][A-Za-z0-9_]*))/gi;
  let m;
  while ((m = re.exec(raw))) {
    out.push(m[1] || m[2] || m[3]);
  }
  return out;
}

function applyResolvedProjectToJql(jql, projectKey) {
  const clause = jqlProjectEquals(projectKey);
  if (!clause) return String(jql || "").trim();
  const raw = String(jql || "").trim();
  const orderMatch = raw.match(/\s+(ORDER\s+BY\s+.+)$/i);
  const order = orderMatch ? orderMatch[1] : "";
  let core = (orderMatch ? raw.slice(0, orderMatch.index) : raw).trim();
  const projectRe = /\bproject\s*=\s*(?:"[^"]*"|'[^']*'|[A-Za-z][A-Za-z0-9_]*)/gi;
  const replaced = core.replace(projectRe, clause);
  if (replaced !== core) core = replaced;
  else if (core) core = `${clause} AND (${core})`;
  else core = clause;
  return `${core}${order ? ` ${order}` : ""}`.trim();
}

async function jiraGetJson(c, pathname) {
  let res;
  try {
    res = await jiraFetch(c, pathname, { method: "GET" });
  } catch (err) {
    const local = /127\.0\.0\.1|localhost/i.test(c.baseUrl);
    return {
      ok: false,
      error: local
        ? "Local Jira mock is not running on port 4176"
        : err?.message || "Network error talking to Jira",
    };
  }
  const parsed = await parseJiraHttpResponse(res, { baseUrl: c.baseUrl, pathname });
  if (!parsed.parseOk) {
    return {
      ok: false,
      httpStatus: parsed.httpStatus || res.status,
      error: parsed.error,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      httpStatus: res.status,
      error: formatJiraHttpError(res.status, parseJiraErrorBody(parsed.data), "auth"),
    };
  }
  return { ok: true, data: parsed.data || {} };
}

/**
 * Lightweight auth check against a real Jira Cloud board.
 * GET /myself, then resolve Settings project key or name via project search.
 * Never log the API token.
 */
async function testConnection(config) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) {
    return {
      ok: false,
      error:
        missingAuthError(c) ||
        "Enter site URL (https://xxx.atlassian.net), email, and API token (API key) in Settings.",
    };
  }
  logJiraAuth(c, { event: "testConnection" });
  if (isAtlassianCloudHost(c.baseUrl) && /@coact\.local$/i.test(c.email)) {
    return {
      ok: false,
      error:
        "That email is the local mock account. For Cloud, paste your Atlassian account email (the address you use at id.atlassian.com) and an API token — not demo@coact.local.",
    };
  }

  const me = await jiraGetJson(c, "/rest/api/3/myself");
  if (!me.ok) {
    return {
      ok: false,
      httpStatus: me.httpStatus || 0,
      error: me.error,
      siteUrl: c.baseUrl,
    };
  }

  const displayName =
    String(me.data?.displayName || me.data?.emailAddress || c.email).trim() || c.email;
  const accountId = String(me.data?.accountId || "").trim();

  let projectName = "";
  let projectKey = c.projectKey;
  let matchedBy = "";
  if (c.projectKey) {
    const resolved = await resolveProjectKey(c, c.projectKey, { displayName });
    if (!resolved.ok) {
      return {
        ok: false,
        httpStatus: resolved.httpStatus || 0,
        error: resolved.error,
        displayName,
        accountId,
        siteUrl: c.baseUrl,
        projectKey: c.projectKey,
      };
    }
    projectKey = resolved.key;
    projectName = String(resolved.name || resolved.key).trim();
    matchedBy = resolved.matchedBy || "";
  }

  const resolvedLabel = projectName && projectName !== projectKey
    ? `${projectName} → ${projectKey}`
    : projectKey;
  const message = `Signed in as ${displayName}. Resolved project ${resolvedLabel}.`;

  return {
    ok: true,
    displayName,
    accountId,
    siteUrl: c.baseUrl,
    projectKey,
    projectName,
    matchedBy,
    message,
  };
}

function buildSearchJqlGetPath(searchPath, payload) {
  const params = new URLSearchParams();
  params.set("jql", String(payload?.jql || ""));
  params.set("maxResults", String(payload?.maxResults ?? 50));
  if (payload?.nextPageToken) params.set("nextPageToken", String(payload.nextPageToken));
  if (Array.isArray(payload?.fields) && payload.fields.length) {
    params.set("fields", payload.fields.join(","));
  }
  return `${searchPath}?${params.toString()}`;
}

function searchJqlGetNotSupported(status) {
  const code = Number(status) || 0;
  return code === 404 || code === 405 || code === 410 || code === 501;
}

function mapSearchIssue(c, issue) {
  const fieldsObj = issue?.fields || {};
  const { days, score } = scoreIssue(fieldsObj);
  const stale = days >= c.staleDays;
  const linkedIssues = parseIssueLinks(fieldsObj.issuelinks);
  const searchComments = Array.isArray(fieldsObj.comment?.comments)
    ? fieldsObj.comment.comments
    : [];
  const commentText = searchComments
    .map((row) => commentToScrapeText(row))
    .filter(Boolean)
    .join("\n");
  const issueKey = normalizeScrapedTicketKey(issue.key) || issue.key;
  return {
    id: issue.id,
    key: issueKey,
    summary: fieldsObj.summary || "(no summary)",
    description: jiraAdfToText(fieldsObj.description),
    commentText,
    status: fieldsObj.status?.name || "—",
    statusCategory: String(fieldsObj.status?.statusCategory?.key || "").toLowerCase(),
    priority: fieldsObj.priority?.name || "—",
    assignee: fieldsObj.assignee?.displayName || fieldsObj.assignee?.emailAddress || "Unassigned",
    assigneeEmail: fieldsObj.assignee?.emailAddress || "",
    updated: fieldsObj.updated || null,
    daysSinceUpdate: Math.round(days * 10) / 10,
    urgencyScore: score,
    stale,
    url: issueBrowseUrl(c.baseUrl, issue.key),
    issueType: fieldsObj.issuetype?.name || "Issue",
    labels: Array.isArray(fieldsObj.labels) ? fieldsObj.labels : [],
    linkedIssues,
    inOpenSprint: issueInOpenSprint(fieldsObj),
  };
}

/** Bounded JQL search used to pick up newly closed similar stories. */
async function searchIssuesByJql(
  config,
  jql,
  { maxResults = 20, forceRefresh = false, pages = 2 } = {}
) {
  const c = normalizeConfig(config);
  const query = String(jql || "").trim();
  if (!isConfigured(c) || !query) return [];
  const cap = Math.min(40, Math.max(1, Number(maxResults) || 20));
  const pageLimit = Math.max(1, Math.min(3, Number(pages) || 2));
  const collected = [];
  let nextPageToken = "";
  const searchPath = "/rest/api/3/search/jql";
  const fields = ["summary", "description", "status", "assignee", "updated", "issuetype", "sprint"];
  for (let page = 0; page < pageLimit && collected.length < cap; page++) {
    const payload = {
      jql: query,
      maxResults: Math.min(50, cap - collected.length),
      fields,
    };
    if (nextPageToken) payload.nextPageToken = nextPageToken;
    let res;
    try {
      const getPath = withNoCacheQuery(buildSearchJqlGetPath(searchPath, payload), forceRefresh);
      if (getPath.length <= 1800) {
        res = await jiraFetch(c, getPath, { method: "GET", forceRefresh });
      }
      if (!res || searchJqlGetNotSupported(res.status)) {
        res = await jiraFetch(c, searchPath, {
          method: "POST",
          body: JSON.stringify(payload),
          forceRefresh,
        });
      }
    } catch {
      break;
    }
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: searchPath,
    });
    if (!parsed.parseOk || !res.ok) break;
    const pageIssues = Array.isArray(parsed.data?.issues) ? parsed.data.issues : [];
    collected.push(...pageIssues);
    nextPageToken = String(parsed.data?.nextPageToken || "").trim();
    if (parsed.data?.isLast === true || !nextPageToken || !pageIssues.length) break;
  }
  return collected.map((issue) => mapSearchIssue(c, issue)).filter((issue) => issue?.key);
}

function keepSimilarSearchHit(parent, row, tokens = []) {
  if (storiesAreRelated(parent, row)) return true;
  if (Array.isArray(tokens) && tokens.length && issueTextHasTokens(row, tokens, 2)) return true;
  return issueSharesParentTokens(parent, row, 2);
}

async function findSimilarPastIssues(
  config,
  issue,
  { maxResults = 20, forceRefresh = false, timeoutMs = 4500 } = {}
) {
  const parent = {
    key: issue?.key,
    summary: issue?.summary,
    description: issue?.description,
  };
  const parentKey = normalizeScrapedTicketKey(issue?.key) || "?";
  const groups = similarSearchTokenGroups(parent);
  const work = (async () => {
    const hits = [];
    const seen = new Set([parentKey].filter((key) => key && key !== "?"));
    const jqls = [];
    const hitKeys = [];
    const takeRows = (rows, tokens) => {
      for (const row of rows) {
        const key = normalizeScrapedTicketKey(row?.key);
        if (!key || seen.has(key) || !isJiraIssueKey(key)) continue;
        if (!keepSimilarSearchHit(parent, row, tokens)) continue;
        seen.add(key);
        hitKeys.push(key);
        hits.push({
          ...row,
          key,
          url: row.url || issueBrowseUrl(normalizeConfig(config).baseUrl, key),
        });
        if (hits.length >= maxResults) break;
      }
    };
    // Newest assigned tickets in ANY project (MBA, MBQ, DBAB, …), including just-closed.
    const recentJql = buildRecentAssignedIssueJql({ excludeKey: issue?.key });
    if (recentJql) {
      jqls.push(recentJql);
      const recent = await searchIssuesByJql(config, recentJql, {
        maxResults: Math.max(30, maxResults),
        forceRefresh,
        pages: 1,
      });
      takeRows(recent, []);
    }
    for (const tokens of groups) {
      if (hits.length >= maxResults) break;
      const jql = buildSimilarIssueJql({
        tokens,
        excludeKey: issue?.key,
      });
      if (!jql) continue;
      jqls.push(jql);
      const rows = await searchIssuesByJql(config, jql, {
        maxResults,
        forceRefresh,
        pages: 1,
      });
      takeRows(rows, tokens);
    }
    console.log(
      `[livetrack] past similar ${parentKey} jql=${jqls.join(" ; ") || "(none)"} hits=${hitKeys.join(",") || "(none)"}`
    );
    return hits.slice(0, maxResults);
  })();
  const ms = Math.max(1200, Number(timeoutMs) || 4500);
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("similar search timed out")), ms);
      }),
    ]);
  } catch {
    console.log(`[livetrack] past similar ${parentKey} jql=(timeout) hits=(none)`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function searchIssues(
  config,
  {
    maxResults = 50,
    queueCards = [],
    openSprint = false,
    scrapeTickets = false,
    pastWork = false,
    forceRefresh = false,
    excludeKeys = [],
    textQuery = "",
  } = {}
) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) {
    return {
      ok: false,
      error: missingAuthError(c) || "Configure Jira base URL, email, and API token in Settings.",
      issues: [],
      staleCount: 0,
      sopStages: c.statusMap,
    };
  }

  let jql = c.jql;
  const jqlRefs = extractJqlProjectRefs(jql);
  const refToResolve = jqlRefs[0] || c.projectKey;
  const resolved = await resolveProjectKey(c, refToResolve);
  if (resolved.ok) {
    jql = applyResolvedProjectToJql(jql, resolved.key);
  } else if (jqlRefs.length || foldProjectText(c.projectKey) !== "liveact") {
    return {
      ok: false,
      httpStatus: resolved.httpStatus || 0,
      error: resolved.error,
      issues: [],
      staleCount: 0,
      sopStages: c.statusMap,
    };
  }

  let usedOpenSprint = false;
  let usedPastSprint = false;
  let usedTextQuery = false;
  let jqlBeforeText = "";
  if (pastWork) {
    const pastJql = ensurePastWorkJql(jql);
    usedPastSprint = /sprint\s+not\s+in\s+openSprints/i.test(pastJql);
    jql = pastJql;
    const phrase = sanitizeJqlPhrase(textQuery);
    if (phrase) {
      jqlBeforeText = jql;
      const withText = applyPastWorkTextQuery(jql, phrase);
      usedTextQuery = withText !== jql;
      jql = withText;
    }
  } else if (openSprint) {
    const sprintJql = ensureOpenSprintJql(jql);
    usedOpenSprint = sprintJql !== jql;
    jql = sprintJql;
  }

  const fields = [
    "summary",
    "description",
    "status",
    "priority",
    "assignee",
    "updated",
    "issuetype",
    "labels",
    "reporter",
    "issuelinks",
    "comment",
    "sprint",
  ];
  const searchPath = "/rest/api/3/search/jql";
  const cap = Math.max(1, Number(maxResults) || 50);
  const pageSize = Math.min(100, cap);
  const collected = [];
  let nextPageToken = "";
  let data = {};

  for (let page = 0; page < 10 && collected.length < cap; page++) {
    const payload = {
      jql,
      maxResults: Math.min(pageSize, cap - collected.length),
      fields,
    };
    if (nextPageToken) payload.nextPageToken = nextPageToken;

    let res;
    try {
      // Prefer GET so Classic XSRF (POST + Atlassian cookies) never runs on search.
      const getPath = withNoCacheQuery(
        buildSearchJqlGetPath(searchPath, payload),
        forceRefresh
      );
      if (getPath.length <= 1800) {
        res = await jiraFetch(c, getPath, {
          method: "GET",
          forceRefresh,
        });
      }
      if (!res || searchJqlGetNotSupported(res.status)) {
        res = await jiraFetch(c, searchPath, {
          method: "POST",
          body: JSON.stringify(payload),
          forceRefresh,
        });
      }
    } catch (err) {
      const local = /127\.0\.0\.1|localhost/i.test(c.baseUrl);
      return {
        ok: false,
        error: local
          ? "Local Jira mock is not running on port 4176"
          : err?.message || "Network error talking to Jira",
        issues: [],
        staleCount: 0,
        sopStages: c.statusMap,
      };
    }

    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: searchPath,
    });
    if (!parsed.parseOk) {
      return {
        ok: false,
        httpStatus: parsed.httpStatus || res.status,
        error: parsed.error,
        issues: [],
        staleCount: 0,
        sopStages: c.statusMap,
      };
    }
    if (!res.ok) {
      const error = formatJiraHttpError(res.status, parseJiraErrorBody(parsed.data));
      if (openSprint && usedOpenSprint && jqlLooksLikeMissingSprint(error)) {
        usedOpenSprint = false;
        jql = jql.replace(/\s*AND\s+sprint\s+in\s+openSprints\s*\(\s*\)/gi, "").replace(/\s{2,}/g, " ").trim();
        collected.length = 0;
        nextPageToken = "";
        page = -1;
        continue;
      }
      if (pastWork && usedPastSprint && jqlLooksLikeMissingSprint(error)) {
        usedPastSprint = false;
        jql = pastWorkJqlWithoutSprint(jql);
        collected.length = 0;
        nextPageToken = "";
        page = -1;
        continue;
      }
      if (pastWork && usedTextQuery && jqlBeforeText && jqlLooksLikeBadTextQuery(error)) {
        usedTextQuery = false;
        jql = jqlBeforeText;
        collected.length = 0;
        nextPageToken = "";
        page = -1;
        continue;
      }
      return {
        ok: false,
        httpStatus: res.status,
        error,
        issues: [],
        staleCount: 0,
        sopStages: c.statusMap,
      };
    }

    data = parsed.data || {};
    const pageIssues = Array.isArray(data.issues) ? data.issues : [];
    collected.push(...pageIssues);
    nextPageToken = String(data.nextPageToken || "").trim();
    if (data.isLast === true || !nextPageToken || !pageIssues.length) break;
  }

  let issues = collected.map((issue) => mapSearchIssue(c, issue));

  // Belt-and-suspenders: never show unassigned / other people's tickets
  const me = c.email.toLowerCase();
  issues = issues.filter((issue) => {
    if (!issue.assignee || issue.assignee === "Unassigned") return false;
    if (!issue.assigneeEmail) return true; // trust JQL when email missing (Cloud displayName-only)
    return String(issue.assigneeEmail).toLowerCase() === me;
  });

  issues = enrichIssues(issues, {
    statusMap: c.statusMap,
    queueCards,
    cardKeyField: c.cardKeyField,
  });

  if (pastWork) {
    // Keep done and current-sprint peers so summary matching can find MBA-12.
    issues = filterPastWorkIssues(issues, {
      includeDone: true,
      includeOpenSprint: true,
    });
  }

  // openSprints() is often empty (Kanban, closed sprint, no sprint field on the issue).
  // Fall back to the same assigned-to-me list as the Jira tab — never scrape related tickets there.
  if (!pastWork && openSprint && usedOpenSprint && issues.length === 0) {
    return searchIssues(config, {
      maxResults,
      queueCards,
      openSprint: false,
      scrapeTickets: false,
      pastWork: false,
      forceRefresh,
    });
  }

  // Only Past work harvests RITM/CHG/MBA keys from comments. Active-sprint / main Jira never does.
  let catalogIssues = [];
  if (pastWork && scrapeTickets) {
    issues = await attachScrapedTickets(c, issues, {
      forceRefresh: Boolean(forceRefresh),
      budgetMs: 18000,
    });
    catalogIssues = filterPastWorkIssues(issues, {
      includeDone: true,
      includeOpenSprint: true,
    });
    issues = filterPastWorkIssues(issues, {
      excludeKeys,
      includeDone: false,
      includeOpenSprint: true,
    });
  } else if (pastWork) {
    for (const issue of issues) {
      issue.relatedTickets = (issue.linkedIssues || []).map((item) => ({
        key: item.key,
        summary: item.summary || "",
        status: item.status || "",
        url: isJiraIssueKey(item.key) ? issueBrowseUrl(c.baseUrl, item.key) : "",
        source: "link",
      }));
      issue.commentTicketCount = 0;
    }
    issues = finalizePastWorkRelated(issues, { baseUrl: c.baseUrl });
    catalogIssues = filterPastWorkIssues(issues, {
      includeDone: true,
      includeOpenSprint: true,
    });
    issues = filterPastWorkIssues(issues, {
      excludeKeys,
      includeDone: false,
      includeOpenSprint: true,
    });
  } else {
    for (const issue of issues) {
      issue.relatedTickets = [];
      issue.commentTicketCount = 0;
    }
  }

  // Active work first; Done / closed stories sink to the bottom
  issues = sortIssuesDoneLast(issues);
  const staleCount = issues.filter((i) => i.stale && !i.done).length;

  return {
    ok: true,
    issues,
    catalogIssues: pastWork ? catalogIssues : undefined,
    staleCount,
    total: data.total ?? issues.length,
    fetchedAt: new Date().toISOString(),
    jql,
    openSprint: usedOpenSprint,
    pastWork: Boolean(pastWork),
    sopStages: c.statusMap,
  };
}

async function getIssueUpdated(config, issueKeyOrId) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) {
    return { ok: false, error: missingAuthError(c) || "Jira not configured" };
  }
  const key = encodeURIComponent(String(issueKeyOrId || "").trim());
  if (!key) return { ok: false, error: "missing_issue" };
  try {
    const res = await jiraFetch(c, `/rest/api/3/issue/${key}?fields=updated`, {
      method: "GET",
    });
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: `/rest/api/3/issue/${key}`,
    });
    if (!parsed.parseOk) {
      return { ok: false, error: parsed.error, httpStatus: parsed.httpStatus || res.status };
    }
    if (!res.ok) {
      return { ok: false, error: formatJiraHttpError(res.status), httpStatus: res.status };
    }
    const data = parsed.data || {};
    return { ok: true, updated: data?.fields?.updated || null, id: data?.id, key: data?.key };
  } catch (err) {
    return { ok: false, error: err?.message || "Network error" };
  }
}

/** Collect Jira keys linked from queue cards (data[field] or KEY-123 in title/id). */
function collectLinkedIssueKeys(queueCards, cardKeyField = "jiraKey") {
  const field = String(cardKeyField || "jiraKey").trim() || "jiraKey";
  const keys = new Set();
  const keyRe = /\b([A-Z][A-Z0-9]+-\d+)\b/i;
  for (const card of queueCards || []) {
    const fromData = String(card?.data?.[field] || "").trim().toUpperCase();
    if (/^[A-Z][A-Z0-9]+-\d+$/i.test(fromData)) keys.add(fromData);
    for (const hay of [card?.title, card?.id]) {
      const m = String(hay || "").match(keyRe);
      if (m) keys.add(m[1].toUpperCase());
    }
  }
  return [...keys];
}

/**
 * Fetch a single issue for sync/UI when search JQL omitted it (e.g. status != Done).
 */
async function fetchIssueByKey(config, issueKey, { queueCards = [] } = {}) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) return null;
  const key = String(issueKey || "").trim();
  if (!key || /^LACT-\d+$/i.test(key)) return null;
  try {
    const fields = [
      "summary",
      "description",
      "status",
      "priority",
      "assignee",
      "updated",
      "issuetype",
      "labels",
      "reporter",
      "issuelinks",
    ];
    const res = await jiraFetch(
      c,
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields.join(",")}`,
      { method: "GET" }
    );
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: `/rest/api/3/issue/${encodeURIComponent(key)}`,
    });
    if (!parsed.parseOk || !res.ok) return null;
    const issue = parsed.data || {};
    const fieldsObj = issue.fields || {};
    const { days, score } = scoreIssue(fieldsObj);
    const stale = days >= c.staleDays;
    const linkedIssues = parseIssueLinks(fieldsObj.issuelinks);
    const row = {
      id: issue.id,
      key: issue.key,
      summary: fieldsObj.summary || "(no summary)",
      description: jiraAdfToText(fieldsObj.description),
      status: fieldsObj.status?.name || "—",
      priority: fieldsObj.priority?.name || "—",
      assignee: fieldsObj.assignee?.displayName || fieldsObj.assignee?.emailAddress || "Unassigned",
      assigneeEmail: fieldsObj.assignee?.emailAddress || "",
      updated: fieldsObj.updated || null,
      daysSinceUpdate: Math.round(days * 10) / 10,
      urgencyScore: score,
      stale,
      url: issueBrowseUrl(c.baseUrl, issue.key),
      issueType: fieldsObj.issuetype?.name || "Issue",
      labels: Array.isArray(fieldsObj.labels) ? fieldsObj.labels : [],
      linkedIssues,
      linkedKeys: linkedIssues.map((l) => l.key).filter(Boolean),
      fromLinkedFetch: true,
    };
    return enrichIssues([row], {
      statusMap: c.statusMap,
      queueCards,
      cardKeyField: c.cardKeyField,
    })[0];
  } catch {
    return null;
  }
}

/** Normalize Jira issuelinks into { key, summary, status, issueType, linkType }. */
function parseIssueLinks(rawLinks) {
  const out = [];
  const seen = new Set();
  for (const link of Array.isArray(rawLinks) ? rawLinks : []) {
    const linked = link?.outwardIssue || link?.inwardIssue || null;
    const key = String(linked?.key || "").trim();
    if (!key) continue;
    const up = key.toUpperCase();
    if (seen.has(up)) continue;
    seen.add(up);
    const f = linked?.fields || {};
    out.push({
      key,
      summary: String(f.summary || "").trim(),
      status: String(f.status?.name || "").trim(),
      issueType: String(f.issuetype?.name || "").trim(),
      linkType: String(link?.type?.name || link?.type?.outward || link?.type?.inward || "").trim(),
    });
  }
  return out;
}

const RELATED_STOPWORDS = new Set(["sample", "implement", "in", "the", "a"]);
const DISTINCTIVE_STOPWORDS = new Set([
  ...RELATED_STOPWORDS,
  "allow",
  "allows",
  "allowed",
  "user",
  "users",
  "view",
  "views",
  "their",
  "there",
  "this",
  "that",
  "them",
  "they",
  "then",
  "with",
  "from",
  "using",
  "into",
  "onto",
  "over",
  "under",
  "about",
  "after",
  "before",
  "being",
  "been",
  "have",
  "has",
  "had",
  "will",
  "would",
  "could",
  "should",
  "must",
  "able",
  "make",
  "made",
  "update",
  "updated",
  "create",
  "created",
  "please",
  "need",
  "needs",
  "want",
  "wants",
  "your",
  "our",
  "and",
  "or",
  "of",
  "on",
  "is",
  "are",
  "be",
  "an",
  "as",
  "by",
  "at",
  "to",
  "for",
  "app",
  "apps",
  "issue",
  "issues",
  "ticket",
  "tickets",
  "story",
  "stories",
  "task",
  "tasks",
  "fix",
  "bug",
  "error",
  "test",
  "tests",
  "feature",
  "request",
  "requests",
  "new",
  "add",
  "adds",
  "added",
]);
const SIMILAR_JACCARD_MIN = 0.67;
const SIMILAR_MIN_SIGNIFICANT = 2;

/** Strip sample wrappers so "… in SAMPLE" titles can match the shorter story. */
function normalizeRelatedStoryText(raw) {
  return String(raw || "")
    .replace(/\(sample\)/gi, " ")
    .replace(/\bin\s+sample\b/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relatedStoryTokens(raw) {
  const text = normalizeRelatedStoryText(raw);
  if (!text) return [];
  return [...new Set(text.split(" ").filter((tok) => tok && !RELATED_STOPWORDS.has(tok)))];
}

/** 2–4 rare words for live JQL. Never quote a whole sentence. */
function distinctiveSimilarTokens(raw) {
  const out = [];
  const seen = new Set();
  for (const tok of relatedStoryTokens(raw)) {
    if (tok.length < 5 || DISTINCTIVE_STOPWORDS.has(tok) || /^\d+$/.test(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= 4) break;
  }
  return out;
}

function similarSearchTokenGroups(issue) {
  const groups = [];
  const seen = new Set();
  const push = (raw) => {
    const tokens = distinctiveSimilarTokens(raw);
    if (tokens.length < 2) return;
    const key = tokens.join(" ");
    if (seen.has(key)) return;
    seen.add(key);
    groups.push(tokens);
  };
  // Visible Past body is description first; still search summary too.
  push(issue?.description);
  push(issue?.summary);
  if (!groups.length) push(`${issue?.summary || ""} ${issue?.description || ""}`);
  return groups.slice(0, 3);
}

function issueTextTokenSet(issue) {
  return new Set(
    relatedStoryTokens(`${issue?.summary || ""} ${issue?.description || ""}`)
  );
}

function issueTextHasTokens(issue, tokens, min = 2) {
  const wanted = (Array.isArray(tokens) ? tokens : [])
    .map((tok) => String(tok || "").toLowerCase())
    .filter(Boolean);
  if (wanted.length < min) return false;
  const hay = issueTextTokenSet(issue);
  let hits = 0;
  for (const tok of wanted) if (hay.has(tok)) hits += 1;
  return hits >= Math.min(min, wanted.length);
}

function issueSummaryHasTokens(issue, tokens) {
  return issueTextHasTokens(issue, tokens, Array.isArray(tokens) ? tokens.length : 2);
}

function parentDistinctiveTokens(issue) {
  const out = new Set();
  for (const group of similarSearchTokenGroups(issue)) {
    for (const tok of group) out.add(tok);
  }
  if (out.size < 2) {
    for (const tok of distinctiveSimilarTokens(`${issue?.summary || ""} ${issue?.description || ""}`)) {
      out.add(tok);
    }
  }
  return [...out];
}

function issueSharesParentTokens(parent, peer, min = 2) {
  return issueTextHasTokens(peer, parentDistinctiveTokens(parent), min);
}

function tokenSetOverlap(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size < SIMILAR_MIN_SIGNIFICANT || b.size < SIMILAR_MIN_SIGNIFICANT) return false;
  let inter = 0;
  for (const tok of a) if (b.has(tok)) inter += 1;
  if (inter < SIMILAR_MIN_SIGNIFICANT) return false;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  let subset = true;
  for (const tok of smaller) {
    if (!larger.has(tok)) {
      subset = false;
      break;
    }
  }
  if (subset) return true;
  const union = a.size + b.size - inter;
  return union > 0 && inter / union >= SIMILAR_JACCARD_MIN;
}

/** Containment or high token overlap between two titles/phrases. */
function storyTextsMatch(leftRaw, rightRaw) {
  const na = normalizeRelatedStoryText(leftRaw);
  const nb = normalizeRelatedStoryText(rightRaw);
  if (!na || !nb) return false;
  const ta = relatedStoryTokens(leftRaw);
  const tb = relatedStoryTokens(rightRaw);
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  const shortTokens = na.length <= nb.length ? ta : tb;
  if (shortTokens.length >= SIMILAR_MIN_SIGNIFICANT && longer.includes(shorter)) {
    return true;
  }
  return tokenSetOverlap(ta, tb);
}

/**
 * Related Jira stories are summary matches only.
 * Compare summaries to each other, and one issue's summary to the other's description.
 * Do not match description-to-description (that false-links comment/catalog peers).
 */
function summariesShareDistinctiveToken(leftRaw, rightRaw) {
  const a = new Set(distinctiveSimilarTokens(leftRaw));
  const b = new Set(distinctiveSimilarTokens(rightRaw));
  if (!a.size || !b.size) return false;
  const shared = [];
  for (const tok of a) if (b.has(tok)) shared.push(tok);
  if (shared.some((tok) => tok.length >= 7)) return true;
  return shared.length >= 2;
}

function storiesAreSimilar(left, right) {
  const leftKey = normalizeScrapedTicketKey(left?.key);
  const rightKey = normalizeScrapedTicketKey(right?.key);
  if (!leftKey || !rightKey || leftKey === rightKey) return false;
  const leftSummary = String(left?.summary || "").trim();
  const rightSummary = String(right?.summary || "").trim();
  const leftDesc = String(left?.description || "").trim();
  const rightDesc = String(right?.description || "").trim();
  if (storyTextsMatch(leftSummary, rightSummary)) return true;
  if (summariesShareDistinctiveToken(leftSummary, rightSummary)) return true;
  if (leftSummary && rightDesc && storyTextsMatch(leftSummary, rightDesc)) return true;
  if (rightSummary && leftDesc && storyTextsMatch(rightSummary, leftDesc)) return true;
  return similarSearchTokenGroups(left).some((tokens) => issueSummaryHasTokens(right, tokens));
}

/** Related Jira stories: similar summary/description, never the parent key itself. */
function storiesAreRelated(left, right) {
  return storiesAreSimilar(left, right);
}

function isPinnedSimilarTicket(item) {
  return String(item?.source || "").toLowerCase() === "similar";
}

function pinSimilarSearchHits(parent, hits, baseUrl = "") {
  const pinned = [];
  const parentKey = normalizeScrapedTicketKey(parent?.key);
  for (const hit of Array.isArray(hits) ? hits : []) {
    const row = toRelatedTicketRow({ ...hit, source: "similar" }, "similar", baseUrl);
    if (!row || !isJiraIssueKey(row.key) || row.key === parentKey) continue;
    pinned.push({
      ...row,
      description: String(hit?.description || "").trim(),
      source: "similar",
    });
  }
  parent.similarSearchHits = pinned;
  parent.relatedTickets = mergeRelatedTickets(parent.relatedTickets, pinned);
  return pinned;
}

function pastWorkFoldKeys(issue) {
  const parent = normalizeScrapedTicketKey(issue?.key);
  const jira = [];
  const ops = [];
  const seen = new Set();
  for (const row of Array.isArray(issue?.relatedTickets) ? issue.relatedTickets : []) {
    const key = normalizeScrapedTicketKey(row?.key || row);
    if (!key || key === parent || seen.has(key)) continue;
    seen.add(key);
    if (isJiraIssueKey(key)) jira.push(key);
    else if (isOpsTicketKey(key)) ops.push(key);
  }
  jira.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { jira, ops, all: [...jira, ...ops] };
}

function pastWorkFoldHtml(issue) {
  const { jira, ops } = pastWorkFoldKeys(issue);
  const buttons = jira
    .map((key) => `<button class="jira-key">${key}</button>`)
    .join("");
  const opsText = ops.join(", ");
  return `${buttons}${opsText ? `(${opsText})` : ""}`;
}

function toRelatedTicketRow(item, source, baseUrl = "") {
  const key = normalizeScrapedTicketKey(item?.key || item);
  if (!key) return null;
  const summary = String(item?.summary || "").trim();
  const status = String(item?.status || "").trim();
  const url =
    String(item?.url || "").trim() ||
    (isJiraIssueKey(key) && baseUrl ? issueBrowseUrl(baseUrl, key) : "");
  return {
    key,
    summary,
    status,
    url,
    source: source || String(item?.source || "").trim() || "story",
    kind: String(item?.kind || "").trim(),
    autoQuery: String(item?.autoQuery || "").trim(),
  };
}

/**
 * Ops ticket numbers from comments/description always stay.
 * Related Jira keys must match by summary (or summary vs description), never
 * because they were mentioned in comments.
 */
function selectRelatedTickets(
  issue,
  { scraped = [], linked = [], batch = [], hopOps = [], hopStories = [], baseUrl = "" } = {}
) {
  const parent = normalizeScrapedTicketKey(issue?.key);
  const ops = [];
  for (const item of [...scraped, ...hopOps]) {
    const row = toRelatedTicketRow(item, item?.source || "comment", baseUrl);
    if (!row || row.key === parent) continue;
    if (isJiraIssueKey(row.key)) continue;
    ops.push(row);
  }
  const matchedJira = [];
  for (const item of linked) {
    const row = toRelatedTicketRow(item, item?.source || "link", baseUrl);
    if (!row || row.key === parent || !isJiraIssueKey(row.key)) continue;
    if (
      storiesAreRelated(issue, {
        key: row.key,
        summary: row.summary,
        description: String(item?.description || "").trim(),
      })
    ) {
      matchedJira.push({ ...row, source: "similar" });
    }
  }
  const similar = similarRelatedFromIssues(issue, batch, { baseUrl, includeDone: true });
  const hopRelated = [];
  for (const other of hopStories) {
    const key = normalizeScrapedTicketKey(other?.key);
    if (!key || key === parent || !isJiraIssueKey(key)) continue;
    if (!storiesAreRelated(issue, other)) continue;
    hopRelated.push(toRelatedTicketRow({ ...other, key }, "similar", baseUrl));
  }
  const searchHits = [];
  for (const item of issue.similarSearchHits || []) {
    const row = toRelatedTicketRow({ ...item, source: "similar" }, "similar", baseUrl);
    if (!row || row.key === parent || !isJiraIssueKey(row.key)) continue;
    searchHits.push(row);
  }
  return mergeRelatedTickets(ops, similar, matchedJira, hopRelated, searchHits).filter(
    (item) => normalizeScrapedTicketKey(item.key) !== parent
  );
}

function similarRelatedFromIssues(issue, allIssues, baseUrlOrOpts = "") {
  const opts =
    typeof baseUrlOrOpts === "string"
      ? { baseUrl: baseUrlOrOpts, includeDone: false }
      : {
          baseUrl: String(baseUrlOrOpts?.baseUrl || ""),
          includeDone: Boolean(baseUrlOrOpts?.includeDone),
        };
  const parent = normalizeScrapedTicketKey(issue?.key);
  const out = [];
  for (const other of Array.isArray(allIssues) ? allIssues : []) {
    const key = normalizeScrapedTicketKey(other?.key);
    if (!key || key === parent || !isJiraIssueKey(key)) continue;
    if (!opts.includeDone && isPastWorkDoneIssue(other)) continue;
    if (!storiesAreRelated(issue, other)) continue;
    out.push({
      key,
      summary: String(other.summary || "").trim(),
      status: String(other.status || "").trim(),
      url: other.url || (opts.baseUrl ? issueBrowseUrl(opts.baseUrl, key) : ""),
      source: "similar",
    });
  }
  return out;
}

function projectKeyFromIssueKey(key) {
  const match = String(key || "").trim().match(/^([A-Z][A-Z0-9]{1,9})-\d+$/i);
  return match ? match[1].toUpperCase() : "";
}

/** Distinctive token groups as phrases (for tests / logs). Never a full sentence. */
function similarSearchPhrases(issue) {
  return similarSearchTokenGroups(issue).map((tokens) => tokens.join(" "));
}

function similarSearchTokensFromPhrase(phrase) {
  const fromDistinct = distinctiveSimilarTokens(phrase);
  if (fromDistinct.length >= 2) return fromDistinct;
  return String(phrase || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 5 && !DISTINCTIVE_STOPWORDS.has(tok))
    .slice(0, 4);
}

function buildRecentAssignedIssueJql({ excludeKey = "" } = {}) {
  const parent = normalizeScrapedTicketKey(excludeKey);
  const notSelf = isJiraIssueKey(parent) ? ` AND key != ${parent}` : "";
  return `assignee = currentUser()${notSelf} ORDER BY updated DESC`;
}

function buildSimilarIssueJql({ projectKey = "", phrase = "", tokens = [], excludeKey = "" } = {}) {
  const safe = [
    ...new Set(
      (Array.isArray(tokens) && tokens.length ? tokens : similarSearchTokensFromPhrase(phrase))
        .map((tok) => sanitizeJqlPhrase(tok).toLowerCase())
        .filter((tok) => tok.length >= 3)
    ),
  ].slice(0, 2);
  if (safe.length < 2) return "";
  const summaryAnd = safe.map((tok) => `summary ~ "${tok}"`).join(" AND ");
  const descAnd = safe.map((tok) => `description ~ "${tok}"`).join(" AND ");
  const textAnd = safe.map((tok) => `text ~ "${tok}"`).join(" AND ");
  const text = `((${summaryAnd}) OR (${descAnd}) OR (${textAnd}))`;
  void projectKey;
  const parent = normalizeScrapedTicketKey(excludeKey);
  const notSelf = isJiraIssueKey(parent) ? ` AND key != ${parent}` : "";
  return `assignee = currentUser() AND ${text}${notSelf} ORDER BY updated DESC`;
}
function collectFollowJiraKeys(issue, batch = []) {
  return similarRelatedFromIssues(issue, batch, { includeDone: true }).map((row) => row.key);
}

function opsTicketsFromPeerText(text, parentKey, followKey) {
  return extractTicketRefs(text, {
    excludeKey: parentKey,
    excludeKeys: [followKey],
  })
    .filter((item) => isOpsTicketKey(item.key))
    .map((item) => ({
      key: item.key,
      summary: "",
      source: "comment",
    }));
}

/**
 * Keep ops tickets from comments. Keep Jira keys only when summaries match.
 */
function filterRelatedTickets(parentIssue, related, allIssues = []) {
  const parentKey = normalizeScrapedTicketKey(parentIssue?.key);
  const pinned = new Set(
    (parentIssue?.similarSearchHits || [])
      .map((item) => normalizeScrapedTicketKey(item?.key))
      .filter(Boolean)
  );
  return (related || []).filter((item) => {
    const key = normalizeScrapedTicketKey(item?.key);
    if (!key || key === parentKey) return false;
    if (!isJiraIssueKey(key)) return true;
    if (isPinnedSimilarTicket(item) || pinned.has(key)) return true;
    const peer = (Array.isArray(allIssues) ? allIssues : []).find(
      (row) => normalizeScrapedTicketKey(row?.key) === key
    );
    return storiesAreRelated(parentIssue, {
      key,
      summary: String(peer?.summary || item?.summary || "").trim(),
      description: String(peer?.description || item?.description || "").trim(),
    });
  });
}

function keepPreviousRelatedJira(parent, item, catalog) {
  const key = normalizeScrapedTicketKey(item?.key);
  if (!key || !isJiraIssueKey(key) || key === normalizeScrapedTicketKey(parent?.key)) {
    return false;
  }
  if (isPinnedSimilarTicket(item)) return true;
  const peer = catalog.get(key);
  if (!peer) return true;
  if (storiesAreRelated(parent, peer)) return true;
  return similarSearchTokenGroups(parent).some((tokens) => issueSummaryHasTokens(peer, tokens));
}

function catalogByKey(issues) {
  const map = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const key = normalizeScrapedTicketKey(issue?.key);
    if (key) map.set(key, issue);
  }
  return map;
}

/**
 * Rebuild related lists from summary matches + harvested ops.
 * Keep previously nested Jira keys unless a catalog peer proves they are unrelated
 * (MBA-1 / MBA-2). Never blank a fold because this scrape omitted MBA-3.
 */
function finalizePastWorkRelated(issues, { baseUrl = "" } = {}) {
  const rows = Array.isArray(issues) ? issues : [];
  const catalog = catalogByKey(rows);
  for (const issue of rows) {
    const prev = Array.isArray(issue.relatedTickets) ? issue.relatedTickets : [];
    const ops = prev.filter((item) => isOpsTicketKey(item?.key));
    const similar = similarRelatedFromIssues(issue, rows, {
      includeDone: true,
      baseUrl: baseUrl || String(issue?.url || "").replace(/\/browse\/[^/]+$/i, ""),
    });
    const keptPrev = prev.filter((item) => keepPreviousRelatedJira(issue, item, catalog));
    const searchHits = [
      ...(issue.similarSearchHits || []),
      ...prev.filter((item) => isPinnedSimilarTicket(item)),
    ];
    issue.relatedTickets = mergeRelatedTickets(ops, similar, keptPrev, searchHits);
  }
  return rows;
}

/**
 * Union live scrape with last-good cache. Empty scrape related/ops must not wipe a fold.
 */
function mergeScrapedPastWork(existingIssues, scrapedIssues, { baseUrl = "" } = {}) {
  const existingByKey = catalogByKey(existingIssues);
  const scraped = Array.isArray(scrapedIssues) ? scrapedIssues : [];
  const combined = [];
  const seen = new Set();
  for (const incoming of scraped) {
    const key = normalizeScrapedTicketKey(incoming?.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const previous = existingByKey.get(key);
    const incomingRel = Array.isArray(incoming?.relatedTickets) ? incoming.relatedTickets : [];
    const previousRel = Array.isArray(previous?.relatedTickets) ? previous.relatedTickets : [];
    const incomingJira = incomingRel.filter((item) => isJiraIssueKey(item?.key));
    const incomingOps = incomingRel.filter((item) => isOpsTicketKey(item?.key));
    const previousJira = previousRel.filter((item) => isJiraIssueKey(item?.key));
    const previousOps = previousRel.filter((item) => isOpsTicketKey(item?.key));
    const ops = incomingOps.length
      ? mergeRelatedTickets(previousOps, incomingOps)
      : previousOps;
    const jira = mergeRelatedTickets(previousJira, incomingJira);
    const relatedTickets = mergeRelatedTickets(ops, jira);
    const description =
      String(incoming?.description || "").trim() || String(previous?.description || "").trim();
    combined.push({
      ...(previous || {}),
      ...incoming,
      description,
      relatedTickets,
    });
  }
  for (const previous of Array.isArray(existingIssues) ? existingIssues : []) {
    const key = normalizeScrapedTicketKey(previous?.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    combined.push(previous);
  }
  return finalizePastWorkRelated(combined, { baseUrl });
}

function mergeRelatedTickets(...groups) {
  const byKey = new Map();
  for (const group of groups) {
    for (const item of group || []) {
      const key = normalizeScrapedTicketKey(item?.key || item);
      if (!key) continue;
      const prev = byKey.get(key) || {
        key,
        summary: "",
        status: "",
        url: "",
        source: "story",
        kind: "",
        autoQuery: "",
      };
      const nextSummary = String(item?.summary || "").trim();
      const nextStatus = String(item?.status || "").trim();
      const nextUrl = String(item?.url || "").trim();
      const nextSource = String(item?.source || "").trim();
      const nextKind = String(item?.kind || "").trim();
      const nextQuery = String(item?.autoQuery || "").trim();
      byKey.set(key, {
        key,
        // Last non-empty wins so a later fetch of THIS key can fill summary
        // without inheriting another issue's text.
        summary: nextSummary || prev.summary,
        status: nextStatus || prev.status,
        url: nextUrl || prev.url,
        source: nextSource || prev.source || "story",
        kind: nextKind || prev.kind,
        autoQuery: nextQuery || prev.autoQuery,
      });
    }
  }
  return [...byKey.values()];
}

async function fetchTicketSummaries(config, keys) {
  const c = normalizeConfig(config);
  const map = new Map();
  const jiraKeys = [
    ...new Set(
      keys
        .flatMap((raw) => {
          const key = String(raw || "").toUpperCase();
          const extra = [];
          const snow = key.match(/^(RITM|INC|CHG|CRQ|SCTASK|PRB|CTASK|PTASK|KB|CR)(\d+)$/);
          if (snow) extra.push(`${snow[1]}-${snow[2]}`);
          return [key, ...extra];
        })
        .filter(isJiraIssueKey)
    ),
  ];
  const chunkSize = 40;
  for (let i = 0; i < jiraKeys.length; i += chunkSize) {
    const chunk = jiraKeys.slice(i, i + chunkSize);
    const jql = `key in (${chunk.join(",")})`;
    const payload = { jql, maxResults: chunk.length, fields: ["summary", "status"] };
    try {
      const getPath = buildSearchJqlGetPath("/rest/api/3/search/jql", payload);
      let res =
        getPath.length <= 1800
          ? await jiraFetch(c, getPath, { method: "GET" })
          : null;
      if (!res || searchJqlGetNotSupported(res.status)) {
        res = await jiraFetch(c, "/rest/api/3/search/jql", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      const parsed = await parseJiraHttpResponse(res, {
        baseUrl: c.baseUrl,
        pathname: "/rest/api/3/search/jql",
      });
      if (!parsed.parseOk || !res.ok) continue;
      for (const issue of parsed.data?.issues || []) {
        const key = normalizeScrapedTicketKey(issue?.key);
        if (!key || !isJiraIssueKey(key)) continue;
        map.set(key, {
          key,
          summary: String(issue.fields?.summary || "").trim(),
          status: String(issue.fields?.status?.name || "").trim(),
          url: issueBrowseUrl(c.baseUrl, key),
        });
      }
    } catch {
      /* skip this chunk */
    }
  }
  return map;
}

function decodeHrefEntity(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : " ";
    });
}

function decodeHrefText(href) {
  const raw = decodeHrefEntity(href).replace(/\+/g, " ");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function htmlToPlain(html) {
  return decodeHrefEntity(String(html || ""))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>/gi, (_, _q, href) => ` ${decodeHrefText(href)} `)
    .replace(/<a\b[^>]*\bhref\s*=\s*([^\s>"']+)[^>]*>/gi, (_, href) => ` ${decodeHrefText(href)} `)
    .replace(/<(?:img|source)\b[^>]*(?:src|data-file-name)\s*=\s*["']([^"']+)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

const SKIP_SCRAPE_KEYS = new Set([
  "avatarurls",
  "iconurl",
  "self",
  "accountid",
  "timezone",
]);

function collectScrapeText(value, out, depth = 0) {
  if (depth > 8 || value == null) return;
  if (typeof value === "string") {
    if (value) out.push(value);
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectScrapeText(item, out, depth + 1);
    return;
  }
  if (value.type && (value.content || value.text || value.marks || value.attrs)) {
    const adf = jiraAdfToText(value);
    if (adf) out.push(adf);
  }
  for (const [key, nested] of Object.entries(value)) {
    if (SKIP_SCRAPE_KEYS.has(String(key || "").toLowerCase())) continue;
    collectScrapeText(nested, out, depth + 1);
  }
}

function commentToScrapeText(comment) {
  const parts = [];
  parts.push(jiraAdfToText(comment?.body));
  parts.push(htmlToPlain(comment?.renderedBody));
  collectScrapeText(comment, parts);
  return parts.filter(Boolean).join("\n");
}

function buildIssueCommentPath(issueKey, { startAt, maxResults, orderBy, expand, nextPageToken, bustCache }) {
  const params = new URLSearchParams();
  params.set("startAt", String(startAt || 0));
  params.set("maxResults", String(maxResults || 100));
  if (orderBy) params.set("orderBy", orderBy);
  if (expand) params.set("expand", expand);
  if (nextPageToken) params.set("nextPageToken", String(nextPageToken));
  return withNoCacheQuery(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?${params.toString()}`,
    bustCache
  );
}

function commentQueryRejected(status, errorText) {
  const code = Number(status) || 0;
  if (code !== 400 && code !== 422) return false;
  const text = String(errorText || "").toLowerCase();
  return (
    !text ||
    text.includes("orderby") ||
    text.includes("order by") ||
    text.includes("expand") ||
    text.includes("renderedbody") ||
    text.includes("startat")
  );
}

async function fetchIssueCommentPages(c, key, { orderBy, expand, forceRefresh, maxPages = 8 } = {}) {
  const parts = [];
  const seen = new Set();
  let startAt = 0;
  let nextPageToken = "";
  const pageSize = 100;
  const pageCap = Math.max(1, Math.min(8, Number(maxPages) || 8));
  for (let page = 0; page < pageCap; page++) {
    const path = buildIssueCommentPath(key, {
      startAt,
      maxResults: pageSize,
      orderBy,
      expand,
      nextPageToken,
      bustCache: forceRefresh !== false,
    });
    let res;
    try {
      res = await jiraFetch(c, path, { method: "GET", forceRefresh: forceRefresh !== false });
    } catch (err) {
      return { ok: false, status: 0, error: err?.message || "network", text: parts.join("\n") };
    }
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
    });
    if (!parsed.parseOk || !res.ok) {
      return {
        ok: false,
        status: res?.status || 0,
        error: parseJiraErrorBody(parsed.data) || parsed.error || "",
        text: parts.join("\n"),
      };
    }
    const batch = Array.isArray(parsed.data?.comments)
      ? parsed.data.comments
      : Array.isArray(parsed.data?.values)
        ? parsed.data.values
        : [];
    let added = 0;
    for (const comment of batch) {
      const id = String(comment?.id || comment?.self || "");
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const text = commentToScrapeText(comment);
      if (text) {
        parts.push(text);
        added += 1;
      } else if (!id) {
        parts.push(jiraAdfToText(comment?.body) || htmlToPlain(comment?.renderedBody));
      }
    }
    const total = Number(parsed.data?.total) || 0;
    const token = String(parsed.data?.nextPageToken || "").trim();
    if (token) {
      if (token === nextPageToken) break;
      nextPageToken = token;
      startAt += batch.length;
      continue;
    }
    nextPageToken = "";
    // Advance by returned rows — using maxResults skips newest comments when
    // Cloud ignores startAt or returns a smaller page than requested.
    startAt += Math.max(batch.length, 0);
    if (!batch.length) break;
    if (total && seen.size >= total) break;
    if (total && startAt >= total) break;
    if (!added && batch.length && seen.size > 0) break;
    if (!total && batch.length < pageSize) break;
  }
  return { ok: true, status: 200, text: parts.join("\n") };
}

async function fetchIssueCommentText(config, issueKey, { forceRefresh = false } = {}) {
  const c = normalizeConfig(config);
  const key = String(issueKey || "").trim();
  if (!key) return "";
  // Newest-first first so a broken startAt still captures the latest comments.
  const variants = [
    { orderBy: "-created", expand: "renderedBody" },
    { orderBy: "", expand: "" },
  ];
  let fallback = "";
  for (const variant of variants) {
    const result = await fetchIssueCommentPages(c, key, { ...variant, forceRefresh });
    if (result.ok) return result.text;
    if (result.text) fallback = result.text;
    if (!commentQueryRejected(result.status, result.error)) {
      return fallback;
    }
  }
  return fallback;
}

async function fetchIssueExtraScrape(config, issueKey, { forceRefresh = false } = {}) {
  const c = normalizeConfig(config);
  const key = String(issueKey || "").trim();
  if (!key) return { text: "", summary: "", status: "", statusCategory: "", key: "" };
  const parts = [];
  let summary = "";
  let status = "";
  let statusCategory = "";
  try {
    const path = withNoCacheQuery(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=description,comment,attachment,issuelinks,summary,status,environment&expand=renderedFields`,
      forceRefresh
    );
    const res = await jiraFetch(c, path, { method: "GET", forceRefresh });
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: `/rest/api/3/issue/${encodeURIComponent(key)}`,
    });
    if (parsed.parseOk && res.ok) {
      const fields = parsed.data?.fields || {};
      const rendered = parsed.data?.renderedFields || {};
      summary = String(fields.summary || "").trim();
      status = String(fields.status?.name || "").trim();
      statusCategory = String(fields.status?.statusCategory?.key || "").toLowerCase();
      parts.push(summary);
      parts.push(jiraAdfToText(fields.description));
      parts.push(jiraAdfToText(fields.environment));
      parts.push(htmlToPlain(rendered.description));
      parts.push(htmlToPlain(rendered.comment));
      parts.push(htmlToPlain(rendered.environment));
      collectScrapeText(fields, parts);
      collectScrapeText(rendered, parts);
      for (const file of fields.attachment || []) {
        parts.push(String(file?.filename || file?.name || ""));
      }
      for (const link of parseIssueLinks(fields.issuelinks)) {
        parts.push(`${link.key} ${link.summary || ""}`);
      }
      const nestedComments = fields.comment?.comments || [];
      for (const comment of nestedComments) {
        parts.push(commentToScrapeText(comment));
      }
    }
  } catch {
    /* optional */
  }
  try {
    let startAt = 0;
    for (let page = 0; page < 2; page++) {
      const path = withNoCacheQuery(
        `/rest/api/3/issue/${encodeURIComponent(key)}/changelog?startAt=${startAt}&maxResults=100`,
        forceRefresh
      );
      const res = await jiraFetch(c, path, { method: "GET", forceRefresh });
      const parsed = await parseJiraHttpResponse(res, {
        baseUrl: c.baseUrl,
        pathname: `/rest/api/3/issue/${encodeURIComponent(key)}/changelog`,
      });
      if (!parsed.parseOk || !res.ok) break;
      const batch = parsed.data?.values || parsed.data?.histories || [];
      for (const entry of batch) {
        for (const item of entry.items || []) {
          parts.push(String(item.fromString || ""));
          parts.push(String(item.toString || ""));
        }
      }
      const total = Number(parsed.data?.total) || 0;
      startAt += batch.length;
      if (!batch.length || parsed.data?.isLast || (total && startAt >= total)) break;
    }
  } catch {
    /* optional */
  }
  try {
    const res = await jiraFetch(
      c,
      withNoCacheQuery(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`, forceRefresh),
      { method: "GET", forceRefresh }
    );
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: `/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`,
    });
    const links = Array.isArray(parsed.data) ? parsed.data : parsed.data?.values || [];
    for (const link of links) {
      parts.push(String(link?.object?.title || ""));
      parts.push(String(link?.object?.url || ""));
      parts.push(String(link?.relationship || ""));
    }
  } catch {
    /* optional */
  }
  return {
    text: parts.filter(Boolean).join("\n"),
    summary,
    status,
    statusCategory,
    key: String(key).toUpperCase(),
  };
}

async function fetchIssueExtraScrapeText(config, issueKey) {
  return (await fetchIssueExtraScrape(config, issueKey, { forceRefresh: true })).text;
}

async function mapPool(items, limit, worker) {
  const rows = Array.isArray(items) ? items : [];
  const out = new Array(rows.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit || 5, rows.length || 1));
  await Promise.all(
    Array.from({ length: Math.min(n, rows.length) }, async () => {
      while (next < rows.length) {
        const index = next;
        next += 1;
        out[index] = await worker(rows[index], index);
      }
    })
  );
  return out;
}

async function attachScrapedTickets(config, issues, { forceRefresh = true, budgetMs = 18000 } = {}) {
  const c = normalizeConfig(config);
  const rows = Array.isArray(issues) ? issues : [];
  const started = Date.now();
  const budget = Math.max(2000, Number(budgetMs) || 18000);
  const expired = () => Date.now() - started >= budget;
  const scrapeCache = new Map();
  const scrapeKey = (key) => {
    const norm = normalizeScrapedTicketKey(key) || String(key || "").trim();
    if (!norm) return Promise.resolve({ comments: "", extra: { text: "" } });
    if (scrapeCache.has(norm)) return scrapeCache.get(norm);
    const pending = Promise.all([
      fetchIssueCommentText(c, key, { forceRefresh }),
      fetchIssueExtraScrape(c, key, { forceRefresh }),
    ])
      .then(([comments, extra]) => ({ comments, extra }))
      .catch(() => ({ comments: "", extra: { text: "" } }));
    scrapeCache.set(norm, pending);
    return pending;
  };
  const extraHits = [];
  const openParents = rows.filter((issue) => issue?.key && !isPastWorkDoneIssue(issue));
  const similarStarted = Date.now();
  const similarBudget = Math.min(budget, Math.max(4000, Math.floor(budget * 0.75)));
  const similarRows = await mapPool(openParents, 3, async (parent) => {
    const remaining = similarBudget - (Date.now() - similarStarted);
    if (remaining < 400) return [];
    try {
      return await findSimilarPastIssues(c, parent, {
        maxResults: 20,
        forceRefresh,
        timeoutMs: Math.min(4500, remaining),
      });
    } catch {
      return [];
    }
  });
  openParents.forEach((parent, index) => {
    const hits = Array.isArray(similarRows[index]) ? similarRows[index] : [];
    pinSimilarSearchHits(parent, hits, c.baseUrl);
  });
  for (const hits of similarRows) {
    if (Array.isArray(hits)) extraHits.push(...hits);
  }
  const have = new Set(rows.map((row) => normalizeScrapedTicketKey(row.key)).filter(Boolean));
  for (const hit of extraHits) {
    const key = normalizeScrapedTicketKey(hit?.key);
    if (!key || have.has(key) || !isJiraIssueKey(key)) continue;
    have.add(key);
    rows.push(hit);
  }
  await mapPool(rows, 3, async (issue) => {
    if (expired()) return issue;
    try {
      const { comments, extra } = await scrapeKey(issue.key);
      issue.commentBodies = [issue.commentBodies || issue.commentText, comments]
        .filter(Boolean)
        .join("\n");
      issue.commentText = [issue.commentText, comments, extra.text].filter(Boolean).join("\n");
    } catch {
      /* keep comments from search */
    }
    return issue;
  });
  const relatedArgs = (issue, extra = {}) => {
    const fromStory = extractTicketRefs(`${issue.summary || ""}\n${issue.description || ""}`, {
      excludeKey: issue.key,
    }).map((item) => ({ key: item.key, summary: "", source: "story" }));
    const fromComments = extractTicketRefs(issue.commentText || "", {
      excludeKey: issue.key,
    }).map((item) => ({ key: item.key, summary: "", source: "comment" }));
    const linked = (issue.linkedIssues || []).map((item) => ({
      key: item.key,
      summary: item.summary,
      status: item.status,
      url: isJiraIssueKey(item.key) ? issueBrowseUrl(c.baseUrl, item.key) : "",
      source: "link",
    }));
    return {
      scraped: [...fromComments, ...fromStory],
      linked,
      batch: rows,
      baseUrl: c.baseUrl,
      ...extra,
    };
  };
  for (const issue of rows) {
    const args = relatedArgs(issue);
    issue.relatedTickets = selectRelatedTickets(issue, args);
    issue.commentTicketCount = args.scraped.filter((row) => row.source === "comment").length;
    issue._mentionedJiraKeys = [
      ...new Set(
        args.scraped
          .map((row) => normalizeScrapedTicketKey(row.key))
          .filter((key) => isJiraIssueKey(key) && key !== normalizeScrapedTicketKey(issue.key))
      ),
    ];
  }
  await mapPool(rows, 3, async (issue) => {
    if (expired()) return issue;
    const followKeys = collectFollowJiraKeys(issue, rows).slice(0, 8);
    const hopOps = [];
    const hopStories = [];
    for (const followKey of followKeys) {
      if (expired()) break;
      try {
        const peer = rows.find(
          (row) => normalizeScrapedTicketKey(row.key) === followKey
        );
        if (peer) {
          hopOps.push(
            ...opsTicketsFromPeerText(
              `${peer.summary || ""}\n${peer.description || ""}\n${peer.commentText || ""}`,
              issue.key,
              followKey
            )
          );
          if (peer.commentText || peer.description || peer.summary) {
            issue.commentText = [
              issue.commentText,
              peer.summary,
              peer.description,
              peer.commentText,
            ]
              .filter(Boolean)
              .join("\n");
          }
          if (peer.commentBodies || peer.commentText) {
            issue.commentBodies = [issue.commentBodies, peer.commentBodies || peer.commentText]
              .filter(Boolean)
              .join("\n");
          }
          if (!isPastWorkDoneIssue(peer)) {
            hopStories.push({
              key: followKey,
              summary: peer.summary || "",
              status: peer.status || "",
              statusCategory: peer.statusCategory || "",
              url: issueBrowseUrl(c.baseUrl, followKey),
            });
          }
          continue;
        }
        const { comments, extra } = await scrapeKey(followKey);
        hopOps.push(
          ...opsTicketsFromPeerText(`${comments}\n${extra.text}`, issue.key, followKey)
        );
        if (comments || extra.text) {
          issue.commentText = [issue.commentText, comments, extra.text].filter(Boolean).join("\n");
        }
        if (comments) {
          issue.commentBodies = [issue.commentBodies, comments].filter(Boolean).join("\n");
        }
        hopStories.push({
          key: followKey,
          summary: extra.summary || "",
          status: extra.status || "",
          statusCategory: extra.statusCategory || "",
          url: issueBrowseUrl(c.baseUrl, followKey),
        });
      } catch {
        /* skip this mentioned story; still harvest nothing */
      }
    }
    issue.relatedTickets = selectRelatedTickets(issue, relatedArgs(issue, { hopOps, hopStories }));
    delete issue._mentionedJiraKeys;
    return issue;
  });
  const wanted = [];
  for (const issue of rows) {
    for (const item of issue.relatedTickets || []) wanted.push(item.key);
  }
  const summaries = expired() ? new Map() : await fetchTicketSummaries(c, wanted);
  for (const issue of rows) {
    const parent = normalizeScrapedTicketKey(issue.key);
    const parentSummary = String(issue.summary || "").trim();
    const parentDesc = String(issue.description || "").trim();
    issue.relatedTickets = (issue.relatedTickets || [])
      .filter((item) => {
        const up = normalizeScrapedTicketKey(item.key);
        if (!up || up === parent) return false;
        if (!isJiraIssueKey(up)) return true;
        if (isPinnedSimilarTicket(item)) return true;
        const sibling = rows.find((row) => normalizeScrapedTicketKey(row.key) === up);
        return storiesAreRelated(issue, {
          key: up,
          summary: sibling?.summary || item.summary || "",
          description: sibling?.description || item.description || "",
        });
      })
      .map((item) => {
        const up = normalizeScrapedTicketKey(item.key);
        const hyphen =
          up.match(/^(RITM|INC|CHG|CRQ|SCTASK|PRB|CTASK|PTASK|KB|CR)(\d+)$/)
            ? `${RegExp.$1}-${RegExp.$2}`
            : "";
        const hit = summaries.get(up) || (hyphen ? summaries.get(hyphen) : null);
        const hitKey = normalizeScrapedTicketKey(hit?.key);
        const ownHit = hit && (hitKey === up || (hyphen && hitKey === hyphen)) ? hit : null;
        const ownSummary = String(ownHit?.summary || "").trim();
        const itemSummary = String(item.summary || "").trim();
        let summary = ownSummary || itemSummary;
        if (parentSummary && summary === parentSummary) summary = "";
        if (parentDesc && summary === parentDesc) summary = "";
        const url =
          item.url ||
          ownHit?.url ||
          (isJiraIssueKey(item.key) ? issueBrowseUrl(c.baseUrl, item.key) : "");
        return {
          key: item.key,
          summary,
          kind: item.kind || ticketKindLabel(item.key),
          autoQuery: item.autoQuery || ticketLookupQuery(item.key),
          status: ownHit?.status || item.status || "",
          url: ownHit?.url || url,
          source: item.source || "story",
        };
      });
    issue.relatedTickets = filterRelatedTickets(issue, issue.relatedTickets, rows);
    enrichRelatedTicketsFromComments(issue);
    attachCommentSource(issue);
  }
  const finalized = finalizePastWorkRelated(rows, { baseUrl: c.baseUrl });
  for (const issue of finalized) {
    if (!issue?.key || isPastWorkDoneIssue(issue)) continue;
    const keys = (issue.relatedTickets || []).map((row) => row.key).join(",");
    console.log(`[livetrack] past related ${issue.key} relatedTickets=${keys || "(none)"}`);
  }
  return finalized;
}

function sortIssuesDoneLast(issues) {
  return [...(issues || [])].sort((a, b) => {
    const aDone = a.done ? 1 : 0;
    const bDone = b.done ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return b.urgencyScore - a.urgencyScore || b.daysSinceUpdate - a.daysSinceUpdate;
  });
}

/**
 * Ensure every queue-linked Jira key is present in the issue list (even if JQL hid Done).
 * Mutates/returns a search-result-shaped object.
 */
async function ensureLinkedIssues(config, searchResult, queueCards = []) {
  const c = normalizeConfig(config);
  const base = searchResult && typeof searchResult === "object" ? { ...searchResult } : {};
  let issues = Array.isArray(base.issues) ? [...base.issues] : [];
  const have = new Set(issues.map((i) => String(i.key || "").toUpperCase()).filter(Boolean));
  const needed = collectLinkedIssueKeys(queueCards, c.cardKeyField).filter((k) => !have.has(k));
  if (!needed.length) {
    base.issues = sortIssuesDoneLast(issues);
    return base;
  }
  const fetched = await Promise.all(
    needed.map((key) => fetchIssueByKey(c, key, { queueCards }))
  );
  for (const row of fetched) {
    if (!row?.key) continue;
    const k = String(row.key).toUpperCase();
    if (have.has(k)) continue;
    have.add(k);
    issues.push(row);
  }
  issues = sortIssuesDoneLast(issues);
  const staleCount = issues.filter((i) => i.stale && !i.done).length;
  return {
    ...base,
    ok: Boolean(base.ok) || issues.length > 0,
    issues,
    staleCount,
    total: Math.max(Number(base.total) || 0, issues.length),
    fetchedAt: base.fetchedAt || new Date().toISOString(),
    jql: base.jql || c.jql,
    sopStages: base.sopStages || c.statusMap,
  };
}

function mergeDescriptionAppend(existing, extra) {
  const body = String(existing || "").trim();
  const add = String(extra || "").trim();
  if (!add) return body;
  if (body && body.includes(add)) return body;
  return body ? `${body}\n\n${add}` : add;
}

async function fetchIssueDescription(config, issueKeyOrId) {
  const c = normalizeConfig(config);
  const key = String(issueKeyOrId || "").trim();
  if (!isConfigured(c)) {
    return { ok: false, error: missingAuthError(c) || "Jira not configured" };
  }
  if (!key) return { ok: false, error: "missing_issue" };
  if (/^LACT-\d+$/i.test(key)) {
    return { ok: false, error: "generated_key_not_in_jira", issueKey: key };
  }
  try {
    const res = await jiraFetch(
      c,
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=description,summary`,
      { method: "GET" },
    );
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: `/rest/api/3/issue/${encodeURIComponent(key)}`,
    });
    if (!parsed.parseOk) {
      return { ok: false, httpStatus: parsed.httpStatus || res.status, error: parsed.error };
    }
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        error: formatJiraHttpError(res.status, parseJiraErrorBody(parsed.data)),
      };
    }
    const fields = parsed.data?.fields || {};
    return {
      ok: true,
      issueKey: parsed.data?.key || key,
      summary: fields.summary || "",
      description: jiraAdfToText(fields.description),
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Network error talking to Jira" };
  }
}

/**
 * Append plain text to the issue description. Does not replace the existing story body.
 */
async function appendIssueDescription(config, issueKeyOrId, extraText) {
  const add = String(extraText || "").trim();
  if (!add) return { ok: false, error: "empty_description" };
  const current = await fetchIssueDescription(config, issueKeyOrId);
  if (!current.ok) return current;
  const next = mergeDescriptionAppend(current.description, add);
  if (next === current.description) {
    return { ok: true, issueKey: current.issueKey, unchanged: true };
  }
  const c = normalizeConfig(config);
  const key = current.issueKey || String(issueKeyOrId || "").trim();
  try {
    const res = await jiraFetch(c, `/rest/api/3/issue/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ fields: { description: plainTextAdf(next) } }),
    });
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: `/rest/api/3/issue/${encodeURIComponent(key)}`,
    });
    if (!parsed.parseOk) {
      return { ok: false, httpStatus: parsed.httpStatus || res.status, error: parsed.error };
    }
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        error: formatJiraHttpError(res.status, parseJiraErrorBody(parsed.data)),
      };
    }
    return { ok: true, issueKey: key, unchanged: false };
  } catch (err) {
    return { ok: false, error: err?.message || "Network error talking to Jira" };
  }
}

function plainTextAdf(text) {
  const lines = String(text || "").split(/\n/);
  return {
    type: "doc",
    version: 1,
    content: (lines.length ? lines : [""]).map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

/**
 * Add a comment — ALWAYS appends a new comment via POST.
 * Never updates, replaces, or deletes existing comments.
 */
async function addComment(config, issueKeyOrId, body) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) {
    return { ok: false, error: missingAuthError(c) || "Jira not configured" };
  }
  const key = String(issueKeyOrId || "").trim();
  const text = String(body || "").trim();
  if (!key) return { ok: false, error: "missing_issue" };
  if (!text) return { ok: false, error: "empty_comment" };
  // Generated LACT-* refs are local only — not real Jira issues
  if (/^LACT-\d+$/i.test(key)) {
    return { ok: false, error: "generated_key_not_in_jira", issueKey: key };
  }

  try {
    // POST only — Jira Cloud creates a new comment; never PUT/DELETE
    const res = await jiraFetch(c, `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      method: "POST",
      body: JSON.stringify({ body: plainTextAdf(text) }),
    });
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
    });
    if (!parsed.parseOk) {
      return {
        ok: false,
        httpStatus: parsed.httpStatus || res.status,
        error: parsed.error,
        appendOnly: true,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        error: formatJiraHttpError(res.status, parseJiraErrorBody(parsed.data)),
        appendOnly: true,
      };
    }
    const data = parsed.data || {};
    return {
      ok: true,
      httpStatus: res.status,
      commentId: data?.id || null,
      issueKey: key,
      appendOnly: true,
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Network error", appendOnly: true };
  }
}

function mimeForAttachment(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".csv") return "text/csv";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".xls") return "application/vnd.ms-excel";
  return "application/octet-stream";
}

function collectDeskAttachmentPaths({ screenshotPath, extraFiles } = {}) {
  const paths = [];
  const seen = new Set();
  const add = (value) => {
    const file = String(value || "").trim();
    if (!file || seen.has(file)) return;
    seen.add(file);
    paths.push(file);
  };
  add(screenshotPath);
  const extras = Array.isArray(extraFiles) ? extraFiles : [];
  for (const item of extras) {
    if (typeof item === "string") add(item);
    else if (item && typeof item === "object") add(item.path);
  }
  return paths;
}

function appendAcceptanceCriteria(description, acceptanceCriteria) {
  const ac = String(acceptanceCriteria || "").trim();
  const body = String(description || "").trim();
  if (!ac) return body;
  if (/^acceptance criteria\s*:/im.test(body)) return body;
  return body ? `${body}\n\nAcceptance criteria:\n${ac}` : `Acceptance criteria:\n${ac}`;
}

function buildCreateIssuePayload({
  summary,
  description,
  acceptanceCriteria,
  projectKey,
  issueType = "Task",
} = {}) {
  const key = String(projectKey || "LIVEACT").trim().toUpperCase() || "LIVEACT";
  const title = String(summary || "Issue from LiveTrack Desk").trim() || "Issue from LiveTrack Desk";
  const desc = appendAcceptanceCriteria(description, acceptanceCriteria);
  return {
    fields: {
      project: { key },
      summary: title.slice(0, 255),
      issuetype: { name: String(issueType || "Task") },
      ...(desc ? { description: plainTextAdf(desc) } : {}),
    },
  };
}

function buildCloneIssuePayload(source = {}, { extraNote } = {}) {
  const projectKey = String(source.projectKey || source.project || "").trim().toUpperCase();
  const summary = String(source.summary || "").trim() || "Cloned issue";
  const issueType = String(source.issueType || "Task").trim() || "Task";
  let description = String(source.description || "").trim();
  const note = String(extraNote || "").trim();
  if (note) description = description ? `${description}\n\n${note}` : note;
  return buildCreateIssuePayload({
    summary,
    description,
    projectKey,
    issueType,
  });
}

/**
 * Create a Jira issue (Desk snip-to-ticket). Uses Settings Cloud credentials.
 */
async function createIssue(config, { summary, description, acceptanceCriteria, projectKey, issueType } = {}) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) {
    return {
      ok: false,
      error:
        missingAuthError(c) ||
        "Configure your real Jira site in Settings: site URL (https://your-domain.atlassian.net), email, API token, and project key.",
    };
  }
  const resolved = await resolveProjectKey(c, projectKey || c.projectKey);
  if (!resolved.ok) return resolved;
  const payload = buildCreateIssuePayload({
    summary,
    description,
    acceptanceCriteria,
    projectKey: resolved.key,
    issueType: issueType || "Task",
  });
  try {
    const res = await jiraFetch(c, "/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: "/rest/api/3/issue",
    });
    if (!parsed.parseOk) {
      return { ok: false, httpStatus: parsed.httpStatus || res.status, error: parsed.error };
    }
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        error: formatJiraHttpError(res.status, parseJiraErrorBody(parsed.data)),
      };
    }
    const data = parsed.data || {};
    const issueKey = data?.key || "";
    const url = issueBrowseUrl(c.baseUrl, issueKey);
    return { ok: true, issueKey, id: data?.id || null, url };
  } catch (err) {
    return { ok: false, error: err?.message || "Network error talking to Jira" };
  }
}

async function fetchIssueForClone(config, sourceKey) {
  const c = normalizeConfig(config);
  const key = String(sourceKey || "").trim();
  if (!isConfigured(c)) {
    return {
      ok: false,
      error:
        missingAuthError(c) ||
        "Configure your real Jira site in Settings: site URL (https://your-domain.atlassian.net), email, API token, and project key.",
    };
  }
  if (!key) return { ok: false, error: "Pick an existing ticket to clone." };
  try {
    const res = await jiraFetch(
      c,
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,issuetype,project`,
      { method: "GET" },
    );
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: `/rest/api/3/issue/${encodeURIComponent(key)}`,
    });
    if (!parsed.parseOk) {
      return { ok: false, httpStatus: parsed.httpStatus || res.status, error: parsed.error };
    }
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        error: formatJiraHttpError(res.status, parseJiraErrorBody(parsed.data)),
      };
    }
    const issue = parsed.data || {};
    const fields = issue.fields || {};
    return {
      ok: true,
      key: issue.key,
      summary: fields.summary || "",
      description: jiraAdfToText(fields.description),
      issueType: fields.issuetype?.name || "Task",
      projectKey: fields.project?.key || c.projectKey,
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Network error talking to Jira" };
  }
}

let epicLinkFieldCache = "";

async function resolveEpicLinkFieldId(config) {
  if (epicLinkFieldCache) return epicLinkFieldCache;
  const c = normalizeConfig(config);
  try {
    const res = await jiraFetch(c, "/rest/api/3/field", { method: "GET" });
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: "/rest/api/3/field",
    });
    if (!parsed.parseOk || !res.ok) return "";
    const fields = Array.isArray(parsed.data) ? parsed.data : [];
    const match = fields.find((field) => {
      const custom = String(field?.schema?.custom || "");
      const name = String(field?.name || "").trim().toLowerCase();
      return custom === "com.pyxis.greenhopper.jira:gh-epic-link" || name === "epic link";
    });
    epicLinkFieldCache = String(match?.id || "");
    return epicLinkFieldCache;
  } catch {
    return "";
  }
}

async function listProjectEpics(config, projectKey) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) {
    return { ok: false, error: missingAuthError(c) || "Jira is not configured.", epics: [] };
  }
  const resolved = await resolveProjectKey(c, projectKey || c.projectKey);
  if (!resolved.ok) return { ok: false, error: resolved.error, epics: [] };
  const projectClause = jqlProjectEquals(resolved.key) || `project = ${resolved.key}`;
  const jql = `${projectClause} AND issuetype = Epic ORDER BY updated DESC`;
  const raw = await searchIssuesByJql(c, jql, { maxResults: 50, pages: 2 });
  const epics = raw
    .map((issue) => ({
      key: String(issue?.key || "").trim(),
      summary: String(issue?.fields?.summary || "").trim(),
    }))
    .filter((epic) => epic.key);
  return { ok: true, epics };
}

async function linkIssueToEpic(config, issueKey, epicKey) {
  const c = normalizeConfig(config);
  const epic = String(epicKey || "").trim().toUpperCase();
  const key = String(issueKey || "").trim();
  if (!epic || !key) return { ok: true, skipped: true };
  if (!isConfigured(c)) {
    return { ok: false, error: missingAuthError(c) || "Jira is not configured." };
  }
  try {
    const parentRes = await jiraFetch(c, `/rest/api/3/issue/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ fields: { parent: { key: epic } } }),
    });
    if (parentRes.ok) return { ok: true, via: "parent" };

    const fieldId = await resolveEpicLinkFieldId(c);
    if (fieldId) {
      const fieldRes = await jiraFetch(c, `/rest/api/3/issue/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ fields: { [fieldId]: epic } }),
      });
      if (fieldRes.ok) return { ok: true, via: "epic-link" };
    }

    const agileRes = await jiraFetch(
      c,
      `/rest/agile/1.0/epic/${encodeURIComponent(epic)}/issue`,
      {
        method: "POST",
        body: JSON.stringify({ issues: [key] }),
      }
    );
    if (agileRes.ok) return { ok: true, via: "agile" };

    const parsed = await parseJiraHttpResponse(parentRes, {
      baseUrl: c.baseUrl,
      pathname: `/rest/api/3/issue/${encodeURIComponent(key)}`,
    });
    const detail = parsed.parseOk ? parseJiraErrorBody(parsed.data) : parsed.error;
    return {
      ok: false,
      error: formatJiraHttpError(parentRes.status, detail) || "Could not set the epic link.",
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not set the epic link." };
  }
}

/**
 * POST a new issue copied from source. Never updates or attaches to the source ticket.
 */
async function cloneIssue(config, { sourceKey, summary, description, extraNote, acceptanceCriteria } = {}) {
  const source = await fetchIssueForClone(config, sourceKey);
  if (!source.ok) return source;
  const title = String(summary || "").trim() || source.summary;
  const body = String(description || "").trim() || source.description;
  const note = String(extraNote || "").trim();
  const created = await createIssue(config, {
    summary: title,
    description: note ? [body, note].filter(Boolean).join("\n\n") : body,
    acceptanceCriteria,
    issueType: source.issueType,
    projectKey: source.projectKey,
  });
  if (!created.ok) return created;
  return {
    ...created,
    clonedFrom: source.key,
    issueType: source.issueType,
    projectKey: source.projectKey,
  };
}

/**
 * Attach a local file to an issue. Returns skipped:true if the server has no attachments API.
 */
async function attachFile(config, issueKeyOrId, filePath) {
  const c = normalizeConfig(config);
  const key = String(issueKeyOrId || "").trim();
  const file = String(filePath || "").trim();
  if (!isConfigured(c) || !key || !file || !fs.existsSync(file)) {
    return { ok: false, skipped: true, error: "missing_attachment" };
  }
  try {
    const buf = fs.readFileSync(file);
    const name = path.basename(file);
    const fileObj = new File([buf], name, { type: mimeForAttachment(file) });
    const form = new FormData();
    form.append("file", fileObj, name);
    const res = await jiraFetch(c, `/rest/api/3/issue/${encodeURIComponent(key)}/attachments`, {
      method: "POST",
      headers: {
        Authorization: authHeader(c.email, c.apiToken),
        "X-Atlassian-Token": "no-check",
        Accept: "application/json",
      },
      body: form,
    });
    if (res.status === 404 || res.status === 405) {
      return { ok: false, skipped: true, httpStatus: res.status, error: formatJiraHttpError(res.status) };
    }
    const parsed = await parseJiraHttpResponse(res, {
      baseUrl: c.baseUrl,
      pathname: `/rest/api/3/issue/${encodeURIComponent(key)}/attachments`,
    });
    if (!parsed.parseOk) {
      return {
        ok: false,
        skipped: false,
        httpStatus: parsed.httpStatus || res.status,
        error: parsed.error,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        skipped: false,
        httpStatus: res.status,
        error: formatJiraHttpError(res.status, parseJiraErrorBody(parsed.data)),
      };
    }
    return { ok: true, skipped: false };
  } catch (err) {
    return { ok: false, skipped: true, error: err?.message || "attach_failed" };
  }
}

let jiraActionCache = [];

const jiraActionsReady = require("./workbook")
  .readTables(["JiraActions"])
  .then(({ JiraActions }) => {
    const wb = require("./workbook");
    jiraActionCache = (JiraActions || []).map((row) => {
      const extra = wb.parseJsonCell(row.payload_json);
      return extra && typeof extra === "object" ? extra : row;
    });
  })
  .catch(() => {});

function scrubSecrets(entry) {
  if (!entry || typeof entry !== "object") return entry;
  const out = { ...entry };
  for (const key of Object.keys(out)) {
    if (/token|authorization|password|secret|apikey|apitoken/i.test(key)) {
      out[key] = "[redacted]";
    }
  }
  return out;
}

function appendJiraAction(entry) {
  const row = {
    timestamp: new Date().toISOString(),
    actor: os.userInfo()?.username || process.env.USER || "unknown",
    ...scrubSecrets(entry),
  };
  jiraActionCache.push(row);
  const wb = require("./workbook");
  wb.appendRows("JiraActions", [
    {
      timestamp: row.timestamp,
      actor: row.actor,
      issueKey: row.issueKey || "",
      action: row.action || "",
      ok: String(row.ok ?? ""),
      payload_json: wb.jsonCell(row),
    },
  ]).catch((err) => console.error("[livetrack] jira action log", err.message));
  return { ok: true, path: wb.workbookPath() };
}

function recentJiraActions(limit = 5) {
  return jiraActionCache.slice(-Math.max(1, limit)).reverse();
}

function createdDeskTickets(limit = 80, { actor, baseUrl } = {}) {
  const seen = new Set();
  const out = [];
  const actorFilter = String(actor || "").trim().toLowerCase();
  for (let i = jiraActionCache.length - 1; i >= 0; i -= 1) {
    const row = jiraActionCache[i] || {};
    const action = String(row.action || "").toLowerCase();
    if (action !== "create" && action !== "clone") continue;
    if (row.ok === false || String(row.ok) === "false") continue;
    const issueKey = String(row.issueKey || "").trim();
    if (!issueKey || seen.has(issueKey)) continue;
    if (
      actorFilter &&
      String(row.actor || "").trim().toLowerCase() !== actorFilter
    ) {
      continue;
    }
    seen.add(issueKey);
    out.push({
      issueKey,
      action,
      actor: row.actor || "",
      timestamp: row.timestamp || "",
      clonedFrom: row.clonedFrom || "",
      summary: String(row.summary || row.bodyPreview || issueKey).trim(),
      url: row.url || (baseUrl ? issueBrowseUrl(baseUrl, issueKey) : ""),
    });
    if (out.length >= Math.max(1, limit)) break;
  }
  return out;
}

async function listCreatedDeskTickets(limit = 80, opts = {}) {
  await jiraActionsReady.catch(() => {});
  return createdDeskTickets(limit, opts);
}

module.exports = {
  DEFAULT_STATUS_MAP,
  get JIRA_ACTIONS_PATH() {
    return jiraActionsPath();
  },
  originFromJiraSiteUrl,
  sanitizeJiraSecret,
  missingAuthError,
  jiraFetch,
  jiraNodeFetch,
  stripJiraCookieHeaders,
  buildSearchJqlGetPath,
  looksLikeHtmlBody,
  explainJiraHtmlBody,
  parseJiraHttpResponse,
  authHeaders,
  normalizeConfig,
  normalizeStatusMap,
  isConfigured,
  testConnection,
  searchIssues,
  extractTicketRefs,
  extractTicketDescription,
  commentSourceForTickets,
  attachCommentSource,
  enrichRelatedTicketsFromComments,
  bundledParentDescription,
  bundledTicketLookupQuery,
  formatCommentTicketsBundle,
  relatedTicketKeys,
  stripCommentTicketsBundle,
  ticketKindLabel,
  ticketLookupQuery,
  ensureOpenSprintJql,
  ensurePastWorkJql,
  applyPastWorkTextQuery,
  filterPastWorkIssues,
  isPastWorkDoneIssue,
  issueInOpenSprint,
  mergeRelatedTickets,
  normalizeRelatedStoryText,
  relatedStoryTokens,
  storiesAreSimilar,
  storiesAreRelated,
  similarRelatedFromIssues,
  similarSearchPhrases,
  similarSearchTokenGroups,
  distinctiveSimilarTokens,
  buildSimilarIssueJql,
  buildRecentAssignedIssueJql,
  findSimilarPastIssues,
  pinSimilarSearchHits,
  pastWorkFoldKeys,
  pastWorkFoldHtml,
  collectFollowJiraKeys,
  selectRelatedTickets,
  filterRelatedTickets,
  finalizePastWorkRelated,
  mergeScrapedPastWork,
  isJiraIssueKey,
  isOpsTicketKey,
  attachScrapedTickets,
  enrichIssues,
  mapSopStage,
  findLinkedCardId,
  isJiraDoneStatus,
  collectLinkedIssueKeys,
  fetchIssueByKey,
  parseIssueLinks,
  ensureLinkedIssues,
  sortIssuesDoneLast,
  stripDoneExclusionsFromJql,
  ensureAssigneeOnlyJql,
  scoreIssue,
  daysSince,
  getIssueUpdated,
  addComment,
  mergeDescriptionAppend,
  fetchIssueDescription,
  appendIssueDescription,
  createIssue,
  resolveProjectKey,
  matchProjectFromList,
  formatProjectNotFoundError,
  applyResolvedProjectToJql,
  jqlProjectEquals,
  extractJqlProjectRefs,
  normalizeProjectRef,
  cloneIssue,
  listProjectEpics,
  linkIssueToEpic,
  fetchIssueForClone,
  attachFile,
  buildCreateIssuePayload,
  buildCloneIssuePayload,
  collectDeskAttachmentPaths,
  appendAcceptanceCriteria,
  mimeForAttachment,
  formatJiraHttpError,
  parseJiraErrorBody,
  jiraAdfToText,
  htmlToPlain,
  appendJiraAction,
  recentJiraActions,
  createdDeskTickets,
  listCreatedDeskTickets,
  STATUS_WEIGHTS,
  PRIORITY_WEIGHTS,
};
