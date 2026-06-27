import React, { useState } from "react";
import { api } from "../api";

// Secure send: the agent only DRAFTS. This card lets the logged-in user review
// and explicitly confirm before anything is actually sent.
export default function EmailConfirm({ draft, onResolved }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const send = async () => {
    setBusy(true);
    setStatus("");
    try {
      await api.sendEmail(draft.id);
      setStatus("sent");
      onResolved?.();
    } catch (e) {
      setStatus(String(e.message).replace(/^\d+\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    await api.cancelEmail(draft.id).catch(() => {});
    onResolved?.();
  };

  if (status === "sent") {
    return (
      <div className="border border-white/30 bg-white/5 px-4 py-3 text-sm">
        Email sent to {draft.to_addr}
      </div>
    );
  }

  return (
    <div className="border border-white/40 bg-white/[0.03] p-4">
      <div className="text-xs tracking-widest text-white/60 mb-2">
        CONFIRM BEFORE SENDING
      </div>
      <div className="text-sm space-y-1">
        <div><span className="text-white/40">To:</span> {draft.to_addr}</div>
        <div><span className="text-white/40">Subject:</span> {draft.subject}</div>
        <div className="text-white/70 whitespace-pre-wrap border-t border-white/10 pt-2 mt-2">
          {draft.body}
        </div>
      </div>
      {status && <div className="text-red-400 text-xs mt-2">{status}</div>}
      <div className="flex gap-2 mt-3">
        <button
          onClick={send}
          disabled={busy}
          className="bg-white text-black px-5 py-1.5 font-semibold hover:bg-white/85 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send"}
        </button>
        <button
          onClick={cancel}
          className="border border-white/30 px-5 py-1.5 hover:border-white"
        >
          Cancel
        </button>
      </div>
      <div className="text-[11px] text-white/35 mt-2">
        <b className="text-white/55">Crocs</b> secured · only you can send this —
        it requires your signed-in session. The AI can never send by itself.
      </div>
    </div>
  );
}
