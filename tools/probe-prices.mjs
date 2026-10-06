/* [V33.493] ★화면 시세가 맞는가 · 얼마나 빨리 오는가★ — 운영 /api/state 의 관심종목 시세를 독립 출처와 1:1 대조한다(읽기 전용 GET).
 * 사용자: "주식 가격 로딩 더 정확하고 빨리 뜨게 · 실시간 가격 맞는지 전부 확인해". 샌드박스는 운영 주소에 못 닿아 CI 에서 돈다(ui-probe prices=true).
 * ① 응답: /api/state 3회 — 지연 · 캐시 층(X-Cache) · 사본 나이 · stale 표시
 * ② 관심종목: 시장별 가격 없음(pending) · 시세 나이(q.ts) 분포 · 등락률 자기정합(dayPct ≟ (price-prevClose)/prevClose)
 * ③ 대조: 미국 = 야후 v8 chart(종목당) · 한국 = 네이버 polling(배치, 워커와 같은 원천 → 전달 지연을 본다) + m.stock 기본정보(표본, 다른 엔드포인트)
 *    괴리 = |우리 − 기준| / 기준. 정규장이면 우리 나이·기준 시각을 함께 적어 '늦음' 과 '틀림' 을 가른다.
 * 사용법: node tools/probe-prices.mjs <url> */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: node tools/probe-prices.mjs <url>"); process.exit(2); }
const out = (k, v) => console.log("PX " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "Accept": "application/json,text/plain,*/*" };
const pct = (a, b) => (a > 0 && b > 0) ? Math.abs(a - b) / b * 100 : null;
const qs = (xs, p) => { const s = xs.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(3) : null; };
const pool = async (items, n, fn) => { const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { res[k] = await fn(items[k]); } catch (e) { res[k] = null; } } })); return res; };

// ① 응답 속도 · 캐시
let state = null;
for (let k = 0; k < 3; k++) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + "/api/state", { headers: { "cache-control": "no-cache" } });
    const txt = await r.text(), ms = Date.now() - t0;
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    out("state_fetch", { try: k + 1, http: r.status, ms, kb: Math.round(txt.length / 1024), xcache: r.headers.get("x-cache"), xage: r.headers.get("x-state-age"),
      stale: j ? !!j.stale : null, builtAgoS: j && j.serverTime ? Math.round((Date.now() - j.serverTime) / 1000) : null,
      quotesAgoS: j && j.quotesAt ? Math.round((Date.now() - j.quotesAt) / 1000) : null, quotesPatched: j ? j.quotesPatched || null : null });
    if (j && Array.isArray(j.watchlist)) state = j;
  } catch (e) { out("state_fetch", { try: k + 1, err: String(e.message || e).slice(0, 120) }); }
  await new Promise((s) => setTimeout(s, 1500));
}
if (!state) { out("abort", "state 없음"); process.exit(0); }
const now = Date.now();
out("market", { open: state.marketStatus, window: state.tradingWindow, utc: new Date(now).toISOString() });

// ② 관심종목 자체 점검
const W = state.watchlist;
// 보유 포지션이 관심종목 밖(티커 변경·상장폐지로 빠짐)이거나 시세가 하루 넘게 묵었으면 평가액이 틀린다
{ const wm = new Map(W.map((q) => [q.symbol, q])), bad = [];
  for (const mk of ["us", "kr"]) for (const p of ((state.positions || {})[mk] || [])) { const q = wm.get(p.symbol);
    if (!q || !(q.price > 0) || !q.ts || now - q.ts > 86400000) bad.push({ mk, s: p.symbol, strat: p.strategy, qty: p.qty, inWatch: !!q, ageH: q && q.ts ? Math.round((now - q.ts) / 3600000) : null }); }
  out("positions_stale", { n: bad.length, rows: bad.slice(0, 20) }); }
for (const mk of ["us", "kr"]) {
  const A = W.filter((q) => q.market === mk);
  const ages = A.filter((q) => q.ts).map((q) => (now - q.ts) / 60000);
  const pend = A.filter((q) => !(q.price > 0));
  // 시간외(PRE/POST)엔 price/dayPct 가 시간외 값으로 덮인다(applyDisplayOverMarket) — 정규장 값(regPrice/regPct)으로 정합을 본다
  const rp = (q) => (q.regPrice > 0 ? q.regPrice : q.price), rd = (q) => (typeof q.regPct === "number" ? q.regPct : q.dayPct);
  const incoh = A.filter((q) => rp(q) > 0 && q.prevClose > 0 && typeof rd(q) === "number" && Math.abs(((rp(q) - q.prevClose) / q.prevClose * 100) - rd(q)) > 0.05);
  out("mstate_" + mk, A.reduce((m, q) => { const k = q.mstate || "none"; m[k] = (m[k] || 0) + 1; return m; }, {}));
  out("self_" + mk, { n: A.length, pending: pend.length, pendingEx: pend.slice(0, 8).map((q) => q.symbol), noTs: A.filter((q) => q.price > 0 && !q.ts).length,
    ageMin: { p50: qs(ages, 0.5), p90: qs(ages, 0.9), max: qs(ages, 1) }, olderThan10m: ages.filter((a) => a > 10).length, olderThan60m: ages.filter((a) => a > 60).length,
    dayPctIncoherent: incoh.length, incohEx: incoh.slice(0, 5).map((q) => ({ s: q.symbol, p: rp(q), pc: q.prevClose, d: rd(q), ms: q.mstate })) });
  // 가장 오래된 10개
  out("oldest_" + mk, A.filter((q) => q.ts).sort((a, b) => a.ts - b.ts).slice(0, 10).map((q) => ({ s: q.symbol, ageMin: Math.round((now - q.ts) / 60000), p: q.price })));
}

// ③ 독립 대조
const report = (tag, rows) => {   // rows: {s, ours, ref, ourAgeMin, refTime, oursPc, refPc}
  const ok = rows.filter((r) => r && r.ref > 0 && r.ours > 0);
  const dev = ok.map((r) => pct(r.ours, r.ref));
  const pcDev = ok.filter((r) => r.oursPc > 0 && r.refPc > 0).map((r) => pct(r.oursPc, r.refPc));
  out(tag, { compared: ok.length, missingRef: rows.filter((r) => r && !(r.ref > 0)).length, devPct: { p50: qs(dev, 0.5), p90: qs(dev, 0.9), p99: qs(dev, 0.99), max: qs(dev, 1) },
    over0_1: dev.filter((d) => d > 0.1).length, over0_5: dev.filter((d) => d > 0.5).length, over2: dev.filter((d) => d > 2).length,
    prevCloseOver0_1: pcDev.filter((d) => d > 0.1).length, prevCloseCompared: pcDev.length });
  out(tag + "_worst", ok.map((r) => Object.assign({ dev: +pct(r.ours, r.ref).toFixed(3) }, r)).sort((a, b) => b.dev - a.dev).slice(0, 15));
  const pcw = ok.filter((r) => r.oursPc > 0 && r.refPc > 0 && pct(r.oursPc, r.refPc) > 0.1).slice(0, 10);
  if (pcw.length) out(tag + "_prevclose_mismatch", pcw);
};

// 미국 — ① 야후 v8 chart(러너가 막히면 HTTP 코드만 남는다) ② 나스닥 종목정보 ③ stooq CSV(배치)
const US = W.filter((q) => q.market === "us");
const regOf = (q) => (q.regPrice > 0 ? q.regPrice : q.price);
const yhttp = {};
const usRows = await pool(US, 6, async (q) => {
  const r = await fetch("https://query2.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(q.symbol) + "?range=1d&interval=1d", { headers: Object.assign({ "Referer": "https://finance.yahoo.com/" }, UA) });
  yhttp[r.status] = (yhttp[r.status] || 0) + 1;
  if (!r.ok) return { s: q.symbol, ours: regOf(q), ref: null, http: r.status };
  const j = await r.json(); const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  if (!m) return { s: q.symbol, ours: q.price, ref: null };
  return { s: q.symbol, ours: regOf(q), ref: m.regularMarketPrice, ourAgeMin: q.ts ? Math.round((now - q.ts) / 60000) : null,
    refTime: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString().slice(5, 16) : null, oursPc: q.prevClose, refPc: m.chartPreviousClose || m.previousClose };
});
out("yahoo_http", yhttp);
report("cmp_us_yahoo", usRows);

// 나스닥 — 표본(시총 상위 40 + 가장 오래된 10). 정규장 종가/현재가 = primaryData(장중) · 시간외엔 secondaryData 가 정규장 종가
const NUA = { "User-Agent": UA["User-Agent"], "Accept": "application/json", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/" };
const nnum = (x) => x == null ? null : Number(String(x).replace(/[$,%+\s]/g, ""));
const usSample = US.slice().sort((a, b) => (a.rank || 99999) - (b.rank || 99999)).slice(0, 40)
  .concat(US.filter((q) => q.ts).sort((a, b) => a.ts - b.ts).slice(0, 10));
const ndRows = await pool(usSample, 4, async (q) => {
  const r = await fetch("https://api.nasdaq.com/api/quote/" + encodeURIComponent(q.symbol.replace("-", ".")) + "/info?assetclass=stocks", { headers: NUA });
  if (!r.ok) return { s: q.symbol, ours: regOf(q), ref: null, http: r.status };
  const j = await r.json(); const d = j && j.data; if (!d) return { s: q.symbol, ours: regOf(q), ref: null, status: j && j.status };
  const pd = d.primaryData || {}, sd = d.secondaryData || null;
  const isExt = sd && /after|pre/i.test(String(pd.lastTradeTimestamp || "") + " " + String(d.marketStatus || ""));
  const ref = isExt && sd ? nnum(sd.lastSalePrice) : nnum(pd.lastSalePrice);
  return { s: q.symbol, ours: regOf(q), ref, ourAgeMin: q.ts ? Math.round((now - q.ts) / 60000) : null,
    refTime: String((isExt && sd ? sd.lastTradeTimestamp : pd.lastTradeTimestamp) || "").slice(0, 40), mkt: d.marketStatus || null, ext: !!isExt };
});
report("cmp_us_nasdaq", ndRows);

// stooq — 정규장 마지막 체결(시간외 없음). 50개씩 배치
const stq = {};
for (let i = 0; i < US.length; i += 50) {
  const ss = US.slice(i, i + 50).map((q) => q.symbol.toLowerCase().replace("-", ".") + ".us");
  try {
    const r = await fetch("https://stooq.com/q/l/?s=" + ss.join("+") + "&f=sd2t2c&h&e=csv", { headers: { "User-Agent": UA["User-Agent"] } });
    const t = await r.text();
    if (i === 0) out("stooq_http", { http: r.status, head: t.slice(0, 120).replace(/\s+/g, " ") });
    for (const line of t.split(/\r?\n/).slice(1)) { const c = line.split(","); if (c.length >= 4 && c[3] && c[3] !== "N/D") stq[c[0].toUpperCase()] = { c: Number(c[3]), d: c[1], t: c[2] }; }
  } catch (e) {}
}
report("cmp_us_stooq", US.map((q) => { const k = q.symbol.toUpperCase().replace("-", ".") + ".US", x = stq[k];
  return { s: q.symbol, ours: regOf(q), ref: x ? x.c : null, refTime: x ? x.d + " " + x.t : null, ourAgeMin: q.ts ? Math.round((now - q.ts) / 60000) : null }; }));

// 한국 — 네이버 polling(전 종목 배치)
const KR = W.filter((q) => q.market === "kr");
const nv = {};
for (let i = 0; i < KR.length; i += 60) {
  const codes = KR.slice(i, i + 60).map((q) => q.symbol.split(".")[0]);
  try {
    const r = await fetch("https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:" + codes.join(","), { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com" } });
    const j = await r.json();
    for (const d of (j && j.result && j.result.areas && j.result.areas[0] && j.result.areas[0].datas) || []) nv[d.cd] = d;
  } catch (e) {}
}
report("cmp_kr_naverPolling", KR.map((q) => { const d = nv[q.symbol.split(".")[0]];
  return { s: q.symbol, ours: q.price, ref: d ? Number(d.nv) : null, oursPc: q.prevClose, refPc: d ? Number(d.sv) : null, ourAgeMin: q.ts ? Math.round((now - q.ts) / 60000) : null, ms: d ? d.ms : null }; }));

// 한국 — 네이버 polling 이 아무것도 안 준 종목: 상장폐지·거래정지·코드 변경 확인(m.stock 기본정보 원문 일부)
for (const q of KR.filter((q) => !nv[q.symbol.split(".")[0]])) {
  try {
    const r = await fetch("https://m.stock.naver.com/api/stock/" + q.symbol.split(".")[0] + "/basic", { headers: { "User-Agent": UA["User-Agent"], "Referer": "https://m.stock.naver.com/" } });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    out("kr_noref", { s: q.symbol, name: q.name, ourPrice: q.price, ourAgeDays: q.ts ? +((now - q.ts) / 86400000).toFixed(1) : null, http: r.status,
      basic: j ? { name: j.stockName, close: j.closePrice, status: j.marketStatus, end: j.stockEndType, stop: j.tradeStopType, at: j.localTradedAt } : t.slice(0, 160) });
  } catch (e) { out("kr_noref", { s: q.symbol, err: String(e.message || e).slice(0, 80) }); }
}

// 한국 — m.stock 기본정보(다른 엔드포인트) 표본: 시총 상위 + 무작위 섞어 60개
const krSample = KR.slice().sort((a, b) => (a.rank || 99999) - (b.rank || 99999)).slice(0, 30).concat(KR.filter((_, i) => i % Math.max(1, Math.floor(KR.length / 30)) === 0).slice(0, 30));
const seen = new Set(), krS = krSample.filter((q) => !seen.has(q.symbol) && seen.add(q.symbol));
const num = (x) => x == null ? null : Number(String(x).replace(/,/g, ""));
const krRows = await pool(krS, 6, async (q) => {
  const code = q.symbol.split(".")[0];
  const r = await fetch("https://m.stock.naver.com/api/stock/" + code + "/basic", { headers: { "User-Agent": UA["User-Agent"], "Referer": "https://m.stock.naver.com/" } });
  if (!r.ok) return { s: q.symbol, ours: q.price, ref: null, http: r.status };
  const j = await r.json();
  const ref = num(j.closePrice), chg = num(j.compareToPreviousClosePrice);
  const sign = (j.compareToPreviousPrice && /FALL|LOWER|하락/i.test(String(j.compareToPreviousPrice.name || j.compareToPreviousPrice.code || ""))) ? -1 : 1;
  return { s: q.symbol, name: q.name, ours: q.price, ref, oursPc: q.prevClose, refPc: (ref != null && chg != null) ? ref - sign * Math.abs(chg) : null,
    ourAgeMin: q.ts ? Math.round((now - q.ts) / 60000) : null, refTime: j.localTradedAt || null, status: j.marketStatus || null };
});
report("cmp_kr_mstock", krRows);

// 지수
const IDX = { "^GSPC": "^GSPC", "^IXIC": "^IXIC", "^DJI": "^DJI", "^KS11": "^KS11", "^KQ11": "^KQ11" };
const idxRows = await pool((state.indices || []).filter((x) => IDX[x.symbol]), 4, async (x) => {
  const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(x.symbol) + "?range=1d&interval=1d", { headers: UA });
  const j = r.ok ? await r.json() : null; const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  return { s: x.symbol, ours: x.price, ref: m ? m.regularMarketPrice : null, ourAgeMin: x.ts ? Math.round((now - x.ts) / 60000) : null };
});
report("cmp_indices_yahoo", idxRows);

// 진단: 낡은 미국 종목(가장 오래된 순) — 나스닥 원문 상태 · 이름 검색(티커 변경 여부)
for (const q of US.filter((q) => q.ts && now - q.ts > 86400000).slice(0, 6)) {
  try {
    const r = await fetch("https://api.nasdaq.com/api/quote/" + encodeURIComponent(q.symbol.replace("-", ".")) + "/info?assetclass=stocks", { headers: NUA });
    const j = await r.json().catch(() => null);
    const pd = j && j.data && j.data.primaryData;
    const r2 = await fetch("https://api.nasdaq.com/api/autocomplete/slookup/10?search=" + encodeURIComponent(q.name || q.symbol), { headers: NUA });
    const j2 = await r2.json().catch(() => null);
    out("us_stale", { s: q.symbol, name: q.name, ourPrice: q.price, ageDays: +((now - q.ts) / 86400000).toFixed(1), http: r.status,
      nasdaq: j ? { rCode: j.status && j.status.rCode, msg: j.status && j.status.bCodeMessage, company: j.data && j.data.companyName, last: pd && pd.lastSalePrice, at: pd && pd.lastTradeTimestamp } : null,
      lookup: j2 && Array.isArray(j2.data) ? j2.data.slice(0, 5).map((x) => x.symbol + ":" + String(x.name || "").slice(0, 40) + ":" + (x.asset || "")) : null });
  } catch (e) { out("us_stale", { s: q.symbol, err: String(e.message || e).slice(0, 80) }); }
}

// 진단: 티커 변경 후보 확인(인자: PX_CAND="BNY,ECHO") — 나스닥 종목정보(회사명 · 마지막 체결)
for (const c of String(process.env.PX_CAND || "BNY,ECHO,BK,SATS").split(",").filter(Boolean)) {
  try {
    const r = await fetch("https://api.nasdaq.com/api/quote/" + encodeURIComponent(c) + "/info?assetclass=stocks", { headers: NUA });
    const j = await r.json().catch(() => null); const d = j && j.data, pd = d && d.primaryData;
    const r2 = await fetch("https://api.nasdaq.com/api/autocomplete/slookup/10?search=" + encodeURIComponent(c), { headers: NUA });
    const j2 = await r2.json().catch(() => null);
    out("cand", { c, company: d && d.companyName, exch: d && d.exchange, last: pd && pd.lastSalePrice, at: pd && pd.lastTradeTimestamp, rCode: j && j.status && j.status.rCode,
      lookup: j2 && Array.isArray(j2.data) ? j2.data.filter((x) => /STOCKS/i.test(x.asset || "")).slice(0, 4).map((x) => x.symbol + ":" + String(x.name || "").slice(0, 50)) : null });
  } catch (e) { out("cand", { c, err: String(e.message || e).slice(0, 80) }); }
}
