/** @type {import('tailwindcss').Config} */
//
// THEMING WITHOUT TOUCHING 600 CLASS NAMES
//
// The app is monochrome by design: "white" is the foreground and "black" is the
// ground, everywhere, in ~600 utility classes across every component. Rewriting
// each one into semantic tokens would be a huge, error-prone diff.
//
// So instead of changing the classes, we change what the two colours MEAN.
// Mapping white/black onto CSS variables makes every existing class — including
// every opacity variant like text-white/40 — resolve through the active theme.
// index.css defines the variables; flipping data-theme on <html> flips the app.
//
// The inversion is exactly right for a monochrome design: a white button with
// black text in dark mode becomes a dark button with white text in light mode,
// which is what a primary button should look like on a light ground.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        white: "rgb(var(--c-fg) / <alpha-value>)",
        black: "rgb(var(--c-bg) / <alpha-value>)",
        // Fixed monochrome, for the rare place that must stay literal
        // regardless of theme (overlays over media, brand marks).
        "pure-white": "#ffffff",
        "pure-black": "#000000",
        ink: "rgb(var(--c-bg) / <alpha-value>)",
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        edge: "rgb(var(--c-edge) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
