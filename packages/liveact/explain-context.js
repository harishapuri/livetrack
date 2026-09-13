/**
 * Resolve ticket + past-recording context for Desk "Explain this window".
 * Soft-fails: empty historyBlock means Explain behaves as screenshot-only.
 *
 * Matches by Jira key when present; otherwise by page URL / title against
 * prior capture clickstreams (form refs, steps, values).
 */
const { extractJiraKey } = require("./dashboard-stats");
const { getJiraConfig, isConfigured, fetchIssueByKey } = require("./jira");
const {
  findSimilarCaptures,
  formatCaptureHistoryBlock,
  matchConfidencePercent,
  confidenceLabel,
} = require("./capture-forward");

const CONTEXT_BUDGET_MS = 2500;

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
    const label =
      intent === "vuln"
        ? "Similar / linked CRs"
        : intent === "deploy_cr"
          ? "Linked tickets"
          : "Linked issues";
    lines.push(`${label}: ${linked.slice(0, 6).join(", ")}`);
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

  let ticket = null;
  let linkedKeys = [];
  let labels = [];

  if (issueKey) {
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

  if (!issueKey && !captures.length) {
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
  if (issueKey) {
    parts.push(formatTicketHistoryPreamble({ issueKey, ticket, intent, linkedKeys }));
  } else {
    parts.push(formatFormHistoryPreamble({ title, url, intent, captures }));
  }
  parts.push(formatCaptureHistoryBlock(captures));
  const confidence = overallExplainConfidence({
    issueKey,
    ticket,
    captures,
    hasSnippet: Boolean(String(snippet || "").trim() || url || title),
  });
  const confLine = `Overall match confidence: ${confidence}% (${confidenceLabel(confidence)}). When citing a past reference, include its confidence % from the list.`;
  parts.unshift(confLine);

  const historyBlock = parts.filter((p) => String(p || "").trim()).join("\n");
  return {
    ok: true,
    issueKey,
    intent,
    ticket: ticket
      ? {
          key: ticket.key || issueKey,
          summary: ticket.summary || "",
          status: ticket.status || "",
          issueType: ticket.issueType || "",
          labels,
          linkedKeys,
        }
      : issueKey
        ? { key: issueKey, summary: "", status: "", issueType: "", labels: [], linkedKeys: [] }
        : null,
    captures,
    matches,
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
