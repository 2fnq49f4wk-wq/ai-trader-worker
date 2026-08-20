/* ═══════════════════════════════════════════════════════════════════════════
   [V33.171] 라운드로빈 커버리지 계약 — ★전 종목을 도는가, 같은 종목만 도는가★

   운영로그의 증거: 형태트리거가 매 사이클 118~227종목을 승격시켰는데 TIME-CAP 예산으로
   실제 평가된 것은 6~62종목뿐이었다. 승격분을 앞에 통째로 몰아놨으니 그 뒤 순환 대기열에는
   한 번도 도달하지 못했고, '순환 진도'가 늘 0이라 오프셋이 사이클당 한 칸씩만 갔다.
   557종목 한 바퀴에 557사이클 ≈ 9시간 — 겉보기엔 라운드로빈, 실제로는 제자리걸음이었다.

   여기서 지키는 것(전부 실제 소스를 떼어 돌려서 확인한다):
     · 예산이 얼마든 순환분이 자기 몫을 가져간다 — 굶는 것이 구조적으로 불가능하다
     · 오프셋은 ★빈틈없이 평가된 칸수★만 전진한다 — 어떤 종목도 건너뛰어지지 않는다
     · 유한한 사이클 안에 전 종목이 반드시 평가된다(모의로 완주를 확인)
     · 종전 방식(승격 몰아넣기)이면 실패한다는 것도 함께 확인한다 — 회귀를 잡기 위해
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
const S = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function grab(n){ const i=S.indexOf(n); if(i<0) throw new Error('없음: '+n);
  let d=0,j=S.indexOf('{',i);
  for(;j<S.length;j++){ if(S[j]==='{')d++; else if(S[j]==='}'){d--; if(!d)break;} } return S.slice(i,j+1); }
let fail=0; const ok=m=>console.log('  ok   '+m); const bad=m=>{console.log('  ✘ '+m);fail++;};

/* 실제 소스를 떼어 온다 — 게이트가 검사하는 것은 사본이 아니라 배포될 코드 자체다 */
const F = new Function(
  grab('const LIVETRIG = ') + ';\n' +
  grab('function evalOrderPlan(') + '\n' +
  grab('function evalOffsetAdvance(') + '\n' +
  'return { LIVETRIG, evalOrderPlan, evalOffsetAdvance };')();
const { LIVETRIG, evalOrderPlan, evalOffsetAdvance } = F;

const N = 557;                       // 실제 US 유니버스 크기
const rnd = (s => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(20260820);

/* 관측된 트리거 분포를 재현한다: 유니버스의 ~35%가 점수를 받고, 대부분 약신호(+2)다 */
function scoreUniverse(){
  const sc = new Map();
  for (let i = 0; i < N; i++) {
    const r = rnd();
    sc.set(i, r < 0.22 ? 2 : r < 0.32 ? 4 : r < 0.36 ? 5 : r < 0.38 ? 8 : 0);
  }
  return sc;
}

/* 한 사이클 모의 — 실제 코드와 같은 순서로 회전·계획·평가·오프셋전진을 밟는다 */
function cycle(off, budget, sc){
  const rotated = [];
  for (let i = 0; i < N; i++) rotated.push({ id: (off + i) % N });
  const plan = evalOrderPlan(rotated, it => sc.get(it.id) || 0, LIVETRIG);
  const seen = new Set(), ids = [];
  for (let i = 0; i < Math.min(budget, plan.order.length); i++) {
    const it = plan.order[i];
    seen.add(plan.pos.get(it)); ids.push(it.id);
  }
  const adv = evalOffsetAdvance(seen, N);
  return { off: (off + adv) % N, adv, ids, promoted: plan.hotN };
}

console.log('① 승격이 예산을 통째로 먹지 않는가 (관측된 최악: 트리거 227 / 예산 40)');
{
  const sc = scoreUniverse();
  let promotedTotal = 0; for (const v of sc.values()) if (v > 0) promotedTotal++;
  const r = cycle(0, 40, sc);
  if (r.promoted <= LIVETRIG.maxN) ok('트리거 ' + promotedTotal + '종목 중 승격은 ' + r.promoted + '종목(상한 ' + LIVETRIG.maxN + ')');
  else bad('승격 ' + r.promoted + '종목 — 상한 ' + LIVETRIG.maxN + ' 초과');
  if (r.adv > 0) ok('예산 40에서 순환 ' + r.adv + '칸 전진(종전 방식은 1칸이었다)');
  else bad('★순환 정체★ — 전진 0칸');
}

console.log('② 예산이 어떻게 쪼그라들어도 전진하는가 (실측 최저 6종목까지 내려간 날이 있다)');
{
  for (const budget of [6, 10, 16, 25, 40, 62]) {
    const sc = scoreUniverse();
    const r = cycle(0, budget, sc);
    const share = r.adv / budget;
    if (r.adv >= 1 && share >= 0.25) ok('예산 ' + String(budget).padStart(2) + ' → ' + String(r.adv).padStart(2) + '칸 전진 (예산의 ' + Math.round(share*100) + '%)');
    else bad('예산 ' + budget + ' → ' + r.adv + '칸 — 순환 몫이 너무 작다(' + Math.round(share*100) + '%)');
  }
}

console.log('③ ★전 종목이 유한 사이클 안에 반드시 평가되는가★ — 사용자의 질문 그 자체');
{
  const sc = scoreUniverse();
  const everSeen = new Set();
  let off = 0, cycles = 0;
  const LIMIT = 400;
  while (everSeen.size < N && cycles < LIMIT) {
    // 매 사이클 시세가 바뀌므로 트리거도 바뀐다 — 20% 종목의 점수를 갈아끼운다
    if (cycles % 3 === 0) { const s2 = scoreUniverse(); for (const [k,v] of s2) if (rnd() < 0.2) sc.set(k, v); }
    const r = cycle(off, 40, sc);
    for (const id of r.ids) everSeen.add(id);
    off = r.off; cycles++;
  }
  if (everSeen.size === N) ok('557종목 전부 평가됨 — ' + cycles + '사이클 (1분 주기이므로 약 ' + cycles + '분)');
  else bad('★' + cycles + '사이클을 돌고도 ' + (N - everSeen.size) + '종목을 한 번도 안 봤다★');
  if (cycles <= 60) ok('한 바퀴 ' + cycles + '사이클 — 장중 여러 바퀴를 돈다');
  else bad('한 바퀴에 ' + cycles + '사이클 — 너무 느리다(60 이내여야 한다)');
}

console.log('④ 오프셋이 평가 안 한 칸을 건너뛰지 않는가');
{
  // 앞칸이 비어 있으면 전진하지 않아야 한다 — 그 칸이 통째로 굶기 때문
  const seen = new Set([1,2,3,4,5]);          // 0번 칸을 안 봤다
  if (evalOffsetAdvance(seen, N) === 0) ok('0번 칸을 안 봤으면 전진하지 않는다');
  else bad('안 본 칸을 건너뛴다 — 그 종목이 한 바퀴 통째로 굶는다');
  const seen2 = new Set([0,1,2,7,8,9]);       // 3~6번이 비었다
  if (evalOffsetAdvance(seen2, N) === 3) ok('연속 구간(0~2)까지만 전진한다 — 빈칸 앞에서 멈춘다');
  else bad('빈칸을 지나쳐 전진한다(' + evalOffsetAdvance(seen2, N) + ')');
  if (evalOffsetAdvance(new Set(), N) === 0) ok('아무것도 못 봤으면 0칸');
  else bad('평가 0종목인데 전진한다');
}

console.log('⑤ 상한 초과 승격분이 사라지지 않고 순환으로 돌아오는가');
{
  const sc = new Map();
  for (let i = 0; i < N; i++) sc.set(i, i < 200 ? 5 : 0);   // 200종목이 승격 자격
  const rotated = []; for (let i = 0; i < N; i++) rotated.push({ id: i });
  const plan = evalOrderPlan(rotated, it => sc.get(it.id) || 0, LIVETRIG);
  if (plan.order.length === N) ok('계획 길이 ' + plan.order.length + ' = 유니버스 ' + N + ' (누락 0)');
  else bad('종목이 사라졌다: ' + plan.order.length + ' vs ' + N);
  const uniq = new Set(plan.order.map(x => x.id));
  if (uniq.size === N) ok('중복·누락 없이 전 종목이 정확히 한 번씩');
  else bad('중복 또는 누락(고유 ' + uniq.size + ')');
}

console.log('⑥ ★종전 방식(승격 몰아넣기)이면 실패한다★ — 회귀 감지');
{
  // 같은 조건에서 '승격 전부를 앞에 붙이고 개수로 오프셋을 민다'를 재현한다
  const sc = scoreUniverse();
  const hot = [], base = [];
  for (let i = 0; i < N; i++) ((sc.get(i) > 0) ? hot : base).push(i);
  const legacyOrder = hot.concat(base);
  let baseDone = 0;
  for (let i = 0; i < 40; i++) if (sc.get(legacyOrder[i]) === 0) baseDone++;
  const legacyAdv = Math.max(1, baseDone);
  if (legacyAdv <= 1) ok('종전 방식은 승격 ' + hot.length + '종목에 막혀 ' + legacyAdv + '칸 — 한 바퀴 ' + N + '사이클(≈9시간)');
  else bad('회귀 모의가 재현되지 않는다(전진 ' + legacyAdv + '칸) — 이 게이트의 전제를 다시 봐야 한다');
}

console.log('⑦ 설정값이 실제로 쓰이는가 · 회계가 좌표 기반인가');
{
  if (/evalOrderPlan\(orderedEval,/.test(S)) ok('사이클이 evalOrderPlan 으로 순서를 만든다');
  else bad('평가 루프가 evalOrderPlan 을 쓰지 않는다');
  if (/_evalAdv = evalOffsetAdvance\(_evalSeen, fetched\.length\)/.test(S)) ok('오프셋 전진이 evalOffsetAdvance(좌표 집합) 기반이다');
  else bad('오프셋 전진이 여전히 개수 기반이다');
  if (!/Math\.max\(1, _evalBaseDone\)/.test(S)) ok('개수로 밀던 옛 회계가 남아 있지 않다');
  else bad('★Math.max(1, _evalBaseDone) 이 살아 있다★ — 정체 버그가 그대로다');
  if (/순환 " \+ _evalAdv \+ "칸 전진/.test(S)) ok('TIME-CAP 로그가 실제 전진 칸수를 밝힌다');
  else bad('로그가 여전히 "이어서 평가"라고만 한다 — 정체를 눈으로 볼 수 없다');
  if (LIVETRIG.minScore >= 3 && LIVETRIG.maxN >= 5 && LIVETRIG.maxN <= 40 && LIVETRIG.headN <= LIVETRIG.maxN) ok('LIVETRIG 값이 안전 범위 안에 있다');
  else bad('LIVETRIG 값이 위험하다: ' + JSON.stringify(LIVETRIG));
}

console.log(fail ? '\n✘ 라운드로빈 게이트 실패 ' + fail + '건' : '\n✅ 라운드로빈 계약 통과 — 전 종목이 유한 시간 안에 평가된다');
process.exit(fail ? 1 : 0);
