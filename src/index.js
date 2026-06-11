// ============================================================
// LUX-engine V9.0 Hybrid (V8.5 규칙 매매 + Claude 일일 지시)
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
// V9.0 변경점:
//   • [BUG FIX] MRSH → MMC (Marsh McLennan 티커 오류 수정)
//   • [신규 ETF] SPXU(-3x S&P500인버스)·SH(-1x S&P500인버스) 거래 유니버스 추가 (패닉 헤지 강화)
//   • [수익률 개선] 52주 신고가 돌파 확인 시 TR_BREAKOUT 신뢰도 +0.10 가산 (강신호 강화)
//   • [모델 안정화] claude-haiku-4-5 → claude-haiku-4-5-20251001 (고정버전으로 갱신 충격 방지)
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

// === [V10] 종목 유니버스 — 자동 생성 (S&P500 + 미국ETF15, 한국시총 + 한국ETF15) ===
// 미국: S&P500 502개 + ETF 15개 = 517개
// 한국: 시총 296개 + ETF 15개 = 311개 (영문코드 1개 제외됨)
const DEFAULT_US = [
  "NVDA","GOOGL","GOOG","AAPL","MSFT",
  "AMZN","AVGO","META","TSLA","WMT",
  "BRK-B","LLY","JPM","MU","AMD",
  "XOM","V","JNJ","INTC","ORCL",
  "COST","CSCO","MA","CAT","CVX",
  "NFLX","ABBV","BAC","UNH","KO",
  "LRCX","PG","AMAT","PLTR","MS",
  "HD","PM","GE","GS","MRK",
  "TXN","GEV","RTX","LIN","KLAC",
  "WFC","QCOM","AXP","IBM","C",
  "TMUS","ADI","PEP","PANW","MCD",
  "SNDK","VZ","NEE","DIS","ANET",
  "BLK","AMGN","BA","T","TJX",
  "STX","APP","TMO","UNP","GILD",
  "SCHW","WDC","CRWD","ISRG","DELL",
  "GLW","ABT","UBER","DE","COP",
  "WELL","APH","ETN","CRM","PFE",
  "BX","HON","PLD","VRT","CB",
  "SPGI","MO","CVS","LOW","LMT",
  "SBUX","BKNG","SYK","PGR","NEM",
  "BMY","COF","DHR","INTU","VRTX",
  "CME","ACN","PWR","PH","NOW",
  "SO","EQIX","ADBE","HWM","TT",
  "MDT","DUK","SNPS","CDNS","WMB",
  "MAR","CEG","HCA","BK","CMI",
  "MCK","FTNT","GD","WM","ADP",
  "CMCSA","ICE","FDX","FCX","MNST",
  "KKR","CSX","PNC","ELV","SLB",
  "JCI","BSX","USB","AMT","UPS",
  "MMC","ABNB","MMM","MDLZ","NOC",
  "MCO","APO","VLO","SPG","EOG",
  "ORLY","CI","MPC","KMI","DDOG",
  "SHW","CIEN","EMR","NXPI","MPWR",
  "CVNA","HLT","PSX","CL","NSC",
  "ITW","COHR","DASH","ECL","CTAS",
  "AON","HOOD","AEP","CRH","MSI",
  "ROST","WBD","RCL","DLR","TDG",
  "RSG","GM","BKR","APD","FIX",
  "TRV","REGN","LITE","NKE","AFL",
  "GWW","D","OXY","URI","OKE",
  "SRE","TRGP","PCAR","TFC","TEL",
  "KEYS","LHX","FANG","O","DVN",
  "ALL","TGT","AZO","CTVA","CARR",
  "AJG","MET","NDAQ","PSA","F",
  "AME","NUE","ADSK","COR","EBAY",
  "FAST","EA","TER","MCHP","ETR",
  "COIN","XEL","ROK","EW","CAH",
  "VST","DAL","EXC","TTWO","WAB",
  "HPE","GRMN","FITB","CMG","VTR",
  "IDXX","ON","STT","MSCI","ODFL",
  "AMP","XYZ","YUM","KR","AIG",
  "ARES","KDP","SATS","ED","CCI",
  "BDX","PYPL","ADM","DHI","EME",
  "LYV","HSY","IBKR","CBOE","PEG",
  "CBRE","HIG","TKO","IRM","HUM",
  "EQT","PRU","HAL","JBL","WEC",
  "SYY","PCG","VMC","CCL","PAYX",
  "ROP","MLM","ACGL","LVS","KVUE",
  "STLD","WAT","ZTS","CPRT","AXON",
  "WDAY","KMB","A","CASY","HBAN",
  "Q","VICI","EXR","NTRS","FISV",
  "MTB","RJF","UAL","ATO","AEE",
  "RMD","DTE","EL","IQV","CNC",
  "TDY","DOV","BIIB","GEHC","VRSN",
  "DOW","KHC","FOXA","FICO","IR",
  "OTIS","CNP","WRB","TPL","TPR",
  "NRG","EIX","ROL","PPL","FOX",
  "CINF","AVB","CFG","EXPE","XYL",
  "FE","ES","STZ","EQR","DXCM",
  "FSLR","HUBB","JBHT","AWK","CTSH",
  "WTW","BG","LYB","SYF","NTAP",
  "EXE","TSN","DG","PPG","RF",
  "CHD","KEY","CPAY","VRSK","FIS",
  "NI","CMS","L","DRI","PFG",
  "TROW","AKAM","MTD","SBAC","WST",
  "FFIV","VLTO","PHM","DGX","LH",
  "ULTA","STE","OMC","ALB","LEN",
  "EXPD","CHRW","DD","WSM","BRO",
  "RL","SW","CHTR","EFX","CF",
  "VTRS","HPQ","MRNA","INCY","EVRG",
  "SNA","IFF","GPN","LUV","PKG",
  "LNT","SMCI","ESS","FTV","GIS",
  "DLTR","LII","BR","AMCR","INVH",
  "PTC","TSCO","BEN","WY","ZBH",
  "IP","KIM","TXT","LDOS","IEX",
  "NDSN","NVR","MAA","HST","NWS",
  "GNRC","BALL","GEN","REG","NWSA",
  "APA","EG","LULU","DOC","CSGP",
  "TYL","DECK","J","UDR","CDW",
  "HAS","SOLV","MAS","HII","TRMB",
  "GPC","DVA","AIZ","MKC","ZBRA",
  "GL","BBY","IVZ","GDDY","PNW",
  "BF-B","AVY","COO","PNR","SWK",
  "ERIE","ALGN","CLX","APTV","HRL",
  "SJM","ALLE","PSKY","CPT","BXP",
  "RVTY","SWKS","PODD","TTD","IT",
  "AES","UHS","DPZ","FRT","JKHY",
  "WYNN","MGM","BAX","HSIC","FDS",
  "ARE","TAP","AOS","BLDR","CRL",
  "NCLH","TECH","MOS","POOL","CAG",
  "CPB","EPAM","RKLB","SPY","QQQ","IVV",
  "VOO","VTI","SOXL","SOXS","TQQQ",
  "SQQQ","SMH","TLT","GLD","XLF",
  "XLE","IWM",
  // [V9.0 패닉헤지 강화] S&P500 인버스 ETF — SPXU(-3x)·SH(-1x). SQQQ(Nasdaq 3x인버스)와 함께
  //   시장 전체 하락 시 헤지 대응 가능. BEAR 차단 면제(INVERSE_ETF 셋 이미 포함됨).
  "SPXU","SH",
  // [추가 ETF] 미국 섹터 SPDR + 테마(반도체/바이오/다우) — 추세 명확·거래량 큼
  "XLK","XLV","XLY","XLI","XLP","XLU","XLB","XLC","XLRE",
  "SOXX","IBB","DIA"
];

const DEFAULT_KR = [
  "005930.KS","000660.KS","402340.KS","005380.KS","009150.KS",
  "373220.KS","032830.KS","034020.KS","329180.KS","028260.KS",
  "207940.KS","012450.KS","000270.KS","105560.KS","012330.KS",
  "006400.KS","055550.KS","034730.KS","068270.KS","267260.KS",
  "010120.KS","066570.KS","006800.KS","042660.KS","298040.KS",
  "005490.KS","086790.KS","035420.KS","042700.KS","010130.KS",
  "009540.KS","010140.KS","000150.KS","015760.KS","000810.KS",
  "051910.KS","316140.KS","064350.KS","267250.KS","017670.KS",
  "003670.KS","247540.KQ","096770.KS","272210.KS","011070.KS",
  "079550.KS","086520.KQ","196170.KQ","033780.KS","011200.KS",
  "035720.KS","003550.KS","138040.KS","086280.KS","307950.KS",
  "006260.KS","024110.KS","000720.KS","047810.KS","018260.KS",
  "278470.KS","277810.KQ","071050.KS","030200.KS","259960.KS",
  "047050.KS","010950.KS","047040.KS","005940.KS","016360.KS",
  "443060.KS","323410.KS","001440.KS","039490.KS","028050.KS",
  "036930.KQ","352820.KS","005830.KS","000880.KS","003230.KS",
  "003490.KS","007660.KS","000250.KQ","062040.KS","058470.KQ",
  "064400.KS","267270.KS","000990.KS","180640.KS","161390.KS",
  "326030.KS","034220.KS","353200.KS","009830.KS","078930.KS",
  "039030.KQ","000100.KS","090430.KS","454910.KS","000500.KS",
  "028300.KQ","032640.KS","377300.KS","298380.KQ","021240.KS",
  "241560.KS","336260.KS","066970.KS","082740.KS","087010.KQ",
  "240810.KQ","036570.KS","010060.KS","141080.KQ","128940.KS",
  "052690.KS","029780.KS","004020.KS","138930.KS","271560.KS",
  "011790.KS","018880.KS","310210.KQ","103590.KS","001040.KS",
  "004170.KS","022100.KS","178320.KQ","088350.KS","450080.KS",
  "214370.KQ","175330.KS","023530.KS","002380.KS","403870.KQ",
  "108490.KQ","095340.KQ","051900.KS","111770.KS","012510.KS",
  "004800.KS","489790.KS","011780.KS","251270.KS","011170.KS",
  "005850.KS","036460.KS","067310.KQ","064760.KQ","014680.KS",
  "214150.KQ","035250.KS","357780.KQ","017800.KS","001450.KS",
  "145020.KQ","226950.KQ","302440.KS","097950.KS","028670.KS",
  "031210.KS","375500.KS","084370.KQ","005290.KQ","214450.KQ",
  "020150.KS","457190.KS","347850.KQ","001720.KS","139130.KS",
  "383220.KS","009420.KS","263750.KQ","204320.KS","031980.KQ",
  "237690.KQ","006360.KS","071970.KS","009970.KS","004990.KS",
  "098460.KQ","007340.KS","012750.KS","026960.KS","229640.KS",
  "003690.KS","257720.KQ","139480.KS","103140.KS","011210.KS",
  "051600.KS","078600.KQ","004370.KS","083650.KQ","018670.KS",
  "069960.KS","000240.KS","120110.KS","008930.KS","008770.KS",
  "007070.KS","068760.KQ","001430.KS","282330.KS","005440.KS",
  "112610.KS","030000.KS","035900.KQ","161890.KS","192820.KS",
  "081660.KS","000120.KS","140860.KQ","041510.KQ","077970.KS",
  "089030.KQ","060370.KQ","017960.KS","023590.KS","002790.KS",
  "298020.KS","005070.KS","001120.KS","462870.KS","361610.KS",
  "101490.KQ","003540.KS","006040.KS","096530.KQ","006280.KS",
  "039200.KQ","003570.KS","001800.KS","069620.KS","232140.KQ",
  "032350.KS","003530.KS","192080.KS","030610.KS","294870.KS",
  "007390.KQ","073240.KS","007310.KS","004000.KS","012630.KS",
  "034230.KS","065350.KQ","281740.KQ","195940.KQ","085660.KQ",
  "000210.KS","204270.KQ","003090.KS","000080.KS","100090.KS",
  "213420.KQ","003240.KS","036830.KQ","137400.KQ","300720.KS",
  "280360.KS","185750.KS","009450.KS","005300.KS","000670.KS",
  "298050.KS","108320.KS","137310.KS","293490.KQ","248070.KS",
  "006120.KS","035760.KQ","100840.KS","122870.KQ","358570.KQ",
  "348370.KQ","071320.KS","253450.KQ","004490.KS","285130.KS",
  "484870.KS","009240.KS","225570.KQ","082270.KQ","086900.KQ",
  "114090.KS","003030.KS","112040.KQ","001680.KS","328130.KQ",
  "005180.KS","376300.KQ","067160.KQ","039130.KS","018290.KQ",
  "042000.KQ","069500.KS","122630.KS","252670.KS","102110.KS",
  "233740.KS","251340.KS","114800.KS","229200.KS","091160.KS",
  "305720.KS","371460.KS","360750.KS","133690.KS","379800.KS",
  "117460.KS",
  // [추가 ETF] TIGER 미국우주테크(0183J0, 2026.04 상장), TIGER K방산&우주(463250)
  //   주의: 0183J0은 영문 포함 코드 — 시스템은 .KS 접미사로 시장판정·문자열키 처리라 안전.
  "0183J0.KS","463250.KS",
  // [추가 ETF] 미국 테크/반도체 테마 (추세 명확·거래량 큼)
  "381180.KS","381170.KS","379810.KS","441680.KS",
  // [추가 ETF] 비미국 테마 — 원자재(금·원유)·국내섹터(2차전지·은행)·중국
  "132030.KS","130680.KS","305540.KS","091170.KS","192090.KS",
  // [추가 ETF] 리츠·코스닥
  "329200.KS","232080.KS"
];

// ETF 심볼 셋 (레버리지 ETF 리스크 처리용)
const ETF_SYMBOLS = new Set([
  "SPY","QQQ","IVV","VOO","VTI",
  "SOXL","SOXS","TQQQ","SQQQ","SMH",
  "TLT","GLD","XLF","XLE","IWM",
  "SPXU","SH",  // [V9.0] S&P500 인버스 ETF 추가
  "069500.KS","122630.KS","252670.KS","102110.KS","233740.KS",
  "251340.KS","114800.KS","229200.KS","091160.KS","305720.KS",
  "371460.KS","360750.KS","133690.KS","379800.KS","117460.KS",
  "0183J0.KS","463250.KS",  // [추가] TIGER 미국우주테크 · K방산&우주
  "381180.KS","381170.KS","379810.KS","441680.KS",  // [추가] 미국 반도체/테크 ETF
  "132030.KS","130680.KS","305540.KS","091170.KS","192090.KS",  // [추가] 금·원유·2차전지·은행·중국
  "329200.KS","232080.KS",  // [추가] TIGER 리츠부동산인프라 · TIGER 코스닥150
  "XLK","XLV","XLY","XLI","XLP","XLU","XLB","XLC","XLRE","SOXX","IBB","DIA",  // [추가] 미국 섹터/테마 ETF
]);

// 레버리지/인버스 ETF (일일 변동성 2~3배 — ATR 사이징 자동 축소 대상)
const LEVERAGED_ETF = new Set(["SOXL","SOXS","TQQQ","SQQQ","SPXU","122630.KS","252670.KS","233740.KS","251340.KS","114800.KS"]); // [V9.0] SPXU 추가 (-3x 인버스, decay·3배변동성 동일)

// ── [ETF 세분화 전략] ETF 유형 분류 — 바스켓이라 개별주와 구조가 다르므로 유형별 차등 전략 ──
//   index(시장지수): 변동성 낮음·시장폭 중요 / sector(섹터): 로테이션·RS 중요
//   theme(테마): 강한 모멘텀 / commodity(원자재): 추세 명확·돌파 우대
//   bond(채권): 저변동·금리역방향 / leverage·inverse: 별도 처리 / country/us_index: 해외·미국추종
const ETF_TYPE = {
  // 시장 지수
  "SPY":"index","QQQ":"index","IVV":"index","VOO":"index","VTI":"index","IWM":"index","DIA":"index",
  "069500.KS":"index","102110.KS":"index","229200.KS":"index","232080.KS":"index",
  // 섹터 (로테이션)
  "XLK":"sector","XLV":"sector","XLY":"sector","XLI":"sector","XLP":"sector","XLU":"sector",
  "XLB":"sector","XLC":"sector","XLRE":"sector","XLF":"sector","XLE":"sector",
  "091160.KS":"sector","091170.KS":"sector","305720.KS":"sector","305540.KS":"sector","329200.KS":"sector",
  // 테마 (모멘텀)
  "SOXX":"theme","SMH":"theme","IBB":"theme","371460.KS":"theme",
  "381180.KS":"theme","381170.KS":"theme","0183J0.KS":"theme","463250.KS":"theme",
  // 레버리지 (롱)
  "SOXL":"leverage","TQQQ":"leverage","122630.KS":"leverage","233740.KS":"leverage",
  // 인버스
  "SOXS":"inverse","SQQQ":"inverse","SPXU":"inverse","SH":"inverse",  // [V9.0] SPXU·SH 추가
  "252670.KS":"inverse","251340.KS":"inverse","114800.KS":"inverse",
  // 원자재
  "GLD":"commodity","132030.KS":"commodity","130680.KS":"commodity",
  // 채권
  "TLT":"bond",
  // 한국상장 미국지수 추종
  "360750.KS":"us_index","133690.KS":"us_index","379800.KS":"us_index","379810.KS":"us_index","441680.KS":"us_index",
  // 해외 국가
  "192090.KS":"country",
  // 기타 한국 ETF
  "117460.KS":"sector"
};
function getEtfType(sym) {
  if (!sym) return null;
  if (ETF_TYPE[sym]) return ETF_TYPE[sym];
  return ETF_SYMBOLS.has(sym) ? "other" : null;  // 분류 안 된 ETF는 "other"
}

// 종목 한글/영문 이름 맵 (UI 표시용)
const NAME_MAP = {
  "NVDA":"NVIDIA",
  "GOOGL":"Alphabet A",
  "GOOG":"Alphabet C",
  "AAPL":"Apple",
  "MSFT":"Microsoft",
  "AMZN":"Amazon",
  "AVGO":"Broadcom",
  "META":"Meta",
  "TSLA":"Tesla",
  "WMT":"Walmart",
  "BRK-B":"Berkshire B",
  "LLY":"Eli Lilly",
  "JPM":"JPMorgan",
  "MU":"Micron",
  "AMD":"AMD",
  "XOM":"Exxon Mobil",
  "V":"Visa",
  "JNJ":"Johnson & Johnson",
  "INTC":"Intel",
  "ORCL":"Oracle",
  "COST":"Costco",
  "CSCO":"Cisco",
  "MA":"Mastercard",
  "CAT":"Caterpillar",
  "CVX":"Chevron",
  "NFLX":"Netflix",
  "ABBV":"AbbVie",
  "BAC":"Bank of America",
  "UNH":"UnitedHealth",
  "KO":"Coca-Cola",
  "LRCX":"Lam Research",
  "PG":"Procter & Gamble",
  "AMAT":"Applied Materials",
  "PLTR":"Palantir",
  "MS":"Morgan Stanley",
  "HD":"Home Depot",
  "PM":"Philip Morris",
  "GE":"GE Aerospace",
  "GS":"Goldman Sachs",
  "MRK":"Merck",
  "TXN":"Texas Instruments",
  "GEV":"GE Vernova",
  "RTX":"RTX",
  "LIN":"Linde",
  "KLAC":"KLA",
  "WFC":"Wells Fargo",
  "QCOM":"Qualcomm",
  "AXP":"American Express",
  "IBM":"IBM",
  "C":"Citigroup",
  "TMUS":"T-Mobile",
  "ADI":"Analog Devices",
  "PEP":"PepsiCo",
  "PANW":"Palo Alto Networks",
  "MCD":"McDonald's",
  "SNDK":"Sandisk",
  "VZ":"Verizon",
  "NEE":"NextEra Energy",
  "DIS":"Disney",
  "ANET":"Arista Networks",
  "BLK":"BlackRock",
  "AMGN":"Amgen",
  "BA":"Boeing",
  "T":"AT&T",
  "TJX":"TJX",
  "STX":"Seagate",
  "APP":"AppLovin",
  "TMO":"Thermo Fisher",
  "UNP":"Union Pacific",
  "GILD":"Gilead",
  "SCHW":"Charles Schwab",
  "WDC":"Western Digital",
  "CRWD":"CrowdStrike",
  "ISRG":"Intuitive Surgical",
  "DELL":"Dell",
  "GLW":"Corning",
  "ABT":"Abbott",
  "UBER":"Uber",
  "DE":"Deere",
  "COP":"ConocoPhillips",
  "WELL":"Welltower",
  "APH":"Amphenol",
  "ETN":"Eaton",
  "CRM":"Salesforce",
  "PFE":"Pfizer",
  "BX":"Blackstone",
  "HON":"Honeywell",
  "PLD":"Prologis",
  "VRT":"Vertiv",
  "CB":"Chubb",
  "SPGI":"S&P Global",
  "MO":"Altria",
  "CVS":"CVS Health",
  "LOW":"Lowe's",
  "LMT":"Lockheed Martin",
  "SBUX":"Starbucks",
  "BKNG":"Booking",
  "SYK":"Stryker",
  "PGR":"Progressive",
  "NEM":"Newmont",
  "BMY":"Bristol-Myers",
  "COF":"Capital One",
  "DHR":"Danaher",
  "INTU":"Intuit",
  "VRTX":"Vertex Pharma",
  "CME":"CME Group",
  "ACN":"Accenture",
  "PWR":"Quanta Services",
  "PH":"Parker-Hannifin",
  "NOW":"ServiceNow",
  "SO":"Southern",
  "EQIX":"Equinix",
  "ADBE":"Adobe",
  "HWM":"Howmet Aerospace",
  "TT":"Trane",
  "MDT":"Medtronic",
  "DUK":"Duke Energy",
  "SNPS":"Synopsys",
  "CDNS":"Cadence",
  "WMB":"Williams",
  "MAR":"Marriott",
  "CEG":"Constellation Energy",
  "HCA":"HCA Healthcare",
  "BK":"BNY Mellon",
  "CMI":"Cummins",
  "MCK":"McKesson",
  "FTNT":"Fortinet",
  "GD":"General Dynamics",
  "WM":"Waste Management",
  "ADP":"ADP",
  "CMCSA":"Comcast",
  "ICE":"Intercontinental Exch",
  "FDX":"FedEx",
  "FCX":"Freeport-McMoRan",
  "MNST":"Monster Beverage",
  "KKR":"KKR",
  "CSX":"CSX",
  "PNC":"PNC Financial",
  "ELV":"Elevance Health",
  "SLB":"SLB",
  "JCI":"Johnson Controls",
  "BSX":"Boston Scientific",
  "USB":"US Bancorp",
  "AMT":"American Tower",
  "UPS":"UPS",
  "MMC":"Marsh McLennan",
  "ABNB":"Airbnb",
  "MMM":"3M",
  "MDLZ":"Mondelez",
  "NOC":"Northrop Grumman",
  "MCO":"Moody's",
  "APO":"Apollo Global",
  "VLO":"Valero Energy",
  "SPG":"Simon Property",
  "EOG":"EOG Resources",
  "ORLY":"O'Reilly Auto",
  "CI":"Cigna",
  "MPC":"Marathon Petroleum",
  "KMI":"Kinder Morgan",
  "DDOG":"Datadog",
  "SHW":"Sherwin-Williams",
  "CIEN":"Ciena",
  "EMR":"Emerson Electric",
  "NXPI":"NXP Semiconductors",
  "MPWR":"Monolithic Power",
  "CVNA":"Carvana",
  "HLT":"Hilton",
  "PSX":"Phillips 66",
  "CL":"Colgate-Palmolive",
  "NSC":"Norfolk Southern",
  "ITW":"Illinois Tool Works",
  "COHR":"Coherent",
  "DASH":"DoorDash",
  "ECL":"Ecolab",
  "CTAS":"Cintas",
  "AON":"Aon",
  "HOOD":"Robinhood",
  "AEP":"American Electric Power",
  "CRH":"CRH",
  "MSI":"Motorola Solutions",
  "ROST":"Ross Stores",
  "WBD":"Warner Bros Discovery",
  "RCL":"Royal Caribbean",
  "DLR":"Digital Realty",
  "TDG":"TransDigm",
  "RSG":"Republic Services",
  "GM":"General Motors",
  "BKR":"Baker Hughes",
  "APD":"Air Products",
  "FIX":"Comfort Systems",
  "TRV":"Travelers",
  "REGN":"Regeneron",
  "LITE":"Lumentum",
  "NKE":"Nike",
  "AFL":"Aflac",
  "GWW":"Grainger",
  "D":"Dominion Energy",
  "OXY":"Occidental",
  "URI":"United Rentals",
  "OKE":"ONEOK",
  "SRE":"Sempra",
  "TRGP":"Targa Resources",
  "PCAR":"PACCAR",
  "TFC":"Truist Financial",
  "TEL":"TE Connectivity",
  "KEYS":"Keysight",
  "LHX":"L3Harris",
  "FANG":"Diamondback Energy",
  "O":"Realty Income",
  "DVN":"Devon Energy",
  "ALL":"Allstate",
  "TGT":"Target",
  "AZO":"AutoZone",
  "CTVA":"Corteva",
  "CARR":"Carrier",
  "AJG":"Arthur J Gallagher",
  "MET":"MetLife",
  "NDAQ":"Nasdaq",
  "PSA":"Public Storage",
  "F":"Ford",
  "AME":"AMETEK",
  "NUE":"Nucor",
  "ADSK":"Autodesk",
  "COR":"Cencora",
  "EBAY":"eBay",
  "FAST":"Fastenal",
  "EA":"Electronic Arts",
  "TER":"Teradyne",
  "MCHP":"Microchip",
  "ETR":"Entergy",
  "COIN":"Coinbase",
  "XEL":"Xcel Energy",
  "ROK":"Rockwell Automation",
  "EW":"Edwards Lifesciences",
  "CAH":"Cardinal Health",
  "VST":"Vistra",
  "DAL":"Delta Air Lines",
  "EXC":"Exelon",
  "TTWO":"Take-Two",
  "WAB":"Wabtec",
  "HPE":"HP Enterprise",
  "GRMN":"Garmin",
  "FITB":"Fifth Third",
  "CMG":"Chipotle",
  "VTR":"Ventas",
  "IDXX":"IDEXX",
  "ON":"ON Semiconductor",
  "STT":"State Street",
  "MSCI":"MSCI",
  "ODFL":"Old Dominion",
  "AMP":"Ameriprise",
  "XYZ":"Block",
  "YUM":"Yum Brands",
  "KR":"Kroger",
  "AIG":"AIG",
  "ARES":"Ares Management",
  "KDP":"Keurig Dr Pepper",
  "SATS":"EchoStar",
  "ED":"Consolidated Edison",
  "CCI":"Crown Castle",
  "BDX":"Becton Dickinson",
  "PYPL":"PayPal",
  "ADM":"Archer-Daniels",
  "DHI":"DR Horton",
  "EME":"EMCOR",
  "LYV":"Live Nation",
  "HSY":"Hershey",
  "IBKR":"Interactive Brokers",
  "CBOE":"Cboe Global",
  "PEG":"Public Service Enterprise",
  "CBRE":"CBRE",
  "HIG":"Hartford",
  "TKO":"TKO Group",
  "IRM":"Iron Mountain",
  "HUM":"Humana",
  "EQT":"EQT",
  "PRU":"Prudential",
  "HAL":"Halliburton",
  "JBL":"Jabil",
  "WEC":"WEC Energy",
  "SYY":"Sysco",
  "PCG":"PG&E",
  "VMC":"Vulcan Materials",
  "CCL":"Carnival",
  "PAYX":"Paychex",
  "ROP":"Roper",
  "MLM":"Martin Marietta",
  "ACGL":"Arch Capital",
  "LVS":"Las Vegas Sands",
  "KVUE":"Kenvue",
  "STLD":"Steel Dynamics",
  "WAT":"Waters",
  "ZTS":"Zoetis",
  "CPRT":"Copart",
  "AXON":"Axon",
  "WDAY":"Workday",
  "KMB":"Kimberly-Clark",
  "A":"Agilent",
  "CASY":"Casey's",
  "HBAN":"Huntington Bancshares",
  "Q":"Qnity Electronics",
  "VICI":"VICI Properties",
  "EXR":"Extra Space Storage",
  "NTRS":"Northern Trust",
  "FISV":"Fiserv",
  "MTB":"M&T Bank",
  "RJF":"Raymond James",
  "UAL":"United Airlines",
  "ATO":"Atmos Energy",
  "AEE":"Ameren",
  "RMD":"ResMed",
  "DTE":"DTE Energy",
  "EL":"Estee Lauder",
  "IQV":"IQVIA",
  "CNC":"Centene",
  "TDY":"Teledyne",
  "DOV":"Dover",
  "BIIB":"Biogen",
  "GEHC":"GE HealthCare",
  "VRSN":"VeriSign",
  "DOW":"Dow",
  "KHC":"Kraft Heinz",
  "FOXA":"Fox A",
  "FICO":"Fair Isaac",
  "IR":"Ingersoll Rand",
  "OTIS":"Otis Worldwide",
  "CNP":"CenterPoint Energy",
  "WRB":"WR Berkley",
  "TPL":"Texas Pacific Land",
  "TPR":"Tapestry",
  "NRG":"NRG Energy",
  "EIX":"Edison Intl",
  "ROL":"Rollins",
  "PPL":"PPL",
  "FOX":"Fox B",
  "CINF":"Cincinnati Financial",
  "AVB":"AvalonBay",
  "CFG":"Citizens Financial",
  "EXPE":"Expedia",
  "XYL":"Xylem",
  "FE":"FirstEnergy",
  "ES":"Eversource",
  "STZ":"Constellation Brands",
  "EQR":"Equity Residential",
  "DXCM":"DexCom",
  "FSLR":"First Solar",
  "HUBB":"Hubbell",
  "JBHT":"JB Hunt",
  "AWK":"American Water Works",
  "CTSH":"Cognizant",
  "WTW":"Willis Towers Watson",
  "BG":"Bunge",
  "LYB":"LyondellBasell",
  "SYF":"Synchrony",
  "NTAP":"NetApp",
  "EXE":"Expand Energy",
  "TSN":"Tyson Foods",
  "DG":"Dollar General",
  "PPG":"PPG Industries",
  "RF":"Regions Financial",
  "CHD":"Church & Dwight",
  "KEY":"KeyCorp",
  "CPAY":"Corpay",
  "VRSK":"Verisk",
  "FIS":"Fidelity Natl Info",
  "NI":"NiSource",
  "CMS":"CMS Energy",
  "L":"Loews",
  "DRI":"Darden",
  "PFG":"Principal Financial",
  "TROW":"T Rowe Price",
  "AKAM":"Akamai",
  "MTD":"Mettler-Toledo",
  "SBAC":"SBA Communications",
  "WST":"West Pharmaceutical",
  "FFIV":"F5",
  "VLTO":"Veralto",
  "PHM":"PulteGroup",
  "DGX":"Quest Diagnostics",
  "LH":"Labcorp",
  "ULTA":"Ulta Beauty",
  "STE":"STERIS",
  "OMC":"Omnicom",
  "ALB":"Albemarle",
  "LEN":"Lennar",
  "EXPD":"Expeditors",
  "CHRW":"CH Robinson",
  "DD":"DuPont",
  "WSM":"Williams-Sonoma",
  "BRO":"Brown & Brown",
  "RL":"Ralph Lauren",
  "SW":"Smurfit Westrock",
  "CHTR":"Charter Comm",
  "EFX":"Equifax",
  "CF":"CF Industries",
  "VTRS":"Viatris",
  "HPQ":"HP",
  "MRNA":"Moderna",
  "INCY":"Incyte",
  "EVRG":"Evergy",
  "SNA":"Snap-on",
  "IFF":"Intl Flavors",
  "GPN":"Global Payments",
  "LUV":"Southwest Airlines",
  "PKG":"Packaging Corp",
  "LNT":"Alliant Energy",
  "SMCI":"Super Micro",
  "ESS":"Essex Property",
  "FTV":"Fortive",
  "GIS":"General Mills",
  "DLTR":"Dollar Tree",
  "LII":"Lennox",
  "BR":"Broadridge",
  "AMCR":"Amcor",
  "INVH":"Invitation Homes",
  "PTC":"PTC",
  "TSCO":"Tractor Supply",
  "BEN":"Franklin Resources",
  "WY":"Weyerhaeuser",
  "ZBH":"Zimmer Biomet",
  "IP":"Intl Paper",
  "KIM":"Kimco Realty",
  "TXT":"Textron",
  "LDOS":"Leidos",
  "IEX":"IDEX",
  "NDSN":"Nordson",
  "NVR":"NVR",
  "MAA":"Mid-America Apt",
  "HST":"Host Hotels",
  "NWS":"News Corp B",
  "GNRC":"Generac",
  "BALL":"Ball",
  "GEN":"Gen Digital",
  "REG":"Regency Centers",
  "NWSA":"News Corp A",
  "APA":"APA",
  "EG":"Everest Group",
  "LULU":"Lululemon",
  "DOC":"Healthpeak",
  "CSGP":"CoStar",
  "TYL":"Tyler Tech",
  "DECK":"Deckers",
  "J":"Jacobs Solutions",
  "UDR":"UDR",
  "CDW":"CDW",
  "HAS":"Hasbro",
  "SOLV":"Solventum",
  "MAS":"Masco",
  "HII":"Huntington Ingalls",
  "TRMB":"Trimble",
  "GPC":"Genuine Parts",
  "DVA":"DaVita",
  "AIZ":"Assurant",
  "MKC":"McCormick",
  "ZBRA":"Zebra Tech",
  "GL":"Globe Life",
  "BBY":"Best Buy",
  "IVZ":"Invesco",
  "GDDY":"GoDaddy",
  "PNW":"Pinnacle West",
  "BF-B":"Brown-Forman",
  "AVY":"Avery Dennison",
  "COO":"Cooper Companies",
  "PNR":"Pentair",
  "SWK":"Stanley Black Decker",
  "ERIE":"Erie Indemnity",
  "ALGN":"Align Tech",
  "CLX":"Clorox",
  "APTV":"Aptiv",
  "HRL":"Hormel",
  "SJM":"Smucker",
  "ALLE":"Allegion",
  "PSKY":"Paramount Skydance",
  "CPT":"Camden Property",
  "BXP":"BXP",
  "RVTY":"Revvity",
  "SWKS":"Skyworks",
  "PODD":"Insulet",
  "TTD":"Trade Desk",
  "IT":"Gartner",
  "AES":"AES",
  "UHS":"Universal Health",
  "DPZ":"Domino's Pizza",
  "FRT":"Federal Realty",
  "JKHY":"Jack Henry",
  "WYNN":"Wynn Resorts",
  "MGM":"MGM Resorts",
  "BAX":"Baxter",
  "HSIC":"Henry Schein",
  "FDS":"FactSet",
  "ARE":"Alexandria RE",
  "TAP":"Molson Coors",
  "AOS":"AO Smith",
  "BLDR":"Builders FirstSource",
  "CRL":"Charles River Labs",
  "NCLH":"Norwegian Cruise",
  "TECH":"Bio-Techne",
  "MOS":"Mosaic",
  "POOL":"Pool Corp",
  "CAG":"Conagra Brands",
  "CPB":"Campbell's",
  "EPAM":"EPAM Systems",
  "RKLB":"로켓랩",
  "SPY":"SPDR S&P500",
  "QQQ":"Invesco QQQ",
  "IVV":"iShares S&P500",
  "VOO":"Vanguard S&P500",
  "VTI":"Vanguard Total Mkt",
  "SOXL":"반도체 3x 롱",
  "SOXS":"반도체 3x 숏",
  "TQQQ":"나스닥 3x 롱",
  "SQQQ":"나스닥 3x 숏",
  "SPXU":"S&P500 3x 숏",   // [V9.0]
  "SH":"S&P500 1x 숏",     // [V9.0]
  "SMH":"반도체 ETF",
  "TLT":"미국 장기채",
  "GLD":"금 ETF",
  "XLF":"금융 섹터",
  "XLE":"에너지 섹터",
  "IWM":"러셀2000",
  "005930.KS":"삼성전자",
  "000660.KS":"SK하이닉스",
  "402340.KS":"SK스퀘어",
  "005380.KS":"현대차",
  "009150.KS":"삼성전기",
  "373220.KS":"LG에너지솔루션",
  "032830.KS":"삼성생명",
  "034020.KS":"두산에너빌리티",
  "329180.KS":"HD현대중공업",
  "028260.KS":"삼성물산",
  "207940.KS":"삼성바이오로직스",
  "012450.KS":"한화에어로스페이스",
  "000270.KS":"기아",
  "105560.KS":"KB금융",
  "012330.KS":"현대모비스",
  "006400.KS":"삼성SDI",
  "055550.KS":"신한지주",
  "034730.KS":"SK",
  "068270.KS":"셀트리온",
  "267260.KS":"HD현대일렉트릭",
  "010120.KS":"LS ELECTRIC",
  "066570.KS":"LG전자",
  "006800.KS":"미래에셋증권",
  "042660.KS":"한화오션",
  "298040.KS":"효성중공업",
  "005490.KS":"POSCO홀딩스",
  "086790.KS":"하나금융지주",
  "035420.KS":"NAVER",
  "042700.KS":"한미반도체",
  "010130.KS":"고려아연",
  "009540.KS":"HD한국조선해양",
  "010140.KS":"삼성중공업",
  "000150.KS":"두산",
  "015760.KS":"한국전력",
  "000810.KS":"삼성화재",
  "051910.KS":"LG화학",
  "316140.KS":"우리금융지주",
  "064350.KS":"현대로템",
  "267250.KS":"HD현대",
  "017670.KS":"SK텔레콤",
  "003670.KS":"포스코퓨처엠",
  "247540.KQ":"에코프로비엠",
  "096770.KS":"SK이노베이션",
  "272210.KS":"한화시스템",
  "011070.KS":"LG이노텍",
  "079550.KS":"LIG디펜스앤에어로스페이스",
  "086520.KQ":"에코프로",
  "196170.KQ":"알테오젠",
  "033780.KS":"KT&G",
  "011200.KS":"HMM",
  "035720.KS":"카카오",
  "003550.KS":"LG",
  "138040.KS":"메리츠금융지주",
  "086280.KS":"현대글로비스",
  "307950.KS":"현대오토에버",
  "006260.KS":"LS",
  "024110.KS":"기업은행",
  "000720.KS":"현대건설",
  "047810.KS":"한국항공우주",
  "018260.KS":"삼성에스디에스",
  "278470.KS":"에이피알",
  "277810.KQ":"레인보우로보틱스",
  "071050.KS":"한국금융지주",
  "030200.KS":"KT",
  "259960.KS":"크래프톤",
  "047050.KS":"포스코인터내셔널",
  "010950.KS":"S-Oil",
  "047040.KS":"대우건설",
  "005940.KS":"NH투자증권",
  "016360.KS":"삼성증권",
  "443060.KS":"HD현대마린솔루션",
  "323410.KS":"카카오뱅크",
  "001440.KS":"대한전선",
  "039490.KS":"키움증권",
  "028050.KS":"삼성E&A",
  "036930.KQ":"주성엔지니어링",
  "352820.KS":"하이브",
  "005830.KS":"DB손해보험",
  "000880.KS":"한화",
  "003230.KS":"삼양식품",
  "003490.KS":"대한항공",
  "007660.KS":"이수페타시스",
  "000250.KQ":"삼천당제약",
  "062040.KS":"산일전기",
  "058470.KQ":"리노공업",
  "064400.KS":"LG씨엔에스",
  "267270.KS":"HD건설기계",
  "000990.KS":"DB하이텍",
  "180640.KS":"한진칼",
  "161390.KS":"한국타이어앤테크놀로지",
  "326030.KS":"SK바이오팜",
  "034220.KS":"LG디스플레이",
  "353200.KS":"대덕전자",
  "009830.KS":"한화솔루션",
  "078930.KS":"GS",
  "039030.KQ":"이오테크닉스",
  "000100.KS":"유한양행",
  "090430.KS":"아모레퍼시픽",
  "454910.KS":"두산로보틱스",
  "000500.KS":"가온전선",
  "028300.KQ":"HLB",
  "032640.KS":"LG유플러스",
  "377300.KS":"카카오페이",
  "298380.KQ":"에이비엘바이오",
  "021240.KS":"코웨이",
  "241560.KS":"두산밥캣",
  "336260.KS":"두산퓨얼셀",
  "066970.KS":"엘앤에프",
  "082740.KS":"한화엔진",
  "087010.KQ":"펩트론",
  "240810.KQ":"원익IPS",
  "036570.KS":"NC",
  "010060.KS":"OCI홀딩스",
  "141080.KQ":"리가켐바이오",
  "128940.KS":"한미약품",
  "052690.KS":"한전기술",
  "029780.KS":"삼성카드",
  "004020.KS":"현대제철",
  "138930.KS":"BNK금융지주",
  "271560.KS":"오리온",
  "011790.KS":"SKC",
  "018880.KS":"한온시스템",
  "310210.KQ":"보로노이",
  "103590.KS":"일진전기",
  "001040.KS":"CJ",
  "004170.KS":"신세계",
  "022100.KS":"포스코DX",
  "178320.KQ":"서진시스템",
  "088350.KS":"한화생명",
  "450080.KS":"에코프로머티",
  "214370.KQ":"케어젠",
  "175330.KS":"JB금융지주",
  "023530.KS":"롯데쇼핑",
  "002380.KS":"KCC",
  "403870.KQ":"HPSP",
  "108490.KQ":"로보티즈",
  "095340.KQ":"ISC",
  "051900.KS":"LG생활건강",
  "111770.KS":"영원무역",
  "012510.KS":"더존비즈온",
  "004800.KS":"효성",
  "489790.KS":"한화비전",
  "011780.KS":"금호석유화학",
  "251270.KS":"넷마블",
  "011170.KS":"롯데케미칼",
  "005850.KS":"에스엘",
  "036460.KS":"한국가스공사",
  "067310.KQ":"하나마이크론",
  "064760.KQ":"티씨케이",
  "014680.KS":"한솔케미칼",
  "214150.KQ":"클래시스",
  "035250.KS":"강원랜드",
  "357780.KQ":"솔브레인",
  "017800.KS":"현대엘리베이터",
  "001450.KS":"현대해상",
  "145020.KQ":"휴젤",
  "226950.KQ":"올릭스",
  "302440.KS":"SK바이오사이언스",
  "097950.KS":"CJ제일제당",
  "028670.KS":"팬오션",
  "031210.KS":"서울보증보험",
  "375500.KS":"DL이앤씨",
  "084370.KQ":"유진테크",
  "005290.KQ":"동진쎄미켐",
  "214450.KQ":"파마리서치",
  "020150.KS":"롯데에너지머티리얼즈",
  "457190.KS":"이수스페셜티케미컬",
  "347850.KQ":"디앤디파마텍",
  "001720.KS":"신영증권",
  "139130.KS":"iM금융지주",
  "383220.KS":"F&F",
  "009420.KS":"한올바이오파마",
  "263750.KQ":"펄어비스",
  "204320.KS":"HL만도",
  "031980.KQ":"피에스케이홀딩스",
  "237690.KQ":"에스티팜",
  "006360.KS":"GS건설",
  "071970.KS":"HD현대마린엔진",
  "009970.KS":"영원무역홀딩스",
  "004990.KS":"롯데지주",
  "098460.KQ":"고영",
  "007340.KS":"DN오토모티브",
  "012750.KS":"에스원",
  "026960.KS":"동서",
  "229640.KS":"LS에코에너지",
  "003690.KS":"코리안리",
  "257720.KQ":"실리콘투",
  "139480.KS":"이마트",
  "103140.KS":"풍산",
  "011210.KS":"현대위아",
  "051600.KS":"한전KPS",
  "078600.KQ":"대주전자재료",
  "004370.KS":"농심",
  "083650.KQ":"비에이치아이",
  "018670.KS":"SK가스",
  "069960.KS":"현대백화점",
  "000240.KS":"한국앤컴퍼니",
  "120110.KS":"코오롱인더",
  "008930.KS":"한미사이언스",
  "008770.KS":"호텔신라",
  "007070.KS":"GS리테일",
  "068760.KQ":"셀트리온제약",
  "001430.KS":"세아베스틸지주",
  "282330.KS":"BGF리테일",
  "005440.KS":"현대지에프홀딩스",
  "112610.KS":"씨에스윈드",
  "030000.KS":"제일기획",
  "035900.KQ":"JYP Ent.",
  "161890.KS":"한국콜마",
  "192820.KS":"코스맥스",
  "081660.KS":"미스토홀딩스",
  "000120.KS":"CJ대한통운",
  "140860.KQ":"파크시스템스",
  "041510.KQ":"에스엠",
  "077970.KS":"STX엔진",
  "089030.KQ":"테크윙",
  "060370.KQ":"LS마린솔루션",
  "017960.KS":"한국카본",
  "023590.KS":"다우기술",
  "002790.KS":"아모레퍼시픽홀딩스",
  "298020.KS":"효성티앤씨",
  "005070.KS":"코스모신소재",
  "001120.KS":"LX인터내셔널",
  "462870.KS":"시프트업",
  "361610.KS":"SK아이이테크놀로지",
  "101490.KQ":"에스앤에스텍",
  "003540.KS":"대신증권",
  "006040.KS":"동원산업",
  "096530.KQ":"씨젠",
  "006280.KS":"녹십자",
  "039200.KQ":"오스코텍",
  "003570.KS":"SNT다이내믹스",
  "001800.KS":"오리온홀딩스",
  "069620.KS":"대웅제약",
  "232140.KQ":"와이씨",
  "032350.KS":"롯데관광개발",
  "003530.KS":"한화투자증권",
  "192080.KS":"더블유게임즈",
  "030610.KS":"교보증권",
  "294870.KS":"IPARK현대산업개발",
  "007390.KQ":"네이처셀",
  "073240.KS":"금호타이어",
  "007310.KS":"오뚜기",
  "004000.KS":"롯데정밀화학",
  "012630.KS":"HDC",
  "034230.KS":"파라다이스",
  "065350.KQ":"신성델타테크",
  "281740.KQ":"레이크머티리얼즈",
  "195940.KQ":"HK이노엔",
  "085660.KQ":"차바이오텍",
  "000210.KS":"DL",
  "204270.KQ":"제이앤티씨",
  "003090.KS":"대웅",
  "000080.KS":"하이트진로",
  "100090.KS":"SK오션플랜트",
  "213420.KQ":"덕산네오룩스",
  "003240.KS":"태광산업",
  "036830.KQ":"솔브레인홀딩스",
  "137400.KQ":"피엔티",
  "300720.KS":"한일시멘트",
  "280360.KS":"롯데웰푸드",
  "185750.KS":"종근당",
  "009450.KS":"경동나비엔",
  "005300.KS":"롯데칠성",
  "000670.KS":"영풍",
  "298050.KS":"HS효성첨단소재",
  "108320.KS":"LX세미콘",
  "137310.KS":"에스디바이오센서",
  "293490.KQ":"카카오게임즈",
  "248070.KS":"솔루엠",
  "006120.KS":"SK디스커버리",
  "035760.KQ":"CJ ENM",
  "100840.KS":"SNT에너지",
  "122870.KQ":"와이지엔터테인먼트",
  "358570.KQ":"지아이이노베이션",
  "348370.KQ":"엔켐",
  "071320.KS":"지역난방공사",
  "253450.KQ":"스튜디오드래곤",
  "004490.KS":"세방전지",
  "285130.KS":"SK케미칼",
  "484870.KS":"엠앤씨솔루션",
  "009240.KS":"한샘",
  "225570.KQ":"넥슨게임즈",
  "082270.KQ":"젬백스",
  "086900.KQ":"메디톡스",
  "114090.KS":"GKL",
  "003030.KS":"세아제강지주",
  "112040.KQ":"위메이드",
  "001680.KS":"대상",
  "328130.KQ":"루닛",
  "005180.KS":"빙그레",
  "376300.KQ":"디어유",
  "067160.KQ":"SOOP",
  "039130.KS":"하나투어",
  "018290.KQ":"브이티",
  "042000.KQ":"카페24",
  "069500.KS":"KODEX 200",
  "122630.KS":"KODEX 레버리지",
  "252670.KS":"KODEX 200선물인버스2X",
  "102110.KS":"TIGER 200",
  "233740.KS":"KODEX 코스닥150레버리지",
  "251340.KS":"KODEX 코스닥150선물인버스",
  "114800.KS":"KODEX 인버스",
  "229200.KS":"KODEX 코스닥150",
  "091160.KS":"KODEX 반도체",
  "305720.KS":"KODEX 2차전지산업",
  "371460.KS":"TIGER 차이나전기차",
  "360750.KS":"TIGER 미국S&P500",
  "133690.KS":"TIGER 미국나스닥100",
  "379800.KS":"KODEX 미국S&P500",
  "117460.KS":"KODEX 에너지화학",
  "0183J0.KS":"TIGER 미국우주테크",
  "463250.KS":"TIGER K방산&우주",
  "381180.KS":"TIGER 미국필라델피아반도체",
  "381170.KS":"TIGER 미국테크TOP10",
  "379810.KS":"KODEX 미국나스닥100",
  "441680.KS":"TIGER 미국나스닥100커버드콜",
  "132030.KS":"KODEX 골드선물(H)",
  "130680.KS":"TIGER 원유선물Enhanced(H)",
  "305540.KS":"TIGER 2차전지테마",
  "091170.KS":"KODEX 은행",
  "192090.KS":"TIGER 차이나CSI300",
  "329200.KS":"TIGER 리츠부동산인프라",
  "232080.KS":"TIGER 코스닥150"
};

// 시가총액 순위 (UI 시총순 정렬용 — 값이 작을수록 대형주)
const MCAP_RANK = {
  "NVDA":1,
  "GOOGL":2,
  "GOOG":3,
  "AAPL":4,
  "MSFT":5,
  "AMZN":6,
  "AVGO":7,
  "META":8,
  "TSLA":9,
  "WMT":10,
  "BRK-B":11,
  "LLY":12,
  "JPM":13,
  "MU":14,
  "AMD":15,
  "XOM":16,
  "V":17,
  "JNJ":18,
  "INTC":19,
  "ORCL":20,
  "COST":21,
  "CSCO":22,
  "MA":23,
  "CAT":24,
  "CVX":25,
  "NFLX":26,
  "ABBV":27,
  "BAC":28,
  "UNH":29,
  "KO":30,
  "LRCX":31,
  "PG":32,
  "AMAT":33,
  "PLTR":34,
  "MS":35,
  "HD":36,
  "PM":37,
  "GE":38,
  "GS":39,
  "MRK":40,
  "TXN":41,
  "GEV":42,
  "RTX":43,
  "LIN":44,
  "KLAC":45,
  "WFC":46,
  "QCOM":47,
  "AXP":48,
  "IBM":49,
  "C":50,
  "TMUS":51,
  "ADI":52,
  "PEP":53,
  "PANW":54,
  "MCD":55,
  "SNDK":56,
  "VZ":57,
  "NEE":58,
  "DIS":59,
  "ANET":60,
  "BLK":61,
  "AMGN":62,
  "BA":63,
  "T":64,
  "TJX":65,
  "STX":66,
  "APP":67,
  "TMO":68,
  "UNP":69,
  "GILD":70,
  "SCHW":71,
  "WDC":72,
  "CRWD":73,
  "ISRG":74,
  "DELL":75,
  "GLW":76,
  "ABT":77,
  "UBER":78,
  "DE":79,
  "COP":80,
  "WELL":81,
  "APH":82,
  "ETN":83,
  "CRM":84,
  "PFE":85,
  "BX":86,
  "HON":87,
  "PLD":88,
  "VRT":89,
  "CB":90,
  "SPGI":91,
  "MO":92,
  "CVS":93,
  "LOW":94,
  "LMT":95,
  "SBUX":96,
  "BKNG":97,
  "SYK":98,
  "PGR":99,
  "NEM":100,
  "BMY":101,
  "COF":102,
  "DHR":103,
  "INTU":104,
  "VRTX":105,
  "CME":106,
  "ACN":107,
  "PWR":108,
  "PH":109,
  "NOW":110,
  "SO":111,
  "EQIX":112,
  "ADBE":113,
  "HWM":114,
  "TT":115,
  "MDT":116,
  "DUK":117,
  "SNPS":118,
  "CDNS":119,
  "WMB":120,
  "MAR":121,
  "CEG":122,
  "HCA":123,
  "BK":124,
  "CMI":125,
  "MCK":126,
  "FTNT":127,
  "GD":128,
  "WM":129,
  "ADP":130,
  "CMCSA":131,
  "ICE":132,
  "FDX":133,
  "FCX":134,
  "MNST":135,
  "KKR":136,
  "CSX":137,
  "PNC":138,
  "ELV":139,
  "SLB":140,
  "JCI":141,
  "BSX":142,
  "USB":143,
  "AMT":144,
  "UPS":145,
  "MMC":146,
  "ABNB":147,
  "MMM":148,
  "MDLZ":149,
  "NOC":150,
  "MCO":151,
  "APO":152,
  "VLO":153,
  "SPG":154,
  "EOG":155,
  "ORLY":156,
  "CI":157,
  "MPC":158,
  "KMI":159,
  "DDOG":160,
  "SHW":161,
  "CIEN":162,
  "EMR":163,
  "NXPI":164,
  "MPWR":165,
  "CVNA":166,
  "HLT":167,
  "PSX":168,
  "CL":169,
  "NSC":170,
  "ITW":171,
  "COHR":172,
  "DASH":173,
  "ECL":174,
  "CTAS":175,
  "AON":176,
  "HOOD":177,
  "AEP":178,
  "CRH":179,
  "MSI":180,
  "ROST":181,
  "WBD":182,
  "RCL":183,
  "DLR":184,
  "TDG":185,
  "RSG":186,
  "GM":187,
  "BKR":188,
  "APD":189,
  "FIX":190,
  "TRV":191,
  "REGN":192,
  "LITE":193,
  "NKE":194,
  "AFL":195,
  "GWW":196,
  "D":197,
  "OXY":198,
  "URI":199,
  "OKE":200,
  "SRE":201,
  "TRGP":202,
  "PCAR":203,
  "TFC":204,
  "TEL":205,
  "KEYS":206,
  "LHX":207,
  "FANG":208,
  "O":209,
  "DVN":210,
  "ALL":211,
  "TGT":212,
  "AZO":213,
  "CTVA":214,
  "CARR":215,
  "AJG":216,
  "MET":217,
  "NDAQ":218,
  "PSA":219,
  "F":220,
  "AME":221,
  "NUE":222,
  "ADSK":223,
  "COR":224,
  "EBAY":225,
  "FAST":226,
  "EA":227,
  "TER":228,
  "MCHP":229,
  "ETR":230,
  "COIN":231,
  "XEL":232,
  "ROK":233,
  "EW":234,
  "CAH":235,
  "VST":236,
  "DAL":237,
  "EXC":238,
  "TTWO":239,
  "WAB":240,
  "HPE":241,
  "GRMN":242,
  "FITB":243,
  "CMG":244,
  "VTR":245,
  "IDXX":246,
  "ON":247,
  "STT":248,
  "MSCI":249,
  "ODFL":250,
  "AMP":251,
  "XYZ":252,
  "YUM":253,
  "KR":254,
  "AIG":255,
  "ARES":256,
  "KDP":257,
  "SATS":258,
  "ED":259,
  "CCI":260,
  "BDX":261,
  "PYPL":262,
  "ADM":263,
  "DHI":264,
  "EME":265,
  "LYV":266,
  "HSY":267,
  "IBKR":268,
  "CBOE":269,
  "PEG":270,
  "CBRE":271,
  "HIG":272,
  "TKO":273,
  "IRM":274,
  "HUM":275,
  "EQT":276,
  "PRU":277,
  "HAL":278,
  "JBL":279,
  "WEC":280,
  "SYY":281,
  "PCG":282,
  "VMC":283,
  "CCL":284,
  "PAYX":285,
  "ROP":286,
  "MLM":287,
  "ACGL":288,
  "LVS":289,
  "KVUE":290,
  "STLD":291,
  "WAT":292,
  "ZTS":293,
  "CPRT":294,
  "AXON":295,
  "WDAY":296,
  "KMB":297,
  "A":298,
  "CASY":299,
  "HBAN":300,
  "Q":301,
  "VICI":302,
  "EXR":303,
  "NTRS":304,
  "FISV":305,
  "MTB":306,
  "RJF":307,
  "UAL":308,
  "ATO":309,
  "AEE":310,
  "RMD":311,
  "DTE":312,
  "EL":313,
  "IQV":314,
  "CNC":315,
  "TDY":316,
  "DOV":317,
  "BIIB":318,
  "GEHC":319,
  "VRSN":320,
  "DOW":321,
  "KHC":322,
  "FOXA":323,
  "FICO":324,
  "IR":325,
  "OTIS":326,
  "CNP":327,
  "WRB":328,
  "TPL":329,
  "TPR":330,
  "NRG":331,
  "EIX":332,
  "ROL":333,
  "PPL":334,
  "FOX":335,
  "CINF":336,
  "AVB":337,
  "CFG":338,
  "EXPE":339,
  "XYL":340,
  "FE":341,
  "ES":342,
  "STZ":343,
  "EQR":344,
  "DXCM":345,
  "FSLR":346,
  "HUBB":347,
  "JBHT":348,
  "AWK":349,
  "CTSH":350,
  "WTW":351,
  "BG":352,
  "LYB":353,
  "SYF":354,
  "NTAP":355,
  "EXE":356,
  "TSN":357,
  "DG":358,
  "PPG":359,
  "RF":360,
  "CHD":361,
  "KEY":362,
  "CPAY":363,
  "VRSK":364,
  "FIS":365,
  "NI":366,
  "CMS":367,
  "L":368,
  "DRI":369,
  "PFG":370,
  "TROW":371,
  "AKAM":372,
  "MTD":373,
  "SBAC":374,
  "WST":375,
  "FFIV":376,
  "VLTO":377,
  "PHM":378,
  "DGX":379,
  "LH":380,
  "ULTA":381,
  "STE":382,
  "OMC":383,
  "ALB":384,
  "LEN":385,
  "EXPD":386,
  "CHRW":387,
  "DD":388,
  "WSM":389,
  "BRO":390,
  "RL":391,
  "SW":392,
  "CHTR":393,
  "EFX":394,
  "CF":395,
  "VTRS":396,
  "HPQ":397,
  "MRNA":398,
  "INCY":399,
  "EVRG":400,
  "SNA":401,
  "IFF":402,
  "GPN":403,
  "LUV":404,
  "PKG":405,
  "LNT":406,
  "SMCI":407,
  "ESS":408,
  "FTV":409,
  "GIS":410,
  "DLTR":411,
  "LII":412,
  "BR":413,
  "AMCR":414,
  "INVH":415,
  "PTC":416,
  "TSCO":417,
  "BEN":418,
  "WY":419,
  "ZBH":420,
  "IP":421,
  "KIM":422,
  "TXT":423,
  "LDOS":424,
  "IEX":425,
  "NDSN":426,
  "NVR":427,
  "MAA":428,
  "HST":429,
  "NWS":430,
  "GNRC":431,
  "BALL":432,
  "GEN":433,
  "REG":434,
  "NWSA":435,
  "APA":436,
  "EG":437,
  "LULU":438,
  "DOC":439,
  "CSGP":440,
  "TYL":441,
  "DECK":442,
  "J":443,
  "UDR":444,
  "CDW":445,
  "HAS":446,
  "SOLV":447,
  "MAS":448,
  "HII":449,
  "TRMB":450,
  "GPC":451,
  "DVA":452,
  "AIZ":453,
  "MKC":454,
  "ZBRA":455,
  "GL":456,
  "BBY":457,
  "IVZ":458,
  "GDDY":459,
  "PNW":460,
  "BF-B":461,
  "AVY":462,
  "COO":463,
  "PNR":464,
  "SWK":465,
  "ERIE":466,
  "ALGN":467,
  "CLX":468,
  "APTV":469,
  "HRL":470,
  "SJM":471,
  "ALLE":472,
  "PSKY":473,
  "CPT":474,
  "BXP":475,
  "RVTY":476,
  "SWKS":477,
  "PODD":478,
  "TTD":479,
  "IT":480,
  "AES":481,
  "UHS":482,
  "DPZ":483,
  "FRT":484,
  "JKHY":485,
  "WYNN":486,
  "MGM":487,
  "BAX":488,
  "HSIC":489,
  "FDS":490,
  "ARE":491,
  "TAP":492,
  "AOS":493,
  "BLDR":494,
  "CRL":495,
  "NCLH":496,
  "TECH":497,
  "MOS":498,
  "POOL":499,
  "CAG":500,
  "CPB":501,
  "EPAM":502,
  "RKLB":502,
  "SPY":503,
  "QQQ":504,
  "IVV":505,
  "VOO":506,
  "VTI":507,
  "SOXL":508,
  "SOXS":509,
  "TQQQ":510,
  "SQQQ":511,
  "SPXU":518,  // [V9.0]
  "SH":519,    // [V9.0]
  "SMH":512,
  "TLT":513,
  "GLD":514,
  "XLF":515,
  "XLE":516,
  "IWM":517,
  "005930.KS":1,
  "000660.KS":2,
  "402340.KS":3,
  "005380.KS":4,
  "009150.KS":5,
  "373220.KS":6,
  "032830.KS":7,
  "034020.KS":8,
  "329180.KS":9,
  "028260.KS":10,
  "207940.KS":11,
  "012450.KS":12,
  "000270.KS":13,
  "105560.KS":14,
  "012330.KS":15,
  "006400.KS":16,
  "055550.KS":17,
  "034730.KS":18,
  "068270.KS":19,
  "267260.KS":20,
  "010120.KS":21,
  "066570.KS":22,
  "006800.KS":23,
  "042660.KS":24,
  "298040.KS":25,
  "005490.KS":26,
  "086790.KS":27,
  "035420.KS":28,
  "042700.KS":29,
  "010130.KS":30,
  "009540.KS":31,
  "010140.KS":32,
  "000150.KS":33,
  "015760.KS":34,
  "000810.KS":35,
  "051910.KS":36,
  "316140.KS":37,
  "064350.KS":38,
  "267250.KS":39,
  "017670.KS":40,
  "003670.KS":41,
  "247540.KQ":42,
  "096770.KS":43,
  "272210.KS":44,
  "011070.KS":45,
  "079550.KS":46,
  "086520.KQ":47,
  "196170.KQ":48,
  "033780.KS":49,
  "011200.KS":50,
  "035720.KS":51,
  "003550.KS":52,
  "138040.KS":53,
  "086280.KS":54,
  "307950.KS":55,
  "006260.KS":56,
  "024110.KS":57,
  "000720.KS":58,
  "047810.KS":59,
  "018260.KS":60,
  "278470.KS":61,
  "277810.KQ":62,
  "071050.KS":63,
  "030200.KS":64,
  "259960.KS":65,
  "047050.KS":66,
  "010950.KS":67,
  "047040.KS":68,
  "005940.KS":69,
  "016360.KS":70,
  "443060.KS":71,
  "323410.KS":72,
  "001440.KS":73,
  "039490.KS":74,
  "028050.KS":75,
  "036930.KQ":76,
  "352820.KS":77,
  "005830.KS":78,
  "000880.KS":79,
  "003230.KS":80,
  "003490.KS":81,
  "007660.KS":82,
  "000250.KQ":83,
  "062040.KS":84,
  "058470.KQ":85,
  "064400.KS":86,
  "267270.KS":87,
  "000990.KS":88,
  "180640.KS":89,
  "161390.KS":90,
  "326030.KS":91,
  "034220.KS":92,
  "353200.KS":93,
  "009830.KS":94,
  "078930.KS":95,
  "039030.KQ":96,
  "000100.KS":97,
  "090430.KS":98,
  "454910.KS":99,
  "000500.KS":100,
  "028300.KQ":101,
  "032640.KS":102,
  "377300.KS":103,
  "298380.KQ":104,
  "021240.KS":105,
  "241560.KS":106,
  "336260.KS":107,
  "066970.KS":108,
  "082740.KS":109,
  "087010.KQ":110,
  "240810.KQ":111,
  "036570.KS":112,
  "010060.KS":113,
  "141080.KQ":114,
  "128940.KS":115,
  "052690.KS":116,
  "029780.KS":117,
  "004020.KS":118,
  "138930.KS":119,
  "271560.KS":120,
  "011790.KS":121,
  "018880.KS":122,
  "310210.KQ":123,
  "103590.KS":124,
  "001040.KS":125,
  "004170.KS":126,
  "022100.KS":127,
  "178320.KQ":128,
  "088350.KS":129,
  "450080.KS":130,
  "214370.KQ":131,
  "175330.KS":132,
  "023530.KS":133,
  "002380.KS":134,
  "403870.KQ":135,
  "108490.KQ":136,
  "095340.KQ":137,
  "051900.KS":138,
  "111770.KS":139,
  "012510.KS":140,
  "004800.KS":141,
  "489790.KS":142,
  "011780.KS":143,
  "251270.KS":144,
  "011170.KS":145,
  "005850.KS":146,
  "036460.KS":147,
  "067310.KQ":148,
  "064760.KQ":149,
  "014680.KS":150,
  "214150.KQ":151,
  "035250.KS":152,
  "357780.KQ":153,
  "017800.KS":154,
  "001450.KS":155,
  "145020.KQ":156,
  "226950.KQ":157,
  "302440.KS":158,
  "097950.KS":159,
  "028670.KS":160,
  "031210.KS":161,
  "375500.KS":162,
  "084370.KQ":163,
  "005290.KQ":164,
  "214450.KQ":165,
  "020150.KS":166,
  "457190.KS":167,
  "347850.KQ":168,
  "001720.KS":169,
  "139130.KS":170,
  "383220.KS":171,
  "009420.KS":172,
  "263750.KQ":173,
  "204320.KS":174,
  "031980.KQ":175,
  "237690.KQ":176,
  "006360.KS":177,
  "071970.KS":178,
  "009970.KS":179,
  "004990.KS":180,
  "098460.KQ":181,
  "007340.KS":182,
  "012750.KS":183,
  "026960.KS":184,
  "229640.KS":185,
  "003690.KS":186,
  "257720.KQ":187,
  "139480.KS":188,
  "103140.KS":189,
  "011210.KS":190,
  "051600.KS":191,
  "078600.KQ":192,
  "004370.KS":193,
  "083650.KQ":194,
  "018670.KS":195,
  "069960.KS":196,
  "000240.KS":197,
  "120110.KS":198,
  "008930.KS":199,
  "008770.KS":200,
  "007070.KS":201,
  "068760.KQ":202,
  "001430.KS":203,
  "282330.KS":204,
  "005440.KS":205,
  "112610.KS":206,
  "030000.KS":207,
  "035900.KQ":208,
  "161890.KS":209,
  "192820.KS":210,
  "081660.KS":211,
  "000120.KS":212,
  "140860.KQ":213,
  "041510.KQ":214,
  "077970.KS":215,
  "089030.KQ":216,
  "060370.KQ":217,
  "017960.KS":218,
  "023590.KS":219,
  "002790.KS":220,
  "298020.KS":221,
  "005070.KS":222,
  "001120.KS":223,
  "462870.KS":224,
  "361610.KS":225,
  "101490.KQ":226,
  "003540.KS":227,
  "006040.KS":228,
  "096530.KQ":229,
  "006280.KS":230,
  "039200.KQ":231,
  "003570.KS":232,
  "001800.KS":233,
  "069620.KS":234,
  "232140.KQ":235,
  "032350.KS":236,
  "003530.KS":237,
  "192080.KS":238,
  "030610.KS":239,
  "294870.KS":240,
  "007390.KQ":241,
  "073240.KS":242,
  "007310.KS":243,
  "004000.KS":244,
  "012630.KS":245,
  "034230.KS":246,
  "065350.KQ":247,
  "281740.KQ":248,
  "195940.KQ":249,
  "085660.KQ":250,
  "000210.KS":251,
  "204270.KQ":252,
  "003090.KS":253,
  "000080.KS":254,
  "100090.KS":255,
  "213420.KQ":256,
  "003240.KS":257,
  "036830.KQ":258,
  "137400.KQ":259,
  "300720.KS":260,
  "280360.KS":261,
  "185750.KS":262,
  "009450.KS":263,
  "005300.KS":264,
  "000670.KS":265,
  "298050.KS":266,
  "108320.KS":267,
  "137310.KS":268,
  "293490.KQ":269,
  "248070.KS":270,
  "006120.KS":271,
  "035760.KQ":272,
  "100840.KS":273,
  "122870.KQ":274,
  "358570.KQ":275,
  "348370.KQ":276,
  "071320.KS":277,
  "253450.KQ":278,
  "004490.KS":279,
  "285130.KS":280,
  "484870.KS":281,
  "009240.KS":282,
  "225570.KQ":283,
  "082270.KQ":284,
  "086900.KQ":285,
  "114090.KS":286,
  "003030.KS":287,
  "112040.KQ":288,
  "001680.KS":289,
  "328130.KQ":290,
  "005180.KS":291,
  "376300.KQ":292,
  "067160.KQ":293,
  "039130.KS":294,
  "018290.KQ":295,
  "042000.KQ":296,
  "069500.KS":297,
  "122630.KS":298,
  "252670.KS":299,
  "102110.KS":300,
  "233740.KS":301,
  "251340.KS":302,
  "114800.KS":303,
  "229200.KS":304,
  "091160.KS":305,
  "305720.KS":306,
  "371460.KS":307,
  "360750.KS":308,
  "133690.KS":309,
  "379800.KS":310,
  "117460.KS":311,
  "0183J0.KS":312,
  "463250.KS":313,
  "381180.KS":314,
  "381170.KS":315,
  "379810.KS":316,
  "441680.KS":317,
  "132030.KS":318,
  "130680.KS":319,
  "305540.KS":320,
  "091170.KS":321,
  "192090.KS":322,
  "329200.KS":323,
  "232080.KS":324
};

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
  { symbol: "ALI=F", name: "알루미늄 (Aluminum)",  unit: "t" },
  { symbol: "ZW=F",  name: "미국 소맥 (Wheat)",    unit: "bu" },
  { symbol: "ZC=F",  name: "미국 옥수수 (Corn)",   unit: "bu" },
  { symbol: "ZS=F",  name: "미국 대두 (Soybean)",  unit: "bu" },
  { symbol: "KC=F",  name: "커피 C (Coffee C)",    unit: "lb" }
];
const COMMODITY_SYMBOLS = COMMODITIES.map(function(c){ return c.symbol; });
const COMMODITY_META = {};
for (const c of COMMODITIES) COMMODITY_META[c.symbol] = c;

// === [신규] 국채(Treasury/Bond) — 원자재처럼 별도 슬리브, 실시간 거래. 미국+한국만. ===
//   통화가 달라 계좌를 분리: bdus(USD, 무세금) / bdkr(KRW, 증권거래세). 전부 ETF(매매 가능).
//   거래시간: bdus=미국장, bdkr=한국장. 주식 swing 전략 신호/매도 로직 재사용.
const BONDS_US = [
  { symbol: "TLT",  name: "미국 장기국채 20년+ (TLT)" },
  { symbol: "IEF",  name: "미국 중기국채 7-10년 (IEF)" },
  { symbol: "SHY",  name: "미국 단기국채 1-3년 (SHY)" },
  { symbol: "GOVT", name: "미국 종합국채 (GOVT)" }
];
const BONDS_KR = [
  { symbol: "148070.KS", name: "KOSEF 국고채10년" },
  { symbol: "114260.KS", name: "KODEX 국고채3년" },
  { symbol: "152380.KS", name: "KODEX 국채선물10년" }
];
const BONDS = BONDS_US.concat(BONDS_KR);
const BOND_US_SYMBOLS = BONDS_US.map(function(b){ return b.symbol; });
const BOND_KR_SYMBOLS = BONDS_KR.map(function(b){ return b.symbol; });
const BOND_SYMBOLS = BONDS.map(function(b){ return b.symbol; });
const BOND_META = {};
for (const b of BONDS) BOND_META[b.symbol] = b;

// === [신규] 국채 금리(Treasury Yield) — 야후 지수 심볼(값=연수익률%). 조회 전용(매매 X). ===
//   ^IRX(13주=3개월)·^FVX(5년)·^TNX(10년)·^TYX(30년). 전 세계 금리 벤치마크.
//   한국 국고채 금리는 야후 직접 심볼이 부정확해 미국 금리만 표시(글로벌 기준).
const TREASURY_YIELDS = [
  { symbol: "^IRX", label: "3M",  name: "미국 3개월" },
  { symbol: "^FVX", label: "5Y",  name: "미국 5년" },
  { symbol: "^TNX", label: "10Y", name: "미국 10년" },
  { symbol: "^TYX", label: "30Y", name: "미국 30년" }
];
const TREASURY_YIELD_SYMBOLS = TREASURY_YIELDS.map(function(y){ return y.symbol; });

// === [FX] 환율 조회 대상 ===
//   야후 파이낸스 환율 심볼. 매일 06:30 KST 1회 갱신 (조회 전용 — 매매 없음).
//   "XXXKRW=X" = 1 XXX당 원화. "KRW=X" = 1달러당 원화. "JPY=X" = 1달러당 엔.
//   엔/원은 야후 직접 페어가 부정확할 수 있어 USD/KRW ÷ USD/JPY 로 파생 계산도 함께 제공.
const FX_PAIRS = [
  { key: "USDKRW", symbol: "KRW=X",     label: "달러/원",        sub: "USD/KRW",   unit: "₩" },
  { key: "JPYKRW", symbol: "JPYKRW=X",  label: "엔/원 (100엔)",  sub: "JPY/KRW",   unit: "₩", per100: true },
  { key: "USDJPY", symbol: "JPY=X",     label: "달러/엔",        sub: "USD/JPY",   unit: "¥" },
  { key: "GBPKRW", symbol: "GBPKRW=X",  label: "파운드/원",      sub: "GBP/KRW",   unit: "₩" },
  { key: "EURKRW", symbol: "EURKRW=X",  label: "유로/원",        sub: "EUR/KRW",   unit: "₩" },
  { key: "CNYKRW", symbol: "CNYKRW=X",  label: "위안/원",        sub: "CNY/KRW",   unit: "₩" },
  { key: "AUDKRW", symbol: "AUDKRW=X",  label: "호주달러/원",    sub: "AUD/KRW",   unit: "₩" },
  { key: "CADKRW", symbol: "CADKRW=X",  label: "캐나다달러/원",  sub: "CAD/KRW",   unit: "₩" },
  { key: "CHFKRW", symbol: "CHFKRW=X",  label: "스위스프랑/원",  sub: "CHF/KRW",   unit: "₩" },
  { key: "DXY",    symbol: "DX-Y.NYB",  label: "달러 인덱스",    sub: "DXY",       unit: "" }
];

// === 전략 식별자 ===
// [재작성] 단일 추세추종 전략 "trend"로 통합. 구 swing/momentum/meanrev/day 폐기.
//   기존 보유 포지션(strategy=swing 등)도 새 evaluateSell이 strategy 무관하게 청산 관리한다.
const STRATEGIES = ["trend", "scalp", "snap"];  // scalp: 분봉 단타 / snap: 상승추세 내 과매도 스냅백 (2~5일 스윙)
const LEGACY_STRATEGIES = ["swing", "momentum", "meanrev", "day"];  // 통계/호환 표시용

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

// [패닉 헤지] 인버스 ETF — 시장 하락 시 상승(수익). 시장 패닉/BEAR 차단에서 제외하고,
//   패닉장에서 오히려 진입을 허용·부스트해 하락장 수익·헤지를 노린다.
//   (인버스도 자체 추세정렬 게이트를 따르므로, 시장이 실제 하락추세일 때만 진입)
const INVERSE_ETF = new Set([
  "SOXS", "SQQQ", "SPXU", "SH", "PSQ", "SDS", "SDOW", "DOG", "RWM", "TZA", "FAZ", // 미국 인버스
  "252670.KS", "251340.KS", "114800.KS"  // 한국 인버스(KODEX 인버스·코스닥인버스·인버스2X)
]);

// === [섹터그룹] 19개 세부섹터를 6개 그룹으로 묶어 전문화. 주요 종목만 매핑(나머지는 OTHER=중립).
//   그룹별 성과를 누적해 베팅 크기를 차등(confidence처럼 사이즈만 조절 → 악화 방어).
//   미매핑 종목은 거래 정상, 차등만 없음. cfg.sectorGroupMapAdd로 확장 가능.
const SECTOR_GROUPS = ["TECH", "FINANCE", "HEALTH", "CONSUMER", "INDUSTRIAL", "RESOURCES", "OTHER"];
const SECTOR_GROUP_MAP = {
  // US TECH (전자기술·기술서비스·커뮤니케이션)
  "NVDA":"TECH","GOOGL":"TECH","GOOG":"TECH","AAPL":"TECH","MSFT":"TECH","AVGO":"TECH","META":"TECH","MU":"TECH","AMD":"TECH","INTC":"TECH","ORCL":"TECH","CSCO":"TECH","LRCX":"TECH","AMAT":"TECH","PLTR":"TECH","TXN":"TECH","KLAC":"TECH","QCOM":"TECH","ADBE":"TECH","CRM":"TECH","NOW":"TECH","IBM":"TECH","ANET":"TECH","SNPS":"TECH","CDNS":"TECH","NFLX":"TECH",
  // US FINANCE
  "BRK-B":"FINANCE","JPM":"FINANCE","V":"FINANCE","MA":"FINANCE","BAC":"FINANCE","MS":"FINANCE","GS":"FINANCE","WFC":"FINANCE","AXP":"FINANCE","C":"FINANCE","SCHW":"FINANCE","BLK":"FINANCE","SPGI":"FINANCE",
  // US HEALTH (의료기술·보건서비스)
  "LLY":"HEALTH","JNJ":"HEALTH","ABBV":"HEALTH","UNH":"HEALTH","MRK":"HEALTH","TMO":"HEALTH","ABT":"HEALTH","DHR":"HEALTH","PFE":"HEALTH","AMGN":"HEALTH","ISRG":"HEALTH","BMY":"HEALTH","VRTX":"HEALTH",
  // US CONSUMER (소매·소비재·소비자서비스)
  "AMZN":"CONSUMER","TSLA":"CONSUMER","WMT":"CONSUMER","COST":"CONSUMER","KO":"CONSUMER","PG":"CONSUMER","HD":"CONSUMER","PM":"CONSUMER","MCD":"CONSUMER","PEP":"CONSUMER","NKE":"CONSUMER","SBUX":"CONSUMER","TGT":"CONSUMER","LOW":"CONSUMER","DIS":"CONSUMER",
  // US INDUSTRIAL (제조·산업서비스·운송·방산)
  "CAT":"INDUSTRIAL","GE":"INDUSTRIAL","RTX":"INDUSTRIAL","GEV":"INDUSTRIAL","HON":"INDUSTRIAL","UNP":"INDUSTRIAL","BA":"INDUSTRIAL","LMT":"INDUSTRIAL","DE":"INDUSTRIAL","UPS":"INDUSTRIAL","GD":"INDUSTRIAL","MMM":"INDUSTRIAL","EMR":"INDUSTRIAL",
  // US RESOURCES (에너지·소재·유틸리티)
  "XOM":"RESOURCES","CVX":"RESOURCES","LIN":"RESOURCES","COP":"RESOURCES","SLB":"RESOURCES","NEE":"RESOURCES","SO":"RESOURCES","DUK":"RESOURCES","FCX":"RESOURCES","NEM":"RESOURCES",
  // KR TECH
  "005930.KS":"TECH","000660.KS":"TECH","402340.KS":"TECH","009150.KS":"TECH","035420.KS":"TECH","042700.KS":"TECH","017670.KS":"TECH",
  // KR FINANCE
  "105560.KS":"FINANCE","055550.KS":"FINANCE","086790.KS":"FINANCE","006800.KS":"FINANCE","032830.KS":"FINANCE",
  // KR HEALTH
  "207940.KS":"HEALTH","068270.KS":"HEALTH","196170.KQ":"HEALTH",
  // KR CONSUMER (자동차·가전 등)
  "005380.KS":"CONSUMER","000270.KS":"CONSUMER","012330.KS":"CONSUMER","066570.KS":"CONSUMER",
  // KR INDUSTRIAL (배터리·조선·방산·중공업·화학)
  "373220.KS":"INDUSTRIAL","006400.KS":"INDUSTRIAL","034020.KS":"INDUSTRIAL","329180.KS":"INDUSTRIAL","028260.KS":"INDUSTRIAL","012450.KS":"INDUSTRIAL","042660.KS":"INDUSTRIAL","064350.KS":"INDUSTRIAL","267260.KS":"INDUSTRIAL","010120.KS":"INDUSTRIAL","298040.KS":"INDUSTRIAL","047810.KS":"INDUSTRIAL","051910.KS":"INDUSTRIAL",
  // KR RESOURCES (철강·비철·유틸)
  "005490.KS":"RESOURCES","010130.KS":"RESOURCES","015760.KS":"RESOURCES"
};
// 종목 → 그룹 (cfg에 추가 매핑 있으면 우선). 미매핑은 OTHER.
function getSectorGroup(symbol, cfg) {
  if (cfg && cfg.sectorGroupMapAdd && cfg.sectorGroupMapAdd[symbol]) return cfg.sectorGroupMapAdd[symbol];
  return SECTOR_GROUP_MAP[symbol] || "OTHER";
}
// 그룹 성과 통계 → 가중치(0.6~1.3). 표본 적으면 shrinkage로 1.0 근처(과적합 방지).
//   weight = clamp(0.6, 1.3, 1 + k·(승률-0.5) + m·평균R), shrink = n/(n+N0)
function computeGroupWeight(stat, cfg) {
  const sg = (cfg && cfg.sectorGroups) || {};
  const n0 = sg.shrinkN != null ? sg.shrinkN : 20;     // 이 표본수에서 효과 절반
  const wMin = sg.weightMin != null ? sg.weightMin : 0.6;
  const wMax = sg.weightMax != null ? sg.weightMax : 1.3;
  if (!stat || !stat.trades || stat.trades < 1) return 1.0;
  const n = stat.trades;
  const winRate = stat.wins / n;
  const avgPnl = (typeof stat.sumPnlPct === "number") ? (stat.sumPnlPct / n) : 0;  // 평균 손익률(%)
  // 성과 스코어: 승률 편차 + 평균손익률. 평균손익(기대값)이 핵심.
  let raw = 1 + 0.6 * (winRate - 0.5) + 0.05 * avgPnl;  // avgPnl +5% → +0.25
  const shrink = n / (n + n0);                          // 표본 적으면 1.0으로 당김
  let w = 1 + (raw - 1) * shrink;
  if (w < wMin) w = wMin;
  if (w > wMax) w = wMax;
  return w;
}

// [섹터그룹 autoTune] 누적 통계로 그룹 가중치를 재계산해 cfg.sectorGroups.weights에 주입.
//   매 거래 사이클 호출 → 잘 되는 그룹 가중치↑, 안 되는 그룹↓ (표본 부족 그룹은 1.0 고정).
//   가중치는 별도 저장 안 함(통계만 저장, 가중치는 파생) → cfg 저장 충돌 없음.
async function applySectorGroupWeights(DB, cfg) {
  try {
    const sg = cfg.sectorGroups;
    if (!sg || sg.enabled === false) return;
    const gs = await getState(DB, "sector_group_stats", {});
    const minT = sg.minTradesToWeight != null ? sg.minTradesToWeight : 8;
    if (!sg.weights || typeof sg.weights !== "object") sg.weights = {};
    for (const grp of SECTOR_GROUPS) {
      const stat = gs[grp];
      sg.weights[grp] = (stat && stat.trades >= minT) ? computeGroupWeight(stat, cfg) : 1.0;
    }
  } catch (e) {}
}

// [신호타입 가중치] 진입신호 종류별(TR_PULLBACK/TR_BREAKOUT) 성과로 베팅 크기 차등.
//   섹터그룹과 동일한 메커니즘 — 잘 되는 신호에 더 베팅. shrinkage로 적은 표본 보호.
const SIGNAL_TYPES = ["TR_PULLBACK", "TR_BREAKOUT"];
function computeSignalWeight(stat, cfg) {
  const sw = (cfg && cfg.signalTypeWeights) || {};
  const n0 = sw.shrinkN != null ? sw.shrinkN : 15;
  const wMin = sw.weightMin != null ? sw.weightMin : 0.7;
  const wMax = sw.weightMax != null ? sw.weightMax : 1.3;
  if (!stat || !stat.trades || stat.trades < 1) return 1.0;
  const n = stat.trades;
  const winRate = stat.wins / n;
  const avgPnl = (typeof stat.sumPnlPct === "number") ? (stat.sumPnlPct / n) : 0;
  let raw = 1 + 0.6 * (winRate - 0.5) + 0.05 * avgPnl;
  const shrink = n / (n + n0);
  const w = 1 + (raw - 1) * shrink;
  return Math.max(wMin, Math.min(wMax, w));
}
async function applySignalTypeWeights(DB, cfg) {
  try {
    const sw = cfg.signalTypeWeights;
    if (!sw || sw.enabled === false) return;
    const ss = await getState(DB, "signal_type_stats", {});
    const minT = sw.minTradesToWeight != null ? sw.minTradesToWeight : 10;
    if (!sw.weights || typeof sw.weights !== "object") sw.weights = {};
    for (const name of SIGNAL_TYPES) {
      const stat = ss[name];
      sw.weights[name] = (stat && stat.trades >= minT) ? computeSignalWeight(stat, cfg) : 1.0;
    }
  } catch (e) {}
}

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
  marketCrashPct: -4.0,
  feeUS: 0.0001,
  feeKR: 0.00015,
  krSellTax: 0.0018,
  maPeriod: 20, maShortPeriod: 5,
  atrPeriod: 14, atrStopMult: 2.0,
  bbStdMult: 2.0,
  volSpikeMult: 1.5,
  dailyCacheMinutes: 75,   // [PAID] 75분 캐시. Paid 1000 subreq 여유 활용해 더 자주 갱신
  maxDailyRefreshPerCycle: 75, // [PAID] 사이클당 75종목 → 854종목 전순환 ~12분 (Paid 여유 활용)
  // [PAID 가드] Workers Paid 한도 초과 과금 방지 — 85% 도달 시 자동 셧다운 (15% 버퍼)
  usageLimits: {
    enabled: true,
    monthlyRequests: 10000000,  // Paid 포함량 ($5/month)
    monthlyCpuMs: 30000000,     // Paid 포함량
    shutdownAt: 0.85,           // [강화] 0.90→0.85: 추가과금 방지 버퍼 확대
    warnAt: 0.65,               // [강화] 0.70→0.65: 조기 경보
    cpuCalibration: 0.10        // CPU 추정 보정 (대시보드 실측 대비 조정)
  },
  // [실시간] 분(分) 내 빠른 포지션 감시 — 한 invocation에서 sleep 서브틱으로 보유 포지션의
  //   손절/트레일/익절을 ~10초 간격 재점검. 추가 cron/DO/외부피드 없이 반응속도 1분→~10초.
  //   sleep은 CPU 비소모 → 비용 영향 최소. subrequest는 서브틱당 시장별 1배치(≤50종목).
  fastWatch: {
    enabled: true,
    ticks: 3,             // invocation당 최대 서브틱 수
    intervalMs: 9000,     // 서브틱 간격(~9초)
    maxSymbols: 50,       // 폴링 대상 상한 (1 배치=1 subrequest)
    maxElapsedMs: 52000   // invocation 총 경과 상한 (다음 cron과 겹침 방지)
  },
  // [분봉] 진입 직전 장중 타이밍 확인 — 후보 종목에만 분봉 1회 조회(전 종목 X)
  //   장중 급락 칼날잡기·VWAP 추격매수를 차단해 진입 품질 향상. fetch는 maxPerCycle로 통제.
  intradayConfirm: {
    enabled: true,
    interval: "5m",        // 5분봉 (1m은 노이즈↑)
    momMin: -1.5,          // 최근 3봉(15분) 수익률 ≤ -1.5%면 진입 차단
    vwapMaxPct: 3.5,       // 가격이 VWAP보다 +3.5% 초과면 추격으로 보고 차단
    vwapBoostPct: 0.5,     // 가격이 VWAP ±0.5% 이내: 최적 진입대 → confidence boost
    momBoostMin: 0.8,      // recentMom ≥ 0.8%: 분봉 상승추세 확인 → 진입 강화
    maxPerCycle: 60        // [PAID] 0.90→60: Paid subreq 여유 활용해 더 많은 분봉 확인
  },
  initialCashUS: 100000, initialCashKR: 100000000,
  initialCashCM: 100000,   // [COMMODITY] 원자재 초기 보유 금액 $100,000 (USD)
  initialCashBDUS: 100000,    // [BOND] 미국 국채 슬리브 초기금액 $100,000 (USD)
  initialCashBDKR: 100000000, // [BOND] 한국 국채 슬리브 초기금액 ₩100,000,000 (KRW)
  altRealtime: true,          // [BOND/CM] 원자재·국채 실시간 거래(매 사이클). false면 비활성
  altEnrichMaxUsageRatio: 0.82, // [예산] 월 사용량 이 비율 초과 시 alt 슬리브(원자재·국채)는 주식보다 먼저 양보
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
    // [V15] 0.8→1.6: 집중투자 전환. 종목당 budget = cash×riskPct/stopDist 이므로
    //   stop 4% 기준 riskPct 1.6이면 종목당 현금의 ~40% 이론치 → 포트비중 캡(아래)으로 상한 관리.
    riskPerTrade: 1.6,
    minRisk: 0.8,            // [V15] 0.25→0.8: weak signal도 floor가 받쳐 잘게 쪼개지지 않음
    maxRisk: 2.2,            // [V15] 1.0→2.2: strong signal은 크게
    fallbackToLegacy: false,
    byStrategy: {
      momentum: { riskPerTrade: 1.8, minRisk: 0.9, maxRisk: 2.4 }  // [V15] 모멘텀 돌파는 더 공격적
    }
  },
  // === [V15] 포트폴리오 비중 기반 사이징 — 집중투자 + 현금 적극 소진 ===
  //   기존 riskBasedSizing은 budget을 "현금" 기준으로만 잡아, signal.weight가 낮으면
  //   floor(0.25%)로 떨어져 포트의 3~4%로 잘게 쪼개졌다(현금 66% 방치).
  //   여기서는 "포트폴리오 총액" 기준으로 종목당 목표/상한 비중을 강제한다.
  portfolioSizing: {
    enabled: true,
    minPortfolioPct: 7,    // 종목당 최소 포트의 7% (이보다 작게 계산되면 끌어올림)
    maxPortfolioPct: 13,   // 종목당 최대 포트의 13% (과집중 방지 상한)
    cashReservePct: 12,    // 현금을 포트의 12%까지 소진 허용 → cashCap 동적 산정
    // day 전략은 회전이 빨라 비중 절반만 — 약전략 과집중 방지
    dayScale: 0.5
  },
  // === [V12] 폭락장 생존 (Crash Survival) — 포트폴리오 차원 방어 레이어 ===
  //   기존 방어는 모두 "개별 종목 매수 시점 필터"(MARKET_CRASH/FALLING_KNIFE/VOL_SPIKE).
  //   여기서는 그 위에 4개의 계좌 전체 차원 가드를 얹는다. 모두 cfg로 끄고 켤 수 있다.
  crashSurvival: {
    enabled: true,
    // (1) 포트폴리오 드로다운 서킷브레이커 — equity 고점 대비 낙폭 단계별 대응.
    //   l1: 신규매수 사이즈 축소, l2: 신규매수 전면중단, l3: 트레일링 강제 타이트닝.
    drawdown: {
      enabled: true,
      l1Pct: 6,    // 고점 대비 -6% → 신규 진입 사이즈 ×l1SizeScale
      l2Pct: 12,   // 고점 대비 -12% → 신규 진입 전면 중단(보유는 유지·관리)
      l3Pct: 18,   // 고점 대비 -18% → 트레일링 드롭폭 강제 축소(이익 방어 극대화)
      l1SizeScale: 0.5,
      l3TrailDropScale: 0.5,   // trailDropPct를 절반으로(피크 근처에서 빨리 청산)
      recoverPct: 4            // 고점 대비 낙폭이 이 값 이내로 회복되면 게이트 해제
    },
    // (2) 연속 손실 쿨다운 — 최근 거래에서 손절이 몰리면 잠시 신규매수 중단.
    lossStreak: {
      enabled: true,
      lookbackTrades: 15,      // [V9.8] 12→15 (창을 넓혀 단발 클러스터의 비중을 낮춤)
      maxLosses: 10,           // [V9.8] 7→10 (한 번의 손절 묶음으로 쉽게 안 켜지게)
      pauseMinutes: 45         // [V9.8] 90→45 (전면 차단 승격 시에도 봉쇄 시간 단축)
    },
    // (3) 패닉 게이트 — 지수 동시 급락(당일) 시 전 신규진입 차단.
    //   worstDayPct는 가장 약한 지수 1개라 노이즈가 있어, "평균 지수 낙폭"으로 판단.
    panic: {
      enabled: true,
      avgDropPct: -4.0,        // 지수 평균 당일 낙폭이 이 값 이하면 패닉 (-2.5→-4.0 완화)
      panicSizeScale: 0.4,     // 패닉 시 완전차단 대신 사이즈 40%로 축소 (저가매수 허용)
      requireBear: false       // true면 레짐 BEAR일 때만 패닉 게이트 적용
    },
    // (4) 폭락 디리스킹 — 패닉/딥드로다운 중에는 보유 포지션 손절·트레일을 자동 타이트닝.
    deRisk: {
      enabled: true,
      hardStopScale: 0.7,      // 하드스톱 폭을 70%로 축소(더 빨리 손절)
      trailDropScale: 0.6      // 트레일 드롭폭 60%로 축소
    }
  },
  // === [V8.5] disabled signal 재평가 ===
  signalReviewDays: 30,      // 비활성화 후 N일 경과 시 재활성화 후보
  // === [V13] autoTune 강화 설정 ===
  //   기존 autoTune(RSI/stop/TP/swingSize 시장별 조정)에 얹는 상위 제어 레이어.
  autoTuneV13: {
    enabled: true,
    // (A) 긴급 가드레일 — 10건 정기튠을 기다리지 않고, 최근 짧은 윈도우가 급격히 나빠지면 즉시 보수화.
    panicTune: {
      enabled: true,
      window: 6,             // 최근 매도 N건
      lossThresh: 5,         // 그중 손실 N건 이상이면
      stopTightenStep: 0.5,  // stopLoss 즉시 -0.5%p (floor까지)
      sizeScaleStep: 0.85    // swing base 사이즈 ×0.85
    },
    // (B) regime 전환 즉시 재튠 — BULL↔BEAR 바뀌면 10건 대기 없이 1회 튠 허용.
    regimeShiftRetune: true,
    // (C) strategy별 사이즈 자동 조정 — momentum/meanrev도 성과로 base 조정.
    perStrategySizing: {
      enabled: true,
      minTrades: 12,
      goodWR: 0.55, goodPnl: 1.5, upStep: 1,   // 성과 좋으면 base +1
      badWR: 0.38, badPnl: -0.8, downStep: 1,  // 나쁘면 base -1
      baseMin: 8, baseMax: 35
    },
    // (D) strategy 자동 비활성화 — 한 전략이 표본 충분 & expectancy 크게 음수면 끔(재평가까지).
    strategyAutoDisable: {
      enabled: true,
      minTrades: 25,
      expectancyOff: -0.5,   // 기대값 이 값 미만이면 OFF 후보
      winRateOff: 0.33,
      reviewDays: 21         // N일 후 재평가
    },
    // (E) 드로다운 연동 리스크 — equity 고점 낙폭에 따라 riskPerTrade 동적 축소.
    drawdownRisk: {
      enabled: true,
      ddTrigger: 8,          // 고점 대비 -8%부터
      riskFloor: 0.4,        // riskPerTrade 최저 (이 값까지 축소)
      perPctRiskCut: 0.04    // 낙폭 1%p당 riskPerTrade -0.04 (8% 초과분에 비례)
    },
    // (F) 변경폭 클램프 & 진동 방지 — 한 파라미터가 한 번에 과하게 안 움직이고, 같은 키를 너무 자주 안 뒤집음.
    clamp: {
      maxStopStep: 1.0,      // stopLoss 1회 변경 상한(%p)
      oscillationCooldownTunes: 2  // 같은 키 반대방향 변경은 N회 튠 경과 후만
    }
  },
  // === [V8.6 Hybrid] Claude LLM 일일 지시 ===
  llmHybrid: {
    enabled: true,            // [V11] 기본 ON — API 키만 등록되면 작동 (키 없으면 자동으로 V8.5 폴백)
    model: "claude-haiku-4-5-20251001", // [V9.0] 버전 고정(alias→full ID). haiku로 충분, 토큰 단가·지연 절감
    maxTokens: 1200,          // [V9.7] 3000→1200. reasoning 축소(아래 includeReasoning=false) 후 실측 출력 800~1000토큰이면 충분
    includeReasoning: false,  // [V9.7] reasoning 5필드(거래 로직 미사용·로깅용) 출력 생략 → 출력 토큰 절반↓. 사후검증은 summary 한 줄로 충분
    compactContext: true,     // [V9.7] 프롬프트 컨텍스트를 압축 JSON(들여쓰기 제거)으로 전송 → 입력 토큰 20~30%↓
    skipIfQuietPct: 0.5,      // [V9.7] 전일 대비 worst 지수변동 절댓값이 이 값 미만이면 LLM 호출 스킵, 직전 지시 재사용(만료 전). 0으로 두면 항상 호출
    confidenceWeighting: true, // [V9.1] LLM confidence로 sizing 개입 강도 조절 (낮으면 보수적)
    timeoutMs: 75000,         // [V9.9] 30→75s. 이 엣지 경로에서 응답이 40~60s까지 늘어져 짧은 타임아웃은 완주 못함. 코드(Math.max 75s)에서 강제하므로 stored cfg 무관.
    maxRetries: 1,            // [V9.9] 1회만. 긴 타임아웃 1회로 완주가 핵심(재시도가 오히려 성공 직전 호출을 끊었음).
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
  // === [SEC] EDGAR 공시 기반 보수적 거래 필터 (미국 종목 한정, 무료 API) ===
  //   최근 8-K(material event)/어닝 직후 종목은 신규 진입 사이즈를 축소(secCautionScale).
  //   장외(UTC 08:00~08:30)에만 fetch → 거래 fetch와 분리.
  secFilings: {
    enabled: true,
    cautionScale: 0.5,        // 악재(공시후 하락) 시 진입 사이즈 배수 (0.5 = 절반)
    positiveThreshold: 2.0,   // 공시후 +2%↑ → 호재로 보고 진입 강화(부스트 시작)
    negativeThreshold: -2.0,  // 공시후 -2%↓ → 악재로 보고 축소
    positiveBoostMax: 1.2     // 호재 부스트 상한 (postReturn 비례, 최대 ×1.2)
  },
  // === [Vision AI] Roboflow 차트예측 — 백엔드/거래 기본값 (프론트도 동일 키 저장) ===
  visionAI: {
    enabled: true,
    rfApiKey: "WLMMRNV8GDpmbjEcrFar",
    rfVersion: 7,
    confMin: 0.6,
    monthlyBudget: 10000   // 무료 Public 플랜 월 한도
  },
  // === [신규·인터마켓] 시장 컨텍스트 (risk-on/off) — 외부 자산으로 위험선호 측정 ===
  //   HYG(신용)·BTC(위험심리)·UUP(달러)·^VIX9D(공포)·TLT(안전자산)를 1 batch quote로 수집.
  //   [예산 안전] 캐시(refreshMinutes) + 월 사용량 enrichMaxUsageRatio(코어 셧다운보다 낮음) 초과 시
  //   enrichment 자동 중단 → 한도 여유분 항상 보장. risk-off면 신규매수 축소, risk-on이면 소폭 확대.
  marketContext: {
    enabled: true,
    symbols: ["HYG", "BTC-USD", "UUP", "^VIX9D", "TLT"],
    refreshMinutes: 12,
    enrichMaxUsageRatio: 0.75,
    minBudgetReserve: 8,
    riskOffScale: 0.6,
    riskOnBoost: 1.12
  },
  // === [V8.5] 사이클 락 자동 갱신 ===
  cycleLockRefreshAt: 0.5,   // TTL의 50% 경과 시 갱신
  // === 전략 활성화 ===
  //   scalp: 분봉 기반 단타 전략 (기본 OFF — 설정에서 활성화)
  strategies: {
    trend: true,
    scalp: true,  // [V50] 분봉 단타 활성화 (KR 포함 — scalpRules.usOnly=false)
    snap: true    // [V52] 스냅백(상승추세 내 과매도 단기반등) 활성화
  },
  // [V51] 전략별 사이클 예산 분리 — trend/scalp가 같은 현금풀을 두고 경쟁해 단타가 굶던 문제 해결.
  //   각 시장 가용현금을 비율로 쪼개 전략별 독립 예산으로 사용. 대시보드 슬라이더로 조절.
  // [V52] 3분할 — trend/scalp/snap 기본 35/30/35.
  strategyBudgetSplit: { trend: 0.35, scalp: 0.30, snap: 0.35 },
  // === [SCALP] 단타 전략 룰 — 분봉 기반 장중 단타 ===
  //   추세추종(일봉)과 완전 분리: 진입·관리·청산 모두 분봉 기준.
  //   일봉: MA20>MA50 (약 추세 확인) + 일봉 과열 아님(RSI≤72)
  //   분봉: VWAP 돌파 진입 또는 장중 눌림목 반등
  scalpRules: {
    // 일봉 추세 조건 (느슨 — 단타는 추세 방향만 맞으면 됨)
    rsiMax: 70,              // [강화] 72→70 일봉 RSI 상한 (과열 진입 더 차단 → 승률↑)
    rsiMin: 38,              // [V50완화] 42→38 일봉 RSI 하한
    maFastPeriod: 20,        // 일봉 MA20 > MA50 추세 확인
    maSlowPeriod: 50,
    // [신규] 품질 게이트 — 승률 개선의 핵심
    requirePriceAboveMaFast: true,  // 일봉 종가가 MA20 위일 때만 (추세 상단)
    minDayMomPct: -1.5,      // [V50완화] -1.0→-1.5 당일 급락 차단 문턱
    adxMin: 15,              // [V50완화] 20→15 추세 강도 문턱 (신호 증가)
    minRelVol: 1.1,          // [V50완화] 1.2→1.1 분봉 상대거래량 문턱
    // 분봉 진입 조건
    vwapBand: 0.8,           // [강화] 1.0→0.8 VWAP 더 가까이서만 진입(추격 비용↓)
    momEntry: 0.4,           // [강화] 0.3→0.4 분봉 모멘텀 더 확실할 때만
    momStrong: 1.5,          // recentMom ≥ 1.5%: 강한 모멘텀 → 더 작은 포지션(추격 방지)
    pullbackEnabled: true,   // [신규] VWAP 눌림목 반등 진입 — 추격 대신 되돌림에서 진입(수익률↑)
    pullbackVwapMin: -1.2,   // VWAP −1.2%까지 눌렸다가
    pullbackBounce: 0.25,    // 직전 분봉 대비 +0.25% 반등 시 진입
    // 청산 조건 (빠른 손절·익절 + 분할익절·본전락)
    stopLossPct: 1.2,        // [강화] 1.5→1.2 손절 타이트(손실폭↓ → 손익비 개선)
    tp1Pct: 1.2,             // [신규] +1.2% 도달 시 절반 익절 + 손절 본전 이동(BE락)
    takeProfit: 3.0,         // [V51강화] 2.5→3.0 잔량 최종 익절(추세 지속 수익 극대화)
    trailActivatePct: 1.2,   // [신규] +1.2% 이상에서만 트레일 작동(조기 청산 방지)
    trailPct: 0.7,           // [강화] 1.0→0.7 트레일 타이트(이익 보호 강화)
    breakEvenLock: 0.1,      // [신규] TP1 후 손절을 본전+0.1%로 → 무손실 런너 (executeSell이 참조)
    timeStopMinutes: 40,     // [강화] 45→40 더 빠른 죽은돈 회수
    timeStopMinPnl: 0.4,     // [강화] 0.3→0.4
    // 포지션 크기
    maxPositionPct: 6,       // 포트의 최대 6%
    riskPerTrade: 0.5,       // 손실 리스크 = 포트의 0.5%
    // === [V52 강화] 단타 품질 게이트 ===
    avoidOpenMinutes: 15,    // 개장 후 N분간 진입 금지 (오프닝 노이즈·갭 변동 회피) — 패닉 단타는 면제
    avoidCloseMinutes: 20,   // 마감 N분 전 진입 금지 (청산 시간 부족 → 오버나이트 리스크 방지)
    dailyLossLimitPct: 1.5,  // 당일 scalp 청산 PnL%(합) ≤ -N% → 그날 scalp 신규진입 중단 (틸트 방지, 시장별)
    reEntryCooldownMin: 60,  // 같은 종목 scalp 손절 후 N분간 재진입 차단 (연속 칼날 방지)
    requireVwapSlopeUp: true,// SC_VWAP/SC_MOMENTUM 진입 시 VWAP 기울기 ≥ 0 요구 (하락 VWAP 추격 차단; 눌림목/패닉은 면제)
    // [V50] 단타 KR 허용 — 야후 1분봉 15분 지연 있으나, 패닉장 인버스/캡출 단타 작동 위해 개방.
    //   지연 영향이 큰 건 일반 모멘텀 추격이고, 인버스 추세추종은 지연 영향이 작다.
    usOnly: false
  },
  // === [V52 신규 전략] SNAP — 상승추세 내 단기 과매도 스냅백 (Connors RSI-2 계열, 2~5일 스윙) ===
  //   TREND(추세 순응 진입)·SCALP(분봉 장중)와 직교하는 세 번째 수익원:
  //   "장기 상승추세가 살아있는 종목이 단기(2~5일) 과매도로 눌렸을 때 평균회귀 반등을 먹는다."
  //   진입은 약세를 사지만, 장기추세 게이트(price>MA200, MA50>MA200)와 BEAR 레짐 차단으로
  //   '하락장 칼날잡기'(과거 meanrev 실패 원인)를 구조적으로 배제한다. 데이터: 일봉만(추가 fetch 0).
  snapRules: {
    rsi2Max: 10,             // RSI(2) ≤ N → 단기 과매도 (핵심 트리거)
    rsi14Max: 50,            // RSI(14) 상한 — 중기도 식어있어야(추세 고점 눌림만)
    requireBelowMa5: true,   // 종가 < MA5 (눌림 확인)
    downDaysMin: 2,          // 최근 연속 하락일 ≥ N (투매 확인, rsi2와 AND가 아닌 OR 보조)
    dayDropMin: -4.0,        // 당일 등락 하한 — 이보다 급락이면 칼날로 보고 제외
    pullbackFromHighMax: 12, // 20일 고점 대비 -N% 이내 눌림만 (추세 붕괴 배제)
    maxAtrPct: 5,            // 고변동 종목 제외
    blockInBear: true,       // BEAR 레짐 진입 금지 (역추세성 전략의 최대 리스크 차단)
    // 청산 (평균회귀 — 빨리 먹고 빨리 나온다)
    atrStopMult: 1.5,        // 손절 = entry − 1.5×ATR (executeBuy 참조; trend 2.0보다 타이트)
    stopLossPct: 3.5,        // % 손절과 비교해 타이트한 쪽 (trend 5.0보다 타이트)
    exitAboveMa5: true,      // 종가 > MA5 → 평균회귀 완료, 전량 익절
    exitRsi2: 65,            // RSI(2) ≥ N → 과매도 해소, 전량 익절
    takeProfitPct: 5.0,      // 하드 익절 상한
    tp1Pct: 2.0,             // +2% 도달 시 절반 익절 + 본전락 (BE)
    breakEvenLock: 0.1,
    timeStopDays: 5,         // 5거래일 내 본전 미만 → 청산 (평균회귀 실패 = 빠른 철수)
    timeStopMinPnl: 0.0,
    // 사이징 — 역추세성이라 trend(0.75%)보다 작게
    riskPerTrade: 0.5,
    maxPositionPct: 8,
    maxConcurrent: 6,        // snap 동시 보유 상한 (시장별)
    krRiskScale: 0.7,        // KR 15분 지연 시세 → 리스크 추가 축소
    reEntryCooldownHours: 12 // snap 손절 후 재진입 차단 (시간)
  },
  // === [SCALP-PANIC] 패닉/베어장 전용 단타 룰 — "패닉 때도 단타로 번다" ===
  //   평시 scalp는 상승추세 종목만 노려 패닉장엔 신호가 0이 된다.
  //   패닉/베어(isPanic 또는 BEAR+지수급락)일 때만 아래 두 진입을 추가로 허용:
  //     (A) 인버스 ETF 모멘텀 — 시장하락=인버스상승. 추격문턱을 낮춰 하락장 수익을 적극 포착.
  //     (B) 캡출레이션 바운스 — 투매로 급락한 일반 종목의 V자 반등을 아주 짧게(타이트 손절) 먹는다.
  //   청산은 표준 scalpRules(빠른 손절·TP1 본전락·트레일·타임스톱)를 그대로 재사용한다.
  scalpPanicRules: {
    enabled: true,
    // 패닉 중 scalp 사이즈가 crashGate(×0.4)에 과도히 눌리지 않게 하한을 둔다(리스크 자체가 작음).
    sizeScaleFloor: 0.6,
    // (A) 인버스 ETF — 하락장 추세추종 단타
    inverse: {
      momEntry: 0.25,        // 분봉 모멘텀 진입 문턱(평시 0.4 대비 완화 — 하락장 추종 적극화)
      vwapBand: 1.5,         // VWAP ±1.5% 이내(추세 추종이라 평시보다 넓게)
      confidence: 0.8
    },
    // (B) 캡출레이션 바운스 — 투매 후 강반등 단타(일반 종목)
    capitulation: {
      enabled: true,
      dayDropMax: -1.5,      // [V51완화] -3.0→-1.5 당일 급락 문턱(BEAR 약조정·반등 종목도 바운스 단타)
      vwapBelowMin: -3.0,    // VWAP 대비 -3%~0% 아래로 이탈한 구간에서
      bounceMinPct: 0.6,     // 직전 분봉 +0.6%↑ 강반등(데드캣 약반등 배제)
      twoBarConfirm: true,   // 직전 2봉이 무너지지 않음(1봉 페이크 반등 회피 → 승률↑)
      minRelVol: 1.5,        // 분봉 거래량 1.5배↑(투매→매수유입 확인, 핵심)
      confidence: 0.75
    }
  },
  // === [재작성] TREND 전략 룰 — 추세 정렬 진입 + 고정리스크 + 분할익절/트레일 ===
  trendRules: {
    maShort: 20, maMid: 50, maLong: 200,   // 추세 정렬 기준 이동평균
    breakoutDays: 20,                       // 신고가 돌파 기준일
    volMult: 1.25,                          // [V50완화] 1.35→1.25 돌파 거래량 배수
    rsiPullbackMin: 35, rsiPullbackMax: 70, // [V50완화] 37~68→35~70 풀백 RSI 밴드 확대
    rsiBreakoutMax: 77,                     // [V50완화] 75→77 돌파 RSI 상한
    pullbackBandPct: 5,                     // [V50완화] 4→5 MA20 ±N% 풀백 밴드 확대
    bearBlockWorstPct: -2.5,                // [V50] BEAR 신규진입 차단 임계 — 지수 당일 worst가 이보다 낮을 때만 차단(인버스 면제). 기존 하드코딩 -1.5에서 완화.
    maxAtrPct: 6,                           // ATR%가 이보다 크면 진입 금지(슬리피지 회피)
    atrStopMult: 2.0,                       // 손절 = entry − N×ATR (executeBuy가 참조)
    stopLossPct: 5.0,                       // ATR 손절과 비교해 더 타이트한 쪽 채택 (executeBuy가 참조)
    trailAtrMult: 2.5,                      // 트레일 = peak − N×ATR
    tp1AtR: 1.0,                            // +1R 도달 시 분할익절
    tp1SellFrac: 0.4,                       // [V51] +1R 익절 비율 (0.4=40%만 익절, 60%는 트레일 추종)
    tp2AtR: 2.0,                            // +2R 도달 시 잔량 절반 추가 익절 (0 = 비활성)
    reEntryCooldownHours: 24,               // 손절 손실 전량청산 후 재진입 차단 시간 (0 = 비활성)
    timeStopDays: 10,                       // N거래일 내 +0.5R 미달 시 청산
    timeStopMinR: 0.35,                     // [V51완화] 0.5→0.35 성급한 횡보청산 완화(추세 발현 여유)
    exitBelowMa: 20,                        // 종가가 MA20 하향 이탈 시 청산
    // [확실성] 추세 강도 기반 신호 confidence — 불확실(약추세) 진입은 리스크를 줄인다.
    //   사이즈를 줄이는 방향으로만 작동 → 기존보다 더 크게 베팅하는 일이 없어 악화 불가.
    confEnabled: true,
    confStrongPct: 4.0,                     // 추세강도(MA정렬 합산%) ≥ 이면 confidence 1.0(그대로)
    confWeakPct: 1.5,                       // ≤ 이면 confMin까지 축소
    confMin: 0.5,                           // confidence 하한(리스크 축소 최대폭 = 절반)
    // === 분산 매도 감지 (거래량 급증+하락 → 기관 분산 차단) ===
    distDetectEnabled: true,
    distDetectVolMult: 2.5,                 // 20일 평균 대비 거래량 배수 (이 이상 + 하락 → 차단)
    distDetectMinDrop: 0.5,                 // 최소 하락폭 % (노이즈 제거)
    // === [신규 전략 C] TR_SQUEEZE — 변동성 수축(스퀴즈) 해소 돌파 ===
    squeezeEnabled: true,
    squeezeBbMult: 2.0,                     // 볼린저밴드 표준편차 배수
    squeezeKcMult: 1.5,                     // 켈트너채널 ATR 배수 (BB가 이 안에 갇히면 스퀴즈)
    squeezeVolMult: 1.3,                    // 해소 돌파 시 거래량 배수
    // === [신규 전략 D] TR_RS_LEADER — 상대강도 리더 풀백 (모멘텀 팩터) ===
    rsLeaderEnabled: true,
    rsLeaderRsMin: 5,                       // 지수 대비 20일 초과수익(%p) 하한 — 주도주 선별
    rsLeaderMomMin: 10,                     // 절대 60일 모멘텀(%) 하한
    rsLeaderPbBand: 3,                      // MA10 ±N% 풀백 밴드(얕은 눌림목)
    rsLeaderRsiMin: 45,
    rsLeaderRsiMax: 78,                     // 리더는 과열 허용폭 넓게(강모멘텀 지속)
    // === [강화] 승자 장기보유 — 깊은 수익 구간 트레일 확대(상방만, 손절폭 불변) ===
    runnerWidenEnabled: true,
    runnerR1: 3, runnerWiden1: 1.25,        // +3R↑ → 트레일 ×1.25
    runnerR2: 5, runnerWiden2: 1.5,         // +5R↑ → 트레일 ×1.5 (큰 추세 끝까지)
    // === [V52] 신규 유입 정보 활용 — 시가(갭)·종가위치(CLV)·주봉 정합 (전부 사이즈 조절만, 차단 없음 → 악화 불가) ===
    gapFilterEnabled: true,
    gapMaxPct: 3.0,                         // 당일 시가가 전일 종가 대비 +N% 초과 갭업 돌파 → 추격 비용↑
    gapScale: 0.7,                          //   → 사이즈 ×0.7 (갭업 돌파는 되돌림 확률 높음)
    clvEnabled: true,                       // CLV = (종가-저가)/(고가-저가): 일중 매수 강도
    clvStrongMin: 0.7, clvStrongScale: 1.06,//   종가가 고가 부근(강한 마감) → 소폭 부스트
    clvWeakMax: 0.35, clvWeakScale: 0.85,   //   윗꼬리 마감(분산 흔적) → 축소
    weeklyAlignEnabled: true,               // 주봉 종가 > 주봉 MA10 정합 — 상위 시간프레임 확인
    weeklyMisalignScale: 0.8                //   미정합 시 사이즈 ×0.8 (차단 아님)
  },
  // === [KR 분리] TREND 룰 — KR 시장 전용 오버라이드 ===
  //   여기 정의한 키만 trendRules(US 기본값)를 덮어쓴다. 누락 키는 US값 상속.
  //   근거: KR은 15분 지연 시세(칼날잡기 위험)·증권거래세 → US보다 보수적으로.
  trendRulesKR: {
    atrStopMult: 1.7,                       // 2.0→1.7 (손절 타이트)
    stopLossPct: 4.0,                       // 5.0→4.0
    trailAtrMult: 2.0,                      // 2.5→2.0 (이익 보호 빠르게)
    maxAtrPct: 5,                           // 6→5 (고변동 종목 회피)
    rsiBreakoutMax: 68,                     // 72→68 (과열 진입 더 차단)
    timeStopDays: 7                         // 10→7 (지연시세, 빨리 정리)
  },
  // === 에퀴티 커브 필터 — 시스템 성능 저하 시 사이즈 자동 축소 ===
  //   최근 N건 청산 PnL 합계가 음수 → crashGate.sizeScale 추가 축소.
  //   시장 하락(VIX/Breadth)과 독립적인 "시스템 성능 지표" 기반 보호.
  equityCurveFilter: {
    enabled: true,
    lookback: 15,       // 최근 N건 청산 거래
    threshold1: -5.0,   // PnL 합계 ≤ -5% → scale1 적용 (심각)
    scale1: 0.65,
    threshold2: -2.5,   // PnL 합계 ≤ -2.5% → scale2 적용 (경고)
    scale2: 0.80
  },
  // === [재작성] 고정리스크 사이징 (균형) ===
  trendSizing: {
    riskPerTrade: 0.75,    // 한 거래 최대손실 = 자산의 0.75%
    maxPositionPct: 15,    // 한 종목 비중 상한 = 자산의 15%
    maxConcurrent: 12      // [확대] 8→12 동시 보유 종목 상한 (거래·데이터 축적↑, 분산도 개선)
  },
  // [포트폴리오 히트] 보유 포지션 총 미실현 리스크 한도(%) — 계좌 전체 리스크 상한.
  //   초과 시 신규 진입 차단, 80% 근접 시 사이즈 축소. (개별 0.75% × 12종목 = 9% 노출 통제)
  maxPortfolioHeat: 8.0,
  // [패닉 헤지] 인버스 ETF가 시장 약세/패닉에 진입할 때 사이즈 부스트 배수 (하락장 수익·헤지)
  inversePanicBoost: 1.3,
  // === [KR 분리] 고정리스크 사이징 — KR 전용 오버라이드 ===
  trendSizingKR: {
    riskPerTrade: 0.6,     // 0.75→0.6 (KR 리스크 축소)
    maxPositionPct: 12,    // 15→12
    maxConcurrent: 9       // [확대] 6→9 (거래·데이터 축적↑, KR은 US보다 보수적 유지)
  },
  // === [섹터그룹] 6개 그룹별 성과 가중치 — autoTune이 자동 조정 ===
  //   진입 사이즈 = 자산×Risk%×confidence×그룹가중치. 사이즈만 조절(악화 방어).
  //   weights는 autoTune이 청산통계로 갱신. 초기 1.0(중립). 적은 표본은 shrinkage로 보호.
  sectorGroups: {
    enabled: true,
    weightMin: 0.6, weightMax: 1.3,   // 그룹 가중치 범위
    shrinkN: 20,                       // 이 표본수에서 성과반영 절반(과적합 방지)
    minTradesToWeight: 8,              // 그룹 거래가 이 미만이면 가중치 1.0 고정
    weights: { TECH:1.0, FINANCE:1.0, HEALTH:1.0, CONSUMER:1.0, INDUSTRIAL:1.0, RESOURCES:1.0, OTHER:1.0 }
  },
  // === [신호타입 가중치] 진입신호 종류별(돌파/풀백) 성과로 베팅 차등 — autoTune 자동조정 ===
  //   데이터상 TR_BREAKOUT(PF 2.05) > TR_PULLBACK(PF 1.17). 잘 되는 신호에 더 베팅(사이즈만).
  signalTypeWeights: {
    enabled: true,
    weightMin: 0.7, weightMax: 1.3,
    shrinkN: 15,
    minTradesToWeight: 10,             // 신호 거래가 이 미만이면 가중치 1.0
    weights: { TR_PULLBACK: 1.0, TR_BREAKOUT: 1.0 }
  },
  // 다층 가중치(confidence×그룹×신호) 곱이 너무 작아져 거래 누락되는 것 방지 — 전체 하한
  weightFloor: 0.3,
  // === [섹터 뉴스] Yahoo Finance RSS 무료 뉴스 → 키워드 감성 → 섹터 사이즈 조정 ===
  //   LLM 없이 무료. 6그룹 × 1 subreq = 최대 6 subreq/사이클. refreshHours 캐시로 일 1~2회.
  sectorNews: {
    enabled: true,
    refreshHours: 6,           // 캐시 TTL (시간)
    enrichMaxUsageRatio: 0.82, // 월 사용량 이 비율 초과 시 중단 (alt 슬리브와 동일)
    minBudgetReserve: 8,       // invocation subreq 잔여 최소 예비
    posScaleMax: 1.08,         // 매우 긍정 뉴스 → 최대 사이즈 부스트
    negScaleMin: 0.88          // 매우 부정 뉴스 → 최소 사이즈 축소
  },
  // === [V8] 전략별 포지션 사이즈 (NEUTRAL base / BULL mult / BEAR mult) ===
  // [V8.1.9] base = 가용현금 대비 비율 (계산식이 cash[market] 기준으로 변경됨).
  //          한 거래 목표금액 KR ₩100~300만 / US $1~3k 범위로 클램프됨 (아래 sizingTargets).
  strategySizing: {
    day:      { base: 8, bullMult: 1.2, bearMult: 0.5, neutralMult: 0.3 },  // [V9.6] 15→8 (40% 감축)
    // [성능개선] 실거래 192건 분석: MEANREV 승률 0%(8건 전부 손실). z-score 과매도 반전은
    //   KR 15분 지연 시세에서 칼날잡기가 됨. base 27→13(절반), bearMult 1.4→0.7로
    //   "약세장에 베팅 확대"를 폐지(약세장 과매도 반전이 가장 위험).
    meanrev:  { base: 13, bullMult: 1.0, bearMult: 0.7, neutralMult: 0.8 },
    // swing은 SW_GOLDEN(승률 61%, +60만)이 주력 — 잘 작동 중이라 유지.
    swing:    { base: 33, bullMult: 1.4, bearMult: 0.6, neutralMult: 1.0 },
    // [성능개선] MOMENTUM 승률 23.5%, MO_BREAKOUT 9건이 -252만(최대 손실원).
    //   돌파 추종이 KR에서 가짜돌파+슬리피지로 -15~-21% 손절. 큰 베팅이 거대손실로 직결돼
    //   base 28→14(절반)로 축소. 손절폭(momentumRules)·한 거래 상한도 함께 축소.
    momentum: { base: 14, bullMult: 1.3, bearMult: 0.4, neutralMult: 0.4 }
  },
  // === [V8.1.9] 한 거래당 목표 금액 클램프 (시장별) ===
  sizingTargets: {
    kr: { minBudget: 500000, maxBudget: 1500000 },  // [V9.6] ₩100만~300만 → ₩50만~150만 (DAY 극도 축소)
    us: { minBudget: 500,    maxBudget: 1500    }   // [V9.6] $1k~3k → $500~1.5k
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
    // [성능개선] meanrev/momentum은 손실원이므로 한 거래 절대 상한을 1000만/$1만으로 축소
    //   (한 번 -20% 손절나도 손실액을 캡. swing은 주력이라 상한 유지).
    meanrev:  { kr: { minBudget: 0, maxBudget: 10000000 }, us: { minBudget: 0, maxBudget: 10000 } },
    momentum: { kr: { minBudget: 0, maxBudget: 10000000 }, us: { minBudget: 0, maxBudget: 10000 } }
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
  signalStatsWindow: 200,  // [V34] 80→200: 희귀 신호 통계 추적성↑ (시장 국면 추종 유지)
  // === [V8] Cross-strategy confluence — 같은 종목 + 다른 전략 동시 신호 ===
  crossConfluenceBonus: 1.2,
  // === [V8] 전략별 진입/청산 룰 ===
  swingRules: {
    minHoldHours: 3,           
    timeStopDays: 3,
    timeStopMaxDays: 7,
    trailStartPct: 2.5,        // [V9.6] 3.0→2.5 (더 빨리 트레일링 시작)
    trailDropPct: 2.5,         // [V9.6] 4.0→2.5 (트레일링 타이트 — 이익 보호)
    tp1: 2.8, tp2: 8.5,        // [V9.6] 3.5/10.0→2.8/8.5 (더 자주 익절, 확실한 수익만)
    stopLossPct: 4.0,          // [V9.6] 5.0→4.0 (손절 타이트, 손실 최소화)
    atrStopMult: 1.8,          // [V9.6] 2.0→1.8 (ATR 손절 더 엄격)
    breakEvenAt: 1.5,          // [V9.6] 2.0→1.5 (더 빨리 본전보호)
    breakEvenLock: 0.2         // 변경 없음
  },
  dayRules: {
    // [V9.6 보수화] DAY 전략은 승률 최악(25%), 시간손실 최다(48%)
    // 거래량은 매우 제한적으로, 손절/익절은 극도로 타이트하게
    usIntradayGate: true,       
    krSwingMinHoldHours: 3,     
    krSwingMaxHoldDays: 4,      
    minHoldMinutes: 15,         // [V9.6] 10→15 (최소 보유 늘림)
    maxHoldHours: 4,            // [V9.6] 8→4 (하루 중 절반만, 오후 리스크 회피)
    forceCloseBeforeMinClose: 20, // [V9.6] 30→20 (마감 훨씬 일찍)
    // [V9.6 타임스톱 강화] 수익 못 나면 빨리 포기
    softTimeStopMinutes: 45,        // [V9.6] 90→45 (1시간도 안 됨)
    softTimeStopMinPnl: 0.5,        // [V9.6] 0.15→0.5 (+0.5% 못 넘으면 정리)
    softTimeStopMinutesKR: 30,      // [V9.6] 50→30 (KR 극도로 빠르게)
    softTimeStopMinPnlKR: 0.6,      // [V9.6] 0.25→0.6 (KR도 +0.6% 기준)
    // [V9.6] 조기 익절 강화 — 수익나면 빨리 확정
    eodProfitTakeBeforeMin: 30,     // [V9.6] 45→30 (마감 30분 전)
    // [V9.6] 손익비 강화 — 손절 매우 타이트, 익절 빠르게
    tp: 2.5,                   // [V9.6] 4.0→2.5 (작은 수익도 빨리 확정)
    stopLossPct: 0.6,         // [V9.6] 0.85→0.6 (극도로 타이트)
    // [V9.6] 트레일링 중단 — 너무 리스크 커서 제거 거의 함
    trailStartPct: 1.5,        // [V9.6] 2.5→1.5 (매우 빨리)
    trailDropPct: 0.4,         // [V9.6] 0.8→0.4 (극도로 타이트)
    // [V9.6] Break-even 빨리
    breakEvenAt: 1.0,          // [V9.6] 2.0→1.0 (1% 수익에서 즉시)
    breakEvenLock: 0.1,        // [V9.6] 0.2→0.1
    // [V9.6] TP1 분할익절 — 반은 매우 빨리 청산
    tp1: 1.0,                  // [V9.6] 2.0→1.0 (+1%에서 절반 청산)
    // [V9.6 진입 극도 보수화] 매우 확실한 신호만
    dayDropMin: -2.0,                  // [V9.6] -5.0→-2.0 (얕은 하락만)
    dayDropMax: 0.2,                   // [V9.6] 0.5→0.2 (거의 갭 차단)
    rsiMaxForGap: 45,                  // [V9.6] 55→45 (매수 구간 극소)
    rsiMaxForBounce: 45,               // [V9.6] 60→45 (반등도 매우 낮은 RSI만)
    bounceYestMin: -2.0,               // [V9.6] -1.2→-2.0 (어제 큰폭 하락만)
    openDriveMinPct: 2.0,              // [V9.6] 1.0→2.0 (강한 갭상승만)
    openDriveMaxPct: 3.0,              // [V9.6] 4.0→3.0 (과열은 피함)
    vwapPullMinPct: -0.5,              // [V9.6] -1.0→-0.5 (매우 얕은 눌림)
    vwapPullMaxPct: 1.5,               // [V9.6] 2.5→1.5
    momoRsiMin: 60,                    // [V9.6] 58→60 (높은 RSI만)
    momoRsiMax: 70,                    // [V9.6] 74→70 (70 이상 회피)
    dipMinPct: -1.5,                   // [V9.6] -3.0→-1.5 (아주 얕은 눌림)
    dipMaxPct: -0.2,                   // [V9.6] -0.3→-0.2 (극미한 눌림)
    // [V9.6] 신호 필터 극도 강화 — 가장 강한 신호만
    maxSignalsKept: 1,                 // 유지 (1개만)
    minConfirmWeight: 1.0              // [V9.6] 0.9→1.0 (weight 1.0 이상만!)
  },
  momentumRules: {
    breakoutDays: 8,           // [V9.6] 10→8 (더 짧은 기간, 최근 모멘텀 중심)
    volMult: 1.10,             // [V9.6] 1.15→1.10 (거래량 필터 강화)
    rsiMin: 52, rsiMax: 78,    // [V9.8] 55~75→52~78 (과보수화 완화)
    minHoldDays: 1,            
    timeStopMaxDays: 20,       // [V9.6] 30→20 (더 빨리 포기, 모멘텀 소실 방지)
    trailStartPct: 3.0,        // [V9.6] 4.0→3.0 (빨리 익절)
    trailDropPct: 4.0,         // [V9.6] 6.0→4.0 (더 타이트한 트레일링)
    stopLossPct: 5.0,          // [성능개선] 6.5→5.0 (실거래 HARD-STOP 평균 -11%, 최악 -21% → 더 일찍 손절)
    atrStopMult: 1.8,          // [성능개선] 2.5→1.8 (ATR 손절도 타이트하게 — 갭 전에 더 빨리 탈출)
    breakEvenAt: 2.0,          // [성능개선] 2.5→2.0 (더 빨리 본전 보호 — 돌파 후 되돌림 대비)
    breakEvenLock: 0.3,        // [V9.6] 0.5→0.3
    tp1: 4.0                   // 변경 없음 (첫 익절 지점)
  },
  meanrevRules: {
    zScoreThreshold: -1.4,     // [V9.8] -1.5→-1.4 (과보수화 완화)
    rsiMax: 33,                // [V9.8] 30→33
    minHoldHours: 2,
    timeStopMaxDays: 4,        // [V9.6] 5→4 (더 빨리 포기)
    tp: 999,
    stopLossPct: 3.5,          // [V9.6] 4.0→3.5 (손절 타이트)
    // [V8.3] MEANREV trailing — MA20 닿기 전 갑작스런 하락에 보호
    trailStartPct: 2.0,        // [V9.6] 2.5→2.0 (빨리 트레일링)
    trailDropPct: 1.5,         // [V9.6] 1.8→1.5 (타이트 트레일링)
    breakEvenAt: 1.2,          // [V9.6] 1.5→1.2 (빨리 본전 보호)
    breakEvenLock: 0.15,       // [V9.6] 0.2→0.15
    // [V8.3] MR 진입 조건 강화 — RSI 상승 전환 요구
    requireRsiUptick: true,    // 유지 (catch-falling-knife 방지)
    // [V8.4] BEAR 한정 강화 — 약세장에서 reversion 매수는 매우 위험
    bearZScoreThreshold: -2.0, // [V9.8] -2.2→-2.0
    bearRsiMax: 25             // [V9.8] 22→25
  },
  // === Confluence (전략 내부) ===
  // [V8.1.3] 강제 OFF — 멀티 전략판이라 cross-strategy confluence로 충분.
  // autoTune이 켜는 로직도 V8.1.3에서 비활성화함.
  requireConfluence: false,
  soloSignalWeight: 0.7,       // [V9.8] 0.55→0.7 (단독 신호 45%감점은 과함 — 거래가 사실상 못 나옴)
  confluenceBonus: 1.4,        // [V9.6] 1.3→1.4 (다중 신호 보상 강화)
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
  cycleLockTTL: 90000   // [V31] 90s — US 처리 지연 시 락 만료/이중체결 방지
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
  'atrSizing', 'signalStatsWindow',
  // [V9.0] 일봉/지표 갱신 주기도 시장별 분리 — 종목 수가 다르므로(미국 518 > 한국 311)
  //   한국은 더 짧은 주기로 자주 갱신해도 fetch 예산이 남는다.
  'dailyCacheMinutes'
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
    if (typeof cfg.llmHybrid.failCooldownMin !== "number") cfg.llmHybrid.failCooldownMin = 15;
    // [V11] LLM 기본 ON 전환 — 저장된 cfg에 옛 기본값(false)이 박혀 있으면 한 번만 켜준다.
    //   llmEnabledMigratedV11 플래그로 1회 적용 → 이후 사용자가 끄면 그 선택을 존중.
    if (cfg.llmHybrid.enabled !== true && !cfg.llmEnabledMigratedV11) {
      cfg.llmHybrid.enabled = true;
      cfg.llmEnabledMigratedV11 = true;
    }
  }

  // [V13] autoTuneV13 누락 보강 — 저장된 옛 cfg 호환(섹션 단위로 채움).
  if (!cfg.autoTuneV13 || typeof cfg.autoTuneV13 !== "object") {
    cfg.autoTuneV13 = JSON.parse(JSON.stringify(DEFAULT_CFG.autoTuneV13));
  } else {
    const d = DEFAULT_CFG.autoTuneV13;
    if (cfg.autoTuneV13.enabled === undefined) cfg.autoTuneV13.enabled = d.enabled;
    if (cfg.autoTuneV13.regimeShiftRetune === undefined) cfg.autoTuneV13.regimeShiftRetune = d.regimeShiftRetune;
    for (const sec of ["panicTune", "perStrategySizing", "strategyAutoDisable", "drawdownRisk", "clamp"]) {
      if (!cfg.autoTuneV13[sec] || typeof cfg.autoTuneV13[sec] !== "object") {
        cfg.autoTuneV13[sec] = JSON.parse(JSON.stringify(d[sec]));
      } else {
        for (const k in d[sec]) {
          if (cfg.autoTuneV13[sec][k] === undefined) cfg.autoTuneV13[sec][k] = d[sec][k];
        }
      }
    }
  }


  // [V15] portfolioSizing 누락 보강 — 저장된 옛 cfg 호환.
  if (!cfg.portfolioSizing || typeof cfg.portfolioSizing !== "object") {
    cfg.portfolioSizing = JSON.parse(JSON.stringify(DEFAULT_CFG.portfolioSizing));
  } else {
    for (const k in DEFAULT_CFG.portfolioSizing) {
      if (cfg.portfolioSizing[k] === undefined) cfg.portfolioSizing[k] = DEFAULT_CFG.portfolioSizing[k];
    }
  }

  // [성능개선 V2] 실거래 192건 데이터 기반 1회성 리스크 교정.
  //   분석 결과: MOMENTUM 9건이 -252만(승률 23%, 손절 -21%까지), MEANREV 8건 전부 손실(승률 0%).
  //   원인 = 손실 전략의 과대 사이즈 + 약세장 베팅 확대 + 넓은 손절. 저장된 cfg가 얕은 병합으로
  //   옛 위험값을 덮어쓰므로, 안전 상한을 1회 강제(Math.min — 이미 더 보수적이면 사용자 값 유지)한 뒤
  //   이후엔 사용자 설정을 존중한다(llmEnabledMigratedV11과 동일한 패턴).
  if (!cfg.perfTuneMigratedV2) {
    cfg.perfTuneMigratedV2 = true;
    const ss = cfg.strategySizing;
    if (ss && typeof ss === "object") {
      if (ss.momentum) {
        ss.momentum.base = Math.min(ss.momentum.base != null ? ss.momentum.base : 14, 14);
        ss.momentum.bearMult = Math.min(ss.momentum.bearMult != null ? ss.momentum.bearMult : 0.4, 0.5);
        ss.momentum.neutralMult = Math.min(ss.momentum.neutralMult != null ? ss.momentum.neutralMult : 0.4, 0.5);
      }
      if (ss.meanrev) {
        ss.meanrev.base = Math.min(ss.meanrev.base != null ? ss.meanrev.base : 13, 13);
        ss.meanrev.bearMult = Math.min(ss.meanrev.bearMult != null ? ss.meanrev.bearMult : 0.7, 0.7);
        ss.meanrev.neutralMult = Math.min(ss.meanrev.neutralMult != null ? ss.meanrev.neutralMult : 0.8, 0.8);
      }
    }
    if (cfg.momentumRules && typeof cfg.momentumRules === "object") {
      cfg.momentumRules.stopLossPct = Math.min(cfg.momentumRules.stopLossPct != null ? cfg.momentumRules.stopLossPct : 5.0, 5.0);
      cfg.momentumRules.atrStopMult = Math.min(cfg.momentumRules.atrStopMult != null ? cfg.momentumRules.atrStopMult : 1.8, 1.8);
    }
    const sts = cfg.sizingTargetsByStrategy;
    if (sts && typeof sts === "object") {
      for (const strat of ["momentum", "meanrev"]) {
        if (sts[strat]) {
          if (sts[strat].kr) sts[strat].kr.maxBudget = Math.min(sts[strat].kr.maxBudget || 10000000, 10000000);
          if (sts[strat].us) sts[strat].us.maxBudget = Math.min(sts[strat].us.maxBudget || 10000, 10000);
        }
      }
    }
  }

  // [V12] crashSurvival 누락 보강 — DB에 저장된 옛 cfg가 얕은 병합으로
  //   DEFAULT_CFG.crashSurvival를 덮어 누락시키는 것을 방지. 통째로 없으면 기본값 주입,
  //   하위 섹션만 빠졌으면 그 섹션만 채움(사용자 변경값은 보존).
  if (!cfg.crashSurvival || typeof cfg.crashSurvival !== "object") {
    cfg.crashSurvival = JSON.parse(JSON.stringify(DEFAULT_CFG.crashSurvival));
  } else {
    const d = DEFAULT_CFG.crashSurvival;
    if (cfg.crashSurvival.enabled === undefined) cfg.crashSurvival.enabled = d.enabled;
    for (const sec of ["drawdown", "lossStreak", "panic", "deRisk"]) {
      if (!cfg.crashSurvival[sec] || typeof cfg.crashSurvival[sec] !== "object") {
        cfg.crashSurvival[sec] = JSON.parse(JSON.stringify(d[sec]));
      } else {
        for (const k in d[sec]) {
          if (cfg.crashSurvival[sec][k] === undefined) cfg.crashSurvival[sec][k] = d[sec][k];
        }
      }
    }
  }

  // [재작성] 단일 추세추종 전략으로 강제 — 저장된 옛 cfg가 swing/momentum/meanrev를
  //   켜둔 채 얕은 병합으로 살아남는 것을 막는다(매 로드 강제). trendRules/trendSizing 보강.
  cfg.strategies = Object.assign({ trend: true, scalp: true, snap: true }, cfg.strategies || {}, { trend: true });
  // [V50] 단타 강제 활성화 — 옛 cfg에 저장된 scalp:false를 무력화(요청: 단타 작동).
  cfg.strategies.scalp = true;
  // [V52] snapRules 누락키 보강 (UI 토글로 끌 수 있게 강제활성은 안 함 — 기본값만 true)
  if (cfg.strategies.snap === undefined) cfg.strategies.snap = true;
  if (!cfg.snapRules || typeof cfg.snapRules !== "object") {
    cfg.snapRules = JSON.parse(JSON.stringify(DEFAULT_CFG.snapRules));
  } else {
    for (const k in DEFAULT_CFG.snapRules) {
      if (cfg.snapRules[k] === undefined) cfg.snapRules[k] = DEFAULT_CFG.snapRules[k];
    }
  }
  // [V52] 예산 3분할 마이그레이션 — 옛 {trend,scalp} 2분할 저장값이면 기본 35/30/35로 재설정.
  if (!cfg.strategyBudgetSplit || typeof cfg.strategyBudgetSplit !== "object" || typeof cfg.strategyBudgetSplit.snap !== "number") {
    cfg.strategyBudgetSplit = { trend: 0.35, scalp: 0.30, snap: 0.35 };
  }
  // [V50] scalpRules 누락키 보강 + 옛 기본값만 완화값으로 갱신 (기존엔 보강 블록이 없어 새 설정 미반영이었음)
  if (!cfg.scalpRules || typeof cfg.scalpRules !== "object") {
    cfg.scalpRules = JSON.parse(JSON.stringify(DEFAULT_CFG.scalpRules));
  } else {
    for (const k in DEFAULT_CFG.scalpRules) {
      if (cfg.scalpRules[k] === undefined) cfg.scalpRules[k] = DEFAULT_CFG.scalpRules[k];
    }
    const _sc = cfg.scalpRules;
    if (_sc.usOnly === true)       _sc.usOnly = false;   // KR 단타 개방
    if (_sc.adxMin === 20)         _sc.adxMin = 15;
    if (_sc.minRelVol === 1.2)     _sc.minRelVol = 1.1;
    if (_sc.rsiMin === 42)         _sc.rsiMin = 38;
    if (_sc.minDayMomPct === -1.0) _sc.minDayMomPct = -1.5;
    if (_sc.takeProfit === 2.5)    _sc.takeProfit = 3.0;   // [V51] 잔량 최종익절 상향
  }
  if (!cfg.scalpPanicRules || typeof cfg.scalpPanicRules !== "object") {
    cfg.scalpPanicRules = JSON.parse(JSON.stringify(DEFAULT_CFG.scalpPanicRules));
  } else {
    for (const k in DEFAULT_CFG.scalpPanicRules) {
      if (cfg.scalpPanicRules[k] === undefined) cfg.scalpPanicRules[k] = JSON.parse(JSON.stringify(DEFAULT_CFG.scalpPanicRules[k]));
    }
    // 중첩 capitulation 누락키 보강 + 옛 기본값만 완화 (커스텀 보존)
    if (cfg.scalpPanicRules.capitulation && typeof cfg.scalpPanicRules.capitulation === "object") {
      const _cap = cfg.scalpPanicRules.capitulation;
      for (const k in DEFAULT_CFG.scalpPanicRules.capitulation) {
        if (_cap[k] === undefined) _cap[k] = DEFAULT_CFG.scalpPanicRules.capitulation[k];
      }
      if (_cap.dayDropMax === -3.0) _cap.dayDropMax = -1.5;
    }
    if (cfg.scalpPanicRules.inverse && typeof cfg.scalpPanicRules.inverse === "object") {
      const _inv = cfg.scalpPanicRules.inverse;
      for (const k in DEFAULT_CFG.scalpPanicRules.inverse) {
        if (_inv[k] === undefined) _inv[k] = DEFAULT_CFG.scalpPanicRules.inverse[k];
      }
    }
  }
  if (!cfg.trendRules || typeof cfg.trendRules !== "object") {
    cfg.trendRules = JSON.parse(JSON.stringify(DEFAULT_CFG.trendRules));
  } else {
    for (const k in DEFAULT_CFG.trendRules) {
      if (cfg.trendRules[k] === undefined) cfg.trendRules[k] = DEFAULT_CFG.trendRules[k];
    }
  }
  // [거래확대] 옛 좁은 기본값(사용자가 안 건드린 값)만 새 완화 기본값으로 갱신.
  //   정확히 옛 기본값일 때만 → 사용자 커스텀 설정은 보존. idempotent(이미 완화값이면 무변경).
  if (cfg.trendRules && typeof cfg.trendRules === "object") {
    const _tr = cfg.trendRules;
    if (_tr.pullbackBandPct === 3)  _tr.pullbackBandPct = 4;
    if (_tr.rsiPullbackMin === 40)  _tr.rsiPullbackMin = 37;
    if (_tr.rsiPullbackMax === 65)  _tr.rsiPullbackMax = 68;
    if (_tr.volMult === 1.5)        _tr.volMult = 1.35;
    if (_tr.rsiBreakoutMax === 72)  _tr.rsiBreakoutMax = 75;
    // [V50 거래확대] 옛 기본값만 새 완화값으로 (커스텀 보존, idempotent)
    if (_tr.pullbackBandPct === 4)  _tr.pullbackBandPct = 5;
    if (_tr.rsiPullbackMin === 37)  _tr.rsiPullbackMin = 35;
    if (_tr.rsiPullbackMax === 68)  _tr.rsiPullbackMax = 70;
    if (_tr.volMult === 1.35)       _tr.volMult = 1.25;
    if (_tr.rsiBreakoutMax === 75)  _tr.rsiBreakoutMax = 77;
    if (_tr.bearBlockWorstPct === undefined || _tr.bearBlockWorstPct === -1.5) _tr.bearBlockWorstPct = -2.5;
    // [V51] 손익비 개선: 옛 기본값만 갱신
    if (_tr.timeStopMinR === 0.5) _tr.timeStopMinR = 0.35;
    if (_tr.tp1SellFrac === undefined) _tr.tp1SellFrac = 0.4;
  }
  if (!cfg.trendSizing || typeof cfg.trendSizing !== "object") {
    cfg.trendSizing = JSON.parse(JSON.stringify(DEFAULT_CFG.trendSizing));
  } else {
    for (const k in DEFAULT_CFG.trendSizing) {
      if (cfg.trendSizing[k] === undefined) cfg.trendSizing[k] = DEFAULT_CFG.trendSizing[k];
    }
  }
  // [거래확대] 옛 동시보유 기본값(US 8)만 새 값으로 갱신 (커스텀 보존)
  if (cfg.trendSizing && cfg.trendSizing.maxConcurrent === 8) cfg.trendSizing.maxConcurrent = 12;
  // [KR 분리] KR 전용 오버라이드 보강 (정의 키만 유지, 누락은 DEFAULT)
  if (!cfg.trendRulesKR || typeof cfg.trendRulesKR !== "object") {
    cfg.trendRulesKR = JSON.parse(JSON.stringify(DEFAULT_CFG.trendRulesKR));
  } else {
    for (const k in DEFAULT_CFG.trendRulesKR) {
      if (cfg.trendRulesKR[k] === undefined) cfg.trendRulesKR[k] = DEFAULT_CFG.trendRulesKR[k];
    }
  }
  if (!cfg.trendSizingKR || typeof cfg.trendSizingKR !== "object") {
    cfg.trendSizingKR = JSON.parse(JSON.stringify(DEFAULT_CFG.trendSizingKR));
  } else {
    for (const k in DEFAULT_CFG.trendSizingKR) {
      if (cfg.trendSizingKR[k] === undefined) cfg.trendSizingKR[k] = DEFAULT_CFG.trendSizingKR[k];
    }
  }
  // [거래확대] 옛 KR 동시보유 기본값(6)만 새 값으로 갱신 (커스텀 보존)
  if (cfg.trendSizingKR && cfg.trendSizingKR.maxConcurrent === 6) cfg.trendSizingKR.maxConcurrent = 9;

  // [Vision/SEC 보강] 부분 저장된 경우 누락 키를 DEFAULT로 채움 (얕은병합 한계 보완)
  if (!cfg.visionAI || typeof cfg.visionAI !== "object") {
    cfg.visionAI = JSON.parse(JSON.stringify(DEFAULT_CFG.visionAI));
  } else {
    for (const k in DEFAULT_CFG.visionAI) {
      if (cfg.visionAI[k] === undefined) cfg.visionAI[k] = DEFAULT_CFG.visionAI[k];
    }
  }
  if (!cfg.secFilings || typeof cfg.secFilings !== "object") {
    cfg.secFilings = JSON.parse(JSON.stringify(DEFAULT_CFG.secFilings));
  } else {
    for (const k in DEFAULT_CFG.secFilings) {
      if (cfg.secFilings[k] === undefined) cfg.secFilings[k] = DEFAULT_CFG.secFilings[k];
    }
  }

  // [V10] 종목 유니버스는 코드(DEFAULT_US/KR)로 관리한다.
  //   기존 D1에 저장된 옛 20종목 리스트가 얕은 병합으로 살아남아 신규 종목이
  //   안 보이는 문제를 막기 위해, 매 로드 시 최신 DEFAULT로 강제 갱신한다.
  cfg.usTickers = DEFAULT_US;
  cfg.krTickers = DEFAULT_KR;
  // [수정] cfg.markets 누락 방어 — 저장된 cfg에 markets 없으면 .us 참조 시 500
  if (!cfg.markets || typeof cfg.markets !== 'object') cfg.markets = {};
  // markets 하위에 캐시된 옛 리스트도 정리
  for (const market of ['us', 'kr']) {
    if (cfg.markets[market]) {
      delete cfg.markets[market].usTickers;
      delete cfg.markets[market].krTickers;
    }
  }
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
  // [거래확대] 일봉 캐시를 길게(180분) → 한 번 받은 종목이 오래 평가 대상으로 남아
  //   829종목 대부분이 항상 평가됨(기존 20/15분은 만료가 빨라 ~25종목만 평가되던 병목).
  //   일봉은 하루단위라 장중 180분 캐시 무방(MA/RSI는 천천히 변하고, 현재가는 별도 실시간 반영).
  //   옛 기본값(30/20/15)만 갱신, 사용자 커스텀은 보존.
  if (cfg.markets.us && [undefined, 30, 20, 180].indexOf(cfg.markets.us.dailyCacheMinutes) !== -1) {
    cfg.markets.us.dailyCacheMinutes = 90;
  }
  if (cfg.markets.kr && [undefined, 30, 15, 180].indexOf(cfg.markets.kr.dailyCacheMinutes) !== -1) {
    cfg.markets.kr.dailyCacheMinutes = 90;
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
  // [V22] 현지 날짜 (ET = UTC + offset시간)
  const etDate = new Date(now.getTime() + offset * 60 * 60 * 1000);
  return { totalMin: etTotalMin, day: etDay, offset: offset,
           year: etDate.getUTCFullYear(), month: etDate.getUTCMonth() + 1, date: etDate.getUTCDate() };
}

// [V8.6] KST 분 단위 시각 + 요일
function getKST(now) {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  let kstTotalMin = utcMin + 9 * 60;
  let dayShift = 0;
  if (kstTotalMin >= 24 * 60) { kstTotalMin -= 24 * 60; dayShift = 1; }
  let kstDay = (now.getUTCDay() + dayShift) % 7;
  // [V22] 현지 날짜 (KST = UTC+9, DST 없음)
  const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { totalMin: kstTotalMin, day: kstDay,
           year: kstDate.getUTCFullYear(), month: kstDate.getUTCMonth() + 1, date: kstDate.getUTCDate() };
}

// [통계] KST 05:00 리셋 기준 거래일 키 "YYYY-MM-DD".
//   KST(=UTC+9)에서 5시간을 뺀 시각의 날짜 = UTC+4h의 날짜. (05:00에 날짜 전환)
function kstTradingDayKey(now) {
  const d = new Date((now || new Date()).getTime() + 4 * 60 * 60 * 1000);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return d.getUTCFullYear() + "-" + m + "-" + da;
}

// 실제 거래소 정규장 시간 — 시세 자체가 생성되는 시간
// US: 09:30~16:00 ET (DST 자동)
// KR: 09:00~15:30 KST
// [V22] 휴장일 자동 판정 (A+C 조합) — 하드코딩 공휴일 대신 지수 데이터 신선도로 판정.
//   A: 장 시작 전/거래 전, 지수(KOSPI/나스닥)의 마지막 거래 시각이 "오늘(현지)"이 아니면 휴장.
//   판정 결과는 D1에 당일 캐싱(market_open:YYYY-MM-DD)해 반복 fetch 방지.
//   C(거래 직전 신선도 재확인)는 거래 루프에서 가격 ts로 별도 처리.
function localDateStr(market) {
  const now = new Date();
  const p = market === "us" ? getUSEt(now) : getKST(now);
  if (p.year == null || p.month == null || p.date == null) return null;
  return p.year + "-" + String(p.month).padStart(2, "0") + "-" + String(p.date).padStart(2, "0");
}

// [Claude 제거 + 영구 자동] 증시 휴장일을 규칙으로 동적 계산 — LLM/web_search/연도별 하드코딩 불필요.
//   미국: NYSE 규칙(고정공휴일 + N번째 요일 + 부활절 Computus)으로 어느 연도든 정확 계산.
//   한국: 양력 고정공휴일은 규칙 계산, 음력(설날/추석/석가탄신일)은 테이블(천문연구원 기준).
//         음력 테이블 미커버 연도는 양력 공휴일만 적용 + 지수 데이터 폴백(거래 시점 자연 보정).

// 그 달의 n번째 weekday(0=일~6=토) 날짜 반환
function _nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}
// 그 달의 마지막 weekday 날짜 반환
function _lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
  return last - ((lastDow - weekday + 7) % 7);
}
// 부활절(그레고리력 Computus) → {month, day}
function _easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}
function _ymd(year, month, day) {
  // month/day가 범위를 벗어나면(±조정) Date로 정규화
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0") + "-" + String(dt.getUTCDate()).padStart(2, "0");
}
// NYSE 토→금, 일→월 관측 규칙
function _usObserved(year, month, day) {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (dow === 6) return _ymd(year, month, day - 1);
  if (dow === 0) return _ymd(year, month, day + 1);
  return _ymd(year, month, day);
}
function _usHolidaySet(year) {
  const s = new Set();
  s.add(_usObserved(year, 1, 1));                       // 신정
  s.add(_ymd(year, 1, _nthWeekday(year, 1, 1, 3)));     // MLK (1월 셋째 월)
  s.add(_ymd(year, 2, _nthWeekday(year, 2, 1, 3)));     // Presidents (2월 셋째 월)
  const e = _easterSunday(year);                         // Good Friday = 부활절 - 2일
  s.add(_ymd(year, e.month, e.day - 2));
  s.add(_ymd(year, 5, _lastWeekday(year, 5, 1)));        // Memorial (5월 마지막 월)
  s.add(_usObserved(year, 6, 19));                       // Juneteenth
  s.add(_usObserved(year, 7, 4));                        // 독립기념일
  s.add(_ymd(year, 9, _nthWeekday(year, 9, 1, 1)));      // Labor (9월 첫째 월)
  s.add(_ymd(year, 11, _nthWeekday(year, 11, 4, 4)));    // Thanksgiving (11월 넷째 목)
  s.add(_usObserved(year, 12, 25));                      // 크리스마스
  return s;
}
// 한국 양력 공휴일 + 대체공휴일 규칙 계산.
//   음력 명절(설날/추석/석가탄신일)은 양력 변환이 해마다 달라 하드코딩이 부정확(전날·대체 누락) →
//   음력은 테이블 대신 "지수(KOSPI) 실제 거래일" 폴백으로 정확 판정(_indexFreshOpen, 장중 호출).
function _krHolidaySet(year) {
  const s = new Set();
  const subst = []; // 대체공휴일 대상(주말 겹치면 다음 평일로 대체 — 한국 법정규칙)
  function add(m, d, canSubst) { s.add(_ymd(year, m, d)); if (canSubst) subst.push([m, d]); }
  add(1, 1, false);   // 신정 (대체 없음)
  add(3, 1, true);    // 삼일절
  add(5, 5, true);    // 어린이날
  add(6, 6, false);   // 현충일 (대체 없음)
  add(8, 15, true);   // 광복절
  add(10, 3, true);   // 개천절
  add(10, 9, true);   // 한글날
  add(12, 25, true);  // 성탄절
  s.add(_ymd(year, 5, 1)); // 근로자의 날 (증시 휴장, 대체 없음)
  // 대체공휴일: 대상 공휴일이 토/일이면 다음 비공휴일 평일을 휴장 추가
  subst.forEach(function(md){
    const dow = new Date(Date.UTC(year, md[0] - 1, md[1])).getUTCDay();
    if (dow === 0 || dow === 6) {
      const nd = new Date(Date.UTC(year, md[0] - 1, md[1]));
      let guard = 0;
      do { nd.setUTCDate(nd.getUTCDate() + 1); guard++; }
      while ((nd.getUTCDay() === 0 || nd.getUTCDay() === 6 ||
              s.has(_ymd(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate()))) && guard < 12);
      s.add(_ymd(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate()));
    }
  });
  return s;
}
// 연도별 휴장 Set 캐시 (계산 결과 재사용)
const _holidayCache = { us: {}, kr: {} };
function getHolidaySet(market, year) {
  const c = _holidayCache[market];
  if (c[year]) return c[year];
  const s = market === "us" ? _usHolidaySet(year) : _krHolidaySet(year);
  c[year] = s;
  return s;
}

// 거래일 판정 — 캐시 → 주말 → 공휴일 테이블 (Claude 불필요).
//   반환: true(개장) / false(휴장) / null(판정불가)
async function isMarketTradingDay(DB, market, env) {
  const today = localDateStr(market);
  if (!today) return null;
  const cacheKey = "market_open:" + market + ":" + today;
  // 1) 당일 캐시 우선 (하루 1회만 LLM 검색)
  try {
    const cached = await getState(DB, cacheKey, null);
    if (cached && typeof cached.open === "boolean") {
      // [FIX2] KR 휴장(false) 캐시는 신뢰하지 않고 항상 재판정한다.
      //   진짜 주말/공휴일이면 아래 규칙이 다시 false를 주므로 안전하고,
      //   야후 지연발 장초반 오판이 캐시에 고착돼 종일 KR 거래가 막히던 문제만 제거된다.
      const _krFalseCache = (market === "kr" && cached.open === false);
      if (!_krFalseCache) return cached.open;
    }
  } catch (e) {}

  // [비용절감] 1.5) 주말은 LLM 없이 코드로 즉시 휴장 판정 (주 2일 LLM 호출 제거)
  try {
    const now = new Date();
    const p = market === "us" ? getUSEt(now) : getKST(now);
    if (p && p.year != null && p.month != null && p.date != null) {
      const dow = new Date(Date.UTC(p.year, p.month - 1, p.date)).getUTCDay(); // 0=일,6=토
      if (dow === 0 || dow === 6) {
        try { await setState(DB, cacheKey, { open: false, ts: Date.now(), src: "weekend" }); } catch (e2) {}
        return false;
      }
    }
  } catch (e) {}

  // 2) [규칙 기반 자동] 공휴일을 연도별 규칙으로 계산해 즉시 판정 (web_search 불필요, 지연 0)
  const yr = parseInt(today.slice(0, 4), 10);
  let open, src;
  if (getHolidaySet(market, yr).has(today)) {
    open = false; src = "rule-holiday"; // 테이블/규칙상 공휴일 → 휴장 (확정)
  } else if (market === "kr") {
    // 한국: 음력은 대체공휴일·임시공휴일 등으로 테이블이 불완전할 수 있음 →
    //   테이블에 없어도 지수(KOSPI) 마지막 거래일로 재확인(실제 거래 데이터가 정답).
    //   지수가 오늘 거래됨 → 개장 / 아니면 휴장. 데이터 없으면 개장 가정(시세 stale로 자연 차단).
    open = await _indexFreshOpen(DB, market, today);
    src = "rule+index";
  } else {
    open = true; src = "rule"; // 미국은 규칙이 결정론적으로 완전 → 평일·비공휴일은 개장
  }
  // [FIX] KR 지수기반 false는 캐시하지 않음 — 장초반 stale로 인한 오판이 종일 고착되는 것 방지.
  //   (진짜 공휴일이면 지수가 계속 어제값이라 매 사이클 false로 재판정되어 결과는 동일, 회복만 가능)
  const _skipCache = (open === false && src === "rule+index" && market === "kr");
  if (!_skipCache) { try { await setState(DB, cacheKey, { open: open, ts: Date.now(), src: src }); } catch (e) {} }
  await log(DB, "INFO", null, "[HOLIDAY] " + market.toUpperCase() + " " + today + " trading=" + (open ? "OPEN" : "CLOSED") + " (" + src + ")");
  return open;
}

// 지수의 마지막 거래일이 오늘(현지)과 같으면 개장으로 판정 — 음력 대체/임시공휴일 보정.
//   장중 호출이므로 개장일이면 당일 봉이 있고, 휴장일이면 마지막 거래가 어제 → 정확.
//   데이터 없거나 장 시작 전이면 개장 가정(시세 stale로 거래 게이트가 자연 차단).
async function _indexFreshOpen(DB, market, today) {
  try {
    const idxSym = market === "us" ? "^IXIC" : "^KS11";
    const idx = await getState(DB, "index:" + idxSym, null);
    if (idx && typeof idx.marketTime === "number" && idx.marketTime > 0) {
      const dt = new Date(idx.marketTime * 1000);
      const p = market === "us" ? getUSEt(dt) : getKST(dt);
      if (p && p.year != null) {
        const idxDate = p.year + "-" + String(p.month).padStart(2, "0") + "-" + String(p.date).padStart(2, "0");
        if (idxDate === today) return true;
        // [FIX] 지수가 아직 당일로 안 바뀜(야후 지연·장초반). 장중이면 휴장 단정 말고 개장 가정 —
        //   진짜 휴장이면 시세도 stale이라 실거래는 가격 신선도 게이트에서 자연 차단된다.
        if (isMarketOpen(market)) return true;
        return false;
      }
    }
  } catch (e) {}
  return true; // 데이터 없으면 개장 가정
}

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

// [V9.0] 가격 갱신 전용 창 — UI/휴장판정용 isMarketOpen과 분리.
//   KR은 야후 15분 지연이라 가격 갱신 종료를 15:45(945)까지 늘려, 실제 마지막 15분
//   (14:45~15:30) 거래의 지연 데이터가 quote/종가에 반영될 시간을 확보한다.
//   시작은 09:00 그대로(데이터 일찍 받아두는 건 무해). US는 실시간이라 정규장과 동일.
function isQuoteRefreshWindow(market) {
  const now = new Date();
  if (market === "us") {
    const et = getUSEt(now);
    // [V9.1] 종료 16:00→16:10 ET: 마감 직전 마지막 틱이 아닌 "공식 종가" 프린트가
    //   야후에 반영될 시간을 확보 (기존엔 지수/종목 종가가 공식 종가와 0.1%대 어긋남).
    return et.day >= 1 && et.day <= 5 && et.totalMin >= 570 && et.totalMin < 970;
  }
  if (market === "kr") {
    const kst = getKST(now);
    return kst.day >= 1 && kst.day <= 5 && kst.totalMin >= 540 && kst.totalMin < 945;
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
// [FIX V8.8] 기존엔 "정확히 09:00(1분)"에만 true라서, 그 1분에 사이클 락 경쟁에서
//   지거나 cron이 미세하게 어긋나면 그날 LLM 분석을 통째로 놓쳤음(자동갱신 실패).
//   → "트리거 시각 이후 ~ 장중"이면서 "오늘 아직 실행 안 됨"일 때 true가 되도록 변경.
//   실제 1일 1회 보장은 호출부에서 llm_last_run:<market> 날짜 비교로 처리.
function isLLMTriggerWindow(market) {
  const now = new Date();
  if (market === "kr") {
    const kst = getKST(now);
    if (kst.day < 1 || kst.day > 5) return false;
    // 09:00 KST(540) 이후 ~ 15:30 KST(930) 사이 = 정규장 동안 언제든 따라잡기 가능
    return kst.totalMin >= 540 && kst.totalMin < 930;
  }
  if (market === "us") {
    const et = getUSEt(now);
    if (et.day < 1 || et.day > 5) return false;
    // 09:20 ET(560) 이후 ~ 16:00 ET(960) 사이
    return et.totalMin >= 560 && et.totalMin < 960;
  }
  return false;
}
// 하위호환 — 기존 이름도 윈도우 방식으로 위임
function isLLMTriggerTime(market) {
  return isLLMTriggerWindow(market);
}

// [FIX V8.8] 오늘(현지날짜) 이미 LLM 분석을 돌렸는지 확인.
async function llmAlreadyRanToday(DB, market) {
  const today = localDateStr(market);
  if (!today) return false;
  try {
    const last = await getState(DB, "llm_last_run:" + market, null);
    return !!(last && last.date === today);
  } catch (e) { return false; }
}
async function markLLMRanToday(DB, market) {
  const today = localDateStr(market);
  if (!today) return;
  try { await setState(DB, "llm_last_run:" + market, { date: today, ts: Date.now() }); } catch (e) {}
}

// [V19] LLM 실패 쿨다운 — 성공 마킹(llmAlreadyRanToday)이 안 되는 실패 상황에서
//   매분 재시도가 거래 사이클 앞에서 최대 60s씩 잡아먹는 폭주를 막는다.
//   실패하면 시각을 기록하고, cooldownMin 이내엔 LLM 호출 자체를 건너뛴다.
async function llmInFailCooldown(DB, market, cooldownMin) {
  try {
    const f = await getState(DB, "llm_fail_until:" + market, null);
    return !!(f && typeof f === "number" && Date.now() < f);
  } catch (e) { return false; }
}
async function markLLMFailed(DB, market, cooldownMin) {
  try { await setState(DB, "llm_fail_until:" + market, Date.now() + (cooldownMin || 15) * 60000); } catch (e) {}
}

// [V9 매크로] 경제지표 자동 갱신 트리거 — 매일 아침 07:00 KST 1회.
//   주말 포함 매일 도는 이유: 발표가 미국 새벽(한국 밤)에 자주 나므로
//   아침에 한 번 긁으면 전날 발표분까지 모두 반영됨. cron 1분 간격이라 07:00 정각에 매치.
function isMacroTriggerTime() {
  const now = new Date();
  const kst = getKST(now);
  return kst.totalMin === 420;  // 07:00 KST = 420분
}

// [COMMODITY] 원자재 거래 트리거 — 매일 16:00 KST 이후 1회, 평일만.
//   [V8.9] 기존엔 "정확히 16:00(1분)"에만 true라서 cron 누락/락 경쟁으로 그날 거래를
//   통째로 놓칠 수 있었음. → "16:00 이후 ~ 17:00 사이" 윈도우로 넓히고, 1일 1회 보장은
//   호출부에서 cm_last_trade 날짜 비교로 처리.
function isCommodityTriggerTime() {
  const now = new Date();
  const kst = getKST(now);
  if (kst.day < 1 || kst.day > 5) return false;  // 평일만
  // 16:00(960) ~ 17:00(1020) 사이면 트리거 윈도우. 실제 1회 보장은 호출부에서.
  return kst.totalMin >= 960 && kst.totalMin < 1020;
}

// [V8.9] 오늘 이미 원자재 거래 사이클을 돌렸는지 확인 (1일 1회 보장).
async function commodityTradedToday(DB) {
  const today = localDateStr("kr");
  if (!today) return false;
  try {
    const last = await getState(DB, "cm_last_trade", null);
    return !!(last && last.date === today);
  } catch (e) { return false; }
}
async function markCommodityTradedToday(DB) {
  const today = localDateStr("kr");
  if (!today) return;
  try { await setState(DB, "cm_last_trade", { date: today, ts: Date.now() }); } catch (e) {}
}

// [FX] 환율 조회 트리거 — 매일 06:30 KST 1회 (주말 포함, 조회 전용).
//   06:30 KST = 390분. cron 1분 간격이라 06:30 정각에 정확히 매치.
function isFxTriggerTime() {
  const now = new Date();
  const kst = getKST(now);
  return kst.totalMin === 390;  // 06:30 KST = 390분
}

// [V9.1] FX 시장 개장 추정 — 글로벌 FX는 월요일 새벽(시드니)~토요일 새벽(뉴욕 마감) 24시간.
//   UTC 기준 휴장: 토요일 전체, 일요일 21:00 이전, 금요일 22:00 이후.
//   환율 실시간 갱신(10분 주기)의 게이트 — 휴장 중 무의미한 fetch 차단.
function isFxMarketOpen() {
  const d = new Date();
  const day = d.getUTCDay(), h = d.getUTCHours();
  if (day === 6) return false;
  if (day === 0 && h < 21) return false;
  if (day === 5 && h >= 22) return false;
  return true;
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

// [강화·데이터적합] 현재 거래 세션의 경과 비율(0~1) — 장중 형성 중인 당일봉의
//   "부분 거래량"을 풀데이(full-day) 기준으로 환산하는 데 사용. 윈도우 밖이면 null(=완성봉으로 취급).
//   US 09:30~16:00(390분), KR 거래윈도우 09:15~15:45(390분).
function sessionElapsedFraction(market) {
  const now = new Date();
  if (market === "us") {
    const et = getUSEt(now);
    if (et.day < 1 || et.day > 5) return null;
    if (et.totalMin < 570 || et.totalMin >= 960) return null;
    return Math.max(0, Math.min(1, (et.totalMin - 570) / 390));
  }
  if (market === "kr") {
    const kst = getKST(now);
    if (kst.day < 1 || kst.day > 5) return null;
    if (kst.totalMin < 555 || kst.totalMin >= 945) return null;
    return Math.max(0, Math.min(1, (kst.totalMin - 555) / 390));
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
  const _slimSig = function(s) {
    return {
      name: s.name, count: s.count,
      wr: +((s.weightedWinRate || 0)).toFixed(2),
      exp: s.expectancy != null ? +s.expectancy.toFixed(2) : null,
      stopRate: s.stopRate != null ? +s.stopRate.toFixed(2) : null,
      avgPnl: +((s.avgPnl || 0)).toFixed(2)
    };
  };
  const topSignals = Object.keys(signalStats)
    .map(function(k) { return Object.assign({ name: k }, signalStats[k]); })
    .filter(function(s) { return s.count >= 5; })
    .sort(function(a, b) { return (b.expectancy != null ? b.expectancy : 0) - (a.expectancy != null ? a.expectancy : 0); })
    .slice(0, 12)
    .map(_slimSig);

  // [V9] 손실 집중 신호 — 하위 성과 신호도 LLM에 보여줘 disable 판단을 도움.
  //   [V9.7] expectancy(기대값)·stopRate를 함께 노출해 "승률만 낮은 신호"와 "기대값까지 음수인
  //   신호"를 LLM이 구분하게 함. 동시에 필드를 핵심만 추려 입력 토큰 절감.
  const worstSignals = Object.keys(signalStats)
    .map(function(k) { return Object.assign({ name: k }, signalStats[k]); })
    .filter(function(s) { return s.count >= 5; })
    .sort(function(a, b) { return (a.expectancy != null ? a.expectancy : 0) - (b.expectancy != null ? b.expectancy : 0); })
    .slice(0, 8)
    .map(_slimSig);

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
  // [V16→V18 HOTFIX] 손실 원인 구분용 시장 추세.
  //   ★중요★ 여기서 analyzeMarketRegime()을 호출하면 지수 일봉을 네트워크 fetch 해서
  //   이미 무거운 사이클(100s+)에 부하를 더해 LLM 호출이 20s 타임아웃에 걸렸다(V16 회귀).
  //   → 절대 fetch 하지 않는다. 이미 캐시된 지수 일봉(daily:INDEX)만 getState로 읽어
  //     20일 수익률을 계산하고, 없으면 당일 지수 변동(worstIdxPct)으로 폴백한다.
  let idxReturn20 = null;
  try {
    let sumRet = 0, nRet = 0;
    for (const idx of indices) {
      const d = await getState(DB, "daily:" + idx, null);  // 읽기만, fetch 없음
      if (d && Array.isArray(d.closes) && d.closes.length >= 21) {
        const c = d.closes;
        const last = c[c.length - 1], prev20 = c[c.length - 21];
        if (last > 0 && prev20 > 0) { sumRet += ((last - prev20) / prev20) * 100; nRet++; }
      }
    }
    if (nRet > 0) idxReturn20 = sumRet / nRet;
  } catch (e) { idxReturn20 = null; }
  // 20일 추세를 못 구하면 당일 평균 지수변동으로 근사(약하게).
  const trendProxy = (idxReturn20 != null) ? idxReturn20
                   : (idxCnt > 0 ? (sumIdxPct / idxCnt) : null);
  const regimeForCtx = { idxReturn20: trendProxy };

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
      worstTrade: losses.length > 0 ? losses.reduce(function(a, b) { return a.pnl_pct < b.pnl_pct ? a : b; }) : null,
      // [V16] 손실 원인 구분용 — 시장(지수 20일 추세)이 약했는지. LLM이 '시장 탓 손실 vs 시스템 결함'을 판별하는 근거.
      marketTrendIdx20: (regimeForCtx && regimeForCtx.idxReturn20 != null) ? +regimeForCtx.idxReturn20.toFixed(1) : null,
      lossLikelyMarketDriven: !!(regimeForCtx && regimeForCtx.idxReturn20 != null && regimeForCtx.idxReturn20 < 0 && totalPnl < 0),
      lossDiagnosisHint: (regimeForCtx && regimeForCtx.idxReturn20 != null)
        ? (regimeForCtx.idxReturn20 < 0
            ? "시장(지수 20일) 약세 — 최근 손실은 시장 하락 영향일 가능성. sizing 축소 자제."
            : "시장(지수 20일) 강세/횡보 — 시스템 성과를 시장과 분리해 평가 가능.")
        : "시장 추세 데이터 부족 — 손익만으로 시스템 부진 단정 금지."
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

function sanitizeInstruction(raw, llmCfg, context) {
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
    // [V16] 시장 하락발 손실 보호 — 손실 원인이 '시장 탓'으로 판정되면(lossLikelyMarketDriven)
    //   LLM의 sizing 축소(s<1)를 1.0 쪽으로 절반 완충한다. 폭락장 손실로 투자를 줄이는 것을 방지.
    if (context && context.last7days && context.last7days.lossLikelyMarketDriven && s < 1.0) {
      s = s + (1.0 - s) * 0.5;
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

function buildLLMPrompt(market, context, opts) {
  opts = opts || {};
  const compact = opts.compactContext === true;
  const includeReasoning = opts.includeReasoning !== false;  // 기본 true(기존 동작)
  const marketLabel = market === "us" ? "미국 (US)" : "한국 (KR)";
  const ctxJson = compact ? JSON.stringify(context) : JSON.stringify(context, null, 2);
  return "당신은 LUX-engine 트레이딩 시스템의 일일 시장 리스크 분석가입니다.\n" +
    "역할: 종목을 직접 고르지 않습니다. 오늘 " + marketLabel + " 시장의 '리스크 환경'을 평가해,\n" +
    "알고리즘이 쓸 거시 거래 지시(sizing/신호 on-off/회피종목)를 JSON으로 출력합니다.\n\n" +
    "# 컨텍스트\n```json\n" + ctxJson + "\n```\n\n" +
    "# 분석 절차 (반드시 이 순서로 사고할 것)\n" +
    "1) 시장 국면: marketSnapshot(avg/worstIndexChangePct)과 indices를 보고 강세/중립/약세 판정.\n" +
    "   - worstIndexChangePct <= -1.5% → 강한 약세 신호 / -1.0%~-1.5% → 약세 주의 / +0.5% 이상 광범위 상승 → 강세\n" +
    "2) 최근 성과 진단: last7days.winRate와 avgPnl, strategyPerf7d를 보고 평가하되, **손실의 원인을 반드시 구분**할 것.\n" +
    "   - ★중요★ 최근 7일 손실이 '시장 전반의 하락(폭락·조정)'에서 비롯됐다면 이는 시스템 결함이 아니다. 이 경우 sizing을 줄이지 말 것.\n" +
    "     판단법: 같은 기간 indices/idxReturn20이 마이너스이거나 큰 폭으로 빠졌으면 → 손실은 시장 탓 → 시스템은 정상 → sizing 유지(1.0).\n" +
    "     반대로 시장(indices)은 강세/횡보인데 시스템만 손실이면 → 진짜 시스템 부적합 → 그때만 보수적.\n" +
    "   - winRate가 낮아도 손익비(avgWin/avgLoss, exp)가 양호하거나 큰 승자(TP2)가 있으면 정상 작동으로 본다. 이 시스템은 저승률·고손익비 구조다.\n" +
    "   - 시장 하락이 이미 끝나고 회복(indices가 다시 +)되는 국면이면 오히려 sizing을 정상~약간 공격적으로(과거 손실에 갇히지 말 것).\n" +
    "   - 단순히 'winRate < 0.40'이라는 이유만으로 sizing을 줄이는 것은 금지. 시장 원인을 배제한 뒤에만 판단.\n" +
    "3) 신호 품질: worstSignals 중 count>=8 이고 exp(기대값)<0 인 것만 disable 후보로. exp는 1거래당 기대 손익%이며, 음수면 장기적으로 잃는 신호다. wr(승률)만 낮고 exp>0이면 손익비가 좋은 것이니 끄지 말 것. stopRate가 높으면(>0.5) 손절로 자주 끝나는 신호다. 표본 작으면(count<8) 건드리지 말 것.\n" +
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
    "- ★시장 하락(폭락·조정)에서 난 손실로 sizing을 줄이지 말 것★. 시장이 빠지면 어느 시스템이든 손실이며, 이는 엔진 성능 저하가 아니다. sizing 축소는 '시장은 멀쩡한데 시스템만 지는' 명백한 경우로 한정한다.\n" +
    "- 손실 원인이 모호하면 sizing은 1.0(중립)을 기본값으로 둘 것. 확신 없는 축소 금지.\n" +
    "- 불확실하면 confidence를 낮추고 보수적으로. 과잉 개입보다 무개입이 안전.\n\n" +
    (includeReasoning
      ? ("# 출력 형식 (JSON만, 코드블록·머리말 금지)\n" +
         "reasoning 필드에 위 1~5단계 사고를 간결히 적고, 그 결론을 나머지 필드에 반영하세요.\n" +
         "{\n" +
         "  \"reasoning\": {\n" +
         "    \"market_regime\": \"국면 판정 + 근거 수치 (예: worstIdx -1.6% → 강한 약세)\",\n" +
         "    \"performance\": \"최근 성과 진단 (예: 7일 winRate 0.38, day전략 부진)\",\n" +
         "    \"signal_quality\": \"disable 후보와 근거 (없으면 '해당 없음')\",\n" +
         "    \"symbol_risk\": \"손실 집중 종목 (없으면 '해당 없음')\",\n" +
         "    \"macro_influence\": \"최근 4일내 지표 반영 내용 + 방향 (recentMacro 비었으면 '해당 없음')\"\n" +
         "  },\n" +
         "  \"sentiment\": \"neutral\",\n")
      : ("# 출력 형식 (JSON만, 코드블록·머리말 금지)\n" +
         "위 1~5단계를 머릿속으로 판단하되, 출력은 아래 필드만. reasoning은 출력하지 마세요.\n" +
         "{\n" +
         "  \"sentiment\": \"neutral\",\n")) +
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

    // [V9.7] 한산한 시장 스킵 게이트 — 전일 대비 worst 지수변동 절댓값이 skipIfQuietPct 미만이고,
    //   직전 지시가 아직 유효(만료 전)하면 LLM 호출 자체를 생략하고 기존 지시를 재사용한다.
    //   forceRun이면 항상 호출. skipIfQuietPct<=0 이면 게이트 비활성.
    const quietThr = (typeof llmCfg.skipIfQuietPct === "number") ? llmCfg.skipIfQuietPct : 0;
    if (!forceRun && quietThr > 0) {
      const worst = context.marketSnapshot && context.marketSnapshot.worstIndexChangePct;
      if (typeof worst === "number" && Math.abs(worst) < quietThr) {
        const prev = await getState(DB, "llm_daily:" + market, null);
        if (prev && prev.expiresAt && prev.expiresAt > Date.now()) {
          await log(DB, "INFO", null, "[LLM] " + market + " quiet skip (worst " + worst.toFixed(2) + "% < " + quietThr + "%), reuse prior instruction");
          return { ok: true, reason: "quiet_skip", reused: true, instruction: prev.instruction };
        }
      }
    }

    const prompt = buildLLMPrompt(market, context, {
      compactContext: llmCfg.compactContext === true,
      includeReasoning: llmCfg.includeReasoning !== false
    });

    // [V9.9] ★핵심 수정★ — 타임아웃/재시도를 코드에서 강제(저장된 D1 cfg 무시).
    //   로그 분석 결과: Anthropic 응답이 이 엣지 경로에서 40~60초까지 늘어지는데,
    //   기존엔 20s×3회로 "성공 직전의 호출을 매번 중단→재시작"해 영원히 못 끝냈다
    //   (10:25엔 52초 걸려 겨우 성공, 그 뒤론 60초 예산 초과로 전부 타임아웃).
    //   → 한 번에 충분히 긴 타임아웃(≥75s)으로 1회 호출이 완주하게 한다.
    //   stored cfg.llmHybrid.timeoutMs(=20000)가 남아 있어도 Math.max로 무력화.
    const effTimeout = Math.max((typeof llmCfg.timeoutMs === "number" ? llmCfg.timeoutMs : 0), 75000);
    const effRetries = Math.min((typeof llmCfg.maxRetries === "number" ? llmCfg.maxRetries : 1), 1);
    const res = await callClaude(
      env.ANTHROPIC_API_KEY,
      llmCfg.model || "claude-haiku-4-5",
      prompt,
      llmCfg.maxTokens || 1200,
      effTimeout,
      {
        maxRetries: effRetries,
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

    const sanitized = sanitizeInstruction(raw, llmCfg, context);
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

  // [FIX V8.8] macro 트리거가 runTradingCycle 내부와 scheduled 양쪽에 있어 07:00 정각에
  //   중복 web_search(비용↑) 가능. 강제실행이 아니면 "오늘 이미 갱신됨"이면 스킵.
  if (!forceRun) {
    // [비용절감] 주말 스킵 — 경제지표는 주말 미발표 (주 2회 sonnet+web_search 호출 제거)
    try {
      const dow = new Date().getUTCDay();
      if (dow === 0 || dow === 6) return { ok: false, reason: "weekend" };
    } catch (e) {}
    try {
      const today = localDateStr("kr");
      const lastMacro = await getState(DB, "macro_last_run", null);
      if (lastMacro && lastMacro.date === today) {
        return { ok: false, reason: "already_ran_today" };
      }
    } catch (e) {}
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
    // [FIX V8.8] 오늘 갱신 완료 마킹 (중복 실행 방지용).
    try { await setState(DB, "macro_last_run", { date: localDateStr("kr"), ts: Date.now() }); } catch (e) {}
    await log(DB, "INFO", null, "[MACRO] update done: filled=" + filled + " kept=" + kept +
      " usage_in=" + ((res.usage && res.usage.input_tokens) || "?") +
      " out=" + ((res.usage && res.usage.output_tokens) || "?"));
    return { ok: true, filled: filled, kept: kept, data: next };
  } catch (e) {
    await log(DB, "ERROR", null, "[MACRO] update fail: " + e.message);
    return { ok: false, reason: "exception", error: e.message };
  }
}

let __schemaReady = false;
// [통계] 직전 집계 이후 누적된 ERROR 로그 수. 사이클 종료 시 daily_stats에 반영 후 0으로 리셋.
let __engineErrCount = 0;
async function ensureSchema(DB) {
  if (__schemaReady) return;
  // [V28] positions 테이블 PK 강제 점검 — 기존 PK가 (symbol,strategy)면 savePosition의
  //   ON CONFLICT(symbol,strategy,market)와 안 맞아 D1_ERROR 발생. 한 번만 재생성한다.
  try {
    const pkDone = await getState(DB, "pk_migration_v28", null);
    if (!pkDone) {
      const sqlRow = await DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='positions'").first();
      const sql = sqlRow && sqlRow.sql ? sqlRow.sql : "";
      if (sql && !/PRIMARY KEY\s*\([^)]*market[^)]*\)/i.test(sql)) {
        await DB.prepare("DROP TABLE IF EXISTS positions_v28").run();
        await DB.prepare("CREATE TABLE positions_v28 (symbol TEXT NOT NULL, strategy TEXT NOT NULL DEFAULT 'swing', market TEXT NOT NULL, qty REAL NOT NULL, avg_price REAL NOT NULL, opened_ts INTEGER NOT NULL, meta TEXT, PRIMARY KEY(symbol, strategy, market))").run();
        await DB.prepare("INSERT OR IGNORE INTO positions_v28 (symbol, strategy, market, qty, avg_price, opened_ts, meta) SELECT symbol, COALESCE(strategy,'swing'), market, qty, avg_price, opened_ts, meta FROM positions").run();
        await DB.prepare("DROP TABLE positions").run();
        await DB.prepare("ALTER TABLE positions_v28 RENAME TO positions").run();
        await log(DB, "INFO", null, "[V28] positions PK 재생성: (symbol, strategy, market)");
      }
      await setState(DB, "pk_migration_v28", { done: true, ts: Date.now() });
    }
  } catch (e) {
    console.error("pk_migration_v28 fail:", e.message);
  }
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
        await DB.prepare("CREATE TABLE IF NOT EXISTS positions_new (symbol TEXT NOT NULL, strategy TEXT NOT NULL DEFAULT 'swing', market TEXT NOT NULL, qty REAL NOT NULL, avg_price REAL NOT NULL, opened_ts INTEGER NOT NULL, meta TEXT, PRIMARY KEY(symbol, strategy, market))").run();
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
      await DB.prepare("CREATE TABLE IF NOT EXISTS positions (symbol TEXT NOT NULL, strategy TEXT NOT NULL DEFAULT 'swing', market TEXT NOT NULL, qty REAL NOT NULL, avg_price REAL NOT NULL, opened_ts INTEGER NOT NULL, meta TEXT, PRIMARY KEY(symbol, strategy, market))").run();
    } catch (e2) { console.error("schema create fail:", e2.message); }
  }
  // [V16] 코스닥 종목이 과거 .KS로 저장된 포지션/quote를 .KQ로 교정.
  //   DEFAULT_KR에 .KQ로 등록된 종목의 6자리 코드를 기준으로, 같은 코드의 .KS 잔재를 옮긴다.
  try {
    const migDone = await getState(DB, "kq_migration_v16", null);
    if (!migDone) {
      const kqCodes = [];
      for (const sym of DEFAULT_KR) {
        if (sym.endsWith(".KQ")) kqCodes.push(sym.slice(0, 6));
      }
      for (const code of kqCodes) {
        const ksSym = code + ".KS", kqSym = code + ".KQ";
        try {
          await DB.prepare("UPDATE OR IGNORE positions SET symbol = ? WHERE symbol = ?").bind(kqSym, ksSym).run();
          await DB.prepare("DELETE FROM positions WHERE symbol = ?").bind(ksSym).run();
        } catch (e) {}
        for (const pfx of ["quote:", "daily:"]) {
          try {
            const ksRow = await DB.prepare("SELECT v FROM state WHERE k = ?").bind(pfx + ksSym).first();
            if (ksRow) {
              await DB.prepare("INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?) ON CONFLICT(k) DO NOTHING")
                .bind(pfx + kqSym, ksRow.v, Date.now()).run();
              await DB.prepare("DELETE FROM state WHERE k = ?").bind(pfx + ksSym).run();
            }
          } catch (e) {}
        }
      }
      await setState(DB, "kq_migration_v16", { done: true, ts: Date.now() });
    }
  } catch (e) { console.error("KQ migration fail:", e.message); }
  // [통계] 일별 엔진 통계 (KST 05:00 리셋 = day_key 단위). signals/errors/trades 누적.
  try {
    await DB.prepare("CREATE TABLE IF NOT EXISTS daily_stats (day_key TEXT PRIMARY KEY, signals INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, trades INTEGER NOT NULL DEFAULT 0, updated_ts INTEGER)").run();
  } catch (e) { console.error("daily_stats create fail:", e.message); }
  __schemaReady = true;
}

async function log(DB, level, symbol, message) {
  if (level === "ERROR") __engineErrCount++;   // [통계] 에러 누적
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

// [추세 강도] ADX(Average Directional Index) — Wilder 표준.
//   추세의 "방향성/강도"를 0~100으로. 높으면 강추세, 낮으면 횡보(추세전략 휩쏘 위험).
//   추가 fetch 0 — 기존 일봉(highs/lows/closes)만 사용.
function getADX(highs, lows, closes, period) {
  period = period || 14;
  if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) return null;
  const n = closes.length;
  if (n < period * 2 + 1 || highs.length !== n || lows.length !== n) return null;
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < n; i++) {
    if (typeof highs[i] !== "number" || typeof lows[i] !== "number" || highs[i] <= 0 || lows[i] <= 0) return null;
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    const up = highs[i] - highs[i - 1], down = lows[i - 1] - lows[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  // Wilder smoothing (초기 합 → 이후 s - s/period + new)
  function wilder(arr) {
    if (arr.length < period) return null;
    let s = 0;
    for (let i = 0; i < period; i++) s += arr[i];
    const out = [s];
    for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
    return out;
  }
  const trS = wilder(tr), pS = wilder(plusDM), mS = wilder(minusDM);
  if (!trS || !pS || !mS) return null;
  const dx = [];
  for (let i = 0; i < trS.length; i++) {
    if (trS[i] === 0) { dx.push(0); continue; }
    const pDI = 100 * pS[i] / trS[i], mDI = 100 * mS[i] / trS[i];
    const sum = pDI + mDI;
    dx.push(sum > 0 ? 100 * Math.abs(pDI - mDI) / sum : 0);
  }
  if (dx.length < period) return null;
  // ADX = DX의 Wilder 평활
  let adx = 0;
  for (let i = 0; i < period; i++) adx += dx[i];
  adx /= period;
  for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
  return adx;
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

// === [V11] Cloudflare subrequest 예산 가드 ===
//   Workers 무료 플랜은 invocation 당 외부 fetch(subrequest)가 50개로 제한된다.
//   (유료여도 1000) 한도를 넘으면 "Too many subrequests" 로 이후 fetch 가 전부 실패해
//   로그가 ERROR 로 도배되고 시세 갱신이 끊긴다.
//   → 한 invocation 동안 yahooFetch 호출 수를 카운트하고, 예산을 넘으면 실제 fetch 를
//     하지 않고 즉시 throw 해서(=조용히 스킵) 한도 폭발을 막는다. 남은 종목은 다음
//     사이클 라운드로빈으로 처리된다.
let __fetchBudget = { used: 0, max: 850 };  // [PAID] Workers Paid 1000 한도의 85%
function resetFetchBudget(max) {
  __fetchBudget = { used: 0, max: (typeof max === "number" && max > 0) ? max : 600 };
}
function fetchBudgetLeft() { return Math.max(0, __fetchBudget.max - __fetchBudget.used); }

// ═══════════════════════════════════════════════════════════════════════
// [PAID 가드] Workers Paid 한도 자동 셧다운 — 초과 과금 방지
// ───────────────────────────────────────────────────────────────────────
// Workers Paid ($5/월) 포함량:
//   • Requests: 10,000,000 / month  (초과 시 $0.30/M)
//   • CPU time: 30,000,000 ms / month  (초과 시 $0.02/M)
// 둘 중 하나가 USAGE_LIMITS.shutdownAt(기본 90%) 이상이면 enabled=false 자동 차단.
// 매월 1일 자동 리셋(yyyymm 키). cfg.usageLimits 로 사용자가 임계값 조정 가능.
const USAGE_LIMITS_DEFAULT = {
  enabled: true,            // 사용량 셧다운 활성 (false면 무제한)
  monthlyRequests: 10000000,  // Paid 포함 요청 수
  monthlyCpuMs: 30000000,     // Paid 포함 CPU ms
  shutdownAt: 0.90,         // 90% 도달 시 자동 셧다운 (예: 9.0M 요청)
  warnAt: 0.70,             // 70% 도달 시 WARN 로그
  // [정확도] Workers는 런타임 CPU측정 API가 없다. invocation의 "비(非)sleep 경과시간"은
  //   대부분 fetch/D1 I/O 대기라 실제 CPU보다 훨씬 크다 → 그 일부만 CPU로 추정(보수적).
  //   실제 CPU는 Cloudflare 대시보드에서 확인하고 이 값을 보정하면 셧다운이 정확해진다.
  cpuCalibration: 0.10
};
// [실시간] sleep 누적 — invocation 내 서브틱 대기는 CPU를 쓰지 않으므로 usage 계산에서 제외.
let __sleepAccumMs = 0;
function _sleep(ms) { __sleepAccumMs += ms; return new Promise(function(res){ setTimeout(res, ms); }); }
function _usageMonthKey(d) {
  const dt = d || new Date();
  return dt.getUTCFullYear() * 100 + (dt.getUTCMonth() + 1);
}
async function getUsageState(DB) {
  // state 키: usage:yyyymm = { requests, cpuMs, subreqs, lastShutdown, lastWarn }
  const mk = _usageMonthKey();
  try {
    const v = await getState(DB, "usage:" + mk, null);
    if (v && typeof v === "object") return { mk: mk, data: v };
  } catch (e) {}
  return { mk: mk, data: { requests: 0, cpuMs: 0, subreqs: 0, lastShutdown: 0, lastWarn: 0 } };
}
async function recordUsage(DB, deltaReq, deltaCpuMs, deltaSubreqs) {
  try {
    const u = await getUsageState(DB);
    u.data.requests = (u.data.requests || 0) + (deltaReq || 0);
    u.data.cpuMs = (u.data.cpuMs || 0) + (deltaCpuMs || 0);
    u.data.subreqs = (u.data.subreqs || 0) + (deltaSubreqs || 0);
    // [V63] 일별 분해 — 같은 레코드 안에 저장(추가 D1 호출 0). 사용량 그래프용.
    if (!u.data.days || typeof u.data.days !== "object") u.data.days = {};
    const dd = new Date().toISOString().slice(8, 10);
    const day = u.data.days[dd] || (u.data.days[dd] = { r: 0, c: 0, s: 0 });
    day.r += (deltaReq || 0);
    day.c += (deltaCpuMs || 0);
    day.s += (deltaSubreqs || 0);
    // [V66] invocation당 fetch 피크 — Workers 한도(1000/요청, 가드 850) 대비 여유 추적용
    if ((deltaSubreqs || 0) > (day.fp || 0)) day.fp = deltaSubreqs;
    await setState(DB, "usage:" + u.mk, u.data);
    return u.data;
  } catch (e) { return null; }
}
// 사이클 진입 전 호출: true 반환 시 즉시 스킵해야 함(셧다운 상태).
async function isUsageShutdown(DB, cfg) {
  try {
    // [강제 락] 관리자가 수동으로 엔진을 잠근 경우 즉시 차단 (추가과금 원천 차단)
    if (cfg && cfg.forceLock === true) {
      try { await log(DB, "WARN", null, "[FORCE LOCK] 관리자 강제 락 활성 — 모든 사이클 차단"); } catch (e) {}
      return true;
    }
    const lim = Object.assign({}, USAGE_LIMITS_DEFAULT, (cfg && cfg.usageLimits) || {});
    if (lim.enabled === false) return false;
    const u = await getUsageState(DB);
    const reqRatio = (u.data.requests || 0) / Math.max(1, lim.monthlyRequests);
    const cpuRatio = (u.data.cpuMs || 0) / Math.max(1, lim.monthlyCpuMs);
    const worst = Math.max(reqRatio, cpuRatio);
    if (worst >= lim.shutdownAt) {
      // 셧다운 로그는 한 시간에 한 번만 (DB 부담 방지)
      const now = Date.now();
      if (!u.data.lastShutdown || (now - u.data.lastShutdown) > 3600000) {
        u.data.lastShutdown = now;
        try { await setState(DB, "usage:" + u.mk, u.data); } catch (e) {}
        try {
          await log(DB, "ERROR", null,
            "[USAGE SHUTDOWN] " + (worst * 100).toFixed(1) + "% 도달 (req=" +
            (reqRatio * 100).toFixed(1) + "%, cpu=" + (cpuRatio * 100).toFixed(1) +
            "%) — 다음달 1일까지 모든 사이클 차단. 임계값은 cfg.usageLimits로 조정.");
        } catch (e) {}
      }
      return true;
    }
    if (worst >= lim.warnAt) {
      const now = Date.now();
      if (!u.data.lastWarn || (now - u.data.lastWarn) > 6 * 3600000) {
        u.data.lastWarn = now;
        try { await setState(DB, "usage:" + u.mk, u.data); } catch (e) {}
        try {
          await log(DB, "WARN", null,
            "[USAGE WARN] " + (worst * 100).toFixed(1) + "% 도달 — 셧다운 임계 " +
            (lim.shutdownAt * 100).toFixed(0) + "% 근접");
        } catch (e) {}
      }
    }
    return false;
  } catch (e) { return false; }
}
// 매 invocation 끝(또는 끝부분)에서 호출 — 누적 추적.
//   cpuMs는 (전체경과 − sleep) × cpuCalibration 으로 추정(I/O 대기를 CPU로 과대계상하지 않게).
async function tickUsage(DB, startedAt, calibration, extraSubreqs) {
  const wallActive = Math.max(1, (Date.now() - (startedAt || Date.now())) - __sleepAccumMs);
  const calib = (typeof calibration === "number" && calibration > 0) ? calibration : 0.10;
  return recordUsage(DB, 1, Math.round(wallActive * calib), extraSubreqs || 0);
}

let __yahooHostFlip = 0;
// === [V15] Yahoo crumb/cookie 캐시 — v7 batch quote 인증용 ===
let __yahooAuth = { cookie: null, crumb: null, ts: 0 };
async function getYahooAuth(DB) {
  // 메모리 캐시 (같은 invocation 내)
  if (__yahooAuth.crumb && (Date.now() - __yahooAuth.ts) < 30 * 60 * 1000) return __yahooAuth;
  // D1 공유 캐시 (샤드 간 — 별도 invocation이라 메모리 공유 안 됨)
  if (DB) {
    try {
      const shared = await getState(DB, "yahoo_auth", null);
      if (shared && shared.crumb && (Date.now() - shared.ts) < 30 * 60 * 1000) {
        __yahooAuth = shared;
        return __yahooAuth;
      }
    } catch (e) {}
  }
  try {
    const ctrlA = new AbortController();
    const timerA = setTimeout(function(){ try { ctrlA.abort(); } catch (e) {} }, 8000);
    const r1 = await fetch("https://fc.yahoo.com/", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" },
      signal: ctrlA.signal
    });
    clearTimeout(timerA);
    let cookie = r1.headers.get("set-cookie") || "";
    cookie = cookie.split(";")[0];
    const ctrlB = new AbortController();
    const timerB = setTimeout(function(){ try { ctrlB.abort(); } catch (e) {} }, 8000);
    const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Cookie": cookie
      },
      signal: ctrlB.signal
    });
    clearTimeout(timerB);
    const crumb = (await r2.text()).trim();
    if (crumb && crumb.length < 30 && crumb.indexOf("<") === -1) {
      __yahooAuth = { cookie: cookie, crumb: crumb, ts: Date.now() };
      if (DB) { try { await setState(DB, "yahoo_auth", __yahooAuth); } catch (e) {} }
    }
  } catch (e) { /* 실패 시 기존값 유지 — v8 폴백이 처리 */ }
  return __yahooAuth;
}
async function yahooFetch(url, extraHeaders) {
  if (__fetchBudget.used >= __fetchBudget.max) {
    throw new Error("fetch budget exceeded (" + __fetchBudget.used + "/" + __fetchBudget.max + ")");
  }
  __fetchBudget.used++;
  // query1 ↔ query2 호스트 로테이션 (한 호스트 IP 차단 회피)
  let u = url;
  if (u.indexOf("query1.finance.yahoo.com") !== -1) {
    __yahooHostFlip = (__yahooHostFlip + 1) % 2;
    if (__yahooHostFlip === 1) u = u.replace("query1.finance.yahoo.com", "query2.finance.yahoo.com");
  }
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/"
  };
  if (extraHeaders) { for (const k in extraHeaders) headers[k] = extraHeaders[k]; }
  // 429/5xx/네트워크 실패 시 지수 백오프로 최대 3회 재시도
  // [V9.1] 각 fetch에 8초 타임아웃(AbortController) — 야후가 응답을 안 주고 매달리면
  //   invocation 전체가 멈춰 사이클 중단·락 잔존(엔진 지연)을 유발하므로 강제로 끊는다.
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let timer = null;
    try {
      const ctrl = new AbortController();
      timer = setTimeout(function(){ try { ctrl.abort(); } catch (e) {} }, 8000);
      const r = await fetch(u, { headers: headers, signal: ctrl.signal });
      clearTimeout(timer); timer = null;
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) {
        lastErr = new Error("HTTP " + r.status);
        await new Promise(function(res){ setTimeout(res, 250 * Math.pow(2, attempt) + Math.random() * 200); });
        continue;
      }
      throw new Error("HTTP " + r.status);
    } catch (e) {
      if (timer) { clearTimeout(timer); timer = null; }
      lastErr = e;
      if (/HTTP 4(0[0-9]|[1-9][0-9])/.test(e.message || "") && !/HTTP 429/.test(e.message || "")) throw e;
      await new Promise(function(res){ setTimeout(res, 250 * Math.pow(2, attempt) + Math.random() * 200); });
    }
  }
  throw lastErr || new Error("yahooFetch failed");
}

// === [V10] 배치 quote — 여러 종목 현재가/등락률을 한 번의 호출로 ===
//   Yahoo v7/finance/quote 엔드포인트. URL 하나에 심볼을 콤마로 묶어 전송.
//   한 호출에 최대 ~50종목 (URL 길이/안정성 고려). 시계열은 주지 않음 — 현재가/등락률 전용.
//   반환: { symbol: { price, prevClose, dayPct } } 맵
// [V11 FIX] Yahoo v7/finance/quote 는 crumb/cookie 인증을 요구해 워커 환경에서
//   대부분 401/403/429 로 실패한다(→ batchQuotes 거의 빈 객체 → 라운드로빈으로
//   채워진 일부 종목만 watchlist 에 노출되던 버그의 직접 원인).
//   v7 을 먼저 시도하되, 실패하거나 누락된 심볼은 인증 불필요한 v8/finance/chart
//   엔드포인트(meta 만 사용, range=1d)로 폴백해 가격/등락률을 채운다.
async function fetchQuoteViaChart(symbol) {
  // chart meta 만 필요 — 가장 가벼운 1d/1d 요청
  const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) + "?interval=1d&range=1d");
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) return null;
  const meta = result.meta || {};
  const closesRaw = (result.indicators && result.indicators.quote && result.indicators.quote[0] &&
                     result.indicators.quote[0].close) || [];
  const closes = closesRaw.filter(function(c){ return typeof c === "number" && !isNaN(c) && c > 0; });
  const price = (typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0)
    ? meta.regularMarketPrice : (closes.length ? closes[closes.length - 1] : null);
  if (price == null) return null;
  const prevClose = (typeof meta.chartPreviousClose === "number" && meta.chartPreviousClose > 0)
    ? meta.chartPreviousClose
    : (typeof meta.previousClose === "number" && meta.previousClose > 0 ? meta.previousClose : price);
  const dayPct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
  return { price: price, prevClose: prevClose || price, dayPct: dayPct };
}

async function fetchQuoteViaChartFallback(symbol) {
  // 한국 종목은 .KS ↔ .KQ 스왑 재시도 (429/5xx 재시도는 yahooFetch가 내부 처리)
  try {
    const q = await fetchQuoteViaChart(symbol);
    if (q) return q;
  } catch (e) { /* fall through to suffix swap */ }
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) {
    const alt = symbol.endsWith(".KS") ? symbol.replace(".KS", ".KQ") : symbol.replace(".KQ", ".KS");
    try {
      const q2 = await fetchQuoteViaChart(alt);
      if (q2) return q2;
    } catch (e2) { /* fall through */ }
  }
  return null;
}

async function fetchBatchQuotes(symbols, opts) {
  opts = opts || {};
  const out = {};
  if (!symbols || symbols.length === 0) return out;

  // --- 0) [V9.2] KR 실시간 — 네이버 폴링이 "기본 진실원"(네이버 증권 표시값과 동일) ---
  //   야후는 한국 종목의 거래소 접미사(.KS=코스피/.KQ=코스닥)가 틀린 경우가 많아 폐기된
  //   옛 시세를 반환한다(예: 코스닥 펩트론 087010을 .KS로 조회 시 1년 전 81,000원).
  //   → 네이버 값을 채택하고 야후는 아래 머지에서 검증용으로만 비교(괴리 시 WARN).
  //   60종목/1콜 배치라 subrequest 절약(324종목=6콜). nv=현재가, sv=기준가(전일종가).
  const naverXV = {};
  const krSyms = symbols.filter(function(s){ return s.endsWith(".KS") || s.endsWith(".KQ"); });
  if (krSyms.length > 0 && fetchBudgetLeft() > 2) {
    const codeMap = {};
    for (const s of krSyms) codeMap[s.split(".")[0]] = s;
    const codes = Object.keys(codeMap);
    const NB = 60;
    const nslices = [];
    for (let i = 0; i < codes.length; i += NB) nslices.push(codes.slice(i, i + NB));
    await Promise.all(nslices.map(async function(sl){
      if (fetchBudgetLeft() <= 0) return;
      __fetchBudget.used++;
      try {
        // [V9.3] 구분자 | → , (네이버 API 변경: 파이프는 배치당 1개만 반환, 쉼표는 전체 반환)
        const r = await fetch("https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:" + sl.join(","),
          { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com" } });
        if (!r.ok) return;
        const j = await r.json();
        const datas = (j && j.result && j.result.areas && j.result.areas[0] && j.result.areas[0].datas) || [];
        for (const d of datas) {
          const sym = codeMap[d.cd];
          if (!sym) continue;
          const nv = Number(d.nv), sv = Number(d.sv);
          if (!(nv > 0)) continue;
          const prev = (sv > 0) ? sv : nv;
          naverXV[sym] = { price: nv, prevClose: prev, dayPct: prev ? ((nv - prev) / prev) * 100 : 0, rt: 1 };
        }
      } catch (e) {}
    }));
  }

  // --- 1) v7 batch 시도 (성공하면 호출 수가 적어 가장 효율적) ---
  //   [V11] v7 은 crumb 인증이 없으면 전면 차단(401/403/429)되는 경우가 많다.
  //         첫 배치가 0건이면 이후 배치도 실패할 게 뻔하므로 즉시 포기하고 v8 폴백으로
  //         넘어가 예산(subrequest)을 아낀다.
  const BATCH = 50;
  const auth = await getYahooAuth(opts.DB || null);
  function parseV7(j) {
    let got = 0;
    const rows = (j && j.quoteResponse && j.quoteResponse.result) || [];
    for (const row of rows) {
      const sym = row.symbol;
      const price = (typeof row.regularMarketPrice === "number" && row.regularMarketPrice > 0)
        ? row.regularMarketPrice : null;
      const prevClose = (typeof row.regularMarketPreviousClose === "number" && row.regularMarketPreviousClose > 0)
        ? row.regularMarketPreviousClose : (typeof row.chartPreviousClose === "number" ? row.chartPreviousClose : null);
      let dayPct = (typeof row.regularMarketChangePercent === "number") ? row.regularMarketChangePercent : null;
      if (dayPct == null && price != null && prevClose) dayPct = ((price - prevClose) / prevClose) * 100;
      if (price != null) { out[sym] = { price: price, prevClose: prevClose || price, dayPct: dayPct != null ? dayPct : 0 }; got++; }
    }
    return got;
  }
  function v7Url(slice) {
    let url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
              slice.map(function(s){ return encodeURIComponent(s); }).join(",");
    if (auth && auth.crumb) url += "&crumb=" + encodeURIComponent(auth.crumb);
    return url;
  }
  const v7Headers = auth && auth.cookie ? { "Cookie": auth.cookie } : null;
  // 슬라이스 목록 구성
  const slices = [];
  const v7Targets = symbols.filter(function(s){ return !out[s]; });  // [V9.1] KR 포함 전 종목 야후 조회(기본 소스) — 네이버는 교차검증용
  for (let i = 0; i < v7Targets.length; i += BATCH) slices.push(v7Targets.slice(i, i + BATCH));
  let v7Dead = false;
  if (slices.length > 0 && fetchBudgetLeft() > 0) {
    // 1) 첫 배치로 v7 생존 확인
    let firstGot = 0;
    try { firstGot = parseV7(await yahooFetch(v7Url(slices[0]), v7Headers)); } catch (e) {}
    if (firstGot === 0) {
      v7Dead = true;
    } else if (slices.length > 1) {
      // 2) 나머지 배치 병렬 실행 (예산 내)
      const rest = slices.slice(1).filter(function(){ return fetchBudgetLeft() > 0; });
      await Promise.all(rest.map(async function(slice){
        if (fetchBudgetLeft() <= 0) return;
        try { parseV7(await yahooFetch(v7Url(slice), v7Headers)); } catch (e) {}
      }));
    }
  }

  // --- 2) v7 으로 채워지지 않은 심볼만 v8 chart 로 폴백 ---
  //   v7 이 전면 차단된 환경에서는 missing 이 전 종목이 되므로, Cloudflare
  //   subrequest 한도를 넘지 않게 한 사이클당 maxFallback 개만 라운드로빈으로 처리한다.
  //   이전 사이클에서 저장된 quote 는 호출부(prevQuoteMap 병합 + ON CONFLICT UPDATE)에서
  //   보존되므로, 여러 사이클에 걸쳐 전 종목이 한 바퀴 채워진다.
  let missing = symbols.filter(function(s){ return !out[s]; });
  const maxFallback = (typeof opts.maxFallback === "number" && opts.maxFallback > 0)
    ? opts.maxFallback : missing.length;
  if (missing.length > maxFallback) {
    const off = ((typeof opts.fallbackOffset === "number" && opts.fallbackOffset >= 0)
      ? opts.fallbackOffset : 0) % missing.length;
    const rotated = missing.slice(off).concat(missing.slice(0, off));
    missing = rotated.slice(0, maxFallback);
  }

  const CBATCH = 10;
  for (let i = 0; i < missing.length; i += CBATCH) {
    if (fetchBudgetLeft() <= 0) break;  // [V11] 예산 소진 시 중단 (나머지는 다음 사이클)
    const slice = missing.slice(i, i + CBATCH);
    const results = await Promise.all(slice.map(async function(sym){
      try { return { sym: sym, q: await fetchQuoteViaChartFallback(sym) }; }
      catch (e) { return { sym: sym, q: null }; }
    }));
    for (const r of results) {
      if (r.q) out[r.sym] = r.q;
    }
  }

  // --- 3) [V9.1] KR 교차검증 머지 — 야후(기본) vs 네이버(실시간 검증) ---
  //   야후 KR은 15분 지연이므로 양쪽이 ±5% 내로 일치하면 실시간(네이버) 값을 채택해
  //   현실과의 시차를 없앤다. 5% 초과 괴리는 한쪽 소스 오염으로 보고 야후 유지 + WARN.
  const XV_TOL = 0.05;
  const xvMismatch = [];
  for (const sym of Object.keys(naverXV)) {
    const nq = naverXV[sym], yq = out[sym];
    // [V9.2] KR은 네이버(=네이버 증권, 사용자가 보는 실제값)가 "기본 진실원".
    //   야후는 한국 종목의 거래소 접미사(.KS/.KQ)가 틀린 경우가 많아(코스닥 종목을 .KS로
    //   조회 등) 폐기된 옛 시세를 반환한다 → 직전 V9.1b "야후 우선"이 KR 전체를 오염시켰음.
    //   따라서 네이버 값을 항상 채택하고, 야후는 검증용으로만 비교(괴리 시 WARN).
    out[sym] = Object.assign({}, nq, { xv: 1 });
    if (yq && yq.price > 0) {
      const diff = Math.abs(yq.price - nq.price) / nq.price;
      if (diff > XV_TOL) xvMismatch.push(sym + " naver=" + nq.price + " yahoo=" + yq.price);
    }
  }
  if (xvMismatch.length > 0 && opts.DB) {
    try { await log(opts.DB, "WARN", null, "[XV] 야후 KR 시세 의심(접미사 오류 가능) " + xvMismatch.length + "건 — 네이버값 사용: " + xvMismatch.slice(0, 8).join(", ")); } catch (e) {}
  }

  return out;
}

// ============================================================
// [신규·인터마켓] 시장 컨텍스트 — 외부 위험선호(risk-on/off) 신호를 1 subrequest로 수집
// ============================================================
//   주식 외 자산의 움직임은 주식 방향의 선행/동행 신호다(인터마켓 분석):
//     • HYG (하이일드 회사채): 신용 스트레스. 급락=위험회피(주식 선행 악재)
//     • BTC-USD: 위험선호 심리 (상승=risk-on)
//     • UUP (달러): 강세=주식·원자재 역풍
//     • ^VIX9D: 단기 공포지수 (급등=위험회피)
//     • TLT (장기국채): 급등=안전자산 도피(위험회피)
//   [예산 안전] 여러 심볼을 1 batch quote(=1 subrequest)로만 수집 + 캐시(refreshMinutes)로
//   호출 최소화. 게다가 월 사용량이 enrichMaxUsageRatio(코어 셧다운보다 낮은 임계)를 넘으면
//   "코어 거래 보호"를 위해 enrichment를 먼저 중단 → 한도 여유분을 항상 남긴다.
const MARKET_CONTEXT_DEFAULT = {
  enabled: true,
  symbols: ["HYG", "BTC-USD", "UUP", "^VIX9D", "TLT"],
  refreshMinutes: 12,          // 캐시 주기(분) — 이 주기 내엔 재fetch 안 함
  enrichMaxUsageRatio: 0.75,   // [여유분 보장] 월 사용량 75% 넘으면 enrichment 중단(코어 거래 우선)
  minBudgetReserve: 8,         // invocation subrequest 잔여가 이 미만이면 스킵(코어용 예비)
  riskOffScale: 0.6,           // 강한 risk-off 시 신규매수 사이즈 하한 배수
  riskOnBoost: 1.12            // 강한 risk-on 시 사이즈 상한 부스트(과하지 않게)
};
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// 위험선호 점수(-1 위험회피 ~ +1 위험선호) 산정 — 보수적 가중치.
function _computeRiskScore(q) {
  let s = 0;
  const d = function(sym){ return (q[sym] && typeof q[sym].dayPct === "number") ? q[sym].dayPct : 0; };
  s += _clamp(d("HYG") * 0.5, -0.40, 0.40);    // 신용(가장 중요)
  s += _clamp(d("BTC-USD") * 0.04, -0.25, 0.25); // 위험심리
  s -= _clamp(d("UUP") * 0.20, -0.20, 0.20);    // 달러강세=역풍
  s -= _clamp(d("^VIX9D") * 0.025, -0.30, 0.30); // 공포
  s -= _clamp(d("TLT") * 0.08, -0.15, 0.15);    // 안전자산 도피
  return _clamp(s, -1, 1);
}
// 시장 컨텍스트 갱신(예산 가드 포함). 반환: {riskScore, regime, sizeScale, ts, detail} 또는 캐시/null.
async function updateMarketContext(DB, cfg) {
  const mc = Object.assign({}, MARKET_CONTEXT_DEFAULT, (cfg && cfg.marketContext) || {});
  if (mc.enabled === false) return null;
  let cached = null;
  try { cached = await getState(DB, "mkt_context", null); } catch (e) {}
  // 1) 캐시 신선하면 그대로 사용 (fetch 0)
  if (cached && cached.ts && (Date.now() - cached.ts) < (mc.refreshMinutes || 12) * 60000) return cached;
  // 2) [여유분 보장] 월 사용량이 enrich 임계 초과면 enrichment 중단 — 만료 캐시라도 반환(코어 보호)
  try {
    const u = await getUsageState(DB);
    const lim = Object.assign({}, USAGE_LIMITS_DEFAULT, (cfg && cfg.usageLimits) || {});
    const ratio = Math.max((u.data.requests || 0) / Math.max(1, lim.monthlyRequests),
                           (u.data.cpuMs || 0) / Math.max(1, lim.monthlyCpuMs));
    if (ratio >= (mc.enrichMaxUsageRatio != null ? mc.enrichMaxUsageRatio : 0.75)) return cached;
  } catch (e) {}
  // 3) invocation subrequest 잔여 예산이 부족하면 코어용으로 양보
  if (fetchBudgetLeft() < (mc.minBudgetReserve || 8)) return cached;
  // 4) 1 batch quote(=1 subrequest)로 수집
  let q;
  try { q = await fetchBatchQuotes(mc.symbols, { DB: DB }); } catch (e) { return cached; }
  if (!q || Object.keys(q).length < 2) return cached;  // 데이터 부족 시 캐시 유지
  const riskScore = _computeRiskScore(q);
  const offScale = mc.riskOffScale || 0.6;
  const onBoost = mc.riskOnBoost || 1.12;
  let regime = "neutral", sizeScale = 1.0;
  if (riskScore <= -0.4) {              // 강한 위험회피 → 하한
    regime = "risk_off"; sizeScale = offScale;
  } else if (riskScore < -0.15) {       // 주의 → -0.15~-0.4 구간을 1.0~offScale로 선형 축소
    regime = "caution";
    sizeScale = 1 - (1 - offScale) * ((-0.15 - riskScore) / 0.25);
  } else if (riskScore >= 0.4) {        // 강한 위험선호 → 상한 부스트
    regime = "risk_on"; sizeScale = onBoost;
  } else if (riskScore > 0.15) {        // 완만한 위험선호 → 0.15~0.4를 1.0~onBoost로 선형 확대
    regime = "mild_on";
    sizeScale = 1 + (onBoost - 1) * ((riskScore - 0.15) / 0.25);
  }
  const detail = mc.symbols.map(function(s){ return s + (q[s] ? (q[s].dayPct >= 0 ? "+" : "") + q[s].dayPct.toFixed(1) : "?"); }).join(" ");
  const ctx = { riskScore: riskScore, regime: regime, sizeScale: _clamp(sizeScale, 0.5, 1.2), ts: Date.now(), detail: detail };
  try { await setState(DB, "mkt_context", ctx); } catch (e) {}
  try { await log(DB, "INFO", null, "[MKT-CTX] " + regime + " score=" + riskScore.toFixed(2) + " size×" + ctx.sizeScale.toFixed(2) + " · " + detail); } catch (e) {}
  return ctx;
}

// === [섹터 뉴스] Yahoo Finance RSS 무료 뉴스 감성 분석 ===
// API 키 불필요. 6개 섹터 그룹별 대표 티커 RSS 1 subreq/그룹. 키워드 감성 → sizeScale 조정.
const SECTOR_NEWS_REP = {
  TECH:       "NVDA,AAPL,MSFT,GOOGL,META",
  FINANCE:    "JPM,GS,BAC,BRK-B,V",
  HEALTH:     "LLY,JNJ,UNH,PFE,ISRG",
  CONSUMER:   "AMZN,TSLA,WMT,KO,DIS",
  INDUSTRIAL: "CAT,GE,RTX,BA,LMT",
  RESOURCES:  "XOM,CVX,NEE,FCX,LIN"
};
const _NEWS_POS = ["beat","upgrade","strong","growth","record","bullish","surge","rally","above","exceed","profit","buyback","raise","outperform","positive","robust","momentum","rebound","recovery","boom","soar"];
const _NEWS_NEG = ["miss","downgrade","cut","loss","warning","weak","bearish","crash","layoff","recall","concern","decline","drop","fell","tumble","below","disappoint","risk","lawsuit","probe","halt","fraud","slump"];

function _scoreHeadlines(titles) {
  let pos = 0, neg = 0;
  for (const t of titles) {
    const low = t.toLowerCase();
    for (const w of _NEWS_POS) if (low.includes(w)) pos++;
    for (const w of _NEWS_NEG) if (low.includes(w)) neg++;
  }
  const total = Math.max(titles.length, 1);
  return _clamp((pos - neg) / (pos + neg + total * 0.3), -1, 1);
}

async function updateSectorNewsSentiment(DB, cfg) {
  const sc = Object.assign({ enabled:true, refreshHours:6, enrichMaxUsageRatio:0.82, minBudgetReserve:8, posScaleMax:1.08, negScaleMin:0.88 }, (cfg && cfg.sectorNews) || {});
  if (sc.enabled === false) return null;
  let cached = null;
  try { cached = await getState(DB, "sector_news_sentiment", null); } catch(e) {}
  if (cached && cached.ts && (Date.now() - cached.ts) < (sc.refreshHours || 6) * 3600000) return cached;
  try {
    const u = await getUsageState(DB);
    const lim = Object.assign({}, USAGE_LIMITS_DEFAULT, (cfg && cfg.usageLimits) || {});
    const ratio = Math.max((u.data.requests||0)/Math.max(1,lim.monthlyRequests), (u.data.cpuMs||0)/Math.max(1,lim.monthlyCpuMs));
    if (ratio >= sc.enrichMaxUsageRatio) return cached;
  } catch(e) {}
  const groups = Object.keys(SECTOR_NEWS_REP);
  if (fetchBudgetLeft() < (sc.minBudgetReserve || 8) + groups.length) return cached;
  const scores = {}, headlines = {};
  for (const grp of groups) {
    if (fetchBudgetLeft() < (sc.minBudgetReserve || 8) + 1) break;
    const url = "https://feeds.finance.yahoo.com/rss/2.0/headline?s=" + SECTOR_NEWS_REP[grp] + "&lang=en-US&region=US";
    try {
      const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible)" } });
      if (!resp.ok) continue;
      const xml = await resp.text();
      // 제목 + 링크 + 발행시각 함께 추출
      const items = [];
      const itemBlocks = xml.split(/<item[\s>]/);
      for (const block of itemBlocks.slice(1)) {
        const titleM = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
        const linkM  = block.match(/<link>([\s\S]*?)<\/link>/);
        const pubM   = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const title  = titleM ? titleM[1].trim() : null;
        if (title) items.push({
          title: title,
          link:  linkM  ? linkM[1].trim()  : null,
          pub:   pubM   ? pubM[1].trim()   : null
        });
        if (items.length >= 10) break;
      }
      if (items.length > 0) {
        headlines[grp] = items;
        scores[grp] = _scoreHeadlines(items.map(function(i){ return i.title; }));
      }
    } catch(e) {}
  }
  const posMax = sc.posScaleMax || 1.08, negMin = sc.negScaleMin || 0.88;
  const scales = {};
  for (const grp of groups) {
    const s = typeof scores[grp] === "number" ? scores[grp] : 0;
    scales[grp] = s >= 0 ? (1 + s * (posMax - 1)) : (1 + s * (1 - negMin));
  }
  const result = { scales, scores, headlines, ts: Date.now() };
  try { await setState(DB, "sector_news_sentiment", result); } catch(e) {}
  const detail = groups.map(g => g + (scores[g] != null ? (scores[g]>=0?"+":"")+scores[g].toFixed(2) : "=?")).join(" ");
  try { await log(DB, "INFO", null, "[SECTOR-NEWS] " + detail); } catch(e) {}
  return result;
}

// === [V10] 한국 종목 일봉 fetch — .KS 실패 시 .KQ 자동 재시도 ===
//   KRX300에 코스닥 종목이 섞여 있어 접미사가 갈릴 수 있음.
//   .KS로 데이터가 안 나오면 .KQ로 한 번 더 시도. 성공한 심볼을 반환해 이후 캐시키 일관성 유지.
async function fetchDailyWithFallback(symbol) {
  try {
    const d = await fetchDailyFull(symbol);
    if (d && d.closes && d.closes.length > 0) return { data: d, resolvedSymbol: symbol };
  } catch (e) { /* fall through */ }
  // .KS ↔ .KQ 스왑 재시도 (한국 종목만)
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) {
    const alt = symbol.endsWith(".KS") ? symbol.replace(".KS", ".KQ") : symbol.replace(".KQ", ".KS");
    try {
      const d2 = await fetchDailyFull(alt);
      if (d2 && d2.closes && d2.closes.length > 0) return { data: d2, resolvedSymbol: alt };
    } catch (e2) { /* fall through */ }
  }
  return null;
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

// ═══════════════════════════════════════════════════════════════════════
// [분봉] 진입 타이밍 확인용 분봉(intraday minute candle) 조회
// ───────────────────────────────────────────────────────────────────────
// 전 종목이 아니라 "진입 후보 종목"에만 선택적으로 호출(호출 1회/종목)한다.
// 5분봉이 기본 — 1분봉은 노이즈가 크고, 5분봉이 장중 추세/되돌림 판단에 적합.
// 반환: VWAP, 최근 모멘텀(마지막 N봉 수익률), 당일 고/저, OHLCV 배열.
async function fetchMinuteBars(symbol, opts) {
  const interval = (opts && opts.interval) || "5m";
  const range = (opts && opts.range) || "1d";
  const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) + "?interval=" + interval + "&range=" + range);
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("no minute data");
  const meta = result.meta || {};
  const q = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const tarr = result.timestamp || [];
  const rc = q.close || [], rh = q.high || [], rl = q.low || [], rv = q.volume || [];
  const closes = [], highs = [], lows = [], volumes = [], times = [];
  for (let i = 0; i < rc.length; i++) {
    const c = rc[i];
    if (typeof c !== "number" || isNaN(c) || c <= 0) continue;
    closes.push(c);
    highs.push((typeof rh[i] === "number" && rh[i] > 0) ? rh[i] : c);
    lows.push((typeof rl[i] === "number" && rl[i] > 0) ? rl[i] : c);
    volumes.push((typeof rv[i] === "number" && rv[i] > 0) ? rv[i] : 0);
    times.push(tarr[i] || 0);
  }
  if (closes.length === 0) throw new Error("no minute close");
  const price = (typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0)
    ? meta.regularMarketPrice : closes[closes.length - 1];
  // VWAP — 일반적가격(H+L+C)/3 × 거래량 누적
  // [V52] vwapSeries도 누적 계산 — 최근 VWAP 기울기(vwapSlope, %/bar)로 장중 추세 방향 판정 (추가 fetch 0)
  let pv = 0, vv = 0;
  const vwapSeries = [];
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    pv += tp * volumes[i]; vv += volumes[i];
    vwapSeries.push(vv > 0 ? pv / vv : null);
  }
  const vwap = vv > 0 ? pv / vv : null;
  let vwapSlope = null;
  {
    const lookV = Math.min(6, vwapSeries.length - 1);
    const vNow = vwapSeries[vwapSeries.length - 1];
    const vPast = lookV > 0 ? vwapSeries[vwapSeries.length - 1 - lookV] : null;
    if (vNow != null && vPast != null && vPast > 0) vwapSlope = ((vNow - vPast) / vPast) * 100 / lookV;
  }
  // 최근 모멘텀 — 마지막 N봉(기본 3봉=15분) 수익률
  const n = Math.min(3, closes.length - 1);
  const recentMom = n > 0
    ? ((closes[closes.length - 1] - closes[closes.length - 1 - n]) / closes[closes.length - 1 - n]) * 100
    : 0;
  const dayHigh = Math.max.apply(null, highs);
  const dayLow = Math.min.apply(null, lows);
  return {
    symbol: symbol, interval: interval, price: price, vwap: vwap, vwapSlope: vwapSlope,
    recentMom: recentMom, dayHigh: dayHigh, dayLow: dayLow,
    closes: closes, highs: highs, lows: lows, volumes: volumes, times: times
  };
}

// [분봉] 진입 직전 장중 타이밍 확인 — 분봉 데이터로 추격/급락 진입을 차단.
//   mb 없으면(조회 실패/예산초과) 통과(기존 동작 보존, 분봉은 보조 게이트일 뿐).
//   반환: { ok:true, confidenceBoost? } 또는 { ok:false, reason }
//   [강화] VWAP 근접 + 상승 모멘텀 시 confidenceBoost(0~0.15) 추가 — 최적 타이밍 보상.
function confirmIntradayEntry(mb, price, rules) {
  if (!mb) return { ok: true };
  const r = rules || {};
  // 1) 장중 급락 진입 금지 — 최근 분봉 모멘텀이 임계 이하면 칼날잡기로 보고 차단
  const momMin = (r.momMin != null) ? r.momMin : -1.5;
  if (typeof mb.recentMom === "number" && mb.recentMom <= momMin) {
    return { ok: false, reason: "INTRADAY_DUMP " + mb.recentMom.toFixed(2) + "%" };
  }
  // 2) VWAP 과열 — 가격이 당일 VWAP보다 과도하게 높으면 추격매수로 보고 차단
  const vwapMaxPct = (r.vwapMaxPct != null) ? r.vwapMaxPct : 3.5;
  let aboveVwap = null;
  if (mb.vwap && mb.vwap > 0 && price > 0) {
    aboveVwap = ((price - mb.vwap) / mb.vwap) * 100;
    if (aboveVwap > vwapMaxPct) {
      return { ok: false, reason: "VWAP_CHASE +" + aboveVwap.toFixed(2) + "%" };
    }
  }
  // 3) [강화] VWAP 근접 + 상승 모멘텀 → 최적 진입 타이밍 → confidence boost
  //    VWAP ±vwapBoostPct% 이내 + recentMom ≥ momBoostMin% → 진입 신뢰도 상향
  let confidenceBoost = 0;
  const vwapBoostPct = (r.vwapBoostPct != null) ? r.vwapBoostPct : 0.5;
  const momBoostMin = (r.momBoostMin != null) ? r.momBoostMin : 0.8;
  if (aboveVwap != null && Math.abs(aboveVwap) <= vwapBoostPct && typeof mb.recentMom === "number" && mb.recentMom >= momBoostMin) {
    // VWAP 지지 + 상승 모멘텀: 최적 진입 → sizeBoost 부여
    confidenceBoost = Math.min(0.15, mb.recentMom * 0.05);  // mom 1% = +0.05 boost (최대 0.15)
  }
  return { ok: true, confidenceBoost: confidenceBoost };
}

async function fetchDailyFull(symbol) {
  // [강화] range 3mo→1y: MA200 장기추세 필터·52주 신고가·60일 모멘텀(computeAlphaQuality)을 실제로 활성화.
  //   지표는 모두 last-N 윈도우만 쓰므로 MA20/50·RSI·ATR 결과는 불변, MA200/52w/장기모멘텀만 새로 가능.
  //   일봉은 DB 캐시(cacheMin)라 fetch 빈도 영향 작음.
  const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=1y");
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("no daily data");
  const meta = result.meta || {};
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  // [수정] highs/lows도 같이 추출 — ATR True Range 계산용
  // [V52] opens도 추출 — 갭(시가-전일종가) 분석용 신규 유입 정보 (같은 fetch, 추가 호출 0)
  const rawCloses = quote.close || [];
  const rawHighs = quote.high || [];
  const rawLows = quote.low || [];
  const rawVols = quote.volume || [];
  const rawOpens = quote.open || [];
  // 인덱스 정렬을 유지하면서 null을 가진 row 전체를 제거
  const closes = [], highs = [], lows = [], volumes = [], opens = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = rawCloses[i], h = rawHighs[i], l = rawLows[i], v = rawVols[i], o = rawOpens[i];
    if (typeof c !== "number" || isNaN(c) || c <= 0) continue;
    closes.push(c);
    highs.push((typeof h === "number" && !isNaN(h) && h > 0) ? h : c);
    lows.push((typeof l === "number" && !isNaN(l) && l > 0) ? l : c);
    volumes.push((typeof v === "number" && !isNaN(v) && v > 0) ? v : 0);
    opens.push((typeof o === "number" && !isNaN(o) && o > 0) ? o : c);
  }
  if (closes.length === 0) throw new Error("no daily close");
  // [V9.2] stale meta 가드 — 야후가 접미사 오류(코스닥 종목 .KS 조회 등) 시 일봉 캔들은
  //   최신인데 meta.regularMarketPrice는 1년 전 폐기값을 주는 경우가 있다(예: 펩트론 .KS=81,000원).
  //   meta 시각이 마지막 캔들보다 오래됐거나, meta가가 마지막 종가와 20% 이상 어긋나면
  //   meta를 버리고 일봉 마지막 종가를 현재가로 사용한다(지표 오염 방지).
  const lastClose = closes[closes.length - 1];
  const tsArr = result.timestamp || [];
  const lastCandleTs = tsArr.length ? tsArr[tsArr.length - 1] : 0;
  const metaTs = meta.regularMarketTime || 0;
  let metaOk = (typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0);
  if (metaOk && metaTs && lastCandleTs && metaTs < lastCandleTs - 2 * 86400) metaOk = false;  // meta 2일+ 뒤처짐
  if (metaOk && Math.abs(meta.regularMarketPrice - lastClose) / lastClose > 0.20) metaOk = false;  // 마지막 종가와 20%+ 괴리
  const price = metaOk ? meta.regularMarketPrice : lastClose;
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : price;
  return { symbol: symbol, price: price, prevClose: prevClose, closes: closes, highs: highs, lows: lows, volumes: volumes, opens: opens };
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
    opens: data.opens,        // [V52] 갭 분석용
    prevClose: data.prevClose,
    ts: Date.now()
  };
  await setState(DB, "daily:" + symbol, toCache);
  return toCache;
}

// ════════════════════════════════════════════════════════════════════════════
// [V61] 차트/캔들 패턴 감지 (finviz식) — 프론트 TA와 동일 로직의 서버 포팅.
//   일봉 캐시(opens/highs/lows/closes)만 사용 → 추가 fetch 0.
//   거래 로직(evaluateAllStrategies)의 사이즈 차등 + /api/ta-screener 전체 스캔에 사용.
// ════════════════════════════════════════════════════════════════════════════
function taBuildCandles(dailyData, maxN) {
  const c = dailyData && dailyData.closes, o = dailyData && dailyData.opens;
  const h = dailyData && dailyData.highs, l = dailyData && dailyData.lows;
  if (!c || !h || !l || c.length < 30) return null;
  const n = c.length;
  const s = Math.max(0, n - (maxN || 130));
  const out = [];
  for (let i = s; i < n; i++) {
    out.push({ o: (o && typeof o[i] === "number" && o[i] > 0) ? o[i] : c[i], h: h[i], l: l[i], c: c[i] });
  }
  return out;
}
function taDetectPatterns(dailyData) {
  const cs = taBuildCandles(dailyData, 130);
  if (!cs || cs.length < 30) return null;
  const out = [];
  const n = cs.length;
  function add(name, dir, kind) { out.push({ name: name, dir: dir, kind: kind }); }
  const B = function(x){ return Math.abs(x.c - x.o); };
  const R = function(x){ return Math.max(1e-9, x.h - x.l); };
  const UP = function(x){ return x.h - Math.max(x.o, x.c); };
  const LO = function(x){ return Math.min(x.o, x.c) - x.l; };
  const G = function(x){ return x.c > x.o; };
  const D = function(x){ return x.c < x.o; };
  function trend(end, m) {
    const st = Math.max(0, end - m), cnt = end - st;
    if (cnt < 3) return 0;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = st; i < end; i++) { const x = i - st, y = cs[i].c; sx += x; sy += y; sxy += x * y; sxx += x * x; }
    const slope = (cnt * sxy - sx * sy) / Math.max(1e-9, cnt * sxx - sx * sx);
    return slope / (sy / cnt) * 100;
  }
  // ── 캔들 패턴 (최근 3봉) ──
  for (let k = n - 1; k >= Math.max(n - 3, 2); k--) {
    const x = cs[k], p = cs[k - 1], pp = cs[k - 2];
    const tr = trend(k, 7), b = B(x), r = R(x), up = UP(x), lo = LO(x);
    if (b <= r * 0.1) {
      if (lo >= r * 0.6) add("Dragonfly Doji", "bull", "candle");
      else if (up >= r * 0.6) add("Gravestone Doji", "bear", "candle");
      else add("Doji", "neutral", "candle");
    }
    if (lo >= b * 2 && up <= b * 0.5 && b > r * 0.05) {
      if (tr < -0.15) add("Hammer", "bull", "candle");
      else if (tr > 0.15) add("Hanging Man", "bear", "candle");
    }
    if (up >= b * 2 && lo <= b * 0.5 && b > r * 0.05) {
      if (tr < -0.15) add("Inverted Hammer", "bull", "candle");
      else if (tr > 0.15) add("Shooting Star", "bear", "candle");
    }
    if (b >= r * 0.92) add(G(x) ? "Bullish Marubozu" : "Bearish Marubozu", G(x) ? "bull" : "bear", "candle");
    if (G(x) && D(p) && x.c >= p.o && x.o <= p.c && B(x) > B(p) * 1.1) add("Bullish Engulfing", "bull", "candle");
    if (D(x) && G(p) && x.o >= p.c && x.c <= p.o && B(x) > B(p) * 1.1) add("Bearish Engulfing", "bear", "candle");
    if (Math.max(x.o, x.c) <= Math.max(p.o, p.c) && Math.min(x.o, x.c) >= Math.min(p.o, p.c) && B(p) > B(x) * 1.8) {
      if (D(p) && G(x)) add("Bullish Harami", "bull", "candle");
      if (G(p) && D(x)) add("Bearish Harami", "bear", "candle");
    }
    if (D(x) && G(p) && x.o > p.h && x.c < (p.o + p.c) / 2 && x.c > p.o) add("Dark Cloud Cover", "bear", "candle");
    if (G(x) && D(p) && x.o < p.l && x.c > (p.o + p.c) / 2 && x.c < p.o) add("Piercing Line", "bull", "candle");
    if (D(pp) && B(p) < B(pp) * 0.4 && G(x) && x.c > (pp.o + pp.c) / 2 && B(pp) > R(pp) * 0.5) add("Morning Star", "bull", "candle");
    if (G(pp) && B(p) < B(pp) * 0.4 && D(x) && x.c < (pp.o + pp.c) / 2 && B(pp) > R(pp) * 0.5) add("Evening Star", "bear", "candle");
    if (G(x) && G(p) && G(pp) && x.c > p.c && p.c > pp.c && B(x) > R(x) * 0.5 && B(p) > R(p) * 0.5 && B(pp) > R(pp) * 0.5) add("Three White Soldiers", "bull", "candle");
    if (D(x) && D(p) && D(pp) && x.c < p.c && p.c < pp.c && B(x) > R(x) * 0.5 && B(p) > R(p) * 0.5 && B(pp) > R(pp) * 0.5) add("Three Black Crows", "bear", "candle");
    if (Math.abs(x.h - p.h) / p.h < 0.0015 && tr > 0.15) add("Tweezer Top", "bear", "candle");
    if (Math.abs(x.l - p.l) / p.l < 0.0015 && tr < -0.15) add("Tweezer Bottom", "bull", "candle");
  }
  // ── 피벗(프랙탈) ──
  const H = [], L = [], K = 3;
  for (let i = K; i < n - K; i++) {
    let isH = true, isL = true;
    for (let j = i - K; j <= i + K; j++) {
      if (j === i) continue;
      if (cs[j].h >= cs[i].h) isH = false;
      if (cs[j].l <= cs[i].l) isL = false;
    }
    if (isH) H.push({ i: i, v: cs[i].h });
    if (isL) L.push({ i: i, v: cs[i].l });
  }
  function linfit(pts) {
    if (pts.length < 2) return null;
    const m = pts.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    pts.forEach(function(p){ sx += p.i; sy += p.v; sxy += p.i * p.v; sxx += p.i * p.i; });
    const slope = (m * sxy - sx * sy) / Math.max(1e-9, m * sxx - sx * sx);
    return slope / (sy / m) * 100;
  }
  const last = cs[n - 1].c, tol = 0.02;
  // ── 차트 패턴 ──
  if (H.length >= 2) {
    const h1 = H[H.length - 2], h2 = H[H.length - 1];
    if (Math.abs(h1.v - h2.v) / h1.v < tol && h2.i - h1.i >= 5) {
      let valley = Infinity;
      for (let i = h1.i; i <= h2.i; i++) valley = Math.min(valley, cs[i].l);
      if ((Math.min(h1.v, h2.v) - valley) / valley > 0.02 && last < Math.max(h1.v, h2.v)) add("Double Top", "bear", "chart");
    }
  }
  if (L.length >= 2) {
    const l1 = L[L.length - 2], l2 = L[L.length - 1];
    if (Math.abs(l1.v - l2.v) / l1.v < tol && l2.i - l1.i >= 5) {
      let peak = -Infinity;
      for (let i = l1.i; i <= l2.i; i++) peak = Math.max(peak, cs[i].h);
      if ((peak - Math.max(l1.v, l2.v)) / l2.v > 0.02 && last > Math.min(l1.v, l2.v)) add("Double Bottom", "bull", "chart");
    }
  }
  if (H.length >= 3) {
    const t3 = H.slice(-3);
    if (Math.abs(t3[0].v - t3[1].v) / t3[0].v < tol && Math.abs(t3[1].v - t3[2].v) / t3[1].v < tol) add("Triple Top", "bear", "chart");
    else if (t3[1].v > t3[0].v * 1.015 && t3[1].v > t3[2].v * 1.015 && Math.abs(t3[0].v - t3[2].v) / t3[0].v < 0.03) add("Head & Shoulders", "bear", "chart");
  }
  if (L.length >= 3) {
    const b3 = L.slice(-3);
    if (Math.abs(b3[0].v - b3[1].v) / b3[0].v < tol && Math.abs(b3[1].v - b3[2].v) / b3[1].v < tol) add("Triple Bottom", "bull", "chart");
    else if (b3[1].v < b3[0].v * 0.985 && b3[1].v < b3[2].v * 0.985 && Math.abs(b3[0].v - b3[2].v) / b3[0].v < 0.03) add("Inverse H&S", "bull", "chart");
  }
  const rH = H.slice(-4), rL = L.slice(-4);
  const fH = linfit(rH), fL = linfit(rL);
  if (fH != null && fL != null && rH.length >= 3 && rL.length >= 3) {
    const flat = 0.06;
    if (Math.abs(fH) < flat && fL > flat) add("Ascending Triangle", "bull", "chart");
    else if (Math.abs(fL) < flat && fH < -flat) add("Descending Triangle", "bear", "chart");
    else if (fH < -flat && fL > flat) add("Symmetrical Triangle", "neutral", "chart");
    else if (fH > flat && fL > flat) { if (fL > fH * 1.4) add("Rising Wedge", "bear", "chart"); else add("Channel Up", "bull", "chart"); }
    else if (fH < -flat && fL < -flat) { if (fH < fL * 1.4) add("Falling Wedge", "bull", "chart"); else add("Channel Down", "bear", "chart"); }
  }
  // 중복 제거(같은 이름 1개) + 종합 점수 (chart=±2, candle=±1)
  const seen = {};
  const patterns = out.filter(function(p){ if (seen[p.name]) return false; seen[p.name] = 1; return true; });
  let score = 0;
  patterns.forEach(function(p){
    const w = p.kind === "chart" ? 2 : 1;
    score += p.dir === "bull" ? w : p.dir === "bear" ? -w : 0;
  });
  return { score: score, patterns: patterns, top: patterns[0] || null };
}

// ════════════════════════════════════════════════════════════════════════════
// [V62] 이벤트 리스크 데이터 — 어닝스 캘린더·경제지표 캘린더·내부자(Form 4) 캐시를
//   사이클당 1회 읽어 거래 로직에 공급. 전부 D1 read만 (추가 외부 fetch 0).
//   /api/earnings·/api/econ·/api/insider 가 채워둔 상태를 재사용.
// ════════════════════════════════════════════════════════════════════════════
async function buildEventRiskData(DB) {
  const out = { earningsBySym: {}, econ: { us: { preHigh: null, shock: 0, shockTitle: "" }, kr: { preHigh: null, shock: 0, shockTitle: "" } }, insiderCount: {} };
  const now = Date.now();
  try {
    // (1) 어닝스 — 심볼별 다가오는 발표 시각
    const ec = await getState(DB, "earnings_calendar", null);
    if (ec && ec.items) {
      ec.items.forEach(function(it){
        if (!it || !it.symbol || !it.ts) return;
        const cur = out.earningsBySym[it.symbol];
        if (cur == null || Math.abs(it.ts - now) < Math.abs(cur - now)) out.earningsBySym[it.symbol] = it.ts;
      });
    }
  } catch (e) {}
  try {
    // (2) 경제지표 — 향후 24h 내 고중요(importance≥1) 발표 예정 + 당일 발표된 고중요 서프라이즈 합산
    const cal = await getState(DB, "econ_calendar", null);
    const evs = (cal && cal.events) || [];
    const todayUtc = new Date(now).toISOString().slice(0, 10);
    evs.forEach(function(e){
      if (!e || !e.date || typeof e.importance !== "number" || e.importance < 1) return;
      const t = new Date(e.date).getTime();
      const m = e.country === "KR" ? "kr" : "us";
      if (e.actual == null && t > now && t - now <= 24 * 3600000) {
        if (!out.econ[m].preHigh) out.econ[m].preHigh = e.title || "high-impact";
      }
      if (e.actual != null && String(e.date).slice(0, 10) === todayUtc && e.forecast != null && isFinite(e.forecast) && e.forecast !== 0) {
        const sur = (e.actual - e.forecast) / Math.abs(e.forecast);
        if (Math.abs(sur) >= 0.10) {  // ±10% 이상 서프라이즈만 집계
          out.econ[m].shock += (sur > 0 ? 1 : -1);
          if (!out.econ[m].shockTitle) out.econ[m].shockTitle = e.title || "";
        }
      }
    });
  } catch (e) {}
  try {
    // (3) 내부자 Form 4 — 최근 3일 내 같은 티커 공시 건수 (방향 미상 → 클러스터만 신호로)
    const ins = await getState(DB, "insider_feed", null);
    const fs = (ins && ins.filings) || [];
    fs.forEach(function(f){
      if (!f || !f.ticker || !f.date) return;
      const t = new Date(f.date).getTime();
      if (now - t > 3 * 86400000) return;
      out.insiderCount[f.ticker] = (out.insiderCount[f.ticker] || 0) + 1;
    });
  } catch (e) {}
  return out;
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
        qty: typeof p.qty === 'number' ? p.qty : parseFloat(p.qty) || 0,
        avg: typeof p.avg_price === 'number' ? p.avg_price : parseFloat(p.avg_price) || 0,
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

// [V31] batch 트랜잭션용 statement 빌더 — run()하지 않고 prepared stmt만 반환.
//   trades(원장)와 positions(상태)를 DB.batch()로 원자적으로 묶기 위함.
function stmtSavePosition(DB, market, symbol, strategy, pos) {
  return DB.prepare(
    "INSERT INTO positions (symbol, strategy, market, qty, avg_price, opened_ts, meta) VALUES (?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(symbol, strategy, market) DO UPDATE SET qty=excluded.qty, avg_price=excluded.avg_price, meta=excluded.meta"
  ).bind(symbol, strategy, market, pos.qty, pos.avg, pos.opened_ts, JSON.stringify(pos.meta || {}));
}
function stmtDeletePosition(DB, symbol, strategy, market) {
  if (market) {
    return DB.prepare("DELETE FROM positions WHERE symbol = ? AND strategy = ? AND market = ?").bind(symbol, strategy, market);
  }
  return DB.prepare("DELETE FROM positions WHERE symbol = ? AND strategy = ?").bind(symbol, strategy);
}
function stmtRecordTrade(DB, t) {
  return DB.prepare("INSERT INTO trades (ts, market, symbol, side, qty, price, pnl, pnl_pct, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(t.ts, t.market, t.symbol, t.side, t.qty, t.price, t.pnl == null ? null : t.pnl, t.pnl_pct == null ? null : t.pnl_pct, t.reason);
}

async function savePosition(DB, market, symbol, strategy, pos) {
  await stmtSavePosition(DB, market, symbol, strategy, pos).run();
}

async function deletePosition(DB, symbol, strategy, market) {
  // [V9.1] market이 주어지면 market까지 매칭해 안전 삭제 (미래에 심볼이 겹쳐도 안전).
  //   인자 없으면 기존 동작(하위호환).
  if (market) {
    await DB.prepare("DELETE FROM positions WHERE symbol = ? AND strategy = ? AND market = ?").bind(symbol, strategy, market).run();
  } else {
    await DB.prepare("DELETE FROM positions WHERE symbol = ? AND strategy = ?").bind(symbol, strategy).run();
  }
}

// [V29 새 회계 — 단일 원장] cash를 별도 저장하지 않고 trades에서 실시간 계산.
//   가용현금 = 초기자본 + 입금 − Σ매수금액(수수료포함) + Σ매도대금(수수료·세금차감)
//   trades 테이블이 유일한 진실. cash와 positions가 구조적으로 어긋날 수 없음.
async function computeCashFromTrades(DB, market, cfg) {
  // [BOND] 통화별 슬리브 추가: cm·bdus=USD(무세금), bdkr=KRW(거래세). 기존 us/kr/cm 동작 불변.
  const _initMap = { us: cfg.initialCashUS, kr: cfg.initialCashKR, cm: cfg.initialCashCM, bdus: cfg.initialCashBDUS, bdkr: cfg.initialCashBDKR };
  const initial = (_initMap[market] != null) ? _initMap[market] : cfg.initialCashCM;
  const _isKRW = (market === "kr" || market === "bdkr");
  const feeRate = _isKRW ? (cfg.feeKR || 0) : (cfg.feeUS || 0);
  const sellTaxRate = _isKRW ? (cfg.krSellTax || 0) : 0;
  // [회계 재설계] deposits = 누적 입금액(inflows), outflows = 누적 출금액.
  //   실제 가용현금 = 초기자본 + 입금 − 출금 + 거래손익. (수익률 계산은 TWR로 별도 처리)
  const deposits = await getState(DB, "deposits", { us: 0, kr: 0, cm: 0 });
  const dep = (deposits && typeof deposits[market] === "number") ? deposits[market] : 0;
  const outflowsState = await getState(DB, "outflows", { us: 0, kr: 0, cm: 0 });
  const outf = (outflowsState && typeof outflowsState[market] === "number") ? outflowsState[market] : 0;

  // [V34] 스냅샷 체크포인트 — trades 전체를 매번 합산하면 거래 누적 시 CPU 타임아웃.
  //   { cashAfter, lastRowid } 스냅샷을 저장하고, 이후 추가된 trades(rowid > lastRowid)만 합산.
  //   합산 건수가 임계(500) 넘으면 스냅샷을 전진 저장해 합산량을 항상 작게 유지.
  //   주의: deposits/outflows 변경 시 이 체크포인트는 무효화(삭제)해야 한다.
  const ckptKey = "cash_ckpt:" + market;
  let ckpt = await getState(DB, ckptKey, null);
  let baseCash, sinceRowid;
  if (ckpt && typeof ckpt.cashAfter === "number" && typeof ckpt.lastRowid === "number") {
    baseCash = ckpt.cashAfter;
    sinceRowid = ckpt.lastRowid;
  } else {
    baseCash = (typeof initial === "number" ? initial : 0) + dep - outf;
    sinceRowid = 0;
  }

  const rows = await DB.prepare("SELECT rowid AS rid, side, qty, price FROM trades WHERE market = ? AND rowid > ? ORDER BY rowid ASC").bind(market, sinceRowid).all();
  const list = rows.results || [];
  let cash = baseCash;
  let maxRowid = sinceRowid;
  for (const t of list) {
    const qty = typeof t.qty === 'number' ? t.qty : parseFloat(t.qty) || 0;
    const price = typeof t.price === 'number' ? t.price : parseFloat(t.price) || 0;
    const gross = qty * price;
    if (t.side === "BUY") cash -= gross * (1 + feeRate);
    else if (t.side === "SELL") cash += gross * (1 - feeRate - sellTaxRate);
    if (t.rid > maxRowid) maxRowid = t.rid;
  }
  // 합산 건수가 많아지면 체크포인트 전진 (다음 호출부터 합산량 축소)
  if (list.length >= 500 && maxRowid > sinceRowid) {
    try { await setState(DB, ckptKey, { cashAfter: cash, lastRowid: maxRowid, ts: Date.now() }); } catch (e) {}
  }
  return cash;
}

// 전체 시장 cash 객체를 trades에서 재구성
async function computeAllCash(DB, cfg) {
  return {
    us: await computeCashFromTrades(DB, "us", cfg),
    kr: await computeCashFromTrades(DB, "kr", cfg),
    cm: await computeCashFromTrades(DB, "cm", cfg),
    bdus: await computeCashFromTrades(DB, "bdus", cfg),
    bdkr: await computeCashFromTrades(DB, "bdkr", cfg)
  };
}

// ─────────────────────────────────────────────────────────────
// [회계 재설계] 포트폴리오 평가액 + TWR(Time-Weighted Return)
//   수익률은 입출금에 영향받지 않아야 한다. 이를 위해 입출금(현금흐름)이
//   일어날 때마다 구간을 끊어 누적 수익 factor를 갱신하는 표준 TWR을 사용한다.
//
//   상태 "twr:<market>" = { factor, lastValue }
//     factor    : 직전 현금흐름까지 누적된 (1+r1)(1+r2)... 곱
//     lastValue : 직전 현금흐름 "직후"의 포트폴리오 총평가액
//   현재 시점 전체 수익률(%) = (factor * (현재평가액 / lastValue) - 1) * 100
//   (lastValue 계산/표시는 실시간 quote 기준이라 프론트에서 마지막 구간을 마감한다)
// ─────────────────────────────────────────────────────────────

// 특정 시장의 현재 포트폴리오 총평가액(현금 + 보유 평가액)을 계산.
//   quote가 없는 종목은 평단가(avg)로 평가한다.
async function computePortfolioValue(DB, market, cfg) {
  const cash = await computeCashFromTrades(DB, market, cfg);
  const positions = await getPositions(DB, market);
  // quote 일괄 로드
  const quoteMap = {};
  try {
    const qrows = await DB.prepare("SELECT k, v FROM state WHERE k LIKE 'quote:%'").all();
    for (const r of (qrows.results || [])) {
      try { quoteMap[r.k.slice(6)] = JSON.parse(r.v); } catch (e) {}
    }
  } catch (e) {}
  let marketVal = 0;
  for (const key in positions) {
    const p = positions[key];
    const q = quoteMap[p.symbol];
    const price = (q && typeof q.price === "number") ? q.price : p.avg;
    marketVal += p.qty * price;
  }
  return cash + marketVal;
}

// 현금흐름(입출금) 발생 시 TWR 상태를 갱신한다.
//   flow: 입금은 양수, 출금은 음수. valueBeforeFlow: 흐름 적용 직전 평가액.
async function applyCashflowToTWR(DB, market, valueBeforeFlow, flow, cfg) {
  const key = "twr:" + market;
  const initial = market === "us" ? cfg.initialCashUS : (market === "kr" ? cfg.initialCashKR : cfg.initialCashCM);
  let twr = await getState(DB, key, null);
  if (!twr || typeof twr.factor !== "number" || typeof twr.lastValue !== "number") {
    twr = { factor: 1, lastValue: (typeof initial === "number" ? initial : valueBeforeFlow) };
  }
  // 직전 현금흐름 이후 ~ 이번 현금흐름 직전 구간의 수익을 factor에 반영
  if (twr.lastValue > 0) {
    twr.factor *= valueBeforeFlow / twr.lastValue;
  }
  // 현금흐름 직후 평가액 = 직전 평가액 + 흐름 (평가액은 그대로, 현금만 변동)
  twr.lastValue = valueBeforeFlow + flow;
  if (twr.lastValue <= 0) twr.lastValue = 1;  // 0 나눗셈 방지
  await setState(DB, key, twr);
  return twr;
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

// ============================================================
// [V12] 폭락장 생존 (Crash Survival) — 포트폴리오 차원 방어
// ============================================================

// 시장별 총자산(현금 + 보유 평가액) 계산. quote: 캐시 가격 사용(이미 매분 갱신됨).
async function computeMarketEquity(DB, market, cash, positions) {
  let equity = (typeof cash === "number") ? cash : 0;
  for (const key in positions) {
    const p = positions[key];
    const q = await getState(DB, "quote:" + p.symbol, null);
    const px = (q && q.price > 0) ? q.price : p.avg;
    equity += p.qty * px;
  }
  return equity;
}

// equity 고점 추적 + 현재 낙폭(%) 반환. 신고점이면 peak 갱신.
async function updateEquityPeak(DB, market, equity) {
  const key = "equity_peak:" + market;
  let peak = await getState(DB, key, null);
  if (typeof peak !== "number" || peak <= 0 || equity > peak) {
    peak = equity;
    await setState(DB, key, peak);
  }
  const ddPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
  return { peak: peak, ddPct: ddPct };
}

// 드로다운 단계 판정: 0(정상)/1/2/3.
function drawdownLevel(ddPct, ddCfg) {
  if (!ddCfg || !ddCfg.enabled) return 0;
  if (ddPct >= ddCfg.l3Pct) return 3;
  if (ddPct >= ddCfg.l2Pct) return 2;
  if (ddPct >= ddCfg.l1Pct) return 1;
  return 0;
}

// 최근 매도 N건 중 손실 비중으로 연속손실 쿨다운 여부 판정.
async function checkLossStreak(DB, market, lsCfg) {
  if (!lsCfg || !lsCfg.enabled) return { paused: false };
  // 쿨다운 진행 중이면 만료까지 차단
  const untilKey = "loss_cooldown_until:" + market;
  const until = await getState(DB, untilKey, 0);
  if (typeof until === "number" && Date.now() < until) {
    return { paused: true, until: until, reason: "active" };
  }
  let rows;
  try {
    rows = await DB.prepare(
      "SELECT pnl_pct FROM trades WHERE market = ? AND side = 'SELL' ORDER BY ts DESC LIMIT ?"
    ).bind(market, lsCfg.lookbackTrades).all();
  } catch (e) { return { paused: false }; }
  const sells = (rows && rows.results) ? rows.results : [];
  if (sells.length < lsCfg.lookbackTrades) return { paused: false };
  let losses = 0;
  for (const t of sells) { if ((t.pnl_pct || 0) <= 0) losses++; }
  if (losses >= lsCfg.maxLosses) {
    const newUntil = Date.now() + lsCfg.pauseMinutes * 60000;
    await setState(DB, untilKey, newUntil);
    return { paused: true, until: newUntil, losses: losses, reason: "trigger" };
  }
  return { paused: false, losses: losses };
}

// 패닉(지수 동시 급락) 판정.
function isPanic(regime, panicCfg) {
  if (!panicCfg || !panicCfg.enabled || !regime) return false;
  if (panicCfg.requireBear && regime.regime !== "BEAR") return false;
  return typeof regime.avgDayPct === "number" && regime.avgDayPct <= panicCfg.avgDropPct;
}

// 시장별 폭락 방어 상태를 한 번에 계산해 반환(사이클 1회).
//   gate.blockNew: 신규매수 전면 차단 여부
//   gate.sizeScale: 신규매수 사이즈 배수(드로다운 L1 등)
//   gate.deRisk: 보유 포지션 손절/트레일 타이트닝 적용 여부
async function computeCrashGate(DB, market, cfg, regime, cash, positions) {
  const cs = cfg.crashSurvival;
  const gate = { blockNew: false, sizeScale: 1, deRisk: false, ddLevel: 0, ddPct: 0, reasons: [] };
  if (!cs || !cs.enabled) return gate;

  // (1) 드로다운
  const equity = await computeMarketEquity(DB, market, cash, positions);
  const { peak, ddPct } = await updateEquityPeak(DB, market, equity);
  gate.ddPct = ddPct;
  const lvl = drawdownLevel(ddPct, cs.drawdown);
  gate.ddLevel = lvl;
  if (lvl >= 1 && ddPct > cs.drawdown.recoverPct) {
    if (lvl >= 2) { gate.blockNew = true; gate.reasons.push("DD_L" + lvl + " " + ddPct.toFixed(1) + "%"); }
    else { gate.sizeScale *= cs.drawdown.l1SizeScale; gate.reasons.push("DD_L1 " + ddPct.toFixed(1) + "%"); }
    if (lvl >= 3) gate.deRisk = true;
  }

  // (2) 연속손실 쿨다운 — [V9.8] 실제 스트레스 동반 시에만 전면 차단, 아니면 사이즈 축소
  const ls = await checkLossStreak(DB, market, cs.lossStreak);
  if (ls.paused) {
    const realStress = (lvl >= 1) || isPanic(regime, cs.panic);
    if (realStress) { gate.blockNew = true; gate.reasons.push("LOSS_STREAK"); }
    else { gate.sizeScale *= 0.5; gate.reasons.push("LOSS_STREAK→size×0.5"); }
  }

  // (3) 패닉 게이트 — 완전차단 대신 사이즈 축소로 변경 (저가매수 허용)
  if (isPanic(regime, cs.panic)) {
    const pScale = (cs.panic && cs.panic.panicSizeScale != null) ? cs.panic.panicSizeScale : 0.4;
    gate.sizeScale *= pScale;
    gate.deRisk = true;
    gate.reasons.push("PANIC avg=" + (regime.avgDayPct || 0).toFixed(2) + "% size×" + pScale);
  }

  // (4) 디리스킹은 패닉/딥드로다운에서 on
  if (cs.deRisk && cs.deRisk.enabled && (gate.deRisk || lvl >= 3)) gate.deRisk = true;
  else if (!gate.deRisk) gate.deRisk = false;

  return gate;
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
  // [휴장 폴백] 마지막 거래 시각(epoch sec) — 지수의 실제 마지막 거래일로 휴장 보정에 사용.
  return { price: price, prevClose: prevClose, history: closes, marketTime: (typeof meta.regularMarketTime === "number" ? meta.regularMarketTime : null) };
}

async function saveIndex(DB, symbol, region, data) {
  const dayPct = data.prevClose ? ((data.price - data.prevClose) / data.prevClose) * 100 : 0;
  await setState(DB, "index:" + symbol, {
    region: region, price: data.price, prevClose: data.prevClose,
    dayPct: dayPct, history: data.history.slice(-60), marketTime: data.marketTime || null, ts: Date.now()
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

  // SW_RSI_REV: [V9.7] 단독 진입 금지 — 실거래 26건 win 31% 총 -64.7 (최악의 칼날잡기).
  //   하락추세 RSI 반등만으론 대부분 -5% 하드스톱. soloBlock=true로 단독 진입 차단,
  //   추세 신호(SW_GOLDEN/SW_PULLBACK)와 동반될 때만 "확인 가산점"으로 사용.
  const rsiRevThr = 28;  // [V9.7] 30→28
  if (dailyRsi < rsiRevThr && dailyRsiPrev != null && dailyRsi > dailyRsiPrev) {
    const maGap = ((price - ma20) / ma20) * 100;
    if (maGap >= -6 && maGap <= 0) {  // [V9.7] -8~1 → -6~0
      signals.push({ name: "SW_RSI_REV", weight: 0.4, type: "COUNTER", soloBlock: true, detail: "RSI " + dailyRsi.toFixed(1) + " (prev " + dailyRsiPrev.toFixed(1) + ")" });
    }
  }
  // SW_GOLDEN: [V9.8] 과보수화 완화 — 48~60→45~63, gap ±1→±1.5
  if (ma5 != null && ma5 > ma20 && dailyRsi >= 45 && dailyRsi <= 63) {
    const ma5Gap = ((price - ma5) / ma5) * 100;
    if (ma5Gap >= -1.5 && ma5Gap <= 1.5) {
      signals.push({ name: "SW_GOLDEN", weight: 0.85, type: "TREND", detail: "MA5>MA20 gap " + ma5Gap.toFixed(1) + "%" });
    }
  }
  // SW_BB_LOW: [V9.8] RSI<32→<38 (밴드하단 반등 진입 폭 회복)
  if (bb != null && price <= bb.lower && dailyRsi < 38 && isGreenCandle && dailyRsi > 20) {
    signals.push({ name: "SW_BB_LOW", weight: 0.8, type: "COUNTER", detail: "BB lower " + bb.lower.toFixed(2) });
  }
  // SW_VOL_SPK: [V9.8] RSI 52~62→50~64, vol ×1.8→×1.5
  if (volumes.length >= 20 && isGreenCandle && dailyRsi >= 50 && dailyRsi <= 64) {
    const todayVol = volumes[volumes.length - 1];
    let avgVol = 0;
    for (let i = volumes.length - 21; i < volumes.length - 1; i++) avgVol += volumes[i];
    avgVol /= 20;
    if (todayVol >= avgVol * 1.5) {
      signals.push({ name: "SW_VOL_SPK", weight: 0.9, type: "TREND", detail: "vol x" + (todayVol/avgVol).toFixed(1) });
    }
  }

  // SW_PULLBACK: [V9.8] RSI 52~60→50~63, ma20Gap 0~2→0~3
  const ma50sw = getMA(closes, 50);
  if (ma50sw != null && ma20 > ma50sw && isGreenCandle && dailyRsi >= 50 && dailyRsi <= 63) {
    const ma20Gap = ((price - ma20) / ma20) * 100;
    if (ma20Gap >= 0 && ma20Gap <= 3) {
      signals.push({
        name: "SW_PULLBACK",
        weight: 0.85, type: "TREND",
        detail: "MA20+" + ma20Gap.toFixed(1) + "% RSI " + dailyRsi.toFixed(0)
      });
    }
  }
  return signals;
}



// === [SCALP] 분봉 기반 단타 진입 평가 ===
//   분봉(mb)이 없으면 null 반환 — 분봉 fetch 실패 시 단타 스킵(기존 trend는 영향없음).
//   일봉 추세 확인(약): MA20>MA50 + price>MA20 + RSI≤72
//   분봉 진입 신호:
//     SC_VWAP_CROSS: 가격이 VWAP 근접(±1%) + 상승 모멘텀 → VWAP 지지 진입
//     SC_MOMENTUM:   분봉 모멘텀 강함(≥0.5%) + VWAP 하향 이탈 아님 → 추세 타기
function evaluateScalpEntry(mb, dailyData, cfg, market, regime) {
  if (!mb || !mb.vwap || !mb.closes || mb.closes.length < 6) return null;
  const sr = Object.assign({}, (cfg && cfg.scalpRules) || DEFAULT_CFG.scalpRules || {});
  const closes = dailyData && dailyData.closes;
  if (!closes || closes.length < 55) return null;

  // ── [V52] 세션 시간 필터 ──
  //   마감 직전: 청산 시간 부족 → 오버나이트 리스크. 패닉 포함 전면 차단.
  //   개장 직후: 갭·오프닝 노이즈로 VWAP/모멘텀 신뢰도 낮음 → 평시만 차단(패닉 캡출은 개장 투매가 기회라 면제).
  let _openNoise = false;
  try {
    const _minsLeft = (typeof marketMinutesUntilClose === "function") ? marketMinutesUntilClose(market) : null;
    const _avoidClose = sr.avoidCloseMinutes != null ? sr.avoidCloseMinutes : 20;
    if (_minsLeft != null && _avoidClose > 0 && _minsLeft <= _avoidClose) return null;
    const _ef = (typeof sessionElapsedFraction === "function") ? sessionElapsedFraction(market) : null;
    const _avoidOpen = sr.avoidOpenMinutes != null ? sr.avoidOpenMinutes : 15;
    if (_ef != null && _avoidOpen > 0 && (_ef * 390) < _avoidOpen) _openNoise = true;
  } catch (e) {}

  // ── 분봉 상대거래량 헬퍼 (게이트5/패닉 공용) ──
  const _relVol = function(mult) {
    if (!mult || !mb.volumes || mb.volumes.length < 11) return true;
    const vN = mb.volumes.length;
    const recentVol = mb.volumes[vN - 1] + mb.volumes[vN - 2];
    let avg = 0, cnt = 0;
    for (let i = Math.max(0, vN - 11); i < vN - 1; i++) { avg += mb.volumes[i]; cnt++; }
    avg = cnt > 0 ? (avg / cnt) * 2 : 0;
    return !(avg > 0 && recentVol < avg * mult);
  };

  // ══ [SCALP-PANIC] 패닉/베어장 전용 진입 — 평시 게이트가 다 막는 구간에서 수익 포착 ══
  //   여기서 신호가 잡히면 즉시 return(평시 게이트로 내려가지 않음). 안 잡히면 평시 로직 계속.
  const _csPanic = cfg && cfg.crashSurvival && cfg.crashSurvival.panic;
  const _panicOn = (typeof isPanic === "function") ? isPanic(regime, _csPanic) : false;
  // [V51] BEAR 추세면 당일 등락 무관하게 패닉 단타 경로 활성화.
  //   (기존 worst≤-1.0% 조건은 "하락추세 + 당일 반등" 구간에서 평시·패닉 단타가 둘 다 꺼지는
  //    사각지대를 만들어 단타 신호가 0이 됐다. 인버스/캡출 진입은 각자 자체 조건으로 방향 검증함.)
  const _bearStress = regime && regime.regime === "BEAR";
  const _stressed = _panicOn || _bearStress;
  const spr = Object.assign({}, (cfg && cfg.scalpPanicRules) || DEFAULT_CFG.scalpPanicRules || {});
  if (_stressed && spr.enabled !== false) {
    const _isInv = dailyData.symbol && (typeof INVERSE_ETF !== "undefined") && INVERSE_ETF.has(dailyData.symbol);
    const _price = mb.price, _vwap = mb.vwap;
    const _aboveVwap = _vwap > 0 ? ((_price - _vwap) / _vwap) * 100 : 0;
    const _mom = mb.recentMom || 0;
    const _mc = mb.closes;
    const _lastBar = _mc.length >= 2 ? ((_mc[_mc.length - 1] - _mc[_mc.length - 2]) / _mc[_mc.length - 2]) * 100 : 0;
    const _prevBar = _mc.length >= 3 ? ((_mc[_mc.length - 2] - _mc[_mc.length - 3]) / _mc[_mc.length - 3]) * 100 : 0;

    // (A) 인버스 ETF — 시장하락=인버스상승. 자체 상승추세(MA20>MA50)에서 모멘텀 추종 단타.
    if (_isInv) {
      const ma20i = getMA(closes, sr.maFastPeriod || 20);
      const ma50i = getMA(closes, sr.maSlowPeriod || 50);
      const inv = spr.inverse || {};
      if (ma20i != null && ma50i != null && ma20i > ma50i &&
          Math.abs(_aboveVwap) <= (inv.vwapBand != null ? inv.vwapBand : 1.5) &&
          _mom >= (inv.momEntry != null ? inv.momEntry : 0.25)) {
        return {
          name: "SC_PANIC_INV", weight: 0.9, type: "SCALP",
          confidence: inv.confidence != null ? inv.confidence : 0.8,
          detail: "INV mom " + _mom.toFixed(2) + "% vwap" + _aboveVwap.toFixed(2) + "%",
          members: ["SC_PANIC_INV"], isPanicScalp: true
        };
      }
    } else {
      // (B) 캡출레이션 바운스 — 투매로 급락한 종목의 강한 V자 반등을 짧게 먹는다.
      const cap = spr.capitulation || {};
      if (cap.enabled !== false && dailyData.prevClose && dailyData.prevClose > 0) {
        const dayMom = ((_price - dailyData.prevClose) / dailyData.prevClose) * 100;
        const vwapBelow = cap.vwapBelowMin != null ? cap.vwapBelowMin : -3.0;
        const bounceMin = cap.bounceMinPct != null ? cap.bounceMinPct : 0.6;
        const twoBarOk = cap.twoBarConfirm === false ? true : (_lastBar > 0 && _prevBar >= -0.1);
        if (dayMom <= (cap.dayDropMax != null ? cap.dayDropMax : -3.0) &&  // 당일 급락 종목
            _aboveVwap <= 0 && _aboveVwap >= vwapBelow &&                   // VWAP 아래 이탈 구간
            _lastBar >= bounceMin && twoBarOk &&                           // 강반등 + 2봉 확인
            _relVol(cap.minRelVol)) {                                      // 매수유입 거래량
          return {
            name: "SC_PANIC_BOUNCE", weight: 0.8, type: "SCALP",
            confidence: cap.confidence != null ? cap.confidence : 0.75,
            detail: "BOUNCE day" + dayMom.toFixed(1) + "% vwap" + _aboveVwap.toFixed(2) + "% +" + _lastBar.toFixed(2) + "%",
            members: ["SC_PANIC_BOUNCE"], isPanicScalp: true
          };
        }
      }
    }
    // 패닉 전용 진입 미체결 → 평시 게이트로 계속(인버스 등 일부는 평시 로직도 통과 가능)
  }

  // ── 게이트 1: 일봉 추세 정렬 ──
  // [V52] 개장 직후 노이즈 구간 — 평시 단타 진입 차단 (패닉 경로는 위에서 이미 처리됨)
  if (_openNoise) return null;
  // [V52] VWAP 기울기 — 하락 중인 VWAP에서의 추격(SC_VWAP/SC_MOMENTUM) 차단용
  const _vwSlope = (typeof mb.vwapSlope === "number") ? mb.vwapSlope : null;
  const _slopeOk = (sr.requireVwapSlopeUp === false) || (_vwSlope == null) || (_vwSlope >= 0);
  const ma20 = getMA(closes, sr.maFastPeriod || 20);
  const ma50 = getMA(closes, sr.maSlowPeriod || 50);
  if (ma20 == null || ma50 == null) return null;
  if (!(ma20 > ma50)) return null;  // 추세 방향 아니면 진입 차단
  // [강화] 일봉 종가가 MA20 위 — 추세 상단에서만 단타 (눌림 깊은 종목 회피)
  const dayClose = closes[closes.length - 1];
  if (sr.requirePriceAboveMaFast !== false && !(dayClose > ma20)) return null;

  // ── 게이트 2: 일봉 RSI 밴드 — 과열·약세 양쪽 차단 ──
  const rsi = getRSI(closes, (cfg && cfg.rsiPeriod) || 14);
  if (rsi != null) {
    if (rsi > (sr.rsiMax || 70)) return null;
    if (rsi < (sr.rsiMin != null ? sr.rsiMin : 42)) return null;
  }

  // ── 게이트 3: ADX 추세 강도 — 횡보장 휩쏘 회피 (승률 핵심) ──
  if (sr.adxMin && dailyData.highs && dailyData.lows) {
    const adx = getADX(dailyData.highs, dailyData.lows, closes, 14);
    if (adx != null && adx < sr.adxMin) return null;
  }

  // ── 게이트 4: 당일 급락 회피 (칼날잡기 차단) ──
  if (sr.minDayMomPct != null && dailyData.prevClose && dailyData.prevClose > 0) {
    const dayMom = ((mb.price - dailyData.prevClose) / dailyData.prevClose) * 100;
    if (dayMom < sr.minDayMomPct) return null;
  }

  // ── 게이트 5: 분봉 상대거래량 — 유동성·관심 확인 ──
  if (sr.minRelVol && mb.volumes && mb.volumes.length >= 11) {
    const vN = mb.volumes.length;
    const recentVol = mb.volumes[vN - 1] + mb.volumes[vN - 2];
    let avgVol = 0, cnt = 0;
    for (let i = Math.max(0, vN - 11); i < vN - 1; i++) { avgVol += mb.volumes[i]; cnt++; }
    avgVol = cnt > 0 ? (avgVol / cnt) * 2 : 0;  // 2봉 합과 비교 위해 ×2
    if (avgVol > 0 && recentVol < avgVol * sr.minRelVol) return null;
  }

  const price = mb.price;
  const vwap = mb.vwap;
  const recentMom = mb.recentMom || 0;
  const aboveVwap = vwap > 0 ? ((price - vwap) / vwap) * 100 : 0;
  const vwapBand = sr.vwapBand || 0.8;
  const momEntry = sr.momEntry || 0.4;
  const momStrong = sr.momStrong || 1.5;

  // 분봉 단기 반등 측정 (직전봉 대비)
  const mc = mb.closes;
  const lastBarChg = mc.length >= 2 ? ((mc[mc.length - 1] - mc[mc.length - 2]) / mc[mc.length - 2]) * 100 : 0;

  // ── 진입 A (최우선): VWAP 눌림목 반등 — 추격 대신 되돌림 진입(손익비 최상) ──
  //   가격이 VWAP 아래로 눌렸다가(−pullbackVwapMin~0) 직전봉 반등(+pullbackBounce%) 시
  if (sr.pullbackEnabled !== false) {
    const pbMin = sr.pullbackVwapMin != null ? sr.pullbackVwapMin : -1.2;
    const pbBounce = sr.pullbackBounce != null ? sr.pullbackBounce : 0.25;
    if (aboveVwap <= 0 && aboveVwap >= pbMin && lastBarChg >= pbBounce) {
      return {
        name: "SC_PULLBACK",
        weight: 0.9,
        type: "SCALP",
        confidence: 0.9,  // 눌림목은 진입가 우위 → 높은 신뢰도
        detail: "PB vwap" + aboveVwap.toFixed(2) + "% bounce+" + lastBarChg.toFixed(2) + "% c0.90",
        members: ["SC_PULLBACK"]
      };
    }
  }

  // ── 진입 B: VWAP 근접 + 상승 모멘텀 (VWAP 지지 진입) ──
  //   [V52] VWAP 기울기 ≥ 0 요구 — 하락 VWAP 위 일시 반등 추격(역추세 함정) 차단
  if (Math.abs(aboveVwap) <= vwapBand && recentMom >= momEntry && _slopeOk) {
    const conf = recentMom >= momStrong ? 0.65 : 0.85;  // 강모멘텀(추격)은 작게
    return {
      name: "SC_VWAP",
      weight: 0.8,
      type: "SCALP",
      confidence: conf,
      detail: "VWAP " + aboveVwap.toFixed(2) + "% mom " + recentMom.toFixed(2) + "% c" + conf.toFixed(2),
      members: ["SC_VWAP"]
    };
  }

  // ── 진입 C: 강한 분봉 모멘텀 + VWAP 살짝 위 (추세 지속) ──
  //   [V52] VWAP 기울기 ≥ 0 요구
  if (aboveVwap >= 0 && aboveVwap <= 1.5 && recentMom >= momStrong && _slopeOk) {
    return {
      name: "SC_MOMENTUM",
      weight: 0.75,
      type: "SCALP",
      confidence: 0.7,
      detail: "MOM " + recentMom.toFixed(2) + "% vwap+" + aboveVwap.toFixed(2) + "% c0.70",
      members: ["SC_MOMENTUM"]
    };
  }

  return null;
}

// === [V8] 통합 평가기 — 모든 활성 전략에서 신호 수집 ===
// 반환: [{ strategy, signal, signals: [...] }, ...]  (전략당 1개)
// [V8.4] regime 인자 추가 — meanrev에 전달
// === [재작성] 단일 추세추종 진입 평가 ===
//   데이터(실거래 192건)가 증명한 유일한 수익 패턴(추세 정렬 + 추세 순응)에 집중한다.
//   역추세·과매도 반전·돌파추격(전부 손실)은 폐기. 두 가지 진입만 허용:
//     A) 추세 풀백 반등 — 상승추세 종목이 MA20 근처로 눌렀다 반등
//     B) 신고가 돌파 — 거래량을 동반한 N일 신고가 돌파
//   반환: signal | null  (signal 형식은 기존과 동일해 호출부/백테스트 무수정)
// [V52] 주봉 정합 — 일봉을 5일 단위로 리샘플해 주봉 종가 > 주봉 MA(n) 여부 판정 (추가 fetch 0).
//   상위 시간프레임이 정합하지 않은 돌파/풀백은 실패율이 높다(멀티 타임프레임 확인의 실증 우위).
function weeklyAboveMA(closes, maWeeks) {
  if (!closes || closes.length < (maWeeks || 10) * 5 + 5) return null;
  const weekly = [];
  // 마지막(미완성 주 포함)부터 5일 단위로 종가 샘플링
  for (let i = closes.length - 1; i >= 0; i -= 5) weekly.unshift(closes[i]);
  const n = maWeeks || 10;
  if (weekly.length < n) return null;
  let s = 0;
  for (let i = weekly.length - n; i < weekly.length; i++) s += weekly[i];
  return weekly[weekly.length - 1] > (s / n);
}

// === [V52 신규 전략] SNAP — 상승추세 내 단기 과매도 스냅백 진입 평가 ===
//   장기 상승추세(price>MA200, MA50>MA200)가 살아있는 종목이 단기 과매도(RSI(2)≤10, MA5 아래 눌림)로
//   투매됐을 때 평균회귀 반등을 2~5일 먹는다. TREND(순응)·SCALP(분봉)와 직교하는 수익원.
//   과거 meanrev 실패(승률 0%) 원인 = 약세장 과매도 반전 → BEAR 차단 + 장기추세 게이트 + 칼날 문턱으로 배제.
//   데이터: 일봉 closes/highs/lows만 사용 — 추가 fetch 0.
function evaluateSnapEntry(price, dayPct, dailyData, cfg, regime, market) {
  const sn = Object.assign({}, DEFAULT_CFG.snapRules || {}, (cfg && cfg.snapRules) || {});
  const closes = dailyData && dailyData.closes;
  if (!closes || closes.length < 60) return null;
  // 인버스/레버리지 ETF 제외 — decay·방향성 구조가 평균회귀와 충돌
  if (dailyData.symbol && ((typeof INVERSE_ETF !== "undefined" && INVERSE_ETF.has(dailyData.symbol)) ||
      (typeof LEVERAGED_ETF !== "undefined" && LEVERAGED_ETF.has(dailyData.symbol)))) return null;

  // 게이트 0: BEAR 레짐 진입 금지 — 역추세성 전략의 최대 리스크(약세장 과매도 반전) 원천 차단
  if (sn.blockInBear !== false && regime && regime.regime === "BEAR") return null;
  // 게이트 1: 칼날 차단 — 당일 급락이 문턱 초과면 제외
  if (typeof dayPct === "number" && dayPct < (sn.dayDropMin != null ? sn.dayDropMin : -4.0)) return null;

  const ma50 = getMA(closes, 50);
  const ma200 = closes.length >= 200 ? getMA(closes, 200) : null;
  const ma5 = getMA(closes, 5);
  if (ma50 == null || ma5 == null) return null;
  // 게이트 2: 장기 상승추세 — price > MA200(없으면 MA50 상승 대체) + MA50 > MA200
  if (ma200 != null) {
    if (!(price > ma200 && ma50 > ma200)) return null;
  } else {
    const ma50Prev = getMA(closes.slice(0, -5), 50);
    if (!(ma50Prev != null && ma50 > ma50Prev && price > ma50 * 0.97)) return null;
  }
  // 게이트 3: 변동성 정상
  const atr = getATR(closes, (cfg && cfg.atrPeriod) || 14, dailyData.highs, dailyData.lows);
  const atrPct = (atr != null && price > 0) ? (atr / price * 100) : null;
  if (atrPct != null && atrPct > (sn.maxAtrPct || 5)) return null;
  // 게이트 4: 추세 붕괴 배제 — 20일 고점 대비 눌림 폭이 상한 이내
  const hi20 = getNDayHigh(closes, 20);
  if (hi20 != null && hi20 > 0) {
    const offHi = ((hi20 - price) / hi20) * 100;
    if (offHi > (sn.pullbackFromHighMax != null ? sn.pullbackFromHighMax : 12)) return null;
  }

  // 트리거: RSI(2) 과매도 + MA5 아래 눌림 (+ 연속하락 보조)
  const rsi2 = getRSI(closes, 2);
  const rsi14 = getRSI(closes, 14);
  if (rsi2 == null) return null;
  // [V62] 기본 문턱 완화 (10→12, 50→55) — SNAP 발생 빈도를 높여 트렌드 편중 완화 (cfg로 조절 가능)
  if (rsi2 > (sn.rsi2Max != null ? sn.rsi2Max : 12)) return null;
  if (rsi14 != null && rsi14 > (sn.rsi14Max != null ? sn.rsi14Max : 55)) return null;
  if (sn.requireBelowMa5 !== false && !(price < ma5)) return null;
  // 연속 하락일 카운트 (정보용 + confidence 가산)
  let downDays = 0;
  for (let i = closes.length - 1; i >= 1; i--) {
    if (closes[i] < closes[i - 1]) downDays++; else break;
  }
  if (downDays < (sn.downDaysMin != null ? sn.downDaysMin : 2) && rsi2 > 5) return null;  // 매우 깊은 과매도(RSI2≤5)는 연속하락 면제

  // confidence — 과매도가 깊을수록(RSI2↓, 연속하락↑) 높게. 0.65~0.95
  let conf = 0.7;
  if (rsi2 <= 3) conf += 0.15; else if (rsi2 <= 6) conf += 0.08;
  if (downDays >= 4) conf += 0.07; else if (downDays >= 3) conf += 0.04;
  conf = Math.min(0.95, conf);
  // KR — 15분 지연 시세 → 보수화
  if (market === "kr") conf = Math.min(conf, 0.8);

  const ma5Gap = ((price - ma5) / ma5) * 100;
  return {
    name: "SN_RSI2", weight: 0.9, type: "SNAP", confidence: conf,
    detail: "RSI2 " + rsi2.toFixed(1) + " dn" + downDays + "d MA5" + ma5Gap.toFixed(1) + "%" + (rsi14 != null ? " RSI14 " + rsi14.toFixed(0) : "") + " c" + conf.toFixed(2),
    members: ["SN_RSI2"]
  };
}


//   추세정렬 게이트를 통과한 종목 중에서도 더 강한 종목을 가려내 사이즈를 차등한다.
//   추가 fetch 0 — 기존 일봉(closes/volumes) + 지수 레짐(idxReturn20)만 사용.
function computeAlphaQuality(dailyData, regime) {
  const closes = dailyData.closes, volumes = dailyData.volumes;
  if (!closes || closes.length < 60) return null;
  let score = 0.5; const factors = [];

  // 1) 절대 모멘텀 — 60일 수익률
  const ret60 = getNDayReturn(closes, 60);
  if (ret60 != null) {
    if (ret60 >= 15)      { score += 0.15; factors.push("MOM+"); }
    else if (ret60 <= 0)  { score -= 0.15; factors.push("MOM-"); }
  }
  // 2) 상대강도(RS) — 종목 20일 수익률 vs 지수 20일
  const ret20 = getNDayReturn(closes, 20);
  if (ret20 != null && regime && typeof regime.idxReturn20 === "number") {
    const rs = ret20 - regime.idxReturn20;
    if (rs >= 5)       { score += 0.2; factors.push("RS+"); }
    else if (rs <= -3) { score -= 0.2; factors.push("RS-"); }
  }
  // 3) 거래량 추세(OBV 방향) — 최근 20일 매집/분산
  if (volumes && volumes.length >= 21 && closes.length >= 21) {
    let obv = 0;
    const n = closes.length;
    for (let i = n - 20; i < n; i++) {
      if (i < 1) continue;
      const dir = closes[i] > closes[i - 1] ? 1 : (closes[i] < closes[i - 1] ? -1 : 0);
      obv += dir * (volumes[i] || 0);
    }
    if (obv > 0)      { score += 0.1; factors.push("OBV+"); }
    else if (obv < 0) { score -= 0.1; factors.push("OBV-"); }
  }
  // 4) [강화·1y] 장기 모멘텀 지속성 — 120일 수익률. 긴 추세일수록 모멘텀 팩터 신뢰↑(과최적화 방지로 작게 ±0.1)
  if (closes.length >= 121) {
    const ret120 = getNDayReturn(closes, 120);
    if (ret120 != null) {
      if (ret120 >= 25)     { score += 0.1; factors.push("LMOM+"); }
      else if (ret120 <= 0) { score -= 0.1; factors.push("LMOM-"); }
    }
  }
  // 5) [강화·1y] 52주 신고가 근접도 — 연중 최고가의 N% 이내면 주도주(52w-high effect). 멀면 약세 잔존.
  if (closes.length >= 200) {
    const look = Math.min(252, closes.length - 1);
    const hi = getNDayHigh(closes, look);
    const last = closes[closes.length - 1];
    if (hi != null && hi > 0) {
      const offHigh = ((hi - last) / hi) * 100;   // 고점 대비 하락폭(%)
      if (offHigh <= 5)        { score += 0.15; factors.push("52WH+"); }   // 신고가 부근 = 강한 주도주
      else if (offHigh <= 15)  { score += 0.07; factors.push("52WH"); }
      else if (offHigh >= 40)  { score -= 0.12; factors.push("52WL-"); }   // 고점서 40%↓ = 약세 잔존
    }
  }

  score = Math.max(0, Math.min(1, score));
  return { score: score, factors: factors };
}

function evaluateTrendEntry(price, dayPct, dailyData, cfg, regime, market) {
  const r = getTrendRules(cfg, market);
  const closes = dailyData.closes;
  const volumes = dailyData.volumes || [];
  const highs = dailyData.highs, lows = dailyData.lows;
  const maMid = r.maMid || 50;
  if (!closes || closes.length < maMid + 5) return null;

  const ma20 = getMA(closes, r.maShort || 20);
  const ma50 = getMA(closes, maMid);
  const ma200 = closes.length >= (r.maLong || 200) ? getMA(closes, r.maLong || 200) : null;
  const rsi = getRSI(closes, cfg.rsiPeriod || 14);
  const atr = getATR(closes, cfg.atrPeriod || 14, highs, lows);
  if (ma20 == null || ma50 == null || rsi == null) return null;

  // 게이트 1: 장기 추세 정렬 — 가격이 MA50 위 + (MA50>MA200, 200 부족 시 MA50 상승 중)
  let longOk;
  if (ma200 != null) {
    longOk = ma50 > ma200;
  } else {
    const ma50Prev = getMA(closes.slice(0, -3), maMid);
    longOk = (ma50Prev != null && ma50 > ma50Prev);
  }
  if (!(price > ma50 && longOk)) return null;
  // 게이트 2: 중기 추세 — MA20 > MA50
  if (!(ma20 > ma50)) return null;
  // 게이트 3: 변동성 정상 — ATR%가 과도하면 진입 금지(가짜돌파·슬리피지 회피)
  const atrPct = (atr != null && price > 0) ? (atr / price * 100) : null;
  if (atrPct != null && atrPct > (r.maxAtrPct || 6)) return null;
  // 게이트 4: 시장 레짐 — BEAR + 지수 급락이면 신규 진입 중단 (백테스트는 regime 미지정→통과)
  //   [패닉 헤지] 인버스 ETF는 면제 — 시장이 하락(BEAR)이면 인버스는 상승추세라 진입해야 수익.
  const _isInv = dailyData.symbol && INVERSE_ETF.has(dailyData.symbol);
  const _bearBlock = (r.bearBlockWorstPct != null) ? r.bearBlockWorstPct : -1.5;
  if (!_isInv && regime && regime.regime === "BEAR" && typeof regime.worstDayPct === "number" && regime.worstDayPct <= _bearBlock) {
    return null;
  }

  // [확실성] 추세 강도(MA 정렬 폭)로 신호 confidence(0.5~1.0) 산정.
  //   정렬이 강할수록(추세 뚜렷할수록) 1.0, 약할수록 confMin까지 낮춤.
  //   사이징이 이 값으로 리스크를 줄인다(약추세 진입=작게) → 더 크게 베팅하는 일이 없어 악화 불가.
  let confidence = 1.0;
  if (r.confEnabled !== false) {
    const gap2050 = ((ma20 - ma50) / ma50) * 100;
    const gap50200 = (ma200 != null && ma200 > 0) ? ((ma50 - ma200) / ma200) * 100 : gap2050;
    const trendStrength = gap2050 + gap50200;   // 클수록 정렬이 강한 추세
    const strong = r.confStrongPct != null ? r.confStrongPct : 4.0;
    const weak = r.confWeakPct != null ? r.confWeakPct : 1.5;
    const cmin = r.confMin != null ? r.confMin : 0.5;
    if (trendStrength >= strong) confidence = 1.0;
    else if (trendStrength <= weak) confidence = cmin;
    else confidence = cmin + (1.0 - cmin) * ((trendStrength - weak) / (strong - weak));
    confidence = Math.max(cmin, Math.min(1.0, confidence));
  }
  const confStr = " c" + confidence.toFixed(2);

  const today = closes[closes.length - 1];
  const yesterday = closes[closes.length - 2];
  const isGreen = today > yesterday;

  // [ETF 완화] 시장 ETF는 변동성이 낮아 일반 기준(밴드·RSI·거래량)에 자주 미달 →
  //   추세정렬된 ETF는 더 넓은 밴드/RSI, 거래량 사실상 면제로 진입 기회 확보.
  const isEtf = dailyData.symbol && ETF_SYMBOLS.has(dailyData.symbol);

  // 트리거 A: 추세 풀백 반등 — MA20 ±N% 이내 + 당일 상승 + RSI 밴드
  const ma20Gap = ((price - ma20) / ma20) * 100;
  const pbBand   = isEtf ? 5  : (r.pullbackBandPct || 4);
  const pbRsiMin = isEtf ? 30 : (r.rsiPullbackMin || 37);
  const pbRsiMax = isEtf ? 72 : (r.rsiPullbackMax || 68);
  if (Math.abs(ma20Gap) <= pbBand && isGreen && rsi >= pbRsiMin && rsi <= pbRsiMax) {
    return { name: "TR_PULLBACK", weight: 1.0, type: "TREND", confidence: confidence,
      detail: "MA20 " + ma20Gap.toFixed(1) + "% RSI " + rsi.toFixed(0) + (atrPct != null ? " ATR" + atrPct.toFixed(1) + "%" : "") + confStr + (isEtf ? " ETF" : ""),
      members: ["TR_PULLBACK"] };
  }

  // 트리거 B: 신고가 돌파 + 거래량 — 과열(RSI 상한) 아닐 때만
  const boRsiMax = isEtf ? 78 : (r.rsiBreakoutMax || 75);
  const hiN = getNDayHigh(closes, r.breakoutDays || 20);  // 현재봉 직전 N일 신고가
  // [강화·데이터적합] 장중 형성 중인 당일봉 거래량을 풀데이 기준으로 환산(volPaceMult). 백테스트(완성봉)는 1.
  const _volPace = (dailyData.volPaceMult && dailyData.volPaceMult > 1) ? dailyData.volPaceMult : 1;
  if (hiN != null && price > hiN && rsi <= boRsiMax && volumes.length >= 21) {
    const todayVol = volumes[volumes.length - 1] * _volPace;
    let avgVol = 0;
    for (let i = volumes.length - 21; i < volumes.length - 1; i++) avgVol += volumes[i];
    avgVol /= 20;
    const volReq = isEtf ? 1.05 : (r.volMult || 1.35);
    if (avgVol > 0 && todayVol >= avgVol * volReq) {
      // 돌파는 거래량·신고가 확인이 더해진 강신호 → confidence 소폭 가산(상한 1.0)
      let boConf = Math.min(1.0, confidence + 0.15);
      // [V9.0 수익률 개선] 52주(252거래일) 신고가 돌파 추가 확인 — 연간 최고가를 넘는 돌파는
      //   모멘텀 지속성이 현저히 높다(52-week high effect, Fama/Blume 실증). +0.10 가산.
      let is52wHi = false;
      if (closes.length >= 200) {
        const look52 = Math.min(252, closes.length - 1);  // 1y(~252봉)에서도 동작
        const hi252 = getNDayHigh(closes, look52);
        if (hi252 != null && price > hi252) { boConf = Math.min(1.0, boConf + 0.10); is52wHi = true; }
      }
      return { name: "TR_BREAKOUT", weight: 1.25, type: "TREND", confidence: boConf,  // [데이터강화] 백테스트상 건당수익 풀백의 2배(+15.9%vs+7.5%) → 비중 상향 1.1→1.25
        detail: "BO>" + hiN.toFixed(2) + (is52wHi ? " 52W_HI" : "") + " vol x" + (todayVol / avgVol).toFixed(1) + " RSI " + rsi.toFixed(0) + " c" + boConf.toFixed(2),
        members: ["TR_BREAKOUT"] };
    }
  }

  // ══ 트리거 C: TR_SQUEEZE — 변동성 수축(스퀴즈) 해소 돌파 (VCP / TTM Squeeze) ══
  //   볼린저밴드(20,2σ)가 켈트너채널(20,kc×ATR) 안에 갇혀 있던(=변동성 극저) 종목이
  //   밴드 확장과 함께 직전 상단을 돌파할 때 진입. 저변동 코일→고변동 팽창은 강한 모멘텀 시발점.
  //   풀백/돌파 미충족 시에만 평가되므로 순수 추가 진입(기존 동작 불변). 추세정렬 게이트는 위에서 통과.
  if (r.squeezeEnabled !== false && closes.length >= 25 && atr != null) {
    const bbMult = r.squeezeBbMult || 2.0;
    const kcMult = r.squeezeKcMult || 1.5;
    // 직전 봉 기준 스퀴즈 상태 — BB가 KC 안에 완전히 갇혔는가
    const prevC = closes.slice(0, -1);
    const bbPrev = getBollingerBands(prevC, 20, bbMult);
    const ma20Prev = getMA(prevC, 20);
    const atrPrev = getATR(prevC, cfg.atrPeriod || 14, highs ? highs.slice(0, -1) : null, lows ? lows.slice(0, -1) : null);
    if (bbPrev != null && ma20Prev != null && atrPrev != null && atrPrev > 0) {
      const kcUpPrev = ma20Prev + kcMult * atrPrev;
      const kcLoPrev = ma20Prev - kcMult * atrPrev;
      const wasSqueezed = bbPrev.upper < kcUpPrev && bbPrev.lower > kcLoPrev;
      // 현재 밴드 확장(스퀴즈 해소) + 직전 상단 돌파 + 당일 상승 + 거래량
      if (wasSqueezed && isGreen && price > bbPrev.upper && volumes.length >= 21) {
        const todayVol = volumes[volumes.length - 1] * _volPace;
        let avgVol = 0;
        for (let i = volumes.length - 21; i < volumes.length - 1; i++) avgVol += volumes[i];
        avgVol /= 20;
        const volReq = isEtf ? 1.05 : (r.squeezeVolMult || 1.3);
        if (avgVol > 0 && todayVol >= avgVol * volReq && rsi <= (r.rsiBreakoutMax || 75)) {
          const sqConf = Math.min(1.0, confidence + 0.15);  // 코일 해소는 강신호 → 가산
          return { name: "TR_SQUEEZE", weight: 1.2, type: "TREND", confidence: sqConf,  // [데이터강화] 돌파류(고수익) → 비중 상향 1.1→1.2
            detail: "SQZ>" + bbPrev.upper.toFixed(2) + " vol x" + (todayVol / avgVol).toFixed(1) + " RSI " + rsi.toFixed(0) + " c" + sqConf.toFixed(2),
            members: ["TR_SQUEEZE"] };
        }
      }
    }
  }

  // ══ 트리거 D: TR_RS_LEADER — 상대강도 리더 풀백 (cross-sectional momentum) ══
  //   지수 대비 강한 상대강도(RS) + 절대 모멘텀을 가진 "주도주"가 빠른MA(MA10)로 얕게 눌렸다 반등할 때 진입.
  //   TR_PULLBACK(MA20·RSI≤68)이 놓치는, 강하게 달리는 리더의 첫 눌림목을 포착(모멘텀 팩터 실증 우위).
  //   데이터: 일봉 closes + 지수 20일수익률(regime)만 사용 — 추가 fetch 0.
  if (r.rsLeaderEnabled !== false && regime && typeof regime.idxReturn20 === "number" && closes.length >= 65) {
    const ret20 = getNDayReturn(closes, 20);
    const ret60 = getNDayReturn(closes, 60);
    const rsMin = r.rsLeaderRsMin != null ? r.rsLeaderRsMin : 5;     // 지수 대비 20일 초과수익 ≥5%p
    const momMin = r.rsLeaderMomMin != null ? r.rsLeaderMomMin : 10; // 절대 60일 모멘텀 ≥10%
    if (ret20 != null && ret60 != null) {
      const rs = ret20 - regime.idxReturn20;
      if (rs >= rsMin && ret60 >= momMin) {
        const ma10 = getMA(closes, 10);
        if (ma10 != null) {
          const ma10Gap = ((price - ma10) / ma10) * 100;
          const pbBand = r.rsLeaderPbBand != null ? r.rsLeaderPbBand : 3;  // MA10 ±3% 이내
          const rsiLo = r.rsLeaderRsiMin != null ? r.rsLeaderRsiMin : 45;
          const rsiHi = r.rsLeaderRsiMax != null ? r.rsLeaderRsiMax : 78;  // 리더는 과열 허용폭 넓게
          if (Math.abs(ma10Gap) <= pbBand && isGreen && rsi >= rsiLo && rsi <= rsiHi) {
            // 리더십 강도(RS)로 confidence 가산 — 강한 주도주일수록 크게
            const ldConf = Math.min(1.0, Math.max(confidence, 0.7) + Math.min(0.2, (rs - rsMin) * 0.01));
            return { name: "TR_RS_LEADER", weight: 1.05, type: "TREND", confidence: ldConf,
              detail: "RS+" + rs.toFixed(1) + "%p mom" + ret60.toFixed(0) + "% MA10" + ma10Gap.toFixed(1) + "% RSI" + rsi.toFixed(0) + " c" + ldConf.toFixed(2),
              members: ["TR_RS_LEADER"] };
          }
        }
      }
    }
  }

  return null;
}

// === [재작성] 통합 진입 평가기 — 단일 trend 전략만 평가 ===
//   라이브(runTradingCycle)와 백테스트(backtestSymbol)가 공통 호출. 기존 반환 형식 유지.
function evaluateAllStrategies(price, dayPct, dailyData, cfg, signalStats, regime, market, intraday, visionPreds, secData, eventData) {
  if (cfg.strategies && cfg.strategies.trend === false) return [];
  let sig = evaluateTrendEntry(price, dayPct, dailyData, cfg, regime, market);

  // [Vision 강화 — 진입 보조] 트렌드 트리거(풀백/돌파)가 미충족이어도,
  //   추세 정렬(MA20>MA50>MA200, price>MA50) + Vision UP 고신뢰(≥78%) + 적중률 신뢰 시
  //   "작은 사이즈"로 진입한다(confidence 0.5). Vision을 보조 진입신호로 직접 활용 → 거래·데이터↑.
  //   (적중률 미검증/낮으면 trust로 자동 차단되어 무분별 진입 방지)
  if (!sig && visionPreds && dailyData && dailyData.symbol) {
    const vp = visionPreds[dailyData.symbol];
    const va = cfg.visionAI || {};
    const acc = visionPreds.__accuracy;
    const prc = (acc && acc.total >= 20) ? acc.precision : null;
    const tr2 = (prc == null) ? 1 : (prc < 0.5 ? 0 : Math.min(1, (prc - 0.45) / 0.2));
    if (va.enabled && vp && vp.pred === "up" && vp.conf >= 0.78 && tr2 >= 0.5) {
      const c = dailyData.closes;
      if (c && c.length >= 50) {
        const ma20v = getMA(c, 20), ma50v = getMA(c, 50);
        const ma200v = c.length >= 200 ? getMA(c, 200) : null;
        const aligned = ma20v != null && ma50v != null && ma20v > ma50v && price > ma50v && (ma200v == null || ma50v > ma200v);
        // 변동성 정상 + 과열 아님(RSI<=72)일 때만
        const rsiv = getRSI(c, cfg.rsiPeriod || 14);
        if (aligned && rsiv != null && rsiv <= 72) {
          sig = { name: "TR_VISION_UP", weight: 0.8, type: "TREND", confidence: 0.5,
            detail: "VISION_UP " + Math.round(vp.conf * 100) + "% 추세정렬 보조진입 RSI" + rsiv.toFixed(0),
            members: ["TR_VISION_UP"] };
        }
      }
    }
  }
  // [V52 신규 전략] SNAP — trend 신호가 없을 때만 평가 (같은 종목 중복진입 방지, 추세진입 우선)
  if (!sig) {
    if (!(cfg.strategies && cfg.strategies.snap === false)) {
      const snapSig = evaluateSnapEntry(price, dayPct, dailyData, cfg, regime, market);
      if (snapSig) {
        // [SEC 공시] 미국 종목 — 악재 공시(공시 후 하락)만 보수화. 평균회귀는 악재 낙폭과 구분이 어려워 더 위험.
        if (secData && market === "us" && dailyData.symbol && !getEtfType(dailyData.symbol)) {
          const sds = secData[dailyData.symbol];
          if (sds && sds.caution && typeof sds.postReturn === "number" && sds.postReturn <= -2.0) {
            snapSig.visionBoost = (snapSig.visionBoost || 1.0) * 0.5;
            snapSig.secNote = "SEC_" + (sds.filingType || "?") + " NEG축소";
          }
        }
        // [Vision] DOWN 고신뢰 예측이면 진입 자체를 보류 (떨어지는 칼 + AI 하락 예측 중첩 회피)
        if (visionPreds && dailyData.symbol) {
          const vps = visionPreds[dailyData.symbol];
          if (vps && vps.pred === "down" && vps.conf >= 0.70) return [];
        }
        // [V61 TA 패턴] SNAP은 과매도 반등 매수 — 강한 약세 차트패턴(더블탑/H&S 등) 동반 시 사이즈 축소.
        //   (차단 없음 — 사이즈 차등만, 기존 하우스 스타일 유지)
        {
          const taSnap = taDetectPatterns(dailyData);
          if (taSnap && taSnap.score <= -4) {
            snapSig.visionBoost = (snapSig.visionBoost || 1.0) * 0.6;
            snapSig.taNote = "TA " + taSnap.score + (taSnap.top ? " " + taSnap.top.name : "") + "×0.6";
          }
        }
        // [V62 이벤트 리스크] 어닝스 D-2 이내·고중요 지표 발표 24h 전 → SNAP도 축소 (갭 리스크)
        if (eventData && dailyData.symbol) {
          const _ets2 = eventData.earningsBySym && eventData.earningsBySym[dailyData.symbol];
          if (_ets2) {
            const _dd2 = (_ets2 - Date.now()) / 86400000;
            if (_dd2 >= -0.5 && _dd2 <= 2) {
              snapSig.visionBoost = (snapSig.visionBoost || 1.0) * 0.5;
              snapSig.earnNote = "EARNINGS D-" + Math.max(0, _dd2).toFixed(1) + "×0.5";
            }
          }
          const _er2 = eventData.econ && eventData.econ[market];
          if (_er2 && _er2.preHigh) {
            snapSig.visionBoost = (snapSig.visionBoost || 1.0) * 0.85;
            snapSig.econNote = "ECON-PRE×0.85";
          }
        }
        return [{ strategy: "snap", signal: snapSig, rawCount: 1 }];
      }
    }
    return [];
  }

  // [Vision AI] 예측 결과를 실제 거래에 직접 반영 (적중률 자기보정 포함)
  //   DOWN ≥70% → 매수 신호 완전 차단
  //   UP  ≥65% → 신뢰도 비례 포지션 부스트 (65%→×1.10 ~ 90%→×1.50)
  //   [성능 B] 롤링 적중률(precision)로 영향 강도 자동 스케일:
  //     precision<50% → Vision 무력화(trust=0), 50~65% 선형, 65%+ 완전 적용
  if (visionPreds && dailyData && dailyData.symbol) {
    const vp = visionPreds[dailyData.symbol];
    const va = cfg.visionAI || {};
    const accObj = visionPreds.__accuracy;
    const prec = (accObj && accObj.total >= 20) ? accObj.precision : null;
    const trust = (prec == null) ? 1 : (prec < 0.5 ? 0 : Math.min(1, (prec - 0.45) / 0.2));
    if (va.enabled && vp && vp.conf >= (va.confMin || 0.6) && trust > 0) {
      if (vp.pred === "down" && vp.conf >= 0.70 && trust >= 0.5) {
        // [데이터 축적] 적중률이 충분히 검증(precision≥55%)됐을 때만 완전 차단.
        //   미검증/표본부족 단계에선 차단 대신 사이즈만 대폭 축소 → 거래·학습 데이터는 계속 쌓음.
        if (prec != null && prec >= 0.55) {
          return [];
        } else {
          sig.visionBoost = (sig.visionBoost || 1.0) * 0.4;
          sig.visionNote = "VISION_DOWN " + Math.round(vp.conf * 100) + "% 축소(미검증)";
        }
      } else if (vp.pred === "up" && vp.conf >= 0.65) {
        const base = vp.conf >= 0.90 ? 1.50 : vp.conf >= 0.80 ? 1.35 : vp.conf >= 0.70 ? 1.20 : 1.10;
        const boost = 1 + (base - 1) * trust; // 적중률에 비례
        sig.visionBoost = boost;
        sig.visionNote = "VISION_UP " + Math.round(vp.conf * 100) + "% ×" + boost.toFixed(2) + (prec != null ? " p" + Math.round(prec * 100) : "");
      }
    }
  }

  // [SEC 공시] 미국 종목 한정 — 무조건 보수화 X, 공시 후 주가 반응으로 호재/악재 판단.
  //   긍정 공시(상승 반영)는 보수화하지 않음. 악재(하락)만 축소. 불확실(중립/미상)은 약하게.
  //   [ETF 세분화] ETF는 바스켓이라 개별 기업 공시 영향이 분산됨 → SEC 보수화 면제.
  if (secData && market === "us" && dailyData && dailyData.symbol && !getEtfType(dailyData.symbol)) {
    const sd = secData[dailyData.symbol];
    if (sd && sd.caution && sd.filingType) {
      const sc = cfg.secFilings || {};
      const negScale = (typeof sc.cautionScale === "number") ? sc.cautionScale : 0.5;
      const upThr = (typeof sc.positiveThreshold === "number") ? sc.positiveThreshold : 2.0;
      const dnThr = (typeof sc.negativeThreshold === "number") ? sc.negativeThreshold : -2.0;
      const pr = sd.postReturn;
      const upBoostMax = (typeof sc.positiveBoostMax === "number") ? sc.positiveBoostMax : 1.2;
      let scale = 1.0, tag = "";
      if (pr == null)      { scale = 0.85; tag = "UNKNOWN"; }          // 가격반응 미상 → 약한 축소
      else if (pr >= upThr){ // [강화] 호재 → postReturn 비례 부스트 (진입 강화)
        scale = Math.min(upBoostMax, 1.0 + (pr - upThr) * 0.02);       // +2%→1.0, +12%→1.2(상한)
        tag = "POSITIVE +" + pr.toFixed(1) + "% ×" + scale.toFixed(2);
      }
      else if (pr <= dnThr){ scale = negScale; tag = "NEGATIVE " + pr.toFixed(1) + "%"; } // 악재 → 축소
      else                 { scale = 0.85; tag = "NEUTRAL " + pr.toFixed(1) + "%"; }      // 중립 → 약한 축소
      if (scale !== 1.0) sig.visionBoost = (sig.visionBoost || 1.0) * scale; // 부스트/축소 모두 반영
      sig.secNote = "SEC_" + sd.filingType + " " + tag;
    }
  }

  // [다중 팩터 알파] 모멘텀+RS+거래량 품질로 사이즈 차등 — 강한 종목 더 크게, 약한 종목 작게.
  //   추세정렬 게이트를 통과한 종목 중에서도 "진짜 강한 추세"를 가려내 자본 효율↑ (추가 fetch 0).
  {
    const aq = computeAlphaQuality(dailyData, regime);
    if (aq) {
      let qBoost = 1.0;
      if (aq.score >= 0.78)      qBoost = 1.15;  // 고품질: 강모멘텀+RS우위+매집
      else if (aq.score >= 0.62) qBoost = 1.07;
      else if (aq.score <= 0.30) qBoost = 0.78;  // 저품질: 약세+분산 → 보수화
      else if (aq.score <= 0.42) qBoost = 0.90;
      if (qBoost !== 1.0) {
        sig.visionBoost = (sig.visionBoost || 1.0) * qBoost;
        sig.alphaNote = "ALPHA " + aq.score.toFixed(2) + "×" + qBoost + (aq.factors.length ? " " + aq.factors.join(",") : "");
      }
    }
  }

  // [추세 강도 ADX] 추세전략은 추세장에서 강하고 횡보장에서 휩쏘로 손실 → ADX로 사이즈 차등.
  //   ADX<18 횡보 → 축소(휩쏘 회피), ADX≥30 강추세 → 부스트. (추가 fetch 0)
  {
    const adx = getADX(dailyData.highs, dailyData.lows, dailyData.closes, 14);
    const isLevETF2 = dailyData.symbol && LEVERAGED_ETF.has(dailyData.symbol);
    if (adx != null) {
      let aScale = 1.0;
      if (adx < 18)       aScale = 0.7;   // 횡보 — 추세전략 불리
      else if (adx < 22)  aScale = 0.88;
      else if (adx >= 30) aScale = 1.10;  // 강추세 — 추세전략 유리
      // [레버리지/인버스 강화] 3배 ETF는 횡보·약추세에서 decay 손실이 치명적 →
      //   강추세(ADX≥25)가 아니면 추가 억제(×0.65). 강추세에서만 레버리지의 증폭을 활용.
      if (isLevETF2 && adx < 25) aScale *= 0.65;
      if (aScale !== 1.0) {
        sig.visionBoost = (sig.visionBoost || 1.0) * aScale;
        sig.adxNote = "ADX " + adx.toFixed(0) + "×" + aScale.toFixed(2) + (isLevETF2 ? " LEV" : "");
      }
    }
  }

  // ── [V61 TA 패턴] finviz식 차트/캔들 패턴 점수 — 사이즈 차등만, 차단 없음 (추가 fetch 0) ──
  //   불리시 패턴 우세(채널업·역H&S·모닝스타 등) → 부스트, 베어리시 우세(더블탑·H&S 등) → 축소.
  //   chart 패턴 ±2점, candle 패턴 ±1점 합산.
  {
    const ta = taDetectPatterns(dailyData);
    if (ta && ta.patterns.length) {
      let tScale = 1.0;
      if (ta.score >= 5)       tScale = 1.15;
      else if (ta.score >= 3)  tScale = 1.08;
      else if (ta.score <= -5) tScale = 0.65;
      else if (ta.score <= -3) tScale = 0.82;
      if (tScale !== 1.0) {
        sig.visionBoost = (sig.visionBoost || 1.0) * tScale;
        sig.taNote = "TA " + (ta.score >= 0 ? "+" : "") + ta.score + (ta.top ? " " + ta.top.name : "") + "×" + tScale.toFixed(2);
      }
    }
  }

  // ── [V62 이벤트 리스크] 어닝스 임박·경제지표 발표·내부자 클러스터 — 사이즈 차등만 (추가 fetch 0) ──
  if (eventData && dailyData.symbol) {
    const _sym = dailyData.symbol;
    // (1) 어닝스 임박 — 발표 D-2 이내 신규 진입은 갬블성(갭 리스크) → 축소. 발표 직전(D-1 이내)은 강축소.
    const _ets = eventData.earningsBySym && eventData.earningsBySym[_sym];
    if (_ets) {
      const _dDays = (_ets - Date.now()) / 86400000;
      if (_dDays >= -0.5 && _dDays <= 2) {
        const _es = _dDays <= 1 ? 0.5 : 0.7;
        sig.visionBoost = (sig.visionBoost || 1.0) * _es;
        sig.earnNote = "EARNINGS D-" + Math.max(0, _dDays).toFixed(1) + "×" + _es;
      }
    }
    // (2) 경제지표 — 향후 24h 고중요 발표 예정이면 시장 전체 보수화(이벤트 직전 포지션 축소).
    //     당일 발표된 고중요 지표의 서프라이즈 방향 합산: 부정 우세 → 축소, 긍정 우세 → 소폭 부스트.
    const _er = eventData.econ && eventData.econ[market];
    if (_er) {
      if (_er.preHigh) {
        sig.visionBoost = (sig.visionBoost || 1.0) * 0.85;
        sig.econNote = "ECON-PRE " + String(_er.preHigh).slice(0, 24) + "×0.85";
      }
      if (_er.shock <= -2) {
        sig.visionBoost = (sig.visionBoost || 1.0) * 0.8;
        sig.econNote = (sig.econNote ? sig.econNote + " " : "") + "ECON-NEG×0.8";
      } else if (_er.shock >= 2) {
        sig.visionBoost = (sig.visionBoost || 1.0) * 1.05;
        sig.econNote = (sig.econNote ? sig.econNote + " " : "") + "ECON-POS×1.05";
      }
    }
    // (3) 내부자 Form 4 클러스터 — 3일 내 2건 이상 공시(매수/매도 방향 미상) → 불확실성 보수화
    const _ic = eventData.insiderCount && eventData.insiderCount[_sym];
    if (_ic >= 2 && market === "us") {
      sig.visionBoost = (sig.visionBoost || 1.0) * 0.9;
      sig.insiderNote = "INSIDER F4×" + _ic + "×0.9";
    }
  }

  // ── [V52 신규정보 활용] 갭(시가)·CLV(일중 종가위치)·주봉 정합 — 사이즈 차등만, 차단 없음 (추가 fetch 0) ──
  {
    const r52 = getTrendRules(cfg, market);
    const _c = dailyData.closes, _o = dailyData.opens, _h = dailyData.highs, _l = dailyData.lows;
    const _n = _c ? _c.length : 0;
    // (1) 갭업 돌파 추격 축소 — 당일 시가가 전일 종가 대비 과대 갭업이면 돌파류 사이즈 축소(갭은 되돌림 확률↑)
    if (r52.gapFilterEnabled !== false && _o && _o.length === _n && _n >= 2 &&
        (sig.name === "TR_BREAKOUT" || sig.name === "TR_SQUEEZE")) {
      const gapPct = ((_o[_n - 1] - _c[_n - 2]) / _c[_n - 2]) * 100;
      if (gapPct > (r52.gapMaxPct != null ? r52.gapMaxPct : 3.0)) {
        const gs = r52.gapScale != null ? r52.gapScale : 0.7;
        sig.visionBoost = (sig.visionBoost || 1.0) * gs;
        sig.gapNote = "GAP+" + gapPct.toFixed(1) + "%×" + gs;
      }
    }
    // (2) CLV — 종가가 일중 고가 부근(강한 마감=매수 우위)이면 부스트, 윗꼬리 마감(분산 흔적)이면 축소
    if (r52.clvEnabled !== false && _h && _l && _n >= 1 && _h.length === _n && _l.length === _n) {
      const hh = _h[_n - 1], ll = _l[_n - 1], cc = _c[_n - 1];
      if (hh > ll) {
        const clv = (cc - ll) / (hh - ll);
        let cScale = 1.0;
        if (clv >= (r52.clvStrongMin != null ? r52.clvStrongMin : 0.7)) cScale = (r52.clvStrongScale != null ? r52.clvStrongScale : 1.06);
        else if (clv <= (r52.clvWeakMax != null ? r52.clvWeakMax : 0.35)) cScale = (r52.clvWeakScale != null ? r52.clvWeakScale : 0.85);
        if (cScale !== 1.0) {
          sig.visionBoost = (sig.visionBoost || 1.0) * cScale;
          sig.clvNote = "CLV " + clv.toFixed(2) + "×" + cScale.toFixed(2);
        }
      }
    }
    // (3) 주봉 정합 — 주봉 종가 > 주봉 MA10 미정합이면 축소 (상위 시간프레임 미확인 추세는 작게 베팅)
    if (r52.weeklyAlignEnabled !== false) {
      const wOk = weeklyAboveMA(_c, 10);
      if (wOk === false) {
        const ws = r52.weeklyMisalignScale != null ? r52.weeklyMisalignScale : 0.8;
        sig.visionBoost = (sig.visionBoost || 1.0) * ws;
        sig.weeklyNote = "WK✗×" + ws;
      }
    }
  }

  // ── [ETF 세분화 전략] ETF 유형별 차등 — 바스켓 구조 특성 반영 (추가 fetch 0) ──
  {
    const etfType = getEtfType(dailyData.symbol);
    if (etfType) {
      const closes = dailyData.closes;
      // 종목 20일 vs 지수 20일 상대강도(RS)
      const ret20 = getNDayReturn(closes, 20);
      const rs = (ret20 != null && regime && typeof regime.idxReturn20 === "number") ? (ret20 - regime.idxReturn20) : null;
      let eScale = 1.0, eNote = etfType;
      switch (etfType) {
        case "sector":
        case "theme":
          // 섹터 로테이션 / 테마 모멘텀 — 시장 대비 강한 ETF에 집중(강↑·약↓)
          if (rs != null) { if (rs >= 4) eScale = 1.12; else if (rs <= -3) eScale = 0.82; }
          break;
        case "commodity":
          // 원자재 — 추세가 매우 명확 → 돌파 신호 우대, 강추세 가점
          if (sig.name === "TR_BREAKOUT") eScale = 1.12;
          if (rs != null && rs >= 3) eScale *= 1.05;
          break;
        case "bond":
          // 채권 — 저변동·금리 역방향, 추세전략엔 약함 → 보수적
          eScale = 0.8;
          break;
        case "country":
        case "us_index":
          // 해외/미국추종 — 환·시차 노이즈 → 약간 보수
          eScale = 0.92;
          break;
        case "index":
          // 시장지수 — 안정적, 시장폭(crashGate breadth)이 이미 반영 → 그대로
          break;
        // leverage/inverse/other는 기존 전용 로직(ADX·패닉헤지·decay)에서 처리
      }
      if (eScale !== 1.0) {
        sig.visionBoost = (sig.visionBoost || 1.0) * eScale;
        sig.etfNote = "ETF:" + eNote + "×" + eScale.toFixed(2) + (rs != null ? " RS" + rs.toFixed(1) : "");
      }
    }
  }

  // [안전장치] 여러 부스트(vision×sec×alpha×etf) 누적이 극단값이 되지 않게 상하한 clamp.
  //   (최종 사이즈는 maxPositionPct·가용현금으로 한 번 더 제한됨)
  if (sig.visionBoost) sig.visionBoost = Math.min(2.0, Math.max(0.2, sig.visionBoost));

  return [{ strategy: "trend", signal: sig, rawCount: 1 }];
}


// === [V8] 매수 차단 필터 — strategy 컨텍스트 인식 ===
function evaluateBuyBlocks(price, dayPct, dailyData, cfg, regime, signal, ctx) {
  const closes = dailyData.closes;
  if (!closes || closes.length < 25) return "INSUFFICIENT_DATA";
  const strategy = ctx && ctx.strategy ? ctx.strategy : "trend";
  // [재진입 쿨다운] 손절 손실 후 설정 시간 동안 재진입 차단
  if (ctx && ctx.symbol && ctx.cooldowns && ctx.cooldowns.has(ctx.symbol)) return "REENTRY_COOLDOWN";
  // [패닉 헤지] 인버스 ETF는 시장 붕괴/약세 차단에서 제외 — 하락장이 인버스엔 호재.
  const isInverse = ctx && ctx.symbol && INVERSE_ETF.has(ctx.symbol);
  // [SCALP-PANIC] 패닉 단타(캡출레이션 바운스/인버스 모멘텀)는 "급락을 의도적으로 산다"는 전략이라
  //   폭락·칼날·약세·분산·변동성 게이트를 면제한다. 리스크는 0.4~0.5%로 작고, 손절 1.2%·반등확인·
  //   거래량확인으로 자체 방어한다. 평시 trend/scalp 진입에는 영향 없음(isPanicScalp 신호 한정).
  const isPanicScalp = signal && signal.isPanicScalp === true;
  const _exemptCrash = isInverse || isPanicScalp;

  // 시장 붕괴 / 장중 급락 — 인버스·패닉단타는 면제
  if (!_exemptCrash && regime.worstDayPct <= cfg.marketCrashPct) return "MARKET_CRASH " + regime.worstDayPct.toFixed(2) + "%";
  if (!isPanicScalp && dayPct <= -cfg.maxDailyDrop) return "FALLING_KNIFE " + dayPct.toFixed(2) + "%";

  const highs = dailyData.highs || null;
  const lows = dailyData.lows || null;
  const atr14 = getATR(closes, cfg.atrPeriod, highs, lows);
  const atr30 = getATR(closes, 30, highs, lows);
  if (!isPanicScalp && atr14 != null && atr30 != null && atr14 > atr30 * 2.0) {
    return "VOLATILITY_SPIKE ATR14=" + atr14.toFixed(2) + " ATR30=" + atr30.toFixed(2);
  }

  // 대량거래+하락 = 기관 분산 매도 신호 — 신규 진입 차단 (ETF·인버스 면제)
  //   거래량이 20일 평균의 N배 이상이면서 당일 하락이면 기관 출구 가능성 높음.
  const _tr = cfg.trendRules || {};
  if (!isInverse && !isPanicScalp && !(ctx && ctx.symbol && ETF_SYMBOLS.has(ctx.symbol)) && _tr.distDetectEnabled !== false) {
    const vols = dailyData.volumes;
    if (vols && vols.length >= 21) {
      const todayVol = vols[vols.length - 1];
      const avgVol20 = vols.slice(-21, -1).reduce(function(a, b) { return a + b; }, 0) / 20;
      const dMult = _tr.distDetectVolMult || 2.5;
      const dDrop = _tr.distDetectMinDrop || 0.5;
      if (todayVol > 0 && avgVol20 > 0 && todayVol > avgVol20 * dMult && dayPct <= -dDrop) {
        return "DIST_SELLING vol×" + (todayVol / avgVol20).toFixed(1) + " d" + dayPct.toFixed(1) + "%";
      }
    }
  }

  // BEAR_WEAK — 인버스·패닉단타는 면제 (약세장이 호재 / 약세장 반등을 노림)
  if (!_exemptCrash && regime.regime === "BEAR" && regime.worstDayPct <= -1.5) {
    return "BEAR_WEAK worst=" + regime.worstDayPct.toFixed(2) + "%";
  }

  // RS 필터 — isCounterTrend 신호·ETF는 면제
  // [ETF 면제] 지수 ETF는 지수 자체라 "지수 대비 아웃퍼폼"이 구조적으로 불가능
  const _isEtfRS = ctx && ctx.symbol && ETF_SYMBOLS.has(ctx.symbol);
  if (cfg.rsFilterEnabled && !signal.isCounterTrend && !isPanicScalp && !_isEtfRS && regime.idxReturn20 != null) {
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

// === [회계 재설계] executeBuy — 예산은 DB(trades)에서 실시간 재계산, 살 수 있는 만큼만 매수 ===
//   핵심: in-memory cash[market]를 예산 근거로 쓰지 않는다. 매수 직전 trades 원장에서
//   실제 가용현금을 다시 계산하고, 그 현금으로 살 수 있는 최대 수량으로 qty를 잘라낸다(clamp).
//   → 호출부의 budget 계산이 과대하든, in-memory cash가 오염됐든, 사이클이 겹쳐 실행되든
//     수학적으로 예산 초과가 불가능하다.
async function executeBuy(DB, market, symbol, strategy, qty, price, signal, dailyAtr, cfg, cash, opts) {
  // [V9.1] 입력 검증 — 비정상 가격/수량으로 인한 유령거래·NaN 방어
  if (!(typeof price === "number" && isFinite(price) && price > 0)) {
    await log(DB, "WARN", symbol, "BUY aborted: bad price " + price); return cash;
  }
  if (!(typeof qty === "number" && isFinite(qty) && qty > 0)) {
    await log(DB, "WARN", symbol, "BUY aborted: bad qty " + qty); return cash;
  }
  qty = Math.floor(qty);
  if (qty <= 0) { return cash; }

  const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
  const unitCost = price * (1 + feeRate);   // 1주당 총비용(수수료 포함)

  // ★ 단일 진실: 매수 직전 trades 원장에서 실제 가용현금을 재계산한다.
  let availCash;
  try {
    availCash = await computeCashFromTrades(DB, market, cfg);
  } catch (e) {
    await log(DB, "ERROR", symbol, "BUY aborted: 가용현금 계산 실패 " + e.message); return cash;
  }
  if (!(typeof availCash === "number" && isFinite(availCash)) || availCash <= 0) {
    await log(DB, "WARN", symbol, "BUY aborted: 가용현금 없음 (" + Math.round(availCash) + ")"); return cash;
  }

  // ★ 살 수 있는 최대 수량으로 clamp — "예산 안에서만 거래"
  const maxQty = Math.floor(availCash / unitCost);
  if (maxQty <= 0) {
    await log(DB, "WARN", symbol, "BUY aborted: 1주 살 현금 부족 (현금=" + Math.round(availCash) + ", 1주=" + unitCost.toFixed(2) + ")");
    return cash;
  }
  if (qty > maxQty) {
    await log(DB, "INFO", symbol, "BUY 수량 자동 축소 " + qty + "→" + maxQty + " (예산 한도, 현금=" + Math.round(availCash) + ")");
    qty = maxQty;
  }

  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  // 이 시점에서 total <= availCash 가 maxQty 정의상 수학적으로 보장된다.

  // 전략별 손절가 계산 — [V8.6] opts.stopPctOverride 있으면 우선 적용 (LLM 지시)
  const rules = getStrategyRules(cfg, strategy, market);
  const stopPct = (opts && typeof opts.stopPctOverride === "number")
    ? opts.stopPctOverride : (rules.stopLossPct || cfg.stopLoss);
  const atrMult = rules.atrStopMult || cfg.atrStopMult;

  const pctStop = price * (1 - stopPct / 100);
  let stopPrice = pctStop;
  // [SCALP] 단타는 ATR 손절(보통 더 넓음)을 쓰지 않고 고정 % 손절만 사용 — 타이트한 리스크 유지.
  if (dailyAtr && strategy !== "scalp") {
    const atrStop = price - dailyAtr * atrMult;
    stopPrice = Math.min(atrStop, pctStop);
  }
  // 최대 손절폭은 stopPct로 고정
  if (stopPrice > pctStop) stopPrice = pctStop;

  // [V9.1] 동일 종목+전략 기존 포지션이 있으면 "덮어쓰기"가 아니라 평단·수량 합산.
  //   (호출부 가드가 깨져도 유령손실/수량증발이 생기지 않도록 방어)
  //   전체 getPositions 대신 해당 1건만 조회해 D1 부하 최소화.
  let posToSave;
  try {
    let prior = null;
    try {
      const row = await DB.prepare("SELECT qty, avg_price, opened_ts, meta FROM positions WHERE symbol = ? AND strategy = ? AND market = ?")
        .bind(symbol, strategy, market).first();
      if (row && row.qty > 0) {
        prior = { qty: row.qty, avg: row.avg_price, opened_ts: row.opened_ts, meta: row.meta ? JSON.parse(row.meta) : {} };
      }
    } catch (e) { prior = null; }
    if (prior && prior.qty > 0) {
      const newQty = prior.qty + qty;
      const newAvg = ((prior.avg * prior.qty) + (price * qty)) / newQty;
      const pmeta = prior.meta || {};
      pmeta.feeRemaining = (typeof pmeta.feeRemaining === "number" ? pmeta.feeRemaining : (pmeta.feePaid || 0)) + fee;
      pmeta.feePaid = (pmeta.feePaid || 0) + fee;
      pmeta.originalQty = (pmeta.originalQty || prior.qty) + qty;
      // [V14 결함수정] 추가매수(불타기) 시 손절가를 새 진입가 기준으로 무조건 덮어쓰면
      //   ① 이미 break-even으로 끌어올린 보호선이 풀리고
      //   ② 추가가가 낮으면 손절선이 평단보다 한참 아래로 내려가 손실을 방치한다.
      //   → 신규 계산 stopPrice와 기존 stopPrice 중 "더 보수적(높은) 쪽"을 채택하고,
      //     breakEvenLocked 였으면 절대 내리지 않는다(락 유지).
      const priorStop = (typeof pmeta.stopPrice === "number") ? pmeta.stopPrice : null;
      if (pmeta.breakEvenLocked) {
        // 본전 락 상태: 새 평단 기준 본전선과 기존 stop 중 높은 쪽으로만 유지/상향
        const beFloor = newAvg;  // 최소한 평단(본전) 이상 방어
        let keepStop = priorStop != null ? priorStop : stopPrice;
        if (keepStop < beFloor && stopPrice >= beFloor) keepStop = stopPrice;
        pmeta.stopPrice = Math.max(keepStop, priorStop != null ? priorStop : keepStop);
      } else if (priorStop != null) {
        // 일반 상태: 새 stop과 기존 stop 중 높은(타이트한) 쪽
        pmeta.stopPrice = Math.max(priorStop, stopPrice);
      } else {
        pmeta.stopPrice = stopPrice;
      }
      if (pmeta.peakPrice == null || price > pmeta.peakPrice) pmeta.peakPrice = price;
      // [V14] peakPrice 안전 초기화 — null 이면 평단/현재가 중 높은 값으로 채워 트레일 작동 보장
      if (pmeta.peakPrice == null) pmeta.peakPrice = Math.max(newAvg, price);
      posToSave = { qty: newQty, avg: newAvg, opened_ts: prior.opened_ts || Date.now(), meta: pmeta };
    } else {
      posToSave = {
        qty: qty, avg: price, opened_ts: Date.now(),
        meta: {
          strategy: strategy, feePaid: fee, feeRemaining: fee,
          atrAtEntry: dailyAtr, stopPrice: stopPrice, peakPrice: price,
          signal: signal.name, signalMembers: signal.members || [signal.name],
          tp1Done: false, originalQty: qty
        }
      };
    }
  } catch (e) {
    await log(DB, "ERROR", symbol, "BUY posToSave calc fail: " + e.message);
    return cash;
  }

  // [V31] 원자적 트랜잭션 — trades(원장)와 positions(상태)를 DB.batch()로 묶어
  //   둘 다 성공하거나 둘 다 롤백. "유령 포지션"(돈만 나감)·정합성 붕괴 원천 차단.
  try {
    const stmtTrade = stmtRecordTrade(DB, {
      ts: Date.now(), market: market, symbol: symbol, side: "BUY",
      qty: qty, price: price, pnl: null, pnl_pct: null,
      reason: "[" + strategy.toUpperCase() + "] " + signal.name + " " + signal.detail
    });
    const stmtPos = stmtSavePosition(DB, market, symbol, strategy, posToSave);
    await DB.batch([stmtTrade, stmtPos]);
  } catch (e) {
    await log(DB, "ERROR", symbol, "BUY transaction aborted (롤백됨, cash·포지션 무변동): " + e.message);
    return cash;
  }
  // DB 트랜잭션 성공 후, in-memory cash를 "실제 가용현금 − 이번 매수액"으로 재동기화.
  //   (단순 차감이 아니라 DB 재계산값 기준으로 덮어써 in-memory drift를 매 거래마다 교정)
  if (cash && typeof cash === "object") cash[market] = availCash - total;
  const stopPctRel = ((stopPrice - price) / price * 100).toFixed(1);
  await log(DB, "BUY", symbol, "BUY [" + strategy + "] x" + qty + " @" + price.toFixed(2) + " " + signal.name + " " + signal.detail + " stop=" + stopPrice.toFixed(2) + "(" + stopPctRel + "%)");
  return cash;
}

// === [V8] 전략 룰 헬퍼 ===
// [KR 분리] market 별 TREND 룰 — KR이면 trendRules(US base)에 trendRulesKR을 머지.
function getTrendRules(cfg, market) {
  const base = cfg.trendRules || {};
  if (market === "kr" && cfg.trendRulesKR) return Object.assign({}, base, cfg.trendRulesKR);
  return base;
}
// [KR 분리] market 별 TREND 사이징.
function getTrendSizing(cfg, market) {
  const base = cfg.trendSizing || {};
  if (market === "kr" && cfg.trendSizingKR) return Object.assign({}, base, cfg.trendSizingKR);
  return base;
}
function getStrategyRules(cfg, strategy, market) {
  if (strategy === "trend") return getTrendRules(cfg, market);
  const trBase = getTrendRules(cfg, market);
  // 단타 전략 — scalpRules 전용 룰 사용
  if (strategy === "scalp") return Object.assign({}, trBase, cfg.scalpRules || DEFAULT_CFG.scalpRules || {});
  // [V52] 스냅백 전략 — snapRules 전용 룰 (atrStopMult/stopLossPct/breakEvenLock 등 executeBuy·Sell이 참조)
  if (strategy === "snap") return Object.assign({}, trBase, DEFAULT_CFG.snapRules || {}, cfg.snapRules || {});
  // 레거시 보유 포지션 호환 — 구 전략 룰이 있으면 사용, 없으면 trend(market별)로 폴백
  if (strategy === "swing") return cfg.swingRules || trBase;
  if (strategy === "day") return cfg.dayRules || trBase;
  if (strategy === "momentum") return cfg.momentumRules || trBase;
  if (strategy === "meanrev") return cfg.meanrevRules || trBase;
  return trBase;
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
  // [수정] 전량청산 여부를 pos.qty 감소 전에 판정 (부분청산 통계 오집계 방지)
  const fullClose = sellQty >= pos.qty;
  const entrySignalName = (pos.meta && pos.meta.signalName) || null;
  // [V9.1] 입력 검증 — 비정상 가격/수량/포지션 방어
  if (!(typeof price === "number" && isFinite(price) && price > 0)) {
    await log(DB, "WARN", symbol, "SELL aborted: bad price " + price); return { cash: cash, pnlPct: 0 };
  }
  if (!(typeof pos.qty === "number" && pos.qty > 0)) {
    await log(DB, "WARN", symbol, "SELL aborted: bad pos.qty"); return { cash: cash, pnlPct: 0 };
  }
  sellQty = Math.floor(sellQty);
  if (sellQty <= 0) { return { cash: cash, pnlPct: 0 }; }
  if (sellQty > pos.qty) sellQty = pos.qty;   // 보유 초과 매도 방지

  const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
  const gross = price * sellQty;
  const fee = gross * feeRate;
  const sellTax = market === "kr" ? gross * (cfg.krSellTax || 0) : 0;
  const proceeds = gross - fee - sellTax;
  if (!(typeof cash[market] === "number" && isFinite(cash[market]))) {
    await log(DB, "ERROR", symbol, "SELL aborted: cash state invalid"); return { cash: cash, pnlPct: 0 };
  }

  pos.meta = pos.meta || {};
  const feeRemaining = (typeof pos.meta.feeRemaining === "number")
    ? pos.meta.feeRemaining
    : (pos.meta.feePaid || 0);
  // [V9.1] pos.qty>0은 위에서 보장 — 0나눗셈(NaN) 방어 완료
  const entryFeeForThisSell = feeRemaining * (sellQty / pos.qty);
  const costBasis = pos.avg * sellQty + entryFeeForThisSell;
  const pnl = proceeds - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
  const heldMin = pos.opened_ts ? Math.floor((Date.now() - pos.opened_ts) / 60000) : 0;

  const signalMembers = pos.meta.signalMembers || [];
  const enrichedReason = "[" + strategy.toUpperCase() + "] " + reason + " #entry=" + signalMembers.join(",");

  // [V31] 원자적 트랜잭션 — 매도 원장과 포지션 변경을 batch로 묶어 둘 다 성공/둘 다 롤백.
  //   "좀비 포지션"(매도대금은 들어왔는데 포지션이 안 줄어 무한 매도) 원천 차단.
  try {
    const stmtTrade = stmtRecordTrade(DB, { ts: Date.now(), market: market, symbol: symbol, side: "SELL", qty: sellQty, price: price, pnl: pnl, pnl_pct: pnlPct, reason: enrichedReason });
    let stmtPos;
    if (sellQty < pos.qty) {
      pos.qty = pos.qty - sellQty;
      pos.meta.tp1Done = true;
      if (reason && reason.startsWith("TP2")) pos.meta.tp2Done = true;
      pos.meta.feeRemaining = Math.max(0, feeRemaining - entryFeeForThisSell);
      // [V9.7] TP1 부분익절 직후, 남은 런너의 손절을 본전+lock으로 즉시 상향.
      //   실거래상 TP1-HALF는 100% 익절이지만, 남은 절반이 손절로 되돌아가 라운드트립하는
      //   사례를 차단. 이미 breakEvenLocked면 더 내리지 않음(Math.max).
      try {
        const beRules = getStrategyRules(cfg, strategy, market);
        const beLock = (beRules.breakEvenLock || 0) / 100;
        const beStop = pos.avg * (1 + beLock);
        if (pos.meta.stopPrice == null || pos.meta.stopPrice < beStop) pos.meta.stopPrice = beStop;
        pos.meta.breakEvenLocked = true;
      } catch (e) {}
      stmtPos = stmtSavePosition(DB, market, symbol, strategy, pos);
    } else {
      stmtPos = stmtDeletePosition(DB, symbol, strategy, market);
    }
    await DB.batch([stmtTrade, stmtPos]);
  } catch (e) {
    await log(DB, "ERROR", symbol, "SELL transaction aborted (롤백됨, cash·포지션 무변동): " + e.message);
    return { cash: cash, pnlPct: 0 };
  }
  // DB 트랜잭션 완전 성공 후에만 인메모리 cash 반영
  if (cash && typeof cash[market] === "number") cash[market] += proceeds;
  const taxNote = market === "kr" ? " tax=" + sellTax.toFixed(2) : "";
  await log(DB, "SELL", symbol, "SELL [" + strategy + "] x" + sellQty + " @" + price.toFixed(2) + " PnL " + pnlPct.toFixed(2) + "% (held " + heldMin + "min, " + reason + ")" + taxNote);
  // [재진입 쿨다운] 손절 손실 전량청산 → 설정된 시간 동안 재진입 차단
  // [V52] 전략별 분기 — scalp는 분 단위(60분), snap은 시간 단위(12h), trend는 기존 24h.
  //   (기존엔 "SCALP-STOP"이 startsWith("STOP")에 안 걸려 단타 손절 후 같은 종목 즉시 재진입이 가능했음 — 수정)
  if (fullClose && reason && pnlPct < 0 && (reason.startsWith("STOP") || reason.startsWith("SCALP-STOP") || reason.startsWith("SNAP-STOP"))) {
    try {
      let cdMs = 0;
      if (strategy === "scalp") {
        const cdM = (cfg.scalpRules && cfg.scalpRules.reEntryCooldownMin != null) ? cfg.scalpRules.reEntryCooldownMin : 60;
        if (cdM > 0) cdMs = cdM * 60000;
      } else if (strategy === "snap") {
        const cdHs = (cfg.snapRules && cfg.snapRules.reEntryCooldownHours != null) ? cfg.snapRules.reEntryCooldownHours : 12;
        if (cdHs > 0) cdMs = cdHs * 3600000;
      } else {
        const cdH = getTrendRules(cfg, market).reEntryCooldownHours;
        if (typeof cdH === "number" && cdH > 0) cdMs = cdH * 3600000;
      }
      if (cdMs > 0) await setState(DB, "cooldown:" + symbol, { until: Date.now() + cdMs });
    } catch (e) {}
  }
  // [섹터그룹·신호타입] 전량청산 시 성과 누적 (autoTune이 가중치 계산에 사용)
  try {
    if (fullClose) {
      // (1) 섹터 그룹 통계
      const grp = getSectorGroup(symbol, cfg);
      const gs = await getState(DB, "sector_group_stats", {});
      if (!gs[grp]) gs[grp] = { trades: 0, wins: 0, sumPnlPct: 0 };
      if (gs[grp].trades >= 120) { gs[grp].trades = Math.round(gs[grp].trades / 2); gs[grp].wins = Math.round(gs[grp].wins / 2); gs[grp].sumPnlPct = gs[grp].sumPnlPct / 2; }
      gs[grp].trades++;
      if (pnlPct > 0) gs[grp].wins++;
      gs[grp].sumPnlPct += pnlPct;
      await setState(DB, "sector_group_stats", gs);
      // (2) 신호 타입 통계 (TR_PULLBACK / TR_BREAKOUT)
      if (entrySignalName && SIGNAL_TYPES.indexOf(entrySignalName) >= 0) {
        const ss = await getState(DB, "signal_type_stats", {});
        if (!ss[entrySignalName]) ss[entrySignalName] = { trades: 0, wins: 0, sumPnlPct: 0 };
        if (ss[entrySignalName].trades >= 120) { ss[entrySignalName].trades = Math.round(ss[entrySignalName].trades / 2); ss[entrySignalName].wins = Math.round(ss[entrySignalName].wins / 2); ss[entrySignalName].sumPnlPct = ss[entrySignalName].sumPnlPct / 2; }
        ss[entrySignalName].trades++;
        if (pnlPct > 0) ss[entrySignalName].wins++;
        ss[entrySignalName].sumPnlPct += pnlPct;
        await setState(DB, "signal_type_stats", ss);
      }
    }
  } catch (e) {}
  return { cash: cash, pnlPct: pnlPct };
}

// === [재작성] 통합 청산 평가 — 단일 추세추종 청산 (전략 분기 없음) ===
//   기존 보유 포지션(strategy=swing 등)도 strategy 무관하게 이 로직으로 관리한다.
//   우선순위: 하드손절 → 1R 분할익절(+BE락) → 2R 분할익절 → 트레일링 → 추세이탈 → 시간손절
//   반환: { sell, sellQty, reason }
function evaluateSell(pos, price, daily, dailyRsi, dailyMa, dailyMaShort, cfg, marketOpenForThis, market, deRiskOpts, visionHint) {
  const strategyName = pos.strategy || (pos.meta && pos.meta.strategy) || "trend";

  // === [SCALP] 단타 전략 전용 청산 — 빠른 손절 / 분할익절+본전락 / 트레일 / 타임스톱 ===
  if (strategyName === "scalp") {
    const sr = Object.assign({}, cfg.scalpRules || DEFAULT_CFG.scalpRules || {});
    const meta2 = pos.meta || {};
    const pnlPct = pos.avg > 0 ? ((price - pos.avg) / pos.avg) * 100 : 0;
    const heldMin = pos.opened_ts ? Math.floor((Date.now() - pos.opened_ts) / 60000) : 0;
    const peakP = (meta2.peakPrice && meta2.peakPrice > 0) ? meta2.peakPrice : pos.avg;
    const tp1Done = !!meta2.tp1Done;

    // 1) 하드 손절 (stopPrice 우선 — TP1 후 본전락으로 상향됨)
    const sprice = (typeof meta2.stopPrice === "number") ? meta2.stopPrice : null;
    if (sprice != null && price <= sprice) {
      return { sell: true, sellQty: pos.qty, reason: "SCALP-STOP " + pnlPct.toFixed(2) + "%" + (meta2.breakEvenLocked ? " (BE)" : "") };
    }
    const slPct = sr.stopLossPct || 1.2;
    if (sprice == null && pnlPct <= -slPct) {
      return { sell: true, sellQty: pos.qty, reason: "SCALP-STOP " + pnlPct.toFixed(2) + "%" };
    }

    // 2) TP1 분할익절 — +tp1Pct 도달 시 절반 익절(executeSell이 손절을 본전으로 올림=BE락)
    const tp1Pct = sr.tp1Pct != null ? sr.tp1Pct : 1.2;
    if (!tp1Done && tp1Pct > 0 && pnlPct >= tp1Pct) {
      const half = Math.floor(pos.qty / 2);
      if (half > 0) return { sell: true, sellQty: half, reason: "SCALP-TP1 +" + pnlPct.toFixed(2) + "%" };
      return { sell: true, sellQty: pos.qty, reason: "SCALP-TP1-FULL +" + pnlPct.toFixed(2) + "%" };
    }

    // 3) 최종 익절 — 잔량 takeProfit 도달
    const tpPct = sr.takeProfit || 2.5;
    if (pnlPct >= tpPct) return { sell: true, sellQty: pos.qty, reason: "SCALP-TP +" + pnlPct.toFixed(2) + "%" };

    // 4) 트레일 — trailActivatePct 이상 수익에서만 작동(조기 청산 방지)
    const trailActivate = sr.trailActivatePct != null ? sr.trailActivatePct : 1.2;
    const trailPct = sr.trailPct || 0.7;
    if (pnlPct >= trailActivate) {
      const trailStop = peakP * (1 - trailPct / 100);
      if (price <= trailStop) {
        const peakPct = pos.avg > 0 ? ((peakP - pos.avg) / pos.avg) * 100 : 0;
        return { sell: true, sellQty: pos.qty, reason: "SCALP-TRAIL +" + pnlPct.toFixed(2) + "% (peak +" + peakPct.toFixed(1) + "%)" };
      }
    }

    // 5) 타임스톱 — N분 내 목표 미달 시 청산(죽은돈 회수). TP1 후 런너는 면제(추세 지속 기대).
    const tsMin = sr.timeStopMinutes || 40;
    const tsMinPnl = sr.timeStopMinPnl != null ? sr.timeStopMinPnl : 0.4;
    if (!tp1Done && heldMin >= tsMin && pnlPct < tsMinPnl) {
      return { sell: true, sellQty: pos.qty, reason: "SCALP-TIME " + heldMin + "min " + pnlPct.toFixed(2) + "%" };
    }
    return { sell: false };
  }

  // === [V52 SNAP] 스냅백 전용 청산 — 평균회귀 완료(MA5 상향/RSI2 해소) 시 즉시 전량, 빠른 손절·타임스톱 ===
  if (strategyName === "snap") {
    const sn = Object.assign({}, DEFAULT_CFG.snapRules || {}, cfg.snapRules || {});
    const metaS = pos.meta || {};
    const pnlS = pos.avg > 0 ? ((price - pos.avg) / pos.avg) * 100 : 0;
    const heldD = pos.opened_ts ? (Date.now() - pos.opened_ts) / 86400000 : 0;
    const tp1DoneS = !!metaS.tp1Done;
    // 1) 하드 손절 (stopPrice 우선 — executeBuy가 entry − 1.5×ATR / −3.5% 타이트쪽으로 설정, TP1 후 BE락)
    const spS = (typeof metaS.stopPrice === "number") ? metaS.stopPrice : null;
    if (spS != null && price <= spS) {
      return { sell: true, sellQty: pos.qty, reason: "SNAP-STOP " + pnlS.toFixed(2) + "%" + (metaS.breakEvenLocked ? " (BE)" : "") };
    }
    if (spS == null && pnlS <= -(sn.stopLossPct || 3.5)) {
      return { sell: true, sellQty: pos.qty, reason: "SNAP-STOP " + pnlS.toFixed(2) + "%" };
    }
    // 2) 하드 익절
    if (pnlS >= (sn.takeProfitPct || 5.0)) {
      return { sell: true, sellQty: pos.qty, reason: "SNAP-TP +" + pnlS.toFixed(2) + "%" };
    }
    // 3) TP1 분할익절 — +tp1Pct 도달 시 절반 + 본전락 (executeSell이 BE락 처리)
    const tp1S = sn.tp1Pct != null ? sn.tp1Pct : 2.0;
    if (!tp1DoneS && tp1S > 0 && pnlS >= tp1S) {
      const halfS = Math.floor(pos.qty / 2);
      if (halfS > 0) return { sell: true, sellQty: halfS, reason: "SNAP-TP1 +" + pnlS.toFixed(2) + "%" };
      return { sell: true, sellQty: pos.qty, reason: "SNAP-TP1-FULL +" + pnlS.toFixed(2) + "%" };
    }
    // 4) 평균회귀 완료 — 종가 > MA5 또는 RSI(2) ≥ exitRsi2 → 전량 청산 (목표 달성, 오래 들고 있지 않는다)
    const closesS = daily && daily.closes;
    if (closesS && closesS.length >= 10) {
      if (sn.exitAboveMa5 !== false) {
        const ma5S = getMA(closesS, 5);
        if (ma5S != null && price > ma5S && pnlS > 0.3) {
          return { sell: true, sellQty: pos.qty, reason: "SNAP-MR>MA5 +" + pnlS.toFixed(2) + "%" };
        }
      }
      const exR = sn.exitRsi2 != null ? sn.exitRsi2 : 65;
      if (exR > 0) {
        const rsi2S = getRSI(closesS, 2);
        if (rsi2S != null && rsi2S >= exR && pnlS > 0) {
          return { sell: true, sellQty: pos.qty, reason: "SNAP-MR RSI2 " + rsi2S.toFixed(0) + " +" + pnlS.toFixed(2) + "%" };
        }
      }
    }
    // 5) 타임스톱 — N거래일 내 본전 미만이면 평균회귀 실패 → 철수
    const tsD = sn.timeStopDays || 5;
    if (heldD >= tsD && pnlS < (sn.timeStopMinPnl != null ? sn.timeStopMinPnl : 0)) {
      return { sell: true, sellQty: pos.qty, reason: "SNAP-TIME " + heldD.toFixed(0) + "d " + pnlS.toFixed(2) + "%" };
    }
    return { sell: false };
  }

  const r = getTrendRules(cfg, market);
  const meta = pos.meta || {};
  const pnlRate = pos.avg > 0 ? ((price - pos.avg) / pos.avg) * 100 : 0;
  const peakPrice = (meta.peakPrice && meta.peakPrice > 0) ? meta.peakPrice : pos.avg;
  const heldDays = pos.opened_ts ? (Date.now() - pos.opened_ts) / 86400000 : 0;
  const tp1Done = !!meta.tp1Done;

  // ATR (daily에서 재계산) — 트레일 폭 산정
  const closes = daily && daily.closes;
  const atr = (closes && closes.length > (cfg.atrPeriod || 14) + 1)
    ? getATR(closes, cfg.atrPeriod || 14, daily.highs, daily.lows) : null;

  // [디리스킹] 패닉/딥드로다운 시 손절·트레일 타이트닝 (인프라 유지)
  const dr = (deRiskOpts && deRiskOpts.active && cfg.crashSurvival && cfg.crashSurvival.deRisk) ? cfg.crashSurvival.deRisk : null;
  let trailScale = dr ? (dr.trailDropScale || 1) : 1;
  // [Vision 활용] 보유 종목 예측으로 트레일 폭 동적 조정 (추가 fetch 없이 기존 예측 사용).
  //   UP 고신뢰 → 트레일 느슨(추세 지속 신뢰 → 수익 더 키움) / DOWN → 타이트(이익 조기 보호).
  if (visionHint && typeof visionHint.conf === "number" && visionHint.conf >= 0.65) {
    if (visionHint.pred === "up")        trailScale *= 1.3;
    else if (visionHint.pred === "down") trailScale *= 0.7;
  }
  // [VIX 적응 트레일] 고변동(VIX↑) → 트레일 넓게(노이즈 손절 방지), 저변동(VIX↓) → 좁게(이익 보호)
  //   VIX 28+ : 시장 불안 → 작은 되돌림에 청산되지 않도록 여유 확대
  //   VIX 14미만: 안정장 → 트레일 타이트하게 유지해 이익 최대 보존
  const _vix = deRiskOpts && deRiskOpts.vixValue ? deRiskOpts.vixValue : 0;
  if (_vix >= 28)              trailScale *= 1.20;
  else if (_vix > 0 && _vix < 14) trailScale *= 0.85;
  // [레버리지/인버스 특화] 3배 ETF는 변동성·decay(시간가치 손실)가 커 빠른 이익 보호가 핵심.
  //   트레일을 타이트(×0.65)하게 → 큰 변동을 빠르게 확정, 되돌림에 이익 반납 방지.
  const isLevETF = pos.symbol && LEVERAGED_ETF.has(pos.symbol);
  if (isLevETF) trailScale *= 0.65;

  // 1) 하드 손절 — 진입 시 정한 stopPrice (entry − 2×ATR or −5% 중 타이트, BE락 시 본전)
  const stopPrice = (typeof meta.stopPrice === "number") ? meta.stopPrice : null;
  if (stopPrice != null && price <= stopPrice) {
    return { sell: true, sellQty: pos.qty, reason: "STOP " + pnlRate.toFixed(2) + "%" + (meta.breakEvenLocked ? " (BE)" : "") };
  }
  // 폴백: stopPrice 없으면 % 손절
  const stopPct = (r.stopLossPct || cfg.stopLoss || 5) * (dr ? (dr.hardStopScale || 1) : 1);
  if (stopPrice == null && pnlRate <= -stopPct) {
    return { sell: true, sellQty: pos.qty, reason: "STOP " + pnlRate.toFixed(2) + "%" };
  }

  // R(손절거리%) — 분할익절/시간손절 기준
  let rPct = (stopPrice != null && pos.avg > 0) ? ((pos.avg - stopPrice) / pos.avg) * 100 : null;
  if (rPct == null || rPct <= 0) rPct = (r.stopLossPct || cfg.stopLoss || 5);

  // 2) 1R 분할익절 — +tp1AtR×R 도달 시 절반 매도 (executeSell이 손절을 본전으로 올림=BE락)
  //   [레버리지/인버스] 변동성이 커 이익이 빠르게 났다 사라짐 → 더 빠른 R(×0.7)에 절반 확정.
  if (!tp1Done) {
    const tp1Pct = rPct * (r.tp1AtR || 1.0) * (isLevETF ? 0.7 : 1.0);
    if (pnlRate >= tp1Pct) {
      // [V51] 익절 비율 파라미터화 — 절반(0.5)은 추세 초입에 너무 많이 덜어내 평균수익을 깎았다.
      //   기본 0.4로 줄여 잔량(60%)을 트레일로 더 길게 추종 → 손익비 개선(손절은 불변).
      const _f = (typeof r.tp1SellFrac === "number" && r.tp1SellFrac > 0 && r.tp1SellFrac < 1) ? r.tp1SellFrac : 0.4;
      const half = Math.floor(pos.qty * _f);
      if (half > 0) return { sell: true, sellQty: half, reason: "TP1 +" + pnlRate.toFixed(2) + "% (1R)" };
      return { sell: true, sellQty: pos.qty, reason: "TP1-FULL +" + pnlRate.toFixed(2) + "%" };
    }
  }

  // 2b) 2R 분할익절 — TP1 이후 +tp2AtR×R 도달 시 잔량의 절반 추가 매도 (트렌드 지속 수익 극대화)
  //   tp2AtR=0 으로 설정하면 비활성. 레버리지는 동일하게 ×0.7 적용.
  const tp2Done = !!meta.tp2Done;
  if (tp1Done && !tp2Done) {
    const tp2R = r.tp2AtR != null ? r.tp2AtR : 2.0;
    if (tp2R > 0) {
      const tp2Pct = rPct * tp2R * (isLevETF ? 0.7 : 1.0);
      if (pnlRate >= tp2Pct) {
        const half = Math.floor(pos.qty / 2);
        if (half > 0) return { sell: true, sellQty: half, reason: "TP2 +" + pnlRate.toFixed(2) + "% (2R)" };
      }
    }
  }

  // [강화·승자보유] 수익이 깊을수록(R배수 큼) 트레일을 넓혀 큰 추세를 끝까지 태운다.
  //   이미 충분히 번 포지션에만 적용 → 손절폭은 절대 안 넓어짐(상방만 확대). 추세추종의 핵심 알파(팻테일).
  if (r.runnerWidenEnabled !== false && rPct > 0 && pnlRate > 0) {
    const rMult = pnlRate / rPct;   // 현재 수익이 손절거리의 몇 배(R)인가
    const t1 = r.runnerR1 != null ? r.runnerR1 : 3;   // +3R↑
    const t2 = r.runnerR2 != null ? r.runnerR2 : 5;   // +5R↑
    if (rMult >= t2)      trailScale *= (r.runnerWiden2 != null ? r.runnerWiden2 : 1.5);
    else if (rMult >= t1) trailScale *= (r.runnerWiden1 != null ? r.runnerWiden1 : 1.25);
  }

  // 3) 트레일링 — 피크 − trailAtrMult×ATR 하락 시 (이익 중일 때만)
  if (atr != null && atr > 0 && pnlRate > 0) {
    const trailStop = peakPrice - atr * (r.trailAtrMult || 2.5) * trailScale;
    if (price <= trailStop) {
      const peakPct = pos.avg > 0 ? ((peakPrice - pos.avg) / pos.avg) * 100 : 0;
      return { sell: true, sellQty: pos.qty, reason: "TRAIL " + pnlRate.toFixed(2) + "% (peak +" + peakPct.toFixed(1) + "%)" + (dr ? " (DERISK)" : "") };
    }
  }

  // 4) 추세 이탈 — 종가가 MA20 하향 이탈 (분할익절 후 잔량 보호)
  if (tp1Done && dailyMa != null && price < dailyMa) {
    return { sell: true, sellQty: pos.qty, reason: "TREND-EXIT <MA " + pnlRate.toFixed(2) + "%" };
  }

  // 5) 시간 손절 — N거래일 내 +0.5R 미달이면 청산 (죽은 돈 회수)
  //   [레버리지/인버스] decay(시간가치 손실) 회피 → 보유기간 상한을 절반으로 (장기 보유 금지).
  const timeStopD = isLevETF ? Math.max(3, Math.ceil((r.timeStopDays || 10) * 0.5)) : (r.timeStopDays || 10);
  if (heldDays >= timeStopD) {
    const minR = rPct * (r.timeStopMinR != null ? r.timeStopMinR : 0.5);
    if (pnlRate < minR) {
      return { sell: true, sellQty: pos.qty, reason: "TIME-STOP " + heldDays.toFixed(0) + "d " + pnlRate.toFixed(2) + "%" + (isLevETF ? " (LEV)" : "") };
    }
  }

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

  // day/scalp 전략 제외 (분봉 전략 — 일봉 백테스트에서 정직성 유지)
  const cfgBt = JSON.parse(JSON.stringify(cfg));
  if (cfgBt.strategies) { cfgBt.strategies.day = false; cfgBt.strategies.scalp = false; }

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
        // [확실성] confidence로 사이즈 축소 — 라이브 사이징과 동일 규칙(백테스트 일관)
        const sigConf = (signal && typeof signal.confidence === "number") ? Math.max(0, Math.min(1, signal.confidence)) : 1.0;
        const budget = (opts.capitalPerTrade || 1000000) * ratio / 0.25 * sigConf;
        const qty = Math.max(1, Math.floor(budget / price));
        const entryPrice = price * (1 + slippagePct / 100);
        const entryFee = entryPrice * qty * feeRate;
        const rules = getStrategyRules(cfgBt, strat, market);
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

// [튜닝] 청산 사유별 통계 — 어디서 손익이 나는지(STOP/TP1/TRAIL/TREND-EXIT/TIME-STOP) 분석용
function backtestStatsByExit(trades) {
  const out = {};
  for (const t of trades) {
    const k = (t.reason || "?").split(" ")[0];
    if (!out[k]) out[k] = [];
    out[k].push(t);
  }
  const result = {};
  for (const k of Object.keys(out)) result[k] = backtestStats(out[k]);
  return result;
}

// 여러 심볼 백테스트 실행 + 통합 통계
async function runBacktest(env, opts) {
  opts = opts || {};
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
  // [튜닝] 파라미터 오버라이드 — 배포 없이 trendRules 조합을 실험(POST body의 cfgOverride).
  if (opts.cfgOverride && opts.cfgOverride.trendRules && cfg.trendRules) {
    cfg.trendRules = Object.assign({}, cfg.trendRules, opts.cfgOverride.trendRules);
  }
  if (opts.cfgOverride && opts.cfgOverride.trendRulesKR && cfg.trendRulesKR) {
    cfg.trendRulesKR = Object.assign({}, cfg.trendRulesKR, opts.cfgOverride.trendRulesKR);
  }
  if (opts.cfgOverride && opts.cfgOverride.trendSizingKR && cfg.trendSizingKR) {
    cfg.trendSizingKR = Object.assign({}, cfg.trendSizingKR, opts.cfgOverride.trendSizingKR);
  }
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
    byExit: backtestStatsByExit(allTrades),
    bySymbol: perSymbol,
    errors: errors
  };
}

async function refreshQuotesOnly(env, market) {
  const DB = env.DB;
  resetFetchBudget(200);  // [PAID] 가격 batch 18콜 + 여유
  await ensureSchema(DB);
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
  await log(DB, "INFO", null, "=== Manual quote refresh: " + market.toUpperCase() + " ===");

  const indices = market === "us" ? US_INDICES : KR_INDICES;
  for (const idx of indices) {
    try { const d = await fetchIndexDaily(idx); await saveIndex(DB, idx, market, d); }
    catch (e) { await log(DB, "WARN", idx, "index fetch fail: " + e.message); }
  }

  const tickers = market === "us" ? cfg.usTickers : cfg.krTickers;
  // [V11] 전 종목을 한 번에 돌면 subrequest 한도를 넘으므로, 남은 예산만큼만
  //   라운드로빈으로 갱신한다. 호출을 반복하면 전 종목이 순차로 갱신된다.
  const rrKey = "refresh_rr:" + market;
  let rrIdx = await getState(DB, rrKey, 0);
  if (typeof rrIdx !== "number" || rrIdx < 0) rrIdx = 0;
  let ok = 0, fail = 0, skippedBudget = 0;
  const startIdx = rrIdx % tickers.length;
  const ordered = tickers.slice(startIdx).concat(tickers.slice(0, startIdx));
  let processed = 0;
  for (const symbol of ordered) {
    // intra(1) + 일봉 만료 시(최대 1~2) 여유를 두고, 예산이 3 미만이면 중단
    if (fetchBudgetLeft() < 3) { skippedBudget++; continue; }
    try {
      const intra = await fetchIntraday(symbol);
      const daily = await getDailyCached(DB, symbol, cfg.dailyCacheMinutes);
      if (!intra.price || intra.price <= 0) { fail++; processed++; continue; }
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
      ok++; processed++;
    } catch (e) {
      // 예산 초과 에러는 ERROR 로 남기지 않고 조용히 중단 (정상적인 라운드로빈 경계)
      if (/budget/.test(e.message || "")) { skippedBudget++; break; }
      fail++; processed++;
      await log(DB, "WARN", symbol, "fetch fail: " + e.message);
    }
  }
  // 다음 호출이 이어서 처리하도록 라운드로빈 인덱스 전진
  await setState(DB, rrKey, (startIdx + processed) % tickers.length);
  await log(DB, "INFO", null, market.toUpperCase() + " quote refresh: ok=" + ok + " fail=" + fail +
    " budgetSkip=" + skippedBudget + " (라운드로빈 — 반복 호출 시 전 종목 갱신)");
  return { ok: ok, fail: fail, skippedBudget: skippedBudget };
}

// === [V12] 샤드 단위 시세 갱신 — 무료 플랜 50 subrequest/invocation 우회 ===
//   Cloudflare 무료 플랜은 한 invocation 당 외부 fetch 50개가 상한이고 못 늘린다.
//   하지만 "HTTP 요청 1건 = 1 invocation = 새 50개 예산" 이다.
//   따라서 종목을 작은 샤드(≈40종)로 쪼개 각 샤드를 별도 HTTP 요청으로 처리하면,
//   프론트엔드가 모든 샤드를 "동시에" 호출할 때 각 호출이 독립 invocation 으로 떠
//   각자 50개 예산을 받는다 → 한 번(=1분)에 전 종목이 병렬로 갱신된다.
//   (Cloudflare 공식 권장 fan-out 패턴: 50개짜리 엔드포인트를 외부에서 N번 호출)
// === [V13] 가격/일봉 분리 샤드 — 무료 플랜 제약(50 subreq, CPU 10ms, 동시연결 6) 정밀 대응 ===
//   교훈: 한 샤드에서 "일봉 fetch + 무거운 지표계산 + 가격 fetch" 를 다 하면
//         (1) 동시 연결 6개 제한으로 wall-time 이 길어지고
//         (2) 종목당 2 fetch 라 샤드를 작게 쪼개야 해 샤드 수가 많아지고
//         (3) JSON 파싱+지표계산이 CPU 를 먹는다.
//   해결: 역할 분리.
//     • 가격 샤드(PRICE) — 가격만. 종목당 fetch 1개, 지표계산 없음(기존 quote 보존).
//       정규장 1분 갱신의 주역. 샤드당 30종목, 동시연결 6 맞춰 6개씩 5라운드.
//     • 일봉 샤드(DAILY) — 일봉+지표. 30분 캐시라 자주 안 돌아도 됨. 샤드당 12종목.
const PRICE_SHARD_SIZE = 150; // [V17] v7 batch 50씩 3호출/샤드
const DAILY_SHARD_SIZE = 12;   // 일봉+지표: 종목당 fetch 1~2 → 최대 24 < 45, CPU 여유
const CONN_LIMIT = 3;          // 무료 플랜 invocation 당 동시 outgoing connection 한도

function shardSlice(tickers, shard, size) {
  const start = shard * size;
  return tickers.slice(start, start + size);
}
function shardCount(tickers, size) {
  return Math.max(1, Math.ceil(tickers.length / size));
}
// 하위호환 (기존 호출부가 있을 수 있어 유지)
const SHARD_SIZE = PRICE_SHARD_SIZE;
function getShardTickers(tickers, shard) { return shardSlice(tickers, shard, PRICE_SHARD_SIZE); }
function getShardCount(tickers) { return shardCount(tickers, PRICE_SHARD_SIZE); }

// 동시연결 한도(6)를 지키며 병렬 실행하는 풀 러너
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function lane() {
    while (idx < items.length) {
      const cur = idx++;
      try { results[cur] = await worker(items[cur], cur); }
      catch (e) { results[cur] = null; }
    }
  }
  const lanes = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) lanes.push(lane());
  await Promise.all(lanes);
  return results;
}

// --- 가격 전용 샤드: 가격/등락률만 갱신, 지표는 기존 quote에서 보존 ---
async function refreshPriceShard(env, market, shard) {
  const DB = env.DB;
  const t0 = Date.now();
  resetFetchBudget(200);  // [PAID] 가격 shard 여유
  await ensureSchema(DB);
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
  const tickers = market === "us" ? cfg.usTickers : cfg.krTickers;
  const total = shardCount(tickers, PRICE_SHARD_SIZE);
  const symbols = shardSlice(tickers, shard, PRICE_SHARD_SIZE);
  if (symbols.length === 0) return { ok: 0, fail: 0, shard: shard, shardCount: total, done: true };
  const tSetup = Date.now() - t0;
  const tPrev = 0;

  const nowTs = Date.now();
  // [V15] v7 batch(crumb) 우선 — 50종목 1호출. 누락분만 chart 폴백.
  const tFetch0 = Date.now();
  const bq = await fetchBatchQuotes(symbols, { maxFallback: symbols.length, DB: DB });
  const tFetch = Date.now() - tFetch0;
  const results = symbols.map(function(symbol){
    const q = bq[symbol];
    if (q && q.price != null) return { symbol: symbol, ok: true, price: q.price, prevClose: q.prevClose, dayPct: q.dayPct };
    return { symbol: symbol, ok: false };
  });

  const stmts = [];
  let ok = 0, fail = 0;
  for (const r of results) {
    if (r && r.ok) {
      // [V18] 신규 quote 기본값 (해당 키가 없을 때 INSERT)
      const fresh = { market: market, price: r.price, prevClose: r.prevClose, dayPct: r.dayPct, ts: nowTs };
      // ON CONFLICT: 기존 JSON에서 가격 3필드 + ts만 갱신, 일봉 지표(rsi/ma/atr 등)는 보존.
      // [V33] json_valid 가드 — 기존 v가 깨진 JSON이면 json_set이 실패하므로,
      //   그 경우 fresh 전체로 덮어써 가격 갱신이 영구 중단되는 것을 방지.
      stmts.push(
        DB.prepare(
          "INSERT INTO state (k, v, updated_ts) VALUES (?1, ?2, ?6) " +
          "ON CONFLICT(k) DO UPDATE SET v = CASE WHEN json_valid(v) " +
          "THEN json_set(v, '$.price', ?3, '$.prevClose', ?4, '$.dayPct', ?5, '$.ts', ?6) " +
          "ELSE ?2 END, updated_ts = ?6"
        ).bind("quote:" + r.symbol, JSON.stringify(fresh), r.price, r.prevClose, r.dayPct, nowTs)
      );
      ok++;
    } else if (r) { fail++; }
  }
  const tWrite0 = Date.now();
  for (let i = 0; i < stmts.length; i += 100) {
    try { await DB.batch(stmts.slice(i, i + 100)); } catch (e) {
      await log(DB, "WARN", null, "[V13] price shard write fail: " + e.message);
    }
  }
  const tWrite = Date.now() - tWrite0;
  const tTotal = Date.now() - t0;
  if (tTotal > 3000) {
    await log(DB, "INFO", null, "[V17] slow price shard " + market + "#" + shard +
      " total=" + tTotal + "ms (setup=" + tSetup + " prev=" + tPrev + " fetch=" + tFetch + " write=" + tWrite + ") ok=" + ok + " fail=" + fail);
  }
  return { ok: ok, fail: fail, shard: shard, shardCount: total, done: shard >= total - 1,
           ms: tTotal, msFetch: tFetch, msPrev: tPrev, msWrite: tWrite };
}

// --- 일봉+지표 샤드: 일봉 fetch(캐시 만료 시) + 지표 계산 후 quote에 병합 ---
async function refreshDailyShard(env, market, shard) {
  const DB = env.DB;
  resetFetchBudget(300);  // [PAID] 일봉 shard 최대 60 fetch × 여유
  await ensureSchema(DB);
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
  const mcfg = getMarketCfg(cfg, market);
  const cacheMin = mcfg.dailyCacheMinutes || 30;
  const tickers = market === "us" ? cfg.usTickers : cfg.krTickers;
  const total = shardCount(tickers, DAILY_SHARD_SIZE);
  const symbols = shardSlice(tickers, shard, DAILY_SHARD_SIZE);
  if (symbols.length === 0) return { ok: 0, fail: 0, shard: shard, shardCount: total, done: true };

  const nowTs = Date.now();
  const results = await runPool(symbols, CONN_LIMIT, async function(symbol){
    try {
      let daily = await getState(DB, "daily:" + symbol, null);
      const fresh = daily && daily.ts && (Date.now() - daily.ts) < cacheMin * 60 * 1000;
      if (!fresh && fetchBudgetLeft() > 0) {
        try {
          const fb = await fetchDailyWithFallback(symbol);
          if (fb && fb.data) {
            daily = {
              closes: fb.data.closes, highs: fb.data.highs, lows: fb.data.lows,
              volumes: fb.data.volumes, prevClose: fb.data.prevClose, ts: Date.now()
            };
            await setState(DB, "daily:" + symbol, daily);
          }
        } catch (e) {}
      }
      if (!daily || !daily.closes || daily.closes.length < 25) return { symbol: symbol, ok: false };
      const closes = daily.closes, highs = daily.highs || null, lows = daily.lows || null;
      const indicators = {
        dailyRsi: closes.length >= mcfg.rsiPeriod + 1 ? getRSI(closes, mcfg.rsiPeriod) : null,
        dailyMa: closes.length >= mcfg.maPeriod ? getMA(closes, mcfg.maPeriod) : null,
        dailyMaShort: closes.length >= mcfg.maShortPeriod ? getMA(closes, mcfg.maShortPeriod) : null,
        dailyAtr: closes.length >= mcfg.atrPeriod + 1 ? getATR(closes, mcfg.atrPeriod, highs, lows) : null
      };
      const bb = getBollingerBands(closes, mcfg.maPeriod, mcfg.bbStdMult);
      const return20 = getNDayReturn(closes, 20);
      return { symbol: symbol, ok: true, ind: indicators, bb: bb, return20: return20, lastClose: closes[closes.length-1], prevClose: daily.prevClose };
    } catch (e) { return { symbol: symbol, ok: false }; }
  });

  const stmts = [];
  let ok = 0, fail = 0;
  for (const r of results) {
    if (r && r.ok) {
      const prev = await getState(DB, "quote:" + r.symbol, null) || {};
      // 가격이 아직 없으면 일봉 종가로라도 채움
      const price = (typeof prev.price === "number" && prev.price > 0) ? prev.price : r.lastClose;
      const prevClose = (typeof prev.prevClose === "number" && prev.prevClose > 0) ? prev.prevClose : (r.prevClose || price);
      const dayPct = (typeof prev.dayPct === "number") ? prev.dayPct : (prevClose ? ((price - prevClose) / prevClose) * 100 : 0);
      const merged = Object.assign({}, prev, {
        market: market, price: price, prevClose: prevClose, dayPct: dayPct,
        dailyRsi: r.ind.dailyRsi, rsi: r.ind.dailyRsi,
        dailyMa: r.ind.dailyMa, ma: r.ind.dailyMa, dailyMaShort: r.ind.dailyMaShort,
        dailyAtr: r.ind.dailyAtr, atr: r.ind.dailyAtr,
        bbLower: r.bb ? r.bb.lower : null, bbUpper: r.bb ? r.bb.upper : null,
        return20: r.return20,
        ts: (typeof prev.ts === "number") ? prev.ts : nowTs
      });
      stmts.push(
        DB.prepare("INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_ts=excluded.updated_ts")
          .bind("quote:" + r.symbol, JSON.stringify(merged), nowTs)
      );
      ok++;
    } else if (r) { fail++; }
  }
  for (let i = 0; i < stmts.length; i += 100) {
    try { await DB.batch(stmts.slice(i, i + 100)); } catch (e) {
      await log(DB, "WARN", null, "[V13] daily shard write fail: " + e.message);
    }
  }
  return { ok: ok, fail: fail, shard: shard, shardCount: total, done: shard >= total - 1 };
}

// 하위호환: 기존 refreshShard 호출(있다면) → 가격 샤드로 위임
async function refreshShard(env, market, shard) {
  return refreshPriceShard(env, market, shard);
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
        if (!signalStats[sigName]) signalStats[sigName] = { wins: 0, count: 0, totalPnl: 0, weightedWins: 0, weightedCount: 0, stops: 0, winSum: 0, lossSum: 0 };
        signalStats[sigName].count++;
        signalStats[sigName].totalPnl += (t.pnl_pct || 0) * memberShare;
        signalStats[sigName].weightedCount += recencyWeight;
        // [V9.6] 손절 추적 — reason에 STOP 포함 시 손절로 카운팅
        if (reason && reason.indexOf("STOP") !== -1) {
          signalStats[sigName].stops++;
        }
        if (t.pnl_pct > 0) {
          signalStats[sigName].wins++;
          signalStats[sigName].weightedWins += recencyWeight;
          signalStats[sigName].winSum += (t.pnl_pct || 0);   // [V9.7] 승리 PnL 누적(손익비용)
        } else {
          signalStats[sigName].lossSum += (t.pnl_pct || 0);  // [V9.7] 손실 PnL 누적(음수)
        }
        // 2) [V8.5] strategy:signal
        const sKey = stratKey + ":" + sigName;
        if (!signalStatsByStrat[sKey]) signalStatsByStrat[sKey] = { wins: 0, count: 0, totalPnl: 0, weightedWins: 0, weightedCount: 0, stops: 0 };
        signalStatsByStrat[sKey].count++;
        signalStatsByStrat[sKey].totalPnl += (t.pnl_pct || 0) * memberShare;
        signalStatsByStrat[sKey].weightedCount += recencyWeight;
        // [V9.6] 손절 추적
        if (reason && reason.indexOf("STOP") !== -1) {
          signalStatsByStrat[sKey].stops++;
        }
        if (t.pnl_pct > 0) {
          signalStatsByStrat[sKey].wins++;
          signalStatsByStrat[sKey].weightedWins += recencyWeight;
        }
      }
    }
    for (const k in signalStats) {
      const s = signalStats[k];
      s.winRate = s.count > 0 ? s.wins / s.count : 0;
      s.avgPnl = s.count > 0 ? s.totalPnl / s.count : 0;
      s.weightedWinRate = s.weightedCount > 0
        ? s.weightedWins / s.weightedCount : s.winRate;
      // [V9.7] 손익비/기대값 통계 — avgWin·avgLoss·expectancy. 승률만으론 못 잡는
      //   "승률 낮지만 손익비 좋은 신호"와 "승률 높지만 큰 손실로 갉아먹는 신호"를 구분.
      s.avgWin = s.winSum != null && s.wins > 0 ? s.winSum / s.wins : 0;
      s.avgLoss = s.lossSum != null && (s.count - s.wins) > 0 ? s.lossSum / (s.count - s.wins) : 0;
      s.stopRate = s.count > 0 ? (s.stops || 0) / s.count : 0;
      // expectancy = WR×avgWin + (1-WR)×avgLoss  (avgLoss는 음수)
      s.expectancy = s.winRate * s.avgWin + (1 - s.winRate) * s.avgLoss;
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
    //   [V9.7] 기준 강화 — 기존 (WR<40% & avgPnL<0) AND 조건은 둔감해서 SW_RSI_REV 같은
    //   명백한 손실 신호(26건 WR31% avgPnL-2.49)도 살아남았다. 아래 셋 중 하나라도 걸리면 비활성화:
    //     (a) 기존: WR<40% & avgPnL<0   (b) expectancy<0 (손익비 반영 기대값 음수)
    //     (c) 손절률>55% & avgPnL<0     — 손절로 자주 끝나면서 평균도 마이너스
    for (const sigName in signalStats) {
      const s = signalStats[sigName];
      if (s.count < 20) continue;
      const condA = s.weightedWinRate < 0.40 && s.avgPnl < 0;
      const condB = s.expectancy < 0 && s.count >= 25;        // 기대값 음수(표본 약간 더 요구)
      const condC = s.stopRate > 0.55 && s.avgPnl < 0;        // 손절 빈발 + 평균 손실
      if (condA || condB || condC) {
        if (newCfg.disabledSignals.indexOf(sigName) === -1) {
          newCfg.disabledSignals.push(sigName);
          newCfg.disabledSignalsAt[sigName] = nowTs;
          newlyDisabled.push(sigName + "(" + (condA?"WR":condB?"EXP":"STOP") + ")");
        }
      }
    }
    // 2) 재활성화 — 비활성화 후 reviewDays 경과 + [V9.7] 성과 실제 회복 확인.
    //   기존엔 시간만 지나면 무조건 풀어 나쁜 신호가 30일마다 부활했다. 이제 재평가 시점의
    //   누적 통계로 expectancy>0(또는 표본 부족으로 판단불가)일 때만 해제하고,
    //   여전히 나쁘면 비활성 유지하되 타이머만 리셋(다음 주기에 재심사).
    const reactivated = [];
    const stillDisabled = [];
    for (const sigName of newCfg.disabledSignals) {
      const disabledAt = newCfg.disabledSignalsAt[sigName] || 0;
      if (nowTs - disabledAt >= reviewMs) {
        const s = signalStats[sigName];
        const recovered = !s || s.count < 20 || (s.expectancy > 0 && s.weightedWinRate >= 0.40);
        if (recovered) {
          reactivated.push(sigName);
          delete newCfg.disabledSignalsAt[sigName];
        } else {
          // 아직 나쁨 → 비활성 유지, 타이머 리셋해 다음 reviewDays 후 재심사
          newCfg.disabledSignalsAt[sigName] = nowTs;
          stillDisabled.push(sigName);
        }
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
      const tuneState = await getState(DB, tuneKey, { lastTunedAt: 0, tradeCountAtLastTune: 0, lastRegime: null, tuneSeq: 0, lastDir: {} });
      if (typeof tuneState.tuneSeq !== "number") tuneState.tuneSeq = 0;
      if (!tuneState.lastDir) tuneState.lastDir = {};
      const totalRes = await DB.prepare("SELECT COUNT(*) as c FROM trades WHERE side = ? AND market = ?")
        .bind("SELL", market).first();
      const sellCount = (totalRes && totalRes.c) || 0;

      const wins = mtSells.filter(function(t){ return t.pnl_pct > 0; });
      const winRate = wins.length / mtSells.length;
      const avgPnl = mtSells.reduce(function(a,t){ return a + (t.pnl_pct || 0); }, 0) / mtSells.length;
      const regime = (regimes[market] && regimes[market].regime) || "NEUTRAL";
      const v13 = cfg.autoTuneV13 || {};

      // [V13] 정기 튠 게이트 우회 조건:
      //   (1) regime 전환(BULL↔BEAR) 발생 → 즉시 1회 재튠
      //   (2) 긴급 가드레일 — 최근 짧은 윈도우 손실 폭증
      const regimeShifted = v13.enabled && v13.regimeShiftRetune
        && tuneState.lastRegime && tuneState.lastRegime !== regime
        && (regime === "BEAR" || tuneState.lastRegime === "BEAR");
      let panicTrigger = false;
      if (v13.enabled && v13.panicTune && v13.panicTune.enabled) {
        const pw = mtSells.slice(0, v13.panicTune.window);
        if (pw.length >= v13.panicTune.window) {
          const pl = pw.filter(function(t){ return (t.pnl_pct || 0) <= 0; }).length;
          if (pl >= v13.panicTune.lossThresh) panicTrigger = true;
        }
      }
      const dueRegular = (sellCount - tuneState.tradeCountAtLastTune >= 10);
      if (!dueRegular && !regimeShifted && !panicTrigger) continue;

      // 시장 cfg 머지된 현재 값 (베이스 폴백 포함)
      const curMcfg = getMarketCfg(cfg, market);
      const mChanges = [];
      const mNew = newCfg.markets[market];

      // [V13] 진동 방지 — 같은 키를 직전과 반대방향으로 너무 자주 못 바꾸게.
      const clampCfg = v13.clamp || { maxStopStep: 1.0, oscillationCooldownTunes: 2 };
      function dirAllowed(key, dir) {
        const last = tuneState.lastDir[key];
        if (!last) return true;
        if (last.dir === dir) return true;
        return (tuneState.tuneSeq - last.seq) >= (clampCfg.oscillationCooldownTunes || 2);
      }
      function recordDir(key, dir) { tuneState.lastDir[key] = { dir: dir, seq: tuneState.tuneSeq + 1 }; }

      // [V13-A] 긴급 가드레일 — 정기 튠보다 먼저, 손절·사이즈 즉시 보수화.
      if (panicTrigger) {
        const pt = v13.panicTune;
        const curStop = curMcfg.stopLoss;
        const nextStop = Math.max(2.0, +(curStop - pt.stopTightenStep).toFixed(2));
        if (nextStop !== curStop && dirAllowed("stopLoss", -1)) {
          mNew.stopLoss = nextStop; mChanges.push("PANIC-STOP " + curStop + "->" + nextStop); recordDir("stopLoss", -1);
        }
        const cs2 = curMcfg.strategySizing || {};
        const curB = (cs2.swing && cs2.swing.base) != null ? cs2.swing.base : curMcfg.posSize;
        if (curB != null) {
          const nb = Math.max(8, Math.round(curB * pt.sizeScaleStep));
          if (nb !== curB) {
            const bs = mNew.strategySizing || JSON.parse(JSON.stringify(cs2));
            if (!bs.swing) bs.swing = { base: curB, bullMult: 1.0, bearMult: 1.0 };
            bs.swing.base = nb; mNew.strategySizing = bs; mNew.posSize = nb;
            mChanges.push("PANIC-SIZE " + curB + "->" + nb);
          }
        }
      }

      // RSI 조정 — 시장별 regime + 시장별 성과 기준
      if (regime === "BEAR" && avgPnl < 0) {
        const next = Math.max(30, curMcfg.rsiBuy - 2);
        if (next !== curMcfg.rsiBuy) { mNew.rsiBuy = next; mChanges.push("RSI " + curMcfg.rsiBuy + "->" + next); }
      } else if (regime === "BULL" && winRate > 0.55 && avgPnl > 2) {
        const next = Math.min(40, curMcfg.rsiBuy + 1);
        if (next !== curMcfg.rsiBuy) { mNew.rsiBuy = next; mChanges.push("RSI " + curMcfg.rsiBuy + "->" + next); }
      }

      // [V8.2] 시장별 stopLoss 조정 — 시장 성과 나쁘면 손절 더 타이트
      //   [V13] panicTune이 이미 stopLoss를 건드렸으면 중복 조정 안 함. 변경폭은 maxStopStep로 클램프, 진동 방지.
      const stopBase = curMcfg.stopLoss;
      if (mNew.stopLoss === undefined) {
        const maxStep = clampCfg.maxStopStep || 1.0;
        if (winRate < 0.40 && avgPnl < -1.0) {
          let next = Math.max(2.0, +(stopBase - 0.5).toFixed(2));
          next = Math.max(+(stopBase - maxStep).toFixed(2), next);
          if (next !== stopBase && dirAllowed("stopLoss", -1)) { mNew.stopLoss = next; mChanges.push("STOP " + stopBase + "->" + next); recordDir("stopLoss", -1); }
        } else if (winRate > 0.55 && avgPnl > 1.5) {
          let next = Math.min(8.0, +(stopBase + 0.3).toFixed(2));
          next = Math.min(+(stopBase + maxStep).toFixed(2), next);
          if (next !== stopBase && dirAllowed("stopLoss", 1)) { mNew.stopLoss = next; mChanges.push("STOP " + stopBase + "->" + next); recordDir("stopLoss", 1); }
        }
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

      // [V13-C] strategy별(momentum/meanrev) 사이즈 자동 조정 — strategy:signal 통계로 성과 집계.
      const psCfg = v13.perStrategySizing;
      if (psCfg && psCfg.enabled) {
        // 이 시장의 strategy별 성과를 mtSells에서 reason의 [STRATEGY] 토큰으로 집계.
        const stratAgg = {};
        for (const t of mtSells) {
          const sm = (t.reason || "").match(/^\[([A-Z]+)\]/);
          const st = sm ? sm[1].toLowerCase() : null;
          if (!st) continue;
          if (!stratAgg[st]) stratAgg[st] = { n: 0, w: 0, sum: 0 };
          stratAgg[st].n++; stratAgg[st].sum += (t.pnl_pct || 0);
          if ((t.pnl_pct || 0) > 0) stratAgg[st].w++;
        }
        for (const st of ["momentum", "meanrev"]) {
          const a = stratAgg[st];
          if (!a || a.n < psCfg.minTrades) continue;
          const wr = a.w / a.n, ap = a.sum / a.n;
          const sizingObj = mNew.strategySizing || JSON.parse(JSON.stringify(curMcfg.strategySizing || {}));
          const cur = (sizingObj[st] && sizingObj[st].base) != null ? sizingObj[st].base
                    : (curMcfg.strategySizing && curMcfg.strategySizing[st] && curMcfg.strategySizing[st].base) != null ? curMcfg.strategySizing[st].base : null;
          if (cur == null) continue;
          let nb = null;
          if (wr >= psCfg.goodWR && ap >= psCfg.goodPnl) nb = Math.min(psCfg.baseMax, cur + psCfg.upStep);
          else if (wr <= psCfg.badWR && ap <= psCfg.badPnl) nb = Math.max(psCfg.baseMin, cur - psCfg.downStep);
          if (nb !== null && nb !== cur) {
            if (!sizingObj[st]) sizingObj[st] = { base: cur, bullMult: 1.0, bearMult: 1.0 };
            sizingObj[st].base = nb;
            mNew.strategySizing = sizingObj;
            mChanges.push(st.toUpperCase().slice(0,3) + "SIZE " + cur + "->" + nb);
          }
        }
      }

      // [V13-E] 드로다운 연동 riskPerTrade 축소 — equity 고점 낙폭이 클수록 거래당 리스크↓.
      const ddrCfg = v13.drawdownRisk;
      if (ddrCfg && ddrCfg.enabled) {
        const peak = await getState(DB, "equity_peak:" + market, null);
        if (typeof peak === "number" && peak > 0) {
          // 현 equity는 정확치 않아도 되니, 직전 사이클 저장값 대신 보수적으로 cash+미실현 근사 생략 →
          //   여기서는 peak 대비 "직전 저장된 현재가 기반 추정"을 쓸 수 없으므로 ddPct는 메인 루프 로그를 참고.
          //   대신 trades 기반 최근 손실 누적으로 근사 트리거: 최근 10건 합이 음수이고 클수록 강하게.
          const recentSum = mtSells.slice(0, 10).reduce(function(s,t){ return s + (t.pnl_pct || 0); }, 0);
          const approxDd = recentSum < 0 ? Math.min(30, -recentSum) : 0;  // 최근 10건 누적손실%를 드로다운 근사
          if (approxDd >= ddrCfg.ddTrigger) {
            const rb = (curMcfg.riskBasedSizing && curMcfg.riskBasedSizing.riskPerTrade) || (cfg.riskBasedSizing && cfg.riskBasedSizing.riskPerTrade) || 0.8;
            const cut = (approxDd - ddrCfg.ddTrigger) * ddrCfg.perPctRiskCut;
            const nr = Math.max(ddrCfg.riskFloor, +(rb - cut).toFixed(2));
            if (nr < rb) {
              const rbObj = mNew.riskBasedSizing || JSON.parse(JSON.stringify(curMcfg.riskBasedSizing || cfg.riskBasedSizing || {}));
              rbObj.riskPerTrade = nr;
              mNew.riskBasedSizing = rbObj;
              mChanges.push("DDRISK " + rb + "->" + nr + "(dd~" + approxDd.toFixed(1) + "%)");
            }
          }
        }
      }

      if (mChanges.length > 0) {
        await setState(DB, tuneKey, {
          lastTunedAt: Date.now(), tradeCountAtLastTune: sellCount,
          lastRegime: regime, tuneSeq: tuneState.tuneSeq + 1, lastDir: tuneState.lastDir
        });
        const tag = panicTrigger ? "PANIC" : regimeShifted ? "REGIME-SHIFT" : "REG";
        await log(DB, "TUNE", null, "[" + market.toUpperCase() + "/" + regime + "/" + tag + "] WR=" + (winRate*100).toFixed(0) + "% PnL=" + avgPnl.toFixed(2) + "% -> " + mChanges.join(", "));
        anyChange = true;
        allChanges.push(market.toUpperCase() + ":" + mChanges.join(","));
      } else if (regimeShifted) {
        // 변경 없어도 regime 기록은 갱신(다음 사이클 중복 트리거 방지)
        await setState(DB, tuneKey, Object.assign({}, tuneState, { lastRegime: regime }));
      }
    }

    // [V13-D] strategy 자동 비활성화 — 한 전략의 누적 성과가 명백히 나쁘면 끔(재평가까지).
    //   signalStatsByStrat(strategy:signal)를 strategy 단위로 합산해 expectancy/WR로 판단.
    //   swing은 핵심 전략이라 보호(자동 OFF 대상에서 제외) — momentum/meanrev/day만.
    const sadCfg = (cfg.autoTuneV13 && cfg.autoTuneV13.strategyAutoDisable) || null;
    if (sadCfg && sadCfg.enabled) {
      if (!newCfg.strategies) newCfg.strategies = JSON.parse(JSON.stringify(cfg.strategies || {}));
      if (!newCfg.strategyDisabledAt) newCfg.strategyDisabledAt = Object.assign({}, cfg.strategyDisabledAt || {});
      const stratRollup = {};
      for (const sKey in signalStatsByStrat) {
        const st = sKey.split(":")[0];
        if (!st || st === "unknown") continue;
        const s = signalStatsByStrat[sKey];
        if (!stratRollup[st]) stratRollup[st] = { count: 0, wins: 0, totalPnl: 0 };
        stratRollup[st].count += s.count;
        stratRollup[st].wins += s.wins;
        stratRollup[st].totalPnl += s.totalPnl;
      }
      const reviewMs2 = (sadCfg.reviewDays || 21) * 24 * 3600 * 1000;
      const stratDisabledNow = [], stratReenabledNow = [];
      for (const st of ["momentum", "meanrev", "day"]) {
        const r = stratRollup[st];
        // 비활성 중이면 재평가
        if (newCfg.strategies[st] === false && newCfg.strategyDisabledAt[st]) {
          if (nowTs - newCfg.strategyDisabledAt[st] >= reviewMs2) {
            const ok = !r || r.count < sadCfg.minTrades || ((r.totalPnl / r.count) > 0 && (r.wins / r.count) >= sadCfg.winRateOff);
            if (ok) { newCfg.strategies[st] = true; delete newCfg.strategyDisabledAt[st]; stratReenabledNow.push(st); }
            else { newCfg.strategyDisabledAt[st] = nowTs; }
          }
          continue;
        }
        // 활성 중이면 비활성 판단
        if (newCfg.strategies[st] !== false && r && r.count >= sadCfg.minTrades) {
          const wr = r.wins / r.count, exp = r.totalPnl / r.count;
          if (exp <= sadCfg.expectancyOff && wr <= sadCfg.winRateOff) {
            newCfg.strategies[st] = false;
            newCfg.strategyDisabledAt[st] = nowTs;
            stratDisabledNow.push(st + "(exp" + exp.toFixed(2) + "/WR" + (wr*100).toFixed(0) + ")");
          }
        }
      }
      if (stratDisabledNow.length > 0) { allChanges.push("STRAT-OFF " + stratDisabledNow.join(",")); anyChange = true; await log(DB, "TUNE", null, "[V13] strategy auto-disabled: " + stratDisabledNow.join(", ")); }
      if (stratReenabledNow.length > 0) { allChanges.push("STRAT-ON " + stratReenabledNow.join(",")); anyChange = true; await log(DB, "TUNE", null, "[V13] strategy re-enabled: " + stratReenabledNow.join(", ")); }
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
  // [V31] 고유 pid — 이중체결 방지용 소유권 식별자 (시각+난수)
  const myPid = now * 1000 + Math.floor(Math.random() * 1000);
  const lockValue = JSON.stringify({ until: now + ttl, pid: myPid });

  // [FIX V8.7] 워커가 사이클 도중 timeout/kill되면 finally가 실행되지 않아
  //   락이 TTL까지 남고, 그 사이 cron이 계속 skip되어 "엔진 지연"으로 보임.
  //   1) 정상 만료(until <= now) 락 정리 + 2) 비정상 stale 락(생성 후 5분 경과)도 강제 정리.
  const STALE_MS = 5 * 60 * 1000;

  // [V32] json_extract 미사용 — updated_ts(=pid=생성시각×1000+rnd) 기반으로 stale 판정.
  //   1) v.until로 정상 만료 검사(JSON 파싱) + 2) updated_ts로 비정상 stale 강제 정리.
  try {
    const row = await DB.prepare("SELECT v, updated_ts FROM state WHERE k = ?").bind(lockKey).first();
    if (row) {
      let expired = false;
      // pid는 생성시각×1000 기반 → /1000 하면 대략 생성 ms. STALE_MS 경과 시 강제 정리.
      const createdMs = Math.floor(Number(row.updated_ts) / 1000);
      if (isFinite(createdMs) && createdMs <= now - STALE_MS) expired = true;
      if (!expired) {
        try {
          const parsed = JSON.parse(row.v);
          if (parsed && parsed.until && parsed.until <= now) expired = true;
        } catch (e2) {}
      }
      if (expired) {
        await DB.prepare("DELETE FROM state WHERE k = ? AND updated_ts = ?").bind(lockKey, row.updated_ts).run();
      }
    }
  } catch (e) {}

  // 2) atomic INSERT — 락이 이미 있으면 실패 (ON CONFLICT 사용 안 함)
  //   [V32] updated_ts 컬럼에 myPid를 저장 → 소유권 비교를 json_extract 없이 수행.
  try {
    await DB.prepare(
      "INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?)"
    ).bind(lockKey, lockValue, myPid).run();
    return myPid;  // 성공 시 고유 pid 반환 (소유권 확인용)
  } catch (e) {
    return null;   // UNIQUE 위반 = 다른 인스턴스 보유 중
  }
}

// [V31] 락 소유권 확인 — 내 pid가 현재 락의 pid와 같은지. 다르면 다른 워커가 가져간 것.
//   각 시장 매매 직전에 호출해 "락 만료→새 워커 진입" 시 이중체결을 차단한다.
//   [V32] updated_ts 컬럼에 pid를 저장하므로 json_extract 없이 비교 (미지원 환경 크래시 방지).
async function ownsCycleLock(DB, myPid) {
  if (myPid == null) return false;
  try {
    const row = await DB.prepare("SELECT updated_ts FROM state WHERE k = ?").bind("lock:cycle").first();
    if (!row) return false;
    return Number(row.updated_ts) === Number(myPid);
  } catch (e) {
    return false;
  }
}

// [V32] 내가 획득한 락일 때만 해제 (pid 검증) — 다른 워커 락을 실수로 지우지 않음.
async function releaseCycleLock(DB, myPid) {
  try {
    if (myPid != null) {
      await DB.prepare("DELETE FROM state WHERE k = ? AND updated_ts = ?").bind("lock:cycle", myPid).run();
    } else {
      await DB.prepare("DELETE FROM state WHERE k = ?").bind("lock:cycle").run();
    }
  } catch (e) {}
}

// [V8.5] 사이클 락 갱신 — 한 시장 처리 후 호출되어 다음 시장 처리 전 TTL 연장.
// [V32] json_extract 제거 — updated_ts(=pid)로 소유권 검증.
async function refreshCycleLock(DB, ttl, myPid) {
  const now = Date.now();
  try {
    if (myPid != null) {
      const lockValue = JSON.stringify({ until: now + ttl, pid: myPid });
      // updated_ts는 pid 유지(소유권 식별자), v의 until만 갱신
      await DB.prepare("UPDATE state SET v = ? WHERE k = ? AND updated_ts = ?")
        .bind(lockValue, "lock:cycle", myPid).run();
    } else {
      const lockValue = JSON.stringify({ until: now + ttl, pid: now });
      await DB.prepare("UPDATE state SET v = ? WHERE k = ?").bind(lockValue, "lock:cycle").run();
    }
  } catch (e) {}
}

// ============================================================
// [FX] 환율 갱신 — [V9.1] 10분 주기 (조회 전용, 매매 없음, FX 휴장 주말 제외)
//   • 대상: 달러/원·엔/원·달러/엔·파운드/원·유로/원·위안/원·호주달러/원·
//           캐나다달러/원·스위스프랑/원 + 달러 인덱스(DXY)
//   • 야후 환율 심볼을 fetchIntraday로 조회해 가격·전일대비% 저장.
//   • 엔/원은 야후 직접 페어가 비거나 부정확하면 USD/KRW ÷ USD/JPY × 100 으로 파생.
//   • 결과는 state "fx" 키에 저장 → /api/fx 로 프론트에 전달.
// ============================================================
async function runFxUpdate(env) {
  const DB = env.DB;
  resetFetchBudget(100);  // [PAID] FX ~10쌍 + 여유
  const out = {};
  let ok = 0, fail = 0;

  // 배치 조회
  const BATCH = 5;
  for (let i = 0; i < FX_PAIRS.length; i += BATCH) {
    const slice = FX_PAIRS.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async function(pair){
      try {
        const q = await fetchIntraday(pair.symbol);
        return { pair: pair, q: q, err: null };
      } catch (e) {
        // 폴백: 일봉으로 재시도 (환율은 일봉이 더 안정적일 때가 있음)
        try {
          const d = await fetchDailyFull(pair.symbol);
          return { pair: pair, q: { price: d.price, prevClose: d.prevClose }, err: null };
        } catch (e2) {
          return { pair: pair, q: null, err: e2.message || e.message };
        }
      }
    }));
    for (const r of results) {
      const p = r.pair;
      if (r.err || !r.q || !(r.q.price > 0)) {
        fail++;
        out[p.key] = { key: p.key, label: p.label, sub: p.sub, unit: p.unit, price: null, dayPct: null, err: r.err || "no data" };
        continue;
      }
      ok++;
      const price = r.q.price;
      const prev = (r.q.prevClose && r.q.prevClose > 0) ? r.q.prevClose : price;
      const dayPct = prev ? ((price - prev) / prev) * 100 : 0;
      out[p.key] = {
        key: p.key, label: p.label, sub: p.sub, unit: p.unit,
        per100: p.per100 || false,
        price: price, prevClose: prev, dayPct: dayPct
      };
    }
  }

  // 엔/원 파생 보정: 직접 페어가 실패했거나 비정상(원/엔이 5 미만 등)일 때
  //   USD/KRW ÷ USD/JPY × 100 = 100엔당 원화.
  try {
    const usdkrw = out["USDKRW"];
    const usdjpy = out["USDJPY"];
    const jpykrw = out["JPYKRW"];
    if (usdkrw && usdkrw.price > 0 && usdjpy && usdjpy.price > 0) {
      const derived100 = (usdkrw.price / usdjpy.price) * 100;  // 100엔당 원
      const bad = !jpykrw || jpykrw.price == null || jpykrw.price <= 0 || jpykrw.price < 5;
      if (bad) {
        out["JPYKRW"] = {
          key: "JPYKRW", label: "엔/원 (100엔)", sub: "JPY/KRW", unit: "₩", per100: true,
          price: derived100, prevClose: derived100, dayPct: 0, derived: true
        };
      }
    }
  } catch (e) {}

  const payload = { rates: out, updatedAt: Date.now() };
  await setState(DB, "fx", payload);
  // [V9.1] 10분 주기화로 성공 로그는 노이즈 — 실패가 있을 때만 기록
  if (fail > 0) await log(DB, "WARN", null, "[FX] 환율 갱신 일부 실패 (성공 " + ok + " / 실패 " + fail + ")");
  return payload;
}


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
  if (!(typeof price === "number" && isFinite(price) && price > 0)) {
    await log(DB, "WARN", symbol, "[CM] BUY aborted: bad price " + price); return cash;
  }
  if (!(typeof qty === "number" && isFinite(qty) && qty > 0)) {
    await log(DB, "WARN", symbol, "[CM] BUY aborted: bad qty " + qty); return cash;
  }
  qty = Math.floor(qty);
  if (qty <= 0) return cash;

  const feeRate = cfg.feeUS || 0.0001;
  const unitCost = price * (1 + feeRate);
  // ★ 단일 진실: 매수 직전 trades 원장에서 실제 가용현금 재계산 후 살 수 있는 만큼만 clamp
  let availCash;
  try {
    availCash = await computeCashFromTrades(DB, "cm", cfg);
  } catch (e) {
    await log(DB, "ERROR", symbol, "[CM] BUY aborted: 가용현금 계산 실패 " + e.message); return cash;
  }
  if (!(typeof availCash === "number" && isFinite(availCash)) || availCash <= 0) {
    await log(DB, "WARN", symbol, "[CM] BUY aborted: 가용현금 없음 (" + Math.round(availCash) + ")"); return cash;
  }
  const maxQty = Math.floor(availCash / unitCost);
  if (maxQty <= 0) {
    await log(DB, "WARN", symbol, "[CM] BUY aborted: 1주 살 현금 부족 (현금=" + Math.round(availCash) + ")"); return cash;
  }
  if (qty > maxQty) {
    await log(DB, "INFO", symbol, "[CM] BUY 수량 자동 축소 " + qty + "→" + maxQty + " (예산 한도)");
    qty = maxQty;
  }
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;

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

  // [V31] 원자재도 batch 트랜잭션으로 통일 (주식과 동일 회계 처리)
  try {
    const posToSave = {
      qty: qty, avg: price, opened_ts: Date.now(),
      meta: {
        strategy: "swing", feePaid: fee, feeRemaining: fee,
        atrAtEntry: dailyAtr, stopPrice: stopPrice, peakPrice: price,
        signal: signal.name, signalMembers: signal.members || [signal.name],
        tp1Done: false, originalQty: qty
      }
    };
    const stmtTrade = stmtRecordTrade(DB, {
      ts: Date.now(), market: "cm", symbol: symbol, side: "BUY",
      qty: qty, price: price, pnl: null, pnl_pct: null,
      reason: "[CM-SWING] " + signal.name + " " + signal.detail
    });
    const stmtPos = stmtSavePosition(DB, "cm", symbol, "swing", posToSave);
    await DB.batch([stmtTrade, stmtPos]);
  } catch (e) {
    await log(DB, "ERROR", symbol, "[CM] BUY transaction aborted (롤백됨): " + e.message);
    return cash;
  }
  if (cash && typeof cash === "object") cash.cm = availCash - total;
  const stopPctRel = ((stopPrice - price) / price * 100).toFixed(1);
  await log(DB, "TRADE", symbol, "[CM] BUY x" + qty + " @" + price.toFixed(2) + " " + signal.name + " " + signal.detail + " stop=" + stopPrice.toFixed(2) + "(" + stopPctRel + "%)");
  return cash;
}

// 원자재 전용 매도 — USD·무세금. 부분/전량 청산 지원.
async function executeSellCM(DB, symbol, pos, sellQty, price, reason, cfg, cash) {
  const feeRate = cfg.feeUS || 0.0001;
  const gross = price * sellQty;
  const fee = gross * feeRate;
  const proceeds = gross - fee;   // 원자재: 매도세 없음

  pos.meta = pos.meta || {};
  const feeRemaining = (typeof pos.meta.feeRemaining === "number") ? pos.meta.feeRemaining : (pos.meta.feePaid || 0);
  const entryFeeForThisSell = feeRemaining * (sellQty / pos.qty);
  const costBasis = pos.avg * sellQty + entryFeeForThisSell;
  const pnl = proceeds - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
  const heldMin = pos.opened_ts ? Math.floor((Date.now() - pos.opened_ts) / 60000) : 0;
  const signalMembers = pos.meta.signalMembers || [];
  const enrichedReason = "[CM-SWING] " + reason + " #entry=" + signalMembers.join(",");

  // [V31] 원자재 매도도 batch 트랜잭션으로 통일 (좀비 포지션 차단, market 명시)
  try {
    const stmtTrade = stmtRecordTrade(DB, { ts: Date.now(), market: "cm", symbol: symbol, side: "SELL", qty: sellQty, price: price, pnl: pnl, pnl_pct: pnlPct, reason: enrichedReason });
    let stmtPos;
    if (sellQty < pos.qty) {
      pos.qty = pos.qty - sellQty;
      pos.meta.tp1Done = true;
      pos.meta.feeRemaining = Math.max(0, feeRemaining - entryFeeForThisSell);
      stmtPos = stmtSavePosition(DB, "cm", symbol, "swing", pos);
    } else {
      stmtPos = stmtDeletePosition(DB, symbol, "swing", "cm");
    }
    await DB.batch([stmtTrade, stmtPos]);
  } catch (e) {
    await log(DB, "ERROR", symbol, "[CM] SELL transaction aborted (롤백됨): " + e.message);
    return { pnlPct: 0, cash: cash };
  }
  if (cash && typeof cash.cm === "number") cash.cm += proceeds;
  await log(DB, "TRADE", symbol, "[CM] SELL x" + sellQty + " @" + price.toFixed(2) + " PnL " + pnlPct.toFixed(2) + "% (held " + heldMin + "min, " + reason + ")");
  return { pnlPct: pnlPct, cash: cash };
}

// ============================================================
// [V8.9 재작성] 원자재 시세 저장/갱신 — 전면 단순화
//   기존 문제:
//   1) refreshCommodityQuotes가 json_set ON CONFLICT로 price만 부분갱신했는데,
//      D1 환경에 따라 조용히 실패하거나 일봉지표 보존 로직과 충돌 → price가 안 바뀜
//      → CUR=AVG 고정, PnL 항상 +0.00%.
//   2) saveQuoteCM(전체 덮어쓰기)과 refreshCommodityQuotes(부분 갱신)가 같은 키를
//      다른 방식으로 써서 일관성이 깨짐.
//   해결: 단일 saveQuoteCM 헬퍼로 통일. 항상 기존 quote를 읽어 병합 후 "전체 객체"를
//        다시 setState로 저장(json_set 미사용). 매분 chart fetch를 우선해 선물 시세를
//        확실히 받는다.
// ============================================================

// 원자재 시세 저장 — 기존 quote와 병합 후 전체 객체로 저장(json_set 미사용).
//   partial=true면 가격 관련 필드만 갱신하고 일봉지표(rsi/ma/atr 등)는 기존값 보존.
async function saveQuoteCM(DB, symbol, q, partial) {
  let prev = {};
  try {
    const existing = await getState(DB, "quote:" + symbol, null);
    if (existing && typeof existing === "object") prev = existing;
  } catch (e) {}

  const merged = {
    market: "cm",
    // 가격 필드 — 항상 새 값으로 갱신
    price: (typeof q.price === "number" && q.price > 0) ? q.price : (prev.price != null ? prev.price : null),
    prevClose: (typeof q.prevClose === "number" && q.prevClose > 0) ? q.prevClose : (prev.prevClose != null ? prev.prevClose : null),
    dayPct: (typeof q.dayPct === "number") ? q.dayPct : (prev.dayPct != null ? prev.dayPct : null),
    // 일봉 지표 — partial이면 기존값 보존, 아니면 새 값(없으면 기존값)
    rsi:          partial ? (prev.rsi ?? null)          : (q.dailyRsi ?? prev.rsi ?? null),
    ma:           partial ? (prev.ma ?? null)           : (q.dailyMa ?? prev.ma ?? null),
    atr:          partial ? (prev.atr ?? null)          : (q.dailyAtr ?? prev.atr ?? null),
    dailyAtr:     partial ? (prev.dailyAtr ?? null)     : (q.dailyAtr ?? prev.dailyAtr ?? null),
    dailyMa:      partial ? (prev.dailyMa ?? null)      : (q.dailyMa ?? prev.dailyMa ?? null),
    dailyMaShort: partial ? (prev.dailyMaShort ?? null) : (q.dailyMaShort ?? prev.dailyMaShort ?? null),
    bbLower:      partial ? (prev.bbLower ?? null)      : (q.bbLower ?? prev.bbLower ?? null),
    bbUpper:      partial ? (prev.bbUpper ?? null)      : (q.bbUpper ?? prev.bbUpper ?? null),
    return20:     partial ? (prev.return20 ?? null)     : (q.return20 ?? prev.return20 ?? null),
    ts: Date.now()
  };
  await setState(DB, "quote:" + symbol, merged);
}

// [V8.9] 원자재 가격만 매분 갱신 (거래는 16:00에만).
//   chart(fetchDailyFull) fetch를 우선 — 선물(=F)은 v7 batch quote에서 누락/0값이 잦다.
//   v7 batch는 보조로만 쓴다. 일봉 지표는 partial=true로 보존.
async function refreshCommodityQuotes(env) {
  const DB = env.DB;
  resetFetchBudget(100);  // [PAID] 원자재 ~12종 + 여유
  const syms = COMMODITY_SYMBOLS;
  let okCount = 0, failCount = 0;

  // 1) chart fetch 우선 (배치 6개씩 병렬) — 선물 실시간가(regularMarketPrice) 확보
  const BATCH = 6;
  for (let i = 0; i < syms.length; i += BATCH) {
    if (fetchBudgetLeft() <= 0) break;
    const slice = syms.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async function(sym){
      try {
        const d = await fetchDailyFull(sym);
        return { sym: sym, d: d };
      } catch (e) {
        return { sym: sym, d: null, err: e.message };
      }
    }));
    for (const r of results) {
      if (r.d && typeof r.d.price === "number" && r.d.price > 0) {
        const price = r.d.price;
        const prevClose = (typeof r.d.prevClose === "number" && r.d.prevClose > 0) ? r.d.prevClose : price;
        const dayPct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
        try {
          await saveQuoteCM(DB, r.sym, { price: price, prevClose: prevClose, dayPct: dayPct }, true);
          okCount++;
        } catch (e) { failCount++; }
      } else {
        failCount++;
      }
    }
  }

  await log(DB, "INFO", null, "[CM] refreshCommodityQuotes: " + okCount + "/" + syms.length + " updated" + (failCount ? " (fail=" + failCount + ")" : ""));
  return { ok: okCount, fail: failCount };
}

async function runCommodityCycle(env, forceTrade) {
  const DB = env.DB;
  resetFetchBudget(100);  // [PAID] 원자재 cycle 여유
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
  // [V8.9] 거래 시각 판정 — 윈도우(16:00~17:00) 내이면서 forceTrade거나 오늘 미거래일 때만 매매.
  let isTradeTime = false;
  if (forceTrade === true) {
    isTradeTime = true;
  } else if (isCommodityTriggerTime()) {
    // 윈도우 안 — 단, 오늘 이미 거래했으면 시세만 갱신
    isTradeTime = !(await commodityTradedToday(DB));
  }
  await log(DB, "INFO", null, "[CM] === Commodity cycle (trade=" + (isTradeTime ? (forceTrade ? "FORCED" : "ON 16:00KST") : "quote-only") + ") ===");

  let cash = await computeAllCash(DB, cfg);
  if (typeof cash.cm !== "number") cash.cm = cfg.initialCashCM;   // 최초 1회 초기화

  const positions = await getPositions(DB, "cm");   // key "SYM::swing"
  const swingRules = cfg.swingRules || {};
  let tried = 0, bought = 0, sold = 0, fetchFail = 0;

  // [V8.9] 거래 시각이 아니면 시세 fetch 자체를 스킵.
  //   매분 도는 refreshCommodityQuotes가 이미 시세를 갱신하므로, 여기서 또 12종목을
  //   fetch하면 16:00~17:00 윈도우 동안 매분 중복 fetch가 됨. 거래할 때만 fetch한다.
  if (!isTradeTime) {
    await log(DB, "INFO", null, "[CM] quote-only — 시세는 refreshCommodityQuotes가 담당, 사이클 스킵");
    return;
  }

  // 시세 prefetch (배치) — 거래 시각에만 실행
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

      // 일봉 지표 부족 시 매매 평가 스킵 (시세는 위에서 이미 저장됨)
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
        } else if (held.meta && held.meta.peakPrice == null) {
          held.meta.peakPrice = Math.max(held.avg, price);
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
    // [회계 재설계] cash는 trades 원장에서 항상 재계산되므로 별도 저장하지 않는다(죽은 코드 제거).
    // [V8.9] 오늘 거래 완료 마킹 (forceTrade 제외 — 수동 강제실행은 카운트 안 함).
    //   윈도우(16:00~17:00) 내에서 cron이 여러 번 돌아도 하루 1회만 매매하도록.
    if (forceTrade !== true) { try { await markCommodityTradedToday(DB); } catch (e) {} }
  }
  await log(DB, "INFO", null, "[CM] Done: tried=" + tried + " buy=" + bought + " sell=" + sold + " fetchFail=" + fetchFail);
}

// ============================================================
// [신규] 일반화 alt-슬리브 실시간 엔진 — 원자재(cm)·미국국채(bdus)·한국국채(bdkr) 공용
//   원자재 모듈을 일반화: 통화/수수료/거래세/거래시간만 슬리브별로 다르고 로직은 동일.
//   실시간: 매 cron 사이클에 해당 시장 장중이면 시세갱신+swing 매매(주식과 동일 빈도).
//   주식 로직과 완전 분리(별도 cash/positions/trades market 키). 예산 가드는 호출부(scheduled)에서.
// ============================================================
function _altSleeve(key, cfg) {
  if (key === "cm")   return { key: "cm",   label: "CM",   syms: COMMODITY_SYMBOLS, meta: COMMODITY_META, isKRW: false, hoursAny: true };
  if (key === "bdus") return { key: "bdus", label: "BDUS", syms: BOND_US_SYMBOLS,   meta: BOND_META,      isKRW: false, hoursMarket: "us" };
  if (key === "bdkr") return { key: "bdkr", label: "BDKR", syms: BOND_KR_SYMBOLS,   meta: BOND_META,      isKRW: true,  hoursMarket: "kr" };
  return null;
}
// 슬리브 거래 시간 판정: cm=미국 또는 한국 장중(선물 유동성), bdus=미국장, bdkr=한국장.
function _altTradeWindow(sleeve) {
  if (sleeve.hoursAny) return isTradingWindow("us") || isTradingWindow("kr");
  return isTradingWindow(sleeve.hoursMarket);
}
// 시세 저장 — saveQuoteCM 일반화(market 키만 다름).
async function saveQuoteAlt(DB, market, q, partial) {
  let prev = {};
  try { const e = await getState(DB, "quote:" + q.symbol, null); if (e && typeof e === "object") prev = e; } catch (e) {}
  const merged = {
    market: market,
    price: (typeof q.price === "number" && q.price > 0) ? q.price : (prev.price != null ? prev.price : null),
    prevClose: (typeof q.prevClose === "number" && q.prevClose > 0) ? q.prevClose : (prev.prevClose != null ? prev.prevClose : null),
    dayPct: (typeof q.dayPct === "number") ? q.dayPct : (prev.dayPct != null ? prev.dayPct : null),
    rsi:          partial ? (prev.rsi ?? null)          : (q.dailyRsi ?? prev.rsi ?? null),
    ma:           partial ? (prev.ma ?? null)           : (q.dailyMa ?? prev.ma ?? null),
    atr:          partial ? (prev.atr ?? null)          : (q.dailyAtr ?? prev.atr ?? null),
    dailyAtr:     partial ? (prev.dailyAtr ?? null)     : (q.dailyAtr ?? prev.dailyAtr ?? null),
    dailyMa:      partial ? (prev.dailyMa ?? null)      : (q.dailyMa ?? prev.dailyMa ?? null),
    dailyMaShort: partial ? (prev.dailyMaShort ?? null) : (q.dailyMaShort ?? prev.dailyMaShort ?? null),
    bbLower:      partial ? (prev.bbLower ?? null)      : (q.bbLower ?? prev.bbLower ?? null),
    bbUpper:      partial ? (prev.bbUpper ?? null)      : (q.bbUpper ?? prev.bbUpper ?? null),
    return20:     partial ? (prev.return20 ?? null)     : (q.return20 ?? prev.return20 ?? null),
    ts: Date.now()
  };
  await setState(DB, "quote:" + q.symbol, merged);
}
// 매수 — executeBuyCM 일반화(통화/수수료 슬리브별).
async function executeBuyAlt(DB, sleeve, symbol, qty, price, signal, dailyAtr, cfg, cash) {
  const mk = sleeve.key;
  if (!(typeof price === "number" && isFinite(price) && price > 0)) { await log(DB, "WARN", symbol, "[" + sleeve.label + "] BUY bad price"); return cash; }
  if (!(typeof qty === "number" && isFinite(qty) && qty > 0)) return cash;
  qty = Math.floor(qty); if (qty <= 0) return cash;
  const feeRate = sleeve.isKRW ? (cfg.feeKR || 0) : (cfg.feeUS || 0.0001);
  const unitCost = price * (1 + feeRate);
  let availCash;
  try { availCash = await computeCashFromTrades(DB, mk, cfg); }
  catch (e) { await log(DB, "ERROR", symbol, "[" + sleeve.label + "] BUY 현금계산 실패 " + e.message); return cash; }
  if (!(typeof availCash === "number" && isFinite(availCash)) || availCash <= 0) return cash;
  const maxQty = Math.floor(availCash / unitCost);
  if (maxQty <= 0) return cash;
  if (qty > maxQty) qty = maxQty;
  const gross = price * qty, fee = gross * feeRate, total = gross + fee;
  const rules = cfg.swingRules || {};
  const stopPct = rules.stopLossPct || cfg.stopLoss || 5.0;
  const atrMult = rules.atrStopMult || cfg.atrStopMult || 2.0;
  const pctStop = price * (1 - stopPct / 100);
  let stopPrice = pctStop;
  if (dailyAtr) { const atrStop = price - dailyAtr * atrMult; stopPrice = Math.min(atrStop, pctStop); }
  if (stopPrice > pctStop) stopPrice = pctStop;
  try {
    const posToSave = { qty: qty, avg: price, opened_ts: Date.now(), meta: { strategy: "swing", feePaid: fee, feeRemaining: fee, atrAtEntry: dailyAtr, stopPrice: stopPrice, peakPrice: price, signal: signal.name, signalMembers: signal.members || [signal.name], tp1Done: false, originalQty: qty } };
    const stmtTrade = stmtRecordTrade(DB, { ts: Date.now(), market: mk, symbol: symbol, side: "BUY", qty: qty, price: price, pnl: null, pnl_pct: null, reason: "[" + sleeve.label + "-SWING] " + signal.name + " " + signal.detail });
    const stmtPos = stmtSavePosition(DB, mk, symbol, "swing", posToSave);
    await DB.batch([stmtTrade, stmtPos]);
  } catch (e) { await log(DB, "ERROR", symbol, "[" + sleeve.label + "] BUY 롤백: " + e.message); return cash; }
  if (cash && typeof cash === "object") cash[mk] = availCash - total;
  await log(DB, "TRADE", symbol, "[" + sleeve.label + "] BUY x" + qty + " @" + price.toFixed(2) + " " + signal.name + " " + signal.detail + " stop=" + stopPrice.toFixed(2));
  return cash;
}
// 매도 — executeSellCM 일반화(KR 슬리브는 거래세 차감).
async function executeSellAlt(DB, sleeve, symbol, pos, sellQty, price, reason, cfg, cash) {
  const mk = sleeve.key;
  const feeRate = sleeve.isKRW ? (cfg.feeKR || 0) : (cfg.feeUS || 0.0001);
  const sellTax = sleeve.isKRW ? (cfg.krSellTax || 0) : 0;
  const gross = price * sellQty, fee = gross * feeRate;
  const proceeds = gross - fee - gross * sellTax;
  pos.meta = pos.meta || {};
  const feeRemaining = (typeof pos.meta.feeRemaining === "number") ? pos.meta.feeRemaining : (pos.meta.feePaid || 0);
  const entryFeeForThisSell = feeRemaining * (sellQty / pos.qty);
  const costBasis = pos.avg * sellQty + entryFeeForThisSell;
  const pnl = proceeds - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
  const heldMin = pos.opened_ts ? Math.floor((Date.now() - pos.opened_ts) / 60000) : 0;
  const enrichedReason = "[" + sleeve.label + "-SWING] " + reason + " #entry=" + (pos.meta.signalMembers || []).join(",");
  try {
    const stmtTrade = stmtRecordTrade(DB, { ts: Date.now(), market: mk, symbol: symbol, side: "SELL", qty: sellQty, price: price, pnl: pnl, pnl_pct: pnlPct, reason: enrichedReason });
    let stmtPos;
    if (sellQty < pos.qty) { pos.qty = pos.qty - sellQty; pos.meta.tp1Done = true; pos.meta.feeRemaining = Math.max(0, feeRemaining - entryFeeForThisSell); stmtPos = stmtSavePosition(DB, mk, symbol, "swing", pos); }
    else { stmtPos = stmtDeletePosition(DB, symbol, "swing", mk); }
    await DB.batch([stmtTrade, stmtPos]);
  } catch (e) { await log(DB, "ERROR", symbol, "[" + sleeve.label + "] SELL 롤백: " + e.message); return { pnlPct: 0, cash: cash }; }
  if (cash && typeof cash[mk] === "number") cash[mk] += proceeds;
  await log(DB, "TRADE", symbol, "[" + sleeve.label + "] SELL x" + sellQty + " @" + price.toFixed(2) + " PnL " + pnlPct.toFixed(2) + "% (held " + heldMin + "min, " + reason + ")");
  return { pnlPct: pnlPct, cash: cash };
}
// 실시간 슬리브 사이클 — 시세 fetch+저장+swing 매매. 거래시간 아니면 스킵.
async function runAltSleeveCycle(env, key) {
  const DB = env.DB;
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
  const sleeve = _altSleeve(key, cfg);
  if (!sleeve) return;
  if (cfg.altRealtime === false) return;
  if (!_altTradeWindow(sleeve)) return;            // 해당 시장 장중에만
  resetFetchBudget(120);
  let cash = await computeAllCash(DB, cfg);
  if (typeof cash[key] !== "number") cash[key] = (key === "bdkr") ? cfg.initialCashBDKR : (key === "bdus" ? cfg.initialCashBDUS : cfg.initialCashCM);
  const positions = await getPositions(DB, key);
  const swingRules = cfg.swingRules || {};
  let tried = 0, bought = 0, sold = 0, fetchFail = 0;
  const BATCH = 6;
  const fetched = [];
  for (let i = 0; i < sleeve.syms.length; i += BATCH) {
    if (fetchBudgetLeft() <= 0) break;
    const slice = sleeve.syms.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async function(symbol){
      try { return { symbol: symbol, daily: await fetchDailyWithFallback(symbol) }; }
      catch (e) { return { symbol: symbol, daily: null, err: e.message }; }
    }));
    for (const r of results) fetched.push(r);
  }
  for (const item of fetched) {
    const symbol = item.symbol; tried++;
    try {
      const dd = item.daily && item.daily.data ? item.daily.data : item.daily;
      if (!dd || !dd.closes) { fetchFail++; continue; }
      const closes = dd.closes, highs = dd.highs || null, lows = dd.lows || null;
      const price = dd.price, prevClose = dd.prevClose || price;
      const dayPct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
      const dailyRsi = closes.length >= cfg.rsiPeriod + 1 ? getRSI(closes, cfg.rsiPeriod) : null;
      const dailyMa = closes.length >= cfg.maPeriod ? getMA(closes, cfg.maPeriod) : null;
      const dailyMaShort = closes.length >= cfg.maShortPeriod ? getMA(closes, cfg.maShortPeriod) : null;
      const dailyAtr = closes.length >= cfg.atrPeriod + 1 ? getATR(closes, cfg.atrPeriod, highs, lows) : null;
      const bb = getBollingerBands(closes, cfg.maPeriod, cfg.bbStdMult);
      const return20 = getNDayReturn(closes, 20);
      await saveQuoteAlt(DB, key, { symbol: symbol, price: price, prevClose: prevClose, dayPct: dayPct, dailyRsi: dailyRsi, dailyMa: dailyMa, dailyMaShort: dailyMaShort, dailyAtr: dailyAtr, bbLower: bb ? bb.lower : null, bbUpper: bb ? bb.upper : null, return20: return20 });
      if (dailyRsi == null) continue;
      const posKey = symbol + "::swing";
      const held = positions[posKey];
      if (held) {
        if (held.meta && held.meta.peakPrice != null && price > held.meta.peakPrice) { held.meta.peakPrice = price; try { await savePosition(DB, key, symbol, "swing", held); } catch (e) {} }
        else if (held.meta && held.meta.peakPrice == null) { held.meta.peakPrice = Math.max(held.avg, price); try { await savePosition(DB, key, symbol, "swing", held); } catch (e) {} }
        const sellDecision = evaluateSell(held, price, dd, dailyRsi, dailyMa, dailyMaShort, cfg, true, key);
        if (sellDecision.sell) {
          await executeSellAlt(DB, sleeve, symbol, held, sellDecision.sellQty, price, sellDecision.reason, cfg, cash);
          sold++;
          if (sellDecision.sellQty >= held.qty) delete positions[posKey];
        }
      }
      if (positions[posKey]) continue;
      const signals = evaluateBuySignals_swing(price, dayPct, dd, cfg);
      if (!signals || signals.length === 0) continue;
      let best = signals[0];
      for (const s of signals) if ((s.weight || 0) > (best.weight || 0)) best = s;
      let actualAtrPct = (dailyAtr != null && price > 0) ? (dailyAtr / price) * 100 : null;
      const baseStopPct = swingRules.stopLossPct || cfg.stopLoss || 5.0;
      let stopDistPct = baseStopPct;
      if (actualAtrPct != null && actualAtrPct > 0) { const atrStopPct = actualAtrPct * (swingRules.atrStopMult || cfg.atrStopMult || 2.0); stopDistPct = Math.max(baseStopPct, Math.min(atrStopPct, baseStopPct * 1.6)); }
      const rbs = cfg.riskBasedSizing || {};
      let riskPct = (rbs.riskPerTrade != null ? rbs.riskPerTrade : 0.6) * (best.weight || 1.0);
      riskPct = Math.max(rbs.minRisk != null ? rbs.minRisk : 0.3, Math.min(rbs.maxRisk != null ? rbs.maxRisk : 1.2, riskPct));
      const cashCap = cash[key] * 0.85;
      const maxBudget = cash[key] * 0.25;
      const rawBudget = cash[key] * (riskPct / 100) / (stopDistPct / 100);
      let budget = Math.min(rawBudget, maxBudget, cashCap);
      const feeRate = sleeve.isKRW ? (cfg.feeKR || 0) : (cfg.feeUS || 0.0001);
      let qty = Math.floor(budget / (price * (1 + feeRate)));
      if (qty === 0) { const onePrice = price * (1 + feeRate); if (onePrice <= cash[key] * 0.10) qty = 1; }
      const totalCost = qty * price * (1 + feeRate);
      if (qty > 0 && totalCost <= cash[key]) {
        await executeBuyAlt(DB, sleeve, symbol, qty, price, best, dailyAtr, cfg, cash);
        bought++;
        positions[posKey] = { symbol: symbol, strategy: "swing", qty: qty, avg: price, opened_ts: Date.now(), meta: {} };
      }
    } catch (e) { await log(DB, "ERROR", symbol, "[" + sleeve.label + "] " + e.message); }
  }
  if (bought || sold) await log(DB, "INFO", null, "[" + sleeve.label + "] RT cycle: tried=" + tried + " buy=" + bought + " sell=" + sold + (fetchFail ? " fail=" + fetchFail : ""));
}

async function runTradingCycle(env) {
  const DB = env.DB;
  resetFetchBudget(850);  // [PAID] Paid 1000 한도의 85% — 가격+일봉+분봉+LLM+여유
  await ensureSchema(DB);
  let cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));

  // [V8.1.3] 저장된 cfg에 박힌 잘못된 값 강제 리셋
  if (cfg.requireConfluence) cfg.requireConfluence = false;
  // [재작성] 단일 trend 전략 강제 (migrate도 하지만 사이클에서도 명시)
  cfg.strategies = Object.assign({ trend: true }, cfg.strategies || {}, { trend: true });
  cfg.strategies.scalp = true;  // [V50] 단타 활성 보장
  await applySectorGroupWeights(DB, cfg);
  await applySignalTypeWeights(DB, cfg);

  // [FIX V8.8] 기존엔 cfg.enabled=false면 여기서 통째로 return → 정규장 중에도
  //   UI 가격이 전혀 갱신되지 않았음(엔진 끄면 차트/가격 멈춤). 가격 갱신은 거래와
  //   분리되어야 하므로 early return을 제거하고, 거래 단계에서만 enabled를 체크한다.
  const engineEnabled = !!cfg.enabled;
  if (!engineEnabled) { await log(DB, "INFO", null, "engine disabled — 가격만 갱신, 거래 스킵"); }

  // [신규] Cycle Lock — 동시 실행 차단. [V31] pid로 소유권 추적, TTL 90s로 여유 확보
  const myLockPid = await acquireCycleLock(DB, cfg.cycleLockTTL || 90000);
  if (!myLockPid) {
    await log(DB, "INFO", null, "cycle skipped: lock held");
    return;
  }

  try {
    const enabledStrats = STRATEGIES.filter(function(s){ return cfg.strategies && cfg.strategies[s]; }).join(",");
    const disabledSigNote = (cfg.disabledSignals && cfg.disabledSignals.length > 0)
      ? " disabled=[" + cfg.disabledSignals.join(",") + "]" : "";
    await log(DB, "INFO", null, "=== Cycle start (V9.0) strats=[" + enabledStrats + "] conf=" + (cfg.requireConfluence ? "ON" : "OFF") + disabledSigNote + " ===");
    const cycleStartedAt = Date.now();
    // [FIX V8.8] 엔진 heartbeat — 사이클 시작 직후 기록. 사이클이 중간에 타임아웃/중단돼도
    //   "엔진이 최근 돌긴 했다"를 추적해 last_tick만으로 '지연'을 오판하지 않도록 한다.
    try { await setState(DB, "last_heartbeat", Date.now()); } catch (e) {}

    // [V19] LLM 일일 분석은 거래 사이클에서 분리됨 — scheduled()에서 거래 전에 단독 실행.
    //   기존엔 여기(사이클 내부)서 await 호출했는데, 293종목 평가로 사이클이 115초까지 늘어진
    //   같은 invocation 안에서 LLM 외부 API fetch(20s)가 시간/예산 경쟁에 밀려 타임아웃났다.
    //   → runLLMDailyAnalysis를 scheduled에서 깨끗한 예산으로 먼저 돌린다(아래 export default 참고).

    // [V9 매크로] 경제지표 자동 갱신 — 매일 07:00 KST 1회 (web_search)
    //   try-catch 격리: 실패해도 매매 사이클은 정상 진행.
    if (isMacroTriggerTime()) {
      try { await runMacroUpdate(env); }
      catch (e) { await log(DB, "ERROR", null, "[MACRO] trigger fail: " + e.message); }
    }

    // [V8.6] 거래 윈도우 기준 — KR은 야후 15분 지연 보정해서 09:15~15:45
    let usCanTrade = isTradingWindow("us");
    let krCanTrade = isTradingWindow("kr");

    // [V22] 휴장일 자동 판정(A) — 시간상 열려있어도 지수 신선도로 오늘 개장 여부 확인.
    if (usCanTrade) {
      const usTradeDay = await isMarketTradingDay(DB, "us", env);
      if (usTradeDay === false) { usCanTrade = false; await log(DB, "CLOSED", null, "[V22] US 휴장일 감지 — 거래 스킵(가격은 갱신)"); }
    }
    if (krCanTrade) {
      const krTradeDay = await isMarketTradingDay(DB, "kr", env);
      if (krTradeDay === false) { krCanTrade = false; await log(DB, "CLOSED", null, "[V22] KR 휴장일 감지 — 거래 스킵(가격은 갱신)"); }
    }

    // [V23] 가격 갱신은 거래와 분리 — 정규장 시간이면 휴장/거래윈도우와 무관하게 가격을 갱신한다.
    //   (기존엔 거래윈도우 닫히면 사이클 전체 return → 가격이 안 갱신되던 버그)
    // [V9.0] isMarketOpen → isQuoteRefreshWindow: KR은 야후 15분 지연이라 가격 갱신
    //   종료를 15:45까지 늘려, 마지막 15분 실거래의 지연 종가가 quote에 반영되게 한다.
    const usMarketHours = isQuoteRefreshWindow("us");
    const krMarketHours = isQuoteRefreshWindow("kr");

    // 거래도 가격갱신도 둘 다 할 게 없으면 스킵
    if (!usCanTrade && !krCanTrade && !usMarketHours && !krMarketHours) {
      await log(DB, "CLOSED", null, "US & KR 장외 — 사이클 스킵");
      return;
    }

    // 가격/일봉 갱신 대상: 정규장 시간인 시장 (거래 불가여도 가격은 갱신)
    const usOpen = usMarketHours;
    const krOpen = krMarketHours;

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
      // [VIX 변동성 레짐] 글로벌 공포지수 — 미국장 시간 + 5분마다만 갱신(천천히 변함 → fetch 절약).
      //   읽기(crashGate)는 매 사이클 저장값 사용. 저장이 10분 이상 오래됐으면 분 무관 갱신(신선도 보장).
      {
        const _nowMin = new Date().getUTCMinutes();
        const _vixPrev = await getState(DB, "vix", null);
        const _vixStale = !_vixPrev || !_vixPrev.ts || (Date.now() - _vixPrev.ts) > 10 * 60 * 1000;
        if (_nowMin % 5 === 0 || _vixStale) {
          indexJobs.push(
            fetchIndexDaily("^VIX")
              .then(function(d){
                if (d && d.closes && d.closes.length) {
                  return setState(DB, "vix", { value: d.closes[d.closes.length - 1], ts: Date.now() });
                }
              })
              .catch(function(e){ return log(DB, "WARN", "^VIX", "vix fetch fail: " + e.message); })
          );
        }
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
    const visionPreds = await getState(DB, "vision_predictions", {});  // [Vision AI]
    const secData = await getState(DB, "sec_filings", {});  // [SEC 공시] 미국 종목 보수화
    const eventData = await buildEventRiskData(DB);  // [V62] 어닝스·경제지표·내부자 이벤트 리스크 (캐시 read만)
    let cash = await computeAllCash(DB, cfg);
    // [V9.1] executeBuy/Sell이 거래마다 cash 전체를 저장하므로, cm 키가 누락된 옛 상태를
    //   읽었을 때 원자재 현금이 사라지지 않도록 보강.
    if (typeof cash.cm !== "number") cash.cm = cfg.initialCashCM;

    // [V28] 강력 예산 가드 — 사이클 시작 시 시장별 가용현금을 스냅샷으로 고정.
    //   한 사이클에서 누적 매수액이 이 스냅샷을 넘으면 이후 매수 전면 차단.
    //   savePosition 충돌 등으로 executeBuy의 cash 추적이 깨져도 예산 초과 불가능.
    // [V51] 전략별 예산 분리 — 가용현금을 split 비율로 쪼개 trend/scalp 독립 예산 운용.
    //   (기존엔 공용 풀이라 먼저 도는 trend가 다 써버려 scalp가 굶었다.)
    // [V51] 전략별 예산 분리 — 가용현금을 split 비율로 쪼개 trend/scalp 독립 예산 운용.
    //   (기존엔 공용 풀이라 먼저 도는 trend가 다 써버려 scalp가 굶었다.)
    // [V52] 3분할 — trend/scalp/snap. 합으로 정규화하므로 슬라이더 임의 비율 허용.
    const _split = (cfg.strategyBudgetSplit && typeof cfg.strategyBudgetSplit === "object") ? cfg.strategyBudgetSplit : { trend: 0.35, scalp: 0.30, snap: 0.35 };
    const _trW = (typeof _split.trend === "number" && _split.trend >= 0) ? _split.trend : 0.35;
    const _scW = (typeof _split.scalp === "number" && _split.scalp >= 0) ? _split.scalp : 0.30;
    const _snW = (typeof _split.snap === "number" && _split.snap >= 0) ? _split.snap : 0.35;
    const _sum = (_trW + _scW + _snW) > 0 ? (_trW + _scW + _snW) : 1;
    const _trFrac = _trW / _sum, _scFrac = _scW / _sum, _snFrac = _snW / _sum;
    const cycleBudget = {
      us: { trend: cash.us * _trFrac, scalp: cash.us * _scFrac, snap: cash.us * _snFrac },
      kr: { trend: cash.kr * _trFrac, scalp: cash.kr * _scFrac, snap: cash.kr * _snFrac },
      cm: cash.cm
    };
    const cycleSpent = {
      us: { trend: 0, scalp: 0, snap: 0 },
      kr: { trend: 0, scalp: 0, snap: 0 },
      cm: 0
    };
    // 전략→예산버킷 매핑 (scalp/snap은 전용 버킷, 그 외 전부 trend버킷)
    const _bkt = function (strat) { return (strat === "scalp" || strat === "snap") ? strat : "trend"; };

    let tried = 0, bought = 0, sold = 0, skipped = 0, fetchFail = 0;
    let signalCount = 0;   // [통계] 이번 사이클 발생 매수신호 수
    let minuteFetchUsed = 0;  // [분봉] 이번 invocation 분봉 조회 횟수 (subrequest 캡 통제)

    // [V8.1.1] 장 열린 시장만 처리 — 마감된 시장은 시세도 fetch 안 함
    // [V23] 가격 갱신 대상 = 정규장 시간 시장 / 거래 대상 = 거래가능(윈도우+휴장통과) 시장
    const marketsForQuotes = [];
    if (usOpen) marketsForQuotes.push("us");
    if (krOpen) marketsForQuotes.push("kr");
    const marketsToTrade = [];
    // [FIX V8.8] 엔진이 꺼져 있으면 거래 대상에서 제외(가격 갱신은 marketsForQuotes로 계속).
    if (engineEnabled && usCanTrade) marketsToTrade.push("us");
    if (engineEnabled && krCanTrade) marketsToTrade.push("kr");

    // [신규·인터마켓] 시장 컨텍스트(risk-on/off) 1회 갱신 — 거래할 시장이 있을 때만(불필요 fetch 방지).
    //   예산 가드 내장(캐시·enrich 임계·subreq 예비). 결과 sizeScale을 신규매수 사이징에 반영.
    let mktCtx = null;
    if (marketsToTrade.length > 0) {
      try { mktCtx = await updateMarketContext(DB, cfg); } catch (e) {}
    }
    // [섹터 뉴스] Yahoo Finance RSS 무료 감성 분석 — 6그룹 × 1 subreq, 6h 캐시. LLM 불필요.
    let sectorSentiment = null;
    if (marketsToTrade.length > 0) {
      try { sectorSentiment = await updateSectorNewsSentiment(DB, cfg); } catch (e) {}
    }

    for (const market of marketsForQuotes) {
      const mcfg = getMarketCfg(cfg, market);  // [V8.2] 시장별 독립 룰
      const tickers = market === "us" ? mcfg.usTickers : mcfg.krTickers;
      const positions = await getPositions(DB, market);  // key: "SYM::strategy"
      const feeRate = market === "us" ? mcfg.feeUS : mcfg.feeKR;
      const regime = regimes[market];
      let canTrade = marketsToTrade.indexOf(market) !== -1;
      // [V31] 매매 직전 락 소유권 재확인 — US 처리가 길어져 락이 만료·탈취됐으면
      //   이 시장은 거래하지 않는다(다른 워커가 이미 처리 중일 수 있음 → 이중체결 방지).
      if (canTrade) {
        const stillOwns = await ownsCycleLock(DB, myLockPid);
        if (!stillOwns) {
          canTrade = false;
          await log(DB, "WARN", null, "[V31] " + market.toUpperCase() + " 매매 스킵: 락 소유권 상실(이중체결 방지)");
        }
      }

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

      // [V62 전략 다변화] 포지션이 한 전략(주로 trend)에 쏠리면 그 전략 신규진입 축소 + 소수 전략 소폭 부스트.
      //   포트폴리오 단위 분산 — 신호 차단 없이 사이즈로만 유도.
      let stratShare = { trend: 0, scalp: 0, snap: 0, total: 0 };
      for (const key in positions) {
        const st = positions[key].strategy || (key.split("::")[1] || "trend");
        if (stratShare[st] != null) stratShare[st]++;
        stratShare.total++;
      }
      const trendHeavy = stratShare.total >= 4 && (stratShare.trend / stratShare.total) >= 0.75;
      if (trendHeavy) await log(DB, "INFO", null, "[V62] " + market.toUpperCase() + " trend 편중 " + stratShare.trend + "/" + stratShare.total + " → trend×0.8, snap/scalp×1.1");

      // [V8.1.6] 총자산 = 현금 + 보유 포지션 평가액 (최근 quote 기준)
      // 이전엔 cash[market]만 사용해서 매수할수록 사이즈 작아짐
      let portfolioValue = cash[market];
      let portfolioRiskDollar = 0;  // [포트폴리오 히트] 보유 포지션들의 총 미실현 리스크(현재가-손절가)
      for (const key in positions) {
        const p = positions[key];
        const lastQuote = await getState(DB, "quote:" + p.symbol, null);
        const lastPrice = (lastQuote && lastQuote.price) ? lastQuote.price : p.avg;
        portfolioValue += p.qty * lastPrice;
        // 손절가 위면 (현재가-손절가)×수량 = 손절까지의 리스크. break-even 락이면 0(이익 확정).
        const stop = (p.meta && typeof p.meta.stopPrice === "number") ? p.meta.stopPrice : null;
        if (stop != null && lastPrice > stop) portfolioRiskDollar += (lastPrice - stop) * p.qty;
      }
      const portfolioHeatPct = portfolioValue > 0 ? (portfolioRiskDollar / portfolioValue) * 100 : 0;

      // [V12] === 폭락장 생존 게이트 (시장별 1회 계산) ===
      //   portfolioValue(=equity)로 고점 추적 → 드로다운/연속손실/패닉을 종합.
      //   gate.blockNew(신규매수 차단), gate.sizeScale(사이즈 축소),
      //   gate.deRisk(보유 손절·트레일 타이트닝)로 아래 매도/매수 루프에 작용.
      let crashGate = { blockNew: false, sizeScale: 1, deRisk: false, ddLevel: 0, ddPct: 0, reasons: [] };
      try {
        // equity 고점 갱신엔 방금 구한 portfolioValue를 그대로 사용(중복 fetch 회피).
        const peakInfo = await updateEquityPeak(DB, market, portfolioValue);
        crashGate.ddPct = peakInfo.ddPct;
        const cs = mcfg.crashSurvival;
        if (cs && cs.enabled) {
          const lvl = drawdownLevel(peakInfo.ddPct, cs.drawdown);
          crashGate.ddLevel = lvl;
          if (lvl >= 1 && peakInfo.ddPct > cs.drawdown.recoverPct) {
            if (lvl >= 2) { crashGate.blockNew = true; crashGate.reasons.push("DD_L" + lvl + " " + peakInfo.ddPct.toFixed(1) + "%"); }
            else { crashGate.sizeScale *= cs.drawdown.l1SizeScale; crashGate.reasons.push("DD_L1 " + peakInfo.ddPct.toFixed(1) + "%"); }
            if (lvl >= 3) crashGate.deRisk = true;
          }
          const ls = await checkLossStreak(DB, market, cs.lossStreak);
          if (ls.paused) {
            // [V9.8] 연속손실'만'으로는 신규매수를 전면 차단하지 않는다.
            //   한 사이클에 손절이 몰리면(예: 트레일/하드스톱 동시 발동 20건) 계좌 낙폭이 0%여도
            //   직전 매도 N건이 손실로 채워져 LOSS_STREAK이 켜지고, 90분간 회복장 진입을 통째로 놓쳤다.
            //   → 실제 스트레스(드로다운 L1+ 또는 패닉)가 동반될 때만 전면 차단(BLOCK-NEW),
            //     아니면 사이즈 절반으로 보수화하되 거래는 계속 허용.
            const realStress = (crashGate.ddLevel >= 1) || isPanic(regime, cs.panic);
            if (realStress) {
              crashGate.blockNew = true;
              crashGate.reasons.push("LOSS_STREAK" + (ls.losses != null ? "(" + ls.losses + ")" : ""));
            } else {
              crashGate.sizeScale *= 0.5;
              crashGate.reasons.push("LOSS_STREAK" + (ls.losses != null ? "(" + ls.losses + ")" : "") + "→size×0.5");
            }
          }
          if (isPanic(regime, cs.panic)) {
            const pScale = (cs.panic && cs.panic.panicSizeScale != null) ? cs.panic.panicSizeScale : 0.4;
            crashGate.sizeScale *= pScale;
            crashGate.deRisk = true;
            crashGate.reasons.push("PANIC avg=" + (regime.avgDayPct || 0).toFixed(2) + "% size×" + pScale);
          }
        }
        if (crashGate.reasons.length > 0) {
          await log(DB, "INFO", null, "[V12 CRASH-GATE " + market.toUpperCase() + "] dd=" + crashGate.ddPct.toFixed(1) + "% L" + crashGate.ddLevel + (crashGate.blockNew ? " BLOCK-NEW" : (crashGate.sizeScale < 1 ? " size×" + crashGate.sizeScale : "")) + (crashGate.deRisk ? " DE-RISK" : "") + " · " + crashGate.reasons.join(", "));
        }
      } catch (e) {
        await log(DB, "WARN", null, "[V12] crashGate fail " + market + ": " + e.message);
      }

      // [VIX 변동성 레짐] 글로벌 공포지수로 시장 전체 진입 사이즈 자동 조절 (외부 데이터 활용).
      //   고변동(불안) → 축소(손실 방어), 저변동(안정) → 약한 부스트(기회). crashGate.sizeScale에 통합.
      try {
        const vix = await getState(DB, "vix", null);
        if (vix && typeof vix.value === "number" && vix.value > 0) {
          let vScale = 1.0, vNote = "";
          if (vix.value >= 35)      { vScale = 0.4; vNote = "EXTREME"; }
          else if (vix.value >= 28) { vScale = 0.6; vNote = "HIGH"; }
          else if (vix.value >= 22) { vScale = 0.8; vNote = "ELEVATED"; }
          else if (vix.value < 14)  { vScale = 1.05; vNote = "CALM"; }
          crashGate.vixValue = vix.value;   // [VIX 트레일] 트레일폭 동적 조정에 사용
          if (vScale !== 1.0) {
            crashGate.sizeScale *= vScale;
            crashGate.reasons.push("VIX" + vix.value.toFixed(1) + "(" + vNote + ")×" + vScale);
          }
          // VIX 초고변동(≥40)이면 신규 진입 전면 차단 (시장 패닉 보호)
          if (vix.value >= 40) { crashGate.blockNew = true; crashGate.reasons.push("VIX_PANIC " + vix.value.toFixed(1)); }
        }
      } catch (e) {}

      // [시장 폭(Breadth)] 직전 사이클의 상승종목 비율로 시장 건강도 반영 (추가 fetch 0).
      //   광범위 약세(상승<30%)면 신규 진입 보수화 → 추세전략의 휩쏘 회피.
      try {
        const br = await getState(DB, "breadth:" + market, null);
        if (br && typeof br.upRatio === "number" && br.total >= 30) {
          if (br.upRatio < 0.30)      { crashGate.sizeScale *= 0.7; crashGate.reasons.push("BREADTH_WEAK " + Math.round(br.upRatio * 100) + "%"); }
          else if (br.upRatio < 0.40) { crashGate.sizeScale *= 0.85; crashGate.reasons.push("BREADTH_SOFT " + Math.round(br.upRatio * 100) + "%"); }
        }
      } catch (e) {}

      // [포트폴리오 히트] 보유 포지션들의 총 미실현 리스크(%) 한도 — 계좌 전체 리스크 통제.
      //   개별 종목 리스크(0.75%)는 작아도 12종목이면 합산 9%+ → 시장 급락 시 동시 손실.
      //   총 히트가 한도 초과면 신규 진입 차단, 근접하면 사이즈 축소(분산 강제).
      {
        const maxHeat = (typeof mcfg.maxPortfolioHeat === "number") ? mcfg.maxPortfolioHeat : 8.0;
        if (portfolioHeatPct >= maxHeat) {
          crashGate.blockNew = true;
          crashGate.reasons.push("HEAT_MAX " + portfolioHeatPct.toFixed(1) + "%≥" + maxHeat + "%");
        } else if (portfolioHeatPct >= maxHeat * 0.8) {
          crashGate.sizeScale *= 0.6;
          crashGate.reasons.push("HEAT_HIGH " + portfolioHeatPct.toFixed(1) + "%");
        }
      }

      // [에퀴티 커브 필터] 최근 청산거래 PnL 합계가 음수이면 사이즈 추가 축소.
      //   VIX/Breadth와 독립 — 시장이 아니라 "이 시스템의 최근 성과"로 보호.
      try {
        const _ecf = mcfg.equityCurveFilter || DEFAULT_CFG.equityCurveFilter;
        if (_ecf && _ecf.enabled !== false) {
          const _lb = _ecf.lookback || 15;
          const _ecRows = await DB.prepare(
            "SELECT pnl_pct FROM trades WHERE market = ? AND side = 'SELL' ORDER BY ts DESC LIMIT ?"
          ).bind(market, _lb).all();
          const _ecTrades = (_ecRows && _ecRows.results) ? _ecRows.results : [];
          if (_ecTrades.length >= Math.ceil(_lb / 2)) {   // 최소 절반이상 데이터 있을 때만 적용
            const _ecSum = _ecTrades.reduce(function(s, t) { return s + (t.pnl_pct || 0); }, 0);
            if (_ecSum <= (_ecf.threshold1 || -5.0)) {
              const _s1 = _ecf.scale1 || 0.65;
              crashGate.sizeScale *= _s1;
              crashGate.reasons.push("ECF↓↓ sum=" + _ecSum.toFixed(1) + "%×" + _s1);
            } else if (_ecSum <= (_ecf.threshold2 || -2.5)) {
              const _s2 = _ecf.scale2 || 0.80;
              crashGate.sizeScale *= _s2;
              crashGate.reasons.push("ECF↓ sum=" + _ecSum.toFixed(1) + "%×" + _s2);
            }
          }
        }
      } catch (e) {}

      const deRiskOpts = { active: crashGate.deRisk, vixValue: crashGate.vixValue || 0 };

      // [V52] SCALP 당일 손실 한도 — 세션 시작 이후 scalp 청산 PnL%(합)가 한도 이하면
      //   그날 해당 시장의 scalp 신규진입을 전면 중단(연속 칼날·틸트 방지). 사이클당 1쿼리.
      let scalpDailyBlocked = false;
      try {
        const _slr = mcfg.scalpRules || DEFAULT_CFG.scalpRules || {};
        const _slLimit = (_slr.dailyLossLimitPct != null) ? _slr.dailyLossLimitPct : 1.5;
        if (_slLimit > 0 && canTrade && market !== "cm") {
          const _efS = sessionElapsedFraction(market);
          if (_efS != null) {
            const _sessStart = Date.now() - Math.round(_efS * 390 * 60000);
            const _slRows = await DB.prepare(
              "SELECT pnl_pct FROM trades WHERE market = ? AND side = 'SELL' AND ts >= ? AND reason LIKE '[SCALP]%'"
            ).bind(market, _sessStart).all();
            let _slSum = 0;
            for (const _t of ((_slRows && _slRows.results) || [])) _slSum += (_t.pnl_pct || 0);
            if (_slSum <= -_slLimit) {
              scalpDailyBlocked = true;
              await log(DB, "WARN", null, "[V52] " + market.toUpperCase() + " SCALP 당일 손실한도(" + _slSum.toFixed(2) + "% ≤ -" + _slLimit + "%) — 오늘 단타 신규진입 중단");
            }
          }
        }
      } catch (e) {}

      // [V10] === PREFETCH 단계 (대규모 종목 — 가격 배치 + 일봉 라운드로빈) ===
      //   종목이 수백 개로 늘어 기존 "전 종목 매분 fetchIntraday" 방식은
      //   Cloudflare subrequest 한도(50/invocation)를 초과하므로 아래로 분리:
      //
      //   (1) 가격·등락률  → fetchBatchQuotes 로 전 종목 한 번에 (호출 = ceil(N/50)).
      //                       모든 종목 quote: 상태를 매분 갱신 → UI 실시간 가격.
      //   (2) 일봉 지표     → 30분 캐시 유지하되, 이번 cron 차례 구간만 라운드로빈 갱신.
      //                       30분(=cron 30회)에 걸쳐 전 종목이 한 바퀴 돈다.
      //   (3) 평가 대상     → 보유 종목(항상) + 일봉 캐시가 살아있는 종목.
      //                       일봉이 아직 없는 종목은 가격만 보이고 거래 판단은 대기.
      const prefetchStart = Date.now();

      // --- (1) 전 종목 가격 배치 갱신 ---
      //   v7 이 차단된 환경 대비: v8 폴백은 매 사이클 일부만(라운드로빈) 처리하고
      //   나머지는 이전 quote 를 보존(아래 prevQuoteMap 병합 + ON CONFLICT UPDATE)한다.
      //   [V11] 폴백 개수를 고정값이 아니라 "남은 fetch 예산"에서 가져온다.
      //         가격에 예산의 약 60%를 쓰고, 나머지는 일봉 라운드로빈용으로 남긴다.
      const qpRrKey = "qp_rr:" + market;
      let qpRr = await getState(DB, qpRrKey, 0);
      if (typeof qpRr !== "number" || qpRr < 0) qpRr = 0;
      // [V16] v7 batch(crumb)가 작동하면 전 종목이 batch 호출 몇 번으로 채워진다.
      //   폴백(chart 개별호출)은 v7 누락분에만 쓴다.
      // [V9.0] 일봉 갱신 주기를 줄이면(미국20/한국15분) 매분 도는 일봉 종목이 늘어
      //   일봉 fetch 몫이 커진다. v7이 죽어 가격 폴백이 예산을 다 먹으면 일봉이 굶으므로,
      //   가격 폴백 비율을 85%→70%로 낮춰 일봉 라운드로빈 몫을 항상 30% 이상 남긴다.
      //   (v7 정상 시엔 가격이 batch로 끝나 폴백 자체를 거의 안 쓰므로 영향 없음.)
      const priceBudget = Math.max(1, Math.floor(fetchBudgetLeft() * 0.70));
      let batchQuotes = {};
      try {
        batchQuotes = await fetchBatchQuotes(tickers, {
          maxFallback: priceBudget,
          fallbackOffset: qpRr * priceBudget,
          DB: DB
        });
      } catch (e) {
        await log(DB, "WARN", null, "[V11] batchQuotes fail " + market + ": " + e.message);
      }
      const qpSlices = Math.max(1, Math.ceil(tickers.length / priceBudget));
      await setState(DB, qpRrKey, (qpRr + 1) % qpSlices);
      // quote: 상태 저장 (UI 표시용). 일봉 지표는 기존 quote에서 보존(있으면).
      // [V10] D1 부하 최소화 — 기존 quote를 종목마다 읽지 않고 한 번의 쿼리로 일괄 로드.
      const prevQuoteMap = {};
      try {
        const rows = await DB.prepare("SELECT k, v FROM state WHERE k LIKE 'quote:%'").all();
        for (const r of (rows.results || [])) {
          try { prevQuoteMap[r.k.slice(6)] = JSON.parse(r.v); } catch (e) {}
        }
      } catch (e) { /* 일괄 로드 실패 시 빈 맵으로 진행 — 일봉값은 평가루프가 채움 */ }
      // [V10 HOTFIX] setState를 종목마다 호출하면 수백 쿼리 → cron 타임아웃(503).
      //   D1 batch로 한 번에 커밋한다.
      const quoteStmts = [];
      const nowTs = Date.now();
      let brUp = 0, brTotal = 0;  // [시장 폭] 상승종목 비율 집계 (추가 fetch 0)
      for (const sym of tickers) {
        const bq = batchQuotes[sym];
        if (!bq) continue;
        // 시장 폭 카운트 (당일 등락 기준)
        if (typeof bq.price === "number" && typeof bq.prevClose === "number" && bq.prevClose > 0) {
          brTotal++;
          if (bq.price > bq.prevClose) brUp++;
        }
        const prevQ = prevQuoteMap[sym] || null;
        const merged = {
          market: market, price: bq.price, prevClose: bq.prevClose, dayPct: bq.dayPct,
          rsi: prevQ ? prevQ.rsi : null, ma: prevQ ? prevQ.ma : null, atr: prevQ ? prevQ.atr : null,
          dailyAtr: prevQ ? prevQ.dailyAtr : null, dailyMa: prevQ ? prevQ.dailyMa : null,
          dailyMaShort: prevQ ? prevQ.dailyMaShort : null,
          bbLower: prevQ ? prevQ.bbLower : null, bbUpper: prevQ ? prevQ.bbUpper : null,
          return20: prevQ ? prevQ.return20 : null,
          ts: nowTs
        };
        quoteStmts.push(
          DB.prepare("INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_ts=excluded.updated_ts")
            .bind("quote:" + sym, JSON.stringify(merged), nowTs)
        );
      }
      // D1 batch는 한 번에 너무 많으면 거부될 수 있어 100개씩 나눠 커밋
      for (let i = 0; i < quoteStmts.length; i += 100) {
        try { await DB.batch(quoteStmts.slice(i, i + 100)); } catch (e) {
          await log(DB, "WARN", null, "[V10] quote batch write fail: " + e.message);
        }
      }
      // [시장 폭] 다음 사이클 게이트용으로 저장 (상승종목 비율)
      if (brTotal >= 30) {
        try { await setState(DB, "breadth:" + market, { upRatio: brUp / brTotal, up: brUp, total: brTotal, ts: nowTs }); } catch (e) {}
      }

      // --- (2) 일봉 라운드로빈 갱신 대상 선정 ---
      // [거래확대] 라운드로빈 슬라이스를 "캐시시간"이 아니라 "사이클당 fetch 능력"에 묶는다.
      //   기존엔 sliceCount=cacheMin이라 캐시를 늘리면 라운드로빈이 느려지는 모순이 있었음.
      //   이제 매 사이클 maxDailyPerCycle 종목씩 갱신 → 전 종목 한 바퀴 = ceil(N/maxDaily) 사이클(~42분).
      //   캐시 180분이라 한 번 받은 종목은 여러 바퀴 동안 평가 대상으로 유지 → 커버리지 폭증.
      const cacheMin = mcfg.dailyCacheMinutes || 180;
      const maxDailyPerCycle = (typeof cfg.maxDailyRefreshPerCycle === "number") ? cfg.maxDailyRefreshPerCycle : 20;
      const sliceCount = Math.max(1, Math.ceil(tickers.length / maxDailyPerCycle));
      const rrKey = "rr_idx:" + market;
      let rrIdx = await getState(DB, rrKey, 0);
      if (typeof rrIdx !== "number" || rrIdx < 0) rrIdx = 0;
      const perCycle = maxDailyPerCycle;
      const rrStart = (rrIdx % sliceCount) * perCycle;
      const rrSymbols = tickers.slice(rrStart, rrStart + perCycle);
      await setState(DB, rrKey, (rrIdx + 1) % sliceCount);

      // 보유 종목 추가 (중복 제거)
      const dailyTargets = new Set(rrSymbols);
      for (const key in positions) dailyTargets.add(positions[key].symbol);

      // --- 일봉 갱신 (배치 10개씩, subrequest 예산 내) ---
      //   [V11] 캐시 히트는 fetch 0 — 만료/미존재 종목만 "남은 예산"만큼 실제 fetch 하고,
      //         예산을 넘는 종목은 이번 사이클 캐시값(있으면)으로 평가하고 다음 라운드로빈에 맡긴다.
      //         yahooFetch 의 예산 가드가 최종 방어선이라, 여기서 미리 끊어 ERROR 로그를 막는다.
      const DBATCH = 20;  // [데이터개선] 10→20: 병렬 일봉 fetch 확대
      // 일봉 fetch는 위에서 정한 maxDailyPerCycle(라운드로빈 슬라이스와 동일)로 제한.
      //   캐시 히트는 fetch 0이라, 실제 fetch는 만료/미존재 종목만 발생.
      const dailyTargetArr = Array.from(dailyTargets).slice(0, maxDailyPerCycle);
      const dailyMap = {};   // symbol -> daily data (이번에 갱신/캐시 로드된 것)
      for (let i = 0; i < dailyTargetArr.length; i += DBATCH) {
        const slice = dailyTargetArr.slice(i, i + DBATCH);
        const results = await Promise.all(slice.map(async function(symbol){
          try {
            // 캐시 우선, 만료 시 fallback fetch
            let cached = await getState(DB, "daily:" + symbol, null);
            if (cached && cached.ts && (Date.now() - cached.ts) < cacheMin * 60 * 1000) {
              return { symbol: symbol, daily: cached };
            }
            // 예산 소진 시 실제 fetch 생략 — 있으면 캐시값 사용, 없으면 null
            if (fetchBudgetLeft() <= 0) {
              return { symbol: symbol, daily: cached || null };
            }
            const fb = await fetchDailyWithFallback(symbol);
            if (fb && fb.data) {
              const toCache = {
                closes: fb.data.closes, highs: fb.data.highs, lows: fb.data.lows,
                volumes: fb.data.volumes, prevClose: fb.data.prevClose, ts: Date.now()
              };
              await setState(DB, "daily:" + symbol, toCache);
              return { symbol: symbol, daily: toCache };
            }
            return { symbol: symbol, daily: cached || null };
          } catch (e) {
            return { symbol: symbol, daily: null };
          }
        }));
        for (const r of results) dailyMap[r.symbol] = r.daily;
        // 배치 종료 후 예산이 바닥나면 남은 일봉 타깃은 캐시 조회로만 처리
        if (fetchBudgetLeft() <= 0) {
          for (let k = i + DBATCH; k < dailyTargetArr.length; k++) {
            const sym2 = dailyTargetArr[k];
            if (dailyMap[sym2] === undefined) {
              dailyMap[sym2] = await getState(DB, "daily:" + sym2, null);
            }
          }
          break;
        }
      }

      // --- (3) 평가 대상 fetched 구성 ---
      // 일봉 캐시가 살아있는 종목만 평가(거래). 가격은 batchQuotes에서, 일봉은 캐시/dailyMap에서.
      // [V9.7 최적화] dailyMap 에 없는 종목의 일봉을 종목별로 순차 await getState 하던 것을
      //   먼저 한 번에 묶어(Promise.all) 병렬 조회한 뒤 루프에서는 동기 접근만 한다.
      const fetched = [];
      let priceAnomalyCount = 0;
      const missingDaily = [];
      for (const symbol of tickers) {
        const bq = batchQuotes[symbol];
        if (!bq) continue;
        if (!(typeof bq.price === "number" && isFinite(bq.price) && bq.price > 0)) continue;
        if (dailyMap[symbol] === undefined) missingDaily.push(symbol);
      }
      // [거래확대 최적화] 평가 대상 일봉을 단일 쿼리로 일괄 로드 (개별 getState 수백회 → 1회).
      //   평가 커버리지가 25→수백으로 늘어도 사이클이 느려지지 않게(락 스킵 방지).
      if (missingDaily.length > 0) {
        try {
          const drows = await DB.prepare("SELECT k, v FROM state WHERE k LIKE 'daily:%'").all();
          const allDaily = {};
          for (const r of (drows.results || [])) {
            try { allDaily[r.k.slice(6)] = JSON.parse(r.v); } catch (e) {}
          }
          for (const sym of missingDaily) {
            if (dailyMap[sym] === undefined) dailyMap[sym] = allDaily[sym] || null;
          }
        } catch (e) {
          // 폴백: 개별 배치 조회
          const MBATCH = 20;
          for (let i = 0; i < missingDaily.length; i += MBATCH) {
            const slice = missingDaily.slice(i, i + MBATCH);
            const rows = await Promise.all(slice.map(function(sym){
              return getState(DB, "daily:" + sym, null).then(function(d){ return { sym: sym, d: d }; });
            }));
            for (const r of rows) dailyMap[r.sym] = r.d;
          }
        }
      }
      for (const symbol of tickers) {
        const bq = batchQuotes[symbol];
        if (!bq) continue;
        // [V9.1] 가격 정합성 — 0/음수/NaN/무한대는 거래 대상에서 제외(가격 표시는 별도).
        if (!(typeof bq.price === "number" && isFinite(bq.price) && bq.price > 0)) continue;
        // 일봉: dailyMap 에서 동기 조회 (위에서 결측분까지 모두 채워둠).
        const daily = dailyMap[symbol];
        // 일봉이 아직 없으면 평가 스킵(가격은 이미 UI에 저장됨)
        if (!daily || !daily.closes || daily.closes.length < 25) continue;
        // [V9.1] 비정상 폭등/폭락값 방어 — 전일 종가 대비 ±60% 초과면 데이터 오류(분할
        //   미반영/틱 오류)로 보고 거래 평가에서 제외. 가격 자체는 이미 UI에 저장됨.
        const refClose = (typeof daily.closes[daily.closes.length - 1] === "number" && daily.closes[daily.closes.length - 1] > 0)
          ? daily.closes[daily.closes.length - 1] : (bq.prevClose || bq.price);
        if (refClose > 0) {
          const devPct = Math.abs((bq.price - refClose) / refClose) * 100;
          if (devPct > 60) { priceAnomalyCount++; continue; }
        }
        fetched.push({
          symbol: symbol,
          intra: { symbol: symbol, price: bq.price, prevClose: bq.prevClose, closes: [] },
          daily: daily, intraOk: true, intraErr: null, dailyErr: null
        });
      }
      if (priceAnomalyCount > 0) {
        await log(DB, "INFO", null, "[V9.1] price anomaly skipped[" + market + "]=" + priceAnomalyCount);
      }
      const prefetchMs = Date.now() - prefetchStart;
      await log(DB, "INFO", null, "prefetch[" + market + "] universe=" + tickers.length +
        " priced=" + Object.keys(batchQuotes).length + " dailyRefresh=" + dailyTargetArr.length +
        " evaluable=" + fetched.length + " in " + prefetchMs + "ms");

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
      // [재진입 쿨다운] 손절 손실 후 재진입이 차단된 종목 목록 일괄 로드
      const activeCooldowns = new Set();
      try {
        const cdRows = await DB.prepare("SELECT k, v FROM state WHERE k LIKE 'cooldown:%'").all();
        const _now = Date.now();
        for (const r of (cdRows.results || [])) {
          try {
            const v = JSON.parse(r.v);
            if (v.until && _now < v.until) activeCooldowns.add(r.k.slice(9));
          } catch (e) {}
        }
      } catch (e) {}
      if (llmInstr) {
        await log(DB, "INFO", null,
          "[LLM] " + market + " active: sentiment=" + llmInstr.sentiment +
          " sizing×" + llmInstr.position_sizing.scale +
          (llmInstr.avoid_symbols.length > 0 ? " avoid=" + llmInstr.avoid_symbols.join(",") : "") +
          (llmInstr.disable_signals.length > 0 ? " disableSig=" + llmInstr.disable_signals.join(",") : "")
        );
      }

      // === 평가 단계 — [TIME-CAP] 시간가드+라운드로빈으로 사이클 완주 보장 ===
      //   518종목 직렬평가가 Cloudflare invocation 시간을 넘으면 사이클이 Done을 못 찍고
      //   죽어 락이 유지된다(다음 사이클 "lock held" skip 반복 → 거래 마비). 한도 초과 시
      //   안전 종료하고, 다음 사이클이 멈춘 지점부터 이어서 평가한다(eval_offset 라운드로빈).
      // [긴급수정] 평가 가드를 "평가 시작" 기준으로 — prefetch가 느려도 평가에 시간을 보장한다.
      //   (이전 cycleStartedAt 기준은 prefetch 18초가 18초 가드를 다 써 평가 0종목 → 거래 마비)
      //   동시에 전체 사이클 상한(hardCap)으로 Cloudflare invocation 초과(마비) 방지.
      const evalStartedAt = Date.now();
      const evalBudgetMs = (typeof cfg.evalBudgetMs === "number") ? cfg.evalBudgetMs : 16000;   // [실시간] heavy 평가 cap 축소 → fastWatch 시간 확보(라운드로빈으로 커버리지 유지)
      const hardCapMs = (typeof cfg.cycleHardCapMs === "number") ? cfg.cycleHardCapMs : 22000;  // [실시간] heavy 사이클 상한 22s → 분(分) 내 fastWatch 서브틱 여유
      let evalOffset = await getState(DB, "eval_offset:" + market, 0);
      if (!(typeof evalOffset === "number" && evalOffset >= 0 && evalOffset < fetched.length)) evalOffset = 0;
      const orderedEval = evalOffset > 0 ? fetched.slice(evalOffset).concat(fetched.slice(0, evalOffset)) : fetched;
      let evalProcessed = 0, evalTimedOut = false;
      // [성능] 평가 중 quote 지표 갱신을 종목당 D1 write(saveQuote) 대신 batch로 모아
      //   루프 끝에 일괄 커밋 → 종목당 ~419ms였던 평가 속도를 ms 단위로 단축(커버리지 확대 가능).
      const evalQuoteStmts = [];
      // [V65 FIX] 평가 최소시간 보장 — prefetch·인리치먼트가 hardCap(22s)을 다 먹으면
      //   평가가 0종목으로 즉시 중단되어 "매수신호 0" 마비가 됐다(라이브 로그: 평가 0/307 반복).
      //   hardCap을 넘겼어도 최소 8초는 평가를 진행한다(cron invocation은 30s+ 여유 있음).
      const evalMinMs = 8000;
      for (const item of orderedEval) {
        const _evalElapsed = Date.now() - evalStartedAt;
        if (_evalElapsed > evalBudgetMs || (Date.now() - cycleStartedAt > hardCapMs && _evalElapsed > evalMinMs)) {
          evalTimedOut = true;
          try { await setState(DB, "eval_offset:" + market, (evalOffset + evalProcessed) % fetched.length); } catch (e) {}
          await log(DB, "WARN", null, "[TIME-CAP] " + market.toUpperCase() + " 평가 " + evalProcessed + "/" + fetched.length + "종목 후 중단 — 다음 사이클이 이어서 평가");
          break;
        }
        evalProcessed++;
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

          // [성능] saveQuote(개별 D1 write) → batch 수집 (루프 끝에 일괄 커밋)
          const _qts = Date.now();
          evalQuoteStmts.push(
            DB.prepare("INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_ts=excluded.updated_ts")
              .bind("quote:" + symbol, JSON.stringify({
                market: market, price: price, prevClose: prevClose, dayPct: dayPct,
                rsi: dailyRsi, ma: dailyMa, atr: dailyAtr,
                dailyAtr: dailyAtr, dailyMa: dailyMa, dailyMaShort: dailyMaShort,
                bbLower: bb ? bb.lower : null, bbUpper: bb ? bb.upper : null,
                return20: return20, ts: _qts
              }), _qts)
          );

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
            // [V9.7 최적화] 기존엔 stop·peak·break-even 변경 시마다 각각 await savePosition()을
            //   호출해 보유종목 1개당 최대 3회 D1 write 가 발생했다. meta 는 같은 객체를 in-place
            //   수정하므로 모든 변경을 모은 뒤 dirty 일 때 단 1회만 저장한다 (사이클 지연·D1 부하 감소).
            let posDirty = false;
            // [V8.5 BUG FIX] breakEvenLocked이면 safeStop으로 끌어내리지 않음 —
            // 기존 코드는 break-even으로 진입가 위로 올라간 stop을 매 사이클 진입가-stopPct%로 되돌렸음.
            if (held.meta && held.meta.stopPrice != null && !held.meta.breakEvenLocked) {
              const stopPct = (getStrategyRules(mcfg, stratName, market).stopLossPct || mcfg.stopLoss);
              const safeStop = held.avg * (1 - stopPct / 100);
              if (held.meta.stopPrice > safeStop) {
                held.meta.stopPrice = safeStop;
                posDirty = true;
              }
            }
            if (held.meta && held.meta.peakPrice != null && price > held.meta.peakPrice) {
              held.meta.peakPrice = price;
              posDirty = true;
            } else if (held.meta && held.meta.peakPrice == null) {
              // [V14] peakPrice 누락(옛 포지션/마이그레이션 결손) — 평단·현재가 중 높은 값으로 초기화.
              //   null로 방치되면 evaluateSell이 pos.avg로 폴백해 트레일이 진입가에 고정된다.
              held.meta.peakPrice = Math.max(held.avg, price);
              posDirty = true;
            }

            // [V8.3] Break-even stop — 수익 +breakEvenAt% 도달 시 stopPrice를 진입가 + breakEvenLock%로 끌어올림.
            // 한 번 설정되면 더 내려가지 않음 (수익 → 본전 전환 방지).
            // ATR-STOP 분기에서 사용되므로 stopPrice를 직접 조작.
            const breakRules = getStrategyRules(mcfg, stratName, market);
            let beJustLocked = false, beLockedPnl = 0, beLockedStop = 0;
            if (held.meta && breakRules.breakEvenAt != null && !held.meta.breakEvenLocked) {
              const curPnl = ((price - held.avg) / held.avg) * 100;
              if (curPnl >= breakRules.breakEvenAt) {
                const newStop = held.avg * (1 + (breakRules.breakEvenLock || 0) / 100);
                if (held.meta.stopPrice == null || held.meta.stopPrice < newStop) {
                  held.meta.stopPrice = newStop;
                }
                held.meta.breakEvenLocked = true;
                posDirty = true;
                beJustLocked = true; beLockedPnl = curPnl; beLockedStop = newStop;
              }
            }
            if (posDirty) {
              try { await savePosition(DB, market, symbol, stratName, held); } catch (e) {}
            }
            if (beJustLocked) {
              await log(DB, "INFO", symbol, "BREAK-EVEN locked [" + stratName + "] at +" + beLockedPnl.toFixed(2) + "% stop=" + beLockedStop.toFixed(2));
            }

            // [Vision AI] DOWN 고신뢰 보유 포지션 조기 청산 (적중률 게이팅)
            //   ≥90% → 즉시 전량 청산 (손익 무관)
            //   ≥80% → 이익 중이면 즉시 이익 실현 (손실 중이면 기존 손절 로직에 맡김)
            //   [성능 B] 적중률 50% 미만이면 조기 청산 안 함 (오신호로 인한 손절 방지)
            {
              const _vp = visionPreds && visionPreds[symbol];
              const _va = mcfg.visionAI || {};
              const _acc = visionPreds && visionPreds.__accuracy;
              const _prec = (_acc && _acc.total >= 20) ? _acc.precision : null;
              const _trusted = (_prec == null) || (_prec >= 0.5);
              if (_trusted && _va.enabled && _vp && _vp.pred === "down") {
                const _vc = _vp.conf;
                const _pnl = held.avg > 0 ? ((price - held.avg) / held.avg) * 100 : 0;
                if (_vc >= 0.90) {
                  await executeSell(DB, market, symbol, held, held.qty, price, "VISION_EXIT " + Math.round(_vc * 100) + "%", mcfg, cash);
                  sold++;
                  const _sk = Object.keys(positions).some(k => positions[k].symbol === symbol && k !== posKey);
                  if (!_sk) { heldSymbols.delete(symbol); const _sc = SECTOR_MAP[symbol]; if (_sc && sectorCounts[_sc]) sectorCounts[_sc]--; }
                  continue;
                } else if (_vc >= 0.80 && _pnl > 0) {
                  await executeSell(DB, market, symbol, held, held.qty, price, "VISION_PROFIT_LOCK " + Math.round(_vc * 100) + "% +" + _pnl.toFixed(1) + "%", mcfg, cash);
                  sold++;
                  const _sk = Object.keys(positions).some(k => positions[k].symbol === symbol && k !== posKey);
                  if (!_sk) { heldSymbols.delete(symbol); const _sc = SECTOR_MAP[symbol]; if (_sc && sectorCounts[_sc]) sectorCounts[_sc]--; }
                  continue;
                }
              }
            }

            // 매도 판단 ([V12] crashGate.deRisk → 손절·트레일 타이트닝)
            const _vHint = (visionPreds && visionPreds[symbol]) ? visionPreds[symbol] : null; // [Vision] 트레일 동적 조정용
            const sellDecision = evaluateSell(held, price, daily, dailyRsi, dailyMa, dailyMaShort, mcfg, canTrade, market, deRiskOpts, _vHint);
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
          // [V10] 1차 평가 — 분봉 없이 일봉 신호만으로 (호출 0). day 게이트는 데이터부족→통과.
          if (daily) {
            daily.symbol = symbol;  // [Vision AI] symbol을 daily에 주입
            // [강화·데이터적합] 장중 형성 중인 당일봉 거래량을 풀데이 기준으로 환산할 배수.
            //   경과율 하한 0.4(최대 2.5x)로 장 초반 노이즈 폭주 방지, 후반부·마감엔 ~1배. 백테스트는 미설정→1배.
            const _ef = sessionElapsedFraction(market);
            daily.volPaceMult = (_ef != null && _ef > 0 && _ef < 0.95) ? Math.min(2.5, 1 / Math.max(0.4, _ef)) : 1;
          }
          let stratResults = evaluateAllStrategies(price, dayPct, daily, mcfg, signalStats, regime, market, intra, visionPreds, secData, eventData);

          // === [SCALP] 분봉 단타 전략 평가 ===
          //   scalp 활성화 + trend 신호 없을 때만 평가 (같은 종목 중복진입 방지)
          //   [SCALP-PANIC] 단타 토글이 꺼져 있어도 패닉/베어장에서는 자동 작동 — "패닉 때도 단타로 번다".
          //   분봉 fetch: 1m봉 (단타는 더 세밀한 봉 필요)
          const _scalpOn = mcfg.strategies && mcfg.strategies.scalp;
          const _panicScalpOn = (function(){
            const sp = mcfg.scalpPanicRules || DEFAULT_CFG.scalpPanicRules || {};
            if (sp.enabled === false) return false;
            const cp = mcfg.crashSurvival && mcfg.crashSurvival.panic;
            const bear = regime && regime.regime === "BEAR" && typeof regime.worstDayPct === "number" && regime.worstDayPct <= -1.0;
            return ((typeof isPanic === "function") ? isPanic(regime, cp) : false) || bear;
          })();
          // [강화·데이터적합] 단타는 US 전용 — KR은 야후 1분봉이 15분 지연이라 분봉 단타 타이밍이 구조적으로 깨짐.
          //   (일봉/스윙은 거래윈도우 시프트로 데이터-가격 일치가 보장되지만, 분봉 단타는 시프트로도 못 고침)
          const _srUsOnly = (mcfg.scalpRules && mcfg.scalpRules.usOnly !== undefined) ? mcfg.scalpRules.usOnly : true;
          const _scalpMarketOk = (!_srUsOnly) || market === "us";
          if (_scalpMarketOk && (_scalpOn || _panicScalpOn) && !scalpDailyBlocked && stratResults.length === 0 && !strategiesHeldNow.has("scalp")) {
            const _scalpIc = mcfg.intradayConfirm || DEFAULT_CFG.intradayConfirm;
            if (minuteFetchUsed < ((_scalpIc && _scalpIc.maxPerCycle) || 60) && fetchBudgetLeft() > 5) {
              try {
                minuteFetchUsed++;
                const _scalpMb = await fetchMinuteBars(symbol, { interval: "1m", range: "1d" });
                const _scalpSig = evaluateScalpEntry(_scalpMb, daily, mcfg, market, regime);
                if (_scalpSig && !strategiesHeldNow.has("scalp") && !heldSymbols.has(symbol)) {
                  stratResults = [{ strategy: "scalp", signal: _scalpSig, rawCount: 1 }];
                }
              } catch (e) { /* 분봉 조회 실패 → scalp 스킵, trend 신호도 없으면 그냥 패스 */ }
            }
          }

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
          // [V62 전략 다변화] trend 편중 시 사이즈 조정 — trend 신규 ×0.8, snap/scalp ×1.1
          if (trendHeavy) {
            for (const _sr of stratResults) {
              const _s = _sr.signal;
              if (!_s) continue;
              if (_sr.strategy === "trend") _s.visionBoost = (_s.visionBoost || 1.0) * 0.8;
              else _s.visionBoost = (_s.visionBoost || 1.0) * 1.1;
            }
          }

          // ═══ [V64 컨텍스트 게이트] 실적·경제지표·내부자·TA패턴을 "주요" 진입 결정 요인으로 격상 ═══
          //   모든 전략(trend/snap/scalp) 공통. 전부 캐시(D1) 데이터 → 추가 fetch 0, Cloudflare 영향 없음.
          //   신호가 있는 종목만 계산하므로 CPU 비용도 사이클당 몇 개 수준.
          //   점수 구성:
          //     TA 차트/캔들 패턴: taDetectPatterns score (대략 -6~+6) ×1
          //     실적 D-2 이내: -3 (어닝 갭 도박 차단)
          //     고중요 지표 발표 24h 전: -1 / 당일 서프라이즈 합산 ≤-2: -2, ≥+2: +1
          //     내부자 Form4 3일 클러스터(US): -2
          //   해석: ≤-4 진입 차단 / -3..-1 ×0.7 / 0 중립 / +1..+2 ×1.1 / ≥+3 ×1.25
          //   SCALP 추가 규칙: 점수 음수면 차단 — 손실 데이터(연속 VWAP 손절)가 역풍 단타를 증명.
          if (stratResults.length > 0) {
            let ctxScore = 0;
            const ctxWhy = [];
            try {
              const _ta = taDetectPatterns(daily);
              if (_ta && _ta.patterns.length) {
                ctxScore += _ta.score;
                ctxWhy.push("TA" + (_ta.score >= 0 ? "+" : "") + _ta.score + (_ta.top ? "(" + _ta.top.name + ")" : ""));
              }
            } catch (e) {}
            if (eventData) {
              const _ets2 = eventData.earningsBySym && eventData.earningsBySym[symbol];
              if (_ets2) {
                const _dD = (_ets2 - Date.now()) / 86400000;
                if (_dD >= -0.5 && _dD <= 2) { ctxScore -= 3; ctxWhy.push("EARN D-" + Math.max(0, _dD).toFixed(1)); }
              }
              const _ec = eventData.econ && eventData.econ[market];
              if (_ec) {
                if (_ec.preHigh) { ctxScore -= 1; ctxWhy.push("ECON-PRE(" + _ec.preHigh + ")"); }
                if (_ec.shock <= -2) { ctxScore -= 2; ctxWhy.push("SHOCK" + _ec.shock); }
                else if (_ec.shock >= 2) { ctxScore += 1; ctxWhy.push("SHOCK+" + _ec.shock); }
              }
              const _ic2 = eventData.insiderCount && eventData.insiderCount[symbol];
              if (_ic2 >= 2 && market === "us") { ctxScore -= 2; ctxWhy.push("INSIDER F4x" + _ic2); }
            }
            const _ctxStr = ctxWhy.length ? (" [" + ctxWhy.join(" ") + "]") : "";
            if (ctxScore <= -4) {
              incBlock("CTX_NEG");
              await log(DB, "INFO", symbol, "[V64 CTX] 진입 차단 score=" + ctxScore + _ctxStr);
              continue;
            }
            const _ctxMult = ctxScore >= 3 ? 1.25 : ctxScore >= 1 ? 1.1 : ctxScore <= -1 ? 0.7 : 1.0;
            const _kept = [];
            for (const _sr of stratResults) {
              if (_sr.strategy === "scalp" && ctxScore < 0) {
                incBlock("CTX_SCALP_NEG");
                await log(DB, "INFO", symbol, "[V64 CTX] scalp 차단 score=" + ctxScore + _ctxStr);
                continue;
              }
              if (_sr.signal) {
                _sr.signal.visionBoost = (_sr.signal.visionBoost || 1.0) * _ctxMult;
                if (ctxWhy.length) _sr.signal.ctxNote = "CTX" + (ctxScore >= 0 ? "+" : "") + ctxScore + "×" + _ctxMult + _ctxStr;
              }
              _kept.push(_sr);
            }
            stratResults = _kept;
            if (stratResults.length === 0) continue;
            if (_ctxMult !== 1.0) {
              await log(DB, "INFO", symbol, "[V64 CTX] score=" + ctxScore + " → 사이즈 ×" + _ctxMult + _ctxStr);
            }
          }
          signalCount += stratResults.length;   // [통계] 발생 매수신호 누적
          // [신호 로그] 발생 신호를 로그에 기록 (종목 + 전략 + 신호명)
          for (const _sr of stratResults) {
            const _sig = _sr.signal;
            await log(DB, "SIGNAL", symbol, "SIGNAL[" + market.toUpperCase() + "] " + _sr.strategy + " " + (_sig && _sig.name ? _sig.name : "?") + " w=" + (_sig && _sig.weight ? _sig.weight.toFixed(2) : "?") + " RSI=" + (dailyRsi != null ? dailyRsi.toFixed(1) : "?") + " d=" + dayPct.toFixed(1) + "%");
          }

          // Cross-strategy confluence: 2개 이상 전략이 동시 신호면 보너스
          const crossBonus = (stratResults.length >= 2) ? (mcfg.crossConfluenceBonus || 1.0) : 1.0;
          if (stratResults.length >= 2) {
            const stratNames = stratResults.map(function(r){ return r.strategy; }).join("+");
            await log(DB, "INFO", symbol, "CROSS-CONF (" + stratNames + ") x" + crossBonus);
          }

          // [V24] 한 종목당 한 사이클 1회만 매수 (다중전략 동시 진입 과집중 방지)
          //   가장 강한 신호 1개만 채택. 같은 종목이 swing+mom+mr 다 떠도 1번만 산다.
          let boughtThisSymbol = false;
          for (const sr of stratResults) {
            if (boughtThisSymbol) break;
            const strategy = sr.strategy;
            const signal = sr.signal;

            // 같은 (종목, 전략) 보유중이면 스킵
            if (strategiesHeldNow.has(strategy)) {
              continue;
            }
            // [V24] 이 종목을 이미 보유중이면(어느 전략이든) 추가 매수 차단
            if (heldSymbols.has(symbol)) {
              continue;
            }
            // [V63] 동시 보유 종목 수 자동화 — 고정 상한(maxConcurrent) 제거가 기본.
            //   개수 제한 대신 ① 전략버킷 예산 스냅샷(V28/V51) ② 가용현금 클램프
            //   ③ executeBuy 최종 클램프 ④ maxPositionPct 종목비중 상한 ⑤ 섹터 상한이
            //   총량을 통제한다 → 예산 초과 매수는 구조적으로 불가능.
            //   복원하려면 cfg.autoConcurrent=false (기존 maxConcurrent 게이트 부활).
            if (mcfg.autoConcurrent === false) {
              const _tszC = getTrendSizing(mcfg, market);
              const maxConc = (_tszC.maxConcurrent != null) ? _tszC.maxConcurrent : 8;
              if (heldSymbols.size >= maxConc) {
                incNobuy("max_concurrent");
                continue;
              }
              if (strategy === "snap") {
                const _snMax = (mcfg.snapRules && mcfg.snapRules.maxConcurrent != null) ? mcfg.snapRules.maxConcurrent : 6;
                let _snHeld = 0;
                for (const _pk in positions) { if ((positions[_pk].strategy || "") === "snap") _snHeld++; }
                if (_snHeld >= _snMax) {
                  incNobuy("snap_max_concurrent");
                  continue;
                }
              }
            }

            const ctx = {
              symbol: symbol,
              strategy: strategy,
              heldSymbols: heldSymbols,
              sectorCounts: sectorCounts,
              strategiesHeld: strategiesHeldNow,
              cooldowns: activeCooldowns
            };
            // [V12] 폭락장 생존 게이트 — 신규매수 전면 차단(드로다운 L2+/연속손실/패닉)
            //   [패닉 헤지] 인버스 ETF는 면제 — 패닉장에서 인버스로 수익·헤지를 노린다.
            const _symInverse = INVERSE_ETF.has(symbol);
            // [SCALP-PANIC] 패닉 단타 신호는 전면차단(DD_L2/연속손실)도 면제 — 리스크 작고 회전 빨라 패닉장 수익 기회 유지.
            const _isPanicScalpSig = signal && signal.isPanicScalp === true;
            if (crashGate.blockNew && !_symInverse && !_isPanicScalpSig) {
              incBlock("CRASH_GATE[" + strategy + "]");
              continue;
            }

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

            // [V12] VIX/드로다운 사이즈 스케일 — riskPct에 직접 반영 (패닉 시 포지션 축소)
            //   [패닉 헤지] 인버스는 면제·부스트 — 패닉이 인버스엔 호재.
            let sizeScale = 1.0;
            if (crashGate.sizeScale && crashGate.sizeScale < 1 && !_symInverse) sizeScale = crashGate.sizeScale;
            // [SCALP-PANIC] 패닉 중 단타는 crashGate(×0.4)에 과도히 눌리지 않게 하한 적용 (리스크 자체가 0.5%로 작음 → 패닉장 수익 기회 보존)
            if (strategy === "scalp" && !_symInverse) {
              const _spr = mcfg.scalpPanicRules || DEFAULT_CFG.scalpPanicRules || {};
              const _floor = _spr.sizeScaleFloor != null ? _spr.sizeScaleFloor : 0.6;
              if (sizeScale < _floor) sizeScale = _floor;
            }
            if (_symInverse && regime && (regime.regime === "BEAR" || (typeof regime.worstDayPct === "number" && regime.worstDayPct <= -1.0))) sizeScale = (mcfg.inversePanicBoost || 1.3);
            // [신규·인터마켓] 시장 컨텍스트(risk-on/off) 반영 — risk-off면 축소, risk-on이면 소폭 확대.
            //   인버스 ETF는 risk-off가 호재라 면제(이미 부스트됨). 곱연산이라 크래시/패닉 축소와 안전하게 결합.
            if (mktCtx && typeof mktCtx.sizeScale === "number" && !_symInverse) {
              sizeScale *= mktCtx.sizeScale;
            }
            // [섹터 뉴스] 섹터별 뉴스 감성에 따라 사이즈 소폭 조정 — 인버스 ETF 면제
            if (sectorSentiment && sectorSentiment.scales && !_symInverse) {
              const _newsGrp = getSectorGroup(symbol, mcfg);
              const _newsScale = sectorSentiment.scales[_newsGrp];
              if (typeof _newsScale === "number") sizeScale *= _newsScale;
            }

            // === [재작성] 고정리스크 사이징 ===
            //   한 거래 손실한도 R$ = 자산 × riskPerTrade%. 손절거리(주당)로 수량을 역산한다.
            //   → 변동성이 큰(손절 먼) 종목일수록 자동으로 작게 산다. 손실 금액이 항상 균등.
            //   종목 비중 상한·가용현금 상한으로 과집중/초과 통제. executeBuy의 DB clamp가 최종 차단.
            const tsz = getTrendSizing(mcfg, market);
            // [SCALP] 단타는 전용 사이징(작은 리스크·비중) 사용 — 회전 빠르고 손실 누적 방지.
            const _scalpSz = (strategy === "scalp") ? Object.assign({}, mcfg.scalpRules || DEFAULT_CFG.scalpRules || {}) : null;
            // [V52 SNAP] 스냅백 전용 사이징 — 역추세성이라 trend보다 작게. KR은 지연시세 → 추가 축소.
            const _snapSz = (strategy === "snap") ? Object.assign({}, DEFAULT_CFG.snapRules || {}, mcfg.snapRules || {}) : null;
            // [Vision AI] UP 고신뢰 신호면 포지션 크기 부스트 (visionBoost=1.25). sizeScale = VIX/드로다운 스케일.
            let _baseRisk;
            if (_scalpSz)      _baseRisk = (_scalpSz.riskPerTrade != null ? _scalpSz.riskPerTrade : 0.5);
            else if (_snapSz)  _baseRisk = (_snapSz.riskPerTrade != null ? _snapSz.riskPerTrade : 0.5) * (market === "kr" ? (_snapSz.krRiskScale != null ? _snapSz.krRiskScale : 0.7) : 1.0);
            else               _baseRisk = (tsz.riskPerTrade != null ? tsz.riskPerTrade : 0.75);
            const riskPct = _baseRisk * (signal.visionBoost || 1.0) * sizeScale;
            const maxPosPct = _scalpSz ? (_scalpSz.maxPositionPct != null ? _scalpSz.maxPositionPct : 6)
                            : _snapSz ? (_snapSz.maxPositionPct != null ? _snapSz.maxPositionPct : 8)
                            : (tsz.maxPositionPct != null ? tsz.maxPositionPct : 15);
            const equity = (typeof portfolioValue === "number" && portfolioValue > 0) ? portfolioValue : cash[market];
            const tr = getStrategyRules(mcfg, strategy, market);
            // 손절 거리(주당) — executeBuy와 동일 규칙: min(N×ATR, price×stopLoss%)
            const atrStopDist = (dailyAtr && dailyAtr > 0) ? dailyAtr * (tr.atrStopMult || mcfg.atrStopMult || 2.0) : null;
            const pctStopDist = price * ((tr.stopLossPct || mcfg.stopLoss || 5) / 100);
            let stopDist = (atrStopDist != null) ? Math.min(atrStopDist, pctStopDist) : pctStopDist;
            if (!(stopDist > 0)) stopDist = price * 0.05;
            // [확실성] 신호 confidence(0.5~1.0)로 리스크 축소 — 약추세는 작게(악화 방어). 최대 1.0(그대로).
            const sigConf = (signal && typeof signal.confidence === "number") ? Math.max(0, Math.min(1, signal.confidence)) : 1.0;
            // [섹터그룹] 그룹 성과 가중치(0.6~1.3) 반영 — 잘 되는 섹터그룹은 사이즈↑, 안 되는 그룹은 ↓
            const _sg = mcfg.sectorGroups || {};
            const grpW = (_sg.enabled !== false && _sg.weights) ? (_sg.weights[getSectorGroup(symbol, mcfg)] || 1.0) : 1.0;
            // [신호타입] 진입신호 종류별 가중치(0.7~1.3) — 돌파/풀백 중 잘 되는 쪽에 더 베팅
            const _stw = mcfg.signalTypeWeights || {};
            const sigTypeW = (_stw.enabled !== false && _stw.weights && signal && signal.name) ? (_stw.weights[signal.name] || 1.0) : 1.0;
            // 다층 가중치(confidence×그룹×신호타입) 곱 + 전체 하한(너무 작아 거래 누락되는 것 방지)
            let combW = sigConf * grpW * sigTypeW;
            const wFloor = mcfg.weightFloor != null ? mcfg.weightFloor : 0.3;
            if (combW < wFloor) combW = wFloor;
            // 리스크 기반 수량
            const riskDollar = equity * (riskPct / 100) * combW;
            let qty = Math.floor(riskDollar / stopDist);
            // 종목 비중 상한 (자산의 maxPosPct%)
            const maxByPos = Math.floor(equity * (maxPosPct / 100) / (price * (1 + feeRate)));
            if (qty > maxByPos) qty = maxByPos;
            // 가용현금 1차 상한 (executeBuy가 최종 clamp)
            const maxByCash = Math.floor((cash[market] * 0.98) / (price * (1 + feeRate)));
            if (qty > maxByCash) qty = maxByCash;
            if (qty < 0) qty = 0;

            const totalCost = qty * price * (1 + feeRate);
            // [V27] 예산 가드 — 부동소수점 오차 여유(1원/1센트) 두고 엄격 차단 + 초과 시도 로깅
            const epsilon = market === "us" ? 0.01 : 1;
            // [V51] 전략별 예산 가드 — 해당 전략 버킷 한도 내에서만 매수.
            const _bk = _bkt(strategy);
            const _budgetCap = (market === "cm") ? cycleBudget.cm : cycleBudget[market][_bk];
            const _spentSoFar = (market === "cm") ? cycleSpent.cm : cycleSpent[market][_bk];
            const wouldSpend = _spentSoFar + totalCost;
            if (qty > 0 && wouldSpend > _budgetCap + epsilon) {
              await log(DB, "INFO", symbol, "[예산] " + market.toUpperCase() + " " + _bk + "버킷 한도 도달: 누적=" + Math.round(_spentSoFar) + "+" + Math.round(totalCost) + " > " + Math.round(_budgetCap) + " (" + strategy + ")");
              incNobuy("budget_" + _bk);
            } else if (qty > 0 && totalCost <= cash[market] + epsilon) {
              // [분봉] 진입 직전 장중 타이밍 확인 — 확정 후보에만 분봉 1회 조회.
              //   장중 급락(칼날)·VWAP 추격 진입을 차단. 조회 실패/예산초과 시 통과(기존 동작 보존).
              //   maxPerCycle 캡으로 subrequest 통제, 장중·정규장에서만 의미있어 canTrade일 때만.
              const _ic = mcfg.intradayConfirm || DEFAULT_CFG.intradayConfirm;
              // [SCALP] 단타는 진입 시 이미 1분봉을 평가했으므로 이 5분봉 추가 게이트는 건너뜀(중복 fetch 방지).
              if (strategy !== "scalp" && _ic && _ic.enabled !== false && minuteFetchUsed < (_ic.maxPerCycle || 60) && fetchBudgetLeft() > 5) {
                try {
                  minuteFetchUsed++;
                  const _mb = await fetchMinuteBars(symbol, { interval: _ic.interval || "5m" });
                  const _conf = confirmIntradayEntry(_mb, price, _ic);
                  if (!_conf.ok) {
                    incBlock(_conf.reason.split(" ")[0] + "[" + strategy + "]");
                    await log(DB, "INFO", symbol, "INTRADAY BLOCK [" + strategy + "] " + _conf.reason);
                    break;  // 장중 타이밍 불리 → 이 종목은 이번 사이클 진입 보류(다른 신호도 스킵)
                  }
                  // [강화] VWAP 근접 + 상승 모멘텀 최적 타이밍 → signal confidence 부스트
                  if (_conf.confidenceBoost && _conf.confidenceBoost > 0 && signal) {
                    signal.visionBoost = (signal.visionBoost || 1.0) * (1 + _conf.confidenceBoost);
                    if (!signal.intradayNote) signal.intradayNote = "VWAP_OPT +" + (_conf.confidenceBoost * 100).toFixed(0) + "%";
                  }
                } catch (e) { /* 분봉 조회 실패는 무시 — 일봉 신호로 진입 진행 */ }
              }
              // [V8.6 Hybrid] LLM stop_loss_adjustment 적용 (지시 있으면)
              const buyOpts = (llmInstr && llmInstr.stop_loss_adjustment && typeof llmInstr.stop_loss_adjustment.new_pct === "number")
                ? { stopPctOverride: llmInstr.stop_loss_adjustment.new_pct } : null;
              const cashBefore = cash[market];
              cash = await executeBuy(DB, market, symbol, strategy, qty, price, signal, dailyAtr, mcfg, cash, buyOpts) || cash;
              // [V28] executeBuy가 실제로 cash를 차감했을 때만 매수 성공으로 카운트.
              //   savePosition 충돌 등으로 차감이 안 됐으면(=실패) spent/held 갱신 안 함.
              const actuallySpent = cashBefore - cash[market];
              if (actuallySpent > epsilon) {
                if (market === "cm") cycleSpent.cm += actuallySpent;
                else cycleSpent[market][_bk] += actuallySpent;
                bought++;
                boughtThisSymbol = true;
                heldSymbols.add(symbol);
                strategiesHeldNow.add(strategy);
                const sec = SECTOR_MAP[symbol];
                if (sec) sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
              } else {
                incNobuy("buy_failed[" + strategy + "]");
              }
            } else if (qty > 0 && totalCost > cash[market] + epsilon) {
              // 예산 초과 매수 시도 — 차단하고 기록 (회계 붕괴 방지)
              await log(DB, "ERROR", symbol, "[CRITICAL] 예산초과 매수차단: 필요=" + Math.round(totalCost) + " 가용=" + Math.round(cash[market]) + " (" + strategy + ")");
              incNobuy("cash_short[" + strategy + "]");
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
      // [성능] 평가 중 모은 quote 지표 갱신을 일괄 커밋(100개씩) — 종목당 D1 write 제거 효과
      for (let i = 0; i < evalQuoteStmts.length; i += 100) {
        try { await DB.batch(evalQuoteStmts.slice(i, i + 100)); }
        catch (e) { await log(DB, "WARN", null, "[성능] eval quote batch fail: " + e.message); }
      }
      // [TIME-CAP] 전 종목 평가를 시간 내 완료했으면 라운드로빈 오프셋 리셋
      if (!evalTimedOut) { try { await setState(DB, "eval_offset:" + market, 0); } catch (e) {} }

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
      await refreshCycleLock(DB, cfg.cycleLockTTL || 90000, myLockPid);
    }

    // [회계 재설계] cash는 trades 원장에서 항상 재계산되므로 별도 저장하지 않는다(죽은 코드 제거).
    try { await setState(DB, "last_tick", Date.now()); } catch (e) {}
    // [V25 감사 A] 사이클 종료 시 회계 무결성 검증 — 거래한 시장만.
    for (const mkt of marketsToTrade) {
      await auditAccounting(DB, mkt, cash);
    }
    const cycleMs = Date.now() - cycleStartedAt;
    // [실시간] fastWatch가 쓸 거래가능 시장 목록 기록 — 휴장/엔진OFF/윈도우 판정 재사용.
    try { await setState(DB, "fastwatch:markets", { list: marketsToTrade, ts: Date.now() }); } catch (e) {}
    await log(DB, "INFO", null, "Done: tried=" + tried + " skip=" + skipped + " buy=" + bought + " sell=" + sold + " fetchFail=" + fetchFail + " minBars=" + minuteFetchUsed + " cycleMs=" + cycleMs);
    try { await DB.prepare("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)").run(); } catch (e) {}
    // [통계] 일별 엔진 통계 누적 (KST 05:00 리셋). 신호=signalCount, 거래=buy+sell, 에러=직전 집계 이후 누적분.
    try {
      const _dk = kstTradingDayKey(new Date());
      const _errs = __engineErrCount; __engineErrCount = 0;
      await DB.prepare(
        "INSERT INTO daily_stats (day_key, signals, errors, trades, updated_ts) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(day_key) DO UPDATE SET signals = signals + excluded.signals, errors = errors + excluded.errors, trades = trades + excluded.trades, updated_ts = excluded.updated_ts"
      ).bind(_dk, signalCount, _errs, bought + sold, Date.now()).run();
      // 30일 초과분 정리
      await DB.prepare("DELETE FROM daily_stats WHERE day_key NOT IN (SELECT day_key FROM daily_stats ORDER BY day_key DESC LIMIT 30)").run();
    } catch (e) { console.error("daily_stats upsert fail:", e.message); }
  } finally {
    await releaseCycleLock(DB, myLockPid);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// [실시간] runFastWatch — 분(分) 내 빠른 포지션 감시 (sleep 서브틱)
// ───────────────────────────────────────────────────────────────────────
// 한 invocation 안에서 _sleep으로 ~9초 간격 서브틱을 돌려, 보유 포지션의
// 손절/트레일/익절(evaluateSell)을 1분 주기 대신 ~10초 주기로 점검한다.
// 전 종목 스캔이 아니라 "보유 포지션"만 → subrequest 최소. sleep은 CPU 비소모.
// cronStart 기준 maxElapsedMs를 넘지 않게 자율 종료(다음 cron과 겹침 방지).
async function runFastWatch(env, cronStart) {
  const DB = env.DB;
  try {
    const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
    const fw = cfg.fastWatch || DEFAULT_CFG.fastWatch;
    if (!fw || fw.enabled === false) return;
    if (!cfg.enabled) return;                     // 엔진 OFF면 감시 안 함
    if (await isUsageShutdown(DB, cfg)) return;   // 사용량 셧다운 중이면 중지

    // 직전 거래 사이클이 판정한 "거래가능 시장"만 (휴장/엔진/윈도우 로직 재사용, 90s 신선도)
    const fwm = await getState(DB, "fastwatch:markets", null);
    if (!fwm || !fwm.ts || (Date.now() - fwm.ts) > 90000 || !Array.isArray(fwm.list) || fwm.list.length === 0) return;
    const markets = fwm.list.filter(function(m){ return m === "us" || m === "kr"; });
    if (markets.length === 0) return;

    const maxElapsed = fw.maxElapsedMs || 52000;
    const interval = fw.intervalMs || 9000;
    const ticks = fw.ticks || 3;
    // 시간이 한 번의 (대기+처리)도 못 낼 만큼 적으면 시작 안 함
    if ((Date.now() - cronStart) + interval > maxElapsed) return;

    resetFetchBudget(100);  // fastWatch 전용 깨끗한 subrequest 예산
    const visionPreds = await getState(DB, "vision_predictions", {});
    const vixState = await getState(DB, "vix", null);
    const vixVal = (vixState && typeof vixState.value === "number" && vixState.value > 0) ? vixState.value : 0;
    const deRiskOpts = { active: false, vixValue: vixVal };
    const cash = await computeAllCash(DB, cfg);

    // 시장별 보유 포지션 + 캐시 일봉 사전 로드 (틱마다 재로드 안 함)
    const ctxByMarket = {};
    for (const market of markets) {
      const positions = await getPositions(DB, market);
      if (Object.keys(positions).length === 0) continue;
      const mcfg = getMarketCfg(cfg, market);
      const dailyMap = {};
      try {
        const drows = await DB.prepare("SELECT k, v FROM state WHERE k LIKE 'daily:%'").all();
        for (const r of (drows.results || [])) { try { dailyMap[r.k.slice(6)] = JSON.parse(r.v); } catch (e) {} }
      } catch (e) {}
      ctxByMarket[market] = { positions: positions, mcfg: mcfg, dailyMap: dailyMap };
    }
    const activeMarkets = Object.keys(ctxByMarket);
    if (activeMarkets.length === 0) return;  // 보유 포지션 없음 → 감시 불필요

    let fastSells = 0, ticksDone = 0;
    for (let t = 0; t < ticks; t++) {
      if ((Date.now() - cronStart) + interval > maxElapsed) break;  // 다음 서브틱이 예산 초과면 종료
      await _sleep(interval);
      ticksDone++;
      for (const market of activeMarkets) {
        const c = ctxByMarket[market];
        const mcfg = c.mcfg;
        const uniq = Array.from(new Set(Object.keys(c.positions).map(function(k){ return c.positions[k].symbol; }))).slice(0, fw.maxSymbols || 50);
        if (uniq.length === 0) continue;
        if (fetchBudgetLeft() <= 2) break;
        let quotes = {};
        try { quotes = await fetchBatchQuotes(uniq, { maxFallback: uniq.length, DB: DB }); }
        catch (e) { continue; }
        for (const posKey of Object.keys(c.positions)) {
          const held = c.positions[posKey];
          if (!held || held.qty <= 0) continue;
          const q = quotes[held.symbol];
          if (!q || !(typeof q.price === "number" && q.price > 0)) continue;
          const price = q.price;
          const stratName = held.strategy || "trend";
          const daily = c.dailyMap[held.symbol];
          if (!daily || !daily.closes || daily.closes.length < 25) continue;
          const closes = daily.closes;
          const dailyRsi = closes.length >= mcfg.rsiPeriod + 1 ? getRSI(closes, mcfg.rsiPeriod) : null;
          const dailyMa = closes.length >= mcfg.maPeriod ? getMA(closes, mcfg.maPeriod) : null;
          const dailyMaShort = closes.length >= mcfg.maShortPeriod ? getMA(closes, mcfg.maShortPeriod) : null;
          // peak/stop/break-even 갱신 (메인 루프와 동일 규칙)
          let posDirty = false;
          if (held.meta && held.meta.stopPrice != null && !held.meta.breakEvenLocked) {
            const stopPct = (getStrategyRules(mcfg, stratName, market).stopLossPct || mcfg.stopLoss);
            const safeStop = held.avg * (1 - stopPct / 100);
            if (held.meta.stopPrice > safeStop) { held.meta.stopPrice = safeStop; posDirty = true; }
          }
          if (held.meta && held.meta.peakPrice != null && price > held.meta.peakPrice) { held.meta.peakPrice = price; posDirty = true; }
          else if (held.meta && held.meta.peakPrice == null) { held.meta.peakPrice = Math.max(held.avg, price); posDirty = true; }
          const breakRules = getStrategyRules(mcfg, stratName, market);
          if (held.meta && breakRules.breakEvenAt != null && !held.meta.breakEvenLocked) {
            const curPnl = ((price - held.avg) / held.avg) * 100;
            if (curPnl >= breakRules.breakEvenAt) {
              const newStop = held.avg * (1 + (breakRules.breakEvenLock || 0) / 100);
              if (held.meta.stopPrice == null || held.meta.stopPrice < newStop) held.meta.stopPrice = newStop;
              held.meta.breakEvenLocked = true; posDirty = true;
            }
          }
          const _vHint = visionPreds && visionPreds[held.symbol] ? visionPreds[held.symbol] : null;
          const sellDecision = evaluateSell(held, price, daily, dailyRsi, dailyMa, dailyMaShort, mcfg, true, market, deRiskOpts, _vHint);
          if (sellDecision.sell) {
            try {
              // 원본 reason 그대로 전달 — executeSell의 TP1/TP2/STOP·쿨다운 판정이 reason 접두에 의존.
              const wasFull = sellDecision.sellQty >= held.qty;
              await executeSell(DB, market, held.symbol, held, sellDecision.sellQty, price, sellDecision.reason, mcfg, cash);
              fastSells++;
              await log(DB, "INFO", held.symbol, "[FAST] " + sellDecision.reason);
              if (wasFull) delete c.positions[posKey];  // 부분매도는 executeSell이 held.qty를 in-place 감소
            } catch (e) { try { await log(DB, "ERROR", held.symbol, "[FAST] sell fail: " + e.message); } catch (e2) {} }
          } else if (posDirty) {
            try { await savePosition(DB, market, held.symbol, stratName, held); } catch (e) {}
          }
        }
      }
    }
    if (ticksDone > 0) {
      await log(DB, "INFO", null, "[FAST] watch ticks=" + ticksDone + " sells=" + fastSells + " mkts=" + activeMarkets.join(","));
    }
  } catch (e) {
    try { await log(DB, "ERROR", null, "[FAST] watch fail: " + e.message); } catch (e2) {}
  }
}

// [V25 감사 A] 회계 무결성 검증 — 매 사이클 시장별 총자산(현금+보유평가액)을 계산하고,
//   D1에 스냅샷 저장. 다음 사이클에 직전 스냅샷과 비교해 비정상 급변을 감지/경고한다.
//   "현금 + 보유평가"는 시세 변동으로 자연히 바뀌므로, 단순 절대 임계가 아니라
//   투자원금(invested) 대비 비정상(예: 현금이 갑자기 2배↑, 음수 등)을 잡는다.
async function auditAccounting(DB, market, cash) {
  try {
    // [회계 재설계] positions 테이블 raw row를 직접 조회한다.
    //   (getPositions는 "symbol::strategy" 키 map을 반환 → for...of/avg_price 순회가 깨져
    //    이 감사가 그동안 조용히 무력화돼 있었다. raw 배열로 바로잡아 실제 작동시킨다.)
    const posRes = await DB.prepare("SELECT symbol, strategy, qty, avg_price, opened_ts, meta FROM positions WHERE market = ?").bind(market).all();
    const positions = posRes.results || [];
    let invested = 0;
    const seen = {};
    const dups = [];
    for (const p of positions) {
      invested += (p.qty || 0) * (p.avg_price || 0);
      const k = p.symbol + "::" + p.strategy;
      if (seen[k]) dups.push(k);
      seen[k] = true;
    }
    const cashVal = (cash && typeof cash[market] === "number") ? cash[market] : 0;
    const flags = [];
    // 1) 음수 현금
    if (cashVal < 0) flags.push("NEG_CASH(" + Math.round(cashVal) + ")");
    // 2) 중복 포지션 (KQ 마이그레이션 등으로 생기는 이중 계상)
    if (dups.length > 0) flags.push("DUP_POS(" + dups.join(",") + ")");
    // 3) 투자원금이 비정상적으로 큼 — 초기자본 대비 과투자 (현금 회계 붕괴 징후)
    const initial = market === "us" ? 100000 : (market === "kr" ? 100000000 : 100000);
    const totalAsset = cashVal + invested;
    if (totalAsset > initial * 2) flags.push("ASSET_INFLATE(total=" + Math.round(totalAsset) + " vs init=" + initial + ")");
    if (flags.length > 0) {
      await log(DB, "ERROR", null, "[AUDIT] " + market.toUpperCase() + " 회계 이상: " + flags.join(" | ") +
        " (cash=" + Math.round(cashVal) + " invested=" + Math.round(invested) + " positions=" + positions.length + ")");
      // [회계 재설계] 자가 치유 — 음수현금/자산팽창은 cash 체크포인트 오염 징후.
      //   체크포인트를 삭제하면 다음 계산이 trades 원장 전체에서 처음부터 정확히 재계산된다.
      if (cashVal < 0 || totalAsset > initial * 2) {
        try { await DB.prepare("DELETE FROM state WHERE k = ?").bind("cash_ckpt:" + market).run(); } catch (e) {}
        await log(DB, "WARN", null, "[AUDIT-FIX] " + market.toUpperCase() + " cash 체크포인트 무효화 → 다음 사이클에 원장 재계산");
      }
      // [V26] 자동 복구 — 중복 포지션만 정리(정상 거래는 보존). 전체 리셋 불필요.
      if (dups.length > 0) {
        for (const dupKey of dups) {
          const parts = dupKey.split("::");
          const dsym = parts[0], dstrat = parts[1];
          // 같은 (symbol, strategy) 중복 행 중 1개만 남기고 제거 → 수량 합산본으로 재저장
          try {
            const same = positions.filter(function(p){ return p.symbol === dsym && p.strategy === dstrat; });
            if (same.length > 1) {
              let totalQty = 0, weightedAvg = 0, earliestTs = null;
              // [V33] meta 상속 — 가장 보수적인 손절가(높은 stop), 최고 peak, 수수료 합산 보존.
              //   meta를 빈 객체로 덮으면 다음 사이클에 손절 정보 유실 → 오발 청산 사고.
              let mergedMeta = { strategy: dstrat, tp1Done: false };
              let feeSum = 0, peakMax = null, stopMax = null, sigMembers = [], origQtySum = 0, atrEntry = null;
              for (const p of same) {
                totalQty += (p.qty || 0);
                weightedAvg += (p.qty || 0) * (p.avg_price || 0);
                if (earliestTs == null || (p.opened_ts && p.opened_ts < earliestTs)) earliestTs = p.opened_ts;
                let pm = {};
                try { pm = p.meta ? (typeof p.meta === "string" ? JSON.parse(p.meta) : p.meta) : {}; } catch (e) { pm = {}; }
                feeSum += (typeof pm.feeRemaining === "number" ? pm.feeRemaining : (pm.feePaid || 0));
                if (pm.peakPrice != null && (peakMax == null || pm.peakPrice > peakMax)) peakMax = pm.peakPrice;
                if (pm.stopPrice != null && (stopMax == null || pm.stopPrice > stopMax)) stopMax = pm.stopPrice;
                if (pm.atrAtEntry != null && atrEntry == null) atrEntry = pm.atrAtEntry;
                if (Array.isArray(pm.signalMembers)) sigMembers = sigMembers.concat(pm.signalMembers);
                if (pm.tp1Done) mergedMeta.tp1Done = true;
                origQtySum += (pm.originalQty || p.qty || 0);
              }
              const avg = totalQty > 0 ? weightedAvg / totalQty : 0;
              mergedMeta.feePaid = feeSum;
              mergedMeta.feeRemaining = feeSum;
              if (peakMax != null) mergedMeta.peakPrice = peakMax; else mergedMeta.peakPrice = avg;
              if (stopMax != null) mergedMeta.stopPrice = stopMax;
              if (atrEntry != null) mergedMeta.atrAtEntry = atrEntry;
              mergedMeta.signalMembers = sigMembers.length ? Array.from(new Set(sigMembers)) : [];
              mergedMeta.signal = mergedMeta.signalMembers[0] || "AUDIT_MERGE";
              mergedMeta.originalQty = origQtySum || totalQty;
              await DB.prepare("DELETE FROM positions WHERE symbol = ? AND strategy = ? AND market = ?").bind(dsym, dstrat, market).run();
              if (totalQty > 0) {
                await savePosition(DB, market, dsym, dstrat, { qty: totalQty, avg: avg, opened_ts: earliestTs || Date.now(), meta: mergedMeta });
              }
              await log(DB, "INFO", dsym, "[AUDIT-FIX] 중복 포지션 합산(meta 상속): " + dstrat + " qty=" + totalQty + " avg=" + Math.round(avg) + " stop=" + (stopMax != null ? Math.round(stopMax) : "?"));
            }
          } catch (e) {
            await log(DB, "WARN", dsym, "[AUDIT-FIX] 복구 실패: " + e.message);
          }
        }
      }
      return { ok: false, flags: flags, cash: cashVal, invested: invested };
    }
    return { ok: true, cash: cashVal, invested: invested };
  } catch (e) {
    return { ok: true, error: e.message };
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
      // [섹터그룹·신호타입] 현재 가중치 계산(cfg에 주입) + 통계 — UI 표시용
      await applySectorGroupWeights(env.DB, cfg);
      await applySignalTypeWeights(env.DB, cfg);
      const sectorGroupStats = await getState(env.DB, "sector_group_stats", {});
      const sectorGroups = { stats: sectorGroupStats, weights: (cfg.sectorGroups && cfg.sectorGroups.weights) || {} };
      const signalTypeStats = await getState(env.DB, "signal_type_stats", {});
      const signalTypes = { stats: signalTypeStats, weights: (cfg.signalTypeWeights && cfg.signalTypeWeights.weights) || {} };
      const cash = await computeAllCash(env.DB, cfg);
      const deposits = await getState(env.DB, "deposits", { us: 0, kr: 0 });
      const outflows = await getState(env.DB, "outflows", { us: 0, kr: 0 });
      // [회계 재설계] TWR 상태 — 프론트가 실시간 평가액으로 마지막 구간을 마감해 수익률% 산출
      const twr = {
        us: await getState(env.DB, "twr:us", null),
        kr: await getState(env.DB, "twr:kr", null)
      };
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
      const lastHeartbeat = await getState(env.DB, "last_heartbeat", null);

      const allSymbols = cfg.usTickers.concat(cfg.krTickers);
      const quotes = [];
      // [V10 HOTFIX] 종목 수백 개를 getState로 하나씩 읽으면 응답 지연→503/타임아웃 발생.
      //   quote: 전체를 단일 쿼리로 로드 후 메모리에서 매핑한다.
      const quoteRowMap = {};
      try {
        const qrows = await env.DB.prepare("SELECT k, v FROM state WHERE k LIKE 'quote:%'").all();
        for (const r of (qrows.results || [])) {
          try { quoteRowMap[r.k.slice(6)] = JSON.parse(r.v); } catch (e) {}
        }
      } catch (e) {}
      for (const sym of allSymbols) {
        const q = quoteRowMap[sym];
        const base = {
          symbol: sym,
          name: NAME_MAP[sym] || sym,
          rank: MCAP_RANK[sym] || 99999,
          isEtf: ETF_SYMBOLS.has(sym),
          market: (sym.endsWith(".KS") || sym.endsWith(".KQ")) ? "kr" : "us"
        };
        // [V11 FIX] quote 가 아직 없는 종목도 노출(가격 대기 상태). 기존엔 quote 있는
        //   종목만 push 해서 v7 차단 + 라운드로빈 미도달 종목이 watchlist 에서 통째로
        //   누락(미국 26개 / 한국 28개만 보이던 증상)됐다.
        if (q) {
          quotes.push(Object.assign(base, q));
        } else {
          quotes.push(Object.assign(base, { price: null, prevClose: null, dayPct: null, pending: true }));
        }
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
        outflows: outflows,
        twr: twr,
        sectorGroups: sectorGroups,
        signalTypes: signalTypes,
        positions: {
          us: posUS.list,          // [V8] array of (symbol, strategy) rows
          kr: posKR.list,
          usBySymbol: posUS.bySymbol,
          krBySymbol: posKR.bySymbol
        },
        lastTick: lastTick, lastHeartbeat: lastHeartbeat, serverTime: Date.now(), cfg: cfg,
        marketStatus: {
          us: isMarketOpen("us") && (await isMarketTradingDay(env.DB, "us", env)) !== false,
          kr: isMarketOpen("kr") && (await isMarketTradingDay(env.DB, "kr", env)) !== false
        },
        tradingWindow: { us: isTradingWindow("us"), kr: isTradingWindow("kr") },
        llmDaily: {
          us: await getState(env.DB, "llm_daily:us", null),
          kr: await getState(env.DB, "llm_daily:kr", null)
        },
        marketContext: await getState(env.DB, "mkt_context", null),
        sectorNews: await getState(env.DB, "sector_news_sentiment", null),
        watchlist: quotes,
        indices: indices,
        signalStats: signalStats,
        strategies: STRATEGIES,   // [V8]
        visionPredictions: await getState(env.DB, "vision_predictions", {}),
        // [강제 락 & 사용량] UI 표시용
        forceLock: !!cfg.forceLock,
        usageState: await (async () => {
          try {
            const us = await getUsageState(env.DB);
            const lim = Object.assign({}, USAGE_LIMITS_DEFAULT, (cfg.usageLimits || {}));
            const rr = (us.data.requests || 0) / Math.max(1, lim.monthlyRequests);
            const cr = (us.data.cpuMs || 0) / Math.max(1, lim.monthlyCpuMs);
            return { data: us.data, limits: { monthlyRequests: lim.monthlyRequests, monthlyCpuMs: lim.monthlyCpuMs }, reqPct: (rr*100).toFixed(1), cpuPct: (cr*100).toFixed(1), worstPct: (Math.max(rr,cr)*100).toFixed(1), shutdownAt: lim.shutdownAt, warnAt: lim.warnAt };
          } catch(e) { return null; }
        })()
      }, { headers: cors });
    }

    // 하위 호환 엔드포인트 유지
    if (path === "/api/watchlist") {
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const allSymbols = cfg.usTickers.concat(cfg.krTickers);
      const quotes = [];
      const _qmap = {};
      try {
        const _qr = await env.DB.prepare("SELECT k, v FROM state WHERE k LIKE 'quote:%'").all();
        for (const r of (_qr.results || [])) { try { _qmap[r.k.slice(6)] = JSON.parse(r.v); } catch(e){} }
      } catch(e){}
      for (const sym of allSymbols) {
        const q = _qmap[sym];
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
    if (path === "/api/daily-stats") {
      const days = Math.max(1, Math.min(30, parseInt(url.searchParams.get("days") || "7", 10)));
      let rows = [];
      try {
        await ensureSchema(env.DB);
        const res = await env.DB.prepare("SELECT day_key, signals, errors, trades FROM daily_stats ORDER BY day_key DESC LIMIT ?").bind(days).all();
        rows = (res.results || []).slice().reverse();   // 오래된→최신
      } catch (e) {}
      return Response.json({ today: kstTradingDayKey(new Date()), stats: rows }, { headers: cors });
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
    // === [강제 락] 월 한도 초과 방지 강제 락/해제 API ===
    //   웹 추가결제 방지: 락 걸면 cron invocation이 즉시 차단됨 (isUsageShutdown 체크)
    //   POST /api/force-lock  → 엔진 전체 강제 차단
    //   POST /api/force-unlock → 강제 차단 해제
    if (path === "/api/force-lock" && request.method === "POST") {
      const cur = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      cur.forceLock = true;
      await setState(env.DB, "cfg", cur);
      const ts = new Date().toISOString();
      await setState(env.DB, "force_lock_ts", ts);
      await log(env.DB, "WARN", null, "[FORCE LOCK] 강제 락 ON — 모든 cron 사이클 차단 at " + ts);
      return Response.json({ ok: true, forceLock: true, lockedAt: ts }, { headers: cors });
    }
    if (path === "/api/force-unlock" && request.method === "POST") {
      const cur = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      cur.forceLock = false;
      await setState(env.DB, "cfg", cur);
      await log(env.DB, "INFO", null, "[FORCE LOCK] 강제 락 OFF — 정상 운영 재개");
      return Response.json({ ok: true, forceLock: false }, { headers: cors });
    }
    // 사용량 상태 조회 (UI 표시용)
    if (path === "/api/usage" && request.method === "GET") {
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const usageState = await getUsageState(env.DB);
      const lim = Object.assign({}, USAGE_LIMITS_DEFAULT, (cfg.usageLimits || {}));
      const reqRatio = (usageState.data.requests || 0) / Math.max(1, lim.monthlyRequests);
      const cpuRatio = (usageState.data.cpuMs || 0) / Math.max(1, lim.monthlyCpuMs);
      const lockTs = await getState(env.DB, "force_lock_ts", null);
      return Response.json({
        ok: true,
        forceLock: !!cfg.forceLock,
        lockedAt: lockTs,
        usage: usageState.data,
        limits: lim,
        ratios: { requests: reqRatio, cpu: cpuRatio, worst: Math.max(reqRatio, cpuRatio) },
        pct: { requests: (reqRatio * 100).toFixed(1), cpu: (cpuRatio * 100).toFixed(1), worst: (Math.max(reqRatio, cpuRatio) * 100).toFixed(1) },
        status: cfg.forceLock ? "FORCE_LOCKED" : (Math.max(reqRatio, cpuRatio) >= lim.shutdownAt ? "SHUTDOWN" : Math.max(reqRatio, cpuRatio) >= lim.warnAt ? "WARNING" : "OK")
      }, { headers: cors });
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
      await env.DB.prepare("DELETE FROM state WHERE k LIKE ?").bind("cash_ckpt:%").run();
      await env.DB.prepare("DELETE FROM positions").run();
      await env.DB.prepare("DELETE FROM logs").run();
      await env.DB.prepare("DELETE FROM state WHERE k NOT LIKE 'quote:%' AND k NOT LIKE 'index:%' AND k NOT LIKE 'daily:%'").run();
      await setState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR, cm: cfg.initialCashCM });
      await setState(env.DB, "deposits", { us: 0, kr: 0 });
      await setState(env.DB, "outflows", { us: 0, kr: 0 });
      // TWR 초기화 — 전체 삭제(NOT LIKE) 시 twr:* 키도 지워지지만, 명시적으로 초기 상태를 심어 둔다.
      await setState(env.DB, "twr:us", { factor: 1, lastValue: cfg.initialCashUS });
      await setState(env.DB, "twr:kr", { factor: 1, lastValue: cfg.initialCashKR });
      await log(env.DB, "INFO", null, "RESET");
      return Response.json({ ok: true, cash: { us: cfg.initialCashUS, kr: cfg.initialCashKR, cm: cfg.initialCashCM } }, { headers: cors });
    }
    // [V24] 시장별(US/KR) 리셋 — 해당 시장 포지션/거래만 삭제, 현금만 초기금액 복원.
    if (path === "/api/reset_market" && request.method === "POST") {
      await ensureSchema(env.DB);
      const mkt = url.searchParams.get("market");
      if (mkt !== "us" && mkt !== "kr") {
        return Response.json({ ok: false, error: "market must be us or kr" }, { status: 400, headers: cors });
      }
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      // [V29] trades 삭제 = cash 자동 초기자본 복원 (단일 원장). positions도 삭제.
      await env.DB.prepare("DELETE FROM positions WHERE market = ?").bind(mkt).run();
      await env.DB.prepare("DELETE FROM trades WHERE market = ?").bind(mkt).run();
      await env.DB.prepare("DELETE FROM state WHERE k = ?").bind("cash_ckpt:" + mkt).run();
      const deposits = await getState(env.DB, "deposits", { us: 0, kr: 0, cm: 0 });
      deposits[mkt] = 0;
      await setState(env.DB, "deposits", deposits);
      const outflows = await getState(env.DB, "outflows", { us: 0, kr: 0, cm: 0 });
      outflows[mkt] = 0;
      await setState(env.DB, "outflows", outflows);
      const initial = mkt === "us" ? cfg.initialCashUS : cfg.initialCashKR;
      // 해당 시장 TWR 초기화
      await setState(env.DB, "twr:" + mkt, { factor: 1, lastValue: initial });
      await log(env.DB, "INFO", null, "[V29] RESET market=" + mkt + " (trades+positions cleared) cash=" + initial);
      return Response.json({ ok: true, market: mkt, cash: initial }, { headers: cors });
    }
    // [V24] 디버그 진단 — cash/포지션/평가액을 한눈에. 정합성 검증용.
    if (path === "/api/debug") {
      await ensureSchema(env.DB);
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const cash = await computeAllCash(env.DB, cfg);
      const out = { cash: cash, markets: {} };
      for (const mkt of ["us", "kr", "cm"]) {
        const positions = await getPositions(env.DB, mkt);
        let invested = 0, count = 0, dupCheck = {};
        const dups = [];
        for (const p of Object.values(positions)) {
          invested += (p.qty || 0) * (p.avg || 0);
          count++;
          const key = p.symbol + "::" + p.strategy;
          if (dupCheck[key]) dups.push(key);
          dupCheck[key] = true;
        }
        out.markets[mkt] = {
          cash: cash[mkt],
          positionCount: count,
          invested: Math.round(invested),
          total: Math.round((cash[mkt] || 0) + invested),
          duplicatePositions: dups
        };
      }
      // 락 상태도 노출 (겹친 사이클 진단용)
      try {
        const lock = await getState(env.DB, "lock:cycle", null);
        out.cycleLock = lock ? { until: lock.until, expired: lock.until < Date.now() } : null;
      } catch (e) {}
      return Response.json(out, { headers: cors });
    }
    if (path === "/api/reset_tickers" && request.method === "POST") {
      const current = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      current.usTickers = DEFAULT_US;
      current.krTickers = DEFAULT_KR;
      await setState(env.DB, "cfg", current);
      return Response.json({ ok: true, usTickers: DEFAULT_US, krTickers: DEFAULT_KR }, { headers: cors });
    }
    // [V8.8] 원자재 전용 초기화 — cm 포지션/거래만 삭제하고 cm 현금만 초기금액으로 복원.
    //   US/KR 자산·거래·로그는 일절 건드리지 않는다. (원자재 패널의 RESET 버튼용)
    if (path === "/api/reset_commodities" && request.method === "POST") {
      await ensureSchema(env.DB);
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      // cm 포지션/거래만 삭제
      await env.DB.prepare("DELETE FROM positions WHERE market = ?").bind("cm").run();
      await env.DB.prepare("DELETE FROM trades WHERE market = ?").bind("cm").run();
      await env.DB.prepare("DELETE FROM state WHERE k = ?").bind("cash_ckpt:cm").run();
      // cm 현금만 초기금액으로 복원 (us/kr는 그대로 보존)
      const cash = await computeAllCash(env.DB, cfg);
      cash.cm = cfg.initialCashCM;
      await setState(env.DB, "cash", cash);
      // [V8.9] 오늘 거래 마킹도 해제 → RESET 직후 "지금 실행"으로 바로 재매수 가능.
      try { await env.DB.prepare("DELETE FROM state WHERE k = ?").bind("cm_last_trade").run(); } catch (e) {}
      await log(env.DB, "INFO", null, "[CM] RESET — 원자재 포지션/거래 초기화, cm현금=" + cfg.initialCashCM);
      return Response.json({ ok: true, cash: { cm: cfg.initialCashCM } }, { headers: cors });
    }
    if (path === "/api/cash/add" && request.method === "POST") {
      // [회계 재설계] 입금/출금 처리.
      //   body: { us?: number, kr?: number } — 양수=입금, 음수=출금
      //   입금  → deposits(누적 입금액) 증가, cash 증가
      //   출금  → outflows(누적 출금액) 증가, cash 감소
      //   현금흐름 시점마다 TWR을 갱신해 수익률이 입출금에 흔들리지 않게 한다.
      const body = await request.json();
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const cash = await computeAllCash(env.DB, cfg);
      const deposits = await getState(env.DB, "deposits", { us: 0, kr: 0 });
      const outflows = await getState(env.DB, "outflows", { us: 0, kr: 0 });
      const addUs = Number(body.us) || 0;
      const addKr = Number(body.kr) || 0;
      if (addUs === 0 && addKr === 0) {
        return Response.json({ ok: false, error: "no amount" }, { status: 400, headers: cors });
      }
      const before = { us: cash.us, kr: cash.kr };
      // 출금 시 현금 부족 방지
      if ((addUs < 0 && cash.us + addUs < 0) || (addKr < 0 && cash.kr + addKr < 0)) {
        return Response.json({ ok: false, error: "insufficient cash", before: before, attempted: { us: addUs, kr: addKr } }, { status: 400, headers: cors });
      }
      // 현금흐름 직전 평가액 스냅샷 (TWR 구간 마감용) — deposits/outflows 갱신 전에 계산
      const valBeforeUs = addUs !== 0 ? await computePortfolioValue(env.DB, "us", cfg) : null;
      const valBeforeKr = addKr !== 0 ? await computePortfolioValue(env.DB, "kr", cfg) : null;
      // 입금/출금 누적 갱신
      if (addUs > 0) deposits.us = +((deposits.us || 0) + addUs).toFixed(2);
      else if (addUs < 0) outflows.us = +((outflows.us || 0) - addUs).toFixed(2);
      if (addKr > 0) deposits.kr = Math.round((deposits.kr || 0) + addKr);
      else if (addKr < 0) outflows.kr = Math.round((outflows.kr || 0) - addKr);
      // deposits/outflows가 바뀌면 cash 체크포인트는 무효 → 삭제 후 재계산
      try { await env.DB.prepare("DELETE FROM state WHERE k LIKE 'cash_ckpt:%'").run(); } catch (e) {}
      await setState(env.DB, "deposits", deposits);
      await setState(env.DB, "outflows", outflows);
      // TWR 구간 마감 (흐름 직전 평가액 → factor 누적, lastValue 갱신)
      if (valBeforeUs !== null) await applyCashflowToTWR(env.DB, "us", valBeforeUs, addUs, cfg);
      if (valBeforeKr !== null) await applyCashflowToTWR(env.DB, "kr", valBeforeKr, addKr, cfg);
      const newCash = await computeAllCash(env.DB, cfg);
      const msg = "CASHFLOW US:" + (addUs >= 0 ? "+" : "") + addUs + " KR:" + (addKr >= 0 ? "+" : "") + addKr +
                  " (US " + before.us + "->" + newCash.us + ", KR " + before.kr + "->" + newCash.kr + ")";
      await log(env.DB, "INFO", null, msg);
      return Response.json({ ok: true, cash: newCash, deposits: deposits, outflows: outflows, before: before, added: { us: addUs, kr: addKr } }, { headers: cors });
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
    // [V13] 가격 전용 샤드 — 정규장 1분 갱신의 주역. 프론트가 모든 샤드 병렬 호출.
    if (path === "/api/refresh_shard") {
      const market = url.searchParams.get("market") || "us";
      const shard = parseInt(url.searchParams.get("shard") || "0", 10);
      if (market !== "us" && market !== "kr") return Response.json({ error: "invalid market" }, { status: 400, headers: cors });
      if (isNaN(shard) || shard < 0) return Response.json({ error: "invalid shard" }, { status: 400, headers: cors });
      const result = await refreshPriceShard(env, market, shard);
      return Response.json(Object.assign({ ok: true, market: market, kind: "price" }, result), { headers: cors });
    }
    // [V13] 일봉+지표 샤드 — 저빈도(수 분마다 한 바퀴). 프론트가 라운드로빈 호출.
    if (path === "/api/refresh_daily_shard") {
      const market = url.searchParams.get("market") || "us";
      const shard = parseInt(url.searchParams.get("shard") || "0", 10);
      if (market !== "us" && market !== "kr") return Response.json({ error: "invalid market" }, { status: 400, headers: cors });
      if (isNaN(shard) || shard < 0) return Response.json({ error: "invalid shard" }, { status: 400, headers: cors });
      const result = await refreshDailyShard(env, market, shard);
      return Response.json(Object.assign({ ok: true, market: market, kind: "daily" }, result), { headers: cors });
    }
    // [V13] 샤드 메타 — 프론트가 가격/일봉 샤드 개수를 알기 위함.
    if (path === "/api/shard_meta") {
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      return Response.json({
        priceShardSize: PRICE_SHARD_SIZE,
        dailyShardSize: DAILY_SHARD_SIZE,
        us: {
          tickers: cfg.usTickers.length,
          priceShards: shardCount(cfg.usTickers, PRICE_SHARD_SIZE),
          dailyShards: shardCount(cfg.usTickers, DAILY_SHARD_SIZE)
        },
        kr: {
          tickers: cfg.krTickers.length,
          priceShards: shardCount(cfg.krTickers, PRICE_SHARD_SIZE),
          dailyShards: shardCount(cfg.krTickers, DAILY_SHARD_SIZE)
        }
      }, { headers: cors });
    }
    if (path === "/api/migrate" && request.method === "POST") {
      await ensureSchema(env.DB);
      return Response.json({ ok: true, message: "schema ensured" }, { headers: cors });
    }

    // === [COMMODITY] 원자재 상태 조회 ===
    if (path === "/api/commodities") {
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const cash = await computeAllCash(env.DB, cfg);
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

    // === [BOND] 국채 슬리브 조회 — 미국(bdus)+한국(bdkr) + 금리 ===
    if (path === "/api/bonds") {
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const cash = await computeAllCash(env.DB, cfg);
      // [FIX] 장 마감 중엔 runAltSleeveCycle이 시세를 안 받아 watchlist가 빔(TLT만 marketContext가 채움).
      //   저장된 quote 중 누락/오래된(15분+) 게 있으면 온디맨드 1배치로 보충(예산 안전: 캐시 5분).
      let onDemand = {};
      try {
        const cacheTs = await getState(env.DB, "bonds_quote_fetch_ts", 0);
        const stale = !cacheTs || (Date.now() - cacheTs) > 5 * 60 * 1000;
        // 누락 quote 점검
        let anyMissing = false;
        for (const s of BOND_SYMBOLS) { const q = await getState(env.DB, "quote:" + s, null); if (!q || q.price == null) { anyMissing = true; break; } }
        if (stale || anyMissing) {
          resetFetchBudget(40);
          const u = await getUsageState(env.DB);
          const lim = Object.assign({}, USAGE_LIMITS_DEFAULT, cfg.usageLimits || {});
          const ratio = Math.max((u.data.requests||0)/Math.max(1,lim.monthlyRequests), (u.data.cpuMs||0)/Math.max(1,lim.monthlyCpuMs));
          if (ratio < (cfg.altEnrichMaxUsageRatio != null ? cfg.altEnrichMaxUsageRatio : 0.82)) {
            onDemand = await fetchBatchQuotes(BOND_SYMBOLS.concat(TREASURY_YIELD_SYMBOLS), { maxFallback: BOND_SYMBOLS.length + TREASURY_YIELD_SYMBOLS.length, DB: env.DB });
            // 보충된 국채 시세는 quote 저장(다음 사이클·매매에서 재사용)
            for (const s of BOND_SYMBOLS) {
              const q = onDemand[s];
              if (q && q.price != null) await saveQuoteAlt(env.DB, (BOND_KR_SYMBOLS.indexOf(s) >= 0 ? "bdkr" : "bdus"), { symbol: s, price: q.price, prevClose: q.prevClose, dayPct: q.dayPct }, true);
            }
            await setState(env.DB, "bonds_quote_fetch_ts", Date.now());
          }
        }
      } catch (e) {}
      const out = { us: { cash: (typeof cash.bdus === "number" ? cash.bdus : cfg.initialCashBDUS), initialCash: cfg.initialCashBDUS, positions: [], watchlist: [] },
                    kr: { cash: (typeof cash.bdkr === "number" ? cash.bdkr : cfg.initialCashBDKR), initialCash: cfg.initialCashBDKR, positions: [], watchlist: [] } };
      const groups = [{ k: "bdus", list: BONDS_US, side: out.us }, { k: "bdkr", list: BONDS_KR, side: out.kr }];
      for (const g of groups) {
        const rawPos = await getPositions(env.DB, g.k);
        for (const key in rawPos) {
          const p = rawPos[key];
          g.side.positions.push({ symbol: p.symbol, name: (BOND_META[p.symbol] && BOND_META[p.symbol].name) || p.symbol, qty: p.qty, avg: p.avg, opened_ts: p.opened_ts, meta: p.meta || {}, stopPrice: (p.meta && p.meta.stopPrice) || null, peakPrice: (p.meta && p.meta.peakPrice) || null });
        }
        for (const b of g.list) {
          let q = await getState(env.DB, "quote:" + b.symbol, null);
          // 온디맨드로 막 받은 값이 있으면 우선 반영(저장 누락 대비)
          if ((!q || q.price == null) && onDemand[b.symbol]) q = Object.assign({ ts: Date.now() }, onDemand[b.symbol]);
          g.side.watchlist.push(q ? Object.assign({ symbol: b.symbol, name: b.name }, q) : { symbol: b.symbol, name: b.name });
        }
      }
      // 국채 금리 — 온디맨드 우선, 없으면 캐시
      const yields = [];
      for (const y of TREASURY_YIELDS) {
        let q = onDemand[y.symbol];
        if (!q || q.price == null) { try { q = await getState(env.DB, "quote:" + y.symbol, null); } catch (e) {} }
        else { try { await setState(env.DB, "quote:" + y.symbol, Object.assign({ ts: Date.now() }, q)); } catch (e) {} }
        yields.push({ symbol: y.symbol, label: y.label, name: y.name, rate: (q && q.price != null) ? q.price : null, dayPct: (q && typeof q.dayPct === "number") ? q.dayPct : null, prevClose: (q && q.prevClose != null) ? q.prevClose : null });
      }
      return Response.json({ realtime: cfg.altRealtime !== false, tradeTime: "실시간(장중)", us: out.us, kr: out.kr, yields: yields, symbols: { us: BONDS_US, kr: BONDS_KR } }, { headers: cors });
    }

    // === [BOND] 국채 슬리브 수동 실행 (테스트) — ?key=bdus|bdkr|cm ===
    if (path === "/api/bonds/run" && request.method === "POST") {
      const k = url.searchParams.get("key") || "bdus";
      await runAltSleeveCycle(env, k);
      return Response.json({ ok: true, key: k, ts: Date.now() }, { headers: cors });
    }

    // === [COMMODITY] 원자재 사이클 수동 실행 ===
    //   ?force=1 이면 16:00 KST가 아니어도 매매까지 강제 실행 (테스트용).
    //   force 없으면 시세만 갱신(트리거 시각이 아니므로 매매 스킵).
    if (path === "/api/commodities/run" && request.method === "POST") {
      const force = url.searchParams.get("force") === "1";
      await runCommodityCycle(env, force);
      return Response.json({ ok: true, forced: force, ts: Date.now() }, { headers: cors });
    }

    // === [HOLIDAY] 휴장 판정 캐시 재설정 — 오늘 캐시 삭제 후 LLM 재판정 ===
    if (path === "/api/holiday/recheck" && request.method === "POST") {
      const DB = env.DB;
      const out = {};
      for (const mkt of ["us", "kr"]) {
        const today = localDateStr(mkt);
        if (!today) { out[mkt] = "no-date"; continue; }
        try { await DB.prepare("DELETE FROM state WHERE k = ?").bind("market_open:" + mkt + ":" + today).run(); } catch (e) {}
        const res = await isMarketTradingDay(DB, mkt, env);
        out[mkt] = (res === null ? "UNKNOWN" : (res ? "OPEN" : "CLOSED"));
      }
      return Response.json({ ok: true, result: out, ts: Date.now() }, { headers: cors });
    }

    // === [FX] 환율 조회 ===
    if (path === "/api/fx") {
      const fx = await getState(env.DB, "fx", null);
      if (!fx) return Response.json({ empty: true, pairs: FX_PAIRS }, { headers: cors });
      return Response.json(Object.assign({ pairs: FX_PAIRS }, fx), { headers: cors });
    }

    // === [V58 신규] OHLC 캔들 조회 — 프론트 기술적 분석(패턴 감지)용 ===
    //   ?symbol=AAPL&range=3mo&interval=1d  · 10분 캐시(D1 state)로 서브리퀘스트 보호
    if (path === "/api/chart") {
      const sym = (url.searchParams.get("symbol") || "").trim();
      if (!sym || sym.length > 16 || !/^[A-Za-z0-9.^=\-]+$/.test(sym)) {
        return Response.json({ error: "bad symbol" }, { status: 400, headers: cors });
      }
      const range = ["1mo","3mo","6mo","1y"].indexOf(url.searchParams.get("range")) >= 0 ? url.searchParams.get("range") : "3mo";
      const ck = "chart:" + sym + ":" + range;
      const cached = await getState(env.DB, ck, null);
      if (cached && cached.ts && (Date.now() - cached.ts) < 10 * 60 * 1000) {
        return Response.json(cached, { headers: cors });
      }
      try {
        const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?interval=1d&range=" + range);
        const result = j && j.chart && j.chart.result && j.chart.result[0];
        if (!result) throw new Error("no data");
        const q = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
        const tsArr = result.timestamp || [];
        const candles = [];
        for (let i = 0; i < tsArr.length; i++) {
          const o = q.open && q.open[i], h = q.high && q.high[i], l = q.low && q.low[i], c = q.close && q.close[i], v = q.volume && q.volume[i];
          if (o == null || h == null || l == null || c == null) continue;
          candles.push({ t: tsArr[i], o: o, h: h, l: l, c: c, v: v || 0 });
        }
        const meta = result.meta || {};
        const payload = { symbol: sym, range: range, candles: candles, price: meta.regularMarketPrice || null, ts: Date.now() };
        try { await setState(env.DB, ck, payload); } catch (e) {}
        return Response.json(payload, { headers: cors });
      } catch (e) {
        if (cached) return Response.json(cached, { headers: cors }); // 스테일이라도 반환
        return Response.json({ error: String(e && e.message || e) }, { status: 502, headers: cors });
      }
    }

    // === [V58 신규] 경제지표 캘린더 — TradingView 공개 캘린더 프록시 (30분 캐시) ===
    //   미국+한국, 오늘 기준 -1일 ~ +7일. importance(-1~1)를 임팩트 점수로 사용.
    if (path === "/api/econ") {
      const ck = "econ_calendar";
      const cached = await getState(env.DB, ck, null);
      if (url.searchParams.get("force") !== "1" && cached && cached.ts && (Date.now() - cached.ts) < 30 * 60 * 1000) {
        return Response.json(cached, { headers: cors });
      }
      try {
        const now = new Date();
        const from = new Date(now.getTime() - 1 * 86400000).toISOString();
        const to = new Date(now.getTime() + 7 * 86400000).toISOString();
        const u = "https://economic-calendar.tradingview.com/events?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to) + "&countries=" + encodeURIComponent("US,KR");
        const r = await fetch(u, { headers: { "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" } });
        if (!r.ok) throw new Error("econ http " + r.status);
        const j = await r.json();
        const list = (j && (j.result || j.events || [])) || [];
        const events = list.map(function(e){
          return {
            id: e.id, title: e.title || e.indicator || "", country: e.country || "",
            date: e.date || null, period: e.period || "",
            actual: (e.actual != null ? e.actual : null),
            forecast: (e.forecast != null ? e.forecast : null),
            previous: (e.previous != null ? e.previous : null),
            unit: e.unit || "", importance: (typeof e.importance === "number" ? e.importance : 0)
          };
        }).filter(function(e){ return e.title && e.date; });
        const payload = { events: events, ts: Date.now() };
        try { await setState(env.DB, ck, payload); } catch (e2) {}
        return Response.json(payload, { headers: cors });
      } catch (e) {
        if (cached) return Response.json(cached, { headers: cors });
        return Response.json({ events: [], error: String(e && e.message || e), ts: Date.now() }, { headers: cors });
      }
    }
    // === [V60 신규] 내부자 거래 공시 — SEC EDGAR Form 4 최신 피드 (finviz Insider식, 15분 캐시) ===
    if (path === "/api/insider") {
      const ck = "insider_feed";
      const cached = await getState(env.DB, ck, null);
      if (url.searchParams.get("force") !== "1" && cached && cached.ts && (Date.now() - cached.ts) < 15 * 60 * 1000) {
        return Response.json(cached, { headers: cors });
      }
      try {
        const UA = "LUX-ENGINE/1.0 (contact: yryeolove@gmail.com)";
        const r = await fetch("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=80&output=atom",
          { headers: { "User-Agent": UA, "Accept": "application/atom+xml" } });
        if (!r.ok) throw new Error("sec http " + r.status);
        const xml = await r.text();
        const dec = function(s){ return String(s||"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim(); };
        // CIK→티커 역매핑 (기존 sec_cik_map 캐시 재사용)
        const cikMap = await getState(env.DB, "sec_cik_map", null);
        const rev = {};
        if (cikMap && cikMap.map) for (const t in cikMap.map) { if (!rev[cikMap.map[t]]) rev[cikMap.map[t]] = t; }
        const byAcc = {};
        const order = [];
        xml.split("<entry>").slice(1).forEach(function(en){
          const title = (en.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
          const linkM = en.match(/<link[^>]*href="([^"]+)"/);
          const upd = (en.match(/<updated>([^<]+)<\/updated>/) || [])[1] || "";
          const link = linkM ? dec(linkM[1]) : "";
          const accM = link.match(/(\d{10}-\d{2}-\d{6})/);
          const acc = accM ? accM[1] : link;
          const tm = dec(title).match(/^4(\/A)? - (.*?) \((\d{10})\) \((Issuer|Reporting|Filer)\)/);
          if (!tm) return;
          if (!byAcc[acc]) { byAcc[acc] = { date: upd, link: link, amended: !!tm[1] }; order.push(acc); }
          const rec = byAcc[acc];
          if (tm[4] === "Issuer") { rec.company = tm[2]; rec.cik = tm[3]; rec.ticker = rev[tm[3]] || null; }
          else { rec.insider = tm[2]; }
        });
        const filings = order.map(function(a){ return byAcc[a]; })
          .filter(function(f){ return f.company || f.insider; })
          .slice(0, 40);
        const payload = { filings: filings, ts: Date.now() };
        try { await setState(env.DB, ck, payload); } catch (e2) {}
        return Response.json(payload, { headers: cors });
      } catch (e) {
        if (cached) return Response.json(cached, { headers: cors });
        return Response.json({ filings: [], error: String(e && e.message || e), ts: Date.now() }, { status: 200, headers: cors });
      }
    }

    // === [V60 신규] 어닝스 캘린더 — Yahoo v7(crumb) 우선, 실패 시 Nasdaq 캘린더 폴백 (6시간 캐시) ===
    if (path === "/api/earnings") {
      const ck = "earnings_calendar_v2";  // [V9.1] epsType 필드 추가로 캐시 키 갱신(구 캐시 무효화)
      const cached = await getState(env.DB, ck, null);
      if (url.searchParams.get("force") !== "1" && cached && cached.ts && (Date.now() - cached.ts) < 6 * 60 * 60 * 1000) {
        return Response.json(cached, { headers: cors });
      }
      try {
        resetFetchBudget(20);
        const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
        const usTickers = (cfg.usTickers || []).filter(function(s){ return s.indexOf(".") === -1; });
        const watchSet = {};
        usTickers.forEach(function(s){ watchSet[s.toUpperCase()] = 1; });
        let items = [];
        // 1) Yahoo v7 quote — 워치리스트 종목의 earningsTimestamp 일괄 조회
        if (usTickers.length) {
          try {
            const auth = await getYahooAuth(env.DB);
            let u = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
              usTickers.map(function(s){ return encodeURIComponent(s); }).join(",") +
              "&fields=symbol,longName,shortName,earningsTimestamp,earningsTimestampStart,earningsTimestampEnd,epsForward";
            if (auth && auth.crumb) u += "&crumb=" + encodeURIComponent(auth.crumb);
            const j = await yahooFetch(u, auth && auth.cookie ? { "Cookie": auth.cookie } : null);
            const rows = (j && j.quoteResponse && j.quoteResponse.result) || [];
            rows.forEach(function(row){
              const ts0 = row.earningsTimestamp || row.earningsTimestampStart;
              if (!ts0) return;
              // [V9.1] epsForward는 "연간 선행 EPS" — 분기 예상 EPS가 아님. epsType으로 구분해
              //   프론트에서 '연간' 표시 (기존엔 분기 예상치처럼 보여 실제 발표치와 크게 어긋나 보였음).
              items.push({ symbol: row.symbol, name: row.longName || row.shortName || row.symbol,
                ts: ts0 * 1000, eps: (typeof row.epsForward === "number" ? row.epsForward : null),
                epsType: "fy", watch: true, src: "yahoo" });
            });
          } catch (e) {}
        }
        // 2) 폴백/보강: Nasdaq 공개 캘린더 — 향후 7거래일 시장 전체(주요 종목)
        if (items.length < 3) {
          const nUA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
            "Accept": "application/json", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/" };
          let fetched = 0;
          for (let d = 0; d < 10 && fetched < 7; d++) {
            const dt = new Date(Date.now() + d * 86400000);
            const dow = dt.getUTCDay();
            if (dow === 0 || dow === 6) continue;
            const ds = dt.toISOString().slice(0, 10);
            try {
              const r = await fetch("https://api.nasdaq.com/api/calendar/earnings?date=" + ds, { headers: nUA });
              fetched++;
              if (!r.ok) continue;
              const j2 = await r.json();
              const rows2 = (j2 && j2.data && j2.data.rows) || [];
              rows2.slice(0, 30).forEach(function(rw){
                if (!rw || !rw.symbol) return;
                items.push({ symbol: rw.symbol, name: rw.companyName || rw.name || rw.symbol,
                  ts: new Date(ds + "T12:00:00Z").getTime(),
                  when: rw.time || "", eps: (rw.epsForecast != null && rw.epsForecast !== "" ? rw.epsForecast : null),
                  epsType: "q", watch: !!watchSet[String(rw.symbol).toUpperCase()], src: "nasdaq" });
              });
            } catch (e) {}
          }
        }
        // 과거 3일~미래 30일만, 시간순
        const lo = Date.now() - 3 * 86400000, hi = Date.now() + 30 * 86400000;
        items = items.filter(function(it){ return it.ts >= lo && it.ts <= hi; });
        items.sort(function(a, b){ return a.ts - b.ts || (b.watch ? 1 : 0) - (a.watch ? 1 : 0); });
        items = items.slice(0, 80);
        const payload = { items: items, ts: Date.now() };
        try { await setState(env.DB, ck, payload); } catch (e2) {}
        return Response.json(payload, { headers: cors });
      } catch (e) {
        if (cached) return Response.json(cached, { headers: cors });
        return Response.json({ items: [], error: String(e && e.message || e), ts: Date.now() }, { status: 200, headers: cors });
      }
    }

    // === [V60 신규] 지표 발표 → 시장 영향 — 발표 당일 SPY/KOSPI 등락으로 임팩트 측정 (1시간 캐시) ===
    if (path === "/api/econ-impact") {
      const ck = "econ_impact";
      const cached = await getState(env.DB, ck, null);
      if (url.searchParams.get("force") !== "1" && cached && cached.ts && (Date.now() - cached.ts) < 60 * 60 * 1000) {
        return Response.json(cached, { headers: cors });
      }
      try {
        resetFetchBudget(10);
        // 1) 최근 14일 발표 완료된 지표 (TradingView 캘린더)
        let evs = [];
        try {
          const from = new Date(Date.now() - 14 * 86400000).toISOString();
          const to = new Date().toISOString();
          const u = "https://economic-calendar.tradingview.com/events?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to) + "&countries=" + encodeURIComponent("US,KR");
          const r = await fetch(u, { headers: { "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" } });
          if (r.ok) {
            const j = await r.json();
            evs = (j && (j.result || j.events || [])) || [];
          }
        } catch (e) {}
        if (!evs.length) {
          const ec = await getState(env.DB, "econ_calendar", null);
          evs = (ec && ec.events) || [];
        }
        // 2) 지수 일봉 (SPY / KOSPI)
        async function dayMoves(sym) {
          const out = {};
          try {
            const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?interval=1d&range=1mo");
            const res = j && j.chart && j.chart.result && j.chart.result[0];
            if (!res) return out;
            const tsArr = res.timestamp || [];
            const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
            let prev = null;
            for (let i = 0; i < tsArr.length; i++) {
              const c = closes[i];
              if (c == null) continue;
              const dkey = new Date(tsArr[i] * 1000).toISOString().slice(0, 10);
              if (prev != null && prev > 0) out[dkey] = (c - prev) / prev * 100;
              prev = c;
            }
          } catch (e) {}
          return out;
        }
        const spy = await dayMoves("SPY");
        const kospi = await dayMoves("^KS11");
        // 3) 발표 완료(actual≠null)·중요도 中 이상만 → 발표일 지수 등락 매칭
        const rows = [];
        evs.forEach(function(e){
          const actual = (e.actual != null ? e.actual : null);
          const imp = (typeof e.importance === "number" ? e.importance : 0);
          if (actual == null || !e.date || imp < 0) return;
          const dkey = String(e.date).slice(0, 10);
          const isKR = e.country === "KR";
          const mv = isKR ? kospi[dkey] : spy[dkey];
          let surprisePct = null;
          if (e.forecast != null && isFinite(e.forecast) && e.forecast !== 0) {
            surprisePct = (actual - e.forecast) / Math.abs(e.forecast) * 100;
          }
          rows.push({ title: e.title || e.indicator || "", country: e.country || "US", date: e.date,
            actual: actual, forecast: (e.forecast != null ? e.forecast : null), unit: e.unit || "",
            importance: imp, surprisePct: surprisePct,
            marketMove: (typeof mv === "number" ? mv : null),
            index: isKR ? "KOSPI" : "S&P500" });
        });
        rows.sort(function(a, b){ return new Date(b.date) - new Date(a.date) || b.importance - a.importance; });
        const payload = { rows: rows.slice(0, 40), ts: Date.now() };
        try { await setState(env.DB, ck, payload); } catch (e2) {}
        return Response.json(payload, { headers: cors });
      } catch (e) {
        if (cached) return Response.json(cached, { headers: cors });
        return Response.json({ rows: [], error: String(e && e.message || e), ts: Date.now() }, { status: 200, headers: cors });
      }
    }

    // === [V61 신규] TA 패턴 스크리너 — 전체 워치리스트를 finviz식 패턴 유형별로 분류 (30분 캐시) ===
    //   일봉 D1 캐시만 읽음(추가 외부 fetch 0). US는 티커, KR은 종목명(NAME_MAP)으로 라벨링.
    if (path === "/api/ta-screener") {
      const ck = "ta_screener";
      const cached = await getState(env.DB, ck, null);
      if (url.searchParams.get("force") !== "1" && cached && cached.ts && (Date.now() - cached.ts) < 30 * 60 * 1000) {
        return Response.json(cached, { headers: cors });
      }
      try {
        const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
        const syms = (cfg.usTickers || []).concat(cfg.krTickers || []);
        const groups = {};
        let scanned = 0, skipped = 0;
        for (const sym of syms) {
          const daily = await getState(env.DB, "daily:" + sym, null);
          if (!daily || !daily.closes || daily.closes.length < 30) { skipped++; continue; }
          const ta = taDetectPatterns(daily);
          scanned++;
          if (!ta || !ta.patterns.length) continue;
          const isKR = /\.(KS|KQ)$/.test(sym);
          const label = isKR ? (NAME_MAP[sym] || sym.replace(/\.(KS|KQ)$/, "")) : sym;
          ta.patterns.forEach(function(p){
            const g = groups[p.name] || (groups[p.name] = { name: p.name, dir: p.dir, kind: p.kind, items: [] });
            g.items.push({ symbol: sym, label: label, market: isKR ? "kr" : "us", score: ta.score });
          });
        }
        // 차트 패턴 우선, 그 안에서 종목 수 많은 순
        const list = Object.keys(groups).map(function(k){ return groups[k]; });
        list.sort(function(a, b){
          if (a.kind !== b.kind) return a.kind === "chart" ? -1 : 1;
          return b.items.length - a.items.length;
        });
        list.forEach(function(g){ g.items.sort(function(a, b){ return b.score - a.score; }); });
        const payload = { groups: list, scanned: scanned, skipped: skipped, total: syms.length, ts: Date.now() };
        try { await setState(env.DB, ck, payload); } catch (e2) {}
        return Response.json(payload, { headers: cors });
      } catch (e) {
        if (cached) return Response.json(cached, { headers: cors });
        return Response.json({ groups: [], error: String(e && e.message || e), ts: Date.now() }, { status: 200, headers: cors });
      }
    }

    // === [FX] 환율 즉시 갱신 ===
    if (path === "/api/fx/run" && request.method === "POST") {
      const payload = await runFxUpdate(env);
      return Response.json({ ok: true, data: payload, ts: Date.now() }, { headers: cors });
    }

    // === [NEWS] 섹터 뉴스 헤드라인 조회 ===
    if (path === "/api/news") {
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      let cached = await getState(env.DB, "sector_news_sentiment", null);
      if (url.searchParams.get("force") === "1" || !cached) {
        resetFetchBudget(80);
        cached = await updateSectorNewsSentiment(env.DB, cfg);
      }
      return Response.json(cached || { empty: true }, { headers: cors });
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

    // [V9.9] 현재 포지션 다운로드 (CSV)
    if (path === "/api/download/positions") {
      try {
        const allKeys = await env.DB.prepare("SELECT key FROM kv_store").all();
        const keys = (allKeys.results || []).map(r => r.key).filter(k => k.startsWith("positions:"));
        
        let positions = [];
        for (const key of keys) {
          const val = await getState(env.DB, key, null);
          if (!val) continue;
          const [_, market, symbol] = key.split(":");
          const pos = typeof val === "string" ? JSON.parse(val) : val;
          positions.push({ key, market, symbol, ...pos });
        }

        // 시장별, 종목별 정렬
        positions.sort((a, b) => a.market.localeCompare(b.market) || a.symbol.localeCompare(b.symbol));

        // CSV 생성: 시장,종목,수량,평단가,매수액,손익,손익율,상태
        let csv = "시장,종목,수량,평단가,매수액,손익(예상),손익율,최종매수시각,최종매도시각\n";
        positions.forEach(p => {
          const qty = p.qty || 0;
          const entryPx = p.entryPrice || 0;
          const amount = qty * entryPx;
          const pnl = (p.unrealizedPnL || p.pnl || 0).toFixed(2);
          const pnlPct = amount > 0 ? ((pnl / amount) * 100).toFixed(2) : "0.00";
          const buyTs = p.buyTs ? new Date(p.buyTs).toLocaleString('ko-KR') : "";
          const sellTs = p.sellTs ? new Date(p.sellTs).toLocaleString('ko-KR') : "";
          
          csv += `"${p.market}","${p.symbol}",${qty},${entryPx},${amount},${pnl},${pnlPct}%,"${buyTs}","${sellTs}"\n`;
        });

        return new Response(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="positions_${new Date().toISOString().split('T')[0]}.csv"`,
            ...cors
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ok:false, error: e.message}), {status:500, headers:cors});
      }
    }
    
    // [신규] 통합 다운로드 (거래 + 로그 + 요약)
    if (path === "/api/download/report") {
      const tradesRes = await env.DB.prepare("SELECT * FROM trades ORDER BY ts DESC").all();
      const logsRes = await env.DB.prepare("SELECT * FROM logs ORDER BY id DESC").all();
      const trades = tradesRes.results || [];
      const logs = logsRes.results || [];
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const cash = await computeAllCash(env.DB, cfg);
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
    // ── VISION AI: 일봉 데이터 조회 ──
    if (path === "/api/daily" && request.method === "GET") {
      const symbol = url.searchParams.get("symbol");
      if (!symbol) return Response.json({ error: "symbol required" }, { headers: cors });
      const daily = await getState(env.DB, "daily:" + symbol.toUpperCase(), null);
      if (!daily) return Response.json(null, { headers: cors });
      // closes, highs, lows, volumes, dates 만 반환 (용량 최소화)
      return Response.json({
        symbol: symbol.toUpperCase(),
        closes: daily.closes || [],
        highs:  daily.highs  || [],
        lows:   daily.lows   || [],
        dates:  daily.dates  || []
      }, { headers: cors });
    }

    // ── VISION AI: 예측 결과 저장 ──
    if (path === "/api/vision" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (body && typeof body === "object") {
        await setState(env.DB, "vision_predictions", body);
      }
      return Response.json({ ok: true }, { headers: cors });
    }

    // [V53] VISION AI: 진단 상태 — 작동 여부를 UI에서 한눈에 파악
    if (path === "/api/vision-status" && request.method === "GET") {
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const va = cfg.visionAI || {};
      const nowD = new Date();
      const todayKey = "vision_usage:" + nowD.toISOString().slice(0, 10);
      const todayUsage = (await getState(env.DB, todayKey, 0)) || 0;
      const MONTHLY_BUDGET = va.monthlyBudget || 10000;
      const DAILY_BUDGET = Math.floor(MONTHLY_BUDGET / 22 * 0.85);
      const preds = await getState(env.DB, "vision_predictions", {});
      const acc = (await getState(env.DB, "vision_accuracy", null)) || { hits: 0, total: 0 };
      let predCount = 0, lastTs = 0, upN = 0, downN = 0;
      for (const k in preds) {
        if (k.indexOf("__") === 0) continue;
        predCount++;
        const p = preds[k];
        if (p && p.ts > lastTs) lastTs = p.ts;
        if (p && p.pred === "up") upN++; else downN++;
      }
      return Response.json({
        enabled: !!va.enabled,
        hasApiKey: !!va.rfApiKey,
        todayUsage: todayUsage,
        dailyBudget: DAILY_BUDGET,
        monthlyBudget: MONTHLY_BUDGET,
        predCount: predCount, upCount: upN, downCount: downN,
        lastScanTs: lastTs || null,
        accuracy: { hits: Math.round(acc.hits), total: Math.round(acc.total), precision: acc.total > 0 ? acc.hits / acc.total : null },
        notRunningReason: !va.enabled ? "Settings에서 Vision AI가 꺼져 있음"
          : !va.rfApiKey ? "Roboflow API Key 미설정"
          : (todayUsage >= DAILY_BUDGET) ? "일일 예산 소진 (내일 자동 재개)"
          : null
      }, { headers: cors });
    }

    // [V53] VISION AI: 수동 전체 스캔 트리거 — cron 시각 게이트를 우회(force)해 즉시 1배치 실행
    // [V66 임시진단] 네이버 증권 API Workers 접근성 테스트
    if (path === "/api/naver-test" && request.method === "POST") {
      const out = {};
      try {
        const r1 = await fetch("https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:005930,000660,035420",
          { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com" } });
        out.polling = r1.status + " " + (await r1.text()).slice(0, 200).replace(/\n/g, "");
      } catch (e) { out.polling = "ERR " + e.message; }
      try {
        const r2 = await fetch("https://m.stock.naver.com/api/stock/005930/basic", { headers: { "User-Agent": "Mozilla/5.0" } });
        out.mstock = r2.status + " " + (await r2.text()).slice(0, 150).replace(/\n/g, "");
      } catch (e) { out.mstock = "ERR " + e.message; }
      return Response.json(out, { headers: cors });
    }
    // [V65 임시진단] Roboflow 호스트별 Workers 접근성 테스트
    if (path === "/api/rf-test" && request.method === "POST") {
      const cfg0 = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
      const key = (cfg0.visionAI || {}).rfApiKey;
      const out = {};
      const tiny = "Qk1GAAAAAAAAAD4AAAAoAAAAAgAAAAIAAAABAAEAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wD/AAAAwAAAAMAAAAA=";
      for (const host of ["serverless.roboflow.com", "classify.roboflow.com", "detect.roboflow.com", "infer.roboflow.com", "api.roboflow.com"]) {
        try {
          const r0 = await fetch("https://" + host + "/stock-updown-classifier/11?api_key=" + key,
            { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: tiny });
          let body = "";
          try { body = (await r0.text()).slice(0, 80).replace(/\n/g, " "); } catch (e) {}
          out[host] = r0.status + " " + body;
        } catch (e) { out[host] = "ERR " + e.message; }
      }
      return Response.json(out, { headers: cors });
    }
    // [V65] 브라우저 추론 결과 수신 — Roboflow가 Workers IP를 403 차단하므로
    //   추론은 브라우저가 수행하고 결과만 여기로 POST(검증 후 vision_predictions에 머지).
    //   엔진(거래)·UI 는 기존과 동일하게 이 state를 읽는다.
    if (path === "/api/vision-results" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch (e) { return Response.json({ ok: false, error: "bad json" }, { status: 400, headers: cors }); }
      if (!body || typeof body !== "object") return Response.json({ ok: false, error: "bad body" }, { status: 400, headers: cors });
      const keys = Object.keys(body).filter(k => k.indexOf("__") !== 0).slice(0, 120);
      const store = (await getState(env.DB, "vision_predictions", {})) || {};
      let merged = 0;
      const nowTs = Date.now();
      for (const sym of keys) {
        const v = body[sym];
        if (!v || typeof v !== "object") continue;
        if (v.pred !== "up" && v.pred !== "down") continue;
        const conf = Number(v.conf);
        if (!(conf > 0.06 && conf <= 1)) continue;
        if (!/^[A-Z0-9.\-=^]{1,12}$/i.test(sym)) continue;
        store[sym] = {
          pred: v.pred, conf: conf,
          upConf: Math.max(0, Math.min(1, Number(v.upConf) || 0)),
          downConf: Math.max(0, Math.min(1, Number(v.downConf) || 0)),
          predClose: (typeof v.predClose === "number" && v.predClose > 0) ? v.predClose : undefined,
          src: "browser", ts: nowTs
        };
        merged++;
      }
      if (merged > 0) await setState(env.DB, "vision_predictions", store);
      return Response.json({ ok: true, merged: merged }, { headers: cors });
    }
    if (path === "/api/vision-scan" && request.method === "POST") {
      let r = null;
      try { r = await runVisionScanBackend(env, true); } catch (e) {
        return Response.json({ ok: false, error: String(e && e.message || e) }, { headers: cors });
      }
      return Response.json(Object.assign({ ok: true }, r || {}), { headers: cors });
    }

    if (path === "/api/macro" && request.method === "GET") {
      const data = await getState(env.DB, "macro_data", null);
      return Response.json(data || { us: {}, kr: {}, updatedAt: null, empty: true }, { headers: cors });
    }
    // [V9 매크로] 경제지표 수동 갱신 트리거 (테스트/즉시갱신용)
    if (path === "/api/macro/run" && request.method === "POST") {
      const result = await runMacroUpdate(env, true);
      return Response.json(result, { headers: cors });
    }

    if (path === "/api/usage") {
      // [PAID 가드] 월 사용량 현황 — Workers Paid 한도 대비 비율
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const lim = Object.assign({}, USAGE_LIMITS_DEFAULT, cfg.usageLimits || {});
      const u = await getUsageState(env.DB);
      const reqRatio = (u.data.requests || 0) / Math.max(1, lim.monthlyRequests);
      const cpuRatio = (u.data.cpuMs || 0) / Math.max(1, lim.monthlyCpuMs);
      const worst = Math.max(reqRatio, cpuRatio);
      return Response.json({
        monthKey: u.mk,
        usage: u.data,
        limits: lim,
        ratios: {
          requests: +(reqRatio * 100).toFixed(2),
          cpuMs: +(cpuRatio * 100).toFixed(2),
          worst: +(worst * 100).toFixed(2)
        },
        shutdown: worst >= lim.shutdownAt,
        warn: worst >= lim.warnAt && worst < lim.shutdownAt,
        note: "셧다운 임계 " + (lim.shutdownAt * 100).toFixed(0) + "% / 경고 " +
              (lim.warnAt * 100).toFixed(0) + "%. cfg.usageLimits로 조정 가능."
      }, { headers: cors });
    }

    if (path === "/api/usage/reset") {
      // [관리] 월 사용량 강제 리셋 (테스트/오작동 복구용) — POST 권장이지만 GET 허용
      const u = await getUsageState(env.DB);
      const cleared = { requests: 0, cpuMs: 0, subreqs: 0, lastShutdown: 0, lastWarn: 0 };
      await setState(env.DB, "usage:" + u.mk, cleared);
      return Response.json({ ok: true, monthKey: u.mk, cleared: cleared }, { headers: cors });
    }

    if (path === "/api/diag") {
      const lock = await getState(env.DB, "lock:cycle", null);
      const lastTick = await getState(env.DB, "last_tick", null);
      const lastHeartbeat = await getState(env.DB, "last_heartbeat", null);
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const allSymbols = cfg.usTickers.concat(cfg.krTickers);
      const now = Date.now();
      // [FIX V8.8] 828개 종목을 개별 getState로 읽던 진단을 단일 쿼리 일괄 로드로 변경.
      //   (기존 방식은 diag 호출 자체가 수백 D1 쿼리라 매우 느렸음.)
      const quoteMap = {};
      try {
        const rows = await env.DB.prepare("SELECT k, v FROM state WHERE k LIKE 'quote:%'").all();
        for (const r of (rows.results || [])) {
          try { quoteMap[r.k.slice(6)] = JSON.parse(r.v); } catch (e) {}
        }
      } catch (e) {}
      let quoteCount = 0, freshCount = 0;
      const staleSyms = [];
      for (const sym of allSymbols) {
        const q = quoteMap[sym];
        if (q) {
          quoteCount++;
          if (q.ts && (now - q.ts) < 5 * 60 * 1000) freshCount++;
          else staleSyms.push({ sym: sym, ageMin: q.ts ? Math.round((now - q.ts) / 60000) : null });
        } else {
          staleSyms.push({ sym: sym, ageMin: null });
        }
      }
      // 원자재 quote 신선도도 점검
      let cmFresh = 0, cmTotal = 0;
      const cmStale = [];
      for (const sym of COMMODITY_SYMBOLS) {
        cmTotal++;
        const q = quoteMap[sym];
        if (q && q.ts && (now - q.ts) < 10 * 60 * 1000) cmFresh++;
        else cmStale.push({ sym: sym, ageMin: (q && q.ts) ? Math.round((now - q.ts) / 60000) : null });
      }
      const llmKr = await getState(env.DB, "llm_last_run:kr", null);
      const llmUs = await getState(env.DB, "llm_last_run:us", null);
      // [신규] 시장 컨텍스트 + 월간 사용량(여유분 모니터링)
      const mktCtxDiag = await getState(env.DB, "mkt_context", null);
      const sectorNewsDiag = await getState(env.DB, "sector_news_sentiment", null);
      let usageDiag = null;
      try {
        const u = await getUsageState(env.DB);
        const lim = Object.assign({}, USAGE_LIMITS_DEFAULT, cfg.usageLimits || {});
        const reqR = (u.data.requests || 0) / Math.max(1, lim.monthlyRequests);
        const cpuR = (u.data.cpuMs || 0) / Math.max(1, lim.monthlyCpuMs);
        usageDiag = {
          monthKey: u.mk,
          requests: u.data.requests || 0, cpuMs: u.data.cpuMs || 0,
          reqPct: +(reqR * 100).toFixed(2), cpuPct: +(cpuR * 100).toFixed(2),
          worstPct: +(Math.max(reqR, cpuR) * 100).toFixed(2),
          shutdownAtPct: (lim.shutdownAt || 0.9) * 100,
          enrichStopAtPct: ((cfg.marketContext && cfg.marketContext.enrichMaxUsageRatio) || 0.75) * 100,
          headroomPct: +((((lim.shutdownAt || 0.9)) - Math.max(reqR, cpuR)) * 100).toFixed(2)
        };
      } catch (e) {}
      return Response.json({
        now: now,
        lock: lock,
        lockAgeSec: lock && lock.until ? Math.round((lock.until - now) / 1000) : null,
        lastTick: lastTick,
        lastTickAgeMin: lastTick ? Math.round((now - lastTick) / 60000) : null,
        lastHeartbeat: lastHeartbeat,
        lastHeartbeatAgeMin: lastHeartbeat ? Math.round((now - lastHeartbeat) / 60000) : null,
        market: { us: isMarketOpen("us"), kr: isMarketOpen("kr") },
        tradingWindow: { us: isTradingWindow("us"), kr: isTradingWindow("kr") },
        usEtOffset: getUSEtOffset(new Date()),  // -4=EDT(서머타임) / -5=EST(겨울)
        quotes: { total: allSymbols.length, stored: quoteCount, freshUnder5min: freshCount },
        commodities: { total: cmTotal, freshUnder10min: cmFresh, stale: cmStale },
        llm: { kr: llmKr, us: llmUs },
        marketContext: mktCtxDiag,
        sectorNews: sectorNewsDiag ? { ts: sectorNewsDiag.ts, ageMin: Math.round((Date.now()-sectorNewsDiag.ts)/60000), scores: sectorNewsDiag.scores, scales: sectorNewsDiag.scales } : null,
        usage: usageDiag,
        staleOrMissing: staleSyms.slice(0, 20),
        cfg: { enabled: cfg.enabled, marketHoursOnly: cfg.marketHoursOnly, cycleLockTTL: cfg.cycleLockTTL }
      }, { headers: cors });
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not Found", { status: 404, headers: cors });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: cors });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// VISION AI BACKEND — Canvas 없이 순수 JS로 BMP 차트 생성 → Roboflow 예측
// ══════════════════════════════════════════════════════════════════════════

// 종가 배열로 픽셀 버퍼(RGB, top-to-bottom) 생성
function drawChartPixels(closes, width, height) {
  const buf = new Uint8Array(width * height * 3).fill(8); // 어두운 배경 #080808
  if (!closes || closes.length < 5) return buf;

  const n = Math.min(closes.length, 60);
  const data = closes.slice(-n);
  const minV = Math.min(...data);
  const maxV = Math.max(...data);
  const range = maxV - minV || minV * 0.01 || 1;
  const pad = Math.round(width * 0.06);
  const w = width - pad * 2;
  const h = height - pad * 2;

  function setPixel(x, y, r, g, b) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = (y * width + x) * 3;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
  }

  // thick: 선 두께(세로 오프셋). 가격선은 굵게 → 모델 인식률↑
  function drawLine(x0, y0, x1, y1, r, g, b, thick) {
    x0 = Math.round(x0); y0 = Math.round(y0);
    x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    const t = thick ? Math.floor(thick / 2) : 0;
    for (let steps = 0; steps < 1000; steps++) {
      for (let o = -t; o <= t; o++) setPixel(x0, y0 + o, r, g, b);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx)  { err += dx; y0 += sy; }
    }
  }

  const px = i => pad + (i / (data.length - 1)) * w;
  const py = v => pad + h - ((v - minV) / range) * h;

  // 그리드 (어두운 회색)
  for (let g = 1; g <= 3; g++) {
    const gy = Math.round(pad + (h / 4) * g);
    for (let x = pad; x < pad + w; x++) setPixel(x, gy, 30, 30, 30);
  }

  const isUp = data[data.length - 1] >= data[0];
  const [lr, lg, lb] = isUp ? [0, 230, 118] : [255, 23, 68];

  // 가격선 (3px 굵기 — 모델 입력 선명도 향상)
  for (let i = 1; i < data.length; i++) {
    drawLine(px(i - 1), py(data[i - 1]), px(i), py(data[i]), lr, lg, lb, 3);
  }

  // MA20 (황색)
  if (data.length >= 20) {
    let prevMx = null, prevMy = null;
    for (let i = 19; i < data.length; i++) {
      let sum = 0;
      for (let j = i - 19; j <= i; j++) sum += data[j];
      const ma = sum / 20;
      const mx = px(i), my = py(ma);
      if (prevMx !== null) drawLine(prevMx, prevMy, mx, my, 255, 193, 7, 2);
      prevMx = mx; prevMy = my;
    }
  }

  return buf;
}

// RGB 픽셀 버퍼 → BMP 바이너리 (Canvas 불필요)
function pixelsToBMP(pixels, width, height) {
  const rowSize = Math.ceil(width * 3 / 4) * 4; // 4바이트 정렬
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buf = new Uint8Array(fileSize);
  const view = new DataView(buf.buffer);

  // 파일 헤더
  buf[0] = 0x42; buf[1] = 0x4D;
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);

  // DIB 헤더
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelDataSize, true);

  // 픽셀 데이터 (BMP는 아래→위, BGR)
  for (let y = 0; y < height; y++) {
    const bmpRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 3;
      const dst = 54 + bmpRow * rowSize + x * 3;
      buf[dst] = pixels[src + 2]; buf[dst + 1] = pixels[src + 1]; buf[dst + 2] = pixels[src];
    }
  }
  return buf;
}

// Uint8Array → base64 (btoa는 Workers에서 지원)
function uint8ToBase64(bytes) {
  let b = '';
  for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i]);
  return btoa(b);
}

// ── SEC EDGAR 공시 스캔 ─────────────────────────────────────────────────────
//
//  [목적] 미국 종목의 최근 material 공시를 거래에 보수적으로 반영.
//    · 8-K(수시공시: 실적/M&A/경영진변동 등) 최근 2거래일 내 → 변동성·갭 리스크 큼
//      → 신규 진입 사이즈 0.5x로 보수화 (추세전략은 안정적 추세를 노리므로 이벤트 직후 회피)
//    · 10-Q/10-K(분기/연간 실적) 최근 1거래일 내 → 어닝 직후 → 동일 보수화
//
//  [무료/안전] SEC EDGAR API는 무료·무인증. User-Agent 헤더만 필수, 10req/s 제한.
//    · CIK 매핑(company_tickers.json)은 주 1회만 fetch → 캐시
//    · 실시간 불필요 → 거래 fetch와 안 겹치게 "미국 프리마켓 직전"(UTC 08:00~08:30, 분%5)만 실행
//    · cron당 최대 8종목, 24h 캐시 → subrequest 소량
//
// ────────────────────────────────────────────────────────────────────────────
async function fetchSecFilings(env) {
  const DB = env.DB;
  const now = Date.now();
  const nowD = new Date(now);
  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
  const sc = cfg.secFilings || {};
  if (sc.enabled === false) return;

  // 주말 스킵
  const dow = nowD.getUTCDay();
  if (dow === 0 || dow === 6) return;
  // 미국 프리마켓 직전(UTC 08:00~08:30)에만, 5분 간격 → 거래/타 fetch와 분리
  const utcMin = nowD.getUTCHours() * 60 + nowD.getUTCMinutes();
  if (utcMin < 480 || utcMin > 510) return;  // 08:00~08:30 UTC
  if (nowD.getUTCMinutes() % 5 !== 0) return;

  const UA = "LUX-ENGINE/1.0 (contact: yryeolove@gmail.com)";

  // CIK 매핑 (주 1회 캐시)
  let cikMap = await getState(DB, "sec_cik_map", null);
  if (!cikMap || !cikMap.map || (now - (cikMap.ts || 0)) > 7 * 86400000) {
    try {
      const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": UA } });
      if (r.ok) {
        const data = await r.json();
        const map = {};
        Object.keys(data).forEach(function(k){
          const c = data[k];
          if (c && c.ticker) map[c.ticker.toUpperCase()] = String(c.cik_str).padStart(10, "0");
        });
        cikMap = { map: map, ts: now };
        await setState(DB, "sec_cik_map", cikMap);
        await log(DB, "INFO", null, "[SEC] CIK 매핑 갱신: " + Object.keys(map).length + "종목");
      }
    } catch (e) {}
    if (!cikMap || !cikMap.map) return;
  }

  // 대상: 미국 티커만 (KR은 .KS/.KQ 제외)
  const usTickers = (cfg.usTickers || []).filter(function(s){ return s.indexOf(".") === -1; });
  const existing = await getState(DB, "sec_filings", {});
  const MAX_AGE = 24 * 3600000;
  const toScan = usTickers.filter(function(sym){
    const p = existing[sym];
    return (!p || (now - (p.ts || 0)) > MAX_AGE) && cikMap.map[sym.toUpperCase()];
  });
  if (toScan.length === 0) return;

  const batch = toScan.slice(0, 8);  // cron당 8종목
  const results = Object.assign({}, existing);
  let scanned = 0;

  for (const sym of batch) {
    const cik = cikMap.map[sym.toUpperCase()];
    if (!cik) continue;
    try {
      await new Promise(function(r){ setTimeout(r, 150); }); // 10req/s 안전
      const r = await fetch("https://data.sec.gov/submissions/CIK" + cik + ".json", { headers: { "User-Agent": UA } });
      if (!r.ok) continue;
      const d = await r.json();
      const recent = (d.filings && d.filings.recent) || {};
      const forms = recent.form || [];
      const dates = recent.filingDate || [];
      // 최근 공시들 중 8-K/10-Q/10-K 찾기
      let recent8K = null, recentEarnings = null;
      for (let i = 0; i < Math.min(forms.length, 20); i++) {
        const f = forms[i], fd = dates[i];
        if (!fd) continue;
        const ageDays = (now - new Date(fd + "T00:00:00Z").getTime()) / 86400000;
        if (f === "8-K" && recent8K == null && ageDays <= 3) recent8K = fd;
        if ((f === "10-Q" || f === "10-K") && recentEarnings == null && ageDays <= 2) recentEarnings = fd;
      }
      const filingType = recentEarnings ? "EARNINGS" : (recent8K ? "8-K" : null);
      const filingDate = recentEarnings || recent8K || null;
      if (!filingType) { results[sym] = { caution: false, ts: now }; scanned++; continue; }

      // [방향성] 무조건 보수화하지 않는다 — 공시 후 주가 반응으로 호재/악재 판단(Claude 불필요).
      //   공시 시점 종가 대비 현재 종가 변화율(postReturn)을 계산.
      //   상승=시장이 호재로 반영 → 보수화 안 함 / 하락=악재 → 축소 / 중립=불확실 → 약하게.
      const daily = await getState(DB, "daily:" + sym.toUpperCase(), null);
      let postReturn = null;
      if (daily && daily.closes && daily.closes.length > 5) {
        const ageCal = Math.round((now - new Date(filingDate + "T00:00:00Z").getTime()) / 86400000);
        const ageTd = Math.max(1, Math.round(ageCal * 5 / 7)); // 거래일 근사(주말 제외)
        const c = daily.closes;
        const before = c[c.length - 1 - ageTd];
        if (before > 0) postReturn = (c[c.length - 1] - before) / before * 100;
      }
      results[sym] = { caution: true, filingType: filingType, filingDate: filingDate, postReturn: postReturn, ts: now };
      scanned++;
    } catch (e) { continue; }
  }

  if (scanned > 0) {
    await setState(DB, "sec_filings", results);
    const cautionCount = Object.keys(results).filter(function(k){ return results[k].caution; }).length;
    await log(DB, "INFO", null, "[SEC] " + scanned + "종목 스캔 | 주의 " + cautionCount + "종목 | 큐 " + (toScan.length - scanned));
  }
}

// ── Vision AI 백엔드 스캔 ──────────────────────────────────────────────────
//
//  [설계 원칙]
//   1) 거래를 절대 막지 않는다
//       · 3분에 1번만 실행 → cron 2/3는 순수 거래, subrequest 충돌 회피
//       · cron당 최대 6 API 호출 → 거래 fetch budget 침범 안 함
//       · 전체 try/catch 격리 → Vision 실패해도 거래 영향 0
//
//   2) 거래 발생 시 콜 폭증 방지
//       · 예산 cap으로 보유 0~16개 무관 월 콜수 일정
//       · 매수 직후 GRACE(12h)는 재스캔 스킵
//
//   3) Roboflow 무료 Public(월 10,000콜) 한도 엄수
//       · 일일예산 = 월한도 ÷ 22 × 0.85, 일일 사용량 DB 추적, 주말 스킵, 429 즉시 중단
//
//  [성능 강화]
//   A) 거래 후보 우선 — 추세 정렬(MA20>MA50>MA200) 종목 = 실제 매수 후보.
//      이들을 최우선 + 3TF(20/40/60) 앙상블로 정밀 예측. 비추세는 trend 전략이
//      어차피 거르므로 1TF 저빈도. → 예산을 "거래에 실제 쓰이는 종목"에 집중.
//   B) 적중률 자기보정 — 예측 시점 종가를 기록, 재스캔 때 실제 등락과 대조해
//      롤링 적중률(precision)을 누적. evaluateAllStrategies가 이 값을 읽어
//      적중률 낮으면 Vision 영향을 자동 축소(50% 미만이면 무력화).
//   C) 입력 품질 — 차트 가격선 3px·MA 2px 굵기로 모델 인식률↑ (EMA 평활 병행)
//
// ────────────────────────────────────────────────────────────────────────────
async function runVisionScanBackend(env, force) {
  const DB = env.DB;
  const now = Date.now();
  const nowD = new Date(now);

  // ── (1) 거래 보호: 주말 스킵 + 3분에 1번만 (force=수동 트리거 시 시각 게이트 우회) ──
  if (!force) {
    const utcDay = nowD.getUTCDay();
    if (utcDay === 0 || utcDay === 6) return;
    if (nowD.getUTCMinutes() % 3 !== 0) return;
  }

  // [한도 보호] 무거운 외부 fetch가 몰리는 트리거 시각(원자재청산·환율·지표 갱신)엔
  //   Vision을 양보 → 같은 invocation의 Cloudflare subrequest 피크 회피. 다음 cron(3분 후) 재개.
  if (!force && (isCommodityTriggerTime() || isFxTriggerTime() || isMacroTriggerTime())) return;
  // [fetch 분산] SEC 스캔 시간대(UTC 08:00~08:30)도 양보 → 외부 fetch 완전 분리
  if (!force) {
    const _um = nowD.getUTCHours() * 60 + nowD.getUTCMinutes();
    if (_um >= 480 && _um <= 510) return;
  }

  const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));
  const va = cfg.visionAI || {};
  if (!va.enabled || !va.rfApiKey) return force ? { scanned: 0, callsUsed: 0, skipped: !va.enabled ? "disabled" : "no_api_key" } : undefined;

  const apiKey  = va.rfApiKey;
  const version = va.rfVersion || 7;
  const RF_PROJECT = "stock-updown-classifier";

  // ── 예산 설정 ──
  const MONTHLY_BUDGET = va.monthlyBudget || 10000;
  const SAFETY         = 0.85;
  const DAILY_BUDGET   = Math.floor(MONTHLY_BUDGET / 22 * SAFETY);
  const MAX_CALLS_CRON = 6;     // cron당 최대 콜 (3TF면 2종목, 1TF면 6종목)
  const DELAY_MS       = 300;
  const GRACE_MS       = 12 * 3600000;

  const todayKey = "vision_usage:" + nowD.toISOString().slice(0, 10);
  const todayUsage = (await getState(DB, todayKey, 0)) || 0;
  if (todayUsage >= DAILY_BUDGET) return force ? { scanned: 0, callsUsed: 0, skipped: "daily_budget" } : undefined;

  // ── 보유 종목 + 매수시각 ──
  const heldOpened = {};
  try {
    const rows = await DB.prepare("SELECT symbol, opened_ts FROM positions").all();
    for (const r of (rows.results || [])) {
      heldOpened[r.symbol] = Math.max(heldOpened[r.symbol] || 0, r.opened_ts || 0);
    }
  } catch (e) {}
  const isHeld = sym => Object.prototype.hasOwnProperty.call(heldOpened, sym);
  const heldCount = Object.keys(heldOpened).length;

  // ── [성능 A] 추세 정렬 판정 — 거래 후보 식별 ──
  //   MA20 > MA50 > MA200 정렬 = trend 전략의 매수 후보. 이들에 예산 집중.
  function isTrendCandidate(daily) {
    if (!daily || !daily.closes || daily.closes.length < 50) return false;
    const c = daily.closes;
    const ma20 = getMA(c, 20), ma50 = getMA(c, 50);
    if (ma20 == null || ma50 == null) return false;
    const ma200 = c.length >= 200 ? getMA(c, 200) : null;
    return ma200 != null ? (ma20 > ma50 && ma50 > ma200) : (ma20 > ma50);
  }

  const HELD_AGE   = 6  * 3600000;  // 보유: 6h
  const CAND_AGE   = 12 * 3600000;  // 추세후보: 12h (3TF라 콜 많음)
  const FLAT_AGE   = 72 * 3600000;  // 비추세: 72h (거래 안 쓰니 저빈도)

  const allSymbols = [...(cfg.usTickers || []), ...(cfg.krTickers || [])];
  const existing = await getState(DB, "vision_predictions", {});
  // [V65] 구파서 버그가 남긴 쓰레기 예측 정리 — conf≤6%·up/down 합≤5%는 무효 → 삭제(즉시 재스캔 대상化)
  for (const k in existing) {
    if (k.indexOf("__") === 0) continue;
    const e = existing[k];
    if (e && typeof e === "object" && (e.conf || 0) <= 0.06 && ((e.upConf || 0) + (e.downConf || 0)) < 0.05) {
      delete existing[k];
    }
  }

  // daily 캐시(우선순위 판정에 재사용 → 추가 쿼리 없음)
  const dailyCache = {};
  async function getDaily(sym) {
    if (dailyCache[sym] !== undefined) return dailyCache[sym];
    const d = await getState(DB, "daily:" + sym.toUpperCase(), null);
    dailyCache[sym] = d;
    return d;
  }

  // ── 우선순위 큐 구성 (보유 → 추세후보 → 비추세, 각 그룹 내 오래된 순) ──
  //   판정에 daily가 필요하나 829개 전부 읽으면 느림 → 후보군만 단계적 평가.
  //   1차: age 필터(메타만) → 2차: 통과분만 daily 읽어 추세 판정.
  const aged = allSymbols.filter(sym => {
    const p = existing[sym];
    const age = p ? now - (p.ts || 0) : Infinity;
    if (isHeld(sym)) {
      if (now - heldOpened[sym] < GRACE_MS) return false;
      return age > HELD_AGE;
    }
    // 비보유는 일단 가장 짧은 후보 주기 기준으로 통과시키고 2차에서 세분
    return age > CAND_AGE;
  });
  if (aged.length === 0) return force ? { scanned: 0, callsUsed: 0, skipped: "all_fresh" } : undefined;

  // aged 정렬: 보유 먼저 → 오래된 순 (제한된 평가 횟수 안에서 중요 종목 우선)
  aged.sort((a, b) => {
    const aH = isHeld(a) ? 0 : 1, bH = isHeld(b) ? 0 : 1;
    if (aH !== bH) return aH - bH;
    const aAge = existing[a] ? now - (existing[a].ts || 0) : Infinity;
    const bAge = existing[b] ? now - (existing[b].ts || 0) : Infinity;
    return bAge - aAge;
  });

  // 2차: 그룹/우선순위 계산 (daily 읽기를 MAX_EVAL로 제한 → D1 부하 제어)
  const scored = [];
  let evalCount = 0;
  const MAX_EVAL = 80;
  for (const sym of aged) {
    if (scored.length >= 40) break;
    if (evalCount >= MAX_EVAL) break;
    const p = existing[sym];
    const age = p ? now - (p.ts || 0) : Infinity;
    let group, tf;
    if (isHeld(sym)) { group = 0; tf = [20, 40, 60]; }       // 보유: 청산 정밀
    else {
      const d = await getDaily(sym); evalCount++;
      if (isTrendCandidate(d)) { group = 1; tf = [20, 40, 60]; } // 거래 후보: 정밀
      else {
        if (age <= FLAT_AGE) continue;                        // 비추세: 저빈도
        group = 2; tf = [60];
      }
    }
    scored.push({ sym, group, tf, age });
  }
  if (scored.length === 0) return force ? { scanned: 0, callsUsed: 0, skipped: "no_candidates" } : undefined;
  scored.sort((a, b) => a.group - b.group || b.age - a.age);

  // ── Roboflow 호출 ──
  async function rfCall(closes, win) {
    const pixels = drawChartPixels(closes.slice(-win), 224, 224);
    const bmp    = pixelsToBMP(pixels, 224, 224);
    const b64    = uint8ToBase64(bmp);
    // [V65 FIX] classify.roboflow.com이 Workers IP를 403(봇챌린지)으로 차단 →
    //   serverless.roboflow.com 신형 엔드포인트 + 브라우저 UA로 우회. 실패 시 구형으로 폴백.
    const _rfHeaders = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    };
    let resp = await fetch(
      `https://serverless.roboflow.com/${RF_PROJECT}/${version}?api_key=${apiKey}`,
      { method: "POST", headers: _rfHeaders, body: b64 }
    );
    if (resp.status === 403 || resp.status === 404) {
      resp = await fetch(
        `https://classify.roboflow.com/${RF_PROJECT}/${version}?api_key=${apiKey}`,
        { method: "POST", headers: _rfHeaders, body: b64 }
      );
    }
    if (resp.status === 429) return { rateLimited: true };
    if (!resp.ok) { let _t = ""; try { _t = (await resp.text()).slice(0, 120); } catch (e) {} return { fail: resp.status + ":" + _t }; }
    const d = await resp.json();
    // [V65 FIX] 신모델(v11+) 응답은 predictions가 "배열"([{class,confidence}]) + top/confidence.
    //   구형 파서가 객체 맵(p["up"].confidence)만 읽어 upC=downC=0 → 전종목 "up"/신뢰도 0~5% 버그.
    let upC = 0, downC = 0;
    const p = d.predictions;
    if (Array.isArray(p)) {
      for (const pr of p) {
        if (pr && pr.class === "up") upC = pr.confidence || 0;
        else if (pr && pr.class === "down") downC = pr.confidence || 0;
      }
    } else if (p && typeof p === "object") {
      upC   = (p["up"]   && p["up"].confidence)   || 0;
      downC = (p["down"] && p["down"].confidence) || 0;
    }
    // top/confidence가 있으면 우선 신뢰 (배열에 top 클래스만 담겨 와도 보완됨)
    if (d.top === "up"   && typeof d.confidence === "number") { upC = Math.max(upC, d.confidence); if (!downC) downC = 1 - d.confidence; }
    if (d.top === "down" && typeof d.confidence === "number") { downC = Math.max(downC, d.confidence); if (!upC) upC = 1 - d.confidence; }
    if (!upC && !downC) return { fail: "parse:" + JSON.stringify(d).slice(0, 120) };  // 파싱 실패 → 쓰레기 저장 방지
    return { pred: upC >= downC ? "up" : "down", upConf: upC, downConf: downC };
  }

  const results = Object.assign({}, existing);
  let scanned = 0, callsUsed = 0, rateLimited = false, lastFail = null;

  // ── [성능 B] 적중률 통계 로드 ──
  const acc = (await getState(DB, "vision_accuracy", null)) || { hits: 0, total: 0 };

  for (const item of scored) {
    if (rateLimited) break;
    if (todayUsage + callsUsed >= DAILY_BUDGET) break;
    if (callsUsed >= MAX_CALLS_CRON) break;
    try {
      const daily = await getDaily(item.sym);
      if (!daily || !daily.closes || daily.closes.length < 20) continue;
      const lastClose = daily.closes[daily.closes.length - 1];

      // [성능 B] 직전 예측 적중 검증 (재스캔 시점에 실제 등락과 대조)
      const prev = existing[item.sym];
      if (prev && typeof prev.predClose === "number" && prev.predClose > 0) {
        const moved = lastClose - prev.predClose;
        if (Math.abs(moved / prev.predClose) > 0.001) { // 0.1% 이상 움직였을 때만 채점
          const hit = (prev.pred === "up" && moved > 0) || (prev.pred === "down" && moved < 0);
          acc.total += 1;
          if (hit) acc.hits += 1;
          // 롤링 윈도우: 표본 과다 시 감쇠(최근 가중)
          if (acc.total > 500) { acc.hits *= 0.9; acc.total *= 0.9; }
        }
      }

      // 멀티프레임 앙상블 호출
      const frames = [];
      for (const win of item.tf) {
        if (todayUsage + callsUsed >= DAILY_BUDGET) break;
        if (callsUsed >= MAX_CALLS_CRON) break;
        if (daily.closes.length < win) continue;
        await new Promise(r => setTimeout(r, DELAY_MS));
        const r = await rfCall(daily.closes, win);
        callsUsed++;
        if (!r) continue;
        if (r.rateLimited) { rateLimited = true; break; }
        if (r.fail) { lastFail = r.fail; continue; }  // [V65 debug]
        frames.push(r);
      }
      if (frames.length === 0) continue;

      const upVotes   = frames.filter(f => f.pred === "up").length;
      const finalPred = upVotes >= frames.length - upVotes ? "up" : "down";
      const matched   = frames.filter(f => f.pred === finalPred);
      let conf = matched.reduce((s, f) => s + Math.max(f.upConf, f.downConf), 0) / matched.length;
      if (matched.length === item.tf.length && item.tf.length > 1) conf = Math.min(0.99, conf + 0.05); // 만장일치 보너스

      // [EMA 평활] 같은 방향 직전 예측과 혼합
      if (prev && prev.pred === finalPred && typeof prev.conf === "number") {
        conf = Math.min(0.99, prev.conf * 0.4 + conf * 0.6);
      }

      results[item.sym] = {
        pred: finalPred, conf: conf,
        upConf:   frames.reduce((s, f) => s + f.upConf,   0) / frames.length,
        downConf: frames.reduce((s, f) => s + f.downConf, 0) / frames.length,
        votes: { up: upVotes, down: frames.length - upVotes, total: frames.length },
        tier: item.group === 0 ? 1 : 2,
        predClose: lastClose,   // [성능 B] 다음 채점용
        ts: now
      };
      scanned++;
    } catch (e) { continue; }
  }

  // ── 저장 ──
  if (callsUsed > 0) {
    // [성능 B] 적중률 메타를 예측 객체에 동봉 → 거래 사이클이 함께 로드
    results.__accuracy = {
      hits: acc.hits, total: acc.total,
      precision: acc.total > 0 ? acc.hits / acc.total : null
    };
    await setState(DB, "vision_accuracy", { hits: acc.hits, total: acc.total });
    await setState(DB, todayKey, todayUsage + callsUsed);
    await setState(DB, "vision_predictions", results);
    const pct = Math.round((todayUsage + callsUsed) / DAILY_BUDGET * 100);
    const precStr = acc.total > 20 ? ` | 적중률 ${Math.round(acc.hits / acc.total * 100)}%(n=${Math.round(acc.total)})` : "";
    await log(DB, "INFO", null,
      `[VISION] ${scanned}종목 (${callsUsed}콜) | 일일 ${todayUsage + callsUsed}/${DAILY_BUDGET} (${pct}%) | 보유 ${heldCount}${precStr}`
    );
  }
  if (rateLimited) {
    await log(DB, "WARN", null, "[VISION] Roboflow 429 — 다음 cron 재개");
  }
  return { scanned: scanned, callsUsed: callsUsed, rateLimited: rateLimited, lastFail: lastFail, todayUsage: todayUsage + callsUsed, dailyBudget: DAILY_BUDGET };
}

export default {
  async fetch(request, env, ctx) { return handleRequest(request, env); },
  async scheduled(event, env, ctx) {
    // [FIX V8.8] 기존엔 runTradingCycle / refreshCommodityQuotes / runCommodityCycle을
    //   각각 ctx.waitUntil로 "동시" 실행했는데, 이들이 전역 __fetchBudget(yahoo fetch
    //   예산)을 공유하면서 서로 resetFetchBudget()로 카운터를 덮어쓰고 소진시켜
    //   가격/원자재 갱신이 산발적으로 실패했음(특히 정규장 1분 갱신).
    //   → 단일 promise 안에서 "순차" 실행해 각 사이클이 자기 예산을 온전히 쓰게 한다.
    const __cronStart = Date.now();
    __sleepAccumMs = 0;  // [실시간] invocation 시작마다 sleep 누적 초기화
    let __usageCalib = USAGE_LIMITS_DEFAULT.cpuCalibration;
    ctx.waitUntil((async () => {
      // [PAID 가드] Workers Paid 한도 90% 도달 시 모든 작업 차단 (초과 과금 방지)
      try {
        const _gcfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
        if (_gcfg.usageLimits && typeof _gcfg.usageLimits.cpuCalibration === "number") __usageCalib = _gcfg.usageLimits.cpuCalibration;
        if (await isUsageShutdown(env.DB, _gcfg)) {
          // 사용량 누적은 계속 — 셧다운 상태에도 cron 자체는 카운트
          try { await tickUsage(env.DB, __cronStart, __usageCalib, 0); } catch (e) {}
          return;
        }
      } catch (e) {}

      // [V19] 0) LLM 일일 분석 — 거래 사이클보다 "먼저, 단독" 실행.
      //   293종목 거래 사이클(115s)과 같은 invocation에서 돌리면 LLM 외부 API fetch가
      //   시간/subrequest 예산 경쟁에 밀려 타임아웃났다(회귀 반복). 여기서 깨끗한 예산으로
      //   먼저 끝내고, 그 다음에 무거운 거래 사이클을 돌린다. 실패해도 거래는 정상 진행.
      try {
        // [V9.8] LLM 외부 API fetch는 깨끗한 subrequest 예산에서 시작해야 한다.
        //   __fetchBudget는 모듈 전역이라 warm isolate에선 직전 invocation의 거래 사이클이
        //   남긴 used(최대 45)가 그대로 이월돼 collectLLMContext의 budgetedFetch가 굶는다.
        //   여기서 리셋해 컨텍스트 수집·LLM 호출이 예산 경쟁 없이 돈다.
        try { resetFetchBudget(400); } catch (e0) {}  // [PAID] LLM context 수집용 (Paid 여유 활용)
        const _cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
        if (_cfg.llmHybrid && _cfg.llmHybrid.enabled) {
          const cdMin = _cfg.llmHybrid.failCooldownMin || 15;
          // [V9.8] 선(先)차감 쿨다운: 호출 시작 전에 실패 쿨다운을 먼저 찍는다.
          //   LLM fetch가 매달려 invocation이 통째로 죽으면(markLLMFailed 도달 못함) 다음 cron이
          //   곧장 재시도해 매분 60s씩 폭주했다(로그에 2분 간격 타임아웃 반복). 미리 찍어두면
          //   최악의 경우에도 cdMin 동안은 재시도 안 함. 성공하면 ranToday 마킹이 우선해 더는 호출 안 함.
          if (isLLMTriggerWindow("kr") && !(await llmAlreadyRanToday(env.DB, "kr")) && !(await llmInFailCooldown(env.DB, "kr"))) {
            await markLLMFailed(env.DB, "kr", cdMin);
            const r = await runLLMDailyAnalysis(env, "kr");
            if (r && r.ok) await markLLMRanToday(env.DB, "kr");
          }
          if (isLLMTriggerWindow("us") && !(await llmAlreadyRanToday(env.DB, "us")) && !(await llmInFailCooldown(env.DB, "us"))) {
            await markLLMFailed(env.DB, "us", cdMin);
            const r = await runLLMDailyAnalysis(env, "us");
            if (r && r.ok) await markLLMRanToday(env.DB, "us");
          }
        }
      } catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] LLM analysis fail: " + e.message); } catch (e2) {} }

      // 1) 주식/지수 가격 갱신 + 거래 (가장 무거움)
      try { await runTradingCycle(env); }
      catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] trading cycle fail: " + e.message); } catch (e2) {} }

      // 2+3) [신규] alt 슬리브 실시간 거래 — 원자재(cm)·미국국채(bdus)·한국국채(bdkr)
      //   기존 "매분 시세갱신 + 16:00 1회 거래"를 실시간(매 사이클 장중 매매)으로 통합.
      //   [예산 안전] 월 사용량이 altEnrichMaxUsageRatio(코어 셧다운 0.90보다 낮음) 초과 시
      //   alt 슬리브는 주식(코어)보다 먼저 양보해 한도 여유분을 항상 보장.
      try {
        const _acfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
        let _altOk = true;
        if (_acfg.altRealtime === false) _altOk = false;
        if (_altOk) {
          try {
            const u = await getUsageState(env.DB);
            const lim = Object.assign({}, USAGE_LIMITS_DEFAULT, _acfg.usageLimits || {});
            const ratio = Math.max((u.data.requests || 0) / Math.max(1, lim.monthlyRequests), (u.data.cpuMs || 0) / Math.max(1, lim.monthlyCpuMs));
            if (ratio >= (_acfg.altEnrichMaxUsageRatio != null ? _acfg.altEnrichMaxUsageRatio : 0.82)) {
              _altOk = false;
              await log(env.DB, "WARN", null, "[ALT] 월 사용량 " + (ratio * 100).toFixed(1) + "% — alt 슬리브(원자재·국채) 양보(코어 거래 우선)");
            }
          } catch (e) {}
        }
        if (_altOk) {
          for (const _k of ["cm", "bdus", "bdkr"]) {
            try { await runAltSleeveCycle(env, _k); }
            catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] alt " + _k + " fail: " + e.message); } catch (e2) {} }
          }
        }
      } catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] alt sleeves fail: " + e.message); } catch (e2) {} }

      // 4) 환율 갱신 — [V9.1] 하루 1회(06:30) → 10분 주기 실시간화.
      //    기존엔 06:30 KST 1회만 갱신해 장중 내내 새벽 환율이 그대로 표시됐음(현실과 수 원대 차이).
      //    FX 휴장(주말) 제외, 마지막 갱신 후 10분 경과 시에만 실행 — 10쌍 fetch라 예산 부담 미미.
      try {
        if (isFxMarketOpen()) {
          const fxPrev = await getState(env.DB, "fx", null);
          const fxAge = (fxPrev && fxPrev.updatedAt) ? (Date.now() - fxPrev.updatedAt) : Infinity;
          if (fxAge > 10 * 60 * 1000) {
            try { await runFxUpdate(env); }
            catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] fx fail: " + e.message); } catch (e2) {} }
          }
        }
      } catch (e) {}

      // 5) 경제지표 갱신 (매일 07:00 KST) — runTradingCycle 내부에도 트리거가 있으나
      //    엔진 disabled 상태에서도 매크로는 갱신되도록 여기서도 안전하게 한 번 더 보장.
      if (isMacroTriggerTime()) {
        try { await runMacroUpdate(env); }
        catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] macro fail: " + e.message); } catch (e2) {} }
      }

      // 6) Vision AI 백엔드 스캔 — 매 cron에서 5개씩 처리 (24h 캐시, rate limit 안전)
      //    브라우저 없이도 차트 예측 결과가 항상 최신 상태 유지됨.
      try { await runVisionScanBackend(env); }
      catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] vision scan fail: " + e.message); } catch (e2) {} }

      // 7) SEC EDGAR 공시 스캔 — 미국 프리마켓 직전(UTC 08:00~08:30)에만, 거래 fetch와 분리
      //    최근 8-K/어닝 직후 미국 종목의 신규 진입을 보수화 (변동성 회피)
      try { await fetchSecFilings(env); }
      catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] sec fetch fail: " + e.message); } catch (e2) {} }

      // 8) [실시간] 분(分) 내 빠른 포지션 감시 — 남은 시간만큼 sleep 서브틱으로 손절/익절 점검
      try { await runFastWatch(env, __cronStart); }
      catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] fast watch fail: " + e.message); } catch (e2) {} }

      // [PAID 가드] 이번 invocation 사용량 누적 — request 1건 + (비sleep경과×보정) CPU 추정
      try { await tickUsage(env.DB, __cronStart, __usageCalib, __fetchBudget.used || 0); } catch (e) {}
    })());
  }
};

// [검증용 named export] Cloudflare Worker는 default export만 사용하므로 무해.
//   로컬 백테스트/단위검증 스크립트에서 핵심 함수를 직접 호출하기 위함.
export {
  DEFAULT_CFG, migrateCfgToMarkets, evaluateAllStrategies, evaluateTrendEntry, evaluateSnapEntry,
  evaluateSell, backtestSymbol, backtestStats, backtestStatsBySignal,
  getRSI, getMA, getATR, getNDayHigh, getStrategyRules, fetchDailyForBacktest,
  fetchMinuteBars, confirmIntradayEntry
};
