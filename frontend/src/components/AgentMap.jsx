import React from "react";

// The agent as a MAP rather than a chat log.
//
// A chat shows you what you asked. A map shows you what the agent is wired to:
// what it draws on (left), what it is doing with that (centre), and where the
// work comes out (right). The point is that you can look at it once and know
// what the thing actually does — which a scrolling transcript never tells you.
//
// It is drawn from live state, so it is a picture of your setup, not an
// illustration. A source that isn't connected is visibly not connected; an
// output with nothing in it says zero. Edges animate from source to core to
// output, which reads as flow without anyone having to explain the diagram.
//
// SVG for the edges, DOM for the nodes: curves are trivial in SVG and miserable
// in CSS, while the nodes want real text, hover and focus behaviour. The two are
// layered, with the SVG sized to the same box.

const Dot = ({ ok }) => (
  <span
    className="w-1.5 h-1.5 rounded-full shrink-0"
    style={{ background: ok ? "rgb(var(--c-accent))" : "rgb(var(--c-fg) / 0.22)" }}
  />
);

function Node({ title, meta, ok = true, onClick, className = "", delay = 0 }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={
        "af-enter group w-full text-left rounded-2xl border px-3.5 py-3 " +
        "transition-[transform,border-color,background-color] duration-200 " +
        (onClick ? "hover:-translate-y-[2px] hover:border-white/30 hover:bg-white/[0.05] " : "") +
        "border-white/12 bg-white/[0.03] backdrop-blur-sm " +
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 " +
        className
      }
    >
      <div className="flex items-center gap-2">
        <Dot ok={ok} />
        <span className="text-[12.5px] font-medium truncate">{title}</span>
      </div>
      {meta && <div className="mt-1 text-[11px] text-white/40 truncate pl-3.5">{meta}</div>}
    </button>
  );
}

export default function AgentMap({ sources, outputs, core, onNavigate }) {
  const wrapRef = React.useRef(null);
  const [edges, setEdges] = React.useState([]);

  // Edge geometry is measured from the laid-out DOM rather than hardcoded, so
  // the curves stay attached when the text wraps, the font differs, or the
  // window is resized. Recomputed on resize and whenever the data changes.
  const measure = React.useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const box = wrap.getBoundingClientRect();
    const core = wrap.querySelector("[data-core]");
    if (!core) return;
    const c = core.getBoundingClientRect();
    const next = [];

    wrap.querySelectorAll("[data-src]").forEach((el, i) => {
      const r = el.getBoundingClientRect();
      next.push({
        key: "s" + i,
        x1: r.right - box.left, y1: r.top + r.height / 2 - box.top,
        x2: c.left - box.left, y2: c.top + c.height / 2 - box.top,
        on: el.dataset.src === "on",
      });
    });
    wrap.querySelectorAll("[data-out]").forEach((el, i) => {
      const r = el.getBoundingClientRect();
      next.push({
        key: "o" + i,
        x1: c.right - box.left, y1: c.top + c.height / 2 - box.top,
        x2: r.left - box.left, y2: r.top + r.height / 2 - box.top,
        on: el.dataset.out === "on",
      });
    });
    setEdges(next);
  }, []);

  React.useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [measure, sources, outputs, core]);

  const curve = (e) => {
    const dx = Math.max(28, (e.x2 - e.x1) * 0.55);
    return `M ${e.x1} ${e.y1} C ${e.x1 + dx} ${e.y1}, ${e.x2 - dx} ${e.y2}, ${e.x2} ${e.y2}`;
  };

  return (
    <div ref={wrapRef} className="relative grid grid-cols-[1fr_auto_1fr] gap-4 md:gap-7 items-center">
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden
        style={{ zIndex: 0 }}
      >
        {edges.map((e) => (
          <g key={e.key}>
            <path
              d={curve(e)}
              fill="none"
              strokeWidth="1.25"
              stroke={e.on ? "rgb(var(--c-accent) / 0.42)" : "rgb(var(--c-fg) / 0.10)"}
            />
            {/* A travelling dash on live edges only — motion here means data
                actually moves along that path, so an idle edge stays still. */}
            {e.on && (
              <path
                d={curve(e)}
                fill="none"
                strokeWidth="1.6"
                stroke="rgb(var(--c-accent))"
                strokeDasharray="3 150"
                strokeLinecap="round"
                opacity="0.85"
              >
                <animate attributeName="stroke-dashoffset" from="153" to="0" dur="2.4s" repeatCount="indefinite" />
              </path>
            )}
          </g>
        ))}
      </svg>

      <div className="relative z-10 flex flex-col gap-2.5">
        {sources.map((s, i) => (
          <div key={s.title} data-src={s.ok ? "on" : "off"}>
            <Node {...s} delay={i * 60} />
          </div>
        ))}
      </div>

      {/* The core. Deliberately the only filled surface on the map, so the eye
          knows where the work happens before reading a word. */}
      <div
        data-core
        className="af-enter relative z-10 w-[168px] md:w-[196px] rounded-[22px] p-4 text-center af-sheen"
        style={{
          animationDelay: "120ms",
          background: "rgb(var(--c-accent) / 0.14)",
          border: "1px solid rgb(var(--c-accent) / 0.45)",
        }}
      >
        <div
          aria-hidden
          className="af-pulse absolute -inset-3 rounded-[26px] -z-10"
          style={{ background: "radial-gradient(circle, rgb(var(--c-glow-a) / 0.22), transparent 70%)" }}
        />
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">{core.eyebrow}</div>
        <div className="mt-1.5 text-[17px] font-semibold tracking-tight">{core.title}</div>
        <div className="mt-1 text-[11.5px] text-white/50 leading-snug">{core.meta}</div>
      </div>

      <div className="relative z-10 flex flex-col gap-2.5">
        {outputs.map((o, i) => (
          <div key={o.title} data-out={o.ok ? "on" : "off"}>
            <Node {...o} delay={180 + i * 60} onClick={o.view ? () => onNavigate?.(o.view) : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}
