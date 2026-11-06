/* [V33.778] ★AI 전망 엔진(단기·중기·장기)★ — 사용자 11/6 "네가 판단 내린 근거랑 논리를 API 없이 우리 사이트도 판단 가능하게 · 모의투자 계좌 관리도 그런 식으로 어시스트".
   외부 AI·API 없이 화면이 이미 가진 값(시세 상태: 가격·5/20/50일선·RSI·5/20/60일·1년·5년 수익 · 지수 이력 · 시장 상승/하락 종목 수 · 매매법 AI 국면)만으로
   종목·업종을 세 기간으로 나눠 '긍정 · 중립 · 주의' 와 근거 문장을 낸다. 계산은 보는 사람 브라우저에서(서버 비용 0).
   규칙(사람이 읽는 그대로 — 근거 문장에 숫자가 같이 나간다):
     단기(1~4주) = 과매도·과열(RSI) · 최근 급락/급등(5일) · 5일선과 20일선 · 시장 전체 투매 여부(상승 종목 비율·지수 하루 등락) · 실적 발표 임박
     중기(1~6개월) = 50일선 위/아래 · 20일선과 50일선 배열 · 60일 수익의 지수 대비 강도 · 매매법 AI 시장 국면
     장기(1년 이상) = 1년·5년 추세 · 업종 구조 요인(사람이 검토한 표 · 검토일 표기) · 레버리지 상품 장기 보유 부적합
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

  function stock(q, C, opt) {
    opt = opt || {};
    if (!q || !(q.price > 0)) return null;
    var p = q.price, s = 0, m = 0, l = 0, ws = [], wm = [], wl = [];
    var lev = LEVS.test(q.symbol || "") || LEVN.test(q.name || "");
    // ── 단기 ──
    if (typeof q.rsi === "number") {
      if (q.rsi <= 30) { s += 1; ws.push("RSI " + Math.round(q.rsi) + " 과매도 — 짧은 반등이 자주 나오는 구간"); }
      else if (q.rsi >= 75) { s -= 1; ws.push("RSI " + Math.round(q.rsi) + " 과열 — 숨 고르기가 잦은 구간"); }
    }
    if (typeof q.return5 === "number") {
      if (q.return5 <= -10) { s += 1; ws.push("5일 " + pc(q.return5) + " 급락 — 낙폭이 커 되돌림 여지"); }
      else if (q.return5 >= 15) { s -= 1; ws.push("5일 " + pc(q.return5) + " 급등 — 차익 매물 나오기 쉬움"); }
    }
    if (q.dailyMaShort > 0 && q.ma > 0) {
      if (q.dailyMaShort < q.ma && p < q.ma) { s -= 1; ws.push("5일선이 20일선 아래 · 가격도 20일선 아래 — 단기 하락 흐름"); }
      else if (q.dailyMaShort > q.ma && p > q.ma) { s += 1; ws.push("5일선이 20일선 위 · 가격도 20일선 위 — 단기 상승 흐름"); }
    }
    if (C && C.upRatio != null && C.upRatio < 0.25 && C.ixDay != null && C.ixDay <= -2) { s -= 1; ws.push("시장 전체 투매(상승 종목 " + Math.round(C.upRatio * 100) + "% · 지수 " + pc(C.ixDay) + ") — 바닥 확인 전엔 변동이 크다"); }
    else if (C && C.upRatio != null && C.upRatio > 0.7) { s += 1; ws.push("시장 대부분이 상승(상승 종목 " + Math.round(C.upRatio * 100) + "%)"); }
    if (opt.earnDays != null && opt.earnDays >= 0 && opt.earnDays <= 7) ws.push("실적 발표 " + (opt.earnDays === 0 ? "오늘" : "D-" + opt.earnDays) + " — 발표 전후 크게 움직일 수 있음");
    // ── 중기 ──
    if (q.ma50 > 0) {
      if (p > q.ma50) { m += 1; wm.push("가격이 50일선 위(" + pc((p / q.ma50 - 1) * 100) + ") — 중기 추세 유지"); }
      else { m -= 1; wm.push("가격이 50일선 아래(" + pc((p / q.ma50 - 1) * 100) + ") — 중기 추세 꺾임"); }
      if (q.ma > 0) { if (q.ma > q.ma50) { m += 1; wm.push("20일선이 50일선 위 — 정배열"); } else { m -= 1; wm.push("20일선이 50일선 아래 — 역배열"); } }
    }
    if (typeof q.return60 === "number" && C && C.ix60 != null) {
      var rel = q.return60 - C.ix60;
      if (rel >= 5) { m += 1; wm.push("60일 수익 " + pc(q.return60) + " · 지수보다 " + pc(rel) + " 강함"); }
      else if (rel <= -5) { m -= 1; wm.push("60일 수익 " + pc(q.return60) + " · 지수보다 " + pc(rel) + " 약함"); }
    }
    if (C && C.regime) {
      if (C.regime === "BEAR" || C.regime === "CRASH") { m -= 1; wm.push("매매법 AI 시장 국면 " + (C.regime === "CRASH" ? "폭락" : "하락") + " — 새 매수에 불리"); }
      else if (C.regime === "BULL" || C.regime === "SURGE") { m += 1; wm.push("매매법 AI 시장 국면 " + (C.regime === "SURGE" ? "폭등" : "상승")); }
    }
    // ── 장기 ──
    if (lev) { l -= 2; wl.push("레버리지·인버스 상품 — 오래 들수록 변동성 손실이 쌓여 장기 보유에 맞지 않음"); }
    if (typeof q.ret1y === "number") {
      if (q.ret1y >= 20) { l += 1; wl.push("1년 " + pc(q.ret1y) + " — 장기 상승 추세"); }
      else if (q.ret1y <= -20) { l -= 1; wl.push("1년 " + pc(q.ret1y) + " — 장기 약세"); }
    }
    if (typeof q.ret5y === "number") {
      if (q.ret5y >= 100) { l += 1; wl.push("5년 " + pc(q.ret5y) + " — 오래 성장해 온 회사"); }
      else if (q.ret5y < 0) { l -= 1; wl.push("5년 " + pc(q.ret5y) + " — 5년 전보다 낮음"); }
    }
    var th = THEME[opt.sector || SECTOR_OF[q.symbol]];
    if (th && !lev) { l += th.s; wl.push(themeLines(th)[0]); wl.push(themeLines(th)[1]); }
    return { s: wrap(s, ws, "보통"), m: wrap(m, wm, "보통"), l: wrap(l, wl, th ? "낮음~보통" : "낮음") };
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
  window.luxOutlook = { whyHtml: whyHtml, stock: stock, basket: basket, ctxOf: ctxOf, BASKETS: BASKETS, THEME: THEME, sectorOf: function (s) { return SECTOR_OF[s] || null; } };
})();
