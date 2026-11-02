/* [V33.731] ★종목 상세 정보 탭★ — 사용자 11/2 "종목 상세에 밸류에이션 · KPI · 재무제표 · IR 자료 · 실적 및 전망 · 내부자 거래 다 볼 수 있게"
   · 탭 7개(개요 · 밸류에이션 · KPI · 재무제표 · 실적·전망 · IR 자료 · 내부자 거래) — 누른 탭만 그린다(필요한 자료만 받는다).
   · 자료: /api/fundamentals(연간 재무 4년 · 상세 화면이 이미 받은 것 재사용) · /api/stock-profile(기업 사실·52주·베타)
           /api/ir(미국: SEC EDGAR 공시·Form 4 · 한국: DART·네이버 링크 · 서버 6시간 캐시) · /api/insider · /api/earnings(전체 일정에서 이 종목만).
   · 밸류에이션 배수는 '지금 시총 ÷ 최근 회계연도 값' 으로 계산한다(분기 TTM 아님 — 화면에 그렇게 적는다). 없는 값은 지어내지 않고 — 로 둔다.
   · 다크·라이트 테마 둘 다: 색은 글자색(currentColor)과 반투명 회색으로만 — 상승 빨강 · 하락 파랑(한국 관례). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var TABS = [["ov", "개요"], ["val", "밸류에이션"], ["kpi", "KPI"], ["fs", "재무제표"], ["er", "실적 · 전망"], ["ir", "IR 자료"], ["ins", "내부자 거래"]];
  var sym = null, tab = "val", fsTab = "is", C = {};   // C[sym] = { fund, prof, ir }
  var INS = null, insTs = 0, EARN = null, earnTs = 0;
  var isKr = function (s) { return /\.(KS|KQ)$/.test(s || ""); };
  function q() { var a = window.__lastQuotesArr || []; for (var i = 0; i < a.length; i++) if (a[i].symbol === sym) return a[i]; return null; }
  function money(v, kr) {
    if (v == null || !isFinite(v)) return "—"; var a = Math.abs(v), sg = v < 0 ? "−" : "";
    if (kr) return sg + (a >= 1e12 ? (a / 1e12).toFixed(2) + "조" : a >= 1e8 ? Math.round(a / 1e8).toLocaleString() + "억" : Math.round(a).toLocaleString()) + "원";
    return sg + "$" + (a >= 1e12 ? (a / 1e12).toFixed(2) + "T" : a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : a.toFixed(2));
  }
  var pct = function (v, d) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d == null ? 1 : d) + "%"; };
  var pl = function (v) { return v == null || !isFinite(v) ? "—" : Math.abs(v).toFixed(1) + "%"; };
  var mult = function (v) { return v == null || !isFinite(v) || v <= 0 ? "—" : v >= 1000 ? "1000×+" : v.toFixed(1) + "×"; };
  var cls = function (v) { return v == null ? "" : v > 0 ? "up" : v < 0 ? "dn" : ""; };
  function css() {
    if ($("lxiCss")) return; var st = document.createElement("style"); st.id = "lxiCss";
    st.textContent = [
      "#luxInfo{margin:0 0 14px;font-variant-numeric:tabular-nums}#luxInfo .lxt{display:flex;gap:2px;overflow-x:auto;border-bottom:1px solid rgba(127,137,155,.25);margin-bottom:14px;scrollbar-width:none}",
      "#luxInfo .lxt button{flex:0 0 auto;padding:12px 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:inherit;opacity:.62;font:inherit;font-size:14.5px;cursor:pointer;white-space:nowrap}#luxInfo .lxt button.on{opacity:1;font-weight:700;border-bottom-color:currentColor}",
      "#luxInfo .g4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}#luxInfo .g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}@media (max-width:760px){#luxInfo .g4,#luxInfo .g3{grid-template-columns:repeat(2,minmax(0,1fr))}}",
      "#luxInfo .cd{border:1px solid rgba(127,137,155,.22);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;min-width:0}#luxInfo .cd .k{font-size:12.5px;opacity:.7}#luxInfo .cd .v{font-size:22px;font-weight:700;letter-spacing:-.3px}#luxInfo .cd .s{font-size:12px;opacity:.65;line-height:1.45}",
      "#luxInfo .bar{position:relative;height:6px;border-radius:3px;background:rgba(127,137,155,.2)}#luxInfo .bar i{position:absolute;top:-3px;width:2px;height:12px;background:currentColor}#luxInfo .bar b{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:rgba(61,214,181,.55)}",
      "#luxInfo .up{color:#E5484D}#luxInfo .dn{color:#3B82F6}#luxInfo h4{margin:18px 0 8px;font-size:15px}#luxInfo .nt{font-size:12px;opacity:.62;line-height:1.55;margin:10px 0 0}",
      "#luxInfo .tw{overflow-x:auto;border:1px solid rgba(127,137,155,.22);border-radius:14px}#luxInfo table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:520px}#luxInfo th,#luxInfo td{padding:10px 12px;text-align:right;border-bottom:1px solid rgba(127,137,155,.14);white-space:nowrap}#luxInfo th{font-weight:500;opacity:.7;font-size:12.5px}#luxInfo td:first-child,#luxInfo th:first-child{text-align:left;position:sticky;left:0;background:inherit}#luxInfo tr.em td{font-weight:700}#luxInfo tr:last-child td{border-bottom:0}",
      "#luxInfo .seg{display:inline-flex;gap:3px;padding:3px;border-radius:10px;background:rgba(127,137,155,.14);margin-bottom:10px}#luxInfo .seg button{border:0;border-radius:8px;padding:7px 12px;background:transparent;color:inherit;opacity:.7;font:inherit;font-size:13px;cursor:pointer}#luxInfo .seg button.on{opacity:1;font-weight:700;background:rgba(127,137,155,.22)}",
      "#luxInfo .li{display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid rgba(127,137,155,.14);color:inherit;text-decoration:none}#luxInfo .li:last-child{border-bottom:0}#luxInfo .li .tg{flex:0 0 auto;min-width:46px;text-align:center;padding:5px 6px;border-radius:8px;background:rgba(127,137,155,.16);font-size:11.5px;font-weight:700}#luxInfo .li .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}#luxInfo .li .d{font-size:12.5px;opacity:.65;white-space:nowrap}",
      "#luxInfo .bars{display:flex;align-items:flex-end;gap:10px;height:120px;padding:6px 4px 0}#luxInfo .bars div{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end;font-size:11.5px}#luxInfo .bars span.b{width:70%;max-width:46px;border-radius:6px 6px 0 0;background:rgba(127,137,155,.45)}#luxInfo .bars div:last-child span.b{background:currentColor;opacity:.85}",
      "#luxInfo .emp{padding:18px 4px;opacity:.65;font-size:13.5px}"
    ].join("");
    document.head.appendChild(st);
  }
  function getJ(u) { return fetch(u).then(function (r) { return r.json(); }); }
  function need(k) {
    var c = C[sym] || (C[sym] = {}), s0 = sym;
    if (c[k] !== undefined) return;
    c[k] = null;
    var mcap = (q() && (q().mcap || (q().price && q().shares ? q().price * q().shares : 0))) || 0;
    var u = k === "fund" ? "/api/fundamentals?symbol=" + encodeURIComponent(sym) + (mcap ? "&mcap=" + Math.round(mcap) : "") : k === "prof" ? "/api/stock-profile?symbol=" + encodeURIComponent(sym) : "/api/ir?symbol=" + encodeURIComponent(sym);
    if (k === "fund" && window.__fundCache && window.__fundCache[sym]) { c.fund = window.__fundCache[sym]; return; }
    getJ(u).then(function (j) { (C[s0] || (C[s0] = {}))[k] = j || {}; if (s0 === sym) draw(); }).catch(function () { (C[s0] || (C[s0] = {}))[k] = { err: true }; if (s0 === sym) draw(); });
  }
  function yrs(f) { return (f && f.order || []).slice(-4); }
  function Y(f, y, k) { var o = f && f.years && f.years[y]; var v = o ? o[k] : null; return typeof v === "number" && isFinite(v) ? v : null; }
  function last(f, k) { var o = yrs(f); for (var i = o.length - 1; i >= 0; i--) { var v = Y(f, o[i], k); if (v != null) return v; } return null; }
  function prev(f, k) { var o = yrs(f); return o.length > 1 ? Y(f, o[o.length - 2], k) : null; }
  function mcapOf(f) { var x = q(), sh = last(f, "BasicAverageShares"); if (x && x.mcap > 0) return x.mcap; if (x && x.price > 0 && (x.shares > 0 || sh)) return x.price * (x.shares || sh); return null; }
  var div = function (a, b) { return a != null && b != null && b !== 0 ? a / b : null; };
  var loading = '<div class="emp">불러오는 중…</div>';

  function vOv() {
    need("prof"); var p = C[sym].prof; if (!p) return loading; if (p.err || !p.ok) return '<div class="emp">기업 자료가 아직 없습니다.</div>';
    var st = p.stats || {}, fx = p.facts || [];
    var h = '<div class="g4">' +
      card("52주 범위 위치", st.pos52 != null ? Math.round(st.pos52) + "%" : "—", "고점 " + (st.hi52 || "—") + " · 저점 " + (st.lo52 || "—"), st.pos52) +
      card("고점 대비", pct(st.fromHi52), "저점 대비 " + pct(st.fromLo52)) +
      card("베타", st.beta != null ? st.beta.toFixed(2) : "—", (isKr(sym) ? "코스피200" : "S&P 500") + " 대비 · 1년") +
      card("1년 최대 낙폭", pct(st.mdd1y), "연초 이후 " + pct(st.ytd)) + "</div>";
    if (fx.length) h += "<h4>기업 정보</h4>" + '<div class="tw"><table><tbody>' + fx.map(function (r) { return "<tr><td>" + esc(r.l) + "</td><td>" + esc(r.v) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    if (p.about) h += '<p class="nt" style="font-size:13.5px;opacity:.85">' + esc(String(p.about).slice(0, 900)) + "</p>";
    return h + '<p class="nt">출처: ' + esc(p.src || "") + "</p>";
  }
  function card(k, v, s, bar) { return '<div class="cd"><span class="k">' + k + '</span><span class="v">' + v + "</span>" + (bar != null && isFinite(bar) ? '<div class="bar"><i style="left:' + Math.max(0, Math.min(100, bar)).toFixed(0) + '%"></i></div>' : "") + (s ? '<span class="s">' + s + "</span>" : "") + "</div>"; }
  function vVal() {
    need("fund"); need("prof"); var f = C[sym].fund; if (!f) return loading; if (f.err || !yrs(f).length) return '<div class="emp">재무 자료가 아직 없어 배수를 계산할 수 없습니다.</div>';
    var kr = isKr(sym), m = mcapOf(f), ni = last(f, "NetIncome"), eq = last(f, "StockholdersEquity"), rev = last(f, "TotalRevenue"), oi = last(f, "OperatingIncome"), da = last(f, "ReconciledDepreciation");
    var debt = last(f, "TotalDebt"), cash = last(f, "CashAndCashEquivalents"), fcf = last(f, "FreeCashFlow");
    var ev = m != null ? m + (debt || 0) - (cash || 0) : null, ebitda = oi != null ? oi + (da || 0) : null;
    var per = ni > 0 ? div(m, ni) : null, pbr = eq > 0 ? div(m, eq) : null, psr = div(m, rev), eve = ebitda > 0 ? div(ev, ebitda) : null, fy = fcf != null && m ? fcf / m * 100 : null;
    var p = C[sym].prof, fx = (p && p.facts) || [], gf = function (k) { for (var i = 0; i < fx.length; i++) if (fx[i].k === k) return fx[i].v; return null; };
    var tgt = gf("OneYrTarget"), tN = tgt ? Number(String(tgt).replace(/[^0-9.]/g, "")) : null, px = q() && q().price, up = tN && px ? (tN / px - 1) * 100 : null;
    var asOf = yrs(f).slice(-1)[0];
    var h = '<div class="g4">' +
      card("PER", mult(per), ni != null && ni <= 0 ? "적자 — 계산 안 함" : "시총 ÷ 순이익") +
      card("PBR", mult(pbr), "시총 ÷ 자기자본") +
      card("PSR", mult(psr), "시총 ÷ 매출") +
      card("EV / EBITDA", mult(eve), "EV " + money(ev, kr)) + "</div>" +
      '<div class="g4" style="margin-top:10px">' +
      card("시가총액", money(m, kr), "지금 시세 기준") +
      card("FCF 수익률", fy != null ? pl(fy) : "—", "잉여현금흐름 ÷ 시총") +
      card("배당수익률", gf("Yield") || "—", gf("AnnualizedDividend") ? "연 " + esc(gf("AnnualizedDividend")) : "") +
      card("목표가", tgt ? esc(tgt) : "—", up != null ? '상승 여력 <b class="' + cls(up) + '">' + pct(up) + "</b>" : (isKr(sym) ? "한국 종목은 목표가 원천이 없습니다" : "")) + "</div>";
    h += '<p class="nt">배수는 지금 시가총액 ÷ 최근 회계연도(' + esc(asOf) + ") 값입니다(분기 합산 TTM 이 아님). 적자·자본잠식이면 계산하지 않습니다.</p>";
    var pr = f.peer && f.peer.ok && f.peer.rows || [];
    if (pr.length) h += "<h4>같은 업종 " + (f.peer.n || "") + "개 종목과 비교 · " + esc(f.peer.sector || "") + "</h4>" + '<div class="tw"><table><thead><tr><th>지표</th><th>이 종목</th><th>업종 중앙값</th><th>업종 안 위치</th></tr></thead><tbody>' + pr.map(function (r) {
      return "<tr><td>" + esc(r.ko) + "</td><td>" + (r.v != null ? r.v.toFixed(1) + (r.unit || "") : "—") + "</td><td>" + (r.med != null ? r.med.toFixed(1) + (r.unit || "") : "—") + '</td><td style="min-width:120px"><div class="bar"><b style="width:' + (r.pct || 0) + '%"></b></div></td></tr>'; }).join("") + "</tbody></table></div>";
    return h;
  }
  function vKpi() {
    need("fund"); var f = C[sym].fund; if (!f) return loading; if (f.err || !yrs(f).length) return '<div class="emp">재무 자료가 아직 없습니다.</div>';
    var kr = isKr(sym), r0 = last(f, "TotalRevenue"), r1 = prev(f, "TotalRevenue"), gp = last(f, "GrossProfit"), oi = last(f, "OperatingIncome"), ni = last(f, "NetIncome"), eq = last(f, "StockholdersEquity"), ta = last(f, "TotalAssets");
    var fcf = last(f, "FreeCashFlow"), debt = last(f, "TotalDebt"), ca = last(f, "CurrentAssets"), cl = last(f, "CurrentLiabilities"), a = f.adv || {};
    var g = r0 != null && r1 ? (r0 / r1 - 1) * 100 : null;
    return '<div class="g4">' +
      card("매출 성장률", '<span class="' + cls(g) + '">' + pct(g) + "</span>", "전년 대비 · 3년 연평균 " + pct(a.revCagr3)) +
      card("매출총이익률", pl(div(gp, r0) != null ? div(gp, r0) * 100 : null), "총이익 ÷ 매출") +
      card("영업이익률", pl(div(oi, r0) != null ? div(oi, r0) * 100 : null), "영업이익 ÷ 매출") +
      card("순이익률", pl(div(ni, r0) != null ? div(ni, r0) * 100 : null), "순이익 ÷ 매출") + "</div>" +
      '<div class="g4" style="margin-top:10px">' +
      card("ROE", a.roe != null ? pl(a.roe) : pl(div(ni, eq) != null ? div(ni, eq) * 100 : null), "순이익 ÷ 자기자본") +
      card("ROA", pl(div(ni, ta) != null ? div(ni, ta) * 100 : null), "순이익 ÷ 총자산") +
      card("잉여현금흐름", money(fcf, kr), "FCF 마진 " + pl(div(fcf, r0) != null ? div(fcf, r0) * 100 : null)) +
      card("부채 / 자본", div(debt, eq) != null ? (div(debt, eq) * 100).toFixed(0) + "%" : "—", "유동비율 " + (div(ca, cl) != null ? (div(ca, cl) * 100).toFixed(0) + "%" : "—")) + "</div>" +
      (f.eval && f.eval.fScore != null ? '<p class="nt">재무 건전성: Piotroski F ' + f.eval.fScore + "/" + (f.eval.fAvail || 9) + " · 아래 '재무 평가' 칸에 학술 모델 점수 전체가 있습니다.</p>" : "");
  }
  var FS = {
    is: [["매출", "TotalRevenue", 1], ["매출원가", "CostOfRevenue"], ["매출총이익", "GrossProfit"], ["판매관리비", "SellingGeneralAndAdministration"], ["영업이익", "OperatingIncome", 1], ["이자비용", "InterestExpense"], ["순이익", "NetIncome", 1], ["EPS(주당순이익)", "_eps"]],
    bs: [["자산총계", "TotalAssets", 1], ["유동자산", "CurrentAssets"], ["현금성자산", "CashAndCashEquivalents"], ["매출채권", "Receivables"], ["재고자산", "Inventory"], ["유형자산", "NetPPE"], ["부채총계", "TotalLiabilitiesNetMinorityInterest", 1], ["유동부채", "CurrentLiabilities"], ["총차입금", "TotalDebt"], ["자기자본", "StockholdersEquity", 1], ["이익잉여금", "RetainedEarnings"]],
    cf: [["영업활동 현금흐름", "OperatingCashFlow", 1], ["설비투자(CAPEX)", "CapitalExpenditure"], ["잉여현금흐름", "FreeCashFlow", 1], ["감가상각", "ReconciledDepreciation"]]
  };
  function vFs() {
    need("fund"); var f = C[sym].fund; if (!f) return loading; var o = yrs(f); if (f.err || !o.length) return '<div class="emp">재무제표가 아직 없습니다.</div>';
    var kr = isKr(sym), rows = FS[fsTab];
    var h = '<div class="seg" role="tablist">' + [["is", "손익계산서"], ["bs", "재무상태표"], ["cf", "현금흐름표"]].map(function (t) { return '<button type="button" role="tab" data-fs="' + t[0] + '" class="' + (fsTab === t[0] ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</div>";
    var rev = o.map(function (y) { return Y(f, y, fsTab === "cf" ? "FreeCashFlow" : fsTab === "bs" ? "TotalAssets" : "TotalRevenue"); }), mx = Math.max.apply(null, rev.map(function (v) { return Math.abs(v || 0); })) || 1;
    h += '<div class="bars" aria-hidden="true">' + o.map(function (y, i) { var v = rev[i] || 0; return '<div><span>' + money(v, kr) + '</span><span class="b" style="height:' + Math.max(3, Math.abs(v) / mx * 80).toFixed(0) + '%"></span><span style="opacity:.6">' + esc(y.slice(0, 4)) + "</span></div>"; }).join("") + "</div>";
    h += '<div class="tw" style="margin-top:10px"><table><thead><tr><th>항목</th>' + o.map(function (y) { return "<th>" + esc(y.slice(0, 7)) + "</th>"; }).join("") + "<th>전년 대비</th></tr></thead><tbody>" + rows.map(function (r) {
      var vals = o.map(function (y) { if (r[1] === "_eps") { var n = Y(f, y, "NetIncome"), s = Y(f, y, "BasicAverageShares"); return n != null && s ? n / s : null; } return Y(f, y, r[1]); });
      var a = vals[vals.length - 1], b = vals[vals.length - 2], yoy = a != null && b ? (a - b) / Math.abs(b) * 100 : null;
      return '<tr class="' + (r[2] ? "em" : "") + '"><td>' + r[0] + "</td>" + vals.map(function (v) { return "<td>" + (r[1] === "_eps" ? (v == null ? "—" : (kr ? Math.round(v).toLocaleString() + "원" : "$" + v.toFixed(2))) : money(v, kr)) + "</td>"; }).join("") + '<td class="' + cls(yoy) + '">' + pct(yoy) + "</td></tr>";
    }).join("") + "</tbody></table></div><p class=\"nt\">연간 · 회계연도 말 기준 · 출처 Yahoo Finance 재무 시계열</p>";
    return h;
  }
  function vEr() {
    need("fund"); need("prof"); var f = C[sym].fund;
    if (Date.now() - earnTs > 600000) { earnTs = Date.now(); getJ("/api/earnings").then(function (j) { EARN = j; draw(); }).catch(function () {}); }
    var kr = isKr(sym), h = "", e = null;
    ((EARN && EARN.items) || []).forEach(function (x) { if (x.symbol === sym && (!e || x.ts < e.ts)) e = x; });
    var p = C[sym].prof, fx = (p && p.facts) || [], tg = null; fx.forEach(function (r) { if (r.k === "OneYrTarget") tg = r.v; });
    h += '<div class="g3">' + card("다음 실적 발표", e ? new Date(e.ts).toLocaleDateString() + (e.when === "time-after-hours" ? " · 장 마감 후" : e.when === "time-pre-market" ? " · 장 시작 전" : "") : "—", e ? "예상 EPS " + esc(e.eps || "—") : (kr ? "한국 종목 일정은 DART 공시로 확인" : "다가오는 일정에 없음")) +
      card("애널리스트 목표가", tg ? esc(tg) : "—", tg ? "1년 · 나스닥 집계" : "") +
      card("최근 연간 순이익", f ? money(last(f, "NetIncome"), kr) : "—", f ? "전년 대비 " + pct(prev(f, "NetIncome") ? (last(f, "NetIncome") - prev(f, "NetIncome")) / Math.abs(prev(f, "NetIncome")) * 100 : null) : "") + "</div>";
    if (f && yrs(f).length) {
      var o = yrs(f), v = o.map(function (y) { return Y(f, y, "NetIncome"); }), mx = Math.max.apply(null, v.map(function (x) { return Math.abs(x || 0); })) || 1;
      h += "<h4>연간 순이익 추이</h4>" + '<div class="bars" aria-hidden="true">' + o.map(function (y, i) { var x = v[i] || 0; return '<div><span class="' + cls(x) + '">' + money(x, kr) + '</span><span class="b" style="height:' + Math.max(3, Math.abs(x) / mx * 80).toFixed(0) + '%"></span><span style="opacity:.6">' + esc(y.slice(0, 4)) + "</span></div>"; }).join("") + "</div>";
    }
    return h + '<p class="nt">분기 실적·가이던스의 원문은 IR 자료 탭(8-K·10-Q)에서 볼 수 있습니다. 아래 \'AI 분석\'·\'애널리스트\' 칸도 함께 보세요.</p>';
  }
  function vIr() {
    need("ir"); var r = C[sym].ir; if (!r) return loading; if (r.err || !r.ok) return '<div class="emp">IR 자료를 불러오지 못했습니다.</div>';
    var h = "";
    if (r.filings && r.filings.length) h += r.filings.map(function (x) { return '<a class="li" href="' + esc(x.u) + '" target="_blank" rel="noopener"><span class="tg">' + esc(x.form) + '</span><span class="t">' + esc(x.ko) + (x.period ? " · " + esc(x.period) : "") + (x.desc && x.desc !== x.form ? ' <span style="opacity:.6">' + esc(x.desc) + "</span>" : "") + '</span><span class="d">' + esc(x.date) + "</span></a>"; }).join("");
    h += (r.links || []).map(function (x) { return '<a class="li" href="' + esc(x.u) + '" target="_blank" rel="noopener"><span class="tg">↗</span><span class="t">' + esc(x.l) + '</span><span class="d"></span></a>'; }).join("");
    return h + '<p class="nt">' + (r.market === "kr" ? "한국 공시 원문은 DART(금융감독원) · 네이버 증권으로 연결합니다." : "미국 공시 원문(SEC EDGAR) · 6시간마다 갱신") + "</p>";
  }
  function vIns() {
    need("ir"); var r = C[sym].ir;
    if (!isKr(sym) && Date.now() - insTs > 600000) { insTs = Date.now(); getJ("/api/insider").then(function (j) { INS = j; draw(); }).catch(function () {}); }
    if (!r) return loading;
    if (r.market === "kr") return '<div class="emp">한국 종목의 임원·주요주주 지분 변동은 DART 소유 보고로 확인할 수 있습니다.</div>' + (r.links || []).filter(function (x) { return x.k === "own"; }).map(function (x) { return '<a class="li" href="' + esc(x.u) + '" target="_blank" rel="noopener"><span class="tg">↗</span><span class="t">' + esc(x.l) + '</span><span class="d"></span></a>'; }).join("");
    var feed = ((INS && INS.filings) || []).filter(function (x) { return x.ticker === sym; });
    var h = "";
    if (feed.length) h += "<h4 style=\"margin-top:0\">최근 신고자</h4>" + feed.slice(0, 10).map(function (x) { return '<a class="li" href="' + esc(x.link) + '" target="_blank" rel="noopener"><span class="tg">Form 4</span><span class="t">' + esc(x.insider) + '</span><span class="d">' + esc(String(x.date).slice(0, 10)) + "</span></a>"; }).join("");
    var ins = r.insiders || [];
    h += "<h4" + (feed.length ? "" : ' style="margin-top:0"') + ">내부자 지분 변동 신고 (Form 4) · " + ins.length + "건</h4>" + (ins.length ? ins.map(function (x) { return '<a class="li" href="' + esc(x.u) + '" target="_blank" rel="noopener"><span class="tg">' + esc(x.form === "4/A" ? "4 정정" : "Form 4") + '</span><span class="t">임원·이사·10% 주주의 매수·매도 신고</span><span class="d">' + esc(x.date) + "</span></a>"; }).join("") : '<div class="emp">최근 신고가 없습니다.</div>');
    return h + '<p class="nt">Form 4 = 내부자가 주식을 사거나 팔면 2영업일 안에 SEC 에 내는 신고 · 원문에 수량·가격이 있습니다.</p>';
  }
  function draw() {
    var el = $("luxInfo"); if (!el || !sym) return; css();
    var body = tab === "ov" ? vOv() : tab === "val" ? vVal() : tab === "kpi" ? vKpi() : tab === "fs" ? vFs() : tab === "er" ? vEr() : tab === "ir" ? vIr() : vIns();
    el.innerHTML = '<nav class="lxt" role="tablist" aria-label="종목 정보">' + TABS.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (t[0] === tab) + '" data-lxt="' + t[0] + '" class="' + (t[0] === tab ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</nav>" + body;
  }
  function open(s) {
    if (!s) return; sym = s; var el = $("luxInfo"); if (!el) return;
    if (!el.__b) { el.__b = 1; el.addEventListener("click", function (ev) { var b = ev.target.closest("button"); if (!b) return; if (b.dataset.lxt) { tab = b.dataset.lxt; draw(); } else if (b.dataset.fs) { fsTab = b.dataset.fs; draw(); } }); }
    draw();
  }
  window.luxInfo = { open: open };
})();
