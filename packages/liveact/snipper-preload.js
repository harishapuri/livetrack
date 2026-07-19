const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("snipper", {
  complete: (payload) => ipcRenderer.send("snipper-result", payload),
  cancel: () => ipcRenderer.send("snipper-cancel"),
});
