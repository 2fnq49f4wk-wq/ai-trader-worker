/* [V33.720] 언어 설정(한국어 / English) — 사용자 11/2 "언어설정 만들어서 전체 언어 영어로도 바꿀 수 있게".
   방식: 화면 글자(텍스트 노드 · title · placeholder · aria-label)를 그 자리에서 바꾼다. 원문은 HTML·스크립트에 그대로 둔다.
   ① 숫자를 {n} 으로 바꾼 '틀' 이 사전(i18n-en.json 의 t)에 있으면 통째로 바꾸고 숫자는 순서대로 다시 넣는다.
   ② 없으면 용어 사전(g · 긴 것부터)으로 단어를 바꾸고, 숫자 뒤 단위(일·분·건…)를 영어 단위로 바꾼다 — 서버가 만든 문장(매매 사유 등)용.
   한국어일 때는 사전을 받지도 않고 감시도 하지 않는다(비용 0). 바꾸면 새로 고친다(되돌리기 = 원문 그대로 다시 그림). */
(function () {
  "use strict";
  var KEY = "lux-lang";
  var lang = "ko";
  try { lang = localStorage.getItem(KEY) === "en" ? "en" : "ko"; } catch (e) {}
  var HANGUL = /[가-힣]/;
  var NUM = /[+\-−]?\d[\d,]*(?:\.\d+)?/g;
  var T = null, G = null, GRE = null, cache = new Map();
  var UNITS = [[/(\d)\s?개월/g, "$1mo"], [/(\d)\s?시간/g, "$1h"], [/(\d)\s?거래일/g, "$1 trading days"], [/(\d)\s?영업일/g, "$1 business days"],
               [/(\d)\s?일/g, "$1d"], [/(\d)\s?분/g, "$1m"], [/(\d)\s?초/g, "$1s"], [/(\d)\s?주/g, "$1wk"], [/(\d)\s?년/g, "$1y"],
               [/(\d)\s?건/g, "$1"], [/(\d)\s?개/g, "$1"], [/(\d)\s?종목/g, "$1 symbols"], [/(\d)\s?종/g, "$1 kinds"], [/(\d)\s?회/g, "$1x"],
               [/(\d)\s?억/g, "$1×100M"], [/(\d)\s?만/g, "$1×10k"], [/(\d)\s?원/g, "$1 KRW"], [/(\d)\s?위/g, "#$1"], [/(\d)\s?차/g, "$1th"]];
  // 영어 뒤에 남은 조사(은·는·이·가·을·를·의·에·로·와·과·도·만)를 지운다 — "model 이" → "model"
  var PART = /([A-Za-z0-9%)\]])\s?(?:으로|에서|에게|까지|부터|이다|이며|이고|이면|은|는|이|가|을|를|의|에|로|와|과|도|만)(?=[\s·,.)\]:—-]|$)/g;

  function fill(tpl, nums) { var i = 0; return tpl.replace(/\{n\}/g, function () { return i < nums.length ? nums[i++] : ""; }); }
  function tr(s) {
    if (!s || !HANGUL.test(s) || !T) return s;
    var c = cache.get(s); if (c !== undefined) return c;
    var lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim();
    var nums = core.match(NUM) || [], key = core.replace(NUM, "{n}"), out = null;
    if (Object.prototype.hasOwnProperty.call(T, key)) out = fill(T[key], nums);
    else if (core.length > 160) out = core;   // 긴 자동 생성 글(월간 리포트 등)은 단어만 바꾸면 한영이 섞여 더 읽기 어렵다 — 사전에 없으면 원문
    else {
      out = GRE ? core.replace(GRE, function (m) { return G[m] != null ? G[m] : m; }) : core;
      for (var k = 0; k < UNITS.length; k++) out = out.replace(UNITS[k][0], UNITS[k][1]);
      out = out.replace(PART, "$1");
    }
    out = lead + out + trail;
    if (cache.size > 20000) cache.clear();
    cache.set(s, out);
    return out;
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1 };
  var lastSet = new WeakMap();   // 우리가 쓴 값 — 같은 값으로 다시 오면 건너뛴다(자기 변경 고리 방지)
  var ATTRS = ["title", "placeholder", "aria-label"];
  function doText(n) {
    var v = n.nodeValue;
    if (!v || !HANGUL.test(v) || lastSet.get(n) === v) return;
    var p = n.parentElement;
    if (!p || SKIP[p.tagName] || p.closest("[data-noi18n]")) return;
    var o = tr(v);
    if (o !== v) { lastSet.set(n, o); n.nodeValue = o; }
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (v && HANGUL.test(v)) { var o = tr(v); if (o !== v) el.setAttribute(a, o); }
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 || SKIP[root.tagName]) return;
    doAttrs(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT), n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else if (!SKIP[n.tagName]) doAttrs(n); }
  }

  var pend = new Set(), timer = 0;
  function flush() { timer = 0; var a = Array.from(pend); pend.clear(); for (var i = 0; i < a.length; i++) if (a[i].isConnected) walk(a[i]); }
  function queue(n) { pend.add(n); if (!timer) timer = setTimeout(flush, 60); }

  function start() {
    document.documentElement.setAttribute("lang", "en");
    walk(document.body);
    if (document.title && HANGUL.test(document.title)) document.title = tr(document.title);
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === "characterData") queue(m.target);
        else if (m.type === "attributes") queue(m.target);
        else for (var j = 0; j < m.addedNodes.length; j++) queue(m.addedNodes[j]);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function load() {
    var ver = (document.querySelector('meta[name="lux-build"]') || {}).content || "";
    fetch("/i18n-en.json?v=" + encodeURIComponent(ver)).then(function (r) { return r.json(); }).then(function (d) {
      T = d.t || {}; G = d.g || {};
      var ks = Object.keys(G).sort(function (a, b) { return b.length - a.length; })
        .map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
      // 단어 경계에서만 — 앞이 한글이 아니고, 뒤가 (조사 하나를 지나) 한글이 아닐 때. 'HD한국조선해양' 같은 종목명 안은 건드리지 않는다
      GRE = ks.length ? new RegExp("(?<![가-힣])(?:" + ks.join("|") + ")(?=(?:으로|에서|은|는|이|가|을|를|의|에|로|와|과|도|만)?(?![가-힣]))", "g") : null;
      if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
    }).catch(function () {});
  }

  window.luxLang = {
    get: function () { return lang; },
    set: function (l) { try { localStorage.setItem(KEY, l === "en" ? "en" : "ko"); } catch (e) {} location.reload(); },
    t: function (s) { return lang === "en" ? tr(s) : s; }
  };
  function label() {
    var b = document.getElementById("btnLang");
    if (b) { b.textContent = lang === "en" ? "🌐 한국어" : "🌐 English"; b.onclick = function () { window.luxLang.set(lang === "en" ? "ko" : "en"); }; }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", label); else label();
  if (lang === "en") load();
})();
