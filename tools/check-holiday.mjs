/* [V33.560] ★휴장일 판정★ — 사용자 10/12(월) 08:40 KST: "오늘 한국장 휴장일 아닌데 휴장일로 판단하고 거래 중단".
 *   원인: 지수 신선도 보조 판정이 ★정규장 시작 전★ 에도 돌아, 지수 마지막 거래일(늘 어제 이전) ≠ 오늘 → 매일 프리마켓을 '휴장' 으로 막았다.
 *   ① 장 시작 전엔 지수로 휴장을 판단하지 않는다(가짜 시계로 실제 실행) ② 장중은 종전대로 개장 가정 ③ 장 마감 뒤 지수가 안 바뀌었으면 휴장
 *   ④ 휴장 표: 2026 제헌절 · 대체공휴일 · 음력 명절 · KRX 연말 폐장 — 그리고 평일 정상일(10/12 등)은 들어 있지 않다 */
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const H26 = M.getHolidaySet("kr", 2026), H27 = M.getHolidaySet("kr", 2027);
for (const d of ["2026-10-05", "2026-10-09", "2026-07-17", "2026-12-25", "2026-12-31", "2026-02-17", "2026-09-25", "2026-06-03", "2026-05-25"]) chk(H26.has(d), "2026 휴장 " + d);
for (const d of ["2026-10-12", "2026-10-13", "2026-10-08", "2026-11-02", "2026-12-30"]) chk(!H26.has(d), "2026 개장일 " + d + " 은 휴장 표에 없다");
for (const d of ["2027-07-19", "2027-08-16", "2027-10-04", "2027-10-11", "2027-02-08", "2027-09-15", "2027-12-27", "2027-12-31"]) chk(H27.has(d), "2027 휴장 " + d);
chk(!H27.has("2027-02-09"), "출처가 엇갈리는 날(2027-02-09)은 넣지 않는다");
// 가짜 시계로 지수 신선도 판정을 실제로 돌린다
const RealDate = Date;
const at = (iso) => { const T = new RealDate(iso).getTime(); globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } }; };
const fakeDB = (marketTimeSec) => ({ prepare() { let a = []; const o = { bind(...x) { a = x; return o; }, async first() { return a[0] === "index:^KS11" ? { v: JSON.stringify({ marketTime: marketTimeSec }) } : null; }, async all() { return { results: [] }; }, async run() { return {}; } }; return o; } });
const thu = RealDate.UTC(2026, 9, 8, 6, 30) / 1000;   // 10/8(목) 15:30 KST — 금요일 한글날 휴장 뒤 지수 마지막 봉
try {
  at("2026-10-11T23:40:00Z");   // 10/12(월) 08:40 KST — 프리마켓
  chk(await M._indexFreshOpen(fakeDB(thu), "kr", "2026-10-12") === true, "장 시작 전(08:40 KST) 지수가 목요일이어도 개장(종전: 휴장 → 프리마켓 거래 중단)");
  at("2026-10-12T00:30:00Z");   // 09:30 KST 장중
  chk(await M._indexFreshOpen(fakeDB(thu), "kr", "2026-10-12") === true, "장중 지수 지연이어도 개장 가정(종전 그대로)");
  at("2026-10-12T07:30:00Z");   // 16:30 KST 장 마감 뒤 — 지수가 오늘로 안 바뀌었다면 휴장
  chk(await M._indexFreshOpen(fakeDB(thu), "kr", "2026-10-12") === false, "장 마감 뒤 지수가 안 바뀌었으면 휴장(표에 없는 임시 휴일 대비 · 종전 그대로)");
  at("2026-10-12T07:30:00Z");
  chk(await M._indexFreshOpen(fakeDB(RealDate.UTC(2026, 9, 12, 6, 30) / 1000), "kr", "2026-10-12") === true, "장 마감 뒤 지수가 오늘이면 개장");
} finally { globalThis.Date = RealDate; }
// [V33.565] 미국 반장 표 — NYSE Group 2026~2028 공지: 2026 반장 11/27·12/24 · 2027 반장 11/26 하나(7/2·12/23 은 정상장)
{ const SS = (await import("node:fs")).readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const i = SS.indexOf("const MARKET_HOURS_SPECIAL"), blk = SS.slice(i, SS.indexOf("kr: {", i));
  const days = [...blk.matchAll(/^\s*"(\d{4}-\d{2}-\d{2})":/gm)].map((m) => m[1]);
  chk(JSON.stringify(days) === JSON.stringify(["2026-11-27", "2026-12-24", "2027-11-26"]), "미국 반장 표 = NYSE 공지(2027 은 11/26 하나)", JSON.stringify(days));
  const H27 = M.getHolidaySet("us", 2027);
  chk(["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"].every((d) => H27.has(d)) && H27.size === 10,
      "미국 2027 휴장 10일(NYSE 공지: 7/5 · 12/24 대체 · 6/18 준틴스 대체)", JSON.stringify([...H27].sort()));
  chk(!M.getHolidaySet("us", 2027).has("2027-12-31"), "2028-01-01(토) 은 전날(12/31) 대체휴장 없음 — NYSE 규칙");
}
if (fails) { console.log("\n✗ 휴장일 판정 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 휴장일 판정 통과");
