/* [V33.342] 야간 파이프라인 — ★"다시 오겠다"고 말한 단계가 실제로 다시 오는가★
 *
 *   V33.337 은 단계(_stg)가 "아직 준비 안 됐다"를 말할 수 있게 했다: ⟳ 를 돌려주면
 *   완료 도장 대신 12분짜리 '대기' 표식을 찍고 같은 날 다시 돈다.
 *   ★그런데 파이프라인 전체는 끝에서 ai_trained_day 를 무조건 찍었다.★
 *   진입 게이트가 `_aiLast !== _aiDay` 이므로, 도장이 찍히는 순간 그날은 닫힌다 —
 *   대기 중인 단계가 남아 있어도 다시 들어올 길이 없다.
 *   단계에 "다시 오겠다"고 말할 권한을 줘 놓고 문을 잠근 셈이다.
 *
 *   ★실측(2026-09-10 11:41 UTC 프로브)★ V33.339 배포 5.5시간 뒤에도
 *   "committee_cal featVer 불일치(15≠17) — 확률 보정 무시 중" 이 그대로였다.
 *   보정 단계는 ⟳ 를 정상적으로 돌려주고 있었는데 재시도를 허락하는 쪽이 없었다.
 *   즉 두 판(15→16→17)에 걸쳐 위원회 확률 보정이 꺼져 있었다.
 *
 *   ※ 이 검사는 ★문자열이 아니라 동작★ 을 본다. V33.337 이 배운 것이다 —
 *     소스에 조건이 적혀 있는지만 보면 `if(false)` 로 죽여도 통과한다.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };

// ── ① 배선 확인(최소한) ────────────────────────────────────────────────
{
  if (/const _partial = await getState\(env\.DB, "ai_pipe_partial", null\);/.test(S))
    ok("진입 게이트가 부분 완주 상태를 읽는다");
  else bad("★진입 게이트가 부분 완주를 모른다★ — 도장이 찍히면 그날은 영영 닫힌다");
  if (/if \(\(_aiLast !== _aiDay \|\| _resume\) && !_aiLockFresh\)/.test(S))
    ok("대기 단계가 있으면 도장이 있어도 다시 들어온다");
  else bad("★진입 조건이 아직 도장만 본다★");
  if (/_v\.indexOf\(_aiDay \+ "\|wait\|"\) === 0/.test(S))
    ok("완주 직전에 ★대기 표식이 남은 단계★ 를 실제로 센다");
  else bad("★대기 단계를 세지 않는다★ — 무엇이 안 끝났는지 모르는 채 닫는다");
  if (/_waitStages\.length > 0 && !_tooLong/.test(S))
    ok("대기가 있으면 ai_trained_day 를 찍지 않는다");
  else bad("★대기가 있어도 완료 도장을 찍는다★ — V33.337 이 고친 결함이 그대로다");
  if (/6 \* 3600000/.test(S) && /6시간째 준비 대기/.test(S))
    ok("무한정 열어 두지 않는다 — 6시간 상한, 그리고 ★누가 못 끝냈는지 이름을 적는다★");
  else bad("★상한이 없거나 조용히 닫는다★ — 하루 단위 작업이 밀리거나 원인이 안 남는다");
}

// ── ② ★실제로 돌려 본다★ — 조건식을 ★소스에서 뽑아★ 상태기계를 굴린다 ──
{
  /* 조건을 이 파일에 다시 적으면, 소스가 바뀔 때 검사만 옛 조건을 지키게 된다
     (그러면 통과해도 아무것도 보증하지 않는다). 그래서 ★소스의 그 줄을 읽어★ 평가한다. */
  const grab = (re, what) => {
    const m = S.match(re);
    if (!m) { bad(`★${what} 을 소스에서 못 찾았다 — 이 검사가 헛돈다★`); return null; }
    return m[1];
  };
  const eToday = grab(/const _partialToday = ([^\n]+);/, "_partialToday 식");
  const eCool  = grab(/const _partialCool = ([^\n]+);/, "_partialCool 식");
  const eResume = grab(/const _resume = ([^\n]+);/, "_resume 식");
  const eEnter = grab(/if \(\(([^\n]+?)\) && !_aiLockFresh\) \{/, "진입 조건식");
  if (eToday && eCool && eResume && eEnter) {
    const day = "2026-09-10";
    const enter = (partial, aiLast, lockFresh, now) => {
      const ctx = {
        _partial: partial, _aiDay: day, _aiLast: aiLast, _aiLockFresh: lockFresh,
        _num: (v, d) => (typeof v === "number" && isFinite(v)) ? v : d,
        Date: { now: () => now }, isFinite
      };
      vm.createContext(ctx);
      return !!vm.runInContext(
        `const _partialToday = ${eToday};` +
        `const _partialCool = ${eCool};` +
        `const _resume = ${eResume};` +
        `(${eEnter}) && !_aiLockFresh;`, ctx);
    };
    const T0 = 1760000000000;
    const P = { day: day, ts: T0, openedAt: T0, n: 1 };
    const cases = [
      [enter(null, null, false, T0), true, "오늘 아직 안 돌았으면 들어간다(종전 동작)"],
      [enter(null, day, false, T0), false, "완주했고 대기가 없으면 다시 안 들어간다(종전 동작 보존 — CPU 를 안 태운다)"],
      [enter(P, day, false, T0 + 60000), false, "부분 완주 직후 1분은 쉰다 — 매분 재진입하지 않는다"],
      [enter(P, day, false, T0 + 7 * 60000), true, "6분 지나면 ★대기 단계를 이어서 돌러 다시 들어온다★"],
      [enter(P, day, true, T0 + 7 * 60000), false, "락이 살아 있으면 겹쳐 돌지 않는다"],
      [enter({ day: "2026-09-09", ts: T0, openedAt: T0 }, day, false, T0 + 7 * 60000), false,
       "어제의 부분 완주 기록으로는 오늘 재진입하지 않는다"]
    ];
    for (const [got, want, label] of cases) {
      if (got === want) ok(label);
      else bad(`★${label} — 실제로는 ${got ? "들어간다" : "안 들어간다"}★`);
    }
  }
}

// ── ③ 보정 단계가 ⟳ 를 실제로 돌려주는가(그래야 위가 의미를 가진다) ────
{
  const i = S.indexOf("async function mlCalibrateCommittee(DB)");
  const j = S.indexOf("async function", i + 40);
  const blk = (i >= 0 && j > i) ? S.slice(i, j) : "";
  const waits = (blk.match(/return "\\u27F3 " \+ "\[CAL\]/g) || []).length;
  if (waits >= 3) ok(`보정 단계의 이탈 경로 ${waits}곳이 재시도를 요청한다`);
  else bad(`★보정 단계가 재시도를 ${waits}곳에서만 요청한다★ — 나머지는 완료로 찍힌다`);
}

if (fails) { console.error(`\n✗ 파이프라인 재개 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 파이프라인 재개 통과 — '다시 오겠다'고 말한 단계는 실제로 다시 온다");
