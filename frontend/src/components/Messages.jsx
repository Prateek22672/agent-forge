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
        <div className="af-enter max-w-[75%] bg-white text-black px-4 py-2.5 whitespace-pre-wrap
                        rounded-2xl rounded-br-md text-[13.5px] leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  // Plain names for what the agent actually used, so the header says what it
  // did rather than exposing function names.
  const TOOL_LABEL = {
    fetch_recent_emails: "read email",
    send_email: "sent email",
    create_reminder: "set a reminder",
    create_note: "saved a note",
    add_calendar_event: "added an event",
    list_upcoming_events: "checked calendar",
    web_search: "searched the web",
    remember: "remembered",
    recall: "recalled",
  };
  const toolChips = [...new Set(traces.map((t) => TOOL_LABEL[t.tool]).filter(Boolean))].slice(0, 3);

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

  // A reply is a CARD, not a paragraph. It carries a header saying who is
  // speaking and what it did, the answer, then the actions that follow from it —
  // so a reply that used a tool looks visibly different from one that just
  // answered, and you can see the work without reading it.
  return (
    <div className="af-enter flex justify-start">
      <div
        className="max-w-full md:max-w-[86%] w-full md:w-auto rounded-2xl rounded-bl-md overflow-hidden
                   border border-white/12 bg-white/[0.028]"
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <span
            className="grid place-items-center w-5 h-5 rounded-md shrink-0"
            style={{ background: "rgb(var(--c-accent) / 0.16)", color: "rgb(var(--c-accent))" }}
          >
            <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden>
              <path d="M12 2.6l1.7 5.1a4 4 0 0 0 2.6 2.6l5.1 1.7-5.1 1.7a4 4 0 0 0-2.6 2.6L12 21.4l-1.7-5.1a4 4 0 0 0-2.6-2.6L2.6 12l5.1-1.7a4 4 0 0 0 2.6-2.6L12 2.6z" />
            </svg>
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/40">
            AgentFury
          </span>
          {toolChips.length > 0 && (
            <div className="flex items-center gap-1.5 ml-1 flex-wrap">
              {toolChips.map((t) => (
                <span
                  key={t}
                  className="text-[10px] px-2 py-[3px] rounded-full text-white/55 bg-white/[0.06]
                             border border-white/10"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 pb-3.5">
          <Markdown text={message.content} />
        </div>

        {navActions.length > 0 && onNavigate && (
          <div className="flex flex-wrap gap-2 px-4 pb-3.5">
            {navActions.map(([label, view]) => (
              <button
                key={label}
                onClick={() => onNavigate(view)}
                className="px-3.5 py-1.5 text-[12px] font-medium rounded-full transition
                           border border-white/18 text-white/80
                           hover:text-white hover:border-white/45 hover:bg-white/[0.07]"
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {traces.length > 0 && (
          <div className="border-t border-white/[0.08] bg-white/[0.015]">
            <button
              onClick={() => setShowTrace((s) => !s)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-[11px] text-white/45
                         hover:text-white/80 transition"
            >
              <span aria-hidden className={"transition-transform " + (showTrace ? "rotate-90" : "")}>›</span>
              {traces.length} step{traces.length === 1 ? "" : "s"} — how it got this
            </button>
            {showTrace && (
              <div className="px-4 pb-3.5 space-y-2">
                {traces.map((t, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                    <div className="text-[11px] font-mono text-white/75">{t.tool}</div>
                    <div className="text-[10.5px] font-mono text-white/30 mt-0.5 break-all">
                      {JSON.stringify(t.args)}
                    </div>
                    <div className="text-[11px] text-white/50 mt-1.5 line-clamp-4 leading-relaxed">
                      {t.output}
                    </div>
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
