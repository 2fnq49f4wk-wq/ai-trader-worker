/* [V33.353 · A-5] v7 이 죽으면 시간외 보강이 ★한 종목도 못 돌던★ 문제
 *
 *   종전 흐름: v7 배치 → (값 없는 종목) 분봉 폴백 → 시간외 보강.
 *   폴백 루프가 예산을 ★0 이 될 때까지★ 썼다. v7 이 살아 있으면 폴백이 몇 종목뿐이라
 *   아무 문제가 없는데, ★v7 이 죽으면(A-6) 전 종목이 폴백 대상★ 이 되어 예산을 통째로
 *   먹는다. 그러면 시간외 보강은 예산이 없어 한 종목도 못 돌린다.
 *   ★그리고 v7 이 죽었을 때가 바로 시간외 보강이 가장 필요한 때다.★
 *
 *   고침: 시간외 창이면 보강 몫(40)을 먼저 떼어 두고 폴백을 멈춘다. 예산 자체는 안 늘린다 —
 *   같은 예산을 쓰되 한쪽이 다 먹지 못하게 한다. 상한도 남은 예산에 묶는다.
 *
 *   ★실제로 fetchBatchQuotes 를 돌려서★ 확인한다(문자열 검사 아님).
 *   yahooFetch·네이버를 가짜로 끼우고, 각 경로가 몇 번 불렸는지 센다.
 */
import { fetchBatchQuotes, resetFetchBudget, fetchBudgetLeft, usMarketStateNow, EXT_ENRICH_MAX } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

const SYMS = Array.from({ length: 300 }, (_, i) => "S" + i);

/* 미국 장후(17:00 ET)에 돌리기 위해 시계를 그 시각으로 고정한다. */
const RealDate = Date;
function freezeET(hourET) {
  // 2026-09-15 화요일 EDT(UTC−4)
  const fixed = RealDate.UTC(2026, 8, 15, hourET + 4, 0);
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(fixed); else super(...a); }
    static now() { return fixed; }
  };
}
const unfreeze = () => { globalThis.Date = RealDate; };

/* v7 이 죽은 상황(빈 응답) + 분봉만 살아 있는 상황을 만든다. */
function install({ v7Dead }) {
  const calls = { v7: 0, chart: 0, ext: 0 };
  globalThis.fetch = async function (url) {
    const u = String(url);
    if (u.indexOf("/v7/finance/quote") >= 0) {
      calls.v7++;
      const body = v7Dead ? { quoteResponse: { result: [] } }
        : { quoteResponse: { result: SYMS.map((s) => ({ symbol: s, regularMarketPrice: 100, regularMarketPreviousClose: 99, marketState: "POST" })) } };
      return { ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); } };
    }
    if (u.indexOf("includePrePost=true") >= 0 || /interval=5m/.test(u)) {
      calls.ext++;
      const now = Math.floor(RealDate.now() / 1000);
      const body = { chart: { result: [{ meta: { regularMarketPrice: 100, chartPreviousClose: 99 },
        timestamp: [now - 120], indicators: { quote: [{ close: [101] }] } }] } };
      return { ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); } };
    }
    if (u.indexOf("/v8/finance/chart/") >= 0) {
      calls.chart++;
      const body = { chart: { result: [{ meta: { regularMarketPrice: 100, chartPreviousClose: 99 },
        timestamp: [1, 2], indicators: { quote: [{ close: [99, 100] }] } }] } };
      return { ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); } };
    }
    throw new Error("unexpected fetch " + u.slice(0, 50));
  };
  return calls;
}

const DB = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }),
                               first: async () => null, all: async () => ({ results: [] }) }) };

freezeET(17);   // 미국 장후
ok(usMarketStateNow() === "POST", `시계를 미국 장후로 고정했다 (${usMarketStateNow()})`);

/* ── v7 이 죽은 날: 폴백이 예산을 다 먹지 못하고 보강이 실제로 돈다 ── */
{
  const calls = install({ v7Dead: true });
  resetFetchBudget(200);
  await fetchBatchQuotes(SYMS, { maxFallback: SYMS.length, DB, extPriority: [], extOffset: 0, extMax: 120 });
  ok(calls.ext > 0, `★v7 이 죽어도 시간외 보강이 돈다 — ${calls.ext}종목★ (종전엔 폴백이 예산을 다 먹어 0이었다)`);
  ok(calls.chart > 0, `폴백도 여전히 돈다 — ${calls.chart}종목(가격 자체는 받아야 한다)`);
  ok(fetchBudgetLeft() >= 0, `예산을 넘기지 않는다 — 남은 ${fetchBudgetLeft()}`);
  ok(calls.chart + calls.ext <= 200, `총 호출이 예산 안이다 (${calls.chart} + ${calls.ext})`);
}

/* ── v7 이 살아 있는 날: 보강할 게 없으니 거의 안 돈다(예산 낭비 없음) ── */
{
  const calls = install({ v7Dead: false });
  resetFetchBudget(200);
  await fetchBatchQuotes(SYMS, { maxFallback: SYMS.length, DB, extPriority: [], extOffset: 0, extMax: 120 });
  ok(calls.chart === 0, `v7 이 살아 있으면 폴백이 필요 없다 — ${calls.chart}회`);
  ok(calls.ext > 0 && calls.ext <= 120, `장후 값이 비어 있으니 상한 안에서 채운다 — ${calls.ext}종목(상한 120)`);
}

/* ── 예산이 거의 없으면 보강도 멈춘다(코어용 예비를 남긴다) ── */
{
  const calls = install({ v7Dead: false });
  resetFetchBudget(12);
  await fetchBatchQuotes(SYMS, { maxFallback: SYMS.length, DB, extPriority: [], extOffset: 0, extMax: 120 });
  ok(calls.ext === 0, `예산이 바닥이면 보강을 시작하지 않는다 — ${calls.ext}회(코어용 예비 보존)`);
}

/* ── 정규장에는 몫을 떼지 않는다(그때는 보강할 세션이 아니다) ── */
{
  unfreeze(); freezeET(12);   // 정규장
  const calls = install({ v7Dead: true });
  resetFetchBudget(200);
  await fetchBatchQuotes(SYMS, { maxFallback: SYMS.length, DB, extPriority: [], extOffset: 0, extMax: 120 });
  ok(calls.ext === 0, "정규장에는 시간외 보강을 안 한다");
  // 몫을 떼면 여기서 40 만큼 줄어든다 — 느슨하게 보면 그 회귀를 못 잡는다
  ok(calls.chart >= 190, `정규장 폴백은 예산을 온전히 쓴다 — ${calls.chart}종목(몫을 떼면 ~158로 준다)`);
}
unfreeze();

/* ── 상한 자체가 굶기지 않을 만큼인가 ──
   종전 24 는 v7 이 죽은 날(채울 종목이 수백인 날) 회전 한 바퀴에 20분 넘게 걸리게 했다. */
ok(EXT_ENRICH_MAX > 24, `시간외 보강 상한 ${EXT_ENRICH_MAX} — 종전 24 는 회전이 너무 느렸다`);
ok(EXT_ENRICH_MAX <= 200, `상한 ${EXT_ENRICH_MAX} 이 예산(200)을 통째로 먹지는 않는다`);

/* ── ★회전 커서가 실제로 시도한 만큼만 움직이는가★ ──
   예산에 막혀 중간에 멈췄는데 커서를 '하려던 수' 만큼 밀면, 안 해 본 종목이 통째로
   지나간 것이 된다 — 회전이 한 바퀴 돌 때마다 같은 구간이 계속 빠진다. */
{
  freezeET(17);
  const calls = install({ v7Dead: false });
  resetFetchBudget(40);                      // 보강 도중에 예산이 마르게 한다
  const out = await fetchBatchQuotes(SYMS, { maxFallback: SYMS.length, DB, extPriority: [], extOffset: 0, extMax: 120 });
  const tried = Object.getOwnPropertyDescriptor(out, "__extTried");
  const n = tried ? tried.value : null;
  ok(n != null, "호출부에 시도 수를 알려 준다(__extTried)");
  ok(n === calls.ext,
     `★커서를 실제 시도 수만큼만 민다 — 보고 ${n} · 실제 ${calls.ext}★ (하려던 수를 세면 안 해 본 종목이 영영 빠진다)`);
  ok(n < 120, `예산에 막혀 상한(120)보다 적게 했다 — ${n}종목(이 상황을 실제로 만들었다)`);
  unfreeze();
}

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
