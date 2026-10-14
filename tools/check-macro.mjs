/* [V33.561] ★금융 지표 — 공식 원천 · 날짜까지★ (사용자 10/12: "날짜 업데이트를 안 한다 · 최신 데이터·정확한 수치·날짜")
 *   ① FRED 계산(전년동월비 · 목표범위 · 일별/월별 날짜 표기) ② 한국은행 기준금리 표 · 물가점검 보도자료 · 네이버 국채 파서
 *   ③ 모양이 바뀌면 null(지어내지 않는다 — 이전 값 유지) ④ 내부 금리 프록시가 공식 값(FRED)을 덮지 않는다 ⑤ 화면: 관측일·옛 기준값 표시·지난 발표일 숨김 */
import { readFileSync } from "node:fs";
const M = await import("../src/index.js");
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const cpi = []; for (let y = 2024; y <= 2026; y++) for (let m = 1; m <= 12; m++) { if (y === 2026 && m > 8) break; cpi.push({ d: y + "-" + String(m).padStart(2, "0") + "-01", v: 300 * (1 + 0.03 * ((y - 2024) * 12 + m) / 12) }); }
const y = M._fredValue("yoy", cpi);
chk(y && y.value === "2.9" && y.asOf === "2026-08 (8월분)" && y.obsDate === "2026-08-01", "FRED 물가: 같은 달 12개월 전과 전년동월비 · 기준월", JSON.stringify(y));
chk(JSON.stringify(M._fredValue("range", [{ d: "2026-10-11", v: 3.75 }], [{ d: "2026-10-11", v: 4 }])) === JSON.stringify({ value: "3.75-4.00", asOf: "2026-10-11", obsDate: "2026-10-11" }), "연준 목표범위(하한-상한 · 같은 관측일)");
chk(M._fredValue("level", [{ d: "2026-10-07", v: 5.28 }, { d: "2026-10-08", v: 5.22 }]).asOf === "2026-10-08" && M._fredValue("level", [{ d: "2026-08-01", v: 4.1 }, { d: "2026-09-01", v: 4.2 }]).value === "4.2", "일별은 관측일 · 월별은 원자료 자릿수·기준월");
chk(M._fredValue("yoy", [{ d: "2026-08-01", v: 1 }]) === null && M._fredValue("range", [{ d: "2026-10-11", v: 3.75 }], [{ d: "2026-10-10", v: 4 }]) === null, "12개월 전이 없거나 날짜가 엇갈리면 null(지어내지 않는다)");
const bok = '<tr><td>2026</td><td>08월 27일</td><td>3.00</td></tr><tr><td>2026</td><td>07월 16일</td><td>2.75</td></tr>';
chk(JSON.stringify(M._bokBaseParse(bok)) === JSON.stringify({ value: "3.00", asOf: "2026-08-27 결정", obsDate: "2026-08-27" }) && M._bokBaseParse("<td>x</td>") === null, "한국은행 기준금리 표(가장 최근 결정)");
const main = '<span class="title">2026년 9월 「물가상황점검회의」 개최</span> <span class="txt">소비자물가 상승률은 통신요금 할인에 따른 기저효과가 소멸함에 따라 전월(3.1%)보다 낮아진 2.9%를 나타내었습니다.</span> <span class="date">2026. 10. 02</span>';
const c = M._bokCpiParse(main);
chk(c && c.value === "2.9" && c.asOf === "2026-09 (9월분)" && c.released === "2026-10-02", "한은 물가점검 보도자료: 그 달 값(전월 값이 아니라) · 기준월 · 발표일", JSON.stringify(c));
chk(M._bokCpiParse("소비자물가 상승률은 높다") === null, "문장 모양이 바뀌면 null");
const nb = M._naverBondParse({ result: { closePrice: "3.9940", localTradedAt: "2026-10-08T16:19:01+09:00" } });
chk(nb && nb.value === "3.994" && nb.obsDate === "2026-10-08" && /16:19/.test(nb.asOf) && M._naverBondParse({ result: { closePrice: "99" } }) === null, "네이버 국채(실시간 · 체결 시각) · 범위 밖이면 null");
chk(/if \(!_hasOff\("fed_rate"\)\) setRate\("fed_rate"/.test(S) && /if \(!_hasOff\(k\)\) setRate\(k, v\)/.test(S), "내부 금리 대용(^IRX·^TNX)이 공식 값(FRED·뉴욕연은·재무부)을 덮지 않는다");
// [V33.563] 워커에서 FRED 는 브라우저 UA 를 붙이면 520(운영 실측) — 헤더 없이 보낸다
{ const fb = S.slice(S.indexOf("async function _fredSeries"), S.indexOf("async function _fredSeries") + 400);
  chk(!/User-Agent|_MAC_UA/.test(fb), "FRED 요청에 브라우저 User-Agent 를 붙이지 않는다(붙이면 워커에서 520)"); }
const ny = M._nyfedParse({ refRates: [{ effectiveDate: "2026-10-08", type: "EFFR", percentRate: 3.88, targetRateFrom: 3.75, targetRateTo: 4.00 }] });
chk(ny && ny.value === "3.75-4.00" && ny.obsDate === "2026-10-08" && ny.effr === 3.88 && M._nyfedParse({ refRates: [{}] }) === null, "뉴욕연은 EFFR → 목표범위 3.75-4.00 · 관측일", JSON.stringify(ny));
const tcsv = 'Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"\n10/08/2026,4.14,4.14,4.13,4.23,4.29,4.30,4.44,4.75,4.85,4.99,5.11,5.22,5.64,5.60\n10/09/2026,4.13,4.13,4.13,4.25,4.29,4.32,4.47,4.80,4.89,5.02,5.13,5.24,5.65,5.60';
const tr = M._treasuryParse(tcsv);
chk(tr && tr.obsDate === "2026-10-09" && tr.y10 === 5.24 && tr.y5 === 5.02 && tr.y30 === 5.6 && tr.m3 === 4.25 && M._treasuryParse("x") === null, "재무부 CSV → 가장 늦은 관측일(순서에 기대지 않음) · 5/10/30년", JSON.stringify(tr));
chk(/markets\.newyorkfed\.org\/api\/rates\/unsecured\/effr/.test(S) && /daily-treasury-rates\.csv/.test(S), "대체 사슬 배선: 연준 목표범위(뉴욕연은) · 국채(재무부)");
chk(/_fredStale/.test(S) && /runFredMacroUpdate\(DB, forceRun\)/.test(S), "공식 지표 6시간마다 갱신(스케줄 · 내부 갱신에서)");
chk(/<th>발표일<\/th>/.test(H) && /옛 기준값 — 자동 원천 없음/.test(H) && /function macroNextOf\(r, mkt\)/.test(H) && /FOMC_DATES/.test(H), "화면: 발표일 칸(V33.598) · 자동 원천 없는 값은 '옛 기준값' · 지난 발표일은 숨김 · FOMC 일정");
if (fails) { console.log("\n✗ 금융 지표 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 금융 지표 통과");
