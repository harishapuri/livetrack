(function () {
  const metaLine = document.getElementById("metaLine");
  const actingUser = document.getElementById("actingUser");
  const btnRunIntel = document.getElementById("btnRunIntel");
  const btnBuildDataset = document.getElementById("btnBuildDataset");
  const aiTotals = document.getElementById("aiTotals");
  const inboxBody = document.getElementById("inboxBody");
  const datasetsBody = document.getElementById("datasetsBody");
  const riskBody = document.getElementById("riskBody");
  const suggestionsBody = document.getElementById("suggestionsBody");

  const USER_KEY = "coact.reviews.actingUser";
  actingUser.value = localStorage.getItem(USER_KEY) || "";
  actingUser.addEventListener("change", () => {
    localStorage.setItem(USER_KEY, actingUser.value.trim());
  });

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

  function emptyRow(colSpan, text) {
    return `<tr class="empty-row"><td colspan="${colSpan}">${esc(text)}</td></tr>`;
  }

  function renderInbox(notes) {
    if (!notes?.length) {
      inboxBody.innerHTML = emptyRow(8, "No operator notes yet.");
      return;
    }
    inboxBody.innerHTML = notes
      .map((n) => {
        const when = String(n.ts || "").slice(0, 16).replace("T", " ");
        const statusClass = n.status === "done" ? "published" : n.status === "ack" ? "draft" : "medium";
        const statusLabel = n.status === "ack" ? "Acknowledged" : n.status === "done" ? "Done" : "Open";
        const reply = n.smeNote
          ? esc(n.smeNote)
          : `<input class="inbox-reply" data-id="${esc(n.id)}" type="text" placeholder="Reply (optional)" />`;
        const actions =
          n.status === "done"
            ? ""
            : `${
                n.status === "open"
                  ? `<button class="approve" data-action="inbox-ack" data-id="${esc(n.id)}">Acknowledge</button>`
                  : ""
              }
              <button class="approve" data-action="inbox-done" data-id="${esc(n.id)}">Done</button>`;
        return `
      <tr data-id="${esc(n.id)}">
        <td class="nowrap">${esc(when)}</td>
        <td>${esc(n.user)}</td>
        <td>${esc(n.category)}</td>
        <td class="details" title="${esc(n.body)}">${esc(n.title)}</td>
        <td>${esc(n.cardId || n.lob || "")}</td>
        <td><span class="badge ${statusClass}">${esc(statusLabel)}</span></td>
        <td class="details">${reply}</td>
        <td class="row-actions">${actions}</td>
      </tr>`;
      })
      .join("");
  }

  function renderDatasets(datasets) {
    if (!datasets?.length) {
      datasetsBody.innerHTML = emptyRow(6, "No datasets built yet.");
      return;
    }
    datasetsBody.innerHTML = datasets
      .map((d) => {
        const status = d.rejected ? "rejected" : d.approved ? "published" : "draft";
        const statusLabel = d.rejected ? "Rejected" : d.approved ? "Approved" : "Pending";
        const actions =
          status === "draft"
            ? `<button class="approve" data-action="dataset-approve" data-version="${d.version}">Approve</button>
               <button class="reject" data-action="dataset-reject" data-version="${d.version}">Reject</button>`
            : "";
        return `
      <tr>
        <td class="num">v${String(d.version).padStart(3, "0")}</td>
        <td class="nowrap">${esc((d.createdAt || "").slice(0, 16).replace("T", " "))}</td>
        <td class="num">${d.exampleCount}</td>
        <td class="num">${d.positiveCount} / ${d.negativeCount}</td>
        <td><span class="badge ${status}">${statusLabel}</span></td>
        <td class="row-actions">${actions}</td>
      </tr>`;
      })
      .join("");
  }

  function renderRisks(failures) {
    if (!failures?.length) {
      riskBody.innerHTML = emptyRow(5, "No at-risk cards found in the last 30 days.");
      return;
    }
    riskBody.innerHTML = failures
      .map(
        (f) => `
      <tr>
        <td>${esc(f.cardKey)}</td>
        <td><span class="badge ${esc(f.riskLevel)}">${esc(f.riskLevel)}</span></td>
        <td class="num">${Math.round(f.mistakeRate * 100)}%</td>
        <td class="num">${f.sampleSize}</td>
        <td class="details">${esc(f.topFields.map((x) => `${x.label} (${x.count})`).join(", "))}</td>
      </tr>`
      )
      .join("");
  }

  function renderSuggestions(suggestions) {
    if (!suggestions?.length) {
      suggestionsBody.innerHTML = emptyRow(3, "No optimization suggestions yet.");
      return;
    }
    suggestionsBody.innerHTML = suggestions
      .map(
        (s) => `
      <tr>
        <td>${esc(s.cardKey)}</td>
        <td><span class="badge ${s.severity === "high" ? "high" : s.severity === "medium" ? "medium" : ""}">${esc(s.kind)}</span></td>
        <td class="details">${esc(s.text)}</td>
      </tr>`
      )
      .join("");
  }

  function renderAiTotals(summary) {
    if (!summary?.length) {
      aiTotals.innerHTML = `<div class="stat"><div class="label">AI feedback</div><div class="value">No data yet</div></div>`;
      return;
    }
    aiTotals.innerHTML = summary
      .map(
        (s) => `
      <div class="stat">
        <div class="label">${esc(s.source)}</div>
        <div class="value">${s.acceptanceRate != null ? s.acceptanceRate + "%" : "—"}</div>
        <div class="hint" style="margin:4px 0 0">${s.approve + s.edit} accepted / ${s.reject} rejected (n=${s.total})</div>
      </div>`
      )
      .join("");
    aiTotals.style.gridTemplateColumns = `repeat(${summary.length}, minmax(0, 1fr))`;
  }

  async function loadAll() {
    metaLine.textContent = "Loading…";
    const [datasetsRes, intelRes, aiRes, inboxRes] = await Promise.all([
      api("/api/datasets"),
      api("/api/process-intelligence"),
      api("/api/ai-metrics"),
      api("/api/inbox"),
    ]);
    renderInbox(inboxRes.notes);
    renderDatasets(datasetsRes.datasets);
    renderRisks(intelRes.report?.failures);
    renderSuggestions(intelRes.report?.optimizationSuggestions);
    renderAiTotals(aiRes.summary);
    const generatedAt = intelRes.report?.generatedAt
      ? new Date(intelRes.report.generatedAt).toLocaleString()
      : "never";
    if (!document.getElementById("pane-reviews")?.hidden) {
      metaLine.textContent = `Process Intelligence last ran: ${generatedAt}`;
    }
  }

  document.getElementById("pane-reviews")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const user = actingUser.value.trim();
    btn.disabled = true;
    try {
      if (action === "dataset-approve" || action === "dataset-reject") {
        const version = btn.dataset.version;
        const kind = action === "dataset-approve" ? "approve" : "reject";
        const reason = kind === "reject" ? prompt("Reason for rejecting (optional):") || "" : undefined;
        const res = await api(`/api/datasets/${version}/${kind}`, {
          method: "POST",
          body: JSON.stringify({ user, reason }),
        });
        if (!res.ok) alert(res.error || "Action failed");
      } else if (action === "inbox-ack" || action === "inbox-done") {
        const id = btn.dataset.id;
        const row = btn.closest("tr");
        const replyInput = row?.querySelector(".inbox-reply");
        const patch = {
          status: action === "inbox-ack" ? "ack" : "done",
          sme: user,
        };
        if (replyInput) patch.smeNote = replyInput.value.trim();
        const res = await api(`/api/inbox/${encodeURIComponent(id)}`, {
          method: "POST",
          body: JSON.stringify(patch),
        });
        if (!res.ok) alert(res.error || "Action failed");
      }
      await loadAll();
    } catch (err) {
      alert(err?.message || "Request failed");
      btn.disabled = false;
    }
  });

  btnRunIntel.addEventListener("click", async () => {
    btnRunIntel.disabled = true;
    btnRunIntel.textContent = "Running…";
    try {
      await api("/api/process-intelligence/run", { method: "POST", body: "{}" });
      await loadAll();
    } finally {
      btnRunIntel.disabled = false;
      btnRunIntel.textContent = "Re-run Process Intelligence";
    }
  });

  btnBuildDataset.addEventListener("click", async () => {
    btnBuildDataset.disabled = true;
    btnBuildDataset.textContent = "Building…";
    try {
      await api("/api/datasets/build", { method: "POST", body: JSON.stringify({ days: 30 }) });
      await loadAll();
    } finally {
      btnBuildDataset.disabled = false;
      btnBuildDataset.textContent = "Build dataset from last 30 days";
    }
  });

  window.addEventListener("dash:route", (e) => {
    if (e.detail?.id === "reviews") loadAll();
  });

  loadAll();
})();
