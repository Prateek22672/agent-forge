import React, { useEffect, useState } from "react";
import { api } from "../api";

// Personal trackers — "Prateek's Reminders" / "Prateek's Notes". Items created
// from chat (via the agent's tools) show up here too.
export default function Trackers({ view, user }) {
  const firstName = (user?.name || user?.email || "Your").split(/[ @]/)[0];
  if (view === "reminders") return <Reminders owner={firstName} />;
  if (view === "brain") return <Brain owner={firstName} />;
  return <Notes owner={firstName} />;
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
