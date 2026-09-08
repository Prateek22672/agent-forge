import React from "react";

// Left sidebar: chats, and only chats.
//
// This used to carry a five-button grid — Chats / Autopilot / Priority /
// Planner / Brain — pinned above the history. It was navigation for its own
// sake: four of those five almost always opened an empty page, and the grid
// cost the sidebar its top third permanently. Those features now surface where
// they're relevant (see WorkspaceBar), so the sidebar does one job well.
export default function History({
  conversations,
  activeId,
  onPick,
  onNew,
  onDelete,
}) {
  return (
    <aside className="w-64 h-full min-h-0 border-r border-white/15 flex flex-col shrink-0">
      {(
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
                className={`group w-full px-3 py-2 border rounded-xl text-sm cursor-pointer ${
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
    </aside>
  );
}
