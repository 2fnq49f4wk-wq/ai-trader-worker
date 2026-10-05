/* [V33.480] ★신호 음수기대 게이트는 시장별★ — 2026-10-05: 한국 AI_PRIMARY 손실이 섞인 통계로 미국 AI 진입(실적 관문 PF 1.34 · 열림)이 꺼졌다.
   ① 통계를 실행해 본다 — 한국은 음수, 미국은 양수로 따로 나온다 · 시장마다 창을 따로 센다 · 멤버 몫
   ② 게이트가 그 시장 키만 본다 · 표본 미달이면 막지 않는다 · 옛 '섞인' 판정이 남아 있지 않다 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const rows = [];
for (let i = 0; i < 40; i++) rows.push({ market: "kr", pnl_pct: i % 3 === 0 ? 2 : -4, reason: "[TREND] STOP #entry=AI_PRIMARY" });
for (let i = 0; i < 40; i++) rows.push({ market: "us", pnl_pct: i % 2 === 0 ? 3 : -1, reason: "[TREND] AI_EXIT #entry=AI_PRIMARY" });
rows.push({ market: "us", pnl_pct: 4, reason: "[TREND] X #entry=HA_REV,VT_TREND" });
const st = M.sigStatsByMarket(rows, 80);
console.log("① 통계");
chk(st["kr:AI_PRIMARY"].count === 40 && st["kr:AI_PRIMARY"].avgPnl < 0 && st["us:AI_PRIMARY"].avgPnl > 0, "한국 음수 · 미국 양수가 따로 나온다", "★시장이 섞였다★ " + JSON.stringify(st));
chk(Math.abs(st["us:HA_REV"].totalPnl - 2) < 1e-9 && st["us:VT_TREND"].count === 1, "여러 신호가 붙은 거래는 몫(1/K)으로", "★멤버 몫이 틀렸다★");
const pooled = rows.reduce((a, r) => a + r.pnl_pct, 0) / rows.length;
console.log("     (섞어 세면 평균 " + pooled.toFixed(2) + "% — 옛 게이트는 미국까지 막았다)");
chk(M.sigStatsByMarket(rows, 10)["kr:AI_PRIMARY"].count === 10, "창은 시장마다 따로", "★창이 시장을 가로질러 잘린다★");
console.log("② 게이트");
chk(M.negExpBlocked(st, "kr", "AI_PRIMARY") === true && M.negExpBlocked(st, "us", "AI_PRIMARY") === false, "한국은 막고 미국은 연다", "★시장별로 판정하지 않는다★");
chk(M.negExpBlocked(st, "us", "HA_REV") === false && M.negExpBlocked({}, "us", "AI_PRIMARY") === false, "표본 30 미달·통계 없음 → 막지 않는다", "★표본 없이 막는다★");
chk(/negExpBlocked\(signalStatsMkt, market, signal\.name\)/.test(S) && !/const _ss = signalStats && signalStats\[signal\.name\];/.test(S), "진입 루프가 시장별 판정을 쓴다 · 섞인 판정 제거", "★진입 루프가 아직 섞인 통계를 본다★");
chk(/setState\(DB, "signal_stats_mkt", sigStatsByMarket\(/.test(S) && /getState\(DB, "signal_stats_mkt", \{\}\)/.test(S), "autoTune 이 시장별 통계를 쓰고 사이클이 읽는다", "★시장별 통계 배선이 없다★");
console.log(fails ? "\n✗ 시장별 신호 게이트 검사 실패 " + fails : "\n✓ 시장별 신호 게이트 검사 통과");
process.exit(fails ? 1 : 0);
