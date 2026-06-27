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
  const [view, setView] = useState("chat"); // chat | reminders | notes | brain
  const [pendingEmails, setPendingEmails] = useState([]);

  const loadPending = () =>
    api.pendingEmails().then(setPendingEmails).catch(() => setPendingEmails([]));

  const loadMeta = async () => {
    setSettings(await api.getSettings().catch(() => null));
    setConnections(await api.getConnections().catch(() => null));
  };
  const loadAgents = async () => {
    const list = await api.listAgents();
    setAgents(list);
    if (!activeAgentId && list.length) setActiveAgentId(list[0].id);
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
          new Date(r.due_at).getTime() <= now
        ) {
          fired.add(r.id);
          try {
            new Notification("Reminder", { body: r.title, icon: "/icon.svg" });
          } catch {
            /* ignore */
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
        onLogout={onLogout}
      />

      <div className="flex-1 flex min-h-0">
        <History
          conversations={conversations}
          activeId={conversationId}
          onPick={pickConversation}
          onNew={() => {
            setView("chat");
            newChat();
          }}
          onDelete={deleteConversation}
          view={view}
          setView={setView}
        />

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
        <SettingsModal onClose={() => setShowSettings(false)} onChanged={loadMeta} />
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
    </div>
  );
}
