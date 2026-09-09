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
  // Hand the session token to the main process so Quick Find can answer
  // questions on its own. It stays in the main process — the popup is never
  // given the token, only the answer.
  setToken: (token) => ipcRenderer.invoke("auth:token", token),

  // Opens the desktop Settings window. Its presence is also how the web app
  // knows a native settings surface exists at all.
  openSettings: () => ipcRenderer.invoke("cfg:open"),

  // In-app updates. The download happens in the background while the app is
  // running; "install" just restarts into the version already on disk, so the
  // user never downloads an installer or removes the old one by hand.
  update: {
    state: () => ipcRenderer.invoke("update:state"),
    check: () => ipcRenderer.invoke("update:check"),
    install: () => ipcRenderer.invoke("update:install"),
    onChange: (fn) => {
      const h = (_e, s) => fn(s);
      ipcRenderer.on("update:state", h);
      return () => ipcRenderer.removeListener("update:state", h);
    },
  },
});
