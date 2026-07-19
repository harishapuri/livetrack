const fs = require("fs");
const path = require("path");
const { getOpenAiConfig } = require("./settings");

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt" || ext === ".log" || ext === ".json" || ext === ".csv") {
    return "text/plain";
  }
  return "application/octet-stream";
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
      description: "Clear Coact marks and empty form fields on the page.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

async function openaiJson({ body, signal }) {
  const { apiKey } = getOpenAiConfig();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 240) || res.statusText}`);
  }
  return res.json();
}

async function streamCompletion({ body, signal, onDelta }) {
  const { apiKey } = getOpenAiConfig();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 240) || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

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
  return full;
}

/**
 * Stream OpenAI chat with optional tool loop for agentic actions.
 * executeTool(name, args) must return a JSON-serializable result.
 */
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
}) {
  const { model, hasKey } = getOpenAiConfig();
  if (!hasKey) {
    throw new Error("Add your OpenAI API key in Settings (gear icon).");
  }

  const system = [
    "You are liveAct, an attended form-fill assistant.",
    "Be concise. Help the human track steps, fix misses, and decide what to type.",
    "You may call tools to inspect the live form and apply the current gate step.",
    "Prefer get_live_state before acting. Only fill/click the step the human needs next.",
    "Do not invent filled values that are not in quest data or user messages.",
    "After tools run, summarize what you did in plain language.",
    stepContext ? `Current steps:\n${stepContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");

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

  const useTools = typeof executeTool === "function" && autoApplyTools;
  let toolRounds = 0;

  while (useTools && toolRounds < 4) {
    toolRounds += 1;
    const json = await openaiJson({
      body: {
        model,
        stream: false,
        tools: AGENT_TOOLS,
        tool_choice: "auto",
        messages: thread,
      },
      signal,
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
      messages: thread,
    },
    signal,
    onDelta,
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

  const system = [
    "You are liveAct. Before autofill, explain why each proposed field value fits.",
    "Reply JSON only:",
    '{"proposals":[{"stepId":"string","value":"string","reason":"max 18 words"}]}',
    "Rules:",
    "- Include every fill step listed that has a known value.",
    "- value MUST match the known case value for that step (do not invent or rewrite).",
    "- reason: short plain-English why this value belongs in that field.",
    "- No markdown, no extra keys.",
  ].join("\n");

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
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
      throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 240) || res.statusText}`);
    }

    const json = await res.json();
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

  const system = [
    "You are liveAct, an attended form-fill coach.",
    "The human is stuck on ONE step. Reply with JSON only:",
    '{"tip":"1-3 short imperative instructions max 55 words","suggestedValue":"string or empty","canApply":true|false,"canRetry":true|false,"confidence":"high"|"low"}',
    "canApply true ONLY when the step is mandatory AND action is fill AND a concrete quest value is known.",
    "If the step is not mandatory, canApply must be false and suggestedValue must be empty — any filled value is enough.",
    "When canApply is true, tip must briefly explain that this is a mandatory step and why the suggested value helps.",
    "confidence high only when offering Approve for a mandatory step with a known value.",
    "canRetry true when the locator might be wrong and a broader match could help.",
    "No markdown. Never invent values not in quest data.",
  ].join("\n");

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

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 240) || res.statusText}`);
  }

  const json = await res.json();
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

  const system = [
    "You repair a single failed liveAct SOP step. Reply JSON only:",
    '{"action":"retry_broad"|"apply_value"|"rewrite_step"|"click_alt"|"skip","broadMatch":true|false,"valueOverride":"","stepPatch":{"selector":"","findByLabel":[],"findByText":[],"findButtonByText":[]},"altFindByText":"","reason":"short"}',
    "action meanings:",
    "- retry_broad: looser locator (default when field not found)",
    "- apply_value: fill again with known quest value",
    "- rewrite_step: provide stepPatch locators from the DOM snippet",
    "- click_alt: different click text in altFindByText",
    "- skip: step already done or not on this page — mark done and continue",
    "Never invent fill values not in quest data. Prefer rewrite_step when DOM shows a clear label.",
  ].join("\n");

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

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 240) || res.statusText}`);
  }

  const json = await res.json();
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
      .join("\n");
    return {
      ok: true,
      polished: fallback,
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
            content: [
              "You write an ADDITIONAL Jira issue comment from the user's draft.",
              "Output only the new comment body — do not edit or replace prior comments.",
              "Always include: (1) form reference / ticket number when provided, (2) queue card name, (3) mandatory field fill status when provided.",
              "If a Jira story key is also provided, mention it separately from the form reference.",
              "Keep the author's meaning. Be concise (2–8 sentences).",
              "Use plain text only — no markdown fences, no preamble.",
            ].join(" "),
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
              mandatorySummary ? `Mandatory fields:\n${mandatorySummary}` : "",
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
    });
    const polished = String(json.choices?.[0]?.message?.content || "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!polished) {
      return { ok: true, polished: text, usedAi: false, note: "AI returned empty; using draft." };
    }
    return { ok: true, polished, usedAi: true, model };
  } catch (err) {
    return {
      ok: true,
      polished: text,
      usedAi: false,
      note: err?.message || "AI polish failed; using draft.",
    };
  }
}

module.exports = {
  streamChat,
  buildUserContent,
  proposeAgentFill,
  buildLocalAgentProposals,
  primaryQuestValue,
  coachStuckStep,
  repairFailedStep,
  judgeValueMatch,
  polishJiraCommentDraft,
  AGENT_TOOLS,
};
