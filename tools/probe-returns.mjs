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
  // [V33.464] 손절선 넘는 손실(90일) — 갭(장 시작 직후 청산)인가 장중인가. 시각은 한국=KST · 그 밖=UTC
  const tz = mk === "kr" ? 9 : 0, hm = (ts) => new Date(ts + tz * 3600000).toISOString().slice(5, 16).replace("T", " ");
  const B = A.filter((s) => s.ts > now - 90 * D && s.pct < -5.3);
  out(mk + ".beyond_stop_90d", { n: B.length, of: A.filter((s) => s.ts > now - 90 * D).length, sumPnl: Math.round(B.reduce((a, s) => a + (s.pnl || 0), 0)),
    rows: B.sort((a, b) => a.pct - b.pct).slice(0, 25).map((s) => s.symbol + " " + s.pct.toFixed(2) + "% @" + hm(s.ts) + " hold" + s.holdMin + "m " + s.entry + " → " + s.exit) });
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
// [V33.477] ★왜 거래가 멈췄나★ — 원장 마지막 거래 이후 사이클·잠금·하트비트 · 상태 모양 · 최근 로그 요약(오류·막힘·관문)
try {
  const dg = await get("/api/diag");
  const pick = {}; for (const k of Object.keys(dg || {})) { const v = dg[k]; pick[k] = (v && typeof v === "object") ? JSON.stringify(v).slice(0, 160) : v; }
  out("diag", pick);
} catch (e) { out("diag_err", String(e)); }
try {
  const st2 = await get("/api/state");
  const shape = {}; for (const k of Object.keys(st2 || {})) { const v = st2[k]; shape[k] = Array.isArray(v) ? "arr" + v.length : (v && typeof v === "object") ? "{" + Object.keys(v).slice(0, 8).join(",") + "}" : String(v).slice(0, 60); }
  out("state_shape", shape);
  const pv = st2.positions || {}; out("positions_raw", { us: JSON.stringify(pv.us || null).slice(0, 200), kr: JSON.stringify(pv.kr || null).slice(0, 200) });
} catch (e) { out("state2_err", String(e)); }
try {
  const lg = await get("/api/logs?limit=600");
  const t0 = lg.length ? lg[lg.length - 1].ts || lg[lg.length - 1].created_at : null, t1 = lg.length ? lg[0].ts || lg[0].created_at : null;
  out("logs_span", { n: lg.length, from: t0, to: t1 });
  const key = (m) => String(m || "").replace(/\d[\d,.:%\-]*/g, "#").replace(/\s+/g, " ").slice(0, 70);
  const cnt = new Map(); for (const r of lg) { const k = (r.level || "?") + " " + key(r.message || r.msg); cnt.set(k, (cnt.get(k) || 0) + 1); }
  out("logs_top", [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => v + "× " + k));
  out("logs_err", lg.filter((r) => /ERROR|WARN/.test(r.level || "")).slice(0, 15).map((r) => (r.ts || "") + " " + String(r.message || r.msg).slice(0, 220)));
  out("logs_trade", lg.filter((r) => /매수|BUY|관문|막힘|blocked|skip|건너|halt|정지|kill|중단/i.test(String(r.message || r.msg))).slice(0, 25).map((r) => String(r.message || r.msg).slice(0, 200)));
  /* [V33.488] OMNI 섀도우 채점·사후채점 — 섀도우 전용 업로드 뒤 채점이 다시 도는지 */
  out("logs_omni", lg.filter((r) => /OMNI-(SHADOW|FWD)/.test(String(r.message || r.msg))).slice(0, 6).map((r) => String(r.message || r.msg).slice(0, 260)));
} catch (e) { out("logs_err2", String(e)); }
// [V33.477] AI 준비(배지 = 매매 사이클과 같은 판정) · 자가진단 상위 문제
try { const am = await get("/api/ai-mode?fresh=1"); out("ai_mode", { aiReady: am.aiReady, mode: am.mode, committee: Object.fromEntries(Object.entries(am.committee || {}).map(([k, v]) => [k, typeof v === "object" ? !!(v && v.trusted) : v])) });
  /* [V33.482] AI 진입 문턱 — ai_primary_gate 가 무엇에 막는지(문턱 · 하한 · 분포 · 실제 적용값) */
  out("ai_thr", am.thr || null); out("ai_diag", am.diag || null); }
catch (e) { out("ai_mode_err", String(e)); }
try { const sc = await get("/api/selfcheck"); out("selfcheck", { status: sc.status, build: sc.build, top: (sc.issues || []).slice(0, 8).map((i) => i.level + " " + i.area + " " + String(i.msg).slice(0, 140)) });
  const q = (sc.issues || []).find((i) => i.area === "시세"); if (q) out("selfcheck_quote", String(q.msg).slice(0, 900)); }
catch (e) { out("selfcheck_err", String(e)); }
