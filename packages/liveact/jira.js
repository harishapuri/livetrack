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

  return new Promise((resolve, reject) => {
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
          jiraNodeFetch(nextUrl, nextInit, redirectCount + 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: status || 502,
              statusText: res.statusMessage || "",
              headers: incomingToFetchHeaders(res.headers),
            })
          );
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
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
  const headers = stripJiraCookieHeaders({ ...authHeaders(c), ...(init.headers || {}) });
  headers["X-Atlassian-Token"] = "no-check";
  if (init.body && typeof FormData !== "undefined" && init.body instanceof FormData) {
    delete headers["Content-Type"];
  }
  const attempt = (target) =>
    fetchImpl(target, {
      ...init,
      headers,
      credentials: "omit",
    });

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

function jiraAdfToText(adf) {
  if (typeof adf === "string") return adf;
  if (!adf || typeof adf !== "object") return "";
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === "text" && node.text) parts.push(node.text);
    if (node.type === "hardBreak") parts.push("\n");
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
      if (node.type === "paragraph" || node.type === "heading") parts.push("\n");
    }
  };
  walk(adf);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
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
  return (issues || []).map((issue) => ({
    ...issue,
    sopStage: mapSopStage(issue.status, map),
    linkedCardId: findLinkedCardId(issue.key, queueCards, cardKeyField),
    done: isJiraDoneStatus(issue.status, mapSopStage(issue.status, map)),
  }));
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

async function searchIssues(config, { maxResults = 50, queueCards = [] } = {}) {
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

  const fields = ["summary", "description", "status", "priority", "assignee", "updated", "issuetype", "labels", "reporter"];
  const searchPath = "/rest/api/3/search/jql";
  const pageSize = Math.min(100, maxResults);
  const collected = [];
  let nextPageToken = "";
  let data = {};

  for (let page = 0; page < 10 && collected.length < pageSize; page++) {
    const payload = {
      jql,
      maxResults: pageSize,
      fields,
    };
    if (nextPageToken) payload.nextPageToken = nextPageToken;

    let res;
    try {
      // Prefer GET so Classic XSRF (POST + Atlassian cookies) never runs on search.
      const getPath = buildSearchJqlGetPath(searchPath, payload);
      if (getPath.length <= 1800) {
        res = await jiraFetch(c, getPath, { method: "GET" });
      }
      if (!res || searchJqlGetNotSupported(res.status)) {
        res = await jiraFetch(c, searchPath, {
          method: "POST",
          body: JSON.stringify(payload),
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
      return {
        ok: false,
        httpStatus: res.status,
        error: formatJiraHttpError(res.status, parseJiraErrorBody(parsed.data)),
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

  let issues = collected.map((issue) => {
    const fieldsObj = issue.fields || {};
    const { days, score } = scoreIssue(fieldsObj);
    const stale = days >= c.staleDays;
    return {
      id: issue.id,
      key: issue.key,
      summary: fieldsObj.summary || "(no summary)",
      description: typeof fieldsObj.description === "string" ? fieldsObj.description : "",
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
    };
  });

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

  // Active work first; Done / closed stories sink to the bottom
  issues = sortIssuesDoneLast(issues);
  const staleCount = issues.filter((i) => i.stale && !i.done).length;

  return {
    ok: true,
    issues,
    staleCount,
    total: data.total ?? issues.length,
    fetchedAt: new Date().toISOString(),
    jql,
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
      description: typeof fieldsObj.description === "string" ? fieldsObj.description : "",
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

/**
 * POST a new issue copied from source. Never updates or attaches to the source ticket.
 */
async function cloneIssue(config, { sourceKey, extraNote, acceptanceCriteria } = {}) {
  const source = await fetchIssueForClone(config, sourceKey);
  if (!source.ok) return source;
  const created = await createIssue(config, {
    summary: source.summary,
    description: extraNote
      ? [source.description, extraNote].filter(Boolean).join("\n\n")
      : source.description,
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
  appendJiraAction,
  recentJiraActions,
  createdDeskTickets,
  listCreatedDeskTickets,
  STATUS_WEIGHTS,
  PRIORITY_WEIGHTS,
};
