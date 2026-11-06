/* [V33.780] ★데이마켓 실시간(브라우저 → Hyperliquid 공개 웹소켓)★ — 사용자 11/6 "2분마다 말고 실시간 데이터".
   미국 야간(20:00~04:00 ET · 일~목 밤)에만, 화면이 보일 때만 wss://api.hyperliquid.xyz/ws 에 붙어 trade.xyz 주식 143종 중간값을 ~5초마다 받는다.
   서버 비용 0(워커·D1·R2 안 거침) · 사람 수와 무관. 받은 값은 이미 받은 시세 객체(window.__lastQuotesArr)에 덮어 —
   가격 = 데이마켓 값 · 등락 = 전일 종가 대비(V33.777 과 같은 기준) · ovn/ovnTs/dispSess='day' — 'lux:quotes' 이벤트로 화면이 다시 그린다.
   값 원천은 토큰·무기한 시장(Pyth 주식 시세 추종)이라 '참고 시세' 다. 이름이 상품·지수와 겹치는 것(CL·GOLD…)은 막고, 정규 종가 대비 ±35% 를 넘으면 버린다. */
(function () {
  "use strict";
  var URL_ = "wss://api.hyperliquid.xyz/ws", ws = null, retry = 0, lastMsg = 0, timer = null, lastMids = null, lastArr = null;
  var NONEQ = { XYZ100: 1, GOLD: 1, SILVER: 1, COPPER: 1, NATGAS: 1, URANIUM: 1, ALUMINIUM: 1, PLATINUM: 1, PALLADIUM: 1, CL: 1, BRENTOIL: 1, CORN: 1, WHEAT: 1, TTF: 1, VIX: 1, VOL: 1, DXY: 1, JPY: 1, EUR: 1, GBP: 1, KRW: 1, SP500: 1, JP225: 1, KR200: 1, NIFTY: 1, IBOV: 1, H100: 1, DRAM: 1, PURRDAT: 1, BIRD: 1 };
  function etNow() {
    try {
      var f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
      var o = {}; f.forEach(function (p) { o[p.type] = p.value; });
      return { d: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday), m: (+o.hour % 24) * 60 + (+o.minute) };
    } catch (e) { return null; }
  }
  function overnight() { var t = etNow(); if (!t) return false; return (t.m >= 1200 && t.d >= 0 && t.d <= 4) || (t.m < 240 && t.d >= 1 && t.d <= 5); }
  function apply(mids, silent) {
    var arr = window.__lastQuotesArr; if (!arr || !arr.length) return 0;
    var now = Date.now(), n = 0;
    for (var i = 0; i < arr.length; i++) {
      var q = arr[i]; if (!q || q.market !== "us" || q.mstate === "REGULAR" || q.mstate === "PRE") continue;
      var sym = String(q.symbol || ""); if (NONEQ[sym]) continue;
      var v = mids["xyz:" + sym] || mids["xyz:" + sym.replace(/-/g, ".")]; if (v == null) continue;
      var px = +v, base = q.regPrice > 0 ? q.regPrice : null; if (!(px > 0) || !base || Math.abs(px / base - 1) > 0.35) continue;
      if (q.regPrice == null) q.regPrice = q.price;
      q.ovn = px; q.ovnTs = now; q.ovnPct = (px / base - 1) * 100; q.ovnSrc = "hl"; q.dispSess = "day";
      q.price = px; if (q.prevClose > 0) q.dayPct = (px / q.prevClose - 1) * 100;
      n++;
    }
    if (n && !silent) { window.__luxOvnAt = now; try { window.dispatchEvent(new CustomEvent("lux:quotes", { detail: { src: "hl", n: n } })); } catch (e) {} }
    return n;
  }
  function open() {
    if (ws || !overnight() || document.hidden || typeof WebSocket === "undefined") return;
    try { ws = new WebSocket(URL_); } catch (e) { ws = null; return; }
    ws.onopen = function () { retry = 0; try { ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids", dex: "xyz" } })); } catch (e) {} };
    ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m && m.channel === "allMids" && m.data && m.data.mids) { lastMsg = Date.now(); lastMids = m.data.mids; lastArr = window.__lastQuotesArr; apply(lastMids); } };
    ws.onclose = function () { ws = null; if (overnight() && !document.hidden) { retry = Math.min(retry + 1, 6); setTimeout(open, 2000 * Math.pow(2, retry)); } };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  function close() { if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; } }
  function tick() { if (overnight() && !document.hidden) { if (!ws) open(); else if (lastMsg && Date.now() - lastMsg > 60000) { close(); open(); } } else close(); }
  // 30초 시세 갱신이 시세 배열을 새로 바꾸면(서버 사본 · 최대 2분 묵음) 마지막 실시간 값을 곧바로 다시 얹는다(1초 확인 · 값 1분 이내만)
  // 시세 배열이 바뀌는 그 순간(대입) 바로 얹는다 — 렌더가 옛 값을 한 번도 그리지 않게(조용히 · 이벤트 없이)
  try {
    var _arr = window.__lastQuotesArr;
    Object.defineProperty(window, "__lastQuotesArr", { configurable: true, get: function () { return _arr; },
      set: function (v) { _arr = v; if (v && lastMids && Date.now() - lastMsg < 60000) { lastArr = v; try { apply(lastMids, true); } catch (e) {} } } });
  } catch (e) {}
  setInterval(function () { var a = window.__lastQuotesArr; if (a && a !== lastArr && lastMids && Date.now() - lastMsg < 60000) { lastArr = a; apply(lastMids); } }, 1000);
  document.addEventListener("visibilitychange", tick);
  timer = setInterval(tick, 30000);
  setTimeout(tick, 3000);
  window.luxOvnLive = { on: function () { return !!ws; }, overnight: overnight, apply: apply };
})();
