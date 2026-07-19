const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("coact", {
  getBootstrap: () => ipcRenderer.invoke("get-bootstrap"),
  refreshQueue: () => ipcRenderer.invoke("refresh-queue"),
  onQueueUpdated: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("queue-updated", handler);
    return () => ipcRenderer.removeListener("queue-updated", handler);
  },
  runCard: (cardId, options) => ipcRenderer.invoke("run-card", cardId, options || {}),
  watchCard: (cardId, options) => ipcRenderer.invoke("watch-card", cardId, options || {}),
  controlRun: (action) => ipcRenderer.invoke("control-run", action),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("set-always-on-top", enabled),
  setTailMode: (enabled) => ipcRenderer.invoke("set-tail-mode", enabled),
  setTailStatus: (status) => ipcRenderer.invoke("set-tail-status", status),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  requestTabStatus: () => ipcRenderer.invoke("request-tab-status"),
  getOpenAiSettings: () => ipcRenderer.invoke("get-openai-settings"),
  saveOpenAiSettings: (payload) => ipcRenderer.invoke("save-openai-settings", payload),
  jiraRefresh: () => ipcRenderer.invoke("jira-refresh"),
  jiraSetPaneActive: (active) => ipcRenderer.invoke("jira-set-pane-active", Boolean(active)),
  jiraGetSnapshot: () => ipcRenderer.invoke("jira-get-snapshot"),
  jiraOpenIssue: (url) => ipcRenderer.invoke("jira-open-issue", url),
  jiraAddComment: (payload) => ipcRenderer.invoke("jira-add-comment", payload || {}),
  jiraAiComment: (payload) => ipcRenderer.invoke("jira-ai-comment", payload || {}),
  jiraRecentActions: () => ipcRenderer.invoke("jira-recent-actions"),
  getExecutionDashboard: () => ipcRenderer.invoke("get-execution-dashboard"),
  jiraMandatorySummary: (payload) =>
    ipcRenderer.invoke("jira-mandatory-summary", payload || {}),
  onJiraUpdated: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("jira-updated", handler);
    return () => ipcRenderer.removeListener("jira-updated", handler);
  },
  pickExecutionsFolder: () => ipcRenderer.invoke("pick-executions-folder"),
  getExtensionInstallInfo: () => ipcRenderer.invoke("get-extension-install-info"),
  installBrowserExtension: (browser) =>
    ipcRenderer.invoke("install-browser-extension", browser || "chrome"),
  pickErrorFiles: () => ipcRenderer.invoke("pick-error-files"),
  captureLiveSnippet: () => ipcRenderer.invoke("capture-live-snippet"),
  captureRegionSnip: () => ipcRenderer.invoke("capture-region-snip"),
  chatPrompt: (payload) => ipcRenderer.invoke("chat-prompt", payload),
  chatStop: (chatId) => ipcRenderer.invoke("chat-stop", chatId),
  coachStuckStep: (payload) => ipcRenderer.invoke("coach-stuck-step", payload),
  proposeAgentFill: (payload) => ipcRenderer.invoke("propose-agent-fill", payload || {}),
  applyStep: (payload) => ipcRenderer.invoke("apply-step", payload),
  repairFailedStep: (payload) => ipcRenderer.invoke("repair-failed-step", payload),
  onChatDelta: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("chat-delta", handler);
    return () => ipcRenderer.removeListener("chat-delta", handler);
  },
  onExtensionStatus: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("extension-status", handler);
    return () => ipcRenderer.removeListener("extension-status", handler);
  },
  onStepUpdate: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("step-update", handler);
    return () => ipcRenderer.removeListener("step-update", handler);
  },
  onRunFinished: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("run-finished", handler);
    return () => ipcRenderer.removeListener("run-finished", handler);
  },
  onRequestTail: (cb) => {
    const handler = (_event, enabled) => cb(Boolean(enabled));
    ipcRenderer.on("tail-mode", handler);
    return () => ipcRenderer.removeListener("tail-mode", handler);
  },
});
