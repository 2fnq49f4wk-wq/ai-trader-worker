/* [V33.598] ★경제지표 — 발표일·다음 발표일·BLS 공식 API★ (사용자 10/15: "CPI 어제 발표했는데 75일 전 · 옛 데이터 · 다음 발표일 틀림")
 *   ① 일정표: 9월 CPI(10/14 발표) 를 받았으면 발표일 10/14 · 다음 11/10 · 아직 8월분이면 lagging(발표일 비움)
 *   ② BLS 응답 파싱(M13 연평균 제외 · 오름차순) → 전년동월비
 *   ③ 화면: 셋째 칸 = 발표일(released 우선) · 다음 발표일 = 서버 일정표 · 발표일엔 12:35Z 뒤 재시도 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const now = Date.parse("2026-10-15T00:30:00Z");   // 미국 10/14 저녁 · 한국 10/15 아침
let r = M.macroSchedOf("us", "cpi", { obsDate: "2026-09-01" }, now);
chk(r && r.released === "2026-10-14" && r.next === "2026-11-10" && !r.lagging, "9월분이면 발표일 10/14 · 다음 11/10", JSON.stringify(r));
r = M.macroSchedOf("us", "cpi", { obsDate: "2026-08-01" }, now);
chk(r && r.released === null && r.lagging === true && r.next === "2026-11-10", "아직 8월분이면 발표일을 붙이지 않고 lagging", JSON.stringify(r));
r = M.macroSchedOf("us", "core_pce", { obsDate: "2026-08-01" }, now);
chk(r && r.released === "2026-09-30" && r.next === "2026-10-29" && !r.lagging, "근원 PCE 8월분 → 9/30 발표 · 다음 10/29", JSON.stringify(r));
r = M.macroSchedOf("kr", "base_rate", { obsDate: "2026-08-27" }, now);
chk(r && r.next === "2026-10-22", "한국 금통위 다음 10/22", JSON.stringify(r));
r = M.macroSchedOf("kr", "cpi", { obsDate: "2026-09-01", released: "2026-10-02" }, now);
chk(r && r.est === true && r.next === "2026-11-02" && r.released === "2026-10-02", "한국 CPI 다음은 '다음 달 첫 평일(예상)'", JSON.stringify(r));
const B = M._blsParse({ Results: { series: [{ seriesID: "X", data: [{ year: "2026", period: "M13", value: "1" }, { year: "2026", period: "M09", value: "110" }, { year: "2025", period: "M09", value: "100" }] }] } });
chk(B.X && B.X.length === 2 && B.X[0].d === "2025-09-01" && B.X[1].d === "2026-09-01", "BLS 파싱 — M13 제외 · 오름차순");
chk(/const _blsOk = \{\};/.test(S) && /if \(mk === "us" && _blsOk\[key\]\) continue;/.test(S), "BLS 1순위 · 받은 지표는 FRED 건너뜀");
chk(/_relToday && _hUtc >= 12\.58/.test(S) && /runFredMacroUpdate\(env\.DB, true\)/.test(S), "발표일 12:35Z 뒤 새 발표분을 못 받았으면 20분마다 재시도");
chk(/var obs = r\.released \|\| r\.obsDate \|\| null;/.test(H) && /<th>발표일<\/th>/.test(H) && /r\.autoSched/.test(H), "화면: 발표일 칸 · 서버 일정표의 다음 발표일");
if (fails) { console.log("check-macro-sched: FAIL " + fails); process.exit(1); }
console.log("check-macro-sched: ok");
