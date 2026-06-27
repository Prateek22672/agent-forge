import React, { useEffect, useState } from "react";
import { api } from "../api";

// Admin panel: model/key insights + add keys + manage users.
// Keys are shown MASKED only — the backend never sends full keys.
export default function AdminPanel({ onClose, standalone = false }) {
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState("keys");
  const [err, setErr] = useState("");

  const load = async () => {
    setData(await api.adminInsights().catch((e) => {
      setErr(String(e.message));
      return null;
    }));
    setUsers(await api.adminUsers().catch(() => []));
  };
  useEffect(() => {
    load();
  }, []);

  return (
    <div
      className={
        standalone
          ? "h-full w-full bg-black overflow-y-auto"
          : "fixed inset-0 z-40 bg-black/85 flex items-center justify-center p-4"
      }
    >
      <div
        className={
          standalone
            ? "max-w-4xl mx-auto"
            : "bg-black border border-white/30 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        }
      >
        <div className="flex items-center justify-between border-b border-white/15 px-6 py-4">
          <div className="font-bold tracking-widest text-sm">ADMIN CONSOLE</div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-sm">
            {standalone ? "Logout" : "Close"}
          </button>
        </div>

        {err && <div className="px-6 py-3 text-red-400 text-sm">{err}</div>}

        {/* Totals */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 m-4 md:m-6">
            <Stat label="Total calls" value={data.totals.all_calls} />
            <Stat label="Groq calls" value={data.totals.groq_calls} />
            <Stat label="Gemini calls" value={data.totals.gemini_calls} />
            <Stat label="Users" value={data.users_count} />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 px-6">
          {["keys", "users"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm border-b-2 capitalize ${
                tab === t ? "border-white" : "border-transparent text-white/50"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === "keys" && data && (
            <div className="space-y-6">
              <KeyGroup
                title="Groq keys"
                provider="groq"
                group={data.groq}
                onChanged={load}
              />
              <KeyGroup
                title="Gemini keys"
                provider="gemini"
                group={data.gemini}
                onChanged={load}
              />
              <div className="text-[11px] text-white/35">
                Keys are stored in your OS keychain and shown masked. The server
                never returns a full key. On a public host, use HTTPS so keys you
                add aren't sent in clear text.
              </div>
            </div>
          )}

          {tab === "users" && (
            <Users users={users} onChanged={load} />
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-black px-4 py-3">
      <div className="text-2xl font-bold">{value ?? 0}</div>
      <div className="text-[11px] text-white/40">{label}</div>
    </div>
  );
}

function KeyGroup({ title, provider, group, onChanged }) {
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setMsg("");
    setBusy(true);
    try {
      await api.adminAddKey(provider, key.trim());
      setKey("");
      setMsg("Key added");
      onChanged();
    } catch (e) {
      // Backend sends a clear message (duplicate / bad format).
      const raw = String(e.message).replace(/^\d+\s*/, "");
      try {
        setMsg("⚠ " + (JSON.parse(raw).detail || raw));
      } catch {
        setMsg("⚠ " + raw);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-white/15 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs text-white/40">{group.count} active</div>
      </div>
      <div className="space-y-1 mb-3">
        {group.keys.map((k) => (
          <div
            key={k.suffix}
            className="flex items-center justify-between text-sm border border-white/10 px-3 py-2"
          >
            <span className="font-mono">{k.masked}</span>
            <span className="flex items-center gap-3 text-xs text-white/50">
              <span>{k.requests} reqs</span>
              <span className="uppercase text-[10px] border border-white/20 px-1">
                {k.source}
              </span>
              {k.removable && (
                <button
                  onClick={async () => {
                    await api.adminRemoveKey(provider, k.suffix).catch(() => {});
                    onChanged();
                  }}
                  className="text-white/40 hover:text-red-400"
                >
                  remove
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          className="flex-1 bg-black border border-white/30 px-3 py-2 text-sm focus:border-white outline-none font-mono"
          placeholder={provider === "groq" ? "gsk_…" : "AIza… (Gemini)"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button
          onClick={add}
          disabled={busy || !key.trim()}
          className="bg-white text-black px-4 font-semibold hover:bg-white/85 disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {msg && <div className="text-xs mt-2 text-white/70">{msg}</div>}
    </div>
  );
}

function Users({ users, onChanged }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-white/40 mb-2">{users.length} registered users</div>
      {users.map((u) => (
        <div
          key={u.id}
          className="flex items-center justify-between border border-white/10 px-3 py-2 text-sm"
        >
          <div>
            <div>
              <span>{u.email}</span>
              {u.is_admin && (
                <span className="ml-2 text-[10px] border border-white/25 px-1 uppercase">
                  admin
                </span>
              )}
              {u.is_you && <span className="ml-2 text-white/40 text-xs">(you)</span>}
            </div>
            <div className="text-[11px] text-white/40 mt-0.5">
              joined {new Date(u.created_at).toLocaleDateString()} · {u.agents} agents ·{" "}
              {u.chats} chats
              {u.google && <span className="text-white/60"> · {u.google}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <button
              onClick={async () => {
                await api.adminSetAdmin(u.id, !u.is_admin).catch(() => {});
                onChanged();
              }}
              className="text-white/50 hover:text-white"
            >
              {u.is_admin ? "revoke admin" : "make admin"}
            </button>
            {!u.is_you && (
              <button
                onClick={async () => {
                  if (confirm(`Delete ${u.email} and all their data?`)) {
                    await api.adminDeleteUser(u.id).catch(() => {});
                    onChanged();
                  }
                }}
                className="text-white/40 hover:text-red-400"
              >
                delete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
