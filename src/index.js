// ============================================================
// LUX-engine V7.1 (버그 수정판)
// V7 -> V7.1 변경점:
//  • Cycle Lock을 atomic INSERT로 교체 (D1 race condition 차단)
//  • ATR을 진짜 True Range로 변경 (high/low 사용, fallback 있음)
//  • 분할매도 시 진입수수료 비례 차감 (feeRemaining 필드)
//  • AutoTune reason 파싱 구분자를 #entry= 로 변경 (충돌 방지)
//  • Confluence type 모순 검사 추가 (COUNTER+TREND 혼합은 페널티)
//  • 신호별 perfMult 최소표본 5→20, Bayesian shrinkage 적용
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
  posSize: 10,
  posSizeBear: 6,
  posSizeBull: 12,
  maPeriod: 20, maShortPeriod: 5,
  atrPeriod: 14, atrStopMult: 2.0,
  bbStdMult: 2.0,
  volSpikeMult: 1.5,
  trailStartPct: 3.0,
  trailDropPct: 4.0,
  timeStopDays: 3,
  timeStopMaxDays: 7,
  minHoldHours: 4,
  dailyCacheMinutes: 10,
  initialCashUS: 10000, initialCashKR: 10000000,
  enabled: true,
  autoTune: true,
  marketHoursOnly: true,
  // === [신규] Confluence ===
  requireConfluence: true,      // 단독 신호 차단
  soloSignalWeight: 0.6,        // 단독 신호 허용 시 가중치 감소
  confluenceBonus: 1.3,         // 2개 이상 합의 시 보너스
  allowMixedConfluence: true,   // [신규] COUNTER+TREND 혼합 합의 허용 여부
  mixedConfluencePenalty: 0.8,  // [신규] 혼합 합의 가중치 (1.0 미만 = 페널티)
  // === [신규] 상대강도 ===
  rsFilterEnabled: true,
  rsLookbackDays: 20,
  rsMinOutperform: -2.0,        // 지수 대비 -2%까지 허용
  // === [신규] 섹터 / 페어 제한 ===
  maxPositionsPerSector: 2,
  blockInversePair: true,
  // === [신규] 사이클 락 ===
  cycleLockTTL: 60000
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

async function ensureSchema(DB) {
  try {
    const cols = await DB.prepare("PRAGMA table_info(positions)").all();
    const hasMeta = (cols.results || []).some(function(c){ return c.name === "meta"; });
    if (!hasMeta) {
      try {
        await DB.prepare("ALTER TABLE positions ADD COLUMN meta TEXT").run();
        await log(DB, "INFO", null, "schema migrated: added meta column to positions");
      } catch (e) { console.error("alter fail:", e.message); }
    }
  } catch (e) {
    try {
      await DB.prepare("CREATE TABLE IF NOT EXISTS positions (symbol TEXT PRIMARY KEY, market TEXT NOT NULL, qty REAL NOT NULL, avg_price REAL NOT NULL, opened_ts INTEGER NOT NULL, meta TEXT)").run();
    } catch (e2) { console.error("schema ensure fail:", e2.message); }
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

async function getPositions(DB, market) {
  try {
    const res = await DB.prepare("SELECT * FROM positions WHERE market = ?").bind(market).all();
    const map = {};
    for (const p of res.results) {
      map[p.symbol] = { qty: p.qty, avg: p.avg_price, opened_ts: p.opened_ts, meta: p.meta ? JSON.parse(p.meta) : {} };
    }
    return map;
  } catch (e) { return {}; }
}

async function savePosition(DB, market, symbol, pos) {
  await DB.prepare("INSERT INTO positions (symbol, market, qty, avg_price, opened_ts, meta) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET qty=excluded.qty, avg_price=excluded.avg_price, meta=excluded.meta")
    .bind(symbol, market, pos.qty, pos.avg, pos.opened_ts, JSON.stringify(pos.meta || {})).run();
}

async function deletePosition(DB, symbol) {
  await DB.prepare("DELETE FROM positions WHERE symbol = ?").bind(symbol).run();
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

// === [개선] 매수 신호 평가 — 발화한 모든 신호의 배열을 반환 ===
function evaluateBuySignals(price, dayPct, dailyData, cfg) {
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

  // A: RSI 과매도 반전
  if (dailyRsi < cfg.rsiBuy && dailyRsiPrev != null && dailyRsi > dailyRsiPrev) {
    const maGap = ((price - ma20) / ma20) * 100;
    if (maGap >= -10) {
      signals.push({ name: "A_RSI_REVERSAL", weight: 1.0, type: "COUNTER", detail: "RSI " + dailyRsi.toFixed(1) + " (prev " + dailyRsiPrev.toFixed(1) + ")" });
    }
  }
  // B: 골든크로스 풀백
  if (ma5 != null && ma5 > ma20 && dailyRsi >= 40 && dailyRsi <= 60) {
    const ma5Gap = ((price - ma5) / ma5) * 100;
    if (ma5Gap >= -3 && ma5Gap <= 2) {
      signals.push({ name: "B_GOLDEN_PULLBACK", weight: 1.2, type: "TREND", detail: "MA5>MA20 gap " + ma5Gap.toFixed(1) + "%" });
    }
  }
  // C: 볼린저 하단 반전
  if (bb != null && price <= bb.lower && dailyRsi < 45 && isGreenCandle) {
    signals.push({ name: "C_BB_LOWER", weight: 1.0, type: "COUNTER", detail: "BB lower " + bb.lower.toFixed(2) + " green" });
  }
  // D: 거래량 급증 + 양봉
  if (volumes.length >= 20 && isGreenCandle && dailyRsi >= 45 && dailyRsi <= 65) {
    const todayVol = volumes[volumes.length - 1];
    let avgVol = 0;
    for (let i = volumes.length - 21; i < volumes.length - 1; i++) avgVol += volumes[i];
    avgVol /= 20;
    if (todayVol >= avgVol * cfg.volSpikeMult) {
      signals.push({ name: "D_VOL_SPIKE", weight: 1.1, type: "TREND", detail: "vol x" + (todayVol/avgVol).toFixed(1) });
    }
  }
  return signals;
}

// === [수정] Confluence 해석 — type 모순 차단 + 단독/합의 처리 + 신호별 승률 반영 ===
function resolveSignals(signals, cfg, signalStats) {
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

// === [개선] 매수 차단 필터 — RS, 인버스 페어, 섹터 제한 추가 ===
function evaluateBuyBlocks(price, dayPct, dailyData, cfg, regime, signal, ctx) {
  const closes = dailyData.closes;
  if (!closes || closes.length < 25) return "INSUFFICIENT_DATA";

  if (regime.worstDayPct <= cfg.marketCrashPct) return "MARKET_CRASH " + regime.worstDayPct.toFixed(2) + "%";
  if (dayPct <= -cfg.maxDailyDrop) return "FALLING_KNIFE " + dayPct.toFixed(2) + "%";

  const ma20 = getMA(closes, cfg.maPeriod);
  const dailyRsi = getRSI(closes, cfg.rsiPeriod);

  if (!signal.isCounterTrend && ma20 != null && price < ma20 && dailyRsi != null && dailyRsi >= 40) {
    return "DOWNTREND price<MA20 RSI=" + dailyRsi.toFixed(1);
  }
  const downDays = countDownDays(closes, 5);
  if (downDays >= 4) return "PERSISTENT_DOWN " + downDays + "/5";
  // [수정] True Range ATR로 변동성 스파이크 감지
  const highs = dailyData.highs || null;
  const lows = dailyData.lows || null;
  const atr14 = getATR(closes, cfg.atrPeriod, highs, lows);
  const atr30 = getATR(closes, 30, highs, lows);
  if (atr14 != null && atr30 != null && atr14 > atr30 * 2.0) {
    return "VOLATILITY_SPIKE ATR14=" + atr14.toFixed(2) + " ATR30=" + atr30.toFixed(2);
  }
  if (regime.regime === "BEAR" && regime.worstDayPct <= -1.5) {
    return "BEAR_WEAK worst=" + regime.worstDayPct.toFixed(2) + "%";
  }

  // [신규] 상대강도 필터 — 역추세 신호는 면제
  if (cfg.rsFilterEnabled && !signal.isCounterTrend && regime.idxReturn20 != null) {
    const stockRet = getNDayReturn(closes, cfg.rsLookbackDays);
    if (stockRet != null) {
      const relPerf = stockRet - regime.idxReturn20;
      if (relPerf < cfg.rsMinOutperform) {
        return "WEAK_RS stock=" + stockRet.toFixed(1) + "% idx=" + regime.idxReturn20.toFixed(1) + "% rel=" + relPerf.toFixed(1) + "%";
      }
    }
  }

  // [신규] 인버스 페어 차단
  if (cfg.blockInversePair && ctx && ctx.heldSymbols) {
    const inv = INVERSE_PAIRS[ctx.symbol];
    if (inv && ctx.heldSymbols.has(inv)) {
      return "INVERSE_HELD " + inv;
    }
  }

  // [신규] 섹터 동시 보유 제한
  if (cfg.maxPositionsPerSector && ctx && ctx.sectorCounts) {
    const sec = SECTOR_MAP[ctx.symbol];
    if (sec) {
      const cur = ctx.sectorCounts[sec] || 0;
      if (cur >= cfg.maxPositionsPerSector) {
        return "SECTOR_FULL " + sec + " (" + cur + "/" + cfg.maxPositionsPerSector + ")";
      }
    }
  }

  return null;
}

async function executeBuy(DB, market, symbol, qty, price, signal, dailyAtr, cfg, cash) {
  const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  if (total > cash[market]) { await log(DB, "WARN", symbol, "BUY aborted: cash short"); return cash; }

  const pctStop = price * (1 - cfg.stopLoss / 100);
  let stopPrice = pctStop;
  if (dailyAtr) {
    const atrStop = price - dailyAtr * cfg.atrStopMult;
    stopPrice = Math.min(atrStop, pctStop);
  }
  const maxStopPrice = price * (1 - cfg.stopLoss / 100);
  if (stopPrice > maxStopPrice) stopPrice = maxStopPrice;

  try {
    await savePosition(DB, market, symbol, {
      qty: qty, avg: price, opened_ts: Date.now(),
      meta: {
        feePaid: fee,
        feeRemaining: fee,             // [수정] 분할매도 시 차감해 가는 진입수수료 잔액
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
  await recordTrade(DB, { ts: Date.now(), market: market, symbol: symbol, side: "BUY", qty: qty, price: price, reason: signal.name + " " + signal.detail });
  const stopPct = ((stopPrice - price) / price * 100).toFixed(1);
  await log(DB, "TRADE", symbol, "BUY x" + qty + " @" + price.toFixed(2) + " [" + signal.name + "] " + signal.detail + " stop=" + stopPrice.toFixed(2) + "(" + stopPct + "%)");
  return cash;
}

async function executeSell(DB, market, symbol, pos, sellQty, price, reason, cfg, cash) {
  const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
  const gross = price * sellQty;
  const fee = gross * feeRate;
  const sellTax = market === "kr" ? gross * (cfg.krSellTax || 0) : 0;
  const proceeds = gross - fee - sellTax;
  cash[market] += proceeds;

  // [수정] 진입수수료를 sellQty 비례로 분할 — feeRemaining에서 차감해 중복 계산 방지
  pos.meta = pos.meta || {};
  const origQty = pos.meta.originalQty || pos.qty;
  const feeRemaining = (typeof pos.meta.feeRemaining === "number")
    ? pos.meta.feeRemaining
    : (pos.meta.feePaid || 0);
  const entryFeePortion = feeRemaining * (sellQty / Math.max(origQty - (origQty - pos.qty), 1));
  // 위 식은 직관적이지 않아 정리:
  // 남은 진입수량 = pos.qty (이번 매도 직전)
  // 이번 매도 비중 = sellQty / pos.qty (직전 남은 수량 대비)
  // → 잔여 수수료 중 이 비중만큼 차감
  const entryFeeForThisSell = feeRemaining * (sellQty / pos.qty);
  const costBasis = pos.avg * sellQty + entryFeeForThisSell;
  const pnl = proceeds - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
  const heldMin = pos.opened_ts ? Math.floor((Date.now() - pos.opened_ts) / 60000) : 0;

  // [수정] 매도 사유 인코딩 — '#entry=' 구분자로 파싱 충돌 차단
  const signalMembers = pos.meta.signalMembers || [];
  const enrichedReason = reason + " #entry=" + signalMembers.join(",");

  if (sellQty < pos.qty) {
    pos.qty = pos.qty - sellQty;
    pos.meta.tp1Done = true;
    pos.meta.feeRemaining = Math.max(0, feeRemaining - entryFeeForThisSell);  // [신규]
    await savePosition(DB, market, symbol, pos);
  } else {
    await deletePosition(DB, symbol);
  }

  await recordTrade(DB, { ts: Date.now(), market: market, symbol: symbol, side: "SELL", qty: sellQty, price: price, pnl: pnl, pnl_pct: pnlPct, reason: enrichedReason });
  const taxNote = market === "kr" ? " tax=" + sellTax.toFixed(2) : "";
  await log(DB, "TRADE", symbol, "SELL x" + sellQty + " @" + price.toFixed(2) + " PnL " + pnlPct.toFixed(2) + "% (held " + heldMin + "min, " + reason + ")" + taxNote);
  return { cash: cash, pnlPct: pnlPct };
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

    // [신규] 승률 기반 Confluence 토글
    if (winRate < 0.40 && !cfg.requireConfluence) {
      newCfg.requireConfluence = true;
      changes.push("CONF=ON (WR low)");
    } else if (winRate > 0.60 && cfg.requireConfluence) {
      newCfg.requireConfluence = false;
      changes.push("CONF=OFF (WR high)");
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
  if (!cfg.enabled) { await log(DB, "INFO", null, "engine disabled"); return; }

  // [신규] Cycle Lock — 동시 실행 차단
  const gotLock = await acquireCycleLock(DB, cfg.cycleLockTTL || 60000);
  if (!gotLock) {
    await log(DB, "INFO", null, "cycle skipped: lock held");
    return;
  }

  try {
    await log(DB, "INFO", null, "=== Cycle start (V7) ===");
    const usOpen = isMarketOpen("us");
    const krOpen = isMarketOpen("kr");

    if (usOpen) {
      for (const idx of US_INDICES) {
        try { const d = await fetchIndexDaily(idx); await saveIndex(DB, idx, "us", d); }
        catch (e) { await log(DB, "WARN", idx, "index fetch fail: " + e.message); }
      }
    }
    if (krOpen) {
      for (const idx of KR_INDICES) {
        try { const d = await fetchIndexDaily(idx); await saveIndex(DB, idx, "kr", d); }
        catch (e) { await log(DB, "WARN", idx, "index fetch fail: " + e.message); }
      }
    }

    const regimes = {
      us: await analyzeMarketRegime(DB, "us"),
      kr: await analyzeMarketRegime(DB, "kr")
    };
    await log(DB, "INFO", null, "Regime US:" + regimes.us.regime + " (worst " + regimes.us.worstDayPct.toFixed(2) + "%, idx20=" + (regimes.us.idxReturn20 != null ? regimes.us.idxReturn20.toFixed(1) : "?") + "%), KR:" + regimes.kr.regime + " (worst " + regimes.kr.worstDayPct.toFixed(2) + "%, idx20=" + (regimes.kr.idxReturn20 != null ? regimes.kr.idxReturn20.toFixed(1) : "?") + "%)");

    cfg = await autoTune(DB, cfg, regimes);
    const signalStats = await getState(DB, "signal_stats", {});
    const cash = await getState(DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });

    let tried = 0, bought = 0, sold = 0, skipped = 0, fetchFail = 0;
    const marketsToTrade = [];
    if (usOpen) marketsToTrade.push("us");
    if (krOpen) marketsToTrade.push("kr");
    if (marketsToTrade.length === 0 && cfg.marketHoursOnly) {
      await log(DB, "CLOSED", null, "US & KR 모두 장 마감");
      await setState(DB, "last_tick", Date.now());
      return;
    }

    for (const market of marketsToTrade) {
      const tickers = market === "us" ? cfg.usTickers : cfg.krTickers;
      const positions = await getPositions(DB, market);
      const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
      const regime = regimes[market];

      // [신규] 보유 심볼 집합 + 섹터 카운트 (매수 차단용)
      const heldSymbols = new Set(Object.keys(positions));
      const sectorCounts = {};
      for (const sym of heldSymbols) {
        const sec = SECTOR_MAP[sym];
        if (sec) sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
      }

      let posSizeRatio = cfg.posSize / 100;
      if (regime.regime === "BEAR") posSizeRatio = cfg.posSizeBear / 100;
      else if (regime.regime === "BULL") posSizeRatio = cfg.posSizeBull / 100;

      for (const symbol of tickers) {
        tried++;
        try {
          // [개선] intraday 실패 fallback
          let intra = null, daily = null;
          let intraOk = false;
          try {
            intra = await fetchIntraday(symbol);
            if (intra && intra.price > 0) intraOk = true;
          } catch (e) {
            fetchFail++;
            await log(DB, "WARN", symbol, "intraday fail: " + e.message);
          }
          try {
            daily = await getDailyCached(DB, symbol, cfg.dailyCacheMinutes);
          } catch (e) {
            fetchFail++;
            await log(DB, "WARN", symbol, "daily fail: " + e.message);
            skipped++;
            continue;
          }

          let price, prevClose;
          if (intraOk) {
            price = intra.price;
            prevClose = intra.prevClose || price;
          } else if (daily && daily.closes && daily.closes.length > 0) {
            // [신규] intraday 실패 → daily 마지막 종가 사용 (손절 평가는 가능)
            price = daily.closes[daily.closes.length - 1];
            prevClose = daily.prevClose || price;
            await log(DB, "INFO", symbol, "using daily fallback price");
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

          const held = positions[symbol];

          if (held) {
            // === 매도 평가 (기존 로직 유지) ===
            if (held.meta && held.meta.stopPrice != null) {
              const safeStop = held.avg * (1 - cfg.stopLoss / 100);
              if (held.meta.stopPrice > safeStop) {
                held.meta.stopPrice = safeStop;
                try { await savePosition(DB, market, symbol, held); } catch (e) {}
              }
            }
            if (held.meta && held.meta.peakPrice != null && price > held.meta.peakPrice) {
              held.meta.peakPrice = price;
              try { await savePosition(DB, market, symbol, held); } catch (e) {}
            }

            const pnlRate = ((price - held.avg) / held.avg) * 100;
            const peakPrice = held.meta && held.meta.peakPrice;
            const peakPnlPct = peakPrice ? ((peakPrice - held.avg) / held.avg * 100) : 0;
            const heldMin = held.opened_ts ? (Date.now() - held.opened_ts) / 60000 : 0;
            const heldHours = heldMin / 60;
            const heldDays = heldHours / 24;
            const minHoldPassed = heldHours >= cfg.minHoldHours;
            const tp1Done = held.meta && held.meta.tp1Done;

            let didSell = false;

            if (pnlRate <= -cfg.stopLoss) {
              await executeSell(DB, market, symbol, held, held.qty, price, "HARD-STOP " + pnlRate.toFixed(2) + "%", cfg, cash);
              didSell = true;
            }
            else if (held.meta && held.meta.stopPrice != null && price <= held.meta.stopPrice) {
              await executeSell(DB, market, symbol, held, held.qty, price, "ATR-STOP " + pnlRate.toFixed(2) + "%", cfg, cash);
              didSell = true;
            }
            else if (heldDays >= cfg.timeStopMaxDays) {
              await executeSell(DB, market, symbol, held, held.qty, price, "TIME-MAX " + heldDays.toFixed(1) + "d PnL=" + pnlRate.toFixed(2) + "%", cfg, cash);
              didSell = true;
            }
            else if (heldDays >= cfg.timeStopDays && Math.abs(pnlRate) <= 1.5) {
              await executeSell(DB, market, symbol, held, held.qty, price, "TIME-CUT " + heldDays.toFixed(1) + "d PnL=" + pnlRate.toFixed(2) + "%", cfg, cash);
              didSell = true;
            }
            else if (minHoldPassed) {
              if (!tp1Done && pnlRate >= cfg.takeProfit1) {
                const halfQty = Math.floor(held.qty / 2);
                if (halfQty > 0) {
                  await executeSell(DB, market, symbol, held, halfQty, price, "TP1-HALF +" + pnlRate.toFixed(2) + "%", cfg, cash);
                  didSell = true;
                } else {
                  await executeSell(DB, market, symbol, held, held.qty, price, "TP1-FULL +" + pnlRate.toFixed(2) + "%", cfg, cash);
                  didSell = true;
                }
              }
              else if (pnlRate >= cfg.takeProfit2) {
                await executeSell(DB, market, symbol, held, held.qty, price, "TP2 +" + pnlRate.toFixed(2) + "%", cfg, cash);
                didSell = true;
              }
              else if (dailyRsi > cfg.rsiSell && pnlRate >= 2.0) {
                await executeSell(DB, market, symbol, held, held.qty, price, "RSI " + dailyRsi.toFixed(1) + " +" + pnlRate.toFixed(2) + "%", cfg, cash);
                didSell = true;
              }
              else if (dailyMaShort != null && dailyMa != null && dailyMaShort < dailyMa && pnlRate >= 2.0) {
                const ma5Gap = ((dailyMaShort - dailyMa) / dailyMa) * 100;
                if (ma5Gap < -1) {
                  await executeSell(DB, market, symbol, held, held.qty, price, "DEAD-X gap=" + ma5Gap.toFixed(1) + "% +" + pnlRate.toFixed(2) + "%", cfg, cash);
                  didSell = true;
                }
              }
              else if (peakPnlPct >= cfg.trailStartPct && pnlRate >= 2.0) {
                const trailStop = peakPrice * (1 - cfg.trailDropPct / 100);
                if (price <= trailStop) {
                  await executeSell(DB, market, symbol, held, held.qty, price, "TRAIL peak=" + peakPrice.toFixed(2) + " +" + pnlRate.toFixed(2) + "%", cfg, cash);
                  didSell = true;
                }
              }
            } else {
              await log(DB, "INFO", symbol, "MIN-HOLD lock (" + heldHours.toFixed(1) + "h/" + cfg.minHoldHours + "h, PnL " + pnlRate.toFixed(2) + "%)");
            }
            if (didSell) {
              sold++;
              // 전량 매도 시 섹터 카운트 갱신
              if (!positions[symbol] || positions[symbol].qty === 0) {
                heldSymbols.delete(symbol);
                const sec = SECTOR_MAP[symbol];
                if (sec && sectorCounts[sec]) sectorCounts[sec]--;
              }
            }
          } else {
            // === [개선] 신규 매수 — Confluence 평가 ===

            // intraday 실패 종목은 신규 매수 금지
            if (!intraOk) {
              await log(DB, "NOBUY", symbol, "skip new entry (intraday fetch failed)");
              continue;
            }

            // 1) 모든 매수 신호 수집
            const allSignals = evaluateBuySignals(price, dayPct, daily, cfg);

            // 2) Confluence 해석
            const signal = resolveSignals(allSignals, cfg, signalStats);
            if (!signal) {
              if (allSignals.length === 0) {
                await log(DB, "NOBUY", symbol, "no signal (RSI=" + dailyRsi.toFixed(1) + ", day=" + dayPct.toFixed(2) + "%)");
              } else {
                await log(DB, "NOBUY", symbol, "SOLO blocked: " + allSignals[0].name);
              }
              continue;
            }

            // 3) 차단 필터 (RS / 인버스 / 섹터 포함)
            const ctx = { symbol: symbol, heldSymbols: heldSymbols, sectorCounts: sectorCounts };
            const blockReason = evaluateBuyBlocks(price, dayPct, daily, cfg, regime, signal, ctx);
            if (blockReason) {
              await log(DB, "NOBUY", symbol, "BLOCK[" + signal.name + "]: " + blockReason);
              continue;
            }

            const adjustedRatio = posSizeRatio * signal.weight;
            const budget = cash[market] * adjustedRatio;
            const qty = Math.floor(budget / (price * (1 + feeRate)));
            const totalCost = qty * price * (1 + feeRate);
            if (qty > 0 && totalCost <= cash[market]) {
              await executeBuy(DB, market, symbol, qty, price, signal, dailyAtr, cfg, cash);
              bought++;
              // 같은 사이클 내 다음 종목 평가에 즉시 반영
              heldSymbols.add(symbol);
              const sec = SECTOR_MAP[symbol];
              if (sec) sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
            } else {
              await log(DB, "NOBUY", symbol, "cash short for " + signal.name);
            }
          }
        } catch (e) {
          await log(DB, "ERROR", symbol, e.message);
        }
      }
    }

    try { await setState(DB, "cash", cash); } catch (e) {}
    try { await setState(DB, "last_tick", Date.now()); } catch (e) {}
    await log(DB, "INFO", null, "Done: tried=" + tried + " skip=" + skipped + " buy=" + bought + " sell=" + sold + " fetchFail=" + fetchFail);
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
      const positionsUS = await getPositions(env.DB, "us");
      const positionsKR = await getPositions(env.DB, "kr");
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
        positions: { us: positionsUS, kr: positionsKR },
        lastTick: lastTick, cfg: cfg,
        marketStatus: { us: isMarketOpen("us"), kr: isMarketOpen("kr") },
        watchlist: quotes,       // [신규] 프론트 폴링 통합용
        indices: indices,        // [신규]
        signalStats: signalStats // [신규]
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
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not Found", { status: 404, headers: cors });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: cors });
  }
}

export default {
  async fetch(request, env, ctx) { return handleRequest(request, env); },
  async scheduled(event, env, ctx) { ctx.waitUntil(runTradingCycle(env)); }
};
