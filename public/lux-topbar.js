/* [V33.812] 엔진·장 상태·자동 운용은 대시보드 맨 위 한 줄로 옮긴다(요소만 옮김 · id 그대로 — 기존 갱신 코드·폰 드로어 프록시가 같은 요소를 쓴다).
   [V33.820] 사용자 11/11 "왼쪽 사이드바에 MAP · 영어/한국어 · 라이트/다크 다시" — 이 셋은 사이드바 아래 도구 칸(.lux-sbtools)으로 돌려놓는다.
   새 버전·앱 설치만 맨 위 줄에 남긴다. */
(function(){
  function el(t,c,h){var e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;}
  function lang(){try{return (window.luxLang&&window.luxLang.get&&window.luxLang.get())||localStorage.getItem('luxLang')||'ko';}catch(e){return 'ko';}}
  function light(){return document.documentElement.getAttribute('data-theme')==='light';}
  function mount(){
    var pg=document.getElementById('page-dashboard'), sb=document.querySelector('nav.sidebar');
    if(!pg||!sb||document.getElementById('luxTopbar')) return;
    var st=sb.querySelector('.sb-status'), ac=sb.querySelector('.sb-actions'), nav=sb.querySelector('.sb-nav');
    var bar=el('div','lux-topbar'); bar.id='luxTopbar';
    if(st){ st.classList.add('lt-status'); bar.appendChild(st); }
    if(ac){ ac.classList.add('lt-actions'); bar.appendChild(ac); }
    pg.insertBefore(bar, pg.firstChild);
    /* AUTO-TUNE 알림 줄은 늦게 나타나 지수·카드 전체를 33px 밀었다 → 카드 묶음 아래로 */
    var tb=document.getElementById('tuneBanner'), deck=pg.querySelector('.fv-deck');
    if(tb&&deck&&deck.parentNode===pg) pg.insertBefore(tb, deck.nextSibling);
    /* 사이드바 도구 칸 */
    var tools=el('div','lux-sbtools'); tools.id='luxSbTools';
    var map=document.getElementById('btnHeatmap');
    if(map){ map.classList.add('lst-map'); map.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/></svg><span>MAP</span>'; tools.appendChild(map); }
    var lg=el('div','lst-seg','<button type="button" data-l="ko">한국어</button><button type="button" data-l="en">EN</button>'); lg.setAttribute('data-noi18n','');
    var th=el('div','lst-seg','<button type="button" data-t="light">Light</button><button type="button" data-t="dark">Dark</button>'); th.setAttribute('data-noi18n','');
    tools.appendChild(lg); tools.appendChild(th);
    function paint(){
      var L=lang(), T=light()?'light':'dark';
      lg.querySelectorAll('button').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-l')===L);});
      th.querySelectorAll('button').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-t')===T);});
    }
    lg.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;var l=b.getAttribute('data-l');if(l!==lang()&&window.luxLang)window.luxLang.set(l);setTimeout(paint,50);});
    th.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;if((b.getAttribute('data-t')==='light')!==light()){var t=document.getElementById('btnTheme');if(t)t.click();}paint();});
    if(nav&&nav.parentNode===sb) sb.insertBefore(tools, nav.nextSibling); else sb.appendChild(tools);
    paint();
    /* [V33.822] 사이드바 시장 시계 — 사이드바를 화면 아래까지 채우면서 빈 칸 대신 쓸모 있는 것: 미국·한국 장 상태 · 지금 시각(서울/뉴욕) · 엔진 LIVE.
       값은 맨 위 줄의 같은 요소 글자를 5초마다 옮겨 적기만 한다(서버 일 0). */
    var stat=el('div','lux-sbstat','<div class="lss-h">시장 시계</div><div class="lss-r"><span>🇺🇸 뉴욕</span><b data-t="ny">—</b></div><i class="lss-s" data-s="us">—</i><div class="lss-r"><span>🇰🇷 서울</span><b data-t="kr">—</b></div><i class="lss-s" data-s="kr">—</i><div class="lss-live"><i class="lss-dot"></i><span data-s="live">연결 중</span></div>');
    sb.insertBefore(stat, tools);
    function tx(id){var e=document.getElementById(id);return e?(e.textContent||'').replace(/\s+/g,' ').trim():'';}
    function hm(tz){try{return new Date().toLocaleTimeString('ko-KR',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false});}catch(e){return '';}}
    function tick(){
      if(document.hidden||!stat.offsetParent) return;
      var q=function(s){return stat.querySelector(s);};
      q('[data-t="ny"]').textContent=hm('America/New_York'); q('[data-t="kr"]').textContent=hm('Asia/Seoul');
      q('[data-s="us"]').textContent=tx('usMarketStatus')||'—'; q('[data-s="kr"]').textContent=tx('krMarketStatus')||'—';
      var lv=tx('liveText'); q('[data-s="live"]').textContent=lv||'연결 중'; stat.classList.toggle('on',/LIVE|연결됨|실시간/i.test(lv));
    }
    tick(); setInterval(tick,5000);
  }
  /* [V33.820] 문서 중간(디자인 시트 바로 뒤)에서 동기로 불린다 — 화면이 드러나기(lux-cssw 해제) 전에 옮겨 두어 카드가 밀리거나 줄어드는 일이 없게 */
  if(document.getElementById('page-dashboard')&&document.querySelector('nav.sidebar .sb-nav')) mount();
  else if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
/* [V33.836] 사용자 11/12 "패드·컴퓨터에서 왼쪽 사이드바 접고 펼치기 · 아이콘만" — 맨 위 둥근 버튼으로 접는다(html.lux-sbmini · 이 기기에 기억 lux-sbmini).
   렉 방지: 사이드바 폭만 0.3초 미끄러지고, 오른쪽 본문은 처음에 최종 폭으로 한 번만 배치한다(매 프레임 대시보드 6천 요소를 다시 배치하지 않게). */
(function(){
  var H=document.documentElement;
  try{ if(localStorage.getItem('lux-sbmini')==='1') H.classList.add('lux-sbmini'); }catch(e){}
  function mount(){
    var sb=document.querySelector('nav.sidebar'); if(!sb||sb.querySelector('.lux-sbcol')) return;
    var b=document.createElement('button'); b.type='button'; b.className='lux-sbcol';
    b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
    function lab(){ var m=H.classList.contains('lux-sbmini'); b.setAttribute('aria-label',m?'사이드바 펼치기':'사이드바 접기'); b.title=m?'펼치기':'접기'; }
    lab(); sb.insertBefore(b, sb.firstChild);
    sb.querySelectorAll('.sb-nav .nav-item').forEach(function(it){ var l=it.querySelector('.nav-item-label'); if(l&&!it.title) it.title=l.textContent.trim(); });
    b.addEventListener('click',function(){
      var c=document.querySelector('main.content'), mini=!H.classList.contains('lux-sbmini');
      var cur=sb.getBoundingClientRect().width, to=mini?68:(innerWidth>=1180?178:150);
      if(c){ var w=c.getBoundingClientRect().width+(cur-to); c.style.flex='0 0 '+w+'px'; c.style.width=w+'px'; c.style.maxWidth='none'; }
      H.classList.add('lux-sbanim'); H.classList.toggle('lux-sbmini',mini); lab();
      try{ localStorage.setItem('lux-sbmini',mini?'1':'0'); }catch(e){}
      clearTimeout(b._t); b._t=setTimeout(function(){ H.classList.remove('lux-sbanim'); if(c){ c.style.flex=''; c.style.width=''; c.style.maxWidth=''; } try{ dispatchEvent(new Event('resize')); }catch(e){} },340);
    });
  }
  if(document.querySelector('nav.sidebar .sb-nav')) mount(); else document.addEventListener('DOMContentLoaded',mount);
})();
