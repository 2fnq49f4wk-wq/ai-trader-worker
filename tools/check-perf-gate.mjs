/* [V33.459] ★실적 관문 — 지는 진입은 스스로 멈춘다★ 가 정말 그렇게 도는가(실행으로 본다).
 *   ① 원장(FIFO 짝짓기)에서 시장 × 진입 주체 × 전략별 성과를 잰다 — 매도의 주체는 먼저 들어온 매수에서 온다
 *   ② n ≥ 15 · 평균 < 0 · PF < 0.8 → 막힘 · 이기는 쪽은 그대로
 *   ③ 7일 뒤 시험(반 크기) — 시험 동안의 청산만 센다 · 여전히 지면 다시 막힘 · 이기면 풀림
 *   ④ 원장을 못 읽으면 막지 않는다 · 막힘 기록을 못 읽으면 되쓰지 않는다
 *   ⑤ 배선: executeBuy 가 관문을 지나고 · AI 진입이 SIGNAL_TYPES 에 있다 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.slice(S.indexOf("const PERF_GATE = {"), S.indexOf("async function executeBuy("));
const mk = (rowsRef, store) => {
  const DB = { prepare: () => ({ bind: () => ({ all: async () => { if (rowsRef.fail) throw new Error("D1 down"); return { results: rowsRef.rows }; } }) }) };
  const getState = async (db, k, d, strict) => { if (store.failRead && strict) throw new Error("read fail"); return k in store.m ? JSON.parse(JSON.stringify(store.m[k])) : d; };
  const setState = async (db, k, v) => { store.m[k] = JSON.parse(JSON.stringify(v)); store.writes++; };
  const f = new Function("getState", "setState", "globalThis", code + "; return { perfGateLoad, perfGateCheck, PERF_GATE };");
  const G = {};
  return Object.assign(f(getState, setState, G), { DB, G });
};
const D = 86400000;
let clock = Date.parse("2026-10-01T00:00:00Z");
const realNow = Date.now; Date.now = () => clock;
const trades = (n, tag, market, pct, t0, sym) => {
  const out = [];
  for (let i = 0; i < n; i++) { const ts = t0 + i * 3600000; const s = (sym || "S") + i;
    out.push({ ts, market, symbol: s, side: "BUY", qty: 10, pnl_pct: null, reason: tag + " X" });
    out.push({ ts: ts + 1800000, market, symbol: s, side: "SELL", qty: 10, pnl_pct: typeof pct === "function" ? pct(i) : pct, reason: "STOP" }); }
  return out;
};
console.log("① ② 막힘 · 이기는 쪽은 그대로");
const rows = { rows: [] }, store = { m: {}, writes: 0 };
rows.rows = [...trades(20, "[AI-SCALP][SCALP]", "us", (i) => i % 4 === 0 ? 1.0 : -1.2, clock - 20 * D, "A"),
             ...trades(20, "[AI][TREND]", "us", (i) => i % 3 === 0 ? -1 : 2.5, clock - 20 * D, "B"),
             ...trades(10, "[RULE][SCALP]", "us", -2, clock - 10 * D, "C")].sort((a, b) => a.ts - b.ts);
let M = mk(rows, store);
let pg = await M.perfGateLoad(M.DB, true);
chk(pg.keys["us:AI-SCALP:SCALP"] && pg.keys["us:AI-SCALP:SCALP"].mode === "blocked", "지는 AI 단타(n20 · 평균<0 · PF<0.8)는 막힌다", "★지는 진입이 안 막힌다★ " + JSON.stringify(pg.keys["us:AI-SCALP:SCALP"]));
chk(pg.keys["us:AI:TREND"] && pg.keys["us:AI:TREND"].mode === "open", "이기는 AI 추세는 그대로", "★이기는 진입을 막았다★");
chk(pg.keys["us:RULE:SCALP"] && pg.keys["us:RULE:SCALP"].mode === "open" && pg.keys["us:RULE:SCALP"].n === 10, "표본 15건 미만은 판정하지 않는다(10건 전부 손실이어도)", "★표본이 적은데 막았다★");
let c1 = await M.perfGateCheck(M.DB, "us", { isAiScalp: true }, "scalp");
let c2 = await M.perfGateCheck(M.DB, "us", { isAiPrimary: true }, "trend");
chk(!c1.ok && c2.ok && c2.mult === 1, "check: 막힌 쪽은 거절 · 연 쪽은 그대로(크기 1)", "★check 결과가 틀렸다★ " + JSON.stringify([c1, c2]));
chk(store.writes === 1 && store.m.perf_gate.keys["us:AI-SCALP:SCALP"].mode === "blocked", "막힘은 상태에 한 번 적힌다", "★상태 기록이 틀렸다★");
console.log("③ 7일 뒤 시험 · 다시 막힘 / 풀림");
clock += 8 * D;
M = mk(rows, store);
pg = await M.perfGateLoad(M.DB, true);
chk(pg.keys["us:AI-SCALP:SCALP"].mode === "probation" && pg.keys["us:AI-SCALP:SCALP"].n === 0, "7일 뒤엔 시험 — 옛 손실은 세지 않는다", "★시험으로 안 넘어갔다★ " + JSON.stringify(pg.keys["us:AI-SCALP:SCALP"]));
c1 = await M.perfGateCheck(M.DB, "us", { isAiScalp: true }, "scalp");
chk(c1.ok && c1.mult === 0.5, "시험 중엔 반 크기로 들어간다", "★시험 크기가 틀렸다★ " + JSON.stringify(c1));
const rowsLose = { rows: rows.rows.concat(trades(9, "[AI-SCALP][SCALP]", "us", -0.8, clock + 3600000, "P")) };
clock += 2 * D;
M = mk(rowsLose, store); pg = await M.perfGateLoad(M.DB, true);
chk(pg.keys["us:AI-SCALP:SCALP"].mode === "blocked", "시험에서도 지면(8건+) 다시 막힌다", "★시험 실패인데 안 막혔다★ " + JSON.stringify(pg.keys["us:AI-SCALP:SCALP"]));
clock += 8 * D; M = mk(rowsLose, store); pg = await M.perfGateLoad(M.DB, true);
const rowsWin = { rows: rowsLose.rows.concat(trades(9, "[AI-SCALP][SCALP]", "us", 1.5, clock + 3600000, "Q")) };
clock += 2 * D; M = mk(rowsWin, store); pg = await M.perfGateLoad(M.DB, true);
chk(pg.keys["us:AI-SCALP:SCALP"].mode === "open", "시험에서 이기면 풀린다", "★시험 성공인데 안 풀렸다★ " + JSON.stringify(pg.keys["us:AI-SCALP:SCALP"]));
console.log("④ 못 읽으면");
const st2 = { m: {}, writes: 0 }; M = mk({ rows: [], fail: true }, st2);
const c3 = await M.perfGateCheck(M.DB, "us", { isAiScalp: true }, "scalp");
chk(c3.ok && c3.mult === 1, "원장을 못 읽으면 막지 않는다(판정 불가 ≠ 손실)", "★원장 실패로 진입을 막았다★");
const st3 = { m: { perf_gate: { keys: { "us:AI-SCALP:SCALP": { mode: "blocked", since: clock } } } }, writes: 0, failRead: true };
M = mk(rows, st3); await M.perfGateLoad(M.DB, true);
chk(st3.writes === 0, "막힘 기록을 못 읽으면 되쓰지 않는다(기록을 지우지 않는다)", "★읽기 실패인데 되썼다★");
Date.now = realNow;
console.log("⑤ 배선");
chk(/const _pg = \(typeof perfGateCheck === "function"\) \? await perfGateCheck\(DB, market, signal, strategy\)/.test(S) && /BUY 실적 관문 차단/.test(S),
  "executeBuy 가 관문을 지난다(막히면 거래 없음 · 시험이면 반 크기)", "★executeBuy 가 관문을 안 지난다★");
chk(/"AI_PRIMARY", "AI_SCALP"\s*\n\];/.test(S), "AI 진입도 SIGNAL_TYPES 에 있다(켈리·가지치기·자가치유가 본다)", "★AI 진입이 신호 성과에서 빠졌다★");
chk(/perfGateCheck\(DB, "cm", null, "cm-swing"\)/.test(S) && /perfGateCheck\(DB, mk, null, sleeve\.label \+ "-swing"\)/.test(S), "원자재·국채 매수도 관문을 지난다(원장 태그와 같은 열쇠)", "★원자재·국채가 관문을 안 지난다★");
chk(/if \(path === "\/api\/perf-gate"\)/.test(S), "/api/perf-gate 로 판정을 볼 수 있다", "★판정을 볼 곳이 없다★");
if (fails) { console.error("\n✗ 실적 관문 검사 실패 " + fails); process.exit(1); }
console.log("\n✓ 실적 관문 검사 통과");
