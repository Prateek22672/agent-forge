import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import AdminApp from "./AdminApp.jsx";
import { Privacy, Terms } from "./components/Legal.jsx";
import "./index.css";

// Fire-and-forget wake-up ping, as early as this file can run — before React
// even mounts. Render's free tier sleeps after inactivity and takes ~50s to
// wake on the first real request; without this, that whole 50s lands on
// whatever the user does first (usually submitting the login form). Firing it
// here instead means the wake-up runs in the background while the tab is just
// loading and the user is reading the page / typing credentials, so by the
// time they actually submit, the backend is often already awake. Same trick
// the extension already uses (see extension/*.js "WARM_UP").
fetch("/api/health").catch(() => {});

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
