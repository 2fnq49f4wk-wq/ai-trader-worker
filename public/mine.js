/* [V33.723] ★MY(내 투자) 재디자인★ — 사용자 11/2 시안(아티팩트 'LUX MY 화면 리디자인') 반영 · 기능은 V33.721 그대로 + 고친 것:
   · 모의 매수: '오늘 후보' 에만 있던 [사기] 를 관심종목·검색 결과 모든 종목에(후보가 비면 살 길이 없었다) · 주문창 ±1주
   · 패스키 로그인(사이트 자체 · 외부 앱 등록 없음 · Face ID/지문) — 연결 코드를 안전하게 되찾는 열쇠
   · 내 데이터 삭제(서버 프로필·모의계좌·패스키) · 보존 1년(서버가 지움)
   ★비용★: /api/me 읽기는 MY 첫 열림 1회 · 쓰기는 조작 2초 모아 1회 · 그리기·/api/playbook(엣지 캐시)은 MY 가 보일 때만 3분 · 시세는 대시보드가 받은 것 재사용.
   개인 데이터는 이 기기 코드(또는 패스키)로만 열린다 — 다른 사람에게 보이지 않는다. 모의투자 · 투자 권유 아님. */
(function () {
  "use strict";
  var UIDK = "lux-uid", PROFK = "lux-prof";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function newUid() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a).map(function (x) { return x.toString(16).padStart(2, "0"); }).join(""); }
  function uid() {
    var u = null; try { u = localStorage.getItem(UIDK); } catch (e) {}
    if (!u || !/^[0-9a-f]{32,64}$/.test(u)) { u = newUid(); try { localStorage.setItem(UIDK, u); } catch (e) {} }
    return u;
  }
  var DEF = { risk: "mid", mkts: ["us", "kr"], horizon: "swing", exp: "mid", watch: [], done: false, pf: null };
  var prof = null; try { prof = JSON.parse(localStorage.getItem(PROFK) || "null"); } catch (e) {}
  prof = Object.assign({}, DEF, prof || {});
  var tab = "home", acMk = "us", wFilter = "all", PB = null, pbTs = 0, loaded = false, saveT = 0;
  var MK = { us: "미국", kr: "한국" }, RISK = { safe: "안정형", mid: "중립형", aggr: "공격형" }, HOR = { scalp: "단타", swing: "스윙", long: "중장기" }, EXP = { "new": "처음", mid: "경험", pro: "전문가" };
  var REG = { SURGE: "급등장", BULL: "상승장", NEUTRAL: "횡보장", BEAR: "하락장", CRASH: "급락장" };
  var REGC = { SURGE: "#FF6B6B", BULL: "#FF8C7A", NEUTRAL: "#E2C766", BEAR: "#7FA6FF", CRASH: "#5C86FF" };
  var GUIDE = {
    SURGE: { safe: "추격 매수는 피하고 이익 일부 실현", mid: "신규는 작게, 손절선 올려 이익 지키기", aggr: "추세 종목 짧게, 손절 엄수" },
    BULL: { safe: "국면 전략 종목 위주로 나눠 사기", mid: "AI 후보 중 분할 매수", aggr: "주도주 비중 확대, 추세 길게" },
    NEUTRAL: { safe: "현금 비중 유지, 관망", mid: "신호 뜬 종목만 골라 짧게", aggr: "박스권 반등 매매, 목표 짧게" },
    BEAR: { safe: "신규 매수 줄이고 현금·방어주", mid: "소액·분할만, 손절 엄수", aggr: "인버스·단기 반등만 짧게" },
    CRASH: { safe: "신규 매수 멈추고 현금 보존", mid: "관망 · 첫 양봉 뒤 소액만", aggr: "공황 반등 단타만, 손절 짧게" }
  };
  var START = { us: 10000, kr: 10000000 };
  var isKr = function (s) { return /\.(KS|KQ)$/.test(s); };
  var fmt = function (mk, v, sign) { if (v == null || !isFinite(v)) return "—"; var a = Math.abs(v), s = sign ? (v >= 0 ? "+" : "−") : (v < 0 ? "−" : "");
    return mk === "kr" ? s + "₩" + Math.round(a).toLocaleString() : s + "$" + a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var pctS = function (v) { return v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) + "%"; };
  var cls = function (v) { return v == null ? "" : v >= 0 ? "up" : "dn"; };

  function api(method, body, path, extra) {
    return fetch(path || "/api/me", { method: method, headers: Object.assign({ "x-lux-uid": uid() }, body ? { "content-type": "application/json" } : {}, extra || {}), body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json(); });
  }
  function saveLocal() { try { localStorage.setItem(PROFK, JSON.stringify(prof)); } catch (e) {} }
  function persist() { saveLocal(); clearTimeout(saveT); saveT = setTimeout(function () { api("POST", prof).catch(function () {}); }, 2000); }
  function adopt(p) { prof = Object.assign({}, DEF, p || {}); saveLocal(); }
  function load(force) {
    if (loaded && !force) return; loaded = true;
    api("GET").then(function (j) { if (j && j.profile) { adopt(j.profile); draw(); } else if (prof.done) persist(); }).catch(function () {});
  }

  function quotes() { return window.__lastQuotesArr || []; }
  function q(sym) { var a = quotes(); for (var i = 0; i < a.length; i++) if (a[i].symbol === sym) return a[i]; return null; }
  function chg(x) { var v = x && (typeof x.regPct === "number" ? x.regPct : x.dayPct); return typeof v === "number" ? v : null; }
  function px(x) { return x && x.price > 0 ? x.price : null; }
  function nm(sym) { var x = q(sym); return (x && x.name) || sym; }
  function short(sym) { return isKr(sym) ? sym.split(".")[0] : sym; }
  function picksAll(mk) {
    var lv = PB && PB.live && PB.live[mk];
    return ((lv && lv.items) || []).filter(function (it) { return !!it.pb; }).map(function (it) {
      return { s: it.s, pb: it.pb, sl: /^RG:/.test(it.pb), hold: Number(it.hold) || (it.kind === "intra" ? 1 : 20), stop: it.stop, intra: it.kind === "intra", watch: /관측|미달|미통과/.test(it.why || "") };
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
  function sigOf(sym) { var a = picksAll(isKr(sym) ? "kr" : "us"); for (var i = 0; i < a.length; i++) if (a[i].s === sym) return a[i]; return null; }
  function pbLoad(force) {
    if (!force && Date.now() - pbTs < 170000) return; pbTs = Date.now();
    fetch("/api/playbook").then(function (r) { return r.json(); }).then(function (j) { PB = j; draw(); }).catch(function () {});
  }

  // ── 모의계좌 ──
  function acct(mk) { if (!prof.pf) prof.pf = {}; if (!prof.pf[mk]) prof.pf[mk] = { start: START[mk], cash: START[mk], pos: {}, hist: [], t0: Date.now() }; return prof.pf[mk]; }
  function has(mk) { return !!(prof.pf && prof.pf[mk]); }
  function held(sym) { var mk = isKr(sym) ? "kr" : "us"; return has(mk) && prof.pf[mk].pos[sym] ? prof.pf[mk].pos[sym].q : 0; }
  function val(mk) {
    if (!has(mk)) return null; var a = prof.pf[mk], eq = a.cash, cost = 0, mv = 0;
    Object.keys(a.pos).forEach(function (s) { var p = a.pos[s], x = px(q(s)) || p.avg; eq += p.q * x; mv += p.q * x; cost += p.q * p.avg; });
    return { eq: eq, cash: a.cash, mv: mv, upl: mv - cost, ret: (eq / a.start - 1) * 100, n: Object.keys(a.pos).length, days: Math.max(1, Math.round((Date.now() - (a.t0 || Date.now())) / 86400000)) };
  }
  function trade(side, sym, qty) {
    var mk = isKr(sym) ? "kr" : "us", a = acct(mk), price = px(q(sym));
    qty = Math.floor(qty);
    if (!price) return "시세가 없어 체결할 수 없습니다";
    if (!(qty > 0)) return "수량을 1주 이상으로 정해 주세요";
    if (side === "B") {
      if (qty * price > a.cash + 1e-6) return "주문 가능 금액이 부족합니다";
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

  // ── 스타일(시안: 남색 바탕 · 카드 20px · 상승 빨강/하락 파랑 · 버튼 44px) ──
  function css() {
    if ($("mineCss")) return;
    var st = document.createElement("style"); st.id = "mineCss";
    st.textContent = [
      "#mineRoot{--m-bg:#0B1220;--m-card:#111A2C;--m-line:#1C2840;--m-chip:#1E2C46;--m-mute:#9AA9BF;--m-acc:#5AB8FF;--m-up:#FF6B6B;--m-dn:#6FA0FF;width:100%;max-width:760px;margin:0 auto;padding:6px 4px 96px;box-sizing:border-box;font-size:14.5px;color:var(--fg,#E8EEF7)}",
      "#mineRoot *{box-sizing:border-box}#mineRoot .up{color:var(--m-up)}#mineRoot .dn{color:var(--m-dn)}#mineRoot .mu{color:var(--m-mute)}",
      "#mineRoot .tabs{position:sticky;top:0;z-index:5;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:5px;margin:0 0 14px;border-radius:16px;background:var(--m-card);border:1px solid var(--m-line)}",
      "#mineRoot .tabs button{min-height:44px;border:0;border-radius:12px;background:transparent;color:var(--m-mute);font-size:14.5px;font-weight:600;cursor:pointer}#mineRoot .tabs button.on{background:var(--m-chip);color:#fff}",
      "#mineRoot .card{background:var(--m-card);border-radius:20px;padding:16px 18px;margin:0 0 12px}#mineRoot .ct{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;color:var(--m-mute);margin-bottom:6px}",
      "#mineRoot .h1{font-size:30px;font-weight:700;letter-spacing:-.5px}#mineRoot .h2{font-size:16px;font-weight:700}",
      "#mineRoot .seg{display:inline-flex;gap:3px;background:var(--m-bg);border-radius:10px;padding:3px}#mineRoot .seg button{border:0;border-radius:8px;padding:6px 12px;font-size:12.5px;background:transparent;color:var(--m-mute);cursor:pointer}#mineRoot .seg button.on{background:var(--m-chip);color:#fff;font-weight:700}",
      "#mineRoot .btns{display:flex;gap:8px;margin-top:12px}#mineRoot .b{flex:1;min-height:46px;border-radius:12px;border:0;font-size:14.5px;font-weight:600;cursor:pointer;background:var(--m-chip);color:#E8EEF7}#mineRoot .b.pri{background:var(--m-acc);color:#06101E;font-weight:700}#mineRoot .b.line{background:transparent;border:1px solid #2C3A55;color:#C9D4E3}#mineRoot .b.warn{background:transparent;border:1px solid #5A2A33;color:#FF8C8C}",
      "#mineRoot .g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 12px}#mineRoot .wx{background:var(--m-card);border-radius:16px;padding:14px}#mineRoot .wx b{display:block;font-size:18px;margin:4px 0}",
      "#mineRoot .row{display:flex;align-items:center;gap:12px;padding:12px 2px;border-top:1px solid var(--m-line);cursor:pointer}#mineRoot .row:first-of-type{border-top:0}",
      "#mineRoot .av{flex:0 0 38px;height:38px;border-radius:19px;background:var(--m-chip);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;overflow:hidden}",
      "#mineRoot .l{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}#mineRoot .nm{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#mineRoot .sb{font-size:12px;color:var(--m-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#mineRoot .r{display:flex;flex-direction:column;align-items:flex-end;gap:2px;white-space:nowrap}#mineRoot .r .p{font-size:14.5px;font-weight:600}",
      "#mineRoot .buy,#mineRoot .sell,#mineRoot .tag2{min-height:40px;padding:0 14px;border-radius:10px;border:0;font-size:13.5px;font-weight:700;cursor:pointer;color:#fff;background:var(--m-up)}#mineRoot .sell{background:var(--m-dn)}#mineRoot .tag2{background:var(--m-chip);color:var(--m-mute);font-weight:500;cursor:default;display:inline-flex;align-items:center}",
      "#mineRoot .pill{font-size:11px;padding:2px 6px;border-radius:6px;margin-left:5px;background:#12304A;color:#7CC4FF;vertical-align:middle}#mineRoot .pill.s{background:#22263A;color:#B9A6FF}#mineRoot .pill.w{background:#1E2433;color:var(--m-mute)}",
      "#mineRoot .chips{display:flex;gap:6px;margin:10px 0 2px;flex-wrap:wrap}#mineRoot .chips button{min-height:36px;border-radius:18px;padding:0 14px;font-size:13px;border:1px solid #22304A;background:transparent;color:#C9D4E3;cursor:pointer}#mineRoot .chips button.on{background:#E8EEF7;color:#0B1220;border-color:#E8EEF7;font-weight:700}",
      "#mineRoot .search{display:flex;align-items:center;gap:8px;background:var(--m-card);border:1px solid #22304A;border-radius:14px;padding:0 14px;min-height:48px}#mineRoot .search input{flex:1;border:0;outline:0;background:transparent;color:inherit;font-size:15px;font-family:inherit;min-width:0}",
      "#mineRoot .ops{display:grid;gap:6px;margin:6px 0 12px}#mineRoot .ops button{min-height:44px;border-radius:12px;border:1px solid #2C3A55;background:transparent;color:#C9D4E3;font-size:13.5px;cursor:pointer}#mineRoot .ops button.on{background:var(--m-acc);border-color:var(--m-acc);color:#06101E;font-weight:700}",
      "#mineRoot .kv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}#mineRoot .kv div{display:flex;flex-direction:column;gap:2px}#mineRoot .kv span{font-size:11.5px;color:var(--m-mute)}",
      "#mineRoot .note{font-size:11.5px;line-height:1.55;color:#8697AF}#mineRoot .empty{padding:16px 2px;color:var(--m-mute);font-size:13.5px;line-height:1.5}",
      "#mineSheet{position:fixed;inset:0;z-index:9999;background:rgba(4,8,16,.62);display:flex;align-items:flex-end;justify-content:center}",
      "#mineSheet .sh{width:min(520px,100%);background:#131D31;border-radius:22px 22px 0 0;padding:10px 20px calc(22px + env(safe-area-inset-bottom));color:#E8EEF7;display:flex;flex-direction:column;gap:14px;font-size:14px}",
      "#mineSheet .grab{width:40px;height:4px;border-radius:2px;background:#2C3A55;align-self:center}#mineSheet .pre{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}",
      "#mineSheet .pre button{min-height:44px;border-radius:12px;border:1px solid #2C3A55;background:transparent;color:#C9D4E3;font-size:14px;cursor:pointer}#mineSheet .pre button.on{border:2px solid var(--c);color:var(--c);font-weight:700}",
      "#mineSheet .stp{display:flex;align-items:center;justify-content:space-between;background:#0B1220;border-radius:14px;padding:6px 8px}#mineSheet .stp button{width:44px;height:44px;border-radius:12px;border:0;background:#1E2C46;color:#E8EEF7;font-size:22px;cursor:pointer}",
      "#mineSheet .go{min-height:54px;border-radius:14px;border:0;font-size:16px;font-weight:700;color:#fff;background:var(--c);cursor:pointer}#mineSheet .go:disabled{opacity:.45;cursor:default}#mineSheet .kv2{display:flex;justify-content:space-between;font-size:12.5px;color:#9AA9BF}"
    ].join("");
    document.head.appendChild(st);
  }

  function rowQ(sym, sub, tags, right) {
    var x = q(sym), c = chg(x), p = px(x);
    return '<div class="row" data-open="' + esc(sym) + '"><div class="av">' + esc(short(sym).slice(0, 4)) + '</div><div class="l"><span class="nm">' + esc(nm(sym)) + (tags || "") + '</span><span class="sb">' + esc(sub) + "</span></div>" +
      '<div class="r"><span class="p">' + (p ? (isKr(sym) ? "₩" + Math.round(p).toLocaleString() : "$" + p.toFixed(2)) : "—") + '</span><span class="' + cls(c) + '" style="font-size:12.5px">' + pctS(c) + "</span></div>" + (right || "") + "</div>";
  }
  function pill(sig) { return !sig ? "" : sig.watch ? '<span class="pill w">관찰</span>' : sig.sl ? '<span class="pill s">국면 전략</span>' : '<span class="pill">AI 후보</span>'; }
  function buyBtn(sym) { return '<button type="button" class="buy" data-buy="' + esc(sym) + '">사기</button>'; }

  function home() {
    var mk = has(acMk) ? acMk : (has("us") ? "us" : has("kr") ? "kr" : acMk), v = val(mk), h = "";
    h += '<section class="card" aria-label="모의계좌"><div class="ct"><span>모의계좌 총자산</span><span class="seg">' + ["us", "kr"].map(function (m) { return '<button type="button" data-acmk="' + m + '" class="' + (m === mk ? "on" : "") + '">' + MK[m] + "</button>"; }).join("") + "</span></div>" +
      (v ? '<div class="h1">' + fmt(mk, v.eq) + '</div><div class="' + cls(v.ret) + '">' + fmt(mk, v.eq - prof.pf[mk].start, true) + " (" + pctS(v.ret) + ") · 시작 후 " + v.days + "일</div>"
         : '<div class="h2" style="margin:6px 0 2px">가상 ' + fmt(mk, START[mk]) + '으로 AI 후보를 따라 사 보세요</div><div class="note">실제 돈은 쓰지 않습니다 · 내 성적이 이 기기에만 쌓입니다</div>') +
      '<div class="btns">' + (v ? '<button type="button" class="b pri" data-tab="acct">내 계좌 보기</button>' : '<button type="button" class="b pri" data-open-acct="' + mk + '">' + MK[mk] + " 계좌 만들기</button>") + '<button type="button" class="b" data-tab="watch">종목 찾기</button></div></section>';
    h += '<div class="g2">' + prof.mkts.map(function (m) { var r = PB && PB.markets && PB.markets[m] && PB.markets[m].regime;
      return '<div class="wx"><span class="mu" style="font-size:12px">' + MK[m] + ' 시장</span><b style="color:' + (REGC[r] || "inherit") + '">' + (REG[r] || "불러오는 중") + '</b><span style="font-size:12.5px;line-height:1.45;color:#C9D4E3">' + esc(r && GUIDE[r] ? GUIDE[r][prof.risk] : "") + "</span></div>"; }).join("") + "</div>";
    var all = [];
    prof.mkts.forEach(function (m) { picks(m).forEach(function (p) { all.push(p); }); });
    h += '<section class="card" aria-label="오늘 내 후보"><div class="ct"><span class="h2" style="color:#E8EEF7">오늘 내 후보</span><span>' + HOR[prof.horizon] + " · " + RISK[prof.risk] + "</span></div>" +
      (all.length ? all.map(function (p) {
        var sub = p.watch ? "관찰 중 · 검증 기준 미달" : (prof.exp === "new" ? (p.sl ? "지금 국면에 맞는 전략이 고른 종목" : "비슷한 과거에 성적 좋았던 방법") : (p.sl ? "국면 전략" : "AI 선택")) + (p.stop ? " · 손절 −" + Number(p.stop).toFixed(0) + "%" : "") + " · 최대 " + p.hold + "일";
        return rowQ(p.s, sub, "", p.watch ? '<span class="tag2">관찰</span>' : buyBtn(p.s));
      }).join("") : '<div class="empty">지금 내 조건(' + HOR[prof.horizon] + ')에 맞는 AI 후보가 없습니다' + (PB && prof.mkts.some(function (m) { var r = PB.markets && PB.markets[m] && PB.markets[m].regime; return r === "BEAR" || r === "CRASH"; }) ? " — 약세장이라 시스템이 신규 매수를 줄이는 중이에요" : "") + '.<br>관심종목에서 직접 골라 모의 매수할 수 있어요.</div>') + "</section>";
    return h;
  }
  function watch() {
    var list = prof.watch.slice();
    if (wFilter === "sig") list = list.filter(function (s) { return !!sigOf(s); });
    if (wFilter === "held") list = list.filter(function (s) { return held(s) > 0; });
    var nSig = prof.watch.filter(function (s) { return !!sigOf(s); }).length, nHeld = prof.watch.filter(function (s) { return held(s) > 0; }).length;
    var h = '<label class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA9BF" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>' +
      '<input id="mineSearch" type="search" autocomplete="off" aria-label="종목 검색" placeholder="이름이나 코드 (엔비디아, NVDA, 삼성전자)"></label><div id="mineFound"></div>' +
      '<div class="chips">' + [["all", "전체 " + prof.watch.length], ["sig", "AI 신호 " + nSig], ["held", "보유 " + nHeld]].map(function (c) { return '<button type="button" data-wf="' + c[0] + '" class="' + (wFilter === c[0] ? "on" : "") + '">' + c[1] + "</button>"; }).join("") + "</div>";
    h += '<section class="card" style="margin-top:10px">' + (list.length ? list.map(function (s) {
      var sig = sigOf(s), hq = held(s);
      return rowQ(s, short(s) + (hq ? " · 보유 " + hq.toLocaleString() + "주" : ""), pill(sig), buyBtn(s) + '<button type="button" class="tag2" style="cursor:pointer;min-width:40px;justify-content:center" data-unwatch="' + esc(s) + '" aria-label="관심 해제">✕</button>');
    }).join("") : '<div class="empty">' + (prof.watch.length ? "이 조건에 맞는 종목이 없습니다" : "위 검색창에서 종목을 찾아 추가하거나 바로 사 보세요") + "</div>") + "</section>";
    return h;
  }
  function acctTab() {
    var mk = acMk, h = '<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 12px"><span class="h2">내 모의계좌</span><span class="seg">' + ["us", "kr"].map(function (m) { return '<button type="button" data-acmk="' + m + '" class="' + (m === mk ? "on" : "") + '">' + MK[m] + "</button>"; }).join("") + "</span></div>";
    if (!has(mk)) return h + '<section class="card"><div class="h2">' + MK[mk] + ' 모의계좌가 아직 없습니다</div><div class="note" style="margin-top:4px">가상 ' + fmt(mk, START[mk]) + '으로 시작 · 실제 돈은 쓰지 않습니다</div><div class="btns"><button type="button" class="b pri" data-open-acct="' + mk + '">계좌 만들기</button></div></section>';
    var a = prof.pf[mk], v = val(mk), ks = Object.keys(a.pos);
    h += '<section class="card"><div class="ct"><span>총자산 · ' + v.days + '일째</span></div><div class="h1">' + fmt(mk, v.eq) + '</div><div class="' + cls(v.ret) + '">' + fmt(mk, v.eq - a.start, true) + " (" + pctS(v.ret) + ")</div>" +
      '<div class="kv"><div><span>주문 가능</span>' + fmt(mk, v.cash) + '</div><div><span>주식</span>' + fmt(mk, v.mv) + '</div><div><span>평가손익</span><b class="' + cls(v.upl) + '" style="font-weight:600">' + fmt(mk, v.upl, true) + "</b></div></div></section>";
    h += '<section class="card"><div class="h2" style="margin-bottom:4px">보유 ' + ks.length + "종목</div>" + (ks.length ? ks.map(function (s) {
      var p = a.pos[s], cur = px(q(s)) || p.avg, r = (cur / p.avg - 1) * 100;
      return '<div class="row" data-open="' + esc(s) + '"><div class="l"><span class="nm">' + esc(nm(s)) + pill(sigOf(s)) + '</span><span class="sb">' + p.q.toLocaleString() + "주 · 평단 " + fmt(mk, p.avg) + '</span></div><div class="r"><span class="p">' + fmt(mk, p.q * cur) + '</span><span class="' + cls(r) + '" style="font-size:12.5px">' + pctS(r) + "</span></div>" +
        buyBtn(s) + '<button type="button" class="sell" data-sell="' + esc(s) + '">팔기</button></div>';
    }).join("") : '<div class="empty">홈의 AI 후보나 관심종목에서 [사기]를 눌러 보세요</div>') + "</section>";
    h += '<section class="card"><div class="h2" style="margin-bottom:4px">거래 내역</div>' + (a.hist.length ? a.hist.slice(0, 20).map(function (t) {
      return '<div class="row" data-open="' + esc(t[2]) + '"><div class="l"><span class="nm">' + esc(nm(t[2])) + '</span><span class="sb">' + new Date(t[0]).toLocaleString() + '</span></div><div class="r"><span class="' + (t[1] === "B" ? "up" : "dn") + '">' + (t[1] === "B" ? "매수" : "매도") + " " + t[3].toLocaleString() + '주</span><span class="sb">' + fmt(mk, t[4]) + "</span></div></div>";
    }).join("") : '<div class="empty">아직 거래가 없습니다</div>') + '<div class="note" style="margin-top:6px">체결가 = 그 순간 화면 시세(시간외 포함) · 수수료·세금 없음 · 모의투자</div></section>';
    return h;
  }
  function me() {
    var ops = function (k, map, cols, multi) { return '<div class="ops" data-k="' + k + '" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' + Object.keys(map).map(function (v) {
      var on = multi ? prof[k].indexOf(v) >= 0 : prof[k] === v; return '<button type="button" data-v="' + v + '" class="' + (on ? "on" : "") + '">' + map[v] + "</button>"; }).join("") + "</div>"; };
    var pk = !!(window.PublicKeyCredential && navigator.credentials);
    return '<section class="card">' + (prof.done ? '<div class="h2" style="margin-bottom:8px">투자 성향</div>' : '<div class="h2">처음이면 네 가지만 골라 주세요</div><div class="note" style="margin:4px 0 10px">답에 맞춰 홈의 시장 안내와 오늘 후보가 바뀝니다</div>') +
      ops("risk", RISK, 3) + '<span class="mu" style="font-size:13px">보유 기간</span>' + ops("horizon", HOR, 3) + '<span class="mu" style="font-size:13px">관심 시장</span>' + ops("mkts", MK, 2, true) + '<span class="mu" style="font-size:13px">투자 경험</span>' + ops("exp", EXP, 3) +
      (prof.done ? "" : '<button type="button" class="b pri" id="mineDone" style="width:100%">시작하기</button>') + "</section>" +
      '<section class="card"><div class="h2">로그인 · 내 데이터</div><div class="note" style="margin:4px 0 0">내 설정·관심종목·모의계좌는 <b>이 기기 코드(또는 내 패스키)로만</b> 열립니다. 다른 사람에게는 보이지 않아요. 이름·이메일·전화번호는 받지 않습니다.</div>' +
      (pk ? '<div class="btns"><button type="button" class="b pri" id="minePkReg">패스키로 이 계정 지키기</button><button type="button" class="b" id="minePkLogin">패스키로 로그인</button></div><div class="note" style="margin-top:6px">패스키 = Face ID·지문·화면 잠금으로 하는 로그인(비밀번호 없음). 같은 애플·구글 계정의 기기끼리 자동으로 이어집니다.</div>'
          : '<div class="note" style="margin-top:6px">이 브라우저는 패스키를 지원하지 않아 연결 코드로만 이어 쓸 수 있어요.</div>') +
      '<div class="btns"><button type="button" class="b" id="mineCopy">연결 코드 복사</button><button type="button" class="b" id="mineLinkOpen">다른 기기 코드 넣기</button></div>' +
      '<div id="mineLinkBox" style="display:none;margin-top:8px"><label class="search"><input id="mineCode" aria-label="연결 코드" placeholder="다른 기기의 연결 코드 붙여넣기"></label><div class="btns"><button type="button" class="b pri" id="mineLink">연결</button></div></div>' +
      '<div class="btns"><button type="button" class="b line" data-reset="' + acMk + '">' + MK[acMk] + ' 모의계좌 초기화</button><button type="button" class="b warn" id="mineDelete">내 데이터 삭제</button></div></section>' +
      '<section class="note" style="padding:0 6px">· 모의투자 서비스입니다. 가상 자금이며 실제 주문·자금 이동이 없습니다.<br>· 화면의 후보·안내는 투자 권유가 아니며, 수익을 약속하지 않습니다. 투자 판단과 결과의 책임은 본인에게 있습니다.<br>· 저장 항목: 성향·관심종목·모의계좌(이 기기 코드의 해시로 구분). 마지막 사용 후 1년이 지나면 자동 삭제되며, 위 [내 데이터 삭제]로 언제든 지울 수 있습니다.<br>· <a href="/privacy">개인정보 처리방침 · 이용 안내 전문</a></section>';
  }
  function draw() {
    var root = $("mineRoot"), pg = $("page-mine");
    if (!root || !pg || !pg.classList.contains("active")) return;
    css();
    if (!prof.done) tab = "me";
    var T = { home: "홈", watch: "관심", acct: "계좌", me: "내 정보" };
    var keep = ($("mineSearch") || {}).value || "";
    root.innerHTML = '<nav class="tabs" aria-label="MY 메뉴">' + Object.keys(T).map(function (k) { return '<button type="button" data-tab="' + k + '" class="' + (k === tab ? "on" : "") + '">' + T[k] + "</button>"; }).join("") + "</nav>" +
      (tab === "home" ? home() : tab === "watch" ? watch() : tab === "acct" ? acctTab() : me()) +
      '<p class="note" style="text-align:center;margin-top:10px">모의투자 · 가상 자금 · 투자 권유가 아닙니다' + (pbTs ? " · AI 판정 " + new Date(pbTs).toLocaleTimeString() : "") + "</p>";
    var s = $("mineSearch"); if (s) { s.value = keep; s.oninput = function () { found(s.value); }; if (keep) found(keep); }
  }
  function found(t) {
    var el = $("mineFound"); if (!el) return; t = (t || "").trim().toLowerCase();
    if (!t) { el.innerHTML = ""; return; }
    var r = quotes().filter(function (x) { return x.symbol && (x.symbol.toLowerCase().indexOf(t) >= 0 || (x.name || "").toLowerCase().indexOf(t) >= 0); }).slice(0, 8);
    el.innerHTML = '<section class="card" style="margin-top:8px">' + (r.length ? r.map(function (x) { var on = prof.watch.indexOf(x.symbol) >= 0;
      return rowQ(x.symbol, short(x.symbol), pill(sigOf(x.symbol)), buyBtn(x.symbol) + '<button type="button" class="tag2" style="cursor:pointer" data-addwatch="' + esc(x.symbol) + '">' + (on ? "★" : "☆ 관심") + "</button>"); }).join("")
      : '<div class="empty">찾는 종목이 없습니다(추적 중인 미국·한국 종목 안에서 찾습니다)</div>') + "</section>";
  }

  function sheet(side, sym) {
    var mk = isKr(sym) ? "kr" : "us";
    if (side === "B" && !has(mk)) { acct(mk); persist(); }
    var a = acct(mk), p = px(q(sym)); if (!p) { alert("지금 시세가 없어 주문할 수 없습니다"); return; }
    var hq = (a.pos[sym] || {}).q || 0, frac = side === "B" ? 0.25 : 1, qty = 0, col = side === "B" ? "#FF6B6B" : "#6FA0FF";
    var maxQ = function () { return side === "B" ? Math.floor(a.cash / p) : hq; };
    var setF = function (f) { frac = f; qty = side === "B" ? Math.floor(a.cash * f / p) : Math.floor(hq * f); };
    setF(frac);
    var sig = sigOf(sym), w = document.createElement("div"); w.id = "mineSheet";
    var paint = function () {
      qty = Math.max(0, Math.min(qty, maxQ()));
      w.innerHTML = '<section class="sh" role="dialog" aria-label="모의 ' + (side === "B" ? "매수" : "매도") + '" style="--c:' + col + '"><div class="grab" aria-hidden="true"></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline"><div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:19px;font-weight:700">' + esc(nm(sym)) + " " + (side === "B" ? "사기" : "팔기") + '</span><span style="font-size:12.5px;color:#9AA9BF">' + esc(short(sym)) + " · 현재가 " + fmt(mk, p) + '</span></div><span style="font-size:12.5px;color:#9AA9BF">' + (side === "B" ? "주문 가능 " + fmt(mk, a.cash) : "보유 " + hq.toLocaleString() + "주") + "</span></div>" +
        '<div class="pre">' + [0.1, 0.25, 0.5, 1].map(function (f) { return '<button type="button" data-f="' + f + '" class="' + (f === frac ? "on" : "") + '">' + (f === 1 ? (side === "B" ? "최대" : "전부") : f * 100 + "%") + "</button>"; }).join("") + "</div>" +
        '<div class="stp"><button type="button" data-st="-1" aria-label="1주 빼기">−</button><div style="display:flex;flex-direction:column;align-items:center"><span style="font-size:22px;font-weight:700">' + qty.toLocaleString() + '주</span><span style="font-size:12.5px;color:#9AA9BF">≈ ' + fmt(mk, qty * p) + '</span></div><button type="button" data-st="1" aria-label="1주 더하기">+</button></div>' +
        '<div style="display:flex;flex-direction:column;gap:4px"><div class="kv2"><span>AI 근거</span><span style="color:#C9D4E3">' + (sig ? (sig.watch ? "관찰 중(검증 기준 미달)" : sig.sl ? "국면 전략 편입" : "매매법 AI 후보") + (sig.stop ? " · 손절 −" + Number(sig.stop).toFixed(0) + "%" : "") : "AI 후보 아님 · 내 판단") + '</span></div><div class="kv2"><span>체결 기준</span><span style="color:#C9D4E3">지금 화면 시세 · 수수료 없음</span></div></div>' +
        '<button type="button" class="go" ' + (qty > 0 ? "" : "disabled") + ">" + (qty > 0 ? qty.toLocaleString() + "주 모의 " + (side === "B" ? "매수" : "매도") : (side === "B" ? "주문 가능 금액이 1주보다 적습니다" : "팔 수량이 없습니다")) + '</button><span style="font-size:11px;color:#7D8FA8;text-align:center">가상 자금 주문입니다 · 실제 증권 주문이 아닙니다</span></section>';
    };
    w.addEventListener("click", function (ev) {
      if (ev.target === w) { w.remove(); return; }
      var b = ev.target.closest("button"); if (!b) return;
      if (b.dataset.f) { setF(Number(b.dataset.f)); paint(); }
      else if (b.dataset.st) { qty += Number(b.dataset.st); frac = -1; paint(); }
      else if (b.classList.contains("go")) { var err = trade(side, sym, qty); if (err) { alert(err); return; } w.remove(); acMk = mk; tab = "acct"; draw(); }
    });
    paint(); document.body.appendChild(w);
  }

  // ── 패스키(WebAuthn) ──
  var b64u = function (buf) { var s = "", b = new Uint8Array(buf); for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  var unb64u = function (t) { t = t.replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; var s = atob(t), b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
  function pkReg() {
    if (!prof.done) { alert("먼저 성향 네 가지를 고르고 [시작하기]를 눌러 주세요"); return; }
    api("POST", prof).then(function () { return fetch("/api/me/passkey/options?kind=reg").then(function (r) { return r.json(); }); }).then(function (o) {
      return navigator.credentials.create({ publicKey: { rp: { id: o.rpId, name: "LUX" }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "LUX 투자자", displayName: "LUX 투자자" },
        challenge: unb64u(o.challenge), pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { residentKey: "required", userVerification: "preferred" }, attestation: "none", timeout: 120000 } });
    }).then(function (c) {
      return api("POST", { clientDataJSON: b64u(c.response.clientDataJSON), attestationObject: b64u(c.response.attestationObject) }, "/api/me/passkey/register");
    }).then(function (j) { alert(j && j.ok ? "패스키를 만들었어요. 다른 기기에서는 [패스키로 로그인]만 누르면 됩니다." : "패스키를 만들지 못했습니다: " + ((j && j.error) || "")); })
      .catch(function (e) { if (e && e.name !== "NotAllowedError") alert("패스키를 만들지 못했습니다: " + (e && e.message || e)); });
  }
  function pkLogin() {
    fetch("/api/me/passkey/options?kind=auth").then(function (r) { return r.json(); }).then(function (o) {
      return navigator.credentials.get({ publicKey: { challenge: unb64u(o.challenge), rpId: o.rpId, userVerification: "preferred", timeout: 120000 } });
    }).then(function (c) {
      return fetch("/api/me/passkey/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c.id, clientDataJSON: b64u(c.response.clientDataJSON), authenticatorData: b64u(c.response.authenticatorData), signature: b64u(c.response.signature) }) }).then(function (r) { return r.json(); });
    }).then(function (j) {
      if (!j || !j.ok || !j.uid) { alert("로그인하지 못했습니다: " + ((j && j.error) || "")); return; }
      try { localStorage.setItem(UIDK, j.uid); } catch (e) {}
      load(true); tab = "home"; setTimeout(draw, 600);
    }).catch(function (e) { if (e && e.name !== "NotAllowedError") alert("로그인하지 못했습니다: " + (e && e.message || e)); });
  }

  function onClick(ev) {
    var t = ev.target.closest("button,[data-open]"); if (!t || !$("mineRoot").contains(t)) return;
    var d = t.dataset;
    if (d.tab) { tab = d.tab; draw(); return; }
    if (d.buy) { ev.stopPropagation(); sheet("B", d.buy); return; }
    if (d.sell) { ev.stopPropagation(); sheet("S", d.sell); return; }
    if (d.openAcct) { acct(d.openAcct); persist(); acMk = d.openAcct; tab = "acct"; draw(); return; }
    if (d.acmk) { acMk = d.acmk; draw(); return; }
    if (d.wf) { wFilter = d.wf; draw(); return; }
    if (d.addwatch) { ev.stopPropagation(); var i = prof.watch.indexOf(d.addwatch); if (i >= 0) prof.watch.splice(i, 1); else if (prof.watch.length < 40) prof.watch.push(d.addwatch); persist(); draw(); return; }
    if (d.unwatch) { ev.stopPropagation(); prof.watch = prof.watch.filter(function (x) { return x !== d.unwatch; }); persist(); draw(); return; }
    if (d.reset) { if (confirm(MK[d.reset] + " 모의계좌를 처음 상태로 되돌릴까요?")) { if (prof.pf) delete prof.pf[d.reset]; persist(); draw(); } return; }
    if (d.v) { var g = t.closest("[data-k]"); if (!g) return; var k = g.getAttribute("data-k");
      if (k === "mkts") { var j = prof.mkts.indexOf(d.v); if (j >= 0 && prof.mkts.length > 1) prof.mkts.splice(j, 1); else if (j < 0) prof.mkts.push(d.v); } else prof[k] = d.v;
      if (prof.done) persist(); draw(); return; }
    if (t.id === "mineDone") { prof.done = true; persist(); tab = "home"; pbLoad(true); draw(); return; }
    if (t.id === "minePkReg") { pkReg(); return; }
    if (t.id === "minePkLogin") { pkLogin(); return; }
    if (t.id === "mineCopy") { var c = uid(); (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(function () { alert("연결 코드를 복사했어요. 다른 사람에게 알려 주지 마세요."); }).catch(function () { prompt("연결 코드(다른 사람에게 알려 주지 마세요)", c); }); return; }
    if (t.id === "mineLinkOpen") { var bx = $("mineLinkBox"); if (bx) bx.style.display = "block"; return; }
    if (t.id === "mineLink") { var code = (($("mineCode") || {}).value || "").trim().toLowerCase();
      if (!/^[0-9a-f]{32,64}$/.test(code)) { alert("연결 코드 형식이 아닙니다"); return; }
      try { localStorage.setItem(UIDK, code); } catch (e) {}
      api("GET").then(function (j) { if (j && j.profile) { adopt(j.profile); tab = "home"; draw(); } else alert("그 코드의 데이터를 찾지 못했습니다"); }); return; }
    if (t.id === "mineDelete") {
      if (!confirm("서버에 저장된 내 성향·관심종목·모의계좌·패스키를 모두 지웁니다. 되돌릴 수 없어요. 지울까요?")) return;
      api("DELETE").then(function () { try { localStorage.removeItem(PROFK); localStorage.setItem(UIDK, newUid()); } catch (e) {} prof = Object.assign({}, DEF); tab = "me"; draw(); alert("삭제했습니다."); }).catch(function () { alert("삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요."); });
      return; }
    if (d.open && typeof window.openDetailFromSym === "function") window.openDetailFromSym(d.open);
  }

  function onShow() { load(false); pbLoad(false); draw(); }
  function boot() {
    var pg = $("page-mine"), root = $("mineRoot"); if (!pg || !root) return;
    root.addEventListener("click", onClick);
    new MutationObserver(function () { if (pg.classList.contains("active")) onShow(); }).observe(pg, { attributes: true, attributeFilter: ["class"] });
    if (pg.classList.contains("active")) onShow();
    setInterval(function () { if (!document.hidden && pg.classList.contains("active")) { pbLoad(false); var ae = document.activeElement; if (!$("mineSheet") && !(ae && (ae.id === "mineSearch" || ae.id === "mineCode"))) draw(); } }, 60000);
  }
  window.luxMine = { draw: draw };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
