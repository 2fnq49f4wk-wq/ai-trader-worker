/* [V33.577] 매매 깔때기 진단 읽기 — 일별 후보·매수 · 실적 관문 · 음수기대 신호 · 설정 차단 · 최근 심사 사유. WORKER_URL·TRAIN_KEY. */
const out = (k, v) => console.log("TD " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const base = (process.env.WORKER_URL || "").replace(/\/$/, "");
if (!base || !process.env.TRAIN_KEY) { out("skip", "no env"); process.exit(0); }
const r = await fetch(base + "/api/trade-diag", { headers: { "x-train-key": process.env.TRAIN_KEY } });
const j = await r.json().catch(() => null);
if (!j || !j.ok) { out("err", { http: r.status, j }); process.exit(0); }
const days = [...new Set(Object.keys(j.cand || {}).concat(Object.keys(j.buys || {})).map((k) => k.split(" ")[0]))].sort();
for (const d of days) for (const mk of ["us", "kr"]) {
  const c = (j.cand || {})[d + " " + mk], b = (j.buys || {})[d + " " + mk];
  if (!c && !b) continue;
  out("day " + d + " " + mk, { cand: c ? c.n : 0, candBy: c ? c.by : null, buy: b ? b.n : 0, buyBy: b ? b.by : null });
}
out("daily_stats", (j.daily || []).map((x) => x.day_key + ":" + x.signals + "/" + x.trades).join(" "));
out("perfGate", j.perfGate); out("negexp", j.negexp); out("cfg", j.cfg); out("mktStrat", j.mktStrat);
out("selfReviewBlock", j.selfReviewBlock); out("aiHalt", j.aiHalt); out("modelDrift", j.modelDrift); out("positions", j.positions);
out("omniq_us", j.omniq_us && { state: j.omniq_us.state, state20: j.omniq_us.state20, fresh: j.omniq_us.fresh });
out("omniq_kr", j.omniq_kr && { state: j.omniq_kr.state, state20: j.omniq_kr.state20, fresh: j.omniq_kr.fresh });
for (const l of (j.logs || [])) out("log", l);
