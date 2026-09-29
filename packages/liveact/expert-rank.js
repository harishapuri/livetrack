/**
 * Query the local expert index and rank people with evidence.
 * If the index is empty, search Jira live for the query.
 */

const { loadSettings } = require("./settings");
const { loadExpertIndex, embedTexts } = require("./expert-index");
const { collectJiraExpertRecords, fetchUserActive } = require("./expert-jira");
const {
  cell,
  parseTagList,
  personKey,
  cosineSimilarity,
  isVagueQuery,
  groupExperts,
  formatExpertResult,
  hashEmbed,
} = require("./expert-records");

function denylistSet(raw) {
  return new Set(parseTagList(raw).map((row) => row.toLowerCase()));
}

function isDenied(person, deny) {
  const email = cell(person.personEmail).toLowerCase();
  const name = cell(person.person).toLowerCase();
  if (email && deny.has(email)) return true;
  if (name && deny.has(name)) return true;
  return false;
}

async function filterActivePeople(people, settings, { fetchActive = fetchUserActive } = {}) {
  const deny = denylistSet(settings.expertInactiveEmails);
  const out = [];
  for (const person of people) {
    if (isDenied(person, deny)) continue;
    let active = true;
    if (person.personAccountId) {
      try {
        active = await fetchActive(settings, person.personAccountId);
      } catch {
        active = true;
      }
    }
    if (!active) continue;
    out.push(person);
  }
  return out;
}

async function rankRecords(records, query, { systemFilter = "", limit = 5, settings } = {}) {
  const filter = cell(systemFilter);
  const corpus = filter
    ? records.filter((row) => cell(row.system_tag).toLowerCase() === filter.toLowerCase())
    : records;
  if (!corpus.length) return { people: [], scored: 0 };
  const { vectors } = await embedTexts([query, ...corpus.map((row) => row.text || "")]);
  const queryVec = vectors[0];
  const scored = corpus
    .map((row, i) => ({
      ...row,
      similarity: cosineSimilarity(queryVec, vectors[i + 1] || row.embedding || hashEmbed(row.text || "")),
    }))
    .filter((row) => row.similarity > 0.02)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 20);
  if (!scored.length) return { people: [], scored: 0 };
  const grouped = groupExperts(scored, { limit: Math.max(5, Number(limit) || 5) });
  const people = (await filterActivePeople(grouped, settings || loadSettings())).slice(
    0,
    Math.max(1, Number(limit) || 5)
  );
  return { people, scored: scored.length };
}

async function liveJiraRecords(query, systemFilter) {
  const settings = loadSettings();
  return collectJiraExpertRecords(settings, {
    maxResults: 40,
    forceRefresh: true,
    textQuery: query,
    systemFilter,
    skipChangelog: true,
  });
}

async function findExpert(queryText, { systemFilter = "", limit = 5 } = {}) {
  const query = cell(queryText);
  if (!query) {
    return { ok: false, error: "Enter a system or issue to search.", people: [] };
  }
  if (isVagueQuery(query, systemFilter)) {
    return {
      ok: true,
      clarify: true,
      people: [],
      message:
        "Which system or issue type? Try a phrase like two factor authentication or LOS onboarding.",
    };
  }
  const settings = loadSettings();
  const filter = cell(systemFilter);
  const index = loadExpertIndex();
  if (index.records.length) {
    const ranked = await rankRecords(index.records, query, { systemFilter: filter, limit, settings });
    if (ranked.people.length) {
      return {
        ok: true,
        people: ranked.people,
        query,
        systemFilter: filter,
        source: "index",
        summary: ranked.people.map(formatExpertResult).join("\n\n"),
      };
    }
  }

  const live = await liveJiraRecords(query, filter);
  if (!live.ok) {
    return { ok: false, error: live.error || "Jira search failed.", people: [], jql: live.jql };
  }
  if (!live.records.length) {
    return {
      ok: true,
      people: [],
      jql: live.jql,
      message: `No Jira tickets matched “${query}”. Check the project key in Settings (currently ${
        settings.jiraProjectKey || "LIVEACT"
      }) and that the API token can read that project.`,
    };
  }
  const ranked = await rankRecords(live.records, query, { systemFilter: "", limit, settings });
  if (!ranked.people.length) {
    return {
      ok: true,
      people: [],
      jql: live.jql,
      message: `Found ${live.issueCount || live.records.length} tickets but could not rank people. Tickets may have no assignee.`,
    };
  }
  return {
    ok: true,
    people: ranked.people,
    query,
    systemFilter: filter,
    source: "jira-live",
    jql: live.jql,
    summary: ranked.people.map(formatExpertResult).join("\n\n"),
  };
}

module.exports = {
  findExpert,
  filterActivePeople,
  isDenied,
  personKey,
  rankRecords,
};
