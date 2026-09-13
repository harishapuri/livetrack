function urgencyClass(issue) {
  if (issue?.stale || (issue?.urgencyScore ?? 0) >= 6) return "urgency-high";
  if ((issue?.urgencyScore ?? 0) >= 2.5 || (issue?.daysSinceUpdate ?? 0) >= 1) return "urgency-med";
  return "";
}

function renderStatus(res) {
  const el = document.getElementById("status");
  if (chrome.runtime.lastError) {
    el.textContent = "Background worker unavailable. Click Reload on chrome://extensions.";
    el.className = "bad";
    return;
  }
  if (res?.connected) {
    el.textContent = "Connected to LiveTrack.";
    el.className = "ok";
  } else if (res?.connecting || res?.waitingForApp) {
    el.textContent = "Waiting for LiveTrack… will connect automatically when the app opens.";
    el.className = "wait";
  } else if (res?.lastError) {
    el.textContent = res.lastError;
    el.className = "bad";
  } else {
    el.textContent = "Waiting for LiveTrack… will connect automatically when the app opens.";
    el.className = "wait";
  }
  renderJira(res?.jira, Boolean(res?.connected));
}

function renderJira(snapshot, connected) {
  const meta = document.getElementById("jiraMeta");
  const list = document.getElementById("jiraList");
  if (!meta || !list) return;

  if (!connected) {
    meta.textContent = "Connect to LiveTrack to see Jira stories.";
    list.innerHTML = "";
    return;
  }
  if (!snapshot) {
    meta.textContent = "No Jira data yet — open LiveTrack Settings to configure Jira.";
    list.innerHTML = "";
    return;
  }
  if (!snapshot.ok) {
    meta.textContent = snapshot.error || "Jira unavailable";
    list.innerHTML = `<div class="empty">${snapshot.error || "Could not load stories"}</div>`;
    return;
  }

  const issues = snapshot.issues || [];
  const stale = snapshot.staleCount || 0;
  const when = snapshot.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleTimeString() : "—";
  meta.textContent = `${issues.length} stories · ${stale} stale · ${when}`;

  if (!issues.length) {
    list.innerHTML = `<div class="empty">No stories match your JQL</div>`;
    return;
  }

  list.replaceChildren();
  for (const issue of issues) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `jira-issue ${urgencyClass(issue)}`.trim();
    btn.title = `Open ${issue.key}`;

    const top = document.createElement("div");
    top.className = "jira-top";
    top.innerHTML = `<span class="jira-key">${escapeHtml(issue.key)}</span><span class="jira-score">score ${escapeHtml(
      String(issue.urgencyScore ?? "—")
    )}</span>`;

    const summary = document.createElement("div");
    summary.className = "jira-summary";
    summary.textContent = issue.summary || "";

    const metaRow = document.createElement("div");
    metaRow.className = "jira-meta-row";
    metaRow.textContent = [
      issue.sopStage || issue.status,
      issue.priority,
      `${issue.daysSinceUpdate ?? "?"}d idle`,
      issue.assignee,
    ]
      .filter(Boolean)
      .join(" · ");

    btn.append(top, summary, metaRow);
    btn.addEventListener("click", () => {
      if (issue.url) chrome.tabs.create({ url: issue.url });
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

function refresh() {
  chrome.runtime.sendMessage({ type: "get_bridge_status" }, renderStatus);
}

document.getElementById("reconnect").addEventListener("click", () => {
  const el = document.getElementById("status");
  el.textContent = "Connecting…";
  el.className = "wait";
  chrome.runtime.sendMessage({ type: "reconnect_bridge" }, (res) => {
    renderStatus(res);
    setTimeout(refresh, 700);
  });
});

const profileInput = document.getElementById("profileLabel");
if (profileInput) {
  chrome.storage.local.get(["profileLabel"], (stored) => {
    profileInput.value = stored?.profileLabel || "";
  });
  profileInput.addEventListener("change", () => {
    chrome.storage.local.set({ profileLabel: profileInput.value.trim() });
  });
}

refresh();
setInterval(refresh, 2000);
