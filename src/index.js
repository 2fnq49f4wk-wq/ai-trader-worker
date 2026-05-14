const DEFAULT_US = ['AAPL','NVDA','TSLA','MSFT','GOOGL','AMZN','META','AVGO','NFLX','AMD'];
const DEFAULT_KR = ['005930.KS','000660.KS','373220.KS','207940.KS','005380.KS','005490.KS','000270.KS','035420.KS','006400.KS','068270.KS'];

const DEFAULT_CFG = {
  usTickers: DEFAULT_US,
  krTickers: DEFAULT_KR,
  rsiBuy: 45, rsiSell: 55, rsiPeriod: 14,
  stopLoss: 5, takeProfit: 3,
  dayBuyPct: 2, daySellPct: 3,
  feeUS: 0.0001, feeKR: 0.0015,
  posSize: 15,
  maPeriod: 20, atrPeriod: 14,
  atrStopMult: 2.0, trailMult: 2.5,
  initialCashUS: 10000000, initialCashKR: 10000000,
  enabled: true,
};

async function log(DB, level, symbol, message) {
  try {
    await DB.prepare('INSERT INTO logs (ts, level, symbol, message) VALUES (?, ?, ?, ?)')
      .bind(Date.now(), level, symbol, message).run();
  } catch (e) { console.error('log fail:', e.message); }
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
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1m&range=1d';
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    }
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result) throw new Error('no chart data');
  const closes = ((result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || []).filter(function(x){ return typeof x === 'number'; });
  if (closes.length === 0) throw new Error('no close data');
  const price = closes[closes.length - 1];
  const prevClose = (result.meta && (result.meta.chartPreviousClose || result.meta.previousClose));
  return { symbol: symbol, price: price, prevClose: prevClose, history: closes };
}

async function getState(DB, k, def) {
  const row = await DB.prepare('SELECT v FROM state WHERE k = ?').bind(k).first();
  if (!row) return def;
  try { return JSON.parse(row.v); } catch (e) { return def; }
}

async function setState(DB, k, v) {
  await DB.prepare('INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_ts=excluded.updated_ts')
    .bind(k, JSON.stringify(v), Date.now()).run();
}

async function getPositions(DB, market) {
  const res = await DB.prepare('SELECT * FROM positions WHERE market = ?').bind(market).all();
  const map = {};
  for (const p of res.results) {
    map[p.symbol] = { qty: p.qty, avg: p.avg_price, opened_ts: p.opened_ts, meta: p.meta ? JSON.parse(p.meta) : {} };
  }
  return map;
}

async function savePosition(DB, market, symbol, pos) {
  await DB.prepare('INSERT INTO positions (symbol, market, qty, avg_price, opened_ts, meta) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET qty=excluded.qty, avg_price=excluded.avg_price, meta=excluded.meta')
    .bind(symbol, market, pos.qty, pos.avg, pos.opened_ts, JSON.stringify(pos.meta || {})).run();
}

async function deletePosition(DB, symbol) {
  await DB.prepare('DELETE FROM positions WHERE symbol = ?').bind(symbol).run();
}

async function recordTrade(DB, t) {
  await DB.prepare('INSERT INTO trades (ts, market, symbol, side, qty, price, pnl, pnl_pct, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(t.ts, t.market, t.symbol, t.side, t.qty, t.price, t.pnl == null ? null : t.pnl, t.pnl_pct == null ? null : t.pnl_pct, t.reason).run();
}

async function executeBuy(DB, market, symbol, qty, price, reason, atr, cfg, cash) {
  const feeRate = market === 'us' ? cfg.feeUS : cfg.feeKR;
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  if (total > cash[market]) { await log(DB, 'WARN', symbol, 'BUY aborted: cash short'); return cash; }
  cash[market] -= total;
  await savePosition(DB, market, symbol, {
    qty: qty, avg: price, opened_ts: Date.now(),
    meta: { feePaid: fee, atrAtEntry: atr, stopPrice: atr ? price - atr * cfg.atrStopMult : null, peakPrice: price }
  });
  await recordTrade(DB, { ts: Date.now(), market: market, symbol: symbol, side: 'BUY', qty: qty, price: price, reason: reason });
  await log(DB, 'TRADE', symbol, 'BUY x' + qty + ' @' + price.toFixed(2) + ' (' + reason + ')');
  return cash;
}

async function executeSell(DB, market, symbol, pos, price, reason, cfg, cash) {
  const feeRate = market === 'us' ? cfg.feeUS : cfg.feeKR;
  const gross = price * pos.qty;
  const fee = gross * feeRate;
  const proceeds = gross - fee;
  cash[market] += proceeds;
  const costBasis = pos.avg * pos.qty + ((pos.meta && pos.meta.feePaid) || 0);
  const pnl = proceeds - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
  await deletePosition(DB, symbol);
  await recordTrade(DB, { ts: Date.now(), market: market, symbol: symbol, side: 'SELL', qty: pos.qty, price: price, pnl: pnl, pnl_pct: pnlPct, reason: reason });
  await log(DB, 'TRADE', symbol, 'SELL @' + price.toFixed(2) + ' PnL ' + pnlPct.toFixed(2) + '% (' + reason + ')');
  return cash;
}

async function saveQuote(DB, symbol, market, q) {
  await setState(DB, 'quote:' + symbol, {
    market: market, price: q.price, prevClose: q.prevClose,
    dayPct: q.dayPct, rsi: q.rsi, ma: q.ma, atr: q.atr, ts: Date.now()
  });
}

async function runTradingCycle(env) {
  const DB = env.DB;
  const cfg = Object.assign({}, DEFAULT_CFG, await getState(DB, 'cfg', {}));
  if (!cfg.enabled) { await log(DB, 'INFO', null, 'engine disabled'); return; }

  await log(DB, 'INFO', null, '=== Cycle start ===');
  const cash = await getState(DB, 'cash', { us: cfg.initialCashUS, kr: cfg.initialCashKR });
  const posSizeRatio = cfg.posSize / 100;
  let tried = 0, fetched = 0, bought = 0, sold = 0, skipped = 0;

  for (const market of ['us', 'kr']) {
    const tickers = market === 'us' ? cfg.usTickers : cfg.krTickers;
    const positions = await getPositions(DB, market);
    const feeRate = market === 'us' ? cfg.feeUS : cfg.feeKR;

    for (const symbol of tickers) {
      tried++;
      try {
        const data = await fetchPrice(symbol);
        fetched++;

        if (!data.price || !data.history || data.history.length < 20) {
          skipped++;
          await log(DB, 'SKIP', symbol, 'history short (' + (data.history ? data.history.length : 0) + ')');
          continue;
        }

        const price = data.price;
        const prevClose = data.prevClose || price;
        const dayPct = ((price - prevClose) / prevClose) * 100;
        const rsi = getRSI(data.history, cfg.rsiPeriod);
        const ma = getMA(data.history, cfg.maPeriod);
        const atr = getATR(data.history, cfg.atrPeriod);

        await saveQuote(DB, symbol, market, { price: price, prevClose: prevClose, dayPct: dayPct, rsi: rsi, ma: ma, atr: atr });

        if (rsi == null) { skipped++; await log(DB, 'SKIP', symbol, 'RSI null'); continue; }

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
            await executeSell(DB, market, symbol, held, price, 'RSI ' + rsi.toFixed(1), cfg, cash); didSell = true;
          } else if (dayPct >= cfg.daySellPct) {
            await executeSell(DB, market, symbol, held, price, 'RALLY +' + dayPct.toFixed(1) + '%', cfg, cash); didSell = true;
          } else if (hardStop != null && price <= hardStop) {
            await executeSell(DB, market, symbol, held, price, 'ATR-STOP ' + pnlRate.toFixed(2) + '%', cfg, cash); didSell = true;
          } else if (trailStop != null && price <= trailStop && pnlRate > 0) {
            await executeSell(DB, market, symbol, held, price, 'TRAIL ' + pnlRate.toFixed(2) + '%', cfg, cash); didSell = true;
          } else if (hardStop == null && pnlRate <= -cfg.stopLoss) {
            await executeSell(DB, market, symbol, held, price, 'STOPLOSS ' + pnlRate.toFixed(2) + '%', cfg, cash); didSell = true;
          } else if (trailStop == null && pnlRate >= cfg.takeProfit) {
            await executeSell(DB, market, symbol, held, price, 'TAKEPROFIT ' + pnlRate.toFixed(2) + '%', cfg, cash); didSell = true;
          }
          if (didSell) sold++;
        } else {
          const trendOK = (ma == null) || (price >= ma);
          let canBuy = false, reason = '';
          if (trendOK) {
            if (rsi < cfg.rsiBuy) { canBuy = true; reason = 'RSI ' + rsi.toFixed(1); }
            else if (dayPct <= -cfg.dayBuyPct) { canBuy = true; reason = 'DIP ' + dayPct.toFixed(1) + '%'; }
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
            await log(DB, 'NOBUY', symbol, 'p=' + price.toFixed(2) + ' RSI=' + rsi.toFixed(1) + ' day=' + dayPct.toFixed(2) + '% MA=' + (ma ? ma.toFixed(2) : 'n/a'));
          }
        }
      } catch (e) {
        await log(DB, 'ERROR', symbol, e.message);
      }
    }
  }

  await setState(DB, 'cash', cash);
  await setState(DB, 'last_tick', Date.now());
  await log(DB, 'INFO', null, 'Done: tried=' + tried + ' fetched=' + fetched + ' skip=' + skipped + ' buy=' + bought + ' sell=' + sold);

  await DB.prepare('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)').run();
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  if (path === '/api/state') {
    const cfg = Object.assign({}, DEFAULT_CFG, await getState(env.DB, 'cfg', {}));
    const cash = await getState(env.DB, 'cash', { us: cfg.initialCashUS, kr: cfg.initialCashKR });
    const positionsUS = await getPositions(env.DB, 'us');
    const positionsKR = await getPositions(env.DB, 'kr');
    const lastTick = await getState(env.DB, 'last_tick', null);
    const payload = { cash: cash, positions: { us: positionsUS, kr: positionsKR }, lastTick: lastTick, cfg: cfg };
    return Response.json(payload, { headers: cors });
  }

  if (path === '/api/watchlist') {
    const cfg = Object.assign({}, DEFAULT_CFG, await getState(env.DB, 'cfg', {}));
    const allSymbols = cfg.usTickers.concat(cfg.krTickers);
    const quotes = [];
    for (const sym of allSymbols) {
      const q = await getState(env.DB, 'quote:' + sym, null);
      if (q) quotes.push(Object.assign({ symbol: sym }, q));
    }
    return Response.json(quotes, { headers: cors });
  }

  if (path === '/api/trades') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const res = await env.DB.prepare('SELECT * FROM trades ORDER BY ts DESC LIMIT ?').bind(limit).all();
    return Response.json(res.results, { headers: cors });
  }

  if (path === '/api/logs') {
    const limit = parseInt(url.searchParams.get('limit') || '200', 10);
    const res = await env.DB.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').bind(limit).all();
    return Response.json(res.results, { headers: cors });
  }

  if (path === '/api/cfg' && request.method === 'GET') {
    const cfg = Object.assign({}, DEFAULT_CFG, await getState(env.DB, 'cfg', {}));
    return Response.json(cfg, { headers: cors });
  }

  if (path === '/api/cfg' && request.method === 'POST') {
    const body = await request.json();
    const current = Object.assign({}, DEFAULT_CFG, await getState(env.DB, 'cfg', {}));
    const next = Object.assign({}, current, body);
    await setState(env.DB, 'cfg', next);
    await log(env.DB, 'INFO', null, 'cfg updated');
    return Response.json({ ok: true, cfg: next }, { headers: cors });
  }

  if (path === '/api/reset' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM trades').run();
    await env.DB.prepare('DELETE FROM positions').run();
    await env.DB.prepare('DELETE FROM logs').run();
    await env.DB.prepare("DELETE FROM state WHERE k NOT LIKE 'quote:%'").run();
    await log(env.DB, 'INFO', null, 'RESET: all cleared');
    return Response.json({ ok: true }, { headers: cors });
  }

  if (path === '/api/tick' && request.method === 'POST') {
    await runTradingCycle(env);
    return Response.json({ ok: true, ts: Date.now() }, { headers: cors });
  }

  return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not Found', { status: 404, headers: cors });
}

export default {
  async fetch(request, env, ctx) { return handleRequest(request, env); },
  async scheduled(event, env, ctx) { ctx.waitUntil(runTradingCycle(env)); }
};
