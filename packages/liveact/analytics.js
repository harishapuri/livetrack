/**
 * Aggregate executions, queue cards, and AI token usage for the dashboard.
 */
const workbookStore = require("./workbook");
const { FEATURE_LABELS } = require("./ai-usage");

/** OpenAI answer/refine usage only — not Teams frames, STT chunks, or TTS. */
const ANSWER_FEATURES = new Set([
  "queue_ai",
  "stuck_coach",
  "failed_repair",
  "jira_comment",
  "jira_ticket",
  "jira_mail_shot",
  "explain_page",
  "mom_refine",
  "form_assistant",
  "general_chat",
]);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeLob(value) {
  const s = String(value || "").trim();
  return s || "TCOO";
}

function normalizeGrain(grain) {
  const g = String(grain || "").trim().toLowerCase();
  if (g === "year" || g === "day" || g === "month") return g;
  return "month";
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Current calendar day / month / year in local time. */
function periodForGrain(grain, now = new Date()) {
  const g = normalizeGrain(grain);
  const y = now.getFullYear();
  const m = now.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  if (g === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (g === "month") {
    const mm = String(m + 1).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  }
  const day = ymd(now);
  return { from: day, to: day };
}

/** Bucket size inside the selected period so charts still have more than one bar. */
function seriesGrainFor(grain) {
  const g = normalizeGrain(grain);
  if (g === "year") return "month";
  if (g === "month") return "week";
  return "day";
}

function dayKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return ymd(value);
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (Number.isFinite(t)) return ymd(new Date(t));
  return "";
}

/** Monday-start week key (YYYY-MM-DD of that Monday). */
function weekStartKey(day) {
  const key = dayKey(day);
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0=Sun … 6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + offset);
  return ymd(dt);
}

/** Readable week range from a Monday key, e.g. 9/8–9/14. */
function weekLabel(weekStart) {
  const key = dayKey(weekStart);
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const fmt = (dt) => `${dt.getMonth() + 1}/${dt.getDate()}`;
  return `${fmt(start)}–${fmt(end)}`;
}

function grainKey(isoOrDate, grain) {
  const day = dayKey(isoOrDate);
  if (!day) return "";
  if (grain === "year") return day.slice(0, 4);
  if (grain === "month") return day.slice(0, 7);
  if (grain === "week") return weekStartKey(day);
  return day;
}

function formatSeriesBucket(bucket, seriesGrain) {
  const b = String(bucket || "");
  if (seriesGrain === "week") return weekLabel(b) || b;
  return b;
}

function inRange(day, from, to) {
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function bumpNamed(map, name, extra) {
  const key = String(name || "(unknown)").trim() || "(unknown)";
  if (!map[key]) {
    map[key] = {
      name: key,
      count: 0,
      calls: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      ...extra,
    };
  }
  return map[key];
}

function sortBy(arr, key) {
  return arr.sort((a, b) => (b[key] || 0) - (a[key] || 0) || String(a.name).localeCompare(String(b.name)));
}

function toList(map, sortKey = "count") {
  return sortBy(Object.values(map), sortKey);
}

function bumpSeries(map, bucket, fields) {
  if (!bucket) return;
  if (!map[bucket]) {
    map[bucket] = { bucket, count: 0, calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }
  const row = map[bucket];
  for (const [k, v] of Object.entries(fields || {})) {
    row[k] = (row[k] || 0) + num(v);
  }
}

function seriesList(map) {
  return Object.values(map).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

function labeledSeries(map, seriesGrain) {
  return seriesList(map).map((row) => ({
    ...row,
    label: formatSeriesBucket(row.bucket, seriesGrain),
  }));
}

function parsePayload(raw) {
  return workbookStore.parseJsonCell(raw);
}

function emptyTokens() {
  return { calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function addTokens(target, row) {
  target.calls += 1;
  target.prompt_tokens += num(row.prompt_tokens);
  target.completion_tokens += num(row.completion_tokens);
  target.total_tokens += num(row.total_tokens);
}

/**
 * Execution outcome from Executions.status (+ legacy completed_at).
 *
 * Complete (counts toward Executions KPI):
 *   status ∈ {complete, completed, done, run_complete}
 *   OR blank/unknown status with completed_at set (pre-status rows)
 *
 * Incomplete (started but not fully completed):
 *   status ∈ {incomplete, failed, run_failed, cancelled, canceled,
 *             run_cancelled, abandoned, started, running}
 *   OR blank status with no completed_at
 */
function executionOutcome(run) {
  const status = String(run?.status || "")
    .trim()
    .toLowerCase();
  const COMPLETE = new Set(["complete", "completed", "done", "run_complete"]);
  const INCOMPLETE = new Set([
    "incomplete",
    "failed",
    "run_failed",
    "cancelled",
    "canceled",
    "run_cancelled",
    "abandoned",
    "started",
    "running",
  ]);
  if (COMPLETE.has(status)) return "complete";
  if (INCOMPLETE.has(status)) return "incomplete";
  if (String(run?.completed_at || "").trim()) return "complete";
  return "incomplete";
}

async function buildAnalytics(opts = {}) {
  const grain = normalizeGrain(opts.grain);
  let from = String(opts.from || "").slice(0, 10);
  let to = String(opts.to || "").slice(0, 10);
  // Day / Month / Year tabs select the current calendar period when no custom range is set.
  if (!from && !to) {
    const period = periodForGrain(grain, opts.now instanceof Date ? opts.now : undefined);
    from = period.from;
    to = period.to;
  }
  const seriesGrain = seriesGrainFor(grain);
  const userFilter = String(opts.user || "").trim().toLowerCase();
  const lobFilter = String(opts.lob || "").trim();
  const cardFilter = String(opts.card || "").trim();

  const tables = await workbookStore.readTables(["Executions", "QueueCards", "AiUsage", "JiraActions"]);
  const executions = tables.Executions || [];
  const cards = tables.QueueCards || [];
  const aiRows = tables.AiUsage || [];
  const jiraRows = tables.JiraActions || [];

  const byUser = {};
  const byLob = {};
  const byCard = {};
  const execSeries = {};
  const fillMode = { automated: 0, manual: 0, mixed: 0, capture: 0 };
  const execStatusByUser = {};
  const lobs = new Set();
  let execComplete = 0;
  let execIncomplete = 0;

  for (const run of executions) {
    const outcome = executionOutcome(run);
    let day = dayKey(run.run_date || run.completed_at || "");
    if (!day && outcome === "complete") day = dayKey(new Date());
    if (from || to) {
      if (!inRange(day, from, to)) continue;
    }
    const userId = String(run.user_id || "(unknown)");
    if (userFilter && !userId.toLowerCase().includes(userFilter)) continue;
    const lob = normalizeLob(run.lob);
    if (lobFilter && lob !== lobFilter) continue;
    const cardId = String(run.queue_card_id || run.queue_card || "(unknown)");
    if (cardFilter && cardId !== cardFilter && String(run.queue_card || "") !== cardFilter) continue;

    const statusRow = bumpNamed(execStatusByUser, userId, { complete: 0, incomplete: 0 });
    if (outcome === "incomplete") {
      execIncomplete += 1;
      statusRow.incomplete += 1;
      if (lob) lobs.add(lob);
      continue;
    }

    execComplete += 1;
    statusRow.complete += 1;
    if (lob) lobs.add(lob);
    const mode =
      run.fill_mode === "manual" || run.fill_mode === "mixed" || run.fill_mode === "capture"
        ? run.fill_mode
        : "automated";
    fillMode[mode] = (fillMode[mode] || 0) + 1;
    bumpNamed(byUser, userId).count += 1;
    bumpNamed(byLob, lob).count += 1;
    const cardRow = bumpNamed(byCard, cardId, { title: run.queue_card || cardId, lob });
    cardRow.count += 1;
    bumpSeries(execSeries, grainKey(day, seriesGrain), { count: 1 });
  }

  const cardOptions = [];
  const cardSeen = new Set();

  for (const card of cards) {
    const raw = String(card.status || "queued").toLowerCase();
    const status =
      raw === "done" ? "done" : raw === "incomplete" ? "incomplete" : "queued";
    const cardId = String(card.card_id || "").trim();
    const cardKey = `${card.lob || ""}/${cardId || "unknown"}`;
    if (cardSeen.has(cardKey)) continue;
    cardSeen.add(cardKey);
    if (card.lob) lobs.add(card.lob);
    if (cardId) {
      cardOptions.push({
        id: cardId,
        title: card.title || cardId,
        lob: card.lob,
        status,
      });
    }
  }

  const aiTotals = emptyTokens();
  const tokensByUser = {};
  const tokensByFeature = {};
  const aiSeries = {};
  const features = {};

  for (const row of aiRows) {
    const feature = String(row.feature || "unknown");
    if (!ANSWER_FEATURES.has(feature)) continue;
    const day = dayKey(row.ts);
    if (from || to) {
      if (!inRange(day, from, to)) continue;
    }
    const userId = String(row.user || "(unknown)");
    if (userFilter && !userId.toLowerCase().includes(userFilter)) continue;
    const cardId = String(row.cardId || "");
    if (cardFilter && cardId && cardId !== cardFilter) continue;

    addTokens(aiTotals, row);
    const u = bumpNamed(tokensByUser, userId);
    addTokens(u, row);
    const f = bumpNamed(tokensByFeature, feature, { label: FEATURE_LABELS[feature] || feature });
    addTokens(f, row);
    bumpSeries(aiSeries, grainKey(row.ts, seriesGrain), {
      calls: 1,
      prompt_tokens: num(row.prompt_tokens),
      completion_tokens: num(row.completion_tokens),
      total_tokens: num(row.total_tokens),
    });

    if (!features[feature]) {
      features[feature] = {
        feature,
        label: FEATURE_LABELS[feature] || feature,
        ...emptyTokens(),
        byUser: {},
      };
    }
    const feat = features[feature];
    addTokens(feat, row);
    const fu = bumpNamed(feat.byUser, userId);
    addTokens(fu, row);
  }

  const featureList = Object.values(features)
    .map((f) => ({
      ...f,
      byUser: toList(f.byUser, "total_tokens"),
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens || b.calls - a.calls || a.feature.localeCompare(b.feature));

  const jiraByUser = {};
  let jiraAiCalls = 0;
  for (const row of jiraRows) {
    const day = dayKey(row.timestamp);
    if (from || to) {
      if (!inRange(day, from, to)) continue;
    }
    const actor = String(row.actor || "(unknown)");
    if (userFilter && !actor.toLowerCase().includes(userFilter)) continue;
    const action = String(row.action || "");
    const payload = parsePayload(row.payload_json) || {};
    const usedAi = payload.usedAi === true || action === "ai_comment";
    if (!usedAi && action !== "ai_comment") continue;
    jiraAiCalls += 1;
    bumpNamed(jiraByUser, actor).count += 1;
  }

  const users = new Set();
  for (const r of toList(byUser)) users.add(r.name);
  for (const r of Object.values(execStatusByUser)) users.add(r.name);
  for (const r of toList(tokensByUser, "total_tokens")) users.add(r.name);

  return {
    generatedAt: new Date().toISOString(),
    grain,
    seriesGrain,
    from: from || null,
    to: to || null,
    filters: { user: userFilter, lob: lobFilter, card: cardFilter },
    executions: {
      // KPI: fully completed executions only (same filters as series / byUser).
      total: execComplete,
      complete: execComplete,
      incomplete: execIncomplete,
      byFillMode: fillMode,
      byUser: toList(byUser),
      byLob: toList(byLob),
      byCard: toList(byCard),
      series: labeledSeries(execSeries, seriesGrain),
    },
    // Backward-compatible KPI fields: formerly queue-card snapshot; now execution outcomes.
    cards: {
      complete: execComplete,
      incomplete: execIncomplete,
      total: execComplete + execIncomplete,
      byUser: sortBy(
        Object.values(execStatusByUser).map((r) => ({
          name: r.name,
          complete: r.complete || 0,
          incomplete: r.incomplete || 0,
          count: (r.complete || 0) + (r.incomplete || 0),
        })),
        "count",
      ),
    },
    ai: {
      ...aiTotals,
      byUser: toList(tokensByUser, "total_tokens"),
      byFeature: toList(tokensByFeature, "total_tokens").map((r) => ({
        ...r,
        label: FEATURE_LABELS[r.name] || r.name,
      })),
      series: labeledSeries(aiSeries, seriesGrain),
      features: featureList,
    },
    jiraAi: {
      calls: jiraAiCalls,
      byUser: toList(jiraByUser),
    },
    options: {
      users: [...users].sort((a, b) => a.localeCompare(b)),
      lobs: [...lobs].sort((a, b) => a.localeCompare(b)),
      cards: cardOptions.sort((a, b) => String(a.id).localeCompare(String(b.id))),
    },
  };
}

module.exports = {
  buildAnalytics,
  executionOutcome,
  grainKey,
  normalizeGrain,
  periodForGrain,
  seriesGrainFor,
  weekStartKey,
  weekLabel,
  formatSeriesBucket,
  FEATURE_LABELS,
};
