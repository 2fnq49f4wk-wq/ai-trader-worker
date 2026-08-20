/* ═══════════════════════════════════════════════════════════════════════════
   [V33.169] 심화 재무분석 · 동일 업종 비교 계약

   왜 이 게이트가 필요한가.
     · 업종 비교는 ★상대 위치★ 를 말한다. 방향(높을수록 좋음/나쁨)을 한 번만 틀려도
       발생액이 높은 기업이 '업종 상위' 로 뜬다 — 숫자는 그럴듯하고 뜻은 정반대다.
     · 표본이 둘인데 백분위를 말하면 그건 계산이 아니라 지어내기다.
     · 없는 재무항목을 0으로 두면 '계산했더니 나쁜 것' 과 '데이터가 없는 것' 이 같아진다.
   구현을 흉내내지 않고 함수 원문을 떼어 ★실제로 돌려서★ 확인한다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
const S = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function grab(n){ const i=S.indexOf(n); if(i<0) throw new Error('없음: '+n);
  let d=0,j=S.indexOf('{',i);
  for(;j<S.length;j++){ if(S[j]==='{')d++; else if(S[j]==='}'){d--; if(!d)break;} } return S.slice(i,j+1); }
function grabArr(n){ const i=S.indexOf(n); let d=0,j=S.indexOf('[',i);
  for(;j<S.length;j++){ if(S[j]==='[')d++; else if(S[j]===']'){d--; if(!d)break;} } return S.slice(i,j+1); }
/* 구현을 흉내내지 않는다 — 원문을 그대로 떼어 돌린다 */
const F = new Function(
  grabArr('const FUND_METRICS = [') + ';\n'
  + grab('function fundAdvanced(') + '\n'
  + grab('const PEERCMP = {') + ';\n'
  + grab('function _pctRank(') + '\n'
  + grab('function _median(') + '\n'
  + grab('function _ranks(') + '\n'
  + 'return {FUND_METRICS, fundAdvanced, PEERCMP, _pctRank, _median, _ranks};')();
let fail=0; const ok=m=>console.log('  ok   '+m); const bad=m=>{console.log('  ✘ '+m);fail++;};

// 합성 재무제표 — 값을 알고 있으므로 손계산과 대조할 수 있다
function mk(o){
  const yrs = ['2022-12-31','2023-12-31','2024-12-31','2025-12-31'];
  const f = { order: yrs, years: {} };
  yrs.forEach((y,i)=>{ f.years[y] = Object.assign({}, o.base, (o.by && o.by[i]) || {}); });
  return f;
}
const base = { TotalRevenue:1000, CostOfRevenue:600, SellingGeneralAndAdministration:150,
  GrossProfit:400, OperatingIncome:250, NetIncome:200, TotalAssets:2000,
  TotalLiabilitiesNetMinorityInterest:800, StockholdersEquity:1200, OperatingCashFlow:220,
  CashAndCashEquivalents:300, Inventory:100, AccountsPayable:80, Receivables:120,
  InterestExpense:20, TotalDebt:500 };

console.log('① 지표 산식이 논문 정의와 맞는가 (손계산 대조)');
{
  const f = mk({ base:base, by:[{TotalRevenue:800},{},{TotalAssets:1800},{}] });
  const a = F.fundAdvanced(f);
  // 영업수익성 = (1000-600-150-20)/1200 = 230/1200 = 19.17%
  if (Math.abs(a.opProf - 19.17) < 0.02) ok('영업수익성(RMW) = (매출−원가−판관비−이자)/자본 = ' + a.opProf + '%');
  else bad('opProf ' + a.opProf + ' ≠ 19.17');
  // 자산성장 = 2000/1800 - 1 = 11.11%
  if (Math.abs(a.assetGrowth - 11.11) < 0.02) ok('자산성장 = ' + a.assetGrowth + '% (2000/1800−1)');
  else bad('assetGrowth ' + a.assetGrowth);
  // NOA/A = ((2000-300)-(800-500))/2000 = (1700-300)/2000 = 70%
  if (Math.abs(a.noa - 70) < 0.02) ok('순영업자산 NOA/A = ' + a.noa + '%');
  else bad('noa ' + a.noa);
  // 발생액 = (200-220)/2000 = -1%
  if (Math.abs(a.accrual + 1) < 0.02) ok('발생액 = ' + a.accrual + '% (현금이익이 회계이익보다 큼)');
  else bad('accrual ' + a.accrual);
  // 총이익성 = 400/2000 = 20%
  if (Math.abs(a.grossProf - 20) < 0.02) ok('총이익성 GP/A = ' + a.grossProf + '%');
  else bad('grossProf ' + a.grossProf);
  // 매출 3년 CAGR: 800 → 1000, (1000/800)^(1/3)-1 = 7.72%
  if (Math.abs(a.revCagr3 - 7.72) < 0.05) ok('매출 3년 CAGR = ' + a.revCagr3 + '%');
  else bad('revCagr3 ' + a.revCagr3);
}

console.log('② 없는 항목을 0으로 두지 않는다');
{
  const noCash = JSON.parse(JSON.stringify(base)); delete noCash.CashAndCashEquivalents;
  const a = F.fundAdvanced(mk({ base:noCash }));
  if (a.noa === null) ok('현금성자산이 없으면 NOA 를 내지 않는다(0 으로 채우지 않음)');
  else bad('현금 없이 NOA 를 계산했다: ' + a.noa);
  if (a.missing.indexOf('현금성자산') >= 0) ok('무엇이 없어서 못 냈는지 남긴다: ' + a.missing.join(', '));
  else bad('결측 사유가 없다');

  const noInt = JSON.parse(JSON.stringify(base)); delete noInt.InterestExpense;
  const b = F.fundAdvanced(mk({ base:noInt }));
  if (b.opProfNoInterest === true) ok('이자비용이 없으면 그 사실을 표시한다(값은 내되 정의가 다름을 밝힌다)');
  else bad('이자비용 결측을 안 밝힌다');
}

console.log('③ ★방향★ — 낮을수록 좋은 지표가 뒤집혀 있는가');
{
  const dirs = {}; F.FUND_METRICS.forEach(m => dirs[m.k] = m.dir);
  for (const [k, want] of [['accrual',-1],['assetGrowth',-1],['noa',-1],['roaVol',-1],['leverage',-1],
                           ['cashOpProf',1],['opProf',1],['grossProf',1],['roe',1],['revCagr3',1]]) {
    if (dirs[k] === want) ok(k + ' 방향 ' + (want>0?'높을수록 좋음':'낮을수록 좋음'));
    else bad(k + ' 방향이 ' + dirs[k] + ' — ' + want + ' 여야 한다');
  }
}

console.log('④ 백분위·중앙값·순위(극단치 내성)');
{
  const arr = [1,2,3,4,5];
  if (F._median(arr) === 3) ok('중앙값 3'); else bad('중앙값 ' + F._median(arr));
  if (F._median([1,2,3,4]) === 2.5) ok('짝수 개는 가운데 둘의 평균'); else bad('짝수 중앙값 오류');
  /* ★극단치 내성★ — 값 기준 z는 극단치 하나에 끌려간다. 순위 기준인지 실제로 확인한다.
     같은 표본에 100 을 10,000 으로 바꿔도 내 z가 거의 그대로여야 한다. */
  const rk1 = F._ranks([1,2,3,4,5,6,7,8,9,100]);
  const rk2 = F._ranks([1,2,3,4,5,6,7,8,9,10000]);
  if (JSON.stringify(rk1) === JSON.stringify(rk2))
    ok('극단치를 100 → 10,000 으로 키워도 순위는 그대로 — z가 안 흔들린다');
  else bad('순위가 극단치에 흔들린다');
  const tie = F._ranks([5,5,1,9]);
  if (tie[0] === 2.5 && tie[1] === 2.5) ok('동점은 평균순위(2.5)로 처리');
  else bad('동점 처리 오류: ' + JSON.stringify(tie));
  const pr = F._pctRank([10,20,30,40,50], 30);
  if (pr === 50) ok('중앙값의 백분위 = 50'); else bad('백분위 ' + pr);
}

console.log('⑤ 표본이 모자라면 비교하지 않는다');
{
  if (F.PEERCMP.minPeers >= 3) ok('최소 표본 ' + F.PEERCMP.minPeers + '종목 — 둘로 백분위를 말하지 않는다');
  else bad('최소 표본이 ' + F.PEERCMP.minPeers);
  if (/if \(n < PEERCMP\.minPeers\) return \{ ok: false/.test(S)) ok('모자라면 ok:false 로 비교를 접는다');
  else bad('표본 부족 시에도 비교를 낸다');
  if (/전체' 같은 묶음으로 비교하면/.test(S)) ok('업종을 모르면 아예 비교하지 않는다는 근거가 적혀 있다');
}

console.log('⑥ 출처를 지표마다 달고 있는가');
{
  const noCite = F.FUND_METRICS.filter(m => !m.cite || m.cite === '');
  if (!noCite.length) ok('지표 ' + F.FUND_METRICS.length + '종 모두 출처 표기');
  else bad('출처 없는 지표: ' + noCite.map(x=>x.k).join(', '));
  for (const need of ['Ball et al. 2016 (JFE)','Fama-French 2015 (JFE)','Cooper et al. 2008 (JF)',
                      'Hirshleifer et al. 2004 (JAE)','Sloan 1996 (TAR)','Novy-Marx 2013 (JFE)']) {
    if (F.FUND_METRICS.some(m => m.cite === need)) ok('인용: ' + need);
    else bad('빠진 인용: ' + need);
  }
}
console.log('⑦ 비용 — 상세 한 번에 DB 를 훑지 않는가');
{
  /* 유니버스(약 1,000종목)를 돌며 종목마다 getState 를 부르면 상세 페이지 한 번에
     1,000회 가까운 조회가 난다. 업종은 색인 하나로 읽어야 한다. */
  const f = S.slice(S.indexOf('async function fundPeersOf('), S.indexOf('async function fundPeerCompare('));
  if (/getState\(DB, "sector_index"/.test(f)) ok('업종 색인 하나만 읽는다');
  else bad('업종 색인을 안 쓴다');
  if (!/for \(const u of universe\)/.test(f)) ok('유니버스를 훑지 않는다');
  else bad('유니버스를 종목마다 훑는다 — 상세 한 번에 DB 조회가 폭발한다');
  if (/for \(const u in SECTOR_MAP\)/.test(f)) ok('내장 분류는 메모리라 훑어도 조회 0');
  if (F.PEERCMP.maxPeers <= 30) ok('비교 표본 상한 ' + F.PEERCMP.maxPeers + ' — fund: 조회가 그만큼으로 묶인다');
  else bad('표본 상한이 ' + F.PEERCMP.maxPeers + ' 로 크다(조회 지연)');
  if (/idx\[sector\] = arr\.slice\(-200\)/.test(S)) ok('색인이 업종당 200으로 묶여 무한정 커지지 않는다');
  else bad('색인 상한이 없다');
}

console.log(fail ? '\n실패 ' + fail + '건' : '\nok   심화 재무분석 · 업종 비교 계약 통과');
process.exit(fail ? 1 : 0);
