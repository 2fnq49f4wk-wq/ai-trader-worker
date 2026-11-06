/* [V33.777] 재디자인(사용자 11/5 "너무 유치하다 · 주식앱임을 알 수 있게 · 지도도 넣어라 · 폰에서 메뉴 안 열고 전환") — 날씨 이모지·인사 대신
   지수 카드(값·등락·차트) · 상승/하락 종목 수 · 시장 지도(시총 크기·등락 색 · 미/한) · 인기 종목 표 · 시간외 표시. 폰은 상단 바에 전환 스위치.
   [V33.776] ★초보자용 대시보드★(사용자 11/5 "지금 화면은 전문가용으로 두고 주식 처음 하는 사람용 대시보드 하나 더 · 왼쪽 사이드바 슬라이드 전환")
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
  function getMode() { try { return localStorage.getItem(KEY) === "pro" ? "pro" : "easy"; } catch (e) { return "easy"; } }   // [V33.778] 처음 오는 사람은 초보자 화면부터(사용자 11/6) · 전문가를 고르면 그대로 기억
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
      "#easyDash{display:none;--e-bg:#0B0D11;--e-c:#13161B;--e-c2:#1A1E24;--e-bd:rgba(255,255,255,.07);--e-t:#F2F4F7;--e-m:#A0A8B6;--e-mm:#6B7383;--e-up:#F04452;--e-dn:#3182F6;--e-acc:#3DD6B5;color:var(--e-t);max-width:1240px;min-width:0;width:100%;box-sizing:border-box;grid-column:1/-1;margin:0 auto;padding:4px 2px 40px;font-variant-numeric:tabular-nums}" +
      "html[data-theme=light] #easyDash{--e-bg:#F4F6F9;--e-c:#FFFFFF;--e-c2:#F3F5F8;--e-bd:rgba(16,24,40,.09);--e-t:#101828;--e-m:#475467;--e-mm:#7A8496;--e-acc:#0E9F7E}" +
      "html.lux-easy #easyDash{display:block}html.lux-easy #page-dashboard>*:not(#easyDash){display:none!important}" +
      "#easyDash .hd{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:2px 2px 14px}#easyDash .hd h1{margin:0;font-size:24px;font-weight:800;letter-spacing:-.5px}#easyDash .hd p{margin:5px 0 0;color:var(--e-m);font-size:13px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}" +
      "#easyDash .st{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--e-m);background:var(--e-c2);border-radius:999px;padding:3px 10px}#easyDash .st i{width:6px;height:6px;border-radius:50%;background:var(--e-mm)}#easyDash .st.on i{background:var(--e-acc);box-shadow:0 0 0 3px rgba(61,214,181,.18)}#easyDash .st.ext i{background:#E2B93B}" +
      "#easyDash .pro{flex:none;background:none;border:1px solid var(--e-bd);color:var(--e-m);border-radius:10px;padding:8px 12px;font-size:12.5px;cursor:pointer}#easyDash .pro:hover{color:var(--e-t)}" +
      "#easyDash .g{display:grid;gap:12px;margin-top:12px}#easyDash .g2{grid-template-columns:repeat(2,minmax(0,1fr))}#easyDash .g32{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}" +
      "#easyDash .c{background:var(--e-c);border:1px solid var(--e-bd);border-radius:16px;padding:16px;min-width:0}" +
      "#easyDash .ch{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 10px;margin:0 0 12px}#easyDash .ch b{font-size:16px;font-weight:800;letter-spacing:-.3px}#easyDash .ch span{font-size:12px;color:var(--e-mm)}" +
      "#easyDash .ixs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}" +
      "#easyDash .ix{background:var(--e-c);border:1px solid var(--e-bd);border-radius:14px;padding:12px 12px 8px;min-width:0}#easyDash .ix .n{font-size:12px;color:var(--e-m);display:flex;justify-content:space-between}#easyDash .ix .v{font-size:19px;font-weight:800;margin-top:4px;letter-spacing:-.3px}#easyDash .ix .d{font-size:12.5px;font-weight:700;margin-top:1px}#easyDash .ix svg{display:block;width:100%;height:38px;margin-top:6px}" +
      "#easyDash .up{color:var(--e-up)}#easyDash .dn{color:var(--e-dn)}#easyDash .fl{color:var(--e-m)}" +
      "#easyDash .br{margin-top:10px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}#easyDash .bri{background:var(--e-c);border:1px solid var(--e-bd);border-radius:14px;padding:12px 14px}#easyDash .bri .t{display:flex;justify-content:space-between;font-size:12.5px;color:var(--e-m)}#easyDash .bri .t b{color:var(--e-t);font-size:13px}" +
      "#easyDash .bar{display:flex;height:8px;border-radius:4px;overflow:hidden;margin:8px 0 6px;background:var(--e-c2)}#easyDash .bar i{display:block;height:100%}#easyDash .bri .s{font-size:12.5px;color:var(--e-m)}" +
      "#easyDash .seg{display:inline-flex;background:var(--e-c2);border-radius:10px;padding:3px;gap:2px}#easyDash .seg button{border:0;background:none;color:var(--e-m);border-radius:8px;padding:5px 12px;font-size:12.5px;font-weight:600;cursor:pointer}#easyDash .seg button.on{background:var(--e-c);color:var(--e-t);box-shadow:0 1px 3px rgba(0,0,0,.25)}" +
      "#easyDash .map{position:relative;height:420px;border-radius:10px;overflow:hidden;background:var(--e-c2)}#easyDash .tl{position:absolute;box-sizing:border-box;border:1px solid var(--e-c);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;overflow:hidden;cursor:pointer;color:#fff;line-height:1.15;padding:2px}#easyDash .tl:hover{filter:brightness(1.15)}#easyDash .tl b{font-weight:800;white-space:nowrap}#easyDash .tl span{font-weight:600;opacity:.95}" +
      "#easyDash .lg{display:flex;align-items:center;gap:6px;justify-content:flex-end;margin-top:8px;font-size:11px;color:var(--e-mm)}#easyDash .lg i{width:22px;height:8px;border-radius:2px;display:inline-block}" +
      "#easyDash table{width:100%;border-collapse:collapse;table-layout:fixed}#easyDash td.p.w{width:96px}#easyDash td{padding:9px 4px;border-top:1px solid var(--e-bd);vertical-align:middle}#easyDash tr:first-child td{border-top:0}#easyDash tr[data-sym]{cursor:pointer}#easyDash tr[data-sym]:hover td{background:rgba(255,255,255,.02)}" +
      "#easyDash .lo{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#fff;flex:none}#easyDash .nmw{display:flex;align-items:center;gap:10px;min-width:0}#easyDash .nm{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#easyDash .sub{font-size:11.5px;color:var(--e-mm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#easyDash td.p{text-align:right;white-space:nowrap}#easyDash td.p b{display:block;font-size:14px}#easyDash td.p .x{font-size:11px;color:var(--e-mm)}#easyDash td.k{width:84px}#easyDash td.k svg{width:84px;height:26px;display:block}" +
      "#easyDash .pill{display:inline-block;min-width:66px;text-align:center;border-radius:7px;padding:4px 6px;font-size:12.5px;font-weight:700;color:#fff}#easyDash .pill.up{background:var(--e-up);color:#fff}#easyDash .pill.dn{background:var(--e-dn);color:#fff}#easyDash .pill.fl{background:var(--e-c2);color:var(--e-m)}" +
      "#easyDash .chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}#easyDash .chips button{border:1px solid var(--e-bd);background:none;color:var(--e-m);border-radius:8px;padding:5px 10px;font-size:12.5px;cursor:pointer}#easyDash .chips button.on{border-color:var(--e-t);color:var(--e-t);font-weight:700}" +
      "#easyDash .wv{font-size:28px;font-weight:800;letter-spacing:-.8px;margin-top:6px}#easyDash .wr{font-size:14px;font-weight:700;margin-left:8px}#easyDash .tx{color:var(--e-m);font-size:13.5px;line-height:1.6}#easyDash .note{font-size:11.5px;color:var(--e-mm);margin-top:10px;line-height:1.5}" +
      "#easyDash .tm{font-size:18px;font-weight:800;margin:0 0 6px}#easyDash .lnk{margin-top:10px;border:0;background:none;color:var(--e-acc);font-weight:700;font-size:12.5px;cursor:pointer;padding:0}" +
      "#easyDash .cap{font-size:12px;font-weight:700;color:var(--e-m);margin:2px 0 2px}#easyDash .ld{color:var(--e-mm);font-size:13px;padding:14px 0}" +
      "#easyDash .cta{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}#easyDash .cta b{font-size:16px}#easyDash .cta p{margin:4px 0 0;color:var(--e-m);font-size:13px}#easyDash .cta button{border:0;border-radius:10px;padding:11px 18px;font-weight:800;font-size:13.5px;background:var(--e-acc);color:#06241D;cursor:pointer}" +
      "#easyDash .olg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}#easyDash .olc{background:var(--e-c2);border-radius:12px;padding:12px}#easyDash .olh{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:15px}#easyDash .old{font-size:11.5px;color:var(--e-mm);margin:2px 0 6px}" +
      "#easyDash .olb{font-size:12.5px;font-weight:800;border-radius:7px;padding:3px 9px;background:rgba(127,140,160,.18);color:var(--e-m)}#easyDash .olb.pos,#easyDash .olb.pos1{background:rgba(240,68,82,.16);color:var(--e-up)}#easyDash .olb.neg,#easyDash .olb.neg1{background:rgba(49,130,246,.18);color:var(--e-dn)}" +
      "#easyDash .olc ul{margin:0;padding-left:16px;font-size:12.5px;color:var(--e-m);line-height:1.55}#easyDash .olc li{margin:2px 0}" +
      "@media(max-width:760px){#easyDash .olg{grid-template-columns:minmax(0,1fr)}#easyDash .ch .seg button{padding:5px 8px;font-size:12px}}" +
      "@media(max-width:1100px){#easyDash .ixs{grid-template-columns:repeat(3,minmax(0,1fr))}#easyDash .g32{grid-template-columns:minmax(0,1fr)}}" +
      "@media(max-width:760px){#easyDash{padding:0 12px 30px}#easyDash .g2,#easyDash .br{grid-template-columns:minmax(0,1fr)}#easyDash .hd h1{font-size:21px}#easyDash .ixs{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding-left:12px;margin:0 -12px;padding:0 12px 2px;scrollbar-width:none}#easyDash .ixs::-webkit-scrollbar{display:none}#easyDash .ix{flex:0 0 42%;scroll-snap-align:start}#easyDash .map{height:340px}#easyDash .c{padding:14px 12px;border-radius:14px}#easyDash td.k{display:none}#easyDash .wv{font-size:24px}}" +
      /* 사이드바 슬라이드 전환 */
      ".sb-mode{margin:2px 10px 10px;padding:4px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);display:flex;position:relative;user-select:none;cursor:pointer}" +
      "html[data-theme=light] .sb-mode{background:rgba(16,24,40,.05);border-color:rgba(16,24,40,.08)}" +
      ".sb-mode i{position:absolute;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:9px;background:linear-gradient(135deg,#f4f6fa,#aeb6c3 40%,#e9edf3);box-shadow:0 2px 8px rgba(0,0,0,.35);transition:transform .28s cubic-bezier(.4,0,.2,1)}" +
      ".sb-mode.easy i{transform:translateX(0)}.sb-mode:not(.easy) i{transform:translateX(100%)}" +
      ".sb-mode button{position:relative;z-index:1;flex:1;border:0;background:none;padding:7px 0;font-size:12px;font-weight:700;letter-spacing:.2px;color:#98A2B3;cursor:pointer;transition:color .2s}" +
      ".sb-mode.easy button[data-dm=easy],.sb-mode:not(.easy) button[data-dm=pro]{color:#0b0c0f}" +
      ".sb-mode-cap{margin:6px 14px 4px;font-size:10px;letter-spacing:.14em;color:#667085;text-transform:uppercase}" +
      ".m-appbar .m-ezsw{margin:0 6px 0 0;padding:3px;border-radius:10px;flex:none;width:92px}.m-appbar .m-ezsw i{top:3px;bottom:3px;left:3px;width:calc(50% - 3px);border-radius:7px}.m-appbar .m-ezsw button{padding:5px 0;font-size:11.5px}";
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
    var ab = D.querySelector(".m-appbar"), sr = D.getElementById("mAbSearch");   // [V33.777] 폰 상단 바 — 메뉴를 열지 않고 바로 전환
    if (ab && sr && !ab.querySelector(".sb-mode")) { var w3 = D.createElement("div"); w3.className = "sb-mode m-ezsw" + (getMode() === "easy" ? " easy" : ""); w3.setAttribute("role", "switch"); w3.setAttribute("tabindex", "0"); w3.setAttribute("aria-label", "대시보드 초보자 전문가 전환"); w3.innerHTML = '<i aria-hidden="true"></i><button type="button" data-dm="easy">초보</button><button type="button" data-dm="pro">전문</button>'; ab.insertBefore(w3, sr); }
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
    fetch("/api/state").then(function (r) { return r.json(); }).then(function (j) { busy = false; if (j && j.watchlist) { ST = j; stAt = Date.now(); window.__lastState = j; if (!window.__lastQuotesArr) window.__lastQuotesArr = j.watchlist; } draw(); }).catch(function () { busy = false; draw(); });
    pbGet();
  }
  function pbGet() {
    try { var c = JSON.parse(localStorage.getItem(PBK) || "null"); if (c && c.live && !PB) { PB = c; } if (c && c.ts) pbAt = c.ts; } catch (e) {}
    if (Date.now() - pbAt < 600000 && PB) return;
    pbAt = Date.now();
    fetch("/api/playbook").then(function (r) { return r.json(); }).then(function (j) { if (j && j.live) { PB = j; draw(); } }).catch(function () {});
  }
  function Q(sym) { var w = (ST && ST.watchlist) || []; if (!ST._m) { ST._m = {}; w.forEach(function (x) { ST._m[x.symbol] = x; }); } return ST._m[sym] || null; }
  function isKr(s) { return /\.(KS|KQ)$/.test(s); }
  function px(mk, v) { if (!(v > 0)) return "—"; return mk === "kr" ? "₩" + Math.round(v).toLocaleString() : "$" + (v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v.toFixed(2)); }
  function num(v, d) { return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(v) { if (typeof v !== "number" || !isFinite(v)) return "—"; return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "%"; }
  function cls(v) { return v > 0.005 ? "up" : v < -0.005 ? "dn" : "fl"; }
  function won(v) { v = Math.round(v); if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2).replace(/\.?0+$/, "") + "억 원"; if (Math.abs(v) >= 1e4) return Math.round(v / 1e4).toLocaleString() + "만 원"; return v.toLocaleString() + "원"; }
  function spark(a, up, W, Hh, fill) {
    if (!a || a.length < 2) return "";
    W = W || 120; Hh = Hh || 30;
    var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), r = mx - mn || 1, col = up ? "var(--e-up)" : "var(--e-dn)";
    var pts = a.map(function (v, i) { return [(i / (a.length - 1) * W).toFixed(1), (Hh - 2 - (v - mn) / r * (Hh - 4)).toFixed(1)]; });
    var p = pts.map(function (x) { return x.join(","); }).join(" ");
    return '<svg viewBox="0 0 ' + W + " " + Hh + '" preserveAspectRatio="none" aria-hidden="true">' + (fill ? '<polygon points="0,' + Hh + " " + p + " " + W + "," + Hh + '" fill="' + col + '" opacity=".10"/>' : "") + '<polyline points="' + p + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
  }
  function idx(sym) { var a = (ST && ST.indices) || []; for (var i = 0; i < a.length; i++) if (a[i].symbol === sym) return a[i]; return null; }
  function sess(mk) {   // 지금 장 상태: open | ext | closed
    if (ST && ST.marketStatus && ST.marketStatus[mk]) return "open";
    var probe = Q(mk === "us" ? "AAPL" : "005930.KS"); if (probe && (probe.mstate === "PRE" || probe.mstate === "POST")) return "ext";
    return "closed";
  }
  function sessTxt(mk) {
    var s = sess(mk), probe = Q(mk === "us" ? "AAPL" : "005930.KS"), pre = probe && probe.mstate === "PRE";
    return '<span class="st ' + (s === "open" ? "on" : s === "ext" ? "ext" : "") + '"><i></i>' + (mk === "us" ? "미국" : "한국") + " · " + (s === "open" ? "정규장" : s === "ext" ? (pre ? "프리마켓" : "애프터마켓") : "장 마감") + "</span>";
  }
  function ixTiles() {
    var L = [["^GSPC", "S&P 500"], ["^IXIC", "나스닥"], ["^DJI", "다우존스"], ["^KS11", "코스피"], ["^KQ11", "코스닥"]];
    return '<div class="ixs">' + L.map(function (x) {
      var q = idx(x[0]); if (!q) return "";
      var ch = q.price - (q.prevClose || q.price), h = (q.history || []).slice(-40);
      return '<div class="ix"><div class="n"><span>' + esc(x[1]) + "</span><span>" + (q.region === "kr" ? "🇰🇷" : "🇺🇸") + '</span></div><div class="v">' + num(q.price, 2) + '</div><div class="d ' + cls(q.dayPct) + '">' + (ch >= 0 ? "▲ " : "▼ ") + num(Math.abs(ch), 2) + " (" + pct(q.dayPct) + ")</div>" + spark(h, (q.dayPct || 0) >= 0, 160, 38, true) + "</div>";
    }).join("") + "</div>";
  }
  function breadth(mk) {
    var w = ((ST && ST.watchlist) || []).filter(function (x) { return x.market === mk && !x.isEtf && typeof x.dayPct === "number"; });
    var up = 0, dn = 0; w.forEach(function (x) { if (x.dayPct > 0.005) up++; else if (x.dayPct < -0.005) dn++; });
    var n = w.length || 1, fl = n - up - dn, r = up / Math.max(1, up + dn);
    var line = r >= 0.65 ? "오르는 종목이 훨씬 많은 날이에요" : r >= 0.52 ? "오르는 종목이 조금 더 많아요" : r > 0.48 ? "오르는 종목과 내리는 종목이 비슷해요" : r > 0.35 ? "내리는 종목이 조금 더 많아요" : "내리는 종목이 훨씬 많은 날이에요";
    return '<div class="bri"><div class="t"><b>' + (mk === "us" ? "🇺🇸 미국" : "🇰🇷 한국") + "</b>" + T("상승 " + up + " · 하락 " + dn + " · 보합 " + fl, "Up " + up + " · Down " + dn + " · Flat " + fl) + '</div><div class="bar"><i style="width:' + (up / n * 100).toFixed(1) + '%;background:var(--e-up)"></i><i style="width:' + (fl / n * 100).toFixed(1) + '%;background:var(--e-mm);opacity:.4"></i><i style="width:' + (dn / n * 100).toFixed(1) + '%;background:var(--e-dn)"></i></div><div class="s">' + esc(line) + "</div></div>";
  }
  // ── 시장 지도(정사각형 근사 트리맵 · 시총 = 넓이 · 등락 = 색) ──
  var mapMk = "us";
  function squarify(items, x, y, w, h, out) {
    if (!items.length) return;
    if (items.length === 1) { out.push({ it: items[0], x: x, y: y, w: w, h: h }); return; }
    var tot = items.reduce(function (t, a) { return t + a.v; }, 0), side = Math.min(w, h), row = [], rs = 0, best = Infinity, i = 0;
    var worst = function (r, s) { var mx = 0, mn = Infinity; r.forEach(function (a) { mx = Math.max(mx, a.v); mn = Math.min(mn, a.v); }); var k = (w * h) / tot, S = s * k; return Math.max(side * side * mx * k / (S * S), S * S / (side * side * mn * k)); };
    for (; i < items.length; i++) { var nr = row.concat([items[i]]), ns = rs + items[i].v, wv = worst(nr, ns); if (wv > best) break; row = nr; rs = ns; best = wv; }
    var frac = rs / tot;
    if (w >= h) { var rw = w * frac, yy = y; row.forEach(function (a) { var hh = h * a.v / rs; out.push({ it: a, x: x, y: yy, w: rw, h: hh }); yy += hh; }); squarify(items.slice(i), x + rw, y, w - rw, h, out); }
    else { var rh = h * frac, xx = x; row.forEach(function (a) { var ww = w * a.v / rs; out.push({ it: a, x: xx, y: y, w: ww, h: rh }); xx += ww; }); squarify(items.slice(i), x, y + rh, w, h - rh, out); }
  }
  function tileCol(p) {
    var t = Math.max(-1, Math.min(1, (p || 0) / 3)), a = Math.abs(t);
    if (Math.abs(p || 0) < 0.05) return "#3A3F48";
    var c = t > 0 ? [240, 68, 82] : [49, 130, 246], b = [58, 63, 72];
    return "rgb(" + [0, 1, 2].map(function (k) { return Math.round(b[k] + (c[k] - b[k]) * (0.35 + 0.65 * a)); }).join(",") + ")";
  }
  function mapHtml() {
    return '<div class="c"><div class="ch"><b>시장 지도</b><span class="seg" data-mapseg="1"><button type="button" data-mapmk="us" class="' + (mapMk === "us" ? "on" : "") + '">미국</button><button type="button" data-mapmk="kr" class="' + (mapMk === "kr" ? "on" : "") + '">한국</button></span></div>' +
      '<div class="map" id="ezMap"></div><div class="lg"><span>' + T("네모 크기 = 회사 크기(시가총액) · 색 = 오늘 등락", "Box size = company size (market cap) · color = today's move") + '</span><i style="background:' + tileCol(-3) + '"></i><span>−3%</span><i style="background:#3A3F48"></i><span>0</span><i style="background:' + tileCol(3) + '"></i><span>+3%</span></div></div>';
  }
  function drawMap() {
    var el = $("ezMap"); if (!el || !ST) return;
    var W = el.clientWidth, Hh = el.clientHeight; if (!(W > 0)) return;
    var n = W < 500 ? 30 : 60;
    var w = ((ST && ST.watchlist) || []).filter(function (x) { return x.market === mapMk && !x.isEtf && x.mcap > 0 && x.price > 0; }).sort(function (a, b) { return b.mcap - a.mcap; }).slice(0, n);
    var items = w.map(function (x) { return { v: Math.sqrt(x.mcap), q: x }; }), out = [];   // 제곱근 — 초대형 몇 개가 화면을 다 먹지 않게
    squarify(items, 0, 0, W, Hh, out);
    var en = isEn();
    el.innerHTML = out.map(function (o) {
      var q = o.it.q, a = o.w * o.h, fs = Math.max(9, Math.min(22, Math.sqrt(a) / 6)), lab = mapMk === "kr" ? (en ? enName(q.name || q.symbol) : (q.name || q.symbol)) : q.symbol;
      var show = o.w > 34 && o.h > 22;
      return '<div class="tl" data-sym="' + esc(q.symbol) + '" title="' + esc((q.name || q.symbol) + " " + pct(q.dayPct)) + '" style="left:' + o.x.toFixed(1) + "px;top:" + o.y.toFixed(1) + "px;width:" + o.w.toFixed(1) + "px;height:" + o.h.toFixed(1) + "px;background:" + tileCol(q.dayPct) + '">' +
        (show ? '<b data-noi18n style="font-size:' + fs.toFixed(0) + 'px">' + esc(lab) + '</b>' + (o.h > 36 ? '<span style="font-size:' + Math.max(9, fs * 0.72).toFixed(0) + 'px">' + pct(q.dayPct) + "</span>" : "") : "") + "</div>";
    }).join("");
  }
  function extOf(q) {
    if (!q) return "";
    if (q.dispSess === "day" && q.ovn > 0 && typeof q.ovnPct === "number") return '<div class="x">' + T("데이마켓 " + pct(q.ovnPct), "Overnight " + pct(q.ovnPct)) + "</div>";
    if (q.mstate === "POST" && q.post > 0 && typeof q.postPct === "number") return '<div class="x">' + T("애프터 " + pct(q.postPct), "After hours " + pct(q.postPct)) + "</div>";
    if (q.mstate === "PRE" && q.pre > 0 && typeof q.prePct === "number") return '<div class="x">' + T("프리 " + pct(q.prePct), "Pre-market " + pct(q.prePct)) + "</div>";
    return "";
  }
  function popular() {
    var rows = FAM.map(function (f) {
      var x = Q(f[0]); if (!x) return "";
      var mk = isKr(f[0]) ? "kr" : "us", nm = x.name || f[0];
      return '<tr data-sym="' + esc(f[0]) + '"><td><div class="nmw"><span class="lo" style="background:' + f[2] + (f[2] === "#FEE500" ? ";color:#3A1D1D" : "") + '">' + esc((isEn() ? enName(nm) : nm).slice(0, 1)) + '</span><div style="min-width:0"><div class="nm">' + esc(nm) + '</div><div class="sub">' + esc(f[1]) + '</div></div></div></td><td class="k">' + spark((x.spark || []).slice(-20), (x.dayPct || 0) >= 0, 84, 26) + '</td><td class="p w"><b>' + px(mk, x.price) + "</b>" + extOf(x) + '</td><td class="p" style="width:80px"><span class="pill ' + cls(x.dayPct) + '">' + pct(x.dayPct) + "</span></td></tr>";
    }).filter(Boolean);
    var half = Math.ceil(rows.length / 2);
    return '<div class="g g2" style="margin-top:0;gap:0 24px"><table>' + rows.slice(0, half).join("") + "</table><table>" + rows.slice(half).join("") + "</table></div>";
  }
  function whatIf() {
    var opts = FAM.filter(function (f) { var x = Q(f[0]); return x && typeof x.ret1y === "number"; }).slice(0, 8);
    if (!opts.length) return '<div class="ld">불러오는 중…</div>';
    if (!opts.some(function (f) { return f[0] === whatSym; })) whatSym = opts[0][0];
    var x = Q(whatSym), r = x.ret1y, v = whatAmt * (1 + r / 100), d = v - whatAmt;
    return '<div class="chips">' + opts.map(function (f) { var q = Q(f[0]); return '<button type="button" data-wsym="' + esc(f[0]) + '" class="' + (f[0] === whatSym ? "on" : "") + '">' + esc(q.name || f[0]) + "</button>"; }).join("") + "</div>" +
      '<div class="chips">' + [100000, 1000000, 10000000].map(function (a) { return '<button type="button" data-wamt="' + a + '" class="' + (a === whatAmt ? "on" : "") + '">' + T(won(a), wonEn(a)) + "</button>"; }).join("") + "</div>" +
      '<div class="tx">' + T("1년 전에 " + (x.name || whatSym) + "을(를) " + won(whatAmt) + "어치 샀다면, 지금은", "If you had bought " + wonEn(whatAmt) + " of " + enName(x.name || whatSym) + " a year ago, today it would be") + "</div>" +
      '<div><span class="wv ' + cls(r) + '">' + T(won(v), wonEn(v)) + '</span><span class="wr ' + cls(r) + '">' + T((d >= 0 ? "+" : "−") + won(Math.abs(d)) + " (" + pct(r) + ")", (d >= 0 ? "+" : "−") + wonEn(Math.abs(d)) + " (" + pct(r) + ")") + "</span></div>" +
      '<div class="note"><span>지난 1년 주가만으로 계산(배당·환율·수수료 제외) · 과거 수익이 미래를 보장하지 않아요</span></div>';
  }
  function rowsOf(list, sub) {
    return "<table>" + list.map(function (x, i) {
      var mk = x.mk; return '<tr data-sym="' + esc(x.s) + '"><td style="width:22px;color:var(--e-mm);font-weight:700">' + (i + 1) + '</td><td><div class="nm">' + esc(x.nm) + '</div><div class="sub">' + sub(x) + '</div></td><td class="p w"><b>' + px(mk, x.px) + '</b></td><td class="p" style="width:80px"><span class="pill ' + cls(x.dp) + '">' + pct(x.dp) + "</span></td></tr>";
    }).join("") + "</table>";
  }
  function aiPicks() {
    var lv = PB && PB.live; if (!lv) return '<div class="ld">AI 후보를 불러오는 중…</div>';
    var h = "";
    ["us", "kr"].forEach(function (mk) {
      var it = ((lv[mk] && lv[mk].items) || []).filter(function (x) { return typeof x.q === "number" && x.px > 0 && !LEV.test(x.nm || "") && LEVS.indexOf(x.s) < 0; }).sort(function (a, b) { return b.q - a.q; }).slice(0, 3)
        .map(function (x) { var q = Q(x.s); return { s: x.s, nm: x.nm || x.s, px: q ? q.price : x.px, dp: q ? q.dayPct : x.dp, q: x.q, mk: mk }; });
      h += '<div><div class="cap">' + (mk === "us" ? "🇺🇸 미국" : "🇰🇷 한국") + "</div>" + (it.length ? rowsOf(it, function (x) { return T("AI 점수 상위 " + Math.max(1, Math.round((1 - x.q) * 100)) + "%", "AI score top " + Math.max(1, Math.round((1 - x.q) * 100)) + "%"); }) : '<div class="ld">오늘은 후보가 없어요</div>') + "</div>";
    });
    return '<div class="g g2" style="margin-top:0;gap:0 24px">' + h + '</div><div class="note"><span>AI가 가격 흐름을 보고 매긴 순위예요 · 사라는 뜻이 아니에요 · 모의투자로 먼저 연습해 보세요</span></div>';
  }
  function movers() {
    var w = ((ST && ST.watchlist) || []).filter(function (x) { return !x.isEtf && typeof x.dayPct === "number" && x.price > 0 && x.mcap > 0 && !LEV.test(x.name || "") && LEVS.indexOf(x.symbol) < 0; });
    var big = w.slice().sort(function (a, b) { return (b.mcap || 0) - (a.mcap || 0); }).slice(0, 300);
    if (!big.length) return '<div class="ld">불러오는 중…</div>';
    var m = function (x) { return { s: x.symbol, nm: x.name || x.symbol, px: x.price, dp: x.dayPct, mk: isKr(x.symbol) ? "kr" : "us" }; };
    var up = big.slice().sort(function (a, b) { return b.dayPct - a.dayPct; }).slice(0, 4).map(m), dn = big.slice().sort(function (a, b) { return a.dayPct - b.dayPct; }).slice(0, 4).map(m);
    var sub = function (x) { return x.mk === "kr" ? "한국" : "미국"; };
    return '<div class="g g2" style="margin-top:0;gap:0 24px"><div><div class="cap up">▲ 상승 상위</div>' + rowsOf(up, sub) + '</div><div><div class="cap dn">▼ 하락 상위</div>' + rowsOf(dn, sub) + '</div></div><div class="note"><span>시가총액 상위 300곳 중 · 레버리지·ETF 제외</span></div>';
  }
  // ── [V33.778] AI 업종 전망(단기·중기·장기) — outlook.js 규칙 엔진 ──
  var olKey = "semis", olOpen = false;
  function outlookCard() {
    var L = window.luxOutlook; if (!L || !ST) return "";
    var B = L.BASKETS, mk = B[olKey].mk, rg = PB && PB.markets && PB.markets[mk] && PB.markets[mk].regime, o = L.basket(olKey, ST, rg);
    var tabs = '<span class="seg">' + Object.keys(B).map(function (k) { return '<button type="button" data-olk="' + k + '" class="' + (k === olKey ? "on" : "") + '">' + esc(B[k].ko) + "</button>"; }).join("") + "</span>";
    if (!o) return '<div class="c" style="margin-top:12px"><div class="ch"><b>AI 업종 전망</b>' + tabs + '</div><div class="ld">불러오는 중…</div></div>';
    var col = function (k, t, d) { var v = o[k], w = olOpen ? v.why : v.why.slice(0, 2);
      return '<div class="olc"><div class="olh"><span>' + t + '</span><span class="olb ' + v.cls + '">' + v.label + '</span></div><div class="old">' + d + '</div><ul>' + w.map(function (x) { return "<li>" + L.whyHtml(x, esc) + "</li>"; }).join("") + "</ul></div>"; };
    return '<div class="c" style="margin-top:12px"><div class="ch"><b>AI 업종 전망</b>' + tabs + '</div><div class="olg">' + col("s", "단기", "1~4주") + col("m", "중기", "1~6개월") + col("l", "장기", "1년 이상") + "</div>" +
      '<div class="note"><button type="button" class="lnk" data-olopen="1" style="margin:0 10px 0 0">' + (olOpen ? "근거 접기" : "근거 모두 보기") + "</button><span>" + o.n + "종목 평균 · 가격·추세·시장 흐름 규칙으로 계산(재무는 아직 반영 안 함) · 투자 권유가 아니에요</span></div></div>";
  }
  function term() {
    if (termI == null) { var d = new Date(); termI = (d.getFullYear() * 400 + (d.getMonth() + 1) * 31 + d.getDate()) % TERMS.length; }
    var t = TERMS[termI];
    return '<div class="tm">' + esc(t[0]) + '</div><div class="tx">' + esc(t[1]) + '</div><button type="button" class="lnk" data-term="1">다음 용어 →</button>';
  }
  function today() {
    var d = new Date(), wk = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return T((d.getMonth() + 1) + "월 " + d.getDate() + "일 (" + wk + ")", d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
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
    if (ST) ST._m = null;
    var keep = window.scrollY;
    var L = '<div class="ld">불러오는 중…</div>';
    el.innerHTML =
      '<div class="hd"><div><h1>오늘의 시장</h1><p>' + today() + (ST ? sessTxt("us") + sessTxt("kr") : "") + '</p></div><button type="button" class="pro" data-pro="1">전문가 화면 →</button></div>' +
      (ST ? ixTiles() + '<div class="br">' + breadth("us") + breadth("kr") + "</div>" : '<div class="c">' + L + "</div>") +
      '<div class="g g32">' + mapHtml() +
        '<div class="c"><div class="ch"><b>1년 전에 투자했다면</b><span>지난 1년</span></div>' + (ST ? whatIf() : L) + '<div style="border-top:1px solid var(--e-bd);margin:14px 0 12px"></div><div class="ch" style="margin-bottom:8px"><b>오늘의 투자 용어</b><span>하루 한 개</span></div>' + term() + "</div></div>" +
      outlookCard() +
      '<div class="c" style="margin-top:12px"><div class="ch"><b>인기 종목</b><span>누르면 차트·주문</span></div>' + (ST ? popular() : L) + "</div>" +
      '<div class="g g2"><div class="c"><div class="ch"><b>AI 관심 종목</b><span>매일 새로 계산</span></div>' + aiPicks() + '</div><div class="c"><div class="ch"><b>오늘의 급등·급락</b><span>전일 종가 대비</span></div>' + (ST ? movers() : L) + "</div></div>" +
      '<div class="c cta" style="margin-top:12px"><div><b>가상 1억 원으로 모의투자</b><p>실제 돈 없이 사고팔기 · 손절 · 수익률 순위까지 연습해 보세요</p></div><button type="button" data-mine="1">모의투자 시작하기</button></div>';
    drawMap();
    if (window.scrollY !== keep) try { window.scrollTo(0, keep); } catch (e) {}
  }
  function onClick(e) {
    var t = e.target.closest("[data-sym],[data-wsym],[data-wamt],[data-term],[data-pro],[data-mine],[data-mapmk],[data-olk],[data-olopen]"); if (!t) return;
    if (t.hasAttribute("data-olk")) { olKey = t.getAttribute("data-olk"); draw(); return; }
    if (t.hasAttribute("data-olopen")) { olOpen = !olOpen; draw(); return; }
    if (t.hasAttribute("data-mapmk")) { mapMk = t.getAttribute("data-mapmk"); draw(); return; }
    if (t.hasAttribute("data-wsym")) { whatSym = t.getAttribute("data-wsym"); draw(); return; }
    if (t.hasAttribute("data-wamt")) { whatAmt = +t.getAttribute("data-wamt"); draw(); return; }
    if (t.hasAttribute("data-term")) { termI = ((termI || 0) + 1) % TERMS.length; draw(); return; }
    if (t.hasAttribute("data-pro")) { setMode("pro", true); return; }
    if (t.hasAttribute("data-mine")) { try { window.showPage("mine"); } catch (e2) {} return; }
    var s = t.getAttribute("data-sym"); if (s && typeof window.openDetailFromSym === "function") window.openDetailFromSym(s);
  }
  var rzT = 0; window.addEventListener("resize", function () { if (!H.classList.contains("lux-easy")) return; clearTimeout(rzT); rzT = setTimeout(drawMap, 150); });

  // 대시보드가 보일 때만 30초마다(관문이 CDN·묶음 처리 · 숨은 탭은 쉰다)
  setInterval(function () {
    if (D.hidden || !H.classList.contains("lux-easy")) return;
    var pg = D.querySelector(".page.active"); if (!pg || pg.id !== "page-dashboard") return;
    load();
  }, 30000);
  D.addEventListener("visibilitychange", function () { if (!D.hidden && H.classList.contains("lux-easy")) load(); });
  var _qT = 0; window.addEventListener("lux:quotes", function () { if (!H.classList.contains("lux-easy") || Date.now() - _qT < 5000) return; var pg = D.querySelector(".page.active"); if (!pg || pg.id !== "page-dashboard" || !ST) return; _qT = Date.now();   // [V33.780] 데이마켓 실시간
    var m = {}; (window.__lastQuotesArr || []).forEach(function (x) { m[x.symbol] = x; }); (ST.watchlist || []).forEach(function (x, i) { var y = m[x.symbol]; if (y && y.dispSess === "day") ST.watchlist[i] = y; }); draw(); });

  function boot() {
    css(); mountToggle();
    if (getMode() === "easy") setMode("easy", false);
    // 폰 상단 바·메뉴는 나중에 만들어진다 — 생기면 스위치를 단다
    var tries = 0, iv = setInterval(function () { mountToggle(); if (++tries > 20 || (D.getElementById("mDrNav") && D.querySelector(".m-appbar"))) { mountToggle(); clearInterval(iv); } }, 500);
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot); else boot();
})();
