const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("coactTail", {
  openMain: () => ipcRenderer.invoke("tail-open-main"),
  onStatus: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("tail-status", handler);
    return () => ipcRenderer.removeListener("tail-status", handler);
  },
});
