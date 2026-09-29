/**
 * Persist Find the Expert records + embeddings under the LiveTrack project root.
 */

const fs = require("fs");
const path = require("path");
const { defaultProjectRoot } = require("./documents");
const { getOpenAiConfig, loadSettings } = require("./settings");
const { collectJiraExpertRecords } = require("./expert-jira");
const { collectConfluenceExpertRecords } = require("./confluence");
const { cell, hashEmbed, parseTagList } = require("./expert-records");

function expertIndexPath() {
  return path.join(defaultProjectRoot(), "expert-index.json");
}

function emptyIndex() {
  return {
    builtAt: "",
    embeddingModel: "",
    jql: "",
    cql: "",
    records: [],
    error: "",
  };
}

function loadExpertIndex() {
  try {
    const raw = JSON.parse(fs.readFileSync(expertIndexPath(), "utf8"));
    const records = Array.isArray(raw?.records) ? raw.records : [];
    return {
      builtAt: cell(raw?.builtAt),
      embeddingModel: cell(raw?.embeddingModel),
      jql: cell(raw?.jql),
      cql: cell(raw?.cql),
      records,
      error: cell(raw?.error),
    };
  } catch {
    return emptyIndex();
  }
}

function saveExpertIndex(index) {
  const payload = {
    builtAt: index.builtAt || new Date().toISOString(),
    embeddingModel: index.embeddingModel || "",
    jql: index.jql || "",
    cql: index.cql || "",
    records: Array.isArray(index.records) ? index.records : [],
    error: index.error || "",
  };
  fs.mkdirSync(path.dirname(expertIndexPath()), { recursive: true });
  fs.writeFileSync(expertIndexPath(), JSON.stringify(payload), "utf8");
  return payload;
}

function embeddingsUrlFromChat(chatUrl) {
  const chat = String(chatUrl || "").trim();
  try {
    const u = new URL(chat);
    if (u.pathname.endsWith("/chat/completions")) {
      u.pathname = u.pathname.replace(/\/chat\/completions\/?$/, "/embeddings");
      return u.toString();
    }
    if (u.pathname.endsWith("/v1") || u.pathname.endsWith("/v1/")) {
      return `${chat.replace(/\/?$/, "/")}embeddings`;
    }
  } catch {
    /* fall through */
  }
  return "https://api.openai.com/v1/embeddings";
}

async function embedTextsOpenAi(texts, { signal } = {}) {
  const { apiKey, hasKey, chatCompletionsUrl } = getOpenAiConfig();
  if (!hasKey) return null;
  const url = embeddingsUrlFromChat(chatCompletionsUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts,
    }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Embeddings ${res.status}: ${errText.slice(0, 200) || res.statusText}`);
  }
  const json = await res.json();
  const rows = Array.isArray(json?.data) ? json.data.slice().sort((a, b) => a.index - b.index) : [];
  return rows.map((row) => (Array.isArray(row?.embedding) ? row.embedding : []));
}

async function embedTexts(texts, { signal } = {}) {
  const clean = (Array.isArray(texts) ? texts : []).map((row) => cell(row).slice(0, 8000) || " ");
  if (!clean.length) return { vectors: [], model: "none" };
  try {
    const openai = await embedTextsOpenAi(clean, { signal });
    if (openai && openai.length === clean.length) {
      return { vectors: openai, model: "text-embedding-3-small" };
    }
  } catch {
    /* hashing fallback */
  }
  return { vectors: clean.map((text) => hashEmbed(text)), model: "hash-256" };
}

async function rebuildExpertIndex({ forceRefresh = true, signal } = {}) {
  const settings = loadSettings();
  const jira = await collectJiraExpertRecords(settings, {
    maxResults: 80,
    forceRefresh,
  });
  let confluence = { ok: true, records: [], skipped: true, cql: "" };
  if (parseTagList(settings.confluenceSpaceKeys).length) {
    confluence = await collectConfluenceExpertRecords(settings, {
      maxResults: 40,
      forceRefresh,
    });
  }
  const records = [...(jira.ok ? jira.records : []), ...(confluence.ok ? confluence.records : [])];
  const errors = [!jira.ok ? jira.error : "", !confluence.ok ? confluence.error : ""]
    .filter(Boolean)
    .join(" ");
  if (!records.length) {
    const index = saveExpertIndex({
      builtAt: new Date().toISOString(),
      embeddingModel: "",
      jql: jira.jql || "",
      cql: confluence.cql || "",
      records: [],
      error: errors || "No expert records found.",
    });
    return {
      ok: false,
      ...index,
      jiraCount: jira.issueCount || 0,
      confluenceCount: confluence.pageCount || 0,
      error: index.error,
    };
  }
  const { vectors, model } = await embedTexts(
    records.map((row) => row.text),
    { signal }
  );
  const embedded = records.map((row, i) => ({
    ...row,
    embedding: vectors[i] || hashEmbed(row.text),
  }));
  const index = saveExpertIndex({
    builtAt: new Date().toISOString(),
    embeddingModel: model,
    jql: jira.jql || "",
    cql: confluence.cql || "",
    records: embedded,
    error: errors,
  });
  return {
    ok: !errors || Boolean(embedded.length),
    ...index,
    recordCount: embedded.length,
    jiraCount: jira.issueCount || 0,
    confluenceCount: confluence.pageCount || 0,
  };
}

function expertIndexStatus() {
  const index = loadExpertIndex();
  const tags = [...new Set(index.records.map((row) => cell(row.system_tag)).filter(Boolean))];
  return {
    ok: Boolean(index.records.length),
    builtAt: index.builtAt,
    embeddingModel: index.embeddingModel,
    recordCount: index.records.length,
    tags,
    jql: index.jql,
    cql: index.cql,
    error: index.error,
    path: expertIndexPath(),
  };
}

module.exports = {
  expertIndexPath,
  loadExpertIndex,
  saveExpertIndex,
  embeddingsUrlFromChat,
  embedTexts,
  rebuildExpertIndex,
  expertIndexStatus,
};
