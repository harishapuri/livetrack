const queueList = document.getElementById("queueList");
const queueCount = document.getElementById("queueCount");
const queueHeading = document.getElementById("queueHeading");
const btnBackLob = document.getElementById("btnBackLob");
const stepList = document.getElementById("stepList");
const runNote = document.getElementById("runNote");
const extStatus = document.getElementById("extStatus");
const extStatusText = document.getElementById("extStatusText");
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
const btnRefreshQueue = document.getElementById("btnRefreshQueue");
const btnClearFields = document.getElementById("btnClearFields");
const btnFilterQueue = document.getElementById("btnFilterQueue");
const btnMore = document.getElementById("btnMore");
const moreDropdown = document.getElementById("moreDropdown");
const moreMenu = document.getElementById("moreMenu");
const btnGenAi = document.getElementById("btnGenAi");
const btnCloseGenAi = document.getElementById("btnCloseGenAi");
const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const attachRow = document.getElementById("attachRow");
const btnSend = document.getElementById("btnSend");
const btnSnippet = document.getElementById("btnSnippet");
const btnAttach = document.getElementById("btnAttach");
const genaiPanel = document.getElementById("genaiPanel");
const genaiShell = document.getElementById("genaiShell");
const queueSearch = document.getElementById("queueSearch");
const queueSearchWrap = document.getElementById("queueSearchWrap");
const btnSettings = document.getElementById("btnSettings");
const navLive = document.getElementById("navLive");
const navJira = document.getElementById("navJira");
const navAi = document.getElementById("navAi");
const navDashboard = document.getElementById("navDashboard");
const paneLive = document.getElementById("paneLive");
const paneJira = document.getElementById("paneJira");
const paneAi = document.getElementById("paneAi");
const paneDashboard = document.getElementById("paneDashboard");
const jiraBadge = document.getElementById("jiraBadge");
const jiraList = document.getElementById("jiraList");
const jiraMeta = document.getElementById("jiraMeta");
const btnJiraRefresh = document.getElementById("btnJiraRefresh");
const dashList = document.getElementById("dashList");
const dashMeta = document.getElementById("dashMeta");
const btnDashRefresh = document.getElementById("btnDashRefresh");
const jiraBaseUrlInput = document.getElementById("jiraBaseUrlInput");
const jiraEmailInput = document.getElementById("jiraEmailInput");
const jiraTokenInput = document.getElementById("jiraTokenInput");
const jiraJqlInput = document.getElementById("jiraJqlInput");
const jiraStaleDaysInput = document.getElementById("jiraStaleDaysInput");
const jiraStatusMapInput = document.getElementById("jiraStatusMapInput");
const jiraCardKeyFieldInput = document.getElementById("jiraCardKeyFieldInput");
const jiraRecentList = document.getElementById("jiraRecentList");
const btnMinimize = document.getElementById("btnMinimize");
const btnQuit = document.getElementById("btnQuit");
const settingsModal = document.getElementById("settingsModal");
const openaiKeyInput = document.getElementById("openaiKeyInput");
const openaiModelInput = document.getElementById("openaiModelInput");
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
let pendingAttachments = [];
let queueSearchQuery = "";
let queueFilterOpen = false;
/** null = show LOB folders; string = show cards for that LOB */
let selectedLob = null;
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
/** @type {{ ok?: boolean, issues?: any[], staleCount?: number, error?: string, fetchedAt?: string, configured?: boolean } | null} */
let jiraSnapshot = null;
let lastJiraUiFp = "";

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
/** Queue card focused for Ask liveAct (from card AI button). */
let aiFocusCard = null;
let dashLoading = false;
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

function setExtensionStatus({ connected, bridgeUp, bridgeError }) {
  const online = Boolean(connected);
  let nextText = "Offline";
  if (online) nextText = "Online";
  else if (bridgeError) {
    nextText =
      String(bridgeError).length > 48 ? "Bridge down — port in use?" : String(bridgeError);
  } else if (bridgeUp === false) {
    nextText = "Bridge down";
  }
  if (
    extStatus.classList.contains("online") === online &&
    extStatusText.textContent === nextText
  ) {
    return;
  }
  extStatus.classList.toggle("online", online);
  extStatusText.textContent = nextText;
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
  const card = bestMatchedCard();

  if (card) {
    autoPinnedCardId = card.id;

    // User pressed ← Queue — stay on the list until they activate a browser tab again
    if (suppressAutoOpen) {
      renderQueue();
      return;
    }

    // Already showing this card — do not flicker
    if (activeCardId === card.id && !screenQuest.classList.contains("hidden")) {
      return;
    }

    renderQueue();

    if (runState !== "idle" && activeCardId && activeCardId !== card.id) return;

    openCard(card.id);
    return;
  }

  // No focused browser form (other app, new tab, no match) → main task list
  autoPinnedCardId = null;
  suppressAutoOpen = false;

  // Keep quest open during an active run only
  if (runState !== "idle" && activeCardId && !screenQuest.classList.contains("hidden")) {
    renderQueue();
    return;
  }

  if (screenQuest.classList.contains("hidden") && !activeCardId) {
    renderQueue();
    return;
  }

  showQueue();
}

function matchingCardIds() {
  return new Set(matchedCardsForTab().map((c) => c.id));
}

function scheduleSyncQueueToActiveTab(immediate = false) {
  if (syncTabTimer) clearTimeout(syncTabTimer);
  const delay = immediate ? 0 : 200;
  syncTabTimer = setTimeout(() => {
    syncTabTimer = null;
    syncQueueToActiveTab();
  }, delay);
}

function saveCardProgress(cardId) {
  if (!cardId) return;
  cardProgress.set(cardId, new Map(stepStatuses));
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
}

function applyQueuePayload(data) {
  cards = (data.queue || []).map((card) => ({
    ...card,
    steps:
      card.steps && card.steps.length
        ? card.steps
        : DUMMY_STEPS.map((s) => ({ ...s })),
  }));
}

function playMissAlert() {
  // Sound disabled
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
  if (!li) {
    updateTailSummary();
    noteStepActivity();
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
  if (prev !== status) noteStepActivity();
}

function showQueue() {
  if (activeCardId) saveCardProgress(activeCardId);
  cancelAgentPreview();
  clearStuckCoach();
  coachEpisode.clear();
  agentApprovedForRun = false;
  activeCardId = null;
  if (activeNav !== "live") showNav("live");
  else hideGenAiShell();
  screenQueue.classList.remove("hidden");
  screenQuest.classList.add("hidden");
  tagline.textContent = selectedLob ? selectedLob : "Pick an LOB";
  setRunControls("idle");
  renderQueue();
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
  screenQueue.classList.add("hidden");
  screenQuest.classList.remove("hidden");
  tagline.textContent = autoPinnedCardId === card.id ? "Auto-matched" : "Live steps";
  questTitle.textContent = card.title;
  questMeta.textContent =
    autoPinnedCardId === card.id
      ? "Pinned to this browser tab"
      : card.status === "done"
        ? "Completed"
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

  window.coact.watchCard(card.id).then((res) => {
    if (!res?.ok) return;
    if (res.steps?.length) {
      const merged = restoreCardProgress(card.id, res.steps);
      // Prefer live saved progress over fresh pending from SOP
      renderSteps(merged);
    }
    setRunControls(runState === "idle" ? "idle" : runState);
  });
}

function resetChat() {
  chatHistory = [];
  pendingAttachments = [];
  pendingSnippet = "";
  activeChatId = null;
  streamingEl = null;
  chatLog.innerHTML = "";
  syncChatLogVisibility();
  renderAttachRow();
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

function uniqueLobs() {
  const set = new Set();
  for (const card of cards) {
    set.add(card.lob || "TCOO");
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function lobMatchesSearch(lob, query) {
  if (!query || !String(query).trim()) return true;
  return fuzzyScore(query, lob) > 0;
}

function cardsForLob(lob) {
  return cards.filter((c) => (c.lob || "TCOO") === lob);
}

function showNav(id) {
  const next = ["live", "jira", "ai", "dashboard"].includes(id) ? id : "live";
  const leavingAiNav = activeNav === "ai" && next !== "ai";
  activeNav = next;
  const panes = {
    live: paneLive,
    jira: paneJira,
    ai: paneAi,
    dashboard: paneDashboard,
  };
  const navBtns = {
    live: navLive,
    jira: navJira,
    ai: navAi,
    dashboard: navDashboard,
  };

  // Sidebar AI: open overlay without leaving the current live/quest (or other) context.
  if (next === "ai") {
    for (const [key, btn] of Object.entries(navBtns)) {
      btn?.classList.toggle("active", key === "ai");
    }
    navJira?.setAttribute("aria-expanded", "false");
    navAi?.setAttribute("aria-expanded", "true");
    paneAi?.classList.add("hidden");
    paneAi?.setAttribute("aria-hidden", "true");
    openGenAi();
    if (tagline) tagline.textContent = "Ask liveAct";
    return;
  }

  for (const [key, pane] of Object.entries(panes)) {
    const on = key === next;
    pane?.classList.toggle("hidden", !on);
    pane?.setAttribute("aria-hidden", on ? "false" : "true");
    navBtns[key]?.classList.toggle("active", on);
  }
  navJira?.setAttribute("aria-expanded", next === "jira" ? "true" : "false");
  navAi?.setAttribute("aria-expanded", "false");

  if (leavingAiNav || !genaiShell?.classList.contains("hidden")) {
    hideGenAiShell();
  }

  if (next === "jira") {
    window.coact.jiraSetPaneActive?.(true);
    refreshJiraPanel();
  } else {
    window.coact.jiraSetPaneActive?.(false);
    if (next === "dashboard") {
      refreshDashboard();
    }
  }

  if (tagline) {
    tagline.textContent =
      next === "live"
        ? screenQuest && !screenQuest.classList.contains("hidden")
          ? "Live steps"
          : selectedLob
            ? selectedLob
            : "Live steps"
        : next === "jira"
          ? "Jira stories"
          : "Executions";
  }
}

function defaultChatPlaceholder() {
  return "Ask liveAct…";
}

function clearAiFocusCard() {
  aiFocusCard = null;
  if (chatInput) chatInput.placeholder = defaultChatPlaceholder();
}

function hideGenAiShell() {
  genaiShell?.classList.add("hidden");
  genaiShell?.setAttribute("aria-hidden", "true");
  btnGenAi?.classList.remove("open");
  btnGenAi?.setAttribute("aria-expanded", "false");
}

function openGenAi() {
  genaiShell?.classList.remove("hidden");
  genaiShell?.setAttribute("aria-hidden", "false");
  btnGenAi?.classList.add("open");
  btnGenAi?.setAttribute("aria-expanded", "true");
  chatInput?.focus();
}

/** Open Ask liveAct with optional card context (title/id). Overlay only — does not switch nav. */
function openCardAi(card) {
  if (card?.id) {
    aiFocusCard = { id: card.id, title: card.title || card.id };
    if (chatInput) {
      chatInput.placeholder = `Ask about ${aiFocusCard.title}…`;
    }
  } else {
    clearAiFocusCard();
  }
  openGenAi();
}

function closeGenAi() {
  hideGenAiShell();
  if (activeNav === "ai") showNav("live");
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

async function refreshDashboard() {
  if (dashLoading) return;
  dashLoading = true;
  if (dashMeta) dashMeta.textContent = "Loading…";
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
    const card = document.createElement("div");
    card.className = "dash-card";

    const top = document.createElement("div");
    top.className = "dash-card-top";
    const ticketBtn = document.createElement("button");
    ticketBtn.type = "button";
    ticketBtn.className =
      "dash-ticket" + (row.formReferenceGenerated || row.jiraKeyGenerated ? " generated" : "");
    const ref = row.formReference || row.jiraKey || "—";
    ticketBtn.textContent = ref;
    if (row.jiraUrl) {
      ticketBtn.title = row.jiraStoryKey
        ? `Form ref ${ref} · open story ${row.jiraStoryKey}`
        : `Open ${row.jiraStoryKey || ref}`;
      ticketBtn.addEventListener("click", () => {
        window.coact.jiraOpenIssue?.(row.jiraUrl);
      });
    } else {
      ticketBtn.title =
        row.formReferenceGenerated || row.jiraKeyGenerated
          ? `Generated form ref ${ref} (no URL reference captured)`
          : `Form reference ${ref}`;
      ticketBtn.disabled = !ref || ref === "—";
    }
    const when = document.createElement("span");
    when.className = "muted";
    when.style.fontSize = "0.72rem";
    when.textContent = row.completed_at
      ? new Date(row.completed_at).toLocaleString()
      : row.run_date || "";
    top.append(ticketBtn, when);

    const title = document.createElement("div");
    title.className = "dash-title";
    title.textContent = row.queue_card || row.queue_card_id || "—";

    const meta = document.createElement("div");
    meta.className = "dash-meta";
    for (const bit of [
      row.jiraStoryKey ? `Jira ${row.jiraStoryKey}` : null,
      row.lob,
      row.fill_mode,
      row.user_id,
      `${row.mandatoryFilled || 0}/${row.mandatoryTotal || 0} mandatory`,
      row.mistake_count ? `${row.mistake_count} mistake(s)` : null,
    ].filter(Boolean)) {
      const span = document.createElement("span");
      span.textContent = bit;
      if (String(bit).startsWith("Jira ") && row.jiraUrl) {
        span.className = "dash-story";
        span.style.cursor = "pointer";
        span.addEventListener("click", () => {
          window.coact.jiraOpenIssue?.(row.jiraUrl);
        });
      }
      meta.appendChild(span);
    }

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
        left.textContent = m.label;
        const right = document.createElement("span");
        right.textContent = m.filled ? m.value : "missing";
        li.append(left, right);
        ul.appendChild(li);
      }
    }

    card.append(top, title, meta, ul);
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

async function submitJiraComment(issue, body) {
  const text = String(body || "").trim();
  if (!text) return;
  const res = await window.coact.jiraAddComment?.({
    issueKey: issue.key,
    body: text,
  });
  if (res?.recentActions) renderJiraRecent(res.recentActions);
  if (!res?.ok) {
    window.alert(res?.error || "Failed to post comment");
  }
  return res;
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

function renderJiraList(snapshot) {
  const fp = jiraUiFingerprint(snapshot);
  if (fp && fp === lastJiraUiFp) {
    // Same issues — only refresh the "Updated …" meta clock if present
    if (jiraMeta && snapshot?.ok && snapshot?.fetchedAt) {
      jiraMeta.textContent = `Updated ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`;
    }
    updateJiraBadge(snapshot);
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
    return;
  }
  if (!snapshot?.ok) {
    jiraList.classList.add("empty");
    jiraList.textContent = snapshot?.error || "Could not load Jira stories";
    if (jiraMeta) jiraMeta.textContent = "Error";
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

    const actions = document.createElement("div");
    actions.className = "jira-issue-actions";
    const btnNote = document.createElement("button");
    btnNote.type = "button";
    btnNote.className = "btn ghost tiny";
    btnNote.textContent = "Add note";
    actions.appendChild(btnNote);

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

    card.append(top, summary, stage, meta, actions, noteRow);
    jiraList.appendChild(card);
  }

  if (jiraMeta) {
    const stale = snapshot.staleCount || 0;
    const when = snapshot.fetchedAt
      ? new Date(snapshot.fetchedAt).toLocaleTimeString()
      : "—";
    jiraMeta.textContent = `${issues.length} stories · ${stale} stale · ${when}`;
  }
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
    renderJiraList({
      ok: false,
      configured: true,
      issues: [],
      staleCount: 0,
      error: err?.message || String(err),
    });
  } finally {
    jiraRefreshing = false;
    if (jiraRefreshQueued) {
      jiraRefreshQueued = false;
      refreshJiraPanel();
    }
  }
}

function syncChatLogVisibility() {
  chatLog.classList.toggle("empty", chatLog.childElementCount === 0);
}

function appendChatBubble(role, text) {
  if (role === "system") return null;
  const el = document.createElement("div");
  el.className = `chat-msg ${role}`;
  const body = document.createElement("div");
  body.className = "chat-msg-body";
  body.textContent = text || "";
  el.appendChild(body);

  if (role === "assistant") {
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
    el.appendChild(copyBtn);
  }

  chatLog.appendChild(el);
  syncChatLogVisibility();
  chatLog.scrollTop = chatLog.scrollHeight;
  el.getBody = () => body;
  return el;
}

function renderAttachRow() {
  attachRow.innerHTML = "";
  if (pendingSnippet) {
    const chip = document.createElement("span");
    chip.className = "attach-chip";
    chip.innerHTML = `Snippet <button type="button" data-clear="snippet">×</button>`;
    attachRow.appendChild(chip);
  }
  pendingAttachments.forEach((file, index) => {
    const chip = document.createElement("span");
    chip.className = "attach-chip";
    chip.innerHTML = `${escapeHtml(file.name)} <button type="button" data-file="${index}">×</button>`;
    attachRow.appendChild(chip);
  });
  attachRow.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.clear === "snippet") pendingSnippet = "";
      if (btn.dataset.file != null) {
        pendingAttachments.splice(Number(btn.dataset.file), 1);
      }
      renderAttachRow();
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

async function sendChat() {
  const prompt = chatInput.value.trim();
  if (!prompt && !pendingSnippet && !pendingAttachments.length) return;

  const settings = await window.coact.getOpenAiSettings();
  if (!settings?.hasKey) {
    openGenAi();
    openSettings();
    return;
  }

  openGenAi();

  const userLabel = [
    prompt || "(attachment)",
    pendingSnippet ? "[snippet]" : "",
    pendingAttachments.length ? `[${pendingAttachments.length} file(s)]` : "",
  ]
    .filter(Boolean)
    .join(" ");

  appendChatBubble("user", userLabel);
  chatHistory.push({ role: "user", content: prompt || "Please review the attached context." });

  const attachments = pendingAttachments.map((f) => f.path);
  const snippet = pendingSnippet;
  pendingAttachments = [];
  pendingSnippet = "";
  renderAttachRow();
  chatInput.value = "";

  const chatId = `chat-${Date.now()}`;
  activeChatId = chatId;
  streamingEl = appendChatBubble("assistant", "");
  streamingEl.classList.add("streaming");
  btnSend.disabled = true;

  const focusCardId = activeCardId || aiFocusCard?.id || null;
  const focusHint = aiFocusCard
    ? `Context: ${aiFocusCard.title} (${aiFocusCard.id})`
    : "";
  const stepContext = [focusHint, stepContextText()].filter(Boolean).join("\n");

  const result = await window.coact.chatPrompt({
    chatId,
    cardId: focusCardId,
    prompt,
    snippet,
    attachments,
    messages: chatHistory.slice(0, -1),
    stepContext,
    autoApplyTools: true,
  });

  btnSend.disabled = false;
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
  chatHistory.push({ role: "assistant", content: result.text || "" });
  activeChatId = null;
  streamingEl = null;
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function captureSnippet() {
  btnSnippet.disabled = true;
  runNote.className = "run-note";
  runNote.textContent = "Select a region…";
  const res = await window.coact.captureRegionSnip();
  btnSnippet.disabled = false;
  if (res?.cancelled) {
    runNote.className = "run-note";
    runNote.textContent = "";
    return;
  }
  if (!res?.ok || !res.path) {
    runNote.className = "run-note error";
    runNote.textContent = res?.error || "Snip failed";
    return;
  }
  pendingAttachments.push({
    path: res.path,
    name: "Snip.png",
  });
  renderAttachRow();
  openGenAi();
  runNote.className = "run-note";
  runNote.textContent = "Snip ready";
  setTimeout(() => {
    if (runNote.textContent === "Snip ready") runNote.textContent = "";
  }, 1500);
}

async function attachErrorFiles() {
  const res = await window.coact.pickErrorFiles();
  if (!res?.ok || !res.files?.length) return;
  pendingAttachments.push(...res.files);
  renderAttachRow();
}

async function openSettings() {
  const s = await window.coact.getOpenAiSettings();
  openaiModelInput.value = s?.model || "gpt-4o-mini";
  openaiKeyInput.value = "";
  openaiKeyInput.placeholder = s?.hasKey ? "•••••••• (saved — paste to replace)" : "sk-…";
  if (executionsRootInput) {
    executionsRootInput.value = s?.executionsRootOverride || s?.executionsRoot || "";
    executionsRootInput.placeholder = s?.executionsRoot || "Default: <project>/executions";
  }
  if (jiraBaseUrlInput) jiraBaseUrlInput.value = s?.jiraBaseUrl || "";
  if (jiraEmailInput) jiraEmailInput.value = s?.jiraEmail || "";
  if (jiraTokenInput) {
    jiraTokenInput.value = "";
    jiraTokenInput.placeholder = s?.jiraHasToken
      ? "•••••••• (saved — paste to replace)"
      : "Atlassian API token";
  }
  if (jiraJqlInput) jiraJqlInput.value = s?.jiraJql || "assignee = currentUser() ORDER BY updated ASC";
  if (jiraStaleDaysInput) jiraStaleDaysInput.value = String(s?.jiraStaleDays ?? 2);
  if (jiraStatusMapInput) {
    jiraStatusMapInput.value = JSON.stringify(
      s?.jiraStatusMap || {
        "To Do": "Step 1 – Intake",
        "In Progress": "Step 2 – Working",
        "In Review": "Step 3 – Review",
        Done: "Step 4 – Complete",
        Blocked: "Blocked",
      },
      null,
      2
    );
  }
  if (jiraCardKeyFieldInput) jiraCardKeyFieldInput.value = s?.jiraCardKeyField || "jiraKey";
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
      if (nextUrl !== activeTabUrl || activated) suppressAutoOpen = false;
      activeTabUrl = nextUrl;
      activeTabTitle = nextTitle;
      scheduleSyncQueueToActiveTab(activated);
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
    queueHeading.textContent = "LOB";
    btnBackLob?.classList.add("hidden");
    queueCount.textContent = "0";
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No quests yet. Refresh after cases are added.";
    queueList.appendChild(empty);
    return;
  }

  if (!selectedLob) {
    queueHeading.textContent = "LOB";
    btnBackLob?.classList.add("hidden");
    if (queueSearch) queueSearch.placeholder = "Search LOBs…";
    const lobs = uniqueLobs().filter((lob) => lobMatchesSearch(lob, queueSearchQuery));
    queueCount.textContent = String(lobs.length);

    if (queueSearchQuery.trim() && !lobs.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No LOBs match that search.";
      queueList.appendChild(empty);
      return;
    }

    for (const lob of lobs) {
      const lobCards = cardsForLob(lob);
      const btn = document.createElement("button");
      btn.className = "card lob-folder";
      btn.type = "button";
      const hasMatch = lobCards.some((c) => matchedIds.has(c.id));
      if (hasMatch) btn.classList.add("pinned-match");
      btn.innerHTML = `
        <h3>${escapeHtml(lob)}</h3>
        <div class="meta">
          <span>${lobCards.length} queue card${lobCards.length === 1 ? "" : "s"}</span>
        </div>
      `;
      btn.addEventListener("click", () => {
        selectedLob = lob;
        queueSearchQuery = "";
        if (queueSearch) queueSearch.value = "";
        renderQueue();
      });
      queueList.appendChild(btn);
    }
    return;
  }

  queueHeading.textContent = selectedLob;
  btnBackLob?.classList.remove("hidden");
  if (queueSearch) queueSearch.placeholder = "Search tasks…";
  const shown = cardsForLob(selectedLob)
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
    empty.textContent = "No queue cards in this LOB.";
    queueList.appendChild(empty);
    return;
  }

  for (const card of shown) {
    const row = document.createElement("div");
    row.className = "card" + (card.status === "done" ? " done" : "");
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
        <span>${escapeHtml(card.status === "done" ? "done" : "queued")}</span>
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
    runNote.textContent = "Refresh failed — focus the form tab.";
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
  selectedLob = card.lob || "TCOO";
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
  runNote.className = "run-note";
  runNote.textContent = "";
}

btnBack.addEventListener("click", () => {
  if (runState !== "idle") window.coact.controlRun("cancel");
  window.coact.watchCard(null);
  closeMoreMenu();
  suppressAutoOpen = true;
  autoPinnedCardId = null;
  showQueue();
});

btnBackLob?.addEventListener("click", () => {
  selectedLob = null;
  queueSearchQuery = "";
  if (queueSearch) queueSearch.value = "";
  renderQueue();
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
  if (genaiShell?.classList.contains("hidden")) {
    if (card) openCardAi(card);
    else {
      clearAiFocusCard();
      openGenAi();
    }
  } else {
    closeGenAi();
  }
});
btnCloseGenAi?.addEventListener("click", () => closeGenAi());

btnSend.addEventListener("click", () => sendChat());
btnSnippet.addEventListener("click", () => captureSnippet());
btnAttach.addEventListener("click", () => attachErrorFiles());
navLive?.addEventListener("click", () => showNav("live"));
navJira?.addEventListener("click", () => showNav("jira"));
navAi?.addEventListener("click", () => {
  clearAiFocusCard();
  showNav("ai");
});
navDashboard?.addEventListener("click", () => showNav("dashboard"));
btnDashRefresh?.addEventListener("click", () => refreshDashboard());
queueSearch?.addEventListener("input", () => {
  queueSearchQuery = queueSearch.value || "";
  renderQueue();
});
btnSettings.addEventListener("click", () => openSettings());
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
  if (executionsRootInput) {
    payload.executionsRoot = executionsRootInput.value.trim();
  }
  if (jiraBaseUrlInput) payload.jiraBaseUrl = jiraBaseUrlInput.value.trim();
  if (jiraEmailInput) payload.jiraEmail = jiraEmailInput.value.trim();
  const jiraTok = jiraTokenInput?.value.trim();
  if (jiraTok) payload.jiraApiToken = jiraTok;
  if (jiraJqlInput) payload.jiraJql = jiraJqlInput.value.trim();
  if (jiraStaleDaysInput) payload.jiraStaleDays = Number(jiraStaleDaysInput.value) || 2;
  if (jiraStatusMapInput) {
    try {
      payload.jiraStatusMap = JSON.parse(jiraStatusMapInput.value.trim() || "{}");
    } catch {
      window.alert("Jira status map must be valid JSON");
      return;
    }
  }
  if (jiraCardKeyFieldInput) payload.jiraCardKeyField = jiraCardKeyFieldInput.value.trim() || "jiraKey";
  const res = await window.coact.saveOpenAiSettings(payload);
  closeSettings();
  refreshJiraPanel();
  if (!res?.hasKey && !res?.jiraConfigured) {
    /* keep quiet — OpenAI key optional when only using Jira */
  }
});
btnPickExecutions?.addEventListener("click", async () => {
  const res = await window.coact.pickExecutionsFolder?.();
  if (res?.ok && res.path && executionsRootInput) {
    executionsRootInput.value = res.path;
  }
});

btnJiraRefresh?.addEventListener("click", () => refreshJiraPanel());
window.coact.onJiraUpdated?.((snap) => {
  renderJiraList(snap);
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
        "Developer mode ON → Load unpacked → select Projects/coact/extension (folder opened).";
    }
  } catch (err) {
    if (pathEl) pathEl.textContent = err?.message || String(err);
  }
}
document.getElementById("btnInstallExtChrome")?.addEventListener("click", () => installExt("chrome"));
document.getElementById("btnInstallExtEdge")?.addEventListener("click", () => installExt("edge"));
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
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
  chatLog.scrollTop = chatLog.scrollHeight;
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
    // Card "done" is reserved for explicit/Jira completion (persisted in meta.json).
    questMeta.textContent = "Completed";
    aiRepairAttemptedForRun = false;
  } else if (result.status === "run_cancelled") {
    runNote.className = "run-note";
    runNote.textContent = "";
    aiRepairAttemptedForRun = false;
  } else {
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
  applyQueuePayload(data);
  showNav("live");
  showQueue();
  setExtensionStatus({ connected: data.extensionConnected });
  if (data.jira) renderJiraList(data.jira);
  else {
    try {
      const snap = await window.coact.jiraGetSnapshot?.();
      if (snap) renderJiraList(snap);
    } catch {
      /* optional */
    }
  }
  pinned = true;
  await window.coact.setAlwaysOnTop(true);
  syncFilterButton();
  // Occasional status nudge — bridge already pulses; avoid 1.5s REQUEST_STATUS thrash
  window.coact.requestTabStatus?.();
  setInterval(() => {
    window.coact.requestTabStatus?.();
  }, 8000);
});
