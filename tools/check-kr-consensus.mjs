/* ═══════════════════════════════════════════════════════════════════════════
   [V33.166] 국내 목표주가 추출 계약 — ★표 구조를 가정하지 않는다★

   두 번 실패한 원인은 같았다: '표의 몇 번째 칸' 을 가정했다는 것.
   열 순서·칸 병합·라벨 위치는 사이트마다 다르고 예고 없이 바뀐다.
   그래서 구조를 버리고 ★'목표주가' 라는 말 바로 뒤의 숫자★ 를 찾는다.
   이 게이트는 그 방식이 여러 모양의 HTML 에서 실제로 통하는지, 그리고
   ★아무 숫자나 줍지 않는지★ 를 확인한다. 후자가 더 중요하다 —
   엉뚱한 숫자가 목표가로 올라가면 화면이 조용히 거짓말을 한다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
const S = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function grab(n){ const i=S.indexOf(n); let d=0,j=S.indexOf('{',i);
  for(;j<S.length;j++){ if(S[j]==='{')d++; else if(S[j]==='}'){d--; if(!d)break;} } return S.slice(i,j+1); }
const F = new Function(grab('const KRBROKER = ')+';\n'+grab('function _krConsensusFromHtml(')
  +'; return _krConsensusFromHtml;')();
let fail=0; const ok=m=>console.log('  ok   '+m); const bad=m=>{console.log('  ✘ '+m);fail++;};

console.log('① 여러 모양에서 목표주가를 찾는가');
{
  const shapes = [
    ['표 (라벨 칸 / 값 칸)',   '<table><tr><th>목표주가</th><td>95,000</td></tr><tr><th>현재가</th><td>71,800</td></tr></table>'],
    ['한 칸에 라벨+값',        '<div>목표주가 95,000원 · 투자의견 매수</div><div>현재가 71,800</div>'],
    ['공백이 낀 라벨',         '<span>목표 주가</span><span>95,000</span><span>종가</span><span>71,800</span>'],
    ['적정주가 표기',          '<td>적정주가</td><td>95,000</td><td>현재가</td><td>71,800</td>'],
    ['줄바꿈·태그 사이',       '<tr>\n<td class="l">목표주가</td>\n<td class="r"><b>95,000</b></td>\n</tr><td>현재가</td><td>71,800</td>'],
  ];
  for (const [nm, html] of shapes) {
    const r = F(html);
    if (r && r.tgtMean === 95000) ok(nm + ' → ' + r.tgtMean.toLocaleString());
    else { bad(nm + ' → ' + JSON.stringify(r)); }
  }
}

console.log('② 함께 딸려오는 값');
{
  const r = F('<td>목표주가</td><td>95,000</td><td>투자의견</td><td>매수</td><td>추정기관수</td><td>24</td><td>현재가</td><td>71,800</td>');
  if (r && r.ratingKey === '매수') ok('투자의견: ' + r.ratingKey); else bad('투자의견 못 읽음: ' + (r && r.ratingKey));
  if (r && r.n === 24) ok('추정기관수: ' + r.n); else bad('기관수 못 읽음: ' + (r && r.n));
  if (r && r.px === 71800) ok('현재가: ' + r.px.toLocaleString()); else bad('현재가 못 읽음: ' + (r && r.px));
}

console.log('③ ★아무 숫자나 줍지 않는다★ — 여기가 제일 중요하다');
{
  // 라벨이 목차에만 있고 값이 없는 경우 → 다음 라벨로 넘어가야 한다
  const r1 = F('<a href="#">목표주가 안내</a> <p>본 자료는 참고용입니다</p> <td>목표주가</td><td>95,000</td><td>현재가</td><td>71,800</td>');
  if (r1 && r1.tgtMean === 95000) ok('목차의 라벨은 건너뛰고 진짜 값을 찾는다');
  else bad('목차에서 멈췄다: ' + JSON.stringify(r1));

  // 라벨이 아예 없으면 아무것도 만들지 않는다
  const r2 = F('<table><tr><td>시가총액</td><td>430,000</td></tr><tr><td>거래량</td><td>12,345,678</td></tr></table>');
  if (r2 === null) ok('라벨이 없으면 null — 시가총액·거래량을 목표가로 쓰지 않는다');
  else bad('없는 목표가를 만들어냈다: ' + JSON.stringify(r2));

  // 현재가 대비 말이 안 되는 값이면 버린다(엉뚱한 숫자를 주웠다는 뜻)
  const r3 = F('<td>목표주가</td><td>50,000,000</td><td>현재가</td><td>71,800</td>');
  if (r3 === null) ok('현재가의 5배를 넘으면 버린다(50,000,000 vs 71,800)');
  else bad('말이 안 되는 목표가를 통과시켰다: ' + JSON.stringify(r3));

  // 로그인/오류 페이지
  const r4 = F('<html><body>서비스 점검 중입니다</body></html>');
  if (r4 === null) ok('점검 페이지에서는 null');
  else bad('점검 페이지에서 값을 만들었다');
}

console.log('④ ★인코딩 판정★ — 프로덕션에서 두 사이트 다 200인데 라벨을 못 찾았다');
{
  const D = new Function(grab('function _krDecode(') + '; return _krDecode;')();
  const enc = (str) => new TextEncoder().encode(str);           // UTF-8 바이트
  const utf8Page = '<html><td>목표주가</td><td>95,000</td></html>';
  const got = D(enc(utf8Page), '목표');
  if (got.indexOf('목표주가') >= 0) ok('UTF-8 문서를 UTF-8 로 읽는다');
  else bad('UTF-8 문서를 잘못 읽었다: ' + got.slice(0, 60));

  /* ★이 사례가 종전 규칙을 깨뜨렸다★ — UTF-8 을 EUC-KR 로 읽으면 대부분의 바이트쌍이
     유효한 한자로 매핑돼 U+FFFD 가 하나도 안 나온다. 그래서 "안 깨졌다" 고 판정하고
     쓰레기 해독을 그대로 썼다. */
  const euKrRead = new TextDecoder('euc-kr').decode(enc(utf8Page));
  if (euKrRead.indexOf('\uFFFD') < 0)
    ok('UTF-8 을 EUC-KR 로 읽으면 U+FFFD 가 안 나온다 — 종전 판정이 통하지 않던 이유');
  else console.log('  --   이 환경에서는 U+FFFD 가 나온다(판정 근거로는 여전히 부적절)');
  if (euKrRead.indexOf('목표주가') < 0 && got.indexOf('목표주가') >= 0)
    ok('그 쓰레기 해독에는 라벨이 없고, 새 판정은 라벨이 있는 쪽을 골랐다');
  else bad('새 판정이 여전히 잘못된 해독을 고른다');

  // 라벨이 어느 쪽에도 없으면 한글이 더 많은 쪽
  const plain = D(enc('<html>no korean here</html>'), '목표');
  if (typeof plain === 'string') ok('라벨이 없어도 문자열을 돌려준다(빈 결과로 이어진다)');
}

console.log('⑤ 전부 실패하면 어디를 두드렸는지 남긴다');
{
  /* '못 찾음' 한 마디로는 무엇을 고칠지 알 수 없다. 원인이 셋인데 조치가 각각 다르다:
     한글깨짐 → 인코딩 · 라벨없음 → 다른 소스 · 숫자 못 읽음 → 정규식.
     진단이 셋을 갈라 말하는지 확인한다. */
  for (const [t, why] of [
    ['한글깨짐(',            '인코딩 문제를 따로 말한다'],
    ['라벨없음(',            '그 페이지에 목표주가가 없다는 것을 따로 말한다'],
    ['라벨은 있으나 숫자 못 읽음', '숫자 형태 문제를 따로 말한다'],
  ]) { if (S.includes(t)) ok(why); else bad('진단이 ' + why.replace('말한다','말하지 않는다')); }
  // 소스가 여러 곳인가 — 한 곳에 목표주가가 없을 수 있다
  const nSrc = (S.match(/src: "(네이버|에프앤가이드)[^"]*"/g) || []).length;
  if (nSrc >= 4) ok('목표주가 후보 경로 ' + nSrc + '곳 — 한 곳에 없어도 다음을 본다');
  else bad('경로가 ' + nSrc + '곳뿐이다');
  if (/return tried\.length \? \{ _tried: tried \} : null;/.test(S)) ok('그 사유를 호출부로 올린다');
  else bad('사유가 버려진다');
}

console.log(fail ? '\n실패 ' + fail + '건' : '\nok   국내 목표주가 추출 계약 통과');
process.exit(fail ? 1 : 0);
