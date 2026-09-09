import React, { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import Strands from "./Strands";
import AgentHome from "./AgentHome";

// Scrollable message list. Assistant replies render as markdown (polished) and
// expose the RAG/tool trace (what was searched/recalled) underneath.
export default function Messages({
  messages,
  busy,
  activeAgentName,
  starters = [],
  onPickStarter,
  onNavigate,
  userName,
  connections,
}) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // An empty chat used to show a headline and a list of suggestions — the same
  // screen whether the agent had noticed something urgent or nothing at all.
  // AgentHome puts the agent's actual read of the moment there instead.
  if (messages.length === 0 && !busy) {
    return (
      <AgentHome
        activeAgentName={activeAgentName}
        starters={starters}
        onPickStarter={onPickStarter}
        onNavigate={onNavigate}
        userName={userName}
        connections={connections}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 space-y-5">
      {messages.map((m, i) => (
        <Bubble key={i} message={m} onNavigate={onNavigate} />
      ))}
      {busy && (
        <div className="flex items-center gap-3 text-white/50 text-sm">
          <div className="h-8 w-16">
            <Strands colors={["#7C3AED", "#06B6D4", "#FFFFFF"]} count={4} glow={2.6} speed={0.9} />
          </div>
          <ThinkingText />
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

// Reassuring, evolving status so a wait never feels stuck. Each phrase shows for
// a few seconds, then settles on "Almost there…" so the user always feels progress.
const THINKING_PHASES = [
  ["Reading your request…", 0],
  ["Working through it…", 2500],
  ["Gathering the details…", 6000],
  ["Putting it together…", 10000],
  ["Almost there…", 15000],
];

function ThinkingText() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const timers = THINKING_PHASES.slice(1).map(([, at], i) =>
      setTimeout(() => setIdx(i + 1), at)
    );
    return () => timers.forEach(clearTimeout);
  }, []);
  return <span>{THINKING_PHASES[idx][0]}</span>;
}

// Which tool call leads to which page — so replies carry a "go check it" button.
const TOOL_NAV = {
  create_reminder: ["Check your Reminders →", "planner"],
  create_note: ["Check your Notes →", "planner"],
  add_calendar_event: ["Open Calendar →", "planner"],
  list_upcoming_events: ["Open Calendar →", "planner"],
  fetch_recent_emails: ["Open Priority Inbox →", "priority"],
  remember: ["Open your Brain →", "brain"],
};

function Bubble({ message, onNavigate }) {
  const isUser = message.role === "user";
  const [showTrace, setShowTrace] = useState(false);
  const traces = message.tool_calls || [];

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-white text-black px-4 py-2 whitespace-pre-wrap rounded-2xl rounded-br-sm">
          {message.content}
        </div>
      </div>
    );
  }

  // Derive nav chips from what the agent actually DID this turn (deduped).
  const navActions = [];
  const seen = new Set();
  for (const t of traces) {
    const nav = TOOL_NAV[t.tool];
    if (nav && !seen.has(nav[1] + nav[0])) {
      seen.add(nav[1] + nav[0]);
      navActions.push(nav);
    }
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-full md:max-w-[85%] w-full md:w-auto border border-white/20 px-4 py-3 overflow-hidden rounded-2xl rounded-bl-sm">
        <Markdown text={message.content} />
        {navActions.length > 0 && onNavigate && (
          <div className="mt-3 flex flex-wrap gap-2">
            {navActions.map(([label, view]) => (
              <button
                key={label}
                onClick={() => onNavigate(view)}
                className="border border-white/40 px-3 py-1.5 text-xs font-medium hover:bg-white hover:text-black rounded-full"
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {traces.length > 0 && (
          <div className="mt-3 pt-2 border-t border-white/15">
            <button
              onClick={() => setShowTrace((s) => !s)}
              className="text-[11px] text-white/60 hover:text-white"
            >
              {showTrace ? "▾" : "▸"} {traces.length} retrieval/tool step
              {traces.length === 1 ? "" : "s"} (RAG trace)
            </button>
            {showTrace && (
              <div className="mt-2 space-y-2">
                {traces.map((t, i) => (
                  <div key={i} className="text-[11px] bg-white/5 border border-white/15 p-2 rounded-lg">
                    <div className="font-mono text-white/80">
                      {t.tool}({JSON.stringify(t.args)})
                    </div>
                    <div className="text-white/50 mt-1 line-clamp-4">{t.output}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
