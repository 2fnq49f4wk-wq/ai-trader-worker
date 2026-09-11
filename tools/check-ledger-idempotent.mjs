/* [V33.348] 원장 멱등성 — ★D1 재시도가 매수를 두 번 적을 수 있었다★
 *
 *   wrapD1(src/index.js) 의 __d1Attempt 는 과부하성 오류에서 모든 D1 호출을 최대 5회 재시도한다.
 *   그 판정(__d1IsOverload)에는 "network connection lost" 와
 *   "storage operation exceeded timeout" 이 들어 있는데, 이 둘은 ★결과를 모르는 실패★ 다 —
 *   쓰기가 이미 커밋됐는데 응답만 유실됐을 수 있다. 그때 재시도하면 같은 배치가 두 번 돈다.
 *
 *   매도는 원래 안전했다(stmtRecordTradeIfPos 의 EXISTS(포지션)가 두 번째에 거짓이 된다).
 *   ★매수만 맨 INSERT 였다.★ positions 는 절대 upsert 라 멱등인데 trades 는 행이 하나 더 생긴다.
 *   현금은 원장 재생(computeCashFromTrades)으로 파생되므로, 그 한 행이 곧 ★매수대금 이중차감★ 이다.
 *   자산은 한 번 치인 수량인데 돈만 두 번 나간다 — 이 저장소가 반복해 겪은 '조용히 사라지는 돈' 이다.
 *
 *   이 게이트는 소스 문자열을 세지 않는다(V33.337 교훈). ★실제 SQLite 에 문장을 돌려★
 *   같은 자연키가 두 번 들어가는지 본다. 그래야 SQL 을 어떻게 다시 써도 뜻이 지켜진다.
 */
/* node:sqlite 는 Node 22 에서 플래그가 필요하다(23.4+ 는 기본). CI 가 `node tools/...` 로
   그냥 부르므로, 못 불러오면 플래그를 달아 스스로 한 번 다시 실행한다. */
let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const r = spawnSync(process.execPath,
    ["--experimental-sqlite", "--no-warnings", fileURLToPath(import.meta.url)], { stdio: "inherit" });
  process.exit(typeof r.status === "number" ? r.status : 1);
}
const { stmtRecordTrade, stmtRecordTradeIfPos } = await import("../src/index.js");

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, market TEXT, symbol TEXT,
    side TEXT, qty REAL, price REAL, pnl REAL, pnl_pct REAL, reason TEXT);
    CREATE TABLE positions (symbol TEXT, strategy TEXT, market TEXT, qty REAL, avg_price REAL,
    opened_ts INTEGER, meta TEXT, PRIMARY KEY(symbol,strategy,market));`);
  return db;
}
const proxy = (db) => ({ prepare: (sql) => ({ bind: (...b) => ({ run: () => db.prepare(sql).run(...b) }) }) });

const db = freshDb(), DB = proxy(db);
const n = () => db.prepare("SELECT COUNT(*) c FROM trades").get().c;
const T = { ts: 1757500000000, market: "us", symbol: "NVDA", side: "BUY", qty: 3, price: 180.25,
            pnl: null, pnl_pct: null, reason: "[RULE][SWING] x" };

// ① 같은 배치가 두 번 도는 상황(= D1 재시도) — 행이 늘면 안 된다.
stmtRecordTrade(DB, T).run();
const after1 = n();
stmtRecordTrade(DB, T).run();
stmtRecordTrade(DB, T).run();            // 재시도는 최대 5회까지 날 수 있다
ok(after1 === 1 && n() === 1, "매수 원장: 같은 자연키 재시도 2회 → 행 1개 유지(현금 이중차감 불가)");

// ② 진짜로 다른 체결은 전부 들어가야 한다 — 멱등화가 정상 거래를 삼키면 더 나쁜 사고다.
const variants = [["ts", T.ts + 1], ["price", 180.26], ["qty", 4], ["side", "SELL"],
                  ["symbol", "AMD"], ["market", "kr"]];
let want = 1;
for (const [k, v] of variants) { stmtRecordTrade(DB, Object.assign({}, T, { [k]: v })).run(); want++; }
ok(n() === want, `서로 다른 체결 ${variants.length}건(${variants.map(v => v[0]).join("·")})이 모두 기록됨 → ${want}행`);

// ③ 그 중 하나라도 '같은 자연키' 로 오인되지 않았는지 직접 확인
const dup = db.prepare(
  "SELECT ts,market,symbol,side,qty,price,COUNT(*) c FROM trades GROUP BY ts,market,symbol,side,qty,price HAVING c>1").all();
ok(dup.length === 0, "원장 전체에 동일 자연키 중복 행 0건");

// ④ 매도 경로(조건부 INSERT)는 종전 동작 그대로여야 한다.
const db2 = freshDb(), DB2 = proxy(db2);
const n2 = () => db2.prepare("SELECT COUNT(*) c FROM trades").get().c;
db2.prepare("INSERT INTO positions VALUES ('TSLA','swing','us',10,100,0,'{}')").run();
const ST = { ts: 1757500001000, market: "us", symbol: "TSLA", side: "SELL", qty: 10, price: 120,
             pnl: 200, pnl_pct: 20, reason: "tp" };
const GD = { symbol: "TSLA", strategy: "swing", market: "us", expectedQty: 10 };
stmtRecordTradeIfPos(DB2, ST, GD).run();
ok(n2() === 1, "매도: 포지션이 기대수량이면 기록된다");
db2.prepare("DELETE FROM positions WHERE symbol='TSLA'").run();
stmtRecordTradeIfPos(DB2, ST, GD).run();
ok(n2() === 1, "매도: 포지션이 이미 정리됐으면 기록하지 않는다(중복 원장 없음)");

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
