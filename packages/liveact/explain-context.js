/**
 * Resolve ticket + past-recording context for Desk "Explain this window".
 * Soft-fails: empty historyBlock means Explain behaves as screenshot-only.
 *
 * Matches by Jira key when present; otherwise by page URL / title against
 * prior capture clickstreams (form refs, steps, values).
 */
const { extractJiraKey } = require("./dashboard-stats");
const { getJiraConfig, isConfigured, fetchIssueByKey, searchIssues } = require("./jira");
const {
  findSimilarCaptures,
  formatCaptureHistoryBlock,
  matchConfidencePercent,
  confidenceLabel,
} = require("./capture-forward");
const { lookupPastWork, formatStoredPastWorkBlock, issueToRow } = require("./past-work-store");
const { applyRankToPastWorkRows } = require("./past-work-ai");

const CONTEXT_BUDGET_MS = 2500;
const AI_PAST_WORK_MS = 8000;

function withTimeout(promise, ms = CONTEXT_BUDGET_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]);
}

function detectExplainIntent({
  issueType = "",
  summary = "",
  labels = [],
  title = "",
  snippet = "",
} = {}) {
  const blob = [
    issueType,
    summary,
    ...(Array.isArray(labels) ? labels : []),
    title,
    snippet,
  ]
    .map((p) => String(p || ""))
    .join(" ")
    .toLowerCase();
  if (
    /\bapply\b|application|myworkday|job\/|questionnaire|citizenship|employment history|save and continue/.test(
      blob,
    )
  ) {
    return "form_apply";
  }
  if (
    /\bvuln|\bcve\b|injection|xss|sqli|\bsec[- ]\d|\bowasp|\bpatch\b|security (bug|issue|finding|vuln)/.test(
      blob,
    )
  ) {
    return "vuln";
  }
  if (
    /change\s*request|\bcr[- ]|\bcr\d|deploy|release|staging|production|rollback|change\s*record/.test(
      blob,
    )
  ) {
    return "deploy_cr";
  }
  return "other";
}

function snippetMeta(snippet) {
  const text = String(snippet || "");
  const url = (text.match(/^URL:\s*(.+)$/im) || [])[1] || "";
  const title = (text.match(/^Title:\s*(.+)$/im) || [])[1] || "";
  return { url: String(url).trim(), title: String(title).trim() };
}

function formatTicketHistoryPreamble({ issueKey, ticket, intent, linkedKeys }) {
  const lines = ["Past work context (cite only what is listed; do not invent tickets or steps):"];
  const key = String(ticket?.key || issueKey || "").trim();
  const summary = String(ticket?.summary || "").trim();
  if (key) {
    const bits = [
      key,
      summary || null,
      ticket?.status ? `status ${ticket.status}` : null,
      ticket?.issueType ? `type ${ticket.issueType}` : null,
      intent && intent !== "other" ? `intent ${intent}` : null,
    ].filter(Boolean);
    lines.push(`You're on: ${bits.join(" — ")}`);
  }
  const linked = (Array.isArray(linkedKeys) ? linkedKeys : []).filter(Boolean);
  if (linked.length) {
    lines.push(`Related tickets: ${linked.slice(0, 8).join(", ")}`);
  }
  return lines.join("\n");
}

function formatFormHistoryPreamble({ title, url, intent, captures }) {
  const lines = ["Past work context (cite only what is listed; do not invent tickets or steps):"];
  const where = String(title || "").trim() || String(url || "").trim() || "this form";
  lines.push(`You're on: ${where}${intent && intent !== "other" ? ` — intent ${intent}` : ""}`);
  const refs = (Array.isArray(captures) ? captures : [])
    .map((c) => {
      const ref = String(c?.formReference || c?.ticket || "").trim();
      if (!ref) return "";
      const conf =
        c?.confidence != null ? Number(c.confidence) : matchConfidencePercent(c?.score);
      return `${ref} (${conf}%)`;
    })
    .filter(Boolean);
  const unique = [...new Set(refs)].slice(0, 6);
  if (unique.length) lines.push(`Past reference numbers: ${unique.join(", ")}`);
  return lines.join("\n");
}

function buildMatchSummaries(captures = []) {
  return (Array.isArray(captures) ? captures : [])
    .map((c) => {
      const ref = String(c?.formReference || c?.ticket || "").trim();
      if (!ref) return null;
      const confidence =
        c?.confidence != null ? Number(c.confidence) : matchConfidencePercent(c?.score);
      return {
        ref,
        score: Number(c?.score) || 0,
        confidence,
        confidenceLabel: c?.confidenceLabel || confidenceLabel(confidence),
        pageUrl: String(c?.pageUrl || "").trim(),
      };
    })
    .filter(Boolean);
}

/** Overall Explain confidence from identity + best past match. */
function overallExplainConfidence({
  issueKey = "",
  ticket = null,
  captures = [],
  hasSnippet = false,
  hasScreenshot = true,
} = {}) {
  let base = hasScreenshot ? 55 : hasSnippet ? 48 : 35;
  if (issueKey) base += ticket?.summary ? 20 : 12;
  const matches = buildMatchSummaries(captures);
  const best = matches.reduce((m, x) => Math.max(m, x.confidence || 0), 0);
  if (best >= 90) base = Math.max(base, 88);
  else if (best >= 75) base = Math.max(base, 78);
  else if (best >= 55) base = Math.max(base, 68);
  else if (best > 0) base = Math.max(base, 58);
  if (!issueKey && !matches.length) base = Math.min(base, 62);
  return Math.max(20, Math.min(98, Math.round(base)));
}

function mergePastWorkRows(base, extra) {
  const byKey = new Map();
  for (const row of [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])]) {
    const key = String(row?.jira_key || "")
      .trim()
      .toUpperCase();
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const nextScore = Number(row.matchScore) || 0;
    const prevScore = Number(prev.matchScore) || 0;
    byKey.set(key, nextScore >= prevScore ? { ...prev, ...row } : { ...row, ...prev });
  }
  return [...byKey.values()];
}

function relatedCandidatesFromRows(rows, extraKeys = []) {
  const out = [];
  const seen = new Set();
  const add = (key, summary, source) => {
    const k = String(key || "").trim();
    if (!k) return;
    const norm = k.toUpperCase().replace(/[\s.#]+/g, "");
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    out.push({ key: k, summary: String(summary || "").trim(), source: source || "" });
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    add(row.jira_key, row.summary, "story");
    const rels = Array.isArray(row.relatedTickets)
      ? row.relatedTickets
      : String(row.related_tickets || "").split(/[,;]+/);
    for (const rel of rels) add(rel?.key || rel, rel?.summary || "", "related");
  }
  for (const key of extraKeys) add(key, "", "link");
  return out;
}

async function enhancePastWorkWithAi({
  issueKey = "",
  ticket = null,
  snippet = "",
  title = "",
  storedMatches = [],
  linkedKeys = [],
  jiraConfig = null,
} = {}) {
  let matches = Array.isArray(storedMatches) ? [...storedMatches] : [];
  const { getOpenAiConfig } = require("./settings");
  if (!getOpenAiConfig().hasKey) return matches;
  const { proposePastWorkSearch, rankPastWorkRelated } = require("./openai-chat");
  const search = await withTimeout(
    proposePastWorkSearch({
      issueKey,
      summary: ticket?.summary || title,
      description: ticket?.description || "",
      snippet,
    }),
    AI_PAST_WORK_MS
  );
  const textQuery = String(search?.textQuery || "").trim();
  const config = jiraConfig || getJiraConfig();
  if (textQuery && isConfigured(config)) {
    try {
      const result = await withTimeout(
        searchIssues(config, {
          maxResults: 25,
          queueCards: [],
          openSprint: false,
          scrapeTickets: false,
          pastWork: true,
          forceRefresh: false,
          excludeKeys: issueKey ? [issueKey] : [],
          textQuery,
        }),
        AI_PAST_WORK_MS
      );
      if (result?.ok) {
        const extra = (result.issues || [])
          .map((issue) => {
            const row = issueToRow(issue);
            if (!row) return null;
            return { ...row, matchScore: 80, relatedTickets: row.related_tickets ? String(row.related_tickets).split(/[,;]+/).map((p) => p.trim()).filter(Boolean) : [] };
          })
          .filter(Boolean);
        matches = mergePastWorkRows(matches, extra);
      }
    } catch {
      /* keep catalog matches */
    }
  }
  const candidates = relatedCandidatesFromRows(matches, linkedKeys);
  const ranked = await withTimeout(
    rankPastWorkRelated({
      issueKey,
      summary: ticket?.summary || title,
      description: ticket?.description || "",
      snippet,
      candidates,
    }),
    AI_PAST_WORK_MS
  );
  if (ranked?.usedAi && ranked.related?.length) {
    matches = applyRankToPastWorkRows(matches, ranked, { issueKey });
  }
  return matches;
}

/**
 * Build a compact history block for explainPage.
 * @returns {{ ok: boolean, issueKey: string, intent: string, ticket: object|null, captures: array, historyBlock: string }}
 */
async function resolveExplainPastWork({
  snippet = "",
  pageTitle = "",
  pageUrl = "",
  issueKey: forcedKey = "",
  jiraConfig = null,
} = {}) {
  const meta = snippetMeta(snippet);
  const title = String(pageTitle || meta.title || "").trim();
  const url = String(pageUrl || meta.url || "").trim();
  const issueKey =
    String(forcedKey || "").trim() ||
    extractJiraKey(snippet, title, url) ||
    "";

  const empty = {
    ok: true,
    issueKey: "",
    intent: "other",
    ticket: null,
    captures: [],
    matches: [],
    confidence: 55,
    confidenceLabel: "low",
    historyBlock: "",
  };

  let storedMatches = [];
  try {
    storedMatches =
      (await withTimeout(
        lookupPastWork({ issueKey, snippet, pageTitle: title, pageUrl: url }, { limit: 5 }),
      )) || [];
  } catch {
    storedMatches = [];
  }
  const storedHit =
    storedMatches.find(
      (row) => String(row.jira_key || "").toUpperCase() === String(issueKey || "").toUpperCase(),
    ) ||
    (!issueKey ? storedMatches[0] : null) ||
    null;

  let ticket = null;
  let linkedKeys = [];
  let labels = [];

  if (storedHit) {
    ticket = {
      key: storedHit.jira_key,
      summary: storedHit.summary || "",
      status: storedHit.status || "",
      issueType: storedHit.issue_type || "",
      description: storedHit.description || "",
    };
    linkedKeys = [
      ...new Set(
        [
          ...(Array.isArray(storedHit.relatedTickets) ? storedHit.relatedTickets : []),
          ...String(storedHit.related_tickets || "")
            .split(/[,;]+/)
            .map((part) => part.trim())
            .filter(Boolean),
        ].map((key) => String(key || "").trim()).filter(Boolean)
      ),
    ];
  }

  if (issueKey && !ticket) {
    try {
      const config = jiraConfig || getJiraConfig();
      if (isConfigured(config)) {
        ticket = await withTimeout(fetchIssueByKey(config, issueKey));
      }
    } catch {
      ticket = null;
    }
    linkedKeys = Array.isArray(ticket?.linkedKeys)
      ? ticket.linkedKeys
      : Array.isArray(ticket?.linkedIssues)
        ? ticket.linkedIssues.map((l) => l.key).filter(Boolean)
        : [];
    labels = Array.isArray(ticket?.labels) ? ticket.labels : [];
  }

  try {
    storedMatches = await enhancePastWorkWithAi({
      issueKey,
      ticket,
      snippet,
      title,
      storedMatches,
      linkedKeys,
      jiraConfig,
    });
  } catch {
    /* keep rule-based matches */
  }
  const rankedHit =
    storedMatches.find(
      (row) => String(row.jira_key || "").toUpperCase() === String(issueKey || "").toUpperCase(),
    ) ||
    storedMatches[0] ||
    storedHit;
  if (rankedHit) {
    if (!ticket) {
      ticket = {
        key: rankedHit.jira_key,
        summary: rankedHit.summary || "",
        status: rankedHit.status || "",
        issueType: rankedHit.issue_type || "",
        description: rankedHit.description || "",
      };
    }
    linkedKeys = [
      ...new Set(
        [
          ...linkedKeys,
          ...(Array.isArray(rankedHit.relatedTickets) ? rankedHit.relatedTickets : []),
          ...String(rankedHit.related_tickets || "")
            .split(/[,;]+/)
            .map((part) => part.trim())
            .filter(Boolean),
        ]
          .map((key) => String(key || "").trim())
          .filter(Boolean)
      ),
    ];
  }

  const intent = detectExplainIntent({
    issueType: ticket?.issueType || "",
    summary: ticket?.summary || "",
    labels,
    title,
    snippet: [snippet, url].filter(Boolean).join("\n"),
  });

  let captures = [];
  try {
    captures =
      (await withTimeout(
        findSimilarCaptures({
          issueKey,
          similarKeys: linkedKeys,
          labels,
          pageUrl: url,
          pageTitle: title,
          queueCard: title,
          limit: 3,
        }),
      )) || [];
  } catch {
    captures = [];
  }

  if (!issueKey && !captures.length && !storedMatches.length) {
    const confidence = overallExplainConfidence({
      hasSnippet: Boolean(String(snippet || "").trim() || url || title),
    });
    return {
      ...empty,
      intent,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
    };
  }

  const matches = buildMatchSummaries(captures);
  const parts = [];
  const storedBlock = formatStoredPastWorkBlock(storedMatches);
  if (issueKey || rankedHit || storedHit) {
    parts.push(
      formatTicketHistoryPreamble({
        issueKey: issueKey || rankedHit?.jira_key || storedHit?.jira_key || "",
        ticket,
        intent,
        linkedKeys,
      })
    );
  } else {
    parts.push(formatFormHistoryPreamble({ title, url, intent, captures }));
  }
  if (storedBlock) parts.push(storedBlock);
  parts.push(formatCaptureHistoryBlock(captures));
  const confidence = overallExplainConfidence({
    issueKey: issueKey || rankedHit?.jira_key || storedHit?.jira_key || "",
    ticket,
    captures,
    hasSnippet: Boolean(String(snippet || "").trim() || url || title),
  });
  const confLine = `Overall match confidence: ${confidence}% (${confidenceLabel(confidence)}). When citing a past reference, include its confidence % from the list.`;
  parts.unshift(confLine);

  const historyBlock = parts.filter((p) => String(p || "").trim()).join("\n");
  const resolvedKey = issueKey || rankedHit?.jira_key || storedHit?.jira_key || "";
  return {
    ok: true,
    issueKey: resolvedKey,
    intent,
    ticket: ticket
      ? {
          key: ticket.key || resolvedKey,
          summary: ticket.summary || "",
          status: ticket.status || "",
          issueType: ticket.issueType || "",
          labels,
          linkedKeys,
        }
      : resolvedKey
        ? { key: resolvedKey, summary: "", status: "", issueType: "", labels: [], linkedKeys: [] }
        : null,
    captures,
    matches,
    storedMatches,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    historyBlock,
  };
}

module.exports = {
  detectExplainIntent,
  snippetMeta,
  formatTicketHistoryPreamble,
  formatFormHistoryPreamble,
  buildMatchSummaries,
  overallExplainConfidence,
  resolveExplainPastWork,
  withTimeout,
  CONTEXT_BUDGET_MS,
};
