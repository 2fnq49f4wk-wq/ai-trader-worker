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
  rsiBuy: 32, rsiSell: 65, rsiPeriod: 14,
  stopLoss: 10, takeProfit: 6,
  dayBuyPct: 1.0, daySellPct: 5,
  feeUS: 0.0001, feeKR: 0.0015,
  posSize: 10,
  maPeriod: 20, atrPeriod: 14,
  atrStopMult: 2.5, trailMult: 3.0,        // [수정] 2.0 -> 3.0
  minHoldMin: 30,
  maxHoldHours: 72,
  marketCrashPct: -2.0,
  minStopPct: 5.0,
  minProfitToSell: 2.0,                    // [신규] 트레일/RSI 매도 시 최소 +2% 수익 강제
  trailStartPct: 3.0,                      // [수정] 0.5 -> 3.0
  initialCashUS: 10000, initialCashKR: 10000000,
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

function filterNulls(rawArr) {
  const out = [];
  for (let i = 0; i < rawArr.length; i++) {
    const v = rawArr[i];
    if (typeof v === "number" && !isNaN(v) && v > 0) {
      out.push(v);
    }
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

async function fetchPrice(symbol) {
  let intradayCloses = [];
  let intradayMeta = null;
  let dailyCloses = [];
  let dailyMeta = null;

  try {
    const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1m&range=5d");
    const result = j && j.chart && j.chart.result && j.chart.result[0];
    if (result) {
      intradayMeta = result.meta || {};
      const raw = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
      intradayCloses = filterNulls(raw);
    }
  } catch (e) { /* fall through */ }

  try {
    const j2 = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=3mo");
    const result2 = j2 && j2.chart && j2.chart.result && j2.chart.result[0];
    if (result2) {
      dailyMeta = result2.meta || {};
      const raw2 = (result2.indicators && result2.indicators.quote && result2.indicators.quote[0] && result2.indicators.quote[0].close) || [];
      dailyCloses = filterNulls(raw2);
    }
  } catch (e) { /* fall through */ }

  if (intradayCloses.length >= 20 && intradayMeta) {
    const price = (typeof intradayMeta.regularMarketPrice === "number" && intradayMeta.regularMarketPrice > 0) ? intradayMeta.regularMarketPrice : intradayCloses[intradayCloses.length - 1];
    const prevClose = (typeof intradayMeta.chartPreviousClose === "number" && intradayMeta.chartPreviousClose > 0) ? intradayMeta.chartPreviousClose : (intradayMeta.previousClose || intradayCloses[0]);
    return { symbol: symbol, price: price, prevClose: prevClose, history: intradayCloses, daily: dailyCloses };
  }

  if (dailyCloses.length > 0 && dailyMeta) {
    const price = (typeof dailyMeta.regularMarketPrice === "number" && dailyMeta.regularMarketPrice > 0) ? dailyMeta.regularMarketPrice : dailyCloses[dailyCloses.length - 1];
    const prevClose = dailyCloses.length >= 2 ? dailyCloses[dailyCloses.length - 2] : (dailyMeta.chartPreviousClose || dailyMeta.previousClose || price);
    return { symbol: symbol, price: price, prevClose: prevClose, history: dailyCloses, daily: dailyCloses };
  }

  try {
    const j3 = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=1y");
    const result3 = j3 && j3.chart && j3.chart.result && j3.chart.result[0];
    if (result3) {
      const meta3 = result3.meta || {};
      const raw3 = (result3.indicators && result3.indicators.quote && result3.indicators.quote[0] && result3.indicators.quote[0].close) || [];
      const daily = filterNulls(raw3);
      if (daily.length > 0) {
        const price = (typeof meta3.regularMarketPrice === "number" && meta3.regularMarketPrice > 0) ? meta3.regularMarketPrice : daily[daily.length - 1];
        const prevClose = daily.length >= 2 ? daily[daily.length - 2] : (meta3.chartPreviousClose || meta3.previousClose || price);
        return { symbol: symbol, price: price, prevClose: prevClose, history: daily, daily: daily };
      }
    }
  } catch (e) { /* fall through */ }

  if (intradayCloses.length > 0 && intradayMeta) {
    const price = (typeof intradayMeta.regularMarketPrice === "number" && intradayMeta.regularMarketPrice > 0) ? intradayMeta.regularMarketPrice : intradayCloses[intradayCloses.length - 1];
    const prevClose = (typeof intradayMeta.chartPreviousClose === "number" && intradayMeta.chartPreviousClose > 0) ? intradayMeta.chartPreviousClose : (intradayMeta.previousClose || price);
    return { symbol: symbol, price: price, prevClose: prevClose, history: intradayCloses, daily: [] };
  }

  throw new Error("no data from any endpoint");
}

async function fetchDaily(symbol) {
  const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=3mo");
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("no daily data");
  const meta = result.meta || {};
  const raw = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
  const closes = filterNulls(raw);
  if (closes.length === 0) throw new Error("no daily close");
  const price = (typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0) ? meta.regularMarketPrice : closes[closes.length - 1];
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : price;
  return { symbol: symbol, price: price, prevClose: prevClose, history: closes };
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

  if (validIdx === 0) return { regime: "UNKNOWN", avgDayPct: 0, worstDayPct: 0, crashing: false };

  const avgDayPct = totalDayPct / validIdx;
  let regime = "NEUTRAL";
  if (aboveMa > belowMa) regime = "BULL";
  else if (belowMa > aboveMa) regime = "BEAR";

  return {
    regime: regime,
    avgDayPct: avgDayPct,
    worstDayPct: worstDayPct,
    aboveMa: aboveMa,
    belowMa: belowMa,
    crashing: false
  };
}

async function executeBuy(DB, market, symbol, qty, price, reason, dailyAtr, cfg, cash) {
  const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  if (total > cash[market]) { await log(DB, "WARN", symbol, "BUY aborted: cash short"); return cash; }

  // [수정] 무조건 매수가 -minStopPct% 이하에서만 손절 (안전 가드 강화)
  const pctStop = price * (1 - cfg.minStopPct / 100);
  let stopPrice = pctStop;
  
  if (dailyAtr) {
    const atrStop = price - dailyAtr * cfg.atrStopMult;
    // atrStop vs pctStop 중 더 먼 쪽 = 더 작은 값
    stopPrice = Math.min(atrStop, pctStop);
  }
  
  // 안전 가드: 손절선이 minStopPct보다 가까우면 강제로 조정
  const maxStopPrice = price * (1 - cfg.minStopPct / 100);
  if (stopPrice > maxStopPrice) stopPrice = maxStopPrice;

  try {
    await savePosition(DB, market, symbol, {
      qty: qty, avg: price, opened_ts: Date.now(),
      meta: {
        feePaid: fee,
        atrAtEntry: dailyAtr,
        stopPrice: stopPrice,
        peakPrice: price,
        usedCfg: { rsiBuy: cfg.rsiBuy, dayBuyPct: cfg.dayBuyPct, atrStopMult: cfg.atrStopMult, trailMult: cfg.trailMult, minHoldMin: cfg.minHoldMin }
      }
    });
  } catch (e) {
    await log(DB, "ERROR", symbol, "BUY savePosition fail (no cash deducted): " + e.message);
    return cash;
  }

  cash[market] -= total;
  await recordTrade(DB, { ts: Date.now(), market: market, symbol: symbol, side: "BUY", qty: qty, price: price, reason: reason });
  const stopPct = ((stopPrice - price) / price * 100).toFixed(1);
  await log(DB, "TRADE", symbol, "BUY x" + qty + " @" + price.toFixed(2) + " (" + reason + ") stop=" + stopPrice.toFixed(2) + " (" + stopPct + "%)");
  return cash;
}

async function executeSell(DB, market, symbol, pos, price, reason, cfg, cash) {
  const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
  const gross = price * pos.qty;
  const fee = gross * feeRate;
  const proceeds = gross - fee;
  cash[market] += proceeds;
  const costBasis = pos.avg * pos.qty + ((pos.meta && pos.meta.feePaid) || 0);
  const pnl = proceeds - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
  const heldMin = pos.opened_ts ? Math.floor((Date.now() - pos.opened_ts) / 60000) : 0;
  await deletePosition(DB, symbol);
  await recordTrade(DB, { ts: Date.now(), market: market, symbol: symbol, side: "SELL", qty: pos.qty, price: price, pnl: pnl, pnl_pct: pnlPct, reason: reason });
  await log(DB, "TRADE", symbol, "SELL @" + price.toFixed(2) + " PnL " + pnlPct.toFixed(2) + "% (held " + heldMin + "min, " + reason + ")");
  return { cash: cash, pnlPct: pnlPct, usedCfg: pos.meta && pos.meta.usedCfg };
}

async function saveQuote(DB, symbol, market, q) {
  await setState(DB, "quote:" + symbol, {
    market: market, price: q.price, prevClose: q.prevClose,
    dayPct: q.dayPct, rsi: q.rsi, ma: q.ma, atr: q.atr,
    dailyAtr: q.dailyAtr, dailyMa: q.dailyMa,
    ts: Date.now()
  });
}

async function saveIndex(DB, symbol, region, data) {
  const dayPct = data.prevClose ? ((data.price - data.prevClose) / data.prevClose) * 100 : 0;
  await setState(DB, "index:" + symbol, {
    region: region, price: data.price, prevClose: data.prevClose,
    dayPct: dayPct, history: data.history.slice(-60), ts: Date.now()
  });
}

async function refreshQuotesOnly(env, market) {
  const DB = env.DB;
  await ensureSchema(DB);
  const cfg = Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {}));

  await log(DB, "INFO", null, "=== Manual quote refresh: " + market.toUpperCase() + " ===");

  const indices = market === "us" ? US_INDICES : KR_INDICES;
  for (const idx of indices) {
    try { const d = await fetchDaily(idx); await saveIndex(DB, idx, market, d); }
    catch (e) { await log(DB, "WARN", idx, "index fetch fail: " + e.message); }
  }

  const tickers = market === "us" ? cfg.usTickers : cfg.krTickers;
  let ok = 0, fail = 0;

  for (const symbol of tickers) {
    try {
      const data = await fetchPrice(symbol);
      if (!data.price || data.price <= 0) {
        fail++;
        await log(DB, "SKIP", symbol, "no valid price");
        continue;
      }
      const price = data.price;
      const prevClose = data.prevClose || price;
      const dayPct = ((price - prevClose) / prevClose) * 100;
      const rsi = data.history && data.history.length >= cfg.rsiPeriod + 1 ? getRSI(data.history, cfg.rsiPeriod) : null;
      const ma = data.history && data.history.length >= cfg.maPeriod ? getMA(data.history, cfg.maPeriod) : null;
      const atr = data.history && data.history.length >= cfg.atrPeriod + 1 ? getATR(data.history, cfg.atrPeriod) : null;
      const dailyAtr = data.daily && data.daily.length >= cfg.atrPeriod + 1 ? getATR(data.daily, cfg.atrPeriod) : null;
      const dailyMa = data.daily && data.daily.length >= cfg.maPeriod ? getMA(data.daily, cfg.maPeriod) : null;
      await saveQuote(DB, symbol, market, { price: price, prevClose: prevClose, dayPct: dayPct, rsi: rsi, ma: ma, atr: atr, dailyAtr: dailyAtr, dailyMa: dailyMa });
      ok++;
    } catch (e) {
      fail++;
      await log(DB, "ERROR", symbol, "fetch fail: " + e.message);
    }
  }

  await log(DB, "INFO", null, market.toUpperCase() + " quote refresh done: ok=" + ok + " fail=" + fail);
  return { ok: ok, fail: fail };
}

async function autoTune(DB, cfg, regimes) {
  if (!cfg.autoTune) return cfg;
  try {
    const tradesRes = await DB.prepare("SELECT * FROM trades WHERE side = ? ORDER BY ts DESC LIMIT 30").bind("SELL").all();
    const recentSells = tradesRes.results || [];

    if (recentSells.length >= 10) {
      const tuneState = await getState(DB, "autotune_state", { lastTunedAt: 0, tradeCountAtLastTune: 0 });
      const totalSells = await DB.prepare("SELECT COUNT(*) as c FROM trades WHERE side = ?").bind("SELL").first();
      const sellCount = totalSells.c || 0;

      if (sellCount - tuneState.tradeCountAtLastTune >= 10) {
        const wins = recentSells.filter(function(t){ return t.pnl_pct > 0; });
        const winRate = wins.length / recentSells.length;
        const avgPnl = recentSells.reduce(function(a,t){ return a + t.pnl_pct; }, 0) / recentSells.length;
        const changes = [];
        const newCfg = Object.assign({}, cfg);

        const usRegime = regimes.us ? regimes.us.regime : "UNKNOWN";
        const krRegime = regimes.kr ? regimes.kr.regime : "UNKNOWN";
        const dominantRegime = (usRegime === "BEAR" || krRegime === "BEAR") ? "BEAR" :
                               (usRegime === "BULL" && krRegime === "BULL") ? "BULL" : "NEUTRAL";

        if (dominantRegime === "BEAR") {
          newCfg.rsiBuy = Math.max(28, cfg.rsiBuy - 1);
          newCfg.takeProfit = Math.max(3, cfg.takeProfit - 0.5);
          newCfg.posSize = Math.max(5, cfg.posSize - 1);
          if (newCfg.rsiBuy !== cfg.rsiBuy) changes.push("RSI Buy " + cfg.rsiBuy + "->" + newCfg.rsiBuy);
          if (newCfg.takeProfit !== cfg.takeProfit) changes.push("TP " + cfg.takeProfit + "->" + newCfg.takeProfit);
          if (newCfg.posSize !== cfg.posSize) changes.push("Size " + cfg.posSize + "->" + newCfg.posSize);
        } else if (dominantRegime === "BULL" && winRate > 0.55 && avgPnl > 2) {
          newCfg.rsiBuy = Math.min(38, cfg.rsiBuy + 1);
          newCfg.takeProfit = Math.min(10, cfg.takeProfit + 0.5);
          newCfg.posSize = Math.min(15, cfg.posSize + 1);
          if (newCfg.rsiBuy !== cfg.rsiBuy) changes.push("RSI Buy " + cfg.rsiBuy + "->" + newCfg.rsiBuy);
          if (newCfg.takeProfit !== cfg.takeProfit) changes.push("TP " + cfg.takeProfit + "->" + newCfg.takeProfit);
          if (newCfg.posSize !== cfg.posSize) changes.push("Size " + cfg.posSize + "->" + newCfg.posSize);
        } else if (avgPnl < 0 && winRate < 0.4) {
          const newMinHold = Math.min(90, cfg.minHoldMin + 10);
          if (newMinHold !== cfg.minHoldMin) { changes.push("MinHold " + cfg.minHoldMin + "->" + newMinHold + "min"); newCfg.minHoldMin = newMinHold; }
        }

        if (changes.length > 0) {
          await setState(DB, "cfg", newCfg);
          await setState(DB, "autotune_state", { lastTunedAt: Date.now(), tradeCountAtLastTune: sellCount });
          await log(DB, "TUNE", null, "[" + dominantRegime + "] WR=" + (winRate*100).toFixed(0) + "% PnL=" + avgPnl.toFixed(2) + "% -> " + changes.join(", "));
          return newCfg;
        }
      }
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

  if (usOpen) {
    for (const idx of US_INDICES) {
      try { const d = await fetchDaily(idx); await saveIndex(DB, idx, "us", d); }
      catch (e) { await log(DB, "WARN", idx, "index fetch fail: " + e.message); }
    }
  }
  if (krOpen) {
    for (const idx of KR_INDICES) {
      try { const d = await fetchDaily(idx); await saveIndex(DB, idx, "kr", d); }
      catch (e) { await log(DB, "WARN", idx, "index fetch fail: " + e.message); }
    }
  }

  const regimes = {
    us: await analyzeMarketRegime(DB, "us"),
    kr: await analyzeMarketRegime(DB, "kr")
  };
  await log(DB, "INFO", null, "Regime US:" + regimes.us.regime + " (avg " + regimes.us.avgDayPct.toFixed(2) + "%, worst " + regimes.us.worstDayPct.toFixed(2) + "%), KR:" + regimes.kr.regime + " (avg " + regimes.kr.avgDayPct.toFixed(2) + "%, worst " + regimes.kr.worstDayPct.toFixed(2) + "%)");

  cfg = await autoTune(DB, cfg, regimes);

  const cash = await getState(DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });
  const posSizeRatio = cfg.posSize / 100;
  let tried = 0, fetched = 0, bought = 0, sold = 0, skipped = 0;

  const marketsToTrade = [];
  if (usOpen) marketsToTrade.push("us");
  if (krOpen) marketsToTrade.push("kr");

  if (marketsToTrade.length === 0 && cfg.marketHoursOnly) {
    await log(DB, "CLOSED", null, "US & KR 모두 정규장 시간 아님 - 전체 대기");
    await setState(DB, "last_tick", Date.now());
    return;
  }

  for (const market of marketsToTrade) {
    const tickers = market === "us" ? cfg.usTickers : cfg.krTickers;
    const positions = await getPositions(DB, market);
    const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
    const regime = regimes[market];

    const marketCrashing = regime.worstDayPct <= cfg.marketCrashPct;
    if (marketCrashing) {
      await log(DB, "WARN", null, market.toUpperCase() + " 시장 폭락 감지 (worst " + regime.worstDayPct.toFixed(2) + "% <= " + cfg.marketCrashPct + "%) - 신규 매수 금지");
    }

    for (const symbol of tickers) {
      tried++;
      try {
        const data = await fetchPrice(symbol);
        fetched++;

        if (!data.price || data.price <= 0) {
          skipped++;
          await log(DB, "SKIP", symbol, "no valid price");
          continue;
        }

        const price = data.price;
        const prevClose = data.prevClose || price;
        const dayPct = ((price - prevClose) / prevClose) * 100;
        const rsi = data.history && data.history.length >= cfg.rsiPeriod + 1 ? getRSI(data.history, cfg.rsiPeriod) : null;
        const ma = data.history && data.history.length >= cfg.maPeriod ? getMA(data.history, cfg.maPeriod) : null;
        const atr = data.history && data.history.length >= cfg.atrPeriod + 1 ? getATR(data.history, cfg.atrPeriod) : null;
        const dailyAtr = data.daily && data.daily.length >= cfg.atrPeriod + 1 ? getATR(data.daily, cfg.atrPeriod) : null;
        const dailyMa = data.daily && data.daily.length >= cfg.maPeriod ? getMA(data.daily, cfg.maPeriod) : null;

        await saveQuote(DB, symbol, market, { price: price, prevClose: prevClose, dayPct: dayPct, rsi: rsi, ma: ma, atr: atr, dailyAtr: dailyAtr, dailyMa: dailyMa });

        if (rsi == null) { skipped++; await log(DB, "SKIP", symbol, "RSI not enough history"); continue; }

        const held = positions[symbol];

        if (held) {
          // [수정] 기존 포지션 stopPrice 보정: 구버전 손절선이 너무 가깝면 강제 조정
          if (held.meta && held.meta.stopPrice != null) {
            const safeStop = held.avg * (1 - cfg.minStopPct / 100);
            if (held.meta.stopPrice > safeStop) {
              held.meta.stopPrice = safeStop;
              try {
                await savePosition(DB, market, symbol, held);
                await log(DB, "INFO", symbol, "stopPrice corrected to " + safeStop.toFixed(2) + " (-" + cfg.minStopPct + "%)");
              } catch (e) {}
            }
          }

          // 트레일링용 peak 갱신
          if (held.meta && held.meta.peakPrice != null && price > held.meta.peakPrice) {
            held.meta.peakPrice = price;
            try { await savePosition(DB, market, symbol, held); } catch (e) {}
          }
          const pnlRate = ((price - held.avg) / held.avg) * 100;
          const hardStop = held.meta && held.meta.stopPrice;
          const entryAtr = held.meta && held.meta.atrAtEntry;
          const peakPrice = held.meta && held.meta.peakPrice;
          
          // [수정] 트레일링 거리 더 넓게 (trailMult: 3.0)
          const trailDist = entryAtr ? entryAtr * cfg.trailMult : peakPrice * (cfg.trailMult / 100);
          const trailStop = peakPrice ? peakPrice - trailDist : null;
          const peakPnlPct = peakPrice ? ((peakPrice - held.avg) / held.avg * 100) : 0;
          // [수정] 트레일링 발동 기준: 본전 +3% (trailStartPct: 3.0)
          const trailArmed = peakPnlPct >= cfg.trailStartPct;
          
          const heldMin = held.opened_ts ? (Date.now() - held.opened_ts) / 60000 : 0;
          const heldHours = heldMin / 60;
          const minHold = cfg.minHoldMin || 0;
          const minHoldPassed = heldMin >= minHold;
          const maxHoldReached = heldHours >= cfg.maxHoldHours;

          let didSell = false;

          // 1. 비상 손절 (minHold 무시)
          if (pnlRate <= -cfg.stopLoss) {
            await executeSell(DB, market, symbol, held, price, "EMERGENCY-STOP " + pnlRate.toFixed(2) + "%", cfg, cash);
            didSell = true;
          }
          // 2. ATR 하드 스톱 (minHold 무시)
          else if (hardStop != null && price <= hardStop) {
            await executeSell(DB, market, symbol, held, price, "ATR-STOP " + pnlRate.toFixed(2) + "%", cfg, cash);
            didSell = true;
          }
          // 3. [수정] 독립 트레일링 스톱 - 본전 +3% 이상 갔다 왔으면 작동 + 최소 수익 +2% 강제
          else if (minHoldPassed && trailArmed && trailStop != null && price <= trailStop && pnlRate >= cfg.minProfitToSell) {
            await executeSell(DB, market, symbol, held, price, "TRAIL peak=" + peakPrice.toFixed(2) + " PnL=" + pnlRate.toFixed(2) + "%", cfg, cash);
            didSell = true;
          }
          // 4. 최대 보유시간 초과 - 본전 ±1% 근처면 청산
          else if (maxHoldReached && Math.abs(pnlRate) <= 1.0) {
            await executeSell(DB, market, symbol, held, price, "TIME-CUT " + heldHours.toFixed(0) + "h PnL=" + pnlRate.toFixed(2) + "%", cfg, cash);
            didSell = true;
          }
          // 5. minHold 통과 후 일반 매도들
          else if (minHoldPassed) {
            // [수정] RSI 과매수 + 의미있는 차익 + 최소 수익 2% 강제
            if (rsi > cfg.rsiSell && pnlRate >= Math.max(cfg.minProfitToSell, cfg.takeProfit * 0.5)) {
              await executeSell(DB, market, symbol, held, price, "RSI " + rsi.toFixed(1) + " +" + pnlRate.toFixed(1) + "%", cfg, cash); didSell = true;
            }
            // RALLY: 일중 급등 + 2% 이상 차익
            else if (dayPct >= cfg.daySellPct && pnlRate >= 2.0) {
              await executeSell(DB, market, symbol, held, price, "RALLY +" + dayPct.toFixed(1) + "% (PnL " + pnlRate.toFixed(1) + "%)", cfg, cash); didSell = true;
            }
            // 일반 익절
            else if (pnlRate >= cfg.takeProfit) {
              await executeSell(DB, market, symbol, held, price, "TAKEPROFIT " + pnlRate.toFixed(2) + "%", cfg, cash); didSell = true;
            }
          } else {
            await log(DB, "INFO", symbol, "MIN-HOLD lock (" + heldMin.toFixed(1) + "/" + minHold + "min, PnL " + pnlRate.toFixed(2) + "%)");
          }
          if (didSell) sold++;
        } else {
          // 시장 폭락 중이면 매수 차단
          if (marketCrashing) {
            await log(DB, "NOBUY", symbol, "MARKET-CRASH block");
            continue;
          }

          const trendMa = dailyMa || ma;
          const trendOK = trendMa == null || price >= trendMa;

          let strictTrendOK = trendOK;
          if (regime.regime === "BEAR" && trendMa != null) {
            strictTrendOK = price >= trendMa * 1.02;
          }

          const rsiOK = rsi < cfg.rsiBuy;
          const dipOK = dayPct <= -cfg.dayBuyPct;

          let canBuy = false, reason = "";
          if (strictTrendOK && rsiOK && dipOK) {
            canBuy = true;
            reason = "RSI " + rsi.toFixed(1) + " + DIP " + dayPct.toFixed(1) + "% [" + regime.regime + "]";
          }

          if (canBuy) {
            const budget = cash[market] * posSizeRatio;
            const qty = Math.floor(budget / (price * (1 + feeRate)));
            const totalCost = qty * price * (1 + feeRate);
            if (qty > 0 && totalCost <= cash[market]) {
              await executeBuy(DB, market, symbol, qty, price, reason, dailyAtr, cfg, cash);
              bought++;
            }
          } else {
            const flags = [];
            if (!rsiOK) flags.push("RSI=" + rsi.toFixed(1));
            if (!dipOK) flags.push("day=" + dayPct.toFixed(2) + "%");
            if (!strictTrendOK) flags.push("MA-FAIL[" + regime.regime + "](p=" + price.toFixed(2) + "<" + (trendMa ? trendMa.toFixed(2) : "?") + ")");
            await log(DB, "NOBUY", symbol, flags.join(" "));
          }
        }
      } catch (e) {
        await log(DB, "ERROR", symbol, e.message);
      }
    }
  }

  try { await setState(DB, "cash", cash); } catch (e) {}
  try { await setState(DB, "last_tick", Date.now()); } catch (e) {}
  await log(DB, "INFO", null, "Done: tried=" + tried + " fetched=" + fetched + " skip=" + skipped + " buy=" + bought + " sell=" + sold);

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
        cash: cash,
        positions: { us: positionsUS, kr: positionsKR },
        lastTick: lastTick,
        cfg: cfg,
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
      await env.DB.prepare("DELETE FROM state WHERE k NOT LIKE 'quote:%' AND k NOT LIKE 'index:%'").run();
      await setState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });
      await log(env.DB, "INFO", null, "RESET: all cleared, cash reset to US=" + cfg.initialCashUS + " KR=" + cfg.initialCashKR);
      return Response.json({ ok: true, cash: { us: cfg.initialCashUS, kr: cfg.initialCashKR } }, { headers: cors });
    }

    if (path === "/api/reset_tickers" && request.method === "POST") {
      const current = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
      current.usTickers = DEFAULT_US;
      current.krTickers = DEFAULT_KR;
      await setState(env.DB, "cfg", current);
      await log(env.DB, "INFO", null, "tickers reset to defaults");
      return Response.json({ ok: true, usTickers: DEFAULT_US, krTickers: DEFAULT_KR }, { headers: cors });
    }

    if (path === "/api/tick" && request.method === "POST") {
      await runTradingCycle(env);
      return Response.json({ ok: true, ts: Date.now() }, { headers: cors });
    }

    if (path === "/api/refresh_quotes" && request.method === "POST") {
      const market = url.searchParams.get("market") || "us";
      if (market !== "us" && market !== "kr") {
        return Response.json({ error: "invalid market" }, { status: 400, headers: cors });
      }
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
