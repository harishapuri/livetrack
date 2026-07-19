const fs = require("fs");
const path = require("path");
const os = require("os");
const ExcelJS = require("exceljs");
const { defaultSqlRoot } = require("./documents");
const { resolveExecutionsRoot } = require("./settings");
const { generatePostgresSql } = require("./generate-sql");

const SHEET_NAME = "Executions";

/** Fixed leading columns; field keys are appended dynamically. */
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

/** Legacy wide sheets before mistake tracking (7 meta cols). */
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

function sanitizePart(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function todayStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function osUserId() {
  try {
    return os.userInfo().username || "user";
  } catch {
    return "user";
  }
}

function executionBaseName(lob, queueCard, userId) {
  return `${sanitizePart(lob)}_${sanitizePart(queueCard)}_${sanitizePart(userId)}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** One Excel file per queue card: executions/<LOB>_<queueCard>.xlsx */
function excelPathForCard(lob, queueCard, executionsRoot = resolveExecutionsRoot()) {
  const name = `${sanitizePart(lob)}_${sanitizePart(queueCard)}.xlsx`;
  return path.join(executionsRoot, name);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Acquire a simple lock file for multi-writer shared Excel folders.
 * Stale locks (>30s) are stolen.
 */
async function withExcelLock(xlsxPath, fn) {
  const lockPath = `${xlsxPath}.lock`;
  const start = Date.now();
  const staleMs = 30000;
  const timeoutMs = 20000;

  while (Date.now() - start < timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
      } finally {
        fs.closeSync(fd);
      }
      try {
        return await fn();
      } finally {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        /* retry */
      }
      await sleep(80 + Math.floor(Math.random() * 120));
    }
  }
  throw new Error(`Could not lock ${path.basename(xlsxPath)} — another writer is busy`);
}

async function writeWorkbookAtomic(workbook, xlsxPath) {
  const tmp = `${xlsxPath}.${process.pid}.${Date.now()}.tmp.xlsx`;
  await workbook.xlsx.writeFile(tmp);
  fs.renameSync(tmp, xlsxPath);
}

function readHeaderList(sheet) {
  const headerRow = sheet.getRow(1);
  const headers = [];
  const count = Math.max(headerRow.cellCount, META_HEADERS.length);
  for (let c = 1; c <= count; c++) {
    const v = headerRow.getCell(c).value;
    if (v == null || v === "") {
      if (c <= META_HEADERS.length) headers.push(META_HEADERS[c - 1]);
      else break;
    } else {
      headers.push(String(v).trim());
    }
  }
  return headers;
}

function isWideHeader(headers) {
  return (
    headers[0] === "LOB" &&
    headers[1] === "Queue Card" &&
    headers[2] === "User" &&
    headers[3] === "Fill Mode"
  );
}

/** Upgrade legacy 7-col header row to include Mistake Count / Mistakes. */
function ensureMistakeColumns(sheet, headers) {
  if (headers[7] === "Mistake Count" && headers[8] === "Mistakes") {
    return headers;
  }
  const fieldHeaders = headers.slice(META_HEADERS_LEGACY.length);
  const next = [...META_HEADERS, ...fieldHeaders];
  const row1 = sheet.getRow(1);
  for (let c = 0; c < next.length; c++) {
    row1.getCell(c + 1).value = next[c];
    row1.getCell(c + 1).font = { bold: true };
  }
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const vals = [];
    for (let c = 1; c <= Math.max(row.cellCount, META_HEADERS_LEGACY.length); c++) {
      vals.push(row.getCell(c).value);
    }
    const meta = vals.slice(0, META_HEADERS_LEGACY.length);
    const fields = vals.slice(META_HEADERS_LEGACY.length);
    const rebuilt = [...meta, 0, "[]", ...fields];
    for (let c = 0; c < rebuilt.length; c++) {
      row.getCell(c + 1).value = rebuilt[c] ?? null;
    }
  });
  return next;
}

async function loadOrCreateCardWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  if (fs.existsSync(filePath)) {
    await workbook.xlsx.readFile(filePath);
  }

  let sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    sheet = workbook.addWorksheet(SHEET_NAME);
    sheet.addRow([...META_HEADERS]);
    sheet.getRow(1).font = { bold: true };
  } else if (!isWideHeader(readHeaderList(sheet))) {
    const idx = sheet.id;
    workbook.removeWorksheet(idx);
    sheet = workbook.addWorksheet(SHEET_NAME);
    sheet.addRow([...META_HEADERS]);
    sheet.getRow(1).font = { bold: true };
  }

  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 32;
  sheet.getColumn(3).width = 16;
  sheet.getColumn(4).width = 12;
  sheet.getColumn(5).width = 12;
  sheet.getColumn(6).width = 24;
  sheet.getColumn(7).width = 40;
  sheet.getColumn(8).width = 12;
  sheet.getColumn(9).width = 48;
  return { workbook, sheet };
}

function fieldsFromActions(actions) {
  const fields = {};
  for (const a of actions) {
    const key = a.key || a.field_key || a.stepId || a.step_id;
    if (!key) continue;
    const value =
      a.value != null
        ? String(a.value)
        : a.field_value != null
          ? String(a.field_value)
          : "";
    fields[String(key)] = value;
  }
  return fields;
}

function deriveFillMode(actions, hint) {
  if (hint === "automated" || hint === "manual" || hint === "mixed") return hint;
  if (!actions.length) return "automated";
  const hasManual = actions.some((a) => a.source === "manual");
  const hasAuto = actions.some((a) => a.source !== "manual");
  if (hasManual && hasAuto) return "mixed";
  if (hasManual) return "manual";
  return "automated";
}

/**
 * One row per completed execution in a per-queue-card Excel file.
 * Uses shared executions root + file lock for multi-agent writes.
 */
async function saveExecutionArtifacts({
  lob,
  queueCard,
  cardTitle,
  actions = [],
  mistakes = [],
  fillMode: fillModeHint = null,
  filledPdfSource = null,
  jiraKey = "",
  formReference = "",
  pageUrl = "",
  executionsRoot = resolveExecutionsRoot(),
  completedAt = new Date(),
}) {
  void filledPdfSource;
  const userId = osUserId();
  const runDate = todayStamp(completedAt);
  const base = executionBaseName(lob, queueCard, userId);
  const runId = `${base}_${completedAt.toISOString().replace(/[:.]/g, "-")}`;
  const cardName = cardTitle || queueCard;
  const fillMode = deriveFillMode(actions, fillModeHint);
  const mistakeList = Array.isArray(mistakes) ? mistakes : [];
  const mistakeCount = mistakeList.length;
  const mistakesJson = JSON.stringify(mistakeList);

  ensureDir(executionsRoot);
  ensureDir(defaultSqlRoot());

  const normalized = actions.map((a, i) => ({
    sequence_no: i + 1,
    action_type: a.action || a.action_type || "fill",
    field_key: a.key || a.field_key || a.stepId || "",
    field_value:
      a.value != null
        ? String(a.value)
        : a.field_value != null
          ? String(a.field_value)
          : "",
    step_id: a.stepId || a.step_id || "",
    step_label: a.label || a.step_label || "",
    source: a.source || (fillMode === "manual" ? "manual" : "automated"),
  }));

  const fields = fieldsFromActions(normalized);
  const {
    extractJiraKey,
    isGeneratedJiraKey,
    resolveFormReference,
  } = require("./dashboard-stats");
  const storyKey = extractJiraKey(jiraKey);
  if (storyKey && !isGeneratedJiraKey(storyKey)) {
    fields.jiraStoryKey = storyKey;
  }
  const resolvedRef = resolveFormReference({
    pageUrl,
    answers: { formReference, ...fields },
    runId,
  });
  fields.formReference = resolvedRef.formReference;
  if (pageUrl) fields.pageUrl = String(pageUrl).slice(0, 500);
  const xlsxPath = excelPathForCard(lob || "TCOO", queueCard, executionsRoot);

  await withExcelLock(xlsxPath, async () => {
    const { workbook, sheet } = await loadOrCreateCardWorkbook(xlsxPath);

    let headers = readHeaderList(sheet);
    if (!isWideHeader(headers)) {
      headers = [...META_HEADERS];
      sheet.getRow(1).values = [undefined, ...META_HEADERS];
      sheet.getRow(1).font = { bold: true };
    } else {
      headers = ensureMistakeColumns(sheet, headers);
    }

    const metaLen = metaColumnCount(headers);
    const fieldHeaders = headers.slice(metaLen);
    const newKeys = Object.keys(fields)
      .filter((k) => !fieldHeaders.includes(k) && !META_HEADERS.includes(k))
      .sort((a, b) => a.localeCompare(b));

    for (const key of newKeys) {
      fieldHeaders.push(key);
      headers.push(key);
      const col = headers.length;
      sheet.getRow(1).getCell(col).value = key;
      sheet.getRow(1).getCell(col).font = { bold: true };
      sheet.getColumn(col).width = Math.min(36, Math.max(14, key.length + 2));
    }

    const row = [
      lob || "TCOO",
      cardName,
      userId,
      fillMode,
      runDate,
      completedAt.toISOString(),
      runId,
      mistakeCount,
      mistakesJson,
    ];
    for (const key of fieldHeaders) {
      row.push(fields[key] != null ? fields[key] : "");
    }
    sheet.addRow(row);

    await writeWorkbookAtomic(workbook, xlsxPath);
  });

  let sqlResult = null;
  try {
    sqlResult = await generatePostgresSql({ quiet: true, executionsRoot });
  } catch (err) {
    console.error("[coact] postgres sql regenerate failed", err.message);
  }

  return {
    ok: true,
    runId,
    jiraKey: fields.jiraStoryKey || "",
    formReference: fields.formReference || "",
    outDir: executionsRoot,
    excelPath: xlsxPath,
    fillMode,
    mistakeCount,
    userId,
    base,
    sqlResult,
  };
}

module.exports = {
  META_HEADERS,
  META_HEADERS_LEGACY,
  SHEET_NAME,
  sanitizePart,
  todayStamp,
  osUserId,
  executionBaseName,
  excelPathForCard,
  deriveFillMode,
  metaColumnCount,
  withExcelLock,
  saveExecutionArtifacts,
};
