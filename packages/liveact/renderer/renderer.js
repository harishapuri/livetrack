const queueList = document.getElementById("queueList");
const queueCount = document.getElementById("queueCount");
const queueHeading = document.getElementById("queueHeading");
const stepList = document.getElementById("stepList");
const runNote = document.getElementById("runNote");
const btnRecord = document.getElementById("btnRecord");
const recToggleText = document.getElementById("recToggleText");
const tagline = document.getElementById("tagline");
const screenQueue = document.getElementById("screenQueue");
const screenQuest = document.getElementById("screenQuest");
const questTitle = document.getElementById("questTitle");
const questMeta = document.getElementById("questMeta");
const btnBack = document.getElementById("btnBack");
const btnStart = document.getElementById("btnStart");
const agentApproveModal = document.getElementById("agentApproveModal");
const agentProposeList = document.getElementById("agentProposeList");
const agentApproveHint = document.getElementById("agentApproveHint");
const btnApproveAgentModal = document.getElementById("btnApproveAgentModal");
const btnCancelAgentModal = document.getElementById("btnCancelAgentModal");
const btnCloseAgentModal = document.getElementById("btnCloseAgentModal");
const btnApproveAgent = document.getElementById("btnApproveAgent");
const btnCancelAgent = document.getElementById("btnCancelAgent");
const agentApproveBar = document.getElementById("agentApproveBar");
const btnPause = document.getElementById("btnPause");
const btnResume = document.getElementById("btnResume");
const btnCancel = document.getElementById("btnCancel");
const btnStop = document.getElementById("btnStop");
const btnRefresh = document.getElementById("btnRefresh");
const btnVoiceGuide = document.getElementById("btnVoiceGuide");
const btnRefreshQueue = document.getElementById("btnRefreshQueue");
const btnClearFields = document.getElementById("btnClearFields");
const btnFilterQueue = document.getElementById("btnFilterQueue");
const btnMore = document.getElementById("btnMore");
const moreDropdown = document.getElementById("moreDropdown");
const moreMenu = document.getElementById("moreMenu");
const btnGenAi = document.getElementById("btnGenAi");
const btnCloseGenAi = document.getElementById("btnCloseGenAi");
const chatLog = document.getElementById("formChatLog");
const chatInput = document.getElementById("formChatInput");
const attachRow = document.getElementById("formAttachRow");
const btnSend = document.getElementById("btnSend");
const generalChatLog = document.getElementById("generalChatLog");
const generalChatInput = document.getElementById("generalChatInput");
const generalAttachRow = document.getElementById("generalAttachRow");
const generalBtnSend = document.getElementById("generalBtnSend");
const generalBtnAttach = document.getElementById("generalBtnAttach");
const generalBtnSnippet = document.getElementById("generalBtnSnippet");
const btnSnippet = document.getElementById("btnSnippet");
const btnAttach = document.getElementById("btnAttach");
const genaiPanel = document.getElementById("genaiPanel");
const genaiShell = document.getElementById("genaiShell");
const queueSearch = document.getElementById("queueSearch");
const queueSearchWrap = document.getElementById("queueSearchWrap");
const btnSettings = document.getElementById("btnSettings");
const navLive = document.getElementById("navLive");
const navJira = document.getElementById("navJira");
const navMom = document.getElementById("navMom");
const navActions = document.getElementById("navActions");
const navAi = document.getElementById("navAi");
const navDesk = document.getElementById("navDesk");
const navFeedback = document.getElementById("navFeedback");
const navAnalytics = document.getElementById("navAnalytics");
const navDashboard = document.getElementById("navDashboard");
const paneLive = document.getElementById("paneLive");
const paneJira = document.getElementById("paneJira");
const paneMom = document.getElementById("paneMom");
const paneActions = document.getElementById("paneActions");
const paneAi = document.getElementById("paneAi");
const paneDesk = document.getElementById("paneDesk");
const paneFeedback = document.getElementById("paneFeedback");
const paneAnalytics = document.getElementById("paneAnalytics");
const paneDashboard = document.getElementById("paneDashboard");
const jiraBadge = document.getElementById("jiraBadge");
const momBadge = document.getElementById("momBadge");
const actionsBadge = document.getElementById("actionsBadge");
const momList = document.getElementById("momList");
const momStatus = document.getElementById("momStatus");
const momTranscript = document.getElementById("momTranscript");
const momMinutes = document.getElementById("momMinutes");
const momMinutesTitle = document.getElementById("momMinutesTitle");
const momMinutesApproveBar = document.getElementById("momMinutesApproveBar");
const momApproveHint = document.getElementById("momApproveHint");
const btnMomApprove = document.getElementById("btnMomApprove");
const btnMomEditRefine = document.getElementById("btnMomEditRefine");
const btnMomReRefine = document.getElementById("btnMomReRefine");
const btnMomCopy = document.getElementById("btnMomCopy");
const momFoldsStack = document.getElementById("momFoldsStack");
const momMeetingsCard = document.getElementById("momMeetingsCard");
const momLiveCard = document.getElementById("momLiveCard");
const momMinutesCard = document.getElementById("momMinutesCard");
const momPastCard = document.getElementById("momPastCard");
const momPastList = document.getElementById("momPastList");
const momPastCount = document.getElementById("momPastCount");
const btnMomMeetingsToggle = document.getElementById("btnMomMeetingsToggle");
const btnMomLiveToggle = document.getElementById("btnMomLiveToggle");
const btnMomMinutesToggle = document.getElementById("btnMomMinutesToggle");
const btnMomPastToggle = document.getElementById("btnMomPastToggle");
const momRecBar = document.getElementById("momRecBar");
const momRecBarText = document.getElementById("momRecBarText");
const btnMomStart = document.getElementById("btnMomStart");
const btnMomStop = document.getElementById("btnMomStop");
const btnMomCancel = document.getElementById("btnMomCancel");
const btnMomStopBar = document.getElementById("btnMomStopBar");
const btnMomCancelBar = document.getElementById("btnMomCancelBar");
const btnMomSpeakTest = document.getElementById("btnMomSpeakTest");
const momDeviceHint = document.getElementById("momDeviceHint");
const momDeviceMessage = document.getElementById("momDeviceMessage");
const momDeviceCode = document.getElementById("momDeviceCode");
const outlookTenantInput = document.getElementById("outlookTenantInput");
const outlookClientIdInput = document.getElementById("outlookClientIdInput");
const outlookAccountKind = document.getElementById("outlookAccountKind");
const outlookTenantHint = document.getElementById("outlookTenantHint");
const outlookEmailInput = document.getElementById("outlookEmailInput");
const momGreetingInput = document.getElementById("momGreetingInput");
const btnOutlookConnect = document.getElementById("btnOutlookConnect");
const btnOutlookDisconnect = document.getElementById("btnOutlookDisconnect");
const outlookConnectStatus = document.getElementById("outlookConnectStatus");

/** Built-in LIVETRACK Entra app */
const OUTLOOK_DEFAULT_TENANT = "common";
const OUTLOOK_DEFAULT_CLIENT = "f081b9cd-fcad-45b2-b418-5bf68b546fd7";
const OUTLOOK_MSA_TENANT = "f8cdef31-a31e-4b4a-93e4-5f571e91255a";
const OUTLOOK_LEGACY_SINGLE_TENANT = "c3ad2d99-7a82-45ae-a789-70e20d9ab9eb";
const OUTLOOK_LEGACY_CLIENT = "ced2296f-c311-43d2-9568-0e48d555665e";
const jiraList = document.getElementById("jiraList");
const jiraMeta = document.getElementById("jiraMeta");
const btnJiraRefresh = document.getElementById("btnJiraRefresh");
const dashList = document.getElementById("dashList");
const dashMeta = document.getElementById("dashMeta");
const dashHeading = document.getElementById("dashHeading");
const btnDashRefresh = document.getElementById("btnDashRefresh");
const captureLivePanel = document.getElementById("captureLivePanel");
const captureLiveMeta = document.getElementById("captureLiveMeta");
const captureLiveTicket = document.getElementById("captureLiveTicket");
const captureLivePage = document.getElementById("captureLivePage");
const captureLiveFields = document.getElementById("captureLiveFields");
const btnCaptureLiveMin = document.getElementById("btnCaptureLiveMin");
const jiraBaseUrlInput = document.getElementById("jiraBaseUrlInput");
const jiraEmailInput = document.getElementById("jiraEmailInput");
const jiraTokenInput = document.getElementById("jiraTokenInput");
const jiraJqlInput = document.getElementById("jiraJqlInput");
const jiraStaleDaysInput = document.getElementById("jiraStaleDaysInput");
const jiraStatusMapInput = document.getElementById("jiraStatusMapInput");
const jiraCardKeyFieldInput = document.getElementById("jiraCardKeyFieldInput");
const jiraProjectKeyInput = document.getElementById("jiraProjectKeyInput");
const btnJiraTestConnection = document.getElementById("btnJiraTestConnection");
const jiraTestStatus = document.getElementById("jiraTestStatus");
const jiraRecentList = document.getElementById("jiraRecentList");
const btnMinimize = document.getElementById("btnMinimize");
const btnQuit = document.getElementById("btnQuit");
const settingsModal = document.getElementById("settingsModal");
const openaiKeyInput = document.getElementById("openaiKeyInput");
const openaiModelInput = document.getElementById("openaiModelInput");
const openaiChatUrlInput = document.getElementById("openaiChatUrlInput");
const openaiSpeechUrlInput = document.getElementById("openaiSpeechUrlInput");
const openaiSttUrlInput = document.getElementById("openaiSttUrlInput");
const executionsRootInput = document.getElementById("executionsRootInput");
const btnPickExecutions = document.getElementById("btnPickExecutions");
const btnSettingsSave = document.getElementById("btnSettingsSave");
const btnSettingsCancel = document.getElementById("btnSettingsCancel");
const browserRequiredModal = document.getElementById("browserRequiredModal");
const btnBrowserRequiredClose = document.getElementById("btnBrowserRequiredClose");
const tailBar = document.getElementById("tailBar");
const fullUi = document.getElementById("fullUi");
const appRoot = document.getElementById("appRoot");

let cards = [];
let activeCardId = null;
/** User chose ← Queue; stay on task list until the browser tab URL changes. */
let suppressAutoOpen = false;
let runState = "idle"; // idle | running | paused
let agentPreviewActive = false;
/** True after Agent modal Approve until the run ends — suppresses per-step mandatory Approve UI. */
let agentApprovedForRun = false;
/** @type {{ proposals: Array<{stepId:string,label:string,value:string,reason:string,valueKey?:string}>, dataOverrides: Record<string,string> } | null} */
let pendingAgentProposal = null;
let agentProposeRequestId = 0;
let pinned = true;
let stepIndex = new Map();
let stepStatuses = new Map();
let inTail = false;
let chatHistory = [];
let generalChatHistory = [];
let generalAttachments = [];
let pendingAttachments = [];
let queueSearchQuery = "";
let queueFilterOpen = false;
let aiRepairAttemptedForRun = false;
let lastCoachMeta = null; // { stepId, suggestedValue, canApply, canRetry }
let pendingSnippet = "";
let activeChatId = null;
let streamingEl = null;
let activeTabUrl = null;
let activeTabTitle = null;
let autoPinnedCardId = null;
/** @type {Map<string, Map<string, string>>} */
const cardProgress = new Map();
/** Per-card abandon / activity timestamps for 15-min stale reset */
const cardProgressMeta = new Map();
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const staleProgressTimers = new Map();
const STALE_PROGRESS_MS = 15 * 60 * 1000;
const PROGRESS_META_STORAGE_KEY = "livetrack.cardProgressMeta";
/** Per-card: true = coaching on. Starts on when a card opens; Stop turns it off until Coach or reopen. */
const voiceCoachOnByCard = new Map();
/** Dedupe guide speaks: `${cardId}:${stepId}` */
let lastGuideSpeakKey = "";
let lastGuideStepId = "";
/** Audio unlocked via card open / Coach / Agent (required for TTS autoplay). */
let guideAudioReady = false;
/** Bumps on each coach start so overlapping opens don't cancel TTS incorrectly. */
let voiceCoachGen = 0;
/** @type {{ ok?: boolean, issues?: any[], staleCount?: number, error?: string, fetchedAt?: string, configured?: boolean } | null} */
let jiraSnapshot = null;
let lastJiraUiFp = "";
/** @type {Map<string, { path?: string, dataUrl?: string, story?: string, comment?: string, status?: string, busy?: boolean }>} */
const jiraMailByKey = new Map();
let momSnapshot = null;
let momSelectedEventId = "";
let momBusy = false;
let lastMomUiFp = "";
let momPendingApproval = false;
let momEditMode = false;
let momMeetingsOpen = true;
let momTranscriptOpen = false;
let momMinutesOpen = false;
let momPastOpen = false;
/** Expanded meeting row inside Outlook meetings list (one at a time). */
let momExpandedEventId = "";
let momPastItems = [];
let momPastSelectedId = "";
let momPastLoading = false;
/** Opened from Past MOMs — kept until closed or another meeting is selected. */
let momPastView = null;
let lastMomThreadMeta = {};
let deskSnipPath = "";
let deskCreatedIssueUrl = "";
/** @type {{ path: string, name: string }[]} */
let deskExtraFiles = [];
/** @type {{ summary: string, description: string, acceptanceCriteria: string, groupingHint: string }[]} */
let deskProposedTickets = [];
let inboxSnipPath = "";

function deskPageLabel(url, title) {
  const t = String(title || "").trim();
  const looksLikeUrl =
    !t ||
    /^https?:\/\//i.test(t) ||
    /^[\w.-]+:\d+\//.test(t) ||
    /127\.0\.0\.1|localhost/i.test(t);
  if (t && !looksLikeUrl) return t;
  const raw = String(url || t || "").trim();
  if (!raw) return "this screen";
  try {
    const href = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const u = new URL(href);
    const last = (u.pathname || "").split("/").filter(Boolean).pop() || "";
    const name = last
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (name) {
      return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    }
    if (
      u.hostname &&
      u.hostname !== "127.0.0.1" &&
      u.hostname !== "localhost"
    ) {
      return u.hostname;
    }
  } catch {
    /* fall through */
  }
  return "this screen";
}

function jiraUiFingerprint(snapshot) {
  if (!snapshot) return "";
  const issues = (snapshot.issues || []).map((i) =>
    [i.key, i.status, i.done, i.sopStage, i.urgencyScore, i.linkedCardId].join(":")
  );
  return [
    snapshot.ok,
    snapshot.configured,
    snapshot.error || "",
    snapshot.staleCount || 0,
    issues.join("|"),
  ].join("#");
}
let jiraRefreshing = false;
let jiraRefreshQueued = false;
let activeNav = "live";
/** Queue card focused for Ask LiveTrack (from card AI button). */
let aiFocusCard = null;
let dashLoading = false;
/** Capture REF cards kept open across Dash re-renders (poll/refresh). Accordion: at most one. */
const dashExpandedCaptureIds = new Set();
let anLoading = false;
let anGrain = "month";
let anReq = 0;
let captureRecording = false;
let captureRecordingCardId = "";
/** Recording paused while user is on Dash / Jira / AI / Desk — same session resumes on Live. */
let capturePausedForNav = false;
let capturePollTimer = null;
let captureBusy = false;
/** True only after the user clicks Record this session — auto-start never sets this. */
let recordStartedManually = false;
/** Bootstrap/first paint must not auto-record, even if default nav is Live. */
let appReady = false;
/** Armed only by a user Live click or queue-card click — not by launch auto-pin. */
let autoRecordArmed = false;
let pendingRecordingStop = false;
let captureLiveMinimized = false;
let liveRecordingCacheCleared = false;
let syncTabTimer = null;
let wasExtensionConnected = false;
let lastExtensionClientId = null;

/** Stuck-step GenAI coach */
const STUCK_MS = 5000;
const COACH_COOLDOWN_MS = 30000;
let stuckTimer = null;
let lastStepActivityAt = Date.now();
/** @type {Map<string, { shown?: boolean, dismissedAt?: number, needsKeyShown?: boolean }>} */
const coachEpisode = new Map();
let coachRequestId = 0;
let activeCoachStepId = null;

const DUMMY_STEPS = [
  { id: "open-form", label: "Confirm form page is open in Chrome", action: "check", status: "pending" },
  { id: "fill-fields", label: "Fill mapped form fields", action: "fill", status: "pending" },
  { id: "review", label: "Highlight submit for human review", action: "highlight", status: "pending" },
];

function setExtensionStatus({
  connected,
  bridgeUp,
  bridgeError,
  extensionClients,
}) {
  if (!btnRecord) return;
  const online = Boolean(connected);
  const n = Number(extensionClients) || 0;
  let hint = "Record field values from Chrome";
  if (online) {
    hint =
      n > 1
        ? `${n} browsers connected — click to record`
        : "Chrome connected — click to record";
  } else if (bridgeError) hint = String(bridgeError);
  else if (bridgeUp === false) hint = "Bridge down";
  if (!captureRecording && !capturePausedForNav) btnRecord.title = hint;
}

function updateRecordButton() {
  if (!btnRecord || !recToggleText) return;
  btnRecord.classList.toggle("recording", captureRecording);
  btnRecord.classList.toggle("paused", capturePausedForNav);
  btnRecord.classList.toggle("online", captureRecording || capturePausedForNav);
  btnRecord.setAttribute("aria-pressed", captureRecording ? "true" : "false");
  recToggleText.textContent = captureRecording
    ? "Recording"
    : capturePausedForNav
      ? "Paused"
      : "Record";
  const noCard = !bestMatchedCard() && !captureRecordingCardId;
  btnRecord.title = captureRecording
    ? "Stop recording"
    : capturePausedForNav
      ? activeNav === "live"
        ? "Resume recording this card"
        : "Recording paused — return to Live to continue"
      : noCard
        ? "Record this page as a new process (no queue card matches)"
        : "Start recording";
}

function humanizeFieldLabel(name) {
  const raw = String(name || "").trim();
  if (!raw) return "Field";
  if (/[ _]/.test(raw)) {
    return raw.replace(/[_]+/g, " ").replace(/\s+/g, " ");
  }
  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function latestCaptureTxn(transactions) {
  const rows = Array.isArray(transactions) ? transactions : [];
  if (!rows.length) return null;
  if (captureRecordingCardId) {
    const match = [...rows].reverse().find((row) => {
      let payload = {};
      try {
        payload =
          typeof row.payload === "string"
            ? JSON.parse(row.payload)
            : row.payload || {};
      } catch {
        payload = {};
      }
      return (
        String(row.cardId || payload.cardId || "") === captureRecordingCardId
      );
    });
    if (match) return match;
  }
  return rows[rows.length - 1];
}

function captureValuesMap(txn) {
  if (!txn) return {};
  if (
    txn.fields &&
    typeof txn.fields === "object" &&
    !Array.isArray(txn.fields)
  ) {
    return txn.fields;
  }
  try {
    const payload =
      typeof txn.payload === "string"
        ? JSON.parse(txn.payload)
        : txn.payload || {};
    return payload.values && typeof payload.values === "object"
      ? payload.values
      : {};
  } catch {
    return {};
  }
}

function captureClicksList(txn) {
  if (!txn) return [];
  if (Array.isArray(txn.clicks) && txn.clicks.length) return txn.clicks;
  try {
    const payload =
      typeof txn.payload === "string"
        ? JSON.parse(txn.payload)
        : txn.payload || {};
    return Array.isArray(payload.clicks) ? payload.clicks : [];
  } catch {
    return [];
  }
}

function renderFieldDl(dl, values, clicks) {
  if (!dl) return;
  dl.replaceChildren();
  const entries = Object.entries(values || {}).filter(([, v]) =>
    String(v || "").trim(),
  );
  const clickRows = Array.isArray(clicks)
    ? clicks.filter((c) => String(c.label || "").trim())
    : [];
  if (!entries.length && !clickRows.length) {
    const dt = document.createElement("dt");
    dt.textContent = "Status";
    const dd = document.createElement("dd");
    dd.textContent = captureRecording
      ? "Waiting for clicks and typed values…"
      : capturePausedForNav
        ? "Paused — return to this card to continue"
        : "No values yet";
    dl.append(dt, dd);
    return;
  }
  for (const click of clickRows) {
    const dt = document.createElement("dt");
    dt.textContent = "Click";
    const dd = document.createElement("dd");
    dd.textContent = String(click.label);
    dl.append(dt, dd);
  }
  for (const [key, value] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = humanizeFieldLabel(key);
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    dl.append(dt, dd);
  }
}

function syncCaptureLiveMinButton() {
  if (!btnCaptureLiveMin) return;
  btnCaptureLiveMin.textContent = captureLiveMinimized ? "+" : "−";
  btnCaptureLiveMin.title = captureLiveMinimized
    ? "Expand live recording"
    : "Minimize live recording";
}

async function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  try {
    const res = await window.coact.copyText?.(value);
    if (res?.ok) return true;
  } catch {
    /* fall through */
  }
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    /* fall through */
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}

function flashCopied(btn, label) {
  if (!btn) return;
  const previous = btn.textContent;
  btn.classList.add("copied");
  btn.textContent = "Copied";
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.textContent = label || previous;
  }, 1200);
}

async function copyRefNumber(ref, btn) {
  const value = String(ref || "").trim();
  if (!value || value === "—") return;
  const ok = await copyTextToClipboard(value);
  if (ok) flashCopied(btn, value);
}

function captureTicketOf(txn) {
  if (!txn) return "";
  if (txn.ticket) return String(txn.ticket);
  if (txn.formReference) return String(txn.formReference);
  try {
    const payload =
      typeof txn.payload === "string"
        ? JSON.parse(txn.payload)
        : txn.payload || {};
    return String(payload.ticket || payload.formReference || "");
  } catch {
    return "";
  }
}

function clearLiveRecordingCache() {
  liveRecordingCacheCleared = true;
  captureLiveMinimized = true;
  if (captureLiveFields) captureLiveFields.replaceChildren();
  if (captureLivePage) captureLivePage.textContent = "";
  if (captureLiveTicket) {
    captureLiveTicket.hidden = true;
    captureLiveTicket.textContent = "";
    captureLiveTicket.title = "";
  }
  if (captureLiveMeta) captureLiveMeta.textContent = "";
  captureLivePanel?.classList.add("hidden");
  captureLivePanel?.classList.add("minimized");
  syncCaptureLiveMinButton();
}

/**
 * Turn the same {key, value, type} pairs the dashboard/queue-studio "needs
 * review" table shows into the {values, clicks} shape this panel renders,
 * so both views agree instead of one showing raw generic ids the other
 * already resolved to real questions.
 */
function pairsToValuesAndClicks(pairs) {
  const values = {};
  const clicks = [];
  for (const p of pairs || []) {
    if (!p || !p.key) continue;
    if (p.type === "click") {
      clicks.push({ label: p.value || p.key });
    } else {
      values[p.key] = p.value;
    }
  }
  return { values, clicks };
}

function renderLiveCapture(txn) {
  if (liveRecordingCacheCleared && !captureRecording && !capturePausedForNav) {
    captureLivePanel?.classList.add("hidden");
    return;
  }
  const fromPairs = Array.isArray(txn?.pairs) ? pairsToValuesAndClicks(txn.pairs) : null;
  const values = fromPairs ? fromPairs.values : captureValuesMap(txn);
  const clicks = fromPairs ? fromPairs.clicks : captureClicksList(txn);
  const n = Object.keys(values).length;
  const c = clicks.length;
  const page = txn?.pageTitle || txn?.pageUrl || "";
  const url = txn?.pageUrl || "";
  const ticket = captureTicketOf(txn);
  const showTicket = ticket && !/^CAP-/i.test(ticket);

  if (captureLivePanel) {
    const show = captureRecording || capturePausedForNav || n > 0 || c > 0;
    captureLivePanel.classList.toggle("hidden", !show);
    captureLivePanel.classList.toggle("minimized", captureLiveMinimized);
    syncCaptureLiveMinButton();
    if (captureLiveTicket) {
      captureLiveTicket.hidden = !showTicket;
      captureLiveTicket.classList.toggle("ref-key", /^REF-/i.test(ticket));
      if (showTicket && captureLiveTicket.textContent !== "Copied") {
        captureLiveTicket.textContent = ticket;
      }
      captureLiveTicket.title = showTicket ? `Click to copy ${ticket}` : "";
    }
    if (captureLiveMeta) {
      const bits = [];
      if (c) bits.push(`${c} click${c === 1 ? "" : "s"}`);
      if (n) bits.push(`${n} field${n === 1 ? "" : "s"}`);
      const detail = bits.join(" · ");
      captureLiveMeta.textContent = captureRecording
        ? detail || "Recording clicks and field values"
        : capturePausedForNav
          ? detail
            ? `Paused · ${detail} kept`
            : "Paused — return to Live to continue"
          : detail
            ? `${detail} saved`
            : "Waiting for clicks and field values…";
    }
    if (captureLivePage)
      captureLivePage.textContent = [page, url].filter(Boolean).join(" · ");
    renderFieldDl(captureLiveFields, values, clicks);
  }
}

function ensureCapturePoll() {
  if (capturePollTimer) return;
  capturePollTimer = setInterval(() => {
    tickCaptureStatus();
  }, 1500);
}

function stopCapturePollIfIdle() {
  if (captureRecording || capturePausedForNav || activeNav === "dashboard")
    return;
  if (capturePollTimer) {
    clearInterval(capturePollTimer);
    capturePollTimer = null;
  }
}

function canAutoRecord() {
  return false;
}

function armAutoRecord() {
  autoRecordArmed = false;
}

function questScreenOpen() {
  return Boolean(
    activeCardId && screenQuest && !screenQuest.classList.contains("hidden"),
  );
}

function pauseRecordingForNav() {
  if (capturePausedForNav) return;
  if (!captureRecording && !captureBusy) return;
  if (!questScreenOpen()) {
    setRecordingEnabled(false);
    return;
  }
  setRecordingEnabled(false, { pause: true });
}

function resumeRecordingAfterNav() {
  if (!capturePausedForNav) return;
  if (captureRecordingCardId && !questScreenOpen()) return;
  if (captureRecordingCardId && activeCardId !== captureRecordingCardId) return;
  setRecordingEnabled(true, { resume: true });
}

async function tickCaptureStatus() {
  if (!window.coact.getCaptureStatus) return;
  try {
    const status = await window.coact.getCaptureStatus();
    if (typeof status?.recording === "boolean" && !captureBusy) {
      if (capturePausedForNav) {
        if (status.recording) {
          capturePausedForNav = false;
          captureRecording = true;
          updateRecordButton();
        }
      } else if (status.recording && !captureRecording) {
        // Do not restore a leftover "was recording" session into auto-on.
        window.coact.setCaptureRecording?.({ action: "stop" }).catch(() => {});
      } else if (!status.recording && captureRecording) {
        captureRecording = false;
        recordStartedManually = false;
        captureRecordingCardId = "";
        capturePausedForNav = false;
        updateRecordButton();
      }
    }
    renderLiveCapture(latestCaptureTxn(status?.transactions));
    if (activeNav === "dashboard" && !dashLoading) {
      refreshDashboard({ silent: true });
    }
  } catch {
    /* capture agent optional */
  }
  stopCapturePollIfIdle();
}

async function setRecordingEnabled(on, opts = {}) {
  // Never auto-start recording. Record only from the Record button.
  if (opts.auto && on && !canAutoRecord()) return;
  if (!window.coact.setCaptureRecording) return;
  const pausing = Boolean(opts.pause);
  const resuming =
    Boolean(opts.resume) || Boolean(on && capturePausedForNav && !pausing);
  if (captureBusy) {
    if (pausing) pendingRecordingStop = "pause";
    else if (!on && !resuming) pendingRecordingStop = true;
    return;
  }
  captureBusy = true;
  try {
    const card = activeCardId ? cards.find((c) => c.id === activeCardId) : null;
    const onQuest = Boolean(
      card && screenQuest && !screenQuest.classList.contains("hidden"),
    );
    const action = pausing
      ? "pause"
      : resuming
        ? "resume"
        : on
          ? "start"
          : "stop";
    const keepCard = pausing || resuming || (on && onQuest);
    const res = await window.coact.setCaptureRecording({
      action,
      cardId:
        keepCard && onQuest ? card.id : pausing ? captureRecordingCardId : "",
      queueCard: keepCard && onQuest ? card.title : "",
      lob: keepCard && onQuest ? card.lob : "",
    });
    if (pausing) {
      captureRecording = false;
      capturePausedForNav = Boolean(
        res?.paused || res?.recordingSessionId || captureRecordingCardId,
      );
      if (!capturePausedForNav) {
        captureRecordingCardId = "";
        recordStartedManually = false;
        clearLiveRecordingCache();
        if (activeNav === "dashboard") refreshDashboard();
        stopCapturePollIfIdle();
      } else {
        ensureCapturePoll();
      }
      updateRecordButton();
      return;
    }
    if (resuming && !res?.ok) {
      capturePausedForNav = true;
      captureRecording = false;
      updateRecordButton();
      return;
    }
    captureRecording = Boolean(res?.recording);
    capturePausedForNav = Boolean(res?.paused);
    if (captureRecording && onQuest) captureRecordingCardId = card.id;
    else if (!captureRecording && !capturePausedForNav)
      captureRecordingCardId = "";
    if (on && !opts.auto && captureRecording) recordStartedManually = true;
    if (!captureRecording && !capturePausedForNav)
      recordStartedManually = false;
    updateRecordButton();
    if (!res?.ok && on) {
      if (runNote && onQuest) {
        runNote.className = "run-note";
        runNote.textContent =
          res?.error ||
          "Could not start recording. Keep LiveTrack open — enable the Chrome extension or Chrome remote debugging (CDP).";
      }
    } else if (
      captureRecording &&
      on &&
      res?.playwright &&
      res.playwright.ok === false &&
      runNote &&
      onQuest
    ) {
      runNote.className = "run-note";
      runNote.textContent =
        "Recording on, but page capture could not attach (start Chrome with remote debugging, or load the extension).";
    }
    if (captureRecording) {
      liveRecordingCacheCleared = false;
      captureLiveMinimized = false;
      ensureCapturePoll();
      tickCaptureStatus();
    } else if (capturePausedForNav) {
      ensureCapturePoll();
    } else {
      captureRecordingCardId = "";
      liveRecordingCacheCleared = false;
      showNav("dashboard");
      await refreshDashboard();
      const drafted = Number(res?.draftedCount || 0);
      const txns = Number(res?.txnCount || 0);
      if (dashMeta) {
        if (drafted > 0) {
          dashMeta.textContent = `Recorded · ${drafted} draft SOP${drafted === 1 ? "" : "s"} ready for review`;
        } else if (txns > 0) {
          dashMeta.textContent = `Recorded · ${txns} capture session${txns === 1 ? "" : "s"} on Dash`;
        } else if (!res?.ok) {
          dashMeta.textContent =
            res?.error || "Recording stopped but capture store was unavailable";
        } else {
          dashMeta.textContent =
            "Recording stopped · no clicks or field values were captured (extension offline? try CDP or reload extension)";
        }
      }
      stopCapturePollIfIdle();
    }
  } finally {
    captureBusy = false;
    if (pendingRecordingStop === "pause") {
      pendingRecordingStop = false;
      setRecordingEnabled(false, { pause: true });
    } else if (pendingRecordingStop) {
      pendingRecordingStop = false;
      setRecordingEnabled(false);
    }
  }
}

function normalizeUrl(url) {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .replace("localhost", "127.0.0.1");
}

function urlPath(normalized) {
  const slash = normalized.indexOf("/");
  return slash === -1 ? "" : normalized.slice(slash + 1);
}

/** Higher score = better match. 0 = no match. */
function cardMatchScore(card, tabUrl, tabTitle) {
  if (!tabUrl) return 0;
  const url = normalizeUrl(tabUrl);
  const title = String(tabTitle || "").toLowerCase();
  const path = urlPath(url);
  let score = 0;

  if (card.formUrl) {
    const form = normalizeUrl(card.formUrl);
    const formPath = urlPath(form);
    const formFile = formPath.includes("/") ? formPath.split("/").pop() : formPath;

    // Exact page match
    if (form && url === form) score = Math.max(score, 200);

    // Same filename (e.g. metro-permit.html) — strongest for demo sites
    if (formFile && formFile.includes(".") && path.endsWith(formFile)) {
      score = Math.max(score, 180);
    }

    // Root/index-only forms must not match /sites/...
    const formIsRoot =
      !formPath || formPath === "index.html" || formPath === "index.htm";
    if (formIsRoot) {
      const tabIsRoot = !path || path === "index.html" || path === "index.htm";
      if (tabIsRoot && url.startsWith(form.split("/")[0])) {
        score = Math.max(score, 120);
      }
    } else if (formPath && path.startsWith(formPath)) {
      score = Math.max(score, 140);
    }
  }

  for (const hint of card.formMatch || []) {
    const h = String(hint || "").toLowerCase().trim();
    if (!h) continue;
    // Ignore overly broad host:port hints that match every demo page
    if (/^[\w.-]+:\d+\/?$/.test(h.replace(/^https?:\/\//, ""))) continue;
    const hn = h.replace(/^https?:\/\//, "").replace("localhost", "127.0.0.1");
    if (url.includes(hn)) score = Math.max(score, 40 + Math.min(hn.length, 40));
    if (title.includes(h)) score = Math.max(score, 60 + Math.min(h.length, 40));
  }

  // Card id in path (metro-permit, northstar-job-apply, …)
  const id = String(card.id || "").toLowerCase();
  if (id && (path.includes(id) || url.includes(`/${id}`) || url.includes(`${id}.html`))) {
    score = Math.max(score, 170);
  }

  return score;
}

function matchedCardsForTab(tabUrl = activeTabUrl, tabTitle = activeTabTitle) {
  if (!tabUrl) return [];
  const scored = [];
  for (const card of cards) {
    const score = cardMatchScore(card, tabUrl, tabTitle);
    if (score <= 0) continue;
    scored.push({ card, score });
  }
  if (!scored.length) return [];
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      String(b.card.formUrl || "").length - String(a.card.formUrl || "").length ||
      String(a.card.title || "").localeCompare(String(b.card.title || ""))
  );
  const best = scored[0].score;
  // Keep top score group for highlight; auto-pick uses [0] (most specific)
  return scored.filter((s) => s.score === best).map((s) => s.card);
}

function bestMatchedCard() {
  const matched = matchedCardsForTab();
  return matched[0] || null;
}

async function syncQueueToActiveTab() {
  if (activeNav !== "live") return;

  const questOpen =
    Boolean(activeCardId) &&
    screenQuest &&
    !screenQuest.classList.contains("hidden");

  // Keep an open card (coach / fill) until the user taps ← Queue.
  // Tab focus, new tabs, and non-Chrome apps must not bounce back to the list.
  if (questOpen) {
    renderQueue();
    return;
  }

  const card = bestMatchedCard();

  if (card) {
    autoPinnedCardId = card.id;

    // User pressed ← Queue — stay on the list until they activate a browser tab again
    if (suppressAutoOpen) {
      renderQueue();
      return;
    }

    renderQueue();

    if (runState !== "idle" && activeCardId && activeCardId !== card.id) return;

    openCard(card.id);
    return;
  }

  autoPinnedCardId = null;
  renderQueue();
}

function matchingCardIds() {
  return new Set(matchedCardsForTab().map((c) => c.id));
}

function scheduleSyncQueueToActiveTab(immediate = false) {
  if (activeNav !== "live") return;
  if (syncTabTimer) clearTimeout(syncTabTimer);
  const delay = immediate ? 0 : 200;
  syncTabTimer = setTimeout(() => {
    syncTabTimer = null;
    if (activeNav !== "live") return;
    syncQueueToActiveTab();
  }, delay);
}

function saveCardProgress(cardId) {
  if (!cardId) return;
  cardProgress.set(cardId, new Map(stepStatuses));
  touchCardActivity(cardId);
}

function loadProgressMetaStore() {
  try {
    const raw = localStorage.getItem(PROGRESS_META_STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return;
    for (const [id, meta] of Object.entries(obj)) {
      if (!id || !meta || typeof meta !== "object") continue;
      cardProgressMeta.set(id, {
        activityAt: Number(meta.activityAt) || 0,
        abandonedAt: Number(meta.abandonedAt) || 0,
      });
    }
  } catch {
    /* ignore */
  }
}

function persistProgressMetaStore() {
  try {
    const obj = {};
    for (const [id, meta] of cardProgressMeta.entries()) {
      obj[id] = {
        activityAt: meta.activityAt || 0,
        abandonedAt: meta.abandonedAt || 0,
      };
    }
    localStorage.setItem(PROGRESS_META_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* ignore */
  }
}

function getCardProgressMeta(cardId) {
  if (!cardId) return { activityAt: 0, abandonedAt: 0 };
  return cardProgressMeta.get(cardId) || { activityAt: 0, abandonedAt: 0 };
}

function touchCardActivity(cardId) {
  if (!cardId) return;
  const prev = getCardProgressMeta(cardId);
  cardProgressMeta.set(cardId, {
    activityAt: Date.now(),
    abandonedAt: prev.abandonedAt || 0,
  });
  persistProgressMetaStore();
}

function markCardAbandoned(cardId) {
  if (!cardId) return;
  const prev = getCardProgressMeta(cardId);
  cardProgressMeta.set(cardId, {
    activityAt: prev.activityAt || Date.now(),
    abandonedAt: Date.now(),
  });
  persistProgressMetaStore();
}

function clearCardProgressMeta(cardId) {
  if (!cardId) return;
  cardProgressMeta.delete(cardId);
  persistProgressMetaStore();
  const timer = staleProgressTimers.get(cardId);
  if (timer) {
    clearTimeout(timer);
    staleProgressTimers.delete(cardId);
  }
}

function isCardStepsComplete(cardId = activeCardId) {
  if (!cardId) return false;
  const saved = cardProgress.get(cardId);
  if (saved && saved.size) {
    let any = false;
    for (const status of saved.values()) {
      any = true;
      if (status !== "done" && status !== "success") return false;
    }
    return any;
  }
  if (cardId !== activeCardId || !stepStatuses.size) return false;
  for (const status of stepStatuses.values()) {
    if (status !== "done" && status !== "success") return false;
  }
  return stepStatuses.size > 0;
}

function isProgressStale(cardId) {
  const meta = getCardProgressMeta(cardId);
  const anchor = meta.abandonedAt || meta.activityAt || 0;
  if (!anchor) return false;
  return Date.now() - anchor >= STALE_PROGRESS_MS;
}

async function setCardStatusLocal(cardId, status) {
  const card = cards.find((c) => c.id === cardId);
  if (card) card.status = status;
  try {
    await window.coact.updateQueueCardStatus?.(cardId, status);
  } catch {
    /* ignore */
  }
}

/** Persist incomplete to QueueCards + Executions so Stats Incomplete KPI updates. */
async function recordCardAbandoned(cardId) {
  if (!cardId) return;
  const card = cards.find((c) => c.id === cardId);
  if (card) card.status = "incomplete";
  try {
    if (typeof window.coact.abandonCard === "function") {
      await window.coact.abandonCard(cardId, {
        fillMode: runState !== "idle" ? "automated" : "manual",
      });
      return;
    }
    await setCardStatusLocal(cardId, "incomplete");
  } catch {
    try {
      await setCardStatusLocal(cardId, "incomplete");
    } catch {
      /* ignore */
    }
  }
}

const expiringIncompleteUi = new Set();

function expireIncompleteCardUi() {
  for (const card of cards) {
    if (!card?.id || card.status !== "incomplete") continue;
    if (activeCardId === card.id) continue;
    const abandonedAt = getCardProgressMeta(card.id).abandonedAt || 0;
    if (abandonedAt && Date.now() - abandonedAt < STALE_PROGRESS_MS) {
      scheduleStaleProgressReset(card.id);
      continue;
    }
    void clearIncompleteCardStatus(card.id);
  }
}

async function resetStaleCardProgress(
  cardId,
  { markIncomplete = false, recordStats = false } = {},
) {
  if (!cardId) return;
  cardProgress.delete(cardId);
  if (markIncomplete && recordStats) {
    await recordCardAbandoned(cardId);
  }
  await clearIncompleteCardStatus(cardId);
}

async function clearIncompleteCardStatus(cardId) {
  if (!cardId || expiringIncompleteUi.has(cardId)) return;
  const card = cards.find((c) => c.id === cardId);
  if (card && card.status !== "incomplete") {
    cardProgress.delete(cardId);
    clearCardProgressMeta(cardId);
    return;
  }
  expiringIncompleteUi.add(cardId);
  try {
    if (card) card.status = "queued";
    await setCardStatusLocal(cardId, "queued");
    cardProgress.delete(cardId);
    clearCardProgressMeta(cardId);
    try {
      await window.coact.watchCard?.(cardId, { resetProgress: true });
      if (activeCardId !== cardId) {
        await window.coact.watchCard?.(null);
      }
    } catch {
      /* ignore */
    }
  } finally {
    expiringIncompleteUi.delete(cardId);
  }
}

function scheduleStaleProgressReset(cardId) {
  if (!cardId) return;
  const existing = staleProgressTimers.get(cardId);
  if (existing) clearTimeout(existing);
  const meta = getCardProgressMeta(cardId);
  const abandonedAt = meta.abandonedAt || Date.now();
  const wait = Math.max(1000, STALE_PROGRESS_MS - (Date.now() - abandonedAt));
  const timer = setTimeout(async () => {
    staleProgressTimers.delete(cardId);
    if (activeCardId === cardId) return;
    if (isCardStepsComplete(cardId)) return;
    await clearIncompleteCardStatus(cardId);
    renderQueue();
  }, wait);
  staleProgressTimers.set(cardId, timer);
}

async function handleBackToQueueBeforeComplete({ wasRunning = false } = {}) {
  const cardId = activeCardId;
  if (!cardId || isCardStepsComplete(cardId)) return;
  // Leaving mid-work → mark incomplete (QueueCards + Executions for Stats) and start 15-min wait
  saveCardProgress(cardId);
  markCardAbandoned(cardId);
  if (wasRunning) {
    // controlRun(cancel) already finalizes Executions as cancelled (counts as incomplete)
    await setCardStatusLocal(cardId, "incomplete");
  } else {
    await recordCardAbandoned(cardId);
  }
  scheduleStaleProgressReset(cardId);
}

function restoreCardProgress(cardId, steps) {
  const saved = cardProgress.get(cardId);
  if (!saved || !steps?.length) return steps;
  return steps.map((step) => ({
    ...step,
    status: saved.get(step.id) || step.status || "pending",
  }));
}

function applyProgressUpdate(cardId, stepId, status) {
  if (!cardId || !stepId) return;
  let map = cardProgress.get(cardId);
  if (!map) {
    map = new Map();
    cardProgress.set(cardId, map);
  }
  map.set(stepId, status);
  touchCardActivity(cardId);
}

function applyQueuePayload(data) {
  cards = (data.queue || []).map((card) => ({
    ...card,
    lob: String(card.lob || "").trim(),
    steps:
      card.steps && card.steps.length
        ? card.steps
        : DUMMY_STEPS.map((s) => ({ ...s })),
  }));
  expireIncompleteCardUi();
}

function playMissAlert() {
  // Sound disabled
}

function isVoiceCoachOn(cardId = activeCardId) {
  if (!cardId) return false;
  return voiceCoachOnByCard.get(cardId) === true;
}

function voiceGuideButtonLabel(cardId) {
  return isVoiceCoachOn(cardId) ? "Stop" : "Coach";
}

function syncVoiceGuideButtons(cardId = activeCardId) {
  if (!btnVoiceGuide) return;
  const id = activeCardId || cardId;
  const on = isVoiceCoachOn(id);
  btnVoiceGuide.textContent = voiceGuideButtonLabel(id);
  btnVoiceGuide.title = on ? "Stop coaching voice" : "Start coaching voice";
  btnVoiceGuide.disabled = !activeCardId;
  btnVoiceGuide.classList.toggle("active", on);
}

function stopGuideVoice({ silent = true } = {}) {
  lastGuideSpeakKey = "";
  lastGuideStepId = "";
  window.liveTrackVoice?.stopSpeaking?.({ silent });
}

/** Clean step label for spoken coaching (not a flat UI read-out). */
function cleanStepLabelForCoach(raw) {
  let s = String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/[*•]+/g, "")
    .trim();
  if (!s) return "this step";
  s = s.replace(
    /^(please\s+)?(enter|type|fill\s*(in|out)?|click|select|check|choose|tap|press)\s+/i,
    "",
  );
  s = s.replace(/[:.\s]+$/g, "").trim();
  return s || "this step";
}

function coachPhraseForStep(step, { index = 0, total = 0, kind = "now" } = {}) {
  const action = String(step?.action || "fill").toLowerCase();
  const label = cleanStepLabelForCoach(step?.label || step?.id || "");
  const n = Number(index) + 1;
  const isFirst = kind === "first" || (kind === "now" && index === 0);
  const isNext = kind === "next";

  let core;
  if (action === "click") {
    core = `click ${label}`;
  } else if (action === "check") {
    core = `check ${label} and confirm it looks right`;
  } else if (action === "select") {
    core = `select ${label}`;
  } else if (action === "wait" || action === "pause") {
    core = `pause here for a moment on ${label}`;
  } else {
    core = `fill in ${label}`;
  }

  let phrase;
  if (isFirst) {
    phrase = `Alright, let's walk through this together. Start by ${core}.`;
  } else if (isNext) {
    phrase = `Nice work. Next, ${core}.`;
  } else {
    phrase = `Okay — ${core} now.`;
  }

  if (total > 1 && n > 0 && isFirst) {
    phrase += ` This is step ${n} of ${total}.`;
  }

  if (phrase.length > 180) phrase = `${phrase.slice(0, 177)}…`;
  return phrase;
}

/** Current step to coach: running (blue), else first incomplete — never failed (red). */
function currentGuideStep() {
  const ids = [...stepIndex.keys()];
  for (const id of ids) {
    const st = stepStatuses.get(id);
    if (st === "running") {
      return {
        stepId: id,
        step: stepIndex.get(id),
        index: ids.indexOf(id),
        status: st,
      };
    }
  }
  for (const id of ids) {
    const st = stepStatuses.get(id);
    if (st === "failed" || st === "error") continue;
    if (st !== "done" && st !== "success") {
      return {
        stepId: id,
        step: stepIndex.get(id),
        index: ids.indexOf(id),
        status: st,
      };
    }
  }
  return null;
}

function nextGuideStepAfter(stepId) {
  const ids = [...stepIndex.keys()];
  const idx = ids.indexOf(stepId);
  if (idx < 0) return null;
  for (let i = idx + 1; i < ids.length; i++) {
    const id = ids[i];
    const st = stepStatuses.get(id);
    if (st === "failed" || st === "error") continue;
    if (st === "done" || st === "success") continue;
    return { stepId: id, step: stepIndex.get(id), index: i, status: st };
  }
  return null;
}

async function speakGuideForStep(stepId, { kind = "now", force = false } = {}) {
  const cardId = activeCardId;
  if (!cardId || !stepId) return false;
  if (!force && !isVoiceCoachOn(cardId)) return false;
  if (!guideAudioReady && !force) return false;

  const status = stepStatuses.get(stepId);
  // Never coach failed/red steps
  if (status === "failed" || status === "error") return false;

  const step = stepIndex.get(stepId);
  if (!step) return false;
  const ids = [...stepIndex.keys()];
  const index = Math.max(0, ids.indexOf(stepId));
  const total = ids.length;
  const incompleteBefore = ids.slice(0, index).every((id) => {
    const st = stepStatuses.get(id);
    return st === "done" || st === "success";
  });
  const speakKind =
    kind === "next"
      ? "next"
      : kind === "first"
        ? "first"
        : kind === "resume"
          ? incompleteBefore && index === 0
            ? "first"
            : "now"
          : incompleteBefore && index === 0
            ? "first"
            : kind;

  const key = `${cardId}:${stepId}`;
  if (!force && key === lastGuideSpeakKey) return false;
  // Don't interrupt an in-flight coach line for the same step
  if (
    force &&
    key === lastGuideSpeakKey &&
    window.liveTrackVoice?.isSpeaking?.()
  ) {
    return true;
  }
  lastGuideSpeakKey = key;
  lastGuideStepId = stepId;

  const phrase = coachPhraseForStep(step, {
    index,
    total,
    kind:
      speakKind === "first" ? "first" : speakKind === "next" ? "next" : "now",
  });
  try {
    await window.liveTrackVoice?.unlockAudio?.();
    const ok = await window.liveTrackVoice?.speak?.(phrase, {
      quiet: true,
      preferLocal: true,
    });
    if (!ok) {
      const err =
        window.liveTrackVoice?.lastError?.() ||
        "Could not play coach voice. Check OpenAI key in Settings.";
      if (
        runNote &&
        (!runNote.textContent || /coach voice/i.test(runNote.textContent))
      ) {
        runNote.className = "run-note";
        runNote.textContent = err;
      }
    } else if (
      runNote &&
      /coach voice|OpenAI key|enable app speech/i.test(
        runNote.textContent || "",
      )
    ) {
      runNote.textContent = "";
    }
    return Boolean(ok);
  } catch (err) {
    if (runNote) {
      runNote.className = "run-note";
      runNote.textContent = err?.message || "Could not play coach voice.";
    }
    return false;
  }
}

function setVoiceCoachOn(cardId, on) {
  if (!cardId) return;
  voiceCoachOnByCard.set(cardId, Boolean(on));
  if (!on) {
    voiceCoachGen += 1;
    stopGuideVoice({ silent: true });
  }
  syncVoiceGuideButtons(cardId);
}

/** Turn coaching on for a card and optionally speak the current step. */
async function startVoiceCoachForCard(cardId, { speak = true } = {}) {
  if (!cardId) return;
  const gen = ++voiceCoachGen;
  guideAudioReady = true;
  // Kick unlock immediately (same turn as card click when possible)
  const unlockPromise = window.liveTrackVoice?.unlockAudio?.();
  setVoiceCoachOn(cardId, true);
  syncVoiceGuideButtons(cardId);
  if (!speak) return;
  try {
    await unlockPromise;
  } catch {
    /* ignore */
  }
  if (gen !== voiceCoachGen || activeCardId !== cardId) return;
  lastGuideSpeakKey = "";
  lastGuideStepId = "";
  const cur = currentGuideStep();
  if (!cur?.stepId) return;
  await speakGuideForStep(cur.stepId, { kind: "first", force: true });
}

async function toggleVoiceGuide(cardId) {
  const id = cardId || activeCardId;
  if (!id) return;
  if (isVoiceCoachOn(id)) {
    setVoiceCoachOn(id, false);
    return;
  }
  await startVoiceCoachForCard(id, { speak: true });
}

function updateTailSummary() {
  const total = stepIndex.size || 0;
  let done = 0;
  let failed = 0;
  for (const status of stepStatuses.values()) {
    if (status === "done" || status === "success") done += 1;
    if (status === "failed" || status === "error") failed += 1;
  }
  window.coact.setTailStatus?.({
    ok: failed === 0 && done > 0,
    bad: failed > 0,
    done,
    total,
  });
}

function renderSteps(steps) {
  clearStuckCoach();
  stepList.innerHTML = "";
  stepIndex = new Map(steps.map((s) => [s.id, s]));
  stepStatuses = new Map(steps.map((s) => [s.id, s.status || "pending"]));
  steps.forEach((step, index) => {
    const li = document.createElement("li");
    const status = step.status || "pending";
    const isMandatory = Boolean(step.mandatory);
    li.className = `step ${status === "done" ? "done" : status}${isMandatory ? " mandatory" : ""}`;
    li.dataset.stepId = step.id;
    if (isMandatory) li.dataset.mandatory = "true";
    const keyMark = isMandatory
      ? `<span class="step-key" title="Mandatory step — AI approve value available" aria-label="Mandatory">
          <svg class="step-key-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path fill="currentColor" d="M10.5 1a4.5 4.5 0 0 0-4.37 5.5L1 11.63V15h3.37l1.06-1.06.94.94H8.5v-2.12l.94-.94.94.94H12v-2.13l.56-.56A4.5 4.5 0 1 0 10.5 1zm0 2a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z"/>
          </svg>
        </span>`
      : "";
    li.innerHTML = `
      <span class="idx">${index + 1}</span>
      <span class="label">${escapeHtml(step.label)}</span>
      <span class="state"></span>
      ${keyMark}
    `;
    stepList.appendChild(li);
  });
  if (agentPreviewActive) {
    applyAgentPreviewValues(pendingAgentProposal?.proposals);
  }
  updateTailSummary();
  noteStepActivity();
}

/** Planned fill value for Agent preview — prefer case data the run will use. */
function plannedValueForStep(step) {
  const action = String(step?.action || "").toLowerCase();
  if (action === "click" || action === "check" || action === "pause" || action === "wait") {
    return null;
  }
  const card = cards.find((c) => c.id === activeCardId);
  const data = card?.data && typeof card.data === "object" ? card.data : null;
  const key =
    step?.valueFrom != null
      ? step.valueFrom
      : data && step?.id != null && Object.prototype.hasOwnProperty.call(data, step.id)
        ? step.id
        : null;
  if (data && key != null && data[key] != null) {
    const v = data[key];
    if (Array.isArray(v)) {
      const first = v.map((x) => String(x ?? "").trim()).find(Boolean);
      if (first) return { value: first, valueKey: key, reason: `From case data (${key})` };
    } else {
      const s = String(v).trim();
      if (s) return { value: s, valueKey: key, reason: `From case data (${key})` };
    }
  }
  if (step?.value != null && String(step.value).trim()) {
    return {
      value: String(step.value).trim(),
      valueKey: key || step.id,
      reason: "From SOP step value",
    };
  }
  if (Array.isArray(step?.allowedValues) && step.allowedValues.length) {
    const first = step.allowedValues.map((v) => String(v ?? "").trim()).find(Boolean);
    if (first) {
      return { value: first, valueKey: key || step.id, reason: "From allowed values" };
    }
  }
  if (step?.mandatory && action === "fill") {
    return {
      value: "",
      valueKey: key || step.id,
      reason: "Mandatory — enter a value before approving.",
    };
  }
  return null;
}

function clearAgentStepPreviewMarks() {
  stepList?.querySelectorAll(".step-planned-value").forEach((el) => el.remove());
  stepList?.querySelectorAll(".step.previewing").forEach((el) => el.classList.remove("previewing"));
}

function applyAgentPreviewValues(proposals) {
  clearAgentStepPreviewMarks();
  const list = Array.isArray(proposals)
    ? proposals
    : pendingAgentProposal?.proposals || [];
  for (const p of list) {
    const id = p?.stepId;
    if (!id) continue;
    const li = stepList.querySelector(`[data-step-id="${CSS.escape(id)}"]`);
    if (!li) continue;
    const value = String(p.value || "").trim();
    if (!value) continue;
    const label = li.querySelector(".label");
    if (!label) continue;
    const span = document.createElement("span");
    span.className = "step-planned-value";
    span.textContent = value;
    label.insertAdjacentElement("afterend", span);
    li.classList.add("previewing");
  }
  return list;
}

function buildLocalAgentProposalsFromSteps() {
  const proposals = [];
  for (const [id, step] of stepIndex.entries()) {
    const st = stepStatuses.get(id);
    if (st === "done" || st === "success") continue;
    if (String(step?.action || "").toLowerCase() !== "fill") continue;
    const planned = plannedValueForStep(step);
    if (!planned && !step?.mandatory) continue;
    proposals.push({
      stepId: id,
      label: step.label || id,
      value: planned?.value || "",
      valueKey: planned?.valueKey || step.valueFrom || id,
      reason: planned?.reason || "Enter a value for this field.",
      mandatory: Boolean(step.mandatory),
    });
  }
  return proposals;
}

function isStepMandatory(stepId) {
  return Boolean(stepIndex.get(stepId)?.mandatory);
}

function focusAgentValueInput(stepId) {
  const input = agentProposeList?.querySelector(
    `.agent-propose-input[data-step-id="${CSS.escape(stepId)}"]`
  );
  if (!input) return;
  input.focus();
  input.select?.();
}

function renderAgentProposeList(proposals) {
  if (!agentProposeList) return;
  agentProposeList.innerHTML = "";
  if (!proposals?.length) {
    const empty = document.createElement("li");
    empty.className = "agent-propose-item";
    empty.innerHTML = `<span class="agent-propose-label">No fill values</span>
      <span class="agent-propose-reason">This run may only click or check fields. Approve to continue, or Reject.</span>`;
    agentProposeList.appendChild(empty);
    return;
  }
  for (const row of proposals) {
    const mandatory = isStepMandatory(row.stepId) || Boolean(row.mandatory);
    const li = document.createElement("li");
    li.className = `agent-propose-item${mandatory ? " mandatory" : ""}`;
    li.dataset.stepId = row.stepId || "";
    if (row.valueKey) li.dataset.valueKey = row.valueKey;
    const inputId = `agent-val-${String(row.stepId || "").replace(/[^\w-]/g, "_")}`;
    li.innerHTML = `
      <div class="agent-propose-head">
        <label class="agent-propose-label" for="${escapeHtml(inputId)}">
          ${escapeHtml(row.label || row.stepId || "Field")}
          ${mandatory ? '<span class="agent-propose-req">Required</span>' : ""}
        </label>
        <button
          type="button"
          class="agent-propose-pen"
          data-step-id="${escapeHtml(row.stepId || "")}"
          title="Edit value"
          aria-label="Edit ${escapeHtml(row.label || "value")}"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path fill="currentColor" d="M11.7 1.3a1.5 1.5 0 0 1 2.1 2.1l-.7.7-2.1-2.1.7-.7zM10.3 2.7 2 11v3h3l8.3-8.3-2.1-2.1z"/>
          </svg>
        </button>
      </div>
      <input
        id="${escapeHtml(inputId)}"
        class="agent-propose-input"
        type="text"
        data-step-id="${escapeHtml(row.stepId || "")}"
        value="${escapeHtml(row.value || "")}"
        ${mandatory ? 'required aria-required="true"' : ""}
        autocomplete="off"
      />
      <span class="agent-propose-reason">${escapeHtml(row.reason || "")}</span>
    `;
    const input = li.querySelector(".agent-propose-input");
    input?.addEventListener("input", () => {
      const next = String(input.value || "");
      const dest = (pendingAgentProposal?.proposals || []).find((x) => x.stepId === row.stepId);
      if (dest) dest.value = next;
      applyAgentPreviewValues(pendingAgentProposal?.proposals);
      input.classList.toggle("invalid", mandatory && !next.trim());
    });
    li.querySelector(".agent-propose-pen")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      focusAgentValueInput(row.stepId);
    });
    if (mandatory && !String(row.value || "").trim()) input?.classList.add("invalid");
    agentProposeList.appendChild(li);
  }
}

function collectEditedAgentOverrides() {
  const overrides = {};
  const byStepId = {};
  const proposals = [];
  const inputs = agentProposeList?.querySelectorAll(".agent-propose-input") || [];
  for (const input of inputs) {
    const stepId = input.getAttribute("data-step-id") || "";
    const li = input.closest(".agent-propose-item");
    const valueKey = li?.dataset?.valueKey || stepId;
    const value = String(input.value || "").trim();
    const prior = (pendingAgentProposal?.proposals || []).find((p) => p.stepId === stepId);
    proposals.push({
      stepId,
      label: prior?.label || stepId,
      value,
      reason: prior?.reason || "",
      valueKey,
      mandatory: isStepMandatory(stepId),
    });
    if (valueKey && value) overrides[valueKey] = value;
    if (stepId && value) byStepId[stepId] = value;
  }
  return { proposals, dataOverrides: overrides, agentApprovedValues: byStepId };
}

function validateAgentEdits() {
  let firstInvalid = null;
  const inputs = agentProposeList?.querySelectorAll(".agent-propose-input") || [];
  for (const input of inputs) {
    const stepId = input.getAttribute("data-step-id") || "";
    const mandatory = isStepMandatory(stepId);
    const empty = !String(input.value || "").trim();
    input.classList.toggle("invalid", mandatory && empty);
    if (mandatory && empty && !firstInvalid) firstInvalid = input;
  }
  return firstInvalid;
}

function clearAgentPreviewValues() {
  clearAgentStepPreviewMarks();
  if (agentProposeList) agentProposeList.innerHTML = "";
}

function setAgentApproveUi(active) {
  agentPreviewActive = Boolean(active);
  if (agentApproveModal) {
    agentApproveModal.classList.toggle("hidden", !agentPreviewActive);
    agentApproveModal.setAttribute("aria-hidden", agentPreviewActive ? "false" : "true");
  }
  if (agentApproveBar) agentApproveBar.classList.toggle("hidden", !agentPreviewActive);
  if (btnStart) {
    btnStart.classList.toggle("hidden", agentPreviewActive);
    btnStart.disabled = agentPreviewActive || runState !== "idle";
  }
  if (!agentPreviewActive) {
    clearAgentPreviewValues();
    pendingAgentProposal = null;
  }
}

async function showAgentPreview() {
  if (!activeCardId || runState !== "idle") return;
  closeMoreMenu();

  const requestId = ++agentProposeRequestId;
  pendingAgentProposal = null;
  setAgentApproveUi(false);
  btnStart.disabled = true;
  runNote.className = "run-note";
  runNote.textContent = "Agent is proposing values…";
  if (agentApproveHint) {
    agentApproveHint.textContent =
      "Edit values with the pen (required fields must be filled). Filling starts only after Approve.";
  }

  const completedStepIds = [];
  for (const [id, status] of stepStatuses.entries()) {
    if (status === "done" || status === "success") completedStepIds.push(id);
  }
  const steps = [...stepIndex.values()].filter((s) => !completedStepIds.includes(s.id));

  try {
    let proposals = [];
    let dataOverrides = {};
    let usedAi = false;
    let needsKey = false;
    let note = "";

    if (typeof window.coact.proposeAgentFill === "function") {
      const res = await window.coact.proposeAgentFill({
        cardId: activeCardId,
        steps,
        completedStepIds,
      });
      if (requestId !== agentProposeRequestId || !activeCardId) return;
      if (!res?.ok && res?.error === "not_found") {
        runNote.className = "run-note error";
        runNote.textContent = "This case is no longer in the queue.";
        btnStart.disabled = runState !== "idle";
        return;
      }
      proposals = Array.isArray(res?.proposals) ? res.proposals : [];
      dataOverrides =
        res?.dataOverrides && typeof res.dataOverrides === "object" ? res.dataOverrides : {};
      usedAi = Boolean(res?.usedAi);
      needsKey = Boolean(res?.needsKey);
      note = res?.note || "";
    }

    if (!proposals.length) {
      proposals = buildLocalAgentProposalsFromSteps();
    } else {
      // Backfill any missing fill steps (mandatory + normal) so Approve covers the full run
      const have = new Set(proposals.map((p) => p.stepId));
      for (const step of steps) {
        if (String(step?.action || "").toLowerCase() !== "fill") continue;
        if (have.has(step.id)) continue;
        const planned = plannedValueForStep(step);
        if (!planned && !step?.mandatory) continue;
        proposals.push({
          stepId: step.id,
          label: step.label || step.id,
          value: planned?.value || "",
          valueKey: planned?.valueKey || step.valueFrom || step.id,
          reason:
            planned?.reason ||
            (step.mandatory
              ? "Mandatory — enter a value before approving."
              : "Enter a value for this field."),
          mandatory: Boolean(step.mandatory),
        });
      }
    }

    pendingAgentProposal = { proposals, dataOverrides };
    setAgentApproveUi(true);
    renderAgentProposeList(proposals);
    applyAgentPreviewValues(proposals);

    const n = proposals.length;
    runNote.className = "run-note";
    if (n === 0) {
      runNote.textContent =
        note || "No fill values found. Approve to run remaining clicks, or Reject.";
    } else if (needsKey) {
      runNote.textContent = `Review ${n} value${n === 1 ? "" : "s"} (case data — add OpenAI key for AI reasons). Use the pen to edit, then Approve.`;
    } else if (usedAi) {
      runNote.textContent = `Review ${n} proposed value${n === 1 ? "" : "s"}. Use the pen to edit, then Approve.`;
    } else {
      runNote.textContent =
        note || `Review ${n} value${n === 1 ? "" : "s"}. Use the pen to edit, then Approve.`;
    }

    const firstInput = agentProposeList?.querySelector(".agent-propose-input");
    (firstInput || btnApproveAgentModal || btnApproveAgent)?.focus();
  } catch (err) {
    if (requestId !== agentProposeRequestId) return;
    runNote.className = "run-note error";
    runNote.textContent = err?.message || "Could not propose values.";
    setAgentApproveUi(false);
  } finally {
    if (requestId === agentProposeRequestId && runState === "idle" && !agentPreviewActive) {
      btnStart.disabled = false;
    }
  }
}

function cancelAgentPreview() {
  agentProposeRequestId += 1;
  setAgentApproveUi(false);
  if (btnStart) btnStart.disabled = runState !== "idle";
  runNote.className = "run-note";
  runNote.textContent = "";
}

async function approveAgentAndFill() {
  if (!activeCardId || runState !== "idle") return;

  const invalid = validateAgentEdits();
  if (invalid) {
    runNote.className = "run-note error";
    runNote.textContent = "Fill every required field before approving.";
    invalid.focus();
    return;
  }

  const edited = collectEditedAgentOverrides();
  // Ensure every remaining fill step with a known/planned value is included (not only modal rows)
  for (const [id, step] of stepIndex.entries()) {
    const st = stepStatuses.get(id);
    if (st === "done" || st === "success") continue;
    if (String(step?.action || "").toLowerCase() !== "fill") continue;
    if (edited.agentApprovedValues[id]) continue;
    const planned = plannedValueForStep(step);
    const value = String(planned?.value || "").trim();
    if (!value) continue;
    const valueKey = planned?.valueKey || step.valueFrom || id;
    edited.agentApprovedValues[id] = value;
    if (valueKey) edited.dataOverrides[valueKey] = value;
  }

  setAgentApproveUi(false);
  clearStuckCoach();
  agentApprovedForRun = true;
  runNote.className = "run-note";
  runNote.textContent = "";
  await startFilling({
    dataOverrides: edited.dataOverrides,
    agentApprovedValues: edited.agentApprovedValues,
    agentApproved: true,
  });
}

function clearStuckTimer() {
  if (stuckTimer) {
    clearTimeout(stuckTimer);
    stuckTimer = null;
  }
}

function clearStuckCoach() {
  clearStuckTimer();
  activeCoachStepId = null;
  coachRequestId += 1;
  document.querySelectorAll(".step-coach").forEach((el) => el.remove());
}

function noteStepActivity() {
  lastStepActivityAt = Date.now();
  clearStuckTimer();
  if (!activeCardId || screenQuest.classList.contains("hidden")) return;
  stuckTimer = setTimeout(() => {
    stuckTimer = null;
    evaluateStuckStep();
  }, STUCK_MS);
}

function findStuckCandidateStepId() {
  for (const [id, status] of stepStatuses.entries()) {
    if (status === "running") return id;
  }
  for (const [id, status] of stepStatuses.entries()) {
    if (status !== "done" && status !== "success") return id;
  }
  return null;
}

function canShowCoach(stepId) {
  const ep = coachEpisode.get(stepId);
  if (!ep) return true;
  if (ep.shown && activeCoachStepId === stepId) return false;
  if (ep.dismissedAt && Date.now() - ep.dismissedAt < COACH_COOLDOWN_MS) return false;
  return true;
}

function dismissStepCoach(stepId) {
  const el = stepList.querySelector(`[data-step-id="${CSS.escape(stepId)}"] .step-coach`);
  if (el) el.remove();
  if (activeCoachStepId === stepId) activeCoachStepId = null;
  const ep = coachEpisode.get(stepId) || {};
  ep.shown = false;
  ep.holdCoachForApprove = false;
  ep.dismissedAt = Date.now();
  coachEpisode.set(stepId, ep);
}

function knownValueForStep(step) {
  const card = cards.find((c) => c.id === activeCardId);
  // Prefer SOP allowedValues (exact list) — Approve suggests the first entry
  if (Array.isArray(step?.allowedValues) && step.allowedValues.length) {
    const first = step.allowedValues.map((v) => String(v ?? "").trim()).find(Boolean);
    if (first) return first;
  }
  const data = card?.data && typeof card.data === "object" ? card.data : null;
  // valueFrom preferred; fall back to step.id when it matches a case data key (attend/name fields)
  const key =
    step?.valueFrom != null
      ? step.valueFrom
      : data && step?.id != null && Object.prototype.hasOwnProperty.call(data, step.id)
        ? step.id
        : null;
  if (!data || key == null) {
    if (step?.value != null && String(step.value).trim()) return String(step.value).trim();
    return "";
  }
  const v = data[key];
  if (v == null) return "";
  if (Array.isArray(v)) {
    const first = v.map((x) => String(x ?? "").trim()).find(Boolean);
    return first || "";
  }
  return String(v).trim();
}

/** Instant tip — no user prompt / Ask AI required */
function localAutoCoachTip(step) {
  const label = String(step?.label || "this step").trim();
  const action = String(step?.action || "").toLowerCase();
  const short = label
    .replace(/^(click|select|confirm|fill|pause for)\s+/i, "")
    .trim() || label;

  if (action === "click" || action === "check") {
    return `On the form tab, click “${short}”. When that action completes, this step turns green.`;
  }
  if (action === "fill") {
    const known = knownValueForStep(step);
    if (step?.mandatory && known) {
      return `This step is marked mandatory. Suggested case value: “${known}”. Approve to autofill, or type any value — the field just needs to be filled.`;
    }
    if (step?.mandatory) {
      return `This step is marked mandatory. Fill “${short}” on the form — any value completes the step.`;
    }
    return `On the form, fill “${short}” with any value. Leave the field when done — this step turns green.`;
  }
  if (action === "highlight") {
    return `Check the highlighted control on the form, then finish submit or upload yourself.`;
  }
  if (action === "wait") {
    return `Wait for the page to finish loading, then continue with the next step.`;
  }
  return `Finish “${label}” on the open form tab. When it’s done, this step turns green.`;
}

function stepCanApprove(step, suggestedValue) {
  // After Agent modal Approve, never re-prompt per-step mandatory Approve for that run
  if (agentApprovedForRun) return false;
  return Boolean(
    step?.mandatory &&
      String(step?.action || "").toLowerCase() === "fill" &&
      String(suggestedValue || "").trim()
  );
}

function showStepCoachPopover(stepId, {
  thinking = false,
  text = "",
  canApply = false,
  canRetry = false,
  suggestedValue = "",
  confidence = "low",
  showTakeOver = false,
} = {}) {
  const li = stepList.querySelector(`[data-step-id="${CSS.escape(stepId)}"]`);
  if (!li) return;

  let box = li.querySelector(".step-coach");
  if (!box) {
    box = document.createElement("div");
    box.className = "step-coach";
    box.setAttribute("role", "alert");
    li.appendChild(box);
  }

  activeCoachStepId = stepId;
  const ep = coachEpisode.get(stepId) || {};
  ep.shown = true;
  coachEpisode.set(stepId, ep);

  const body = thinking ? "…" : text || localAutoCoachTip(stepIndex.get(stepId));
  lastCoachMeta = { stepId, suggestedValue, canApply, canRetry, confidence };

  const valueBlock =
    canApply && suggestedValue
      ? `<div class="step-coach-value">AI approve value: <strong>${escapeHtml(suggestedValue)}</strong></div>`
      : "";

  const actions = [
    canApply
      ? `<button type="button" class="step-coach-apply" data-action="approve">Approve</button>`
      : "",
    canRetry ? `<button type="button" class="step-coach-retry" data-action="retry">Retry</button>` : "",
    showTakeOver
      ? `<button type="button" class="step-coach-takeover" data-action="takeover">Take over</button>`
      : "",
    `<button type="button" class="step-coach-dismiss" data-action="dismiss">Dismiss</button>`,
  ]
    .filter(Boolean)
    .join("");

  box.innerHTML = `
    <div class="step-coach-title">${confidence === "high" && canApply ? "Approve fill" : "Tip"}</div>
    <div class="step-coach-body">${escapeHtml(body)}</div>
    ${valueBlock}
    <div class="step-coach-actions">${actions}</div>
  `;

  box.querySelector('[data-action="dismiss"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissStepCoach(stepId);
  });
  box.querySelector('[data-action="approve"]')?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await applyCoachAction({ broadMatch: false });
  });
  box.querySelector('[data-action="retry"]')?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await applyCoachAction({ broadMatch: true });
  });
  box.querySelector('[data-action="takeover"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissStepCoach(stepId);
    takeOver();
  });

  li.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function applyCoachAction({ broadMatch = false } = {}) {
  if (!activeCardId || !lastCoachMeta?.stepId) return;
  const step = stepIndex.get(lastCoachMeta.stepId);
  if (!step) return;
  runNote.className = "run-note";
  runNote.textContent = broadMatch ? "AI retry…" : "Applying…";
  const res = await window.coact.applyStep({
    cardId: activeCardId,
    stepId: lastCoachMeta.stepId,
    step,
    valueOverride: lastCoachMeta.suggestedValue || undefined,
    broadMatch,
  });
  if (!res?.ok) {
    runNote.className = "run-note error";
    runNote.textContent = res?.error || "Apply failed";
    showStepCoachPopover(lastCoachMeta.stepId, {
      text: res?.error || "Could not apply — take over or retry.",
      canApply: Boolean(lastCoachMeta.canApply && lastCoachMeta.suggestedValue),
      canRetry: true,
      suggestedValue: lastCoachMeta.suggestedValue || "",
      confidence: lastCoachMeta.confidence || "low",
      showTakeOver: true,
    });
    return;
  }
  const epClear = coachEpisode.get(lastCoachMeta.stepId) || {};
  epClear.holdCoachForApprove = false;
  coachEpisode.set(lastCoachMeta.stepId, epClear);
  dismissStepCoach(lastCoachMeta.stepId);
  runNote.className = "run-note";
  runNote.textContent = broadMatch ? "Retried with broader match" : "Approved & filled";
  setTimeout(() => {
    if (/Approved|Retried/.test(runNote.textContent || "")) runNote.textContent = "";
  }, 1500);
}

async function evaluateStuckStep() {
  if (!activeCardId || screenQuest.classList.contains("hidden")) return;
  if (Date.now() - lastStepActivityAt < STUCK_MS - 50) {
    noteStepActivity();
    return;
  }

  const stepId = findStuckCandidateStepId();
  if (!stepId) return;
  if (!canShowCoach(stepId)) return;

  const status = stepStatuses.get(stepId);
  if (status === "done" || status === "success") return;

  const step = stepIndex.get(stepId) || { id: stepId, label: stepId, action: "unknown" };
  const req = ++coachRequestId;

  // Always show an automatic tip immediately — Approve only for mandatory fills with a known value
  const autoTip = localAutoCoachTip(step);
  const known = knownValueForStep(step);
  const action = String(step.action || "").toLowerCase();
  const canApply = stepCanApprove(step, known);
  showStepCoachPopover(stepId, {
    text: autoTip,
    canApply,
    canRetry: ["fill", "click", "check"].includes(action),
    suggestedValue: canApply ? known : "",
    confidence: canApply ? "high" : "low",
  });

  try {
    const res = await window.coact.coachStuckStep({
      cardId: activeCardId,
      step: {
        id: step.id,
        label: step.label,
        action: step.action,
        valueFrom: step.valueFrom,
        mandatory: Boolean(step.mandatory),
      },
      stepContext: stepContextText(),
    });
    if (req !== coachRequestId || activeCardId == null) return;
    if (stepStatuses.get(stepId) === "done" || stepStatuses.get(stepId) === "success") {
      dismissStepCoach(stepId);
      return;
    }
    // Upgrade with GenAI text when available; never wipe an existing Approve value
    // (mismatch coach / local known) with an empty AI suggestedValue.
    if (res?.ok && res.text && !res.needsKey) {
      const prior =
        lastCoachMeta?.stepId === stepId ? String(lastCoachMeta.suggestedValue || "").trim() : "";
      const suggested = String(res.suggestedValue || known || prior || "").trim();
      const applyOk = stepCanApprove(step, suggested);
      showStepCoachPopover(stepId, {
        text: res.text,
        canApply: applyOk,
        canRetry: res.canRetry !== false,
        suggestedValue: applyOk ? suggested : "",
        confidence: res.confidence === "high" || applyOk ? "high" : "low",
      });
    }
  } catch {
    /* keep auto tip already shown */
  }
}

function setStepTone(stepId, tone, opts = {}) {
  const li = stepList.querySelector(`[data-step-id="${CSS.escape(stepId)}"]`);
  const mapped =
    tone === "success" ? "done" : tone === "error" ? "failed" : tone === "plan" ? "pending" : tone;
  const status =
    mapped === "done" || mapped === "running" || mapped === "failed" ? mapped : "pending";
  const prev = stepStatuses.get(stepId);
  stepStatuses.set(stepId, status);
  if (activeCardId) applyProgressUpdate(activeCardId, stepId, status);

  const guideOnStatusChange = () => {
    if (prev === status) return;
    // Red / failed — never coach
    if (status === "failed" || status === "error") return;
    if (status === "running") {
      speakGuideForStep(stepId, { kind: "now" });
      return;
    }
    // Attended mode often jumps grey → green without "running". Coach the next step.
    if (status === "done" || status === "success") {
      const next = nextGuideStepAfter(stepId);
      if (next?.stepId) {
        speakGuideForStep(next.stepId, { kind: "next" });
        return;
      }
      const allDone = ![...stepStatuses.values()].some(
        (s) => s !== "done" && s !== "success",
      );
      if (allDone && isVoiceCoachOn(activeCardId) && guideAudioReady) {
        lastGuideSpeakKey = `${activeCardId}:complete`;
        lastGuideStepId = "";
        window.liveTrackVoice?.speak?.(
          "That's everything on this card. Nice work.",
          { quiet: true, preferLocal: true },
        );
      }
    }
  };

  if (!li) {
    updateTailSummary();
    if (prev !== status) {
      noteStepActivity();
      guideOnStatusChange();
    }
    return;
  }
  // pending must strip done/running/failed so greens clear after field clears
  const mandatoryCls = li.dataset.mandatory === "true" ? " mandatory" : "";
  if (status === "pending") li.className = `step${mandatoryCls}`;
  else if (status === "running") li.className = `step running${mandatoryCls}`;
  else if (status === "done") li.className = `step done${mandatoryCls}`;
  else if (status === "failed") li.className = `step failed${mandatoryCls}`;
  else li.className = `step${mandatoryCls}`;

  // Clear coach only when this step finishes successfully — not on failed/mismatch.
  // Wrong mandatory fills keep Approve until corrected (valueMatched) or user Approves.
  if (status === "done") {
    const ep = coachEpisode.get(stepId) || {};
    if (opts.clearApprove) {
      ep.holdCoachForApprove = false;
      coachEpisode.set(stepId, ep);
    }
    if (ep.holdCoachForApprove) {
      li.className = `step done warn-mismatch${mandatoryCls}`;
      updateTailSummary();
      if (prev !== status) noteStepActivity();
      return;
    }
    const coach = li.querySelector(".step-coach");
    if (coach) coach.remove();
    if (activeCoachStepId === stepId) activeCoachStepId = null;
    coachEpisode.delete(stepId);
  } else if (status === "running" && activeCoachStepId && activeCoachStepId !== stepId) {
    dismissStepCoach(activeCoachStepId);
  }

  updateTailSummary();
  if (prev !== status) {
    noteStepActivity();
    guideOnStatusChange();
  }
}

function showQueue(opts = {}) {
  if (activeCardId && !opts.skipSave) saveCardProgress(activeCardId);
  cancelAgentPreview();
  clearStuckCoach();
  coachEpisode.clear();
  agentApprovedForRun = false;
  stopGuideVoice({ silent: true });
  activeCardId = null;
  if (activeNav !== "live") showNav("live");
  else hideGenAiShell();
  screenQueue.classList.remove("hidden");
  screenQuest.classList.add("hidden");
  tagline.textContent = "Live steps";
  setRunControls("idle");
  renderQueue();
  syncVoiceGuideButtons();
  if (captureRecording || capturePausedForNav) setRecordingEnabled(false);
}

function showQuest(card) {
  if (activeCardId && activeCardId !== card.id) {
    saveCardProgress(activeCardId);
  }
  cancelAgentPreview();
  clearStuckCoach();
  coachEpisode.clear();
  agentApprovedForRun = false;
  if (activeNav !== "live") showNav("live");
  activeCardId = card.id;
  // Clear abandon timer — user resumed this card
  const staleTimer = staleProgressTimers.get(card.id);
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleProgressTimers.delete(card.id);
  }
  // If they left mid-work and waited > 15 minutes, wipe progress
  if (!isCardStepsComplete(card.id) && isProgressStale(card.id)) {
    cardProgress.delete(card.id);
    clearCardProgressMeta(card.id);
    void recordCardAbandoned(card.id);
    void window.coact.watchCard?.(card.id, { resetProgress: true }).catch(() => {});
  } else {
    const meta = getCardProgressMeta(card.id);
    if (meta.abandonedAt) {
      cardProgressMeta.set(card.id, { activityAt: Date.now(), abandonedAt: 0 });
      persistProgressMetaStore();
    } else {
      touchCardActivity(card.id);
    }
  }
  screenQueue.classList.add("hidden");
  screenQuest.classList.remove("hidden");
  tagline.textContent =
    autoPinnedCardId === card.id ? "Auto-matched" : "Live steps";
  questTitle.textContent = card.title;
  questMeta.textContent =
    autoPinnedCardId === card.id
      ? "Pinned to this browser tab"
      : card.status === "done"
        ? "Completed"
        : card.status === "incomplete"
          ? "Incomplete"
          : "Ready";

  const baseSteps =
    card.steps && card.steps.length
      ? card.steps.map((s) => ({ ...s, status: s.status || "pending" }))
      : DUMMY_STEPS.map((s) => ({ ...s }));
  const steps = restoreCardProgress(card.id, baseSteps);

  renderSteps(steps);
  runNote.className = "run-note";
  runNote.textContent = "";
  setRunControls("idle");
  // Auto-start coaching whenever a card is opened; stays on until user taps Stop
  void startVoiceCoachForCard(card.id, { speak: true });

  window.coact.watchCard(card.id).then((res) => {
    if (!res?.ok) return;
    if (activeCardId !== card.id) return;
    if (res.steps?.length) {
      const merged = restoreCardProgress(card.id, res.steps);
      // Prefer live saved progress over fresh pending from SOP
      renderSteps(merged);
    }
    setRunControls(runState === "idle" ? "idle" : runState);
    syncVoiceGuideButtons(card.id);
    // Only speak if open-start didn't already (avoid canceling in-flight TTS)
    if (
      isVoiceCoachOn(card.id) &&
      !lastGuideStepId &&
      !window.liveTrackVoice?.isSpeaking?.()
    ) {
      const cur = currentGuideStep();
      if (cur?.stepId)
        void speakGuideForStep(cur.stepId, { kind: "first", force: true });
    }
  });
  if (capturePausedForNav && captureRecordingCardId === card.id) {
    setRecordingEnabled(true, { resume: true });
  }
}

function resetChat() {
  chatHistory = [];
  generalChatHistory = [];
  pendingAttachments = [];
  generalAttachments = [];
  pendingSnippet = "";
  activeChatId = null;
  streamingEl = null;
  if (chatLog) chatLog.innerHTML = "";
  if (generalChatLog) generalChatLog.innerHTML = "";
  syncChatLogVisibility(chatLog);
  syncChatLogVisibility(generalChatLog);
  renderAttachRow("form");
  renderAttachRow("general");
  closeGenAi();
}

function fuzzyScore(query, text) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return 1;
  const t = String(text || "").toLowerCase();
  if (!t) return 0;
  if (t.includes(q)) return 100 + (q.length / Math.max(t.length, 1)) * 20;

  // subsequence match (cldhlp → cloudhelp)
  let ti = 0;
  let hits = 0;
  let gaps = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    if (found > ti) gaps += found - ti;
    hits += 1;
    ti = found + 1;
  }
  return 40 + hits * 8 - Math.min(gaps, 30);
}

function cardMatchesSearch(card, query) {
  if (!query || !String(query).trim()) return true;
  const hay = `${card.title || ""} ${card.id || ""} ${card.status || ""} ${card.lob || ""}`;
  return fuzzyScore(query, hay) > 0;
}

function setInboxStatus(text, kind = "") {
  const el = document.getElementById("inboxStatus");
  if (!el) return;
  el.className = `desk-status muted tiny-copy${kind ? ` ${kind}` : ""}`;
  el.textContent = text || "";
}

function fillInboxContext() {
  const cardInput = document.getElementById("inboxCard");
  const lobInput = document.getElementById("inboxLob");
  const card = activeCardId ? cards.find((c) => c.id === activeCardId) : null;
  if (cardInput && !cardInput.dataset.touched) {
    cardInput.value = card?.id || "";
  }
  if (lobInput && !lobInput.dataset.touched) {
    lobInput.value = card?.lob || "";
  }
}

function clearInboxSnip() {
  inboxSnipPath = "";
  const preview = document.getElementById("inboxSnipPreview");
  const clearBtn = document.getElementById("btnInboxClearSnip");
  if (preview) {
    preview.removeAttribute("src");
    preview.classList.add("hidden");
  }
  if (clearBtn) clearBtn.hidden = true;
}

function renderInboxList(notes) {
  const list = document.getElementById("inboxRecentList");
  if (!list) return;
  if (!notes?.length) {
    list.innerHTML = `<li class="muted">No notes yet</li>`;
    return;
  }
  list.innerHTML = notes
    .slice(0, 12)
    .map((n) => {
      const when = String(n.ts || "")
        .slice(0, 16)
        .replace("T", " ");
      const sme = n.smeNote ? ` — ${n.smeNote}` : "";
      return `<li class="${n.status === "done" ? "ok" : n.status === "open" ? "" : ""}"><strong>${escapeHtml(n.title)}</strong> · ${escapeHtml(n.status)} · ${escapeHtml(when)}${escapeHtml(sme)}</li>`;
    })
    .join("");
}

async function refreshInboxList() {
  if (!window.coact?.inboxList) return;
  const res = await window.coact.inboxList();
  if (!res?.ok) {
    renderInboxList([]);
    if (res?.error) setInboxStatus(res.error, "error");
    return;
  }
  renderInboxList(res.notes || []);
}

function setActionsStatus(text, kind = "") {
  const el = document.getElementById("actionsStatus");
  if (!el) return;
  el.className = `desk-status muted tiny-copy${kind ? ` ${kind}` : ""}`;
  el.textContent = text || "";
}

function updateActionsBadge(pending) {
  if (!actionsBadge) return;
  const n = Number(pending) || 0;
  if (n > 0) {
    actionsBadge.textContent = n > 99 ? "99+" : String(n);
    actionsBadge.classList.remove("hidden");
  } else {
    actionsBadge.classList.add("hidden");
  }
}

async function refreshActionsBadge() {
  if (!window.coact?.actionsPendingCount) return;
  try {
    const res = await window.coact.actionsPendingCount();
    if (res?.ok) updateActionsBadge(res.pending);
  } catch {
    /* optional */
  }
}

function formatActionsDue(action) {
  if (!action?.dueAt) return "";
  const due = new Date(action.dueAt);
  if (Number.isNaN(due.getTime())) return "";
  const overdue = action.status !== "done" && due.getTime() < Date.now();
  const label =
    action.dueKind === "today"
      ? "due today"
      : action.dueKind === "week"
        ? "due this week"
        : due.toLocaleDateString();
  return overdue ? `overdue · ${label}` : label;
}

function renderActionsList(actions, { overdue = 0 } = {}) {
  const list = document.getElementById("actionsList");
  const hint = document.getElementById("actionsOverdueHint");
  if (hint) {
    if (overdue > 0) {
      hint.hidden = false;
      hint.classList.remove("hidden");
      hint.textContent = `${overdue} overdue — finish or mark Done.`;
    } else {
      hint.hidden = true;
      hint.classList.add("hidden");
      hint.textContent = "";
    }
  }
  if (!list) return;
  if (!actions?.length) {
    list.innerHTML = `<li class="muted">No action items yet. Stop &amp; refine a MOM, or add a note above.</li>`;
    return;
  }
  list.innerHTML = actions
    .map((a) => {
      const due = formatActionsDue(a);
      const meta = [
        a.owner ? escapeHtml(a.owner) : "",
        a.source === "mom" ? "from MOM" : "",
        a.meetingSubject ? escapeHtml(a.meetingSubject) : "",
        due ? escapeHtml(due) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const done = a.status === "done";
      const overdueCls =
        !done && a.dueAt && new Date(a.dueAt).getTime() < Date.now()
          ? " overdue"
          : "";
      return `<li class="actions-item${done ? " done" : ""}${overdueCls}" data-id="${escapeHtml(a.id)}">
        <div class="actions-item-main">
          <strong>${escapeHtml(a.title)}</strong>
          ${meta ? `<span class="muted tiny-copy">${meta}</span>` : ""}
        </div>
        <button type="button" class="btn ghost tiny actions-toggle" data-id="${escapeHtml(a.id)}" data-done="${done ? "1" : "0"}">${done ? "Reopen" : "Done"}</button>
      </li>`;
    })
    .join("");
}

async function refreshActionsList() {
  if (!window.coact?.actionsList) return;
  const showDone = Boolean(document.getElementById("actionsShowDone")?.checked);
  const res = await window.coact.actionsList({ includeDone: showDone });
  if (!res?.ok) {
    renderActionsList([]);
    if (res?.error) setActionsStatus(res.error, "error");
    return;
  }
  updateActionsBadge(res.pending);
  renderActionsList(res.actions || [], { overdue: res.overdue || 0 });
}

async function submitActionsNote() {
  const titleEl = document.getElementById("actionsTitle");
  const ownerEl = document.getElementById("actionsOwner");
  const dueEl = document.getElementById("actionsDueKind");
  const title = titleEl?.value.trim() || "";
  if (!title) {
    setActionsStatus("Add a task.");
    titleEl?.focus();
    return;
  }
  const btn = document.getElementById("btnActionsAdd");
  if (btn) btn.disabled = true;
  setActionsStatus("Saving…");
  try {
    const res = await window.coact.actionsAdd?.({
      title,
      owner: ownerEl?.value.trim() || "",
      dueKind: dueEl?.value || "week",
      source: "manual",
    });
    if (!res?.ok) {
      setActionsStatus(res?.error || "Could not save", "error");
      return;
    }
    if (titleEl) titleEl.value = "";
    if (ownerEl) ownerEl.value = "";
    setActionsStatus("Saved to permanent memory.");
    await refreshActionsList();
  } catch (err) {
    setActionsStatus(err?.message || "Could not save", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showNav(id) {
  const next = [
    "live",
    "jira",
    "mom",
    "actions",
    "ai",
    "desk",
    "feedback",
    "analytics",
    "dashboard",
  ].includes(id)
    ? id
    : "live";
  const prev = activeNav;
  activeNav = next;
  const panes = {
    live: paneLive,
    jira: paneJira,
    mom: paneMom,
    actions: paneActions,
    ai: paneAi,
    desk: paneDesk,
    feedback: paneFeedback,
    analytics: paneAnalytics,
    dashboard: paneDashboard,
  };
  const navBtns = {
    live: navLive,
    jira: navJira,
    mom: navMom,
    actions: navActions,
    ai: navAi,
    desk: navDesk,
    feedback: navFeedback,
    analytics: navAnalytics,
    dashboard: navDashboard,
  };

  for (const [key, pane] of Object.entries(panes)) {
    const on = key === next;
    pane?.classList.toggle("hidden", !on);
    pane?.setAttribute("aria-hidden", on ? "false" : "true");
    navBtns[key]?.classList.toggle("active", on);
  }
  navJira?.setAttribute("aria-expanded", next === "jira" ? "true" : "false");
  navMom?.setAttribute("aria-expanded", next === "mom" ? "true" : "false");
  navActions?.setAttribute(
    "aria-expanded",
    next === "actions" ? "true" : "false",
  );
  navAi?.setAttribute("aria-expanded", next === "ai" ? "true" : "false");
  navDesk?.setAttribute("aria-expanded", next === "desk" ? "true" : "false");
  navFeedback?.setAttribute(
    "aria-expanded",
    next === "feedback" ? "true" : "false",
  );
  navAnalytics?.setAttribute(
    "aria-expanded",
    next === "analytics" ? "true" : "false",
  );
  try {
    localStorage.setItem("livetrack.activeNav", next);
  } catch {
    /* ignore */
  }

  if (next !== "live") {
    hideGenAiShell();
    if (syncTabTimer) {
      clearTimeout(syncTabTimer);
      syncTabTimer = null;
    }
  }

  if (next === "jira") {
    window.coact.jiraSetPaneActive?.(true);
    refreshJiraPanel();
  } else {
    window.coact.jiraSetPaneActive?.(false);
    if (next === "mom") {
      refreshMomPanel();
      refreshMomPastList();
    }
    if (next === "dashboard") {
      refreshDashboard();
    }
    if (next === "analytics") {
      setTimeout(() => refreshAnalytics(), 0);
    }
    if (next === "desk") {
      refreshDeskIssues();
      refreshDeskCollabList();
    }
    if (next === "feedback") {
      fillInboxContext();
      refreshInboxList();
    }
    if (next === "actions") {
      refreshActionsList();
    }
  }

  if (tagline) {
    tagline.textContent =
      next === "live"
        ? "Live steps"
        : next === "jira"
          ? "Jira stories"
          : next === "mom"
            ? "Minutes of Meeting"
            : next === "actions"
              ? "Action items"
              : next === "ai"
                ? "Ask LiveTrack"
                : next === "desk"
                  ? "Desk"
                  : next === "feedback"
                    ? "Feedback"
                    : next === "analytics"
                      ? "Analytics"
                      : "Dash";
  }
  if (next === "ai") generalChatInput?.focus();
  if (next === "dashboard") ensureCapturePoll();
  else stopCapturePollIfIdle();
  if (prev === "live" && next !== "live") pauseRecordingForNav();
  if (prev !== "live" && next === "live") resumeRecordingAfterNav();
  if (next === "live") scheduleSyncQueueToActiveTab(true);
}

function defaultChatPlaceholder() {
  return "Ask how to fill this form…";
}

function clearAiFocusCard() {
  aiFocusCard = null;
  if (chatInput) chatInput.placeholder = defaultChatPlaceholder();
}

function hideGenAiShell() {
  const wasOpen = genaiShell && !genaiShell.classList.contains("hidden");
  genaiShell?.classList.add("hidden");
  genaiShell?.setAttribute("aria-hidden", "true");
  btnGenAi?.classList.remove("open");
  btnGenAi?.setAttribute("aria-expanded", "false");
  if (wasOpen) {
    window.liveTrackVoice?.stopListening?.();
    window.liveTrackVoice?.stopSpeaking?.();
  }
}

function openGenAi() {
  genaiShell?.classList.remove("hidden");
  genaiShell?.setAttribute("aria-hidden", "false");
  btnGenAi?.classList.add("open");
  btnGenAi?.setAttribute("aria-expanded", "true");
  chatInput?.focus();
}

/** Form-fill AI on the live card. Separate thread from sidebar Ask LiveTrack. */
function openCardAi(card) {
  if (!card?.id) return;

  // Keep the selected queue card open; otherwise the AI shell is opened on top of
  // the queue list and the user is immediately sent back there by the Live nav toggle.
  if (activeCardId !== card.id || screenQuest.classList.contains("hidden")) {
    openCard(card.id);
  }

  aiFocusCard = { id: card.id, title: card.title || card.id };
  if (chatInput) {
    chatInput.placeholder = `Help fill ${aiFocusCard.title}…`;
  }
  openGenAi();
}

function closeGenAi() {
  hideGenAiShell();
}

function toggleGenAi() {
  if (genaiShell?.classList.contains("hidden")) openGenAi();
  else closeGenAi();
}

function openJira() {
  showNav("jira");
}

function closeJira() {
  if (activeNav === "jira") showNav("live");
}

function toggleJira() {
  showNav(activeNav === "jira" ? "live" : "jira");
}

function urgencyClass(issue) {
  if (issue?.stale || (issue?.urgencyScore ?? 0) >= 6) return "urgency-high";
  if ((issue?.urgencyScore ?? 0) >= 2.5 || (issue?.daysSinceUpdate ?? 0) >= 1) return "urgency-med";
  return "";
}

/** Pastel status chip class for Jira list cards. */
function jiraStatusClass(issue) {
  if (issue?.done) return "status-done";
  const s = String(issue?.status || "").trim().toLowerCase();
  if (!s) return "status-todo";
  if (/\b(blocked|impeded|waiting)\b/.test(s)) return "status-blocked";
  if (/\b(review|in review|code review|peer review|qa)\b/.test(s) || /review/.test(s)) {
    return "status-review";
  }
  if (
    /^(done|closed|resolved|complete|completed|cancelled|canceled)$/.test(s) ||
    /\b(done|closed|resolved|complete)\b/.test(s)
  ) {
    return "status-done";
  }
  if (/\b(in progress|progress|doing|in development|working)\b/.test(s) || /progress/.test(s)) {
    return "status-progress";
  }
  if (/^(to\s*do|todo|open|backlog|new|ready)$/.test(s) || /\b(to\s*do|backlog)\b/.test(s)) {
    return "status-todo";
  }
  return "status-todo";
}

function updateJiraBadge(snapshot) {
  const n = Number(snapshot?.staleCount) || 0;
  if (!jiraBadge) return;
  if (n > 0) {
    jiraBadge.textContent = n > 99 ? "99+" : String(n);
    jiraBadge.classList.remove("hidden");
    navJira?.setAttribute("title", `Jira — ${n} stale`);
  } else {
    jiraBadge.classList.add("hidden");
    navJira?.setAttribute("title", "Jira");
  }
}

const AN_FEATURE_COLORS = {
  queue_ai: "#d41c2c",
  jira_comment: "#f4b400",
  form_assistant: "#1a9e63",
  general_chat: "#2563eb",
  explain_page: "#7c3aed",
  stuck_coach: "#c2410c",
  failed_repair: "#be185d",
  jira_ticket: "#0f766e",
  mom_refine: "#a16207",
  mom_teams_frame: "#0891b2",
  jira_mail_shot: "#db2777",
  stt: "#64748b",
  stt_diarize: "#475569",
  tts: "#ea580c",
  jira_ai_comments: "#4f46e5",
  total: "#111827",
};

const AN_PALETTE = [
  "#d41c2c",
  "#2563eb",
  "#f4b400",
  "#1a9e63",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#c2410c",
  "#4f46e5",
  "#0f766e",
  "#ea580c",
  "#64748b",
  "#be185d",
  "#65a30d",
];

function anFmt(n) {
  return Number(n || 0).toLocaleString();
}

function anFeatureColor(row, index) {
  const key = String(row?.feature || row?.name || "").trim();
  if (AN_FEATURE_COLORS[key]) return AN_FEATURE_COLORS[key];
  return AN_PALETTE[index % AN_PALETTE.length];
}

function anPieSlicePath(cx, cy, r, startDeg, endDeg) {
  const toXY = (deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const [x1, y1] = toXY(startDeg);
  const [x2, y2] = toXY(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

function anPie(slices, valueKey, colorFn) {
  const rows = (slices || []).filter(
    (s) => Number(s[valueKey] || s.count || 0) > 0,
  );
  const total = rows.reduce(
    (n, s) => n + Number(s[valueKey] || s.count || 0),
    0,
  );
  if (!total) return `<p class="an-empty">No data yet.</p>`;
  const cx = 44;
  const cy = 44;
  const r = 40;
  let deg = 0;
  const paths = rows
    .map((s, i) => {
      const v = Number(s[valueKey] || s.count || 0);
      const sweep = (v / total) * 360;
      const color = (colorFn || anFeatureColor)(s, i);
      let d;
      if (rows.length === 1 || sweep >= 359.9) {
        d = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
      } else {
        d = anPieSlicePath(cx, cy, r, deg, deg + sweep);
      }
      deg += sweep;
      return `<path d="${d}" fill="${color}" />`;
    })
    .join("");
  const legend = rows
    .map((s, i) => {
      const v = Number(s[valueKey] || s.count || 0);
      const label = s.label || s.name || s.feature || "—";
      const color = (colorFn || anFeatureColor)(s, i);
      return `<li><span class="an-swatch" style="background:${color}"></span><span>${escapeHtml(label)}</span> ${anFmt(v)}</li>`;
    })
    .join("");
  return `<div class="an-donut"><svg viewBox="0 0 88 88" aria-hidden="true">${paths}</svg><ul class="an-legend">${legend}</ul></div>`;
}

function anDonut(slices, valueKey) {
  const colors = AN_PALETTE;
  const rows = (slices || []).filter(
    (s) => Number(s[valueKey] || s.count || 0) > 0,
  );
  const total = rows.reduce(
    (n, s) => n + Number(s[valueKey] || s.count || 0),
    0,
  );
  if (!total) return `<p class="an-empty">No data yet.</p>`;
  const r = 28;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = rows
    .map((s, i) => {
      const v = Number(s[valueKey] || s.count || 0);
      const len = (v / total) * c;
      const el = `<circle cx="44" cy="44" r="${r}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="12" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 44 44)" />`;
      offset += len;
      return el;
    })
    .join("");
  const legend = rows
    .slice(0, 6)
    .map((s, i) => {
      const v = Number(s[valueKey] || s.count || 0);
      const label = s.label || s.name || s.feature || "—";
      return `<li><span class="an-swatch" style="background:${colors[i % colors.length]}"></span><span>${escapeHtml(label)}</span> ${anFmt(v)}</li>`;
    })
    .join("");
  return `<div class="an-donut"><svg viewBox="0 0 88 88" aria-hidden="true"><circle cx="44" cy="44" r="${r}" fill="none" stroke="#ead9a8" stroke-width="12"/>${arcs}</svg><ul class="an-legend">${legend}</ul></div>`;
}

function anNiceMax(n) {
  const v = Number(n) || 0;
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const m = v / exp;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return nice * exp;
}

function anColumns(series, valueKey) {
  const list = series || [];
  if (!list.length) return `<p class="an-empty">No data yet.</p>`;
  const rawMax = Math.max(
    0,
    ...list.map((r) => Number(r[valueKey] || r.count || 0)),
  );
  const axisMax = anNiceMax(rawMax);
  const mid = axisMax / 2;
  const midLabel = Number.isInteger(mid) ? anFmt(mid) : anFmt(Math.round(mid));
  const bars = list
    .map((r) => {
      const v = Number(r[valueKey] || r.count || 0);
      const h =
        axisMax > 0 ? Math.max(v ? 6 : 2, Math.round((v / axisMax) * 140)) : 2;
      const label = r.bucket || r.label || r.name || "";
      return `<div class="an-col" title="${escapeHtml(label)}: ${anFmt(v)}">
        <span class="an-col-val">${v ? anFmt(v) : ""}</span>
        <span class="an-col-stem" style="height:${h}px"></span>
        <span class="an-col-lbl">${escapeHtml(label)}</span>
      </div>`;
    })
    .join("");
  return `<div class="an-cols-wrap">
    <div class="an-cols-y" aria-hidden="true"><span>${anFmt(axisMax)}</span><span>${escapeHtml(midLabel)}</span><span>0</span></div>
    <div class="an-cols">${bars}</div>
  </div>`;
}

function anRowColor(row, index) {
  const key = String(row?.feature || row?.key || "").trim();
  if (AN_FEATURE_COLORS[key]) return AN_FEATURE_COLORS[key];
  return AN_PALETTE[index % AN_PALETTE.length];
}

function anBars(rows, valueKey) {
  const list = (rows || []).slice(0, 16);
  if (!list.length) return `<p class="an-empty">No data yet.</p>`;
  const rawMax = Math.max(0, ...list.map((r) => Number(r[valueKey] || 0)));
  const axisMax = anNiceMax(rawMax);
  const mid = axisMax / 2;
  const midLabel = Number.isInteger(mid) ? anFmt(mid) : anFmt(Math.round(mid));
  const rowsHtml = list
    .map((r, i) => {
      const v = Number(r[valueKey] || 0);
      const pct = axisMax > 0 ? Math.max(0, (v / axisMax) * 100) : 0;
      const label = r.label || r.name || r.title || "—";
      const color = anRowColor(r, i);
      return `<div class="an-hist-row">
        <span class="an-hist-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <div class="an-hist-plot">
          <span class="an-hist-bar" style="width:${pct}%;background:${color}"></span>
          <span class="an-hist-val" style="left:${pct}%;color:${color}">${anFmt(v)}</span>
        </div>
      </div>`;
    })
    .join("");
  return `<div class="an-hist">
    ${rowsHtml}
    <div class="an-hist-axis" aria-hidden="true">
      <span class="an-hist-axis-gutter"></span>
      <span class="an-hist-axis-line"><span>0</span><span>${escapeHtml(midLabel)}</span><span>${anFmt(axisMax)}</span></span>
    </div>
  </div>`;
}

function anTokenRows(data) {
  const rows = [];
  for (const point of data.ai?.series || []) {
    const tokens = Number(point.total_tokens) || 0;
    if (!tokens) continue;
    rows.push({
      name: String(point.label || point.bucket || ""),
      feature: "total",
      value: tokens,
      sortKey: String(point.bucket || point.label || ""),
    });
  }
  return rows.sort((a, b) =>
    String(a.sortKey).localeCompare(String(b.sortKey)),
  );
}

function anCallRows(data) {
  const rows = [];
  for (const point of data.ai?.series || []) {
    const calls = Number(point.calls) || 0;
    if (!calls) continue;
    rows.push({
      name: String(point.label || point.bucket || ""),
      feature: "queue_ai",
      value: calls,
      sortKey: String(point.bucket || point.label || ""),
    });
  }
  return rows.sort((a, b) =>
    String(a.sortKey).localeCompare(String(b.sortKey)),
  );
}

function anFeatureTokenRows(data) {
  const rows = [];
  for (const f of data.ai?.features || []) {
    const tokens = Number(f.total_tokens) || 0;
    if (!tokens) continue;
    rows.push({
      name: f.label || f.feature,
      feature: f.feature,
      value: tokens,
    });
  }
  return rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function anFeatureCallRows(data) {
  const rows = [];
  for (const f of data.ai?.features || []) {
    const calls = Number(f.calls) || 0;
    if (!calls) continue;
    rows.push({
      name: f.label || f.feature,
      feature: f.feature,
      value: calls,
    });
  }
  return rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function anBarKey(rows) {
  const list = rows || [];
  if (list.some((r) => Number(r.total_tokens) > 0)) return "total_tokens";
  if (list.some((r) => Number(r.calls) > 0)) return "calls";
  return "count";
}

function renderAnalytics(data) {
  const kpis = document.getElementById("anKpis");
  const body = document.getElementById("anBody");
  const meta = document.getElementById("anMeta");
  if (!kpis || !body) return;
  if (!data?.ok) {
    if (meta) meta.textContent = data?.error || "Could not load analytics";
    kpis.innerHTML = "";
    body.innerHTML = `<p class="an-empty">${escapeHtml(data?.error || "Could not load analytics")}</p>`;
    return;
  }
  const exec = data.executions || {};
  const cards = data.cards || {};
  const ai = data.ai || {};
  const range =
    data.from && data.to
      ? data.from === data.to
        ? data.from
        : `${data.from} → ${data.to}`
      : anGrain;
  if (meta) {
    meta.textContent = `${anGrain} · ${range} · ${anFmt(exec.total)} executions · ${anFmt(ai.total_tokens)} tokens`;
  }
  kpis.innerHTML = `
    <div class="an-kpi"><div class="lbl">Executions</div><div class="val">${anFmt(exec.total)}</div><div class="substat">${escapeHtml(range)}</div></div>
    <div class="an-kpi"><div class="lbl">AI calls</div><div class="val">${anFmt(ai.calls)}</div><div class="substat">${escapeHtml(range)}</div></div>
    <div class="an-kpi"><div class="lbl">Tokens</div><div class="val">${anFmt(ai.total_tokens)}</div><div class="substat">${escapeHtml(range)}</div></div>
    <div class="an-kpi"><div class="lbl">Incomplete</div><div class="val">${anFmt(exec.incomplete ?? cards.incomplete)}</div><div class="substat">${escapeHtml(range)}</div></div>
  `;
  const tokenSeries = anTokenRows(data);
  const callSeries = anCallRows(data);
  const tokenFeatures = anFeatureTokenRows(data);
  const callFeatures = anFeatureCallRows(data);
  const seriesGrain =
    data.seriesGrain || (anGrain === "year" ? "month" : "day");
  const grainLbl = seriesGrain === "month" ? "month" : "day";
  const completeN = exec.complete ?? cards.complete ?? exec.total;
  const incompleteN = exec.incomplete ?? cards.incomplete;
  body.innerHTML = `
    <div class="an-card an-card-wide"><h3>Executions over time</h3><p class="muted tiny-copy">Completed runs · one column per ${escapeHtml(grainLbl)}</p>${anColumns(exec.series, "count")}</div>
    <div class="an-card"><h3>Complete vs incomplete</h3><p class="muted tiny-copy">Started runs in range</p>${anDonut(
      [
        { name: "Complete", count: completeN },
        { name: "Incomplete", count: incompleteN },
      ],
      "count",
    )}</div>
    <div class="an-card an-card-wide"><h3>Total tokens</h3><p class="muted tiny-copy">Tokens per ${escapeHtml(grainLbl)}</p>${
      tokenSeries.length
        ? anBars(tokenSeries, "value")
        : `<p class="an-empty">No token usage yet.</p>`
    }</div>
    <div class="an-card an-card-wide"><h3>Token usage</h3><p class="muted tiny-copy">Tokens by feature</p>${
      tokenFeatures.length
        ? anBars(tokenFeatures, "value")
        : `<p class="an-empty">No token usage yet.</p>`
    }</div>
    <div class="an-card an-card-wide"><h3>API calls</h3><p class="muted tiny-copy">Calls per ${escapeHtml(grainLbl)} and by feature</p>${
      callSeries.length
        ? anBars(callSeries, "value")
        : `<p class="an-empty">No API calls yet.</p>`
    }${callFeatures.length ? anBars(callFeatures, "value") : ""}</div>
  `;
}

async function refreshAnalytics() {
  const req = (anReq += 1);
  anLoading = true;
  const meta = document.getElementById("anMeta");
  if (meta) meta.textContent = "Loading…";
  try {
    const data = await window.coact.getAnalytics?.({ grain: anGrain });
    if (req !== anReq) return;
    renderAnalytics(
      data || { ok: false, error: "Analytics IPC missing. Restart LiveTrack." },
    );
  } catch (err) {
    if (req !== anReq) return;
    renderAnalytics({ ok: false, error: err?.message || String(err) });
  } finally {
    if (req === anReq) anLoading = false;
  }
}

async function refreshDashboard(opts = {}) {
  if (dashLoading) return;
  dashLoading = true;
  if (dashMeta && !opts.silent) dashMeta.textContent = "Loading…";
  try {
    const data = await window.coact.getExecutionDashboard?.();
    renderDashboard(data);
  } catch (err) {
    renderDashboard({
      ok: false,
      error: err?.message || String(err),
      rows: [],
      total: 0,
    });
  } finally {
    dashLoading = false;
  }
}

function isDashJunkLabel(text) {
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return true;
  if (/^(input|select|textarea|button|div|span|label|text|field)$/i.test(t))
    return true;
  if (/^[a-f0-9]{16,}$/i.test(t)) return true;
  if (/^(primaryquestionnaire--|wd-|ember\d|sop not found)/i.test(t))
    return true;
  if (/^#?primaryquestionnaire--/i.test(t)) return true;
  return false;
}

function isDashOpaqueValue(value) {
  const s = String(value || "").trim();
  if (!s) return false;
  if (/^[a-f0-9]{20,}$/i.test(s.replace(/-/g, ""))) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
    return true;
  return false;
}

function isDashOptionLabel(text) {
  return /^(yes|no|y|n|true|false|on|off)$/i.test(String(text || "").trim());
}

/** Clean key / value / type rows for unmatched Record drafts (no selectors, no UUID junk). */
function captureDraftSteps(row) {
  if (Array.isArray(row.pairs) && row.pairs.length) {
    return row.pairs.map((p) => ({
      action: p.type === "field entry" ? "fill" : p.type || "fill",
      label: String(p.key || "").trim(),
      value: String(p.value || "").trim(),
      type: p.type || "field entry",
    }));
  }
  const raw = [];
  const fromSteps = Array.isArray(row.steps) ? row.steps : [];
  if (fromSteps.length) {
    for (const s of fromSteps) {
      raw.push({
        action: String(s.action || "fill").toLowerCase(),
        label: String(s.label || s.fieldName || "").trim(),
        fieldName: String(s.fieldName || "").trim(),
        value: String(s.value || s.selectedText || "").trim(),
      });
    }
  } else {
    for (const c of Array.isArray(row.clicks) ? row.clicks : []) {
      raw.push({
        action: "click",
        label: String(c.label || "").trim(),
        fieldName: "",
        value: "",
      });
    }
    for (const m of Array.isArray(row.mandatory) ? row.mandatory : []) {
      raw.push({
        action: "fill",
        label: String(m.label || m.key || "").trim(),
        fieldName: String(m.key || "").trim(),
        value: String(m.value || "").trim(),
      });
    }
  }

  const out = [];
  let choiceN = 0;
  for (const step of raw) {
    const action = step.action;
    const label = step.label
      .replace(/^(fill|select|check|click)\s+/i, "")
      .trim();
    const fieldName = step.fieldName
      .replace(/^(fill|select|check|click)\s+/i, "")
      .trim();
    const value = step.value;

    if (action === "fill" || action === "input" || action === "change") {
      if (isDashOpaqueValue(value)) continue;
      if (isDashJunkLabel(label) && isDashJunkLabel(fieldName)) continue;
    }
    if (
      isDashJunkLabel(label) &&
      isDashJunkLabel(fieldName) &&
      !isDashOptionLabel(label)
    )
      continue;
    if (/sop not found/i.test(label) || /sop not found/i.test(value)) continue;

    const option = isDashOptionLabel(value)
      ? value
      : isDashOptionLabel(label)
        ? label
        : "";
    const question =
      fieldName && !isDashOptionLabel(fieldName) && !isDashJunkLabel(fieldName)
        ? fieldName
        : label && !isDashOptionLabel(label) && !isDashJunkLabel(label)
          ? label
          : "";

    if (
      option &&
      (action === "click" ||
        action === "check" ||
        action === "select" ||
        question)
    ) {
      choiceN += 1;
      out.push({
        action: action === "click" ? "click" : "check",
        label: question || `Choice ${choiceN}`,
        value:
          option.toLowerCase() === "y"
            ? "yes"
            : option.toLowerCase() === "n"
              ? "no"
              : option,
        type: action === "click" ? "click" : "choice",
      });
      continue;
    }

    if (action === "click") {
      if (!label || isDashJunkLabel(label)) continue;
      out.push({ action: "click", label, value: "", type: "click" });
      continue;
    }

    const key = question || label;
    if (!key || isDashJunkLabel(key)) continue;
    if (isDashOpaqueValue(value)) continue;
    out.push({
      action: action === "check" || action === "select" ? action : "fill",
      label: key,
      value,
      type:
        action === "check"
          ? "choice"
          : action === "select"
            ? "select"
            : "field entry",
    });
  }
  return out;
}

function appendCaptureKvList(parent, rows) {
  const list = document.createElement("ul");
  list.className = "dash-mand-list dash-kv-types";
  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "No field values captured yet";
    list.appendChild(li);
    parent.appendChild(list);
    return list;
  }
  const head = document.createElement("li");
  head.className = "dash-kv-head";
  const h1 = document.createElement("span");
  h1.textContent = "Field";
  const h2 = document.createElement("span");
  h2.textContent = "Value";
  const h3 = document.createElement("span");
  h3.textContent = "Type";
  head.append(h1, h2, h3);
  list.appendChild(head);
  for (const step of rows) {
    const li = document.createElement("li");
    li.className = "ok";
    const left = document.createElement("span");
    left.textContent = humanizeFieldLabel(step.label || step.key);
    const mid = document.createElement("span");
    mid.textContent = step.value || "—";
    const right = document.createElement("span");
    const type = step.type || step.action || "field entry";
    right.textContent = type === "fill" ? "field entry" : type;
    li.append(left, mid, right);
    list.appendChild(li);
  }
  parent.appendChild(list);
  return list;
}

function isPendingCaptureDraft(row) {
  if (row.fill_mode !== "capture") return false;
  if (row.discoveryStatus === "approved" || row.discoveryStatus === "dismissed")
    return false;
  return Boolean(row.unmatched) || row.queue_card_id === "website-capture";
}

function studioHashForRow(row) {
  const sopId = String(row.draftSopId || "").trim();
  return sopId ? `#/studio?sop=${encodeURIComponent(sopId)}` : "#/studio";
}

async function openQueueStudio(hash = "#/studio") {
  const res = await window.coact.openDashboard?.({ hash });
  if (!res?.ok) {
    window.alert(
      res?.error || "Could not open Queue studio. Run npm run dashboard.",
    );
  }
}

function appendCaptureDraftEditor(body, row) {
  const note = document.createElement("p");
  note.className = "dash-discover-note";
  note.textContent =
    "No queue card matched this recording. It is waiting on the Approvals tab. Edit in Queue studio, then approve.";
  body.appendChild(note);
  appendCaptureKvList(body, captureDraftSteps(row));
  const actions = document.createElement("div");
  actions.className = "dash-discover-actions";
  const studioBtn = document.createElement("button");
  studioBtn.type = "button";
  studioBtn.className = "btn tiny";
  studioBtn.textContent = "Edit in Queue studio";
  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "btn ghost tiny";
  dismissBtn.textContent = "Dismiss";
  const approvalsBtn = document.createElement("button");
  approvalsBtn.type = "button";
  approvalsBtn.className = "btn ghost tiny";
  approvalsBtn.textContent = "Open Approvals";
  actions.append(studioBtn, approvalsBtn, dismissBtn);
  studioBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openQueueStudio(studioHashForRow(row));
  });
  approvalsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openQueueStudio("#/approvals");
  });
  dismissBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    dismissBtn.disabled = true;
    await window.coact.dismissCaptureDraft?.({
      transactionId: row.transactionId,
      sopId: row.draftSopId,
    });
    refreshDashboard({ silent: true });
  });
  body.appendChild(actions);
}

function dashCaptureExpandId(row) {
  return String(
    row.transactionId ||
      row.formReference ||
      row.jiraKey ||
      `${row.queue_card_id || ""}|${row.completed_at || row.run_date || ""}`,
  );
}

function renderDashboard(data) {
  if (!dashList) return;
  if (!data?.ok) {
    dashList.classList.add("empty");
    dashList.textContent = data?.error || "Could not load executions";
    if (dashMeta) dashMeta.textContent = "Error";
    return;
  }
  const rows = data.rows || [];
  if (dashMeta) {
    const from = data.dateFrom || "…";
    const to = data.dateTo || "…";
    dashMeta.textContent = `${rows.length} run${rows.length === 1 ? "" : "s"} · ${from} → ${to}`;
  }
  if (!rows.length) {
    dashList.classList.add("empty");
    dashList.textContent = "No executions in this date range";
    return;
  }
  dashList.classList.remove("empty");
  dashList.replaceChildren();
  for (const row of rows) {
    const isCapture = row.fill_mode === "capture";
    const expandId = isCapture ? dashCaptureExpandId(row) : "";
    const isExpanded = Boolean(
      expandId && dashExpandedCaptureIds.has(expandId),
    );
    const card = document.createElement("div");
    // Capture rows use the v1 Dash REF ticket shell (top REF + date, title, meta).
    // Collapse only hides details — never invent a separate fold-header layout.
    card.className =
      "dash-card" +
      (isCapture ? " capture-row" : "") +
      (isCapture && !isExpanded ? " collapsed" : "");
    if (expandId) card.dataset.captureExpandId = expandId;

    const ref = row.formReference || row.jiraKey || "";
    const showRef = Boolean(ref && ref !== "—" && !/^CAP-/i.test(ref));
    const whenText = row.completed_at
      ? new Date(row.completed_at).toLocaleString()
      : row.run_date || "";
    const titleText = row.queue_card || row.queue_card_id || "—";
    const pairs = isCapture ? captureDraftSteps(row) : [];
    const pendingDraft = isPendingCaptureDraft(row);

    const top = document.createElement("div");
    top.className = "dash-card-top";
    const ticketBtn = document.createElement("button");
    ticketBtn.type = "button";
    ticketBtn.className = [
      "dash-ticket",
      /^REF-/i.test(ref) ? "ref-key" : "",
      row.formReferenceGenerated || row.jiraKeyGenerated ? "generated" : "",
    ]
      .filter(Boolean)
      .join(" ");
    ticketBtn.textContent = showRef ? ref : "";
    ticketBtn.hidden = !showRef;
    ticketBtn.disabled = !showRef;
    ticketBtn.title = showRef ? `Click to copy ${ref}` : "";
    if (showRef) {
      ticketBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyRefNumber(ref, ticketBtn);
      });
    }
    const when = document.createElement("span");
    when.className = "muted";
    when.style.fontSize = "0.72rem";
    when.textContent = whenText;
    if (isCapture) {
      const right = document.createElement("span");
      right.className = "dash-card-top-right";
      const chevron = document.createElement("span");
      chevron.className = "dash-card-chevron";
      chevron.setAttribute("aria-hidden", "true");
      right.append(when, chevron);
      top.append(right);
    } else {
      top.append(when);
    }
    if (showRef) top.prepend(ticketBtn);

    const title = document.createElement("div");
    title.className = "dash-title";
    title.textContent = titleText;
    if (isCapture && row.pageUrl && !/\/browse\//i.test(row.pageUrl)) {
      const pageLine = document.createElement("div");
      pageLine.className = "capture-live-page";
      pageLine.textContent = row.pageUrl;
      title.appendChild(pageLine);
    }

    const meta = document.createElement("div");
    meta.className = "dash-meta";
    for (const bit of [
      row.jiraStoryKey ? `Jira ${row.jiraStoryKey}` : null,
      isCapture ? null : row.lob,
      isCapture ? "capture" : row.fill_mode,
      row.user_id,
      isCapture
        ? `${pairs.length || row.mandatoryFilled || 0} field${
            (pairs.length || row.mandatoryFilled || 0) === 1 ? "" : "s"
          }`
        : `${row.mandatoryFilled || 0}/${row.mandatoryTotal || 0} mandatory`,
      isCapture && pendingDraft ? "needs review" : null,
      !isCapture && row.mistake_count
        ? `${row.mistake_count} mistake(s)`
        : null,
    ].filter(Boolean)) {
      const span = document.createElement("span");
      span.textContent = bit;
      if (String(bit).startsWith("Jira ") && row.jiraUrl) {
        span.className = "dash-story";
        span.style.cursor = "pointer";
        span.addEventListener("click", (event) => {
          event.stopPropagation();
          window.coact.jiraOpenIssue?.(row.jiraUrl);
        });
      }
      meta.appendChild(span);
    }

    const details = document.createElement("div");
    details.className = "dash-card-details";
    if (isCapture) {
      if (pendingDraft) {
        appendCaptureDraftEditor(details, row);
      } else {
        appendCaptureKvList(details, pairs);
      }
    } else {
      const ul = document.createElement("ul");
      ul.className = "dash-mand-list";
      const mand = row.mandatory || [];
      if (!mand.length) {
        const li = document.createElement("li");
        li.textContent = "No mandatory fields indexed";
        ul.appendChild(li);
      } else {
        for (const m of mand) {
          const li = document.createElement("li");
          li.className = m.filled ? "ok" : "missing";
          const left = document.createElement("span");
          left.textContent = humanizeFieldLabel(m.label);
          const right = document.createElement("span");
          right.textContent = m.filled ? m.value : "missing";
          li.append(left, right);
          ul.appendChild(li);
        }
      }
      details.appendChild(ul);
    }

    card.append(top, title, meta, details);

    if (isCapture) {
      const toggleCollapse = (event) => {
        if (
          event.target.closest(
            ".dash-ticket, .dash-story, button, a, input, select, textarea",
          )
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const opening = card.classList.contains("collapsed");
        if (opening) {
          dashExpandedCaptureIds.clear();
          dashExpandedCaptureIds.add(expandId);
          for (const other of dashList.querySelectorAll(
            ".dash-card.capture-row",
          )) {
            if (other !== card) other.classList.add("collapsed");
          }
          card.classList.remove("collapsed");
        } else {
          dashExpandedCaptureIds.delete(expandId);
          card.classList.add("collapsed");
        }
      };
      top.style.cursor = "pointer";
      title.style.cursor = "pointer";
      meta.style.cursor = "pointer";
      top.addEventListener("click", toggleCollapse);
      title.addEventListener("click", toggleCollapse);
      meta.addEventListener("click", toggleCollapse);
    }

    dashList.appendChild(card);
  }
}

function renderJiraRecent(actions) {
  if (!jiraRecentList) return;
  jiraRecentList.replaceChildren();
  const rows = Array.isArray(actions) ? actions : [];
  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "No Jira actions yet";
    jiraRecentList.appendChild(li);
    return;
  }
  for (const row of rows) {
    const li = document.createElement("li");
    li.className = row.ok ? "ok" : "bad";
    const when = row.timestamp ? new Date(row.timestamp).toLocaleTimeString() : "";
    const preview = row.bodyPreview ? ` — ${row.bodyPreview}` : "";
    const flag = row.conflict ? " (conflict)" : "";
    li.textContent = `${when} ${row.issueKey || "?"} ${row.action || "comment"}${flag}${
      row.ok ? "" : `: ${row.error || "failed"}`
    }${preview}`.trim();
    jiraRecentList.appendChild(li);
  }
}

function extractTicketKeyFromText(text) {
  const m = String(text || "").match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return m ? m[1] : "";
}

async function submitJiraAiComment(issue, draft) {
  const text = String(draft || "").trim();
  if (!text) return;
  const ticketKey =
    extractTicketKeyFromText(text) || String(issue?.key || "").trim();
  let cardId = issue?.linkedCardId || activeCardId || autoPinnedCardId || "";
  let mandatorySummary = "";
  try {
    const sum = await window.coact.jiraMandatorySummary?.({
      cardId: cardId || undefined,
      issueKey: ticketKey || issue?.key,
    });
    if (sum?.text) mandatorySummary = sum.text;
    if (!cardId && sum?.cardId) cardId = sum.cardId;
  } catch (err) {
    console.warn("[jira] mandatory summary", err);
  }
  const card = cardId ? cards.find((c) => c.id === cardId) : null;
  const queueCard = card
    ? `${card.title || card.id} (${card.id})`
    : cardId || "";
  const res = await window.coact.jiraAiComment?.({
    issueKey: issue.key,
    draft: text,
    summary: issue.summary || "",
    status: issue.status || "",
    sopStage: issue.sopStage || "",
    ticketKey,
    queueCard,
    mandatorySummary,
  });
  if (res?.recentActions) renderJiraRecent(res.recentActions);
  if (!res?.ok) {
    window.alert(res?.error || "Failed to post AI comment");
  } else if (res.polishNote && !res.usedAi) {
    console.info("[jira ai]", res.polishNote);
  }
  return res;
}

function patchJiraMail(issueKey, patch) {
  const key = String(issueKey || "").trim();
  if (!key) return null;
  const next = { ...(jiraMailByKey.get(key) || {}), ...patch };
  jiraMailByKey.set(key, next);
  refreshJiraMailUi(key);
  return next;
}

function jiraMailRowEls(card) {
  if (!card) return null;
  return {
    mailRow: card.querySelector(".jira-mail-row"),
    preview: card.querySelector(".jira-mail-preview"),
    storyTa: card.querySelector(".jira-mail-story"),
    commentTa: card.querySelector(".jira-mail-comment"),
    status: card.querySelector(".jira-mail-status"),
    btnApply: card.querySelector(".jira-mail-apply"),
  };
}

function refreshJiraMailUi(issueKey) {
  const key = String(issueKey || "").trim();
  if (!key || !jiraList) return;
  const card = [...jiraList.querySelectorAll("[data-jira-key]")].find(
    (el) => el.dataset.jiraKey === key,
  );
  const els = jiraMailRowEls(card);
  if (!els?.mailRow) return;
  paintJiraMailRow(key, els);
}

function paintJiraMailRow(issueKey, els) {
  const st = jiraMailByKey.get(issueKey);
  const { mailRow, preview, storyTa, commentTa, status, btnApply } = els;
  if (!st) {
    mailRow.classList.add("hidden");
    return;
  }
  mailRow.classList.remove("hidden");
  if (preview) {
    if (st.dataUrl) {
      preview.src = st.dataUrl;
      preview.classList.remove("hidden");
    } else {
      preview.removeAttribute("src");
      preview.classList.add("hidden");
    }
  }
  if (
    storyTa &&
    storyTa.value !== (st.story || "") &&
    document.activeElement !== storyTa
  ) {
    storyTa.value = st.story || "";
  }
  if (
    commentTa &&
    commentTa.value !== (st.comment || "") &&
    document.activeElement !== commentTa
  ) {
    commentTa.value = st.comment || "";
  }
  if (status) status.textContent = st.status || "";
  if (btnApply) btnApply.disabled = Boolean(st.busy);
}

async function captureJiraMailScreenshot(issue) {
  const key = issue?.key;
  if (!key) return;
  patchJiraMail(key, {
    busy: true,
    status: "Drag a box around the email, then release.",
  });
  try {
    const res = await runQueueCardSnip();
    if (res?.cancelled) {
      patchJiraMail(key, { busy: false, status: "Capture cancelled." });
      return;
    }
    if (!res?.ok || !res.path) {
      patchJiraMail(key, {
        busy: false,
        status: res?.error || "Snip failed",
      });
      return;
    }
    patchJiraMail(key, {
      path: res.path,
      dataUrl: res.dataUrl || "",
      busy: true,
      status: "Sending screenshot to AI…",
    });
    const draft = await window.coact.jiraDraftMailScreenshot?.({
      issueKey: key,
      screenshotPath: res.path,
      summary: issue.summary || "",
    });
    if (!draft?.ok) {
      patchJiraMail(key, {
        busy: false,
        status: draft?.error || "Could not read the mail screenshot.",
      });
      return;
    }
    patchJiraMail(key, {
      story: draft.story || "",
      comment: draft.comment || "",
      busy: false,
      status: draft.usedAi
        ? "AI drafted the mail. Edit if needed, then Add to story."
        : draft.note || "Edit the mail details, then Add to story.",
    });
  } catch (err) {
    patchJiraMail(key, {
      busy: false,
      status: err?.message || "Snip failed",
    });
  }
}

async function applyJiraMailScreenshot(issue) {
  const key = issue?.key;
  const st = jiraMailByKey.get(key);
  if (!key || !st) return;
  const story = String(st.story || "").trim();
  const comment = String(st.comment || "").trim();
  if (!story && !comment) {
    patchJiraMail(key, {
      status: "Capture a screenshot first so AI can draft the mail.",
    });
    return;
  }
  patchJiraMail(key, {
    busy: true,
    status: "Adding mail to the story and posting a comment…",
  });
  try {
    const res = await window.coact.jiraApplyMailScreenshot?.({
      issueKey: key,
      screenshotPath: st.path || "",
      story,
      comment,
    });
    if (res?.recentActions) renderJiraRecent(res.recentActions);
    if (!res?.ok) {
      patchJiraMail(key, {
        busy: false,
        status: res?.error || "Could not add the mail to the story.",
      });
      return;
    }
    const bits = [
      res.descriptionOk ? "story updated" : null,
      res.commentOk ? "comment posted" : null,
      res.attached ? "screenshot attached" : null,
    ].filter(Boolean);
    jiraMailByKey.delete(key);
    refreshJiraMailUi(key);
    window.alert(
      bits.length
        ? `${key}: ${bits.join(", ")}.`
        : `${key}: mail sent to Jira.`,
    );
  } catch (err) {
    patchJiraMail(key, {
      busy: false,
      status: err?.message || "Could not add the mail to the story.",
    });
  }
}

function renderJiraList(snapshot) {
  const fp = jiraUiFingerprint(snapshot);
  if (fp && fp === lastJiraUiFp) {
    // Same issues — only refresh the "Updated …" meta clock if present
    if (jiraMeta && snapshot?.ok && snapshot?.fetchedAt) {
      jiraMeta.textContent = `Updated ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`;
    }
    updateJiraBadge(snapshot);
    fillDeskIssueSelect();
    return;
  }
  lastJiraUiFp = fp;
  jiraSnapshot = snapshot || null;
  updateJiraBadge(snapshot);
  renderJiraRecent(snapshot?.recentActions);
  if (!jiraList) return;

  const issues = snapshot?.issues || [];
  if (!snapshot?.configured && snapshot?.error) {
    jiraList.classList.add("empty");
    jiraList.textContent = snapshot.error;
    if (jiraMeta) jiraMeta.textContent = "Not configured — open Settings";
    fillDeskIssueSelect();
    return;
  }
  if (!snapshot?.ok) {
    jiraList.classList.add("empty");
    jiraList.textContent = snapshot?.error || "Could not load Jira stories";
    if (jiraMeta) jiraMeta.textContent = "Error";
    fillDeskIssueSelect();
    return;
  }
  if (!issues.length) {
    jiraList.classList.add("empty");
    jiraList.textContent = "No stories match your JQL";
    if (jiraMeta) {
      jiraMeta.textContent = snapshot.fetchedAt
        ? `Updated ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`
        : "Empty";
    }
    fillDeskIssueSelect();
    return;
  }

  jiraList.classList.remove("empty");
  jiraList.replaceChildren();
  for (const issue of issues) {
    const card = document.createElement("div");
    card.className = [
      "jira-issue",
      urgencyClass(issue),
      jiraStatusClass(issue),
      issue.done ? "done" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const top = document.createElement("div");
    top.className = "jira-issue-top";
    const key = document.createElement("button");
    key.type = "button";
    key.className = "jira-key";
    key.style.background = "transparent";
    key.style.border = "0";
    key.style.padding = "0";
    key.style.cursor = "pointer";
    key.textContent = issue.key;
    key.title = `Open ${issue.key}`;
    key.addEventListener("click", () => {
      if (issue.url) window.coact.jiraOpenIssue?.(issue.url);
    });
    const score = document.createElement("span");
    score.className = "jira-score";
    score.textContent = `score ${issue.urgencyScore}`;
    top.append(key, score);

    const summary = document.createElement("div");
    summary.className = "jira-summary";
    summary.textContent = issue.summary;

    const stage = document.createElement("div");
    stage.className = "jira-stage";
    stage.textContent = `SOP: ${issue.sopStage || issue.status || "—"}`;

    const meta = document.createElement("div");
    meta.className = "jira-issue-meta";
    const bits = [
      issue.status,
      issue.priority,
      `${issue.daysSinceUpdate}d idle`,
      issue.assignee,
    ];
    for (const bit of bits) {
      const span = document.createElement("span");
      span.textContent = bit;
      meta.appendChild(span);
    }
    if (issue.linkedCardId) {
      const linked = document.createElement("span");
      linked.className = "jira-linked";
      linked.textContent = `card ${issue.linkedCardId}`;
      meta.appendChild(linked);
    }

    card.dataset.jiraKey = issue.key;

    const actions = document.createElement("div");
    actions.className = "jira-issue-actions";
    const btnNote = document.createElement("button");
    btnNote.type = "button";
    btnNote.className = "btn ghost tiny";
    btnNote.textContent = "Add note";
    const btnMail = document.createElement("button");
    btnMail.type = "button";
    btnMail.className = "btn primary tiny";
    btnMail.textContent = "Mail screenshot";
    btnMail.title =
      "Snip an email, send it to AI, then add the mail into this story and a comment";
    actions.append(btnNote, btnMail);

    const noteRow = document.createElement("div");
    noteRow.className = "jira-note-row hidden";
    const ta = document.createElement("textarea");
    ta.placeholder = `e.g. ${issue.key} done — or just Post on the story`;
    const noteControls = document.createElement("div");
    noteControls.className = "controls";
    const btnSendNote = document.createElement("button");
    btnSendNote.type = "button";
    btnSendNote.className = "btn primary tiny";
    btnSendNote.textContent = "Post";
    btnSendNote.title = "AI refines your draft, then posts it as a Jira comment";
    const btnCancelNote = document.createElement("button");
    btnCancelNote.type = "button";
    btnCancelNote.className = "btn ghost tiny";
    btnCancelNote.textContent = "Cancel";
    noteControls.append(btnSendNote, btnCancelNote);
    noteRow.append(ta, noteControls);

    const mailRow = document.createElement("div");
    mailRow.className = "jira-mail-row hidden";
    const preview = document.createElement("img");
    preview.className = "desk-snip-preview jira-mail-preview hidden";
    preview.alt = "Mail screenshot";
    const storyTa = document.createElement("textarea");
    storyTa.className = "jira-mail-story";
    storyTa.rows = 5;
    storyTa.placeholder = "Mail details to add to the story description";
    const commentTa = document.createElement("textarea");
    commentTa.className = "jira-mail-comment";
    commentTa.rows = 4;
    commentTa.placeholder = "Comment to post on the story";
    const mailStatus = document.createElement("p");
    mailStatus.className = "muted tiny-copy jira-mail-status";
    const mailControls = document.createElement("div");
    mailControls.className = "controls";
    const btnApplyMail = document.createElement("button");
    btnApplyMail.type = "button";
    btnApplyMail.className = "btn primary tiny jira-mail-apply";
    btnApplyMail.textContent = "Add to story";
    btnApplyMail.title =
      "Append the mail to the description, post a comment, and attach the screenshot";
    const btnClearMail = document.createElement("button");
    btnClearMail.type = "button";
    btnClearMail.className = "btn ghost tiny";
    btnClearMail.textContent = "Clear";
    mailControls.append(btnApplyMail, btnClearMail);
    mailRow.append(preview, storyTa, commentTa, mailStatus, mailControls);

    const mailEls = {
      mailRow,
      preview,
      storyTa,
      commentTa,
      status: mailStatus,
      btnApply: btnApplyMail,
    };

    btnMail.addEventListener("click", async () => {
      mailRow.classList.remove("hidden");
      await captureJiraMailScreenshot(issue);
      paintJiraMailRow(issue.key, mailEls);
    });
    storyTa.addEventListener("input", () => {
      patchJiraMail(issue.key, { story: storyTa.value });
    });
    commentTa.addEventListener("input", () => {
      patchJiraMail(issue.key, { comment: commentTa.value });
    });
    btnApplyMail.addEventListener("click", async () => {
      patchJiraMail(issue.key, {
        story: storyTa.value,
        comment: commentTa.value,
      });
      await applyJiraMailScreenshot(issue);
      paintJiraMailRow(issue.key, mailEls);
    });
    btnClearMail.addEventListener("click", () => {
      jiraMailByKey.delete(issue.key);
      storyTa.value = "";
      commentTa.value = "";
      paintJiraMailRow(issue.key, mailEls);
    });

    btnNote.addEventListener("click", () => {
      noteRow.classList.toggle("hidden");
      if (!noteRow.classList.contains("hidden")) ta.focus();
    });
    btnCancelNote.addEventListener("click", () => {
      noteRow.classList.add("hidden");
      ta.value = "";
    });
    btnSendNote.addEventListener("click", async () => {
      const draft = ta.value.trim();
      if (!draft) {
        window.alert("Type a draft note first");
        return;
      }
      btnSendNote.disabled = true;
      const prev = btnSendNote.textContent;
      btnSendNote.textContent = "AI…";
      try {
        const res = await submitJiraAiComment(issue, draft);
        if (res?.ok) {
          ta.value = "";
          noteRow.classList.add("hidden");
        }
      } finally {
        btnSendNote.textContent = prev;
        btnSendNote.disabled = false;
      }
    });

    card.append(top, summary, stage, meta, actions, noteRow, mailRow);
    paintJiraMailRow(issue.key, mailEls);
    jiraList.appendChild(card);
  }

  fillDeskIssueSelect();

  if (jiraMeta) {
    const stale = snapshot.staleCount || 0;
    const when = snapshot.fetchedAt
      ? new Date(snapshot.fetchedAt).toLocaleTimeString()
      : "—";
    jiraMeta.textContent = `${issues.length} stories · ${stale} stale · ${when}`;
  }
}

function formatMomTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatMomSavedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `Today · ${formatMomTime(iso)}`;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function copyMomMinutes(text, btn) {
  const value = String(text || "").trim();
  if (!value) {
    if (momStatus) momStatus.textContent = "Nothing to copy yet.";
    return;
  }
  const ok = await copyTextToClipboard(value);
  if (ok) {
    flashCopied(btn, "Copy");
    if (momStatus) momStatus.textContent = "Minutes copied to clipboard.";
  } else if (momStatus) {
    momStatus.textContent = "Could not copy minutes.";
  }
}

function renderMomPastList(items) {
  if (!momPastList) return;
  momPastItems = Array.isArray(items) ? items : [];
  if (momPastCount) {
    momPastCount.textContent = momPastItems.length
      ? `(${momPastItems.length})`
      : "";
  }
  momPastList.innerHTML = "";
  if (!momPastItems.length) {
    const empty = document.createElement("p");
    empty.className = "muted tiny-copy";
    empty.textContent = momPastLoading
      ? "Loading saved minutes…"
      : "No saved minutes yet. Approve a draft to keep it here.";
    momPastList.appendChild(empty);
    return;
  }
  for (const row of momPastItems) {
    const wrap = document.createElement("div");
    const isOpen = Boolean(momPastView?.id && momPastView.id === row.id);
    wrap.className = ["mom-past-item", isOpen ? "open" : ""]
      .filter(Boolean)
      .join(" ");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = ["mom-event", isOpen ? "selected" : ""]
      .filter(Boolean)
      .join(" ");
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMomPastItem(row.id);
    });
    const top = document.createElement("div");
    top.className = "mom-event-top";
    const title = document.createElement("strong");
    title.textContent = row.subject || "Meeting minutes";
    const rowCopy = document.createElement("button");
    rowCopy.type = "button";
    rowCopy.className = "btn ghost tiny mom-past-row-copy";
    rowCopy.textContent = "Copy";
    rowCopy.title = "Copy minutes to clipboard";
    rowCopy.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const body =
        (momPastView?.id === row.id && momPastView?.refined) ||
        row.refined ||
        row.preview ||
        "";
      copyMomMinutes(body, rowCopy);
    });
    const chevron = document.createElement("span");
    chevron.className = "mom-past-chevron";
    chevron.textContent = isOpen ? "▾" : "▸";
    top.append(title, rowCopy, chevron);
    const meta = document.createElement("div");
    meta.className = "mom-event-meta";
    meta.textContent = formatMomSavedAt(row.savedAt) || "Saved";
    btn.appendChild(top);
    btn.appendChild(meta);
    if (!isOpen && row.preview) {
      const preview = document.createElement("div");
      preview.className = "muted tiny-copy mom-past-preview";
      preview.textContent = row.preview || "";
      btn.appendChild(preview);
    }
    wrap.appendChild(btn);

    if (isOpen && momPastView?.refined) {
      const body = document.createElement("div");
      body.className = "mom-past-body";
      const text = document.createElement("textarea");
      text.className = "mom-transcript mom-minutes-editor mom-past-minutes";
      text.readOnly = true;
      text.rows = 14;
      text.value = momPastView.refined;
      text.setAttribute("aria-label", "Saved meeting minutes");
      body.appendChild(text);
      wrap.appendChild(body);
    }
    momPastList.appendChild(wrap);
  }
}

async function refreshMomPastList() {
  if (!momPastList || momPastLoading) return;
  momPastLoading = true;
  renderMomPastList(momPastItems);
  try {
    const res = await window.coact.momList?.({});
    if (!res?.ok) {
      momPastItems = [];
      if (momPastList) {
        momPastList.innerHTML = "";
        const err = document.createElement("p");
        err.className = "muted tiny-copy";
        err.textContent = res?.error || "Could not load past MOMs.";
        momPastList.appendChild(err);
      }
      if (momPastCount) momPastCount.textContent = "";
      return;
    }
    renderMomPastList(res.items || []);
  } catch (err) {
    if (momPastList) {
      momPastList.innerHTML = "";
      const msg = document.createElement("p");
      msg.className = "muted tiny-copy";
      msg.textContent = err?.message || "Could not load past MOMs.";
      momPastList.appendChild(msg);
    }
  } finally {
    momPastLoading = false;
  }
}

function closeMomPastView() {
  momPastView = null;
  momPastSelectedId = "";
  lastMomUiFp = "";
  renderMomPastList(momPastItems);
  renderMomPanel(momSnapshot);
}

async function openMomPastItem(id) {
  const key = String(id || "").trim();
  if (!key) return;
  // Same row again → close
  if (momPastView?.id === key) {
    closeMomPastView();
    if (momStatus) momStatus.textContent = "Closed saved minutes.";
    return;
  }
  const cached = momPastItems.find((row) => row.id === key);
  momPastSelectedId = key;
  renderMomPastList(momPastItems);
  if (momStatus) momStatus.textContent = "Opening saved minutes…";
  try {
    let item = null;
    const res = await window.coact.momGetArtifact?.({ id: key });
    if (res?.ok && String(res.item?.refined || "").trim()) {
      item = res.item;
    } else if (String(cached?.refined || "").trim()) {
      item = cached;
    }
    if (!item || !String(item.refined || "").trim()) {
      if (momStatus)
        momStatus.textContent = res?.error || "Could not open those minutes.";
      return;
    }
    momPastView = {
      id: key,
      subject: String(item.subject || "").trim(),
      refined: String(item.refined || "").trim(),
      savedAt: String(item.savedAt || ""),
    };
    momPastSelectedId = key;
    momSelectedEventId = "";
    momPendingApproval = false;
    momEditMode = false;
    momMinutesOpen = false; // show inline under the Past MOMs row, not the top fold
    momMeetingsOpen = false;
    momTranscriptOpen = false;
    momPastOpen = true;
    lastMomUiFp = "";
    renderMomPastList(momPastItems);
    renderMomPanel(momSnapshot);
    if (momStatus) {
      momStatus.textContent = `Opened · ${formatMomSavedAt(momPastView.savedAt) || "saved"} · tap again to close`;
    }
    // Scroll the opened body into view
    requestAnimationFrame(() => {
      momPastList
        ?.querySelector(".mom-past-item.open .mom-past-minutes")
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  } catch (err) {
    if (momStatus)
      momStatus.textContent = err?.message || "Could not open those minutes.";
  }
}

function setOutlookStatus(text, kind) {
  if (!outlookConnectStatus) return;
  outlookConnectStatus.textContent = text || "";
  outlookConnectStatus.classList.toggle("ok", kind === "ok");
  outlookConnectStatus.classList.toggle("err", kind === "err");
}

function normalizeOutlookTenantUi(value) {
  let raw = String(value || "").trim();
  if (!raw) return OUTLOOK_DEFAULT_TENANT;
  // Repair accidental "<guid>consumers"
  if (
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}consumers?$/i.test(
      raw,
    )
  ) {
    return "consumers";
  }
  const lower = raw.toLowerCase();
  if (
    lower === OUTLOOK_MSA_TENANT ||
    lower === "consumers" ||
    lower === "consumer"
  ) {
    return "consumers";
  }
  if (lower === "organisation" || lower === "organization")
    return "organizations";
  return raw;
}

function outlookKindFromTenant(tenant) {
  const t = normalizeOutlookTenantUi(tenant);
  if (t === "consumers") return "personal";
  if (t === "organizations" || t === "common") return "work";
  return "custom";
}

function applyOutlookAccountKind(kind, { fillTenant = true } = {}) {
  const k = kind || "custom";
  if (outlookAccountKind && outlookAccountKind.value !== k) {
    outlookAccountKind.value = k;
  }
  if (outlookTenantInput) {
    if (k === "personal") {
      outlookTenantInput.value = "consumers";
      outlookTenantInput.readOnly = true;
    } else if (k === "work") {
      if (fillTenant) outlookTenantInput.value = "organizations";
      outlookTenantInput.readOnly = false;
    } else {
      if (fillTenant && !outlookTenantInput.value.trim()) {
        outlookTenantInput.value = OUTLOOK_DEFAULT_TENANT;
      }
      outlookTenantInput.readOnly = false;
    }
  }
  if (outlookTenantHint) {
    outlookTenantHint.innerHTML =
      k === "personal"
        ? `Personal Outlook.com: Tenant must be exactly <code>consumers</code>. (Not for the built-in LIVETRACK app.)`
        : k === "work"
          ? `Work multi-tenant: <code>organizations</code>, or your company Directory ID.`
          : `LIVETRACK default tenant is prefilled. Leave as-is unless IT gives a new app.`;
  }
}

function syncOutlookAccountKindFromTenant() {
  const tenant = outlookTenantInput?.value || "organizations";
  applyOutlookAccountKind(outlookKindFromTenant(tenant), { fillTenant: false });
}

function showMomDeviceHint(data) {
  if (!momDeviceHint) return;
  const on = Boolean(data?.userCode);
  momDeviceHint.classList.toggle("hidden", !on);
  if (on) momDeviceHint.removeAttribute("hidden");
  else momDeviceHint.setAttribute("hidden", "");
  if (momDeviceMessage) momDeviceMessage.textContent = data?.message || "";
  if (momDeviceCode) momDeviceCode.textContent = data?.userCode || "";
}

function setMomRecBar(on, label) {
  if (!momRecBar) return;
  momRecBar.classList.toggle("hidden", !on);
  if (on) momRecBar.removeAttribute("hidden");
  else momRecBar.setAttribute("hidden", "");
  if (momRecBarText) momRecBarText.textContent = label || "MOM recording";
  momBadge?.classList.toggle("hidden", !on);
}

function selectedMomEvent() {
  const events = momSnapshot?.events || [];
  return events.find((event) => event.id === momSelectedEventId) || null;
}

function renderMomTurns(turns, fallbackText, recording, meta) {
  if (!momTranscript) return;
  if (meta && typeof meta === "object") lastMomThreadMeta = meta;
  const info = lastMomThreadMeta || {};
  const rows = Array.isArray(turns)
    ? turns.filter((row) => String(row?.text || "").trim())
    : [];
  if (!rows.length) {
    const parsed =
      window.liveTrackMomSpeakers?.parseTurnsFromTranscript?.(fallbackText) ||
      [];
    if (
      parsed.length > 1 ||
      (parsed.length === 1 && parsed[0].speaker !== "Speaker")
    ) {
      renderMomTurns(parsed, "", recording, info);
      return;
    }
  }
  const threads =
    window.liveTrackMomSpeakers?.buildSpeakerThreads?.(rows, {
      operatorName: info.operatorName || momSnapshot?.greetingName || "",
      meeting: info.meeting || { tileNames: info.tileNames || [] },
      activeSpeaker: info.activeSpeaker || "",
    }) || [];
  const showThreads =
    threads.length &&
    (recording || rows.length || (info.tileNames || []).length > 1);
  if (!showThreads) {
    momTranscript.classList.remove("mom-thread-board", "mom-convo");
    momTranscript.textContent =
      fallbackText || (recording ? "Listening…" : "Not recording.");
    return;
  }
  momTranscript.classList.add("mom-thread-board", "mom-convo");
  momTranscript.replaceChildren();
  const people = document.createElement("div");
  people.className = "mom-convo-people";
  for (const thread of threads) {
    const chip = document.createElement("span");
    chip.className = `mom-convo-person${thread.local ? " local" : ""}${thread.live ? " live" : ""}`;
    chip.textContent = thread.live ? `${thread.name} · speaking` : thread.name;
    people.appendChild(chip);
  }
  momTranscript.appendChild(people);
  const chat = document.createElement("div");
  chat.className = "mom-convo-thread";
  const messages = threads
    .flatMap((thread) =>
      thread.turns
        .filter((row) => String(row?.text || "").trim())
        .map((row) => ({
          ...row,
          speaker: thread.name,
          local: thread.local,
          live: thread.live,
        })),
    )
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "mom-thread-empty";
    empty.textContent = recording
      ? "Waiting for the conversation…"
      : "No lines yet.";
    chat.appendChild(empty);
  } else {
    let lastSpeaker = "";
    for (const row of messages) {
      const grouped = lastSpeaker === row.speaker;
      const el = document.createElement("article");
      el.className = `mom-convo-row${row.local ? " local" : ""}${row.live && !grouped ? " live" : ""}${grouped ? " grouped" : ""}`;
      if (!grouped) {
        const who = document.createElement("strong");
        who.className = "mom-thread-name";
        who.textContent = row.speaker;
        el.appendChild(who);
      }
      const bubble = document.createElement("p");
      bubble.className = "mom-turn-text";
      bubble.textContent = row.text;
      el.appendChild(bubble);
      chat.appendChild(el);
      lastSpeaker = row.speaker;
    }
  }
  momTranscript.appendChild(chat);
  momTranscript.scrollTop = momTranscript.scrollHeight;
}

function momFoldIsVisible(el) {
  return (
    Boolean(el) &&
    !el.classList.contains("hidden") &&
    !el.hasAttribute("hidden")
  );
}

/** Accordion: one open fold (content-sized); closed folds dock as bars below it. */
function layoutMomFolds() {
  const folds = [
    { el: momMeetingsCard, open: momMeetingsOpen },
    { el: momLiveCard, open: momTranscriptOpen },
    { el: momMinutesCard, open: momMinutesOpen },
    { el: momPastCard, open: momPastOpen },
  ];
  let anyActive = false;
  for (const { el, open } of folds) {
    if (!el) continue;
    el.classList.remove("mom-dock-first", "mom-fold-active");
    if (!momFoldIsVisible(el)) {
      el.classList.add("collapsed");
      el.querySelector(".mom-fold-toggle")?.setAttribute(
        "aria-expanded",
        "false",
      );
      continue;
    }
    const isOpen = Boolean(open);
    el.classList.toggle("collapsed", !isOpen);
    el.classList.toggle("mom-fold-active", isOpen);
    el.querySelector(".mom-fold-toggle")?.setAttribute(
      "aria-expanded",
      isOpen ? "true" : "false",
    );
    if (isOpen) anyActive = true;
  }
  momFoldsStack?.classList.toggle("has-active", anyActive);
  if (anyActive && momFoldsStack) {
    const visible = [...momFoldsStack.querySelectorAll(".mom-fold")].filter(
      (el) => momFoldIsVisible(el),
    );
    const firstCollapsed = visible.find((el) =>
      el.classList.contains("collapsed"),
    );
    firstCollapsed?.classList.add("mom-dock-first");
  }
}

function closeAllMomFolds() {
  momMeetingsOpen = false;
  momTranscriptOpen = false;
  momMinutesOpen = false;
  momPastOpen = false;
}

function toggleMomFold(which) {
  const wasOpen =
    which === "meetings"
      ? momMeetingsOpen
      : which === "live"
        ? momTranscriptOpen
        : which === "minutes"
          ? momMinutesOpen
          : which === "past"
            ? momPastOpen
            : false;
  closeAllMomFolds();
  if (!wasOpen) {
    if (which === "meetings") momMeetingsOpen = true;
    else if (which === "live") momTranscriptOpen = true;
    else if (which === "minutes") momMinutesOpen = true;
    else if (which === "past") {
      momPastOpen = true;
      refreshMomPastList();
    }
  } else if (which === "minutes" && momPastView) {
    momPastView = null;
    momPastSelectedId = "";
    renderMomPastList(momPastItems);
    if (momStatus) momStatus.textContent = "Closed saved minutes.";
  }
  lastMomUiFp = "";
  renderMomPanel(momSnapshot);
}

function inviteLabel(status) {
  const key = String(status || "").toLowerCase();
  if (key === "organizer") return "Organizer";
  if (key === "accepted") return "Accepted";
  if (key === "tentativelyaccepted") return "Tentative";
  if (key === "notresponded" || key === "none" || !key) return "Invitation";
  if (key === "declined") return "Declined";
  return key;
}

function minutesForSelection(snap) {
  if (momPastView?.refined) {
    return {
      text: String(momPastView.refined).trim(),
      subject: momPastView.subject || "",
      pendingApproval: false,
      approved: true,
      fromPast: true,
      savedAt: momPastView.savedAt || "",
    };
  }
  const event = selectedMomEvent();
  const selectedId = momSelectedEventId || snap.session?.eventId || "";
  const sessionPending =
    snap.session?.pendingApproval &&
    String(snap.session?.refinedText || "").trim() &&
    (!selectedId || snap.session?.eventId === selectedId);
  if (sessionPending) {
    return {
      text: String(snap.session.refinedText).trim(),
      subject: snap.session.meeting?.subject || "",
      pendingApproval: true,
      approved: false,
    };
  }
  if (event?.refinedText) {
    return {
      text: String(event.refinedText).trim(),
      subject: event.subject || "",
      pendingApproval: false,
      approved: true,
    };
  }
  if (
    selectedId &&
    snap.session?.eventId === selectedId &&
    snap.session?.refinedText
  ) {
    return {
      text: String(snap.session.refinedText).trim(),
      subject: snap.session.meeting?.subject || "",
      pendingApproval: Boolean(snap.session.pendingApproval),
      approved: Boolean(snap.session.approved),
    };
  }
  const saved = (snap.outputs || []).find((row) => row.eventId === selectedId);
  if (saved?.refined) {
    return {
      text: String(saved.refined).trim(),
      subject: saved.subject || "",
      pendingApproval: false,
      approved: true,
    };
  }
  if (snap.session?.refinedText) {
    return {
      text: String(snap.session.refinedText).trim(),
      subject: snap.session.meeting?.subject || "",
      pendingApproval: Boolean(snap.session.pendingApproval),
      approved: Boolean(snap.session.approved),
    };
  }
  return { text: "", subject: "", pendingApproval: false, approved: false };
}

function setMomApproveBar(visible, { editing = false } = {}) {
  if (!momMinutesApproveBar) return;
  momMinutesApproveBar.classList.toggle("hidden", !visible);
  if (visible) momMinutesApproveBar.removeAttribute("hidden");
  else momMinutesApproveBar.setAttribute("hidden", "");
  if (btnMomEditRefine) {
    btnMomEditRefine.classList.toggle("hidden", editing);
    if (editing) btnMomEditRefine.setAttribute("hidden", "");
    else btnMomEditRefine.removeAttribute("hidden");
  }
  if (btnMomReRefine) {
    btnMomReRefine.classList.toggle("hidden", !editing);
    if (editing) btnMomReRefine.removeAttribute("hidden");
    else btnMomReRefine.setAttribute("hidden", "");
  }
  if (momApproveHint) {
    momApproveHint.textContent = editing
      ? "Edit the minutes, then refine again or approve to save them for today."
      : "Review the minutes. Approve to save them for today, or edit and refine again.";
  }
  if (momMinutes) {
    momMinutes.readOnly = !visible || !editing;
  }
}

function currentMomMinutesText() {
  return String(momMinutes?.value || "").trim();
}

/** Render plain text with http(s) URLs as clickable anchors (opens via shell). */
function appendLinkifiedText(el, text) {
  const src = String(text || "");
  const re = /https?:\/\/[^\s<>"']+/gi;
  let last = 0;
  let match;
  while ((match = re.exec(src))) {
    if (match.index > last) {
      el.appendChild(document.createTextNode(src.slice(last, match.index)));
    }
    let rawUrl = match[0];
    const trailing = rawUrl.match(/[),.;:!?\]]+$/);
    let suffix = "";
    if (trailing) {
      suffix = trailing[0];
      rawUrl = rawUrl.slice(0, -suffix.length);
    }
    let safe = "";
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        safe = parsed.toString();
      }
    } catch {
      safe = "";
    }
    if (safe) {
      const a = document.createElement("a");
      a.className = "mom-meeting-link";
      a.href = safe;
      a.textContent = rawUrl;
      a.title = safe;
      a.rel = "noopener noreferrer";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.coact.jiraOpenIssue?.(safe);
      });
      el.appendChild(a);
    } else {
      el.appendChild(document.createTextNode(match[0]));
      suffix = "";
    }
    if (suffix) el.appendChild(document.createTextNode(suffix));
    last = match.index + match[0].length;
  }
  if (last < src.length) {
    el.appendChild(document.createTextNode(src.slice(last)));
  }
}

function renderMomPanel(snapshot) {
  momSnapshot = snapshot || momSnapshot;
  const snap = momSnapshot || {};
  const recording = Boolean(
    snap.session?.recording || window.liveTrackMomRecord?.isRecording?.(),
  );
  const refining = Boolean(snap.session?.refining);
  const liveText =
    window.liveTrackMomRecord?.getTranscript?.() ||
    snap.session?.transcript ||
    "";
  const selectedMinutes = minutesForSelection(snap);
  const pendingApproval = Boolean(
    selectedMinutes.pendingApproval ||
    (snap.session?.pendingApproval && selectedMinutes.text),
  );
  momPendingApproval = pendingApproval && !selectedMinutes.approved;
  const fp = JSON.stringify({
    connected: snap.connected,
    configured: snap.configured,
    error: snap.error,
    account: snap.accountName,
    fetched: snap.fetchedAt,
    selected: momSelectedEventId,
    events: (snap.events || []).map((e) => [
      e.id,
      e.marked,
      e.phase,
      e.recording,
      e.canStart,
      e.hasMinutes,
      String(e.refinedText || "").length,
      e.joinUrl || "",
      e.webLink || "",
      e.responseStatus || "",
      e.organizer || "",
      e.location || "",
    ]),
    rec: recording,
    refining,
    busy: momBusy,
    t: liveText,
    minutes: selectedMinutes.text,
    pendingApproval: momPendingApproval,
    editMode: momEditMode,
    meetingsOpen: momMeetingsOpen,
    liveOpen: momTranscriptOpen,
    minutesOpen: momMinutesOpen,
    pastOpen: momPastOpen,
    pastId: momPastView?.id || "",
    expandedEvent: momExpandedEventId,
  });
  if (fp === lastMomUiFp) return;
  lastMomUiFp = fp;
  const liveTurns =
    window.liveTrackMomRecord?.getTurns?.() || snap.session?.turns || [];
  renderMomTurns(
    liveTurns,
    liveText,
    recording,
    window.liveTrackMomRecord?.getMeta?.(),
  );
  const minutes = selectedMinutes.text;
  const editingMinutes =
    momPendingApproval &&
    momEditMode &&
    momMinutes &&
    document.activeElement === momMinutes;
  if (momMinutes && minutes && !editingMinutes) {
    momMinutes.value = minutes;
  }
  if (momMinutes && !minutes && !editingMinutes && !momPastView) {
    momMinutes.value = "";
  }
  if (momMinutesTitle && minutes) {
    momMinutesTitle.textContent = selectedMinutes.fromPast
      ? selectedMinutes.subject
        ? `Saved · ${selectedMinutes.subject}`
        : "Saved minutes"
      : selectedMinutes.subject
        ? `Minutes · ${selectedMinutes.subject}`
        : momPendingApproval
          ? "Draft minutes"
          : "Refined minutes";
  }
  if (momMinutesCard) {
    // Past MOMs open inline under the row — keep the top minutes fold for live/draft only.
    const showMinutes = Boolean(minutes) && !selectedMinutes.fromPast;
    momMinutesCard.classList.toggle("hidden", !showMinutes);
    if (showMinutes) momMinutesCard.removeAttribute("hidden");
    else momMinutesCard.setAttribute("hidden", "");
  }
  setMomApproveBar(momPendingApproval && !selectedMinutes.fromPast, {
    editing: momEditMode,
  });
  if (momMinutes && (selectedMinutes.fromPast || !momPendingApproval)) {
    momMinutes.readOnly = true;
  }
  if (btnMomApprove) btnMomApprove.disabled = momBusy || refining || !minutes;
  if (btnMomEditRefine) btnMomEditRefine.disabled = momBusy || refining;
  if (btnMomReRefine) btnMomReRefine.disabled = momBusy || refining;
  if (btnMomCopy) btnMomCopy.disabled = !String(minutes || "").trim();
  layoutMomFolds();
  const event = selectedMomEvent();
  const canStartSelected = Boolean(event?.canStart);
  const canStart = !recording && !refining && !momBusy;
  if (btnMomStart) {
    btnMomStart.disabled = !canStart;
    btnMomStart.title = canStartSelected
      ? `Start MOM for “${event?.subject || "selected meeting"}”`
      : "Start an ad-hoc MOM now (no in-progress meeting selected)";
  }
  if (btnMomStop) btnMomStop.disabled = (!recording && !refining) || momBusy;
  if (btnMomCancel) btnMomCancel.disabled = !recording || momBusy;
  if (btnMomStopBar)
    btnMomStopBar.disabled = (!recording && !refining) || momBusy;
  if (btnMomCancelBar) btnMomCancelBar.disabled = !recording || momBusy;
  setMomRecBar(
    recording,
    event?.subject ? `MOM · ${event.subject}` : "MOM recording",
  );
  if (!momList) return;
  const events = snap.events || [];
  const countEl = document.getElementById("momMeetingsCount");
  if (countEl) {
    countEl.textContent = events.length ? `(${events.length})` : "";
  }
  momList.classList.toggle("empty", !events.length);
  momList.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "mom-empty-copy";
    if (snap.error) {
      empty.textContent = snap.error;
    } else if (snap.connected) {
      empty.textContent =
        "No meetings or invitations in the next 14 days. If you expected some, Disconnect and Connect again with the account that owns the calendar.";
    } else {
      empty.textContent = "Connect Outlook in Settings to pull meetings.";
    }
    momList.appendChild(empty);
    return;
  }
  if (
    !momPastView &&
    (!momSelectedEventId ||
      !events.some((row) => row.id === momSelectedEventId))
  ) {
    const live = events.find((row) => row.phase === "in_progress") || events[0];
    momSelectedEventId = live?.id || "";
  }
  if (
    momExpandedEventId &&
    !events.some((row) => row.id === momExpandedEventId)
  ) {
    momExpandedEventId = "";
  }
  for (const row of events) {
    const invite = inviteLabel(row.responseStatus);
    const inviteClass =
      String(row.responseStatus || "").toLowerCase() === "tentativelyaccepted"
        ? "invite-tentative"
        : String(row.responseStatus || "").toLowerCase() === "accepted" ||
            String(row.responseStatus || "").toLowerCase() === "organizer"
          ? "invite"
          : "invite invite-none";
    const isSelected = !momPastView && row.id === momSelectedEventId;
    const isExpanded = momExpandedEventId === row.id;
    const wrap = document.createElement("div");
    wrap.className = [
      "mom-meeting-item",
      inviteClass,
      isExpanded ? "open" : "",
      isSelected ? "selected" : "",
      row.phase === "in_progress" ? "in-progress" : "",
      row.recording ? "recording" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const header = document.createElement("button");
    header.type = "button";
    header.className = [
      "mom-event",
      "mom-meeting-toggle",
      isSelected ? "selected" : "",
      row.phase === "in_progress" ? "in-progress" : "",
      row.recording ? "recording" : "",
    ]
      .filter(Boolean)
      .join(" ");
    header.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    header.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      momPastView = null;
      momPastSelectedId = "";
      renderMomPastList(momPastItems);
      if (momExpandedEventId === row.id) {
        momExpandedEventId = "";
      } else {
        momExpandedEventId = row.id;
        momSelectedEventId = row.id;
      }
      lastMomUiFp = "";
      renderMomPanel(momSnapshot);
    });

    const top = document.createElement("div");
    top.className = "mom-event-top";
    const title = document.createElement("strong");
    title.textContent = row.subject || "(No subject)";
    const when = document.createElement("span");
    when.className = "muted tiny-copy mom-meeting-when";
    when.textContent = [formatMomTime(row.start), formatMomTime(row.end)]
      .filter(Boolean)
      .join("–");
    const chevron = document.createElement("span");
    chevron.className = "mom-meeting-chevron";
    chevron.textContent = isExpanded ? "▾" : "▸";
    top.append(title, when, chevron);
    header.appendChild(top);
    wrap.appendChild(header);

    if (isExpanded) {
      const body = document.createElement("div");
      body.className = "mom-meeting-body";
      body.addEventListener("click", (e) => e.stopPropagation());

      const meta = document.createElement("p");
      meta.className = "mom-event-meta";
      const badge = document.createElement("span");
      badge.className = "mom-invite-badge";
      badge.textContent = invite;
      const bits = [
        String(row.phase || "").replace(/_/g, " "),
        row.organizer ? `Organizer: ${row.organizer}` : "",
        row.location,
        row.isOnlineMeeting ? "Online" : "",
      ].filter(Boolean);
      if (row.marked) bits.unshift("Marked");
      if (row.hasMinutes) bits.unshift("Minutes saved");
      else if (
        snap.session?.pendingApproval &&
        snap.session?.eventId === row.id
      ) {
        bits.unshift("Awaiting approval");
      }
      meta.appendChild(badge);
      if (bits.length) {
        meta.appendChild(document.createTextNode(` · ${bits.join(" · ")}`));
      }
      body.appendChild(meta);

      const agendaText = String(
        row.agenda || row.bodyText || row.bodyPreview || "",
      ).trim();
      if (agendaText) {
        const agenda = document.createElement("div");
        agenda.className = "mom-meeting-agenda";
        const agendaLabel = document.createElement("div");
        agendaLabel.className = "mom-meeting-agenda-label";
        agendaLabel.textContent = "From invite";
        const agendaBody = document.createElement("div");
        agendaBody.className = "mom-meeting-agenda-text";
        appendLinkifiedText(agendaBody, agendaText);
        agenda.append(agendaLabel, agendaBody);
        body.appendChild(agenda);
      } else {
        body.classList.add("mom-meeting-body-compact");
      }

      const mark = document.createElement("label");
      mark.className = "mom-mark";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = Boolean(row.marked);
      box.addEventListener("click", (e) => e.stopPropagation());
      box.addEventListener("change", async () => {
        try {
          const next = await window.coact.momMark?.({
            eventId: row.id,
            marked: box.checked,
          });
          if (next) renderMomPanel(next);
        } catch {
          box.checked = !box.checked;
        }
      });
      mark.append(box, document.createTextNode("Mark for MOM"));
      body.appendChild(mark);

      const links = document.createElement("div");
      links.className = "mom-meeting-links";
      const joinUrl = String(
        row.joinUrl || row.teamsUrl || row.onlineMeetingUrl || "",
      ).trim();
      if (joinUrl) {
        const joinBtn = document.createElement("button");
        joinBtn.type = "button";
        joinBtn.className = "btn primary tiny";
        joinBtn.textContent = "Join Teams";
        joinBtn.title = joinUrl;
        joinBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.coact.jiraOpenIssue?.(joinUrl);
        });
        links.appendChild(joinBtn);
      }
      if (row.webLink) {
        const outlookBtn = document.createElement("button");
        outlookBtn.type = "button";
        outlookBtn.className = "btn ghost tiny";
        outlookBtn.textContent = "Open in Outlook";
        outlookBtn.title = row.webLink;
        outlookBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.coact.jiraOpenIssue?.(row.webLink);
        });
        links.appendChild(outlookBtn);
      }
      if (links.childNodes.length) body.appendChild(links);

      wrap.appendChild(body);
    }

    momList.appendChild(wrap);
  }
}

function expandSettingsFold(foldId, toggleId) {
  const el = document.getElementById(foldId);
  const btn = document.getElementById(toggleId);
  if (!el) return;
  el.classList.remove("collapsed");
  btn?.setAttribute("aria-expanded", "true");
}

async function openOutlookSettings() {
  await openSettings();
  expandSettingsFold("settingsOutlook", "btnSettingsOutlookToggle");
  document
    .getElementById("settingsOutlook")
    ?.scrollIntoView({ block: "nearest" });
  outlookEmailInput?.focus();
}

async function connectOutlookFromUi() {
  const email = String(outlookEmailInput?.value || "").trim();
  if (!email || !email.includes("@")) {
    await openOutlookSettings();
    setOutlookStatus(
      "Enter your Microsoft email, then Connect Outlook.",
      "err",
    );
    if (momStatus)
      momStatus.textContent = "Enter your Microsoft email in Settings.";
    outlookEmailInput?.focus();
    return;
  }
  if (btnOutlookConnect) btnOutlookConnect.disabled = true;
  setOutlookStatus(`Connecting as ${email}…`, "");
  if (momStatus) momStatus.textContent = `Connecting Outlook as ${email}…`;

  // Built-in LIVETRACK app — use /common for personal Outlook mailbox
  let clientId =
    String(outlookClientIdInput?.value || "").trim() || OUTLOOK_DEFAULT_CLIENT;
  let tenantId = normalizeOutlookTenantUi(
    outlookTenantInput?.value.trim() || OUTLOOK_DEFAULT_TENANT,
  );
  if (
    clientId === OUTLOOK_DEFAULT_CLIENT ||
    clientId === OUTLOOK_LEGACY_CLIENT
  ) {
    if (
      tenantId === OUTLOOK_LEGACY_SINGLE_TENANT ||
      tenantId === "organizations" ||
      !tenantId
    ) {
      tenantId = "common";
    }
    clientId = OUTLOOK_DEFAULT_CLIENT;
  }
  if (outlookTenantInput) outlookTenantInput.value = tenantId;
  if (outlookClientIdInput) outlookClientIdInput.value = clientId;

  const greeting = momGreetingInput?.value.trim() || email.split("@")[0] || "";

  try {
    await window.coact.saveOpenAiSettings?.({
      outlookTenantId: tenantId,
      outlookClientId: clientId,
      outlookPreferredEmail: email,
      momGreetingName: greeting,
    });
  } catch {
    /* still try connect */
  }
  try {
    const res = await window.coact.outlookConnect?.();
    showMomDeviceHint(null);
    if (res?.ok) {
      setOutlookStatus(
        `Outlook connected${res.accountName ? ` as ${res.accountName}` : ` as ${email}`}`,
        "ok",
      );
      const snap = await window.coact.outlookRefresh?.();
      if (snap?.error) {
        setOutlookStatus(snap.error, "err");
        if (momStatus) momStatus.textContent = snap.error;
      } else if (momStatus) {
        momStatus.textContent =
          "Outlook connected. Mark meetings to track, then Start MOM when a call begins (or anytime for ad-hoc).";
      }
      refreshMomPanel();
      return;
    }
    const err = res?.error || "Could not connect Outlook.";
    setOutlookStatus(err, "err");
    if (momStatus) momStatus.textContent = err;
    if (/client id|not configured|public client/i.test(err))
      await openOutlookSettings();
  } catch (err) {
    showMomDeviceHint(null);
    const message = err?.message || "Could not connect Outlook.";
    setOutlookStatus(message, "err");
    if (momStatus) momStatus.textContent = message;
  } finally {
    if (btnOutlookConnect) btnOutlookConnect.disabled = false;
  }
}

async function refreshMomPanel() {
  try {
    const snap = await window.coact.outlookRefresh?.();
    renderMomPanel(snap);
  } catch (err) {
    if (momStatus)
      momStatus.textContent = err?.message || "Could not refresh Outlook.";
  }
}

async function startMomRecording(eventId) {
  if (momBusy || window.liveTrackMomRecord?.isRecording?.()) return;
  momBusy = true;
  momMeetingsOpen = false;
  momTranscriptOpen = true;
  momMinutesOpen = false;
  momPastOpen = false;
  if (momStatus) momStatus.textContent = "";
  try {
    const started = await window.coact.momStart?.({ eventId });
    if (!started?.ok) {
      if (momStatus)
        momStatus.textContent = started?.error || "Could not start MOM.";
      return;
    }
    if (started.session?.eventId) momSelectedEventId = started.session.eventId;
    const rec = await window.liveTrackMomRecord.start({
      operatorName: momSnapshot?.greetingName || "",
      meeting: started?.session?.meeting || selectedMomEvent() || null,
      onStatus: (text) => {
        if (momStatus) momStatus.textContent = text || "";
      },
      onTurns: async (turns, full, meta) => {
        lastMomUiFp = "";
        renderMomTurns(turns, full, true, meta);
        try {
          await window.coact.momAppendTranscript?.({
            turns,
            text: full,
            replace: true,
          });
        } catch {
          /* keep local transcript */
        }
      },
    });
    if (!rec?.ok) {
      if (momStatus)
        momStatus.textContent = rec?.error || "Could not start the microphone.";
      return;
    }
    if (momStatus) momStatus.textContent = "";
    renderMomPanel(await window.coact.momGetSnapshot?.());
  } finally {
    momBusy = false;
    renderMomPanel(momSnapshot);
  }
}

async function stopMomAndRefine(source = "manual") {
  if (momBusy) return;
  momBusy = true;
  momEditMode = false;
  if (momStatus) momStatus.textContent = "Stopping and refining minutes…";
  try {
    const rec = await window.liveTrackMomRecord?.stop?.();
    const transcript =
      rec?.transcript || window.liveTrackMomRecord?.getTranscript?.() || "";
    const turns = rec?.turns || window.liveTrackMomRecord?.getTurns?.() || [];
    const result = await window.coact.momStopRefine?.({
      transcript,
      turns,
      source,
    });
    if (!result?.ok) {
      if (momStatus)
        momStatus.textContent = result?.error || "Could not refine minutes.";
      return;
    }
    momPendingApproval = Boolean(result?.pendingApproval !== false);
    if (momStatus) {
      momStatus.textContent = momPendingApproval
        ? "Minutes ready — approve to save, or edit and refine."
        : "Minutes refined.";
    }
  } catch (err) {
    if (momStatus)
      momStatus.textContent = err?.message || "Could not refine minutes.";
  } finally {
    momBusy = false;
  }
}

async function approveMomMinutes() {
  if (momBusy || !momPendingApproval) return;
  momBusy = true;
  if (momStatus) momStatus.textContent = "Saving approved minutes…";
  try {
    const result = await window.coact.momApprove?.({
      text: currentMomMinutesText(),
    });
    if (!result?.ok) {
      if (momStatus)
        momStatus.textContent = result?.error || "Could not approve minutes.";
      return;
    }
    momPendingApproval = false;
    momEditMode = false;
    setMomApproveBar(false);
    if (momMinutes) momMinutes.readOnly = true;
    lastMomUiFp = "";
    if (momStatus) {
      momStatus.textContent =
        result?.actionsImported > 0
          ? `Minutes approved. ${result.actionsImported} action item${
              result.actionsImported === 1 ? "" : "s"
            } saved to Actions.`
          : "Minutes approved and saved for today.";
    }
    if (result?.actionsImported > 0) {
      refreshActionsBadge();
      if (activeNav === "actions") refreshActionsList();
    }
    renderMomPanel(await window.coact.momGetSnapshot?.());
    refreshMomPastList();
  } catch (err) {
    if (momStatus)
      momStatus.textContent = err?.message || "Could not approve minutes.";
  } finally {
    momBusy = false;
  }
}

function enterMomEditRefine() {
  if (!momPendingApproval) return;
  momEditMode = true;
  lastMomUiFp = "";
  setMomApproveBar(true, { editing: true });
  if (momMinutes) {
    momMinutes.readOnly = false;
    momMinutes.focus();
  }
  if (momStatus) {
    momStatus.textContent =
      "Edit the draft, then Refine again or Approve minutes.";
  }
  renderMomPanel(momSnapshot);
}

async function reRefineMomMinutes() {
  if (momBusy || !momPendingApproval) return;
  const draft = currentMomMinutesText();
  if (!draft) {
    if (momStatus)
      momStatus.textContent = "Add some minutes text before refining.";
    return;
  }
  momBusy = true;
  if (momStatus) momStatus.textContent = "Refining minutes again…";
  try {
    const result = await window.coact.momReRefine?.({ text: draft });
    if (!result?.ok) {
      if (momStatus)
        momStatus.textContent = result?.error || "Could not refine minutes.";
      return;
    }
    momEditMode = false;
    momPendingApproval = true;
    if (momMinutes && result.text) momMinutes.value = result.text;
    lastMomUiFp = "";
    if (momStatus) {
      momStatus.textContent =
        "Updated draft — approve to save, or edit and refine again.";
    }
    renderMomPanel(await window.coact.momGetSnapshot?.());
  } catch (err) {
    if (momStatus)
      momStatus.textContent = err?.message || "Could not refine minutes.";
  } finally {
    momBusy = false;
  }
}

async function cancelMomRecording() {
  if (momBusy) return;
  const recording = Boolean(
    window.liveTrackMomRecord?.isRecording?.() ||
    momSnapshot?.session?.recording,
  );
  if (!recording) return;
  momBusy = true;
  if (momStatus) momStatus.textContent = "Cancelling…";
  try {
    await window.liveTrackMomRecord?.cancel?.();
    await window.coact.momCancel?.();
    lastMomUiFp = "";
    lastMomThreadMeta = {};
    momPendingApproval = false;
    momEditMode = false;
    showNav("mom");
    if (momStatus) momStatus.textContent = "Recording discarded.";
    renderMomTurns([], "", false);
    renderMomPanel(await window.coact.momGetSnapshot?.());
  } catch (err) {
    if (momStatus)
      momStatus.textContent = err?.message || "Could not cancel recording.";
  } finally {
    momBusy = false;
    lastMomUiFp = "";
    renderMomPanel(momSnapshot);
  }
}

function showMomMinutes(text, meeting, { pendingApproval = true } = {}) {
  const body = String(text || "").trim();
  if (!body) return;
  momMinutesOpen = true;
  momMeetingsOpen = false;
  momTranscriptOpen = false;
  momPastOpen = false;
  momPendingApproval = Boolean(pendingApproval);
  if (!momPendingApproval) momEditMode = false;
  lastMomUiFp = "";
  if (momMinutesTitle) {
    momMinutesTitle.textContent = meeting?.subject
      ? `Minutes · ${meeting.subject}`
      : momPendingApproval
        ? "Draft minutes"
        : "Refined minutes";
  }
  if (momMinutes) {
    momMinutes.value = body;
    momMinutes.readOnly = !momPendingApproval || !momEditMode;
  }
  setMomApproveBar(momPendingApproval, { editing: momEditMode });
  showNav("mom");
  if (momStatus) {
    momStatus.textContent = momPendingApproval
      ? "Minutes ready — approve to save, or edit and refine."
      : "";
  }
  renderMomPanel(momSnapshot);
}

async function refreshJiraPanel() {
  if (jiraRefreshing) {
    jiraRefreshQueued = true;
    return;
  }
  jiraRefreshing = true;
  if (jiraMeta) jiraMeta.textContent = "Refreshing…";
  try {
    const snap = await window.coact.jiraRefresh?.();
    renderJiraList(snap);
  } catch (err) {
    const raw = err?.message || String(err);
    const error =
      /Unexpected token\s+'<'/.test(raw) ||
      /is not valid JSON/i.test(raw) ||
      /Error invoking remote method 'jira-refresh'/i.test(raw)
        ? "Jira returned HTML instead of JSON. Set Site URL to https://your-domain.atlassian.net or http://127.0.0.1:4176 (local mock), not a login, /browse, or dashboard page."
        : raw;
    renderJiraList({
      ok: false,
      configured: true,
      issues: [],
      staleCount: 0,
      error,
    });
  } finally {
    jiraRefreshing = false;
    if (jiraRefreshQueued) {
      jiraRefreshQueued = false;
      refreshJiraPanel();
    }
  }
}

function fillDeskSelectOptions(sel, { emptyLabel, previous, pickOpen } = {}) {
  if (!sel) return "";
  const issues = Array.isArray(jiraSnapshot?.issues) ? jiraSnapshot.issues : [];
  const prev = previous || "";
  sel.replaceChildren();
  if (!issues.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent =
      jiraSnapshot?.configured === false
        ? "Configure Jira in Settings"
        : emptyLabel || "No tickets loaded";
    sel.appendChild(opt);
    return "";
  }
  if (!pickOpen) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = emptyLabel || "Pick a ticket";
    sel.appendChild(empty);
  }
  const openFirst = issues.find((i) => !i.done) || issues[0];
  const pick = issues.some((i) => i.key === prev)
    ? prev
    : pickOpen
      ? openFirst?.key || ""
      : "";
  for (const issue of issues) {
    const opt = document.createElement("option");
    opt.value = issue.key;
    opt.textContent =
      `${issue.key} — ${issue.summary || issue.status || ""}`.slice(0, 80);
    sel.appendChild(opt);
  }
  sel.value = pick;
  return pick;
}

function deskHasTicketMaterial() {
  return Boolean(deskSnipPath) || deskExtraFiles.length > 0;
}

function selectedDeskProposedTickets() {
  const list = document.getElementById("deskProposedList");
  if (!list || deskProposedTickets.length < 2) return [];
  const boxes = [...list.querySelectorAll('input[type="checkbox"]')];
  return deskProposedTickets.filter((_, index) => boxes[index]?.checked);
}

function clearDeskProposedTickets() {
  deskProposedTickets = [];
  const wrap = document.getElementById("deskProposedWrap");
  const list = document.getElementById("deskProposedList");
  const reason = document.getElementById("deskProposedReason");
  if (wrap) wrap.hidden = true;
  if (list) list.replaceChildren();
  if (reason) reason.textContent = "";
}

function renderDeskProposedTickets(tickets, reasonText) {
  const rows = Array.isArray(tickets)
    ? tickets.filter((item) => String(item?.summary || "").trim())
    : [];
  if (rows.length < 2) {
    clearDeskProposedTickets();
    return;
  }
  deskProposedTickets = rows.map((item) => ({
    summary: String(item.summary || "").slice(0, 255),
    description: String(item.description || ""),
    acceptanceCriteria: String(item.acceptanceCriteria || ""),
    groupingHint: String(item.groupingHint || ""),
  }));
  const wrap = document.getElementById("deskProposedWrap");
  const list = document.getElementById("deskProposedList");
  const reason = document.getElementById("deskProposedReason");
  if (!wrap || !list) return;
  wrap.hidden = false;
  if (reason) {
    reason.textContent =
      reasonText ||
      `Proposed ${deskProposedTickets.length} tickets. Uncheck any you do not want, then Create selected.`;
  }
  list.replaceChildren();
  deskProposedTickets.forEach((ticket) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    label.className = "desk-proposed-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.addEventListener("change", () => {
      syncDeskTicketButtons();
    });
    const body = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = ticket.summary;
    body.appendChild(title);
    if (ticket.groupingHint) {
      const hint = document.createElement("span");
      hint.className = "muted tiny-copy";
      hint.textContent = ticket.groupingHint;
      body.appendChild(hint);
    }
    label.append(cb, body);
    li.appendChild(label);
    list.appendChild(li);
  });
}

function syncDeskTicketButtons() {
  const createBtn = document.getElementById("btnDeskCreateIssue");
  const refineBtn = document.getElementById("btnDeskRefineAi");
  const clearBtn = document.getElementById("btnDeskClearSnip");
  const source = document.getElementById("deskCloneSelect")?.value || "";
  const hasMaterial = deskHasTicketMaterial();
  const selected = selectedDeskProposedTickets();
  if (createBtn) {
    createBtn.disabled = !hasMaterial || (deskProposedTickets.length >= 2 && selected.length === 0);
    if (selected.length > 1 && !source) {
      createBtn.textContent = `Create selected (${selected.length})`;
    } else {
      createBtn.textContent = source ? "Clone ticket" : "Create ticket";
    }
  }
  if (refineBtn) refineBtn.disabled = !hasMaterial;
  if (clearBtn) clearBtn.hidden = false;
}

function clearDeskScreenshot() {
  resetDeskTicketForm();
  setDeskStatus("deskSnipStatus", "Form cleared.");
}

function fillDeskIssueSelect() {
  const cloneSel = document.getElementById("deskCloneSelect");
  fillDeskSelectOptions(cloneSel, {
    emptyLabel: "Pick a ticket to clone",
    previous: cloneSel?.value || "",
    pickOpen: false,
  });
  fillDeskSelectOptions(document.getElementById("jiraMailIssueSelect"), {
    emptyLabel: "Pick a story",
    previous: document.getElementById("jiraMailIssueSelect")?.value || "",
    pickOpen: true,
  });
  syncDeskTicketButtons();
}

async function refreshDeskIssues() {
  try {
    const snap = (await window.coact.jiraGetSnapshot?.()) || jiraSnapshot;
    if (snap) renderJiraList(snap);
    else fillDeskIssueSelect();
  } catch {
    fillDeskIssueSelect();
  }
}

function setDeskStatus(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || "";
}

function toggleDeskFold(foldId, toggleId) {
  const el = document.getElementById(foldId);
  const btn = document.getElementById(toggleId);
  if (!el) return;
  const open = el.classList.contains("collapsed");
  el.classList.toggle("collapsed", !open);
  btn?.setAttribute("aria-expanded", open ? "true" : "false");
}

document
  .getElementById("btnDeskExplainToggle")
  ?.addEventListener("click", () =>
    toggleDeskFold("deskExplainFold", "btnDeskExplainToggle"),
  );
document
  .getElementById("btnDeskJiraToggle")
  ?.addEventListener("click", () =>
    toggleDeskFold("deskJiraFold", "btnDeskJiraToggle"),
  );
document
  .getElementById("btnDeskCollabToggle")
  ?.addEventListener("click", () =>
    toggleDeskFold("deskCollabFold", "btnDeskCollabToggle"),
  );
document
  .getElementById("btnActionsAddToggle")
  ?.addEventListener("click", () =>
    toggleDeskFold("actionsAddFold", "btnActionsAddToggle"),
  );

document
  .getElementById("btnDeskExplain")
  ?.addEventListener("click", async () => {
    const briefing = document.getElementById("deskBriefing");
    const confEl = document.getElementById("deskExplainConfidence");
    const btn = document.getElementById("btnDeskExplain");
    setDeskStatus(
      "deskExplainStatus",
      "Capturing the window you are using… Desk stays visible.",
    );
    if (briefing) {
      briefing.hidden = true;
      briefing.innerHTML = "";
    }
    if (confEl) {
      confEl.hidden = true;
      confEl.innerHTML = "";
    }
    if (btn) btn.disabled = true;
    // Ensure the Explain fold is open so the result is visible
    const fold = document.getElementById("deskExplainFold");
    if (fold?.classList.contains("collapsed")) {
      toggleDeskFold("deskExplainFold", "btnDeskExplainToggle");
    }
    try {
      const res = await window.coact.deskExplainPage?.();
      if (!res?.ok) {
        setDeskStatus(
          "deskExplainStatus",
          res?.error || "Could not explain this window.",
        );
        return;
      }
      const conf = Number(res.confidence);
      const matches = Array.isArray(res.matches) ? res.matches : [];
      const hasConf = Number.isFinite(conf) && conf > 0;
      if (confEl && hasConf) {
        const label = escapeHtml(String(res.confidenceLabel || "—"));
        const matchItems = matches
          .slice(0, 5)
          .map(
            (m) =>
              `<li><strong>${escapeHtml(String(m.ref || ""))}</strong> — ${Number(m.confidence) || 0}% (${escapeHtml(String(m.confidenceLabel || "—"))})</li>`,
          )
          .join("");
        confEl.innerHTML = `<strong>Confidence ${conf}%</strong> (${label})${
          matchItems
            ? `<ul class="desk-match-list">${matchItems}</ul>`
            : res.pastWork
              ? `<div class="muted tiny-copy">Past work matched, but no reference list returned.</div>`
              : `<div class="muted tiny-copy">Screen-only explain (no past refs matched).</div>`
        }`;
        confEl.hidden = false;
      }
      if (briefing) {
        briefing.hidden = false;
        briefing.innerHTML = formatDeskBriefingHtml(res.text || "");
      }
      const sourceLabel = res.owner
        ? `From ${res.owner}.`
        : res.capture === "region"
          ? "From a screenshot of the app."
          : "From the window you were using.";
      const confStatus = hasConf ? ` Confidence ${conf}%.` : "";
      setDeskStatus("deskExplainStatus", `${sourceLabel}${confStatus}`);
    } catch (err) {
      setDeskStatus(
        "deskExplainStatus",
        err?.message || "Could not explain this window.",
      );
    } finally {
      if (btn) btn.disabled = false;
    }
  });

function resetDeskTicketForm() {
  deskSnipPath = "";
  deskExtraFiles = [];
  deskCreatedIssueUrl = "";
  clearDeskProposedTickets();
  const preview = document.getElementById("deskSnipPreview");
  if (preview) {
    preview.removeAttribute("src");
    preview.classList.add("hidden");
  }
  const summary = document.getElementById("deskIssueSummary");
  const description = document.getElementById("deskIssueDescription");
  const acceptance = document.getElementById("deskIssueAcceptance");
  const cloneSel = document.getElementById("deskCloneSelect");
  const openBtn = document.getElementById("btnDeskOpenIssue");
  if (summary) summary.value = "";
  if (description) description.value = "";
  if (acceptance) acceptance.value = "";
  if (cloneSel) cloneSel.value = "";
  if (openBtn) openBtn.hidden = true;
  renderDeskAttachRow();
  syncDeskTicketButtons();
}

function formatDeskCollabWhen(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  try {
    return new Date(t).toLocaleString();
  } catch {
    return String(iso || "");
  }
}

function renderDeskCollabList(tickets) {
  const list = document.getElementById("deskCollabList");
  if (!list) return;
  list.replaceChildren();
  const rows = Array.isArray(tickets) ? tickets : [];
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "muted tiny-copy";
    li.textContent = "No tickets created from LiveTrack yet.";
    list.appendChild(li);
    return;
  }
  for (const ticket of rows) {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = ticket.issueKey || "Ticket";
    const meta = document.createElement("span");
    meta.className = "muted tiny-copy";
    const bits = [
      ticket.action === "clone"
        ? `Cloned${ticket.clonedFrom ? ` from ${ticket.clonedFrom}` : ""}`
        : "Created",
      ticket.summary && ticket.summary !== ticket.issueKey ? ticket.summary : "",
      formatDeskCollabWhen(ticket.timestamp),
    ].filter(Boolean);
    meta.textContent = bits.join(" · ");
    li.appendChild(title);
    li.appendChild(meta);
    if (ticket.url) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "btn ghost tiny desk-collab-open";
      open.textContent = "Open ticket";
      open.addEventListener("click", () =>
        window.coact.jiraOpenIssue?.(ticket.url),
      );
      li.appendChild(open);
    }
    list.appendChild(li);
  }
}

async function refreshDeskCollabList() {
  try {
    const res = await window.coact.deskCreatedTickets?.();
    renderDeskCollabList(res?.ok ? res.tickets : []);
  } catch {
    renderDeskCollabList([]);
  }
}

function renderDeskAttachRow() {
  const row = document.getElementById("deskAttachRow");
  if (!row) return;
  row.innerHTML = "";
  deskExtraFiles.forEach((file, index) => {
    const chip = document.createElement("span");
    chip.className = "attach-chip";
    chip.innerHTML = `${escapeHtml(file.name)} <button type="button" data-file="${index}">×</button>`;
    row.appendChild(chip);
  });
  row.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      deskExtraFiles.splice(Number(btn.dataset.file), 1);
      renderDeskAttachRow();
      syncDeskTicketButtons();
    });
  });
}

function applyDeskTicketDraft(res, { replace = false } = {}) {
  const summary = document.getElementById("deskIssueSummary");
  const description = document.getElementById("deskIssueDescription");
  const acceptance = document.getElementById("deskIssueAcceptance");
  if (summary && res?.summary) {
    const cur = summary.value.trim();
    const auto =
      replace ||
      !cur ||
      /^Blocked on /i.test(cur) ||
      /127\.0\.0\.1|localhost/i.test(cur) ||
      /LiveTrack Desk/i.test(cur) ||
      /forest|wallpaper|scenic|nature-themed/i.test(cur);
    if (auto) summary.value = String(res.summary).slice(0, 255);
  }
  if (description && res?.description) {
    const cur = description.value.trim();
    if (replace || !cur || /forest|wallpaper|scenic|nature-themed/i.test(cur)) {
      description.value = res.description;
    }
  }
  if (
    acceptance &&
    (replace || !acceptance.value.trim()) &&
    res?.acceptanceCriteria
  ) {
    acceptance.value = res.acceptanceCriteria;
  }
}

document.getElementById("btnDeskClearSnip")?.addEventListener("click", () => {
  resetDeskTicketForm();
  setDeskStatus("deskSnipStatus", "Form cleared.");
});

document.getElementById("btnDeskSnip")?.addEventListener("click", async () => {
  const jiraFold = document.getElementById("deskJiraFold");
  if (jiraFold?.classList.contains("collapsed")) {
    toggleDeskFold("deskJiraFold", "btnDeskJiraToggle");
  }
  const preview = document.getElementById("deskSnipPreview");
  const openBtn = document.getElementById("btnDeskOpenIssue");
  setDeskStatus("deskSnipStatus", "Drag a box, then release. Esc cancels.");
  if (openBtn) openBtn.hidden = true;
  try {
    const res = await runQueueCardSnip();
    if (res?.cancelled) {
      setDeskStatus(
        "deskSnipStatus",
        "Capture cancelled. Create and Clone stay grey until a snip is on this card.",
      );
      return;
    }
    if (!res?.ok || !res.path) {
      deskSnipPath = "";
      syncDeskTicketButtons();
      preview?.classList.add("hidden");
      setDeskStatus("deskSnipStatus", res?.error || "Snip failed");
      return;
    }
    deskSnipPath = res.path;
    if (preview) {
      if (res.dataUrl) {
        preview.src = res.dataUrl;
        preview.classList.remove("hidden");
      } else {
        preview.removeAttribute("src");
        preview.classList.add("hidden");
      }
    }
    syncDeskTicketButtons();
    setDeskStatus("deskSnipStatus", "Writing ticket from screenshot…");
    const draft = await window.coact.deskDraftFromScreenshot?.({
      path: deskSnipPath,
      pageUrl: activeTabUrl || "",
      pageTitle: activeTabTitle || "",
    });
    if (draft?.ok) {
      applyDeskTicketDraft(draft, { replace: true });
      const via = draft.usedAi
        ? "AI drafted the summary."
        : draft.note || "Add or edit the summary, then create a ticket.";
      setDeskStatus("deskSnipStatus", `Snip ready. ${via}`);
    } else {
      setDeskStatus(
        "deskSnipStatus",
        draft?.error || "Snip ready. Add a summary, then create a ticket.",
      );
    }
  } catch (err) {
    setDeskStatus("deskSnipStatus", err?.message || "Snip failed");
  }
});

document
  .getElementById("btnDeskAttach")
  ?.addEventListener("click", async () => {
    const picker = window.coact.pickDeskFiles || window.coact.pickErrorFiles;
    if (!picker) return;
    const res = await picker();
    if (!res?.ok || !res.files?.length) return;
    const seen = new Set(deskExtraFiles.map((f) => f.path));
    for (const file of res.files) {
      if (!file?.path || seen.has(file.path)) continue;
      seen.add(file.path);
      deskExtraFiles.push({
        path: file.path,
        name: file.name || file.path.split(/[\\/]/).pop(),
      });
    }
    renderDeskAttachRow();
    syncDeskTicketButtons();
    setDeskStatus(
      "deskSnipStatus",
      "Files attached. Click Refine with AI to draft the ticket, then Create.",
    );
  });

document
  .getElementById("btnDeskRefineAi")
  ?.addEventListener("click", async () => {
    if (!deskHasTicketMaterial()) {
      setDeskStatus(
        "deskSnipStatus",
        "Capture a screenshot or attach a file first.",
      );
      return;
    }
    const refineBtn = document.getElementById("btnDeskRefineAi");
    if (refineBtn) refineBtn.disabled = true;
    setDeskStatus("deskSnipStatus", "Sending materials to AI for refinement…");
    try {
      const res = await window.coact.deskRefineTicket?.({
        screenshotPath: deskSnipPath || "",
        extraFiles: deskExtraFiles,
        summary: document.getElementById("deskIssueSummary")?.value || "",
        description: document.getElementById("deskIssueDescription")?.value || "",
        acceptanceCriteria:
          document.getElementById("deskIssueAcceptance")?.value || "",
        pageUrl: activeTabUrl || "",
        pageTitle: activeTabTitle || "",
      });
      if (!res?.ok) {
        setDeskStatus(
          "deskSnipStatus",
          res?.error || "Could not refine with AI.",
        );
        return;
      }
      const proposed = Array.isArray(res.tickets) ? res.tickets : [];
      if (res.mode === "multiple" && proposed.length >= 2) {
        renderDeskProposedTickets(proposed, res.reason || "");
        applyDeskTicketDraft(proposed[0], { replace: true });
        const via = res.usedAi
          ? res.reason ||
            `Proposed ${proposed.length} tickets. Review the list, then Create selected.`
          : res.note || "Could not use AI; fallback draft filled.";
        setDeskStatus("deskSnipStatus", via);
      } else {
        clearDeskProposedTickets();
        applyDeskTicketDraft(res, { replace: true });
        const via = res.usedAi
          ? res.reason
            ? `One ticket. ${res.reason}`
            : "AI refined the ticket from your files."
          : res.note || "Could not use AI; fallback draft filled.";
        setDeskStatus("deskSnipStatus", via);
      }
    } catch (err) {
      setDeskStatus("deskSnipStatus", err?.message || "Could not refine with AI.");
    } finally {
      syncDeskTicketButtons();
    }
  });

async function createDeskProposedTickets(tickets) {
  const createBtn = document.getElementById("btnDeskCreateIssue");
  const shot = deskSnipPath;
  const files = deskExtraFiles.slice();
  if (createBtn) createBtn.disabled = true;
  const keys = [];
  const errors = [];
  setDeskStatus("deskSnipStatus", `Creating ${tickets.length} tickets…`);
  for (let i = 0; i < tickets.length; i += 1) {
    const ticket = tickets[i];
    setDeskStatus(
      "deskSnipStatus",
      `Creating ${i + 1} of ${tickets.length}: ${ticket.summary.slice(0, 80)}…`,
    );
    try {
      const res = await window.coact.deskCreateJiraIssue?.({
        mode: "create",
        summary: ticket.summary,
        description: ticket.description,
        acceptanceCriteria: ticket.acceptanceCriteria,
        screenshotPath: shot,
        extraFiles: files,
        pageUrl: activeTabUrl || "",
        pageTitle: activeTabTitle || "",
      });
      if (res?.ok && res.issueKey) keys.push(res.issueKey);
      else errors.push(res?.error || ticket.summary.slice(0, 40));
    } catch (err) {
      errors.push(err?.message || ticket.summary.slice(0, 40));
    }
  }
  resetDeskTicketForm();
  fillDeskIssueSelect();
  await refreshDeskCollabList();
  const created = keys.length ? `Created ${keys.join(", ")}.` : "No tickets created.";
  const failed = errors.length ? ` Failed: ${errors.join("; ")}` : "";
  setDeskStatus("deskSnipStatus", `${created}${failed}`);
  syncDeskTicketButtons();
}

async function submitDeskJiraIssue(mode) {
  const createBtn = document.getElementById("btnDeskCreateIssue");
  const summary =
    document.getElementById("deskIssueSummary")?.value.trim() ||
    "Issue from LiveTrack Desk";
  const description =
    document.getElementById("deskIssueDescription")?.value.trim() || "";
  const acceptanceCriteria =
    document.getElementById("deskIssueAcceptance")?.value.trim() || "";
  const sourceKey = document.getElementById("deskCloneSelect")?.value || "";
  const selected = selectedDeskProposedTickets();
  if (!deskHasTicketMaterial()) {
    setDeskStatus("deskSnipStatus", "Capture a screenshot or attach a file first.");
    return;
  }
  if (mode !== "clone" && selected.length > 1) {
    await createDeskProposedTickets(selected);
    return;
  }
  if (mode === "clone" && !sourceKey) {
    setDeskStatus("deskSnipStatus", "Pick a ticket to clone.");
    return;
  }
  const draft = selected.length === 1 ? selected[0] : null;
  if (createBtn) createBtn.disabled = true;
  setDeskStatus(
    "deskSnipStatus",
    mode === "clone" ? `Cloning ${sourceKey}…` : "Creating ticket…",
  );
  try {
    const res = await window.coact.deskCreateJiraIssue?.({
      mode,
      sourceKey: mode === "clone" ? sourceKey : "",
      summary: draft?.summary || summary,
      description: draft?.description || description,
      acceptanceCriteria: draft?.acceptanceCriteria || acceptanceCriteria,
      screenshotPath: deskSnipPath,
      extraFiles: deskExtraFiles,
      pageUrl: activeTabUrl || "",
      pageTitle: activeTabTitle || "",
    });
    if (!res?.ok) {
      setDeskStatus(
        "deskSnipStatus",
        res?.error ||
          (mode === "clone"
            ? "Could not clone ticket."
            : "Could not create ticket."),
      );
      return;
    }
    const extraOk = (res.attachments || []).filter((a) => a.ok).length;
    const extraNote =
      extraOk > 1
        ? ` ${extraOk} files attached.`
        : extraOk === 1
          ? " Screenshot attached."
          : "";
    const attachFail = res.attachError ? ` ${res.attachError}` : "";
    const verb =
      mode === "clone"
        ? `Cloned ${sourceKey} → ${res.issueKey}`
        : `Created ${res.issueKey}`;
    resetDeskTicketForm();
    fillDeskIssueSelect();
    await refreshDeskCollabList();
    setDeskStatus(
      "deskSnipStatus",
      res.issueKey ? `${verb}.${extraNote}${attachFail}` : "Ticket created.",
    );
  } catch (err) {
    setDeskStatus(
      "deskSnipStatus",
      err?.message ||
        (mode === "clone"
          ? "Could not clone ticket."
          : "Could not create ticket."),
    );
  } finally {
    syncDeskTicketButtons();
  }
}

document.getElementById("deskCloneSelect")?.addEventListener("change", () => {
  syncDeskTicketButtons();
});

document
  .getElementById("btnDeskCreateIssue")
  ?.addEventListener("click", () => {
    const sourceKey = document.getElementById("deskCloneSelect")?.value || "";
  const selected = selectedDeskProposedTickets();
  if (selected.length > 1) {
    submitDeskJiraIssue("create");
    return;
  }
  submitDeskJiraIssue(sourceKey ? "clone" : "create");
});

document.getElementById("btnDeskOpenIssue")?.addEventListener("click", () => {
  if (deskCreatedIssueUrl) window.coact.jiraOpenIssue?.(deskCreatedIssueUrl);
});

function syncChatLogVisibility(logEl = chatLog) {
  if (!logEl) return;
  logEl.classList.toggle("empty", logEl.childElementCount === 0);
}

function appendChatBubble(role, text, logEl = chatLog) {
  if (role === "system") return null;
  const log = logEl || chatLog;
  const el = document.createElement("div");
  el.className = `chat-msg ${role}`;
  const body = document.createElement("div");
  body.className = "chat-msg-body";
  body.textContent = text || "";
  el.appendChild(body);

  if (role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "chat-msg-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "chat-msg-copy";
    copyBtn.textContent = "Copy";
    copyBtn.title = "Copy response";
    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const value = body.textContent || "";
      try {
        await navigator.clipboard.writeText(value);
        copyBtn.textContent = "Copied";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = "Copy";
          copyBtn.classList.remove("copied");
        }, 1200);
      } catch {
        copyBtn.textContent = "Failed";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
        }, 1200);
      }
    });
    const speakBtn = document.createElement("button");
    speakBtn.type = "button";
    speakBtn.className = "chat-msg-copy js-speak-btn";
    speakBtn.textContent = "Speak";
    speakBtn.title = "Speak this reply";
    speakBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (window.liveTrackVoice?.isSpeaking?.()) {
        window.liveTrackVoice.stopSpeaking();
        return;
      }
      await window.liveTrackVoice?.unlockAudio?.();
      await window.liveTrackVoice?.speak?.(body.textContent || "");
    });
    actions.append(speakBtn, copyBtn);
    el.appendChild(actions);
  }

  log.appendChild(el);
  syncChatLogVisibility(log);
  log.scrollTop = log.scrollHeight;
  el.getBody = () => body;
  return el;
}

function renderAttachRow(mode = "form") {
  const row = mode === "general" ? generalAttachRow : attachRow;
  const files = mode === "general" ? generalAttachments : pendingAttachments;
  if (!row) return;
  row.innerHTML = "";
  if (mode === "form" && pendingSnippet) {
    const chip = document.createElement("span");
    chip.className = "attach-chip";
    chip.innerHTML = `Snippet <button type="button" data-clear="snippet">×</button>`;
    row.appendChild(chip);
  }
  files.forEach((file, index) => {
    const chip = document.createElement("span");
    chip.className = "attach-chip";
    chip.innerHTML = `${escapeHtml(file.name)} <button type="button" data-file="${index}">×</button>`;
    row.appendChild(chip);
  });
  row.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.clear === "snippet") pendingSnippet = "";
      if (btn.dataset.file != null) {
        files.splice(Number(btn.dataset.file), 1);
      }
      renderAttachRow(mode);
    });
  });
}

function stepContextText() {
  const lines = [];
  for (const [id, step] of stepIndex.entries()) {
    const status = stepStatuses.get(id) || "pending";
    lines.push(`- [${status}] ${step.label || id}`);
  }
  return lines.join("\n");
}

async function sendChat(mode = "form") {
  const isGeneral = mode === "general";
  const input = isGeneral ? generalChatInput : chatInput;
  const log = isGeneral ? generalChatLog : chatLog;
  const sendBtn = isGeneral ? generalBtnSend : btnSend;
  const history = isGeneral ? generalChatHistory : chatHistory;
  const files = isGeneral ? generalAttachments : pendingAttachments;
  const prompt = (input?.value || "").trim();
  const snippet = isGeneral ? "" : pendingSnippet;
  if (!prompt && !snippet && !files.length) return;

  const settings = await window.coact.getOpenAiSettings();
  if (!settings?.hasKey) {
    if (isGeneral) showNav("ai");
    else openGenAi();
    openSettings();
    return;
  }

  if (isGeneral) showNav("ai");
  else openGenAi();
  window.liveTrackVoice?.unlockAudio?.();

  const userLabel = [
    prompt || "(attachment)",
    snippet ? "[snippet]" : "",
    files.length ? `[${files.length} file(s)]` : "",
  ]
    .filter(Boolean)
    .join(" ");

  appendChatBubble("user", userLabel, log);
  history.push({
    role: "user",
    content: prompt || "Please review the attached context.",
  });

  const attachments = files.map((f) => f.path);
  if (isGeneral) generalAttachments = [];
  else {
    pendingAttachments = [];
    pendingSnippet = "";
  }
  renderAttachRow(mode);
  if (input) input.value = "";

  const chatId = `chat-${Date.now()}`;
  activeChatId = chatId;
  streamingEl = appendChatBubble("assistant", "", log);
  streamingEl.classList.add("streaming");
  if (sendBtn) sendBtn.disabled = true;
  window.liveTrackVoice?.stopListening?.();
  window.liveTrackVoice?.stopSpeaking?.();

  const focusCardId = isGeneral
    ? null
    : activeCardId || aiFocusCard?.id || null;
  const focusHint =
    !isGeneral && aiFocusCard
      ? `Context: ${aiFocusCard.title} (${aiFocusCard.id})`
      : "";
  const stepContext = isGeneral
    ? ""
    : [focusHint, stepContextText()].filter(Boolean).join("\n");

  const result = await window.coact.chatPrompt({
    chatId,
    cardId: focusCardId,
    prompt,
    snippet,
    attachments,
    messages: history.slice(0, -1),
    stepContext,
    autoApplyTools: !isGeneral,
    mode: isGeneral ? "general" : "form",
  });

  if (sendBtn) sendBtn.disabled = false;
  if (streamingEl) streamingEl.classList.remove("streaming");

  if (!result?.ok) {
    const err = result?.error || "Chat failed";
    if (streamingEl) {
      const body = streamingEl.getBody?.() || streamingEl;
      body.textContent = err;
      streamingEl.classList.add("error");
    }
    activeChatId = null;
    streamingEl = null;
    return;
  }

  if (streamingEl) {
    const body = streamingEl.getBody?.() || streamingEl;
    body.textContent = result.text || "";
  }
  history.push({ role: "assistant", content: result.text || "" });
  activeChatId = null;
  streamingEl = null;
  if (log) log.scrollTop = log.scrollHeight;
}

function runQueueCardSnip() {
  return window.coact.captureRegionSnip();
}

async function captureSnippet(mode = "form") {
  const isGeneral = mode === "general";
  if (!isGeneral && runNote) {
    runNote.className = "run-note";
    runNote.textContent = "Select a region…";
  }
  const res = await runQueueCardSnip();
  if (res?.cancelled) {
    if (!isGeneral && runNote) {
      runNote.className = "run-note";
      runNote.textContent = "";
    }
    return;
  }
  if (!res?.ok || !res.path) {
    if (!isGeneral && runNote) {
      runNote.className = "run-note error";
      runNote.textContent = res?.error || "Snip failed";
    }
    return;
  }
  const file = { path: res.path, name: "Snip.png" };
  if (isGeneral) {
    generalAttachments.push(file);
    renderAttachRow("general");
    showNav("ai");
    return;
  }
  pendingAttachments.push(file);
  renderAttachRow("form");
  openGenAi();
  if (runNote) {
    runNote.className = "run-note";
    runNote.textContent = "Snip ready";
    setTimeout(() => {
      if (runNote.textContent === "Snip ready") runNote.textContent = "";
    }, 1500);
  }
}

async function attachErrorFiles(mode = "form") {
  const res = await window.coact.pickErrorFiles();
  if (!res?.ok || !res.files?.length) return;
  if (mode === "general") {
    generalAttachments.push(...res.files);
    renderAttachRow("general");
    return;
  }
  pendingAttachments.push(...res.files);
  renderAttachRow("form");
}

async function openSettings() {
  const s = await window.coact.getOpenAiSettings();
  openaiModelInput.value = s?.model || "gpt-4o-mini";
  openaiKeyInput.value = "";
  openaiKeyInput.placeholder = s?.hasKey ? "•••••••• (saved — paste to replace)" : "API key / bearer token";
  if (openaiChatUrlInput) {
    openaiChatUrlInput.value = s?.chatCompletionsUrl || "https://api.openai.com/v1/chat/completions";
  }
  if (openaiSpeechUrlInput) {
    openaiSpeechUrlInput.value = s?.speechUrl || "https://api.openai.com/v1/audio/speech";
  }
  if (openaiSttUrlInput) {
    openaiSttUrlInput.value = s?.transcriptionsUrl || "https://api.openai.com/v1/audio/transcriptions";
  }
  if (executionsRootInput) {
    executionsRootInput.value = s?.executionsRootOverride || s?.executionsRoot || "";
    executionsRootInput.placeholder = s?.executionsRoot || "Default: <project>/executions";
  }
  if (jiraBaseUrlInput) jiraBaseUrlInput.value = s?.jiraBaseUrl || "";
  if (jiraEmailInput) jiraEmailInput.value = s?.jiraEmail || "";
  if (jiraTokenInput) {
    jiraTokenInput.value = "";
    jiraTokenInput.placeholder = s?.jiraHasToken
      ? "Token saved"
      : "ATATT… paste API token, not your password";
  }
  if (jiraProjectKeyInput)
    jiraProjectKeyInput.value = s?.jiraProjectKey || "LIVEACT";
  if (outlookTenantInput)
    outlookTenantInput.value = normalizeOutlookTenantUi(
      s?.outlookTenantId || OUTLOOK_DEFAULT_TENANT,
    );
  if (outlookClientIdInput)
    outlookClientIdInput.value = s?.outlookClientId || OUTLOOK_DEFAULT_CLIENT;
  if (outlookEmailInput) {
    outlookEmailInput.value =
      s?.outlookPreferredEmail ||
      (String(s?.outlookAccountName || "").includes("@")
        ? s.outlookAccountName
        : "") ||
      "";
  }
  if (momGreetingInput) momGreetingInput.value = s?.momGreetingName || "";
  window.liveTrackVoice?.applySettings?.(s);
  syncOutlookAccountKindFromTenant();
  setOutlookStatus(
    s?.outlookConnected
      ? `Outlook connected${s.outlookAccountName ? ` as ${s.outlookAccountName}` : ""}`
      : "",
    s?.outlookConnected ? "ok" : "",
  );
  setJiraTestStatus("", "");
  const pathEl = document.getElementById("extInstallPath");
  try {
    const info = await window.coact.getExtensionInstallInfo?.();
    if (pathEl && info?.userPath) {
      pathEl.textContent = info.installed
        ? `Ready to load: ${info.userPath}`
        : `Will install to: ${info.userPath}`;
    }
  } catch {
    if (pathEl) pathEl.textContent = "";
  }
  settingsModal.classList.remove("hidden");
}

function closeSettings() {
  settingsModal.classList.add("hidden");
}

function setJiraTestStatus(text, kind) {
  if (!jiraTestStatus) return;
  jiraTestStatus.textContent = text || "";
  jiraTestStatus.classList.toggle("ok", kind === "ok");
  jiraTestStatus.classList.toggle("err", kind === "err");
}

function sanitizeJiraSecretInput(value) {
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
  return s
    .replace(/^Bearer\s+/i, "")
    .replace(/[\r\n]+/g, "")
    .trim();
}

function isBlankJiraTokenInput(value) {
  const s = sanitizeJiraSecretInput(value);
  if (!s) return true;
  if (/^[•●∙·*xX]+$/.test(s)) return true;
  if (/^token saved$/i.test(s)) return true;
  if (/^atlassian api token$/i.test(s)) return true;
  if (/saved/i.test(s) && /paste to replace/i.test(s)) return true;
  if (/paste (an? )?api token/i.test(s)) return true;
  return false;
}

function readJiraTokenForSave() {
  const raw = jiraTokenInput?.value;
  const placeholder = jiraTokenInput?.placeholder || "";
  const tok = sanitizeJiraSecretInput(raw);
  if (!tok) return "";
  if (tok === sanitizeJiraSecretInput(placeholder)) return "";
  if (isBlankJiraTokenInput(tok)) return "";
  return tok;
}

function markJiraTokenSaved() {
  if (!jiraTokenInput) return;
  jiraTokenInput.value = "";
  jiraTokenInput.placeholder = "Token saved";
}

function collectJiraSettingsPayload(_opts = {}) {
  const payload = {};
  if (jiraBaseUrlInput) payload.jiraBaseUrl = jiraBaseUrlInput.value.trim();
  if (jiraEmailInput)
    payload.jiraEmail = sanitizeJiraSecretInput(jiraEmailInput.value);
  const jiraTok = readJiraTokenForSave();
  if (jiraTok) payload.jiraApiToken = jiraTok;
  // Advanced Jira fields (JQL / stale / status map / card key) were removed from Settings UI.
  // Omit them here so saveSettings keeps existing disk values.
  if (jiraProjectKeyInput)
    payload.jiraProjectKey = jiraProjectKeyInput.value.trim() || "LIVEACT";
  if (outlookTenantInput)
    payload.outlookTenantId = normalizeOutlookTenantUi(
      outlookTenantInput.value.trim() || OUTLOOK_DEFAULT_TENANT,
    );
  if (outlookClientIdInput)
    payload.outlookClientId =
      outlookClientIdInput.value.trim() || OUTLOOK_DEFAULT_CLIENT;
  if (outlookEmailInput)
    payload.outlookPreferredEmail = outlookEmailInput.value.trim();
  if (momGreetingInput) payload.momGreetingName = momGreetingInput.value.trim();
  const settingsVoiceSelect = document.getElementById("settingsVoiceSelect");
  const settingsVoiceRate = document.getElementById("settingsVoiceRate");
  const settingsVoicePitch = document.getElementById("settingsVoicePitch");
  if (settingsVoiceSelect) payload.voiceName = settingsVoiceSelect.value || "";
  if (settingsVoiceRate)
    payload.voiceRate = Number(settingsVoiceRate.value) || 0.85;
  if (settingsVoicePitch)
    payload.voicePitch = Number(settingsVoicePitch.value) || 1;
  return payload;
}

function showBrowserRequiredModal() {
  browserRequiredModal.classList.remove("hidden");
  btnBrowserRequiredClose.focus();
}

function closeBrowserRequiredModal() {
  browserRequiredModal.classList.add("hidden");
  btnStart.focus();
}

window.coact.onExtensionStatus((status) => {
  const nowConnected = Boolean(status?.connected);
  setExtensionStatus(status);

  if (Object.prototype.hasOwnProperty.call(status || {}, "tabUrl")) {
    const nextUrl = status.tabUrl || null;
    const nextTitle = status.tabTitle || null;
    const activated = Boolean(status.activated);
    // Explicit null = non-injectable tab (new tab, chrome://) — clear so sync returns to queue.
    // Connection events omit tabUrl entirely (handled by hasOwnProperty above).
    // Tab/window activation must re-run auto-pick even when the URL did not change
    // (e.g. user pressed ← Queue, then focused the same form again).
    if (nextUrl !== activeTabUrl || nextTitle !== activeTabTitle || activated) {
      if (activeNav === "live" && (nextUrl !== activeTabUrl || activated))
        suppressAutoOpen = false;
      activeTabUrl = nextUrl;
      activeTabTitle = nextTitle;
      if (activeNav === "live") scheduleSyncQueueToActiveTab(activated);
    }
  }

  // Re-attach watch after reconnect or client swap (SW restart / long idle)
  if (nowConnected && activeCardId) {
    const clientChanged =
      Boolean(status?.clientId) && status.clientId !== lastExtensionClientId;
    if (!wasExtensionConnected || clientChanged || status?.reconnected) {
      window.coact.watchCard(activeCardId);
    }
  }
  if (status?.clientId) lastExtensionClientId = status.clientId;
  if (!nowConnected) lastExtensionClientId = null;
  wasExtensionConnected = nowConnected;
});

function renderQueue() {
  const matchedIds = matchingCardIds();
  queueList.innerHTML = "";
  if (!cards.length) {
    queueHeading.textContent = "Queue Cards";
    queueCount.textContent = "0";
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No quests yet. Refresh after cases are added.";
    queueList.appendChild(empty);
    return;
  }

  queueHeading.textContent = "Queue Cards";
  if (queueSearch) queueSearch.placeholder = "Search tasks…";
  const shown = cards
    .filter((card) => cardMatchesSearch(card, queueSearchQuery))
    .sort((a, b) => {
      const aDone = a.status === "done" ? 1 : 0;
      const bDone = b.status === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  queueCount.textContent = String(shown.length);

  if (queueSearchQuery.trim() && !shown.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No tasks match that search.";
    queueList.appendChild(empty);
    return;
  }

  if (!shown.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No tasks match that search.";
    queueList.appendChild(empty);
    return;
  }

  for (const card of shown) {
    const row = document.createElement("div");
    const statusLabel =
      card.status === "done" ? "done" : card.status === "incomplete" ? "incomplete" : "queued";
    row.className =
      "card" +
      (card.status === "done" ? " done" : "") +
      (card.status === "incomplete" ? " incomplete" : "");
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    if (matchedIds.has(card.id)) row.classList.add("pinned-match");
    const stepCount = (card.steps && card.steps.length) || DUMMY_STEPS.length;
    row.innerHTML = `
      <div class="card-head">
        <h3>${escapeHtml(card.title)}</h3>
      </div>
      <div class="meta">
        <span>${stepCount} steps</span>
        <span>${escapeHtml(statusLabel)}</span>
      </div>
    `;
    const openQuest = () => {
      suppressAutoOpen = false;
      openCard(card.id);
    };
    row.addEventListener("click", openQuest);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openQuest();
      }
    });
    queueList.appendChild(row);
  }
}

function setRunControls(state) {
  runState = state;
  const idle = state === "idle";
  const running = state === "running";
  const paused = state === "paused";

  if (!idle && agentPreviewActive) cancelAgentPreview();

  btnStart.disabled = !idle || agentPreviewActive;
  if (btnApproveAgent) btnApproveAgent.disabled = !idle;
  if (btnCancelAgent) btnCancelAgent.disabled = !idle;
  if (btnApproveAgentModal) btnApproveAgentModal.disabled = !idle;
  if (btnCancelAgentModal) btnCancelAgentModal.disabled = false;
  if (btnCloseAgentModal) btnCloseAgentModal.disabled = false;
  btnPause.disabled = !running;
  btnResume.disabled = !paused;
  btnCancel.disabled = idle;
  btnStop.disabled = idle;
}

function closeMoreMenu() {
  moreDropdown.classList.add("hidden");
  btnMore.setAttribute("aria-expanded", "false");
}

function toggleMoreMenu() {
  const open = moreDropdown.classList.contains("hidden");
  moreDropdown.classList.toggle("hidden", !open);
  btnMore.setAttribute("aria-expanded", open ? "true" : "false");
}

async function clearFormFields() {
  if (!activeCardId) {
    runNote.className = "run-note error";
    runNote.textContent = "Open a quest first.";
    return;
  }
  closeMoreMenu();
  clearStuckCoach();
  coachEpisode.clear();
  cardProgress.delete(activeCardId);

  const cleared = [...stepIndex.values()].map((step) => ({
    ...step,
    status: "pending",
  }));
  renderSteps(cleared);

  runNote.className = "run-note";
  runNote.textContent = "Clearing fields…";

  try {
    const res = await window.coact.watchCard(activeCardId, {
      resetProgress: true,
      clearFields: true,
    });
    if (!res?.ok) {
      runNote.className = "run-note error";
      const err = String(res?.error || "");
      runNote.textContent =
        err === "extension_offline" || err === "browser_unavailable"
          ? "Could not clear — extension offline. Reconnect, then try again."
          : err === "pdf_clear_failed" || err === "pdf_missing"
            ? "Could not clear the PDF. Check the file is still in the quest folder."
            : err
              ? `Could not clear — ${err}`
              : "Could not clear — reconnect the extension.";
      return;
    }
    runNote.className = "run-note";
    runNote.textContent = res?.mode === "pdf" ? "PDF cleared — opened in Chrome" : "Fields cleared";
    setTimeout(() => {
      if (
        runNote.textContent === "Fields cleared" ||
        runNote.textContent === "PDF cleared — opened in Chrome"
      ) {
        runNote.textContent = "";
      }
    }, 2000);
  } catch (err) {
    runNote.className = "run-note error";
    runNote.textContent = err?.message || "Clear fields failed.";
  }
}

async function refreshStepTracking() {
  if (!activeCardId) return;

  // Keep current greens while the extension re-scans (force-emits status)
  if (stepStatuses.size) saveCardProgress(activeCardId);

  const res = await window.coact.watchCard(activeCardId, { resetProgress: false });
  if (!res?.ok) {
    runNote.className = "run-note error";
    const err = String(res?.error || res?.reason || "");
    runNote.textContent =
      err.includes("offline") || err.includes("unavailable")
        ? "Refresh failed — Chrome extension not connected. Reload LiveTrack Form Agent 0.1.38, then click the form tab."
        : "Refresh failed — click the form tab (not chrome://extensions), then press Refresh.";
    return;
  }

  if (res.steps?.length) {
    const merged = restoreCardProgress(activeCardId, res.steps);
    renderSteps(merged);
  }

  runNote.className = "run-note";
  runNote.textContent = "Re-scanning…";
  setTimeout(() => {
    if (runNote.textContent === "Re-scanning…") {
      runNote.textContent = "";
    }
  }, 1200);
}

function openCard(cardId) {
  const card = cards.find((c) => c.id === cardId);
  if (!card) return;
  // Unlock audio in the same user-gesture turn as the card click (autoplay)
  guideAudioReady = true;
  try {
    window.liveTrackVoice?.unlockAudio?.();
  } catch {
    /* ignore */
  }
  showQuest(card);
}

async function startFilling(options = {}) {
  if (!activeCardId || runState !== "idle") return;

  aiRepairAttemptedForRun = false;
  // Plain Start (not Agent Approve) must not inherit a prior agent-approved gate skip
  if (!options?.agentApproved) agentApprovedForRun = false;
  runNote.className = "run-note";
  runNote.textContent = "";
  setRunControls("running");
  saveCardProgress(activeCardId);
  lastGuideSpeakKey = "";
  guideAudioReady = true;
  if (activeCardId && !isVoiceCoachOn(activeCardId)) {
    // Keep coaching on unless user already stopped it on this card
    setVoiceCoachOn(activeCardId, true);
  }
  try {
    await window.liveTrackVoice?.unlockAudio?.();
  } catch {
    /* ignore */
  }
  if (isVoiceCoachOn(activeCardId)) {
    const first = currentGuideStep();
    if (first?.stepId) {
      speakGuideForStep(first.stepId, { kind: "first", force: true });
    }
  }

  // Resume from first incomplete step (greens = already done)
  const stepIds = [...stepIndex.keys()];
  let startIndex = 0;
  const completedStepIds = [];
  for (let i = 0; i < stepIds.length; i++) {
    const st = stepStatuses.get(stepIds[i]);
    if (st === "done" || st === "success") {
      completedStepIds.push(stepIds[i]);
      continue;
    }
    startIndex = i;
    break;
  }
  if (completedStepIds.length === stepIds.length && stepIds.length > 0) {
    startIndex = stepIds.length;
  }

  if (startIndex >= stepIds.length && stepIds.length > 0) {
    runNote.className = "run-note success";
    runNote.textContent = "All steps already done";
    agentApprovedForRun = false;
    setRunControls("idle");
    return;
  }

  const dataOverrides =
    options?.dataOverrides && typeof options.dataOverrides === "object"
      ? options.dataOverrides
      : undefined;
  const agentApprovedValues =
    options?.agentApprovedValues && typeof options.agentApprovedValues === "object"
      ? options.agentApprovedValues
      : undefined;
  const agentApproved = Boolean(
    options?.agentApproved ||
      (dataOverrides && Object.keys(dataOverrides).length) ||
      (agentApprovedValues && Object.keys(agentApprovedValues).length)
  );

  const result = await window.coact.runCard(activeCardId, {
    startIndex,
    completedStepIds,
    ...(dataOverrides ? { dataOverrides } : {}),
    ...(agentApprovedValues ? { agentApprovedValues } : {}),
    agentApproved,
  });
  if (!result.ok) {
    agentApprovedForRun = false;
    if (result.error === "extension_offline" || result.error === "browser_unavailable") {
      showBrowserRequiredModal();
      setRunControls("idle");
      return;
    }
    runNote.className = "run-note error";
    const messages = {
      extension_offline: "Connect the Chrome extension, then try again.",
      data_missing: "This case is not ready yet.",
      not_found: "This case is no longer in the queue.",
      sop_missing: "This workflow is unavailable.",
    };
    runNote.textContent = messages[result.error] || "Could not start.";
    setRunControls("idle");
    return;
  }

  // Keep existing greens — do not wipe tracking to all pending
  if (startIndex > 0) {
    runNote.className = "run-note";
    runNote.textContent = `Resuming from step ${startIndex + 1}…`;
  } else {
    runNote.className = "run-note";
    runNote.textContent = "";
  }
  setRunControls("running");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Escape AI briefing text, then turn **bold** into real <strong> (Desk Explain). */
function formatDeskBriefingHtml(text) {
  return escapeHtml(String(text || "")).replace(
    /\*\*(.+?)\*\*/g,
    "<strong>$1</strong>",
  );
}

function syncFilterButton() {
  btnFilterQueue?.classList.toggle("active", queueFilterOpen);
  btnFilterQueue?.setAttribute("aria-expanded", queueFilterOpen ? "true" : "false");
  queueSearchWrap?.classList.toggle("hidden", !queueFilterOpen);
  if (queueFilterOpen) queueSearch?.focus();
}

function toggleQueueFilter() {
  queueFilterOpen = !queueFilterOpen;
  if (!queueFilterOpen) {
    queueSearchQuery = "";
    if (queueSearch) queueSearch.value = "";
  }
  syncFilterButton();
  renderQueue();
}

function takeOver() {
  if (runState === "idle") return;
  window.coact.controlRun("cancel");
  setRunControls("idle");
  closeMoreMenu();
  stopGuideVoice({ silent: true });
  runNote.className = "run-note";
  runNote.textContent = "";
}

btnBack.addEventListener("click", async () => {
  const wasRunning = runState !== "idle";
  if (wasRunning) window.coact.controlRun("cancel");
  try {
    await handleBackToQueueBeforeComplete({ wasRunning });
  } catch {
    /* ignore */
  }
  window.coact.watchCard(null);
  closeMoreMenu();
  suppressAutoOpen = true;
  autoPinnedCardId = null;
  stopGuideVoice({ silent: true });
  // skipSave: handleBack already saved or reset progress
  showQueue({ skipSave: true });
});

btnStart.addEventListener("click", () => {
  closeMoreMenu();
  showAgentPreview();
});
btnApproveAgent?.addEventListener("click", () => {
  closeMoreMenu();
  approveAgentAndFill();
});
btnCancelAgent?.addEventListener("click", () => {
  closeMoreMenu();
  cancelAgentPreview();
});
btnApproveAgentModal?.addEventListener("click", () => {
  closeMoreMenu();
  approveAgentAndFill();
});
btnCancelAgentModal?.addEventListener("click", () => {
  closeMoreMenu();
  cancelAgentPreview();
});
btnCloseAgentModal?.addEventListener("click", () => {
  closeMoreMenu();
  cancelAgentPreview();
});
btnPause.addEventListener("click", () => {
  if (runState !== "running") return;
  window.coact.controlRun("pause");
  setRunControls("paused");
  closeMoreMenu();
  stopGuideVoice({ silent: true });
  runNote.className = "run-note";
  runNote.textContent = "Paused";
});
btnResume.addEventListener("click", () => {
  if (runState !== "paused") return;
  window.coact.controlRun("resume");
  setRunControls("running");
  closeMoreMenu();
  runNote.className = "run-note";
  runNote.textContent = "";
  if (isVoiceCoachOn(activeCardId)) {
    lastGuideSpeakKey = "";
    const cur = currentGuideStep();
    if (cur?.stepId)
      speakGuideForStep(cur.stepId, { kind: "resume", force: true });
  }
});
btnVoiceGuide?.addEventListener("click", () => {
  toggleVoiceGuide(activeCardId);
});
btnCancel.addEventListener("click", takeOver);
btnStop.addEventListener("click", takeOver);
btnRefresh.addEventListener("click", () => {
  closeMoreMenu();
  refreshStepTracking();
});
btnClearFields?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  clearFormFields();
});
btnRefreshQueue.addEventListener("click", async () => {
  const data = await window.coact.refreshQueue();
  applyQueuePayload(data);
  showQueue();
});
window.coact.onQueueUpdated?.((data) => {
  applyQueuePayload(data);
  const openId = activeCardId;
  if (openId) {
    const card = cards.find((c) => c.id === openId);
    if (!card) {
      showQueue();
    } else if (data?.jiraSync) {
      // Background Jira status sync — update chrome only, no full quest remount
      if (card.status === "done") {
        if (runNote) {
          runNote.className = "run-note success";
          runNote.textContent = "Marked done from Jira";
        }
        if (questMeta) questMeta.textContent = "Completed";
        setRunControls("idle");
      } else if (questMeta && questMeta.textContent === "Completed") {
        questMeta.textContent =
          autoPinnedCardId === card.id ? "Pinned to this browser tab" : "Ready";
      }
      renderQueue();
    } else {
      // Drop cached progress chrome so mandatory / step edits from studio show immediately
      cardProgress.delete(openId);
      // Stay on Desk/Jira/AI/Dash — remounting would switch to Live and auto-record
      if (activeNav !== "live") {
        renderQueue();
      } else {
        showQuest(card);
        // Re-bind watcher so Chrome extension gets fresh SOP steps
        window.coact.watchCard?.(openId).catch(() => {});
        if (runNote) {
          runNote.className = "run-note success";
          const mand = (card.steps || []).filter((s) => s.mandatory).length;
          runNote.textContent =
            mand > 0
              ? `Updated from Queue studio · ${mand} mandatory step${mand === 1 ? "" : "s"}`
              : "Updated from Queue studio";
        }
      }
    }
  } else {
    renderQueue();
  }
  if (tagline && !openId) {
    const n = (data.queue || []).length;
    const all = data.allCardCount;
    tagline.textContent =
      all != null && all > n
        ? `Updated · ${n} visible (${all} on disk)`
        : data?.jiraSync
          ? `Jira sync · ${n} card${n === 1 ? "" : "s"}`
          : `Updated · ${n} card${n === 1 ? "" : "s"}`;
  }
});
btnFilterQueue?.addEventListener("click", () => {
  toggleQueueFilter();
});
btnMore.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMoreMenu();
});
document.addEventListener("click", (e) => {
  if (!moreMenu.contains(e.target)) closeMoreMenu();
});

btnGenAi?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeMoreMenu();
  const card = activeCardId ? cards.find((c) => c.id === activeCardId) : null;
  if (!genaiShell?.classList.contains("hidden")) {
    closeGenAi();
    return;
  }
  if (card) {
    openCardAi(card);
    return;
  }
  if (runNote) {
    runNote.className = "run-note";
    runNote.textContent =
      "Open a queue card to fill a form. Use Ask LiveTrack in the sidebar for general questions.";
  }
});
btnCloseGenAi?.addEventListener("click", () => closeGenAi());

btnSend.addEventListener("click", () => sendChat("form"));
btnSnippet?.addEventListener("click", () => captureSnippet("form"));
btnAttach.addEventListener("click", () => attachErrorFiles("form"));
generalBtnSend?.addEventListener("click", () => sendChat("general"));
generalBtnSnippet?.addEventListener("click", () => captureSnippet("general"));
generalBtnAttach?.addEventListener("click", () => attachErrorFiles("general"));
navLive?.addEventListener("click", () => {
  showNav("live");
});
navJira?.addEventListener("click", () => showNav("jira"));
navMom?.addEventListener("click", () => showNav("mom"));
navActions?.addEventListener("click", () => showNav("actions"));
navAi?.addEventListener("click", () => showNav("ai"));
navDesk?.addEventListener("click", () => showNav("desk"));
navFeedback?.addEventListener("click", () => showNav("feedback"));
navAnalytics?.addEventListener("click", () => showNav("analytics"));
navDashboard?.addEventListener("click", () => showNav("dashboard"));
document.getElementById("paneAnalytics")?.addEventListener("click", (event) => {
  const refresh = event.target.closest("#btnAnRefresh");
  if (refresh) {
    event.preventDefault();
    refreshAnalytics();
    return;
  }
  const btn = event.target.closest(".an-grain-btn");
  if (!btn) return;
  event.preventDefault();
  anGrain = btn.getAttribute("data-grain") || "month";
  document
    .querySelectorAll(".an-grain-btn")
    .forEach((b) => b.classList.toggle("active", b === btn));
  refreshAnalytics();
});

document.getElementById("inboxCard")?.addEventListener("input", () => {
  document.getElementById("inboxCard").dataset.touched = "1";
});
document.getElementById("inboxLob")?.addEventListener("input", () => {
  document.getElementById("inboxLob").dataset.touched = "1";
});
document.getElementById("btnInboxClearSnip")?.addEventListener("click", () => {
  clearInboxSnip();
  setInboxStatus("Screenshot cleared.");
});
document.getElementById("btnInboxSnip")?.addEventListener("click", async () => {
  const preview = document.getElementById("inboxSnipPreview");
  const clearBtn = document.getElementById("btnInboxClearSnip");
  setInboxStatus("Drag a box, then release. Esc cancels.");
  try {
    const res = await runQueueCardSnip();
    if (res?.cancelled) {
      setInboxStatus("Capture cancelled.");
      return;
    }
    if (!res?.ok || !res.path) {
      clearInboxSnip();
      setInboxStatus(res?.error || "Snip failed");
      return;
    }
    inboxSnipPath = res.path;
    if (preview) {
      preview.src = res.dataUrl || "";
      preview.classList.toggle("hidden", !res.dataUrl);
    }
    if (clearBtn) clearBtn.hidden = false;
    setInboxStatus("Screenshot attached.");
  } catch (err) {
    setInboxStatus(err?.message || "Snip failed");
  }
});
document
  .getElementById("btnInboxSubmit")
  ?.addEventListener("click", async () => {
    const title = document.getElementById("inboxTitle")?.value.trim() || "";
    const body = document.getElementById("inboxBody")?.value.trim() || "";
    const category = document.getElementById("inboxCategory")?.value || "other";
    const cardId = document.getElementById("inboxCard")?.value.trim() || "";
    const lob = document.getElementById("inboxLob")?.value.trim() || "";
    if (!title) {
      setInboxStatus("Add a title.");
      document.getElementById("inboxTitle")?.focus();
      return;
    }
    const btn = document.getElementById("btnInboxSubmit");
    if (btn) btn.disabled = true;
    setInboxStatus("Sending…");
    try {
      const res = await window.coact.inboxSubmit({
        title,
        body,
        category,
        cardId,
        lob,
        screenshotPath: inboxSnipPath || "",
      });
      if (!res?.ok) {
        setInboxStatus(res?.error || "Send failed");
        return;
      }
      const titleEl = document.getElementById("inboxTitle");
      const bodyEl = document.getElementById("inboxBody");
      if (titleEl) titleEl.value = "";
      if (bodyEl) bodyEl.value = "";
      clearInboxSnip();
      const cardInput = document.getElementById("inboxCard");
      const lobInput = document.getElementById("inboxLob");
      if (cardInput) delete cardInput.dataset.touched;
      if (lobInput) delete lobInput.dataset.touched;
      fillInboxContext();
      setInboxStatus("Sent to SMEs.");
      await refreshInboxList();
    } catch (err) {
      setInboxStatus(err?.message || "Send failed");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
document.getElementById("btnActionsAdd")?.addEventListener("click", () => {
  submitActionsNote();
});
document.getElementById("actionsTitle")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitActionsNote();
  }
});
document.getElementById("actionsShowDone")?.addEventListener("change", () => {
  refreshActionsList();
});
document
  .getElementById("actionsList")
  ?.addEventListener("click", async (event) => {
    const btn = event.target.closest(".actions-toggle");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (!id) return;
    const done = btn.getAttribute("data-done") === "1";
    btn.disabled = true;
    try {
      const res = done
        ? await window.coact.actionsReopen?.({ id })
        : await window.coact.actionsDone?.({ id });
      if (!res?.ok) {
        setActionsStatus(res?.error || "Update failed", "error");
        return;
      }
      setActionsStatus(done ? "Reopened." : "Marked done.");
      await refreshActionsList();
    } catch (err) {
      setActionsStatus(err?.message || "Update failed", "error");
    } finally {
      btn.disabled = false;
    }
  });
btnDashRefresh?.addEventListener("click", () => refreshDashboard());
btnCaptureLiveMin?.addEventListener("click", () => {
  if (captureRecording || capturePausedForNav) {
    captureLiveMinimized = !captureLiveMinimized;
    captureLivePanel?.classList.toggle("minimized", captureLiveMinimized);
    syncCaptureLiveMinButton();
    return;
  }
  clearLiveRecordingCache();
});
captureLiveTicket?.addEventListener("click", () => {
  const ref = captureLiveTicket.textContent;
  if (ref && ref !== "Copied") copyRefNumber(ref, captureLiveTicket);
});
btnRecord?.addEventListener("click", () => {
  if (capturePausedForNav) {
    if (activeNav === "live") setRecordingEnabled(true, { resume: true });
    else setRecordingEnabled(false);
    return;
  }
  setRecordingEnabled(!captureRecording);
});
queueSearch?.addEventListener("input", () => {
  queueSearchQuery = queueSearch.value || "";
  renderQueue();
});
btnSettings.addEventListener("click", () => openSettings());
document
  .getElementById("btnSettingsGeneralToggle")
  ?.addEventListener("click", () =>
    toggleDeskFold("settingsGeneral", "btnSettingsGeneralToggle"),
  );
document
  .getElementById("btnSettingsVoiceToggle")
  ?.addEventListener("click", () =>
    toggleDeskFold("settingsVoice", "btnSettingsVoiceToggle"),
  );
document
  .getElementById("btnSettingsJiraToggle")
  ?.addEventListener("click", () =>
    toggleDeskFold("settingsJira", "btnSettingsJiraToggle"),
  );
document
  .getElementById("btnSettingsOutlookToggle")
  ?.addEventListener("click", () =>
    toggleDeskFold("settingsOutlook", "btnSettingsOutlookToggle"),
  );
function wireWinControls() {
  const onMin = (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.coact?.setTailMode?.(true).catch((err) => console.error(err));
  };
  const onQuit = (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.coact?.quitApp?.().catch((err) => console.error(err));
  };
  // mousedown: frameless drag-region can swallow click
  btnMinimize?.addEventListener("mousedown", onMin);
  btnQuit?.addEventListener("mousedown", onQuit);
}
wireWinControls();
btnSettingsCancel.addEventListener("click", () => closeSettings());
btnBrowserRequiredClose.addEventListener("click", closeBrowserRequiredModal);
browserRequiredModal.addEventListener("click", (event) => {
  if (event.target === browserRequiredModal) closeBrowserRequiredModal();
});
btnSettingsSave.addEventListener("click", async () => {
  const apiKey = openaiKeyInput.value.trim();
  const model = openaiModelInput.value.trim() || "gpt-4o-mini";
  const payload = { model };
  if (apiKey) payload.apiKey = apiKey;
  if (openaiChatUrlInput) payload.chatCompletionsUrl = openaiChatUrlInput.value.trim();
  if (openaiSpeechUrlInput) payload.speechUrl = openaiSpeechUrlInput.value.trim();
  if (openaiSttUrlInput) payload.transcriptionsUrl = openaiSttUrlInput.value.trim();
  if (executionsRootInput) {
    payload.executionsRoot = executionsRootInput.value.trim();
  }
  try {
    Object.assign(payload, collectJiraSettingsPayload());
  } catch {
    window.alert("Jira status map must be valid JSON");
    return;
  }
  // Never send an empty/placeholder token — omit the key so disk keeps the stored one.
  if (!payload.jiraApiToken) delete payload.jiraApiToken;
  const res = await window.coact.saveOpenAiSettings(payload);
  if (res?.jiraHasToken || res?.jiraConfigured) markJiraTokenSaved();
  window.liveTrackVoice?.applySettings?.({
    ...(res || {}),
    voiceName: payload.voiceName ?? res?.voiceName,
    voiceRate: payload.voiceRate ?? res?.voiceRate,
    voicePitch: payload.voicePitch ?? res?.voicePitch,
  });
  closeSettings();
  refreshJiraPanel();
  refreshMomPanel();
  if (!res?.hasKey && !res?.jiraConfigured) {
    /* keep quiet — OpenAI key optional when only using Jira */
  }
});
btnMomSpeakTest?.addEventListener("click", async () => {
  if (window.liveTrackVoice?.isSpeaking?.()) {
    window.liveTrackVoice.stopSpeaking();
    return;
  }
  let name = momGreetingInput?.value?.trim() || "";
  if (!name) {
    try {
      const s = await window.coact.getOpenAiSettings?.();
      name = s?.momGreetingName || s?.outlookAccountGivenName || "";
    } catch {
      /* ignore */
    }
  }
  const greeting = name
    ? `Hi ${name}, you have a meeting. Please join.`
    : "Hi, you have a meeting. Please join.";
  if (momStatus) momStatus.textContent = greeting;
  await window.liveTrackVoice?.unlockAudio?.();
  const ok = await window.liveTrackVoice?.speak?.(greeting);
  if (!ok && !window.liveTrackVoice?.isSpeaking?.() && momStatus) {
    momStatus.textContent =
      "Could not speak. Add an OpenAI API key in Settings and check volume.";
  }
});
btnJiraTestConnection?.addEventListener("click", async () => {
  let payload;
  try {
    payload = collectJiraSettingsPayload({ requireStatusMap: false });
  } catch {
    setJiraTestStatus("Could not read Jira settings", "err");
    return;
  }
  if (!payload.jiraApiToken) delete payload.jiraApiToken;
  setJiraTestStatus("Testing…", "");
  if (btnJiraTestConnection) btnJiraTestConnection.disabled = true;
  try {
    const res = await window.coact.jiraTestConnection?.(payload);
    if (res?.ok) {
      if (res.projectKey && jiraProjectKeyInput) {
        jiraProjectKeyInput.value = res.projectKey;
      }
      markJiraTokenSaved();
      const who = res.displayName || "your account";
      const resolved =
        res.projectName && res.projectKey && res.projectName !== res.projectKey
          ? `${res.projectName} → ${res.projectKey}`
          : res.projectKey || "";
      setJiraTestStatus(
        res.message ||
          `Signed in as ${who}. Resolved project ${resolved || "—"}.`,
        "ok",
      );
      return;
    }
    const status = res?.httpStatus ? `${res.httpStatus}: ` : "";
    setJiraTestStatus(
      status + (res?.error || "Could not connect to Jira"),
      "err",
    );
  } catch (err) {
    setJiraTestStatus(err?.message || "Could not connect to Jira", "err");
  } finally {
    if (btnJiraTestConnection) btnJiraTestConnection.disabled = false;
  }
});
btnPickExecutions?.addEventListener("click", async () => {
  const res = await window.coact.pickExecutionsFolder?.();
  if (res?.ok && res.path && executionsRootInput) {
    executionsRootInput.value = res.path;
  }
});

btnJiraRefresh?.addEventListener("click", () => refreshJiraPanel());
document
  .getElementById("btnJiraRecentToggle")
  ?.addEventListener("click", () => {
    const el = document.getElementById("jiraRecent");
    if (!el) return;
    const open = el.classList.contains("collapsed");
    el.classList.toggle("collapsed", !open);
    document
      .getElementById("btnJiraRecentToggle")
      ?.setAttribute("aria-expanded", open ? "true" : "false");
  });
document
  .getElementById("btnJiraMailShot")
  ?.addEventListener("click", async () => {
    const key = document.getElementById("jiraMailIssueSelect")?.value || "";
    const issue = (jiraSnapshot?.issues || []).find((row) => row.key === key);
    if (!issue) {
      window.alert("Pick a Jira story first (or wait for the list to load).");
      return;
    }
    await captureJiraMailScreenshot(issue);
  });
window.coact.onJiraUpdated?.((snap) => {
  renderJiraList(snap);
});
btnMomStart?.addEventListener("click", () => {
  const event = selectedMomEvent();
  const eventId = event?.canStart && event?.id ? event.id : "adhoc";
  startMomRecording(eventId);
});
btnMomStop?.addEventListener("click", () => stopMomAndRefine("manual"));
btnMomStopBar?.addEventListener("click", () => stopMomAndRefine("manual"));
btnMomCancel?.addEventListener("click", () => cancelMomRecording());
btnMomCancelBar?.addEventListener("click", () => cancelMomRecording());
btnMomMeetingsToggle?.addEventListener("click", () =>
  toggleMomFold("meetings"),
);
btnMomLiveToggle?.addEventListener("click", () => toggleMomFold("live"));
btnMomMinutesToggle?.addEventListener("click", () => toggleMomFold("minutes"));
btnMomPastToggle?.addEventListener("click", () => toggleMomFold("past"));
window.coact.onMomUpdated?.((snap) => {
  renderMomPanel(snap);
});
window.coact.onOutlookDeviceCode?.((data) => {
  showMomDeviceHint(data);
  const code = data?.userCode ? ` Code: ${data.userCode}` : "";
  setOutlookStatus(
    `${data?.message || "Enter the code in the browser to connect Outlook."}${code}`,
    "",
  );
  if (momStatus) {
    momStatus.textContent = data?.userCode
      ? `Sign in at Microsoft — enter code ${data.userCode}`
      : data?.message || "Waiting for Microsoft sign-in…";
  }
});
window.coact.onMomAlert?.((data) => {
  if (data?.event?.id) momSelectedEventId = data.event.id;
  const greeting =
    data?.greeting ||
    (data?.kind === "action_overdue"
      ? "Hi, you have an action item due. Please complete it."
      : data?.kind === "soon"
        ? "Hi, you have a meeting in 15 minutes. Please join."
        : "Hi, you have a meeting. Please join.");
  if (data?.kind !== "action_overdue" && momStatus) {
    momStatus.textContent = greeting;
  }
  if (data?.kind !== "action_overdue") {
    renderMomPanel(momSnapshot);
  }
  window.liveTrackVoice?.unlockAudio?.();
  window.liveTrackVoice?.speak?.(greeting);
});
window.coact.onMomShouldStop?.(() => {
  if (window.liveTrackMomRecord?.isRecording?.()) {
    stopMomAndRefine("ended");
  }
});
window.coact.onMomRefined?.((data) => {
  showMomDeviceHint(null);
  momPendingApproval = data?.pendingApproval !== false;
  momEditMode = false;
  showMomMinutes(data?.text, data?.meeting, {
    pendingApproval: momPendingApproval,
  });
});
window.coact.onMomApproved?.((data) => {
  showMomDeviceHint(null);
  momPendingApproval = false;
  momEditMode = false;
  setMomApproveBar(false);
  if (momMinutes && data?.text) {
    momMinutes.value = data.text;
    momMinutes.readOnly = true;
  }
  lastMomUiFp = "";
  if (momStatus) {
    momStatus.textContent =
      data?.actionsImported > 0
        ? `Minutes approved. ${data.actionsImported} action item${
            data.actionsImported === 1 ? "" : "s"
          } saved to Actions.`
        : "Minutes approved and saved for today.";
  }
  refreshActionsBadge();
  if (data?.actionsImported > 0 && activeNav === "actions")
    refreshActionsList();
  renderMomPanel(momSnapshot);
  refreshMomPastList();
});
btnMomApprove?.addEventListener("click", () => approveMomMinutes());
btnMomEditRefine?.addEventListener("click", () => enterMomEditRefine());
btnMomReRefine?.addEventListener("click", () => reRefineMomMinutes());
btnMomCopy?.addEventListener("click", () =>
  copyMomMinutes(
    currentMomMinutesText() || momPastView?.refined || "",
    btnMomCopy,
  ),
);
window.coact.onActionsUpdated?.((data) => {
  updateActionsBadge(data?.pending);
  if (activeNav === "actions") refreshActionsList();
});
btnOutlookConnect?.addEventListener("click", () => connectOutlookFromUi());
outlookAccountKind?.addEventListener("change", () => {
  applyOutlookAccountKind(outlookAccountKind.value, { fillTenant: true });
});
outlookTenantInput?.addEventListener("change", () =>
  syncOutlookAccountKindFromTenant(),
);
btnOutlookDisconnect?.addEventListener("click", async () => {
  window.coact.outlookCancelConnect?.();
  const res = await window.coact.outlookDisconnect?.();
  showMomDeviceHint(null);
  setOutlookStatus(
    res?.ok ? "Outlook disconnected." : res?.error || "Disconnected.",
    "",
  );
  refreshMomPanel();
});

async function installExt(browser) {
  const pathEl = document.getElementById("extInstallPath");
  const hint = document.getElementById("extInstallHint");
  try {
    const res = await window.coact.installBrowserExtension?.(browser);
    if (!res?.ok) {
      if (pathEl) pathEl.textContent = res?.error || "Install failed";
      return;
    }
    if (pathEl) pathEl.textContent = `Load unpacked from: ${res.path}`;
    if (hint) {
      hint.textContent =
        "Developer mode ON → Load unpacked → select Desktop/livetrack app/packages/extension (folder opened).";
    }
  } catch (err) {
    if (pathEl) pathEl.textContent = err?.message || String(err);
  }
}
document.getElementById("btnInstallExtChrome")?.addEventListener("click", () => installExt("chrome"));
document.getElementById("btnInstallExtEdge")?.addEventListener("click", () => installExt("edge"));
chatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat("form");
  }
});
generalChatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat("general");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !browserRequiredModal.classList.contains("hidden")) {
    closeBrowserRequiredModal();
  } else if (e.key === "Escape" && genaiShell && !genaiShell.classList.contains("hidden")) {
    closeGenAi();
  } else if (e.key === "Escape" && activeNav !== "live") {
    showNav("live");
  }
});

window.coact.onChatDelta((data) => {
  if (!data || data.chatId !== activeChatId || !streamingEl) return;
  const body = streamingEl.getBody?.() || streamingEl;
  body.textContent = data.text || "";
  const log =
    streamingEl?.parentElement ||
    (activeNav === "ai" ? generalChatLog : chatLog);
  if (log) log.scrollTop = log.scrollHeight;
});

window.coact.onRequestTail((wantTail) => {
  inTail = Boolean(wantTail);
});

window.coact.onStepUpdate((update) => {
  if (!update?.stepId) {
    if (update.status === "reasoning" || update.status === "needs_repair" || update.reason) {
      if (update.cardId && update.cardId !== activeCardId) return;
      const text = String(update.reason || "");
      if (text) {
        runNote.className = "run-note";
        runNote.textContent = text.length > 72 ? `${text.slice(0, 69)}…` : text;
      }
    }
    return;
  }

  // Soft tip from extension — Approve only when the step is marked mandatory
  if (
    update.status === "mismatch" ||
    update.status === "value_check" ||
    (update.status === "reasoning" && (update.expected || update.suggestedValue))
  ) {
    if (update.cardId && activeCardId && update.cardId !== activeCardId) return;
    const text = String(update.reason || "");
    if (text) {
      runNote.className = "run-note warn";
      runNote.textContent = text.length > 72 ? `${text.slice(0, 69)}…` : text;
    }
    // Soft warn only — never failed/error alert or miss sound for a wrong value
    setStepTone(update.stepId, "running");
    if (update.cardId) applyProgressUpdate(update.cardId, update.stepId, "running");
    const step = stepIndex.get(update.stepId);
    const prior =
      lastCoachMeta?.stepId === update.stepId
        ? String(lastCoachMeta.suggestedValue || "").trim()
        : "";
    const suggested = String(
      update.suggestedValue || update.expected || knownValueForStep(step) || prior || ""
    ).trim();
    const canApply = !agentApprovedForRun && stepCanApprove(step, suggested);
    // After Agent Approve, never re-open per-step mandatory Approve / mismatch coach
    if (agentApprovedForRun) return;
    if (canApply || update.status === "mismatch") {
      const ep = coachEpisode.get(update.stepId) || {};
      ep.holdCoachForApprove = Boolean(canApply);
      ep.shown = true;
      coachEpisode.set(update.stepId, ep);
    }
    showStepCoachPopover(update.stepId, {
      text:
        update.status === "value_check"
          ? text || "Checking value…"
          : canApply
            ? update.reason ||
              text ||
              `Wrong value for “${step?.label || update.stepId}”. Approve to fill “${suggested}”, or keep typing.`
            : update.reason || text || "Fill this field with any value to continue.",
      canApply,
      suggestedValue: canApply ? suggested : "",
      confidence: canApply ? "high" : "low",
      showTakeOver: false,
    });
    return;
  }

  const tone =
    update.status === "running"
      ? "running"
      : update.status === "done"
        ? "success"
        : update.status === "pending"
          ? "plan"
          : update.status === "failed"
            ? "error"
            : null;
  if (!tone) return;

  const mapped =
    tone === "success" ? "done" : tone === "error" ? "failed" : tone === "plan" ? "pending" : tone;

  // Always remember progress for background tabs
  if (update.cardId) applyProgressUpdate(update.cardId, update.stepId, mapped);

  // Only paint the card currently on screen
  if (!activeCardId || (update.cardId && update.cardId !== activeCardId)) return;

  if (update.status === "running") {
    setStepTone(update.stepId, "running");
  } else if (update.status === "done") {
    setStepTone(update.stepId, "success", {
      clearApprove: update.valueMatched === true,
    });
  } else if (update.status === "pending") {
    setStepTone(update.stepId, "plan");
  } else if (update.status === "failed") {
    setStepTone(update.stepId, "error");
    playMissAlert();
    runNote.className = "run-note error";
    runNote.textContent = update.reason
      ? update.reason.length > 72
        ? `${update.reason.slice(0, 69)}…`
        : update.reason
      : "Missed step";
  } else if (update.status === "needs_repair") {
    setStepTone(update.stepId, "running");
    runNote.className = "run-note";
    runNote.textContent = update.reason || "AI repairing…";
  }
});

window.coact.onRunFinished(async (result) => {
  if (result.cardId && activeCardId && result.cardId !== activeCardId) return;

  agentApprovedForRun = false;

  if (
    result.status === "run_failed" &&
    activeCardId &&
    result.cardId === activeCardId &&
    !aiRepairAttemptedForRun
  ) {
    aiRepairAttemptedForRun = true;
    setRunControls("running");
    runNote.className = "run-note";
    runNote.textContent = "AI repairing…";

    const failedLabel = result.failedStepLabel || "";
    let failedStep = null;
    for (const [id, step] of stepIndex.entries()) {
      if (step.label === failedLabel || id === result.stepId) {
        failedStep = step;
        break;
      }
    }
    if (!failedStep) {
      for (const [id, status] of stepStatuses.entries()) {
        if (status === "failed") {
          failedStep = stepIndex.get(id);
          break;
        }
      }
    }

    const repair = await window.coact.repairFailedStep({
      cardId: activeCardId,
      step: failedStep,
      stepId: failedStep?.id,
      error: result.error || result.reason || "",
      stepContext: stepContextText(),
    });

    if (repair?.ok && repair.applied) {
      runNote.className = "run-note";
      runNote.textContent = repair.reason || "AI retry applied — continue or Agent again";
      setRunControls("idle");
      window.coact.watchCard(activeCardId);
      updateTailSummary();
      return;
    }

    setRunControls("idle");
    runNote.className = "run-note error";
    runNote.textContent = failedLabel
      ? `Missed: ${failedLabel} — Take over or Retry tip`
      : "A step was missed — Take over";
    playMissAlert();
    updateTailSummary();
    if (activeCardId && result.cardId === activeCardId) {
      window.coact.watchCard(activeCardId);
    }
    return;
  }

  setRunControls("idle");
  if (result.status === "run_complete") {
    runNote.className = "run-note success";
    runNote.textContent = "Done";
    // Do not set card.status = "done" — that strikes the queue list item.
    // Card "done" is reserved for explicit/Jira completion (persisted in the workbook).
    questMeta.textContent = "Completed";
    aiRepairAttemptedForRun = false;
  } else if (result.status === "run_cancelled") {
    stopGuideVoice({ silent: true });
    runNote.className = "run-note";
    runNote.textContent = "";
    aiRepairAttemptedForRun = false;
  } else {
    stopGuideVoice({ silent: true });
    runNote.className = "run-note error";
    runNote.textContent = result.failedStepLabel
      ? `Missed: ${result.failedStepLabel}`
      : "A step was missed";
    playMissAlert();
  }
  updateTailSummary();
  // Keep tracking edits after Start finishes
  if (activeCardId && result.cardId === activeCardId) {
    window.coact.watchCard(activeCardId);
  }
});

window.coact.getBootstrap().then(async (data) => {
  const boot = data || {};
  loadProgressMetaStore();
  applyQueuePayload(boot);
  captureRecording = false;
  recordStartedManually = false;
  captureRecordingCardId = "";
  capturePausedForNav = false;
  autoRecordArmed = false;
  let startNav = "live";
  try {
    startNav = localStorage.getItem("livetrack.activeNav") || "live";
  } catch {
    startNav = "live";
  }
  showNav("live");
  if (startNav === "live") showQueue();
  if (startNav !== "live") {
    setTimeout(() => showNav(startNav), 50);
  }
  syncDeskTicketButtons();
  setExtensionStatus({ connected: boot.extensionConnected });
  updateRecordButton();
  try {
    await window.coact.setCaptureRecording?.({ action: "stop" });
  } catch {
    /* leftover capture session is optional */
  }
  if (boot.jira) renderJiraList(boot.jira);
  else {
    try {
      const snap = await window.coact.jiraGetSnapshot?.();
      if (snap) renderJiraList(snap);
    } catch {
      /* optional */
    }
  }
  if (boot.mom) renderMomPanel(boot.mom);
  else {
    try {
      const momSnap = await window.coact.momGetSnapshot?.();
      if (momSnap) renderMomPanel(momSnap);
    } catch {
      /* optional */
    }
  }
  refreshActionsBadge();
  pinned = true;
  await window.coact.setAlwaysOnTop(true);
  syncFilterButton();
  // Occasional status nudge — bridge already pulses; avoid 1.5s REQUEST_STATUS thrash
  window.coact.requestTabStatus?.();
  setInterval(() => {
    window.coact.requestTabStatus?.();
  }, 8000);
  appReady = true;
}).catch((err) => {
  console.error("[livetrack] bootstrap", err);
  if (tagline) tagline.textContent = "Could not load queue — try Refresh";
  showQueue();
  appReady = true;
});
