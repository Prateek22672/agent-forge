import React, { useEffect, useState } from "react";
import { api, auth } from "./api";
import Landing from "./components/Landing";
import AuthScreen from "./components/AuthScreen";
import ChatApp from "./components/ChatApp";

// Top-level router: landing -> auth -> the authenticated app.
export default function App() {
  const [route, setRoute] = useState("loading"); // loading | landing | auth | app
  const [authMode, setAuthMode] = useState("signup");
  const [user, setUser] = useState(null);

  // On load: capture a token handed back by Google login (?token=...), then
  // validate whatever token we have; otherwise show the landing page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      auth.set(urlToken);
      // Strip the token from the URL but keep ?google=connected for the app.
      const keepGoogle = params.get("google") ? "?google=connected" : "";
      window.history.replaceState({}, "", `/${keepGoogle}`);
    }

    const token = auth.get();
    if (!token) {
      setRoute("landing");
      return;
    }
    api
      .me()
      .then((u) => {
        setUser(u);
        setRoute("app");
      })
      .catch(() => {
        auth.clear();
        setRoute("landing");
      });

    const onUnauthorized = () => {
      setUser(null);
      setRoute("landing");
    };
    window.addEventListener("agentforge:unauthorized", onUnauthorized);
    return () => window.removeEventListener("agentforge:unauthorized", onUnauthorized);
  }, []);

  const onAuthed = (u) => {
    setUser(u);
    setRoute("app");
  };
  const logout = () => {
    auth.clear();
    setUser(null);
    setRoute("landing");
  };

  if (route === "loading") {
    return <div className="h-full flex items-center justify-center text-white/40">…</div>;
  }
  if (route === "landing") {
    return (
      <Landing
        onGetStarted={() => {
          setAuthMode("signup");
          setRoute("auth");
        }}
        onSignIn={() => {
          setAuthMode("login");
          setRoute("auth");
        }}
      />
    );
  }
  if (route === "auth") {
    return (
      <AuthScreen
        initialMode={authMode}
        onAuthed={onAuthed}
        onBack={() => setRoute("landing")}
      />
    );
  }
  return <ChatApp user={user} onLogout={logout} />;
}
