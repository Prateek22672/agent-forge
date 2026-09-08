import React from "react";
import { api } from "../api";

// The five-tab grid this replaces was navigation for its own sake: five buttons,
// permanently occupying the sidebar, four of them almost always leading to an
// empty page. Nobody used it, because a button that says "Priority" tells you
// nothing about whether there IS anything priority.
//
// So this shows the state instead of the destination. Each item appears only
// when it has something to report, and says what that is — "3 need a reply",
// "2 due today". Nothing pending means nothing on screen, and the chat gets the
// space back. Clicking opens the surface over the chat rather than replacing it,
// so a glance never costs you your place in the conversation.
export default function WorkspaceBar({ onOpen, autopilotOn }) {
  const [stats, setStats] = React.useState({ priority: 0, due: 0, notes: 0 });

  const load = React.useCallback(async () => {
    const [priority, reminders] = await Promise.allSettled([
      api.listPriority(),
      api.listReminders ? api.listReminders() : Promise.resolve([]),
    ]);
    const pri = priority.status === "fulfilled" && Array.isArray(priority.value)
      ? priority.value.filter((p) => !p.done && !p.handled).length
      : 0;
    const now = Date.now();
    const soon = now + 24 * 60 * 60 * 1000;
    const due = reminders.status === "fulfilled" && Array.isArray(reminders.value)
      ? reminders.value.filter((r) => {
          if (r.done) return false;
          const t = new Date(r.due_at || r.dueAt || 0).getTime();
          return t && t <= soon;
        }).length
      : 0;
    setStats({ priority: pri, due, notes: 0 });
  }, []);

  React.useEffect(() => {
    load();
    // Slow refresh: this is ambient context, not a live feed — polling harder
    // would wake the free backend for nothing.
    const t = setInterval(load, 120000);
    const onChange = () => load();
    window.addEventListener("agentforge:refresh", onChange);
    return () => {
      clearInterval(t);
      window.removeEventListener("agentforge:refresh", onChange);
    };
  }, [load]);

  const items = [];
  if (stats.priority > 0) {
    items.push({
      key: "priority",
      label: `${stats.priority} need${stats.priority === 1 ? "s" : ""} a reply`,
      tone: "urgent",
    });
  }
  if (stats.due > 0) {
    items.push({ key: "planner", label: `${stats.due} due today`, tone: "normal" });
  }
  if (autopilotOn) {
    items.push({ key: "autopilot", label: "Autopilot on", tone: "calm" });
  }

  // Nothing pending — say so once, quietly, instead of showing empty chrome.
  if (!items.length) {
    return (
      <div className="px-4 md:px-6 pt-3 pb-1 text-[11.5px] text-white/30 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-white/25" />
        All clear — nothing needs you right now.
        <button
          onClick={() => onOpen("planner")}
          className="ml-auto text-white/35 hover:text-white/70 underline underline-offset-2"
        >
          Plan something
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-6 pt-3 pb-1 flex items-center gap-2 flex-wrap">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onOpen(it.key)}
          className={
            "flex items-center gap-2 text-[11.5px] px-2.5 py-1 rounded-full border transition " +
            (it.tone === "urgent"
              ? "border-white/30 text-white/85 hover:border-white/60"
              : "border-white/12 text-white/50 hover:text-white/80 hover:border-white/30")
          }
        >
          <span
            className={
              "w-1.5 h-1.5 rounded-full " +
              (it.tone === "urgent" ? "bg-white/80" : "bg-white/35")
            }
          />
          {it.label}
        </button>
      ))}
      <button
        onClick={() => onOpen("brain")}
        className="ml-auto text-[11.5px] text-white/30 hover:text-white/70"
      >
        Memory
      </button>
    </div>
  );
}
