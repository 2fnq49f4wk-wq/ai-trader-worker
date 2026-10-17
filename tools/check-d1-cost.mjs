// [V33.637] D1 '읽은 행' 과금 회귀 방지 — ml_samples(100만+ 행) 전체 집계는 _mlAgg(6시간 기억)로만.
// 실측: 이 집계가 하루 ~2,900회 × 121만 행 = 40~50억 행/일 = Cloudflare 청구 거의 전부(9/7 주기 $69).
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0; const chk = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const raw = S.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /prepare\("SELECT (COUNT\(\*\)|SUM\(CASE)[^"]*FROM ml_samples(_st)? WHERE (strategy='hv' AND )?featver ?= ?\?"\)/.test(l) && !/수확 직후 증가분/.test(l));
chk(raw.length === 0, "ml_samples featver 전체 집계 직접 질의 없음" + (raw.length ? " — " + raw.map((x) => x[0]).join(",") : ""));
chk(/GROUP BY featver, strategy", \[\], \{ all: true \}\)/.test(S), "featver×strategy 집계도 기억 경유");
chk(/const ML_AGG_TTL_MS = 6 \* 3600000;/.test(S) && /async function _mlAgg\(DB, sql, binds, opts\)/.test(S), "기억 6시간 · 도우미 존재");
// [V33.638] 런타임 계량기·차단기 — 실제 모의 D1 로 돈다
{
  const a = S.indexOf("const D1_DAY_CAP = "), b = S.indexOf("function wrapD1(realDB)");
  const b2 = S.indexOf("\n}\n", b) + 3;
  const f = S.indexOf("async function d1MeterFlush("), g = S.indexOf("async function d1SaverRefresh(");
  const g2 = S.indexOf("\n}\n", g) + 3;
  const att = S.indexOf("async function __d1Attempt("), att2 = S.indexOf("\n}\n", att) + 3;
  const ovl = S.indexOf("function __d1IsOverload("), ovl2 = S.indexOf("\n}\n", ovl) + 3;
  const code = S.slice(ovl, ovl2) + S.slice(att, att2) + S.slice(a, b2) + S.slice(f, g2) + "; return { wrapD1, d1MeterFlush, d1SaverRefresh, get rows(){ return __d1Rows; }, D1_DAY_CAP };";
  const W = new Function(code)();
  const store = {}; let logs = 0;
  const mk = (rowsRead) => ({ prepare(sql) { const st = { sql, b: [], bind(...x) { st.b = x; return st; },
      async all() { if (/^SELECT v FROM state WHERE k = 'd1_meter'/.test(sql)) return { results: store.m ? [{ v: store.m }] : [], meta: { rows_read: 1 } };
        return { results: [{ c: 7 }], meta: { rows_read: /ml_samples/.test(sql) ? rowsRead : 3 } }; },
      async first() { const r = await st.all(); return r.results[0] || null; },
      async run() { if (/INSERT INTO state/.test(sql)) store.m = st.b[0]; if (/INSERT INTO logs/.test(sql)) logs++; return { meta: { rows_read: 0 } }; } }; return st; },
    async batch(x) { return x.map(() => ({ meta: { rows_read: 1 } })); } });
  const real = mk(400000000), DB = W.wrapD1(real);
  const r1 = await DB.prepare("SELECT COUNT(*) c FROM ml_samples").first("c");
  chk(r1 === 7 && W.rows === 400000000, "first(col) 값 그대로 · 읽은 행을 센다");
  await W.d1MeterFlush(DB);
  chk(JSON.parse(store.m).rows === 400000000 && !JSON.parse(store.m).saver, "상한 미만 — 차단 안 함");
  await DB.prepare("SELECT COUNT(*) c FROM ml_samples").first(); await W.d1MeterFlush(DB);
  const m = JSON.parse(store.m);
  chk(m.saver && m.rows === 800000000 && logs === 1, "하루 6억 초과 → 차단기 켜짐 · ERROR 로그 1회");
  let blocked = false; try { await DB.prepare("SELECT COUNT(*) c FROM ml_samples").first(); } catch (e) { blocked = /D1_SAVER/.test(e.message); }
  chk(blocked, "무거운 쿼리(1회 20만 행+) 거부");
  const light = await DB.prepare("SELECT v FROM state WHERE k = ?").bind("x").first();
  chk(light && light.c === 7, "가벼운 쿼리(시세·상태)는 그대로");
}
if (fails) { console.log("\n✗ D1 비용 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ D1 비용 통과");
