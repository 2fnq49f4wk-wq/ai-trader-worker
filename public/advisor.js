/* [V33.778] ★조언 기능 강화 — AI 코치(규칙·템플릿 기반 · 브라우저 계산 · 서버 비용 0)★
   외부 AI·API 없이, 화면이 이미 가진 값(내 계좌·시세·AI 전망 luxOutlook·매도 의견·AI 보유)만 골라 자연어 문단으로 엮는다.
   - holding(sym,pos,quote,ctx)  → 종목 한 줄 요약(short) + 2~4문장 조언 + 체크리스트
   - account(mk,av,holdings,ctx) → 계좌 전체 조언 + 우선순위 3개
   - coach(intent,mk,av,holdings,ctx) → "왜 떨어졌어?" 같은 정해진 질문에 내 데이터로 답(칩)
   반환 {ko,en,tone:'ok'|'watch'|'risk',actions:[{ko,en}]}. 숫자는 문장에 그대로 넣는다. 투자 권유가 아니다.
   화면은 span(o) 로 '<span data-en="영어">한국어</span>' 를 그린다(i18n.js 가 영어일 때 data-en 을 쓴다). */
(function () {
  "use strict";
  var RG = { SURGE: ["급등장", "a surging market"], BULL: ["상승장", "a rising market"], NEUTRAL: ["횡보장", "a sideways market"], BEAR: ["하락장", "a falling market"], CRASH: ["급락장", "a crashing market"] };
  var BAND = { SURGE: [10, 40], BULL: [10, 40], NEUTRAL: [30, 60], BEAR: [50, 80], CRASH: [50, 90] };
  var LBL = { "긍정": "positive", "약간 긍정": "slightly positive", "중립": "neutral", "약간 주의": "slightly cautious", "주의": "cautious" };
  var SVEN = { hold: "Hold", cut: "Risk limit reached", watch: "Watch closely" };
  // 업종 보강 표(luxOutlook.sectorOf 가 모르는 종목) — 단순 분류
  var EXTRA = {
    "지수 ETF": ["Index ETF", /^(SPY|QQQ|VOO|VTI|IVV|DIA|IWM|SCHD|JEPI|069500\.KS|102110\.KS|229200\.KQ|360750\.KS|133690\.KS)$/],
    "레버리지·인버스": ["Leveraged/inverse", /^(TQQQ|SQQQ|SOXL|SOXS|UPRO|SPXU|TNA|TZA|LABU|LABD|TECL|TECS|NVDL|TSLL|FAS|FAZ|122630\.KS|252670\.KS|114800\.KS)$/],
    "전기차·배터리": ["EV/battery", /^(TSLA|RIVN|LCID|NIO|373220\.KS|006400\.KS|051910\.KS|247540\.KQ|086520\.KQ)$/],
    "금융": ["Financials", /^(JPM|BAC|GS|MS|WFC|C|V|MA|BRK\.B|105560\.KS|055550\.KS|086790\.KS|316140\.KS)$/],
    "바이오·헬스": ["Biotech/health", /^(LLY|UNH|JNJ|PFE|MRK|ABBV|AMGN|GILD|207940\.KS|068270\.KS|196170\.KQ)$/],
    "에너지": ["Energy", /^(XOM|CVX|COP|OXY|SLB|010950\.KS)$/]
  };
  var BASKET_EN = { semis: "US semiconductors", bigtech: "US big tech", krsemis: "Korean semiconductors" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function span(o) { return o ? '<span data-en="' + esc(o.en) + '">' + esc(o.ko) + "</span>" : ""; }
  function pc(v, d) { d = d == null ? 1 : d; return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%"; }
  function money(mk, v, sign) {
    if (v == null || !isFinite(v)) return "—";
    var s = sign ? (v > 0 ? "+" : v < 0 ? "−" : "") : (v < 0 ? "−" : ""), a = Math.abs(v);
    return s + (mk === "kr" ? "₩" + Math.round(a).toLocaleString() : "$" + (a >= 1000 ? Math.round(a).toLocaleString() : a >= 1 ? a.toFixed(2) : a.toFixed(4)));
  }
  function px(mk, v) { return v == null || !isFinite(v) ? "—" : mk === "kr" ? "₩" + Math.round(v).toLocaleString() : "$" + v.toFixed(v >= 1 ? 2 : 4); }
  function join(parts) { return { ko: parts.map(function (p) { return p[0]; }).join(" "), en: parts.map(function (p) { return p[1]; }).join(" ") }; }
  function A(ko, en) { return { ko: ko, en: en }; }
  function regimeOf(ctx) { return ctx && ctx.regime && RG[ctx.regime] ? ctx.regime : null; }

  function sectorOfSym(sym, name) {
    var L = window.luxOutlook, k = L && L.sectorOf ? L.sectorOf(sym) : null;
    if (k && L.BASKETS && L.BASKETS[k]) return [L.BASKETS[k].ko, BASKET_EN[k] || L.BASKETS[k].ko];
    for (var n in EXTRA) if (EXTRA[n][1].test(sym)) return [n, EXTRA[n][0]];
    return null;
  }
  function outlookFor(sym, quote, ctx) {
    if (ctx && ctx.outlook) return ctx.outlook;
    var L = window.luxOutlook, st = window.__lastState; if (!L || !quote) return null;
    try { return L.stock(quote, st ? L.ctxOf(st, ctx && ctx.mk, ctx && ctx.regime) : null, { earnDays: ctx && ctx.earnDays }); } catch (e) { return null; }
  }
  function aiHolds(sym, mk) {
    var st = window.__lastState, p = st && st.positions && st.positions[mk]; if (!Array.isArray(p)) return false;
    return p.some(function (x) { return x.symbol === sym && x.qty > 0; });
  }
  function ol3(o) {
    var ko = ["단기", "중기", "장기"], en = ["short-term", "mid-term", "long-term"], k = ["s", "m", "l"];
    return [ko.map(function (t, i) { return t + " " + o[k[i]].label; }).join(" · "), en.map(function (t, i) { return t + " " + (LBL[o[k[i]].label] || o[k[i]].label); }).join(", ")];
  }

  /* ─────────── 1. 종목 조언 ─────────── */
  function holding(sym, pos, quote, ctx) {
    ctx = ctx || {};
    var mk = ctx.mk || (/\.(KS|KQ)$/.test(sym) ? "kr" : "us"), name = ctx.name || sym, cur = ctx.cur || (quote && quote.price) || pos.avg;
    var r = pos.avg > 0 ? (cur / pos.avg - 1) * 100 : 0, pl = (cur - pos.avg) * pos.q;
    var sv = ctx.sell || null, sl = pos.slPx || (sv && sv.sl) || null, tp = pos.tpPx || (sv && sv.tp) || null;
    var w = ctx.eq > 0 ? (ctx.mv != null ? ctx.mv : cur * pos.q) / ctx.eq * 100 : null;
    var o = outlookFor(sym, quote, ctx), ed = ctx.earnDays, hd = ctx.heldDays, lev = !!ctx.lev;
    var aiH = ctx.aiHeld != null ? ctx.aiHeld : aiHolds(sym, mk);
    var S = [], acts = [], risk = 0, watch = 0;

    // ① 평단 대비 손익
    S.push([name + ": 평단 " + px(mk, pos.avg) + " 대비 " + pc(r) + "(" + money(mk, pl, true) + ")예요.",
            name + " is " + pc(r) + " (" + money(mk, pl, true) + ") versus your average cost of " + px(mk, pos.avg) + "."]);
    // ② 손절·목표까지 거리
    var dist = [], distEn = [];
    if (sl) {
      if (cur <= sl) { dist.push("손절선 " + px(mk, sl) + " 아래(정리 검토 구간)"); distEn.push("below the stop " + px(mk, sl) + " (exit-review zone)"); risk++; }
      else { var ds = (cur / sl - 1) * 100; dist.push("손절선 " + px(mk, sl) + "까지 " + pc(-ds)); distEn.push("stop " + px(mk, sl) + " is " + pc(-ds) + " away"); if (ds <= 3) watch++; }
    }
    if (tp && cur < tp) { dist.push("목표 " + px(mk, tp) + "까지 " + pc((tp / cur - 1) * 100)); distEn.push("target " + px(mk, tp) + " is " + pc((tp / cur - 1) * 100) + " away"); }
    else if (tp && cur >= tp) { dist.push("목표 " + px(mk, tp) + " 도달"); distEn.push("target " + px(mk, tp) + " reached"); }
    if (dist.length) S.push(["지금가 기준 " + dist.join(" · ") + ".", "Right now: " + distEn.join("; ") + "."]);
    // ③ 전망 + 매도 의견
    var s3k = "", s3e = "";
    if (o) {
      var t = ol3(o); s3k = "AI 전망은 " + t[0] + "이에요"; s3e = "AI outlook: " + t[1];
      if (o.m.score <= -1) watch++; if (o.m.score <= -2 && r < 0) risk++;
    }
    if (sv) {
      var why = sv.why && sv.why[0] ? (Array.isArray(sv.why[0]) ? sv.why[0][0] : sv.why[0]) : "";
      s3k += (s3k ? " · " : "") + "매도 의견은 '" + sv.ko + "'" + (sv.v !== "hold" && why ? "(" + why + ")" : ""); s3e += (s3e ? "; " : "Sell view: ") + (s3e ? "sell view " : "") + (SVEN[sv.v] || sv.v);
      if (sv.v === "cut") risk++; else if (sv.v === "watch") watch++;
    }
    if (s3k) S.push([s3k + ".", s3e + "."]);
    // ④ 위험 요소(비중 · 실적 · 레버리지 · AI 보유)
    var fk = [], fe = [];
    if (w != null && w >= 30) { fk.push("계좌의 " + w.toFixed(0) + "%로 한 종목 비중이 커요"); fe.push("it is " + w.toFixed(0) + "% of the account — a heavy single-stock weight"); (w >= 40 ? risk++ : watch++); }
    if (ed != null && ed >= 0 && ed <= 7) { fk.push("실적 발표 " + (ed === 0 ? "오늘" : "D-" + ed) + "라 변동이 커질 수 있어요"); fe.push("earnings " + (ed === 0 ? "are today" : "are in " + ed + " day(s)") + ", so swings may widen"); watch++; }
    if (lev && hd != null && hd >= 10) { fk.push("레버리지·인버스 ETF를 " + hd + "일째 보유 중이라 변동성 손실이 쌓여요"); fe.push("a leveraged/inverse ETF held " + hd + " days — volatility decay builds up"); risk++; }
    else if (lev) { fk.push("레버리지·인버스 상품이라 짧게 보는 게 원칙이에요"); fe.push("a leveraged/inverse product, best held briefly"); watch++; }
    if (aiH) { fk.push("서버 AI 계좌도 이 종목을 들고 있어요"); fe.push("the server AI account holds it too"); }
    if (fk.length) S.push([fk.join(" · ") + ".", fe.join("; ").replace(/^./, function (c) { return c.toUpperCase(); }) + "."]);
    if (S.length > 4) S.length = 4;

    // 체크리스트
    if (sl && !pos.slPx) acts.push(A("손절선 " + px(mk, sl) + " 설정 확인 (아직 직접 설정 안 함)", "Set a stop near " + px(mk, sl) + " (none set yet)"));
    else if (!sl) acts.push(A("손절선을 정해 두세요 (평단 −5~8% 안팎이 흔한 기준)", "Pick a stop level (about −5 to −8% from cost is common)"));
    else if (cur <= sl) acts.push(A("손절선 " + px(mk, sl) + " 아래 — 규칙대로 정리할지 결정", "Below the stop " + px(mk, sl) + " — decide whether to exit by your rule"));
    if (w != null && w >= 30) acts.push(A("비중 " + w.toFixed(0) + "% → 한 종목 쏠림, 20~25% 이하 검토", "Weight " + w.toFixed(0) + "% — single-stock concentration; consider 20–25% or less"));
    if (ed != null && ed >= 0 && ed <= 7) acts.push(A("실적 발표 전 비중·손절선 점검", "Review size and stop before earnings"));
    if (lev && hd != null && hd >= 10) acts.push(A("레버리지 " + hd + "일 보유 — 보유 기간 점검", "Leveraged holding for " + hd + " days — review the holding period"));
    if (o && o.m.score <= -1 && quote && quote.ma50 > 0) acts.push(A("50일선 " + px(mk, quote.ma50) + " 회복 여부 확인", "Watch whether it reclaims the 50-day line " + px(mk, quote.ma50)));
    if (tp && cur >= tp) acts.push(A("목표 도달 — 일부 차익 실현 여부 검토", "Target reached — consider taking partial profit"));
    if (!acts.length) acts.push(A("특별한 경고 없음 — 손절선·목표가만 주기적으로 확인", "No warnings — just recheck the stop and target periodically"));
    acts = acts.slice(0, 4);

    var tone = risk ? "risk" : watch ? "watch" : "ok", T = join(S);
    // 한 줄 요약(접힌 상태 미리보기)
    var sk = [pc(r)], se = [pc(r)];
    if (o) { sk.push("중기 " + o.m.label); se.push("mid-term " + (LBL[o.m.label] || o.m.label)); }
    if (w != null) { sk.push("비중 " + w.toFixed(0) + "%"); se.push("weight " + w.toFixed(0) + "%"); }
    if (sv && sv.v !== "hold") { sk.push(sv.ko); se.push(SVEN[sv.v]); }
    return { ko: T.ko, en: T.en, tone: tone, actions: acts, short: { ko: sk.join(" · "), en: se.join(" · ") }, note: A("투자 권유 아님 · 가격·추세 규칙 기반 참고", "Not investment advice · rule-based on price and trend") };
  }

  /* ─────────── 계좌 공통 계산 ─────────── */
  function analyse(mk, av, hs, ctx) {
    ctx = ctx || {};
    var rg = regimeOf(ctx), band = rg ? BAND[rg] : null, eq = av.eq, cashP = eq > 0 ? av.cash / eq * 100 : 0;
    var rows = hs.map(function (h) { return { h: h, w: eq > 0 ? h.mv / eq * 100 : 0 }; }).sort(function (a, b) { return b.w - a.w; });
    var top = rows[0] || null, secs = {};
    rows.forEach(function (x) { var s = sectorOfSym(x.h.s, x.h.name); if (!s) return; var k = s[0]; secs[k] = secs[k] || { ko: s[0], en: s[1], w: 0, n: 0 }; secs[k].w += x.w; secs[k].n++; });
    var sec = null; Object.keys(secs).forEach(function (k) { if (!sec || secs[k].w > sec.w) sec = secs[k]; });
    var midW = 0, midN = 0, midNames = [], nearStop = [], belowStop = [], noStop = 0, earn = [], levW = 0;
    rows.forEach(function (x) {
      var h = x.h, o = h.ol;
      if (o && o.m.score <= -1) { midW += x.w; midN++; midNames.push(h.name); }
      if (h.sv && h.sv.sl) { if (h.cur <= h.sv.sl) belowStop.push(h.name); else if (h.cur <= h.sv.sl * 1.03) nearStop.push(h.name); }
      if (!h.p.slPx) noStop++;
      if (h.earn != null && h.earn >= 0 && h.earn <= 7) earn.push(h.name + " D-" + h.earn);
      if (h.lev) levW += x.w;
    });
    return { rg: rg, band: band, cashP: cashP, rows: rows, top: top, sec: sec, midW: midW, midN: midN, midNames: midNames, nearStop: nearStop, belowStop: belowStop, noStop: noStop, earn: earn, levW: levW, eq: eq };
  }

  /* ─────────── 2. 계좌 조언 ─────────── */
  function account(mk, av, hs, ctx) {
    ctx = ctx || {};
    if (!av || !(av.eq > 0)) return { ko: "계좌 정보를 불러오는 중이에요.", en: "Loading account data.", tone: "ok", actions: [] };
    if (!hs.length) {
      var e0 = av.cash / av.eq * 100;
      return { ko: "아직 보유 종목이 없고 현금이 " + e0.toFixed(0) + "%예요. 홈의 AI 후보나 관심 종목에서 소액부터 나눠 사 보는 게 좋은 시작이에요. 모의투자라 손실 걱정 없이 연습할 수 있어요.", en: "No holdings yet and cash is " + e0.toFixed(0) + "%. Starting small from the AI candidates or your watchlist and splitting purchases is a good way to begin — it is paper trading, so practice freely.", tone: "ok", actions: [A("AI 후보 1~2종목을 소액으로 매수해 보기", "Try 1–2 AI candidates with a small amount")], note: A("투자 권유 아님", "Not investment advice") };
    }
    var a = analyse(mk, av, hs, ctx), S = [], C = [], cands = [], risk = 0, watch = 0;
    // 현금 비중
    var cs = "현금 비중은 " + a.cashP.toFixed(0) + "%", ce = "Cash is " + a.cashP.toFixed(0) + "% of the account";
    if (a.band) {
      var rk = RG[a.rg][0], re = RG[a.rg][1];
      if (a.cashP < a.band[0]) { cs += "로 지금 " + rk + " 참고 범위(" + a.band[0] + "~" + a.band[1] + "%)보다 낮아 여유가 적어요"; ce += ", below the " + a.band[0] + "–" + a.band[1] + "% reference range for " + re + " — little cushion"; watch++; cands.push([3, A("현금 " + a.cashP.toFixed(0) + "% → " + rk + " 참고 범위 " + a.band[0] + "~" + a.band[1] + "%, 새 매수 전 현금 확보 검토", "Cash " + a.cashP.toFixed(0) + "% vs " + a.band[0] + "–" + a.band[1] + "% reference for " + re + " — consider raising cash before buying")]); }
      else if (a.cashP > a.band[1]) { cs += "로 " + rk + " 참고 범위(" + a.band[0] + "~" + a.band[1] + "%)보다 높아요 — 신중한 편이에요"; ce += ", above the " + a.band[0] + "–" + a.band[1] + "% reference for " + re + " — on the cautious side"; cands.push([6, A("현금 " + a.cashP.toFixed(0) + "%가 많은 편 — 분할 매수 계획을 세워 보기", "Cash " + a.cashP.toFixed(0) + "% is high — plan staged entries")]); }
      else { cs += "로 " + rk + " 참고 범위(" + a.band[0] + "~" + a.band[1] + "%) 안이에요"; ce += ", inside the " + a.band[0] + "–" + a.band[1] + "% reference for " + re; }
    }
    S.push([cs + ".", ce + "."]);
    // 쏠림
    var t = a.top, ck = "", cen = "";
    if (t) {
      ck = "가장 큰 종목은 " + t.h.name + " " + t.w.toFixed(0) + "%"; cen = "Largest holding: " + t.h.name + " " + t.w.toFixed(0) + "%";
      if (t.w >= 40) { ck += "로 한 종목에 크게 쏠렸어요"; cen += " — heavily concentrated"; risk++; cands.push([1, A("비중 " + t.w.toFixed(0) + "% " + t.h.name + " → 20~25% 이하로 나누는 것 검토", t.h.name + " at " + t.w.toFixed(0) + "% — consider trimming toward 20–25% or less")]); }
      else if (t.w >= 30) { ck += "로 다소 큰 편이에요"; cen += " — on the large side"; watch++; cands.push([4, A(t.h.name + " 비중 " + t.w.toFixed(0) + "% — 25% 이하 검토", t.h.name + " at " + t.w.toFixed(0) + "% — consider 25% or less")]); }
      else { ck += "예요"; }
    }
    if (a.sec && a.rows.length > 1 && a.sec.w >= 50) { if (ck) { S.push([ck + ".", cen + "."]); } ck = "업종은 " + a.sec.ko + " " + a.sec.w.toFixed(0) + "%로 가장 커요"; cen = "By sector, " + a.sec.en + " is the largest at " + a.sec.w.toFixed(0) + "%"; if (a.sec.n > 1) { watch++; cands.push([a.sec.w >= 70 ? 2 : 4, A(a.sec.ko + " 업종 " + a.sec.w.toFixed(0) + "% — 같은 이유로 같이 흔들릴 수 있어 다른 업종 분산 검토", a.sec.en + " is " + a.sec.w.toFixed(0) + "% — they may fall together; consider other sectors")]); } }
    if (ck) S.push([ck + ".", cen + "."]);
    // 중기 주의
    if (a.midN > 0) {
      S.push(["보유 " + hs.length + "종목 중 " + a.midN + "종목이 중기 '주의'(내 돈의 " + a.midW.toFixed(0) + "%)예요.", a.midN + " of " + hs.length + " holdings are mid-term cautious (" + a.midW.toFixed(0) + "% of the account)."]);
      if (a.midW >= 40) risk++; else watch++;
      cands.push([a.midW >= 40 ? 2 : 5, A("중기 주의 종목(" + a.midNames.slice(0, 3).join(", ") + ") 손절선·비중 점검", "Review stops and size for mid-term cautious holdings (" + a.midNames.slice(0, 3).join(", ") + ")")]);
    } else S.push(["보유 종목 모두 중기 추세에는 큰 경고가 없어요.", "None of your holdings shows a mid-term trend warning."]);
    // 오늘 손익 vs 시장
    if (av.n !== 0 && typeof av.dayPct === "number") {
      var md = ctx.mktDay, dk = "오늘 계좌 " + pc(av.dayPct), de = "Today the account is " + pc(av.dayPct);
      if (typeof md === "number") {
        var gap = av.dayPct - md;
        dk += "(" + (mk === "kr" ? "코스피" : "S&P 500") + " " + pc(md) + ") — " + (Math.abs(gap) < 0.5 ? "시장과 비슷하게 움직였어요" : gap > 0 ? "시장보다 " + Math.abs(gap).toFixed(1) + "%p 나았어요" : "시장보다 " + Math.abs(gap).toFixed(1) + "%p 부진했어요");
        de += " (" + (mk === "kr" ? "KOSPI" : "S&P 500") + " " + pc(md) + ") — " + (Math.abs(gap) < 0.5 ? "in line with the market" : gap > 0 ? "ahead of the market by " + Math.abs(gap).toFixed(1) + " pts" : "behind the market by " + Math.abs(gap).toFixed(1) + " pts");
      }
      S.push([dk + ".", de + "."]);
    }
    // 위험 신호 → 조치 후보
    if (a.belowStop.length) { risk++; cands.push([0, A("손절선 아래: " + a.belowStop.slice(0, 3).join(", ") + " — 정리 여부 결정", "Below stop: " + a.belowStop.slice(0, 3).join(", ") + " — decide whether to exit")]); }
    if (a.nearStop.length) { watch++; cands.push([1, A("손절선 3% 안: " + a.nearStop.slice(0, 3).join(", ") + " — 주문·알림 확인", "Within 3% of stop: " + a.nearStop.slice(0, 3).join(", ") + " — check orders/alerts")]); }
    if (a.earn.length) { watch++; cands.push([3, A("실적 임박: " + a.earn.slice(0, 3).join(", ") + " — 발표 전 비중 점검", "Earnings soon: " + a.earn.slice(0, 3).join(", ") + " — review size before the report")]); }
    if (a.levW >= 30) { risk++; cands.push([2, A("레버리지·인버스 " + a.levW.toFixed(0) + "% — 변동성 큼, 비중 축소 검토", "Leveraged/inverse " + a.levW.toFixed(0) + "% — very volatile; consider reducing")]); }
    else if (a.levW > 0) cands.push([6, A("레버리지·인버스 " + a.levW.toFixed(0) + "% — 오래 들지 않기", "Leveraged/inverse " + a.levW.toFixed(0) + "% — avoid holding long")]);
    if (a.noStop > 0) cands.push([5, A("손절선 미설정 " + a.noStop + "종목 — TP/SL 설정", a.noStop + " holding(s) without a stop — set TP/SL")]);
    cands.push([8, A("주 1회 손절선·목표가·비중 점검 습관 만들기", "Make a weekly habit of reviewing stops, targets and weights")]);
    cands.push([9, A("한 번에 사지 말고 2~3번 나눠 매수", "Split buys into 2–3 steps instead of all at once")]);
    cands.sort(function (x, y) { return x[0] - y[0]; });
    var seen = {}; cands.forEach(function (c) { if (C.length < 3 && !seen[c[1].ko]) { seen[c[1].ko] = 1; C.push(c[1]); } });
    var T = join(S);
    return { ko: T.ko, en: T.en, tone: risk ? "risk" : watch ? "watch" : "ok", actions: C, note: A("투자 권유 아님 · 내 계좌 숫자로 계산한 참고 의견", "Not investment advice · computed from your own account numbers") };
  }

  /* ─────────── 3. AI 코치(정해진 질문 → 내 데이터로 답) ─────────── */
  var INTENTS = [
    { id: "why", ko: "왜 떨어졌어?", en: "Why is it down?" },
    { id: "sell", ko: "지금 팔까?", en: "Should I sell now?" },
    { id: "buy", ko: "어디에 더 살까?", en: "Where to buy more?" },
    { id: "cash", ko: "현금 얼마나 둘까?", en: "How much cash to keep?" }
  ];
  function coach(intent, mk, av, hs, ctx) {
    ctx = ctx || {};
    if (!av || !(av.eq > 0) || !hs.length) {
      if (intent === "cash" && av && av.eq > 0) { var rg0 = regimeOf(ctx), b0 = rg0 ? BAND[rg0] : null; return { ko: b0 ? "지금은 " + RG[rg0][0] + "이라 참고 범위는 현금 " + b0[0] + "~" + b0[1] + "%예요. 지금은 현금 100%라 사는 시점을 나눠 보세요." : "아직 보유 종목이 없어 현금 100%예요. 소액부터 나눠 사 보세요.", en: b0 ? "It is " + RG[rg0][1] + ", so the reference range is " + b0[0] + "–" + b0[1] + "% cash. You are at 100% cash — consider staging entries." : "No holdings yet (100% cash). Start small and split purchases.", tone: "ok", actions: [] }; }
      return { ko: "보유 종목이 있어야 내 데이터로 답할 수 있어요. 먼저 소액으로 종목을 담아 보세요.", en: "I need holdings to answer from your data. Add a small position first.", tone: "ok", actions: [] };
    }
    var a = analyse(mk, av, hs, ctx), S = [], acts = [], tone = "ok", rg = a.rg;
    if (intent === "why") {
      var mv = hs.slice().sort(function (x, y) { return (x.dayAmt || 0) - (y.dayAmt || 0); }), down = mv.filter(function (h) { return (h.dayAmt || 0) < 0; }).slice(0, 2);
      var md = ctx.mktDay, mname = mk === "kr" ? ["코스피", "KOSPI"] : ["S&P 500", "S&P 500"];
      S.push(["오늘 내 계좌는 " + pc(av.dayPct) + "(" + money(mk, av.day, true) + ")" + (typeof md === "number" ? "이고 " + mname[0] + "는 " + pc(md) + "예요." : "예요."),
              "Today your account is " + pc(av.dayPct) + " (" + money(mk, av.day, true) + ")" + (typeof md === "number" ? " while " + mname[1] + " is " + pc(md) + "." : ".")]);
      if (!down.length) S.push(["오늘 손실을 낸 보유 종목은 없어요.", "None of your holdings lost money today."]);
      else {
        down.forEach(function (h) {
          var f = [], fe = [], x = h.q || {}, tot = Math.abs(av.day) > 0 ? Math.abs(h.dayAmt / av.day * 100) : 0;
          if (typeof x.return5 === "number" && x.return5 <= -5) { f.push("최근 5일 " + pc(x.return5)); fe.push("5-day " + pc(x.return5)); }
          if (x.ma50 > 0 && h.cur < x.ma50) { f.push("50일선 아래"); fe.push("below the 50-day line"); }
          if (x.vol > 0 && x.avgVol20 > 0 && x.vol >= 2 * x.avgVol20) { f.push("거래량 " + (x.vol / x.avgVol20).toFixed(1) + "배"); fe.push("volume " + (x.vol / x.avgVol20).toFixed(1) + "x"); }
          if (h.earn != null && h.earn <= 7) { f.push("실적 D-" + h.earn); fe.push("earnings in " + h.earn + "d"); }
          S.push([h.name + " " + pc(h.d) + "(" + money(mk, h.dayAmt, true) + ")" + (av.day < 0 && tot >= 30 ? "로 하락의 " + tot.toFixed(0) + "%를 차지했어요" : "") + (f.length ? " — " + f.join(" · ") : "") + ".",
                  h.name + " " + pc(h.d) + " (" + money(mk, h.dayAmt, true) + ")" + (av.day < 0 && tot >= 30 ? ", about " + tot.toFixed(0) + "% of the drop" : "") + (fe.length ? " — " + fe.join(", ") : "") + "."]);
        });
        if (typeof md === "number" && md <= -1 && av.dayPct <= md * 0.8 + 0.01) S.push(["지수도 " + pc(md) + " 내려 시장 전체 약세의 영향이 커요.", "The index also fell " + pc(md) + ", so broad market weakness played a big part."]);
        else if (typeof md === "number" && md > -0.5 && av.dayPct < -1) S.push(["시장은 크게 안 빠졌는데 내 계좌만 내려 보유 종목 고유 요인이 커요.", "The market held up while your account fell, so stock-specific factors dominate."]);
        tone = av.dayPct <= -2 ? "watch" : "ok";
      }
      S.push(["하루 등락은 원인을 확정하기 어려워요 — 숫자는 단서일 뿐이에요.", "A one-day move rarely has a certain cause — these numbers are only clues."]);
    } else if (intent === "sell") {
      var flag = a.rows.filter(function (x) { var h = x.h; return (h.sv && h.sv.v !== "hold") || (h.ol && h.ol.m.score <= -1) || (h.lev && h.hd != null && h.hd >= 10); });
      if (!flag.length) { S.push(["지금 보유 종목 중 매도 신호가 뜬 것은 없어요. 손절선·목표를 지키며 보유하는 구간이에요.", "None of your holdings shows a sell signal right now. Keep following your stops and targets."]); }
      else {
        S.push(["점검할 종목이 " + flag.length + "개 있어요.", flag.length + " holding(s) deserve a check."]);
        flag.slice(0, 3).forEach(function (x) {
          var h = x.h, f = [], fe = [];
          if (h.sv && h.sv.v === "cut") { f.push("손절선 도달"); fe.push("stop reached"); tone = "risk"; } else if (h.sv && h.sv.v === "watch") { f.push("매도 의견 주의"); fe.push("sell view: watch"); if (tone === "ok") tone = "watch"; }
          if (h.ol && h.ol.m.score <= -1) { f.push("중기 " + h.ol.m.label); fe.push("mid-term " + (LBL[h.ol.m.label] || h.ol.m.label)); if (tone === "ok") tone = "watch"; }
          if (h.lev && h.hd >= 10) { f.push("레버리지 " + h.hd + "일 보유"); fe.push("leveraged, held " + h.hd + "d"); }
          S.push([h.name + "(비중 " + x.w.toFixed(0) + "%, 손익 " + pc(h.r) + "): " + f.join(" · ") + ".", h.name + " (weight " + x.w.toFixed(0) + "%, P&L " + pc(h.r) + "): " + fe.join(", ") + "."]);
          acts.push(A(h.name + " — 손절선·일부 정리 여부 점검", h.name + " — review the stop or a partial trim"));
        });
      }
      S.push(["팔지 말지는 투자 기간·손익·세금 등 본인 사정에 달려 있어요.", "Whether to sell depends on your horizon, P&L and personal situation."]);
    } else if (intent === "buy") {
      var pool = a.rows.filter(function (x) { var h = x.h; return h.ol && !h.lev && x.w < 20 && !(h.sv && h.sv.v === "cut") && (h.ol.m.score + h.ol.s.score) >= 1; }).sort(function (p, q2) { return (q2.h.ol.m.score + q2.h.ol.s.score + q2.h.ol.l.score) - (p.h.ol.m.score + p.h.ol.s.score + p.h.ol.l.score); });
      if (rg === "BEAR" || rg === "CRASH") S.push(["지금은 " + RG[rg][0] + "이라 새로 늘리기보다 현금을 지키는 쪽이 유리한 구간이에요.", "It is " + RG[rg][1] + ", so protecting cash is usually better than adding."]);
      if (a.cashP < 10) S.push(["현금이 " + a.cashP.toFixed(0) + "%뿐이라 추가 매수 여력이 적어요.", "Cash is only " + a.cashP.toFixed(0) + "%, leaving little room to add."]);
      if (pool.length) {
        S.push(["이미 가진 종목 중 비중이 20% 미만이고 단기·중기 전망이 좋은 순서예요.", "Among your holdings under 20% weight with the best short/mid-term outlook:"]);
        pool.slice(0, 2).forEach(function (x) { var t3 = ol3(x.h.ol); S.push([x.h.name + " — 비중 " + x.w.toFixed(0) + "%, " + t3[0] + ".", x.h.name + " — weight " + x.w.toFixed(0) + "%, " + t3[1] + "."]); acts.push(A(x.h.name + " 한 번에 말고 2~3번 나눠 매수", "Buy " + x.h.name + " in 2–3 steps")); });
      } else S.push(["지금 가진 종목 중 비중 여유와 전망이 모두 좋은 곳은 없어요.", "None of your holdings combines room to add with a good outlook right now."]);
      var held = {}; hs.forEach(function (h) { held[h.s] = 1; });
      if (a.sec && a.sec.w >= 50) S.push(["대신 " + a.sec.ko + " 쏠림(" + a.sec.w.toFixed(0) + "%)이 있어서 다른 업종을 보는 게 분산에 도움이 돼요.", "Because " + a.sec.en + " is already " + a.sec.w.toFixed(0) + "%, adding a different sector would diversify better."]);
      acts.push(A("홈의 'AI 매수 추천 순위'에서 새 후보와 비교", "Compare with new candidates in 'AI buy ranking' on Home"));
      tone = "ok";
    } else if (intent === "cash") {
      if (a.band) {
        var lo = a.band[0], hi = a.band[1];
        S.push(["지금은 " + RG[rg][0] + "이라 현금 참고 범위는 " + lo + "~" + hi + "%예요. 내 현금은 " + a.cashP.toFixed(0) + "%(" + money(mk, av.cash) + ")예요.", "It is " + RG[rg][1] + ", so the reference cash range is " + lo + "–" + hi + "%. Yours is " + a.cashP.toFixed(0) + "% (" + money(mk, av.cash) + ")."]);
        if (a.cashP < lo) { var need = av.eq * lo / 100 - av.cash; S.push(["범위 하한까지 약 " + money(mk, need) + "을 현금으로 늘릴 수 있어요.", "Reaching the lower bound would mean raising about " + money(mk, need) + " in cash."]); tone = "watch"; acts.push(A("약한 종목부터 일부 정리해 현금 " + lo + "% 확보 검토", "Consider trimming weaker holdings to reach " + lo + "% cash")); }
        else if (a.cashP > hi) { var ex = av.cash - av.eq * hi / 100; S.push(["범위 상단보다 약 " + money(mk, ex) + " 많아요 — 나눠서 투자할 여력이 있어요.", "That is about " + money(mk, ex) + " above the upper bound — room to invest in stages."]); acts.push(A("2~3번에 나눠 매수 계획 세우기", "Plan staged purchases over 2–3 steps")); }
        else S.push(["범위 안이라 지금 비중을 크게 바꿀 필요는 없어요.", "You are inside the range, so no big change is needed."]);
      } else S.push(["시장 국면 정보를 아직 못 받았어요. 일반적으로는 현금 20~40%를 두는 경우가 많아요.", "Market regime data has not loaded. A common rule of thumb is keeping 20–40% in cash."]);
      S.push(["성향(공격/안정)에 따라 달라지는 참고 범위예요.", "The right level also depends on your risk style."]);
    } else return { ko: "", en: "", tone: "ok", actions: [] };
    var T = join(S);
    return { ko: T.ko, en: T.en, tone: tone, actions: acts.slice(0, 3), note: A("투자 권유 아님 · 내 데이터로 만든 템플릿 답변", "Not investment advice · template answer from your own data") };
  }

  /* ─────────── 스타일(MY 의 --m-* 변수에 맞춤) ─────────── */
  function css() {
    if (document.getElementById("advCss")) return;
    var st = document.createElement("style"); st.id = "advCss";
    st.textContent = [
      "#mineRoot .coach{border:1px solid rgba(61,214,181,.28)}#mineRoot .coach .adv-p{font-size:13.5px;line-height:1.6;margin:4px 0 8px;overflow-wrap:anywhere}",
      "#mineRoot .adv-t{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:#3DD6B5;vertical-align:1px;flex:0 0 8px}#mineRoot .adv-t.watch{background:#E2C766}#mineRoot .adv-t.risk{background:#F04452}",
      "#mineRoot .adv-a{margin:0 0 8px;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}#mineRoot .adv-a li{font-size:12.5px;line-height:1.45;padding-left:20px;position:relative;color:var(--fg,#EEF1F5)}#mineRoot .adv-a li:before{content:'';position:absolute;left:2px;top:3px;width:11px;height:11px;border:1.5px solid var(--m-mute);border-radius:3px}",
      "#mineRoot .adv-c{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px}#mineRoot .adv-c button{min-height:40px;padding:0 13px;border-radius:20px;border:1px solid #2E3542;background:transparent;color:#C7CDD6;font-size:13px;cursor:pointer;font-family:inherit}#mineRoot .adv-c button.on{background:var(--m-acc);border-color:var(--m-acc);color:#04110D;font-weight:700}",
      "#mineRoot .adv-q{margin:6px 0 4px;padding:10px 12px;border-radius:12px;background:rgba(127,140,160,.08);font-size:13px;line-height:1.55}#mineRoot .adv-q b{display:block;font-size:12px;color:var(--m-mute);margin-bottom:3px}",
      "#mineRoot .adv-h{margin:8px 0 2px;font-size:12.5px;border-left:3px solid #3DD6B5;border-radius:8px;background:rgba(127,140,160,.07)}#mineRoot .adv-h.watch{border-left-color:#E2C766}#mineRoot .adv-h.risk{border-left-color:#F04452}",
      "#mineRoot .adv-h summary{display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;list-style:none;min-height:36px}#mineRoot .adv-h summary::-webkit-details-marker{display:none}#mineRoot .adv-h summary>b{font-size:12px;color:var(--m-mute);flex:0 0 auto}#mineRoot .adv-h summary>span.adv-s{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#mineRoot .adv-h summary:after{content:'▾';color:var(--m-acc);flex:0 0 auto}#mineRoot .adv-h[open] summary:after{content:'▴'}",
      "#mineRoot .adv-h .adv-b{padding:0 10px 10px}#mineRoot .adv-h .adv-p{font-size:12.5px;line-height:1.6;margin:0 0 6px;overflow-wrap:anywhere}",
      "#mineRoot .adv-n{font-size:11px;color:#8A93A3;margin-top:4px}",
      "html[data-theme=light] #mineRoot .adv-c button{border-color:#D0D5DD;color:#344054}html[data-theme=light] #mineRoot .adv-c button.on{color:#04110D}html[data-theme=light] #mineRoot .adv-a li{color:#101828}html[data-theme=light] #mineRoot .coach{border-color:rgba(14,140,118,.35)}html[data-theme=light] #mineRoot .adv-n{color:#667085}"
    ].join("");
    document.head.appendChild(st);
  }

  window.luxAdvisor = { holding: holding, account: account, coach: coach, INTENTS: INTENTS, span: span, css: css, sectorOf: sectorOfSym, esc: esc };
})();
