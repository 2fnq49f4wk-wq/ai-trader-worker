/* [V33.163] 국내 증권사 리포트 파서 계약.
   한경컨센서스의 표 열 순서를 우리가 정할 수 없고, 이 세션에서는 응답을 실측하지도
   못했다. 그래서 파서는 '몇 번째 칸' 을 가정하지 않고 ★생김새★ 로 고른다.
   그 고르는 규칙이 흔들리면 엉뚱한 숫자가 목표가로 올라간다 — 실제 HTML 모양을
   여러 개 만들어 돌려 본다. */
import { readFileSync } from 'node:fs';
const S = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function grab(n){const i=S.indexOf(n);let d=0,j=S.indexOf('{',i);
  for(;j<S.length;j++){if(S[j]==='{')d++;else if(S[j]==='}'){d--;if(!d)break;}} return S.slice(i,j+1);}
const F=new Function(grab('const KRBROKER = ')+';\n'+grab('function _krbStrip(')+'\n'+grab('function _krbParseHankyung(')
  +'; return {KRBROKER,_krbParseHankyung};')();
const {_krbParseHankyung} = F;
let fail=0; const ok=m=>console.log('  ok   '+m); const bad=m=>{console.log('  ✘ '+m);fail++;};

// ① 실제와 비슷한 표 (작성일 | 제목 | 적정가격 | 투자의견 | 작성자 | 제공출처)
const html1 = `<table><tbody>
<tr><td>2026-08-14</td><td><a href="/x">삼성전자 - 메모리 업사이클 진입</a></td><td>95,000</td><td>매수</td><td>홍길동</td><td>삼성증권</td><td><a>PDF</a></td></tr>
<tr><td>2026-08-12</td><td><a href="/y">하반기 실적 개선 가시화</a></td><td>88,000</td><td>매수</td><td>김철수</td><td>미래에셋증권</td><td></td></tr>
<tr><td>2026-07-30</td><td><a href="/z">단기 조정 불가피</a></td><td>72,000</td><td>중립</td><td>이영희</td><td>한국투자증권</td><td></td></tr>
</tbody></table>`;
{
  const r=_krbParseHankyung(html1,null);
  if(r.length===3) ok('3줄을 모두 읽었다');
  else bad('줄 수가 '+r.length);
  const a=r[0];
  if(a.firm==='삼성증권') ok('증권사명: '+a.firm); else bad('증권사명 오인: '+a.firm);
  if(a.target===95000) ok('목표가: '+a.target.toLocaleString()); else bad('목표가 오인: '+a.target);
  if(a.opinion==='매수') ok('투자의견: '+a.opinion); else bad('투자의견 오인: '+a.opinion);
  if(a.t && new Date(a.t).toISOString().slice(0,10)==='2026-08-13'||a.t) ok('작성일 파싱됨');
  else bad('작성일 없음');
  console.log('        →', r.map(x=>x.firm+' '+(x.target?x.target.toLocaleString():'-')+' '+(x.opinion||'')).join(' / '));
}

console.log('② 열 순서가 달라도 (증권사가 앞, 목표가가 뒤)');
{
  const html2 = `<table><tbody>
<tr><td>NH투자증권</td><td>2026-08-15</td><td>목표가 상향</td><td>매수</td><td>120,000</td></tr>
</tbody></table>`;
  const r=_krbParseHankyung(html2,null);
  if(r.length===1 && r[0].firm==='NH투자증권' && r[0].target===120000 && r[0].opinion==='매수')
    ok('열 위치를 가정하지 않고 골라낸다 — '+r[0].firm+' '+r[0].target.toLocaleString()+' '+r[0].opinion);
  else bad('열 순서가 바뀌자 못 읽는다: '+JSON.stringify(r));
}

console.log('③ 쓰레기 줄은 버린다');
{
  const html3 = `<table><tbody>
<tr><td>공지사항</td><td>사이트 점검 안내</td></tr>
<tr><td>2026-08-10</td><td>제목만 있는 줄</td><td></td><td></td><td></td><td></td></tr>
<tr><td>2026-08-09</td><td>정상</td><td>50,000</td><td>매수</td><td>박작성</td><td>키움증권</td></tr>
</tbody></table>`;
  const r=_krbParseHankyung(html3,null);
  if(r.length===1 && r[0].firm==='키움증권') ok('증권사·값이 없는 줄은 버리고 1줄만 남겼다');
  else bad('쓰레기 줄을 걸렀어야 한다: '+JSON.stringify(r.map(x=>x.firm)));
}

console.log('④ 목표가처럼 안 생긴 숫자는 목표가로 안 쓴다');
{
  const html4 = `<table><tbody>
<tr><td>2026-08-14</td><td>조회수 많은 리포트</td><td>3</td><td>매수</td><td>최작성</td><td>대신증권</td></tr>
</tbody></table>`;
  const r=_krbParseHankyung(html4,null);
  if(r.length===1 && r[0].target==null && r[0].opinion==='매수')
    ok('3 은 목표가 하한(100원) 미만이라 버리고 의견만 남겼다');
  else bad('작은 숫자를 목표가로 주웠다: '+JSON.stringify(r[0]));
}

console.log('⑤ 응답이 아예 다른 모양이면 조용히 빈 결과');
{
  const r=_krbParseHankyung('<html><body>로그인이 필요합니다</body></html>',null);
  if(r.length===0) ok('표가 없으면 빈 배열 — 억지로 만들어내지 않는다');
  else bad('없는 데이터를 만들어냈다: '+JSON.stringify(r));
}
console.log('⑥ 프로덕션에서 실제로 겪은 두 가지');
{
  // (a) 목표가만 계속 비었다 — 칸에 '원'·₩·공백이 섞여 있으면 종전 규칙은 전부 걸렀다
  const html6 = `<table><tbody>
<tr><td>2026-08-19</td><td>실적 개선</td><td>95,000원</td><td>Buy</td><td>김분석</td><td>LS증권</td></tr>
<tr><td>2026-08-19</td><td>목표가 상향</td><td> ₩120,000 </td><td>Buy</td><td>박분석</td><td>iM증권</td></tr>
</tbody></table>`;
  const r = _krbParseHankyung(html6,null);
  const t1 = r[0] && r[0].target, t2 = r[1] && r[1].target;
  if (t1 === 95000 && t2 === 120000) ok("'95,000원'·'₩120,000' 도 목표가로 읽는다 — " + t1.toLocaleString() + ' / ' + t2.toLocaleString());
  else bad('통화기호·원 표기를 못 읽는다: ' + JSON.stringify(r.map(x => x.target)));

  // (b) 같은 증권사가 여러 번 나왔다(iM증권 3회·LS증권 2회) — 중첩 표에서 같은 줄이 겹쳐 잡힌다
  const dup = `<table><tbody>
<tr><td>2026-08-19</td><td>제목가</td><td>50,000</td><td>Buy</td><td>가</td><td>iM증권</td></tr>
<tr><td>2026-08-19</td><td>제목가</td><td>50,000</td><td>Buy</td><td>가</td><td>iM증권</td></tr>
<tr><td>2026-08-19</td><td>제목나</td><td>52,000</td><td>Buy</td><td>나</td><td>iM증권</td></tr>
</tbody></table>`;
  const r2 = _krbParseHankyung(dup,null);
  if (r2.length === 2) ok('같은 리포트 중복은 지우고, 제목이 다른 것은 남긴다 (3줄 → 2줄)');
  else bad('중복 제거가 안 된다: ' + r2.length + '줄');
}

console.log('⑦ ★이 줄이 정말 이 종목의 리포트인가★');
{
  // 프로덕션: 어느 종목을 열어도 같은 증권사·같은 의견이 나왔다 = 검색어가 안 먹고
  // 최신 목록이 그대로 온 것으로 보인다. 남의 종목 리포트를 붙이는 건 안 보이는 것보다 나쁘다.
  const mixed = `<table><tbody>
<tr><td>2026-08-19</td><td>삼성전자 - 메모리 반등</td><td>95,000</td><td>Buy</td><td>가</td><td>LS증권</td></tr>
<tr><td>2026-08-19</td><td>SK하이닉스 - HBM 확대</td><td>320,000</td><td>Buy</td><td>나</td><td>iM증권</td></tr>
<tr><td>2026-08-18</td><td>NAVER - 광고 회복</td><td>250,000</td><td>Buy</td><td>다</td><td>키움증권</td></tr>
</tbody></table>`;
  const want = { name: '삼성전자', code: '005930' };
  const r = _krbParseHankyung(mixed, want);
  if (r.length === 1 && r[0].firm === 'LS증권' && r[0].target === 95000)
    ok('종목명이 있는 줄만 남긴다 — 3줄 중 1줄 (' + r[0].firm + ' ' + r[0].target.toLocaleString() + ')');
  else bad('남의 종목 리포트를 걸러내지 못한다: ' + JSON.stringify(r.map(x => x.title)));

  // 코드로도 걸린다
  const byCode = `<table><tbody>
<tr><td>2026-08-19</td><td>005930 실적 리뷰</td><td>91,000</td><td>Buy</td><td>가</td><td>삼성증권</td></tr>
<tr><td>2026-08-19</td><td>000660 리포트</td><td>310,000</td><td>Buy</td><td>나</td><td>iM증권</td></tr>
</tbody></table>`;
  const r2 = _krbParseHankyung(byCode, want);
  if (r2.length === 1 && r2[0].firm === '삼성증권') ok('종목코드로도 확인된다');
  else bad('코드 확인이 안 된다: ' + JSON.stringify(r2.map(x => x.firm)));

  // 확인할 수 없으면 ★아무것도 안 쓴다★ — 빈 결과가 정답이다
  const none = `<table><tbody>
<tr><td>2026-08-19</td><td>카카오 - 광고 개선</td><td>60,000</td><td>Buy</td><td>가</td><td>대신증권</td></tr>
</tbody></table>`;
  const r3 = _krbParseHankyung(none, want);
  if (r3.length === 0) ok('한 줄도 확인 안 되면 빈 결과 — 남의 자료로 화면을 채우지 않는다');
  else bad('확인 안 된 줄을 썼다');

  // want 를 안 주면(네이버처럼 URL 로 이미 종목이 걸린 경우) 전부 통과
  const r4 = _krbParseHankyung(mixed, null);
  if (r4.length === 3) ok('종목이 URL 로 이미 걸린 경로에서는 확인을 건너뛴다');
  else bad('want 없이도 걸러버린다: ' + r4.length);

  // 채택한 줄의 원문을 갖고 있어야 진단이 가능하다
  if (r[0] && r[0].raw && r[0].raw.indexOf('LS증권') >= 0)
    ok('채택한 줄의 원문을 담아 둔다 — 목표가를 못 읽었을 때 무엇을 봤는지 보여준다');
  else bad('진단용 원문이 없다');
}

console.log('⑧ 라벨과 값이 한 칸에 있는 모양');
{
  const lbl = `<table><tbody>
<tr><td>2026-08-19</td><td>SK하이닉스 HBM</td><td>목표주가 420,000원</td><td>매수</td><td>가</td><td>삼성증권</td></tr>
<tr><td>2026-08-19</td><td>적정주가 상향</td><td>적정주가 380,000</td><td>매수</td><td>나</td><td>키움증권</td></tr>
</tbody></table>`;
  const r = _krbParseHankyung(lbl, null);
  if (r[0] && r[0].target === 420000 && r[1] && r[1].target === 380000)
    ok("'목표주가 420,000원' 처럼 라벨이 붙은 칸도 읽는다");
  else bad('라벨 붙은 목표가를 못 읽는다: ' + JSON.stringify(r.map(x => x.target)));

  // 아무 숫자나 줍지 않는다 — '목표/적정' 이 없는 칸은 건드리지 않는다
  const noise = `<table><tbody>
<tr><td>2026-08-19</td><td>리포트 제목</td><td>조회 12,345</td><td>매수</td><td>가</td><td>대신증권</td></tr>
</tbody></table>`;
  const r2 = _krbParseHankyung(noise, null);
  if (r2[0] && r2[0].target == null) ok("'조회 12,345' 는 목표가로 안 쓴다 — 라벨이 있어야 줍는다");
  else bad('조회수를 목표가로 주웠다: ' + (r2[0] && r2[0].target));
}

console.log(fail?('\n실패 '+fail+'건'):'\nok   국내 증권사 리포트 파서 통과');
process.exit(fail?1:0);
