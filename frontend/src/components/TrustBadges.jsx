import React from "react";
import CrocsMark from "./CrocsMark";

// The trust promises, in one place, so every surface (landing, auth, connect)
// tells the same honest story.
export const TRUST_POINTS = [
  ["Never used for training", "Your messages and email content are sent to the model only to answer you, then discarded — never used to train anything."],
  ["Private to your account", "Everything lives in your own isolated account. No other user can see it; we don't sell or share it."],
  ["Secrets encrypted", "Your Google token and API keys are encrypted at rest — even a database dump can't read them."],
  ["You control access", "Sign-in asks for nothing sensitive. Gmail and Calendar are connected only if you choose to, and you can disconnect anytime."],
  ["No silent emails", "The AI can only draft email — sending always needs your explicit confirmation."],
  ["Hardened by Crocs", "Sanitised output, rate limits, per-user isolation, and admin-only key access guard against abuse."],
];

// Compact inline row of trust chips (for tight spaces like the auth card).
export function TrustChips({ className = "" }) {
  const chips = [
    "Never used for training",
    "Encrypted secrets",
    "You control access",
  ];
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-white/35 ${className}`}>
      <span className="flex items-center gap-1">
        <CrocsMark size={11} /> Crocs secured
      </span>
      {chips.map((c) => (
        <span key={c}>· {c}</span>
      ))}
    </div>
  );
}
