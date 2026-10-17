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
  const code = S.slice(ovl, ovl2) + S.slice(att, att2) + S.slice(a, b2).replace("function __d1Stmt", "var __mk;function __d1Stmt") + S.slice(f, g2) + "; return { wrapD1, d1MeterFlush, d1SaverRefresh, get rows(){ return __d1Rows; }, D1_DAY_CAP };";
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
// [V33.639] 거래 원장 읽기는 거래가 생겼을 때만 새로 · 로그 정리 15분 · 현금 체크포인트 매번 전진
{
  const a = S.indexOf("const D1_DAY_CAP = "), b = S.indexOf("function wrapD1(realDB)"), b2 = S.indexOf("\n}\n", b) + 3;
  const att = S.indexOf("async function __d1Attempt("), att2 = S.indexOf("\n}\n", att) + 3;
  const ovl = S.indexOf("function __d1IsOverload("), ovl2 = S.indexOf("\n}\n", ovl) + 3;
  const W = new Function(S.slice(ovl, ovl2) + S.slice(att, att2) + S.slice(a, b2) + "; return { wrapD1 };")();
  let maxRowid = 10, tradeReads = 0;
  const real = { prepare(sql) { const st = { b: [], bind(...x) { st.b = x; return st; },
      async all() { if (/MAX\(rowid\) FROM trades/.test(sql)) return { results: [{ m: maxRowid, g: null }], meta: { rows_read: 2 } };
        if (/FROM trades/.test(sql)) { tradeReads++; return { results: [{ pnl_pct: 1, n: maxRowid }], meta: { rows_read: 1400 } }; }
        return { results: [], meta: { rows_read: 1 } }; },
      async first() { return (await st.all()).results[0] || null; },
      async run() { if (/INSERT INTO trades/.test(sql)) maxRowid++; return { meta: { rows_read: 0 } }; } }; return st; },
    async batch(x) { return x.map(() => ({ meta: {} })); } };
  const DB = W.wrapD1(real);
  const q = () => DB.prepare("SELECT market, pnl_pct, reason FROM trades WHERE side = ? ORDER BY ts DESC LIMIT ?").bind("SELL", 400).all();
  const r1 = await q(); const r2 = await q(); r2.results[0].pnl_pct = 99; const r3 = await q();
  chk(tradeReads === 1 && r3.results[0].pnl_pct === 1, "거래 없으면 원장 다시 안 읽음 · 호출부가 고쳐도 기억 불변");
  await DB.prepare("INSERT INTO trades (ts) VALUES (?)").bind(1).run();
  const r4 = await q();
  chk(tradeReads === 2 && r4.results[0].n === 11, "거래가 생기면 즉시 새로 읽음");
  maxRowid++; await new Promise((r) => setTimeout(r, 1100)); const r5 = await q();
  chk(tradeReads === 3 && r5.results[0].n === 12, "다른 아이솔레이트의 새 거래(MAX rowid 변화)도 감지");
  chk(/getUTCMinutes\(\) % 15 === 0\) \{\n\s+try \{ await DB\.prepare\("DELETE FROM logs WHERE id < \(SELECT id FROM logs ORDER BY id DESC LIMIT 1 OFFSET 1499\)/.test(S), "로그 정리 15분 · 경계 id 아래만");
  chk(/if \(list\.length > 0 && maxRowid > sinceRowid\) \{/.test(S), "현금 체크포인트는 새 거래마다 전진");
}
if (fails) { console.log("\n✗ D1 비용 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ D1 비용 통과");
