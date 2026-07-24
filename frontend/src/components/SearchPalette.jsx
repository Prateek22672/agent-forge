import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";

// Cmd/Ctrl+K global search — one box that searches chats, notes, reminders,
// brain facts, and priority emails, with keyboard navigation. Spotlight-style.
export default function SearchPalette({ conversations, onPickConversation, onNavigate, onClose }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState({ notes: [], reminders: [], brain: [], priority: [] });
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    Promise.allSettled([
      api.listNotes(),
      api.listReminders(),
      api.listBrain(),
      api.listPriority(),
    ]).then(([notes, reminders, brain, priority]) => {
      setData({
        notes: notes.status === "fulfilled" ? notes.value : [],
        reminders: reminders.status === "fulfilled" ? reminders.value : [],
        brain: brain.status === "fulfilled" ? brain.value : [],
        priority: priority.status === "fulfilled" ? priority.value : [],
      });
    });
  }, []);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    const match = (s) => !query || (s || "").toLowerCase().includes(query);

    const out = [];
    conversations
      .filter((c) => match(c.title) || match(c.agent_name))
      .slice(0, 8)
      .forEach((c) =>
        out.push({
          kind: "chat",
          icon: "💬",
          title: c.title || "Untitled chat",
          sub: c.agent_name || "",
          action: () => onPickConversation(c),
        })
      );
    data.priority
      .filter((p) => match(p.subject) || match(p.sender) || match(p.category))
      .slice(0, 6)
      .forEach((p) =>
        out.push({
          kind: "priority",
          icon: "⭐",
          title: p.subject || "(no subject)",
          sub: `${p.sender || ""} · ${p.category || ""}`,
          action: () => onNavigate("priority"),
        })
      );
    data.reminders
      .filter((r) => match(r.title))
      .slice(0, 6)
      .forEach((r) =>
        out.push({
          kind: "reminder",
          icon: r.alarm ? "🚨" : "⏰",
          title: r.title,
          sub: r.remind_at || "",
          action: () => onNavigate("planner"),
        })
      );
    data.notes
      .filter((n) => match(n.title) || match(n.content))
      .slice(0, 6)
      .forEach((n) =>
        out.push({
          kind: "note",
          icon: "📝",
          title: n.title || "Note",
          sub: (n.content || "").slice(0, 60),
          action: () => onNavigate("planner"),
        })
      );
    data.brain
      .filter((f) => match(f.text))
      .slice(0, 6)
      .forEach((f) =>
        out.push({
          kind: "brain",
          icon: "🧠",
          title: f.text,
          sub: "Brain",
          action: () => onNavigate("brain"),
        })
      );
    return out;
  }, [q, conversations, data, onPickConversation, onNavigate]);

  useEffect(() => setActive(0), [q]);

  const select = (r) => {
    if (!r) return;
    r.action();
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(results[active]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-black border border-white/20 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <span className="text-white/40">⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search chats, notes, reminders, brain, priority…"
            className="flex-1 bg-transparent outline-none border-none text-[15px] placeholder:text-white/35"
          />
          <kbd className="text-[10px] text-white/35 border border-white/15 rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto py-2">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-white/35">
              {q ? "No matches." : "Type to search everything."}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => select(r)}
              onMouseEnter={() => setActive(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                i === active ? "bg-white/10" : ""
              }`}
            >
              <span className="text-base shrink-0">{r.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm truncate">{r.title}</span>
                {r.sub && (
                  <span className="block text-xs text-white/40 truncate">{r.sub}</span>
                )}
              </span>
              <span className="text-[10px] text-white/30 uppercase tracking-wide shrink-0">
                {r.kind}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
