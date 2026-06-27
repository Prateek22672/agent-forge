import React from "react";
import ConnectionStatus from "./ConnectionStatus";
import CrocsMark from "./CrocsMark";

// Top status strip. Responsive: condenses on mobile, with a hamburger to open
// the sidebar drawer.
export default function TopBar({
  user,
  settings,
  connections,
  onOpenSettings,
  onOpenAdmin,
  onReconnectGoogle,
  onToggleSidebar,
  onLogout,
}) {
  const provider = settings?.llm_provider || "groq";
  const providerLabel =
    provider === "ollama" ? "LOCAL" : provider === "gemini" ? "GEMINI" : "GROQ";

  return (
    <div className="flex items-center justify-between border-b border-white/15 px-3 md:px-5 h-14 shrink-0 gap-2">
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        <button
          onClick={onToggleSidebar}
          className="md:hidden border border-white/25 px-2 py-1 text-sm"
          aria-label="Menu"
        >
          ☰
        </button>
        <span className="font-semibold tracking-[0.15em] md:tracking-[0.2em] text-xs md:text-sm whitespace-nowrap">
          AGENTFORGE
        </span>
        <span
          className="hidden lg:flex items-center gap-1.5 text-[10px] border border-white/20 px-2 py-0.5 text-white/45 tracking-widest"
          title="Protected by Crocs"
        >
          <CrocsMark size={13} /> CROCS SECURED
        </span>
      </div>

      <div className="flex items-center gap-2 md:gap-3 text-xs min-w-0">
        <span className="hidden sm:inline border border-white/25 px-2 py-1 tracking-wide">
          {providerLabel}
        </span>

        <ConnectionStatus connections={connections} onReconnect={onReconnectGoogle} />

        {user?.is_admin && (
          <button
            onClick={onOpenAdmin}
            className="hidden sm:block border border-white/30 px-3 py-1 hover:border-white"
            title="Admin panel"
          >
            Admin
          </button>
        )}

        <button
          onClick={onOpenSettings}
          className="bg-white text-black px-2 md:px-3 py-1 font-semibold hover:bg-white/80 whitespace-nowrap"
        >
          Settings
        </button>

        <div className="flex items-center gap-2 pl-1 md:pl-2 md:border-l border-white/15">
          <span
            className="hidden md:inline text-white/60 max-w-[140px] truncate"
            title={user?.email}
          >
            {user?.name || user?.email}
          </span>
          <button
            onClick={onLogout}
            className="text-white/50 hover:text-white underline whitespace-nowrap"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
