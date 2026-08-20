/* ═══════════════════════════════════════════════════════════════════════════
   [V33.170] 사이클 상수 캐시 계약 — ★같은 값을 종목마다 다시 읽지 않는다★

   증상은 CPU/시간이었지만 원인은 D1 왕복이었다. 스캔이 56종목에 100초를 썼고,
   mlDeepDecide 가 호출당 14회 읽는데 스캔 경로가 그 값을 안 넘겨 종목마다 다시 읽었다.
   호출부마다 opts 를 채우는 방식은 ★또 빠뜨릴 수 있어★(실제로 그랬다) 읽기 자체를 기억한다.

   여기서 지키는 것:
     · 같은 키를 두 번 읽으면 DB 는 한 번만 간다
     · ★쓰기가 나면 그 키는 즉시 잊는다★ — 학습이 방금 쓴 값을 옛 값으로 읽으면 안 된다
     · invocation 이 바뀌면 초기화된다(warm isolate 가 옛 값을 물려받지 않게)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
const S = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function grab(n){ const i=S.indexOf(n); if(i<0) throw new Error('없음: '+n);
  let d=0,j=S.indexOf('{',i);
  for(;j<S.length;j++){ if(S[j]==='{')d++; else if(S[j]==='}'){d--; if(!d)break;} } return S.slice(i,j+1); }
let fail=0; const ok=m=>console.log('  ok   '+m); const bad=m=>{console.log('  ✘ '+m);fail++;};

/* 실제 함수 원문을 떼어 가짜 DB 위에서 돌린다 — 왕복 횟수를 센다 */
const src = 'let __cycMemo = new Map();\n'
  + grab('function cycMemoReset()') + '\n'
  + grab('async function _cycState(') + '\n'
  + grab('async function getState(') + '\n'
  + 'return { cycMemoReset, _cycState, getState, forget:(k)=>__cycMemo.delete(k), size:()=>__cycMemo.size };';
const F = new Function(src)();

let reads = 0;
const DB = { prepare(){ return { bind(){ return { async first(){ reads++; return { v: JSON.stringify({ v: 1 }) }; } }; } }; } };

console.log('① 같은 키를 여러 번 읽어도 DB 는 한 번');
{
  F.cycMemoReset(); reads = 0;
  for (let i = 0; i < 14; i++) await F._cycState(DB, 'stack_model', null);
  if (reads === 1) ok('14회 요청 → DB 1회 (종전이라면 14회)');
  else bad('DB 왕복 ' + reads + '회');

  // 종목 56개가 각각 12개 키를 본다고 가정
  F.cycMemoReset(); reads = 0;
  const keys = ['dnn_trust','gbdt_trust','flow_model','xalpha_model','memo_model','stack_model',
                'committee_cal','tech_prior_k','dual_bull_model','dual_bear_model','dual_quad_shift','final_cal'];
  for (let s2 = 0; s2 < 56; s2++) for (const k of keys) await F._cycState(DB, k, null);
  if (reads === keys.length) ok('56종목 × ' + keys.length + '키 = ' + (56*keys.length) + '요청 → DB ' + reads + '회');
  else bad('DB 왕복 ' + reads + '회 (기대 ' + keys.length + ')');
}

console.log('② ★쓰기가 나면 잊는다★ — 방금 쓴 값을 옛 값으로 읽지 않게');
{
  if (/__cycMemo\.delete\(k\);\s*\/\/ \[V33\.170\]/.test(S)) ok('setState 가 해당 키의 기억을 지운다');
  else bad('setState 가 캐시를 무효화하지 않는다 — 학습 결과를 옛 값으로 읽을 수 있다');
  F.cycMemoReset(); reads = 0;
  await F._cycState(DB, 'k1', null);
  F.forget('k1');
  await F._cycState(DB, 'k1', null);
  if (reads === 2) ok('무효화 후에는 다시 읽는다');
  else bad('무효화가 안 먹는다(읽기 ' + reads + '회)');
}

console.log('③ invocation 경계에서 초기화되는가');
{
  for (const [t, why] of [
    ['cycMemoReset();      // [V33.170]', 'cron 시작에서 초기화'],
    ['__R2 = env.MODELS || null; cycMemoReset();', 'fetch 시작에서 초기화'],
  ]) { if (S.includes(t)) ok(why); else bad(why + ' — 없다(warm isolate 가 옛 값을 물려받는다)'); }
  F.cycMemoReset();
  if (F.size() === 0) ok('초기화하면 비워진다');
}

console.log('④ 캐시 대상이 ★사이클 상수★ 인가');
{
  const body = grab('async function mlDeepDecide');
  const left = (body.match(/getState\(DB,/g) || []).length;
  const memo = (body.match(/_cycState\(DB,/g) || []).length;
  if (left === 0 && memo >= 14) ok('mlDeepDecide 의 상태 읽기 ' + memo + '곳이 전부 캐시 경로');
  else bad('아직 직접 읽는 곳 ' + left + '곳');
  // 시세·포지션처럼 자주 바뀌는 것을 캐시하면 안 된다
  for (const k of ['quote:', 'daily:', 'positions', 'last_tick']) {
    if (new RegExp('_cycState\\(DB, "' + k).test(S)) bad('자주 바뀌는 키를 캐시한다: ' + k);
  }
  ok('시세·포지션 등 자주 바뀌는 키는 캐시하지 않는다');
}
console.log(fail ? '\n실패 ' + fail + '건' : '\nok   사이클 상수 캐시 계약 통과');
process.exit(fail ? 1 : 0);
