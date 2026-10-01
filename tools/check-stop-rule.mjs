/* [V33.464] ★손절가 = ATR 손절과 % 손절 중 '타이트한' 쪽 · 수량 산정과 같은 규칙★ — 실행으로 본다.
 *   원장(90일): 한국 111건 중 18건이 손절선(5%)을 넘어 잃었다(합계 −845만 > 한국 전체 손실 −539만).
 *   진입은 Math.min(atrStop, pctStop)(넓은 쪽)이었고 수량은 손절 거리의 작은 쪽으로 잡아 계획 위험의 2~4배를 잃었다.
 *   ① 진입 손절가: 변동 큰 종목(2×ATR = 12%)도 5% 를 넘지 않는다 · 변동 작은 종목(2×ATR = 2%)은 2% · ATR 없으면 5%
 *   ② 수량 산정의 손절 거리 = 진입 손절가의 거리(같은 규칙)
 *   ③ 열린 포지션: 옛 규칙의 넓은 손절가는 평단 −5% 로 끌어올린다 · 본전락·래칫(더 높음)은 그대로 · 헤지·명시 손절폭은 그대로
 *   ④ 배선: executeBuy 가 _entryStopPrice(명시 손절폭이면 % 그대로) · "최대 손절폭" 부등호 · evaluateSell 이 _capStopPrice */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const grab = (name) => { const i = S.indexOf("function " + name + "("); let d = 0; for (let k = S.indexOf("{", i); k < S.length; k++) { if (S[k] === "{") d++; else if (S[k] === "}") { d--; if (!d) return S.slice(i, k + 1); } } return ""; };
const SW = (/const SWING_STOP_WIDEN = ([\d.]+);/.exec(S) || [])[1];
const F = new Function("const SWING_STOP_WIDEN = " + SW + ";" + grab("_entryStopPrice") + ";" + grab("_swingStopPrice") + ";" + grab("_capStopPrice") + "; return { _entryStopPrice, _swingStopPrice, _capStopPrice };")();
const near = (a, b) => Math.abs(a - b) < 1e-9;
console.log("① 진입 손절가");
chk(near(F._entryStopPrice(100, 5, 6, 2), 95), "변동 큰 종목(2×ATR 12%) → 5% 에서 멈춘다(95)", "★변동 큰 종목 손절이 5% 를 넘는다 " + F._entryStopPrice(100, 5, 6, 2) + "★");
chk(near(F._entryStopPrice(100, 5, 1, 2), 98), "변동 작은 종목(2×ATR 2%) → 2%(98)", "★타이트한 ATR 손절을 버린다★");
chk(near(F._entryStopPrice(100, 5, null, 2), 95) && near(F._entryStopPrice(100, 5, 0, 2), 95), "ATR 없으면 % 손절", "★ATR 없을 때 손절이 틀렸다★");
console.log("② 수량 산정과 같은 규칙");
for (const atr of [0.5, 1, 2.5, 4, 9]) {
  const stopDist = Math.min(atr * 2, 100 * 5 / 100), entry = 100 - F._entryStopPrice(100, 5, atr, 2);
  chk(near(stopDist, entry), "ATR " + atr + ": 수량 산정 거리 " + stopDist + " = 실제 손절 거리 " + entry.toFixed(2), "★수량은 " + stopDist + " 로 잡고 실제 손절은 " + entry + "★");
}
chk(/let stopDist = \(atrStopDist != null\) \? Math\.min\(atrStopDist, pctStopDist\) : pctStopDist;/.test(S), "수량 산정은 손절 거리의 작은 쪽(그대로)", "★수량 산정 규칙이 바뀌었다★");
console.log("③ 열린 포지션의 손절가 상한");
chk(near(F._capStopPrice(85, 100, 5, "trend", {}), 95), "옛 넓은 손절가(−15%) → −5%(95)", "★넓은 손절가가 그대로다★");
chk(near(F._capStopPrice(100.1, 100, 5, "trend", { breakEvenLocked: true }), 100.1) && near(F._capStopPrice(97, 100, 5, "trend", {}), 97), "본전락·래칫·타이트한 손절가는 그대로", "★더 높은 손절가를 끌어내렸다★");
chk(near(F._capStopPrice(92, 100, 5, "hedge", {}), 92) && near(F._capStopPrice(92, 100, 5, "trend", { stopOv: 8 }), 92), "헤지·명시 손절폭(LLM 지시)은 그대로", "★명시 손절폭을 덮어썼다★");
chk(F._capStopPrice(null, 100, 5, "trend", {}) === null, "손절가가 없으면 null(폴백 % 손절이 따로)", "★없는 손절가를 지어냈다★");
console.log("③-b 원자재·국채(스윙): 수량 산정 = max(기본, min(N×ATR%, 기본×1.6))");
for (const atr of [1, 3, 6]) {
  const sizing = Math.max(5, Math.min(atr * 2, 5 * 1.6)), real = 100 - F._swingStopPrice(100, 5, atr, 2);
  chk(near(sizing, real), "ATR " + atr + ": 수량 산정 거리 " + sizing + " = 실제 손절 거리 " + real.toFixed(2), "★스윙 손절이 수량 산정과 다르다(" + sizing + " vs " + real + ")★");
}
chk(near(F._capStopPrice(85, 100, 5, "swing", {}), 92) && near(F._capStopPrice(93, 100, 5, "swing", {}), 93), "스윙 열린 포지션: 상한 기본×1.6(−8%) · 그 안은 그대로", "★스윙 손절가 상한이 틀렸다★");
chk(SW === "1.6" && (S.match(/stopPrice = _swingStopPrice\(price, stopPct, dailyAtr, atrMult\)/g) || []).length === 2, "executeBuyCM·executeBuyAlt 가 _swingStopPrice", "★원자재·국채 매수가 상한 없는 손절을 쓴다★");
console.log("④ 배선");
const eb = S.slice(S.indexOf("async function executeBuy("), S.indexOf("// [중복실행 방지] 겹치는 invocation"));
chk(/if \(dailyAtr && strategy !== "scalp" && !_hasStopOv\) \{\s*stopPrice = _entryStopPrice\(price, stopPct, dailyAtr, atrMult\);/.test(eb) && !/Math\.min\(atrStop, pctStop\)/.test(S),
  "executeBuy: 타이트한 쪽(_entryStopPrice) · 명시 손절폭이면 % 그대로 · 넓은 쪽(Math.min) 없음", "★executeBuy 가 넓은 손절을 고른다★");
chk(/if \(stopPrice < pctStop\) stopPrice = pctStop;/.test(eb) && !/if \(stopPrice > pctStop\) stopPrice = pctStop;/.test(eb), "최대 손절폭 = stopPct(부등호 바로)", "★최대 손절폭 부등호가 거꾸로다★");
chk(/stopOv: _hasStopOv \? opts\.stopPctOverride : null/.test(eb), "명시 손절폭을 포지션에 남긴다(청산 상한이 존중)", "★명시 손절폭 표시가 없다★");
chk(/const stopPrice = _capStopPrice\(\(typeof meta\.stopPrice === "number"\) \? meta\.stopPrice : null, pos\.avg, \(r\.stopLossPct \|\| cfg\.stopLoss \|\| 5\), strategyName, meta\);/.test(S),
  "evaluateSell: 하드 손절에 손절가 상한(_capStopPrice)", "★열린 포지션의 넓은 손절가가 그대로 쓰인다★");
if (fails) { console.error("\n✗ 손절 규칙 검사 실패 " + fails); process.exit(1); }
console.log("\n✓ 손절 규칙 검사 통과");
