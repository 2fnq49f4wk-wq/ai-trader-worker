/* [V33.786] ★종목 AI 분석(차트 · 실적 · 재무 · 업종 비교를 한 문단으로)★ — 사용자 11/7:
   "그래프·실적·분기 실적 전망을 분석해서 보여 주는데 디테일하게 · CPU·D1 낭비 없이 · 기술적 분석은 최근 실적·업종 평균·재무제표와 연결해서
    (예: 장기 상승 추세 안에서 중기 조정을 마치고 반등을 시도하는 국면이다 · 주도권은 아직 매수 쪽 · 스윙 기준으론 320~322달러 매물대를 넘겨야 진짜 상승 전환)".
   · 계산은 전부 이 브라우저에서(서버 CPU 0). 받는 것: /api/chart 1년 일봉(서버 10분 캐시) · /api/qearn 분기 실적·컨센서스(서버 6시간 캐시 · D1 0) ·
     /api/fundamentals(상세 화면이 이미 받는 것 · 업종 비교 포함). 종목당 한 번만 받고 이 탭에서 다시 쓴다.
   · 규칙(숫자는 전부 받은 데이터에서 · 지어내지 않는다):
     장기 = 200일선 위/아래 + 200일선 20일 기울기 · 중기 = 60일 고점 대비 낙폭 + 50일선 · 단기 = 20일선 회복·5일 수익·RSI
     주도권 = 20일 상승일 거래량 ÷ 하락일 거래량 + OBV 기울기 · 매물대 = 120일 가격대별 거래량(가격 0.6% 칸) 상위 구간 · 스윙 고점/저점 = 좌우 5봉 피벗
   · 이것은 규칙으로 쓴 해설이지 예측이 아니다(화면에 적는다). 투자 권유 아님. */
(function () {
  "use strict";
  var C = {};   // sym → { bars, qe, ts }
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var isKr = function (s) { return /\.(KS|KQ)$/.test(s || ""); };
  function getJ(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function load(sym, redraw) {
    var c = C[sym]; if (c && Date.now() - c.ts < 600000) return c;
    c = C[sym] = { bars: null, qe: null, an: null, mk: null, ev: null, ts: Date.now(), err: {} };
    getJ("/api/chart?symbol=" + encodeURIComponent(sym) + "&range=1y&interval=1d").then(function (j) { c.bars = (j && j.candles || []).filter(function (b) { return b && b.c > 0 && b.h > 0 && b.l > 0; }); redraw(); }).catch(function () { c.bars = []; c.err.bars = 1; redraw(); });
    getJ("/api/qearn?symbol=" + encodeURIComponent(sym)).then(function (j) { c.qe = j || {}; redraw(); }).catch(function () { c.qe = { ok: false }; redraw(); });
    getJ("/api/analyst?symbol=" + encodeURIComponent(sym)).then(function (j) { c.an = j && j.ok ? j : { ok: false }; redraw(); }).catch(function () { c.an = { ok: false }; redraw(); });
    mktLoad(sym, function (m) { c.mk = m; redraw(); });
    evLoad(sym, function (e) { c.ev = e; redraw(); });
    return c;
  }
  // 시장 지수(SPY · ^KS11 · ^KQ11)와 실적 일정은 공용이라 세션에 한 번만 받아 모든 종목이 같이 쓴다
  var MK = {}, EV = null;
  function mktLoad(sym, cb) {
    var m = /\.KQ$/.test(sym) ? "^KQ11" : isKr(sym) ? "^KS11" : "SPY", nm = { "^KQ11": "코스닥", "^KS11": "코스피", SPY: "S&P500" }[m], e = MK[m];
    if (e && Date.now() - e.ts < 1800000) { if (e.v) cb(e.v); else e.w.push(cb); return; }
    e = MK[m] = { ts: Date.now(), v: null, w: [cb] };
    getJ("/api/chart?symbol=" + encodeURIComponent(m) + "&range=1y&interval=1d").then(function (j) {
      var cl = (j && j.candles || []).map(function (b) { return b.c; }).filter(function (v) { return v > 0; }), n = cl.length;
      e.v = n > 61 ? { nm: nm, r20: (cl[n - 1] / cl[n - 21] - 1) * 100, r60: (cl[n - 1] / cl[n - 61] - 1) * 100 } : { nm: nm };
      e.w.splice(0).forEach(function (f) { f(e.v); });
    }).catch(function () { e.v = { nm: nm }; e.w.splice(0).forEach(function (f) { f(e.v); }); });
  }
  function evLoad(sym, cb) {
    var pick = function (items) { var now = Date.now(), r = (items || []).filter(function (x) { return x.symbol === sym && x.ts > now - 86400000; }).sort(function (a, b) { return a.ts - b.ts; })[0]; return r ? { ts: r.ts } : {}; };
    if (EV && Date.now() - EV.ts < 1800000) { if (EV.items) cb(pick(EV.items)); else EV.w.push(function () { cb(pick(EV.items)); }); return; }
    EV = { ts: Date.now(), items: null, w: [function () { cb(pick(EV.items)); }] };
    getJ("https://data.lux-inv.com/pub/f/earnings.js").then(function (j) { EV.items = (j && j.d && j.d.items) || []; EV.w.splice(0).forEach(function (f) { f(); }); }).catch(function () { EV.items = []; EV.w.splice(0).forEach(function (f) { f(); }); });
  }
  // ── 지표 ──
  function sma(a, n, end) { end = end == null ? a.length : end; if (end < n) return null; var s = 0; for (var i = end - n; i < end; i++) s += a[i]; return s / n; }
  function rsi(c, n) { if (c.length <= n) return null; var g = 0, l = 0; for (var i = c.length - n; i < c.length; i++) { var d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  function atr(b, n) { if (b.length <= n) return null; var s = 0; for (var i = b.length - n; i < b.length; i++) { var p = b[i - 1].c; s += Math.max(b[i].h - b[i].l, Math.abs(b[i].h - p), Math.abs(b[i].l - p)); } return s / n; }
  function pivots(b, w, from) {
    var hi = [], lo = [];
    for (var i = Math.max(w, from); i < b.length - w; i++) {
      var isH = true, isL = true;
      for (var k = i - w; k <= i + w; k++) { if (k === i) continue; if (b[k].h > b[i].h) isH = false; if (b[k].l < b[i].l) isL = false; }
      if (isH) hi.push({ i: i, p: b[i].h }); if (isL) lo.push({ i: i, p: b[i].l });
    }
    return { hi: hi, lo: lo };
  }
  function vprofile(b, n, px) {   // 가격대별 거래량(종가 대신 봉 범위에 고르게 나눔)
    var s = b.slice(-n), lo = Infinity, hi = -Infinity; s.forEach(function (x) { if (x.l < lo) lo = x.l; if (x.h > hi) hi = x.h; });
    var w = Math.max(px * 0.006, (hi - lo) / 160), nb = Math.max(1, Math.ceil((hi - lo) / w)), v = new Array(nb).fill(0);
    s.forEach(function (x) { var a = Math.floor((x.l - lo) / w), z = Math.min(nb - 1, Math.floor((x.h - lo) / w)), k = Math.max(1, z - a + 1), vol = (x.v > 0 ? x.v : 1) / k; for (var j = a; j <= z; j++) v[j] += vol; });
    var avg = v.reduce(function (p, q) { return p + q; }, 0) / nb;
    return { lo: lo, w: w, v: v, avg: avg };
  }
  // 현재가 위·아래로 가장 가까운 '두꺼운' 매물대(평균의 1.4배 이상 칸이 이어진 구간)
  function zones(vp, px) {
    var out = [], cur = null;
    for (var i = 0; i < vp.v.length; i++) {
      var thick = vp.v[i] >= vp.avg * 1.4, a = vp.lo + i * vp.w, z = a + vp.w;
      if (thick) { if (cur && cur.z >= a - 1e-9) { cur.z = z; cur.vol += vp.v[i]; } else { cur = { a: a, z: z, vol: vp.v[i] }; out.push(cur); } } else cur = null;
    }
    out.forEach(function (x) {   // 넓게 이어진 구간은 거래가 가장 많은 칸을 중심으로 좁힌다(폭 ≤ 가격의 1.6%)
      var cap = px * 0.016; if (x.z - x.a <= cap) return;
      var a0 = Math.floor((x.a - vp.lo) / vp.w), z0 = Math.ceil((x.z - vp.lo) / vp.w) - 1, pk = a0;
      for (var q = a0; q <= z0; q++) if (vp.v[q] > vp.v[pk]) pk = q;
      var mid = vp.lo + (pk + 0.5) * vp.w; x.a = Math.max(x.a, mid - cap / 2); x.z = Math.min(x.z, mid + cap / 2);
    });
    var up = out.filter(function (x) { return x.a > px; }).sort(function (x, y) { return x.a - y.a; })[0] || null;
    var dn = out.filter(function (x) { return x.z < px; }).sort(function (x, y) { return y.z - x.z; })[0] || null;
    var inZ = out.filter(function (x) { return x.a <= px && x.z >= px; })[0] || null;
    return { up: up, dn: dn, inZ: inZ, all: out };
  }
  function tick(p, kr) {
    if (!kr) return p >= 1000 ? Math.round(p) : p >= 100 ? Math.round(p * 2) / 2 : p >= 10 ? Math.round(p * 10) / 10 : Math.round(p * 100) / 100;
    var t = p >= 500000 ? 1000 : p >= 200000 ? 500 : p >= 50000 ? 100 : p >= 20000 ? 50 : p >= 5000 ? 10 : p >= 2000 ? 5 : 1; return Math.round(p / t) * t;
  }
  function money(p, kr) { if (p == null || !isFinite(p)) return "—"; p = tick(p, kr); return kr ? p.toLocaleString() + "원" : (p >= 100 ? p.toFixed(p >= 1000 ? 0 : 1).replace(/\.0$/, "") : p.toFixed(2)) + "달러"; }
  function rng(a, z, kr) { var A = tick(a, kr), Z = tick(z, kr); if (A === Z) return money(A, kr); return (kr ? A.toLocaleString() : (A >= 100 ? A.toFixed(A >= 1000 ? 0 : 1).replace(/\.0$/, "") : A.toFixed(2))) + "~" + money(Z, kr); }
  var pct = function (v, d) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d == null ? 1 : d) + "%"; };

  function techRead(bars, kr) {
    var cl = bars.map(function (b) { return b.c; }), n = cl.length; if (n < 60) return null;
    var px = cl[n - 1], m20 = sma(cl, 20), m50 = sma(cl, 50), longN = n >= 200 ? 200 : 120, mL = sma(cl, longN), mL20 = sma(cl, longN, n - 20);
    var m20p = sma(cl, 20, n - 5), slope = mL && mL20 ? (mL / mL20 - 1) * 100 : 0;
    var hi60 = -Infinity, lo20 = Infinity, lo20i = 0; for (var i = n - 60; i < n; i++) if (bars[i].h > hi60) hi60 = bars[i].h;
    for (var j = n - 20; j < n; j++) if (bars[j].l < lo20) { lo20 = bars[j].l; lo20i = j; }
    var r20 = (px / cl[n - 21] - 1) * 100, r60 = n > 60 ? (px / cl[n - 61] - 1) * 100 : null, dd = (px / hi60 - 1) * 100, r5 = (px / cl[n - 6] - 1) * 100, R = rsi(cl, 14), A = atr(bars, 14);
    var hi252 = -Infinity; bars.forEach(function (b) { if (b.h > hi252) hi252 = b.h; });
    // 주도권
    var uv = 0, dv = 0, obv = [0]; for (var k = Math.max(1, n - 20); k < n; k++) { var d = cl[k] - cl[k - 1], v = bars[k].v > 0 ? bars[k].v : 0; if (d > 0) uv += v; else if (d < 0) dv += v; }
    for (var k2 = Math.max(1, n - 40); k2 < n; k2++) { var d2 = cl[k2] - cl[k2 - 1]; obv.push(obv[obv.length - 1] + (d2 > 0 ? 1 : d2 < 0 ? -1 : 0) * (bars[k2].v || 0)); }
    var obvUp = obv[obv.length - 1] > obv[Math.max(0, obv.length - 21)];
    var vr = dv > 0 ? uv / dv : (uv > 0 ? 9 : 1);
    var ctrl = (vr >= 1.15 && px > m20) || (vr >= 1.0 && obvUp && px > m20) ? "buy" : (vr <= 0.87 && px < m20) || (vr < 1 && !obvUp && px < m20) ? "sell" : "even";
    // 장기·중기·단기
    var L = px > mL && slope > 0 ? "up" : px < mL && slope < 0 ? "down" : "side";
    var bounce = px > m20 && m20 > m20p && lo20i <= n - 4 && px > lo20 * 1.03;
    var M;
    if (L === "up") M = dd <= -5 ? (px < m50 && !bounce ? "pullback" : bounce ? "rebound" : "pullback") : "trend";
    else if (L === "down") M = px > m50 ? "relief" : bounce ? "reliefTry" : "falling";
    else M = px > m50 ? "rangeHi" : "rangeLo";
    // 레벨
    var vp = vprofile(bars, Math.min(120, n), px), Z = zones(vp, px), pv = pivots(bars, 5, n - 120);
    var swH = pv.hi.filter(function (x) { return x.p > px * 1.005; }).sort(function (a, b) { return b.i - a.i; })[0] || null;
    var swL = pv.lo.filter(function (x) { return x.p < px * 0.995; }).sort(function (a, b) { return b.i - a.i; })[0] || null;
    var res = Z.up && (!swH || Z.up.a <= swH.p * 1.02) ? { a: Z.up.a, z: Z.up.z, k: "vp" } : swH ? { a: swH.p - (A || px * 0.01) * 0.25, z: swH.p, k: "swing" } : Z.up ? { a: Z.up.a, z: Z.up.z, k: "vp" } : null;
    if (res && res.a > px * 1.25) res = null;
    if (!res) { var mas = [[m20, "20일선"], [m50, "50일선"], [mL, longN + "일선"]].filter(function (x) { return x[0] > px * 1.005; }).sort(function (x, y) { return x[0] - y[0]; })[0]; if (mas) res = { a: mas[0] * 0.995, z: mas[0], k: "ma", nm: mas[1] }; }
    var sup = Z.dn ? { a: Z.dn.a, z: Z.dn.z, k: "vp" } : swL ? { a: swL.p, z: swL.p + (A || px * 0.01) * 0.25, k: "swing" } : null;
    if (sup && sup.z < px * 0.75) sup = null;
    // 시나리오용: 관문 너머 다음 목표 구간 · 지지 아래 다음 지지 구간
    var tgt = null, sup2 = null;
    if (res) {
      var nz = Z.all.filter(function (x) { return x.a > res.z * 1.004 && x.a < px * 1.4; }).sort(function (x, y) { return x.a - y.a; })[0];
      var nh = pv.hi.filter(function (x) { return x.p > res.z * 1.01; }).sort(function (x, y) { return x.p - y.p; })[0];
      tgt = nz && (!nh || nz.a <= nh.p * 1.03) ? { a: nz.a, z: nz.z, k: "vp" } : nh ? { a: nh.p - (A || px * 0.01) * 0.25, z: nh.p, k: "swing" } : hi252 > res.z * 1.01 ? { a: hi252 - (A || px * 0.01) * 0.25, z: hi252, k: "hi" } : null;
    }
    if (sup) {
      var dz = Z.all.filter(function (x) { return x.z < sup.a * 0.996; }).sort(function (x, y) { return y.z - x.z; })[0];
      var dl = pv.lo.filter(function (x) { return x.p < sup.a * 0.99; }).sort(function (x, y) { return y.p - x.p; })[0];
      sup2 = dz && (!dl || dz.z >= dl.p * 0.97) ? { a: dz.a, z: dz.z, k: "vp" } : dl ? { a: dl.p, z: dl.p + (A || px * 0.01) * 0.25, k: "swing" } : null;
      if (sup2 && sup2.z < px * 0.6) sup2 = null;
    }
    // 거래량 세부: 최근 5일 vs 20일 평균 · 평균의 1.5배 이상 터진 날의 방향(최근 20일)
    var v20 = 0, v5 = 0, big = [0, 0]; for (var q2 = n - 20; q2 < n; q2++) v20 += bars[q2].v || 0; v20 /= 20;
    for (var q3 = n - 5; q3 < n; q3++) v5 += bars[q3].v || 0; v5 /= 5;
    for (var q4 = n - 20; q4 < n; q4++) if (v20 > 0 && bars[q4].v >= v20 * 1.5) { if (cl[q4] > cl[q4 - 1]) big[0]++; else if (cl[q4] < cl[q4 - 1]) big[1]++; }
    return { r20: r20, r60: r60, px: px, tgt: tgt, sup2: sup2, v5r: v20 > 0 && v5 > 0 ? v5 / v20 : null, bigUp: big[0], bigDn: big[1], m20: m20, m50: m50, mL: mL, longN: longN, slope: slope, dd: dd, hi60: hi60, hi252: hi252, r5: r5, rsi: R, atr: A, vr: vr, obvUp: obvUp, ctrl: ctrl, L: L, M: M, res: res, sup: sup, inZ: Z.inZ, vp: vp };
  }

  function phaseText(t) {
    var Lk = { up: "장기 상승 추세", down: "장기 하락 추세", side: "장기 방향성이 뚜렷하지 않은 흐름" }[t.L];
    var Mk = {
      trend: "고점권 상승 흐름을 이어 가는 국면이다", pullback: "중기 조정이 진행 중인 국면이다", rebound: "중기 조정을 마치고 반등을 시도하는 국면이다",
      relief: "기술적 반등이 나온 국면이다(추세 전환은 아직 확인 전)", reliefTry: "낙폭을 줄이며 반등을 시도하는 국면이다", falling: "하락이 이어지는 국면이다",
      rangeHi: "박스권 위쪽을 두드리는 국면이다", rangeLo: "박스권 아래쪽에서 힘을 모으는 국면이다"
    }[t.M];
    return Lk + " 안에서 " + Mk;
  }
  function ctrlText(t) {
    var r = "20일 상승일 거래량이 하락일의 " + t.vr.toFixed(2) + "배";
    if (t.ctrl === "buy") return "주도권은 " + (t.L === "down" ? "단기적으로 " : "아직 ") + "매수 쪽에 있다(" + r + (t.obvUp ? " · 거래량 누적(OBV) 상승" : "") + ").";
    if (t.ctrl === "sell") return "주도권은 매도 쪽에 있다(" + r + (t.obvUp ? "" : " · 거래량 누적(OBV) 하락") + ").";
    return "매수·매도 힘이 팽팽하다(" + r + ").";
  }
  function josa(w, a, b) { var c = String(w).replace(/[)\s]+$/, "").slice(-1).charCodeAt(0); if (!(c >= 0xAC00 && c <= 0xD7A3)) return w + b; return w + ((c - 0xAC00) % 28 ? a : b); }
  function levelText(t, kr) {
    var s = [];
    if (t.res) {
      var what = t.res.k === "vp" ? "매물대" : t.res.k === "ma" ? t.res.nm + "(회복 관문)" : "직전 스윙 고점";
      if (t.L === "down") s.push("스윙 기준으론 " + rng(t.res.a, t.res.z, kr) + " " + josa(what, "을", "를") + " 넘겨야 반등이 추세로 이어질 수 있고, 장기 추세를 되돌리려면 " + t.longN + "일선(" + money(t.mL, kr) + ") 회복이 먼저다.");
      else if (t.M === "trend") s.push("위로는 " + rng(t.res.a, t.res.z, kr) + " " + josa(what, "이", "가") + " 다음 관문이다.");
      else s.push("스윙 기준으론 " + rng(t.res.a, t.res.z, kr) + " " + josa(what, "을", "를") + " 넘겨야 진짜 상승 전환으로 볼 수 있다.");
    } else if (t.px >= t.hi252 * 0.98) s.push("1년 고점 부근이라 위쪽에 쌓인 매물이 거의 없다(신고가 영역).");
    if (t.sup) s.push("아래로는 " + rng(t.sup.a, t.sup.z, kr) + (t.sup.k === "vp" ? " 매물대가" : " 직전 저점이") + " 1차 지지 — 이 구간을 종가로 이탈하면 조정이 길어질 수 있다.");
    if (t.inZ) s.push("지금 가격(" + money(t.px, kr) + ")은 거래가 많이 쌓인 " + rng(t.inZ.a, t.inZ.z, kr) + " 구간 안이라 당분간 오르내림이 잦을 수 있다.");
    return s;
  }
  function shortText(t) {
    var s = "최근 5일 " + pct(t.r5) + " · RSI " + (t.rsi != null ? Math.round(t.rsi) : "—");
    if (t.rsi != null && t.rsi >= 70) s += "(과열권 — 추격보다 눌림 확인)"; else if (t.rsi != null && t.rsi <= 30) s += "(과매도권 — 반등 여지 · 추세 확인 필요)";
    return s + " · 60일 고점 대비 " + pct(t.dd) + " · 20일선 " + (t.px > t.m20 ? "위" : "아래") + " · 50일선 " + (t.px > t.m50 ? "위" : "아래");
  }

  // ── 실적·재무 연결 ──
  function fundRead(sym, qe, fund, px) {
    var kr = isKr(sym), pos = 0, neg = 0, lines = [], val = [];
    if (qe && qe.ok) {
      if (!kr) {
        var h = (qe.eps || []).filter(function (x) { return x.act != null && x.est != null; }).slice(-4);
        if (h.length) {
          var beat = h.filter(function (x) { return x.act >= x.est; }).length, avgS = h.reduce(function (p, x) { return p + (x.surp != null ? x.surp * 100 : (x.act / x.est - 1) * 100); }, 0) / h.length;
          lines.push("최근 " + h.length + "분기 중 " + beat + "번 컨센서스를 넘었다(평균 서프라이즈 " + pct(avgS) + ").");
          if (beat >= Math.ceil(h.length * 0.75) && avgS > 0) pos++; else if (beat <= Math.floor(h.length / 2)) neg++;
        }
        var t0 = (qe.trend || []).filter(function (x) { return x.per === "0q"; })[0], ty = (qe.trend || []).filter(function (x) { return x.per === "0y"; })[0], t1 = (qe.trend || []).filter(function (x) { return x.per === "+1y"; })[0];
        if (t0 && t0.eps != null) {
          var g0 = t0.g != null ? t0.g * 100 : null, rv = t0.revG != null ? t0.revG * 100 : null;
          lines.push("이번 분기 EPS 컨센서스 " + t0.eps.toFixed(2) + "달러" + (g0 != null ? "(전년 같은 분기 대비 " + pct(g0) + ")" : "") + (rv != null ? " · 매출 " + pct(rv) : "") + (t0.nEps ? " · 애널리스트 " + t0.nEps + "명" : "") + ".");
          if (g0 != null) { if (g0 > 10) pos++; else if (g0 < 0) neg++; }
          if (t0.cur != null && t0.d30 != null && t0.d30 > 0) { var rvs = (t0.cur / t0.d30 - 1) * 100; if (Math.abs(rvs) >= 0.5) { lines.push("최근 30일 사이 이번 분기 EPS 전망이 " + pct(rvs) + " " + (rvs > 0 ? "올라갔다(상향)." : "내려갔다(하향).")); if (rvs > 0) pos++; else neg++; } }
        }
        if (ty && ty.g != null) lines.push("올해 EPS 성장 전망 " + pct(ty.g * 100) + (t1 && t1.g != null ? " · 내년 " + pct(t1.g * 100) : "") + ".");
        var v = qe.val || {};
        if (v.pe || v.fpe) val.push("PER " + (v.pe ? v.pe.toFixed(1) + "배" : "—") + (v.fpe ? " · 1년 뒤 실적 기준 " + v.fpe.toFixed(1) + "배" : "") + (v.fpe && v.pe && v.fpe < v.pe * 0.85 ? " — 이익이 늘 것으로 보여 앞으로의 PER 이 더 낮다." : v.fpe && v.pe && v.fpe > v.pe * 1.1 ? " — 이익이 줄 것으로 보여 앞으로의 PER 이 더 높다." : "."));
        if (v.peg > 0) val.push("PEG " + v.peg.toFixed(2) + (v.peg < 1 ? " — 이익 성장 속도에 비해 싼 편이다." : v.peg <= 2 ? " — 성장 대비 무난한 수준이다." : " — 성장 속도에 비해 비싼 편이라 기대가 이미 많이 반영돼 있다."));
        var qa = (qe.q || []).filter(function (x) { return !x.est && x.rev > 0 && x.ni != null; }).slice(-4);
        if (v.gm != null || v.om != null || qa.length >= 3) {
          var nm = qa.map(function (x) { return x.ni / x.rev * 100; }), dn = nm.length >= 3 ? nm[nm.length - 1] - nm[0] : null;
          val.push((v.gm != null ? "매출총이익률 " + (v.gm * 100).toFixed(1) + "%" : "") + (v.om != null ? (v.gm != null ? " · " : "") + "영업이익률 " + (v.om * 100).toFixed(1) + "%" : "") +
            (dn != null ? (v.gm != null || v.om != null ? " · " : "") + "순이익률 최근 " + nm.length + "분기 " + nm.map(function (x) { return x.toFixed(1); }).join("→") + "%" + (dn >= 1 ? " — 마진이 개선되는 중이다." : dn <= -1 ? " — 마진이 줄고 있어 확인이 필요하다." : " — 마진은 안정적이다.") : "."));
        }
      } else {
        var q = (qe.q || []).filter(function (x) { return x.op != null || x.rev != null; }), act = q.filter(function (x) { return !x.est; }), est = q.filter(function (x) { return x.est; });
        var la = act[act.length - 1], yoy = function (row) { if (!row) return null; var y0 = (+row.p.slice(0, 4) - 1) + row.p.slice(4); var b = q.filter(function (x) { return x.p === y0; })[0]; return b && b.op && row.op && b.op > 0 ? (row.op / b.op - 1) * 100 : null; };
        if (la) {
          var y1 = yoy(la), rvy = (function () { var y0 = (+la.p.slice(0, 4) - 1) + la.p.slice(4); var b = q.filter(function (x) { return x.p === y0; })[0]; return b && b.rev > 0 && la.rev ? (la.rev / b.rev - 1) * 100 : null; })();
          lines.push(la.p + " 분기 실적: 매출 " + (la.rev != null ? la.rev.toLocaleString() + "억원" : "—") + (rvy != null ? "(" + pct(rvy) + " YoY)" : "") + " · 영업이익 " + (la.op != null ? la.op.toLocaleString() + "억원" : "—") + (y1 != null ? "(" + pct(y1) + " YoY)" : "") + (la.opm != null ? " · 영업이익률 " + la.opm.toFixed(1) + "%" : "") + ".");
          if (y1 != null) { if (y1 > 15) pos++; else if (y1 < -10) neg++; }
        }
        var ne = est[0];
        if (ne) {
          var y2 = yoy(ne);
          lines.push("다음 " + ne.p + " 분기 컨센서스: 영업이익 " + (ne.op != null ? ne.op.toLocaleString() + "억원" : "—") + (y2 != null ? "(" + pct(y2) + " YoY)" : "") + (la && la.op && ne.op ? " · 직전 분기 대비 " + pct((ne.op / la.op - 1) * 100) : "") + ".");
          if (y2 != null) { if (y2 > 15) pos++; else if (y2 < -10) neg++; }
        }
        var qAct = q.filter(function (x) { return !x.est; }), ttm = qAct.length >= 4 ? qAct.slice(-4).reduce(function (p, x) { return p + (x.eps || 0); }, 0) : 0, hist = qAct.filter(function (x) { return x.per > 0; }).map(function (x) { return x.per; });
        var yEst = (qe.y || []).filter(function (x) { return x.est && x.eps > 0; })[0], lastWithPer = q.filter(function (x) { return x.per != null && !x.est; }).slice(-1)[0];
        if (px > 0 && ttm > 0) {
          var cur = px / ttm, lo = Math.min.apply(null, hist), hi = Math.max.apply(null, hist), rk = hist.length >= 4 ? hist.filter(function (z) { return z <= cur; }).length / hist.length * 100 : null;
          val.push("지금 가격 기준 PER " + cur.toFixed(1) + "배(최근 4분기 EPS 합 " + Math.round(ttm).toLocaleString() + "원)" + (rk != null ? " — 최근 " + hist.length + "분기 말 PER " + lo.toFixed(1) + "~" + hi.toFixed(1) + "배 가운데 " + (rk >= 75 ? "높은 쪽" : rk <= 25 ? "낮은 쪽" : "중간쯤") + "에 있다." : "."));
          if (yEst) val.push(yEst.p.slice(0, 4) + "년 컨센서스 EPS " + Math.round(yEst.eps).toLocaleString() + "원 기준 PER " + (px / yEst.eps).toFixed(1) + "배" + (px / yEst.eps < cur * 0.85 ? " — 이익이 늘 것으로 보여 앞으로의 PER 이 더 낮다." : px / yEst.eps > cur * 1.1 ? " — 이익이 줄 것으로 보인다." : "."));
        } else if (lastWithPer) val.push("PER " + lastWithPer.per.toFixed(1) + "배 (" + lastWithPer.p + " 기준).");
        if (lastWithPer && lastWithPer.roe != null) val.push("ROE " + lastWithPer.roe.toFixed(1) + "% · 영업이익률 " + (lastWithPer.opm != null ? lastWithPer.opm.toFixed(1) + "%" : "—") + " (" + lastWithPer.p + ").");
      }
    }
    // 업종 비교(서버가 같은 업종 종목의 재무 캐시로 계산한 중앙값 · 표본 5 이상일 때만)
    var peer = fund && fund.peer && fund.peer.ok && fund.peer.n >= 5 ? fund.peer : null;
    var SECT = { US_SEMI: "미국 반도체", US_TECH: "미국 빅테크·소프트웨어", KR_SEMI: "한국 반도체", KR_BATT: "한국 2차전지", US_FIN: "미국 금융", US_AERO: "미국 항공우주", US_DATA: "미국 데이터·클라우드", US_CONSUMER: "미국 소비재", US_AUTO: "미국 자동차" };
    if (peer && peer.rows && peer.rows.length) {
      var pick = ["roe", "opProf", "grossProf", "cashOpProf"], got = [];
      peer.rows.forEach(function (r) { if (pick.indexOf(r.k) >= 0 && r.v != null && r.med != null && got.length < 2) got.push(r); });
      if (got.length) {
        var better = got.filter(function (r) { return (r.dir || 1) > 0 ? r.v > r.med : r.v < r.med; }).length;
        lines.push("같은 업종(" + (SECT[peer.sector] || String(peer.sector || "").replace(/^(US|KR)_/, "")) + " · " + peer.n + "종목) 중앙값과 비교: " + got.map(function (r) { return r.ko.replace(/\(.*\)/, "") + " " + r.v.toFixed(1) + "% vs " + r.med.toFixed(1) + "%"; }).join(" · ") + (better === got.length ? " — 업종보다 돈을 잘 번다." : better === 0 ? " — 업종보다 수익성이 낮다." : "."));
        if (better === got.length) pos++; else if (better === 0) neg++;
      }
    }
    var ev = fund && fund.eval;
    if (ev && ev.fScore != null && ev.fAvail >= 7) { lines.push("재무 건전성 F-스코어 " + ev.fScore + "/" + ev.fAvail + (ev.fScore >= 7 ? "(튼튼)" : ev.fScore <= 3 ? "(약함)" : "(보통)") + " · 최근 회계연도 " + esc(ev.asOf || "") + "."); if (ev.fScore >= 7) pos++; else if (ev.fScore <= 3) neg++; }
    return { lines: lines, val: val, pos: pos, neg: neg };
  }
  function linkText(t, f) {
    var techUp = t.L === "up" || t.M === "rebound" || t.M === "relief" || t.M === "reliefTry", fGood = f.pos >= f.neg + 2, fBad = f.neg >= f.pos + 2;
    if (!f.lines.length) return "실적·재무 자료가 아직 없어 차트만으로 읽었다.";
    if (techUp && fGood) return "실적과 재무가 추세를 받쳐 주는 그림이다 — 조정이 오면 실적이 바닥을 만들어 줄 가능성이 있다.";
    if (techUp && fBad) return "주가는 버티지만 실적 지표는 약하다 — 반등이 실적 확인 없이 길게 가긴 어려울 수 있다.";
    if (!techUp && fGood) return "실적은 좋은데 주가가 눌려 있다 — 실적과 주가가 엇갈리는 구간이라 추세 회복 신호(위 관문 돌파)를 확인하고 접근하는 편이 안전하다.";
    if (!techUp && fBad) return "주가와 실적이 함께 약하다 — 서두를 이유가 적은 구간이다.";
    return "실적은 중립적이다 — 당분간은 차트(위 관문·아래 지지)가 방향을 정할 가능성이 크다.";
  }

  // ── 요약 · 시나리오 · 컨센서스 · 시장 대비 · 체크포인트 ──
  var mid = function (z) { return (z.a + z.z) / 2; };
  function evDays(ev) { return ev && ev.ts ? Math.ceil((ev.ts - Date.now()) / 86400000) : null; }
  function evDate(ev) { var d = new Date(ev.ts); return (d.getMonth() + 1) + "/" + d.getDate(); }
  function rsRead(t, mk) {
    if (!mk || mk.r20 == null) return null;
    var d20 = t.r20 - mk.r20, d60 = t.r60 != null ? t.r60 - mk.r60 : null;
    var st = d20 > 2 && (d60 == null || d60 > 2) ? "강함" : d20 < -2 && (d60 == null || d60 < -2) ? "약함" : "엇갈림";
    var sg = function (d) { return (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(1) + "%p"; };
    return { st: st, d20: d20, d60: d60, text: "최근 20일 " + pct(t.r20) + (t.r60 != null ? " · 60일 " + pct(t.r60) : "") + " — " + mk.nm + "(20일 " + pct(mk.r20) + " · 60일 " + pct(mk.r60) + ")보다 20일 " + sg(d20) + (d60 != null ? " · 60일 " + sg(d60) : "") + ". " +
      (st === "강함" ? "시장보다 강한 종목이다(시장 대비 강세)." : st === "약함" ? "시장보다 약한 종목이다(시장 대비 약세) — 시장이 올라도 따라가지 못하고 있다." : "20일과 60일의 강약이 엇갈려 시장 대비 우열이 뚜렷하지 않다.") };
  }
  var RATE = function (w) { w = String(w || "").toLowerCase(); return /strong buy|buy|overweight|outperform|positive|add|accumulate|매수|상향/.test(w) ? 2 : /sell|under|reduce|negative|매도/.test(w) ? 0 : w ? 1 : null; };
  function analystRead(an, t, kr) {
    if (!an || !an.ok || !(an.tgtMean > 0)) return null;
    var px = t.px, up = (an.tgtMean / px - 1) * 100, lines = [], tg = an.tgtMean;
    var l1 = "평균 목표가 " + money(tg, kr) + "(현재가 대비 " + pct(up) + ")" + (an.tgtLow > 0 && an.tgtHigh > 0 ? " · 범위 " + rng(an.tgtLow, an.tgtHigh, kr) : "") + (an.n ? " · 애널리스트 " + an.n + "명" : "") + ".";
    lines.push(l1);
    if (Math.abs(up) > 60) lines.push("현재가와 목표가 차이가 " + pct(up) + "로 매우 크다 — 최근 급등락 전에 낸 목표가가 섞였을 수 있어 그대로 믿기보다 방향만 참고하는 편이 낫다.");   // [V33.789]
    var d = an.dist, tot = d ? (d.strongBuy || 0) + (d.buy || 0) + (d.hold || 0) + (d.sell || 0) + (d.strongSell || 0) : 0;
    if (tot >= 5) { var b = (d.strongBuy || 0) + (d.buy || 0), sl = (d.sell || 0) + (d.strongSell || 0); lines.push("투자의견 매수 " + b + " · 중립 " + (d.hold || 0) + " · 매도 " + sl + "명(매수 비율 " + Math.round(b / tot * 100) + "%)" + (an.ratingMean ? " · 평균 점수 " + an.ratingMean.toFixed(1) + "(1=강력매수 · 5=강력매도)" : "") + "."); }
    var acts = (an.actions || []).filter(function (x) { return x.t > Date.now() - 30 * 86400000; });
    if (acts.length) {
      var u = 0, dw = 0, ini = 0; acts.forEach(function (x) { if (x.act === "init") ini++; else { var a = RATE(x.from), z = RATE(x.to); if (a != null && z != null && z > a) u++; else if (a != null && z != null && z < a) dw++; } });
      lines.push("최근 30일 의견 " + acts.length + "건" + (u || dw || ini ? "(상향 " + u + " · 하향 " + dw + (ini ? " · 신규 " + ini : "") + ")" : "(대부분 기존 의견 유지)") + ".");
    }
    var link;
    if (up <= 0) link = "현재가가 평균 목표가를 이미 넘어섰다 — 주가가 애널리스트 눈높이보다 앞서 있어 추가 상승은 실적 상향이 받쳐 줘야 한다.";
    else if (t.res && tg > t.res.z) link = "목표가 평균까지 " + pct(up) + " · 기술적 관문(" + rng(t.res.a, t.res.z, kr) + ") 위에 있어, 관문을 넘기면 컨센서스상 올라갈 여지가 남는다.";
    else if (t.res && tg >= t.res.a) link = "목표가 평균이 기술적 관문(" + rng(t.res.a, t.res.z, kr) + ") 안에 있어, 관문 근처에선 목표가 도달 부담이 생길 수 있다.";
    else if (t.res) link = "목표가 평균(" + money(tg, kr) + ")이 기술적 관문(" + rng(t.res.a, t.res.z, kr) + ")보다 낮아, 관문을 넘으려면 목표가 상향이 따라와야 한다.";
    else link = "목표가 평균까지 " + pct(up) + " 남았고 위쪽에 두꺼운 매물대가 없어 기술적 저항은 약한 편이다.";
    return { lines: lines, link: link, up: up };
  }
  function scenario(t, kr) {
    var up, dn, rr = null, A = t.atr || t.px * 0.01;
    if (t.res) { var tz = t.tgt; up = { trig: t.res.z, tg: tz, text: "종가로 " + money(t.res.z, kr) + " 위에 안착하면 " + (tz ? "다음 목표는 " + rng(tz.a, tz.z, kr) + "(" + pct((mid(tz) / t.px - 1) * 100) + ")." : "그 위엔 뚜렷한 매물대가 없어 추세 추종 구간으로 열린다.") }; }
    else up = { trig: null, tg: null, text: t.px >= t.hi252 * 0.98 ? "1년 고점 부근이라 위쪽 저항이 없다 — 고점(" + money(t.hi252, kr) + ") 돌파를 이어 가는지가 관건이다." : "위쪽에 가까운 저항 구간이 뚜렷하지 않다." };
    if (t.sup) dn = { brk: t.sup.a, tg: t.sup2, text: "종가로 " + money(t.sup.a, kr) + " 아래로 밀리면 " + (t.sup2 ? "다음 지지는 " + rng(t.sup2.a, t.sup2.z, kr) + "(" + pct((mid(t.sup2) / t.px - 1) * 100) + ")." : "아래에 받쳐 줄 매물대가 뚜렷하지 않아 낙폭이 커질 수 있다.") };
    else dn = { brk: null, tg: null, text: "가까운 지지 구간이 뚜렷하지 않다 — 하루 평균 변동폭(" + money(A, kr) + ")의 2배인 " + money(t.px - 2 * A, kr) + " 부근을 손절 기준 참고선으로 볼 수 있다." };
    var reward = up.tg ? mid(up.tg) - t.px : t.res ? t.res.z - t.px : null, risk = t.sup ? t.px - t.sup.a : 2 * A;
    if (reward > 0 && risk > 0) {
      var r = reward / risk;
      rr = { r: r, text: "손익비: 위 " + (up.tg ? "목표 중앙" : "관문") + "까지 " + pct(reward / t.px * 100) + " 대 아래 " + (t.sup ? "지지 이탈" : "2×ATR") + "까지 " + pct(-risk / t.px * 100) + " → 1 : " + (r >= 5 ? "5+" : r.toFixed(1)) + (r >= 2 ? " (위쪽이 유리한 편)" : r >= 1 ? " (보통)" : " (아래 위험이 더 큰 자리)") };
    }
    return { up: up, dn: dn, rr: rr };
  }
  function summaryText(t, f, ev, kr) {
    var P = { trend: "고점권 상승", pullback: "중기 조정", rebound: "조정 뒤 반등 시도", relief: "기술적 반등", reliefTry: "반등 시도", falling: "하락 지속", rangeHi: "박스 상단", rangeLo: "박스 하단" }[t.M];
    var Lk = { up: "장기 상승", down: "장기 하락", side: "장기 횡보" }[t.L];
    var key = t.res ? rng(t.res.a, t.res.z, kr) + " 돌파가 관건" : t.sup ? rng(t.sup.a, t.sup.z, kr) + " 지지 확인이 관건" : "뚜렷한 관문 없음";
    var er = f.lines.length ? "실적 " + (f.pos >= f.neg + 2 ? "우호" : f.neg >= f.pos + 2 ? "부담" : "중립") : "";
    var dd = evDays(ev); if (dd != null && dd >= 0 && dd <= 45) er += (er ? " · " : "") + "실적 발표 " + evDate(ev) + "(D-" + dd + ")";
    return Lk + "·" + P + " · " + key + (er ? " · " + er : "");
  }
  function checkpoints(t, ev, kr, rs) {
    var o = [], dd = evDays(ev);
    if (dd != null && dd >= 0 && dd <= 60) o.push("다음 실적 발표 " + evDate(ev) + (dd === 0 ? "(오늘)" : "(D-" + dd + ")") + " — 발표 전후로 변동폭이 커지기 쉬워 비중은 이벤트 전에 정해 두는 편이 낫다.");
    if (t.res) o.push("종가가 " + money(t.res.z, kr) + " 위로 올라서고 그날 거래량이 20일 평균 이상이면 돌파 신뢰도가 올라간다.");
    if (t.sup) o.push("종가가 " + money(t.sup.a, kr) + " 아래로 내려가면 조정이 길어질 수 있는 신호다(지지 이탈).");
    if (t.rsi != null && t.rsi >= 70) o.push("RSI " + Math.round(t.rsi) + " 과열권 — 눌림 때 20일선(" + money(t.m20, kr) + ")이 지켜지는지 본다.");
    else if (t.m20 && t.px < t.m20) o.push("20일선(" + money(t.m20, kr) + ")을 종가로 되찾아야 단기 흐름이 살아난다.");
    if (rs && rs.st === "약함") o.push("시장 대비 약세가 이어지는지 확인 — 상대 강도가 돌아서야 반등이 오래간다.");
    return o.slice(0, 4);
  }
  function volText(t) {
    var s = ctrlText(t);
    if (t.v5r != null) s += " 최근 5일 평균 거래량은 20일 평균의 " + t.v5r.toFixed(2) + "배" + (t.v5r >= 1.3 ? "로 관심이 몰리는 중이다" : t.v5r <= 0.7 ? "로 거래가 식어 있다" : "로 평소 수준이다") + ".";
    if (t.bigUp + t.bigDn > 0) s += " 최근 20일 평균의 1.5배 넘게 터진 날은 상승 " + t.bigUp + "회 · 하락 " + t.bigDn + "회" + (t.bigUp > t.bigDn ? "로 매집 흔적이 우세하다." : t.bigDn > t.bigUp ? "로 물량이 나오는 흔적이 우세하다." : "로 비슷하다.");
    return s;
  }

  // ── 그림 ──
  function chartSvg(bars, t, kr, tm) {
    var b = bars.slice(-180), W = 640, Hh = 190, P = 6, n = b.length; if (n < 20) return "";
    var lo = Infinity, hi = -Infinity; b.forEach(function (x) { if (x.l < lo) lo = x.l; if (x.h > hi) hi = x.h; });
    if (tm && !(tm > t.px * 0.7 && tm < t.px * 1.3)) tm = null;
    [t.res, t.sup, t.tgt].forEach(function (z) { if (z) { lo = Math.min(lo, z.a); hi = Math.max(hi, z.z); } }); if (tm) { lo = Math.min(lo, tm); hi = Math.max(hi, tm); }
    var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var X = function (i) { return P + i * (W - 2 * P) / (n - 1); }, Y = function (p) { return P + (hi - p) / (hi - lo) * (Hh - 2 * P); };
    var cl = bars.map(function (x) { return x.c; }), off = bars.length - n;
    var line = function (fn, col, wd, dash) { var d = "", ok = false; for (var i = 0; i < n; i++) { var v = fn(off + i); if (v == null) { ok = false; continue; } d += (ok ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); ok = true; } return d ? '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + wd + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : "") + ' stroke-linejoin="round"/>' : ""; };
    var band = function (z, col, lab) { if (!z) return ""; var y1 = Y(z.z), y2 = Y(z.a); return '<rect x="0" y="' + y1.toFixed(1) + '" width="' + W + '" height="' + Math.max(3, y2 - y1).toFixed(1) + '" fill="' + col + '" opacity=".16"/><text x="' + (W - 6) + '" y="' + (y1 - 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="' + col + '">' + esc(lab) + "</text>"; };
    var hl = function (p, col, lab, dash) { var y = Y(p); return '<line x1="0" x2="' + W + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + col + '" stroke-width="1.2" stroke-dasharray="' + dash + '"/><text x="6" y="' + (y - 4).toFixed(1) + '" font-size="11" fill="' + col + '">' + esc(lab) + "</text>"; };
    var up = b[n - 1].c >= b[0].c;
    return '<svg class="lxa-ch" viewBox="0 0 ' + W + " " + Hh + '" preserveAspectRatio="none" role="img" aria-label="최근 9개월 가격 · 50일선 · ' + t.longN + '일선 · 매물대">' +
      (t.tgt ? hl(mid(t.tgt), "#E5484D", "목표 " + money(mid(t.tgt), kr), "2 4") : "") + (tm ? hl(tm, "#A78BFA", "애널리스트 평균 " + money(tm, kr), "6 3") : "") + band(t.res, "#E5484D", "관문 " + rng(t.res ? t.res.a : 0, t.res ? t.res.z : 0, kr)) + band(t.sup, "#3B82F6", "지지 " + rng(t.sup ? t.sup.a : 0, t.sup ? t.sup.z : 0, kr)) +
      line(function (i) { return sma(cl, t.longN, i + 1); }, "#9aa3b2", 1.2, "4 3") + line(function (i) { return sma(cl, 50, i + 1); }, "#F5A524", 1.3) +
      line(function (i) { return cl[i]; }, up ? "#E5484D" : "#3B82F6", 1.8) +
      '<circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(b[n - 1].c).toFixed(1) + '" r="3.2" fill="currentColor"/></svg>' +
      '<div class="lxa-lg"><span><i style="background:' + (up ? "#E5484D" : "#3B82F6") + '"></i>가격</span><span><i style="background:#F5A524"></i>50일선</span><span><i style="background:#9aa3b2"></i>' + t.longN + '일선</span><span><i style="background:#E5484D;opacity:.4"></i>위 관문</span><span><i style="background:#3B82F6;opacity:.4"></i>아래 지지</span>' + (t.tgt ? '<span><i style="background:#E5484D"></i>다음 목표</span>' : "") + (tm ? '<span><i style="background:#A78BFA"></i>애널리스트 평균</span>' : "") + "</div>";
  }
  function qBars(sym, qe) {
    if (!qe || !qe.ok) return "";
    var kr = isKr(sym), rows = [];
    if (!kr) { (qe.eps || []).slice(-5).forEach(function (x) { if (x.act != null || x.est != null) rows.push({ p: String(x.p).slice(0, 7), a: x.act, e: x.est }); });
      var t0 = (qe.trend || []).filter(function (x) { return x.per === "0q"; })[0]; if (t0 && t0.eps != null) rows.push({ p: (t0.end || "이번 분기").slice(0, 7), a: null, e: t0.eps, f: 1 }); }
    else (qe.q || []).forEach(function (x) { if (x.op != null) rows.push({ p: x.p, a: x.est ? null : x.op, e: x.est ? x.op : null, f: x.est ? 1 : 0 }); });
    if (rows.length < 2) return "";
    var mx = 0; rows.forEach(function (r) { mx = Math.max(mx, Math.abs(r.a || 0), Math.abs(r.e || 0)); }); if (!(mx > 0)) return "";
    var h = function (v) { return Math.max(2, Math.round(Math.abs(v) / mx * 84)); };
    return '<div class="lxa-q"><div class="lxa-qh"><b>' + (kr ? "분기 영업이익(억원)" : "분기 EPS(달러)") + '</b><span><i class="a"></i>실제 <i class="e"></i>' + (kr ? "컨센서스" : "예상") + "</span></div><div class=\"lxa-qb\">" +
      rows.map(function (r) {
        var lab = r.a != null ? (kr ? Math.round(r.a).toLocaleString() : r.a.toFixed(2)) : r.e != null ? (kr ? Math.round(r.e).toLocaleString() : r.e.toFixed(2)) : "";
        return '<div><span class="v">' + lab + '</span><span class="bw">' + (r.e != null && !kr ? '<i class="e" style="height:' + h(r.e) + 'px"></i>' : "") + (r.a != null ? '<i class="a' + (r.e != null && r.a < r.e ? " miss" : "") + '" style="height:' + h(r.a) + 'px"></i>' : r.e != null && (kr || r.f) ? '<i class="e f" style="height:' + h(r.e) + 'px"></i>' : "") + '</span><span class="p">' + esc(r.p) + (r.f ? " (전망)" : "") + "</span></div>";
      }).join("") + "</div></div>";
  }
  function css() {
    if (document.getElementById("lxaCss")) return; var s = document.createElement("style"); s.id = "lxaCss";
    s.textContent = ".lxa{display:flex;flex-direction:column;gap:10px}.lxa .bx{background:var(--s1,#141922);border:1px solid rgba(127,137,155,.18);border-radius:16px;padding:16px}html[data-theme=light] .lxa .bx{background:#fff}" +
      ".lxa .ph{font-size:16.5px;line-height:1.6;font-weight:600;margin:0}.lxa .ph em{font-style:normal;color:#7CC4FF}html[data-theme=light] .lxa .ph em{color:#1d6fd6}.lxa .tag{display:inline-flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}" +
      ".lxa .tag span{font-size:11.5px;padding:3px 9px;border-radius:999px;background:rgba(127,137,155,.15)}.lxa .tag span.up{background:rgba(229,72,77,.14);color:#E5484D}.lxa .tag span.dn{background:rgba(59,130,246,.14);color:#3B82F6}" +
      ".lxa p.t{margin:8px 0 0;font-size:14px;line-height:1.65;opacity:.92}.lxa h5{margin:0 0 8px;font-size:13px;opacity:.7;font-weight:700}.lxa ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:13.5px;line-height:1.55}" +
      ".lxa-ch{width:100%;height:190px;display:block;color:inherit}.lxa-lg{display:flex;flex-wrap:wrap;gap:10px;font-size:11.5px;opacity:.75;margin-top:6px}.lxa-lg i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:4px;vertical-align:middle}" +
      ".lxa-q{margin-top:4px}.lxa-qh{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;margin-bottom:8px}.lxa-qh span{opacity:.7;display:flex;gap:6px;align-items:center}.lxa-qh i{display:inline-block;width:10px;height:10px;border-radius:2px}" +
      ".lxa-q i.a{background:#3DD6B5}.lxa-q i.a.miss{background:#F5A524}.lxa-q i.e{background:rgba(127,137,155,.45)}.lxa-q i.e.f{background:repeating-linear-gradient(45deg,rgba(127,137,155,.55) 0 3px,transparent 3px 6px);border:1px solid rgba(127,137,155,.6)}" +
      ".lxa-qb{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:6px;align-items:end}.lxa-qb>div{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}.lxa-qb .bw{display:flex;align-items:flex-end;gap:2px;height:86px}" +
      ".lxa-qb .bw i{width:12px;border-radius:3px 3px 0 0}.lxa-qb .v{font-size:11px;font-variant-numeric:tabular-nums;opacity:.85;white-space:nowrap}.lxa-qb .p{font-size:10.5px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}" +
      ".lxa details.lxa-f>summary{list-style:none;cursor:pointer;display:flex;flex-direction:column;gap:4px;position:relative;padding-right:22px}.lxa details.lxa-f>summary::-webkit-details-marker{display:none}" +
      ".lxa details.lxa-f>summary h5{margin:0}.lxa details.lxa-f>summary .pv{font-size:12.5px;opacity:.62;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lxa details.lxa-f[open]>summary .pv{display:none}" +
      ".lxa details.lxa-f>summary::after{content:'';position:absolute;right:4px;top:5px;width:7px;height:7px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;opacity:.45;transform:rotate(45deg);transition:transform .15s}.lxa details.lxa-f[open]>summary::after{transform:rotate(-135deg);top:9px}" +
      ".lxa details.lxa-f .fb{margin-top:10px}" +
      ".lxa .ft{font-size:11.5px;opacity:.58;line-height:1.5}.lxa .bx{min-width:0}.lxa p,.lxa li{overflow-wrap:anywhere;word-break:keep-all}" +
      ".lxa .sm{margin:0 0 8px;font-size:13px;font-weight:700;line-height:1.5;padding:7px 10px;border-radius:10px;background:rgba(124,196,255,.12)}html[data-theme=light] .lxa .sm{background:rgba(29,111,214,.09)}" +
      ".lxa-sc{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:8px}.lxa-sc>div{min-width:0;border-radius:12px;padding:10px 12px;font-size:13.5px;line-height:1.55;display:flex;flex-direction:column;gap:3px}.lxa-sc b{font-size:12.5px}" +
      ".lxa-sc .u{background:rgba(229,72,77,.10)}.lxa-sc .u b{color:#E5484D}.lxa-sc .d{background:rgba(59,130,246,.10)}.lxa-sc .d b{color:#3B82F6}.lxa p.rr{font-weight:600}" +
      ".lxa-db{display:flex;height:8px;border-radius:99px;overflow:hidden;margin:0 0 10px;gap:2px}.lxa-db i{display:block;min-width:0}.lxa-db .b{background:#E5484D}.lxa-db .h{background:rgba(127,137,155,.5)}.lxa-db .s{background:#3B82F6}";
    document.head.appendChild(s);
  }
  function view(sym, o) {
    o = o || {}; css();
    var c = load(sym, o.redraw || function () {}), kr = isKr(sym);
    if (c.bars == null) return '<div class="emp">차트·실적 자료를 받는 중…</div>';
    var bars = c.bars.slice();
    var q = o.quote; if (q && q.regPrice > 0 && bars.length) { var lb = bars[bars.length - 1], dToday = new Date().toDateString() === new Date(lb.t * 1000).toDateString(); if (!dToday && q.mstate === "REGULAR") bars.push({ t: Date.now() / 1000, o: q.regPrice, h: q.regPrice, l: q.regPrice, c: q.regPrice, v: 0 }); }
    var t = techRead(bars, kr);
    if (!t) return '<div class="emp">일봉이 60개보다 적어 아직 분석하지 않습니다(신규 상장 등).</div>';
    var f = fundRead(sym, c.qe, o.fund, t.px), an = analystRead(c.an, t, kr), rs = rsRead(t, c.mk), sc = scenario(t, kr), ev = c.ev;
    var tg = ['<span class="' + (t.L === "up" ? "up" : t.L === "down" ? "dn" : "") + '">장기 ' + ({ up: "상승", down: "하락", side: "횡보" })[t.L] + "</span>",
      '<span>중기 ' + ({ trend: "추세 지속", pullback: "조정 중", rebound: "반등 시도", relief: "기술적 반등", reliefTry: "반등 시도", falling: "하락 지속", rangeHi: "박스 상단", rangeLo: "박스 하단" })[t.M] + "</span>",
      '<span class="' + (t.ctrl === "buy" ? "up" : t.ctrl === "sell" ? "dn" : "") + '">주도권 ' + ({ buy: "매수", sell: "매도", even: "팽팽" })[t.ctrl] + "</span>",
      f.lines.length ? '<span class="' + (f.pos >= f.neg + 2 ? "up" : f.neg >= f.pos + 2 ? "dn" : "") + '">실적 ' + (f.pos >= f.neg + 2 ? "우호" : f.neg >= f.pos + 2 ? "부담" : "중립") + "</span>" : "",
      rs ? '<span class="' + (rs.st === "강함" ? "up" : rs.st === "약함" ? "dn" : "") + '">시장 대비 ' + rs.st + "</span>" : ""].join("");
    var lv = levelText(t, kr), cps = checkpoints(t, ev, kr, rs);
    var dist = c.an && c.an.dist, dt = dist ? (dist.strongBuy || 0) + (dist.buy || 0) + (dist.hold || 0) + (dist.sell || 0) + (dist.strongSell || 0) : 0;
    var bar = dt >= 5 ? '<div class="lxa-db" role="img" aria-label="투자의견 분포"><i class="b" style="flex:' + ((dist.strongBuy || 0) + (dist.buy || 0)) + '"></i><i class="h" style="flex:' + (dist.hold || 0) + '"></i><i class="s" style="flex:' + ((dist.sell || 0) + (dist.strongSell || 0)) + '"></i></div>' : "";
    /* [V33.789] ★간결하게★(사용자 11/8 "종목상세 간결하게 · 지금 느낌은 유지") — 요약·시나리오·차트는 그대로 펼치고, 근거 묶음은 한 줄 미리보기 + 펼치기 */
    var fold = function (title, teaser, inner, open) { return '<details class="bx lxa-f"' + (open ? " open" : "") + '><summary><h5>' + esc(title) + '</h5><span class="pv">' + esc(String(teaser || "").slice(0, 90)) + '</span></summary><div class="fb">' + inner + "</div></details>"; };
    var ul = function (a) { return "<ul>" + a.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>"; };
    return '<div class="lxa">' +
      '<div class="bx"><div class="tag">' + tg + '</div><p class="sm">' + esc(summaryText(t, f, ev, kr)) + '</p><p class="ph"><em>' + esc(phaseText(t)) + "</em></p>" +
        '<p class="t">' + esc(ctrlText(t)) + " " + esc(lv.join(" ")) + "</p>" +
        '<p class="t">' + esc(linkText(t, f)) + "</p></div>" +
      '<div class="bx"><h5>시나리오</h5><div class="lxa-sc"><div class="u"><b>상승 시나리오</b><span>' + esc(sc.up.text) + '</span></div><div class="d"><b>하락 시나리오</b><span>' + esc(sc.dn.text) + "</span></div></div>" + (sc.rr ? '<p class="t rr">' + esc(sc.rr.text) + "</p>" : "") + "</div>" +
      '<div class="bx">' + chartSvg(bars, t, kr, c.an && c.an.ok ? c.an.tgtMean : null) + "</div>" +
      (cps.length ? fold("체크포인트", cps[0], ul(cps), true) : "") +
      (an || rs ? fold("애널리스트 · 시장 대비", an ? an.lines[0] : rs.text, bar + ul((an ? an.lines : []).concat(an ? [an.link] : [], rs ? [rs.text] : []))) : "") +
      fold("차트 근거", shortText(t), '<ul><li>' + esc(shortText(t)) + "</li><li>" + esc(t.longN + "일선 " + money(t.mL, kr) + " (20일 기울기 " + pct(t.slope, 2) + ") · 50일선 " + money(t.m50, kr) + " · 하루 평균 변동폭(ATR) " + money(t.atr, kr)) + "</li><li>" + esc(volText(t)) + "</li>" +
        (t.res ? "<li>" + esc("위 관문: " + rng(t.res.a, t.res.z, kr) + (t.res.k === "vp" ? " — 최근 120일 동안 거래가 가장 많이 쌓인 가격대(사 둔 사람이 많아 본전 매물이 나오는 자리)" : t.res.k === "ma" ? " — 위쪽에 두꺼운 매물대·스윙 고점이 가까이 없어 " + t.res.nm + "을 첫 회복 관문으로 본다" : " — 최근 120일의 직전 스윙 고점")) + "</li>" : "") +
        (t.sup ? "<li>" + esc("아래 지지: " + rng(t.sup.a, t.sup.z, kr) + (t.sup.k === "vp" ? " — 거래가 많이 쌓인 아래쪽 가격대" : " — 직전 스윙 저점")) + "</li>" : "") + "</ul>") +
      (f.lines.length || (c.qe && c.qe.ok) ? fold("실적 · 재무 · 업종 비교", f.lines[0] || "", qBars(sym, c.qe) + ul(f.lines), true) : (c.qe == null ? '<div class="bx"><div class="emp">실적 자료를 받는 중…</div></div>' : "")) +
      (f.val.length ? fold("밸류에이션 · 수익성", f.val[0], ul(f.val)) : "") +
      '<p class="ft">규칙으로 쓴 해설이며 예측이 아닙니다 · 가격대는 최근 1년 일봉에서 계산 · 실적·컨센서스: ' + esc((c.qe && c.qe.src) || "—") + " · 목표가: " + esc((c.an && c.an.src) || "—") + " · 업종 비교: 같은 업종 재무 중앙값(표본 5 이상) · 투자 권유 아님</p></div>";
  }
  window.luxAnalysis = { view: view, _tech: techRead, _fund: fundRead };
})();
