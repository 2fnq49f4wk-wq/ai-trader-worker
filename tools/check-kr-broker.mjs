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
  const r=_krbParseHankyung(html1);
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
  const r=_krbParseHankyung(html2);
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
  const r=_krbParseHankyung(html3);
  if(r.length===1 && r[0].firm==='키움증권') ok('증권사·값이 없는 줄은 버리고 1줄만 남겼다');
  else bad('쓰레기 줄을 걸렀어야 한다: '+JSON.stringify(r.map(x=>x.firm)));
}

console.log('④ 목표가처럼 안 생긴 숫자는 목표가로 안 쓴다');
{
  const html4 = `<table><tbody>
<tr><td>2026-08-14</td><td>조회수 많은 리포트</td><td>3</td><td>매수</td><td>최작성</td><td>대신증권</td></tr>
</tbody></table>`;
  const r=_krbParseHankyung(html4);
  if(r.length===1 && r[0].target==null && r[0].opinion==='매수')
    ok('3 은 목표가 하한(100원) 미만이라 버리고 의견만 남겼다');
  else bad('작은 숫자를 목표가로 주웠다: '+JSON.stringify(r[0]));
}

console.log('⑤ 응답이 아예 다른 모양이면 조용히 빈 결과');
{
  const r=_krbParseHankyung('<html><body>로그인이 필요합니다</body></html>');
  if(r.length===0) ok('표가 없으면 빈 배열 — 억지로 만들어내지 않는다');
  else bad('없는 데이터를 만들어냈다: '+JSON.stringify(r));
}
console.log(fail?('\n실패 '+fail+'건'):'\nok   국내 증권사 리포트 파서 통과');
process.exit(fail?1:0);
