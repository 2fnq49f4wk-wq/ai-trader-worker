import fs from "node:fs";
import vm from "node:vm";

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

// [Codex V33.314] Execute production functions, including both sides of the chart race.
const nodes = new Map();
const el = id => { if (!nodes.has(id)) nodes.set(id, { textContent:'', innerHTML:'' }); return nodes.get(id); };
const pending = new Map();
const ctx = vm.createContext({
  $id:el, ago:()=> '1m', quoteOf:()=> null, esc:String, console,
  fetch:url=>new Promise((resolve,reject)=>pending.set(new URL(url,'https://test.local').searchParams.get('symbol'),{resolve,reject})),
  drawLineChart:(box,cs,sym)=>{ box.innerHTML = 'chart:' + sym; }, TP:{ cache:{}, sym:null, wait:null },
});
function evaluateBetween(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end,a);
  if (a < 0 || b < 0) throw Error('Production function missing: ' + start);
  vm.runInContext(html.slice(a,b),ctx);
}
evaluateBetween('  function rankedLivePicks(d){','  /* ══ [V33.144]');
evaluateBetween('  function verdictOf(pk){','  /* [V33.7]');
evaluateBetween('  function renderCore(d){','  // 종가 선 그래프');
const data = { picks:[{symbol:'LOW',p:.53},{symbol:'HIGH',p:.75},{symbol:'SKIP',p:.99,abstain:true}],
  mode:{alt:{roster:[{state:'on'},{state:'prov'},{state:'off'}]}}, scan:{} };
ctx.renderOpsBrief(data);
ctx.renderCore(data);
check(el('opsTopName').textContent === 'HIGH' && el('nlvTpSym').textContent === 'HIGH',
  '요약과 차트가 같은 최상위 후보를 고른다', '요약과 차트의 정렬 기준이 다르다');
check(el('opsCommittee').textContent === '2/3', '서버 on/prov 명부를 가동 인원으로 센다', '정상 위원회가 0명으로 보인다');
check(el('opsTopSignal').textContent === '0.75', '랭크 점수를 확률 퍼센트로 오인시키지 않는다', '랭크를 승률처럼 표시한다');
ctx.TP.cache.CACHED = [{c:1},{c:2}];
ctx.loadTopPickChart('CACHED');
pending.get('HIGH').reject(Error('late failure'));
await new Promise(resolve=>setImmediate(resolve));
check(el('nlvTpChart').innerHTML === 'chart:CACHED', '늦은 실패가 캐시에서 전환한 새 차트를 덮지 않는다', '이전 요청 실패가 새 차트를 덮었다');
ctx.loadTopPickChart('OLD');
ctx.loadTopPickChart('NEW');
pending.get('NEW').resolve({ok:true,json:async()=>({candles:[{c:3},{c:4}]})});
await new Promise(resolve=>setImmediate(resolve));
pending.get('OLD').resolve({ok:true,json:async()=>({candles:[]})});
await new Promise(resolve=>setImmediate(resolve));
check(el('nlvTpChart').innerHTML === 'chart:NEW', '늦은 빈 응답이 현재 차트를 지우지 않는다', '늦은 빈 응답이 현재 차트를 지웠다');
ctx.loadTopPickChart('ERROR');
pending.get('ERROR').resolve({ok:false,status:500,json:async()=>({candles:[{c:1},{c:2}]})});
await new Promise(resolve=>setImmediate(resolve));
check(el('nlvTpChart').innerHTML.includes('조회 실패'), '차트 HTTP 오류를 데이터로 그리지 않는다', 'HTTP 오류 응답을 차트로 그렸다');
ctx.renderCore({picks:[{symbol:'ABSTAIN',p:.9,abstain:true}]});
check(el('nlvTpSym').textContent === '—', '전원 기권이면 최우선 신호를 지어내지 않는다', '기권 종목을 최우선 후보로 표시한다');
const css = fs.readFileSync(new URL('../public/brain-console.css', import.meta.url),'utf8');
check(html.includes('/brain-console.css?v=33.315') && css.includes('prefers-reduced-motion'),
  '흑백 스타일과 모션 감소가 연결되어 있다', '흑백 콘솔 스타일 배선이 없다');
check((html.match(/class="nnv-tab(?: active)?" data-model=/g)||[]).length === 14,
  '14개 모델 탭을 보존했다', '모델 탭이 사라졌다');

// [Codex V33.315] Unified workspaces, topology, and regressions found during integration.
const ui = fs.readFileSync(new URL('../public/workspace-ui.js', import.meta.url),'utf8');
new vm.Script(ui); // External script is not covered by the inline HTML syntax checker.
ctx.URL = URL;
evaluateBetween('  function newsSafeUrl(value)', '  function renderNews(data)');
check(ctx.newsSafeUrl('javascript:alert(1)') === null && ctx.newsSafeUrl('data:text/html,test') === null,
  '뉴스 링크가 실행 가능한 프로토콜을 거부한다', '뉴스 링크가 실행 가능한 URL을 허용한다');
check(ctx.newsSafeUrl('https://example.com/news?a=1&b=2') === 'https://example.com/news?a=1&b=2',
  '정상 원문 링크는 보존한다', '정상 뉴스 링크를 막았다');
check(html.includes('escapeHtml(pub)') && html.includes('rel="noopener noreferrer"'),
  '뉴스 날짜를 이스케이프하고 원문 탭을 분리한다', '뉴스 외부 데이터가 HTML/오프너 경계를 넘는다');
ctx.LUXR = {state:key=>key==='stack'?'prov':'on'};
evaluateBetween('  function NNV_netSvg(d){','  function NNV_renderOverview(d){');
const topology=ctx.NNV_netSvg({inputDim:75,featVer:9,experts:[{name:'dnn',valAcc:53},{name:'seq',valAcc:54}],stack:{slots:['dnn','seq']},combine:{},dual:[]});
check(topology.includes('75차원') && topology.includes('IC 결합과 로짓 혼합') && topology.includes("switchNnModel('seq')"),
  '새 구조도는 실제 차원·잠정 혼합·모델 이동을 표현한다', '구조도가 실제 경로나 모델 연결을 잃었다');
check(!topology.includes('<svg') && topology.includes('brain-map-experts'),
  '고정폭 구조도를 반응형 모델 카드로 교체했다', '구조도가 여전히 고정폭 그림이다');
check(/if\(id === 'news' \|\| id === 'fx'\) id = 'macro'/.test(html),
  '뉴스와 환율의 기존 진입점이 통합 화면을 연다', '옛 진입점이 빈 페이지를 연다');
const fxStart = html.slice(html.indexOf('  function fxStartLive()'),html.indexOf('  function fxStopLive()'));
check(fxStart.includes("getElementById('page-macro')") && !fxStart.includes("getElementById('page-fx')"),
  '환율 폴링은 실제 통합 페이지를 확인한다', '환율 폴링이 삭제된 페이지를 확인한다');
for(const id of ['newsBody','newsStamp','fxBody','macroUsBody','macroKrBody','btnRefreshNews','btnFxRefresh','btnMacroRefresh']) {
  check(html.split('id="'+id+'"').length === 2, id+'는 한 개만 보존된다', id+'가 사라지거나 중복됐다');
}
check(!/--(?:acc|s1|s2|t1|t2|t3):/.test(css.slice(0,css.indexOf('body #page-nnviz'))) && !css.includes(':is(.topbar,.nav,.sidebar'),
  '두뇌 스타일이 왼쪽 메뉴의 토큰/필터를 변경하지 않는다', '두뇌 스타일이 사이드바까지 변경한다');

if (failures) {
  console.error(`\n✗ AI 작동 관제실 계약 ${failures}건 실패`);
  process.exit(1);
}
console.log("\n✓ AI 작동 관제실 디자인·오류 계약 통과");
