// Browse pages need the mock server for /api/* — file:// will not work.
if (location.protocol === "file:") {
  document.body.innerHTML =
    '<main style="font:16px/1.5 system-ui;padding:2rem;max-width:36rem">' +
    "<h1>Open via the mock server</h1>" +
    "<p>Use <a href=\"http://127.0.0.1:4176/\">http://127.0.0.1:4176/</a> " +
    "(run <code>npm run jira-mock</code>).</p></main>";
  throw new Error("Open http://127.0.0.1:4176/ instead of file://");
}

function issueKeyFromPath() {
  const m = location.pathname.match(/\/browse\/([^/]+)\/?$/i);
  return m ? decodeURIComponent(m[1]).toUpperCase() : null;
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.errorMessages?.join("; ") || res.statusText);
  }
  return data;
}

function isAttachImage(name, mime) {
  return (
    /^image\//i.test(String(mime || "")) ||
    /\.(png|jpe?g|gif|webp)$/i.test(String(name || ""))
  );
}

function renderAttachments(items) {
  if (!items.length) {
    return `<p class="attach-empty">No attachments</p>`;
  }
  return items
    .map((item) => {
      const href = escapeHtml(item.content || item.url || "");
      const name = escapeHtml(item.filename || "file");
      if (isAttachImage(item.filename, item.mimeType) && href) {
        return `<div class="attach-item"><a href="${href}" target="_blank" rel="noreferrer">${name}</a><img src="${href}" alt="${name}" /></div>`;
      }
      return `<div class="attach-item"><a href="${href}" target="_blank" rel="noreferrer">${name}</a></div>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1800);
}

function renderIssue(issue, comments) {
  document.title = `${issue.key} ${issue.summary} — Mock Jira`;
  document.getElementById("navKey").textContent = issue.key;
  document.getElementById("navUrl").textContent = location.href;

  const main = document.getElementById("main");
  main.className = "issue-layout";
  main.innerHTML = `
    <section class="panel primary">
      <div class="type-row">
        <span class="type-pill">${escapeHtml(issue.issueType || "Story")}</span>
        <a class="key-link" href="/browse/${encodeURIComponent(issue.key)}">${escapeHtml(issue.key)}</a>
      </div>
      <input class="summary-input" id="summary" value="${escapeHtml(issue.summary)}" aria-label="Summary" />
      <h2 class="section-title">Description</h2>
      <textarea class="description" id="description" aria-label="Description">${escapeHtml(
        issue.description || ""
      )}</textarea>
      <h2 class="section-title">Attachments</h2>
      <div class="attach-list" id="attachList">${renderAttachments(issue.attachments || [])}</div>
      <div class="activity">
        <h2 class="section-title">Activity</h2>
        <ul class="comment-list" id="commentList"></ul>
        <textarea class="comment-box" id="commentBody" placeholder="Add a comment…"></textarea>
        <div class="actions" style="margin-top:0">
          <button class="btn" type="button" id="btnComment" title="AI refines your draft, then posts it">
            Comment
          </button>
        </div>
      </div>
    </section>
    <aside class="panel side">
      <div class="meta-grid">
        <div class="meta-row">
          <label for="status">Status</label>
          <select id="status">
            ${["To Do", "In Progress", "In Review", "Blocked", "Done"]
              .map(
                (s) =>
                  `<option value="${s}" ${s === issue.status ? "selected" : ""}>${s}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="meta-row">
          <label for="priority">Priority</label>
          <select id="priority">
            ${["Highest", "High", "Medium", "Low", "Lowest"]
              .map(
                (s) =>
                  `<option value="${s}" ${s === issue.priority ? "selected" : ""}>${s}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="meta-row">
          <label for="assignee">Assignee</label>
          <input id="assignee" value="${escapeHtml(issue.assignee || "Demo Agent")}" />
        </div>
        <div class="meta-row">
          <label>Reporter</label>
          <input value="${escapeHtml(issue.reporter || "Demo Agent")}" readonly />
        </div>
        <div class="meta-row">
          <label>Labels</label>
          <input id="labels" value="${escapeHtml((issue.labels || []).join(", "))}" />
        </div>
      </div>
      <div class="actions">
        <button class="btn" type="button" id="btnSave">Save changes</button>
        <button class="btn ghost" type="button" id="btnTouch">Touch updated</button>
      </div>
      <p class="updated" id="updated">Updated ${new Date(issue.updated).toLocaleString()}</p>
    </aside>
  `;

  const list = document.getElementById("commentList");
  if (!comments.length) {
    list.innerHTML = `<li><span class="comment-meta">No comments yet</span>Be the first to comment.</li>`;
  } else {
    for (const c of comments.slice().reverse()) {
      const li = document.createElement("li");
      li.innerHTML = `<div class="comment-meta">${escapeHtml(
        c.author?.displayName || "User"
      )} · ${new Date(c.created).toLocaleString()}</div>${escapeHtml(c.body)}`;
      list.appendChild(li);
    }
  }

  document.getElementById("btnSave").addEventListener("click", async () => {
    const labels = document
      .getElementById("labels")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await api(`/api/issues/${encodeURIComponent(issue.key)}`, {
      method: "PATCH",
      body: JSON.stringify({
        summary: document.getElementById("summary").value.trim(),
        description: document.getElementById("description").value,
        status: document.getElementById("status").value,
        priority: document.getElementById("priority").value,
        assignee: document.getElementById("assignee").value.trim(),
        labels,
        touch: true,
      }),
    });
    toast("Issue saved");
    await load();
  });

  document.getElementById("btnTouch").addEventListener("click", async () => {
    await api(`/api/issues/${encodeURIComponent(issue.key)}`, {
      method: "PATCH",
      body: JSON.stringify({ touch: true }),
    });
    toast("Updated timestamp refreshed");
    await load();
  });

  document.getElementById("btnComment").addEventListener("click", async () => {
    const draft = document.getElementById("commentBody").value.trim();
    if (!draft) {
      toast("Type a draft first");
      return;
    }
    const btn = document.getElementById("btnComment");
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = "AI…";
    try {
      await api(`/api/issues/${encodeURIComponent(issue.key)}/ai-comment`, {
        method: "POST",
        body: JSON.stringify({ draft }),
      });
      document.getElementById("commentBody").value = "";
      toast("Comment posted");
      await load();
    } catch (err) {
      toast(err.message || "Comment failed");
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });
}

async function load() {
  const key = issueKeyFromPath();
  const main = document.getElementById("main");
  if (!key) {
    main.innerHTML = `<p class="error">Missing issue key in URL. Use /browse/LIVEACT-101</p>`;
    return;
  }
  try {
    const issue = await api(`/api/issues/${encodeURIComponent(key)}`);
    const { comments } = await api(`/api/issues/${encodeURIComponent(key)}/comments`);
    renderIssue(issue, comments || []);
  } catch (err) {
    main.innerHTML = `<p class="error">${escapeHtml(err.message || String(err))}</p>`;
  }
}

load();
