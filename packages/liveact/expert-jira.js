/**
 * Project-wide Jira pull for Find the Expert.
 * Does not use assignee = currentUser() (queue JQL stays personal).
 */

const {
  jiraFetch,
  parseJiraHttpResponse,
  buildSearchJqlGetPath,
  jiraAdfToText,
  htmlToPlain,
  normalizeConfig,
  isConfigured,
  originFromJiraSiteUrl,
} = require("./jira");
const { sanitizeJqlPhrase } = require("./past-work-ai");
const {
  cell,
  parseTagList,
  personFromUser,
  isTestTicket,
  isLowQualityText,
  matchSystemTag,
  makeRecord,
} = require("./expert-records");

function quoteJqlValue(value) {
  const raw = cell(value);
  if (!raw) return '""';
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '\\"')}"`;
}

function buildExpertJql({ projectKey, systemTags, expertJql, textQuery } = {}) {
  const phrase = sanitizeJqlPhrase(textQuery);
  const custom = cell(expertJql);
  const project = cell(projectKey) || "LIVEACT";
  const tags = parseTagList(systemTags);
  const parts = [];
  if (custom) {
    parts.push(custom.replace(/\s+ORDER\s+BY\s+.+$/i, "").trim());
  } else {
    parts.push(`project = ${quoteJqlValue(project)}`);
    if (tags.length) {
      const list = tags.map(quoteJqlValue).join(", ");
      parts.push(`(component in (${list}) OR labels in (${list}))`);
    }
  }
  if (phrase) {
    parts.push(
      `(summary ~ "${phrase}" OR description ~ "${phrase}" OR text ~ "${phrase}")`
    );
  }
  return `${parts.filter(Boolean).join(" AND ")} ORDER BY updated DESC`;
}

function searchJqlGetNotSupported(status) {
  const code = Number(status) || 0;
  return code === 404 || code === 405 || code === 410 || code === 501;
}

function issueUrl(baseUrl, key) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  return `${root}/browse/${key}`;
}

function resolverFromChangelog(histories) {
  const rows = Array.isArray(histories) ? histories : [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const history = rows[i];
    const items = Array.isArray(history?.items) ? history.items : [];
    for (const item of items) {
      const field = String(item?.field || "").toLowerCase();
      const to = cell(item?.toString);
      if (field === "resolution" && to) return personFromUser(history.author);
      if (field === "status" && /^(resolved|done|closed|complete|completed)$/i.test(to)) {
        return personFromUser(history.author);
      }
    }
  }
  return null;
}

async function searchExpertIssues(
  config,
  { maxResults = 80, forceRefresh = false, textQuery = "", systemFilter = "" } = {}
) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) {
    return {
      ok: false,
      issues: [],
      error:
        "Configure Jira in Settings: site URL, email, and API token. Sign in at id.atlassian.com (complete 2FA there), then create a token — do not paste your password.",
    };
  }
  const jql = buildExpertJql({
    projectKey: config.jiraProjectKey || c.projectKey,
    systemTags: systemFilter || config.expertSystemTags,
    expertJql: config.expertJql,
    textQuery,
  });
  const cap = Math.min(120, Math.max(1, Number(maxResults) || 80));
  const collected = [];
  let nextPageToken = "";
  const searchPath = "/rest/api/3/search/jql";
  const fields = [
    "summary",
    "description",
    "status",
    "assignee",
    "reporter",
    "components",
    "labels",
    "updated",
    "resolutiondate",
    "comment",
    "issuetype",
  ];
  for (let page = 0; page < 4 && collected.length < cap; page++) {
    const payload = {
      jql,
      maxResults: Math.min(50, cap - collected.length),
      fields,
    };
    if (nextPageToken) payload.nextPageToken = nextPageToken;
    let res;
    const getPath = buildSearchJqlGetPath(searchPath, payload);
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
    const parsed = await parseJiraHttpResponse(res, { baseUrl: c.baseUrl, pathname: searchPath });
    if (!parsed.parseOk || !res.ok) {
      return {
        ok: false,
        issues: collected,
        jql,
        error: parsed.error || `Jira search failed (${res?.status || 0}).`,
      };
    }
    const pageIssues = Array.isArray(parsed.data?.issues) ? parsed.data.issues : [];
    collected.push(...pageIssues);
    nextPageToken = String(parsed.data?.nextPageToken || "").trim();
    if (parsed.data?.isLast === true || !nextPageToken || !pageIssues.length) break;
  }
  return { ok: true, issues: collected.slice(0, cap), jql };
}

async function fetchIssueChangelog(config, issueKey, { forceRefresh = false } = {}) {
  const c = normalizeConfig(config);
  const key = cell(issueKey);
  if (!key) return [];
  const path = `/rest/api/3/issue/${encodeURIComponent(key)}/changelog?startAt=0&maxResults=100`;
  const res = await jiraFetch(c, path, { method: "GET", forceRefresh });
  const parsed = await parseJiraHttpResponse(res, {
    baseUrl: c.baseUrl,
    pathname: `/rest/api/3/issue/${encodeURIComponent(key)}/changelog`,
  });
  if (!parsed.parseOk || !res.ok) return [];
  return parsed.data?.values || parsed.data?.histories || [];
}

function recordsFromIssue(issue, { baseUrl, systemTags, resolver } = {}) {
  const fields = issue?.fields || {};
  const key = cell(issue?.key);
  if (!key) return [];
  const summary = cell(fields.summary);
  const labels = Array.isArray(fields.labels) ? fields.labels : [];
  if (isTestTicket(summary, labels)) return [];
  const description = jiraAdfToText(fields.description);
  const comments = Array.isArray(fields.comment?.comments) ? fields.comment.comments : [];
  const commentText = comments
    .map((row) => cell(jiraAdfToText(row?.body) || htmlToPlain(row?.renderedBody)))
    .filter(Boolean)
    .join("\n");
  const text = [summary, description, commentText].filter(Boolean).join("\n");
  if (isLowQualityText(text)) return [];
  const components = (Array.isArray(fields.components) ? fields.components : []).map((row) =>
    cell(row?.name || row)
  );
  const system_tag = matchSystemTag([...components, ...labels], parseTagList(systemTags));
  const url = issueUrl(baseUrl || originFromJiraSiteUrl(""), key);
  const date = cell(fields.resolutiondate || fields.updated);
  const title = summary;
  const out = [];
  const seen = new Set();
  const push = (user, role) => {
    const person = personFromUser(user);
    if (!person) return;
    const id = `${person.personAccountId || person.personEmail || person.person}:${role}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(
      makeRecord({
        source: "jira",
        system_tag,
        ...person,
        role_signal: role,
        text,
        date,
        reference_id: key,
        url,
        title,
      })
    );
  };
  if (resolver) push(resolver, "resolver");
  else if (fields.assignee) push(fields.assignee, "assignee");
  for (const comment of comments) push(comment.author || comment.updateAuthor, "commenter");
  return out;
}

async function collectJiraExpertRecords(
  config,
  { maxResults = 80, forceRefresh = false, textQuery = "", systemFilter = "", skipChangelog = false } = {}
) {
  const c = normalizeConfig(config);
  const search = await searchExpertIssues(config, {
    maxResults,
    forceRefresh,
    textQuery,
    systemFilter,
  });
  if (!search.ok) return { ok: false, records: [], error: search.error, jql: search.jql };
  const records = [];
  const changelogCap = skipChangelog ? 0 : Math.min(search.issues.length, 40);
  for (let i = 0; i < search.issues.length; i++) {
    const issue = search.issues[i];
    let resolver = null;
    if (i < changelogCap) {
      try {
        const histories = await fetchIssueChangelog(config, issue.key, { forceRefresh });
        resolver = resolverFromChangelog(histories);
      } catch {
        resolver = null;
      }
    }
    records.push(
      ...recordsFromIssue(issue, {
        baseUrl: c.baseUrl,
        systemTags: systemFilter || config.expertSystemTags,
        resolver,
      })
    );
  }
  return { ok: true, records, jql: search.jql, issueCount: search.issues.length };
}

async function fetchUserActive(config, accountId) {
  const c = normalizeConfig(config);
  const id = cell(accountId);
  if (!id) return true;
  const res = await jiraFetch(c, `/rest/api/3/user?accountId=${encodeURIComponent(id)}`, {
    method: "GET",
  });
  const parsed = await parseJiraHttpResponse(res, {
    baseUrl: c.baseUrl,
    pathname: "/rest/api/3/user",
  });
  if (!parsed.parseOk || !res.ok) return true;
  if (parsed.data?.active == null) return true;
  return Boolean(parsed.data.active);
}

module.exports = {
  quoteJqlValue,
  buildExpertJql,
  resolverFromChangelog,
  recordsFromIssue,
  searchExpertIssues,
  fetchIssueChangelog,
  collectJiraExpertRecords,
  fetchUserActive,
};
