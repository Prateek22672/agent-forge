import React, { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import Strands from "./Strands";

// Scrollable message list. Assistant replies render as markdown (polished) and
// expose the RAG/tool trace (what was searched/recalled) underneath.
export default function Messages({
  messages,
  busy,
  activeAgentName,
  starters = [],
  onPickStarter,
}) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // ChatGPT-style centered empty state, with starter-prompt chips so it's
  // immediately clear what this capability can do.
  if (messages.length === 0 && !busy) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="h-28 w-60 mb-4 opacity-90">
          <Strands colors={["#7C3AED", "#06B6D4", "#FFFFFF"]} count={4} glow={2.4} amplitude={1.1} />
        </div>
        <h2 className="text-2xl md:text-3xl font-semibold text-white/90">
          Where should we begin?
        </h2>
        <p className="text-white/40 text-sm mt-2 mb-5">
          {activeAgentName ? `Using "${activeAgentName}"` : "Pick a capability below"} ·
          try one of these:
        </p>
        <div className="flex flex-col gap-2 w-full max-w-md">
          {starters.map((s) => (
            <button
              key={s}
              onClick={() => onPickStarter?.(s)}
              className="text-left border border-white/20 px-4 py-2.5 text-sm hover:border-white hover:bg-white/5"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
      {messages.map((m, i) => (
        <Bubble key={i} message={m} />
      ))}
      {busy && (
        <div className="flex items-center gap-3 text-white/50 text-sm">
          <div className="h-8 w-16">
            <Strands colors={["#7C3AED", "#06B6D4", "#FFFFFF"]} count={4} glow={2.6} speed={0.9} />
          </div>
          Generating…
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function Bubble({ message }) {
  const isUser = message.role === "user";
  const [showTrace, setShowTrace] = useState(false);
  const traces = message.tool_calls || [];

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-white text-black px-4 py-2 whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] border border-white/20 px-4 py-3">
        <Markdown text={message.content} />
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
                  <div key={i} className="text-[11px] bg-white/5 border border-white/15 p-2">
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
