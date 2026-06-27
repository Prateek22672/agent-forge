import React, { useEffect, useState } from "react";
import { api, adminAuth } from "./api";
import AdminPanel from "./components/AdminPanel";

// Standalone admin console at /admin — its own login (default dj / dj), separate
// from the normal user app. Renders the panel full-screen once authenticated.
export default function AdminApp() {
  const [authed, setAuthed] = useState(!!adminAuth.get());

  useEffect(() => {
    const onUnauthorized = () => setAuthed(false);
    window.addEventListener("agentforge:admin-unauthorized", onUnauthorized);
    return () =>
      window.removeEventListener("agentforge:admin-unauthorized", onUnauthorized);
  }, []);

  const logout = () => {
    adminAuth.clear();
    setAuthed(false);
  };

  if (!authed) return <AdminLogin onAuthed={() => setAuthed(true)} />;
  return <AdminPanel standalone onClose={logout} />;
}

function AdminLogin({ onAuthed }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res = await api.adminLogin(form.username.trim(), form.password);
      adminAuth.set(res.admin_token);
      onAuthed();
    } catch (e2) {
      setErr("Invalid admin credentials.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full w-full bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-sm border border-white/25 p-7">
        <div className="font-bold tracking-widest text-sm mb-1">ADMIN CONSOLE</div>
        <p className="text-white/40 text-sm mb-6">Restricted access.</p>
        <form onSubmit={submit} className="space-y-3">
          <input
            className="w-full bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            autoFocus
          />
          <input
            type="password"
            className="w-full bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          {err && <div className="text-red-400 text-sm">{err}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-white text-black py-2.5 font-semibold hover:bg-white/85 disabled:opacity-50"
          >
            {busy ? "…" : "Sign in"}
          </button>
        </form>
        <a href="/" className="block mt-5 text-xs text-white/40 hover:text-white">
          ← Back to app
        </a>
      </div>
    </div>
  );
}
