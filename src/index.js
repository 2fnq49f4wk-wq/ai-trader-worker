// ============================================================
// LUX-engine V8.1.9 (멀티 전략판 - 거래금액 타겟팅)
// 4개 전략 동시 운용: swing, day, momentum, meanrev
//   • 같은 종목 + 다른 전략 = 별도 포지션 가능 (composite PK)
//   • 매도는 진입 전략의 룰을 따라감
//   • 동시 신호 시 cross-strategy confluence 가중 (x1.2)
//   • 전략별 base size + 시장국면 multiplier
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
  initialCashUS: 10000, initialCashKR: 10000000,
  enabled: true,
  autoTune: true,
  marketHoursOnly: true,
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
    day:      { base: 25, bullMult: 1.5, bearMult: 1.0 },
    meanrev:  { base: 25, bullMult: 1.2, bearMult: 1.4 },
    swing:    { base: 30, bullMult: 1.4, bearMult: 0.8 },
    momentum: { base: 28, bullMult: 1.5, bearMult: 0.6 }
  },
  // === [V8.1.9] 한 거래당 목표 금액 클램프 (시장별) ===
  // budget이 minBudget 미만이면 minBudget으로 끌어올리고, maxBudget 넘으면 잘라냄.
  // cash[market] 부족하면 cash 한도 내에서 최대한 채움.
  sizingTargets: {
    kr: { minBudget: 1000000, maxBudget: 3000000 },  // ₩100만 ~ ₩300만
    us: { minBudget: 1000,    maxBudget: 3000    }   // $1k ~ $3k
  },
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
    atrStopMult: 2.0
  },
  dayRules: {
    minHoldMinutes: 10,
    maxHoldHours: 8,
    forceCloseBeforeMinClose: 30,
    tp: 2.5,
    stopLossPct: 1.3,
    // [V8.1.3] 범위 더 공격적
    dayDropMin: -8.0,                  // [V8.1.3] -7→-8
    dayDropMax: 1.5,                   // [V8.1.3] 1.0→1.5
    rsiMaxForGap: 65,                  // [V8.1.3] 60→65
    rsiMaxForBounce: 70,               // [V8.1.3] 65→70
    bounceYestMin: -0.5,               // [V8.1.3] -0.8→-0.5 (작은 음봉도 잡기)
    openDriveMinPct: 0.5,              // [V8.1.3] 0.7→0.5
    openDriveMaxPct: 6.0,              // [V8.1.3] 5.0→6.0
    vwapPullMinPct: -1.5,              // [V8.1.3] -1.0→-1.5
    vwapPullMaxPct: 3.5,               // [V8.1.3] 3.0→3.5
    momoRsiMin: 55,                    // [V8.1.3] 58→55
    momoRsiMax: 80,                    // [V8.1.3] 78→80
    dipMinPct: -5.0,                   // [V8.1.3] -3.5→-5.0 (큰 눌림도 잡기, 005380같은 -4.7%)
    dipMaxPct: -0.1                    // [V8.1.3] -0.2→-0.1
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
    atrStopMult: 3.0
  },
  meanrevRules: {
    zScoreThreshold: -1.3,     // [V8.1.7] -1.7→-1.3 (더 빈번)
    rsiMax: 35,                // [V8.1.7] 30→35
    minHoldHours: 2,
    timeStopMaxDays: 5,
    tp: 999,
    stopLossPct: 4.0           // [V8.1.7] 3.5→4.0
  },
  // === Confluence (전략 내부) ===
  // [V8.1.3] 강제 OFF — 멀티 전략판이라 cross-strategy confluence로 충분.
  // autoTune이 켜는 로직도 V8.1.3에서 비활성화함.
  requireConfluence: false,
  soloSignalWeight: 1.0,
  confluenceBonus: 1.3,
  allowMixedConfluence: true,
  mixedConfluencePenalty: 0.8,
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

function isMarketOpen(market) {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const utcDay = now.getUTCDay();
  if (market === "us") {
    let etTotalMin = (utcHour - 4) * 60 + utcMinute;
    if (etTotalMin < 0) etTotalMin += 24 * 60;
    return utcDay >= 1 && utcDay <= 5 && etTotalMin >= 570 && etTotalMin < 960;
  }
  if (market === "kr") {
    let kstTotalMin = (utcHour + 9) * 60 + utcMinute;
    if (kstTotalMin >= 24 * 60) kstTotalMin -= 24 * 60;
    let kstDay = utcDay;
    if (utcHour + 9 >= 24) kstDay = (utcDay + 1) % 7;
    return kstDay >= 1 && kstDay <= 5 && kstTotalMin >= 540 && kstTotalMin < 930;
  }
  return false;
}

// [V8.1 신규] 장 마감까지 남은 분 — Day 전략 강제 청산용
// 장 마감 이후거나 장 시작 전이면 null 반환
function marketMinutesUntilClose(market) {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const utcDay = now.getUTCDay();
  if (market === "us") {
    let etTotalMin = (utcHour - 4) * 60 + utcMinute;
    if (etTotalMin < 0) etTotalMin += 24 * 60;
    if (utcDay < 1 || utcDay > 5) return null;
    if (etTotalMin < 570 || etTotalMin >= 960) return null;
    return 960 - etTotalMin;  // 16:00 ET 마감
  }
  if (market === "kr") {
    let kstTotalMin = (utcHour + 9) * 60 + utcMinute;
    if (kstTotalMin >= 24 * 60) kstTotalMin -= 24 * 60;
    let kstDay = utcDay;
    if (utcHour + 9 >= 24) kstDay = (utcDay + 1) % 7;
    if (kstDay < 1 || kstDay > 5) return null;
    if (kstTotalMin < 540 || kstTotalMin >= 930) return null;
    return 930 - kstTotalMin;  // 15:30 KST 마감
  }
  return null;
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

// === [V8] DAY 전략 — 갭하락 후 반등 노림수 (실제론 intraday swing) ===
function evaluateBuySignals_day(price, dayPct, dailyData, cfg) {
  const closes = dailyData.closes;
  if (!closes || closes.length < 25) return [];
  const rules = cfg.dayRules;
  const dailyRsi = getRSI(closes, cfg.rsiPeriod);
  const ma20 = getMA(closes, cfg.maPeriod);
  const ma5 = getMA(closes, cfg.maShortPeriod);
  if (dailyRsi == null || ma20 == null) return [];

  const signals = [];
  const rsiGapLimit = rules.rsiMaxForGap != null ? rules.rsiMaxForGap : 55;
  const rsiBounceLimit = rules.rsiMaxForBounce != null ? rules.rsiMaxForBounce : 60;

  // DAY1: 갭하락 매수 — 더 넓은 범위 + RSI 완화 + MA20 -12% 이내
  if (dayPct >= rules.dayDropMin && dayPct <= rules.dayDropMax) {
    if (dailyRsi < rsiGapLimit) {
      const maGap = ((price - ma20) / ma20) * 100;
      if (maGap >= -12) {  // [V8.1] -10 → -12 완화
        const depthBonus = dayPct < -3 ? 0.2 : (dayPct < -1.5 ? 0.1 : 0);
        signals.push({
          name: "DY_GAP_DOWN",
          weight: 1.0 + depthBonus, type: "COUNTER",
          detail: "day " + dayPct.toFixed(1) + "% RSI " + dailyRsi.toFixed(1)
        });
      }
    }
  }

  // DAY2: 강한 일중 반등 — 어제 음봉 후 오늘 양봉
  if (closes.length >= 3) {
    const yest = closes[closes.length - 2];
    const dayBefore = closes[closes.length - 3];
    const yestPct = ((yest - dayBefore) / dayBefore) * 100;
    const yestThr = rules.bounceYestMin != null ? rules.bounceYestMin : -1.0;
    if (yestPct < yestThr && dayPct > 0 && dailyRsi >= 25 && dailyRsi <= rsiBounceLimit) {
      signals.push({
        name: "DY_BOUNCE",
        weight: 1.15, type: "COUNTER",
        detail: "yest " + yestPct.toFixed(1) + "% today +" + dayPct.toFixed(1) + "%"
      });
    }
  }

  // [V8.1] DAY3: VWAP_PULL — 추세 위 가벼운 눌림
  const vwapMin = rules.vwapPullMinPct != null ? rules.vwapPullMinPct : -0.5;
  const vwapMax = rules.vwapPullMaxPct != null ? rules.vwapPullMaxPct : 2.5;
  if (ma5 != null && ma5 > ma20 && price > ma5
      && dayPct >= vwapMin && dayPct <= vwapMax
      && dailyRsi >= 48 && dailyRsi <= 68) {  // [V8.1] 50~65 → 48~68 완화
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
  if (dailyRsi >= momoRsiMin && dailyRsi <= momoRsiMax
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

  // [V8.1.2 신규] DAY7: DY_RANGE — catch-all 안전망 (V8.1.3 더 넓힘)
  // RSI 30~75 + dayPct -5~+3 → 거의 모든 정상 종목 진입 가능.
  if (dailyRsi >= 30 && dailyRsi <= 75
      && dayPct >= -5.0 && dayPct <= 3.0) {
    if (signals.length === 0) {
      const trendUp = ma5 != null && ma5 > ma20;
      signals.push({
        name: "DY_RANGE",
        weight: 0.9,                                    // [V8.1.3] 0.85→0.9
        type: trendUp ? "TREND" : "COUNTER",
        detail: "range day " + dayPct.toFixed(1) + "% RSI " + dailyRsi.toFixed(1) + (trendUp ? " up-trend" : " no-trend")
      });
    }
  }

  return signals;
}

// === [V8] MOMENTUM 전략 — 신고가 돌파 + 거래량 + 추세 정렬 ===
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

  // MOM2: 강한 추세 진행
  if (trendAligned && dailyRsi >= 50 && dailyRsi <= 75) {  // [V8.1.7] 52~72 → 50~75
    const ma20Gap = ((price - ma20) / ma20) * 100;
    if (ma20Gap >= -1 && ma20Gap <= 10) {  // [V8.1.7] 0~7 → -1~10
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
function evaluateBuySignals_meanrev(price, dayPct, dailyData, cfg) {
  const closes = dailyData.closes;
  if (!closes || closes.length < 25) return [];
  const rules = cfg.meanrevRules;
  const dailyRsi = getRSI(closes, cfg.rsiPeriod);
  if (dailyRsi == null) return [];

  const signals = [];
  const z = getZScore(closes, 20);
  const yesterday = closes[closes.length - 2];
  const today = closes[closes.length - 1];
  const isGreenCandle = today > yesterday;

  // MR1: -2σ 이하 + RSI<25 + 양봉 (반전 시작)
  if (z != null && z <= rules.zScoreThreshold && dailyRsi < rules.rsiMax && isGreenCandle) {
    signals.push({
      name: "MR_OVERSOLD",
      weight: 1.2, type: "COUNTER",
      detail: "z=" + z.toFixed(2) + " RSI " + dailyRsi.toFixed(1)
    });
  }

  // MR2: 극단 RSI (z-score 미달이어도 RSI만으로)
  if (dailyRsi < 30 && isGreenCandle) {  // [V8.1.7] 25→30
    signals.push({
      name: "MR_EXTREME_RSI",
      weight: 1.1, type: "COUNTER",
      detail: "RSI " + dailyRsi.toFixed(1) + " green"
    });
  }

  // MR3: 큰 하락 후 반등 시작 (더 완화)
  if (z != null && z <= -1.0 && dailyRsi < 42 && isGreenCandle) {  // [V8.1.7] -1.3/38 → -1.0/42
    if (!signals.some(function(s){ return s.name === "MR_OVERSOLD"; })) {
      signals.push({
        name: "MR_DEEP_DROP",
        weight: 1.0, type: "COUNTER",
        detail: "z=" + z.toFixed(2) + " RSI " + dailyRsi.toFixed(1) + " bouncing"
      });
    }
  }
  return signals;
}

// === [V8] 통합 평가기 — 모든 활성 전략에서 신호 수집 ===
// 반환: [{ strategy, signal, signals: [...] }, ...]  (전략당 1개)
function evaluateAllStrategies(price, dayPct, dailyData, cfg, signalStats) {
  const results = [];
  const evaluators = {
    swing:    evaluateBuySignals_swing,
    day:      evaluateBuySignals_day,
    momentum: evaluateBuySignals_momentum,
    meanrev:  evaluateBuySignals_meanrev
  };
  for (const stratName of STRATEGIES) {
    if (!cfg.strategies || !cfg.strategies[stratName]) continue;
    const sigs = evaluators[stratName](price, dayPct, dailyData, cfg);
    if (sigs.length === 0) continue;
    const resolved = resolveSignals(sigs, cfg, signalStats, stratName);
    if (!resolved) continue;
    results.push({ strategy: stratName, signal: resolved, rawCount: sigs.length });
  }
  // [V8.1.6] 중복 신호 시 보유기간 긴 전략 1개만 선택
  // 우선순위: momentum > swing > meanrev > day
  if (results.length >= 2) {
    const priority = { momentum: 4, swing: 3, meanrev: 2, day: 1 };
    let best = results[0];
    for (const r of results) {
      if ((priority[r.strategy] || 0) > (priority[best.strategy] || 0)) best = r;
    }
    return [best];
  }
  return results;
}

// === [V8] Confluence 해석 — 전략 내부 신호 합의 ===
function resolveSignals(signals, cfg, signalStats, stratName) {
  if (signals.length === 0) return null;
  if (signals.length === 1) {
    if (cfg.requireConfluence) return null;
    const s = signals[0];
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
      if (st.count >= 20) {
        const shrunkRate = (st.wins + 10) / (st.count + 20);
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
async function executeBuy(DB, market, symbol, strategy, qty, price, signal, dailyAtr, cfg, cash) {
  const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  if (total > cash[market]) { await log(DB, "WARN", symbol, "BUY aborted: cash short"); return cash; }

  // 전략별 손절가 계산
  const rules = getStrategyRules(cfg, strategy);
  const stopPct = rules.stopLossPct || cfg.stopLoss;
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
  const sizing = (cfg.strategySizing && cfg.strategySizing[strategy]) || { base: 10, bullMult: 1.0, bearMult: 1.0 };
  const base = sizing.base / 100;
  if (regimeName === "BULL") return base * (sizing.bullMult || 1.0);
  if (regimeName === "BEAR") return base * (sizing.bearMult || 1.0);
  return base;
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
  // 공통: ATR-STOP
  if (pos.meta && pos.meta.stopPrice != null && price <= pos.meta.stopPrice) {
    return { sell: true, sellQty: pos.qty, reason: "ATR-STOP " + pnlRate.toFixed(2) + "%" };
  }

  // === DAY 전략 ===
  if (strategy === "day") {
    const r = cfg.dayRules;
    // [V8.1] 장 마감 N분 전 강제 청산 — minHold 보다 우선 (장 종료가 임박하면 무조건 청산)
    if (market) {
      const mtc = marketMinutesUntilClose(market);
      const forceMin = r.forceCloseBeforeMinClose || 30;
      if (mtc != null && mtc <= forceMin) {
        return { sell: true, sellQty: pos.qty, reason: "DAY-EOD " + mtc + "min PnL=" + pnlRate.toFixed(2) + "%" };
      }
    }
    // 최소 보유시간
    if (heldMin < (r.minHoldMinutes || 20)) return { sell: false };
    // 익절
    if (pnlRate >= r.tp) {
      return { sell: true, sellQty: pos.qty, reason: "DAY-TP +" + pnlRate.toFixed(2) + "%" };
    }
    // 최대 보유시간
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
    // 시간 만료
    if (heldDays >= (r.timeStopMaxDays || 30)) {
      return { sell: true, sellQty: pos.qty, reason: "MO-TIME " + heldDays.toFixed(1) + "d PnL=" + pnlRate.toFixed(2) + "%" };
    }
    // Trail stop (피크 대비 trailDropPct 하락)
    if (peakPnlPct >= (r.trailStartPct || 5)) {
      const trailStop = peakPrice * (1 - (r.trailDropPct || 7) / 100);
      if (price <= trailStop) {
        return { sell: true, sellQty: pos.qty, reason: "MO-TRAIL peak=" + peakPrice.toFixed(2) + " +" + pnlRate.toFixed(2) + "%" };
      }
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
  if (peakPnlPct >= (r.trailStartPct || 3) && pnlRate >= 2.0) {
    const trailStop = peakPrice * (1 - (r.trailDropPct || 4) / 100);
    if (price <= trailStop) {
      return { sell: true, sellQty: pos.qty, reason: "TRAIL peak=" + peakPrice.toFixed(2) + " +" + pnlRate.toFixed(2) + "%" };
    }
  }
  return { sell: false };
}

async function refreshQuotesOnly(env, market) {
  const DB = env.DB;
  await ensureSchema(DB);
  const cfg = Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {}));
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
    const tradesRes = await DB.prepare("SELECT * FROM trades WHERE side = ? ORDER BY ts DESC LIMIT 50").bind("SELL").all();
    const recentSells = tradesRes.results || [];
    if (recentSells.length < 10) return cfg;

    const tuneState = await getState(DB, "autotune_state", { lastTunedAt: 0, tradeCountAtLastTune: 0 });
    const totalSells = await DB.prepare("SELECT COUNT(*) as c FROM trades WHERE side = ?").bind("SELL").first();
    const sellCount = totalSells.c || 0;
    if (sellCount - tuneState.tradeCountAtLastTune < 10) return cfg;

    // [수정] 신호별 성과 집계 — '#entry=' 구분자로 파싱 충돌 방지
    const signalStats = {};
    for (const t of recentSells) {
      const reason = t.reason || "";
      const m = reason.match(/#entry=([A-Z_][A-Z0-9_,]*)/);
      if (!m) continue;
      const members = m[1].split(",").filter(function(x){ return x; });
      for (const sigName of members) {
        if (!signalStats[sigName]) signalStats[sigName] = { wins: 0, count: 0, totalPnl: 0 };
        signalStats[sigName].count++;
        signalStats[sigName].totalPnl += (t.pnl_pct || 0);
        if (t.pnl_pct > 0) signalStats[sigName].wins++;
      }
    }
    for (const k in signalStats) {
      signalStats[k].winRate = signalStats[k].count > 0 ? signalStats[k].wins / signalStats[k].count : 0;
      signalStats[k].avgPnl = signalStats[k].count > 0 ? signalStats[k].totalPnl / signalStats[k].count : 0;
    }
    await setState(DB, "signal_stats", signalStats);

    const wins = recentSells.filter(function(t){ return t.pnl_pct > 0; });
    const winRate = wins.length / recentSells.length;
    const avgPnl = recentSells.reduce(function(a,t){ return a + (t.pnl_pct || 0); }, 0) / recentSells.length;
    const changes = [];
    const newCfg = Object.assign({}, cfg);

    const usRegime = regimes.us ? regimes.us.regime : "UNKNOWN";
    const krRegime = regimes.kr ? regimes.kr.regime : "UNKNOWN";
    const dominantRegime = (usRegime === "BEAR" || krRegime === "BEAR") ? "BEAR" :
                           (usRegime === "BULL" && krRegime === "BULL") ? "BULL" : "NEUTRAL";

    if (dominantRegime === "BEAR" && avgPnl < 0) {
      newCfg.rsiBuy = Math.max(30, cfg.rsiBuy - 2);
      if (newCfg.rsiBuy !== cfg.rsiBuy) changes.push("RSI " + cfg.rsiBuy + "->" + newCfg.rsiBuy);
    } else if (dominantRegime === "BULL" && winRate > 0.55 && avgPnl > 2) {
      newCfg.rsiBuy = Math.min(40, cfg.rsiBuy + 1);
      if (newCfg.rsiBuy !== cfg.rsiBuy) changes.push("RSI " + cfg.rsiBuy + "->" + newCfg.rsiBuy);
    }

    // [V8.1.3] 승률 기반 Confluence 자동 토글 제거.
    // 이전 V8까지는 winRate<40%면 자동으로 requireConfluence=true로 설정 →
    // 단독 신호 전부 차단 → 거래 0건 빠짐.
    // 멀티 전략판은 cross-strategy confluence로 이미 안전망 충분.
    // 만약 과거 사이클에서 켜져 있었다면 강제로 OFF로 리셋.
    if (cfg.requireConfluence) {
      newCfg.requireConfluence = false;
      changes.push("CONF=OFF (forced reset)");
    }

    if (changes.length > 0) {
      await setState(DB, "cfg", newCfg);
      await setState(DB, "autotune_state", { lastTunedAt: Date.now(), tradeCountAtLastTune: sellCount });
      await log(DB, "TUNE", null, "[" + dominantRegime + "] WR=" + (winRate*100).toFixed(0) + "% PnL=" + avgPnl.toFixed(2) + "% -> " + changes.join(", "));
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

async function runTradingCycle(env) {
  const DB = env.DB;
  await ensureSchema(DB);
  let cfg = Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {}));

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
    await log(DB, "INFO", null, "=== Cycle start (V8.1.3) strats=[" + enabledStrats + "] conf=" + (cfg.requireConfluence ? "ON" : "OFF") + " ===");
    const cycleStartedAt = Date.now();
    const usOpen = isMarketOpen("us");
    const krOpen = isMarketOpen("kr");

    // [V8.1.1] 양 시장 다 닫혔으면 사이클 전체 스킵 — 정규장에만 작동
    if (!usOpen && !krOpen) {
      await log(DB, "CLOSED", null, "US & KR 장 마감 — 사이클 스킵");
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
      const tickers = market === "us" ? cfg.usTickers : cfg.krTickers;
      const positions = await getPositions(DB, market);  // key: "SYM::strategy"
      const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
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
            daily = await getDailyCached(DB, symbol, cfg.dailyCacheMinutes);
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
            if (held.meta && held.meta.stopPrice != null) {
              const stopPct = (getStrategyRules(cfg, stratName).stopLossPct || cfg.stopLoss);
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

            // 매도 판단
            const sellDecision = evaluateSell(held, price, daily, dailyRsi, dailyMa, dailyMaShort, cfg, canTrade, market);
            if (sellDecision.minHoldLock) {
              const heldHours = held.opened_ts ? (Date.now() - held.opened_ts) / 3600000 : 0;
              const pnlRate = ((price - held.avg) / held.avg) * 100;
              await log(DB, "INFO", symbol, "MIN-HOLD lock [" + stratName + "] (" + heldHours.toFixed(1) + "h, PnL " + pnlRate.toFixed(2) + "%)");
              continue;
            }
            if (sellDecision.sell) {
              await executeSell(DB, market, symbol, held, sellDecision.sellQty, price, sellDecision.reason, cfg, cash);
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
          const stratResults = evaluateAllStrategies(price, dayPct, daily, cfg, signalStats);

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
          const crossBonus = (stratResults.length >= 2) ? (cfg.crossConfluenceBonus || 1.0) : 1.0;
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
            const blockReason = evaluateBuyBlocks(price, dayPct, daily, cfg, regime, signal, ctx);
            if (blockReason) {
              incBlock(blockReason.split(" ")[0] + "[" + strategy + "]");
              continue;
            }

            const baseRatio = getPositionSizeRatio(cfg, strategy, regime.regime);
            const adjustedRatio = baseRatio * signal.weight * crossBonus;

            // [V8.1.9] 사이징 변경:
            //   • 기존: portfolioValue * ratio (US/KR 합산 평가 기준 → 한쪽 cash 부족시 0주)
            //   • 변경: cash[market] * ratio 를 1차 budget으로, sizingTargets로 클램프
            //     - minBudget 미만이면 minBudget까지 끌어올림 (단, cash[market]*0.85 한도)
            //     - maxBudget 초과면 maxBudget으로 캡
            const targets = (cfg.sizingTargets && cfg.sizingTargets[market]) || { minBudget: 0, maxBudget: Infinity };
            const rawBudget = cash[market] * adjustedRatio;
            const cashCap = cash[market] * 0.85;  // cash 전부 박지 않게 85% 캡
            let budget = Math.min(rawBudget, targets.maxBudget, cashCap);
            // 최소 베팅: cash가 minBudget의 1.1배 이상 있을 때만 minBudget 보장 (현금 고갈 방지)
            if (budget < targets.minBudget && cash[market] >= targets.minBudget * 1.1) {
              budget = Math.min(targets.minBudget, cashCap);
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
              await executeBuy(DB, market, symbol, strategy, qty, price, signal, dailyAtr, cfg, cash);
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
      const cfg = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
      const cash = await getState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });
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
        positions: {
          us: posUS.list,          // [V8] array of (symbol, strategy) rows
          kr: posKR.list,
          usBySymbol: posUS.bySymbol,
          krBySymbol: posKR.bySymbol
        },
        lastTick: lastTick, cfg: cfg,
        marketStatus: { us: isMarketOpen("us"), kr: isMarketOpen("kr") },
        watchlist: quotes,
        indices: indices,
        signalStats: signalStats,
        strategies: STRATEGIES   // [V8]
      }, { headers: cors });
    }

    // 하위 호환 엔드포인트 유지
    if (path === "/api/watchlist") {
      const cfg = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
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
      const cfg = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
      return Response.json(cfg, { headers: cors });
    }
    if (path === "/api/cfg" && request.method === "POST") {
      const body = await request.json();
      const current = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
      const next = Object.assign({}, current, body);
      await setState(env.DB, "cfg", next);
      await log(env.DB, "INFO", null, "cfg updated manually");
      return Response.json({ ok: true, cfg: next }, { headers: cors });
    }
    if (path === "/api/favorites" && request.method === "POST") {
      const body = await request.json();
      const current = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
      if (body.usFavorites !== undefined) current.usFavorites = body.usFavorites;
      if (body.krFavorites !== undefined) current.krFavorites = body.krFavorites;
      await setState(env.DB, "cfg", current);
      return Response.json({ ok: true, usFavorites: current.usFavorites, krFavorites: current.krFavorites }, { headers: cors });
    }
    if (path === "/api/reset" && request.method === "POST") {
      await ensureSchema(env.DB);
      const cfg = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
      await env.DB.prepare("DELETE FROM trades").run();
      await env.DB.prepare("DELETE FROM positions").run();
      await env.DB.prepare("DELETE FROM logs").run();
      await env.DB.prepare("DELETE FROM state WHERE k NOT LIKE 'quote:%' AND k NOT LIKE 'index:%' AND k NOT LIKE 'daily:%'").run();
      await setState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });
      await log(env.DB, "INFO", null, "RESET");
      return Response.json({ ok: true, cash: { us: cfg.initialCashUS, kr: cfg.initialCashKR } }, { headers: cors });
    }
    if (path === "/api/reset_tickers" && request.method === "POST") {
      const current = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
      current.usTickers = DEFAULT_US;
      current.krTickers = DEFAULT_KR;
      await setState(env.DB, "cfg", current);
      return Response.json({ ok: true, usTickers: DEFAULT_US, krTickers: DEFAULT_KR }, { headers: cors });
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
    // [신규] 신호별 성과 조회
    if (path === "/api/signal_stats") {
      const stats = await getState(env.DB, "signal_stats", {});
      return Response.json(stats, { headers: cors });
    }
    // [신규] 락 강제 해제 — stuck 됐을 때 복구용
    if (path === "/api/unlock" && request.method === "POST") {
      await releaseCycleLock(env.DB);
      await log(env.DB, "INFO", null, "cycle lock force-released via /api/unlock");
      return Response.json({ ok: true }, { headers: cors });
    }
    // [신규] 진단 — 락 상태, 마지막 tick, 시세 수, 시장 오픈 여부
    if (path === "/api/diag") {
      const lock = await getState(env.DB, "lock:cycle", null);
      const lastTick = await getState(env.DB, "last_tick", null);
      const cfg = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
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
  async scheduled(event, env, ctx) { ctx.waitUntil(runTradingCycle(env)); }
};
