/**
 * Mock Jira Cloud REST API v3 + dashboard for liveAct testing.
 * Port 4176 — set liveAct Settings:
 *   Site URL: http://127.0.0.1:4176
 *   Email:    demo@coact.local
 *   Token:    demo-token
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
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
/** @type {Map<string, object[]>} */
const attachments = new Map();
const ATTACH_DIR = path.join(os.tmpdir(), "jira-mock-attachments");
let nextCommentId = 1000;
let nextIssueId = 10001;
let nextAttachId = 1;

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
    attachments.set(row.key, []);
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

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readBody(req) {
  return readRawBody(req).then((buf) => {
    const raw = buf.toString("utf8");
    if (!raw) return {};
    return JSON.parse(raw);
  });
}

function parseMultipartFiles(buffer, contentType) {
  const bm = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!bm || !buffer || !buffer.length) return [];
  const boundary = String(bm[1] || bm[2] || "").trim();
  if (!boundary) return [];
  const raw = Buffer.isBuffer(buffer) ? buffer.toString("latin1") : String(buffer);
  const files = [];
  for (const chunk of raw.split(`--${boundary}`)) {
    if (!chunk || chunk === "--" || chunk === "--\r\n" || chunk.startsWith("--")) continue;
    const normalized = chunk.startsWith("\r\n") ? chunk.slice(2) : chunk;
    const headerEnd = normalized.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headers = normalized.slice(0, headerEnd);
    const nameMatch = headers.match(/filename\*?=(?:UTF-8''|")?([^";\r\n]+)"?/i);
    if (!nameMatch) continue;
    let filename = nameMatch[1].replace(/"/g, "").trim();
    try {
      filename = decodeURIComponent(filename);
    } catch {
      /* keep raw */
    }
    filename = path.basename(filename);
    if (!filename) continue;
    let body = normalized.slice(headerEnd + 4);
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    const mimeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    files.push({
      filename,
      mimeType: (mimeMatch && mimeMatch[1].trim()) || "application/octet-stream",
      data: Buffer.from(body, "latin1"),
    });
  }
  return files;
}

function attachmentPublicUrl(id) {
  return `http://127.0.0.1:${PORT}/api/attachments/${id}`;
}

function persistIssueAttachments(issueKey, files) {
  const key = String(issueKey || "").trim();
  if (!key || !Array.isArray(files) || !files.length) return [];
  const dir = path.join(ATTACH_DIR, key.replace(/[^\w.-]+/g, "_"));
  fs.mkdirSync(dir, { recursive: true });
  const list = attachments.get(key) || [];
  const saved = [];
  for (const file of files) {
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data || []);
    if (!data.length) continue;
    const id = String(nextAttachId++);
    const filename = path.basename(String(file.filename || `file-${id}`));
    const storedPath = path.join(dir, `${id}-${filename.replace(/[^\w.\-]+/g, "_")}`);
    fs.writeFileSync(storedPath, data);
    const rec = {
      id,
      filename,
      mimeType: file.mimeType || "application/octet-stream",
      size: data.length,
      content: attachmentPublicUrl(id),
      storedPath,
    };
    list.push(rec);
    saved.push(rec);
  }
  attachments.set(key, list);
  return saved;
}

function listAttachments(issueKey) {
  return attachments.get(String(issueKey || "").trim()) || [];
}

function findAttachment(id) {
  const want = String(id || "").trim();
  for (const list of attachments.values()) {
    const found = list.find((item) => item.id === want);
    if (found) return found;
  }
  return null;
}

function attachmentToApi(item) {
  return {
    id: item.id,
    filename: item.filename,
    mimeType: item.mimeType,
    size: item.size,
    content: item.content,
    url: item.content,
  };
}

function adfToText(adf) {
  if (typeof adf === "string") return adf;
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

function listIssues() {
  return [...issues.values()].sort(
    (a, b) => Date.parse(a.fields.updated) - Date.parse(b.fields.updated)
  );
}

function handleSearch(url, res) {
  const maxResults = Math.min(100, Number(url.searchParams.get("maxResults") || 50) || 50);
  const jql = String(url.searchParams.get("jql") || "");
  const tokenRaw = String(url.searchParams.get("nextPageToken") || "").trim();
  const startAt = tokenRaw ? Math.max(0, Number(tokenRaw) || 0) : 0;
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
  const sliced = all.slice(startAt, startAt + maxResults);
  const isLast = startAt + sliced.length >= all.length;
  sendJson(res, 200, {
    expand: "names,schema",
    startAt,
    maxResults,
    total: all.length,
    isLast,
    issues: sliced,
    ...(isLast ? {} : { nextPageToken: String(startAt + sliced.length) }),
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
      if (f === "attachment") {
        fields.attachment = listAttachments(issue.key).map(attachmentToApi);
      } else if (issue.fields[f] != null) fields[f] = issue.fields[f];
    }
    return sendJson(res, 200, { id: issue.id, key: issue.key, fields });
  }
  const withAttach = {
    ...issue,
    fields: {
      ...issue.fields,
      attachment: listAttachments(issue.key).map(attachmentToApi),
    },
  };
  sendJson(res, 200, withAttach);
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

async function handlePutIssue(key, req, res) {
  const issue = findIssue(key);
  if (!issue) {
    return sendJson(res, 404, { errorMessages: [`Issue does not exist.`] });
  }
  const body = await readBody(req);
  const fields = body?.fields || {};
  if (fields.summary != null) {
    issue.fields.summary = String(fields.summary || "").trim();
  }
  if (fields.description != null) {
    issue.fields.description =
      typeof fields.description === "string"
        ? fields.description
        : adfToText(fields.description);
  }
  issue.fields.updated = new Date().toISOString();
  res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
  res.end();
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
    attachments: listAttachments(i.key).map(attachmentToApi),
    url: `http://127.0.0.1:${PORT}/browse/${i.key}`,
  };
}

function createIssueRecord({ key, summary, description, status, priority, issueType, assignee }) {
  const issueKey = String(key || `LIVEACT-${nextIssueId}`).trim().toUpperCase();
  if (issues.has(issueKey)) {
    return { error: "exists", key: issueKey };
  }
  const id = String(nextIssueId++);
  const issue = {
    id,
    key: issueKey,
    fields: {
      summary: String(summary || "New story").trim(),
      description: String(description || "").trim(),
      status: { name: String(status || "To Do").trim() },
      priority: { name: String(priority || "Medium").trim() },
      assignee: {
        displayName: String(assignee || "Demo Agent").trim(),
        emailAddress: DEMO_EMAIL,
      },
      reporter: { displayName: "Demo Agent", emailAddress: DEMO_EMAIL },
      labels: [],
      updated: new Date().toISOString(),
      issuetype: { name: String(issueType || "Task").trim() },
    },
  };
  issues.set(issueKey, issue);
  comments.set(issueKey, []);
  attachments.set(issueKey, []);
  return { issue, id, key: issueKey };
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

  const attachFileMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)$/);
  if (attachFileMatch && req.method === "GET") {
    const rec = findAttachment(decodeURIComponent(attachFileMatch[1]));
    if (!rec || !fs.existsSync(rec.storedPath)) {
      return sendJson(res, 404, { error: "Not found" });
    }
    res.writeHead(200, {
      "Content-Type": rec.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${rec.filename.replace(/"/g, "")}"`,
      "Access-Control-Allow-Origin": "*",
    });
    return fs.createReadStream(rec.storedPath).pipe(res);
  }

  const issueAttachMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/attachments$/);
  if (issueAttachMatch && req.method === "GET") {
    const issue = findIssue(decodeURIComponent(issueAttachMatch[1]));
    if (!issue) return sendJson(res, 404, { error: "Not found" });
    return sendJson(res, 200, { attachments: listAttachments(issue.key).map(attachmentToApi) });
  }

  if (url.pathname === "/api/issues" && req.method === "POST") {
    const body = await readBody(req);
    const created = createIssueRecord({
      key: body.key,
      summary: body.summary,
      description: body.description,
      status: body.status,
      priority: body.priority,
      issueType: body.issueType,
      assignee: body.assignee,
    });
    if (created.error === "exists") {
      return sendJson(res, 409, { error: "Key already exists" });
    }
    return sendJson(res, 201, {
      ok: true,
      key: created.key,
      id: created.id,
      url: `http://127.0.0.1:${PORT}/browse/${created.key}`,
    });
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

    // Never serve dashboard HTML under /rest/* — LiveTrack expects JSON at /rest/api/3/search and /search/jql.
    if (url.pathname.startsWith("/rest/")) {
      if (!checkAuth(req)) {
        return sendJson(res, 401, { errorMessages: ["Unauthorized"] });
      }

      if (!url.pathname.startsWith("/rest/api/3/")) {
        return sendJson(res, 404, { errorMessages: ["Not found"] });
      }

      if (url.pathname === "/rest/api/3/myself" && req.method === "GET") {
        return sendJson(res, 200, {
          accountId: "demo-account",
          displayName: "Demo Agent",
          emailAddress: DEMO_EMAIL,
        });
      }

      const MOCK_PROJECTS = [{ key: "LIVEACT", name: "LiveAct" }];
      if (
        (url.pathname === "/rest/api/3/project" || url.pathname === "/rest/api/3/project/") &&
        req.method === "GET"
      ) {
        return sendJson(res, 200, MOCK_PROJECTS);
      }
      if (
        (url.pathname === "/rest/api/3/project/search" ||
          url.pathname === "/rest/api/3/project/search/") &&
        req.method === "GET"
      ) {
        return sendJson(res, 200, {
          maxResults: 100,
          startAt: 0,
          total: MOCK_PROJECTS.length,
          isLast: true,
          values: MOCK_PROJECTS,
        });
      }
      const projectMatch = url.pathname.match(/^\/rest\/api\/3\/project\/([^/]+)$/);
      if (projectMatch && req.method === "GET") {
        const key = decodeURIComponent(projectMatch[1]).trim().toUpperCase();
        const found = MOCK_PROJECTS.find((p) => p.key === key);
        if (found) return sendJson(res, 200, found);
        return sendJson(res, 404, { errorMessages: [`Project ${key} does not exist.`] });
      }

      const isSearch = /^\/rest\/api\/3\/search(?:\/jql)?\/?$/.test(url.pathname);
      if (isSearch && (req.method === "GET" || req.method === "POST")) {
        if (req.method === "POST") {
          try {
            const body = await readBody(req);
            if (body?.jql && !url.searchParams.get("jql")) {
              url.searchParams.set("jql", String(body.jql));
            }
            if (body?.maxResults != null && !url.searchParams.get("maxResults")) {
              url.searchParams.set("maxResults", String(body.maxResults));
            }
            if (body?.nextPageToken && !url.searchParams.get("nextPageToken")) {
              url.searchParams.set("nextPageToken", String(body.nextPageToken));
            }
          } catch {
            /* ignore body parse; still run search with query params */
          }
        }
        return handleSearch(url, res);
      }

      if (url.pathname === "/rest/api/3/issue" && req.method === "POST") {
        const body = await readBody(req);
        const fields = body.fields || {};
        const projectKey = String(fields.project?.key || "LIVEACT").trim().toUpperCase();
        const summary = fields.summary;
        const description =
          typeof fields.description === "string"
            ? fields.description
            : adfToText(fields.description);
        const created = createIssueRecord({
          key: `${projectKey}-${nextIssueId}`,
          summary,
          description,
          issueType: fields.issuetype?.name || "Task",
        });
        if (created.error === "exists") {
          return sendJson(res, 409, { errorMessages: ["Issue already exists"] });
        }
        return sendJson(res, 201, { id: created.id, key: created.key, self: `http://127.0.0.1:${PORT}/rest/api/3/issue/${created.key}` });
      }

      const attachMatch = url.pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)\/attachments$/);
      if (attachMatch && req.method === "POST") {
        const issue = findIssue(decodeURIComponent(attachMatch[1]));
        if (!issue) {
          return sendJson(res, 404, { errorMessages: ["Issue does not exist."] });
        }
        const raw = await readRawBody(req);
        const files = parseMultipartFiles(raw, req.headers["content-type"]);
        const saved = persistIssueAttachments(issue.key, files);
        if (saved.length) {
          const names = saved.map((item) => item.filename).join(", ");
          const note = `\n\n[Attached: ${names}]`;
          issue.fields.description = `${issue.fields.description || ""}${note}`.trim();
        } else {
          issue.fields.description = `${issue.fields.description || ""}\n\n[Attachment received]`.trim();
        }
        issue.fields.updated = new Date().toISOString();
        return sendJson(res, 200, saved.map(attachmentToApi));
      }

      const issueMatch = url.pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)$/);
      if (issueMatch && (req.method === "PUT" || req.method === "PATCH")) {
        return await handlePutIssue(decodeURIComponent(issueMatch[1]), req, res);
      }
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

function startLocalJiraMock(port = PORT) {
  const listenPort = Number(port || PORT) || PORT;
  return new Promise((resolve, reject) => {
    if (server.listening) {
      resolve({ ok: true, already: true, port: listenPort });
      return;
    }
    const onError = (err) => {
      server.off("error", onError);
      if (err?.code === "EADDRINUSE") {
        resolve({ ok: true, already: true, port: listenPort });
        return;
      }
      reject(err);
    };
    server.once("error", onError);
    server.listen(listenPort, "127.0.0.1", () => {
      server.off("error", onError);
      console.log(`[jira-mock] dashboard  http://127.0.0.1:${listenPort}/`);
      console.log(`[jira-mock] API base   http://127.0.0.1:${listenPort}`);
      resolve({ ok: true, already: false, port: listenPort });
    });
  });
}

if (require.main === module) {
  startLocalJiraMock().catch((err) => {
    console.error("[jira-mock]", err);
    process.exit(1);
  });
}

module.exports = {
  startLocalJiraMock,
  PORT,
  createIssueRecord,
  parseMultipartFiles,
  persistIssueAttachments,
  listAttachments,
};

