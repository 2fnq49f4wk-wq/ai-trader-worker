/* [V33.565] 수집 건강 진단 읽기 — 원천별 실패율(오늘·어제) · 최근 N시간 WARN/ERROR 묶음. 사용법: WORKER_URL·TRAIN_KEY 환경변수, node tools/probe-ingest-health.mjs [hours] */
const out = (k, v) => console.log("ING " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const base = (process.env.WORKER_URL || "").replace(/\/$/, "");
if (!base || !process.env.TRAIN_KEY) { out("skip", "WORKER_URL·TRAIN_KEY 없음"); process.exit(0); }
const r = await fetch(base + "/api/ingest-health?hours=" + (process.argv[2] || "24"), { headers: { "x-train-key": process.env.TRAIN_KEY } });
const j = await r.json().catch(() => null);
if (!j || !j.ok) { out("err", { http: r.status, j }); process.exit(0); }
for (const [day, tab] of [["today", j.fetchToday], ["yesterday", j.fetchYesterday]]) {
  const rows = Object.entries(tab || {}).map(([k, v]) => ({ k, ok: v.ok, bad: v.bad, ex: v.ex, failPct: +(100 * (v.bad + v.ex) / Math.max(1, v.ok + v.bad + v.ex)).toFixed(1), st: v.st, err: v.err }))
    .sort((a, b) => (b.bad + b.ex) - (a.bad + a.ex));
  out(day + " sources", rows.length);
  for (const x of rows.filter((x) => x.bad + x.ex > 0).slice(0, 40)) out(day + " fail", x);
  out(day + " healthy", rows.filter((x) => x.bad + x.ex === 0).map((x) => x.k + ":" + x.ok).slice(0, 60).join(" "));
}
for (const g of (j.logGroups || [])) out("log", { n: g.n, last: g.last ? new Date(g.last).toISOString().slice(5, 16) : null, sig: g.sig, sample: g.sample });
// [V33.565] 옛 경로 실측 — 야후 v10/v7 crumb 유무 · 분봉(한·미)
try {
  const r2 = await fetch(base + "/api/src-probe", { headers: { "x-train-key": process.env.TRAIN_KEY } });
  const j2 = await r2.json();
  for (const x of (j2.res || [])) out("src", x);
} catch (e) { out("src err", String(e.message || e)); }
// [V33.569] 심사 사유(시장별 · 최근 N시간)
try {
  const r3 = await fetch(base + "/api/ingest-health?hours=" + (process.argv[2] || "24"), { headers: { "x-train-key": process.env.TRAIN_KEY } });
  const j3 = await r3.json();
  for (const mk of ["kr", "us"]) out("judge " + mk, { cycles: (j3.judgeCycles || {})[mk], reasons: Object.entries((j3.judgeReasons || {})[mk] || {}).sort((a, b) => b[1] - a[1]).slice(0, 12) });
} catch (e) { out("judge err", String(e.message || e)); }
// [V33.572] 최근 사이클 비용 줄(같은 문장은 한 행에 묶이고 내용은 최신으로 덮인다 — '최근 N분 전' 꼬리가 최신 시각)
try {
  const r4 = await fetch(base + "/api/logs?limit=600");
  const L = await r4.json();
  const rows = (Array.isArray(L) ? L : []).filter((x) => /\[EVAL-COST\]|Done: tried=/.test(String(x.message || ""))).slice(0, 12);
  for (const x of rows) out("cycle", { ts: new Date(Number(x.ts)).toISOString().slice(11, 16), msg: String(x.message).replace(/\s+/g, " ").slice(0, 420) });
} catch (e) { out("cycle err", String(e.message || e)); }
