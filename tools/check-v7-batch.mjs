/* [V33.357 · A-6] ★배치 하나가 0건이라고 v7 전체를 죽었다고 하지 않는다★
 *
 *   실측(2026-09-14 23:09 자가진단): v7 이 ★응답모양 result=0 keys=quoteResponse★ —
 *   봉투는 멀쩡하고 error 도 없는데 배열만 비었다. 스키마 변경도 인증 실패도 아니다.
 *   그런데 종전 코드는 ★첫 배치 하나★ 로 558종의 운명을 정했다:
 *     slices[0] 가 0건 → v7Dead → 전 종목이 v8 폴백 → "50종목/1회 → 1종목/1회"
 *   fields 를 뒤집어 한 번 더 보긴 했지만 ★같은 배치★ 라 같은 심볼을 또 물어본 것뿐이다.
 *   "v7 이 죽었다" 와 "이 배치에 야후가 못 알아먹는 심볼이 하나 있다" 를 구분할 길이 없었다.
 *
 *   → 죽었다고 선언하기 전에 ★다른 배치★ 를 한 번 물어본다.
 *
 *   ★실제로 fetchBatchQuotes 를 돌려서★ 확인한다(문자열 검사 아님).
 *   가짜 fetch 가 '오염 심볼이 든 배치만 빈 응답' 을 흉내 낸다.
 */
import { fetchBatchQuotes, resetFetchBudget, fetchBudgetLeft } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

const N = 300, BATCH = 50;
const SYMS = Array.from({ length: N }, (_, i) => "S" + String(i).padStart(3, "0"));
const POISON = "S007";           // 첫 배치(0~49) 안에 있는 '야후가 못 알아먹는' 심볼

/* 가짜 야후 — poison 이 든 배치는 { quoteResponse: { result: [] } } 를 준다(실측 응답모양). */
function install({ poison, allDead }) {
  const calls = { v7: 0, v7empty: 0, chart: 0, askedV7: [] };
  globalThis.fetch = async function (url) {
    const u = String(url);
    if (u.indexOf("/v7/finance/quote") >= 0) {
      calls.v7++;
      const m = /[?&]symbols=([^&]*)/.exec(u);
      const asked = m ? decodeURIComponent(m[1]).split(",") : [];
      calls.askedV7.push(asked);
      const bad = allDead || (poison && asked.indexOf(poison) >= 0);
      if (bad) calls.v7empty++;
      const body = bad
        ? { quoteResponse: { result: [], error: null } }          // ★실측 응답모양★
        : { quoteResponse: { result: asked.map((s) => ({ symbol: s, regularMarketPrice: 100,
              regularMarketPreviousClose: 99, regularMarketChangePercent: 1.01 })) } };
      return { ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); } };
    }
    if (u.indexOf("/v8/finance/chart/") >= 0) {
      calls.chart++;
      const body = { chart: { result: [{ meta: { regularMarketPrice: 100, chartPreviousClose: 99 },
        timestamp: [1, 2], indicators: { quote: [{ close: [99, 100] }] } }] } };
      return { ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); } };
    }
    throw new Error("unexpected fetch " + u.slice(0, 60));
  };
  return calls;
}

/* state 를 기억하는 가짜 D1 — yahoo_v7 기록을 되읽어 확인한다. */
function fakeDB() {
  const st = new Map();
  return {
    st,
    prepare: (sql) => ({
      bind: (...b) => ({
        first: async () => { const v = st.get(b[0]); return v == null ? null : { v }; },
        all: async () => ({ results: [] }),
        run: async () => { if (/INSERT INTO state/.test(sql)) st.set(b[0], b[1]); return {}; }
      }),
      first: async () => null, all: async () => ({ results: [] })
    })
  };
}
const v7State = (db) => { try { return JSON.parse(db.st.get("yahoo_v7")); } catch (e) { return null; } };

// ── ① 첫 배치만 오염 — v7 은 살아 있어야 하고, 나머지는 배치로 받아야 한다 ────────
{
  const calls = install({ poison: POISON });
  const DB = fakeDB();
  resetFetchBudget(400);
  const out = await fetchBatchQuotes(SYMS, { maxFallback: N, DB, extMax: 0, extPriority: [] });
  const st = v7State(DB);

  ok(st && st.dead === false,
     `첫 배치만 0건일 때 v7 을 죽었다고 하지 않는다 (dead=${st && st.dead}) — 종전엔 true 였다`);

  // 오염되지 않은 배치의 종목은 v7 으로(=배치로) 받았어야 한다
  const late = SYMS.slice(BATCH * 2);           // 배치 2 이후
  const gotLate = late.filter((s) => out[s] && out[s].price > 0).length;
  ok(gotLate === late.length,
     `오염 안 된 배치 ${late.length}종을 전부 받았다 (${gotLate}종) — 50종목/1회 속도가 살아 있다`);

  // 오염 배치의 종목은 v8 폴백으로 개별 수집 — 그 수만큼만 chart 를 쓴다
  ok(calls.chart <= BATCH + 2,
     `개별 폴백은 오염 배치 크기만큼만 (${calls.chart}회 ≤ ${BATCH + 2}) — 종전엔 ${N}회였다`);

  /* ★v7 호출 수를 딱 고정한다.★ 이게 없으면 "오염 배치를 v7 으로 또 긁는다" 같은 낭비를
     못 잡는다(실제로 처음엔 못 잡았고, 돌연변이 검사가 알려 줬다).
     내역: 첫 배치 2회(fields 양쪽) + 다른 배치 탐색 1회 + 남은 배치 ${Math.ceil(N / BATCH) - 2}회 */
  const want1 = 2 + 1 + (Math.ceil(N / BATCH) - 2);
  ok(calls.v7 === want1,
     `v7 호출 ${calls.v7}회 = 기대 ${want1}회 (첫배치 2 + 탐색 1 + 나머지 ${Math.ceil(N / BATCH) - 2}) — ` +
     `오염 배치를 다시 긁지도, 탐색한 배치를 두 번 긁지도 않는다`);
  ok(calls.v7empty === 2, `빈 응답을 받은 횟수 ${calls.v7empty}회 — 오염 배치에만 부딪힌다`);

  ok(!!(st && Array.isArray(st.badSlice) && st.badSlice.indexOf(POISON) >= 0),
     `의심 배치를 이름으로 남긴다 — ${st && st.badSlice ? st.badSlice.slice(0, 4).join(",") + "…" : "없음"}`);
}

// ── ② 대조군: 종전 동작이었다면 어땠는지 수치로 보여 준다 ──────────────────────
//     (전 배치가 0건 = 진짜 v7 사망) — 이때는 종전대로 dead 여야 한다
{
  const calls = install({ allDead: true });
  const DB = fakeDB();
  resetFetchBudget(400);
  await fetchBatchQuotes(SYMS, { maxFallback: N, DB, extMax: 0, extPriority: [] });
  const st = v7State(DB);
  ok(st && st.dead === true, `전 배치가 0건이면 종전대로 v7 사망 판정 (dead=${st && st.dead})`);
  ok(!st.badSlice, "진짜 사망일 때는 '의심 배치' 를 지목하지 않는다(엉뚱한 종목을 범인으로 적지 않는다)");
  ok(calls.chart > BATCH, `진짜 사망이면 개별 폴백이 많이 돈다 — ${calls.chart}회(이게 종전의 상시 상태였다)`);
  ok(st.shape && /result=0/.test(st.shape), `응답모양을 남긴다 — "${st.shape}"`);
  ok(calls.v7 === 3, `진짜 사망이면 v7 탐색을 3회에서 멈춘다 (${calls.v7}회) — 죽은 API 를 배치마다 두드리지 않는다`);
}

// ── ③ 정상: 오염이 없으면 추가 탐색을 안 한다(예산 낭비 0) ────────────────────
{
  const calls = install({});
  const DB = fakeDB();
  resetFetchBudget(400);
  const out = await fetchBatchQuotes(SYMS, { maxFallback: N, DB, extMax: 0, extPriority: [] });
  const st = v7State(DB);
  ok(st && st.dead === false && !st.badSlice, "정상일 땐 사망도 의심배치도 없다");
  ok(calls.v7 === Math.ceil(N / BATCH), `배치 수만큼만 호출한다 — ${calls.v7}회(= ${Math.ceil(N / BATCH)}배치, 군더더기 0)`);
  ok(calls.chart === 0, `폴백을 안 쓴다 — ${calls.chart}회`);
  ok(SYMS.every((s) => out[s] && out[s].price > 0), "전 종목을 v7 로 받았다");
}

// ── ④ 예산이 없으면 추가 탐색도 안 한다 ───────────────────────────────────────
//     ★남은 예산만 보면 안 된다★ — 0 아래로 안 내려간다는 것과 '안 불렀다' 는 다른 말이다.
//     실제 호출 수를 세야 예산 가드를 지운 회귀를 잡는다(돌연변이 검사가 알려 줬다).
{
  const calls = install({ poison: POISON });
  const DB = fakeDB();
  resetFetchBudget(1);            // 첫 배치 한 번이면 바닥
  await fetchBatchQuotes(SYMS, { maxFallback: N, DB, extMax: 0, extPriority: [] });
  ok(calls.v7 === 1, `예산 1 이면 v7 을 ${calls.v7}회만 부른다 — 예산 밖으로 탐색하지 않는다`);
  ok(fetchBudgetLeft() >= 0, `예산을 넘기지 않는다 — 남은 ${fetchBudgetLeft()}`);

  /* ★여기가 이 절의 요점이다.★ yahooFetch 는 예산이 바닥나면 스스로 throw 한다 —
     그래서 호출 수만 세면 예산 가드를 지운 회귀가 ★동치처럼 보인다.★ 하지만 가드가 없으면
     그 throw 가 catch 에 걸려 `yahoo_v7.err = "budget"` 이 남고, 자가진단은
     ★"야후 v7 호출이 실패한다 [budget]"★ 이라고 말한다 — 야후는 멀쩡한데 우리 예산이
     바닥난 것을 남 탓으로 적는 것이다(이번 세션에서 계속 고쳐 온 '문장이 거짓말하는' 부류).
     그러니 재야 할 것은 호출 수가 아니라 ★기록에 남는 사유★ 다. */
  const st4 = v7State(DB);
  ok(st4 && !st4.err,
     `예산 바닥을 ★야후 탓으로 적지 않는다★ — err=${JSON.stringify(st4 && st4.err)} ` +
     `(가드가 없으면 "budget" 이 남아 자가진단이 야후가 죽었다고 말한다)`);
}

console.log(fail ? "\nv7 배치 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   v7 배치 계약 통과");
process.exit(fail ? 1 : 0);
