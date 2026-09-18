/* [V33.384] 자동 재학습 트리거가 ★자기 자신을 영구 발동시키지 않는가.★
 *
 *   ★왜★ 실측 청구서가 이걸 가리켰다.
 *   워커 `_luxAutoRetrainModal` 은 외부 모델이 낡으면 GitHub 워크플로를 `run_now: true`
 *   로 디스패치한다 — ★52분짜리 GPU 회차 한 판★ 이다. 그 조건이 종전에는
 *       oldestAge(가장 ★오래된★ 외부 모델의 나이) > 14h
 *   였다. 그런데 Modal 회차는 예산 안에서 단계를 ★회전★ 시키므로 가장 오래된 모델은
 *   언제나 회전 주기(실측 24~31시간)만큼 묵어 있다 — 즉 ★구조적으로 영구 참★ 이다.
 *
 *   결과: 예약 크론 4회/일 + 자동 트리거(쿨다운 8h) 최대 3회/일 = 하루 최대 7회 × 52분
 *         ≈ 월 180 GPU시간 → 약 $106/월.
 *         실제 청구: 2026-09-01~18 에 $65.15 = 월 $108 환산. ★계산이 실측과 맞는다.★
 *   굶주림(W-3)이 ★비용 폭주를 만드는 되먹임 고리★ 였다.
 *
 *   ★고치되 안전망은 무디게 만들지 않는다.★ 둘은 전혀 다른 사건이다:
 *     · 가장 ★신선한★ 모델이 낡았다 → 학습 자체가 안 돈다(진짜 사고) → 트리거해야 한다
 *     · 가장 ★오래된★ 모델만 낡았다 → 회전이 아직 차례를 안 줬다(정상)   → 트리거하면 안 된다
 *   이 검사는 판정식을 ★떼어 내 실제로 돌려★ 네 경우를 모두 확인한다.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const S = readFileSync(join(root, "src/index.js"), "utf8");
const PY = readFileSync(join(root, "trainer/modal/modal_train.py"), "utf8");
const M = await import("../src/index.js");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.error("  ✗ FAIL " + m); } };

/* 판정식을 소스에서 그대로 떼어 온다 — 옮겨 적으면 언젠가 갈라진다. */
const m = /if \(anyExt && !missingExt && !staleFV && ([^)]+)\) \{ meta\.lastOk = now;/.exec(S);
ok(!!m, "트리거 판정식을 소스에서 떼어 왔다");
if (!m) { console.error("\n✗ 판정식을 못 찾는다 — 검사가 헛돈다"); process.exit(1); }
const COND = m[1];
console.log(`\n     판정식(트리거 안 함 조건): anyExt && !missingExt && !staleFV && ${COND}\n`);

const decide = new Function("anyExt", "missingExt", "staleFV", "freshestAge", "oldestAge", "MODALAUTO",
  `return !(anyExt && !missingExt && !staleFV && ${COND});`);   // true = 트리거한다
const P = M.MODALAUTO;

const cases = [
  // [이름, anyExt, missingExt, staleFV, freshest, oldest, 트리거해야 하나]
  ["학습이 아예 안 돈다(신선한 것도 낡음)", true, false, 0, 40, 60, true],
  ["회전 중 — 신선한 건 최근, 오래된 건 묵음", true, false, 0, 6, 31, false],
  ["회전 중 — 오래된 것이 아주 묵음(48h)", true, false, 0, 6, 48, false],
  ["모델이 아예 없다", false, false, 0, 0, 0, true],
  ["일부 모델이 빠졌다", true, true, 0, 1, 2, true],
  ["판(featVer) 불일치", true, false, 1, 1, 2, true],
  ["전부 신선", true, false, 0, 2, 5, false],
  ["문턱 바로 위", true, false, 0, P.staleH + 0.1, P.staleH + 0.1, true],
  ["문턱 바로 아래", true, false, 0, P.staleH - 0.1, 99, false],
];
for (const [name, a, mi, sf, fr, ol, want] of cases) {
  const got = decide(a, mi, sf, fr, ol, P);
  ok(got === want, `${name}: 트리거 ${got ? "O" : "X"} (기대 ${want ? "O" : "X"})`);
}

/* ★핵심★ — 회전만으로는 절대 발동하지 않는가. oldestAge 를 크게 흔들어도 판정이 안 바뀐다. */
{
  const flips = [];
  for (const ol of [15, 24, 31, 48, 72, 168]) {
    if (decide(true, false, 0, 3, ol, P)) flips.push(ol);
  }
  ok(flips.length === 0,
     flips.length ? `★회전만으로 트리거된다★ — oldestAge ${flips.join("/")}h 에서 발동(비용 폭주 재발)`
                  : "★가장 오래된 모델이 아무리 묵어도 회전만으로는 트리거되지 않는다★ (15~168h 전부 확인)");
}

// 구조 — 판정이 freshestAge 를 쓰고, oldestAge 는 기록만 하는가
ok(/freshestAge <= MODALAUTO\.staleH/.test(S), "판정이 ★가장 신선한 모델★ 기준이다");
ok(!/oldestAge <= 14/.test(S), "옛 조건(oldestAge <= 14)이 남아 있지 않다");
ok(/meta\.oldestAgeH = \+oldestAge\.toFixed\(1\)/.test(S), "oldestAge 는 ★기록은 계속한다★(회전이 느려진 것은 따로 봐야 한다)");
ok(/inputs: \{ run_now: "true" \}/.test(S), "트리거는 여전히 실제 학습 1회를 건다(안전망이 무뎌지지 않았다)");
ok(typeof P.staleH === "number" && P.staleH > 0 && P.staleH <= 24,
   `문턱 ${P.staleH}h 가 1~24h 안이다 — 너무 길면 진짜 사고를 늦게 안다`);

/* ★크론과 문턱이 서로 말이 되는가.★ 학습 주기보다 문턱이 짧으면 정상 동작이 사고로 읽힌다. */
{
  const c = /modal\.Cron\("(\d+) \*\/(\d+) \* \* \*"\)/.exec(PY);
  ok(!!c, "Modal 크론을 읽었다");
  if (c) {
    const everyH = Number(c[2]);
    console.log(`\n     Modal 크론 ${everyH}시간마다 · 트리거 문턱 ${P.staleH}h\n`);
    ok(P.staleH >= everyH,
       `★문턱(${P.staleH}h) ≥ 학습 주기(${everyH}h)★ — 짧으면 정상 주기가 매번 '사고' 로 읽혀 추가 회차를 부른다`);
  }
}

if (fail) { console.error(`\n✗ 자동 재학습 고리 계약 ${fail}건 실패 (총 ${n})`); process.exit(1); }
console.log(`\n✓ 자동 재학습 고리 계약 통과 (${n}개 단언) — ★회전이 비용을 부르지 않는다★`);
