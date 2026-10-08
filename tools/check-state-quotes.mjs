/* [V33.493] ★/api/state 의 시세는 정확해야 한다★ — 운영 탐침(10/06): 배포 직후 새 아이솔레이트가 8.5분 묵은 R2 사본을 줬고
   한국 시간외 시세가 네이버와 최대 1.85% 어긋났다 · 가격이 유효숫자 6자리로 잘렸다(27,477.31 → 27,477.3).
   ① 직렬화: 가격 칸은 소수 4자리까지 그대로 · 나머지 소수는 6자리로 줄인다(용량)
   ② 사본 보정: 묵은 사본에 D1 시세만 새로 끼운다 — 시간외 덮어쓰기(applyDisplayOverMarket) · 기본 칸(이름·시총 주식수) 유지 · 지수
   ③ 배선: R2 사본이 1분보다 묵었을 때만 보정한다(빠른 길) · 직렬화 함수가 한 곳 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 직렬화");
const js = JSON.parse(JSON.stringify({ price: 27477.31, prevClose: 12345.678912, regPrice: 750012.37, dayPct: 1.23456789, rsi: 51.28742146792077, ts: 1759740000000 }, M._stateNumTrim));
chk(js.price === 27477.31 && js.regPrice === 750012.37, "가격은 끝자리까지 남는다(27477.31 · 750012.37)", "가격이 잘렸다 " + JSON.stringify(js));
chk(js.prevClose === 12345.6789, "가격은 소수 4자리로 반올림", "prevClose " + js.prevClose);
chk(js.rsi === 51.2874 && js.dayPct === 1.23457, "나머지 소수는 유효숫자 6자리(용량)", "trim " + JSON.stringify(js));
chk(js.ts === 1759740000000, "정수(시각)는 그대로", "ts " + js.ts);

console.log("② 사본 보정");
const now = Date.now();
const rows = [
  { k: "quote:AAPL", v: JSON.stringify({ market: "us", price: 250.5, prevClose: 248, dayPct: 1.008, ts: now, mstate: "PRE", pre: 252.1, prePct: 0.64 }) },
  { k: "quote:005930.KS", v: JSON.stringify({ market: "kr", price: 272500, prevClose: 276000, dayPct: -1.268, ts: now, mstate: "REGULAR" }) }
];
const DB = { prepare: (sql) => ({ all: async () => ({ results: /quote:/.test(sql) ? rows : [] }), bind: function () { return this; },
  first: async () => null, run: async () => ({}) }) };
const old = { serverTime: now - 9 * 60000, stale: true, cfg: { x: 1 },
  watchlist: [{ symbol: "AAPL", name: "Apple", rank: 3, isEtf: false, market: "us", shares: 15e9, mcap: 3.7e12, price: 240, dayPct: 0.1, ts: now - 9 * 60000 },
              { symbol: "005930.KS", name: "삼성전자", rank: 1, isEtf: false, market: "kr", shares: 5.9e9, mcap: null, price: 270000, ts: now - 9 * 60000 },
              { symbol: "ZZZZ", name: "없음", market: "us", price: null, pending: true }],
  indices: [] };
let patched = null;
try { patched = JSON.parse(await M._patchStateQuotes(DB, JSON.stringify(old))); } catch (e) { console.log("  (오류) " + e.message); }
const A = patched && patched.watchlist.find((w) => w.symbol === "AAPL"), K = patched && patched.watchlist.find((w) => w.symbol === "005930.KS");
chk(K && K.price === 272500 && K.prevClose === 276000 && K.ts === now, "한국 시세가 새 값으로 바뀐다", "한국 " + JSON.stringify(K));
chk(A && A.regPrice === 250.5 && A.price === 252.1 && A.dayPct === 0.64, "미국 장전: 표시값은 시간외 · 정규장 값은 regPrice 로 보존", "미국 " + JSON.stringify(A));
chk(A && A.name === "Apple" && A.shares === 15e9 && A.rank === 3, "이름·순위·주식수(시총 박스)는 유지", "기본 칸 " + JSON.stringify(A));
chk(patched && patched.watchlist.find((w) => w.symbol === "ZZZZ").pending === true, "D1 에 없는 종목은 사본 그대로", "pending 소실");
chk(patched && patched.cfg && patched.cfg.x === 1 && patched.quotesPatched === 2 && patched.quotesAt >= now, "나머지 필드 보존 · quotesAt/quotesPatched 표시", "메타 " + JSON.stringify({ q: patched && patched.quotesPatched }));
chk(patched && patched.marketStatus && typeof patched.marketStatus.us === "boolean" && typeof patched.marketStatus.kr === "boolean",
  "[V33.517] 장 상태(marketStatus)도 다시 잰다 — 개장 전 사본의 kr=false 가 장중에 나가지 않게", "marketStatus " + JSON.stringify(patched && patched.marketStatus));
chk(/st\.marketStatus = _ms;/.test(S) && /getHolidaySet\(mk, parseInt\(td\.slice\(0, 4\), 10\)\)\.has\(td\)/.test(S), "[V33.517] 규칙(시계·공휴일표)으로만 — LLM·지수 조회 없이", "배선");
chk((await M._patchStateQuotes(DB, JSON.stringify({ watchlist: [] }))) === null, "관심종목이 없으면 null(사본 그대로 나간다)", "빈 사본 처리");

console.log("③ 배선");
const at = S.indexOf('const __R2s = (typeof _bigR2 === "function")');
const seg = S.slice(at, at + 6000);
chk(/if \(__rage > 60000\) \{ try \{ const __pb = await _patchStateQuotes\(env\.DB, __body\)/.test(seg), "R2 사본이 1분보다 묵었을 때만 시세를 끼운다", "R2 경로 보정 배선 없음");
chk(/const __numTrim = _stateNumTrim;/.test(S) && !/toPrecision\(6\) : v;\n     \};/.test(S), "상태 직렬화는 한 함수(_stateNumTrim)", "옛 6자리 일괄 절사가 남아 있다");
console.log("④ 한국 장후 마감 꼬리(V33.497)");
const atT = (iso) => new Date(iso);
chk(M.isExtCloseTail("kr", atT("2026-10-06T11:05:00Z")) === true, "화요일 20:05 KST — 가격만 더 받는다(넥스트레이드 20:00 마지막 체결)", "20:05 꼬리 아님");
chk(M.isExtCloseTail("kr", atT("2026-10-06T11:11:00Z")) === false && M.isExtCloseTail("kr", atT("2026-10-06T10:59:00Z")) === false,
  "20:11 은 끝 · 19:59 는 장후 창 자체(꼬리 아님)", "꼬리 범위");
chk(M.isExtendedHoursWindow("kr", atT("2026-10-06T10:59:00Z")) === true && M.isExtendedHoursWindow("kr", atT("2026-10-06T11:05:00Z")) === false,
  "세션 판정(장후 창)은 그대로 20:00 에 닫힌다 — 거래 판정 불변", "장후 창이 바뀌었다");
chk(M.isExtCloseTail("kr", atT("2026-10-10T11:05:00Z")) === false, "토요일엔 없다", "주말 꼬리");
chk(M.isExtCloseTail("us", atT("2026-10-07T00:05:00Z")) === false, "미국은 postTail 이 없다(종전 그대로)", "미국 꼬리");
chk(/const krExtHours = isExtendedHoursWindow\("kr"\) \|\| isExtCloseTail\("kr"\);/.test(S), "사이클의 한국 시세 대상에 꼬리 배선", "배선 없음");
if (fails) { console.log("\n✗ 상태 시세 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 상태 시세 계약 통과");
