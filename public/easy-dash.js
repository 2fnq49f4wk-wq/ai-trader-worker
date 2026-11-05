/* [V33.776] ★초보자용 대시보드★(사용자 11/5 "지금 화면은 전문가용으로 두고 주식 처음 하는 사람용 대시보드 하나 더 · 왼쪽 사이드바 슬라이드 전환")
   - 전문가 화면(#page-dashboard 의 기존 내용)은 그대로 두고, html.lux-easy 일 때만 이 화면(#easyDash)을 앞에 보인다.
   - 서버 비용 0: 새 API 없음. 상태(/api/state)는 화면 관문(CDN·30초 묶음)을 그대로 지나고, AI 후보는 MY 와 같은 /api/playbook 사본(lux-pb · 10분)을 쓴다.
   - 내용: 오늘의 시장 날씨 · 익숙한 회사들 · 1년 전에 샀다면 · AI가 눈여겨본 종목 · 오늘 많이 움직인 종목 · 오늘의 용어 · 모의투자 시작.
   - 모드는 이 기기(localStorage 'lux-dmode')에만 저장한다(서버 쓰기 0). */
(function () {
  "use strict";
  var KEY = "lux-dmode", PBK = "lux-pb";
  var D = document, H = D.documentElement;
  function $(i) { return D.getElementById(i); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function T(ko, en) { return '<span data-en="' + esc(en) + '">' + esc(ko) + "</span>"; }   // 숫자·이름이 섞인 문장은 영어를 직접 붙인다(i18n.js data-en)
  function wonEn(v) { v = Math.round(v); var a = Math.abs(v), f = function (x) { return x.toFixed(2).replace(/\.?0+$/, ""); }; return "₩" + (a >= 1e9 ? f(v / 1e9) + "B" : a >= 1e6 ? f(v / 1e6) + "M" : a >= 1e3 ? Math.round(v / 1e3).toLocaleString() + "K" : v.toLocaleString()); }
  function enName(n) { try { return (window.luxLang && window.luxLang.t) ? window.luxLang.t(n) : n; } catch (e) { return n; } }
  function getMode() { try { return localStorage.getItem(KEY) === "easy" ? "easy" : "pro"; } catch (e) { return "pro"; } }
  function isEn() { try { return !!(window.luxLang && window.luxLang.get && window.luxLang.get() === "en"); } catch (e) { return false; } }

  // ── 익숙한 회사(초보자가 이름만 들어도 아는 곳) — 무엇을 하는 회사인지 한 줄 ──
  var FAM = [
    ["AAPL", "아이폰·맥북을 만드는 회사", "#A2AAAD"], ["005930.KS", "갤럭시 폰과 반도체", "#1428A0"], ["TSLA", "전기차와 자율주행", "#E31937"],
    ["NVDA", "AI 컴퓨터의 두뇌(반도체)", "#76B900"], ["035720.KS", "카카오톡·카카오뱅크", "#FEE500"], ["NFLX", "드라마·영화 스트리밍", "#E50914"],
    ["035420.KS", "검색·쇼핑·웹툰", "#03C75A"], ["005380.KS", "자동차(현대·제네시스)", "#002C5F"], ["AMZN", "온라인 쇼핑과 클라우드", "#FF9900"],
    ["KO", "코카콜라 음료", "#F40009"], ["000660.KS", "메모리 반도체", "#EA002C"], ["MSFT", "윈도우·엑셀·AI", "#00A4EF"]
  ];
  var TERMS = [
    ["주식", "회사의 아주 작은 조각이에요. 1주를 사면 그 회사의 주인 중 한 명이 돼요."],
    ["시가총액", "회사 전체의 가격이에요. 주가 × 주식 수. 클수록 큰 회사예요."],
    ["등락률", "어제 마지막 가격보다 오늘 얼마나 올랐는지(+) 내렸는지(−)를 %로 보여 줘요."],
    ["매수 · 매도", "매수는 사는 것, 매도는 파는 것이에요."],
    ["평단가", "내가 산 가격의 평균이에요. 지금 가격이 이보다 높으면 이익이에요."],
    ["손절", "더 크게 잃기 전에 정해 둔 가격에서 파는 거예요. 초보에게 가장 중요한 습관이에요."],
    ["익절", "목표한 이익에 도달했을 때 파는 거예요."],
    ["배당", "회사가 번 돈의 일부를 주주에게 나눠 주는 돈이에요."],
    ["ETF", "여러 종목을 한 바구니에 담아 한 번에 사는 상품이에요. 처음엔 분산에 좋아요."],
    ["분산 투자", "한 종목에 몰지 않고 여러 곳에 나눠 담는 것. 한 곳이 떨어져도 덜 아파요."],
    ["지수", "시장 전체의 온도계예요. 코스피·S&P 500·나스닥이 대표적이에요."],
    ["PER", "주가 ÷ 1주당 이익. 이익에 비해 주가가 비싼지 싼지 보는 숫자예요."],
    ["거래량", "오늘 사고판 주식 수예요. 갑자기 늘면 관심이 몰렸다는 신호예요."],
    ["정규장 · 시간외", "정규장은 주식시장이 정식으로 열린 시간, 시간외는 그 앞뒤로 조금 더 거래되는 시간이에요."],
    ["변동성", "가격이 얼마나 크게 출렁이는지예요. 클수록 기회도 위험도 커요."],
    ["레버리지 ETF", "지수가 1% 움직이면 2~3%씩 움직이는 상품. 오래 들고 있으면 손해가 쌓이기 쉬워요."],
    ["상한가 · 하한가", "한국 주식이 하루에 오르내릴 수 있는 끝(±30%)이에요."],
    ["모의투자", "가상 돈으로 진짜처럼 연습하는 거예요. 잃어도 실제 돈은 그대로예요."],
    ["복리", "번 돈이 다시 돈을 버는 것. 오래 둘수록 눈덩이처럼 커져요."],
    ["실적 발표", "회사가 몇 달 동안 얼마나 벌었는지 알리는 날. 이 날 주가가 크게 움직이곤 해요."]
  ];

  var LEV = /레버리지|인버스|선물|2X|3X|Ultra|Bull|Bear|Leverag|Inverse/i, LEVS = ["SOXL", "SOXS", "TQQQ", "SQQQ", "TECL", "TECS", "UPRO", "SPXU", "SPXL", "SPXS", "LABU", "LABD", "FNGU", "FNGD", "TNA", "TZA", "NVDL", "TSLL", "UVXY", "SVXY"];   // 초보자 화면엔 레버리지·인버스를 올리지 않는다
  var ST = null, stAt = 0, PB = null, pbAt = 0, busy = false, termI = null, whatSym = "005930.KS", whatAmt = 1000000;

  function css() {
    if ($("ezCss")) return;
    var s = D.createElement("style"); s.id = "ezCss";
    s.textContent =
      "#easyDash{display:none;--e-bg:#0B0D11;--e-c:#14171D;--e-c2:#1A1E25;--e-bd:rgba(255,255,255,.07);--e-t:#F2F4F7;--e-m:#98A2B3;--e-mm:#667085;--e-up:#F04452;--e-dn:#3182F6;--e-acc:#3DD6B5;color:var(--e-t);max-width:1180px;margin:0 auto;padding:6px 2px 40px;font-family:inherit}" +
      "html[data-theme=light] #easyDash{--e-bg:#F4F6F9;--e-c:#FFFFFF;--e-c2:#F2F4F7;--e-bd:rgba(16,24,40,.08);--e-t:#101828;--e-m:#475467;--e-mm:#667085;--e-acc:#0E9F7E}" +
      "html.lux-easy #easyDash{display:block}html.lux-easy #page-dashboard>*:not(#easyDash){display:none!important}" +
      "#easyDash .ez-hi{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:4px 2px 14px}#easyDash .ez-hi h1{margin:0;font-size:26px;font-weight:800;letter-spacing:-.6px;line-height:1.25}#easyDash .ez-hi p{margin:6px 0 0;color:var(--e-m);font-size:14px}" +
      "#easyDash .ez-pro{flex:none;background:none;border:1px solid var(--e-bd);color:var(--e-m);border-radius:999px;padding:8px 14px;font-size:12.5px;cursor:pointer}#easyDash .ez-pro:hover{color:var(--e-t)}" +
      "#easyDash .ez-g{display:grid;gap:14px}#easyDash .g2{grid-template-columns:repeat(2,minmax(0,1fr))}" +
      "#easyDash .ez-c{background:var(--e-c);border:1px solid var(--e-bd);border-radius:20px;padding:18px 18px 16px;min-width:0}" +
      "#easyDash .ez-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 12px}#easyDash .ez-h b{font-size:17px;font-weight:800;letter-spacing:-.3px}#easyDash .ez-h span{font-size:12px;color:var(--e-mm)}" +
      "#easyDash .wx{display:flex;gap:14px;align-items:center}#easyDash .wx .ic{font-size:46px;line-height:1;flex:none}#easyDash .wx .tt{font-size:19px;font-weight:800;letter-spacing:-.4px}#easyDash .wx .ds{color:var(--e-m);font-size:13.5px;margin-top:4px;line-height:1.45}" +
      "#easyDash .chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;border-radius:999px;padding:4px 10px;background:var(--e-c2);color:var(--e-m);margin-top:10px}#easyDash .chip i{width:7px;height:7px;border-radius:50%;background:var(--e-mm)}#easyDash .chip.on i{background:var(--e-acc)}#easyDash .chip.on{color:var(--e-t)}" +
      "#easyDash .ix{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}#easyDash .ix div{flex:1 1 0;min-width:96px;background:var(--e-c2);border-radius:12px;padding:8px 10px}#easyDash .ix s{display:block;text-decoration:none;font-size:11.5px;color:var(--e-mm)}#easyDash .ix b{font-size:15px}" +
      "#easyDash .up{color:var(--e-up)}#easyDash .dn{color:var(--e-dn)}#easyDash .fl{color:var(--e-m)}" +
      "#easyDash .fam{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px}" +
      "#easyDash .co{background:var(--e-c2);border:1px solid transparent;border-radius:16px;padding:12px;cursor:pointer;text-align:left;color:inherit;font:inherit;display:flex;flex-direction:column;gap:6px;min-width:0;transition:transform .15s,border-color .15s}#easyDash .co:hover{transform:translateY(-2px);border-color:var(--e-bd)}" +
      "#easyDash .co .tp{display:flex;align-items:center;gap:8px;min-width:0}#easyDash .co .av{width:30px;height:30px;border-radius:9px;flex:none;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#fff}#easyDash .co .nm{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#easyDash .co .wh{font-size:11.5px;color:var(--e-mm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#easyDash .co .px{display:flex;align-items:baseline;justify-content:space-between;gap:6px}#easyDash .co .px b{font-size:15px}#easyDash .co .px span{font-size:13px;font-weight:700}#easyDash .co svg{width:100%;height:30px;display:block}" +
      "#easyDash .seg{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}#easyDash .seg button{border:1px solid var(--e-bd);background:var(--e-c2);color:var(--e-m);border-radius:999px;padding:6px 12px;font-size:12.5px;cursor:pointer}#easyDash .seg button.on{background:var(--e-t);color:var(--e-bg);border-color:var(--e-t);font-weight:700}" +
      "#easyDash .wi{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-top:4px}#easyDash .wi .v{font-size:30px;font-weight:800;letter-spacing:-1px}#easyDash .wi .r{font-size:15px;font-weight:700}#easyDash .note{font-size:11.5px;color:var(--e-mm);margin-top:10px;line-height:1.5}" +
      "#easyDash .rw{display:flex;align-items:center;gap:10px;padding:9px 4px;border-top:1px solid var(--e-bd);cursor:pointer}#easyDash .rw:first-child{border-top:0}#easyDash .rw .rk{width:22px;text-align:center;font-weight:800;color:var(--e-mm);flex:none}#easyDash .rw .l{flex:1;min-width:0}#easyDash .rw .l b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#easyDash .rw .l span{font-size:11.5px;color:var(--e-mm)}#easyDash .rw .r{text-align:right;flex:none}#easyDash .rw .r b{display:block;font-size:14px}#easyDash .rw .r span{font-size:12.5px;font-weight:700}" +
      "#easyDash .tm{font-size:22px;font-weight:800;letter-spacing:-.5px;margin:2px 0 8px}#easyDash .tx{color:var(--e-m);font-size:14px;line-height:1.6}#easyDash .tb{margin-top:12px;border:0;background:none;color:var(--e-acc);font-weight:700;font-size:13px;cursor:pointer;padding:0}" +
      "#easyDash .cta{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;background:linear-gradient(135deg,#1B3A5C 0%,#14171D 70%);border-color:rgba(61,214,181,.25)}html[data-theme=light] #easyDash .cta{background:linear-gradient(135deg,#DFF6EF 0%,#FFFFFF 70%)}#easyDash .cta b{font-size:19px;letter-spacing:-.4px}#easyDash .cta p{margin:6px 0 0;color:var(--e-m);font-size:13.5px}" +
      "#easyDash .cta button{border:0;border-radius:999px;padding:12px 20px;font-weight:800;font-size:14px;background:var(--e-acc);color:#06241D;cursor:pointer}" +
      "#easyDash .mt{display:grid;grid-template-columns:1fr 1fr;gap:14px}#easyDash .cap{font-size:12.5px;font-weight:700;margin:0 0 4px}#easyDash .ld{color:var(--e-mm);font-size:13px;padding:14px 0}" +
      "@media(max-width:760px){#easyDash{padding:2px 12px 30px}#easyDash .g2,#easyDash .mt{grid-template-columns:1fr}#easyDash .ez-hi h1{font-size:22px}#easyDash .fam{grid-template-columns:repeat(2,minmax(0,1fr))}#easyDash .ez-c{padding:15px 14px 14px;border-radius:18px}#easyDash .wi .v{font-size:26px}}" +
      /* 사이드바 슬라이드 전환 */
      ".sb-mode{margin:2px 10px 10px;padding:4px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);display:flex;position:relative;user-select:none;cursor:pointer}" +
      "html[data-theme=light] .sb-mode{background:rgba(16,24,40,.05);border-color:rgba(16,24,40,.08)}" +
      ".sb-mode i{position:absolute;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:9px;background:linear-gradient(135deg,#f4f6fa,#aeb6c3 40%,#e9edf3);box-shadow:0 2px 8px rgba(0,0,0,.35);transition:transform .28s cubic-bezier(.4,0,.2,1)}" +
      ".sb-mode.easy i{transform:translateX(0)}.sb-mode:not(.easy) i{transform:translateX(100%)}" +
      ".sb-mode button{position:relative;z-index:1;flex:1;border:0;background:none;padding:7px 0;font-size:12px;font-weight:700;letter-spacing:.2px;color:#98A2B3;cursor:pointer;transition:color .2s}" +
      ".sb-mode.easy button[data-dm=easy],.sb-mode:not(.easy) button[data-dm=pro]{color:#0b0c0f}" +
      ".sb-mode-cap{margin:6px 14px 4px;font-size:10px;letter-spacing:.14em;color:#667085;text-transform:uppercase}";
    D.head.appendChild(s);
  }

  // ── 모드 ──
  function setMode(m, user) {
    var easy = m === "easy";
    H.classList.toggle("lux-easy", easy);
    try { localStorage.setItem(KEY, easy ? "easy" : "pro"); } catch (e) {}
    D.querySelectorAll(".sb-mode").forEach(function (el) { el.classList.toggle("easy", easy); el.setAttribute("aria-checked", easy ? "true" : "false"); });
    try { var ap = D.querySelector(".page.active"); if (typeof window.luxDz === "function") window.luxDz(ap ? ap.id.replace(/^page-/, "") : "dashboard"); } catch (e) {}   // 휴대폰: 초보자 = 원래 크기 · 전문가 = PC 축소 보기
    if (user) {
      var pg = D.querySelector(".page.active"); if (!pg || pg.id !== "page-dashboard") { try { if (typeof window.showPage === "function") window.showPage("dashboard"); } catch (e) {} }
      try { window.scrollTo(0, 0); } catch (e) {}
      if (!easy) { try { if (typeof window.refreshAll === "function") window.refreshAll(); } catch (e) {} setTimeout(function () { try { window.dispatchEvent(new Event("resize")); } catch (e) {} }, 60); }   // 숨어 있던 차트·지도 크기 다시 재기
    }
    if (easy) { mount(); load(); }
  }
  window.luxDashMode = { get: getMode, set: function (m) { setMode(m, true); } };

  function toggleHtml() {
    return '<div class="sb-mode-cap">대시보드</div><div class="sb-mode' + (getMode() === "easy" ? " easy" : "") + '" role="switch" tabindex="0" aria-label="대시보드 초보자 전문가 전환" aria-checked="' + (getMode() === "easy") + '"><i aria-hidden="true"></i><button type="button" data-dm="easy">초보자</button><button type="button" data-dm="pro">전문가</button></div>';
  }
  function mountToggle() {
    var nav = D.querySelector(".sidebar .sb-nav");
    if (nav && !nav.querySelector(".sb-mode")) { var w = D.createElement("div"); w.className = "sb-mode-w"; w.innerHTML = toggleHtml(); nav.insertBefore(w, nav.firstChild); }
    var dr = D.getElementById("mDrNav");   // 폰 메뉴(드로어) 맨 위에도
    if (dr && !dr.parentNode.querySelector(".sb-mode")) { var w2 = D.createElement("div"); w2.className = "sb-mode-w"; w2.innerHTML = toggleHtml(); dr.parentNode.insertBefore(w2, dr.previousSibling || dr); }
  }
  D.addEventListener("click", function (e) {
    var sw = e.target.closest && e.target.closest(".sb-mode"); if (!sw) return;
    e.preventDefault(); e.stopPropagation();
    var b = e.target.closest("button[data-dm]"), m = b ? b.getAttribute("data-dm") : (getMode() === "easy" ? "pro" : "easy");
    if (m !== getMode()) setMode(m, true); else if (!b) setMode(m === "easy" ? "pro" : "easy", true);
    try { var dr = D.querySelector(".m-drawer.show"); if (dr) { dr.classList.remove("show"); var sc = D.querySelector(".m-drawer-scrim"); if (sc) sc.classList.remove("show"); } } catch (e2) {}
  }, true);
  D.addEventListener("keydown", function (e) { var sw = e.target.closest && e.target.closest(".sb-mode"); if (sw && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setMode(getMode() === "easy" ? "pro" : "easy", true); } });

  // ── 데이터 ──
  function load(force) {
    if (busy) return; var now = Date.now();
    if (!force && ST && now - stAt < 30000) { draw(); return; }
    busy = true;
    fetch("/api/state").then(function (r) { return r.json(); }).then(function (j) { busy = false; if (j && j.watchlist) { ST = j; stAt = Date.now(); } draw(); }).catch(function () { busy = false; draw(); });
    pbGet();
  }
  function pbGet() {
    try { var c = JSON.parse(localStorage.getItem(PBK) || "null"); if (c && c.live && !PB) { PB = c; } if (c && c.ts) pbAt = c.ts; } catch (e) {}
    if (Date.now() - pbAt < 600000 && PB) return;
    pbAt = Date.now();
    fetch("/api/playbook").then(function (r) { return r.json(); }).then(function (j) { if (j && j.live) { PB = j; draw(); } }).catch(function () {});
  }
  function Q(sym) { var w = (ST && ST.watchlist) || []; for (var i = 0; i < w.length; i++) if (w[i].symbol === sym) return w[i]; return null; }
  function isKr(s) { return /\.(KS|KQ)$/.test(s); }
  function px(mk, v) { if (!(v > 0)) return "—"; return mk === "kr" ? "₩" + Math.round(v).toLocaleString() : "$" + (v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2)); }
  function pct(v) { if (typeof v !== "number" || !isFinite(v)) return "—"; return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "%"; }
  function cls(v) { return v > 0.005 ? "up" : v < -0.005 ? "dn" : "fl"; }
  function won(v) { v = Math.round(v); if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2).replace(/\.?0+$/, "") + "억 원"; if (Math.abs(v) >= 1e4) return Math.round(v / 1e4).toLocaleString() + "만 원"; return v.toLocaleString() + "원"; }
  function spark(a, up) {
    if (!a || a.length < 2) return "";
    var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), r = mx - mn || 1, W = 120, Hh = 30;
    var p = a.map(function (v, i) { return (i / (a.length - 1) * W).toFixed(1) + "," + (Hh - 2 - (v - mn) / r * (Hh - 4)).toFixed(1); }).join(" ");
    return '<svg viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + p + '" fill="none" stroke="' + (up ? "var(--e-up)" : "var(--e-dn)") + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
  }
  function idx(sym) { var a = (ST && ST.indices) || []; for (var i = 0; i < a.length; i++) if (a[i].symbol === sym) return a[i]; return null; }

  function weather(mk) {
    var ids = mk === "us" ? [["^GSPC", "S&P 500"], ["^IXIC", "나스닥"], ["^DJI", "다우"]] : [["^KS11", "코스피"], ["^KQ11", "코스닥"]];
    var L = ids.map(function (x) { return [x[1], idx(x[0])]; }).filter(function (x) { return x[1]; });
    var avg = L.length ? L.reduce(function (t, x) { return t + (x[1].dayPct || 0); }, 0) / L.length : 0;
    var w = avg >= 1.5 ? ["☀️", "아주 맑음", "대부분의 종목이 힘차게 올랐어요."] : avg >= 0.3 ? ["🌤️", "맑음", "오르는 종목이 더 많은 날이에요."] : avg > -0.3 ? ["⛅", "구름 조금", "크게 오르지도 내리지도 않은 잔잔한 날이에요."] : avg > -1.5 ? ["🌧️", "비", "내리는 종목이 더 많아요. 서두르지 않아도 괜찮아요."] : ["⛈️", "폭풍우", "시장 전체가 크게 내렸어요. 이런 날은 지켜보며 배우기 좋아요."];
    var open = ST && ST.marketStatus ? !!ST.marketStatus[mk] : false, ext = false;
    if (!open && mk === "us") { var nv = Q("NVDA"); ext = !!(nv && (nv.mstate === "PRE" || nv.mstate === "POST")); }
    var name = mk === "us" ? "미국 시장" : "한국 시장";
    return '<div class="ez-c"><div class="ez-h"><b>' + (mk === "us" ? "🇺🇸 " : "🇰🇷 ") + name + '</b><span>오늘의 시장 날씨</span></div>' +
      '<div class="wx"><span class="ic" aria-hidden="true">' + w[0] + '</span><div><div class="tt">' + w[1] + '</div><div class="ds">' + w[2] + "</div></div></div>" +
      '<span class="chip' + (open || ext ? " on" : "") + '"><i></i>' + (open ? "지금 열려 있어요" : ext ? "시간외 거래 중" : "지금은 닫혀 있어요") + "</span>" +
      '<div class="ix">' + L.map(function (x) { return "<div><s>" + esc(x[0]) + '</s><b class="' + cls(x[1].dayPct) + '">' + pct(x[1].dayPct) + "</b></div>"; }).join("") + "</div></div>";
  }
  function famCards() {
    return FAM.map(function (f) {
      var x = Q(f[0]); if (!x) return "";
      var mk = isKr(f[0]) ? "kr" : "us", nm = x.name || f[0], up = (x.dayPct || 0) >= 0;
      return '<button type="button" class="co" data-sym="' + esc(f[0]) + '"><span class="tp"><span class="av" style="background:' + f[2] + (f[2] === "#FEE500" ? ";color:#3A1D1D" : "") + '">' + esc((isEn() ? enName(nm) : nm).slice(0, 1)) + '</span><span style="min-width:0"><span class="nm" style="display:block">' + esc(nm) + '</span><span class="wh" style="display:block">' + esc(f[1]) + "</span></span></span>" +
        spark((x.spark || []).slice(-20), up) + '<span class="px"><b>' + px(mk, x.price) + '</b><span class="' + cls(x.dayPct) + '">' + pct(x.dayPct) + "</span></span></button>";
    }).join("");
  }
  function whatIf() {
    var opts = FAM.filter(function (f) { var x = Q(f[0]); return x && typeof x.ret1y === "number"; }).slice(0, 8);
    if (!opts.length) return '<div class="ld">불러오는 중…</div>';
    if (!opts.some(function (f) { return f[0] === whatSym; })) whatSym = opts[0][0];
    var x = Q(whatSym), r = x.ret1y, v = whatAmt * (1 + r / 100), d = v - whatAmt;
    return '<div class="seg" data-ws="1">' + opts.map(function (f) { var q = Q(f[0]); return '<button type="button" data-wsym="' + esc(f[0]) + '" class="' + (f[0] === whatSym ? "on" : "") + '">' + esc(q.name || f[0]) + "</button>"; }).join("") + "</div>" +
      '<div class="seg">' + [100000, 1000000, 10000000].map(function (a) { return '<button type="button" data-wamt="' + a + '" class="' + (a === whatAmt ? "on" : "") + '">' + T(won(a), wonEn(a)) + "</button>"; }).join("") + "</div>" +
      '<div class="tx">' + T("1년 전에 " + (x.name || whatSym) + "을(를) " + won(whatAmt) + "어치 샀다면, 지금은", "If you had bought " + wonEn(whatAmt) + " of " + enName(x.name || whatSym) + " a year ago, today it would be") + "</div>" +
      '<div class="wi"><span class="v ' + cls(r) + '">' + T(won(v), wonEn(v)) + '</span><span class="r ' + cls(r) + '">' + T((d >= 0 ? "+" : "−") + won(Math.abs(d)) + " (" + pct(r) + ")", (d >= 0 ? "+" : "−") + wonEn(Math.abs(d)) + " (" + pct(r) + ")") + "</span></div>" +
      '<div class="note"><span>지난 1년 주가만으로 계산(배당·환율·수수료 제외) · 과거 수익이 미래를 보장하지 않아요</span></div>';
  }
  function aiPicks() {
    var lv = PB && PB.live; if (!lv) return '<div class="ld">AI 후보를 불러오는 중…</div>';
    var h = "";
    ["us", "kr"].forEach(function (mk) {
      var it = ((lv[mk] && lv[mk].items) || []).filter(function (x) { return typeof x.q === "number" && x.px > 0 && !LEV.test(x.nm || "") && LEVS.indexOf(x.s) < 0; }).sort(function (a, b) { return b.q - a.q; }).slice(0, 3);
      h += '<div><div class="cap">' + (mk === "us" ? "🇺🇸 미국" : "🇰🇷 한국") + "</div>" + (it.length ? it.map(function (x, i) {
        return '<div class="rw" data-sym="' + esc(x.s) + '"><span class="rk">' + (i + 1) + '</span><span class="l"><b>' + esc(x.nm || x.s) + '</b><span>AI 점수 상위 ' + Math.max(1, Math.round((1 - x.q) * 100)) + "%</span></span>" +
          '<span class="r"><b>' + px(mk, x.px) + '</b><span class="' + cls(x.dp) + '">' + pct(x.dp) + "</span></span></div>";
      }).join("") : '<div class="ld">오늘은 후보가 없어요</div>') + "</div>";
    });
    return '<div class="mt">' + h + '</div><div class="note"><span>AI가 가격 흐름을 보고 매긴 순위예요 · 사라는 뜻이 아니에요 · 모의투자로 먼저 연습해 보세요</span></div>';
  }
  function movers() {
    var w = ((ST && ST.watchlist) || []).filter(function (x) { return !x.isEtf && typeof x.dayPct === "number" && x.price > 0 && x.mcap > 0 && !LEV.test(x.name || "") && LEVS.indexOf(x.symbol) < 0; });
    var big = w.slice().sort(function (a, b) { return (b.mcap || 0) - (a.mcap || 0); }).slice(0, 300);
    var up = big.slice().sort(function (a, b) { return b.dayPct - a.dayPct; }).slice(0, 4), dn = big.slice().sort(function (a, b) { return a.dayPct - b.dayPct; }).slice(0, 4);
    var row = function (x, i) { var mk = isKr(x.symbol) ? "kr" : "us"; return '<div class="rw" data-sym="' + esc(x.symbol) + '"><span class="rk">' + (i + 1) + '</span><span class="l"><b>' + esc(x.name || x.symbol) + "</b><span>" + (mk === "kr" ? "한국" : "미국") + '</span></span><span class="r"><b>' + px(mk, x.price) + '</b><span class="' + cls(x.dayPct) + '">' + pct(x.dayPct) + "</span></span></div>"; };
    if (!big.length) return '<div class="ld">불러오는 중…</div>';
    return '<div class="mt"><div><div class="cap up">▲ 많이 오른 회사</div>' + up.map(row).join("") + '</div><div><div class="cap dn">▼ 많이 내린 회사</div>' + dn.map(row).join("") + '</div></div><div class="note"><span>시가총액 상위 300곳 중 · 레버리지·ETF 제외</span></div>';
  }
  function term() {
    if (termI == null) { var d = new Date(); termI = (d.getFullYear() * 400 + (d.getMonth() + 1) * 31 + d.getDate()) % TERMS.length; }
    var t = TERMS[termI];
    return '<div class="tm">' + esc(t[0]) + '</div><div class="tx">' + esc(t[1]) + '</div><button type="button" class="tb" data-term="1">다른 용어 보기 →</button>';
  }
  function greet() {
    var h = new Date().getHours();
    return h < 6 ? "늦은 밤이에요" : h < 11 ? "좋은 아침이에요" : h < 17 ? "좋은 오후예요" : "좋은 저녁이에요";
  }

  function mount() {
    css();
    var pg = $("page-dashboard"); if (!pg) return null;
    var el = $("easyDash");
    if (!el) { el = D.createElement("div"); el.id = "easyDash"; pg.insertBefore(el, pg.firstChild); el.addEventListener("click", onClick); }
    return el;
  }
  function draw() {
    if (!H.classList.contains("lux-easy")) return;
    var el = mount(); if (!el) return;
    var keep = window.scrollY;
    el.innerHTML =
      '<div class="ez-hi"><div><h1>' + greet() + ' 👋<br><span style="color:var(--e-m);font-weight:600">오늘 주식시장은 이래요</span></h1><p>어려운 숫자 없이, 꼭 필요한 것만 모았어요.</p></div><button type="button" class="ez-pro" data-pro="1">전문가 화면 →</button></div>' +
      '<div class="ez-g">' +
        '<div class="ez-g g2">' + (ST ? weather("us") + weather("kr") : '<div class="ez-c"><div class="ld">시장 정보를 불러오는 중…</div></div>') + "</div>" +
        '<div class="ez-c"><div class="ez-h"><b>익숙한 회사들, 오늘은?</b><span>눌러서 자세히 보기</span></div><div class="fam">' + (ST ? famCards() : "") + "</div></div>" +
        '<div class="ez-g g2"><div class="ez-c"><div class="ez-h"><b>💡 만약 1년 전에 샀다면?</b><span>지난 1년</span></div>' + (ST ? whatIf() : '<div class="ld">불러오는 중…</div>') + '</div>' +
          '<div class="ez-c"><div class="ez-h"><b>📖 오늘의 주식 용어</b><span>하루 한 개</span></div>' + term() + "</div></div>" +
        '<div class="ez-c"><div class="ez-h"><b>🤖 AI가 오늘 눈여겨본 종목</b><span>매일 새로 계산</span></div>' + aiPicks() + "</div>" +
        '<div class="ez-c"><div class="ez-h"><b>🔥 오늘 많이 움직인 회사</b><span>어제 종가 대비</span></div>' + (ST ? movers() : '<div class="ld">불러오는 중…</div>') + "</div>" +
        '<div class="ez-c cta"><div><b>가상 1억 원으로 연습해 보세요</b><p>진짜 돈은 하나도 들지 않아요 · 사고팔기 · 손절 · 수익률 순위까지</p></div><button type="button" data-mine="1">모의투자 시작하기</button></div>' +
      "</div>";
    if (window.scrollY !== keep) try { window.scrollTo(0, keep); } catch (e) {}
  }
  function onClick(e) {
    var t = e.target.closest("[data-sym],[data-wsym],[data-wamt],[data-term],[data-pro],[data-mine]"); if (!t) return;
    if (t.hasAttribute("data-wsym")) { whatSym = t.getAttribute("data-wsym"); draw(); return; }
    if (t.hasAttribute("data-wamt")) { whatAmt = +t.getAttribute("data-wamt"); draw(); return; }
    if (t.hasAttribute("data-term")) { termI = ((termI || 0) + 1) % TERMS.length; draw(); return; }
    if (t.hasAttribute("data-pro")) { setMode("pro", true); return; }
    if (t.hasAttribute("data-mine")) { try { window.showPage("mine"); } catch (e2) {} return; }
    var s = t.getAttribute("data-sym"); if (s && typeof window.openDetailFromSym === "function") window.openDetailFromSym(s);
  }

  // 대시보드가 보일 때만 30초마다(관문이 CDN·묶음 처리 · 숨은 탭은 쉰다)
  setInterval(function () {
    if (D.hidden || !H.classList.contains("lux-easy")) return;
    var pg = D.querySelector(".page.active"); if (!pg || pg.id !== "page-dashboard") return;
    load();
  }, 30000);
  D.addEventListener("visibilitychange", function () { if (!D.hidden && H.classList.contains("lux-easy")) load(); });
  try { window.addEventListener("luxlang", function () { draw(); }); } catch (e) {}

  function boot() {
    css(); mountToggle();
    if (getMode() === "easy") setMode("easy", false);
    // 폰 메뉴는 나중에 만들어진다 — 생기면 스위치를 단다
    var tries = 0, iv = setInterval(function () { mountToggle(); if (++tries > 20 || D.getElementById("mDrNav")) { mountToggle(); clearInterval(iv); } }, 500);
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot); else boot();
})();
