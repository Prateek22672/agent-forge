import React from "react";
import { api } from "../api";
import Strands from "./Strands";

// The home surface, replacing "Where should we begin?" and a row of static
// suggestion chips.
//
// THE RULE THIS IS BUILT ON: every tile reports something true right now, and
// every tile does something when clicked. That's the difference between an agent
// surface and a dashboard — a dashboard tells you a number, an agent tells you
// what it noticed and offers to act on it. Nothing here is a vanity metric, and
// nothing is a label that could have been printed before the app loaded.
//
// Anything with nothing to report doesn't render. An empty grid of zeroes is
// what made the old five-tab layout feel dead.

const useLive = () => {
  const [state, setState] = React.useState({
    loading: true,
    priority: [],
    reminders: [],
    notes: 0,
    activity: [],
  });

  const load = React.useCallback(async () => {
    const [pri, rem, notes, act] = await Promise.allSettled([
      api.listPriority(),
      api.listReminders(),
      api.listNotes(),
      api.autopilotActivity(),
    ]);
    const val = (r, d) => (r.status === "fulfilled" && r.value ? r.value : d);
    setState({
      loading: false,
      priority: (val(pri, []) || []).filter((p) => !p.done && !p.handled),
      reminders: (val(rem, []) || []).filter((r) => !r.done),
      notes: (val(notes, []) || []).length,
      activity: (val(act, []) || []).slice(0, 4),
    });
  }, []);

  React.useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener("agentforge:refresh", onRefresh);
    return () => window.removeEventListener("agentforge:refresh", onRefresh);
  }, [load]);

  return state;
};

const fmtDue = (iso) => {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = t - Date.now();
  const mins = Math.round(diff / 60000);
  if (diff < 0) return "overdue";
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function Tile({ children, onClick, tone = "normal", className = "" }) {
  return (
    <button
      onClick={onClick}
      className={
        "group relative text-left w-full rounded-2xl border p-4 transition-all duration-200 " +
        "hover:-translate-y-0.5 " +
        (tone === "urgent"
          ? "border-white/25 bg-white/[0.06] hover:border-white/50"
          : "border-white/10 bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.05]") +
        " " + className
      }
    >
      {children}
    </button>
  );
}

const Label = ({ children }) => (
  <div className="text-[10px] uppercase tracking-[0.16em] text-white/35 mb-2">{children}</div>
);

export default function AgentHome({
  activeAgentName,
  starters = [],
  onPickStarter,
  onNavigate,
  userName,
}) {
  const live = useLive();

  const greeting = React.useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }, []);

  const urgent = live.priority.length;
  const dueSoon = live.reminders.filter((r) => {
    const t = new Date(r.due_at || r.dueAt || 0).getTime();
    return t && t - Date.now() < 24 * 60 * 60 * 1000;
  });

  // What the agent would say if you asked "anything I should know?" — one line,
  // derived from real state, so it reads as a briefing rather than a slogan.
  const briefing = live.loading
    ? "Catching up…"
    : urgent
      ? `${urgent} message${urgent === 1 ? "" : "s"} looks like it needs a reply.`
      : dueSoon.length
        ? `${dueSoon.length} thing${dueSoon.length === 1 ? "" : "s"} due in the next day.`
        : "Nothing needs you right now.";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 pt-10 pb-8">
        {/* Hero — the agent's own read of the moment */}
        <div className="relative mb-8">
          <div className="pointer-events-none absolute -top-14 left-1/2 -translate-x-1/2 h-32 w-72 opacity-70">
            <Strands colors={["#7C3AED", "#06B6D4", "#FFFFFF"]} count={4} glow={2.4} amplitude={1.1} />
          </div>
          <div className="relative pt-6">
            <h1 className="text-[27px] md:text-[32px] font-semibold tracking-tight leading-tight">
              {greeting}
              {userName ? `, ${userName}` : ""}.
            </h1>
            <p className="mt-1.5 text-white/45 text-[15px]">{briefing}</p>
          </div>
        </div>

        {/* Live tiles — only what has something to say */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
          {urgent > 0 && (
            <Tile tone="urgent" onClick={() => onNavigate?.("priority")}>
              <Label>Needs a reply</Label>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums leading-none">{urgent}</span>
                <span className="text-white/45 text-sm">waiting</span>
              </div>
              <div className="mt-2.5 text-[12.5px] text-white/55 truncate">
                {live.priority[0]?.subject || live.priority[0]?.title || "Open to review"}
              </div>
              <span className="absolute right-4 top-4 text-white/25 group-hover:text-white/60 transition">→</span>
            </Tile>
          )}

          {dueSoon.length > 0 && (
            <Tile onClick={() => onNavigate?.("planner")}>
              <Label>Coming up</Label>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums leading-none">{dueSoon.length}</span>
                <span className="text-white/45 text-sm">due soon</span>
              </div>
              <div className="mt-2.5 text-[12.5px] text-white/55 truncate">
                {dueSoon[0]?.text || dueSoon[0]?.title}
                <span className="text-white/30"> · {fmtDue(dueSoon[0]?.due_at || dueSoon[0]?.dueAt)}</span>
              </div>
              <span className="absolute right-4 top-4 text-white/25 group-hover:text-white/60 transition">→</span>
            </Tile>
          )}

          {live.activity.length > 0 && (
            <Tile onClick={() => onNavigate?.("autopilot")} className="sm:col-span-2">
              <Label>What I did while you were away</Label>
              <ul className="space-y-1.5">
                {live.activity.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12.5px] text-white/60">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-white/40 shrink-0" />
                    <span className="truncate">{a.summary || a.action || a.text}</span>
                  </li>
                ))}
              </ul>
            </Tile>
          )}
        </div>

        {/* Ask — the primary action, always last so state comes first */}
        <div>
          <Label>{activeAgentName ? `Ask "${activeAgentName}"` : "Ask"}</Label>
          <div className="grid gap-2">
            {starters.map((s) => (
              <button
                key={s}
                onClick={() => onPickStarter?.(s)}
                className="group flex items-center justify-between gap-3 text-left rounded-xl border border-white/10
                           bg-white/[0.02] px-4 py-3 text-[13.5px] text-white/75
                           hover:border-white/30 hover:bg-white/[0.05] hover:text-white transition"
              >
                <span>{s}</span>
                <span className="text-white/20 group-hover:text-white/50 transition shrink-0">↵</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
