/* [V33.860] ★관리자 및 개발자 메뉴★(사용자 11/21 "설정창도 지금에 맞게 리뉴얼 · 버튼 이름 '관리자 및 개발자 메뉴'로") —
   종전 설정창은 섹션 30여 개가 한 줄로 길게 이어진 옛 화면이었다. 입력칸·저장 로직(id)은 그대로 두고, 창이 처음 열릴 때 한 번만
   섹션(.section-title 단위)을 6개 묶음 탭으로 다시 담는다: 상태 · AI 지시 · 계좌·종목 · 전략 · 위험 관리 · 학습·도구.
   화면 계산만(서버 0) · 마지막에 본 탭은 이 기기에만 기억. */
(function () {
  var GROUPS = [
    ['status', '상태', 'STATUS', /경고·오류|CLOUDFLARE|ENGINE STATS/i],
    ['ai', 'AI 지시', 'AI DIRECTIVE', /AI DAILY|AI 일일/i],
    ['acct', '계좌·종목', 'ACCOUNT', /초기 자본금|TICKERS|CASH MANAGEMENT|FEES/i],
    ['strat', '전략', 'STRATEGY', /^STRATEGY|TREND STRATEGY|SCALP|VBURST|SNAP/i],
    ['risk', '위험 관리', 'RISK', /RISK LIMITS|CRASH GATE|COMMON|ATR/i],
    ['tools', '학습·도구', 'TOOLS', /섹터 그룹|신호 타입|백테스트|데이터 다운로드|.*/]
  ];
  var KEY = 'luxAdmTab';
  function build(modal) {
    var mc = modal.querySelector('.modal-content'); if (!mc || mc.__adm) return; mc.__adm = 1;
    mc.classList.add('adm');
    var h2 = mc.querySelector(':scope > h2');
    if (h2) h2.innerHTML = '<span class="adm-k">ADMIN · DEVELOPER</span>관리자 및 개발자 메뉴';
    var actions = mc.querySelector(':scope > .modal-actions');
    var kids = Array.prototype.slice.call(mc.children), start = h2 ? kids.indexOf(h2) + 1 : 0;
    var secs = [], cur = null;
    for (var i = start; i < kids.length; i++) {
      var el = kids[i]; if (el === actions) break;
      if (el.classList.contains('section-divider')) { el.style.display = 'none'; continue; }
      if (el.classList.contains('section-title')) { cur = { t: el.textContent.trim(), els: [el] }; secs.push(cur); continue; }
      if (cur) cur.els.push(el); else { cur = { t: '', els: [el] }; secs.push(cur); }
    }
    if (!secs.length) return;
    var nav = document.createElement('div'); nav.className = 'adm-tabs'; nav.setAttribute('role', 'tablist');
    var wrap = document.createElement('div'); wrap.className = 'adm-body';
    var panels = {};
    GROUPS.forEach(function (g) {
      var p = document.createElement('section'); p.className = 'adm-panel'; p.setAttribute('data-g', g[0]); p.setAttribute('role', 'tabpanel');
      panels[g[0]] = p;
    });
    secs.forEach(function (s) {
      var g = GROUPS.filter(function (x) { return x[3].test(s.t); })[0] || GROUPS[GROUPS.length - 1];
      var card = document.createElement('div'); card.className = 'adm-card';
      s.els.forEach(function (e) { card.appendChild(e); });
      panels[g[0]].appendChild(card);
    });
    GROUPS.forEach(function (g) {
      var p = panels[g[0]], n = p.children.length; if (!n) return;
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('data-g', g[0]);
      b.innerHTML = '<b>' + g[1] + '</b><small>' + g[2] + ' · ' + n + '</small>';
      nav.appendChild(b); wrap.appendChild(p);
    });
    if (actions) { mc.insertBefore(nav, actions); mc.insertBefore(wrap, actions); } else { mc.appendChild(nav); mc.appendChild(wrap); }
    var show = function (k) {
      if (!panels[k] || !panels[k].children.length) k = nav.firstChild && nav.firstChild.getAttribute('data-g');
      Array.prototype.forEach.call(nav.children, function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-g') === k)); });
      Object.keys(panels).forEach(function (x) { panels[x].hidden = x !== k; });
      try { localStorage.setItem(KEY, k); } catch (e) {}
      wrap.scrollTop = 0;
    };
    nav.addEventListener('click', function (e) { var b = e.target.closest('[data-g]'); if (b) show(b.getAttribute('data-g')); });
    var k0 = 'status'; try { k0 = localStorage.getItem(KEY) || 'status'; } catch (e) {}
    show(k0);
  }
  function init() {
    var m = document.getElementById('settingsModal'); if (!m) return;
    if (m.classList.contains('show')) build(m);
    new MutationObserver(function () { if (m.classList.contains('show')) build(m); }).observe(m, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
