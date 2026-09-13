/**
 * Process Intelligence (DPIP Phase 2-3, heuristic v1 — no ML infra exists yet,
 * so these are transparent statistics over real execution history, not
 * trained models). Four agents from the design doc, implemented as pure
 * functions over the same underlying data so findings compose:
 *
 *   - Failure Prediction   : which cards/SOPs have a high historical mistake rate
 *   - Process Drift        : where declared SOP steps and actual filled fields diverge
 *   - Expert Pattern       : which values successful runs converge on per field
 *   - Process Optimization : turns the three findings above into SME-reviewable
 *                            SOP-edit suggestions (never auto-applied — governance rule)
 *
 * All four write their findings into the shared Knowledge Graph so the same
 * facts compound across agents instead of living in private state.
 */
const fs = require("fs");
const path = require("path");
const { loadAllExecutions, defaultDateRangeDays } = require("./generate-sql");
const { loadMandatoryStepIndex, mandatoryMetaForCard } = require("./dashboard-stats");
const { defaultProjectRoot } = require("./documents");
const kg = require("../shared/knowledge-graph");
const workbookStore = require("./workbook");

const MIN_SAMPLE = 3;
const HIGH_RISK_RATE = 0.35;
const MEDIUM_RISK_RATE = 0.15;
const PATTERN_MIN_SAMPLE = 5;
const PATTERN_DOMINANCE = 0.6;

function reportPath() {
  return workbookStore.workbookPath();
}

function groupRunsBySop(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = String(run.queue_card_id || run.queue_card || "(unknown)");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  return groups;
}

/** Failure Prediction Agent — historical mistake rate per card/SOP. */
function computeFailurePrediction(groups, stepIndex) {
  const findings = [];
  for (const [cardKey, runs] of groups) {
    if (runs.length < MIN_SAMPLE) continue;
    const meta = mandatoryMetaForCard(stepIndex, cardKey);
    const withMistakes = runs.filter((r) => (r.mistakes || []).length > 0).length;
    const rate = withMistakes / runs.length;
    if (rate < MEDIUM_RISK_RATE) continue;

    const fieldCounts = new Map();
    for (const run of runs) {
      for (const m of run.mistakes || []) {
        const key = m.label || m.field_key || m.step_id || "field";
        fieldCounts.set(key, (fieldCounts.get(key) || 0) + 1);
      }
    }
    const topFields = [...fieldCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label, count]) => ({ label, count }));

    findings.push({
      cardKey,
      sampleSize: runs.length,
      mistakeRate: Math.round(rate * 100) / 100,
      riskLevel: rate >= HIGH_RISK_RATE ? "high" : "medium",
      topFields,
      mandatoryFieldCount: meta?.keys?.size || 0,
    });
  }
  findings.sort((a, b) => b.mistakeRate - a.mistakeRate);
  return findings;
}

/** Process Drift Agent — declared SOP steps vs. what actually gets filled. */
function computeDriftDetection(groups, stepIndex) {
  const findings = [];
  for (const [cardKey, runs] of groups) {
    if (runs.length < MIN_SAMPLE) continue;
    const meta = mandatoryMetaForCard(stepIndex, cardKey);
    if (!meta?.keys?.size) continue;

    const declared = new Set(meta.keys);
    const filledCounts = new Map();
    const undeclared = new Map();

    for (const run of runs) {
      const answers = run.answers || {};
      for (const key of Object.keys(answers)) {
        if (answers[key] == null || String(answers[key]).trim() === "") continue;
        if (declared.has(key)) {
          filledCounts.set(key, (filledCounts.get(key) || 0) + 1);
        } else if (!["pageUrl", "formPageUrl", "jiraKey", "formReference"].includes(key)) {
          undeclared.set(key, (undeclared.get(key) || 0) + 1);
        }
      }
    }

    const unusedSteps = [...declared].filter((key) => !(filledCounts.get(key) > 0));
    const undeclaredFields = [...undeclared.entries()]
      .filter(([, count]) => count / runs.length >= 0.5)
      .map(([key, count]) => ({ key, occurrence: Math.round((count / runs.length) * 100) }));

    if (!unusedSteps.length && !undeclaredFields.length) continue;
    findings.push({
      cardKey,
      sampleSize: runs.length,
      unusedSteps: unusedSteps.map((key) => meta.labels.get(key) || key),
      undeclaredFields,
    });
  }
  return findings;
}

/** Expert Pattern Discovery Agent — common values on successful (mistake-free) runs. */
function computeExpertPatterns(groups) {
  const findings = [];
  for (const [cardKey, runs] of groups) {
    const clean = runs.filter((r) => (r.mistakes || []).length === 0 && r.answers);
    if (clean.length < PATTERN_MIN_SAMPLE) continue;

    const valuesByField = new Map();
    for (const run of clean) {
      for (const [key, value] of Object.entries(run.answers || {})) {
        const v = String(value ?? "").trim();
        if (!v || v.length > 60) continue; // skip free-text/long fields
        if (!valuesByField.has(key)) valuesByField.set(key, new Map());
        const counts = valuesByField.get(key);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
    }

    const patterns = [];
    for (const [field, counts] of valuesByField) {
      if ([...counts.values()].reduce((a, b) => a + b, 0) < PATTERN_MIN_SAMPLE) continue;
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      const [topValue, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      const dominance = topCount / total;
      if (dominance < PATTERN_DOMINANCE || counts.size < 2) continue;
      patterns.push({
        field,
        suggestedDefault: topValue,
        dominance: Math.round(dominance * 100),
        sampleSize: total,
      });
    }
    if (patterns.length) findings.push({ cardKey, patterns });
  }
  return findings;
}

/** Process Optimization Agent — turns findings into SME-reviewable prose suggestions. Never auto-applied. */
function computeOptimizationSuggestions({ failures, drifts, patterns }) {
  const suggestions = [];

  for (const f of failures) {
    const fields = f.topFields.map((x) => x.label).join(", ") || "several fields";
    suggestions.push({
      cardKey: f.cardKey,
      kind: "failure",
      severity: f.riskLevel,
      text: `${Math.round(f.mistakeRate * 100)}% of the last ${f.sampleSize} runs had a mistake on: ${fields}. Consider adding inline help text or allowedValues validation for these fields.`,
    });
  }

  for (const d of drifts) {
    if (d.unusedSteps.length) {
      suggestions.push({
        cardKey: d.cardKey,
        kind: "drift",
        severity: "low",
        text: `Step(s) "${d.unusedSteps.join(", ")}" are declared mandatory but were never filled across ${d.sampleSize} runs — consider making them optional or removing them.`,
      });
    }
    for (const u of d.undeclaredFields) {
      suggestions.push({
        cardKey: d.cardKey,
        kind: "drift",
        severity: "medium",
        text: `Field "${u.key}" appears in ${u.occurrence}% of executions but isn't part of the SOP — consider adding it as a declared step.`,
      });
    }
  }

  for (const p of patterns) {
    for (const pat of p.patterns) {
      suggestions.push({
        cardKey: p.cardKey,
        kind: "pattern",
        severity: "info",
        text: `Field "${pat.field}" is set to "${pat.suggestedDefault}" in ${pat.dominance}% of successful runs (n=${pat.sampleSize}) — consider it as the default value.`,
      });
    }
  }

  return suggestions;
}

async function updateKnowledgeGraph({ failures, drifts, patterns }) {
  const projectRoot = defaultProjectRoot();
  const graph = await kg.loadGraph(projectRoot);

  for (const f of failures) {
    const proc = kg.upsertNode(graph, "process", f.cardKey, { label: f.cardKey });
    const risk = kg.upsertNode(graph, "risk", f.cardKey, {
      riskLevel: f.riskLevel,
      mistakeRate: f.mistakeRate,
      sampleSize: f.sampleSize,
      topFields: f.topFields,
    });
    kg.upsertEdge(graph, proc.id, "at_risk", risk.id);
  }

  for (const d of drifts) {
    const proc = kg.upsertNode(graph, "process", d.cardKey, { label: d.cardKey });
    const drift = kg.upsertNode(graph, "drift", d.cardKey, {
      unusedSteps: d.unusedSteps,
      undeclaredFields: d.undeclaredFields,
    });
    kg.upsertEdge(graph, proc.id, "has_drift", drift.id);
  }

  for (const p of patterns) {
    const proc = kg.upsertNode(graph, "process", p.cardKey, { label: p.cardKey });
    for (const pat of p.patterns) {
      const patternNode = kg.upsertNode(graph, "pattern", `${p.cardKey}:${pat.field}`, {
        field: pat.field,
        suggestedDefault: pat.suggestedDefault,
        dominance: pat.dominance,
        sampleSize: pat.sampleSize,
      });
      kg.upsertEdge(graph, proc.id, "common_value", patternNode.id);
    }
  }

  await kg.saveGraph(projectRoot, graph);
  return kg.summarize(graph);
}

/** Runs all four Process Intelligence agents over recent execution history and persists a report. */
async function runProcessIntelligence({ days = 30, executionsRoot } = {}) {
  const range = defaultDateRangeDays(days);
  const { runs } = await loadAllExecutions({
    includeAnswers: true,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    executionsRoot,
  });
  const stepIndex = loadMandatoryStepIndex();
  const groups = groupRunsBySop(runs);

  const failures = computeFailurePrediction(groups, stepIndex);
  const drifts = computeDriftDetection(groups, stepIndex);
  const patterns = computeExpertPatterns(groups);
  const optimizationSuggestions = computeOptimizationSuggestions({
    failures,
    drifts,
    patterns,
  });
  const knowledgeGraph = await updateKnowledgeGraph({ failures, drifts, patterns });

  const report = {
    generatedAt: new Date().toISOString(),
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    sampleRuns: runs.length,
    failures,
    drifts,
    patterns,
    optimizationSuggestions,
    knowledgeGraph,
  };
  const projectRoot = defaultProjectRoot();
  const { PiReports, PiFindings } = await workbookStore.readTables(
    ["PiReports", "PiFindings"],
    projectRoot
  );
  await workbookStore.replaceRows(
    "PiReports",
    [
      ...(PiReports || []),
      {
        generatedAt: report.generatedAt,
        dateFrom: report.dateFrom,
        dateTo: report.dateTo,
        sampleRuns: String(report.sampleRuns),
        payload_json: workbookStore.jsonCell(report),
      },
    ],
    projectRoot
  );
  const findingRows = [
    ...failures.map((f) => ({
      generatedAt: report.generatedAt,
      kind: "failure",
      cardKey: f.cardKey,
      payload_json: workbookStore.jsonCell(f),
    })),
    ...drifts.map((d) => ({
      generatedAt: report.generatedAt,
      kind: "drift",
      cardKey: d.cardKey,
      payload_json: workbookStore.jsonCell(d),
    })),
    ...patterns.map((p) => ({
      generatedAt: report.generatedAt,
      kind: "pattern",
      cardKey: p.cardKey,
      payload_json: workbookStore.jsonCell(p),
    })),
    ...optimizationSuggestions.map((s) => ({
      generatedAt: report.generatedAt,
      kind: "optimization",
      cardKey: s.cardKey,
      payload_json: workbookStore.jsonCell(s),
    })),
  ];
  await workbookStore.replaceRows(
    "PiFindings",
    [...(PiFindings || []), ...findingRows],
    projectRoot
  );
  return report;
}

async function loadLatestReport() {
  const { PiReports } = await workbookStore.readTables(["PiReports"]);
  if (!PiReports?.length) return null;
  const last = PiReports[PiReports.length - 1];
  const parsed = workbookStore.parseJsonCell(last.payload_json);
  return parsed && typeof parsed === "object" ? parsed : null;
}

/** Quick lookup used by the queue UI to flag a specific card as at-risk before the user starts. */
async function riskForCard(cardKey) {
  const report = await loadLatestReport();
  if (!report) return null;
  return report.failures.find((f) => f.cardKey === cardKey) || null;
}

module.exports = {
  reportPath,
  runProcessIntelligence,
  loadLatestReport,
  riskForCard,
  computeFailurePrediction,
  computeDriftDetection,
  computeExpertPatterns,
  computeOptimizationSuggestions,
};
