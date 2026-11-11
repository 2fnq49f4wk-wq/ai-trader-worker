/* [UI1 motion] anime.js(vendor 로컬) 모션 — 사이드바/폰 탭 미끄럼 표시기 · 페이지 전환 · 카드 등장 · 숫자 카운트업 · 첫 방문 소개 마무리.
   첫 페인트를 막지 않는다(defer + 유휴 때 anime 로드). anime 가 없거나 모션 줄이기면 CSS 전환/무동작으로 안전하게 물러난다. */
(function () {
  "use strict";
  var D = document, H = D.documentElement, RM = false;
  try { RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  var lastIn = 0;
  ["pointerdown", "keydown", "touchstart"].forEach(function (t) { addEventListener(t, function () { lastIn = Date.now(); }, { passive: true, capture: true }); });
  function A() { return window.anime || null; }
  function $(s, r) { return (r || D).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || D).querySelectorAll(s)); }

  /* 미끄러지는 알약 표시기 */
  function Pill(host, itemSel, rectOf, pad) {
    var pill = D.createElement("i"); pill.className = "lux-pill"; pill.setAttribute("aria-hidden", "true");
    host.insertBefore(pill, host.firstChild);
    var cur = null, first = true;
    function place(animate) {
      var act = $(itemSel + ".active", host), r = act && rectOf(act);
      if (!r || !r.w) { pill.classList.remove("on"); cur = null; return; }
      var x = r.x - pad[0], y = r.y - pad[1], w = r.w + pad[0] * 2, h = r.h + pad[1] * 2, a = A();
      if (first || !animate || RM || !a || !cur) {
        pill.style.transition = "none"; pill.style.width = w + "px"; pill.style.height = h + "px"; pill.style.transform = "translateX(" + x + "px) translateY(" + y + "px)";
        void pill.offsetWidth; pill.style.transition = ""; pill.classList.add("on");
      } else {
        a.remove(pill);
        /* [UI3] 액체 늘어났다 자리잡기: 움직이는 방향으로 길게 늘어났다가(stretch) 스프링으로 되돌아온다(settle) */
        var m = pill._m || { x: x, y: y }, dx = Math.abs(x - m.x), dy = Math.abs(y - m.y), st = 1 + Math.min(0.38, Math.max(dx, dy) / 520);
        var ax = dx >= dy ? "scaleX" : "scaleY", o = { targets: pill, translateX: x, translateY: y, width: w, height: h, duration: 760, easing: "spring(1, 90, 12, 0)" };
        o[ax] = [{ value: st, duration: 170, easing: "easeOutQuad" }, { value: 1, duration: 620, easing: "spring(1, 120, 9, 0)" }];
        a(o);
      }
      if (animate && !RM && a && act !== cur) pop(act);
      pill._m = { x: x, y: y }; cur = act; first = false;
    }
    function pop(act) {
      var a = A(); if (!a) return;
      var ic = $(".nav-item-icon,.ic", act), tx = $(".nav-item-label,.tx", act);
      if (ic) a({ targets: ic, scale: [0.72, 1], duration: 650, easing: "spring(1, 80, 9, 0)" });
      if (tx) a({ targets: tx, opacity: [0.3, 1], duration: 380, easing: "easeOutQuad" });
    }
    var q = 0; function sched(anim) { if (q) return; q = requestAnimationFrame(function () { q = 0; place(anim); }); }
    new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) if (ms[i].attributeName === "class" && ms[i].target !== pill) { sched(true); return; } })
      .observe(host, { subtree: true, attributes: true, attributeFilter: ["class"] });
    addEventListener("resize", function () { first = true; sched(false); }, { passive: true });
    if (D.fonts && D.fonts.ready) D.fonts.ready.then(function () { first = true; sched(false); });
    H.classList.add("lux-ind"); place(false);
  }
  function mountPills() {
    var nav = $(".sb-nav"), tb = $(".m-tabbar"), ok = false;
    if (nav) { ok = true; if (!$(".lux-pill", nav)) Pill(nav, ".nav-item", function (a) { return { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight }; }, [0, 0]); }
    /* [V33.813] 폰 아래 탭은 떠다니는 알약을 쓰지 않는다 — 아이폰 사파리에서 위치를 잘못 재(줌·safe-area) 엉뚱한 곳에 가고 파란 불이 안 켜졌다. 활성 탭 아이콘 자체를 CSS 로 칠한다. */
    if (tb) { ok = true; tabPill(tb); }
    if (false && tb) { if (!$(".lux-pill", tb)) Pill(tb, ".m-tab", function (act) { var ic = $(".ic", act) || act; return { x: act.offsetLeft + ic.offsetLeft, y: act.offsetTop + ic.offsetTop, w: ic.offsetWidth, h: ic.offsetHeight }; }, [4, 2]); }
    return ok;
  }

  /* [V33.820] 폰 아래 탭 미끄럼 표시(사용자 11/11 "패드 사이드바 버튼처럼 스무스하게") — 예전 알약은 offsetLeft 로 재서 아이폰(축소 보기·safe-area)에서
     엉뚱한 곳에 갔다. 이번엔 화면 좌표(getBoundingClientRect)를 탭바 기준으로 빼고 탭바 배율로 나눠 놓는다 · 움직임은 CSS transform 전환만(anime 불필요). */
  function tabPill(tb) {
    if ($(".lux-tpill", tb)) return;
    var p = D.createElement("i"); p.className = "lux-tpill"; p.setAttribute("aria-hidden", "true"); tb.insertBefore(p, tb.firstChild);
    /* [V33.824] 화면을 바꾸는 동안 위치를 재지 않는다 — V33.823 은 누를 때·200ms·760ms 마다 getBoundingClientRect 로 다시 재서
       화면 전환 중 문서 전체 배치를 2~3번 더 시켰다(폰 실측 한 번 160~190ms). 이제 탭 크기·아이콘 자리는 화면이 조용할 때 한 번 재어 CSS 변수로 두고,
       누르면 몇 번째 탭인지(--tp-i)만 바꾼다 → 이동은 CSS transform 전환(합성기)이라 화면을 그리는 동안에도 부드럽다. 느리고 부드러운 곡선(0.65s). */
    function tabs() { return $$(".m-tab", tb).filter(function (t) { return t.style.display !== "none"; }); }
    function measure() {
      var ts = tabs(), t0 = ts[0]; if (!t0 || !t0.offsetWidth) return;
      var ic = $(".ic", t0) || t0, st = tb.style;
      st.setProperty("--tp-l", t0.offsetLeft + "px"); st.setProperty("--tp-tw", (ts[1] ? ts[1].offsetLeft - t0.offsetLeft : t0.offsetWidth) + "px");
      st.setProperty("--tp-x", (ic === t0 ? 0 : ic.offsetLeft) + "px"); st.setProperty("--tp-y", (ic === t0 ? 0 : ic.offsetTop) + "px");
      st.setProperty("--tp-w", ic.offsetWidth + "px"); st.setProperty("--tp-h", ic.offsetHeight + "px");
      H.classList.add("lux-tpill-on");
    }
    function setI(t) { var i = tabs().indexOf(t); if (i < 0) return; tb.style.setProperty("--tp-i", i); p.classList.add("on"); }
    tb.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest(".m-tab"); if (!t || t.getAttribute("data-more") || t.getAttribute("data-search")) return;
      setI(t);
    }, true);
    new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) if (ms[i].target !== p) { var a = $(".m-tab.active", tb); if (a) setI(a); return; } })
      .observe(tb, { subtree: true, attributes: true, attributeFilter: ["class"] });
    var rt = 0; addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { requestAnimationFrame(measure); }, 400); }, { passive: true });
    p.style.transition = "none"; measure(); var a0 = $(".m-tab.active", tb); if (a0) setI(a0);
    requestAnimationFrame(function () { requestAnimationFrame(function () { p.style.transition = ""; }); });
  }

  /* 페이지 전환 */
  function pageFx() {
    var seen = null;
    if (innerWidth <= 760) return;   /* [V33.813] 폰은 화면 전환 애니메이션을 끈다(아이폰 전환 렉) */
    var mo = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var p = ms[i].target;
        if (!p.classList || !p.classList.contains("page") || !p.classList.contains("active") || p === seen) continue;
        seen = p;
        if (RM || p.id === "page-detail" || Date.now() - lastIn > 1500) continue;
        var a = A();
        if (a) a({ targets: p, opacity: [0, 1], translateY: [12, 0], duration: 380, easing: "easeOutCubic", complete: function () { p.style.transform = ""; p.style.opacity = ""; } });
        else if (p.animate) p.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(.22,.9,.3,1)" });
      }
    });
    $$(".page").forEach(function (pg) { mo.observe(pg, { attributes: true, attributeFilter: ["class"] }); });   /* 페이지 요소만 본다 */
  }

  /* 카드 등장(한 번) · 숫자 카운트업(한 번) */
  var staggered = {}, counted = {};
  function stagger(key, sel, root) {
    if (staggered[key] || RM) return;
    var els = $$(sel, root).filter(function (e) { return e.offsetHeight > 0; }).slice(0, 24);
    if (!els.length) return; staggered[key] = 1;
    var a = A();
    var clear = function () { els.forEach(function (e) { e.style.opacity = ""; e.style.transform = ""; }); };
    if (a) { els.forEach(function (e) { e.style.opacity = "0"; }); a({ targets: els, opacity: [0, 1], translateY: [16, 0], delay: a.stagger(55), duration: 520, easing: "easeOutCubic", complete: clear }); setTimeout(clear, 2600); }
    else els.forEach(function (e, i) { if (e.animate) e.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: i * 45, easing: "ease-out", fill: "backwards" }); });
  }
  var NUM = /^([^\d+\-−]*)([+\-−]?)(\d[\d,]*(?:\.\d+)?)(.*)$/;
  function countUp(key, sel, root) {
    if (counted[key] || RM) return;
    var els = $$(sel, root).filter(function (e) { return e.offsetHeight > 0 && NUM.test((e.textContent || "").trim()); }).slice(0, 12);
    if (!els.length) return; counted[key] = 1;
    var a = A(); if (!a) return;
    els.forEach(function (el) {
      var txt = el.textContent.trim(), m = txt.match(NUM), raw = m[3], dec = (raw.split(".")[1] || "").length, comma = raw.indexOf(",") >= 0, to = parseFloat(raw.replace(/,/g, "")), o = { v: 0 };
      var fmt = function (v) { var s = v.toFixed(dec); if (comma) { var pp = s.split("."); pp[0] = pp[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); s = pp.join("."); } return m[1] + m[2] + s + m[4]; };
      var w = el.offsetWidth; if (w) el.style.minWidth = w + "px";
      a({ targets: o, v: to, duration: 1100, easing: "easeOutExpo", update: function () { el.textContent = fmt(o.v); }, complete: function () { el.textContent = txt; el.style.minWidth = ""; } });
    });
  }
  function dashFx() {
    var tries = 0;
    (function tick() {
      var ez = $("#easyDash"), pro = $("#page-dashboard");
      if (pro && pro.classList.contains("active")) {
        if (H.classList.contains("lux-easy")) {
          if (ez && ez.offsetHeight > 0 && $(".c", ez)) { stagger("ez", ".hd,.ix,.c,.bri", ez); setTimeout(function () { countUp("ezix", ".ix .v", ez); }, 250); }
        } else { stagger("pro", ".idx-card,.fv-panel", pro); setTimeout(function () { countUp("proix", ".idx-card .idx-price", pro); }, 250); }
      }
      if (++tries < 80 && !((staggered.ez || staggered.pro) && (counted.ezix || counted.proix))) setTimeout(tick, 600);
    })();
  }

  /* 소개 배너 마무리(인라인 CSS 로 이미 그려져 있음) */
  function heroFx() {
    var h = $("#luxHero"); if (!h || !H.classList.contains("lux-hero")) return;
    var a = A(); if (!a || RM) return;
    if (false) a({ targets: $$(".lh-chip", h), translateY: [-3, 3], direction: "alternate", loop: true, delay: a.stagger(300), duration: 1800, easing: "easeInOutSine" });
    var n = $(".lh-num", h);
    if (n) { var o = { v: 0 }; a({ targets: o, v: 48785, duration: 1800, delay: 500, round: 1, easing: "easeOutExpo", update: function () { n.textContent = "$" + String(o.v).replace(/\B(?=(\d{3})+(?!\d))/g, ","); } }); }
  }
  window.luxHeroOut = function (done) {
    var h = $("#luxHero"), a = A();
    if (!h) { done && done(); return; }
    if (a && !RM) a({ targets: h, opacity: 0, duration: 200, easing: "easeInQuad", complete: function () { done && done(); } });
    else { h.style.transition = "opacity .25s"; h.style.opacity = "0"; setTimeout(function () { done && done(); }, 260); }
  };

  function loadAnime(cb) {
    if (window.anime) return cb();
    var s = D.createElement("script"); s.src = "/vendor/anime.min.js?v=3.2.2"; s.async = true; s.onload = cb; s.onerror = function () {}; D.head.appendChild(s);
  }
  function init() {
    var tries = 0;
    (function m() { if (!mountPills() && ++tries < 40) setTimeout(m, 300); })();
    pageFx(); dashFx();
    loadAnime(heroFx);
  }
  window.luxMotion = { A: A };
  function boot() { (window.requestIdleCallback || function (f) { setTimeout(f, 200); })(init, { timeout: 1500 }); }
  if (D.readyState === "complete") boot(); else addEventListener("load", boot);
})();
