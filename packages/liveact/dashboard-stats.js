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

module.exports = {
  generateDashboardData,
  defaultDashboardDir,
};
