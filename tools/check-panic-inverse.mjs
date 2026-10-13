/* [V33.582] ★폭락날 숏(인버스) 레버리지 단타 계약★ — 사용자(10/13): "오늘 한국장 폭락했는데 폭락 레버리지 매매를 안 했다 · 설계상 숏 레버리지 단타를 쳐야 한다".
 *   운영(10/13 KR BEAR/CRASH · 지수 최악 −7% · PANIC 평균 −5%): 매 사이클 scalp scan 80 · sig 0. 막은 벽 다섯 + 헤지 미작동:
 *   ① V9.8 변동성 차단(deRisk)이 패닉 단타까지 끔 ② 한국 usOnly 로 evaluateScalpEntry 미호출 ③ 인버스 ETF 가 스캔 80칸에 못 듦
 *   ④ 폭락 첫날 인버스의 일봉 MA20<MA50 ⑤ 매수 직전 레버리지·인버스 ETF 단타 금지(V33.506) + kr:RULE:SCALP 실적 관문
 *   ⑥ 꼬리위험 헤지가 mcfg.tailRisk(없음)를 읽어 V12.60 이후 한 번도 안 돎 · 한국 폭락은 VIX 와 무관 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };

// 인버스 2X: 직전까지 상승장 → 인버스 일봉 하락 추세(MA20 < MA50)
const closes = Array.from({ length: 120 }, (_, i) => 6000 - i * 15);
const daily = { symbol: "252670.KS", closes, highs: closes.map((c) => c * 1.01), lows: closes.map((c) => c * 0.99), volumes: closes.map(() => 1e6), prevClose: closes[closes.length - 1] };
const last = closes[closes.length - 1] * 1.12;   // 오늘 +12%(지수 −6%)
const mc = Array.from({ length: 30 }, (_, i) => last * (0.97 + i * 0.001));
const mb = { price: mc[mc.length - 1], vwap: mc[mc.length - 1] / 1.012, closes: mc, volumes: mc.map(() => 5e5), recentMom: 0.6, highs: mc, lows: mc };
const crash = { regime: "BEAR", worstDayPct: -6.1, avgDayPct: -5, idxReturn20: -8 };
const calm = { regime: "BEAR", worstDayPct: -0.4, avgDayPct: -0.3, idxReturn20: -3 };
// 장중 시각으로 고정(마감 직전·장외 차단을 피한다 — 10/13 화 11:00 KST)
const RealDate = Date, AT = Date.UTC(2026, 9, 13, 2, 0), SH = AT - RealDate.now();
class FD extends RealDate { constructor(...a) { if (a.length === 0) super(RealDate.now() + SH); else super(...a); } static now() { return RealDate.now() + SH; } }
globalThis.Date = FD;
const sig = M.evaluateScalpEntry(mb, daily, {}, "kr", crash, null);
chk(sig && sig.name === "SC_PANIC_INV" && sig.isPanicScalp && /지수 폭락/.test(sig.detail) && /레버리지×2/.test(sig.detail), "폭락 첫날: 인버스 일봉이 하락 추세여도 장중 방향(VWAP 위·모멘텀)으로 SC_PANIC_INV", JSON.stringify(sig));
const sig2 = M.evaluateScalpEntry(mb, daily, {}, "kr", calm, null);
chk(!(sig2 && sig2.name === "SC_PANIC_INV"), "지수가 오늘 안 무너지면(약세만) 종전대로 인버스 일봉 추세를 요구한다", JSON.stringify(sig2));
const mbBelow = Object.assign({}, mb, { vwap: mb.price * 1.01 });
const sig3 = M.evaluateScalpEntry(mbBelow, daily, {}, "kr", crash, null);
chk(!(sig3 && sig3.name === "SC_PANIC_INV"), "폭락날이라도 인버스가 VWAP 아래(장중 꺾임)면 사지 않는다");

globalThis.Date = RealDate;
// 배선
chk(/scalpVolBlocked = true;/.test(S) && /const _scVolOnly = scalpDailyBlocked && scalpVolBlocked;/.test(S) && /\(!scalpDailyBlocked \|\| \(_scVolOnly && _panicScalpOn\)\)/.test(S),
    "① 변동성 차단 중에도 패닉 단타는 진입 가능(당일 손실한도 차단은 그대로)");
chk(/if \(_scalpSig && _scVolOnly && !_scalpSig\.isPanicScalp\)/.test(S), "① 변동성 차단 중 평시·AI 롱 단타는 그대로 막힌다");
chk(/\(_ruleScalpOk \|\| _panicScalpOn\) && _scAligned\)/.test(S) && /if \(_scalpSig && !_ruleScalpOk && _scalpSig\.name !== "SC_PANIC_INV"\) _scalpSig = null;/.test(S),
    "② usOnly 시장(한국)은 패닉 인버스만 허용(투매 반등·평시 규칙 단타는 종전대로 금지)");
chk(/const _invPri = _panicScalpOn && _entryAllowed && INVERSE_ETF\.has\(symbol\);/.test(S) && /\(scalpScanUsed < _scanMax \|\| _invPri\)/.test(S), "③ 패닉 중 인버스 ETF 는 스캔 예산과 무관하게 본다");
const eb = S.slice(S.indexOf("async function executeBuy("), S.indexOf("// === [V8] 전략 룰 헬퍼 ==="));
chk(/!\(signal && signal\.isPanicScalp\)/.test(eb) && M._entryTag({ isPanicScalp: true }) === "PANIC" && M._pgTag("[PANIC][SCALP] SC_PANIC_INV x") === "PANIC:SCALP",
    "⑤ 패닉 단타는 레버리지·인버스 금지 예외 · 실적 관문 PANIC:SCALP 로 따로(kr:RULE:SCALP 막힘과 무관)");
chk(/if \(_scalpSig && _scalpSig\.isPanicScalp\) \{/.test(S) && /if \(signal\.isOmniQ \|\| signal\.isPanicScalp\) \{/.test(S) && /ctxScore < 0 && !\(_sr\.signal && _sr\.signal\.isPanicScalp\)/.test(S),
    "AI 단타 거부권·위원회 게이트·CTX 단타 차단은 패닉 인버스에 안 걸린다(학습 분포 밖 · 순풍)");
// ⑥ 헤지
chk(/const tr = \(mcfg && mcfg\.tailRisk\) \|\| \(\(typeof AI_PARAMS !== "undefined"\) \? AI_PARAMS\.tailRisk : null\);/.test(S) && /crashGate\.panic = true;/.test(S) && /\{ panic: !!crashGate\.panic \}/.test(S),
    "⑥ 헤지가 AI_PARAMS.tailRisk 를 읽고 · 그 시장 패닉으로도 켜진다");
{
  const calls = [];
  const DB = { prepare: (q) => ({ bind: (...a) => ({ all: async () => ({ results: [] }), first: async () => null, run: async () => ({}) }), all: async () => ({ results: [] }), first: async () => null }) };
  // 헤지 수단 시세는 daily: 캐시에서 — getState 가 DB.prepare(...).bind(k).first() 를 쓰므로 일봉을 돌려준다
  const DB2 = { prepare: (q) => ({ bind: (...a) => ({ first: async () => (/daily:/.test(String(a[0])) ? { v: JSON.stringify({ closes: [5000, 5100] }) } : null), all: async () => ({ results: [] }), run: async () => { calls.push(q); return {}; } }), all: async () => ({ results: [] }) }), batch: async () => [] };
  let threw = null;
  try { await M.runTailRiskHedge(DB2, "kr", { feeKR: 0.00015 }, 1e8, 0, { kr: 1e8 }, { panic: true }); } catch (e) { threw = e; }
  chk(!threw, "헤지 함수가 VIX 0 · 한국 패닉에서 예외 없이 돈다(설정을 찾는다)", threw && String(threw));
}
if (fails) { console.log("\n✗ 폭락 인버스 단타 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 폭락 인버스 단타 통과");
