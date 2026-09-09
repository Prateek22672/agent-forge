// Bridge for the settings window only.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("afSettings", {
  get: () => ipcRenderer.invoke("cfg:get"),
  set: (patch) => ipcRenderer.invoke("cfg:set", patch),
  rebuild: () => ipcRenderer.invoke("cfg:rebuild"),
  wipeIndex: () => ipcRenderer.invoke("cfg:wipe"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  openReleases: () => ipcRenderer.invoke("cfg:releases"),
  // Update progress is pushed, so the card stays live without polling.
  onUpdate: (fn) => ipcRenderer.on("update:state", () => fn()),
});
