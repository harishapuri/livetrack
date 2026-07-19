function renderStatus(res) {
  const el = document.getElementById("status");
  if (chrome.runtime.lastError) {
    el.textContent = "Background worker unavailable. Click Reload on chrome://extensions.";
    el.className = "bad";
    return;
  }
  if (res?.connected) {
    el.textContent = "Connected to liveAct desktop.";
    el.className = "ok";
  } else if (res?.connecting) {
    el.textContent = "Connecting to liveAct…";
    el.className = "";
  } else {
    el.textContent = res?.lastError
      ? `Not connected: ${res.lastError}`
      : "Not connected. Start liveAct, then click Reconnect.";
    el.className = "bad";
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: "get_bridge_status" }, renderStatus);
}

document.getElementById("reconnect").addEventListener("click", () => {
  const el = document.getElementById("status");
  el.textContent = "Connecting…";
  el.className = "";
  chrome.runtime.sendMessage({ type: "reconnect_bridge" }, (res) => {
    renderStatus(res);
    setTimeout(refresh, 700);
  });
});

refresh();
