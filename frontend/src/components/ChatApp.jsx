import React, { useEffect, useState } from "react";
import { api } from "../api";
import TopBar from "./TopBar";
import History from "./History";
import Messages from "./Messages";
import Composer from "./Composer";
import SettingsModal from "./SettingsModal";
import AgentForm from "./AgentForm";
import PrivacyNote, { privacySeen } from "./PrivacyNote";
import Trackers from "./Trackers";
import EmailConfirm from "./EmailConfirm";
import { startersFor } from "../suggestions";
import { startAlarm, stopAlarm } from "../alarm";

// The authenticated app: ChatGPT-style single input + capability badges +
// history sidebar. Everything here is scoped to the logged-in user.
export default function ChatApp({ user, onLogout }) {
  const [agents, setAgents] = useState([]);
  const [activeAgentId, setActiveAgentId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const [settings, setSettings] = useState(null);
  const [connections, setConnections] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [suggestions, setSuggestions] = useState([]); // per-reply next tasks
  const [showPrivacy, setShowPrivacy] = useState(!privacySeen("app"));
  const [view, setView] = useState("chat"); // chat | priority | planner | brain
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [pendingEmails, setPendingEmails] = useState([]);
  const [alarmReminder, setAlarmReminder] = useState(null); // ringing alarm

  const loadPending = () =>
    api.pendingEmails().then(setPendingEmails).catch(() => setPendingEmails([]));

  const loadMeta = async () => {
    setSettings(await api.getSettings().catch(() => null));
    setConnections(await api.getConnections().catch(() => null));
  };

  const reconnectGoogle = async () => {
    try {
      const desktop = !!(window.agentforge?.isDesktop && window.agentforge?.openExternal);
      const { auth_url } = await api.googleStart(desktop);
      if (desktop) window.agentforge.openExternal(auth_url);
      else window.location.href = auth_url;
    } catch (e) {
      /* surfaced elsewhere */
    }
  };
  const loadAgents = async () => {
    const list = await api.listAgents();
    setAgents(list);
    if (!activeAgentId && list.length) {
      // Default to the Email capability when present.
      const def = list.find((a) => a.name === "Email") || list[0];
      setActiveAgentId(def.id);
    }
    return list;
  };
  const loadHistory = async () => {
    setConversations(await api.listAllConversations().catch(() => []));
  };

  useEffect(() => {
    loadAgents();
    loadHistory();
    loadMeta();
    loadPending();
    // Keep the user's timezone current so chat-set reminders fire at their local
    // time (the cloud server runs in UTC).
    api
      .updateProfile({ tz_offset_min: new Date().getTimezoneOffset() })
      .catch(() => {});
    // Returning from Google OAuth.
    const p = new URLSearchParams(window.location.search);
    if (p.get("google")) {
      window.history.replaceState({}, "", "/");
      loadMeta();
    }
  }, []);

  // Reminder pinger: ask permission, then every 30s fire an OS notification for
  // any reminder whose time has arrived (works while the app/PWA is open).
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    const fired = new Set();
    const tick = async () => {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      let items = [];
      try {
        items = await api.listReminders();
      } catch {
        return;
      }
      const now = Date.now();
      for (const r of items) {
        if (
          r.status === "pending" &&
          !r.notified &&
          !fired.has(r.id) &&
          r.due_at &&
          new Date(r.due_at.endsWith("Z") ? r.due_at : r.due_at + "Z").getTime() <= now
        ) {
          fired.add(r.id);
          try {
            new Notification(r.alarm ? "⏰ Alarm" : "Reminder", {
              body: r.title,
              icon: "/icon.svg",
              requireInteraction: !!r.alarm,
            });
          } catch {
            /* ignore */
          }
          if (r.alarm) {
            startAlarm();
            setAlarmReminder(r);
          }
          api.markReminderNotified(r.id).catch(() => {});
        }
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  const newChat = () => {
    setConversationId(null);
    setMessages([]);
    setSuggestions([]);
  };

  // Switching capability starts a fresh thread — a conversation belongs to ONE
  // agent, so continuing it under a different agent would 404. This keeps things
  // consistent and predictable.
  const pickAgent = (id) => {
    if (id === activeAgentId) return;
    setActiveAgentId(id);
    newChat();
  };

  const deleteConversation = async (c) => {
    await api.deleteConversation(c.id).catch(() => {});
    if (conversationId === c.id) newChat();
    loadHistory();
  };

  const pickConversation = async (c) => {
    setView("chat");
    setActiveAgentId(c.agent_id);
    setConversationId(c.id);
    const msgs = await api.getMessages(c.id);
    setMessages(
      msgs.map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: m.meta?.tool_calls || [],
      }))
    );
  };

  // `textArg` lets a suggestion/starter chip send directly.
  const send = async (textArg) => {
    const text = (typeof textArg === "string" ? textArg : input).trim();
    if (!text || busy || !activeAgentId) return;
    if (typeof textArg !== "string") setInput("");
    setSuggestions([]);
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const res = await api.chat(activeAgentId, text, conversationId);
      setConversationId(res.conversation_id);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.reply, tool_calls: res.tool_calls },
      ]);
      setSuggestions(res.suggestions || []);
      loadHistory();
      loadPending(); // the agent may have drafted an email to confirm
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `⚠ ${e.message}`, tool_calls: [] },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const activeAgent = agents.find((a) => a.id === activeAgentId);

  return (
    <div className="h-full flex flex-col">
      <TopBar
        user={user}
        settings={settings}
        connections={connections}
        onOpenSettings={() => setShowSettings(true)}
        onOpenAdmin={() => (window.location.href = "/admin")}
        onReconnectGoogle={reconnectGoogle}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        onLogout={onLogout}
      />

      <div className="flex-1 flex min-h-0 relative">
        {/* Sidebar: inline on desktop, slide-in drawer on mobile */}
        <div
          className={`${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } md:translate-x-0 transition-transform duration-200 fixed md:relative inset-y-0 left-0 z-40 md:z-auto bg-black h-full`}
        >
          <History
            conversations={conversations}
            activeId={conversationId}
            onPick={(c) => {
              pickConversation(c);
              setSidebarOpen(false);
            }}
            onNew={() => {
              setView("chat");
              newChat();
              setSidebarOpen(false);
            }}
            onDelete={deleteConversation}
            view={view}
            setView={(v) => {
              setView(v);
              setSidebarOpen(false);
            }}
          />
        </div>
        {sidebarOpen && (
          <div
            className="md:hidden fixed inset-0 bg-black/60 z-30"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {view !== "chat" ? (
          <Trackers view={view} user={user} />
        ) : (
          <main className="flex-1 flex flex-col min-w-0">
            <Messages
              messages={messages}
              busy={busy}
              activeAgentName={activeAgent?.name}
              starters={messages.length === 0 ? startersFor(activeAgent?.name) : []}
              onPickStarter={(s) => send(s)}
            />
            {pendingEmails.length > 0 && (
              <div className="px-6 pb-2 space-y-2">
                {pendingEmails.map((d) => (
                  <EmailConfirm key={d.id} draft={d} onResolved={loadPending} />
                ))}
              </div>
            )}
            <Composer
              agents={agents}
              activeAgentId={activeAgentId}
              onPickAgent={pickAgent}
              input={input}
              setInput={setInput}
              onSend={send}
              busy={busy}
              onNewAgent={() => setShowForm(true)}
              suggestions={suggestions}
              onPickSuggestion={(s) => send(s)}
            />
          </main>
        )}
      </div>

      {showPrivacy && <PrivacyNote variant="app" onClose={() => setShowPrivacy(false)} />}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onChanged={loadMeta}
          user={user}
          onLogout={onLogout}
        />
      )}
      {showForm && (
        <AgentForm
          onSaved={async (a) => {
            setShowForm(false);
            await loadAgents();
            setActiveAgentId(a.id);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Ringing alarm — blocks until dismissed, stops the sound. */}
      {alarmReminder && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
          <div className="border border-white/30 bg-black w-full max-w-sm p-6 text-center">
            <div className="text-5xl mb-3">⏰</div>
            <div className="text-xs tracking-widest text-white/40 mb-1">ALARM</div>
            <div className="text-lg font-semibold mb-5">{alarmReminder.title}</div>
            <button
              onClick={() => {
                stopAlarm();
                setAlarmReminder(null);
              }}
              className="w-full bg-white text-black py-3 font-semibold hover:bg-white/85"
            >
              Stop alarm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
