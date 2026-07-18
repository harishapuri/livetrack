chrome.runtime.sendMessage({ type: "get_bridge_status" }, (res) => {
  const el = document.getElementById("status");
  if (chrome.runtime.lastError) {
    el.textContent = "Background worker unavailable. Reload the extension.";
    el.className = "bad";
    return;
  }
  if (res?.connected) {
    el.textContent = "Connected to Coact desktop.";
    el.className = "ok";
  } else {
    el.textContent = "Not connected. Start the Coact desktop app.";
    el.className = "bad";
  }
});
