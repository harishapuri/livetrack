/**
 * Build dashboard/data.json from Excel execution rows.
 * Supervisor view: LOB / user / queue-card aggregates; mandatory mistakes only.
 * Default load window: last 7 days (override with dateFrom/dateTo).
 */
const fs = require("fs");
const path = require("path");
const { defaultProjectRoot } = require("./documents");
const { loadAllExecutions, defaultDateRangeDays } = require("./generate-sql");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function defaultDashboardDir() {
  return path.join(defaultProjectRoot(), "packages", "dashboard");
}

function defaultSopsDir() {
  return path.join(defaultProjectRoot(), "packages", "shared", "sops");
}

/**
 * Map queue-card id / sop id → Set of mandatory field keys (step.id + valueFrom).
 */
function loadMandatoryFieldIndex() {
  const dir = defaultSopsDir();
  const index = new Map();
  if (!fs.existsSync(dir)) return index;

  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    let sop;
    try {
      sop = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    const keys = new Set();
    for (const step of sop.steps || []) {
      if (!step?.mandatory) continue;
      if (step.id) keys.add(String(step.id));
      if (step.valueFrom) keys.add(String(step.valueFrom));
    }
    if (!keys.size) continue;

    const sopId = String(sop.id || name.replace(/\.json$/, ""));
    index.set(sopId, keys);
    if (sopId.startsWith("demo-")) {
      index.set(sopId.slice("demo-".length), keys);
    }
  }
  return index;
}

function mandatoryKeysForCard(index, queueCardId) {
  if (!queueCardId) return null;
  const id = String(queueCardId);
  if (index.has(id)) return index.get(id);
  if (index.has(`demo-${id}`)) return index.get(`demo-${id}`);
  for (const [k, v] of index) {
    if (k.endsWith(id) || id.endsWith(k.replace(/^demo-/, ""))) return v;
  }
  return null;
}

function filterMandatoryMistakes(mistakes, mandatoryKeys) {
  const list = Array.isArray(mistakes) ? mistakes : [];
  if (!mandatoryKeys || !mandatoryKeys.size) return list;
  return list.filter((m) => {
    const key = String(m.field_key || "");
    const step = String(m.step_id || "");
    return mandatoryKeys.has(key) || mandatoryKeys.has(step);
  });
}

function bump(map, key, fillMode, mistakeCount = 0) {
  if (!key) key = "(unknown)";
  if (!map[key]) {
    map[key] = {
      name: key,
      count: 0,
      automated: 0,
      manual: 0,
      mixed: 0,
      mistakes: 0,
    };
  }
  map[key].count += 1;
  const mode = fillMode === "manual" || fillMode === "mixed" ? fillMode : "automated";
  map[key][mode] += 1;
  map[key].mistakes += Number(mistakeCount) || 0;
}

function toSortedList(map) {
  return Object.values(map).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function formatMistakeDetails(mistakes) {
  return mistakes
    .map((m) => {
      const key = m.field_key || m.step_id || "field";
      const label = m.label && m.label !== key ? `${m.label} (${key})` : key;
      return `${label}: typed “${m.actual || ""}” → expected “${m.expected || ""}”`;
    })
    .join(" · ");
}

/**
 * @param {{
 *   quiet?: boolean,
 *   runs?: object[],
 *   fileCount?: number,
 *   dateFrom?: string|null,
 *   dateTo?: string|null,
 *   dateFilter?: string|null,
 *   defaultLastDays?: number,
 *   executionsRoot?: string,
 * }} [opts]
 */
async function generateDashboardData(opts = {}) {
  const quiet = Boolean(opts.quiet);
  const dashDir = defaultDashboardDir();
  ensureDir(dashDir);

  let runs = opts.runs;
  let fileCount = opts.fileCount;
  let dateFrom = opts.dateFrom || null;
  let dateTo = opts.dateTo || null;
  const dateFilter = opts.dateFilter || null;

  if (!runs) {
    const range =
      dateFrom || dateTo || dateFilter
        ? null
        : defaultDateRangeDays(opts.defaultLastDays != null ? opts.defaultLastDays : 7);
    const loaded = await loadAllExecutions({
      dateFilter,
      dateFrom: dateFrom || range?.dateFrom || null,
      dateTo: dateTo || range?.dateTo || null,
      defaultLastDays: undefined,
      includeAnswers: false,
      executionsRoot: opts.executionsRoot,
    });
    runs = loaded.runs;
    fileCount = loaded.files.length;
    dateFrom = loaded.dateFrom || dateFrom;
    dateTo = loaded.dateTo || dateTo;
  }

  const mandatoryIndex = loadMandatoryFieldIndex();
  const byLob = {};
  const byUser = {};
  const byQueueCard = {};
  const wrongFillRows = [];

  for (const run of runs) {
    const cardKey = run.queue_card_id || run.queue_card || "(unknown)";
    const mandatoryKeys = mandatoryKeysForCard(mandatoryIndex, run.queue_card_id);
    const mistakes = filterMandatoryMistakes(run.mistakes || [], mandatoryKeys);
    const mc = mistakes.length;

    bump(byLob, run.lob || "TCOO", run.fill_mode, mc);
    bump(byUser, run.user_id || "(unknown)", run.fill_mode, mc);

    if (!byQueueCard[cardKey]) {
      byQueueCard[cardKey] = {
        name: cardKey,
        title: run.queue_card || cardKey,
        lob: run.lob || "TCOO",
        count: 0,
        automated: 0,
        manual: 0,
        mixed: 0,
        mistakes: 0,
      };
    }
    byQueueCard[cardKey].count += 1;
    const mode =
      run.fill_mode === "manual" || run.fill_mode === "mixed"
        ? run.fill_mode
        : "automated";
    byQueueCard[cardKey][mode] += 1;
    byQueueCard[cardKey].mistakes += mc;

    if (mc > 0) {
      wrongFillRows.push({
        run_id: run.run_id,
        at: run.completed_at || run.run_date || mistakes[0]?.at || "",
        lob: run.lob || "TCOO",
        queue_card_id: run.queue_card_id || cardKey,
        queue_card: run.queue_card || cardKey,
        user_id: run.user_id || "",
        fill_mode: run.fill_mode || "automated",
        mistake_count: mc,
        details: formatMistakeDetails(mistakes),
        mistakes: mistakes.map((m) => ({
          field_key: m.field_key || m.step_id || "",
          label: m.label || "",
          expected: m.expected || "",
          actual: m.actual || "",
        })),
      });
    }
  }

  wrongFillRows.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const totalMistakes = wrongFillRows.reduce((n, r) => n + (r.mistake_count || 0), 0);
  const executionsWithMistakes = wrongFillRows.length;

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "excel",
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    dateFilter: dateFilter || null,
    totalExecutions: runs.length,
    executionCount: runs.length,
    totalMistakes,
    executionsWithMistakes,
    queueCardFiles: fileCount != null ? fileCount : Object.keys(byQueueCard).length,
    fileCount: fileCount != null ? fileCount : Object.keys(byQueueCard).length,
    byFillMode: {
      automated: runs.filter((r) => r.fill_mode === "automated" || !r.fill_mode).length,
      manual: runs.filter((r) => r.fill_mode === "manual").length,
      mixed: runs.filter((r) => r.fill_mode === "mixed").length,
    },
    byLob: toSortedList(byLob),
    byUser: toSortedList(byUser),
    byQueueCard: Object.values(byQueueCard).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    ),
    // Full lists for supervisor client-side filter/pagination
    recent: [...runs]
      .reverse()
      .map((r) => {
        const keys = mandatoryKeysForCard(mandatoryIndex, r.queue_card_id);
        const mc = filterMandatoryMistakes(r.mistakes || [], keys).length;
        return {
          run_id: r.run_id,
          lob: r.lob,
          queue_card_id: r.queue_card_id,
          queue_card: r.queue_card,
          user_id: r.user_id,
          fill_mode: r.fill_mode,
          run_date: r.run_date,
          completed_at: r.completed_at,
          mistake_count: mc,
        };
      }),
    recentMistakes: wrongFillRows,
  };

  const outPath = path.join(dashDir, "data.json");
  const jsPath = path.join(dashDir, "data.js");
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(outPath, `${json}\n`, "utf8");
  fs.writeFileSync(
    jsPath,
    `window.DASHBOARD_DATA = ${JSON.stringify(payload)};\n`,
    "utf8"
  );

  if (!quiet) {
    console.log(
      `[dashboard] ${payload.totalExecutions} executions (${dateFrom || "…"} → ${
        dateTo || "…"
      }), ${executionsWithMistakes} with mistakes → ${outPath}`
    );
  }

  return { ok: true, outPath, jsPath, ...payload };
}

const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

function extractJiraKey(...parts) {
  for (const p of parts) {
    const m = String(p || "").match(JIRA_KEY_RE);
    if (m) return m[1];
  }
  return "";
}

/**
 * Pull a submission / confirmation reference from a form page URL
 * (query params or trailing path segment). Returns "" if none found.
 */
function extractFormReferenceFromUrl(rawUrl) {
  const href = String(rawUrl || "").trim();
  if (!href || !/^https?:\/\//i.test(href)) return "";
  let u;
  try {
    u = new URL(href);
  } catch {
    return "";
  }

  const paramNames = [
    "ref",
    "reference",
    "referenceNumber",
    "reference_number",
    "confirmation",
    "confirmationNumber",
    "confirmation_number",
    "confirm",
    "receipt",
    "receiptId",
    "receipt_id",
    "submissionId",
    "submission_id",
    "submission",
    "entry",
    "requestId",
    "request_id",
    "tracking",
    "trackingId",
    "tracking_id",
    "txn",
    "transactionId",
    "id",
  ];
  for (const name of paramNames) {
    const val = u.searchParams.get(name);
    if (val && String(val).trim()) {
      const cleaned = String(val).trim();
      // Ignore bare booleans / tiny noise
      if (/^(true|false|0|1)$/i.test(cleaned)) continue;
      if (cleaned.length >= 4) return cleaned.slice(0, 64);
    }
  }

  const parts = u.pathname.split("/").filter(Boolean);
  const skip = new Set([
    "sites",
    "forms",
    "form",
    "pages",
    "page",
    "app",
    "index",
    "html",
    "confirm",
    "confirmation",
    "thank-you",
    "thanks",
    "success",
    "done",
    "complete",
    "submitted",
  ]);
  for (let i = parts.length - 1; i >= 0; i--) {
    let seg = decodeURIComponent(parts[i] || "").replace(/\.html?$/i, "");
    if (!seg || skip.has(seg.toLowerCase())) continue;
    // Reference-like path tokens must include a digit (or an explicit REF-/RD- prefix)
    if (/^(REF|RD|CONF|TXN|SUB|RECEIPT)[-_]/i.test(seg) && seg.length >= 6) return seg;
    if (/\d/.test(seg) && /[A-Za-z]/.test(seg) && seg.length >= 6 && seg.length <= 64) return seg;
    if (/^\d{6,}$/.test(seg)) return seg;
  }
  return "";
}

/**
 * Stable unique fallback when the form URL has no reference.
 * Format: REF-###### (not a Jira story key).
 */
function generateFormReferenceKey(seed) {
  const s = String(seed || "").trim() || `ref-${Date.now()}`;
  let hash = 2166136261;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const num = (Math.abs(hash) % 900000) + 100000;
  return `REF-${num}`;
}

/**
 * Stable fallback ticket ref when no real Jira key is on the card/run.
 * Seed should be run_id (unique per execution) so Dash and Jira Post agree.
 * @deprecated prefer generateFormReferenceKey for form refs; kept for LACT helpers
 */
function generateFallbackJiraKey(seed) {
  const s = String(seed || "").trim() || "liveact";
  let hash = 2166136261;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const num = (Math.abs(hash) % 900000) + 100000;
  return `LACT-${num}`;
}

function isGeneratedJiraKey(key) {
  return /^(LACT|REF)-\d+$/i.test(String(key || "").trim());
}

/**
 * Prefer a real Jira key from candidates; otherwise hash fallbackSeed (run_id).
 */
function resolveJiraKey(candidates = [], fallbackSeed = "") {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const found = extractJiraKey(...list);
  if (found) {
    return { jiraKey: found, jiraKeyGenerated: isGeneratedJiraKey(found) };
  }
  const seed = String(fallbackSeed || list.find((p) => String(p || "").trim()) || "liveact");
  return { jiraKey: generateFallbackJiraKey(seed), jiraKeyGenerated: true };
}

function resolveFormReference({ pageUrl = "", answers = {}, runId = "" } = {}) {
  const fromAnswers = String(
    answers.formReference || answers.formRef || answers.referenceNumber || ""
  ).trim();
  if (fromAnswers && !isGeneratedJiraKey(fromAnswers)) return { formReference: fromAnswers, generated: false };
  if (fromAnswers) return { formReference: fromAnswers, generated: true };

  const fromUrl = extractFormReferenceFromUrl(pageUrl);
  if (fromUrl) return { formReference: fromUrl, generated: false };

  return {
    formReference: generateFormReferenceKey(runId || pageUrl || Date.now()),
    generated: true,
  };
}

function loadMandatoryStepIndex() {
  const dir = defaultSopsDir();
  const index = new Map();
  if (!fs.existsSync(dir)) return index;

  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    let sop;
    try {
      sop = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    const keys = new Set();
    const labels = new Map();
    for (const step of sop.steps || []) {
      if (!step?.mandatory) continue;
      const key = String(step.valueFrom || step.id || "");
      if (!key) continue;
      keys.add(key);
      if (step.id) keys.add(String(step.id));
      labels.set(key, String(step.label || key));
      if (step.id) labels.set(String(step.id), String(step.label || step.id));
    }
    if (!keys.size) continue;
    const sopId = String(sop.id || name.replace(/\.json$/, ""));
    const entry = { keys, labels };
    index.set(sopId, entry);
    if (sopId.startsWith("demo-")) index.set(sopId.slice("demo-".length), entry);
  }
  return index;
}

function mandatoryMetaForCard(stepIndex, queueCardId) {
  if (!queueCardId) return null;
  const id = String(queueCardId);
  if (stepIndex.has(id)) return stepIndex.get(id);
  if (stepIndex.has(`demo-${id}`)) return stepIndex.get(`demo-${id}`);
  for (const [k, v] of stepIndex) {
    if (k.endsWith(id) || id.endsWith(k.replace(/^demo-/, ""))) return v;
  }
  return null;
}

async function buildAgentDashboard({
  queueCards = [],
  days = 14,
  jiraBaseUrl = "",
  jiraCardKeyField = "jiraKey",
  executionsRoot,
} = {}) {
  const range = defaultDateRangeDays(days);
  const { runs } = await loadAllExecutions({
    includeAnswers: true,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    executionsRoot,
  });
  const stepIndex = loadMandatoryStepIndex();
  const field = String(jiraCardKeyField || "jiraKey").trim() || "jiraKey";
  const cardById = new Map();
  for (const c of queueCards || []) {
    if (c?.id) cardById.set(String(c.id), c);
  }
  const base = String(jiraBaseUrl || "").replace(/\/+$/, "");

  const rows = [...runs]
    .sort((a, b) =>
      String(b.completed_at || b.run_date).localeCompare(String(a.completed_at || a.run_date))
    )
    .slice(0, 80)
    .map((run) => {
      const card = cardById.get(String(run.queue_card_id || ""));
      const meta = mandatoryMetaForCard(stepIndex, run.queue_card_id);
      const answers = run.answers || {};
      // Form submission reference (from URL) — unique per execution when captured/generated
      const resolvedRef = resolveFormReference({
        pageUrl: answers.pageUrl || answers.formPageUrl || "",
        answers,
        runId: run.run_id,
      });
      const formReference = resolvedRef.formReference;
      // Linked Jira story (e.g. LIVEACT-101) — separate from form reference
      const jiraStoryKey =
        extractJiraKey(
          answers.jiraStoryKey,
          !isGeneratedJiraKey(answers.jiraKey) ? answers.jiraKey : "",
          card?.data?.[field],
          card?.title,
          card?.id
        ) || "";

      const mandatory = [];
      if (meta?.keys?.size) {
        const seen = new Set();
        for (const key of meta.keys) {
          const label = meta.labels.get(key) || key;
          if (seen.has(label)) continue;
          seen.add(label);
          const val = answers[key];
          const filled = val != null && String(val).trim() !== "";
          mandatory.push({
            key,
            label,
            value: filled ? String(val) : "",
            filled,
          });
        }
      }

      const mistakes = filterMandatoryMistakes(run.mistakes || [], meta?.keys || null);

      return {
        run_id: run.run_id,
        lob: run.lob || "TCOO",
        queue_card_id: run.queue_card_id || "",
        queue_card: run.queue_card || run.queue_card_id || "",
        user_id: run.user_id || "",
        fill_mode: run.fill_mode || "automated",
        run_date: run.run_date || "",
        completed_at: run.completed_at || "",
        /** Form submission / URL reference (dashboard ticket number) */
        formReference,
        formReferenceGenerated: resolvedRef.generated,
        /** @deprecated alias for dash UI — form reference, not Jira story */
        jiraKey: formReference,
        jiraKeyGenerated: resolvedRef.generated,
        jiraStoryKey,
        jiraUrl: jiraStoryKey && base ? `${base}/browse/${jiraStoryKey}` : null,
        mistake_count: mistakes.length,
        mandatory,
        mandatoryFilled: mandatory.filter((m) => m.filled).length,
        mandatoryTotal: mandatory.length,
      };
    });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    total: rows.length,
    rows,
  };
}

function mandatorySummaryForCard(queueCardId, answers = {}, queueCards = []) {
  const stepIndex = loadMandatoryStepIndex();
  const meta = mandatoryMetaForCard(stepIndex, queueCardId);
  if (!meta?.keys?.size) {
    return { text: "No mandatory SOP fields indexed for this card.", items: [] };
  }
  const card = (queueCards || []).find((c) => c.id === queueCardId);
  const merged = { ...(card?.data || {}), ...(answers || {}) };
  const items = [];
  const seen = new Set();
  for (const key of meta.keys) {
    const label = meta.labels.get(key) || key;
    if (seen.has(label)) continue;
    seen.add(label);
    const val = merged[key];
    const filled = val != null && String(val).trim() !== "";
    items.push({ label, key, value: filled ? String(val) : "", filled });
  }
  const filled = items.filter((i) => i.filled);
  const missing = items.filter((i) => !i.filled);
  const lines = [
    `Mandatory fields: ${filled.length}/${items.length} filled.`,
    filled.length ? `Filled: ${filled.map((i) => `${i.label}=${i.value}`).join("; ")}` : null,
    missing.length
      ? `Missing: ${missing.map((i) => i.label).join(", ")}`
      : "All mandatory fields present.",
  ].filter(Boolean);
  return { text: lines.join(" "), items };
}

/**
 * Find the latest execution matching a queue card and/or ticket key (real or LACT-*).
 */
function findLatestExecutionForTicket(runs, { cardId = "", issueKey = "", queueCards = [] } = {}) {
  const key = String(issueKey || "").trim().toUpperCase();
  const wantCard = String(cardId || "").trim();
  const cardById = new Map();
  for (const c of queueCards || []) {
    if (c?.id) cardById.set(String(c.id), c);
  }

  let best = null;
  let bestScore = 0;
  const sorted = [...(runs || [])].sort((a, b) =>
    String(b.completed_at || b.run_date).localeCompare(String(a.completed_at || a.run_date))
  );

  for (const run of sorted) {
    const runCard = String(run.queue_card_id || "").trim();
    const card = cardById.get(runCard);
    const answers = run.answers || {};
    const resolved = resolveJiraKey(
      [
        answers.jiraKey,
        answers.JiraKey,
        card?.data?.jiraKey,
        run.queue_card,
        card?.title,
        card?.id,
      ],
      run.run_id
    );
    let score = 0;
    if (key && String(resolved.jiraKey || "").toUpperCase() === key) score += 5;
    if (key && generateFallbackJiraKey(run.run_id).toUpperCase() === key) score += 5;
    if (wantCard && runCard === wantCard) score += 3;
    if (!score) continue;
    if (score > bestScore) {
      bestScore = score;
      best = run;
      if (score >= 5) break;
    }
  }
  return best;
}

async function loadMandatorySummaryForTicket({
  cardId = "",
  issueKey = "",
  answers = {},
  queueCards = [],
  executionsRoot,
} = {}) {
  let resolvedCardId = String(cardId || "").trim();
  let mergedAnswers =
    answers && typeof answers === "object" ? { ...answers } : {};

  try {
    const range = defaultDateRangeDays(14);
    const { runs } = await loadAllExecutions({
      includeAnswers: true,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      executionsRoot,
    });
    const latest = findLatestExecutionForTicket(runs, {
      cardId: resolvedCardId,
      issueKey,
      queueCards,
    });
    if (latest) {
      resolvedCardId = resolvedCardId || String(latest.queue_card_id || "").trim();
      mergedAnswers = { ...(latest.answers || {}), ...mergedAnswers };
    }
  } catch (err) {
    console.warn("[jira] load execution for mandatory summary", err?.message || err);
  }

  const summary = mandatorySummaryForCard(resolvedCardId, mergedAnswers, queueCards);
  return { cardId: resolvedCardId, issueKey, ...summary };
}

module.exports = {
  generateDashboardData,
  defaultDashboardDir,
  buildAgentDashboard,
  mandatorySummaryForCard,
  loadMandatorySummaryForTicket,
  findLatestExecutionForTicket,
  extractJiraKey,
  extractFormReferenceFromUrl,
  generateFormReferenceKey,
  generateFallbackJiraKey,
  isGeneratedJiraKey,
  resolveJiraKey,
  resolveFormReference,
  loadMandatoryFieldIndex,
  mandatoryKeysForCard,
};
