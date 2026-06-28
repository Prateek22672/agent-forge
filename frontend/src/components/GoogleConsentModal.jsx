import React from "react";
import CrocsMark from "./CrocsMark";

// Shown the moment a user chooses to connect Gmail/Calendar — i.e. right before
// Google's own "unverified app" screen. We pre-empt the scary warning with an
// honest explanation of exactly what's accessed and how it's protected, so the
// user understands *why* Google warns and that it's safe to continue.
export default function GoogleConsentModal({ onContinue, onCancel }) {
  const access = [
    ["Read your recent email", "Only to summarise it and surface what's important — shown to you, never stored elsewhere, never shared."],
    ["Draft & send email", "The AI only drafts; nothing is sent until you press Send yourself."],
    ["Your calendar", "To show your upcoming events and add ones you ask for."],
  ];
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="border border-white/25 bg-black w-full max-w-md p-5 sm:p-6 my-auto max-h-[94vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-1">
          <CrocsMark size={20} />
          <span className="text-[10px] tracking-widest text-white/40">CROCS SECURED</span>
        </div>
        <h2 className="text-xl font-semibold mb-2">Connecting your Google account</h2>
        <p className="text-sm text-white/55 mb-4">
          You're about to grant Gmail &amp; Calendar access. Here's exactly what
          that's used for — and what we will never do.
        </p>

        <div className="space-y-2 mb-4">
          {access.map(([t, d]) => (
            <div key={t} className="border border-white/15 p-3">
              <div className="text-sm font-medium">{t}</div>
              <div className="text-xs text-white/50 mt-0.5">{d}</div>
            </div>
          ))}
        </div>

        <div className="border border-white/15 p-3 mb-4">
          <div className="text-[11px] tracking-widest text-white/40 mb-1">OUR PROMISE</div>
          <ul className="text-xs text-white/55 space-y-1 list-disc pl-4">
            <li>Never used to train any model.</li>
            <li>Never sold or shared. Stored only in your private, encrypted account.</li>
            <li>Disconnect anytime in Settings — access is revoked instantly.</li>
          </ul>
        </div>

        {/* Visual walkthrough of Google's safety screen so users aren't lost. */}
        <div className="border border-white/15 p-3 mb-4">
          <div className="text-[11px] tracking-widest text-white/40 mb-2">
            WHAT YOU'LL SEE NEXT — &amp; WHAT TO CLICK
          </div>
          <p className="text-xs text-white/55 mb-3">
            Google shows a “hasn't verified this app” screen because AgentFury is
            new and pending Google's review. It's safe to continue — here's how:
          </p>

          <div className="flex gap-2 mb-1">
            <span className="text-white font-semibold text-sm">1.</span>
            <span className="text-xs text-white/70">
              Click <b className="text-white">Advanced</b> (bottom-left).
            </span>
          </div>
          <img
            src="/gwarn-step1.png"
            alt="Click Advanced on Google's screen"
            className="w-full border border-white/15 mb-3"
            loading="lazy"
          />

          <div className="flex gap-2 mb-1">
            <span className="text-white font-semibold text-sm">2.</span>
            <span className="text-xs text-white/70">
              Click <b className="text-white">“Go to AgentFury (unsafe)”</b>.
            </span>
          </div>
          <img
            src="/gwarn-step2.png"
            alt="Click Go to AgentFury (unsafe)"
            className="w-full border border-white/15"
            loading="lazy"
          />

          <p className="text-[11px] text-white/40 mt-2">
            It says “unsafe” only because Google hasn't finished reviewing us yet —
            your data is protected exactly as promised above.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 border border-white/25 py-2.5 text-sm hover:border-white"
          >
            Not now
          </button>
          <button
            onClick={onContinue}
            className="flex-1 bg-white text-black py-2.5 font-semibold hover:bg-white/85"
          >
            Continue to Google
          </button>
        </div>
      </div>
    </div>
  );
}
