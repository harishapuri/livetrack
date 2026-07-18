const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("coact", {
  getBootstrap: () => ipcRenderer.invoke("get-bootstrap"),
  runCard: (cardId) => ipcRenderer.invoke("run-card", cardId),
  controlRun: (action) => ipcRenderer.invoke("control-run", action),
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
});
