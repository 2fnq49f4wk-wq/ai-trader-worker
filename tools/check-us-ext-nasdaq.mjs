/* [V33.502] ★미국 프리·애프터는 나스닥 실시간 체결가 · 둘을 구분해 적는다★
   사용자: "미장은 애프터마켓이랑 프리마켓 가격 정확하게 불러오고 … 둘 다 구분해서 적게".
   종전: 시간외 값은 야후 5분봉을 종목당 1회씩 회전 → 17~26분 묵은 값(운영 탐침).
   ① 파싱 — 러너 실측(2026-10-06 19:24 ET) 응답 그대로: 기준가 = last − netChange (info secondaryData 와 1센트까지 같음)
            previousClosePrice(어긋남)는 쓰지 않는다 · 상태 표기 불일치·지난 세션 체결은 버린다
   ② 합치기 — 정규장 칸은 지어내지 않는다(이번 값 또는 D1) · 애프터에 오늘 저장분이면 종가로 맞춤
   ③ 체결 시각 — 같은 값이 계속 오면 처음 본 시각(얇은 종목이 "방금" 으로 둔갑하지 않게 · 시간외 거래 신선도 7분)
   ④ 배선 — 애프터 시각에 fetchBatchQuotes 가 나스닥 묶음으로 전 종목을 채우고 종목당 분봉 보강을 안 탄다
   ⑤ 화면 — 미국은 프리마켓/애프터마켓, 한국은 장전/장후 시간외 · 카드·상세 같은 함수 */
import { readFileSync } from "node:fs";
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const RealDate = Date;
let FAKE = RealDate.parse("2026-10-06T23:24:48Z");   // 화 19:24 ET — 애프터
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FAKE); } static now() { return FAKE; } };
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const row = (sym, last, chg, st, t) => ({ symbol: sym, lastSalePrice: "$" + last, netChange: (chg >= 0 ? "+" : "") + chg, previousClosePrice: 1,
  marketStatus: st, lastTradeTimestamp: t || "Oct 6, 2026 7:24 PM ET", lastTradeTimestampDateTime: "2026-10-06T19:24:47.96-04:00" });

console.log("① 파싱(실측 응답)");
const J = { data: [row("AAPL", "333.97", 0.34, "After Hours"), row("MSFT", "529.6088", 0.3088, "After Hours"), row("NVDA", "240.3792", 1.1392, "After Hours"),
  row("TSLA", "379.96", -0.72, "After Hours"), row("OLD", "10.00", 0.1, "After Hours", "Oct 5, 2026 7:59 PM ET"), row("PREX", "50", 1, "Pre Market"),
  row("BRK.B", "505.9178", 0.2378, "After Hours")] };
const x = M.parseNasdaqExt(J, ["AAPL", "MSFT", "NVDA", "TSLA", "OLD", "PREX", "BRK-B"], "POST", FAKE);
chk(x.AAPL && Math.abs(x.AAPL.base - 333.63) < 1e-9 && Math.abs(x.MSFT.base - 529.30) < 1e-9 && Math.abs(x.NVDA.base - 239.24) < 1e-9 && Math.abs(x.TSLA.base - 380.68) < 1e-9,
  "기준가 = last − netChange = 오늘 정규장 종가(333.63 · 529.30 · 239.24 · 380.68)", "기준가 " + JSON.stringify(x.AAPL));
chk(Math.abs(x.TSLA.pct - (-0.72 / 380.68 * 100)) < 1e-9 && x.AAPL.last === 333.97, "애프터 등락 = 종가 대비", "pct " + (x.TSLA && x.TSLA.pct));
chk(!x.OLD, "지난 세션(어제 19:59) 체결은 버린다", "어제 값 통과");
chk(!x.PREX, "상태 표기가 지금 세션과 다르면 버린다", "Pre Market 이 애프터로");
chk(x["BRK-B"] && x["BRK-B"].last === 505.9178, "BRK-B ↔ 나스닥 BRK.B 짝짓기", "BRK-B");
chk(x.AAPL.ts === RealDate.parse("2026-10-06T23:24:00Z"), "체결 분(7:24 PM ET) → UTC 23:24", "ts " + new RealDate(x.AAPL.ts).toISOString());
FAKE = RealDate.parse("2026-10-07T08:10:00Z");   // 수 04:10 ET — 프리
const xp = M.parseNasdaqExt({ data: [row("AAPL", "335.10", 1.47, "Pre Market", "Oct 7, 2026 4:09 AM ET"), row("MSFT", "530", 0.7, "Pre Market", "Oct 6, 2026 7:59 PM ET")] }, ["AAPL", "MSFT"], "PRE", FAKE);
chk(xp.AAPL && Math.abs(xp.AAPL.base - 333.63) < 1e-9 && !xp.MSFT, "프리: 기준가 = 직전 종가 · 어제 애프터 체결이 '프리' 로 둔갑하지 않는다", "프리 " + JSON.stringify(xp));
FAKE = RealDate.parse("2026-10-06T23:24:48Z");

console.log("② 합치기 · ③ 체결 시각");
const now = FAKE;
const sqToday = { price: 333.0, prevClose: 332.89, dayPct: 0.03, ts: RealDate.parse("2026-10-06T19:58:00Z"), mstate: "POST", post: 333.97, extTs: now - 9 * 60000 };
const m1 = M.mergeNasdaqExt(null, sqToday, x.AAPL, now);
chk(m1 && m1.price === 333.63 && Math.abs(m1.dayPct - (333.63 - 332.89) / 332.89 * 100) < 1e-9 && m1.prevClose === 332.89,
  "애프터 · 오늘 장중 저장분 → 정규장 가격을 오늘 종가로 맞춘다(전일종가는 그대로)", "m1 " + JSON.stringify(m1));
chk(m1.mstate === "POST" && m1.post === 333.97 && m1.extTs === now - 9 * 60000, "★같은 값이 계속 오면 처음 본 시각을 지킨다(9분 전 → 거래 신선도 밖)★", "extTs " + m1.extTs);
const m2 = M.mergeNasdaqExt(null, Object.assign({}, sqToday, { post: 333.5 }), x.AAPL, now);
chk(m2.extTs === x.AAPL.ts, "값이 바뀌면 새 체결 시각", "m2 " + m2.extTs);
const sqOld = { price: 330, prevClose: 329, dayPct: 0.3, ts: RealDate.parse("2026-10-05T20:00:00Z") };
const m3 = M.mergeNasdaqExt(null, sqOld, x.AAPL, now);
chk(m3.price === 330 && m3.prevClose === 329, "저장분이 오늘 것이 아니면 정규장 칸을 건드리지 않는다(지어내지 않는다)", "m3 " + JSON.stringify(m3));
chk(M.mergeNasdaqExt(null, null, x.AAPL, now) === null, "정규장 칸이 어디에도 없으면 만들지 않는다(종전 폴백이 맡는다)", "빈 합치기");

console.log("④ 배선 — 애프터 시각의 fetchBatchQuotes");
const store = new Map([["quote:AAPL", JSON.stringify(sqOld)], ["quote:MSFT", JSON.stringify({ price: 525, prevClose: 520, dayPct: 0.96, ts: RealDate.parse("2026-10-06T18:00:00Z") })]]);
const DB = { prepare: (sql) => { let a = []; const st = { bind: (...x) => { a = x; return st; },
  first: async () => (/WHERE k = \?/.test(sql) && store.has(a[0])) ? { v: store.get(a[0]) } : null,
  all: async () => ({ results: /WHERE k IN/.test(sql) ? a.filter((k) => store.has(k)).map((k) => ({ k, v: store.get(k) })) : [] }),
  run: async () => { if (/INSERT INTO state/.test(sql)) store.set(a[0], a[1]); return {}; } }; return st; } };
const seen = { nq: 0, other: 0 };
globalThis.fetch = async (u) => {
  u = String(u);
  if (/api\.nasdaq\.com\/api\/quote\/watchlist/.test(u)) { seen.nq++; return new Response(JSON.stringify(J), { status: 200 }); }
  seen.other++; return new Response("no", { status: 404 });
};
M.resetFetchBudget(200);
const bq = await M.fetchBatchQuotes(["AAPL", "MSFT", "ZZZ"], { DB, maxFallback: 3 });
chk(seen.nq === 1, "나스닥 묶음 1회로 시간외 전 종목", "나스닥 호출 " + seen.nq);
chk(bq.AAPL && bq.AAPL.post === 333.97 && bq.AAPL.mstate === "POST" && bq.AAPL.extSrc === "nq" && bq.AAPL.price === 330,
  "AAPL — 애프터 체결가 · 정규장 칸은 D1 저장값", "AAPL " + JSON.stringify(bq.AAPL));
chk(bq.MSFT && bq.MSFT.price === 529.3 && bq.MSFT.post === 529.6088, "MSFT — 오늘 장중 저장분 → 종가 529.30 로 맞춤", "MSFT " + JSON.stringify(bq.MSFT));
const nx = JSON.parse(store.get("nasdaq_ext") || "null");
chk(nx && nx.sess === "POST" && nx.got === 2, "nasdaq_ext 상태 기록(진단용)", "상태 " + store.get("nasdaq_ext"));
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const i145 = S.indexOf("--- 1.45) [V33.502]"), i15 = S.indexOf("--- 1.5) [V33.478]"), i25 = S.indexOf("--- 2.5) [V33.331]");
chk(i145 > 0 && i145 < i15 && i15 < i25, "순서: 나스닥 시간외 → spark → v8 폴백 → 분봉 보강(채운 종목은 뒤를 안 탄다)", "순서 " + [i145, i15, i25]);

console.log("⑤ 화면 이름표");
chk(/function extSessLabel\(market, kind\) \{\s*if \(market === 'us'\) return kind === 'pre' \? '프리마켓' : '애프터마켓';/.test(H), "미국 = 프리마켓 / 애프터마켓", "이름표 함수");
chk(/extSessLabel\(market,'pre'\)/.test(H) && /extSessLabel\(market,'post'\)/.test(H), "관심종목 카드가 이름표 함수를 쓴다", "카드");
chk(/add\(extSessLabel\(st\.market, 'pre'\)/.test(H) && /add\(extSessLabel\(st\.market, 'post'\)/.test(H) && /id="detailExt"/.test(H), "종목상세 행·머리글도 같은 함수", "상세");
chk(!/add\('장전\(시간외\)'/.test(H) && !/extLine='<div class="wl-ext">장후 '/.test(H), "옛 일괄 표기(장전/장후)가 미국에 남지 않는다", "옛 표기 잔존");
if (fails) { console.log("\n✗ 미국 시간외(나스닥) 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 미국 시간외(나스닥) 계약 통과");
