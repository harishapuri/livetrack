(function () {
  const COLORS = ["#d41c2c", "#fccc44", "#1a9e63", "#5c5752", "#b31e30", "#c9a227", "#3d6ea8", "#8b5a2b"];
  let grain = "month";
  let lastOptions = null;
  let loaded = false;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString();
  }

  function colorAt(i) {
    return COLORS[i % COLORS.length];
  }

  function donut(slices, valueKey = "value") {
    const rows = (slices || []).filter((s) => Number(s[valueKey] || s.count || 0) > 0);
    const total = rows.reduce((n, s) => n + Number(s[valueKey] || s.count || 0), 0);
    if (!total) return `<p class="chart-empty">No data in this filter.</p>`;
    const r = 42;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = rows
      .map((s, i) => {
        const v = Number(s[valueKey] || s.count || 0);
        const len = (v / total) * c;
        const dash = `${len} ${c - len}`;
        const el = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${colorAt(i)}" stroke-width="16" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)" />`;
        offset += len;
        return el;
      })
      .join("");
    const legend = rows
      .map((s, i) => {
        const v = Number(s[valueKey] || s.count || 0);
        const label = s.label || s.name || s.feature || "—";
        return `<li><span class="swatch" style="background:${colorAt(i)}"></span><span>${esc(label)}</span><strong>${fmt(v)}</strong></li>`;
      })
      .join("");
    return `<div class="donut-wrap"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${r}" fill="none" stroke="#ead9a8" stroke-width="16"/>${arcs}<text x="60" y="64" text-anchor="middle" font-size="13" font-weight="700" fill="#1a1a1a">${fmt(total)}</text></svg><ul class="chart-legend">${legend}</ul></div>`;
  }

  function hbars(rows, valueKey = "count") {
    const list = (rows || []).slice(0, 12);
    const max = Math.max(0, ...list.map((r) => Number(r[valueKey] || 0)));
    if (!list.length || !max) return `<p class="chart-empty">No data in this filter.</p>`;
    return `<div class="hbar">${list
      .map((r) => {
        const v = Number(r[valueKey] || 0);
        const pct = Math.max(4, Math.round((v / max) * 100));
        const label = r.label || r.name || r.title || "—";
        return `<div class="hbar-row"><span class="name" title="${esc(label)}">${esc(label)}</span><span class="hbar-track"><span style="width:${pct}%"></span></span><span class="num">${fmt(v)}</span></div>`;
      })
      .join("")}</div>`;
  }

  function columns(series, valueKey = "count") {
    const list = series || [];
    const max = Math.max(0, ...list.map((r) => Number(r[valueKey] || 0)));
    if (!list.length) return `<p class="chart-empty">No time series in this range.</p>`;
    return `<div class="cols">${list
      .map((r) => {
        const v = Number(r[valueKey] || 0);
        const h = max > 0 ? Math.max(2, Math.round((v / max) * 120)) : 2;
        return `<div class="col" title="${esc(r.label || r.bucket)}: ${fmt(v)}"><span class="stem" style="height:${h}px"></span><span class="lbl">${esc(r.label || r.bucket)}</span></div>`;
      })
      .join("")}</div>`;
  }

  function panel(title, hint, inner, wide) {
    return `<section class="panel chart-panel${wide ? " wide" : ""}"><h2>${esc(title)}</h2><p class="hint">${esc(hint)}</p>${inner}</section>`;
  }

  function fillSelect(el, items, getValue, getLabel) {
    if (!el) return;
    const current = el.value;
    const opts = [`<option value="">All</option>`].concat(
      (items || []).map((item) => {
        const v = getValue(item);
        return `<option value="${esc(v)}">${esc(getLabel(item))}</option>`;
      }),
    );
    el.innerHTML = opts.join("");
    if ([...el.options].some((o) => o.value === current)) el.value = current;
  }

  function params() {
    const q = new URLSearchParams();
    q.set("grain", grain);
    const from = document.getElementById("anFrom")?.value || "";
    const to = document.getElementById("anTo")?.value || "";
    const lob = document.getElementById("anLob")?.value || "";
    const card = document.getElementById("anCard")?.value || "";
    const user = (document.getElementById("anUser")?.value || "").trim();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (lob) q.set("lob", lob);
    if (card) q.set("card", card);
    if (user) q.set("user", user);
    return q.toString();
  }

  function render(data) {
    const totals = document.getElementById("anTotals");
    const root = document.getElementById("anRoot");
    if (!totals || !root) return;
    const exec = data.executions || {};
    const cards = data.cards || {};
    const ai = data.ai || {};
    const prompt = Number(ai.prompt_tokens || 0);
    const completion = Number(ai.completion_tokens || 0);

    const seriesGrain = data.seriesGrain || (grain === "year" ? "month" : grain === "month" ? "week" : "day");
    const seriesLbl = seriesGrain === "month" ? "month" : seriesGrain === "week" ? "week" : "day";
    const rangeHint =
      data.from && data.to
        ? data.from === data.to
          ? data.from
          : `${data.from} → ${data.to}`
        : "selected range";

    const completeN = exec.complete ?? cards.complete ?? exec.total;
    const incompleteN = exec.incomplete ?? cards.incomplete;

    totals.innerHTML = `
      <article class="stat"><div class="label">Executions</div><div class="value">${fmt(exec.total)}</div><div class="substat">${esc(rangeHint)}</div></article>
      <article class="stat"><div class="label">Incomplete</div><div class="value">${fmt(incompleteN)}</div><div class="substat">${esc(rangeHint)}</div></article>
      <article class="stat"><div class="label">AI calls</div><div class="value">${fmt(ai.calls)}</div><div class="substat">${esc(rangeHint)}</div></article>
      <article class="stat"><div class="label">Total tokens</div><div class="value">${fmt(ai.total_tokens)}</div><div class="substat">${fmt(prompt)} prompt · ${fmt(completion)} completion</div></article>
      <article class="stat"><div class="label">Jira AI comments</div><div class="value">${fmt(data.jiraAi?.calls)}</div></article>
    `;

    const tokenEmpty = !ai.calls
      ? `<p class="chart-empty">No token usage yet. Use LiveAct AI (queue fill, Jira comment, Ask) after this change to populate charts.</p>`
      : "";

    const featureCards = (ai.features || [])
      .map(
        (f) =>
          `<section class="panel chart-panel"><h2>${esc(f.label || f.feature)}</h2><p class="hint">${fmt(f.calls)} calls · ${fmt(f.total_tokens)} tokens</p>${
            f.total_tokens ? donut(f.byUser, "total_tokens") : `<p class="chart-empty">Call count only (no chat tokens).</p>`
          }${hbars(f.byUser, f.total_tokens ? "total_tokens" : "calls")}</section>`,
      )
      .join("");

    root.innerHTML = [
      panel("Executions by user", "Share of completed runs", donut(exec.byUser, "count")),
      panel("Executions by queue", "LOB share", donut(exec.byLob, "count")),
      panel("Executions by card", "Top queue cards", hbars(exec.byCard, "count")),
      panel("Complete vs incomplete", "Started runs in selected range (completed vs not finished)", donut([
        { name: "Complete", count: completeN },
        { name: "Incomplete", count: incompleteN },
      ], "count")),
      panel("Executions over time", `Completed runs · one column per ${seriesLbl}`, columns(exec.series, "count"), true),
      panel("Tokens by feature", "OpenAI usage grouped by LiveTrack feature", tokenEmpty || donut(ai.byFeature, "total_tokens")),
      panel("Tokens by user", "All features combined", tokenEmpty || donut(ai.byUser, "total_tokens")),
      panel("Prompt vs completion", "Token split", donut([
        { name: "Prompt", count: prompt },
        { name: "Completion", count: completion },
      ], "count")),
      panel("Tokens over time", `One column per ${seriesLbl}`, tokenEmpty || columns(ai.series, "total_tokens"), true),
      panel("Jira AI comments by user", "Historical comment volume (before token logging)", hbars(data.jiraAi?.byUser, "count")),
      `<section class="panel chart-panel wide"><h2>Per-feature user analytics</h2><p class="hint">Donut = token share by user. Bar = tokens (or calls if tokens are zero).</p><div class="feature-grid">${featureCards || `<p class="chart-empty">No AI features logged yet.</p>`}</div></section>`,
    ].join("");

    lastOptions = data.options || lastOptions;
    fillSelect(document.getElementById("anLob"), lastOptions?.lobs || [], (x) => x, (x) => x);
    fillSelect(
      document.getElementById("anCard"),
      lastOptions?.cards || [],
      (x) => x.id,
      (x) => (x.title && x.title !== x.id ? `${x.id} — ${x.title}` : x.id),
    );
  }

  async function load() {
    const root = document.getElementById("anRoot");
    if (root && !loaded) {
      root.innerHTML = `<p class="hint" style="grid-column:1/-1">Loading analytics…</p>`;
    }
    try {
      const res = await fetch(`/api/analytics?${params()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      render(data);
      loaded = true;
    } catch (err) {
      if (root) {
        root.innerHTML = `<p class="chart-empty" style="grid-column:1/-1">Could not load analytics: ${esc(err.message || err)}</p>`;
      }
    }
  }

  function bind() {
    document.querySelectorAll(".grain-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        grain = btn.getAttribute("data-grain") || "month";
        document.querySelectorAll(".grain-btn").forEach((b) => b.classList.toggle("active", b === btn));
        load();
      });
    });
    document.getElementById("anRefresh")?.addEventListener("click", load);
    ["anFrom", "anTo", "anLob", "anCard"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", load);
    });
    document.getElementById("anUser")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") load();
    });
  }

  bind();
  window.addEventListener("dash:route", (e) => {
    if (e.detail?.id === "analytics") load();
  });
  if ((location.hash || "").includes("analytics")) load();
  else if (!loaded && document.querySelector('[data-pane="analytics"]:not([hidden])')) load();
})();
