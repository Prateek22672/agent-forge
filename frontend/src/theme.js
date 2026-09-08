// Theme state, kept in one place so every surface agrees.
//
// Three states, not two: "dark", "light", and "system" — which follows the OS
// and keeps following it when the OS changes. Storing the literal choice (rather
// than the resolved colour) is what makes "system" keep working; storing
// "light" because the OS happened to be light at the time would silently freeze
// it there.
const KEY = "agentforge_theme";

export const THEMES = ["system", "light", "dark"];

const media = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;

export function getPreference() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : "system";
  } catch {
    return "system"; // private windows / blocked storage
  }
}

export function resolve(pref = getPreference()) {
  if (pref === "light" || pref === "dark") return pref;
  const m = media();
  return m && m.matches ? "light" : "dark";
}

// Stamp the resolved theme on <html>; the CSS variables key off this attribute.
export function apply(pref = getPreference()) {
  const resolved = resolve(pref);
  try {
    document.documentElement.setAttribute("data-theme", resolved);
  } catch {}
  return resolved;
}

export function setPreference(pref) {
  const next = THEMES.includes(pref) ? pref : "system";
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  apply(next);
  try {
    window.dispatchEvent(new CustomEvent("agentforge:theme", { detail: next }));
  } catch {}
  return next;
}

// Follow the OS while the preference is "system". Returns an unsubscribe fn.
export function watchSystem() {
  const m = media();
  if (!m) return () => {};
  const onChange = () => {
    if (getPreference() === "system") apply("system");
  };
  // Safari < 14 only has the deprecated listener API.
  if (m.addEventListener) m.addEventListener("change", onChange);
  else m.addListener(onChange);
  return () => {
    if (m.removeEventListener) m.removeEventListener("change", onChange);
    else m.removeListener(onChange);
  };
}

// Call before React renders so the first paint is already the right theme —
// otherwise the app flashes dark on a light desktop.
export function initTheme() {
  apply();
  return watchSystem();
}

// React hook: the theme actually in effect ("light" | "dark"), re-rendering when
// the user switches OR when the OS changes while the preference is "system".
// Components that paint their own pixels — canvas, WebGL — need this, because
// CSS variables can't reach inside them.
import { useEffect, useState } from "react";

export function useResolvedTheme() {
  const [theme, setTheme] = useState(() => resolve());
  useEffect(() => {
    const update = () => setTheme(resolve());
    window.addEventListener("agentforge:theme", update);
    const m = media();
    if (m) {
      if (m.addEventListener) m.addEventListener("change", update);
      else m.addListener(update);
    }
    update();
    return () => {
      window.removeEventListener("agentforge:theme", update);
      if (m) {
        if (m.removeEventListener) m.removeEventListener("change", update);
        else m.removeListener(update);
      }
    };
  }, []);
  return theme;
}
