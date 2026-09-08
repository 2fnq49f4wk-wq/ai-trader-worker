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
    if (view === 'models') requestAnimationFrame(function () {
      if (typeof window.openNnViz === 'function') window.openNnViz();
      window.scrollTo(window.scrollX || 0, keepY);
      brain.scrollTop = keepLocal;
    });
  };
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
