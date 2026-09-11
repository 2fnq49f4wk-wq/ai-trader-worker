/* [V33.348] D1 과부하 — ★수 MB 를 받아 수십 KB 를 쓰고 버리는 쿼리가 매 분 돌고 있었다★
 *
 *   사용자 지시: "오버로드 걸리는 문제 더 찾아서".
 *
 *   ① FLOW/XALPHA 일봉 로드
 *      시장 루프 안에서 'daily:' 전량(약 1,000종목 × 320~2,400봉 × 5배열)을 매 사이클·매 시장
 *      통째로 읽고 JSON.parse 했다. 쓰는 것은 마지막 70봉뿐이다. 그 자리 주석은 "사이클당 1회"
 *      라고 적혀 있었지만 블록이 시장 루프 안이라 실제로는 시장 수만큼 돌았다.
 *      V12.131 이 같은 파일 19228 의 ★똑같은 쿼리★ 에 이미 캐시를 붙이며
 *      "prefetch 지연·D1 부하의 큰 축" 이라고 적어 뒀는데, 그 뒤 캐시 없는 복제본이 들어왔다.
 *
 *   ② /api/ml-export 의 total COUNT
 *      (featVer, anchorTs) 가 같으면 total 은 정의상 불변인데 페이지마다 다시 셌다.
 *      트레이너는 2만건씩 50여 페이지를 당겨간다 — 학습 1회당 98만 행 COUNT 50여 회다.
 *
 *   ③ prefix LIKE
 *      univHealthNightly 가 k LIKE 'daily:%' 를 썼다. SQLite 의 LIKE 최적화는 기본 설정에서
 *      꺼져 있어 ★state 전체 스캔★ 이 된다. 같은 파일의 다른 daily: 조회는 전부 범위형이다.
 *
 *   이 게이트는 소스 문자열을 세지 않는다(V33.337 교훈).
 *   ①②는 ★실제로 두 번 호출해 D1 왕복 수를 세고★, ③은 실제 SQLite 의 쿼리계획을 본다.
 */
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
const { flowDailyCacheLoad, mlExportTotalCached, FLOW_DAILY_TTL_MS } = await import("../src/index.js");

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

// ── ① FLOW 일봉 로드: 두 번 불러도 D1 왕복은 한 번이어야 한다 ──
let trips = 0;
const rows = [];
for (let i = 0; i < 800; i++) {
  rows.push({ k: "daily:S" + i, v: JSON.stringify({ closes: Array.from({ length: 320 }, (_, j) => 100 + j), opens: null, highs: null, lows: null, volumes: null }) });
}
rows.push({ k: "daily:^GSPC", v: JSON.stringify({ closes: Array.from({ length: 320 }, () => 5000) }) });   // 지수는 제외돼야 한다
const DB = { prepare: () => ({ all: async () => { trips++; return { results: rows }; } }) };

globalThis.__flowDailyCache = null;
const m1 = await flowDailyCacheLoad(DB);
const m2 = await flowDailyCacheLoad(DB);
ok(trips === 1, `FLOW 일봉: 연속 2회 호출 → D1 왕복 ${trips}회(기대 1)`);
ok(m1 === m2 || JSON.stringify(Object.keys(m1)) === JSON.stringify(Object.keys(m2)), "두 호출이 같은 내용을 준다");
ok(Object.keys(m1).length === 800 && !m1["^GSPC"], `종목 ${Object.keys(m1).length}종 적재 · 지수(^) 제외`);
ok(m1["S0"] && m1["S0"].closes.length === 70, "마지막 70봉만 남긴다(수 MB → 수십 KB)");

// TTL 이 지나면 다시 읽어야 한다 — 캐시가 영구히 굳으면 그것대로 사고다.
globalThis.__flowDailyCache.ts = Date.now() - FLOW_DAILY_TTL_MS - 1;
await flowDailyCacheLoad(DB);
ok(trips === 2, `TTL(${FLOW_DAILY_TTL_MS / 60000}분) 경과 후에는 다시 읽는다 → 왕복 ${trips}회`);

// ── ② export total: 같은 (featVer, anchorTs) 면 한 번만 센다 ──
let counts = 0;
const DB2 = { prepare: () => ({ bind: () => ({ first: async () => { counts++; return { c: 988239 }; } }) }) };
globalThis.__mlExportTotal = null;
const t1 = await mlExportTotalCached(DB2, 17, 1757500000000);
for (let i = 0; i < 50; i++) await mlExportTotalCached(DB2, 17, 1757500000000);   // 트레이너 50여 페이지
ok(counts === 1 && t1 === 988239, `export total: 51회 요청 → COUNT ${counts}회(기대 1), 값 ${t1}`);
const t2 = await mlExportTotalCached(DB2, 17, 1757500999999);   // anchorTs 가 다르면 집합이 다르다
ok(counts === 2 && t2 === 988239, `anchorTs 가 바뀌면 다시 센다 → COUNT ${counts}회(기대 2)`);

// ── ③ prefix LIKE 는 인덱스를 못 탄다 — 실제 쿼리계획으로 보인다 ──
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE state (k TEXT PRIMARY KEY, v TEXT, updated_ts INTEGER)");
const ins = db.prepare("INSERT INTO state VALUES (?,?,?)");
for (let i = 0; i < 300; i++) ins.run("daily:S" + i, "x", i);
for (let i = 0; i < 300; i++) ins.run("hist:S" + i, "y", i);
const plan = (sql) => db.prepare("EXPLAIN QUERY PLAN " + sql).all().map(r => r.detail).join(" | ");
const pLike = plan("SELECT k, updated_ts FROM state WHERE k LIKE 'daily:%'");
const pRange = plan("SELECT k, updated_ts FROM state WHERE k >= 'daily:' AND k < 'daily;'");
ok(/SCAN/.test(pLike) && !/INDEX/.test(pLike), `전제 확인: LIKE 는 전체 스캔이다 → ${pLike}`);
ok(/SEARCH/.test(pRange) && /INDEX/.test(pRange), `범위형은 인덱스를 탄다 → ${pRange}`);
const setL = db.prepare("SELECT k FROM state WHERE k LIKE 'daily:%'").all().map(r => r.k).sort();
const setR = db.prepare("SELECT k FROM state WHERE k >= 'daily:' AND k < 'daily;'").all().map(r => r.k).sort();
ok(setL.length === setR.length && setL.every((v, i) => v === setR[i]), "두 형태가 같은 집합을 준다(치환이 안전하다)");

// 소스에 state 를 prefix LIKE 로 긁는 쿼리가 남아 있으면 안 된다.
const { readFileSync } = await import("node:fs");
const SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const bad = (SRC.match(/FROM state WHERE[^"']*\bk LIKE '[^%'][^']*%'/g) || []);
ok(bad.length === 0, bad.length ? `state 를 prefix LIKE 로 긁는 쿼리가 남았다: ${bad[0]}` : "state 를 prefix LIKE 로 긁는 SELECT 없음");

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
