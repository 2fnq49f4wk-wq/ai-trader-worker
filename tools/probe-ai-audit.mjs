/* [V33.530] ★AI 수익률이 왜 낮은가 — 원장으로 끝까지 판다★ (읽기 전용 GET · CI 에서 돈다: ui-probe audit=true)
 * 사용자: "ai가 수익률이 왜 낮았는지 정확히 분석해서 문제점 전부 찾고 수정". 청산 반사실(probe-exits)·구간별(probe-returns)은
 * '어떻게 팔았나' 를 본다. 여기서는 ★무엇을 샀나★ 와 ★얼마나 투자돼 있었나★ 를 본다:
 *   ① 선별력: 매수마다 그 종목의 5·20일 뒤 수익 − 같은 기간 시장(SPY · KODEX200) — 청산과 무관한 '고른 실력'
 *      진입 전략(AI_PRIMARY·규칙·단타)별 · 시장별 평균 초과와 t. 0 이하면 고르는 것부터 틀렸다.
 *   ② 노출: 원장을 하루 단위로 되감아 평균 투자 비중 — 현금으로 놀면 시장이 올라도 수익이 없다
 *   ③ 시장 대비: 같은 기간 SPY·KODEX200 보유 수익 vs 실현 손익 합(자본 대비)
 *   ④ 비용: 매매 회전율 × (수수료+슬리피지+세금) 추정 — 손익 중 비용이 먹은 몫
 * 사용법: node tools/probe-ai-audit.mjs <url> */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: node tools/probe-ai-audit.mjs <url>"); process.exit(2); }
const out = (k, v) => console.log("AUD " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const get = async (p) => { const r = await fetch(BASE + p); if (!r.ok) throw new Error(p + " HTTP " + r.status); return r.json(); };
const D = 86400000;
const CAP = { us: 100000, kr: 100000000 };
const BENCH = { us: "SPY", kr: "069500.KS" };
const COST = { us: 0.0005 * 2 + 0.0005, kr: 0.00015 * 2 + 0.002 + 0.001 };   // 왕복 수수료+슬리피지(+한국 매도세) 대략

const trades = (await get("/api/trades?limit=100000")).slice().sort((a, b) => a.ts - b.ts);
const isSell = (t) => /sell/i.test(t.side);
const tag = (r) => { const t = String(r || "").trim(), br = (t.match(/^(\[[^\]]+\])+/) || [""])[0], rest = t.slice(br.length).trim();
  const w = rest.split(/[\s(:,]/)[0].replace(/[+\-]?\d.*$/, ""); return (br + (w ? " " + w : "")) || "?"; };
out("n", { trades: trades.length, from: trades[0] && new Date(trades[0].ts).toISOString(), to: trades.length && new Date(trades[trades.length - 1].ts).toISOString() });

// ── 일봉 캐시 ──
const daily = new Map();
async function bars(sym) {
  if (daily.has(sym)) return daily.get(sym);
  let c = null;
  try {
    const j = await get("/api/chart?symbol=" + encodeURIComponent(sym) + "&interval=1d&range=1y");
    const cs = (j.candles || []).filter((x) => x && x.c > 0).map((x) => ({ t: x.t < 1e12 ? x.t * 1000 : x.t, c: +x.c }));
    c = cs.length > 30 ? cs : null;
  } catch (e) { c = null; }
  daily.set(sym, c);
  return c;
}
const idxAt = (cs, ts) => { let lo = 0, hi = cs.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].t <= ts) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
const fwdRet = (cs, ts, h) => { const i = idxAt(cs, ts); if (i < 0 || i + h >= cs.length) return null; return cs[i + h].c / cs[i].c - 1; };

// ① 선별력
const buys = trades.filter((t) => !isSell(t));
const syms = [...new Set(buys.map((t) => t.symbol))];
out("buys", { n: buys.length, symbols: syms.length });
for (const m of ["us", "kr"]) await bars(BENCH[m]);
const pool = 6;
for (let i = 0; i < syms.length; i += pool) await Promise.all(syms.slice(i, i + pool).map(bars));
const sel = [];
for (const b of buys) {
  const m = b.market === "kr" ? "kr" : (b.market === "us" ? "us" : null);
  if (!m) continue;
  const cs = daily.get(b.symbol), bc = daily.get(BENCH[m]);
  if (!cs || !bc) continue;
  const row = { m, entry: tag(b.reason), ts: b.ts };
  for (const h of [5, 20]) {
    const r = fwdRet(cs, b.ts, h), rb = fwdRet(bc, b.ts, h);
    row["x" + h] = (r == null || rb == null) ? null : (r - rb) * 100;
    row["r" + h] = r == null ? null : r * 100;
  }
  sel.push(row);
}
const stat = (xs) => { const v = xs.filter((x) => x != null && isFinite(x)); const n = v.length; if (n < 3) return { n };
  const mu = v.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1));
  return { n, mean: +mu.toFixed(2), t: +(mu / (sd / Math.sqrt(n))).toFixed(2), hit: +(v.filter((x) => x > 0).length / n * 100).toFixed(0) }; };
// [추격 가설] 진입 직전 1일·5일 상승폭으로 3등분 → 다음 5·20일 시장 초과. 급등 직후 매수가 손해인지 우리 원장으로 잰다.
const prior = (cs, ts, h) => { const i = idxAt(cs, ts); if (i - h < 0) return null; return (cs[i].c / cs[i - h].c - 1) * 100; };
for (const s of sel) {
  const b = buys.find((x) => x.ts === s.ts);
  const cs = b && daily.get(b.symbol);
  s.p1 = cs ? prior(cs, s.ts, 1) : null; s.p5 = cs ? prior(cs, s.ts, 5) : null;
}
for (const m of ["us", "kr"]) {
  for (const pk of ["p1", "p5"]) {
    const A = sel.filter((s) => s.m === m && s[pk] != null).sort((a, b) => a[pk] - b[pk]);
    if (A.length < 30) continue;
    const t3 = [A.slice(0, Math.floor(A.length / 3)), A.slice(Math.floor(A.length / 3), Math.floor(2 * A.length / 3)), A.slice(Math.floor(2 * A.length / 3))];
    out(m + ".chase_" + pk, t3.map((g, i) => ["하", "중", "상"][i] + "(" + g[0][pk].toFixed(1) + "~" + g[g.length - 1][pk].toFixed(1) + "%) x5 " + JSON.stringify(stat(g.map((s) => s.x5))) + " x20 " + JSON.stringify(stat(g.map((s) => s.x20)))));
  }
}
for (const m of ["us", "kr"]) {
  const A = sel.filter((s) => s.m === m);
  out(m + ".select_all", { x5: stat(A.map((s) => s.x5)), x20: stat(A.map((s) => s.x20)), raw20: stat(A.map((s) => s.r20)) });
  const by = new Map(); for (const s of A) (by.get(s.entry) || by.set(s.entry, []).get(s.entry)).push(s);
  out(m + ".select_by_entry", [...by.entries()].filter(([, v]) => v.length >= 5).sort((a, b) => b[1].length - a[1].length)
    .map(([k, v]) => k + " | x5 " + JSON.stringify(stat(v.map((s) => s.x5))) + " | x20 " + JSON.stringify(stat(v.map((s) => s.x20)))));
  // 시기별(월) 선별 초과 — 실력이 사라진 시점
  const bm = new Map(); for (const s of A) { const k = new Date(s.ts).toISOString().slice(0, 7); (bm.get(k) || bm.set(k, []).get(k)).push(s); }
  out(m + ".select_by_month", [...bm.entries()].sort().map(([k, v]) => k + " x20 " + JSON.stringify(stat(v.map((s) => s.x20)))));
}

// ② 노출 · ③ 시장 대비 · ④ 비용
for (const m of ["us", "kr"]) {
  const T = trades.filter((t) => t.market === m);
  if (!T.length) continue;
  const t0 = T[0].ts, t1 = Math.max(T[T.length - 1].ts, Date.now() - D);
  const hold = new Map(); let invested = [], notional = 0, realized = 0;
  let k = 0;
  for (let d = t0; d <= t1; d += D) {
    while (k < T.length && T[k].ts <= d) {
      const t = T[k++], key = t.symbol, q = +t.qty, px = +t.price;
      notional += q * px;
      const h = hold.get(key) || { q: 0, cost: 0 };
      if (isSell(t)) { const f = h.q > 0 ? Math.min(1, q / h.q) : 1; h.cost *= (1 - f); h.q = Math.max(0, h.q - q); realized += (+t.pnl || 0); }
      else { h.q += q; h.cost += q * px; }
      hold.set(key, h);
    }
    let inv = 0; for (const h of hold.values()) inv += h.cost;
    invested.push(inv / CAP[m]);
  }
  const avgExp = invested.reduce((a, b) => a + b, 0) / Math.max(1, invested.length);
  const days = Math.round((t1 - t0) / D);
  const bc = daily.get(BENCH[m]);
  let benchRet = null;
  if (bc) { const i0 = idxAt(bc, t0), i1 = idxAt(bc, t1); if (i0 >= 0 && i1 > i0) benchRet = (bc[i1].c / bc[i0].c - 1) * 100; }
  const turnover = notional / CAP[m];
  out(m + ".exposure_vs_market", { days, avgInvestedPct: +(avgExp * 100).toFixed(1), realizedPctOfCap: +(realized / CAP[m] * 100).toFixed(2),
    benchHoldPct: benchRet == null ? null : +benchRet.toFixed(2), benchAtOurExposurePct: benchRet == null ? null : +(benchRet * avgExp).toFixed(2),
    turnoverX: +turnover.toFixed(1), estCostPctOfCap: +(turnover / 2 * COST[m] * 100).toFixed(2) });
}

// ⑤ 지금 설정 — 전략·단타·자동차단(무엇이 이미 막혀 있나)
try {
  const c = await get("/api/cfg");
  const pick = (o, ks) => { const r = {}; for (const k of ks) if (o && o[k] !== undefined) r[k] = o[k]; return r; };
  out("cfg.strategies", pick(c, ["strategies", "strategiesByMarket", "scalp", "aiScalp", "aiPrimary", "disabledSignals", "maxPositions", "maxPositionsByMarket", "positionPct", "riskPerTrade", "feeUS", "feeKR", "slipUS", "slipKR", "stopLoss", "takeProfit1", "takeProfit2", "minHoldMin", "reentryCooldownMin"]));
  out("cfg.keys", Object.keys(c || {}).slice(0, 200));
} catch (e) { out("cfg_fail", String(e)); }
try {
  const p = await get("/api/pipeline");
  out("pipeline", JSON.stringify(p).slice(0, 1500));
} catch (e) { out("pipeline_fail", String(e)); }

// ⑥ 왜 안 사나 — 엔진 자신의 심사 기록(최근 1,200줄)
try {
  const L = await get("/api/logs?limit=1200");
  const pat = /심사완료|NOBUY|\[EVAL\]|AI_PRIMARY|NEGEXP|PERF-GATE|perf_gate|차단|ai_primary_gate|MAXPOS|CRASH|EQ-CURVE|equityCurve/i;
  const seen = new Map();
  for (const l of L) { const m = String(l.message || l.msg || ""); if (!pat.test(m)) continue;
    const k = m.replace(/\d+(\.\d+)?/g, "#").slice(0, 140); const e = seen.get(k) || { n: 0, ex: m.slice(0, 400), ts: l.ts }; e.n++; seen.set(k, e); }
  out("why_nobuy", [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 25).map((e) => e.n + "× " + new Date(e.ts).toISOString().slice(5, 16) + " " + e.ex));
} catch (e) { out("logs_fail", String(e)); }
