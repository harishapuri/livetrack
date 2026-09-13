const http = require("http");
const { WebSocketServer } = require("ws");
const {
  BRIDGE_PORT,
  MessageType,
  bridgeEndpoints,
} = require("@coact/shared/protocol");

function createBridge({
  onExtensionStatus,
  onStepUpdate,
  onRunFinished,
  onListening,
  onError,
  onReloadQueue,
  onCaptureEvent,
}) {
  const clients = new Map();
  const pendingSnippets = new Map();
  const pendingTabShots = new Map();
  let listening = false;
  /** Filled before listen() so HTTP /fill can forward to the extension. */
  let api = null;

  const connected = () =>
    [...clients.entries()].filter(([socket]) => socket.readyState === 1);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    function readJsonBody(req) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8") || "{}";
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(err);
          }
        });
        req.on("error", reject);
      });
    }

    function jsonResponse(res, status, body) {
      res.writeHead(status, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(body));
    }

    if (pathname === "/" || pathname === "/health") {
      // host/wsUrl = this machine's LAN IP at request time (never a hardcoded personal IP)
      const endpoints = bridgeEndpoints();
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(
        JSON.stringify({
          ok: true,
          service: "coact-bridge",
          port: endpoints.port,
          listen: "0.0.0.0",
          host: endpoints.host,
          wsUrl: endpoints.wsUrl,
          localWsUrl: endpoints.localWsUrl,
          extensionConnected: connected().length > 0,
          extensionClients: connected().length,
        }),
      );
      return;
    }

    // Dashboard / Queue studio → push queue+SOP reload into liveAct UI
    if (
      (pathname === "/reload-queue" || pathname === "/publish") &&
      (req.method === "POST" || req.method === "GET")
    ) {
      Promise.resolve()
        .then(() => onReloadQueue?.())
        .then((result) => {
          res.writeHead(200, { "Content-Type": "application/json", ...cors });
          res.end(
            JSON.stringify({
              ok: true,
              published: true,
              cardCount: result?.cardCount ?? null,
              ...(result || {}),
            }),
          );
        })
        .catch((err) => {
          res.writeHead(500, { "Content-Type": "application/json", ...cors });
          res.end(
            JSON.stringify({ ok: false, error: err?.message || String(err) }),
          );
        });
      return;
    }

    // AgenticAI / local agents: fill the Chrome tab the extension already owns.
    if (pathname === "/fill" && req.method === "GET") {
      jsonResponse(res, 200, {
        ok: true,
        fill: true,
        extensionConnected: connected().length > 0,
        extensionClients: connected().length,
      });
      return;
    }
    if (
      (pathname === "/fill" ||
        pathname === "/apply-step" ||
        pathname === "/open-url" ||
        pathname === "/click") &&
      (req.method === "POST" || req.method === "PUT")
    ) {
      Promise.resolve()
        .then(() => readJsonBody(req))
        .then((body) => {
          const payload = body && typeof body === "object" ? body : {};
          if (pathname === "/open-url") {
            const result = api.sendOpenUrl(payload);
            jsonResponse(res, result.ok ? 200 : 503, result);
            return;
          }
          if (pathname === "/click") {
            const result = api.sendAgentFill({ ...payload, type: "click" });
            jsonResponse(res, result.ok ? 200 : 503, result);
            return;
          }
          if (pathname === "/apply-step") {
            const result = api.sendApplyStep(payload);
            jsonResponse(res, result.ok ? 200 : 503, result);
            return;
          }
          const fills = Array.isArray(payload.fills) ? payload.fills : null;
          if (fills) {
            const results = [];
            for (const item of fills) {
              results.push(
                api.sendAgentFill({
                  ...payload,
                  ...item,
                  type: item.action || item.type || "fill",
                  target: item.target || payload.target,
                }),
              );
            }
            const ok = results.some((r) => r.ok);
            jsonResponse(res, ok ? 200 : 503, {
              ok,
              results,
              sent: results.filter((r) => r.ok).length,
            });
            return;
          }
          const result = api.sendAgentFill(payload);
          jsonResponse(res, result.ok ? 200 : 503, result);
        })
        .catch((err) => {
          jsonResponse(res, 400, {
            ok: false,
            error: err?.message || String(err),
          });
        });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });
  const wss = new WebSocketServer({ server });

  function primaryFocus() {
    const list = connected().map(([, client]) => client);
    if (!list.length) {
      return { tabUrl: null, tabTitle: null, clientId: null, activated: false };
    }
    // Prefer OS-focused browsers; if Coact has focus and all report blurred,
    // still keep a live client so the desktop stays Online.
    const focused = list.filter((c) => c.browserFocused !== false);
    const pool = focused.length ? focused : list;
    // Prefer the browser the user last activated, not whichever answered the poll last
    pool.sort(
      (a, b) =>
        (b.lastActivityAt || 0) - (a.lastActivityAt || 0) ||
        (b.lastActivatedAt || 0) - (a.lastActivatedAt || 0) ||
        (b.lastStatusAt || 0) - (a.lastStatusAt || 0),
    );
    const withPage = pool.filter((c) => c.tabUrl);
    const focus = withPage[0] || pool[0];
    return {
      tabUrl: focus.tabUrl || null,
      tabTitle: focus.tabTitle || null,
      clientId: focus.clientId || null,
      activated: Boolean(focus._emitActivated),
    };
  }

  let focusEmitTimer = null;
  let lastEmittedFocus = null;
  let lastEmittedConnected = null;
  function emitFocusStatus(extra = {}) {
    if (focusEmitTimer) clearTimeout(focusEmitTimer);
    const delay = extra.activated || extra.force ? 0 : 120;
    focusEmitTimer = setTimeout(() => {
      focusEmitTimer = null;
      const focus = primaryFocus();
      const connectedNow = connected().length > 0;
      const key = `${connectedNow ? 1 : 0}|${focus.clientId || ""}|${focus.tabUrl || ""}|${focus.tabTitle || ""}`;
      const activated = Boolean(extra.activated);
      if (
        key === lastEmittedFocus &&
        connectedNow === lastEmittedConnected &&
        !extra.force &&
        !activated &&
        !extra.reconnected
      ) {
        return;
      }
      lastEmittedFocus = key;
      lastEmittedConnected = connectedNow;
      // Clear one-shot activated flag on clients
      for (const [, client] of connected()) client._emitActivated = false;
      onExtensionStatus({
        connected: connectedNow,
        clients: connected().length,
        clientId: focus.clientId,
        tabUrl: focus.tabUrl,
        tabTitle: focus.tabTitle,
        activated,
        reconnected: Boolean(extra.reconnected),
      });
    }, delay);
  }

  function register(socket, clientId = null) {
    let client = clients.get(socket);
    if (!client) {
      client = {
        clientId,
        role: null,
        tabUrl: null,
        tabTitle: null,
        lastStatusAt: 0,
        lastActivityAt: 0,
        lastActivatedAt: 0,
        lastPongAt: Date.now(),
        browserFocused: true,
        _emitActivated: false,
      };
      clients.set(socket, client);
      lastEmittedFocus = null;
      emitFocusStatus({ force: true, reconnected: true });
    } else if (clientId) {
      const changed = client.clientId !== clientId;
      client.clientId = clientId;
      client.lastPongAt = Date.now();
      if (changed) emitFocusStatus({ force: true, reconnected: true });
    }
    return client;
  }

  function remove(socket) {
    const client = clients.get(socket);
    if (!client) return;
    clients.delete(socket);
    lastEmittedFocus = null;
    emitFocusStatus({ force: true });
  }

  function normalizeUrl(url) {
    return String(url || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "")
      .replace("localhost", "127.0.0.1");
  }

  function score(client, target = {}) {
    if (!client.tabUrl) return 0;
    const url = normalizeUrl(client.tabUrl);
    const title = String(client.tabTitle || "").toLowerCase();
    const formUrl = normalizeUrl(target.formUrl);
    let value = 0;
    if (formUrl) {
      if (url === formUrl) value = 1000;
      if (url.startsWith(`${formUrl}/`) || url.startsWith(`${formUrl}?`))
        value = Math.max(value, 900);
      const file = formUrl.split("/").pop();
      if (file?.includes(".") && url.endsWith(file))
        value = Math.max(value, 850);
    }
    for (const hint of target.formMatch || []) {
      const normalizedHint = normalizeUrl(hint);
      if (!normalizedHint || /^[\w.-]+:\d+$/.test(normalizedHint)) continue;
      if (url.includes(normalizedHint))
        value = Math.max(value, 400 + Math.min(normalizedHint.length, 80));
      if (title.includes(String(hint).toLowerCase().trim()))
        value = Math.max(value, 300 + Math.min(String(hint).length, 80));
    }
    return value;
  }

  function isExtensionClient(client) {
    return Boolean(client && (client.role === "extension" || client.tabUrl));
  }

  function bestConnectedClient(excludeSocket = null) {
    return (
      connected()
        .filter(
          ([socket, client]) =>
            socket !== excludeSocket && isExtensionClient(client),
        )
        .map(([socket, client]) => ({ socket, client }))
        .sort(
          (a, b) =>
            (b.client.lastActivityAt || 0) - (a.client.lastActivityAt || 0) ||
            (b.client.lastActivatedAt || 0) - (a.client.lastActivatedAt || 0) ||
            (b.client.lastStatusAt || 0) - (a.client.lastStatusAt || 0),
        )[0] ||
      connected()
        .filter(([socket]) => socket !== excludeSocket)
        .map(([socket, client]) => ({ socket, client }))
        .sort(
          (a, b) =>
            (b.client.lastActivityAt || 0) - (a.client.lastActivityAt || 0) ||
            (b.client.lastActivatedAt || 0) - (a.client.lastActivatedAt || 0) ||
            (b.client.lastStatusAt || 0) - (a.client.lastStatusAt || 0),
        )[0] ||
      null
    );
  }

  function targetClient(target, excludeSocket = null) {
    return (
      connected()
        .filter(([socket]) => socket !== excludeSocket)
        .map(([socket, client]) => ({
          socket,
          client,
          score: score(client, target || {}),
        }))
        .filter((entry) => entry.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score || b.client.lastStatusAt - a.client.lastStatusAt,
        )[0] || null
    );
  }

  function clientById(clientId) {
    return (
      connected()
        .map(([socket, client]) => ({ socket, client }))
        .find((entry) => entry.client.clientId === clientId) || null
    );
  }

  function send(target, message) {
    if (!target || target.socket.readyState !== 1) return false;
    try {
      target.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  function pickExtension(payload = {}, excludeSocket = null) {
    return (
      (payload.clientId && clientById(payload.clientId)) ||
      targetClient(payload.target, excludeSocket) ||
      bestConnectedClient(excludeSocket)
    );
  }

  function toApplyStep(msg) {
    const type = String(msg?.type || "").toLowerCase();
    if (type === MessageType.APPLY_STEP || type === "apply_step") {
      return { ...msg, type: MessageType.APPLY_STEP };
    }
    if (
      type === "fill" ||
      type === "setvalue" ||
      type === "set_value" ||
      type === "type"
    ) {
      const selector = msg.selector || msg.step?.selector || null;
      const value = msg.value ?? msg.step?.value ?? "";
      const id = msg.step?.id || msg.stepId || selector || `fill-${Date.now()}`;
      const label = msg.label || msg.step?.label || selector || String(id);
      return {
        type: MessageType.APPLY_STEP,
        cardId: msg.cardId || "agentic",
        data: msg.data && typeof msg.data === "object" ? msg.data : {},
        valueOverride: value,
        target: msg.target || null,
        clientId: msg.clientId || null,
        step: {
          id: String(id),
          action: "fill",
          selector,
          label,
          findByLabel:
            msg.findByLabel ||
            msg.step?.findByLabel ||
            (label ? [label] : undefined),
          value,
        },
      };
    }
    if (type === "click" || type === "check") {
      const selector = msg.selector || msg.step?.selector || null;
      const id =
        msg.step?.id || msg.stepId || selector || `${type}-${Date.now()}`;
      const label = msg.label || msg.step?.label || selector || String(id);
      return {
        type: MessageType.APPLY_STEP,
        cardId: msg.cardId || "agentic",
        data: msg.data && typeof msg.data === "object" ? msg.data : {},
        target: msg.target || null,
        clientId: msg.clientId || null,
        step: {
          id: String(id),
          action: type === "check" ? "check" : "click",
          selector,
          label,
          findByText: msg.findByText || msg.step?.findByText || null,
          findByLabel:
            msg.findByLabel ||
            msg.step?.findByLabel ||
            (label ? [label] : undefined),
        },
      };
    }
    return null;
  }

  function forwardFill(payload = {}, excludeSocket = null) {
    const apply = toApplyStep({ type: payload.type || "fill", ...payload });
    if (!apply) return { ok: false, error: "bad_fill" };
    const target = pickExtension(apply, excludeSocket);
    return send(target, apply)
      ? {
          ok: true,
          clientId: target?.client?.clientId || null,
          forwarded: true,
        }
      : { ok: false, error: "browser_unavailable" };
  }

  function forwardAgentMessage(senderSocket, msg) {
    const type = String(msg?.type || "");
    if (type === MessageType.OPEN_URL || type === "open_url") {
      const target = pickExtension(msg, senderSocket);
      const ok = send(target, {
        type: MessageType.OPEN_URL,
        url: msg.url,
        cardId: msg.cardId || null,
        matchIncludes: msg.matchIncludes || null,
      });
      return { ok, clientId: target?.client?.clientId || null };
    }
    if (type === MessageType.RUN_CARD || type === "run_card") {
      const target = pickExtension(msg, senderSocket);
      const ok = send(target, {
        type: MessageType.RUN_CARD,
        ...msg,
        type: MessageType.RUN_CARD,
      });
      return { ok, clientId: target?.client?.clientId || null };
    }
    if (type === MessageType.WATCH_CARD || type === "watch_card") {
      const target =
        pickExtension(msg, senderSocket) || bestConnectedClient(senderSocket);
      const ok = send(target, {
        type: MessageType.WATCH_CARD,
        ...msg,
        type: MessageType.WATCH_CARD,
      });
      return { ok, clientId: target?.client?.clientId || null };
    }
    if (type === MessageType.CONTROL || type === "control") {
      const target = pickExtension(msg, senderSocket);
      const ok = send(target, {
        type: MessageType.CONTROL,
        action: msg.action,
      });
      return { ok };
    }
    const apply = toApplyStep(msg);
    if (apply) {
      const target = pickExtension(apply, senderSocket);
      const ok = send(target, apply);
      return {
        ok,
        clientId: target?.client?.clientId || null,
        forwarded: true,
      };
    }
    return null;
  }

  wss.on("connection", (socket) => {
    // Register immediately so the desktop shows Online as soon as the extension
    // socket opens — don't wait for HELLO (which can race with Coact focus/blur).
    register(socket, null);
    socket.send(
      JSON.stringify({
        type: MessageType.HELLO,
        role: "desktop",
        version: "0.1.2",
      }),
    );
    const pingTimer = setInterval(() => {
      if (socket.readyState !== 1) {
        clearInterval(pingTimer);
        return;
      }
      const client = clients.get(socket);
      // Drop half-open sockets that never answer after a long idle
      if (client?.lastPongAt && Date.now() - client.lastPongAt > 60000) {
        try {
          socket.terminate();
        } catch {
          /* ignore */
        }
        clearInterval(pingTimer);
        return;
      }
      try {
        socket.send(JSON.stringify({ type: MessageType.PING }));
      } catch {
        clearInterval(pingTimer);
      }
    }, 20000);

    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === MessageType.PING) {
        send({ socket }, { type: MessageType.PONG });
        return;
      }
      if (msg.type === MessageType.HELLO) {
        const helloClient = register(socket, msg.clientId || null);
        if (msg.role) helloClient.role = msg.role;
        if (msg.profileLabel) helloClient.profileLabel = String(msg.profileLabel);
        return;
      }
      if (msg.type === MessageType.PONG) {
        const client = clients.get(socket);
        if (client) client.lastPongAt = Date.now();
        return;
      }
      if (!clients.has(socket)) {
        if (msg.type !== MessageType.STATUS || msg.role === "probe") return;
        register(socket, msg.clientId || null);
      }
      const client = clients.get(socket);
      if (msg.type === MessageType.STATUS) {
        client.clientId = msg.clientId || client.clientId;
        client.lastStatusAt = Date.now();
        client.lastPongAt = Date.now();
        if (msg.profileLabel) client.profileLabel = String(msg.profileLabel);
        if (msg.lastActivityAt) client.lastActivityAt = Number(msg.lastActivityAt) || Date.now();
        else if (msg.activated) client.lastActivityAt = Date.now();
        if (msg.browserFocused === false || msg.blurred) {
          client.browserFocused = false;
          // Prefer URL from blur payload; otherwise keep the last known form tab
          if (msg.tabUrl) client.tabUrl = msg.tabUrl;
          if (msg.tabTitle) client.tabTitle = msg.tabTitle;
          client._emitActivated = false;
          emitFocusStatus({ force: true, activated: false });
        } else {
          client.browserFocused = true;
          client.tabUrl = msg.tabUrl || client.tabUrl || null;
          client.tabTitle = msg.tabTitle || client.tabTitle || null;
          if (msg.activated) {
            client.lastActivatedAt = Date.now();
            client._emitActivated = true;
          }
          emitFocusStatus({
            activated: Boolean(msg.activated),
            force: Boolean(msg.activated),
          });
        }
      } else if (msg.type === MessageType.STEP_UPDATE) {
        onStepUpdate({ ...msg, clientId: client.clientId });
        if (
          ["run_complete", "run_failed", "run_cancelled"].includes(msg.status)
        ) {
          onRunFinished({
            cardId: msg.cardId,
            status: msg.status,
            error: msg.error || null,
            failedStepLabel: msg.failedStepLabel || null,
            reason: msg.reason || null,
            clientId: client.clientId,
          });
        }
      } else if (msg.type === MessageType.CAPTURE_EVENT) {
        const event = msg.event && typeof msg.event === "object" ? msg.event : msg;
        try {
          onCaptureEvent?.(event);
        } catch {
          /* capture is optional */
        }
      } else if (msg.type === MessageType.SNIPPET) {
        const pending = pendingSnippets.get(msg.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingSnippets.delete(msg.requestId);
        pending.resolve({
          ok: Boolean(msg.ok !== false),
          text: msg.text || "",
          title: msg.title || null,
          url: msg.url || null,
          error: msg.error || null,
        });
      } else if (msg.type === MessageType.TAB_SHOT) {
        const pending = pendingTabShots.get(msg.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingTabShots.delete(msg.requestId);
        pending.resolve({
          ok: Boolean(msg.ok !== false),
          dataUrl: msg.dataUrl || "",
          title: msg.title || null,
          url: msg.url || null,
          error: msg.error || null,
        });
      } else if (client.role !== "extension") {
        const result = forwardAgentMessage(socket, msg);
        if (result) {
          send(
            { socket },
            {
              type: "ack",
              ok: Boolean(result.ok),
              error: result.error || null,
              forwarded: Boolean(result.forwarded || result.ok),
            },
          );
        }
      }
    });
    socket.on("close", () => {
      clearInterval(pingTimer);
      remove(socket);
    });
    socket.on("error", () => {
      clearInterval(pingTimer);
      remove(socket);
    });
  });

  server.on("error", (err) => {
    listening = false;
    onError?.(err);
    console.error("[coact-bridge]", err.message);
  });

  // Keep Online/Offline truthful without forcing duplicate emits (avoids renderer thrash)
  const statusPulse = setInterval(() => {
    emitFocusStatus();
  }, 4000);

  api = {
    port: BRIDGE_PORT,
    isListening: () => listening,
    isExtensionConnected: () => connected().length > 0,
    hasMatchingTab: (target) => Boolean(targetClient(target)),
    matchingTab(target) {
      const hit = targetClient(target);
      if (!hit) return null;
      return {
        tabUrl: hit.client.tabUrl || "",
        tabTitle: hit.client.tabTitle || "",
        clientId: hit.client.clientId || null,
      };
    },
    sendRunCard(payload) {
      const target = targetClient(payload.target) || bestConnectedClient();
      return send(target, { type: MessageType.RUN_CARD, ...payload })
        ? { ok: true, clientId: target.client.clientId }
        : { ok: false, error: "browser_unavailable" };
    },
    sendWatchCard(payload) {
      if (!payload.cardId) {
        connected().forEach(([socket]) =>
          send({ socket }, { type: MessageType.WATCH_CARD, ...payload }),
        );
        return { ok: true };
      }
      // Clear / re-watch must reach the form even when liveAct has focus (blur wiped match score)
      const target =
        (payload.clientId && clientById(payload.clientId)) ||
        targetClient(payload.target) ||
        bestConnectedClient();
      return send(target, { type: MessageType.WATCH_CARD, ...payload })
        ? { ok: true, clientId: target?.client?.clientId || null }
        : { ok: false, error: "browser_unavailable" };
    },
    sendControl(action, clientId) {
      const target =
        (clientId && clientById(clientId)) || bestConnectedClient();
      return send(target, { type: MessageType.CONTROL, action });
    },
    sendApplyStep(payload) {
      const target = pickExtension(payload);
      return send(target, {
        type: MessageType.APPLY_STEP,
        ...payload,
        type: MessageType.APPLY_STEP,
      })
        ? { ok: true, clientId: target?.client?.clientId || null }
        : { ok: false, error: "browser_unavailable" };
    },
    sendAgentFill(payload) {
      return forwardFill(payload);
    },
    sendRepairPlan(payload) {
      const target =
        (payload.clientId && clientById(payload.clientId)) ||
        targetClient(payload.target) ||
        bestConnectedClient();
      return send(target, { type: MessageType.REPAIR_PLAN, ...payload })
        ? { ok: true, clientId: target?.client?.clientId || null }
        : { ok: false, error: "browser_unavailable" };
    },
    sendValueCheckResult(payload) {
      const target =
        (payload.clientId && clientById(payload.clientId)) ||
        targetClient(payload.target) ||
        bestConnectedClient();
      return send(target, { type: MessageType.VALUE_CHECK_RESULT, ...payload })
        ? { ok: true, clientId: target?.client?.clientId || null }
        : { ok: false, error: "browser_unavailable" };
    },
    requestSnippet(requestId, clientId) {
      const target =
        (clientId && clientById(clientId)) || bestConnectedClient();
      if (!target)
        return Promise.resolve({ ok: false, error: "extension_offline" });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingSnippets.delete(requestId);
          resolve({ ok: false, error: "timeout" });
        }, 8000);
        pendingSnippets.set(requestId, { resolve, timer });
        if (!send(target, { type: MessageType.CAPTURE_SNIPPET, requestId })) {
          clearTimeout(timer);
          pendingSnippets.delete(requestId);
          resolve({ ok: false, error: "extension_offline" });
        }
      });
    },
    requestTabShot(requestId, clientId) {
      const target =
        (clientId && clientById(clientId)) || bestConnectedClient();
      if (!target)
        return Promise.resolve({ ok: false, error: "extension_offline" });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingTabShots.delete(requestId);
          resolve({ ok: false, error: "timeout" });
        }, 15000);
        pendingTabShots.set(requestId, { resolve, timer });
        if (!send(target, { type: MessageType.CAPTURE_TAB_SHOT, requestId })) {
          clearTimeout(timer);
          pendingTabShots.delete(requestId);
          resolve({ ok: false, error: "extension_offline" });
        }
      });
    },
    requestStatus() {
      const sockets = connected();
      sockets.forEach(([socket]) =>
        send({ socket }, { type: MessageType.REQUEST_STATUS }),
      );
      return sockets.length > 0;
    },
    sendCaptureRecording(payload = {}) {
      const sockets = connected();
      if (!sockets.length) return { ok: false, error: "extension_offline", sent: 0 };
      let sent = 0;
      const message = {
        type: MessageType.CAPTURE_RECORDING,
        recording: Boolean(payload.recording),
        recordingSessionId: payload.recordingSessionId || null,
        cardId: payload.cardId || null,
      };
      sockets.forEach(([socket]) => {
        if (send({ socket }, message)) sent += 1;
      });
      return { ok: sent > 0, sent };
    },
    sendOpenUrl(payload = {}) {
      const target = bestConnectedClient();
      if (!target) return { ok: false, error: "extension_offline" };
      return send(target, {
        type: MessageType.OPEN_URL,
        url: payload.url,
        cardId: payload.cardId || null,
        matchIncludes: payload.matchIncludes || null,
      })
        ? { ok: true, clientId: target.client.clientId }
        : { ok: false, error: "browser_unavailable" };
    },
    /** Push Jira ranked snapshot to all connected extensions (no credentials). */
    sendJiraSnapshot(payload = {}) {
      const sockets = connected();
      if (!sockets.length)
        return { ok: false, error: "extension_offline", sent: 0 };
      let sent = 0;
      const message = {
        type: MessageType.JIRA_SNAPSHOT,
        ok: Boolean(payload.ok),
        configured: Boolean(payload.configured),
        staleCount: Number(payload.staleCount) || 0,
        issues: Array.isArray(payload.issues) ? payload.issues : [],
        fetchedAt: payload.fetchedAt || null,
        sopStages: payload.sopStages || null,
        error: payload.error || null,
      };
      sockets.forEach(([socket]) => {
        if (send({ socket }, message)) sent += 1;
      });
      return { ok: sent > 0, sent };
    },
    close() {
      try {
        clearInterval(statusPulse);
        for (const [sock] of clients) {
          try {
            sock.terminate();
          } catch {
            /* ignore */
          }
        }
        clients.clear();
        lastEmittedFocus = null;
        lastEmittedConnected = null;
        wss.close();
        server.close();
      } catch {
        /* ignore */
      }
    },
  };

  // 0.0.0.0 = all interfaces (loopback + this machine's LAN IP)
  server.listen(BRIDGE_PORT, "0.0.0.0", () => {
    listening = true;
    const endpoints = bridgeEndpoints();
    console.log(`[coact-bridge] listening 0.0.0.0:${BRIDGE_PORT}`);
    console.log(`[coact-bridge] local    ${endpoints.localWsUrl}`);
    if (endpoints.host !== "127.0.0.1") {
      console.log(`[coact-bridge] lan      ${endpoints.wsUrl}`);
    }
    onListening?.(endpoints);
  });

  return api;
}

module.exports = { createBridge };
