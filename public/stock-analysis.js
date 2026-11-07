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
    c = C[sym] = { bars: null, qe: null, ts: Date.now(), err: {} };
    getJ("/api/chart?symbol=" + encodeURIComponent(sym) + "&range=1y&interval=1d").then(function (j) { c.bars = (j && j.candles || []).filter(function (b) { return b && b.c > 0 && b.h > 0 && b.l > 0; }); redraw(); }).catch(function () { c.bars = []; c.err.bars = 1; redraw(); });
    getJ("/api/qearn?symbol=" + encodeURIComponent(sym)).then(function (j) { c.qe = j || {}; redraw(); }).catch(function () { c.qe = { ok: false }; redraw(); });
    return c;
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
    return { up: up, dn: dn, inZ: inZ };
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
    var dd = (px / hi60 - 1) * 100, r5 = (px / cl[n - 6] - 1) * 100, R = rsi(cl, 14), A = atr(bars, 14);
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
    return { px: px, m20: m20, m50: m50, mL: mL, longN: longN, slope: slope, dd: dd, hi60: hi60, hi252: hi252, r5: r5, rsi: R, atr: A, vr: vr, obvUp: obvUp, ctrl: ctrl, L: L, M: M, res: res, sup: sup, inZ: Z.inZ, vp: vp };
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
  function fundRead(sym, qe, fund) {
    var kr = isKr(sym), pos = 0, neg = 0, lines = [];
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
        if (v.pe || v.fpe) lines.push("PER " + (v.pe ? v.pe.toFixed(1) + "배" : "—") + (v.fpe ? " · 1년 뒤 실적 기준 " + v.fpe.toFixed(1) + "배" : "") + (v.peg ? " · PEG " + v.peg.toFixed(2) : "") + (v.fpe && v.pe && v.fpe < v.pe * 0.85 ? " — 이익이 늘 것으로 보여 앞으로의 PER 이 더 낮다." : "."));
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
        var lastWithPer = q.filter(function (x) { return x.per != null; }).slice(-1)[0];
        if (lastWithPer) lines.push("PER " + lastWithPer.per.toFixed(1) + "배" + (lastWithPer.roe != null ? " · ROE " + lastWithPer.roe.toFixed(1) + "%" : "") + " (" + lastWithPer.p + (lastWithPer.est ? " 컨센서스 기준" : " 기준") + ").");
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
    return { lines: lines, pos: pos, neg: neg };
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

  // ── 그림 ──
  function chartSvg(bars, t, kr) {
    var b = bars.slice(-180), W = 640, Hh = 190, P = 6, n = b.length; if (n < 20) return "";
    var lo = Infinity, hi = -Infinity; b.forEach(function (x) { if (x.l < lo) lo = x.l; if (x.h > hi) hi = x.h; });
    [t.res, t.sup].forEach(function (z) { if (z) { lo = Math.min(lo, z.a); hi = Math.max(hi, z.z); } });
    var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var X = function (i) { return P + i * (W - 2 * P) / (n - 1); }, Y = function (p) { return P + (hi - p) / (hi - lo) * (Hh - 2 * P); };
    var cl = bars.map(function (x) { return x.c; }), off = bars.length - n;
    var line = function (fn, col, wd, dash) { var d = "", ok = false; for (var i = 0; i < n; i++) { var v = fn(off + i); if (v == null) { ok = false; continue; } d += (ok ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); ok = true; } return d ? '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + wd + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : "") + ' stroke-linejoin="round"/>' : ""; };
    var band = function (z, col, lab) { if (!z) return ""; var y1 = Y(z.z), y2 = Y(z.a); return '<rect x="0" y="' + y1.toFixed(1) + '" width="' + W + '" height="' + Math.max(3, y2 - y1).toFixed(1) + '" fill="' + col + '" opacity=".16"/><text x="' + (W - 6) + '" y="' + (y1 - 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="' + col + '">' + esc(lab) + "</text>"; };
    var up = b[n - 1].c >= b[0].c;
    return '<svg class="lxa-ch" viewBox="0 0 ' + W + " " + Hh + '" preserveAspectRatio="none" role="img" aria-label="최근 9개월 가격 · 50일선 · ' + t.longN + '일선 · 매물대">' +
      band(t.res, "#E5484D", "관문 " + rng(t.res ? t.res.a : 0, t.res ? t.res.z : 0, kr)) + band(t.sup, "#3B82F6", "지지 " + rng(t.sup ? t.sup.a : 0, t.sup ? t.sup.z : 0, kr)) +
      line(function (i) { return sma(cl, t.longN, i + 1); }, "#9aa3b2", 1.2, "4 3") + line(function (i) { return sma(cl, 50, i + 1); }, "#F5A524", 1.3) +
      line(function (i) { return cl[i]; }, up ? "#E5484D" : "#3B82F6", 1.8) +
      '<circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(b[n - 1].c).toFixed(1) + '" r="3.2" fill="currentColor"/></svg>' +
      '<div class="lxa-lg"><span><i style="background:' + (up ? "#E5484D" : "#3B82F6") + '"></i>가격</span><span><i style="background:#F5A524"></i>50일선</span><span><i style="background:#9aa3b2"></i>' + t.longN + '일선</span><span><i style="background:#E5484D;opacity:.4"></i>위 관문</span><span><i style="background:#3B82F6;opacity:.4"></i>아래 지지</span></div>';
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
      ".lxa .ft{font-size:11.5px;opacity:.58;line-height:1.5}";
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
    var f = fundRead(sym, c.qe, o.fund);
    var tg = ['<span class="' + (t.L === "up" ? "up" : t.L === "down" ? "dn" : "") + '">장기 ' + ({ up: "상승", down: "하락", side: "횡보" })[t.L] + "</span>",
      '<span>중기 ' + ({ trend: "추세 지속", pullback: "조정 중", rebound: "반등 시도", relief: "기술적 반등", reliefTry: "반등 시도", falling: "하락 지속", rangeHi: "박스 상단", rangeLo: "박스 하단" })[t.M] + "</span>",
      '<span class="' + (t.ctrl === "buy" ? "up" : t.ctrl === "sell" ? "dn" : "") + '">주도권 ' + ({ buy: "매수", sell: "매도", even: "팽팽" })[t.ctrl] + "</span>",
      f.lines.length ? '<span class="' + (f.pos >= f.neg + 2 ? "up" : f.neg >= f.pos + 2 ? "dn" : "") + '">실적 ' + (f.pos >= f.neg + 2 ? "우호" : f.neg >= f.pos + 2 ? "부담" : "중립") + "</span>" : ""].join("");
    var lv = levelText(t, kr);
    return '<div class="lxa">' +
      '<div class="bx"><div class="tag">' + tg + '</div><p class="ph"><em>' + esc(phaseText(t)) + "</em></p>" +
        '<p class="t">' + esc(ctrlText(t)) + " " + esc(lv.join(" ")) + "</p>" +
        '<p class="t">' + esc(linkText(t, f)) + "</p></div>" +
      '<div class="bx">' + chartSvg(bars, t, kr) + "</div>" +
      '<div class="bx"><h5>차트 근거</h5><ul><li>' + esc(shortText(t)) + "</li><li>" + esc(t.longN + "일선 " + money(t.mL, kr) + " (20일 기울기 " + pct(t.slope, 2) + ") · 50일선 " + money(t.m50, kr) + " · 하루 평균 변동폭(ATR) " + money(t.atr, kr)) + "</li>" +
        (t.res ? "<li>" + esc("위 관문: " + rng(t.res.a, t.res.z, kr) + (t.res.k === "vp" ? " — 최근 120일 동안 거래가 가장 많이 쌓인 가격대(사 둔 사람이 많아 본전 매물이 나오는 자리)" : t.res.k === "ma" ? " — 위쪽에 두꺼운 매물대·스윙 고점이 가까이 없어 " + t.res.nm + "을 첫 회복 관문으로 본다" : " — 최근 120일의 직전 스윙 고점")) + "</li>" : "") +
        (t.sup ? "<li>" + esc("아래 지지: " + rng(t.sup.a, t.sup.z, kr) + (t.sup.k === "vp" ? " — 거래가 많이 쌓인 아래쪽 가격대" : " — 직전 스윙 저점")) + "</li>" : "") + "</ul></div>" +
      (f.lines.length || (c.qe && c.qe.ok) ? '<div class="bx"><h5>실적 · 재무 · 업종 비교</h5>' + qBars(sym, c.qe) + "<ul>" + f.lines.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : (c.qe == null ? '<div class="bx"><div class="emp">실적 자료를 받는 중…</div></div>' : "")) +
      '<p class="ft">규칙으로 쓴 해설이며 예측이 아닙니다 · 가격대는 최근 1년 일봉에서 계산 · 실적·컨센서스: ' + esc((c.qe && c.qe.src) || "—") + " · 업종 비교: 같은 업종 재무 중앙값(표본 5 이상) · 투자 권유 아님</p></div>";
  }
  window.luxAnalysis = { view: view, _tech: techRead, _fund: fundRead };
})();
