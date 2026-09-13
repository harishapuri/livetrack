#!/usr/bin/env node
/**
 * Import legacy JSON/xlsx into <repo>/livetrack.xlsx then callers should delete those files.
 */
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { defaultProjectRoot } = require("../documents");
const workbookStore = require("../workbook");

const ROOT = defaultProjectRoot();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function walkJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function importWideXlsx(xlsxPath, executions, answers, mistakes) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const sheet = wb.getWorksheet("Executions") || wb.worksheets[0];
  if (!sheet) return;
  const headerRow = sheet.getRow(1);
  const headers = [];
  for (let c = 1; c <= headerRow.cellCount; c++) {
    const v = headerRow.getCell(c).value;
    headers.push(v == null ? "" : String(v));
  }
  if (headers[0] !== "LOB" || headers[6] !== "Run ID") return;
  const metaLen = headers[7] === "Mistake Count" ? 9 : 7;
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const vals = headers.map((_, i) => {
      const v = row.getCell(i + 1).value;
      return v == null ? "" : String(v);
    });
    const runId = vals[6];
    if (!runId) return;
    executions.push({
      run_id: runId,
      run_date: vals[4],
      lob: vals[0],
      queue_card_id: path.basename(xlsxPath, ".xlsx").split("_").slice(1).join("_"),
      queue_card: vals[1],
      user_id: vals[2],
      fill_mode: vals[3],
      completed_at: vals[5],
      mistake_count: metaLen >= 9 ? vals[7] : "0",
    });
    if (metaLen >= 9 && vals[8]) {
      mistakes.push({
        run_id: runId,
        queue_card_id: executions[executions.length - 1].queue_card_id,
        payload_json: vals[8],
      });
    }
    headers.slice(metaLen).forEach((key, i) => {
      const val = vals[metaLen + i];
      if (key && val) {
        answers.push({
          run_id: runId,
          queue_card_id: executions[executions.length - 1].queue_card_id,
          field_key: key,
          field_value: val,
        });
      }
    });
  });
}

async function migrate() {
  const executions = [];
  const answers = [];
  const mistakes = [];
  const execDir = path.join(ROOT, "executions");
  if (fs.existsSync(execDir)) {
    for (const name of fs.readdirSync(execDir)) {
      if (!name.endsWith(".xlsx") || name.startsWith("~") || name === "livetrack.xlsx") continue;
      if (name === "coact_executions.xlsx" || name === "coact_sops.xlsx") continue;
      await importWideXlsx(path.join(execDir, name), executions, answers, mistakes);
    }
  }

  const feedback = [];
  const fbDir = path.join(execDir, "feedback");
  if (fs.existsSync(fbDir)) {
    for (const name of fs.readdirSync(fbDir)) {
      if (!name.endsWith(".jsonl")) continue;
      for (const row of walkJsonl(path.join(fbDir, name))) {
        feedback.push({
          ts: row.ts || "",
          source: row.source || "",
          action: row.action || "",
          cardId: row.cardId || "",
          sopId: row.sopId || "",
          user: row.user || "",
          proposalCount: String(row.proposalCount || 0),
          editedCount: String(row.editedCount || 0),
          reason: row.reason || "",
          payload_json: workbookStore.jsonCell(row.meta),
        });
      }
    }
  }

  const queueCards = [];
  const queueData = [];
  const queueLobs = [];
  const queueRoot = path.join(ROOT, "queue");
  const extraQueue = path.join(osHomedir(), "Projects", "coact", "queue");
  function osHomedir() {
    return require("os").homedir();
  }
  const queueRoots = [queueRoot];
  if (extraQueue !== queueRoot && fs.existsSync(extraQueue)) queueRoots.push(extraQueue);
  for (const qroot of queueRoots) {
    if (!fs.existsSync(qroot)) continue;
    for (const lob of fs.readdirSync(qroot)) {
      const lobDir = path.join(qroot, lob);
      if (!fs.statSync(lobDir).isDirectory() || lob.startsWith(".")) continue;
      const lobCfg = readJson(path.join(lobDir, ".lob.json"));
      if (lobCfg) {
        queueLobs.push({
          lob,
          assignees: Array.isArray(lobCfg.assignees) ? lobCfg.assignees.join(",") : "",
          updated_at: new Date().toISOString(),
        });
      }
      for (const card of fs.readdirSync(lobDir)) {
        const dir = path.join(lobDir, card);
        if (!fs.statSync(dir).isDirectory()) continue;
        const meta = readJson(path.join(dir, "meta.json")) || {};
        const data = readJson(path.join(dir, "data.json")) || {};
        if (!meta.id && !Object.keys(data).length) continue;
        const cardId = meta.id || card;
        queueCards.push({
          lob: meta.lob || lob,
          card_id: cardId,
          title: meta.title || cardId,
          sop_id: meta.sopId || "",
          status: meta.status || "queued",
          form_url: meta.formUrl || "",
          pdf_path: meta.pdfPath || "",
          form_match: Array.isArray(meta.formMatch) ? meta.formMatch.join("|") : "",
          assignees: Array.isArray(meta.assignees) ? meta.assignees.join(",") : "",
          source_dir: dir,
          updated_at: new Date().toISOString(),
        });
        for (const [k, v] of Object.entries(data)) {
          queueData.push({
            lob: meta.lob || lob,
            card_id: cardId,
            field_key: k,
            field_value: v == null ? "" : String(v),
          });
        }
      }
    }
  }

  const sops = [];
  const sopSteps = [];
  function importSopFile(file, source) {
    const sop = readJson(file);
    if (!sop?.id) return;
    sops.push({
      id: sop.id,
      name: sop.name || sop.id,
      status: sop.status || "published",
      source,
      formUrl: sop.formUrl || "",
      targetType: sop.targetType || "",
      payload_json: workbookStore.jsonCell(sop),
    });
    for (const step of sop.steps || []) {
      sopSteps.push({
        sop_id: sop.id,
        step_id: step.id || "",
        action: step.action || "",
        label: step.label || "",
        selector: step.selector || "",
        valueFrom: step.valueFrom || "",
        mandatory: step.mandatory ? "true" : "false",
        payload_json: workbookStore.jsonCell(step),
      });
    }
  }
  const bundled = path.join(ROOT, "packages", "shared", "sops");
  if (fs.existsSync(bundled)) {
    for (const name of fs.readdirSync(bundled)) {
      if (name.endsWith(".json")) importSopFile(path.join(bundled, name), "bundled");
    }
  }
  const userSops = path.join(ROOT, "sops");
  if (fs.existsSync(userSops)) {
    for (const name of fs.readdirSync(userSops)) {
      if (name.endsWith(".json")) importSopFile(path.join(userSops, name), "user");
    }
  }

  const kg = readJson(path.join(ROOT, "knowledge-graph.json")) || { nodes: {}, edges: [] };
  const kgNodes = Object.values(kg.nodes || {}).map((n) => {
    const { id, kind, key, ...rest } = n;
    return { id, kind, key, payload_json: workbookStore.jsonCell(rest) };
  });
  const kgEdges = (kg.edges || []).map((e) => {
    const { from, type, to, ...rest } = e;
    return { from, type, to, payload_json: workbookStore.jsonCell(rest) };
  });

  const digestRows = [];
  const digestCards = [];
  const digestDir = path.join(ROOT, "digests");
  if (fs.existsSync(digestDir)) {
    for (const name of fs.readdirSync(digestDir)) {
      if (!name.endsWith(".json") || name === "index.json") continue;
      const d = readJson(path.join(digestDir, name));
      if (!d) continue;
      digestRows.push({
        digestId: d.digestId || name.replace(/\.json$/, ""),
        period_label: d.period?.label || "",
        period_start: d.period?.start || "",
        period_end: d.period?.end || "",
        payload_json: workbookStore.jsonCell(d),
      });
      for (const c of d.cards || []) {
        digestCards.push({
          digestId: d.digestId || "",
          queue_card_id: c.queue_card_id || "",
          title: c.title || "",
          payload_json: workbookStore.jsonCell(c),
        });
      }
    }
  }

  const datasets = [];
  const datasetExamples = [];
  const dsRoot = path.join(ROOT, "datasets");
  if (fs.existsSync(dsRoot)) {
    for (const name of fs.readdirSync(dsRoot)) {
      const dir = path.join(dsRoot, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const manifest = readJson(path.join(dir, "manifest.json"));
      if (!manifest) continue;
      datasets.push({
        version: String(manifest.version),
        createdAt: manifest.createdAt || "",
        source_from: manifest.sourceRange?.from || "",
        source_to: manifest.sourceRange?.to || "",
        exampleCount: String(manifest.exampleCount || 0),
        positiveCount: String(manifest.positiveCount || 0),
        negativeCount: String(manifest.negativeCount || 0),
        approved: manifest.approved ? "true" : "false",
        approvedAt: manifest.approvedAt || "",
        approvedBy: manifest.approvedBy || "",
        rejected: manifest.rejected ? "true" : "false",
        payload_json: workbookStore.jsonCell(manifest),
      });
      for (const ex of walkJsonl(path.join(dir, "dataset.jsonl"))) {
        datasetExamples.push({
          version: String(manifest.version),
          type: ex.type || "",
          label: ex.label || "",
          cardKey: ex.cardKey || "",
          payload_json: workbookStore.jsonCell(ex),
        });
      }
    }
  }

  const pi = readJson(path.join(ROOT, "process-intelligence-report.json"));
  const piReports = [];
  const piFindings = [];
  if (pi) {
    piReports.push({
      generatedAt: pi.generatedAt || "",
      dateFrom: pi.dateFrom || "",
      dateTo: pi.dateTo || "",
      sampleRuns: String(pi.sampleRuns || 0),
      payload_json: workbookStore.jsonCell(pi),
    });
  }

  const jiraActions = walkJsonl(path.join(ROOT, "jira-actions.jsonl")).map((row) => ({
    timestamp: row.timestamp || "",
    actor: row.actor || "",
    issueKey: row.issueKey || "",
    action: row.action || "",
    ok: String(row.ok),
    payload_json: workbookStore.jsonCell(row),
  }));

  await workbookStore.replaceRows("Executions", executions, ROOT);
  await workbookStore.replaceRows("Answers", answers, ROOT);
  await workbookStore.replaceRows("Mistakes", mistakes, ROOT);
  await workbookStore.replaceRows("Feedback", feedback, ROOT);
  await workbookStore.replaceRows("QueueLobs", queueLobs, ROOT);
  await workbookStore.replaceRows("QueueCards", queueCards, ROOT);
  await workbookStore.replaceRows("QueueData", queueData, ROOT);
  await workbookStore.replaceRows("Sops", sops, ROOT);
  await workbookStore.replaceRows("SopSteps", sopSteps, ROOT);
  await workbookStore.replaceRows("KgNodes", kgNodes, ROOT);
  await workbookStore.replaceRows("KgEdges", kgEdges, ROOT);
  await workbookStore.replaceRows("Digests", digestRows, ROOT);
  await workbookStore.replaceRows("DigestCards", digestCards, ROOT);
  await workbookStore.replaceRows("Datasets", datasets, ROOT);
  await workbookStore.replaceRows("DatasetExamples", datasetExamples, ROOT);
  await workbookStore.replaceRows("PiReports", piReports, ROOT);
  await workbookStore.replaceRows("PiFindings", piFindings, ROOT);
  await workbookStore.replaceRows("JiraActions", jiraActions, ROOT);

  console.log("[livetrack] wrote", workbookStore.workbookPath(ROOT));
  console.log("  executions", executions.length, "queue cards", queueCards.length, "sops", sops.length);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
