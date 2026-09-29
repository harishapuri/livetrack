/**
 * Confluence Cloud pull for Find the Expert (CQL + page versions).
 * Uses the same Atlassian email/token as Jira.
 */

const {
  jiraFetch,
  parseJiraHttpResponse,
  normalizeConfig,
  isConfigured,
  originFromJiraSiteUrl,
  htmlToPlain,
} = require("./jira");
const {
  cell,
  parseTagList,
  personFromUser,
  isLowQualityText,
  matchSystemTag,
  makeRecord,
} = require("./expert-records");

function wikiOrigin(baseUrl) {
  return String(originFromJiraSiteUrl(baseUrl) || baseUrl || "").replace(/\/+$/, "");
}

function pageUrl(baseUrl, id, title) {
  const root = wikiOrigin(baseUrl);
  if (id) return `${root}/wiki/spaces?pageId=${encodeURIComponent(id)}`;
  return `${root}/wiki`;
}

function buildExpertCql({ spaceKeys, systemTags } = {}) {
  const spaces = parseTagList(spaceKeys);
  if (!spaces.length) return "";
  const spaceClause =
    spaces.length === 1
      ? `space = ${spaces[0]}`
      : `space in (${spaces.join(", ")})`;
  const tags = parseTagList(systemTags);
  if (!tags.length) return `${spaceClause} AND type = page ORDER BY lastmodified DESC`;
  const labelPart = tags.map((tag) => `label = "${tag.replace(/"/g, '\\"')}"`).join(" OR ");
  const textPart = tags.map((tag) => `text ~ "${tag.replace(/"/g, '\\"')}"`).join(" OR ");
  return `${spaceClause} AND type = page AND (${labelPart} OR ${textPart}) ORDER BY lastmodified DESC`;
}

function labelsFromContent(page) {
  const raw = page?.metadata?.labels?.results || page?.labels || [];
  return (Array.isArray(raw) ? raw : []).map((row) => cell(row?.name || row)).filter(Boolean);
}

function recordsFromPage(page, { baseUrl, systemTags, versions } = {}) {
  const id = cell(page?.id);
  if (!id) return [];
  const title = cell(page?.title);
  const body = htmlToPlain(page?.body?.storage?.value || page?.body?.view?.value || "");
  const text = [title, body].filter(Boolean).join("\n");
  if (isLowQualityText(text) && isLowQualityText(title)) return [];
  const labels = labelsFromContent(page);
  const system_tag = matchSystemTag([...labels, title], parseTagList(systemTags));
  const url = cell(page?._links?.webui)
    ? `${wikiOrigin(baseUrl)}/wiki${String(page._links.webui).startsWith("/") ? page._links.webui : `/${page._links.webui}`}`
    : pageUrl(baseUrl, id, title);
  const out = [];
  const seen = new Set();
  const push = (user, role, date) => {
    const person = personFromUser(user);
    if (!person) return;
    const key = `${person.personAccountId || person.personEmail || person.person}:${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(
      makeRecord({
        source: "confluence",
        system_tag,
        ...person,
        role_signal: role,
        text: text || title,
        date: cell(date),
        reference_id: id,
        url,
        title,
      })
    );
  };
  const created = page?.history?.createdBy || page?.version?.by;
  push(created, "author", page?.history?.createdDate || page?.version?.when);
  const editors = Array.isArray(versions) ? versions : [];
  for (const version of editors) {
    push(version?.author || version?.by, "editor", version?.createdAt || version?.when);
  }
  if (!out.length) {
    push(page?.version?.by, "editor", page?.version?.when);
  }
  return out;
}

async function searchConfluencePages(config, { maxResults = 40, forceRefresh = false } = {}) {
  const c = normalizeConfig(config);
  if (!isConfigured(c)) return { ok: false, pages: [], error: "Configure Jira/Confluence in Settings." };
  const cql = buildExpertCql({
    spaceKeys: config.confluenceSpaceKeys,
    systemTags: config.expertSystemTags,
  });
  if (!cql) return { ok: true, pages: [], cql: "", skipped: true };
  const cap = Math.min(80, Math.max(1, Number(maxResults) || 40));
  const params = new URLSearchParams();
  params.set("cql", cql);
  params.set("limit", String(Math.min(25, cap)));
  params.set("expand", "body.storage,history,history.lastUpdated,metadata.labels,version");
  const path = `/wiki/rest/api/content/search?${params.toString()}`;
  const res = await jiraFetch(c, path, { method: "GET", forceRefresh });
  const parsed = await parseJiraHttpResponse(res, {
    baseUrl: c.baseUrl,
    pathname: "/wiki/rest/api/content/search",
  });
  if (!parsed.parseOk || !res.ok) {
    return {
      ok: false,
      pages: [],
      cql,
      error: parsed.error || `Confluence search failed (${res?.status || 0}).`,
    };
  }
  const pages = Array.isArray(parsed.data?.results) ? parsed.data.results : [];
  return { ok: true, pages: pages.slice(0, cap), cql };
}

async function fetchPageVersions(config, pageId, { forceRefresh = false } = {}) {
  const c = normalizeConfig(config);
  const id = cell(pageId);
  if (!id) return [];
  const path = `/wiki/api/v2/pages/${encodeURIComponent(id)}/versions?limit=25`;
  const res = await jiraFetch(c, path, { method: "GET", forceRefresh });
  const parsed = await parseJiraHttpResponse(res, {
    baseUrl: c.baseUrl,
    pathname: `/wiki/api/v2/pages/${encodeURIComponent(id)}/versions`,
  });
  if (!parsed.parseOk || !res.ok) return [];
  return Array.isArray(parsed.data?.results) ? parsed.data.results : [];
}

async function collectConfluenceExpertRecords(config, { maxResults = 40, forceRefresh = false } = {}) {
  const c = normalizeConfig(config);
  const search = await searchConfluencePages(config, { maxResults, forceRefresh });
  if (search.skipped) return { ok: true, records: [], skipped: true, cql: "" };
  if (!search.ok) return { ok: false, records: [], error: search.error, cql: search.cql };
  const records = [];
  for (const page of search.pages) {
    let versions = [];
    try {
      versions = await fetchPageVersions(config, page.id, { forceRefresh });
    } catch {
      versions = [];
    }
    records.push(
      ...recordsFromPage(page, {
        baseUrl: c.baseUrl,
        systemTags: config.expertSystemTags,
        versions,
      })
    );
  }
  return { ok: true, records, cql: search.cql, pageCount: search.pages.length };
}

module.exports = {
  wikiOrigin,
  buildExpertCql,
  recordsFromPage,
  searchConfluencePages,
  fetchPageVersions,
  collectConfluenceExpertRecords,
};
