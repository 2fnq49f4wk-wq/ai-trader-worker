// [V33.109] "주석으로만 존재하는 설정" 검출기.
//
//   사용자 지적: 순서 근거가 주석뿐이었듯, ★설정도 주석뿐인 것들이 있다★.
//   실제로 DEFAULT_CFG 의 492개 leaf 중 82개를 코드가 한 번도 읽지 않고 있었다.
//   그중에는 위험해 보이는 것도 있었다 —
//     · cashReservePct  "현금을 …까지 소진 허용 → cashCap 동적 산정"  ← cashCap 은 0.85 하드코딩
//     · exitBelowMa: 20 "종가가 MA20 하향 이탈 시 청산"               ← 전역 maPeriod 만 사용
//   화면에서 값을 바꿔도 아무 일이 일어나지 않는 손잡이는, 없는 것보다 나쁘다.
//   "설정했으니 그렇게 돌겠지" 라고 믿게 만들기 때문이다.
//
//   이 게이트는 죽은 키를 전부 없애라고 요구하지 않는다(대체된 옛 키는 은퇴가 맞다).
//   요구하는 것은 ★분류★ 다: 읽히거나(WIRED), 사유와 함께 은퇴하거나(RETIRED).
//   둘 다 아닌 키가 새로 생기면 배포를 막는다 — 조용히 죽는 경로를 닫는다.

import fs from "node:fs";
const src = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };

// DEFAULT_CFG 블록만 잘라낸다(자기 안의 정의는 '사용'이 아니다).
const i0 = src.indexOf("const DEFAULT_CFG = {");
if (i0 < 0) { bad("DEFAULT_CFG 를 찾지 못했다"); process.exit(1); }
let d = 0, j = i0 + "const DEFAULT_CFG = ".length; const start = j;
for (; j < src.length; j++) { const c = src[j]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { j++; break; } } }
const strip = (t) => t.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const blk = strip(src.slice(start, j));
const rest = strip(src.slice(0, i0) + src.slice(j));

const keys = new Set();
for (const m of blk.matchAll(/(^|[{,\s])([A-Za-z_$][\w$]*)\s*:/g)) keys.add(m[2]);

// ── 은퇴 대장 — 사유가 반드시 있어야 한다 ────────────────────────────────────
//   "대체됨" 이면 무엇으로 대체됐는지 적는다. 나중에 사람이 읽고 판단할 수 있어야 한다.
const RETIRED = {
  // 종목 비중 상한: 전략별 sizing.maxPositionPct + RISKENG.maxNotionalFrac 가 실제로 강제한다.
  minPortfolioPct: "대체: 전략별 sizing.maxPositionPct",
  maxPortfolioPct: "대체: sizing.maxPositionPct + RISKENG.maxNotionalFrac",
  dayScale: "대체: day 전략 폐지(STRATEGIES=trend/scalp/snap)",
  sizingTargets: "대체: kellyPerTrade + ATR 기반 사이징",
  atrSizing: "대체: kellyPerTrade",
  roundTripCostPct: "대체: 실측 EV 문턱(ml_evstats byVol) + _slipRate",
  // 섹터 라벨 상수 — getSectorGroup 이 자체 매핑을 쓴다.
  CONSUMER: "라벨 상수(섹터 매핑은 getSectorGroup 내장)",
  FINANCE: "라벨 상수", HEALTH: "라벨 상수", INDUSTRIAL: "라벨 상수",
  OTHER: "라벨 상수", RESOURCES: "라벨 상수",
  // 구 규칙엔진 잔재 — 현재 신호 생성기가 쓰지 않는다.
  allowMixedConfluence: "구 규칙엔진 잔재", mixedConfluencePenalty: "구 규칙엔진 잔재",
  confluenceBonus: "구 규칙엔진 잔재", soloSignalWeight: "구 규칙엔진 잔재",
  minConfirmWeight: "구 규칙엔진 잔재", maxSignalsKept: "구 규칙엔진 잔재",
  requireRsiUptick: "구 규칙엔진 잔재", volSpikeMult: "구 규칙엔진 잔재",
  zScoreThreshold: "구 평균회귀 전략 잔재", bearZScoreThreshold: "구 평균회귀 전략 잔재",
  bearRsiMax: "구 평균회귀 전략 잔재", momoRsiMin: "구 모멘텀 전략 잔재",
  momoRsiMax: "구 모멘텀 전략 잔재", rsiMaxForBounce: "구 반등 전략 잔재",
  rsiMaxForGap: "구 갭 전략 잔재", bounceYestMin: "구 반등 전략 잔재",
  dipMinPct: "구 눌림목 전략 잔재", dipMaxPct: "구 눌림목 전략 잔재",
  openDriveMinPct: "구 개장드라이브 잔재", openDriveMaxPct: "구 개장드라이브 잔재",
  vwapPullMinPct: "구 VWAP 되돌림 잔재", vwapPullMaxPct: "구 VWAP 되돌림 잔재",
  rangeLowPos: "구 레인지 전략 잔재", rangeHighPos: "구 레인지 전략 잔재",
  rangeLowScale: "구 레인지 전략 잔재", rangeHighScale: "구 레인지 전략 잔재",
  clvStrongMin: "구 CLV 사이징 잔재", clvWeakMax: "구 CLV 사이징 잔재",
  clvStrongScale: "구 CLV 사이징 잔재", clvWeakScale: "구 CLV 사이징 잔재",
  obvUpScale: "구 OBV 사이징 잔재", obvDownScale: "구 OBV 사이징 잔재",
  posScaleMax: "구 사이징 잔재", negScaleMin: "구 사이징 잔재",
  minMult: "구 사이징 잔재", minBudget: "구 사이징 잔재",
  riskOnBoost: "대체: mktCtx.sizeScale", riskOffScale: "대체: mktCtx.sizeScale",
  rsTiltBoost: "대체: xsPanel 횡단면 랭크", rsTiltCut: "대체: xsPanel 횡단면 랭크",
  weeklyMisalignScale: "구 주간정렬 잔재", targetAtrPct: "구 변동성 타깃 잔재",
  beatBoost: "대체: earnCorr 실측 서프라이즈 상관", missScale: "대체: earnCorr",
  l3TrailDropScale: "구 3단 트레일 잔재", trailStartPct: "대체: ATR 기반 ratchetStop",
  trailDropPct: "대체: ATR 기반 ratchetStop", tp: "대체: tp1AtR/tp2AtR (R 배수)",
  tp2AtR: "sizing 하위 중복 정의(전략별 rules.tp2AtR 가 실사용)",
  maxHoldHours: "대체: timeStopDays/timeStopMinR",
  minHoldDays: "대체: timeStopDays", minHoldHours: "대체: timeStopDays",
  minHoldMinutes: "대체: scalpRules 자체 보유규칙",
  timeStopMaxDays: "대체: timeStopDays", krSwingMinHoldHours: "대체: timeStopDays",
  krSwingMaxHoldDays: "대체: timeStopDays",
  softTimeStopMinutes: "구 소프트 타임스탑 잔재", softTimeStopMinPnl: "구 소프트 타임스탑 잔재",
  softTimeStopMinutesKR: "구 소프트 타임스탑 잔재", softTimeStopMinPnlKR: "구 소프트 타임스탑 잔재",
  eodProfitTakeBeforeMin: "구 EOD 익절 잔재", forceCloseBeforeMinClose: "구 EOD 청산 잔재",
  usIntradayGate: "대체: intradayConfirm", cycleLockRefreshAt: "구 락 갱신 잔재",
  refreshHours: "구 캐시 갱신 잔재", refreshMinutes: "구 캐시 갱신 잔재",
  fallbackOnFail: "구 폴백 플래그 잔재", fallbackToLegacy: "구 폴백 플래그 잔재"
};

const dead = [], wired = [];
for (const k of keys) {
  const re = new RegExp("(\\.|\\[\")" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
  (re.test(rest) ? wired : dead).push(k);
}
ok("DEFAULT_CFG leaf " + keys.size + "개 · 코드가 읽는 것 " + wired.length + "개");

const unclassified = dead.filter((k) => !RETIRED[k]);
const staleRetired = Object.keys(RETIRED).filter((k) => wired.indexOf(k) >= 0);

if (unclassified.length) {
  bad("분류되지 않은 죽은 설정 " + unclassified.length + "개 — 코드가 읽지 않는데 은퇴 등재도 없다.\n" +
      "    화면에서 바꿔도 아무 일이 없는 손잡이다. 코드에서 읽게 하거나 RETIRED 에 사유와 함께 등재할 것:\n" +
      "    " + unclassified.sort().join(", "));
} else ok("죽은 설정 " + dead.length + "개 전부 은퇴 등재됨(사유 명시)");

if (staleRetired.length) {
  bad("은퇴 등재됐는데 코드가 다시 읽는 키 " + staleRetired.length + "개 — 대장이 낡았다: " + staleRetired.join(", "));
} else ok("은퇴 대장 " + Object.keys(RETIRED).length + "건 모두 유효(아무도 안 읽음)");

// 은퇴 사유가 비어 있으면 대장으로서 의미가 없다.
const noReason = Object.keys(RETIRED).filter((k) => !String(RETIRED[k] || "").trim());
if (noReason.length) bad("사유 없는 은퇴 등재: " + noReason.join(", "));
else ok("은퇴 사유 전건 기재");

console.log(fails ? "\n죽은 설정 위반 " + fails + "건" : "\n  ok   설정 배선 통과");
process.exit(fails ? 1 : 0);
