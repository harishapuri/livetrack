/** Shared message types between desktop app and Chrome extension. */

const BRIDGE_PORT = 17321;
const BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;

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

module.exports = { BRIDGE_PORT, BRIDGE_URL, MessageType };
