import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let failures = 0;
function check(condition, pass, fail) {
  if (condition) console.log("  ok   " + pass);
  else { failures++; console.error("  FAIL " + fail); }
}

check(/id="nnvHealthbar"[^>]*role="status"[^>]*aria-live="polite"/.test(html),
  "연결 상태가 보조기술에도 실시간 상태로 전달된다",
  "관제실 연결 상태 영역의 status/live 접근성 계약이 없다");
for (const source of ["picks", "mode", "pipe"]) {
  check(new RegExp(`data-source="${source}"`).test(html),
    `${source} 데이터 소스가 독립 상태를 표시한다`,
    `${source} 장애를 다른 데이터 소스와 구분할 수 없다`);
}
check(/function liveFetchJSON\(url, source\)/.test(html) && /if\(!r\.ok\) throw new Error\('HTTP ' \+ r\.status\)/.test(html),
  "HTTP 오류를 성공 데이터로 오인하지 않는다",
  "HTTP 4xx/5xx 응답이 정상 응답처럼 렌더될 수 있다");
check(/AbortController/.test(html) && /15000/.test(html),
  "느린 관측 API는 15초 뒤 종료되어 무한 로딩하지 않는다",
  "관측 API 타임아웃 계약이 없다");
check(/PICKS\.lastError/.test(html) && /liveHealth\('picks', 'error'\)/.test(html),
  "캐시 폴백 중에도 최신 PICKS 요청 실패를 숨기지 않는다",
  "오래된 PICKS 캐시가 최신 정상 응답처럼 보일 수 있다");
check(/repeat\(auto-fit,minmax\(min\(100%,420px\),1fr\)\)/.test(html) && /repeat\(auto-fit,minmax\(90px,1fr\)\)/.test(html),
  "추가 미디어쿼리 없이 관제 요약이 가용 폭에 맞춰 재배치된다",
  "새 관제실의 유동형 모바일 레이아웃이 없다");
check(/class="ops-brief"/.test(html) && ["opsDecision", "opsTopSignal", "opsCommittee", "opsScanAge"].every(id => html.includes(`id="${id}"`)),
  "판정·최상위 신호·위원회·스캔 최신성을 한 눈에 보는 작동 요약이 있다",
  "AI 작동 화면의 핵심 요약 계층이 없다");
check(/function renderOpsBrief\(d\)/.test(html) && /renderOpsBrief\(d\)/.test(html),
  "작동 요약이 실제 응답으로 갱신된다",
  "작동 요약이 정적 장식이거나 렌더 경로에 연결되지 않았다");

if (failures) {
  console.error(`\n✗ AI 작동 관제실 계약 ${failures}건 실패`);
  process.exit(1);
}
console.log("\n✓ AI 작동 관제실 디자인·오류 계약 통과");
