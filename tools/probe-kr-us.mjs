/* [V33.505] ★한국과 미국 거래 성과가 왜 갈리나★ (사용자: "한국거래랑 미국거래랑 승률 수익률 차이나는 이유 분석해서 원인이랑 문제점 찾고 수정")
   운영 원장(/api/trades)을 시장별로 쪼갠다 — 읽기 전용. 사용법: node tools/probe-kr-us.mjs <url>
   ① 금액가중 vs 퍼센트(손실 쪽이 더 크게 샀나) ② 비용(원장 pnl 과 pct×원가의 차) ③ 진입·청산 시각대 ④ 장 시작 갭 손절 · 마감 청산
   ⑤ 손절선 넘는 손실 ⑥ 물타기(한 포지션 여러 번 매수) ⑦ 레버리지·인버스·ETF ⑧ 코스피/코스닥 ⑨ 진입 사유 안의 확률 p 구간 ⑩ 요일 */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage"); process.exit(2); }
const out = (k, v) => console.log("KU " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const get = async (p) => { const r = await fetch(BASE + p, { headers: { "cache-control": "no-cache" } }); if (!r.ok) throw new Error(p + " HTTP " + r.status); return r.json(); };
const trades = (await get("/api/trades?limit=5000")).slice().sort((a, b) => a.ts - b.ts);
let names = {};
try { const st = await get("/api/state"); for (const w of (st.watchlist || [])) names[w.symbol] = { n: w.name || "", etf: !!w.isEtf }; } catch (e) {}
const isSell = (t) => /sell/i.test(t.side);
out("sample_buy_reasons", trades.filter((t) => !isSell(t)).slice(-12).map((t) => t.market + " " + t.symbol + " " + String(t.reason).slice(0, 120)));
out("sample_sell_reasons", trades.filter(isSell).slice(-8).map((t) => t.market + " " + t.symbol + " " + String(t.reason).slice(0, 120) + " pct" + t.pnl_pct + " pnl" + t.pnl));
// 포지션 에피소드: 같은 시장·종목에서 보유수량이 0 → >0 → 0 이 되는 구간
const eps = []; const open = new Map();
for (const t of trades) {
  const k = t.market + "|" + t.symbol, q = +t.qty, px = +t.price;
  if (!isSell(t)) {
    const e = open.get(k) || { market: t.market, symbol: t.symbol, buys: [], sells: [], qty: 0, cost: 0, t0: t.ts };
    e.buys.push(t); e.qty += q; e.cost += q * px; open.set(k, e);
  } else {
    const e = open.get(k); if (!e) continue;
    e.sells.push(t); e.qty -= q;
    if (e.qty <= 1e-9) { e.t1 = t.ts; eps.push(e); open.delete(k); }
  }
}
const lt = (ts, mk) => { const off = mk === "kr" ? 9 : -4; const d = new Date(ts + off * 3600000); return { h: d.getUTCHours(), m: d.getUTCMinutes(), dow: d.getUTCDay() }; };
const P = eps.map((e) => {
  const pnl = e.sells.reduce((a, s) => a + (+s.pnl || 0), 0);
  const pctW = e.cost > 0 ? pnl / e.cost * 100 : null;                // 원장 pnl 기준 수익률(비용 포함)
  const lastPct = e.sells.length ? +e.sells[e.sells.length - 1].pnl_pct : null;
  const r0 = String(e.buys[0].reason || ""), pm = /p[=:\s]?(0\.\d+)/.exec(r0);
  const nm = (names[e.symbol] || {}).n || "";
  return { mk: e.market, sym: e.symbol, cost: e.cost, pnl, pctW, lastPct, nb: e.buys.length, ns: e.sells.length,
    holdH: (e.t1 - e.t0) / 3600000, ent: lt(e.t0, e.market), ex: lt(e.t1, e.market), entry: r0.replace(/\s.*$/, "").slice(0, 40) + " " + (r0.split(/\s+/)[1] || "").slice(0, 14),
    exit: String(e.sells[e.sells.length - 1].reason || "").split(/\s+/).slice(0, 2).join(" ").slice(0, 30), p: pm ? +pm[1] : null,
    lev: /레버리지|인버스|2X|3X|선물/i.test(nm) || /^(SQQQ|TQQQ|SOXL|SOXS|UVXY|SPXU|SPXL|TNA|TZA|LABU|LABD|NVDL|TSLL)$/.test(e.symbol), etf: !!(names[e.symbol] || {}).etf,
    board: /\.KQ$/.test(e.symbol) ? "KQ" : /\.KS$/.test(e.symbol) ? "KS" : "US", t1: e.t1 };
});
const agg = (A) => { if (!A.length) return { n: 0 }; const w = A.filter((x) => x.pnl > 0); const cost = A.reduce((a, x) => a + x.cost, 0), pnl = A.reduce((a, x) => a + x.pnl, 0);
  const gp = A.reduce((a, x) => a + Math.max(0, x.pnl), 0), gl = A.reduce((a, x) => a + Math.max(0, -x.pnl), 0);
  const avgP = A.filter((x) => x.pctW != null).reduce((a, x) => a + x.pctW, 0) / Math.max(1, A.filter((x) => x.pctW != null).length);
  return { n: A.length, win: +(w.length / A.length * 100).toFixed(1), avgPct: +avgP.toFixed(2), wPct: cost > 0 ? +(pnl / cost * 100).toFixed(3) : null, pf: gl > 0 ? +(gp / gl).toFixed(2) : null, pnl: Math.round(pnl) }; };
const grp = (A, f) => { const m = new Map(); for (const x of A) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return [...m].map(([k, v]) => [k, agg(v)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))); };
const fmt = (rows) => rows.map(([k, a]) => k + " n" + a.n + " win" + a.win + " avg" + a.avgPct + "% w" + a.wPct + "% pf" + a.pf + " Σ" + a.pnl);
for (const mk of ["us", "kr"]) {
  const A = P.filter((x) => x.mk === mk);
  out(mk + ".episodes", agg(A));
  // ① 금액 사분위
  const cs = A.map((x) => x.cost).sort((a, b) => a - b), q = (f) => cs[Math.floor(cs.length * f)] || 0;
  out(mk + ".by_size_quartile", fmt(grp(A, (x) => x.cost <= q(.25) ? "Q1" : x.cost <= q(.5) ? "Q2" : x.cost <= q(.75) ? "Q3" : "Q4")));
  // ② 비용: 원장 pnl 기준 % vs 마지막 매도 pnl_pct(단일 매도일 때)
  const one = A.filter((x) => x.ns === 1 && x.nb === 1 && x.lastPct != null && x.pctW != null);
  const dif = one.map((x) => x.lastPct - x.pctW); dif.sort((a, b) => a - b);
  out(mk + ".cost_gap_pct", { n: one.length, median: dif.length ? +dif[Math.floor(dif.length / 2)].toFixed(3) : null, mean: dif.length ? +(dif.reduce((a, b) => a + b, 0) / dif.length).toFixed(3) : null });
  // ③ 시각대
  const hb = (t) => mk === "kr" ? (t.h < 9 ? "pre" : t.h === 9 && t.m < 30 ? "09:00-09:30" : t.h < 11 ? "09:30-11" : t.h < 14 ? "11-14" : t.h < 15 || (t.h === 15 && t.m < 31) ? "14-15:30" : "after")
                                : (t.h < 9 || (t.h === 9 && t.m < 30) ? "pre" : t.h < 10 || (t.h === 10 && t.m < 0) ? "09:30-10" : t.h < 12 ? "10-12" : t.h < 15 ? "12-15" : t.h < 16 ? "15-16" : "after");
  out(mk + ".by_entry_time", fmt(grp(A, (x) => hb(x.ent))));
  out(mk + ".by_exit_time", fmt(grp(A, (x) => hb(x.ex))));
  out(mk + ".by_exit_reason", fmt(grp(A, (x) => x.exit)));
  out(mk + ".by_entry_reason", fmt(grp(A, (x) => x.entry)));
  out(mk + ".by_hold", fmt(grp(A, (x) => x.holdH < 1 ? "<1h" : x.holdH < 6.5 ? "<6.5h(당일)" : x.holdH < 24 ? "<1d" : x.holdH < 72 ? "1-3d" : x.holdH < 168 ? "3-7d" : "7d+")));
  out(mk + ".by_buys", fmt(grp(A, (x) => x.nb === 1 ? "buy1" : x.nb === 2 ? "buy2" : "buy3+")));
  out(mk + ".by_lev_etf", fmt(grp(A, (x) => x.lev ? "lev/inv" : x.etf ? "etf" : "stock")));
  out(mk + ".by_board", fmt(grp(A, (x) => x.board)));
  out(mk + ".by_p", fmt(grp(A.filter((x) => x.p != null), (x) => x.p < 0.5 ? "p<.50" : x.p < 0.55 ? ".50-.55" : x.p < 0.6 ? ".55-.60" : x.p < 0.7 ? ".60-.70" : "≥.70")));
  out(mk + ".by_dow", fmt(grp(A, (x) => ["일", "월", "화", "수", "목", "금", "토"][x.ent.dow])));
  out(mk + ".by_month", fmt(grp(A, (x) => new Date(x.t1).toISOString().slice(0, 7))));
  // ⑤ 큰 손실 상위
  out(mk + ".worst10", A.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 10).map((x) => x.sym + " " + (x.pctW != null ? x.pctW.toFixed(2) : "?") + "% Σ" + Math.round(x.pnl) + " cost" + Math.round(x.cost) + " buys" + x.nb + " " + x.entry + " → " + x.exit + " hold" + x.holdH.toFixed(0) + "h"));
}
