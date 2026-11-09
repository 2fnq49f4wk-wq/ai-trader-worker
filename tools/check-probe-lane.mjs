/* [V33.797] ★맞으면서 배운다 — 시험 차선 · 국면 인버스 차선 · 차선별 성적 축소★ (사용자 11/9 명시 지시)
 *   ① 차선 성적: 원장 reason 꼬리로 core / probe / inv 를 따로 센다(관문과 같은 FIFO 표본)
 *   ② 축소 규칙: 15건 이상 · PF<0.8 → ×0.5 · PF<0.5 → ×0.35 · 그 밖 ×1(막지 않는다)
 *   ③ 인버스 청산: 손절·익절·최대 보유·국면 회복·레버리지 국면 하향
 *   ④ 배선: 막힌 매수 → 시험 차선(상한 · 표지) · 그림자 원장 그대로 · 일일 손실 한도 · 인버스는 같은 사이클 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.slice(S.indexOf("const PERF_GATE = {"), S.indexOf("async function executeBuy("));
const store = { m: {} };
const getState = async (db, k, d) => (k in store.m ? store.m[k] : d);
const setState = async (db, k, v) => { store.m[k] = v; };
const rows = [];
const add = (n, reason, pct, sym, t0) => { for (let i = 0; i < n; i++) { const ts = t0 + i * 3600000;
  rows.push({ ts, market: "us", symbol: sym + i, side: "BUY", qty: 10, pnl_pct: null, reason });
  rows.push({ ts: ts + 60000, market: "us", symbol: sym + i, side: "SELL", qty: 10, pnl_pct: typeof pct === "function" ? pct(i) : pct, reason: "X" }); } };
const t0 = Date.now() - 20 * 86400000;
add(16, "[AI-Q][TREND] OMNI_Q · 시험차선", (i) => (i % 4 === 0 ? 1 : -1.5), "P", t0);
add(5, "[AI-Q][TREND] OMNI_Q", 2, "C", t0);
add(4, "[INV][HEDGE] INV_LANE", 3, "I", t0);
rows.sort((a, b) => a.ts - b.ts);
const DB = { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) };
const f = new Function("getState", "setState", "globalThis", "_num", code + "; return { perfGateLoad, laneAdaptMult, _laneOf, _entryTag, PROBE_LANE };");
const M = f(getState, setState, {}, (x, d) => (typeof x === "number" && isFinite(x) ? x : d));
console.log("① 차선 성적");
const pg = await M.perfGateLoad(DB, true);
chk(pg.lanes && pg.lanes["us:probe"] && pg.lanes["us:probe"].n === 16, "시험 차선 16건을 따로 센다", "★시험 차선 성적이 안 나뉜다★ " + JSON.stringify(pg.lanes));
chk(pg.lanes["us:core"] && pg.lanes["us:core"].n === 5 && pg.lanes["us:inv"] && pg.lanes["us:inv"].n === 4, "정상 5건 · 인버스 4건", "★차선 분류가 틀렸다★");
chk(pg.lanes["us:probe:AI-Q:TREND"] && pg.lanes["us:probe:AI-Q:TREND"].n === 16, "차선 × 신호 성적도 센다", "★차선×신호 성적이 없다★");
chk(M._laneOf("[INV][HEDGE] x · 시험차선") === "inv" && M._entryTag({ isInvLane: true }) === "INV", "인버스 꼬리표 INV", "★INV 꼬리표가 틀렸다★");
console.log("② 축소 규칙(막지 않는다)");
chk(M.laneAdaptMult({ n: 16, pf: 0.3 }) === 0.35 && M.laneAdaptMult({ n: 16, pf: 0.7 }) === 0.5 && M.laneAdaptMult({ n: 16, pf: 1.2 }) === 1 && M.laneAdaptMult({ n: 5, pf: 0.1 }) === 1,
  "15건+ PF<0.5 ×0.35 · PF<0.8 ×0.5 · 좋거나 표본 부족 ×1", "★축소 규칙이 틀렸다★");
chk(M.PROBE_LANE.mult <= 0.35 && M.PROBE_LANE.maxPosFrac <= 0.05 && M.PROBE_LANE.maxTotalFrac <= 0.2, "시험 차선 상한(×0.3 · 종목 5% · 전체 20%)", "★시험 차선 상한이 풀렸다★");
console.log("③ 인버스 청산");
const inv = S.slice(S.indexOf("const INV_LANE = {"), S.indexOf("async function runInverseLane("));
const I = new Function(inv + "; return { invExitWhy, invLev, INV_LANE };")();
chk(I.invExitWhy("CRASH", 3, -7.5, 1) === "stop" && I.invExitWhy("CRASH", 3, 10.5, 1) === "tp" && I.invExitWhy("CRASH", 3, 1, 4.2) === "time", "손절 · 익절 · 최대 보유", "★인버스 청산 규칙이 틀렸다★");
chk(I.invExitWhy("NEUTRAL", 1, 1, 1) === "regime" && I.invExitWhy("BEAR", 2, 1, 1) === "delever" && I.invExitWhy("BEAR", 1, 1, 1) === null, "국면 회복 · 레버리지 하향 · 1x 하락장 보유", "★국면 청산이 틀렸다★");
chk(I.invLev("SQQQ") === 3 && I.invLev("252670.KS") === 2 && I.invLev("114800.KS") === 1 && I.INV_LANE.budgetFrac.CRASH <= 0.15, "레버리지 · 예산 상한 15% 이하", "★인버스 예산·레버리지가 틀렸다★");
console.log("④ 배선");
chk(/await shadowRecord\(DB, market, symbol, price, _pg\.key\)/.test(S) && /probeLaneCheck\(DB, market, symbol, price, signal, _pg, cfg\)/.test(S), "막힌 매수 → 그림자 원장 + 시험 차선", "★시험 차선/그림자 배선이 빠졌다★");
chk(/signal && signal\.probe \? " · 시험차선"/.test(S) && /probe: \(signal && signal\.probe\) \? 1 : null/.test(S), "원장 꼬리 · 포지션 표지", "★시험 차선 표지가 빠졌다★");
chk(/crashGate\.dailyLoss = true/.test(S) && /runInverseLane\(DB, market, mcfg, portfolioValue, cash, \{ canon: regime && regime\.canon, canTrade: canTrade, dailyLoss: !!crashGate\.dailyLoss \}\)/.test(S)
  && /if \(!inRoute \|\| \(o && o\.dailyLoss\)\) return cash;/.test(S), "인버스 차선은 같은 사이클 · 일일 손실 한도면 신규 없음", "★인버스 차선 배선·한도가 빠졌다★");
chk(/if \(p\.meta && p\.meta\.invLane\) continue;/.test(S), "꼬리 헤지가 인버스 차선 보유를 안 판다", "★꼬리 헤지가 인버스 차선을 건드린다★");
if (fails) { console.error("\n✗ 시험·인버스 차선 검사 실패 " + fails); process.exit(1); }
console.log("\n✓ 시험·인버스 차선 검사 통과");
