function renderStatus(res) {
  const el = document.getElementById("status");
  if (chrome.runtime.lastError) {
    el.textContent = "Background worker unavailable. Click Reload on chrome://extensions.";
    el.className = "bad";
    return;
  }
  if (res?.connected) {
    el.textContent = "Connected to liveAct.";
    el.className = "ok";
  } else if (res?.connecting || res?.waitingForApp) {
    el.textContent = "Waiting for liveAct… will connect automatically when the app opens.";
    el.className = "wait";
  } else if (res?.lastError) {
    el.textContent = res.lastError;
    el.className = "bad";
  } else {
    el.textContent = "Waiting for liveAct… will connect automatically when the app opens.";
    el.className = "wait";
  }
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

refresh();
setInterval(refresh, 2000);
