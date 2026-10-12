/* [V33.572] 첫 화면 저장본으로 '자동 운용 중 (지연)' 을 띄우지 않는다 — 사용자 10/12 "접속하면 지연이 뜨다가 라이브로 바뀐다".
 *   저장본(localStorage bootBundle)의 lastTick 은 마지막 방문 때 값이라 5분 문턱에 걸린다 — 서버는 정상인데 화면만 지연이었다.
 *   ① 저장본 렌더는 fromCache=true 로 표시 · 수신 시각(__lastDataReceived)을 찍지 않는다 ② 배지는 저장본이면 '서버 확인 중' · stale 판정 안 함 */
import { readFileSync } from "node:fs";
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
chk(/_apply\(\[_bb\.state, _bb\.trades \|\| \[\], \[\]\], true\)/.test(H), "저장본 렌더는 fromCache=true");
chk(/window\.__stateFromCache = !!fromCache;\s*\/\/ \[V33\] 데이터 수신 성공[^\n]*\n\s*if \(!fromCache\) window\.__lastDataReceived = Date\.now\(\);/.test(H), "저장본은 수신 시각을 찍지 않는다(LIVE 로 속이지 않는다)");
chk(/if\(window\.__stateFromCache\)\{ sub\.textContent = '서버 확인 중…'; if\(box\) box\.classList\.remove\('stale'\); return; \}/.test(H), "배지: 저장본이면 '서버 확인 중' · 지연 판정 안 함");
chk(/var idle = age > 5 \* 60000;/.test(H), "서버 시각이 실제로 5분 넘게 멈추면 여전히 지연으로 띄운다");
if (fails) { console.log("\n✗ 첫 화면 배지 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 첫 화면 배지 통과");
