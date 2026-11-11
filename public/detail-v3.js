/* [UI v3] 종목 상세 — 글래스 히어로(라이브 점 · 카운트업 가격 · 그려지는 스파크라인) · 기간 탭 알약 · 스티키 컴팩트 · 주문 버튼 이동 · 모션 도우미.
   · 모션: window.anime 이 있으면 숫자 카운트업에 쓰고(v3·v4 둘 다), 없으면 rAF/Web Animations. prefers-reduced-motion 이면 움직임 없이 바로 결과를 보인다.
   · 새 요청 없음: 스파크라인은 AI 분석 탭이 받는 /api/chart?range=1y&interval=1d 와 같은 주소(캐시 공유). 시세는 이미 받은 window.__lastQuotesArr 재사용.
   · 기존 id(#detailSym · #detailPrice · #detailChange · #mineDetailBar …)는 그대로 두고 겉모양과 위치만 바꾼다. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var rm = function () { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
  var ease = function (t) { return 1 - Math.pow(1 - t, 4); };
  function tween(dur, fn, done) {
    var A = window.anime;
    try {
      if (A && typeof A === "function") { var o = { v: 0 }; A({ targets: o, v: 1, duration: dur, easing: "easeOutExpo", update: function () { fn(o.v); }, complete: function () { fn(1); done && done(); } }); return; }
      if (A && typeof A.animate === "function") { var q = { v: 0 }; A.animate(q, { v: 1, duration: dur, ease: "outExpo", onUpdate: function () { fn(q.v); }, onComplete: function () { fn(1); done && done(); } }); return; }
    } catch (e) {}
    var t0 = 0; function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur); fn(ease(p)); if (p < 1) requestAnimationFrame(step); else done && done(); } requestAnimationFrame(step);
  }
  function countOne(el, dur) {
    var txt = el.textContent, m = /(\d[\d,]*\.?\d*)/.exec(txt); if (!m) return;
    var raw = m[1], v = parseFloat(raw.replace(/,/g, "")); if (!(v > 0) || !isFinite(v)) return;
    var dec = (raw.split(".")[1] || "").length, comma = raw.indexOf(",") >= 0, pre = txt.slice(0, m.index), post = txt.slice(m.index + raw.length);
    var fmt = function (x) { var s = x.toFixed(dec); if (comma) { var p = s.split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); s = p.join("."); } return pre + s + post; };
    tween(dur || 800, function (k) { el.textContent = k >= 1 ? txt : fmt(v * k); });
  }
  function countAll(list) { if (rm()) return; [].forEach.call(list || [], function (el, i) { if (el.children.length) return; setTimeout(function () { countOne(el, 700); }, Math.min(i, 8) * 40); }); }
  function grow(list) {   // 막대·링이 0 에서 제 길이로 자란다
    if (rm()) return;
    [].forEach.call(list || [], function (el) {
      if (!el.animate) return;
      if (el.tagName && el.tagName.toLowerCase() === "circle") { var da = el.getAttribute("stroke-dasharray") || ""; var a = parseFloat(da); if (a > 0) el.animate([{ strokeDasharray: "0 999" }, { strokeDasharray: da }], { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)" }); return; }
      el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 800, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
  }
  window.dv3Motion = { tween: tween, countAll: countAll, countOne: countOne, grow: grow };

  /* ── 히어로 ── */
  var curSym = null, sparkSeq = 0, priceFor = null, busy = false;
  var isKr = function (s) { return /\.(KS|KQ)$/.test(s || ""); };
  function quote(s) { var a = window.__lastQuotesArr || []; for (var i = 0; i < a.length; i++) if (a[i].symbol === s) return a[i]; return null; }
  function liveLabel() {
    var el = $("dv3Live"), s = curSym; if (!el || !s) return; var q = quote(s), st = q && q.mstate, ko, en, cls = "off";
    if (st === "REGULAR") { ko = "장중 · LIVE"; en = "LIVE"; cls = "on"; }
    else if (st === "PRE") { ko = "프리마켓"; en = "Pre-market"; cls = "ext"; }
    else if (st === "POST" || st === "POSTPOST") { ko = "시간외"; en = "After hours"; cls = "ext"; }
    else if (st === "CLOSED") { ko = "장 마감"; en = "Closed"; }
    else { ko = isKr(s) ? "한국장" : "미국장"; en = isKr(s) ? "KR market" : "US market"; }
    el.className = "dv3-live " + cls; el.title = ko; var b = el.querySelector("b"); if (b) { b.textContent = ko; b.setAttribute("data-en", en); }
  }
  function spark(s) {
    var svg = $("dv3Spark"); if (!svg) return; var seq = ++sparkSeq; svg.innerHTML = ""; svg.removeAttribute("data-dir");
    fetch("/api/chart?symbol=" + encodeURIComponent(s) + "&range=1y&interval=1d").then(function (r) { return r.json(); }).then(function (j) {
      if (seq !== sparkSeq || s !== curSym) return;
      var cl = ((j && j.candles) || []).map(function (b) { return b && b.c; }).filter(function (v) { return v > 0; }).slice(-60); if (cl.length < 8) return;
      var W = 320, H = 84, P = 6, lo = Math.min.apply(null, cl), hi = Math.max.apply(null, cl), sp = hi - lo || 1, n = cl.length;
      var X = function (i) { return (i * W / (n - 1)).toFixed(1); }, Y = function (v) { return (P + (hi - v) / sp * (H - 2 * P - 6)).toFixed(1); };
      var d = ""; cl.forEach(function (v, i) { d += (i ? "L" : "M") + X(i) + " " + Y(v); });
      var dir = cl[n - 1] >= cl[0] ? "pos" : "neg"; svg.setAttribute("data-dir", dir);
      svg.innerHTML = '<defs><linearGradient id="dv3Ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s0"/><stop offset="1" class="s1"/></linearGradient></defs>' +
        '<path class="ar" d="' + d + "L" + W + " " + H + "L0 " + H + 'Z" fill="url(#dv3Ga)"/><path class="ln" d="' + d + '" fill="none" vector-effect="non-scaling-stroke"/>' +
        '<circle class="dot" cx="' + X(n - 1) + '" cy="' + Y(cl[n - 1]) + '" r="3.4"/>';
      var ln = svg.querySelector(".ln"), ar = svg.querySelector(".ar"), dot = svg.querySelector(".dot");
      if (!rm() && ln.animate && ln.getTotalLength) {
        var L = ln.getTotalLength(); ln.style.strokeDasharray = L; ln.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 1100, easing: "cubic-bezier(.3,.7,.2,1)" });
        ar.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1100, delay: 250, easing: "ease-out", fill: "backwards" }); dot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 950, fill: "backwards" });
      }
    }).catch(function () {});
  }
  function symChanged() {
    var el = $("detailSym"), s = el && el.textContent.trim(); if (!s || s === "—" || s === curSym) return;
    curSym = s; priceFor = null; liveLabel(); spark(s); place(false);
  }
  function priceChanged() {
    var el = $("detailPrice"); if (!el || busy || !curSym || priceFor === curSym || !/\d/.test(el.textContent)) return;
    priceFor = curSym; if (rm()) return; busy = true; var txt = el.textContent;
    var m = /(\d[\d,]*\.?\d*)/.exec(txt); if (!m) { busy = false; return; }
    var raw = m[1], v = parseFloat(raw.replace(/,/g, "")), dec = (raw.split(".")[1] || "").length, comma = raw.indexOf(",") >= 0, pre = txt.slice(0, m.index), post = txt.slice(m.index + raw.length);
    tween(900, function (k) { var s = (v * k).toFixed(dec); if (comma) { var p = s.split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); s = p.join("."); } el.textContent = k >= 1 ? txt : pre + s + post; }, function () { busy = false; });
  }
  function moveBar() { var bar = $("mineDetailBar"), act = $("dv3Act"); if (bar && act && bar.parentNode !== act) act.appendChild(bar); }

  /* ── 기간 탭 알약(미끄러지는 표시) ── */
  var pill = null, last = null;
  function place(anim) {
    var tf = $("detailTf"); if (!tf) return; var on = tf.querySelector(".detail-tf-btn.active");
    if (!pill) { pill = document.createElement("span"); pill.className = "dv3-tfpill"; pill.setAttribute("aria-hidden", "true"); tf.insertBefore(pill, tf.firstChild); }
    if (!on || !on.offsetWidth) return;
    var r = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
    pill.style.width = r.w + "px"; pill.style.height = r.h + "px"; pill.style.transform = "translate(" + r.x + "px," + r.y + "px)"; if (!pill.classList.contains("on")) pill.classList.add("on");
    if (anim && last && !rm() && pill.animate) pill.animate([{ transform: "translate(" + last.x + "px," + last.y + "px)", width: last.w + "px", height: last.h + "px" }, { transform: "translate(" + r.x + "px," + r.y + "px)", width: r.w + "px", height: r.h + "px" }], { duration: 320, easing: "cubic-bezier(.3,.9,.3,1)" });
    last = r;
  }

  /* ── 스티키 컴팩트 헤더(패드·PC) ── */
  var compact = false, ticking = false, stk = null, stkTop = null, hh = null;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false; var pg = $("page-detail"); if (!pg || !pg.classList.contains("active")) return;   /* [UI6] 상세 화면이 아닐 땐 아무것도 안 잰다 */
      var hd = pg.querySelector(".detail-head"), dc = $("detailContent"); if (!hd || !dc || !dc.offsetParent) return;
      if (stk === null) stk = getComputedStyle(hd).position === "sticky";   /* 위치 방식은 화면 폭이 바뀔 때(resize)만 다시 읽는다 */
      if (!stk) { if (compact) { compact = false; hd.classList.remove("dv3-compact"); } return; }
      var scrolled = (stkTop === null ? (stkTop = parseFloat(getComputedStyle(hd).top) || 0) : stkTop) - dc.getBoundingClientRect().top;
      var was = compact;
      /* [V33.820] 머리 줄이기를 끈다 — 55↔46px 로 바뀌며 맨 위로 올라올 때 화면이 '퉁' 튕겼다(머리가 이미 작아 줄일 이유도 없다) */
      if (false && !compact && scrolled > 150) { compact = true; hd.classList.add("dv3-compact"); } else if (compact && scrolled < 60) { compact = false; hd.classList.remove("dv3-compact"); }
      if (was !== compact || hh === null) { var h = Math.round(hd.getBoundingClientRect().height); hh = h; if (pg.style.getPropertyValue("--dv-hh") !== h + "px") pg.style.setProperty("--dv-hh", h + "px"); if (was !== compact) setTimeout(function () { hh = null; onScroll(); }, 300); }
    });
  }

  function init() {
    var sy = $("detailSym"), pr = $("detailPrice"), dc = $("detailContent"), tf = $("detailTf");
    if (!sy || !pr) return;
    new MutationObserver(function () { symChanged(); priceChanged(); }).observe(sy, { childList: true, characterData: true, subtree: true });
    new MutationObserver(priceChanged).observe(pr, { childList: true, characterData: true, subtree: true });
    var oh = $("detailOhlc"), hd = oh && oh.closest(".detail-head");   // 시고저종 칩은 좁은 머리에 안 들어가 툴팁(title)로 — 같은 값이 '시세 데이터' 창에도 있다
    if (oh && hd) { var tip = function () { var t = oh.textContent.replace(/\s+/g, " ").trim(); if (hd.title !== t) hd.title = t; }; new MutationObserver(tip).observe(oh, { childList: true, characterData: true, subtree: true }); tip(); }
    if (dc) new MutationObserver(moveBar).observe(dc, { childList: true });
    if (tf) { new MutationObserver(function () { place(true); }).observe(tf, { attributes: true, attributeFilter: ["class"], subtree: true }); if (window.ResizeObserver) new ResizeObserver(function () { place(false); }).observe(tf); }
    addEventListener("resize", function () { stk = stkTop = hh = null; place(false); onScroll(); }); addEventListener("scroll", onScroll, { passive: true, capture: true });
    setInterval(liveLabel, 20000); moveBar(); symChanged(); priceChanged(); place(false); onScroll();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
