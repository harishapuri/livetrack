const fs = require("fs");
const os = require("os");
const path = require("path");
const { Blob, File } = require("buffer");
const { getOpenAiConfig } = require("./settings");
const { logAiUsage, logFromChatResponse } = require("./ai-usage");
const {
  getAiPrompt,
  loadAiRules,
  parseAiRulesMarkdown,
  resolveAiRulesPath,
} = require("./prompts");

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  if (
    ext === ".txt" ||
    ext === ".log" ||
    ext === ".json" ||
    ext === ".csv" ||
    ext === ".md"
  ) {
    return "text/plain";
  }
  return "application/octet-stream";
}

function cellDisplayText(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || "").join("");
  }
  if (value.text) return String(value.text);
  if (value.result != null) return cellDisplayText(value.result);
  if (value.hyperlink) return String(value.hyperlink);
  return "";
}

async function extractSpreadsheetText(filePath, maxChars = 28000) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const lines = [];
  wb.eachSheet((sheet) => {
    lines.push(`# ${sheet.name}`);
    sheet.eachRow((row) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        vals.push(cellDisplayText(cell.value));
      });
      if (vals.some((item) => String(item).trim())) lines.push(vals.join(" | "));
    });
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
}

function fileToContentParts(filePath) {
  const mime = mimeFor(filePath);
  const name = path.basename(filePath);
  if (mime.startsWith("image/")) {
    const b64 = fs.readFileSync(filePath).toString("base64");
    return [
      { type: "text", text: `Attached image: ${name}` },
      { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
    ];
  }
  if (mime === "text/plain" || mime === "application/pdf") {
    if (mime === "text/plain") {
      const text = fs.readFileSync(filePath).toString("utf8").slice(0, 12000);
      return [{ type: "text", text: `Attached error file (${name}):\n\`\`\`\n${text}\n\`\`\`` }];
    }
    const b64 = fs.readFileSync(filePath).toString("base64");
    return [
      {
        type: "text",
        text: `Attached PDF error file: ${name} (base64 length ${b64.length}). Summarize likely form errors from the filename/context if the binary cannot be read.`,
      },
    ];
  }
  return [{ type: "text", text: `Attached file: ${name} (${mime})` }];
}

async function deskFileToContentParts(filePath) {
  const file = String(filePath || "").trim();
  const name = path.basename(file);
  const ext = path.extname(file).toLowerCase();
  if (!file || !fs.existsSync(file)) {
    return [{ type: "text", text: `Missing attachment: ${name || "file"}` }];
  }
  if (ext === ".xlsx" || ext === ".xlsm") {
    try {
      const text = await extractSpreadsheetText(file);
      return [
        {
          type: "text",
          text: `Attached spreadsheet (${name}):\n\`\`\`\n${text || "(empty workbook)"}\n\`\`\``,
        },
      ];
    } catch (err) {
      return [
        {
          type: "text",
          text: `Attached spreadsheet ${name} could not be read (${err?.message || "parse error"}).`,
        },
      ];
    }
  }
  if (ext === ".xls") {
    return [
      {
        type: "text",
        text: `Attached spreadsheet ${name} is .xls. Save as .xlsx or .csv so AI can read the cells.`,
      },
    ];
  }
  try {
    return fileToContentParts(file);
  } catch (err) {
    return [
      {
        type: "text",
        text: `Could not read attachment ${name}: ${err?.message || "read error"}`,
      },
    ];
  }
}

const AUDIO_EXT = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/m4a": "m4a",
};

function audioExtensionFor(mimeType) {
  const mime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  return AUDIO_EXT[mime] || "webm";
}

function normalizeSttSegments(data, fallbackSpeaker = "A") {
  const rows = Array.isArray(data?.segments) ? data.segments : [];
  const segments = rows
    .map((seg) => {
      let speaker = String(seg?.speaker ?? fallbackSpeaker).trim() || fallbackSpeaker;
      if (/^(null|undefined|none)$/i.test(speaker)) speaker = fallbackSpeaker;
      return {
        speaker,
        start: Number(seg?.start) || 0,
        end: Number(seg?.end) || 0,
        text: String(seg?.text || "").trim(),
      };
    })
    .filter((seg) => seg.text);
  const text = String(data?.text || "").trim();
  if (!segments.length && text) {
    return [{ speaker: fallbackSpeaker, start: 0, end: 0, text }];
  }
  return segments;
}

function appendKnownSpeakers(form, names, references) {
  const labelList = Array.isArray(names) ? names.map((name) => String(name || "").trim()).filter(Boolean) : [];
  const refList = Array.isArray(references)
    ? references.map((row) => String(row || "").trim()).filter(Boolean)
    : [];
  const count = Math.min(4, labelList.length, refList.length);
  for (let i = 0; i < count; i += 1) {
    form.append("known_speaker_names[]", labelList[i]);
    form.append("known_speaker_references[]", refList[i]);
  }
}

async function transcribeAudio({
  bytes,
  mimeType,
  diarize,
  model,
  knownSpeakerNames,
  knownSpeakerReferences,
  whisperFallback,
} = {}) {
  const buf = Buffer.isBuffer(bytes)
    ? bytes
    : bytes
      ? Buffer.from(bytes)
      : Buffer.alloc(0);
  if (!buf.length) return { ok: false, error: "No audio captured." };
  const { apiKey, transcriptionsUrl } = getOpenAiConfig();
  if (!apiKey) {
    return { ok: false, error: "Add an API key in Settings to convert speech to text." };
  }
  const mime = String(mimeType || "audio/webm").split(";")[0].trim() || "audio/webm";
  const ext = audioExtensionFor(mime);
  const useDiarize = Boolean(diarize);
  const sttModel = useDiarize
    ? "gpt-4o-transcribe-diarize"
    : String(model || "whisper-1").trim() || "whisper-1";
  const tmp = path.join(os.tmpdir(), `livetrack-stt-${process.pid}-${Date.now()}.${ext}`);
  try {
    fs.writeFileSync(tmp, buf);
    const file = new File([buf], `speech.${ext}`, { type: mime });
    const form = new FormData();
    form.append("file", file, `speech.${ext}`);
    form.append("model", sttModel);
    if (useDiarize) {
      form.append("response_format", "diarized_json");
      form.append("chunking_strategy", "auto");
      appendKnownSpeakers(form, knownSpeakerNames, knownSpeakerReferences);
    } else {
      form.append("response_format", "json");
    }
    const res = await fetch(transcriptionsUrl || "https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (whisperFallback === true && sttModel !== "whisper-1") {
        return transcribeAudio({
          bytes: buf,
          mimeType: mime,
          model: "whisper-1",
          whisperFallback: false,
        });
      }
      return {
        ok: false,
        error: data?.error?.message || `Transcription failed (${res.status})`,
      };
    }
    const segments = useDiarize ? normalizeSttSegments(data) : [];
    const text = String(data?.text || segments.map((seg) => seg.text).join(" ")).trim();
    if (!text) return { ok: false, error: "No speech heard. Tap Mic and try again." };
    logAiUsage({ feature: useDiarize ? "stt_diarize" : "stt", model: sttModel, ok: true });
    return { ok: true, text, segments, model: sttModel };
  } catch (err) {
    return { ok: false, error: err?.message || "Transcription failed." };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

const OPENAI_TTS_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);

function normalizeTtsVoice(value) {
  const voice = String(value || "").trim().toLowerCase();
  return OPENAI_TTS_VOICES.has(voice) ? voice : "alloy";
}

function clampSpeechSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.85;
  return Math.min(1.4, Math.max(0.5, n));
}

const ttsCache = new Map();
const TTS_CACHE_LIMIT = 24;

function capWords(text, maxWords = 200) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

async function synthesizeSpeech({ text, voice, speed } = {}) {
  const raw = capWords(String(text || "").trim(), 200).slice(0, 1600);
  if (!raw) return { ok: false, error: "Nothing to speak." };
  const { apiKey, speechUrl } = getOpenAiConfig();
  if (!apiKey) {
    return { ok: false, error: "Add an API key in Settings to hear spoken replies." };
  }
  const voiceId = normalizeTtsVoice(voice);
  const rate = clampSpeechSpeed(speed);
  const cacheKey = `${voiceId}|${rate}|${raw}`;
  const cached = ttsCache.get(cacheKey);
  if (cached) return { ...cached };
  try {
    const res = await fetch(speechUrl || "https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: raw,
        voice: voiceId,
        speed: rate,
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: data?.error?.message || `Speech failed (${res.status})`,
      };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, error: "Speech audio was empty." };
    const result = {
      ok: true,
      mimeType: "audio/mpeg",
      base64: buf.toString("base64"),
      voice: voiceId,
    };
    ttsCache.set(cacheKey, result);
    if (ttsCache.size > TTS_CACHE_LIMIT) {
      const oldest = ttsCache.keys().next().value;
      ttsCache.delete(oldest);
    }
    logAiUsage({ feature: "tts", model: "tts-1", ok: true });
    return { ...result };
  } catch (err) {
    return { ok: false, error: err?.message || "Speech failed." };
  }
}

function buildUserContent({ prompt, snippet, attachments = [] }) {
  const parts = [];
  const chunks = [];
  if (prompt) chunks.push(prompt);
  if (snippet) {
    chunks.push(`Live form snippet:\n\`\`\`\n${String(snippet).slice(0, 8000)}\n\`\`\``);
  }
  if (chunks.length) {
    parts.push({ type: "text", text: chunks.join("\n\n") });
  }
  for (const filePath of attachments) {
    try {
      parts.push(...fileToContentParts(filePath));
    } catch (err) {
      parts.push({
        type: "text",
        text: `Could not read attachment ${path.basename(filePath)}: ${err.message}`,
      });
    }
  }
  if (!parts.length) {
    parts.push({ type: "text", text: "Help me with this form quest." });
  }
  return parts;
}

const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_live_state",
      description: "Fetch the live form DOM snippet and current step statuses from the browser.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "fill_step",
      description: "Fill or perform one SOP step by id (fill/click/check). Use for the current gate step.",
      parameters: {
        type: "object",
        properties: {
          stepId: { type: "string" },
          value: { type: "string", description: "Optional override value for fill steps" },
          broadMatch: { type: "boolean", description: "Retry with broader locator" },
        },
        required: ["stepId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "click_step",
      description: "Click/check a step by id (alias of fill_step for click/check actions).",
      parameters: {
        type: "object",
        properties: {
          stepId: { type: "string" },
          broadMatch: { type: "boolean" },
        },
        required: ["stepId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_run",
      description: "Start the attended SOP run from the first incomplete step.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "pause_run",
      description: "Pause an active Start run.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_run",
      description: "Cancel / take over an active run.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "rescan",
      description: "Re-scan the form and refresh step greens.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_fields",
      description: "Clear LiveTrack marks and empty form fields on the page.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

function authHeaders(apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function openaiJson({ body, signal, feature, cardId } = {}) {
  const { apiKey, chatCompletionsUrl } = getOpenAiConfig();
  const res = await fetch(chatCompletionsUrl || "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (feature) {
      logFromChatResponse({
        json: { model: body?.model },
        body,
        feature,
        cardId,
        ok: false,
      });
    }
    throw new Error(`AI ${res.status}: ${errText.slice(0, 240) || res.statusText}`);
  }
  const json = await res.json();
  if (feature) logFromChatResponse({ json, body, feature, cardId, ok: true });
  return json;
}

async function streamCompletion({ body, signal, onDelta, feature, cardId } = {}) {
  const { apiKey, chatCompletionsUrl } = getOpenAiConfig();
  const res = await fetch(chatCompletionsUrl || "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (feature) {
      logFromChatResponse({
        json: { model: body?.model },
        body,
        feature,
        cardId,
        ok: false,
      });
    }
    throw new Error(`AI ${res.status}: ${errText.slice(0, 240) || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let usageJson = { model: body?.model };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        if (json.usage) usageJson = { ...usageJson, usage: json.usage, model: json.model || usageJson.model };
        const delta = json.choices?.[0]?.delta?.content || "";
        if (delta) {
          full += delta;
          if (onDelta) onDelta(delta, full);
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (feature) logFromChatResponse({ json: usageJson, body, feature, cardId, ok: true });
  return full;
}

/**
 * Stream OpenAI chat with optional tool loop for agentic actions.
 * executeTool(name, args) must return a JSON-serializable result.
 */
function buildChatSystemPrompt(mode, stepContext) {
  if (mode === "general") {
    return getAiPrompt("generalChat");
  }
  return getAiPrompt("formAssistant", { stepContext });
}

async function streamChat({
  messages,
  prompt,
  snippet,
  attachments,
  stepContext,
  onDelta,
  signal,
  executeTool,
  autoApplyTools = true,
  mode = "form",
}) {
  const { model, hasKey } = getOpenAiConfig();
  if (!hasKey) {
    throw new Error("Add your OpenAI API key in Settings (gear icon).");
  }

  const system = buildChatSystemPrompt(mode, stepContext);

  const history = (messages || []).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const userContent = buildUserContent({ prompt, snippet, attachments });
  const thread = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userContent },
  ];

  const feature = mode === "general" ? "general_chat" : "form_assistant";
  const useTools = mode !== "general" && typeof executeTool === "function" && autoApplyTools;
  let toolRounds = 0;

  while (useTools && toolRounds < 4) {
    toolRounds += 1;
    const json = await openaiJson({
      body: {
        model,
        stream: false,
        max_tokens: 600,
        tools: AGENT_TOOLS,
        tool_choice: "auto",
        messages: thread,
      },
      signal,
      feature,
    });

    const msg = json.choices?.[0]?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls;
    if (!toolCalls?.length) {
      const text = String(msg.content || "").trim();
      if (text && onDelta) onDelta(text, text);
      return { text, model, toolRounds };
    }

    thread.push({
      role: "assistant",
      content: msg.content || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const name = call.function?.name || "";
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }
      let result;
      try {
        result = await executeTool(name, args);
      } catch (err) {
        result = { ok: false, error: err?.message || String(err) };
      }
      thread.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result ?? { ok: true }),
      });
    }
  }

  const full = await streamCompletion({
    body: {
      model,
      max_tokens: 280,
      messages: thread,
    },
    signal,
    onDelta,
    feature,
  });

  return { text: full, model, toolRounds };
}

/** Primary expected fill value for Approve / coach hints.
 * Priority: allowedValues[0] → valueFrom array[0] → valueFrom scalar → step.id key → step.value
 */
function primaryQuestValue(step, questData) {
  if (Array.isArray(step?.allowedValues) && step.allowedValues.length) {
    const first = step.allowedValues.map((v) => String(v ?? "").trim()).find(Boolean);
    if (first) return first;
  }
  const data = questData && typeof questData === "object" ? questData : null;
  const key =
    step?.valueFrom != null
      ? step.valueFrom
      : data && step?.id != null && Object.prototype.hasOwnProperty.call(data, step.id)
        ? step.id
        : null;
  if (key && data && data[key] != null) {
    const v = data[key];
    if (Array.isArray(v)) {
      return v.map((x) => String(x ?? "").trim()).find(Boolean) || "";
    }
    return String(v).trim();
  }
  if (step?.value != null && String(step.value).trim()) return String(step.value).trim();
  return "";
}

/**
 * Build fill proposals from case/SOP data (no network).
 * Used when OpenAI is unavailable and as the ground-truth value source for AI reasons.
 */
function buildLocalAgentProposals(steps, questData) {
  const proposals = [];
  for (const step of steps || []) {
    const action = String(step?.action || "").toLowerCase();
    if (action !== "fill") continue;
    const value = primaryQuestValue(step, questData);
    const mandatory = Boolean(step?.mandatory);
    if (!value && !mandatory) continue;
    const data = questData && typeof questData === "object" ? questData : null;
    const valueKey =
      step?.valueFrom != null
        ? step.valueFrom
        : data && step?.id != null && Object.prototype.hasOwnProperty.call(data, step.id)
          ? step.id
          : step?.valueFrom || step?.id || null;
    proposals.push({
      stepId: String(step.id || ""),
      label: String(step.label || step.id || "Field").trim(),
      value: value || "",
      valueKey: valueKey != null ? String(valueKey) : null,
      mandatory,
      reason: !value && mandatory
        ? "Mandatory — enter a value before approving."
        : mandatory
          ? "From case data for this mandatory field."
          : "Mapped from this case’s data for autofill.",
    });
  }
  return proposals.filter((p) => p.stepId && (p.value || p.mandatory));
}

/**
 * Propose fill values + short “why” reasons before an Agent run starts.
 * Values stay grounded in quest/case data; AI only writes reasons (when keyed).
 */
async function proposeAgentFill({
  steps,
  questData,
  cardTitle,
  snippet,
  signal,
} = {}) {
  const local = buildLocalAgentProposals(steps, questData);
  const { apiKey, model, hasKey } = getOpenAiConfig();

  if (!local.length) {
    return {
      ok: true,
      proposals: [],
      usedAi: false,
      needsKey: !hasKey,
      note: "No fill values found in case data for remaining steps.",
    };
  }

  if (!hasKey) {
    return {
      ok: true,
      proposals: local,
      usedAi: false,
      needsKey: true,
      note: "Using case data (add OpenAI key in Settings for AI reasons).",
    };
  }

  const system = getAiPrompt("autofillReasons");

  const stepLines = local
    .map(
      (p) =>
        `- stepId=${p.stepId} label="${p.label}" knownValue="${p.value}"${
          p.valueKey ? ` valueKey=${p.valueKey}` : ""
        }`,
    )
    .join("\n");

  const body = {
    model,
    stream: false,
    temperature: 0.2,
    max_tokens: 700,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          cardTitle ? `Queue card: ${cardTitle}` : "",
          "Fill steps to explain:",
          stepLines,
          snippet
            ? `Live form snippet (optional context):\n\`\`\`\n${String(snippet).slice(0, 5000)}\n\`\`\``
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  };

  try {
    const json = await openaiJson({ body, signal, feature: "queue_ai" });
    const raw = String(json.choices?.[0]?.message?.content || "").trim();
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const byId = new Map();
    for (const row of Array.isArray(parsed.proposals) ? parsed.proposals : []) {
      const id = String(row?.stepId || "").trim();
      if (!id) continue;
      byId.set(id, {
        reason: String(row?.reason || "").trim().slice(0, 160),
        value: String(row?.value || "").trim(),
      });
    }

    const proposals = local.map((p) => {
      const ai = byId.get(p.stepId);
      const reason = ai?.reason || p.reason;
      // Keep known case value; ignore AI value rewrites
      return { ...p, reason: reason || p.reason };
    });

    return { ok: true, proposals, usedAi: true, needsKey: false, model };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return {
      ok: true,
      proposals: local,
      usedAi: false,
      needsKey: false,
      note: err?.message || "AI propose failed; using case data.",
    };
  }
}

/**
 * Stuck coach — tip plus optional apply/retry hints.
 */
async function coachStuckStep({ step, stepContext, snippet, questData, signal }) {
  const { apiKey, model, hasKey } = getOpenAiConfig();
  const label = step?.label || step?.id || "this step";
  const action = step?.action || "unknown";
  const valueFrom = step?.valueFrom;
  const mandatory = Boolean(step?.mandatory);
  const knownValue = primaryQuestValue(step, questData);
  const localCanApply = mandatory && action === "fill" && Boolean(knownValue.trim());

  if (!hasKey) {
    return {
      ok: true,
      needsKey: true,
      text: localCanApply
        ? `This step is mandatory. Suggested value: “${knownValue.trim()}”. Approve below, or type any value to continue.`
        : mandatory
          ? `This step is mandatory. Fill “${label}” on the form — any value completes it. Open AI settings (gear) for richer tips.`
          : "Open AI settings (gear) to enable stuck-step help.",
      suggestedValue: localCanApply ? knownValue.trim() : "",
      canApply: localCanApply,
      canRetry: true,
      confidence: localCanApply ? "high" : "low",
    };
  }

  const system = getAiPrompt("stuckCoach");

  const userParts = [
    `Stuck step: “${label}” (action=${action}, id=${step?.id || "?"}, valueFrom=${valueFrom || "none"}, mandatory=${mandatory})`,
    knownValue
      ? `Known quest value for this step: ${knownValue}`
      : "No known quest value mapped.",
    mandatory
      ? "This step is MANDATORY — offer Approve with the known value and a short explanation."
      : "This step is NOT mandatory — do not offer Approve values; tell the user any filled value / correct click is enough.",
    stepContext ? `Quest steps:\n${stepContext}` : "",
    snippet ? `Live form snippet:\n\`\`\`\n${String(snippet).slice(0, 6000)}\n\`\`\`` : "",
  ].filter(Boolean);

  const body = {
    model,
    stream: false,
    temperature: 0.3,
    max_tokens: 220,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userParts.join("\n\n") },
    ],
  };

  const json = await openaiJson({ body, signal, feature: "stuck_coach" });
  const raw = String(json.choices?.[0]?.message?.content || "").trim();
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { tip: raw };
  }

  const tip = String(parsed.tip || parsed.text || "").trim();
  const suggestedRaw = String(parsed.suggestedValue || knownValue || "").trim();
  const suggestedValue = localCanApply || mandatory ? suggestedRaw : "";
  const canApply =
    mandatory &&
    action === "fill" &&
    Boolean(suggestedValue) &&
    Boolean(parsed.canApply || localCanApply || suggestedValue === knownValue);
  const confidence = canApply ? "high" : parsed.confidence === "high" ? "high" : "low";
  const canRetry = parsed.canRetry !== false;

  if (!tip) {
    return {
      ok: true,
      text: localCanApply
        ? `This step is mandatory. Suggested value: “${suggestedValue}”. Approve below, or type any value.`
        : "No tip returned — try again or open Ask AI.",
      suggestedValue: canApply ? suggestedValue : "",
      canApply,
      canRetry: true,
      confidence: canApply ? "high" : "low",
    };
  }

  return {
    ok: true,
    text: tip,
    model,
    suggestedValue: canApply ? suggestedValue : "",
    canApply,
    canRetry,
    confidence,
  };
}

/**
 * One-shot repair plan after a Start step fails (mid-run or post-run).
 */
async function repairFailedStep({ step, error, stepContext, snippet, questData, signal }) {
  const { apiKey, model, hasKey } = getOpenAiConfig();
  if (!hasKey) {
    return {
      ok: false,
      retry: false,
      action: "retry_broad",
      needsKey: true,
      reason: "No OpenAI key — trying broader locator",
    };
  }

  const system = getAiPrompt("failedRepair");

  const knownValue = primaryQuestValue(step, questData);

  const body = {
    model,
    stream: false,
    temperature: 0.2,
    max_tokens: 280,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          `Failed step: ${step?.label || step?.id} (action=${step?.action}, id=${step?.id})`,
          `Error: ${error || "unknown"}`,
          knownValue ? `Known quest value: ${knownValue}` : "No known quest value.",
          stepContext ? `Steps:\n${stepContext}` : "",
          snippet ? `DOM:\n${String(snippet).slice(0, 5000)}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  };

  const json = await openaiJson({ body, signal, feature: "failed_repair" });
  let parsed = {};
  try {
    parsed = JSON.parse(String(json.choices?.[0]?.message?.content || "{}"));
  } catch {
    parsed = { action: "retry_broad", broadMatch: true, reason: "Heuristic retry" };
  }

  const allowed = new Set(["retry_broad", "apply_value", "rewrite_step", "click_alt", "skip"]);
  let action = String(parsed.action || "").trim();
  if (!allowed.has(action)) {
    action = parsed.broadMatch || /not find|not found/i.test(String(error || ""))
      ? "retry_broad"
      : knownValue && step?.action === "fill"
        ? "apply_value"
        : "retry_broad";
  }

  const stepPatch =
    parsed.stepPatch && typeof parsed.stepPatch === "object" ? parsed.stepPatch : null;

  return {
    ok: true,
    model,
    action,
    retry: action !== "skip",
    broadMatch: action === "retry_broad" || Boolean(parsed.broadMatch),
    valueOverride: String(parsed.valueOverride || knownValue || "").trim() || null,
    stepPatch,
    altFindByText: String(parsed.altFindByText || "").trim() || null,
    reason: String(parsed.reason || "AI repair…").trim(),
  };
}

/**
 * Fuzzy compare for mandatory field values (case-insensitive).
 * Mirrors extension compareValues: fold case/accents, typos, token reorder,
 * containment. Numbers/phones stay exact.
 * expected may be a scalar or an array of allowed values.
 */
function localFuzzyValueMatch(expected, actual) {
  const act = String(actual ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!act) return false;

  const list = Array.isArray(expected)
    ? expected.map((v) => String(v ?? "").trim()).filter(Boolean)
    : [String(expected ?? "").trim()].filter(Boolean);
  if (!list.length) return true;

  const fold = (v) =>
    String(v ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const looksPlainNumeric = (value) => {
    const t = String(value ?? "")
      .trim()
      .replace(/,/g, "");
    if (!t) return false;
    if (/^-?0\d+$/.test(t)) return false;
    return /^-?\d+(\.\d+)?$/.test(t);
  };

  const levenshtein = (a, b) => {
    const s = String(a || "");
    const t = String(b || "");
    if (s === t) return 0;
    if (!s.length) return t.length;
    if (!t.length) return s.length;
    const prev = new Array(t.length + 1);
    const cur = new Array(t.length + 1);
    for (let j = 0; j <= t.length; j++) prev[j] = j;
    for (let i = 1; i <= s.length; i++) {
      cur[0] = i;
      const sc = s.charCodeAt(i - 1);
      for (let j = 1; j <= t.length; j++) {
        const cost = sc === t.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= t.length; j++) prev[j] = cur[j];
    }
    return prev[t.length];
  };

  return list.some((exp) => {
    const eRaw = String(exp ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (!eRaw) return true;

    const a = fold(act);
    const e = fold(eRaw);
    if (a === e) return true;

    if (looksPlainNumeric(act) && looksPlainNumeric(eRaw)) {
      const an = Number(act.replace(/,/g, ""));
      const en = Number(eRaw.replace(/,/g, ""));
      return Number.isFinite(an) && Number.isFinite(en) && an === en;
    }

    const ad = act.replace(/\D/g, "");
    const ed = eRaw.replace(/\D/g, "");
    if (ed.length >= 7 && ad.length >= 7 && ad === ed) return true;

    const aAlnum = a.replace(/[^a-z0-9]/g, "");
    const eAlnum = e.replace(/[^a-z0-9]/g, "");
    if (aAlnum && aAlnum === eAlnum) return true;
    if (aAlnum.length >= 3 && eAlnum.length >= 3) {
      if (aAlnum.includes(eAlnum) || eAlnum.includes(aAlnum)) return true;
    }

    const aTokens = a.split(" ").filter(Boolean).sort().join(" ");
    const eTokens = e.split(" ").filter(Boolean).sort().join(" ");
    if (aTokens && aTokens === eTokens) return true;

    const maxLen = Math.max(a.length, e.length);
    const maxDist = maxLen <= 4 ? 1 : maxLen <= 12 ? 2 : 3;
    if (maxLen > 0 && levenshtein(a, e) <= maxDist) return true;
    if (
      aAlnum.length >= 3 &&
      eAlnum.length >= 3 &&
      levenshtein(aAlnum, eAlnum) <= Math.min(maxDist, 2)
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Judge whether an entered field value matches the SOP/case expected value.
 * Fuzzy local compare — case-insensitive, small typos, word order.
 */
async function judgeValueMatch({ expected, actual }) {
  const exp = expected;
  const act = String(actual ?? "").trim();

  const hasExpected = Array.isArray(exp)
    ? exp.some((v) => String(v ?? "").trim())
    : Boolean(String(exp ?? "").trim());

  if (!hasExpected) return { ok: true, match: Boolean(act), reason: "No expected value", model: null };
  if (!act) return { ok: true, match: false, reason: "Empty value", model: null };

  const match = localFuzzyValueMatch(exp, act);
  return {
    ok: true,
    match,
    reason: match ? "Fuzzy local match" : "Does not match expected value",
    model: null,
  };
}

function getExplainPageSystem() {
  return getAiPrompt("explainPage");
}

function isUsefulExplainSnippet(snippet) {
  const raw = String(snippet || "").trim();
  if (!raw) return false;
  const rest = raw
    .replace(/^URL:.*$/gim, "")
    .replace(/^Title:.*$/gim, "")
    .replace(/^Visible questions:\s*$/gim, "")
    .replace(/^Visible text:\s*$/gim, "")
    .trim();
  if (rest.length < 24) return false;
  if (
    /visible errors:|aria-invalid|validation|required|could not submit|failed submit|role="alert"/i.test(
      rest,
    )
  ) {
    return true;
  }
  return rest.split("\n").map((line) => line.trim()).filter(Boolean).length >= 2;
}

function buildExplainPageUserContent(snippet, hasImage = false, historyBlock = "") {
  const text = String(snippet || "").trim();
  const history = String(historyBlock || "").trim();
  const historySection = history
    ? `\n\n${history}\nWhen this past-work block is present: lead with You're on (ticket/form), mention similar/linked keys or past reference numbers with each listed confidence %, summarize how people did it before in a short numbered path from the recordings, include a couple of example field notes when given, state overall match confidence once, and end with the next click for this operator. Cite only keys, steps, and confidence values from the block — never invent past tickets, refs, or scores.`
    : "";
  if (hasImage) {
    return [
      "Screenshot of the frontmost window the operator was using (any desktop app, not only Chrome).",
      text
        ? `Optional extra context from Chrome (not the whole explanation):\n${text}`
        : "No DOM snippet; use the screenshot. Say what this page/window is, how to fill or complete it, quote any visible errors, and give the direction — the next action.",
      historySection,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "Window snippet from what the operator is looking at:",
    text || "(empty — nothing captured)",
    historySection,
  ]
    .filter(Boolean)
    .join("\n");
}

function getDraftJiraFromShotSystem() {
  return getAiPrompt("jiraTicket");
}

function getDraftJiraFromMaterialsSystem() {
  return [
    "You plan Jira work from attached materials (screenshot, spreadsheet, notes, files).",
    "Decide whether the input is ONE ticket or SEVERAL independent tickets.",
    "Use multiple only when the materials contain independent work units (different hosts, environments, incidents, customers, change items, or unrelated requests).",
    "Use one ticket when it is a single issue or a tightly related set. If unsure, stay single — do not invent splits.",
    "Ignore summary, total, and count rows. Skip items already closed, remediated, or risk-accepted unless the user asked to include them.",
    "Each summary must name the actual work (what + where + identifier). Never use a generic title like Issue from LiveTrack Desk.",
    'Return JSON only with keys "mode" ("single" or "multiple"), "reason", and "tickets" (array of objects with summary, description, acceptanceCriteria, groupingHint).',
    "No markdown fences. Keep each summary under 255 characters.",
  ].join(" ");
}

function normalizeTicketDraft(obj) {
  if (!obj || typeof obj !== "object") return null;
  const summary = String(obj.summary || obj.title || "").trim();
  const description = String(obj.description || obj.body || "").trim();
  const acceptanceCriteria = String(
    obj.acceptanceCriteria ||
      obj.acceptance_criteria ||
      obj.acceptance ||
      obj.ac ||
      "",
  ).trim();
  const groupingHint = String(obj.groupingHint || obj.group || obj.environment || "").trim();
  if (!summary && !description && !acceptanceCriteria) return null;
  if (!summary) return null;
  return {
    summary: summary.slice(0, 255),
    description,
    acceptanceCriteria,
    groupingHint,
  };
}

function parseTicketDraftJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = (fenced ? fenced[1] : raw).trim();
  const tryParse = (value) => {
    try {
      const obj = JSON.parse(value);
      if (!obj || typeof obj !== "object") return null;
      const ticketsRaw = Array.isArray(obj.tickets) ? obj.tickets : [];
      const tickets = ticketsRaw.map(normalizeTicketDraft).filter(Boolean).slice(0, 25);
      const first = tickets[0] || normalizeTicketDraft(obj);
      if (!first) return null;
      const mode = tickets.length >= 2 ? "multiple" : "single";
      return {
        summary: first.summary,
        description: first.description,
        acceptanceCriteria: first.acceptanceCriteria,
        groupingHint: first.groupingHint,
        mode,
        reason: String(obj.reason || "").trim(),
        tickets: mode === "multiple" ? tickets : [first],
      };
    } catch {
      return null;
    }
  };
  const direct = tryParse(candidate);
  if (direct) return direct;
  const brace = candidate.match(/\{[\s\S]*\}/);
  return brace ? tryParse(brace[0]) : null;
}

function fallbackTicketDraft({ pageUrl, pageTitle } = {}) {
  const title = String(pageTitle || "").trim();
  const url = String(pageUrl || "").trim();
  let summary = title;
  const looksLikeUrl =
    !summary ||
    /^https?:\/\//i.test(summary) ||
    /127\.0\.0\.1|localhost/i.test(summary);
  if (looksLikeUrl && url) {
    try {
      const href = /^https?:\/\//i.test(url) ? url : `http://${url}`;
      const u = new URL(href);
      const last = (u.pathname || "").split("/").filter(Boolean).pop() || "";
      const name = last.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
      if (name) summary = name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    } catch {
      /* keep title */
    }
  }
  if (!summary || looksLikeUrl) summary = "Issue from LiveTrack Desk";
  const description = [
    title ? `Page: ${title}` : "",
    url ? `URL: ${url}` : "",
    "Created from LiveTrack Desk (desktop screenshot).",
  ]
    .filter(Boolean)
    .join("\n");
  return { summary: summary.slice(0, 255), description, acceptanceCriteria: "" };
}

async function draftJiraFromDeskMaterials({
  screenshotPath,
  files = [],
  summary,
  description,
  acceptanceCriteria,
  pageUrl,
  pageTitle,
  signal,
} = {}) {
  const fallback = fallbackTicketDraft({ pageUrl, pageTitle });
  const { model, hasKey } = getOpenAiConfig();
  const paths = [];
  const seen = new Set();
  const addPath = (value) => {
    const file = String(value || "").trim();
    if (!file || seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    paths.push(file);
  };
  addPath(screenshotPath);
  const extras = Array.isArray(files) ? files : [];
  for (const item of extras) {
    addPath(typeof item === "string" ? item : item?.path);
  }
  const currentSummary = String(summary || "").trim();
  const currentDescription = String(description || "").trim();
  const currentAcceptance = String(acceptanceCriteria || "").trim();
  if (!paths.length && !currentSummary && !currentDescription && !currentAcceptance) {
    return { ok: false, error: "Attach a file or capture a screenshot first." };
  }
  if (!hasKey) {
    return {
      ok: true,
      ...fallback,
      mode: "single",
      reason: "",
      tickets: [fallback],
      usedAi: false,
      note: "Add an API key in Settings to refine with AI.",
    };
  }
  const content = [
    {
      type: "text",
      text: [
        "Plan Jira ticket(s) from the attached materials (screenshot, spreadsheet, notes, or files).",
        "Use file contents as the source of truth. Decide one vs several independent tickets. If unsure, return a single ticket.",
        "Each summary must reflect the exact work (what, where, identifier) — not a generic Desk title.",
        pageTitle ? `Page title: ${pageTitle}` : "",
        pageUrl ? `URL: ${pageUrl}` : "",
        currentSummary ? `Current summary:\n${currentSummary}` : "",
        currentDescription ? `Current description:\n${currentDescription}` : "",
        currentAcceptance ? `Current acceptance criteria:\n${currentAcceptance}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  for (const file of paths) {
    const parts = await deskFileToContentParts(file);
    content.push(...parts);
  }
  try {
    const json = await openaiJson({
      body: {
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: getDraftJiraFromMaterialsSystem() },
          { role: "user", content },
        ],
      },
      signal,
      feature: "jira_ticket_refine",
    });
    const parsed = parseTicketDraftJson(json.choices?.[0]?.message?.content || "");
    if (!parsed?.summary) {
      return {
        ok: true,
        ...fallback,
        mode: "single",
        reason: "",
        tickets: [fallback],
        usedAi: false,
        note: "AI draft was empty; used a fallback summary.",
      };
    }
    const tickets = Array.isArray(parsed.tickets) && parsed.tickets.length
      ? parsed.tickets
      : [
          {
            summary: parsed.summary.slice(0, 255),
            description: parsed.description || fallback.description,
            acceptanceCriteria: parsed.acceptanceCriteria || "",
            groupingHint: parsed.groupingHint || "",
          },
        ];
    const mode = tickets.length >= 2 ? "multiple" : "single";
    const first = tickets[0];
    return {
      ok: true,
      summary: first.summary.slice(0, 255),
      description: first.description || fallback.description,
      acceptanceCriteria: first.acceptanceCriteria || "",
      mode,
      reason: parsed.reason || "",
      tickets,
      usedAi: true,
      model,
    };
  } catch (err) {
    return {
      ok: true,
      ...fallback,
      mode: "single",
      reason: "",
      tickets: [fallback],
      usedAi: false,
      note: err?.message || "AI refine failed; used a fallback summary.",
    };
  }
}

async function draftJiraFromScreenshot({
  screenshotPath,
  dataUrl,
  pageUrl,
  pageTitle,
  signal,
} = {}) {
  const fallback = fallbackTicketDraft({ pageUrl, pageTitle });
  let imageUrl = String(dataUrl || "").trim();
  const file = String(screenshotPath || "").trim();
  if (!imageUrl && file && fs.existsSync(file)) {
    const mime = mimeFor(file);
    if (mime.startsWith("image/")) {
      imageUrl = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
    }
  }
  const { model, hasKey } = getOpenAiConfig();
  if (!hasKey || !imageUrl) {
    return {
      ok: true,
      ...fallback,
      usedAi: false,
      note: hasKey ? "No screenshot to send to vision." : "Add an API key in Settings to draft from the screenshot.",
    };
  }
  try {
    const json = await openaiJson({
      body: {
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: getDraftJiraFromShotSystem() },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "Write a Jira ticket for this desktop screenshot.",
                  pageTitle ? `Page title: ${pageTitle}` : "",
                  pageUrl ? `URL: ${pageUrl}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      },
      signal,
      feature: "jira_ticket",
    });
    const parsed = parseTicketDraftJson(json.choices?.[0]?.message?.content || "");
    if (!parsed?.summary) {
      return { ok: true, ...fallback, usedAi: false, note: "AI draft was empty; used a fallback summary." };
    }
    return {
      ok: true,
      summary: parsed.summary.slice(0, 255),
      description: parsed.description || fallback.description,
      acceptanceCriteria: parsed.acceptanceCriteria || "",
      usedAi: true,
      model,
    };
  } catch (err) {
    return {
      ok: true,
      ...fallback,
      usedAi: false,
      note: err?.message || "Vision draft failed; used a fallback summary.",
    };
  }
}

function lineFromMailField(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `${label}: ${text}`;
}

function formatMailStoryBlock(parsed = {}) {
  const custom = String(parsed.storyAppend || parsed.story || "").trim();
  if (custom) return custom;
  const body = String(parsed.body || "").trim();
  const action = String(parsed.requestedAction || parsed.action || "").trim();
  const lines = [
    "Email (from screenshot)",
    lineFromMailField("From", parsed.from),
    lineFromMailField("To", parsed.to),
    lineFromMailField("Cc", parsed.cc),
    lineFromMailField("Date", parsed.date),
    lineFromMailField("Subject", parsed.subject),
    body ? `\n${body}` : "",
    action ? `\nRequested action: ${action}` : "",
  ].filter(Boolean);
  return lines.join("\n").trim();
}

function formatMailComment(parsed = {}, issueKey = "") {
  const custom = String(parsed.comment || "").trim();
  if (custom) return custom;
  const subject = String(parsed.subject || "").trim();
  const action = String(parsed.requestedAction || parsed.action || "").trim();
  const from = String(parsed.from || "").trim();
  const bits = [
    issueKey ? `${issueKey}:` : "",
    subject ? `Mail — ${subject}` : "Mail captured from a screenshot.",
    from ? `From ${from}.` : "",
    action ? action : "",
  ].filter(Boolean);
  return bits.join(" ").replace(/\s+/g, " ").trim();
}

function parseMailDraftJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = (fenced ? fenced[1] : raw).trim();
  const tryParse = (value) => {
    try {
      const obj = JSON.parse(value);
      if (!obj || typeof obj !== "object") return null;
      const from = String(obj.from || obj.sender || "").trim();
      const to = String(obj.to || obj.recipient || "").trim();
      const cc = String(obj.cc || "").trim();
      const date = String(obj.date || obj.sent || "").trim();
      const subject = String(obj.subject || "").trim();
      const body = String(obj.body || obj.message || "").trim();
      const requestedAction = String(
        obj.requestedAction || obj.requested_action || obj.action || "",
      ).trim();
      const storyAppend = String(obj.storyAppend || obj.story_append || obj.story || "").trim();
      const comment = String(obj.comment || "").trim();
      if (!from && !to && !subject && !body && !storyAppend && !comment) {
        return null;
      }
      return { from, to, cc, date, subject, body, requestedAction, storyAppend, comment };
    } catch {
      return null;
    }
  };
  const direct = tryParse(candidate);
  if (direct) return direct;
  const brace = candidate.match(/\{[\s\S]*\}/);
  return brace ? tryParse(brace[0]) : null;
}

function fallbackMailDraft() {
  const storyAppend = [
    "Email (from screenshot)",
    "Could not read the mail headers from this capture. Attach the screenshot and fill in From, To, Subject, and the request.",
  ].join("\n");
  return {
    from: "",
    to: "",
    cc: "",
    date: "",
    subject: "",
    body: "",
    requestedAction: "",
    storyAppend,
    comment:
      "Added a mail screenshot. Please review the image and complete any missing From/To/Subject details in the story.",
  };
}

async function draftMailFromScreenshot({ screenshotPath, dataUrl, issueKey, summary, signal } = {}) {
  const fallback = fallbackMailDraft();
  let imageUrl = String(dataUrl || "").trim();
  const file = String(screenshotPath || "").trim();
  if (!imageUrl && file && fs.existsSync(file)) {
    const mime = mimeFor(file);
    if (mime.startsWith("image/")) {
      imageUrl = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
    }
  }
  const { model, hasKey } = getOpenAiConfig();
  if (!hasKey || !imageUrl) {
    return {
      ok: true,
      story: fallback.storyAppend,
      comment: fallback.comment,
      mail: fallback,
      usedAi: false,
      note: hasKey
        ? "No screenshot to send to vision."
        : "Add an API key in Settings to read the mail screenshot.",
    };
  }
  try {
    const json = await openaiJson({
      body: {
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: getAiPrompt("jiraMailShot") },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "Extract all visible mail information from this screenshot and draft it for a Jira story plus a comment.",
                  issueKey ? `Jira story: ${issueKey}` : "",
                  summary ? `Current story summary: ${summary}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      },
      signal,
      feature: "jira_mail_shot",
    });
    const parsed = parseMailDraftJson(json.choices?.[0]?.message?.content || "");
    if (!parsed) {
      return {
        ok: true,
        story: fallback.storyAppend,
        comment: fallback.comment,
        mail: fallback,
        usedAi: false,
        note: "AI draft was empty; fill in the mail details, then add to the story.",
      };
    }
    const story = formatMailStoryBlock(parsed);
    const comment = formatMailComment(parsed, issueKey);
    return {
      ok: true,
      story,
      comment,
      mail: parsed,
      usedAi: true,
      model,
    };
  } catch (err) {
    return {
      ok: true,
      story: fallback.storyAppend,
      comment: fallback.comment,
      mail: fallback,
      usedAi: false,
      note: err?.message || "Vision draft failed; fill in the mail details, then add to the story.",
    };
  }
}

async function explainPage({ snippet, screenshotPath, dataUrl, historyBlock, signal } = {}) {
  const text = String(snippet || "").trim();
  let imageUrl = String(dataUrl || "").trim();
  const file = String(screenshotPath || "").trim();
  if (!imageUrl && file && fs.existsSync(file)) {
    const mime = mimeFor(file);
    if (mime.startsWith("image/")) {
      imageUrl = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
    }
  }
  if (!text && !imageUrl) {
    return {
      ok: false,
      error: "Could not capture the window you want explained.",
    };
  }
  const { model, hasKey } = getOpenAiConfig();
  if (!hasKey) {
    return { ok: false, error: "Add an API key in Settings to explain this window." };
  }
  try {
    const userText = buildExplainPageUserContent(text, Boolean(imageUrl), historyBlock);
    const userContent = imageUrl
      ? [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: imageUrl } },
        ]
      : userText;
    const json = await openaiJson({
      body: {
        model,
        temperature: 0.1,
        max_tokens: 640,
        messages: [
          { role: "system", content: getExplainPageSystem() },
          { role: "user", content: userContent },
        ],
      },
      signal,
      feature: "explain_page",
    });
    const briefing = String(json.choices?.[0]?.message?.content || "").trim();
    if (!briefing) {
      return { ok: false, error: "No briefing came back. Try again." };
    }
    return { ok: true, text: briefing, model };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not explain this window." };
  }
}

function attachRecordedActivity(body, activityText) {
  const text = String(body || "").trim();
  const block = String(activityText || "").trim();
  if (!block) return text;
  if (!text) return block;
  if (text.includes("Field values entered:") || text.includes("Clicks:")) return text;
  const sample = block.split("\n").find((line) => line.startsWith("- ") && line.includes(":"));
  const value = sample ? sample.split(":").slice(1).join(":").trim() : "";
  if (value && text.includes(value)) return text;
  return `${text}\n\n${block}`;
}

/**
 * Turn a rough draft into a concise NEW Jira comment body.
 * Never replaces prior comments — caller always POSTs an additional comment.
 * Falls back to cleaned draft text if OpenAI is unavailable.
 */
async function polishJiraCommentDraft({
  draft,
  issueKey,
  summary,
  status,
  sopStage,
  ticketKey,
  queueCard,
  mandatorySummary,
  signal,
} = {}) {
  const text = String(draft || "").trim();
  if (!text) {
    return { ok: false, error: "empty_draft" };
  }

  const { model, hasKey } = getOpenAiConfig();
  if (!hasKey) {
    const fallback = [
      ticketKey || issueKey ? `Ticket ${ticketKey || issueKey}:` : null,
      queueCard ? `Queue card: ${queueCard}` : null,
      text,
      mandatorySummary || null,
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      ok: true,
      polished: attachRecordedActivity(fallback, mandatorySummary),
      usedAi: false,
      note: "Posted draft as-is (add OpenAI key in Settings to polish with AI).",
    };
  }

  try {
    const json = await openaiJson({
      body: {
        model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: getAiPrompt("jiraComment"),
          },
          {
            role: "user",
            content: [
              `Form reference / ticket number: ${ticketKey || issueKey || "unknown"}`,
              issueKey && ticketKey && issueKey !== ticketKey
                ? `Jira story: ${issueKey}`
                : "",
              queueCard ? `Queue card: ${queueCard}` : "",
              summary ? `Issue summary: ${summary}` : "",
              status ? `Status: ${status}` : "",
              sopStage ? `SOP stage: ${sopStage}` : "",
              mandatorySummary
                ? `Recorded activity (include these field values and clicks verbatim):\n${mandatorySummary}`
                : "",
              "",
              "Draft for a new additional comment:",
              text,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
      signal,
      feature: "jira_comment",
      cardId: queueCard,
    });
    const polished = String(json.choices?.[0]?.message?.content || "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!polished) {
      return {
        ok: true,
        polished: attachRecordedActivity(text, mandatorySummary),
        usedAi: false,
        note: "AI returned empty; using draft.",
      };
    }
    return { ok: true, polished: attachRecordedActivity(polished, mandatorySummary), usedAi: true, model };
  } catch (err) {
    return {
      ok: true,
      polished: attachRecordedActivity(text, mandatorySummary),
      usedAi: false,
      note: err?.message || "AI polish failed; using draft.",
    };
  }
}

async function refineMeetingMinutes({ transcript, meeting } = {}) {
  const raw = String(transcript || "").trim();
  if (!raw) {
    return { ok: false, error: "No transcript to refine. Start MOM recording during the call." };
  }
  const { apiKey, model } = getOpenAiConfig();
  if (!apiKey) {
    return { ok: false, error: "Add an API key in Settings to refine meeting minutes." };
  }
  const title = String(meeting?.subject || "Ad-hoc meeting").trim();
  const when = [meeting?.start, meeting?.end].filter(Boolean).join(" → ");
  const attendees = Array.isArray(meeting?.attendees) ? meeting.attendees.filter(Boolean).join(", ") : "";
  try {
    const json = await openaiJson({
      body: {
        model,
        temperature: 0.2,
        max_tokens: 1800,
        messages: [
          { role: "system", content: getAiPrompt("momRefine") },
          {
            role: "user",
            content: [
              `Meeting title: ${title}`,
              when ? `Time: ${when}` : "",
              meeting?.organizer ? `Organizer: ${meeting.organizer}` : "",
              attendees ? `Calendar invitees (not confirmed speakers): ${attendees}` : "",
              "",
              "Speaker labels come from Teams on-screen tiles, not from names mentioned in the audio. Keep those labels. Do not rename anyone from 'this is X' in the words.",
              "",
              "Speaker-turn transcript:",
              raw.slice(0, 24000),
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
      feature: "mom_refine",
    });
    const text = String(json.choices?.[0]?.message?.content || "").trim();
    if (!text) return { ok: false, error: "AI returned an empty MOM." };
    return { ok: true, text, model };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not refine meeting minutes." };
  }
}

async function readTeamsMeetingFrame({ dataUrl } = {}) {
  const imageUrl = String(dataUrl || "").trim();
  if (!imageUrl) return { ok: false, error: "No meeting window image." };
  const { model, hasKey } = getOpenAiConfig();
  if (!hasKey) return { ok: false, error: "Add an API key in Settings." };
  const visionModel = /mini/i.test(String(model || "")) ? "gpt-4o" : model;
  try {
    const json = await openaiJson({
      body: {
        model: visionModel,
        temperature: 0,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              'You are reading a Microsoft Teams gallery screenshot. Ignore the LiveTrack MOM sidebar. Return JSON only: {"participants":["exact names under EVERY visible tile"],"speaking":"exact name of who is talking now"}. Copy names exactly, including (Guest), e.g. "Mitin (Guest)", "situn (Guest)", "Harish Apuri". speaking is the tile with a glowing/speaking border or an unmuted mic icon — not merely the largest tile. If two guests are visible, list both. Never collapse everyone into one name.',
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Who is on the tiles, and who is speaking right now?" },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      },
      feature: "mom_teams_frame",
    });
    const { parseTeamsFrameJson } = require("./mom-teams");
    const parsed = parseTeamsFrameJson(json.choices?.[0]?.message?.content || "");
    return { ...parsed, model };
  } catch (err) {
    return { ok: false, error: err?.message || "Could not read meeting tiles." };
  }
}

module.exports = {
  streamChat,
  buildChatSystemPrompt,
  buildUserContent,
  transcribeAudio,
  synthesizeSpeech,
  refineMeetingMinutes,
  readTeamsMeetingFrame,
  normalizeTtsVoice,
  audioExtensionFor,
  proposeAgentFill,
  buildLocalAgentProposals,
  primaryQuestValue,
  coachStuckStep,
  repairFailedStep,
  judgeValueMatch,
  polishJiraCommentDraft,
  attachRecordedActivity,
  explainPage,
  getExplainPageSystem,
  getDraftJiraFromShotSystem,
  getAiPrompt,
  loadAiRules,
  parseAiRulesMarkdown,
  resolveAiRulesPath,
  get EXPLAIN_PAGE_SYSTEM() {
    return getExplainPageSystem();
  },
  get DRAFT_JIRA_FROM_SHOT_SYSTEM() {
    return getDraftJiraFromShotSystem();
  },
  buildExplainPageUserContent,
  isUsefulExplainSnippet,
  draftJiraFromScreenshot,
  draftJiraFromDeskMaterials,
  getDraftJiraFromMaterialsSystem,
  parseTicketDraftJson,
  fallbackTicketDraft,
  draftMailFromScreenshot,
  parseMailDraftJson,
  formatMailStoryBlock,
  formatMailComment,
  fallbackMailDraft,
  AGENT_TOOLS,
};
