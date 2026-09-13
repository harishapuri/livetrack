(function () {
  const digestSelect = document.getElementById("digestSelect");
  const digestTotals = document.getElementById("digestTotals");
  const digestCardsBody = document.getElementById("digestCardsBody");
  const digestPeriodHint = document.getElementById("digestPeriodHint");
  const metaLine = document.getElementById("metaLine");

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDuration(days) {
    const d = Number(days) || 0;
    if (d <= 0) return "—";
    const minutes = d * 24 * 60;
    if (minutes < 90) return `${Math.max(1, Math.round(minutes))} min`;
    if (d < 1) return `${(d * 24).toFixed(1)} h`;
    return `${d.toFixed(2)} d`;
  }

  function deltaChip(label) {
    if (label == null || label === "" || label === "0") return "";
    const up = String(label).startsWith("+") || Number(label) > 0;
    const down = String(label).startsWith("-") || Number(label) < 0;
    const cls = up ? "up" : down ? "down" : "";
    return `<span class="delta ${cls}">${esc(label)}</span>`;
  }

  function renderTotals(metrics) {
    if (!metrics) {
      digestTotals.innerHTML = `<div class="stat"><div class="label">Digest</div><div class="value">No data</div></div>`;
      return;
    }
    const cells = [
      ["Executions", metrics.total_executions, metrics.total_executions_delta_label],
      ["Adherence", metrics.adherence_rate != null ? `${metrics.adherence_rate}%` : "—", metrics.adherence_rate_delta_label],
      ["Cards closed", metrics.cards_closed, metrics.cards_closed_delta_label],
      ["Jira done", metrics.jira_done, metrics.jira_done_delta_label],
      ["Active cards", metrics.queue_cards_active, null],
      ["Avg time / card", fmtDuration(metrics.avg_time_per_card_days), metrics.avg_time_per_card_delta_label],
    ];
    digestTotals.innerHTML = cells
      .map(
        ([label, value, delta]) => `
      <div class="stat">
        <div class="label">${esc(label)}</div>
        <div class="value">${esc(value ?? "—")}</div>
        <div class="substat">${deltaChip(delta)}</div>
      </div>`
      )
      .join("");
    digestTotals.style.gridTemplateColumns = `repeat(${Math.min(cells.length, 6)}, minmax(0, 1fr))`;
  }

  function renderCards(cards) {
    if (!cards?.length) {
      digestCardsBody.innerHTML = `<tr><td colspan="6" class="empty">No cards in this digest</td></tr>`;
      return;
    }
    digestCardsBody.innerHTML = cards
      .map((c) => {
        const when = c.last_run_at ? new Date(c.last_run_at).toLocaleString() : "—";
        return `
      <tr>
        <td>
          <strong>${esc(c.title || c.queue_card_id)}</strong>
          <div class="hint" style="margin:2px 0 0">${esc(c.queue_card_id)}</div>
        </td>
        <td class="num">${esc(c.executions)}</td>
        <td class="num">${esc(fmtDuration(c.avg_time_spent_days))}</td>
        <td>${c.adherent ? '<span class="badge published">yes</span>' : '<span class="badge draft">no</span>'}</td>
        <td class="num">${esc(c.jira_done ?? 0)}</td>
        <td class="nowrap">${esc(when)}</td>
      </tr>`;
      })
      .join("");
  }

  async function loadDigest(id) {
    const res = await fetch(`/api/digests/${encodeURIComponent(id)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    const digest = body.digest || body;
    renderTotals(digest.metrics);
    renderCards(digest.cards);
    const period = digest.period?.label || digest.digestId || id;
    digestPeriodHint.textContent = period + (digest.period?.timezone ? ` · ${digest.period.timezone}` : "");
    if (metaLine && !document.getElementById("pane-digest")?.hidden) {
      metaLine.textContent = digest.computed_at
        ? `Computed ${new Date(digest.computed_at).toLocaleString()}`
        : `Digest ${digest.digestId || id}`;
    }
  }

  async function boot() {
    if (!digestSelect) return;
    try {
      const res = await fetch("/api/digests");
      const body = await res.json().catch(() => ({}));
      const items = Array.isArray(body.digests) ? body.digests : [];
      if (!items.length) {
        digestSelect.innerHTML = `<option value="">No weekly digests yet</option>`;
        renderTotals(null);
        digestCardsBody.innerHTML = `<tr><td colspan="6" class="empty">Run the weekly digest script, then refresh.</td></tr>`;
        return;
      }
      digestSelect.innerHTML = items
        .map((d) => {
          const id = d.digestId || d.id;
          const label = d.period?.label ? `${id} · ${d.period.label}` : id;
          return `<option value="${esc(id)}">${esc(label)}</option>`;
        })
        .join("");
      await loadDigest(items[0].digestId || items[0].id);
    } catch (err) {
      digestSelect.innerHTML = `<option value="">Could not load</option>`;
      if (metaLine) metaLine.textContent = err.message;
    }
  }

  digestSelect?.addEventListener("change", () => {
    if (digestSelect.value) loadDigest(digestSelect.value).catch((err) => {
      if (metaLine) metaLine.textContent = err.message;
    });
  });

  window.addEventListener("dash:route", (e) => {
    if (e.detail?.id === "digest") boot();
  });

  boot();
})();
