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
  var REGC0 = { SURGE: "#FF5C5C", BULL: "#FF8C7A", NEUTRAL: "#E2C766", BEAR: "#7FA6FF", CRASH: "#5C86FF" }, REGCL = { SURGE: "#B42318", BULL: "#B54708", NEUTRAL: "#7A5A00", BEAR: "#1D4ED8", CRASH: "#1E3A8A" };   // [V33.734] 라이트는 흰 바탕 대비 4.5:1 이상
  var REGC = new Proxy({}, { get: function (o, k) { return (document.documentElement.getAttribute("data-theme") === "light" ? REGCL : REGC0)[k]; } });
  var GUIDE = {
    SURGE: { safe: "추격 매수는 피하고 이익 일부 실현", mid: "신규는 작게, 손절선 올려 이익 지키기", aggr: "추세 종목 짧게, 손절 엄수" },
    BULL: { safe: "국면 전략 종목 위주로 분할 매수", mid: "AI 후보 중 분할 매수", aggr: "주도주 비중 확대, 추세 길게" },
    NEUTRAL: { safe: "현금 비중 유지, 관망", mid: "신호 뜬 종목만 골라 짧게", aggr: "박스권 반등 매매, 목표 짧게" },
    BEAR: { safe: "신규 매수 줄이고 현금·방어주", mid: "소액·분할만, 손절 엄수", aggr: "인버스·단기 반등만 짧게" },
    CRASH: { safe: "신규 매수 멈추고 현금 보존", mid: "관망 · 첫 양봉 뒤 소액만", aggr: "공황 반등 단타만, 손절 짧게" }
  };
  var START = { us: 10000, kr: 10000000 };
  var TERMS_VER = "2026-11-02";   // [V33.734] 약관·개인정보처리방침 판 — 가입 때 서버에 동의 기록(판·시각)으로 남는다
  /* [V33.732] 비밀번호 보기 버튼(사용자 11/2 "입력한 비밀번호 볼 수 있게") — 누르면 글자로 보이고 다시 누르면 가린다 */
  var EYE = '<button type="button" class="eye" data-eye="1" aria-label="비밀번호 보기" aria-pressed="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>';
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("button[data-eye]"); if (!b) return; ev.preventDefault(); ev.stopPropagation();
    var inp = b.parentNode.querySelector("input"); if (!inp) return; var show = inp.type === "password";
    inp.type = show ? "text" : "password"; b.setAttribute("aria-pressed", String(show)); b.setAttribute("aria-label", show ? "비밀번호 가리기" : "비밀번호 보기"); b.classList.toggle("on", show);
  }, true);
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
  var editSeq = 0;   // [V33.740] 이 기기에서 바꾼 횟수 — 불러오기 응답이 늦게 와도 그 사이 바꾼 것을 덮지 않게
  /* [V33.741] ★저장 안정화★(사용자 11/3 "MY 시스템 안정화")
     · 아직 서버에 못 간 변경을 기기에 표시(lux-prof-dirty) — 2초 안에 창을 닫거나 저장이 실패해도 다음 열 때 이 기기 값을 보낸다(서버 옛 값으로 덮지 않음)
     · 실패하면 5초 → 15초 → 45초 … (최대 2분) 다시 보냄 · 연결이 돌아오면(online) 바로 보냄 · 창을 닫거나 숨길 때 keepalive 로 마저 보냄
     · 화면에 저장 상태(저장 중 · 저장됨 · 실패) 표시 · 요청 수는 그대로(바꿀 때만 · 2초 모아 1회) */
  var DIRTYK = "lux-prof-dirty", sync = { st: "", ts: 0, fail: 0 }, retryT = 0;
  var resetQ = [];   // [V33.746] 초기화한 시장 — 서버는 빠진 시장을 지키므로 초기화는 이렇게 분명히 알린다
  function dirty(on) { try { if (on) localStorage.setItem(DIRTYK, String(Date.now())); else localStorage.removeItem(DIRTYK); } catch (e) {} }
  function isDirty() { try { return !!localStorage.getItem(DIRTYK); } catch (e) { return false; } }
  function syncHtml() {
    var st = sync.st, t = st === "saving" || st === "pending" ? ["sv", "저장 중…"] : st === "fail" ? ["bad", "저장 실패 · 곧 다시 보냄"] : st === "offline" ? ["bad", "오프라인 · 연결되면 저장"] : st === "ok" ? ["ok", "<span>저장됨</span> <span>" + new Date(sync.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + "</span>"] : isDirty() ? ["sv", "저장 대기"] : ["ok", "서버와 같음"];
    return '<span id="mineSync" class="sync ' + t[0] + '" role="status" aria-live="polite"><i aria-hidden="true"></i>' + t[1] + "</span>";
  }
  function setSync(st) { sync.st = st; if (st === "ok") sync.ts = Date.now(); var el = $("mineSync"); if (el) el.outerHTML = syncHtml(); }
  var synced = false, loadingNow = false;   // [V33.746] 이번 접속에서 서버 사본을 한 번 받았나 — 받기 전엔 저장을 미룬다(빈 사본이 다른 기기 기록을 덮지 않게)
  function push() {
    clearTimeout(saveT); clearTimeout(retryT); saveT = 0; retryT = 0;
    if (!synced && isAuth()) { load(true); retryT = setTimeout(push, 5000); return; }
    var seq = editSeq, who = uid(), rs = resetQ.slice(); setSync("saving");
    return api("POST", rs.length ? Object.assign({}, prof, { resetMk: rs }) : prof).then(function (j) {
      if (who !== uid()) return;   // 그 사이 로그인·로그아웃 — 이 응답은 다른 계정 것
      if (!j || j.ok === false) throw new Error((j && j.error) || "save");
      resetQ = resetQ.filter(function (m) { return rs.indexOf(m) < 0; });
      /* [V33.746] 서버가 더 새 모의계좌를 지켰다(다른 기기에서 거래함) — 그 시장은 서버 것으로 맞춘다 */
      if (j.pfKept && j.profile && j.profile.pf) { if (!prof.pf) prof.pf = {}; j.pfKept.forEach(function (m) { prof.pf[m] = j.profile.pf[m]; }); saveLocal(); draw(); }
      if (j.pfRejected && j.profile) { adopt(j.profile); draw(); alert("모의계좌 기록이 서버 시세와 맞지 않아 마지막으로 확인된 상태로 되돌렸습니다(" + j.pfRejected + ")."); }
      else if (j.profile && j.profile.nick !== undefined) { prof.nick = j.profile.nick; saveLocal(); }
      if (editSeq === seq) dirty(false);   // 보내는 사이 또 바뀌었으면 표시를 남겨 다음 저장이 보낸다
      sync.fail = 0; setSync("ok");
    }).catch(function (e) {
      if (who !== uid()) return;
      sync.fail++; setSync(navigator.onLine === false ? "offline" : "fail");
      if (/too large|bad body/.test(String(e && e.message))) return;   // 다시 보내도 같은 답
      retryT = setTimeout(push, Math.min(120000, 5000 * Math.pow(3, Math.min(4, sync.fail - 1))));
    });
  }
  function persist() { editSeq++; saveLocal(); dirty(true); clearTimeout(saveT); saveT = setTimeout(push, 2000); setSync("pending"); }
  function flush() {   // 창을 닫거나 다른 앱으로 갈 때 — 남은 변경을 keepalive 로(응답을 못 받으면 표시가 남아 다음에 다시 보냄)
    if (!isDirty() || (!synced && isAuth())) return; clearTimeout(saveT); saveT = 0;
    try { fetch("/api/me", { method: "POST", keepalive: true, headers: { "x-lux-uid": uid(), "content-type": "application/json" }, body: JSON.stringify(resetQ.length ? Object.assign({}, prof, { resetMk: resetQ.slice() }) : prof) }).then(function (r) { return r.json(); }).then(function (j) { if (j && j.ok && !j.pfRejected) { dirty(false); sync.fail = 0; setSync("ok"); } }).catch(function () {}); } catch (e) {}
  }
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
  addEventListener("online", function () { if (isDirty()) push(); });
  function adopt(p) { prof = Object.assign({}, DEF, p || {}); saveLocal(); }
  function load(force) {
    if (loaded && !force) return; loaded = true;
    /* [V33.740] ★로그인 뒤 저장이 안 되던 버그★ — 불러오기(GET)가 늦게 오면 그 사이 바꾼 것을 옛 서버 값으로 덮었다.
       [V33.741] 서버에 아직 못 간 변경(lux-prof-dirty)이 있어도 서버 값을 쓰지 않고 이 기기 값을 보낸다. 불러오기에 실패하면 다음에 다시. */
    if (loadingNow) return; loadingNow = true;   // [V33.746] 같은 불러오기를 겹쳐 보내지 않는다
    var seq = editSeq, who = uid();
    api("GET").then(function (j) {
      loadingNow = false;
      if (who !== uid()) return;
      if (!j || j.ok === false) { loaded = false; return; }
      synced = true;
      if (j.profile && editSeq === seq && !isDirty()) { adopt(j.profile); sync.st = "ok"; sync.ts = Date.now(); draw(); ensureAccts(); }
      else if (j.profile) {
        /* 이 기기에 못 보낸 변경이 있다 — 서버 것과 합친다: 관심종목은 합집합, 모의계좌는 서버가 시장별로 더 새 것을 지킨다(pfKept) */
        if (j.profile.nick) prof.nick = j.profile.nick;
        (j.profile.watch || []).forEach(function (x) { if (prof.watch.indexOf(x) < 0 && prof.watch.length < 40) prof.watch.push(x); });
        if (!prof.pf && j.profile.pf) prof.pf = j.profile.pf;
        saveLocal(); draw(); push(); ensureAccts();
      }
      else { if (prof.done || isDirty()) push(); ensureAccts(); }
    }).catch(function () { loadingNow = false; loaded = false; });
  }
  function quotes() { return window.__lastQuotesArr || []; }
  window.addEventListener("lux:luxmini", function () { var pm = $("page-mine"); if (pm && pm.classList.contains("active")) try { draw(); } catch (e) {} });   // [V33.783] LUX-Mini 가중치 도착 → 다시 그리기
  var _qT = 0; window.addEventListener("lux:quotes", function () { var pm = $("page-mine"); if (!pm || !pm.classList.contains("active") || Date.now() - _qT < 5000) return; _qT = Date.now(); try { draw(); } catch (e) {} });   // [V33.780] 데이마켓 실시간
  function q(sym) { var a = quotes(); for (var i = 0; i < a.length; i++) if (a[i].symbol === sym) return a[i]; return null; }
  /* [V33.746] 등락률은 ★보여 주는 가격과 같은 기준★(전일 종가 대비) — 종전엔 가격은 시간외 체결가인데 등락은 정규장 값이라 서로 안 맞았다 */
  function chg(x) { if (!x) return null; if (x.price > 0 && x.prevClose > 0) return (x.price / x.prevClose - 1) * 100; var v = typeof x.dayPct === "number" ? x.dayPct : x.regPct; return typeof v === "number" ? v : null; }
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
  /* [V33.748] ★MY 홈·AI 추천이 늦게 뜨던 것★(사용자 11/4) — /api/playbook(197KB · 0.2~1.3초)을 MY 를 열 때에야 받아 그동안 순위가 비었다.
     ① 받은 판정의 필요한 칸만 기기에 보관(lux-pb · 6시간) → MY 를 열면 바로 그린다 ② 뒤에서 새로 받아 바꾼다 ③ 로그인한 사람은 접속 4초 뒤 미리 받아 둔다. */
  var PBK = "lux-pb", pbBusy = false;
  function pbSlim(j) {
    var o = { ts: Date.now(), markets: {}, live: {} };
    ["us", "kr"].forEach(function (m) {
      var mm = j && j.markets && j.markets[m]; if (mm) o.markets[m] = { regime: mm.regime };
      var lv = j && j.live && j.live[m]; if (lv && lv.items) o.live[m] = { items: lv.items.slice(0, 60).map(function (x) { return { s: x.s, pb: x.pb, why: x.why, q: x.q, stop: x.stop, hold: x.hold, kind: x.kind, px: x.px, nm: x.nm, dp: x.dp }; }) };
    });
    o.recent = ((j && j.recent) || []).slice(0, 15).map(function (r) { return { ts: r.ts, market: r.market, symbol: r.symbol }; });   // [V33.778] AI 가 실제로 산 종목(매매법 AI · SROUTE)
    return o;
  }
  try { var _pb0 = JSON.parse(localStorage.getItem(PBK) || "null"); if (_pb0 && Date.now() - _pb0.ts < 6 * 3600000) PB = _pb0; } catch (e) {}
  function pbLoad(force) {
    if (pbBusy || (!force && Date.now() - pbTs < 170000)) return; pbTs = Date.now(); pbBusy = true;
    fetch("/api/playbook").then(function (r) { return r.json(); }).then(function (j) { pbBusy = false; if (!j || !j.live) return; PB = j; try { localStorage.setItem(PBK, JSON.stringify(pbSlim(j))); } catch (e) {} draw(); }).catch(function () { pbBusy = false; pbTs = 0; });
  }

  // ── 모의계좌 ──
  function acct(mk) { if (!prof.pf) prof.pf = {}; if (!prof.pf[mk]) prof.pf[mk] = { start: START[mk], cash: START[mk], pos: {}, hist: [], t0: Date.now() }; return prof.pf[mk]; }
  /* [V33.757] ★계정이 생기면 미국·한국 모의계좌 둘 다 바로 연다★(사용자 11/4) — 서버 사본을 받은 뒤(synced)에만: 다른 기기에서 이미 연 계좌를 새 빈 계좌로 덮지 않게 */
  function ensureAccts() { if (!isAuth() || !synced) return; var made = 0; ["us", "kr"].forEach(function (m) { if (!prof.pf || !prof.pf[m]) { acct(m); made++; } }); if (made) { persist(); draw(); } }
  function has(mk) { return !!(prof.pf && prof.pf[mk]); }
  function held(sym) { var mk = isKr(sym) ? "kr" : "us"; return has(mk) && prof.pf[mk].pos[sym] ? prof.pf[mk].pos[sym].q : 0; }
  /* [V33.770] ★'오늘' = 시세가 속한 장(세션)★ — 종전엔 달력 날짜(미 동부 자정)로 갈라, 자정이 지나 다음 장이 열리기 전엔 어제 장에서 산 종목을
     '오늘 산 것 아님' 으로 보고 전일 종가 기준(+$118)으로 셌다(총손익 −$31 과 불일치 · 사용자 11/4). 이제 지금 시세의 기준 전일 종가가 정해진 뒤(직전 장 마감 뒤)에 산 보유는 평단 기준.
     장 시각: 미 09:30~16:00 ET · 한 09:00~15:30 KST · 주말 건너뜀(휴장일은 모름 — 드묾). 장전(PRE)은 곧 열 장을 '지금 장' 으로 본다(전일 종가가 넘어와 있다). */
  function _tzParts(tz, ts) { var o = {}; try { new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ts)).forEach(function (x) { o[x.type] = x.value; }); } catch (e) {} return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute }; }
  function _sessOpen(mk, ts) {   // ts 이전(포함) 가장 최근 장 시작 시각(ms)
    var tz = mk === "kr" ? "Asia/Seoul" : "America/New_York", om = mk === "kr" ? 540 : 570, L = _tzParts(tz, ts);
    if (!L.y) return ts - 86400000;
    for (var k = 0; k < 8; k++) {
      var D = new Date(Date.UTC(L.y, L.m - 1, L.d - k)), wd = D.getUTCDay();
      if (wd === 0 || wd === 6 || (k === 0 && L.h * 60 + L.mi < om)) continue;
      var g = Date.UTC(D.getUTCFullYear(), D.getUTCMonth(), D.getUTCDate(), Math.floor(om / 60), om % 60), P2 = _tzParts(tz, g);
      return g - (Date.UTC(P2.y, P2.m - 1, P2.d, P2.h, P2.mi) - g);
    }
    return ts - 86400000;
  }
  function _refCloseAt(mk, sym) {   // 지금 등락(전일 종가 대비)의 '전일 종가' 가 찍힌 시각 — 이 뒤에 산 보유는 평단 기준
    var x = q(sym), now = Date.now(), ref = x && x.mstate === "PRE" ? now + 12 * 3600000 : now;
    var cur = _sessOpen(mk, ref), prev = _sessOpen(mk, cur - 60000);
    return prev + 390 * 60000;
  }
  function posDay(mk, s, p, x) {   // → [오늘 손익, 오늘 %] (보유 기준)
    var c = dayPct(s);
    if (p.t > 1e12 && p.t > _refCloseAt(mk, s)) return [p.q * (x - p.avg), p.avg > 0 ? (x / p.avg - 1) * 100 : null];
    return c != null && c > -100 ? [p.q * x * (c / (100 + c)), c] : [0, null];
  }
  function todayKey(mk, ts) { try { return new Date(ts || Date.now()).toLocaleDateString("en-CA", { timeZone: mk === "kr" ? "Asia/Seoul" : "America/New_York" }); } catch (e) { return new Date(ts || Date.now()).toDateString(); } }
  function dayPct(sym) { var c = chg(q(sym)); if (c == null) { var it = liveItem(sym); if (it && typeof it.dp === "number") c = it.dp; } return c; }
  function val(mk) {
    /* [V33.741] 평가는 priceOf(관심종목 밖 AI 후보 시세까지) · 오늘 변동(보유 × 오늘 등락) · 시작일이 비정상이면 1일(테스트·옛 기록에서 '20760일' 로 보였다) */
    if (!has(mk)) return null; var a = prof.pf[mk], eq = a.cash, cost = 0, mv = 0, day = 0;
    /* [V33.746] ★오늘 손익★ — 오늘 산 종목은 전일 종가가 아니라 산 값(평단)이 기준이다(종전: 오늘 산 1종목이 '오늘 +$144' 인데 총손익은 −$5 로 보였다) */
    Object.keys(a.pos).forEach(function (s) { var p = a.pos[s], x = priceOf(s) || p.avg; eq += p.q * x; mv += p.q * x; cost += p.q * p.avg; day += posDay(mk, s, p, x)[0]; });
    var t0 = a.t0 > 1e12 ? a.t0 : (a.hist.length && a.hist[a.hist.length - 1][0] > 1e12 ? a.hist[a.hist.length - 1][0] : Date.now());
    return { eq: eq, cash: a.cash, mv: mv, upl: mv - cost, ret: (eq / a.start - 1) * 100, n: Object.keys(a.pos).length, day: day, dayPct: eq - day > 0 ? day / (eq - day) * 100 : 0, days: Math.max(1, Math.round((Date.now() - t0) / 86400000)) };
  }
  /* [V33.770] ★AI 매도 의견★(사용자 11/4 "매도도 어시스트 · 의견 제공") — 화면이 계산(서버 비용 0). 근거를 같이 보여 준다:
     ① 손절선 = AI 매매법이 그 종목에 쓰는 손절 %(있으면) · 없으면 평균 변동폭(ATR) 2배(4~15%) ② 목표 = 손절 폭의 2배(손익비 1:2 · 최대 +40%)
     ③ 과열 = RSI ≥ 75 또는 볼린저 상단 위 ④ 추세 이탈 = 20일선 아래 + 5일 −8% 이하 ⑤ AI 순위(OMNI-Q 백분위)가 하위 30% 로 떨어졌는가.
     판정 순서: 손절 검토 → 일부 익절(목표·과열) → 주의(추세 이탈·AI 약화) → 보유 유지. 투자 권유가 아니라 기준 안내다. */
  /* [V33.772] ★보유 종목 리포트 재료★ — 실적 발표 일정(공용 CDN 피드 /api/earnings · 한 번 받아 기억) · 레버리지/인버스 ETF · 보유 기간 · 계좌 비중 */
  var EARN = null, earnBusy = false;
  function earnLoad() { if (EARN || earnBusy) return; earnBusy = true; fetch("/api/earnings").then(function (r) { return r.json(); }).then(function (j) { var m = {}, now = Date.now() - 864e5;
    ((j && j.items) || []).forEach(function (x) { if (x && x.symbol && x.ts > now && (!m[x.symbol] || x.ts < m[x.symbol])) m[x.symbol] = x.ts; }); EARN = m; var pm = $("page-mine"); if (pm && pm.classList.contains("active")) draw(); }).catch(function () { earnBusy = false; }); }
  function earnDays(s) { var t = EARN && EARN[s]; return t ? Math.max(0, Math.ceil((t - Date.now()) / 864e5)) : null; }
  var LEV = /(^|[^a-z])(2x|3x|ultra|bull|bear|inverse)([^a-z]|$)|레버리지|인버스|2배|3배|곱버스/i, LEVSYM = { TQQQ: 1, SQQQ: 1, SOXL: 1, SOXS: 1, UPRO: 1, SPXU: 1, TNA: 1, TZA: 1, LABU: 1, LABD: 1, FAS: 1, FAZ: 1, TECL: 1, TECS: 1, NVDL: 1, TSLL: 1, SH: 1, PSQ: 1, "122630.KS": 1, "252670.KS": 1, "114800.KS": 1, "233740.KS": 1, "251340.KS": 1 };
  function isLev(s) { return !!LEVSYM[s] || LEV.test(nm(s) || ""); }
  function heldDays(p) { return p && p.t > 1e12 ? Math.max(0, Math.floor((Date.now() - p.t) / 864e5)) : null; }
  /* [V33.773] ★매도 의견을 백테스트 근거로★ — 규칙별 과거 성적(public/sell-stats.json · 정적 파일 · 한 번 받아 기억 · 서버 비용 0):
     한·미 20년 일봉 · 보유 포지션에서 신호가 처음 뜬 날 뒤 10일, 같은 날 다른 보유 대비 초과수익(ex) · 추가 하락 확률(down) · 최근 30% 기간 홀드아웃.
     결과(에이전트 · trainer/research/sell_rules_eval.py): 매도 신호로 확인 = 한국 50일선 하향 이탈 하나 · 손절선·목표·RSI·볼린저·추세 이탈은 근거 약함(한국 과열은 오히려 더 오름).
     그래서 판정 = 위험 한도(손절선 · 손실 상한 장치) → 주의(확인된 신호 · 실적 임박 · AI 순위 하위) → 보유 유지. 과열·목표·추세 이탈은 '참고' 로만 · 근거 숫자를 같이 보여 준다. */
  var SST = null, sstBusy = false;
  function sstLoad() { if (SST || sstBusy) return; sstBusy = true; fetch("/sell-stats.json").then(function (r) { return r.json(); }).then(function (j) { SST = j && j.markets ? j : null; var pm = $("page-mine"); if (SST && pm && pm.classList.contains("active")) draw(); }).catch(function () { sstBusy = false; }); }
  function sst(mk, k) { return SST && SST.markets[mk] && SST.markets[mk][k] || null; }
  function sstTxt(mk, k) { var o = sst(mk, k); if (!o || !o.h10) return ""; var ex = o.h10.ex; return "과거 10일 " + (ex >= 0 ? "+" : "−") + Math.abs(ex).toFixed(1) + "%p" + (o.label === "sell" ? " · 확인된 신호" : ex > 0 ? " · 오히려 더 오른 편(근거 약함)" : " · 근거 약함"); }
  function rs(a, b) { return b ? [a, b] : [a]; }   // 근거 = [본문, 과거 성적] — 따로 그려 영어 사전이 각각 맞춘다
  function rsH(x) { var a = Array.isArray(x) ? x : [x]; return "<span>" + esc(a[0]) + "</span>" + (a[1] ? ' <span class="st">(<span>' + esc(a[1]) + "</span>)</span>" : ""); }
  function sellView(mk, s, p, cur) {
    sstLoad();
    var x = q(s) || {}, it = liveItem(s), r = (cur / p.avg - 1) * 100;
    var atrP = x.atr > 0 && cur > 0 ? x.atr / cur * 100 : 3;
    var aiStop = it && typeof it.stop === "number" && it.stop >= 1 && it.stop <= 30 ? it.stop : null;
    var stopP = aiStop != null ? aiStop : Math.min(15, Math.max(4, 2 * atrP)), tpP = Math.min(40, 2 * stopP);   // 목표 = 손절 폭의 2배(손익비 1:2 · 최대 +40%)
    var sl = p.slPx || p.avg * (1 - stopP / 100), tp = p.tpPx || p.avg * (1 + tpP / 100), why = [], ref = [], v = "hold";
    var useful = function (k) { var o = sst(mk, k); return !!(o && o.label === "sell"); };
    // ① 위험 한도(손실 상한 장치 — 추가 하락 예측력은 약하다는 것을 같이 알린다)
    if (cur <= sl) { v = "cut"; why.push(rs("손절선 " + pxS(mk, sl) + " 아래 (평단 대비 " + pctS(r) + ")", sstTxt(mk, "stop_atr2"))); }
    // ② 주의 — 확인된 신호(50일선 하향 이탈: 어제 종가 ≥ 50일선 > 지금가)
    if (x.ma50 > 0 && x.prevClose >= x.ma50 && cur < x.ma50) { (useful("ma50_break") ? why : ref).push(rs("50일선 " + pxS(mk, x.ma50) + " 하향 이탈", sstTxt(mk, "ma50_break"))); if (v === "hold" && useful("ma50_break")) v = "watch"; }
    if (x.vol > 0 && x.avgVol20 > 0 && x.vol >= 3 * x.avgVol20 && cur < (x.prevClose || cur)) { (useful("vol_spike3_down") ? why : ref).push(rs("거래량 " + (x.vol / x.avgVol20).toFixed(1) + "배 + 하락", sstTxt(mk, "vol_spike3_down"))); if (v === "hold" && useful("vol_spike3_down")) v = "watch"; }
    if (it && typeof it.q === "number") { if (it.q <= 0.3) { if (v === "hold") v = "watch"; why.push("AI 순위 하위 " + Math.max(1, Math.round(it.q * 100)) + "%"); } else if (it.q >= 0.8) ref.push("AI 순위 상위 " + Math.max(1, Math.round((1 - it.q) * 100)) + "%"); }
    var ed = earnDays(s); if (ed != null && ed <= 7) { why.push("실적 발표 " + (ed === 0 ? "오늘" : "D-" + ed) + " · 발표 전후 변동 확대"); if (v === "hold") v = "watch"; }
    // ③ 참고(근거 약함 — 판정을 바꾸지 않는다)
    if (cur >= tp && cur > sl) ref.push(rs("목표 " + pxS(mk, tp) + " 도달 (평단 대비 " + pctS(r) + ")", sstTxt(mk, "target_2r")));
    if (x.rsi >= 75) ref.push(rs("RSI " + Math.round(x.rsi) + " 과열", sstTxt(mk, "rsi75")));
    else if (x.bbUpper > 0 && cur >= x.bbUpper) ref.push(rs("볼린저 상단 위", sstTxt(mk, "bb_upper")));
    if (x.ma > 0 && cur < x.ma && x.return5 <= -8) ref.push(rs("20일선 아래 · 5일 " + pctS(x.return5), sstTxt(mk, "trend_break")));   // [V33.773] 종전엔 5일선(dailyMaShort)을 20일선이라 적었다
    var hd = heldDays(p), aiHold = it && typeof it.hold === "number" ? it.hold : null;
    if (isLev(s) && hd != null && hd >= 10) why.push("레버리지·인버스 ETF " + hd + "일 보유 · 오래 들수록 변동성 손실 누적");
    if (aiHold && hd != null && hd > aiHold) ref.push("AI 매매법 보유 기간(" + aiHold + "일) 지남");
    if (!why.length && !ref.length) why.push("손절선·목표 사이 · 확인된 매도 신호 없음");
    var KO = { hold: "보유 유지", cut: "위험 한도 도달", watch: "주의 · 관찰" };
    return { v: v, ko: KO[v], why: why.slice(0, 3), ref: ref.slice(0, 3), sl: sl, tp: tp, stopP: stopP, ai: aiStop != null };
  }

  /* [V33.771] ★장이 모두 닫힌 시간엔 체결하지 않는다★(사용자 11/4 "프리·애프터·정규장 다 닫힌 시간엔 예약 매수만") —
     열린 창: 미 04:00~20:00 ET(프리·정규·애프터) · 한 08:00~08:50 · 09:00~15:30 · 15:40~20:00 KST(넥스트레이드 프리·정규·애프터) · 주말 휴장.
     휴장일은 시세의 장 상태(CLOSED 등 · 15분 안 시세)로 안다. 닫혀 있으면 시장가는 막고 예약(지정가)만 받는다 · 예약·익절·손절도 열린 시간에만 체결. */
  function mktOpen(mk, sym) {
    var L = _tzParts(mk === "kr" ? "Asia/Seoul" : "America/New_York", Date.now()); if (!L.y) return true;
    var wd = new Date(Date.UTC(L.y, L.m - 1, L.d)).getUTCDay(), mins = L.h * 60 + L.mi;
    if (wd === 0 || wd === 6) return false;
    var win = mk === "kr" ? [[480, 530], [540, 930], [940, 1200]] : [[240, 1200]];
    if (!win.some(function (w) { return mins >= w[0] && mins < w[1]; })) return false;
    var x = sym ? q(sym) : null;
    if (x && x.mstate && Date.now() - (Number(x.ts) || 0) < 15 * 60000 && /^(CLOSED|POSTPOST|PREPRE|HOLIDAY)$/.test(x.mstate)) return false;
    return true;
  }
  function mktNext(mk) { return mk === "kr" ? "다음 장(08:00 프리마켓)" : "다음 장(04:00 ET 프리마켓)"; }
  function trade(side, sym, qty) {
    var mk = isKr(sym) ? "kr" : "us", a = acct(mk), price = priceOf(sym);
    if (!mktOpen(mk, sym)) return "지금은 장이 모두 닫혀 있어요 — 예약 주문만 걸 수 있습니다(" + mktNext(mk) + "에 가격이 닿으면 체결)";
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
      "#mineRoot .buy,#mineRoot .sell,#mineRoot .tag2{min-height:40px;padding:0 14px;border-radius:10px;border:0;font-size:13.5px;font-weight:700;cursor:pointer;color:#fff;background:#D42F2F}#mineRoot .sell{background:#2160D8}#mineRoot .tag2{background:var(--m-chip);color:var(--m-mute);font-weight:500;cursor:default;display:inline-flex;align-items:center}",
      "#mineRoot .pill{font-size:11px;padding:2px 6px;border-radius:6px;margin-left:5px;background:#173A33;color:#5FE0C4;vertical-align:middle}#mineRoot .pill.s{background:#2A2440;color:#B9A6FF}#mineRoot .pill.w{background:#20252E;color:var(--m-mute)}",
      "#mineRoot .chips{display:flex;gap:6px;margin:10px 0 2px;flex-wrap:wrap}#mineRoot .chips button{min-height:36px;border-radius:18px;padding:0 14px;font-size:13px;border:1px solid #2A303B;background:transparent;color:#C7CDD6;cursor:pointer}#mineRoot .chips button.on{background:#EEF1F5;color:#0D1014;border-color:#EEF1F5;font-weight:700}",
      "#mineRoot .search{display:flex;align-items:center;gap:8px;background:var(--m-card);border:1px solid #2A303B;border-radius:14px;padding:0 14px;min-height:48px}#mineRoot .search input{flex:1;border:0;outline:0;background:transparent;color:inherit;font-size:15px;font-family:inherit;min-width:0}",
      "#mineRoot .ops{display:grid;gap:6px;margin:6px 0 12px}#mineRoot .ops button{min-height:44px;border-radius:12px;border:1px solid #2E3542;background:transparent;color:#C7CDD6;font-size:13.5px;cursor:pointer}#mineRoot .ops button.on{background:var(--m-acc);border-color:var(--m-acc);color:#04110D;font-weight:700}",
      "#mineRoot .kv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}#mineRoot .kv div{display:flex;flex-direction:column;gap:2px}#mineRoot .kv span{font-size:11.5px;color:var(--m-mute)}",
      "#mineRoot .note{font-size:11.5px;line-height:1.55;color:#8A93A3}#mineRoot .empty{padding:16px 2px;color:var(--m-mute);font-size:13.5px;line-height:1.5}",
      "#mineRoot .rk{flex:0 0 22px;text-align:center;font-size:15px;font-weight:700;color:var(--m-mute)}#mineRoot .rk.hot{color:var(--m-acc)}#mineRoot .wbtn{cursor:pointer;min-width:52px;justify-content:center;border:1px solid #2E3542;background:transparent;color:#C7CDD6}#mineRoot .wbtn.on{color:var(--m-acc);border-color:#22574B}",
      "@media (max-width:520px){#mineRoot{padding:4px 0 96px;font-size:14px}#mineRoot .card{border-radius:16px;padding:14px}#mineRoot .h1{font-size:26px}#mineRoot .row{gap:8px;padding:11px 0}#mineRoot .buy,#mineRoot .sell,#mineRoot .tag2{min-height:38px;padding:0 11px;font-size:13px}#mineRoot .r .p{font-size:13.5px}#mineRoot .sb{font-size:11.5px}#mineRoot .tabs{margin-bottom:10px}#mineRoot .g2{gap:8px}}",
      // [V33.741] 저장 상태 · 오늘 손익 · 보유 카드 · 거래 내역 매수/매도 표 · 폰 옆 여백(카드가 화면 끝에 붙었다)
      "#mineRoot .syncbar{display:flex;justify-content:flex-end;margin:-6px 4px 8px}#mineRoot .sync{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--m-mute)}#mineRoot .sync i{width:7px;height:7px;border-radius:4px;background:var(--m-acc)}#mineRoot .sync.sv i{background:#E2C766;animation:mineBlink 1s infinite alternate}#mineRoot .sync.bad{color:#FF8A8A}#mineRoot .sync.bad i{background:#FF5C5C}@keyframes mineBlink{to{opacity:.3}}",
      // [V33.748] 종목 간단히 보기(MTS 식 아래 시트)
      "#minePv{--m-up:#FF5C5C;--m-dn:#4D8DFF;position:fixed;inset:0;z-index:9998;background:rgba(4,8,16,0);display:flex;align-items:flex-end;justify-content:center;transition:background .25s}#minePv.on{background:rgba(4,8,16,.55)}",
      "#minePv .pvb{width:min(560px,100%);max-height:90vh;overflow-y:auto;background:#181C24;color:#EEF1F5;border-radius:22px 22px 0 0;padding:10px 20px calc(18px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:12px;font-size:14px;transform:translateY(100%);transition:transform .32s cubic-bezier(.2,.8,.2,1)}#minePv.on .pvb{transform:none}",
      "#minePv .grab{width:40px;height:4px;border-radius:2px;background:#2E3542;align-self:center}#minePv .pvh{display:flex;align-items:flex-start;gap:10px}#minePv .pvh .l{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}#minePv .nm{font-size:18px;font-weight:700}#minePv .sb{font-size:12.5px;color:#98A2B3}#minePv .x{width:40px;height:40px;border-radius:20px;border:0;background:#20262F;color:#98A2B3;font-size:15px;cursor:pointer}",
      "#minePv .pvp{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}#minePv .h1{font-size:30px;font-weight:700;letter-spacing:-.5px}#minePv .up,#minePv i.up{color:var(--m-up);font-style:normal}#minePv .dn,#minePv i.dn{color:var(--m-dn);font-style:normal}",
      "#minePv .pvc{position:relative;height:210px;border-radius:14px;background:#0D1014;overflow:hidden}#minePv .pvc svg{display:block;width:100%;height:100%}#minePv .pvax{position:absolute;right:8px;top:6px;bottom:6px;display:flex;flex-direction:column;justify-content:space-between;font-size:11px;color:#7E8796;pointer-events:none}#minePv .pvload{display:flex;align-items:center;justify-content:center;height:100%;color:#7E8796;font-size:13px}",
      "#minePv .seg{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;background:#0D1014;border-radius:10px;padding:3px}#minePv .seg button{min-height:36px;border:0;border-radius:8px;background:transparent;color:#98A2B3;font-size:13px;cursor:pointer}#minePv .seg button.on{background:#262C36;color:#fff;font-weight:700}",
      "#minePv .pvs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}#minePv .pvs div{display:flex;flex-direction:column;gap:3px;background:#0D1014;border-radius:12px;padding:10px}#minePv .pvs span{font-size:11.5px;color:#98A2B3}#minePv .pvs b{font-size:14.5px;font-weight:600}",
      "#minePv .pvai{font-size:13px;line-height:1.5;color:#C7CDD6;background:rgba(61,214,181,.08);border:1px solid rgba(61,214,181,.25);border-radius:12px;padding:10px 12px}#minePv .pvai b{color:#3DD6B5;margin-right:4px}#minePv .pvhd{font-size:13px;color:#C7CDD6;background:#0D1014;border-radius:12px;padding:10px 12px}",
      "#minePv .pva{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:8px}#minePv .pva button{min-height:48px;border-radius:12px;border:0;font-size:15px;font-weight:700;cursor:pointer;color:#fff;background:#D42F2F}#minePv .pva .sell{background:#2160D8}#minePv .pva .wbtn2{background:transparent;border:1px solid #2E3542;color:#C7CDD6;font-weight:600}#minePv .pva .wbtn2.on{color:#3DD6B5;border-color:#22574B}",
      "#minePv .pvgo{min-height:50px;border-radius:14px;border:0;background:#EEF1F5;color:#0D1014;font-size:15.5px;font-weight:700;cursor:pointer}#minePv .pvgo span{margin-left:4px}",
      "html[data-theme=light] #minePv{--m-up:#C92A2A;--m-dn:#1B5FCC}html[data-theme=light] #minePv.on{background:rgba(16,24,40,.45)}html[data-theme=light] #minePv .pvb{background:#fff;color:#101828}html[data-theme=light] #minePv .pvc,html[data-theme=light] #minePv .pvs div,html[data-theme=light] #minePv .pvhd,html[data-theme=light] #minePv .seg{background:#F2F4F7}html[data-theme=light] #minePv .seg button.on{background:#101828}html[data-theme=light] #minePv .x{background:#F2F4F7;color:#101828}html[data-theme=light] #minePv .pvai,html[data-theme=light] #minePv .pvhd{color:#344054}html[data-theme=light] #minePv .pvai{background:#E6F7F2;border-color:#CDEBE2}html[data-theme=light] #minePv .pvai b{color:#0B7A66}html[data-theme=light] #minePv .pva .wbtn2{border-color:#D0D5DD;color:#344054}html[data-theme=light] #minePv .pvgo{background:#101828;color:#fff}html[data-theme=light] #minePv .sb,html[data-theme=light] #minePv .pvs span{color:#667085}",
      "#mineRoot .pill.hold{background:rgba(226,199,102,.16);color:#E2C766}html[data-theme=light] #mineRoot .pill.hold{background:#FEF3C7;color:#7A5A00}",
      "#mineRoot .today{margin-top:4px;font-size:13px;color:var(--m-mute)}#mineRoot .today b{font-weight:600}",
      /* [V33.772] 계좌 진단 */
      "#mineRoot .diag .dl{display:flex;gap:9px;align-items:flex-start;font-size:13px;line-height:1.45;padding:3px 0}#mineRoot .diag .dl i{flex:0 0 8px;height:8px;border-radius:50%;margin-top:6px;background:#3DD6B5}#mineRoot .diag .dl.w i{background:#F04452}#mineRoot .diag .dl.i i{background:#E2C766}",
      /* [V33.770] AI 매도 의견 줄 */
      "#mineRoot .pill.ai{background:rgba(61,214,181,.16);color:#3DD6B5;border:1px solid rgba(61,214,181,.35)}#mineRoot .pill.ai2{background:rgba(127,166,255,.14);color:#9DB8FF;border:1px solid rgba(127,166,255,.3)}#mineRoot b.aiK{color:#3DD6B5;font-weight:700}#mineRoot b.aiK2{color:#9DB8FF;font-weight:700}" +
      "#mineRoot .aipk{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--m-mute);margin:6px 0 4px}#mineRoot .aipk b{color:var(--m-t,#EEF1F5)}#mineRoot .aipk i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:0}#mineRoot .aipk .d1{background:var(--m-acc)}#mineRoot .aipk .d2{background:#3A414D}" +
      "#mineRoot .olx{margin:6px 0 2px;font-size:12.5px}#mineRoot .olx summary{display:flex;flex-wrap:wrap;align-items:center;gap:6px;cursor:pointer;list-style:none}#mineRoot .olx summary::-webkit-details-marker{display:none}#mineRoot .olx summary>b{font-size:12px;color:var(--m-mute);margin-right:2px}" +
      "#mineRoot .ol{display:inline-flex;align-items:center;gap:4px;border-radius:6px;padding:2px 7px;font-weight:700;font-size:11.5px;background:rgba(127,140,160,.14);color:#C7CDD6}#mineRoot .ol i{font-style:normal;font-weight:500;opacity:.75}#mineRoot .ol.pos,#mineRoot .ol.pos1{background:rgba(240,68,82,.14);color:#FF7A85}#mineRoot .ol.neg,#mineRoot .ol.neg1{background:rgba(49,130,246,.16);color:#7FB0FF}" +
      "#mineRoot .olm{font-size:11.5px;color:var(--m-acc);margin-left:auto}#mineRoot .olw{display:flex;flex-direction:column;gap:2px;margin-top:6px;padding:6px 8px;border-radius:8px;background:rgba(127,140,160,.07);line-height:1.45}#mineRoot .olw b{font-size:12px}#mineRoot .olw span{color:#C7CDD6}" +
      "html[data-theme=light] #mineRoot .olw span,html[data-theme=light] #mineRoot .ol{color:#344054}html[data-theme=light] #mineRoot .aipk b{color:#101828}" +
      "#mineRoot .so{display:flex;flex-direction:column;gap:2px;margin:8px 0 2px;padding:8px 10px;border-radius:10px;background:var(--m-soft,rgba(127,140,160,.08));border-left:3px solid #7FA6FF;font-size:12.5px}#mineRoot .so .sv b{font-weight:700;margin-right:6px;color:var(--m-mu,#98A2B3)}#mineRoot .so .sw{color:var(--m-mu,#98A2B3);font-size:12px}#mineRoot .so .rf{opacity:.8}#mineRoot .so.cut{border-left-color:#3182F6}#mineRoot .so.watch{border-left-color:#E2C766}#mineRoot .so.hold .sv{color:#3DD6B5}#mineRoot .so.trim .sv{color:#F04452}#mineRoot .so.cut .sv{color:#3182F6}#mineRoot .so.watch .sv{color:#E2C766}",
      "#mineRoot .hold{padding:13px 0 12px;border-top:1px solid var(--m-line);cursor:pointer}#mineRoot .ct+.hold,#mineRoot .ct+.row{border-top:0}#mineRoot .ht{display:flex;align-items:center;gap:10px}#mineRoot .hm{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 0 0 18px;font-size:12.5px;color:var(--m-mute)}#mineRoot .hm b{font-weight:600;color:var(--fg,#EEF1F5)}#mineRoot .hm b.up{color:var(--m-up)}#mineRoot .hm b.dn{color:var(--m-dn)}",
      "#mineRoot .ha{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:6px;margin:10px 0 0 18px}#mineRoot .ha button{min-height:40px;justify-content:center}#mineRoot .bs{flex:0 0 auto;font-size:11.5px;font-weight:700;padding:3px 7px;border-radius:6px}#mineRoot .bs.b{color:var(--m-up);background:rgba(255,92,92,.12)}#mineRoot .bs.s{color:var(--m-dn);background:rgba(77,141,255,.12)}#mineRoot .more{width:100%;margin-top:8px;min-height:42px}#mineRoot .cashbar{background:#2A303B}",
      "html[data-theme=light] #mineRoot .hm b{color:#101828}html[data-theme=light] #mineRoot .hm b.up{color:var(--m-up)}html[data-theme=light] #mineRoot .hm b.dn{color:var(--m-dn)}html[data-theme=light] #mineRoot .cashbar{background:#D0D5DD}html[data-theme=light] #mineRoot .sync.bad{color:#B42318}",
      "@media (max-width:520px){#mineRoot{padding-left:10px!important;padding-right:10px!important}#mineRoot .hm,#mineRoot .ha{margin-left:0}}",
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
      "#luxGate{--g-mute:#98A2B3;position:fixed;inset:0;z-index:10050;background:#0D1014;color:#EEF1F5;display:flex;justify-content:center;font-family:inherit}#luxGate .in{width:min(440px,100%);display:flex;flex-direction:column;padding:0 24px calc(28px + env(safe-area-inset-bottom))}",
      "#luxGate h1{margin:0;font-size:29px;line-height:1.3;font-weight:700;letter-spacing:-.5px}#luxGate .lg{width:64px;height:64px;border-radius:18px;background:#161A21;border:1px solid #2A303B;display:flex;align-items:center;justify-content:center}",
      "#luxGate button{font-family:inherit;cursor:pointer}#luxGate .p1{min-height:56px;border-radius:16px;border:0;background:#3DD6B5;color:#04110D;font-size:16.5px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px}#luxGate .p2{min-height:52px;border-radius:16px;border:1px solid #2E3542;background:transparent;color:#EEF1F5;font-size:15.5px}#luxGate .p3{min-height:48px;border:0;background:transparent;color:#98A2B3;font-size:14.5px;text-decoration:underline}",
      "#mineDetailBar{margin:0 0 10px}#mineDetailBar .mdb{display:flex;align-items:center;gap:8px;background:#161A21;border:1px solid #232935;border-radius:14px;padding:10px 12px;color:#EEF1F5}#mineDetailBar .l{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}#mineDetailBar .nm{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#mineDetailBar .sb{font-size:12px;color:#98A2B3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "@media (max-width:600px){#mineDetailBar .mdb{flex-wrap:wrap;gap:8px}#mineDetailBar .mdb>.l{flex:1 0 100%}#mineDetailBar .mdb>button{flex:1 1 0;min-width:0}#mineDetailBar .sb{white-space:normal}}",   // [V33.749] 폰: 이름·보유 줄 한 줄 전체 → 버튼은 아래 한 줄(종전 '내 모…' 로 잘림)
      "#mineDetailBar .buy,#mineDetailBar .sell,#mineDetailBar .wbtn2{min-height:42px;padding:0 14px;border-radius:10px;border:0;font-size:14px;font-weight:700;cursor:pointer;color:#fff;background:#D42F2F}#mineDetailBar .sell{background:#2160D8}#mineDetailBar .wbtn2{background:transparent;border:1px solid #2E3542;color:#C7CDD6;font-weight:500}",
      // [V33.732] 라이트 테마(LUX Light 2) — 흰 카드 · 회색 바탕 · 글자 3단 · 상승 빨강/하락 파랑
      "html[data-theme=light] #mineRoot{--m-bg:#EDF0F4;--m-card:#FFFFFF;--m-line:#EEF1F5;--m-chip:#F2F4F7;--m-mute:#5B6474;--m-acc:#0B7A66;--m-up:#C92A2A;--m-dn:#1B5FCC;color:#101828}",
      "html[data-theme=light] #mineRoot .card,html[data-theme=light] #mineRoot .wx,html[data-theme=light] #mineRoot .tabs,html[data-theme=light] #mineRoot .search{border:1px solid #DCE1E8;box-shadow:0 1px 2px rgba(16,24,40,.05)}",
      "html[data-theme=light] #mineRoot .tabs button.on,html[data-theme=light] #mineRoot .seg button.on{background:#101828;color:#fff}html[data-theme=light] #mineRoot .b{color:#101828}html[data-theme=light] #mineRoot .b.pri{color:#fff}html[data-theme=light] #mineRoot .b.line,html[data-theme=light] #mineRoot .ops button,html[data-theme=light] #mineRoot .chips button,html[data-theme=light] #mineRoot .wbtn{border-color:#D0D5DD;color:#344054}",
      "html[data-theme=light] #mineRoot .wx span[style],html[data-theme=light] #mineRoot .note{color:#475467!important}html[data-theme=light] #mineRoot .chips button.on{background:#101828;color:#fff;border-color:#101828}html[data-theme=light] #mineRoot .pf{background:linear-gradient(135deg,#E6F7F2 0%,#FFFFFF 60%);border-color:#CDEBE2}html[data-theme=light] #mineRoot .st3{border-top-color:#E7EBF0}html[data-theme=light] #mineRoot .li .ch{color:#98A2B3}html[data-theme=light] #mineRoot .li .ic{color:#475467}html[data-theme=light] #mineRoot .pwf input{background:#F7F9FB;border-color:#D0D5DD}",
      "html[data-theme=light] #mineSheet{background:rgba(16,24,40,.45)}html[data-theme=light] #mineSheet .sh{background:#FFFFFF;color:#101828}html[data-theme=light] #mineSheet .tabs2,html[data-theme=light] #mineSheet .stp2,html[data-theme=light] #mineSheet .sum,html[data-theme=light] #mineSheet .note2{background:#F2F4F7;color:#101828}html[data-theme=light] #mineSheet .stp2 button,html[data-theme=light] #mineSheet .x{background:#FFFFFF;color:#101828;box-shadow:0 1px 2px rgba(16,24,40,.08)}html[data-theme=light] #mineSheet .stp2 input{color:#101828}",
      "html[data-theme=light] #mineSheet .typ button,html[data-theme=light] #mineSheet .pre button,html[data-theme=light] #mineSheet .qc button{border-color:#D0D5DD;color:#344054}html[data-theme=light] #mineSheet .typ button.on{border-color:#101828;color:#101828}html[data-theme=light] #mineSheet .tpg input{background:#F7F9FB;color:#101828}html[data-theme=light] #mineSheet .tpg .tp{border-color:#F6C9CA;color:#C2272A}html[data-theme=light] #mineSheet .tpg .sl{border-color:#C6D8F7;color:#1B64DA}html[data-theme=light] #mineSheet .tpsl{border-top-color:#EEF1F5}html[data-theme=light] #mineSheet .grab{background:#D0D5DD}html[data-theme=light] #mineSheet b[style],html[data-theme=light] #mineSheet .shh b{color:#101828!important}",
      "html[data-theme=light] #luxGate{background:#F7F9FB;color:#101828}html[data-theme=light] #luxGate .lg,html[data-theme=light] #luxGate .x,html[data-theme=light] #luxGate .sw{background:#FFFFFF;border:1px solid #DCE1E8}html[data-theme=light] #luxGate .sw button.on{background:#101828;color:#fff}html[data-theme=light] #luxGate .f input{background:#FFFFFF;border-color:#D0D5DD;color:#101828}html[data-theme=light] #luxGate .p1{background:#101828;color:#fff}html[data-theme=light] #luxGate .ag{color:#344054}html[data-theme=light] #luxGate .ag a{color:#1B64DA}html[data-theme=light] #luxGate .lead,html[data-theme=light] #luxGate .fine{color:#475467}",
      "html[data-theme=light] #mineDetailBar .mdb{background:#FFFFFF;border-color:#DCE1E8;color:#101828;box-shadow:0 1px 2px rgba(16,24,40,.05)}html[data-theme=light] #mineDetailBar .sb{color:#667085}html[data-theme=light] #mineDetailBar .wbtn2{border-color:#D0D5DD;color:#344054}html[data-theme=light] .luxToast{background:#101828}",
      // [V33.734] 동의 배너 · 가입 동의서 · 내 데이터 요약
      "#luxConsent{position:fixed;left:12px;right:12px;bottom:calc(80px + env(safe-area-inset-bottom));z-index:10040;max-width:560px;margin:0 auto;background:#161A21;color:#EEF1F5;border:1px solid #2E3542;border-radius:16px;padding:14px 16px;box-shadow:0 14px 40px rgba(0,0,0,.4);font-size:13.5px;line-height:1.55}#luxConsent p{margin:0 0 10px}#luxConsent a{color:#7CC4FF}#luxConsent .cb{display:flex;gap:8px;justify-content:flex-end}#luxConsent button{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid #3A4250;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}#luxConsent button.pri{background:#EEF1F5;color:#0D1014;border-color:#EEF1F5}",
      "html[data-theme=light] #luxConsent{background:#FFFFFF;color:#101828;border-color:#DCE1E8;box-shadow:0 14px 40px rgba(16,24,40,.18)}html[data-theme=light] #luxConsent a{color:#1B4FB5}html[data-theme=light] #luxConsent button{border-color:#D0D5DD}html[data-theme=light] #luxConsent button.pri{background:#101828;color:#fff;border-color:#101828}",
      "#luxGate .itb{color:#3DD6B5;font-size:15px;letter-spacing:.04em}#luxGate .itl{list-style:none;padding:0;margin:14px 0 18px;display:flex;flex-direction:column;gap:10px}#luxGate .itl li{display:flex;flex-direction:column;padding:12px 14px;border-radius:12px;background:rgba(61,214,181,.07);border:1px solid rgba(61,214,181,.18)}#luxGate .itl b{font-size:15px}#luxGate .itl span{font-size:12.5px;opacity:.7;margin-top:2px}#luxGate .itr .p3{margin-top:8px}#luxGate .ag.one{margin:4px 0 0}#luxGate .agd{font-size:12px;color:#98A2B3;margin:2px 0 0}#luxGate .agd summary{cursor:pointer}#luxGate .agd .agt{margin-top:6px}#luxGate .agf{border:1px solid #2E3542;border-radius:14px;padding:10px 12px;margin:0;display:flex;flex-direction:column;gap:10px}#luxGate .agf legend{font-size:12.5px;color:#98A2B3;padding:0 6px}#luxGate .ag.all{padding-bottom:8px;border-bottom:1px solid #2E3542}#luxGate .agt{font-size:12px;line-height:1.6;color:#C7CDD6;background:rgba(127,137,155,.12);border-radius:10px;padding:8px 10px}html[data-theme=light] #luxGate .agf,html[data-theme=light] #luxGate .ag.all{border-color:#DCE1E8}html[data-theme=light] #luxGate .agt{color:#344054;background:#F2F4F7}",
      "#mineRoot .kvl{display:flex;flex-direction:column}#mineRoot .kvl div{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--m-line);font-size:13.5px}#mineRoot .kvl div:first-child{border-top:0}#mineRoot .kvl span{color:var(--m-mute);flex:0 0 auto}#mineRoot .kvl b{font-weight:600;text-align:right}",
      // [V33.732] 비밀번호 보기 · 언어 선택
      ".pwi{position:relative;display:flex}.pwi input{flex:1;min-width:0;padding-right:52px!important}.pwi .eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:44px;height:44px;border:0;border-radius:10px;background:transparent;color:#98A2B3;cursor:pointer;display:flex;align-items:center;justify-content:center}.pwi .eye.on{color:#3DD6B5}",
      "#mineRoot .li.lang{cursor:default}#mineRoot .li.lang .seg{margin-left:auto}",
      // [V33.730] MTS 주문창
      ".luxToast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));transform:translate(-50%,12px);opacity:0;z-index:10060;max-width:min(92vw,460px);padding:12px 16px;border-radius:14px;background:#191F28;color:#fff;font-size:14px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:.25s}.luxToast.on{opacity:1;transform:translate(-50%,0)}",
      "#mineSheet .shh{display:flex;justify-content:space-between;align-items:flex-start}#mineSheet .x{width:40px;height:40px;border-radius:20px;border:0;background:#20262F;color:#98A2B3;font-size:15px;cursor:pointer}",
      "#mineSheet .tabs2{display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#0D1014;border-radius:12px;padding:4px}#mineSheet .tabs2 button{min-height:42px;border:0;border-radius:9px;background:transparent;color:#98A2B3;font-size:15px;font-weight:700;cursor:pointer}#mineSheet .tabs2 button.on.b{background:#D42F2F;color:#fff}#mineSheet .tabs2 button.on.s{background:#2160D8;color:#fff}#mineSheet .tabs2 button:disabled{opacity:.45;cursor:default}",
      "#mineSheet .typ{display:grid;grid-template-columns:1fr 1fr;gap:6px}#mineSheet .typ button{min-height:38px;border-radius:10px;border:1px solid #2E3542;background:transparent;color:#C7CDD6;font-size:13.5px;cursor:pointer}#mineSheet .typ button.on{border-color:#EEF1F5;color:#fff;font-weight:700}",
      "#mineSheet .fld{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:#98A2B3}#mineSheet .fld i{font-style:normal;float:right}#mineSheet .fld em{font-style:normal;font-size:12px}#mineSheet .stp2{display:flex;align-items:center;gap:6px;background:#0D1014;border-radius:12px;padding:4px}#mineSheet .stp2 button{width:44px;height:42px;border-radius:9px;border:0;background:#20262F;color:#EEF1F5;font-size:20px;cursor:pointer}#mineSheet .stp2 input{flex:1;min-width:0;height:42px;border:0;background:transparent;color:#EEF1F5;text-align:center;font-size:18px;font-weight:700;font-family:inherit;font-variant-numeric:tabular-nums;outline:0}",
      "#mineSheet .tpsl{border-top:1px solid #232935;padding-top:12px;display:flex;flex-direction:column;gap:10px}#mineSheet .tph{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:600}#mineSheet .sw{width:48px;height:28px;border-radius:14px;border:0;background:#3A414D;position:relative;cursor:pointer;padding:0}#mineSheet .sw i{position:absolute;top:4px;left:4px;width:20px;height:20px;border-radius:10px;background:#fff;transition:.2s}#mineSheet .sw.on{background:#3DD6B5}#mineSheet .sw.on i{left:24px}",
      "#mineSheet .tpg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#mineSheet .tpg label{min-width:0;display:flex;flex-direction:column;gap:4px;border-radius:12px;padding:10px;font-size:12px}#mineSheet .tpg .tp{border:1px solid #5A2A30;color:#FF8A94}#mineSheet .tpg .sl{border:1px solid #23406E;color:#7FB0FF}#mineSheet .tpg input{width:100%;box-sizing:border-box;height:36px;border:0;border-radius:8px;background:#0D1014;color:#EEF1F5;font-size:16px;font-weight:700;padding:0 8px;font-family:inherit;min-width:0}#mineSheet .tpg em{font-style:normal;color:#98A2B3}#mineSheet .qc{display:flex;gap:4px}#mineSheet .qc button{flex:1;min-width:0;padding:0;min-height:30px;border-radius:7px;border:1px solid #2E3542;background:transparent;color:#C7CDD6;font-size:11.5px;cursor:pointer}",
      "#mineSheet .sum{background:#0D1014;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;font-size:13px}#mineSheet .sum div{display:flex;justify-content:space-between;gap:10px}#mineSheet .sum span:first-child{color:#98A2B3}#mineSheet .note2{font-size:13px;line-height:1.55;color:#C7CDD6;background:#0D1014;border-radius:12px;padding:10px 12px}#mineSheet .sh{max-height:92vh;overflow-y:auto}",
      "#mineSheet{position:fixed;inset:0;z-index:9999;background:rgba(4,8,16,.62);display:flex;align-items:flex-end;justify-content:center}",
      "#mineSheet .sh{width:min(520px,100%);background:#181C24;border-radius:22px 22px 0 0;padding:10px 20px calc(22px + env(safe-area-inset-bottom));color:#EEF1F5;display:flex;flex-direction:column;gap:14px;font-size:14px}",
      "#mineSheet .grab{width:40px;height:4px;border-radius:2px;background:#2E3542;align-self:center}#mineSheet .pre{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}",
      "#mineSheet .pre button{min-height:44px;border-radius:12px;border:1px solid #2E3542;background:transparent;color:#C7CDD6;font-size:14px;cursor:pointer}#mineSheet .pre button.on{border:2px solid var(--c);color:var(--c);font-weight:700}",
      "#mineSheet .stp{display:flex;align-items:center;justify-content:space-between;background:#0D1014;border-radius:14px;padding:6px 8px}#mineSheet .stp button{width:44px;height:44px;border-radius:12px;border:0;background:#20262F;color:#EEF1F5;font-size:22px;cursor:pointer}",
      "#mineSheet .go{min-height:54px;border-radius:14px;border:0;font-size:16px;font-weight:700;color:#fff;background:var(--c);cursor:pointer}#mineSheet .go:disabled{opacity:.45;cursor:default}#mineSheet .kv2{display:flex;justify-content:space-between;font-size:12.5px;color:#98A2B3}",
      /* UI 다듬기: 토스식 위계 · 보유 종목 한 줄 요약 + 펼치기 · 보조 카드 접기 */
      "#mineRoot{--m-tx:#EEF1F5;font-variant-numeric:tabular-nums}html[data-theme=light] #mineRoot{--m-tx:#101828}#mineRoot .ct .h2,#mineRoot .fh .h2{color:var(--m-tx)}#mineRoot .fold .fb{overflow-wrap:anywhere}#mineRoot .fold .fb *{min-width:0;max-width:100%}",
      "#mineRoot{font-variant-numeric:tabular-nums}#mineRoot .card{border-radius:18px;padding:16px 18px;margin:0 0 10px}#mineRoot .ct{margin-bottom:8px;font-size:12.5px}",
      "#mineRoot .h1{font-size:28px;font-weight:800;letter-spacing:-.6px;line-height:1.2}#mineRoot .h2{font-size:15.5px;font-weight:700;letter-spacing:-.2px}#mineRoot .today{margin-top:6px}",
      "#mineRoot .hi{margin:2px 4px 10px;font-size:14px}#mineRoot .wx{border-radius:14px;padding:12px 14px}#mineRoot .wx b{font-size:16px;margin:2px 0 4px}",
      "#mineRoot .btns{margin-top:14px}#mineRoot .b{min-height:44px;border-radius:12px}",
      "#mineRoot .hold{padding:12px 0;border-top:1px solid var(--m-line)}#mineRoot .ht .nm{font-size:15px}#mineRoot .ht .l .sb{white-space:normal;line-height:1.4}#mineRoot .ht .r .p{font-size:15px;font-weight:700}",
      "#mineRoot .hm{display:flex;align-items:center;flex-wrap:wrap;gap:2px 12px;margin:6px 0 0 18px;font-size:12px;color:var(--m-mute)}#mineRoot .hm b{font-weight:600}",
      "#mineRoot .hxb{margin-left:auto;min-height:28px;padding:0 10px;border-radius:14px;border:1px solid var(--m-line);background:transparent;color:var(--m-mute);font-size:12px;font-weight:600;cursor:pointer}#mineRoot .hold.open .hxb{color:var(--m-acc);border-color:var(--m-acc)}",
      "#mineRoot .hold .hx{display:none;margin:2px 0 0 18px}#mineRoot .hold.open .hx{display:block}#mineRoot .hold .hx>*{min-width:0;max-width:100%}",
      "#mineRoot .ha{margin:10px 0 0 18px;gap:8px}#mineRoot .ha button{min-height:38px;border-radius:10px;font-size:13px}",
      "#mineRoot .fold{padding:0}#mineRoot .fold .fh{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:0 18px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}",
      "#mineRoot .fold .fh .h2{flex:0 0 auto}#mineRoot .fold .fh .sb{flex:1;min-width:0;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#mineRoot .fold .chev{flex:0 0 8px;width:8px;height:8px;border-right:2px solid var(--m-mute);border-bottom:2px solid var(--m-mute);transform:rotate(45deg) translate(-2px,-2px);transition:transform .2s}#mineRoot .fold.open .chev{transform:rotate(225deg) translate(-2px,-2px)}",
      "#mineRoot .fold .fb{display:none;padding:0 18px 16px}#mineRoot .fold.open .fb{display:block}",
      "#mineRoot .alloc{margin-top:16px}#mineRoot .kv{margin-top:14px}#mineRoot .kv span{font-size:12px}",
      "#mineRoot .row{padding:11px 2px}#mineRoot .nm,#mineRoot .sb{min-width:0}",
      "@media (max-width:520px){#mineRoot .card{padding:14px 16px}#mineRoot .fold{padding:0}#mineRoot .fold .fh{padding:0 16px}#mineRoot .fold .fb{padding:0 16px 14px}#mineRoot .h1{font-size:26px}#mineRoot .hm,#mineRoot .hold .hx,#mineRoot .ha{margin-left:0}}",
      // [V33.789] MY 디자인 다듬기 — 간격 4/8/12/16/24 · 카드 20 · 히어로 · 탭 · 보유 · 순위 상위 3 · 성향 분할 버튼 · 빈 화면
      "#mineRoot{--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--m-up-bg:color-mix(in srgb,var(--m-up) 13%,transparent);--m-dn-bg:color-mix(in srgb,var(--m-dn) 14%,transparent);--m-acc-bg:color-mix(in srgb,var(--m-acc) 14%,transparent);--m-hair:color-mix(in srgb,var(--m-mute) 22%,transparent)}",
      "#mineRoot .tabs{top:var(--s2);padding:4px;gap:2px;margin:0 0 var(--s4);border-radius:18px;background:color-mix(in srgb,var(--m-card) 86%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid var(--m-hair);box-shadow:0 6px 20px -12px rgba(0,0,0,.45)}",
      "#mineRoot .tabs button{min-height:42px;border-radius:14px;font-size:14px;font-weight:600;letter-spacing:-.2px;white-space:nowrap;transition:background .18s,color .18s}#mineRoot .tabs button.on{background:var(--m-acc-bg);color:var(--m-acc);font-weight:800;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--m-acc) 32%,transparent)}",
      "#mineRoot .tabs button:focus-visible,#mineRoot .b:focus-visible,#mineRoot .ops button:focus-visible,#mineRoot .seg button:focus-visible{outline:2px solid var(--m-acc);outline-offset:2px}",
      "#mineRoot .card{border-radius:20px;padding:var(--s4) 20px;margin:0 0 var(--s3);border:1px solid var(--m-hair)}#mineRoot .ct{font-size:12.5px;font-weight:600;letter-spacing:.1px;margin-bottom:var(--s3)}",
      "#mineRoot .sec{font-size:12px;font-weight:700;letter-spacing:.6px;margin:var(--s5) 4px var(--s2)}#mineRoot .hi{margin:var(--s1) 4px var(--s3);font-size:13.5px}#mineRoot .hi b{color:var(--m-acc)}",
      "#mineRoot .seg{background:var(--m-bg);padding:3px;border-radius:12px;border:1px solid var(--m-hair)}#mineRoot .seg button{min-height:30px;padding:0 14px;border-radius:9px;font-weight:600}#mineRoot .seg button.on{background:var(--m-card);color:var(--m-tx);box-shadow:0 1px 3px rgba(0,0,0,.3),0 0 0 1px var(--m-hair)}",
      /* 히어로: 총자산 · 손익 알약 */
      "#mineRoot section[aria-label=\"모의계좌\"]{position:relative;padding:20px 20px var(--s4);background:radial-gradient(120% 90% at 0% 0%,var(--m-acc-bg) 0%,transparent 62%),var(--m-card);border-color:color-mix(in srgb,var(--m-acc) 28%,transparent)}",
      "#mineRoot section[aria-label=\"모의계좌\"] .h1{font-size:36px;font-weight:800;letter-spacing:-1.2px;line-height:1.1;margin:var(--s1) 0 var(--s3);color:var(--m-tx);overflow:hidden;text-overflow:ellipsis}",
      "#mineRoot section[aria-label=\"모의계좌\"] .h1+div{display:inline-block;max-width:100%;padding:6px 12px;border-radius:12px;font-size:13.5px;font-weight:700;line-height:1.35}#mineRoot section[aria-label=\"모의계좌\"] .h1+.up{background:var(--m-up-bg)}#mineRoot section[aria-label=\"모의계좌\"] .h1+.dn{background:var(--m-dn-bg)}",
      "#mineRoot .today{display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline;margin-top:var(--s3);padding-top:var(--s3);border-top:1px solid var(--m-hair);font-size:13px}",
      "#mineRoot .btns{gap:var(--s2);margin-top:var(--s4)}#mineRoot .b{min-height:46px;border-radius:14px;font-weight:700;letter-spacing:-.2px;transition:transform .12s,filter .12s}#mineRoot .b:active{transform:scale(.98)}#mineRoot .b.pri:hover{filter:brightness(1.06)}#mineRoot .b.line{border:1px solid var(--m-hair);color:var(--m-tx)}",
      "#mineRoot .wx{border:1px solid var(--m-hair);padding:var(--s3) var(--s4)}#mineRoot .wx>.mu{font-size:11.5px;font-weight:600;letter-spacing:.3px}#mineRoot .wx b{font-size:17px;font-weight:800;margin:var(--s1) 0 6px}",
      /* 목록 · 보유 종목 */
      "#mineRoot .row{gap:var(--s3);padding:var(--s3) 2px;border-top:1px solid var(--m-hair)}#mineRoot .row:first-of-type{border-top:0}#mineRoot .av{flex:0 0 40px;height:40px;border-radius:14px;font-size:11px;letter-spacing:-.2px;background:var(--m-chip);color:var(--m-tx)}",
      "#mineRoot .nm{font-size:15px;font-weight:700;letter-spacing:-.2px}#mineRoot .r .p,#mineRoot .r .up,#mineRoot .r .dn{font-variant-numeric:tabular-nums}#mineRoot .r .p{font-weight:700}",
      "#mineRoot .r .up,#mineRoot .r .dn{font-weight:700}#mineRoot .hold{border-top:1px solid var(--m-hair);padding:var(--s4) 0}#mineRoot .hold:first-of-type{border-top:0}",
      "#mineRoot .hold .l,#mineRoot .hold .ht{min-width:0}#mineRoot .hm{gap:2px 14px;margin-top:var(--s2);font-variant-numeric:tabular-nums}#mineRoot .hxb{min-height:30px;padding:0 12px;border-radius:15px;border-color:var(--m-hair)}",
      "#mineRoot .buy,#mineRoot .sell,#mineRoot .tag2{border-radius:12px;font-weight:700}#mineRoot .tag2.wbtn,#mineRoot .wbtn{border-color:var(--m-hair);color:var(--m-tx)}",
      "#mineRoot .pill{font-weight:700;letter-spacing:.1px;border-radius:7px}",
      /* 빈 화면 */
      "#mineRoot .empty{display:flex;align-items:center;justify-content:center;text-align:center;min-height:112px;margin:var(--s2) 0;padding:var(--s5) var(--s4);border:1px dashed var(--m-hair);border-radius:16px;background:color-mix(in srgb,var(--m-bg) 55%,transparent);font-size:13.5px;line-height:1.6;color:var(--m-mute)}",
      "#mineRoot .note{line-height:1.6}",
      /* 순위: 상위 3 강조 */
      "#mineRoot .rkrow{padding:var(--s3) var(--s2);border-radius:14px;border-top:0;gap:var(--s3)}#mineRoot .rkrow+.rkrow{margin-top:2px}#mineRoot .rk{flex:0 0 30px;width:30px;height:30px;line-height:30px;border-radius:15px;font-size:14px;font-weight:800;color:var(--m-mute);background:var(--m-chip)}",
      "#mineRoot .rkrow.top1{background:linear-gradient(90deg,rgba(226,170,40,.16),transparent 85%)}#mineRoot .rkrow.top2{background:linear-gradient(90deg,rgba(160,172,190,.16),transparent 85%)}#mineRoot .rkrow.top3{background:linear-gradient(90deg,rgba(205,127,74,.16),transparent 85%)}",
      "#mineRoot .rk.hot{color:#3A2A00;background:#E5B93C}#mineRoot .top2 .rk.hot{color:#1F2630;background:#B9C2D0}#mineRoot .top3 .rk.hot{color:#2D1606;background:#D08A57}",
      "#mineRoot .top1 .nm{font-size:16.5px;font-weight:800}#mineRoot .top1 .r .p{font-size:16.5px}#mineRoot .rkrow.me{box-shadow:inset 0 0 0 1.5px var(--m-acc);background:var(--m-acc-bg)}",
      "#mineRoot .myrk{border-color:color-mix(in srgb,var(--m-acc) 30%,transparent);background:radial-gradient(110% 120% at 100% 0%,var(--m-acc-bg),transparent 65%),var(--m-card);padding:20px}#mineRoot .myrk .h1{font-size:30px;letter-spacing:-.8px;color:var(--m-tx)}",
      /* 내 정보: 프로필 · 성향 분할 버튼 */
      "#mineRoot .pf{padding:20px;background:radial-gradient(120% 100% at 0% 0%,var(--m-acc-bg),transparent 60%),var(--m-card);border-color:color-mix(in srgb,var(--m-acc) 28%,transparent)}#mineRoot .st3{border-top-color:var(--m-hair);margin-top:var(--s4);padding-top:var(--s4)}#mineRoot .st3 b{font-size:17px;font-weight:800}",
      "#mineRoot .tg span{background:var(--m-chip);border:1px solid var(--m-hair);font-weight:600;font-size:13px;padding:7px 13px}",
      "#mineRoot .ops{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:2px;padding:3px;margin:var(--s2) 0 var(--s4);background:var(--m-bg);border:1px solid var(--m-hair);border-radius:14px}#mineRoot .ops button{min-height:42px;padding:0 6px;border:0;border-radius:11px;background:transparent;color:var(--m-mute);font-size:13.5px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:background .15s,color .15s}",
      "#mineRoot .ops button.on{background:var(--m-acc);color:#04110D;font-weight:800;box-shadow:0 1px 4px rgba(0,0,0,.25)}html[data-theme=light] #mineRoot .ops button.on{color:#fff}",
      "#mineRoot .card>span.mu[style]{display:block;font-size:12px!important;font-weight:700;letter-spacing:.4px}#mineRoot .lst .li{min-height:56px}#mineRoot .li .ic{border-radius:10px}",
      "html[data-theme=light] #mineRoot .card{box-shadow:0 1px 2px rgba(16,24,40,.04),0 6px 18px -12px rgba(16,24,40,.12)}html[data-theme=light] #mineRoot .tabs{box-shadow:0 6px 18px -12px rgba(16,24,40,.25)}",
      "@media (max-width:520px){#mineRoot{padding:4px 0 96px}#mineRoot .card{padding:var(--s4)}#mineRoot section[aria-label=\"모의계좌\"]{padding:var(--s4)}#mineRoot section[aria-label=\"모의계좌\"] .h1{font-size:32px}#mineRoot .tabs button{font-size:13.5px}#mineRoot .row{gap:10px}#mineRoot .pf,#mineRoot .myrk{padding:var(--s4)}}",
      "#mineRoot .card.fold{padding:0}html[data-theme=light] #mineRoot .tabs button.on{background:var(--m-acc-bg);color:var(--m-acc)}html[data-theme=light] #mineRoot .seg button.on{background:#fff;color:#101828}html[data-theme=light] #mineRoot .tabs{border-color:#DCE1E8}",
      "@media (prefers-reduced-motion:reduce){#mineRoot *{transition:none!important}}"
    ].join("");
    document.head.appendChild(st);
  }

  function rowQ(sym, sub, tags, right, rank, tier) {
    var x = q(sym), c = chg(x), p = px(x), li = (!p || c == null) ? liveItem(sym) : null;
    if (!p && li) p = li.px; if (c == null && li && typeof li.dp === "number") c = li.dp;
    return '<div class="row" data-open="' + esc(sym) + '">' + (rank ? '<span class="rk' + (tier === 0 ? " hot" : "") + '">' + rank + "</span>" : '<div class="av">' + esc(short(sym).slice(0, 4)) + "</div>") + '<div class="l"><span class="nm">' + esc(nm(sym)) + (tags || "") + '</span><span class="sb">' + esc(sub) + "</span></div>" +
      '<div class="r"><span class="p">' + (p ? (isKr(sym) ? "₩" + Math.round(p).toLocaleString() : "$" + p.toFixed(2)) : "—") + '</span><span class="' + cls(c) + '" style="font-size:12.5px">' + pctS(c) + "</span></div>" + (right || "") + "</div>";
  }
  /* [V33.778] ★AI 가 실제로 산 종목 표시★(사용자 11/6) — 서버 모의계좌(AI)의 지금 보유(상태 positions) · 최근 매수(매매법 AI 기록 · 15건). 추가 요청 0(이미 받은 상태·판정 사본). */
  function aiPos(mk) { var st = window.__lastState, p = st && st.positions && st.positions[mk]; return Array.isArray(p) ? p : []; }
  function aiHeld(sym) { var mk = isKr(sym) ? "kr" : "us"; return aiPos(mk).some(function (x) { return x.symbol === sym && x.qty > 0; }); }
  function aiBought(sym) { var r = (PB && PB.recent) || []; for (var i = 0; i < r.length; i++) if (r[i].symbol === sym && Date.now() - r[i].ts < 30 * 864e5) return r[i]; return null; }
  function aiTag(sym) { return aiHeld(sym) ? '<span class="pill ai">AI 보유 중</span>' : aiBought(sym) ? '<span class="pill ai2">AI 매수함</span>' : ""; }
  /* [V33.778] ★AI 전망(단기·중기·장기)★ — outlook.js 규칙 엔진(브라우저 계산 · 서버 0) */
  function outlookOf(sym) {
    var L = window.luxOutlook, st = window.__lastState, x = q(sym); if (!L || !x) return null;
    var mk = isKr(sym) ? "kr" : "us", rg = PB && PB.markets && PB.markets[mk] && PB.markets[mk].regime;
    return L.stock(x, st ? L.ctxOf(st, mk, rg) : null, { earnDays: earnDays(sym) });
  }
  function outlookHtml(sym) {
    var o = outlookOf(sym); if (!o) return "";
    var one = function (k, t) { var v = o[k]; return '<span class="ol ' + v.cls + '"><i>' + t + "</i>" + v.label + "</span>"; };
    var why = function (k, t) { var v = o[k]; return v.why.length ? '<div class="olw"><b><span>' + t + "</span> · <span>" + v.label + "</span></b>" + v.why.map(function (w) { return "<span>" + window.luxOutlook.whyHtml(w, esc) + "</span>"; }).join("") + "</div>" : ""; };
    return '<details class="olx"><summary><b>AI 전망</b>' + one("s", "단기") + one("m", "중기") + one("l", "장기") + '<span class="olm">근거</span></summary>' + why("s", "단기 1~4주") + why("m", "중기 1~6개월") + why("l", "장기 1년+") + '<div class="olw"><span style="opacity:.75">가격·추세·시장 흐름 규칙으로 계산 · 재무(실적·PER)는 아직 반영 안 함 · 투자 권유 아님</span></div></details>';
  }
  /* [V33.778] ★AI 포트폴리오 — 현금·주식 비중★(사용자 11/6) — 서버 AI 모의계좌(상태 cash·positions · 이미 받은 값) */
  function aiPortfolio(mk) {
    var st = window.__lastState; if (!st || !st.cash) return "";
    var cash = +st.cash[mk] || 0, pos = aiPos(mk), rows = [], stk = 0;
    pos.forEach(function (p) { if (!(p.qty > 0)) return; var cur = priceOf(p.symbol) || p.avg, mv = cur * p.qty; stk += mv; rows.push({ s: p.symbol, mv: mv, r: p.avg > 0 ? (cur / p.avg - 1) * 100 : 0 }); });
    var tot = cash + stk; if (!(tot > 0)) return "";
    rows.sort(function (a, b) { return b.mv - a.mv; });
    var sp = stk / tot * 100;
    var fo = !!foldOpen.aipf;
    return '<section class="card fold aipf' + (fo ? " open" : "") + '" aria-label="AI 포트폴리오"><button type="button" class="fh" data-fold="aipf" aria-expanded="' + fo + '"><span class="h2">AI 포트폴리오</span><span class="sb">' + MK[mk] + " · 주식 " + sp.toFixed(0) + '%</span><i class="chev" aria-hidden="true"></i></button><div class="fb">' +
      '<div class="h1" style="font-size:22px">' + fmt(mk, tot) + '</div><div class="cashbar"><i style="width:' + sp.toFixed(1) + '%"></i></div>' +
      '<div class="aipk"><span><i class="d1"></i>주식 <b>' + sp.toFixed(1) + "%</b> " + fmt(mk, stk) + '</span><span><i class="d2"></i>현금 <b>' + (100 - sp).toFixed(1) + "%</b> " + fmt(mk, cash) + "</span></div>" +
      (rows.length ? rows.slice(0, 6).map(function (r) { return '<div class="row" data-open="' + esc(r.s) + '"><div class="av">' + esc(short(r.s).slice(0, 4)) + '</div><div class="l"><span class="nm">' + esc(nm(r.s)) + '</span><span class="sb">비중 ' + (r.mv / tot * 100).toFixed(1) + '%</span></div><div class="r"><span class="p">' + fmt(mk, r.mv) + '</span><span class="' + cls(r.r) + '" style="font-size:12.5px">' + pctS(r.r) + "</span></div></div>"; }).join("") + (rows.length > 6 ? '<div class="note">외 ' + (rows.length - 6) + "종목</div>" : "") : '<div class="note" style="margin-top:6px">지금은 주식 없이 현금만 들고 있어요 · 시장 국면이 나쁠 때 AI 는 현금 비중을 높입니다</div>') +
      "</div></section>";
  }
  function pill(sig) { return !sig ? "" : sig.watch ? '<span class="pill w">관찰</span>' : sig.sl ? '<span class="pill s">국면 전략</span>' : '<span class="pill">AI 후보</span>'; }
  function buyBtn(sym) { return '<button type="button" class="buy" data-buy="' + esc(sym) + '">매수</button>'; }

  function home() {
    var mk = has(acMk) ? acMk : (has("us") ? "us" : has("kr") ? "kr" : acMk), v = val(mk), h = "", hr = new Date().getHours();
    h += '<div class="hi"><span>' + (hr < 12 ? "좋은 아침이에요" : hr < 18 ? "좋은 오후예요" : "좋은 저녁이에요") + (prof.nick ? ", <b>" + esc(prof.nick) + "</b>님" : "") + '</span><span class="mu">' + RISK[prof.risk] + " · " + HOR[prof.horizon] + "</span></div>";
    h += '<section class="card" aria-label="모의계좌"><div class="ct"><span>모의계좌 총자산</span><span class="seg">' + ["us", "kr"].map(function (m) { return '<button type="button" data-acmk="' + m + '" class="' + (m === mk ? "on" : "") + '">' + MK[m] + "</button>"; }).join("") + "</span></div>" +
      (v ? '<div class="h1">' + fmt(mk, v.eq) + '</div><div class="' + cls(v.ret) + '">' + fmt(mk, v.eq - prof.pf[mk].start, true) + " (" + pctS(v.ret) + ") · 시작 후 " + v.days + "일</div>" + (v.n ? '<div class="today">오늘 <b class="' + cls(v.day) + '">' + fmt(mk, v.day, true) + " (" + pctS(v.dayPct) + ")</b> · 보유 " + v.n + "종목</div>" : "")
         : '<div class="h2" style="margin:6px 0 2px">가상 ' + fmt(mk, START[mk]) + '으로 AI 후보를 따라 사 보세요</div><div class="note">실제 돈은 쓰지 않습니다 · 내 성적이 이 기기에만 쌓입니다</div>') +
      '<div class="btns">' + (v ? '<button type="button" class="b pri" data-tab="acct">내 계좌 보기</button>' : '<button type="button" class="b pri" data-open-acct="' + mk + '">' + MK[mk] + " 계좌 만들기</button>") + '<button type="button" class="b" data-tab="watch">종목 찾기</button></div></section>';
    h += '<div class="g2">' + prof.mkts.map(function (m) { var r = PB && PB.markets && PB.markets[m] && PB.markets[m].regime;
      return '<div class="wx"><span class="mu" style="font-size:12px">' + MK[m] + ' 시장</span><b style="color:' + (REGC[r] || "inherit") + '">' + (REG[r] || "불러오는 중") + '</b><span style="font-size:12.5px;line-height:1.45;color:#C7CDD6">' + esc(r && GUIDE[r] ? GUIDE[r][prof.risk] : "") + "</span></div>"; }).join("") + "</div>";
    var rmk = prof.mkts.indexOf(acMk) >= 0 ? acMk : prof.mkts[0], rk = ranked(rmk), rg = PB && PB.markets && PB.markets[rmk] && PB.markets[rmk].regime;
    h += '<section class="card" aria-label="AI 순위"><div class="ct"><span class="h2" style="color:inherit">AI 매수 추천 순위</span>' +
      (prof.mkts.length > 1 ? '<span class="seg">' + prof.mkts.map(function (m) { return '<button type="button" data-acmk="' + m + '" class="' + (m === rmk ? "on" : "") + '">' + MK[m] + "</button>"; }).join("") + "</span>" : '<span>' + MK[rmk] + "</span>") + "</div>" +
      (rk.length ? rk.map(function (r, i) {
        var on = prof.watch.indexOf(r.s) >= 0;
        return rowQ(r.s, rankSub(r), aiTag(r.s), '<button type="button" class="tag2 wbtn' + (on ? " on" : "") + '" data-addwatch="' + esc(r.s) + '" aria-label="관찰에 ' + (on ? "담김" : "추가") + '">' + (on ? "관찰중" : "관찰") + "</button>" + buyBtn(r.s), i + 1, r.tier);
      }).join("") : '<div class="empty">AI 판정을 불러오는 중이거나 아직 오늘 판정이 없습니다.</div>') +
      '<div class="note" style="margin-top:6px">' + MK[rmk] + " " + (REG[rg] || "") + " · 순위 = 매수 신호 → 검증 대기 → AI 점수 순 · 관찰 = 관심종목에 담기 · <b class=\"aiK\">AI 보유 중</b> = AI 계좌가 지금 들고 있음 · <b class=\"aiK2\">AI 매수함</b> = 최근 30일 안에 실제로 삼 · 모의투자</div></section>";
    h += aiPortfolio(rmk);
    return h;
  }
  /* [V33.746] ★보유 종목은 관심에 늘 보인다★(사용자 11/4) — 관심에 안 담았어도 들고 있으면 맨 위에 · 다 팔면 사라진다(직접 담은 종목은 그대로 남음) */
  function heldSyms() { var o = []; ["us", "kr"].forEach(function (m) { if (has(m)) Object.keys(prof.pf[m].pos || {}).forEach(function (k) { if (prof.pf[m].pos[k].q > 0) o.push(k); }); }); return o; }
  function watch() {
    var hs = heldSyms(), all = hs.concat(prof.watch.filter(function (s) { return hs.indexOf(s) < 0; })), list = all.slice();
    if (wFilter === "sig") list = list.filter(function (s) { return !!sigOf(s); });
    if (wFilter === "held") list = list.filter(function (s) { return held(s) > 0; });
    var nSig = all.filter(function (s) { return !!sigOf(s); }).length, nHeld = hs.length;
    var h = '<label class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#98A2B3" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>' +
      '<input id="mineSearch" type="search" autocomplete="off" aria-label="종목 검색" placeholder="이름이나 코드 (엔비디아, NVDA, 삼성전자)"></label><div id="mineFound"></div>' +
      '<div class="chips">' + [["all", "전체 " + all.length], ["sig", "AI 신호 " + nSig], ["held", "보유 " + nHeld]].map(function (c) { return '<button type="button" data-wf="' + c[0] + '" class="' + (wFilter === c[0] ? "on" : "") + '">' + c[1] + "</button>"; }).join("") + "</div>";
    h += '<section class="card" style="margin-top:10px">' + (list.length ? list.map(function (s) {
      var sig = sigOf(s), hq = held(s);
      var inW = prof.watch.indexOf(s) >= 0;
      return rowQ(s, short(s) + (hq ? " · 보유 " + hq.toLocaleString() + "주" : ""), (hq ? '<span class="pill hold">보유</span>' : "") + pill(sig) + aiTag(s), buyBtn(s) + (hq ? '<button type="button" class="sell" data-sell="' + esc(s) + '">매도</button>' : "") + (inW ? '<button type="button" class="tag2" style="cursor:pointer;min-width:40px;justify-content:center" data-unwatch="' + esc(s) + '" aria-label="관심 해제">✕</button>' : '<span class="tag2" style="min-width:40px;justify-content:center;visibility:hidden" aria-hidden="true">✕</span>'));
    }).join("") : '<div class="empty">' + (all.length ? "이 조건에 맞는 종목이 없습니다" : "위 검색창에서 종목을 찾아 추가하거나 바로 사 보세요") + "</div>") + "</section>";
    return h;
  }
  /* [V33.778] ★AI 코치·종목 조언★ — public/advisor.js(규칙·템플릿 · 브라우저 계산 · 서버 0). 이 화면이 가진 값만 넘긴다. */
  function advCtx(mk) {
    var st = window.__lastState, want = mk === "kr" ? "^KS11" : "^GSPC", md = null;
    ((st && st.indices) || []).forEach(function (x) { if (x.symbol === want && typeof x.dayPct === "number") md = x.dayPct; });
    return { mk: mk, regime: PB && PB.markets && PB.markets[mk] && PB.markets[mk].regime, mktDay: md };
  }
  function advHoldings(mk, ord2) {
    return ord2.map(function (o) { var sv = sellView(mk, o.s, o.p, o.cur);
      return { s: o.s, name: nm(o.s), p: o.p, cur: o.cur, mv: o.mv, r: o.r, d: o.d, dayAmt: posDay(mk, o.s, o.p, o.cur)[0], q: q(o.s), ol: outlookOf(o.s), sv: sv, lev: isLev(o.s), earn: earnDays(o.s), hd: heldDays(o.p) }; });
  }
  function coachCard(mk, v, hs) {
    var AD = window.luxAdvisor; if (!AD) return "";
    AD.css();
    var ctx = advCtx(mk), av = { eq: v.eq, cash: v.cash, mv: v.mv, upl: v.upl, ret: v.ret, day: v.day, dayPct: v.dayPct, n: v.n }, acc = AD.account(mk, av, hs, ctx);
    var ans = coachQ ? AD.coach(coachQ, mk, av, hs, ctx) : null;
    var fo = !!(foldOpen.coach || coachQ);
    return '<section class="card fold coach' + (fo ? " open" : "") + '" aria-label="AI 코치"><button type="button" class="fh" data-fold="coach" aria-expanded="' + fo + '"><span class="h2">AI 코치</span><span class="sb">내 계좌 숫자로 계산</span><i class="chev" aria-hidden="true"></i></button><div class="fb">' +
      '<p class="adv-p"><i class="adv-t ' + acc.tone + '" aria-hidden="true"></i>' + AD.span(acc) + "</p>" +
      (acc.actions.length ? '<div class="sb" style="margin-bottom:4px">다음에 할 일</div><ul class="adv-a">' + acc.actions.map(function (a) { return "<li>" + AD.span(a) + "</li>"; }).join("") + "</ul>" : "") +
      '<div class="sb" style="margin-bottom:2px">질문을 눌러 보세요</div><div class="adv-c">' + AD.INTENTS.map(function (c) { return '<button type="button" data-coach="' + c.id + '" class="' + (coachQ === c.id ? "on" : "") + '" aria-pressed="' + (coachQ === c.id) + '">' + AD.span(c) + "</button>"; }).join("") + "</div>" +
      (ans && ans.ko ? '<div class="adv-q"><b>' + AD.span(AD.INTENTS.filter(function (c) { return c.id === coachQ; })[0]) + "</b>" + AD.span(ans) +
        (ans.actions.length ? '<ul class="adv-a" style="margin-top:8px">' + ans.actions.map(function (a) { return "<li>" + AD.span(a) + "</li>"; }).join("") + "</ul>" : "") + "</div>" : "") +
      '<div class="adv-n">' + AD.span(acc.note) + "</div></div></section>";
  }
  function advHoldHtml(mk, v, hx) {
    var AD = window.luxAdvisor; if (!AD || !hx) return "";
    var a = AD.holding(hx.s, hx.p, hx.q, { mk: mk, name: hx.name, cur: hx.cur, eq: v.eq, mv: hx.mv, sell: hx.sv, outlook: hx.ol, earnDays: hx.earn, heldDays: hx.hd, lev: hx.lev, regime: advCtx(mk).regime });
    return '<details class="adv-h ' + a.tone + '"><summary><b>AI 조언</b><span class="adv-s">' + AD.span(a.short) + "</span></summary><div class=\"adv-b\"><p class=\"adv-p\">" + AD.span(a) + "</p>" +
      '<ul class="adv-a">' + a.actions.map(function (x) { return "<li>" + AD.span(x) + "</li>"; }).join("") + '</ul><div class="adv-n">' + AD.span(a.note) + "</div></div></details>";
  }
  function acctTab() {
    var mk = acMk, h = '<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 12px"><span class="h2">내 모의계좌</span><span class="seg">' + ["us", "kr"].map(function (m) { return '<button type="button" data-acmk="' + m + '" class="' + (m === mk ? "on" : "") + '">' + MK[m] + "</button>"; }).join("") + "</span></div>";
    if (!has(mk)) return h + '<section class="card"><div class="h2">' + MK[mk] + ' 모의계좌가 아직 없습니다</div><div class="note" style="margin-top:4px">가상 ' + fmt(mk, START[mk]) + '으로 시작 · 실제 돈은 쓰지 않습니다</div><div class="btns"><button type="button" class="b pri" data-open-acct="' + mk + '">계좌 만들기</button></div></section>';
    var a = prof.pf[mk], v = val(mk), ks = Object.keys(a.pos);
    h += '<section class="card"><div class="ct"><span>총자산 · ' + v.days + '일째</span></div><div class="h1">' + fmt(mk, v.eq) + '</div><div class="' + cls(v.ret) + '">' + fmt(mk, v.eq - a.start, true) + " (" + pctS(v.ret) + ")</div>" + (v.n ? '<div class="today">오늘 <b class="' + cls(v.day) + '">' + fmt(mk, v.day, true) + " (" + pctS(v.dayPct) + ")</b></div>" : "") +
      '<div class="alloc" aria-label="자산 비중">' + (v.eq > 0 ? ks.map(function (s, i) { var p = a.pos[s], w = p.q * (px(q(s)) || p.avg) / v.eq * 100; return '<i style="width:' + w.toFixed(2) + '%;background:' + ACOL[i % ACOL.length] + '" title="' + esc(nm(s)) + " " + w.toFixed(1) + '%"></i>'; }).join("") : "") + '<i class="cashbar" style="flex:1" title="현금"></i></div>' +
      '<div class="kv kv4"><div><span>주문 가능</span>' + fmt(mk, v.cash) + '</div><div><span>주식</span>' + fmt(mk, v.mv) + '</div><div><span>평가손익</span><b class="' + cls(v.upl) + '" style="font-weight:600">' + fmt(mk, v.upl, true) + '</b></div><div><span>실현손익</span><b class="' + cls(v.eq - a.start - v.upl) + '" style="font-weight:600">' + fmt(mk, v.eq - a.start - v.upl, true) + "</b></div></div></section>";
    /* [V33.741] ★보유 종목 카드 재배치★ — 폰에서 평단·익절가가 '…' 로 잘리고 버튼 셋이 한 줄에 끼었다. 위: 이름·평가액·손익 / 가운데: 수량·평단·비중·오늘·TP/SL / 아래: 버튼 3개.
       정렬: 평가액 · 수익률 · 오늘 */
    var ord2 = ks.map(function (s) { var p = a.pos[s], cur = priceOf(s) || p.avg; return { s: s, p: p, cur: cur, mv: p.q * cur, r: (cur / p.avg - 1) * 100, d: posDay(mk, s, p, cur)[1] }; });   // [V33.770] 오늘 % 도 보유 기준(이번 장에 산 것은 평단 대비)
    ord2.sort(function (x, y) { return hSort === "ret" ? y.r - x.r : hSort === "day" ? (y.d == null ? -1e9 : y.d) - (x.d == null ? -1e9 : x.d) : y.mv - x.mv; });
    earnLoad();
    var advHs = advHoldings(mk, ord2), advMap = {}; advHs.forEach(function (x) { advMap[x.s] = x; });
    if (v.eq > 0) h += coachCard(mk, v, advHs);
    /* [V33.772] ★계좌 진단★(화면 계산 · 서버 0) — 현금 비중 ↔ 지금 국면 · 한 종목 쏠림 · 레버리지 비중 · 손절선 근처 · 실적 임박. 참고 지표이지 권유가 아니다. */
    if (ks.length && v.eq > 0) (function () {
      var rg = PB && PB.markets && PB.markets[mk] && PB.markets[mk].regime, cashP = v.cash / v.eq * 100;
      var band = { SURGE: [10, 40], BULL: [10, 40], NEUTRAL: [30, 60], BEAR: [50, 80], CRASH: [50, 90] }[rg] || null, RK = { SURGE: "폭등", BULL: "상승", NEUTRAL: "보합", BEAR: "하락", CRASH: "폭락" };
      var top = ord2.slice().sort(function (x, y) { return y.mv - x.mv; })[0], topW = top ? top.mv / v.eq * 100 : 0, levW = 0, near = [], earn = [], losers = 0;
      ord2.forEach(function (o) { if (isLev(o.s)) levW += o.mv / v.eq * 100; var sv = sellView(mk, o.s, o.p, o.cur); if (o.cur > sv.sl && o.cur <= sv.sl * 1.03) near.push(nm(o.s)); var e2 = earnDays(o.s); if (e2 != null && e2 <= 7) earn.push(nm(o.s) + " D-" + e2); if (o.r < 0) losers++; });
      var L = [];
      if (band) L.push([cashP < band[0] ? "w" : cashP > band[1] ? "i" : "ok", "<span>현금 " + cashP.toFixed(0) + "%</span> · <span>지금 " + (RK[rg] || rg) + " 국면</span> · <span>참고 범위 " + band[0] + "~" + band[1] + "%</span>"]);
      L.push([topW >= 40 ? "w" : "ok", "<span>가장 큰 종목</span> " + esc(nm(top.s)) + " " + topW.toFixed(0) + "%" + (topW >= 40 ? " · <span>한 종목 쏠림</span>" : "")]);
      if (levW > 0) L.push([levW >= 30 ? "w" : "i", "<span>레버리지·인버스 ETF " + levW.toFixed(0) + "%</span>" + (levW >= 30 ? " · <span>변동성 큼</span>" : "")]);
      if (near.length) L.push(["w", "<span>손절선 3% 안:</span> " + near.map(esc).join(", ")]);
      if (earn.length) L.push(["i", "<span>실적 발표 임박:</span> " + earn.map(esc).join(", ")]);
      L.push([losers > ks.length / 2 ? "i" : "ok", "손실 " + losers + " · 이익 " + (ks.length - losers) + "종목"]);
      /* [V33.778] 기간별 전망 비중 — 내 돈의 몇 %가 단기·중기 '주의' 종목에 있나 · 장기 부적합(레버리지) */
      (function () { var sw = 0, mw = 0, lw = 0; ord2.forEach(function (o) { var ol = outlookOf(o.s); if (!ol) return; var w = o.mv / v.eq * 100; if (ol.s.score <= -1) sw += w; if (ol.m.score <= -1) mw += w; if (ol.l.score <= -2) lw += w; });
        if (sw > 0 || mw > 0) L.push([mw >= 40 ? "w" : "i", "<span>AI 전망 주의 비중 · 단기 " + sw.toFixed(0) + "% · 중기 " + mw.toFixed(0) + "%</span>" + (mw >= 40 ? " · <span>추세가 꺾인 종목이 많아요 — 손절선·비중 점검</span>" : "")]);
        if (lw > 0) L.push(["w", "<span>장기 보유에 맞지 않는 상품 " + lw.toFixed(0) + "%</span>"]);
        if (!(sw > 0 || mw > 0) && ord2.length) L.push(["ok", "<span>AI 전망 · 단기·중기 주의 신호 없음</span>"]); })();
      var nW = L.filter(function (x) { return x[0] === "w"; }).length, fo = !!foldOpen.diag;
      h += '<section class="card fold diag' + (fo ? " open" : "") + '"><button type="button" class="fh" data-fold="diag" aria-expanded="' + fo + '"><span class="h2">계좌 진단</span><span class="sb">' + (nW ? "주의 " + nW + "건" : "이상 없음") + '</span><i class="chev" aria-hidden="true"></i></button><div class="fb">' + L.map(function (x) { return '<div class="dl ' + x[0] + '"><i aria-hidden="true"></i><span>' + x[1] + "</span></div>"; }).join("") + "</div></section>";
    })();
    h += '<section class="card"><div class="ct" style="margin-bottom:2px"><span class="h2" style="color:inherit">보유 ' + ks.length + '종목</span>' + (ks.length > 1 ? '<span class="seg">' + [["val", "평가액"], ["ret", "수익률"], ["day", "오늘"]].map(function (c) { return '<button type="button" data-hs="' + c[0] + '" class="' + (hSort === c[0] ? "on" : "") + '">' + c[1] + "</button>"; }).join("") + "</span>" : "") + "</div>" + (ks.length ? ord2.map(function (o) {
      var s = o.s, p = o.p, ci = ks.indexOf(s);
      var hxo = !!hxOpen[s];
      return '<div class="hold' + (hxo ? " open" : "") + '" data-open="' + esc(s) + '"><div class="ht"><span class="dot" style="background:' + ACOL[ci % ACOL.length] + '" aria-hidden="true"></span><div class="l"><span class="nm">' + esc(nm(s)) + pill(sigOf(s)) + '</span><span class="sb">' + p.q.toLocaleString() + "주 · 평단 " + pxS(mk, p.avg) + " · 현재 " + pxS(mk, o.cur) + '</span></div><div class="r"><span class="p">' + fmt(mk, o.mv) + '</span><span class="' + cls(o.r) + '" style="font-size:12.5px">' + fmt(mk, o.mv - p.q * p.avg, true) + " (" + pctS(o.r) + ")</span></div></div>" +
        '<div class="hm"><span>비중 <b>' + (v.eq > 0 ? (o.mv / v.eq * 100).toFixed(0) : 0) + '%</b></span><span>오늘 <b class="' + cls(o.d) + '">' + pctS(o.d) + "</b></span>" + (p.tpPx ? '<span>익절 <b class="up">' + pxS(mk, p.tpPx) + "</b></span>" : "") + (p.slPx ? '<span>손절 <b class="dn">' + pxS(mk, p.slPx) + "</b></span>" : "") + '<button type="button" class="hxb" data-hx="' + esc(s) + '" aria-expanded="' + hxo + '">' + (hxo ? "접기" : "AI 의견") + "</button></div>" +
        '<div class="hx">' + (function () { var sv = sellView(mk, s, p, o.cur); return '<div class="so ' + sv.v + '"><span class="sv"><b>AI 매도 의견</b> ' + sv.ko + '</span><span class="sw">' + sv.why.map(rsH).join(" · ") + '</span>' + (sv.ref.length ? '<span class="sw rf"><span>참고</span> · ' + sv.ref.map(rsH).join(" · ") + "</span>" : "") + '<span class="sw"><span>' + (sv.ai ? "AI 손절" : "기준 손절") + "</span> " + pxS(mk, sv.sl) + " · <span>목표</span> " + pxS(mk, sv.tp) + "</span></div>"; })() + outlookHtml(s) + (window.luxMiniView ? window.luxMiniView.html(s) : "") + advHoldHtml(mk, v, advMap[s]) + '</div>' +
        '<div class="ha"><button type="button" class="tag2 wbtn" data-risk="' + esc(s) + '" aria-label="익절 손절 설정">' + (p.tpPx || p.slPx ? "TP/SL 수정" : "TP/SL 설정") + "</button>" + buyBtn(s) + '<button type="button" class="sell" data-sell="' + esc(s) + '">매도</button></div></div>';
    }).join("") : '<div class="empty">홈의 AI 후보나 관심종목에서 [매수]를 눌러 보세요</div>') + "</section>";
    var od = a.ord || [];
    if (od.length) h += '<section class="card"><div class="h2" style="margin-bottom:4px">예약 주문 ' + od.length + '건</div>' + od.map(function (o) {
      return '<div class="row" data-open="' + esc(o.s) + '"><div class="l"><span class="nm">' + esc(nm(o.s)) + ' <span class="pill ' + (o.side === "B" ? "" : "s") + '">예약 ' + (o.side === "B" ? "매수" : "매도") + '</span></span><span class="sb">' + pxS(mk, o.px) + (o.side === "B" ? " 이하" : " 이상") + " 도달 시 " + o.q.toLocaleString() + "주" + (o.tpPx ? " · 익절 " + pxS(mk, o.tpPx) + " · 손절 " + pxS(mk, o.slPx) : "") + '</span></div><div class="r"><span class="sb">현재 ' + pxS(mk, priceOf(o.s)) + '</span></div><button type="button" class="tag2 wbtn" data-cancel="' + esc(o.id) + '">취소</button></div>';
    }).join("") + '<div class="note" style="margin-top:6px">예약 주문·익절·손절은 이 사이트가 열려 있을 때 15초마다 시세를 보고 체결합니다(닫혀 있으면 다시 열 때 확인).</div></section>';
    /* [V33.741] 거래 내역 — 전체·매수·매도 거르기 · 20건 뒤 [더 보기](최대 60건) · 체결 금액 */
    var hl = a.hist.filter(function (t) { return hFlt === "all" || t[1] === hFlt; }), nB = a.hist.filter(function (t) { return t[1] === "B"; }).length;
    h += '<section class="card"><div class="ct" style="margin-bottom:2px"><span class="h2" style="color:inherit">거래 내역 ' + a.hist.length + "건</span>" + (a.hist.length ? '<span class="seg">' + [["all", "전체"], ["B", "매수 " + nB], ["S", "매도 " + (a.hist.length - nB)]].map(function (c) { return '<button type="button" data-hf="' + c[0] + '" class="' + (hFlt === c[0] ? "on" : "") + '">' + c[1] + "</button>"; }).join("") + "</span>" : "") + "</div>" + (hl.length ? hl.slice(0, hMore ? 60 : 20).map(function (t) {
      return '<div class="row" data-open="' + esc(t[2]) + '"><span class="bs ' + (t[1] === "B" ? "b" : "s") + '">' + (t[1] === "B" ? "매수" : "매도") + '</span><div class="l"><span class="nm">' + esc(nm(t[2])) + '</span><span class="sb">' + new Date(t[0]).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " · " + t[3].toLocaleString() + "주 × " + pxS(mk, t[4]) + '</span></div><div class="r"><span class="p">' + fmt(mk, t[3] * t[4]) + "</span></div></div>";
    }).join("") + (hl.length > 20 && !hMore ? '<button type="button" class="b line more" data-hmore="1">더 보기 (' + (hl.length - 20) + "건)</button>" : "") : '<div class="empty">' + (a.hist.length ? "이 조건의 거래가 없습니다" : "아직 거래가 없습니다") + "</div>") + '<div class="note" style="margin-top:6px">체결가 = 그 순간 화면 시세(시간외 포함) · 수수료·세금 없음 · 최근 60건까지 보관 · 모의투자</div></section>';
    return h;
  }
  /* [V33.729] ★내 정보 새 디자인★(사용자 11/2) — 프로필 머리(닉네임·가입일·두 계좌 수익률·관심 수) → 투자 성향(요약 칩 · [바꾸기]로 펼침)
     → 계정(비밀번호 바꾸기·언어·로그아웃) → 모의계좌(시장별 초기화) → 데이터·약관(처리방침·내 데이터 삭제). 설정 앱처럼 줄 단위 목록. */
  var meEdit = false, pwOpen = false;
  var coachQ = "";   // [V33.778] AI 코치 — 고른 질문
  var hSort = "val", hFlt = "all", hMore = false, hxOpen = {}, foldOpen = {};   // [V33.741] 보유 정렬 · 거래 내역 거르기
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
        (pwOpen ? '<form id="mePwForm" class="pwf" novalidate><span class="pwi"><input id="mePw0" type="password" autocomplete="current-password" placeholder="지금 비밀번호" maxlength="64">' + EYE + '</span><span class="pwi"><input id="mePw1" type="password" autocomplete="new-password" placeholder="새 비밀번호(8자 이상)" maxlength="64">' + EYE + '</span><span class="pwi"><input id="mePw2" type="password" autocomplete="new-password" placeholder="새 비밀번호 확인" maxlength="64">' + EYE + '</span><p id="mePwErr" class="err" role="alert"></p><button type="submit" class="b pri">비밀번호 바꾸기</button></form>' : "")
        : li("meLogin", "👤", "로그인 · 회원가입", "")) +
      '<div class="li lang"><span class="ic" aria-hidden="true">🌐</span><span class="lb">언어</span><span class="seg" role="radiogroup" aria-label="언어"><button type="button" role="radio" aria-checked="' + !en + '" data-lang="ko" class="' + (en ? "" : "on") + '">한국어</button><button type="button" role="radio" aria-checked="' + en + '" data-lang="en" class="' + (en ? "on" : "") + '">English</button></span></div>' +
      (isAuth() ? li("meOut", "↩", "로그아웃", "") : "") + "</section>";
    h += '<div class="sec">모의계좌</div><section class="card lst">' + ["us", "kr"].map(function (m) {
      return '<button type="button" class="li" data-reset="' + m + '"><span class="ic" aria-hidden="true">' + (m === "us" ? "$" : "₩") + '</span><span class="lb">' + MK[m] + ' 계좌 처음부터</span><span class="rv">' + (has(m) ? fmt(m, val(m).eq) : "없음") + '</span><span class="ch" aria-hidden="true">›</span></button>'; }).join("") + "</section>";
    /* [V33.734] 알림 · 약관 · 데이터(사용자 11/2 "체결 알림·이용 안내를 MY 내 정보로 · 동의서 · 데이터와 약관 제대로") */
    var pb = document.getElementById("btnPush"), pushOn = !!(pb && /켜짐/.test(pb.textContent || "")), pushOk = ("serviceWorker" in navigator) && ("PushManager" in window) || !!(window.__luxNative && window.__luxNative.on && window.__luxNative.on());
    h += '<div class="sec">알림</div><section class="card lst">' + (pushOk && window.__luxPush ? li("mePush", "🔔", "체결 알림", pushOn ? "켜짐" : "꺼짐") : '<div class="li" style="cursor:default"><span class="ic" aria-hidden="true">🔕</span><span class="lb">체결 알림</span><span class="rv">이 브라우저는 지원하지 않음</span></div>') + "</section>";
    var cs = null; try { cs = JSON.parse(localStorage.getItem("lux-consent") || "null"); } catch (e) {}
    h += '<div class="sec">약관 · 정책</div><section class="card lst">' +
      ['<a class="li" href="/terms"><span class="ic" aria-hidden="true">§</span><span class="lb">이용약관</span><span class="rv">' + TERMS_VER + '</span><span class="ch" aria-hidden="true">›</span></a>',
       '<a class="li" href="/privacy"><span class="ic" aria-hidden="true">🔐</span><span class="lb">개인정보처리방침</span><span class="rv">' + TERMS_VER + '</span><span class="ch" aria-hidden="true">›</span></a>',
       '<a class="li" href="/cookies"><span class="ic" aria-hidden="true">🍪</span><span class="lb">쿠키 · 저장소 정책</span><span class="rv">' + (cs ? "글꼴 " + (cs.fonts ? "허용" : "거부") + " · 진단 " + (cs.perf ? "허용" : "거부") : "선택 전") + '</span><span class="ch" aria-hidden="true">›</span></a>',
       '<a class="li" href="/terms#operator"><span class="ic" aria-hidden="true">ⓘ</span><span class="lb">운영자 정보</span><span class="rv"></span><span class="ch" aria-hidden="true">›</span></a>'].join("") + "</section>";
    h += '<div class="sec">내 데이터</div><section class="card"><div class="kvl">' +
      [["계정", isAuth() ? esc(nick) + " · 비밀번호 확인값만 저장" : "없음(로그인 안 함)"], ["약관 동의", isAuth() ? TERMS_VER + " 판" : "—"], ["투자 성향", prof.done ? "4항목" : "아직 없음"], ["관심종목", prof.watch.length + "개"],
       ["모의계좌", ["us", "kr"].filter(has).map(function (m) { return MK[m] + " 거래 " + prof.pf[m].hist.length + "건"; }).join(" · ") || "없음"], ["보관 장소", "Cloudflare(미국) · 마지막 사용 후 1년 자동 삭제"]].map(function (r) { return "<div><span>" + r[0] + "</span><b>" + r[1] + "</b></div>"; }).join("") +
      '</div></section><section class="card lst">' + (isAuth() ? li("meSync", "☁", "지금 서버에 저장", isDirty() ? "보낼 변경 있음" : sync.ts ? "마지막 " + new Date(sync.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "최신") : "") + li("mineDelete", "🗑", "내 데이터 · 계정 삭제", "", " warn") + "</section>";
    h += '<section class="note" style="padding:2px 6px">· 모의투자 서비스입니다. 가상 자금이며 실제 주문·자금 이동이 없습니다.<br>· 화면의 후보·안내는 투자 권유가 아니며, 수익을 약속하지 않습니다. 투자 판단과 결과의 책임은 본인에게 있습니다.<br>· 저장 항목: 닉네임 · 비밀번호 확인값(비밀번호 자체는 저장하지 않음) · 성향 · 관심종목 · 모의계좌. 마지막 사용 후 1년이 지나면 자동 삭제되며, [내 데이터 · 계정 삭제]로 언제든 지울 수 있습니다.</section>';
    return h;
  }
  /* [V33.725] ★수익률 순위★ — 서버가 1시간에 한 번 계산한 표(/api/leaderboard)를 받는다. 이 기기는 5분에 한 번만 다시 받는다. */
  /* [V33.758] ★순위표는 기기 사본을 먼저 그린다★(사용자 11/4 "순위표 로딩 느리다") — 탭을 열 때마다 '불러오는 중…' 을 보던 것을
     마지막으로 받은 표(lux-lb · 서버도 1시간마다 계산)로 바로 그리고 뒤에서 새로 받는다. 접속 뒤 미리 받기는 아래 boot 에서 1회. */
  var LBK = "lux-lb", LB = null, lbTs = 0, rkMk = "us";
  try { LB = JSON.parse(localStorage.getItem(LBK) || "null"); } catch (e) { LB = null; }
  function lbLoad(force) { if (!force && Date.now() - lbTs < 300000) return; lbTs = Date.now(); fetch("/api/leaderboard").then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok) return; var same = LB && LB.ts === j.ts; LB = j; try { localStorage.setItem(LBK, JSON.stringify(j)); } catch (e) {} var pm = $("page-mine"); if (!same && pm && pm.classList.contains("active")) draw(); }).catch(function () {}); }
  function rankTab() {
    lbLoad(false);
    var rows = (LB && LB[rkMk]) || [], me = prof.nick;
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 12px"><span class="h2">모의투자 수익률 순위</span><span class="seg">' + ["us", "kr"].map(function (m) { return '<button type="button" data-rkmk="' + m + '" class="' + (m === rkMk ? "on" : "") + '">' + MK[m] + "</button>"; }).join("") + "</span></div>";
    var myI = -1; for (var ii = 0; ii < rows.length; ii++) if (me && rows[ii].nick === me) { myI = ii; break; }
    var mv = val(rkMk);
    h += '<section class="card myrk"><div class="l"><span class="sb">내 순위 · ' + MK[rkMk] + '</span><span class="h1" style="font-size:26px">' + (myI >= 0 ? (rows[myI].rk || myI + 1) + "위" : "순위 밖") + '</span><span class="sb">' +
      (myI >= 0 ? (LB && LB.cnt && LB.cnt[rkMk] ? LB.cnt[rkMk] : rows.length) + "명 중" : !mv ? MK[rkMk] + " 모의계좌가 아직 없어요" : "다음 정각 계산에 반영되거나 상위 100 밖이에요") + '</span></div><div class="r"><span class="sb">내 수익률</span><span class="h2 ' + (mv ? cls(mv.ret) : myI >= 0 ? cls(rows[myI].ret) : "mu") + '">' + (mv ? pctS(mv.ret) : myI >= 0 ? pctS(rows[myI].ret) : "—") + "</span></div></section>";
    h += '<section class="card">' + (rows.length ? rows.map(function (r, i) {
      var mine = me && r.nick === me;
      return '<div class="row rkrow' + ((r.rk || i + 1) <= 3 ? " top" + (r.rk || i + 1) : "") + (mine ? " me" : "") + '" style="cursor:default"><span class="rk' + ((r.rk || i + 1) <= 3 ? " hot" : "") + '">' + (r.rk || i + 1) + '</span><div class="l"><span class="nm">' + esc(r.nick) + (mine ? ' <span class="pill">나</span>' : "") + '</span><span class="sb">' + r.days + "일째 · 보유 " + r.n + '종목</span></div><div class="r"><span class="p ' + cls(r.ret) + '">' + pctS(r.ret) + "</span></div></div>";
    }).join("") : '<div class="empty">' + (LB ? "아직 순위에 오른 계좌가 없습니다. 첫 번째가 되어 보세요." : "순위를 불러오는 중…") + "</div>") +
      '<div class="note" style="margin-top:6px">서버가 실제 시세로 1시간마다 다시 계산합니다' + (LB && LB.ts ? " · " + new Date(LB.ts).toLocaleTimeString() + " 기준" : "") + " · 가상 자금 · 투자 권유 아님</div></section>";
    return h;
  }
  /* [V33.725] ★종목 상세의 모의 매매 막대★ — 관심종목에서 종목을 누르면 상세로 가는데 거기서 살 수 없었다(사용자 11/2) */
  var detSym = null;
  function detail(sym) {
    detSym = sym; var pg = $("page-detail"); if (!pg || !sym) return; css();
    var bar = $("mineDetailBar");
    if (!bar) { bar = document.createElement("section"); bar.id = "mineDetailBar"; bar.setAttribute("aria-label", "모의 매매"); var _tb = pg.querySelector("#detailContent .detail-toolbar"); if (_tb) _tb.parentNode.insertBefore(bar, _tb); else pg.insertBefore(bar, pg.firstChild);   /* [V33.749] 가격 머리 바로 아래(차트 도구줄 위) — 종전엔 페이지 맨 위 */
      bar.addEventListener("click", function (ev) { var b = ev.target.closest("button"); if (!b) return; if (!isAuth()) { ask("mine"); return; } if (b.dataset.dbuy) sheet("B", detSym); else if (b.dataset.dsell) sheet("S", detSym); else if (b.dataset.drisk) sheet("R", detSym); else if (b.dataset.dwatch) { var i = prof.watch.indexOf(detSym); if (i >= 0) prof.watch.splice(i, 1); else if (prof.watch.length < 40) prof.watch.push(detSym); persist(); detail(detSym); } }); }
    var hq = held(sym), on = prof.watch.indexOf(sym) >= 0, mk = isKr(sym) ? "kr" : "us", hp = has(mk) ? prof.pf[mk].pos[sym] : null, no = has(mk) ? (prof.pf[mk].ord || []).filter(function (o) { return o.s === sym; }).length : 0;
    bar.innerHTML = '<div class="mdb"><div class="l"><span class="nm">내 모의계좌 · ' + esc(nm(sym)) + '</span><span class="sb">' + (hq ? "보유 " + hq.toLocaleString() + "주" + (hp && hp.tpPx ? " · 익절 " + pxS(mk, hp.tpPx) + " · 손절 " + pxS(mk, hp.slPx) : "") : "보유 없음") + (no ? " · 예약 " + no + "건" : "") + (has(mk) ? " · 주문 가능 " + fmt(mk, prof.pf[mk].cash) : " · 첫 주문 때 가상 " + fmt(mk, START[mk]) + " 계좌가 열립니다") + "</span></div>" +
      '<button type="button" class="wbtn2" data-dwatch="1">' + (on ? "관찰중" : "관찰") + '</button>' + (hq ? '<button type="button" class="wbtn2" data-drisk="1">TP/SL</button><button type="button" class="sell" data-dsell="1">매도</button>' : "") + '<button type="button" class="buy" data-dbuy="1">매수</button></div>';
  }
  function draw() {
    if (detSym && $("page-detail") && $("page-detail").classList.contains("active")) detail(detSym);
    var root = $("mineRoot"), pg = $("page-mine");
    if (!root || !pg || !pg.classList.contains("active")) return;
    css();
    if (!prof.done) tab = "me";
    var T = { home: "홈", watch: "관심", acct: "계좌", rank: "순위", me: "내 정보" };
    var keep = ($("mineSearch") || {}).value || "";
    var html = '<nav class="tabs" aria-label="MY 메뉴">' + Object.keys(T).map(function (k) { return '<button type="button" data-tab="' + k + '" class="' + (k === tab ? "on" : "") + '" aria-current="' + (k === tab ? "page" : "false") + '">' + T[k] + "</button>"; }).join("") + "</nav>" +
      (isAuth() || isDirty() ? '<div class="syncbar">' + syncHtml() + "</div>" : "") +
      (tab === "home" ? home() : tab === "watch" ? watch() : tab === "acct" ? acctTab() : tab === "rank" ? rankTab() : me()) +
      '<p class="note" style="text-align:center;margin-top:10px">모의투자 · 가상 자금 · 투자 권유가 아닙니다' + (pbTs ? " · AI 판정 " + new Date(pbTs).toLocaleTimeString() : "") + "</p>";
    if (root.__h === html) return;   // [V33.741] 1분 갱신 등에서 바뀐 게 없으면 다시 그리지 않음(스크롤·포커스 유지 · 레이아웃 0회)
    root.__h = html; root.innerHTML = html;
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

  /* [V33.730] ★MTS 같은 주문창★(사용자 11/2 "실제 MTS처럼 · 예약 매수 · 코인처럼 TP/SL · 그래프에 보이게")
     · 매수/매도 탭 · 시장가 / 예약(지정가 — 그 가격에 닿으면 체결) · 가격·수량 ± (호가 단위) · 수량 10/25/50/최대
     · 익절가(TP)·손절가(SL) — 매수와 함께 걸어 두면 체결된 보유에 붙는다. 보유 종목은 [익절·손절]로 따로 고친다.
     · 체결은 이 화면이 시세를 보고 한다(앱이 열려 있을 때·다시 열 때) — 서버는 장부 검사로 체결가가 서버 시세 ±3% 안인지 확인한다. */
  function tick(mk, p) { if (mk !== "kr") return p >= 1 ? 0.01 : 0.0001; return p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000; }
  function rt(mk, v) { var t = tick(mk, v); return Math.max(t, Math.round(v / t) * t); }
  function pxS(mk, v) { return v == null || !isFinite(v) ? "—" : mk === "kr" ? "₩" + Math.round(v).toLocaleString() : "$" + v.toFixed(v >= 1 ? 2 : 4); }
  function oid() { return Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
  function sheet(side, sym) {
    var mk = isKr(sym) ? "kr" : "us";
    var a = acct(mk), p = priceOf(sym); if (!p) { alert("지금 시세가 없어 주문할 수 없습니다"); return; }
    var pos = a.pos[sym], hq = pos ? pos.q : 0;
    var shut = !mktOpen(mk, sym);   // [V33.771] 장이 모두 닫혀 있으면 예약만
    var S = { side: side === "R" ? "R" : side, type: shut ? "lim" : "mkt", px: rt(mk, p), qty: 0, frac: 0.25, tpOn: false, tp: rt(mk, p * 1.1), sl: rt(mk, p * 0.95) };
    if (shut && S.side !== "R") S.px = rt(mk, p * (S.side === "B" ? 0.97 : 1.05));
    if (S.side === "R") { S.tpOn = true; if (pos && !pos.tpPx && !pos.slPx) { var sv0 = sellView(mk, sym, pos, p); S.tp = rt(mk, sv0.tp); S.sl = rt(mk, sv0.sl); }   // [V33.770] 처음 걸 때는 AI 매도 의견의 손절·목표로 채워 둔다
      if (pos && pos.tpPx) S.tp = pos.tpPx; if (pos && pos.slPx) S.sl = pos.slPx; }
    var unit = function () { return S.type === "lim" ? S.px : p; };
    var maxQ = function () { return S.side === "B" ? Math.floor(a.cash / unit()) : hq; };
    var setF = function (f) { S.frac = f; S.qty = Math.floor(maxQ() * f); };
    setF(S.side === "S" ? 1 : 0.25);
    var w = document.createElement("div"); w.id = "mineSheet";
    var pct = function (v, base) { return (v >= base ? "+" : "−") + Math.abs((v / base - 1) * 100).toFixed(1) + "%"; };
    var paint = function () {
      var buy = S.side === "B", risk = S.side === "R", col = buy ? "#D42F2F" : risk ? "#0B7A66" : "#2160D8";
      S.qty = Math.max(0, Math.min(S.qty, maxQ()));
      var u = unit(), amt = S.qty * u, base = risk ? (pos ? pos.avg : p) : u, q2 = risk ? hq : S.qty;
      var head = '<div class="shh"><div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:18px;font-weight:700">' + esc(nm(sym)) + '</span><span style="font-size:13px;color:#98A2B3">' + esc(short(sym)) + " · 현재가 <b style=\"color:#EEF1F5\">" + pxS(mk, p) + "</b></span></div>" +
        '<button type="button" class="x" data-close="1" aria-label="닫기">✕</button></div>';
      var h = head;
      if (!risk) {
        h += '<div class="tabs2" role="tablist"><button type="button" role="tab" data-side="B" class="' + (buy ? "on b" : "") + '">매수</button><button type="button" role="tab" data-side="S" class="' + (!buy ? "on s" : "") + '"' + (hq ? "" : " disabled") + ">매도" + (hq ? "" : " (보유 없음)") + "</button></div>" +
          '<div class="typ">' + [["mkt", shut ? "시장가 (장 마감)" : "시장가"], ["lim", "예약 (지정가)"]].map(function (t) { return '<button type="button" data-type="' + t[0] + '" class="' + (S.type === t[0] ? "on" : "") + '"' + (shut && t[0] === "mkt" ? " disabled" : "") + ">" + t[1] + "</button>"; }).join("") + "</div>" +
          (shut ? '<div class="note2">지금은 프리마켓·정규장·애프터마켓이 모두 닫혀 있어 예약 주문만 받습니다 — ' + mktNext(mk) + "에 가격이 닿으면 체결됩니다.</div>" : "");
        if (S.type === "lim") h += '<div class="fld"><span>' + (buy ? "이 가격 이하로 내려오면 매수" : "이 가격 이상으로 오르면 매도") + '</span><div class="stp2"><button type="button" data-pxs="-1" aria-label="가격 내리기">−</button><input id="shPx" inputmode="decimal" aria-label="예약 가격" value="' + (mk === "kr" ? Math.round(S.px) : S.px.toFixed(2)) + '"><button type="button" data-pxs="1" aria-label="가격 올리기">+</button></div><em>현재가 대비 ' + pct(S.px, p) + "</em></div>";
        h += '<div class="fld"><span>수량 <i>' + (buy ? "최대 " + maxQ().toLocaleString() + "주" : "보유 " + hq.toLocaleString() + "주") + '</i></span><div class="stp2"><button type="button" data-qs="-1" aria-label="1주 빼기">−</button><input id="shQ" inputmode="numeric" aria-label="수량" value="' + S.qty + '"><button type="button" data-qs="1" aria-label="1주 더하기">+</button></div></div>' +
          '<div class="pre">' + [0.1, 0.25, 0.5, 1].map(function (f) { return '<button type="button" data-f="' + f + '" class="' + (f === S.frac ? "on" : "") + '">' + (f === 1 ? (buy ? "최대" : "전부") : f * 100 + "%") + "</button>"; }).join("") + "</div>";
      } else {
        h += '<div class="note2">보유 ' + hq.toLocaleString() + "주 · 평단 " + pxS(mk, pos ? pos.avg : p) + " — 현재가가 익절가 이상이면 전부 팔고, 손절가 이하이면 전부 팝니다.</div>";
      }
      if (buy || risk) {
        h += '<div class="tpsl"><div class="tph"><span>익절 · 손절 (TP / SL)</span><button type="button" role="switch" aria-checked="' + S.tpOn + '" aria-label="익절 손절 켜기" class="sw' + (S.tpOn ? " on" : "") + '" data-tpsw="1"><i></i></button></div>' +
          (S.tpOn ? '<div class="tpg"><label class="tp"><span>익절가</span><input id="shTp" inputmode="decimal" value="' + (mk === "kr" ? Math.round(S.tp) : S.tp.toFixed(2)) + '"><em>' + pct(S.tp, base) + " · " + fmt(mk, (S.tp - base) * q2, true) + '</em><span class="qc">' + [5, 10, 20].map(function (x) { return '<button type="button" data-tpp="' + x + '">+' + x + "%</button>"; }).join("") + "</span></label>" +
            '<label class="sl"><span>손절가</span><input id="shSl" inputmode="decimal" value="' + (mk === "kr" ? Math.round(S.sl) : S.sl.toFixed(2)) + '"><em>' + pct(S.sl, base) + " · " + fmt(mk, (S.sl - base) * q2, true) + '</em><span class="qc">' + [3, 5, 10].map(function (x) { return '<button type="button" data-slp="' + x + '">−' + x + "%</button>"; }).join("") + "</span></label></div>" : "") + "</div>";
      }
      if (!risk) h += '<div class="sum"><div><span>' + (S.type === "lim" ? "예약 금액" : "주문 금액") + "</span><b>" + fmt(mk, amt) + '</b></div><div><span>주문 가능</span><span>' + fmt(mk, a.cash) + "</span></div>" + (S.type === "lim" ? '<div><span>체결 조건</span><span>' + pxS(mk, S.px) + (buy ? " 이하" : " 이상") + " 도달 시 · 취소 전까지 유지</span></div>" : "") + "</div>";
      var ok = risk ? hq > 0 : S.qty > 0;
      var cta = risk ? (S.tpOn ? "익절·손절 저장" : "익절·손절 끄기") : !S.qty ? (buy ? "주문 가능 금액이 1주보다 적습니다" : "팔 수량이 없습니다")
        : S.type === "lim" ? pxS(mk, S.px) + " 도달 시 " + S.qty.toLocaleString() + "주 예약 " + (buy ? "매수" : "매도") : S.qty.toLocaleString() + "주 시장가 " + (buy ? "매수" : "매도");
      h += '<button type="button" class="go" ' + (ok ? "" : "disabled") + ">" + cta + '</button><span style="font-size:11px;color:#7E8796;text-align:center">가상 자금 주문 · 실제 증권 주문이 아닙니다</span>';
      w.innerHTML = '<section class="sh" role="dialog" aria-label="모의 주문" style="--c:' + col + '"><div class="grab" aria-hidden="true"></div>' + h + "</section>";
    };
    var num = function (id) { var e = $(id); if (!e) return null; var v = Number(String(e.value).replace(/[^0-9.]/g, "")); return isFinite(v) && v > 0 ? v : null; };
    w.addEventListener("change", function (ev) {
      var id = ev.target.id;
      if (id === "shPx") { var v = num("shPx"); if (v) S.px = rt(mk, v); }
      else if (id === "shQ") { var q2 = num("shQ"); S.qty = q2 ? Math.floor(q2) : 0; S.frac = -1; }
      else if (id === "shTp") { var t = num("shTp"); if (t) S.tp = rt(mk, t); }
      else if (id === "shSl") { var s2 = num("shSl"); if (s2) S.sl = rt(mk, s2); }
      paint();
    });
    w.addEventListener("click", function (ev) {
      if (ev.target === w) { w.remove(); return; }
      var b = ev.target.closest("button"); if (!b) return; var d = b.dataset;
      if (d.close) { w.remove(); return; }
      if (d.side) { S.side = d.side; setF(S.side === "S" ? 1 : 0.25); }
      else if (d.type) { if (shut && d.type === "mkt") return; S.type = d.type; if (S.type === "lim") S.px = rt(mk, p * (S.side === "B" ? 0.97 : 1.05)); S.tp = rt(mk, unit() * 1.1); S.sl = rt(mk, unit() * 0.95); setF(S.frac > 0 ? S.frac : 0.25); }
      else if (d.pxs) { S.px = rt(mk, S.px + Number(d.pxs) * tick(mk, S.px)); }
      else if (d.qs) { S.qty += Number(d.qs); S.frac = -1; }
      else if (d.f) { setF(Number(d.f)); }
      else if (d.tpsw) { S.tpOn = !S.tpOn; }
      else if (d.tpp) { S.tp = rt(mk, (S.side === "R" && pos ? pos.avg : unit()) * (1 + Number(d.tpp) / 100)); }
      else if (d.slp) { S.sl = rt(mk, (S.side === "R" && pos ? pos.avg : unit()) * (1 - Number(d.slp) / 100)); }
      else if (b.classList.contains("go")) {
        var cur = priceOf(sym) || p, err = null, msg = "";
        if (S.tpOn && !(S.tp > S.sl)) { alert("익절가는 손절가보다 높아야 합니다"); return; }
        if (S.side === "R") {
          if (!a.pos[sym]) { alert("보유하지 않은 종목입니다"); return; }
          if (S.tpOn) { if (S.tp <= cur || S.sl >= cur) { alert("익절가는 현재가보다 높게, 손절가는 현재가보다 낮게 정해 주세요"); return; } a.pos[sym].tpPx = S.tp; a.pos[sym].slPx = S.sl; msg = "익절·손절을 걸었어요"; }
          else { delete a.pos[sym].tpPx; delete a.pos[sym].slPx; msg = "익절·손절을 껐어요"; }
          persist();
        } else if (S.type === "lim" && (shut || (S.side === "B" ? S.px < cur : S.px > cur))) {   // [V33.771] 닫혀 있으면 이미 닿은 가격도 예약으로(열리면 체결)
          if (!a.ord) a.ord = []; if (a.ord.length >= 20) { alert("예약 주문은 시장당 20건까지입니다"); return; }
          var o = { id: oid(), side: S.side, s: sym, px: S.px, q: S.qty, t: Date.now() };
          if (S.side === "B" && S.tpOn) { o.tpPx = S.tp; o.slPx = S.sl; }
          a.ord.unshift(o); persist(); msg = "예약 주문을 걸었어요 · " + pxS(mk, S.px) + (S.side === "B" ? " 이하" : " 이상") + "이면 체결";
        } else {
          if (S.side === "B" && S.tpOn && (S.tp <= cur || S.sl >= cur)) { alert("익절가는 현재가보다 높게, 손절가는 현재가보다 낮게 정해 주세요"); return; }
          err = trade(S.side, sym, S.qty); if (err) { alert(err); return; }
          if (S.side === "B" && S.tpOn && a.pos[sym]) { a.pos[sym].tpPx = S.tp; a.pos[sym].slPx = S.sl; persist(); }
          msg = S.qty.toLocaleString() + "주 " + (S.side === "B" ? "매수" : "매도") + " 체결 · " + pxS(mk, cur);
        }
        w.remove(); toast(msg); acMk = mk; if ($("page-mine") && $("page-mine").classList.contains("active")) tab = "acct"; draw(); if (detSym === sym) detail(sym); redrawChart(sym);
        return;
      } else return;
      paint();
    });
    paint(); document.body.appendChild(w);
  }
  // ── [V33.730] 예약 주문·익절·손절 실행기 — 화면이 열려 있는 동안 15초마다 시세를 보고 체결(서버 비용 0 · 체결 때만 저장 1회) ──
  /* [V33.748] ★종목 간단히 보기★(사용자 11/4 "증권사 MTS 처럼 — 누르면 바로 상세로 가지 말고 가격·일봉을 간단히, [자세히 보기] 로 상세") —
     관심·보유·AI 추천·거래 내역 줄을 누르면 아래에서 올라온다. 차트는 대시보드가 이미 받은 23일 종가로 ★바로★ 그리고, 일봉(3개월)은 한 번만 받아 기기 메모리에 둔다
     (서버 /api/chart 는 5분 엣지 캐시 — 사람 수만큼 서버 일이 늘지 않는다). */
  var pvCache = {}, pvSym = null, pvRange = "3mo";
  function pvClose() { var w = $("minePv"); if (w) w.remove(); pvSym = null; }
  function pvChart(sym) {
    var c = pvCache[sym + "|" + pvRange], W = 600, H = 210, P = 6;
    if (c && c.length > 1) {
      var lo = Infinity, hi = -Infinity; c.forEach(function (k) { if (k.l < lo) lo = k.l; if (k.h > hi) hi = k.h; });
      var sx = (W - P * 2) / c.length, y = function (v) { return P + (hi - v) / ((hi - lo) || 1) * (H - P * 2); }, g = "";
      c.forEach(function (k, i) { var x = P + i * sx + sx / 2, up = k.c >= k.o, col = up ? "var(--m-up)" : "var(--m-dn)", bw = Math.max(1.5, sx * 0.62);
        g += '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + y(k.h).toFixed(1) + '" y2="' + y(k.l).toFixed(1) + '" stroke="' + col + '" stroke-width="1"/>' +
             '<rect x="' + (x - bw / 2).toFixed(1) + '" y="' + Math.min(y(k.o), y(k.c)).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, Math.abs(y(k.o) - y(k.c))).toFixed(1) + '" fill="' + col + '"/>'; });
      var ma = ""; for (var i = 19; i < c.length; i++) { var sm = 0; for (var j = i - 19; j <= i; j++) sm += c[j].c; ma += (ma ? "L" : "M") + (P + i * sx + sx / 2).toFixed(1) + " " + y(sm / 20).toFixed(1); }
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-label="일봉 차트">' + g + (ma ? '<path d="' + ma + '" fill="none" stroke="#E2C766" stroke-width="1.6" opacity=".9"/>' : "") + '</svg><div class="pvax"><span>' + pxS(isKr(sym) ? "kr" : "us", hi) + '</span><span>' + pxS(isKr(sym) ? "kr" : "us", lo) + "</span></div>";
    }
    var x = q(sym), sp = x && Array.isArray(x.spark) ? x.spark.filter(function (v) { return v > 0; }) : [];
    if (sp.length > 1) {   // 받기 전: 대시보드가 가진 23일 종가 선
      var lo2 = Math.min.apply(null, sp), hi2 = Math.max.apply(null, sp), d = "";
      sp.forEach(function (v, i) { d += (i ? "L" : "M") + (P + i * (W - P * 2) / (sp.length - 1)).toFixed(1) + " " + (P + (hi2 - v) / ((hi2 - lo2) || 1) * (H - P * 2)).toFixed(1); });
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + (sp[sp.length - 1] >= sp[0] ? "var(--m-up)" : "var(--m-dn)") + '" stroke-width="2.4"/></svg>';
    }
    return '<div class="pvload">차트 불러오는 중…</div>';
  }
  function pvPaint() {
    var w = $("minePv"), sym = pvSym; if (!w || !sym) return;
    var mk = isKr(sym) ? "kr" : "us", x = q(sym), p = priceOf(sym), c = dayPct(sym), sig = sigOf(sym), r = ranked(mk).filter(function (z) { return z.s === sym; })[0];
    var hp = has(mk) ? prof.pf[mk].pos[sym] : null, on = prof.watch.indexOf(sym) >= 0;
    var st = function (lb, v) { return '<div><span>' + lb + "</span><b>" + v + "</b></div>"; };
    var prev = x && x.prevClose > 0 ? x.prevClose : null;
    w.querySelector(".pvb").innerHTML =
      '<div class="grab"></div><div class="pvh"><div class="l"><span class="nm">' + esc(nm(sym)) + pill(sig) + '</span><span class="sb">' + esc(short(sym)) + " · " + MK[mk] + (x && x.mstate && x.mstate !== "REGULAR" ? " · " + (x.mstate === "PRE" ? "프리마켓" : x.mstate === "CLOSED" ? "장 마감" : "시간외") : "") + '</span></div><button type="button" class="x" data-pvx="1" aria-label="닫기">✕</button></div>' +
      '<div class="pvp"><span class="h1">' + pxS(mk, p) + '</span><span class="' + cls(c) + '">' + (prev && p ? fmt(mk, p - prev, true) + " " : "") + "(" + pctS(c) + ")</span></div>" +
      '<div class="pvc">' + pvChart(sym) + '</div><div class="seg pvr" role="tablist">' + [["1mo", "1개월"], ["3mo", "3개월"], ["6mo", "6개월"], ["1y", "1년"]].map(function (o) { return '<button type="button" data-pvr="' + o[0] + '" class="' + (pvRange === o[0] ? "on" : "") + '">' + o[1] + "</button>"; }).join("") + "</div>" +
      '<div class="pvs">' + st("전일 종가", pxS(mk, prev)) + st("RSI", x && x.rsi ? Math.round(x.rsi) : "—") + st("20일", x && typeof x.return20 === "number" ? '<i class="' + cls(x.return20) + '">' + pctS(x.return20) + "</i>" : "—") + st("1년", x && typeof x.ret1y === "number" ? '<i class="' + cls(x.ret1y) + '">' + pctS(x.ret1y) + "</i>" : "—") + "</div>" +
      (r ? '<div class="pvai"><b>AI</b> ' + esc(rankSub(r)) + "</div>" : "") +
      (hp ? '<div class="pvhd">보유 ' + hp.q.toLocaleString() + "주 · 평단 " + pxS(mk, hp.avg) + ' · <b class="' + cls(p - hp.avg) + '">' + fmt(mk, (p - hp.avg) * hp.q, true) + " (" + pctS((p / hp.avg - 1) * 100) + ")</b></div>" : "") +
      '<div class="pva"><button type="button" class="wbtn2' + (on ? " on" : "") + '" data-pvw="1">' + (on ? "관찰중" : "관찰") + '</button><button type="button" class="buy" data-pvbuy="1">매수</button>' + (hp ? '<button type="button" class="sell" data-pvsell="1">매도</button>' : "") + "</div>" +
      '<button type="button" class="pvgo" data-pvgo="1">자세히 보기 <span aria-hidden="true">›</span></button>';
  }
  function pvFetch(sym) {
    var key = sym + "|" + pvRange; if (key in pvCache) return;   // 받는 중(null)이면 또 받지 않음
    pvCache[key] = null;
    fetch("/api/chart?symbol=" + encodeURIComponent(sym) + "&range=" + pvRange + "&interval=1d").then(function (r) { return r.json(); }).then(function (j) {
      var cs = (j && j.candles || []).filter(function (k) { return k && k.c > 0 && k.h > 0 && k.l > 0 && k.o > 0; });
      if (cs.length) { pvCache[key] = cs; if (pvSym === sym) pvPaint(); } else delete pvCache[key];
    }).catch(function () { delete pvCache[key]; });
  }
  function preview(sym) {
    css(); pvClose(); pvSym = sym;
    var w = document.createElement("div"); w.id = "minePv"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", nm(sym) + " 간단히 보기");
    w.innerHTML = '<div class="pvb"></div>'; document.body.appendChild(w); pvPaint(); pvFetch(sym);
    requestAnimationFrame(function () { w.classList.add("on"); });
    w.addEventListener("click", function (ev) {
      if (ev.target === w) { pvClose(); return; }
      var b = ev.target.closest("button"); if (!b) return; var d = b.dataset, s0 = pvSym;
      if (d.pvx) pvClose();
      else if (d.pvr) { pvRange = d.pvr; pvPaint(); pvFetch(s0); }
      else if (d.pvw) { var i = prof.watch.indexOf(s0); if (i >= 0) prof.watch.splice(i, 1); else if (prof.watch.length < 40) prof.watch.push(s0); persist(); pvPaint(); draw(); }
      else if (d.pvbuy) { pvClose(); sheet("B", s0); }
      else if (d.pvsell) { pvClose(); sheet("S", s0); }
      else if (d.pvgo) { pvClose(); if (typeof window.openDetailFromSym === "function") window.openDetailFromSym(s0); }
    });
  }
  function toast(t) {
    if (!t) return; var e = document.createElement("div"); e.className = "luxToast"; e.setAttribute("role", "status"); e.textContent = t;
    document.body.appendChild(e); setTimeout(function () { e.classList.add("on"); }, 10); setTimeout(function () { e.remove(); }, 4200);
  }
  function redrawChart(sym) { try { if (typeof window.__luxDetailRedraw === "function" && detSym === sym) window.__luxDetailRedraw(); } catch (e) {} }
  function runOrders() {
    if (!prof.pf) return; var changed = [];
    ["us", "kr"].forEach(function (mk) {
      var a = prof.pf[mk]; if (!a) return;
      if (!mktOpen(mk)) return;   // [V33.771] 장이 모두 닫혀 있으면 예약·익절·손절을 체결하지 않는다(묵은 시세로 체결 방지)
      (a.ord || []).slice().forEach(function (o) {
        if (!mktOpen(mk, o.s)) return;
        var p = priceOf(o.s); if (!p) return;
        var hit = o.side === "B" ? p <= o.px : p >= o.px; if (!hit) return;
        a.ord = a.ord.filter(function (x) { return x.id !== o.id; });
        if (o.side === "S" && !(a.pos[o.s] && a.pos[o.s].q > 0)) { changed.push("예약 매도 취소(보유 없음) · " + nm(o.s)); return; }
        var q = o.side === "B" ? Math.min(o.q, Math.floor(a.cash / p)) : o.q;
        if (!(q > 0)) { changed.push("예약 매수 취소(주문 가능 금액 부족) · " + nm(o.s)); return; }
        if (trade(o.side, o.s, q)) return;
        if (o.side === "B" && o.tpPx && a.pos[o.s]) { a.pos[o.s].tpPx = o.tpPx; a.pos[o.s].slPx = o.slPx; }
        changed.push("예약 " + (o.side === "B" ? "매수" : "매도") + " 체결 · " + nm(o.s) + " " + q.toLocaleString() + "주 @ " + pxS(mk, p));
      });
      Object.keys(a.pos).forEach(function (s) {
        var h = a.pos[s], p = priceOf(s); if (!p || !(h.tpPx || h.slPx) || !mktOpen(mk, s)) return;
        var why = h.tpPx && p >= h.tpPx ? "익절" : h.slPx && p <= h.slPx ? "손절" : null; if (!why) return;
        var q = h.q; if (trade("S", s, q)) return;
        changed.push(why + " 체결 · " + nm(s) + " " + q.toLocaleString() + "주 @ " + pxS(mk, p));
      });
    });
    if (changed.length) { persist(); changed.forEach(function (m, i) { setTimeout(function () { toast(m); }, i * 900); }); draw(); if (detSym) { detail(detSym); redrawChart(detSym); } }
  }
  /* 차트에 그릴 선 — 익절(빨강)·손절(파랑)·예약 주문(검정/흰)·평단(회색) */
  function lines(sym) {
    var mk = isKr(sym) ? "kr" : "us", a = prof.pf && prof.pf[mk], out = []; if (!a) return out;
    var h = a.pos[sym];
    if (h) { out.push({ p: h.avg, label: "평단 " + pxS(mk, h.avg), c: "#8C95A8", dash: "2 4" });
      if (h.tpPx) out.push({ p: h.tpPx, label: "익절 " + pxS(mk, h.tpPx), c: "#F04452" }); if (h.slPx) out.push({ p: h.slPx, label: "손절 " + pxS(mk, h.slPx), c: "#3182F6" }); }
    (a.ord || []).forEach(function (o) { if (o.s !== sym) return; out.push({ p: o.px, label: "예약 " + (o.side === "B" ? "매수" : "매도") + " " + pxS(mk, o.px) + " · " + o.q + "주", c: o.side === "B" ? "#B5179E" : "#7048E8" });
      if (o.tpPx) out.push({ p: o.tpPx, label: "익절(예약) " + pxS(mk, o.tpPx), c: "#F04452", dash: "3 5" }); if (o.slPx) out.push({ p: o.slPx, label: "손절(예약) " + pxS(mk, o.slPx), c: "#3182F6", dash: "3 5" }); });
    return out;
  }

  // ── [V33.729] 로그인 = 닉네임 + 비밀번호 ──
  // 로그인 상태는 이 브라우저에 닉네임(lux-auth)으로 기억한다. 서버 계정은 이 기기 코드(uid)를 비밀번호로 잠가 두고, 로그인하면 그 코드를 돌려준다.
  function isAuth() { try { return !!localStorage.getItem("lux-auth"); } catch (e) { return false; } }
  function authNick() { try { return localStorage.getItem("lux-auth") || ""; } catch (e) { return ""; } }
  function authSince() { try { return Number(localStorage.getItem("lux-auth-ts")) || 0; } catch (e) { return 0; } }
  function remember(nick, since) { try { localStorage.setItem("lux-auth", nick); if (since) localStorage.setItem("lux-auth-ts", String(since)); localStorage.removeItem("lux-pk"); localStorage.removeItem("lux-gate"); } catch (e) {} try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {} }
  function authPost(path, body) { return fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-lux-uid": uid() }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
  function signup(nick, pw) {
    acct("us"); acct("kr"); saveLocal();   // [V33.757] 가입과 함께 두 시장 모의계좌(시작금 $10,000 · ₩10,000,000)
    return api("POST", Object.assign({}, prof)).catch(function () {}).then(function () { return authPost("/api/auth/signup", { nick: nick, pw: pw, agree: TERMS_VER }); }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || "가입하지 못했어요");
      remember(j.nick, j.created); prof.nick = j.nick; saveLocal(); try { var rf = localStorage.getItem("lux-ref"); if (rf) fetch("/api/ref", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ r: rf, ev: "s" }), keepalive: true }).catch(function () {}); } catch (e) {} return j;
    });
  }
  function login(nick, pw) {
    return authPost("/api/auth/login", { nick: nick, pw: pw }).then(function (j) {
      if (!j || !j.ok || !j.uid) throw new Error((j && j.error) || "로그인하지 못했어요");
      clearTimeout(saveT); clearTimeout(retryT); saveT = retryT = 0; try { localStorage.setItem(UIDK, j.uid); localStorage.removeItem(PROFK); } catch (e) {} dirty(false); sync = { st: "", ts: 0, fail: 0 }; synced = false; resetQ = [];   // [V33.741] 로그인 전 예약된 저장이 새 계정 데이터를 덮지 않게
      prof = Object.assign({}, DEF, { nick: j.nick, done: true }); remember(j.nick, j.created); loaded = false; load(true); tab = "home"; return j;
    });
  }
  function logout(silent) {
    if (!silent && !confirm("로그아웃할까요? 다시 쓰려면 닉네임과 비밀번호로 로그인하면 됩니다.")) return;
    if (!silent && isDirty()) push();   // [V33.741] 나가기 전 남은 변경을 이 계정에 보냄(새 코드로 바꾸기 전에 보낸다)
    clearTimeout(saveT); clearTimeout(retryT); saveT = retryT = 0;
    try { localStorage.removeItem("lux-auth"); localStorage.removeItem("lux-auth-ts"); localStorage.removeItem(PROFK); localStorage.setItem(UIDK, newUid()); } catch (e) {} dirty(false); sync = { st: "", ts: 0, fail: 0 }; synced = false; resetQ = [];
    prof = Object.assign({}, DEF); loaded = false; tab = "home";
    if (typeof window.showPage === "function") window.showPage("dashboard");
  }
  /* [V33.729] ★로그인 창★ — 대시보드·종목 상세 밖 메뉴로 갈 때 뜬다(V33.727 흐름 그대로). 탭 둘: 로그인 / 회원가입. 오류는 창 안에 글로(팝업 없음). */
  var PGN = { mine: "MY(내 투자)", positions: "포지션", macro: "뉴스·환율", nnviz: "AI 작동원리 보기", trades: "거래 기록", report: "AI 리포트", whatif: "WHAT-IF" };
  function ask(target, mode) {
    if ($("luxGate")) return;
    css();
    var m = mode || (authNick() || prof.nick ? "login" : "signup"), busy = false;
    var w = document.createElement("div"); w.id = "luxGate"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "LUX-INV 로그인");
    var intro = m === "signup";   // [V33.796] 가입 창 앞 소개 한 장(사용자 11/9 "회원가입 표시 띄우기 전에 저런 거")
    var paint = function () {
      var su = m === "signup";
      if (su && intro) {
        var app = !!(window.__luxInstall && !(window.__luxIsApp && window.__luxIsApp()));
        w.innerHTML = '<div class="in itr"><div class="hd"><b class="itb">LUX-INV</b><button type="button" class="x" id="gClose" aria-label="닫기">✕</button></div>' +
          '<h1>주식이 어려워?<br>AI가 대신 보고 설명해 줌</h1><p class="lead">고등학생이 만든 AI 모의투자 · 진짜 돈 아님 · 무료</p>' +
          '<ul class="itl"><li><b>종목 누르면 AI가 말로 설명</b><span>지금 흐름 · 넘어야 할 가격 · 시나리오</span></li>' +
          '<li><b>AI 매매를 실시간으로 공개</b><span>AI가 뭘 왜 샀는지 그대로 보임</span></li>' +
          '<li><b>시작금 $10,000 · ₩1,000만</b><span>한국·미국 모의계좌 바로 생김</span></li>' +
          '<li><b>실시간 수익률 순위</b><span>친구랑 바로 비교</span></li></ul>' +
          '<button type="button" class="p1" id="gStart">10초 만에 시작하기</button>' +
          '<button type="button" class="p3" data-m="login">이미 계정 있음 · 로그인</button>' +
          (app ? '<button type="button" class="p3" id="gApp">⇩ 홈 화면에 앱으로 설치</button>' : '') +
          '<button type="button" class="p3" id="gGuest">나중에 · 대시보드 구경하기</button>' +
          '<p class="fine">이메일·전화번호 안 받음 · 닉네임 + 비밀번호만</p></div>';
        return;
      }
      w.innerHTML = '<div class="in"><div class="hd"><div class="lg"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3DD6B5" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19"></path></svg></div>' +
        '<button type="button" class="x" id="gClose" aria-label="닫기">✕</button></div>' +
        "<h1>" + (su ? "닉네임 + 비밀번호면 끝<br>10초 만에 시작하세요" : "다시 오셨네요") + '</h1><p class="lead">' + esc(PGN[target] || "이 메뉴") + "는 로그인 후 쓸 수 있어요. 대시보드와 종목 상세는 로그인 없이 볼 수 있습니다.</p>" +
        '<div class="sw" role="tablist"><button type="button" role="tab" data-m="login" class="' + (su ? "" : "on") + '" aria-selected="' + !su + '">로그인</button><button type="button" role="tab" data-m="signup" class="' + (su ? "on" : "") + '" aria-selected="' + su + '">회원가입</button></div>' +
        '<form id="gForm" novalidate><label class="f"><span>닉네임</span><input id="gNick" autocomplete="username" maxlength="12" placeholder="2~12자 한글·영문·숫자" value="' + esc(authNick() || prof.nick || "") + '"></label>' +
        '<label class="f"><span>비밀번호</span><span class="pwi"><input id="gPw" type="password" autocomplete="' + (su ? "new-password" : "current-password") + '" maxlength="64" placeholder="' + (su ? "8자 이상" : "비밀번호") + '">' + EYE + '</span></label>' +
        (su ? '<label class="ag one"><input type="checkbox" class="gReq" id="gAgree"><span>[필수] 만 14세 이상이며 <a href="/terms" target="_blank" rel="noopener">이용약관</a> · <a href="/privacy" target="_blank" rel="noopener">개인정보 수집·이용</a>에 동의합니다 (모의투자 · 투자 권유 아님)</span></label>' +
              '<details class="agd"><summary>수집 항목 보기</summary><div class="agt" role="note"><b>수집 항목</b> 닉네임 · 비밀번호 확인값(비밀번호 자체는 저장 안 함) · 성향·관심종목·모의계좌<br><b>목적</b> 로그인 · 모의투자 · 순위 표시<br><b>보유 기간</b> 마지막 사용 후 1년 또는 탈퇴 즉시 삭제 · 동의를 거부할 수 있으나 거부하면 가입할 수 없습니다</div></details>' : "") +
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
      if (b.id === "gStart") { intro = false; paint(); return; }
      if (b.id === "gApp") { if (window.__luxInstall) window.__luxInstall(); return; }
      if (b.dataset.m) { m = b.dataset.m; intro = false; paint(); return; }
      if (b.id === "gClose" || b.id === "gGuest") done(false);
    });
    w.addEventListener("change", function (ev) {   // [V33.734] 전체 동의 ↔ 개별 필수 항목
      var t = ev.target; if (t.id === "gAll") w.querySelectorAll(".gReq").forEach(function (x) { x.checked = t.checked; });
      else if (t.classList && t.classList.contains("gReq")) { var all = $("gAll"); if (all) all.checked = Array.prototype.every.call(w.querySelectorAll(".gReq"), function (x) { return x.checked; }); }
    });
    w.addEventListener("submit", function (ev) {
      ev.preventDefault(); if (busy) return;
      var nick = ($("gNick").value || "").trim(), pw = $("gPw").value || "";
      if (!/^[가-힣A-Za-z0-9_]{2,12}$/.test(nick)) { err("닉네임은 2~12자 한글·영문·숫자·_ 만 쓸 수 있어요"); return; }
      if (m === "signup") {
        if (pw.length < 8) { err("비밀번호는 8자 이상으로 정해 주세요"); return; }
        if (!$("gAgree").checked) { err("필수 동의에 체크해 주세요"); return; }
      } else if (!pw) { err("비밀번호를 넣어 주세요"); return; }
      busy = true; err(""); var g = $("gGo"); g.disabled = true; g.textContent = m === "signup" ? "가입하는 중…" : "로그인하는 중…";
      (m === "signup" ? signup(nick, pw) : login(nick, pw)).then(function () { if (m === "signup") tab = "home"; done(true); })
        .catch(function (e) { busy = false; g.disabled = false; g.textContent = m === "signup" ? "가입하고 시작하기" : "로그인"; err(String(e && e.message || e)); });
    });
    paint(); document.body.appendChild(w);
  }

  function onClick(ev) {
    if (ev.target.closest("details.olx,details.adv-h")) return;   // [V33.778] AI 전망 펼치기는 종목 열기와 따로
    var t = ev.target.closest("button,[data-open]"); if (!t || !$("mineRoot").contains(t)) return;
    var d = t.dataset;
    if (d.tab) { tab = d.tab; draw(); return; }
    if (d.hx) { ev.stopPropagation(); hxOpen[d.hx] = !hxOpen[d.hx]; draw(); return; }   // 보유 종목 상세 접기/펴기(이 화면에서만 기억)
    if (d.fold) { ev.stopPropagation(); foldOpen[d.fold] = !foldOpen[d.fold]; draw(); return; }   // 보조 카드(AI 코치·계좌 진단·AI 포트폴리오) 접기/펴기
    if (d.coach) { coachQ = coachQ === d.coach ? "" : d.coach; draw(); return; }   // [V33.778] AI 코치 칩
    if (d.buy) { ev.stopPropagation(); sheet("B", d.buy); return; }
    if (d.sell) { ev.stopPropagation(); sheet("S", d.sell); return; }
    if (d.risk) { ev.stopPropagation(); sheet("R", d.risk); return; }
    if (d.cancel) { ev.stopPropagation(); ["us", "kr"].forEach(function (m) { var aa = prof.pf && prof.pf[m]; if (aa && aa.ord) aa.ord = aa.ord.filter(function (o) { return o.id !== d.cancel; }); }); persist(); draw(); toast("예약 주문을 취소했어요"); if (detSym) redrawChart(detSym); return; }
    if (d.openAcct) { acct(d.openAcct); persist(); acMk = d.openAcct; tab = "acct"; draw(); return; }
    if (d.acmk) { acMk = d.acmk; draw(); return; }
    if (d.wf) { wFilter = d.wf; draw(); return; }
    if (d.hs) { ev.stopPropagation(); hSort = d.hs; draw(); return; }
    if (d.hf) { ev.stopPropagation(); hFlt = d.hf; hMore = false; draw(); return; }
    if (d.hmore) { ev.stopPropagation(); hMore = true; draw(); return; }
    if (t.id === "meSync") { push(); return; }
    if (d.rkmk) { rkMk = d.rkmk; draw(); return; }
    if (d.addwatch) { ev.stopPropagation(); var i = prof.watch.indexOf(d.addwatch); if (i >= 0) prof.watch.splice(i, 1); else if (prof.watch.length < 40) prof.watch.push(d.addwatch); persist(); draw(); return; }
    if (d.unwatch) { ev.stopPropagation(); prof.watch = prof.watch.filter(function (x) { return x !== d.unwatch; }); persist(); draw(); return; }
    if (d.reset) { if (confirm(MK[d.reset] + " 모의계좌를 처음 상태로 되돌릴까요?")) { if (prof.pf) delete prof.pf[d.reset]; if (resetQ.indexOf(d.reset) < 0) resetQ.push(d.reset); persist(); draw(); } return; }
    if (d.v) { var g = t.closest("[data-k]"); if (!g) return; var k = g.getAttribute("data-k");
      if (k === "mkts") { var j = prof.mkts.indexOf(d.v); if (j >= 0 && prof.mkts.length > 1) prof.mkts.splice(j, 1); else if (j < 0) prof.mkts.push(d.v); } else prof[k] = d.v;
      if (prof.done) persist(); draw(); return; }
    if (t.id === "mineDone") { prof.done = true; persist(); tab = "home"; pbLoad(true); draw(); return; }
    if (t.id === "meEdit") { meEdit = true; draw(); return; }
    if (t.id === "meEditDone") { meEdit = false; draw(); return; }
    if (t.id === "mePw") { pwOpen = !pwOpen; draw(); if (pwOpen && $("mePw0")) $("mePw0").focus(); return; }
    if (t.id === "meLogin") { ask("mine", "login"); return; }
    if (t.id === "meOut") { logout(false); return; }
    if (t.id === "mePush") { if (window.__luxPush) Promise.resolve(window.__luxPush()).then(function () { setTimeout(draw, 800); }); return; }
    if (d.lang) { var curL = window.luxLang && window.luxLang.get ? window.luxLang.get() : "ko"; if (d.lang !== curL && window.luxLang) window.luxLang.set(d.lang); return; }   // [V33.732] 고른 언어로만 · 지금 언어를 누르면 아무 일 없음
    if (t.id === "mineDelete") {
      if (!confirm("서버에 저장된 내 계정(닉네임)·성향·관심종목·모의계좌를 모두 지웁니다. 되돌릴 수 없어요. 지울까요?")) return;
      api("DELETE").then(function () { alert("삭제했습니다."); logout(true); }).catch(function () { alert("삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요."); });
      return; }
    if (d.open) { preview(d.open); return; }   // [V33.748] 바로 상세로 가지 않고 간단히 보기 → [자세히 보기]
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
    if (isAuth() || isDirty()) setTimeout(function () { load(false); }, 2500);
    if (isAuth()) setTimeout(function () { if (!document.hidden) { pbLoad(false); lbLoad(false); } }, 4000);   // [V33.758] 순위표도 미리   // [V33.748] MY 를 열기 전에 AI 판정을 미리 받아 둔다(로그인한 사람만 · 접속당 1회 · 엣지 캐시 30초)   // [V33.741] 로그인한 사람은 MY 를 안 열어도 한 번 맞춰 둔다 — 종목 상세에서 산 것이 다른 기기의 새 기록을 옛 사본으로 덮지 않게(세션당 GET 1회)
    setInterval(function () { if (!document.hidden && pg.classList.contains("active")) { pbLoad(false); var ae = document.activeElement; if (!$("mineSheet") && !(ae && (ae.id === "mineSearch" || /^mePw/.test(ae.id || "")))) draw(); } }, 60000);
  }
  /* [V33.734] ★첫 방문 동의 배너★ — 쿠키는 쓰지 않음 · 필수 저장소만 · 선택 2개(외부 글꼴 · 성능 진단). 고르기 전엔 선택 항목을 하지 않는다. */
  function consentBanner() {
    var c = null; try { c = JSON.parse(localStorage.getItem("lux-consent") || "null"); } catch (e) {}
    if (c || $("luxConsent")) return; css();
    var w = document.createElement("section"); w.id = "luxConsent"; w.setAttribute("role", "region"); w.setAttribute("aria-label", "쿠키 · 저장소 동의");
    w.innerHTML = '<p><b>쿠키를 쓰지 않습니다.</b> 로그인·설정 유지에 꼭 필요한 값만 이 기기에 저장합니다. 선택: 외부 글꼴(Google 에 접속 정보 전달) · 익명 화면 성능 진단. <a href="/cookies">자세히</a></p>' +
      '<div class="cb"><button type="button" data-cs="min">필수만</button><button type="button" data-cs="all" class="pri">모두 허용</button></div>';
    w.addEventListener("click", function (ev) { var b = ev.target.closest("button[data-cs]"); if (!b) return; var all = b.dataset.cs === "all";
      try { localStorage.setItem("lux-consent", JSON.stringify({ v: TERMS_VER, fonts: all, perf: all, ts: Date.now() })); } catch (e) {}
      if (all) { try { var l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Pinyon+Script&family=UnifrakturCook:wght@700&display=swap"; document.head.appendChild(l); } catch (e) {} }
      w.remove(); draw(); });
    document.body.appendChild(w);
  }
  setTimeout(consentBanner, 1200);
  setInterval(function () { if (!document.hidden) runOrders(); }, 15000);
  setTimeout(runOrders, 4000);
  window.luxMine = { draw: draw, detail: detail, ask: ask, lines: lines };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
