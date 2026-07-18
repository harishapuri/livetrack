const queueList = document.getElementById("queueList");
const queueCount = document.getElementById("queueCount");
const stepList = document.getElementById("stepList");
const activeCardEl = document.getElementById("activeCard");
const runNote = document.getElementById("runNote");
const extStatus = document.getElementById("extStatus");
const extStatusText = document.getElementById("extStatusText");
const btnPause = document.getElementById("btnPause");
const btnResume = document.getElementById("btnResume");
const btnCancel = document.getElementById("btnCancel");

let cards = [];
let activeCardId = null;
let running = false;

function setExtensionStatus({ connected, tabUrl }) {
  extStatus.classList.toggle("online", Boolean(connected));
  if (!connected) {
    extStatusText.textContent = "Extension offline";
    return;
  }
  extStatusText.textContent = tabUrl
    ? `Extension online · ${shortUrl(tabUrl)}`
    : "Extension online";
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
}

function renderQueue() {
  queueCount.textContent = `${cards.length} card${cards.length === 1 ? "" : "s"}`;
  queueList.innerHTML = "";

  for (const card of cards) {
    const btn = document.createElement("button");
    btn.className = "card" + (card.id === activeCardId ? " active" : "");
    btn.type = "button";
    btn.innerHTML = `
      <h3>${escapeHtml(card.title)}</h3>
      <div class="meta">
        <span class="badge">${escapeHtml(card.sopName || card.sopId)}</span>
        <span>${card.stepCount} steps</span>
        <span>${escapeHtml(card.status)}</span>
      </div>
    `;
    btn.addEventListener("click", () => startCard(card.id));
    queueList.appendChild(btn);
  }
}

function renderSteps(steps) {
  stepList.innerHTML = "";
  steps.forEach((step, index) => {
    const li = document.createElement("li");
    li.className = `step ${step.status || "pending"}`;
    li.dataset.stepId = step.id;
    li.innerHTML = `
      <span class="idx">${index + 1}</span>
      <span class="label">${escapeHtml(step.label)}</span>
      <span class="state">${escapeHtml(step.status || "pending")}</span>
    `;
    stepList.appendChild(li);
  });
}

function updateStep(stepId, status, error) {
  const li = stepList.querySelector(`[data-step-id="${CSS.escape(stepId)}"]`);
  if (!li) return;
  li.className = `step ${status}`;
  const state = li.querySelector(".state");
  state.textContent = error ? `${status}: ${error}` : status;
}

function setControlsEnabled(isRunning) {
  running = isRunning;
  btnPause.disabled = !isRunning;
  btnResume.disabled = !isRunning;
  btnCancel.disabled = !isRunning;
}

async function startCard(cardId) {
  const card = cards.find((c) => c.id === cardId);
  if (!card) return;

  activeCardId = cardId;
  renderQueue();
  activeCardEl.textContent = `Running: ${card.title}`;
  runNote.className = "run-note";
  runNote.textContent = "Sending SOP to Chrome…";

  const result = await window.coact.runCard(cardId);
  if (!result.ok) {
    runNote.className = "run-note error";
    runNote.textContent = result.error;
    setControlsEnabled(false);
    renderSteps([]);
    return;
  }

  renderSteps(result.steps);
  setControlsEnabled(true);
  runNote.textContent = "Agent is filling the form — watch Chrome.";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

btnPause.addEventListener("click", () => window.coact.controlRun("pause"));
btnResume.addEventListener("click", () => window.coact.controlRun("resume"));
btnCancel.addEventListener("click", () => window.coact.controlRun("cancel"));

window.coact.onExtensionStatus(setExtensionStatus);
window.coact.onStepUpdate((update) => {
  if (update.stepId) {
    updateStep(update.stepId, update.status, update.error);
  }
});
window.coact.onRunFinished((result) => {
  setControlsEnabled(false);
  if (result.status === "run_complete") {
    runNote.className = "run-note success";
    runNote.textContent = "Run complete. Review the form, then submit if ready.";
    const card = cards.find((c) => c.id === result.cardId);
    if (card) card.status = "done";
    renderQueue();
  } else if (result.status === "run_cancelled") {
    runNote.className = "run-note";
    runNote.textContent = "Takeover — you are in control of the form.";
  } else {
    runNote.className = "run-note error";
    runNote.textContent = result.error || "Run failed.";
  }
});

window.coact.getBootstrap().then((data) => {
  cards = data.queue || [];
  renderQueue();
  setExtensionStatus({ connected: data.extensionConnected });
});
