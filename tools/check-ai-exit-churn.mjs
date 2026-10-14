/* [V33.589] ★AI 청산 왕복(산 지 1~3분 만에 같은 AI 가 파는 것) 회귀 방지★
 *   원장(10/14): AI_EXIT 41건 중 10건이 진입 1~3분 뒤 · 9/11 120110.KS 20분에 4회 왕복 · 미국 IQV 3분 만에 청산.
 *   ① 최소 보유(AI_PARAMS.exit.minHoldHours) 안에는 위원회 청산 판정을 건너뛴다(OMNI-Q 관리 제외 조건과 한 줄)
 *   ② 청산 블렌드가 진입과 같은 실측 계수(__blendK)를 받는다
 *   ③ 위원회 청산(AI_EXIT · AI_ROTATE) 뒤 재진입 쿨다운 — 손익 부호와 무관 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };

const ex = S.slice(S.indexOf("committeeExitProb: 0.42,"), S.indexOf("committeeExitProb: 0.42,") + 2000);
const mh = /minHoldHours:\s*(\d+)/.exec(ex);
chk(mh && Number(mh[1]) >= 24, "AI_PARAMS.exit.minHoldHours ≥ 24 (미리 고정)");
chk(/_xc\.committeeExit && __aiReady && !_omqHeld && daily && Array\.isArray\(daily\.closes\) && daily\.closes\.length >= 60\s*\n\s*&& !\(_num\(_xc\.minHoldHours, 0\) > 0 && held\.opened_ts && \(Date\.now\(\) - held\.opened_ts\) < _num\(_xc\.minHoldHours, 0\) \* 3600000\)\) \{/.test(S),
    "최소 보유 전엔 AI_EXIT · AI_ROTATE 판정 자체를 안 한다(위원회 호출 비용도 0)");
chk(/_exitP = _luxDecisionBlend\(_mdx\.p, _tkx\.tech, _nsx, AI_PARAMS\.decisionCore, _kbx\);/.test(S) && /let _kbx = __blendK;/.test(S),
    "청산 블렌드가 진입과 같은 계수(__blendK · 소셜)를 쓴다");
chk(/const _aiExitCd = !!\(reason && \(reason\.startsWith\("AI_EXIT"\) \|\| reason\.startsWith\("AI_ROTATE"\)\)\);/.test(S)
    && /if \(fullClose && reason && \(_aiExitCd \|\| \(pnlPct < 0 && /.test(S),
    "위원회 청산 뒤엔 손익과 무관하게 재진입 쿨다운");
// 쿨다운이 실제로 매수 차단에 쓰인다
chk(/ctx\.cooldowns\.has\(ctx\.symbol\)\) return "REENTRY_COOLDOWN"/.test(S) && /cooldowns: activeCooldowns,/.test(S), "쿨다운이 매수 차단(REENTRY_COOLDOWN)으로 이어진다");

/* [V33.589 · 사용자 결정 "둘 다 수정"] 사이징 관문이 실제 값을 본다
 *   ④ 고점 키(equity_peak:)를 숫자 한 모양으로 — {v,ts} 덮어쓰기가 매 사이클 낙폭을 0 으로 지웠다(실행 검사)
 *   ⑤ DDRISK = 실제 계좌 낙폭 · 양방향(톱니 아님)  ⑥ LOSS_STREAK = 최근 windowDays 안의 매도만 */
import vm from "node:vm";
{
  const a = S.indexOf("function _eqPeakVal(v) {"), b = S.indexOf("\n// 드로다운 단계 판정", a);
  chk(a > 0 && b > a, "_eqPeakVal · updateEquityPeak 를 찾았다");
  if (a > 0 && b > a) {
    const store = { "equity_peak:kr": { v: 120, ts: 1 } };
    const ctx = { Date, Math, isFinite, store,
      getState: async (DB, k, d) => (k in store ? store[k] : d), setState: async (DB, k, v) => { store[k] = v; } };
    vm.createContext(ctx);
    vm.runInContext(S.slice(a, b) + "\nglobalThis.up = updateEquityPeak; globalThis.dl = __ddLast;", ctx);
    const r1 = await ctx.up(null, "kr", 100);       // 옛 {v:120} → 고점 120 유지 · 숫자로 고쳐 적음 · 낙폭 16.7%
    const r2 = await ctx.up(null, "kr", 110);       // 숫자 고점 유지
    const r3 = await ctx.up(null, "kr", 130);       // 새 고점
    chk(Math.abs(r1.ddPct - 16.667) < 0.01 && store["equity_peak:kr"] !== undefined && Math.abs(r2.ddPct - 8.333) < 0.01
        && r3.ddPct === 0 && store["equity_peak:kr"] === 130 && ctx.dl.kr && ctx.dl.kr.dd === 0,
        "고점은 두 모양 다 읽고 숫자로만 쓴다 · 낙폭이 실제로 쌓인다", JSON.stringify({ r1, r2, r3, st: store["equity_peak:kr"] }));
  }
  chk(!/setState\(DB, "equity_peak:" \+ market, \{ v:/.test(S), "{v,ts} 모양으로 고점을 쓰는 곳이 없다");
  const dd = S.slice(S.indexOf("const ddrCfg = v13.drawdownRisk;"), S.indexOf("const ddrCfg = v13.drawdownRisk;") + 1800);
  chk(/const _ddl = __ddLast\[market\];/.test(dd) && !/mtSells\.slice\(0, 10\)/.test(dd) && /Math\.abs\(nr - rb\) >= 0\.01/.test(dd),
      "DDRISK 가 실제 낙폭을 쓰고 위아래 양방향으로 맞춘다(거래 손익% 합 근사 삭제)");
  chk(/AND side = 'SELL' AND ts > \? ORDER BY ts DESC LIMIT \?"\s*\)\.bind\(market, Date\.now\(\) - _num\(lsCfg\.windowDays, 30\) \* 86400000, lsCfg\.lookbackTrades\)/.test(S)
      && /windowDays: 30/.test(S), "LOSS_STREAK 는 최근 30일 매도만 센다");
}

if (fails) { console.log("check-ai-exit-churn: FAIL " + fails); process.exit(1); }
console.log("check-ai-exit-churn: ok");
