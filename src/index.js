// ============================================================
// LUX-engine V8.6 Hybrid (V8.5 규칙 매매 + Claude 일일 지시)
// 
// 핵심 구조:
//   • V8.5 규칙 매매 엔진은 매분 자동 작동 (기존과 동일)
//   • Claude는 매일 시장 시작 전 1회씩 깨어남
//       - KR: 09:00 KST (정규장 시작 시각)
//       - US: 09:20 ET (정규장 10분 전, DST 자동)
//   • Claude의 출력은 "일일 지시" — 신호/종목/사이징/손절 필터로만 작용
//       - buy_signals.enabled — 매수 신호 전체 ON/OFF
//       - disable_signals — 비활성화할 신호 이름 리스트
//       - avoid_symbols — 진입 금지 종목 리스트
//       - position_sizing.scale — 사이즈 배수 (0.3~1.5)
//       - stop_loss_adjustment.new_pct — 손절폭 강제 적용 (선택)
//   • 안전: Claude 응답 파싱 실패/타임아웃 시 지시는 무시되고 V8.5 그대로 작동
//   • 비용: 하루 2회 Claude 호출 (시장당 1회)
//
// V8.6 시간처리 변경점 (이미 적용됨):
//   • US 시장 시간 DST 자동 전환 (EST/EDT)
//   • KR 거래 윈도우 09:15~15:45 (야후 15분 지연 보정)
//   • isLLMTriggerTime() 헬퍼로 분 단위 정확한 트리거
// V8.4 → V8.5 변경점 (수익률 개선 핵심):
// V8.4 → V8.5 변경점 (수익률 개선 핵심):
//   • [BUG FIX] stopPrice 하향 갱신 — breakEvenLocked일 때 safeStop으로 끌어내리지 않음
//     → V8.3 break-even 메커니즘 실효화. "수익→본전 손실" 패턴 차단.
//   • [리스크 기반 사이징] budget = (cash × riskPerTrade) / stopDistancePct
//     → 변동성·손절폭과 무관하게 거래당 절대 리스크 균등. ATR 사이징과 통합.
//     기존: cash × ratio × signal.weight × crossBonus × atrMult (모두 cap에 묶임)
//   • [DAY trailing 정상화] trailStartPct=2.5(>tp1 2.0), trailDropPct=0.8
//     → 실효 손익비 1:0.5 → 1:2 회복. 분할익절 후 잔량 보호 강화.
//   • [신호 자동 비활성화 완화] 표본 20+ & WR<40% & avgPnL<0 (기존 30+/35%/-0.5%)
//     + 비활성화 후 30일 경과 시 자동 재평가 큐 진입
//   • [MEANREV ATR 동적 손절] stopLossPct 대신 max(rules.stopLossPct, 1.5×ATR/price%)
//     → 약세장 노이즈에 의한 조기 손절 감소.
//   • [신호 통계에 strategy 차원] signalStats[strategy:signalName]로 분리
//     → cross-confluence 거래 시 멤버 귀속 명확화.
//   • [사이클 락 갱신] 사이클 중 락 TTL 절반 경과 시 갱신 (stale 진입 방지)
// V8.3 → V8.4 변경점 (수익률 개선 핵심):
//   • [DAY 손익비] stop 1.3→1.0%, tp1 1.5→2.0%, tp 2.5→4.0%, breakEvenAt 1.0→2.0
//     → 손익비 1:1 → 1:2.5+, 너무 빠른 본전청산 방지
//   • [DY_RANGE 강화] catch-all 제거 — 추세 정렬(ma5>ma20) + RSI 45~65 + 변동 -2~+1.5% 만
//     → 사실상 랜덤 매수였던 단독 신호 제거
//   • [Solo signal penalty] soloSignalWeight 1.0→0.7 — 단독 진입 30% 감점
//   • [전략 선택 로직] priority 단순매핑 → weightedWinRate × signal.weight 최댓값
//     → 학습된 승률 통계가 실제 의사결정에 반영
//   • [Signal auto-disable] 표본 30+ & 승률 35% 미만 & 평균PnL 음수 → 자동 비활성화
//   • [Regime-aware MEANREV] BEAR에서는 z<-2 & RSI<25 만 진입 (catch-falling-knife 강화)
//   • [Cost-aware TP] KR 0.21%, US 0.02% 왕복비용을 TP 판단에서 차감
// 4개 전략 동시 운용: swing, day, momentum, meanrev
//   • 같은 종목 + 다른 전략 = 별도 포지션 가능 (composite PK)
//   • 매도는 진입 전략의 룰을 따라감
//   • 동시 신호 시 cross-strategy confluence 가중 (x1.2)
//   • 전략별 base size + 시장국면 multiplier
// V8.1.9 → V8.3 변경점 (승률·수익률 개선):
//   • [Break-even stop] 수익 +breakEvenAt% 도달 시 손절가를 진입가+breakEvenLock%로 상향
//     → 수익 → 본전 손실 전환 차단. 전략별 임계: swing 2%, day 1%, mom 3%, mr 1.5%
//   • [공통 Trailing stop] 4개 전략 모두 trailing. 기존엔 swing/momentum만.
//     → day/meanrev도 피크 대비 일정 % 하락 시 자동 청산
//   • [분할익절] DAY는 +1.5%에서 절반, MOMENTUM은 +5%에서 1/3 청산
//     → 일부 익절 후 나머지는 trail로 더 끌어가기
//   • [ATR 동적 사이징] 변동성 높은 종목은 작게, 안정 종목은 크게 매수
//     → 포지션당 절대 리스크 균등화. atrSizing.targetAtrPct=2% 기준
//   • [MR 진입 강화] requireRsiUptick — RSI가 상승 전환된 날만 진입
//     → catch-falling-knife 방지 (RSI 30 찍고 더 떨어지는 종목 회피)
//   • [신호 통계 시간가중] 최근 거래(N=80)에 더 큰 가중. recency 1.0→0.5 선형 감쇠
//     → 시장 국면 변할 때 신호 평가 추종력↑
// V8.1.8 → V8.1.9 변경점:
//   • 사이징 기준: portfolioValue → cash[market] 기반 (가용현금 직접 사용)
//   • 거래당 금액 클램프: KR ₩100~300만 / US $1k~3k (cfg.sizingTargets)
//   • minBudget 보장 + maxBudget 캡 + cash 85% 안전선
//   • floor() 손실 보정: budget의 +25% 여유분이면 1주 추가
//   • strategySizing base 재조정 (35 → 25~30, cash 기준이라 실효 비중은 비슷)
// ============================================================

const DEFAULT_US = [
  "AAPL","NVDA","TSLA","GOOGL","AMZN",
  "AVGO","RKLB","META","AMD","SNDK",
  "SOXL","SOXS","GS","BA","VOO",
  "BRK-B","INTC","ORCL","KO","PLTR"
];

const DEFAULT_KR = [
  "005930.KS","000660.KS","005380.KS","373220.KS","009150.KS",
  "006400.KS","034020.KS","006800.KS","012450.KS","402340.KS",
  "329180.KS","042660.KS","196170.KS","047040.KS","005490.KS",
  "042700.KS","064350.KS","079550.KS","047810.KS","069500.KS"
];

const US_INDICES = ["^IXIC", "^DJI", "^GSPC"];
const KR_INDICES = ["^KS11", "^KQ11"];

// === [COMMODITY] 원자재 거래 대상 ===
//   야후 파이낸스 선물 심볼 사용. 가격은 전부 USD 기준.
//   거래는 swing 전략과 동일한 로직으로, 하루 1회(16:00 KST)만 실행.
//   초기 보유 금액 $100,000. (DEFAULT_CFG.initialCashCM 참조)
const COMMODITIES = [
  { symbol: "GC=F",  name: "금 (Gold)",            unit: "oz" },
  { symbol: "SI=F",  name: "은 (Silver)",          unit: "oz" },
  { symbol: "PL=F",  name: "플래티넘 (Platinum)",  unit: "oz" },
  { symbol: "HG=F",  name: "구리 (Copper)",        unit: "lb" },
  { symbol: "CL=F",  name: "WTI 유가 (WTI Crude)", unit: "bbl" },
  { symbol: "BZ=F",  name: "브렌트유 (Brent)",     unit: "bbl" },
  { symbol: "NG=F",  name: "천연가스 (Nat Gas)",   unit: "MMBtu" },
  { symbol: "ALI=F", name: "알루미늄 (Aluminum)",  unit: "t" }
];
const COMMODITY_SYMBOLS = COMMODITIES.map(function(c){ return c.symbol; });
const COMMODITY_META = {};
for (const c of COMMODITIES) COMMODITY_META[c.symbol] = c;

// === 전략 식별자 ===
const STRATEGIES = ["swing", "day", "momentum", "meanrev"];

// === [신규] 섹터 매핑 (동시 보유 제한용) ===
const SECTOR_MAP = {
  "NVDA":"US_SEMI","AVGO":"US_SEMI","AMD":"US_SEMI","INTC":"US_SEMI","SNDK":"US_SEMI",
  "AAPL":"US_TECH","GOOGL":"US_TECH","META":"US_TECH","AMZN":"US_TECH","ORCL":"US_TECH",
  "TSLA":"US_AUTO","RKLB":"US_AERO","BA":"US_AERO",
  "GS":"US_FIN","BRK-B":"US_FIN",
  "PLTR":"US_DATA","KO":"US_CONSUMER","VOO":"US_INDEX",
  "005930.KS":"KR_SEMI","000660.KS":"KR_SEMI","042700.KS":"KR_SEMI",
  "006400.KS":"KR_BATT","373220.KS":"KR_BATT","006800.KS":"KR_BATT"
};

// === [신규] 인버스/레버리지 페어 (동시 보유 금지) ===
const INVERSE_PAIRS = {
  "SOXL":"SOXS","SOXS":"SOXL",
  "TQQQ":"SQQQ","SQQQ":"TQQQ",
  "UPRO":"SPXU","SPXU":"UPRO"
};

const DEFAULT_CFG = {
  usTickers: DEFAULT_US,
  krTickers: DEFAULT_KR,
  usFavorites: [],
  krFavorites: [],
  rsiBuy: 35, rsiSell: 70, rsiPeriod: 14,
  stopLoss: 5.0,
  takeProfit1: 4.0,
  takeProfit2: 11.0,
  maxDailyDrop: 5.0,
  marketCrashPct: -2.0,
  feeUS: 0.0001,
  feeKR: 0.00015,
  krSellTax: 0.0018,
  maPeriod: 20, maShortPeriod: 5,
  atrPeriod: 14, atrStopMult: 2.0,
  bbStdMult: 2.0,
  volSpikeMult: 1.5,
  dailyCacheMinutes: 30,   // [V8.1.1] 10→30 — Cloudflare subrequest 절약
  initialCashUS: 100000, initialCashKR: 100000000,
  initialCashCM: 100000,   // [COMMODITY] 원자재 초기 보유 금액 $100,000 (USD)
  enabled: true,
  autoTune: true,
  marketHoursOnly: true,
  // === [V8.5] 리스크 기반 사이징 ===
  // budget = cash × riskPerTrade / stopDistancePct
  //   stopDistancePct = (price - stopPrice) / price × 100
  //   → 한 거래 최대 손실이 cash의 riskPerTrade%로 균등화.
  //   기존 비율식(baseRatio × signal.weight × crossBonus × atrMult)은
  //   cap 0.85에 항상 묶여 신호 가중치가 실효화 안 됐음.
  //   signal.weight는 riskPerTrade에 곱해 강한 신호일수록 리스크 더 가져감.
  riskBasedSizing: {
    enabled: true,
    // [V9.4] 0.6→0.8 / [V9.5] 0.8→1.0 추가 상향: 현금 활용도 더 끌어올림.
    //   maxRisk는 1.2 유지 — 가장 공격적 거래도 한 거래 손실 자산 1.2%로 묶임.
    //   결과: 기본 신호 거래 KR ₩1116만→₩1395만, 한 거래 손절시 손실 자산 0.8%→1.0%.
    riskPerTrade: 1.0,       // cash의 1.0% 손실 허용
    minRisk: 0.3,            // 약한 신호 floor
    maxRisk: 1.2,            // 강한 신호 + crossConf 시 cap (유지 — 안전선)
    fallbackToLegacy: false, // 리스크 사이징 실패 시 legacy 사용 여부
    // [V9.6] 전략별 오버라이드. 지정 전략은 아래 값을, 미지정은 위 공통값 사용.
    //   momentum: 손절폭이 8%로 넓어 공통 floor(0.3%)면 약신호·고변동 시 거래금액이
    //   500만 밑으로 떨어짐. minRisk를 0.65%로 올려 최악 조건(stop 12.8%)에서도
    //   ~500만 확보. riskPerTrade/maxRisk도 함께 올려 손익비 일관성 유지.
    //   ※ 트레이드오프: momentum 한 거래 최대 손실한도가 자산의 1.2%→1.4%로 소폭 증가.
    byStrategy: {
      momentum: { riskPerTrade: 1.2, minRisk: 0.65, maxRisk: 1.4 }
    }
  },
  // === [V8.5] disabled signal 재평가 ===
  signalReviewDays: 30,      // 비활성화 후 N일 경과 시 재활성화 후보
  // === [V8.6 Hybrid] Claude LLM 일일 지시 ===
  llmHybrid: {
    enabled: false,           // 기본 OFF — 사용자가 명시적으로 켜야 작동
    model: "claude-sonnet-4-6", // [V8.7] 유효 모델 ID (구 'claude-opus-4-5'는 존재하지 않아 404 발생)
    maxTokens: 3000,          // [V9.1] 2000→3000 (reasoning 단계적 추론 공간 확보)
    confidenceWeighting: true, // [V9.1] LLM confidence로 sizing 개입 강도 조절 (낮으면 보수적)
    timeoutMs: 20000,         // [V8.7] 시도당 20초 (재시도 포함 총량이 cron 60초/lock TTL 내에 들도록)
    maxRetries: 2,            // [V8.7] 재시도 2회 → 최악 ~63초, 정상 응답(5~10초)엔 영향 없음
    expiryHours: 18,          // 지시 유효 시간 — 18시간 지나면 무시 (다음날 지시 누락 시 안전)
    minSizingScale: 0.3,      // Claude가 너무 작은 사이즈 요청해도 이 값까지만
    maxSizingScale: 1.5,      // 너무 큰 사이즈 요청 차단
    minStopPct: 0.3,          // 손절 최소폭 (너무 타이트해서 즉시 손절 방지)
    maxStopPct: 5.0,          // 손절 최대폭 (너무 느슨해서 큰 손실 방지)
    fallbackOnFail: true      // 호출 실패 시 V8.5 그대로 작동
  },
  // === [V9 매크로] 경제지표 자동 갱신 (Claude + web_search) ===
  //   매일 07:00 KST에 1회, 미국/한국 핵심 지표 최신 공표치를 검색해 갱신.
  //   수치만 자동, 발표 일정(다음 발표일)은 프론트 MACRO_SCHEDULE에서 정적 관리.
  macro: {
    enabled: true,              // 기본 ON
    model: "claude-sonnet-4-6", // web_search 지원 모델
    maxTokens: 4000,
    timeoutMs: 60000,           // web_search 멀티턴이라 시도당 60초
    maxRetries: 2,
    maxSearches: 12             // web_search 도구 호출 상한 (비용/시간 제어)
  },
  // === [V8.5] 사이클 락 자동 갱신 ===
  cycleLockRefreshAt: 0.5,   // TTL의 50% 경과 시 갱신
  // === [V8] 전략별 활성화 토글 ===
  strategies: {
    swing: true,
    day: true,
    momentum: true,
    meanrev: true
  },
  // === [V8] 전략별 포지션 사이즈 (NEUTRAL base / BULL mult / BEAR mult) ===
  // [V8.1.9] base = 가용현금 대비 비율 (계산식이 cash[market] 기준으로 변경됨).
  //          한 거래 목표금액 KR ₩100~300만 / US $1~3k 범위로 클램프됨 (아래 sizingTargets).
  strategySizing: {
    // [V9] LLM 분석 반영: 현재 NEUTRAL 국면에서 day winRate 0%/avgPnl -20%, momentum 신뢰도 급락, swing만 우수.
    //   neutralMult 추가 — BULL/BEAR가 아닌 중립 횡보장에서의 전략별 사이즈 배수.
    //   day/momentum은 추세가 명확할 때만 작동 → 중립장에선 대폭 축소. swing은 중립장에서도 안정 → 유지.
    // [V9.1] day 사이즈 추가 감축: base 25→15 (전 국면 40%↓).
    //   거래는 유지하되 금액만 축소 — 손익비(3.3:1)가 좋아 거래차단은 역효과였으므로 사이즈로만 리스크 관리.
    //   결과 실효비중: BULL 22.5% / NEUTRAL 6% / BEAR 15% (전 전략 중 최소 수준).
    //   US 분봉게이트·KR 스윙전환의 효과 검증용 표본은 계속 수집됨.
    day:      { base: 15, bullMult: 1.5, bearMult: 1.0, neutralMult: 0.4 },
    // [V9.2] meanrev 소폭 상향: base 25→27. 사용자 요청 반영하되 표본 1건뿐이라 최소폭만.
    meanrev:  { base: 27, bullMult: 1.2, bearMult: 1.4, neutralMult: 1.0 },
    // [V9.2] swing 소폭 상향: base 30→33. 사용자 요청(승률 우수 시 베팅 확대) 반영하되,
    //   표본 15건·전부 우상향장이라는 한계 고려해 +10%만.
    //   [V9.3] bearMult 0.8→0.6: base를 키운 만큼 하락장 쏠림 방어 강화.
    //     이 사이즈 축소는 LLM과 무관하게 작동(코드 레벨) → LLM이 죽어도 하락장 swing 리스크 억제.
    //     실효 BEAR 비중 = 33×0.6 = 19.8%로, 상향 전(30×0.8=24%)보다 오히려 보수적.
    swing:    { base: 33, bullMult: 1.4, bearMult: 0.6, neutralMult: 1.0 },
    momentum: { base: 28, bullMult: 1.5, bearMult: 0.6, neutralMult: 0.4 }
  },
  // === [V8.1.9] 한 거래당 목표 금액 클램프 (시장별) ===
  // budget이 minBudget 미만이면 minBudget으로 끌어올리고, maxBudget 넘으면 잘라냄.
  // cash[market] 부족하면 cash 한도 내에서 최대한 채움.
  // [V9.4] day의 기본 폴백값(전략별 오버라이드 없을 때 사용).
  sizingTargets: {
    kr: { minBudget: 1000000, maxBudget: 3000000 },  // ₩100만 ~ ₩300만 (day 기준)
    us: { minBudget: 1000,    maxBudget: 3000    }   // $1k ~ $3k (day 기준)
  },
  // [V9.4] 전략별 한 거래 최대금액 오버라이드 — 현금 활용도↑, 좋은 신호에 크게 베팅.
  //   day는 약전략이라 캡 유지(위 sizingTargets 사용). 나머지는 자산 비중 기준으로 상향.
  //   swing/meanrev: 자산 ~20% / momentum: 자산 ~6% / day: 자산 ~3%(유지).
  //   ※ 캡은 상한일 뿐, 실제 금액은 riskBasedSizing이 결정 → riskPerTrade도 함께 상향함.
  // [V9.6] swing/meanrev/momentum 한 거래 캡 ₩3000만/$3만으로 상향(목표 500만~3000만).
  //   minBudget=0 — 강제 하한 제거. riskBasedSizing이 정한 금액을 그대로 쓰고,
  //   리스크 계산상 작게 나와도 억지로 500만을 채우지 않음(사용자 요청).
  //   day: 오버라이드 없음 → 아래 sizingTargets(₩300만/$3k) 그대로 사용.
  sizingTargetsByStrategy: {
    swing:    { kr: { minBudget: 0, maxBudget: 30000000 }, us: { minBudget: 0, maxBudget: 30000 } },
    meanrev:  { kr: { minBudget: 0, maxBudget: 30000000 }, us: { minBudget: 0, maxBudget: 30000 } },
    momentum: { kr: { minBudget: 0, maxBudget: 30000000 }, us: { minBudget: 0, maxBudget: 30000 } }
    // day: 오버라이드 없음 → 위 sizingTargets(₩300만/$3k) 사용
  },
  // === [V8.3] ATR 기반 동적 사이징 ===
  // 변동성 큰 종목은 작게, 안정된 종목은 크게 매수 → 포지션당 절대 리스크 균등화.
  // budget *= clamp(targetAtrPct / actualAtrPct, minMult, maxMult)
  //   actualAtrPct = ATR14 / price * 100 (가격 대비 일평균 변동성)
  //   ATR이 평균(targetAtrPct)이면 그대로, 2배 변동성이면 사이즈 절반, 절반 변동성이면 1.5배까지.
  atrSizing: {
    enabled: true,
    targetAtrPct: 2.0,    // 일 평균 변동성 2% 기준
    minMult: 0.5,         // 변동성 매우 큼 → 최대 50%까지 축소
    maxMult: 1.5          // 변동성 매우 작음 → 최대 150%까지 확대
  },
  // === [V8.3] 신호 통계 신선도 ===
  // signal_stats 누적이 길어지면 옛날 시장 통계가 새 시장에 영향. 최근 N건만 사용.
  signalStatsWindow: 80,  // 직전 80건 가중 평가 (0 = 무제한, 기존 동작)
  // === [V8] Cross-strategy confluence — 같은 종목 + 다른 전략 동시 신호 ===
  crossConfluenceBonus: 1.2,
  // === [V8] 전략별 진입/청산 룰 ===
  swingRules: {
    minHoldHours: 3,           // [V8.1.4] 4→3 (조금 더 빠른 회전)
    timeStopDays: 3,
    timeStopMaxDays: 7,
    trailStartPct: 3.0,
    trailDropPct: 4.0,
    tp1: 3.5, tp2: 10.0,       // [V8.1.4] 4.0/11.0 → 3.5/10.0 (조금 더 자주 익절)
    stopLossPct: 5.0,
    atrStopMult: 2.0,
    // [V8.3] Break-even stop — 수익 +breakEvenAt% 도달 시 손절가를 진입가+breakEvenLock%로 올림
    breakEvenAt: 2.0,
    breakEvenLock: 0.3
  },
  dayRules: {
    // [V9] 시장별 차별화 파라미터
    usIntradayGate: true,       // US: 분봉 일중 모멘텀 게이트 ON (단타 진입 타이밍)
    krSwingMinHoldHours: 3,     // KR: 짧은 스윙 최소 보유 3시간
    krSwingMaxHoldDays: 4,      // KR: 최대 보유 4일 (당일청산 강요 안 함)
    minHoldMinutes: 10,
    maxHoldHours: 8,
    forceCloseBeforeMinClose: 30,
    // [V8.6 데이터근거] DAY-EOD 강제마감이 청산의 48%, 승률 25%, 누적 -24.8만 = 최대 손실원.
    //   원인: 방향 안 나온 포지션을 마감까지 끌다 손실 확정. 대책 ↓
    //   (1) softTimeStop: 진입 후 N분 지나도 +threshold 못 넘으면 미세익절/본전 청산
    softTimeStopMinutes: 90,        // 90분 경과 후
    softTimeStopMinPnl: 0.15,       // PnL이 +0.15% 미만이면(=방향 안 남) 청산
    //   [V8.6.1] KR은 EOD 손실 -53만의 진원지(US는 -76원). KR 한정 더 공격적 타임스톱.
    softTimeStopMinutesKR: 50,      // KR은 50분으로 단축 — 질질 끌다 손실확정 방지
    softTimeStopMinPnlKR: 0.25,     // 비용(0.21%) 고려 +0.25% 못 넘으면 정리
    //   (2) EOD를 더 일찍 — 마감 직전 급락에 끌려나오기 전에 정리
    eodProfitTakeBeforeMin: 45,     // 마감 45분 전, 수익(+)이면 미리 확정
    // [V8.4] 손익비 1:1 → 1:2.5+ 재설계
    tp: 4.0,                   // 2.5 → 4.0 (TP2 더 멀리)
    stopLossPct: 0.85,         // [V8.6.1] 1.0→0.85: 실측 HARD-STOP 평균이 -1.35%로 설정 초과(갭/슬리피지).
                               //   타이트하게 잡아 실제 체결 손실을 ~-1.1%로 억제. 손익비(승+2%) 유지.
    // [V8.5] trailing을 tp1(2.0) 이후로 늦춤 — 분할익절 잔량 보호
    trailStartPct: 2.5,        // V8.4 2.0 → 2.5 (tp1=2.0 이후 발동)
    trailDropPct: 0.8,         // V8.4 1.5 → 0.8 (잔량은 타이트하게 따라감)
    // [V8.4] Break-even 너무 빠르게 발동되던 문제 해결
    breakEvenAt: 2.0,          // 1.0 → 2.0 (노이즈로 본전청산 방지)
    breakEvenLock: 0.2,        // 0.1 → 0.2
    // [V8.4] TP1 분할익절 — 절반 청산 임계 상향
    tp1: 2.0,                  // 1.5 → 2.0
    // [V9.5 진입강화] 진입 범위만 보수화 — "확실할 때만 매수". 리스크/청산 파라미터는 미변경.
    dayDropMin: -5.0,                  // [V9.5] -8.0→-5.0: 너무 깊은 낙폭(칼날잡기) 차단
    dayDropMax: 0.5,                   // [V9.5] 1.5→0.5: 갭하락 매수는 진짜 하락일 때만
    rsiMaxForGap: 55,                  // [V9.5] 65→55: 과매수 구간 갭매수 금지
    rsiMaxForBounce: 60,               // [V9.5] 70→60: 반등매수도 RSI 낮을 때만
    bounceYestMin: -1.2,               // [V9.5] -0.5→-1.2: 어제 확실히 빠진 종목만 반등 노림
    openDriveMinPct: 1.0,              // [V9.5] 0.5→1.0: 약한 갭상승 추격 금지
    openDriveMaxPct: 4.0,              // [V9.5] 6.0→4.0: 과열 갭상승 추격 금지
    vwapPullMinPct: -1.0,              // [V9.5] -1.5→-1.0
    vwapPullMaxPct: 2.5,               // [V9.5] 3.5→2.5
    momoRsiMin: 58,                    // [V9.5] 55→58
    momoRsiMax: 74,                    // [V9.5] 80→74: 고RSI 추격 금지
    dipMinPct: -3.0,                   // [V9.5] -5.0→-3.0: 얕은 눌림만(깊은 눌림=추세훼손)
    dipMaxPct: -0.3,                   // [V9.5] -0.1→-0.3: 진짜 눌림만
    // [V9.5 진입강화] 신호 정제 게이트 (진입 단계만 영향)
    maxSignalsKept: 1,                 // 신호 여러 개면 가장 강한 1개만 채택(확신 매수)
    minConfirmWeight: 0.9              // weight 0.9 미만 약한 단독신호 보류(GAP_DOWN 0.95는 유지)
  },
  momentumRules: {
    breakoutDays: 10,          // [V8.1.7] 15→10 (더 자주 돌파 진입)
    volMult: 1.15,             // [V8.1.7] 1.3→1.15
    rsiMin: 50, rsiMax: 80,    // [V8.1.7] 52~78 → 50~80
    minHoldDays: 1,            // [V8.1.7] 2→1
    timeStopMaxDays: 30,
    trailStartPct: 4.0,        // [V8.1.7] 5→4
    trailDropPct: 6.0,         // [V8.1.7] 7→6
    stopLossPct: 8.0,
    atrStopMult: 3.0,
    // [V8.3] Break-even + 분할익절
    breakEvenAt: 3.0,
    breakEvenLock: 0.5,
    tp1: 5.0                   // +5% 도달 시 1/3 익절
  },
  meanrevRules: {
    zScoreThreshold: -1.3,     // [V8.1.7] -1.7→-1.3 (더 빈번)
    rsiMax: 35,                // [V8.1.7] 30→35
    minHoldHours: 2,
    timeStopMaxDays: 5,
    tp: 999,
    stopLossPct: 4.0,          // [V8.1.7] 3.5→4.0
    // [V8.3] MEANREV trailing — MA20 닿기 전 갑작스런 하락에 보호
    trailStartPct: 2.5,
    trailDropPct: 1.8,
    breakEvenAt: 1.5,
    breakEvenLock: 0.2,
    // [V8.3] MR 진입 조건 강화 — RSI 상승 전환 요구
    requireRsiUptick: true,    // 어제 RSI < 오늘 RSI 일 때만 진입 (catch-falling-knife 방지)
    // [V8.4] BEAR 한정 강화 — 약세장에서 reversion 매수는 매우 위험
    //        z-score 더 극단 & RSI 더 낮음 만 진입 허용
    bearZScoreThreshold: -2.0,
    bearRsiMax: 25
  },
  // === Confluence (전략 내부) ===
  // [V8.1.3] 강제 OFF — 멀티 전략판이라 cross-strategy confluence로 충분.
  // autoTune이 켜는 로직도 V8.1.3에서 비활성화함.
  requireConfluence: false,
  soloSignalWeight: 0.7,       // [V8.4] 1.0 → 0.7 (단독 신호 30% 감점)
  confluenceBonus: 1.3,
  allowMixedConfluence: true,
  mixedConfluencePenalty: 0.8,
  // [V8.4] 거래비용(왕복) — TP 판단 시 차감
  roundTripCostPct: { us: 0.02, kr: 0.21 },
  // [V8.4] autoTune이 손실 신호를 여기에 자동 추가 → resolveSignals에서 제외
  disabledSignals: [],
  // === RS 필터 ===
  rsFilterEnabled: true,
  rsLookbackDays: 20,
  rsMinOutperform: -2.0,
  // === 섹터 / 페어 제한 ===
  maxPositionsPerSector: 3,    // [V8] 전략별 포지션 가능해서 2→3 완화
  blockInversePair: true,
  // === 사이클 락 ===
  cycleLockTTL: 60000   // 60s — 사용자 요청으로 복원
};

// === [V8.2] 시장별 독립 학습 — US/KR 따로 학습되는 매매 룰 키 목록 ===
// 이 키들은 cfg.markets.us / cfg.markets.kr 안에 들어감.
// 베이스 cfg에도 같은 키가 있으면 폴백으로 사용 (마이그레이션 호환용).
const MARKET_SCOPED_KEYS = [
  'rsiBuy', 'rsiSell', 'rsiPeriod',
  'stopLoss', 'takeProfit1', 'takeProfit2', 'posSize',
  'swingRules', 'dayRules', 'momentumRules', 'meanrevRules',
  'strategySizing',
  // [V8.3] ATR 사이징 & signal stats window도 시장별 학습 대상
  'atrSizing', 'signalStatsWindow'
];

// 베이스 cfg + cfg.markets[market] 머지해서 그 시장에서 쓸 cfg 반환.
// 시장 값이 있으면 우선, 없으면 베이스 값 폴백.
function getMarketCfg(cfg, market) {
  const out = Object.assign({}, cfg);
  const m = (cfg.markets && cfg.markets[market]) || {};
  for (const k of MARKET_SCOPED_KEYS) {
    if (m[k] !== undefined) out[k] = m[k];
  }
  return out;
}

// cfg를 받아서 markets 구조가 없으면 현재 베이스 값을 양쪽에 복제해서 생성.
// 이미 있으면 그대로. 베이스에 markets 누락된 키만 채워줌.
function migrateCfgToMarkets(cfg) {
  // [V8.7] 저장된 cfg에 남아있는 무효/구형 모델 ID를 유효한 현행 ID로 자동 교정.
  //   얕은 병합(Object.assign) 특성상 DB에 저장된 llmHybrid가 DEFAULT_CFG를 통째로
  //   덮어쓰므로, 옛 'claude-opus-4-5' 등이 그대로 남아 404("서버를 찾을 수 없음")를 유발할 수 있음.
  const VALID_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-haiku-4-5"];
  const FALLBACK_MODEL = "claude-sonnet-4-6";
  if (cfg.llmHybrid && typeof cfg.llmHybrid === "object") {
    if (!cfg.llmHybrid.model || VALID_MODELS.indexOf(cfg.llmHybrid.model) === -1) {
      cfg.llmHybrid.model = FALLBACK_MODEL;
    }
    if (typeof cfg.llmHybrid.maxRetries !== "number") cfg.llmHybrid.maxRetries = 2;
    if (typeof cfg.llmHybrid.timeoutMs !== "number") cfg.llmHybrid.timeoutMs = 20000;
  }

  if (!cfg.markets) cfg.markets = {};
  for (const market of ['us', 'kr']) {
    if (!cfg.markets[market]) cfg.markets[market] = {};
    for (const k of MARKET_SCOPED_KEYS) {
      if (cfg.markets[market][k] === undefined && cfg[k] !== undefined) {
        // 객체는 deep clone (이후 시장별 변경이 베이스를 오염시키지 않게)
        cfg.markets[market][k] = (typeof cfg[k] === 'object' && cfg[k] !== null)
          ? JSON.parse(JSON.stringify(cfg[k]))
          : cfg[k];
      }
    }
  }
  return cfg;
}

// [V8.6] 미국 DST(서머타임) 자동 판정
// 2007년 이후 규칙: 3월 둘째 일요일 02:00 ET ~ 11월 첫째 일요일 02:00 ET
// 반환: UTC 대비 ET 오프셋(-4 = EDT 서머타임, -5 = EST 겨울)
function getUSEtOffset(now) {
  const year = now.getUTCFullYear();
  // 3월 둘째 일요일 찾기 (UTC 기준 자정 사용 — 약간의 경계 오차는 무시)
  function nthSundayOfMonth(y, monthIdx, n) {
    const d = new Date(Date.UTC(y, monthIdx, 1));
    const firstDow = d.getUTCDay(); // 0=Sun
    const firstSunday = (firstDow === 0) ? 1 : (8 - firstDow);
    return firstSunday + (n - 1) * 7;
  }
  const dstStartDay = nthSundayOfMonth(year, 2, 2);  // March, 2nd Sunday
  const dstEndDay   = nthSundayOfMonth(year, 10, 1); // November, 1st Sunday
  // DST 전환은 현지 02:00에 발생. UTC 기준 ET 02:00 = EST면 UTC 07:00, EDT면 UTC 06:00.
  // 단순화: 해당 일자의 UTC 자정~다음날 자정 사이에 있는 경우 안전쪽으로 처리.
  // Spring forward: 그 날 07:00 UTC부터 EDT 적용
  // Fall back: 그 날 06:00 UTC까지 EDT, 그 이후 EST
  const dstStart = Date.UTC(year, 2, dstStartDay, 7, 0, 0);  // 07:00 UTC = 02:00 EST -> EDT 시작
  const dstEnd   = Date.UTC(year, 10, dstEndDay, 6, 0, 0);   // 06:00 UTC = 02:00 EDT -> EST 복귀
  const t = now.getTime();
  return (t >= dstStart && t < dstEnd) ? -4 : -5;
}

// [V8.6] 미국 ET 분 단위 시각 + 요일 (DST 자동 반영)
function getUSEt(now) {
  const offset = getUSEtOffset(now);
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  let etTotalMin = utcMin + offset * 60;
  let dayShift = 0;
  if (etTotalMin < 0) { etTotalMin += 24 * 60; dayShift = -1; }
  if (etTotalMin >= 24 * 60) { etTotalMin -= 24 * 60; dayShift = 1; }
  let etDay = (now.getUTCDay() + dayShift + 7) % 7;
  return { totalMin: etTotalMin, day: etDay, offset: offset };
}

// [V8.6] KST 분 단위 시각 + 요일
function getKST(now) {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  let kstTotalMin = utcMin + 9 * 60;
  let dayShift = 0;
  if (kstTotalMin >= 24 * 60) { kstTotalMin -= 24 * 60; dayShift = 1; }
  let kstDay = (now.getUTCDay() + dayShift) % 7;
  return { totalMin: kstTotalMin, day: kstDay };
}

// 실제 거래소 정규장 시간 — 시세 자체가 생성되는 시간
// US: 09:30~16:00 ET (DST 자동)
// KR: 09:00~15:30 KST
function isMarketOpen(market) {
  const now = new Date();
  if (market === "us") {
    const et = getUSEt(now);
    return et.day >= 1 && et.day <= 5 && et.totalMin >= 570 && et.totalMin < 960;
  }
  if (market === "kr") {
    const kst = getKST(now);
    return kst.day >= 1 && kst.day <= 5 && kst.totalMin >= 540 && kst.totalMin < 930;
  }
  return false;
}

// [V8.6 신규] 엔진이 거래해도 되는 시간 — 야후 KR 시세 15분 지연 보정
// US: 09:30~16:00 ET (실시간이므로 정규장과 동일)
// KR: 09:15~15:45 KST (15분 지연 데이터로 거래하므로 시작도 15분 늦추고 종료도 15분 늦춤)
//     이로써 모든 매매가 "15분 전 실제 가격" 기준이 됨 — 데이터-가격 일치 보장.
function isTradingWindow(market) {
  const now = new Date();
  if (market === "us") {
    const et = getUSEt(now);
    return et.day >= 1 && et.day <= 5 && et.totalMin >= 570 && et.totalMin < 960;
  }
  if (market === "kr") {
    const kst = getKST(now);
    // 09:15 = 555, 15:45 = 945
    return kst.day >= 1 && kst.day <= 5 && kst.totalMin >= 555 && kst.totalMin < 945;
  }
  return false;
}

// [V8.6 신규] LLM 트리거 시각 판정 — cron이 매분 돌 때 "지금이 분석 트리거 시각인가" 체크
// KR: 09:00 KST (정규장 시작, 지연 데이터지만 데이터 자체는 이미 수집됨)
// US: 시장시작 10분 전 = 09:20 ET (DST 자동)
// 트리거가 cron 사이클 사이에 정확히 들어가도록 ±1분 윈도우 허용.
function isLLMTriggerTime(market) {
  const now = new Date();
  if (market === "kr") {
    const kst = getKST(now);
    if (kst.day < 1 || kst.day > 5) return false;
    // 09:00 KST = 540분, 한 사이클(1분) 안에 정확히 매치되도록
    return kst.totalMin === 540;
  }
  if (market === "us") {
    const et = getUSEt(now);
    if (et.day < 1 || et.day > 5) return false;
    // 09:20 ET = 560분 (정규장 09:30 시작 10분 전)
    return et.totalMin === 560;
  }
  return false;
}

// [V9 매크로] 경제지표 자동 갱신 트리거 — 매일 아침 07:00 KST 1회.
//   주말 포함 매일 도는 이유: 발표가 미국 새벽(한국 밤)에 자주 나므로
//   아침에 한 번 긁으면 전날 발표분까지 모두 반영됨. cron 1분 간격이라 07:00 정각에 매치.
function isMacroTriggerTime() {
  const now = new Date();
  const kst = getKST(now);
  return kst.totalMin === 420;  // 07:00 KST = 420분
}

// [COMMODITY] 원자재 거래 트리거 — 매일 16:00 KST 1회, 평일만.
//   사용자 요청: "거래도 16시에만". cron 1분 간격이라 16:00 정각에 정확히 매치.
//   16:00 KST = 960분.
function isCommodityTriggerTime() {
  const now = new Date();
  const kst = getKST(now);
  if (kst.day < 1 || kst.day > 5) return false;  // 평일만
  return kst.totalMin === 960;  // 16:00 KST = 960분
}

// [V8.6] 장 마감까지 남은 분 — Day 전략 강제 청산용
// US: 16:00 ET 마감 기준 (DST 자동)
// KR: 15:45 KST 기준 — 야후 15분 지연 데이터로 거래하므로 거래 윈도우 마감 시각 사용.
//     실제 거래소는 15:30 마감이지만 우리가 보는 15:30 데이터는 15:15 시점의 가격이므로
//     15:45까지 거래해야 실제 15:30 마감 직전 가격으로 청산 가능.
function marketMinutesUntilClose(market) {
  const now = new Date();
  if (market === "us") {
    const et = getUSEt(now);
    if (et.day < 1 || et.day > 5) return null;
    if (et.totalMin < 570 || et.totalMin >= 960) return null;
    return 960 - et.totalMin;  // 16:00 ET
  }
  if (market === "kr") {
    const kst = getKST(now);
    if (kst.day < 1 || kst.day > 5) return null;
    // 거래 윈도우: 09:15~15:45
    if (kst.totalMin < 555 || kst.totalMin >= 945) return null;
    return 945 - kst.totalMin;  // 15:45 KST (거래 윈도우 종료)
  }
  return null;
}

// ============================================================
// [V8.6 Hybrid] Claude LLM 일일 지시 통합
// ============================================================

// 시장 데이터 수집 — Claude에게 보낼 컨텍스트
async function collectLLMContext(DB, env, market) {
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));

  const sinceTs = Date.now() - 7 * 24 * 3600 * 1000;
  const recentTrades = await DB.prepare(
    "SELECT side, symbol, pnl_pct, reason, ts FROM trades WHERE market = ? AND ts >= ? AND side = 'SELL' ORDER BY ts DESC LIMIT 50"
  ).bind(market, sinceTs).all();
  const sells = recentTrades.results || [];

  const wins = sells.filter(function(t) { return (t.pnl_pct || 0) > 0; });
  const losses = sells.filter(function(t) { return (t.pnl_pct || 0) <= 0; });
  const totalPnl = sells.reduce(function(a, t) { return a + (t.pnl_pct || 0); }, 0);

  const positions = await DB.prepare(
    "SELECT symbol, strategy, qty, avg_price FROM positions WHERE market = ?"
  ).bind(market).all();
  const cashState = await getState(DB, "cash", {});

  const signalStats = await getState(DB, "signal_stats", {});
  const topSignals = Object.keys(signalStats)
    .map(function(k) { return Object.assign({ name: k }, signalStats[k]); })
    .filter(function(s) { return s.count >= 5; })
    .sort(function(a, b) { return (b.weightedWinRate || 0) - (a.weightedWinRate || 0); })
    .slice(0, 15);

  // [V9] 손실 집중 신호 — 하위 성과 신호도 LLM에 보여줘 disable 판단을 도움.
  //   (기존엔 top만 보여줘서 "뭘 꺼야 할지" 근거가 부족했음)
  const worstSignals = Object.keys(signalStats)
    .map(function(k) { return Object.assign({ name: k }, signalStats[k]); })
    .filter(function(s) { return s.count >= 5; })
    .sort(function(a, b) { return (a.weightedWinRate || 0) - (b.weightedWinRate || 0); })
    .slice(0, 8);

  // [V9] 전략별 7일 성과 — 5/20 같은 동반손실 패턴을 LLM이 인지하도록.
  const byStrategy = {};
  for (const t of sells) {
    const m = /\[([A-Z]+)\]/.exec(t.reason || "");
    const st = m ? m[1].toLowerCase() : "unknown";
    if (!byStrategy[st]) byStrategy[st] = { trades: 0, wins: 0, sumPnl: 0 };
    byStrategy[st].trades++;
    if ((t.pnl_pct || 0) > 0) byStrategy[st].wins++;
    byStrategy[st].sumPnl += (t.pnl_pct || 0);
  }
  const strategyPerf = {};
  for (const st in byStrategy) {
    const b = byStrategy[st];
    strategyPerf[st] = {
      trades: b.trades,
      winRate: b.trades > 0 ? +(b.wins / b.trades).toFixed(3) : 0,
      avgPnl: b.trades > 0 ? +(b.sumPnl / b.trades).toFixed(3) : 0
    };
  }

  const indices = market === "us" ? US_INDICES : KR_INDICES;
  const indexQuotes = {};
  let worstIdxPct = null, sumIdxPct = 0, idxCnt = 0;
  for (const idx of indices) {
    const q = await getState(DB, "index:" + idx, null);
    if (q) {
      indexQuotes[idx] = { price: q.price, dayChangePct: q.dayChangePct };
      // [V9] 지수 변동 요약 — regime 근거
      if (typeof q.dayChangePct === "number") {
        sumIdxPct += q.dayChangePct; idxCnt++;
        if (worstIdxPct === null || q.dayChangePct < worstIdxPct) worstIdxPct = q.dayChangePct;
      }
    }
  }
  // [V9] 시장 상태 요약 — LLM이 "오늘 약세인가"를 명확히 보도록 단순화한 신호 제공
  const marketSnapshot = {
    avgIndexChangePct: idxCnt > 0 ? +(sumIdxPct / idxCnt).toFixed(2) : null,
    worstIndexChangePct: worstIdxPct !== null ? +worstIdxPct.toFixed(2) : null,
    note: (worstIdxPct !== null && worstIdxPct <= -1.0)
      ? "주의: 지수 중 하나가 -1% 이상 하락 — 약세 가능성"
      : "지수 특이 약세 신호 없음"
  };

  // [V9 매크로] 최근 발표(0~4일 이내) 경제지표만 추려 LLM에 '살짝' 반영용으로 전달.
  //   released(발표일) 기준. 4일 지난 지표나 발표일 불명 지표는 제외 → 평상시엔 빈 배열.
  //   국채/국고채 같은 '상시' 시중금리(released만 있고 발표 이벤트성 아님)는 제외.
  const macroData = await getState(DB, "macro_data", null);
  const freshMacro = [];
  if (macroData && macroData[market]) {
    const EVENT_KEYS = market === "us"
      ? { fed_rate: "기준금리", cpi: "CPI", core_cpi: "근원CPI", ppi: "PPI", core_pce: "근원PCE", unemployment: "실업률" }
      : { base_rate: "기준금리", cpi: "CPI", ppi: "PPI" };
    const todayMs = Date.now();
    for (const key in EVENT_KEYS) {
      const item = macroData[market][key];
      if (!item || !item.released || item.value == null) continue;
      const relMs = Date.parse(item.released + "T00:00:00Z");
      if (isNaN(relMs)) continue;
      const ageDays = Math.floor((todayMs - relMs) / 86400000);
      // 발표 당일(0) ~ 4일 이내만. 미래 날짜(음수)나 5일 이상 경과는 제외.
      if (ageDays < 0 || ageDays > 4) continue;
      freshMacro.push({
        name: EVENT_KEYS[key],
        value: String(item.value),
        asOf: item.asOf || "",
        released: item.released,
        daysAgo: ageDays
      });
    }
  }

  return {
    market: market,
    date: new Date().toISOString().slice(0, 10),
    indices: indexQuotes,
    marketSnapshot: marketSnapshot,
    cash: cashState[market] || 0,
    positions: (positions.results || []).map(function(p) {
      return { symbol: p.symbol, strategy: p.strategy, qty: p.qty, avg: p.avg_price };
    }),
    last7days: {
      trades: sells.length,
      winRate: sells.length > 0 ? (wins.length / sells.length) : 0,
      avgPnl: sells.length > 0 ? (totalPnl / sells.length) : 0,
      totalPnl: totalPnl,
      bestTrade: wins.length > 0 ? wins.reduce(function(a, b) { return a.pnl_pct > b.pnl_pct ? a : b; }) : null,
      worstTrade: losses.length > 0 ? losses.reduce(function(a, b) { return a.pnl_pct < b.pnl_pct ? a : b; }) : null
    },
    strategyPerf7d: strategyPerf,
    topSignals: topSignals,
    worstSignals: worstSignals,
    disabledSignals: cfg.disabledSignals || [],
    enabledStrategies: Object.keys(cfg.strategies || {}).filter(function(s) { return cfg.strategies[s]; }),
    // [V9 매크로] 발표 0~4일 이내 지표만. 비어있으면(평상시) LLM은 무시.
    recentMacro: freshMacro
  };
}

// [V8.7] callClaude — 안정성 강화판
//   • 일시적 실패(네트워크 끊김, 타임아웃, 429 rate-limit, 5xx 서버 에러)는 지수 백오프로 자동 재시도
//   • 영구적 실패(400/401/403/404 — 모델명 오류/인증 실패/권한 없음)는 재시도 없이 즉시 명확한 메시지로 중단
//   • 429는 retry-after 헤더 존중
//   • timeoutMs는 "시도당" 타임아웃 — 전체가 아니라 매 attempt마다 적용
// 이 함수는 "Claude 서버를 찾을 수 없다" 류의 일시적 연결 실패에 견디도록 설계됨.
async function callClaude(apiKey, model, prompt, maxTokens, timeoutMs, retryCfg) {
  retryCfg = retryCfg || {};
  const maxRetries = (typeof retryCfg.maxRetries === "number") ? retryCfg.maxRetries : 3;
  const baseBackoffMs = retryCfg.baseBackoffMs || 1000;
  const maxBackoffMs = retryCfg.maxBackoffMs || 8000;
  const perAttemptTimeout = timeoutMs || 25000;
  const usedModel = model || "claude-sonnet-4-6";
  // [V8.8] 요청 보낼 엔드포인트. 기본은 Anthropic 직통.
  //   Cloudflare Workers 출구 IP가 차단 지역(예: 홍콩)을 거쳐 403이 날 경우,
  //   AI Gateway나 외부 프록시 URL을 넣어 우회. 끝에 /v1/messages 포함한 전체 URL.
  const endpoint = retryCfg.baseURL || "https://api.anthropic.com/v1/messages";

  const sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
  const backoff = function(attempt) { return Math.min(baseBackoffMs * Math.pow(2, attempt), maxBackoffMs); };

  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(function() { controller.abort(); }, perAttemptTimeout);
    try {
      // [V8.8.1] 헤더 구성. AI Gateway에서 'Authenticated Gateway'를 켰다면
      //   cf-aig-authorization: Bearer {토큰} 헤더가 추가로 필요(없으면 게이트웨이가 403).
      //   retryCfg.aigToken(=env.AI_GATEWAY_TOKEN)이 있을 때만 붙임.
      const reqHeaders = {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      };
      if (retryCfg.aigToken) {
        reqHeaders["cf-aig-authorization"] = "Bearer " + retryCfg.aigToken;
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(Object.assign({
          model: usedModel,
          max_tokens: maxTokens || 2000,
          messages: [{ role: "user", content: prompt }]
        },
        // [V9 매크로] web_search 등 도구 사용 시 tools 배열 전달.
        //   tools가 있으면 Anthropic 서버가 tool_use↔tool_result 멀티턴을 자동 수행하고
        //   최종 text 블록만 우리에게 돌려줌. 응답 파싱은 기존과 동일(text 블록 join).
        (retryCfg.tools ? { tools: retryCfg.tools } : {}),
        (retryCfg.system ? { system: retryCfg.system } : {})
        )),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const text = (data.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("\n");
        return { text: text, usage: data.usage };
      }

      // --- 에러 응답 본문 읽기 ---
      const errText = await res.text().catch(function() { return ""; });
      const status = res.status;
      // [V8.8.1] 진단용: 게이트웨이 응답 헤더 캡처 — 어디서 막혔는지 구분.
      //   cf-aig-* 헤더가 있으면 게이트웨이가 응답한 것, cf-ray만 있으면 통과 후 Anthropic 응답.
      let diagHdr = "";
      try {
        const ray = res.headers.get("cf-ray");
        const aigErr = res.headers.get("cf-aig-error") || res.headers.get("cf-aig-event-id");
        if (aigErr) diagHdr += " aig=" + aigErr;
        if (ray) diagHdr += " ray=" + ray;
      } catch (he) { /* ignore */ }

      // --- 영구 에러: 재시도해도 동일하므로 즉시 중단 ---
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        let hint = "";
        if (status === 404) hint = " [모델 ID '" + usedModel + "'이(가) 잘못되었거나 사용 불가. 유효 예: claude-opus-4-7 / claude-sonnet-4-6 / claude-haiku-4-5-20251001]";
        else if (status === 401) hint = " [API 키 오류 — ANTHROPIC_API_KEY 확인]";
        else if (status === 403) hint = " [요청 거부됨(403). (a) AI Gateway URL이 .../anthropic/v1/messages 형식인지, (b) 게이트웨이 Authentication ON이면 AI_GATEWAY_TOKEN 환경변수 설정했는지, (c) API 키 권한/크레딧 확인. endpoint=" + endpoint + diagHdr + "]";
        else if (status === 400) hint = " [요청 형식 오류]";
        throw new Error("HTTP " + status + hint + ": " + errText.slice(0, 200));
      }

      // --- 일시 에러(429/5xx): 재시도 ---
      lastErr = new Error("HTTP " + status + ": " + errText.slice(0, 200));
      if (attempt < maxRetries) {
        let waitMs;
        const retryAfter = (res.headers && typeof res.headers.get === "function") ? res.headers.get("retry-after") : null;
        if (status === 429 && retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          waitMs = Math.min((isNaN(parsed) ? 2 : parsed) * 1000, maxBackoffMs);
        } else {
          waitMs = backoff(attempt);
        }
        await sleep(waitMs);
        continue;
      }
      throw lastErr;

    } catch (e) {
      clearTimeout(timeoutId);

      // 위에서 명시적으로 throw한 영구 에러(HTTP 4xx)는 그대로 전파
      if (/^HTTP (400|401|403|404)\b/.test(e.message || "")) throw e;

      // 타임아웃(Abort) 또는 네트워크 레벨 실패("서버 못 찾음" 포함) → 재시도 대상
      const isAbort = e.name === "AbortError";
      const isNetwork = (e instanceof TypeError) ||
        /fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|terminated|socket|dns/i.test(e.message || "");
      const retryable = isAbort || isNetwork;

      if (retryable && attempt < maxRetries) {
        lastErr = isAbort ? new Error("시도 타임아웃 (" + perAttemptTimeout + "ms)") : e;
        await sleep(backoff(attempt));
        continue;
      }

      if (isAbort) throw new Error("Claude 호출 타임아웃 (" + perAttemptTimeout + "ms × " + (attempt + 1) + "회 시도)");
      throw e;
    }
  }

  throw lastErr || new Error("callClaude: 알 수 없는 실패");
}

function parseLLMInstruction(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("empty response");
  }
  let clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = clean.indexOf("{");
  if (start === -1) throw new Error("no JSON in response");

  // [V9] 균형 중괄호 매칭 — summary 등에 '{','}' 가 섞여도 정확히 첫 객체만 추출.
  //   기존엔 lastIndexOf('}')로 잘라서, 본문에 중괄호가 있으면 잘못 잘릴 위험이 있었음.
  //   문자열 리터럴 내부의 중괄호는 무시(따옴표·이스케이프 추적).
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < clean.length; i++) {
    const c = clean[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) {
    // 균형이 안 맞으면(잘린 응답 등) 폴백: 기존 방식
    end = clean.lastIndexOf("}");
    if (end === -1 || end < start) throw new Error("unbalanced JSON in response");
  }
  return JSON.parse(clean.slice(start, end + 1));
}

function sanitizeInstruction(raw, llmCfg) {
  // [V9] raw가 객체가 아니거나 null이면 안전한 기본값 반환 (방어)
  if (!raw || typeof raw !== "object") raw = {};
  // [V9] 유한한 숫자인지 검사 헬퍼 — NaN/Infinity 차단
  const isFiniteNum = function(x) { return typeof x === "number" && isFinite(x); };
  const sane = {
    sentiment: ["bearish", "neutral", "bullish"].indexOf(raw.sentiment) >= 0 ? raw.sentiment : "neutral",
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 500) : "",
    // [V9.1] reasoning — LLM 추론 과정 보존 (사후 검증·로깅용). 거래 로직엔 직접 안 쓰지만 투명성 확보.
    reasoning: (raw.reasoning && typeof raw.reasoning === "object") ? {
      market_regime: typeof raw.reasoning.market_regime === "string" ? raw.reasoning.market_regime.slice(0, 300) : "",
      performance: typeof raw.reasoning.performance === "string" ? raw.reasoning.performance.slice(0, 300) : "",
      signal_quality: typeof raw.reasoning.signal_quality === "string" ? raw.reasoning.signal_quality.slice(0, 300) : "",
      symbol_risk: typeof raw.reasoning.symbol_risk === "string" ? raw.reasoning.symbol_risk.slice(0, 300) : "",
      macro_influence: typeof raw.reasoning.macro_influence === "string" ? raw.reasoning.macro_influence.slice(0, 300) : ""
    } : null,
    // [V9.1] confidence — 0~1로 클램프. 없거나 비정상이면 0.5(중립적 확신).
    confidence: isFiniteNum(raw.confidence) ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
    buy_signals: { enabled: raw.buy_signals && raw.buy_signals.enabled !== false },
    sell_signals: { enabled: !(raw.sell_signals && raw.sell_signals.enabled === false) },
    disable_signals: Array.isArray(raw.disable_signals) ? raw.disable_signals.filter(function(s) { return typeof s === "string"; }).slice(0, 20) : [],
    avoid_symbols: Array.isArray(raw.avoid_symbols) ? raw.avoid_symbols.filter(function(s) { return typeof s === "string"; }).slice(0, 30) : [],
    position_sizing: { scale: 1.0 },
    stop_loss_adjustment: null
  };
  if (raw.position_sizing && isFiniteNum(raw.position_sizing.scale)) {
    let s = raw.position_sizing.scale;
    if (s < llmCfg.minSizingScale) s = llmCfg.minSizingScale;
    if (s > llmCfg.maxSizingScale) s = llmCfg.maxSizingScale;
    // [V9.1] confidence 가중 — 확신이 낮으면 sizing 조정을 1.0 쪽으로 끌어당김(과잉개입 방지).
    //   예: scale=0.4, confidence=0.5 → 실제 적용 0.4*0.5 + 1.0*0.5 = 0.7 (개입 절반만)
    //   confidence=1.0이면 LLM 의도 그대로, 0이면 개입 안 함(1.0). 보수적 설계.
    if (llmCfg.confidenceWeighting !== false) {
      const c = sane.confidence;
      s = s * c + 1.0 * (1 - c);
    }
    sane.position_sizing.scale = +s.toFixed(3);
  }
  if (raw.stop_loss_adjustment && isFiniteNum(raw.stop_loss_adjustment.new_pct)) {
    let sp = raw.stop_loss_adjustment.new_pct;
    if (sp < llmCfg.minStopPct) sp = llmCfg.minStopPct;
    if (sp > llmCfg.maxStopPct) sp = llmCfg.maxStopPct;
    sane.stop_loss_adjustment = { new_pct: sp };
  }
  return sane;
}

function buildLLMPrompt(market, context) {
  const marketLabel = market === "us" ? "미국 (US)" : "한국 (KR)";
  return "당신은 LUX-engine 트레이딩 시스템의 일일 시장 리스크 분석가입니다.\n" +
    "역할: 종목을 직접 고르지 않습니다. 오늘 " + marketLabel + " 시장의 '리스크 환경'을 평가해,\n" +
    "알고리즘이 쓸 거시 거래 지시(sizing/신호 on-off/회피종목)를 JSON으로 출력합니다.\n\n" +
    "# 컨텍스트\n```json\n" + JSON.stringify(context, null, 2) + "\n```\n\n" +
    "# 분석 절차 (반드시 이 순서로 사고할 것)\n" +
    "1) 시장 국면: marketSnapshot(avg/worstIndexChangePct)과 indices를 보고 강세/중립/약세 판정.\n" +
    "   - worstIndexChangePct <= -1.5% → 강한 약세 신호 / -1.0%~-1.5% → 약세 주의 / +0.5% 이상 광범위 상승 → 강세\n" +
    "2) 최근 성과 진단: last7days.winRate와 avgPnl, strategyPerf7d를 보고 시스템이 현재 시장에 맞는지 평가.\n" +
    "   - winRate < 0.40 이고 거래수가 충분(>=20)하면 → 시장 부적합 가능성 → 보수적으로.\n" +
    "3) 신호 품질: worstSignals 중 count>=8 이고 winRate가 낮은 것만 disable 후보로. 표본 작으면 건드리지 말 것.\n" +
    "4) 종목 리스크: positions와 worstTrade를 보고 손실 집중 종목이 있으면 avoid_symbols 후보로.\n" +
    "5) 종합: 위 1~4를 근거로 sentiment / sizing / stop을 결정. 각 결정은 반드시 데이터 수치를 근거로 들 것.\n" +
    "6) [보조] 최근 경제지표: context.recentMacro는 '최근 4일 이내 발표된' 경제지표만 담겨 있습니다(없으면 빈 배열).\n" +
    "   - 비어 있으면 이 단계는 건너뛰고 매크로를 일절 언급하지 마세요.\n" +
    "   - 값이 있으면 '아주 약하게'만 반영합니다. 이것은 보조 신호이며, 위 1~5의 데이터 기반 판단을 뒤집어선 안 됩니다.\n" +
    "   - 반영은 sizing scale에 ±0.1, stop에 소폭(±0.1~0.2) 정도로 제한. sentiment를 매크로만으로 바꾸지 말 것.\n" +
    "   - 방향성 예시(절대 규칙 아님, 참고용): CPI·PPI·근원PCE가 시장 기대 대비 '높게(인플레 가속)' 나오면 긴축 우려 → 약하게 보수적(sizing -0.1). 물가가 '낮게(둔화)' 나오면 약하게 우호적(sizing +0.1). 기준금리 인상은 보수적, 인하는 우호적. 실업률 급등은 경기둔화 우려.\n" +
    "   - 단, recentMacro에는 발표값만 있고 '시장 기대치'는 없으니, 수치 해석이 모호하면 반영하지 말 것(무개입 우선).\n" +
    "   - daysAgo가 클수록(발표 후 시간 경과) 영향력은 더 작게.\n\n" +
    "# 정량 가이드 (참고 기준 — 맥락에 따라 조정 가능)\n" +
    "- 강한 약세: sizing 0.3~0.5, buy_signals OFF 고려, stop 0.8~1.0\n" +
    "- 약세 주의: sizing 0.5~0.8, stop 1.0~1.2\n" +
    "- 중립: sizing 0.9~1.1, stop 변경 없음(null)\n" +
    "- 강세: sizing 1.2~1.4, stop 1.2~1.5\n\n" +
    "# 판단 원칙\n" +
    "- 모든 결론은 컨텍스트의 '구체적 수치'에 근거할 것. 데이터에 없는 외부 뉴스·예측을 지어내지 말 것.\n" +
    "- 표본이 작으면(거래수 적음, count 낮음) 단정하지 말고 neutral·sizing 1.0 유지.\n" +
    "- 한두 건의 우연한 손실로 신호·전략을 끄지 말 것.\n" +
    "- 불확실하면 confidence를 낮추고 보수적으로. 과잉 개입보다 무개입이 안전.\n\n" +
    "# 출력 형식 (JSON만, 코드블록·머리말 금지)\n" +
    "reasoning 필드에 위 1~5단계 사고를 간결히 적고, 그 결론을 나머지 필드에 반영하세요.\n" +
    "{\n" +
    "  \"reasoning\": {\n" +
    "    \"market_regime\": \"국면 판정 + 근거 수치 (예: worstIdx -1.6% → 강한 약세)\",\n" +
    "    \"performance\": \"최근 성과 진단 (예: 7일 winRate 0.38, day전략 부진)\",\n" +
    "    \"signal_quality\": \"disable 후보와 근거 (없으면 '해당 없음')\",\n" +
    "    \"symbol_risk\": \"손실 집중 종목 (없으면 '해당 없음')\",\n" +
    "    \"macro_influence\": \"최근 4일내 지표 반영 내용 + 방향 (recentMacro 비었으면 '해당 없음')\"\n" +
    "  },\n" +
    "  \"sentiment\": \"neutral\",\n" +
    "  \"confidence\": 0.6,\n" +
    "  \"summary\": \"한두 문장 핵심 판단 + 근거 수치\",\n" +
    "  \"buy_signals\": { \"enabled\": true },\n" +
    "  \"sell_signals\": { \"enabled\": true },\n" +
    "  \"disable_signals\": [],\n" +
    "  \"avoid_symbols\": [],\n" +
    "  \"position_sizing\": { \"scale\": 1.0 },\n" +
    "  \"stop_loss_adjustment\": null\n" +
    "}\n\n" +
    "JSON만 출력하세요. confidence는 0~1 사이. 설명/머리말/코드블록 표시 모두 금지.";
}

async function runLLMDailyAnalysis(env, market, forceRun = false) {
  const DB = env.DB;
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
  const llmCfg = cfg.llmHybrid || {};

  if (!llmCfg.enabled) {
    return { ok: false, reason: "disabled" };
  }
  if (!env.ANTHROPIC_API_KEY) {
    await log(DB, "WARN", null, "[LLM] ANTHROPIC_API_KEY not set");
    return { ok: false, reason: "no_api_key" };
  }
  
  // [V8.6] 강제 실행 모드 (테스트용) — forceRun=true면 시장 체크 무시
  if (!forceRun) {
    const isOpen = market === "us" ? isTradingWindow("us") : isTradingWindow("kr");
    if (!isOpen) {
      return { ok: false, reason: "market_closed", forceRun: false };
    }
  }

  try {
    await log(DB, "INFO", null, "[LLM] daily analysis start: " + market);
    const context = await collectLLMContext(DB, env, market);
    const prompt = buildLLMPrompt(market, context);

    const res = await callClaude(
      env.ANTHROPIC_API_KEY,
      llmCfg.model || "claude-sonnet-4-6",
      prompt,
      llmCfg.maxTokens || 2000,
      llmCfg.timeoutMs || 25000,
      {
        maxRetries: (typeof llmCfg.maxRetries === "number" ? llmCfg.maxRetries : 2),
        // [V8.8] 환경변수로 우회 엔드포인트 지정 가능. 없으면 Anthropic 직통.
        baseURL: env.LLM_BASE_URL || (llmCfg.baseURL || null),
        // [V8.8.1] AI Gateway 'Authenticated Gateway' ON일 때 필요한 토큰. 없으면 헤더 미첨부.
        aigToken: env.AI_GATEWAY_TOKEN || null
      }
    );

    let raw;
    try {
      raw = parseLLMInstruction(res.text);
    } catch (e) {
      await log(DB, "WARN", null, "[LLM] parse fail (" + market + "): " + e.message);
      return { ok: false, reason: "parse_fail", raw: res.text };
    }

    const sanitized = sanitizeInstruction(raw, llmCfg);
    const instruction = {
      market: market,
      generatedAt: Date.now(),
      expiresAt: Date.now() + (llmCfg.expiryHours || 18) * 3600 * 1000,
      instruction: sanitized,
      rawResponse: res.text,
      usage: res.usage
    };

    await setState(DB, "llm_daily:" + market, instruction);
    const macroCnt = (context.recentMacro || []).length;
    await log(DB, "INFO", null,
      "[LLM] " + market + " sentiment=" + sanitized.sentiment +
      " conf=" + sanitized.confidence +
      " buy=" + (sanitized.buy_signals.enabled ? "ON" : "OFF") +
      " sizing=" + sanitized.position_sizing.scale +
      " avoid=" + sanitized.avoid_symbols.length +
      " disable=" + sanitized.disable_signals.length +
      " macro=" + macroCnt + "건(4일내)" +
      (sanitized.reasoning ? " | regime: " + (sanitized.reasoning.market_regime || "").slice(0, 80) : "")
    );
    return { ok: true, instruction: sanitized };
  } catch (e) {
    await log(DB, "ERROR", null, "[LLM] " + market + " fail: " + e.message);
    return { ok: false, reason: "exception", error: e.message };
  }
}

async function getActiveLLMInstruction(DB, market) {
  const stored = await getState(DB, "llm_daily:" + market, null);
  if (!stored) return null;
  if (!stored.expiresAt || Date.now() > stored.expiresAt) return null;
  return stored.instruction || null;
}

// ============================================================
// [V9 매크로] 경제지표 자동 갱신 — Claude + web_search
//   매일 07:00 KST에 1회. 미국/한국 핵심 지표의 "최신 공표치"를 검색해 채움.
//   발표 일정(다음 발표일)은 정적이라 프론트의 MACRO_SCHEDULE에서 관리하고,
//   여기서는 수치(value)와 그 수치의 기준월(asOf)/실제 발표일(released)만 갱신.
//
// 정확도 강화 장치 (이 순서로 환각을 억제):
//   1) web_search 도구 강제 — 학습 기억이 아닌 검색 결과만 쓰도록 system에 못박음
//   2) 지표별 1차 출처 명시(BLS/BEA/Fed/한국은행/통계청) — 검색 쿼리 품질↑
//   3) "확신 없으면 null" 규칙 — 추측 금지. 못 찾은 값은 빈칸으로 두고 기존값 유지
//   4) 출처 URL + 발표일 동반 요구 — 근거 없는 숫자 배제
//   5) JSON 스키마 강제 + 서버측 sanity 범위 검사(금리 0~20%, 물가 -5~20%)
//   6) 실패/부분실패 시 기존 저장값 보존 — 절대 빈 화면 안 만듦
// ============================================================
const MACRO_INDICATORS = {
  us: [
    { key: "fed_rate", name: "기준금리(Fed Funds target range)", source: "Federal Reserve FOMC", range: [0, 20] },
    { key: "cpi",      name: "CPI 소비자물가 전년동월비(headline, YoY %)", source: "BLS", range: [-5, 25] },
    { key: "core_cpi", name: "근원 CPI 전년동월비(Core CPI YoY %)", source: "BLS", range: [-5, 25] },
    { key: "ppi",      name: "PPI 생산자물가 전년동월비(final demand YoY %)", source: "BLS", range: [-10, 30] },
    { key: "core_pce", name: "근원 PCE 전년동월비(Core PCE YoY %)", source: "BEA", range: [-5, 25] },
    { key: "unemployment", name: "실업률(Unemployment rate %)", source: "BLS", range: [0, 30] },
    { key: "ust10y",   name: "미국 국채 10년 금리(10Y Treasury yield %)", source: "U.S. Treasury / market", range: [0, 20] }
  ],
  kr: [
    { key: "base_rate", name: "한국은행 기준금리(%)", source: "한국은행 금융통화위원회", range: [0, 20] },
    { key: "cpi",       name: "한국 소비자물가 전년동월비(YoY %)", source: "통계청", range: [-5, 25] },
    { key: "ppi",       name: "한국 생산자물가 전년동월비(YoY %)", source: "한국은행", range: [-10, 30] },
    { key: "ktb3y",     name: "국고채 3년 금리(%)", source: "금융투자협회/시장", range: [0, 20] },
    { key: "ktb10y",    name: "국고채 10년 금리(%)", source: "금융투자협회/시장", range: [0, 20] }
  ]
};

function buildMacroPrompt() {
  const todayStr = new Date().toISOString().slice(0, 10);
  function listFor(arr) {
    return arr.map(function(i) {
      return '  - key="' + i.key + '" : ' + i.name + ' (1차 출처: ' + i.source + ')';
    }).join("\n");
  }
  return [
    "오늘 날짜는 " + todayStr + " (UTC 기준)입니다. 당신은 거시경제 데이터 수집기입니다.",
    "아래 미국/한국 경제지표 각각의 **가장 최근에 공식 발표된 값**을 web_search로 직접 찾아 채우세요.",
    "",
    "[미국]",
    listFor(MACRO_INDICATORS.us),
    "",
    "[한국]",
    listFor(MACRO_INDICATORS.kr),
    "",
    "엄격한 규칙:",
    "1. 반드시 web_search로 확인한 값만 사용하세요. 당신의 기억/추측으로 채우지 마세요.",
    "2. 각 지표의 1차 출처(괄호 안 기관) 또는 그 수치를 인용한 신뢰할 수 있는 보도를 우선하세요.",
    "3. 값을 확신할 수 없으면 그 지표는 value를 null로 두세요. 추측 금지. (null이면 서버가 기존값을 유지합니다)",
    "4. 금리/수익률은 % 숫자만(예: 4.5). 미국 기준금리는 목표범위 문자열 허용(예: \"3.50-3.75\").",
    "5. 물가지표는 별도 언급 없으면 전년동월비(YoY) %를 사용하세요.",
    "6. 각 값마다 그 수치가 가리키는 기준월(asOf, 예: \"2026-04\" 또는 \"4월분\"), 실제 발표일(released, YYYY-MM-DD), 출처 URL(source_url)을 함께 적으세요. 모르면 빈 문자열.",
    "",
    "출력은 아래 JSON **하나만**. 코드펜스/설명/머리말 없이 순수 JSON만 출력하세요:",
    "{",
    '  "us": { "fed_rate": {"value": "3.50-3.75", "asOf": "", "released": "2026-04-29", "source_url": "..."}, "cpi": {...}, "core_cpi": {...}, "ppi": {...}, "core_pce": {...}, "unemployment": {...}, "ust10y": {...} },',
    '  "kr": { "base_rate": {...}, "cpi": {...}, "ppi": {...}, "ktb3y": {...}, "ktb10y": {...} }',
    "}"
  ].join("\n");
}

function parseMacroJSON(text) {
  if (!text) throw new Error("empty");
  let s = text.trim();
  // 코드펜스 제거
  s = s.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
  // 가장 바깥 중괄호 추출
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b <= a) throw new Error("no json braces");
  return JSON.parse(s.slice(a, b + 1));
}

// 값 정제 + 범위 검사. 통과 못하면 null 반환 → 기존값 유지.
function sanitizeMacroValue(rawVal, range) {
  if (rawVal === null || rawVal === undefined) return null;
  let str = String(rawVal).trim();
  if (!str || /^(n\/?a|unknown|null|모름|미상)$/i.test(str)) return null;
  // 범위가 문자열(예: "3.50-3.75")이면 첫 숫자로 sanity 체크만
  const firstNum = parseFloat(str.replace(/[^0-9.\-]/g, ""));
  if (!isFinite(firstNum)) return null;
  if (range && (firstNum < range[0] || firstNum > range[1])) return null;
  return str;
}

async function runMacroUpdate(env, forceRun = false) {
  const DB = env.DB;
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
  const mCfg = cfg.macro || {};

  if (!mCfg.enabled && !forceRun) {
    return { ok: false, reason: "disabled" };
  }
  if (!env.ANTHROPIC_API_KEY) {
    await log(DB, "WARN", null, "[MACRO] ANTHROPIC_API_KEY not set");
    return { ok: false, reason: "no_api_key" };
  }

  try {
    await log(DB, "INFO", null, "[MACRO] update start");
    const prompt = buildMacroPrompt();
    const system = "당신은 정확성이 생명인 거시경제 데이터 수집기입니다. " +
      "오직 web_search로 확인된 최신 공식 수치만 보고하고, 확신이 없으면 null을 사용합니다. " +
      "절대 기억이나 추정으로 숫자를 만들어내지 마세요.";

    const res = await callClaude(
      env.ANTHROPIC_API_KEY,
      mCfg.model || "claude-sonnet-4-6",
      prompt,
      mCfg.maxTokens || 4000,
      mCfg.timeoutMs || 60000,   // web_search 멀티턴이라 넉넉히
      {
        maxRetries: (typeof mCfg.maxRetries === "number" ? mCfg.maxRetries : 2),
        baseURL: env.LLM_BASE_URL || (mCfg.baseURL || null),
        aigToken: env.AI_GATEWAY_TOKEN || null,
        system: system,
        // web_search 도구 활성화. max_uses로 검색 횟수 상한(비용/시간 제어).
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: (mCfg.maxSearches || 12) }]
      }
    );

    let parsed;
    try {
      parsed = parseMacroJSON(res.text);
    } catch (e) {
      await log(DB, "WARN", null, "[MACRO] parse fail: " + e.message + " raw=" + (res.text || "").slice(0, 160));
      return { ok: false, reason: "parse_fail", raw: res.text };
    }

    // 기존 저장값 로드(부분 실패 시 보존용)
    const prev = await getState(DB, "macro_data", { us: {}, kr: {}, updatedAt: null });
    const next = { us: {}, kr: {}, updatedAt: Date.now(), source: "claude+web_search" };
    let filled = 0, kept = 0;

    ["us", "kr"].forEach(function(mkt) {
      MACRO_INDICATORS[mkt].forEach(function(ind) {
        const incoming = parsed[mkt] && parsed[mkt][ind.key];
        const cleanVal = incoming ? sanitizeMacroValue(incoming.value, ind.range) : null;
        if (cleanVal !== null) {
          next[mkt][ind.key] = {
            value: cleanVal,
            asOf: (incoming.asOf || "").toString().slice(0, 20),
            released: (incoming.released || "").toString().slice(0, 10),
            source_url: (incoming.source_url || "").toString().slice(0, 300),
            fetchedAt: Date.now()
          };
          filled++;
        } else if (prev[mkt] && prev[mkt][ind.key]) {
          // 새 값 없거나 검증 실패 → 기존값 유지
          next[mkt][ind.key] = prev[mkt][ind.key];
          kept++;
        }
      });
    });

    await setState(DB, "macro_data", next);
    await log(DB, "INFO", null, "[MACRO] update done: filled=" + filled + " kept=" + kept +
      " usage_in=" + ((res.usage && res.usage.input_tokens) || "?") +
      " out=" + ((res.usage && res.usage.output_tokens) || "?"));
    return { ok: true, filled: filled, kept: kept, data: next };
  } catch (e) {
    await log(DB, "ERROR", null, "[MACRO] update fail: " + e.message);
    return { ok: false, reason: "exception", error: e.message };
  }
}

async function ensureSchema(DB) {
  try {
    const cols = await DB.prepare("PRAGMA table_info(positions)").all();
    const colNames = (cols.results || []).map(function(c){ return c.name; });
    const hasMeta = colNames.indexOf("meta") !== -1;
    const hasStrategy = colNames.indexOf("strategy") !== -1;

    if (!hasMeta) {
      try {
        await DB.prepare("ALTER TABLE positions ADD COLUMN meta TEXT").run();
        await log(DB, "INFO", null, "schema migrated: added meta column");
      } catch (e) { console.error("alter meta fail:", e.message); }
    }

    // [V8] strategy 컬럼 추가 + composite PK 마이그레이션
    if (!hasStrategy) {
      try {
        // 1) strategy 컬럼 추가 (기존 row는 'swing'으로 채움)
        await DB.prepare("ALTER TABLE positions ADD COLUMN strategy TEXT NOT NULL DEFAULT 'swing'").run();
        await log(DB, "INFO", null, "schema migrated: added strategy column (default=swing)");

        // 2) 기존 PK가 symbol 단독이라 composite으로 재생성 필요
        // SQLite는 PK 변경 불가 → 테이블 재생성
        await DB.prepare("CREATE TABLE IF NOT EXISTS positions_new (symbol TEXT NOT NULL, strategy TEXT NOT NULL DEFAULT 'swing', market TEXT NOT NULL, qty REAL NOT NULL, avg_price REAL NOT NULL, opened_ts INTEGER NOT NULL, meta TEXT, PRIMARY KEY(symbol, strategy))").run();
        await DB.prepare("INSERT OR IGNORE INTO positions_new (symbol, strategy, market, qty, avg_price, opened_ts, meta) SELECT symbol, COALESCE(strategy, 'swing'), market, qty, avg_price, opened_ts, meta FROM positions").run();
        await DB.prepare("DROP TABLE positions").run();
        await DB.prepare("ALTER TABLE positions_new RENAME TO positions").run();
        await log(DB, "INFO", null, "schema migrated: composite PK (symbol, strategy)");
      } catch (e) {
        console.error("composite PK migration fail:", e.message);
        await log(DB, "WARN", null, "PK migration partial: " + e.message);
      }
    }
  } catch (e) {
    // positions 테이블 자체가 없는 경우 — 새로 생성
    try {
      await DB.prepare("CREATE TABLE IF NOT EXISTS positions (symbol TEXT NOT NULL, strategy TEXT NOT NULL DEFAULT 'swing', market TEXT NOT NULL, qty REAL NOT NULL, avg_price REAL NOT NULL, opened_ts INTEGER NOT NULL, meta TEXT, PRIMARY KEY(symbol, strategy))").run();
    } catch (e2) { console.error("schema create fail:", e2.message); }
  }
}

async function log(DB, level, symbol, message) {
  try {
    await DB.prepare("INSERT INTO logs (ts, level, symbol, message) VALUES (?, ?, ?, ?)")
      .bind(Date.now(), level, symbol, message).run();
  } catch (e) { console.error("log fail:", e.message); }
}

// === 지표 함수들 ===
function getRSI(h, p) {
  p = p || 14;
  if (!Array.isArray(h) || h.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = h[i] - h[i-1]; if (d > 0) g += d; else l -= d; }
  let aG = g / p, aL = l / p;
  for (let j = p + 1; j < h.length; j++) {
    const d = h[j] - h[j-1];
    aG = (aG * (p - 1) + (d > 0 ? d : 0)) / p;
    aL = (aL * (p - 1) + (d < 0 ? -d : 0)) / p;
  }
  if (aL === 0) return aG === 0 ? 50 : 100;
  return 100 - (100 / (1 + aG / aL));
}

function getMA(h, p) {
  if (!Array.isArray(h) || h.length < p) return null;
  let s = 0;
  for (let i = h.length - p; i < h.length; i++) s += h[i];
  return s / p;
}

// [수정] 진짜 True Range 기반 ATR — highs/lows/closes 사용
// 하위 호환: highs/lows가 없거나 길이 부족하면 close-to-close 변동량으로 fallback
function getATR(closes, p, highs, lows) {
  p = p || 14;
  if (!Array.isArray(closes) || closes.length < p + 1) return null;
  const hasHL = Array.isArray(highs) && Array.isArray(lows)
    && highs.length === closes.length && lows.length === closes.length;
  let s = 0;
  for (let i = closes.length - p; i < closes.length; i++) {
    let tr;
    if (hasHL && typeof highs[i] === "number" && typeof lows[i] === "number" && highs[i] > 0 && lows[i] > 0) {
      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - closes[i-1]);
      const lc = Math.abs(lows[i] - closes[i-1]);
      tr = Math.max(hl, hc, lc);
    } else {
      tr = Math.abs(closes[i] - closes[i-1]);
    }
    s += tr;
  }
  return s / p;
}

function getBollingerBands(h, p, mult) {
  p = p || 20; mult = mult || 2.0;
  if (!Array.isArray(h) || h.length < p) return null;
  const ma = getMA(h, p);
  let variance = 0;
  for (let i = h.length - p; i < h.length; i++) variance += Math.pow(h[i] - ma, 2);
  const std = Math.sqrt(variance / p);
  return { upper: ma + mult * std, lower: ma - mult * std, mid: ma };
}

function countDownDays(h, days) {
  days = days || 5;
  if (!Array.isArray(h) || h.length < days + 1) return 0;
  let count = 0;
  for (let i = h.length - days; i < h.length; i++) {
    if (h[i] < h[i-1]) count++;
  }
  return count;
}

// [신규] N일 수익률 계산
function getNDayReturn(h, n) {
  if (!Array.isArray(h) || h.length < n + 1) return null;
  const last = h[h.length - 1];
  const past = h[h.length - 1 - n];
  if (!past || past <= 0) return null;
  return (last - past) / past * 100;
}

function filterNulls(rawArr) {
  const out = [];
  for (let i = 0; i < rawArr.length; i++) {
    const v = rawArr[i];
    if (typeof v === "number" && !isNaN(v) && v > 0) out.push(v);
  }
  return out;
}

async function yahooFetch(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json"
    }
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

async function fetchIntraday(symbol) {
  const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1m&range=1d");
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("no intraday data");
  const meta = result.meta || {};
  const raw = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
  const closes = filterNulls(raw);
  const price = (typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0) ? meta.regularMarketPrice : (closes.length ? closes[closes.length - 1] : null);
  const prevClose = (typeof meta.chartPreviousClose === "number" && meta.chartPreviousClose > 0) ? meta.chartPreviousClose : (meta.previousClose || (closes.length ? closes[0] : price));
  return { symbol: symbol, price: price, prevClose: prevClose, closes: closes };
}

async function fetchDailyFull(symbol) {
  const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=3mo");
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("no daily data");
  const meta = result.meta || {};
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  // [수정] highs/lows도 같이 추출 — ATR True Range 계산용
  const rawCloses = quote.close || [];
  const rawHighs = quote.high || [];
  const rawLows = quote.low || [];
  const rawVols = quote.volume || [];
  // 인덱스 정렬을 유지하면서 null을 가진 row 전체를 제거
  const closes = [], highs = [], lows = [], volumes = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = rawCloses[i], h = rawHighs[i], l = rawLows[i], v = rawVols[i];
    if (typeof c !== "number" || isNaN(c) || c <= 0) continue;
    closes.push(c);
    highs.push((typeof h === "number" && !isNaN(h) && h > 0) ? h : c);
    lows.push((typeof l === "number" && !isNaN(l) && l > 0) ? l : c);
    volumes.push((typeof v === "number" && !isNaN(v) && v > 0) ? v : 0);
  }
  if (closes.length === 0) throw new Error("no daily close");
  const price = (typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0) ? meta.regularMarketPrice : closes[closes.length - 1];
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : price;
  return { symbol: symbol, price: price, prevClose: prevClose, closes: closes, highs: highs, lows: lows, volumes: volumes };
}

async function getDailyCached(DB, symbol, cacheMinutes) {
  const cached = await getState(DB, "daily:" + symbol, null);
  if (cached && cached.ts && (Date.now() - cached.ts) < cacheMinutes * 60 * 1000) {
    return cached;
  }
  const data = await fetchDailyFull(symbol);
  const toCache = {
    closes: data.closes,
    highs: data.highs,        // [신규]
    lows: data.lows,          // [신규]
    volumes: data.volumes,
    prevClose: data.prevClose,
    ts: Date.now()
  };
  await setState(DB, "daily:" + symbol, toCache);
  return toCache;
}

async function getState(DB, k, def) {
  try {
    const row = await DB.prepare("SELECT v FROM state WHERE k = ?").bind(k).first();
    if (!row) return def;
    try { return JSON.parse(row.v); } catch (e) { return def; }
  } catch (e) { return def; }
}

async function setState(DB, k, v) {
  await DB.prepare("INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_ts=excluded.updated_ts")
    .bind(k, JSON.stringify(v), Date.now()).run();
}

// === [V8] positions DAO — (symbol, strategy) 복합키 ===
// 반환 구조: { "SYMBOL::strategy": { qty, avg, opened_ts, meta, strategy, symbol } }
async function getPositions(DB, market) {
  try {
    const res = await DB.prepare("SELECT * FROM positions WHERE market = ?").bind(market).all();
    const map = {};
    for (const p of res.results) {
      const strategy = p.strategy || "swing";
      const key = p.symbol + "::" + strategy;
      map[key] = {
        symbol: p.symbol,
        strategy: strategy,
        qty: p.qty,
        avg: p.avg_price,
        opened_ts: p.opened_ts,
        meta: p.meta ? JSON.parse(p.meta) : {}
      };
    }
    return map;
  } catch (e) { return {}; }
}

// 특정 종목의 모든 전략 포지션 조회 (Set으로 strategy 반환)
function getStrategiesHeldForSymbol(positions, symbol) {
  const set = new Set();
  for (const key in positions) {
    if (positions[key].symbol === symbol) set.add(positions[key].strategy);
  }
  return set;
}

async function savePosition(DB, market, symbol, strategy, pos) {
  await DB.prepare(
    "INSERT INTO positions (symbol, strategy, market, qty, avg_price, opened_ts, meta) VALUES (?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(symbol, strategy) DO UPDATE SET qty=excluded.qty, avg_price=excluded.avg_price, meta=excluded.meta"
  ).bind(symbol, strategy, market, pos.qty, pos.avg, pos.opened_ts, JSON.stringify(pos.meta || {})).run();
}

async function deletePosition(DB, symbol, strategy) {
  await DB.prepare("DELETE FROM positions WHERE symbol = ? AND strategy = ?").bind(symbol, strategy).run();
}

async function recordTrade(DB, t) {
  await DB.prepare("INSERT INTO trades (ts, market, symbol, side, qty, price, pnl, pnl_pct, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(t.ts, t.market, t.symbol, t.side, t.qty, t.price, t.pnl == null ? null : t.pnl, t.pnl_pct == null ? null : t.pnl_pct, t.reason).run();
}

async function analyzeMarketRegime(DB, market) {
  const indices = market === "us" ? US_INDICES : KR_INDICES;
  let totalDayPct = 0, validIdx = 0;
  let aboveMa = 0, belowMa = 0;
  let worstDayPct = 999;
  // [신규] 지수 평균 20일 수익률 → RS 비교 기준
  let idxReturns = [];
  for (const sym of indices) {
    const idx = await getState(DB, "index:" + sym, null);
    if (!idx || typeof idx.dayPct !== "number") continue;
    totalDayPct += idx.dayPct;
    validIdx++;
    if (idx.dayPct < worstDayPct) worstDayPct = idx.dayPct;
    if (idx.history && idx.history.length >= 20) {
      const ma20 = getMA(idx.history, 20);
      if (ma20 != null) {
        if (idx.price >= ma20) aboveMa++; else belowMa++;
      }
      const ret20 = getNDayReturn(idx.history, 20);
      if (ret20 != null) idxReturns.push(ret20);
    }
  }
  let avgIdxReturn = null;
  if (idxReturns.length > 0) {
    avgIdxReturn = idxReturns.reduce(function(a,b){ return a+b; }, 0) / idxReturns.length;
  }
  if (validIdx === 0) return { regime: "UNKNOWN", avgDayPct: 0, worstDayPct: 0, idxReturn20: null };
  const avgDayPct = totalDayPct / validIdx;
  let regime = "NEUTRAL";
  if (aboveMa > belowMa) regime = "BULL";
  else if (belowMa > aboveMa) regime = "BEAR";
  return { regime: regime, avgDayPct: avgDayPct, worstDayPct: worstDayPct, aboveMa: aboveMa, belowMa: belowMa, idxReturn20: avgIdxReturn };
}

async function fetchIndexDaily(symbol) {
  const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=3mo");
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("no idx data");
  const meta = result.meta || {};
  const raw = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
  const closes = filterNulls(raw);
  const price = (typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0) ? meta.regularMarketPrice : closes[closes.length - 1];
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : price;
  return { price: price, prevClose: prevClose, history: closes };
}

async function saveIndex(DB, symbol, region, data) {
  const dayPct = data.prevClose ? ((data.price - data.prevClose) / data.prevClose) * 100 : 0;
  await setState(DB, "index:" + symbol, {
    region: region, price: data.price, prevClose: data.prevClose,
    dayPct: dayPct, history: data.history.slice(-60), ts: Date.now()
  });
}

async function saveQuote(DB, symbol, market, q) {
  await setState(DB, "quote:" + symbol, {
    market: market, price: q.price, prevClose: q.prevClose,
    dayPct: q.dayPct, rsi: q.dailyRsi, ma: q.dailyMa, atr: q.dailyAtr,
    dailyAtr: q.dailyAtr, dailyMa: q.dailyMa, dailyMaShort: q.dailyMaShort,
    bbLower: q.bbLower, bbUpper: q.bbUpper,
    return20: q.return20,
    ts: Date.now()
  });
}

// === [V8] 헬퍼: N일 최고가 (모멘텀 신고가 돌파용) ===
function getNDayHigh(closes, n) {
  if (!Array.isArray(closes) || closes.length < n + 1) return null;
  let max = -Infinity;
  for (let i = closes.length - n - 1; i < closes.length - 1; i++) {
    if (closes[i] > max) max = closes[i];
  }
  return max;
}

// === [V9] 헬퍼: 당일 분봉 일중 모멘텀 확인 (US 단타 진입 타이밍 게이트) ===
//   반환: true(상승/반등 중 → 진입OK), false(하락 중 → 진입 보류), null(데이터 부족 → 판단 보류)
//   판단: 최근 분봉 종가가 (1) 짧은 분봉MA 위에 있고 (2) 직전 저점에서 반등했는지.
//   단순·보수적으로 — 노이즈에 휘둘리지 않도록 "명확히 하락 중"일 때만 false.
function checkIntradayMomentum(intraday) {
  if (!intraday || !Array.isArray(intraday.closes)) return null;
  const c = intraday.closes;
  if (c.length < 15) return null;  // 장 초반 표본 부족 → 판단 보류(통과)
  const last = c[c.length - 1];
  // 최근 10분 단순 이동평균
  let sma10 = 0;
  for (let i = c.length - 10; i < c.length; i++) sma10 += c[i];
  sma10 /= 10;
  // 최근 10분 내 최저점 — 거기서 반등했는지
  let recentLow = Infinity;
  for (let i = c.length - 10; i < c.length; i++) if (c[i] < recentLow) recentLow = c[i];
  const bounceFromLow = recentLow > 0 ? ((last - recentLow) / recentLow) * 100 : 0;
  // 명확히 하락 중: 현재가가 분봉MA 아래 + 저점 대비 반등도 미미(0.1% 미만)
  if (last < sma10 && bounceFromLow < 0.1) return false;
  return true;
}

// === [V8] 헬퍼: z-score (평균회귀용) ===
function getZScore(closes, p) {
  p = p || 20;
  if (!Array.isArray(closes) || closes.length < p) return null;
  const ma = getMA(closes, p);
  if (ma == null) return null;
  let variance = 0;
  for (let i = closes.length - p; i < closes.length; i++) {
    variance += Math.pow(closes[i] - ma, 2);
  }
  const std = Math.sqrt(variance / p);
  if (std === 0) return 0;
  return (closes[closes.length - 1] - ma) / std;
}

// === [V8] SWING 전략 — 기존 V7 로직 ===
function evaluateBuySignals_swing(price, dayPct, dailyData, cfg) {
  const closes = dailyData.closes;
  const volumes = dailyData.volumes || [];
  if (!closes || closes.length < 25) return [];

  const dailyRsi = getRSI(closes, cfg.rsiPeriod);
  const dailyRsiPrev = getRSI(closes.slice(0, -1), cfg.rsiPeriod);
  const ma20 = getMA(closes, cfg.maPeriod);
  const ma5 = getMA(closes, cfg.maShortPeriod);
  const bb = getBollingerBands(closes, cfg.maPeriod, cfg.bbStdMult);
  if (dailyRsi == null || ma20 == null) return [];

  const today = closes[closes.length - 1];
  const yesterday = closes[closes.length - 2];
  const isGreenCandle = today > yesterday;
  const signals = [];

  // SW_RSI_REV: RSI 임계 더 완화
  const rsiRevThr = (cfg.rsiBuy || 35) + 10;  // [V8.1.7] +5→+10
  if (dailyRsi < rsiRevThr && dailyRsiPrev != null && dailyRsi > dailyRsiPrev) {
    const maGap = ((price - ma20) / ma20) * 100;
    if (maGap >= -15) {  // [V8.1.7] -12→-15
      signals.push({ name: "SW_RSI_REV", weight: 1.0, type: "COUNTER", detail: "RSI " + dailyRsi.toFixed(1) + " (prev " + dailyRsiPrev.toFixed(1) + ")" });
    }
  }
  // SW_GOLDEN: RSI 범위 더 넓힘
  if (ma5 != null && ma5 > ma20 && dailyRsi >= 35 && dailyRsi <= 68) {  // [V8.1.7] 38~62 → 35~68
    const ma5Gap = ((price - ma5) / ma5) * 100;
    if (ma5Gap >= -5 && ma5Gap <= 4) {  // [V8.1.7] 더 완화
      signals.push({ name: "SW_GOLDEN", weight: 1.2, type: "TREND", detail: "MA5>MA20 gap " + ma5Gap.toFixed(1) + "%" });
    }
  }
  // SW_BB_LOW
  if (bb != null && price <= bb.lower && dailyRsi < 52 && isGreenCandle) {  // [V8.1.7] 48→52
    signals.push({ name: "SW_BB_LOW", weight: 1.0, type: "COUNTER", detail: "BB lower " + bb.lower.toFixed(2) });
  }
  // SW_VOL_SPK
  if (volumes.length >= 20 && isGreenCandle && dailyRsi >= 40 && dailyRsi <= 72) {  // [V8.1.7] 42~68 → 40~72
    const todayVol = volumes[volumes.length - 1];
    let avgVol = 0;
    for (let i = volumes.length - 21; i < volumes.length - 1; i++) avgVol += volumes[i];
    avgVol /= 20;
    if (todayVol >= avgVol * (cfg.volSpikeMult * 0.85)) {  // [V8.1.7] 임계 15% 낮춤
      signals.push({ name: "SW_VOL_SPK", weight: 1.1, type: "TREND", detail: "vol x" + (todayVol/avgVol).toFixed(1) });
    }
  }

  // SW_PULLBACK: 추세 위 가벼운 눌림 후 회복
  const ma50sw = getMA(closes, 50);
  if (ma50sw != null && ma20 > ma50sw && isGreenCandle && dailyRsi >= 42 && dailyRsi <= 65) {  // [V8.1.7] 45~62 → 42~65
    const ma20Gap = ((price - ma20) / ma20) * 100;
    if (ma20Gap >= -1 && ma20Gap <= 8) {  // [V8.1.7] 0~6 → -1~8
      signals.push({
        name: "SW_PULLBACK",
        weight: 1.0, type: "TREND",
        detail: "MA20+" + ma20Gap.toFixed(1) + "% RSI " + dailyRsi.toFixed(0)
      });
    }
  }
  return signals;
}

// === [V9] DAY 전략 — 시장별 차별화 ===
//   US: 단타(분봉 실시간) — 분봉 타이밍 게이트로 "지금 반등 중"인 것만 진입, 당일 청산.
//   KR: 짧은 스윙(야후 15분 지연으로 분봉 신뢰 불가) — 일봉 기반 진입, 보유 며칠로 연장.
function evaluateBuySignals_day(price, dayPct, dailyData, cfg, market, intraday) {
  const closes = dailyData.closes;
  if (!closes || closes.length < 25) return [];
  const rules = cfg.dayRules;
  const dailyRsi = getRSI(closes, cfg.rsiPeriod);
  const ma20 = getMA(closes, cfg.maPeriod);
  const ma5 = getMA(closes, cfg.maShortPeriod);
  if (dailyRsi == null || ma20 == null) return [];

  // [V9] US 단타: 분봉으로 일중 방향 확인. 실시간 분봉이 있을 때만(US) 적용.
  //   "지금 실제로 반등/상승 중"이 아니면 진입 보류 → 어제 정보로 칼날잡기 방지.
  //   KR은 15분 지연이라 이 게이트를 건너뜀(일봉 기반 스윙).
  if (market === "us" && cfg.dayRules && cfg.dayRules.usIntradayGate !== false) {
    const intraOk = checkIntradayMomentum(intraday);
    // intraOk === false (명확히 하락중)일 때만 차단. null(데이터부족)은 통과시켜 기존동작 유지.
    if (intraOk === false) return [];
  }

  const signals = [];
  const rsiGapLimit = rules.rsiMaxForGap != null ? rules.rsiMaxForGap : 55;
  const rsiBounceLimit = rules.rsiMaxForBounce != null ? rules.rsiMaxForBounce : 60;

  // DAY1: 갭하락 매수 — 더 넓은 범위 + RSI 완화 + MA20 -12% 이내
  if (dayPct >= rules.dayDropMin && dayPct <= rules.dayDropMax) {
    if (dailyRsi < rsiGapLimit) {
      const maGap = ((price - ma20) / ma20) * 100;
      // [V9.5 진입강화] -8%→-5%: 추세 대비 너무 깊이 빠진 종목은 반등 아닌 추세붕괴 확률↑
      if (maGap >= -5) {
        signals.push({
          name: "DY_GAP_DOWN",
          weight: 0.95, type: "COUNTER",
          detail: "day " + dayPct.toFixed(1) + "% RSI " + dailyRsi.toFixed(1)
        });
      }
    }
  }

  // DAY2: 강한 일중 반등 — 어제 음봉 후 오늘 양봉
  // [V9.6 데이터근거] DY_BOUNCE: 청산표본 31건 승률 0%, 누적 -6.23% → day 최대 손실원.
  //   "어제 빠진 종목이 오늘 양봉이면 반등"이라는 가정이 실거래에선 데드캣 바운스에
  //   걸려 전부 손절. DY_OPEN_DRIVE/DY_DIP_BUY가 더 나은 진입을 제공하므로 영구 비활성화.
  const BOUNCE_ENABLED = false;
  if (BOUNCE_ENABLED && closes.length >= 3) {
    const yest = closes[closes.length - 2];
    const dayBefore = closes[closes.length - 3];
    const yestPct = ((yest - dayBefore) / dayBefore) * 100;
    const yestThr = rules.bounceYestMin != null ? rules.bounceYestMin : -1.0;
    if (yestPct < yestThr && dayPct > 0 && dailyRsi >= 25 && dailyRsi <= rsiBounceLimit) {
      signals.push({
        name: "DY_BOUNCE",
        weight: 1.1, type: "COUNTER",
        detail: "yest " + yestPct.toFixed(1) + "% today +" + dayPct.toFixed(1) + "%"
      });
    }
  }

  // [V8.1] DAY3: VWAP_PULL — 추세 위 가벼운 눌림
  const vwapMin = rules.vwapPullMinPct != null ? rules.vwapPullMinPct : -0.5;
  const vwapMax = rules.vwapPullMaxPct != null ? rules.vwapPullMaxPct : 2.5;
  // [V8.6 데이터근거] DY_VWAP_PULL: 청산표본 11건 승률 18%, 누적 -3.6만 → 비활성화.
  //   추세 위 얕은 눌림 컨셉이지만 실거래에선 DIP_BUY와 중복되며 더 나쁜 성과.
  const VWAP_PULL_ENABLED = false;
  if (VWAP_PULL_ENABLED && ma5 != null && ma5 > ma20 && price > ma5
      && dayPct >= vwapMin && dayPct <= vwapMax
      && dailyRsi >= 48 && dailyRsi <= 68) {
    signals.push({
      name: "DY_VWAP_PULL",
      weight: 1.05, type: "TREND",
      detail: "trend ma5>ma20 day " + dayPct.toFixed(1) + "% RSI " + dailyRsi.toFixed(1)
    });
  }

  // [V8.1] DAY4: OPEN_DRIVE — 갭상승 추격
  const odMin = rules.openDriveMinPct != null ? rules.openDriveMinPct : 1.0;
  const odMax = rules.openDriveMaxPct != null ? rules.openDriveMaxPct : 5.0;
  if (dayPct >= odMin && dayPct <= odMax
      && dailyRsi >= 52 && dailyRsi <= 72  // [V8.1] 55~70 → 52~72
      && price > ma20) {
    signals.push({
      name: "DY_OPEN_DRIVE",
      weight: 1.1, type: "TREND",
      detail: "gap up " + dayPct.toFixed(1) + "% RSI " + dailyRsi.toFixed(1)
    });
  }

  // [V8.1 신규] DAY5: DY_MOMO — 강세 모멘텀 단순 추종
  // 강한 RSI (60~75) + 가격이 ma5/ma20 위 + 보합~상승 → 강세 지속 진입
  const momoRsiMin = rules.momoRsiMin != null ? rules.momoRsiMin : 60;
  const momoRsiMax = rules.momoRsiMax != null ? rules.momoRsiMax : 75;
  // [V8.6 데이터근거] DY_MOMO: 청산표본 10건 승률 20%, 평균 -1.0%, 누적 -3.6만 → 비활성화.
  //   고RSI 추격이 일봉 기준에선 고점매수가 되어 손절로 직행. OPEN_DRIVE가 같은 역할을 더 잘함.
  const MOMO_ENABLED = false;
  if (MOMO_ENABLED && dailyRsi >= momoRsiMin && dailyRsi <= momoRsiMax
      && ma5 != null && price > ma5 && ma5 > ma20
      && dayPct >= -1.0 && dayPct <= 3.0) {
    signals.push({
      name: "DY_MOMO",
      weight: 1.05, type: "TREND",
      detail: "momo RSI " + dailyRsi.toFixed(1) + " day " + dayPct.toFixed(1) + "%"
    });
  }

  // [V8.1 신규] DAY6: DY_DIP_BUY — 강세장 얕은 눌림 단타
  // ma5 > ma20 추세 위에서 -0.3% ~ -3% 일시적 눌림 → 반등 노림
  const dipMin = rules.dipMinPct != null ? rules.dipMinPct : -3.5;
  const dipMax = rules.dipMaxPct != null ? rules.dipMaxPct : -0.2;
  if (ma5 != null && ma5 > ma20 && price > ma20
      && dayPct >= dipMin && dayPct <= dipMax
      && dailyRsi >= 38 && dailyRsi <= 68) {
    signals.push({
      name: "DY_DIP_BUY",
      weight: 1.1, type: "COUNTER",
      detail: "dip " + dayPct.toFixed(1) + "% in uptrend RSI " + dailyRsi.toFixed(1)
    });
  }

  // [V8.4] DAY7: DY_RANGE — 기존 catch-all (RSI 30~75, dayPct -5~+3) 제거.
  // 정규분포상 약 60~70% 종목이 항상 충족 → 사실상 랜덤 매수 → 승률 50% 수렴 원인.
  // 대체: 추세 정렬 강제 + RSI 중립 좁힘 + 변동 작을 때만 (확신 있는 안전망)
  if (ma5 != null && ma5 > ma20 && price > ma5
      && dailyRsi >= 45 && dailyRsi <= 65
      && dayPct >= -2.0 && dayPct <= 1.5) {
    if (signals.length === 0) {
      signals.push({
        name: "DY_RANGE",
        weight: 0.85,
        type: "TREND",
        detail: "trend+range day " + dayPct.toFixed(1) + "% RSI " + dailyRsi.toFixed(1)
      });
    }
  }

  // [V9.5 진입강화] 신호 정제: (a) weight 게이트로 약한 단독신호 제거,
  //   (b) 신호 여러 개면 가장 강한 maxSignalsKept(기본1)개만 — 확신 있는 진입으로 제한.
  const minW = rules.minConfirmWeight != null ? rules.minConfirmWeight : 0;
  let filtered = signals.filter(function(s) { return (s.weight || 0) >= minW; });
  const keepN = rules.maxSignalsKept != null ? rules.maxSignalsKept : 2;
  if (filtered.length > keepN) {
    filtered.sort(function(a, b) { return (b.weight || 0) - (a.weight || 0); });
    return filtered.slice(0, keepN);
  }
  return filtered;
}
function evaluateBuySignals_momentum(price, dayPct, dailyData, cfg) {
  const closes = dailyData.closes;
  const volumes = dailyData.volumes || [];
  if (!closes || closes.length < 55) return [];
  const rules = cfg.momentumRules;

  const dailyRsi = getRSI(closes, cfg.rsiPeriod);
  const ma20 = getMA(closes, 20);
  const ma50 = getMA(closes, 50);
  if (dailyRsi == null || ma20 == null || ma50 == null) return [];

  const signals = [];

  // MOM1: 20일 신고가 돌파 + 거래량 1.5배 + 추세 정렬
  const high20 = getNDayHigh(closes, rules.breakoutDays);
  const trendAligned = ma20 > ma50 && price > ma20;
  const rsiInBand = dailyRsi >= rules.rsiMin && dailyRsi <= rules.rsiMax;

  if (high20 != null && price > high20 && trendAligned && rsiInBand) {
    if (volumes.length >= 20) {
      const todayVol = volumes[volumes.length - 1];
      let avgVol = 0;
      for (let i = volumes.length - 21; i < volumes.length - 1; i++) avgVol += volumes[i];
      avgVol /= 20;
      if (todayVol >= avgVol * rules.volMult) {
        signals.push({
          name: "MO_BREAKOUT",
          weight: 1.3, type: "TREND",
          detail: "BO " + high20.toFixed(2) + " vol x" + (todayVol/avgVol).toFixed(1) + " RSI " + dailyRsi.toFixed(0)
        });
      }
    } else {
      signals.push({
        name: "MO_BREAKOUT",
        weight: 1.0, type: "TREND",
        detail: "BO " + high20.toFixed(2) + " (no vol)"
      });
    }
  }

  // MOM2: 강한 추세 진행 — [V9] 추격 상단 축소.
  //   기존 ma20 대비 +10%까지 추격은 중립장에서 이미 오른 고점을 사는 꼴(momentum 손실 원인).
  //   추세 진행 중 '얕은 눌림'만 잡도록 +10%→+5%로 제한, RSI 상단도 75→70으로 과열 회피.
  if (trendAligned && dailyRsi >= 50 && dailyRsi <= 70) {
    const ma20Gap = ((price - ma20) / ma20) * 100;
    if (ma20Gap >= -1 && ma20Gap <= 5) {
      signals.push({
        name: "MO_TREND_PB",
        weight: 1.1, type: "TREND",
        detail: "MA20+" + ma20Gap.toFixed(1) + "% RSI " + dailyRsi.toFixed(0)
      });
    }
  }
  return signals;
}

// === [V8] MEANREV 전략 — z-score 극단 + RSI 극과매도 ===
// [V8.4] regime 인자 추가 — BEAR에서는 더 극단 임계만 진입
function evaluateBuySignals_meanrev(price, dayPct, dailyData, cfg, regime) {
  const closes = dailyData.closes;
  if (!closes || closes.length < 25) return [];
  const rules = cfg.meanrevRules;
  const dailyRsi = getRSI(closes, cfg.rsiPeriod);
  if (dailyRsi == null) return [];

  // [V8.3] RSI 상승 전환 확인 — catch-falling-knife 방지
  //   어제 RSI < 오늘 RSI 이어야 진입 (모멘텀이 둔화/반전되는 시점만)
  const dailyRsiPrev = getRSI(closes.slice(0, -1), cfg.rsiPeriod);
  const rsiUptick = (dailyRsiPrev != null && dailyRsi > dailyRsiPrev);
  if (rules.requireRsiUptick && !rsiUptick) return [];

  // [V8.4] BEAR 시 임계 강화
  const isBear = regime && regime.regime === "BEAR";
  const zThr = isBear && rules.bearZScoreThreshold != null
    ? rules.bearZScoreThreshold : rules.zScoreThreshold;
  const rsiMax = isBear && rules.bearRsiMax != null
    ? rules.bearRsiMax : rules.rsiMax;

  const signals = [];
  const z = getZScore(closes, 20);
  const yesterday = closes[closes.length - 2];
  const today = closes[closes.length - 1];
  const isGreenCandle = today > yesterday;
  const uptickNote = rsiUptick ? " up" : "";
  const bearNote = isBear ? " BEAR" : "";

  // MR1: zThr 이하 + RSI < rsiMax + 양봉 (반전 시작)
  if (z != null && z <= zThr && dailyRsi < rsiMax && isGreenCandle) {
    signals.push({
      name: "MR_OVERSOLD",
      weight: 1.2, type: "COUNTER",
      detail: "z=" + z.toFixed(2) + " RSI " + dailyRsi.toFixed(1) + uptickNote + bearNote
    });
  }

  // MR2: 극단 RSI — BEAR면 더 낮은 RSI 요구
  const extremeRsi = isBear ? 22 : 30;
  if (dailyRsi < extremeRsi && isGreenCandle) {
    signals.push({
      name: "MR_EXTREME_RSI",
      weight: 1.1, type: "COUNTER",
      detail: "RSI " + dailyRsi.toFixed(1) + " green" + uptickNote + bearNote
    });
  }

  // MR3: 큰 하락 후 반등 — BEAR 시 비활성화 (위험)
  if (!isBear && z != null && z <= -1.0 && dailyRsi < 42 && isGreenCandle) {
    if (!signals.some(function(s){ return s.name === "MR_OVERSOLD"; })) {
      signals.push({
        name: "MR_DEEP_DROP",
        weight: 1.0, type: "COUNTER",
        detail: "z=" + z.toFixed(2) + " RSI " + dailyRsi.toFixed(1) + " bouncing" + uptickNote
      });
    }
  }
  return signals;
}

// === [V8] 통합 평가기 — 모든 활성 전략에서 신호 수집 ===
// 반환: [{ strategy, signal, signals: [...] }, ...]  (전략당 1개)
// [V8.4] regime 인자 추가 — meanrev에 전달
function evaluateAllStrategies(price, dayPct, dailyData, cfg, signalStats, regime, market, intraday) {
  const results = [];
  const evaluators = {
    swing:    evaluateBuySignals_swing,
    day:      evaluateBuySignals_day,
    momentum: evaluateBuySignals_momentum,
    meanrev:  evaluateBuySignals_meanrev
  };
  for (const stratName of STRATEGIES) {
    if (!cfg.strategies || !cfg.strategies[stratName]) continue;
    // [V8.4] meanrev만 regime 인자 / [V9] day는 market·intraday 인자 (시장별 차별화)
    let sigs;
    if (stratName === "meanrev") {
      sigs = evaluators[stratName](price, dayPct, dailyData, cfg, regime);
    } else if (stratName === "day") {
      sigs = evaluators[stratName](price, dayPct, dailyData, cfg, market, intraday);
    } else {
      sigs = evaluators[stratName](price, dayPct, dailyData, cfg);
    }
    if (sigs.length === 0) continue;
    const resolved = resolveSignals(sigs, cfg, signalStats, stratName);
    if (!resolved) continue;
    results.push({ strategy: stratName, signal: resolved, rawCount: sigs.length });
  }
  // [V8.4] 중복 신호 시 — 단순 우선순위 매핑 폐기.
  //         signal.weight × 학습된 weightedWinRate 가 가장 높은 결과 1개 선택.
  //         → 학습 통계가 실제 의사결정에 반영됨.
  if (results.length >= 2) {
    function scoreResult(r) {
      const members = (r.signal && r.signal.members) || [r.signal.name];
      let wrSum = 0, n = 0;
      for (const m of members) {
        const s = signalStats && signalStats[m];
        if (s && s.count >= 20) {
          wrSum += (s.weightedWinRate != null ? s.weightedWinRate : (s.winRate || 0.5));
          n++;
        }
      }
      const avgWr = n > 0 ? (wrSum / n) : 0.5;  // 학습 안된 신호는 중립 50%
      // 0.5 baseline + winRate * 1.0 → 가중치 0.5~1.5 범위
      return (r.signal.weight || 1.0) * (0.5 + avgWr);
    }
    let best = results[0];
    let bestScore = scoreResult(results[0]);
    for (let i = 1; i < results.length; i++) {
      const s = scoreResult(results[i]);
      if (s > bestScore) { best = results[i]; bestScore = s; }
    }
    return [best];
  }
  return results;
}

// === [V8] Confluence 해석 — 전략 내부 신호 합의 ===
function resolveSignals(signals, cfg, signalStats, stratName) {
  if (signals.length === 0) return null;
  // [V8.4] autoTune이 손실 누적으로 비활성화한 신호 제거
  if (cfg.disabledSignals && cfg.disabledSignals.length > 0) {
    signals = signals.filter(function(s){
      return cfg.disabledSignals.indexOf(s.name) === -1;
    });
    if (signals.length === 0) return null;
  }
  if (signals.length === 1) {
    if (cfg.requireConfluence) return null;
    const s = signals[0];
    // [V8.6.1 철회] soloEligible 차단은 과거데이터 검증 결과 수익거래(+9.4만)까지 버려 역효과.
    //   GAP_DOWN/BOUNCE 단독도 손익비(승+2%/패-0.6%)가 좋아 승률 35%여도 합산 +.
    //   대신 손실의 핵심은 KR 데이트레이드 EOD → 시장 게이트(아래)와 softTimeStop으로 처리.
    return {
      name: s.name,
      weight: s.weight * cfg.soloSignalWeight,
      type: s.type,
      detail: "SOLO " + s.detail,
      members: [s.name],
      isCounterTrend: s.type === "COUNTER"
    };
  }
  // [신규] type 모순 검사 — COUNTER와 TREND가 섞이면 같은 방향 신호 합의로 안 쳐줌
  let counterCount = 0, trendCount = 0;
  for (const s of signals) {
    if (s.type === "COUNTER") counterCount++;
    else if (s.type === "TREND") trendCount++;
  }
  const mixed = (counterCount > 0 && trendCount > 0);
  // 모순 합의는 가중치 추가 페널티 (단독 신호보다 약간 나은 정도)
  // 혹은 cfg.allowMixedConfluence === false면 아예 거부
  if (mixed && cfg.allowMixedConfluence === false) {
    return null;
  }

  // 2개 이상 — 가중 평균 × 보너스, 신호별 성과 반영
  let totalW = 0;
  const names = [];
  const details = [];
  let anyCounter = false;
  for (const s of signals) {
    let perfMult = 1.0;
    if (signalStats && signalStats[s.name]) {
      const st = signalStats[s.name];
      // [수정] 최소 표본 5 → 20으로 상향, Bayesian shrinkage 적용
      // posterior ≈ (wins+α) / (count+α+β), α=β=10 → 사전 50% 가정에 평균 회귀
      // [V8.3] weightedWinRate 있으면 우선 사용 — 최근 거래에 가중 부여
      if (st.count >= 20) {
        const rate = st.weightedWinRate != null ? st.weightedWinRate
          : ((st.wins + 10) / (st.count + 20));
        const shrunkRate = (st.weightedWinRate != null)
          ? (st.weightedWins + 10) / (st.weightedCount + 20)
          : rate;
        perfMult = Math.max(0.7, Math.min(1.3, 0.4 + shrunkRate * 1.2));
      }
    }
    totalW += s.weight * perfMult;
    names.push(s.name);
    details.push(s.detail);
    if (s.type === "COUNTER") anyCounter = true;
  }
  const avgW = totalW / signals.length;
  // [신규] 모순 합의는 보너스 대신 감점
  const bonus = mixed ? (cfg.mixedConfluencePenalty != null ? cfg.mixedConfluencePenalty : 0.8) : cfg.confluenceBonus;
  return {
    name: (mixed ? "MIX[" : "CONF[") + names.map(function(n){ return n.charAt(0); }).join("+") + "]",
    weight: avgW * bonus,
    type: anyCounter ? "MIXED" : "TREND",
    detail: details.join(" | "),
    members: names,
    isCounterTrend: anyCounter
  };
}

// === [V8] 매수 차단 필터 — strategy 컨텍스트 인식 ===
function evaluateBuyBlocks(price, dayPct, dailyData, cfg, regime, signal, ctx) {
  const closes = dailyData.closes;
  if (!closes || closes.length < 25) return "INSUFFICIENT_DATA";
  const strategy = ctx && ctx.strategy ? ctx.strategy : "swing";

  // 시장 붕괴는 모든 전략 차단 (단 MEANREV는 worst 임계값 더 깊게 허용)
  const crashThreshold = (strategy === "meanrev") ? cfg.marketCrashPct - 1.0 : cfg.marketCrashPct;
  if (regime.worstDayPct <= crashThreshold) return "MARKET_CRASH " + regime.worstDayPct.toFixed(2) + "%";

  // FALLING_KNIFE — DAY/MEANREV는 더 깊은 하락도 OK (반등 노림)
  const knifeLimit = (strategy === "day" || strategy === "meanrev") ? cfg.maxDailyDrop + 2.0 : cfg.maxDailyDrop;
  if (dayPct <= -knifeLimit) return "FALLING_KNIFE " + dayPct.toFixed(2) + "%";

  const ma20 = getMA(closes, cfg.maPeriod);
  const dailyRsi = getRSI(closes, cfg.rsiPeriod);

  // DOWNTREND — MOMENTUM/MEANREV 면제 + [V8.1.5] DAY도 면제 (단타는 일봉 추세 무관)
  if (strategy !== "momentum" && strategy !== "meanrev" && strategy !== "day"
      && !signal.isCounterTrend && ma20 != null && price < ma20 && dailyRsi != null && dailyRsi >= 40) {
    return "DOWNTREND price<MA20 RSI=" + dailyRsi.toFixed(1);
  }

  // PERSISTENT_DOWN — MEANREV/DAY 면제 (단타는 5일 패턴 무관, 갭하락 반등 노림)
  // [V8.1.5] day 면제 — 7건 차단되던 KR 약세장에서도 단타 진입 가능
  if (strategy !== "meanrev" && strategy !== "day") {
    const downDays = countDownDays(closes, 5);
    if (downDays >= 4) return "PERSISTENT_DOWN " + downDays + "/5";
  }

  const highs = dailyData.highs || null;
  const lows = dailyData.lows || null;
  const atr14 = getATR(closes, cfg.atrPeriod, highs, lows);
  const atr30 = getATR(closes, 30, highs, lows);
  if (atr14 != null && atr30 != null && atr14 > atr30 * 2.0) {
    return "VOLATILITY_SPIKE ATR14=" + atr14.toFixed(2) + " ATR30=" + atr30.toFixed(2);
  }

  // BEAR_WEAK — MEANREV는 면제 (약세장 과매도 매수)
  if (strategy !== "meanrev" && regime.regime === "BEAR" && regime.worstDayPct <= -1.5) {
    return "BEAR_WEAK worst=" + regime.worstDayPct.toFixed(2) + "%";
  }

  // RS 필터 — COUNTER 성격 전략(DAY/MEANREV)과 isCounterTrend 신호는 면제
  if (cfg.rsFilterEnabled && strategy !== "day" && strategy !== "meanrev"
      && !signal.isCounterTrend && regime.idxReturn20 != null) {
    const stockRet = getNDayReturn(closes, cfg.rsLookbackDays);
    if (stockRet != null) {
      const relPerf = stockRet - regime.idxReturn20;
      if (relPerf < cfg.rsMinOutperform) {
        return "WEAK_RS stock=" + stockRet.toFixed(1) + "% idx=" + regime.idxReturn20.toFixed(1) + "% rel=" + relPerf.toFixed(1) + "%";
      }
    }
  }

  // 인버스 페어 차단 (전략 무관)
  if (cfg.blockInversePair && ctx && ctx.heldSymbols) {
    const inv = INVERSE_PAIRS[ctx.symbol];
    if (inv && ctx.heldSymbols.has(inv)) {
      return "INVERSE_HELD " + inv;
    }
  }

  // 섹터 동시 보유 제한 (전략 무관 — 전략별 포지션 있어도 같은 섹터 카운트)
  if (cfg.maxPositionsPerSector && ctx && ctx.sectorCounts) {
    const sec = SECTOR_MAP[ctx.symbol];
    if (sec) {
      const cur = ctx.sectorCounts[sec] || 0;
      if (cur >= cfg.maxPositionsPerSector) {
        return "SECTOR_FULL " + sec + " (" + cur + "/" + cfg.maxPositionsPerSector + ")";
      }
    }
  }

  // [V8] 같은 (종목, 전략) 조합 이미 보유 시 추가 진입 차단
  if (ctx && ctx.strategiesHeld && ctx.strategiesHeld.has(strategy)) {
    return "ALREADY_HELD " + strategy;
  }

  return null;
}

// === [V8] executeBuy — strategy 필드 저장 ===
async function executeBuy(DB, market, symbol, strategy, qty, price, signal, dailyAtr, cfg, cash, opts) {
  const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  if (total > cash[market]) { await log(DB, "WARN", symbol, "BUY aborted: cash short"); return cash; }

  // 전략별 손절가 계산 — [V8.6] opts.stopPctOverride 있으면 우선 적용 (LLM 지시)
  const rules = getStrategyRules(cfg, strategy);
  const stopPct = (opts && typeof opts.stopPctOverride === "number")
    ? opts.stopPctOverride : (rules.stopLossPct || cfg.stopLoss);
  const atrMult = rules.atrStopMult || cfg.atrStopMult;

  const pctStop = price * (1 - stopPct / 100);
  let stopPrice = pctStop;
  if (dailyAtr) {
    const atrStop = price - dailyAtr * atrMult;
    stopPrice = Math.min(atrStop, pctStop);
  }
  // 최대 손절폭은 stopPct로 고정
  if (stopPrice > pctStop) stopPrice = pctStop;

  try {
    await savePosition(DB, market, symbol, strategy, {
      qty: qty, avg: price, opened_ts: Date.now(),
      meta: {
        strategy: strategy,
        feePaid: fee,
        feeRemaining: fee,
        atrAtEntry: dailyAtr,
        stopPrice: stopPrice,
        peakPrice: price,
        signal: signal.name,
        signalMembers: signal.members || [signal.name],
        tp1Done: false,
        originalQty: qty
      }
    });
  } catch (e) {
    await log(DB, "ERROR", symbol, "BUY savePosition fail: " + e.message);
    return cash;
  }

  cash[market] -= total;
  await recordTrade(DB, {
    ts: Date.now(), market: market, symbol: symbol, side: "BUY",
    qty: qty, price: price,
    reason: "[" + strategy.toUpperCase() + "] " + signal.name + " " + signal.detail
  });
  const stopPctRel = ((stopPrice - price) / price * 100).toFixed(1);
  await log(DB, "TRADE", symbol, "BUY [" + strategy + "] x" + qty + " @" + price.toFixed(2) + " " + signal.name + " " + signal.detail + " stop=" + stopPrice.toFixed(2) + "(" + stopPctRel + "%)");
  return cash;
}

// === [V8] 전략 룰 헬퍼 ===
function getStrategyRules(cfg, strategy) {
  if (strategy === "swing") return cfg.swingRules || {};
  if (strategy === "day") return cfg.dayRules || {};
  if (strategy === "momentum") return cfg.momentumRules || {};
  if (strategy === "meanrev") return cfg.meanrevRules || {};
  return {};
}

// === [V8] 전략별 포지션 사이즈 계산 ===
function getPositionSizeRatio(cfg, strategy, regimeName) {
  const sizing = (cfg.strategySizing && cfg.strategySizing[strategy]) || { base: 10, bullMult: 1.0, bearMult: 1.0, neutralMult: 1.0 };
  const base = sizing.base / 100;
  if (regimeName === "BULL") return base * (sizing.bullMult || 1.0);
  if (regimeName === "BEAR") return base * (sizing.bearMult || 1.0);
  // [V9] NEUTRAL(중립 횡보) — day/momentum은 추세 부재 시 신뢰도 급락 → neutralMult로 축소.
  return base * (sizing.neutralMult != null ? sizing.neutralMult : 1.0);
}

async function executeSell(DB, market, symbol, pos, sellQty, price, reason, cfg, cash) {
  const strategy = pos.strategy || (pos.meta && pos.meta.strategy) || "swing";
  const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
  const gross = price * sellQty;
  const fee = gross * feeRate;
  const sellTax = market === "kr" ? gross * (cfg.krSellTax || 0) : 0;
  const proceeds = gross - fee - sellTax;
  cash[market] += proceeds;

  pos.meta = pos.meta || {};
  const feeRemaining = (typeof pos.meta.feeRemaining === "number")
    ? pos.meta.feeRemaining
    : (pos.meta.feePaid || 0);
  const entryFeeForThisSell = feeRemaining * (sellQty / pos.qty);
  const costBasis = pos.avg * sellQty + entryFeeForThisSell;
  const pnl = proceeds - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
  const heldMin = pos.opened_ts ? Math.floor((Date.now() - pos.opened_ts) / 60000) : 0;

  const signalMembers = pos.meta.signalMembers || [];
  const enrichedReason = "[" + strategy.toUpperCase() + "] " + reason + " #entry=" + signalMembers.join(",");

  if (sellQty < pos.qty) {
    pos.qty = pos.qty - sellQty;
    pos.meta.tp1Done = true;
    pos.meta.feeRemaining = Math.max(0, feeRemaining - entryFeeForThisSell);
    await savePosition(DB, market, symbol, strategy, pos);
  } else {
    await deletePosition(DB, symbol, strategy);
  }

  await recordTrade(DB, { ts: Date.now(), market: market, symbol: symbol, side: "SELL", qty: sellQty, price: price, pnl: pnl, pnl_pct: pnlPct, reason: enrichedReason });
  const taxNote = market === "kr" ? " tax=" + sellTax.toFixed(2) : "";
  await log(DB, "TRADE", symbol, "SELL [" + strategy + "] x" + sellQty + " @" + price.toFixed(2) + " PnL " + pnlPct.toFixed(2) + "% (held " + heldMin + "min, " + reason + ")" + taxNote);
  return { cash: cash, pnlPct: pnlPct };
}

// === [V8] 매도 평가 — 보유 포지션의 strategy에 따라 분기 ===
// 반환: { sell: true/false, sellQty, reason } 또는 null
// [V8.1] market 인자 추가 — Day 전략 장 마감 강제청산용
function evaluateSell(pos, price, daily, dailyRsi, dailyMa, dailyMaShort, cfg, marketOpenForThis, market) {
  const strategy = pos.strategy || (pos.meta && pos.meta.strategy) || "swing";
  const pnlRate = ((price - pos.avg) / pos.avg) * 100;
  const peakPrice = pos.meta && pos.meta.peakPrice ? pos.meta.peakPrice : pos.avg;
  const peakPnlPct = ((peakPrice - pos.avg) / pos.avg) * 100;
  const heldMin = pos.opened_ts ? (Date.now() - pos.opened_ts) / 60000 : 0;
  const heldHours = heldMin / 60;
  const heldDays = heldHours / 24;
  const tp1Done = pos.meta && pos.meta.tp1Done;

  // 공통: 하드 스톱 (전략별 stopLossPct 적용)
  const rules = getStrategyRules(cfg, strategy);
  const stopPct = rules.stopLossPct || cfg.stopLoss;
  if (pnlRate <= -stopPct) {
    return { sell: true, sellQty: pos.qty, reason: "HARD-STOP " + pnlRate.toFixed(2) + "%" };
  }
  // 공통: ATR-STOP (진입 시 계산된 stopPrice + [V8.3] break-even으로 올라간 stopPrice 포함)
  if (pos.meta && pos.meta.stopPrice != null && price <= pos.meta.stopPrice) {
    const beNote = pos.meta.breakEvenLocked ? " (BE-LOCKED)" : "";
    return { sell: true, sellQty: pos.qty, reason: "ATR-STOP " + pnlRate.toFixed(2) + "%" + beNote };
  }

  // [V8.3] 공통: Trailing stop — 모든 전략에 적용.
  //   trailStartPct 도달 후 피크에서 trailDropPct 이상 하락하면 청산.
  //   기존엔 swing/momentum만 했지만 day/meanrev도 보호 가치 있음.
  if (rules.trailStartPct != null && rules.trailDropPct != null
      && peakPnlPct >= rules.trailStartPct && pnlRate < peakPnlPct) {
    const trailStop = peakPrice * (1 - rules.trailDropPct / 100);
    if (price <= trailStop) {
      return { sell: true, sellQty: pos.qty, reason: "TRAIL[" + strategy + "] peak=" + peakPrice.toFixed(2) + " " + pnlRate.toFixed(2) + "% (from +" + peakPnlPct.toFixed(2) + "%)" };
    }
  }

  // === DAY 전략 — [V9] 시장별 분기 ===
  if (strategy === "day") {
    const r = cfg.dayRules;
    const cost = (cfg.roundTripCostPct && cfg.roundTripCostPct[market]) || 0;
    const isKR = (market === "kr");

    // ───────── [V9] KR day = 짧은 스윙 ─────────
    //   야후 15분 지연으로 분 단위 단타 불가 → 당일청산(EOD)·분단위 타임스톱 모두 해제.
    //   일봉 기반으로 며칠 보유, TP/손절/트레일링(상단 공통 로직)으로만 관리.
    if (isKR) {
      const swMinHoldH = r.krSwingMinHoldHours != null ? r.krSwingMinHoldHours : 3;
      if (heldHours < swMinHoldH) return { sell: false };
      // TP1 분할익절
      if (!tp1Done && r.tp1 != null && pnlRate >= (r.tp1 + cost)) {
        const halfQty = Math.floor(pos.qty / 2);
        if (halfQty > 0) return { sell: true, sellQty: halfQty, reason: "DAY-KR-TP1 +" + pnlRate.toFixed(2) + "%" };
      }
      // TP2 전량 익절
      if (pnlRate >= (r.tp + cost)) {
        return { sell: true, sellQty: pos.qty, reason: "DAY-KR-TP +" + pnlRate.toFixed(2) + "%" };
      }
      // 며칠 단위 시간 손절 — 스윙답게 maxHoldHours 대신 maxHoldDays 사용
      const maxDays = r.krSwingMaxHoldDays != null ? r.krSwingMaxHoldDays : 4;
      if (heldDays >= maxDays) {
        return { sell: true, sellQty: pos.qty, reason: "DAY-KR-MAX " + heldDays.toFixed(1) + "d PnL=" + pnlRate.toFixed(2) + "%" };
      }
      return { sell: false };
    }

    // ───────── [V9] US day = 단타 (기존 분 단위 로직) ─────────
    // [V8.1] 장 마감 N분 전 강제 청산
    if (market) {
      const mtc = marketMinutesUntilClose(market);
      const forceMin = r.forceCloseBeforeMinClose || 30;
      const ptBefore = r.eodProfitTakeBeforeMin || 45;
      if (mtc != null && mtc <= ptBefore && mtc > forceMin && pnlRate >= 0.3) {
        return { sell: true, sellQty: pos.qty, reason: "DAY-EOD-TP " + mtc + "min PnL=" + pnlRate.toFixed(2) + "%" };
      }
      if (mtc != null && mtc <= forceMin) {
        return { sell: true, sellQty: pos.qty, reason: "DAY-EOD " + mtc + "min PnL=" + pnlRate.toFixed(2) + "%" };
      }
    }
    if (heldMin < (r.minHoldMinutes || 20)) return { sell: false };
    // softTimeStop (US 기준값)
    const stMin = r.softTimeStopMinutes;
    const stPnl = r.softTimeStopMinPnl != null ? r.softTimeStopMinPnl : 0.15;
    if (stMin != null && heldMin >= stMin && pnlRate < stPnl && !tp1Done) {
      return { sell: true, sellQty: pos.qty, reason: "DAY-TIMESTOP " + heldMin.toFixed(0) + "min PnL=" + pnlRate.toFixed(2) + "%" };
    }
    // TP1 분할익절
    if (!tp1Done && r.tp1 != null && pnlRate >= (r.tp1 + cost)) {
      const halfQty = Math.floor(pos.qty / 2);
      if (halfQty > 0) {
        return { sell: true, sellQty: halfQty, reason: "DAY-TP1 +" + pnlRate.toFixed(2) + "%" };
      }
    }
    // TP2
    if (pnlRate >= (r.tp + cost)) {
      return { sell: true, sellQty: pos.qty, reason: "DAY-TP +" + pnlRate.toFixed(2) + "%" };
    }
    // 최대 보유시간 (당일 내)
    if (heldHours >= (r.maxHoldHours || 8)) {
      return { sell: true, sellQty: pos.qty, reason: "DAY-MAX " + heldHours.toFixed(1) + "h PnL=" + pnlRate.toFixed(2) + "%" };
    }
    return { sell: false };
  }

  // === MEANREV 전략 ===
  if (strategy === "meanrev") {
    const r = cfg.meanrevRules;
    if (heldHours < (r.minHoldHours || 2)) return { sell: false };
    // MA20 복귀 시 즉시 익절
    if (dailyMa != null && price >= dailyMa) {
      return { sell: true, sellQty: pos.qty, reason: "MR-MA20 +" + pnlRate.toFixed(2) + "%" };
    }
    // RSI 50 도달 시 익절
    if (dailyRsi != null && dailyRsi >= 50 && pnlRate > 0) {
      return { sell: true, sellQty: pos.qty, reason: "MR-RSI50 +" + pnlRate.toFixed(2) + "%" };
    }
    // 시간 만료
    if (heldDays >= (r.timeStopMaxDays || 5)) {
      return { sell: true, sellQty: pos.qty, reason: "MR-TIME " + heldDays.toFixed(1) + "d PnL=" + pnlRate.toFixed(2) + "%" };
    }
    return { sell: false };
  }

  // === MOMENTUM 전략 ===
  if (strategy === "momentum") {
    const r = cfg.momentumRules;
    if (heldDays < (r.minHoldDays || 2)) return { sell: false };
    // [V8.3] TP1 분할익절 — tp1 도달 시 1/3 청산 (모멘텀은 길게 끌기 위해 1/3만)
    if (!tp1Done && r.tp1 != null && pnlRate >= r.tp1) {
      const partialQty = Math.floor(pos.qty / 3);
      if (partialQty > 0) {
        return { sell: true, sellQty: partialQty, reason: "MO-TP1 +" + pnlRate.toFixed(2) + "%" };
      }
    }
    // 시간 만료
    if (heldDays >= (r.timeStopMaxDays || 30)) {
      return { sell: true, sellQty: pos.qty, reason: "MO-TIME " + heldDays.toFixed(1) + "d PnL=" + pnlRate.toFixed(2) + "%" };
    }
    // MA20 이탈 (추세 종료 신호)
    if (dailyMa != null && price < dailyMa && pnlRate > 0) {
      return { sell: true, sellQty: pos.qty, reason: "MO-MA20-BREAK +" + pnlRate.toFixed(2) + "%" };
    }
    return { sell: false };
  }

  // === SWING 전략 (기본) ===
  const r = cfg.swingRules;
  const minHoldPassed = heldHours >= (r.minHoldHours || 4);

  if (heldDays >= (r.timeStopMaxDays || 7)) {
    return { sell: true, sellQty: pos.qty, reason: "TIME-MAX " + heldDays.toFixed(1) + "d PnL=" + pnlRate.toFixed(2) + "%" };
  }
  if (heldDays >= (r.timeStopDays || 3) && Math.abs(pnlRate) <= 1.5) {
    return { sell: true, sellQty: pos.qty, reason: "TIME-CUT " + heldDays.toFixed(1) + "d PnL=" + pnlRate.toFixed(2) + "%" };
  }

  if (!minHoldPassed) return { sell: false, minHoldLock: true };

  if (!tp1Done && pnlRate >= (r.tp1 || 4)) {
    const halfQty = Math.floor(pos.qty / 2);
    if (halfQty > 0) {
      return { sell: true, sellQty: halfQty, reason: "TP1-HALF +" + pnlRate.toFixed(2) + "%" };
    }
    return { sell: true, sellQty: pos.qty, reason: "TP1-FULL +" + pnlRate.toFixed(2) + "%" };
  }
  if (pnlRate >= (r.tp2 || 11)) {
    return { sell: true, sellQty: pos.qty, reason: "TP2 +" + pnlRate.toFixed(2) + "%" };
  }
  if (dailyRsi != null && dailyRsi > cfg.rsiSell && pnlRate >= 2.0) {
    return { sell: true, sellQty: pos.qty, reason: "RSI " + dailyRsi.toFixed(1) + " +" + pnlRate.toFixed(2) + "%" };
  }
  if (dailyMaShort != null && dailyMa != null && dailyMaShort < dailyMa && pnlRate >= 2.0) {
    const ma5Gap = ((dailyMaShort - dailyMa) / dailyMa) * 100;
    if (ma5Gap < -1) {
      return { sell: true, sellQty: pos.qty, reason: "DEAD-X gap=" + ma5Gap.toFixed(1) + "% +" + pnlRate.toFixed(2) + "%" };
    }
  }
  // SWING trailing은 공통 trailing이 이미 처리하므로 별도 분기 제거 (위쪽 공통 block에서 잡힘)
  return { sell: false };
}

// ============================================================
// [V8.9] 백테스트 엔진 — 기존 신호/매도 로직을 과거 일봉에 그대로 적용
//   • 목적: 파라미터 변경 효과를 데이터로 검증 (운/과최적화 구분)
//   • look-ahead 방지: i일차 판단에 0..i 데이터만 사용
//   • day(분봉) 전략은 일봉 백테스트에서 제외 (정직성)
//   • 체결: 종가 기준 + 슬리피지/수수료/매도세 반영
//   • 한계: 일봉 종가 체결이라 장중 변동 미반영, 과거≠미래
// ============================================================

// 백테스트용 긴 일봉 — range 파라미터로 기간 조절 (기본 2년)
async function fetchDailyForBacktest(symbol, range) {
  const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=" + (range || "2y"));
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("no daily data");
  const ts = result.timestamp || [];
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const rawCloses = quote.close || [], rawHighs = quote.high || [], rawLows = quote.low || [], rawVols = quote.volume || [];
  const closes = [], highs = [], lows = [], volumes = [], dates = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = rawCloses[i];
    if (typeof c !== "number" || isNaN(c) || c <= 0) continue;
    const h = rawHighs[i], l = rawLows[i], v = rawVols[i];
    closes.push(c);
    highs.push((typeof h === "number" && !isNaN(h) && h > 0) ? h : c);
    lows.push((typeof l === "number" && !isNaN(l) && l > 0) ? l : c);
    volumes.push((typeof v === "number" && !isNaN(v) && v > 0) ? v : 0);
    dates.push((ts[i] ? ts[i] * 1000 : Date.now()));
  }
  if (closes.length === 0) throw new Error("no daily close");
  return { symbol: symbol, closes: closes, highs: highs, lows: lows, volumes: volumes, dates: dates };
}

function _btSliceDaily(full, endIdx) {
  return {
    closes: full.closes.slice(0, endIdx + 1),
    highs: full.highs.slice(0, endIdx + 1),
    lows: full.lows.slice(0, endIdx + 1),
    volumes: full.volumes ? full.volumes.slice(0, endIdx + 1) : [],
    prevClose: endIdx >= 1 ? full.closes[endIdx - 1] : full.closes[endIdx]
  };
}

// 단일 심볼 백테스트. fullData: fetchDailyForBacktest 반환물. cfg: 설정. market: 'us'|'kr'
// evaluateSell이 Date.now()로 보유기간을 계산하므로, 각 봉의 날짜를 _btNow에 주입한다.
let _btNow = null;  // null이면 실제 Date.now 사용
const _btRealNow = Date.now;
function backtestSymbol(fullData, cfg, market, opts) {
  opts = opts || {};
  const warmup = opts.warmup || 30;
  const slippagePct = opts.slippagePct != null ? opts.slippagePct : 0.1;
  const feeRate = market === "us" ? (cfg.feeUS || 0) : (cfg.feeKR || 0);
  const sellTaxRate = market === "kr" ? (cfg.krSellTax || 0) : 0;
  const n = fullData.closes.length;
  if (n < warmup + 5) return { trades: [], skipped: "too_short" };

  // day 전략 제외 (분봉 전략)
  const cfgBt = JSON.parse(JSON.stringify(cfg));
  if (cfgBt.strategies) cfgBt.strategies.day = false;

  const signalStats = {};
  const regime = { name: "NEUTRAL" };
  const trades = [];
  const openPositions = {};

  // Date.now를 백테스트 시계로 교체
  Date.now = function() { return _btNow != null ? _btNow : _btRealNow(); };
  try {
    for (let i = warmup; i < n; i++) {
      const price = fullData.closes[i];
      const prevClose = fullData.closes[i - 1];
      const dayPct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      const daily = _btSliceDaily(fullData, i);
      const barTime = fullData.dates ? fullData.dates[i] : (_btRealNow() - (n - i) * 86400000);
      _btNow = barTime;

      const dailyRsi = getRSI(daily.closes, cfg.rsiPeriod || 14);
      const dailyMa = getMA(daily.closes, 20);
      const dailyMaShort = getMA(daily.closes, 5);

      // 매도 평가
      for (const strat of Object.keys(openPositions)) {
        const pos = openPositions[strat];
        if (!pos.meta.peakPrice || price > pos.meta.peakPrice) pos.meta.peakPrice = price;
        const decision = evaluateSell(pos, price, daily, dailyRsi, dailyMa, dailyMaShort, cfgBt, true, market);
        if (decision && decision.sell) {
          const sellQty = decision.sellQty || pos.qty;
          const execPrice = price * (1 - slippagePct / 100);
          const gross = execPrice * sellQty;
          const proceeds = gross - gross * feeRate - gross * sellTaxRate;
          const entryCost = pos.avg * sellQty;
          const entryFee = (pos.meta.feeRemaining || 0) * (sellQty / pos.qty);
          const pnl = proceeds - entryCost - entryFee;
          const pnlPct = (entryCost + entryFee) > 0 ? (pnl / (entryCost + entryFee)) * 100 : 0;
          trades.push({ symbol: fullData.symbol, strategy: strat, entryIdx: pos.entryIdx, exitIdx: i, entryPrice: pos.avg, exitPrice: execPrice, qty: sellQty, pnl: pnl, pnlPct: pnlPct, reason: decision.reason, signal: pos.meta.signalName });
          if (sellQty < pos.qty) { pos.qty -= sellQty; pos.meta.tp1Done = true; pos.meta.feeRemaining = Math.max(0, (pos.meta.feeRemaining || 0) - entryFee); }
          else { delete openPositions[strat]; }
        }
      }

      // 매수 평가
      const results = evaluateAllStrategies(price, dayPct, daily, cfgBt, signalStats, regime, market, null);
      for (const r of results) {
        const strat = r.strategy;
        if (openPositions[strat]) continue;
        const signal = r.signal;
        const ratio = getPositionSizeRatio(cfgBt, strat, regime.name);
        const budget = (opts.capitalPerTrade || 1000000) * ratio / 0.25;
        const qty = Math.max(1, Math.floor(budget / price));
        const entryPrice = price * (1 + slippagePct / 100);
        const entryFee = entryPrice * qty * feeRate;
        const rules = getStrategyRules(cfgBt, strat);
        const atr = getATR(daily.closes, 14, daily.highs, daily.lows);
        let stopPrice = null;
        if (atr != null && atr > 0) {
          const atrStopPct = (atr / price) * 100 * 1.5;
          const stopPct = Math.max(rules.stopLossPct || cfg.stopLoss || 5, atrStopPct);
          stopPrice = entryPrice * (1 - stopPct / 100);
        }
        openPositions[strat] = {
          symbol: fullData.symbol, strategy: strat, qty: qty, avg: entryPrice, opened_ts: barTime, entryIdx: i,
          meta: { strategy: strat, signalName: signal.name, signalMembers: signal.members || [signal.name], peakPrice: entryPrice, stopPrice: stopPrice, feeRemaining: entryFee, tp1Done: false }
        };
      }
    }

    // 미청산 포지션 마지막 종가로 청산
    const lastPrice = fullData.closes[n - 1];
    for (const strat of Object.keys(openPositions)) {
      const pos = openPositions[strat];
      const proceeds = lastPrice * pos.qty * (1 - feeRate - sellTaxRate);
      const entryCost = pos.avg * pos.qty;
      const pnl = proceeds - entryCost - (pos.meta.feeRemaining || 0);
      const pnlPct = entryCost > 0 ? (pnl / entryCost) * 100 : 0;
      trades.push({ symbol: fullData.symbol, strategy: strat, entryIdx: pos.entryIdx, exitIdx: n - 1, entryPrice: pos.avg, exitPrice: lastPrice, qty: pos.qty, pnl: pnl, pnlPct: pnlPct, reason: "BT-END-MTM", signal: pos.meta.signalName });
    }
  } finally {
    _btNow = null;
    Date.now = _btRealNow;  // 반드시 복구 (워커 다른 로직 보호)
  }

  return { trades: trades };
}

function backtestStats(trades) {
  if (trades.length === 0) return { trades: 0, note: "거래 없음" };
  const wins = trades.filter(function(t) { return t.pnl > 0; });
  const losses = trades.filter(function(t) { return t.pnl <= 0; });
  const totalPnl = trades.reduce(function(s, t) { return s + t.pnl; }, 0);
  const grossWin = wins.reduce(function(s, t) { return s + t.pnl; }, 0);
  const grossLoss = Math.abs(losses.reduce(function(s, t) { return s + t.pnl; }, 0));
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  let cum = 0, peak = 0, mdd = 0;
  const sorted = trades.slice().sort(function(a, b) { return a.exitIdx - b.exitIdx; });
  for (const t of sorted) { cum += t.pnl; if (cum > peak) peak = cum; const dd = peak - cum; if (dd > mdd) mdd = dd; }
  return {
    trades: trades.length,
    winRate: +(wins.length / trades.length * 100).toFixed(1),
    totalPnl: +totalPnl.toFixed(0),
    avgPnlPct: +(trades.reduce(function(s, t) { return s + t.pnlPct; }, 0) / trades.length).toFixed(2),
    avgWinPct: wins.length ? +(wins.reduce(function(s,t){return s+t.pnlPct;},0)/wins.length).toFixed(2) : 0,
    avgLossPct: losses.length ? +(losses.reduce(function(s,t){return s+t.pnlPct;},0)/losses.length).toFixed(2) : 0,
    payoffRatio: avgLoss > 0 ? +(avgWin / avgLoss).toFixed(2) : null,
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : null,
    maxDrawdown: +mdd.toFixed(0),
    expectancy: +(totalPnl / trades.length).toFixed(0)
  };
}

function backtestStatsByStrategy(trades) {
  const out = {};
  for (const strat of STRATEGIES) {
    const subset = trades.filter(function(t) { return t.strategy === strat; });
    if (subset.length > 0) out[strat] = backtestStats(subset);
  }
  return out;
}

function backtestStatsBySignal(trades) {
  const out = {};
  for (const t of trades) {
    const sig = t.signal || "unknown";
    if (!out[sig]) out[sig] = [];
    out[sig].push(t);
  }
  const result = {};
  for (const sig of Object.keys(out)) result[sig] = backtestStats(out[sig]);
  return result;
}

// 여러 심볼 백테스트 실행 + 통합 통계
async function runBacktest(env, opts) {
  opts = opts || {};
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
  const market = opts.market || "us";
  const range = opts.range || "2y";
  const symbols = opts.symbols || (market === "us" ? cfg.usTickers : cfg.krTickers).slice(0, opts.maxSymbols || 15);

  const allTrades = [];
  const perSymbol = {};
  const errors = [];
  for (const sym of symbols) {
    try {
      const data = await fetchDailyForBacktest(sym, range);
      const res = backtestSymbol(data, cfg, market, { slippagePct: opts.slippagePct != null ? opts.slippagePct : 0.1, capitalPerTrade: opts.capitalPerTrade || 1000000 });
      if (res.skipped) { errors.push({ symbol: sym, reason: res.skipped }); continue; }
      perSymbol[sym] = backtestStats(res.trades);
      for (const t of res.trades) allTrades.push(t);
    } catch (e) {
      errors.push({ symbol: sym, error: e.message });
    }
  }

  return {
    config: { market: market, range: range, symbols: symbols, slippagePct: opts.slippagePct != null ? opts.slippagePct : 0.1, note: "day 전략 제외(분봉), 일봉 종가 체결" },
    overall: backtestStats(allTrades),
    byStrategy: backtestStatsByStrategy(allTrades),
    bySignal: backtestStatsBySignal(allTrades),
    bySymbol: perSymbol,
    errors: errors
  };
}

async function refreshQuotesOnly(env, market) {
  const DB = env.DB;
  await ensureSchema(DB);
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
  await log(DB, "INFO", null, "=== Manual quote refresh: " + market.toUpperCase() + " ===");

  const indices = market === "us" ? US_INDICES : KR_INDICES;
  for (const idx of indices) {
    try { const d = await fetchIndexDaily(idx); await saveIndex(DB, idx, market, d); }
    catch (e) { await log(DB, "WARN", idx, "index fetch fail: " + e.message); }
  }

  const tickers = market === "us" ? cfg.usTickers : cfg.krTickers;
  let ok = 0, fail = 0;
  for (const symbol of tickers) {
    try {
      const intra = await fetchIntraday(symbol);
      const daily = await getDailyCached(DB, symbol, cfg.dailyCacheMinutes);
      if (!intra.price || intra.price <= 0) { fail++; continue; }
      const price = intra.price;
      const prevClose = intra.prevClose || price;
      const dayPct = ((price - prevClose) / prevClose) * 100;
      const closes = daily.closes || [];
      const highs = daily.highs || null;
      const lows = daily.lows || null;
      const dailyRsi = closes.length >= cfg.rsiPeriod + 1 ? getRSI(closes, cfg.rsiPeriod) : null;
      const dailyMa = closes.length >= cfg.maPeriod ? getMA(closes, cfg.maPeriod) : null;
      const dailyMaShort = closes.length >= cfg.maShortPeriod ? getMA(closes, cfg.maShortPeriod) : null;
      const dailyAtr = closes.length >= cfg.atrPeriod + 1 ? getATR(closes, cfg.atrPeriod, highs, lows) : null;
      const bb = getBollingerBands(closes, cfg.maPeriod, cfg.bbStdMult);
      const return20 = getNDayReturn(closes, 20);
      await saveQuote(DB, symbol, market, {
        price: price, prevClose: prevClose, dayPct: dayPct,
        dailyRsi: dailyRsi, dailyMa: dailyMa, dailyMaShort: dailyMaShort, dailyAtr: dailyAtr,
        bbLower: bb ? bb.lower : null, bbUpper: bb ? bb.upper : null,
        return20: return20
      });
      ok++;
    } catch (e) {
      fail++;
      await log(DB, "ERROR", symbol, "fetch fail: " + e.message);
    }
  }
  await log(DB, "INFO", null, market.toUpperCase() + " quote refresh done: ok=" + ok + " fail=" + fail);
  return { ok: ok, fail: fail };
}

// === [개선] AutoTune — 신호별 승률 추적 + Confluence 토글 ===
async function autoTune(DB, cfg, regimes) {
  if (!cfg.autoTune) return cfg;
  try {
    // [V8.2] 신호별 통계는 시장 무관 (성능 평균)
    // [V8.3] window 크기를 cfg.signalStatsWindow로 제어 (기본 80건)
    //        + 최근 거래에 더 큰 가중치 (시간 감쇠) — 시장 국면 변화 추종력↑
    const statsWindow = cfg.signalStatsWindow || 80;
    const tradesResAll = await DB.prepare("SELECT * FROM trades WHERE side = ? ORDER BY ts DESC LIMIT ?")
      .bind("SELL", statsWindow).all();
    const recentSellsAll = tradesResAll.results || [];

    const signalStats = {};            // 기존 signal-only 통계 (하위 호환 유지)
    const signalStatsByStrat = {};     // [V8.5] strategy:signal 차원 통계
    const N = recentSellsAll.length;
    for (let i = 0; i < N; i++) {
      const t = recentSellsAll[i];
      const reason = t.reason || "";
      const m = reason.match(/#entry=([A-Z_][A-Z0-9_,]*)/);
      if (!m) continue;
      // [V8.5] strategy 추출 — reason 앞부분 [STRATEGY] 토큰
      const stratMatch = reason.match(/^\[([A-Z]+)\]/);
      const stratKey = stratMatch ? stratMatch[1].toLowerCase() : "unknown";
      const members = m[1].split(",").filter(function(x){ return x; });
      // [V8.3] 시간 가중치 — 가장 최근(i=0)이 1.0, 가장 오래(i=N-1)가 0.5
      const recencyWeight = N > 1 ? (1.0 - 0.5 * (i / (N - 1))) : 1.0;
      // 동일 거래가 멤버 K개일 때 PnL은 1/K 귀속 (cross-conf 거래 중복 카운팅 완화)
      const memberShare = members.length > 0 ? (1 / members.length) : 1;
      for (const sigName of members) {
        // 1) signal-only
        if (!signalStats[sigName]) signalStats[sigName] = { wins: 0, count: 0, totalPnl: 0, weightedWins: 0, weightedCount: 0 };
        signalStats[sigName].count++;
        signalStats[sigName].totalPnl += (t.pnl_pct || 0) * memberShare;
        signalStats[sigName].weightedCount += recencyWeight;
        if (t.pnl_pct > 0) {
          signalStats[sigName].wins++;
          signalStats[sigName].weightedWins += recencyWeight;
        }
        // 2) [V8.5] strategy:signal
        const sKey = stratKey + ":" + sigName;
        if (!signalStatsByStrat[sKey]) signalStatsByStrat[sKey] = { wins: 0, count: 0, totalPnl: 0, weightedWins: 0, weightedCount: 0 };
        signalStatsByStrat[sKey].count++;
        signalStatsByStrat[sKey].totalPnl += (t.pnl_pct || 0) * memberShare;
        signalStatsByStrat[sKey].weightedCount += recencyWeight;
        if (t.pnl_pct > 0) {
          signalStatsByStrat[sKey].wins++;
          signalStatsByStrat[sKey].weightedWins += recencyWeight;
        }
      }
    }
    for (const k in signalStats) {
      signalStats[k].winRate = signalStats[k].count > 0 ? signalStats[k].wins / signalStats[k].count : 0;
      signalStats[k].avgPnl = signalStats[k].count > 0 ? signalStats[k].totalPnl / signalStats[k].count : 0;
      signalStats[k].weightedWinRate = signalStats[k].weightedCount > 0
        ? signalStats[k].weightedWins / signalStats[k].weightedCount : signalStats[k].winRate;
    }
    for (const k in signalStatsByStrat) {
      const s = signalStatsByStrat[k];
      s.winRate = s.count > 0 ? s.wins / s.count : 0;
      s.avgPnl = s.count > 0 ? s.totalPnl / s.count : 0;
      s.weightedWinRate = s.weightedCount > 0 ? s.weightedWins / s.weightedCount : s.winRate;
    }
    await setState(DB, "signal_stats", signalStats);
    await setState(DB, "signal_stats_strat", signalStatsByStrat);

    // [V8.2] 시장별 독립 학습 — US/KR 각각 거래만 따로 보고 따로 조정
    const newCfg = JSON.parse(JSON.stringify(cfg));  // deep clone (markets 객체 안전)
    if (!newCfg.markets) newCfg.markets = { us: {}, kr: {} };
    let anyChange = false;
    const allChanges = [];

    // [V8.5] 손실 신호 자동 비활성화 임계 완화 — 표본 20+ & WR<40% & avgPnL<0
    //        + 비활성화 시점 기록 → 30일 경과 시 재평가 큐 진입.
    //        시장 무관 공통 처리 (signal_stats 자체가 시장 무관).
    if (!newCfg.disabledSignals) newCfg.disabledSignals = [];
    if (!newCfg.disabledSignalsAt) newCfg.disabledSignalsAt = {};
    const newlyDisabled = [];
    const reviewMs = (cfg.signalReviewDays || 30) * 24 * 3600 * 1000;
    const nowTs = Date.now();
    // 1) 신규 비활성화
    for (const sigName in signalStats) {
      const s = signalStats[sigName];
      if (s.count >= 20 && s.weightedWinRate < 0.40 && s.avgPnl < 0) {
        if (newCfg.disabledSignals.indexOf(sigName) === -1) {
          newCfg.disabledSignals.push(sigName);
          newCfg.disabledSignalsAt[sigName] = nowTs;
          newlyDisabled.push(sigName);
        }
      }
    }
    // 2) 재활성화 — 비활성화 후 reviewDays 경과 + 최근 표본 회복 시
    const reactivated = [];
    const stillDisabled = [];
    for (const sigName of newCfg.disabledSignals) {
      const disabledAt = newCfg.disabledSignalsAt[sigName] || 0;
      if (nowTs - disabledAt >= reviewMs) {
        // 재평가 — 누적 표본은 이미 위에서 계산됨. 단순히 풀어줌(다시 트래킹).
        reactivated.push(sigName);
        delete newCfg.disabledSignalsAt[sigName];
      } else {
        stillDisabled.push(sigName);
      }
    }
    newCfg.disabledSignals = stillDisabled;
    if (newlyDisabled.length > 0) {
      allChanges.push("DISABLE " + newlyDisabled.join(","));
      anyChange = true;
      await log(DB, "TUNE", null, "Auto-disabled signals (n>=20, WR<40%, avgPnL<0): " + newlyDisabled.join(", "));
    }
    if (reactivated.length > 0) {
      allChanges.push("REACTIVATE " + reactivated.join(","));
      anyChange = true;
      await log(DB, "TUNE", null, "Re-evaluated signals (after " + (cfg.signalReviewDays || 30) + "d): " + reactivated.join(", "));
    }

    for (const market of ['us', 'kr']) {
      // 시장별 최근 SELL 50건
      const mtRes = await DB.prepare("SELECT * FROM trades WHERE side = ? AND market = ? ORDER BY ts DESC LIMIT 50")
        .bind("SELL", market).all();
      const mtSells = mtRes.results || [];
      if (mtSells.length < 10) continue;  // 시장별 표본 10 미만 → 학습 보류

      // 시장별 튠 상태 — 10건마다만 재조정
      const tuneKey = "autotune_state_" + market;
      const tuneState = await getState(DB, tuneKey, { lastTunedAt: 0, tradeCountAtLastTune: 0 });
      const totalRes = await DB.prepare("SELECT COUNT(*) as c FROM trades WHERE side = ? AND market = ?")
        .bind("SELL", market).first();
      const sellCount = (totalRes && totalRes.c) || 0;
      if (sellCount - tuneState.tradeCountAtLastTune < 10) continue;

      const wins = mtSells.filter(function(t){ return t.pnl_pct > 0; });
      const winRate = wins.length / mtSells.length;
      const avgPnl = mtSells.reduce(function(a,t){ return a + (t.pnl_pct || 0); }, 0) / mtSells.length;
      const regime = (regimes[market] && regimes[market].regime) || "NEUTRAL";

      // 시장 cfg 머지된 현재 값 (베이스 폴백 포함)
      const curMcfg = getMarketCfg(cfg, market);
      const mChanges = [];
      const mNew = newCfg.markets[market];

      // RSI 조정 — 시장별 regime + 시장별 성과 기준
      if (regime === "BEAR" && avgPnl < 0) {
        const next = Math.max(30, curMcfg.rsiBuy - 2);
        if (next !== curMcfg.rsiBuy) { mNew.rsiBuy = next; mChanges.push("RSI " + curMcfg.rsiBuy + "->" + next); }
      } else if (regime === "BULL" && winRate > 0.55 && avgPnl > 2) {
        const next = Math.min(40, curMcfg.rsiBuy + 1);
        if (next !== curMcfg.rsiBuy) { mNew.rsiBuy = next; mChanges.push("RSI " + curMcfg.rsiBuy + "->" + next); }
      }

      // [V8.2] 시장별 stopLoss 조정 — 시장 성과 나쁘면 손절 더 타이트
      if (winRate < 0.40 && avgPnl < -1.0) {
        const next = Math.max(2.0, +(curMcfg.stopLoss - 0.5).toFixed(2));
        if (next !== curMcfg.stopLoss) { mNew.stopLoss = next; mChanges.push("STOP " + curMcfg.stopLoss + "->" + next); }
      } else if (winRate > 0.55 && avgPnl > 1.5) {
        // 잘 되면 살짝 여유 (조기 손절 방지)
        const next = Math.min(8.0, +(curMcfg.stopLoss + 0.3).toFixed(2));
        if (next !== curMcfg.stopLoss) { mNew.stopLoss = next; mChanges.push("STOP " + curMcfg.stopLoss + "->" + next); }
      }

      // [V8.2.1] rsiSell 조정 — 평균 PnL이 좋으면 더 늦게 익절(욕심), 나쁘면 빠르게
      if (winRate > 0.55 && avgPnl > 2.0) {
        const next = Math.min(80, curMcfg.rsiSell + 1);
        if (next !== curMcfg.rsiSell) { mNew.rsiSell = next; mChanges.push("RSISELL " + curMcfg.rsiSell + "->" + next); }
      } else if (winRate < 0.40 && avgPnl < 0) {
        const next = Math.max(60, curMcfg.rsiSell - 1);
        if (next !== curMcfg.rsiSell) { mNew.rsiSell = next; mChanges.push("RSISELL " + curMcfg.rsiSell + "->" + next); }
      }

      // [V8.2.1] takeProfit1 조정 — 잘되면 욕심, 안되면 빠르게 익절
      const curTp1 = (curMcfg.swingRules && curMcfg.swingRules.tp1) != null ? curMcfg.swingRules.tp1 : curMcfg.takeProfit1;
      if (curTp1 != null) {
        let newTp1 = null;
        if (winRate > 0.55 && avgPnl > 2.0) newTp1 = Math.min(8.0, +(curTp1 + 0.2).toFixed(2));
        else if (winRate < 0.40 && avgPnl < 0) newTp1 = Math.max(2.0, +(curTp1 - 0.2).toFixed(2));
        if (newTp1 !== null && newTp1 !== curTp1) {
          mNew.takeProfit1 = newTp1;
          // swingRules.tp1도 같이 sync (있을 때만)
          if (curMcfg.swingRules) {
            mNew.swingRules = Object.assign({}, curMcfg.swingRules, { tp1: newTp1 });
          }
          mChanges.push("TP1 " + curTp1 + "->" + newTp1);
        }
      }

      // [V8.2.1] takeProfit2 조정 — TP1과 같은 방향, 더 큰 폭
      const curTp2 = (curMcfg.swingRules && curMcfg.swingRules.tp2) != null ? curMcfg.swingRules.tp2 : curMcfg.takeProfit2;
      if (curTp2 != null) {
        let newTp2 = null;
        if (winRate > 0.55 && avgPnl > 2.0) newTp2 = Math.min(20.0, +(curTp2 + 0.5).toFixed(2));
        else if (winRate < 0.40 && avgPnl < 0) newTp2 = Math.max(6.0, +(curTp2 - 0.5).toFixed(2));
        if (newTp2 !== null && newTp2 !== curTp2) {
          mNew.takeProfit2 = newTp2;
          if (curMcfg.swingRules) {
            mNew.swingRules = Object.assign({}, mNew.swingRules || curMcfg.swingRules, { tp2: newTp2 });
          }
          mChanges.push("TP2 " + curTp2 + "->" + newTp2);
        }
      }

      // [V8.2.1] SwingSize(strategySizing.swing.base) 조정 — 성과 매우 좋으면 사이즈 키움
      const curSizing = curMcfg.strategySizing || {};
      const curSwingBase = (curSizing.swing && curSizing.swing.base) != null ? curSizing.swing.base : curMcfg.posSize;
      if (curSwingBase != null) {
        let newSwingBase = null;
        if (winRate > 0.60 && avgPnl > 2.5) newSwingBase = Math.min(40, curSwingBase + 1);
        else if (winRate < 0.35 && avgPnl < -1.0) newSwingBase = Math.max(10, curSwingBase - 1);
        if (newSwingBase !== null && newSwingBase !== curSwingBase) {
          // strategySizing 객체 deep-ish copy해서 swing.base만 갱신
          const baseSizing = mNew.strategySizing || JSON.parse(JSON.stringify(curSizing));
          if (!baseSizing.swing) baseSizing.swing = { base: curSwingBase, bullMult: 1.0, bearMult: 1.0 };
          baseSizing.swing.base = newSwingBase;
          mNew.strategySizing = baseSizing;
          // posSize도 같이 sync (폴백용)
          mNew.posSize = newSwingBase;
          mChanges.push("SWGSIZE " + curSwingBase + "->" + newSwingBase);
        }
      }

      if (mChanges.length > 0) {
        await setState(DB, tuneKey, { lastTunedAt: Date.now(), tradeCountAtLastTune: sellCount });
        await log(DB, "TUNE", null, "[" + market.toUpperCase() + "/" + regime + "] WR=" + (winRate*100).toFixed(0) + "% PnL=" + avgPnl.toFixed(2) + "% -> " + mChanges.join(", "));
        anyChange = true;
        allChanges.push(market.toUpperCase() + ":" + mChanges.join(","));
      }
    }

    // [V8.1.3] requireConfluence 강제 OFF — 시장 무관 공통
    if (cfg.requireConfluence) {
      newCfg.requireConfluence = false;
      allChanges.push("CONF=OFF (forced reset)");
      anyChange = true;
    }

    if (anyChange) {
      await setState(DB, "cfg", newCfg);
      return newCfg;
    }
  } catch (e) { await log(DB, "WARN", null, "autoTune skipped: " + e.message); }
  return cfg;
}

// === [수정] Cycle Lock — atomic INSERT WHERE NOT EXISTS로 race condition 차단 ===
// state 테이블의 PRIMARY KEY 제약 + 조건부 INSERT로 atomic하게 락 획득.
// D1은 단일 SQL 문장은 atomic하므로 두 동시 호출 중 하나만 성공함.
async function acquireCycleLock(DB, ttl) {
  const now = Date.now();
  const lockKey = "lock:cycle";
  const lockValue = JSON.stringify({ until: now + ttl, pid: now });

  // 1) 만료된 락은 먼저 정리 (where 조건으로 atomic하게)
  try {
    await DB.prepare(
      "DELETE FROM state WHERE k = ? AND CAST(json_extract(v, '$.until') AS INTEGER) <= ?"
    ).bind(lockKey, now).run();
  } catch (e) {
    // json_extract 미지원 환경 fallback — 만료 검사 없이 진행
    try {
      const row = await DB.prepare("SELECT v FROM state WHERE k = ?").bind(lockKey).first();
      if (row) {
        let parsed = null;
        try { parsed = JSON.parse(row.v); } catch (e2) {}
        if (parsed && parsed.until && parsed.until <= now) {
          await DB.prepare("DELETE FROM state WHERE k = ?").bind(lockKey).run();
        }
      }
    } catch (e3) {}
  }

  // 2) atomic INSERT — 락이 이미 있으면 실패 (ON CONFLICT 사용 안 함)
  try {
    const res = await DB.prepare(
      "INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?)"
    ).bind(lockKey, lockValue, now).run();
    // 성공 시 락 획득
    return true;
  } catch (e) {
    // UNIQUE constraint 위반 = 다른 인스턴스가 락 보유 중
    return false;
  }
}

async function releaseCycleLock(DB) {
  try {
    await DB.prepare("DELETE FROM state WHERE k = ?").bind("lock:cycle").run();
  } catch (e) {}
}

// [V8.5] 사이클 락 갱신 — 한 시장 처리 후 호출되어 다음 시장 처리 전 TTL 연장.
// stale 락으로 동시 인스턴스가 진입하는 것을 방지.
async function refreshCycleLock(DB, ttl) {
  const now = Date.now();
  const lockValue = JSON.stringify({ until: now + ttl, pid: now });
  try {
    await DB.prepare(
      "UPDATE state SET v = ?, updated_ts = ? WHERE k = ?"
    ).bind(lockValue, now, "lock:cycle").run();
  } catch (e) {}
}

// ============================================================
// [COMMODITY] 원자재 트레이딩 사이클
//   • 대상: 금/은/플래티넘/구리/WTI/브렌트유/천연가스/알루미늄 (야후 선물 심볼)
//   • 전략: 주식 swing 전략과 동일한 신호/매도 로직 사용 (evaluateBuySignals_swing / evaluateSell의 swing 분기)
//   • 시각: 하루 1회, 16:00 KST에만 매수/매도 (isCommodityTriggerTime)
//   • 자금: 별도 현금 풀 cash.cm ($100,000), positions market="cm", trades market="cm"
//   • 가격: 전부 USD. 수수료는 feeUS 사용, 매도세 없음.
//   • 주식 로직과 완전히 분리 — 기존 US/KR 매매에 영향 없음.
// ============================================================

// 원자재 전용 매수 — executeBuy를 그대로 못 쓰는 이유: 기존 함수는
//   market !== "us" 이면 feeKR/krSellTax를 적용함. 원자재는 USD·무세금이라 별도 작성.
async function executeBuyCM(DB, symbol, qty, price, signal, dailyAtr, cfg, cash) {
  const feeRate = cfg.feeUS || 0.0001;
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  if (total > cash.cm) { await log(DB, "WARN", symbol, "[CM] BUY aborted: cash short"); return; }

  const rules = cfg.swingRules || {};
  const stopPct = rules.stopLossPct || cfg.stopLoss || 5.0;
  const atrMult = rules.atrStopMult || cfg.atrStopMult || 2.0;
  const pctStop = price * (1 - stopPct / 100);
  let stopPrice = pctStop;
  if (dailyAtr) {
    const atrStop = price - dailyAtr * atrMult;
    stopPrice = Math.min(atrStop, pctStop);
  }
  if (stopPrice > pctStop) stopPrice = pctStop;

  try {
    await savePosition(DB, "cm", symbol, "swing", {
      qty: qty, avg: price, opened_ts: Date.now(),
      meta: {
        strategy: "swing", feePaid: fee, feeRemaining: fee,
        atrAtEntry: dailyAtr, stopPrice: stopPrice, peakPrice: price,
        signal: signal.name, signalMembers: signal.members || [signal.name],
        tp1Done: false, originalQty: qty
      }
    });
  } catch (e) {
    await log(DB, "ERROR", symbol, "[CM] BUY savePosition fail: " + e.message);
    return;
  }

  cash.cm -= total;
  await recordTrade(DB, {
    ts: Date.now(), market: "cm", symbol: symbol, side: "BUY",
    qty: qty, price: price,
    reason: "[CM-SWING] " + signal.name + " " + signal.detail
  });
  const stopPctRel = ((stopPrice - price) / price * 100).toFixed(1);
  await log(DB, "TRADE", symbol, "[CM] BUY x" + qty + " @" + price.toFixed(2) + " " + signal.name + " " + signal.detail + " stop=" + stopPrice.toFixed(2) + "(" + stopPctRel + "%)");
}

// 원자재 전용 매도 — USD·무세금. 부분/전량 청산 지원.
async function executeSellCM(DB, symbol, pos, sellQty, price, reason, cfg, cash) {
  const feeRate = cfg.feeUS || 0.0001;
  const gross = price * sellQty;
  const fee = gross * feeRate;
  const proceeds = gross - fee;   // 원자재: 매도세 없음
  cash.cm += proceeds;

  pos.meta = pos.meta || {};
  const feeRemaining = (typeof pos.meta.feeRemaining === "number") ? pos.meta.feeRemaining : (pos.meta.feePaid || 0);
  const entryFeeForThisSell = feeRemaining * (sellQty / pos.qty);
  const costBasis = pos.avg * sellQty + entryFeeForThisSell;
  const pnl = proceeds - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
  const heldMin = pos.opened_ts ? Math.floor((Date.now() - pos.opened_ts) / 60000) : 0;
  const signalMembers = pos.meta.signalMembers || [];
  const enrichedReason = "[CM-SWING] " + reason + " #entry=" + signalMembers.join(",");

  if (sellQty < pos.qty) {
    pos.qty = pos.qty - sellQty;
    pos.meta.tp1Done = true;
    pos.meta.feeRemaining = Math.max(0, feeRemaining - entryFeeForThisSell);
    await savePosition(DB, "cm", symbol, "swing", pos);
  } else {
    await deletePosition(DB, symbol, "swing");
  }

  await recordTrade(DB, { ts: Date.now(), market: "cm", symbol: symbol, side: "SELL", qty: sellQty, price: price, pnl: pnl, pnl_pct: pnlPct, reason: enrichedReason });
  await log(DB, "TRADE", symbol, "[CM] SELL x" + sellQty + " @" + price.toFixed(2) + " PnL " + pnlPct.toFixed(2) + "% (held " + heldMin + "min, " + reason + ")");
  return { pnlPct: pnlPct };
}

// 원자재 시세 저장 (quote:SYM 키 재사용 — market="cm" 태그)
async function saveQuoteCM(DB, symbol, q) {
  await setState(DB, "quote:" + symbol, {
    market: "cm", price: q.price, prevClose: q.prevClose, dayPct: q.dayPct,
    rsi: q.dailyRsi, ma: q.dailyMa, atr: q.dailyAtr,
    dailyAtr: q.dailyAtr, dailyMa: q.dailyMa, dailyMaShort: q.dailyMaShort,
    bbLower: q.bbLower, bbUpper: q.bbUpper, return20: q.return20, ts: Date.now()
  });
}

async function runCommodityCycle(env, forceTrade) {
  const DB = env.DB;
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
  const isTradeTime = forceTrade === true ? true : isCommodityTriggerTime();   // 16:00 KST 평일에만 true (force 시 항상)
  await log(DB, "INFO", null, "[CM] === Commodity cycle (trade=" + (isTradeTime ? (forceTrade ? "FORCED" : "ON 16:00KST") : "quote-only") + ") ===");

  const cash = await getState(DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR, cm: cfg.initialCashCM });
  if (typeof cash.cm !== "number") cash.cm = cfg.initialCashCM;   // 최초 1회 초기화

  const positions = await getPositions(DB, "cm");   // key "SYM::swing"
  const swingRules = cfg.swingRules || {};
  let tried = 0, bought = 0, sold = 0, fetchFail = 0;

  // 시세 prefetch (배치)
  const BATCH = 8;
  const fetched = [];
  for (let i = 0; i < COMMODITY_SYMBOLS.length; i += BATCH) {
    const slice = COMMODITY_SYMBOLS.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async function(symbol){
      try {
        const daily = await fetchDailyFull(symbol);
        return { symbol: symbol, daily: daily, err: null };
      } catch (e) {
        return { symbol: symbol, daily: null, err: e.message };
      }
    }));
    for (const r of results) fetched.push(r);
  }

  for (const item of fetched) {
    const symbol = item.symbol;
    tried++;
    try {
      if (item.err || !item.daily) {
        fetchFail++;
        await log(DB, "WARN", symbol, "[CM] fetch fail: " + (item.err || "no data"));
        continue;
      }
      const daily = item.daily;
      const closes = daily.closes || [];
      const highs = daily.highs || null;
      const lows = daily.lows || null;
      const price = daily.price;
      const prevClose = daily.prevClose || price;
      const dayPct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;

      const dailyRsi = closes.length >= cfg.rsiPeriod + 1 ? getRSI(closes, cfg.rsiPeriod) : null;
      const dailyMa = closes.length >= cfg.maPeriod ? getMA(closes, cfg.maPeriod) : null;
      const dailyMaShort = closes.length >= cfg.maShortPeriod ? getMA(closes, cfg.maShortPeriod) : null;
      const dailyAtr = closes.length >= cfg.atrPeriod + 1 ? getATR(closes, cfg.atrPeriod, highs, lows) : null;
      const bb = getBollingerBands(closes, cfg.maPeriod, cfg.bbStdMult);
      const return20 = getNDayReturn(closes, 20);

      await saveQuoteCM(DB, symbol, {
        price: price, prevClose: prevClose, dayPct: dayPct,
        dailyRsi: dailyRsi, dailyMa: dailyMa, dailyMaShort: dailyMaShort, dailyAtr: dailyAtr,
        bbLower: bb ? bb.lower : null, bbUpper: bb ? bb.upper : null, return20: return20
      });

      // 거래 시각이 아니면 시세만 갱신하고 매매 스킵
      if (!isTradeTime) continue;
      if (dailyRsi == null) continue;

      // === STEP 1: 보유 포지션 매도 평가 (swing 분기) ===
      const posKey = symbol + "::swing";
      const held = positions[posKey];
      if (held) {
        // stop/peak 갱신 (주식 사이클과 동일 패턴)
        if (held.meta && held.meta.stopPrice != null && !held.meta.breakEvenLocked) {
          const stopPct = swingRules.stopLossPct || cfg.stopLoss;
          const safeStop = held.avg * (1 - stopPct / 100);
          if (held.meta.stopPrice > safeStop) {
            held.meta.stopPrice = safeStop;
            try { await savePosition(DB, "cm", symbol, "swing", held); } catch (e) {}
          }
        }
        if (held.meta && held.meta.peakPrice != null && price > held.meta.peakPrice) {
          held.meta.peakPrice = price;
          try { await savePosition(DB, "cm", symbol, "swing", held); } catch (e) {}
        }
        if (held.meta && swingRules.breakEvenAt != null && !held.meta.breakEvenLocked) {
          const curPnl = ((price - held.avg) / held.avg) * 100;
          if (curPnl >= swingRules.breakEvenAt) {
            const newStop = held.avg * (1 + (swingRules.breakEvenLock || 0) / 100);
            if (held.meta.stopPrice == null || held.meta.stopPrice < newStop) held.meta.stopPrice = newStop;
            held.meta.breakEvenLocked = true;
            try { await savePosition(DB, "cm", symbol, "swing", held); } catch (e) {}
          }
        }
        // evaluateSell의 swing 분기 사용 (market="cm" → 매도세 분기 안 탐)
        const sellDecision = evaluateSell(held, price, daily, dailyRsi, dailyMa, dailyMaShort, cfg, true, "cm");
        if (sellDecision.minHoldLock) {
          // 최소 보유시간 미달 — 보류
        } else if (sellDecision.sell) {
          await executeSellCM(DB, symbol, held, sellDecision.sellQty, price, sellDecision.reason, cfg, cash);
          sold++;
          if (sellDecision.sellQty >= held.qty) delete positions[posKey];
        }
      }

      // === STEP 2: swing 매수 신호 평가 ===
      if (positions[posKey]) continue;   // 이미 보유 중이면 추가 매수 안 함
      const signals = evaluateBuySignals_swing(price, dayPct, daily, cfg);
      if (!signals || signals.length === 0) continue;

      // 가장 강한 신호 1개 선택
      let best = signals[0];
      for (const s of signals) if ((s.weight || 0) > (best.weight || 0)) best = s;

      // 리스크 기반 사이징 — 주식 swing과 동일 공식 (cash.cm 기준)
      let actualAtrPct = (dailyAtr != null && price > 0) ? (dailyAtr / price) * 100 : null;
      const baseStopPct = swingRules.stopLossPct || cfg.stopLoss || 5.0;
      let stopDistPct = baseStopPct;
      if (actualAtrPct != null && actualAtrPct > 0) {
        const atrStopPct = actualAtrPct * (swingRules.atrStopMult || cfg.atrStopMult || 2.0);
        stopDistPct = Math.max(baseStopPct, Math.min(atrStopPct, baseStopPct * 1.6));
      }
      const rbs = cfg.riskBasedSizing || {};
      const riskBase = rbs.riskPerTrade != null ? rbs.riskPerTrade : 0.6;
      const minR = rbs.minRisk != null ? rbs.minRisk : 0.3;
      const maxR = rbs.maxRisk != null ? rbs.maxRisk : 1.2;
      let riskPct = riskBase * (best.weight || 1.0);
      if (riskPct < minR) riskPct = minR;
      if (riskPct > maxR) riskPct = maxR;

      const cashCap = cash.cm * 0.85;
      // 원자재 한 거래 캡: 가용현금 25% (분산 위해)
      const maxBudget = cash.cm * 0.25;
      const rawBudget = cash.cm * (riskPct / 100) / (stopDistPct / 100);
      let budget = Math.min(rawBudget, maxBudget, cashCap);

      const feeRate = cfg.feeUS || 0.0001;
      let qty = Math.floor(budget / (price * (1 + feeRate)));
      // 선물 1계약도 못 사면(고가) — 잔액 10% 이내 1계약 허용
      if (qty === 0) {
        const onePrice = price * (1 + feeRate);
        if (onePrice <= cash.cm * 0.10) qty = 1;
      }
      const totalCost = qty * price * (1 + feeRate);
      if (qty > 0 && totalCost <= cash.cm) {
        await executeBuyCM(DB, symbol, qty, price, best, dailyAtr, cfg, cash);
        bought++;
        positions[posKey] = { symbol: symbol, strategy: "swing", qty: qty, avg: price, opened_ts: Date.now(), meta: {} };
      }
    } catch (e) {
      await log(DB, "ERROR", symbol, "[CM] " + e.message);
    }
  }

  if (isTradeTime) {
    try { await setState(DB, "cash", cash); } catch (e) {}
  }
  await log(DB, "INFO", null, "[CM] Done: tried=" + tried + " buy=" + bought + " sell=" + sold + " fetchFail=" + fetchFail);
}

async function runTradingCycle(env) {
  const DB = env.DB;
  await ensureSchema(DB);
  let cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));

  // [V8.1.3] 저장된 cfg에 박힌 잘못된 값 강제 리셋
  // - requireConfluence: 과거 autoTune이 true로 설정했으면 단독 신호 전부 차단됨 → 거래 0
  // - strategies: 비어있거나 누락된 키 있으면 해당 전략 자동 OFF → 거래 0
  if (cfg.requireConfluence) cfg.requireConfluence = false;
  if (!cfg.strategies || typeof cfg.strategies !== "object") {
    cfg.strategies = { swing: true, day: true, momentum: true, meanrev: true };
  } else {
    // 누락된 키는 true로 채움
    for (const s of ["swing", "day", "momentum", "meanrev"]) {
      if (cfg.strategies[s] !== false) cfg.strategies[s] = true;
    }
  }

  if (!cfg.enabled) { await log(DB, "INFO", null, "engine disabled"); return; }

  // [신규] Cycle Lock — 동시 실행 차단
  const gotLock = await acquireCycleLock(DB, cfg.cycleLockTTL || 60000);
  if (!gotLock) {
    await log(DB, "INFO", null, "cycle skipped: lock held");
    return;
  }

  try {
    const enabledStrats = ["swing","day","momentum","meanrev"].filter(function(s){ return cfg.strategies[s]; }).join(",");
    const disabledSigNote = (cfg.disabledSignals && cfg.disabledSignals.length > 0)
      ? " disabled=[" + cfg.disabledSignals.join(",") + "]" : "";
    await log(DB, "INFO", null, "=== Cycle start (V8.6) strats=[" + enabledStrats + "] conf=" + (cfg.requireConfluence ? "ON" : "OFF") + disabledSigNote + " ===");
    const cycleStartedAt = Date.now();

    // [V8.6 Hybrid] LLM 일일 분석 트리거 — 시장별 정해진 시각에 1회 호출
    // KR 09:00 KST, US 09:20 ET (시장 시작 10분 전, DST 자동)
    // 호출은 try-catch로 격리되어 실패해도 매매 사이클은 정상 진행
    if (cfg.llmHybrid && cfg.llmHybrid.enabled) {
      if (isLLMTriggerTime("kr")) {
        try { await runLLMDailyAnalysis(env, "kr"); }
        catch (e) { await log(DB, "ERROR", null, "[LLM] kr trigger fail: " + e.message); }
      }
      if (isLLMTriggerTime("us")) {
        try { await runLLMDailyAnalysis(env, "us"); }
        catch (e) { await log(DB, "ERROR", null, "[LLM] us trigger fail: " + e.message); }
      }
    }

    // [V9 매크로] 경제지표 자동 갱신 — 매일 07:00 KST 1회 (web_search)
    //   try-catch 격리: 실패해도 매매 사이클은 정상 진행.
    if (isMacroTriggerTime()) {
      try { await runMacroUpdate(env); }
      catch (e) { await log(DB, "ERROR", null, "[MACRO] trigger fail: " + e.message); }
    }

    // [V8.6] 거래 윈도우 기준 — KR은 야후 15분 지연 보정해서 09:15~15:45
    const usOpen = isTradingWindow("us");
    const krOpen = isTradingWindow("kr");

    // [V8.1.1] 양 시장 거래 윈도우 둘 다 닫혔으면 사이클 전체 스킵
    if (!usOpen && !krOpen) {
      await log(DB, "CLOSED", null, "US & KR 거래 윈도우 외 — 사이클 스킵");
      return;
    }

    // [V8.1] 지수 fetch — 열린 시장만 (Cloudflare subrequest 한도 절약)
    const indexJobs = [];
    if (usOpen) {
      for (const idx of US_INDICES) {
        indexJobs.push(
          fetchIndexDaily(idx)
            .then(function(d){ return saveIndex(DB, idx, "us", d); })
            .catch(function(e){ return log(DB, "WARN", idx, "index fetch fail: " + e.message); })
        );
      }
    }
    if (krOpen) {
      for (const idx of KR_INDICES) {
        indexJobs.push(
          fetchIndexDaily(idx)
            .then(function(d){ return saveIndex(DB, idx, "kr", d); })
            .catch(function(e){ return log(DB, "WARN", idx, "index fetch fail: " + e.message); })
        );
      }
    }
    await Promise.allSettled(indexJobs);

    const regimes = {
      us: await analyzeMarketRegime(DB, "us"),
      kr: await analyzeMarketRegime(DB, "kr")
    };
    await log(DB, "INFO", null, "Regime US:" + regimes.us.regime + " (worst " + regimes.us.worstDayPct.toFixed(2) + "%, idx20=" + (regimes.us.idxReturn20 != null ? regimes.us.idxReturn20.toFixed(1) : "?") + "%), KR:" + regimes.kr.regime + " (worst " + regimes.kr.worstDayPct.toFixed(2) + "%, idx20=" + (regimes.kr.idxReturn20 != null ? regimes.kr.idxReturn20.toFixed(1) : "?") + "%)");

    cfg = await autoTune(DB, cfg, regimes);
    const signalStats = await getState(DB, "signal_stats", {});
    const cash = await getState(DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });

    let tried = 0, bought = 0, sold = 0, skipped = 0, fetchFail = 0;

    // [V8.1.1] 장 열린 시장만 처리 — 마감된 시장은 시세도 fetch 안 함
    const marketsToTrade = [];
    if (usOpen) marketsToTrade.push("us");
    if (krOpen) marketsToTrade.push("kr");
    const marketsForQuotes = marketsToTrade.slice();

    for (const market of marketsForQuotes) {
      const mcfg = getMarketCfg(cfg, market);  // [V8.2] 시장별 독립 룰
      const tickers = market === "us" ? mcfg.usTickers : mcfg.krTickers;
      const positions = await getPositions(DB, market);  // key: "SYM::strategy"
      const feeRate = market === "us" ? mcfg.feeUS : mcfg.feeKR;
      const regime = regimes[market];
      const canTrade = marketsToTrade.indexOf(market) !== -1;

      // [V8] 보유 심볼 집합 + 섹터 카운트 (전략 무관하게 종목 단위 집계)
      const heldSymbols = new Set();
      const sectorCounts = {};
      for (const key in positions) {
        const sym = positions[key].symbol;
        heldSymbols.add(sym);
      }
      for (const sym of heldSymbols) {
        const sec = SECTOR_MAP[sym];
        if (sec) sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
      }

      // [V8.1.6] 총자산 = 현금 + 보유 포지션 평가액 (최근 quote 기준)
      // 이전엔 cash[market]만 사용해서 매수할수록 사이즈 작아짐
      let portfolioValue = cash[market];
      for (const key in positions) {
        const p = positions[key];
        const lastQuote = await getState(DB, "quote:" + p.symbol, null);
        const lastPrice = (lastQuote && lastQuote.price) ? lastQuote.price : p.avg;
        portfolioValue += p.qty * lastPrice;
      }

      // [V8.1.1] === PREFETCH 단계 (배치 처리) ===
      // 한 시장(20개)을 10개씩 2배치로 처리.
      // Cloudflare Workers subrequest 한도(50/invocation) 회피하면서도
      // 순차 await 대비 빠름.
      const prefetchStart = Date.now();
      const BATCH = 10;
      const fetched = [];
      for (let i = 0; i < tickers.length; i += BATCH) {
        const slice = tickers.slice(i, i + BATCH);
        const batchResults = await Promise.all(slice.map(async function(symbol){
          let intra = null, daily = null, intraOk = false;
          let intraErr = null, dailyErr = null;
          try {
            intra = await fetchIntraday(symbol);
            if (intra && intra.price > 0) intraOk = true;
          } catch (e) { intraErr = e.message; }
          try {
            daily = await getDailyCached(DB, symbol, mcfg.dailyCacheMinutes);
          } catch (e) { dailyErr = e.message; }
          return { symbol: symbol, intra: intra, daily: daily, intraOk: intraOk, intraErr: intraErr, dailyErr: dailyErr };
        }));
        for (const r of batchResults) fetched.push(r);
      }
      const prefetchMs = Date.now() - prefetchStart;
      await log(DB, "INFO", null, "prefetch[" + market + "] " + tickers.length + " syms in " + prefetchMs + "ms");

      // [V8.1] 카운터: NOBUY 로그를 매번 DB에 쓰면 사이클당 100+ INSERT 발생.
      // 사유별로 카운트만 누적해서 시장당 1줄만 요약 로그로 남김.
      const nobuyCounts = {};
      const blockCounts = {};     // [V8.1.2] BLOCK 사유 별도 카운트
      const stateSamples = [];    // [V8.1.2] 종목 상태 샘플 (진단용)
      function incNobuy(reason) { nobuyCounts[reason] = (nobuyCounts[reason] || 0) + 1; }
      function incBlock(reason) { blockCounts[reason] = (blockCounts[reason] || 0) + 1; }

      // [V8.6 Hybrid] 시장별 LLM 일일 지시 로드 — 없거나 만료면 null (V8.5 동작)
      const llmInstr = (cfg.llmHybrid && cfg.llmHybrid.enabled)
        ? await getActiveLLMInstruction(DB, market) : null;
      if (llmInstr) {
        await log(DB, "INFO", null,
          "[LLM] " + market + " active: sentiment=" + llmInstr.sentiment +
          " sizing×" + llmInstr.position_sizing.scale +
          (llmInstr.avoid_symbols.length > 0 ? " avoid=" + llmInstr.avoid_symbols.join(",") : "") +
          (llmInstr.disable_signals.length > 0 ? " disableSig=" + llmInstr.disable_signals.join(",") : "")
        );
      }

      // === 평가 단계 (직렬 처리: cash/positions 일관성 유지) ===
      for (const item of fetched) {
        const symbol = item.symbol;
        tried++;
        try {
          if (item.intraErr) {
            fetchFail++;
            await log(DB, "WARN", symbol, "intraday fail: " + item.intraErr);
          }
          if (item.dailyErr) {
            fetchFail++;
            await log(DB, "WARN", symbol, "daily fail: " + item.dailyErr);
            skipped++;
            continue;
          }
          const intra = item.intra;
          const daily = item.daily;
          const intraOk = item.intraOk;
          if (!daily) { skipped++; continue; }

          let price, prevClose;
          if (intraOk) {
            price = intra.price;
            prevClose = intra.prevClose || price;
          } else if (daily && daily.closes && daily.closes.length > 0) {
            price = daily.closes[daily.closes.length - 1];
            prevClose = daily.prevClose || price;
            // [V8.1.2] fallback 로그 → 카운터로 (이전: 종목마다 DB write)
            incNobuy("daily_fallback");
          } else {
            skipped++;
            continue;
          }

          const dayPct = ((price - prevClose) / prevClose) * 100;
          const closes = daily.closes || [];
          const highs = daily.highs || null;
          const lows = daily.lows || null;
          const dailyRsi = closes.length >= mcfg.rsiPeriod + 1 ? getRSI(closes, mcfg.rsiPeriod) : null;
          const dailyMa = closes.length >= mcfg.maPeriod ? getMA(closes, mcfg.maPeriod) : null;
          const dailyMaShort = closes.length >= mcfg.maShortPeriod ? getMA(closes, mcfg.maShortPeriod) : null;
          const dailyAtr = closes.length >= mcfg.atrPeriod + 1 ? getATR(closes, mcfg.atrPeriod, highs, lows) : null;
          const bb = getBollingerBands(closes, mcfg.maPeriod, mcfg.bbStdMult);
          const return20 = getNDayReturn(closes, 20);

          await saveQuote(DB, symbol, market, {
            price: price, prevClose: prevClose, dayPct: dayPct,
            dailyRsi: dailyRsi, dailyMa: dailyMa, dailyMaShort: dailyMaShort, dailyAtr: dailyAtr,
            bbLower: bb ? bb.lower : null, bbUpper: bb ? bb.upper : null,
            return20: return20
          });

          if (dailyRsi == null) { skipped++; continue; }
          if (!canTrade) { skipped++; continue; }

          // === [V8] STEP 1: 이 종목에 보유 중인 모든 전략 포지션 매도 평가 ===
          const strategiesHeld = getStrategiesHeldForSymbol(positions, symbol);
          for (const stratName of STRATEGIES) {
            if (!strategiesHeld.has(stratName)) continue;
            const posKey = symbol + "::" + stratName;
            const held = positions[posKey];
            if (!held) continue;

            // peak / stop 갱신
            // [V8.5 BUG FIX] breakEvenLocked이면 safeStop으로 끌어내리지 않음 —
            // 기존 코드는 break-even으로 진입가 위로 올라간 stop을 매 사이클 진입가-stopPct%로 되돌렸음.
            if (held.meta && held.meta.stopPrice != null && !held.meta.breakEvenLocked) {
              const stopPct = (getStrategyRules(mcfg, stratName).stopLossPct || mcfg.stopLoss);
              const safeStop = held.avg * (1 - stopPct / 100);
              if (held.meta.stopPrice > safeStop) {
                held.meta.stopPrice = safeStop;
                try { await savePosition(DB, market, symbol, stratName, held); } catch (e) {}
              }
            }
            if (held.meta && held.meta.peakPrice != null && price > held.meta.peakPrice) {
              held.meta.peakPrice = price;
              try { await savePosition(DB, market, symbol, stratName, held); } catch (e) {}
            }

            // [V8.3] Break-even stop — 수익 +breakEvenAt% 도달 시 stopPrice를 진입가 + breakEvenLock%로 끌어올림.
            // 한 번 설정되면 더 내려가지 않음 (수익 → 본전 전환 방지).
            // ATR-STOP 분기에서 사용되므로 stopPrice를 직접 조작.
            const breakRules = getStrategyRules(mcfg, stratName);
            if (held.meta && breakRules.breakEvenAt != null && !held.meta.breakEvenLocked) {
              const curPnl = ((price - held.avg) / held.avg) * 100;
              if (curPnl >= breakRules.breakEvenAt) {
                const newStop = held.avg * (1 + (breakRules.breakEvenLock || 0) / 100);
                if (held.meta.stopPrice == null || held.meta.stopPrice < newStop) {
                  held.meta.stopPrice = newStop;
                }
                held.meta.breakEvenLocked = true;
                try { await savePosition(DB, market, symbol, stratName, held); } catch (e) {}
                await log(DB, "INFO", symbol, "BREAK-EVEN locked [" + stratName + "] at +" + curPnl.toFixed(2) + "% stop=" + newStop.toFixed(2));
              }
            }

            // 매도 판단
            const sellDecision = evaluateSell(held, price, daily, dailyRsi, dailyMa, dailyMaShort, mcfg, canTrade, market);
            if (sellDecision.minHoldLock) {
              const heldHours = held.opened_ts ? (Date.now() - held.opened_ts) / 3600000 : 0;
              const pnlRate = ((price - held.avg) / held.avg) * 100;
              await log(DB, "INFO", symbol, "MIN-HOLD lock [" + stratName + "] (" + heldHours.toFixed(1) + "h, PnL " + pnlRate.toFixed(2) + "%)");
              continue;
            }
            if (sellDecision.sell) {
              await executeSell(DB, market, symbol, held, sellDecision.sellQty, price, sellDecision.reason, mcfg, cash);
              sold++;
              // 전량 매도 시 카운트 갱신 — 같은 종목 다른 전략 남아 있는지 확인
              const stillHeld = Object.keys(positions).some(function(k){
                return positions[k].symbol === symbol && k !== posKey;
              });
              if (!stillHeld && sellDecision.sellQty >= held.qty) {
                heldSymbols.delete(symbol);
                const sec = SECTOR_MAP[symbol];
                if (sec && sectorCounts[sec]) sectorCounts[sec]--;
              }
            }
          }

          // === [V8] STEP 2: 모든 활성 전략에서 매수 신호 평가 ===
          if (!intraOk) {
            incNobuy("intra_fail");
            continue;
          }
          const strategiesHeldNow = getStrategiesHeldForSymbol(positions, symbol);
          const stratResults = evaluateAllStrategies(price, dayPct, daily, mcfg, signalStats, regime, market, intra);

          if (stratResults.length === 0) {
            incNobuy("no_signal");
            // [V8.1.2] 진단: 처음 5개 종목의 상태를 샘플로 수집
            if (stateSamples.length < 5) {
              const trendStr = (dailyMaShort != null && dailyMa != null)
                ? (dailyMaShort > dailyMa ? "up" : "dn") : "?";
              stateSamples.push(symbol + "(RSI" + dailyRsi.toFixed(0) + " d" + dayPct.toFixed(1) + "% " + trendStr + ")");
            }
            continue;
          }

          // Cross-strategy confluence: 2개 이상 전략이 동시 신호면 보너스
          const crossBonus = (stratResults.length >= 2) ? (mcfg.crossConfluenceBonus || 1.0) : 1.0;
          if (stratResults.length >= 2) {
            const stratNames = stratResults.map(function(r){ return r.strategy; }).join("+");
            await log(DB, "INFO", symbol, "CROSS-CONF (" + stratNames + ") x" + crossBonus);
          }

          // [V8.1.5] 한 종목에 여러 전략 동시 진입 시 합산 cap (35%)
          // 각 전략 신호별로 진입 시도 (V8.1.6 이후엔 보통 1개만)
          for (const sr of stratResults) {
            const strategy = sr.strategy;
            const signal = sr.signal;

            // 같은 (종목, 전략) 보유중이면 스킵
            if (strategiesHeldNow.has(strategy)) {
              continue;
            }

            const ctx = {
              symbol: symbol,
              strategy: strategy,
              heldSymbols: heldSymbols,
              sectorCounts: sectorCounts,
              strategiesHeld: strategiesHeldNow
            };
            const blockReason = evaluateBuyBlocks(price, dayPct, daily, mcfg, regime, signal, ctx);
            if (blockReason) {
              incBlock(blockReason.split(" ")[0] + "[" + strategy + "]");
              continue;
            }

            // [V8.6.1 철회] KR 약신호 진입 차단은 과거데이터 검증 결과 수익거래(+9.4만)까지 버려 역효과.
            //   이 시스템은 승률(41%)이 아닌 손익비(3.3:1)로 수익을 내는 구조 → 진입을 막으면 큰 승자도 잃음.
            //   진짜 처방은 "진입 차단"이 아니라 "지는 거래의 손실 크기 축소" = softTimeStop(청산로직).

            // [V8.6 Hybrid] LLM 일일 지시 적용 — 매수 차단 필터
            if (llmInstr) {
              // 1) 매수 신호 전체 OFF
              if (!llmInstr.buy_signals.enabled) {
                incBlock("LLM_BUY_OFF[" + strategy + "]");
                continue;
              }
              // 2) 진입 금지 종목
              if (llmInstr.avoid_symbols.indexOf(symbol) >= 0) {
                incBlock("LLM_AVOID_SYM[" + strategy + "]");
                continue;
              }
              // 3) 비활성화된 신호 — 신호명 또는 cross 멤버 어느 하나라도 매치되면 차단
              const sigMembers = (signal.members && signal.members.length > 0) ? signal.members : [signal.name];
              const blockedByLLM = sigMembers.some(function(m) { return llmInstr.disable_signals.indexOf(m) >= 0; });
              if (blockedByLLM) {
                incBlock("LLM_DISABLE_SIG[" + strategy + "]");
                continue;
              }
            }

            let baseRatio = getPositionSizeRatio(mcfg, strategy, regime.regime);

            // [V9.2 데이터근거] day 전략 신호강도 차등 사이징.
            //   과거 247건: 신호 2개 조합=승률 61%/+1.14%(우수), 단독=37%, 3개+=손실(→2개로 정제됨).
            //   단독도 종류별로 갈림: BOUNCE 단독 +25만(흑자), OPEN_DRIVE +0.7만, GAP_DOWN 단독 -15.8만(손실원).
            //   진입은 막지 않되(조합 동반손실 함정 회피) 손실 단독만 사이즈 축소.
            if (strategy === "day") {
              const mem = (signal.members && signal.members.length) ? signal.members : [signal.name];
              const nSig = mem.length;
              let dayConfMult;
              if (nSig >= 2) {
                dayConfMult = 1.5;                      // 최우수 조합 — 사이즈 키움
              } else {
                // 단독: 신호 종류로 차등
                const solo = mem[0] || "";
                if (solo.indexOf("GAP_DOWN") >= 0) dayConfMult = 0.4;   // 단독 손실원 — 대폭 축소
                else if (solo.indexOf("BOUNCE") >= 0 || solo.indexOf("OPEN_DRIVE") >= 0) dayConfMult = 0.9; // 흑자 단독 — 거의 유지
                else dayConfMult = 0.6;                 // 기타 단독 — 보수적
              }
              baseRatio = baseRatio * dayConfMult;
            }

            // [V8.3] ATR 기반 동적 사이징 multiplier
            // 변동성 큰 종목(ATR/price 비율 높음) → 작게, 안정 종목 → 크게
            let atrMult = 1.0;
            let actualAtrPct = null;
            if (mcfg.atrSizing && mcfg.atrSizing.enabled && dailyAtr != null && price > 0) {
              actualAtrPct = (dailyAtr / price) * 100;
              const target = mcfg.atrSizing.targetAtrPct || 2.0;
              const minMult = mcfg.atrSizing.minMult != null ? mcfg.atrSizing.minMult : 0.5;
              const maxMult = mcfg.atrSizing.maxMult != null ? mcfg.atrSizing.maxMult : 1.5;
              if (actualAtrPct > 0) {
                atrMult = target / actualAtrPct;
                if (atrMult < minMult) atrMult = minMult;
                if (atrMult > maxMult) atrMult = maxMult;
              }
            }

            // [V8.5] 사이징 변경: 리스크 기반 vs 레거시 비율식
            // 리스크 기반은 cash × riskPerTrade / stopDistancePct
            //   → 한 거래 손실 한도 = cash × riskPerTrade%
            //   stopDistance = max(rules.stopLossPct, 1.5×ATR%) — MEANREV 등 ATR 동적 손절 반영
            // [V9.4] 전략별 캡 우선 — 없으면 시장별 기본(day 등) 폴백.
            const byStrat = mcfg.sizingTargetsByStrategy && mcfg.sizingTargetsByStrategy[strategy];
            const targets = (byStrat && byStrat[market])
              || (mcfg.sizingTargets && mcfg.sizingTargets[market])
              || { minBudget: 0, maxBudget: Infinity };
            const cashCap = cash[market] * 0.85;
            let budget;
            const rbs = mcfg.riskBasedSizing || {};
            const useRiskSizing = rbs.enabled !== false;

            if (useRiskSizing) {
              // 손절 거리 계산 — 전략별 stopLoss와 ATR 동적 손절 중 큰 쪽
              const stratRules = getStrategyRules(mcfg, strategy);
              const baseStopPct = stratRules.stopLossPct || mcfg.stopLoss || 5.0;
              let stopDistPct = baseStopPct;
              if (actualAtrPct != null && actualAtrPct > 0) {
                const atrStopPct = actualAtrPct * (stratRules.atrStopMult || mcfg.atrStopMult || 2.0);
                stopDistPct = Math.max(baseStopPct, Math.min(atrStopPct, baseStopPct * 1.6));
              }
              // 신호 강도를 riskPerTrade에 반영 (cap·floor 적용)
              const sigStrength = signal.weight * crossBonus;
              // [V9.6] 전략별 오버라이드 우선 — 없으면 공통값.
              const rbsOv = (rbs.byStrategy && rbs.byStrategy[strategy]) || {};
              const riskBase = rbsOv.riskPerTrade != null ? rbsOv.riskPerTrade
                             : (rbs.riskPerTrade != null ? rbs.riskPerTrade : 0.6);
              const minR = rbsOv.minRisk != null ? rbsOv.minRisk
                         : (rbs.minRisk != null ? rbs.minRisk : 0.3);
              const maxR = rbsOv.maxRisk != null ? rbsOv.maxRisk
                         : (rbs.maxRisk != null ? rbs.maxRisk : 1.2);
              let riskPct = riskBase * sigStrength;
              if (riskPct < minR) riskPct = minR;
              if (riskPct > maxR) riskPct = maxR;
              // budget 계산 — riskPct%로 stopDistPct% 거리 손실 시 정확히 cash×riskPct% 손실
              const rawBudget = cash[market] * (riskPct / 100) / (stopDistPct / 100);
              budget = Math.min(rawBudget, targets.maxBudget, cashCap);
              // minBudget 보장 (기존 로직 유지)
              if (budget < targets.minBudget && cash[market] >= targets.minBudget * 1.1) {
                budget = Math.min(targets.minBudget, cashCap);
              }
            } else {
              // [Legacy] 비율식 — 호환성용 폴백
              const adjustedRatio = baseRatio * signal.weight * crossBonus * atrMult;
              const rawBudget = cash[market] * adjustedRatio;
              budget = Math.min(rawBudget, targets.maxBudget, cashCap);
              if (budget < targets.minBudget && cash[market] >= targets.minBudget * 1.1) {
                budget = Math.min(targets.minBudget, cashCap);
              }
            }

            // [V8.6 Hybrid] LLM 사이징 스케일 적용 — cashCap 한도 내에서
            if (llmInstr && llmInstr.position_sizing && typeof llmInstr.position_sizing.scale === "number") {
              budget = Math.min(budget * llmInstr.position_sizing.scale, cashCap);
            }

            let qty = Math.floor(budget / (price * (1 + feeRate)));

            // [V8.1.9] floor 손실 보정: budget 대비 +1주 더 살 여유가 있고
            //          maxBudget 초과 안 하면 1주 추가 (한국 고가주 1주 차이 큼)
            if (qty >= 1) {
              const nextCost = (qty + 1) * price * (1 + feeRate);
              if (nextCost <= Math.min(budget * 1.25, targets.maxBudget, cash[market])) {
                qty += 1;
              }
            }

            // [V8.1.5] 1주도 못 사는 경우: 잔액 10% 이내면 1주 매수 허용
            if (qty === 0) {
              const onePrice = price * (1 + feeRate);
              if (onePrice <= cash[market] * 0.10) {
                qty = 1;
              }
            }

            const totalCost = qty * price * (1 + feeRate);
            if (qty > 0 && totalCost <= cash[market]) {
              // [V8.6 Hybrid] LLM stop_loss_adjustment 적용 (지시 있으면)
              const buyOpts = (llmInstr && llmInstr.stop_loss_adjustment && typeof llmInstr.stop_loss_adjustment.new_pct === "number")
                ? { stopPctOverride: llmInstr.stop_loss_adjustment.new_pct } : null;
              await executeBuy(DB, market, symbol, strategy, qty, price, signal, dailyAtr, mcfg, cash, buyOpts);
              bought++;
              heldSymbols.add(symbol);
              strategiesHeldNow.add(strategy);
              const sec = SECTOR_MAP[symbol];
              if (sec) sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
            } else {
              if (qty === 0) {
                incNobuy("price_too_high[" + strategy + "]");
              } else {
                incNobuy("cash_short[" + strategy + "]");
              }
            }
          }
        } catch (e) {
          await log(DB, "ERROR", symbol, e.message);
        }
      }

      // [V8.1.2] 시장당 NOBUY / BLOCK / 샘플 요약
      const nbKeys = Object.keys(nobuyCounts);
      if (nbKeys.length > 0) {
        const summary = nbKeys.sort(function(a,b){ return nobuyCounts[b]-nobuyCounts[a]; })
          .map(function(k){ return k + ":" + nobuyCounts[k]; }).join(", ");
        await log(DB, "INFO", null, "NOBUY[" + market + "] " + summary);
      }
      const blKeys = Object.keys(blockCounts);
      if (blKeys.length > 0) {
        const summary = blKeys.sort(function(a,b){ return blockCounts[b]-blockCounts[a]; })
          .map(function(k){ return k + ":" + blockCounts[k]; }).join(", ");
        await log(DB, "INFO", null, "BLOCK[" + market + "] " + summary);
      }
      if (stateSamples.length > 0) {
        await log(DB, "INFO", null, "STATE[" + market + "] " + stateSamples.join(" | "));
      }

      // [V8.5] 시장 처리 완료 — 다음 시장 처리 전 락 TTL 갱신 (stale 진입 방지)
      await refreshCycleLock(DB, cfg.cycleLockTTL || 60000);
    }

    try { await setState(DB, "cash", cash); } catch (e) {}
    try { await setState(DB, "last_tick", Date.now()); } catch (e) {}
    const cycleMs = Date.now() - cycleStartedAt;
    await log(DB, "INFO", null, "Done: tried=" + tried + " skip=" + skipped + " buy=" + bought + " sell=" + sold + " fetchFail=" + fetchFail + " cycleMs=" + cycleMs);
    try { await DB.prepare("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)").run(); } catch (e) {}
  } finally {
    await releaseCycleLock(DB);
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    // === [개선] /api/state 통합 응답 ===
    if (path === "/api/state") {
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const cash = await getState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });
      const deposits = await getState(env.DB, "deposits", { us: 0, kr: 0 });
      const positionsUSRaw = await getPositions(env.DB, "us");
      const positionsKRRaw = await getPositions(env.DB, "kr");

      // [V8] 포지션 응답 가공:
      // - list: 각 (symbol, strategy) 포지션을 row로 (프론트 테이블용)
      // - bySymbol: 종목 단위로 묶음 (집계용)
      function buildPositionViews(rawMap) {
        const list = [];
        const bySymbol = {};
        for (const key in rawMap) {
          const p = rawMap[key];
          const row = {
            symbol: p.symbol,
            strategy: p.strategy,
            qty: p.qty,
            avg: p.avg,
            opened_ts: p.opened_ts,
            meta: p.meta || {},
            entrySignal: (p.meta && p.meta.signal) || null,
            stopPrice: (p.meta && p.meta.stopPrice) || null,
            peakPrice: (p.meta && p.meta.peakPrice) || null
          };
          list.push(row);
          if (!bySymbol[p.symbol]) bySymbol[p.symbol] = { symbol: p.symbol, totalQty: 0, strategies: [] };
          bySymbol[p.symbol].totalQty += p.qty;
          bySymbol[p.symbol].strategies.push(row);
        }
        return { list: list, bySymbol: bySymbol };
      }
      const posUS = buildPositionViews(positionsUSRaw);
      const posKR = buildPositionViews(positionsKRRaw);

      const lastTick = await getState(env.DB, "last_tick", null);

      const allSymbols = cfg.usTickers.concat(cfg.krTickers);
      const quotes = [];
      for (const sym of allSymbols) {
        const q = await getState(env.DB, "quote:" + sym, null);
        if (q) quotes.push(Object.assign({ symbol: sym }, q));
      }
      const indices = [];
      for (const sym of US_INDICES.concat(KR_INDICES)) {
        const idx = await getState(env.DB, "index:" + sym, null);
        if (idx) indices.push(Object.assign({ symbol: sym }, idx));
      }
      const signalStats = await getState(env.DB, "signal_stats", {});

      return Response.json({
        cash: cash,
        deposits: deposits,
        positions: {
          us: posUS.list,          // [V8] array of (symbol, strategy) rows
          kr: posKR.list,
          usBySymbol: posUS.bySymbol,
          krBySymbol: posKR.bySymbol
        },
        lastTick: lastTick, cfg: cfg,
        marketStatus: { us: isMarketOpen("us"), kr: isMarketOpen("kr") },
        tradingWindow: { us: isTradingWindow("us"), kr: isTradingWindow("kr") },
        llmDaily: {
          us: await getState(env.DB, "llm_daily:us", null),
          kr: await getState(env.DB, "llm_daily:kr", null)
        },
        watchlist: quotes,
        indices: indices,
        signalStats: signalStats,
        strategies: STRATEGIES   // [V8]
      }, { headers: cors });
    }

    // 하위 호환 엔드포인트 유지
    if (path === "/api/watchlist") {
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const allSymbols = cfg.usTickers.concat(cfg.krTickers);
      const quotes = [];
      for (const sym of allSymbols) {
        const q = await getState(env.DB, "quote:" + sym, null);
        if (q) quotes.push(Object.assign({ symbol: sym }, q));
      }
      return Response.json(quotes, { headers: cors });
    }
    if (path === "/api/indices") {
      const indices = [];
      for (const sym of US_INDICES.concat(KR_INDICES)) {
        const idx = await getState(env.DB, "index:" + sym, null);
        if (idx) indices.push(Object.assign({ symbol: sym }, idx));
      }
      return Response.json(indices, { headers: cors });
    }
    if (path === "/api/trades") {
      const limit = parseInt(url.searchParams.get("limit") || "100", 10);
      const res = await env.DB.prepare("SELECT * FROM trades ORDER BY ts DESC LIMIT ?").bind(limit).all();
      return Response.json(res.results, { headers: cors });
    }
    if (path === "/api/logs") {
      const limit = parseInt(url.searchParams.get("limit") || "200", 10);
      const res = await env.DB.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT ?").bind(limit).all();
      return Response.json(res.results, { headers: cors });
    }
    if (path === "/api/cfg" && request.method === "GET") {
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      return Response.json(cfg, { headers: cors });
    }
    if (path === "/api/cfg" && request.method === "POST") {
      const body = await request.json();
      const current = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const next = Object.assign({}, current, body);
      // [V8.2] 사용자가 SETTINGS에서 시장별 학습 대상 키를 변경하면
      // cfg.markets.us / cfg.markets.kr에도 같은 값으로 강제 sync.
      // (안 그러면 markets 안의 학습값이 우선되어 사용자 변경이 무시됨)
      if (!next.markets) next.markets = { us: {}, kr: {} };
      for (const market of ['us', 'kr']) {
        if (!next.markets[market]) next.markets[market] = {};
        for (const k of MARKET_SCOPED_KEYS) {
          if (body[k] !== undefined) {
            next.markets[market][k] = (typeof body[k] === 'object' && body[k] !== null)
              ? JSON.parse(JSON.stringify(body[k]))
              : body[k];
          }
        }
      }
      await setState(env.DB, "cfg", next);
      await log(env.DB, "INFO", null, "cfg updated manually");
      return Response.json({ ok: true, cfg: next }, { headers: cors });
    }
    if (path === "/api/favorites" && request.method === "POST") {
      const body = await request.json();
      const current = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      if (body.usFavorites !== undefined) current.usFavorites = body.usFavorites;
      if (body.krFavorites !== undefined) current.krFavorites = body.krFavorites;
      await setState(env.DB, "cfg", current);
      return Response.json({ ok: true, usFavorites: current.usFavorites, krFavorites: current.krFavorites }, { headers: cors });
    }
    if (path === "/api/reset" && request.method === "POST") {
      await ensureSchema(env.DB);
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      await env.DB.prepare("DELETE FROM trades").run();
      await env.DB.prepare("DELETE FROM positions").run();
      await env.DB.prepare("DELETE FROM logs").run();
      await env.DB.prepare("DELETE FROM state WHERE k NOT LIKE 'quote:%' AND k NOT LIKE 'index:%' AND k NOT LIKE 'daily:%'").run();
      await setState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR, cm: cfg.initialCashCM });
      await setState(env.DB, "deposits", { us: 0, kr: 0 });
      await log(env.DB, "INFO", null, "RESET");
      return Response.json({ ok: true, cash: { us: cfg.initialCashUS, kr: cfg.initialCashKR, cm: cfg.initialCashCM } }, { headers: cors });
    }
    if (path === "/api/reset_tickers" && request.method === "POST") {
      const current = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      current.usTickers = DEFAULT_US;
      current.krTickers = DEFAULT_KR;
      await setState(env.DB, "cfg", current);
      return Response.json({ ok: true, usTickers: DEFAULT_US, krTickers: DEFAULT_KR }, { headers: cors });
    }
    if (path === "/api/cash/add" && request.method === "POST") {
      // 기존 cash에 금액 추가/차감 (포지션, 거래 기록 보존)
      // body: { us?: number, kr?: number }  — 양수=입금, 음수=출금
      // [V8.2.2] deposits도 누적 기록 → 수익률 계산 시 입금분 차감용
      const body = await request.json();
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const cash = await getState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });
      const deposits = await getState(env.DB, "deposits", { us: 0, kr: 0 });
      const addUs = Number(body.us) || 0;
      const addKr = Number(body.kr) || 0;
      if (addUs === 0 && addKr === 0) {
        return Response.json({ ok: false, error: "no amount" }, { status: 400, headers: cors });
      }
      const before = { us: cash.us, kr: cash.kr };
      cash.us = +(cash.us + addUs).toFixed(2);
      cash.kr = Math.round(cash.kr + addKr);
      // 출금 시 음수 방지
      if (cash.us < 0 || cash.kr < 0) {
        return Response.json({ ok: false, error: "insufficient cash", before: before, attempted: { us: addUs, kr: addKr } }, { status: 400, headers: cors });
      }
      deposits.us = +((deposits.us || 0) + addUs).toFixed(2);
      deposits.kr = Math.round((deposits.kr || 0) + addKr);
      await setState(env.DB, "cash", cash);
      await setState(env.DB, "deposits", deposits);
      const msg = "CASH ADD US:" + (addUs >= 0 ? "+" : "") + addUs + " KR:" + (addKr >= 0 ? "+" : "") + addKr +
                  " (US " + before.us + "->" + cash.us + ", KR " + before.kr + "->" + cash.kr + ")";
      await log(env.DB, "INFO", null, msg);
      return Response.json({ ok: true, cash: cash, deposits: deposits, before: before, added: { us: addUs, kr: addKr } }, { headers: cors });
    }
    if (path === "/api/deposits/set" && request.method === "POST") {
      // [V8.2.3] deposits 값을 직접 덮어씀 (과거 수동 입금 보정용)
      // body: { us?: number, kr?: number } — 절대값, cash는 안 건드림
      const body = await request.json();
      const cur = await getState(env.DB, "deposits", { us: 0, kr: 0 });
      const next = {
        us: body.us !== undefined ? +Number(body.us).toFixed(2) : (cur.us || 0),
        kr: body.kr !== undefined ? Math.round(Number(body.kr)) : (cur.kr || 0)
      };
      await setState(env.DB, "deposits", next);
      await log(env.DB, "INFO", null, "DEPOSITS SET US:" + (cur.us || 0) + "->" + next.us + " KR:" + (cur.kr || 0) + "->" + next.kr);
      return Response.json({ ok: true, deposits: next, before: cur }, { headers: cors });
    }
    if (path === "/api/tick" && request.method === "POST") {
      await runTradingCycle(env);
      return Response.json({ ok: true, ts: Date.now() }, { headers: cors });
    }
    if (path === "/api/refresh_quotes" && request.method === "POST") {
      const market = url.searchParams.get("market") || "us";
      if (market !== "us" && market !== "kr") return Response.json({ error: "invalid market" }, { status: 400, headers: cors });
      const result = await refreshQuotesOnly(env, market);
      return Response.json({ ok: true, market: market, ok_count: result.ok, fail_count: result.fail }, { headers: cors });
    }
    if (path === "/api/migrate" && request.method === "POST") {
      await ensureSchema(env.DB);
      return Response.json({ ok: true, message: "schema ensured" }, { headers: cors });
    }

    // === [COMMODITY] 원자재 상태 조회 ===
    if (path === "/api/commodities") {
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const cash = await getState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR, cm: cfg.initialCashCM });
      const cmCash = (typeof cash.cm === "number") ? cash.cm : cfg.initialCashCM;
      const rawPos = await getPositions(env.DB, "cm");
      const positions = [];
      for (const key in rawPos) {
        const p = rawPos[key];
        positions.push({
          symbol: p.symbol, name: (COMMODITY_META[p.symbol] && COMMODITY_META[p.symbol].name) || p.symbol,
          strategy: p.strategy, qty: p.qty, avg: p.avg, opened_ts: p.opened_ts,
          meta: p.meta || {},
          entrySignal: (p.meta && p.meta.signal) || null,
          stopPrice: (p.meta && p.meta.stopPrice) || null,
          peakPrice: (p.meta && p.meta.peakPrice) || null
        });
      }
      const quotes = [];
      for (const c of COMMODITIES) {
        const q = await getState(env.DB, "quote:" + c.symbol, null);
        if (q) quotes.push(Object.assign({ symbol: c.symbol, name: c.name, unit: c.unit }, q));
        else quotes.push({ symbol: c.symbol, name: c.name, unit: c.unit });
      }
      return Response.json({
        cash: cmCash,
        initialCash: cfg.initialCashCM,
        positions: positions,
        watchlist: quotes,
        symbols: COMMODITIES,
        tradeTime: "16:00 KST",
        isTradeTimeNow: isCommodityTriggerTime()
      }, { headers: cors });
    }

    // === [COMMODITY] 원자재 사이클 수동 실행 ===
    //   ?force=1 이면 16:00 KST가 아니어도 매매까지 강제 실행 (테스트용).
    //   force 없으면 시세만 갱신(트리거 시각이 아니므로 매매 스킵).
    if (path === "/api/commodities/run" && request.method === "POST") {
      const force = url.searchParams.get("force") === "1";
      await runCommodityCycle(env, force);
      return Response.json({ ok: true, forced: force, ts: Date.now() }, { headers: cors });
    }

    // [신규] 신호별 성과 조회
    if (path === "/api/signal_stats") {
      const stats = await getState(env.DB, "signal_stats", {});
      return Response.json(stats, { headers: cors });
    }
    // [V8.6 Hybrid] LLM 일일 지시 조회 — ?market=us|kr (없으면 둘 다)
    if (path === "/api/llm/instruction") {
      const m = url.searchParams.get("market");
      if (m === "us" || m === "kr") {
        const stored = await getState(env.DB, "llm_daily:" + m, null);
        return Response.json(stored || { empty: true }, { headers: cors });
      }
      const us = await getState(env.DB, "llm_daily:us", null);
      const kr = await getState(env.DB, "llm_daily:kr", null);
      return Response.json({ us: us, kr: kr }, { headers: cors });
    }
    // [V8.6 Hybrid] LLM 수동 트리거 — POST { market: "us" | "kr" }
    if (path === "/api/llm/run" && request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const m = body.market;
      const force = body.force === true;  // forceRun 파라미터 읽기
      if (m !== "us" && m !== "kr") {
        return Response.json({ error: "market must be 'us' or 'kr'" }, { status: 400, headers: cors });
      }
      const result = await runLLMDailyAnalysis(env, m, force);
      return Response.json(result, { headers: cors });
    }
    // [V8.6 Hybrid] LLM 지시 강제 삭제 — 잘못된 지시 적용 막을 때
    if (path === "/api/llm/clear" && request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const m = body.market;
      if (m === "us" || m === "kr") {
        await env.DB.prepare("DELETE FROM state WHERE k = ?").bind("llm_daily:" + m).run();
        await log(env.DB, "INFO", null, "[LLM] cleared instruction: " + m);
        return Response.json({ ok: true, cleared: m }, { headers: cors });
      }
      await env.DB.prepare("DELETE FROM state WHERE k LIKE 'llm_daily:%'").run();
      await log(env.DB, "INFO", null, "[LLM] cleared all instructions");
      return Response.json({ ok: true, cleared: "all" }, { headers: cors });
    }
    // [신규] 락 강제 해제 — stuck 됐을 때 복구용
    if (path === "/api/unlock" && request.method === "POST") {
      await releaseCycleLock(env.DB);
      await log(env.DB, "INFO", null, "cycle lock force-released via /api/unlock");
      return Response.json({ ok: true }, { headers: cors });
    }
    // [V8.9] 백테스트 — GET 또는 POST
    //   파라미터: market(us/kr), range(1y/2y/5y), maxSymbols, slippagePct, symbols(쉼표구분)
    //   예: /api/backtest?market=us&range=2y&maxSymbols=10
    if (path === "/api/backtest") {
      let opts = {};
      if (request.method === "POST") {
        try { opts = await request.json(); } catch (e) {}
      } else {
        const p = url.searchParams;
        if (p.get("market")) opts.market = p.get("market");
        if (p.get("range")) opts.range = p.get("range");
        if (p.get("maxSymbols")) opts.maxSymbols = parseInt(p.get("maxSymbols"), 10);
        if (p.get("slippagePct")) opts.slippagePct = parseFloat(p.get("slippagePct"));
        if (p.get("symbols")) opts.symbols = p.get("symbols").split(",").map(function(s){ return s.trim(); }).filter(Boolean);
      }
      if (opts.market !== "us" && opts.market !== "kr") opts.market = "us";
      // 안전 가드: 심볼 과다 방지 (Workers 시간/CPU 한도)
      if (!opts.maxSymbols || opts.maxSymbols > 20) opts.maxSymbols = 15;
      const result = await runBacktest(env, opts);
      return Response.json(result, { headers: cors });
    }
    // [신규] 진단 — 락 상태, 마지막 tick, 시세 수, 시장 오픈 여부
    // [신규] 거래 기록 다운로드 (CSV)
    if (path === "/api/download/trades") {
      const res = await env.DB.prepare("SELECT * FROM trades ORDER BY ts DESC").all();
      const trades = res.results || [];
      
      let csv = "타임스탠프,종목,전략,수량,평단가,거래종류,이유,손절가,목표가,신호,거래금액,현재가,손익,손익률,발생일시\n";
      trades.forEach(trade => {
        const ts = new Date(trade.ts).toLocaleString('ko-KR');
        const tradeType = trade.qty > 0 ? "매수" : "매도";
        const reason = trade.reason || trade.signal || "자동";
        const amount = Math.abs(trade.qty * trade.price);
        const pnl = trade.pnl || "";
        const pnlPct = trade.pnl_pct ? (trade.pnl_pct * 100).toFixed(2) + "%" : "";
        const stop = trade.stop_price || "";
        const tp = trade.target_price || "";
        const signal = trade.signal || "";
        const currentPrice = trade.price || "";
        
        csv += `"${ts}","${trade.symbol}","${trade.strategy}",${trade.qty},${trade.price},"${tradeType}","${reason}",${stop},${tp},"${signal}",${amount},${currentPrice},${pnl},${pnlPct},${new Date(trade.ts).toISOString()}\n`;
      });
      
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="trades_${new Date().toISOString().split('T')[0]}.csv"`,
          ...cors
        }
      });
    }
    
    // [신규] 거래 이유 로그 다운로드 (CSV)
    if (path === "/api/download/logs") {
      const res = await env.DB.prepare("SELECT * FROM logs ORDER BY id DESC").all();
      const logs = res.results || [];
      
      let csv = "발생시간,레벨,종목,메시지,세부내용\n";
      logs.forEach(log => {
        const ts = new Date(log.ts).toLocaleString('ko-KR');
        const level = log.level || "INFO";
        const symbol = log.symbol || "";
        const msg = (log.msg || "").replace(/"/g, '""');  // CSV 이스케이프
        const detail = (log.detail || "").replace(/"/g, '""');
        
        csv += `"${ts}","${level}","${symbol}","${msg}","${detail}"\n`;
      });
      
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="logs_${new Date().toISOString().split('T')[0]}.csv"`,
          ...cors
        }
      });
    }
    
    // [신규] 통합 다운로드 (거래 + 로그 + 요약)
    if (path === "/api/download/report") {
      const tradesRes = await env.DB.prepare("SELECT * FROM trades ORDER BY ts DESC").all();
      const logsRes = await env.DB.prepare("SELECT * FROM logs ORDER BY id DESC").all();
      const trades = tradesRes.results || [];
      const logs = logsRes.results || [];
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const cash = await getState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });
      const deposits = await getState(env.DB, "deposits", { us: 0, kr: 0 });
      
      // 수익률 계산
      let totalPnL = 0, totalTrades = 0, winTrades = 0;
      trades.forEach(t => {
        if (t.pnl) { totalPnL += t.pnl; totalTrades++; }
        if (t.pnl && t.pnl > 0) winTrades++;
      });
      const winRate = totalTrades > 0 ? ((winTrades / totalTrades) * 100).toFixed(2) : 0;
      
      // 리포트 생성
      let report = "=== LUX-ENGINE 거래 분석 리포트 ===\n\n";
      report += `생성일: ${new Date().toLocaleString('ko-KR')}\n\n`;
      report += `[자산 현황]\n`;
      report += `US 현금: $${cash.us.toLocaleString('en-US', {minimumFractionDigits: 2})}\n`;
      report += `KR 현금: ₩${cash.kr.toLocaleString()}\n`;
      report += `US 입금액: $${deposits.us.toLocaleString('en-US', {minimumFractionDigits: 2})}\n`;
      report += `KR 입금액: ₩${deposits.kr.toLocaleString()}\n\n`;
      report += `[성과]\n`;
      report += `총 거래건: ${totalTrades}\n`;
      report += `총 수익/손실: $${(totalPnL / (deposits.us || 1)).toFixed(2)} (${(totalPnL >= 0 ? '+' : '')}${totalPnL.toFixed(2)})\n`;
      report += `승률: ${winRate}%\n`;
      report += `우승 거래: ${winTrades}건\n\n`;
      
      report += "=== 거래 목록 ===\n";
      report += "타임스탠프,종목,전략,수량,평단가,거래종류,이유,손절가,목표가,신호,거래금액,손익,손익률\n";
      
      trades.forEach(trade => {
        const ts = new Date(trade.ts).toLocaleString('ko-KR');
        const tradeType = trade.qty > 0 ? "매수" : "매도";
        const reason = trade.reason || trade.signal || "자동";
        const amount = Math.abs(trade.qty * trade.price);
        const pnl = trade.pnl || "";
        const pnlPct = trade.pnl_pct ? (trade.pnl_pct * 100).toFixed(2) + "%" : "";
        const stop = trade.stop_price || "";
        const tp = trade.target_price || "";
        
        report += `"${ts}","${trade.symbol}","${trade.strategy}",${trade.qty},${trade.price},"${tradeType}","${reason}",${stop},${tp},"${trade.signal || ''}",${amount},${pnl},${pnlPct}\n`;
      });
      
      report += "\n=== 거래 로그 ===\n";
      report += "발생시간,레벨,종목,메시지\n";
      
      logs.slice(0, 100).forEach(log => {
        const ts = new Date(log.ts).toLocaleString('ko-KR');
        const level = log.level || "INFO";
        const symbol = log.symbol || "-";
        const msg = (log.msg || "").replace(/\n/g, ' | ');
        
        report += `"${ts}","${level}","${symbol}","${msg}"\n`;
      });
      
      return new Response(report, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="lux_report_${new Date().toISOString().split('T')[0]}.txt"`,
          ...cors
        }
      });
    }
    
    // [V9 매크로] 경제지표 조회 — 저장된 최신 수치 반환
    if (path === "/api/macro" && request.method === "GET") {
      const data = await getState(env.DB, "macro_data", null);
      return Response.json(data || { us: {}, kr: {}, updatedAt: null, empty: true }, { headers: cors });
    }
    // [V9 매크로] 경제지표 수동 갱신 트리거 (테스트/즉시갱신용)
    if (path === "/api/macro/run" && request.method === "POST") {
      const result = await runMacroUpdate(env, true);
      return Response.json(result, { headers: cors });
    }

    if (path === "/api/diag") {
      const lock = await getState(env.DB, "lock:cycle", null);
      const lastTick = await getState(env.DB, "last_tick", null);
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const allSymbols = cfg.usTickers.concat(cfg.krTickers);
      let quoteCount = 0, freshCount = 0;
      const now = Date.now();
      const staleSyms = [];
      for (const sym of allSymbols) {
        const q = await getState(env.DB, "quote:" + sym, null);
        if (q) {
          quoteCount++;
          if (q.ts && (now - q.ts) < 5 * 60 * 1000) freshCount++;
          else staleSyms.push({ sym: sym, ageMin: q.ts ? Math.round((now - q.ts) / 60000) : null });
        } else {
          staleSyms.push({ sym: sym, ageMin: null });
        }
      }
      return Response.json({
        now: now,
        lock: lock,
        lockAgeSec: lock && lock.until ? Math.round((lock.until - now) / 1000) : null,
        lastTick: lastTick,
        lastTickAgeMin: lastTick ? Math.round((now - lastTick) / 60000) : null,
        market: { us: isMarketOpen("us"), kr: isMarketOpen("kr") },
        tradingWindow: { us: isTradingWindow("us"), kr: isTradingWindow("kr") },
        usEtOffset: getUSEtOffset(new Date()),  // -4=EDT(서머타임) / -5=EST(겨울)
        quotes: { total: allSymbols.length, stored: quoteCount, freshUnder5min: freshCount },
        staleOrMissing: staleSyms.slice(0, 20),
        cfg: { enabled: cfg.enabled, marketHoursOnly: cfg.marketHoursOnly, cycleLockTTL: cfg.cycleLockTTL }
      }, { headers: cors });
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not Found", { status: 404, headers: cors });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: cors });
  }
}

export default {
  async fetch(request, env, ctx) { return handleRequest(request, env); },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTradingCycle(env));
    // [COMMODITY] 16:00 KST 정각에만 원자재 사이클 실행 (cron 매분 호출되지만 트리거 시각에만 동작).
    //   이렇게 cron에서 직접 분기해야 주식 양시장 마감(16:00 KST엔 둘 다 닫힘) 시
    //   runTradingCycle이 조기 return 해도 원자재는 정상 실행됨.
    if (isCommodityTriggerTime()) {
      ctx.waitUntil(runCommodityCycle(env));
    }
  }
};
