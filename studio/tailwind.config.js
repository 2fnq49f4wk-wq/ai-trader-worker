/** @type {import('tailwindcss').Config} */
// Scoped: every utility is prefixed by #brain-studio (or #bs-layer — the body-level layer the full-screen
// view is portalled into) and Preflight is off, so the studio never restyles the rest of the trading site.
module.exports = {
  important: ":is(#brain-studio,#bs-layer)",
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
        // [V33.693] 노드 신상서(두뇌관측 v3) 보라 판 — 클래스를 짧게(번들 상한)
        dz: { 1: "#b9a6c9", 2: "#d2c1df", 3: "#f1e6f7", 4: "#d9c6e6", 5: "#f7eefb", c: "#c4a0ff", p: "#ffcfb6" },
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
