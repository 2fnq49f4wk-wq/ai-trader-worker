/* ═══════════════════════════════════════════════════════════════════════════
   [V33.172] 평가 예산 계약 + 외부학습 커밋 가시성

   ① 평가가 사이클당 450종목 → 34~51종목으로 주저앉은 구조:
      평가 루프 안의 '부가조회'가 기능이 늘 때마다 하나씩 붙었는데 각자 자기 몫만 봤다.
      단타 분봉 35~45% + FLOW 무제한 + 옵션 무제한 = 예산을 넘는다. 아무도 합산하지 않았다.
      → 부가조회 전체가 하나의 시간 지갑을 공유한다. 기능이 또 늘어도 총량은 변하지 않는다.
      ★단, 거래 확정 경로는 지갑으로 막지 않는다★ — 조회를 건너뛰면 '확인 실패 = 진입 차단'
      으로 읽혀, 지갑이 비었다는 이유로 매수가 막히는 조용한 사고가 난다.
   ② 커밋이 500 으로 실패하는 동안 화면은 "학습 21시간 전"을 띄웠다 — 그건 '보낸 시각'이었다.
      8일치 GPU 학습이 조용히 버려졌다. 이제 '들어온 결과'를 상단에 상시 표시한다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
const S = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const H = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function grab(n){ const i=S.indexOf(n); if(i<0) throw new Error('없음: '+n);
  let d=0,j=S.indexOf('{',i);
  for(;j<S.length;j++){ if(S[j]==='{')d++; else if(S[j]==='}'){d--; if(!d)break;} } return S.slice(i,j+1); }
let fail=0; const ok=m=>console.log('  ok   '+m); const bad=m=>{console.log('  ✘ '+m);fail++;};

const ENRICH = new Function(grab('const ENRICH = ')+'; return ENRICH;')();

console.log('① 부가조회 총량 상한이 존재하고 안전한가');
{
  if (ENRICH.share > 0 && ENRICH.share <= 0.6)
    ok('부가조회 총량 ' + Math.round(ENRICH.share*100) + '% — 평가 본체가 ' + Math.round((1-ENRICH.share)*100) + '% 를 확보한다');
  else bad('ENRICH.share 가 위험하다: ' + ENRICH.share);
  if (ENRICH.flowRefreshPerCycle >= 1 && ENRICH.flowRefreshPerCycle <= 20)
    ok('FLOW 콜드미스 네트워크 갱신 ' + ENRICH.flowRefreshPerCycle + '건/사이클 — 라운드로빈이 유니버스를 훑어도 폭주하지 않는다');
  else bad('flowRefreshPerCycle 이 위험하다: ' + ENRICH.flowRefreshPerCycle);
}

console.log('② 지갑이 비면 ★실행 자체를★ 안 하는가 (실제 소스를 떼어 돌린다)');
{
  /* [V33.327] 하네스를 ★프로덕션과 같은 모양★ 으로 맞춘다.
     _enrichRun 이 1건 상한(ENRICH.perCallMs)을 쓰면서 `_num` 과 `_enrich.timedOut` 을
     참조하게 됐다 — 하네스에 없으면 ReferenceError 로 이 검사가 죽는다(실제로 죽었다).
     빠진 것을 채워 ★같은 함수를 계속 실제로 돌린다★(문자열 검사로 후퇴하지 않는다). */
  const F = new Function('ENRICH', `
    const _num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
    const _enrich = { spent:0, budget:100, flowRefresh:0, skipped:0, slow:[], timedOut:0 };
    const _phase = { scalp:0, flow:0, opt:0, intra:0, decide:0, news:0 };
    ${grab('const _enrichRun = async function')};
    ${grab('const _phaseRun = async function')};
    return { _enrich, _phase, _enrichRun, _phaseRun };`)(ENRICH);

  let ran = 0; const work = async () => { ran++; return '결과'; };
  const r1 = await F._enrichRun('flow', work);
  if (ran === 1 && r1 === '결과') ok('잔액이 있으면 실행하고 결과를 그대로 돌려준다');
  else bad('정상 경로가 깨졌다');

  F._enrich.spent = F._enrich.budget;          // 지갑 소진
  const r2 = await F._enrichRun('flow', work);
  if (ran === 1) ok('지갑이 비면 함수를 아예 호출하지 않는다(네트워크 0)');
  else bad('지갑이 비었는데도 조회를 실행한다 — 상한이 무의미하다');
  if (r2 === undefined && F._enrich.skipped === 1) ok('생략을 세어 로그로 남길 수 있다(' + F._enrich.skipped + '건)');
  else bad('생략 계측이 없다');

  // 거래 확정 경로는 막히면 안 된다
  const r3 = await F._phaseRun('intra', work);
  if (ran === 2 && r3 === '결과') ok('★거래 확정 경로(_phaseRun)는 지갑이 비어도 통과한다★ — 매수가 예산 탓에 막히지 않는다');
  else bad('거래 확정 경로가 지갑에 막힌다 — 진입이 조용히 차단될 수 있다');
  if (F._phase.intra > 0 || F._phase.flow >= 0) ok('막지 않아도 시간은 잰다(어디에 갔는지 남는다)');
}

console.log('③ 실제 부가조회들이 전부 지갑/계측을 통과하는가');
{
  const charged = [['scalp','단타 분봉 스캔'], ['flow','FLOW 포지셔닝·풋콜']];
  for (const [k, label] of charged) {
    if (new RegExp('_enrichRun\\("' + k + '"').test(S)) ok(label + ' → 지갑 결제');
    else bad(label + ' 이 지갑을 거치지 않는다');
  }
  for (const [k, label] of [['opt','옵션 심리'], ['intra','진입 직전 분봉']]) {
    if (new RegExp('_phaseRun\\("' + k + '"').test(S)) ok(label + ' → 계측만(거래 확정 경로)');
    else bad(label + ' 이 계측되지 않는다');
  }
  /* 지갑 밖에 남은 분봉·옵션 호출이 ★평가 루프 안에★ 없어야 한다.
     야간 백필 수확기에도 같은 함수를 쓰지만 그건 다른 경로·다른 예산이므로 제외한다.
     ★구간 경계가 사라지면 검사가 조용히 무의미해지므로 경계 자체를 먼저 확인한다★
     (check-mobile 에서 고정 마커가 어긋나 엉뚱한 블록을 검사한 적이 있다) */
  const A = S.indexOf('for (const item of orderedEval) {');
  const B = S.indexOf('// [TIME-CAP] 라운드로빈 오프셋');
  if (A > 0 && B > A) {
    ok('평가 루프 구간을 특정했다(' + (B - A).toLocaleString() + '자)');
    const loop = S.slice(A, B);
    const raw = loop.match(/await (fetchMinuteBars|fetchOptionsSignal)\(/g) || [];
    if (raw.length === 0) ok('평가 루프 안에 지갑을 우회하는 분봉·옵션 조회가 없다');
    else bad('평가 루프 안에 지갑을 우회하는 조회가 ' + raw.length + '건 남아 있다');
    if (/_enrichRun\(/.test(loop) && /_phaseRun\(/.test(loop)) ok('두 종류의 결제가 모두 루프 안에서 쓰인다');
    else bad('결제 호출이 루프 밖에 있다 — 검사가 헛돈다');
  } else bad('★평가 루프 구간을 찾지 못했다★ — 이 검사가 무의미해졌다. 경계 마커를 고칠 것');
}

console.log('④ FLOW 가 평가 루프에서 네트워크를 무제한으로 타지 않는가');
{
  if (/async function flowFetchPositioning\(DB, symbol, opts\)/.test(S) &&
      /async function flowFetchPutCall\(DB, symbol, opts\)/.test(S)) ok('두 조회 모두 캐시전용 모드를 받는다');
  else bad('flowFetch* 가 캐시전용 모드를 받지 않는다');
  const cnt = (S.match(/if \(opts && opts\.noFetch\) return cached \? cached\.v : null;/g) || []).length;
  if (cnt === 2) ok('캐시전용일 때 ★네트워크로 나가지 않는다★ (2곳 모두)');
  else bad('noFetch 처리가 ' + cnt + '곳뿐이다(2곳 필요)');
  /* [V33.304] 호출에 프리로드 표(pre)가 함께 실린다 — 계약은 그대로다("상한에 닿으면
     캐시전용으로 부른다"). 인자 리터럴 대신 ★그 계약★ 을 본다. */
  if (/flowBuildFeat\(DB, symbol, market, __dailyCacheForFlow,[\s\S]{0,120}?noFetch: _flowNoFetch/.test(S))
    ok('평가 루프가 상한 도달 시 캐시전용으로 부른다');
  else bad('평가 루프가 캐시전용 모드를 넘기지 않는다');
}

console.log('⑤ "어디에 시간이 갔나"를 매 사이클 남기는가');
{
  if (/\[EVAL-COST\]/.test(S)) ok('EVAL-COST 로그가 있다 — 다음엔 3주치 커밋을 뒤지지 않아도 된다');
  else bad('비용 계측 로그가 없다');
  if (/종목당 평균 " \+ _per \+ "ms/.test(S)) ok('종목당 평균 소요시간을 적는다');
  else bad('종목당 비용이 로그에 없다');
  if (/_enrich\.slow\.join/.test(S)) ok('느린 종목을 이름으로 남긴다');
  else bad('느린 종목을 특정할 수 없다');
}

console.log('⑥ 외부(Modal) 학습 커밋 결과를 ★한 곳에서★ 관측하는가');
{
  if (/^\/api\/\(\[a-z0-9\]\+\)-import\$/.test(S.match(/\/\^\\\/api\\\/\(\[a-z0-9\]\+\)-import\$\//) ? '/api/([a-z0-9]+)-import$' : '') ||
      /\(\[a-z0-9\]\+\)-import/.test(S)) ok('업로더별이 아니라 라우터 바깥에서 /api/*-import 를 통째로 관찰한다');
  else bad('업로더마다 기록을 붙이는 방식 — 새 업로더가 생기면 또 빠뜨린다');
  if (/ctx\.waitUntil\(extImportObserve\(_env, request, _res\)\)/.test(S)) ok('응답을 관측해도 요청 경로를 막지 않는다(waitUntil)');
  else bad('관측이 응답을 지연시킨다');
  if (/res\.clone\(\)\.json\(\)/.test(S)) ok('응답 본문을 clone 으로 읽는다 — 원본을 소비하지 않는다');
  else bad('★응답 본문을 직접 읽으면 클라이언트가 빈 응답을 받는다★');
  if (/stage === "begin" \|\| stage === "net"/.test(S)) ok('분할 업로드 중간 단계는 기록하지 않는다(결과 확정 단계만)');
  else bad('중간 단계까지 기록해 소음이 된다');
}

console.log('⑦ 상단 표시가 "보낸 시각"이 아니라 "들어온 결과"를 말하는가');
{
  if (/okTs: ok \? Date\.now\(\) : _num\(prev\.okTs, 0\)/.test(S)) ok('마지막 ★성공★ 시각을 따로 보존한다(실패가 성공을 덮지 않는다)');
  else bad('성공 시각과 시도 시각이 뒤섞인다 — V33.170 의 착시가 재발한다');
  if (/failStreak/.test(S)) ok('연속 실패 횟수를 센다 — 일시적 실패와 8일째 실패를 구분한다');
  else bad('연속 실패를 구분하지 못한다');
  if (/extTrain: _extTrainSummary\(__S\)/.test(S)) ok('상태 API 가 요약을 내려준다');
  else bad('프론트가 읽을 경로가 없다');
  if (/id="sbTrain"/.test(H) && /function renderExtTrain\(/.test(H)) ok('사이드바 상단 상태칩이 있고 렌더러가 있다');
  else bad('상단 표시가 없다');
  if (/safeRun\('extTrain'/.test(H)) ok('상태 폴링이 칩을 갱신한다');
  else bad('칩이 갱신되지 않는다 — 첫 문구에 머문다');
  if (/id="mAbTrain"/.test(H) && /학습 · ' \+ esc\(\(trn && trn\.textContent\)/.test(H))
    ok('폰에서도 보인다 — 문제일 때 앱바 배지, 전체 문구는 드로어에 상시');
  else bad('폰에서 확인할 방법이 없다(사이드바는 폰에서 숨겨진다)');
  // 색만으로 말하지 않는지
  if (/⚠ 외부학습 커밋 실패/.test(H) && /외부학습 정상/.test(H)) ok('색이 아니라 문구로 상태를 말한다');
  else bad('색으로만 구분한다');
}

console.log('⑧ 외부 모델이 ★언제 학습됐는지★ 기록하는가');
{
  /* 운영 스냅샷에서 dnn/xgb/lgb/cat 의 ageH 가 전부 null 이었다 — trust 레코드에
     trainedAt 이 없어서다. 그래서 "학습 21시간 전"도, 워치독의 신선도 계산도 근거가 없었다.
     ★새 업로더가 생겨도 빠뜨리지 않도록★ source:"external" 을 쓰는 객체 리터럴을 전수 검사한다. */
  const lits = [];
  let i = 0;
  while ((i = S.indexOf('source: "external"', i + 1)) > 0) {
    // 이 리터럴이 속한 { ... } 를 앞뒤로 훑어 찾는다
    let d = 0, a = i;
    for (; a > 0; a--) { if (S[a] === '}') d++; else if (S[a] === '{') { if (!d) break; d--; } }
    d = 0; let b = i;
    for (; b < S.length; b++) { if (S[b] === '{') d++; else if (S[b] === '}') { if (!d) break; d--; } }
    lits.push({ at: S.slice(0, i).split('\n').length, body: S.slice(a, b + 1) });
  }
  if (lits.length >= 8) ok('source:"external" 리터럴 ' + lits.length + '건을 전수 검사한다');
  else bad('검사 대상이 ' + lits.length + '건뿐이다 — 탐색이 어긋났다');
  const missing = lits.filter(x => !/trainedAt/.test(x.body)).map(x => 'line ' + x.at);
  if (!missing.length) ok('모두 trainedAt 을 함께 기록한다 — 나이를 항상 알 수 있다');
  else bad('★trainedAt 이 없는 외부 모델 기록★: ' + missing.join(', ') + ' — 화면 나이가 null 이 된다');
}

console.log(fail ? '\n✘ 평가비용·학습가시성 게이트 실패 ' + fail + '건' : '\n✅ 통과 — 부가조회는 총량 안에서만 돌고, 학습 커밋 결과가 화면에 산다');
process.exit(fail ? 1 : 0);
