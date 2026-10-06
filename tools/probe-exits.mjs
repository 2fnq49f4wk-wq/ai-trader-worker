/* [V33.487] ★청산 반사실 — 판 뒤에 그 종목은 어떻게 됐나★ (수익률 개선의 근거를 원장에서 직접 잰다)
   원장: 5일+ 보유는 벌고 짧은 보유는 잃는다. 그런데 보유 시간은 결과와 엉켜 있다(이긴 건 트레일로 오래 들고, 진 건 손절).
   그래서 묻는다: 청산 사유별로, 판 뒤 5·10·20 거래일 그 종목의 수익(원값 · 시장 대비 초과)은?
     · 판 뒤에도 오르면(초과 > 0, t 큼) → 그 청산은 너무 일찍 판다(예: TIME-STOP 4일이 짧다)
     · 판 뒤에 내리면 → 그 청산은 제 몫을 한다
   시장 대비: 미국 SPY · 한국 069500.KS 의 같은 날짜 구간 수익을 뺀다. 일봉은 워커 R2(OMNI 수집) — 학습키로 읽는다. */
const BASE = (process.argv[2] || process.env.URL || "").replace(/\/$/, "");
const KEY = process.env.TRAIN_KEY || "";
const get = async (p, key) => { const r = await fetch(BASE + p, { headers: Object.assign({ "cache-control": "no-cache" }, key ? { "X-Train-Key": KEY } : {}) }); if (!r.ok) throw new Error(p + " HTTP " + r.status); return r.json(); };
const trades = (await get("/api/trades?limit=5000")).slice().sort((a, b) => a.ts - b.ts);
const sells = trades.filter((t) => /sell/i.test(t.side) && t.price > 0 && t.symbol);
const tagOf = (r) => { const m = String(r || "").match(/^\[([A-Z-]+)\]\s*([A-Z_>-]+)/); return m ? m[1] + " " + m[2] : "?"; };
const syms = [...new Set(sells.map((t) => t.symbol))];
const bench = { us: "SPY", kr: "069500.KS" };
const need = [...new Set(syms.concat(Object.values(bench)))];
const bars = {};
for (let i = 0; i < need.length; i += 25) {
  try { const j = await get("/api/omni-bars?res=1d&s=" + encodeURIComponent(need.slice(i, i + 25).join(",")), true); Object.assign(bars, j.bars || {}); }
  catch (e) { console.log("EXIT bars_err " + String(e.message || e).slice(0, 80)); }
}
const tms = (b) => (b.t || []).map((x) => (x > 1e12 ? x : x * 1000));
const idxAt = (T, ts) => { let lo = 0, hi = T.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] <= ts) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
const H = [5, 10, 20];
const groups = {};
let used = 0, noBars = 0;
for (const t of sells) {
  const b = bars[t.symbol], mk = t.market === "kr" ? "kr" : (t.market === "us" ? "us" : null);
  if (!mk) continue;
  if (!b || !b.c || !b.t) { noBars++; continue; }
  const T = tms(b), i = idxAt(T, t.ts);
  if (i < 0) { noBars++; continue; }
  const bb = bars[bench[mk]], BT = bb ? tms(bb) : null, bi = BT ? idxAt(BT, t.ts) : -1;
  const g = groups[mk + " " + tagOf(t.reason)] || (groups[mk + " " + tagOf(t.reason)] = { n: 0, pnl: [], f: { 5: [], 10: [], 20: [] }, x: { 5: [], 10: [], 20: [] } });
  g.n++; g.pnl.push(+t.pnl_pct || 0); used++;
  for (const h of H) {
    if (i + h >= b.c.length || !(b.c[i] > 0) || !(b.c[i + h] > 0)) continue;
    const r = (b.c[i + h] / b.c[i] - 1) * 100;
    g.f[h].push(r);
    if (bi >= 0 && bi + h < bb.c.length && bb.c[bi] > 0) g.x[h].push(r - (bb.c[bi + h] / bb.c[bi] - 1) * 100);
  }
}
const st = (a) => { const n = a.length; if (n < 2) return { n, m: n ? a[0] : null, t: null }; const m = a.reduce((s, v) => s + v, 0) / n; const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)); return { n, m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : null }; };
const f2 = (v) => (v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2));
console.log("EXIT 표본 매도 " + sells.length + " · 분석 " + used + " · 일봉없음 " + noBars + " · 기간 " + new Date(sells[0].ts).toISOString().slice(0, 10) + "~" + new Date(sells[sells.length - 1].ts).toISOString().slice(0, 10));
for (const [k, g] of Object.entries(groups).sort((a, b) => b[1].n - a[1].n)) {
  if (g.n < 5) continue;
  const p = st(g.pnl);
  const parts = H.map((h) => { const a = st(g.f[h]), x = st(g.x[h]); return h + "일 원 " + f2(a.m) + " · 초과 " + f2(x.m) + "(t " + (x.t == null ? "—" : x.t.toFixed(1)) + ", n" + x.n + ")"; });
  console.log("EXIT " + k + " n" + g.n + " 실현 " + f2(p.m) + "% | " + parts.join(" | "));
}
