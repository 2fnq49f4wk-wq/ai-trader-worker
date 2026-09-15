/* [V33.359] ★110만 행 표에서 전수 정렬을 하면 D1 이 CPU 한도로 죽는다★
 *
 *   실측 자가진단(2026-09-15 01:49) — 같은 에러가 네 곳에서 동시에 났다:
 *     [STAGE:pooluniq] D1_ERROR: D1 DB exceeded its CPU time limit and was reset.
 *     [BDKR] / [CM] / [SCHED] alt bdus fail — 같은 문구
 *   ml_samples 는 이제 ★1,123,768행 / 896MB★ 다. 이 규모에서 '임시 B-트리 정렬' 이나
 *   '전체 스캔' 을 하면 한 쿼리가 D1 의 CPU 예산을 통째로 먹고, 그 순간 다른 요청까지
 *   큐에 적체돼 무관한 곳(BDKR·CM)이 함께 쓰러진다.
 *
 *   ★문자열을 보지 않는다.★ 소스에서 SQL 과 인덱스 정의를 꺼내 ★진짜 SQLite 에★
 *   EXPLAIN QUERY PLAN 을 돌린다.
 *
 *   ★그리고 반드시 데이터를 넣고 ANALYZE 한 뒤에 잰다.★ 빈 표에서 재면 플래너가
 *   통계 없이 고르기 때문에 ★멀쩡한 쿼리를 무겁다고 오판한다★ — 이 게이트의 첫 판본이
 *   정확히 그랬다(export 커서 5건을 범인으로 지목했는데, 데이터를 넣고 재니
 *   `SEARCH … USING INTEGER PRIMARY KEY (rowid>?)` 로 멀쩡했다).
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

// ── ① 소스에 선언된 인덱스를 그대로 만들고, 실제 분포로 채운 뒤 ANALYZE ────────
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE ml_samples (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, ins_ts INTEGER,
  market TEXT, symbol TEXT, featver INTEGER, strategy TEXT, feat TEXT, label INTEGER, pnl_pct REAL, horizon INTEGER);`);
const made = [];
const idxRe = /CREATE INDEX IF NOT EXISTS (idx_samples_\w+) ON (ml_samples\([^)]*\))/g;
let mm;
while ((mm = idxRe.exec(src))) { db.exec(`CREATE INDEX ${mm[1]} ON ${mm[2]}`); made.push(mm[1]); }
ok(made.length >= 3, `소스에서 ml_samples 인덱스 ${made.length}개를 그대로 만들었다: ${made.join(", ")}`);

const FV = 17, NROW = 60000, NSYM = 1018, T0 = Date.UTC(2026, 1, 1);
{
  const ins = db.prepare(`INSERT INTO ml_samples (ts,ins_ts,market,symbol,featver,strategy,feat,label,pnl_pct)
                          VALUES (?,?,?,?,?,?,?,?,?)`);
  db.exec("BEGIN");
  for (let i = 0; i < NROW; i++)
    ins.run(T0 + Math.floor(i / NSYM) * 86400000, T0 + i * 1000, i % 2 ? "us" : "kr",
            "S" + (i % NSYM), FV, i % 20 === 0 ? "trend" : "hv", "[]", i % 2, 0.1);
  db.exec("COMMIT");
  db.exec("ANALYZE");
  ok(db.prepare("SELECT COUNT(*) c FROM ml_samples").get().c === NROW,
     `실제 분포로 ${NROW.toLocaleString()}행을 넣고 ANALYZE 했다(통계 없이 재면 오판한다)`);
}

const plan = (q) => db.prepare("EXPLAIN QUERY PLAN " + q).all().map((r) => r.detail).join(" | ");
const heavy = (p) => /TEMP B-TREE/.test(p) || /\bSCAN ml_samples\b/.test(p);

/* ★바인드를 컬럼에 맞게 채운다.★ 전부 같은 숫자로 채우면 `ts >= ? AND ts < ?` 가
   ★빈 범위★ 가 되어 플래너가 딴 인덱스를 고르고, 멀쩡한 쿼리가 무겁게 보인다 —
   첫 판본이 stackbf 커서를 그렇게 오판했다(실제 날짜 범위를 넣으면 PK 를 탄다).
   같은 컬럼이 두 번 나오면 첫 번째는 낮은 값, 두 번째는 높은 값을 준다(진짜 범위가 되게). */
const T1 = T0 + 30 * 86400000;
function fill(q) {
  const seen = {};
  let out = q.replace(/(\b\w+\b)\s*(>=|<=|<>|!=|>|<|=)\s*\?/g, function (_m, col, op) {
    const c = col.toLowerCase();
    seen[c] = (seen[c] || 0) + 1;
    const second = seen[c] > 1;
    let v;
    if (c === "featver") v = String(FV);
    else if (c === "ts" || c === "ins_ts") v = String(second ? T1 : T0);
    else if (c === "id") v = second ? "999999999" : "0";
    else v = "1";
    return col + " " + op + " " + v;
  });
  out = out.replace(/LIMIT\s*\?/gi, "LIMIT 500").replace(/OFFSET\s*\?/gi, "OFFSET 0");
  return out.replace(/\?/g, "1");
}

// ── ② 소스의 SQL 리터럴을 전부 꺼내 계획을 잰다 ───────────────────────────────
const lits = [];
{
  const re = /"((?:[^"\\]|\\.)*?ml_samples(?:[^"\\]|\\.)*?)"/g;
  let m2;
  while ((m2 = re.exec(src))) {
    const q = m2[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
    if (!/^(SELECT|DELETE)\b/i.test(q)) continue;
    if (!/ORDER BY/i.test(q)) continue;                  // 정렬 없는 것은 이 게이트 대상이 아니다
    lits.push(q);
  }
}
ok(lits.length >= 15, `ml_samples 정렬 쿼리 ${lits.length}건을 소스에서 꺼냈다`);

{
  const bad = [];
  let measured = 0;
  for (const q of lits) {
    let p = null;
    try { p = plan(fill(q)); } catch (e) { continue; }    // 다른 표와 엮여 여기서 못 도는 것은 건너뛴다
    measured++;
    if (heavy(p)) bad.push(`${q.slice(0, 96)}\n         → ${p}`);
  }
  ok(measured >= 12, `그중 ${measured}건을 실제로 계획까지 냈다`);
  ok(bad.length === 0, bad.length === 0
    ? "무거운 계획 0건 — 110만 행 표에서 전수 정렬·전수 스캔을 하지 않는다"
    : `무거운 계획 ${bad.length}건:\n       ` + bad.join("\n       "));
}

// ── ③ 대조군 — ★이 게이트가 진짜로 무거운 계획을 잡는지★ 를 직접 보인다 ────────
//     (고친 세 쿼리의 ★종전 판본★ 을 그대로 재서, 통과가 우연이 아님을 증명한다)
{
  const BEFORE = [
    ["pooluniq 종전", "SELECT ts, symbol FROM ml_samples WHERE featver = 17 ORDER BY id DESC LIMIT 20000"],
    ["구판정리 종전", "SELECT id FROM ml_samples WHERE featver != 17 ORDER BY id LIMIT 100000"],
    ["총량폐기 종전", "SELECT id FROM ml_samples WHERE strategy='hv' AND featver=17 ORDER BY RANDOM() LIMIT 1000"]
  ];
  for (const [nm, q] of BEFORE) {
    const p = plan(q);
    ok(heavy(p), `대조군 — ${nm} 을 '무겁다' 고 판정한다: ${p}`);
  }
  const AFTER = [
    ["pooluniq 고침", "SELECT ts, symbol FROM ml_samples WHERE featver = 17 ORDER BY ts DESC LIMIT 20000"],
    ["구판정리 고침", "SELECT id FROM ml_samples WHERE featver < 17 ORDER BY featver, ts LIMIT 100000"],
    ["총량폐기 고침", "SELECT id FROM ml_samples WHERE featver=17 AND strategy='hv' ORDER BY ts ASC LIMIT 1000"]
  ];
  for (const [nm, q] of AFTER) ok(!heavy(plan(q)), `대조군 — ${nm} 은 '가볍다': ${plan(q)}`);

  /* ★빈 표에서 재면 왜 안 되는지도 못 박는다.★ 첫 판본이 여기서 넘어졌다. */
  const empty = new DatabaseSync(":memory:");
  empty.exec(`CREATE TABLE ml_samples (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, featver INTEGER,
              market TEXT, symbol TEXT, pnl_pct REAL); CREATE INDEX i2 ON ml_samples(featver, ts);`);
  const cursorQ = "SELECT id, ts, market, symbol, pnl_pct FROM ml_samples WHERE id > 1 AND featver = 17 ORDER BY id ASC LIMIT 500";
  const pe = empty.prepare("EXPLAIN QUERY PLAN " + cursorQ).all().map((r) => r.detail).join(" | ");
  const pf = plan(cursorQ);
  ok(heavy(pe) && !heavy(pf),
     `빈 표에서는 커서 쿼리가 무겁게 보이고(${pe.slice(0, 44)}…) 데이터가 있으면 가볍다(${pf}) — ` +
     `★반드시 데이터를 넣고 재야 한다★`);
}

console.log(fail ? "\nD1 스캔 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   D1 스캔 계약 통과");
process.exit(fail ? 1 : 0);
