import React, { useEffect, useRef, useState } from "react";

// Clickable Google connection indicator. The chip is green when Gmail works,
// amber when only signed in, grey when not connected. Clicking opens a panel
// listing each service with a green/red dot + a Reconnect action.
export default function ConnectionStatus({ connections, onReconnect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const g = connections?.google;
  const svc = g?.services || {};

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (!g) return null;

  // Overall chip colour.
  const overall = !g.connected
    ? "bg-white/30" // grey — not connected
    : svc.gmail_read
    ? "bg-green-500" // green — Gmail working
    : "bg-amber-400"; // amber — signed in only

  const label = g.connected
    ? g.account_email || "Google"
    : "Google not connected";

  const rows = [
    ["Sign-in", svc.signed_in],
    ["Gmail — read", svc.gmail_read],
    ["Gmail — send", svc.gmail_send],
    ["Calendar", svc.calendar],
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 border border-white/25 px-2 py-1 hover:border-white"
      >
        <span className={`inline-block w-2 h-2 rounded-full ${overall}`} />
        <span className="max-w-[180px] truncate">{label}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 border border-white/25 bg-black z-50 p-3 text-left">
          <div className="text-[10px] tracking-widest text-white/40 mb-2">
            GOOGLE SERVICES
          </div>
          <div className="space-y-1.5">
            {rows.map(([name, ok]) => (
              <div key={name} className="flex items-center justify-between text-xs">
                <span className="text-white/80">{name}</span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      ok ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className={ok ? "text-green-400" : "text-red-400"}>
                    {ok ? "On" : "Off"}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {!svc.gmail_read && (
            <div className="text-[11px] text-white/40 mt-3 leading-relaxed">
              Email/Calendar are off. Reconnect and approve Google access to turn
              them on.
            </div>
          )}

          <button
            onClick={() => {
              setOpen(false);
              onReconnect?.();
            }}
            className="w-full mt-3 bg-white text-black py-1.5 text-xs font-semibold hover:bg-white/85"
          >
            {g.connected ? "Reconnect Google" : "Connect Google"}
          </button>
        </div>
      )}
    </div>
  );
}
