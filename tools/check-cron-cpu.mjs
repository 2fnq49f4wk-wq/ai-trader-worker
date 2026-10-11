/* [V33.534] 크론 CPU 절감 계약 — 판단은 그대로, 비용만 줄인다.
 *   근거: tools/cron-cpu-bench.mjs(실제 워커 코드를 Node 에서 돌려 V8 CPU 프로파일). 워커 안의 Date.now 는 계산 중 멈춰
 *   단계 프로파일로는 CPU 를 못 본다. 운영 실측: 월 CPU 7.35일에 32.97% → 이대로면 19일께 85% 셧다운(전 사이클 정지).
 *   ① getStochSlow: 옛 구현(봉마다 slice)과 비트 단위로 같은 값 ② fetchBatchQuotes: 네이버 배치가 준 한국 종목을 단건으로 다시 부르지 않는다
 *   ③ 네이버가 못 준 한국 종목은 여전히 폴백한다(값 손실 없음) */
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };

function getMA(h, p) { if (!Array.isArray(h) || h.length < p) return null; let s = 0; for (let i = h.length - p; i < h.length; i++) s += h[i]; return s / p; }
const _num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
function oldStoch(highs, lows, closes, n, kSmooth, dSmooth) {
  n = n || 14; kSmooth = kSmooth || 3; dSmooth = dSmooth || 3;
  if (!Array.isArray(closes)) return null;
  const H = (Array.isArray(highs) && highs.length === closes.length) ? highs : closes;
  const L = (Array.isArray(lows) && lows.length === closes.length) ? lows : closes;
  if (closes.length < n + kSmooth + dSmooth) return null;
  const fastK = [];
  for (let i = n - 1; i < closes.length; i++) { let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) { const h = _num(H[j], closes[j]), l = _num(L[j], closes[j]); if (h > hi) hi = h; if (l < lo) lo = l; }
    fastK.push((hi > lo) ? ((closes[i] - lo) / (hi - lo)) * 100 : 50); }
  if (fastK.length < kSmooth + dSmooth) return null;
  const slowK = []; for (let i = kSmooth - 1; i < fastK.length; i++) slowK.push(getMA(fastK.slice(0, i + 1), kSmooth));
  if (slowK.length < dSmooth + 1) return null;
  const k = slowK[slowK.length - 1], kPrev = slowK[slowK.length - 2], d = getMA(slowK, dSmooth), dPrev = getMA(slowK.slice(0, slowK.length - 1), dSmooth);
  let cross = 0; if (d != null && dPrev != null) { if (kPrev <= dPrev && k > d) cross = 1; else if (kPrev >= dPrev && k < d) cross = -1; }
  return { k, d, kFast: fastK[fastK.length - 1], cross };
}
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let same = 0, tot = 0, bad = "";
for (let t = 0; t < 400; t++) {
  const N = [5, 18, 20, 21, 60, 320][t % 6], c = [], h = [], l = []; let p = 100;
  for (let i = 0; i < N; i++) { p *= 1 + (rnd() - 0.5) * 0.06; c.push(+p.toFixed(t % 3 ? 2 : 0)); h.push(p * (1 + rnd() * 0.02)); l.push(p * (1 - rnd() * 0.02)); }
  if (t % 7 === 0) for (let i = 0; i < N; i += 5) c[i] = c[Math.max(0, i - 1)];      // 평평한 구간(최고=최저)
  const args = [[h, l, c, 14, 3, 3], [h, l, c, 9, 3, 3], [null, null, c, 14, 5, 3], [h.slice(1), l, c, 14, 3, 3], [h, l, c, 5, 1, 1]][t % 5];
  const a = JSON.stringify(oldStoch(...args)), b = JSON.stringify(M.getStochSlow(...args));
  tot++; if (a === b) same++; else if (!bad) bad = a + " vs " + b;
}
chk(same === tot, "getStochSlow — 옛 구현과 비트 단위 동일(" + same + "/" + tot + ")", bad);

// ② ③ 네이버 배치가 가격을 준 종목은 단건 폴백을 타지 않는다 · 못 준 종목은 탄다
const realFetch = globalThis.fetch; const calls = [];
globalThis.fetch = async (u) => { const url = String(u); calls.push(url);
  if (url.includes("polling.finance.naver.com/api/realtime")) {
    const codes = /SERVICE_ITEM:([^&]+)/.exec(url)[1].split(",");
    return Response.json({ result: { areas: [{ datas: codes.filter((cd) => cd !== "000660").map((cd) => ({ cd, nv: 1000, sv: 990 })) }] } });
  }
  return new Response("x", { status: 404 }); };
try {
  const syms = ["005930.KS", "000660.KS", "035420.KS"];
  const out = await M.fetchBatchQuotes(syms, { maxFallback: 50 });
  const single = calls.filter((u) => /SERVICE_ITEM:[^,&]+$/.test(u) && u.includes("polling"));
  chk(out["005930.KS"] && out["005930.KS"].price === 1000 && out["035420.KS"], "배치가 준 한국 종목은 그 값 그대로");
  chk(!single.some((u) => /005930|035420/.test(u)), "배치가 준 종목을 단건으로 다시 부르지 않는다", single.join(" "));
  chk(single.some((u) => /000660/.test(u)), "배치가 못 준 종목(000660)은 단건 폴백을 탄다(값 손실 없음)", single.join(" "));
} finally { globalThis.fetch = realFetch; }

// ④ [V33.536] 일봉 일괄 캐시 — 읽히는 종목만 파싱 · 의미는 종전(전량 파싱한 객체)과 같다
{
  const rows = [{ k: "daily:AAA", v: JSON.stringify({ closes: [1, 2] }) }, { k: "daily:BBB", v: "{bad json" }, { k: "daily:CCC", v: JSON.stringify({ closes: [3] }) }];
  const L = M._dailyBulkLazy(rows);
  const a1 = L.AAA, a2 = L.AAA;
  chk(a1 && a1.closes[1] === 2 && a1 === a2, "읽은 종목은 파싱해 같은 객체를 돌려준다(기억)");
  chk(L.BBB === undefined && !("BBB" in L) && L.ZZZ === undefined && ("CCC" in L), "파싱 실패·없는 종목 = 없음(종전과 같다)");
  chk(JSON.stringify(Object.keys(L)) === JSON.stringify(["AAA", "CCC"]), "키 순회(Object.keys) = 파싱 성공한 종목들(종전과 같다)", JSON.stringify(Object.keys(L)));
  const S2 = (await import("node:fs")).readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  chk((S2.match(/_dailyBulkLazy\((drows|rows0)\.results\)/g) || []).length === 3 && !/__allDaily\[r\.k\.slice\(6\)\] = JSON\.parse/.test(S2), "일괄 캐시 세 곳 모두 지연 파싱");
  chk(/parts\.push\(JSON\.stringify\(sym\) \+ ":" \+ t\)/.test(S2), "학습기 봉 응답은 원문을 그대로 잇는다(파싱·재직렬화 없음)");
}

// ⑤ [V33.540] 사용자 결정(10/11): 정지 = 포함량의 150% · 비율 문턱(보강 0.75 · 슬리브 0.82)도 같은 배수로 옮겨 간다 · 저장된 cfg 가 85% 여도 적용
{
  const L = M._usageLimits({ shutdownAt: 0.85, monthlyCpuMs: 30000000 });
  chk(Math.abs(L.monthlyCpuMs * L.shutdownAt / 30000000 - 1.5) < 1e-3 && L.includedCpuMs === 30000000, "정지 지점 = 포함량 150% (저장된 cfg 85% 여도)", JSON.stringify(L));
  chk(Math.abs(L.monthlyCpuMs * 0.75 / 30000000 - 0.75 * 1.5 / 0.85) < 1e-3, "부가기능 문턱(0.75)도 같은 배수로 이동 — 정지 전에 성능이 먼저 깎이지 않는다");
  const S3 = (await import("node:fs")).readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  chk((S3.match(/Object\.assign\(\{\}, USAGE_LIMITS_DEFAULT/g) || []).length === 1, "사용량 한도 읽는 곳은 전부 _usageLimits 를 거친다");
}

// [V33.553] 묶어 읽기(getStates)는 mind_model 의 나무를 D1 에서 떼고 받는다(파싱 바이트 51~64% 의 주범) — 실제 SQLite 로 돌린다
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE state (k TEXT PRIMARY KEY, v TEXT, updated_ts INTEGER)");
  const big = { source: "external", trainedAt: 5, featVer: 9, trees: Array.from({ length: 300 }, (_, i) => [i, i + 1, i + 2]) };
  db.prepare("INSERT INTO state VALUES (?,?,?)").run("mind_model", JSON.stringify(big), 1);
  db.prepare("INSERT INTO state VALUES (?,?,?)").run("gbdt_trust", JSON.stringify({ trusted: true, trees: [1] }), 1);
  db.prepare("INSERT INTO state VALUES (?,?,?)").run("bad", "not json", 1);
  const D1 = { prepare(sql) { const st = db.prepare(sql); let a = []; const o = { bind(...x) { a = x; return o; }, async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a); } }; return o; } };
  const r = await M.getStates(D1, ["mind_model", "gbdt_trust", "bad"]);
  chk(r.mind_model && r.mind_model.trees === undefined && r.mind_model.trainedAt === 5 && r.mind_model.featVer === 9 && r.gbdt_trust && r.gbdt_trust.trees.length === 1,
    "getStates: mind_model 은 머리만(나무는 D1 이 뗀다) · 다른 키는 그대로", JSON.stringify(r).slice(0, 200));
  db.prepare("INSERT OR REPLACE INTO state VALUES (?,?,?)").run("mind_model", "{broken", 1);
  const r2 = await M.getStates(D1, ["mind_model", "gbdt_trust"]);
  chk(r2.gbdt_trust && r2.gbdt_trust.trusted === true, "깨진 mind_model 행이 있어도 묶어 읽기 전체가 죽지 않는다(json_valid)");
  const S4 = (await import("node:fs")).readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  // 나무가 필요한 위원장 로더는 묶어 읽기를 쓰지 않는다
  const ml = S4.slice(S4.indexOf("async function mlMindLoad(DB)"), S4.indexOf("async function mlMindLoad(DB)") + 1500);
  chk(/getState\(DB, "mind_model", null\)/.test(ml) && !/getStates\(/.test(ml), "위원장 로더(mlMindLoad)는 전체를 읽는다(getState)");
}

if (fails) { console.log("\n✗ 크론 CPU 절감 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 크론 CPU 절감 계약 통과");
