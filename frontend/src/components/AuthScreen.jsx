import React, { useState } from "react";
import { api, auth } from "../api";
import Strands from "./Strands";
import CrocsMark from "./CrocsMark";
import { TrustChips } from "./TrustBadges";

// Login / signup. On success, stores the token and calls onAuthed(user).
export default function AuthScreen({ initialMode = "signup", onAuthed, onBack }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleOn, setGoogleOn] = useState(false);

  React.useEffect(() => {
    api
      .googleAuthConfigured()
      .then((d) => setGoogleOn(!!d.configured))
      .catch(() => setGoogleOn(false));
  }, []);

  const continueWithGoogle = async () => {
    setErr("");
    try {
      // Only use the external-browser flow if the desktop bridge actually
      // exposes openExternal (newer builds). Older installs fall back to the
      // in-window flow so they keep working.
      const desktop = !!(window.agentforge?.isDesktop && window.agentforge?.openExternal);
      const { auth_url } = await api.googleAuthStart(desktop);
      if (desktop) {
        // Open consent in the real browser (has your Google session → account
        // picker); it returns to the app via the agentforge:// deep link.
        window.agentforge.openExternal(auth_url);
      } else {
        window.location.href = auth_url;
      }
    } catch (e) {
      setErr("Google sign-in isn't available right now.");
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res =
        mode === "signup"
          ? await api.signup(form)
          : await api.login({ email: form.email, password: form.password });
      auth.set(res.access_token);
      onAuthed(res.user);
    } catch (e2) {
      // Backend sends "409 detail" / "401 detail" — show the readable part.
      const msg = String(e2.message).replace(/^\d+\s*/, "");
      try {
        setErr(JSON.parse(msg).detail || msg);
      } catch {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative h-full w-full bg-black flex items-center justify-center overflow-hidden">
      {/* subtle strands strip behind the card */}
      <div className="absolute inset-x-0 top-0 h-64 opacity-60 pointer-events-none">
        <Strands colors={["#7C3AED", "#06B6D4", "#FFFFFF"]} count={4} amplitude={1.2} glow={2.2} />
      </div>

      <div className="relative z-10 w-full max-w-sm border border-white/20 bg-black/70 backdrop-blur p-7">
        <div className="font-bold tracking-widest text-sm mb-1">AGENTFORGE</div>
        <h1 className="text-2xl font-bold mb-6">
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>

        {/* Sign in with Google — also grants Gmail in the same consent */}
        {googleOn && (
          <>
            <button
              onClick={continueWithGoogle}
              className="w-full flex items-center justify-center gap-2 bg-white text-black py-2.5 font-semibold hover:bg-white/85"
            >
              <GoogleGlyph /> Continue with Google
            </button>
            <div className="text-[11px] text-white/40 text-center mt-2">
              Just signs you in — nothing sensitive. Connect Gmail &amp; Calendar
              later, only if you want.
            </div>
            <div className="flex items-center gap-3 my-4 text-white/30 text-xs">
              <div className="h-px flex-1 bg-white/15" /> or <div className="h-px flex-1 bg-white/15" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <input
              className="w-full bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
              placeholder="Name (optional)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
          <input
            type="email"
            required
            className="w-full bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            type="password"
            required
            minLength={6}
            className="w-full bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
            placeholder="Password (min 6 chars)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />

          {err && <div className="text-red-400 text-sm">{err}</div>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-white text-black py-2.5 font-semibold hover:bg-white/85 disabled:opacity-50"
          >
            {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <TrustChips className="mt-4" />
        <div className="mt-1.5 text-[10px] text-white/30 text-center">
          Private to your account · disconnect anytime
        </div>

        <div className="mt-4 text-sm text-white/50 flex items-center justify-between">
          <button
            onClick={() => setMode(mode === "signup" ? "login" : "signup")}
            className="hover:text-white"
          >
            {mode === "signup" ? "Have an account? Sign in" : "New here? Sign up"}
          </button>
          {onBack && (
            <button onClick={onBack} className="hover:text-white">
              ← Home
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.9 6.1C12.2 13.6 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.8z" />
      <path fill="#FBBC05" d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.1-5.5c-2 1.4-4.6 2.2-8.1 2.2-6.4 0-11.8-4.1-13.6-9.9l-7.9 6.1C6.4 42.6 14.6 48 24 48z" />
    </svg>
  );
}
