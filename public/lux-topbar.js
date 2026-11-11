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
  }
  /* [V33.820] 문서 중간(디자인 시트 바로 뒤)에서 동기로 불린다 — 화면이 드러나기(lux-cssw 해제) 전에 옮겨 두어 카드가 밀리거나 줄어드는 일이 없게 */
  if(document.getElementById('page-dashboard')&&document.querySelector('nav.sidebar .sb-nav')) mount();
  else if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
