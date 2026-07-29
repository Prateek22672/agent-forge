import React, { useEffect, useState } from "react";
import { api } from "../api";

// Admin panel: model/key insights + add keys + manage users.
// Keys are shown MASKED only — the backend never sends full keys.
export default function AdminPanel({ onClose, standalone = false }) {
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [logins, setLogins] = useState([]);
  const [flagged, setFlagged] = useState([]);
  const [tab, setTab] = useState("keys");
  const [err, setErr] = useState("");

  const load = async () => {
    setData(await api.adminInsights().catch((e) => {
      setErr(String(e.message));
      return null;
    }));
    setUsers(await api.adminUsers().catch(() => []));
    setLogins(await api.adminRecentLogins().catch(() => []));
    setFlagged(await api.adminFlaggedUsers().catch(() => []));
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 30000); // keep insights fresh without a manual refresh
    return () => clearInterval(id);
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
            : "bg-black border border-white/30 w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl"
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
            <Stat label="Users" value={data.users_count} />
            <Stat label="Active (7d)" value={data.engagement?.active_users_7d} />
            <Stat
              label="Errors (24h)"
              value={data.health?.errors_24h}
              alert={data.health?.errors_24h > 0}
            />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 px-6">
          {["keys", "users", "review", "insights"].map((t) => (
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

          {tab === "review" && <Review flagged={flagged} onChanged={load} />}

          {tab === "insights" && data && (
            <Insights data={data} logins={logins} />
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, alert = false }) {
  return (
    <div className="bg-black px-4 py-3">
      <div className={`text-2xl font-bold ${alert ? "text-red-400" : ""}`}>{value ?? 0}</div>
      <div className="text-[11px] text-white/40">{label}</div>
    </div>
  );
}

function Insights({ data, logins }) {
  const eng = data.engagement || {};
  const health = data.health || {};
  const bySource = eng.by_source_7d || {};

  return (
    <div className="space-y-6">
      <div>
        <div className="font-semibold text-sm mb-2">Logins</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10">
          <Stat label="Today" value={eng.logins_today} />
          <Stat label="Last 7 days" value={eng.logins_7d} />
          <Stat label="Extension (7d)" value={bySource.extension} />
          <Stat label="Web (7d)" value={bySource.web} />
        </div>
      </div>

      <div>
        <div className="font-semibold text-sm mb-2">Recent logins</div>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {logins.length === 0 && (
            <div className="text-xs text-white/40">No logins recorded yet.</div>
          )}
          {logins.map((l, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-sm border border-white/10 px-3 py-2 rounded-lg"
            >
              <span>{l.email}</span>
              <span className="flex items-center gap-2 text-xs text-white/50">
                <span className="uppercase text-[10px] border border-white/20 px-1 rounded">
                  {l.source}
                </span>
                <span>{new Date(l.created_at).toLocaleString()}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="font-semibold text-sm mb-2">
          Slowest endpoints (24h)
        </div>
        <div className="space-y-1">
          {(health.slowest_endpoints_24h || []).length === 0 && (
            <div className="text-xs text-white/40">No slow-endpoint data in the last 24h.</div>
          )}
          {(health.slowest_endpoints_24h || []).map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-sm border border-white/10 px-3 py-2 rounded-lg font-mono"
            >
              <span>{s.path}</span>
              <span className="text-xs text-white/50">
                {s.avg_ms}ms avg · {s.count} reqs
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="font-semibold text-sm mb-2">
          Recent errors <span className="text-white/40 font-normal">({health.errors_24h} in last 24h)</span>
        </div>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {(health.recent_errors || []).length === 0 && (
            <div className="text-xs text-white/40">No errors logged. Clean.</div>
          )}
          {(health.recent_errors || []).map((e, i) => (
            <div key={i} className="border border-white/10 px-3 py-2 rounded-lg text-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-red-400">
                  {e.method} {e.path} · {e.status_code}
                </span>
                <span className="text-xs text-white/40">
                  {new Date(e.created_at).toLocaleString()}
                </span>
              </div>
              {e.message && (
                <div className="text-xs text-white/50 mt-1 break-words">{e.message}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KeyGroup({ title, provider, group, onChanged }) {
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // Live per-key health: suffix -> { ok, detail }. Populated by "Test keys",
  // which actually calls each key's provider so you see what really works now.
  const [health, setHealth] = useState({});
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    setMsg("");
    try {
      const res = await api.adminKeysHealth();
      const g = res[provider] || { keys: [] };
      const map = {};
      g.keys.forEach((k) => (map[k.suffix] = { ok: k.ok, detail: k.detail }));
      setHealth(map);
      setMsg(`${g.working}/${g.total} working`);
    } catch (e) {
      setMsg("⚠ couldn't test keys");
    } finally {
      setTesting(false);
    }
  };

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
    <div className="border border-white/15 p-4 rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm">{title}</div>
        <div className="flex items-center gap-3">
          <button
            onClick={test}
            disabled={testing || !group.keys.length}
            className="text-xs border border-white/20 px-2 py-1 rounded hover:border-white/50 disabled:opacity-40"
          >
            {testing ? "Testing…" : "Test keys"}
          </button>
          <div className="text-xs text-white/40">{group.count} active</div>
        </div>
      </div>
      <div className="space-y-1 mb-3">
        {group.keys.map((k) => {
          const h = health[k.suffix];
          return (
          <div
            key={k.suffix}
            className="flex items-center justify-between text-sm border border-white/10 px-3 py-2 rounded-lg"
          >
            <span className="flex items-center gap-2">
              {h && (
                <span
                  title={h.detail}
                  className={`inline-block w-2 h-2 rounded-full ${h.ok ? "bg-emerald-400" : "bg-red-400"}`}
                />
              )}
              <span className="font-mono">{k.masked}</span>
              {h && !h.ok && <span className="text-[10px] text-red-400">{h.detail}</span>}
            </span>
            <span className="flex items-center gap-3 text-xs text-white/50">
              <span>{k.requests} reqs</span>
              <span className="uppercase text-[10px] border border-white/20 px-1 rounded">
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
          );
        })}
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

// Accounts whose extension hit copy-blocking sites. NOT an accusation —
// ordinary sites trigger this constantly. What's worth a look is a high count
// concentrated on one domain you have reason to be concerned about.
function Review({ flagged, onChanged }) {
  return (
    <div className="space-y-3">
      <div className="text-xs text-white/40">
        Accounts whose extension encountered copy-blocking pages (last 30 days).
        Most entries are ordinary sites — review the domains before acting.
      </div>
      {!flagged.length && (
        <div className="text-white/30 text-sm py-8 text-center">
          Nothing flagged.
        </div>
      )}
      {flagged.map((f) => (
        <div key={f.user_id} className="border border-white/10 rounded-lg p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm">
                {f.email}
                {f.is_suspended && (
                  <span className="ml-2 text-[10px] border border-red-400/50 text-red-400 px-1 uppercase rounded">
                    suspended
                  </span>
                )}
              </div>
              <div className="text-[11px] text-white/40 mt-0.5">
                {f.total_hits} hits across {f.domains.length} domain
                {f.domains.length === 1 ? "" : "s"}
              </div>
              <div className="mt-2 space-y-0.5">
                {f.domains.slice(0, 5).map((d) => (
                  <div key={d.domain} className="text-[11px] text-white/55">
                    {d.domain || "(unknown)"} — {d.hits}
                    <span className="text-white/30">
                      {" "}
                      · last {new Date(d.last_hit).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
              {f.suspended_reason && (
                <div className="text-[11px] text-red-400/80 mt-2">
                  Reason: {f.suspended_reason}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 text-xs shrink-0">
              <button
                onClick={async () => {
                  const message = prompt(`Notice to send to ${f.email}:`);
                  if (!message) return;
                  await api.adminSendNotice(f.user_id, message).catch(() => {});
                  onChanged();
                }}
                className="text-white/50 hover:text-white whitespace-nowrap"
              >
                send notice
              </button>
              <button
                onClick={async () => {
                  if (f.is_suspended) {
                    await api.adminSuspendUser(f.user_id, false).catch(() => {});
                    onChanged();
                    return;
                  }
                  const reason = prompt(
                    `Suspend ${f.email}? They won't be able to log in until you lift it.\n\nReason (shown to them):`
                  );
                  if (reason === null) return;
                  await api.adminSuspendUser(f.user_id, true, reason).catch(() => {});
                  onChanged();
                }}
                className={
                  f.is_suspended
                    ? "text-green-400/70 hover:text-green-400 whitespace-nowrap"
                    : "text-white/40 hover:text-red-400 whitespace-nowrap"
                }
              >
                {f.is_suspended ? "reinstate" : "suspend"}
              </button>
            </div>
          </div>
        </div>
      ))}
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
          className="flex items-center justify-between border border-white/10 px-3 py-2 text-sm rounded-lg"
        >
          <div>
            <div>
              <span>{u.email}</span>
              {u.is_admin && (
                <span className="ml-2 text-[10px] border border-white/25 px-1 uppercase rounded">
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
