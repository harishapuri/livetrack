const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teamsChat", {
  refine: () => ipcRenderer.invoke("teams-chat-refine"),
  onBusy: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("teams-chat-busy", handler);
    return () => ipcRenderer.removeListener("teams-chat-busy", handler);
  },
});
