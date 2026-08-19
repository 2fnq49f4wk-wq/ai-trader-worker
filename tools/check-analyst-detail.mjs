/* ═══════════════════════════════════════════════════════════════════════════
   [V33.162] 종목별 애널리스트 자료 계약 — ★추정치를 발표치인 척하지 않는다★

   사용자의 요구는 하나였다: "우리가 추측하지 말고 이미 발표난 걸로 보여줘."
   그래서 이 게이트가 지키는 것도 하나다 — 화면에 나가는 숫자의 ★출처가 분명한가★.
     · 값을 못 받으면 비운다. 대체 계산으로 칸을 메우지 않는다.
     · 어디서 왔는지(src)를 언제나 함께 내려준다.
     · '발표 원문(증권사별 등급 변경)' 과 '우리가 관측한 컨센서스 변화' 를 섞지 않는다.
     · 한국 종목 경로가 실제로 존재한다(예전엔 미국만 받아서 국내는 늘 빈칸이었다).
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
const S = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const H = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
let fail = 0;
const ok  = (m) => console.log('  ok   ' + m);
const bad = (m) => { console.log('  ✘ ' + m); fail++; };

console.log('① 발표된 것만 — 못 받으면 비운다');
{
  const f = S.slice(S.indexOf('async function analystDetail('), S.indexOf('// 포지셔닝 데이터'));
  if (/if \(!v\) \{/.test(f) && /ok: false/.test(f)) ok('자료를 못 받으면 ok:false 로 비운다');
  else bad('실패 경로가 값을 비우지 않는다');
  if (/return Object\.assign\(\{\}, cached, \{ stale: true \}\)/.test(f))
    ok('옛 값이 있으면 ★오래된 값★ 이라고 표시해 돌려준다(조용히 최신인 척하지 않는다)');
  else bad('캐시 폴백에 stale 표시가 없다');
  // 추정으로 목표가를 만들어내는 경로가 없어야 한다
  if (/tgtMean\s*=\s*[^;]*(px|price)\s*\*/.test(f)) bad('목표가를 주가에서 계산해 만들어내는 코드가 있다');
  else ok('목표가를 우리가 계산해 만들어내지 않는다');
}

console.log('② 출처를 언제나 밝힌다');
{
  for (const [t, why] of [
    ['src: "Yahoo Finance (발표 컨센서스)"', '미국 경로가 출처를 심는다'],
    ['src: "네이버 금융', '한국 경로가 출처를 심는다'],
  ]) { if (S.includes(t)) ok(why); else bad(why + ' — 없다'); }
  if (/escapeHtml\(d\.src \|\| '출처 미상'\)/.test(H)) ok('화면이 출처를 항상 적는다');
  else bad('화면에 출처 표기가 없다');
}

console.log('③ 발표 원문과 우리 관측을 섞지 않는다');
{
  if (H.includes('최근 증권사 발표') && H.includes('관측된 컨센서스 변화'))
    ok('두 블록의 제목이 서로 다르다 — 무엇이 발표이고 무엇이 관측인지 구분된다');
  else bad('발표와 관측이 같은 이름으로 묶여 있다');
  if (/이건 6시간마다 받은 공개 컨센서스 두 스냅샷의 차분이지/.test(H))
    ok('관측 블록에 "발표 문서가 아니다" 가 명시돼 있다');
  else bad('관측 블록의 성격 설명이 없다');
  // 발표 기록은 야후 upgradeDowngradeHistory 에서 그대로 온다
  if (/upgradeDowngradeHistory/.test(S) && /firm: String\(a\.firm/.test(S))
    ok('증권사별 등급 변경을 증권사명·전등급·후등급 그대로 싣는다');
  else bad('증권사별 발표 기록을 싣지 않는다');
}

console.log('④ 한국 종목 경로가 실제로 있다');
{
  if (/function anlFetchKR\(/.test(S)) ok('한국 전용 조회 함수가 있다');
  else bad('한국 경로가 없다 — 국내 종목은 늘 빈칸이 된다');
  if (/_anlIsKR\(sym\) \? await anlFetchKR\(sym\) : await anlFetchUS\(sym\)/.test(S))
    ok('.KS/.KQ 는 한국 경로로 간다');
  else bad('시장별 분기가 없다');
  const kr = S.slice(S.indexOf('async function anlFetchKR('), S.indexOf('function _anlParseKR'));
  if ((kr.match(/url:/g) || []).length >= 2) ok('공개 경로 후보를 여러 개 시도한다(한 곳이 막혀도 죽지 않는다)');
  else bad('후보 경로가 하나뿐이다');
  // 엉뚱한 키를 주웠을 때의 방어 — 이 세션에서 응답 형식을 실측하지 못했다
  const pr = S.slice(S.indexOf('function _anlParseKR'), S.indexOf('async function analystDetail'));
  if (/tgt < px \* 0\.2 \|\| tgt > px \* 5/.test(pr))
    ok('목표가가 현재가의 0.2~5배 밖이면 버린다 — 엉뚱한 키를 주웠을 때의 방어');
  else bad('한국 파서에 값 범위 검사가 없다');
}

console.log('⑤ 대시보드에서 내리고 종목 상세로 옮겼다');
{
  if (!H.includes('ANALYST TARGET REVISIONS')) ok('대시보드 패널이 제거됐다');
  else bad('대시보드에 아직 남아 있다');
  if (H.includes('id="detailAnalyst"') && H.includes('function loadDetailAnalyst()'))
    ok('종목 상세에 종목별 패널이 있다');
  else bad('종목 상세 패널이 없다');
  if (/loadDetailAnalyst\(\); \/\/ \[V33\.162\]/.test(H)) ok('종목을 열 때 함께 불린다');
  else bad('상세 진입 시 호출되지 않는다');
  // AI 반영은 그대로 살아 있어야 한다 — 화면만 옮긴 것이지 신호를 끈 게 아니다
  if (/analystRevScore\(eventData\.analystRevBySym\[dailyData\.symbol\]\)/.test(S))
    ok('AI 진입 판단의 목표가 신호는 그대로다(화면만 옮겼다)');
  else bad('AI 반영 경로가 끊겼다');
  if (/anlrev-ai/.test(H) && /AI 진입 판단에/.test(H))
    ok('그 반영 여부를 상세 패널이 말한다 — 보여주기만 하는 기능이 되지 않게');
  else bad('AI 반영 여부 표시가 사라졌다');
}

/* ⑥ 증권사별 원문 — 어디까지 가능하고 어디부터 불가능한지 코드가 알고 있는가.
   미국 IB(JP모건·골드만 등)의 리서치 원문은 유료 기관 전용이라 목표가 숫자까지는
   공개로 못 가져온다. 그 사실을 주석으로만 아는 게 아니라, ★그 회사들의 등급 변경은
   실제로 싣고 있는지★ 와 ★국내는 증권사별 목표가를 줄 단위로 싣는지★ 를 확인한다. */
console.log('⑥ 증권사별 — 되는 것은 하고, 안 되는 것은 안 되는 대로 말한다');
{
  if (/유료 기관고객 전용 포털/.test(S) && /무료 공개 API 가 없다/.test(S))
    ok('미국 IB 원문을 직접 못 가져오는 이유가 코드에 적혀 있다');
  else bad('왜 미국 IB 원문을 직접 안 쓰는지 설명이 없다');
  if (/BlackRock — 애초에 종목 목표가를 내지 않는다/.test(S))
    ok('BlackRock 은 셀사이드가 아니라는 사실이 적혀 있다(없는 자료를 만들지 않는다)');
  else bad('BlackRock 관련 설명이 없다');
  if (/function krBrokerReports\(/.test(S)) ok('국내 증권사 리포트 목록 조회가 있다');
  else bad('국내 증권사별 경로가 없다');
  if (/consensus\.hankyung\.com/.test(S)) ok('출처가 한경컨센서스(증권사명·목표가 공개)');
  else bad('국내 리포트 출처가 없다');
  if (/d\.brokers && d\.brokers\.length/.test(H) && /목표 <b>/.test(H))
    ok('화면이 증권사별 목표가를 줄 단위로 보여준다');
  else bad('증권사별 목표가를 화면에 안 보여준다');
  // 중앙값으로 대체했으면 '평균' 이라고 부르면 안 된다
  if (/v\.tgtFrom = "리포트 중앙값"/.test(S) && /d\.tgtFrom \? escapeHtml\(d\.tgtFrom\)/.test(H))
    ok('컨센서스가 아닌 값은 라벨을 바꿔 적는다 — 다른 값을 같은 이름으로 부르지 않는다');
  else bad('대체값을 컨센서스 평균인 것처럼 표시한다');
  // 극단치 방어
  if (/ts2\[Math\.floor\(ts2\.length \/ 2\)\]/.test(S))
    ok('대표값은 평균이 아니라 중앙값 — 한두 곳의 극단치가 끌고 가지 않게');
  else bad('대표값 계산이 중앙값이 아니다');
}

/* ⑦ 종목 상세의 빈 여백 — 뉴스가 남는 공간을 떠안지 않는가.
   .detail-news{flex:1 1 auto} 는 사이드바가 짧던 시절의 규칙이었다. 목표가 패널이
   들어가 사이드바가 길어지자 그 차이만큼을 빈 뉴스 상자가 통째로 떠안았다
   (실측 1550px: 상자 안 빈칸 148px → 5px, 그 높이는 차트가 가져갔다 520 → 663px). */
console.log('⑦ 종목 상세 — 남는 높이를 빈 상자가 아니라 차트가 가져가는가');
{
  const flat = H.replace(/\s+/g, '');
  if (flat.includes('.detail-left.detail-news{flex:0 0auto;}'.replace(/\s/g, '')))
    ok('뉴스는 내용만큼만 차지한다(남는 높이를 떠안지 않는다)');
  else bad('뉴스가 아직 남는 공간을 흡수한다 — 빈 상자가 생긴다');
  if (flat.includes('.detail-main.detail-chart{flex:1 1auto;height:auto;'.replace(/\s/g, '')))
    ok('남는 높이는 차트가 가져간다 — 여백을 쓸모 있는 것으로 채운다');
  else bad('차트가 남는 높이를 안 가져간다');
  if (/\.detail-side\{ max-height:min\(84vh, 860px\); overflow-y:auto; \}/.test(H))
    ok('사이드바가 끝없이 길어지지 않게 화면 안에서 묶고 안에서 스크롤한다');
  else bad('사이드바에 높이 상한이 없다 — 차트도 같이 끝없이 늘어난다');
  if (/@media \(min-width:901px\)\{[\s\S]{0,600}?\.detail-left \.detail-news/.test(H))
    ok('이 규칙은 901px 이상에서만 — 폰은 세로로 쌓이므로 건드리지 않는다');
  else bad('폰까지 닿는 규칙이다');
}

console.log(fail ? '\n실패 ' + fail + '건' : '\nok   종목별 애널리스트 자료 계약 통과');
process.exit(fail ? 1 : 0);
