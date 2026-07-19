let selectedKey = null;
let credentials = null;

// Dashboard requires the mock server (API + CORS). file:// cannot call /api/*.
if (location.protocol === "file:") {
  document.body.innerHTML =
    '<main style="font:16px/1.5 system-ui;padding:2rem;max-width:36rem">' +
    "<h1>Mock Jira needs the local server</h1>" +
    "<p>Open <a href=\"http://127.0.0.1:4176/\">http://127.0.0.1:4176/</a> " +
    "(run <code>npm run jira-mock</code> from the repo root).</p></main>";
  throw new Error("Open http://127.0.0.1:4176/ instead of file://");
}

function daysIdle(iso) {
  if (!iso) return 0;
  return Math.max(0, (Date.now() - Date.parse(iso)) / 864e5);
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.errorMessages?.join("; ") || res.statusText);
  return data;
}

function renderCreds(creds) {
  credentials = creds;
  const el = document.getElementById("creds");
  el.innerHTML = `
    <dt>Site URL</dt><dd>${creds.baseUrl}</dd>
    <dt>Email</dt><dd>${creds.email}</dd>
    <dt>API token</dt><dd>${creds.token}</dd>
    <dt>JQL</dt><dd>assignee = currentUser() ORDER BY updated ASC</dd>
  `;
}

function renderList(issues) {
  const list = document.getElementById("list");
  document.getElementById("count").textContent = `${issues.length} issues`;
  list.replaceChildren();

  for (const issue of issues) {
    const idle = daysIdle(issue.updated);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `issue${idle >= 2 ? " stale" : ""}${selectedKey === issue.key ? " selected" : ""}`;
    btn.innerHTML = `
      <div class="issue-top">
        <span class="key">${issue.key}</span>
        <span class="idle">${idle.toFixed(1)}d idle</span>
      </div>
      <div class="summary">${escapeHtml(issue.summary)}</div>
      <div class="meta">
        <span>${escapeHtml(issue.status)}</span>
        <span>${escapeHtml(issue.priority)}</span>
        <span>${escapeHtml(issue.assignee || "—")}</span>
        <span>${issue.comments || 0} comments</span>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "issue-actions";
    actions.addEventListener("click", (e) => e.stopPropagation());

    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn tiny";
    open.textContent = "Open page";
    open.addEventListener("click", () => {
      window.open(`/browse/${encodeURIComponent(issue.key)}`, "_blank");
    });

    const touch = document.createElement("button");
    touch.type = "button";
    touch.className = "btn tiny";
    touch.textContent = "Touch now";
    touch.addEventListener("click", async () => {
      await api(`/api/issues/${encodeURIComponent(issue.key)}`, {
        method: "PATCH",
        body: JSON.stringify({ touch: true }),
      });
      await load();
    });

    const stale = document.createElement("button");
    stale.type = "button";
    stale.className = "btn tiny";
    stale.textContent = "Make 5d stale";
    stale.addEventListener("click", async () => {
      await api(`/api/issues/${encodeURIComponent(issue.key)}`, {
        method: "PATCH",
        body: JSON.stringify({ updatedDaysAgo: 5 }),
      });
      await load();
    });

    actions.append(open, touch, stale);
    btn.appendChild(actions);

    // Click story → open Jira-like browse URL (same as liveAct)
    btn.addEventListener("click", () => {
      window.open(issue.url || `/browse/${encodeURIComponent(issue.key)}`, "_blank");
    });
    list.appendChild(btn);
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function selectIssue(issue) {
  selectedKey = issue.key;
  document.getElementById("fKey").value = issue.key;
  document.getElementById("fSummary").value = issue.summary;
  document.getElementById("fStatus").value = issue.status;
  document.getElementById("fPriority").value = issue.priority;
  document.getElementById("fIdle").value = String(Math.round(daysIdle(issue.updated) * 10) / 10);
  document.getElementById("btnUpdate").disabled = false;
  await loadComments(issue.key);
  await load();
}

async function loadComments(key) {
  const ul = document.getElementById("comments");
  const data = await api(`/api/issues/${encodeURIComponent(key)}/comments`);
  ul.replaceChildren();
  if (!data.comments?.length) {
    const li = document.createElement("li");
    li.textContent = "No comments yet — post one from liveAct J panel.";
    ul.appendChild(li);
    return;
  }
  for (const c of data.comments.slice().reverse()) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="when">${new Date(c.created).toLocaleString()} · ${escapeHtml(
      c.author?.displayName || ""
    )}</span>${escapeHtml(c.body)}`;
    ul.appendChild(li);
  }
}

async function load() {
  const data = await api("/api/issues");
  renderCreds(data.credentials);
  renderList(data.issues || []);
  if (selectedKey) {
    const still = (data.issues || []).find((i) => i.key === selectedKey);
    if (still) await loadComments(selectedKey);
  }
}

document.getElementById("btnRefresh").addEventListener("click", () => load());

document.getElementById("btnCopy").addEventListener("click", async () => {
  if (!credentials) return;
  const payload = {
    jiraBaseUrl: credentials.baseUrl,
    jiraEmail: credentials.email,
    jiraApiToken: credentials.token,
    jiraJql: "assignee = currentUser() ORDER BY updated ASC",
    jiraStaleDays: 2,
  };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  const btn = document.getElementById("btnCopy");
  const prev = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => {
    btn.textContent = prev;
  }, 1200);
});

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = document.getElementById("fKey").value.trim().toUpperCase();
  const idle = Number(document.getElementById("fIdle").value) || 0;
  await api("/api/issues", {
    method: "POST",
    body: JSON.stringify({
      key,
      summary: document.getElementById("fSummary").value.trim(),
      status: document.getElementById("fStatus").value,
      priority: document.getElementById("fPriority").value,
      updated: new Date(Date.now() - idle * 864e5).toISOString(),
    }),
  });
  selectedKey = key;
  document.getElementById("btnUpdate").disabled = false;
  await load();
});

document.getElementById("btnUpdate").addEventListener("click", async () => {
  if (!selectedKey) return;
  const idle = Number(document.getElementById("fIdle").value) || 0;
  await api(`/api/issues/${encodeURIComponent(selectedKey)}`, {
    method: "PATCH",
    body: JSON.stringify({
      summary: document.getElementById("fSummary").value.trim(),
      status: document.getElementById("fStatus").value,
      priority: document.getElementById("fPriority").value,
      updatedDaysAgo: idle,
    }),
  });
  await load();
});

load().catch((err) => {
  document.getElementById("list").textContent = err.message || String(err);
});
