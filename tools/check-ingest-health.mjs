/* [V33.565] 외부 원천 건강표 계약 — 실제 운영 fetch 의 성공/실패를 원천별로 센다(판단 관여 없음)
 *   ① 원천 키: 호스트 + 경로 앞 3칸 · 숫자/종목코드는 * (종목마다 키가 갈라지지 않는다) · 내부 주소 제외
 *   ② 성공/HTTP 오류(상태별)/예외 · 마지막 오류 문장 ③ 합치기: 수는 더하고 마지막 오류는 늦은 쪽
 *   ④ 배선: fetch 감싸개가 응답·예외 모두 기록하고 예외는 그대로 다시 던진다 · 크론 끝 10분 합침 · /api/ingest-health 학습키 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const k1 = M._fhKey("https://api.stock.naver.com/chart/domestic/item/005930/minute5");
const k2 = M._fhKey("https://api.stock.naver.com/chart/domestic/item/000660/minute5");
chk(k1 === k2 && k1 === "api.stock.naver.com/chart/domestic/item", "종목코드가 달라도 같은 원천 키", k1);
chk(M._fhKey("https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE") === "fred.stlouisfed.org/graph/fredgraph.csv", "쿼리는 키에서 뺀다");
chk(M._fhKey("https://state-cache.internal/x") === null && M._fhKey("not a url") === null, "내부 주소·잘못된 주소는 세지 않는다");
const a = { "h/x": { ok: 3, bad: 1, ex: 0, st: { 520: 1 }, err: "HTTP 520", errAt: 10, okAt: 20 } };
const b = { "h/x": { ok: 1, bad: 2, ex: 1, st: { 520: 1, 404: 1 }, err: "boom", errAt: 30, okAt: 5 }, "h/y": { ok: 2, bad: 0, ex: 0, st: {}, err: null, errAt: 0, okAt: 7 } };
const m = M._fhMerge(a, b);
chk(m["h/x"].ok === 4 && m["h/x"].bad === 3 && m["h/x"].ex === 1 && m["h/x"].st[520] === 2 && m["h/x"].st[404] === 1 && m["h/x"].err === "boom" && m["h/x"].okAt === 20 && m["h/y"].ok === 2,
    "합치기: 수는 더하고 마지막 오류·성공 시각은 늦은 쪽", JSON.stringify(m));
chk(/try \{ const r = await __rawFetch\.apply\(globalThis, arguments\); try \{ _fhRec\(_k, r\.status, null\); \} catch \(e\) \{\} return r; \}\s*catch \(e\) \{ try \{ _fhRec\(_k, 0, \(e && e\.message\) \|\| e\); \} catch \(e2\) \{\} throw e; \}/.test(S),
    "fetch 감싸개: 응답·예외 기록 · 예외는 그대로 다시 던진다(호출부 동작 불변)");
chk(/await fetchHealthFlush\(env\.DB, false\);/.test(S) && /now - __fhFlushAt < 10 \* 60000/.test(S), "크론 끝에서 10분마다 합쳐 쓴다(D1 쓰기 10분 1회)");
chk(/path === "\/api\/ingest-health"\) \{\s*const au = _trainAuthed\(\);/.test(S), "/api/ingest-health 는 학습키");
// [V33.568] 사이클 D1 질의 묶음 — 동사·테이블·state 키 접두로 센다(값·종목 코드는 키에 안 들어간다)
chk(M._ioTag("SELECT v FROM state WHERE k = ?", "daily:005930.KS") === "SELECT state [daily]" &&
    M._ioTag("INSERT INTO state (k, v, updated_ts) VALUES (?, ?, ?)", "quote:AAPL") === "INSERT state [quote]" &&
    M._ioTag("UPDATE logs SET message = ? WHERE id = ?", "x") === "UPDATE logs" &&
    M._ioTag("INSERT INTO logs (ts, level) VALUES (?, ?)", 12) === "INSERT logs", "D1 질의 묶음 키(동사·테이블·state 접두)");
chk(/\[D1 상위 " \+ Object\.entries\(__ioMeter\.q\)/.test(S) && /__ioMeter = \{ d1n: 0, d1ms: 0, fn: 0, fms: 0, q: \{\} \};/.test(S), "EVAL-COST 에 D1 상위 질의 4개");
if (fails) { console.log("\n✗ 원천 건강표 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 원천 건강표 통과");
