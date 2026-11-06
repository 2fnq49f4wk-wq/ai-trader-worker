/* ★LUX-Mini★ — 주식 전용 아주 작은 판단 모델(브라우저 계산 · 서버 CPU 0).
   단기(5거래일) · 중기(20거래일) · 장기(120거래일) × 한국·미국 = 머리 6개. 머리마다 얕은 나무(깊이 ≤ 3 · ≤ 64그루).
   출력(머리마다): p = 같은 시장 종목 중앙값을 이길 확률(검증 구간 Platt 보정 → 그날 같은 시장 평균이 0.5 가 되게 중심화 —
         목표가 '같은 날 중앙값 대비' 라 시장 평균은 정의상 0.5 다) · decile = 그날 같은 시장 안 점수 10분위(1~10) ·
         ex/exLo/exHi = 검증 구간에서 같은 10분위였던 종목의 '시장 중앙값 대비 초과수익'(%p) 중앙값·사분위 · label ·
         why = 근거 3줄 [한국어, 영어](Saabas 경로 기여도 상위 3 · 숫자 + 학습 구간 실제 승률) · usable(홀드아웃 검증 통과 여부).
   usable=false 인 머리는 화면에 반드시 '참고(검증 미달)' 로 표시한다(grade 필드).
   입력은 /api/state watchlist 가 이미 주는 시세 필드뿐(가격·전일 종가·RSI·5/20/50일선·ATR·볼린저·5/20/60일·1년 수익).
   ctx = ctxFrom(state, mk) 로 한 번 만든다(같은 시장 종목 전부의 특징·점수를 한 번에 센다 — 시장 맥락·백분위·10분위용).
   가중치 = /luxmini.json(정적 파일 · 한 번만 받는다). 학습·검증: trainer/research/luxmini_train.py · 결과: trainer/research/luxmini_README.md.
   투자 권유가 아니다.
   API: luxMini.load([url|obj]) → Promise · luxMini.ready() → bool · luxMini.ctxFrom(stateOrWatchlist, mk) → ctx
        luxMini.predict(quote, ctx) → { mk, asof, s:{…}, m:{…}, l:{…}, usable:{s,m,l} } | null
        luxMini.predictAll(state, mk) → { 종목코드: predict 결과 } */
(function (root) {
  "use strict";
  var BASE = ["dayPct", "rsi", "pMa5", "pMa20", "pMa50", "ma5_20", "ma20_50", "atrPct", "bbPos", "bbWidth", "r5", "r20", "r60", "r1y"];
  var FEATS = { pct: BASE, raw: BASE.concat(["rel5", "rel20", "rel60", "breadth", "mDay", "m5", "m60"]) };
  var HK = ["s", "m", "l"];
  var HNAME = { s: ["1주(5거래일)", "1 week (5 trading days)"], m: ["1달(20거래일)", "1 month (20 trading days)"], l: ["6개월(120거래일)", "6 months (120 trading days)"] };
  var LABELS = [["neg", "주의", "Caution"], ["neg", "주의", "Caution"], ["neg1", "약간 주의", "Slightly negative"], ["neg1", "약간 주의", "Slightly negative"],
    ["mid", "중립", "Neutral"], ["mid", "중립", "Neutral"], ["pos1", "약간 긍정", "Slightly positive"], ["pos1", "약간 긍정", "Slightly positive"],
    ["pos", "긍정", "Positive"], ["pos", "긍정", "Positive"]];
  var MODEL = null, LOADING = null;

  function num(v) { return (typeof v === "number" && isFinite(v)) ? v : NaN; }
  function pct(a, b) { return (b > 0 && a > 0) ? (a / b - 1) * 100 : NaN; }
  function sg(v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1); }
  function med(a) { if (!a.length) return NaN; a = a.slice().sort(function (x, y) { return x - y; }); var n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; }
  function qMk(x) { return (x && (x.market === "kr" || x.market === "us")) ? x.market : (/\.(KS|KQ)$/.test((x && x.symbol) || "") ? "kr" : "us"); }
  function wlOf(st) { return Array.isArray(st) ? st : ((st && st.watchlist) || []); }

  // 원값 특징(종목 하나) — trainer/research/luxmini_train.py feats_from_quote 와 1:1
  function baseFeats(q) {
    // 미국 시간외에는 price/dayPct 가 시간외 가격 기준이다(V33.777) — 학습은 정규장 종가 기준이라 정규장 값(regPrice·regPct)을 먼저 쓴다.
    var rp = num(q.regPrice), p = rp > 0 ? rp : num(q.price), ma5 = num(q.dailyMaShort), ma20 = num(q.ma), ma50 = num(q.ma50);
    var atr = num(q.atr), lo = num(q.bbLower), hi = num(q.bbUpper);
    var dp = rp > 0 ? num(q.regPct) : num(q.dayPct); if (isNaN(dp)) dp = pct(p, num(q.prevClose));
    var w = hi - lo;
    return [dp, num(q.rsi), pct(p, ma5), pct(p, ma20), pct(p, ma50), pct(ma5, ma20), pct(ma20, ma50),
      (atr > 0 && p > 0) ? atr / p * 100 : NaN, w > 0 ? Math.max(-1, Math.min(2, (p - lo) / w)) : NaN, (w > 0 && ma20 > 0) ? w / ma20 * 100 : NaN,
      num(q.return5), num(q.return20), num(q.return60), num(q.ret1y)];
  }

  function lowerB(a, v) { var lo = 0, hi = a.length; while (lo < hi) { var m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; }
  function upperB(a, v) { var lo = 0, hi = a.length; while (lo < hi) { var m = (lo + hi) >> 1; if (a[m] <= v) lo = m + 1; else hi = m; } return lo; }
  // 백분위 = 평균 순위 / n (pandas rank(pct=True, method='average') 와 같다) · 목록에 없는 값은 끼워 넣은 것으로 본다
  function pctRank(a, v) {
    if (v !== v || !a || a.length < 20) return NaN;
    var lo = lowerB(a, v), hi = upperB(a, v), eq = hi - lo;
    return eq > 0 ? (lo + (eq + 1) / 2) / a.length : (lo + 1) / (a.length + 1);
  }

  // 모델 입력 벡터(방식별) — b = baseFeats 결과, c = ctx
  function modelX(b, c, mode) {
    if (mode === "pct") { var x = new Array(b.length); for (var j = 0; j < b.length; j++) x[j] = pctRank(c.sorted[j], b[j]); return x; }
    return b.concat([b[10] - c.m5, b[11] - c.m20, b[12] - c.m60, c.breadth, c.mDay, c.m5, c.m60]);
  }

  // 나무 걷기 + Saabas 기여(노드 값 변화를 그 노드의 특징에 더한다 — 합 = 잎 값 − 뿌리 값)
  function walk(T, x, contrib) {
    var i = 0, f = T.f, t = T.t, L = T.l, R = T.r, M = T.m, V = T.v;
    while (f[i] >= 0) {
      var xv = x[f[i]], j;
      if (xv !== xv) j = M[i] === 0 ? (0 <= t[i] ? L[i] : R[i]) : (M[i] === 1 ? L[i] : R[i]);
      else j = xv <= t[i] ? L[i] : R[i];
      if (contrib) contrib[f[i]] += V[j] - V[i];
      i = j;
    }
    return contrib ? V[0] : V[i];
  }
  // raw = init + Σ(뿌리 값 + 경로 기여) = init + Σ 잎 값
  function score(H, x, contrib) {
    var r = H.init, i;
    for (i = 0; i < H.trees.length; i++) r += walk(H.trees[i], x, contrib);
    if (contrib) for (i = 0; i < contrib.length; i++) r += contrib[i];
    return r;
  }
  function prob(H, raw) { return 1 / (1 + Math.exp(-(H.platt[0] * raw + H.platt[1]))); }

  // 같은 시장 종목 전부로 맥락을 만든다(한 번) — 시장 맥락 · 특징 백분위 · 머리별 점수 분포(10분위)와 평균 확률(중심화).
  function ctxFrom(st, mk) {
    var wl = wlOf(st), rows = [], cols = BASE.map(function () { return []; });
    var up = 0, dn = 0, d = [], a5 = [], a20 = [], a60 = [];
    for (var i = 0; i < wl.length; i++) {
      var x = wl[i]; if (!x || !(num(x.price) > 0) || qMk(x) !== mk) continue;
      var b = baseFeats(x); rows.push(b);
      for (var j = 0; j < b.length; j++) if (b[j] === b[j]) cols[j].push(b[j]);
      if (b[0] === b[0]) { d.push(b[0]); if (b[0] > 0.005) up++; else if (b[0] < -0.005) dn++; }
      if (b[10] === b[10]) a5.push(b[10]);
      if (b[11] === b[11]) a20.push(b[11]);
      if (b[12] === b[12]) a60.push(b[12]);
    }
    for (var k = 0; k < cols.length; k++) cols[k].sort(function (p, q) { return p - q; });
    return { mk: mk, n: rows.length, sorted: cols, breadth: up + dn > 0 ? up / (up + dn) : NaN, mDay: med(d), m5: med(a5), m20: med(a20), m60: med(a60),
      heads: null, _rows: rows };
  }
  // 머리별 그날 점수 분포 — 모델이 실린 뒤 처음 쓸 때 한 번 센다
  function ensureHeads(c, mm, mode) {
    if (c.heads) return c.heads;
    var hs = {};
    HK.forEach(function (hk) {
      var H = mm.heads[hk], sc = [], ps = 0, n = 0;
      for (var i = 0; i < c._rows.length; i++) {
        var b = c._rows[i]; if (!(b[12] === b[12] && b[4] === b[4])) continue;   // 학습과 같은 유효 조건(60일 수익·50일선)
        var r = score(H, modelX(b, c, mode), null); sc.push(r); ps += prob(H, r); n++;
      }
      sc.sort(function (p, q) { return p - q; });
      hs[hk] = { sorted: sc, meanP: n ? ps / n : 0.5 };
    });
    c.heads = hs;
    return hs;
  }

  // 특징 값 → 사람 말 [ko, en]
  function phrase(k, v, mk) {
    var A = Math.abs(v).toFixed(1);
    switch (k) {
      case "dayPct": return ["오늘 " + sg(v) + "%", "Today " + sg(v) + "%"];
      case "rsi": return ["RSI " + Math.round(v) + (v <= 30 ? "(과매도)" : v >= 70 ? "(과열)" : ""), "RSI " + Math.round(v) + (v <= 30 ? " (oversold)" : v >= 70 ? " (overbought)" : "")];
      case "pMa5": return ["5일선보다 " + A + "% " + (v >= 0 ? "위" : "아래"), A + "% " + (v >= 0 ? "above" : "below") + " the 5-day average"];
      case "pMa20": return ["20일선보다 " + A + "% " + (v >= 0 ? "위" : "아래"), A + "% " + (v >= 0 ? "above" : "below") + " the 20-day average"];
      case "pMa50": return ["50일선보다 " + A + "% " + (v >= 0 ? "위" : "아래"), A + "% " + (v >= 0 ? "above" : "below") + " the 50-day average"];
      case "ma5_20": return ["5일선이 20일선보다 " + A + "% " + (v >= 0 ? "위" : "아래"), "5-day average " + A + "% " + (v >= 0 ? "above" : "below") + " the 20-day"];
      case "ma20_50": return ["20일선이 50일선보다 " + A + "% " + (v >= 0 ? "위(상승 배열)" : "아래(하락 배열)"), "20-day average " + A + "% " + (v >= 0 ? "above" : "below") + " the 50-day"];
      case "atrPct": return ["하루 변동폭(ATR)이 가격의 " + v.toFixed(1) + "%", "Daily range (ATR) " + v.toFixed(1) + "% of price"];
      case "bbPos": return ["볼린저 밴드 위치 " + Math.round(v * 100) + "%(0=하단 · 100=상단)", "Bollinger position " + Math.round(v * 100) + "% (0=lower · 100=upper)"];
      case "bbWidth": return ["볼린저 밴드 폭 " + v.toFixed(1) + "%", "Bollinger width " + v.toFixed(1) + "%"];
      case "r5": return ["5일 수익 " + sg(v) + "%", "5-day return " + sg(v) + "%"];
      case "r20": return ["20일 수익 " + sg(v) + "%", "20-day return " + sg(v) + "%"];
      case "r60": return ["60일 수익 " + sg(v) + "%", "60-day return " + sg(v) + "%"];
      case "r1y": return ["1년 수익 " + sg(v) + "%", "1-year return " + sg(v) + "%"];
      case "rel5": return ["5일 수익이 시장 중앙값보다 " + A + "%p " + (v >= 0 ? "높음" : "낮음"), "5-day return " + A + "pp " + (v >= 0 ? "above" : "below") + " the market median"];
      case "rel20": return ["20일 수익이 시장 중앙값보다 " + A + "%p " + (v >= 0 ? "높음" : "낮음"), "20-day return " + A + "pp " + (v >= 0 ? "above" : "below") + " the market median"];
      case "rel60": return ["60일 수익이 시장 중앙값보다 " + A + "%p " + (v >= 0 ? "높음" : "낮음"), "60-day return " + A + "pp " + (v >= 0 ? "above" : "below") + " the market median"];
      case "breadth": return ["오늘 " + (mk === "kr" ? "한국" : "미국") + " 시장 상승 종목 비율 " + Math.round(v * 100) + "%", "Share of " + (mk === "kr" ? "Korean" : "US") + " stocks up today " + Math.round(v * 100) + "%"];
      case "mDay": return ["시장 중앙 종목 오늘 " + sg(v) + "%", "Median stock today " + sg(v) + "%"];
      case "m5": return ["시장 중앙 종목 5일 " + sg(v) + "%", "Median stock 5-day " + sg(v) + "%"];
      case "m60": return ["시장 중앙 종목 60일 " + sg(v) + "%", "Median stock 60-day " + sg(v) + "%"];
    }
    return [k + " " + v, k + " " + v];
  }

  // 근거 3줄 — 기여 큰 순 · 동률은 특징 순서(결정적). show = 사람에게 보일 원값(pct 방식이면 원값, raw 방식이면 x 와 같다)
  function why(mm, hk, fe, x, show, contrib, mk, mode) {
    var order = [];
    for (var j = 0; j < contrib.length; j++) if (contrib[j] !== 0 && x[j] === x[j] && show[j] === show[j]) order.push(j);
    order.sort(function (a, b) { return Math.abs(contrib[b]) - Math.abs(contrib[a]) || a - b; });
    var out = [], hn = HNAME[hk];
    for (var r = 0; r < order.length && out.length < 3; r++) {
      var j2 = order[r], k = fe[j2], up = contrib[j2] > 0, ph = phrase(k, show[j2], mk);
      if (mode === "pct") { var tp = Math.max(1, Math.min(99, Math.round((1 - x[j2]) * 100))); ph = [ph[0] + "(시장 상위 " + tp + "%)", ph[1] + " (top " + tp + "% of market)"]; }
      var bins = mm.bins && mm.bins[hk] && mm.bins[hk][k], edges = mm.edges && mm.edges[k], wr = null;
      if (bins && edges) { var bk = 0; while (bk < edges.length && x[j2] >= edges[bk]) bk++; wr = bins[bk]; }   // searchsorted(side='right')
      var ko, en;
      if (wr != null && (wr >= 0.5) === up) {
        var w = Math.round(wr * 100);
        ko = ph[0] + " — 과거 비슷한 경우 " + hn[0] + " 뒤 시장보다 " + (up ? "강했던" : "약했던") + " 편(승률 " + w + "%)";
        en = ph[1] + " — historically " + (up ? "outperformed" : "underperformed") + " the market over " + hn[1] + " (win rate " + w + "%)";
      } else {
        var w2 = wr != null ? Math.round(wr * 100) : null;
        ko = ph[0] + " — 다른 조건과 겹쳐 " + hn[0] + " 전망을 " + (up ? "올린" : "낮춘") + " 요인" + (w2 != null ? "(이 값만 봤을 때 승률 " + w2 + "%)" : "");
        en = ph[1] + " — combined with other signals, " + (up ? "raises" : "lowers") + " the " + hn[1] + " view" + (w2 != null ? " (win rate on its own " + w2 + "%)" : "");
      }
      out.push([ko, en]);
    }
    return out;
  }

  function head(mm, hk, fe, x, show, mk, mode, hs) {
    var H = mm.heads[hk]; if (!H) return null;
    var contrib = new Array(fe.length); for (var j = 0; j < contrib.length; j++) contrib[j] = 0;
    var raw = score(H, x, contrib);
    var p = Math.max(0.01, Math.min(0.99, prob(H, raw) - hs.meanP + 0.5));
    var rk = pctRank(hs.sorted, raw), dec = rk === rk ? Math.min(9, Math.floor(rk * 10)) : 4;
    var ex = H.ex_tab[dec] || [0, 0, 0, 0, 0.5], L = LABELS[dec];
    var hd = H.hold || {}, usable = !!hd.usable;
    return {
      p: Math.round(p * 1000) / 1000, decile: dec + 1, ex: ex[0], exLo: ex[1], exHi: ex[2], exMean: ex[3], winVal: ex[4],
      label: L[1], labelEn: L[2], cls: L[0], usable: usable,
      grade: usable ? ["검증 통과", "Validated"] : ["참고(검증 미달)", "Reference only (not validated)"],
      why: why(mm, hk, fe, x, show, contrib, mk, mode), h: H.h,
      stats: { auc: hd.auc, ic: hd.ic, ic_t: hd.ic_t, base_ic: hd.base_ic, d_ic_t: hd.d_ic_t, top10_net: hd.top10_net, cost: hd.cost }
    };
  }

  function predict(q, ctx) {
    if (!MODEL || !q || !(num(q.price) > 0)) return null;
    var mk = qMk(q), mm = MODEL.mk[mk]; if (!mm) return null;
    // 같은 시장 맥락이 없으면 판단하지 않는다(엉뚱한 값보다 낫다) — ctxFrom(state, mk) 로 만든 것만 받는다
    if (!ctx || ctx.mk !== mk || !ctx.sorted || !(ctx.n >= 50)) return null;
    var mode = MODEL.mode, fe = FEATS[mode], b = baseFeats(q);
    if (!(b[12] === b[12] && b[4] === b[4])) return null;   // 60일 수익·50일선 없는 종목(신규 상장 등)은 학습에도 없었다
    var x = modelX(b, ctx, mode), show = mode === "pct" ? b : x, hs = ensureHeads(ctx, mm, mode);
    var out = { mk: mk, asof: mm.asof, usable: {} };
    for (var i = 0; i < HK.length; i++) { var r = head(mm, HK[i], fe, x, show, mk, mode, hs[HK[i]]); out[HK[i]] = r; out.usable[HK[i]] = !!(r && r.usable); }
    return out;
  }
  function predictAll(st, mk) {
    var c = ctxFrom(st, mk), wl = wlOf(st), o = {};
    for (var i = 0; i < wl.length; i++) { var q = wl[i]; if (q && q.symbol && qMk(q) === mk) { var r = predict(q, c); if (r) o[q.symbol] = r; } }
    return o;
  }

  function setModel(j) {
    if (!j || !j.mk || !FEATS[j.mode] || !Array.isArray(j.feats) || j.feats.join() !== FEATS[j.mode].join()) throw new Error("luxmini: feature spec mismatch");
    MODEL = j; return j;
  }
  function load(src) {
    if (MODEL) return Promise.resolve(MODEL);
    if (src && typeof src === "object") { try { return Promise.resolve(setModel(src)); } catch (e) { return Promise.reject(e); } }
    if (LOADING) return LOADING;
    var url = (typeof src === "string" && src) || "/luxmini.json";
    LOADING = fetch(url, { credentials: "omit" }).then(function (r) { if (!r.ok) throw new Error("luxmini " + r.status); return r.json(); })
      .then(setModel).catch(function (e) { LOADING = null; throw e; });
    return LOADING;
  }

  root.luxMini = { load: load, ready: function () { return !!MODEL; }, predict: predict, predictAll: predictAll, ctxFrom: ctxFrom,
    // 검사용: 모델 입력 벡터를 바로 넣어 나무 점수를 낸다(게이트의 파이썬 패리티 벡터)
    _rawX: function (mk, hk, x) { return score(MODEL.mk[mk].heads[hk], x.map(function (v) { return v == null ? NaN : v; }), null); } };
})(typeof window !== "undefined" ? window : globalThis);
