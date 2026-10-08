/* [V33.538] 운영 상태를 ★읽기만★ 해서 로컬 벤치(tools/cron-cpu-bench.mjs --prod)용 파일로 떠 둔다 (CI 전용 · 워커에 아무것도 안 쓴다)
 * 왜: 실CPU 의 주범은 매매 사이클 평가(종목당 ~10ms)인데, 모델·설정·보유가 없는 합성 벤치에선 그 경로(AI 위원회 추론)가 안 돈다.
 * 방식: 워커의 학습키 전용 읽기 엔드포인트(/api/bench-state · 키 순서 쪽 나누기 · 자격증명처럼 보이는 키는 워커가 뺀다).
 *   (Cloudflare API 토큰엔 D1 권한이 없다 — 7403.) R2 대형 모델은 벤치가 필요할 때 /api/bench-r2 로 읽는다.
 * 사용법: WORKER_URL=… TRAIN_KEY=… node tools/prod-state-dump.mjs <out-dir> */
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = process.argv[2] || "prod-state";
const BASE = (process.env.WORKER_URL || "").replace(/\/$/, ""), KEY = process.env.TRAIN_KEY || "";
if (!BASE || !KEY) { console.error("WORKER_URL/TRAIN_KEY 필요"); process.exit(2); }
const get = async (q) => {
  for (let a = 0; a < 4; a++) {
    try { const r = await fetch(BASE + "/api/bench-state?" + q, { headers: { "x-train-key": KEY } }); if (r.ok) return await r.json(); } catch (e) {}
    await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
  }
  throw new Error("bench-state 실패: " + q);
};
mkdirSync(OUT, { recursive: true });
let after = "", n = 0, bytes = 0;
const lines = [];
for (;;) {
  const j = await get("t=state&limit=120&after=" + encodeURIComponent(after));
  for (const r of j.rows || []) { lines.push(JSON.stringify(r)); n++; bytes += (r.v || "").length; }
  if (!j.last) break;
  after = j.last;
}
writeFileSync(OUT + "/state.jsonl", lines.join("\n"));
const pos = (await get("t=positions")).rows || [];
writeFileSync(OUT + "/positions.json", JSON.stringify(pos));
const tr = (await get("t=trades")).rows || [];
writeFileSync(OUT + "/trades.json", JSON.stringify(tr));
console.log("DUMP state " + n + "행 " + (bytes / 1e6).toFixed(1) + "MB · positions " + pos.length + " · trades " + tr.length);
