/**
 * Jira Cloud client + urgency scoring for liveAct.
 * Auth: email + API token (Basic) against REST API v3.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
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
  s = s.replace(/\(\s*\)/g, "");
  s = s.replace(/\bAND\s+AND\b/gi, "AND");
  s = s.replace(/\bOR\s+OR\b/gi, "OR");
  s = s.replace(/\bAND\s+ORDER\b/gi, "ORDER");
  s = s.replace(/\bOR\s+ORDER\b/gi, "ORDER");
  s = s.replace(/^\s*(AND|OR)\s+/i, "");
  s = s.replace(/\s+(AND|OR)\s*$/i, "");
  return s.replace(/\s{2,}/g, " ").trim();
}

function ensureAssigneeOnlyJql(jql) {
  const raw = stripDoneExclusionsFromJql(String(jql || "").trim());
  const defaultJql = "assignee = currentUser() ORDER BY updated ASC";
  if (!raw) return defaultJql;
  if (/\bassignee\s*=\s*currentUser\s*\(\s*\)/i.test(raw)) return raw;
  // Force assigned-to-me even if user cleared/changed the assignee clause
  const withoutOrder = raw.replace(/\s+ORDER\s+BY\s+.+$/i, "").trim();
  const orderMatch = raw.match(/\s+(ORDER\s+BY\s+.+)$/i);
  const order = orderMatch ? orderMatch[1] : "ORDER BY updated ASC";
  const core = withoutOrder
    ? `assignee = currentUser() AND (${withoutOrder})`
    : "assignee = currentUser()";
  return `${core} ${order}`.trim();
}

function normalizeConfig(raw) {
  return {
    baseUrl: String(raw?.jiraBaseUrl || raw?.baseUrl || "")
      .trim()
      .replace(/\/+$/, ""),
    email: String(raw?.jiraEmail || raw?.email || "").trim(),
    apiToken: String(raw?.jiraApiToken || raw?.apiToken || "").trim(),
    jql: ensureAssigneeOnlyJql(
      raw?.jiraJql || raw?.jql || "assignee = currentUser() ORDER BY updated ASC"
    ),
    staleDays: Math.max(0.5, Number(raw?.jiraStaleDays ?? raw?.staleDays ?? 2) || 2),
    pollMinutes: Math.max(1, Number(raw?.jiraPollMinutes ?? raw?.pollMinutes ?? 5) || 5),
    statusMap: normalizeStatusMap(raw?.jiraStatusMap ?? raw?.statusMap),
    cardKeyField: String(raw?.jiraCardKeyField || raw?.cardKeyField || "jiraKey").trim() || "jiraKey",
  };
}

function isConfigured(config) {
  const c = normalizeConfig(config);
  return Boolean(c.baseUrl && c.email && c.apiToken);
}

function authHeader(email, apiToken) {
  const token = Buffer.from(`${email}:${apiToken}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function authHeaders(c) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: authHeader(c.email, c.apiToken),
  };
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

async function searchIssues(config, { maxResults = 50, queueCards = [] } = {}) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) {
    return {
      ok: false,
      error: "Configure Jira base URL, email, and API token in Settings.",
      issues: [],
      staleCount: 0,
      sopStages: c.statusMap,
    };
  }

  const fields = ["summary", "description", "status", "priority", "assignee", "updated", "issuetype", "labels", "reporter"];
  const url = new URL(`${c.baseUrl}/rest/api/3/search`);
  url.searchParams.set("jql", c.jql);
  url.searchParams.set("maxResults", String(Math.min(100, maxResults)));
  url.searchParams.set("fields", fields.join(","));

  let res;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authHeader(c.email, c.apiToken),
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "Network error talking to Jira",
      issues: [],
      staleCount: 0,
      sopStages: c.statusMap,
    };
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.errorMessages?.join("; ") || body?.message || "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    return {
      ok: false,
      error: `Jira ${res.status}${detail ? `: ${detail}` : ""}`,
      issues: [],
      staleCount: 0,
      sopStages: c.statusMap,
    };
  }

  const data = await res.json();
  let issues = (data.issues || []).map((issue) => {
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
    jql: c.jql,
    sopStages: c.statusMap,
  };
}

async function getIssueUpdated(config, issueKeyOrId) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) {
    return { ok: false, error: "Jira not configured" };
  }
  const key = encodeURIComponent(String(issueKeyOrId || "").trim());
  if (!key) return { ok: false, error: "missing_issue" };
  try {
    const res = await fetch(`${c.baseUrl}/rest/api/3/issue/${key}?fields=updated`, {
      method: "GET",
      headers: authHeaders(c),
    });
    if (!res.ok) {
      return { ok: false, error: `Jira ${res.status}`, httpStatus: res.status };
    }
    const data = await res.json();
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
    ];
    const res = await fetch(
      `${c.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields.join(",")}`,
      { method: "GET", headers: authHeaders(c) }
    );
    if (!res.ok) return null;
    const issue = await res.json();
    const fieldsObj = issue.fields || {};
    const { days, score } = scoreIssue(fieldsObj);
    const stale = days >= c.staleDays;
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

function plainTextAdf(text) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: String(text || "") }],
      },
    ],
  };
}

/**
 * Add a comment — ALWAYS appends a new comment via POST.
 * Never updates, replaces, or deletes existing comments.
 */
async function addComment(config, issueKeyOrId, body) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) {
    return { ok: false, error: "Jira not configured" };
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
    const res = await fetch(`${c.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      method: "POST",
      headers: authHeaders(c),
      body: JSON.stringify({ body: plainTextAdf(text) }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const errBody = await res.json();
        detail = errBody?.errorMessages?.join("; ") || errBody?.message || "";
      } catch {
        detail = await res.text().catch(() => "");
      }
      return {
        ok: false,
        httpStatus: res.status,
        error: `Jira ${res.status}${detail ? `: ${detail}` : ""}`,
        appendOnly: true,
      };
    }
    const data = await res.json().catch(() => ({}));
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

function appendJiraAction(entry) {
  try {
    const filePath = jiraActionsPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      actor: os.userInfo()?.username || process.env.USER || "unknown",
      ...entry,
    });
    fs.appendFileSync(filePath, `${line}\n`, "utf8");
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function recentJiraActions(limit = 5) {
  try {
    const filePath = jiraActionsPath();
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\n+/).filter(Boolean);
    const slice = lines.slice(-Math.max(1, limit));
    return slice
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

module.exports = {
  DEFAULT_STATUS_MAP,
  get JIRA_ACTIONS_PATH() {
    return jiraActionsPath();
  },
  normalizeConfig,
  normalizeStatusMap,
  isConfigured,
  searchIssues,
  enrichIssues,
  mapSopStage,
  findLinkedCardId,
  isJiraDoneStatus,
  collectLinkedIssueKeys,
  fetchIssueByKey,
  ensureLinkedIssues,
  sortIssuesDoneLast,
  stripDoneExclusionsFromJql,
  ensureAssigneeOnlyJql,
  scoreIssue,
  daysSince,
  getIssueUpdated,
  addComment,
  appendJiraAction,
  recentJiraActions,
  STATUS_WEIGHTS,
  PRIORITY_WEIGHTS,
};
