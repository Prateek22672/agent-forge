/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0e14",
        panel: "#11151f",
        edge: "#1e2533",
        accent: "#6366f1",
      },
    },
  },
  plugins: [],
};
