/* [V33.538] 운영 상태를 ★읽기만★ 해서 로컬 벤치(tools/cron-cpu-bench.mjs --prod)용 파일로 떠 둔다 (CI 전용 · 워커에 아무것도 안 쓴다)
 * 왜: 실CPU 의 주범은 매매 사이클 평가(종목당 ~10ms)인데, 모델·설정·보유가 없는 합성 벤치에선 그 경로(AI 위원회 추론)가 안 돈다.
 * 방식: Cloudflare D1 REST 질의(SELECT 만 · 키 범위 쪽 나누기 — 내보내기(export)는 DB 를 잠그므로 쓰지 않는다).
 *   state(전부) · positions · trades(최근 3000). R2 대형 모델은 벤치가 필요할 때 Cloudflare API 로 읽는다(읽기 전용).
 * 사용법: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node tools/prod-state-dump.mjs <out-dir> */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const OUT = process.argv[2] || "prod-state";
const { CLOUDFLARE_API_TOKEN: TOK, CLOUDFLARE_ACCOUNT_ID: ACC } = process.env;
if (!TOK || !ACC) { console.error("CLOUDFLARE_API_TOKEN/ACCOUNT_ID 필요"); process.exit(2); }
const W = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const DBID = (/database_id\s*=\s*"([^"]+)"/.exec(W) || [])[1];
const q = async (sql, params) => {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/d1/database/${DBID}/query`,
      { method: "POST", headers: { Authorization: "Bearer " + TOK, "content-type": "application/json" }, body: JSON.stringify({ sql, params: params || [] }) });
    const j = await r.json().catch(() => null);
    if (j && j.success && Array.isArray(j.result)) return j.result[0].results || [];
    await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
    if (a === 3) throw new Error("D1 질의 실패: " + JSON.stringify(j && j.errors).slice(0, 300));
  }
};
mkdirSync(OUT, { recursive: true });
let last = "", n = 0, bytes = 0;
const lines = [];
for (;;) {
  // 큰 행이 섞여도 응답이 너무 커지지 않게 작은 쪽으로
  const rows = await q("SELECT k, v, updated_ts FROM state WHERE k > ? ORDER BY k LIMIT 150", [last]);
  if (!rows.length) break;
  for (const r of rows) { lines.push(JSON.stringify(r)); n++; bytes += (r.v || "").length; }
  last = rows[rows.length - 1].k;
}
writeFileSync(OUT + "/state.jsonl", lines.join("\n"));
const pos = await q("SELECT * FROM positions");
writeFileSync(OUT + "/positions.json", JSON.stringify(pos));
const tr = await q("SELECT * FROM trades ORDER BY id DESC LIMIT 3000");
writeFileSync(OUT + "/trades.json", JSON.stringify(tr));
console.log("DUMP state " + n + "행 " + (bytes / 1e6).toFixed(1) + "MB · positions " + pos.length + " · trades " + tr.length);
