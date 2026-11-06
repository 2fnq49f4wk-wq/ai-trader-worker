/* [V33.783] ★LUX-Mini 화면 조각★ — 종목 상세(개요 탭) · MY 보유 카드에 '단기·중기·장기' 칩 + 펼치면 근거 3줄.
   · 모델은 public/luxmini.js(브라우저 계산 · 서버 CPU·요청 0). 가중치 /luxmini.json 은 처음 필요할 때 한 번만 받는다.
   · 시장 맥락(ctx)은 받은 상태(window.__lastState) 객체가 바뀔 때만 시장별로 다시 센다(종목마다 세지 않는다).
   · 표시 원칙(학습 보고서 · 홀드아웃): 확률은 거의 동전(AUC 0.51~0.53)이라 숫자 확률 대신 '그날 같은 시장 안 10분위 + 라벨' 을 앞세운다.
     검증 미달 머리(usable=false)는 반드시 '참고(검증 미달)' 를 같이 적는다 — 지금 통과는 한국 중기(20일) · 미국 단기(5일) 두 개뿐.
   · 영어 화면: 각 조각에 data-en 을 달아 번역기가 그대로 쓴다. 투자 권유 아님. */
(function () {
  "use strict";
  var CTX = { st: null, kr: null, us: null }, asked = false;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var sp = function (ko, en, cls) { return "<span" + (cls ? ' class="' + cls + '"' : "") + ' data-en="' + esc(en) + '">' + esc(ko) + "</span>"; };
  var HN = { s: ["단기 1주", "Short 1w"], m: ["중기 1달", "Mid 1m"], l: ["장기 6달", "Long 6m"] };
  function css() {
    if (document.getElementById("luxMiniCss")) return;
    var s = document.createElement("style"); s.id = "luxMiniCss";
    s.textContent = ".lmx{margin:6px 0 2px;font-size:12.5px}.lmx summary{display:flex;flex-wrap:wrap;align-items:center;gap:6px;cursor:pointer;list-style:none}.lmx summary::-webkit-details-marker{display:none}" +
      ".lmx summary>b{font-size:12px;opacity:.7;margin-right:2px;letter-spacing:.02em}.lmx .lc{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;border:1px solid rgba(128,128,128,.28);font-size:11.5px;line-height:1.5}" +
      ".lmx .lc .i{opacity:.65}.lmx .lc em{font-style:normal;font-weight:700;font-variant-numeric:tabular-nums}.lmx .lc.ref{opacity:.62;border-style:dashed}" +
      ".lmx .lc.pos em,.lmx .lc.pos1 em{color:#e5484d}.lmx .lc.neg em,.lmx .lc.neg1 em{color:#3b82f6}.lmx .lm{opacity:.55;font-size:11px}" +
      ".lmx .lw{margin:8px 0 0;padding:8px 10px;border-radius:10px;background:rgba(128,128,128,.07);display:flex;flex-direction:column;gap:4px;line-height:1.45}" +
      ".lmx .lw b{font-size:12px}.lmx .lw .g{font-size:10.5px;padding:1px 6px;border-radius:6px;margin-left:6px;background:rgba(128,128,128,.14)}.lmx .lw .g.ok{background:rgba(34,197,94,.16);color:#16a34a}" +
      ".lmx .lw .st{opacity:.7;font-size:11.5px;font-variant-numeric:tabular-nums}.lmx .lw .y{opacity:.9}.lmx .ft{opacity:.6;font-size:11px;margin-top:6px;display:block}";
    document.head.appendChild(s);
  }
  function ctxOf(mk) {
    var st = window.__lastState, M = window.luxMini;
    if (!st || !M || !M.ready()) return null;
    if (CTX.st !== st) { CTX = { st: st, kr: null, us: null }; }
    if (!CTX[mk]) { try { CTX[mk] = M.ctxFrom(st, mk); } catch (e) { CTX[mk] = null; } }
    return CTX[mk];
  }
  function ask() {
    if (asked || !window.luxMini) return; asked = true;
    window.luxMini.load().then(function () { try { window.dispatchEvent(new CustomEvent("lux:luxmini")); } catch (e) {} }).catch(function () { asked = false; });
  }
  function quoteOf(sym) {
    var st = window.__lastState, wl = (st && st.watchlist) || [];
    for (var i = 0; i < wl.length; i++) if (wl[i] && wl[i].symbol === sym) return wl[i];
    return null;
  }
  function sg(v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1); }
  // sym → HTML ("" = 아직 준비 안 됨 · 판단 불가). 준비되면 'lux:luxmini' 이벤트로 다시 그리게 한다.
  function html(sym) {
    var M = window.luxMini; if (!M) return "";
    if (!M.ready()) { ask(); return ""; }
    var q = quoteOf(sym); if (!q) return "";
    var mk = q.market === "kr" || /\.(KS|KQ)$/.test(sym) ? "kr" : "us", c = ctxOf(mk); if (!c) return "";
    var r; try { r = M.predict(q, c); } catch (e) { r = null; } if (!r) return "";
    css();
    var chip = function (k) { var h = r[k]; if (!h) return ""; return '<span class="lc ' + h.cls + (h.usable ? "" : " ref") + '">' + sp(HN[k][0], HN[k][1], "i") + "<em>" + h.decile + "/10</em>" + sp(h.label, h.labelEn) + "</span>"; };
    var body = function (k) {
      var h = r[k]; if (!h) return "";
      var g = h.usable ? '<span class="g ok" data-en="Validated">검증 통과</span>' : '<span class="g" data-en="Reference only (not validated)">참고(검증 미달)</span>';
      var st = '<span class="st">' + sp("시장 안 " + h.decile + "분위", "Market decile " + h.decile) + " · " +
        sp("과거 같은 분위 시장 대비 " + sg(h.ex) + "%p (가운데 절반 " + sg(h.exLo) + " ~ " + sg(h.exHi) + ")", "Past same-decile vs market " + sg(h.ex) + "pp (middle half " + sg(h.exLo) + " to " + sg(h.exHi) + ")") + "</span>";
      return '<div class="lw"><b>' + sp(HN[k][0], HN[k][1]) + " · " + sp(h.label, h.labelEn) + g + "</b>" + st +
        (h.why || []).map(function (w) { return '<span class="y" data-en="' + esc(w[1]) + '">' + esc(w[0]) + "</span>"; }).join("") + "</div>";
    };
    return '<details class="lmx olx"><summary><b>LUX-Mini</b>' + chip("s") + chip("m") + chip("l") + sp("근거", "Why", "lm") + "</summary>" + body("s") + body("m") + body("l") +
      sp("브라우저에서 도는 작은 주식 모델 · 같은 날 같은 시장 종목과 비교한 순위 · 확률은 동전에 가깝다(검증 AUC 0.51~0.53) · 투자 권유 아님",
         "Small stock model running in your browser · rank vs same-market stocks today · probabilities are near coin-flip (validation AUC 0.51–0.53) · not investment advice", "ft") + "</details>";
  }
  window.luxMiniView = { html: html, load: ask };
})();
