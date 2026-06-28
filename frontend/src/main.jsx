import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import AdminApp from "./AdminApp.jsx";
import { Privacy, Terms } from "./components/Legal.jsx";
import "./index.css";

// Simple path routing: /admin, /privacy, /terms are standalone public pages.
const path = window.location.pathname.replace(/\/$/, "");
function Root() {
  if (path === "/admin") return <AdminApp />;
  if (path === "/privacy") return <Privacy />;
  if (path === "/terms") return <Terms />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

// Register the service worker so the app is installable (PWA) and can show
// notifications. Harmless if unsupported.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
