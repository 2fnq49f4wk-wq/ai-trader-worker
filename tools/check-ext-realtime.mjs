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
console.log("④ 데이터 감시·자가 복구(V33.628)");
{
  const now = 1e12, mk = (us, kr) => ({ us: { fed_rate: { value: "4" }, cpi: { value: "3" }, core_cpi: { value: "2" }, unemployment: { value: "4" }, ust10y: { value: "5" }, ...us },
    kr: { base_rate: { value: "3" }, cpi: { value: "2" }, ktb3y: { value: "3" }, ktb10y: { value: "4" }, ...kr }, updatedAt: now - 3600000 });
  let J = M.dataHealthJudge(now, { us: "POST", kr: "PRE" }, { us: [30000, 40000, 50000], kr: [420000, 400000, 500000] }, now - 60000, true, mk({}, {}));
  chk(J.quote_us.ok && !J.quote_kr.ok && J.quote_kr.age >= 400000 && J.fx.ok && J.macro.ok, "장전 한국 시세 중앙 7분 → 낡음(복구 대상) · 미국 장후 40초 → 정상", JSON.stringify(J));
  J = M.dataHealthJudge(now, { us: "CLOSED", kr: "CLOSED" }, {}, now - 3600000, false, mk({ cpi: null }, { cpi: undefined }));
  chk(J.quote_us.idle && J.fx.idle && !J.macro.ok && J.macro.missing.join() === "us.cpi,kr.cpi", "휴장엔 시세·환율 안 잼 · 경제지표 빈 칸(us.cpi · kr.cpi)은 언제나 잡는다", JSON.stringify(J.macro));
  J = M.dataHealthJudge(now, { us: "REGULAR", kr: "CLOSED" }, { us: [] }, now - 20 * 60000, true, mk({}, {}));
  chk(!J.quote_us.ok && J.quote_us.why === "no_quotes" && !J.fx.ok, "정규장인데 시세 0건 · 환율 20분 → 둘 다 낡음", JSON.stringify(J));
  const sch = S.indexOf("async scheduled(event, env, ctx)");
  chk(S.indexOf("await dataHealthRun(env)", sch) > 0 && S.indexOf("await dataHealthRun(env)", sch) < S.indexOf("await runTradingCycle(env)", sch), "감시·복구가 거래 사이클 앞에서 매분");
  chk(/getState\(DB, "data_health", null, true\)/.test(S) && /DATA_HEAL_GAP_MS = 2 \* 60000/.test(S) && /refreshPriceShard\(env, m, sh\)[\s\S]{0,200}다시 받음/.test(S), "엄격 읽기 · 2분 안에 같은 복구 반복 안 함 · 시세 복구 = 가격 샤드 전부");
  chk(/"\/api\/macro": 1800000/.test(S) && /"\/api\/fx": 600000/.test(S) && /fxAge > 3 \* 60 \* 1000/.test(S), "경제지표·환율 캐시 사본은 30분·10분까지만 · 환율은 3분마다");
}
console.log("⑤ 미국 데이마켓 · 네이버 해외주식 2차 원천 · 서머타임(V33.629)");
{
  // 서머타임 경계 — 2026-11-01 02:00 EDT(06:00Z) 에 EST 로, 2027-03-14 02:00 EST(07:00Z) 에 EDT 로
  const off = (iso) => M.getUSEtOffset(new RealDate(iso));
  chk(off("2026-10-16T00:00:00Z") === -4 && off("2026-11-01T05:59:00Z") === -4 && off("2026-11-01T06:00:00Z") === -5 && off("2026-12-15T12:00:00Z") === -5
      && off("2027-03-14T06:59:00Z") === -5 && off("2027-03-14T07:00:00Z") === -4, "서머타임 경계(11/1 06:00Z · 3/14 07:00Z) 분 단위 정확");
  const et = (iso) => { const t = M.getUSEt(new RealDate(iso)); return t.totalMin + "@" + t.day; };
  chk(et("2026-10-16T00:00:00Z") === "1200@4" && et("2026-12-16T01:00:00Z") === "1200@2", "ET 시각: 여름 00:00Z = 목 20:00 · 겨울 01:00Z = 화 20:00");
  // 애프터마켓 = 16:00~20:00 ET (네이버 afterMarketClosingTime 20:00-04:00 · 야후 post.end 00:00Z 실측과 같다)
  chk(M.marketSessionNow("us", new RealDate("2026-10-15T23:17:00Z")) === "POST" && M.marketSessionNow("us", new RealDate("2026-10-16T00:01:00Z")) !== "POST"
      && M.marketSessionNow("us", new RealDate("2026-11-20T00:30:00Z")) === "POST" && M.marketSessionNow("us", new RealDate("2026-11-20T01:01:00Z")) !== "POST", "애프터마켓: 여름 19:17 ET 열림 · 20:01 ET 닫힘 · 겨울 19:30 EST(00:30Z) 열림 · 20:01 EST(01:01Z) 닫힘");
  // 데이마켓(야간) 창 — 일~목 20:00~24:00 · 월~금 00:00~04:00 ET
  const ov = (iso) => M.usOvernightNow(new RealDate(iso));
  chk(ov("2026-10-16T00:30:00Z") && ov("2026-10-16T07:59:00Z") && !ov("2026-10-16T08:00:00Z") && !ov("2026-10-15T23:30:00Z")
      && !ov("2026-10-17T01:00:00Z") && ov("2026-10-19T00:30:00Z") && ov("2026-12-16T08:59:00Z") && !ov("2026-12-16T09:00:00Z"),
      "데이마켓 창: 목 20:30 ET 열림 · 04:00 ET 닫힘 · 금요일 밤 없음 · 일요일 밤 열림 · 겨울도 04:00 ET(09:00Z)");
  const now = new RealDate("2026-10-16T01:00:00Z").getTime();   // 목 21:00 ET
  const x = (st, px, at) => ({ reutersCode: "AAPL.O", closePrice: "342.00", marketStatus: "CLOSE", overMarketPriceInfo: { tradingSessionType: st, overMarketStatus: "OPEN", overPrice: px, localTradedAt: at, tradeStopType: { code: "1" } } });
  let p = M.nvUsParse(x("DAY_MARKET", "343.10", "2026-10-15T20:58:00-04:00"), now);
  chk(p && p.sess === "ovn" && p.px === 343.1 && p.close === 342, "야간 체결(21:58 ET) → 데이마켓 343.10 · 기준 정규 종가 342", JSON.stringify(p));
  p = M.nvUsParse(x("AFTER_MARKET", "341.20", "2026-10-15T19:21:54-04:00"), now);
  chk(p && p.sess === null && p.px === null, "38분 묵은 애프터 체결은 지금 값으로 안 쓴다(지어내지 않음)", JSON.stringify(p));
  p = M.nvUsParse(x("AFTER_MARKET", "341.20", "2026-10-15T19:21:54-04:00"), new RealDate("2026-10-15T23:25:00Z").getTime());
  chk(p && p.sess === "post" && p.px === 341.2, "신선한 애프터 체결 → post(2차 원천)", JSON.stringify(p));
  p = M.nvUsParse(x("DAY_MARKET", "343.10", "2026-10-15 20:58"), now);
  chk(p && p.px === null, "시각에 시간대가 없으면 안 쓴다", JSON.stringify(p));
  chk(JSON.stringify(M.nvUsCandidates("BRK-B")) === '["BRK-B.O","BRK-B","BRK-B.K","BRKb"]' && M.nvUsCandidates("AAPL")[0] === "AAPL.O" && M.nvUsCandidates("^GSPC").length === 0,
      "네이버 코드 후보: 나스닥 .O · NYSE 그대로 · Arca .K · 클래스주 BRKb · 지수 제외");
  const sch = S.indexOf("async scheduled(event, env, ctx)");
  chk(S.indexOf("await usNaverSweep(env, null)", sch) > 0 && S.indexOf("await usNaverSweep(env, null)", sch) < S.indexOf("await runTradingCycle(env)", sch)
      && /getState\(env\.DB, "us_ovn_at", null, true\)/.test(S), "데이마켓 수집은 야간 창에서 거래 사이클 앞 · 2분 스로틀(엄격 읽기)");
  const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  chk(/kind === 'day'\) return '데이마켓'/.test(H) && /wl-ext-tag day/.test(H) && /Date\.now\(\) - q\.ovnTs < 20 \* 60000/.test(H), "화면: '데이마켓' 이름표 · 20분 넘은 값은 머리글·카드에 안 띄움");
}
console.log("⑥ TOP MOVERS 장전(V33.630) — V33.627 부작용(한국 전 종목 0%) 재발 방지");
{
  const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const a = H.indexOf("function mvExt(q)"), b = H.indexOf("function collectMovers(mkt, requireFresh)");
  chk(a > 0 && b > a, "mvExt 정의");
  const W = new Function(H.slice(a, b) + "; return { mvPct, mvPx, mvExt };")();
  const pre = { mstate: "PRE", regPct: 0, regPrice: 210000, price: 217500, pre: 217500, prePct: 3.57 }, reg = { mstate: "REGULAR", regPct: -1.2, regPrice: 98, price: 98 }, postq = { mstate: "POST", regPct: 7.8, regPrice: 13.13, post: 13.2, postPct: 0.5 };
  chk(W.mvPct(pre) === 3.57 && W.mvPx(pre) === 217500 && W.mvExt(pre), "장전·정규 등락 0 → 장전 등락·가격(이름표)");
  chk(W.mvPct(reg) === -1.2 && W.mvPct(postq) === 7.8 && !W.mvExt(postq), "정규장·장후는 정규 등락 그대로(V33.422)");
  chk(/if \(q\.mstate === 'PRE' && mvPct\(q\) === 0 && !mvExt\(q\)\) return null;/.test(H), "장전 체결 없는 0% 는 표에서 뺀다");
}
if (fails) { console.log("\n✗ 시간외 실시간 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 시간외 실시간 통과");
