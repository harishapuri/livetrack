/** Shared message types between desktop app and Chrome extension. */

const BRIDGE_PORT = 17321;
const BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;

const MessageType = {
  HELLO: "hello",
  PING: "ping",
  PONG: "pong",
  RUN_CARD: "run_card",
  STEP_UPDATE: "step_update",
  CONTROL: "control",
  STATUS: "status",
};

module.exports = { BRIDGE_PORT, BRIDGE_URL, MessageType };
