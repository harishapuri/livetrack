/**
 * Persist OpenAI usage (tokens + feature + user) for dashboard analytics.
 */
const os = require("os");
const workbookStore = require("./workbook");

const FEATURE_LABELS = {
  queue_ai: "Queue AI",
  jira_comment: "Jira comment",
  form_assistant: "Form assistant",
  general_chat: "Ask LiveTrack",
  explain_page: "Explain window",
  stuck_coach: "Stuck coach",
  failed_repair: "Failed repair",
  jira_ticket: "Jira ticket",
  mom_refine: "Meeting minutes",
  mom_teams_frame: "MOM Teams frame",
  jira_mail_shot: "Jira mail shot",
  stt: "Speech to text",
  stt_diarize: "Speech diarize",
  tts: "Text to speech",
};

function currentUser() {
  try {
    return os.userInfo().username || "user";
  } catch {
    return "user";
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function usageFromResponse(json) {
  const u = json?.usage || {};
  const prompt = num(u.prompt_tokens);
  const completion = num(u.completion_tokens);
  const total = num(u.total_tokens) || prompt + completion;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

function logAiUsage(row = {}) {
  const feature = String(row.feature || "unknown").trim() || "unknown";
  const rec = {
    ts: row.ts || new Date().toISOString(),
    user: String(row.user || currentUser() || "user").trim() || "user",
    feature,
    model: String(row.model || "").trim(),
    prompt_tokens: String(num(row.prompt_tokens)),
    completion_tokens: String(num(row.completion_tokens)),
    total_tokens: String(num(row.total_tokens)),
    ok: row.ok === false || row.ok === "false" ? "false" : "true",
    cardId: String(row.cardId || "").trim(),
    payload_json: workbookStore.jsonCell(row.payload_json || ""),
  };
  Promise.resolve()
    .then(() => workbookStore.appendRows("AiUsage", [rec]))
    .catch((err) => {
      console.warn("[ai-usage]", err?.message || err);
    });
}

function logFromChatResponse({ json, body, feature, cardId, ok = true, extra } = {}) {
  const usage = usageFromResponse(json);
  logAiUsage({
    feature,
    cardId,
    ok,
    model: json?.model || body?.model || "",
    ...usage,
    payload_json: extra || undefined,
  });
}

module.exports = {
  FEATURE_LABELS,
  currentUser,
  usageFromResponse,
  logAiUsage,
  logFromChatResponse,
};
