/* ═══════════════════════════════════════════════════════════════════════════
   [V33.255] 신호 이름 대장(臺帳) — 선언과 실재가 갈라지는 것을 막는다

   두 방향으로 갈라져 있었다.

   ■ 방향 ① 실재하지 않는 이름이 설정에 있었다
       phaseAdapt.breakoutSigs 에 "TR_52W", revertSigs 에 "SN_OVERSOLD".
       이 두 이름을 내보내는 평가기가 저장소에 없다. V33.44 에서 목록을 처음 쓸 때
       코드를 보지 않고 기억으로 적었기 때문이다. 같은 이유로 그때 이미 존재하던
       TR_SQUEEZE·TR_RS_LEADER 는 빠졌다. 결과: 실재 신호는 틸트에서 제외되고
       허구가 자리를 차지했다. 조용히 아무 일도 일어나지 않으므로 로그로는 안 잡힌다.

   ■ 방향 ② 실재하는 이름이 대장에 없었다 — 이쪽이 훨씬 무겁다
       executeSell 의 성과 누적은 `SIGNAL_TYPES.indexOf(entrySignalName) >= 0` 로 잠긴다.
       V33.250·254 에서 넣은 신규 6종이 SIGNAL_TYPES 에 없었다 → signal_type_stats 에
       한 건도 안 쌓임 → signalExpectancy 영원히 null → _pickBestSignal 에서
       가지치기는 절대 안 걸리고 점수는 shrunk 0 + tie 만 남는다.
       즉 "실현 기대값으로 고른다" 가 ★손으로 적은 confidence 비교★ 로 퇴화한다.
       표본을 기다리면 되는 문제가 아니라 영원히 쌓이지 않는 구조였다.

   그래서 이 검사는 텍스트를 맞춰보지 않는다. 평가기 본문에서 실제로 내보내는
   이름을 뽑아내고, 그 집합과 대장을 양방향으로 대조한다. 마지막에는 대장에 없을 때
   선택기가 어떻게 퇴화하는지를 ★실행해서★ 보인다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* 함수 본문을 중괄호 균형으로 잘라낸다 — 정규식으로 "대충" 자르면 옆 함수를 먹는다 */
function bodyOf(fname) {
  const i = S.indexOf("\nfunction " + fname + "(");
  if (i < 0) return null;
  const j = S.indexOf("{", i);
  let d = 0, k = j;
  for (; k < S.length; k++) { const c = S[k]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
  return S.slice(j, k + 1);
}
/* 주석 줄은 뺀다 — 설명문에 적힌 이름을 '내보낸다' 고 세면 이 검사도 같은 병에 걸린다 */
const stripComments = (t) => t.split("\n").filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
const emitsOf = (fname) => {
  const b = bodyOf(fname);
  if (b == null) return null;
  return [...new Set([...stripComments(b).matchAll(/name:\s*"([A-Z][A-Z0-9_]*)"/g)].map(m => m[1]))];
};

/* ── 살아 있는 주식 진입 파이프라인에서 도달 가능한 평가기들 ────────────────
   evaluateAllStrategies 본문이 실제로 부르는 것 + 분봉 단타(별도 호출부).
   목록을 손으로 적지 않는다 — 본문에서 호출되는 evaluate*Entry 를 긁어온다. */
const ALL = bodyOf("evaluateAllStrategies");
if (ALL == null) { console.log("  FAIL evaluateAllStrategies 를 찾지 못했다"); process.exit(1); }
const liveEvals = [...new Set([...stripComments(ALL).matchAll(/\b(evaluate[A-Za-z]*Entry)\s*\(/g)].map(m => m[1]))];
liveEvals.push("evaluateScalpEntry");   // 단타는 사이클 루프에서 직접 부른다(18085 부근)

console.log("① 파이프라인이 실제로 부르는 평가기를 찾는다");
{
  chk(liveEvals.length >= 8, "진입 평가기 " + liveEvals.length + "개 (" + liveEvals.join(", ") + ")",
    "평가기를 " + liveEvals.length + "개밖에 못 찾았다 — 호출부 구조가 바뀌었다");
  chk(/_push\(evaluate/.test(ALL), "신규 전략군이 후보 풀(_push)로 들어간다", "후보 풀 배선이 사라졌다");
}

console.log("\n② 성과 누적이 정말 SIGNAL_TYPES 로 잠겨 있는가");
{
  // 이 전제가 깨지면 아래 ③ 의 계약 자체가 무의미해진다. 전제를 먼저 확인한다.
  chk(/SIGNAL_TYPES\.indexOf\(entrySignalName\)\s*>=\s*0/.test(S),
    "executeSell 의 signal_type_stats 누적이 SIGNAL_TYPES 화이트리스트로 잠긴다",
    "누적 조건이 SIGNAL_TYPES 가 아니다 — 이 검사의 전제가 무너졌다");
  chk(/for\s*\(const name of SIGNAL_TYPES\)/.test(S),
    "applySignalTypeWeights 도 SIGNAL_TYPES 만 돈다(가중 산출 대상)",
    "가중 산출이 SIGNAL_TYPES 를 돌지 않는다");
}

console.log("\n③ 살아 있는 신호는 예외 없이 대장에 있는가 (없으면 학습층이 죽는다)");
{
  const REG = M.SIGNAL_TYPES;
  const missing = [];
  const seen = [];
  for (const fn of liveEvals) {
    const names = emitsOf(fn);
    if (names == null) { console.log("  FAIL " + fn + " 본문을 찾지 못했다"); fails++; continue; }
    for (const n of names) { seen.push(n); if (REG.indexOf(n) < 0) missing.push(n + "(" + fn + ")"); }
  }
  chk(seen.length >= 17, "살아 있는 신호 이름 " + seen.length + "개를 평가기 본문에서 뽑았다",
    "신호를 " + seen.length + "개밖에 못 뽑았다 — 추출이 깨졌다");
  chk(missing.length === 0,
    "전부 SIGNAL_TYPES 에 등재돼 있다 — 실현 기대값·가지치기가 모든 전략에 적용된다",
    "대장에 없는 신호: " + missing.join(", ") + " → 이 전략들은 signal_type_stats 가 영원히 비고, " +
    "_pickBestSignal 이 confidence 비교로 퇴화한다");
  for (const n of ["XR_FLOW", "VT_TREND", "VS_REV", "PR_OU", "XS_ARB", "HA_REV"])
    chk(REG.indexOf(n) >= 0, "신규 " + n + " 등재", "신규 " + n + " 누락");
}

console.log("\n④ 설정에 적힌 이름이 실재하는가 (허구 금지)");
{
  const pa = M.AI_PARAMS.phaseAdapt;
  const declared = [...(pa.breakoutSigs || []), ...(pa.revertSigs || [])];
  // 실재 집합에는 폴백 전용 스윙(SW_*)도 포함한다 — 파이프라인 밖이지만 실재하는 이름이다.
  const real = new Set();
  for (const fn of [...liveEvals, "evaluateBuySignals_swing"]) for (const n of (emitsOf(fn) || [])) real.add(n);
  const ghosts = declared.filter(n => !real.has(n));
  chk(ghosts.length === 0,
    "돌파/회귀 분류 " + declared.length + "개가 전부 실재하는 신호다",
    "내보내는 평가기가 없는 허구 이름: " + ghosts.join(", ") + " → 그 자리는 영원히 매칭되지 않는다");
  chk(pa.revertSigs.indexOf("SN_RSI2") >= 0,
    "SN_RSI2 가 회귀 계열로 분류돼 있다(원장 켈리 최상위 신호가 보합장 가산을 받는다)",
    "SN_RSI2 가 어느 쪽에도 없다 — SN 계열은 이것 하나뿐인데 틸트에서 빠진다");
  chk(pa.breakoutSigs.indexOf("TR_SQUEEZE") >= 0,
    "TR_SQUEEZE 가 돌파 계열로 분류돼 있다(price > bbPrev.upper 로만 나간다)",
    "TR_SQUEEZE 가 분류돼 있지 않다");
}

console.log("\n⑤ 등재 여부가 실제로 선택을 바꾸는가 — 실행해서 본다");
{
  // 같은 후보 둘. A 는 confidence 가 낮지만 실현 성적이 좋고, B 는 confidence 만 높다.
  const A = { name: "AAA", confidence: 0.55, weight: 1 };
  const B = { name: "BBB", confidence: 0.80, weight: 1 };
  const statsBoth = { AAA: { trades: 60, wins: 40, sumPnlPct: 120 },   // 평균 +2.0%/건
                      BBB: { trades: 60, wins: 20, sumPnlPct: -30 } }; // 평균 −0.5%/건
  const withStats = M._pickBestSignal([A, B], statsBoth);
  chk(withStats && withStats.name === "AAA",
    "대장에 있어 통계가 쌓이면 → 실현 +2.0%/건 인 AAA 를 고른다(confidence 가 낮아도)",
    "통계가 있는데도 confidence 높은 쪽을 골랐다 — 선택 기준이 기대값이 아니다");

  const noStats = M._pickBestSignal([A, B], {});
  chk(noStats && noStats.name === "BBB",
    "대장에 없어 통계가 안 쌓이면 → confidence 만 남아 BBB 로 퇴화한다(★이것이 버그의 모습★)",
    "통계 없이도 AAA 를 골랐다 — 퇴화 경로 재현 실패");

  // 지는 전략의 자동 가지치기도 통계가 있어야만 걸린다
  const pruned = M._pickBestSignal([{ name: "CCC", confidence: 0.9, weight: 1 }],
    { CCC: { trades: 40, wins: 5, sumPnlPct: -160 } });   // 평균 −4.0%/건
  chk(pruned === null,
    "실현 −4.0%/건 인 신호는 confidence 0.9 여도 가지치기된다(hardFloorExp " + M.SIGPICK.hardFloorExp + ")",
    "지는 신호가 살아남았다 — 가지치기가 작동하지 않는다");
  const notPruned = M._pickBestSignal([{ name: "CCC", confidence: 0.9, weight: 1 }], {});
  chk(notPruned !== null,
    "같은 신호도 통계가 없으면 가지치기가 걸리지 않는다 — 등재 없이는 자가차단도 없다",
    "통계 없이 가지치기가 걸렸다 — 재현 실패");
}

console.log(fails === 0 ? "\n✓ 신호 대장 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
