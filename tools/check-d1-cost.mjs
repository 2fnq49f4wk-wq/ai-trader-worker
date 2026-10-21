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
// [V33.640] 퇴역 위원회 자동 GPU 재학습 정지 · 옛 OMNI 채점 대기 조회 정지 · 한국 지수 종가 · 쓰기 계량
chk(/async function _luxAutoRetrainModal\(env\) \{[\s\S]{0,600}if \(COMMITTEE_RETIRED \|\| MODAL_DISABLED\) return;/.test(S) && /const MODAL_DISABLED = true;/.test(S), "퇴역 위원회 자동 재학습(GPU · ml-export D1) 안 던짐 · Modal 사용 중단");
chk(/if \(o\.prio !== false && !COMMITTEE_RETIRED\)/.test(S), "옛 OMNI 섀도우 채점 대기 우선순위 조회 끔");
chk(/if \(krMarketHours \|\| \(krExtHours && new Date\(\)\.getUTCMinutes\(\) % 5 === 0\)\) \{\n\s+for \(const idx of KR_INDICES\)/.test(S), "한국 지수: 장 마감 뒤에도 5분마다 확정 종가");
chk(/function _d1MeterW\(sql, binds, meta\)/.test(S) && /m\.w = m\.w \|\| \{\}/.test(S), "쓴 행 접두어별 계량");
// [V33.642] 시세 행은 바뀌었을 때만 쓴다 — 진짜 SQLite 로 쓴 행 수를 센다
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE state (k TEXT PRIMARY KEY, v TEXT, updated_ts INTEGER)");
  const a = S.indexOf("const QUOTE_SAME_MS = "), b = S.indexOf("const D1_DAY_CAP = ");
  const C = new Function(S.slice(a, b) + "; return { QUOTE_SAME_MS, QUOTE_CHANGED_WHERE };")();
  const up = db.prepare("INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_ts=excluded.updated_ts" + C.QUOTE_CHANGED_WHERE);
  const q = (px, extra) => JSON.stringify(Object.assign({ price: px, dayPct: 1.5, prevClose: 100, mstate: "REGULAR", rsi: 50, ts: 0 }, extra || {}));
  const ch = (px, t, extra) => Number(up.run("quote:A", q(px, extra), t).changes);
  chk(ch(101, 1000) === 1, "첫 기록은 쓴다");
  chk(ch(101, 61000) === 0, "값 같고 90초 안 → 안 씀(쓴 행 0)");
  chk(ch(101.5, 62000) === 1, "가격이 바뀌면 바로 쓴다");
  chk(ch(101.5, 120000, { mstate: "POST", post: 102 }) === 1, "세션·시간외 값이 바뀌면 쓴다");
  chk(ch(101.5, 125000, { mstate: "POST", post: 102 }) === 0 && ch(101.5, 215001, { mstate: "POST", post: 102 }) === 1, "같아도 90초 지나면 다시 쓴다(ts 신선도)");
  // 샤드 json_set 업서트(원문 그대로)
  const s0 = S.indexOf('"INSERT INTO state (k, v, updated_ts) VALUES (?1, ?2, ?6) " +'), s1 = S.indexOf(').bind("quote:" + r.symbol', s0);
  const sql = new Function("QUOTE_SAME_MS", "return " + S.slice(s0, s1).replace(/\/\/[^\n]*\n/g, "\n") + ";")(C.QUOTE_SAME_MS);
  const sh = db.prepare(sql);
  const run = (px, t, pre, clrPre) => Number(sh.run("quote:B", JSON.stringify({ price: px, prevClose: 100, dayPct: 1, mstate: "PRE", pre: pre, extTs: pre ? 999 : null }), px, 100, 1, t, "PRE", pre, null, null, null, clrPre, 1, pre ? 999 : null, 0).changes);
  chk(run(50, 1000, 51, 0) === 1 && run(50, 30000, 51, 0) === 0, "샤드 갱신: 값 같으면 안 씀");
  chk(run(50, 40000, 51.2, 0) === 1, "샤드 갱신: 장전가가 바뀌면 씀");
  chk(run(50, 50000, null, 1) === 1, "샤드 갱신: 지울 장전가가 남아 있으면 씀");
}
if (fails) { console.log("\n✗ D1 비용 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ D1 비용 통과");
