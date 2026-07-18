(() => {
  const HIGHLIGHT_STYLE_ID = "coact-highlight-style";
  const STEP_DELAY_MS = 450;

  let runner = {
    cancelled: false,
    paused: false,
    cardId: null,
  };

  function ensureHighlightStyle() {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `
      .coact-active-field {
        outline: 3px solid #3ecf8e !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(62, 207, 142, 0.25) !important;
        transition: outline 0.15s ease, box-shadow 0.15s ease;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitWhilePaused() {
    while (runner.paused && !runner.cancelled) {
      await sleep(120);
    }
  }

  function report(payload) {
    chrome.runtime.sendMessage({ type: "step_update", payload });
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "SELECT"
        ? window.HTMLSelectElement.prototype
        : el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clearHighlights() {
    document.querySelectorAll(".coact-active-field").forEach((el) => {
      el.classList.remove("coact-active-field");
    });
  }

  async function runStep(step, data) {
    ensureHighlightStyle();
    const el = document.querySelector(step.selector);
    if (!el) {
      throw new Error(`Element not found: ${step.selector}`);
    }

    clearHighlights();
    el.classList.add("coact-active-field");
    el.scrollIntoView({ block: "center", behavior: "smooth" });

    if (step.action === "fill") {
      const value = data[step.valueFrom] ?? step.value ?? "";
      el.focus();
      setNativeValue(el, String(value));
    } else if (step.action === "click") {
      el.click();
    } else if (step.action === "highlight") {
      el.focus?.();
    } else {
      throw new Error(`Unknown action: ${step.action}`);
    }
  }

  async function runSop({ cardId, data, sop }) {
    runner = { cancelled: false, paused: false, cardId };
    ensureHighlightStyle();

    for (const step of sop.steps) {
      if (runner.cancelled) {
        report({ cardId, status: "run_cancelled" });
        clearHighlights();
        return;
      }

      await waitWhilePaused();
      if (runner.cancelled) {
        report({ cardId, status: "run_cancelled" });
        clearHighlights();
        return;
      }

      report({ cardId, stepId: step.id, status: "running" });

      try {
        await runStep(step, data || {});
        await sleep(STEP_DELAY_MS);
        if (runner.cancelled) {
          report({ cardId, status: "run_cancelled" });
          clearHighlights();
          return;
        }
        report({ cardId, stepId: step.id, status: "done" });
      } catch (err) {
        report({
          cardId,
          stepId: step.id,
          status: "failed",
          error: err.message || String(err),
        });
        report({
          cardId,
          status: "run_failed",
          error: err.message || String(err),
        });
        return;
      }
    }

    report({ cardId, status: "run_complete" });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "run_sop") {
      runSop(message);
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "control") {
      if (message.action === "pause") runner.paused = true;
      if (message.action === "resume") runner.paused = false;
      if (message.action === "cancel") runner.cancelled = true;
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });
})();
