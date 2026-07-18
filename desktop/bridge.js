const { WebSocketServer } = require("ws");
const { BRIDGE_PORT, MessageType } = require("../shared/protocol");

function createBridge({ onExtensionStatus, onStepUpdate, onRunFinished }) {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: BRIDGE_PORT });
  let extensionSocket = null;

  function setExtension(socket) {
    extensionSocket = socket;
    onExtensionStatus({ connected: true });
  }

  function clearExtension(socket) {
    if (extensionSocket === socket) {
      extensionSocket = null;
      onExtensionStatus({ connected: false });
    }
  }

  wss.on("connection", (socket) => {
    setExtension(socket);

    socket.send(
      JSON.stringify({
        type: MessageType.HELLO,
        role: "desktop",
        version: "0.1.0",
      })
    );

    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === MessageType.PING) {
        socket.send(JSON.stringify({ type: MessageType.PONG }));
        return;
      }

      if (msg.type === MessageType.STATUS) {
        onExtensionStatus({
          connected: true,
          tabUrl: msg.tabUrl || null,
          tabTitle: msg.tabTitle || null,
        });
        return;
      }

      if (msg.type === MessageType.STEP_UPDATE) {
        onStepUpdate(msg);
        if (msg.status === "run_complete" || msg.status === "run_failed" || msg.status === "run_cancelled") {
          onRunFinished({
            cardId: msg.cardId,
            status: msg.status,
            error: msg.error || null,
          });
        }
      }
    });

    socket.on("close", () => clearExtension(socket));
    socket.on("error", () => clearExtension(socket));
  });

  return {
    port: BRIDGE_PORT,
    isExtensionConnected() {
      return Boolean(extensionSocket && extensionSocket.readyState === 1);
    },
    sendRunCard(payload) {
      if (!extensionSocket || extensionSocket.readyState !== 1) return false;
      extensionSocket.send(
        JSON.stringify({
          type: MessageType.RUN_CARD,
          ...payload,
        })
      );
      return true;
    },
    sendControl(action) {
      if (!extensionSocket || extensionSocket.readyState !== 1) return false;
      extensionSocket.send(
        JSON.stringify({
          type: MessageType.CONTROL,
          action,
        })
      );
      return true;
    },
    close() {
      try {
        wss.close();
      } catch {
        /* ignore */
      }
    },
  };
}

module.exports = { createBridge };
