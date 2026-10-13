/* [V33.586] ★라이브 점검(10/13)에서 찾은 결함 3건의 회귀 방지★
 *   ① 두뇌 화면 '반사실 후보' 칸이 '불러오는 중…' 에서 영영 멈춤 — 부팅 때만 부르고 화면을 열 때는 안 불렀다
 *   ② '엔진 지연' 거짓 경보 — 캐시 사본 안의 lastTick 을 지금 시계와 빼 사본 나이만큼 지연으로 보였다(서버 기준 6.8초 전 → 화면 '3분 전 · 지연')
 *   ③ 겹친 크론의 유령 매도 시도(SOXX 13:33:20 매도 → 13:33:45 "[정합성] 포지션 4 vs 원장 0") — 빠른 감시가 들고 있던 옛 포지션
 *   ②는 실제 함수를 떼어 돌린다(가짜 DOM). */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };

// ①
const op = H.slice(H.indexOf("function onPageChanged(){"), H.indexOf("function watchPages(){"));
chk(/if\(id === 'nnviz' && \(!CF\.ts \|\| Date\.now\(\) - CF\.ts > 60000\)\) loadCfCandidates\(\);/.test(op) && /CF\.ts = Date\.now\(\); renderCfCandidates\(d\)/.test(H),
    "두뇌 화면을 열 때마다(1분에 한 번까지) 반사실 후보를 받는다");

// ② renderEngine 실제 실행
const a = H.indexOf("  function renderEngine(lastTick, lastHeartbeat, serverTime) {");
let b = H.indexOf("\n  }\n", a);
chk(a > 0 && b > a, "renderEngine(lastTick, lastHeartbeat, serverTime) 를 찾았다");
if (a > 0 && b > a) {
  const el = {}; const mk = () => ({ className: "", textContent: "" });
  const ctx = { Date, Math, window: { __serverMarketStatus: { us: true, kr: false } }, __els: el,
    $: (id) => (el[id] = el[id] || mk()), getMarketStatus: () => ({ usTrading: true, krTrading: false }),
    fmtAgo: (t) => Math.round((Date.now() - t) / 1000) + "s" };
  vm.createContext(ctx);
  vm.runInContext(H.slice(a, b + 4) + "\nglobalThis.re = renderEngine;", ctx);
  const now = Date.now();
  ctx.re(now - 190000, now - 190000, now - 183000);          // 사본은 3분 묵었고, 사본 기준 엔진은 7초 전
  const fresh = el.engineDot.className, ftxt = el.engineText.textContent;
  ctx.re(now - 400000, now - 400000, now - 5000);             // 사본은 새것인데 엔진이 6분 넘게 안 돌았다
  const dead = el.engineDot.className;
  ctx.re(now - 190000, now - 190000, null);                   // 서버 시각 없음 → 종전대로 지금 시계
  const legacy = el.engineDot.className;
  chk(fresh === "dot alive" && /7s/.test(ftxt) && dead === "dot stale" && legacy === "dot stale",
      "사본 나이는 지연으로 세지 않고(작동 중 · 7초 전) · 진짜 멈춤은 지연 · 서버 시각 없으면 종전 판정", JSON.stringify({ fresh, ftxt, dead, legacy }));
}
chk(/renderEngine\(state\.lastTick, state\.lastHeartbeat, state\.serverTime\)/.test(H) && /window\.__serverTime = state\.serverTime \|\| null;/.test(H)
    && /if\(_st && _st >= t && \(Date\.now\(\) - _st\) < 15 \* 60000\) t = Date\.now\(\) - \(_st - t\);/.test(H),
    "상태 렌더가 서버 시각을 넘기고 · 사이드바 '마지막 사이클' 배지도 같은 기준");

// ③
const fw = S.slice(S.indexOf("async function runFastWatch("), S.indexOf("async function runFastWatch(") + 20000);
const iRe = fw.indexOf('SELECT qty FROM positions WHERE market = ? AND symbol = ? AND strategy = ?');
const iSell = fw.indexOf("await executeSell(DB, market, held.symbol, held, sellDecision.sellQty");
chk(iRe > 0 && iSell > iRe && /if \(!_live \|\| !\(Number\(_live\.qty\) > 0\)\) \{ delete c\.positions\[posKey\]; continue; \}/.test(fw),
    "빠른 감시는 팔기 직전 저장된 포지션을 다시 읽고 · 이미 팔렸으면 건너뛴다");

// ④ [V33.587] 한국 장전 시세 — 둘 다 시간외면 한국을 먼저(미국 애프터 평가가 사이클을 다 써 한국 차례가 안 오던 것)
chk(/if \(marketsForQuotes\.length === 2 && !usMarketHours && !krMarketHours\) marketsForQuotes\.reverse\(\);/.test(S), "미국 애프터 · 한국 장전이 겹치면 한국 시세를 먼저 받는다");
if (fails) { console.log("\n✗ 라이브 점검 결함 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 라이브 점검 결함(반사실 칸 · 엔진 지연 경보 · 겹친 크론 매도) 통과");
