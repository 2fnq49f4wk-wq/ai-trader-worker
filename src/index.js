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
  "MRSH","ABNB","MMM","MDLZ","NOC",
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
  "XLE","IWM"
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
  "278470.KS","277810.KS","071050.KS","030200.KS","259960.KS",
  "047050.KS","010950.KS","047040.KS","005940.KS","016360.KS",
  "443060.KS","323410.KS","001440.KS","039490.KS","028050.KS",
  "036930.KQ","352820.KS","005830.KS","000880.KS","003230.KS",
  "003490.KS","007660.KS","000250.KS","062040.KS","058470.KQ",
  "064400.KS","267270.KS","000990.KS","180640.KS","161390.KS",
  "326030.KS","034220.KS","353200.KS","009830.KS","078930.KS",
  "039030.KQ","000100.KS","090430.KS","454910.KS","000500.KS",
  "028300.KQ","032640.KS","377300.KS","298380.KS","021240.KS",
  "241560.KS","336260.KS","066970.KQ","082740.KS","087010.KS",
  "240810.KQ","036570.KS","010060.KS","141080.KS","128940.KS",
  "052690.KS","029780.KS","004020.KS","138930.KS","271560.KS",
  "011790.KS","018880.KS","310210.KS","103590.KS","001040.KS",
  "004170.KS","022100.KS","178320.KS","088350.KS","450080.KS",
  "214370.KS","175330.KS","023530.KS","002380.KS","403870.KS",
  "108490.KS","095340.KQ","051900.KS","111770.KS","012510.KS",
  "004800.KS","489790.KS","011780.KS","251270.KS","011170.KS",
  "005850.KS","036460.KS","067310.KQ","064760.KS","014680.KS",
  "214150.KQ","035250.KS","357780.KQ","017800.KS","001450.KS",
  "145020.KQ","226950.KS","302440.KS","097950.KS","028670.KS",
  "031210.KS","375500.KS","084370.KS","005290.KS","214450.KS",
  "020150.KS","457190.KS","347850.KS","001720.KS","139130.KS",
  "383220.KS","009420.KS","263750.KQ","204320.KS","031980.KS",
  "237690.KQ","006360.KS","071970.KS","009970.KS","004990.KS",
  "098460.KQ","007340.KS","012750.KS","026960.KS","229640.KS",
  "003690.KS","257720.KS","139480.KS","103140.KS","011210.KS",
  "051600.KS","078600.KS","004370.KS","083650.KS","018670.KS",
  "069960.KS","000240.KS","120110.KS","008930.KS","008770.KS",
  "007070.KS","068760.KS","001430.KS","282330.KS","005440.KS",
  "112610.KS","030000.KS","035900.KQ","161890.KS","192820.KS",
  "081660.KS","000120.KS","140860.KQ","041510.KQ","077970.KS",
  "089030.KS","060370.KS","017960.KS","023590.KS","002790.KS",
  "298020.KS","005070.KS","001120.KS","462870.KS","361610.KS",
  "101490.KS","003540.KS","006040.KS","096530.KS","006280.KS",
  "039200.KS","003570.KS","001800.KS","069620.KS","232140.KS",
  "032350.KS","003530.KS","192080.KS","030610.KS","294870.KS",
  "007390.KS","073240.KS","007310.KS","004000.KS","012630.KS",
  "034230.KS","065350.KS","281740.KS","195940.KS","085660.KS",
  "000210.KS","204270.KS","003090.KS","000080.KS","100090.KS",
  "213420.KS","003240.KS","036830.KS","137400.KS","300720.KS",
  "280360.KS","185750.KS","009450.KS","005300.KS","000670.KS",
  "298050.KS","108320.KS","137310.KS","293490.KQ","248070.KS",
  "006120.KS","035760.KS","100840.KS","122870.KS","358570.KS",
  "348370.KS","071320.KS","253450.KS","004490.KS","285130.KS",
  "484870.KS","009240.KS","225570.KS","082270.KS","086900.KQ",
  "114090.KS","003030.KS","112040.KQ","001680.KS","328130.KQ",
  "005180.KS","376300.KS","067160.KS","039130.KS","018290.KS",
  "042000.KS","069500.KS","122630.KS","252670.KS","102110.KS",
  "233740.KS","251340.KS","114800.KS","229200.KS","091160.KS",
  "305720.KS","371460.KS","360750.KS","133690.KS","379800.KS",
  "117460.KS"
];

// ETF 심볼 셋 (레버리지 ETF 리스크 처리용)
const ETF_SYMBOLS = new Set([
  "SPY","QQQ","IVV","VOO","VTI",
  "SOXL","SOXS","TQQQ","SQQQ","SMH",
  "TLT","GLD","XLF","XLE","IWM",
  "069500.KS","122630.KS","252670.KS","102110.KS","233740.KS",
  "251340.KS","114800.KS","229200.KS","091160.KS","305720.KS",
  "371460.KS","360750.KS","133690.KS","379800.KS","117460.KS",
]);

// 레버리지/인버스 ETF (일일 변동성 2~3배 — ATR 사이징 자동 축소 대상)
const LEVERAGED_ETF = new Set(["SOXL","SOXS","TQQQ","SQQQ","122630.KS","252670.KS","233740.KS","251340.KS","114800.KS"]);

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
  "MRSH":"Marsh McLennan",
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
  "277810.KS":"레인보우로보틱스",
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
  "000250.KS":"삼천당제약",
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
  "298380.KS":"에이비엘바이오",
  "021240.KS":"코웨이",
  "241560.KS":"두산밥캣",
  "336260.KS":"두산퓨얼셀",
  "066970.KQ":"엘앤에프",
  "082740.KS":"한화엔진",
  "087010.KS":"펩트론",
  "240810.KQ":"원익IPS",
  "036570.KS":"NC",
  "010060.KS":"OCI홀딩스",
  "141080.KS":"리가켐바이오",
  "128940.KS":"한미약품",
  "052690.KS":"한전기술",
  "029780.KS":"삼성카드",
  "004020.KS":"현대제철",
  "138930.KS":"BNK금융지주",
  "271560.KS":"오리온",
  "011790.KS":"SKC",
  "018880.KS":"한온시스템",
  "310210.KS":"보로노이",
  "103590.KS":"일진전기",
  "001040.KS":"CJ",
  "004170.KS":"신세계",
  "022100.KS":"포스코DX",
  "178320.KS":"서진시스템",
  "088350.KS":"한화생명",
  "450080.KS":"에코프로머티",
  "214370.KS":"케어젠",
  "175330.KS":"JB금융지주",
  "023530.KS":"롯데쇼핑",
  "002380.KS":"KCC",
  "403870.KS":"HPSP",
  "108490.KS":"로보티즈",
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
  "064760.KS":"티씨케이",
  "014680.KS":"한솔케미칼",
  "214150.KQ":"클래시스",
  "035250.KS":"강원랜드",
  "357780.KQ":"솔브레인",
  "017800.KS":"현대엘리베이터",
  "001450.KS":"현대해상",
  "145020.KQ":"휴젤",
  "226950.KS":"올릭스",
  "302440.KS":"SK바이오사이언스",
  "097950.KS":"CJ제일제당",
  "028670.KS":"팬오션",
  "031210.KS":"서울보증보험",
  "375500.KS":"DL이앤씨",
  "084370.KS":"유진테크",
  "005290.KS":"동진쎄미켐",
  "214450.KS":"파마리서치",
  "020150.KS":"롯데에너지머티리얼즈",
  "457190.KS":"이수스페셜티케미컬",
  "347850.KS":"디앤디파마텍",
  "001720.KS":"신영증권",
  "139130.KS":"iM금융지주",
  "383220.KS":"F&F",
  "009420.KS":"한올바이오파마",
  "263750.KQ":"펄어비스",
  "204320.KS":"HL만도",
  "031980.KS":"피에스케이홀딩스",
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
  "257720.KS":"실리콘투",
  "139480.KS":"이마트",
  "103140.KS":"풍산",
  "011210.KS":"현대위아",
  "051600.KS":"한전KPS",
  "078600.KS":"대주전자재료",
  "004370.KS":"농심",
  "083650.KS":"비에이치아이",
  "018670.KS":"SK가스",
  "069960.KS":"현대백화점",
  "000240.KS":"한국앤컴퍼니",
  "120110.KS":"코오롱인더",
  "008930.KS":"한미사이언스",
  "008770.KS":"호텔신라",
  "007070.KS":"GS리테일",
  "068760.KS":"셀트리온제약",
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
  "089030.KS":"테크윙",
  "060370.KS":"LS마린솔루션",
  "017960.KS":"한국카본",
  "023590.KS":"다우기술",
  "002790.KS":"아모레퍼시픽홀딩스",
  "298020.KS":"효성티앤씨",
  "005070.KS":"코스모신소재",
  "001120.KS":"LX인터내셔널",
  "462870.KS":"시프트업",
  "361610.KS":"SK아이이테크놀로지",
  "101490.KS":"에스앤에스텍",
  "003540.KS":"대신증권",
  "006040.KS":"동원산업",
  "096530.KS":"씨젠",
  "006280.KS":"녹십자",
  "039200.KS":"오스코텍",
  "003570.KS":"SNT다이내믹스",
  "001800.KS":"오리온홀딩스",
  "069620.KS":"대웅제약",
  "232140.KS":"와이씨",
  "032350.KS":"롯데관광개발",
  "003530.KS":"한화투자증권",
  "192080.KS":"더블유게임즈",
  "030610.KS":"교보증권",
  "294870.KS":"IPARK현대산업개발",
  "007390.KS":"네이처셀",
  "073240.KS":"금호타이어",
  "007310.KS":"오뚜기",
  "004000.KS":"롯데정밀화학",
  "012630.KS":"HDC",
  "034230.KS":"파라다이스",
  "065350.KS":"신성델타테크",
  "281740.KS":"레이크머티리얼즈",
  "195940.KS":"HK이노엔",
  "085660.KS":"차바이오텍",
  "000210.KS":"DL",
  "204270.KS":"제이앤티씨",
  "003090.KS":"대웅",
  "000080.KS":"하이트진로",
  "100090.KS":"SK오션플랜트",
  "213420.KS":"덕산네오룩스",
  "003240.KS":"태광산업",
  "036830.KS":"솔브레인홀딩스",
  "137400.KS":"피엔티",
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
  "035760.KS":"CJ ENM",
  "100840.KS":"SNT에너지",
  "122870.KS":"와이지엔터테인먼트",
  "358570.KS":"지아이이노베이션",
  "348370.KS":"엔켐",
  "071320.KS":"지역난방공사",
  "253450.KS":"스튜디오드래곤",
  "004490.KS":"세방전지",
  "285130.KS":"SK케미칼",
  "484870.KS":"엠앤씨솔루션",
  "009240.KS":"한샘",
  "225570.KS":"넥슨게임즈",
  "082270.KS":"젬백스",
  "086900.KQ":"메디톡스",
  "114090.KS":"GKL",
  "003030.KS":"세아제강지주",
  "112040.KQ":"위메이드",
  "001680.KS":"대상",
  "328130.KQ":"루닛",
  "005180.KS":"빙그레",
  "376300.KS":"디어유",
  "067160.KS":"SOOP",
  "039130.KS":"하나투어",
  "018290.KS":"브이티",
  "042000.KS":"카페24",
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
  "117460.KS":"KODEX 에너지화학"
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
  "MRSH":146,
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
  "277810.KS":62,
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
  "000250.KS":83,
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
  "298380.KS":104,
  "021240.KS":105,
  "241560.KS":106,
  "336260.KS":107,
  "066970.KQ":108,
  "082740.KS":109,
  "087010.KS":110,
  "240810.KQ":111,
  "036570.KS":112,
  "010060.KS":113,
  "141080.KS":114,
  "128940.KS":115,
  "052690.KS":116,
  "029780.KS":117,
  "004020.KS":118,
  "138930.KS":119,
  "271560.KS":120,
  "011790.KS":121,
  "018880.KS":122,
  "310210.KS":123,
  "103590.KS":124,
  "001040.KS":125,
  "004170.KS":126,
  "022100.KS":127,
  "178320.KS":128,
  "088350.KS":129,
  "450080.KS":130,
  "214370.KS":131,
  "175330.KS":132,
  "023530.KS":133,
  "002380.KS":134,
  "403870.KS":135,
  "108490.KS":136,
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
  "064760.KS":149,
  "014680.KS":150,
  "214150.KQ":151,
  "035250.KS":152,
  "357780.KQ":153,
  "017800.KS":154,
  "001450.KS":155,
  "145020.KQ":156,
  "226950.KS":157,
  "302440.KS":158,
  "097950.KS":159,
  "028670.KS":160,
  "031210.KS":161,
  "375500.KS":162,
  "084370.KS":163,
  "005290.KS":164,
  "214450.KS":165,
  "020150.KS":166,
  "457190.KS":167,
  "347850.KS":168,
  "001720.KS":169,
  "139130.KS":170,
  "383220.KS":171,
  "009420.KS":172,
  "263750.KQ":173,
  "204320.KS":174,
  "031980.KS":175,
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
  "257720.KS":187,
  "139480.KS":188,
  "103140.KS":189,
  "011210.KS":190,
  "051600.KS":191,
  "078600.KS":192,
  "004370.KS":193,
  "083650.KS":194,
  "018670.KS":195,
  "069960.KS":196,
  "000240.KS":197,
  "120110.KS":198,
  "008930.KS":199,
  "008770.KS":200,
  "007070.KS":201,
  "068760.KS":202,
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
  "089030.KS":216,
  "060370.KS":217,
  "017960.KS":218,
  "023590.KS":219,
  "002790.KS":220,
  "298020.KS":221,
  "005070.KS":222,
  "001120.KS":223,
  "462870.KS":224,
  "361610.KS":225,
  "101490.KS":226,
  "003540.KS":227,
  "006040.KS":228,
  "096530.KS":229,
  "006280.KS":230,
  "039200.KS":231,
  "003570.KS":232,
  "001800.KS":233,
  "069620.KS":234,
  "232140.KS":235,
  "032350.KS":236,
  "003530.KS":237,
  "192080.KS":238,
  "030610.KS":239,
  "294870.KS":240,
  "007390.KS":241,
  "073240.KS":242,
  "007310.KS":243,
  "004000.KS":244,
  "012630.KS":245,
  "034230.KS":246,
  "065350.KS":247,
  "281740.KS":248,
  "195940.KS":249,
  "085660.KS":250,
  "000210.KS":251,
  "204270.KS":252,
  "003090.KS":253,
  "000080.KS":254,
  "100090.KS":255,
  "213420.KS":256,
  "003240.KS":257,
  "036830.KS":258,
  "137400.KS":259,
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
  "035760.KS":272,
  "100840.KS":273,
  "122870.KS":274,
  "358570.KS":275,
  "348370.KS":276,
  "071320.KS":277,
  "253450.KS":278,
  "004490.KS":279,
  "285130.KS":280,
  "484870.KS":281,
  "009240.KS":282,
  "225570.KS":283,
  "082270.KS":284,
  "086900.KQ":285,
  "114090.KS":286,
  "003030.KS":287,
  "112040.KQ":288,
  "001680.KS":289,
  "328130.KQ":290,
  "005180.KS":291,
  "376300.KS":292,
  "067160.KS":293,
  "039130.KS":294,
  "018290.KS":295,
  "042000.KS":296,
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
  "117460.KS":311
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
const STRATEGIES = ["swing", "momentum", "meanrev"];

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
    // [V9.6] 1.0→0.8: 더 보수적 사이징으로 손실 최소화
    riskPerTrade: 0.8,       // cash의 0.8% 손실 허용 (기존 1.0%)
    minRisk: 0.25,           // [V9.6] 0.3→0.25 (더 보수적 floor)
    maxRisk: 1.0,            // [V9.6] 1.2→1.0 (더 타이트한 cap)
    fallbackToLegacy: false,
    // [V9.6] 전략별 오버라이드
    byStrategy: {
      momentum: { riskPerTrade: 1.0, minRisk: 0.55, maxRisk: 1.2 }  // [V9.6] 보수화
    }
  },
  // === [V8.5] disabled signal 재평가 ===
  signalReviewDays: 30,      // 비활성화 후 N일 경과 시 재활성화 후보
  // === [V8.6 Hybrid] Claude LLM 일일 지시 ===
  llmHybrid: {
    enabled: true,            // [V11] 기본 ON — API 키만 등록되면 작동 (키 없으면 자동으로 V8.5 폴백)
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
    day: false,       // [V9.6.1] 분봉 데이터 없어서 비활성화 (현재 일봉+현재가만 수집)
    momentum: true,
    meanrev: true
  },
  // === [V8] 전략별 포지션 사이즈 (NEUTRAL base / BULL mult / BEAR mult) ===
  // [V8.1.9] base = 가용현금 대비 비율 (계산식이 cash[market] 기준으로 변경됨).
  //          한 거래 목표금액 KR ₩100~300만 / US $1~3k 범위로 클램프됨 (아래 sizingTargets).
  strategySizing: {
    day:      { base: 8, bullMult: 1.2, bearMult: 0.5, neutralMult: 0.3 },  // [V9.6] 15→8 (40% 감축)
    // [V9.2] meanrev 소폭 상향: base 25→27. 사용자 요청 반영하되 표본 1건뿐이라 최소폭만.
    meanrev:  { base: 27, bullMult: 1.2, bearMult: 1.4, neutralMult: 1.0 },
    // [V9.2] swing 소폭 상향: base 30→33. 사용자 요청(승률 우수 시 베팅 확대) 반영하되,
    //   표본 15건·전부 우상향장이라는 한계 고려해 +10%만.
    //   [V9.3] bearMult 0.8→0.6: base를 키운 만큼 하락장 쏠림 방어 강화.
    swing:    { base: 33, bullMult: 1.4, bearMult: 0.6, neutralMult: 1.0 },
    momentum: { base: 28, bullMult: 1.5, bearMult: 0.6, neutralMult: 0.4 }
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
    rsiMin: 55, rsiMax: 75,    // [V9.6] 50~80→55~75 (극단값 회피, 확실한 구간만)
    minHoldDays: 1,            
    timeStopMaxDays: 20,       // [V9.6] 30→20 (더 빨리 포기, 모멘텀 소실 방지)
    trailStartPct: 3.0,        // [V9.6] 4.0→3.0 (빨리 익절)
    trailDropPct: 4.0,         // [V9.6] 6.0→4.0 (더 타이트한 트레일링)
    stopLossPct: 6.5,          // [V9.6] 8.0→6.5 (손절 타이트)
    atrStopMult: 2.5,          // [V9.6] 3.0→2.5
    breakEvenAt: 2.5,          // [V9.6] 3.0→2.5 (더 빨리 본전 보호)
    breakEvenLock: 0.3,        // [V9.6] 0.5→0.3
    tp1: 4.0                   // 변경 없음 (첫 익절 지점)
  },
  meanrevRules: {
    zScoreThreshold: -1.5,     // [V9.6] -1.3→-1.5 (더 극단적 저가만)
    rsiMax: 30,                // [V9.6] 35→30 (더 과매도만 진입)
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
    bearZScoreThreshold: -2.2, // [V9.6] -2.0→-2.2 (약세장 더 극단적)
    bearRsiMax: 22             // [V9.6] 25→22 (약세장 더 낮음)
  },
  // === Confluence (전략 내부) ===
  // [V8.1.3] 강제 OFF — 멀티 전략판이라 cross-strategy confluence로 충분.
  // autoTune이 켜는 로직도 V8.1.3에서 비활성화함.
  requireConfluence: false,
  soloSignalWeight: 0.55,      // [V9.6] 0.7→0.55 (단독 신호 45% 감점 — 확실한 것만)
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
    // [V11] LLM 기본 ON 전환 — 저장된 cfg에 옛 기본값(false)이 박혀 있으면 한 번만 켜준다.
    //   llmEnabledMigratedV11 플래그로 1회 적용 → 이후 사용자가 끄면 그 선택을 존중.
    if (cfg.llmHybrid.enabled !== true && !cfg.llmEnabledMigratedV11) {
      cfg.llmHybrid.enabled = true;
      cfg.llmEnabledMigratedV11 = true;
    }
  }

  if (!cfg.markets) cfg.markets = {};
  // [V10] 종목 유니버스는 코드(DEFAULT_US/KR)로 관리한다.
  //   기존 D1에 저장된 옛 20종목 리스트가 얕은 병합으로 살아남아 신규 종목이
  //   안 보이는 문제를 막기 위해, 매 로드 시 최신 DEFAULT로 강제 갱신한다.
  cfg.usTickers = DEFAULT_US;
  cfg.krTickers = DEFAULT_KR;
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
  // [V9.0] 시장별 일봉 갱신 주기 기본값 — 종목 수에 맞춰 차등.
  //   미국 518종목: 20분(매분 ~26 일봉 fetch + 가격 11 ≈ 37, 예산45 내 안전)
  //   한국 311종목: 15분(매분 ~21 일봉 fetch + 가격 7 ≈ 28, 예산45 내 여유)
  //   사용자가 markets.us/kr.dailyCacheMinutes를 직접 설정했으면 그 값을 존중(== 기본값과 다르면 건드리지 않음).
  if (cfg.markets.us && (cfg.markets.us.dailyCacheMinutes === undefined || cfg.markets.us.dailyCacheMinutes === 30)) {
    cfg.markets.us.dailyCacheMinutes = 20;
  }
  if (cfg.markets.kr && (cfg.markets.kr.dailyCacheMinutes === undefined || cfg.markets.kr.dailyCacheMinutes === 30)) {
    cfg.markets.kr.dailyCacheMinutes = 15;
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

// 지수의 마지막 거래시각(epoch초)이 오늘 현지 날짜와 같은지로 개장 판정.
//   캐시 우선, 없으면 지수 fetch. 반환: true(개장) / false(휴장) / null(판정불가→보수적으로 거래허용 안 함)
async function isMarketTradingDay(DB, market, env) {
  const today = localDateStr(market);
  if (!today) return null;
  const cacheKey = "market_open:" + market + ":" + today;
  // 1) 당일 캐시 우선 (하루 1회만 LLM 검색)
  try {
    const cached = await getState(DB, cacheKey, null);
    if (cached && typeof cached.open === "boolean") return cached.open;
  } catch (e) {}

  // 2) Claude web_search로 오늘 거래일 여부 판정
  //    env 없거나 API 키 없으면 판정 불가(null) → 호출부에서 보수적으로 '거래 허용'(거래는 다른 게이트로도 막힘)
  if (!env || !env.ANTHROPIC_API_KEY) return null;
  const exchange = market === "us" ? "the U.S. stock market (NYSE/NASDAQ)" : "the South Korean stock market (KRX/KOSPI)";
  const prompt =
    "Today's date is " + today + ". Is " + exchange + " OPEN for regular trading today? " +
    "Consider weekends and public/exchange holidays. Search the web to verify if needed. " +
    "Answer with ONLY a single word: YES (if open for trading) or NO (if closed). No other text.";
  let open = null;
  try {
    const res = await callClaude(
      env.ANTHROPIC_API_KEY,
      env.LLM_MODEL || "claude-sonnet-4-6",
      prompt,
      300,
      20000,
      {
        baseURL: env.LLM_BASE_URL || null,
        aigToken: env.AI_GATEWAY_TOKEN || null,
        maxRetries: 1,
        tools: [{ type: "web_search_20250305", name: "web_search" }]
      }
    );
    const ans = (res.text || "").trim().toUpperCase();
    if (ans.indexOf("YES") !== -1 && ans.indexOf("NO") === -1) open = true;
    else if (ans.indexOf("NO") !== -1) open = false;
    else open = null;
    await log(DB, "INFO", null, "[HOLIDAY] " + market.toUpperCase() + " " + today + " trading=" + (open === null ? "UNKNOWN" : (open ? "OPEN" : "CLOSED")) + " (LLM: " + ans.slice(0, 20) + ")");
  } catch (e) {
    open = null;
    await log(DB, "WARN", null, "[HOLIDAY] LLM check fail: " + e.message);
  }
  if (open !== null) {
    try { await setState(DB, cacheKey, { open: open, ts: Date.now() }); } catch (e) {}
  }
  return open;
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
    return et.day >= 1 && et.day <= 5 && et.totalMin >= 570 && et.totalMin < 960;
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

  // [FIX V8.8] macro 트리거가 runTradingCycle 내부와 scheduled 양쪽에 있어 07:00 정각에
  //   중복 web_search(비용↑) 가능. 강제실행이 아니면 "오늘 이미 갱신됨"이면 스킵.
  if (!forceRun) {
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
  __schemaReady = true;
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

// === [V11] Cloudflare subrequest 예산 가드 ===
//   Workers 무료 플랜은 invocation 당 외부 fetch(subrequest)가 50개로 제한된다.
//   (유료여도 1000) 한도를 넘으면 "Too many subrequests" 로 이후 fetch 가 전부 실패해
//   로그가 ERROR 로 도배되고 시세 갱신이 끊긴다.
//   → 한 invocation 동안 yahooFetch 호출 수를 카운트하고, 예산을 넘으면 실제 fetch 를
//     하지 않고 즉시 throw 해서(=조용히 스킵) 한도 폭발을 막는다. 남은 종목은 다음
//     사이클 라운드로빈으로 처리된다.
let __fetchBudget = { used: 0, max: 45 };  // 50 중 여유 5개는 D1/기타용으로 남김
function resetFetchBudget(max) {
  __fetchBudget = { used: 0, max: (typeof max === "number" && max > 0) ? max : 45 };
}
function fetchBudgetLeft() { return Math.max(0, __fetchBudget.max - __fetchBudget.used); }

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
  for (let i = 0; i < symbols.length; i += BATCH) slices.push(symbols.slice(i, i + BATCH));
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

  return out;
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
  const initial = market === "us" ? cfg.initialCashUS : (market === "kr" ? cfg.initialCashKR : cfg.initialCashCM);
  const feeRate = market === "us" ? (cfg.feeUS || 0) : (market === "kr" ? (cfg.feeKR || 0) : (cfg.feeUS || 0));
  const sellTaxRate = market === "kr" ? (cfg.krSellTax || 0) : 0;
  const deposits = await getState(DB, "deposits", { us: 0, kr: 0, cm: 0 });
  const dep = (deposits && typeof deposits[market] === "number") ? deposits[market] : 0;

  // [V34] 스냅샷 체크포인트 — trades 전체를 매번 합산하면 거래 누적 시 CPU 타임아웃.
  //   { cashAfter, lastRowid } 스냅샷을 저장하고, 이후 추가된 trades(rowid > lastRowid)만 합산.
  //   합산 건수가 임계(500) 넘으면 스냅샷을 전진 저장해 합산량을 항상 작게 유지.
  const ckptKey = "cash_ckpt:" + market;
  let ckpt = await getState(DB, ckptKey, null);
  let baseCash, sinceRowid;
  if (ckpt && typeof ckpt.cashAfter === "number" && typeof ckpt.lastRowid === "number") {
    baseCash = ckpt.cashAfter;
    sinceRowid = ckpt.lastRowid;
  } else {
    baseCash = (typeof initial === "number" ? initial : 0) + dep;
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
    cm: await computeCashFromTrades(DB, "cm", cfg)
  };
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

  // SW_RSI_REV: [V9.6] RSI 더 낮을 때만 진입 (과매도 더 극단적)
  const rsiRevThr = (cfg.rsiBuy || 35) + 5;  // [V9.6] +10→+5 (40 이하만)
  if (dailyRsi < rsiRevThr && dailyRsiPrev != null && dailyRsi > dailyRsiPrev && dailyRsi < 38) {  // [V9.6] <38 추가
    const maGap = ((price - ma20) / ma20) * 100;
    if (maGap >= -12 && maGap <= 3) {  // [V9.6] -15~inf → -12~3 (더 타이트)
      signals.push({ name: "SW_RSI_REV", weight: 0.9, type: "COUNTER", detail: "RSI " + dailyRsi.toFixed(1) + " (prev " + dailyRsiPrev.toFixed(1) + ")" });
    }
  }
  // SW_GOLDEN: [V9.6] RSI 범위 축소, weight 감소
  if (ma5 != null && ma5 > ma20 && dailyRsi >= 45 && dailyRsi <= 65) {  // [V9.6] 35~68 → 45~65 (상향/상향)
    const ma5Gap = ((price - ma5) / ma5) * 100;
    if (ma5Gap >= -2 && ma5Gap <= 2) {  // [V9.6] -5~4 → -2~2 (더 타이트)
      signals.push({ name: "SW_GOLDEN", weight: 1.0, type: "TREND", detail: "MA5>MA20 gap " + ma5Gap.toFixed(1) + "%" });
    }
  }
  // SW_BB_LOW: [V9.6] RSI 최대값 낮춤
  if (bb != null && price <= bb.lower && dailyRsi < 45 && isGreenCandle && dailyRsi > 25) {  // [V9.6] <52→<45, 최소 25
    signals.push({ name: "SW_BB_LOW", weight: 0.9, type: "COUNTER", detail: "BB lower " + bb.lower.toFixed(2) });
  }
  // SW_VOL_SPK: [V9.6] RSI 범위 축소
  if (volumes.length >= 20 && isGreenCandle && dailyRsi >= 50 && dailyRsi <= 65) {  // [V9.6] 40~72 → 50~65
    const todayVol = volumes[volumes.length - 1];
    let avgVol = 0;
    for (let i = volumes.length - 21; i < volumes.length - 1; i++) avgVol += volumes[i];
    avgVol /= 20;
    if (todayVol >= avgVol * cfg.volSpikeMult) {  // [V9.6] 0.85배 제거 (엄격화)
      signals.push({ name: "SW_VOL_SPK", weight: 1.0, type: "TREND", detail: "vol x" + (todayVol/avgVol).toFixed(1) });
    }
  }

  // SW_PULLBACK: [V9.6] RSI 범위 축소
  const ma50sw = getMA(closes, 50);
  if (ma50sw != null && ma20 > ma50sw && isGreenCandle && dailyRsi >= 50 && dailyRsi <= 62) {  // [V9.6] 42~65 → 50~62
    const ma20Gap = ((price - ma20) / ma20) * 100;
    if (ma20Gap >= 0 && ma20Gap <= 5) {  // [V9.6] -1~8 → 0~5 (더 타이트)
      signals.push({
        name: "SW_PULLBACK",
        weight: 0.95, type: "TREND",
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

  // DAY1: [V9.6] 갭하락 매수 — 매우 제한적
  if (dayPct >= rules.dayDropMin && dayPct <= rules.dayDropMax) {  // -2.0~0.2%
    if (dailyRsi < rsiGapLimit) {  // RSI < 45
      const maGap = ((price - ma20) / ma20) * 100;
      // [V9.6] -5%→-3%: 극도로 타이트
      if (maGap >= -3 && maGap <= 1) {  // [V9.6] 매우 타이트한 범위
        signals.push({
          name: "DY_GAP_DOWN",
          weight: 0.8, type: "COUNTER",  // [V9.6] 0.95→0.8 (약신호)
          detail: "day " + dayPct.toFixed(1) + "% RSI " + dailyRsi.toFixed(1)
        });
      }
    }
  }

  // DAY2: [V9.6] BOUNCE 완전 비활성화 (승률 0% → 영구 금지)
  const BOUNCE_ENABLED = false;

  // DAY3: [V9.6] VWAP_PULL 완전 비활성화 (승률 18% → 영구 금지)
  const VWAP_PULL_ENABLED = false;

  // DAY4: [V9.6] OPEN_DRIVE — 매우 강한 갭상승만
  const odMin = rules.openDriveMinPct != null ? rules.openDriveMinPct : 2.0;  // 2.0%
  const odMax = rules.openDriveMaxPct != null ? rules.openDriveMaxPct : 3.0;  // 3.0%
  if (dayPct >= odMin && dayPct <= odMax
      && dailyRsi >= 55 && dailyRsi <= 68  // [V9.6] 52~72 → 55~68
      && price > ma20) {
    signals.push({
      name: "DY_OPEN_DRIVE",
      weight: 1.0, type: "TREND",  // [V9.6] 1.1→1.0
      detail: "gap up " + dayPct.toFixed(1) + "% RSI " + dailyRsi.toFixed(1)
    });
  }

  // DAY5: [V9.6] MOMO 완전 비활성화 (승률 20% → 영구 금지)
  const MOMO_ENABLED = false;

  // DAY6: [V9.6] DIP_BUY — 매우 제한적
  const dipMin = rules.dipMinPct != null ? rules.dipMinPct : -1.5;  // -1.5%
  const dipMax = rules.dipMaxPct != null ? rules.dipMaxPct : -0.2;  // -0.2%
  if (ma5 != null && ma5 > ma20 && price > ma20
      && dayPct >= dipMin && dayPct <= dipMax
      && dailyRsi >= 50 && dailyRsi <= 65) {  // [V9.6] 38~68 → 50~65
    signals.push({
      name: "DY_DIP_BUY",
      weight: 0.95, type: "COUNTER",  // [V9.6] 1.1→0.95
      detail: "dip " + dayPct.toFixed(1) + "% in uptrend RSI " + dailyRsi.toFixed(1)
    });
  }

  // DAY7: [V9.6] RANGE — 매우 극한 조건만 (안전망만)
  if (ma5 != null && ma5 > ma20 && price > ma5
      && dailyRsi >= 50 && dailyRsi <= 60  // [V9.6] 45~65 → 50~60 (매우 좁음)
      && dayPct >= -1.0 && dayPct <= 0.5) {  // [V9.6] -2.0~1.5 → -1.0~0.5
    if (signals.length === 0) {
      signals.push({
        name: "DY_RANGE",
        weight: 0.7,  // [V9.6] 0.85→0.7 (매우 약신호)
        type: "TREND",
        detail: "trend+range day " + dayPct.toFixed(1) + "% RSI " + dailyRsi.toFixed(1)
      });
    }
  }

  // [V9.6] 신호 정제: weight 1.0 이상만 (매우 엄격)
  const minW = rules.minConfirmWeight != null ? rules.minConfirmWeight : 1.0;  // 1.0 필수
  let filtered = signals.filter(function(s) { return (s.weight || 0) >= minW; });
  const keepN = rules.maxSignalsKept != null ? rules.maxSignalsKept : 1;
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

  // MOM1: [V9.6] 돌파 조건 강화 — 거래량 기준 상향, RSI 범위 축소
  const high20 = getNDayHigh(closes, rules.breakoutDays);
  const trendAligned = ma20 > ma50 && price > ma20;
  const rsiInBand = dailyRsi >= rules.rsiMin && dailyRsi <= rules.rsiMax;  // 55~75

  if (high20 != null && price > high20 && trendAligned && rsiInBand) {
    if (volumes.length >= 20) {
      const todayVol = volumes[volumes.length - 1];
      let avgVol = 0;
      for (let i = volumes.length - 21; i < volumes.length - 1; i++) avgVol += volumes[i];
      avgVol /= 20;
      // [V9.6] 거래량 기준 1.10 → 1.25 (더 강한 거래량만)
      if (todayVol >= avgVol * 1.25) {
        signals.push({
          name: "MO_BREAKOUT",
          weight: 1.2, type: "TREND",  // [V9.6] 1.3→1.2
          detail: "BO " + high20.toFixed(2) + " vol x" + (todayVol/avgVol).toFixed(1) + " RSI " + dailyRsi.toFixed(0)
        });
      }
    }
  }

  // MOM2: [V9.6] 추세 진행 — 더 엄격한 조건
  // RSI 상향: 50~70 → 55~68 (과열 더 강력 차단)
  // 가격 상한: +5% → +3% (이미 오른 종목 회피)
  if (trendAligned && dailyRsi >= 55 && dailyRsi <= 68) {
    const ma20Gap = ((price - ma20) / ma20) * 100;
    if (ma20Gap >= 0 && ma20Gap <= 3) {  // [V9.6] -1~5 → 0~3
      signals.push({
        name: "MO_TREND_PB",
        weight: 1.0, type: "TREND",  // [V9.6] 1.1→1.0
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

  // MR1: [V9.6] z-score + RSI 더 극단적
  // z <= -1.5 (기존 -1.5) + RSI < 28 (기존 30)
  if (z != null && z <= zThr && dailyRsi < rsiMax && isGreenCandle && dailyRsi < 28) {  // [V9.6] RSI <28 추가
    signals.push({
      name: "MR_OVERSOLD",
      weight: 1.1, type: "COUNTER",  // [V9.6] 1.2→1.1
      detail: "z=" + z.toFixed(2) + " RSI " + dailyRsi.toFixed(1) + uptickNote + bearNote
    });
  }

  // MR2: [V9.6] 극단 RSI — 기준 더 낮춤
  // NEUTRAL: RSI < 25 (기존 30) / BEAR: RSI < 20 (기존 22)
  const extremeRsi = isBear ? 20 : 25;  // [V9.6] 30→25, 22→20
  if (dailyRsi < extremeRsi && isGreenCandle && rsiUptick) {  // [V9.6] rsiUptick 필수
    signals.push({
      name: "MR_EXTREME_RSI",
      weight: 1.0, type: "COUNTER",  // [V9.6] 1.1→1.0
      detail: "RSI " + dailyRsi.toFixed(1) + " green" + uptickNote + bearNote
    });
  }

  // MR3: [V9.6] 큰 하락 후 반등 — 조건 강화
  // z <= -1.2 (기존 -1.0) + RSI < 35 (기존 42) + BULL/NEUTRAL만 + rsiUptick 필수
  if (!isBear && z != null && z <= -1.2 && dailyRsi < 35 && isGreenCandle && rsiUptick) {  // [V9.6]
    if (!signals.some(function(s){ return s.name === "MR_OVERSOLD"; })) {
      signals.push({
        name: "MR_DEEP_DROP",
        weight: 0.95, type: "COUNTER",  // [V9.6] 1.0→0.95
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
      // [V9.6] 신호 필터 강화: 최소 표본 20 + 승률 기반 필터
      // 표본 20 이상일 때: 승률 <35% 신호는 0.5배 감점 (약한 신호 억제)
      if (st.count >= 20) {
        const rate = st.weightedWinRate != null ? st.weightedWinRate
          : ((st.wins + 10) / (st.count + 20));
        const shrunkRate = (st.weightedWinRate != null)
          ? (st.weightedWins + 10) / (st.weightedCount + 20)
          : rate;
        // [V9.6] 승률 35% 미만 신호는 0.5배 페널티 추가
        const lowWinRatePenalty = shrunkRate < 0.35 ? 0.5 : 1.0;
        // [V9.6] 손절 빈도 페널티 — 손절률 >60%는 신뢰성 낮음 (0.6배)
        const stopRate = st.count > 0 ? (st.stops || 0) / st.count : 0;
        const highStopPenalty = stopRate > 0.6 ? 0.6 : 1.0;
        perfMult = Math.max(0.5, Math.min(1.3, (0.4 + shrunkRate * 1.2) * lowWinRatePenalty * highStopPenalty));
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
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  if (!(typeof cash[market] === "number" && isFinite(cash[market]))) {
    await log(DB, "ERROR", symbol, "BUY aborted: cash state invalid"); return cash;
  }
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
      pmeta.stopPrice = stopPrice;
      if (pmeta.peakPrice == null || price > pmeta.peakPrice) pmeta.peakPrice = price;
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
  // DB 트랜잭션 완전 성공 후에만 인메모리 cash 차감
  if (cash && typeof cash[market] === "number") cash[market] -= total;
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
      pos.meta.feeRemaining = Math.max(0, feeRemaining - entryFeeForThisSell);
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
  resetFetchBudget(45);  // [V11] subrequest 예산
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
  resetFetchBudget(45);
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
  resetFetchBudget(45);
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
        if (!signalStats[sigName]) signalStats[sigName] = { wins: 0, count: 0, totalPnl: 0, weightedWins: 0, weightedCount: 0, stops: 0 };
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
// [FX] 환율 갱신 — 매일 06:30 KST 1회 (조회 전용, 매매 없음)
//   • 대상: 달러/원·엔/원·달러/엔·파운드/원·유로/원·위안/원·호주달러/원·
//           캐나다달러/원·스위스프랑/원 + 달러 인덱스(DXY)
//   • 야후 환율 심볼을 fetchIntraday로 조회해 가격·전일대비% 저장.
//   • 엔/원은 야후 직접 페어가 비거나 부정확하면 USD/KRW ÷ USD/JPY × 100 으로 파생.
//   • 결과는 state "fx" 키에 저장 → /api/fx 로 프론트에 전달.
// ============================================================
async function runFxUpdate(env) {
  const DB = env.DB;
  resetFetchBudget(45);  // [V11] subrequest 예산 (환율 ~10쌍)
  await log(DB, "INFO", null, "[FX] === 환율 갱신 시작 ===");
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
  await log(DB, "INFO", null, "[FX] 환율 갱신 완료 (성공 " + ok + " / 실패 " + fail + ")");
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
  if (cash && typeof cash.cm === "number") cash.cm -= total;
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
  resetFetchBudget(40);
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
  resetFetchBudget(45);  // [V11] subrequest 예산 (원자재 ~12종이라 여유롭지만 명시적 가드)
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
    // [V8.9] 오늘 거래 완료 마킹 (forceTrade 제외 — 수동 강제실행은 카운트 안 함).
    //   윈도우(16:00~17:00) 내에서 cron이 여러 번 돌아도 하루 1회만 매매하도록.
    if (forceTrade !== true) { try { await markCommodityTradedToday(DB); } catch (e) {} }
  }
  await log(DB, "INFO", null, "[CM] Done: tried=" + tried + " buy=" + bought + " sell=" + sold + " fetchFail=" + fetchFail);
}

async function runTradingCycle(env) {
  const DB = env.DB;
  resetFetchBudget(45);  // [V11] invocation 당 외부 fetch 예산 초기화 (subrequest 한도 가드)
  await ensureSchema(DB);
  let cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {})));

  // [V8.1.3] 저장된 cfg에 박힌 잘못된 값 강제 리셋
  // - requireConfluence: 과거 autoTune이 true로 설정했으면 단독 신호 전부 차단됨 → 거래 0
  // - strategies: 비어있거나 누락된 키 있으면 해당 전략 자동 OFF → 거래 0
  if (cfg.requireConfluence) cfg.requireConfluence = false;
  if (!cfg.strategies || typeof cfg.strategies !== "object") {
    cfg.strategies = { swing: true, day: false, momentum: true, meanrev: true };
  } else {
    // 누락된 키는 true로 채움
    for (const s of ["swing", "momentum", "meanrev"]) {
      if (cfg.strategies[s] !== false) cfg.strategies[s] = true;
    }
  }

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
    const enabledStrats = ["swing","momentum","meanrev"].filter(function(s){ return cfg.strategies[s]; }).join(",");
    const disabledSigNote = (cfg.disabledSignals && cfg.disabledSignals.length > 0)
      ? " disabled=[" + cfg.disabledSignals.join(",") + "]" : "";
    await log(DB, "INFO", null, "=== Cycle start (V8.6) strats=[" + enabledStrats + "] conf=" + (cfg.requireConfluence ? "ON" : "OFF") + disabledSigNote + " ===");
    const cycleStartedAt = Date.now();
    // [FIX V8.8] 엔진 heartbeat — 사이클 시작 직후 기록. 사이클이 중간에 타임아웃/중단돼도
    //   "엔진이 최근 돌긴 했다"를 추적해 last_tick만으로 '지연'을 오판하지 않도록 한다.
    try { await setState(DB, "last_heartbeat", Date.now()); } catch (e) {}

    // [V8.6 Hybrid] LLM 일일 분석 트리거 — 시장별 정해진 시각 "이후" 1회 호출
    // [FIX V8.8] 정각 1분 의존 → 윈도우 + 오늘 미실행 체크로 변경.
    //   그날 한 번이라도 사이클이 돌면(락을 잡으면) 반드시 따라잡아 실행한다.
    //   성공 시에만 markLLMRanToday로 마킹 → 실패하면 다음 사이클에 재시도.
    if (cfg.llmHybrid && cfg.llmHybrid.enabled) {
      if (isLLMTriggerWindow("kr") && !(await llmAlreadyRanToday(DB, "kr"))) {
        try {
          const r = await runLLMDailyAnalysis(env, "kr");
          if (r && r.ok) await markLLMRanToday(DB, "kr");
        } catch (e) { await log(DB, "ERROR", null, "[LLM] kr trigger fail: " + e.message); }
      }
      if (isLLMTriggerWindow("us") && !(await llmAlreadyRanToday(DB, "us"))) {
        try {
          const r = await runLLMDailyAnalysis(env, "us");
          if (r && r.ok) await markLLMRanToday(DB, "us");
        } catch (e) { await log(DB, "ERROR", null, "[LLM] us trigger fail: " + e.message); }
      }
    }

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
    let cash = await computeAllCash(DB, cfg);
    // [V9.1] executeBuy/Sell이 거래마다 cash 전체를 저장하므로, cm 키가 누락된 옛 상태를
    //   읽었을 때 원자재 현금이 사라지지 않도록 보강.
    if (typeof cash.cm !== "number") cash.cm = cfg.initialCashCM;

    // [V28] 강력 예산 가드 — 사이클 시작 시 시장별 가용현금을 스냅샷으로 고정.
    //   한 사이클에서 누적 매수액이 이 스냅샷을 넘으면 이후 매수 전면 차단.
    //   savePosition 충돌 등으로 executeBuy의 cash 추적이 깨져도 예산 초과 불가능.
    const cycleBudget = { us: cash.us, kr: cash.kr, cm: cash.cm };
    const cycleSpent = { us: 0, kr: 0, cm: 0 };

    let tried = 0, bought = 0, sold = 0, skipped = 0, fetchFail = 0;

    // [V8.1.1] 장 열린 시장만 처리 — 마감된 시장은 시세도 fetch 안 함
    // [V23] 가격 갱신 대상 = 정규장 시간 시장 / 거래 대상 = 거래가능(윈도우+휴장통과) 시장
    const marketsForQuotes = [];
    if (usOpen) marketsForQuotes.push("us");
    if (krOpen) marketsForQuotes.push("kr");
    const marketsToTrade = [];
    // [FIX V8.8] 엔진이 꺼져 있으면 거래 대상에서 제외(가격 갱신은 marketsForQuotes로 계속).
    if (engineEnabled && usCanTrade) marketsToTrade.push("us");
    if (engineEnabled && krCanTrade) marketsToTrade.push("kr");

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

      // [V8.1.6] 총자산 = 현금 + 보유 포지션 평가액 (최근 quote 기준)
      // 이전엔 cash[market]만 사용해서 매수할수록 사이즈 작아짐
      let portfolioValue = cash[market];
      for (const key in positions) {
        const p = positions[key];
        const lastQuote = await getState(DB, "quote:" + p.symbol, null);
        const lastPrice = (lastQuote && lastQuote.price) ? lastQuote.price : p.avg;
        portfolioValue += p.qty * lastPrice;
      }

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
      for (const sym of tickers) {
        const bq = batchQuotes[sym];
        if (!bq) continue;
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

      // --- (2) 일봉 라운드로빈 갱신 대상 선정 ---
      // 30분 캐시 / 1분 cron 이므로 전 종목을 30조각으로 나눠 매분 1/30씩 갱신.
      // 보유 종목은 차례와 무관하게 항상 일봉 최신 유지(매도 판단 정확도).
      const cacheMin = mcfg.dailyCacheMinutes || 30;
      const sliceCount = Math.max(1, cacheMin); // 보통 30
      const rrKey = "rr_idx:" + market;
      let rrIdx = await getState(DB, rrKey, 0);
      if (typeof rrIdx !== "number" || rrIdx < 0) rrIdx = 0;
      const perCycle = Math.ceil(tickers.length / sliceCount);
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
      const DBATCH = 10;
      const dailyTargetArr = Array.from(dailyTargets);
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
      const fetched = [];
      let priceAnomalyCount = 0;
      for (const symbol of tickers) {
        const bq = batchQuotes[symbol];
        if (!bq) continue;
        // [V9.1] 가격 정합성 — 0/음수/NaN/무한대는 거래 대상에서 제외(가격 표시는 별도).
        if (!(typeof bq.price === "number" && isFinite(bq.price) && bq.price > 0)) continue;
        // 일봉: 이번에 로드된 것 우선, 없으면 기존 캐시 조회
        let daily = dailyMap[symbol];
        if (daily === undefined) {
          daily = await getState(DB, "daily:" + symbol, null);
        }
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
        await log(DB, "WARN", null, "[V9.1] price anomaly skipped[" + market + "]=" + priceAnomalyCount);
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
          // [V10] 1차 평가 — 분봉 없이 일봉 신호만으로 (호출 0). day 게이트는 데이터부족→통과.
          let stratResults = evaluateAllStrategies(price, dayPct, daily, mcfg, signalStats, regime, market, intra);
          // [V10] 2단계 깔때기 — US day 매수 신호가 1차에서 나온 경우에만 분봉 1회 조회해 재검증.
          //   대부분 종목은 1차에서 신호가 없어 분봉 호출 자체가 일어나지 않음 → subrequest 절약.
          const hasDaySignal = stratResults.some(function(r){ return r.strategy === "day"; });
          if (hasDaySignal && market === "us" && mcfg.dayRules && mcfg.dayRules.usIntradayGate !== false) {
            try {
              const fullIntra = await fetchIntraday(symbol);
              if (fullIntra && Array.isArray(fullIntra.closes) && fullIntra.closes.length > 0) {
                // 분봉으로 재평가 — "지금 하락 중"이면 day 신호가 걸러진다.
                stratResults = evaluateAllStrategies(price, dayPct, daily, mcfg, signalStats, regime, market, fullIntra);
              }
            } catch (e) { /* 분봉 실패 시 1차 결과 유지 */ }
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
            // [V27] 예산 가드 — 부동소수점 오차 여유(1원/1센트) 두고 엄격 차단 + 초과 시도 로깅
            const epsilon = market === "us" ? 0.01 : 1;
            // [V28] 사이클 누적 예산 가드 — 이번 매수로 누적 지출이 시작 현금을 넘으면 차단.
            const wouldSpend = cycleSpent[market] + totalCost;
            if (qty > 0 && wouldSpend > cycleBudget[market] + epsilon) {
              await log(DB, "ERROR", symbol, "[CRITICAL] 사이클예산초과 차단: 누적지출=" + Math.round(wouldSpend) + " 한도=" + Math.round(cycleBudget[market]) + " (" + strategy + ")");
              incNobuy("cycle_budget[" + strategy + "]");
            } else if (qty > 0 && totalCost <= cash[market] + epsilon) {
              // [V8.6 Hybrid] LLM stop_loss_adjustment 적용 (지시 있으면)
              const buyOpts = (llmInstr && llmInstr.stop_loss_adjustment && typeof llmInstr.stop_loss_adjustment.new_pct === "number")
                ? { stopPctOverride: llmInstr.stop_loss_adjustment.new_pct } : null;
              const cashBefore = cash[market];
              cash = await executeBuy(DB, market, symbol, strategy, qty, price, signal, dailyAtr, mcfg, cash, buyOpts) || cash;
              // [V28] executeBuy가 실제로 cash를 차감했을 때만 매수 성공으로 카운트.
              //   savePosition 충돌 등으로 차감이 안 됐으면(=실패) spent/held 갱신 안 함.
              const actuallySpent = cashBefore - cash[market];
              if (actuallySpent > epsilon) {
                cycleSpent[market] += actuallySpent;
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

    try { await setState(DB, "cash", cash); } catch (e) {}
    try { await setState(DB, "last_tick", Date.now()); } catch (e) {}
    // [V25 감사 A] 사이클 종료 시 회계 무결성 검증 — 거래한 시장만.
    for (const mkt of marketsToTrade) {
      await auditAccounting(DB, mkt, cash);
    }
    const cycleMs = Date.now() - cycleStartedAt;
    await log(DB, "INFO", null, "Done: tried=" + tried + " skip=" + skipped + " buy=" + bought + " sell=" + sold + " fetchFail=" + fetchFail + " cycleMs=" + cycleMs);
    try { await DB.prepare("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)").run(); } catch (e) {}
  } finally {
    await releaseCycleLock(DB, myLockPid);
  }
}

// [V25 감사 A] 회계 무결성 검증 — 매 사이클 시장별 총자산(현금+보유평가액)을 계산하고,
//   D1에 스냅샷 저장. 다음 사이클에 직전 스냅샷과 비교해 비정상 급변을 감지/경고한다.
//   "현금 + 보유평가"는 시세 변동으로 자연히 바뀌므로, 단순 절대 임계가 아니라
//   투자원금(invested) 대비 비정상(예: 현금이 갑자기 2배↑, 음수 등)을 잡는다.
async function auditAccounting(DB, market, cash) {
  try {
    const positions = await getPositions(DB, market);
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
      const cash = await computeAllCash(env.DB, cfg);
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
      await env.DB.prepare("DELETE FROM state WHERE k LIKE ?").bind("cash_ckpt:%").run();
      await env.DB.prepare("DELETE FROM positions").run();
      await env.DB.prepare("DELETE FROM logs").run();
      await env.DB.prepare("DELETE FROM state WHERE k NOT LIKE 'quote:%' AND k NOT LIKE 'index:%' AND k NOT LIKE 'daily:%'").run();
      await setState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR, cm: cfg.initialCashCM });
      await setState(env.DB, "deposits", { us: 0, kr: 0 });
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
      const initial = mkt === "us" ? cfg.initialCashUS : cfg.initialCashKR;
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
        for (const p of positions) {
          invested += (p.qty || 0) * (p.avg_price || 0);
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
      // 기존 cash에 금액 추가/차감 (포지션, 거래 기록 보존)
      // body: { us?: number, kr?: number }  — 양수=입금, 음수=출금
      // [V8.2.2] deposits도 누적 기록 → 수익률 계산 시 입금분 차감용
      const body = await request.json();
      const cfg = migrateCfgToMarkets(Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {})));
      const cash = await computeAllCash(env.DB, cfg);
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
    // === [FX] 환율 즉시 갱신 ===
    if (path === "/api/fx/run" && request.method === "POST") {
      const payload = await runFxUpdate(env);
      return Response.json({ ok: true, data: payload, ts: Date.now() }, { headers: cors });
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
    // [FIX V8.8] 기존엔 runTradingCycle / refreshCommodityQuotes / runCommodityCycle을
    //   각각 ctx.waitUntil로 "동시" 실행했는데, 이들이 전역 __fetchBudget(yahoo fetch
    //   예산)을 공유하면서 서로 resetFetchBudget()로 카운터를 덮어쓰고 소진시켜
    //   가격/원자재 갱신이 산발적으로 실패했음(특히 정규장 1분 갱신).
    //   → 단일 promise 안에서 "순차" 실행해 각 사이클이 자기 예산을 온전히 쓰게 한다.
    ctx.waitUntil((async () => {
      // 1) 주식/지수 가격 갱신 + 거래 (가장 무거움 — 먼저 단독 실행)
      try { await runTradingCycle(env); }
      catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] trading cycle fail: " + e.message); } catch (e2) {} }

      // 2) 원자재 시세 갱신 (매분) — 예산 리셋 후 단독 실행
      try { await refreshCommodityQuotes(env); }
      catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] commodity quote fail: " + e.message); } catch (e2) {} }

      // 3) 원자재 거래 (평일 16:00 KST 정각 ±윈도우)
      if (isCommodityTriggerTime()) {
        try { await runCommodityCycle(env); }
        catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] commodity cycle fail: " + e.message); } catch (e2) {} }
      }

      // 4) 환율 갱신 (매일 06:30 KST)
      if (isFxTriggerTime()) {
        try { await runFxUpdate(env); }
        catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] fx fail: " + e.message); } catch (e2) {} }
      }

      // 5) 경제지표 갱신 (매일 07:00 KST) — runTradingCycle 내부에도 트리거가 있으나
      //    엔진 disabled 상태에서도 매크로는 갱신되도록 여기서도 안전하게 한 번 더 보장.
      if (isMacroTriggerTime()) {
        try { await runMacroUpdate(env); }
        catch (e) { try { await log(env.DB, "ERROR", null, "[SCHED] macro fail: " + e.message); } catch (e2) {} }
      }
    })());
  }
};
