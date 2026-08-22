/* ═══════════════════════════════════════════════════════════════════════════
   [V33.156] 폰 화면 계약 — "폰만 바뀐다"와 "접어도 안 사라진다"를 코드에서 확인한다.

   왜 게이트가 필요한가.
     ① 이 파일의 폰 규칙은 지금까지 세 군데로 흩어져 있었고, V33.148·V33.153 에서
        "고쳤는데 안 바뀐다" 가 두 번 났다. 원인은 매번 ★뒤에 있는 규칙이 이겼다★ 였다.
        그래서 폰 블록이 마지막 발언권을 갖는지를 소스 순서로 직접 확인한다.
     ② 사용자 요구가 "아이패드·PC 는 지금과 똑같이" 였다. 폰 규칙이 미디어쿼리
        밖으로 한 줄이라도 새면 그 약속이 깨진다 — 중괄호를 세어 확인한다.
     ③ 안전영역: viewport-fit=cover 를 켠 뒤로 셸 여백과 바 높이가 어긋나면
        ★설치했을 때만★ 본문이 노치·홈바에 깔린다. 웹에서는 안 보이는 종류의 버그라
        눈으로 못 잡는다. 두 값이 같은 토큰에서 나오는지 식으로 확인한다.
     ④ 아코디언: 2,450px 글벽을 접었다. "접었다"가 "지웠다"가 되면 안 된다 —
        함수를 실제로 ★돌려서★ 내용 노드가 하나도 안 사라지는지 센다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';

const H = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
let fail = 0;
const ok  = (m) => console.log('  ok   ' + m);
const bad = (m) => { console.log('  ✘ ' + m); fail++; };
const eq  = (a, b, m) => (a === b ? ok(m + ' (' + a + ')') : bad(m + ' — ' + a + ' ≠ ' + b));

/* ── ① 폰 블록이 소스의 마지막 발언권을 갖는가 ───────────────────────────── */
console.log('① 소스 순서 — 폰 규칙의 마지막 발언권');
const PH = '[V33.156] 폰 전용 셸 정리';
const iPh = H.indexOf(PH);
if (iPh < 0) bad('V33.156 폰 블록을 찾지 못했다');
else {
  const own = H.indexOf('@media (max-width:767px){', iPh);   // 이 블록 자신의 미디어쿼리
  const later = [];
  const re = /@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)/g;
  let m;
  while ((m = re.exec(H))) if (Number(m[1]) <= 767 && m.index > own) later.push(m[1] + 'px@' + m.index);
  if (later.length) bad('폰 블록 뒤에 또 다른 좁은폭 규칙이 있다(순서로 진다): ' + later.join(', '));
  else ok('≤767px 미디어쿼리 중 V33.156 블록이 가장 뒤 — 순서로 이긴다');
}

/* ── ② 폰 규칙이 미디어쿼리 밖으로 새지 않는가 ──────────────────────────── */
console.log('② 격리 — 아이패드(768px~)는 이 블록을 한 줄도 읽지 않는다');
{
  const start = H.indexOf('@media (max-width:767px){', iPh);
  if (start < 0) bad('폰 블록의 미디어쿼리 시작을 찾지 못했다');
  else {
    // 중괄호를 세어 블록의 끝을 정확히 찾는다(주석 안의 괄호는 없다 — /* */ 를 먼저 지운다)
    const body = H.slice(start);
    const clean = body.replace(/\/\*[\s\S]*?\*\//g, (s) => ' '.repeat(s.length));
    let d = 0, end = -1;
    for (let i = clean.indexOf('{'); i < clean.length; i++) {
      if (clean[i] === '{') d++;
      else if (clean[i] === '}') { d--; if (d === 0) { end = i; break; } }
    }
    if (end < 0) bad('폰 블록의 중괄호가 닫히지 않았다');
    else {
      const inside = H.slice(start, start + end + 1);
      ok('폰 블록은 ' + inside.split('\n').length + '줄짜리 단일 미디어쿼리로 닫힌다');
      // 이 블록에서만 쓰는 이름들이 블록 ★밖★ 에 선언되어 있지 않은지
      const outside = H.slice(0, start) + H.slice(start + end + 1);
      for (const sel of ['--m-sat', '--m-sab', '--m-top:', '--m-bot:', '.m-acc-h{', '.m-acc-b{']) {
        if (outside.includes(sel)) bad('폰 전용 토큰/선택자가 미디어쿼리 밖에도 있다: ' + sel);
      }
      ok('폰 전용 토큰(--m-sat/--m-sab/--m-top/--m-bot)과 .m-acc 규칙은 블록 안에만 있다');
      globalThis.__PHONE_BLOCK = inside;
    }
  }
}

/* ── ③ 안전영역 산술 — 셸 여백 == 바 높이 ───────────────────────────────── */
console.log('③ 안전영역 — 셸 여백과 바 높이가 같은 토큰에서 나오는가');
{
  const B = globalThis.__PHONE_BLOCK || '';
  const grab = (re) => { const m = B.match(re); return m ? m[1].replace(/\s+/g, '') : null; };
  const abH  = grab(/--m-ab-h:\s*([^;]+);/);
  const tbH  = grab(/--m-tb-h:\s*([^;]+);/);
  const top  = grab(/--m-top:\s*([^;]+);/);
  const bot  = grab(/--m-bot:\s*([^;]+);/);
  const sPT  = grab(/\.shell\{[^}]*padding-top:\s*([^;]+);/);
  const sPB  = grab(/\.shell\{[^}]*padding-bottom:\s*([^;]+);/);
  const aH   = grab(/\.m-appbar\{\s*height:\s*([^;]+);/);
  const tH   = grab(/\.m-tabbar\{\s*height:\s*([^;]+);/);
  eq(top, 'calc(var(--m-ab-h)+var(--m-sat))', '--m-top = 앱바 본문 + 노치');
  eq(bot, 'calc(var(--m-tb-h)+var(--m-sab))', '--m-bot = 탭바 본문 + 홈바');
  eq(sPT, 'var(--m-top)', '셸 상단여백이 --m-top');
  eq(aH,  'var(--m-top)', '앱바 높이가 --m-top');
  eq(sPB, 'var(--m-bot)', '셸 하단여백이 --m-bot');
  eq(tH,  'var(--m-bot)', '탭바 높이가 --m-bot');
  if (sPT === aH && sPB === tH) ok('여백과 높이가 ★같은 식★ 이라 어긋날 수 없다 (' + abH + '/' + tbH + ' + 안전영역)');
  else bad('여백과 높이가 다른 식이다 — 설치 시 본문이 바에 깔린다');
  /* [V33.157] 토큰의 ★정의는 전역 한 곳★ 이어야 한다.
     V33.156 은 이 정의를 폰 미디어쿼리 안에 뒀다. 그래서 768px 부터인 아이패드는
     여백을 한 픽셀도 못 받았고, 같은 판에서 켠 viewport-fit=cover 가 본문을 상태바
     밑으로 밀어 넣어 ★홈 화면에 추가했을 때만★ 시각·배터리가 화면을 덮었다.
     같은 실수가 되풀이되지 않게, '정의는 전역 / 폰은 참조' 를 형태로 못박는다. */
  const G = H.slice(0, H.indexOf(PH));                       // 폰 블록 앞부분(전역 영역)
  for (const [g, m2, side] of [['--lux-sat','--m-sat','top'], ['--lux-sab','--m-sab','bottom'],
                               ['--lux-sal','--m-sal','left'], ['--lux-sar','--m-sar','right']]) {
    if (!new RegExp(g + ':\\s*env\\(safe-area-inset-' + side + ',\\s*0px\\)').test(G))
      bad(g + ' 전역 정의가 env(safe-area-inset-' + side + ', 0px) 형태가 아니다');
    if (!new RegExp(m2 + ':\\s*var\\(' + g + '\\)').test(B))
      bad(m2 + ' 가 전역 토큰 ' + g + ' 를 참조하지 않는다 — 정의가 두 벌이 된다');
  }
  ok('안전영역 토큰 4종: 전역에서 env(…, 0px) 로 한 번 정의하고 폰은 참조만 한다');
  // 아이패드·PC 도 그 여백을 실제로 ★쓰는가★ (정의만 하고 안 쓰면 V33.156 과 같은 상태다)
  const wide = G.match(/@media \(min-width:768px\)\{[\s\S]{0,400}?\}/);
  const wideTxt = wide ? wide[0].replace(/\s+/g, '') : '';
  for (const t of ['padding-top:var(--lux-sat)', 'padding-bottom:var(--lux-sab)',
                   'padding-left:var(--lux-sal)', 'padding-right:var(--lux-sar)']) {
    if (!wideTxt.includes(t)) bad('768px 이상에서 셸이 ' + t + ' 를 쓰지 않는다 — 아이패드 설치형이 상태바에 가려진다');
  }
  ok('아이패드·PC(≥768px) 셸이 안전영역 네 방향을 모두 여백으로 쓴다');
  // '마법의 최소값' 금지 — 겹치지 않는 기기에 죽은 공간을 만든다
  if (/--lux-sat:\s*max\(/.test(G)) bad('전역 상단 인셋에 최소값이 박혀 있다 — 겹치지 않는 화면에 죽은 여백이 생긴다');
  else ok('인셋에 상수 최소값을 박지 않았다 — 안 겹치는 기기에서는 0 이 정답이다');
  // 상태바 글자색: black-translucent 는 라이트 테마에서 흰 글자가 되어 안 보인다
  if (/apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/.test(H))
    bad('상태바 스타일이 black-translucent — 라이트 테마에서 시각·배터리가 흰 글자로 사라진다');
  else ok('상태바 스타일이 black-translucent 가 아니다(라이트 테마에서도 읽힌다)');
  // 하단 고정물이 탭바 위에 있는가
  if (/\.toast,\s*#luxBuildBanner\{\s*bottom:calc\(var\(--m-bot\)/.test(B.replace(/\s+/g, ' ').replace(/ \{/g, '{')))
    ok('토스트·판 배너가 탭바 위로 올라간다(가려서 못 누르는 일 없음)');
  else bad('하단 고정물이 탭바 위로 올라가지 않는다');
}

/* ── ④ 아코디언 — 부르는 곳이 한 곳인가 ─────────────────────────────────── */
console.log('④ 아코디언 호출 — 그리는 경로가 둘인데 한 곳에서만 건다');
{
  const calls = (H.match(/mobAiAccordion\(\);/g) || []).length;
  eq(calls, 1, '호출 지점 수(정의 제외)');
  const putIdx = H.indexOf('    put(h);');
  const callIdx = H.indexOf('mobAiAccordion();');
  if (putIdx > 0 && callIdx > putIdx && callIdx - putIdx < 600)
    ok('호출이 put(h) 직후 — aiModePaint·loadLive 두 경로 모두 이 지점을 지난다');
  else bad('호출이 공용 페인트(put) 직후가 아니다 — 한 경로에서만 접힘이 살아남는다');
}

/* ── ⑤ 아코디언을 ★실제로 돌려★ 내용이 사라지지 않는지 센다 ──────────────── */
console.log('⑤ 아코디언 동작 — 접기이지 지우기가 아님을 실행으로 확인');
{
  // 함수 원문을 그대로 떼어내 최소 DOM 위에서 돌린다(구현을 흉내내지 않는다)
  const s = H.indexOf('function mobAiAccordion(){');
  if (s < 0) bad('mobAiAccordion 원문을 찾지 못했다');
  else {
    let d = 0, e = -1;
    for (let i = H.indexOf('{', s); i < H.length; i++) {
      if (H[i] === '{') d++; else if (H[i] === '}') { d--; if (d === 0) { e = i; break; } }
    }
    const src = H.slice(s, e + 1);

    /* 최소 DOM — 이 함수가 쓰는 것만 구현한다 */
    class N {
      constructor(tag){ this.tagName=tag; this.children=[]; this.parentNode=null; this.className='';
        this.attrs={}; this.type=''; this._txt=''; this._h=''; this._ls=[];
        this.classList={ add:(c)=>{ if(!this.className.split(' ').includes(c)) this.className=(this.className+' '+c).trim(); },
          contains:(c)=>this.className.split(' ').includes(c),
          toggle:(c)=>{ const on=!this.classList.contains(c);
            this.className = on ? (this.className+' '+c).trim() : this.className.split(' ').filter(x=>x!==c).join(' ');
            return on; } };
      }
      get firstChild(){ return this.children[0]; }
      set textContent(v){ this._txt=String(v); }
      get textContent(){ return this.children.length ? this.children.map(c=>c.textContent).join('') : this._txt; }
      set innerHTML(v){ this._h=String(v); this.children=[];
        // 이 코드가 넣는 innerHTML 은 '<b></b><span class="m-acc-n"></span><i>▾</i>' 하나뿐
        const mm=String(v).match(/<(\w+)(?:\s+class="([^"]*)")?[^>]*>/g)||[];
        for(const t of mm){ const g=/<(\w+)(?:\s+class="([^"]*)")?/.exec(t);
          const c=new N(g[1].toUpperCase()); c.className=g[2]||''; c.parentNode=this; this.children.push(c); } }
      get innerHTML(){ return this._h; }
      appendChild(c){ if(c.__frag){ for(const k of c.children.slice()){ k.parentNode=this; this.children.push(k); } c.children=[]; return c; }
        if(c.parentNode) c.parentNode.children=c.parentNode.children.filter(x=>x!==c);
        c.parentNode=this; this.children.push(c); return c; }
      setAttribute(k,v){ this.attrs[k]=String(v); }
      getAttribute(k){ return Object.prototype.hasOwnProperty.call(this.attrs,k)?this.attrs[k]:null; }
      addEventListener(t, f){ this._ls.push({ t, f }); }
      closest(sel){ const c=sel.replace(/^\./,''); let n=this;
        while(n){ if(n.classList && n.classList.contains(c)) return n; n=n.parentNode; } return null; }
      _fire(target){ for(const l of this._ls) if(l.t==='click') l.f({ target }); }
      _all(out=[]){ for(const c of this.children){ out.push(c); c._all(out); } return out; }
      querySelector(sel){ return this.querySelectorAll(sel)[0]||null; }
      querySelectorAll(sel){
        const cls=sel.replace(/^\./,''), tag=sel.toUpperCase();
        return this._all().filter(n=> sel.startsWith('.') ? n.classList.contains(cls) : n.tagName===tag);
      }
    }
    const host = new N('DIV');
    host.setAttribute('id','mobAiMode');
    const mkNode=(cls,txt)=>{ const n=new N('DIV'); n.className=cls; n.textContent=txt; return n; };
    const mkTbl=(rows)=>{ const t=new N('TABLE'); t.className='tbl';
      for(let i=0;i<rows;i++) t.appendChild(new N('TR')); return t; };
    /* 배지 1 + (제목 + 표) × 3 + 진단 1 */
    const badge=mkNode('badge','◉ AI 자율운용'); host.appendChild(badge);
    const SECT=[['시장 국면',3],['위원회 10/11 가동',6],['AI 픽',2]];
    const contents=[];
    for(const [t,r] of SECT){ host.appendChild(mkNode('k',t)); const tb=mkTbl(r); contents.push(tb); host.appendChild(tb); }
    const diag=mkNode('diag','진단'); contents.push(diag); host.appendChild(diag);
    const before = host._all().length;

    const doc = { createElement:(t)=>new N(t.toUpperCase()),
      createDocumentFragment:()=>{ const f=new N('#fragment'); f.__frag=true; return f; } };
    const $id = (id) => (id === 'mobAiMode' ? host : null);
    if (!/\bvar MACC = null;/.test(H)) bad('MACC(열림 상태 기억) 선언을 찾지 못했다');
    const fn = new Function('document', '$id', 'var MACC = null;\n' + src + '\nreturn mobAiAccordion;')(doc, $id);
    fn();

    const secs = host.querySelectorAll('.m-acc');
    eq(secs.length, 3, '섹션 수');
    // 내용 노드가 전부 살아 있는가 (배지 + 표 3 + 진단)
    const still = [badge, ...contents].filter(n => host._all().includes(n)).length;
    eq(still, 1 + contents.length, '원래 내용 노드가 남아 있는 개수');
    const rowsAfter = host.querySelectorAll('TR').length;
    eq(rowsAfter, 3 + 6 + 2, '표의 줄 수(접어도 DOM 에 그대로)');
    // 배지는 첫 섹션 앞 — 항상 보인다
    if (host.children[0] === badge) ok('첫 .k 앞의 배지는 접히지 않고 항상 보인다');
    else bad('배지가 섹션 안으로 들어갔다 — 접으면 상태 요약이 사라진다');
    // 첫 섹션만 펼침
    const open = secs.map(s => s.classList.contains('open'));
    if (open[0] && !open[1] && !open[2]) ok('첫 회 기본값 — 첫 섹션만 펼침, 나머지 접힘');
    else bad('기본 펼침 상태가 [true,false,false] 가 아니다: ' + JSON.stringify(open));
    // 제목에 줄 수가 적혀 있는가(접힌 채로도 무엇이 들었는지 보인다)
    const ns = secs.map(s => (s.querySelector('.m-acc-n') || {}).textContent);
    if (ns[0] === '3줄' && ns[1] === '6줄') ok('접힌 섹션도 줄 수를 표시한다 — ' + ns.join(' / '));
    else bad('섹션 줄 수 표기가 없다: ' + JSON.stringify(ns));

    /* 재페인트(2분 폴링) — 열림 상태가 제목으로 기억되는가.
       ★DOM 을 직접 토글하지 않고 실제 클릭 경로를 태운다★ — 기억(MACC)을 갱신하는 것은
       클릭 핸들러이지 class 가 아니다. 직접 토글하면 게이트가 '기억이 있다'고 착각한다. */
    host._fire(secs[2].querySelector('.m-acc-h'));   // 사용자가 'AI 픽' 을 펼쳤다
    host._fire(secs[0].querySelector('.m-acc-h'));   // 그리고 '시장 국면' 을 접었다
    const afterClick = host.querySelectorAll('.m-acc').map(s => s.classList.contains('open'));
    if (afterClick[0] === false && afterClick[2] === true) ok('제목을 누르면 열고 닫힌다 ' + JSON.stringify(afterClick));
    else bad('제목 클릭이 동작하지 않는다: ' + JSON.stringify(afterClick));

    // 서버가 새 값을 내려 innerHTML 이 통째로 갈린 상황을 그대로 재현한다
    host.children = [];
    host.appendChild(mkNode('badge','◉ AI 자율운용'));
    for(const [t,r] of SECT){ host.appendChild(mkNode('k',t)); host.appendChild(mkTbl(r)); }
    fn();
    const open2 = host.querySelectorAll('.m-acc').map(s => s.classList.contains('open'));
    if (open2[2] === true && open2[0] === false) ok('다시 그려도 사용자가 펼친 섹션이 유지된다 ' + JSON.stringify(open2));
    else bad('재페인트에서 펼침 상태가 초기화됐다: ' + JSON.stringify(open2));
    void before;
  }
}

/* ── ⑥ 설치형에서 새 판으로 가는 길 ─────────────────────────────────────────
   앱(standalone)에는 주소창의 새로고침이 없다. V33.156 에서 앱을 만든 순간
   판 갱신 경로가 10분 폴링 배너 ★하나뿐★ 이 되었고, 앱은 대개 종료되지 않고
   '복귀' 하므로 그 10분을 통째로 기다려야 했다. 갈래가 여럿이어도 실제 새로고침
   동작은 한 곳에만 있어야 한다 — 갈라지면 한 갈래만 캐시를 안 비운다. */
console.log('⑥ 새 판 경로 — 갈래는 셋, 동작은 한 곳');
{
  const impl = (H.match(/function luxHardReload\(/g) || []).length;
  eq(impl, 1, '새로고침 구현 개수');
  const body = H.slice(H.indexOf('function luxHardReload('), H.indexOf('window.luxHardReload'));
  for (const [need, why] of [
    ['caches.delete',                  '서비스워커 캐시를 비운다'],
    ["postMessage('lux-skip-waiting')", '대기 중인 새 워커를 인수시킨다'],
    ['location.replace',               '쿼리스트링을 바꿔 캐시를 우회한다'],
    ['setTimeout(go, 1500)',           '캐시 API 가 멎어도 반드시 이동한다'],
  ]) { if (body.includes(need)) ok(why); else bad('새로고침이 ' + why + ' — 그 단계가 빠졌다'); }

  const routes = [
    ["$id('btnUpdate')",                    '① 버튼(사이드바·드로어)'],
    ["addEventListener('visibilitychange'", '② 앱 복귀 시 자동 확인'],
    ['initPullRefresh()',                   '③ 당겨서 새로고침'],
  ];
  for (const [t, nm] of routes) { if (H.includes(t)) ok(nm + ' 존재'); else bad(nm + ' 가 없다'); }
  if (H.includes('id="btnUpdate"') && H.includes('data-proxy=\"btnUpdate\"'))
    ok('버튼이 아이패드·PC(사이드바)와 폰(드로어) 양쪽에 있다');
  else bad('새 버전 버튼이 한쪽 화면에만 있다');

  // 당겨서 새로고침은 설치형에서만 — 웹에는 주소창 새로고침이 있고 브라우저 제스처와 겹친다
  const gate = H.slice(H.indexOf('var standalone = false;'), H.indexOf('initPullRefresh();') + 20);
  if (/matchMedia\('\(display-mode: standalone\)'\)/.test(gate) && /if\(standalone && 'ontouchstart' in window\)/.test(gate))
    ok('당겨서 새로고침은 설치형 + 터치일 때만 붙는다(웹은 손대지 않는다)');
  else bad('당겨서 새로고침이 웹에도 붙는다');

  // 가로 스와이프(표)와 섞이지 않는가 — 이 조건이 없으면 표를 옆으로 밀 때마다 오작동한다
  const ptr = H.slice(H.indexOf('function initPullRefresh()'), H.indexOf("document.addEventListener('touchend', end"));
  if (/Math\.abs\(dx\) > Math\.abs\(dy\)/.test(ptr)) ok('가로 성분이 더 크면 남의 제스처로 넘긴다(표 가로 스크롤 보호)');
  else bad('가로 스와이프와 당김을 구분하지 않는다');
  if (/scrollTop > 0/.test(ptr)) ok('본문 맨 위에서만 반응한다');
  else bad('스크롤 도중에도 당김이 걸린다');

  // 판이 그대로면 보고 있던 화면을 날리지 않는다
  if (/if\(!srv \|\| srv === mine\)\{ try\{ if\(typeof loadLive === 'function'\) loadLive\(false\); \}catch\(e\)\{\} \}/.test(H))
    ok('판이 같으면 새로고침 대신 데이터만 다시 부른다(보던 화면을 안 날린다)');
  else bad('판이 같아도 화면을 통째로 새로고침한다');
}

/* ── ⑦ 스크롤 컨테이너의 자식은 줄어들지 않는다 ────────────────────────────
   .page 는 세로 flex + overflow-y:auto 다. flex 자식 기본값이 flex-shrink:1 이라
   내용이 넘치면 브라우저가 자식을 ★줄인다★. 평소엔 삐져나와 티가 안 나다가,
   애플 재질과 함께 들어간 overflow:hidden 이 줄어든 만큼을 그대로 잘라냈다.
   실측(1024×768, 보유 9종목): #positionsBox 내용 289px → 상자 51px — 보유 종목이
   통째로 사라졌다. 요소마다 flex:0 0 auto 를 붙이는 대신 규칙 하나로 못박는다. */
console.log('⑦ 눌린 상자 — 스크롤 컨테이너의 자식은 줄지 않는다');
{
  if (/html:root \.page > \*\{ flex-shrink:0; \}/.test(H))
    ok('.page 의 모든 직계 자식에 flex-shrink:0 (요소별 땜질이 아니라 규칙)');
  else bad('.page > * 의 flex-shrink 를 막지 않았다 — 넘치면 자식이 눌려 잘린다');
  // 이 규칙은 전역이어야 한다 — 폰 블록 안에 있으면 아이패드·PC 가 또 눌린다
  const g = H.slice(0, H.indexOf(PH));
  if (/html:root \.page > \*/.test(g)) ok('폰 전용이 아니라 전 폭 공통이다');
  else bad('flex-shrink 규칙이 폰 블록 안에 있다 — 아이패드·PC 에서 같은 증상이 남는다');
  // flex-grow 는 건드리지 않아야 한다(높이를 채우는 자식이 있다)
  if (/html:root \.page > \*\{ flex-shrink:0; \}/.test(H) && !/\.page > \*\{[^}]*flex-grow/.test(H))
    ok('flex-grow 는 손대지 않는다 — 높이를 채우려 flex:1 을 쓴 자식은 그대로 동작한다');
}

/* ── ⑧ 인트로는 레이아웃을 움직이지 않는다 ────────────────────────────────
   제목이 letter-spacing 을 18px→8px 로 애니메이션했다. 레이아웃 속성이라 프레임마다
   글자 폭이 재계산되며 좌우로 떨렸고, 가운데 정렬 flex 라 그 폭이 상자 폭이 되어
   ★이웃한 로고까지★ 좌우로 밀었다. 원인 하나가 증상 둘을 만들었다. */
console.log('⑧ 인트로 — 합성만 하고 레이아웃은 건드리지 않는가');
{
  const intro = H.slice(H.indexOf('.intro-text-box{'), H.indexOf('/* ── 셸 레이아웃 ── */'));
  const kf = H.slice(H.indexOf('@keyframes spacexTitleIn'), H.indexOf('@keyframes spacexSubIn') + 200);
  for (const prop of ['letter-spacing', 'width', 'margin', 'padding', 'font-size', 'text-indent']) {
    if (new RegExp('@keyframes[^}]*' + prop, 'm').test(kf) || kf.split('\n').some(l => l.includes(prop)))
      bad('인트로 키프레임이 레이아웃 속성(' + prop + ')을 애니메이션한다 — 글자와 로고가 흔들린다');
  }
  ok('인트로 키프레임에 레이아웃 속성이 없다 (opacity·transform·filter 만)');
  if (/\.intro-star-logo\{[^}]*flex:0 0 auto/.test(intro) || /\.intro-star-logo\{[^}]*flex:0 0 auto/.test(H))
    ok('로고 폭이 고정 — 이웃 폭 변화에 끌려다니지 않는다');
  else bad('로고에 폭 고정이 없다');
  if (/prefers-reduced-motion:reduce\)\{\s*\.intro-star-logo/.test(H.replace(/\s+/g, ' ').replace(/\) \{/g, '){')))
    ok('움직임 최소화 설정에서는 등장만 하고 움직이지 않는다');
  else bad('인트로가 prefers-reduced-motion 을 무시한다');
}

/* ── ⑨ 보는 행위가 거래를 일으키지 않는다 ────────────────────────────────
   화면을 열면 2초 뒤 POST /api/tick 이 나갔고, 그 끝은 runTradingCycle — 주문까지
   나가는 전체 사이클이다. 서버 cron 이 이미 매 1분 같은 것을 돌린다. 앱(PWA)에서는
   복귀·새로고침이 잦아 예정에 없던 사이클이 더 늘어난다. */
console.log('⑨ 자동 거래 트리거 — 화면을 여는 것만으로 돌지 않는가');
{
  if (/setTimeout\(function\(\) \{\s*runNow\(\);\s*\}, 2000\);/.test(H))
    bad('부팅 2초 뒤 runNow() 자동 호출이 남아 있다 — 보는 행위가 거래를 일으킨다');
  else ok('부팅 시 자동 runNow() 호출이 없다');
  const calls = (H.match(/(^|[^.\w])runNow\(\)/gm) || []).length;   // 정의 1 + 버튼 바인딩 1
  if (calls <= 2) ok('runNow 호출 지점 ' + calls + '개 — 사람이 누르는 경로만 남았다');
  else bad('runNow 호출이 ' + calls + '군데다 — 자동 경로가 또 있다');
}

/* ── ⑩ 아이패드는 env() 가 거짓말을 한다 ─────────────────────────────────
   노치가 없어 safe-area-inset-top 이 0 인데 상태바는 본문 위에 그려진다.
   값을 믿으면 영원히 가려지고, 상수를 박으면 안 겹치는 기기에 죽은 여백이 생긴다.
   그래서 '설치형인가 · 화면 세로를 다 쓰는가 · 그런데 인셋이 0인가' 를 재서 정한다. */
console.log('⑩ 안전영역 실측 — 값을 믿지도, 상수를 박지도 않는다');
{
  const f = H.slice(H.indexOf('function luxFitSafeArea()'), H.indexOf('window.luxFitSafeArea'));
  for (const [t, why] of [
    ["display-mode: standalone",  '설치형일 때만 손댄다(웹은 상태바가 본문 위에 없다)'],
    ['if(envTop >= 1)',           'OS 가 인셋을 제대로 주면 CSS 에 맡기고 물러난다'],
    ['screen.width',              '화면 세로를 다 쓰는지 재서 겹침을 판정한다'],
    ['landscape ? Math.min',      '회전을 고려해 긴 변/짧은 변을 골라 비교한다'],
    ["setProperty('--lux-sat'",   '겹칠 때만 상단 인셋을 채워 넣는다'],
    ["removeProperty('--lux-sat'",'아니면 되돌린다 — 죽은 여백을 남기지 않는다'],
  ]) { if (f.includes(t)) ok(why); else bad('안전영역 실측이 ' + why + ' — 그 단계가 빠졌다'); }
  if (/orientationchange/.test(H)) ok('회전하면 다시 잰다');
  else bad('회전 후 다시 재지 않는다');
}

/* ── ⑪ 앱에서 '지금 돌고 있나' 가 보이는가 ──────────────────────────────── */
console.log('⑪ 폰 앱바 실시간 칩');
{
  if (H.includes('id="mAbLive"') && H.includes('id="mAbDot"')) ok('앱바에 실시간 점·문구가 있다');
  else bad('앱바에 실시간 표시가 없다');
  if (/c\.indexOf\(' live '\) >= 0/.test(H))
    ok("상태를 #liveIndicator(부모)에서 읽는다 — 점에서 읽으면 늘 'live-dot' 만 나온다");
  else bad('실시간 상태를 잘못된 요소에서 읽는다');
  const B2 = globalThis.__PHONE_BLOCK || '';
  if (/\.m-ab-sub\.live>b\{ color:var\(--pos\); \}/.test(B2) && /\.m-ab-sub\.dead>b\{ color:var\(--neg\); \}/.test(B2))
    ok('상태를 색으로도 말한다(글자만으로는 흘깃 봐서 안 잡힌다)');
  else bad('상태 색이 없다');
}

/* ── ⑫ 격자는 자식을 이름으로 열거하지 않는다 ────────────────────────────
   터미널 밀도의 .fv-deck 4열 격자는 "전체폭으로 펼 자식" 을 하나하나 적고 있었다.
   그래서 목록에 없는 자식이 하나 생기면 1/4 칸에 박혀 격자가 찢어졌다.
   실제로 그렇게 됐다 — 위기 경보 배너(#fvCrisisBanner)는 위기 단계가 '경계' 이상일 때
   ★런타임에 만들어져★ .fv-deck 에 꽂히므로 그 목록에 있을 수가 없다.
   기본값을 뒤집어(전부 전체폭) 앞으로 자식이 늘어도 안전하게 둔다. */
console.log('⑫ 터미널 격자 — 새 자식이 생겨도 안 찢어지는가');
{
  if (/\.fv-deck>\*\{grid-column:1\/-1;\}/.test(H.replace(/\s+/g, '')))
    ok('.fv-deck 의 ★모든★ 자식이 기본 전체폭 (열거가 아니라 기본값)');
  else bad('.fv-deck 자식을 이름으로 열거하고 있다 — 런타임에 꽂히는 자식이 격자를 찢는다');
  /* 좁히는 예외는 ★id 로 지목한 것만★ 이어야 한다.
     .fv-panel 같은 넓은 선택자로 좁히면 새로 생기는 패널이 또 말려든다.
     (V33.160 에서 한국장 패널이 합류해 좁힘 대상은 셋 — 폭 구간마다 span 값이 다르다) */
  const narrowed = new Set((H.match(/\.fv-deck>#(fv[A-Za-z]+Panel)\{?/g) || [])
    .map(function (x) { return x.replace(/.*#/, '').replace(/\{$/, ''); }));
  const want = ['fvCrisisPanel', 'fvKrHaltPanel', 'fvEventsPanel'];
  const extra = [...narrowed].filter(function (x) { return want.indexOf(x) < 0; });
  if (!extra.length && want.every(function (x) { return narrowed.has(x); }))
    ok('좁힘 예외는 id 로 지목한 셋뿐 — ' + want.join(' · '));
  else bad('좁힘 예외가 의도와 다르다 — 있는 것: ' + [...narrowed].join(', '));
  if (/\.fv-deck>\.fv-panel\{[^}]*grid-column/.test(H))
    bad('.fv-panel 같은 넓은 선택자로 좁히고 있다 — 새 패널이 말려든다');
  else ok('넓은 선택자로 좁히지 않는다');
  // 런타임 배너가 실제로 .fv-deck 에 꽂히는지(전제 확인)
  if (/host\.parentNode\.insertBefore\(ban, host\)/.test(H) && /id = 'fvCrisisBanner'/.test(H))
    ok('위기 배너는 런타임에 .fv-deck 로 삽입된다 — 열거 방식이 위험한 이유');
  else bad('위기 배너 삽입 경로가 바뀌었다 — 이 게이트의 전제를 다시 확인해야 한다');
}

/* ── ⑬ 격자의 행은 폭을 다 써야 한다 ────────────────────────────────────
   ⑫ 는 "자식이 1/4 칸에 박히지 않는가" 를 봤다. 그것만으로는 부족했다 —
   V33.159 에서 한국장 패널을 위기 패널과 이슈 패널 ★사이에★ 넣자, 2칸씩 짝을 이루던
   그 둘이 각각 혼자 한 줄을 차지해 화면 절반이 비었다(1000~1680px 네 폭 모두).
   자식은 전부 제 폭을 가졌는데 ★행★ 이 비었다. 그래서 열 수와 짝의 개수, 그리고
   DOM 순서가 서로 맞는지를 함께 본다. */
console.log('⑬ 격자 행 — 짝지을 패널이 실제로 이웃인가');
{
  const cols = (H.match(/\.fv-deck\{\s*display:grid;grid-template-columns:repeat\((\d+),/) || [])[1];
  const span2 = (H.match(/\.fv-deck>#fv(Crisis|KrHalt|Events)Panel\{grid-column:span 2;\}/g) || []).length
             || (H.match(/\.fv-deck>#fv(Crisis|KrHalt|Events)Panel,?\s*/g) || []).length;
  if (cols === '6') ok('격자 열 수 6 — 3개(2칸씩)와 2개(3칸씩)를 모두 담는다');
  else bad('격자 열 수가 ' + cols + ' 이다 — 정보 패널 3개를 한 줄에 못 놓는다');
  // 좁은 폭 폴백: 둘만 나란히(3칸씩) + 한국장은 전체폭
  const nar = H.replace(/\s+/g, '');
  if (nar.includes('#fvCrisisPanel,html[data-density="terminal"].fv-deck>#fvEventsPanel{grid-column:span3;}')
      && nar.includes('#fvKrHaltPanel{grid-column:1/-1;}'))
    ok('1300px 미만 폴백 — 위기·이슈만 나란히, 한국장은 전체폭(빈칸 없음)');
  else bad('좁은 폭 폴백이 없다 — 한 칸이 300px 아래로 내려가 표가 눌린다');
  // ★DOM 순서★ — 전체폭이 되는 패널이 짝 사이에 끼면 짝이 갈라진다
  const iC = H.indexOf('id="fvCrisisPanel"'), iE = H.indexOf('id="fvEventsPanel"'), iK = H.indexOf('id="fvKrHaltPanel"');
  if (iC > 0 && iE > 0 && iK > 0 && iK > iE)
    ok('한국장 패널이 짝(위기·이슈) ★뒤★ 에 온다 — 좁은 폭에서 짝이 안 갈라진다');
  else bad('한국장 패널이 위기·이슈 사이에 있다 — 좁은 폭에서 두 패널이 각자 한 줄을 차지한다');
}

/* ── ⑭ 한 줄의 높이는 가장 긴 카드가 정한다 ──────────────────────────────
   ⑬ 은 "행이 폭을 다 쓰는가" 를 봤다. 폭이 다 차도 ★높이★ 가 어긋나면 옆 카드 아래가
   통째로 빈다 — 실측: 기술적분석 스크리너가 1,183px 로 자라 옆 캘린더 카드를 같이
   늘렸고, 캘린더 표는 320px 에서 끝나 그 아래가 텅 비었다.
   고치는 방향은 짧은 카드를 늘리는 게 아니라 ★긴 카드를 화면 안에 묶는 것★ 이다. */
console.log('⑭ 행 높이 — 긴 카드가 화면 밖으로 자라지 않는가');
{
  const flat = H.replace(/\s+/g, '');
  for (const [t, why] of [
    ['.cmbd-grid>.fv-panel{max-height:min(62vh,620px);}', '캘린더·기술적분석 카드가 뷰포트에 묶인다'],
    ['.cmbd-grid#taResult{flex:1 1auto;min-height:0;overflow-y:auto;}'.replace(/\s/g, ''), '스크리너는 카드 안에서 스크롤한다'],
    ['max-height:none!important;flex:1 1auto;min-height:0;overflow:auto;'.replace(/\s/g, ''), '캘린더 표가 고정 320px 대신 남는 높이를 채운다'],
    ['.fv-deck{align-items:stretch;}', '한 줄의 카드들이 같은 높이가 된다'],
    ['max-height:min(46vh,460px);', '정보 카드 상한이 보통 카드의 키 근처(460px)'],
  ]) { if (flat.includes(t)) ok(why); else bad(why + ' — 그 규칙이 없다'); }
  // 내용을 지우는 방식이 아니어야 한다 — 넘치면 잘리는 게 아니라 스크롤해야 한다
  if (/#fvCrisisBody,\s*html\[data-density="terminal"\]\s*#fvEventsBody,\s*html\[data-density="terminal"\]\s*#fvKrHaltBody\{ flex:1 1 auto; min-height:0; overflow-y:auto; \}/.test(H))
    ok('넘치는 내용은 잘리지 않고 카드 안에서 스크롤한다(overflow:hidden 아님)');
  else bad('정보 카드 본문의 넘침 처리가 스크롤이 아니다');
  // 폰은 이 규칙을 한 줄도 읽으면 안 된다(전부 min-width 로 감싸져 있는가)
  /* 구간의 끝을 '다음 V33 블록 머리말' 로 잡는다. 고정된 다른 버전 표식으로 끝을 잡으면
     그 사이에 새 블록이 하나 끼는 순간(실제로 V33.164 가 그랬다) 이 검사가 남의 규칙까지
     세면서 오탐한다. 검사 대상은 ★V33.161 블록 자신★ 이다. */
  const segStart = H.indexOf('[V33.161] 한 줄의 높이는');
  const nextHdr = H.indexOf('[V33.1', segStart + 40);
  const seg = H.slice(segStart, nextHdr > 0 ? nextHdr : segStart + 4000);
  const opens = (seg.match(/@media \(min-width:(901|1000)px\)\{/g) || []).length;
  if (opens === 2 && !/@media \(max-width/.test(seg))
    ok('V33.161 규칙은 전부 min-width(901·1000) 안에 있다 — 폰은 읽지 않는다');
  else bad('V33.161 규칙 중 폰까지 닿는 것이 있다');
}

/* ── ⑤ [V33.190] 폰에서 미국장으로 갈 문이 있는가 ─────────────────────────
   실측 사고: V33.126 이 @media(max-width:640px) 안에 `.mk-tabs{display:flex}` 를 넣고
   그 ★뒤에★ 미디어쿼리 밖에서 `.mk-tabs{display:none}` 을 다시 선언했다. 명시도가 같고
   (클래스 하나) 미디어쿼리는 명시도를 올리지 않으므로 ★나중 규칙이 이긴다★ — 탭은 어떤
   화면에서도 뜬 적이 없다. 같은 미디어쿼리가 `.db-col{display:none}` 으로 한 시장만 남기니,
   폰에서는 한국장만 보이고 미국장으로 갈 문이 아예 없었다.
   이 게이트는 그 형태를 못박는다: ★기본값(none)이 미디어쿼리 override 보다 앞에 있어야 한다.★ */
console.log('\n⑤ 폰 — 국장/미장 전환');
{
  const iDef = H.indexOf('.db-mk-switch{display:none;}');
  const iOn  = H.indexOf('.db-mk-switch{display:inline-flex;}');
  if (iDef < 0 || iOn < 0) bad('국장/미장 스위치의 기본/override 규칙을 찾지 못했다');
  else if (iDef < iOn) ok('스위치 기본값(none)이 폰 override 보다 ★앞★ 에 있다 — 소스 순서로 이긴다');
  else bad('기본값 display:none 이 override 뒤에 있다 — V33.126 과 똑같이 스위치가 영영 안 뜬다');
  // 함정을 만든 마크업 자체가 사라졌는지 본다(주석 속 설명은 세지 않는다 — 클래스 속성만 본다).
  if (!/class="mk-tabs?"/.test(H) && !/class="mk-tab /.test(H))
    ok('영영 안 뜨던 .mk-tabs 마크업이 사라졌다 — 같은 함정이 남아 있지 않다');
  else bad('.mk-tabs 마크업이 남아 있다 — 소스 순서에 지는 규칙이 되살아날 수 있다');
  // 스위치는 ★정렬 바 안★ 에 있어야 한다 — 별도 줄을 쓰면 목록이 그만큼 아래로 밀린다.
  const bar = (H.match(/<div class="db-sortbar"[\s\S]*?<\/div>/) || [''])[0];
  if (/id="dbMkSwitch"/.test(bar) && /data-mk="us"/.test(bar) && /data-mk="kr"/.test(bar))
    ok('국장/미장 스위치가 정렬 바 안에 있다(국장·미장 두 칸)');
  else bad('정렬 바 안에 국장/미장 스위치가 없다');
  if (/document\.getElementById\('dbMkSwitch'\)/.test(H) && /\.db-mk-opt/.test(H))
    ok('스위치가 실제로 배선돼 있다(.db-mk-opt → mk-active)');
  else bad('스위치에 이벤트가 안 걸려 있다 — 눌러도 시장이 안 바뀐다');
}

/* ── ⑥ [V33.190] 접속 직후 화면 ──────────────────────────────────────────── */
console.log('\n⑥ 접속 직후 — 대시보드 · 모두 접힘');
{
  if (/_phone \? 'dashboard' : \(localStorage\.getItem\('luxPage'\)/.test(H))
    ok('폰으로 접속하면 언제나 대시보드로 시작한다(넓은 화면은 종전대로 마지막 페이지)');
  else bad('폰 첫 화면이 대시보드로 고정돼 있지 않다');
  if (/<div class="nlv-panel nlv-foldable folded" id="nlvPipePanel">/.test(H))
    ok('엔진 파이프라인은 접힌 상태로 시작한다');
  else bad('엔진 파이프라인이 접힌 상태로 시작하지 않는다');
  if (/id="nlvPipeFold"/.test(H) && /pn\.classList\.toggle\('folded'\)/.test(H))
    ok('엔진 파이프라인에 접기/펼치기 버튼이 배선돼 있다');
  else bad('엔진 파이프라인 접기 버튼이 없거나 안 걸려 있다');
  // ★자동 펼치기가 되살아나면 "접속 시 접힘" 이 무너진다★ — 데이터가 오면 스스로 펼쳐졌었다.
  if (!/자동 펼치기\n?\s*if \((recentTradesFull|allTradesFull)\.length > 0/.test(H)
      && !/tradesExpanded = true;/.test(H) && !/allTradesExpanded = true;/.test(H))
    ok('거래내역이 데이터 도착만으로 스스로 펼쳐지지 않는다');
  else bad('거래내역 자동 펼치기가 남아 있다 — 접어 둬도 다음 갱신에 도로 펼쳐진다');
  if (/bar\.classList\.add\('collapsed'\);/.test(H))
    ok('AI픽·뉴스픽은 접속 시 항상 접혀 있다');
  else bad('AI픽·뉴스픽이 저장된 펼침 상태를 되살린다');
  /* [V33.193] ★대시보드의 ENGINE PIPELINE 은 다른 요소다.★ V33.190 은 'AI 두뇌' 페이지의
     같은 이름 패널(#nlvPipePanel)에만 버튼을 달았고, 첫 화면의 #pipelineBar 는 그대로였다.
     이름이 같은 두 패널을 하나로 본 것이 원인이다 — 둘 다 확인한다. */
  if (/<div class="pipeline-bar folded" id="pipelineBar">/.test(H) && /id="pipelineFold"/.test(H))
    ok('대시보드 ENGINE PIPELINE 도 접기 버튼을 갖고 접힌 채로 시작한다');
  else bad('대시보드 ENGINE PIPELINE 에 접기 버튼이 없거나 펼친 채로 시작한다');
  if (/\.pipeline-bar\.folded \.pipeline-grid\{display:none;\}/.test(H))
    ok('접힘 CSS 가 실제로 내용을 숨긴다');
  else bad('접힘 클래스에 대응하는 CSS 가 없다 — 클래스만 붙고 화면은 그대로다');
}

/* ── ⑧ [V33.193] 폰 대시보드 — 접속 시 접혀 있어야 할 패널들 ─────────────── */
console.log('\n⑧ 폰 — 첫 화면 접힘 패널');
{
  /* ★함수 선언이어야 한다★ — 이 세 패널의 렌더 함수는 파일 앞쪽에 있고 호출도 먼저 될 수 있다.
     식(window.__x = function…)으로 두면 그 대입이 아직 안 돌아 조용히 아무 일도 안 일어난다. */
  if (/\n  function _luxPhoneFold\(bodyId, caretId\)\{/.test(H))
    ok('폰 접힘 헬퍼가 함수 선언이다 — 호출 순서에 상관없이 동작한다');
  else bad('폰 접힘 헬퍼가 함수 선언이 아니다 — 렌더가 먼저 돌면 조용히 아무 일도 안 일어난다');
  if (/max-width:767px/.test((H.match(/function _luxPhoneFold[\s\S]{0,400}/) || [''])[0]))
    ok('폰 폭(767px)에서만 접는다 — 넓은 화면은 종전대로 펼쳐진다');
  else bad('폰 판정 없이 접는다 — PC 화면까지 접힌다');
  for (const [nm, body, caret] of [['지정학·위기 게이지', 'fvCrisisBody', 'fvCrisisCaret'],
                                   ['활성 이슈·레짐', 'fvEventsBody', 'fvEventsCaret'],
                                   ['한국장 매매정지', 'fvKrHaltBody', 'fvKrHaltCaret']]) {
    if (H.indexOf("_luxPhoneFold('" + body + "', '" + caret + "')") > 0)
      ok(nm + ' 패널이 폰에서 접힌 채로 시작한다');
    else bad(nm + ' 패널이 폰에서 펼친 채로 시작한다');
  }
}

/* ── ⑦ [V33.190] 폰 대시보드 — 시총맵이 TOP MOVERS 위 ────────────────────── */
console.log('\n⑦ 폰 대시보드 배치');
{
  const seg = H.slice(H.indexOf('@media(max-width:767px){'));
  const m1 = /\.fv-mid > \.fv-panel:nth-child\(1\)\{order:2;\}/.test(seg);
  const m2 = /\.fv-mid > \.fv-panel:nth-child\(2\)\{order:1;\}/.test(seg);
  if (m1 && m2) ok('폰에서 S&P 500 MAP 이 TOP MOVERS 위에 온다(order — DOM 은 안 건드린다)');
  else bad('폰에서 맵/무버스 순서가 안 바뀐다');
  // DOM 순서는 그대로여야 데스크톱(좌 무버스 / 우 맵)이 유지된다.
  const dom = H.indexOf('TOP MOVERS');
  const map = H.indexOf('S&amp;P 500 MAP');
  if (dom > 0 && map > dom) ok('DOM 순서는 그대로다 — 넓은 화면 배치가 안 뒤집힌다');
  else bad('DOM 순서가 바뀌었다 — 데스크톱 배치까지 따라 뒤집힌다');
}

console.log(fail ? '\n실패 ' + fail + '건' : '\nok   폰 화면 계약 통과');
process.exit(fail ? 1 : 0);
