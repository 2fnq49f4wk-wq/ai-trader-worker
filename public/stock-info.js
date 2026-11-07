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
  var TABS = [["ai", "AI 분석"], ["ov", "개요"], ["val", "밸류에이션"], ["kpi", "KPI"], ["fs", "재무제표"], ["er", "실적 · 전망"], ["ir", "IR 자료"], ["ins", "내부자 거래"]];
  var sym = null, tab = "ai", fsTab = "is", C = {};   // C[sym] = { fund, prof, ir }
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
      "#luxInfo .tw{overflow-x:auto;border:1px solid rgba(127,137,155,.22);border-radius:14px}#luxInfo table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:520px}#luxInfo th,#luxInfo td{padding:10px 12px;text-align:right;border-bottom:1px solid rgba(127,137,155,.14);white-space:nowrap}#luxInfo th{font-weight:500;color:#8A93A3;font-size:12.5px}html[data-theme=light] #luxInfo th{color:#667085}#luxInfo td:first-child,#luxInfo th:first-child{text-align:left;position:sticky;left:0;background:inherit}#luxInfo tr.em td{font-weight:700}#luxInfo tr:last-child td{border-bottom:0}",
      "#luxInfo .seg{display:inline-flex;gap:3px;padding:3px;border-radius:10px;background:rgba(127,137,155,.14);margin-bottom:10px}#luxInfo .seg button{border:0;border-radius:8px;padding:7px 12px;background:transparent;color:inherit;opacity:.7;font:inherit;font-size:13px;cursor:pointer}#luxInfo .seg button.on{opacity:1;font-weight:700;background:rgba(127,137,155,.22)}",
      "#luxInfo .li{display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid rgba(127,137,155,.14);color:inherit;text-decoration:none}#luxInfo .li:last-child{border-bottom:0}#luxInfo .li .tg{flex:0 0 auto;min-width:46px;text-align:center;padding:5px 6px;border-radius:8px;background:rgba(127,137,155,.16);font-size:11.5px;font-weight:700}#luxInfo .li .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}#luxInfo .li .d{font-size:12.5px;opacity:.65;white-space:nowrap}",
      "#luxInfo .bars{display:flex;align-items:flex-end;gap:10px;height:120px;padding:6px 4px 0}#luxInfo .bars div{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end;font-size:11.5px}#luxInfo .bars span.b{width:70%;max-width:46px;border-radius:6px 6px 0 0;background:rgba(127,137,155,.45)}#luxInfo .bars div:last-child span.b{background:currentColor;opacity:.85}",
      "#luxInfo .emp{padding:18px 4px;opacity:.65;font-size:13.5px}",
      /* [V33.750] ★폰에서 개요·밸류·KPI 보기 편하게★(사용자 11/4 · 디자인 캔버스 'LUX 종목 정보 탭 모바일 리디자인') —
         ① 탭 = 알약 칩 · 앱바 아래 고정(스크롤해도 보임 — 종전엔 위 버튼줄에 가려 밑줄만 보였다) ② 카드 8장(장당 260px) → 한 상자 안 줄 목록(이름·설명 왼쪽 · 값 오른쪽)
         ③ 기업 정보 값이 안 보이던 것(표 최소 폭 520px 이 폰 369px 를 넘어 값 열이 화면 밖) → 2열 목록 ④ 재무 표 첫 열 고정 배경 · 연도만 */
      "#luxInfo .kv td:first-child{position:static;background:transparent !important;opacity:.75}#luxInfo .kv table{min-width:0}#luxInfo .kv td{white-space:normal;word-break:keep-all}#luxInfo .kv td:last-child{font-weight:600;text-align:right}",
      "#luxInfo td:first-child,#luxInfo th:first-child{background:var(--s1,#141922)}html[data-theme=light] #luxInfo td:first-child,html[data-theme=light] #luxInfo th:first-child{background:#fff}",
      /* [V33.751] 시안 부품 — 모든 폭 공통(데스크톱은 칸을 넓게) */
      "#luxInfo .lxh{display:none}",
      "#luxInfo .hero,#luxInfo .ls,#luxInfo .pc,#luxInfo .fc{background:var(--s1,#141922);border:1px solid rgba(127,137,155,.18);border-radius:16px}html[data-theme=light] #luxInfo .hero,html[data-theme=light] #luxInfo .ls,html[data-theme=light] #luxInfo .pc,html[data-theme=light] #luxInfo .fc,html[data-theme=light] #luxInfo .tl>div{background:#fff}",
      "#luxInfo .k{font-size:12.5px;opacity:.68}#luxInfo .s{font-size:11.5px;opacity:.62;line-height:1.4}",
      "#luxInfo .hero{padding:16px;display:flex;flex-direction:column;gap:12px;margin-bottom:10px}#luxInfo .hr{display:flex;justify-content:space-between;align-items:baseline;gap:10px}#luxInfo .hr.s{font-size:12.5px;opacity:.65}",
      "#luxInfo .rg{position:relative;height:8px;border-radius:4px;background:linear-gradient(90deg,#3B82F6,rgba(127,137,155,.35) 50%,#E5484D)}#luxInfo .rg i{position:absolute;top:-5px;width:4px;height:18px;margin-left:-2px;border-radius:2px;background:currentColor}",
      "#luxInfo .h2c{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#luxInfo .h2c div{display:flex;flex-direction:column;gap:2px}#luxInfo .h2c b{font-size:16px}",
      "#luxInfo .tl{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:10px}#luxInfo .tl>div{background:var(--s1,#141922);border:1px solid rgba(127,137,155,.18);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;min-width:0}#luxInfo .tl b{font-size:18px;letter-spacing:-.3px}",
      "#luxInfo .ls{padding:2px 16px;margin-bottom:10px}#luxInfo .ls .r{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:52px;border-bottom:1px solid rgba(127,137,155,.14)}#luxInfo .ls .r:last-child{border-bottom:0}",
      "#luxInfo .ls .l{display:flex;flex-direction:column;gap:2px;min-width:0}#luxInfo .ls .l .k{font-size:14px;font-weight:600;opacity:1}#luxInfo .ls .v{display:flex;align-items:center;gap:10px;flex:0 0 auto}#luxInfo .ls .v b{font-size:16.5px;min-width:58px;text-align:right}",
      "#luxInfo .gp{font-size:12.5px;font-weight:700;opacity:.62;letter-spacing:.3px;margin:14px 2px 8px}#luxInfo .gp:first-child{margin-top:2px}",
      "#luxInfo .mb{display:inline-flex;align-items:flex-end;gap:3px;height:30px}#luxInfo .mb i{width:7px;border-radius:2px;background:rgba(127,137,155,.45)}#luxInfo .mb i.upb{background:#E5484D}#luxInfo .mb i.dnb{background:#3B82F6}",
      "#luxInfo .pb{display:inline-block;width:70px;height:6px;border-radius:3px;background:rgba(127,137,155,.22);overflow:hidden}#luxInfo .pb i{display:block;height:100%;border-radius:3px;background:#3DD6B5}html[data-theme=light] #luxInfo .pb i{background:#0B7A66}#luxInfo .pr .pb{width:100%;margin-top:6px}",
      "#luxInfo .pc{padding:14px 16px;display:flex;flex-direction:column;gap:12px;margin-top:12px}#luxInfo .pc .pr .hr{font-size:13px}#luxInfo .mo{align-self:flex-start;min-height:36px;border:0;background:transparent;color:#7CC4FF;font:inherit;font-size:13px;padding:0;cursor:pointer}html[data-theme=light] #luxInfo .mo{color:#1B4FB5}",
      "#luxInfo .seg.sg3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));width:100%;box-sizing:border-box}#luxInfo .seg.sg3 button{min-height:38px}",
      "#luxInfo .fc{padding:14px 16px 10px;display:flex;flex-direction:column;gap:10px}#luxInfo .pbars{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;height:120px;align-items:end}#luxInfo .pbars div{display:flex;align-items:flex-end;justify-content:center;gap:3px;height:100%}",
      "#luxInfo .pbars span,#luxInfo .lg i{width:16px;border-radius:3px 3px 0 0;display:inline-block}#luxInfo .ba{background:rgba(127,137,155,.5)}#luxInfo .ba.on{background:currentColor;opacity:.85}#luxInfo .bb{background:#3DD6B5}html[data-theme=light] #luxInfo .bb{background:#0B7A66}",
      "#luxInfo .yl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;text-align:center;font-size:11.5px;opacity:.75}#luxInfo .yl b{font-size:12px}#luxInfo .lg{display:flex;gap:14px;font-size:11.5px;opacity:.7}#luxInfo .lg i{width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}",
      "@media (min-width:761px){#luxInfo .ls{columns:2;column-gap:28px}#luxInfo .ls .r{break-inside:avoid}}",
      "@media (max-width:760px){#luxInfo .lxh{display:flex}}",
      "@media (max-width:760px){",
      "#luxInfo .lxs{position:sticky;top:var(--m-top,56px);z-index:6;margin:0 -2px 12px;padding:8px 2px;background:var(--bg,#0D1014);border-bottom:1px solid rgba(127,137,155,.18)}html[data-theme=light] #luxInfo .lxs{background:#F7F9FB}#luxInfo .lxs .lxt{margin:0;border-bottom:0;gap:6px}",
      "#luxInfo .lxh{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:0 2px 8px;font-size:13px;opacity:.9}#luxInfo .lxh b{font-size:15.5px}#luxInfo .lxh span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "#luxInfo .lxt button{min-height:38px;padding:0 15px;border:1px solid rgba(127,137,155,.35);border-radius:999px;opacity:1;color:inherit;font-size:13.5px}#luxInfo .lxt button.on{background:#EEF1F5;color:#0D1014;border-color:#EEF1F5}html[data-theme=light] #luxInfo .lxt button.on{background:#101828;color:#fff;border-color:#101828}",
      "#luxInfo .g4,#luxInfo .g3{grid-template-columns:1fr;gap:0;border:1px solid rgba(127,137,155,.22);border-radius:16px;overflow:hidden;background:var(--s1,#141922)}html[data-theme=light] #luxInfo .g4,html[data-theme=light] #luxInfo .g3{background:#fff}",
      "#luxInfo .g4 .cd,#luxInfo .g3 .cd{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'k v' 's v' 'b b';align-items:center;gap:2px 14px;border:0;border-bottom:1px solid rgba(127,137,155,.14);border-radius:0;padding:12px 16px;min-height:52px}#luxInfo .g4 .cd:last-child,#luxInfo .g3 .cd:last-child{border-bottom:0}",
      "#luxInfo .cd .k{grid-area:k;font-size:14px;opacity:1;font-weight:600}#luxInfo .cd .v{grid-area:v;font-size:17px;text-align:right}#luxInfo .cd .s{grid-area:s;font-size:11.5px}#luxInfo .cd .bar{grid-area:b;margin-top:8px}",
      "#luxInfo h4{margin:16px 2px 8px;font-size:14px}#luxInfo table{font-size:13px}#luxInfo th,#luxInfo td{padding:10px}",
      "#luxInfo .tw{position:relative;-webkit-overflow-scrolling:touch}#luxInfo .bars{height:104px}",
      "}"
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

  /* [V33.751] ★디자인 시안대로★(캔버스 'LUX 종목 정보 탭 모바일 리디자인') — 큰 카드 대신: 52주 히어로 · 작은 타일 · 줄 목록(이름·설명 | 값) · 묶음 제목 · 4년 미니 막대 */
  function tiles(a) { return '<div class="tl">' + a.map(function (t) { return '<div><span class="k">' + t[0] + '</span><b class="' + (t[3] || "") + '">' + t[1] + '</b>' + (t[2] ? '<span class="s">' + t[2] + "</span>" : "") + "</div>"; }).join("") + "</div>"; }
  function list(a) { return '<div class="ls">' + a.map(function (r) { return '<div class="r"><div class="l"><span class="k">' + r[0] + "</span>" + (r[1] ? '<span class="s">' + r[1] + "</span>" : "") + '</div><div class="v">' + (r[3] || "") + '<b class="' + (r[4] || "") + '">' + r[2] + "</b></div></div>"; }).join("") + "</div>"; }
  function grp(t) { return '<div class="gp">' + t + "</div>"; }
  function minib(vals, hot) { var mx = Math.max.apply(null, vals.map(function (v) { return Math.abs(v || 0); })) || 1; return '<span class="mb" aria-hidden="true">' + vals.map(function (v, i) { return '<i class="' + (i === vals.length - 1 ? (hot || "on") : "") + '" style="height:' + Math.max(8, Math.abs(v || 0) / mx * 100).toFixed(0) + '%"></i>'; }).join("") + "</span>"; }
  function pbar(v) { return v == null || !isFinite(v) ? "" : '<span class="pb" aria-hidden="true"><i style="width:' + Math.max(2, Math.min(100, v)).toFixed(0) + '%"></i></span>'; }
  function vOv() {
    need("prof"); var p = C[sym].prof; if (!p) return loading; if (p.err || !p.ok) return '<div class="emp">기업 자료가 아직 없습니다.</div>';
    var st = p.stats || {}, fx = p.facts || [];
    var lmx = window.luxMiniView ? window.luxMiniView.html(sym) : "";   // [V33.783] LUX-Mini 단기·중기·장기
    var pos = st.pos52 != null ? Math.max(0, Math.min(100, st.pos52)) : null;
    var h = lmx + '<section class="hero"><div class="hr"><span class="k">52주 범위</span><span class="k">현재 위치 <b>' + (pos != null ? Math.round(pos) + "%" : "—") + "</b></span></div>" +
      '<div class="rg" aria-hidden="true">' + (pos != null ? '<i style="left:' + pos.toFixed(1) + '%"></i>' : "") + "</div>" +
      '<div class="hr s"><span>저점 ' + esc(st.lo52 || "—") + "</span><span>고점 " + esc(st.hi52 || "—") + "</span></div>" +
      '<div class="h2c"><div><span class="k">고점 대비</span><b class="' + cls(st.fromHi52) + '">' + pct(st.fromHi52) + '</b></div><div><span class="k">저점 대비</span><b class="' + cls(st.fromLo52) + '">' + pct(st.fromLo52) + "</b></div></div></section>";
    h += tiles([["베타", st.beta != null ? st.beta.toFixed(2) : "—", (isKr(sym) ? "코스피200" : "S&P 500") + " 대비"], ["최대 낙폭", pct(st.mdd1y), "1년", cls(st.mdd1y)], ["연초 이후", pct(st.ytd), "YTD", cls(st.ytd)]]);
    if (fx.length) h += "<h4>기업 정보</h4>" + list(fx.map(function (r) { return [esc(r.l), "", esc(r.v)]; }));
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
    var h = tiles([["시가총액", money(m, kr), "지금 시세 기준"], ["목표가 평균", tgt ? esc(tgt) : "—", up != null ? "상승 여력 " + pct(up) : (isKr(sym) ? "한국 종목은 목표가 원천 없음" : ""), ""]]).replace("상승 여력 " + pct(up), '<span class="' + cls(up) + '">상승 여력 ' + pct(up) + "</span>");
    h += list([["PER", ni != null && ni <= 0 ? "적자 — 계산 안 함" : "시총 ÷ 순이익", mult(per)], ["PBR", "시총 ÷ 자기자본", mult(pbr)], ["PSR", "시총 ÷ 매출", mult(psr)], ["EV / EBITDA", "EV " + money(ev, kr), mult(eve)],
      ["FCF 수익률", "잉여현금흐름 ÷ 시총", fy != null ? pl(fy) : "—"], ["배당수익률", gf("AnnualizedDividend") ? "연 " + esc(gf("AnnualizedDividend")) : "", gf("Yield") || "—"]]);
    h += '<p class="nt">배수는 지금 시가총액 ÷ 최근 회계연도(' + esc(asOf) + ") 값입니다(분기 합산 TTM 이 아님). 적자·자본잠식이면 계산하지 않습니다.</p>";
    var pr = f.peer && f.peer.ok && f.peer.rows || [];
    if (pr.length) {
      var sh = valMore ? pr : pr.slice(0, 3);
      h += '<section class="pc"><div class="hr"><b>같은 업종 ' + (f.peer.n || "") + "개와 비교</b><span class=\"k\">" + esc(f.peer.sector || "") + "</span></div>" + sh.map(function (r) {
        return '<div class="pr"><div class="hr"><span>' + esc(r.ko) + "</span><span><b>" + (r.v != null ? r.v.toFixed(1) + (r.unit || "") : "—") + '</b> <span class="k">· 중앙 ' + (r.med != null ? r.med.toFixed(1) + (r.unit || "") : "—") + "</span></span></div>" + pbar(r.pct || 0) + "</div>"; }).join("") +
        (pr.length > 3 ? '<button type="button" class="mo" data-vmore="1">' + (valMore ? "접기" : pr.length + "개 지표 모두 보기 ›") + "</button>" : "") + "</section>";
    }
    return h;
  }
  function vKpi() {
    need("fund"); var f = C[sym].fund; if (!f) return loading; if (f.err || !yrs(f).length) return '<div class="emp">재무 자료가 아직 없습니다.</div>';
    var kr = isKr(sym), r0 = last(f, "TotalRevenue"), r1 = prev(f, "TotalRevenue"), gp = last(f, "GrossProfit"), oi = last(f, "OperatingIncome"), ni = last(f, "NetIncome"), eq = last(f, "StockholdersEquity"), ta = last(f, "TotalAssets");
    var fcf = last(f, "FreeCashFlow"), debt = last(f, "TotalDebt"), ca = last(f, "CurrentAssets"), cl = last(f, "CurrentLiabilities"), a = f.adv || {};
    var g = r0 != null && r1 ? (r0 / r1 - 1) * 100 : null;
    var o = yrs(f), revs = o.map(function (y) { return Y(f, y, "TotalRevenue"); });
    var gpm = div(gp, r0) != null ? div(gp, r0) * 100 : null, opm = div(oi, r0) != null ? div(oi, r0) * 100 : null, npm = div(ni, r0) != null ? div(ni, r0) * 100 : null;
    var roe = a.roe != null ? a.roe : (div(ni, eq) != null ? div(ni, eq) * 100 : null), roa = div(ni, ta) != null ? div(ni, ta) * 100 : null;
    var h = grp("성장") + list([["매출 성장률", "전년 대비 · 3년 연평균 " + pct(a.revCagr3), pct(g), minib(revs, g != null && g < 0 ? "dnb" : "upb"), cls(g)]]);
    h += grp("수익성") + list([["매출총이익률", "총이익 ÷ 매출", pl(gpm), pbar(gpm)], ["영업이익률", "영업이익 ÷ 매출", pl(opm), pbar(opm)], ["순이익률", "순이익 ÷ 매출", pl(npm), pbar(npm)], ["ROE", "순이익 ÷ 자기자본", pl(roe)], ["ROA", "순이익 ÷ 총자산", pl(roa)]]);
    h += grp("현금 · 안정성") + tiles([["잉여현금흐름", money(fcf, kr), "FCF 마진 " + pl(div(fcf, r0) != null ? div(fcf, r0) * 100 : null)], ["부채 / 자본", div(debt, eq) != null ? (div(debt, eq) * 100).toFixed(0) + "%" : "—", "유동비율 " + (div(ca, cl) != null ? (div(ca, cl) * 100).toFixed(0) + "%" : "—")]]);
    return h + '<p class="nt">' + (f.eval && f.eval.fScore != null ? "재무 건전성 Piotroski F " + f.eval.fScore + "/" + (f.eval.fAvail || 9) + " · " : "") + "막대 = 매출 " + o.length + "년(" + esc((o[0] || "").slice(0, 4)) + "~" + esc((o[o.length - 1] || "").slice(0, 4)) + ")</p>";
  }
  var FS = {
    is: [["매출", "TotalRevenue", 1], ["매출원가", "CostOfRevenue"], ["매출총이익", "GrossProfit"], ["판매관리비", "SellingGeneralAndAdministration"], ["영업이익", "OperatingIncome", 1], ["이자비용", "InterestExpense"], ["순이익", "NetIncome", 1], ["EPS(주당순이익)", "_eps"]],
    bs: [["자산총계", "TotalAssets", 1], ["유동자산", "CurrentAssets"], ["현금성자산", "CashAndCashEquivalents"], ["매출채권", "Receivables"], ["재고자산", "Inventory"], ["유형자산", "NetPPE"], ["부채총계", "TotalLiabilitiesNetMinorityInterest", 1], ["유동부채", "CurrentLiabilities"], ["총차입금", "TotalDebt"], ["자기자본", "StockholdersEquity", 1], ["이익잉여금", "RetainedEarnings"]],
    cf: [["영업활동 현금흐름", "OperatingCashFlow", 1], ["설비투자(CAPEX)", "CapitalExpenditure"], ["잉여현금흐름", "FreeCashFlow", 1], ["감가상각", "ReconciledDepreciation"]]
  };
  function vFs() {
    need("fund"); var f = C[sym].fund; if (!f) return loading; var o = yrs(f); if (f.err || !o.length) return '<div class="emp">재무제표가 아직 없습니다.</div>';
    var kr = isKr(sym), rows = FS[fsTab];
    var h = '<div class="seg sg3" role="tablist">' + [["is", "손익"], ["bs", "재무상태"], ["cf", "현금흐름"]].map(function (t) { return '<button type="button" role="tab" data-fs="' + t[0] + '" class="' + (fsTab === t[0] ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</div>";
    var K2 = fsTab === "bs" ? [["TotalAssets", "자산"], ["TotalLiabilitiesNetMinorityInterest", "부채"]] : fsTab === "cf" ? [["OperatingCashFlow", "영업 현금흐름"], ["FreeCashFlow", "잉여현금흐름"]] : [["TotalRevenue", "매출"], ["NetIncome", "순이익"]];
    var A = o.map(function (y) { return Y(f, y, K2[0][0]); }), B = o.map(function (y) { return Y(f, y, K2[1][0]); }), mx = Math.max.apply(null, A.concat(B).map(function (v) { return Math.abs(v || 0); })) || 1;
    h += '<section class="fc"><div class="hr"><span class="k">' + K2[0][1] + " · " + K2[1][1] + ' (연간)</span></div><div class="pbars" aria-hidden="true">' + o.map(function (y, i) {
      return '<div><span class="ba' + (i === o.length - 1 ? " on" : "") + '" style="height:' + Math.max(2, Math.abs(A[i] || 0) / mx * 100).toFixed(0) + '%"></span><span class="bb" style="height:' + Math.max(2, Math.abs(B[i] || 0) / mx * 100).toFixed(0) + '%"></span></div>'; }).join("") + "</div>" +
      '<div class="yl">' + o.map(function (y, i) { return "<span>" + esc(y.slice(0, 4)) + "<br><b>" + money(A[i], kr) + "</b></span>"; }).join("") + '</div><div class="lg"><span><i class="ba on"></i>' + K2[0][1] + '</span><span><i class="bb"></i>' + K2[1][1] + "</span></div></section>";
    h += '<div class="tw" style="margin-top:10px"><table><thead><tr><th>항목</th>' + o.map(function (y) { return "<th>" + esc(y.slice(0, 4)) + "</th>"; }).join("") + "<th>전년 대비</th></tr></thead><tbody>" + rows.map(function (r) {
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
  /* [V33.786] AI 분석 탭 — public/stock-analysis.js(브라우저 계산) · 업종 비교는 상세 화면이 받는 /api/fundamentals 를 같이 쓴다 */
  function vAi() {
    need("fund");
    if (!window.luxAnalysis) return '<div class="emp">분석 모듈을 불러오는 중…</div>';
    var f = C[sym] && C[sym].fund;
    return window.luxAnalysis.view(sym, { fund: f && !f.err ? f : null, quote: q(), redraw: function () { if (tab === "ai") draw(); } });
  }
  var valMore = false;
  function draw() {
    var el = $("luxInfo"); if (!el || !sym) return; css();
    var body = tab === "ai" ? vAi() : tab === "ov" ? vOv() : tab === "val" ? vVal() : tab === "kpi" ? vKpi() : tab === "fs" ? vFs() : tab === "er" ? vEr() : tab === "ir" ? vIr() : vIns();
    var x = q(), hd = x && x.price > 0 ? '<div class="lxh"><span><b>' + esc(x.name || sym) + "</b> " + esc(isKr(sym) ? sym.split(".")[0] : sym) + '</span><span><b>' + money(x.price, isKr(sym)).replace(/\.00$/, "") + '</b> <span class="' + cls(x.dayPct) + '">' + pct(x.dayPct, 2) + "</span></span></div>" : "";
    el.innerHTML = '<div class="lxs">' + hd + '<nav class="lxt" role="tablist" aria-label="종목 정보">' + TABS.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (t[0] === tab) + '" data-lxt="' + t[0] + '" class="' + (t[0] === tab ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</nav></div>" + body;
    if (tab === "fs") el.querySelectorAll(".tw").forEach(function (t) { if (t.scrollWidth > t.clientWidth) t.scrollLeft = t.scrollWidth; });   // [V33.750] 재무 표는 최신 연도부터 보이게(왼쪽으로 밀면 이전 해)
  }
  function open(s) {
    if (!s) return; sym = s; var el = $("luxInfo"); if (!el) return;
    if (!el.__b) { el.__b = 1; el.addEventListener("click", function (ev) { var b = ev.target.closest("button"); if (!b) return; if (b.dataset.lxt) { tab = b.dataset.lxt; draw(); } else if (b.dataset.fs) { fsTab = b.dataset.fs; draw(); } else if (b.dataset.vmore) { valMore = !valMore; draw(); } }); }
    draw();
  }
  window.addEventListener("lux:luxmini", function () { if (sym && tab === "ov") try { draw(); } catch (e) {} });   // [V33.783]
  window.luxInfo = { open: open };
})();
