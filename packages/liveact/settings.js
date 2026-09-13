const fs = require("fs");
const path = require("path");
const {
  defaultProjectRoot,
  defaultSettingsPath,
  migrateLegacyDocumentsCoact,
} = require("./documents");

function settingsPath() {
  migrateLegacyDocumentsCoact();
  return defaultSettingsPath();
}

const DEFAULTS = {
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  /** OpenAI-compatible chat completions URL (company gateway or Gemini proxy). */
  openaiChatCompletionsUrl: "https://api.openai.com/v1/chat/completions",
  openaiSpeechUrl: "https://api.openai.com/v1/audio/speech",
  openaiTranscriptionsUrl: "https://api.openai.com/v1/audio/transcriptions",
  /** Empty = use defaultProjectRoot()/executions or COACT_EXECUTIONS_ROOT */
  executionsRoot: "",
  /** Jira Cloud (email + API token) */
  jiraBaseUrl: "",
  jiraEmail: "",
  jiraApiToken: "",
  jiraJql: "assignee = currentUser() ORDER BY updated ASC",
  jiraStaleDays: 2,
  jiraPollMinutes: 5,
  jiraStatusMap: {
    "To Do": "Step 1 – Intake",
    Open: "Step 1 – Intake",
    "In Progress": "Step 2 – Working",
    "In Review": "Step 3 – Review",
    Done: "Step 4 – Complete",
    Blocked: "Blocked",
  },
  jiraCardKeyField: "jiraKey",
  jiraProjectKey: "LIVEACT",
  /** Weekly digest delivery */
  digestOptIn: true,
  digestEnabledChannels: ["dashboard", "slack", "email"],
  digestSlackWebhookUrl: "",
  digestRecipients: "",
  digestDashboardUrl: "http://127.0.0.1:4175",
  digestSmtp: {
    host: "",
    port: 465,
    user: "",
    pass: "",
    from: "",
  },
  /** Chrome DevTools Protocol for in-app HTML tracking */
  chromeDebugUrl: "http://127.0.0.1:9222",
  /**
   * DPIP governance (Phase 2, lightweight RBAC for a local tool — no auth
   * server). Empty list = everyone is treated as an SME (backward
   * compatible default for solo/small-team use). Non-empty = only these OS
   * usernames may approve SOP drafts / datasets from the dashboard.
   */
  smeUsers: [],
  /** Digital Employee Agent (DPIP future phase) — opt-in unattended runs. */
  digitalEmployeeEnabled: false,
  /** Spoken replies are opt-in via the Speak button on each message */
  voiceAutoSpeak: false,
  /** Default slightly slow — OpenAI TTS at 1.0 often feels rushed for alerts */
  voiceRate: 0.85,
  voicePitch: 1,
  voiceName: "",
  /** Microsoft Graph (Outlook calendar) — public client device-code login */
  outlookTenantId: require("./outlook-defaults").outlookTenantId,
  outlookClientId: require("./outlook-defaults").outlookClientId,
  outlookPreferredEmail: "",
  outlookAccessToken: "",
  outlookRefreshToken: "",
  outlookTokenExpiresAt: 0,
  outlookAccountName: "",
  outlookAccountGivenName: "",
  momGreetingName: "",
};

function normalizeOutlookTenant(value) {
  let raw = String(value || "").trim();
  if (!raw) return DEFAULTS.outlookTenantId;
  // Repair "<guid>consumers" paste mistakes
  if (
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}consumers?$/i.test(
      raw,
    )
  ) {
    return "consumers";
  }
  const lower = raw.toLowerCase();
  // Personal Microsoft accounts (shared consumers tenant GUID)
  if (
    lower === "f8cdef31-a31e-4b4a-93e4-5f571e91255a" ||
    lower === "consumers" ||
    lower === "consumer"
  ) {
    return "consumers";
  }
  if (lower === "organisation" || lower === "organization") return "organizations";
  if (lower === "organizations" || lower === "common") return lower;
  return raw;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeVoiceRate(value) {
  return clampNumber(value, 0.5, 1.4, DEFAULTS.voiceRate);
}

function normalizeVoicePitch(value) {
  return clampNumber(value, 0.5, 2, DEFAULTS.voicePitch);
}

function normalizeVoiceName(value) {
  return String(value || "").trim().slice(0, 120);
}

function normalizeHttpUrl(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return fallback;
    return u.toString();
  } catch {
    return fallback;
  }
}

function deriveCompatibleUrls(chatUrl) {
  const chat = normalizeHttpUrl(chatUrl, DEFAULTS.openaiChatCompletionsUrl);
  let speech = DEFAULTS.openaiSpeechUrl;
  let transcriptions = DEFAULTS.openaiTranscriptionsUrl;
  try {
    const u = new URL(chat);
    if (u.pathname.endsWith("/chat/completions")) {
      u.pathname = u.pathname.replace(/\/chat\/completions\/?$/, "/audio/speech");
      speech = u.toString();
      u.pathname = u.pathname.replace(/\/audio\/speech\/?$/, "/audio/transcriptions");
      transcriptions = u.toString();
    } else if (u.pathname.endsWith("/v1") || u.pathname.endsWith("/v1/")) {
      const base = chat.replace(/\/?$/, "/");
      speech = `${base}audio/speech`;
      transcriptions = `${base}audio/transcriptions`;
    }
  } catch {
    /* keep defaults */
  }
  return { chat, speech, transcriptions };
}

/** Reject placeholder / invalid model ids (e.g. "openai") */
function normalizeModel(value) {
  const model = String(value || "").trim();
  if (!model) return DEFAULTS.openaiModel;
  if (/^openai$/i.test(model)) return DEFAULTS.openaiModel;
  if (!/^[a-zA-Z0-9._:/-]+$/.test(model)) return DEFAULTS.openaiModel;
  return model;
}

function normalizeExecutionsRoot(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return path.resolve(raw);
}

function ensureParent() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
}

function normalizeJiraStaleDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULTS.jiraStaleDays;
  return Math.min(90, Math.max(0.5, n));
}

function normalizeJiraPollMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULTS.jiraPollMinutes;
  return Math.min(120, Math.max(1, Math.round(n)));
}

function normalizeJiraStatusMap(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const key = String(k || "").trim();
      const val = String(v || "").trim();
      if (key && val) out[key] = val;
    }
    if (Object.keys(out).length) return out;
  }
  return { ...DEFAULTS.jiraStatusMap };
}

function sanitizeJiraSecret(value) {
  let s = String(value ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  s = s.replace(/^Bearer\s+/i, "").trim();
  for (let i = 0; i < 4; i++) {
    const q = s[0];
    if ((q === '"' || q === "'") && s.length >= 2 && s[s.length - 1] === q) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return s.replace(/^Bearer\s+/i, "").replace(/[\r\n]+/g, "").trim();
}

/** Settings UI masks / placeholders must never be persisted as the API token. */
function isPlaceholderJiraSecret(value) {
  const s = String(value ?? "").trim();
  if (!s) return true;
  if (/^[•●∙·*xX]+$/.test(s)) return true;
  if (/^token saved$/i.test(s)) return true;
  if (/^atlassian api token$/i.test(s)) return true;
  if (/saved/i.test(s) && /paste to replace/i.test(s)) return true;
  if (/paste (an? )?api token/i.test(s)) return true;
  return false;
}

function isBlankJiraSecret(value) {
  if (value == null) return true;
  const s = sanitizeJiraSecret(value);
  return !s || isPlaceholderJiraSecret(s);
}

function readRawSettingsFile() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    return null;
  }
}

function keepStoredJiraToken(...candidates) {
  for (const candidate of candidates) {
    if (isBlankJiraSecret(candidate)) continue;
    return sanitizeJiraSecret(candidate);
  }
  return "";
}

function normalizeSavedJiraBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return require("./jira").originFromJiraSiteUrl(raw);
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function normalizeJiraProjectRef(value) {
  const v = String(value || "").trim();
  if (!v) return DEFAULTS.jiraProjectKey;
  if (!/\s/.test(v) && /^[A-Za-z][A-Za-z0-9_]*$/.test(v)) return v.toUpperCase();
  return v;
}

function parseJiraStatusMapInput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return normalizeJiraStatusMap(value);
  }
  const raw = String(value || "").trim();
  if (!raw) return { ...DEFAULTS.jiraStatusMap };
  try {
    return normalizeJiraStatusMap(JSON.parse(raw));
  } catch {
    return { ...DEFAULTS.jiraStatusMap };
  }
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return {
      ...DEFAULTS,
      ...raw,
      openaiApiKey: String(raw.openaiApiKey || process.env.OPENAI_API_KEY || ""),
      openaiModel: normalizeModel(raw.openaiModel || DEFAULTS.openaiModel),
      openaiChatCompletionsUrl: normalizeHttpUrl(
        raw.openaiChatCompletionsUrl || process.env.OPENAI_CHAT_COMPLETIONS_URL || "",
        DEFAULTS.openaiChatCompletionsUrl,
      ),
      openaiSpeechUrl: normalizeHttpUrl(
        raw.openaiSpeechUrl || process.env.OPENAI_SPEECH_URL || "",
        DEFAULTS.openaiSpeechUrl,
      ),
      openaiTranscriptionsUrl: normalizeHttpUrl(
        raw.openaiTranscriptionsUrl || process.env.OPENAI_TRANSCRIPTIONS_URL || "",
        DEFAULTS.openaiTranscriptionsUrl,
      ),
      executionsRoot: normalizeExecutionsRoot(raw.executionsRoot || ""),
      jiraBaseUrl: normalizeSavedJiraBaseUrl(raw.jiraBaseUrl || ""),
      jiraEmail: sanitizeJiraSecret(raw.jiraEmail || ""),
      jiraApiToken: sanitizeJiraSecret(raw.jiraApiToken || process.env.JIRA_API_TOKEN || ""),
      jiraJql: ensureAssigneeJql(raw.jiraJql || DEFAULTS.jiraJql),
      jiraStaleDays: normalizeJiraStaleDays(raw.jiraStaleDays),
      jiraPollMinutes: normalizeJiraPollMinutes(raw.jiraPollMinutes),
      jiraStatusMap: normalizeJiraStatusMap(raw.jiraStatusMap),
      jiraCardKeyField: String(raw.jiraCardKeyField || DEFAULTS.jiraCardKeyField).trim() || "jiraKey",
      jiraProjectKey: normalizeJiraProjectRef(raw.jiraProjectKey),
      digestOptIn: raw.digestOptIn !== false,
      digestEnabledChannels: Array.isArray(raw.digestEnabledChannels)
        ? raw.digestEnabledChannels
        : [...DEFAULTS.digestEnabledChannels],
      digestSlackWebhookUrl: String(raw.digestSlackWebhookUrl || "").trim(),
      digestRecipients: String(raw.digestRecipients || "").trim(),
      digestDashboardUrl: String(raw.digestDashboardUrl || DEFAULTS.digestDashboardUrl).trim(),
      digestSmtp: {
        ...DEFAULTS.digestSmtp,
        ...(raw.digestSmtp && typeof raw.digestSmtp === "object" ? raw.digestSmtp : {}),
      },
      chromeDebugUrl: String(raw.chromeDebugUrl || DEFAULTS.chromeDebugUrl).trim() || DEFAULTS.chromeDebugUrl,
      smeUsers: Array.isArray(raw.smeUsers) ? raw.smeUsers.map(String).filter(Boolean) : [],
      digitalEmployeeEnabled: Boolean(raw.digitalEmployeeEnabled),
      voiceAutoSpeak: false,
      voiceRate: normalizeVoiceRate(raw.voiceRate),
      voicePitch: normalizeVoicePitch(raw.voicePitch),
      voiceName: normalizeVoiceName(raw.voiceName),
      outlookTenantId: normalizeOutlookTenant(
        raw.outlookTenantId || DEFAULTS.outlookTenantId,
      ),
      outlookClientId: (() => {
        const id = String(raw.outlookClientId || "").trim();
        if (!id || id === "ced2296f-c311-43d2-9568-0e48d555665e") {
          return DEFAULTS.outlookClientId;
        }
        return id;
      })(),
      outlookPreferredEmail: String(raw.outlookPreferredEmail || "").trim().slice(0, 120),
      outlookAccessToken: String(raw.outlookAccessToken || "").trim(),
      outlookRefreshToken: String(raw.outlookRefreshToken || "").trim(),
      outlookTokenExpiresAt: Number(raw.outlookTokenExpiresAt) || 0,
      outlookAccountName: String(raw.outlookAccountName || "").trim(),
      outlookAccountGivenName: String(raw.outlookAccountGivenName || "").trim(),
      momGreetingName: String(raw.momGreetingName || "").trim().slice(0, 80),
    };
  } catch {
    return {
      ...DEFAULTS,
      openaiApiKey: process.env.OPENAI_API_KEY || "",
      jiraApiToken: sanitizeJiraSecret(process.env.JIRA_API_TOKEN || ""),
      executionsRoot: "",
      jiraStatusMap: { ...DEFAULTS.jiraStatusMap },
      digestEnabledChannels: [...DEFAULTS.digestEnabledChannels],
      digestSmtp: { ...DEFAULTS.digestSmtp },
      smeUsers: [],
      digitalEmployeeEnabled: false,
      voiceAutoSpeak: false,
      voiceRate: DEFAULTS.voiceRate,
      voicePitch: DEFAULTS.voicePitch,
      voiceName: "",
    };
  }
}

function persistableSettings(next, keptToken) {
  const token = keepStoredJiraToken(keptToken, next.jiraApiToken);
  return {
    openaiApiKey: next.openaiApiKey || "",
    openaiModel: normalizeModel(next.openaiModel),
    openaiChatCompletionsUrl: normalizeHttpUrl(
      next.openaiChatCompletionsUrl,
      DEFAULTS.openaiChatCompletionsUrl,
    ),
    openaiSpeechUrl: normalizeHttpUrl(next.openaiSpeechUrl, DEFAULTS.openaiSpeechUrl),
    openaiTranscriptionsUrl: normalizeHttpUrl(
      next.openaiTranscriptionsUrl,
      DEFAULTS.openaiTranscriptionsUrl,
    ),
    executionsRoot: next.executionsRoot || "",
    jiraBaseUrl: normalizeSavedJiraBaseUrl(next.jiraBaseUrl || ""),
    jiraEmail: sanitizeJiraSecret(next.jiraEmail || ""),
    jiraApiToken: token,
    jiraJql: ensureAssigneeJql(next.jiraJql),
    jiraStaleDays: normalizeJiraStaleDays(next.jiraStaleDays),
    jiraPollMinutes: normalizeJiraPollMinutes(next.jiraPollMinutes),
    jiraStatusMap: normalizeJiraStatusMap(next.jiraStatusMap),
    jiraCardKeyField: String(next.jiraCardKeyField || DEFAULTS.jiraCardKeyField).trim() || "jiraKey",
    jiraProjectKey: normalizeJiraProjectRef(next.jiraProjectKey),
    digestOptIn: next.digestOptIn !== false,
    digestEnabledChannels: Array.isArray(next.digestEnabledChannels)
      ? next.digestEnabledChannels
      : [...DEFAULTS.digestEnabledChannels],
    digestSlackWebhookUrl: String(next.digestSlackWebhookUrl || "").trim(),
    digestRecipients: String(next.digestRecipients || "").trim(),
    digestDashboardUrl: String(next.digestDashboardUrl || DEFAULTS.digestDashboardUrl).trim(),
    digestSmtp: {
      ...DEFAULTS.digestSmtp,
      ...(next.digestSmtp && typeof next.digestSmtp === "object" ? next.digestSmtp : {}),
    },
    chromeDebugUrl: String(next.chromeDebugUrl || DEFAULTS.chromeDebugUrl).trim() || DEFAULTS.chromeDebugUrl,
    smeUsers: Array.isArray(next.smeUsers) ? next.smeUsers.map(String).filter(Boolean) : [],
    digitalEmployeeEnabled: Boolean(next.digitalEmployeeEnabled),
    voiceAutoSpeak: false,
    voiceRate: normalizeVoiceRate(next.voiceRate),
    voicePitch: normalizeVoicePitch(next.voicePitch),
    voiceName: normalizeVoiceName(next.voiceName),
    outlookTenantId: normalizeOutlookTenant(
      next.outlookTenantId || DEFAULTS.outlookTenantId,
    ),
    outlookClientId:
      String(next.outlookClientId || "").trim() || DEFAULTS.outlookClientId,
    outlookPreferredEmail: String(next.outlookPreferredEmail || "").trim().slice(0, 120),
    outlookAccessToken: String(next.outlookAccessToken || "").trim(),
    outlookRefreshToken: String(next.outlookRefreshToken || "").trim(),
    outlookTokenExpiresAt: Number(next.outlookTokenExpiresAt) || 0,
    outlookAccountName: String(next.outlookAccountName || "").trim(),
    outlookAccountGivenName: String(next.outlookAccountGivenName || "").trim(),
    momGreetingName: String(next.momGreetingName || "").trim().slice(0, 80),
  };
}

function collapseNestedAssigneeJql(jql) {
  const raw = String(jql || "").trim();
  if (!raw) return raw;
  const orderMatch = raw.match(/\s+(ORDER\s+BY\s+.+)$/i);
  const order = orderMatch ? orderMatch[1] : "ORDER BY updated ASC";
  const core = (orderMatch ? raw.slice(0, orderMatch.index) : raw).trim();
  const stripped = core.replace(/[()]/g, " ").replace(/\bAND\b/gi, " ").replace(/\s+/g, " ").trim();
  if (/^(assignee\s*=\s*currentUser(?:\s*\(\s*\))?\s*)+$/i.test(`${stripped} `)) {
    return `assignee = currentUser() ${order}`.trim();
  }
  return raw;
}

function ensureAssigneeJql(jql) {
  let raw = String(jql || "").trim();
  const fallback = DEFAULTS.jiraJql;
  if (!raw) return fallback;
  // Keep Done/Closed visible for queue sync (strip common open-only filters)
  raw = raw.replace(
    /\s*(AND|OR)?\s*status\s*!=\s*"?(Done|Closed|Resolved|Complete|Completed)"?/gi,
    ""
  );
  raw = raw.replace(/\s*(AND|OR)?\s*status\s+not\s+in\s*\([^)]*\)/gi, "");
  raw = raw.replace(/\s*(AND|OR)?\s*statusCategory\s*!=\s*"?Done"?/gi, "");
  raw = raw.replace(/(?<!currentUser)\(\s*\)/gi, "");
  raw = raw.replace(/\bAND\s+AND\b/gi, "AND").replace(/\bOR\s+OR\b/gi, "OR");
  raw = raw.replace(/\bAND\s+ORDER\b/gi, "ORDER").replace(/\bOR\s+ORDER\b/gi, "ORDER");
  raw = raw.replace(/^\s*(AND|OR)\s+/i, "").replace(/\s+(AND|OR)\s*$/i, "");
  raw = raw.replace(/\s{2,}/g, " ").trim();
  if (!raw) return fallback;
  if (/\bassignee\s*=\s*currentUser/i.test(raw)) {
    return collapseNestedAssigneeJql(raw);
  }
  const withoutOrder = raw.replace(/\s+ORDER\s+BY\s+.+$/i, "").trim();
  const orderMatch = raw.match(/\s+(ORDER\s+BY\s+.+)$/i);
  const order = orderMatch ? orderMatch[1] : "ORDER BY updated ASC";
  const core = withoutOrder
    ? `assignee = currentUser() AND (${withoutOrder})`
    : "assignee = currentUser()";
  return collapseNestedAssigneeJql(`${core} ${order}`.trim());
}

function saveSettings(partial) {
  const prev = loadSettings();
  const rawFile = readRawSettingsFile() || {};
  const clean = {};
  for (const [key, value] of Object.entries(partial || {})) {
    if (value !== undefined) clean[key] = value;
  }
  // Blank/placeholder token from Settings must not wipe a stored secret.
  if ("jiraApiToken" in clean && isBlankJiraSecret(clean.jiraApiToken)) {
    delete clean.jiraApiToken;
  }
  if (clean.openaiApiKey != null && !String(clean.openaiApiKey).trim()) {
    delete clean.openaiApiKey;
  }
  const next = { ...prev, ...clean };
  if (clean.openaiModel != null) {
    next.openaiModel = normalizeModel(clean.openaiModel);
  }
  if (clean.openaiChatCompletionsUrl != null) {
    next.openaiChatCompletionsUrl = normalizeHttpUrl(
      clean.openaiChatCompletionsUrl,
      DEFAULTS.openaiChatCompletionsUrl,
    );
    const derived = deriveCompatibleUrls(next.openaiChatCompletionsUrl);
    if (!clean.openaiSpeechUrl) next.openaiSpeechUrl = derived.speech;
    if (!clean.openaiTranscriptionsUrl) next.openaiTranscriptionsUrl = derived.transcriptions;
  }
  if (clean.openaiSpeechUrl != null) {
    next.openaiSpeechUrl = normalizeHttpUrl(clean.openaiSpeechUrl, DEFAULTS.openaiSpeechUrl);
  }
  if (clean.openaiTranscriptionsUrl != null) {
    next.openaiTranscriptionsUrl = normalizeHttpUrl(
      clean.openaiTranscriptionsUrl,
      DEFAULTS.openaiTranscriptionsUrl,
    );
  }
  if (clean.executionsRoot != null) {
    next.executionsRoot = normalizeExecutionsRoot(clean.executionsRoot);
  }
  if (clean.jiraStaleDays != null) {
    next.jiraStaleDays = normalizeJiraStaleDays(clean.jiraStaleDays);
  }
  if (clean.jiraPollMinutes != null) {
    next.jiraPollMinutes = normalizeJiraPollMinutes(clean.jiraPollMinutes);
  }
  if (clean.jiraBaseUrl != null) {
    next.jiraBaseUrl = normalizeSavedJiraBaseUrl(clean.jiraBaseUrl);
  }
  if (clean.jiraEmail != null) {
    next.jiraEmail = sanitizeJiraSecret(clean.jiraEmail);
  }
  if (clean.jiraApiToken != null) {
    const tok = keepStoredJiraToken(clean.jiraApiToken);
    if (tok) next.jiraApiToken = tok;
    else next.jiraApiToken = keepStoredJiraToken(prev.jiraApiToken, rawFile.jiraApiToken);
  } else {
    next.jiraApiToken = keepStoredJiraToken(
      next.jiraApiToken,
      prev.jiraApiToken,
      rawFile.jiraApiToken,
    );
  }
  if (clean.jiraJql != null) {
    next.jiraJql = ensureAssigneeJql(clean.jiraJql);
  }
  if (clean.jiraStatusMap != null) {
    next.jiraStatusMap = parseJiraStatusMapInput(clean.jiraStatusMap);
  }
  if (clean.jiraCardKeyField != null) {
    next.jiraCardKeyField =
      String(clean.jiraCardKeyField).trim() || DEFAULTS.jiraCardKeyField;
  }
  if (clean.jiraProjectKey != null) {
    next.jiraProjectKey = normalizeJiraProjectRef(clean.jiraProjectKey);
  }
  if (clean.digestOptIn != null) next.digestOptIn = Boolean(clean.digestOptIn);
  if (clean.digestEnabledChannels != null) {
    next.digestEnabledChannels = Array.isArray(clean.digestEnabledChannels)
      ? clean.digestEnabledChannels
      : [...DEFAULTS.digestEnabledChannels];
  }
  if (clean.digestSlackWebhookUrl != null) {
    next.digestSlackWebhookUrl = String(clean.digestSlackWebhookUrl).trim();
  }
  if (clean.digestRecipients != null) {
    next.digestRecipients = String(clean.digestRecipients).trim();
  }
  if (clean.digestDashboardUrl != null) {
    next.digestDashboardUrl = String(clean.digestDashboardUrl).trim();
  }
  if (clean.digestSmtp != null && typeof clean.digestSmtp === "object") {
    next.digestSmtp = {
      ...DEFAULTS.digestSmtp,
      ...(next.digestSmtp || {}),
      ...clean.digestSmtp,
    };
  }
  if (clean.chromeDebugUrl != null) {
    next.chromeDebugUrl =
      String(clean.chromeDebugUrl).trim() || DEFAULTS.chromeDebugUrl;
  }
  if (clean.smeUsers != null) {
    next.smeUsers = Array.isArray(clean.smeUsers)
      ? clean.smeUsers.map(String).filter(Boolean)
      : String(clean.smeUsers)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  }
  if (clean.digitalEmployeeEnabled != null) {
    next.digitalEmployeeEnabled = Boolean(clean.digitalEmployeeEnabled);
  }
  if (clean.voiceAutoSpeak != null) {
    next.voiceAutoSpeak = Boolean(clean.voiceAutoSpeak);
  }
  if (clean.voiceRate != null) next.voiceRate = normalizeVoiceRate(clean.voiceRate);
  if (clean.voicePitch != null) next.voicePitch = normalizeVoicePitch(clean.voicePitch);
  if (clean.voiceName != null) next.voiceName = normalizeVoiceName(clean.voiceName);
  if (clean.outlookTenantId != null) {
    next.outlookTenantId = normalizeOutlookTenant(clean.outlookTenantId);
  }
  if (clean.outlookClientId != null) {
    next.outlookClientId =
      String(clean.outlookClientId).trim() || DEFAULTS.outlookClientId;
  }
  if (clean.outlookPreferredEmail != null) {
    next.outlookPreferredEmail = String(clean.outlookPreferredEmail)
      .trim()
      .slice(0, 120);
  }
  if (clean.outlookAccessToken != null) {
    next.outlookAccessToken = String(clean.outlookAccessToken);
  }
  if (clean.outlookRefreshToken != null) {
    next.outlookRefreshToken = String(clean.outlookRefreshToken);
  }
  if (clean.outlookTokenExpiresAt != null) {
    next.outlookTokenExpiresAt = Number(clean.outlookTokenExpiresAt) || 0;
  }
  if (clean.outlookAccountName != null) {
    next.outlookAccountName = String(clean.outlookAccountName).trim();
  }
  if (clean.outlookAccountGivenName != null) {
    next.outlookAccountGivenName = String(clean.outlookAccountGivenName).trim();
  }
  if (clean.momGreetingName != null) {
    next.momGreetingName = String(clean.momGreetingName).trim().slice(0, 80);
  }
  ensureParent();
  const keptToken = keepStoredJiraToken(
    next.jiraApiToken,
    prev.jiraApiToken,
    rawFile.jiraApiToken,
  );
  next.jiraApiToken = keptToken;
  const stored = persistableSettings(next, keptToken);
  stored.jiraApiToken = keepStoredJiraToken(
    stored.jiraApiToken,
    keptToken,
    prev.jiraApiToken,
    rawFile.jiraApiToken,
  );
  fs.writeFileSync(settingsPath(), JSON.stringify(stored, null, 2), "utf8");
  console.log("[livetrack] settings saved", {
    path: settingsPath(),
    jiraHasToken: Boolean(stored.jiraApiToken),
    jiraProjectKey: stored.jiraProjectKey || "",
  });
  return {
    hasKey: Boolean(next.openaiApiKey),
    model: normalizeModel(next.openaiModel),
    chatCompletionsUrl: normalizeHttpUrl(
      next.openaiChatCompletionsUrl,
      DEFAULTS.openaiChatCompletionsUrl,
    ),
    speechUrl: normalizeHttpUrl(next.openaiSpeechUrl, DEFAULTS.openaiSpeechUrl),
    transcriptionsUrl: normalizeHttpUrl(
      next.openaiTranscriptionsUrl,
      DEFAULTS.openaiTranscriptionsUrl,
    ),
    executionsRoot: resolveExecutionsRoot(next),
    jiraConfigured: Boolean(stored.jiraBaseUrl && stored.jiraEmail && stored.jiraApiToken),
    jiraHasToken: Boolean(stored.jiraApiToken),
    jiraProjectKey: stored.jiraProjectKey || DEFAULTS.jiraProjectKey,
    settingsPath: settingsPath(),
    voiceName: normalizeVoiceName(next.voiceName),
    voiceRate: normalizeVoiceRate(next.voiceRate),
    voicePitch: normalizeVoicePitch(next.voicePitch),
  };
}

/**
 * Shared executions folder for multi-agent Excel logs.
 * Priority: COACT_EXECUTIONS_ROOT env → settings.executionsRoot → <project>/executions
 */
function resolveExecutionsRoot(settings) {
  const env = String(process.env.COACT_EXECUTIONS_ROOT || "").trim();
  if (env) return path.resolve(env);
  const s = settings || loadSettings();
  if (s.executionsRoot) return path.resolve(s.executionsRoot);
  return path.join(defaultProjectRoot(), "executions");
}

function getOpenAiConfig() {
  const s = loadSettings();
  const chatCompletionsUrl = normalizeHttpUrl(
    s.openaiChatCompletionsUrl,
    DEFAULTS.openaiChatCompletionsUrl,
  );
  const derived = deriveCompatibleUrls(chatCompletionsUrl);
  return {
    apiKey: s.openaiApiKey || "",
    model: normalizeModel(s.openaiModel),
    hasKey: Boolean(s.openaiApiKey),
    chatCompletionsUrl,
    speechUrl: normalizeHttpUrl(s.openaiSpeechUrl, derived.speech),
    transcriptionsUrl: normalizeHttpUrl(s.openaiTranscriptionsUrl, derived.transcriptions),
  };
}

function getAppSettings() {
  const s = loadSettings();
  return {
    hasKey: Boolean(s.openaiApiKey),
    model: normalizeModel(s.openaiModel),
    chatCompletionsUrl: normalizeHttpUrl(
      s.openaiChatCompletionsUrl,
      DEFAULTS.openaiChatCompletionsUrl,
    ),
    speechUrl: normalizeHttpUrl(s.openaiSpeechUrl, DEFAULTS.openaiSpeechUrl),
    transcriptionsUrl: normalizeHttpUrl(
      s.openaiTranscriptionsUrl,
      DEFAULTS.openaiTranscriptionsUrl,
    ),
    executionsRoot: resolveExecutionsRoot(s),
    executionsRootOverride: s.executionsRoot || "",
    jiraBaseUrl: s.jiraBaseUrl || "",
    jiraEmail: s.jiraEmail || "",
    jiraHasToken: Boolean(s.jiraApiToken),
    settingsPath: settingsPath(),
    jiraJql: s.jiraJql || DEFAULTS.jiraJql,
    jiraStaleDays: s.jiraStaleDays,
    jiraPollMinutes: s.jiraPollMinutes,
    jiraStatusMap: normalizeJiraStatusMap(s.jiraStatusMap),
    jiraCardKeyField: s.jiraCardKeyField || DEFAULTS.jiraCardKeyField,
    jiraProjectKey: s.jiraProjectKey || DEFAULTS.jiraProjectKey,
    jiraConfigured: Boolean(s.jiraBaseUrl && s.jiraEmail && s.jiraApiToken),
    digestOptIn: s.digestOptIn !== false,
    digestEnabledChannels: s.digestEnabledChannels || [...DEFAULTS.digestEnabledChannels],
    digestSlackWebhookUrl: s.digestSlackWebhookUrl || "",
    digestRecipients: s.digestRecipients || "",
    digestDashboardUrl: s.digestDashboardUrl || DEFAULTS.digestDashboardUrl,
    digestSmtp: { ...DEFAULTS.digestSmtp, ...(s.digestSmtp || {}) },
    chromeDebugUrl: s.chromeDebugUrl || DEFAULTS.chromeDebugUrl,
    smeUsers: Array.isArray(s.smeUsers) ? s.smeUsers : [],
    digitalEmployeeEnabled: Boolean(s.digitalEmployeeEnabled),
    voiceAutoSpeak: false,
    voiceRate: normalizeVoiceRate(s.voiceRate),
    voicePitch: normalizeVoicePitch(s.voicePitch),
    voiceName: normalizeVoiceName(s.voiceName),
    outlookTenantId: normalizeOutlookTenant(
      s.outlookTenantId || DEFAULTS.outlookTenantId,
    ),
    outlookClientId: s.outlookClientId || DEFAULTS.outlookClientId || "",
    outlookPreferredEmail: s.outlookPreferredEmail || "",
    outlookConnected: Boolean(s.outlookAccessToken || s.outlookRefreshToken),
    outlookAccountName: s.outlookAccountName || "",
    outlookAccountGivenName: s.outlookAccountGivenName || "",
    momGreetingName: s.momGreetingName || "",
  };
}

/** DPIP governance (Phase 2): is `username` allowed to approve SOP drafts / datasets? Empty allowlist = everyone (backward compatible for solo use). */
function isSme(username) {
  const s = loadSettings();
  if (!Array.isArray(s.smeUsers) || !s.smeUsers.length) return true;
  const name = String(username || "").trim().toLowerCase();
  return s.smeUsers.some((u) => String(u).trim().toLowerCase() === name);
}

function getJiraConfig() {
  const s = loadSettings();
  return {
    jiraBaseUrl: s.jiraBaseUrl || "",
    jiraEmail: s.jiraEmail || "",
    jiraApiToken: s.jiraApiToken || "",
    jiraJql: s.jiraJql || DEFAULTS.jiraJql,
    jiraStaleDays: s.jiraStaleDays,
    jiraPollMinutes: s.jiraPollMinutes,
    jiraStatusMap: normalizeJiraStatusMap(s.jiraStatusMap),
    jiraCardKeyField: s.jiraCardKeyField || DEFAULTS.jiraCardKeyField,
    jiraProjectKey: s.jiraProjectKey || DEFAULTS.jiraProjectKey,
  };
}

module.exports = {
  get SETTINGS_PATH() {
    return settingsPath();
  },
  DEFAULTS,
  loadSettings,
  saveSettings,
  getOpenAiConfig,
  getAppSettings,
  getJiraConfig,
  resolveExecutionsRoot,
  normalizeJiraStatusMap,
  parseJiraStatusMapInput,
  isSme,
  isBlankJiraSecret,
  isPlaceholderJiraSecret,
  sanitizeJiraSecret,
};
