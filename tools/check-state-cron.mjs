/* [V33.515] /api/state R2 사본을 크론이 미리 짓는다 — 요청 경로의 ctx.waitUntil 빌드가 바쁜 시간에 끝나지 못해
 *   사본이 수 시간 묵었다(운영: 2,722초 · 6,668초 · 7,498초 — 개장 21분 뒤에도 marketStatus.kr=false).
 *   ① 빌더는 최상위 한 함수(요청·크론이 같은 것) ② 크론은 화면이 최근 15분 안에 열렸을 때만 · 2분마다 · 사본이 2분보다 묵었을 때만
 *   ③ 요청 경로가 '열려 있음' 표시를 남긴다 ④ 신선한 사본이면 짓지 않는다(행동 검사). */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
chk(/^async function buildStatePayload\(env\) \{/m.test(S), "빌더가 최상위 함수 buildStatePayload(env)");
chk(/const __buildState = function \(\) \{ return buildStatePayload\(env\); \};/.test(S), "요청 경로가 같은 빌더를 부른다(두 벌 아님)");
chk(!/const __buildState = async \(\) => \{/.test(S), "옛 클로저 빌더가 남아 있지 않다");
const sch = S.slice(S.indexOf("try { await runTradingCycle(env); }"), S.indexOf("try { await runTradingCycle(env); }") + 2000);
chk(/getUTCMinutes\(\) % 2 === 0/.test(sch) && /"state_last_req"/.test(sch) && /15 \* 60000/.test(sch) && /stateR2Refresh\(env, 120000\)/.test(sch),
  "크론: 2분마다 · 최근 15분 화면 열림 · 사본 2분 초과일 때만", "크론 배선");
chk(/setState\(env\.DB, "state_last_req", Date\.now\(\)\)/.test(S) && /__stateReqMarkAt/.test(S), "요청 경로가 열림 표시를 남긴다(아이솔레이트당 1분 1회)");
chk(/__r2Key = STATE_R2_KEY/.test(S), "요청 경로와 크론이 같은 R2 키");
const M = await import("../src/index.js");
let puts = 0, built = 0;
M._setR2ForTest({ head: async () => ({ customMetadata: { at: String(Date.now() - 30000) } }), put: async () => { puts++; }, get: async () => null });
const r = await M.stateR2Refresh({ DB: { prepare: () => { built++; throw new Error("짓지 말아야 한다"); } } }, 120000);
chk(r === null && puts === 0 && built === 0, "사본이 30초 묵었으면(2분 미만) 짓지 않는다", JSON.stringify({ r, puts, built }));
M._setR2ForTest(null);
if (fails) { console.log("\n✗ 상태 사본 크론 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 상태 사본 크론 통과");
