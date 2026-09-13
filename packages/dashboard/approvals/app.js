(function () {
  const pane = document.getElementById("pane-approvals");
  const bodyEl = document.getElementById("approvalsBody");
  const hintEl = document.getElementById("approvalsHint");
  const smeEl = document.getElementById("approvalSme");
  const btnRefresh = document.getElementById("btnRefreshApprovals");
  if (!pane || !bodyEl) return;

  const USER_KEY = "coact.reviews.actingUser";
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

  function samplePreview(data) {
    const entries = Object.entries(data && typeof data === "object" ? data : {}).filter(
      ([, v]) => String(v || "").trim()
    );
    if (!entries.length) return "";
    return entries
      .slice(0, 8)
      .map(([k, v]) => `${k}=${v}`)
      .join(" · ");
  }

  function renderPending(pending) {
    const list = Array.isArray(pending) ? pending : [];
    if (hintEl) {
      hintEl.textContent = list.length
        ? `${list.length} draft${list.length === 1 ? "" : "s"} waiting. Operators will not see these until you approve.`
        : "No queue cards waiting for SME approval. Record an unmatched page in LiveTrack, then stop recording.";
    }
    if (!list.length) {
      bodyEl.innerHTML = `<tr class="empty-row"><td colspan="5">No drafts waiting for approval.</td></tr>`;
      return;
    }
    bodyEl.innerHTML = list
      .map((sop) => {
        const steps = Array.isArray(sop.steps) ? sop.steps : [];
        const preview = samplePreview(sop.sampleData);
        const source = sop.source === "capture" ? "Record" : sop.source || "Discovery";
        const when = String(sop.discoveredAt || "").slice(0, 16).replace("T", " ");
        const stepLines = steps
          .map((step) => {
            const val = sop.sampleData?.[step.valueFrom || step.id];
            const extra = val ? ` — ${val}` : step.action === "click" ? " — click" : "";
            return `<li>${esc(step.label || step.id)}${esc(extra)}</li>`;
          })
          .join("");
        return `
      <tr data-id="${esc(sop.id)}">
        <td>
          <strong>${esc(sop.name || sop.id)}</strong>
          <div class="hint">${esc(source)}${preview ? ` · ${esc(preview)}` : ""}</div>
        </td>
        <td class="details" title="${esc(sop.formUrl || "")}">${esc(sop.formUrl || "")}</td>
        <td class="num">${steps.length}</td>
        <td class="nowrap">${esc(when)}</td>
        <td class="row-actions">
          <a class="approve" href="#/studio?sop=${esc(sop.id)}">Edit in Queue studio</a>
          <button class="approve" type="button" data-approval="approve" data-id="${esc(sop.id)}">Approve &amp; add queue card</button>
          <button class="reject" type="button" data-approval="reject" data-id="${esc(sop.id)}">Reject</button>
        </td>
      </tr>
      <tr class="draft-steps-row" data-id="${esc(sop.id)}">
        <td colspan="5">
          <ul class="approval-steps">${stepLines || "<li class='hint'>No steps yet — edit in Queue studio.</li>"}</ul>
        </td>
      </tr>`;
      })
      .join("");
  }

  async function loadApprovals() {
    try {
      const res = await api("/api/sops/pending");
      renderPending(res.pending);
    } catch (err) {
      bodyEl.innerHTML = `<tr class="empty-row"><td colspan="5">${esc(err?.message || "Could not load drafts")}</td></tr>`;
    }
  }

  pane.addEventListener("click", async (e) => {
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

  window.addEventListener("dash:route", (e) => {
    if (e.detail?.id === "approvals") loadApprovals();
  });

  loadApprovals();
})();
