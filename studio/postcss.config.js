/* [V33.693] 스코프 풀기 — tailwind important ":is(#brain-studio,#bs-layer)" 를 빌드가 옛 브라우저용으로
   :-webkit-any · :-moz-any · :is 세 벌로 풀어 번들 CSS 가 3배였다(번들 상한 480KB 를 넘김). 여기서 미리
   "#brain-studio X, #bs-layer X" 두 벌로 펴 둔다 — :is 가 없으니 더 풀리지 않고, 어느 브라우저든 같은 규칙. */
const unscope = () => ({
  postcssPlugin: "bs-unscope",
  Rule(rule) {
    const P = ":is(#brain-studio,#bs-layer)";
    if (!rule.selector.includes(P)) return;
    const out = [];
    for (const s of rule.selectors) { if (s.includes(P)) { out.push(s.split(P).join("#brain-studio"), s.split(P).join("#bs-layer")); } else out.push(s); }
    rule.selectors = out;
  },
});
unscope.postcss = true;

export default {
  plugins: [
    (await import("tailwindcss")).default(),
    unscope(),
    (await import("autoprefixer")).default(),
  ],
}
