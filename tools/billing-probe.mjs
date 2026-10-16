/* [V33.637] ★Cloudflare 청구 원인 실측★ — 사용자(10/16): "10/7~16 13.22달러 · 주기 예상 40.98달러 · 10/7 95.22달러 청구 — 해결".
 * 추측하지 않고 GraphQL 로 상품별 사용량을 일별로 읽어 Workers Paid 포함량을 넘는 부분의 요금을 계산한다(읽기 전용 · 워커에 안 씀).
 * 포함량/단가(Workers Paid 공개 요금표): Workers 요청 10M/월 · $0.30/M · CPU 30M ms/월 · $0.02/M ms
 *   D1 읽은 행 25B/월 · $0.001/M · 쓴 행 50M/월 · $1.00/M · R2 A급 1M/월 · $4.50/M · B급 10M/월 · $0.36/M · Workers AI 10k 뉴런/일 · $0.011/1k
 * env: CLOUDFLARE_API_TOKEN · CLOUDFLARE_ACCOUNT_ID · 사용법: node tools/billing-probe.mjs [시작 YYYY-MM-DD] */
const { CLOUDFLARE_API_TOKEN: TOK, CLOUDFLARE_ACCOUNT_ID: ACC } = process.env;
const out = (k, v) => console.log("BILL " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
if (!TOK || !ACC) { out("skip", "시크릿 없음"); process.exit(0); }
const start = process.argv[2] || "2026-09-07";
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
