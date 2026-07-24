import React, { useEffect, useState } from "react";
import { api } from "../api";
import { enablePush, pushPermissionState } from "../push";
import GoogleConsentModal from "./GoogleConsentModal";

// Settings: model privacy toggle (Groq cloud vs local Ollama) + Google connect.
export default function SettingsModal({ onClose, onChanged, user, onLogout }) {
  const [settings, setSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [conn, setConn] = useState(null);
  const [profile, setProfile] = useState(null);
  const [msg, setMsg] = useState("");
  const [showConsent, setShowConsent] = useState(false);

  const load = async () => {
    setSettings(await api.getSettings());
    setModels(await api.listModels());
    setConn(await api.getConnections());
    setProfile(await api.me().catch(() => null));
  };
  useEffect(() => {
    load();
  }, []);

  const saveProfile = async (patch) => {
    const updated = await api.updateProfile(patch);
    setProfile(updated);
    onChanged?.();
  };
  const TONES = ["friendly", "concise", "professional", "playful"];

  const save = async (patch) => {
    const updated = await api.updateSettings(patch);
    setSettings((s) => ({ ...s, ...updated }));
    onChanged?.();
  };

  // Show the trust explainer first, then redirect to Google's consent.
  const connectGoogle = () => setShowConsent(true);
  const doConnectGoogle = async () => {
    setShowConsent(false);
    try {
      const desktop = !!(window.agentforge?.isDesktop && window.agentforge?.openExternal);
      const { auth_url } = await api.googleStart(desktop);
      if (desktop) window.agentforge.openExternal(auth_url);
      else window.location.href = auth_url;
    } catch (e) {
      setMsg(String(e.message));
    }
  };

  const disconnectGoogle = async () => {
    await api.googleDisconnect();
    await load();
    onChanged?.();
  };

  if (!settings) return null;
  const google = conn?.google;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-start sm:items-center justify-center p-3 sm:p-4 z-30 overflow-y-auto">
      {showConsent && (
        <GoogleConsentModal
          onContinue={doConnectGoogle}
          onCancel={() => setShowConsent(false)}
        />
      )}
      <div className="bg-black border border-white/30 w-full max-w-lg p-5 sm:p-6 my-auto max-h-[92vh] overflow-y-auto rounded-2xl">
        <div className="flex justify-between items-center mb-5">
          <h2 className="font-bold tracking-widest text-sm">SETTINGS</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            ×
          </button>
        </div>

        {/* --- Personalization --- */}
        {profile && (
          <div className="mb-6">
            <div className="text-xs tracking-widest text-white/40 mb-2">
              PERSONALIZATION
            </div>
            <label className="text-[11px] text-white/40">Talking style</label>
            <div className="grid grid-cols-4 gap-2 mt-1 mb-3">
              {TONES.map((t) => (
                <button
                  key={t}
                  onClick={() => saveProfile({ tone: t })}
                  className={`border px-2 py-2 text-xs capitalize ${
                    profile.tone === t
                      ? "bg-white text-black border-white font-semibold"
                      : "border-white/30 hover:border-white"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <label className="text-[11px] text-white/40">
              About you (the AI personalises to this)
            </label>
            <textarea
              defaultValue={profile.about}
              onBlur={(e) => {
                if (e.target.value !== profile.about)
                  saveProfile({ about: e.target.value });
              }}
              placeholder="e.g. Final-year CS student preparing for placements; prefers short answers."
              className="w-full bg-black border border-white/30 px-2 py-2 text-sm mt-1 h-20 focus:border-white outline-none"
            />

            {/* Privacy: save chat history */}
            <div className="flex items-center justify-between mt-3 border border-white/15 px-3 py-2 rounded-lg">
              <div>
                <div className="text-sm">Save chat history</div>
                <div className="text-[11px] text-white/40">
                  Off = messages aren't stored; only your Brain persists.
                </div>
              </div>
              <button
                onClick={() => saveProfile({ save_history: !profile.save_history })}
                className={`border px-3 py-1 text-xs ${
                  profile.save_history
                    ? "bg-white text-black border-white font-semibold"
                    : "border-white/30 hover:border-white"
                }`}
              >
                {profile.save_history ? "On" : "Off"}
              </button>
            </div>
          </div>
        )}

        {/* --- Model privacy --- */}
        <div className="mb-6">
          <div className="text-xs tracking-widest text-white/40 mb-2">
            AI MODEL (PRIVACY)
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <button
              onClick={() => save({ llm_provider: "groq" })}
              className={`border px-2 py-2 text-xs ${
                settings.llm_provider === "groq"
                  ? "bg-white text-black border-white font-semibold"
                  : "border-white/30 hover:border-white"
              }`}
            >
              Groq · cloud
            </button>
            <button
              onClick={() => save({ llm_provider: "gemini" })}
              disabled={!settings.gemini_configured}
              className={`border px-2 py-2 text-xs disabled:opacity-30 ${
                settings.llm_provider === "gemini"
                  ? "bg-white text-black border-white font-semibold"
                  : "border-white/30 hover:border-white"
              }`}
            >
              Gemini · cloud
            </button>
            <button
              onClick={() => save({ llm_provider: "ollama" })}
              className={`border px-2 py-2 text-xs ${
                settings.llm_provider === "ollama"
                  ? "bg-white text-black border-white font-semibold"
                  : "border-white/30 hover:border-white"
              }`}
            >
              Ollama · local
            </button>
          </div>
          {settings.llm_provider === "groq" && settings.groq_key_count > 1 && (
            <div className="text-[11px] text-white/40 mb-2">
              Spreading load across {settings.groq_key_count} Groq keys
              {settings.gemini_configured ? " · Gemini overflow on rate-limit" : ""}.
            </div>
          )}
          {settings.llm_provider === "groq" ? (
            <div>
              <label className="text-[11px] text-white/40">Groq model</label>
              <select
                value={settings.default_model}
                onChange={(e) => save({ default_model: e.target.value })}
                className="w-full bg-black border border-white/30 px-2 py-2 text-sm mt-1"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              {!settings.groq_configured && (
                <div className="text-white/50 text-[11px] mt-1">
                  Add GROQ_API_KEY to .env to use cloud mode.
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-white/50">
              Nothing leaves your device. Requires Ollama running locally
              (install from ollama.com, then <code>ollama pull {settings.ollama_model}</code>).
            </div>
          )}
        </div>

        {/* --- Google connection --- */}
        <div className="mb-2">
          <div className="text-xs tracking-widest text-white/40 mb-2">
            CONNECTED ACCOUNTS
          </div>
          {google?.connected ? (
            <div className="flex items-center justify-between border border-white/25 px-3 py-2 text-sm">
              <span>Gmail — {google.account_email}</span>
              <button
                onClick={disconnectGoogle}
                className="text-white/60 hover:text-white text-xs underline"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connectGoogle}
              className="w-full bg-white text-black py-2 font-semibold hover:bg-white/80"
            >
              Connect Google (Gmail)
            </button>
          )}
          {google && !google.configured && (
            <div className="text-white/40 text-[11px] mt-2">
              Google OAuth isn't set up yet — see docs/CONNECT_GOOGLE.md. The email
              tool falls back to an IMAP app password until then.
            </div>
          )}
          {msg && <div className="text-white/50 text-[11px] mt-2">{msg}</div>}
        </div>

        {/* --- Notifications --- */}
        <div className="mt-6 pt-4 border-t border-white/15">
          <div className="text-xs tracking-widest text-white/40 mb-2">
            NOTIFICATIONS
          </div>
          <NotificationsRow />
        </div>

        {/* --- Account --- */}
        <div className="mt-6 pt-4 border-t border-white/15">
          <div className="text-xs tracking-widest text-white/40 mb-2">ACCOUNT</div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-white/70 truncate" title={user?.email}>
              {user?.name || user?.email || "Signed in"}
            </span>
            <button
              onClick={onLogout}
              className="border border-white/30 px-4 py-1.5 text-sm hover:border-white whitespace-nowrap"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotificationsRow() {
  const [state, setState] = useState(pushPermissionState());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const enable = async () => {
    setBusy(true);
    setMsg("");
    const res = await enablePush();
    setState(pushPermissionState());
    setMsg(res.ok ? "Notifications enabled." : res.reason);
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await api.pushTest(); // {enabled, subscriptions, sent, dead, errors}
      if (!r.enabled) {
        setMsg("Server push isn't configured (VAPID keys missing on the server).");
      } else if (r.subscriptions === 0) {
        setMsg("This device isn't subscribed yet — tap Enable first (inside the installed app on iOS).");
      } else if (r.sent > 0) {
        setMsg(
          `Sent to ${r.sent} device(s). On iOS it only arrives if you opened the app from the Home-Screen icon and allowed notifications.`
        );
      } else {
        setMsg("Push failed: " + (r.errors?.[0] || "unknown error"));
      }
    } catch (e) {
      setMsg("Couldn't send test.");
    } finally {
      setBusy(false);
    }
  };

  const testAlarm = async () => {
    setBusy(true);
    setMsg("");
    try {
      await api.createReminder({
        title: "Test alarm",
        remind_at: "in 1 minute",
        alarm: true,
      });
      setMsg("Test alarm set for ~1 minute from now. Keep the app open — it'll ring.");
    } catch (e) {
      setMsg("Couldn't set the test alarm.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-white/15 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm">Reminder push notifications</div>
          <div className="text-[11px] text-white/40">
            Get reminders even when the app is closed (install as an app for best
            results).
          </div>
        </div>
        {state === "granted" ? (
          <button
            onClick={test}
            disabled={busy}
            className="border border-white/30 px-3 py-1.5 text-xs hover:border-white whitespace-nowrap"
          >
            Send test
          </button>
        ) : (
          <button
            onClick={enable}
            disabled={busy || state === "denied"}
            className="bg-white text-black px-3 py-1.5 text-xs font-semibold hover:bg-white/85 disabled:opacity-40 whitespace-nowrap"
          >
            {busy ? "…" : "Enable"}
          </button>
        )}
      </div>

      {/* Trail-test the alarm: rings in ~1 minute while the app is open. */}
      <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-white/10">
        <div className="text-[11px] text-white/40">
          Test the alarm — sets one for ~1 minute from now.
        </div>
        <button
          onClick={testAlarm}
          disabled={busy}
          className="border border-white/30 px-3 py-1.5 text-xs hover:border-white whitespace-nowrap"
        >
          ⏰ Test alarm
        </button>
      </div>

      {/* Trail-test the Google Calendar channel end-to-end. */}
      <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-white/10">
        <div className="text-[11px] text-white/40">
          Test Google Calendar alerts — creates a test event ~2 min out.
        </div>
        <button
          onClick={async () => {
            setBusy(true);
            setMsg("");
            try {
              const r = await api.calendarTest();
              setMsg(
                r.ok
                  ? "Test event created — your phone should show a Google Calendar notification in ~2 minutes. (Delete the event after.)"
                  : "Calendar test failed: " + (r.error || "unknown") +
                    " — hit the status chip (top right) → Connect Google."
              );
            } catch {
              setMsg("Couldn't run the calendar test.");
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          className="border border-white/30 px-3 py-1.5 text-xs hover:border-white whitespace-nowrap"
        >
          📅 Test calendar
        </button>
      </div>

      {state === "denied" && (
        <div className="text-[11px] text-white/40 mt-2">
          Notifications are blocked in your browser settings — allow them for this
          site to enable.
        </div>
      )}
      {msg && <div className="text-[11px] text-white/60 mt-2">{msg}</div>}

      <AlertHealth />
    </div>
  );
}

// Per-channel health so a user always knows WHY an alert didn't come — and the fix.
function AlertHealth() {
  const [h, setH] = useState(null);

  useEffect(() => {
    api.pushHealth().then(setH).catch(() => {});
  }, []);
  if (!h) return null;

  const minsAgo = (iso) => {
    if (!iso) return null;
    const ref = h.server_now ? new Date(h.server_now + "Z") : new Date();
    return Math.round((ref - new Date(iso + "Z")) / 60000);
  };
  const remAge = minsAgo(h.cron_reminders_last);
  const scanAge = minsAgo(h.cron_scan_last);
  const perm = pushPermissionState();

  const rows = [
    h.push_configured
      ? [true, "Push server ready"]
      : [false, "Push server not configured — VAPID keys missing on the server (docs/PUSH.md)."],
    perm === "granted" && h.device_subscriptions > 0
      ? [true, `This device is subscribed (${h.device_subscriptions} device${h.device_subscriptions > 1 ? "s" : ""})`]
      : [false, "This device isn't subscribed — tap Enable above (on iPhone: open from the Home-Screen icon first)."],
    remAge !== null && remAge <= 5
      ? [true, `Reminder checker ran ${remAge} min ago`]
      : [false, remAge === null
          ? "Reminder checker has NEVER run — the every-1-min cron isn't set up (cron-job.org → docs/PUSH.md)."
          : `Reminder checker last ran ${remAge} min ago — the every-1-min cron looks stopped; check cron-job.org.`],
    scanAge !== null && scanAge <= 25
      ? [true, `Mail checker ran ${scanAge} min ago`]
      : [false, scanAge === null
          ? "Mail checker has NEVER run — the every-15-min cron isn't set up (cron-job.org → docs/PUSH.md)."
          : `Mail checker last ran ${scanAge} min ago — the every-15-min cron looks stopped; check cron-job.org.`],
    h.notify_new_mail
      ? [true, "New-mail alerts ON — arrive within ~1 min of a mail landing"]
      : [false, "New-mail alerts are OFF — turn on “Mail alerts” on the Priority page."],
  ];

  return (
    <div className="mt-3 pt-3 border-t border-white/10">
      <div className="text-[11px] tracking-widest text-white/40 mb-2">
        NOTIFICATION HEALTH
      </div>
      <div className="space-y-1.5">
        {rows.map(([ok, text], i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <span className={ok ? "text-green-400" : "text-amber-400"}>●</span>
            <span className={ok ? "text-white/55" : "text-white/75"}>{text}</span>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-white/35 mt-2">
        Delays are normal up to the checker interval: reminders &amp; new-mail
        ≈1 min, priority scans ≈15 min. If a row is amber, that's the exact
        reason an alert didn't arrive.
      </div>
    </div>
  );
}
