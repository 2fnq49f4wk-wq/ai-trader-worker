#!/usr/bin/env node
/* [위상 안전장치] ★지수 위상 안전장치 — 하락장 반등일을 폭등(MELTUP)으로 읽지 않는다★
   11/10 사고(라이브 /api/ai-mode): 한국 위상 MELTUP · 정식 국면 원천 'phase:MELTUP(+2 ×1.4)' 인데 같은 표의 추세는 'MA50 −17.1%'.
     입력은 맞았다 — 코스피 +4.5% · 코스닥 +3.8%(네이버·/api/chart 같은 값) 하루 반등. 틀린 것은 분기:
     'today ≥ +2% → MELTUP' 이 5일 −6.6% · 20일 −17% · MA50 −17% · 60일 고점 −26% 를 전혀 보지 않았다.
     美 11/9 도 같은 분기(4지수 평균 +2.6% · 20일 음수 · 나스닥 MA50 −4.5%) → MELTUP.
   이 게이트는 ★진짜 analyzeMarketRegime★(src/index.js 에서 그대로 떼어 옴 · getState 만 가짜)에 11/10 지수 종가 60봉을 넣어 확인한다:
     ① 韓 11/10 → MELTUP·TREND_UP 아님(반등일 = RANGE) · raw 는 MELTUP(분기 자체는 남고 안전장치가 고친다)
     ② 美 11/9 → MELTUP 아님(20일 음수)
     ③ 진짜 폭등(MA50 위·20일 양수·오늘 +2.5%)은 여전히 MELTUP · 진짜 폭락은 CRASH
     ④ 정식 국면: MA50 −5% 아래 또는 20일 음수면 SURGE 불가
     ⑤ 평가 도구가 같은 regimePhase 를 쓴다(식 복제 금지 — 복제가 갈라지면 평가가 거짓이 된다) · 화면이 안전장치 표시 */
import { readFileSync } from "node:fs";
const R = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const S = R("src/index.js"), EV = R("tools/eval-regime-canon.mjs"), UI = R("public/index.html");
function grab(name) {
  const i = S.search(new RegExp("^(const|async function|function) " + name + "\\b", "m")); if (i < 0) throw new Error("없음 " + name);
  const isConst = S.slice(i, i + 6) === "const ";
  if (isConst && !/^const [A-Za-z_]+ = \{/.test(S.slice(i, i + 80))) return S.slice(i, S.indexOf(";", i) + 1);
  let j = S.indexOf("{", isConst ? i : S.indexOf(")", i)), d = 0;
  for (; j < S.length; j++) { if (S[j] === "{") d++; else if (S[j] === "}") { d--; if (!d) break; } }
  return S.slice(i, j + 1) + (isConst ? ";" : "");
}
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
/* 11/10 12:07 KST 지수 종가 60봉(/api/chart range=3mo · 마지막 = 장중 현재가) — 韓 ^KS11·^KQ11 · 美 4지수(11/9 종가) */
const FIX = {"^KS11": [6579.04, 6813.34, 6977.94, 6869.83, 6471.17, 6852.58, 6912.95, 6696.96, 6742.74, 6808.21, 6912.37, 6788.88, 6820.02, 6835.8, 6562.72, 6579.48, 6687.21, 6995.39, 6954.52, 7051.64, 7033.92, 6909.91, 6684.37, 6627.26, 6717.97, 6715.41, 6894.23, 7007.72, 7017.91, 7080.92, 6889.74, 6870.81, 6838.04, 6971.35, 7003.74, 6941.39, 6803.9, 6625.93, 6384.24, 6035.35, 6008.81, 5554.22, 5668.05, 5768.01, 5552.74, 5735.66, 5533.77, 5550.3, 5469.47, 5638.34, 6012.44, 5937.66, 5730.74, 5859.08, 5648.79, 5683.8, 5383.8, 5059.69, 5018.85, 5241.67], "^KQ11": [858.91, 861.37, 864.65, 834.2, 824.46, 840.89, 801.94, 813.33, 827.15, 826.87, 837.65, 838.41, 834.29, 821.25, 803.98, 790.21, 813.5, 822.19, 811.88, 830.37, 836.92, 820.64, 806.79, 812.41, 815.98, 822.18, 827.12, 836.27, 834.38, 844.48, 846.58, 849.8, 855.91, 894.29, 893.29, 919.92, 898.43, 892.27, 849.19, 837.03, 823.88, 760.82, 794.78, 808.89, 781.97, 792.76, 764.1, 751.69, 727.21, 743.83, 771.28, 753.23, 724.38, 734.36, 704.39, 714.95, 678.41, 644.27, 638.97, 663.26], "^IXIC": [26644.91, 26289.71, 26331.09, 26067.17, 26180.46, 25980.19, 26151.3, 26130.2, 26541.35, 26402.42, 26370.89, 26099.77, 26217.83, 26584.06, 26506.99, 26421.41, 26253.34, 26081.72, 26333.04, 26186.41, 25981.57, 25978.43, 26418.3, 26522.54, 27122.09, 27244.28, 26936.04, 26939.37, 27068.72, 26820.38, 26797.54, 26861.06, 26871.6, 27190.86, 27477.31, 27599.79, 27538.69, 27193.34, 27366.17, 27245.9, 27204.38, 26692.87, 26713.03, 26140.03, 26430.89, 26424.82, 26702.86, 26008.86, 25955.34, 26169.38, 26477.81, 26549.85, 26184.72, 25437, 25164.31, 25372.01, 25736.51, 24315, 24579.43, 25253.14], "^DJI": [53459.78, 53343.4, 53463.05, 52759.21, 53277.01, 53417.16, 53577.4, 53463.88, 53569.44, 53559.99, 53185.9, 52766.88, 53061.95, 53686.11, 53414.25, 52786.07, 52380.66, 52064.1, 52573.29, 52421.2, 52093.11, 51461.9, 51778.04, 51682.64, 52048.83, 51863.69, 51511.59, 51349.98, 51828.62, 51481.51, 51349.92, 50906.05, 50926.56, 51176.96, 51267.9, 51521.28, 51179.87, 51231.64, 51654.95, 51850.55, 51670.1, 51621.48, 52177.69, 52002.41, 51966.03, 52495.88, 52856.09, 52867.98, 52215.16, 52361.58, 52377.57, 52475.1, 52342.56, 51770.31, 51983.98, 51786.72, 53356.12, 51523.06, 51285.73, 52389.75], "^GSPC": [7745.06, 7691.76, 7707.98, 7641.16, 7674.37, 7652.86, 7677.28, 7675.7, 7730.99, 7711.76, 7686.14, 7631.47, 7666.6, 7747.71, 7718.6, 7673.52, 7636.36, 7591.7, 7656.98, 7619.98, 7585.73, 7551.81, 7637.76, 7650.5, 7764.7, 7764.64, 7706.03, 7704.13, 7743.41, 7683.69, 7670.84, 7651.54, 7666.45, 7722.72, 7773.95, 7818.93, 7801.77, 7765.36, 7811.54, 7807.24, 7805.45, 7718.94, 7744.06, 7659.44, 7690.73, 7712.57, 7757.17, 7663.43, 7623.68, 7676.77, 7722.6, 7743.98, 7720.39, 7580.07, 7541.4, 7568.92, 7688.62, 7353.73, 7376.86, 7549.94], "^RUT": [3057.54, 3017.89, 3032.94, 2992.43, 3017.87, 2995.08, 3010.02, 3005.9, 3014.34, 2972.37, 2956.45, 2920.13, 2953.17, 2968.27, 2975.65, 2960.2, 2921.24, 2890.95, 2903.94, 2892.24, 2870.29, 2858.81, 2874.63, 2860.4, 2875.36, 2889.92, 2838.66, 2835.57, 2837.55, 2817.91, 2807.92, 2796.86, 2806.63, 2832.9, 2847.14, 2830.3, 2793.2, 2794.13, 2806.98, 2794.48, 2783.37, 2729.53, 2767.27, 2721.37, 2728.3, 2773.42, 2781.02, 2784.03, 2775.9, 2786.42, 2818.87, 2830.51, 2859.22, 2811.84, 2805.88, 2812.45, 2856.95, 2729.89, 2754.11, 2840.81]};
const lib = new Function("STATE", ["function _num(v,d){v=Number(v);return isFinite(v)?v:d;}",
  "async function getState(DB, k, d){ return STATE[k] != null ? STATE[k] : d; }",
  grab("US_INDICES"), grab("KR_INDICES"), grab("getMA"), grab("getNDayReturn"),
  grab("REGIME_CANON_RANK"), grab("REGIME_CANON_KO"), grab("REGIME_CANON_CFG"), grab("regimeFeat"), grab("regimeCanon"), grab("regimePhase"), grab("analyzeMarketRegime"),
  "return { analyzeMarketRegime, regimePhase, regimeCanon };"].join("\n"));
const st = (h) => ({ price: h[h.length - 1], prevClose: h[h.length - 2], dayPct: (h[h.length - 1] / h[h.length - 2] - 1) * 100, history: h });
const STATE = {}; for (const k in FIX) STATE["index:" + k] = st(FIX[k]);
const L = lib(STATE);
const kr = await L.analyzeMarketRegime(null, "kr"), us = await L.analyzeMarketRegime(null, "us");
const line = (nm, r) => "  " + nm + ": 오늘 " + r.avgDayPct.toFixed(2) + "% · 5일 " + r.idxReturn5 + "% · 20일 " + r.feat.r20 + "% · MA50 " + r.feat.vs50 + "% · 60일 고점 " + r.feat.dd60 + "% → 옛 " + r.phaseRaw + " ⇒ " + r.phase + (r.phaseGuard ? " (" + r.phaseGuard + ")" : "");
console.log(line("韓 11/10", kr)); console.log(line("美 11/9 ", us));
chk(kr.avgDayPct > 3.5 && kr.feat.vs50 < -15 && kr.idxReturn5 < 0, "韓 11/10 재현 자료(오늘 +4%대 · MA50 −15% 아래 · 5일 음수)", "★재현 자료가 11/10 과 다르다★");
chk(kr.phaseRaw === "MELTUP" && us.phaseRaw === "MELTUP", "옛 분기는 韓·美 모두 MELTUP(버그 재현)", "★재현 실패 — 옛 분기가 MELTUP 이 아니다★");
chk(kr.phase !== "MELTUP" && kr.phase !== "TREND_UP", "韓 11/10 하락장 반등일 → " + kr.phase + "(폭등·상승추세 아님)", "★韓 하락장 반등일을 " + kr.phase + " 로 읽는다(MA50 " + kr.feat.vs50 + "%)★");
chk(us.phase !== "MELTUP", "美 11/9 → " + us.phase + "(20일 음수 · 폭등 아님)", "★美 20일 음수인데 MELTUP★");
const P = (o) => L.regimePhase(o).phase;
chk(P({ worst: 1.8, today: 2.5, r5: 4, r20: 5, er: 0.3, above: 4, below: 0, vs50: 4 }) === "MELTUP", "진짜 폭등(MA50 위 · 20일 +5%)은 MELTUP 유지", "★진짜 폭등을 못 잡는다★");
chk(P({ worst: -3.1, today: -2.6, r5: -5, r20: -6, er: 0.3, above: 0, below: 4, vs50: -6 }) === "CRASH", "진짜 폭락은 CRASH", "★폭락을 못 잡는다★");
chk(P({ worst: 1, today: 2.2, r5: 1, r20: -1, er: 0.2, above: 2, below: 2, vs50: -2 }) === "TREND_UP", "20일 음수 + 오늘 +2% → TREND_UP(폭등 아님)", "★20일 음수 MELTUP★");
chk(P({ worst: 1, today: 2.2, r5: 1, r20: 2, er: 0.2, above: 2, below: 2, vs50: -7 }) === "TREND_UP", "MA50 −7% · 5일 양수 → TREND_UP", "★MA50 −5% 아래 MELTUP★");
chk(P({ worst: 1, today: 1.2, r5: -3, r20: -9, er: 0.3, above: 0, below: 2, vs50: -9 }) === "RANGE", "하락장(MA50 −9% · 5일 음수) 반등일 +1.2% → RANGE", "★하락장 반등일을 상승추세로 읽는다★");
chk(P({ worst: 1, today: 2.2, r5: 4, r20: 3, er: 0.4, above: 2, below: 0, vs50: null }) === "MELTUP", "MA50 모르면(이력 부족) 20일만 본다", "★이력 부족 시 폭등을 막는다★");
const now = Date.now();
const cS = L.regimeCanon("MELTUP", { regime: "SURGE", ts: now }, { regime: "risk_on", ts: now }, { day: 2.5, r5: 3, r20: -1, vs50: 1, s50: 0.5, dd60: -1, rv20: 14 }, { market: "us", now });
chk(cS.canon !== "SURGE", "정식 국면: 20일 음수면 SURGE 불가(→ " + cS.canon + ")", "★정식 국면 20일 음수 SURGE★");
const cS3 = L.regimeCanon("MELTUP", { regime: "SURGE", ts: now }, { regime: "risk_on", ts: now }, { day: 2.5, r5: 3, r20: 2, vs50: -6, s50: 1.5, dd60: -1, rv20: 14 }, { market: "us", now });
chk(cS3.canon !== "SURGE", "정식 국면: MA50 −5% 아래면 SURGE 불가(→ " + cS3.canon + ")", "★정식 국면 MA50 아래 SURGE★");
const cS2 = L.regimeCanon("MELTUP", { regime: "SURGE", ts: now }, { regime: "risk_on", ts: now }, { day: 2.5, r5: 6, r20: 8, vs50: 6, s50: 1.5, dd60: -0.5, rv20: 14 }, { market: "us", now });
chk(cS2.canon === "SURGE", "정식 국면: 추세가 받치는 폭등은 SURGE 유지", "★정식 국면이 진짜 폭등을 막는다(" + cS2.canon + ")★");
chk(/grab\("regimePhase"\)/.test(EV) && /lib\.regimePhase\(/.test(EV) && !/today >= 2 \|\| \(today >= 1 && r5 >= 3\)/.test(EV), "평가 도구가 워커와 같은 regimePhase 사용(식 복제 없음)", "★평가 도구가 위상 식을 따로 복제한다★");
chk(!/_today >= 2 \|\|/.test(S) && (S.match(/today >= 2 \|\| \(today >= 1 && r5 >= 3\)/g) || []).length === 1, "워커 위상 분기는 regimePhase 한 곳", "★위상 분기가 두 곳 이상(갈라질 위험)★");
chk(/guardKr: regimes\.kr\.phaseGuard/.test(S) && /guardKr: _ps\.guardKr/.test(S) && /ph\.guardKr/.test(UI), "mkt_phase → /api/ai-mode → 화면 '오늘 지수 흐름' 에 안전장치 표시", "★안전장치가 화면까지 안 이어졌다★");
if (fails) { console.log("FAIL " + fails); process.exit(1); }
console.log("지수 위상 안전장치 통과");
