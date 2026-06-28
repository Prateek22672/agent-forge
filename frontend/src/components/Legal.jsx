import React from "react";
import CrocsMark from "./CrocsMark";

// Public Privacy Policy + Terms pages (no auth) — required for Google OAuth
// verification of an app that reads Gmail/Calendar. Plain, honest, accurate to
// how AgentFury actually handles data.
const UPDATED = "June 28, 2026";

function Shell({ title, children }) {
  return (
    <div className="min-h-full bg-black text-white">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <span className="font-semibold tracking-[0.2em] text-sm">AGENTFURY</span>
            <span className="hidden sm:flex items-center gap-1.5 text-[10px] tracking-widest text-white/40 border border-white/15 px-2 py-0.5">
              <CrocsMark size={12} /> CROCS SECURED
            </span>
          </a>
          <a href="/" className="text-sm text-white/60 hover:text-white">
            ← Home
          </a>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-white/40 text-sm mt-2 mb-8">Last updated: {UPDATED}</p>
        <div className="space-y-6 text-white/70 leading-relaxed text-[15px]">
          {children}
        </div>
      </main>
      <footer className="border-t border-white/10 mt-8">
        <div className="max-w-3xl mx-auto px-6 py-6 text-xs text-white/35 flex gap-4">
          <a href="/privacy" className="hover:text-white">Privacy</a>
          <a href="/terms" className="hover:text-white">Terms</a>
          <span className="ml-auto">© 2026 AgentFury</span>
        </div>
      </footer>
    </div>
  );
}

function H({ children }) {
  return <h2 className="text-xl font-semibold text-white mt-8">{children}</h2>;
}

export function Privacy() {
  return (
    <Shell title="Privacy Policy">
      <p>
        AgentFury ("we", "the app") is a personal AI assistant that can, at your
        request, read and summarise your email, manage reminders and notes, and
        read or create calendar events. This policy explains exactly what data we
        access, why, and how we protect it.
      </p>

      <H>What we access</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><b>Account basics</b> (name, email) — to create and identify your account.</li>
        <li><b>Google Gmail</b> (only if you connect it) — to read recent emails so the
          assistant can summarise them and surface important ones, and to create
          drafts. We never send email without your explicit confirmation.</li>
        <li><b>Google Calendar</b> (only if you connect it) — to show your upcoming
          events and add events you ask for.</li>
        <li><b>Your content</b> — chats, reminders, notes, and saved "brain" facts you
          create in the app.</li>
      </ul>

      <H>How your Google data is used</H>
      <p>
        Gmail and Calendar access is requested <b>only when you choose to connect</b>
        those features — signing in alone never requests them. When connected, your
        email/calendar data is used <b>solely to provide the feature you asked for</b>
        (e.g. summarising your inbox) and is shown back to you. We do{" "}
        <b>not</b> use it for advertising, and we do <b>not</b> use it — or any
        AgentFury user data — to train AI models.
      </p>
      <p>
        AgentFury's use of information received from Google APIs adheres to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <H>AI processing</H>
      <p>
        To answer you, the relevant text of your request is sent to our model
        providers (e.g. Groq, Google Gemini) for that single request and is not
        retained by them for training under their API terms. We only send what's
        needed to fulfil the task.
      </p>

      <H>Storage &amp; security</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>Your data is stored in your own isolated account; no other user can access it.</li>
        <li>Your Google access token and API keys are <b>encrypted at rest</b>.</li>
        <li>Passwords are stored only as salted hashes, never in plain text.</li>
        <li>Access is protected by authentication, rate limiting, and per-user isolation.</li>
      </ul>

      <H>Your choices</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><b>Disconnect Google</b> anytime in Settings — this revokes our access immediately.</li>
        <li>You can also revoke access at{" "}
          <a href="https://myaccount.google.com/permissions" className="underline" target="_blank" rel="noreferrer">
            myaccount.google.com/permissions
          </a>.</li>
        <li>Turn off chat history storage in Settings, or delete your reminders, notes, and chats.</li>
        <li>Request account deletion by emailing us (below); we delete your data and tokens.</li>
      </ul>

      <H>Data retention</H>
      <p>
        We keep your content while your account is active. When you disconnect Google
        or delete your account, the associated tokens and data are removed.
      </p>

      <H>Contact</H>
      <p>
        Questions or deletion requests: <b>prateek.koratala@gmail.com</b>.
      </p>
    </Shell>
  );
}

export function Terms() {
  return (
    <Shell title="Terms of Service">
      <p>
        By using AgentFury you agree to these terms. If you don't agree, please
        don't use the app.
      </p>

      <H>The service</H>
      <p>
        AgentFury is a personal AI assistant provided on an "as is" basis, currently
        in beta. Features may change, and AI output can be imperfect — review
        important results (especially before sending email or relying on summaries).
      </p>

      <H>Your account &amp; conduct</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>You're responsible for activity under your account and for keeping it secure.</li>
        <li>Don't use the app for unlawful, abusive, or harmful purposes, or to violate others' rights.</li>
        <li>Don't attempt to disrupt, attack, or reverse-engineer the service.</li>
      </ul>

      <H>Google data</H>
      <p>
        If you connect Google, you authorise AgentFury to access Gmail/Calendar as
        described in our{" "}
        <a href="/privacy" className="underline">Privacy Policy</a>. The AI only
        drafts email; it never sends without your explicit confirmation.
      </p>

      <H>No warranty &amp; liability</H>
      <p>
        The service is provided without warranties of any kind. To the maximum extent
        permitted by law, AgentFury is not liable for any indirect or consequential
        damages arising from your use of the app or reliance on its output.
      </p>

      <H>Changes &amp; termination</H>
      <p>
        We may update these terms or the service, and may suspend accounts that
        violate them. You can stop using the app and delete your account at any time.
      </p>

      <H>Contact</H>
      <p>Questions: <b>prateek.koratala@gmail.com</b>.</p>
    </Shell>
  );
}
