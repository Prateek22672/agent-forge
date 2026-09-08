import React from "react";
import { getPreference, setPreference, resolve, THEMES } from "../theme";

const ICONS = {
  system: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 20h8M12 17v3" strokeLinecap="round" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
        strokeLinecap="round" />
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z" strokeLinejoin="round" />
    </svg>
  ),
};

const LABEL = { system: "System", light: "Light", dark: "Dark" };

// A three-way segmented control rather than a two-way switch, because "follow my
// system" is a real preference — a plain toggle silently drops it the first time
// it's used, and the app then stops tracking the OS forever.
export default function ThemeToggle({ compact = false }) {
  const [pref, setPref] = React.useState(getPreference);

  React.useEffect(() => {
    const onChange = (e) => setPref(e.detail || getPreference());
    window.addEventListener("agentforge:theme", onChange);
    return () => window.removeEventListener("agentforge:theme", onChange);
  }, []);

  const choose = (p) => {
    setPreference(p);
    setPref(p);
  };

  if (compact) {
    // One button that advances through the three states — for tight toolbars.
    const next = THEMES[(THEMES.indexOf(pref) + 1) % THEMES.length];
    return (
      <button
        onClick={() => choose(next)}
        title={`Theme: ${LABEL[pref]}${pref === "system" ? ` (${resolve(pref)})` : ""} — click for ${LABEL[next]}`}
        aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[next]}.`}
        className="p-2 text-white/50 hover:text-white border border-white/15 hover:border-white/30 transition"
      >
        {ICONS[pref]}
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex gap-0.5 p-0.5 border border-white/15 rounded-full"
    >
      {THEMES.map((t) => (
        <button
          key={t}
          role="radio"
          aria-checked={pref === t}
          onClick={() => choose(t)}
          className={
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition " +
            (pref === t
              ? "bg-white text-black"
              : "text-white/50 hover:text-white/80")
          }
        >
          {ICONS[t]}
          {LABEL[t]}
        </button>
      ))}
    </div>
  );
}
