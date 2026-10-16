// [V33.637] D1 '읽은 행' 과금 회귀 방지 — ml_samples(100만+ 행) 전체 집계는 _mlAgg(6시간 기억)로만.
// 실측: 이 집계가 하루 ~2,900회 × 121만 행 = 40~50억 행/일 = Cloudflare 청구 거의 전부(9/7 주기 $69).
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0; const chk = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const raw = S.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /prepare\("SELECT (COUNT\(\*\)|SUM\(CASE)[^"]*FROM ml_samples(_st)? WHERE (strategy='hv' AND )?featver ?= ?\?"\)/.test(l) && !/수확 직후 증가분/.test(l));
chk(raw.length === 0, "ml_samples featver 전체 집계 직접 질의 없음" + (raw.length ? " — " + raw.map((x) => x[0]).join(",") : ""));
chk(/GROUP BY featver, strategy", \[\], \{ all: true \}\)/.test(S), "featver×strategy 집계도 기억 경유");
chk(/const ML_AGG_TTL_MS = 6 \* 3600000;/.test(S) && /async function _mlAgg\(DB, sql, binds, opts\)/.test(S), "기억 6시간 · 도우미 존재");
if (fails) { console.log("\n✗ D1 비용 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ D1 비용 통과");
