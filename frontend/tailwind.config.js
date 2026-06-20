/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: {
          bg: "rgb(var(--panel-bg) / <alpha-value>)",
          header: "rgb(var(--panel-header) / <alpha-value>)",
          border: "rgb(var(--panel-border) / <alpha-value>)",
          text: "rgb(var(--panel-text) / <alpha-value>)",
          muted: "rgb(var(--panel-muted) / <alpha-value>)",
          accent: "rgb(var(--panel-accent) / <alpha-value>)",
          success: "rgb(var(--panel-success) / <alpha-value>)",
          warning: "rgb(var(--panel-warning) / <alpha-value>)",
          error: "rgb(var(--panel-error) / <alpha-value>)",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};
