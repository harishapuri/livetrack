/**
 * Mother workbook — single source of truth at <projectRoot>/livetrack.xlsx
 * Each sheet is an Excel Table. Operational JSON/JSONL and per-card xlsx are gone.
 */
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

function resolveProjectRoot() {
  const envRoot = String(process.env.COACT_PROJECT_ROOT || "").trim();
  if (envRoot) return path.resolve(envRoot);
  const { defaultProjectRoot } = require("./documents");
  return defaultProjectRoot();
}

const WORKBOOK_NAME = "livetrack.xlsx";

const SHEETS = {
  Executions: {
    sheet: "Executions",
    table: "tblExecutions",
    columns: [
      "run_id",
      "run_date",
      "lob",
      "queue_card_id",
      "queue_card",
      "user_id",
      "fill_mode",
      "completed_at",
      "mistake_count",
      // complete | failed | cancelled | incomplete (see analytics.executionOutcome)
      "status",
    ],
  },
  Answers: {
    sheet: "Answers",
    table: "tblAnswers",
    columns: ["run_id", "queue_card_id", "field_key", "field_value"],
  },
  Mistakes: {
    sheet: "Mistakes",
    table: "tblMistakes",
    columns: ["run_id", "queue_card_id", "payload_json"],
  },
  Timing: {
    sheet: "Timing",
    table: "tblTiming",
    columns: ["run_id", "run_started_at", "run_duration_ms"],
  },
  TimingSteps: {
    sheet: "TimingSteps",
    table: "tblTimingSteps",
    columns: ["run_id", "step_id", "label", "step_start_time", "step_end_time"],
  },
  Feedback: {
    sheet: "Feedback",
    table: "tblFeedback",
    columns: [
      "ts",
      "source",
      "action",
      "cardId",
      "sopId",
      "user",
      "proposalCount",
      "editedCount",
      "reason",
      "payload_json",
    ],
  },
  Inbox: {
    sheet: "Inbox",
    table: "tblInbox",
    columns: [
      "id",
      "ts",
      "user",
      "category",
      "title",
      "body",
      "lob",
      "cardId",
      "status",
      "sme",
      "smeNote",
      "payload_json",
    ],
  },
  Actions: {
    sheet: "Actions",
    table: "tblActions",
    columns: [
      "id",
      "ts",
      "user",
      "title",
      "owner",
      "status",
      "dueKind",
      "dueAt",
      "source",
      "meetingId",
      "meetingSubject",
      "doneAt",
      "payload_json",
    ],
  },
  KgNodes: {
    sheet: "KgNodes",
    table: "tblKgNodes",
    columns: ["id", "kind", "key", "payload_json"],
  },
  KgEdges: {
    sheet: "KgEdges",
    table: "tblKgEdges",
    columns: ["from", "type", "to", "payload_json"],
  },
  Digests: {
    sheet: "Digests",
    table: "tblDigests",
    columns: [
      "digestId",
      "period_label",
      "period_start",
      "period_end",
      "payload_json",
    ],
  },
  DigestCards: {
    sheet: "DigestCards",
    table: "tblDigestCards",
    columns: ["digestId", "queue_card_id", "title", "payload_json"],
  },
  Datasets: {
    sheet: "Datasets",
    table: "tblDatasets",
    columns: [
      "version",
      "createdAt",
      "source_from",
      "source_to",
      "exampleCount",
      "positiveCount",
      "negativeCount",
      "approved",
      "approvedAt",
      "approvedBy",
      "rejected",
      "payload_json",
    ],
  },
  DatasetExamples: {
    sheet: "DatasetExamples",
    table: "tblDatasetExamples",
    columns: ["version", "type", "label", "cardKey", "payload_json"],
  },
  PiReports: {
    sheet: "PiReports",
    table: "tblPiReports",
    columns: ["generatedAt", "dateFrom", "dateTo", "sampleRuns", "payload_json"],
  },
  PiFindings: {
    sheet: "PiFindings",
    table: "tblPiFindings",
    columns: ["generatedAt", "kind", "cardKey", "payload_json"],
  },
  QueueLobs: {
    sheet: "QueueLobs",
    table: "tblQueueLobs",
    columns: ["lob", "assignees", "updated_at"],
  },
  QueueCards: {
    sheet: "QueueCards",
    table: "tblQueueCards",
    columns: [
      "lob",
      "card_id",
      "title",
      "sop_id",
      "status",
      "form_url",
      "pdf_path",
      "form_match",
      "assignees",
      "source_dir",
      "updated_at",
    ],
  },
  QueueData: {
    sheet: "QueueData",
    table: "tblQueueData",
    columns: ["lob", "card_id", "field_key", "field_value"],
  },
  QueueDocuments: {
    sheet: "QueueDocuments",
    table: "tblQueueDocuments",
    columns: ["lob", "card_id", "name", "relative_path", "absolute_path", "ext"],
  },
  Sops: {
    sheet: "Sops",
    table: "tblSops",
    columns: [
      "id",
      "name",
      "status",
      "source",
      "formUrl",
      "targetType",
      "payload_json",
    ],
  },
  SopSteps: {
    sheet: "SopSteps",
    table: "tblSopSteps",
    columns: [
      "sop_id",
      "step_id",
      "action",
      "label",
      "selector",
      "valueFrom",
      "mandatory",
      "payload_json",
    ],
  },
  JiraActions: {
    sheet: "JiraActions",
    table: "tblJiraActions",
    columns: ["timestamp", "actor", "issueKey", "action", "ok", "payload_json"],
  },
  AiUsage: {
    sheet: "AiUsage",
    table: "tblAiUsage",
    columns: [
      "ts",
      "user",
      "feature",
      "model",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "ok",
      "cardId",
      "payload_json",
    ],
  },
  CaptureTxns: {
    sheet: "CaptureTxns",
    table: "tblCaptureTxns",
    columns: [
      "ticket",
      "cardId",
      "queueCard",
      "startedAt",
      "completedAt",
      "pageUrl",
      "payload_json",
    ],
  },
  CaptureFields: {
    sheet: "CaptureFields",
    table: "tblCaptureFields",
    columns: ["ticket", "field_key", "field_value"],
  },
  CaptureEvents: {
    sheet: "CaptureEvents",
    table: "tblCaptureEvents",
    columns: ["ts", "sessionId", "cardId", "lob", "payload_json"],
  },
  Settings: {
    sheet: "Settings",
    table: "tblSettings",
    columns: ["key", "value"],
  },
  Catalog: {
    sheet: "_Catalog",
    table: "tblCatalog",
    columns: ["sheet", "table", "row_count", "updated_at"],
  },
};

const SECRET_KEY_RE = /(api[_-]?key|token|password|secret|smtp\.pass|pass)$/i;

function workbookPath(projectRoot = resolveProjectRoot()) {
  return path.join(projectRoot, WORKBOOK_NAME);
}

function sanitizeCell(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, 32000);
}

function cellText(cell) {
  if (!cell || cell.value == null) return "";
  const v = cell.value;
  if (typeof v === "object" && v.text != null) return String(v.text);
  if (typeof v === "object" && v.result != null) return String(v.result);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function jsonCell(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return sanitizeCell(value);
  try {
    return sanitizeCell(JSON.stringify(value));
  } catch {
    return sanitizeCell(value);
  }
}

function parseJsonCell(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function colLetter(n) {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withWorkbookLock(filePath, fn) {
  const lockPath = `${filePath}.lock`;
  const start = Date.now();
  const staleMs = 30000;
  const timeoutMs = 25000;

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
  throw new Error(`Could not lock ${path.basename(filePath)} — another writer is busy`);
}

async function loadWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  if (fs.existsSync(filePath)) {
    await workbook.xlsx.readFile(filePath);
  }
  return workbook;
}

function applySheetLayout(sheet, spec, rowCount) {
  const lastCol = spec.columns.length;
  const lastRow = Math.max(1, rowCount);
  sheet.getRow(1).font = { bold: true };
  spec.columns.forEach((name, i) => {
    sheet.getColumn(i + 1).width = Math.min(48, Math.max(14, String(name).length + 2));
  });
  sheet.views = [{ state: "frozen", ySplit: 1, activeCell: "A2" }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: lastRow, column: lastCol },
  };
}

function ensureSheet(workbook, spec) {
  let sheet = workbook.getWorksheet(spec.sheet);
  if (sheet) return sheet;
  sheet = workbook.addWorksheet(spec.sheet);
  sheet.addRow(spec.columns);
  applySheetLayout(sheet, spec, 1);
  return sheet;
}

function readSheetObjects(workbook, spec) {
  const sheet = workbook.getWorksheet(spec.sheet);
  if (!sheet) return [];
  const rows = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const obj = {};
    let empty = true;
    spec.columns.forEach((col, i) => {
      const v = cellText(row.getCell(i + 1));
      obj[col] = v;
      if (v !== "") empty = false;
    });
    if (!empty) rows.push(obj);
  });
  return rows;
}

function replaceSheet(workbook, spec, objects) {
  const existing = workbook.getWorksheet(spec.sheet);
  if (existing) workbook.removeWorksheet(existing.id);
  const sheet = workbook.addWorksheet(spec.sheet);
  sheet.addRow(spec.columns);
  const rows = objects || [];
  for (const obj of rows) {
    sheet.addRow(spec.columns.map((c) => sanitizeCell(obj[c])));
  }
  applySheetLayout(sheet, spec, rows.length + 1);
  return sheet;
}

function refreshCatalog(workbook) {
  const now = new Date().toISOString();
  const rows = Object.values(SHEETS)
    .filter((s) => s.sheet !== "_Catalog")
    .map((spec) => ({
      sheet: spec.sheet,
      table: spec.table,
      row_count: String(readSheetObjects(workbook, spec).length),
      updated_at: now,
    }));
  replaceSheet(workbook, SHEETS.Catalog, rows);
}

async function writeWorkbookAtomic(workbook, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  refreshCatalog(workbook);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp.xlsx`;
  await workbook.xlsx.writeFile(tmp);
  fs.renameSync(tmp, filePath);
}

async function withWorkbook(projectRoot, mutator) {
  const filePath = workbookPath(projectRoot);
  return withWorkbookLock(filePath, async () => {
    const workbook = await loadWorkbook(filePath);
    for (const spec of Object.values(SHEETS)) {
      const rows = workbook.getWorksheet(spec.sheet)
        ? readSheetObjects(workbook, spec)
        : [];
      replaceSheet(workbook, spec, rows);
    }
    const result = await mutator(workbook, filePath);
    await writeWorkbookAtomic(workbook, filePath);
    return result;
  });
}

async function readTables(names, projectRoot = resolveProjectRoot()) {
  const filePath = workbookPath(projectRoot);
  if (!fs.existsSync(filePath)) {
    const empty = {};
    for (const name of names) empty[name] = [];
    return empty;
  }
  const workbook = await loadWorkbook(filePath);
  const out = {};
  for (const name of names) {
    const spec = SHEETS[name];
    out[name] = spec ? readSheetObjects(workbook, spec) : [];
  }
  return out;
}

async function appendRows(sheetKey, rows, projectRoot = resolveProjectRoot()) {
  const spec = SHEETS[sheetKey];
  if (!spec || !rows?.length) return;
  await withWorkbook(projectRoot, async (workbook) => {
    const existing = readSheetObjects(workbook, spec);
    replaceSheet(workbook, spec, existing.concat(rows));
  });
}

async function replaceRows(sheetKey, rows, projectRoot = resolveProjectRoot()) {
  const spec = SHEETS[sheetKey];
  if (!spec) return;
  await withWorkbook(projectRoot, async (workbook) => {
    replaceSheet(workbook, spec, rows);
  });
}

async function rewriteWorkbook(projectRoot = resolveProjectRoot()) {
  await withWorkbook(projectRoot, async () => null);
}

function isSecretSettingKey(key) {
  return SECRET_KEY_RE.test(String(key || ""));
}

function flattenSettings(obj, prefix = "") {
  const rows = [];
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
    const key = prefix || "value";
    rows.push({
      key,
      value: isSecretSettingKey(key) ? "(redacted)" : jsonCell(obj),
    });
    return rows;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      rows.push(...flattenSettings(v, key));
    } else {
      rows.push({
        key,
        value: isSecretSettingKey(key) || isSecretSettingKey(k) ? "(redacted)" : jsonCell(v),
      });
    }
  }
  return rows;
}

module.exports = {
  WORKBOOK_NAME,
  SHEETS,
  workbookPath,
  jsonCell,
  parseJsonCell,
  withWorkbook,
  readTables,
  appendRows,
  replaceRows,
  rewriteWorkbook,
  readSheetObjects,
  replaceSheet,
  flattenSettings,
  isSecretSettingKey,
};
