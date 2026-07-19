/**
 * Mock Jira Cloud REST API v3 + dashboard for liveAct testing.
 * Port 4176 — set liveAct Settings:
 *   Site URL: http://127.0.0.1:4176
 *   Email:    demo@coact.local
 *   Token:    demo-token
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.JIRA_MOCK_PORT || 4176);
const PUBLIC = path.join(__dirname, "public");
const DEMO_EMAIL = "demo@coact.local";
const DEMO_TOKEN = "demo-token";

function daysAgo(n) {
  return new Date(Date.now() - n * 864e5).toISOString();
}

function hoursAgo(n) {
  return new Date(Date.now() - n * 3600e3).toISOString();
}

/** @type {Map<string, object>} */
const issues = new Map();
/** @type {Map<string, object[]>} */
const comments = new Map();
let nextCommentId = 1000;
let nextIssueId = 10001;

function seed() {
  const rows = [
    {
      key: "LIVEACT-101",
      summary: "Patient intake — Riverdale (stale high priority)",
      description:
        "Complete Riverdale patient intake in the demo form.\n\nAcceptance:\n- Demographics filled\n- Insurance captured\n- Consent acknowledged\n\nBlocked previously by missing DOB; re-open and finish.",
      status: "In Progress",
      priority: "High",
      assignee: "Demo Agent",
      labels: ["intake", "riverdale", "sop", "liveact"],
      updated: daysAgo(4),
      issueType: "Story",
    },
  ];

  for (const row of rows) {
    const id = String(nextIssueId++);
    const assigneeEmail =
      row.assigneeEmail != null
        ? row.assigneeEmail
        : row.assignee === "Unassigned"
          ? ""
          : DEMO_EMAIL;
    issues.set(row.key, {
      id,
      key: row.key,
      fields: {
        summary: row.summary,
        description: row.description || "",
        status: { name: row.status },
        priority: { name: row.priority },
        assignee:
          row.assignee === "Unassigned"
            ? null
            : { displayName: row.assignee, emailAddress: assigneeEmail },
        reporter: { displayName: "Demo Agent", emailAddress: DEMO_EMAIL },
        labels: row.labels || [],
        updated: row.updated,
        issuetype: { name: row.issueType },
      },
    });
    comments.set(row.key, []);
  }
}

function checkAuth(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(h.slice(6), "base64").toString("utf8");
    const [email, token] = decoded.split(":");
    return Boolean(email && token);
  } catch {
    return false;
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function adfToText(adf) {
  if (typeof adf === "string") return adf;
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === "text" && node.text) parts.push(node.text);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(adf);
  return parts.join(" ") || "";
}

function listIssues() {
  return [...issues.values()].sort(
    (a, b) => Date.parse(a.fields.updated) - Date.parse(b.fields.updated)
  );
}

function handleSearch(url, res) {
  const maxResults = Math.min(100, Number(url.searchParams.get("maxResults") || 50) || 50);
  const jql = String(url.searchParams.get("jql") || "");
  let all = listIssues();
  // Honor assignee = currentUser() (mock user = demo@coact.local / Demo Agent)
  if (/\bassignee\s*=\s*currentUser\s*\(\s*\)/i.test(jql)) {
    all = all.filter((i) => {
      const email = String(i.fields.assignee?.emailAddress || "").toLowerCase();
      const name = String(i.fields.assignee?.displayName || "");
      if (!name || name === "Unassigned") return false;
      return email === DEMO_EMAIL.toLowerCase() || name === "Demo Agent";
    });
  }
  const sliced = all.slice(0, maxResults);
  sendJson(res, 200, {
    expand: "names,schema",
    startAt: 0,
    maxResults,
    total: all.length,
    issues: sliced,
  });
}

function handleGetIssue(key, url, res) {
  const issue = issues.get(key) || [...issues.values()].find((i) => i.id === key);
  if (!issue) {
    return sendJson(res, 404, { errorMessages: [`Issue does not exist or you do not have permission to see it.`] });
  }
  const fieldsParam = url.searchParams.get("fields");
  if (fieldsParam) {
    const wanted = fieldsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const fields = {};
    for (const f of wanted) {
      if (issue.fields[f] != null) fields[f] = issue.fields[f];
    }
    return sendJson(res, 200, { id: issue.id, key: issue.key, fields });
  }
  sendJson(res, 200, issue);
}

async function handleComment(key, req, res) {
  const issue = issues.get(key) || [...issues.values()].find((i) => i.id === key);
  if (!issue) {
    return sendJson(res, 404, { errorMessages: [`Issue does not exist.`] });
  }
  const body = await readBody(req);
  const text = adfToText(body.body).trim();
  if (!text) {
    return sendJson(res, 400, { errorMessages: ["Comment body required"] });
  }
  const id = String(nextCommentId++);
  const comment = {
    id,
    created: new Date().toISOString(),
    author: { displayName: "Demo Agent", emailAddress: DEMO_EMAIL },
    body: text,
  };
  const list = comments.get(issue.key) || [];
  comments.set(issue.key, [...list, comment]);
  issue.fields.updated = new Date().toISOString();
  sendJson(res, 201, { id, created: comment.created, body: body.body });
}

function issueToApi(i) {
  return {
    id: i.id,
    key: i.key,
    summary: i.fields.summary,
    description: i.fields.description || "",
    status: i.fields.status.name,
    priority: i.fields.priority.name,
    assignee: i.fields.assignee?.displayName,
    reporter: i.fields.reporter?.displayName || "Demo Agent",
    labels: i.fields.labels || [],
    updated: i.fields.updated,
    issueType: i.fields.issuetype?.name,
    comments: (comments.get(i.key) || []).length,
    url: `http://127.0.0.1:${PORT}/browse/${i.key}`,
  };
}

function findIssue(keyOrId) {
  const key = String(keyOrId || "").trim();
  return issues.get(key) || issues.get(key.toUpperCase()) || [...issues.values()].find((i) => i.id === key);
}

async function handleDashboardApi(req, res, url) {
  if (url.pathname === "/api/issues" && req.method === "GET") {
    return sendJson(res, 200, {
      issues: listIssues().map(issueToApi),
      credentials: {
        baseUrl: `http://127.0.0.1:${PORT}`,
        email: DEMO_EMAIL,
        token: DEMO_TOKEN,
      },
    });
  }

  const oneMatch = url.pathname.match(/^\/api\/issues\/([^/]+)$/);
  if (oneMatch && req.method === "GET") {
    const issue = findIssue(decodeURIComponent(oneMatch[1]));
    if (!issue) return sendJson(res, 404, { error: "Not found" });
    return sendJson(res, 200, issueToApi(issue));
  }

  if (url.pathname === "/api/issues" && req.method === "POST") {
    const body = await readBody(req);
    const key = String(body.key || `LIVEACT-${nextIssueId}`).trim().toUpperCase();
    if (issues.has(key)) {
      return sendJson(res, 409, { error: "Key already exists" });
    }
    const id = String(nextIssueId++);
    const issue = {
      id,
      key,
      fields: {
        summary: String(body.summary || "New story").trim(),
        description: String(body.description || "").trim(),
        status: { name: String(body.status || "To Do").trim() },
        priority: { name: String(body.priority || "Medium").trim() },
        assignee: {
          displayName: String(body.assignee || "Demo Agent").trim(),
          emailAddress: DEMO_EMAIL,
        },
        reporter: { displayName: "Demo Agent", emailAddress: DEMO_EMAIL },
        labels: Array.isArray(body.labels) ? body.labels.map(String) : [],
        updated: body.updated ? new Date(body.updated).toISOString() : new Date().toISOString(),
        issuetype: { name: String(body.issueType || "Story").trim() },
      },
    };
    issues.set(key, issue);
    comments.set(key, []);
    return sendJson(res, 201, { ok: true, key, id, url: `http://127.0.0.1:${PORT}/browse/${key}` });
  }

  if (oneMatch && req.method === "PATCH") {
    const key = decodeURIComponent(oneMatch[1]);
    const issue = findIssue(key);
    if (!issue) return sendJson(res, 404, { error: "Not found" });
    const body = await readBody(req);
    if (body.summary != null) issue.fields.summary = String(body.summary);
    if (body.description != null) issue.fields.description = String(body.description);
    if (body.status != null) issue.fields.status = { name: String(body.status) };
    if (body.priority != null) issue.fields.priority = { name: String(body.priority) };
    if (body.assignee != null) {
      issue.fields.assignee = {
        displayName: String(body.assignee),
        emailAddress: DEMO_EMAIL,
      };
    }
    if (body.labels != null) {
      issue.fields.labels = Array.isArray(body.labels)
        ? body.labels.map(String)
        : String(body.labels)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    }
    if (body.touch || body.updated === "now") {
      issue.fields.updated = new Date().toISOString();
    } else if (body.updatedDaysAgo != null) {
      issue.fields.updated = daysAgo(Number(body.updatedDaysAgo) || 0);
    } else if (body.updated) {
      issue.fields.updated = new Date(body.updated).toISOString();
    } else {
      issue.fields.updated = new Date().toISOString();
    }
    return sendJson(res, 200, { ok: true, key: issue.key, updated: issue.fields.updated });
  }

  const commentsMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/comments$/);
  if (commentsMatch && req.method === "GET") {
    const key = decodeURIComponent(commentsMatch[1]);
    const issue = findIssue(key);
    if (!issue) return sendJson(res, 404, { error: "Not found" });
    return sendJson(res, 200, { comments: comments.get(issue.key) || [] });
  }

  if (commentsMatch && req.method === "POST") {
    const key = decodeURIComponent(commentsMatch[1]);
    const issue = findIssue(key);
    if (!issue) return sendJson(res, 404, { error: "Not found" });
    const body = await readBody(req);
    const text = String(body.body || "").trim();
    if (!text) return sendJson(res, 400, { error: "Comment body required" });
    const id = String(nextCommentId++);
    const comment = {
      id,
      created: new Date().toISOString(),
      author: { displayName: "Demo Agent", emailAddress: DEMO_EMAIL },
      body: text,
    };
    const list = comments.get(issue.key) || [];
    comments.set(issue.key, [...list, comment]);
    issue.fields.updated = new Date().toISOString();
    return sendJson(res, 201, { ok: true, comment });
  }

  const aiCommentMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/ai-comment$/);
  if (aiCommentMatch && req.method === "POST") {
    const key = decodeURIComponent(aiCommentMatch[1]);
    const issue = findIssue(key);
    if (!issue) return sendJson(res, 404, { error: "Not found" });
    const body = await readBody(req);
    const draft = String(body.draft || body.body || "").trim();
    if (!draft) return sendJson(res, 400, { error: "Draft required" });

    // APPEND only — never clear or replace existing comments
    const existing = [...(comments.get(issue.key) || [])];
    const refined = draft.replace(/\s+/g, " ").trim();
    const aiComment = {
      id: String(nextCommentId++),
      created: new Date().toISOString(),
      author: { displayName: "Demo Agent (AI)", emailAddress: DEMO_EMAIL },
      body: refined,
    };
    comments.set(issue.key, [...existing, aiComment]);
    issue.fields.updated = new Date().toISOString();
    return sendJson(res, 201, {
      ok: true,
      usedAi: true,
      appended: true,
      comment: aiComment,
      commentCount: existing.length + 1,
    });
  }

  sendJson(res, 404, { error: "Not found" });
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(req, res, url) {
  // Jira-like browse URLs: /browse/LIVEACT-101
  if (/^\/browse\/[^/]+\/?$/i.test(url.pathname)) {
    const filePath = path.join(PUBLIC, "browse.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(filePath).pipe(res);
  }

  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

seed();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
      });
      return res.end();
    }

    if (url.pathname.startsWith("/api/")) {
      return await handleDashboardApi(req, res, url);
    }

    if (url.pathname.startsWith("/rest/api/3/")) {
      if (!checkAuth(req)) {
        return sendJson(res, 401, { errorMessages: ["Unauthorized"] });
      }

      if (url.pathname === "/rest/api/3/search" && req.method === "GET") {
        return handleSearch(url, res);
      }

      const issueMatch = url.pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)$/);
      if (issueMatch && req.method === "GET") {
        return handleGetIssue(decodeURIComponent(issueMatch[1]), url, res);
      }

      const commentMatch = url.pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)\/comment(?:\/([^/]+))?$/);
      if (commentMatch) {
        if (req.method === "POST" && !commentMatch[2]) {
          return await handleComment(decodeURIComponent(commentMatch[1]), req, res);
        }
        // Never allow update/delete — comments are append-only
        if (req.method === "PUT" || req.method === "DELETE" || req.method === "PATCH") {
          return sendJson(res, 405, {
            errorMessages: ["Comments are append-only. POST a new comment; updates/deletes are not allowed."],
          });
        }
      }

      return sendJson(res, 404, { errorMessages: ["Not found"] });
    }

    return serveStatic(req, res, url);
  } catch (err) {
    console.error("[jira-mock]", err);
    sendJson(res, 500, { errorMessages: [err?.message || String(err)] });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[jira-mock] dashboard  http://127.0.0.1:${PORT}/`);
  console.log(`[jira-mock] API base   http://127.0.0.1:${PORT}`);
  console.log(`[jira-mock] email      ${DEMO_EMAIL}`);
  console.log(`[jira-mock] token      ${DEMO_TOKEN}`);
  console.log(`[jira-mock] liveAct → Settings → Jira site URL = http://127.0.0.1:${PORT}`);
});
