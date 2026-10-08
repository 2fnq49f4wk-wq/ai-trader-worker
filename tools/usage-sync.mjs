/* [V33.525] ★Cloudflare 실측 CPU → 워커 한도 판정★ — 사용량 '추정'(크론 벽시계 × 0.01)이 실제의 ~9배라 85% 자동 셧다운이 헛돈다.
 * GraphQL workersInvocationsAdaptive 로 이번 달(UTC) 이 워커의 sum(cpuTimeUs·requests) 를 읽어 POST /api/usage/actual 로 넣는다.
 * 실패해도 워커는 종전 추정을 그대로 쓴다(안전 쪽) — 이 스크립트는 종료코드 0 으로 끝나고 이유만 남긴다.
 * env: CLOUDFLARE_API_TOKEN · CLOUDFLARE_ACCOUNT_ID · WORKER_URL · TRAIN_KEY · (선택) SCRIPT_NAME
 * 사용법: node tools/usage-sync.mjs [--dry] */
import { readFileSync } from "node:fs";
export function buildQuery(acc, script, s, e) {
  return `{ viewer { accounts(filter: {accountTag: "${acc}"}) { workersInvocationsAdaptive(limit: 2000, filter: {scriptName: "${script}", datetime_geq: "${s}", datetime_lt: "${e}"}) { sum { requests cpuTimeUs } dimensions { date } } } } }`;
}
export function sumRows(j) {
  const rows = (((((j || {}).data || {}).viewer || {}).accounts || [])[0] || {}).workersInvocationsAdaptive || [];
  let cpuUs = 0, req = 0;
  for (const r of rows) { cpuUs += Number((r.sum || {}).cpuTimeUs) || 0; req += Number((r.sum || {}).requests) || 0; }
  return { rows: rows.length, cpuMs: Math.round(cpuUs / 1000), requests: req };
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const dry = process.argv.includes("--dry");
  const { CLOUDFLARE_API_TOKEN: TOK, CLOUDFLARE_ACCOUNT_ID: ACC, WORKER_URL, TRAIN_KEY } = process.env;
  const SCRIPT = process.env.SCRIPT_NAME || (/^name\s*=\s*"([^"]+)"/m.exec(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")) || [])[1];
  const out = (k, v) => console.log("USAGE " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
  if (!TOK || !ACC || !SCRIPT) { out("skip", "Cloudflare 시크릿/스크립트 이름 없음"); process.exit(0); }
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const mk = now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
  let j = null;
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST",
      headers: { authorization: "Bearer " + TOK, "content-type": "application/json" },
      body: JSON.stringify({ query: buildQuery(ACC, SCRIPT, start.toISOString(), now.toISOString()) }) });
    j = await r.json();
    if (!r.ok || (j.errors && j.errors.length)) { out("graphql_error", { status: r.status, errors: (j.errors || []).map((e) => e.message).slice(0, 3) }); process.exit(0); }
  } catch (e) { out("graphql_fail", String(e)); process.exit(0); }
  const s = sumRows(j);
  /* [V33.527] --hours: 최근 48시간 시간대별 CPU(어느 장 시간에 CPU 가 몰리는지 — 줄일 곳을 추측 없이 고른다) */
  if (process.argv.includes("--hours")) {
    try {
      const h0 = new Date(Date.now() - 48 * 3600000).toISOString();
      const q = `{ viewer { accounts(filter: {accountTag: "${ACC}"}) { workersInvocationsAdaptive(limit: 2000, filter: {scriptName: "${SCRIPT}", datetime_geq: "${h0}", datetime_lt: "${now.toISOString()}"}) { sum { requests cpuTimeUs } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { datetimeHour status } } } } }`;
      const r2 = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST",
        headers: { authorization: "Bearer " + TOK, "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
      const j2 = await r2.json();
      if (j2.errors && j2.errors.length) out("hours_error", j2.errors.map((e) => e.message).slice(0, 3));
      const rows = ((((j2.data || {}).viewer || {}).accounts || [])[0] || {}).workersInvocationsAdaptive || [];
      const byH = {};
      for (const r of rows) { const h = r.dimensions.datetimeHour; const b = byH[h] || (byH[h] = { cpuMs: 0, req: 0, p50: 0, p99: 0, st: {} });
        b.cpuMs += (r.sum.cpuTimeUs || 0) / 1000; b.req += r.sum.requests || 0; b.p50 = Math.max(b.p50, (r.quantiles || {}).cpuTimeP50 || 0); b.p99 = Math.max(b.p99, (r.quantiles || {}).cpuTimeP99 || 0);
        b.st[r.dimensions.status] = (b.st[r.dimensions.status] || 0) + (r.sum.requests || 0); }
      for (const h of Object.keys(byH).sort()) { const b = byH[h];
        out("hour", h.slice(5, 13) + "Z cpu=" + Math.round(b.cpuMs / 1000) + "s req=" + b.req + " cpu/req=" + Math.round(b.cpuMs / Math.max(1, b.req)) + "ms p50=" + Math.round(b.p50 / 1000) + "ms p99=" + Math.round(b.p99 / 1000) + "ms st=" + JSON.stringify(b.st)); }
    } catch (e) { out("hours_fail", String(e)); }
  }
  out("actual", Object.assign({ mk, script: SCRIPT, from: start.toISOString() }, s, { cpuPctOf30M: +(s.cpuMs / 30000000 * 100).toFixed(2) }));
  if (!s.rows) { out("skip", "행이 없다 — 넣지 않는다(0 을 실측으로 오인하지 않게)"); process.exit(0); }
  if (dry || !WORKER_URL || !TRAIN_KEY) { out("skip", dry ? "--dry" : "WORKER_URL/TRAIN_KEY 없음"); process.exit(0); }
  try {
    const p = await fetch(WORKER_URL.replace(/\/$/, "") + "/api/usage/actual", { method: "POST",
      headers: { "content-type": "application/json", "x-train-key": TRAIN_KEY },
      body: JSON.stringify({ mk, cpuMs: s.cpuMs, requests: s.requests, rows: s.rows, src: "cf-graphql" }) });
    out("posted", { status: p.status, body: (await p.text()).slice(0, 400) });
  } catch (e) { out("post_fail", String(e)); }
}
