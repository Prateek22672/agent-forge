// Bridge for the spotlight window ONLY. Deliberately narrow: the popup can ask
// for search results and act on a path the main process itself just returned.
// It gets no filesystem handle, and cannot read a file's contents.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spotlight", {
  search: (q, group) => ipcRenderer.invoke("spot:search", q, group),
  open: (p) => ipcRenderer.invoke("spot:open", p),
  reveal: (p) => ipcRenderer.invoke("spot:reveal", p),
  copy: (p, mode) => ipcRenderer.invoke("spot:copy", p, mode),
  share: (p) => ipcRenderer.invoke("spot:share", p),
  trash: (p) => ipcRenderer.invoke("spot:trash", p),
  ask: (q) => ipcRenderer.invoke("spot:ask", q),
  preview: (p) => ipcRenderer.invoke("spot:preview", p),
  settings: (patch) => ipcRenderer.invoke("spot:settings", patch),
  hide: () => ipcRenderer.invoke("spot:hide"),
  onShow: (fn) => ipcRenderer.on("spot:shown", () => fn()),
});
