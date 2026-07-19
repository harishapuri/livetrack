function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(el, msg, kind) {
  if (!el) return;
  el.textContent = msg || "";
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function apiBase() {
  if (location.protocol === "http:" || location.protocol === "https:") return "";
  return "http://127.0.0.1:4175";
}

/** file:// cannot reliably call localhost APIs — bounce to the server URL */
function preferHttpServer(pathSuffix) {
  if (location.protocol !== "file:") return false;
  const target = `http://127.0.0.1:4175${pathSuffix}`;
  location.replace(target);
  return true;
}

async function api(path, opts) {
  const url = `${apiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
      ...opts,
    });
  } catch {
    throw new Error(
      "Cannot reach dashboard API. Open http://127.0.0.1:4175/assignments/ (not a file:// page). Run: npm run dashboard"
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function parseUsers(raw) {
  return [
    ...new Set(
      String(raw || "")
        .split(/[,;\s]+/)
        .map((u) => u.trim())
        .filter(Boolean)
    ),
  ];
}

function formatUsers(list) {
  return (list || []).join(", ");
}

let state = {
  lobs: {},
  cards: {},
  cardList: [],
  knownUsers: [],
};

function fillSuggestions() {
  const dl = document.getElementById("userSuggestions");
  dl.innerHTML = state.knownUsers
    .map((u) => `<option value="${esc(u)}"></option>`)
    .join("");

  const renderChips = (el, inputId) => {
    el.innerHTML = state.knownUsers
      .map((u) => `<button type="button" data-user="${esc(u)}">${esc(u)}</button>`)
      .join("");
    el.querySelectorAll("button[data-user]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.getElementById(inputId);
        const cur = parseUsers(input.value);
        const u = btn.getAttribute("data-user");
        if (!cur.includes(u)) cur.push(u);
        input.value = formatUsers(cur);
      });
    });
  };
  renderChips(document.getElementById("knownUsersLob"), "lobUsers");
  renderChips(document.getElementById("knownUsersCard"), "cardUsers");
}

function fillLobSelect() {
  const sel = document.getElementById("lobSelect");
  const keep = sel.value;
  const names = Object.keys(state.lobs).sort((a, b) => a.localeCompare(b));
  sel.innerHTML =
    `<option value="">— Select LOB —</option>` +
    names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  if (keep && names.includes(keep)) sel.value = keep;
}

function fillCardSelect() {
  const sel = document.getElementById("cardSelect");
  const keep = sel.value;
  const cards = [...(state.cardList || [])].sort(
    (a, b) => a.lob.localeCompare(b.lob) || a.id.localeCompare(b.id)
  );
  sel.innerHTML =
    `<option value="">— Select card —</option>` +
    cards
      .map(
        (c) =>
          `<option value="${esc(c.lob)}/${esc(c.id)}">${esc(c.lob)} / ${esc(c.id)} — ${esc(
            c.title
          )}</option>`
      )
      .join("");
  if (keep) sel.value = keep;
}

function renderTable() {
  const body = document.getElementById("assignBody");
  const rows = [];
  for (const [lob, users] of Object.entries(state.lobs).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    rows.push({
      scope: "LOB",
      name: lob,
      users: users || [],
    });
  }
  for (const c of state.cardList || []) {
    const key = `${c.lob}/${c.id}`;
    const users = state.cards[key] || c.assignees || [];
    if (!users.length) continue;
    rows.push({
      scope: "Card",
      name: key,
      users,
    });
  }
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="3" class="empty">No restrictions yet — everyone sees all LOBs/cards</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${esc(r.scope)}</td>
      <td><code>${esc(r.name)}</code></td>
      <td>${
        r.users.length
          ? r.users.map((u) => `<span class="mode automated">${esc(u)}</span>`).join(" ")
          : "<em>everyone</em>"
      }</td>
    </tr>`
    )
    .join("");
}

function onLobChange() {
  const lob = document.getElementById("lobSelect").value;
  document.getElementById("lobUsers").value = formatUsers(state.lobs[lob] || []);
}

function onCardChange() {
  const key = document.getElementById("cardSelect").value;
  document.getElementById("cardUsers").value = formatUsers(state.cards[key] || []);
}

async function refresh() {
  const data = await api("/api/assignments");
  state = {
    lobs: data.lobs || {},
    cards: data.cards || {},
    cardList: data.cardList || [],
    knownUsers: data.knownUsers || [],
  };
  fillSuggestions();
  fillLobSelect();
  fillCardSelect();
  onLobChange();
  onCardChange();
  renderTable();
  document.getElementById("assignHint").textContent = `Root: ${data.rootDir || "—"} · empty assignees = everyone`;
}

async function saveLob(clear) {
  const status = document.getElementById("lobStatus");
  const lob = document.getElementById("lobSelect").value;
  if (!lob) {
    setStatus(status, "Pick a LOB", "err");
    return;
  }
  const assignees = clear ? [] : parseUsers(document.getElementById("lobUsers").value);
  setStatus(status, "Saving…");
  try {
    const res = await api(`/api/assignments/lob/${encodeURIComponent(lob)}`, {
      method: "PUT",
      body: JSON.stringify({ assignees }),
    });
    state.lobs[lob] = res.assignees || [];
    document.getElementById("lobUsers").value = formatUsers(res.assignees);
    renderTable();
    setStatus(
      status,
      res.assignees?.length
        ? `LOB ${lob} → ${res.assignees.join(", ")}`
        : `LOB ${lob} open to everyone`,
      "ok"
    );
  } catch (err) {
    setStatus(status, err.message, "err");
  }
}

async function saveCard(clear) {
  const status = document.getElementById("cardStatus");
  const key = document.getElementById("cardSelect").value;
  if (!key) {
    setStatus(status, "Pick a queue card", "err");
    return;
  }
  const [lob, id] = key.split("/");
  const assignees = clear ? [] : parseUsers(document.getElementById("cardUsers").value);
  setStatus(status, "Saving…");
  try {
    const res = await api(
      `/api/assignments/card/${encodeURIComponent(lob)}/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify({ assignees }),
      }
    );
    state.cards[key] = res.assignees || [];
    const card = state.cardList.find((c) => c.lob === lob && c.id === id);
    if (card) card.assignees = res.assignees || [];
    document.getElementById("cardUsers").value = formatUsers(res.assignees);
    renderTable();
    setStatus(
      status,
      res.assignees?.length
        ? `Card ${key} → ${res.assignees.join(", ")}`
        : `Card ${key} open to everyone`,
      "ok"
    );
  } catch (err) {
    setStatus(status, err.message, "err");
  }
}

function bind() {
  document.getElementById("lobSelect").addEventListener("change", onLobChange);
  document.getElementById("cardSelect").addEventListener("change", onCardChange);
  document.getElementById("btnSaveLob").addEventListener("click", () => saveLob(false));
  document.getElementById("btnClearLob").addEventListener("click", () => saveLob(true));
  document.getElementById("btnSaveCard").addEventListener("click", () => saveCard(false));
  document.getElementById("btnClearCard").addEventListener("click", () => saveCard(true));
}

async function boot() {
  if (preferHttpServer("/assignments/")) return;
  bind();
  try {
    await refresh();
  } catch (err) {
    setStatus(document.getElementById("lobStatus"), err.message, "err");
  }
}

boot();
