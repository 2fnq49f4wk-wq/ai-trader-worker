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

const DEFAULT_CFG = {
  usTickers: DEFAULT_US,
  krTickers: DEFAULT_KR,
  usFavorites: [],
  krFavorites: [],
  // === 일봉 기반 매수/매도 ===
  rsiBuy: 35, rsiSell: 70, rsiPeriod: 14,
  stopLoss: 5.0,              // 하드 손절 -5% (유지)
  takeProfit1: 4.0,           // 1차 익절 +4% (절반 매도)
  takeProfit2: 8.0,           // 2차 익절 +8% (전량)
  // === 일중 필터 ===
  maxDailyDrop: 5.0,          // 일중 -5% 이상 폭락 종목은 매수 금지 (떨어지는 칼날)
  marketCrashPct: -2.0,       // 지수 -2% 이하면 매수 금지
  // === 수수료 ===
  feeUS: 0.0001, feeKR: 0.0015,
  // === 포지션 사이징 ===
  posSize: 10,                // 기본 10%
  posSizeBear: 6,             // BEAR일 때 6%
  posSizeBull: 12,            // BULL일 때 12%
  // === 일봉 지표 ===
  maPeriod: 20, maShortPeriod: 5,
  atrPeriod: 14, atrStopMult: 2.0,
  bbStdMult: 2.0,             // 볼린저 밴드 ±2σ
  volSpikeMult: 1.5,          // 거래량 1.5배 이상
  // === 트레일링 ===
  trailStartPct: 3.0,         // 본전 +3% 이상부터 트레일링
  trailDropPct: 4.0,          // 최고가 대비 -4% 떨어지면 매도
  // === 시간 손절 ===
  timeStopDays: 3,            // 3일 보유 + 본전 근처 → 청산
  timeStopMaxDays: 7,         // 7일 보유 → 무조건 청산
  minHoldHours: 4,            // 최소 4시간은 보유 (당일 변동 무시)
  // === 캐시 ===
  dailyCacheMinutes: 30,      // 일봉 데이터 30분 캐시
  // === 자본 ===
  initialCashUS: 10000, initialCashKR: 10000000,
  // === 모드 ===
  enabled: true,
  autoTune: true,
  marketHoursOnly: true
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

function getATR(h, p) {
  p = p || 14;
  if (!Array.isArray(h) || h.length < p + 1) return null;
  let s = 0;
  for (let i = h.length - p; i < h.length; i++) s += Math.abs(h[i] - h[i-1]);
  return s / p;
}

// 볼린저 밴드 (상단, 하단)
function getBollingerBands(h, p, mult) {
  p = p || 20; mult = mult || 2.0;
  if (!Array.isArray(h) || h.length < p) return null;
  const ma = getMA(h, p);
  let variance = 0;
  for (let i = h.length - p; i < h.length; i++) variance += Math.pow(h[i] - ma, 2);
  const std = Math.sqrt(variance / p);
  return { upper: ma + mult * std, lower: ma - mult * std, mid: ma };
}

// 연속 음봉 카운트
function countDownDays(h, days) {
  days = days || 5;
  if (!Array.isArray(h) || h.length < days + 1) return 0;
  let count = 0;
  for (let i = h.length - days; i < h.length; i++) {
    if (h[i] < h[i-1]) count++;
  }
  return count;
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

// === 1분봉 (UI + 현재가용) ===
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

// === 일봉 (거래 판단용, 거래량 포함) ===
async function fetchDailyFull(symbol) {
  const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=3mo");
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("no daily data");
  const meta = result.meta || {};
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const closes = filterNulls(quote.close || []);
  const volumes = (quote.volume || []).filter(function(v){ return typeof v === "number" && !isNaN(v) && v > 0; });
  if (closes.length === 0) throw new Error("no daily close");
  const price = (typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0) ? meta.regularMarketPrice : closes[closes.length - 1];
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : price;
  return { symbol: symbol, price: price, prevClose: prevClose, closes: closes, volumes: volumes };
}

// === 일봉 캐시 (30분) ===
async function getDailyCached(DB, symbol, cacheMinutes) {
  const cached = await getState(DB, "daily:" + symbol, null);
  if (cached && cached.ts && (Date.now() - cached.ts) < cacheMinutes * 60 * 1000) {
    return cached;
  }
  const data = await fetchDailyFull(symbol);
  const toCache = {
    closes: data.closes,
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
    }
  }
  if (validIdx === 0) return { regime: "UNKNOWN", avgDayPct: 0, worstDayPct: 0 };
  const avgDayPct = totalDayPct / validIdx;
  let regime = "NEUTRAL";
  if (aboveMa > belowMa) regime = "BULL";
  else if (belowMa > aboveMa) regime = "BEAR";
  return { regime: regime, avgDayPct: avgDayPct, worstDayPct: worstDayPct, aboveMa: aboveMa, belowMa: belowMa };
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
    ts: Date.now()
  });
}
// === 매수 신호 평가 (4가지 중 1개라도 만족) ===
function evaluateBuySignals(price, dayPct, dailyData, cfg) {
  const closes = dailyData.closes;
  const volumes = dailyData.volumes || [];
  
  if (!closes || closes.length < 25) return null;
  
  const dailyRsi = getRSI(closes, cfg.rsiPeriod);
  const dailyRsiPrev = getRSI(closes.slice(0, -1), cfg.rsiPeriod);
  const ma20 = getMA(closes, cfg.maPeriod);
  const ma5 = getMA(closes, cfg.maShortPeriod);
  const bb = getBollingerBands(closes, cfg.maPeriod, cfg.bbStdMult);
  
  if (dailyRsi == null || ma20 == null) return null;
  
  const today = closes[closes.length - 1];
  const yesterday = closes[closes.length - 2];
  const isGreenCandle = today > yesterday;
  
  // 신호 A: RSI 과매도 반전
  if (dailyRsi < cfg.rsiBuy && dailyRsiPrev != null && dailyRsi > dailyRsiPrev) {
    const maGap = ((price - ma20) / ma20) * 100;
    if (maGap >= -10) {
      return { name: "A_RSI_REVERSAL", weight: 1.0, detail: "RSI " + dailyRsi.toFixed(1) + " (prev " + dailyRsiPrev.toFixed(1) + ")" };
    }
  }
  
  // 신호 B: 골든크로스 풀백 (가장 강력)
  if (ma5 != null && ma5 > ma20 && dailyRsi >= 40 && dailyRsi <= 55) {
    const ma5Gap = ((price - ma5) / ma5) * 100;
    if (ma5Gap >= -2 && ma5Gap <= 1) {
      return { name: "B_GOLDEN_PULLBACK", weight: 1.2, detail: "MA5>MA20, gap " + ma5Gap.toFixed(1) + "%" };
    }
  }
  
  // 신호 C: 볼린저 하단 + 반전
  if (bb != null && price <= bb.lower && dailyRsi < 45 && isGreenCandle) {
    return { name: "C_BB_LOWER", weight: 1.0, detail: "BB lower " + bb.lower.toFixed(2) + " + green" };
  }
  
  // 신호 D: 거래량 급증 + 양봉
  if (volumes.length >= 20 && isGreenCandle && dailyRsi >= 45 && dailyRsi <= 65) {
    const todayVol = volumes[volumes.length - 1];
    let avgVol = 0;
    for (let i = volumes.length - 21; i < volumes.length - 1; i++) avgVol += volumes[i];
    avgVol /= 20;
    if (todayVol >= avgVol * cfg.volSpikeMult) {
      return { name: "D_VOL_SPIKE", weight: 1.1, detail: "vol x" + (todayVol/avgVol).toFixed(1) };
    }
  }
  
  return null;
}

// === 매수 차단 필터 (하나라도 걸리면 매수 금지) ===
function evaluateBuyBlocks(price, dayPct, dailyData, cfg, regime) {
  const closes = dailyData.closes;
  if (!closes || closes.length < 25) return "INSUFFICIENT_DATA";
  
  // 1. 시장 폭락
  if (regime.worstDayPct <= cfg.marketCrashPct) return "MARKET_CRASH " + regime.worstDayPct.toFixed(2) + "%";
  
  // 2. 종목 일중 폭락 (떨어지는 칼날)
  if (dayPct <= -cfg.maxDailyDrop) return "FALLING_KNIFE " + dayPct.toFixed(2) + "%";
  
  const ma20 = getMA(closes, cfg.maPeriod);
  const dailyRsi = getRSI(closes, cfg.rsiPeriod);
  
  // 3. MA20 아래 + RSI 40 이상 (하락 진행 중)
  if (ma20 != null && price < ma20 && dailyRsi != null && dailyRsi >= 40) {
    return "DOWNTREND price<MA20 RSI=" + dailyRsi.toFixed(1);
  }
  
  // 4. 최근 5일 중 3일 이상 음봉
  const downDays = countDownDays(closes, 5);
  if (downDays >= 4) return "PERSISTENT_DOWN " + downDays + "/5";
  
  // 5. 변동성 폭증 (ATR이 평소의 2배)
  const atr14 = getATR(closes, cfg.atrPeriod);
  const atr30 = getATR(closes, 30);
  if (atr14 != null && atr30 != null && atr14 > atr30 * 2.0) {
    return "VOLATILITY_SPIKE ATR14=" + atr14.toFixed(2) + " vs ATR30=" + atr30.toFixed(2);
  }
  
  // 6. BEAR + 시장 약함
  if (regime.regime === "BEAR" && regime.worstDayPct <= -1.5) {
    return "BEAR_WEAK worst=" + regime.worstDayPct.toFixed(2) + "%";
  }
  
  return null;
}

async function executeBuy(DB, market, symbol, qty, price, signal, dailyAtr, cfg, cash) {
  const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  if (total > cash[market]) { await log(DB, "WARN", symbol, "BUY aborted: cash short"); return cash; }
  
  // 손절선 계산
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
        atrAtEntry: dailyAtr,
        stopPrice: stopPrice,
        peakPrice: price,
        signal: signal.name,
        tp1Done: false,           // 1차 익절 완료 여부
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
  const proceeds = gross - fee;
  cash[market] += proceeds;
  
  const costPortion = (pos.meta && pos.meta.feePaid ? pos.meta.feePaid : 0) * (sellQty / (pos.meta.originalQty || pos.qty));
  const costBasis = pos.avg * sellQty + costPortion;
  const pnl = proceeds - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
  const heldMin = pos.opened_ts ? Math.floor((Date.now() - pos.opened_ts) / 60000) : 0;
  
  // 부분 매도 vs 전량 매도
  if (sellQty < pos.qty) {
    pos.qty = pos.qty - sellQty;
    pos.meta = pos.meta || {};
    pos.meta.tp1Done = true;
    await savePosition(DB, market, symbol, pos);
  } else {
    await deletePosition(DB, symbol);
  }
  
  await recordTrade(DB, { ts: Date.now(), market: market, symbol: symbol, side: "SELL", qty: sellQty, price: price, pnl: pnl, pnl_pct: pnlPct, reason: reason });
  await log(DB, "TRADE", symbol, "SELL x" + sellQty + " @" + price.toFixed(2) + " PnL " + pnlPct.toFixed(2) + "% (held " + heldMin + "min, " + reason + ")");
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
      const dailyRsi = closes.length >= cfg.rsiPeriod + 1 ? getRSI(closes, cfg.rsiPeriod) : null;
      const dailyMa = closes.length >= cfg.maPeriod ? getMA(closes, cfg.maPeriod) : null;
      const dailyMaShort = closes.length >= cfg.maShortPeriod ? getMA(closes, cfg.maShortPeriod) : null;
      const dailyAtr = closes.length >= cfg.atrPeriod + 1 ? getATR(closes, cfg.atrPeriod) : null;
      const bb = getBollingerBands(closes, cfg.maPeriod, cfg.bbStdMult);
      await saveQuote(DB, symbol, market, {
        price: price, prevClose: prevClose, dayPct: dayPct,
        dailyRsi: dailyRsi, dailyMa: dailyMa, dailyMaShort: dailyMaShort, dailyAtr: dailyAtr,
        bbLower: bb ? bb.lower : null, bbUpper: bb ? bb.upper : null
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
// === autoTune (간소화: 시장 국면 기반) ===
async function autoTune(DB, cfg, regimes) {
  if (!cfg.autoTune) return cfg;
  try {
    const tradesRes = await DB.prepare("SELECT * FROM trades WHERE side = ? ORDER BY ts DESC LIMIT 20").bind("SELL").all();
    const recentSells = tradesRes.results || [];
    if (recentSells.length < 10) return cfg;
    
    const tuneState = await getState(DB, "autotune_state", { lastTunedAt: 0, tradeCountAtLastTune: 0 });
    const totalSells = await DB.prepare("SELECT COUNT(*) as c FROM trades WHERE side = ?").bind("SELL").first();
    const sellCount = totalSells.c || 0;
    if (sellCount - tuneState.tradeCountAtLastTune < 10) return cfg;
    
    const wins = recentSells.filter(function(t){ return t.pnl_pct > 0; });
    const winRate = wins.length / recentSells.length;
    const avgPnl = recentSells.reduce(function(a,t){ return a + t.pnl_pct; }, 0) / recentSells.length;
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
    
    if (changes.length > 0) {
      await setState(DB, "cfg", newCfg);
      await setState(DB, "autotune_state", { lastTunedAt: Date.now(), tradeCountAtLastTune: sellCount });
      await log(DB, "TUNE", null, "[" + dominantRegime + "] WR=" + (winRate*100).toFixed(0) + "% PnL=" + avgPnl.toFixed(2) + "% -> " + changes.join(", "));
      return newCfg;
    }
  } catch (e) { await log(DB, "WARN", null, "autoTune skipped: " + e.message); }
  return cfg;
}

async function runTradingCycle(env) {
  const DB = env.DB;
  await ensureSchema(DB);
  let cfg = Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {}));
  if (!cfg.enabled) { await log(DB, "INFO", null, "engine disabled"); return; }
  
  await log(DB, "INFO", null, "=== Cycle start ===");
  const usOpen = isMarketOpen("us");
  const krOpen = isMarketOpen("kr");
  
  // 지수 fetch
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
  await log(DB, "INFO", null, "Regime US:" + regimes.us.regime + " (worst " + regimes.us.worstDayPct.toFixed(2) + "%), KR:" + regimes.kr.regime + " (worst " + regimes.kr.worstDayPct.toFixed(2) + "%)");
  
  cfg = await autoTune(DB, cfg, regimes);
  const cash = await getState(DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });
  
  let tried = 0, bought = 0, sold = 0, skipped = 0;
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
    
    // 시장 국면별 포지션 사이징
    let posSizeRatio = cfg.posSize / 100;
    if (regime.regime === "BEAR") posSizeRatio = cfg.posSizeBear / 100;
    else if (regime.regime === "BULL") posSizeRatio = cfg.posSizeBull / 100;
    
    for (const symbol of tickers) {
      tried++;
      try {
        const intra = await fetchIntraday(symbol);
        const daily = await getDailyCached(DB, symbol, cfg.dailyCacheMinutes);
        if (!intra.price || intra.price <= 0) { skipped++; continue; }
        
        const price = intra.price;
        const prevClose = intra.prevClose || price;
        const dayPct = ((price - prevClose) / prevClose) * 100;
        const closes = daily.closes || [];
        const dailyRsi = closes.length >= cfg.rsiPeriod + 1 ? getRSI(closes, cfg.rsiPeriod) : null;
        const dailyMa = closes.length >= cfg.maPeriod ? getMA(closes, cfg.maPeriod) : null;
        const dailyMaShort = closes.length >= cfg.maShortPeriod ? getMA(closes, cfg.maShortPeriod) : null;
        const dailyAtr = closes.length >= cfg.atrPeriod + 1 ? getATR(closes, cfg.atrPeriod) : null;
        const bb = getBollingerBands(closes, cfg.maPeriod, cfg.bbStdMult);
        
        await saveQuote(DB, symbol, market, {
          price: price, prevClose: prevClose, dayPct: dayPct,
          dailyRsi: dailyRsi, dailyMa: dailyMa, dailyMaShort: dailyMaShort, dailyAtr: dailyAtr,
          bbLower: bb ? bb.lower : null, bbUpper: bb ? bb.upper : null
        });
        
        if (dailyRsi == null) { skipped++; continue; }
        
        const held = positions[symbol];
        
        if (held) {
          // 기존 stopPrice 보정
          if (held.meta && held.meta.stopPrice != null) {
            const safeStop = held.avg * (1 - cfg.stopLoss / 100);
            if (held.meta.stopPrice > safeStop) {
              held.meta.stopPrice = safeStop;
              try { await savePosition(DB, market, symbol, held); } catch (e) {}
            }
          }
          // peak 갱신
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
          
          // 1. 하드 손절 (-5%)
          if (pnlRate <= -cfg.stopLoss) {
            await executeSell(DB, market, symbol, held, held.qty, price, "HARD-STOP " + pnlRate.toFixed(2) + "%", cfg, cash);
            didSell = true;
          }
          // 2. ATR 손절
          else if (held.meta && held.meta.stopPrice != null && price <= held.meta.stopPrice) {
            await executeSell(DB, market, symbol, held, held.qty, price, "ATR-STOP " + pnlRate.toFixed(2) + "%", cfg, cash);
            didSell = true;
          }
          // 3. 7일 최대 보유 → 무조건 청산
          else if (heldDays >= cfg.timeStopMaxDays) {
            await executeSell(DB, market, symbol, held, held.qty, price, "TIME-MAX " + heldDays.toFixed(1) + "d PnL=" + pnlRate.toFixed(2) + "%", cfg, cash);
            didSell = true;
          }
          // 4. 3일 + 본전 근처 청산
          else if (heldDays >= cfg.timeStopDays && Math.abs(pnlRate) <= 1.5) {
            await executeSell(DB, market, symbol, held, held.qty, price, "TIME-CUT " + heldDays.toFixed(1) + "d PnL=" + pnlRate.toFixed(2) + "%", cfg, cash);
            didSell = true;
          }
          // 5. minHold 통과 후 매도 신호들
          else if (minHoldPassed) {
            // 5a. 1차 익절 (+4%, 절반만)
            if (!tp1Done && pnlRate >= cfg.takeProfit1) {
              const halfQty = Math.floor(held.qty / 2);
              if (halfQty >= 1 && halfQty < held.qty) {
                await executeSell(DB, market, symbol, held, halfQty, price, "TP1 +" + pnlRate.toFixed(2) + "% (half)", cfg, cash);
                didSell = true;
              } else if (halfQty >= 1) {
                await executeSell(DB, market, symbol, held, held.qty, price, "TP1-FULL +" + pnlRate.toFixed(2) + "%", cfg, cash);
                didSell = true;
              }
            }
            // 5b. 2차 익절 (+8%, 전량)
            else if (pnlRate >= cfg.takeProfit2) {
              await executeSell(DB, market, symbol, held, held.qty, price, "TP2 +" + pnlRate.toFixed(2) + "%", cfg, cash);
              didSell = true;
            }
            // 5c. RSI 과매수 + 수익
            else if (dailyRsi > cfg.rsiSell && pnlRate >= 2.0) {
              await executeSell(DB, market, symbol, held, held.qty, price, "RSI " + dailyRsi.toFixed(1) + " +" + pnlRate.toFixed(2) + "%", cfg, cash);
              didSell = true;
            }
            // 5d. 데드크로스 임박 + 수익
            else if (dailyMaShort != null && dailyMa != null && dailyMaShort < dailyMa && pnlRate >= 2.0) {
              const ma5Gap = ((dailyMaShort - dailyMa) / dailyMa) * 100;
              if (ma5Gap < -1) {
                await executeSell(DB, market, symbol, held, held.qty, price, "DEAD-X gap=" + ma5Gap.toFixed(1) + "% +" + pnlRate.toFixed(2) + "%", cfg, cash);
                didSell = true;
              }
            }
            // 5e. 트레일링 스톱 (peak 대비 -4%, 단 +3% 이상 갔다 와야)
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
          if (didSell) sold++;
        } else {
          // === 신규 매수 평가 ===
          const blockReason = evaluateBuyBlocks(price, dayPct, daily, cfg, regime);
          if (blockReason) {
            await log(DB, "NOBUY", symbol, "BLOCK: " + blockReason);
            continue;
          }
          
          const signal = evaluateBuySignals(price, dayPct, daily, cfg);
          if (!signal) {
            await log(DB, "NOBUY", symbol, "no signal (RSI=" + dailyRsi.toFixed(1) + ", day=" + dayPct.toFixed(2) + "%)");
            continue;
          }
          
          // 신호 가중치 적용
          const adjustedRatio = posSizeRatio * signal.weight;
          const budget = cash[market] * adjustedRatio;
          const qty = Math.floor(budget / (price * (1 + feeRate)));
          const totalCost = qty * price * (1 + feeRate);
          if (qty > 0 && totalCost <= cash[market]) {
            await executeBuy(DB, market, symbol, qty, price, signal, dailyAtr, cfg, cash);
            bought++;
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
  await log(DB, "INFO", null, "Done: tried=" + tried + " skip=" + skipped + " buy=" + bought + " sell=" + sold);
  try { await DB.prepare("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)").run(); } catch (e) {}
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
    if (path === "/api/state") {
      const cfg = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
      const cash = await getState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });
      const positionsUS = await getPositions(env.DB, "us");
      const positionsKR = await getPositions(env.DB, "kr");
      const lastTick = await getState(env.DB, "last_tick", null);
      return Response.json({
        cash: cash, positions: { us: positionsUS, kr: positionsKR },
        lastTick: lastTick, cfg: cfg,
        marketStatus: { us: isMarketOpen("us"), kr: isMarketOpen("kr") }
      }, { headers: cors });
    }
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
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not Found", { status: 404, headers: cors });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: cors });
  }
}

export default {
  async fetch(request, env, ctx) { return handleRequest(request, env); },
  async scheduled(event, env, ctx) { ctx.waitUntil(runTradingCycle(env)); }
};
