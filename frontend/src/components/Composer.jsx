import React from "react";

// One main input + capability badges (the agents). Picking a badge selects the
// capability used for the next message — ChatGPT-style tool selection.
export default function Composer({
  agents,
  activeAgentId,
  onPickAgent,
  input,
  setInput,
  onSend,
  busy,
  onNewAgent,
  suggestions = [],
  onPickSuggestion,
}) {
  return (
    <div className="border-t border-white/15 p-3 md:p-4 shrink-0">
      {/* Suggested next tasks (from the last reply) */}
      {suggestions.length > 0 && !busy && (
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="text-[11px] text-white/40 self-center">Suggested:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onPickSuggestion?.(s)}
              className="px-3 py-1 text-xs border border-white/25 text-white/80 hover:border-white hover:bg-white/5"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Capability badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => onPickAgent(a.id)}
            title={a.description}
            className={`px-3 py-1 text-xs border ${
              activeAgentId === a.id
                ? "bg-white text-black border-white font-semibold"
                : "border-white/30 text-white/80 hover:border-white"
            }`}
          >
            {a.name}
          </button>
        ))}
        <button
          onClick={onNewAgent}
          className="px-3 py-1 text-xs border border-dashed border-white/30 text-white/60 hover:border-white"
        >
          + New capability
        </button>
      </div>

      {/* Single input */}
      <div className="flex gap-2">
        <input
          className="flex-1 bg-black border border-white/30 px-4 py-3 focus:border-white outline-none"
          placeholder="Ask anything — pick a capability above…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          disabled={busy}
        />
        <button
          onClick={() => onSend()}
          disabled={busy}
          className="bg-white text-black px-6 font-semibold hover:bg-white/80 disabled:opacity-40"
        >
          {busy ? "…" : "Send"}
        </button>
      </div>

      {/* Permanent Crocs reassurance */}
      <div className="mt-2 text-center text-[11px] text-white/35">
        <b className="text-white/55">Crocs</b> secured · processed once · not
        retained · your data stays on your device
      </div>
    </div>
  );
}
