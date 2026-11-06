/* [V33.778] ★AI 전망 엔진(단기·중기·장기)★ — 사용자 11/6 "네가 판단 내린 근거랑 논리를 API 없이 우리 사이트도 판단 가능하게 · 모의투자 계좌 관리도 그런 식으로 어시스트".
   외부 AI·API 없이 화면이 이미 가진 값(시세 상태: 가격·5/20/50일선·RSI·5/20/60일·1년·5년 수익 · 지수 이력 · 시장 상승/하락 종목 수 · 매매법 AI 국면)만으로
   종목·업종을 세 기간으로 나눠 '긍정 · 중립 · 주의' 와 근거 문장을 낸다. 계산은 보는 사람 브라우저에서(서버 비용 0).
   규칙(사람이 읽는 그대로 — 근거 문장에 숫자가 같이 나간다):
     단기(1~4주) = 과매도·과열(RSI) · 최근 급락/급등(5일) · 5일선과 20일선 · 시장 전체 투매 여부(상승 종목 비율·지수 하루 등락) · 실적 발표 임박
     중기(1~6개월) = 50일선 위/아래 · 20일선과 50일선 배열 · 60일 수익의 지수 대비 강도 · 매매법 AI 시장 국면
     장기(1년 이상) = 1년·5년 추세 · 업종 구조 요인(사람이 검토한 표 · 검토일 표기) · 레버리지 상품 장기 보유 부적합
   ★역사 보정: 규칙별 가중치·라벨 경계·라벨별 과거 성적은 /outlook-weights.json(trainer/research/outlook_eval.py 가 만든다)에서 받는다.
     홀드아웃에서 방향이 확인된 규칙만 점수에 넣고 나머지는 '참고'. 못 받으면 아래 옛 정수 가중치로 동작. 결과 필드 p·ex·n = 과거 성적(있을 때만).
   한계: 실적 추정치·밸류에이션(PER) 같은 재무 자료는 아직 쓰지 않는다(상태에 없다) — 장기 판단은 신뢰도를 낮게 표시한다. 투자 권유가 아니다. */
(function () {
  "use strict";
  // 업종 구조 요인 — 사람이 근거를 찾아 검토한 표(검토일 표기 · 바뀌면 이 표만 고친다)
  var THEME = {
    semis: { asof: "2026-11", s: 1, why: "AI 데이터센터 투자가 2027년에도 늘 전망(빅테크 설비투자 2026년 약 7,000억 달러 → 2027년 1조 달러 안팎 전망)", whyEn: "AI data-center spending expected to keep rising in 2027 (big-tech capex ~$700B in 2026 → ~$1T in 2027)",
      risk: "사이클 산업 — 메모리 가격·설비투자 증가율이 꺾이면 크게 흔들린다 · 규제·수출 통제 변수", riskEn: "Cyclical — swings hard when memory prices or capex growth turn · regulation and export controls" },
    bigtech: { asof: "2026-11", s: 1, why: "클라우드·AI 매출 성장 지속 · 현금 창출력 큼", whyEn: "Cloud and AI revenue still growing · strong cash generation", risk: "AI 투자 회수 지연·규제 강화 우려", riskEn: "Slow payback on AI spending · tighter regulation" },
    krsemis: { asof: "2026-11", s: 1, why: "HBM(고대역폭 메모리) 수요 확대 — 2028년까지 연 40% 안팎 성장 전망", whyEn: "HBM (high-bandwidth memory) demand expanding — ~40% annual growth expected through 2028", risk: "메모리 사이클 · 환율 · 미국 반도체 흐름에 크게 연동", riskEn: "Memory cycle · FX · closely tied to US chip stocks" }
  };
  var BASKETS = {
    semis: { ko: "미국 반도체", mk: "us", syms: ["NVDA", "AVGO", "AMD", "TSM", "MU", "QCOM", "TXN", "ADI", "AMAT", "LRCX", "KLAC", "ASML", "MRVL", "ARM", "INTC", "ON", "NXPI", "MCHP", "MPWR"] },
    bigtech: { ko: "미국 빅테크", mk: "us", syms: ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NFLX", "TSLA"] },
    krsemis: { ko: "한국 반도체", mk: "kr", syms: ["005930.KS", "000660.KS", "042700.KS", "403870.KQ", "058470.KQ", "240810.KQ", "009150.KS"] }
  };
  var SECTOR_OF = {}; Object.keys(BASKETS).forEach(function (k) { BASKETS[k].syms.forEach(function (s) { SECTOR_OF[s] = k; }); });
  var LEVS = /SOXL|SOXS|TQQQ|SQQQ|TECL|TECS|UPRO|SPXU|SPXL|SPXS|LABU|LABD|FNGU|FNGD|TNA|TZA|NVDL|TSLL|UVXY|SVXY/;
  var LEVN = /레버리지|인버스|2X|3X|Ultra|Leverag|Inverse|Bull|Bear/i;

  // 근거 한 줄 = 문자열 또는 [한국어, 영어](사람이 쓴 문장은 영어를 같이 둔다 — 화면이 data-en 으로 붙인다)
  function themeLines(th) { return [[th.why + " (" + th.asof + " 검토)", th.whyEn + " (reviewed " + th.asof + ")"], ["위험: " + th.risk, "Risk: " + th.riskEn]]; }
  function pc(v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%"; }
  function lab(sc) { return sc >= 2 ? ["pos", "긍정"] : sc >= 1 ? ["pos1", "약간 긍정"] : sc <= -2 ? ["neg", "주의"] : sc <= -1 ? ["neg1", "약간 주의"] : ["mid", "중립"]; }
  function wrap(sc, why, conf) { sc = Math.max(-3, Math.min(3, sc)); var L = lab(sc); return { score: sc, cls: L[0], label: L[1], why: why, conf: conf || "보통" }; }

  // 시장 맥락: 지수 · 상승 종목 비율 · 국면
  function ctxOf(st, mk, regime) {
    var ixs = (st && st.indices) || [], ix = null, want = mk === "kr" ? "^KS11" : "^GSPC";
    for (var i = 0; i < ixs.length; i++) if (ixs[i].symbol === want) ix = ixs[i];
    var up = 0, dn = 0; ((st && st.watchlist) || []).forEach(function (x) { if (x.market === mk && !x.isEtf && typeof x.dayPct === "number") { if (x.dayPct > 0.005) up++; else if (x.dayPct < -0.005) dn++; } });
    var h = ix && ix.history || [], ix60 = h.length >= 40 && h[0] > 0 ? (ix.price / h[0] - 1) * 100 : null;
    var ix5 = h.length >= 6 && h[h.length - 6] > 0 ? (ix.price / h[h.length - 6] - 1) * 100 : null;
    return { ixDay: ix ? ix.dayPct : null, ix60: ix60, ix5: ix5, upRatio: up + dn > 0 ? up / (up + dn) : null, regime: regime || null, mk: mk };
  }

  // ── [V33.778+] 역사 보정 가중치 — /outlook-weights.json 을 처음 쓸 때 한 번만 받는다(없거나 실패하면 옛 정수 가중치로 계속 동작).
  //   trainer/research/outlook_eval.py 가 만든다: 규칙·시장(kr/us)·기간(s/m/l)마다 홀드아웃에서 확인된 가중치(0 이면 '참고'만),
  //   라벨 경계(thr)와 라벨별 과거 성적(p=시장 중앙값을 이긴 비율 · ex=%p · n=표본). 계산은 순수 산술 — 호출마다 fetch 하지 않는다.
  var WT = null, WT_REQ = false;
  function setWeights(j) { WT = (j && j.kr && j.us) ? j : null; }
  function loadWeights() {
    if (WT || WT_REQ || typeof fetch !== "function") return; WT_REQ = true;
    try {
      fetch("/outlook-weights.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        setWeights(j);
        try { if (WT && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("lux-outlook-weights")); } catch (e) {}
      }).catch(function () {});
    } catch (e) {}
  }
  function mkOf(q, C, opt) { return (C && C.mk) || (opt && opt.mk) || (/\.(KS|KQ)$/.test((q && q.symbol) || "") ? "kr" : "us"); }
  // 점수 → 5단계(2·1·0·−1·−2). 보정된 경계(thr)가 있으면 그것, 없으면 옛 정수 경계.
  function lvlOf(sc, thr) {
    if (thr) return sc >= thr.pos ? 2 : sc > thr.pos1 ? 1 : sc <= thr.neg ? -2 : sc < thr.neg1 ? -1 : 0;
    return sc >= 2 ? 2 : sc >= 1 ? 1 : sc <= -2 ? -2 : sc <= -1 ? -1 : 0;
  }
  var LV = { "2": ["pos", "긍정"], "1": ["pos1", "약간 긍정"], "0": ["mid", "중립"], "-1": ["neg1", "약간 주의"], "-2": ["neg", "주의"] };
  var HZN = { s: 10, m: 60, l: 250 };
  function fin(hz, core, ext, why, W, noScored) {
    var H = W && W[hz], thr = H && H.thr, L, sc = Math.round((core + ext) * 1e4) / 1e4, out;
    if (!H) { sc = Math.max(-3, Math.min(3, Math.round(sc))); L = lab(sc); return { score: sc, cls: L[0], label: L[1], why: why, conf: hz === "l" ? "낮음~보통" : "보통" }; }
    var lv = lvlOf(sc, thr); L = LV[String(lv)];
    out = { score: lv, cls: L[0], label: L[1], why: why, conf: noScored ? "낮음" : (hz === "l" ? "낮음~보통" : "보통"), sc: sc };
    var st = H.labels && H.labels[L[0]];   // 과거 성적은 '검증된 규칙만'으로 낸 점수의 라벨에 대한 것 — 사람이 정한 요인(국면·업종 표)이 얹히면 붙이지 않는다
    if (st && st.n > 0 && Math.abs(ext) < 1e-9 && st.p != null && st.ex != null) {
      out.p = st.p; out.ex = st.ex; out.n = st.n;
      var d = HZN[hz], e = st.ex, es = (e > 0 ? "+" : e < 0 ? "−" : "") + Math.abs(e).toFixed(1) + "%p", ps = Math.round(st.p * 100) + "%";
      why.push(["과거 비슷한 신호(검증 구간 " + st.n.toLocaleString("en-US") + "건): " + d + "거래일 뒤 평균 종목 대비 " + es + " · 시장 중앙값을 이긴 비율 " + ps,
                "Past similar signals (holdout, " + st.n.toLocaleString("en-US") + " cases): " + d + " trading days later " + es + " vs the average stock · beat the market median " + ps]);
    }
    return out;
  }

  function stock(q, C, opt) {
    opt = opt || {};
    if (!q || !(q.price > 0)) return null;
    loadWeights();
    var p = q.price, ws = [], wm = [], wl = [], mk = mkOf(q, C, opt), W = WT && WT[mk] ? WT[mk] : null;
    var core = { s: 0, m: 0, l: 0 }, ext = { s: 0, m: 0, l: 0 }, why = { s: ws, m: wm, l: wl }, nScored = { s: 0, m: 0, l: 0 };
    var lev = LEVS.test(q.symbol || "") || LEVN.test(q.name || "");
    // 규칙 한 개: 보정 가중치가 있으면 그 값(0 이면 '참고' 문구만, 점수 제외), 없으면 옛 정수 intW.
    function rule(hz, id, intW, ko, en) {
      var r = W && W[hz] && W[hz].rules && W[hz].rules[id];
      if (r && r.own) {
        if (r.w) { core[hz] += r.w; nScored[hz]++; why[hz].push(ko); }
        else why[hz].push(["참고(점수 미반영) · " + ko, "Reference only (not scored) · " + en]);
      } else { core[hz] += intW; why[hz].push(ko); }
    }
    // ── 단기 ──
    if (typeof q.rsi === "number") {
      var rs = Math.round(q.rsi);
      if (q.rsi <= 30) rule("s", "rsi_lo", 1, "RSI " + rs + " 과매도 — 짧은 반등이 자주 나오는 구간", "RSI " + rs + " oversold — short bounces are common here");
      else if (q.rsi >= 75) rule("s", "rsi_hi", -1, "RSI " + rs + " 과열 — 숨 고르기가 잦은 구간", "RSI " + rs + " overbought — pauses are common here");
    }
    if (typeof q.return5 === "number") {
      if (q.return5 <= -10) rule("s", "r5_dump", 1, "5일 " + pc(q.return5) + " 급락 — 낙폭이 커 되돌림 여지", "5-day " + pc(q.return5) + " plunge — room for a rebound");
      else if (q.return5 >= 15) rule("s", "r5_pump", -1, "5일 " + pc(q.return5) + " 급등 — 차익 매물 나오기 쉬움", "5-day " + pc(q.return5) + " surge — profit-taking is likely");
    }
    if (q.dailyMaShort > 0 && q.ma > 0) {
      if (q.dailyMaShort < q.ma && p < q.ma) rule("s", "ma_dn", -1, "5일선이 20일선 아래 · 가격도 20일선 아래 — 단기 하락 흐름", "5-day MA below 20-day MA and price below the 20-day MA — short-term downtrend");
      else if (q.dailyMaShort > q.ma && p > q.ma) rule("s", "ma_up", 1, "5일선이 20일선 위 · 가격도 20일선 위 — 단기 상승 흐름", "5-day MA above 20-day MA and price above the 20-day MA — short-term uptrend");
    }
    // 시장 전체 규칙은 종목 순위를 못 바꾼다(검증도 종목 간 초과수익이 아니라 지수 수익으로만 잴 수 있었음) → 보정 후엔 참고
    if (C && C.upRatio != null && C.upRatio < 0.25 && C.ixDay != null && C.ixDay <= -2) {
      var k1 = "시장 전체 투매(상승 종목 " + Math.round(C.upRatio * 100) + "% · 지수 " + pc(C.ixDay) + ") — 바닥 확인 전엔 변동이 크다";
      if (W) ws.push(["참고(점수 미반영) · " + k1, "Reference only (not scored) · market-wide sell-off (" + Math.round(C.upRatio * 100) + "% of stocks up, index " + pc(C.ixDay) + ") — volatile until a bottom is confirmed"]);
      else { core.s -= 1; ws.push(k1); }
    } else if (C && C.upRatio != null && C.upRatio > 0.7) {
      var k2 = "시장 대부분이 상승(상승 종목 " + Math.round(C.upRatio * 100) + "%)";
      if (W) ws.push(["참고(점수 미반영) · " + k2, "Reference only (not scored) · most of the market is up (" + Math.round(C.upRatio * 100) + "% of stocks)"]);
      else { core.s += 1; ws.push(k2); }
    }
    if (opt.earnDays != null && opt.earnDays >= 0 && opt.earnDays <= 7) ws.push("실적 발표 " + (opt.earnDays === 0 ? "오늘" : "D-" + opt.earnDays) + " — 발표 전후 크게 움직일 수 있음");
    // ── 중기 ──
    if (q.ma50 > 0) {
      if (p > q.ma50) rule("m", "a50_up", 1, "가격이 50일선 위(" + pc((p / q.ma50 - 1) * 100) + ") — 중기 추세 유지", "Price above the 50-day MA (" + pc((p / q.ma50 - 1) * 100) + ") — medium-term trend intact");
      else rule("m", "a50_dn", -1, "가격이 50일선 아래(" + pc((p / q.ma50 - 1) * 100) + ") — 중기 추세 꺾임", "Price below the 50-day MA (" + pc((p / q.ma50 - 1) * 100) + ") — medium-term trend broken");
      if (q.ma > 0) { if (q.ma > q.ma50) rule("m", "al_up", 1, "20일선이 50일선 위 — 정배열", "20-day MA above 50-day MA — bullish alignment"); else rule("m", "al_dn", -1, "20일선이 50일선 아래 — 역배열", "20-day MA below 50-day MA — bearish alignment"); }
    }
    if (typeof q.return60 === "number" && C && C.ix60 != null) {
      var rel = q.return60 - C.ix60;
      if (rel >= 5) rule("m", "rs_hi", 1, "60일 수익 " + pc(q.return60) + " · 지수보다 " + pc(rel) + " 강함", "60-day return " + pc(q.return60) + " · " + pc(rel) + " stronger than the index");
      else if (rel <= -5) rule("m", "rs_lo", -1, "60일 수익 " + pc(q.return60) + " · 지수보다 " + pc(rel) + " 약함", "60-day return " + pc(q.return60) + " · " + pc(rel) + " weaker than the index");
    }
    if (C && C.regime) {   // 국면은 역사에서 복원할 수 없어 검증하지 못했다 — 옛 ±1 그대로
      if (C.regime === "BEAR" || C.regime === "CRASH") { ext.m -= 1; wm.push("매매법 AI 시장 국면 " + (C.regime === "CRASH" ? "폭락" : "하락") + " — 새 매수에 불리"); }
      else if (C.regime === "BULL" || C.regime === "SURGE") { ext.m += 1; wm.push("매매법 AI 시장 국면 " + (C.regime === "SURGE" ? "폭등" : "상승")); }
    }
    // ── 장기 ──
    if (lev) { ext.l -= 2; wl.push("레버리지·인버스 상품 — 오래 들수록 변동성 손실이 쌓여 장기 보유에 맞지 않음"); }
    if (typeof q.ret1y === "number") {
      if (q.ret1y >= 20) rule("l", "y1_hi", 1, "1년 " + pc(q.ret1y) + " — 장기 상승 추세", "1-year " + pc(q.ret1y) + " — long-term uptrend");
      else if (q.ret1y <= -20) rule("l", "y1_lo", -1, "1년 " + pc(q.ret1y) + " — 장기 약세", "1-year " + pc(q.ret1y) + " — long-term weakness");
    }
    if (typeof q.ret5y === "number") {
      if (q.ret5y >= 100) rule("l", "y5_hi", 1, "5년 " + pc(q.ret5y) + " — 오래 성장해 온 회사", "5-year " + pc(q.ret5y) + " — a long-time grower");
      else if (q.ret5y < 0) rule("l", "y5_lo", -1, "5년 " + pc(q.ret5y) + " — 5년 전보다 낮음", "5-year " + pc(q.ret5y) + " — below its level five years ago");
    }
    var th = THEME[opt.sector || SECTOR_OF[q.symbol]];   // 업종 표도 사람이 검토한 값 — 역사로 검증 못 함, 그대로
    if (th && !lev) { ext.l += th.s; wl.push(themeLines(th)[0]); wl.push(themeLines(th)[1]); }
    if (W) ["s", "m", "l"].forEach(function (hz) {
      if (!nScored[hz] && W[hz] && !W[hz].thr) why[hz].push(["이 기간의 규칙은 과거 검증(" + (mk === "kr" ? "한국" : "미국") + ")에서 같은 날 시장 중앙값을 일관되게 이기지 못해 점수에 넣지 않았다 — 참고용",
        "No rule for this horizon beat the same-day market median consistently in historical tests (" + (mk === "kr" ? "Korea" : "US") + "), so none is scored — reference only"]);
    });
    return { s: fin("s", core.s, ext.s, ws, W, !nScored.s), m: fin("m", core.m, ext.m, wm, W, !nScored.m), l: fin("l", core.l, ext.l, wl, W, !nScored.l && !th) };
  }

  // 업종 = 구성 종목 판단의 평균(시총 가중) + 업종 자체 흐름
  function basket(key, st, regime) {
    var B = BASKETS[key]; if (!B || !st) return null;
    var map = {}; (st.watchlist || []).forEach(function (x) { map[x.symbol] = x; });
    var C = ctxOf(st, B.mk, regime), mem = B.syms.map(function (s) { return map[s]; }).filter(function (x) { return x && x.price > 0; });
    if (!mem.length) return null;
    var tw = 0, acc = { s: 0, m: 0, l: 0 }, d1 = 0, r5 = 0, r60 = 0, up = 0, ab50 = 0;
    mem.forEach(function (x) {
      var o = stock(x, C, { sector: key }), w = Math.sqrt(x.mcap || 1); if (!o) return;
      tw += w; acc.s += o.s.score * w; acc.m += o.m.score * w; acc.l += o.l.score * w;
      d1 += (x.dayPct || 0) * w; r5 += (x.return5 || 0) * w; r60 += (x.return60 || 0) * w; if ((x.dayPct || 0) > 0) up++; if (x.ma50 > 0 && x.price > x.ma50) ab50++;
    });
    if (!tw) return null;
    var avg = function (v) { return v / tw; };
    var sS = Math.round(avg(acc.s)), sM = Math.round(avg(acc.m)), sL = Math.round(avg(acc.l));
    var ws = ["업종 평균 오늘 " + pc(avg(d1)) + " · 5일 " + pc(avg(r5)) + " · 상승 " + up + "/" + mem.length + "종목"];
    if (avg(r5) <= -10) ws.push("5일 만에 두 자릿수 하락 — 과거엔 짧은 반등이 자주 나왔지만, 원인(규제·수요)이 풀리기 전엔 변동이 크다");
    if (C.upRatio != null && C.upRatio < 0.25) ws.push("시장 전체가 같이 빠지는 날 — 업종 고유 악재보다 위험 회피 성격");
    var wm = ["50일선 위 종목 " + ab50 + "/" + mem.length + " · 60일 평균 " + pc(avg(r60)) + (C.ix60 != null ? " (지수 " + pc(C.ix60) + ")" : "")];
    if (ab50 / mem.length < 0.3) wm.push("대부분 50일선 아래 — 중기 추세 회복엔 시간이 필요");
    else if (ab50 / mem.length > 0.7) wm.push("대부분 50일선 위 — 중기 추세 살아 있음");
    if (C.regime === "BEAR" || C.regime === "CRASH") wm.push("매매법 AI 국면 " + (C.regime === "CRASH" ? "폭락" : "하락"));
    var th = THEME[key], wl = th ? themeLines(th) : [];
    return { key: key, ko: B.ko, n: mem.length, s: wrap(sS, ws), m: wrap(sM, wm), l: wrap(sL, wl, "낮음~보통") };
  }

  function whyHtml(w, esc) { return Array.isArray(w) ? '<span data-en="' + esc(w[1]) + '">' + esc(w[0]) + "</span>" : esc(w); }
  window.luxOutlook = { setWeights: setWeights, weights: function () { return WT; }, whyHtml: whyHtml, stock: stock, basket: basket, ctxOf: ctxOf, BASKETS: BASKETS, THEME: THEME, sectorOf: function (s) { return SECTOR_OF[s] || null; } };
})();
