const fs = require("fs");
const path = require("path");
const os = require("os");
const { defaultProjectRoot } = require("./documents");

const SETTINGS_PATH = path.join(os.homedir(), "Documents", "Coact", "settings.json");

const DEFAULTS = {
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  /** Empty = use defaultProjectRoot()/executions or COACT_EXECUTIONS_ROOT */
  executionsRoot: "",
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
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return {
      ...DEFAULTS,
      ...raw,
      openaiApiKey: String(raw.openaiApiKey || process.env.OPENAI_API_KEY || ""),
      openaiModel: normalizeModel(raw.openaiModel || DEFAULTS.openaiModel),
      executionsRoot: normalizeExecutionsRoot(raw.executionsRoot || ""),
    };
  } catch {
    return {
      ...DEFAULTS,
      openaiApiKey: process.env.OPENAI_API_KEY || "",
      executionsRoot: "",
    };
  }
}

function saveSettings(partial) {
  const next = { ...loadSettings(), ...partial };
  if (partial.openaiModel != null) {
    next.openaiModel = normalizeModel(partial.openaiModel);
  }
  if (partial.executionsRoot != null) {
    next.executionsRoot = normalizeExecutionsRoot(partial.executionsRoot);
  }
  ensureParent();
  fs.writeFileSync(
    SETTINGS_PATH,
    JSON.stringify(
      {
        openaiApiKey: next.openaiApiKey || "",
        openaiModel: normalizeModel(next.openaiModel),
        executionsRoot: next.executionsRoot || "",
      },
      null,
      2
    ),
    "utf8"
  );
  return {
    hasKey: Boolean(next.openaiApiKey),
    model: normalizeModel(next.openaiModel),
    executionsRoot: resolveExecutionsRoot(next),
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
  };
}

module.exports = {
  SETTINGS_PATH,
  loadSettings,
  saveSettings,
  getOpenAiConfig,
  getAppSettings,
  resolveExecutionsRoot,
};
