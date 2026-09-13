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
  updateQueueCardStatus: (cardId, status) =>
    ipcRenderer.invoke("update-queue-card-status", cardId, status),
  abandonCard: (cardId, options) => ipcRenderer.invoke("abandon-card", cardId, options || {}),
  controlRun: (action) => ipcRenderer.invoke("control-run", action),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("set-always-on-top", enabled),
  setTailMode: (enabled) => ipcRenderer.invoke("set-tail-mode", enabled),
  setTailStatus: (status) => ipcRenderer.invoke("set-tail-status", status),
  getMainBounds: () => ipcRenderer.invoke("get-main-bounds"),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  requestTabStatus: () => ipcRenderer.invoke("request-tab-status"),
  getOpenAiSettings: () => ipcRenderer.invoke("get-openai-settings"),
  saveOpenAiSettings: (payload) => ipcRenderer.invoke("save-openai-settings", payload),
  ensureMicrophone: () => ipcRenderer.invoke("ensure-microphone"),
  ensureScreenCapture: () => ipcRenderer.invoke("ensure-screen-capture"),
  momLoopbackSource: () => ipcRenderer.invoke("mom-loopback-source"),
  momTeamsFrame: () => ipcRenderer.invoke("mom-teams-frame"),
  transcribeAudio: (payload) => ipcRenderer.invoke("transcribe-audio", payload),
  synthesizeSpeech: (payload) => ipcRenderer.invoke("synthesize-speech", payload),
  outlookConnect: () => ipcRenderer.invoke("outlook-connect"),
  outlookCancelConnect: () => ipcRenderer.invoke("outlook-cancel-connect"),
  outlookDisconnect: () => ipcRenderer.invoke("outlook-disconnect"),
  outlookRefresh: () => ipcRenderer.invoke("outlook-refresh"),
  momGetSnapshot: () => ipcRenderer.invoke("mom-get-snapshot"),
  momMark: (payload) => ipcRenderer.invoke("mom-mark", payload || {}),
  momStart: (payload) => ipcRenderer.invoke("mom-start", payload || {}),
  momAppendTranscript: (payload) => ipcRenderer.invoke("mom-append-transcript", payload || {}),
  momStopRefine: (payload) => ipcRenderer.invoke("mom-stop-refine", payload || {}),
  momApprove: (payload) => ipcRenderer.invoke("mom-approve", payload || {}),
  momReRefine: (payload) => ipcRenderer.invoke("mom-re-refine", payload || {}),
  momCancel: () => ipcRenderer.invoke("mom-cancel"),
  momList: (payload) => ipcRenderer.invoke("mom-list", payload || {}),
  momGetArtifact: (payload) => ipcRenderer.invoke("mom-get-artifact", payload || {}),
  onMomUpdated: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("mom-updated", handler);
    return () => ipcRenderer.removeListener("mom-updated", handler);
  },
  onMomAlert: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("mom-alert", handler);
    return () => ipcRenderer.removeListener("mom-alert", handler);
  },
  onMomShouldStop: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("mom-should-stop", handler);
    return () => ipcRenderer.removeListener("mom-should-stop", handler);
  },
  onMomRefined: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("mom-refined", handler);
    return () => ipcRenderer.removeListener("mom-refined", handler);
  },
  onMomApproved: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("mom-approved", handler);
    return () => ipcRenderer.removeListener("mom-approved", handler);
  },
  onOutlookDeviceCode: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("outlook-device-code", handler);
    return () => ipcRenderer.removeListener("outlook-device-code", handler);
  },
  jiraTestConnection: (payload) => ipcRenderer.invoke("jira-test-connection", payload || {}),
  jiraRefresh: () => ipcRenderer.invoke("jira-refresh"),
  jiraSetPaneActive: (active) => ipcRenderer.invoke("jira-set-pane-active", Boolean(active)),
  jiraGetSnapshot: () => ipcRenderer.invoke("jira-get-snapshot"),
  jiraOpenIssue: (url) => ipcRenderer.invoke("jira-open-issue", url),
  openDashboard: (payload) => ipcRenderer.invoke("open-dashboard", payload || {}),
  jiraAddComment: (payload) => ipcRenderer.invoke("jira-add-comment", payload || {}),
  deskExplainPage: () => ipcRenderer.invoke("desk-explain-page"),
  deskCapturePage: () => ipcRenderer.invoke("desk-capture-page"),
  deskDraftFromScreenshot: (payload) =>
    ipcRenderer.invoke("desk-draft-from-screenshot", payload || {}),
  deskCreateJiraIssue: (payload) => ipcRenderer.invoke("desk-create-jira-issue", payload || {}),
  deskRefineTicket: (payload) => ipcRenderer.invoke("desk-refine-ticket", payload || {}),
  deskCreatedTickets: () => ipcRenderer.invoke("desk-created-tickets"),
  pickDeskFiles: () => ipcRenderer.invoke("pick-desk-files"),
  jiraAiComment: (payload) => ipcRenderer.invoke("jira-ai-comment", payload || {}),
  jiraDraftMailScreenshot: (payload) =>
    ipcRenderer.invoke("jira-draft-mail-screenshot", payload || {}),
  jiraApplyMailScreenshot: (payload) =>
    ipcRenderer.invoke("jira-apply-mail-screenshot", payload || {}),
  jiraRecentActions: () => ipcRenderer.invoke("jira-recent-actions"),
  getExecutionDashboard: () => ipcRenderer.invoke("get-execution-dashboard"),
  getAnalytics: (payload) => ipcRenderer.invoke("get-analytics", payload || {}),
  setCaptureRecording: (payload) => ipcRenderer.invoke("set-capture-recording", payload || {}),
  getCaptureStatus: () => ipcRenderer.invoke("get-capture-status"),
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
  logAgentFeedback: (payload) => ipcRenderer.invoke("log-agent-feedback", payload || {}),
  inboxSubmit: (payload) => ipcRenderer.invoke("inbox-submit", payload || {}),
  inboxList: () => ipcRenderer.invoke("inbox-list"),
  actionsList: (payload) => ipcRenderer.invoke("actions-list", payload || {}),
  actionsAdd: (payload) => ipcRenderer.invoke("actions-add", payload || {}),
  actionsDone: (payload) => ipcRenderer.invoke("actions-done", payload || {}),
  actionsReopen: (payload) => ipcRenderer.invoke("actions-reopen", payload || {}),
  actionsPendingCount: () => ipcRenderer.invoke("actions-pending-count"),
  onActionsUpdated: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("actions-updated", handler);
    return () => ipcRenderer.removeListener("actions-updated", handler);
  },
  discoverSop: () => ipcRenderer.invoke("discover-sop"),
  approveCaptureDraft: (payload) =>
    ipcRenderer.invoke("approve-capture-draft", payload || {}),
  dismissCaptureDraft: (payload) =>
    ipcRenderer.invoke("dismiss-capture-draft", payload || {}),
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
