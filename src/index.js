// AI Trader Worker - 1분마다 자동 실행되는 거래 엔진
// 기존 index.html의 전략을 그대로 이식

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

// ===== 지표 계산 (기존 로직 그대로) =====
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

// ===== Yahoo Finance 가격 조회 =====
async function fetchPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error('no data');
  const closes = (result.indicators?.quote?.[0]?.close || []).filter(x => typeof x === 'number');
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
  const now = Date.now();
  await DB.prepare(
    'INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_ts=excluded.updated_ts'
  ).bind(k, JSON.stringify(v), now).run();
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

// ===== 매매 실행 =====
async function executeBuy(DB, market, symbol, qty, price, reason, atr, cfg, cash) {
  const feeRate = market === 'us' ? cfg.feeUS : cfg.feeKR;
  const gross = price * qty;
  const fee = gross * feeRate;
  const total = gross + fee;
  if (total > cash[market]) return cash;

  cash[market] -= total;
  await savePosition(DB, market, symbol, {
    qty, avg: price, opened_ts: Date.now(),
    meta: {
      feePaid: fee,
      atrAtEntry: atr,
      stopPrice: atr ? price - atr * cfg.atrStopMult : null,
      peakPrice: price,
    }
  });
  await recordTrade(DB, { ts: Date.now(), market, symbol, side: 'BUY', qty, price, reason });
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
  return cash;
}

// ===== 메인 거래 사이클 (1분마다 실행) =====
async function runTradingCycle(env) {
  const DB = env.DB;
  const cfg = { ...DEFAULT_CFG, ...(await getState(DB, 'cfg', {})) };
  const cash = await getState(DB, 'cash', { us: cfg.initialCashUS, kr: cfg.initialCashKR });
  const posSizeRatio = cfg.posSize / 100;

  for (const market of ['us', 'kr']) {
    const tickers = market === 'us' ? US_TICKERS : KR_TICKERS;
    const positions = await getPositions(DB, market);
    const feeRate = market === 'us' ? cfg.feeUS : cfg.feeKR;

    for (const symbol of tickers) {
      try {
        const data = await fetchPrice(symbol);
        if (!data.price || !data.history || data.history.length < 20) continue;

        const price = data.price;
        const prevClose = data.prevClose || price;
        const dayPct = ((price - prevClose) / prevClose) * 100;
        const rsi = getRSI(data.history, cfg.rsiPeriod);
        const ma = getMA(data.history, cfg.maPeriod);
        const atr = getATR(data.history, cfg.atrPeriod);

        if (rsi == null) continue;

        const held = positions[symbol];

        if (held) {
          // ===== 보유 중: 매도 조건 =====
          if (atr && held.meta?.peakPrice != null) {
            if (price > held.meta.peakPrice) {
              held.meta.peakPrice = price;
              await savePosition(DB, market, symbol, held);
            }
          }
          const pnlRate = ((price - held.avg) / held.avg) * 100;
          const hardStop = held.meta?.stopPrice;
          const trailStop = (atr && held.meta?.peakPrice) ? held.meta.peakPrice - atr * cfg.trailMult : null;

          if (rsi > cfg.rsiSell) {
            await executeSell(DB, market, symbol, held, price, `RSI ${rsi.toFixed(1)}`, cfg, cash);
          } else if (dayPct >= cfg.daySellPct) {
            await executeSell(DB, market, symbol, held, price, `RALLY +${dayPct.toFixed(1)}%`, cfg, cash);
          } else if (hardStop != null && price <= hardStop) {
            await executeSell(DB, market, symbol, held, price, `ATR-STOP ${pnlRate.toFixed(2)}%`, cfg, cash);
          } else if (trailStop != null && price <= trailStop && pnlRate > 0) {
            await executeSell(DB, market, symbol, held, price, `TRAIL ${pnlRate.toFixed(2)}%`, cfg, cash);
          } else if (hardStop == null && pnlRate <= -cfg.stopLoss) {
            await executeSell(DB, market, symbol, held, price, `STOPLOSS ${pnlRate.toFixed(2)}%`, cfg, cash);
          } else if (trailStop == null && pnlRate >= cfg.takeProfit) {
            await executeSell(DB, market, symbol, held, price, `TAKEPROFIT ${pnlRate.toFixed(2)}%`, cfg, cash);
          }
        } else {
          // ===== 미보유: 매수 조건 =====
          const trendOK = (ma == null) || (price >= ma);
          let canBuy = false, reason = '';
          if (trendOK) {
            if (rsi < cfg.rsiBuy) {
              canBuy = true;
              reason = `RSI ${rsi.toFixed(1)}` + (ma != null ? ' >MA' : '');
            } else if (dayPct <= -cfg.dayBuyPct) {
              canBuy = true;
              reason = `DIP ${dayPct.toFixed(1)}%` + (ma != null ? ' >MA' : '');
            }
          }
          if (canBuy) {
            const budget = cash[market] * posSizeRatio;
            const qty = Math.floor(budget / (price * (1 + feeRate)));
            const totalCost = qty * price * (1 + feeRate);
            if (qty > 0 && totalCost <= cash[market]) {
              await executeBuy(DB, market, symbol, qty, price, reason, atr, cfg, cash);
            }
          }
        }
      } catch (e) {
        console.error(`${symbol}: ${e.message}`);
      }
    }
  }

  await setState(DB, 'cash', cash);
  await setState(DB, 'last_tick', Date.now());
}

// ===== HTTP 핸들러 (API + 프록시 호환) =====
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  // 상태 조회
  if (path === '/api/state') {
    const cash = await getState(env.DB, 'cash', { us: DEFAULT_CFG.initialCashUS, kr: DEFAULT_CFG.initialCashKR });
    const positionsUS = await getPositions(env.DB, 'us');
    const positionsKR = await getPositions(env.DB, 'kr');
    const lastTick = await getState(env.DB, 'last_tick', null);
    return Response.json({ cash, positions: { us: positionsUS, kr: positionsKR }, lastTick }, { headers: cors });
  }

  // 거래 내역
  if (path === '/api/trades') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const { results } = await env.DB.prepare('SELECT * FROM trades ORDER BY ts DESC LIMIT ?').bind(limit).all();
    return Response.json(results, { headers: cors });
  }

  // 수동 1회 실행 (테스트용)
  if (path === '/api/tick' && request.method === 'POST') {
    await runTradingCycle(env);
    return Response.json({ ok: true, ts: Date.now() }, { headers: cors });
  }

  // 기존 프록시 호환 (Yahoo Finance)
  if (path === '/yahoo' || path.startsWith('/proxy')) {
    const target = url.searchParams.get('url');
    if (!target) return new Response('missing url', { status: 400, headers: cors });
    const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // 그 외: 정적 파일 (index.html 등) 자동 서빙 (wrangler.toml의 [assets] 설정)
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not Found', { status: 404, headers: cors });
}

// ===== Worker 진입점 =====
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTradingCycle(env));
  },
};
