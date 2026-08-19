// 한국장 매매정지 규칙 검증 — 함수 원문을 떼어 실제로 돌린다
import { readFileSync } from 'node:fs';
/* ═══════════════════════════════════════════════════════════════════════════
   [V33.159] 한국장 매매정지 계약 — 사이드카 · 서킷브레이커

   이 값들은 한국거래소 규정이라 우리가 고를 수 있는 것이 아니다. 문턱 하나를 잘못
   적으면 화면이 ★규정과 다른 말★ 을 하고, 그걸 보고 판단하면 사람이 손해를 본다.
   그래서 구현을 흉내내지 않고 ★함수 원문을 떼어 실제로 돌려서★ 확인한다:
     · 사이드카 코스피 ±5% · 코스닥 ±6% · 상승=매수 / 하락=매도
     · 서킷브레이커 -8 / -15 / -20 (하락만 — 한국은 상승 CB 가 없다)
     · '1분 지속' — 한 번 스친 값으로 발동을 외치지 않는가
     · 14:50 컷오프 · 1일 1회 · 3단계는 컷오프 예외(당일 종료)
     · 사이드카는 선물이 기준인데 우리는 현물로 잰다 — 그 사실을 응답이 말하는가
   ═══════════════════════════════════════════════════════════════════════════ */
const S = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function grab(name){
  const i = S.indexOf(name);
  if(i<0) throw new Error('없음: '+name);
  let d=0,j=S.indexOf('{',i);
  for(;j<S.length;j++){ if(S[j]==='{')d++; else if(S[j]==='}'){d--; if(!d)break;} }
  return S.slice(i,j+1);
}
const src = grab('const KRHALT = ') + ';\n' + grab('function _krHeld(') + '\n' + grab('function krHaltMarket(');
const F = new Function(src + '; return {KRHALT, krHaltMarket};')();
const {KRHALT, krHaltMarket} = F;
let fail=0; const ok=m=>console.log('  ok   '+m); const bad=m=>{console.log('  ✘ '+m);fail++;};
const NOW = Date.now();
const held = ok2 => ({ts:NOW-60000, ok:ok2});               // 1분 전 관측(연속)
const stale = ok2 => ({ts:NOW-10*60000, ok:ok2});           // 10분 전(연속 아님)
const obs = (u,d,c) => ({scUp:held(u), scDn:held(d), cb:c.map(x=>held(x))});
const MID = 11*60;   // 11:00 KST

console.log('① 사이드카 문턱 — 코스피 5% · 코스닥 6% · 양방향');
{
  let m = krHaltMarket('kospi', 5.1, MID, obs(true,false,[false,false,false]), []);
  if(m.sidecar.dir==='buy' && m.sidecar.held && !m.sidecar.blocked) ok('코스피 +5.1% → 매수 사이드카 (지속 충족)');
  else bad('코스피 +5.1% 판정 실패: '+JSON.stringify(m.sidecar));
  m = krHaltMarket('kospi', -5.2, MID, obs(false,true,[false,false,false]), []);
  if(m.sidecar.dir==='sell' && m.sidecar.held) ok('코스피 -5.2% → 매도 사이드카');
  else bad('매도 사이드카 판정 실패');
  m = krHaltMarket('kospi', 4.9, MID, obs(false,false,[false,false,false]), []);
  if(!m.sidecar.beyond && Math.abs(m.sidecar.toBuy-0.1)<0.001) ok('코스피 +4.9% → 미발동, 매수까지 '+m.sidecar.toBuy+'%p');
  else bad('문턱 직전 계산 오류: '+JSON.stringify(m.sidecar));
  m = krHaltMarket('kosdaq', 5.5, MID, obs(false,false,[false,false,false]), []);
  if(!m.sidecar.beyond) ok('코스닥 +5.5% → 미발동(코스닥 문턱은 6%)');
  else bad('코스닥 문턱을 5%로 쓰고 있다');
  m = krHaltMarket('kosdaq', 6.2, MID, obs(true,false,[false,false,false]), []);
  if(m.sidecar.dir==='buy') ok('코스닥 +6.2% → 매수 사이드카');
  else bad('코스닥 6% 문턱 실패');
}

console.log('② 1분 지속 — 한 번 스친 값으로 발동을 외치지 않는가');
{
  let m = krHaltMarket('kospi', 5.5, MID, null, []);                                  // 직전 관측 없음
  if(m.sidecar.beyond && !m.sidecar.held) ok('첫 관측은 beyond=true, held=false — 아직 발동 아님');
  else bad('직전 관측 없이 지속을 인정했다');
  m = krHaltMarket('kospi', 5.5, MID, {scUp:stale(true),scDn:stale(false),cb:[stale(false),stale(false),stale(false)]}, []);
  if(!m.sidecar.held) ok('10분 전 관측은 연속으로 안 친다');
  else bad('오래된 관측을 연속으로 인정했다');
  m = krHaltMarket('kospi', 5.5, MID, {scUp:held(false),scDn:held(false),cb:[held(false),held(false),held(false)]}, []);
  if(!m.sidecar.held) ok('직전에 문턱 아래였으면 지속이 아니다');
  else bad('직전이 문턱 아래인데 지속으로 봤다');
}

console.log('③ 서킷브레이커 — -8 / -15 / -20, 하락만');
{
  const cbobs = (a,b,c)=>({scUp:held(false),scDn:held(false),cb:[held(a),held(b),held(c)]});
  let m = krHaltMarket('kospi', -8.3, MID, cbobs(true,false,false), []);
  if(m.cb.active===1) ok('-8.3% → 1단계 발동 (20분 중단)');
  else bad('-8.3% 에서 1단계가 아니다: active='+m.cb.active);
  m = krHaltMarket('kospi', -15.4, MID, cbobs(true,true,false), []);
  if(m.cb.active===2) ok('-15.4% → 2단계');
  else bad('-15.4% 에서 2단계가 아니다: '+m.cb.active);
  m = krHaltMarket('kospi', -21, MID, cbobs(true,true,true), []);
  if(m.cb.active===3 && m.cb.steps[2].haltMin===null) ok('-21% → 3단계(당일 장 종료 — 재개 없음)');
  else bad('3단계 판정 실패');
  m = krHaltMarket('kospi', +9, MID, cbobs(false,false,false), []);
  if(m.cb.active===null) ok('+9% 상승에는 서킷브레이커가 없다(한국은 하락만)');
  else bad('상승에 CB를 걸었다');
  m = krHaltMarket('kospi', -3.1, MID, cbobs(false,false,false), []);
  if(m.cb.nearest && m.cb.nearest.step===1 && Math.abs(m.cb.nearest.remain-4.9)<0.001)
    ok('-3.1% → 1단계까지 '+m.cb.nearest.remain+'%p 남음');
  else bad('남은 거리 계산 오류: '+JSON.stringify(m.cb.nearest));
}

console.log('④ 규정상 못 발동하는 때 — 14:50 이후 · 1일 1회 · 장외');
{
  const cbobs = (a,b,c)=>({scUp:held(true),scDn:held(false),cb:[held(a),held(b),held(c)]});
  let m = krHaltMarket('kospi', 5.5, 15*60, cbobs(false,false,false), []);       // 15:00
  if(m.sidecar.blocked && /14:50/.test(m.sidecar.blocked)) ok('15:00 사이드카 — "'+m.sidecar.blocked+'"');
  else bad('14:50 컷오프가 안 걸린다: '+m.sidecar.blocked);
  m = krHaltMarket('kospi', -8.5, 15*60, cbobs(true,false,false), []);
  if(m.cb.steps[0].blocked) ok('15:00 CB 1단계 — "'+m.cb.steps[0].blocked+'"');
  else bad('CB 1단계 컷오프가 안 걸린다');
  if(!m.cb.steps[2].blocked) ok('3단계는 15:00 에도 발동할 수 있다(당일 종료 규정)');
  else bad('3단계에 14:50 컷오프를 잘못 걸었다');
  m = krHaltMarket('kospi', 5.5, MID, cbobs(false,false,false), [{kind:'sidecar',dir:'buy'}]);
  if(m.sidecar.blocked && /1일 1회/.test(m.sidecar.blocked)) ok('이미 발동한 날 — "'+m.sidecar.blocked+'"');
  else bad('1일 1회가 안 걸린다');
  m = krHaltMarket('kospi', 5.5, 8*60, cbobs(false,false,false), []);            // 08:00 장 전
  if(m.sidecar.blocked && /정규장/.test(m.sidecar.blocked)) ok('장 시작 전 — "'+m.sidecar.blocked+'"');
  else bad('장외 판정이 없다');
}

console.log('⑤ 무엇으로 쟀는지 화면이 알 수 있는가');
{
  const m = krHaltMarket('kospi', 1.0, MID, null, []);
  if(m.sidecar.proxy === true && /선물/.test(m.sidecar.proxyNote))
    ok('사이드카는 대용값이라고 표시된다 — "'+m.sidecar.proxyNote+'"');
  else bad('사이드카가 대용값임을 알리지 않는다');
  if(m.cb.proxy === false && /전일 종가/.test(m.cb.basis))
    ok('서킷브레이커는 대용이 아니다 — 기준: '+m.cb.basis);
  else bad('CB 기준 표기가 잘못됐다');
}
console.log(fail?('\n실패 '+fail+'건'):'\nok   한국장 매매정지 규칙 통과');
process.exit(fail?1:0);
