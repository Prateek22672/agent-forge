import React from "react";
import Strands from "./Strands";
import CrocsMark from "./CrocsMark";

// Official home page — monochrome, SaaS-grade. The only brand mark allowed
// beyond the wordmark is "Crocs" (our security layer). No colour, no emoji.
export default function Landing({ onGetStarted, onSignIn }) {
  return (
    <div className="h-full w-full overflow-y-auto bg-black text-white">
      <Nav onGetStarted={onGetStarted} onSignIn={onSignIn} />
      <Hero onGetStarted={onGetStarted} onSignIn={onSignIn} />
      <Crocs />
      <Download onGetStarted={onGetStarted} />
      <Footer />
    </div>
  );
}

function Nav({ onGetStarted, onSignIn }) {
  return (
    <header className="sticky top-0 z-20 backdrop-blur bg-black/70 border-b border-white/10">
      <div className="max-w-5xl mx-auto flex items-center justify-between px-6 h-16">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-[0.2em] text-sm">AGENTFURY</span>
          <span className="hidden sm:flex items-center gap-1.5 text-[10px] tracking-widest text-white/40 border border-white/15 px-2 py-0.5">
            <CrocsMark size={13} /> CROCS SECURED
          </span>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <button onClick={onSignIn} className="px-3 py-1.5 text-white/70 hover:text-white">
            Sign in
          </button>
          <button
            onClick={onGetStarted}
            className="px-4 py-1.5 bg-white text-black font-medium hover:bg-white/85"
          >
            Get started
          </button>
        </nav>
      </div>
    </header>
  );
}

function Hero({ onGetStarted, onSignIn }) {
  return (
    <section className="relative overflow-hidden border-b border-white/10">
      {/* Monochrome animated accent (grayscale, low opacity) */}
      <div className="pointer-events-none absolute inset-x-0 -top-10 h-[420px] opacity-30">
        <Strands colors={["#ffffff", "#9a9a9a", "#ffffff"]} count={5} saturation={0} glow={2.2} amplitude={1} />
      </div>
      <div className="relative max-w-5xl mx-auto px-6 py-28 text-center">
        <div className="inline-block text-[11px] tracking-[0.25em] text-white/45 border border-white/15 px-3 py-1 mb-8">
          PERSONAL AI WORKFORCE
        </div>
        <h1 className="text-5xl md:text-7xl font-semibold leading-[1.04] tracking-tight">
          Agents that do the
          <br /> work for you.
        </h1>
        <p className="mt-7 text-white/55 text-lg max-w-2xl mx-auto leading-relaxed">
          Build agents that search the web, read and send your email, set
          reminders, and remember what matters — running on free models, owned by
          you, secured by Crocs.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <button
            onClick={onGetStarted}
            className="px-7 py-3 bg-white text-black font-medium hover:bg-white/85"
          >
            Get started — free
          </button>
          <button
            onClick={onSignIn}
            className="px-7 py-3 border border-white/25 hover:border-white"
          >
            Sign in
          </button>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs text-white/35 tracking-wide">
          <span>Free models — Groq · Gemini · local</span>
          <span>Sign in clean — connect Gmail only if you want</span>
          <span>Never used for training</span>
        </div>
      </div>
    </section>
  );
}

function Crocs() {
  const promises = [
    ["Never used for training", "Your messages and email content go to the model only to answer you, then they're discarded — never used to train anything."],
    ["You control Google access", "Sign-in asks for nothing sensitive. Gmail & Calendar are connected only if you choose, and you can disconnect anytime."],
    ["No silent emails", "The AI can only draft. Sending always needs your explicit confirmation."],
    ["Secrets encrypted", "Your Google token and API keys are encrypted at rest — even a database dump can't read them."],
    ["Private to your account", "Everything lives in your own isolated account. No other user can see it; we don't sell or share it."],
    ["Hardened by default", "Sanitised output, rate limiting, and strict per-user isolation guard against abuse."],
  ];
  return (
    <section className="border-b border-white/10">
      <div className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-2 mb-3">
            <CrocsMark size={26} />
            <span className="text-[11px] tracking-[0.25em] text-white/40">
              PROTECTED BY CROCS
            </span>
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Security is the product.
          </h2>
          <p className="mt-4 text-white/50 max-w-xl mx-auto">
            Crocs is our built-in security layer. Every task your agents run is
            guarded by it — here's our promise.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 border-t border-l border-white/10">
          {promises.map(([title, body]) => (
            <div key={title} className="border-b border-r border-white/10 p-7">
              <div className="font-medium mb-1.5">{title}</div>
              <div className="text-white/50 text-sm leading-relaxed">{body}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Download({ onGetStarted }) {
  return (
    <section id="download" className="border-b border-white/10">
      <div className="max-w-5xl mx-auto px-6 py-20 text-center">
        <div className="text-[11px] tracking-[0.25em] text-white/40 mb-3">DOWNLOAD</div>
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Run it your way.
        </h2>
        <p className="mt-4 text-white/50 max-w-xl mx-auto">
          Use it instantly in the browser, or install the desktop app for
          background reminder notifications that reach you even when it's closed.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href="https://github.com/Prateek22672/agent-forge/releases/latest/download/AgentFury-Setup.exe"
            target="_blank"
            rel="noreferrer"
            className="px-7 py-3 bg-white text-black font-medium hover:bg-white/85"
          >
            Download for Windows
          </a>
          <a
            href="https://github.com/Prateek22672/agent-forge/releases/latest/download/AgentFury.dmg"
            target="_blank"
            rel="noreferrer"
            className="px-7 py-3 border border-white/25 hover:border-white"
          >
            Download for Mac
          </a>
          <button
            onClick={onGetStarted}
            className="px-7 py-3 border border-white/15 text-white/70 hover:border-white"
          >
            Use in browser
          </button>
        </div>
        <div className="mt-5 text-xs text-white/30">
          Or click “Install” in your browser bar for the lightweight web app
        </div>
        <div className="mt-2 text-[11px] text-white/25">
          Mac first run: right-click the app → Open (it's unsigned during beta)
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="max-w-5xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/35">
      <span className="tracking-[0.2em]">AGENTFURY</span>
      <div className="flex items-center gap-4">
        <a href="/privacy" className="hover:text-white">Privacy</a>
        <a href="/terms" className="hover:text-white">Terms</a>
        <span>Secured by Crocs</span>
      </div>
    </footer>
  );
}
