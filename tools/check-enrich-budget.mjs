/* [V33.327] 부가조회 지갑 계약 — ★한 건이 사이클을 통째로 굶기지 못한다★
 *
 *   왜 게이트인가 (2026-09-09 운영 자가진단이 warn 3건 중 2건으로 직접 말했다):
 *     [EVAL-COST] KR 부가조회 6773/7200ms — scalp 6773ms · 느린종목 052690.KS:★7071ms★
 *     [EVAL-COST] KR 부가조회 7470/7200ms(★예산소진 14건 생략★) — scalp 7470ms
 *     [TIME-CAP]  ★72회 반복★ — KR 평가 35/446종목(8%) 후 중단
 *   지갑은 '쓰기 전' 잔액만 봤고, 한 번 시작한 조회는 얼마가 걸리든 끝까지 기다렸다.
 *   그래서 한 종목(7,071ms)이 7,200ms 예산을 혼자 비우고 뒤 종목 14개가 통째로 생략됐다.
 *
 *   이 검사는 ★실제 소스에서 함수를 꺼내 돌린다★ — 문장이 아니라 동작으로 못박는다.
 *   특히 마지막 항목이 중요하다: 거래 확정 경로(_phaseRun)에는 상한이 없어야 한다.
 *   거기에 상한을 걸면 "조회를 못 해서 확인 실패 → 진입 차단" 이라는 조용한 사고가 난다.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };

function slice(start, end) {
  const a = S.indexOf(start), b = S.indexOf(end, a);
  if (a < 0 || b < 0) throw Error("소스에서 못 찾음: " + start.trim());
  return S.slice(a, b);
}

// ── 실제 _enrichRun 을 꺼내 돌린다 ────────────────────────────────────────
const src = slice("      const _enrichRun = async function (kind, fn) {",
                  "      // [V33.172] ★거래 확정 경로는");
const PER = Number((/perCallMs:\s*(\d+)/.exec(S) || [])[1] || 0);

function makeCtx(budget) {
  const ctx = vm.createContext({
    _num: (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; },
    ENRICH: { perCallMs: PER },
    _enrich: { spent: 0, budget, skipped: 0, timedOut: 0 },
    _phase: { scalp: 0 },
    setTimeout, clearTimeout, Promise, Date, Math
  });
  vm.runInContext(src + "\n globalThis.__run = _enrichRun;", ctx);
  return ctx;
}
const sleep = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

// ① 병적으로 느린 한 건이 지갑을 통째로 비우지 않는다 (운영에서 난 그 사고)
{
  const ctx = makeCtx(7200);
  const t0 = Date.now();
  const got = await ctx.__run("scalp", () => sleep(7071, "늦게 온 값"));
  const waited = Date.now() - t0;
  if (got === undefined && waited < PER + 500 && ctx._enrich.timedOut === 1)
    ok(`7,071ms 짜리 한 건을 ${waited}ms 에서 끊는다(상한 ${PER}ms) — 지갑 잔액 ${ctx._enrich.budget - Math.round(ctx._enrich.spent)}ms 가 남는다`);
  else
    bad(`병적인 한 건을 안 끊는다(기다린 ${waited}ms · 반환 ${JSON.stringify(got)} · 상한걸림 ${ctx._enrich.timedOut})`);
}

// ② 끊고 난 뒤 ★남은 종목이 실제로 제 몫을 쓴다★ — 이게 고치려던 것이다
{
  const ctx = makeCtx(7200);
  await ctx.__run("scalp", () => sleep(7071, "느림"));
  let served = 0;
  for (let i = 0; i < 14; i++) {
    const v = await ctx.__run("scalp", () => sleep(1, "ok" + i));
    if (v !== undefined) served++;
  }
  if (served === 14) ok("한 건을 끊은 뒤 뒤따르는 14종목이 전부 조회된다(종전엔 전부 '예산소진 생략')");
  else bad(`뒤따르는 종목 ${served}/14 만 조회됐다 — 굶는 종목이 남는다`);
}

// ③ 정상 속도 조회는 그대로 값을 돌려준다(상한이 기능을 깎지 않는다)
{
  const ctx = makeCtx(7200);
  const v = await ctx.__run("scalp", () => sleep(30, "정상값"));
  if (v === "정상값" && ctx._enrich.timedOut === 0) ok("정상 조회(30ms)는 값을 그대로 돌려준다 — 상한이 평상시 동작을 바꾸지 않는다");
  else bad(`정상 조회가 깨졌다: ${JSON.stringify(v)}`);
}

// ④ 지갑이 비면 종전대로 undefined + skipped (기존 계약 보존)
{
  const ctx = makeCtx(100);
  ctx._enrich.spent = 100;
  const v = await ctx.__run("scalp", () => sleep(1, "쓰면 안 됨"));
  if (v === undefined && ctx._enrich.skipped === 1) ok("지갑이 비면 종전대로 건너뛰고 센다(기존 계약 그대로)");
  else bad("지갑 소진 시 동작이 바뀌었다");
}

// ⑤ 오류는 삼키지 않고 그대로 올린다(상한이 예외를 숨기면 실패가 조용해진다)
{
  const ctx = makeCtx(7200);
  let caught = null;
  try { await ctx.__run("scalp", async () => { throw new Error("조회실패"); }); }
  catch (e) { caught = e && e.message; }
  if (caught === "조회실패") ok("조회가 던진 오류는 그대로 올라간다 — 상한이 실패를 숨기지 않는다");
  else bad("오류가 삼켜졌다 — 실패가 조용해진다");
}

// ⑥ ★거래 확정 경로에는 상한이 없다★ — 여기 상한을 걸면 진입이 막힌다
{
  const ph = slice("      const _phaseRun = async function (kind, fn) {", "      let _evalBaseDone");
  const noCap = !/setTimeout|Promise\.race|perCallMs/.test(ph);
  if (noCap) ok("거래 확정 경로(_phaseRun)에는 상한도 지갑도 없다 — 조회 지연이 진입을 막지 않는다");
  else bad("★거래 확정 경로에 상한이 걸렸다 — 조회를 못 하면 확인 실패가 진입 차단으로 읽힌다★");
}

// ⑦ 기다린 시간은 남은 잔액을 넘지 않는다(잔액보다 더 기다릴 이유가 없다)
{
  const ctx = makeCtx(7200);
  ctx._enrich.spent = 7200 - 300;             // 잔액 300ms
  const t0 = Date.now();
  await ctx.__run("scalp", () => sleep(5000, "느림"));
  const waited = Date.now() - t0;
  if (waited < 1200) ok(`잔액 300ms 만 남았을 때 ${waited}ms 만 기다린다(상한 ${PER}ms 이 아니라 잔액이 기준)`);
  else bad(`잔액이 300ms 인데 ${waited}ms 를 기다렸다`);
}

if (fails) { console.error(`\n✗ 부가조회 지갑 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 부가조회 지갑 계약 통과 — 한 건이 사이클을 굶기지 못한다");
