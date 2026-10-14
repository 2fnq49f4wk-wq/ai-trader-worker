/* [V33.589] ★AI 청산 왕복(산 지 1~3분 만에 같은 AI 가 파는 것) 회귀 방지★
 *   원장(10/14): AI_EXIT 41건 중 10건이 진입 1~3분 뒤 · 9/11 120110.KS 20분에 4회 왕복 · 미국 IQV 3분 만에 청산.
 *   ① 최소 보유(AI_PARAMS.exit.minHoldHours) 안에는 위원회 청산 판정을 건너뛴다(OMNI-Q 관리 제외 조건과 한 줄)
 *   ② 청산 블렌드가 진입과 같은 실측 계수(__blendK)를 받는다
 *   ③ 위원회 청산(AI_EXIT · AI_ROTATE) 뒤 재진입 쿨다운 — 손익 부호와 무관 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m); } };

const ex = S.slice(S.indexOf("committeeExitProb: 0.42,"), S.indexOf("committeeExitProb: 0.42,") + 2000);
const mh = /minHoldHours:\s*(\d+)/.exec(ex);
chk(mh && Number(mh[1]) >= 24, "AI_PARAMS.exit.minHoldHours ≥ 24 (미리 고정)");
chk(/_xc\.committeeExit && __aiReady && !_omqHeld && daily && Array\.isArray\(daily\.closes\) && daily\.closes\.length >= 60\s*\n\s*&& !\(_num\(_xc\.minHoldHours, 0\) > 0 && held\.opened_ts && \(Date\.now\(\) - held\.opened_ts\) < _num\(_xc\.minHoldHours, 0\) \* 3600000\)\) \{/.test(S),
    "최소 보유 전엔 AI_EXIT · AI_ROTATE 판정 자체를 안 한다(위원회 호출 비용도 0)");
chk(/_exitP = _luxDecisionBlend\(_mdx\.p, _tkx\.tech, _nsx, AI_PARAMS\.decisionCore, _kbx\);/.test(S) && /let _kbx = __blendK;/.test(S),
    "청산 블렌드가 진입과 같은 계수(__blendK · 소셜)를 쓴다");
chk(/const _aiExitCd = !!\(reason && \(reason\.startsWith\("AI_EXIT"\) \|\| reason\.startsWith\("AI_ROTATE"\)\)\);/.test(S)
    && /if \(fullClose && reason && \(_aiExitCd \|\| \(pnlPct < 0 && /.test(S),
    "위원회 청산 뒤엔 손익과 무관하게 재진입 쿨다운");
// 쿨다운이 실제로 매수 차단에 쓰인다
chk(/ctx\.cooldowns\.has\(ctx\.symbol\)\) return "REENTRY_COOLDOWN"/.test(S) && /cooldowns: activeCooldowns,/.test(S), "쿨다운이 매수 차단(REENTRY_COOLDOWN)으로 이어진다");

if (fails) { console.log("check-ai-exit-churn: FAIL " + fails); process.exit(1); }
console.log("check-ai-exit-churn: ok");
