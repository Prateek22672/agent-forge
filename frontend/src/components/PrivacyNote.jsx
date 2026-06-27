import React from "react";

// One-time trust popup. `variant` controls the storage key so it can show once
// on the landing page (before login) and once inside the app (after login).
export default function PrivacyNote({ variant = "app", onClose }) {
  const points = [
    ["Processed once", "Each message is sent to the model only to answer it — never retained for training."],
    ["On your device", "Your chats, agents and memories live in a local database on your machine."],
    ["Keys stay safe", "API keys and your Gmail token are kept in your OS keychain, not in plain files."],
    ["No silent emails", "The AI can only draft email — sending always needs your explicit confirmation."],
    ["Hardened", "Sanitised output, rate limits, and admin-only key access guard against abuse."],
  ];
  return (
    <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md border border-white/25 bg-black p-6">
        <div className="text-[11px] tracking-[0.25em] text-white/45 mb-1">
          PROTECTED BY CROCS
        </div>
        <h2 className="text-lg font-semibold mb-1">Your data, your device.</h2>
        <p className="text-white/50 text-sm mb-5">
          Crocs is our built-in security layer. Here's exactly how it protects your
          data and accounts.
        </p>
        <div className="space-y-3 mb-6 border-t border-white/10">
          {points.map(([title, body]) => (
            <div key={title} className="flex gap-3 border-b border-white/10 pb-3 pt-1">
              <div>
                <div className="text-sm font-medium">{title}</div>
                <div className="text-white/50 text-xs">{body}</div>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            localStorage.setItem(`af_privacy_${variant}`, "1");
            onClose();
          }}
          className="w-full bg-white text-black py-2.5 font-semibold hover:bg-white/85"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export function privacySeen(variant) {
  return localStorage.getItem(`af_privacy_${variant}`) === "1";
}
