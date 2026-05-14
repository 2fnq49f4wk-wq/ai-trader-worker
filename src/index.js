// AI Trader Worker - 진단 로그 버전
// 1분마다 자동 실행, 모든 단계를 D1 logs 테이블에 기록

const US_TICKERS = ['AAPL','NVDA','TSLA','MSFT','GOOGL','AMZN','META','AVGO','NFLX','AMD'];
const KR_TICKERS = ['005930.KS','000660.KS','373220.KS','207940.KS','005380.KS','005490.KS','000270.KS','035420.KS','006400.KS','068270.KS'];

const DEFAULT_CFG = {
  rsiBuy: 45, rsiSell: 55, rsiPeriod: 14,
  stopLoss: 5, takeProfit: 3,
  dayBuyPct: 2, daySellPct: 3,
  feeUS: 0.0001, feeKR: 0.0015,
  posSize: 15,
  maPeriod: 20, atrPeriod: 14,
  atrStopMult: 2.0, trailMult: 2.5,
  initialCashUS: 10000000, initialCashKR: 10000000,
};

// ===== 로그 헬퍼 =====
async function log(DB, level, symbol, message) {
  try {
    await DB.prepare('INSERT INTO logs (ts, level, symbol, message) VALUES (?, ?, ?, ?)')
      .bind(Date.now(), level, symbol, message).run();
  } catch (e) {
    console.error('log failed:', e.message);
  }
  console.log(`[${level}] ${symbol || ''} ${message}`);
}

// ===== 지표 =====
function getRSI(h, period) {
  period = period || 14;
  if (!Array.isArray(h) || h.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = h[i] - h[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  for (let j = period + 1; j < h.length; j++) {
    const d = h[j] - h[j - 1];
    avgG = (avgG * (period - 1) + (d > 0 ? d : 0)) / period;
    avgL = (avgL * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgL === 0) return avgG === 0 ? 50 : 100;
  return 100 - (100 / (1 + avgG / avgL));
}

function getMA(h, period) {
  if (!Array.isArray(h) || h.length < period) return null;
  let sum = 0;
  for (let i = h.length - period; i < h.length; i++) sum += h[i];
  return sum / period;
}

function getATR(h, period) {
  period = period || 14;
  if (!Array.isArray(h) || h.length < period + 1) return null;
  let trSum = 0;
  for (let i = h.length - period; i < h.length; i++) {
    trSum += Math.abs(h[i] - h[i - 1]);
  }
  return trSum / period;
}

// ===== Yahoo Finance =====
async function fetchPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error('no chart data');
  const closes = (result.indicators?.quote?.[0]?.close || []).filter(x => typeof x === 'number');
  if (closes.length === 0) throw new Error('no close data');
  const price = closes[closes.length - 1];
  const prevClose = result.meta?.chartPreviousClose ?? result.meta?.previousClose;
  return { symbol, price, prevClose, history: closes };
}

// ===== D1 헬퍼 =====
async function getState(DB, k, defaultVal) {
  const row = await DB.prepare('SELECT v FROM state WHERE k = ?').bind(k).first();
  if (!row) return defaultVal;
  try { return JSON.parse(row.v); } catch { return defaultVal; }
}

async function setState(DB, k, v) {
  await DB.prepare(
    'INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_ts=excluded.updated_ts'
  ).bind(k, JSON.stringify(v), Date.now()).run();
}

async function getPositions(DB, market) {
  const { results } = await DB.prepare('SELECT * FROM positions WHERE market = ?').bind(market).all();
  const map = {};
  for (const p of results) {
    map[p.symbol] = {
      qty: p.qty, avg: p.avg_price, opened_ts: p.opened_ts,
      meta: p.meta ? JSON.parse(p.meta) : {}
    };
  }
  return map;
}

async function savePosition(DB, market, symbol, pos) {
  await DB.prepare(
    'INSERT INTO positions (symbol, market, qty, avg_price, opened_ts, meta) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET qty=excluded.qty, avg_price=excluded.avg_price, meta=excluded.meta'
  ).bind(symbol, market, pos.qty, pos.avg, pos.opened_ts, JSON.stringify(pos.meta || {})).run();
}

async function deletePosition(DB, symbol) {
  await DB.prepare('DELETE FROM positions WHERE symbol = ?').bind(symbol).run();
}

async function recordTrade(DB, t) {
  await DB.prepare(
    'INSERT INTO trades (ts, market, symbol, side, qty, price, pnl, pnl_pct, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(t.ts, t.market, t.symbol, t.side, t.qty, t.price, t.pnl ?? null, t.pnl_pct ?? null, t.reason).run();
}

// ===== 매매 =====
async function executeBuy(DB, market, symbol, qty, price, reason, atr, cfg, cash) {
  const feeRate = market === 'us' ? cfg.feeUS : cfg.feeKR;
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  if (total > cash[market]) {
    await log(DB, 'WARN', symbol, `BUY aborted: insufficient cash (need ${total.toFixed(2)}, have ${cash[market].toFixed(2)})`);
    return cash;
  }
  cash[market] -= total;
  await savePosition(DB, market, symbol, {
    qty, avg: price, opened_ts: Date.now(),
    meta: { feePaid: fee, atrAtEntry: atr, stopPrice: atr ? price - atr * cfg.atrStopMult : null, peakPrice: price }
  });
  await recordTrade(DB, { ts: Date.now(), market, symbol, side: 'BUY', qty, price, reason });
  await log(DB, 'TRADE', symbol, `BUY x${qty} @${price.toFixed(2)} (${reason})`);
  return cash;
}

async function executeSell(DB, market, symbol, pos, price, reason, cfg, cash) {
  const feeRate = market === 'us' ? cfg.feeUS : cfg.feeKR;
  const gross = price * pos.qty;
  const fee = gross * feeRate;
  const proceeds = gross - fee;
  cash[market] += proceeds;
  const costBasis = pos.avg * pos.qty + (pos.meta?.feePaid || 0);
  const pnl = proceeds - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
  await deletePosition(DB, symbol);
  await recordTrade(DB, { ts: Date.now(), market, symbol, side: 'SELL', qty: pos.qty, price, pnl, pnl_pct: pnlPct, reason });
  await log(DB, 'TRADE', symbol, `SELL @${price.toFixed(2)} PnL ${pnlPct.toFixed(2)}% (${reason})`);
  return cash;
}

// ===== 메인 사이클 =====
async function runTradingCycle(env) {
  const DB = env.DB;
  await log(DB, 'INFO', null, '=== Trading cycle start ===');

  const cfg = { ...DEFAULT_CFG, ...(await getState(DB, 'cfg', {})) };
  const cash = await getState(DB, 'cash', { us: cfg.initialCashUS, kr: cfg.initialCashKR });
  const posSizeRatio = cfg.posSize / 100;

  let totalTried = 0, totalFetched = 0, totalSkipped = 0, totalBought = 0, totalSold = 0;

  for (const market of ['us', 'kr']) {
    const tickers = market === 'us' ? US_TICKERS : KR_TICKERS;
    const positions = await getPositions(DB, market);
    const feeRate = market === 'us' ? cfg.feeUS : cfg.feeKR;
    await log(DB, 'INFO', null, `[${market.toUpperCase()}] ${tickers.length} tickers, ${Object.keys(positions).length} positions`);

    for (const symbol of tickers) {
      totalTried++;
      try {
        const data = await fetchPrice(symbol);
        totalFetched++;

        if (!data.price || !data.history || data.history.length < 20) {
          totalSkipped++;
          await log(DB, 'SKIP', symbol, `history too short (${data.history?.length || 0} bars)`);
          continue;
        }

        const price = data.price;
        const prevClose = data.prevClose || price;
        const dayPct = ((price - prevClose) / prevClose) * 100;
        const rsi = getRSI(data.history, cfg.rsiPeriod);
        const ma = getMA(data.history, cfg.maPeriod);
        const atr = getATR(data.history, cfg.atrPeriod);

        if (rsi == null) {
          totalSkipped++;
          await log(DB, 'SKIP', symbol, `RSI null (history ${data.history.length} bars)`);
          continue;
        }

        const held = positions[symbol];

        if (held) {
          if (atr && held.meta?.peakPrice != null && price > held.meta.peakPrice) {
            held.meta.peakPrice = price;
            await savePosition(DB, market, symbol, held);
          }
          const pnlRate = ((price - held.avg) / held.avg) * 100;
          const hardStop = held.meta?.stopPrice;
          const trailStop = (atr && held.meta?.peakPrice) ? held.meta.peakPrice - atr * cfg.trailMult : null;

          let sold = false;
          if (rsi > cfg.rsiSell) {
            await executeSell(DB, market, symbol, held, price, `RSI ${rsi.toFixed(1)}`, cfg, cash); sold = true;
          } else if (dayPct >= cfg.daySellPct) {
            await executeSell(DB, market, symbol, held, price, `RALLY +${dayPct.toFixed(1)}%`, cfg, cash); sold = true;
          } else if (hardStop != null && price <= hardStop) {
            await executeSell(DB, market, symbol, held, price, `ATR-STOP ${pnlRate.toFixed(2)}%`, cfg, cash); sold = true;
          } else if (trailStop != null && price <= trailStop && pnlRate > 0) {
            await executeSell(DB, market, symbol, held, price, `TRAIL ${pnlRate.toFixed(2)}%`, cfg, cash); sold = true;
          } else if (hardStop == null && pnlRate <= -cfg.stopLoss) {
            await executeSell(DB, market, symbol, held, price, `STOPLOSS ${pnlRate.toFixed(2)}%`, cfg, cash); sold = true;
          } else if (trailStop == null && pnlRate >= cfg.takeProfit) {
            await executeSell(DB, market, symbol, held, price, `TAKEPROFIT ${pnlRate.toFixed(2)}%`, cfg, cash); sold = true;
          }
          if (sold) totalSold++;
          else await log(DB, 'HOLD', symbol, `price=${price.toFixed(2)} pnl=${pnlRate.toFixed(2)}% RSI=${rsi.toFixed(1)}`);
        } else {
          const trendOK = (ma == null) || (price >= ma);
          let canBuy = false, reason = '';
          if (trendOK) {
            if (rsi < cfg.rsiBuy) { canBuy = true; reason = `RSI ${rsi.toFixed(1)}`; }
            else if (dayPct <= -cfg.dayBuyPct) { canBuy = true; reason = `DIP ${dayPct.toFixed(1)}%`; }
          }
          if (canBuy) {
            const budget = cash[market] * posSizeRatio;
            const qty = Math.floor(budget / (price * (1 + feeRate)));
            const totalCost = qty * price * (1 + feeRate);
            if (qty > 0 && totalCost <= cash[market]) {
              await executeBuy(DB, market, symbol, qty, price, reason, atr, cfg, cash);
              totalBought++;
            } else {
              await log(DB, 'SKIP', symbol, `qty=${qty} budget=${budget.toFixed(2)} price=${price.toFixed(2)}`);
            }
          } else {
            await log(DB, 'NOBUY', symbol, `price=${price.toFixed(2)} RSI=${rsi.toFixed(1)} dayPct=${dayPct.toFixed(2)}% MA=${ma ? ma.toFixed(2) : 'n/a'} trendOK=${trendOK}`);
          }
        }
      } catch (e) {
        await log(DB, 'ERROR', symbol, `fetch/process failed: ${e.message}`);
      }
    }
  }

  await setState(DB, 'cash', cash);
  await setState(DB, 'last_tick', Date.now());
  await log(DB, 'INFO', null, `=== Cycle done: tried=${totalTried} fetched=${totalFetched} skipped=${totalSkipped} bought=${totalBought} sold=${totalSold} ===`);

  // 오래된 로그 정리 (최근 500건만 유지)
  await DB.prepare('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)').run();
}

// ===== HTTP 핸들러 =====
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  if (path === '/api/state') {
    const cash = await getState(env.DB, 'cash', { us: DEFAULT_CFG.initialCashUS, kr: DEFAULT_CFG.initialCashKR });
    const positionsUS = await getPositions(env.DB, 'us');
    const positionsKR = await getPositions(env.DB, 'kr');
    const lastTick = await getState(env.DB, 'last_tick', null);
    return Response.json({ cash, positions: { us: positionsUS, kr: positionsKR }, lastTick }, { headers: cors });
  }

  if (path === '/api/trades') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const { results } = await env.DB.prepare('SELECT * FROM trades ORDER BY ts DESC LIMIT ?').bind(limit).all();
    return Response.json(results, { headers: cors });
  }

  if (path === '/api/logs') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const { results } = await env.DB.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').bind(limit).all();
    return Response.json(results, { headers: cors });
  }

  if (path === '/api/tick' && request.method === 'POST') {
    await runTradingCycle(env);
    return Response.json({ ok: true, ts: Date.now() }, { headers: cors });
  }

  if (path === '/yahoo' || path.startsWith('/proxy')) {
    const target = url.searchParams.get('url');
    if (!target) return new Response('missing url', { status: 400, headers: cors });
    const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not Found', { status: 404, headers: cors });
}

export default {
  async fetch(request, env, ctx) { return handleRequest(request, env); },
  async scheduled(event, env, ctx) { ctx.waitUntil(runTradingCycle(env)); },
};
