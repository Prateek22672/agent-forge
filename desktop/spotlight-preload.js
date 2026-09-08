// Bridge for the spotlight window ONLY. Deliberately narrow: the popup can ask
// for search results and ask the main process to open or reveal a path, but it
// gets no filesystem handle of its own and no way to read a file's contents.
// Every path it can act on is one the main process itself just returned.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spotlight", {
  search: (q) => ipcRenderer.invoke("spot:search", q),
  open: (p) => ipcRenderer.invoke("spot:open", p),
  reveal: (p) => ipcRenderer.invoke("spot:reveal", p),
  ask: (q) => ipcRenderer.invoke("spot:ask", q),
  hide: () => ipcRenderer.invoke("spot:hide"),
  onShow: (fn) => ipcRenderer.on("spot:shown", () => fn()),
});
