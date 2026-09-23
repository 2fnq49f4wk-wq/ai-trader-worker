/* ═══════════════════════════════════════════════════════════════════════════
   [V33.176] 표본 전달 계약 — ★한 칸이 빠져 외부학습 전체가 무력화됐다★

   Modal 로그가 그대로 말한다:
     표본 고유도: 평균 0.000 · 유효 31/183948 (라벨지평 10일)
     유효표본 8/18395 → Wilson 하한 24.43% → trustFloor 영구 미달
     ③ 앙상블 valAcc 49.34% (다수클래스 베이스라인 52.9%) · AUC 0.511

   원인은 표본 부족이 아니었다. 고유도(de Prado AFML 4장)는 ★같은 종목 안에서만★
   라벨 구간 겹침을 세는데, R2 스냅샷 행에 s(종목) 가 없어 온 표본이 한 바구니에 들어갔다.
   그래서 "모든 종목의 같은 날짜"가 서로 겹치는 것으로 계산돼 유효표본이 수천분의 1이 됐다.
   D1 직접 서빙 경로에는 s 가 있었다 — V33.27 에서 R2 를 우선 경로로 만들면서 갈렸다.

   여기서 지키는 것:
     · 표본을 내보내는 ★모든 경로★ 가 같은 필드를 싣는다(한 곳만 고치면 또 갈린다)
     · 스냅샷 행 모양이 바뀌면 옛 스냅샷이 조용히 서빙되지 않는다(스키마 판)
     · 트레이너는 심볼이 없으면 조용히 0 을 만들지 않고 소리내어 말한다
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
const S = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const P = readFileSync(new URL('../trainer/modal/modal_train.py', import.meta.url), 'utf8');
let fail=0; const ok=m=>console.log('  ok   '+m); const bad=m=>{console.log('  ✘ '+m);fail++;};

console.log('① 표본을 내보내는 모든 경로가 같은 필드를 싣는가');
{
  /* out.push({ ... }) 중 x/y/pnl 을 가진 것 = 표본 행. 전수로 찾아 필드를 맞춰본다. */
  const rows = [];
  let i = 0;
  while ((i = S.indexOf('out.push({ ts:', i + 1)) > 0) {
    const end = S.indexOf('});', i);
    const body = S.slice(i, end);
    if (/x: v\.map/.test(body)) rows.push({ line: S.slice(0, i).split('\n').length, body });
  }
  if (rows.length >= 2) ok('표본 행 생성 지점 ' + rows.length + '곳을 전수 검사한다');
  else bad('표본 행 생성 지점이 ' + rows.length + '곳뿐이다 — 탐색이 어긋났다');

  /* 스트림마다 다른 것(hv / h)은 빼고, ★고유도·라벨·시장분리에 필요한 공통 필드★ 만 요구한다.
     s 가 이 목록에 있는 것이 이 게이트의 핵심이다 — 그 한 칸이 빠져 외부학습이 무력화됐다. */
  for (const f of ['ts', 'm', 's', 'x', 'y', 'pnl']) {
    const missing = rows.filter(r => !new RegExp('(^|[{,\\s])' + f + ':').test(r.body)).map(r => 'line ' + r.line);
    if (!missing.length) ok('모든 경로가 ' + f + ' 를 싣는다');
    else bad('★' + f + ' 가 빠진 경로★: ' + missing.join(', '));
  }
}

console.log('② 스냅샷 SELECT 가 필요한 열을 실제로 읽는가 (넣는 쪽만 고치면 빈 값이 들어간다)');
{
  const sel = /SELECT id, ts, market, symbol, feat, label, pnl_pct, strategy FROM ml_samples/.test(S);
  if (sel) ok('스냅샷 쿼리가 symbol 을 읽는다');
  else bad('★스냅샷 쿼리에 symbol 이 없다★ — 행에 s 를 넣어도 항상 빈 문자열이 된다');
}

console.log('③ 행 모양이 바뀌면 옛 스냅샷이 조용히 서빙되지 않는가');
{
  if (/const MLSNAP_SCHEMA = (\d+);/.test(S)) ok('스냅샷 스키마 판이 있다(' + /const MLSNAP_SCHEMA = (\d+);/.exec(S)[1] + ')');
  else bad('스키마 판이 없다 — 행 모양이 바뀌어도 옛 스냅샷이 26시간 더 서빙된다');
  const keyed = /function _mlSnapKey\(fv, part\) \{ return "ml\/v" \+ fv \+ "s" \+ MLSNAP_SCHEMA/.test(S);
  const stKeyed = /function _mlSnapStateKey\(fv\) \{ return "ml_snap:v" \+ fv \+ "s" \+ MLSNAP_SCHEMA/.test(S);
  if (keyed && stKeyed) ok('R2 키와 상태 키 ★둘 다★ 스키마 판을 포함한다');
  else bad('키 한쪽만 판을 포함한다 — 새 스키마가 옛 진행상태를 물려받는다');
  // 판을 안 거치는 옛 키가 남아 있으면 갈라진다
  if (!/"ml_snap:v" \+ (fv|LUXML)/.test(S.replace(/function _mlSnapStateKey[^\n]*\n/, '')))
    ok('스키마 판을 우회하는 옛 키 사용이 없다');
  else bad('옛 키를 직접 쓰는 곳이 남아 있다');
}

console.log('④ 트레이너가 심볼 없음을 ★조용히 넘기지 않는가★');
{
  if (/_nsym <= 1 and N > 100/.test(P)) ok('고유 심볼이 1개 이하면 감지한다');
  else bad('심볼이 없어도 그대로 고유도를 계산한다 — 0.000 이 나오고 원인은 안 보인다');
  if (/종목\(s\) 이 없다/.test(P)) ok('원인을 로그에 그대로 적는다(숫자만 보면 "표본 부족"으로 오해한다)');
  else bad('경고 문구가 없다');
  if (/UNIQ = np\.ones\(N, dtype=np\.float64\)/.test(P)) ok('그 경우 고유도 보정을 건너뛴다 — 잘못된 축소보다 균등가중이 낫다');
  else bad('감지만 하고 잘못된 값을 그대로 쓴다');
  if (/종목 \{_nsym\}개/.test(P)) ok('평상시에도 고유 심볼 수를 함께 찍는다 — 다음엔 한눈에 보인다');
  else bad('심볼 수가 로그에 없다');
}

console.log('⑤ 고유도 정의 자체는 종목별인가 (이 전제가 깨지면 위 전부가 무의미하다)');
{
  if (/by\.setdefault\(str\(SYM\[i\]\)/.test(P)) ok('_uniq_weights 가 종목별로 묶는다');
  else bad('고유도가 종목을 구분하지 않는다');
  // 재현: 심볼이 하나면 유효표본이 무너지고, 제대로 들어오면 살아난다
  const DAY = 86400000, span = 10 * DAY, n = 2000;
  const TS = [], SYM1 = [], SYMN = [];
  for (let i = 0; i < n; i++) { TS.push(Date.now() - (n - i) * DAY / 4); SYM1.push(''); SYMN.push('S' + (i % 400)); }
  const uniq = (TS, SYM) => {
    const by = new Map();
    TS.forEach((t, i) => { const k = SYM[i]; if (!by.has(k)) by.set(k, []); by.get(k).push(i); });
    let sum = 0;
    for (const idx of by.values()) {
      idx.sort((a, b) => TS[a] - TS[b]);
      for (const a of idx) sum += 1 / Math.max(1, idx.filter(b => TS[b] >= TS[a] - span && TS[b] <= TS[a] + span).length);
    }
    return sum;
  };
  const bad1 = uniq(TS, SYM1), good = uniq(TS, SYMN);
  if (bad1 < 60) ok('심볼이 없으면 유효표본 ' + bad1.toFixed(0) + '/' + n + ' — 운영에서 본 붕괴가 재현된다');
  else bad('붕괴가 재현되지 않는다(' + bad1.toFixed(0) + ') — 이 게이트의 전제를 다시 볼 것');
  if (good > bad1 * 10) ok('심볼이 들어오면 유효표본 ' + good.toFixed(0) + '/' + n + ' — ' + Math.round(good / Math.max(1, bad1)) + '배 회복');
  else bad('심볼을 넣어도 회복되지 않는다');
}

/* [V33.422] 재소급(resample) 안전장치 계약 삭제 — FLOW·XALPHA 퇴역으로 두 엔드포인트와
   표본 표가 함께 사라졌다. 지울 표본이 없으므로 지킬 계약도 없다. */

console.log(fail ? '\n✘ 표본 전달 게이트 실패 ' + fail + '건' : '\n✅ 통과 — 모든 경로가 종목을 싣고, 고유도가 무너지면 화면이 말한다');
process.exit(fail ? 1 : 0);
