/* [V33.504] ★종목상세 — 시세 통계 · 기업 개요★ (사용자: "종목상세에서 더 많은 주식 데이터")
   ① 일봉 통계(외부 조회 0): 52주 고저·위치 · 고점/저점 대비 · 연초 대비 · 20일 변동성 · 1년 최대낙폭 · 거래량 · 베타(날짜 맞춤)
   ② 기업 개요 파싱 — 러너 실측(10/06) 응답 그대로: 나스닥 summary(AAPL) · 네이버 integration(005930) · 'N/A' 버림
   ③ 배선: 라우트 · 마이크로 캐시 · 화면 섹션·로더 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
console.log("① 일봉 통계");
const n = 300, d0 = Math.floor(Date.UTC(new Date().getUTCFullYear(), 0, 1) / 86400000) - 100;
const days = [], C = [], Hh = [], L = [], V = [], ic = [];
for (let i = 0; i < n; i++) { days.push(d0 + i); const c = 100 + 20 * Math.sin(i / 30) + i * 0.05; C.push(c); Hh.push(c * 1.01); L.push(c * 0.99); V.push(1e6 + (i % 7) * 1e5); }
let x = 100; for (let i = 0; i < n; i++) { x *= 1 + (i > 0 ? (C[i] / C[i - 1] - 1) * 0.5 : 0); ic.push(x); }
const st = M.stockStatsFromDaily({ closes: C, highs: Hh, lows: L, volumes: V, days: days }, null, { closes: ic, days: days });
const w = C.slice(n - 252), hi = Math.max(...Hh.slice(n - 252)), lo = Math.min(...L.slice(n - 252));
chk(st && Math.abs(st.hi52 - +hi.toFixed(4)) < 1e-6 && Math.abs(st.lo52 - +lo.toFixed(4)) < 1e-6 && st.bars === 252, "52주 = 최근 252봉 고가 최대·저가 최소", "52주 " + JSON.stringify(st && [st.hi52, st.lo52]));
const px = C[n - 1];
chk(Math.abs(st.pos52 - +(((px - lo) / (hi - lo)) * 100).toFixed(1)) < 1e-9 && Math.abs(st.fromHi52 - +(((px - hi) / hi) * 100).toFixed(2)) < 1e-9, "위치·고점 대비", "pos " + st.pos52);
const k = days.findIndex((dd) => dd >= d0 + 100) - 1;
chk(Math.abs(st.ytd - +(((px - C[k]) / C[k]) * 100).toFixed(2)) < 1e-9, "연초 대비 = 올해 첫 봉 직전 종가 기준", "ytd " + st.ytd);
chk(st.beta != null && Math.abs(st.beta - 2) < 0.05 && st.corr > 0.99, "베타 — 지수 수익의 정확히 2배로 만든 종목 → 2.0", "beta " + st.beta);
chk(st.mdd1y < 0 && st.vol20 > 0 && st.avgVol20 > 0 && st.volRatio > 0, "낙폭·변동성·거래량 칸", "기타 " + JSON.stringify(st));
chk(M.stockStatsFromDaily({ closes: C.slice(0, 10) }, null, null) === null, "봉 20개 미만이면 null(지어내지 않는다)", "짧은 이력");
const nodays = M.stockStatsFromDaily({ closes: C, highs: Hh, lows: L, volumes: V }, null, { closes: ic, days: days });
chk(nodays && nodays.ytd === undefined && nodays.beta === undefined, "봉 날짜가 없으면 연초 대비·베타를 안 낸다", "날짜 없음");
console.log("② 기업 개요 파싱(실측 응답)");
const nq = M.parseNqSummary({ data: { summaryData: { Exchange: { value: "NASDAQ-GS" }, Sector: { value: "Technology" }, Industry: { value: "Computer Manufacturing" }, OneYrTarget: { value: "$335.00" },
  Yield: { value: "0.32%" }, ExDividendDate: { value: "Aug 10, 2026" }, SpecialDividendDate: { value: "N/A" } } } });
chk(nq && nq.facts.map((f) => f.l).join(",") === "거래소,섹터,업종,1년 목표가(나스닥),배당수익률,배당락일", "나스닥 summary → 한글 이름표", "nq " + JSON.stringify(nq));
chk(M.parseNqSummary({ data: { summaryData: { Sector: { value: "N/A" } } } }) === null, "'N/A' 만 있으면 null", "N/A");
const nv = M.parseNvIntegration({ description: "삼성전자는  반도체를 만든다.", totalInfos: [{ code: "per", key: "PER", value: "12.20배", valueDesc: "2026.06." }, { code: "foreignRate", key: "외인소진율", value: "46.37%" }, { code: "cnsPer", key: "추정PER", value: "5.81배" }] });
chk(nv && nv.facts[0].v === "12.20배 (2026.06)" && nv.facts.some((f) => f.l === "외국인 소진율" && f.v === "46.37%") && nv.about === "삼성전자는 반도체를 만든다.", "네이버 종목분석 → PER(기준월) · 외국인 소진율 · 회사 소개", "nv " + JSON.stringify(nv));
console.log("③ 배선");
chk(/if \(path === "\/api\/stock-profile"\)/.test(S) && /"\/api\/stock-profile": 300000/.test(S), "라우트 · 마이크로 캐시 5분", "라우트");
chk(/const bench = market === "kr" \? "069500\.KS" : "SPY";/.test(S), "베타 기준 = 코스피200 ETF · SPY(유니버스 일봉)", "베타 기준");
chk(/id="detailProfile"/.test(H) && /loadDetailProfile\(\); \/\/ \[V33\.504\]/.test(H) && /function renderDetailProfile\(d\)/.test(H), "종목상세 섹션·로더", "화면");
chk(/escapeHtml\(String\(f\.l\)\), escapeHtml\(String\(f\.v\)\)/.test(H) && /escapeHtml\(String\(d\.about\)\)/.test(H), "외부 문자열은 escape 해서 그린다", "escape");
if (fails) { console.log("\n✗ 종목상세 확장 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 종목상세 확장 계약 통과");
