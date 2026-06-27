import React from "react";
import ConnectionStatus from "./ConnectionStatus";

// Top status strip: brand, live provider, Google connection state, settings,
// and the signed-in user with a logout option.
export default function TopBar({
  user,
  settings,
  connections,
  onOpenSettings,
  onOpenAdmin,
  onReconnectGoogle,
  onLogout,
}) {
  const provider = settings?.llm_provider || "groq";
  const google = connections?.google;
  const providerLabel =
    provider === "ollama" ? "LOCAL · OLLAMA" : provider === "gemini" ? "GEMINI" : "GROQ";

  return (
    <div className="flex items-center justify-between border-b border-white/15 px-5 h-14 shrink-0">
      <div className="flex items-center gap-3">
        <span className="font-semibold tracking-[0.2em] text-sm">AGENTFORGE</span>
        <span
          className="text-[10px] border border-white/20 px-2 py-0.5 text-white/45 tracking-widest"
          title="Protected by Crocs — see docs/CROCS_SECURITY.md"
        >
          CROCS SECURED
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <span className="border border-white/25 px-2 py-1 tracking-wide">{providerLabel}</span>

        <ConnectionStatus connections={connections} onReconnect={onReconnectGoogle} />

        {user?.is_admin && (
          <button
            onClick={onOpenAdmin}
            className="border border-white/30 px-3 py-1 hover:border-white"
            title="Admin panel"
          >
            Admin
          </button>
        )}

        <button
          onClick={onOpenSettings}
          className="bg-white text-black px-3 py-1 font-semibold hover:bg-white/80"
        >
          Settings
        </button>

        {/* User menu */}
        <div className="flex items-center gap-2 pl-2 border-l border-white/15">
          <span className="text-white/60 max-w-[160px] truncate" title={user?.email}>
            {user?.name || user?.email}
          </span>
          <button onClick={onLogout} className="text-white/50 hover:text-white underline">
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
