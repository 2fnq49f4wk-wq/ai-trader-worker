/* Codex V33.315 — UI-only workspace controls. No training, orders or backend writes. */
(function () {
  'use strict';
  var brain = document.getElementById('page-nnviz');
  var market = document.getElementById('page-macro');
  function paintButtons(root, attribute, selected) {
    root.querySelectorAll('[' + attribute + ']').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute(attribute) === selected));
    });
  }
  window.luxBrainView = function (view) {
    if (view === 'playbook') view = 'operations';   // [V33.612] 00 탭은 01 작동 화면에 합쳤다(옛 기억값)
    if (!brain || ['operations', 'models', 'research'].indexOf(view) < 0) return;
    var keepY = window.scrollY || document.documentElement.scrollTop || 0;
    var keepLocal = brain.scrollTop || 0;
    brain.setAttribute('data-brain-view', view);
    paintButtons(brain, 'data-brain-tab', view);
    // Existing renderers need visible dimensions after a view is revealed.
    // [V33.466] Brain Studio 가 붙으면 옛 렌더러(무거운 캔버스)는 돌리지 않는다. 못 붙으면 옛 화면으로.
    if (view === 'operations') pbObs();
    if (view === 'models') requestAnimationFrame(function () {
      studio(function (ok) {
        /* [V33.621] 못 붙어도 옛 구조 창(openNnViz)으로 떨어지지 않는다 — '불러오는 중 / 다시 시도' 가 그 자리를 지킨다(사용자 10/15 "로딩 안 되면 옛날 디자인") */
        window.scrollTo(window.scrollX || 0, keepY);
        brain.scrollTop = keepLocal;
      });
    });
  };
  /* [V33.609·612] 매매법 AI 실시간 판정(01 작동 화면) — 처음 보일 때 /playbook-observatory.js 를 불러와 #pbObs 에 붙인다 */
  var pbState = 0;
  function pbObs() {
    var el = document.getElementById('pbObs');
    if (!el) return;
    if (window.PlaybookObs) { window.PlaybookObs.mount(el); return; }
    if (pbState) return;
    pbState = 1;
    /* [V33.691] 스크립트를 받는 동안 자료도 같이 받는다(종전: 스크립트 → 그다음 /api/playbook 직렬 · 폰 실측 01 화면 3.1초) — 한 요청을 모두가 나눠 쓴다 */
    try { if (!window.__pbFetchP && window.fetch) { window.__pbFetchP = fetch('/api/playbook').then(function (r) { return r.json(); }); window.__pbFetchAt = Date.now(); window.__pbFetchP['catch'](function () { window.__pbFetchP = null; }); } } catch (e) {}
    var meta = document.querySelector('meta[name="lux-build"]');
    var sc = document.createElement('script');
    sc.src = '/playbook-observatory.js?v=' + encodeURIComponent(meta ? meta.content : '');
    sc.onload = function () { if (window.PlaybookObs) window.PlaybookObs.mount(el); };
    sc.onerror = function () { pbState = 0; sc.remove(); setTimeout(pbObs, 4000); };   // [V33.621] 못 받으면 4초 뒤 다시(옛 화면으로 남지 않게)
    if (!el.innerHTML) el.innerHTML = '<div style="padding:22px 16px;color:#8b95a5;font-size:13px">매매법 AI 불러오는 중…</div>';
    document.head.appendChild(sc);
  }
  (function () {   // 기본 탭(01 작동 화면)에 있으므로 — 두뇌 페이지가 처음 보일 때 붙인다
    var el = document.getElementById('pbObs');
    if (!el || !brain || typeof IntersectionObserver === 'undefined') return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting && brain.getAttribute('data-brain-view') === 'operations') pbObs(); });
    });
    io.observe(el);
  })();
  var studioState = 0, studioWait = [], studioTry = 0;   // 0 아직 · 1 불러오는 중 · 2 붙음 · 3 실패
  /* [V33.621] ★실패해도 옛 화면으로 떨어지지 않는다★ — 불러오는 동안 '불러오는 중', 실패하면 자동 재시도(3번 · 3·6·12초) 뒤 '다시 시도' 단추.
     종전엔 한 번 실패하면(서버가 바쁜 순간 · 15초 초과) 새로고침 전까지 영원히 실패였고 옛 검증 카드·구조 창이 보였다. */
  function studioWaitBox(el, failed) {
    if (!el || studioState === 2) return;
    el.innerHTML = failed ? '<div class="bs-wait">모델 구조 화면을 받지 못했습니다(서버가 바쁘거나 연결이 끊김). <button type="button" data-bs-retry>다시 시도</button></div>'
                          : '<div class="bs-wait">모델 구조 불러오는 중…</div>';
    var b = el.querySelector('[data-bs-retry]');
    if (b) b.onclick = function () { studioState = 0; studioTry = 0; studio(function () {}); };
  }
  function studio(done) {
    var el = document.getElementById('brain-studio');
    if (!el) return done(false);
    if (studioState === 2) return done(true);
    if (studioState === 3) { studioState = 0; }   // 다시 열면 다시 시도한다
    studioWait.push(done);
    if (studioState === 1) return;
    studioState = 1;
    if (!el.firstElementChild || el.querySelector('.bs-wait')) studioWaitBox(el, false);
    var finish = function (ok) {
      if (studioState === 2) return;
      if (!ok && studioTry < 3) {   // 자동 재시도 — 대기열은 그대로 둔다
        studioTry++; studioState = 0;
        try { if (sc && sc.parentNode) sc.parentNode.removeChild(sc); } catch (e) {}
        setTimeout(function () { var w = studioWait; studioWait = []; studio(function (o) { w.forEach(function (f) { try { f(o); } catch (e) {} }); }); }, 3000 * Math.pow(2, studioTry - 1));
        return;
      }
      studioState = ok ? 2 : 3; if (ok) brain.classList.add('bs-on'); else studioWaitBox(el, true);
      var w = studioWait; studioWait = []; w.forEach(function (f) { try { f(ok); } catch (e) {} });
    };
    var mount = function () { try { finish(!!(window.BrainStudio && window.BrainStudio.mount(el))); } catch (e) { finish(false); } };
    if (window.BrainStudio) return mount();
    var meta = document.querySelector('meta[name="lux-build"]');
    var sc = document.createElement('script');
    sc.src = '/brain-studio.js?v=' + encodeURIComponent(meta ? meta.content : '') + (studioTry ? '&r=' + studioTry + '-' + Date.now() : '');
    sc.onload = mount; sc.onerror = function () { finish(false); };
    document.head.appendChild(sc);
    setTimeout(function () { if (studioState === 1) finish(false); }, 15000);
  }
  window.luxMarketView = function (view, init) {
    if (!market || ['all', 'macro', 'fx', 'news'].indexOf(view) < 0) return;
    market.setAttribute('data-market-view', view);
    paintButtons(market, 'data-market-tab', view);
    /* [V33.549] scrollTop 쓰기는 ★문서 전체 레이아웃을 즉시★ 강제한다 — 부팅 중(첫 페인트 전) 이 한 줄이 휴대폰 속도 253ms(운영 프로파일).
       처음 붙일 때는 원래 0 이라 건너뛴다. 탭을 바꿀 때만 맨 위로. */
    if (!init) market.scrollTop = 0;
  };
  document.addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-brain-tab')) window.luxBrainView(button.getAttribute('data-brain-tab'));
    if (button.hasAttribute('data-market-tab')) window.luxMarketView(button.getAttribute('data-market-tab'));
    if (button.hasAttribute('data-news-sector')) {
      var news = document.getElementById('marketNews');
      var sector = button.getAttribute('data-news-sector');
      news.setAttribute('data-sector', sector);
      paintButtons(news, 'data-news-sector', sector);
      news.querySelectorAll('.news-sector').forEach(function (section) {
        section.hidden = sector !== 'all' && section.getAttribute('data-sector') !== sector;
      });
    }
  });
  // Refresh replaces the news children; reapply the chosen filter without losing the user's selection.
  var newsBody = document.getElementById('newsBody');
  if (newsBody) new MutationObserver(function () {
    var news = document.getElementById('marketNews');
    var sector = news.getAttribute('data-sector');
    newsBody.querySelectorAll('.news-sector').forEach(function (section) {
      section.hidden = sector !== 'all' && section.getAttribute('data-sector') !== sector;
    });
  }).observe(newsBody, { childList: true });
  if (market) window.luxMarketView(market.getAttribute('data-market-view') || 'all', true);
}());
