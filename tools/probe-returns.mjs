/* [V33.459] ★수익률이 왜 떨어지나★ — 운영 거래 원장을 읽어 구간·청산 종류·진입 전략·시장·보유 시간별로 쪼갠다(읽기 전용 GET).
 * 사용자: "수익률이 점점 떨어지는데 문제 찾아서 수정해". 샌드박스는 운영 주소에 못 닿아 CI 에서 돈다(ui-probe returns=true).
 * 원장 칸: ts · market · symbol · side · qty · price · pnl · pnl_pct · reason. 매도 행에만 pnl 이 있다.
 * 진입 전략은 매수 행 reason 에서 온다 — 같은 시장·종목의 매수를 먼저 들어온 순서(FIFO)로 매도에 짝짓는다.
 * 사용법: node tools/probe-returns.mjs <url> */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: node tools/probe-returns.mjs <url>"); process.exit(2); }
const out = (k, v) => console.log("RET " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const get = async (p) => { const r = await fetch(BASE + p, { headers: { "cache-control": "no-cache" } }); if (!r.ok) throw new Error(p + " HTTP " + r.status); return r.json(); };
const trades = (await get("/api/trades?limit=5000")).slice().sort((a, b) => a.ts - b.ts);
out("n", { trades: trades.length, from: trades.length ? new Date(trades[0].ts).toISOString() : null, to: trades.length ? new Date(trades[trades.length - 1].ts).toISOString() : null });
const tag = (r) => { const t = String(r || "").trim(), br = (t.match(/^(\[[^\]]+\])+/) || [""])[0], rest = t.slice(br.length).trim();
  const w = rest.split(/[\s(:,]/)[0].replace(/[+\-]?\d.*$/, ""); return (br + (w ? " " + w : "")) || "?"; };   // 매수: [AI][TREND] 신호 · 매도: [TREND] STOP
const isSell = (t) => /sell/i.test(t.side);
// FIFO 짝짓기: 매도마다 진입 전략·보유 시간
const book = new Map(), sells = [];
for (const t of trades) {
  const k = t.market + "|" + t.symbol;
  if (!isSell(t)) { (book.get(k) || book.set(k, []).get(k)).push({ ts: t.ts, qty: +t.qty, reason: t.reason }); continue; }
  const q = book.get(k) || []; let need = +t.qty, entry = null, first = null;
  while (need > 1e-9 && q.length) { const b = q[0]; if (!first) first = b; const u = Math.min(need, b.qty); b.qty -= u; need -= u; if (b.qty <= 1e-9) q.shift(); }
  entry = first;
  sells.push({ ts: t.ts, market: t.market, symbol: t.symbol, pnl: t.pnl == null ? null : +t.pnl, pct: t.pnl_pct == null ? null : +t.pnl_pct,
    exit: tag(t.reason), entry: entry ? tag(entry.reason) : "?", holdMin: entry ? Math.round((t.ts - entry.ts) / 60000) : null });
}
const S = sells.filter((s) => s.pct != null && isFinite(s.pct));
const agg = (arr) => {
  const n = arr.length; if (!n) return { n: 0 };
  const w = arr.filter((s) => s.pct > 0), l = arr.filter((s) => s.pct <= 0);
  const sp = arr.reduce((a, s) => a + (s.pnl || 0), 0);
  const gp = arr.reduce((a, s) => a + Math.max(0, s.pnl || 0), 0), gl = arr.reduce((a, s) => a + Math.max(0, -(s.pnl || 0)), 0);
  const avg = (xs) => xs.length ? +(xs.reduce((a, s) => a + s.pct, 0) / xs.length).toFixed(2) : null;
  const hm = arr.filter((s) => s.holdMin != null).map((s) => s.holdMin).sort((a, b) => a - b);
  return { n, win: +(w.length / n * 100).toFixed(1), avgPct: avg(arr), avgWin: avg(w), avgLoss: avg(l), pf: gl > 0 ? +(gp / gl).toFixed(2) : null,
    sumPnl: Math.round(sp), medHoldMin: hm.length ? hm[Math.floor(hm.length / 2)] : null };
};
const group = (arr, keyf) => { const m = new Map(); for (const s of arr) { const k = keyf(s); (m.get(k) || m.set(k, []).get(k)).push(s); } return m; };
const now = Date.now(), D = 86400000;
for (const mk of [...new Set(S.map((s) => s.market))]) {
  const A = S.filter((s) => s.market === mk);
  out(mk + ".all", agg(A));
  // 월별 · 주별 추세
  const byM = group(A, (s) => new Date(s.ts).toISOString().slice(0, 7));
  out(mk + ".monthly", [...byM].map(([k, v]) => [k, agg(v)]).map(([k, a]) => k + " n" + a.n + " win" + a.win + " avg" + a.avgPct + " pf" + a.pf + " Σ" + a.sumPnl));
  const byW = group(A.filter((s) => s.ts > now - 70 * D), (s) => { const d = new Date(s.ts); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); });
  out(mk + ".weekly", [...byW].map(([k, v]) => [k, agg(v)]).map(([k, a]) => k + " n" + a.n + " win" + a.win + " avg" + a.avgPct + " W" + a.avgWin + " L" + a.avgLoss + " pf" + a.pf + " Σ" + a.sumPnl + " hold" + a.medHoldMin));
  // 최근 30일 vs 그 전 30일 — 청산 종류 · 진입 전략
  const R = A.filter((s) => s.ts > now - 30 * D), P = A.filter((s) => s.ts <= now - 30 * D && s.ts > now - 60 * D);
  for (const [nm, kf] of [["exit", (s) => s.exit], ["entry", (s) => s.entry]]) {
    const gR = group(R, kf), gP = group(P, kf), keys = [...new Set([...gR.keys(), ...gP.keys()])];
    const rows = keys.map((k) => { const a = agg(gR.get(k) || []), b = agg(gP.get(k) || []); return { k, a, b }; }).sort((x, y) => (y.a.n + y.b.n) - (x.a.n + x.b.n)).slice(0, 18);
    out(mk + "." + nm + "_30d_vs_prev", rows.map((r) => r.k + " | 최근 n" + r.a.n + " win" + r.a.win + " avg" + r.a.avgPct + " Σ" + r.a.sumPnl + " | 이전 n" + r.b.n + " win" + r.b.win + " avg" + r.b.avgPct + " Σ" + r.b.sumPnl));
  }
  // 보유 시간 구간별
  const hb = (m) => m == null ? "?" : m < 30 ? "<30m" : m < 240 ? "<4h" : m < 1440 ? "<1d" : m < 7200 ? "<5d" : "5d+";
  const gH = group(A.filter((s) => s.ts > now - 60 * D), (s) => hb(s.holdMin));
  out(mk + ".hold_60d", [...gH].map(([k, v]) => [k, agg(v)]).map(([k, a]) => k + " n" + a.n + " win" + a.win + " avg" + a.avgPct + " Σ" + a.sumPnl));
  // 가장 많이 잃은 종목(60일)
  const gS = group(A.filter((s) => s.ts > now - 60 * D), (s) => s.symbol);
  out(mk + ".worst_symbols_60d", [...gS].map(([k, v]) => [k, agg(v)]).sort((x, y) => x[1].sumPnl - y[1].sumPnl).slice(0, 10).map(([k, a]) => k + " n" + a.n + " win" + a.win + " avg" + a.avgPct + " Σ" + a.sumPnl));
}
// 매매 빈도 추세(하루 매수 건수 · 최근 8주)
const buys = trades.filter((t) => !isSell(t));
const bw = group(buys.filter((t) => t.ts > now - 56 * D), (t) => t.market + " " + new Date(t.ts).toISOString().slice(0, 10).slice(0, 8) + "~");
out("buys_per_period", [...bw].map(([k, v]) => k + ":" + v.length));
// 현재 설정 중 위험·청산 관련
try {
  const st = await get("/api/state");
  const cfg = st.cfg || {}, pick = {};
  for (const k of Object.keys(cfg)) if (/stop|trail|tp|take|maxPos|risk|slot|budget|min(Prob|Score|Conf)|threshold|cooldown|hold/i.test(k) && typeof cfg[k] !== "object") pick[k] = cfg[k];
  out("cfg_risk", pick);
  out("positions", { us: ((st.positions || {}).us || {}).list ? st.positions.us.list.length : null, kr: ((st.positions || {}).kr || {}).list ? st.positions.kr.list.length : null });
  out("twr", st.twr || null);
} catch (e) { out("state_err", String(e)); }
// [V33.459] 실적 관문의 지금 판정(막힘 · 시험 · 열림)
try { const pgj = await get("/api/perf-gate?fresh=1"); out("perf_gate", Object.entries(pgj.keys || {}).map(([k, v]) => k + " " + v.mode + " n" + v.n + " avg" + v.mean + " pf" + v.pf + " win" + v.win)); }
catch (e) { out("perf_gate_err", String(e)); }
