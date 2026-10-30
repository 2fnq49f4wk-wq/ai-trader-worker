/* [V33.703] ★손해 원인 재발 방지 계약★ — 사용자 10/29 "최근 손해 원인 찾고 다시는 발생하지 않도록".
   원장 6/3~10/29 매도 816건 실측 원인:
   ① 손해의 대부분 = 퇴역 경로(AI_PRIMARY 위원회 · 단타 SC_* · AI_SCALP · 급등 레버리지) — V33.649 부터 미·한 주식 신규 매수는 AI-Q · SROUTE 만.
   ② 크기: 손절폭이 좁을수록 수량이 커져(min(ATR, %) · 단타 분봉 손절) 큰 돈이 더 자주 졌다(한국 금액 4분위 승률 18%).
   이 둘이 조용히 되살아나면 막는다. */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
chk(/^const ENTRY_ROUTES_ONLY = true;$/m.test(S), "미·한 주식 신규 매수 경로 제한 켜짐(ENTRY_ROUTES_ONLY)", "★퇴역 경로(위원회·단타·규칙)가 다시 살 수 있다★");
chk(/^const ENTRY_ROUTES = new Set\(\["AI-Q", "SROUTE"\]\);$/m.test(S), "허용 경로 = AI-Q · SROUTE 둘뿐", "★허용 경로 목록이 바뀌었다(사용자 승인 필요)★");
chk(/!ENTRY_ROUTES\.has\(_entryTag\(signal\)\)/.test(S), "executeBuy 입구에서 경로 검사", "★executeBuy 입구 경로 검사가 빠졌다★");
const m = /^const SIZE_STOP_FLOOR_PCT = (\d+(?:\.\d+)?);/m.exec(S);
chk(m && +m[1] >= 5, "수량 계산 손절폭 하한 ≥ 5%", "★수량 계산 손절폭 하한이 없거나 5% 미만(좁은 손절 = 큰 수량 재발)★");
chk(/Math\.floor\(riskDollar \/ Math\.max\(stopDist, price \* SIZE_STOP_FLOOR_PCT \/ 100\)\)/.test(S), "주식 수량 = 리스크 ÷ max(손절폭, 하한)", "★주식 수량 계산이 하한을 안 쓴다★");
/* [V33.708] 매매법 AI·국면 전략(SROUTE)은 옛 신호 거르개 6종만 면제 — 포트폴리오 관문·폭락장 생존 게이트는 면제하지 않는다 */
const B = (S.match(/function evaluateBuyBlocks[\s\S]*?\n}\n/) || [""])[0];
chk(/const isSR = !!\(signal && signal\.isStratRoute === true && signal\.sr\);/.test(B), "면제 = 검증 경로(SROUTE) 신호만", "★면제 판별이 바뀌었다★");
chk(!/isSR|isOQ|_exemptSig/.test((B.split("// 인버스 페어 차단")[1] || "x")), "포트폴리오 관문(인버스 페어·섹터·동시 보유·중복)은 SROUTE 도 그대로", "★SROUTE 가 포트폴리오 관문까지 면제받는다★");
chk(/if \(crashGate\.blockNew && !_symInverse && !_isPanicScalpSig\)/.test(S), "폭락장 생존 게이트(드로다운·연속손실)는 SROUTE 도 그대로", "★폭락장 생존 게이트가 풀렸다★");
if (fails) { console.log("✗ 손해 원인 재발 방지 계약 실패 " + fails); process.exit(1); }
console.log("✓ 손해 원인 재발 방지 계약 통과");
