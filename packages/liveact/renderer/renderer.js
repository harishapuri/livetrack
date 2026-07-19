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
const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const attachRow = document.getElementById("attachRow");
const btnSend = document.getElementById("btnSend");
const btnSnippet = document.getElementById("btnSnippet");
const btnAttach = document.getElementById("btnAttach");
const btnGenAi = document.getElementById("btnGenAi");
const btnQueueGenAi = document.getElementById("btnQueueGenAi");
const btnCloseGenAi = document.getElementById("btnCloseGenAi");
const genaiPanel = document.getElementById("genaiPanel");
const genaiShell = document.getElementById("genaiShell");
const queueSearch = document.getElementById("queueSearch");
const queueSearchWrap = document.getElementById("queueSearchWrap");
const btnSettings = document.getElementById("btnSettings");
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
  extStatus.classList.toggle("online", online);
  if (online) {
    extStatusText.textContent = "Online";
    return;
  }
  if (bridgeError) {
    extStatusText.textContent =
      String(bridgeError).length > 48 ? "Bridge down — port in use?" : String(bridgeError);
    return;
  }
  if (bridgeUp === false) {
    extStatusText.textContent = "Bridge down";
    return;
  }
  extStatusText.textContent = "Offline";
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
  updateTailSummary();
  noteStepActivity();
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
  clearStuckCoach();
  coachEpisode.clear();
  activeCardId = null;
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
  clearStuckCoach();
  coachEpisode.clear();
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
  // Don't wipe GenAI chat when hopping between forms mid-session
  if (!genaiShell || genaiShell.classList.contains("hidden")) {
    /* leave chat as-is */
  }
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

function openGenAi() {
  genaiShell?.classList.remove("hidden");
  genaiShell?.setAttribute("aria-hidden", "false");
  btnGenAi?.classList.add("open");
  btnQueueGenAi?.classList.add("open");
  btnGenAi?.setAttribute("aria-expanded", "true");
  btnQueueGenAi?.setAttribute("aria-expanded", "true");
  chatInput?.focus();
}

function closeGenAi() {
  genaiShell?.classList.add("hidden");
  genaiShell?.setAttribute("aria-hidden", "true");
  btnGenAi?.classList.remove("open");
  btnQueueGenAi?.classList.remove("open");
  btnGenAi?.setAttribute("aria-expanded", "false");
  btnQueueGenAi?.setAttribute("aria-expanded", "false");
}

function toggleGenAi() {
  if (genaiShell?.classList.contains("hidden")) openGenAi();
  else closeGenAi();
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

  const result = await window.coact.chatPrompt({
    chatId,
    cardId: activeCardId,
    prompt,
    snippet,
    attachments,
    messages: chatHistory.slice(0, -1),
    stepContext: stepContextText(),
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
  const shown = cardsForLob(selectedLob).filter((card) =>
    cardMatchesSearch(card, queueSearchQuery)
  );
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
    const btn = document.createElement("button");
    btn.className = "card";
    btn.type = "button";
    if (matchedIds.has(card.id)) btn.classList.add("pinned-match");
    const stepCount = (card.steps && card.steps.length) || DUMMY_STEPS.length;
    btn.innerHTML = `
      <h3>${escapeHtml(card.title)}</h3>
      <div class="meta">
        <span>${stepCount} steps</span>
        <span>${escapeHtml(card.status === "done" ? "done" : "queued")}</span>
      </div>
    `;
    btn.addEventListener("click", () => {
      suppressAutoOpen = false;
      openCard(card.id);
    });
    queueList.appendChild(btn);
  }
}

function setRunControls(state) {
  runState = state;
  const idle = state === "idle";
  const running = state === "running";
  const paused = state === "paused";

  btnStart.disabled = !idle;
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

async function startFilling() {
  if (!activeCardId || runState !== "idle") return;

  aiRepairAttemptedForRun = false;
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
    setRunControls("idle");
    return;
  }

  const result = await window.coact.runCard(activeCardId, { startIndex, completedStepIds });
  if (!result.ok) {
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
  startFilling();
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

btnSend.addEventListener("click", () => sendChat());
btnSnippet.addEventListener("click", () => captureSnippet());
btnAttach.addEventListener("click", () => attachErrorFiles());
btnGenAi.addEventListener("click", (e) => {
  e.stopPropagation();
  closeMoreMenu();
  toggleGenAi();
});
btnQueueGenAi?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleGenAi();
});
btnCloseGenAi?.addEventListener("click", () => closeGenAi());
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
  const res = await window.coact.saveOpenAiSettings(payload);
  closeSettings();
  if (!res?.hasKey) openSettings();
});
btnPickExecutions?.addEventListener("click", async () => {
  const res = await window.coact.pickExecutionsFolder?.();
  if (res?.ok && res.path && executionsRootInput) {
    executionsRootInput.value = res.path;
  }
});
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
    const canApply = stepCanApprove(step, suggested);
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
      runNote.textContent = repair.reason || "AI retry applied — continue or Start again";
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
    const card = cards.find((c) => c.id === result.cardId);
    if (card) card.status = "done";
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
  showQueue();
  setExtensionStatus({ connected: data.extensionConnected });
  pinned = true;
  await window.coact.setAlwaysOnTop(true);
  syncFilterButton();
  // Keep asking the extension which form tab is active
  window.coact.requestTabStatus?.();
  setInterval(() => {
    window.coact.requestTabStatus?.();
  }, 1500);
});
