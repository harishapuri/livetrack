(function () {
  const pane = document.getElementById("pane-approvals");
  const listEl = document.getElementById("approvalsList");
  const hintEl = document.getElementById("approvalsHint");
  const smeEl = document.getElementById("approvalSme");
  const btnRefresh = document.getElementById("btnRefreshApprovals");
  if (!pane || !listEl) return;

  const USER_KEY = "coact.reviews.actingUser";
  const scripts = new Map();
  let focusSopId = "";
  let focusTicket = "";

  function hashQuery() {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    const qIndex = raw.indexOf("?");
    const qs = qIndex >= 0 ? raw.slice(qIndex + 1) : "";
    return new URLSearchParams(qs);
  }

  function querySop() {
    return hashQuery().get("sop") || "";
  }

  function queryTicket() {
    return hashQuery().get("ticket") || "";
  }

  if (smeEl) {
    smeEl.value = localStorage.getItem(USER_KEY) || "";
    smeEl.addEventListener("change", () => {
      localStorage.setItem(USER_KEY, smeEl.value.trim());
    });
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  async function api(path, opts) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    return res.json();
  }

  function compactScript(sop) {
    const pw = sop?.playwright || {};
    return {
      ticket: sop.ticket || pw.ticket || null,
      startUrl: sop.startUrl || pw.startUrl || sop.formUrl || "",
      clicks: Array.isArray(sop.clicks) && sop.clicks.length ? sop.clicks : pw.clicks || [],
    };
  }

  function pretty(obj) {
    return JSON.stringify(obj, null, 2);
  }

  function clickChips(clicks) {
    const list = Array.isArray(clicks) ? clicks : [];
    if (!list.length) return `<span class="hint">No navigation clicks captured</span>`;
    return list
      .map((c) => `<span class="approval-click-chip">${esc(c.label || "click")}</span>`)
      .join("");
  }

  function sopMatchesFocus(sop, compact) {
    if (focusSopId && sop.id === focusSopId) return true;
    const ticket = String(compact?.ticket || "").trim();
    if (focusTicket && ticket && ticket.toUpperCase() === focusTicket.toUpperCase()) return true;
    return false;
  }

  function renderPending(pending) {
    const all = Array.isArray(pending) ? pending : [];
    const focused = focusSopId || focusTicket
      ? all.filter((sop) => sopMatchesFocus(sop, compactScript(sop)))
      : [];
    const list = focused.length ? focused : all;
    const narrowed = focused.length > 0 && focused.length < all.length;
    scripts.clear();
    if (hintEl) {
      const focusLabel = focusTicket || focusSopId;
      hintEl.textContent = narrowed
        ? `Showing ${focusLabel}. ${all.length} draft${all.length === 1 ? "" : "s"} are waiting in total.`
        : list.length
          ? `${list.length} draft${list.length === 1 ? "" : "s"} waiting. Operators will not see these until you approve.`
          : "No queue cards waiting for SME approval. Record an unmatched page in LiveTrack, then stop recording.";
    }
    if (!list.length) {
      listEl.innerHTML = `<p class="empty-row">No drafts waiting for approval.</p>`;
      return;
    }
    listEl.innerHTML = list
      .map((sop) => {
        const compact = compactScript(sop);
        scripts.set(sop.id, { compact, full: sop.playwright || compact });
        const when = String(sop.discoveredAt || "").slice(0, 16).replace("T", " ");
        const source = sop.source === "capture" ? "Record" : sop.source || "Discovery";
        const stepCount = Array.isArray(sop.steps) ? sop.steps.length : 0;
        const clickCount = compact.clicks.length;
        const open = sopMatchesFocus(sop, compact);
        const selected = open ? " is-selected" : "";
        return `
      <article class="approval-card${selected}" data-id="${esc(sop.id)}" id="approval-${esc(sop.id)}">
        <details class="approval-fold"${open ? " open" : ""}>
          <summary class="approval-card-head">
            <div>
              <h3>${esc(sop.name || sop.id)}</h3>
              <p class="hint">${esc(source)}${when ? ` · ${esc(when)}` : ""} · ${stepCount} steps · ${clickCount} click${clickCount === 1 ? "" : "s"}</p>
            </div>
            ${compact.ticket ? `<span class="approval-ticket">${esc(compact.ticket)}</span>` : ""}
          </summary>
          <p class="approval-url" title="${esc(compact.startUrl)}">${esc(compact.startUrl || "No start URL")}</p>
          <div class="approval-clicks">${clickChips(compact.clicks)}</div>
          <details class="fold-block" open>
            <summary class="fold-summary">Playwright clicks &amp; locators</summary>
            <div class="capture-json-tools">
              <span class="hint">Copy ticket, startUrl, and clicks</span>
              <button type="button" class="btn-filter" data-copy="compact" data-id="${esc(sop.id)}">Copy JSON</button>
            </div>
            <pre class="capture-json">${esc(pretty(compact))}</pre>
          </details>
          <details class="fold-block approval-full">
            <summary class="fold-summary">Field values and full Playwright steps</summary>
            <div class="capture-json-tools">
              <span class="hint">Includes fills, checks, and locators</span>
              <button type="button" class="btn-filter" data-copy="full" data-id="${esc(sop.id)}">Copy full JSON</button>
            </div>
            <pre class="capture-json">${esc(pretty(sop.playwright || compact))}</pre>
          </details>
        </details>
        <div class="approval-card-actions">
          <a class="approve" href="#/studio?sop=${esc(sop.id)}">Edit in Queue studio</a>
          <button class="approve" type="button" data-approval="approve" data-id="${esc(sop.id)}">Approve &amp; add queue card</button>
          <button class="reject" type="button" data-approval="reject" data-id="${esc(sop.id)}">Reject</button>
        </div>
      </article>`;
      })
      .join("");

    const focusCard = listEl.querySelector(".approval-card.is-selected") ||
      (focusSopId ? listEl.querySelector(`#approval-${CSS.escape(focusSopId)}`) : null);
    focusCard?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async function copyJson(id, kind, btn) {
    const rec = scripts.get(id);
    if (!rec) return;
    const payload = kind === "full" ? rec.full : rec.compact;
    const text = pretty(payload);
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      }
    } catch {
      alert("Could not copy JSON");
    }
  }

  async function loadApprovals() {
    if (hintEl) hintEl.textContent = "Loading drafts…";
    listEl.innerHTML = `<p class="hint">Loading Playwright scripts…</p>`;
    try {
      const res = await api("/api/sops/pending");
      renderPending(res.pending);
    } catch (err) {
      listEl.innerHTML = `<p class="empty-row">${esc(err?.message || "Could not load drafts")}</p>`;
    }
  }

  pane.addEventListener("click", async (e) => {
    const copyBtn = e.target.closest("button[data-copy]");
    if (copyBtn) {
      await copyJson(copyBtn.dataset.id, copyBtn.dataset.copy, copyBtn);
      return;
    }
    const btn = e.target.closest("button[data-approval]");
    if (!btn) return;
    const action = btn.dataset.approval;
    const id = btn.dataset.id;
    const user = smeEl?.value.trim() || "";
    btn.disabled = true;
    try {
      const reason = action === "reject" ? prompt("Reason for rejecting (optional):") || "" : undefined;
      const res = await api(`/api/sops/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({ user, reason }),
      });
      if (!res.ok) alert(res.error || "Action failed");
      await loadApprovals();
    } catch (err) {
      alert(err?.message || "Request failed");
      btn.disabled = false;
    }
  });

  btnRefresh?.addEventListener("click", () => loadApprovals());
  document.getElementById("btnExpandApprovals")?.addEventListener("click", () => {
    listEl.querySelectorAll("details.approval-fold").forEach((el) => {
      el.open = true;
    });
  });
  document.getElementById("btnCollapseApprovals")?.addEventListener("click", () => {
    listEl.querySelectorAll("details.approval-fold").forEach((el) => {
      el.open = false;
    });
  });

  window.addEventListener("dash:route", (e) => {
    if (e.detail?.id !== "approvals") return;
    focusSopId = String(e.detail?.query?.sop || "").trim();
    focusTicket = String(e.detail?.query?.ticket || "").trim();
    loadApprovals();
  });

  if (!pane.hidden) {
    focusSopId = querySop();
    focusTicket = queryTicket();
    loadApprovals();
  }
})();
