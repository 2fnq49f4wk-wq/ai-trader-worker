/* [V33.781] ★데이마켓 실시간(브라우저 → 공개 웹소켓 3곳)★ — 사용자 11/6 "더 많은 종목 실시간".
   [V33.780] Hyperliquid xyz 만 → 이제 원천 3곳:
     ① Hyperliquid 주식 시장(xyz · para · io) allMids ~5초 · ② Kraken xStocks ticker(bbo — 호가 바뀔 때마다) · ③ Gate spot.book_ticker(xStocks·Ondo 토큰 · 호가 바뀔 때마다).
   어느 종목을 어느 원천·코드로 받을지는 서버가 시세에 남긴 값(ovnSrc · ovnPair — 원천 4곳 중 고른 것)을 따른다. MEXC 만 있는 종목은 서버 2분 값(브라우저 직접 호출 불가).
   미국 야간(20:00~04:00 ET · 일~목 밤)에만 · 화면이 보일 때만 연결. 서버 비용 0. 받은 값은 시세 객체에 덮고(가격 = 데이마켓 · 등락 = 전일 종가 대비 · dispSess='day')
   2초마다 묶어 'lux:quotes' 이벤트(화면 다시 그리기). 거르기: 호가차 3% 초과 · 정규 종가 대비 ±35% 밖 · 상품·지수 이름. 값은 토큰·무기한 시장의 '참고 시세' 다. */
(function () {
  "use strict";
  var NONEQ = { XYZ100: 1, GOLD: 1, SILVER: 1, COPPER: 1, NATGAS: 1, URANIUM: 1, ALUMINIUM: 1, PLATINUM: 1, PALLADIUM: 1, CL: 1, BRENTOIL: 1, CORN: 1, WHEAT: 1, TTF: 1, VIX: 1, VOL: 1, DXY: 1, JPY: 1, EUR: 1, GBP: 1, KRW: 1, SP500: 1, JP225: 1, KR200: 1, NIFTY: 1, IBOV: 1, H100: 1, DRAM: 1, PURRDAT: 1, BIRD: 1 };
  var LIVE = {};          // sym → { px, ts, src }
  var dirty = false, lastArr = null, lastAny = 0;
  function etNow() {
    try {
      var f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
      var o = {}; f.forEach(function (p) { o[p.type] = p.value; });
      return { d: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday), m: (+o.hour % 24) * 60 + (+o.minute) };
    } catch (e) { return null; }
  }
  function overnight() { var t = etNow(); if (!t) return false; return (t.m >= 1200 && t.d >= 0 && t.d <= 4) || (t.m < 240 && t.d >= 1 && t.d <= 5); }
  function put(sym, px, src) { if (!(px > 0) || NONEQ[sym]) return; LIVE[sym] = { px: px, ts: Date.now(), src: src }; dirty = true; lastAny = Date.now(); }
  function mid(b, a) { b = +b; a = +a; if (!(b > 0 && a >= b)) return null; var m = (a + b) / 2; return (a - b) / m > 0.03 ? null : m; }

  // 시세 객체에 얹기(조용히 = 이벤트 없이)
  function apply(silent) {
    var arr = window.__lastQuotesArr; if (!arr || !arr.length) return 0;
    var now = Date.now(), n = 0;
    for (var i = 0; i < arr.length; i++) {
      var q = arr[i]; if (!q || q.market !== "us" || q.mstate === "REGULAR" || q.mstate === "PRE") continue;
      var L = LIVE[q.symbol]; if (!L || now - L.ts > 120000) continue;
      if (q.regPrice == null) q.regPrice = q.price;
      var base = q.regPrice > 0 ? q.regPrice : null; if (!base || Math.abs(L.px / base - 1) > 0.35) continue;
      q.ovn = L.px; q.ovnTs = L.ts; q.ovnPct = (L.px / base - 1) * 100; q.ovnSrc = L.src; q.dispSess = "day";
      q.price = L.px; if (q.prevClose > 0) q.dayPct = (L.px / q.prevClose - 1) * 100;
      n++;
    }
    if (n && !silent) { window.__luxOvnAt = now; try { window.dispatchEvent(new CustomEvent("lux:quotes", { detail: { n: n } })); } catch (e) {} }
    return n;
  }
  function wanted(src) {   // 서버가 고른 원천·코드
    var arr = window.__lastQuotesArr || [], o = {};
    for (var i = 0; i < arr.length; i++) { var q = arr[i]; if (q && q.market === "us" && q.ovnSrc === src && q.ovnPair) o[q.ovnPair] = q.symbol; }
    return o;
  }

  // ── 연결 하나 = { url, sub(ws), onmsg(m) } ──
  function Feed(name, url, subscribe, onmsg) { this.name = name; this.url = url; this.subscribe = subscribe; this.onmsg = onmsg; this.ws = null; this.retry = 0; this.last = 0; this.key = ""; }
  Feed.prototype.open = function () {
    var self = this; if (self.ws || typeof WebSocket === "undefined") return;
    var plan = self.subscribe(); if (!plan) return; self.key = plan.key;
    try { self.ws = new WebSocket(self.url); } catch (e) { self.ws = null; return; }
    self.ws.onopen = function () { self.retry = 0; plan.msgs.forEach(function (m) { try { self.ws.send(JSON.stringify(m)); } catch (e) {} }); };
    self.ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } self.last = Date.now(); try { self.onmsg(m); } catch (x2) {} };
    self.ws.onclose = function () { self.ws = null; if (overnight() && !document.hidden) { self.retry = Math.min(self.retry + 1, 6); setTimeout(function () { self.open(); }, 2000 * Math.pow(2, self.retry)); } };
    self.ws.onerror = function () { try { self.ws.close(); } catch (e) {} };
  };
  Feed.prototype.close = function () { if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) {} this.ws = null; } };

  var HLMAP = {};   // "xyz:NVDA" → NVDA (서버가 hl 로 고른 것 + 기본 xyz:<심볼>)
  var hl = new Feed("hl", "wss://api.hyperliquid.xyz/ws", function () {
    HLMAP = wanted("hl");
    return { key: "hl", msgs: ["xyz", "para", "io"].map(function (d) { return { method: "subscribe", subscription: { type: "allMids", dex: d } }; }) };
  }, function (m) {
    if (m.channel !== "allMids" || !m.data || !m.data.mids) return;
    var md = m.data.mids;
    for (var k in md) { var sym = HLMAP[k]; if (!sym && k.indexOf("xyz:") === 0) { var s0 = k.slice(4).replace(/\./g, "-"); if (!NONEQ[s0]) sym = s0; } if (sym) put(sym, +md[k], "hl"); }
  });
  var KRMAP = {};
  var kr = new Feed("kraken", "wss://ws.kraken.com/v2", function () {
    KRMAP = wanted("kraken"); var p = Object.keys(KRMAP); if (!p.length) return null;
    return { key: p.sort().join(","), msgs: [{ method: "subscribe", params: { channel: "ticker", symbol: p, event_trigger: "bbo" } }] };
  }, function (m) {
    if (m.channel !== "ticker" || !m.data) return;
    m.data.forEach(function (d) { var sym = KRMAP[d.symbol], x = mid(d.bid, d.ask); if (sym && x) put(sym, x, "kraken"); });
  });
  var GTMAP = {};
  var gt = new Feed("gate", "wss://api.gateio.ws/ws/v4/", function () {
    GTMAP = wanted("gate"); var p = Object.keys(GTMAP); if (!p.length) return null;
    return { key: p.sort().join(","), msgs: [{ time: Math.floor(Date.now() / 1000), channel: "spot.book_ticker", event: "subscribe", payload: p }] };
  }, function (m) {
    if (m.channel !== "spot.book_ticker" || m.event !== "update" || !m.result) return;
    var sym = GTMAP[m.result.s], x = mid(m.result.b, m.result.a); if (sym && x) put(sym, x, "gate");
  });
  var OKMAP = {};
  var ok = new Feed("okx", "wss://ws.okx.com/ws/v5/public", function () {
    OKMAP = wanted("okx"); var p = Object.keys(OKMAP); if (!p.length) return null;
    return { key: p.sort().join(","), msgs: [{ op: "subscribe", args: p.map(function (id) { return { channel: "bbo-tbt", instId: id }; }) }] };
  }, function (m) {
    if (!m.arg || m.arg.channel !== "bbo-tbt" || !m.data || !m.data[0]) return;
    var d = m.data[0], sym = OKMAP[m.arg.instId], x = mid(d.bids && d.bids[0] && d.bids[0][0], d.asks && d.asks[0] && d.asks[0][0]); if (sym && x) put(sym, x, "okx");
  });
  var FEEDS = [hl, kr, gt, ok];

  function tick() {
    var on = overnight() && !document.hidden;
    FEEDS.forEach(function (f) {
      if (!on) { f.close(); return; }
      if (!f.ws) { f.open(); return; }
      if (f.last && Date.now() - f.last > 90000) { f.close(); f.open(); return; }
      // 서버가 고른 종목 목록이 바뀌면 다시 구독(Kraken·Gate)
      if (f !== hl) { var plan = f.subscribe(); if (plan && plan.key !== f.key) { f.close(); f.open(); } }
    });
  }
  // 2초마다 묶어 화면 갱신 · 시세 배열이 새로 오면(30초) 곧바로 다시 얹기
  setInterval(function () { var a = window.__lastQuotesArr; if (a && a !== lastArr) { lastArr = a; if (lastAny) apply(false); return; } if (dirty) { dirty = false; apply(false); } }, 2000);
  try {
    var _arr = window.__lastQuotesArr;
    Object.defineProperty(window, "__lastQuotesArr", { configurable: true, get: function () { return _arr; },
      set: function (v) { _arr = v; if (v && lastAny && Date.now() - lastAny < 120000) { lastArr = v; try { apply(true); } catch (e) {} } } });
  } catch (e) {}
  document.addEventListener("visibilitychange", tick);
  setInterval(tick, 30000);
  setTimeout(tick, 3000); setTimeout(tick, 12000);   // 첫 시세(서버 고른 원천)가 온 뒤 Kraken·Gate 구독
  window.luxOvnLive = { on: function () { return FEEDS.filter(function (f) { return !!f.ws; }).map(function (f) { return f.name; }); }, overnight: overnight, live: function () { return LIVE; }, apply: apply };
})();
