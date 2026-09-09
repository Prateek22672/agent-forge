import React from "react";

// Left rail.
//
// It used to carry a five-button grid — Chats / Autopilot / Priority / Planner /
// Brain — pinned above the history. Navigation for its own sake: four of the
// five almost always opened an empty page, and it cost the sidebar its top third
// permanently. Those live where they're relevant now (WorkspaceBar, AgentMap),
// so the rail does one job.
//
// The shape follows what people already have muscle memory for: a compact row of
// icon actions at the top, then history grouped by age. Grouping matters more
// than it looks — a flat list of forty titles is unscannable, while "Today /
// Yesterday / Earlier" lets you find a conversation by when you had it, which is
// usually how you remember it.

const Icon = {
  pencil: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
    </svg>
  ),
  panel: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9.5 4v16" />
    </svg>
  ),
};

// Bucket by day so the list stays scannable as it grows.
function group(conversations) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const weekAgo = startOfToday - 6 * 86400000;

  const buckets = { Today: [], Yesterday: [], "Previous 7 days": [], Earlier: [] };
  for (const c of conversations) {
    const raw = c.updated_at || c.created_at;
    const t = raw ? new Date(String(raw).endsWith("Z") ? raw : raw + "Z").getTime() : 0;
    if (!t) buckets.Earlier.push(c);
    else if (t >= startOfToday) buckets.Today.push(c);
    else if (t >= startOfYesterday) buckets.Yesterday.push(c);
    else if (t >= weekAgo) buckets["Previous 7 days"].push(c);
    else buckets.Earlier.push(c);
  }
  return Object.entries(buckets).filter(([, list]) => list.length);
}

export default function History({
  conversations,
  activeId,
  onPick,
  onNew,
  onDelete,
  onSearch,
  onCollapse,
  collapsed = false,
}) {
  const groups = group(conversations);

  // Collapsed is a NARROW RAIL, not a disappearance. Hiding the sidebar
  // outright leaves the window with no visible way back and no sense of where
  // you are; a 56px strip keeps New chat, search and the expand control one
  // click away while giving the conversation the width back.
  if (collapsed) {
    return (
      <aside
        className="w-14 h-full min-h-0 border-r border-white/10 flex flex-col items-center
                   shrink-0 bg-white/[0.015] py-2.5 gap-1"
      >
        <button
          onClick={onCollapse}
          title="Show sidebar"
          aria-label="Show sidebar"
          className="p-2.5 rounded-xl text-white/45 hover:text-white hover:bg-white/[0.07] transition"
        >
          {Icon.panel}
        </button>
        <button
          onClick={onNew}
          title="New chat"
          aria-label="New chat"
          className="p-2.5 rounded-xl text-white/70 hover:text-white hover:bg-white/[0.07] transition"
        >
          {Icon.pencil}
        </button>
        <button
          onClick={onSearch}
          title="Search chats"
          aria-label="Search chats"
          className="p-2.5 rounded-xl text-white/45 hover:text-white hover:bg-white/[0.07] transition"
        >
          {Icon.search}
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-[268px] h-full min-h-0 border-r border-white/10 flex flex-col shrink-0 bg-white/[0.015]">
      {/* Icon row */}
      <div className="flex items-center gap-1 p-2.5 shrink-0">
        <button
          onClick={onNew}
          className="flex-1 flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium
                     text-white/85 hover:text-white hover:bg-white/[0.07] transition"
        >
          {Icon.pencil}
          New chat
        </button>
        <button
          onClick={onSearch}
          title="Search chats"
          aria-label="Search chats"
          className="p-2 rounded-xl text-white/45 hover:text-white hover:bg-white/[0.07] transition"
        >
          {Icon.search}
        </button>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Hide sidebar"
            aria-label="Hide sidebar"
            className="p-2 rounded-xl text-white/45 hover:text-white hover:bg-white/[0.07] transition"
          >
            {Icon.panel}
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 && (
          <div className="text-white/25 text-[12.5px] px-3 py-4 leading-relaxed">
            No chats yet.
            <br />
            Ask something to start one.
          </div>
        )}

        {groups.map(([label, list]) => (
          <div key={label} className="mb-1">
            <div className="px-3 pt-3 pb-1.5 text-[10.5px] font-medium text-white/30">{label}</div>
            {list.map((c) => {
              const on = activeId === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => onPick(c)}
                  className={
                    "group relative flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] cursor-pointer " +
                    "transition-colors duration-150 " +
                    (on ? "bg-white/[0.09] text-white" : "text-white/65 hover:bg-white/[0.05] hover:text-white/90")
                  }
                >
                  <span className="truncate flex-1">{c.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c);
                    }}
                    title="Delete chat"
                    aria-label={`Delete ${c.title}`}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-white/35
                               hover:text-red-400 text-base leading-none px-1 transition"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
