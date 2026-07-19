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
};

/** Reject placeholder / invalid model ids (e.g. "openai") */
function normalizeModel(value) {
  const model = String(value || "").trim();
  if (!model) return DEFAULTS.openaiModel;
  if (/^openai$/i.test(model)) return DEFAULTS.openaiModel;
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) return DEFAULTS.openaiModel;
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
      executionsRoot: normalizeExecutionsRoot(raw.executionsRoot || ""),
      jiraBaseUrl: String(raw.jiraBaseUrl || "").trim().replace(/\/+$/, ""),
      jiraEmail: String(raw.jiraEmail || "").trim(),
      jiraApiToken: String(raw.jiraApiToken || process.env.JIRA_API_TOKEN || ""),
      jiraJql: ensureAssigneeJql(raw.jiraJql || DEFAULTS.jiraJql),
      jiraStaleDays: normalizeJiraStaleDays(raw.jiraStaleDays),
      jiraPollMinutes: normalizeJiraPollMinutes(raw.jiraPollMinutes),
      jiraStatusMap: normalizeJiraStatusMap(raw.jiraStatusMap),
      jiraCardKeyField: String(raw.jiraCardKeyField || DEFAULTS.jiraCardKeyField).trim() || "jiraKey",
    };
  } catch {
    return {
      ...DEFAULTS,
      openaiApiKey: process.env.OPENAI_API_KEY || "",
      jiraApiToken: process.env.JIRA_API_TOKEN || "",
      executionsRoot: "",
      jiraStatusMap: { ...DEFAULTS.jiraStatusMap },
    };
  }
}

function persistableSettings(next) {
  return {
    openaiApiKey: next.openaiApiKey || "",
    openaiModel: normalizeModel(next.openaiModel),
    executionsRoot: next.executionsRoot || "",
    jiraBaseUrl: String(next.jiraBaseUrl || "").trim().replace(/\/+$/, ""),
    jiraEmail: String(next.jiraEmail || "").trim(),
    jiraApiToken: next.jiraApiToken || "",
    jiraJql: ensureAssigneeJql(next.jiraJql),
    jiraStaleDays: normalizeJiraStaleDays(next.jiraStaleDays),
    jiraPollMinutes: normalizeJiraPollMinutes(next.jiraPollMinutes),
    jiraStatusMap: normalizeJiraStatusMap(next.jiraStatusMap),
    jiraCardKeyField: String(next.jiraCardKeyField || DEFAULTS.jiraCardKeyField).trim() || "jiraKey",
  };
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
  raw = raw.replace(/\(\s*\)/g, "");
  raw = raw.replace(/\bAND\s+AND\b/gi, "AND").replace(/\bOR\s+OR\b/gi, "OR");
  raw = raw.replace(/\bAND\s+ORDER\b/gi, "ORDER").replace(/\bOR\s+ORDER\b/gi, "ORDER");
  raw = raw.replace(/^\s*(AND|OR)\s+/i, "").replace(/\s+(AND|OR)\s*$/i, "");
  raw = raw.replace(/\s{2,}/g, " ").trim();
  if (!raw) return fallback;
  if (/\bassignee\s*=\s*currentUser\s*\(\s*\)/i.test(raw)) return raw;
  const withoutOrder = raw.replace(/\s+ORDER\s+BY\s+.+$/i, "").trim();
  const orderMatch = raw.match(/\s+(ORDER\s+BY\s+.+)$/i);
  const order = orderMatch ? orderMatch[1] : "ORDER BY updated ASC";
  const core = withoutOrder
    ? `assignee = currentUser() AND (${withoutOrder})`
    : "assignee = currentUser()";
  return `${core} ${order}`.trim();
}

function saveSettings(partial) {
  const clean = {};
  for (const [key, value] of Object.entries(partial || {})) {
    if (value !== undefined) clean[key] = value;
  }
  const next = { ...loadSettings(), ...clean };
  if (clean.openaiModel != null) {
    next.openaiModel = normalizeModel(clean.openaiModel);
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
    next.jiraBaseUrl = String(clean.jiraBaseUrl).trim().replace(/\/+$/, "");
  }
  if (clean.jiraEmail != null) {
    next.jiraEmail = String(clean.jiraEmail).trim();
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
  ensureParent();
  const stored = persistableSettings(next);
  fs.writeFileSync(settingsPath(), JSON.stringify(stored, null, 2), "utf8");
  return {
    hasKey: Boolean(next.openaiApiKey),
    model: normalizeModel(next.openaiModel),
    executionsRoot: resolveExecutionsRoot(next),
    jiraConfigured: Boolean(stored.jiraBaseUrl && stored.jiraEmail && stored.jiraApiToken),
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
  return {
    apiKey: s.openaiApiKey || "",
    model: normalizeModel(s.openaiModel),
    hasKey: Boolean(s.openaiApiKey),
  };
}

function getAppSettings() {
  const s = loadSettings();
  return {
    hasKey: Boolean(s.openaiApiKey),
    model: normalizeModel(s.openaiModel),
    executionsRoot: resolveExecutionsRoot(s),
    executionsRootOverride: s.executionsRoot || "",
    jiraBaseUrl: s.jiraBaseUrl || "",
    jiraEmail: s.jiraEmail || "",
    jiraHasToken: Boolean(s.jiraApiToken),
    jiraJql: s.jiraJql || DEFAULTS.jiraJql,
    jiraStaleDays: s.jiraStaleDays,
    jiraPollMinutes: s.jiraPollMinutes,
    jiraStatusMap: normalizeJiraStatusMap(s.jiraStatusMap),
    jiraCardKeyField: s.jiraCardKeyField || DEFAULTS.jiraCardKeyField,
    jiraConfigured: Boolean(s.jiraBaseUrl && s.jiraEmail && s.jiraApiToken),
  };
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
};
