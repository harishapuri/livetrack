(function () {
const PAGE_SIZE = 50;

let rawData = null;
let pageUser = 0;
let pageMistake = 0;
let pageRecent = 0;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleString();
}

function rowBar(count, max) {
  const pct = max > 0 ? Math.max(6, Math.round((count / max) * 100)) : 0;
  return `<span class="bar" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
}

function filters() {
  return {
    from: document.getElementById("filterFrom")?.value || "",
    to: document.getElementById("filterTo")?.value || "",
    lob: document.getElementById("filterLob")?.value || "",
    card: document.getElementById("filterCard")?.value || "",
    user: (document.getElementById("filterUser")?.value || "").trim().toLowerCase(),
  };
}

function runDate(r) {
  return String(r.run_date || (r.completed_at || r.at || "").slice(0, 10) || "");
}

function filterRuns(runs) {
  const f = filters();
  return (runs || []).filter((r) => {
    const d = runDate(r);
    if (f.from && d && d < f.from) return false;
    if (f.to && d && d > f.to) return false;
    if (f.lob && String(r.lob || "") !== f.lob) return false;
    if (f.card && String(r.queue_card_id || r.queue_card || "") !== f.card) return false;
    if (f.user) {
      const u = String(r.user_id || "").toLowerCase();
      if (!u.includes(f.user)) return false;
    }
    return true;
  });
}

function filterMistakeRows(rows) {
  const f = filters();
  return (rows || []).filter((r) => {
    const d = runDate(r);
    if (f.from && d && d < f.from) return false;
    if (f.to && d && d > f.to) return false;
    if (f.lob && String(r.lob || "") !== f.lob) return false;
    if (f.card && String(r.queue_card_id || r.queue_card || "") !== f.card) return false;
    if (f.user) {
      const u = String(r.user_id || "").toLowerCase();
      if (!u.includes(f.user)) return false;
    }
    return true;
  });
}

function aggregateFromRuns(runs) {
  const byLob = {};
  const byUser = {};
  const byQueueCard = {};
  const bump = (map, key, fillMode, mc) => {
    if (!key) key = "(unknown)";
    if (!map[key]) {
      map[key] = { name: key, count: 0, automated: 0, manual: 0, mixed: 0, capture: 0, mistakes: 0 };
    }
    map[key].count += 1;
    const mode = fillMode === "manual" || fillMode === "mixed" || fillMode === "capture" ? fillMode : "automated";
    map[key][mode] += 1;
    map[key].mistakes += Number(mc) || 0;
  };

  for (const r of runs) {
    const mc = Number(r.mistake_count) || 0;
    bump(byLob, r.lob || "TCOO", r.fill_mode, mc);
    bump(byUser, r.user_id || "(unknown)", r.fill_mode, mc);
    const cardKey = r.queue_card_id || r.queue_card || "(unknown)";
    if (!byQueueCard[cardKey]) {
      byQueueCard[cardKey] = {
        name: cardKey,
        title: r.queue_card || cardKey,
        lob: r.lob || "TCOO",
        count: 0,
        automated: 0,
        manual: 0,
        mixed: 0,
        capture: 0,
        mistakes: 0,
      };
    }
    byQueueCard[cardKey].count += 1;
    const mode =
      r.fill_mode === "manual" || r.fill_mode === "mixed" || r.fill_mode === "capture"
        ? r.fill_mode
        : "automated";
    byQueueCard[cardKey][mode] += 1;
    byQueueCard[cardKey].mistakes += mc;
  }

  const sort = (arr) =>
    Object.values(arr).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    byLob: sort(byLob),
    byUser: sort(byUser),
    byQueueCard: Object.values(byQueueCard).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    ),
    byFillMode: {
      automated: runs.filter((r) => r.fill_mode === "automated" || !r.fill_mode).length,
      manual: runs.filter((r) => r.fill_mode === "manual").length,
      mixed: runs.filter((r) => r.fill_mode === "mixed").length,
      capture: runs.filter((r) => r.fill_mode === "capture").length,
    },
  };
}

function renderPager(el, page, total, onPage) {
  if (!el) return;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  if (total <= PAGE_SIZE) {
    el.innerHTML = total ? `<span class="pager-meta">${total} rows</span>` : "";
    return;
  }
  el.innerHTML = `
    <button type="button" data-dir="-1" ${cur <= 0 ? "disabled" : ""}>Prev</button>
    <span class="pager-meta">Page ${cur + 1} / ${pages} · ${total} rows</span>
    <button type="button" data-dir="1" ${cur >= pages - 1 ? "disabled" : ""}>Next</button>
  `;
  el.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dir = Number(btn.getAttribute("data-dir"));
      onPage(Math.max(0, Math.min(pages - 1, cur + dir)));
    });
  });
}

function slicePage(rows, page) {
  const start = page * PAGE_SIZE;
  return rows.slice(start, start + PAGE_SIZE);
}

function renderTotals(agg, mistakeRows, meta) {
  const el = document.getElementById("totals");
  const wrongRuns = mistakeRows.length;
  const wrongFields = mistakeRows.reduce((n, r) => n + (Number(r.mistake_count) || 0), 0);
  el.innerHTML = `
    <article class="stat">
      <div class="label">Total executions</div>
      <div class="value">${agg.byLob.reduce((n, r) => n + r.count, 0)}</div>
    </article>
    <article class="stat">
      <div class="label">Automated</div>
      <div class="value">${agg.byFillMode.automated}</div>
    </article>
    <article class="stat">
      <div class="label">Manual</div>
      <div class="value">${agg.byFillMode.manual}</div>
    </article>
    <article class="stat">
      <div class="label">Wrong-fill runs</div>
      <div class="value">${wrongRuns}</div>
      <div class="substat">${wrongFields} mandatory fields · ${meta.rangeLabel}</div>
    </article>
    ${
      agg.byFillMode.capture
        ? `<article class="stat">
      <div class="label">Capture agent</div>
      <div class="value">${agg.byFillMode.capture}</div>
    </article>`
        : ""
    }
  `;
}

function renderLob(rows) {
  const max = rows[0]?.count || 0;
  const body = document.getElementById("lobBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">No LOB data in filter</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td><strong>${esc(r.name)}</strong>${rowBar(r.count, max)}</td>
      <td class="num">${r.count}</td>
      <td class="num">${r.automated}</td>
      <td class="num">${r.manual}</td>
      <td class="num">${r.mistakes || 0}</td>
    </tr>`
    )
    .join("");
}

function renderUsers(rows) {
  const max = rows[0]?.count || 0;
  const body = document.getElementById("userBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">No user data in filter</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td><strong>${esc(r.name)}</strong>${rowBar(r.count, max)}</td>
      <td class="num">${r.count}</td>
      <td class="num">${r.automated}</td>
      <td class="num">${r.manual}</td>
      <td class="num">${r.mistakes || 0}</td>
    </tr>`
    )
    .join("");
}

function renderCards(rows) {
  const max = rows[0]?.count || 0;
  const body = document.getElementById("cardBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">No queue card data in filter</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>
        <strong>${esc(r.name)}</strong>
        <div class="hint" style="margin:2px 0 0">${esc(r.title || "")}</div>
        ${rowBar(r.count, max)}
      </td>
      <td>${esc(r.lob)}</td>
      <td class="num">${r.count}</td>
      <td class="num">${r.automated}</td>
      <td class="num">${r.manual}</td>
      <td class="num">${r.mistakes || 0}</td>
    </tr>`
    )
    .join("");
}

function renderMistakeChips(mistakes, detailsFallback) {
  if (Array.isArray(mistakes) && mistakes.length) {
    return `<ul class="mistake-chips">${mistakes
      .map((m) => {
        const key = m.field_key || m.label || "field";
        return `<li>
          <span class="chip-key">${esc(key)}</span>
          <span class="chip-actual">${esc(m.actual || "")}</span>
          <span class="chip-arrow">→</span>
          <span class="chip-expected">${esc(m.expected || "")}</span>
        </li>`;
      })
      .join("")}</ul>`;
  }
  return `<div class="details">${esc(detailsFallback || "")}</div>`;
}

function renderMistakes(rows) {
  const body = document.getElementById("mistakeBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">No wrong fills in filter</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td class="nowrap">${fmtWhen(r.at)}</td>
      <td><strong>${esc(r.user_id)}</strong></td>
      <td>${esc(r.lob)}</td>
      <td>${esc(r.queue_card_id || r.queue_card)}</td>
      <td class="num">${r.mistake_count || 0}</td>
      <td>${renderMistakeChips(r.mistakes, r.details)}</td>
    </tr>`
    )
    .join("");
}

function renderRecent(rows) {
  const body = document.getElementById("recentBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">No executions in filter</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((r) => {
      const mode = r.fill_mode || "automated";
      return `
    <tr>
      <td class="nowrap">${fmtWhen(r.completed_at || r.run_date)}</td>
      <td>${esc(r.lob)}</td>
      <td>${esc(r.queue_card_id || r.queue_card)}</td>
      <td>${esc(r.user_id)}</td>
      <td><span class="mode ${esc(mode)}">${esc(mode)}</span></td>
      <td class="num">${r.mistake_count || 0}</td>
    </tr>`;
    })
    .join("");
}

function fillFilterOptions(data) {
  const lobSel = document.getElementById("filterLob");
  const cardSel = document.getElementById("filterCard");
  const lobs = [...new Set((data.recent || []).map((r) => r.lob).filter(Boolean))].sort();
  const cards = [
    ...new Set((data.recent || []).map((r) => r.queue_card_id || r.queue_card).filter(Boolean)),
  ].sort();
  const keepLob = lobSel.value;
  const keepCard = cardSel.value;
  lobSel.innerHTML =
    `<option value="">All</option>` + lobs.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
  cardSel.innerHTML =
    `<option value="">All</option>` +
    cards.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  lobSel.value = keepLob;
  cardSel.value = keepCard;
  if (data.dateFrom && !document.getElementById("filterFrom").value) {
    document.getElementById("filterFrom").value = data.dateFrom;
  }
  if (data.dateTo && !document.getElementById("filterTo").value) {
    document.getElementById("filterTo").value = data.dateTo;
  }
}

function paint() {
  if (!rawData) return;
  const runs = filterRuns(rawData.recent || []);
  const mistakeRows = filterMistakeRows(rawData.recentMistakes || []);
  const agg = aggregateFromRuns(runs);
  const rangeLabel = `${filters().from || rawData.dateFrom || "…"} → ${
    filters().to || rawData.dateTo || "…"
  }`;

  document.getElementById("metaLine").textContent = `Source: Excel · ${
    runs.length
  } executions in view · ${mistakeRows.length} wrong-fill runs · Updated ${fmtWhen(
    rawData.generatedAt
  )}`;

  renderTotals(agg, mistakeRows, { rangeLabel });
  renderLob(agg.byLob);
  renderCards(agg.byQueueCard);

  const users = agg.byUser;
  renderUsers(slicePage(users, pageUser));
  renderPager(document.getElementById("userPager"), pageUser, users.length, (p) => {
    pageUser = p;
    paint();
  });

  renderMistakes(slicePage(mistakeRows, pageMistake));
  renderPager(document.getElementById("mistakePager"), pageMistake, mistakeRows.length, (p) => {
    pageMistake = p;
    paint();
  });

  renderRecent(slicePage(runs, pageRecent));
  renderPager(document.getElementById("recentPager"), pageRecent, runs.length, (p) => {
    pageRecent = p;
    paint();
  });
}

function resetPages() {
  pageUser = 0;
  pageMistake = 0;
  pageRecent = 0;
}

function bindFilters() {
  ["filterFrom", "filterTo", "filterLob", "filterCard", "filterUser"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => {
      resetPages();
      paint();
    });
    document.getElementById(id)?.addEventListener("change", () => {
      resetPages();
      paint();
    });
  });
  document.getElementById("btnClearFilters")?.addEventListener("click", () => {
    document.getElementById("filterFrom").value = rawData?.dateFrom || "";
    document.getElementById("filterTo").value = rawData?.dateTo || "";
    document.getElementById("filterLob").value = "";
    document.getElementById("filterCard").value = "";
    document.getElementById("filterUser").value = "";
    resetPages();
    paint();
  });
}

function loadData(data) {
  rawData = data;
  fillFilterOptions(data);
  resetPages();
  paint();
}

async function boot() {
  const meta = document.getElementById("metaLine");
  bindFilters();

  if (window.DASHBOARD_DATA) {
    loadData(window.DASHBOARD_DATA);
  }

  if (location.protocol === "http:" || location.protocol === "https:") {
    try {
      const res = await fetch(`./data.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loadData(await res.json());
    } catch (err) {
      if (!window.DASHBOARD_DATA) {
        meta.textContent = `Could not load data — run npm run dashboard or generate-day-sql. (${err.message})`;
      }
    }
  } else if (window.DASHBOARD_DATA) {
    meta.title = "Opened via file:// — using embedded data.js. For Queue studio APIs use npm run dashboard.";
  } else {
    meta.textContent =
      "No data.js yet — run npm run dashboard (or generate-day-sql), then reopen this file.";
  }
}

window.addEventListener("dash:route", (e) => {
  if (e.detail?.id === "executions" && rawData) paint();
  syncCapturePoll();
});

function captureLiveOpen() {
  return document.getElementById("captureLiveToggle")?.getAttribute("aria-expanded") === "true";
}

function setCaptureLiveOpen(open) {
  const toggle = document.getElementById("captureLiveToggle");
  const body = document.getElementById("captureLiveBody");
  if (!toggle || !body) return;
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  body.hidden = !open;
  syncCapturePoll();
}

document.getElementById("captureLiveToggle")?.addEventListener("click", () => {
  setCaptureLiveOpen(!captureLiveOpen());
});

function renderCaptureTransactions(payload) {
  const body = document.getElementById("captureTxnBody");
  const hint = document.getElementById("captureLiveHint");
  const meta = document.getElementById("captureLiveMeta");
  if (!body) return;
  const rows = payload?.transactions || [];
  if (meta) {
    meta.textContent = rows.length
      ? `${rows.length} transaction${rows.length === 1 ? "" : "s"}`
      : "Click to open";
  }
  if (hint) {
    if (!payload?.ok && payload?.error) {
      hint.textContent = `Capture agent offline — showing saved transactions if any. ${payload.error}`;
    } else if (payload?.recording) {
      hint.textContent = `Capture agent is recording · ${rows.length} transaction${
        rows.length === 1 ? "" : "s"
      } · one JSON object per row`;
    } else {
      hint.textContent = "One JSON object per capture-agent transaction";
    }
  }
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty">No capture-agent transactions yet. Start recording in LiveTrack while filling a form.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((txn) => {
      const json = JSON.stringify(txn, null, 2);
      const ticket = txn.ticket || "";
      return `
    <tr class="${txn.live ? "capture-txn-live" : ""}">
      <td class="nowrap">${fmtWhen(txn.completedAt)}</td>
      <td><strong>${esc(txn.user || "—")}</strong></td>
      <td class="nowrap"><button type="button" class="ticket-copy" data-ticket="${esc(ticket)}">${esc(ticket || "—")}</button></td>
      <td><pre class="capture-json">${esc(json)}</pre></td>
    </tr>`;
    })
    .join("");
}

document.getElementById("captureTxnBody")?.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-ticket]");
  if (!btn) return;
  const ticket = btn.getAttribute("data-ticket") || "";
  if (!ticket) return;
  try {
    await navigator.clipboard.writeText(ticket);
    const prev = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => {
      btn.textContent = prev;
    }, 1200);
  } catch {
    btn.textContent = ticket;
  }
});

let capturePollTimer = null;

async function refreshCaptureLive() {
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  if (document.getElementById("pane-executions")?.hidden) return;
  if (!captureLiveOpen()) return;
  try {
    const res = await fetch(`/api/capture/live?t=${Date.now()}`);
    const body = await res.json().catch(() => ({}));
    renderCaptureTransactions(body);
  } catch (err) {
    renderCaptureTransactions({ ok: false, transactions: [], error: err.message });
  }
}

function syncCapturePoll() {
  const onExecutions = !document.getElementById("pane-executions")?.hidden;
  if (onExecutions && captureLiveOpen()) startCapturePoll();
  else stopCapturePoll();
}

function startCapturePoll() {
  refreshCaptureLive();
  if (capturePollTimer) return;
  capturePollTimer = setInterval(refreshCaptureLive, 2500);
}

function stopCapturePoll() {
  if (!capturePollTimer) return;
  clearInterval(capturePollTimer);
  capturePollTimer = null;
}

boot();
syncCapturePoll();
})();
