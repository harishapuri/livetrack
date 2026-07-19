/** Shared message types between desktop app and Chrome extension. */

const os = require("os");

// Extension mirrors BRIDGE_PORT / default BRIDGE_URL in packages/extension/background.js
// (Chrome extensions cannot require this Node module — keep constants in sync manually).
const BRIDGE_PORT = 17321;

/** Same-machine default. liveAct + extension always run on one PC; use loopback. */
const BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;

function isPrivateIPv4(ip) {
  const parts = String(ip || "")
    .split(".")
    .map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

/**
 * Primary LAN IPv4 for this machine (runtime — never hardcode a person's IP).
 * Prefers private ranges (192.168/10/172.16–31). Falls back to 127.0.0.1.
 */
function detectPrimaryLanIPv4() {
  const nets = os.networkInterfaces() || {};
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const family = net.family;
      if (family !== "IPv4" && family !== 4) continue;
      if (net.internal) continue;
      const address = net.address;
      if (!address || address === "127.0.0.1") continue;
      if (address.startsWith("169.254.")) continue; // link-local
      candidates.push({ address, private: isPrivateIPv4(address), name });
    }
  }
  const preferred = candidates.find((c) => c.private) || candidates[0];
  return preferred?.address || "127.0.0.1";
}

/** Useful URLs for health / logging. host defaults to this machine's LAN IP. */
function bridgeEndpoints(host = detectPrimaryLanIPv4()) {
  const h = String(host || "127.0.0.1").trim() || "127.0.0.1";
  return {
    host: h,
    port: BRIDGE_PORT,
    wsUrl: `ws://${h}:${BRIDGE_PORT}`,
    httpUrl: `http://${h}:${BRIDGE_PORT}`,
    localWsUrl: `ws://127.0.0.1:${BRIDGE_PORT}`,
    localHttpUrl: `http://127.0.0.1:${BRIDGE_PORT}`,
  };
}

const MessageType = {
  HELLO: "hello",
  PING: "ping",
  PONG: "pong",
  RUN_CARD: "run_card",
  WATCH_CARD: "watch_card",
  APPLY_STEP: "apply_step",
  REPAIR_PLAN: "repair_plan",
  VALUE_CHECK_RESULT: "value_check_result",
  STEP_UPDATE: "step_update",
  CONTROL: "control",
  STATUS: "status",
  CAPTURE_SNIPPET: "capture_snippet",
  SNIPPET: "snippet",
  OPEN_URL: "open_url",
};

module.exports = {
  BRIDGE_PORT,
  BRIDGE_URL,
  MessageType,
  detectPrimaryLanIPv4,
  bridgeEndpoints,
  isPrivateIPv4,
};
