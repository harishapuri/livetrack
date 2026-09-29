/**
 * Persist Past Work scrape as one Excel row per Jira story
 * (key, description, related ticket numbers) and match later questions
 * against that catalog instead of re-scraping Jira.
 */
const fs = require("fs");
const path = require("path");
const workbookStore = require("./workbook");
const {
  extractTicketRefs,
  relatedStoryTokens,
  storiesAreSimilar,
  bundledTicketLookupQuery,
  commentSourceForTickets,
  stripCommentTicketsBundle,
  ticketKindLabel,
  ticketLookupQuery,
  isOpsTicketKey,
  isJiraIssueKey,
} = require("./jira");

const QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "please",
  "the",
  "this",
  "to",
  "we",
  "what",
  "when",
  "where",
  "which",
  "why",
  "you",
]);

function cell(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[\s.#]+/g, "")
    .trim();
}

function relatedTicketList(issue) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(issue?.relatedTickets) ? issue.relatedTickets : []) {
    const key = String(item?.key || "").trim();
    const norm = normalizeKey(key);
    if (!key || !norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({
      key,
      summary: cell(item.summary),
      status: cell(item.status),
      url: cell(item.url),
      source: cell(item.source),
      kind: cell(item.kind),
      autoQuery: cell(item.autoQuery),
    });
  }
  return out;
}

function relatedTicketsCell(tickets) {
  return tickets.map((row) => row.key).join(", ");
}

const COMMENT_SOURCE_HEAD = "From comments:";
const TICKET_NUMBERS_HEAD = "Ticket numbers:";

function ticketNotesCell(tickets) {
  const lines = tickets.map((row) => {
    const kind = row.kind || ticketKindLabel(row.key);
    const autoQuery = row.autoQuery || ticketLookupQuery(row.key);
    return [row.key, kind || null, autoQuery || null].filter(Boolean).join(" — ");
  });
  const bundled = bundledTicketLookupQuery(tickets);
  if (bundled && !lines.some((line) => line.includes(bundled))) lines.push(bundled);
  return lines.join("; ");
}

function relatedNotesCell(tickets, commentSource = "") {
  const ticketPart = ticketNotesCell(tickets);
  const source = String(commentSource || "").replace(/\r\n/g, "\n").trim();
  if (!source) return ticketPart;
  return ticketPart
    ? `${COMMENT_SOURCE_HEAD}\n${source}\n${TICKET_NUMBERS_HEAD}\n${ticketPart}`
    : `${COMMENT_SOURCE_HEAD}\n${source}`;
}

function splitRelatedNotes(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!/^From comments:\n/i.test(text)) return { source: "", tickets: text };
  const body = text.replace(/^From comments:\n/i, "");
  const marker = `\n${TICKET_NUMBERS_HEAD}\n`;
  const idx = body.lastIndexOf(marker);
  if (idx >= 0) {
    return {
      source: body.slice(0, idx).trim(),
      tickets: body.slice(idx + marker.length).trim(),
    };
  }
  return { source: body.trim(), tickets: "" };
}

function parseRelatedNotes(notes) {
  const map = new Map();
  const kindRe =
    /^(request|incident|change|change request|catalog task|problem|change task|problem task|knowledge article|interaction|work order|call|task|jira issue|ticket)$/i;
  for (const part of String(notes || "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const bits = trimmed.split(" — ").map((item) => item.trim()).filter(Boolean);
    if (!bits.length) continue;
    const key = bits[0];
    const norm = normalizeKey(key);
    if (!norm) continue;
    const last = bits[bits.length - 1];
    const autoQuery = bits.length > 1 && /^(number=|key\s*=|numberIN)/i.test(last) ? last : "";
    const middle = bits.slice(1, autoQuery ? -1 : undefined);
    let kind = "";
    if (middle.length && kindRe.test(middle[0])) kind = middle[0];
    if (kind || autoQuery) map.set(norm, { kind, autoQuery });
  }
  return map;
}

function issueToRow(issue) {
  const jiraKey = cell(issue?.key);
  if (!jiraKey) return null;
  const tickets = relatedTicketList(issue);
  const commentSource =
    String(issue.commentSource || "").replace(/\r\n/g, "\n").trim() ||
    commentSourceForTickets(issue.commentText, tickets, {
      parentKey: issue.key,
      parentSummary: issue.summary,
      parentDescription: issue.description,
    });
  return {
    jira_key: jiraKey,
    summary: cell(issue.summary),
    description: cell(stripCommentTicketsBundle(issue.description)),
    related_tickets: relatedTicketsCell(tickets),
    related_notes: relatedNotesCell(tickets, commentSource),
    status: cell(issue.status),
    issue_type: cell(issue.issueType),
    url: cell(issue.url),
  };
}

function unionRelatedTicketCells(previous, incoming) {
  const seen = new Set();
  const keys = [];
  for (const key of [...parseRelatedKeys(previous), ...parseRelatedKeys(incoming)]) {
    const norm = normalizeKey(key);
    if (!key || !norm || seen.has(norm)) continue;
    seen.add(norm);
    keys.push(key);
  }
  return keys.join(", ");
}

function upsertPastWorkRows(existing, incoming) {
  const byKey = new Map();
  for (const row of Array.isArray(existing) ? existing : []) {
    const key = cell(row?.jira_key);
    if (!key) continue;
    byKey.set(normalizeKey(key) || key, { ...row, jira_key: key });
  }
  for (const row of Array.isArray(incoming) ? incoming : []) {
    const key = cell(row?.jira_key);
    if (!key) continue;
    const norm = normalizeKey(key) || key;
    const previous = byKey.get(norm);
    if (!previous) {
      byKey.set(norm, { ...row, jira_key: key });
      continue;
    }
    const incomingTickets = parseRelatedKeys(row.related_tickets);
    const related_tickets = incomingTickets.length
      ? unionRelatedTicketCells(previous.related_tickets, row.related_tickets)
      : previous.related_tickets || row.related_tickets || "";
    const related_notes = incomingTickets.length
      ? cell(row.related_notes) || previous.related_notes
      : previous.related_notes || row.related_notes || "";
    byKey.set(norm, {
      ...previous,
      ...row,
      jira_key: key,
      description: cell(row.description) || previous.description,
      related_tickets,
      related_notes,
    });
  }
  return [...byKey.values()].sort((a, b) =>
    String(a.jira_key).localeCompare(String(b.jira_key), undefined, { numeric: true })
  );
}

function parseRelatedKeys(cellValue) {
  return String(cellValue || "")
    .split(/[,;]+/)
    .map((part) => String(part || "").trim())
    .filter(Boolean);
}

function rowToIssue(row) {
  const jiraKey = cell(row?.jira_key);
  if (!jiraKey) return null;
  const split = splitRelatedNotes(row?.related_notes);
  const notes = parseRelatedNotes(split.tickets);
  const tickets = parseRelatedKeys(row?.related_tickets).map((key) => {
    const note = notes.get(normalizeKey(key)) || {};
    return {
      key,
      summary: "",
      kind: note.kind || ticketKindLabel(key),
      autoQuery: note.autoQuery || ticketLookupQuery(key),
      status: "",
      url: "",
      source: isJiraIssueKey(key) ? "similar" : "comment",
    };
  });
  const status = cell(row?.status);
  const done = /^(done|closed|resolved|complete|completed)$/i.test(status)
    || /\b(done|closed|resolved|complete)\b/i.test(status);
  const commentSource = String(split.source || "").trim();
  // PastWork.description only — never copy summary/comment snippets into this field.
  const description = cell(stripCommentTicketsBundle(row?.description));
  return {
    key: jiraKey,
    summary: cell(row?.summary),
    description,
    commentSource,
    commentText: commentSource,
    status,
    issueType: cell(row?.issue_type),
    url: cell(row?.url),
    relatedTickets: tickets,
    done,
    inOpenSprint: false,
  };
}

function queryKeys({ issueKey = "", snippet = "", pageTitle = "", pageUrl = "" } = {}) {
  const blob = [issueKey, snippet, pageTitle, pageUrl].filter(Boolean).join("\n");
  const keys = new Set();
  const forced = cell(issueKey);
  if (forced) keys.add(normalizeKey(forced) || forced.toUpperCase());
  for (const item of extractTicketRefs(blob)) {
    const key = normalizeKey(item.key);
    if (key) keys.add(key);
  }
  return keys;
}

function questionTokens(text) {
  return relatedStoryTokens(text).filter((tok) => !QUERY_STOPWORDS.has(tok));
}

function tokenOverlapScore(queryText, row) {
  const q = new Set(questionTokens(queryText));
  const r = new Set(
    questionTokens(
      [row.jira_key, row.summary, row.description, row.related_tickets, row.related_notes].join(" ")
    )
  );
  if (q.size < 2 || r.size < 2) return 0;
  let inter = 0;
  for (const tok of q) if (r.has(tok)) inter += 1;
  if (inter < 2) return 0;
  return inter / Math.max(q.size, 2);
}

function scorePastWorkRow(row, query = {}) {
  const key = normalizeKey(row?.jira_key);
  if (!key) return 0;
  const asked = queryKeys(query);
  const related = parseRelatedKeys(row.related_tickets).map((item) => normalizeKey(item));
  if (query.issueKey && key === (normalizeKey(query.issueKey) || String(query.issueKey).toUpperCase())) {
    return 100;
  }
  if (asked.has(key)) return 96;
  for (const rel of related) {
    if (rel && asked.has(rel)) return 92;
  }
  const similar = storiesAreSimilar(
    {
      key: "QUERY-1",
      summary: query.pageTitle || query.snippet || "",
      description: query.snippet || "",
    },
    {
      key: row.jira_key,
      summary: row.summary || "",
      description: row.description || "",
    }
  );
  if (similar) return 82;
  const overlap = tokenOverlapScore(
    [query.issueKey, query.pageTitle, query.snippet, query.pageUrl].join(" "),
    row
  );
  if (overlap >= 0.5) return Math.round(70 + overlap * 10);
  if (overlap > 0) return Math.round(58 + overlap * 20);
  return 0;
}

function findSimilarPastWorkRows(rows, query = {}, { limit = 5 } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, score: scorePastWorkRow(row, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.row.jira_key).localeCompare(String(b.row.jira_key)))
    .slice(0, Math.max(1, limit))
    .map((item) => ({
      ...item.row,
      matchScore: item.score,
      relatedTickets: parseRelatedKeys(item.row.related_tickets),
    }));
}

function flattenPastWorkDescription(description) {
  let text = stripCommentTicketsBundle(description);
  text = String(text || "")
    .replace(
      /\b(?:RITM|INC|CHG|CRQ|SCTASK|STASK|PRB|CTASK|PTASK|KB|REQ|RFC|INT|WO|CALL|TASK|CR)[\s.\-#]*\d+\b/gi,
      " "
    )
    .replace(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g, " ")
    .replace(/\(\s*[,;]*\s*\)/g, " ");
  return cell(text);
}

function relatedOpsTicketKeys(issue) {
  const parent = normalizeKey(issue?.key || issue?.jira_key);
  const seen = new Set();
  const keys = [];
  const push = (raw) => {
    const key = String(raw || "").trim();
    const norm = normalizeKey(key);
    if (!key || !norm || seen.has(norm) || (parent && norm === parent)) return;
    if (!isOpsTicketKey(key)) return;
    seen.add(norm);
    keys.push(key);
  };
  if (Array.isArray(issue?.relatedTickets)) {
    for (const row of issue.relatedTickets) push(row?.key);
  }
  for (const key of parseRelatedKeys(issue?.related_tickets)) push(key);
  return keys;
}

/** Jira description for the list line — never comments, never summary, no ticket ids in the body. */
function pastWorkListSource(issue) {
  return flattenPastWorkDescription(issue?.description);
}

/** One list line: KEY:Jira description(ops tickets). Comments feed parentheses only. */
function formatPastWorkListLine(issue) {
  const key = cell(issue?.key || issue?.jira_key);
  const description = pastWorkListSource(issue);
  const tickets = relatedOpsTicketKeys(issue);
  const parens = tickets.length ? `(${tickets.join(", ")})` : "";
  return key ? `${key}:${description}${parens}` : `${description}${parens}`;
}

function formatStoredPastWorkBlock(matches = []) {
  const rows = Array.isArray(matches) ? matches : [];
  if (!rows.length) return "";
  const lines = ["Saved past work (cite only these keys and related tickets):"];
  for (const row of rows.slice(0, 5)) {
    const head = [row.jira_key, row.summary || null].filter(Boolean).join(" — ");
    lines.push(head);
    const tickets = parseRelatedKeys(row.related_tickets);
    if (tickets.length) lines.push(`Related tickets: ${tickets.join(", ")}`);
    const split = splitRelatedNotes(row.related_notes);
    if (split.source) lines.push(`From comments: ${split.source.replace(/\s+/g, " ").slice(0, 280)}`);
    const notes = cell(split.tickets);
    if (notes && notes !== relatedTicketsCell(tickets.map((key) => ({ key })))) {
      lines.push(notes);
    }
    const desc = cell(row.description);
    if (desc && desc !== cell(row.summary)) {
      lines.push(desc.length > 280 ? `${desc.slice(0, 277)}…` : desc);
    }
  }
  return lines.join("\n");
}

function catalogRoots(explicitRoot) {
  if (explicitRoot) return [path.resolve(explicitRoot)];
  const { defaultProjectRoot } = require("./documents");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const shared = path.resolve(defaultProjectRoot());
  const roots = [];
  if (fs.existsSync(path.join(repoRoot, workbookStore.WORKBOOK_NAME))) roots.push(repoRoot);
  roots.push(shared);
  return [...new Set(roots)];
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function readPastWorkCsv(projectRoot) {
  const file = path.join(projectRoot, "PastWork.csv");
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  if (!raw.trim()) return [];
  const records = [];
  let cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === ",") {
      cells.push(cur);
      cur = "";
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && raw[i + 1] === "\n") i += 1;
      cells.push(cur);
      if (cells.some((part) => String(part || "").trim())) records.push(cells);
      cells = [];
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur || cells.length) {
    cells.push(cur);
    if (cells.some((part) => String(part || "").trim())) records.push(cells);
  }
  if (records.length < 2) return [];
  const cols = records[0].map((part) => String(part || "").trim());
  const rows = [];
  for (const record of records.slice(1)) {
    const obj = {};
    let empty = true;
    cols.forEach((col, i) => {
      const v = String(record[i] || "").trim();
      obj[col] = v;
      if (v) empty = false;
    });
    if (!empty && obj.jira_key) rows.push(obj);
  }
  return rows;
}

function writePastWorkCsv(projectRoot, rows) {
  const root = projectRoot || require("./documents").defaultProjectRoot();
  const cols = workbookStore.SHEETS.PastWork.columns;
  const lines = [cols.join(",")];
  for (const row of Array.isArray(rows) ? rows : []) {
    lines.push(cols.map((col) => csvCell(row?.[col])).join(","));
  }
  const body = `${lines.join("\n")}\n`;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "PastWork.csv"), body, "utf8");
  fs.writeFileSync(path.join(root, "PastWork.json"), JSON.stringify(rows || [], null, 2), "utf8");
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function readPastWorkJson(projectRoot) {
  const file = path.join(projectRoot, "PastWork.json");
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(raw) ? raw.filter((row) => row?.jira_key) : [];
  } catch {
    return [];
  }
}

async function writePastWorkSheet(projectRoot, incoming) {
  const existing = [...readPastWorkJson(projectRoot), ...readPastWorkCsv(projectRoot)];
  const byKey = new Map();
  for (const row of existing) {
    const key = cell(row?.jira_key);
    if (!key) continue;
    const norm = normalizeKey(key) || key;
    if (!byKey.has(norm)) byKey.set(norm, row);
  }
  const next = incoming.length ? upsertPastWorkRows([...byKey.values()], incoming) : [...byKey.values()];
  writePastWorkCsv(projectRoot, next);
  let xlsxOk = false;
  let xlsxError = "";
  try {
    await withTimeout(
      workbookStore.updateSheetRows("PastWork", next, projectRoot),
      8000,
      "PastWork workbook timed out"
    );
    xlsxOk = true;
  } catch (err) {
    xlsxError = err?.message || String(err);
    console.warn("[livetrack] PastWork xlsx", xlsxError);
  }
  return { path: workbookStore.workbookPath(projectRoot), xlsxOk, xlsxError, saved: next.length };
}

async function persistPastWorkIssues(issues, projectRoot) {
  const incoming = (Array.isArray(issues) ? issues : []).map(issueToRow).filter(Boolean);
  const roots = catalogRoots(projectRoot);
  const paths = [];
  let xlsxOk = true;
  let xlsxError = "";
  for (const root of roots) {
    const result = await writePastWorkSheet(root, incoming);
    paths.push(result.path);
    if (!result.xlsxOk) {
      xlsxOk = false;
      xlsxError = result.xlsxError || xlsxError;
    }
  }
  return { ok: true, saved: incoming.length, paths, xlsxOk, xlsxError };
}

async function ensurePastWorkCatalog(projectRoot) {
  for (const root of catalogRoots(projectRoot)) {
    if (!fs.existsSync(path.join(root, "PastWork.csv"))) writePastWorkCsv(root, []);
  }
  return { ok: true, saved: 0 };
}

async function loadPastWorkRows(projectRoot) {
  const roots = catalogRoots(projectRoot);
  const byKey = new Map();
  for (const root of roots) {
    for (const row of [...readPastWorkJson(root), ...readPastWorkCsv(root)]) {
      const key = cell(row?.jira_key);
      if (!key) continue;
      const norm = normalizeKey(key) || key;
      if (!byKey.has(norm)) byKey.set(norm, row);
    }
  }
  return [...byKey.values()];
}

async function lookupPastWork(query = {}, { limit = 5, projectRoot } = {}) {
  const rows = await loadPastWorkRows(projectRoot);
  return findSimilarPastWorkRows(rows, query, { limit });
}

module.exports = {
  issueToRow,
  rowToIssue,
  flattenPastWorkDescription,
  pastWorkListSource,
  formatPastWorkListLine,
  upsertPastWorkRows,
  parseRelatedKeys,
  relatedTicketsCell,
  relatedNotesCell,
  splitRelatedNotes,
  scorePastWorkRow,
  findSimilarPastWorkRows,
  formatStoredPastWorkBlock,
  persistPastWorkIssues,
  ensurePastWorkCatalog,
  loadPastWorkRows,
  lookupPastWork,
};
