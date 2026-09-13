const fs = require("fs");
const path = require("path");

const AI_RULES_FILENAME = "ai-rules.md";

/** Short safety net if the markdown file or a heading is missing. */
const FALLBACK = {
  shared:
    "Do not list SOP fill steps or tell the operator to start Agent unless this conversation is the queue-card form assistant. Do not invent field values, blockers, or errors that are not in the capture, quest data, or user message.",
  explainPage:
    "You are LiveTrack Desk. Brief the operator on the window they are looking at — any desktop app, form, native tool, or browser. Not only Chrome. Quote the visible error and give the direction — the one next action. When past-work context is provided, include You're on, similar keys, how people did it before, and the next click — cite only listed tickets/steps.",
  jiraTicket:
    'Return JSON only with keys "summary", "description", and "acceptanceCriteria". No markdown fences.',
  jiraComment:
    "You write an ADDITIONAL Jira issue comment from the user's draft. Output only the new comment body — do not edit or replace prior comments.",
  jiraMailShot:
    'The screenshot is an email (Outlook, Gmail, or similar). Return JSON only with keys "from","to","cc","date","subject","body","requestedAction","storyAppend","comment". No markdown fences. Copy visible mail fields; do not invent missing ones. storyAppend is the block to add to the Jira description. comment is a new Jira comment summarizing the mail and what was asked.',
  generalChat:
    "You are LiveTrack Chat, a helpful general assistant. Keep every reply under 200 words.",
  formAssistant:
    "You are LiveTrack, an attended form-fill assistant for the open queue card. Only help with filling this form.",
  autofillReasons:
    "You are LiveTrack. Before autofill, explain why each proposed field value fits. Reply JSON only.",
  stuckCoach:
    "You are LiveTrack, an attended form-fill coach. The human is stuck on ONE step. Reply with JSON only.",
  failedRepair:
    "You repair a single failed LiveTrack SOP step. Reply JSON only.",
  momRefine:
    "You are LiveTrack Minutes of Meeting. Speaker labels come from Teams on-screen tiles, not from names said in the conversation. Do not rename anyone from phrases like this is Matten. Drop small talk. Do not invent owners. Output plain text with sections: Meeting, Discussed, Decisions, Action items (owner — task), Open questions.",
  askPreamble: "",
};

const HEADING_TO_KEY = {
  "shared rules": "shared",
  "explain this window": "explainPage",
  "explain the window": "explainPage",
  "explain this page": "explainPage",
  "jira ticket from screenshot": "jiraTicket",
  "jira comment": "jiraComment",
  "jira mail from screenshot": "jiraMailShot",
  "mail screenshot to jira story": "jiraMailShot",
  "ask livetrack form ai responses": "askPreamble",
  "ask livetrack": "generalChat",
  "general chat": "generalChat",
  "general sidebar ask livetrack": "generalChat",
  "form assistant": "formAssistant",
  "queue card form assistant": "formAssistant",
  "autofill reasons": "autofillReasons",
  "stuck step coach": "stuckCoach",
  "failed step repair": "failedRepair",
  "minutes of meeting": "momRefine",
  "meeting minutes": "momRefine",
  mom: "momRefine",
};

const APPEND_SHARED = new Set(["explainPage", "jiraComment", "generalChat", "formAssistant"]);
const APPEND_ASK_PREAMBLE = new Set(["generalChat", "formAssistant"]);

function normalizeHeading(raw) {
  return String(raw || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function keyForHeading(raw) {
  return HEADING_TO_KEY[normalizeHeading(raw)] || null;
}

function parseAiRulesMarkdown(markdown) {
  const sections = {};
  let currentKey = null;
  let buf = [];
  const flush = () => {
    if (!currentKey) {
      buf = [];
      return;
    }
    const text = buf.join("\n").trim();
    buf = [];
    if (!text) return;
    sections[currentKey] = sections[currentKey] ? `${sections[currentKey]}\n\n${text}` : text;
  };
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const heading = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (heading) {
      const key = keyForHeading(heading[2]);
      if (key) {
        flush();
        currentKey = key;
        continue;
      }
      if (heading[1] === "##") {
        flush();
        currentKey = null;
        continue;
      }
    }
    if (currentKey) buf.push(line);
  }
  flush();
  return sections;
}

function resolveAiRulesPath() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "prompts", AI_RULES_FILENAME));
  }
  candidates.push(path.join(__dirname, "prompts", AI_RULES_FILENAME));
  for (const filePath of candidates) {
    try {
      if (filePath && fs.existsSync(filePath)) return filePath;
    } catch {
      /* ignore */
    }
  }
  return candidates[candidates.length - 1] || null;
}

let cache = { path: "", mtimeMs: -1, sections: null };

function omitEmpty(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (String(value || "").trim()) out[key] = String(value).trim();
  }
  return out;
}

function loadAiRules({ force = false } = {}) {
  const filePath = resolveAiRulesPath();
  let mtimeMs = -1;
  try {
    if (filePath && fs.existsSync(filePath)) {
      mtimeMs = fs.statSync(filePath).mtimeMs;
    }
  } catch {
    mtimeMs = -1;
  }
  if (
    !force &&
    cache.sections &&
    cache.path === filePath &&
    cache.mtimeMs === mtimeMs &&
    mtimeMs >= 0
  ) {
    return cache.sections;
  }
  let parsed = {};
  if (filePath && mtimeMs >= 0) {
    try {
      parsed = parseAiRulesMarkdown(fs.readFileSync(filePath, "utf8"));
    } catch {
      parsed = {};
    }
  }
  const sections = { ...FALLBACK, ...omitEmpty(parsed), sourcePath: filePath };
  cache = { path: filePath, mtimeMs, sections };
  return sections;
}

function getAiPrompt(key, extras = {}) {
  const rules = loadAiRules();
  const id = String(key || "").trim();
  const parts = [];
  if (APPEND_SHARED.has(id) && rules.shared) parts.push(rules.shared);
  if (APPEND_ASK_PREAMBLE.has(id) && rules.askPreamble) parts.push(rules.askPreamble);
  const body = String(rules[id] || FALLBACK[id] || "").trim();
  if (body) parts.push(body);
  if (extras.stepContext) parts.push(`Current steps:\n${extras.stepContext}`);
  return parts.filter(Boolean).join("\n\n");
}

module.exports = {
  AI_RULES_FILENAME,
  FALLBACK,
  HEADING_TO_KEY,
  parseAiRulesMarkdown,
  resolveAiRulesPath,
  loadAiRules,
  getAiPrompt,
  keyForHeading,
  normalizeHeading,
};
