import React, { useEffect, useState } from "react";
import { api } from "../api";

// Personal trackers — "Prateek's Reminders" / "Prateek's Notes". Items created
// from chat (via the agent's tools) show up here too.
export default function Trackers({ view, user }) {
  const firstName = (user?.name || user?.email || "Your").split(/[ @]/)[0];
  if (view === "priority") return <Priority owner={firstName} />;
  if (view === "reminders") return <Reminders owner={firstName} />;
  if (view === "brain") return <Brain owner={firstName} />;
  return <Notes owner={firstName} />;
}

function Priority({ owner }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () => api.listPriority().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  const scan = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await api.scanPriority();
      setMsg(r.new > 0 ? `${r.new} new priority email(s).` : "No new priority emails.");
      load();
    } catch (e) {
      setMsg("Scan failed — make sure Gmail is connected.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-white/15 px-4 md:px-6 py-4 flex items-center justify-between gap-3">
        <div className="font-semibold text-lg">{owner}'s Priority Inbox</div>
        <button
          onClick={scan}
          disabled={busy}
          className="bg-white text-black px-4 py-1.5 text-sm font-semibold hover:bg-white/85 disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? "Scanning…" : "Scan now"}
        </button>
      </div>
      <div className="px-4 md:px-6 py-2 text-xs text-white/40 border-b border-white/10">
        Important mail — placements, interviews, deadlines — surfaced from your
        inbox. You'll get a push when new ones land.
      </div>
      {msg && <div className="px-4 md:px-6 py-2 text-xs text-white/60">{msg}</div>}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-2">
        {items.length === 0 && (
          <Empty text="Nothing flagged yet. Connect Gmail and tap “Scan now”." />
        )}
        {items.map((p) => (
          <div key={p.id} className="border border-white/15 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] tracking-widest text-white/45 uppercase mb-1">
                  {p.category || "Priority"}
                </div>
                <div className="font-medium text-sm truncate">{p.subject}</div>
                <div className="text-xs text-white/40 truncate">{p.sender}</div>
                {p.reason && (
                  <div className="text-xs text-white/60 mt-1">→ {p.reason}</div>
                )}
              </div>
              <button
                onClick={async () => {
                  await api.dismissPriority(p.id);
                  load();
                }}
                className="text-white/40 hover:text-red-400 text-xs whitespace-nowrap"
              >
                dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Brain({ owner }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const load = () => api.listBrain().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);
  const add = async () => {
    if (!text.trim()) return;
    await api.addBrain(text.trim());
    setText("");
    load();
  };
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Header title={`${owner}'s Brain`} />
      <div className="px-6 py-3 text-xs text-white/40 border-b border-white/10">
        Facts here (contacts, emails, preferences) are recalled automatically by
        the Assistant — so it doesn't have to keep asking.
      </div>
      <div className="px-6 py-4 flex gap-2 border-b border-white/10">
        <input
          className="flex-1 bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
          placeholder="e.g. Bharat Velineni's email is bvelinen@gitam.in"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add} className="bg-white text-black px-5 font-semibold hover:bg-white/85">
          Add
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {items.length === 0 && <Empty text="Nothing yet. Tell the Assistant facts to remember, or add them here." />}
        {items.map((f) => (
          <div key={f.id} className="flex items-center gap-3 border border-white/15 px-4 py-3">
            <div className="flex-1 text-sm">{f.text}</div>
            <button
              onClick={async () => {
                await api.deleteBrain(f.id);
                load();
              }}
              className="text-white/40 hover:text-red-400 text-sm"
            >
              delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Header({ title }) {
  return (
    <div className="border-b border-white/15 px-6 py-4">
      <div className="font-semibold text-lg">{title}</div>
    </div>
  );
}

function Reminders({ owner }) {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");

  const load = () => api.listReminders().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!title.trim()) return;
    await api.createReminder({ title: title.trim(), remind_at: when.trim() });
    setTitle("");
    setWhen("");
    load();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Header title={`${owner}'s Reminders`} />
      <div className="px-6 py-4 flex gap-2 border-b border-white/10">
        <input
          className="flex-1 bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
          placeholder="Remind me to…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <input
          className="w-48 bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
          placeholder="when (e.g. today 9 PM)"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add} className="bg-white text-black px-5 font-semibold hover:bg-white/85">
          Add
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {items.length === 0 && <Empty text="No reminders yet. Ask the Assistant to set one." />}
        {items.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-3 border border-white/15 px-4 py-3"
          >
            <input
              type="checkbox"
              checked={r.status === "done"}
              onChange={async () => {
                await api.toggleReminder(r.id);
                load();
              }}
            />
            <div className="flex-1">
              <div className={r.status === "done" ? "line-through text-white/40" : ""}>
                {r.title}
              </div>
              <div className="text-xs text-white/40">
                {r.remind_at}
                {r.due_at && (
                  <span className="text-white/60">
                    {" "}· due {new Date(r.due_at).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={async () => {
                await api.deleteReminder(r.id);
                load();
              }}
              className="text-white/40 hover:text-red-400 text-sm"
            >
              delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Notes({ owner }) {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const load = () => api.listNotes().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!title.trim() && !content.trim()) return;
    await api.createNote({ title: title.trim(), content: content.trim() });
    setTitle("");
    setContent("");
    load();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Header title={`${owner}'s Notes`} />
      <div className="px-6 py-4 border-b border-white/10 space-y-2">
        <input
          className="w-full bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
          placeholder="Note title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full bg-black border border-white/30 px-3 py-2 h-20 focus:border-white outline-none"
          placeholder="Write a note…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button onClick={add} className="bg-white text-black px-5 py-2 font-semibold hover:bg-white/85">
          Add note
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.length === 0 && <Empty text="No notes yet. Ask the Assistant to jot one down." />}
        {items.map((n) => (
          <div key={n.id} className="border border-white/15 p-4">
            <div className="flex justify-between items-start">
              <div className="font-semibold">{n.title || "Note"}</div>
              <button
                onClick={async () => {
                  await api.deleteNote(n.id);
                  load();
                }}
                className="text-white/40 hover:text-red-400 text-xs"
              >
                delete
              </button>
            </div>
            <div className="text-white/60 text-sm mt-1 whitespace-pre-wrap">{n.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <div className="text-white/30 text-sm">{text}</div>;
}
