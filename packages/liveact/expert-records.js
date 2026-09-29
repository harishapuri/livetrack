/**
 * Shared schema, junk filters, hashing embeddings, and person ranking math
 * for Find the Expert (Jira + Confluence).
 */

const crypto = require("crypto");

const QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "about",
  "at",
  "for",
  "from",
  "good",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "know",
  "knows",
  "me",
  "of",
  "on",
  "please",
  "stuff",
  "the",
  "this",
  "to",
  "who",
  "whom",
  "with",
  "worked",
  "works",
]);

const ROLE_WEIGHTS = {
  resolver: 1,
  author: 0.9,
  assignee: 0.75,
  editor: 0.5,
  commenter: 0.4,
};

const HASH_DIMS = 256;

function cell(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseTagList(raw) {
  return String(raw || "")
    .split(/[,;\n]+/)
    .map((part) => cell(part))
    .filter(Boolean);
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
}

function personFromUser(user) {
  if (!user || typeof user !== "object") return null;
  const name = cell(
    user.person || user.displayName || user.publicName || user.name
  );
  const email = cell(user.personEmail || user.emailAddress || user.email);
  const accountId = cell(user.personAccountId || user.accountId || user.account_id);
  if (!name && !email && !accountId) return null;
  return {
    person: name || email || accountId,
    personEmail: email,
    personAccountId: accountId,
    active: user.active == null ? true : Boolean(user.active),
  };
}

function personKey(record) {
  const id = cell(record?.personAccountId).toLowerCase();
  if (id) return `id:${id}`;
  const email = cell(record?.personEmail).toLowerCase();
  if (email) return `email:${email}`;
  const name = cell(record?.person).toLowerCase();
  return name ? `name:${name}` : "";
}

function isTestTicket(summary, labels = []) {
  const title = cell(summary);
  if (/^(test|testing|dummy|ignore me)\b/i.test(title)) return true;
  const tags = (Array.isArray(labels) ? labels : []).map((row) => cell(row).toLowerCase());
  return tags.some((tag) => tag === "test" || tag === "testing" || tag === "dummy");
}

function isLowQualityText(text) {
  return cell(text).length < 12;
}

function matchSystemTag(tags, candidates) {
  const wanted = (Array.isArray(candidates) ? candidates : []).map((row) => cell(row).toLowerCase());
  const have = (Array.isArray(tags) ? tags : []).map((row) => cell(row).toLowerCase());
  if (!wanted.length) return "";
  for (const tag of have) {
    const hit = wanted.find((item) => item === tag || tag.includes(item) || item.includes(tag));
    if (hit) {
      const original = candidates.find((item) => cell(item).toLowerCase() === hit);
      return original || hit;
    }
  }
  return "";
}

function makeRecord(partial) {
  const text = cell(partial.text);
  const person = cell(partial.person);
  return {
    source: partial.source === "confluence" ? "confluence" : "jira",
    system_tag: cell(partial.system_tag),
    person,
    personEmail: cell(partial.personEmail),
    personAccountId: cell(partial.personAccountId),
    role_signal: cell(partial.role_signal) || "assignee",
    text,
    date: cell(partial.date),
    reference_id: cell(partial.reference_id),
    url: cell(partial.url),
    title: cell(partial.title),
    active: partial.active == null ? true : Boolean(partial.active),
  };
}

function hashEmbed(text, dims = HASH_DIMS) {
  const vec = new Array(dims).fill(0);
  for (const token of tokenize(text)) {
    const idx = parseInt(crypto.createHash("md5").update(token).digest("hex").slice(0, 8), 16) % dims;
    vec[idx] += 1;
  }
  return vec;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

function recencyWeight(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0.4;
  const days = Math.max(0, (now - t) / (1000 * 60 * 60 * 24));
  return Math.exp(-days / 180);
}

function roleWeight(signal) {
  const key = cell(signal).toLowerCase();
  return ROLE_WEIGHTS[key] != null ? ROLE_WEIGHTS[key] : 0.35;
}

function isVagueQuery(query, systemFilter = "") {
  if (cell(systemFilter)) return false;
  const tokens = tokenize(query).filter((token) => !QUERY_STOPWORDS.has(token) && token.length > 1);
  return tokens.length < 2;
}

function scorePersonGroup(matches, now = Date.now()) {
  const count = matches.length;
  const frequency = Math.log(1 + count);
  let recency = 0;
  let role = 0;
  let sim = 0;
  for (const match of matches) {
    recency = Math.max(recency, recencyWeight(match.date, now));
    role = Math.max(role, roleWeight(match.role_signal));
    sim += Number(match.similarity) || 0;
  }
  const avgSim = count ? sim / count : 0;
  const score = frequency * (0.35 + recency) * (0.4 + role) * (0.5 + avgSim);
  return { score, frequency, recency, role, avgSim, count };
}

function groupExperts(hits, { limit = 5 } = {}) {
  const groups = new Map();
  for (const hit of hits) {
    const key = personKey(hit);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(hit);
  }
  const people = [];
  for (const [, matches] of groups) {
    const stats = scorePersonGroup(matches);
    const sample = matches[0];
    const evidence = matches
      .slice()
      .sort((a, b) => (Number(b.similarity) || 0) - (Number(a.similarity) || 0))
      .slice(0, 6)
      .map((row) => ({
        source: row.source,
        role_signal: row.role_signal,
        reference_id: row.reference_id,
        title: row.title || row.reference_id,
        url: row.url,
        date: row.date,
        snippet: cell(row.text).slice(0, 180),
        similarity: Math.round((Number(row.similarity) || 0) * 1000) / 1000,
      }));
    people.push({
      person: sample.person,
      personEmail: sample.personEmail,
      personAccountId: sample.personAccountId,
      score: Math.round(stats.score * 1000) / 1000,
      matchCount: stats.count,
      role: matches.reduce((best, row) => (roleWeight(row.role_signal) > roleWeight(best) ? row.role_signal : best), matches[0].role_signal),
      evidence,
    });
  }
  people.sort((a, b) => b.score - a.score || b.matchCount - a.matchCount);
  return people.slice(0, Math.max(1, Number(limit) || 5));
}

function daysAgoLabel(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const days = Math.round((now - t) / (1000 * 60 * 60 * 24));
  if (days <= 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 45) return `${Math.max(1, Math.round(days / 7))} weeks ago`;
  if (days < 400) return `${Math.max(1, Math.round(days / 30))} months ago`;
  return `${Math.max(1, Math.round(days / 365))} years ago`;
}

function formatExpertResult(person) {
  const refs = (person.evidence || [])
    .map((row) => row.reference_id)
    .filter(Boolean)
    .slice(0, 4);
  const latest = (person.evidence || []).map((row) => row.date).filter(Boolean).sort().reverse()[0];
  const recency = daysAgoLabel(latest);
  const jiraCount = (person.evidence || []).filter((row) => row.source === "jira").length;
  const sop = (person.evidence || []).find((row) => row.source === "confluence");
  const lines = [
    `${person.person}${person.personEmail ? ` (${person.personEmail})` : ""}`,
    `Evidence: ${person.matchCount} match${person.matchCount === 1 ? "" : "es"} as ${person.role}${recency ? `, most recent ${recency}` : ""}${jiraCount ? ` · ${jiraCount} Jira` : ""}`,
  ];
  if (refs.length) lines.push(`Reference: ${refs.join(", ")}`);
  if (sop) lines.push(`SOP: ${sop.title} (${sop.reference_id})`);
  return lines.join("\n");
}

module.exports = {
  QUERY_STOPWORDS,
  ROLE_WEIGHTS,
  HASH_DIMS,
  cell,
  parseTagList,
  tokenize,
  personFromUser,
  personKey,
  isTestTicket,
  isLowQualityText,
  matchSystemTag,
  makeRecord,
  hashEmbed,
  cosineSimilarity,
  recencyWeight,
  roleWeight,
  isVagueQuery,
  scorePersonGroup,
  groupExperts,
  daysAgoLabel,
  formatExpertResult,
};
