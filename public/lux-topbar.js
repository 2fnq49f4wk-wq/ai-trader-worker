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
/* [V33.836] 사용자 11/12 "패드·컴퓨터에서 왼쪽 사이드바 접고 펼치기 · 아이콘만" — 맨 위 둥근 버튼(nav.lux-mini · 이 기기에 기억 lux-sbmini).
   [V33.837] 렉 제거: 클래스는 사이드바에만(문서 전체 스타일 재계산 없음) · 폭은 한 번에 · 사이드바 속만 0.2초 투명→보임 · resize 이벤트 안 보냄. */
(function(){
  function mount(){
    var sb=document.querySelector('nav.sidebar'); if(!sb||sb.querySelector('.lux-sbcol')) return;
    try{ if(localStorage.getItem('lux-sbmini')==='1'){ sb.classList.add('lux-mini'); var sn0=sb.querySelector('.sb-nav'); if(sn0) sn0.classList.add('lux-mini-n'); } }catch(e){}
    var b=document.createElement('button'); b.type='button'; b.className='lux-sbcol';
    b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
    function lab(){ var m=sb.classList.contains('lux-mini'); b.setAttribute('aria-label',m?'사이드바 펼치기':'사이드바 접기'); b.title=m?'펼치기':'접기'; }
    lab(); sb.insertBefore(b, sb.firstChild);
    sb.querySelectorAll('.sb-nav .nav-item').forEach(function(it){ var l=it.querySelector('.nav-item-label'); if(l&&!it.title) it.title=l.textContent.trim(); });
    /* [V33.844] ★연속 모션 + 렉 없음★(사용자 11/16) — 본문은 최종 폭으로 ★한 번만★ 배치하고, 움직임은 합성기 전용으로:
       사이드바 = clip-path 로 오른쪽 가장자리를 밀고 당김(넓은 상태로 그린 채 잘라 보임) · 본문 = transform 으로 같은 곡선·같은 시간 미끄러짐.
       접을 때는 넓은 모습 그대로 잘라 들어간 뒤 끝에서 아이콘 배치로 바꾸고, 펼 때는 처음부터 넓은 배치로 잘린 채 드러난다. */
    var busy=0;
    b.addEventListener('click',function(){
      if(busy) return; busy=1;
      var mini=!sb.classList.contains('lux-mini'), main=document.querySelector('main.content');
      var W=sb.getBoundingClientRect().width, sn=sb.querySelector('.sb-nav');
      var wide=innerWidth>=1180?178:150, d=wide-68, DUR=440, EZ='cubic-bezier(.32,.72,0,1)';
      var RM=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
      try{ localStorage.setItem('lux-sbmini',mini?'1':'0'); }catch(e){}
      if(RM||!sb.animate||Math.abs(W-(mini?wide:68))>4){ sb.classList.toggle('lux-mini',mini); if(sn) sn.classList.toggle('lux-mini-n',mini); lab(); busy=0; return; }
      sb.classList.add('lux-sbmv');
      if(mini){ sb.style.marginRight=(-d)+'px'; }   // 넓은 모습 그대로 두되 자리는 68 만 차지 → 본문은 지금 최종 폭으로 한 번 배치
      else { sb.classList.remove('lux-mini'); if(sn) sn.classList.remove('lux-mini-n'); }
      lab();
      var cpA=mini?'inset(0px 0px 0px 0px round 22px)':'inset(0px '+d+'px 0px 0px round 22px)', cpB=mini?'inset(0px '+d+'px 0px 0px round 22px)':'inset(0px 0px 0px 0px round 22px)';
      var a1=sb.animate([{clipPath:cpA},{clipPath:cpB}],{duration:DUR,easing:EZ,fill:'both'});
      var a2=main&&main.animate?main.animate([{transform:'translate3d('+(mini?d:-d)+'px,0,0)'},{transform:'none'}],{duration:DUR,easing:EZ}):null;
      if(mini) sb.querySelectorAll('.nav-item-label,.sb-brand-name,.sb-brand-sub,.lux-sbstat,.sb-mode-w').forEach(function(x){ if(x.animate) x.animate([{opacity:1},{opacity:0}],{duration:DUR*0.6,easing:'ease-out',fill:'forwards'}); });
      else sb.querySelectorAll('.nav-item-label,.sb-brand-name,.sb-brand-sub,.lux-sbstat,.sb-mode-w').forEach(function(x){ if(x.animate) x.animate([{opacity:0},{opacity:1}],{duration:DUR,easing:'ease-in',delay:0}); });
      a1.onfinish=function(){
        if(mini){ sb.classList.add('lux-mini'); if(sn) sn.classList.add('lux-mini-n'); sb.style.marginRight=''; sb.querySelectorAll('.nav-item-label,.sb-brand-name,.sb-brand-sub,.lux-sbstat,.sb-mode-w').forEach(function(x){ if(x.getAnimations) x.getAnimations().forEach(function(an){an.cancel();}); }); }
        a1.cancel(); sb.classList.remove('lux-sbmv'); busy=0;
      };
    });
  }
  if(document.querySelector('nav.sidebar .sb-nav')) mount(); else document.addEventListener('DOMContentLoaded',mount);
})();
