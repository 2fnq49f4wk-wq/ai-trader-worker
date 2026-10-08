/* [V33.515] /api/state R2 사본을 크론이 미리 짓는다 — 요청 경로의 ctx.waitUntil 빌드가 바쁜 시간에 끝나지 못해
 *   사본이 수 시간 묵었다(운영: 2,722초 · 6,668초 · 7,498초 — 개장 21분 뒤에도 marketStatus.kr=false).
 *   ① 빌더는 최상위 한 함수(요청·크론이 같은 것) ② 크론은 화면이 최근 15분 안에 열렸을 때만 · 2분마다 · 사본이 2분보다 묵었을 때만
 *   ③ 요청 경로가 '열려 있음' 표시를 남긴다 ④ 신선한 사본이면 짓지 않는다(행동 검사). */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
chk(/^async function buildStatePayload\(env\) \{/m.test(S), "빌더가 최상위 함수 buildStatePayload(env)");
chk(/const __buildState = function \(\) \{ return buildStatePayload\(env\); \};/.test(S), "요청 경로가 같은 빌더를 부른다(두 벌 아님)");
chk(!/const __buildState = async \(\) => \{/.test(S), "옛 클로저 빌더가 남아 있지 않다");
const sch = S.slice(S.indexOf("try { await runTradingCycle(env); }"), S.indexOf("try { await runTradingCycle(env); }") + 2000);
chk(/"state_last_req"/.test(sch) && /15 \* 60000/.test(sch) && /stateR2Refresh\(env, 110000\)/.test(sch) && /getUTCMinutes\(\) % 2 === 0/.test(sch),
  "크론: 2분마다(사본 110초 초과) · 최근 15분 화면 열림 — 매분은 사용량 추정(벽시계)을 하루 +1.4%p 올린다(V33.524 되돌림)", "크론 배선");
chk(/const LIGHT_MAX_MS = 240000;/.test(S), "아이솔레이트는 4분 안의 사본까지 시세만 끼워 쓴다(2분 주기 + 빌드 시간)", "LIGHT_MAX_MS");
chk(/setState\(env\.DB, "state_last_req", Date\.now\(\)\)/.test(S) && /__stateReqMarkAt/.test(S), "요청 경로가 열림 표시를 남긴다(아이솔레이트당 1분 1회)");
chk(/__r2Key = STATE_R2_KEY/.test(S), "요청 경로와 크론이 같은 R2 키");
const M = await import("../src/index.js");
let puts = 0, built = 0;
M._setR2ForTest({ head: async () => ({ customMetadata: { at: String(Date.now() - 30000) } }), put: async () => { puts++; }, get: async () => null });
const r = await M.stateR2Refresh({ DB: { prepare: () => { built++; throw new Error("짓지 말아야 한다"); } } }, 120000);
chk(r === null && puts === 0 && built === 0, "사본이 30초 묵었으면(2분 미만) 짓지 않는다", JSON.stringify({ r, puts, built }));
M._setR2ForTest(null);
/* [V33.523] ★트래픽이 늘어도 D1 풀 빌드는 크론 1회/분★ — 아이솔레이트의 갱신은 사본 + 시세 끼우기(D1 몇 줄)로.
   실제 fetch 처리기를 가짜 DB·R2 로 불러 SQL 수를 센다(종전: 아이솔레이트마다 12초마다 풀 빌드 ≈ SQL 33줄). */
{
  const sqls = [];
  const stmt = () => ({ bind: () => stmt(), all: async () => ({ results: [] }), first: async () => null, run: async () => ({}), raw: async () => [] });
  const DB = { prepare: (q) => { sqls.push(q); return stmt(); }, batch: async (a) => a.map(() => ({ results: [] })), exec: async () => ({}) };
  const _cs = globalThis.caches;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  const run = async (copyAgeMs) => {
    sqls.length = 0;
    const body = JSON.stringify({ watchlist: [{ symbol: "AAPL", price: 1 }], indices: [], marker: "R2COPY" });
    const R2 = { head: async () => null, put: async () => {}, get: async (k) => k === M.STATE_R2_KEY ? { customMetadata: { at: String(Date.now() - copyAgeMs) }, text: async () => body } : null };
    globalThis.__stateCache = { ts: Date.now() - 30000, data: null, str: '{"old":1}' };
    globalThis.__stateBuilding = false;
    const waits = [];
    const res = await M.default.fetch(new Request("https://x.test/api/state"), { DB, MODELS: R2 }, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits).catch(() => {});
    const c = globalThis.__stateCache;
    return { layer: res.headers.get("x-lux-c"), gotCopy: /R2COPY/.test(c.str), fresh: Date.now() - c.ts < 5000, sqlN: sqls.length,
      heavy: sqls.filter((q) => /positions|trades/i.test(q)).length, quoteScan: sqls.some((q) => /k >= 'quote:'/.test(q)) };
  };
  const a = await run(30000), b = await run(600000);
  chk(a.layer === "l1s" && a.gotCopy && a.fresh && a.heavy === 0 && a.quoteScan && a.sqlN <= 4,
    "사본이 30초면: 낡은 L1 을 즉시 주고, 뒤에서 ★사본 + 시세 끼우기★ 로 갱신(SQL " + a.sqlN + "줄 · 포지션/거래 조회 0)", JSON.stringify(a));
  chk(!b.gotCopy && b.fresh && b.heavy > 0,
    "사본이 10분 묵었으면(크론이 못 짓는 중): 종전처럼 직접 풀 빌드로 물러선다(화면이 멈추지 않는다)", JSON.stringify(b));
  globalThis.caches = _cs; globalThis.__stateCache = null;
}
if (fails) { console.log("\n✗ 상태 사본 크론 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 상태 사본 크론 통과");
