/* [V33.534] 크론 CPU 절감 계약 — 판단은 그대로, 비용만 줄인다.
 *   근거: tools/cron-cpu-bench.mjs(실제 워커 코드를 Node 에서 돌려 V8 CPU 프로파일). 워커 안의 Date.now 는 계산 중 멈춰
 *   단계 프로파일로는 CPU 를 못 본다. 운영 실측: 월 CPU 7.35일에 32.97% → 이대로면 19일께 85% 셧다운(전 사이클 정지).
 *   ① getStochSlow: 옛 구현(봉마다 slice)과 비트 단위로 같은 값 ② fetchBatchQuotes: 네이버 배치가 준 한국 종목을 단건으로 다시 부르지 않는다
 *   ③ 네이버가 못 준 한국 종목은 여전히 폴백한다(값 손실 없음) */
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };

function getMA(h, p) { if (!Array.isArray(h) || h.length < p) return null; let s = 0; for (let i = h.length - p; i < h.length; i++) s += h[i]; return s / p; }
const _num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
function oldStoch(highs, lows, closes, n, kSmooth, dSmooth) {
  n = n || 14; kSmooth = kSmooth || 3; dSmooth = dSmooth || 3;
  if (!Array.isArray(closes)) return null;
  const H = (Array.isArray(highs) && highs.length === closes.length) ? highs : closes;
  const L = (Array.isArray(lows) && lows.length === closes.length) ? lows : closes;
  if (closes.length < n + kSmooth + dSmooth) return null;
  const fastK = [];
  for (let i = n - 1; i < closes.length; i++) { let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) { const h = _num(H[j], closes[j]), l = _num(L[j], closes[j]); if (h > hi) hi = h; if (l < lo) lo = l; }
    fastK.push((hi > lo) ? ((closes[i] - lo) / (hi - lo)) * 100 : 50); }
  if (fastK.length < kSmooth + dSmooth) return null;
  const slowK = []; for (let i = kSmooth - 1; i < fastK.length; i++) slowK.push(getMA(fastK.slice(0, i + 1), kSmooth));
  if (slowK.length < dSmooth + 1) return null;
  const k = slowK[slowK.length - 1], kPrev = slowK[slowK.length - 2], d = getMA(slowK, dSmooth), dPrev = getMA(slowK.slice(0, slowK.length - 1), dSmooth);
  let cross = 0; if (d != null && dPrev != null) { if (kPrev <= dPrev && k > d) cross = 1; else if (kPrev >= dPrev && k < d) cross = -1; }
  return { k, d, kFast: fastK[fastK.length - 1], cross };
}
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let same = 0, tot = 0, bad = "";
for (let t = 0; t < 400; t++) {
  const N = [5, 18, 20, 21, 60, 320][t % 6], c = [], h = [], l = []; let p = 100;
  for (let i = 0; i < N; i++) { p *= 1 + (rnd() - 0.5) * 0.06; c.push(+p.toFixed(t % 3 ? 2 : 0)); h.push(p * (1 + rnd() * 0.02)); l.push(p * (1 - rnd() * 0.02)); }
  if (t % 7 === 0) for (let i = 0; i < N; i += 5) c[i] = c[Math.max(0, i - 1)];      // 평평한 구간(최고=최저)
  const args = [[h, l, c, 14, 3, 3], [h, l, c, 9, 3, 3], [null, null, c, 14, 5, 3], [h.slice(1), l, c, 14, 3, 3], [h, l, c, 5, 1, 1]][t % 5];
  const a = JSON.stringify(oldStoch(...args)), b = JSON.stringify(M.getStochSlow(...args));
  tot++; if (a === b) same++; else if (!bad) bad = a + " vs " + b;
}
chk(same === tot, "getStochSlow — 옛 구현과 비트 단위 동일(" + same + "/" + tot + ")", bad);

// ② ③ 네이버 배치가 가격을 준 종목은 단건 폴백을 타지 않는다 · 못 준 종목은 탄다
const realFetch = globalThis.fetch; const calls = [];
globalThis.fetch = async (u) => { const url = String(u); calls.push(url);
  if (url.includes("polling.finance.naver.com/api/realtime")) {
    const codes = /SERVICE_ITEM:([^&]+)/.exec(url)[1].split(",");
    return Response.json({ result: { areas: [{ datas: codes.filter((cd) => cd !== "000660").map((cd) => ({ cd, nv: 1000, sv: 990 })) }] } });
  }
  return new Response("x", { status: 404 }); };
try {
  const syms = ["005930.KS", "000660.KS", "035420.KS"];
  const out = await M.fetchBatchQuotes(syms, { maxFallback: 50 });
  const single = calls.filter((u) => /SERVICE_ITEM:[^,&]+$/.test(u) && u.includes("polling"));
  chk(out["005930.KS"] && out["005930.KS"].price === 1000 && out["035420.KS"], "배치가 준 한국 종목은 그 값 그대로");
  chk(!single.some((u) => /005930|035420/.test(u)), "배치가 준 종목을 단건으로 다시 부르지 않는다", single.join(" "));
  chk(single.some((u) => /000660/.test(u)), "배치가 못 준 종목(000660)은 단건 폴백을 탄다(값 손실 없음)", single.join(" "));
} finally { globalThis.fetch = realFetch; }

if (fails) { console.log("\n✗ 크론 CPU 절감 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 크론 CPU 절감 계약 통과");
