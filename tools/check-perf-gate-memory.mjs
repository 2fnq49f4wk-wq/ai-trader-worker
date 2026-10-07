/* [V33.506] ★실적 관문이 지는 전략을 잊지 않는다 · 레버리지/인버스 ETF 에 AI·단타 진입 금지★
   원장(probe-kr-us 10/07): 한국 단타 <1h 85건 승률 21% −294만 · 한국 레버리지/인버스 9건 −210만(252670 하나 −287만).
   ① 옛 형식 "[SCALP] SC_VWAP" 진입도 규칙엔진(RULE) 으로 센다(종전 null → 한 건도 안 셈)
   ② 100일 전 지는 단타 기록도 막는다(종전 45일 창 밖 → 키 소멸 → 시험 없이 다시 열림)
   ③ executeBuy: 레버리지/인버스 ETF 에 AI·단타 진입 거절 · 규칙 추세·헤지는 그대로 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.slice(S.indexOf("const PERF_GATE = {"), S.indexOf("async function executeBuy("));
const f = new Function("getState", "setState", "globalThis", code + "; return { perfGateLoad, perfGateCheck, PERF_GATE, _pgTag };");
console.log("① 옛 형식 진입 사유");
const T = f(async () => null, async () => {}, {});
chk(T._pgTag("[SCALP] SC_VWAP VWAP 0.2%") === "RULE:SCALP" && T._pgTag("[TREND] TR_PULLBACK MA20") === "RULE:TREND" && T._pgTag("[SNAP] SN_RSI2") === "RULE:SNAP",
  "옛 형식 [SCALP]/[TREND]/[SNAP] → RULE:…", "옛 형식 " + T._pgTag("[SCALP] SC_VWAP x"));
chk(T._pgTag("[AI][TREND] AI_PRIMARY") === "AI:TREND" && T._pgTag("[AI-SCALP][SCALP] AI_SCALP") === "AI-SCALP:SCALP" && T._pgTag("[RULE][SNAP] SN_RSI2") === "RULE:SNAP",
  "새 형식은 종전 그대로", "새 형식");
chk(T._pgTag("[TREND] STOP -3%") === "RULE:TREND" && T._pgTag("hedge buy") === null, "주체 표기가 없으면 null", "기타");
console.log("② 오래된 지는 기록도 기억한다");
const D = 86400000, clock = Date.parse("2026-10-07T00:00:00Z"); const realNow = Date.now; Date.now = () => clock;
const rows = [];
for (let i = 0; i < 30; i++) { const ts = clock - 100 * D + i * 3600000;
  rows.push({ ts, market: "kr", symbol: "K" + i, side: "BUY", qty: 10, pnl_pct: null, reason: "[SCALP] SC_VWAP x" });
  rows.push({ ts: ts + 1800000, market: "kr", symbol: "K" + i, side: "SELL", qty: 10, pnl_pct: i % 5 === 0 ? 1 : -1.3, reason: "[SCALP] SCALP-STOP" }); }
for (let i = 0; i < 20; i++) { const ts = clock - 120 * D + i * 3600000;
  rows.push({ ts, market: "kr", symbol: "P" + i, side: "BUY", qty: 10, pnl_pct: null, reason: "[TREND] TR_PULLBACK x" });
  rows.push({ ts: ts + 3 * D, market: "kr", symbol: "P" + i, side: "SELL", qty: 10, pnl_pct: i % 3 === 0 ? -1 : 2.2, reason: "[TREND] TRAIL" }); }
rows.sort((a, b) => a.ts - b.ts);
const store = { m: {} };
const M = f(async (db, k, d) => (k in store.m ? store.m[k] : d), async (db, k, v) => { store.m[k] = v; }, {});
const DB = { prepare: () => ({ bind: (since) => ({ all: async () => ({ results: rows.filter((r) => r.ts > since) }) }) }) };
const pg = await M.perfGateLoad(DB, true);
chk(pg.keys["kr:RULE:SCALP"] && pg.keys["kr:RULE:SCALP"].mode === "blocked" && pg.keys["kr:RULE:SCALP"].n === 30, "100일 전 옛 형식 한국 단타 30건(지는) → 막힘", "단타 " + JSON.stringify(pg.keys["kr:RULE:SCALP"]));
chk(pg.keys["kr:RULE:TREND"] && pg.keys["kr:RULE:TREND"].mode === "open", "이기는 한국 규칙 추세(풀백)는 그대로", "추세 " + JSON.stringify(pg.keys["kr:RULE:TREND"]));
chk(M.PERF_GATE.windowDays >= 180 && M.PERF_GATE.maxN === 40 && M.PERF_GATE.minN === 15 && M.PERF_GATE.blockPf === 0.8, "창 180일 · 판단은 최근 40건 · 문턱(15건·PF 0.8)은 그대로", "상수");
Date.now = realNow;
console.log("③ 레버리지/인버스 ETF");
const eb = S.slice(S.indexOf("async function executeBuy("), S.indexOf("async function executeBuy(") + 6000);
chk(/strategy !== "hedge" && \(\(typeof LEVERAGED_ETF !== "undefined" && LEVERAGED_ETF\.has\(symbol\)\) \|\| \(typeof INVERSE_ETF !== "undefined" && INVERSE_ETF\.has\(symbol\)\)\)/.test(eb)
  && /strategy === "scalp" \|\| \(signal && \(signal\.isAiPrimary \|\| signal\.isAiScalp\)\)/.test(eb), "executeBuy: 레버리지·인버스 → AI·단타 거절(헤지 제외)", "배선");
chk(eb.indexOf("레버리지·인버스 ETF — AI·단타 진입 제외") > eb.indexOf("BUY 실적 관문 차단"), "실적 관문 바로 뒤(수량 계산 전)", "위치");
if (fails) { console.log("\n✗ 실적 관문 기억 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 실적 관문 기억 계약 통과");
