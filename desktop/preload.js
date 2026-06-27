// Context-isolated bridge. We expose a tiny, safe API to the web app:
//   • isDesktop  — so the web app knows it's running inside the desktop shell
//   • openExternal(url) — open a URL (the Google consent) in the real browser,
//     which has the user's Google session, then return via the agentforge:// link.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentforge", {
  isDesktop: true,
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  // Bring the window to the front + flash the taskbar when a reminder alarm fires.
  ringAlarm: () => ipcRenderer.invoke("ring-alarm"),
});
