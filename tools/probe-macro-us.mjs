/* [V33.563] 미국 공식 지표 대체 원천 실측 — 워커(Cloudflare)에서 FRED CSV 가 막혀(V33.561 운영: 7/7 실패) 키 없는 공식 원천을 찾는다.
 *   ① 러너에서 각 원천의 응답 모양(마지막 관측·필드) ② 워커에서 닿는지(/api/macro-src · 학습키). 읽기 전용. */
const out = (k, v) => console.log("MUS " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" };
const yr = new Date().getUTCFullYear();
const tryj = async (k, u, init) => {
  try { const r = await fetch(u, Object.assign({ headers: UA, signal: AbortSignal.timeout(15000) }, init || {})); const t = await r.text(); return { k, http: r.status, t }; }
  catch (e) { out(k, { err: String(e.message || e).slice(0, 80) }); return null; }
};
let x = await tryj("nyfed", "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json");
if (x) out("nyfed", { http: x.http, body: x.t.slice(0, 500) });
x = await tryj("treasury_csv", "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/" + yr + "/all?type=daily_treasury_yield_curve&field_tdr_date_value=" + yr + "&page&_format=csv");
if (x) out("treasury_csv", { http: x.http, head: x.t.split("\n").slice(0, 3) });
x = await tryj("bls_post", "https://api.bls.gov/publicAPI/v1/timeseries/data/", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, UA),
  body: JSON.stringify({ seriesid: ["CUUR0000SA0", "CUUR0000SA0L1E", "WPUFD4", "LNS14000000"], startyear: String(yr - 1), endyear: String(yr) }) });
if (x) { try { const j = JSON.parse(x.t); out("bls_post", { http: x.http, status: j.status, msg: j.message, series: (j.Results && j.Results.series || []).map((s) => ({ id: s.seriesID, n: s.data.length, top: s.data.slice(0, 2), yearAgo: s.data.find((d) => d.year === String(Number(s.data[0].year) - 1) && d.period === s.data[0].period) })) }); } catch (e) { out("bls_post", { http: x.http, raw: x.t.slice(0, 300) }); } }
x = await tryj("bea_pce", "https://www.bea.gov/data/personal-consumption-expenditures-price-index-excluding-food-and-energy");
if (x) { const i = x.t.search(/percent|%/); out("bea_pce", { http: x.http, len: x.t.length, near: i >= 0 ? x.t.slice(Math.max(0, i - 300), i + 200).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") : "" }); }
x = await tryj("dbn_search", "https://api.db.nomics.world/v22/search?q=PCE%20excluding%20food%20and%20energy%20price%20index&limit=8");
if (x) { try { const j = JSON.parse(x.t); out("dbn_search", (j.results && j.results.docs || []).map((d) => [d.provider_code, d.code, d.name, d.nb_series])); } catch (e) { out("dbn_search", x.t.slice(0, 300)); } }
x = await tryj("dbn_bea_t20804", "https://api.db.nomics.world/v22/series/BEA/NIPA-T20804?limit=60&observations=0");
if (x) { try { const j = JSON.parse(x.t); out("dbn_bea_t20804", (j.series && j.series.docs || []).filter((d) => /food and energy/i.test(d.series_name)).map((d) => [d.series_code, d.series_name])); } catch (e) { out("dbn_bea_t20804", x.t.slice(0, 300)); } }
if (process.env.WORKER_URL && process.env.TRAIN_KEY) {
  try {
    const r = await fetch(process.env.WORKER_URL.replace(/\/$/, "") + "/api/macro-src", { headers: { "x-train-key": process.env.TRAIN_KEY } });
    const j = await r.json();
    for (const y of (j.res || [])) out("worker " + y.k, y);
  } catch (e) { out("worker err", String(e.message || e)); }
}
