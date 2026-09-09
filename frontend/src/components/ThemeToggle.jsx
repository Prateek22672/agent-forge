import React from "react";
import { getPreference, setPreference, resolve, THEMES } from "../theme";

// A swatch per theme, showing the theme's own colours rather than its name.
// Colour is the thing being chosen, so the swatch IS the label — a row of words
// makes you read six options to find the one you can already see.
const SWATCH = {
  system: ["#7b8194", "#c9cede"],
  light: ["#fafafc", "#0e1118"],
  dark: ["#0b0d13", "#818cf8"],
  purple: ["#f9f6fe", "#7c3aed"],
  pink: ["#fdf5f9", "#d6336c"],
  blue: ["#f3f8fd", "#1d4ed8"],
  yellow: ["#fefbf2", "#f59e0b"],
};
const LABEL = {
  system: "Match my system", light: "Light", dark: "Dark",
  purple: "Purple", pink: "Pink", blue: "Blue", yellow: "Yellow",
};

function Swatch({ name, active, onClick }) {
  const [bg, fg] = SWATCH[name] || SWATCH.light;
  return (
    <button
      role="radio"
      aria-checked={active}
      aria-label={LABEL[name]}
      title={LABEL[name]}
      onClick={onClick}
      className={
        "relative w-7 h-7 rounded-full overflow-hidden transition-transform duration-150 " +
        "hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 " +
        (active ? "ring-2 ring-white/70 ring-offset-2 ring-offset-black scale-105" : "ring-1 ring-white/20")
      }
      style={{ background: bg }}
    >
      {/* A diagonal half in the accent, so a swatch shows both the ground it
          produces and the colour that will do the highlighting. */}
      <span
        className="absolute inset-0"
        style={{ background: fg, clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
      />
    </button>
  );
}

export default function ThemeToggle({ compact = false }) {
  const [pref, setPref] = React.useState(getPreference);
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef(null);

  React.useEffect(() => {
    const onChange = (e) => setPref(e.detail || getPreference());
    window.addEventListener("agentforge:theme", onChange);
    return () => window.removeEventListener("agentforge:theme", onChange);
  }, []);

  // Click-away and Escape both close it — a picker that traps you is worse than
  // no picker.
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (p) => { setPreference(p); setPref(p); setOpen(false); };

  if (!compact) {
    return (
      <div role="radiogroup" aria-label="Colour theme" className="flex items-center gap-2 flex-wrap">
        {THEMES.map((t) => (
          <Swatch key={t} name={t} active={pref === t} onClick={() => choose(t)} />
        ))}
      </div>
    );
  }

  return (
    <div className="relative" ref={wrap}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title={`Theme: ${LABEL[pref]}`}
        aria-label={`Theme: ${LABEL[pref]}. Change theme.`}
        className="p-1.5 border border-white/15 hover:border-white/35 rounded-full transition flex items-center"
      >
        <span
          className="w-4 h-4 rounded-full relative overflow-hidden ring-1 ring-white/20"
          style={{ background: (SWATCH[pref] || SWATCH.light)[0] }}
        >
          <span
            className="absolute inset-0"
            style={{
              background: (SWATCH[pref] || SWATCH.light)[1],
              clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
            }}
          />
        </span>
      </button>

      {open && (
        <div
          role="radiogroup"
          aria-label="Colour theme"
          className="absolute right-0 top-full mt-2 z-50 p-3 rounded-2xl border border-white/15
                     bg-black shadow-2xl flex items-center gap-2"
        >
          {THEMES.map((t) => (
            <Swatch key={t} name={t} active={pref === t} onClick={() => choose(t)} />
          ))}
        </div>
      )}
    </div>
  );
}
