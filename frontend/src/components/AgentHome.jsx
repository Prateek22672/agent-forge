import React from "react";
import { api } from "../api";

// The home surface.
//
// Layout follows the shape assistant apps have converged on — ambient ground,
// one large line of type, a short row of cards — because it works: the eye
// lands on the greeting, reads a sentence, and finds the cards already in
// peripheral vision. What is NOT borrowed is the content. Those apps fill their
// cards with entry points ("Write a first draft", "Create an image"). These
// carry state: what is waiting, what is due, what got handled while you were
// away.
//
// Two rules decide whether anything renders at all:
//   1. Every card states something true right now AND does something when
//      clicked. A card that could have been printed before the app loaded is a
//      poster, not an interface.
//   2. Anything with nothing to report does not render. A grid of zeroes is
//      exactly what made the old five-tab layout feel dead.

const Sparkle = ({ className = "" }) => (
  <svg viewBox="0 0 24 24" className={className} width="13" height="13" aria-hidden fill="currentColor">
    <path d="M12 2.6l1.7 5.1a4 4 0 0 0 2.6 2.6l5.1 1.7-5.1 1.7a4 4 0 0 0-2.6 2.6L12 21.4l-1.7-5.1a4 4 0 0 0-2.6-2.6L2.6 12l5.1-1.7a4 4 0 0 0 2.6-2.6L12 2.6z" />
  </svg>
);

const useLive = () => {
  const [s, setS] = React.useState({ loading: true, priority: [], reminders: [], activity: [] });
  const load = React.useCallback(async () => {
    const [pri, rem, act] = await Promise.allSettled([
      api.listPriority(),
      api.listReminders(),
      api.autopilotActivity(),
    ]);
    const val = (r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []);
    setS({
      loading: false,
      priority: val(pri).filter((p) => !p.done && !p.handled),
      reminders: val(rem).filter((r) => !r.done && r.status !== "done"),
      activity: val(act).slice(0, 3),
    });
  }, []);
  React.useEffect(() => {
    load();
    const on = () => load();
    window.addEventListener("agentforge:refresh", on);
    return () => window.removeEventListener("agentforge:refresh", on);
  }, [load]);
  return s;
};

const dueMs = (r) => {
  const raw = r.due_at || r.dueAt;
  if (!raw) return 0;
  return new Date(String(raw).endsWith("Z") ? raw : raw + "Z").getTime();
};
const fmtDue = (ms) => {
  if (!ms) return "";
  const d = ms - Date.now();
  if (d < 0) return "overdue";
  const m = Math.round(d / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `in ${h}h` : new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function Card({ children, onClick, emphasis = false, className = "", delay = 0 }) {
  return (
    <button
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={
        "af-enter af-sheen group relative text-left w-full rounded-[20px] border p-4 " +
        "transition-[transform,border-color,background-color,box-shadow] duration-200 ease-out " +
        "hover:-translate-y-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 " +
        (emphasis
          ? "border-white/22 bg-white/[0.06] hover:border-white/40 hover:shadow-[0_10px_36px_-14px_rgb(var(--c-glow-a)/0.5)]"
          : "border-white/10 bg-white/[0.022] hover:border-white/24 hover:bg-white/[0.045]") +
        " " + className
      }
    >
      {children}
      <span
        aria-hidden
        className="absolute right-5 top-5 text-white/20 group-hover:text-white/60
                   transition-transform duration-200 group-hover:translate-x-0.5"
      >
        →
      </span>
    </button>
  );
}

/* Small round glyph holder, the way every card in the references opens. */
const Badge = ({ children, live = false }) => (
  <span className="relative inline-flex items-center justify-center w-8 h-8 rounded-full mb-3.5
                   bg-white/[0.07] text-white/70">
    {live && (
      <span
        aria-hidden
        className="af-pulse absolute inset-0 rounded-full"
        style={{ background: "rgb(var(--c-glow-a) / 0.30)" }}
      />
    )}
    <span className="relative">{children}</span>
  </span>
);

const Eyebrow = ({ children }) => (
  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35 mb-1.5">
    {children}
  </div>
);

export default function AgentHome({ activeAgentName, starters = [], onPickStarter, onNavigate, userName }) {
  const live = useLive();

  const greeting = React.useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }, []);

  const urgent = live.priority.length;
  const soon = live.reminders
    .map((r) => ({ r, t: dueMs(r) }))
    .filter((x) => x.t && x.t - Date.now() < 36 * 60 * 60 * 1000)
    .sort((a, b) => a.t - b.t);

  const briefing = live.loading
    ? "Catching up…"
    : urgent
      ? urgent === 1
        ? "One message looks like it needs a reply."
        : `${urgent} messages look like they need a reply.`
      : soon.length
        ? soon.length === 1
          ? "One thing coming up."
          : `${soon.length} things coming up.`
        : "Nothing needs you right now.";

  const hasCards = urgent > 0 || soon.length > 0 || live.activity.length > 0;

  return (
    <div className="relative flex-1 overflow-y-auto">
      {/* Ambient ground, painted from the theme's own glow tokens so it shifts
          with the palette instead of being one purple wash bolted on. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{
          background:
            "radial-gradient(68% 52% at 50% -10%, rgb(var(--c-glow-a) / 0.22), transparent 70%)," +
            "radial-gradient(46% 38% at 84% 2%, rgb(var(--c-glow-b) / 0.14), transparent 72%)",
        }}
      />

      <div className="relative max-w-3xl mx-auto px-6 pt-10 pb-8">
        <header className="af-enter mb-7 text-center">
          <h1 className="text-[30px] md:text-[38px] font-semibold tracking-[-0.032em] leading-[1.05] text-balance">
            {greeting}
            {userName ? <>, {userName}</> : ""}.
          </h1>
          <p className="mt-2.5 text-[15px] text-white/45">{briefing}</p>
        </header>

        {/* Prompts, as the references do them: gradient-edged, sparkle-marked,
            arriving in sequence. These are the agent offering to act, so they
            should read as the agent speaking — not as a list of links. */}
        {starters.length > 0 && (
          <section className="mb-7">
            <div className="grid gap-2.5">
              {starters.map((s, i) => (
                <button
                  key={s}
                  onClick={() => onPickStarter?.(s)}
                  style={{ animationDelay: `${90 + i * 70}ms` }}
                  className="af-enter af-sheen af-edge group flex items-center gap-3 text-left rounded-2xl
                             px-4 py-3 text-[13.5px] text-white/80
                             transition-[transform,color] duration-200 ease-out
                             hover:-translate-y-[2px] hover:text-white
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <span
                    className="shrink-0 grid place-items-center w-6 h-6 rounded-lg"
                    style={{
                      background:
                        "linear-gradient(135deg, rgb(var(--c-glow-a) / .30), rgb(var(--c-glow-b) / .22))",
                      color: "rgb(var(--c-accent))",
                    }}
                  >
                    <Sparkle />
                  </span>
                  <span className="flex-1">{s}</span>
                  <span
                    aria-hidden
                    className="text-white/15 group-hover:text-white/45 transition shrink-0 text-xs"
                  >
                    ↵
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {hasCards && (
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {urgent > 0 && (
              <Card emphasis delay={260} onClick={() => onNavigate?.("priority")}>
                <Badge live>✉</Badge>
                <Eyebrow>Needs a reply</Eyebrow>
                <div className="flex items-baseline gap-2">
                  <span className="text-[32px] font-semibold tabular-nums leading-none tracking-tight">
                    {urgent}
                  </span>
                  <span className="text-white/40 text-sm">waiting</span>
                </div>
                <p className="mt-3 text-[12.5px] text-white/55 truncate pr-6">
                  {live.priority[0]?.subject || live.priority[0]?.title || "Open to review"}
                </p>
              </Card>
            )}

            {soon.length > 0 && (
              <Card delay={330} onClick={() => onNavigate?.("planner")}>
                <Badge>◷</Badge>
                <Eyebrow>Coming up</Eyebrow>
                <div className="flex items-baseline gap-2">
                  <span className="text-[32px] font-semibold tabular-nums leading-none tracking-tight">
                    {soon.length}
                  </span>
                  <span className="text-white/40 text-sm">scheduled</span>
                </div>
                <p className="mt-3 text-[12.5px] text-white/55 truncate pr-6">
                  {soon[0].r.title || soon[0].r.text}
                  <span className="text-white/30"> · {fmtDue(soon[0].t)}</span>
                </p>
              </Card>
            )}

            {live.activity.length > 0 && (
              <Card delay={400} onClick={() => onNavigate?.("autopilot")} className="sm:col-span-2">
                <div className="flex items-center gap-2 mb-1.5">
                  <span style={{ color: "rgb(var(--c-accent))" }}><Sparkle /></span>
                  <Eyebrow>Handled while you were away</Eyebrow>
                </div>
                <ul className="space-y-2 pr-6">
                  {live.activity.map((a, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-white/60">
                      <span className="mt-[7px] w-1 h-1 rounded-full bg-white/35 shrink-0" />
                      <span className="truncate">{a.summary || a.action || a.text}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
