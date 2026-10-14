/* [V33.596] ★AI_PRIMARY 를 시장별 검증 셋업 위에서만 · 규칙 전략을 OMNI-Q 가 배운다★(사용자 결정 10/14)
 *   ① AI_PARAMS.aiPrimary.setupByMarket.kr = ["TR_PULLBACK"] — 한국은 셋업 없는 강세 추종(TREND_ALIGNMENT) 진입 안 함
 *   ② 진입 배선: 허용 셋업이 있으면 추세 후보는 그 규칙 셋업일 때만 · 스냅 셋업은 그대로 우선
 *   ③ OMNI-Q 피처에 규칙 조건(rule_sn_rsi2 · rule_tr_pullback …) — 쓸모는 관문이 판정 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const Q = readFileSync(new URL("../trainer/modal/omni_q.py", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m); } };
chk(/setupByMarket: \{ kr: \["TR_PULLBACK"\] \}/.test(S), "한국 AI_PRIMARY 허용 셋업 = TR_PULLBACK(미리 고정)");
chk(/const _trendEl = _setOk \? !!\(_trendCandidate && _trendCandidate\.signal && _setOk\.indexOf\(_trendCandidate\.signal\.name\) >= 0\)/.test(S)
    && /selectAiEntryRoute\(_trendEl, _snapEntry, cfg, strategiesHeldNow\)/.test(S), "추세 경로 후보는 허용 셋업일 때만 · 스냅은 그대로");
chk(/def _rule_feats\(P\):/.test(Q) && /"rule_sn_rsi2"/.test(Q) && /"rule_tr_pullback"/.test(Q) && /OMNIQ_RULEFEAT/.test(Q), "OMNI-Q 가 규칙 조건을 피처로 배운다(스위치 OMNIQ_RULEFEAT)");
if (fails) { console.log("check-ai-setup: FAIL " + fails); process.exit(1); }
console.log("check-ai-setup: ok");
