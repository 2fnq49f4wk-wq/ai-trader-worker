/* ═══════════════════════════════════════════════════════════════════════════
   [V33.173] 표본 시각 계약 — ★ts 는 '관측 시각'이지 '적재 시각'이 아니다★

   운영 스냅샷이 그대로 말했다:
     XALPHA  표본 1,921 → "퍼징 후 학습표본 0/800"
     FLOW    표본 7,788 → "퍼징 후 학습표본 298/800"
   표본은 다 모였는데 학습이 안 됐다. 퍼징(V33.141)은 ts 로 "이 학습표본의 라벨 구간(10일)이
   검증 경계를 넘느냐"를 판단하는데, 소급생성이 ts 에 Date.now() 를 찍었다 —
   몇 달치 시장을 본 표본이 전부 '오늘' 로 기록돼 ★전부가 경계를 넘는 것으로 보였다★.
   원본 행의 ts 는 손에 쥐고 있었다(날짜별로 묶는 데 이미 쓰고 있었다). 그걸 버린 것이 원인이다.

   여기서 지키는 것:
     · 표본 로거는 관측 시각을 인자로 받는다(안 주면 지금 시각으로 폴백)
     · 소급생성은 원본 행의 ts 를 반드시 물려준다 — 그러려면 쿼리가 ts 를 읽어야 한다
     · 라이브 경로는 청산 시각이 아니라 ★진입 시각★ 을 쓴다(피처를 본 시점이 그때다)
     · 퍼징이 정상 분포에서는 학습셋을 통째로 지우지 않는다(실제 퍼징 식을 떼어 확인)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
const S = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
let fail=0; const ok=m=>console.log('  ok   '+m); const bad=m=>{console.log('  ✘ '+m);fail++;};

const LOGGERS = ['flowLogSample', 'xalphaLogSample', 'stackLogSample'];

console.log('① 표본 로거가 관측 시각을 받는가');
for (const fn of LOGGERS) {
  /* [V33.227] 뒤에 인자가 더 붙어도(예: src) 계약은 그대로다 — 지켜야 하는 것은
     "★tsMs 를 받는가★" 이지 인자 개수가 아니다. 개수로 고정하면 진짜 계약과 무관한
     확장이 검사에 막히고, 그러면 검사를 느슨하게 고치고 싶어진다. */
  if (new RegExp('async function ' + fn + '\\(DB, market, symbol, featVec, pnlPct, tsMs\\b').test(S))
    ok(fn + ' 이 tsMs 를 받는다');
  else bad(fn + ' 이 여전히 적재 시각만 쓴다');
}
{
  const n = (S.match(/\.bind\(_num\(tsMs, 0\) > 0 \? _num\(tsMs, 0\) : Date\.now\(\)/g) || []).length;
  if (n === LOGGERS.length) ok('세 로거 모두 tsMs 우선 · 없으면 지금 시각으로 폴백(' + n + '/' + LOGGERS.length + ')');
  else bad('tsMs 를 실제로 INSERT 에 쓰는 곳이 ' + n + '곳뿐이다');
}

console.log('② 소급생성이 원본 행의 ts 를 물려주는가 (이게 빠지면 다시 굶는다)');
{
  const calls = [
    [/xalphaLogSample\(DB, mk, sy, f, _num\(r\.pnl_pct, 0\), _num\(r\.ts, 0\)\)/, 'XALPHA 소급생성'],
    [/flowLogSample\(DB, mk, sy, fv, _num\(r\.pnl_pct, 0\), _num\(r\.ts, 0\)\)/, 'FLOW 소급생성'],
    /* 뒤에 인자가 더 붙어도 통과시키되, ★ts 자리에 _num(r.ts, 0) 이 오는 것★ 은 그대로 요구한다.
       [V33.233] 소급생성은 적재를 묶어 보내므로 로거를 직접 부르지 않고 INSERT 문을 만들어 쌓는다
       (표본당 D1 왕복 3회가 회차 상한의 실체였다). 지켜야 하는 계약은 "원본 행의 ts 를 넘기는가"
       이지 어느 함수를 부르는가가 아니다 — 함수 이름만 넓히고 인자 자리는 그대로 못 박는다. */
    [/(?:stackLogSample|_stackInsStmt)\(DB, r\.market \|\| "us", r\.symbol \|\| null, fv, _num\(r\.pnl_pct, 0\),\s*_num\(r\.ts, 0\)[,)]/, 'STACK 소급생성']
  ];
  for (const [re, label] of calls) {
    if (re.test(S)) ok(label + ' 이 원본 ts 를 넘긴다');
    else bad(label + ' 이 원본 ts 를 버린다 — 퍼징이 다시 전부 잘라낸다');
  }
  // ts 를 넘기려면 쿼리가 읽어와야 한다 — 둘이 어긋나면 조용히 0 이 들어간다
  const sel = (S.match(/SELECT id, ts, (?:market|symbol)/g) || []).length;
  if (sel >= 2) ok('소급생성 원본 쿼리가 ts 를 읽는다(' + sel + '곳)');
  else bad('쿼리가 ts 를 읽지 않는데 ts 를 넘기고 있다 — 항상 0 이 들어간다');
}

console.log('③ 라이브 경로가 진입 시각을 쓰는가');
{
  if (/const _obsTs = _num\(pos\.opened_ts, 0\) \|\| Date\.now\(\);/.test(S))
    ok('청산 시각이 아니라 opened_ts(진입) 를 관측 시각으로 쓴다');
  else bad('청산 시각을 찍으면 라벨 지평만큼 미래로 밀려 퍼징이 오판한다');
  const n = (S.match(/LogSample\(DB, market, symbol, pos\.meta\.\w+, pnlPct, _obsTs\)/g) || []).length;
  if (n === 3) ok('세 로거 호출 모두 진입 시각을 넘긴다(' + n + '/3)');
  else bad('라이브 호출 중 ' + (3-n) + '곳이 빠졌다');
}

console.log('④ 판을 갈라 옛 표본과 섞이지 않게 했는가');
{
  const want = { FLOWML: 3, XALPHA: 3, STACKML: 4 };
  for (const k of Object.keys(want)) {
    const i = S.indexOf('const ' + k + ' = {');
    const m = /featVer: (\d+)/.exec(S.slice(i, i + 2000));
    const v = m ? +m[1] : -1;
    if (v >= want[k]) ok(k + '.featVer = ' + v + ' — 잘못 찍힌 옛 표본이 조회에서 걸러진다');
    else bad(k + '.featVer = ' + v + ' — 옛 표본이 섞여 퍼징이 다시 오판한다');
  }
}

console.log('⑤ ★퍼징이 정상 분포에서는 학습셋을 통째로 지우지 않는가★ (실제 식을 떼어 확인)');
{
  /* 퍼징 본체와 같은 식: 경계보다 라벨 구간이 뻗는 학습표본을 끝에서부터 잘라낸다 */
  const purge = (T, nvalStart, span) => {
    const bound = T[nvalStart];
    let keep = nvalStart;
    while (keep > 0 && T[keep - 1] + span > bound) keep--;
    return keep;
  };
  const DAY = 86400000, span = 10 * DAY;

  // (가) 고장난 과거: 2,000건이 하루 안에 뭉쳐 있다(Date.now() 로 찍힌 소급표본)
  {
    const T = []; for (let i = 0; i < 2000; i++) T.push(Date.now() - DAY + i * 40);
    const keep = purge(T, 1600, span);
    if (keep === 0) ok('뭉친 ts → 학습표본 0건 — 운영에서 본 "0/800" 이 이 식으로 재현된다');
    else bad('재현 실패(' + keep + '건 남음) — 이 게이트의 전제를 다시 볼 것');
  }
  // (나) 고친 뒤: 같은 2,000건이 실제 시장 6개월에 퍼진다
  {
    const T = []; for (let i = 0; i < 2000; i++) T.push(Date.now() - 180 * DAY + i * (180 * DAY / 2000));
    const keep = purge(T, 1600, span);
    const pct = Math.round(keep / 1600 * 100);
    if (keep >= 800) ok('실제 관측 시각 → 학습표본 ' + keep + '건 유지(' + pct + '%) — minN 800 을 넘는다');
    else bad('시각을 고쳐도 ' + keep + '건뿐이다 — 퍼징 자체를 다시 봐야 한다');
  }
  // (다) 경계는 지킨다 — 누출 표본은 여전히 잘린다
  {
    const T = []; for (let i = 0; i < 1000; i++) T.push(Date.now() - 180 * DAY + i * (180 * DAY / 1000));
    const keep = purge(T, 800, span);
    const bound = T[800];
    const leak = T.slice(0, keep).filter(t => t + span > bound).length;
    if (leak === 0) ok('남은 학습표본 중 검증 구간으로 새는 것이 0건 — 누출 방지는 그대로다');
    else bad('누출 표본 ' + leak + '건이 남았다 — 퍼징이 헐거워졌다');
  }
}

console.log(fail ? '\n✘ 표본 시각 게이트 실패 ' + fail + '건' : '\n✅ 통과 — 표본이 관측된 시각으로 기록되고, 퍼징이 학습셋을 굶기지 않는다');
process.exit(fail ? 1 : 0);
