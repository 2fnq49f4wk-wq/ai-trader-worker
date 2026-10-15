/* [V33.627] 시간외 시세 실시간 — 사용자(10/16 08:07 KST): "장전 데이터가 8시 07분에 처음 들어왔다 · 프리마켓인데 아직 어제 데이터 ·
 *   짝·홀수 분으로 한국·미국 나누지 말고 한 번에 · 완전 실시간".
 *   ① 시세는 거래 사이클(락) 앞에서 매분 두 시장 다(extQuoteSweep) — 평가 차례와 무관
 *   ② 평가 차례는 분의 짝·홀이 아니라 마지막 회차로부터 지난 시간(위상 고정으로 한 시장이 굶던 것)
 *   ③ 장전 = 새 거래일 — 전일 종가를 네이버 기준가(sv)로 넘긴다(저장된 그저께 종가를 지키던 것) */
import { readFileSync } from "node:fs";
const M = await import("../src/index.js");
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const RealDate = Date;
function at(iso) { const T = new RealDate(iso).getTime(); globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } }; }
function restore() { globalThis.Date = RealDate; }

console.log("① 시세 매분 — 시간외 시장 전부");
{
  const sch = S.indexOf("async scheduled(event, env, ctx)"), sw = S.indexOf("await extQuoteSweep(env)", sch), tr = S.indexOf("await runTradingCycle(env)", sch);
  chk(sch > 0 && sw > sch && sw < tr, "스케줄러가 거래 사이클(락) ★앞★에서 시간외 시세를 받는다(락이 잡혀도 시세는 안 멈춘다)");
  chk(JSON.stringify(M.extSweepMarkets(new RealDate("2026-10-15T23:07:00Z")).sort()) === '["kr","us"]', "08:07 KST(미국 장후 · 한국 장전) → 두 시장 다");
  chk(JSON.stringify(M.extSweepMarkets(new RealDate("2026-10-15T07:30:00Z"))) === '["kr"]' || JSON.stringify(M.extSweepMarkets(new RealDate("2026-10-15T07:30:00Z")).sort()) === '["kr","us"]', "16:30 KST 한국 장후는 포함");
  chk(M.extSweepMarkets(new RealDate("2026-10-15T02:00:00Z")).indexOf("kr") < 0, "한국 정규장(11:00 KST)은 사이클이 받는다 — 중복 안 함");
  chk(/for \(let sh = 0; sh < total; sh\+\+\)[\s\S]{0,120}refreshPriceShard\(env, m, sh\)/.test(S) && /getState\(DB, "ext_sweep", null, true\)/.test(S), "가격 샤드 전부 · 스로틀 상태는 엄격 읽기");
}
console.log("② 평가 차례 — 오래 기다린 시장 먼저 · 위상 고정 없음");
{
  const ext = () => true, now = 1e12;
  chk(JSON.stringify(M.extTurnOrder(["kr", "us"], { kr: now - 300000, us: now - 60000 }, now, ext)) === '["kr","us"]'
      && JSON.stringify(M.extTurnOrder(["kr", "us"], { kr: now - 60000, us: now - 300000 }, now, ext)) === '["us","kr"]', "오래 기다린 시장이 먼저");
  chk(!M.extTurnDue({ kr: now - 30000 }, "kr", now) && M.extTurnDue({ kr: now - 120000 }, "kr", now) && M.extTurnDue({}, "kr", now), "마지막 회차로부터 100초 지나야 다시(처음엔 바로)");
  // 사이클이 늘 홀수 분 · 2분 길이로 돌아도 두 시장이 다 돈다(종전 짝·홀 규칙은 한국이 굶었다)
  let last = {}, ran = { us: 0, kr: 0 };
  for (let c = 0; c < 20; c++) {
    const t0 = now + c * 120000;
    let t = t0;
    for (const m of M.extTurnOrder(["kr", "us"], last, t, ext)) { if (!M.extTurnDue(last, m, t)) continue; last[m] = t; ran[m]++; t += 110000; }
  }
  chk(ran.kr >= 10 && ran.us >= 10, "2분 사이클 20번: 한국·미국 둘 다 절반 이상 차례", JSON.stringify(ran));
  chk(/const _ord = extTurnOrder\(marketsForQuotes, __extTurn/.test(S) && /if \(!extTurnDue\(__extTurn, market, Date\.now\(\)\)\) continue;/.test(S), "사이클 배선");
}
console.log("③ 장전 = 새 거래일 — 전일 종가 넘기기");
{
  const realFetch = globalThis.fetch;
  const pre = (p) => ({ tradingSessionType: "PRE_MARKET", overMarketStatus: "OPEN", overPrice: p, fluctuationsRatio: "3.33", compareToPreviousPrice: { code: "2" },
    localTradedAt: "2026-10-16T08:07:09+09:00", tradeStopType: { code: "1" }, tradableStatus: "tradable" });
  const stored = { "quote:005930.KS": { price: 210000, prevClose: 232000, dayPct: -9.48 }, "quote:000660.KS": { price: 1262000, prevClose: 1262000, dayPct: 0 } };
  const DB = { prepare: (sql) => { let a = []; const st = { sql, bind: (...x) => { a = x; return st; }, first: async () => null,
    all: async () => (/SELECT k, v FROM state WHERE k IN/.test(sql) ? { results: a.filter((k) => stored[k]).map((k) => ({ k, v: JSON.stringify(stored[k]) })) } : { results: [] }),
    run: async () => ({ meta: { changes: 0 } }) }; return st; }, batch: async () => [] };
  globalThis.fetch = async (u) => String(u).includes("polling.finance.naver.com") ? new Response(JSON.stringify({ result: { areas: [{ datas: [
      { cd: "005930", nv: 210000, sv: 210000, ms: "PREOPEN", nxtOverMarketPriceInfo: pre("217,000") },
      { cd: "000660", nv: 1262000, sv: 1262000, ms: "PREOPEN", nxtOverMarketPriceInfo: pre("1,304,000") }] }] } }), { status: 200 }) : new Response("{}", { status: 404 });
  try {
    at("2026-10-15T23:07:30Z");   // 08:07 KST 금요일 — 장전
    M.resetFetchBudget(100);
    const q = await M.fetchBatchQuotes(["005930.KS", "000660.KS"], { DB });
    const s = q["005930.KS"], h = q["000660.KS"];
    chk(s && s.prevClose === 210000 && s.price === 210000 && s.dayPct === 0 && s.pre === 217000 && s.mstate === "PRE",
        "삼성: 저장 전일 종가 232,000(그저께) → 네이버 기준가 210,000(어제) · 정규 등락 0 · 장전 217,000", JSON.stringify(s));
    chk(h && h.prevClose === 1262000 && h.price === 1262000 && h.pre === 1304000, "기준가가 저장값과 같으면 그대로(아직 안 넘어간 경우도 안전)", JSON.stringify(h));
  } finally { restore(); globalThis.fetch = realFetch; }
}
if (fails) { console.log("\n✗ 시간외 실시간 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 시간외 실시간 통과");
