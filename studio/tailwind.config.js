/** @type {import('tailwindcss').Config} */
// Scoped: every utility is prefixed by #brain-studio and Preflight is off, so the studio
// never restyles the rest of the trading site it is mounted into.
module.exports = {
  important: "#brain-studio",
  corePlugins: { preflight: false },
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "var(--bs-ink)", 2: "var(--bs-ink2)", 3: "var(--bs-ink3)" },
        bg: { DEFAULT: "var(--bs-bg)", 2: "var(--bs-bg2)", 3: "var(--bs-bg3)" },
        line: "var(--bs-line)",
        rose: "var(--bs-rose)",
        ok: "var(--bs-ok)",
        warn: "var(--bs-warn)",
        bad: "var(--bs-bad)",
        shade: "var(--bs-shade)",
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Apple SD Gothic Neo"', '"Noto Sans KR"', '"Malgun Gothic"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { sm: "3px", DEFAULT: "5px", md: "6px" },
    },
  },
  plugins: [],
};
