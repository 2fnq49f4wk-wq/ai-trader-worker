/* [V33.512] 한국 장후 · 넥스트레이드 — ★네이버 ms "OPEN" 은 정규장이라는 뜻이 아니다★
 *
 *   운영 실측(2026-10-07 17:44 KST · tools/probe-kr-nxt.mjs):
 *     폴링 005930 {ms:"OPEN", nv:270000, nxtOverMarketPriceInfo:{AFTER_MARKET, overPrice "270,000", 17:44:12}}
 *     폴링 027410 {ms:"OPEN", nv:3915, nxtOverMarketPriceInfo:null}  ← KRX 시간외 단일가
 *     우리 상태: mstate_kr {REGULAR 418, POST 28} — 장후 체결가가 정규장 가격으로 찍혔다.
 *   종전 applyKrOverMarket 는 ms OPEN 이면 무조건 REGULAR 로 돌려보냈다 →
 *     ① 표시: 장후 체결이 '정규장' ② 오늘 종가가 시간외 체결로 덮임 ③ post·extTs 미기입 → 장후 거래 판정 전부 '체결없음'.
 *   시계를 고정해 함수를 ★실제로 돌리고★, fetchBatchQuotes 병합이 저장된 종가를 지키는지까지 본다.
 */
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const RealDate = Date;
function at(iso) {
  const T = new RealDate(iso).getTime();
  globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } };
}
function restore() { globalThis.Date = RealDate; }
const nxt = (p, t) => ({ tradingSessionType: "AFTER_MARKET", overMarketStatus: "OPEN", overPrice: p, fluctuationsRatio: "-0.74",
  compareToPreviousPrice: { code: "5" }, localTradedAt: t, tradeStopType: { code: "1" }, tradableStatus: "tradable" });

console.log("① 시계 고정 — 세션 판정");
try {
  at("2026-10-07T08:44:00Z");   // 17:44 KST 수요일 — 장후
  let o = { price: 270000, prevClose: 272000, dayPct: -0.735 };
  M.applyKrOverMarket(o, { ms: "OPEN", nxtOverMarketPriceInfo: nxt("270,000", "2026-10-07T17:43:50+09:00") });
  chk(o.mstate === "POST" && o.post === 270000 && o.extTs > 0 && o.regFreeze === true,
    "17:44 · ms OPEN · 넥스트레이드 애프터 → POST · post 270,000 · 체결시각 있음 · 정규장 가격 고정", JSON.stringify(o));
  o = { price: 3915, prevClose: 3720, dayPct: 5.24 };
  M.applyKrOverMarket(o, { ms: "OPEN", nxtOverMarketPriceInfo: null });
  chk(o.mstate === "POST" && o.post === 3915 && o.extTs === 0 && o.regFreeze === true,
    "17:44 · ms OPEN · 넥스트레이드 없음(KRX 시간외 단일가) → POST · post=nv 표시만(체결시각 0 → 거래 금지)", JSON.stringify(o));
  at("2026-10-07T01:00:00Z");   // 10:00 KST — 정규장
  o = { price: 271000, prevClose: 272000, dayPct: -0.37 };
  M.applyKrOverMarket(o, { ms: "OPEN" });
  chk(o.mstate === "REGULAR" && !o.regFreeze && o.post == null, "10:00 · ms OPEN → REGULAR(가격 갱신)", JSON.stringify(o));
  at("2026-10-07T06:35:00Z");   // 15:35 KST — 마감 직후 · 넥스트레이드 재개 전
  o = { price: 270500, prevClose: 272000, dayPct: -0.55 };
  M.applyKrOverMarket(o, { ms: "OPEN" });
  chk(o.mstate === "POST" && !o.regFreeze && o.post == null, "15:35 · 마감 직후 10분 → nv 는 오늘 종가(고정 안 함 · 시간외 값 없음)", JSON.stringify(o));
  at("2026-10-07T12:00:00Z");   // 21:00 KST — 휴장
  o = { price: 269000, prevClose: 272000, dayPct: -1.1 };
  M.applyKrOverMarket(o, { ms: "CLOSE" });
  chk(o.mstate === "CLOSED" && o.regFreeze === true, "21:00 · 휴장 → CLOSED · 정규장 가격 고정(통합 마지막가로 덮지 않는다)", JSON.stringify(o));
} finally { restore(); }

console.log("② fetchBatchQuotes 병합 — 저장된 종가를 지킨다");
{
  const realFetch = globalThis.fetch;
  const stored = { price: 270500, prevClose: 272000, dayPct: -0.551, market: "kr" };
  const DB = { prepare: (sql) => { let a = []; const st = { sql, bind: (...x) => { a = x; return st; },
    first: async () => null,
    all: async () => (/SELECT k, v FROM state WHERE k IN/.test(sql) ? { results: a.filter((k) => k === "quote:005930.KS" || k === "quote:027410.KS").map((k) => ({ k, v: JSON.stringify(k === "quote:005930.KS" ? stored : { price: 3815, prevClose: 3720 }) })) } : { results: [] }),
    run: async () => ({ meta: { changes: 0 } }) }; return st; }, batch: async () => [] };
  globalThis.fetch = async (u) => {
    if (String(u).includes("polling.finance.naver.com")) return new Response(JSON.stringify({ result: { areas: [{ datas: [
      { cd: "005930", nv: 270000, sv: 272000, ms: "OPEN", nxtOverMarketPriceInfo: nxt("270,000", "2026-10-07T17:43:50+09:00") },
      { cd: "027410", nv: 3915, sv: 3720, ms: "OPEN", nxtOverMarketPriceInfo: null },
      { cd: "035720", nv: 33050, sv: 33500, ms: "OPEN", nxtOverMarketPriceInfo: null }] }] } }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  try {
    at("2026-10-07T08:44:00Z");
    M.resetFetchBudget(100);
    const q = await M.fetchBatchQuotes(["005930.KS", "027410.KS", "035720.KS"], { DB });
    const s = q["005930.KS"], b = q["027410.KS"], k = q["035720.KS"];
    chk(s && s.price === 270500 && s.post === 270000 && s.mstate === "POST", "삼성: 정규장 가격 = 저장된 종가 270,500 · 장후 270,000 은 post", JSON.stringify(s));
    chk(b && b.price === 3815 && b.post === 3915, "BGF: 정규장 가격은 저장값 · 시간외 단일가 3,915 는 post", JSON.stringify(b));
    chk(k && k.price === 33050, "저장된 quote 가 없는 종목은 nv 를 쓴다(없는 종가를 지어내지 않는다)", JSON.stringify(k));
  } finally { restore(); globalThis.fetch = realFetch; }
}
console.log("③ 한국 시간외는 청산만(진입은 측정 전까지 닫힘)");
{
  const DB = { prepare: () => { const st = { bind: () => st, first: async () => ({ n: 0 }), all: async () => ({ results: [] }), run: async () => ({}) }; return st; } };
  try {
    at("2026-10-07T08:44:00Z");   // 17:44 KST 장후
    const cfg = { extTrade: { enabled: true, entries: true, us: { pre: true, post: true }, kr: { pre: true, post: true } } };   // kr.entries 가 빠진 저장 cfg
    const g = await M.extBuyGuard(DB, "kr", 10, 270000, { p: 0.9 }, cfg, { quote: { post: 270000, extTs: Date.now(), postPct: -0.7 } }, Date.now());
    chk(g && g.ok === false && g.why === "entries_disabled", "kr.entries 가 없으면(저장 cfg 가 기본값을 덮어도) 한국 시간외 진입은 막힌다", JSON.stringify(g));
    const g2 = await M.extBuyGuard(DB, "kr", 10, 270000, { p: 0.9 }, M.DEFAULT_CFG || { extTrade: { enabled: true, kr: { post: true, entries: false } } }, { quote: { post: 270000, extTs: Date.now() } }, Date.now());
    chk(g2 && g2.ok === false && g2.why === "entries_disabled", "기본 설정: 한국 시간외 진입 닫힘", JSON.stringify(g2));
  } finally { restore(); }
}
if (fails) { console.log("\n✗ 한국 장후 · 넥스트레이드 세션 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 한국 장후 · 넥스트레이드 세션 통과");
