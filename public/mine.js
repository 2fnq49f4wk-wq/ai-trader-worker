/* [V33.721] ★MY(내 투자)★ — 사용자 11/2 "왼쪽 사이드바 메뉴로 · 증권사 앱처럼, 시중 앱보다 훨씬 편하게 · 기존에 없던 것 · D1·CPU 낭비 없게".
   탭: 홈(내 계좌 한눈에 · 시장 날씨 · 오늘 내 후보) · 관심종목 · 모의계좌(새 기능: 나만의 가상 계좌로 AI 후보를 따라 사 보기) · 설정.
   ★비용★: 서버(/api/me)는 MY 화면을 처음 열 때 1회 읽고, 저장은 사용자가 바꿀 때만(2초 모아서 1회). 화면 그리기는 MY 가 보일 때만 ·
   시세는 대시보드가 이미 받은 것(window.__lastQuotesArr)을 쓰고 · 매매법 판정(/api/playbook · 엣지 캐시)은 MY 가 보일 때 3분에 1회.
   개인정보 없음(기기 토큰 해시 · 연결 코드로 다른 기기). 모의투자 · 투자 권유 아님. */
(function () {
  "use strict";
  var UIDK = "lux-uid", PROFK = "lux-prof";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function uid() {
    var u = null; try { u = localStorage.getItem(UIDK); } catch (e) {}
    if (!u || !/^[0-9a-f]{32,64}$/.test(u)) {
      var a = new Uint8Array(16); crypto.getRandomValues(a);
      u = Array.from(a).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
      try { localStorage.setItem(UIDK, u); } catch (e) {}
    }
    return u;
  }
  var DEF = { risk: "mid", mkts: ["us", "kr"], horizon: "swing", exp: "mid", watch: [], done: false, pf: null };
  var prof = null; try { prof = JSON.parse(localStorage.getItem(PROFK) || "null"); } catch (e) {}
  prof = Object.assign({}, DEF, prof || {});
  var tab = "home", pfMk = "us", PB = null, pbTs = 0, loaded = false, saveT = 0, sheet = null;
  var RISK = { safe: "안정형", mid: "중립형", aggr: "공격형" }, HOR = { scalp: "단타", swing: "스윙", long: "중장기" },
      HORL = { scalp: "단타(하루~며칠)", swing: "스윙(2~4주)", long: "중장기(1~3개월)" }, EXP = { "new": "처음", mid: "경험 있음", pro: "전문가" }, MK = { us: "미국", kr: "한국" };
  var REG = { SURGE: "급등장", BULL: "상승장", NEUTRAL: "횡보장", BEAR: "하락장", CRASH: "급락장" };
  var REGI = { SURGE: "🚀", BULL: "☀️", NEUTRAL: "⛅", BEAR: "🌧", CRASH: "⛈" };
  var GUIDE = {
    SURGE: { safe: "추격 매수는 피하고 보유 종목 이익 일부 실현", mid: "신규는 작게, 손절선을 높여 이익 지키기", aggr: "추세 종목 짧게, 손절 엄수(레버리지는 하루 단위)" },
    BULL: { safe: "국면 전략 실전 종목 위주로 나눠 사기, 종목당 비중 작게", mid: "국면 전략·매매법 AI 후보 중 분할 매수", aggr: "주도주 비중 확대, 넓은 손절로 추세 길게" },
    NEUTRAL: { safe: "현금 비중 유지, 관망", mid: "신호가 뜬 종목만 선별, 짧은 보유", aggr: "박스권 반등 매매, 목표 짧게" },
    BEAR: { safe: "신규 매수 줄이고 현금·방어주 비중", mid: "소액·분할만, 손절 엄수", aggr: "인버스·단기 반등만 짧게" },
    CRASH: { safe: "신규 매수 멈추고 현금 보존", mid: "관망, 급락 뒤 첫 양봉 확인 후 소액만", aggr: "공황 반등 단타만, 손절 짧게" }
  };
  var START = { us: 10000, kr: 10000000 };
  var isKr = function (s) { return /\.(KS|KQ)$/.test(s); };
  var fmt = function (mk, v, sign) { if (v == null || !isFinite(v)) return "—"; var a = Math.abs(v), s = sign ? (v >= 0 ? "+" : "−") : (v < 0 ? "−" : "");
    return mk === "kr" ? s + "₩" + Math.round(a).toLocaleString() : s + "$" + a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var pctS = function (v) { return v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%"; };
  var cls = function (v) { return v == null ? "" : v >= 0 ? "up" : "dn"; };

  // ── 서버 ──
  function api(method, body) {
    return fetch("/api/me", { method: method, headers: Object.assign({ "x-lux-uid": uid() }, body ? { "content-type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json(); });
  }
  function persist() {
    try { localStorage.setItem(PROFK, JSON.stringify(prof)); } catch (e) {}
    clearTimeout(saveT);
    saveT = setTimeout(function () { api("POST", prof).catch(function () {}); }, 2000);   // 2초 모아서 1회(연속 조작에 쓰기 1번)
  }
  function load() {
    if (loaded) return; loaded = true;
    api("GET").then(function (j) {
      if (j && j.profile) { prof = Object.assign({}, DEF, j.profile); try { localStorage.setItem(PROFK, JSON.stringify(prof)); } catch (e) {} draw(); }
      else if (prof.done) persist();
    }).catch(function () {});
  }

  // ── 데이터 ──
  function quotes() { return window.__lastQuotesArr || []; }
  function q(sym) { var a = quotes(); for (var i = 0; i < a.length; i++) if (a[i].symbol === sym) return a[i]; return null; }
  function chg(x) { var v = x && (typeof x.regPct === "number" ? x.regPct : x.dayPct); return typeof v === "number" ? v : null; }
  function px(x) { return x && x.price > 0 ? x.price : null; }
  function nm(sym) { var x = q(sym); return (x && x.name) || sym; }
  function picksAll(mk) {
    var lv = PB && PB.live && PB.live[mk];
    return ((lv && lv.items) || []).filter(function (it) { return !!it.pb; }).map(function (it) {
      return { s: it.s, nm: it.nm, pb: it.pb, sl: /^RG:/.test(it.pb), hold: Number(it.hold) || (it.kind === "intra" ? 1 : 20), stop: it.stop, intra: it.kind === "intra",
               watch: /관측|미달|미통과/.test(it.why || ""), why: it.why || "" };
    });
  }
  function picks(mk) {
    var hz = prof.horizon;
    return picksAll(mk).filter(function (p) {
      if (hz === "scalp") return p.intra || (!p.sl && p.hold <= 7);
      if (hz === "long") return p.sl || p.hold >= 40;
      return !p.sl && p.hold > 3 && p.hold < 40;
    }).slice(0, 8);
  }
  function sigOf(sym) { var mk = isKr(sym) ? "kr" : "us"; var a = picksAll(mk); for (var i = 0; i < a.length; i++) if (a[i].s === sym) return a[i]; return null; }
  function pbLoad(force) {
    if (!force && Date.now() - pbTs < 170000) return;
    pbTs = Date.now();
    fetch("/api/playbook").then(function (r) { return r.json(); }).then(function (j) { PB = j; draw(); }).catch(function () {});
  }

  // ── 모의계좌(새 기능) ──
  function acct(mk) { if (!prof.pf) prof.pf = {}; if (!prof.pf[mk]) prof.pf[mk] = { start: START[mk], cash: START[mk], pos: {}, hist: [], t0: Date.now() }; return prof.pf[mk]; }
  function hasAcct(mk) { return !!(prof.pf && prof.pf[mk]); }
  function val(mk) {
    if (!hasAcct(mk)) return null; var a = prof.pf[mk], eq = a.cash, cost = 0, mv = 0;
    Object.keys(a.pos).forEach(function (s) { var p = a.pos[s], x = px(q(s)) || p.avg; eq += p.q * x; mv += p.q * x; cost += p.q * p.avg; });
    return { eq: eq, cash: a.cash, mv: mv, upl: mv - cost, ret: (eq / a.start - 1) * 100, n: Object.keys(a.pos).length };
  }
  function trade(side, sym, qty) {
    var mk = isKr(sym) ? "kr" : "us", a = acct(mk), price = px(q(sym));
    if (!price || !(qty > 0)) return "시세가 없어 체결할 수 없습니다";
    qty = Math.floor(qty);
    if (side === "B") {
      if (qty * price > a.cash + 1e-6) return "현금이 부족합니다";
      if (!a.pos[sym] && Object.keys(a.pos).length >= 30) return "보유 종목은 30개까지입니다";
      var p = a.pos[sym] || { q: 0, avg: 0, t: Date.now() };
      p.avg = (p.q * p.avg + qty * price) / (p.q + qty); p.q += qty; a.pos[sym] = p; a.cash -= qty * price;
    } else {
      var h = a.pos[sym]; if (!h) return "보유하지 않은 종목입니다";
      qty = Math.min(qty, h.q); a.cash += qty * price; h.q -= qty; if (h.q <= 0) delete a.pos[sym];
    }
    a.hist.unshift([Date.now(), side, sym, qty, +price.toFixed(4)]); a.hist = a.hist.slice(0, 60);
    persist(); return null;
  }

  // ── 그리기 ──
  function css() {
    if ($("mineCss")) return;
    var st = document.createElement("style"); st.id = "mineCss";
    st.textContent = [
      "#mineRoot{width:100%;max-width:980px;margin:0 auto;padding:4px 2px 90px;font-size:14px;box-sizing:border-box}",
      "#mineRoot .mtabs{position:sticky;top:0;z-index:5;display:flex;gap:4px;padding:6px;margin-bottom:12px;border-radius:14px;background:var(--panel,#0e1626);border:1px solid var(--bd,#22304a)}",
      "#mineRoot .mtabs button{flex:1;padding:9px 4px;border:0;border-radius:10px;background:transparent;color:var(--mute,#9fb0c8);font-size:14px;font-weight:600;cursor:pointer}",
      "#mineRoot .mtabs button.on{background:#5AB8FF;color:#06101e}",
      "#mineRoot .card{background:var(--panel,#0e1626);border:1px solid var(--bd,#22304a);border-radius:16px;padding:14px 16px;margin-bottom:12px}",
      "#mineRoot .ct{font-size:12.5px;color:var(--mute,#8ea0ba);margin-bottom:8px;display:flex;align-items:center;gap:8px}",
      "#mineRoot .big{font-size:26px;font-weight:700;letter-spacing:-.01em}#mineRoot .up{color:#ff5a5f}#mineRoot .dn{color:#4c8dff}",
      "#mineRoot .g2{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}",
      "#mineRoot .row{display:flex;align-items:center;gap:10px;padding:11px 2px;border-top:1px solid rgba(120,140,170,.14);cursor:pointer}#mineRoot .row:first-child{border-top:0}",
      "#mineRoot .nm{font-weight:600;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#mineRoot .sb{font-size:12px;color:var(--mute,#8ea0ba);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#mineRoot .l{flex:1;min-width:0}#mineRoot .r{text-align:right;white-space:nowrap}#mineRoot .r .p{font-weight:600}",
      "#mineRoot .tag{display:inline-block;font-size:10.5px;padding:1px 6px;border-radius:6px;margin-left:5px;vertical-align:middle;background:rgba(90,184,255,.16);color:#5AB8FF}",
      "#mineRoot .tag.w{background:rgba(150,160,180,.16);color:var(--mute,#9fb0c8)}#mineRoot .tag.s{background:rgba(180,156,255,.18);color:#B49CFF}",
      "#mineRoot .btn{padding:7px 12px;border-radius:10px;border:1px solid var(--bd,#2f4060);background:transparent;color:inherit;font-size:13px;cursor:pointer;white-space:nowrap}",
      "#mineRoot .btn.pri{background:#5AB8FF;border-color:#5AB8FF;color:#06101e;font-weight:700}#mineRoot .btn.buy{background:#ff5a5f;border-color:#ff5a5f;color:#fff;font-weight:700}#mineRoot .btn.sell{background:#4c8dff;border-color:#4c8dff;color:#fff;font-weight:700}",
      "#mineRoot .seg{display:inline-flex;gap:4px;padding:3px;border-radius:10px;border:1px solid var(--bd,#2f4060)}#mineRoot .seg button{padding:5px 12px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-size:13px}#mineRoot .seg button.on{background:rgba(90,184,255,.22);color:#5AB8FF;font-weight:700}",
      "#mineRoot .ops{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 12px}#mineRoot .ops button{padding:8px 13px;border-radius:10px;border:1px solid var(--bd,#2f4060);background:transparent;color:inherit;cursor:pointer;font-size:13.5px}#mineRoot .ops button.on{background:#5AB8FF;border-color:#5AB8FF;color:#06101e;font-weight:700}",
      "#mineRoot input.in{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid var(--bd,#2f4060);background:transparent;color:inherit;font-size:14px}",
      "#mineRoot .note{font-size:11.5px;color:var(--mute,#7d8fa8);margin-top:8px;line-height:1.5}#mineRoot .empty{padding:14px 2px;color:var(--mute,#8ea0ba);font-size:13px}",
      "#mineSheet{position:fixed;inset:0;z-index:9999;background:rgba(5,10,20,.55);display:flex;align-items:flex-end;justify-content:center}",
      "#mineSheet .sh{width:min(520px,100%);background:var(--panel,#0f1829);border:1px solid var(--bd,#2a3a55);border-radius:18px 18px 0 0;padding:18px 18px 26px;color:var(--fg,#e6edf7);font-size:14px}",
      "#mineSheet .pre{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:12px 0}#mineSheet .pre button{padding:10px 0;border-radius:10px;border:1px solid var(--bd,#2f4060);background:transparent;color:inherit;cursor:pointer}#mineSheet .pre button.on{border-color:#5AB8FF;color:#5AB8FF;font-weight:700}",
      "#mineSheet .go{width:100%;padding:13px;border-radius:12px;border:0;font-size:15px;font-weight:700;cursor:pointer;color:#fff}"
    ].join("");
    document.head.appendChild(st);
  }
  function rowQ(sym, right, sub, tags) {
    var x = q(sym), c = chg(x), p = px(x);
    return '<div class="row" data-open="' + esc(sym) + '"><div class="l"><div class="nm">' + esc(nm(sym)) + (tags || "") + '</div><div class="sb">' + esc(sub || sym) + '</div></div>' +
      '<div class="r"><div class="p">' + (p ? (isKr(sym) ? Math.round(p).toLocaleString() : p.toFixed(2)) : "—") + '</div><div class="' + cls(c) + '" style="font-size:12.5px">' + pctS(c) + "</div></div>" + (right || "") + "</div>";
  }
  function tagOf(sig) { if (!sig) return ""; return sig.watch ? '<span class="tag w">관찰</span>' : sig.sl ? '<span class="tag s">국면 전략</span>' : '<span class="tag">오늘 후보</span>'; }
  function weather(mk) {
    var m = PB && PB.markets && PB.markets[mk], reg = m && m.regime, sl = m && m.sleeve;
    var st = sl && sl.cur ? (sl.live ? "실전 투입" : "관찰") : "쉼";
    return '<div class="card" style="margin:0"><div class="ct">' + MK[mk] + ' 시장 날씨</div><div style="font-size:19px;font-weight:700">' + (REGI[reg] || "") + " " + (REG[reg] || "불러오는 중") + "</div>" +
      '<div style="margin-top:6px">' + esc(reg && GUIDE[reg] ? GUIDE[reg][prof.risk] : "") + "</div>" +
      '<div class="note">' + (prof.exp === "new" ? "시장 날씨 = 지수의 1년·두 달·이번 주 흐름으로 나눈 시장 상태 · " : "") + "국면 전략 " + esc(st) + (sl && sl.cur ? " — " + esc(sl.cur.famKo || sl.cur.fam) : "") + "</div></div>";
  }
  function home() {
    var h = "";
    var acc = ["us", "kr"].filter(hasAcct);
    if (acc.length) {
      h += '<div class="g2">' + acc.map(function (mk) { var v = val(mk);
        return '<div class="card" style="margin:0;cursor:pointer" data-go="pf" data-mk="' + mk + '"><div class="ct">내 ' + MK[mk] + ' 모의계좌</div><div class="big">' + fmt(mk, v.eq) + '</div><div class="' + cls(v.ret) + '" style="margin-top:2px">' + fmt(mk, v.eq - prof.pf[mk].start, true) + " (" + pctS(v.ret) + ')</div><div class="note">보유 ' + v.n + "종목 · 현금 " + fmt(mk, v.cash) + "</div></div>"; }).join("") + "</div><div style=\"height:12px\"></div>";
    } else {
      h += '<div class="card"><div class="ct">새 기능 · 나만의 모의계좌</div><div style="font-size:16px;font-weight:700">가상 자금으로 AI 후보를 직접 따라 사 보세요</div><div class="note">미국 $10,000 · 한국 ₩10,000,000으로 시작 · 실제 돈은 쓰지 않습니다 · 내 성적과 AI 성적을 비교할 수 있어요</div><div style="margin-top:10px;display:flex;gap:8px"><button class="btn pri" data-open-acct="us">미국 계좌 만들기</button><button class="btn pri" data-open-acct="kr">한국 계좌 만들기</button></div></div>';
    }
    h += '<div class="g2">' + prof.mkts.map(weather).join("") + '</div><div style="height:12px"></div>';
    prof.mkts.forEach(function (mk) {
      var ps = picks(mk), m = PB && PB.markets && PB.markets[mk];
      h += '<div class="card"><div class="ct">' + MK[mk] + " · 오늘 내 기간(" + HORL[prof.horizon] + ") 후보</div>" + (ps.length ? ps.map(function (p) {
        var sub = prof.exp === "new" ? (p.sl ? "지금 국면에 맞는 전략이 고른 종목" : "비슷한 과거에서 성적이 좋았던 방법이 뜬 종목") + (p.stop ? " · −" + Number(p.stop).toFixed(0) + "% 떨어지면 판다" : "")
          : (p.sl ? "국면 전략" : "매매법 AI " + p.pb) + (p.stop ? " · 손절 −" + Number(p.stop).toFixed(0) + "%" : "") + " · 최대 " + p.hold + "일" + (p.watch ? " · 지금은 관찰만(검증 기준 미달)" : "");
        return rowQ(p.s, '<button class="btn buy" data-buy="' + esc(p.s) + '">모의 매수</button>', sub, tagOf(p));
      }).join("") : '<div class="empty">지금 내 조건에 맞는 후보가 없습니다' + (m && (m.regime === "BEAR" || m.regime === "CRASH") ? " — 약세 국면이라 시스템이 신규 매수를 줄이고 있어요" : "") + "</div>") + "</div>";
    });
    return h;
  }
  function watch() {
    var h = '<div class="card"><input class="in" id="mineSearch" placeholder="종목 이름이나 코드로 찾아 추가 (예: 엔비디아, NVDA, 삼성전자)"><div id="mineFound"></div></div>';
    h += '<div class="card"><div class="ct">내 관심종목 ' + prof.watch.length + "/40</div>" + (prof.watch.length ? prof.watch.map(function (s) {
      var sig = sigOf(s);
      return rowQ(s, '<button class="btn" data-unwatch="' + esc(s) + '" title="관심 해제">☆</button>', sig ? (sig.sl ? "국면 전략 편입" : "매매법 AI 오늘 후보 · " + sig.pb) : s, tagOf(sig));
    }).join("") : '<div class="empty">위 검색창에서 종목을 추가해 보세요</div>') + "</div>";
    return h;
  }
  function pfTab() {
    var mk = pfMk, h = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div class="seg">' + ["us", "kr"].map(function (m) { return '<button data-pfmk="' + m + '" class="' + (m === mk ? "on" : "") + '">' + MK[m] + "</button>"; }).join("") + "</div></div>";
    if (!hasAcct(mk)) return h + '<div class="card"><div style="font-size:16px;font-weight:700">' + MK[mk] + ' 모의계좌가 아직 없습니다</div><div class="note">' + fmt(mk, START[mk]) + '으로 시작 · 실제 돈은 쓰지 않습니다</div><button class="btn pri" style="margin-top:10px" data-open-acct="' + mk + '">계좌 만들기</button></div>';
    var a = prof.pf[mk], v = val(mk), days = Math.max(1, Math.round((Date.now() - (a.t0 || Date.now())) / 86400000));
    h += '<div class="card"><div class="ct">총자산 · ' + days + '일째</div><div class="big">' + fmt(mk, v.eq) + '</div><div class="' + cls(v.ret) + '">' + fmt(mk, v.eq - a.start, true) + " (" + pctS(v.ret) + ")</div>" +
      '<div class="g2" style="margin-top:10px;gap:6px"><div><div class="sb">현금</div><div>' + fmt(mk, v.cash) + '</div></div><div><div class="sb">주식 평가</div><div>' + fmt(mk, v.mv) + '</div></div><div><div class="sb">평가손익</div><div class="' + cls(v.upl) + '">' + fmt(mk, v.upl, true) + "</div></div></div></div>";
    var ks = Object.keys(a.pos);
    h += '<div class="card"><div class="ct">보유 ' + ks.length + "종목</div>" + (ks.length ? ks.map(function (s) {
      var p = a.pos[s], cur = px(q(s)) || p.avg, r = (cur / p.avg - 1) * 100;
      return '<div class="row" data-open="' + esc(s) + '"><div class="l"><div class="nm">' + esc(nm(s)) + tagOf(sigOf(s)) + '</div><div class="sb">' + p.q.toLocaleString() + "주 · 평단 " + fmt(mk, p.avg) + '</div></div><div class="r"><div class="p">' + fmt(mk, p.q * cur) + '</div><div class="' + cls(r) + '" style="font-size:12.5px">' + pctS(r) + '</div></div><button class="btn sell" data-sell="' + esc(s) + '">매도</button></div>';
    }).join("") : '<div class="empty">홈의 오늘 후보나 관심종목에서 모의 매수해 보세요</div>') + "</div>";
    h += '<div class="card"><div class="ct">거래 내역</div>' + (a.hist.length ? a.hist.slice(0, 20).map(function (t) {
      return '<div class="row" data-open="' + esc(t[2]) + '"><div class="l"><div class="nm">' + esc(nm(t[2])) + '</div><div class="sb">' + new Date(t[0]).toLocaleString() + '</div></div><div class="r"><div class="' + (t[1] === "B" ? "up" : "dn") + '">' + (t[1] === "B" ? "매수" : "매도") + " " + t[3].toLocaleString() + '주</div><div class="sb">' + fmt(mk, t[4]) + "</div></div></div>";
    }).join("") : '<div class="empty">아직 거래가 없습니다</div>') + '<div class="note">체결가 = 그 순간 화면 시세(시간외 포함) · 수수료·세금 없음 · 모의투자</div></div>';
    return h;
  }
  function setTab() {
    var ops = function (k, map, multi) { return '<div class="ops" data-k="' + k + '">' + Object.keys(map).map(function (v) { var on = multi ? prof[k].indexOf(v) >= 0 : prof[k] === v; return '<button data-v="' + v + '" class="' + (on ? "on" : "") + '">' + map[v] + "</button>"; }).join("") + "</div>"; };
    return '<div class="card">' + (prof.done ? "" : '<div style="font-size:16px;font-weight:700;margin-bottom:4px">처음이면 네 가지만 골라 주세요</div><div class="note" style="margin:0 0 6px">답에 맞춰 홈 화면(시장 날씨 안내 · 오늘 후보)이 바뀝니다</div>') +
      '<div class="ct">투자 성향</div>' + ops("risk", { safe: "안정형 — 손실이 싫다", mid: "중립형", aggr: "공격형 — 큰 수익 노림" }) +
      '<div class="ct">관심 시장</div>' + ops("mkts", MK, true) + '<div class="ct">보유 기간</div>' + ops("horizon", HORL) + '<div class="ct">투자 경험</div>' + ops("exp", EXP) +
      (prof.done ? "" : '<button class="btn pri" id="mineDone" style="width:100%;padding:12px">시작하기</button>') + "</div>" +
      '<div class="card"><div class="ct">다른 기기에서 같은 설정·계좌 쓰기</div><div class="sb" style="white-space:normal;word-break:break-all">연결 코드: ' + uid() + '</div><div style="display:flex;gap:6px;margin-top:8px"><input class="in" id="mineCode" placeholder="다른 기기의 연결 코드 붙여넣기"><button class="btn" id="mineLink">연결</button></div><div class="note">로그인 없이 이 코드로만 구분합니다 · 이름·이메일 등 개인정보는 받지 않습니다</div></div>' +
      '<div class="card"><div class="ct">모의계좌 초기화</div><div style="display:flex;gap:8px"><button class="btn" data-reset="us">미국 초기화</button><button class="btn" data-reset="kr">한국 초기화</button></div></div>';
  }
  function draw() {
    var root = $("mineRoot"), pg = $("page-mine");
    if (!root || !pg || !pg.classList.contains("active")) return;
    css();
    if (!prof.done && tab !== "set") tab = "set";
    var T = { home: "홈", watch: "관심종목", pf: "모의계좌", set: "설정" };
    var body = tab === "home" ? home() : tab === "watch" ? watch() : tab === "pf" ? pfTab() : setTab();
    root.innerHTML = '<div class="mtabs">' + Object.keys(T).map(function (k) { return '<button data-tab="' + k + '" class="' + (k === tab ? "on" : "") + '">' + T[k] + "</button>"; }).join("") + "</div>" + body +
      '<div class="note" style="text-align:center">모의투자 서비스 · 화면 내용은 투자 권유가 아닙니다' + (pbTs ? " · 판정 " + new Date(pbTs).toLocaleTimeString() : "") + "</div>";
    var s = $("mineSearch"); if (s) { s.oninput = function () { found(s.value); }; }
  }
  function found(t) {
    var el = $("mineFound"); if (!el) return; t = (t || "").trim().toLowerCase();
    if (t.length < 1) { el.innerHTML = ""; return; }
    var r = quotes().filter(function (x) { return x.symbol && (x.symbol.toLowerCase().indexOf(t) >= 0 || (x.name || "").toLowerCase().indexOf(t) >= 0); }).slice(0, 8);
    el.innerHTML = r.length ? r.map(function (x) { var on = prof.watch.indexOf(x.symbol) >= 0;
      return rowQ(x.symbol, '<button class="btn ' + (on ? "" : "pri") + '" data-addwatch="' + esc(x.symbol) + '">' + (on ? "추가됨" : "+ 관심") + "</button>", x.symbol, tagOf(sigOf(x.symbol))); }).join("") : '<div class="empty">찾는 종목이 없습니다(추적 종목 안에서 찾습니다)</div>';
  }
  function openSheet(side, sym) {
    var mk = isKr(sym) ? "kr" : "us";
    if (side === "B" && !hasAcct(mk)) acct(mk);
    var a = acct(mk), p = px(q(sym)); if (!p) { alert("시세가 없어 주문할 수 없습니다"); return; }
    var held = (a.pos[sym] || {}).q || 0, frac = side === "B" ? 0.1 : 1;
    var w = document.createElement("div"); w.id = "mineSheet";
    var qtyOf = function () { return side === "B" ? Math.floor(a.cash * frac / p) : Math.floor(held * frac); };
    var paint = function () {
      var qy = qtyOf();
      w.innerHTML = '<div class="sh"><div style="display:flex;justify-content:space-between;align-items:baseline"><div style="font-size:17px;font-weight:700">' + esc(nm(sym)) + '</div><div>' + fmt(mk, p) + '</div></div>' +
        '<div class="note" style="margin-top:4px">' + (side === "B" ? "주문 가능 현금 " + fmt(mk, a.cash) : "보유 " + held.toLocaleString() + "주") + "</div>" +
        '<div class="pre">' + [0.1, 0.25, 0.5, 1].map(function (f) { return '<button data-f="' + f + '" class="' + (f === frac ? "on" : "") + '">' + (f === 1 ? (side === "B" ? "최대" : "전부") : f * 100 + "%") + "</button>"; }).join("") + "</div>" +
        '<div style="display:flex;justify-content:space-between;margin-bottom:12px"><span>' + qy.toLocaleString() + '주</span><b>' + fmt(mk, qy * p) + "</b></div>" +
        '<button class="go" style="background:' + (side === "B" ? "#ff5a5f" : "#4c8dff") + '" ' + (qy > 0 ? "" : "disabled") + ">" + (qy > 0 ? (side === "B" ? "모의 매수" : "모의 매도") : "수량이 0주입니다") + '</button><div class="note" style="text-align:center">모의투자 · 실제 주문이 아닙니다</div></div>';
      w.querySelectorAll("[data-f]").forEach(function (b) { b.onclick = function () { frac = Number(b.getAttribute("data-f")); paint(); }; });
      var go = w.querySelector(".go"); if (go) go.onclick = function () { var err = trade(side, sym, qtyOf()); if (err) { alert(err); return; } w.remove(); pfMk = mk; tab = "pf"; draw(); };
    };
    paint(); w.addEventListener("click", function (ev) { if (ev.target === w) w.remove(); }); document.body.appendChild(w);
  }
  function onClick(ev) {
    var t = ev.target.closest("[data-tab],[data-buy],[data-sell],[data-open],[data-go],[data-open-acct],[data-pfmk],[data-addwatch],[data-unwatch],[data-reset],[data-v],#mineDone,#mineLink");
    if (!t || !$("mineRoot").contains(t)) return;
    var d = t.dataset;
    if (d.tab) { tab = d.tab; draw(); return; }
    if (d.buy) { ev.stopPropagation(); openSheet("B", d.buy); return; }
    if (d.sell) { ev.stopPropagation(); openSheet("S", d.sell); return; }
    if (d.openAcct) { acct(d.openAcct); persist(); pfMk = d.openAcct; tab = "pf"; draw(); return; }
    if (d.go) { tab = d.go; if (d.mk) pfMk = d.mk; draw(); return; }
    if (d.pfmk) { pfMk = d.pfmk; draw(); return; }
    if (d.addwatch) { if (prof.watch.indexOf(d.addwatch) < 0 && prof.watch.length < 40) { prof.watch.push(d.addwatch); persist(); } var sv = ($("mineSearch") || {}).value; draw(); var s2 = $("mineSearch"); if (s2) { s2.value = sv || ""; found(sv); s2.focus(); } return; }
    if (d.unwatch) { ev.stopPropagation(); prof.watch = prof.watch.filter(function (x) { return x !== d.unwatch; }); persist(); draw(); return; }
    if (d.reset) { if (confirm(MK[d.reset] + " 모의계좌를 처음 상태로 되돌릴까요?")) { if (prof.pf) delete prof.pf[d.reset]; persist(); draw(); } return; }
    if (d.v) { var g = t.closest("[data-k]"); if (!g) return; var k = g.getAttribute("data-k");
      if (k === "mkts") { var i = prof.mkts.indexOf(d.v); if (i >= 0 && prof.mkts.length > 1) prof.mkts.splice(i, 1); else if (i < 0) prof.mkts.push(d.v); } else prof[k] = d.v;
      if (prof.done) persist(); draw(); return; }
    if (t.id === "mineDone") { prof.done = true; persist(); tab = "home"; pbLoad(true); draw(); return; }
    if (t.id === "mineLink") { var c = (($("mineCode") || {}).value || "").trim().toLowerCase();
      if (!/^[0-9a-f]{32,64}$/.test(c)) { alert("연결 코드 형식이 아닙니다"); return; }
      try { localStorage.setItem(UIDK, c); } catch (e) {} loaded = false;
      api("GET").then(function (j) { if (j && j.profile) { prof = Object.assign({}, DEF, j.profile); try { localStorage.setItem(PROFK, JSON.stringify(prof)); } catch (e) {} tab = "home"; draw(); } else alert("그 코드의 설정을 찾지 못했습니다"); }); return; }
    if (d.open && typeof window.openDetailFromSym === "function") window.openDetailFromSym(d.open);
  }

  function onShow() { load(); pbLoad(false); draw(); }
  function boot() {
    var pg = $("page-mine"), root = $("mineRoot"); if (!pg || !root) return;
    root.addEventListener("click", onClick);
    new MutationObserver(function () { if (pg.classList.contains("active")) onShow(); }).observe(pg, { attributes: true, attributeFilter: ["class"] });
    if (pg.classList.contains("active")) onShow();
    setInterval(function () { if (!document.hidden && pg.classList.contains("active")) { pbLoad(false); if (!$("mineSheet") && !(document.activeElement && document.activeElement.id === "mineSearch")) draw(); } }, 60000);
  }
  window.luxMine = { draw: draw };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
