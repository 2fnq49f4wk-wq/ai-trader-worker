/* [V33.838] 종목 상세 · 호가·체결 창 — 사용자 11/13 "실시간 체결·호가창 데이터 무료로 연결 · AI 가 물량 보고 판단".
   한국 = 매도·매수 10단계 잔량(네이버) · 미국 = 최우선 매수·매도 호가 + 최근 체결(나스닥). 미국 10단계 호가는 무료 원천이 없다.
   비용: 종목 상세가 보이는 동안만 5초에 한 번 /api/orderbook(서버 swrJson 5초 — 같은 종목을 여러 명이 봐도 원천 요청은 5초에 한 번). */
(function () {
  var D = document, sym = null, timer = 0, last = null;
  function el(id) { return D.getElementById(id); }
  function isKr(s) { return /\.(KS|KQ)$/.test(s || ""); }
  function fmtP(v, kr) { if (!(v > 0)) return "—"; return kr ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }); }
  function fmtQ(v) { v = Math.round(v || 0); return v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e4 ? (v / 1e3).toFixed(0) + "K" : v.toLocaleString(); }
  function css() {
    if (el("luxObCss")) return;
    var st = D.createElement("style"); st.id = "luxObCss";
    st.textContent = "#detailOB{margin:0 0 14px}#detailOB .obh{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:0 0 8px}#detailOB .obh b{font-size:14px}#detailOB .obh span{font-size:11.5px;color:var(--t3,#8a94a6);white-space:nowrap}" +
      "#detailOB .obg{display:grid;grid-template-columns:1fr auto 1fr;font:12.5px/1.5 var(--mono,ui-monospace,monospace);border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}" +
      "#detailOB .obr{display:contents}#detailOB .obr>i{font-style:normal;padding:2px 8px;position:relative;white-space:nowrap}#detailOB .obr .q{text-align:right}#detailOB .obr .p{text-align:center;font-weight:700;padding:2px 10px}" +
      "#detailOB .obr.a .p{color:#6EA8FF}#detailOB .obr.b .p{color:#FF7A7F}#detailOB .obr .q b{position:absolute;top:2px;bottom:2px;opacity:.22;border-radius:3px}#detailOB .obr.a .q b{right:0;background:#3B82F6}#detailOB .obr.b .q b{left:0;background:#E5484D}#detailOB .obr.b .q{text-align:left}" +
      "#detailOB .obr.a .q span,#detailOB .obr.b .q span{position:relative}#detailOB .obr.w .p{outline:1px dashed rgba(255,200,80,.7);outline-offset:-2px}" +
      "#detailOB .obs{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;margin:8px 0 0;color:var(--t2,#c9d1dc)}#detailOB .obs b{font-weight:700}#detailOB .obn{font-size:11.5px;color:var(--t3,#8a94a6);margin-top:6px;line-height:1.45}" +
      "#detailOB .obt{margin-top:10px;font:12px/1.55 var(--mono,ui-monospace,monospace);max-height:220px;overflow:auto}#detailOB .obt div{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}#detailOB .obt div span:nth-child(2),#detailOB .obt div span:nth-child(3){text-align:right}" +
      "#detailOB .obt .h{color:var(--t3,#8a94a6);font-size:11px}#detailOB .up{color:#FF7A7F}#detailOB .dn{color:#6EA8FF}" +
      "html[data-theme=light] #detailOB .obg{border-color:rgba(16,24,40,.12)}";
    D.head.appendChild(st);
  }
  function host() {
    var h = el("detailOB"); if (h) return h;
    var side = D.querySelector("#page-detail .detail-side"); if (!side) return null;
    h = D.createElement("div"); h.id = "detailOB"; h.className = "detail-vcard";
    var info = el("luxInfo");
    if (Math.min(innerWidth, screen.width || 9999) <= 900) { var a = info && info.parentNode !== side ? info : side; a.parentNode.insertBefore(h, a.nextSibling === side ? side : a.nextSibling); }   // 폰·패드 세로: 오른쪽 열이 숨는다 → AI 분석 바로 밑(없으면 오른쪽 열 자리)
    else side.insertBefore(h, side.firstChild);
    return h;
  }
  function draw(j) {
    var h = host(); if (!h) return; css();
    if (!h.offsetParent && h.parentNode && h.parentNode.classList.contains("detail-side")) { h.remove(); h = host(); if (!h) return; }   // 오른쪽 열이 숨은 배치(폰)면 보이는 자리로 옮긴다
    var kr = isKr(sym);
    if (!j || j.ok === false) { h.innerHTML = '<div class="obh"><b>호가 · 체결</b><span>받지 못함</span></div>'; return; }
    var sg = j.sig || null, ask = j.ask || [], bid = j.bid || [], hd = '<div class="obh"><b>호가 · 체결</b><span>' + (kr ? "10단계 · 네이버" : "최우선 호가 · 나스닥") + " · 5초</span></div>";
    if (!ask.length && !bid.length && !(j.trades && j.trades.length)) { h.innerHTML = hd + '<div class="obn">지금은 호가가 비어 있습니다(장 시작 전·마감 후). ' + (kr ? "정규장 09:00~15:30 에 10단계 잔량이 들어옵니다." : "프리·정규·애프터 시간에 최우선 호가와 체결이 들어옵니다.") + "</div>"; return; }
    var mx = 1; ask.concat(bid).forEach(function (x) { if (x[1] > mx) mx = x[1]; });
    var g = '<div class="obg">';
    ask.slice().reverse().forEach(function (x) { var w = sg && sg.wall === x[0] && kr; g += '<div class="obr a' + (w ? " w" : "") + '"><i class="q"><b style="width:' + (x[1] / mx * 100).toFixed(1) + '%"></b><span>' + fmtQ(x[1]) + '</span></i><i class="p">' + fmtP(x[0], kr) + "</i><i></i></div>"; });
    bid.forEach(function (x) { g += '<div class="obr b"><i></i><i class="p">' + fmtP(x[0], kr) + '</i><i class="q"><b style="width:' + (x[1] / mx * 100).toFixed(1) + '%"></b><span>' + fmtQ(x[1]) + "</span></i></div>"; });
    g += "</div>";
    var s = '<div class="obs">';
    if (kr) s += "<span>총 매도 <b>" + fmtQ(j.totAsk) + "</b></span><span>총 매수 <b>" + fmtQ(j.totBid) + "</b></span>";
    if (sg && sg.imb != null) s += '<span>매수 잔량 <b class="' + (sg.imb >= 0.5 ? "up" : "dn") + '">' + Math.round(sg.imb * 100) + "%</b></span>";
    if (sg && sg.near != null && kr) s += "<span>가까운 3단계 매도/매수 <b>" + sg.near + "배</b></span>";
    if (sg && sg.spread != null) s += "<span>호가 간격 <b>" + sg.spread + "%</b></span>";
    s += "</div>";
    var note = "";
    if (sg && kr) {
      var heavy = (sg.near != null && sg.near >= 3) || (sg.imb != null && sg.imb <= 0.25);
      note = heavy ? "위쪽에 매도 물량이 두껍습니다(" + (sg.wall ? fmtP(sg.wall, true) + "원 " + fmtQ(sg.wallQ) + "주" : "") + "). 올라가려면 이 물량을 소화해야 합니다." :
        (sg.imb != null && sg.imb >= 0.65 ? "아래쪽 매수 대기 물량이 더 많습니다." : "매수·매도 물량이 비슷합니다.");
    }
    note += (note ? " " : "") + "AI 는 매수 직전에 이 호가를 확인해 기록합니다(관측 단계 — 성과 검증 뒤 매도벽 관문으로 씁니다).";
    var t = "";
    if (j.trades && j.trades.length) {
      t = '<div class="obt"><div class="h"><span>체결 시각</span><span>가격</span><span>수량</span></div>';
      j.trades.slice(0, 20).forEach(function (x, i) { var nx = j.trades[i + 1], c = nx ? (x[1] > nx[1] ? "up" : x[1] < nx[1] ? "dn" : "") : ""; t += '<div><span>' + String(x[0]).replace(/^0/, "") + '</span><span class="' + c + '">' + fmtP(x[1], kr) + "</span><span>" + fmtQ(x[2]) + "</span></div>"; });
      t += "</div>";
    }
    h.innerHTML = hd + (ask.length || bid.length ? g : "") + s + '<div class="obn">' + note + "</div>" + t;
  }
  function visible() { var p = el("page-detail"); return p && p.classList.contains("active") && !D.hidden; }
  function pull() {
    if (!sym || !visible()) return;
    var s0 = sym;
    fetch("/api/orderbook?symbol=" + encodeURIComponent(s0)).then(function (r) { return r.json(); }).then(function (j) { if (s0 !== sym) return; last = j; draw(j); }).catch(function () {});
  }
  function open(s) {
    if (!s || s.charAt(0) === "^") { var h0 = el("detailOB"); if (h0) h0.innerHTML = ""; sym = null; return; }
    sym = s; last = null;
    var h = host(); if (h) { css(); h.innerHTML = '<div class="obh"><b>호가 · 체결</b><span>불러오는 중…</span></div>'; }
    pull(); setTimeout(pull, 600);   // 화면 전환이 한 박자 늦게 끝나면(대시보드 → 상세) 첫 요청이 건너뛰어진다
    if (!timer) timer = setInterval(pull, 5000);
  }
  D.addEventListener("visibilitychange", function () { if (!D.hidden) pull(); });
  window.luxOB = { open: open };
})();
