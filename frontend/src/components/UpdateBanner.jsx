import React from "react";

// Desktop only. Appears once an update has already finished downloading in the
// background, so the only thing left is a restart — which is why this offers a
// button rather than a progress bar. Nothing is asked of the user while the
// download is happening, because nothing is needed from them.
//
// It never blocks, never steals focus, and can be dismissed; the tray keeps the
// same option, so dismissing loses nothing.
export default function UpdateBanner() {
  const [state, setState] = React.useState(null);
  const [hidden, setHidden] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const u = window.agentforge?.update;
    if (!u) return; // browser, not the desktop app
    let off = () => {};
    u.state().then(setState).catch(() => {});
    off = u.onChange((s) => {
      setState(s);
      if (s?.status === "ready") setHidden(false); // a new build re-offers itself
    }) || (() => {});
    return () => off();
  }, []);

  if (hidden || !state || state.status !== "ready") return null;

  return (
    <div
      role="status"
      className="flex items-center gap-3 px-4 py-2 border-b border-white/10 bg-white/[0.04] text-[12.5px]"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
      <span className="text-white/75">
        AgentFury {state.version ? <b className="font-semibold">{state.version}</b> : "a new version"} is
        ready — it installs when you restart.
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await window.agentforge.update.install();
            if (!ok) setBusy(false); // stayed open — let them try again
          }}
          className="px-3 py-1 rounded-full bg-white text-black font-semibold hover:bg-white/85 disabled:opacity-60"
        >
          {busy ? "Restarting…" : "Restart now"}
        </button>
        <button
          onClick={() => setHidden(true)}
          className="px-2 py-1 text-white/45 hover:text-white/80"
        >
          Later
        </button>
      </div>
    </div>
  );
}
