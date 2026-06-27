import React from "react";

// Left sidebar: section nav (Chats / Reminders / Notes) + chat history.
export default function History({
  conversations,
  activeId,
  onPick,
  onNew,
  onDelete,
  view,
  setView,
}) {
  const NAV = [
    ["chat", "Chats"],
    ["priority", "Priority"],
    ["planner", "Planner"],
    ["brain", "Brain"],
  ];
  return (
    <aside className="w-64 h-full min-h-0 border-r border-white/15 flex flex-col shrink-0">
      {/* Section nav (pinned) */}
      <div className="grid grid-cols-2 gap-1 p-2 border-b border-white/10 shrink-0">
        {NAV.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`text-xs py-2 border ${
              view === key
                ? "bg-white text-black border-white font-semibold"
                : "border-white/20 text-white/70 hover:border-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "chat" && (
        <>
          <button
            onClick={onNew}
            className="m-3 shrink-0 bg-white text-black py-2 font-semibold hover:bg-white/80"
          >
            + New chat
          </button>
          <div className="px-3 pb-1 shrink-0 text-[10px] tracking-widest text-white/40">
            HISTORY
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-1">
            {conversations.length === 0 && (
              <div className="text-white/30 text-xs px-2 py-3">No chats yet.</div>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group w-full px-3 py-2 border text-sm cursor-pointer ${
                  activeId === c.id
                    ? "border-white bg-white/10"
                    : "border-transparent hover:border-white/20"
                }`}
                onClick={() => onPick(c)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate flex-1">{c.title}</div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 text-xs"
                    title="Delete chat"
                  >
                    ×
                  </button>
                </div>
                <div className="text-[10px] text-white/40 truncate">{c.agent_name}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {view !== "chat" && (
        <div className="flex-1 px-3 py-4 text-xs text-white/40">
          Your personal {view} live here. The Assistant can add items for you from
          chat.
        </div>
      )}
    </aside>
  );
}
