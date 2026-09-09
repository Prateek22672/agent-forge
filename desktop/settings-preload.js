// Bridge for the settings window only.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("afSettings", {
  get: () => ipcRenderer.invoke("cfg:get"),
  set: (patch) => ipcRenderer.invoke("cfg:set", patch),
  rebuild: () => ipcRenderer.invoke("cfg:rebuild"),
  wipeIndex: () => ipcRenderer.invoke("cfg:wipe"),
});
