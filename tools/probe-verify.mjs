/* [V33.558] ★이번 세션 변경의 운영 회귀 점검★(읽기 전용 GET) — 사용자 10/11: "우리가 바꾼 것 때문에 성능 떨어진 게 있는지 · 학습에 오류 안 생기는지".
 *   ① /api/state: 중복 필드 생략(V33.547) 뒤에도 화면이 쓰는 값(가격·rsi·ma·atr·dayPct)이 다 있는가 · 현금·입금·학습 상태칩(getStates 나무 떼기 V33.553)이 살아 있는가
 *   ② 위원회 모델 표(nn-viz overview): 신뢰·정확도·학습 시각 — 표본 전부 받기(V33.550) 뒤 학습 회차가 무너지지 않았는가
 *   ③ OMNI-Q · kr-halt · 실적 · 차트 응답 모양
 * 사용법: node tools/probe-verify.mjs <url> */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: node tools/probe-verify.mjs <url>"); process.exit(2); }
const out = (k, v) => console.log("VFY " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
let bad = 0;
const ok = (c, m, d) => { if (!c) bad++; out(c ? "ok" : "FAIL", m + (d != null ? " — " + (typeof d === "string" ? d : JSON.stringify(d)).slice(0, 400) : "")); };
const get = async (p) => { const r = await fetch(BASE + p, { headers: { "cache-control": "no-cache" } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, j, n: t.length }; };

// ① 상태
try {
  const { s, j, n } = await get("/api/state");
  ok(s === 200 && j && Array.isArray(j.watchlist), "/api/state 200 · 관심종목 배열", { s, n });
  if (j) {
    const wl = j.watchlist || [], priced = wl.filter((w) => typeof w.price === "number" && w.price > 0);
    const withRsi = priced.filter((w) => typeof w.rsi === "number"), withMa = priced.filter((w) => typeof w.ma === "number");
    const dup = wl.filter((w) => w.dailyRsi !== undefined || w.dispPrice !== undefined).length;
    ok(wl.length >= 900 && priced.length >= wl.length * 0.9, "관심종목 수·가격 보유", { n: wl.length, priced: priced.length });
    ok(withRsi.length >= priced.length * 0.8 && withMa.length >= priced.length * 0.8, "화면이 쓰는 지표(rsi·ma)는 남아 있다(중복 이름만 뺐다)", { rsi: withRsi.length, ma: withMa.length, dupNamesLeft: dup });
    const c = j.cash || {}, d = j.deposits || {};
    ok(typeof c.us === "number" && typeof c.kr === "number", "현금(시장별) 숫자", c);
    ok(d && Object.keys(d).length > 0, "입금 기록(getStates 묶음) 살아 있음", d);
    ok(j.extTrain && j.extTrain.state, "외부 학습 상태칩(mind_model 머리만 읽기)", j.extTrain);
    ok(j.marketStatus && j.tradingWindow, "장 상태·거래 창", { ms: j.marketStatus, tw: j.tradingWindow });
  }
} catch (e) { ok(false, "/api/state 예외", String(e)); }

// ② 위원회 모델 표
try {
  const { s, j } = await get("/api/nn-viz?model=overview");
  ok(s === 200 && j, "/api/nn-viz?model=overview 200");
  for (const e of ((j && j.experts) || [])) {
    const pick = {}; for (const k of ["name", "role", "trusted", "live", "state", "w", "weight", "valAcc", "accLB", "valAccLB", "ic", "trainedAt", "ageH", "featVer", "n", "why", "tier", "status"]) if (e[k] !== undefined) pick[k] = e[k];
    if (pick.trainedAt) pick.trainedAgoH = +((Date.now() - pick.trainedAt) / 3600000).toFixed(1);
    out("model", pick);
  }
} catch (e) { ok(false, "nn-viz 예외", String(e)); }

// ③ OMNI-Q · 기타 응답 모양
try {
  const { s, j } = await get("/api/omni-status");
  const q = j && (j.omniQ || j.omniq);
  ok(s === 200 && q, "/api/omni-status 의 OMNI-Q 요약", q ? Object.keys(q) : j && Object.keys(j));
  if (q) out("omniQ", q);
} catch (e) { ok(false, "omni-status 예외", String(e)); }
for (const p of ["/api/kr-halt", "/api/earnings", "/api/chart?symbol=AAPL", "/api/chart?symbol=005930.KS", "/api/news"]) {
  try {
    const t0 = Date.now(); const { s, j, n } = await get(p); const ms = Date.now() - t0;
    const shape = p.includes("chart") ? (j && Array.isArray(j.candles) ? j.candles.length + "봉" : "캔들 없음")
      : p.includes("earnings") ? (j && Array.isArray(j.items) ? j.items.length + "건" : "items 없음")
      : p.includes("kr-halt") ? (j && j.markets ? Object.keys(j.markets).join(",") : "markets 없음") : n + "B";
    ok(s === 200 && !/없음/.test(shape) && ms < 15000, p + " " + ms + "ms · " + shape);
  } catch (e) { ok(false, p + " 예외", String(e)); }
}
out("result", bad ? bad + "건 실패" : "전부 통과");
