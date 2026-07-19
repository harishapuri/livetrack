const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const rawText = document.getElementById("rawText");
const sopId = document.getElementById("sopId");
const sopName = document.getElementById("sopName");
const formUrl = document.getElementById("formUrl");
const sopDesc = document.getElementById("sopDesc");
const btnConvert = document.getElementById("btnConvert");
const btnClear = document.getElementById("btnClear");
const btnAddStep = document.getElementById("btnAddStep");
const btnSave = document.getElementById("btnSave");
const btnDownload = document.getElementById("btnDownload");
const extractStatus = document.getElementById("extractStatus");
const saveStatus = document.getElementById("saveStatus");
const stepsList = document.getElementById("stepsList");
const jsonPreview = document.getElementById("jsonPreview");
const existingList = document.getElementById("existingList");

/** @type {Array<Record<string, string>>} */
let steps = [];

function apiBase() {
  if (location.protocol === "http:" || location.protocol === "https:") return "";
  return "http://127.0.0.1:4175";
}

function apiUrl(path) {
  return `${apiBase()}${path.startsWith("/") ? path : `/${path}`}`;
}

function setStatus(el, msg, kind = "") {
  el.textContent = msg || "";
  el.className = `status${kind ? ` ${kind}` : ""}`;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function camelCase(value) {
  const parts = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "value";
  return parts
    .map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join("");
}

const ACTION_VERBS =
  "fill|enter|type|input|provide|write|set|click|press|tap|open|navigate|check|tick|toggle|highlight|select|submit|upload|choose|verify|review|wait|pause";

const SKIP_LINE =
  /^(title|agenda|overview|thank|thanks|questions|appendix|contents|toc|sop|procedure|process|steps?|instructions?|how to|demo|liveact)\b/i;

function guessAction(line) {
  const t = line.toLowerCase();
  if (/\b(highlight|review visually|confirm visually)\b/.test(t)) return "highlight";
  if (/\b(check|tick|toggle|enable checkbox)\b/.test(t)) return "check";
  if (/\b(wait|pause)\b/.test(t)) return "wait";
  if (/\b(click|press|tap|open|navigate)\b/.test(t)) return "click";
  if (/\b(fill|enter|type|input|provide|write|set)\b/.test(t)) return "fill";
  if (/\bsubmit\b/.test(t) && !/\b(fill|enter|type)\b/.test(t)) return "click";
  return "fill";
}

function cleanLabel(line) {
  let out = String(line || "")
    .replace(/^\s*(?:step\s*)?\d+[.)\-:]?\s*/i, "")
    .replace(/^\s*[-*•▪◦]\s*/, "")
    .trim();
  const verb = out.match(
    new RegExp(`^(${ACTION_VERBS})\\s*:?\\s+(.+)$`, "i")
  );
  if (verb && verb[2]) out = verb[2];
  return out.replace(/\s+/g, " ").trim();
}

function parseStructuredLine(line) {
  // action=fill | label=Company | selector=#company | valueFrom=companyName
  if (!/[|=]/.test(line) || !/\baction\b/i.test(line)) return null;
  const parts = {};
  for (const chunk of line.split(/[|]/)) {
    const m = chunk.match(/^\s*([a-zA-Z]+)\s*[:=]\s*(.+?)\s*$/);
    if (m) parts[m[1].toLowerCase()] = m[2].trim();
  }
  if (!parts.action && !parts.label) return null;
  const action = (parts.action || guessAction(line)).toLowerCase();
  const label = parts.label || cleanLabel(line) || "Step";
  const id = slugify(parts.id || label) || `step-${Date.now()}`;
  const step = { id, action, label };
  if (parts.selector) step.selector = parts.selector;
  if (parts.valuefrom || parts.valueFrom) step.valueFrom = parts.valuefrom || parts.valueFrom;
  if (parts.value) step.value = parts.value;
  if (parts.findbytext) step.findByText = parts.findbytext;
  if (parts.findbylabel) step.findByLabel = parts.findbylabel;
  if (action === "fill" && !step.valueFrom && !step.value) {
    step.valueFrom = camelCase(label);
  }
  if ((action === "click" || action === "check") && !step.selector && !step.findByText) {
    step.findByText = label;
  }
  return step;
}

/** PPT/PDF often returns one blob — split inline "1. … 2. …" into lines. */
function normalizeExtractedText(text) {
  let t = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // "1. Foo 2. Bar 3. Baz" or "Step 1: Foo Step 2: Bar"
  t = t.replace(/(?:^|\s)(?=(?:step\s*)?\d{1,2}\s*[.)\-:]\s+\S)/gi, "\n");
  // Bullet glyphs jammed together
  t = t.replace(/\s*[•▪◦]\s*/g, "\n• ");
  // Action verbs mid-blob: "... name Fill email Click Accept"
  t = t.replace(
    new RegExp(`(?<=[a-z0-9)\\]"'])\\s+(?=(?:${ACTION_VERBS})\\b)`, "gi"),
    "\n"
  );

  return t
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function isStepish(line) {
  if (!line || line.length < 2 || line.length > 240) return false;
  if (SKIP_LINE.test(line) && line.length < 40) return false;
  if (/^(?:step\s*)?\d{1,2}\s*[.)\-:]\s+\S/i.test(line)) return true;
  if (/^[-*•▪◦]\s+\S/.test(line)) return true;
  if (new RegExp(`^(?:${ACTION_VERBS})\\b`, "i").test(line)) return true;
  if (new RegExp(`\\b(?:${ACTION_VERBS})\\b`, "i").test(line) && line.length < 120) return true;
  // Field-like labels from forms/decks: "Company name", "Email address"
  if (/^[A-Z][\w\s/&'-]{1,60}$/.test(line) && !/[.!?]$/.test(line)) return true;
  return false;
}

function extractStepLines(text) {
  const normalized = normalizeExtractedText(text);
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

  const numbered = lines.filter(
    (l) => /^(?:step\s*)?\d{1,2}\s*[.)\-:]\s+\S/i.test(l) || /^[-*•▪◦]\s+\S/.test(l)
  );
  if (numbered.length >= 1) return numbered;

  const imperative = lines.filter(isStepish);
  if (imperative.length >= 1) return imperative;

  // Last resort: keep short non-title lines
  return lines.filter((l) => l.length > 2 && l.length < 160 && !SKIP_LINE.test(l)).slice(0, 50);
}

function lineToStep(line, usedIds, index) {
  const structured = parseStructuredLine(line);
  if (structured) {
    let id = structured.id;
    let n = 2;
    while (usedIds.has(id)) id = `${structured.id}-${n++}`;
    structured.id = id;
    return structured;
  }

  const action = guessAction(line);
  let label = cleanLabel(line) || line;
  if (!label) return null;

  const clickMatch = line.match(
    /^\s*(?:step\s*)?\d*[.)\-:]*\s*(?:click|press|tap)\s+(.+)$/i
  );
  if (action === "click" && clickMatch) label = clickMatch[1].trim();

  let id = slugify(label) || `step-${index + 1}`;
  let n = 2;
  while (usedIds.has(id)) id = `${slugify(label)}-${n++}`;

  const step = { id, action, label };
  if (action === "fill") {
    step.valueFrom = camelCase(label);
    const sel = label.match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/);
    if (sel) step.selector = sel[0];
  }
  if (action === "click" || action === "check") {
    step.findByText = label.replace(/^["']|["']$/g, "");
  }
  if (action === "highlight") {
    step.selector = step.selector || "#submitBtn";
  }
  return step;
}

function textToSteps(text) {
  const lines = extractStepLines(text);
  const out = [];
  const usedIds = new Set();

  for (const line of lines) {
    const step = lineToStep(line, usedIds, out.length);
    if (!step) continue;
    // Drop near-duplicates
    if (out.some((s) => s.label.toLowerCase() === step.label.toLowerCase() && s.action === step.action)) {
      continue;
    }
    usedIds.add(step.id);
    out.push(step);
  }
  return out;
}

function buildSop() {
  const id = slugify(sopId.value) || "imported-sop";
  const name = sopName.value.trim() || id;
  const description = sopDesc.value.trim() || `Imported SOP: ${name}`;
  const sop = {
    id,
    name,
    description,
    steps: steps.map((s) => {
      const step = {
        id: slugify(s.id) || camelCase(s.label),
        action: s.action || "fill",
        label: s.label || s.id,
      };
      if (s.selector) step.selector = s.selector;
      if (s.valueFrom) step.valueFrom = s.valueFrom;
      if (s.value) step.value = s.value;
      if (s.findByText) {
        step.findByText = Array.isArray(s.findByText)
          ? s.findByText
          : String(s.findByText)
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
      }
      if (s.findByLabel) {
        step.findByLabel = Array.isArray(s.findByLabel)
          ? s.findByLabel
          : String(s.findByLabel)
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
      }
      if (s.mandatory === "true" || s.mandatory === true) step.mandatory = true;
      if (s.optional === "true" || s.optional === true) step.optional = true;
      return step;
    }),
  };
  if (formUrl.value.trim()) sop.formUrl = formUrl.value.trim();
  return sop;
}

function refreshPreview() {
  const sop = buildSop();
  jsonPreview.textContent = JSON.stringify(sop, null, 2);
  const ready = steps.length > 0;
  btnSave.disabled = !ready;
  btnDownload.disabled = !ready;
}

function renderSteps() {
  stepsList.innerHTML = "";
  if (!steps.length) {
    stepsList.innerHTML = `<p class="hint">No steps yet — convert extracted text or add steps manually.</p>`;
    refreshPreview();
    return;
  }

  steps.forEach((step, index) => {
    const row = document.createElement("div");
    row.className = "step-row";
    row.innerHTML = `
      <div class="num">#${index + 1}</div>
      <select data-k="action" title="action">
        ${["fill", "click", "check", "highlight", "wait"]
          .map((a) => `<option value="${a}" ${step.action === a ? "selected" : ""}>${a}</option>`)
          .join("")}
      </select>
      <input data-k="label" value="${escapeAttr(step.label || "")}" placeholder="label" />
      <button type="button" class="ghost" data-remove="${index}" title="Remove">✕</button>
      <input class="wide" data-k="id" value="${escapeAttr(step.id || "")}" placeholder="id" />
      <input class="wide" data-k="selector" value="${escapeAttr(step.selector || "")}" placeholder="selector (optional)" />
      <input class="wide" data-k="valueFrom" value="${escapeAttr(step.valueFrom || "")}" placeholder="valueFrom (for fill)" />
      <input class="wide" data-k="findByText" value="${escapeAttr(
        Array.isArray(step.findByText) ? step.findByText.join(", ") : step.findByText || ""
      )}" placeholder="findByText (for click)" />
    `;
    row.querySelectorAll("[data-k]").forEach((el) => {
      el.addEventListener("input", () => {
        steps[index][el.getAttribute("data-k")] = el.value;
        refreshPreview();
      });
      el.addEventListener("change", () => {
        steps[index][el.getAttribute("data-k")] = el.value;
        refreshPreview();
      });
    });
    row.querySelector("[data-remove]").addEventListener("click", () => {
      steps.splice(index, 1);
      renderSteps();
    });
    stepsList.appendChild(row);
  });
  refreshPreview();
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

async function extractPdf(buffer) {
  const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let currentY = null;
    let current = [];
    for (const item of content.items) {
      const str = item.str || "";
      if (!str.trim()) continue;
      const y = item.transform ? item.transform[5] : null;
      if (currentY != null && y != null && Math.abs(currentY - y) > 2) {
        const line = current.join(" ").replace(/\s+/g, " ").trim();
        if (line) lines.push(line);
        current = [str];
        currentY = y;
      } else {
        current.push(str);
        if (y != null) currentY = y;
      }
    }
    const last = current.join(" ").replace(/\s+/g, " ").trim();
    if (last) lines.push(last);
    pages.push(lines.join("\n"));
  }
  return pages.join("\n");
}

async function extractDocx(buffer) {
  const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value || "";
}

function xmlParagraphs(xml) {
  const paragraphs = [];
  const paraRe = /<a:p[\s>][\s\S]*?<\/a:p>/gi;
  let para;
  while ((para = paraRe.exec(xml))) {
    const texts = [];
    const textRe = /<a:t[^>]*>([^<]*)<\/a:t>/g;
    let m;
    while ((m = textRe.exec(para[0]))) {
      if (m[1]) texts.push(m[1]);
    }
    const line = texts.join("").replace(/\s+/g, " ").trim();
    if (line) paragraphs.push(line);
  }
  if (paragraphs.length) return paragraphs;
  // Fallback: all text runs
  const texts = [];
  const re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1]) texts.push(m[1]);
  }
  const joined = texts.join(" ").replace(/\s+/g, " ").trim();
  return joined ? [joined] : [];
}

async function extractPptx(buffer) {
  const zip = await window.JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)/i)?.[1] || 0);
      return na - nb;
    });

  const chunks = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    const paras = xmlParagraphs(xml);
    if (paras.length) chunks.push(paras.join("\n"));
  }

  const noteNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/notesSlide(\d+)/i)?.[1] || 0);
      const nb = Number(b.match(/notesSlide(\d+)/i)?.[1] || 0);
      return na - nb;
    });
  for (const name of noteNames) {
    const xml = await zip.files[name].async("string");
    const paras = xmlParagraphs(xml);
    if (paras.length) chunks.push(paras.join("\n"));
  }

  return chunks.join("\n");
}

async function extractTextFromFile(file) {
  const name = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();

  if (name.endsWith(".pdf")) return extractPdf(new Uint8Array(buffer));
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    if (name.endsWith(".doc") && !name.endsWith(".docx")) {
      throw new Error("Legacy .doc is not supported — save as .docx and try again.");
    }
    return extractDocx(buffer);
  }
  if (name.endsWith(".pptx") || name.endsWith(".ppt")) {
    if (name.endsWith(".ppt") && !name.endsWith(".pptx")) {
      throw new Error("Legacy .ppt is not supported — save as .pptx and try again.");
    }
    return extractPptx(buffer);
  }
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return new TextDecoder().decode(buffer);
  }
  throw new Error("Unsupported file type. Use .pptx, .pdf, .docx, or .txt");
}

function suggestMetaFromFile(file, text) {
  const base = file.name.replace(/\.[^.]+$/, "");
  if (!sopId.value) sopId.value = slugify(base) || "imported-sop";
  if (!sopName.value) sopName.value = base.replace(/[-_]+/g, " ").trim();
  if (!sopDesc.value) {
    const first = String(text || "").split(/\n/).map((l) => l.trim()).find(Boolean);
    sopDesc.value = first ? first.slice(0, 140) : `SOP imported from ${file.name}`;
  }
}

async function handleFile(file) {
  if (!file) return;
  fileName.textContent = file.name;
  setStatus(extractStatus, "Extracting text…");
  btnConvert.disabled = true;
  try {
    const text = await extractTextFromFile(file);
    rawText.value = normalizeExtractedText(text);
    suggestMetaFromFile(file, text);
    btnConvert.disabled = !rawText.value.trim();
    setStatus(
      extractStatus,
      `Extracted ${rawText.value.length.toLocaleString()} characters. Review text, then Convert.`,
      "ok"
    );
  } catch (err) {
    setStatus(extractStatus, err.message || String(err), "err");
    btnConvert.disabled = true;
  }
}

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer?.files?.[0];
  handleFile(file);
});
fileInput.addEventListener("change", () => handleFile(fileInput.files?.[0]));

rawText.addEventListener("input", () => {
  btnConvert.disabled = !rawText.value.trim();
});

btnConvert.addEventListener("click", () => {
  rawText.value = normalizeExtractedText(rawText.value);
  steps = textToSteps(rawText.value);
  if (!steps.length) {
    setStatus(
      extractStatus,
      "Could not detect steps. Put one step per line (e.g. “1. Click Accept” or “Fill email”), then Convert again.",
      "err"
    );
  } else {
    setStatus(extractStatus, `Converted ${steps.length} steps.`, "ok");
  }
  renderSteps();
});

btnClear.addEventListener("click", () => {
  fileInput.value = "";
  fileName.textContent = "No file selected";
  rawText.value = "";
  sopId.value = "";
  sopName.value = "";
  formUrl.value = "";
  sopDesc.value = "";
  steps = [];
  btnConvert.disabled = true;
  setStatus(extractStatus, "");
  setStatus(saveStatus, "");
  renderSteps();
});

btnAddStep.addEventListener("click", () => {
  const n = steps.length + 1;
  steps.push({
    id: `step-${n}`,
    action: "fill",
    label: `Step ${n}`,
    valueFrom: `field${n}`,
  });
  renderSteps();
});

btnDownload.addEventListener("click", () => {
  const sop = buildSop();
  const blob = new Blob([JSON.stringify(sop, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sop.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

btnSave.addEventListener("click", async () => {
  const sop = buildSop();
  if (!sop.steps.length) {
    setStatus(saveStatus, "Add at least one step before saving.", "err");
    return;
  }
  setStatus(saveStatus, "Saving…");
  try {
    const res = await fetch(apiUrl("/api/sops"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sop),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
    setStatus(
      saveStatus,
      `Saved SOP + queue card${data.queueCard ? ` (${data.queueCard})` : ""}. Refresh liveAct.`,
      "ok"
    );
    await loadExisting();
  } catch (err) {
    setStatus(
      saveStatus,
      `${err.message}. Tip: run \`npm run dashboard\` so the save API is available, or use Download JSON.`,
      "err"
    );
  }
});

async function loadExisting() {
  existingList.innerHTML = "";
  try {
    const res = await fetch(apiUrl("/api/sops"));
    if (!res.ok) throw new Error("list failed");
    const data = await res.json();
    const items = Array.isArray(data.sops) ? data.sops : [];
    if (!items.length) {
      existingList.innerHTML = `<span class="chip">none yet</span>`;
      return;
    }
    for (const item of items) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = item.id;
      chip.title = item.name || item.file;
      existingList.appendChild(chip);
    }
  } catch {
    existingList.innerHTML = `<span class="chip">Start with npm run dashboard to list/save</span>`;
  }
}

renderSteps();
loadExisting();
