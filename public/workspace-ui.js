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
    if (!brain || ['operations', 'models', 'research'].indexOf(view) < 0) return;
    var keepY = window.scrollY || document.documentElement.scrollTop || 0;
    var keepLocal = brain.scrollTop || 0;
    brain.setAttribute('data-brain-view', view);
    paintButtons(brain, 'data-brain-tab', view);
    // Existing renderers need visible dimensions after a view is revealed.
    // [V33.466] Brain Studio 가 붙으면 옛 렌더러(무거운 캔버스)는 돌리지 않는다. 못 붙으면 옛 화면으로.
    if (view === 'models') requestAnimationFrame(function () {
      studio(function (ok) {
        if (!ok && typeof window.openNnViz === 'function') window.openNnViz();
        window.scrollTo(window.scrollX || 0, keepY);
        brain.scrollTop = keepLocal;
      });
    });
  };
  var studioState = 0, studioWait = [];   // 0 아직 · 1 불러오는 중 · 2 붙음 · 3 실패
  function studio(done) {
    var el = document.getElementById('brain-studio');
    if (!el) return done(false);
    if (studioState === 2) return done(true);
    if (studioState === 3) return done(false);
    studioWait.push(done);
    if (studioState === 1) return;
    studioState = 1;
    var finish = function (ok) { studioState = ok ? 2 : 3; if (ok) brain.classList.add('bs-on'); var w = studioWait; studioWait = []; w.forEach(function (f) { try { f(ok); } catch (e) {} }); };
    var mount = function () { try { finish(!!(window.BrainStudio && window.BrainStudio.mount(el))); } catch (e) { finish(false); } };
    if (window.BrainStudio) return mount();
    var meta = document.querySelector('meta[name="lux-build"]');
    var sc = document.createElement('script');
    sc.src = '/brain-studio.js?v=' + encodeURIComponent(meta ? meta.content : '');
    sc.onload = mount; sc.onerror = function () { finish(false); };
    document.head.appendChild(sc);
    setTimeout(function () { if (studioState === 1) finish(false); }, 15000);
  }
  window.luxMarketView = function (view) {
    if (!market || ['all', 'macro', 'fx', 'news'].indexOf(view) < 0) return;
    market.setAttribute('data-market-view', view);
    paintButtons(market, 'data-market-tab', view);
    market.scrollTop = 0;
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
  if (market) window.luxMarketView(market.getAttribute('data-market-view') || 'all');
}());
