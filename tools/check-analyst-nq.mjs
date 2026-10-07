/* [V33.502] ★애널리스트 컨센서스는 나스닥에서 온다★ — 야후 v7 사망으로 수집 0종목 · 야간 anlrevk 가 며칠째 대기.
   ① 파싱: consensusOverview → {upsidePct, rating(1=강매수…5=매도 척도), nOpinions, tgt, px} — 소비처가 읽는 모양 그대로
   ② 커서: 한 사이클에 perTick 종목만 · 한 바퀴가 끝나야 ts · 신선하면 쉰다
   ③ 출처 교체 첫 관측은 개정 사건이 아니다(야후 평균 목표가 ≠ 나스닥 목표가)
   ④ 전부 실패면 커서·캐시를 지킨다 · "기록 없음"(ETF)은 옛 야후 값을 내린다 */
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 파싱");
const co = (pt, b, h, s) => ({ data: { symbol: "x", consensusOverview: { lowPriceTarget: pt * 0.7, highPriceTarget: pt * 1.2, priceTarget: pt, buy: b, hold: h, sell: s } } });
const a = M.parseNqAnalyst(co(334.9, 15, 9, 4), 333.99);
chk(a && a.nOpinions === 28 && Math.abs(a.upsidePct - (334.9 - 333.99) / 333.99 * 100) < 1e-9 && a.tgt === 334.9 && a.px === 333.99,
  "목표가·상승여력·의견 수", "AAPL " + JSON.stringify(a));
chk(a && Math.abs(a.rating - (1.5 * 15 + 3 * 9 + 4.5 * 4) / 28) < 1e-3 && M.nqAnalystRating(10, 0, 0) === 1.5 && M.nqAnalystRating(0, 0, 10) === 4.5,
  "등급은 야후 척도(매수 1.5 · 중립 3 · 매도 4.5)", "rating " + (a && a.rating));
chk(M.parseNqAnalyst(co(100, 1, 1, 0), 90) === null, "애널리스트 3인 미만은 버린다", "2인 통과");
chk(M.parseNqAnalyst({ data: null, status: { bCodeMessage: [{ code: 1002 }] } }, 10) === null, "기록 없음(BRK.B·ETF) → null", "빈 응답");
const np = M.parseNqAnalyst(co(50, 3, 0, 0), 0);
chk(np && np.upsidePct === undefined && np.tgt === 50, "시세가 없으면 상승여력을 지어내지 않는다", "px 0 " + JSON.stringify(np));

console.log("② 커서 · ③ 출처 · ④ 실패");
const store = new Map();
const quotes = { AAA: { price: 101, regPrice: 100 }, BBB: { price: 50 }, CCC: { price: 20 }, ETF1: { price: 10 } };
for (const k in quotes) store.set("quote:" + k, JSON.stringify(quotes[k]));
const DB = { prepare: (sql) => {
  let args = [];
  const st = { bind: (...x) => { args = x; return st; },
    first: async () => (/SELECT v FROM state WHERE k = \?/.test(sql) && store.has(args[0])) ? { v: store.get(args[0]) } : null,
    all: async () => ({ results: /WHERE k IN/.test(sql) ? args.filter((k) => store.has(k)).map((k) => ({ k, v: store.get(k) })) : [] }),
    run: async () => { if (/INSERT INTO state/.test(sql)) store.set(args[0], args[1]); return {}; } };
  return st; } };
let mode = "ok", calls = [];
globalThis.fetch = async (url) => {
  const m = String(url).match(/analyst\/([^/]+)\/targetprice/);
  if (!m) return new Response("{}", { status: 404 });
  calls.push(m[1]);
  if (mode === "down") return new Response("blocked", { status: 403 });
  if (m[1] === "ETF1") return new Response(JSON.stringify({ data: null }), { status: 200 });
  const pt = mode === "up" ? 130 : 120;
  return new Response(JSON.stringify(co(pt, 6, 2, 1)), { status: 200 });
};
// 출처 교체 직전: 야후 시절 캐시(목표가 90 — 나스닥 120 과 다르다)
store.set("analyst_consensus", JSON.stringify({ ts: Date.now() - 3 * 86400000, n: 2, bySym: { AAA: { tgt: 90, rating: 2.2, nOpinions: 10 }, ETF1: { tgt: 11, rating: 2, nOpinions: 4 } } }));
const cfg = { usTickers: ["AAA", "BBB", "CCC", "ETF1", "^VIX"], analyst: { perTick: 2, par: 2, minBudgetReserve: 1 } };
M.resetFetchBudget(100);
let r = await M.updateAnalystConsensus(DB, cfg);
chk(calls.join(",") === "AAA,BBB" && r.cur === 2 && r.src === "nq" && r.ts === 0, "한 사이클에 perTick(2)종목 · 한 바퀴 전에는 ts 0", "1차 " + calls + " cur " + (r && r.cur) + " ts " + (r && r.ts));
chk(r.bySym.AAA.src === "nq" && Math.abs(r.bySym.AAA.upsidePct - 20) < 1e-9, "상승여력 분모는 정규장 가격(regPrice 100)", "AAA " + JSON.stringify(r.bySym.AAA));
const led0 = store.get("analyst_rev") ? JSON.parse(store.get("analyst_rev")) : null;
chk(!led0 || !led0.bySym.AAA || !(led0.bySym.AAA.ev || []).length, "★야후 90 → 나스닥 120 은 개정 사건이 아니다(출처 교체)★", "가짜 개정 " + JSON.stringify(led0 && led0.bySym.AAA));
calls = []; M.resetFetchBudget(100);
r = await M.updateAnalystConsensus(DB, cfg);
chk(calls.join(",") === "CCC,ETF1" && r.cur === 0 && r.ts > 0 && !r.bySym.ETF1, "두 번째 차례에 한 바퀴 끝 → ts · 지수(^) 건너뜀 · 기록 없는 ETF 의 옛 야후 값은 내린다", "2차 " + calls + " " + JSON.stringify({ cur: r.cur, ts: r.ts, etf: r.bySym.ETF1 }));
chk(r.last && r.last.ok + r.last.empty + r.last.err === 2, "[V33.509] 마지막 차례 성적(ok/empty/err)을 상태에 남긴다", "last " + JSON.stringify(r && r.last));
calls = []; M.resetFetchBudget(100);
r = await M.updateAnalystConsensus(DB, cfg);
chk(calls.length === 0, "한 바퀴를 끝냈고 신선하면 쉰다(조회 0)", "쉬지 않는다 " + calls);
mode = "up"; calls = []; M.resetFetchBudget(100);
r = await M.updateAnalystConsensus(DB, cfg, true);
const led = JSON.parse(store.get("analyst_rev") || "null");
chk(led && led.bySym.AAA && led.bySym.AAA.ev.length === 1 && led.bySym.AAA.ev[0].from === 120 && led.bySym.AAA.ev[0].to === 130,
  "같은 출처의 다음 관측(120→130)은 상향 사건", "원장 " + JSON.stringify(led && led.bySym.AAA));
mode = "down"; calls = []; M.resetFetchBudget(100);
const before = store.get("analyst_consensus");
r = await M.updateAnalystConsensus(DB, cfg, true);
chk(calls.length === 2 && store.get("analyst_consensus") === before, "전부 실패면 커서·캐시를 건드리지 않는다", "실패 처리");
mode = "ok"; calls = []; M.resetFetchBudget(2);
r = await M.updateAnalystConsensus(DB, cfg, true);
chk(calls.length === 0, "예산이 바닥이면 묻지 않는다(코어 시세 몫 보호)", "예산 무시 " + calls);
if (fails) { console.log("\n✗ 나스닥 애널리스트 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 나스닥 애널리스트 계약 통과");
