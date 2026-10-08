/* [V33.530] 추격 매수 차단 — 원장 감사(매수 602건 · 다음 5·20일 시장 초과)가 고른 줄.
 *   미국: 그날 +2% 이상 뒤 매수 상위⅓ 5일 −1.49%p(t −2.82) · 한국: 5일 +6.5% 이상 뒤 매수 상위⅓ 5일 −3.04%p(t −2.30)
 *   ① 판정 함수(경계값 포함) ② 기본 설정값 ③ 배선: 신규 진입만(보유 종목 추가매수·청산 무관) · 단타는 남긴다 · 사유가 심사 기록에 남는다 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const us = { enabled: true, maxRet1d: 2.0 }, kr = { enabled: true, maxRet5d: 6.5 };
chk(M.antiChaseWhy(us, 2.0, 0) === "1d+2.0%" && M.antiChaseWhy(us, 1.99, 30) === null, "미국: 1일 +2.0% 부터 차단 · 5일은 안 본다");
chk(M.antiChaseWhy(kr, 15, 6.5) === "5d+6.5%" && M.antiChaseWhy(kr, 15, 6.49) === null, "한국: 5일 +6.5% 부터 차단 · 1일은 안 본다");
chk(M.antiChaseWhy({ enabled: false, maxRet1d: 2 }, 9, 9) === null && M.antiChaseWhy(us, NaN, null) === null, "끄면 무동작 · 값이 없으면 막지 않는다");
const cl = [100, 101, 102, 103, 104, 105, 106];
chk(Math.abs(M.antiChaseRet5(cl, 110.25) - (110.25 / 101 - 1) * 100) < 1e-9 && M.antiChaseRet5([1, 2, 3], 5) === null, "5일 수익 = 지금가 / 5거래일 전 종가 − 1");
chk(/antiChase: \{ us: \{ enabled: true, maxRet1d: 2\.0 \}, kr: \{ enabled: true, maxRet5d: 6\.5 \} \}/.test(S), "기본 설정값(원장 근거와 같음)");
const blk = S.slice(S.indexOf("/* [V33.530] ★추격 매수 차단★(DEFAULT_CFG"), S.indexOf("let _spillMult = 1;"));
chk(/!heldSymbols\.has\(symbol\)/.test(blk), "신규 진입만 — 보유 종목은 건드리지 않는다");
chk(/sr\.strategy !== "scalp"/.test(blk) && /filter\(function \(sr\) \{ return sr\.strategy === "scalp"; \}\)/.test(blk), "단타 신호는 남긴다(따로 판단)");
chk(/incBlock\("CHASE\[" \+ _why \+ "\]"\)/.test(blk), "차단 사유가 심사 기록(BLOCK/심사완료)에 남는다");
chk(S.indexOf("/* [V33.530] ★추격 매수 차단★(DEFAULT_CFG") < S.indexOf('incBlock("CTX_NEG");'), "진입 심사(맥락 점수·사이징) 앞에서 거른다");
if (fails) { console.log("\n✗ 추격 매수 차단 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 추격 매수 차단 계약 통과");
