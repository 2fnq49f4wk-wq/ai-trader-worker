/* [V33.477] ★AI 준비 판정 검사★ — 2026-09-28~10-03 매수 0 사고의 재발 방지.
   준비 판정이 `MIND && GBDT` 라, GBDT 하나가 섀도우로 내려가자 XGB·LGB·CatBoost 가 정식 투표 중인데도
   '미가동' → V33.407 규칙대로 신규 진입 전부 차단 → 보유 0 으로 말라 갔다. 로그는 5시간만 남아 아무도 몰랐다.
   ① 판정을 실행해 본다 ② 매매 사이클과 화면 배지가 ★같은 함수★ 를 쓰는가 ③ 미가동이 상태로 남고 자가진단이 읽는가 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
console.log("① 판정");
chk(M.aiCoreReady(true, false, 3) === true, "MIND + 부스터 3(GBDT 섀도우) → 가동(2026-09-28 상황)", "★GBDT 가 섀도우면 부스터가 있어도 멈춘다★");
chk(M.aiCoreReady(true, true, 0) === true, "MIND + GBDT → 가동", "★GBDT 만으로 못 선다★");
chk(M.aiCoreReady(true, false, 0) === false, "MIND 만(트리 위원 0) → 미가동", "★트리 위원 없이 선다★");
chk(M.aiCoreReady(false, true, 3) === false, "위원장 없음 → 미가동", "★위원장 없이 선다★");
console.log("② 같은 함수");
chk(/__aiReady = aiCoreReady\(!!__mind, !!__gbdt, __boostersLive\)/.test(S) && !/__aiReady = !!\(__mind && __gbdt\)/.test(S),
  "매매 사이클이 aiCoreReady 를 쓴다", "★매매 사이클이 다른 판정을 쓴다★");
chk(/aiReady = !!\(_auto\.enabled && aiCoreReady\(/.test(S) && !/aiReady = !!\(_auto\.enabled && mindOk && \(dnnOk \|\| gbdtOk\)\)/.test(S),
  "화면 배지(/api/ai-mode)도 같은 함수", "★배지와 매매가 다르게 판정한다★");
chk(/__boostersLive = \(\(await _boostersCached\(DB\)\) \|\| \[\]\)\.length/.test(S), "부스터 수 = 라이브 위원회가 채점에 쓰는 목록(_boostersCached)", "★부스터를 다른 출처로 센다★");
console.log("③ 조용히 멈추지 않는다");
chk(/setState\(DB, "ai_halt", \{ since:/.test(S) && /"ai_halt", null\);\s*\n\s*if \(_h && _h\.since\)/.test(S) && /AI 미가동 " \+/.test(S),
  "미가동 시작 시각을 상태에 · 자가진단이 '몇 시간째' 로 올린다", "★미가동이 기록되지 않는다★");
console.log(fails ? "\n✗ AI 준비 판정 검사 실패 " + fails : "\n✓ AI 준비 판정 검사 통과");
process.exit(fails ? 1 : 0);
