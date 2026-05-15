const DEFAULT_US = ["AAPL","NVDA","TSLA","MSFT","GOOGL","AMZN","META","AVGO","NFLX","AMD"];
const DEFAULT_KR = ["005930.KS","000660.KS","373220.KS","207940.KS","005380.KS","005490.KS","000270.KS","035420.KS","006400.KS","068270.KS"];
const US_INDICES = ["^IXIC", "^DJI", "^GSPC"];
const KR_INDICES = ["^KS11", "^KQ11"];

const DEFAULT_CFG = {
  usTickers: DEFAULT_US,
  krTickers: DEFAULT_KR,
  rsiBuy: 55, rsiSell: 50, rsiPeriod: 14,
  stopLoss: 7, takeProfit: 2.5,
  dayBuyPct: 1.0, daySellPct: 2,
  feeUS: 0.0001, feeKR: 0.0015,
  posSize: 12,
  maPeriod: 20, atrPeriod: 14,
  atrStopMult: 2.5, trailMult: 2.5,
  initialCashUS: 10000000, initialCashKR: 10000000,
  enabled: true,
  autoTune: true,
  autoTuneAggression: "aggressive"
};

async function ensureSchema(DB) {
  try {
    const cols = await DB.prepare("PRAGMA table_info(positions)").all();
    const hasMeta = (cols.results || []).some(function(c){ return c.name === "meta"; });
    if (!hasMeta) {
      await DB.prepare("ALTER TABLE positions ADD COLUMN meta TEXT").run();
      await log(DB, "INFO", null, "schema migrated: added meta column to positions");
    }
  } catch (e) {
    try {
      await DB.prepare("CREATE TABLE IF NOT EXISTS positions (symbol TEXT PRIMARY KEY, market TEXT NOT NULL, qty REAL NOT NULL, avg_price REAL NOT NULL, opened_ts INTEGER NOT NULL, meta TEXT)").run();
    } catch (e2) {
      console.error("schema ensure fail:", e2.message);
    }
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

async function fetchPrice(symbol) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json"
  };

  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1m&range=1d";
  const r = await fetch(url, { headers: headers });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("no chart data");

  const rawCloses = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
  const meta = result.meta || {};

  // null/undefined를 직전 유효값으로 forward-fill
  const closes = [];
  let lastValid = null;
  for (let i = 0; i < rawCloses.length; i++) {
    const v = rawCloses[i];
    if (typeof v === "number" && !isNaN(v)) {
      lastValid = v;
      closes.push(v);
    } else if (lastValid !== null) {
      closes.push(lastValid);
    }
  }

  // 1분봉이 너무 짧으면 일봉으로 폴백
  if (closes.length < 20) {
    const url2 = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=3mo";
    const r2 = await fetch(url2, { headers: headers });
    if (!r2.ok) throw new Error("HTTP " + r2.status);
    const j2 = await r2.json();
    const result2 = j2 && j2.chart && j2.chart.result && j2.chart.result[0];
    if (!result2) throw new Error("no chart data (daily)");
    const rawDaily = (result2.indicators && result2.indicators.quote && result2.indicators.quote[0] && result2.indicators.quote[0].close) || [];
    const daily = rawDaily.filter(function(x){ return typeof x === "number" && !isNaN(x); });
    if (daily.length === 0) throw new Error("no close data");
    const price = (typeof meta.regularMarketPrice === "number") ? meta.regularMarketPrice : daily[daily.length - 1];
    const prevClose = daily.length >= 2 ? daily[daily.length - 2] : (meta.chartPreviousClose || meta.previousClose || price);
    return { symbol: symbol, price: price, prevClose: prevClose, history: daily };
  }

  const price = (typeof meta.regularMarketPrice === "number") ? meta.regularMarketPrice : closes[closes.length - 1];
  const prevClose = meta.chartPreviousClose || meta.previousClose || closes[0];
  return { symbol: symbol, price: price, prevClose: prevClose, history: closes };
}

async function fetchDaily(symbol) {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=1mo";
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json"
    }
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error("no daily data");
  const closes = ((result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || []).filter(function(x){ return typeof x === "number"; });
  if (closes.length === 0) throw new Error("no daily close");
  const price = closes[closes.length - 1];
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : price;
  return { symbol: symbol, price: price, prevClose: prevClose, history: closes };
}

async function getState(DB, k, def) {
  const row = await DB.prepare("SELECT v FROM state WHERE k = ?").bind(k).first();
  if (!row) return def;
  try { return JSON.parse(row.v); } catch (e) { return def; }
}

async function setState(DB, k, v) {
  await DB.prepare("INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_ts=excluded.updated_ts")
    .bind(k, JSON.stringify(v), Date.now()).run();
}

async function getPositions(DB, market) {
  const res = await DB.prepare("SELECT * FROM positions WHERE market = ?").bind(market).all();
  const map = {};
  for (const p of res.results) {
    map[p.symbol] = { qty: p.qty, avg: p.avg_price, opened_ts: p.opened_ts, meta: p.meta ? JSON.parse(p.meta) : {} };
  }
  return map;
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

async function executeBuy(DB, market, symbol, qty, price, reason, atr, cfg, cash) {
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
        atrAtEntry: atr,
        stopPrice: atr ? price - atr * cfg.atrStopMult : null,
        peakPrice: price,
        usedCfg: { rsiBuy: cfg.rsiBuy, dayBuyPct: cfg.dayBuyPct, atrStopMult: cfg.atrStopMult, trailMult: cfg.trailMult }
      }
    });
  } catch (e) {
    await log(DB, "ERROR", symbol, "BUY savePosition fail (no cash deducted): " + e.message);
    return cash;
  }

  cash[market] -= total;
  await recordTrade(DB, { ts: Date.now(), market: market, symbol: symbol, side: "BUY", qty: qty, price: price, reason: reason });
  await log(DB, "TRADE", symbol, "BUY x" + qty + " @" + price.toFixed(2) + " (" + reason + ")");
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
  await deletePosition(DB, symbol);
  await recordTrade(DB, { ts: Date.now(), market: market, symbol: symbol, side: "SELL", qty: pos.qty, price: price, pnl: pnl, pnl_pct: pnlPct, reason: reason });
  await log(DB, "TRADE", symbol, "SELL @" + price.toFixed(2) + " PnL " + pnlPct.toFixed(2) + "% (" + reason + ")");
  return { cash: cash, pnlPct: pnlPct, usedCfg: pos.meta && pos.meta.usedCfg };
}

async function saveQuote(DB, symbol, market, q) {
  await setState(DB, "quote:" + symbol, {
    market: market, price: q.price, prevClose: q.prevClose,
    dayPct: q.dayPct, rsi: q.rsi, ma: q.ma, atr: q.atr, ts: Date.now()
  });
}

async function saveIndex(DB, symbol, region, data) {
  const dayPct = data.prevClose ? ((data.price - data.prevClose) / data.prevClose) * 100 : 0;
  await setState(DB, "index:" + symbol, {
    region: region,
    price: data.price,
    prevClose: data.prevClose,
    dayPct: dayPct,
    history: data.history.slice(-30),
    ts: Date.now()
  });
}

async function autoTune(DB, cfg) {
  if (!cfg.autoTune) return cfg;

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
        const newRsiBuy = Math.max(40, cfg.rsiBuy - 3);
        const newStopLoss = Math.max(3, cfg.stopLoss - 0.5);
        if (newRsiBuy !== cfg.rsiBuy) { changes.push("RSI Buy " + cfg.rsiBuy + "->" + newRsiBuy); newCfg.rsiBuy = newRsiBuy; }
        if (newStopLoss !== cfg.stopLoss) { changes.push("StopLoss " + cfg.stopLoss + "->" + newStopLoss); newCfg.stopLoss = newStopLoss; }
      } else if (winRate > 0.6 && avgPnl > 1) {
        const newRsiBuy = Math.min(65, cfg.rsiBuy + 2);
        const newPosSize = Math.min(20, cfg.posSize + 1);
        if (newRsiBuy !== cfg.rsiBuy) { changes.push("RSI Buy " + cfg.rsiBuy + "->" + newRsiBuy); newCfg.rsiBuy = newRsiBuy; }
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

  const positionsCount = await DB.prepare("SELECT COUNT(*) as c FROM positions").first();
  if ((positionsCount.c || 0) === 0) {
    const nobuyRes = await DB.prepare("SELECT * FROM logs WHERE level = 'NOBUY' ORDER BY id DESC LIMIT 100").all();
    const nobuyLogs = nobuyRes.results || [];

    if (nobuyLogs.length >= 50) {
      const tuneState = await getState(DB, "autotune_nobuy_state", { lastTunedAt: 0 });
      const sinceLastTune = Date.now() - tuneState.lastTunedAt;

      if (sinceLastTune > 5 * 60 * 1000) {
        let rsiAboveCount = 0, dayAboveCount = 0;
        for (const l of nobuyLogs) {
          const rsiM = l.message.match(/RSI=([\d.]+)/);
          const dayM = l.message.match(/day=(-?[\d.]+)/);
          if (rsiM && parseFloat(rsiM[1]) >= cfg.rsiBuy) rsiAboveCount++;
          if (dayM && parseFloat(dayM[1]) > -cfg.dayBuyPct) dayAboveCount++;
        }

        const changes = [];
        const newCfg = Object.assign({}, cfg);

        if (rsiAboveCount > nobuyLogs.length * 0.6 && cfg.rsiBuy < 70) {
          const newRsiBuy = Math.min(70, cfg.rsiBuy + 5);
          changes.push("RSI Buy " + cfg.rsiBuy + "->" + newRsiBuy);
          newCfg.rsiBuy = newRsiBuy;
        }
        if (dayAboveCount > nobuyLogs.length * 0.6 && cfg.dayBuyPct > 0.3) {
          const newDayBuy = Math.max(0.3, cfg.dayBuyPct - 0.3);
          changes.push("DayBuy " + cfg.dayBuyPct + "->" + newDayBuy.toFixed(1));
          newCfg.dayBuyPct = parseFloat(newDayBuy.toFixed(1));
        }

        if (changes.length > 0) {
          await setState(DB, "cfg", newCfg);
          await setState(DB, "autotune_nobuy_state", { lastTunedAt: Date.now() });
          await log(DB, "TUNE", null, "[nobuy-based] no positions, easing conditions -> " + changes.join(", "));
          return newCfg;
        }
      }
    }
  }

  return cfg;
}

async function runTradingCycle(env) {
  const DB = env.DB;

  await ensureSchema(DB);

  let cfg = Object.assign({}, DEFAULT_CFG, await getState(DB, "cfg", {}));
  if (!cfg.enabled) { await log(DB, "INFO", null, "engine disabled"); return; }

  cfg = await autoTune(DB, cfg);

  await log(DB, "INFO", null, "=== Cycle start ===");

  for (const idx of US_INDICES) {
    try { const d = await fetchDaily(idx); await saveIndex(DB, idx, "us", d); }
    catch (e) { await log(DB, "WARN", idx, "index fetch fail: " + e.message); }
  }
  for (const idx of KR_INDICES) {
    try { const d = await fetchDaily(idx); await saveIndex(DB, idx, "kr", d); }
    catch (e) { await log(DB, "WARN", idx, "index fetch fail: " + e.message); }
  }

  const cash = await getState(DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });
  const posSizeRatio = cfg.posSize / 100;
  let tried = 0, fetched = 0, bought = 0, sold = 0, skipped = 0;

  for (const market of ["us", "kr"]) {
    const tickers = market === "us" ? cfg.usTickers : cfg.krTickers;
    const positions = await getPositions(DB, market);
    const feeRate = market === "us" ? cfg.feeUS : cfg.feeKR;

    for (const symbol of tickers) {
      tried++;
      try {
        const data = await fetchPrice(symbol);
        fetched++;

        if (!data.price || !data.history || data.history.length < 20) {
          skipped++;
          await log(DB, "SKIP", symbol, "history short (" + (data.history ? data.history.length : 0) + ")");
          continue;
        }

        const price = data.price;
        const prevClose = data.prevClose || price;
        const dayPct = ((price - prevClose) / prevClose) * 100;
        const rsi = getRSI(data.history, cfg.rsiPeriod);
        const ma = getMA(data.history, cfg.maPeriod);
        const atr = getATR(data.history, cfg.atrPeriod);

        await saveQuote(DB, symbol, market, { price: price, prevClose: prevClose, dayPct: dayPct, rsi: rsi, ma: ma, atr: atr });

        if (rsi == null) { skipped++; await log(DB, "SKIP", symbol, "RSI null"); continue; }

        const held = positions[symbol];

        if (held) {
          if (atr && held.meta && held.meta.peakPrice != null && price > held.meta.peakPrice) {
            held.meta.peakPrice = price;
            await savePosition(DB, market, symbol, held);
          }
          const pnlRate = ((price - held.avg) / held.avg) * 100;
          const hardStop = held.meta && held.meta.stopPrice;
          const trailStop = (atr && held.meta && held.meta.peakPrice) ? held.meta.peakPrice - atr * cfg.trailMult : null;

          let didSell = false;
          if (rsi > cfg.rsiSell) {
            await executeSell(DB, market, symbol, held, price, "RSI " + rsi.toFixed(1), cfg, cash); didSell = true;
          } else if (dayPct >= cfg.daySellPct) {
            await executeSell(DB, market, symbol, held, price, "RALLY +" + dayPct.toFixed(1) + "%", cfg, cash); didSell = true;
          } else if (hardStop != null && price <= hardStop) {
            await executeSell(DB, market, symbol, held, price, "ATR-STOP " + pnlRate.toFixed(2) + "%", cfg, cash); didSell = true;
          } else if (trailStop != null && price <= trailStop && pnlRate > 0) {
            await executeSell(DB, market, symbol, held, price, "TRAIL " + pnlRate.toFixed(2) + "%", cfg, cash); didSell = true;
          } else if (hardStop == null && pnlRate <= -cfg.stopLoss) {
            await executeSell(DB, market, symbol, held, price, "STOPLOSS " + pnlRate.toFixed(2) + "%", cfg, cash); didSell = true;
          } else if (trailStop == null && pnlRate >= cfg.takeProfit) {
            await executeSell(DB, market, symbol, held, price, "TAKEPROFIT " + pnlRate.toFixed(2) + "%", cfg, cash); didSell = true;
          }
          if (didSell) sold++;
        } else {
          const trendOK = (ma == null) || (price >= ma * 0.98);
          let canBuy = false, reason = "";
          if (trendOK) {
            if (rsi < cfg.rsiBuy) { canBuy = true; reason = "RSI " + rsi.toFixed(1); }
            else if (dayPct <= -cfg.dayBuyPct) { canBuy = true; reason = "DIP " + dayPct.toFixed(1) + "%"; }
          }
          if (canBuy) {
            const budget = cash[market] * posSizeRatio;
            const qty = Math.floor(budget / (price * (1 + feeRate)));
            const totalCost = qty * price * (1 + feeRate);
            if (qty > 0 && totalCost <= cash[market]) {
              await executeBuy(DB, market, symbol, qty, price, reason, atr, cfg, cash);
              bought++;
            }
          } else {
            await log(DB, "NOBUY", symbol, "p=" + price.toFixed(2) + " RSI=" + rsi.toFixed(1) + " day=" + dayPct.toFixed(2) + "% MA=" + (ma ? ma.toFixed(2) : "n/a"));
          }
        }
      } catch (e) {
        await log(DB, "ERROR", symbol, e.message);
      }
    }
  }

  await setState(DB, "cash", cash);
  await setState(DB, "last_tick", Date.now());
  await log(DB, "INFO", null, "Done: tried=" + tried + " fetched=" + fetched + " skip=" + skipped + " buy=" + bought + " sell=" + sold);

  await DB.prepare("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)").run();
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

  if (path === "/api/state") {
    const cfg = Object.assign({}, DEFAULT_CFG, await getState(env.DB, "cfg", {}));
    const cash = await getState(env.DB, "cash", { us: cfg.initialCashUS, kr: cfg.initialCashKR });
    const positionsUS = await getPositions(env.DB, "us");
    const positionsKR = await getPositions(env.DB, "kr");
    const lastTick = await getState(env.DB, "last_tick", null);
    return Response.json({ cash: cash, positions: { us: positionsUS, kr: positionsKR }, lastTick: lastTick, cfg: cfg }, { headers: cors });
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

  if (path === "/api/tick" && request.method === "POST") {
    await runTradingCycle(env);
    return Response.json({ ok: true, ts: Date.now() }, { headers: cors });
  }

  if (path === "/api/migrate" && request.method === "POST") {
    await ensureSchema(env.DB);
    return Response.json({ ok: true, message: "schema ensured" }, { headers: cors });
  }

  return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not Found", { status: 404, headers: cors });
}

export default {
  async fetch(request, env, ctx) { return handleRequest(request, env); },
  async scheduled(event, env, ctx) { ctx.waitUntil(runTradingCycle(env)); }
};
