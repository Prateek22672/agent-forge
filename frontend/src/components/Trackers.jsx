import React, { useEffect, useState } from "react";
import { api } from "../api";

// Personal trackers — "Prateek's Reminders" / "Prateek's Notes". Items created
// from chat (via the agent's tools) show up here too.
export default function Trackers({ view, user }) {
  const firstName = (user?.name || user?.email || "Your").split(/[ @]/)[0];
  if (view === "priority") return <Priority owner={firstName} />;
  if (view === "brain") return <Brain owner={firstName} />;
  return <Planner owner={firstName} />; // reminders + notes + calendar together
}

function Calendar() {
  const [state, setState] = useState({ connected: true, granted: true, events: [] });
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.listCalendar().then(setState).catch(() =>
      setState({ connected: false, granted: false, events: [] })
    );
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!title.trim() || !when.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      await api.createCalendarEvent({ title: title.trim(), when: when.trim() });
      setTitle("");
      setWhen("");
      setMsg("Event added.");
      load();
    } catch (e) {
      setMsg("Couldn't add — check the time and that Calendar is connected.");
    } finally {
      setBusy(false);
    }
  };

  const fmt = (iso, allDay) => {
    if (!iso) return "";
    const d = new Date(iso);
    return allDay ? d.toLocaleDateString() : d.toLocaleString();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className="px-4 md:px-6 py-4 flex flex-wrap items-center gap-2 border-b border-white/10">
        <input
          className="flex-1 min-w-[160px] bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
          placeholder="Event title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <input
          className="w-full sm:w-48 bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
          placeholder="when (e.g. tomorrow 10:30am)"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button
          onClick={add}
          disabled={busy}
          className="bg-white text-black px-5 py-2 font-semibold hover:bg-white/85 disabled:opacity-50"
        >
          Add
        </button>
        {msg && <div className="w-full text-[11px] text-white/50">{msg}</div>}
      </div>
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-2">
        {!state.connected && (
          <Empty text="Connect Google in Settings to see your calendar." />
        )}
        {state.connected && !state.granted && (
          <Empty text="Calendar permission not granted — reconnect Google in Settings to allow Calendar." />
        )}
        {state.connected && state.granted && state.events.length === 0 && (
          <Empty text="No upcoming events. Add one above or ask the Assistant." />
        )}
        {state.events.map((e) => (
          <a
            key={e.id}
            href={e.link || "#"}
            target="_blank"
            rel="noreferrer"
            className="block border border-white/15 p-4 hover:border-white/40"
          >
            <div className="text-xs text-white/45">{fmt(e.start, e.all_day)}</div>
            <div className="font-medium text-sm">{e.summary}</div>
            {e.location && (
              <div className="text-xs text-white/40">@ {e.location}</div>
            )}
          </a>
        ))}
      </div>

      {/* Apple Calendar (and any calendar app) via ICS subscription. */}
      <div className="border-t border-white/10 px-4 md:px-6 py-3 flex flex-wrap items-center gap-2">
        <div className="text-[11px] text-white/40 flex-1 min-w-[200px]">
           Apple Calendar / other apps: subscribe to your AgentFury feed
          (reminders + priority emails). iPhone: Settings → Apps → Calendar →
          Accounts → Add Subscribed Calendar.
        </div>
        <button
          onClick={async () => {
            try {
              const { url } = await api.calendarFeedUrl();
              await navigator.clipboard.writeText(url);
              setMsg("Feed URL copied — paste it as a subscribed calendar.");
            } catch {
              setMsg("Couldn't copy the feed URL.");
            }
          }}
          className="border border-white/30 px-3 py-1.5 text-xs hover:border-white whitespace-nowrap"
        >
          Copy feed URL
        </button>
      </div>
    </div>
  );
}

// Reminders and Notes merged into one scrollable page with two clear sections.
function Planner({ owner }) {
  const [tab, setTab] = useState("reminders");
  const TABS = [
    ["reminders", "Reminders"],
    ["notes", "Notes"],
    ["calendar", "Calendar"],
  ];
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className="border-b border-white/15 px-4 md:px-6 pt-4 shrink-0">
        <div className="font-semibold text-lg mb-3">{owner}'s Planner</div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 py-2 text-sm border-b-2 whitespace-nowrap ${
                tab === k
                  ? "border-white text-white font-semibold"
                  : "border-transparent text-white/50 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {tab === "reminders" && <Reminders />}
        {tab === "notes" && <Notes />}
        {tab === "calendar" && <Calendar />}
      </div>
    </div>
  );
}

const SCAN_FREQS = [
  ["off", "Never (manual)"],
  ["15m", "Every 15 min"],
  ["1h", "Every hour"],
  ["5h", "Every 5 hours"],
  ["morning", "Every morning"],
  ["night", "Every night"],
  ["morning_night", "Morning & night"],
];

function Priority({ owner }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [freq, setFreq] = useState("off");
  const [toCal, setToCal] = useState(true);
  const [mailAlerts, setMailAlerts] = useState(false);
  const [svc, setSvc] = useState(null); // live Google service status

  const load = () => api.listPriority().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
    api
      .me()
      .then((u) => {
        setFreq(u.priority_scan_freq || "off");
        setToCal(u.priority_to_calendar !== false);
        setMailAlerts(u.notify_new_mail === true);
      })
      .catch(() => {});
    api
      .getConnections()
      .then((c) => setSvc(c?.google?.services || null))
      .catch(() => {});
  }, []);

  const toggleCal = async () => {
    const next = !toCal;
    setToCal(next);
    await api.updateProfile({ priority_to_calendar: next }).catch(() => {});
  };

  const changeFreq = async (value) => {
    setFreq(value);
    // Send the device timezone so "morning/night" fires at the user's local time.
    await api
      .updateProfile({ priority_scan_freq: value, tz_offset_min: new Date().getTimezoneOffset() })
      .catch(() => {});
  };

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
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className="border-b border-white/15 px-4 md:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="font-semibold text-lg">{owner}'s Priority Inbox</div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={freq}
            onChange={(e) => changeFreq(e.target.value)}
            className="bg-black border border-white/30 px-2 py-1.5 text-xs focus:border-white outline-none"
            title="Auto-scan schedule"
          >
            {SCAN_FREQS.map(([v, label]) => (
              <option key={v} value={v}>
                Auto: {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={toggleCal}
            title="Add each new priority email to your Google Calendar with a reminder — Google Calendar then notifies you natively on your phone"
            className={`px-3 py-1.5 text-xs border whitespace-nowrap ${
              toCal
                ? "bg-white text-black border-white font-semibold"
                : "border-white/30 text-white/70 hover:border-white"
            }`}
          >
            {toCal ? "📅 → Calendar on" : "→ Calendar off"}
          </button>
          <button
            type="button"
            onClick={async () => {
              const next = !mailAlerts;
              setMailAlerts(next);
              setMsg(
                next
                  ? "Mail alerts armed — the first background check (within ~15 min) sets the baseline; every mail arriving after that gets a push."
                  : "Mail alerts off."
              );
              await api.updateProfile({ notify_new_mail: next }).catch(() => {});
            }}
            title="Get a push notification for EVERY new inbox email (checked at your scan frequency), not just priority ones"
            className={`px-3 py-1.5 text-xs border whitespace-nowrap ${
              mailAlerts
                ? "bg-white text-black border-white font-semibold"
                : "border-white/30 text-white/70 hover:border-white"
            }`}
          >
            {mailAlerts ? "📩 Mail alerts on" : "Mail alerts off"}
          </button>
          <button
            onClick={scan}
            disabled={busy}
            className="bg-white text-black px-4 py-1.5 text-sm font-semibold hover:bg-white/85 disabled:opacity-50 whitespace-nowrap"
          >
            {busy ? "Scanning…" : "Scan now"}
          </button>
        </div>
      </div>
      <div className="px-4 md:px-6 py-2 text-xs text-white/40 border-b border-white/10">
        Important mail — placements, interviews, deadlines — surfaced from your
        inbox. With “→ Calendar on”, each new one lands in your Google Calendar
        with a reminder, so the Google Calendar app notifies you natively. Still
        unread after 4 hours → we alert you again, louder.
        <span className="text-white/55">
          {" "}Tip: install the Google Calendar app &amp; allow its notifications.
        </span>
      </div>

      {/* Live plumbing check: the calendar bridge only works with these two ON. */}
      {svc && (!svc.gmail_read || (toCal && !svc.calendar)) && (
        <div className="mx-4 md:mx-6 mt-2 border border-amber-400/40 bg-amber-400/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
          <div className="flex-1">
            <span className="text-amber-300">
              ⚠ {!svc.gmail_read ? "Gmail isn't connected" : "Google Calendar isn't connected"}
            </span>{" "}
            <span className="text-white/60">
              {!svc.gmail_read
                ? "— I can't scan your inbox for priority mail until you connect it."
                : "— priority emails and reminders can't reach your phone's calendar notifications."}
            </span>
          </div>
          <button
            onClick={() => window.dispatchEvent(new Event("agentfury:connect-google"))}
            className="bg-white text-black px-4 py-1.5 text-sm font-semibold hover:bg-white/85 whitespace-nowrap"
          >
            Connect Google
          </button>
        </div>
      )}
      {svc && svc.gmail_read && svc.calendar && (
        <div className="mx-4 md:mx-6 mt-2 text-[11px] text-white/45">
          <span className="text-green-400">●</span> Gmail scan connected ·{" "}
          <span className="text-green-400">●</span> Calendar notifications connected
        </div>
      )}
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
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <Header title={`${owner}'s Brain`} />
      <div className="px-4 md:px-6 py-3 text-xs text-white/40 border-b border-white/10">
        Facts here (contacts, emails, preferences) are recalled automatically by
        the Assistant — so it doesn't have to keep asking.
      </div>
      <div className="px-4 md:px-6 py-4 flex gap-2 border-b border-white/10">
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
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-2">
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
    <div className="border-b border-white/15 px-4 md:px-6 py-4">
      <div className="font-semibold text-lg">{title}</div>
    </div>
  );
}

function Reminders() {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [alarm, setAlarm] = useState(false);

  const load = () => api.listReminders().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!title.trim()) return;
    await api.createReminder({ title: title.trim(), remind_at: when.trim(), alarm });
    setTitle("");
    setWhen("");
    setAlarm(false);
    load();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className="px-4 md:px-6 py-4 flex flex-wrap items-center gap-2 border-b border-white/10">
        <input
          className="flex-1 min-w-[160px] bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
          placeholder="Remind me to…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <input
          className="w-full sm:w-44 bg-black border border-white/30 px-3 py-2 focus:border-white outline-none"
          placeholder="when (e.g. today 9 PM)"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button
          type="button"
          onClick={() => setAlarm((a) => !a)}
          title="Alarm: sounds a loud alert you must dismiss"
          className={`px-3 py-2 text-sm border whitespace-nowrap ${
            alarm
              ? "bg-white text-black border-white font-semibold"
              : "border-white/30 text-white/70 hover:border-white"
          }`}
        >
          {alarm ? "⏰ Alarm on" : "Alarm off"}
        </button>
        <button onClick={add} className="bg-white text-black px-5 py-2 font-semibold hover:bg-white/85">
          Add
        </button>
        <div className="w-full text-[11px] text-white/35">
          Alarm rings fully (looping sound) while the app is open or the desktop app
          runs in the tray; when fully closed on a phone you get a single push
          notification instead.
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-2">
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
            <div className="flex-1 min-w-0">
              <div className={`break-words ${r.status === "done" ? "line-through text-white/40" : ""}`}>
                {r.alarm && <span title="Alarm">⏰ </span>}
                {r.title}
              </div>
              <div className="text-xs text-white/40">
                {r.remind_at}
                {r.due_at && (
                  <span className="text-white/60">
                    {" "}· due{" "}
                    {new Date(
                      r.due_at.endsWith("Z") ? r.due_at : r.due_at + "Z"
                    ).toLocaleString()}
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

function Notes() {
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
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className="px-4 md:px-6 py-4 border-b border-white/10 space-y-2">
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
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-3">
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
