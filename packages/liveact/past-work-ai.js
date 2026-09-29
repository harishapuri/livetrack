/**
 * AI helpers for past-work JQL phrases and relatedness ranking.
 * Never invents ticket keys — rank output is filtered to the candidate list.
 */

function sanitizeJqlPhrase(raw) {
  return String(raw || "")
    .replace(/["'\\]/g, " ")
    .replace(/[^\w.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function parseJsonObject(text) {
  let raw = String(text || "").trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const data = JSON.parse(match[0]);
        if (data && typeof data === "object" && !Array.isArray(data)) return data;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeRelKey(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[\s.#]+/g, "")
    .trim();
}

function parsePastWorkSearchJson(text) {
  const data = parseJsonObject(text) || {};
  const keywords = (Array.isArray(data.keywords) ? data.keywords : [])
    .map((item) => sanitizeJqlPhrase(item))
    .filter(Boolean)
    .slice(0, 6);
  const textQuery = sanitizeJqlPhrase(data.textQuery) || keywords.join(" ");
  return { textQuery, keywords };
}

function parsePastWorkRankJson(text, candidates = []) {
  const allowed = new Set(
    (Array.isArray(candidates) ? candidates : [])
      .map((item) => normalizeRelKey(item?.key || item))
      .filter(Boolean)
  );
  const data = parseJsonObject(text) || {};
  const rows = Array.isArray(data.related) ? data.related : [];
  const related = [];
  const seen = new Set();
  for (const row of rows) {
    const key = String(row?.key || "").trim();
    const norm = normalizeRelKey(key);
    if (!norm || seen.has(norm) || (allowed.size && !allowed.has(norm))) continue;
    seen.add(norm);
    const score = Number(row?.score);
    related.push({
      key,
      keep: row?.keep !== false && row?.keep !== 0 && row?.keep !== "false",
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 70,
    });
  }
  return { related };
}

function parseRelatedTicketList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item?.key || item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,;]+/)
    .map((part) => String(part || "").trim())
    .filter(Boolean);
}

/**
 * One-line summaries for comment-history ticket numbers. Never invent keys.
 */
function parsePastWorkTicketSummaryJson(text, allowedKeys = []) {
  const allowed = new Set(
    (Array.isArray(allowedKeys) ? allowedKeys : [])
      .map((item) => normalizeRelKey(item?.key || item))
      .filter(Boolean)
  );
  const data = parseJsonObject(text) || {};
  const rows = Array.isArray(data.tickets) ? data.tickets : [];
  const tickets = [];
  const seen = new Set();
  for (const row of rows) {
    const key = String(row?.key || "").trim();
    const norm = normalizeRelKey(key);
    const summary = String(row?.summary || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!norm || !summary || seen.has(norm) || (allowed.size && !allowed.has(norm))) continue;
    seen.add(norm);
    tickets.push({ key, summary });
  }
  return { tickets };
}

function applyTicketSummariesToIssue(issue, tickets = []) {
  const byKey = new Map();
  for (const row of Array.isArray(tickets) ? tickets : []) {
    const key = normalizeRelKey(row?.key);
    const summary = String(row?.summary || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (key && summary) byKey.set(key, summary);
  }
  const parentSummary = String(issue?.summary || "").trim();
  const parentDesc = String(issue?.description || "").trim();
  const related = Array.isArray(issue?.relatedTickets) ? issue.relatedTickets : [];
  return {
    ...issue,
    relatedTickets: related.map((item) => {
      const key = normalizeRelKey(item?.key);
      const next = byKey.get(key);
      if (!next) return item;
      const current = String(item?.summary || "").trim();
      if (current && current !== parentSummary && current !== parentDesc) return item;
      return { ...item, summary: next };
    }),
  };
}

function commentSnippetsForTickets(commentText, tickets = []) {
  const text = String(commentText || "");
  const upper = text.toUpperCase();
  return (Array.isArray(tickets) ? tickets : [])
    .map((item) => {
      const key = String(item?.key || item || "").trim();
      if (!key) return null;
      const idx = upper.indexOf(key.toUpperCase());
      let snippet = "";
      if (idx >= 0) {
        snippet = text
          .slice(Math.max(0, idx - 140), Math.min(text.length, idx + key.length + 180))
          .replace(/\s+/g, " ")
          .trim();
      }
      return { key, snippet };
    })
    .filter(Boolean);
}

/**
 * Keep the current ticket row; keep other stories AI marked keep;
 * filter related_tickets to keys AI kept. If AI kept nothing, leave rows as-is.
 */
function applyRankToPastWorkRows(rows, rank = {}, { issueKey = "" } = {}) {
  const related = Array.isArray(rank?.related) ? rank.related : [];
  const keep = new Set(
    related.filter((item) => item.keep).map((item) => normalizeRelKey(item.key)).filter(Boolean)
  );
  if (!keep.size) return Array.isArray(rows) ? rows : [];
  const scores = new Map();
  for (const item of related) {
    const key = normalizeRelKey(item.key);
    if (!key) continue;
    scores.set(key, item.score);
  }
  const focus = normalizeRelKey(issueKey);
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowKey = normalizeRelKey(row?.jira_key);
    if (!rowKey) continue;
    const tickets = parseRelatedTicketList(row.relatedTickets || row.related_tickets);
    const nextTickets = tickets.filter((item) => keep.has(normalizeRelKey(item)));
    const isFocus = Boolean(focus) && rowKey === focus;
    if (!isFocus && !keep.has(rowKey)) continue;
    const matchScore = isFocus
      ? Math.max(Number(row.matchScore) || 0, 100)
      : scores.get(rowKey) || row.matchScore;
    out.push({
      ...row,
      related_tickets: nextTickets.join(", "),
      relatedTickets: nextTickets,
      matchScore,
    });
  }
  return out.length ? out : Array.isArray(rows) ? rows : [];
}

module.exports = {
  sanitizeJqlPhrase,
  parseJsonObject,
  parsePastWorkSearchJson,
  parsePastWorkRankJson,
  parsePastWorkTicketSummaryJson,
  applyTicketSummariesToIssue,
  commentSnippetsForTickets,
  applyRankToPastWorkRows,
  normalizeRelKey,
};
