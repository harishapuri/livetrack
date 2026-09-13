/**
 * Generate PostgreSQL SQL from the mother workbook (livetrack.xlsx).
 * One table (livetrack_executions), one row per execution, answers as JSONB.
 */
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { defaultProjectRoot } = require("./documents");
const { resolveExecutionsRoot } = require("./settings");

const SHEET_NAME = "Executions";
const TABLE = "livetrack_executions";
const META_HEADERS = [
  "LOB",
  "Queue Card",
  "User",
  "Fill Mode",
  "Run Date",
  "Completed At",
  "Run ID",
  "Mistake Count",
  "Mistakes",
];

const META_HEADERS_LEGACY = [
  "LOB",
  "Queue Card",
  "User",
  "Fill Mode",
  "Run Date",
  "Completed At",
  "Run ID",
];

function metaColumnCount(headers) {
  if (headers?.[7] === "Mistake Count") return META_HEADERS.length;
  return META_HEADERS_LEGACY.length;
}

function parseMistakesCell(raw) {
  if (!raw || !String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizeSqlText(value) {
  return String(value ?? "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function sqlString(value) {
  if (value == null || value === "") return "NULL";
  return `'${sanitizeSqlText(value).replace(/'/g, "''")}'`;
}

function sqlDateTime(value) {
  if (value == null || value === "") return "NULL";
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (m) return `'${m[1]} ${m[2]}+00'::timestamptz`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `'${s}'::timestamptz`;
  return sqlString(s);
}

function sqlDate(value) {
  if (value == null || value === "") return "NULL";
  const s = String(value).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `'${s}'::date`;
  return sqlString(value);
}

function sqlJsonb(obj) {
  return `'${JSON.stringify(obj ?? {}).replace(/'/g, "''")}'::jsonb`;
}

function cellText(cell) {
  if (!cell || cell.value == null) return "";
  const v = cell.value;
  if (typeof v === "object" && v.text != null) return String(v.text);
  if (typeof v === "object" && v.result != null) return String(v.result);
  return String(v);
}

function parseExcelFileName(filePath) {
  const base = path.basename(filePath, ".xlsx");
  const idx = base.indexOf("_");
  if (idx <= 0) return { lob: "TCOO", queueCardId: base };
  return { lob: base.slice(0, idx), queueCardId: base.slice(idx + 1) };
}

function listExcelFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(
      (n) =>
        n.endsWith(".xlsx") &&
        !n.startsWith("~") &&
        !n.startsWith(".") &&
        n !== "coact_executions.xlsx"
    )
    .map((n) => path.join(dir, n))
    .sort();
}

async function loadWideSheet(xlsxPath, opts = {}) {
  const dateFilter = opts.dateFilter || null;
  const dateFrom = opts.dateFrom || null;
  const dateTo = opts.dateTo || null;
  const includeAnswers = opts.includeAnswers !== false;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.getWorksheet(SHEET_NAME) || workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headers = [];
  const maxCol = Math.max(headerRow.cellCount, META_HEADERS.length);
  for (let col = 1; col <= maxCol; col++) {
    const h = cellText(headerRow.getCell(col));
    if (!h && col > META_HEADERS.length) break;
    headers.push(h || META_HEADERS[col - 1] || `col_${col}`);
  }

  if (
    headers[0] !== "LOB" ||
    headers[3] !== "Fill Mode" ||
    headers[6] !== "Run ID"
  ) {
    return [];
  }

  const { lob: fileLob, queueCardId } = parseExcelFileName(xlsxPath);
  const metaLen = metaColumnCount(headers);
  const fieldKeys = includeAnswers ? headers.slice(metaLen) : [];
  const rows = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    // Only read meta (+ mistakes) columns when answers not needed
    const colLimit = includeAnswers ? headers.length : metaLen;
    const values = [];
    for (let i = 0; i < colLimit; i++) {
      values.push(cellText(row.getCell(i + 1)));
    }
    while (values.length < metaLen) values.push("");

    const runDateVal = values[4];
    const runId = values[6];
    if (!runId) return;
    if (dateFilter && runDateVal !== dateFilter) return;
    if (dateFrom && runDateVal && runDateVal < dateFrom) return;
    if (dateTo && runDateVal && runDateVal > dateTo) return;

    const hasMistakes = metaLen >= META_HEADERS.length;
    const mistakeCount = hasMistakes ? Number(values[7]) || 0 : 0;
    const mistakes = hasMistakes ? parseMistakesCell(values[8]) : [];

    const answers = {};
    if (includeAnswers) {
      fieldKeys.forEach((key, i) => {
        const val = values[metaLen + i];
        if (key && val !== "") answers[String(key)] = String(val);
      });
    }

    rows.push({
      run_id: runId,
      run_date: runDateVal || dateFilter || null,
      lob: values[0] || fileLob || "TCOO",
      queue_card_id: queueCardId,
      queue_card: values[1] || queueCardId,
      user_id: values[2] || "",
      fill_mode: values[3] || "automated",
      completed_at: values[5] || "",
      excel_path: path.basename(xlsxPath),
      mistake_count: mistakeCount || mistakes.length,
      mistakes,
      answers,
    });
  });

  return rows;
}

function schemaSql() {
  return [
    `CREATE TABLE IF NOT EXISTS ${TABLE} (`,
    `  run_id         TEXT PRIMARY KEY,`,
    `  run_date       DATE NOT NULL,`,
    `  lob            TEXT NOT NULL,`,
    `  queue_card_id  TEXT NOT NULL,`,
    `  queue_card     TEXT NOT NULL,`,
    `  user_id        TEXT NOT NULL,`,
    `  fill_mode      TEXT NOT NULL,`,
    `  completed_at   TIMESTAMPTZ NULL,`,
    `  excel_path     TEXT NULL,`,
    `  mistake_count  INTEGER NOT NULL DEFAULT 0,`,
    `  mistakes       JSONB NOT NULL DEFAULT '[]'::jsonb,`,
    `  answers        JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `);`,
    ``,
    `CREATE INDEX IF NOT EXISTS idx_livetrack_exec_day_lob`,
    `  ON ${TABLE} (run_date, lob, queue_card_id);`,
    ``,
    `CREATE INDEX IF NOT EXISTS idx_livetrack_exec_answers`,
    `  ON ${TABLE} USING GIN (answers);`,
    ``,
    `CREATE INDEX IF NOT EXISTS idx_livetrack_exec_mistakes`,
    `  ON ${TABLE} USING GIN (mistakes);`,
    ``,
    `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS mistake_count INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS mistakes JSONB NOT NULL DEFAULT '[]'::jsonb;`,
    ``,
  ].join("\n");
}

function upsertSql(run) {
  const cols = [
    "run_id",
    "run_date",
    "lob",
    "queue_card_id",
    "queue_card",
    "user_id",
    "fill_mode",
    "completed_at",
    "excel_path",
    "mistake_count",
    "mistakes",
    "answers",
  ];
  const vals = [
    sqlString(run.run_id),
    sqlDate(run.run_date),
    sqlString(run.lob),
    sqlString(run.queue_card_id),
    sqlString(run.queue_card),
    sqlString(run.user_id),
    sqlString(run.fill_mode),
    sqlDateTime(run.completed_at),
    sqlString(run.excel_path),
    String(Number(run.mistake_count) || 0),
    sqlJsonb(run.mistakes || []),
    sqlJsonb(run.answers),
  ];

  return [
    `INSERT INTO ${TABLE} (`,
    `  ${cols.join(",\n  ")}`,
    `) VALUES (`,
    `  ${vals.join(",\n  ")}`,
    `)`,
    `ON CONFLICT (run_id) DO UPDATE SET`,
    `  run_date       = EXCLUDED.run_date,`,
    `  lob            = EXCLUDED.lob,`,
    `  queue_card_id  = EXCLUDED.queue_card_id,`,
    `  queue_card     = EXCLUDED.queue_card,`,
    `  user_id        = EXCLUDED.user_id,`,
    `  fill_mode      = EXCLUDED.fill_mode,`,
    `  completed_at   = EXCLUDED.completed_at,`,
    `  excel_path     = EXCLUDED.excel_path,`,
    `  mistake_count  = EXCLUDED.mistake_count,`,
    `  mistakes       = EXCLUDED.mistakes,`,
    `  answers        = EXCLUDED.answers;`,
    ``,
  ].join("\n");
}

function defaultDateRangeDays(days = 7) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (Number(days) || 7));
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  return { dateFrom: fmt(from), dateTo: fmt(to) };
}

async function loadAllExecutions(opts = {}) {
  const dateFilter = opts.dateFilter || null;
  let dateFrom = opts.dateFrom || null;
  let dateTo = opts.dateTo || null;
  if (!dateFilter && !dateFrom && !dateTo && opts.defaultLastDays) {
    const range = defaultDateRangeDays(opts.defaultLastDays);
    dateFrom = range.dateFrom;
    dateTo = range.dateTo;
  }
  const includeAnswers = opts.includeAnswers !== false;
  const projectRoot = defaultProjectRoot();
  const workbookStore = require("./workbook");
  const xlsxPath = workbookStore.workbookPath(projectRoot);
  const tables = await workbookStore.readTables(
    ["Executions", "Answers", "Mistakes"],
    projectRoot
  );
  const answersByRun = new Map();
  if (includeAnswers) {
    for (const row of tables.Answers || []) {
      if (!row.run_id || !row.field_key) continue;
      if (!answersByRun.has(row.run_id)) answersByRun.set(row.run_id, {});
      answersByRun.get(row.run_id)[row.field_key] = row.field_value;
    }
  }
  const mistakesByRun = new Map();
  for (const row of tables.Mistakes || []) {
    if (!row.run_id) continue;
    if (!mistakesByRun.has(row.run_id)) mistakesByRun.set(row.run_id, []);
    const parsed = workbookStore.parseJsonCell(row.payload_json);
    mistakesByRun.get(row.run_id).push(parsed && typeof parsed === "object" ? parsed : { raw: row.payload_json });
  }

  let execRoot = opts.executionsRoot;
  if (!execRoot) {
    try {
      execRoot = resolveExecutionsRoot();
    } catch {
      execRoot = path.join(projectRoot, "executions");
    }
  }

  const allRows = [];
  for (const row of tables.Executions || []) {
    const runId = row.run_id;
    if (!runId) continue;
    const runDateRaw = row.run_date;
    const runDateVal =
      runDateRaw instanceof Date && !Number.isNaN(runDateRaw.getTime())
        ? `${runDateRaw.getFullYear()}-${String(runDateRaw.getMonth() + 1).padStart(2, "0")}-${String(runDateRaw.getDate()).padStart(2, "0")}`
        : String(runDateRaw || "").slice(0, 10);
    if (dateFilter && runDateVal !== dateFilter) continue;
    if (dateFrom && runDateVal && runDateVal < dateFrom) continue;
    if (dateTo && runDateVal && runDateVal > dateTo) continue;
    const mistakes = mistakesByRun.get(runId) || [];
    allRows.push({
      run_id: runId,
      run_date: runDateVal || dateFilter || null,
      lob: row.lob || "TCOO",
      queue_card_id: row.queue_card_id || "",
      queue_card: row.queue_card || row.queue_card_id || "",
      user_id: row.user_id || "",
      fill_mode: row.fill_mode || "automated",
      completed_at: row.completed_at || "",
      status: row.status || "",
      excel_path: path.basename(xlsxPath),
      mistake_count: Number(row.mistake_count) || mistakes.length,
      mistakes,
      answers: includeAnswers ? answersByRun.get(runId) || {} : {},
    });
  }

  const byId = new Map();
  for (const row of allRows) byId.set(row.run_id, row);
  const runs = [...byId.values()].sort((a, b) =>
    String(a.completed_at).localeCompare(String(b.completed_at))
  );
  return { files: fs.existsSync(xlsxPath) ? [xlsxPath] : [], runs, execRoot, dateFrom, dateTo, dateFilter };
}

/**
 * Rebuild Postgres SQL files from every queue-card Excel under executions/.
 * @param {{ dateFilter?: string|null, quiet?: boolean, executionsRoot?: string, sqlRoot?: string }} [opts]
 */
async function generatePostgresSql(opts = {}) {
  const dateFilter = opts.dateFilter || null;
  const quiet = Boolean(opts.quiet);
  const writeFiles = Boolean(opts.writeFiles);
  const outSqlRoot = path.join(defaultProjectRoot(), "sql");

  if (writeFiles) ensureDir(outSqlRoot);

  const { files, runs, dateFrom, dateTo } = await loadAllExecutions({
    dateFilter,
    dateFrom: opts.dateFrom || null,
    dateTo: opts.dateTo || null,
    executionsRoot: opts.executionsRoot,
    includeAnswers: true,
  });

  if (!quiet) {
    for (const file of files) {
      const n = runs.filter((r) => r.excel_path === path.basename(file)).length;
      console.log(`[livetrack-sql] ${path.basename(file)}: ${n} execution(s)`);
    }
  }

  const generatedAt = new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");

  const scopeNote = dateFilter
    ? `Filtered run_date = ${dateFilter}`
    : `All executions from all queue-card Excel files`;

  const schemaBody = schemaSql();
  const schemaPath = path.join(outSqlRoot, "livetrack_schema.sql");
  const insertsPath = path.join(outSqlRoot, "livetrack_inserts.sql");
  const allInOnePath = path.join(outSqlRoot, "livetrack_poc_all_in_one.sql");

  if (writeFiles) {
    fs.writeFileSync(
      schemaPath,
      [
        `/* LiveTrack PostgreSQL schema — one table for ALL queue cards */`,
        `/* Generated: ${generatedAt} */`,
        ``,
        schemaBody,
      ].join("\n"),
      "utf8"
    );
  }

  const insertLines = [
    `/* Coact PostgreSQL upserts — one row per execution */`,
    `/* Generated: ${generatedAt} */`,
    `/* ${scopeNote} */`,
    `/* Queue-card files: ${files.length} | Executions: ${runs.length} */`,
    ``,
    `BEGIN;`,
    ``,
  ];
  for (const run of runs) {
    insertLines.push(
      `/* ${sanitizeSqlText(run.lob)} | ${sanitizeSqlText(run.queue_card_id)} | ${run.fill_mode} */`
    );
    insertLines.push(upsertSql(run));
  }
  if (!runs.length) {
    insertLines.push(`/* No executions found under executions/ */`);
    insertLines.push(``);
  }
  insertLines.push(`COMMIT;`);
  insertLines.push(``);
  if (writeFiles) fs.writeFileSync(insertsPath, insertLines.join("\n"), "utf8");

  const allLines = [
    `/*`,
    `  Coact PostgreSQL POC — ALL IN ONE`,
    `  Generated: ${generatedAt}`,
    `  ${scopeNote}`,
    `  Queue-card Excel files: ${files.length}`,
    `  Executions (rows): ${runs.length}`,
    `  Paste this entire file into Neon / Supabase / any Postgres SQL editor.`,
    `*/`,
    ``,
    schemaBody,
    `BEGIN;`,
    ``,
  ];
  for (const run of runs) {
    allLines.push(
      `/* ${sanitizeSqlText(run.lob)} | ${sanitizeSqlText(run.queue_card_id)} | ${run.fill_mode} */`
    );
    allLines.push(upsertSql(run));
  }
  if (!runs.length) {
    allLines.push(`/* No executions found */`);
    allLines.push(``);
  }
  allLines.push(`COMMIT;`);
  allLines.push(``);
  allLines.push(`SELECT run_id, lob, queue_card_id, fill_mode, answers`);
  allLines.push(`FROM ${TABLE}`);
  allLines.push(`ORDER BY completed_at NULLS LAST, run_id;`);
  allLines.push(``);
  if (writeFiles) fs.writeFileSync(allInOnePath, allLines.join("\n"), "utf8");

  if (writeFiles && dateFilter) {
    fs.writeFileSync(
      path.join(outSqlRoot, `coact_inserts_${dateFilter}.sql`),
      insertLines.join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(outSqlRoot, `coact_schema_${dateFilter}.sql`),
      [`/* Generated: ${generatedAt} */`, ``, schemaBody].join("\n"),
      "utf8"
    );
  }

  if (!quiet) {
    console.log(`[livetrack-sql] Queue-card Excel files: ${files.length}`);
    console.log(`[livetrack-sql] Executions (single rows): ${runs.length}`);
    if (writeFiles) {
      console.log(`[livetrack-sql] Schema  → ${schemaPath}`);
      console.log(`[livetrack-sql] Inserts → ${insertsPath}`);
      console.log(`[livetrack-sql] All-in-one → ${allInOnePath}`);
    }
  }

  return {
    ok: true,
    fileCount: files.length,
    runCount: runs.length,
    schemaPath,
    insertsPath,
    allInOnePath,
  };
}

module.exports = {
  generatePostgresSql,
  loadAllExecutions,
  defaultDateRangeDays,
  TABLE,
};
