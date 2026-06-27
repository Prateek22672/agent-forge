import React from "react";
import Strands from "./Strands";

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
          <span className="font-semibold tracking-[0.2em] text-sm">AGENTFORGE</span>
          <span className="hidden sm:inline text-[10px] tracking-widest text-white/40 border border-white/15 px-2 py-0.5">
            CROCS SECURED
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
          <span>Connect Gmail with Google</span>
          <span>Private, on-device data</span>
        </div>
      </div>
    </section>
  );
}

function Crocs() {
  const promises = [
    ["No silent emails", "The AI can only draft. Sending always needs your explicit confirmation."],
    ["Keys never exposed", "API keys and tokens live in your OS keychain — masked, write-only."],
    ["Your data, your device", "Chats, memory and reminders stay local. Never used for training."],
    ["Hardened by default", "Sanitised output, rate limiting, and strict per-user isolation."],
  ];
  return (
    <section className="border-b border-white/10">
      <div className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <div className="text-[11px] tracking-[0.25em] text-white/40 mb-3">
            PROTECTED BY CROCS
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
            href="https://github.com/Prateek22672/agent-forge/releases/latest/download/AgentForge-Setup.exe"
            target="_blank"
            rel="noreferrer"
            className="px-7 py-3 bg-white text-black font-medium hover:bg-white/85"
          >
            Download for Windows
          </a>
          <button
            onClick={onGetStarted}
            className="px-7 py-3 border border-white/25 hover:border-white"
          >
            Get started in browser
          </button>
        </div>
        <div className="mt-5 text-xs text-white/30">
          Browser works on Mac, Windows &amp; mobile · desktop app for Windows (Mac soon)
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="max-w-5xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/35">
      <span className="tracking-[0.2em]">AGENTFORGE</span>
      <span>Secured by Crocs · Private by design</span>
    </footer>
  );
}
