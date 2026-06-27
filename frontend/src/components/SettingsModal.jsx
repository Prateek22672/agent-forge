import React, { useEffect, useState } from "react";
import { api } from "../api";

// Settings: model privacy toggle (Groq cloud vs local Ollama) + Google connect.
export default function SettingsModal({ onClose, onChanged }) {
  const [settings, setSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [conn, setConn] = useState(null);
  const [profile, setProfile] = useState(null);
  const [msg, setMsg] = useState("");

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

  const connectGoogle = async () => {
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
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-30">
      <div className="bg-black border border-white/30 w-full max-w-lg p-6">
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
      </div>
    </div>
  );
}
