// Minimal preload — context-isolated. We don't expose Node to the web app; the
// app talks to its local backend over HTTP exactly as in the browser. This file
// exists so we can add safe IPC bridges later (e.g. native file pickers) without
// loosening security.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("agentforge", {
  isDesktop: true,
  platform: process.platform,
});
