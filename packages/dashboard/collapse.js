/**
 * Collapse every dashboard panel so each page is a list of section titles.
 * Open state is remembered per section in localStorage.
 */
(function () {
  const STORAGE_KEY = "livetrack.dashboard.sections.v1";
  let enhancing = false;
  let seq = 0;

  function loadMap() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveMap(map) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* private mode / quota — toggles still work for this visit */
    }
  }

  function sectionKey(panel, title) {
    const pane = panel.closest("[data-pane]")?.getAttribute("data-pane") || "page";
    return `${pane}::${title}`;
  }

  function applyOpen(panel, open) {
    const button = panel.querySelector(":scope > .panel-toggle");
    const body = panel.querySelector(":scope > .panel-body");
    const action = button?.querySelector(".panel-toggle-action");
    if (!button || !body) return;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.title = open ? "Hide this section" : "Open this section";
    body.hidden = !open;
    panel.classList.toggle("is-collapsed", !open);
    if (action) action.textContent = open ? "Hide" : "Open";
  }

  function persist(key, open) {
    const map = loadMap();
    map[key] = open;
    saveMap(map);
  }

  function enhancePanel(panel) {
    if (panel.dataset.sectionReady === "1") return;
    if (panel.classList.contains("capture-live-panel")) return;
    const heading = panel.querySelector(":scope > h2");
    if (!heading) return;

    const title = heading.textContent.replace(/\s+/g, " ").trim() || "Section";
    const key = sectionKey(panel, title);
    const bodyId = `section-body-${++seq}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "panel-toggle";
    button.setAttribute("aria-controls", bodyId);
    button.appendChild(heading);

    const action = document.createElement("span");
    action.className = "panel-toggle-action";
    action.textContent = "Open";
    button.appendChild(action);

    const body = document.createElement("div");
    body.className = "panel-body";
    body.id = bodyId;
    while (panel.firstChild) body.appendChild(panel.firstChild);

    panel.appendChild(button);
    panel.appendChild(body);
    panel.dataset.sectionReady = "1";
    panel.dataset.sectionKey = key;

    const stored = loadMap()[key];
    applyOpen(panel, stored === true);

    button.addEventListener("click", () => {
      const next = button.getAttribute("aria-expanded") !== "true";
      applyOpen(panel, next);
      persist(key, next);
    });
  }

  function setCaptureLive(open) {
    const toggle = document.getElementById("captureLiveToggle");
    if (!toggle) return;
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    if (isOpen !== open) toggle.click();
  }

  function rememberCapture(open) {
    persist("executions::Live tracking values", open);
  }

  function restoreCapture() {
    if (loadMap()["executions::Live tracking values"] === true) setCaptureLive(true);
  }

  function ensureFoldBar(pane) {
    if (pane.querySelector(":scope > .section-fold-bar")) return;
    const bar = document.createElement("div");
    bar.className = "section-fold-bar";
    bar.innerHTML = `
      <button type="button" class="btn-filter" data-fold="expand">Expand all</button>
      <button type="button" class="btn-filter" data-fold="collapse">Collapse all</button>
    `;
    bar.addEventListener("click", (event) => {
      const fold = event.target.closest("[data-fold]")?.getAttribute("data-fold");
      if (fold !== "expand" && fold !== "collapse") return;
      const open = fold === "expand";
      const map = loadMap();
      pane.querySelectorAll(".panel[data-section-key]").forEach((panel) => {
        applyOpen(panel, open);
        map[panel.dataset.sectionKey] = open;
      });
      if (pane.getAttribute("data-pane") === "executions") {
        setCaptureLive(open);
        map["executions::Live tracking values"] = open;
      }
      saveMap(map);
    });
    pane.insertBefore(bar, pane.firstChild);
  }

  function enhanceAll() {
    if (enhancing) return;
    enhancing = true;
    try {
      document.querySelectorAll(".dash-pane").forEach(ensureFoldBar);
      document.querySelectorAll(".panel").forEach(enhancePanel);
    } finally {
      enhancing = false;
    }
  }

  const shell = document.getElementById("dashShell") || document.body;
  enhanceAll();
  restoreCapture();

  document.getElementById("captureLiveToggle")?.addEventListener("click", () => {
    const open = document.getElementById("captureLiveToggle")?.getAttribute("aria-expanded") === "true";
    rememberCapture(!!open);
  });

  const observer = new MutationObserver(() => {
    if (enhancing) return;
    enhanceAll();
  });
  observer.observe(shell, { childList: true, subtree: true });
})();
