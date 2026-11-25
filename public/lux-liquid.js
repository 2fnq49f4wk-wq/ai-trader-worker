/* [V33.866] ★리퀴드 글라스 굴절★ — 블러 대신 '뒤 화면이 유리 가장자리에서 휘어 보이는' 진짜 유리(lux-liquid.css 주석).
   방법: 대상마다 크기에 맞는 변위맵(둥근 사각형의 가장자리 띠에서 안쪽으로 미는 볼록 렌즈 기울기)을 캔버스로 그려
   SVG <filter>(feImage → feDisplacementMap, R·G·B 를 조금씩 다른 세기로 휘어 가장자리 무지개 분산)를 만들고
   backdrop-filter:url(#…) 로 건다. url() backdrop-filter 는 크롬 계열만 그린다 → 크롬·엣지 데스크톱에서만 굴절,
   사파리·파이어폭스·폰은 빛 테두리(.lg-rim)만(성능 그대로).
   비용: 화면 안에 보이는 대상만 굴절(IntersectionObserver · 최대 14개) · 맵은 크기(2px 단위)별 1회 · 서버 0. */
(function () {
  "use strict";
  var D = document, H = D.documentElement;
  var SEL = "nav.sidebar,#luxTopbar,.fv-idx,.fv-breadth,.fv-panel,#easyDash .ix,#easyDash .bri,#easyDash .c,.dash-block,#pbObs .k-panel,#settingsModal .modal-content,.modal-content";
  var RM = false, RT = false;
  try { RM = matchMedia("(prefers-reduced-motion: reduce)").matches; RT = matchMedia("(prefers-reduced-transparency: reduce)").matches; } catch (e) {}
  if (RT) return;
  var fine = false; try { fine = matchMedia("(pointer: fine) and (min-width: 900px)").matches; } catch (e) {}
  var chromium = !!(navigator.userAgentData && navigator.userAgentData.brands && navigator.userAgentData.brands.some(function (b) { return /Chromium|Chrome|Edge/.test(b.brand); }));
  var REFR = chromium && fine && !navigator.userAgentData.mobile && (navigator.hardwareConcurrency || 4) >= 4;
  try { var _o = localStorage.getItem("luxGlass"); if (_o === "off" || (_o && +_o > Date.now())) REFR = false; } catch (e) {}   // "off" = 사용자 끔 · 숫자 = 프레임 가드가 끈 기한
  H.classList.add("lg-on"); if (REFR) H.classList.add("lg-refr");

  var NS = "http://www.w3.org/2000/svg", svg = null, defs = null, maps = {}, live = 0, MAXLIVE = 14;
  function ensureSvg() {
    if (svg) return;
    svg = D.createElementNS(NS, "svg"); svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none");
    defs = D.createElementNS(NS, "defs"); svg.appendChild(defs); D.body.appendChild(svg);
  }
  /* 둥근 사각형 SDF(안쪽 음수) → 가장자리 띠(bz px)에서 안쪽 법선 방향으로 미는 세기. 볼록 렌즈(스쿼클 높이 h=(1-(1-t)^4)^¼)의 기울기 꼴. */
  function mapUrl(w, h, r, bz) {
    var s = Math.min(1, 256 / Math.max(w, h)), cw = Math.max(8, Math.round(w * s)), ch = Math.max(8, Math.round(h * s));
    var c = D.createElement("canvas"); c.width = cw; c.height = ch;
    var g = c.getContext("2d"), im = g.createImageData(cw, ch), d = im.data;
    var hw = w / 2, hh = h / 2, rr = Math.min(r, hw, hh);
    for (var y = 0; y < ch; y++) {
      for (var x = 0; x < cw; x++) {
        var px = (x + .5) / s - hw, py = (y + .5) / s - hh;
        var qx = Math.abs(px) - (hw - rr), qy = Math.abs(py) - (hh - rr);
        var ox = Math.max(qx, 0), oy = Math.max(qy, 0), ol = Math.sqrt(ox * ox + oy * oy);
        var dist = -(ol + Math.min(Math.max(qx, qy), 0) - rr);   // 가장자리까지 거리(안쪽 양수)
        var nx = 0, ny = 0;
        if (ol > 0) { nx = ox / ol; ny = oy / ol; } else if (qx > qy) nx = 1; else ny = 1;
        nx *= px < 0 ? -1 : 1; ny *= py < 0 ? -1 : 1;   // 바깥 법선
        var t = Math.max(0, Math.min(1, dist / bz)), m = 0;
        if (t < 1) { var u = 1 - t; m = Math.pow(u, 3) * (1 - .35 * u); }   // 가장자리에서 가장 세고 띠 안쪽에서 0
        var i = (y * cw + x) * 4;
        d[i] = Math.round(127.5 - 127 * m * nx);       // R: x 변위(안쪽에서 끌어온다 → 가장자리가 확대돼 휘어 보임)
        d[i + 1] = Math.round(127.5 - 127 * m * ny);   // G: y 변위
        d[i + 2] = 128; d[i + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    return c.toDataURL("image/png");
  }
  function filterFor(w, h, r) {
    var bw = Math.round(w / 2) * 2, bh = Math.round(h / 2) * 2, br = Math.round(r);
    var bz = Math.max(10, Math.min(28, Math.min(bw, bh) * .16)), sc = Math.round(Math.max(18, Math.min(52, bz * 1.9)));
    var key = bw + "x" + bh + "r" + br;
    if (maps[key]) return maps[key];
    ensureSvg();
    var id = "lgf-" + key, f = D.createElementNS(NS, "filter");
    f.setAttribute("id", id); f.setAttribute("x", "0"); f.setAttribute("y", "0"); f.setAttribute("width", bw); f.setAttribute("height", bh);
    f.setAttribute("filterUnits", "userSpaceOnUse"); f.setAttribute("primitiveUnits", "userSpaceOnUse"); f.setAttribute("color-interpolation-filters", "sRGB");
    var img = mapUrl(bw, bh, br, bz);
    f.innerHTML =
      '<feImage href="' + img + '" x="0" y="0" width="' + bw + '" height="' + bh + '" preserveAspectRatio="none" result="m"/>' +
      // 빛의 파장마다 굴절률이 달라 가장자리에 아주 얇은 무지개(분산) — R 은 덜, B 는 더 휜다
      '<feDisplacementMap in="SourceGraphic" in2="m" scale="' + sc + '" xChannelSelector="R" yChannelSelector="G" result="dr"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="m" scale="' + Math.round(sc * 1.08) + '" xChannelSelector="R" yChannelSelector="G" result="dg"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="m" scale="' + Math.round(sc * 1.16) + '" xChannelSelector="R" yChannelSelector="G" result="db"/>' +
      '<feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cr"/>' +
      '<feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cg"/>' +
      '<feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cb"/>' +
      '<feComposite in="cr" in2="cg" operator="arithmetic" k2="1" k3="1" result="rg"/>' +
      '<feComposite in="rg" in2="cb" operator="arithmetic" k2="1" k3="1"/>';
    defs.appendChild(f);
    return (maps[key] = id);
  }
  function blurOf(el) { return el.matches("nav.sidebar,#luxTopbar,.modal-content") ? 6 : 3; }
  /* [V33.867] 렉 수정 — 종전엔 여기서 getBoundingClientRect()+getComputedStyle() 을 대상마다 읽고 바로 style 을 써서
     '읽기→쓰기→읽기' 강제 배치가 대상 수만큼 반복됐다(데스크톱 CPU 4배 실측: 초보자→전문가 전환 때 ResizeObserver 콜백 1,081ms · 배치 916ms).
     이제 크기는 ResizeObserver/IntersectionObserver 가 이미 잰 값(el.__lgW/H)을 쓰고 둥글기는 처음 한 번만 읽는다. */
  function applyRefr(el) {
    var w = el.__lgW, h = el.__lgH; if (!w || w < 60 || h < 40) return;
    if (el.__lgRad == null) el.__lgRad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12;
    var id = filterFor(w, h, el.__lgRad);
    el.__lgKey = id;
    if (scOn) { if (!el.__lgOn) { el.__lgOn = 1; live++; } if (onEls.indexOf(el) < 0) onEls.push(el); el.classList.add("lg-r"); return; }
    var v = "url(#" + id + ") blur(" + blurOf(el) + "px) saturate(165%) brightness(1.04)";
    el.style.setProperty("-webkit-backdrop-filter", v, "important"); el.style.setProperty("backdrop-filter", v, "important");
    if (!el.__lgOn) { el.__lgOn = 1; live++; } el.classList.add("lg-r");
  }
  function dropRefr(el) {
    if (!el.__lgOn) return; el.__lgOn = 0; live--;
    el.style.removeProperty("backdrop-filter"); el.style.removeProperty("-webkit-backdrop-filter"); el.classList.remove("lg-r");
  }
  /* 굴절은 '떠 있는 유리'(사이드바·상단바·창·카드 중 지정)만 — 스크롤마다 움직이는 큰 카드 수십 장에 SVG 필터를 걸면
     헤드리스 실측 프레임 16.7→117ms. 나머지 카드는 빛 테두리만. */
  var REFR_SEL = "nav.sidebar,#luxTopbar,.modal-content,.fv-idx,#easyDash .ix";
  var io = REFR && "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var t = e.target;
      if (e.isIntersecting) { if (!t.__lgW) { t.__lgW = e.boundingClientRect.width; t.__lgH = e.boundingClientRect.height; } if (live < MAXLIVE || t.__lgOn) applyRefr(t); }
      else dropRefr(t);
    });
  }, { rootMargin: "120px 0px" }) : null;
  /* 크기가 바뀌는 동안(전문가↔초보자·창 크기·사이드바 접기)은 굴절을 내려 놓고(CSS 블러) 크기가 멈춘 뒤 260ms 에 한 번만 다시 건다 —
     크기마다 변위맵(캔버스 PNG)을 새로 만들던 것이 전환 중 여러 번 겹쳤다. 2px 안 바뀜은 무시. */
  var rzSet = [], rzT = 0;
  var ro = io && "ResizeObserver" in window ? new ResizeObserver(function (es) {
    es.forEach(function (e) {
      var t = e.target, b = e.borderBoxSize && e.borderBoxSize[0], w = b ? b.inlineSize : e.contentRect.width, h = b ? b.blockSize : e.contentRect.height;
      if (Math.abs(w - (t.__lgW || 0)) < 2 && Math.abs(h - (t.__lgH || 0)) < 2) return;
      t.__lgW = w; t.__lgH = h;
      if (!t.__lgOn) return;
      if (rzSet.indexOf(t) < 0) { rzSet.push(t); t.style.removeProperty("backdrop-filter"); t.style.removeProperty("-webkit-backdrop-filter"); }
    });
    if (rzSet.length) { clearTimeout(rzT); rzT = setTimeout(function () { var l = rzSet; rzSet = []; requestAnimationFrame(function () { l.forEach(function (el) { if (el.__lgOn && !scOn) applyRefr(el); }); }); }, 260); }
  }) : null;

  /* 스크롤 중에는 굴절을 잠깐 내려 놓는다(CSS 블러로 돌아감 · 멈추고 180ms 뒤 다시) — SVG 필터는 GPU 가 없는 기기에서
     매 프레임 다시 그려져 무겁다(헤드리스 실측 33~50ms/프레임). 굴절은 가장자리 10~28px 띠라 스크롤 중 차이는 거의 안 보인다. */
  var scT = 0, scOn = false, onEls = [];
  function scPause() {
    if (!scOn) { scOn = true; onEls = []; D.querySelectorAll(".lg-r").forEach(function (el) { onEls.push(el); el.style.removeProperty("backdrop-filter"); el.style.removeProperty("-webkit-backdrop-filter"); }); }
    clearTimeout(scT); scT = setTimeout(function () { scOn = false; onEls.forEach(function (el) { if (el.__lgOn) applyRefr(el); }); onEls = []; }, 180);
  }
  if (io) addEventListener("scroll", scPause, { passive: true, capture: true });
  /* ★프레임 가드★ — 켠 뒤 1.5초 동안 실제 프레임 간격을 재서 중앙값이 22ms(≈45fps)를 넘으면 이 기기에서는 굴절을 끄고
     7일 동안 다시 켜지 않는다(빛 테두리·CSS 블러는 그대로). GPU 가 없는 기기에서 헤드리스 실측 16.7→33~50ms 였다. */
  function guard() {
    if (!io || !live) return;
    if (D.visibilityState !== "visible") { D.addEventListener("visibilitychange", function v() { if (D.visibilityState === "visible") { D.removeEventListener("visibilitychange", v); setTimeout(guard, 1000); } }); return; }
    var f = [], t0 = 0, last = 0;
    requestAnimationFrame(function step(t) {
      if (!t0) { t0 = last = t; } else { f.push(t - last); last = t; }
      if (t - t0 < 1500) return requestAnimationFrame(step);
      if (D.visibilityState !== "visible") return setTimeout(guard, 1000);   // 재는 도중 탭이 가려지면 무효
      f.sort(function (a, b) { return a - b; }); var med = f[f.length >> 1] || 0;
      if (med > 22) {
        REFR = false; H.classList.remove("lg-refr"); io.disconnect(); if (ro) ro.disconnect();
        D.querySelectorAll(".lg-r").forEach(dropRefr);
        try { localStorage.setItem("luxGlass", String(Date.now() + 7 * 864e5)); } catch (e) {}
      }
      window.luxGlass.frameMs = +med.toFixed(1);
    });
  }

  /* 포인터를 따라가는 반짝임(데스크톱) — 올라가 있는 대상 하나만 rAF 로 변수 2개 갱신 */
  var hot = null, px = 0, py = 0, raf = 0;
  function glint() { raf = 0; if (!hot) return; var rc = hot.getBoundingClientRect(), rim = hot.__lgRim; if (!rim || !rc.width) return;
    rim.style.setProperty("--lgx", ((px - rc.left) / rc.width * 100).toFixed(1) + "%"); rim.style.setProperty("--lgy", ((py - rc.top) / rc.height * 100).toFixed(1) + "%"); }
  if (fine && !RM) {
    D.addEventListener("pointermove", function (e) {
      var t = e.target && e.target.closest ? e.target.closest(".lg-t") : null;
      if (hot && hot !== t && hot.__lgRim) { hot.__lgRim.style.removeProperty("--lgx"); hot.__lgRim.style.removeProperty("--lgy"); }
      hot = t; px = e.clientX; py = e.clientY; if (hot && !raf) raf = requestAnimationFrame(glint);
    }, { passive: true });
  }

  /* [V33.867] 렉 수정 — 종전엔 새 대상마다 자손 전체(querySelectorAll('*'))의 getComputedStyle 을 읽었다. 초보자 대시보드는 시세가 올 때마다
     카드를 새로 그려 매번 다시 훑었다(데스크톱 CPU 4배 실측: 유휴 콜백 165ms · 강제 스타일 계산 반복). 같은 태그·클래스의 대상은 결과가 같으므로
     처음 한 번만 판정해 기억한다(kind 캐시). */
  var kindOk = {}, kindRad = {};
  function adopt(el) {
    if (el.__lg) return; el.__lg = 1;
    var kind = el.tagName + "#" + (el.id || "") + "." + String(el.className || "").replace(/\blg-\S+/g, "").trim();
    var sig = kind; for (var ci = 0, ch = el.children; ci < ch.length && ci < 12; ci++) sig += "|" + ch[ci].tagName + "." + ch[ci].className;   // 같은 모양 = 같은 클래스 + 같은 자식 구성(같은 .c 라도 안쪽이 다르면 따로 판정)
    var ok = kindOk[sig];
    if (ok == null) {
      var pos = getComputedStyle(el).position; ok = pos !== "static" ? 1 : 0;
      if (!ok) {   // 안쪽에 절대배치가 없을 때만 relative 로(있으면 위치 기준이 바뀌어 흔들린다 → 빛 테두리 생략 · 굴절만)
        var any = false, k = el.querySelectorAll("*");
        for (var i = 0; i < k.length && !any; i++) { var ps = getComputedStyle(k[i]).position; any = ps === "absolute" || ps === "fixed"; }
        ok = any ? -1 : 2;   // -1 = 테두리 생략 · 2 = relative 로 만들어 테두리
      }
      kindOk[sig] = ok;
    }
    if (ok === -1) ok = 0; else if (ok === 2) { el.style.position = "relative"; ok = 1; }
    if (ok) {
      el.classList.add("lg-t");
      var rim = D.createElement("i"); rim.className = "lg-rim"; rim.setAttribute("aria-hidden", "true");
      el.appendChild(rim); el.__lgRim = rim;
    }
    if (io && el.matches(REFR_SEL)) {   // 둥글기는 여기(유휴 시간)서 모양별 한 번만 읽는다 — 관찰자 콜백 안에서 읽으면 쓰기 직후라 강제 스타일 계산
      el.__lgRad = kindRad[kind] != null ? kindRad[kind] : (kindRad[kind] = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12);
      io.observe(el); if (ro) ro.observe(el);
    }
  }
  var pend = 0;
  function scan() { pend = 0; var l = D.querySelectorAll(SEL); for (var i = 0; i < l.length; i++) adopt(l[i]); }
  function later() { if (!pend) pend = (window.requestIdleCallback || setTimeout)(scan, { timeout: 800 }); }
  function init() {
    scan();
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) { var a = ms[i].addedNodes; for (var j = 0; j < a.length; j++) { var n = a[j]; if (n.nodeType === 1 && n.className !== "lg-rim" && (n.matches(SEL) || n.firstElementChild)) { later(); return; } } }
    })
      .observe(D.body, { childList: true, subtree: true });
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", init); else init();
  setTimeout(guard, 2500);
  window.luxGlass = { refraction: function () { return REFR; }, live: function () { return live; } };
})();
