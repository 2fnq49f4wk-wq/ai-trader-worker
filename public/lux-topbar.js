/* [V33.812] 사이드바 = 로고 + 메뉴만(사용자 11/10). 엔진·장 상태·자동 운용·도구 버튼은 대시보드 맨 위 한 줄로 옮긴다.
   요소를 옮기기만 한다(id 그대로) — 기존 갱신 코드·폰 드로어 프록시가 계속 같은 요소를 쓴다. */
(function(){
  function mount(){
    var pg=document.getElementById('page-dashboard'), sb=document.querySelector('nav.sidebar');
    if(!pg||!sb||document.getElementById('luxTopbar')) return;
    var st=sb.querySelector('.sb-status'), ac=sb.querySelector('.sb-actions');
    var bar=document.createElement('div'); bar.id='luxTopbar'; bar.className='lux-topbar';
    if(st){ st.classList.add('lt-status'); bar.appendChild(st); }
    if(ac){ ac.classList.add('lt-actions'); bar.appendChild(ac); }
    pg.insertBefore(bar, pg.firstChild);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
