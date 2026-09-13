const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts } = require("pdf-lib");

function fileUrlToPath(urlOrPath) {
  const raw = String(urlOrPath || "").trim();
  if (!raw) return null;
  if (raw.startsWith("file://")) {
    try {
      let p = raw.replace(/^file:\/\//, "");
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
      return decodeURIComponent(p);
    } catch {
      return raw.replace(/^file:\/\//, "");
    }
  }
  return raw;
}

function isPdfPath(urlOrPath) {
  const p = fileUrlToPath(urlOrPath) || "";
  return /\.pdf$/i.test(p.split("?")[0] || "");
}

function isAuxPdfName(name) {
  return /\.(filled|blank|cleared|source)\.pdf$/i.test(name);
}

function baseName(pdfPath) {
  return path
    .basename(pdfPath, path.extname(pdfPath))
    .replace(/\.(filled|blank|cleared|source)$/i, "");
}

function sourcePdfPath(pdfPath) {
  return path.join(path.dirname(pdfPath), `${baseName(pdfPath)}.source.pdf`);
}

function blankTemplatePath(pdfPath) {
  return path.join(path.dirname(pdfPath), `${baseName(pdfPath)}.blank.pdf`);
}

function workingPdfPath(pdfPath) {
  return path.join(path.dirname(pdfPath), `${baseName(pdfPath)}.filled.pdf`);
}

function resolvePdfPath(card, sop) {
  const candidates = [
    card?.pdfPath,
    sop?.pdfPath,
    ...(isPdfPath(card?.formUrl) ? [card.formUrl] : []),
    ...(isPdfPath(sop?.formUrl) ? [sop.formUrl] : []),
    ...(Array.isArray(card?.documents) ? card.documents.map((d) => d.path || d.absolutePath) : []),
  ];
  for (const c of candidates) {
    const p = fileUrlToPath(c);
    if (p && isPdfPath(p) && fs.existsSync(p) && !isAuxPdfName(path.basename(p))) return p;
  }
  if (card?.sourceDir && fs.existsSync(card.sourceDir)) {
    for (const name of fs.readdirSync(card.sourceDir)) {
      if (!name.toLowerCase().endsWith(".pdf") || isAuxPdfName(name)) continue;
      return path.join(card.sourceDir, name);
    }
  }
  return null;
}

function resolveFieldValue(step, data) {
  if (step.value != null && step.value !== "") return String(step.value);
  if (step.valueFrom != null && data && Object.prototype.hasOwnProperty.call(data, step.valueFrom)) {
    const v = data[step.valueFrom];
    if (Array.isArray(v)) return v.length ? String(v[0]) : "";
    if (v == null) return "";
    return String(v);
  }
  return "";
}

function pdfFieldNamesForStep(step) {
  const names = [];
  if (step.pdfField) {
    names.push(...(Array.isArray(step.pdfField) ? step.pdfField : [step.pdfField]));
  }
  if (step.selector && String(step.selector).startsWith("pdf:")) {
    names.push(String(step.selector).slice(4));
  }
  if (step.valueFrom) {
    names.push(
      step.valueFrom,
      String(step.valueFrom)
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
    );
  }
  if (step.id) names.push(step.id, String(step.id).replace(/-/g, "_"));
  // Generic fallbacks from human labels (no SOP change required)
  if (step.label) {
    const cleaned = String(step.label)
      .replace(/\*/g, "")
      .replace(/\([^)]*\)/g, "")
      .trim()
      .toLowerCase();
    const underscored = cleaned.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (underscored) names.push(underscored);
    const compact = cleaned.replace(/[^a-z0-9]+/g, "");
    if (compact) names.push(compact);
  }
  if (Array.isArray(step.findByLabel)) {
    for (const lab of step.findByLabel) {
      const underscored = String(lab)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      if (underscored) names.push(underscored);
    }
  }
  return [...new Set(names.map((n) => String(n || "").trim()).filter(Boolean))];
}

function findFormField(form, candidates) {
  const fields = form.getFields();
  const byName = new Map(fields.map((f) => [f.getName(), f]));
  for (const name of candidates) {
    if (byName.has(name)) return byName.get(name);
  }
  const norm = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, "");
  const normalized = new Map(fields.map((f) => [norm(f.getName()), f]));
  for (const name of candidates) {
    const hit = normalized.get(norm(name));
    if (hit) return hit;
  }
  return null;
}

async function clearAllFields(form) {
  for (const field of form.getFields()) {
    try {
      const typeName = field.constructor?.name || "";
      if (typeName.includes("CheckBox") && typeof field.uncheck === "function") {
        field.uncheck();
      } else if (typeof field.setText === "function") {
        field.setText("");
      } else if (typeof field.clear === "function") {
        field.clear();
      }
    } catch {
      /* skip */
    }
  }
}

async function loadDoc(pdfPath) {
  const bytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  return { pdfDoc, form, font };
}

async function saveWithAppearances(pdfDoc, form, font, outPath) {
  try {
    form.updateFieldAppearances(font);
  } catch {
    try {
      form.updateFieldAppearances();
    } catch {
      /* values still stored */
    }
  }
  fs.writeFileSync(outPath, await pdfDoc.save());
}

/**
 * Immutable original + truly empty blank (source PDFs often already contain sample values).
 */
async function ensureSourceAndBlank(pdfPath) {
  const source = sourcePdfPath(pdfPath);
  if (!fs.existsSync(source)) {
    // Prefer a never-touched original if present; else snapshot current file.
    const candidate = fs.existsSync(pdfPath) ? pdfPath : null;
    if (!candidate) throw new Error("pdf_missing");
    fs.copyFileSync(candidate, source);
  }
  const blank = blankTemplatePath(pdfPath);
  const { pdfDoc, form, font } = await loadDoc(source);
  await clearAllFields(form);
  await saveWithAppearances(pdfDoc, form, font, blank);
  return { source, blank };
}

async function fillPdfForm({ pdfPath, sop, data, onStep }) {
  const { blank } = await ensureSourceAndBlank(pdfPath);
  const steps = Array.isArray(sop?.steps) ? sop.steps : [];
  const results = [];
  const { pdfDoc, form, font } = await loadDoc(blank);

  for (const step of steps) {
    const action = step.action || "fill";
    if (action === "highlight" || action === "wait") {
      onStep?.({ stepId: step.id, status: "done", label: step.label });
      results.push({ id: step.id, ok: true, skipped: true });
      continue;
    }

    const candidates = pdfFieldNamesForStep(step);
    const field = findFormField(form, candidates);
    if (!field) {
      onStep?.({
        stepId: step.id,
        status: "error",
        label: step.label,
        error: `PDF field not found (${candidates.join(", ") || "no name"})`,
      });
      results.push({ id: step.id, ok: false, error: "field_missing" });
      continue;
    }

    try {
      const typeName = field.constructor?.name || "";
      if (action === "check" || typeName.includes("CheckBox")) {
        if (typeof field.check === "function") field.check();
        else if (typeof field.select === "function") field.select(field.getOptions?.()?.[0] || "Yes");
      } else if (typeName.includes("Dropdown") || typeName.includes("RadioGroup")) {
        const value = resolveFieldValue(step, data);
        if (value && typeof field.select === "function") field.select(value);
      } else {
        const value = resolveFieldValue(step, data);
        if (typeof field.setText === "function") field.setText(value);
        else if (typeof field.select === "function" && value) field.select(value);
      }
      onStep?.({ stepId: step.id, status: "done", label: step.label, field: field.getName() });
      results.push({ id: step.id, ok: true, field: field.getName() });
    } catch (err) {
      onStep?.({
        stepId: step.id,
        status: "error",
        label: step.label,
        error: err.message || String(err),
      });
      results.push({ id: step.id, ok: false, error: err.message || String(err) });
    }
  }

  const outPath = workingPdfPath(pdfPath);
  await saveWithAppearances(pdfDoc, form, font, outPath);

  return {
    ok: results.every((r) => r.ok),
    pdfPath,
    outPath,
    results,
  };
}

async function clearPdfForm({ pdfPath, sop, onStep }) {
  const { blank } = await ensureSourceAndBlank(pdfPath);
  const outPath = workingPdfPath(pdfPath);
  fs.copyFileSync(blank, outPath);

  for (const step of sop?.steps || []) {
    onStep?.({ stepId: step.id, status: "pending", label: step.label });
  }

  return { ok: true, pdfPath, outPath, restoredFromBlank: true };
}

async function applyPdfStep({ pdfPath, step, data = {}, valueOverride, onStep }) {
  if (!step) return { ok: false, error: "step_missing" };

  await ensureSourceAndBlank(pdfPath);
  const working = workingPdfPath(pdfPath);
  const loadFrom = fs.existsSync(working) ? working : blankTemplatePath(pdfPath);
  const { pdfDoc, form, font } = await loadDoc(loadFrom);

  const useData = { ...(data && typeof data === "object" ? data : {}) };
  if (valueOverride != null && valueOverride !== "") {
    if (step.valueFrom) useData[step.valueFrom] = valueOverride;
  }

  const action = step.action || "fill";
  if (action === "highlight" || action === "wait") {
    onStep?.({ stepId: step.id, status: "done", label: step.label });
    return { ok: true, outPath: working, skipped: true };
  }

  const candidates = pdfFieldNamesForStep(step);
  const field = findFormField(form, candidates);
  if (!field) {
    const err = `PDF field not found (${candidates.join(", ") || step.id})`;
    onStep?.({ stepId: step.id, status: "error", label: step.label, error: err });
    return { ok: false, error: err, outPath: working };
  }

  try {
    const typeName = field.constructor?.name || "";
    const override =
      valueOverride != null && valueOverride !== "" ? String(valueOverride) : null;

    if (action === "check" || typeName.includes("CheckBox")) {
      const truthy =
        override == null ||
        /^(1|true|yes|on|checked|x)$/i.test(override.trim());
      if (truthy) {
        if (typeof field.check === "function") field.check();
        else if (typeof field.select === "function") field.select(field.getOptions?.()?.[0] || "Yes");
      } else if (typeof field.uncheck === "function") {
        field.uncheck();
      }
    } else if (typeName.includes("Dropdown") || typeName.includes("RadioGroup")) {
      const value = override || resolveFieldValue(step, useData);
      if (value && typeof field.select === "function") field.select(value);
    } else {
      const value = override || resolveFieldValue(step, useData);
      if (typeof field.setText === "function") field.setText(value);
      else if (typeof field.select === "function" && value) field.select(value);
    }

    await saveWithAppearances(pdfDoc, form, font, working);
    onStep?.({ stepId: step.id, status: "done", label: step.label, field: field.getName() });
    return { ok: true, outPath: working, field: field.getName() };
  } catch (err) {
    onStep?.({
      stepId: step.id,
      status: "error",
      label: step.label,
      error: err.message || String(err),
    });
    return { ok: false, error: err.message || String(err), outPath: working };
  }
}

function cardPrefersPdf(card, sop) {
  const pdfPath = resolvePdfPath(card, sop);
  if (!pdfPath) return { prefer: false, pdfPath: null };
  const hasHtmlSelectors = (sop?.steps || []).some(
    (s) => s.selector && !String(s.selector).startsWith("pdf:")
  );
  // Dual-mode SOP (New Hire HTML + PDF): do not force PDF fill
  if (hasHtmlSelectors) {
    return { prefer: false, pdfPath };
  }
  const formUrl = String(card?.formUrl || sop?.formUrl || "");
  if (/127\.0\.0\.1:17322\/pdf\//i.test(formUrl)) {
    return { prefer: true, pdfPath };
  }
  if (
    sop?.targetType === "pdf" ||
    isPdfPath(card?.formUrl) ||
    isPdfPath(sop?.formUrl) ||
    Boolean(sop?.pdfPath) ||
    Boolean(card?.pdfPath)
  ) {
    return { prefer: true, pdfPath };
  }
  if (
    (sop?.steps || []).some(
      (s) => s.pdfField || String(s.selector || "").startsWith("pdf:")
    )
  ) {
    return { prefer: true, pdfPath };
  }
  return { prefer: false, pdfPath };
}

module.exports = {
  isPdfPath,
  fileUrlToPath,
  resolvePdfPath,
  fillPdfForm,
  clearPdfForm,
  applyPdfStep,
  workingPdfPath,
  blankTemplatePath,
  sourcePdfPath,
  ensureSourceAndBlank,
  cardPrefersPdf,
};
