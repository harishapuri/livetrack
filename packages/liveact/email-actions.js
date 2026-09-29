/**
 * Pull action items from Outlook inbox into LiveAct Actions.
 * Only mails that tag the operator first and ask a pointed question.
 */
const outlook = require("./outlook");
const { loadSettings } = require("./settings");
const actionsStore = require("./actions-store");
const { extractMailActionItems } = require("./openai-chat");

const NOISE_FROM =
  /no-?reply|donotreply|do-not-reply|notifications?@|newsletter|mailer-daemon|postmaster@|alert@|noreply@|bounce@|updates@/i;

const REQUEST_RE =
  /\b(please|kindly|can you|could you|would you|need you to|action required|please review|please confirm|please send|please complete|please update|please reply|let me know|follow up|need your|waiting on you|can we|fix this|check|review)\b/i;

const GREET_RE =
  /^(?:hi|hey|hello|dear|good\s+(?:morning|afternoon|evening))\s+([^,\n!?]+)/i;

function isNoiseSender(address) {
  return NOISE_FROM.test(String(address || ""));
}

function firstSentence(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const m = raw.match(/^.{8,160}?[.!?]/);
  return (m ? m[0] : raw).slice(0, 160).trim();
}

function inferDueKind(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(eod|end of day|today|asap|urgent|by tomorrow)\b/.test(t)) return "today";
  if (/\b(this week|by friday|end of week|by eow)\b/.test(t)) return "week";
  return "week";
}

function normalizePerson(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/@.*$/, " ")
    .replace(/[^a-z0-9\s._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(value) {
  const norm = normalizePerson(value);
  if (!norm) return [];
  const parts = norm.split(" ").filter(Boolean);
  const out = new Set(parts);
  if (parts[0] && parts[0].length >= 3) out.add(parts[0]);
  return [...out];
}

function emailLocal(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw.includes("@")) return "";
  return raw.split("@")[0].replace(/[^a-z0-9]/g, "");
}

function operatorIdentity(extra = {}) {
  const s = loadSettings();
  const c = outlook.getOutlookConfig();
  const names = [
    extra.givenName,
    extra.accountName,
    extra.greetingName,
    c.accountGivenName,
    c.accountName,
    s.momGreetingName,
  ];
  const emails = [
    extra.email,
    extra.upn,
    s.outlookPreferredEmail,
    ...(Array.isArray(extra.emails) ? extra.emails : []),
  ];
  const tokens = new Set();
  for (const name of names) {
    for (const tok of nameTokens(name)) {
      if (tok.length >= 3) tokens.add(tok);
    }
  }
  const mailSet = new Set();
  for (const email of emails) {
    const addr = String(email || "")
      .trim()
      .toLowerCase();
    if (addr.includes("@")) mailSet.add(addr);
    const local = emailLocal(addr);
    if (local.length >= 3) tokens.add(local);
  }
  return { tokens: [...tokens], emails: [...mailSet] };
}

function isMeName(tag, identity) {
  const tagged = normalizePerson(tag);
  if (!tagged || tagged.length < 2) return false;
  if (/^(team|all|everyone|folks|guys|hi|hello)$/i.test(tagged)) return false;
  const first = tagged.split(" ")[0];
  return identity.tokens.some((tok) => {
    if (tok === tagged || tok === first) return true;
    if (first.length >= 3 && tok.startsWith(first)) return true;
    if (tok.length >= 3 && first.startsWith(tok)) return true;
    return false;
  });
}

function openingLines(body) {
  return String(body || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function looksLikeNameList(line) {
  const raw = String(line || "").trim();
  if (!raw || raw.length > 80) return false;
  if (GREET_RE.test(raw) || isPointedQuestion(raw) || /^@/.test(raw)) return false;
  if (/[.!?]|https?:\/\//i.test(raw)) return false;
  const parts = raw
    .split(/\s*(?:,|&|\/|;| and )\s*/i)
    .map((part) => part.replace(/[.:-]+$/g, "").trim())
    .filter(Boolean);
  if (!parts.length || parts.length > 6) return false;
  return parts.every((part) =>
    /^[A-Za-z][A-Za-z.'-]{1,30}(?:\s+[A-Za-z][A-Za-z.'-]{1,30}){0,2}$/.test(part),
  );
}

function firstNameFromList(line) {
  const parts = String(line || "")
    .split(/\s*(?:,|&|\/|;| and )\s*/i)
    .map((part) => part.replace(/[.:-]+$/g, "").trim())
    .filter(Boolean);
  return parts[0] || "";
}

function firstTaggedName(body) {
  const lines = openingLines(body);
  for (const line of lines) {
    const greet = line.match(GREET_RE);
    if (greet) {
      const who = String(greet[1] || "")
        .replace(/\band\b.*$/i, " ")
        .split(/[&,/]| and /i)[0]
        .trim();
      return who.replace(/[.:-]+$/, "").trim();
    }
    const at = line.match(/^@([A-Za-z][A-Za-z0-9._-]*)/);
    if (at) return at[1];
    if (looksLikeNameList(line)) return firstNameFromList(line);
  }
  return "";
}

function isPointedQuestion(text) {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  if (REQUEST_RE.test(raw)) return true;
  if (/\?\s*$/m.test(raw) || /\bcan you\b/i.test(raw)) return true;
  return false;
}

function pointedAskLine(body) {
  const lines = openingLines(body);
  const hit = lines.find(
    (line) =>
      isPointedQuestion(line) && !GREET_RE.test(line) && !looksLikeNameList(line),
  );
  return hit ? hit.slice(0, 180) : "";
}

function crispActionTitle(body) {
  let text = pointedAskLine(body).replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text
    .replace(/^(please|kindly)\s+/i, "")
    .replace(/^(can|could|would)\s+you\s+/i, "")
    .replace(/\?+$/g, "")
    .replace(/^[,\-–—:\s]+/, "")
    .trim();
  if (!text) return "";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`.slice(0, 120);
}

/**
 * Include only if the mail tags me first (Hi Harish / @Harish)
 * and then asks a pointed question. CC copies for someone else are skipped.
 */
function isMailDirectedAtMe(msg, identity) {
  if (!msg) return false;
  if (isNoiseSender(msg.fromAddress)) return false;
  const tag = firstTaggedName(msg.body);
  if (!tag) return false;
  if (!isMeName(tag, identity)) return false;
  return isPointedQuestion(msg.body || "");
}

function mailItemFromMessage(msg, extras = {}) {
  const subj = String(msg.subject || "").trim().toLowerCase();
  const ai = String(extras.title || "").trim();
  const crisp = crispActionTitle(msg.body);
  const title =
    crisp ||
    (ai && ai.toLowerCase() !== subj ? ai : "") ||
    firstSentence(
      openingLines(msg.body)
        .filter((line) => !GREET_RE.test(line) && !looksLikeNameList(line) && !/^@/.test(line))
        .join(" "),
    );
  if (!title) return null;
  return {
    title,
    owner: String(extras.owner || "").trim(),
    dueKind: extras.dueKind || inferDueKind(msg.body || ""),
    messageId: msg.id,
    subject: "",
    from: msg.fromName || msg.fromAddress || "",
    webLink: msg.webLink || "",
    receivedDateTime: msg.receivedDateTime || "",
  };
}

function messagesForMe(messages = [], identity) {
  return (messages || []).filter((msg) => isMailDirectedAtMe(msg, identity));
}

function mergeMailActionItems(messages = [], aiItems = [], identity) {
  const mine = messagesForMe(messages, identity);
  const allowed = new Set(mine.map((msg) => msg.id));
  const byId = new Map();
  for (const msg of mine) {
    const item = mailItemFromMessage(msg);
    if (item) byId.set(msg.id, item);
  }
  for (const raw of Array.isArray(aiItems) ? aiItems : []) {
    const id = String(raw.messageId || "").trim();
    if (!id || !allowed.has(id)) continue;
    const current = byId.get(id);
    if (!current) continue;
    const next = mailItemFromMessage(
      mine.find((m) => m.id === id) || { id, body: "", subject: current.subject },
      raw,
    );
    if (next) byId.set(id, { ...current, ...next, owner: current.owner });
  }
  return [...byId.values()];
}

function heuristicExtractMailActions(messages = [], identity = operatorIdentity()) {
  return messagesForMe(messages, identity)
    .map((msg) => mailItemFromMessage(msg))
    .filter((item) => item && item.title.length >= 3);
}

async function importActionItemsFromOutlook({
  user = "",
  accountName = "",
  givenName = "",
  greetingName = "",
  emails = [],
} = {}) {
  if (!outlook.isConnected()) {
    return {
      ok: false,
      needConnect: true,
      error: "Connect Outlook in Settings, then read mail again.",
      imported: 0,
      skipped: 0,
      scanned: 0,
      actions: [],
    };
  }
  const identity = operatorIdentity({
    accountName,
    givenName,
    greetingName,
    emails,
  });
  const inbox = await outlook.fetchInboxMessages({ days: 14, top: 40 });
  if (!inbox.ok) {
    return {
      ...inbox,
      needMailConsent: Boolean(inbox.mailDenied),
      imported: 0,
      skipped: 0,
      scanned: 0,
      actions: [],
    };
  }
  const messages = inbox.messages || [];
  const mine = messagesForMe(messages, identity);
  const extracted = mine.length
    ? await extractMailActionItems({
        messages: mine,
        accountName: accountName || givenName || identity.tokens[0] || "",
      })
    : { items: [], usedAi: false };
  const aiItems = Array.isArray(extracted?.items) ? extracted.items : [];
  const items = mergeMailActionItems(messages, aiItems, identity);
  const cleared = await actionsStore.clearBySource({ source: "email", user });
  const imported = await actionsStore.importFromEmail({ items, user });
  console.log("[livetrack] mail actions", {
    scanned: messages.length,
    directedAtMe: mine.length,
    cleared: cleared.removed,
    imported: imported.imported,
    skipped: imported.skipped,
    usedAi: Boolean(extracted?.usedAi),
  });
  return {
    ok: true,
    scanned: messages.length,
    matched: mine.length,
    cleared: cleared.removed || 0,
    usedAi: Boolean(extracted?.usedAi),
    imported: imported.imported,
    skipped: imported.skipped,
    actions: imported.actions,
    error: messages.length ? "" : "Outlook inbox returned no recent mail.",
  };
}

module.exports = {
  importActionItemsFromOutlook,
  heuristicExtractMailActions,
  mergeMailActionItems,
  isMailDirectedAtMe,
  firstTaggedName,
  operatorIdentity,
  inferDueKind,
  isNoiseSender,
  isPointedQuestion,
  crispActionTitle,
};
