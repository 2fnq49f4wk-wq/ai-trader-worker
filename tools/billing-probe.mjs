/* [V33.637] ★Cloudflare 청구 원인 실측★ — 사용자(10/16): "10/7~16 13.22달러 · 주기 예상 40.98달러 · 10/7 95.22달러 청구 — 해결".
 * 추측하지 않고 GraphQL 로 상품별 사용량을 일별로 읽어 Workers Paid 포함량을 넘는 부분의 요금을 계산한다(읽기 전용 · 워커에 안 씀).
 * 포함량/단가(Workers Paid 공개 요금표): Workers 요청 10M/월 · $0.30/M · CPU 30M ms/월 · $0.02/M ms
 *   D1 읽은 행 25B/월 · $0.001/M · 쓴 행 50M/월 · $1.00/M · R2 A급 1M/월 · $4.50/M · B급 10M/월 · $0.36/M · Workers AI 10k 뉴런/일 · $0.011/1k
 * env: CLOUDFLARE_API_TOKEN · CLOUDFLARE_ACCOUNT_ID · 사용법: node tools/billing-probe.mjs [시작 YYYY-MM-DD] */
const { CLOUDFLARE_API_TOKEN: TOK, CLOUDFLARE_ACCOUNT_ID: ACC } = process.env;
const out = (k, v) => console.log("BILL " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
if (!TOK || !ACC) { out("skip", "시크릿 없음"); process.exit(0); }
const start = process.argv[2] || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);   // GraphQL 조회 폭 상한 ~31일
const end = new Date().toISOString().slice(0, 10);
async function gql(name, q) {
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST",
      headers: { authorization: "Bearer " + TOK, "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
    const j = await r.json();
    if (j.errors && j.errors.length) { out(name + "_error", j.errors.map((e) => e.message).slice(0, 3)); return null; }
    return ((((j.data || {}).viewer || {}).accounts || [])[0]) || null;
  } catch (e) { out(name + "_fail", String(e)); return null; }
}
const A = (body) => `{ viewer { accounts(filter: {accountTag: "${ACC}"}) { ${body} } } }`;
const byDay = {};
const add = (d, k, v) => { byDay[d] = byDay[d] || {}; byDay[d][k] = (byDay[d][k] || 0) + (Number(v) || 0); };

let a = await gql("workers", A(`workersInvocationsAdaptive(limit: 10000, filter: {date_geq: "${start}", date_leq: "${end}"}) { sum { requests cpuTimeUs subrequests } dimensions { date scriptName } }`));
const scripts = {};
for (const r of (a && a.workersInvocationsAdaptive) || []) {
  add(r.dimensions.date, "req", r.sum.requests); add(r.dimensions.date, "cpuMs", r.sum.cpuTimeUs / 1000);
  scripts[r.dimensions.scriptName] = (scripts[r.dimensions.scriptName] || 0) + r.sum.cpuTimeUs / 1000;
}
out("scripts_cpu_ms", scripts);
a = await gql("d1", A(`d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: "${start}", date_leq: "${end}"}) { sum { readQueries writeQueries rowsRead rowsWritten } dimensions { date databaseId } }`));
for (const r of (a && a.d1AnalyticsAdaptiveGroups) || []) { add(r.dimensions.date, "d1Read", r.sum.rowsRead); add(r.dimensions.date, "d1Write", r.sum.rowsWritten); add(r.dimensions.date, "d1Q", r.sum.readQueries + r.sum.writeQueries); }
// D1 '읽은 행' 상위 쿼리(최근 3일) — 어떤 쿼리가 테이블을 훑는지
// 시간대별 D1 읽은 행(최근 36시간) — 수정 전후 비교용
const hourRows = [];
{
  const h0 = new Date(Date.now() - 36 * 3600000).toISOString();
  const ah = await gql("d1hour", A(`d1AnalyticsAdaptiveGroups(limit: 100, filter: {datetimeHour_geq: "${h0}"}, orderBy: [datetimeHour_ASC]) { sum { rowsRead rowsWritten } dimensions { datetimeHour } }`));
  for (const r of (ah && ah.d1AnalyticsAdaptiveGroups) || []) { const x = { h: r.dimensions.datetimeHour, rowsReadM: Math.round(r.sum.rowsRead / 1e5) / 10, rowsWrittenK: Math.round(r.sum.rowsWritten / 100) / 10 }; hourRows.push(x); out("hour", x); }
}
const q0 = new Date(Date.now() - (Number(process.env.TOPQ_DAYS) || 3) * 86400000).toISOString().slice(0, 10);
a = await gql("d1q", A(`d1QueriesAdaptiveGroups(limit: 40, filter: {date_geq: "${q0}", date_leq: "${end}"}, orderBy: [sum_rowsRead_DESC]) { sum { rowsRead rowsWritten queryDurationMs } count dimensions { query } }`));
for (const r of (a && a.d1QueriesAdaptiveGroups) || []) out("topq", { rowsRead: r.sum.rowsRead, rowsWritten: r.sum.rowsWritten, n: r.count, perCall: Math.round(r.sum.rowsRead / Math.max(1, r.count)), q: String(r.dimensions.query).slice(0, 220) });
a = await gql("d1size", A(`d1StorageAdaptiveGroups(limit: 100, filter: {date_geq: "${end}"}) { max { databaseSizeBytes } dimensions { date databaseId } }`));
out("d1_size_bytes", ((a && a.d1StorageAdaptiveGroups) || []).map((r) => r.max.databaseSizeBytes));
a = await gql("r2", A(`r2OperationsAdaptiveGroups(limit: 10000, filter: {date_geq: "${start}", date_leq: "${end}"}) { sum { requests } dimensions { date actionType } }`));
const CLASS_A = /^(ListBuckets|PutBucket|ListObjects|PutObject|CopyObject|CompleteMultipartUpload|CreateMultipartUpload|UploadPart|UploadPartCopy|ListMultipartUploads|ListParts|PutBucketEncryption|PutBucketCors|PutBucketLifecycleConfiguration)$/;
for (const r of (a && a.r2OperationsAdaptiveGroups) || []) add(r.dimensions.date, CLASS_A.test(r.dimensions.actionType) ? "r2A" : (/^Delete/.test(r.dimensions.actionType) ? "r2Free" : "r2B"), r.sum.requests);
a = await gql("r2size", A(`r2StorageAdaptiveGroups(limit: 100, filter: {date_geq: "${end}"}) { max { payloadSize objectCount } dimensions { date bucketName } }`));
out("r2_size", ((a && a.r2StorageAdaptiveGroups) || []).map((r) => [r.dimensions.bucketName, r.max.payloadSize, r.max.objectCount]));
a = await gql("ai", A(`aiInferenceAdaptiveGroups(limit: 10000, filter: {date_geq: "${start}", date_leq: "${end}"}) { sum { totalNeurons } dimensions { date modelId } }`));
const aiModels = {};
for (const r of (a && a.aiInferenceAdaptiveGroups) || []) { add(r.dimensions.date, "neurons", r.sum.totalNeurons); aiModels[r.dimensions.modelId] = (aiModels[r.dimensions.modelId] || 0) + r.sum.totalNeurons; }
out("ai_neurons_by_model", aiModels);

const days = Object.keys(byDay).sort();
for (const d of days) out("day", Object.assign({ d }, Object.fromEntries(Object.entries(byDay[d]).map(([k, v]) => [k, Math.round(v)]))));
// 청구 주기(매월 7일 시작)별 초과 요금
const cyc = {};
for (const d of days) {
  const [y, m, dd] = d.split("-").map(Number);
  const c = dd >= 7 ? `${y}-${String(m).padStart(2, "0")}` : (m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`);
  cyc[c] = cyc[c] || { days: 0, aiOver: 0 }; cyc[c].days++;
  for (const [k, v] of Object.entries(byDay[d])) cyc[c][k] = (cyc[c][k] || 0) + v;
  cyc[c].aiOver += Math.max(0, (byDay[d].neurons || 0) - 10000);
}
for (const [c, u] of Object.entries(cyc)) {
  const cost = {
    req: Math.max(0, (u.req || 0) - 10e6) / 1e6 * 0.30,
    cpu: Math.max(0, (u.cpuMs || 0) - 30e6) / 1e6 * 0.02,
    d1Read: Math.max(0, (u.d1Read || 0) - 25e9) / 1e6 * 0.001,
    d1Write: Math.max(0, (u.d1Write || 0) - 50e6) / 1e6 * 1.0,
    r2A: Math.max(0, (u.r2A || 0) - 1e6) / 1e6 * 4.5,
    r2B: Math.max(0, (u.r2B || 0) - 10e6) / 1e6 * 0.36,
    ai: u.aiOver / 1000 * 0.011,
  };
  for (const k in cost) cost[k] = Math.round(cost[k] * 100) / 100;
  out("cycle", { start: c + "-07", days: u.days, use: Object.fromEntries(Object.entries(u).map(([k, v]) => [k, Math.round(v)])), overUSD: cost, totalOverUSD: Math.round(Object.values(cost).reduce((s, x) => s + x, 0) * 100) / 100 });
}

// [V33.644] 설정창 경고용 요약을 워커에 넣는다(WORKER_URL·TRAIN_KEY 있을 때만 · D1 쓰기 1행)
{
  const { WORKER_URL, TRAIN_KEY } = process.env;
  const keys = Object.keys(cyc).sort(), ck = keys[keys.length - 1];
  if (WORKER_URL && TRAIN_KEY && ck) {
    const u = cyc[ck], now = new Date();
    const [cy, cm] = ck.split("-").map(Number);
    const cStart = new Date(Date.UTC(cy, cm - 1, 7)), cEnd = new Date(Date.UTC(cm === 12 ? cy + 1 : cy, cm === 12 ? 0 : cm, 7));
    const daysIn = Math.round((cEnd - cStart) / 86400000), el = Math.max(0.5, (now - cStart) / 86400000);
    const included = { d1Read: 25e9, d1Write: 50e6, cpuMs: 30e6, req: 10e6, r2A: 1e6, r2B: 10e6 };
    const cycle = {}, proj = {};
    for (const k of Object.keys(included)) { cycle[k] = Math.round(u[k] || 0); }
    // 예상 = 지금까지 + 최근 3일 평균 × 남은 날(주기 초반 폭주가 예상치를 부풀리지 않게)
    const recent = days.slice(-4, -1).map((d) => byDay[d] || {});
    for (const k of Object.keys(included)) {
      const avg = recent.length ? recent.reduce((s, r) => s + (r[k] || 0), 0) / recent.length : (cycle[k] / el);
      proj[k] = Math.round(cycle[k] + avg * Math.max(0, daysIn - el));
    }
    const H = hourRows.slice(-24);
    const last24 = { d1Read: Math.round(H.reduce((s, r) => s + r.rowsReadM * 1e6, 0)), d1Write: Math.round(H.reduce((s, r) => s + r.rowsWrittenK * 1e3, 0)) };
    const yd = byDay[days[days.length - 2]] || {}; last24.cpuMs = Math.round(yd.cpuMs || 0); last24.req = Math.round(yd.req || 0);
    const over = (o) => Math.max(0, (o.d1Read - 25e9) / 1e6 * 0.001) + Math.max(0, (o.d1Write - 50e6) / 1e6) + Math.max(0, (o.cpuMs - 30e6) / 1e6 * 0.02) + Math.max(0, (o.req - 10e6) / 1e6 * 0.3);
    const body = { cycleStart: cStart.toISOString().slice(0, 10), days: +el.toFixed(1), daysInCycle: daysIn, cycle, proj, last24, included,
      overUSD: +over(cycle).toFixed(2), projOverUSD: +over(proj).toFixed(2) };
    try {
      const r = await fetch(WORKER_URL.replace(/\/$/, "") + "/api/billing/actual", { method: "POST", headers: { "content-type": "application/json", "x-train-key": TRAIN_KEY }, body: JSON.stringify(body) });
      out("posted", { status: r.status, body });
    } catch (e) { out("post_fail", String(e)); }
  } else out("post_skip", "WORKER_URL/TRAIN_KEY 없음");
}
