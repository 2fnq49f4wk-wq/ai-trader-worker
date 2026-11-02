/* [V33.723] ★MY(내 투자) 재디자인★ — 사용자 11/2 시안(아티팩트 'LUX MY 화면 리디자인') 반영 · 기능은 V33.721 그대로 + 고친 것:
   · 모의 매수: '오늘 후보' 에만 있던 [사기] 를 관심종목·검색 결과 모든 종목에(후보가 비면 살 길이 없었다) · 주문창 ±1주
   · [V33.729] 로그인 = 닉네임 + 비밀번호(패스키 뺌) — 서버는 비밀번호를 저장하지 않고 PBKDF2 확인값만 · 기기 코드는 비밀번호로 잠가 둔다
   · 내 데이터 삭제(서버 프로필·모의계좌·계정) · 보존 1년(서버가 지움)
   ★비용★: /api/me 읽기는 MY 첫 열림 1회 · 쓰기는 조작 2초 모아 1회 · 그리기·/api/playbook(엣지 캐시)은 MY 가 보일 때만 3분 · 시세는 대시보드가 받은 것 재사용.
   개인 데이터는 이 기기 코드(또는 내 닉네임·비밀번호)로만 열린다 — 다른 사람에게 보이지 않는다. 모의투자 · 투자 권유 아님. */
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
  var DEF = { risk: "mid", mkts: ["us", "kr"], horizon: "swing", exp: "mid", watch: [], done: false, pf: null, nick: null };
  var prof = null; try { prof = JSON.parse(localStorage.getItem(PROFK) || "null"); } catch (e) {}
  prof = Object.assign({}, DEF, prof || {});
  var tab = "home", acMk = "us", wFilter = "all", PB = null, pbTs = 0, loaded = false, saveT = 0;
  var MK = { us: "미국", kr: "한국" }, RISK = { safe: "안정형", mid: "중립형", aggr: "공격형" }, HOR = { scalp: "단타", swing: "스윙", long: "중장기" }, EXP = { "new": "처음", mid: "경험", pro: "전문가" };
  var REG = { SURGE: "급등장", BULL: "상승장", NEUTRAL: "횡보장", BEAR: "하락장", CRASH: "급락장" };
  var REGC = { SURGE: "#FF5C5C", BULL: "#FF8C7A", NEUTRAL: "#E2C766", BEAR: "#7FA6FF", CRASH: "#5C86FF" };
  var GUIDE = {
    SURGE: { safe: "추격 매수는 피하고 이익 일부 실현", mid: "신규는 작게, 손절선 올려 이익 지키기", aggr: "추세 종목 짧게, 손절 엄수" },
    BULL: { safe: "국면 전략 종목 위주로 나눠 사기", mid: "AI 후보 중 분할 매수", aggr: "주도주 비중 확대, 추세 길게" },
    NEUTRAL: { safe: "현금 비중 유지, 관망", mid: "신호 뜬 종목만 골라 짧게", aggr: "박스권 반등 매매, 목표 짧게" },
    BEAR: { safe: "신규 매수 줄이고 현금·방어주", mid: "소액·분할만, 손절 엄수", aggr: "인버스·단기 반등만 짧게" },
    CRASH: { safe: "신규 매수 멈추고 현금 보존", mid: "관망 · 첫 양봉 뒤 소액만", aggr: "공황 반등 단타만, 손절 짧게" }
  };
  var START = { us: 10000, kr: 10000000 };
  var ACOL = ["#3DD6B5", "#7FA6FF", "#E2C766", "#FF8C7A", "#B9A6FF", "#5FC8E8", "#9BD67A", "#F0A0C8"];
  var isKr = function (s) { return /\.(KS|KQ)$/.test(s); };
  var fmt = function (mk, v, sign) { if (v == null || !isFinite(v)) return "—"; var a = Math.abs(v), s = sign ? (v >= 0 ? "+" : "−") : (v < 0 ? "−" : "");
    return mk === "kr" ? s + "₩" + Math.round(a).toLocaleString() : s + "$" + a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var pctS = function (v) { return v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) + "%"; };
  var cls = function (v) { return v == null ? "" : v >= 0 ? "up" : "dn"; };

  function api(method, body, path, extra) {
    return fetch(path || "/api/me", { method: method, headers: Object.assign({ "x-lux-uid": uid() }, body ? { "content-type": "application/json" } : {}, extra || {}), body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json(); });
  }
  function saveLocal() { try { localStorage.setItem(PROFK, JSON.stringify(prof)); } catch (e) {} }
  function persist() { saveLocal(); clearTimeout(saveT); saveT = setTimeout(function () { api("POST", prof).then(function (j) {
    if (j && j.pfRejected && j.profile) { adopt(j.profile); draw(); alert("모의계좌 기록이 서버 시세와 맞지 않아 마지막으로 확인된 상태로 되돌렸습니다(" + j.pfRejected + ")."); }
    else if (j && j.profile && j.profile.nick !== undefined) { prof.nick = j.profile.nick; saveLocal(); }
  }).catch(function () {}); }, 2000); }
  function adopt(p) { prof = Object.assign({}, DEF, p || {}); saveLocal(); }
  function load(force) {
    if (loaded && !force) return; loaded = true;
    api("GET").then(function (j) { if (j && j.profile) { adopt(j.profile); draw(); } else if (prof.done) persist(); }).catch(function () {});
  }

  function quotes() { return window.__lastQuotesArr || []; }
  function q(sym) { var a = quotes(); for (var i = 0; i < a.length; i++) if (a[i].symbol === sym) return a[i]; return null; }
  function chg(x) { var v = x && (typeof x.regPct === "number" ? x.regPct : x.dayPct); return typeof v === "number" ? v : null; }
  function px(x) { return x && x.price > 0 ? x.price : null; }
  function liveItem(sym) { var mk = isKr(sym) ? "kr" : "us", it = (PB && PB.live && PB.live[mk] && PB.live[mk].items) || []; for (var i = 0; i < it.length; i++) if (it[i].s === sym) return it[i]; return null; }
  function priceOf(sym) { var p = px(q(sym)); if (p) return p; var it = liveItem(sym); return it && it.px > 0 ? it.px : null; }   // [V33.724] 워치리스트 밖 AI 후보도 살 수 있게(판정 시세)
  function nm(sym) { var x = q(sym); if (x && x.name) return x.name; var it = liveItem(sym); return (it && it.nm) || sym; }
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
  /* [V33.724] ★AI 가 지금 사고 싶은 순위★(사용자 11/2) — ① 매수 신호(매매법 AI·국면 전략이 고르고 검증 통과) ② AI 가 골랐지만 검증 대기(그림자·관측)
     ③ AI 점수(OMNI-Q) 상위 — 각 단계 안에서는 OMNI-Q 점수 순. 종전 '오늘 후보' 는 ①②만 · 보유 기간으로 걸러 약세장·장 마감에 비어 보였다. */
  function ranked(mk) {
    var it = (PB && PB.live && PB.live[mk] && PB.live[mk].items) || [];
    return it.map(function (x) {
      var w = /관측|미달|미통과|그림자|스캔만/.test(x.why || ""), tier = x.pb ? (w ? 1 : 0) : 2;
      return { s: x.s, tier: tier, q: Number(x.q) || 0, sl: /^RG:/.test(x.pb || ""), pb: x.pb, stop: x.stop, hold: x.hold };
    }).sort(function (a, b) { return a.tier - b.tier || b.q - a.q; }).slice(0, 12);
  }
  function rankSub(r) {
    var top = Math.max(1, Math.round((1 - r.q) * 100));
    var head = r.tier === 0 ? "매수 신호" : r.tier === 1 ? (r.sl ? "국면 전략 · 검증 대기" : "AI 선택 · 검증 대기") : "AI 점수 상위";
    if (prof.exp === "new") head = r.tier === 0 ? "AI가 지금 사려는 종목" : r.tier === 1 ? "AI가 골랐지만 아직 검증 중" : "AI 점수가 높은 종목";
    return head + " · OMNI-Q 상위 " + top + "%" + (r.stop ? " · 손절 −" + Number(r.stop).toFixed(0) + "%" : "");
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
    var mk = isKr(sym) ? "kr" : "us", a = acct(mk), price = priceOf(sym);
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
      "#mineRoot{--m-bg:#0D1014;--m-card:#161A21;--m-line:#232935;--m-chip:#20262F;--m-mute:#98A2B3;--m-acc:#3DD6B5;--m-up:#FF5C5C;--m-dn:#4D8DFF;width:100%;max-width:760px;margin:0 auto;padding:6px 4px 96px;box-sizing:border-box;font-size:14.5px;color:var(--fg,#EEF1F5)}",
      "#mineRoot *{box-sizing:border-box}#mineRoot .up{color:var(--m-up)}#mineRoot .dn{color:var(--m-dn)}#mineRoot .mu{color:var(--m-mute)}",
      "#mineRoot .tabs{position:sticky;top:0;z-index:5;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;padding:5px;margin:0 0 14px;border-radius:16px;background:var(--m-card);border:1px solid var(--m-line)}",
      "#mineRoot .tabs button{min-height:44px;border:0;border-radius:12px;background:transparent;color:var(--m-mute);font-size:14.5px;font-weight:600;cursor:pointer}#mineRoot .tabs button.on{background:var(--m-chip);color:#fff}",
      "#mineRoot .card{background:var(--m-card);border-radius:20px;padding:16px 18px;margin:0 0 12px}#mineRoot .ct{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;color:var(--m-mute);margin-bottom:6px}",
      "#mineRoot .h1{font-size:30px;font-weight:700;letter-spacing:-.5px}#mineRoot .h2{font-size:16px;font-weight:700}",
      "#mineRoot .seg{display:inline-flex;gap:3px;background:var(--m-bg);border-radius:10px;padding:3px}#mineRoot .seg button{border:0;border-radius:8px;padding:6px 12px;font-size:12.5px;background:transparent;color:var(--m-mute);cursor:pointer}#mineRoot .seg button.on{background:var(--m-chip);color:#fff;font-weight:700}",
      "#mineRoot .btns{display:flex;gap:8px;margin-top:12px}#mineRoot .b{flex:1;min-height:46px;border-radius:12px;border:0;font-size:14.5px;font-weight:600;cursor:pointer;background:var(--m-chip);color:#EEF1F5}#mineRoot .b.pri{background:var(--m-acc);color:#04110D;font-weight:700}#mineRoot .b.line{background:transparent;border:1px solid #2E3542;color:#C7CDD6}#mineRoot .b.warn{background:transparent;border:1px solid #5A2A2F;color:#FF8A8A}",
      "#mineRoot .g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 12px}#mineRoot .wx{background:var(--m-card);border-radius:16px;padding:14px}#mineRoot .wx b{display:block;font-size:18px;margin:4px 0}",
      "#mineRoot .row{display:flex;align-items:center;gap:12px;padding:12px 2px;border-top:1px solid var(--m-line);cursor:pointer}#mineRoot .row:first-of-type{border-top:0}",
      "#mineRoot .av{flex:0 0 38px;height:38px;border-radius:19px;background:var(--m-chip);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;overflow:hidden}",
      "#mineRoot .l{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}#mineRoot .nm{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#mineRoot .sb{font-size:12px;color:var(--m-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#mineRoot .r{display:flex;flex-direction:column;align-items:flex-end;gap:2px;white-space:nowrap}#mineRoot .r .p{font-size:14.5px;font-weight:600}",
      "#mineRoot .buy,#mineRoot .sell,#mineRoot .tag2{min-height:40px;padding:0 14px;border-radius:10px;border:0;font-size:13.5px;font-weight:700;cursor:pointer;color:#fff;background:var(--m-up)}#mineRoot .sell{background:var(--m-dn)}#mineRoot .tag2{background:var(--m-chip);color:var(--m-mute);font-weight:500;cursor:default;display:inline-flex;align-items:center}",
      "#mineRoot .pill{font-size:11px;padding:2px 6px;border-radius:6px;margin-left:5px;background:#173A33;color:#5FE0C4;vertical-align:middle}#mineRoot .pill.s{background:#2A2440;color:#B9A6FF}#mineRoot .pill.w{background:#20252E;color:var(--m-mute)}",
      "#mineRoot .chips{display:flex;gap:6px;margin:10px 0 2px;flex-wrap:wrap}#mineRoot .chips button{min-height:36px;border-radius:18px;padding:0 14px;font-size:13px;border:1px solid #2A303B;background:transparent;color:#C7CDD6;cursor:pointer}#mineRoot .chips button.on{background:#EEF1F5;color:#0D1014;border-color:#EEF1F5;font-weight:700}",
      "#mineRoot .search{display:flex;align-items:center;gap:8px;background:var(--m-card);border:1px solid #2A303B;border-radius:14px;padding:0 14px;min-height:48px}#mineRoot .search input{flex:1;border:0;outline:0;background:transparent;color:inherit;font-size:15px;font-family:inherit;min-width:0}",
      "#mineRoot .ops{display:grid;gap:6px;margin:6px 0 12px}#mineRoot .ops button{min-height:44px;border-radius:12px;border:1px solid #2E3542;background:transparent;color:#C7CDD6;font-size:13.5px;cursor:pointer}#mineRoot .ops button.on{background:var(--m-acc);border-color:var(--m-acc);color:#04110D;font-weight:700}",
      "#mineRoot .kv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}#mineRoot .kv div{display:flex;flex-direction:column;gap:2px}#mineRoot .kv span{font-size:11.5px;color:var(--m-mute)}",
      "#mineRoot .note{font-size:11.5px;line-height:1.55;color:#8A93A3}#mineRoot .empty{padding:16px 2px;color:var(--m-mute);font-size:13.5px;line-height:1.5}",
      "#mineRoot .rk{flex:0 0 22px;text-align:center;font-size:15px;font-weight:700;color:var(--m-mute)}#mineRoot .rk.hot{color:var(--m-acc)}#mineRoot .wbtn{cursor:pointer;min-width:52px;justify-content:center;border:1px solid #2E3542;background:transparent;color:#C7CDD6}#mineRoot .wbtn.on{color:var(--m-acc);border-color:#22574B}",
      "@media (max-width:520px){#mineRoot{padding:4px 0 96px;font-size:14px}#mineRoot .card{border-radius:16px;padding:14px}#mineRoot .h1{font-size:26px}#mineRoot .row{gap:8px;padding:11px 0}#mineRoot .buy,#mineRoot .sell,#mineRoot .tag2{min-height:38px;padding:0 11px;font-size:13px}#mineRoot .r .p{font-size:13.5px}#mineRoot .sb{font-size:11.5px}#mineRoot .tabs{margin-bottom:10px}#mineRoot .g2{gap:8px}}",
      // [V33.729] 내 정보(프로필 머리·설정 목록) · 계좌 비중 막대 · 내 순위 카드
      "#mineRoot .hi{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:2px 4px 12px;font-size:15px}#mineRoot .hi b{color:var(--m-acc)}#mineRoot .hi .mu{font-size:12.5px}",
      "#mineRoot .pf{background:linear-gradient(135deg,#17322C 0%,#161A21 55%);border:1px solid #1F3A34}#mineRoot .pfh{display:flex;align-items:center;gap:14px}#mineRoot .av2{flex:0 0 56px;height:56px;border-radius:28px;background:linear-gradient(135deg,#3DD6B5,#2A8F7C);color:#04110D;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800}",
      "#mineRoot .pn{font-size:21px;font-weight:700;letter-spacing:-.3px}#mineRoot .ok{color:var(--m-acc)}#mineRoot .st3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.07)}#mineRoot .st3 div{display:flex;flex-direction:column;gap:3px}#mineRoot .st3 span{font-size:11.5px;color:var(--m-mute)}#mineRoot .st3 b{font-size:17px}",
      "#mineRoot .sec{font-size:12.5px;font-weight:700;color:var(--m-mute);letter-spacing:.3px;margin:18px 6px 8px}#mineRoot .tg{display:flex;flex-wrap:wrap;gap:6px}#mineRoot .tg span{padding:7px 12px;border-radius:18px;background:var(--m-chip);font-size:13.5px}",
      "#mineRoot .lst{padding:4px 0}#mineRoot .li{display:flex;align-items:center;gap:12px;width:100%;min-height:54px;padding:0 16px;border:0;border-top:1px solid var(--m-line);background:transparent;color:inherit;font:inherit;font-size:15px;text-align:left;text-decoration:none;cursor:pointer}#mineRoot .lst>.li:first-child{border-top:0}",
      "#mineRoot .li .ic{flex:0 0 30px;height:30px;border-radius:9px;background:var(--m-chip);display:flex;align-items:center;justify-content:center;font-size:14px;color:#C7CDD6}#mineRoot .li .lb{flex:1;min-width:0}#mineRoot .li .rv{color:var(--m-mute);font-size:13.5px;white-space:nowrap}#mineRoot .li .ch{color:#4A5261;font-size:20px}#mineRoot .li.warn{color:#FF8A8A}#mineRoot .li.on .ch{transform:rotate(90deg)}",
      "#mineRoot .pwf{display:flex;flex-direction:column;gap:8px;padding:4px 16px 14px}#mineRoot .pwf input{min-height:46px;border-radius:12px;border:1px solid #2E3542;background:var(--m-bg);color:inherit;padding:0 14px;font-size:15px;font-family:inherit}#mineRoot .err{margin:0;min-height:1em;color:#FF8A8A;font-size:13px}",
      "#mineRoot .myrk{display:flex;justify-content:space-between;align-items:center;border:1px solid #1F3A34}#mineRoot .myrk .l{gap:3px}#mineRoot .alloc{display:flex;height:8px;border-radius:4px;overflow:hidden;margin-top:14px;gap:2px}#mineRoot .alloc i{display:block;height:100%;min-width:2px}#mineRoot .kv4{grid-template-columns:repeat(4,minmax(0,1fr))}#mineRoot .dot{flex:0 0 8px;height:8px;border-radius:4px}",
      "@media (max-width:520px){#mineRoot .kv4{grid-template-columns:repeat(2,minmax(0,1fr))}#mineRoot .pn{font-size:19px}#mineRoot .st3 b{font-size:15.5px}}",
      // [V33.729] 로그인 창(닉네임 + 비밀번호)
      "#luxGate .hd{display:flex;justify-content:space-between;align-items:center;padding-top:calc(18px + env(safe-area-inset-top))}#luxGate .x{width:44px;height:44px;border-radius:22px;border:0;background:#161A21;color:#98A2B3;font-size:16px}#luxGate .lead{margin:10px 0 0;font-size:14.5px;line-height:1.6;color:var(--g-mute)}",
      "#luxGate .sw{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:14px;background:#161A21;margin:22px 0 14px}#luxGate .sw button{min-height:42px;border:0;border-radius:10px;background:transparent;color:#98A2B3;font-size:14.5px;font-weight:600}#luxGate .sw button.on{background:#262C36;color:#fff}",
      "#luxGate form{display:flex;flex-direction:column;gap:12px}#luxGate .f{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:#98A2B3}#luxGate .f input{min-height:52px;border-radius:14px;border:1px solid #2E3542;background:#161A21;color:#EEF1F5;padding:0 16px;font-size:16px;font-family:inherit;outline:0}#luxGate .f input:focus{border-color:#3DD6B5}",
      "#luxGate .ag{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;line-height:1.5;color:#C7CDD6}#luxGate .ag input{width:20px;height:20px;margin:1px 0 0;accent-color:#3DD6B5;flex:0 0 20px}#luxGate .ag a{color:#5FE0C4}#luxGate .err{margin:0;min-height:18px;color:#FF8A8A;font-size:13.5px}#luxGate .p1:disabled{opacity:.6}#luxGate .fine{margin:14px 0 0;font-size:11.5px;line-height:1.6;color:#7E8796;text-align:center}#luxGate .in{overflow-y:auto}#luxGate h1{margin-top:22px}",
      "#luxGate{--g-mute:#98A2B3;position:fixed;inset:0;z-index:10050;background:rgba(13,16,20,.97);color:#EEF1F5;display:flex;justify-content:center;font-family:inherit}#luxGate .in{width:min(440px,100%);display:flex;flex-direction:column;padding:0 24px calc(28px + env(safe-area-inset-bottom))}",
      "#luxGate h1{margin:0;font-size:29px;line-height:1.3;font-weight:700;letter-spacing:-.5px}#luxGate .lg{width:64px;height:64px;border-radius:18px;background:#161A21;border:1px solid #2A303B;display:flex;align-items:center;justify-content:center}",
      "#luxGate button{font-family:inherit;cursor:pointer}#luxGate .p1{min-height:56px;border-radius:16px;border:0;background:#3DD6B5;color:#04110D;font-size:16.5px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px}#luxGate .p2{min-height:52px;border-radius:16px;border:1px solid #2E3542;background:transparent;color:#EEF1F5;font-size:15.5px}#luxGate .p3{min-height:48px;border:0;background:transparent;color:#98A2B3;font-size:14.5px;text-decoration:underline}",
      "#mineDetailBar{margin:0 0 10px}#mineDetailBar .mdb{display:flex;align-items:center;gap:8px;background:#161A21;border:1px solid #232935;border-radius:14px;padding:10px 12px;color:#EEF1F5}#mineDetailBar .l{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}#mineDetailBar .nm{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#mineDetailBar .sb{font-size:12px;color:#98A2B3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#mineDetailBar .buy,#mineDetailBar .sell,#mineDetailBar .wbtn2{min-height:42px;padding:0 14px;border-radius:10px;border:0;font-size:14px;font-weight:700;cursor:pointer;color:#fff;background:#FF5C5C}#mineDetailBar .sell{background:#4D8DFF}#mineDetailBar .wbtn2{background:transparent;border:1px solid #2E3542;color:#C7CDD6;font-weight:500}",
      "#mineSheet{position:fixed;inset:0;z-index:9999;background:rgba(4,8,16,.62);display:flex;align-items:flex-end;justify-content:center}",
      "#mineSheet .sh{width:min(520px,100%);background:#181C24;border-radius:22px 22px 0 0;padding:10px 20px calc(22px + env(safe-area-inset-bottom));color:#EEF1F5;display:flex;flex-direction:column;gap:14px;font-size:14px}",
      "#mineSheet .grab{width:40px;height:4px;border-radius:2px;background:#2E3542;align-self:center}#mineSheet .pre{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}",
      "#mineSheet .pre button{min-height:44px;border-radius:12px;border:1px solid #2E3542;background:transparent;color:#C7CDD6;font-size:14px;cursor:pointer}#mineSheet .pre button.on{border:2px solid var(--c);color:var(--c);font-weight:700}",
      "#mineSheet .stp{display:flex;align-items:center;justify-content:space-between;background:#0D1014;border-radius:14px;padding:6px 8px}#mineSheet .stp button{width:44px;height:44px;border-radius:12px;border:0;background:#20262F;color:#EEF1F5;font-size:22px;cursor:pointer}",
      "#mineSheet .go{min-height:54px;border-radius:14px;border:0;font-size:16px;font-weight:700;color:#fff;background:var(--c);cursor:pointer}#mineSheet .go:disabled{opacity:.45;cursor:default}#mineSheet .kv2{display:flex;justify-content:space-between;font-size:12.5px;color:#98A2B3}"
    ].join("");
    document.head.appendChild(st);
  }

  function rowQ(sym, sub, tags, right, rank, tier) {
    var x = q(sym), c = chg(x), p = px(x), li = (!p || c == null) ? liveItem(sym) : null;
    if (!p && li) p = li.px; if (c == null && li && typeof li.dp === "number") c = li.dp;
    return '<div class="row" data-open="' + esc(sym) + '">' + (rank ? '<span class="rk' + (tier === 0 ? " hot" : "") + '">' + rank + "</span>" : '<div class="av">' + esc(short(sym).slice(0, 4)) + "</div>") + '<div class="l"><span class="nm">' + esc(nm(sym)) + (tags || "") + '</span><span class="sb">' + esc(sub) + "</span></div>" +
      '<div class="r"><span class="p">' + (p ? (isKr(sym) ? "₩" + Math.round(p).toLocaleString() : "$" + p.toFixed(2)) : "—") + '</span><span class="' + cls(c) + '" style="font-size:12.5px">' + pctS(c) + "</span></div>" + (right || "") + "</div>";
  }
  function pill(sig) { return !sig ? "" : sig.watch ? '<span class="pill w">관찰</span>' : sig.sl ? '<span class="pill s">국면 전략</span>' : '<span class="pill">AI 후보</span>'; }
  function buyBtn(sym) { return '<button type="button" class="buy" data-buy="' + esc(sym) + '">사기</button>'; }

  function home() {
    var mk = has(acMk) ? acMk : (has("us") ? "us" : has("kr") ? "kr" : acMk), v = val(mk), h = "", hr = new Date().getHours();
    h += '<div class="hi"><span>' + (hr < 12 ? "좋은 아침이에요" : hr < 18 ? "좋은 오후예요" : "좋은 저녁이에요") + (prof.nick ? ", <b>" + esc(prof.nick) + "</b>님" : "") + '</span><span class="mu">' + RISK[prof.risk] + " · " + HOR[prof.horizon] + "</span></div>";
    h += '<section class="card" aria-label="모의계좌"><div class="ct"><span>모의계좌 총자산</span><span class="seg">' + ["us", "kr"].map(function (m) { return '<button type="button" data-acmk="' + m + '" class="' + (m === mk ? "on" : "") + '">' + MK[m] + "</button>"; }).join("") + "</span></div>" +
      (v ? '<div class="h1">' + fmt(mk, v.eq) + '</div><div class="' + cls(v.ret) + '">' + fmt(mk, v.eq - prof.pf[mk].start, true) + " (" + pctS(v.ret) + ") · 시작 후 " + v.days + "일</div>"
         : '<div class="h2" style="margin:6px 0 2px">가상 ' + fmt(mk, START[mk]) + '으로 AI 후보를 따라 사 보세요</div><div class="note">실제 돈은 쓰지 않습니다 · 내 성적이 이 기기에만 쌓입니다</div>') +
      '<div class="btns">' + (v ? '<button type="button" class="b pri" data-tab="acct">내 계좌 보기</button>' : '<button type="button" class="b pri" data-open-acct="' + mk + '">' + MK[mk] + " 계좌 만들기</button>") + '<button type="button" class="b" data-tab="watch">종목 찾기</button></div></section>';
    h += '<div class="g2">' + prof.mkts.map(function (m) { var r = PB && PB.markets && PB.markets[m] && PB.markets[m].regime;
      return '<div class="wx"><span class="mu" style="font-size:12px">' + MK[m] + ' 시장</span><b style="color:' + (REGC[r] || "inherit") + '">' + (REG[r] || "불러오는 중") + '</b><span style="font-size:12.5px;line-height:1.45;color:#C7CDD6">' + esc(r && GUIDE[r] ? GUIDE[r][prof.risk] : "") + "</span></div>"; }).join("") + "</div>";
    var rmk = prof.mkts.indexOf(acMk) >= 0 ? acMk : prof.mkts[0], rk = ranked(rmk), rg = PB && PB.markets && PB.markets[rmk] && PB.markets[rmk].regime;
    h += '<section class="card" aria-label="AI 순위"><div class="ct"><span class="h2" style="color:#EEF1F5">AI가 지금 사고 싶은 순위</span>' +
      (prof.mkts.length > 1 ? '<span class="seg">' + prof.mkts.map(function (m) { return '<button type="button" data-acmk="' + m + '" class="' + (m === rmk ? "on" : "") + '">' + MK[m] + "</button>"; }).join("") + "</span>" : '<span>' + MK[rmk] + "</span>") + "</div>" +
      (rk.length ? rk.map(function (r, i) {
        var on = prof.watch.indexOf(r.s) >= 0;
        return rowQ(r.s, rankSub(r), "", '<button type="button" class="tag2 wbtn' + (on ? " on" : "") + '" data-addwatch="' + esc(r.s) + '" aria-label="관찰에 ' + (on ? "담김" : "추가") + '">' + (on ? "관찰중" : "관찰") + "</button>" + buyBtn(r.s), i + 1, r.tier);
      }).join("") : '<div class="empty">AI 판정을 불러오는 중이거나 아직 오늘 판정이 없습니다.</div>') +
      '<div class="note" style="margin-top:6px">' + MK[rmk] + " " + (REG[rg] || "") + " · 순위 = 매수 신호 → 검증 대기 → AI 점수 순 · 관찰 = 관심종목에 담기 · 모의투자</div></section>";
    return h;
  }
  function watch() {
    var list = prof.watch.slice();
    if (wFilter === "sig") list = list.filter(function (s) { return !!sigOf(s); });
    if (wFilter === "held") list = list.filter(function (s) { return held(s) > 0; });
    var nSig = prof.watch.filter(function (s) { return !!sigOf(s); }).length, nHeld = prof.watch.filter(function (s) { return held(s) > 0; }).length;
    var h = '<label class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#98A2B3" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>' +
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
      '<div class="alloc" aria-label="자산 비중">' + (v.eq > 0 ? ks.map(function (s, i) { var p = a.pos[s], w = p.q * (px(q(s)) || p.avg) / v.eq * 100; return '<i style="width:' + w.toFixed(2) + '%;background:' + ACOL[i % ACOL.length] + '" title="' + esc(nm(s)) + " " + w.toFixed(1) + '%"></i>'; }).join("") : "") + '<i style="flex:1;background:#2A303B" title="현금"></i></div>' +
      '<div class="kv kv4"><div><span>주문 가능</span>' + fmt(mk, v.cash) + '</div><div><span>주식</span>' + fmt(mk, v.mv) + '</div><div><span>평가손익</span><b class="' + cls(v.upl) + '" style="font-weight:600">' + fmt(mk, v.upl, true) + '</b></div><div><span>실현손익</span><b class="' + cls(v.eq - a.start - v.upl) + '" style="font-weight:600">' + fmt(mk, v.eq - a.start - v.upl, true) + "</b></div></div></section>";
    h += '<section class="card"><div class="h2" style="margin-bottom:4px">보유 ' + ks.length + "종목</div>" + (ks.length ? ks.map(function (s) {
      var p = a.pos[s], cur = px(q(s)) || p.avg, r = (cur / p.avg - 1) * 100;
      return '<div class="row" data-open="' + esc(s) + '"><span class="dot" style="background:' + ACOL[ks.indexOf(s) % ACOL.length] + '" aria-hidden="true"></span><div class="l"><span class="nm">' + esc(nm(s)) + pill(sigOf(s)) + '</span><span class="sb">' + p.q.toLocaleString() + "주 · 평단 " + fmt(mk, p.avg) + " · 비중 " + (v.eq > 0 ? (p.q * cur / v.eq * 100).toFixed(0) : 0) + '%</span></div><div class="r"><span class="p">' + fmt(mk, p.q * cur) + '</span><span class="' + cls(r) + '" style="font-size:12.5px">' + pctS(r) + "</span></div>" +
        buyBtn(s) + '<button type="button" class="sell" data-sell="' + esc(s) + '">팔기</button></div>';
    }).join("") : '<div class="empty">홈의 AI 후보나 관심종목에서 [사기]를 눌러 보세요</div>') + "</section>";
    h += '<section class="card"><div class="h2" style="margin-bottom:4px">거래 내역</div>' + (a.hist.length ? a.hist.slice(0, 20).map(function (t) {
      return '<div class="row" data-open="' + esc(t[2]) + '"><div class="l"><span class="nm">' + esc(nm(t[2])) + '</span><span class="sb">' + new Date(t[0]).toLocaleString() + '</span></div><div class="r"><span class="' + (t[1] === "B" ? "up" : "dn") + '">' + (t[1] === "B" ? "매수" : "매도") + " " + t[3].toLocaleString() + '주</span><span class="sb">' + fmt(mk, t[4]) + "</span></div></div>";
    }).join("") : '<div class="empty">아직 거래가 없습니다</div>') + '<div class="note" style="margin-top:6px">체결가 = 그 순간 화면 시세(시간외 포함) · 수수료·세금 없음 · 모의투자</div></section>';
    return h;
  }
  /* [V33.729] ★내 정보 새 디자인★(사용자 11/2) — 프로필 머리(닉네임·가입일·두 계좌 수익률·관심 수) → 투자 성향(요약 칩 · [바꾸기]로 펼침)
     → 계정(비밀번호 바꾸기·언어·로그아웃) → 모의계좌(시장별 초기화) → 데이터·약관(처리방침·내 데이터 삭제). 설정 앱처럼 줄 단위 목록. */
  var meEdit = false, pwOpen = false;
  function me() {
    var ops = function (k, map, cols, multi) { return '<div class="ops" data-k="' + k + '" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' + Object.keys(map).map(function (v) {
      var on = multi ? prof[k].indexOf(v) >= 0 : prof[k] === v; return '<button type="button" data-v="' + v + '" class="' + (on ? "on" : "") + '">' + map[v] + "</button>"; }).join("") + "</div>"; };
    var nick = prof.nick || authNick(), since = authSince(), vu = val("us"), vk = val("kr");
    var stat = function (lb, v) { return '<div><span>' + lb + '</span><b class="' + (v ? cls(v.ret) : "mu") + '">' + (v ? pctS(v.ret) : "—") + "</b></div>"; };
    var li = function (id, ic, lb, right, extra) { return '<button type="button" class="li' + (extra || "") + '" id="' + id + '"><span class="ic" aria-hidden="true">' + ic + '</span><span class="lb">' + lb + '</span><span class="rv">' + (right || "") + '</span><span class="ch" aria-hidden="true">›</span></button>'; };
    var h = '<section class="card pf"><div class="pfh"><div class="av2" aria-hidden="true">' + esc((nick || "?").slice(0, 1).toUpperCase()) + '</div><div class="l"><span class="pn">' + esc(nick || "게스트") + '</span><span class="sb">' +
      (isAuth() ? '<span class="ok">● 로그인됨</span>' + (since ? " · " + new Date(since).toLocaleDateString() + " 가입" : "") : "로그인하지 않음") + "</span></div></div>" +
      '<div class="st3">' + stat("미국 계좌", vu) + stat("한국 계좌", vk) + '<div><span>관심종목</span><b>' + prof.watch.length + "</b></div></div></section>";
    var open = meEdit || !prof.done;
    h += '<div class="sec">투자 성향</div><section class="card">' + (prof.done && !open
      ? '<div class="tg">' + [RISK[prof.risk], HOR[prof.horizon], prof.mkts.map(function (m) { return MK[m]; }).join("·"), (prof.exp === "new" ? "투자 처음" : prof.exp === "pro" ? "전문가" : "경험 있음")].map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("") + '</div><div class="note" style="margin-top:8px">이 성향에 맞춰 홈의 시장 안내와 AI 순위 설명이 바뀝니다.</div><div class="btns"><button type="button" class="b line" id="meEdit">성향 바꾸기</button></div>'
      : (prof.done ? "" : '<div class="h2">처음이면 네 가지만 골라 주세요</div><div class="note" style="margin:4px 0 10px">답에 맞춰 홈의 시장 안내와 AI 순위 설명이 바뀝니다</div>') +
        '<span class="mu" style="font-size:13px">위험 성향</span>' + ops("risk", RISK, 3) + '<span class="mu" style="font-size:13px">보유 기간</span>' + ops("horizon", HOR, 3) + '<span class="mu" style="font-size:13px">관심 시장</span>' + ops("mkts", MK, 2, true) + '<span class="mu" style="font-size:13px">투자 경험</span>' + ops("exp", EXP, 3) +
        (prof.done ? '<button type="button" class="b pri" id="meEditDone" style="width:100%">완료</button>' : '<button type="button" class="b pri" id="mineDone" style="width:100%">시작하기</button>')) + "</section>";
    var en = window.luxLang && window.luxLang.get && window.luxLang.get() === "en";
    h += '<div class="sec">계정</div><section class="card lst">' +
      (isAuth() ? li("mePw", "🔒", "비밀번호 바꾸기", "", pwOpen ? " on" : "") +
        (pwOpen ? '<form id="mePwForm" class="pwf" novalidate><input id="mePw0" type="password" autocomplete="current-password" placeholder="지금 비밀번호" maxlength="64"><input id="mePw1" type="password" autocomplete="new-password" placeholder="새 비밀번호(8자 이상)" maxlength="64"><input id="mePw2" type="password" autocomplete="new-password" placeholder="새 비밀번호 확인" maxlength="64"><p id="mePwErr" class="err" role="alert"></p><button type="submit" class="b pri">비밀번호 바꾸기</button></form>' : "")
        : li("meLogin", "👤", "로그인 · 회원가입", "")) +
      li("meLang", "🌐", "언어", en ? "English" : "한국어") +
      (isAuth() ? li("meOut", "↩", "로그아웃", "") : "") + "</section>";
    h += '<div class="sec">모의계좌</div><section class="card lst">' + ["us", "kr"].map(function (m) {
      return '<button type="button" class="li" data-reset="' + m + '"><span class="ic" aria-hidden="true">' + (m === "us" ? "$" : "₩") + '</span><span class="lb">' + MK[m] + ' 계좌 처음부터</span><span class="rv">' + (has(m) ? fmt(m, val(m).eq) : "없음") + '</span><span class="ch" aria-hidden="true">›</span></button>'; }).join("") + "</section>";
    h += '<div class="sec">데이터 · 약관</div><section class="card lst"><a class="li" href="/privacy"><span class="ic" aria-hidden="true">§</span><span class="lb">개인정보 처리방침 · 이용 안내</span><span class="rv"></span><span class="ch" aria-hidden="true">›</span></a>' +
      li("mineDelete", "🗑", "내 데이터 · 계정 삭제", "", " warn") + "</section>";
    h += '<section class="note" style="padding:2px 6px">· 모의투자 서비스입니다. 가상 자금이며 실제 주문·자금 이동이 없습니다.<br>· 화면의 후보·안내는 투자 권유가 아니며, 수익을 약속하지 않습니다. 투자 판단과 결과의 책임은 본인에게 있습니다.<br>· 저장 항목: 닉네임 · 비밀번호 확인값(비밀번호 자체는 저장하지 않음) · 성향 · 관심종목 · 모의계좌. 마지막 사용 후 1년이 지나면 자동 삭제되며, [내 데이터 · 계정 삭제]로 언제든 지울 수 있습니다.</section>';
    return h;
  }
  /* [V33.725] ★수익률 순위★ — 서버가 1시간에 한 번 계산한 표(/api/leaderboard)를 받는다. 이 기기는 5분에 한 번만 다시 받는다. */
  var LB = null, lbTs = 0, rkMk = "us";
  function lbLoad(force) { if (!force && Date.now() - lbTs < 300000) return; lbTs = Date.now(); fetch("/api/leaderboard").then(function (r) { return r.json(); }).then(function (j) { LB = j; draw(); }).catch(function () {}); }
  function rankTab() {
    lbLoad(false);
    var rows = (LB && LB[rkMk]) || [], me = prof.nick;
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 12px"><span class="h2">모의투자 수익률 순위</span><span class="seg">' + ["us", "kr"].map(function (m) { return '<button type="button" data-rkmk="' + m + '" class="' + (m === rkMk ? "on" : "") + '">' + MK[m] + "</button>"; }).join("") + "</span></div>";
    var myI = -1; for (var ii = 0; ii < rows.length; ii++) if (me && rows[ii].nick === me) { myI = ii; break; }
    var mv = val(rkMk);
    h += '<section class="card myrk"><div class="l"><span class="sb">내 순위 · ' + MK[rkMk] + '</span><span class="h1" style="font-size:26px">' + (myI >= 0 ? (myI + 1) + "위" : "순위 밖") + '</span><span class="sb">' +
      (myI >= 0 ? "상위 " + rows.length + "명 중" : !mv ? MK[rkMk] + " 모의계좌가 아직 없어요" : prof.pf[rkMk].hist.length ? "다음 정각 계산에 반영되거나 상위 50 밖이에요" : "거래 1건 이상이면 순위에 들어가요") + '</span></div><div class="r"><span class="sb">내 수익률</span><span class="h2 ' + (mv ? cls(mv.ret) : myI >= 0 ? cls(rows[myI].ret) : "mu") + '">' + (mv ? pctS(mv.ret) : myI >= 0 ? pctS(rows[myI].ret) : "—") + "</span></div></section>";
    h += '<section class="card">' + (rows.length ? rows.map(function (r, i) {
      var mine = me && r.nick === me;
      return '<div class="row" style="cursor:default' + (mine ? ";background:rgba(61,214,181,.08);border-radius:10px" : "") + '"><span class="rk' + (i < 3 ? " hot" : "") + '">' + (i + 1) + '</span><div class="l"><span class="nm">' + esc(r.nick) + (mine ? ' <span class="pill">나</span>' : "") + '</span><span class="sb">' + r.days + "일째 · 보유 " + r.n + '종목</span></div><div class="r"><span class="p ' + cls(r.ret) + '">' + pctS(r.ret) + "</span></div></div>";
    }).join("") : '<div class="empty">' + (LB ? "아직 순위에 오른 계좌가 없습니다. 첫 번째가 되어 보세요." : "순위를 불러오는 중…") + "</div>") +
      '<div class="note" style="margin-top:6px">서버가 실제 시세로 1시간마다 다시 계산합니다' + (LB && LB.ts ? " · " + new Date(LB.ts).toLocaleTimeString() + " 기준" : "") + " · 가상 자금 · 투자 권유 아님</div></section>";
    return h;
  }
  /* [V33.725] ★종목 상세의 모의 매매 막대★ — 관심종목에서 종목을 누르면 상세로 가는데 거기서 살 수 없었다(사용자 11/2) */
  var detSym = null;
  function detail(sym) {
    detSym = sym; var pg = $("page-detail"); if (!pg || !sym) return; css();
    var bar = $("mineDetailBar");
    if (!bar) { bar = document.createElement("section"); bar.id = "mineDetailBar"; bar.setAttribute("aria-label", "모의 매매"); pg.insertBefore(bar, pg.firstChild);
      bar.addEventListener("click", function (ev) { var b = ev.target.closest("button"); if (!b) return; if (!isAuth()) { ask("mine"); return; } if (b.dataset.dbuy) sheet("B", detSym); else if (b.dataset.dsell) sheet("S", detSym); else if (b.dataset.dwatch) { var i = prof.watch.indexOf(detSym); if (i >= 0) prof.watch.splice(i, 1); else if (prof.watch.length < 40) prof.watch.push(detSym); persist(); detail(detSym); } }); }
    var hq = held(sym), on = prof.watch.indexOf(sym) >= 0, mk = isKr(sym) ? "kr" : "us";
    bar.innerHTML = '<div class="mdb"><div class="l"><span class="nm">내 모의계좌 · ' + esc(nm(sym)) + '</span><span class="sb">' + (hq ? "보유 " + hq.toLocaleString() + "주" : "보유 없음") + (has(mk) ? " · 주문 가능 " + fmt(mk, prof.pf[mk].cash) : " · 첫 주문 때 가상 " + fmt(mk, START[mk]) + " 계좌가 열립니다") + "</span></div>" +
      '<button type="button" class="wbtn2" data-dwatch="1">' + (on ? "관찰중" : "관찰") + '</button>' + (hq ? '<button type="button" class="sell" data-dsell="1">팔기</button>' : "") + '<button type="button" class="buy" data-dbuy="1">사기</button></div>';
  }
  function draw() {
    if (detSym && $("page-detail") && $("page-detail").classList.contains("active")) detail(detSym);
    var root = $("mineRoot"), pg = $("page-mine");
    if (!root || !pg || !pg.classList.contains("active")) return;
    css();
    if (!prof.done) tab = "me";
    var T = { home: "홈", watch: "관심", acct: "계좌", rank: "순위", me: "내 정보" };
    var keep = ($("mineSearch") || {}).value || "";
    root.innerHTML = '<nav class="tabs" aria-label="MY 메뉴">' + Object.keys(T).map(function (k) { return '<button type="button" data-tab="' + k + '" class="' + (k === tab ? "on" : "") + '">' + T[k] + "</button>"; }).join("") + "</nav>" +
      (tab === "home" ? home() : tab === "watch" ? watch() : tab === "acct" ? acctTab() : tab === "rank" ? rankTab() : me()) +
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
    var a = acct(mk), p = priceOf(sym); if (!p) { alert("지금 시세가 없어 주문할 수 없습니다"); return; }
    var hq = (a.pos[sym] || {}).q || 0, frac = side === "B" ? 0.25 : 1, qty = 0, col = side === "B" ? "#FF5C5C" : "#4D8DFF";
    var maxQ = function () { return side === "B" ? Math.floor(a.cash / p) : hq; };
    var setF = function (f) { frac = f; qty = side === "B" ? Math.floor(a.cash * f / p) : Math.floor(hq * f); };
    setF(frac);
    var sig = sigOf(sym), w = document.createElement("div"); w.id = "mineSheet";
    var paint = function () {
      qty = Math.max(0, Math.min(qty, maxQ()));
      w.innerHTML = '<section class="sh" role="dialog" aria-label="모의 ' + (side === "B" ? "매수" : "매도") + '" style="--c:' + col + '"><div class="grab" aria-hidden="true"></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline"><div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:19px;font-weight:700">' + esc(nm(sym)) + " " + (side === "B" ? "사기" : "팔기") + '</span><span style="font-size:12.5px;color:#98A2B3">' + esc(short(sym)) + " · 현재가 " + fmt(mk, p) + '</span></div><span style="font-size:12.5px;color:#98A2B3">' + (side === "B" ? "주문 가능 " + fmt(mk, a.cash) : "보유 " + hq.toLocaleString() + "주") + "</span></div>" +
        '<div class="pre">' + [0.1, 0.25, 0.5, 1].map(function (f) { return '<button type="button" data-f="' + f + '" class="' + (f === frac ? "on" : "") + '">' + (f === 1 ? (side === "B" ? "최대" : "전부") : f * 100 + "%") + "</button>"; }).join("") + "</div>" +
        '<div class="stp"><button type="button" data-st="-1" aria-label="1주 빼기">−</button><div style="display:flex;flex-direction:column;align-items:center"><span style="font-size:22px;font-weight:700">' + qty.toLocaleString() + '주</span><span style="font-size:12.5px;color:#98A2B3">≈ ' + fmt(mk, qty * p) + '</span></div><button type="button" data-st="1" aria-label="1주 더하기">+</button></div>' +
        '<div style="display:flex;flex-direction:column;gap:4px"><div class="kv2"><span>AI 근거</span><span style="color:#C7CDD6">' + (sig ? (sig.watch ? "관찰 중(검증 기준 미달)" : sig.sl ? "국면 전략 편입" : "매매법 AI 후보") + (sig.stop ? " · 손절 −" + Number(sig.stop).toFixed(0) + "%" : "") : "AI 후보 아님 · 내 판단") + '</span></div><div class="kv2"><span>체결 기준</span><span style="color:#C7CDD6">지금 화면 시세 · 수수료 없음</span></div></div>' +
        '<button type="button" class="go" ' + (qty > 0 ? "" : "disabled") + ">" + (qty > 0 ? qty.toLocaleString() + "주 모의 " + (side === "B" ? "매수" : "매도") : (side === "B" ? "주문 가능 금액이 1주보다 적습니다" : "팔 수량이 없습니다")) + '</button><span style="font-size:11px;color:#7E8796;text-align:center">가상 자금 주문입니다 · 실제 증권 주문이 아닙니다</span></section>';
    };
    w.addEventListener("click", function (ev) {
      if (ev.target === w) { w.remove(); return; }
      var b = ev.target.closest("button"); if (!b) return;
      if (b.dataset.f) { setF(Number(b.dataset.f)); paint(); }
      else if (b.dataset.st) { qty += Number(b.dataset.st); frac = -1; paint(); }
      else if (b.classList.contains("go")) { var err = trade(side, sym, qty); if (err) { alert(err); return; } w.remove(); acMk = mk; tab = "acct"; draw(); if (detSym === sym) detail(sym); }
    });
    paint(); document.body.appendChild(w);
  }

  // ── [V33.729] 로그인 = 닉네임 + 비밀번호 ──
  // 로그인 상태는 이 브라우저에 닉네임(lux-auth)으로 기억한다. 서버 계정은 이 기기 코드(uid)를 비밀번호로 잠가 두고, 로그인하면 그 코드를 돌려준다.
  function isAuth() { try { return !!localStorage.getItem("lux-auth"); } catch (e) { return false; } }
  function authNick() { try { return localStorage.getItem("lux-auth") || ""; } catch (e) { return ""; } }
  function authSince() { try { return Number(localStorage.getItem("lux-auth-ts")) || 0; } catch (e) { return 0; } }
  function remember(nick, since) { try { localStorage.setItem("lux-auth", nick); if (since) localStorage.setItem("lux-auth-ts", String(since)); localStorage.removeItem("lux-pk"); localStorage.removeItem("lux-gate"); } catch (e) {} try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {} }
  function authPost(path, body) { return fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-lux-uid": uid() }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
  function signup(nick, pw) {
    return api("POST", Object.assign({}, prof)).catch(function () {}).then(function () { return authPost("/api/auth/signup", { nick: nick, pw: pw }); }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || "가입하지 못했어요");
      remember(j.nick, j.created); prof.nick = j.nick; saveLocal(); return j;
    });
  }
  function login(nick, pw) {
    return authPost("/api/auth/login", { nick: nick, pw: pw }).then(function (j) {
      if (!j || !j.ok || !j.uid) throw new Error((j && j.error) || "로그인하지 못했어요");
      try { localStorage.setItem(UIDK, j.uid); localStorage.removeItem(PROFK); } catch (e) {}
      prof = Object.assign({}, DEF, { nick: j.nick, done: true }); remember(j.nick, j.created); loaded = false; load(true); tab = "home"; return j;
    });
  }
  function logout(silent) {
    if (!silent && !confirm("로그아웃할까요? 다시 쓰려면 닉네임과 비밀번호로 로그인하면 됩니다.")) return;
    try { localStorage.removeItem("lux-auth"); localStorage.removeItem("lux-auth-ts"); localStorage.removeItem(PROFK); localStorage.setItem(UIDK, newUid()); } catch (e) {}
    prof = Object.assign({}, DEF); loaded = false; tab = "home";
    if (typeof window.showPage === "function") window.showPage("dashboard");
  }
  /* [V33.729] ★로그인 창★ — 대시보드·종목 상세 밖 메뉴로 갈 때 뜬다(V33.727 흐름 그대로). 탭 둘: 로그인 / 회원가입. 오류는 창 안에 글로(팝업 없음). */
  var PGN = { mine: "MY(내 투자)", positions: "포지션", macro: "뉴스·환율", nnviz: "AI 두뇌", trades: "거래 기록", report: "AI 리포트", whatif: "WHAT-IF" };
  function ask(target, mode) {
    if ($("luxGate")) return;
    css();
    var m = mode || (authNick() || prof.nick ? "login" : "signup"), busy = false;
    var w = document.createElement("div"); w.id = "luxGate"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "LUX-INV 로그인");
    var paint = function () {
      var su = m === "signup";
      w.innerHTML = '<div class="in"><div class="hd"><div class="lg"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3DD6B5" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19"></path></svg></div>' +
        '<button type="button" class="x" id="gClose" aria-label="닫기">✕</button></div>' +
        "<h1>" + (su ? "닉네임 하나로<br>모의투자를 시작하세요" : "다시 오셨네요") + '</h1><p class="lead">' + esc(PGN[target] || "이 메뉴") + "는 로그인 후 쓸 수 있어요. 대시보드와 종목 상세는 로그인 없이 볼 수 있습니다.</p>" +
        '<div class="sw" role="tablist"><button type="button" role="tab" data-m="login" class="' + (su ? "" : "on") + '" aria-selected="' + !su + '">로그인</button><button type="button" role="tab" data-m="signup" class="' + (su ? "on" : "") + '" aria-selected="' + su + '">회원가입</button></div>' +
        '<form id="gForm" novalidate><label class="f"><span>닉네임</span><input id="gNick" autocomplete="username" maxlength="12" placeholder="2~12자 한글·영문·숫자" value="' + esc(authNick() || prof.nick || "") + '"></label>' +
        '<label class="f"><span>비밀번호</span><input id="gPw" type="password" autocomplete="' + (su ? "new-password" : "current-password") + '" maxlength="64" placeholder="' + (su ? "8자 이상" : "비밀번호") + '"></label>' +
        (su ? '<label class="f"><span>비밀번호 확인</span><input id="gPw2" type="password" autocomplete="new-password" maxlength="64" placeholder="한 번 더"></label>' +
              '<label class="ag"><input type="checkbox" id="gAgree"><span><a href="/privacy" target="_blank" rel="noopener">이용 안내·개인정보 처리방침</a>에 동의합니다 · 모의투자이며 투자 권유가 아님을 이해했습니다</span></label>' : "") +
        '<p id="gErr" class="err" role="alert"></p><button type="submit" class="p1" id="gGo">' + (su ? "가입하고 시작하기" : "로그인") + "</button></form>" +
        '<button type="button" class="p3" id="gGuest">나중에 · 대시보드로 계속</button>' +
        '<p class="fine">이메일·이름·전화번호를 받지 않습니다 · 비밀번호는 서버에 저장되지 않고 확인용 값만 남습니다' + (su ? " · 로그인 없이 쓰던 관심종목·모의계좌는 이 계정으로 옮겨집니다" : "") + "<br>비밀번호를 잊으면 되찾을 수 없어요(이메일을 받지 않기 때문) — 꼭 기억해 두세요.</p></div>";
      var nk = $("gNick"); if (nk) setTimeout(function () { try { (nk.value ? $("gPw") : nk).focus(); } catch (e) {} }, 30);
    };
    var err = function (t) { var e = $("gErr"); if (e) e.textContent = t || ""; };
    var done = function (go) { w.remove(); if (go && typeof window.showPage === "function") window.showPage(target || "mine"); };
    w.addEventListener("click", function (ev) {
      if (ev.target === w) { done(false); return; }
      var b = ev.target.closest("button"); if (!b) return;
      if (b.dataset.m) { m = b.dataset.m; paint(); return; }
      if (b.id === "gClose" || b.id === "gGuest") done(false);
    });
    w.addEventListener("submit", function (ev) {
      ev.preventDefault(); if (busy) return;
      var nick = ($("gNick").value || "").trim(), pw = $("gPw").value || "";
      if (!/^[가-힣A-Za-z0-9_]{2,12}$/.test(nick)) { err("닉네임은 2~12자 한글·영문·숫자·_ 만 쓸 수 있어요"); return; }
      if (m === "signup") {
        if (pw.length < 8) { err("비밀번호는 8자 이상으로 정해 주세요"); return; }
        if (pw !== ($("gPw2").value || "")) { err("비밀번호 확인이 다릅니다"); return; }
        if (!$("gAgree").checked) { err("이용 안내·개인정보 처리방침에 동의해 주세요"); return; }
      } else if (!pw) { err("비밀번호를 넣어 주세요"); return; }
      busy = true; err(""); var g = $("gGo"); g.disabled = true; g.textContent = m === "signup" ? "가입하는 중…" : "로그인하는 중…";
      (m === "signup" ? signup(nick, pw) : login(nick, pw)).then(function () { if (m === "signup" && !prof.done) tab = "me"; done(true); })
        .catch(function (e) { busy = false; g.disabled = false; g.textContent = m === "signup" ? "가입하고 시작하기" : "로그인"; err(String(e && e.message || e)); });
    });
    paint(); document.body.appendChild(w);
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
    if (d.rkmk) { rkMk = d.rkmk; draw(); return; }
    if (d.addwatch) { ev.stopPropagation(); var i = prof.watch.indexOf(d.addwatch); if (i >= 0) prof.watch.splice(i, 1); else if (prof.watch.length < 40) prof.watch.push(d.addwatch); persist(); draw(); return; }
    if (d.unwatch) { ev.stopPropagation(); prof.watch = prof.watch.filter(function (x) { return x !== d.unwatch; }); persist(); draw(); return; }
    if (d.reset) { if (confirm(MK[d.reset] + " 모의계좌를 처음 상태로 되돌릴까요?")) { if (prof.pf) delete prof.pf[d.reset]; persist(); draw(); } return; }
    if (d.v) { var g = t.closest("[data-k]"); if (!g) return; var k = g.getAttribute("data-k");
      if (k === "mkts") { var j = prof.mkts.indexOf(d.v); if (j >= 0 && prof.mkts.length > 1) prof.mkts.splice(j, 1); else if (j < 0) prof.mkts.push(d.v); } else prof[k] = d.v;
      if (prof.done) persist(); draw(); return; }
    if (t.id === "mineDone") { prof.done = true; persist(); tab = "home"; pbLoad(true); draw(); return; }
    if (t.id === "meEdit") { meEdit = true; draw(); return; }
    if (t.id === "meEditDone") { meEdit = false; draw(); return; }
    if (t.id === "mePw") { pwOpen = !pwOpen; draw(); if (pwOpen && $("mePw0")) $("mePw0").focus(); return; }
    if (t.id === "meLogin") { ask("mine", "login"); return; }
    if (t.id === "meOut") { logout(false); return; }
    if (t.id === "meLang") { if (window.luxLang) window.luxLang.set(window.luxLang.get() === "en" ? "ko" : "en"); return; }
    if (t.id === "mineDelete") {
      if (!confirm("서버에 저장된 내 계정(닉네임)·성향·관심종목·모의계좌를 모두 지웁니다. 되돌릴 수 없어요. 지울까요?")) return;
      api("DELETE").then(function () { alert("삭제했습니다."); logout(true); }).catch(function () { alert("삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요."); });
      return; }
    if (d.open && typeof window.openDetailFromSym === "function") window.openDetailFromSym(d.open);
  }

  function onShow() { load(false); pbLoad(false); draw(); }
  function boot() {
    var pg = $("page-mine"), root = $("mineRoot"); if (!pg || !root) return;
    root.addEventListener("click", onClick);
    root.addEventListener("submit", function (ev) {   // [V33.729] 비밀번호 바꾸기
      if (ev.target.id !== "mePwForm") return; ev.preventDefault();
      var e0 = $("mePwErr"), say = function (t) { if (e0) e0.textContent = t; }, p0 = $("mePw0").value, p1 = $("mePw1").value;
      if (p1.length < 8) { say("새 비밀번호는 8자 이상으로 정해 주세요"); return; }
      if (p1 !== $("mePw2").value) { say("새 비밀번호 확인이 다릅니다"); return; }
      authPost("/api/auth/password", { nick: prof.nick || authNick(), pw: p0, newPw: p1 }).then(function (j) {
        if (j && j.ok) { pwOpen = false; draw(); alert("비밀번호를 바꿨어요."); } else say((j && j.error) || "바꾸지 못했어요");
      }).catch(function () { say("바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요"); });
    });
    new MutationObserver(function () { if (pg.classList.contains("active")) onShow(); }).observe(pg, { attributes: true, attributeFilter: ["class"] });
    if (pg.classList.contains("active")) onShow();
    setInterval(function () { if (!document.hidden && pg.classList.contains("active")) { pbLoad(false); var ae = document.activeElement; if (!$("mineSheet") && !(ae && (ae.id === "mineSearch" || /^mePw/.test(ae.id || "")))) draw(); } }, 60000);
  }
  window.luxMine = { draw: draw, detail: detail, ask: ask };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
