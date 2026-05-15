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
  atrStopMult: 2.5, trailMult: 2.0,
  minHoldMin: 30,
  initialCashUS: 10000, initialCashKR: 10000000,
  enabled: true,
  autoTune: true,
  autoTuneAggression: "moderate",
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

function forwardFill(rawArr) {
  const out = [];
  let lastValid = null;
  for (let i = 0; i < rawArr.length; i++) {
    const v = rawArr[i];
    if (typeof v === "number" && !isNaN(v) && v > 0) {
      lastValid = v;
      out.push(v);
    } else if (lastValid !== null) {
      out.push(lastValid);
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

// 1m intraday + daily 둘 다 반환 (daily ATR/MA용)
async function fetchPrice(symbol) {
  let intradayCloses = [];
  let intradayMeta = null;
  let dailyCloses = [];
  let dailyMeta = null;

  // 1차: 1m intraday
  try {
    const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1m&range=1d");
    const result = j && j.chart && j.chart.result && j.chart.result[0];
    if (result) {
      intradayMeta = result.meta || {};
      const raw = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
      intradayCloses = forwardFill(raw);
    }
  } catch (e) { /* fall through */ }

  // 2차: daily 3mo (ATR/MA 계산용)
  try {
    const j2 = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=3mo");
    const result2 = j2 && j2.chart && j2.chart.result && j2.chart.result[0];
    if (result2) {
      dailyMeta = result2.meta || {};
      const raw2 = (result2.indicators && result2.indicators.quote && result2.indicators.quote[0] && result2.indicators.quote[0].close) || [];
      dailyCloses = forwardFill(raw2);
    }
  } catch (e) { /* fall through */ }

  // 1m이 충분하면 그걸 메인으로 사용 (가격은 실시간 1m, daily는 ATR/MA용 보조)
  if (intradayCloses.length >= 20 && intradayMeta) {
    const price = (typeof intradayMeta.regularMarketPrice === "number" && intradayMeta.regularMarketPrice > 0) ? intradayMeta.regularMarketPrice : intradayCloses[intradayCloses.length - 1];
    const prevClose = (typeof intradayMeta.chartPreviousClose === "number" && intradayMeta.chartPreviousClose > 0) ? intradayMeta.chartPreviousClose : (intradayMeta.previousClose || intradayCloses[0]);
    return { symbol: symbol, price: price, prevClose: prevClose, history: intradayCloses, daily: dailyCloses };
  }

  // 1m 부족하면 daily만 사용
  if (dailyCloses.length > 0 && dailyMeta) {
    const price = (typeof dailyMeta.regularMarketPrice === "number" && dailyMeta.regularMarketPrice > 0) ? dailyMeta.regularMarketPrice : dailyCloses[dailyCloses.length - 1];
    const prevClose = dailyCloses.length >= 2 ? dailyCloses[dailyCloses.length - 2] : (dailyMeta.chartPreviousClose || dailyMeta.previousClose || price);
    return { symbol: symbol, price: price, prevClose: prevClose, history: dailyCloses, daily: dailyCloses };
  }

  // 3차 fallback: daily 1y
  try {
    const j3 = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=1y");
    const result3 = j3 && j3.chart && j3.chart.result && j3.chart.result[0];
    if (result3) {
      const meta3 = result3.meta || {};
      const raw3 = (result3.indicators && result3.indicators.quote && result3.indicators.quote[0] && result3.indicators.quote[0].close) || [];
      const daily = forwardFill(raw3);
      if (daily.length > 0) {
        const price = (typeof meta3.regularMarketPrice === "number" && meta3.regularMarketPrice > 0) ? meta3.regularMarketPrice : daily[daily.length - 1];
        const prevClose = daily.length >= 2 ? daily[daily.length - 2] : (meta3.chartPreviousClose || meta3.previousClose || price);
        return { symbol: symbol, price: price, prevClose: prevClose, history: daily, daily: daily };
      }
    }
  } catch (e) { /* fall through */ }

  // 마지막: 1m이라도 있으면 반환
  if (intradayCloses.length > 0 && intradayMeta) {
    const price = (typeof intradayMeta.regularMarketPrice === "number" && intradayMeta.regularMarketPrice > 0) ? intradayMeta.regularMarketPrice : intradayCloses[intradayCloses.length - 1];
    const prevClose = (typeof intradayMeta.chartPreviousClose === "number" && intradayMeta.chartPreviousClose > 0) ? intradayMeta.chartPreviousClose : (intradayMeta.previousClose || price);
    return { symbol: symbol, price: price, prevClose: prevClose, history: intradayCloses, daily: [] };
  }

  throw new Error("no data from any endpoint");
}

async function fetchDaily(symbol) {
  const j = await yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=1mo");
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("no daily data");
  const meta = result.meta || {};
  const raw = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
  const closes = forwardFill(raw);
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

async function executeBuy(DB, market, symbol, qty, price, reason, dailyAtr, cfg, cash) {
  const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  if (total > cash[market]) { await log(DB, "WARN", symbol, "BUY aborted: cash short"); return cash; }

  try {
    await savePosition(DB, market, symbol, {
      qty: qty, avg: price, opened_ts: Date.now(),
      meta: {
        feePaid: fee,
        atrAtEntry: dailyAtr,  // 일봉 ATR 저장 (A)
        stopPrice: dailyAtr ? price - dailyAtr * cfg.atrStopMult : null,
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
  const stopInfo = dailyAtr ? " stop=" + (price - dailyAtr * cfg.atrStopMult).toFixed(2) + " (-" + (dailyAtr * cfg.atrStopMult / price * 100).toFixed(1) + "%)" : "";
  await log(DB, "TRADE", symbol, "BUY x" + qty + " @" + price.toFixed(2) + " (" + reason + ")" + stopInfo);
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
    dayPct: dayPct, history: data.history.slice(-30), ts: Date.now()
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

async function autoTune(DB, cfg) {
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

        if (avgPnl < 0 || winRate < 0.4) {
          // 성과 나쁘면: 더 깐깐하게 (RSI 낮추고, 최소보유 늘리고)
          const newRsiBuy = Math.max(25, cfg.rsiBuy - 2);
          const newMinHold = Math.min(60, cfg.minHoldMin + 5);
          if (newRsiBuy !== cfg.rsiBuy) { changes.push("RSI Buy " + cfg.rsiBuy + "->" + newRsiBuy); newCfg.rsiBuy = newRsiBuy; }
          if (newMinHold !== cfg.minHoldMin) { changes.push("MinHold " + cfg.minHoldMin + "->" + newMinHold + "min"); newCfg.minHoldMin = newMinHold; }
        } else if (winRate > 0.6 && avgPnl > 3) {
          // 성과 좋으면: 포지션 크기 늘리기
          const newPosSize = Math.min(15, cfg.posSize + 1);
          if (newPosSize !== cfg.posSize) { changes.push("PosSize " + cfg.posSize + "->" + newPosSize); newCfg.posSize = newPosSize; }
        }
        if (changes.length > 0) {
          await setState(DB, "cfg", newCfg);
          await setState(DB, "autotune_state", { lastTunedAt: Date.now(), tradeCountAtLastTune: sellCount });
          await log(DB, "TUNE", null, "[result-based] winRate=" + (winRate*100).toFixed(0) + "% avgPnL=" + avgPnl.toFixed(2) + "% -> " + changes.join(", "));
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
  cfg = await autoTune(DB, cfg);

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
        // 일봉 기반 (A: ATR/MA를 일봉으로)
        const dailyAtr = data.daily && data.daily.length >= cfg.atrPeriod + 1 ? getATR(data.daily, cfg.atrPeriod) : null;
        const dailyMa = data.daily && data.daily.length >= cfg.maPeriod ? getMA(data.daily, cfg.maPeriod) : null;

        await saveQuote(DB, symbol, market, { price: price, prevClose: prevClose, dayPct: dayPct, rsi: rsi, ma: ma, atr: atr, dailyAtr: dailyAtr, dailyMa: dailyMa });

        if (rsi == null) { skipped++; await log(DB, "SKIP", symbol, "RSI not enough history"); continue; }

        const held = positions[symbol];

        if (held) {
          // 트레일링용 peak 갱신
          if (held.meta && held.meta.peakPrice != null && price > held.meta.peakPrice) {
            held.meta.peakPrice = price;
            try { await savePosition(DB, market, symbol, held); } catch (e) {}
          }
          const pnlRate = ((price - held.avg) / held.avg) * 100;
          const hardStop = held.meta && held.meta.stopPrice;
          const entryAtr = held.meta && held.meta.atrAtEntry;
          // 트레일링 스톱: 일봉 ATR 기준
          const trailStop = (entryAtr && held.meta && held.meta.peakPrice) ? held.meta.peakPrice - entryAtr * cfg.trailMult : null;
          
          // C: 최소 보유시간 체크
          const heldMin = held.opened_ts ? (Date.now() - held.opened_ts) / 60000 : 0;
          const minHold = cfg.minHoldMin || 0;
          const minHoldPassed = heldMin >= minHold;

          let didSell = false;

          // 절대 비상 손절은 minHold 무시 (안전망)
          if (pnlRate <= -cfg.stopLoss) {
            await executeSell(DB, market, symbol, held, price, "EMERGENCY-STOP " + pnlRate.toFixed(2) + "%", cfg, cash); 
            didSell = true;
          }
          // 그 외 모든 매도는 minHold 통과 후
          else if (minHoldPassed) {
            // RSI 과매수 + 의미있는 차익
            if (rsi > cfg.rsiSell && pnlRate >= cfg.takeProfit * 0.5) {
              await executeSell(DB, market, symbol, held, price, "RSI " + rsi.toFixed(1) + " +" + pnlRate.toFixed(1) + "%", cfg, cash); didSell = true;
            }
            // B: RALLY = 일중 급등 AND 최소 2% 차익
            else if (dayPct >= cfg.daySellPct && pnlRate >= 2.0) {
              await executeSell(DB, market, symbol, held, price, "RALLY +" + dayPct.toFixed(1) + "% (PnL " + pnlRate.toFixed(1) + "%)", cfg, cash); didSell = true;
            }
            // ATR 하드 스톱 (일봉 ATR 기준)
            else if (hardStop != null && price <= hardStop) {
              await executeSell(DB, market, symbol, held, price, "ATR-STOP " + pnlRate.toFixed(2) + "%", cfg, cash); didSell = true;
            }
            // 트레일링 스톱 (충분히 익절 위치 도달했을 때만)
            else if (trailStop != null && price <= trailStop && pnlRate >= cfg.takeProfit) {
              await executeSell(DB, market, symbol, held, price, "TRAIL " + pnlRate.toFixed(2) + "%", cfg, cash); didSell = true;
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
          // E + F: 매수 조건 강화 (RSI<32 AND dayPct<=-1% AND price > dailyMa)
          // F의 추세 필터는 일봉 MA 기준 (있으면 사용, 없으면 intraday MA fallback)
          const trendMa = dailyMa || ma;
          const trendOK = trendMa == null || price >= trendMa;  // F: MA 위에서만 매수

          const rsiOK = rsi < cfg.rsiBuy;            // 조건 1
          const dipOK = dayPct <= -cfg.dayBuyPct;    // 조건 2
          
          let canBuy = false, reason = "";
          if (trendOK && rsiOK && dipOK) {
            canBuy = true;
            reason = "RSI " + rsi.toFixed(1) + " + DIP " + dayPct.toFixed(1) + "% + MA-OK";
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
            // 왜 못 샀는지 진단 로그
            const flags = [];
            if (!rsiOK) flags.push("RSI=" + rsi.toFixed(1));
            if (!dipOK) flags.push("day=" + dayPct.toFixed(2) + "%");
            if (!trendOK) flags.push("MA-FAIL(p=" + price.toFixed(2) + "<" + (trendMa ? trendMa.toFixed(2) : "?") + ")");
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
