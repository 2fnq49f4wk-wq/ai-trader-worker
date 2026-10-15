/* [V33.594] ★페어(PR_OU) 진입 경로★ — 사용자 결정 "페어트레이딩만 살려 연결".
 *   ① z 계산 · 진입 판정(걷기 검증 통과 · 36시간 신선 · MA50×0.93 · z ≤ −2) — 실행으로 본다
 *   ② 원장 꼬리표 [PAIR] · 실적 관문 키가 따로 · 위원회 우회 · 잠정 ×0.5
 *   ③ 청산 z ≥ 0 / 14일 · 관리 중엔 AI_EXIT·MODEL_EXIT 안 건다
 *   ④ 업로드 엔드포인트가 통과 여부를 ★다시★ 판정(n≥100 · 순초과>0 · t≥2) · GHA 가 pairs_ext 를 부른다 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const G = readFileSync(new URL("../trainer/modal/omniq_gha.py", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/pairs_ext.py", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const a = S.indexOf("const PAIR_ROUTE = {"), b = S.indexOf("function _omqHeadOn(st, h) {");
const f = new Function("_num", S.slice(a, b) + "; return { PAIR_ROUTE, pairZ, pairRoutePick };");
const _num = (v, d) => (typeof v === "number" && isFinite(v)) ? v : d;
const { PAIR_ROUTE, pairZ, pairRoutePick } = f(_num);
const now = Date.parse("2026-10-14T00:00:00Z");
const pr = { b: "B", alpha: 0, beta: 1, mu: 0, sd: 0.05, z: -2.5 };
const ext = { ts: now - 3600000, pairs: { A: pr }, bt: { pass: true, n: 300, meanEx: 0.4, t: 3 } };
chk(Math.abs(pairZ(pr, Math.exp(-0.1), 1) - (-2)) < 1e-9, "z = (logA − α − β·logB − μ)/σ");
chk(!!pairRoutePick(ext, "A", 100 * Math.exp(-0.12), 90, 100, now), "z −2.4 · MA50 위 · 검증 통과 → 산다");
chk(!pairRoutePick(Object.assign({}, ext, { bt: { pass: false } }), "A", 100 * Math.exp(-0.12), 90, 100, now), "걷기 검증 미통과면 안 산다");
chk(!pairRoutePick(Object.assign({}, ext, { ts: now - 40 * 3600000 }), "A", 100 * Math.exp(-0.12), 90, 100, now), "36시간 넘은 페어로는 안 산다");
chk(!pairRoutePick(ext, "A", 100 * Math.exp(-0.05), 90, 100, now), "z −1 이면 안 산다(지금 시세로 다시 잰 z)");
chk(!pairRoutePick(ext, "A", 100 * Math.exp(-0.12), 120, 100, now), "MA50×0.93 아래(공적분 붕괴 전형)면 안 산다");
chk(!!pairRoutePick(ext, "A", 88, 90, null, now), "짝 시세가 없으면 종가 z(−2.5)로");
chk(PAIR_ROUTE.mult === 0.5 && PAIR_ROUTE.maxPerDay === 2 && PAIR_ROUTE.maxOpen === 4 && PAIR_ROUTE.exitZ === 0 && PAIR_ROUTE.maxHoldCal === 14, "미리 고정 값(×0.5 · 하루 2 · 동시 4 · z≥0 · 14일)");
chk(/\(signal && signal\.isPair\) \? "PAIR"/.test(S) && /reason: "\[" \+ _entryTag\(signal\) \+ "\]\[" \+ strategy\.toUpperCase\(\) \+ "\] "/.test(S), "원장 꼬리표 [PAIR][SNAP] — 실적 관문이 따로 센다");
chk(/if \(signal\.isOmniQ \|\| signal\.isPair( \|\| signal\.isStratRoute)? \|\| _regimeScalp\(signal\)\) \{/.test(S), "위원회는 막지도 키우지도 않는다(기록만)");
chk(/if \(signal && signal\.isPair && PAIR_ROUTE\.mult > 0 && PAIR_ROUTE\.mult < 1\) \{/.test(S), "잠정 ×0.5 는 상한 뒤에 곱한다");
chk(/"PAIR-REVERT z "/.test(S) && /"PAIR-TIME "/.test(S) && /_pairHeld = true; _omqHeld = true;/.test(S) && /!_pairHeld( && !\(held\.meta && held\.meta\.sr\))? && daily/.test(S), "청산 z≥0 · 14일 · 관리 중 AI_EXIT·MODEL_EXIT 제외");
chk(/pass: !!\(bt\.pass === true && _num\(bt\.n, 0\) >= 100 && _num\(bt\.meanEx, 0\) > 0 && _num\(bt\.t, 0\) >= 2\)/.test(S), "업로드 때 워커가 통과를 다시 판정");
chk(/pairs_ext\.run\(daily, mkt, omni\.day_key_of_daily/.test(G), "GHA 회차가 같은 일봉으로 페어를 만든다");
chk(/PASS = \{"minN": 100, "minT": 2\.0\}/.test(PY) && /e = t \+ 1 /.test(PY) && /x = k \+ 1 /.test(PY), "걷기 검증 — 다음 날 종가 체결(앞을 보지 않는다) · 관문 n≥100 t≥2");
if (fails) { console.log("check-pair-route: FAIL " + fails); process.exit(1); }
console.log("check-pair-route: ok");
