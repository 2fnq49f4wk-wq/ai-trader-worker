/* [V33.704] ★한국 수급 규칙 계약★ — 사용자 10/29 "수급 데이터부터 넣어서 한국장 성능".
   학습기 flow_kr.py(네이버 · GHA 캐시 · 하루 늦춤) → playbook_sim 규칙 후보 fveto(검증 구간이 고를 때만) → 워커 pbFlowVetoed(같은 식) → 화면.
   미래 정보(하루 늦춤)·D1 사용·배선 끊김을 막는다. */
import { readFileSync } from "node:fs";
const R = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const FK = R("trainer/modal/flow_kr.py"), PB = R("trainer/modal/playbook_sim.py"), S = R("src/index.js"), UI = R("studio/src/views/PlaybookDeck.tsx"), WF = R(".github/workflows/omniq-gha.yml");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
chk(/return r\.shift\(1\)\.values, r\.values\[-1\]/.test(FK), "수급 백분위는 하루 늦춤(t 에는 t−1 까지)", "★수급 백분위가 그날 값을 쓴다(미래 정보)★");
chk(!/env\.DB|D1/.test(FK.replace(/워커 D1 은 쓰지 않는다/, "")), "학습기가 네이버에서 직접(D1 안 씀)", "★수급 수집이 D1 을 쓴다★");
chk(/if timecol == "t" and FLOW_RANK is not None:\s*\n\s*rules = rules \+ RULES_FLOW/.test(PB) && /len\(RULES_FLOW\) if FLOW_RANK is not None else 0/.test(PB), "수급 규칙은 후보로만(검증 구간이 고름 · 운 수준 K 에 포함)", "★수급 규칙이 검증 없이 쓰이거나 운 수준 계산에서 빠졌다★");
chk(/ok = ok & ~\(np\.nan_to_num\(fr, nan=0\.0\) > float\(rule\["fveto"\]\)\)/.test(PB) && /v > _num\(rule\.fveto, 1\)/.test(S), "학습기·워커 같은 식(값 > fveto 면 제외 · 값 없으면 통과)", "★학습기와 워커의 수급 거름 식이 다르다★");
chk(/flow: _obj\(x\.flow\)/.test(S), "워커 업로드 저장에 flow 포함", "★워커가 수급 값을 버린다★");
chk(/flow: r\.daily\.flow \|\| null/.test(S), "GET /api/playbook 이 flow 를 화면에 내보냄", "★화면이 수급 값을 못 받는다★");
chk(/pbFlowVetoed\(st, ctx\.symbol, _rl\) \? null/.test(S), "워커 일봉 고르기에 수급 거름 연결", "★워커가 수급 규칙을 무시한다★");
chk(/"flow": \(\{syms_all\[j\]/.test(PB), "학습기가 오늘 수급 백분위 업로드", "★워커로 수급 값이 안 간다★");
chk(/수급 과열 거름/.test(UI) && /수급과열 제외/.test(UI), "화면 판단 흐름 · 규칙 이름표에 수급", "★화면에 수급 규칙이 안 보인다★");
chk(/path: ~\/\.pbflow/.test(WF), "GHA 수급 캐시(첫 회차만 10년치)", "★수급 캐시가 없다(매 회차 10년치 재수집)★");
if (fails) { console.log("✗ 한국 수급 계약 실패 " + fails); process.exit(1); }
console.log("✓ 한국 수급 계약 통과");
