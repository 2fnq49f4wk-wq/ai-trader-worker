/* ═══════════════════════════════════════════════════════════════════════════
   [V33.251] 이중헤드 — 표본을 아무리 넣어도 안 되던 이유는 표본이 아니었다
   그리고 전략 선택 — 첫 번째로 걸리는 것이 아니라 가장 나은 것을

   ■ 이중헤드 실측(featVer 14, 표본 60,000):
       [DUAL-BULL] 블록IC  0.0005  t  0.01  → 합류 보류
       [DUAL-BEAR] 블록IC −0.0190  t −0.61  → 합류 보류
     같은 피처로 트리들은 IC 0.08~0.09(t 2.52~4.74)를 낸다.
     표본 6만에 IC 가 0 이면 표본 문제가 아니다 — 사용자 관찰이 정확했다.

     원인 ①: 라벨이 종목마다 다른 질문이었다. thrPct 2.0 은 ★절대★ 문턱인데
       유니버스는 한국 421,691 + 미국 95,966 이다. 지평 10일에서 일변동성 1% 종목의
       기대이동은 3.2%, 4% 종목은 12.6% — 같은 ±2% 가 0.6σ 와 0.16σ 다.
       ★피처를 늘려도 풀리지 않는 종류의 문제다.★ 목표가 일관되지 않으면 배울 것이 없다.
     원인 ②: 선형 모델. 이 데이터에서 선형/FM 은 트리에 크게 진다(FM 47.9% vs 트리 54%).
       비선형 헤드 경합은 이미 구현돼 있었고 STACK 만 쓰고 있었다.

   ■ 전략 선택: 종전은 `A || B || C` — 우선순위지 선택이 아니다.
     confidence 로 고르면 안 된다(평가기마다 손으로 정한 식이라 비교 불가).
     ML 확률로도 안 된다(위원회는 피처를 보므로 어느 신호든 같은 p).
     전략 사이에서 비교 가능한 것은 ★그 신호가 실제로 번 돈★ 이고, 표본이 적으면 축소한다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const D = M.LUXML.featNames.length;
const ATR = M.LUXML.featNames.indexOf("atrPct");
const mkFeat = (atrPct) => { const v = new Array(D).fill(0); if (ATR >= 0) v[ATR] = atrPct; return v; };

console.log("① 라벨 문턱이 종목 변동성에 따라 움직이는가");
{
  chk(ATR >= 0, "atrPct 를 피처 이름으로 찾는다(인덱스 " + ATR + ")", "atrPct 피처가 없다 — 정규화 불가");
  const t1 = M._dualThrPct(mkFeat(1)), t5 = M._dualThrPct(mkFeat(5));
  chk(t5 > t1 * 2, "변동성 1%/일 → ±" + t1.toFixed(2) + "% · 5%/일 → ±" + t5.toFixed(2) + "% (문턱이 따라 움직인다)",
    "문턱이 종목마다 같다 — 정규화가 작동하지 않는다");
  // ★같은 질문★ 인가 — σ 단위로 환산하면 모든 변동성에서 같아야 한다
  const H = 10;
  const sig = (a) => M._dualThrPct(mkFeat(a)) / (a * Math.sqrt(H));
  const rs = [1, 2, 3, 5, 8].map(sig);
  const spread = Math.max(...rs) - Math.min(...rs);
  chk(spread < 1e-9,
    "σ 단위 문턱이 전 구간에서 동일하다(" + rs[0].toFixed(3) + "σ) — 모든 종목에 같은 질문",
    "σ 환산 문턱이 " + spread.toFixed(3) + " 만큼 흔들린다 — 여전히 종목마다 다른 질문이다");
  // 초저변동성에서 바닥이 작동하는가(호가 잡음을 라벨로 세지 않게)
  const tLow = M._dualThrPct(mkFeat(0.2));
  chk(tLow >= M.DUALHEAD.thrFloorPct - 1e-9,
    "초저변동성은 바닥 " + M.DUALHEAD.thrFloorPct + "% 에서 멈춘다(정규화가 해를 끼치는 구간 방어)",
    "바닥이 안 걸려 문턱이 " + tLow.toFixed(2) + "% 로 내려간다");
  // atrPct 를 못 읽으면 폴백
  chk(Math.abs(M._dualThrPct(mkFeat(0)) - M.DUALHEAD.thrPct) < 1e-9,
    "atrPct 를 못 읽는 행은 옛 절대문턱으로 폴백한다", "폴백이 없다");
  chk(Math.abs(M._dualThrPct(null) - M.DUALHEAD.thrPct) < 1e-9,
    "피처 벡터가 없어도 죽지 않는다", "벡터 없으면 예외");
}

console.log("② 배선 — 라벨 함수가 피처를 받는가 · 비선형이 켜졌는가 · 판이 올랐는가");
{
  chk(/_y = opts\.labelFn\(r, v\)/.test(S), "학습 경로가 labelFn 에 피처 벡터를 넘긴다",
    "labelFn 이 행만 받는다 — 변동성 정규화가 불가능하다");
  chk(/o\.labelFn\(r, v\)/.test(S), "전진검증도 같은 인자를 넘긴다(학습과 다른 라벨을 쓰면 검증이 무의미)",
    "전진검증의 라벨이 학습과 달라진다");
  const dh = S.slice(S.indexOf("async function dualHeadTrainNightly"), S.indexOf("async function dualHeadTrainNightly") + 2200);
  chk(/nonlinear: DUALHEAD\.nonlinear/.test(dh), "이중헤드가 비선형 헤드 경합을 켠다",
    "여전히 선형 고정이다 — 트리가 이기는 데이터에서 선형만 쓴다");
  chk(M.DUALHEAD.nonlinear === true, "DUALHEAD.nonlinear = true", "비선형 설정이 꺼져 있다");
  chk(/const thr = _dualThrPct\(featVec\)/.test(dh), "두 헤드가 정규화된 문턱을 쓴다", "절대 문턱이 그대로다");
  chk(M.DUALHEAD.featVer >= 2, "featVer 를 올렸다(" + M.DUALHEAD.featVer + ") — 라벨의 뜻이 바뀌었다",
    "판을 안 올렸다 — 옛 라벨 표본·모델과 섞인다");
  // 비선형 경합은 '이겨야 채택' 이다 — 공짜로 주는 게 아닌지 확인
  chk(/const _cand = \[_mk\("lin", _linP\)\]/.test(S),
    "선형이 기본 후보로 남아 있다(비선형이 못 이기면 선형 채택)",
    "선형이 후보에서 빠졌다 — 비선형을 무조건 쓰게 된다");
}

console.log("③ 전략 선택 — 무엇으로 고르는가");
{
  const mk = (name, conf) => ({ name, confidence: conf, type: "SNAP", detail: name, members: [name] });
  // (1) 이력이 좋은 쪽이 이긴다
  const stats = {
    A_GOOD: { trades: 80, wins: 48, sumPnlPct: 80 * 1.5 },   // +1.5%/건
    B_MEH:  { trades: 80, wins: 40, sumPnlPct: 80 * 0.2 },   // +0.2%/건
  };
  let r = M._pickBestSignal([mk("B_MEH", 0.80), mk("A_GOOD", 0.55)], stats);
  chk(r && r.name === "A_GOOD",
    "confidence 가 낮아도 실현기대값이 높은 쪽을 고른다(" + (r && r.name) + ")",
    "confidence 로 골랐다 — 전략 간 비교 불가능한 자를 썼다");
  chk(r && /실현기대/.test(r.pickWhy || ""), "고른 이유를 남긴다 — " + (r && r.pickWhy),
    "왜 골랐는지 기록이 없다");

  // (2) ★표본이 적은 행운은 이기지 못한다★
  const stats2 = {
    LUCKY: { trades: 6, wins: 6, sumPnlPct: 6 * 5.0 },       // +5.0%/건, n=6
    SOLID: { trades: 200, wins: 120, sumPnlPct: 200 * 1.2 }, // +1.2%/건, n=200
  };
  r = M._pickBestSignal([mk("LUCKY", 0.5), mk("SOLID", 0.5)], stats2);
  const shr = (e, n) => e * (n / (n + M.SIGPICK.shrinkK));
  chk(r && r.name === "SOLID",
    "n6 ×5.0%(축소 " + shr(5, 6).toFixed(2) + ") 가 n200 ×1.2%(축소 " + shr(1.2, 200).toFixed(2) + ") 를 못 이긴다",
    "표본 6건의 행운이 200건의 실적을 이겼다 — 축소가 작동하지 않는다");

  // (3) 지는 신호는 후보에서 빠진다
  const stats3 = { LOSER: { trades: 50, wins: 10, sumPnlPct: 50 * -2.5 }, OK: { trades: 50, wins: 28, sumPnlPct: 50 * 0.5 } };
  r = M._pickBestSignal([mk("LOSER", 0.95), mk("OK", 0.5)], stats3);
  chk(r && r.name === "OK", "실현기대 −2.5%/건 신호는 confidence 0.95 여도 제외된다",
    "지는 신호를 고른다 — 가지치기가 안 걸린다");
  chk(!M._pickBestSignal([mk("LOSER", 0.95)], stats3),
    "지는 신호만 있으면 아무것도 사지 않는다", "지는 신호밖에 없는데 진입한다");

  // (4) 이력이 전혀 없으면 confidence 가 결정한다(그리고 그때만)
  r = M._pickBestSignal([mk("NEW_A", 0.55), mk("NEW_B", 0.75)], {});
  chk(r && r.name === "NEW_B", "이력이 없으면 confidence 높은 쪽(" + (r && r.name) + ")",
    "이력 없을 때 결정이 안 된다");
  // 이력 있는 쪽이 이력 없는 쪽에 밀리지 않는가(모르는 게 아는 걸 이기면 안 된다)
  r = M._pickBestSignal([mk("NEW_HIGHCONF", 0.95), mk("A_GOOD", 0.5)], stats);
  chk(r && r.name === "A_GOOD",
    "이력 없는 고confidence 신규가 검증된 신호를 이기지 못한다",
    "모르는 전략이 아는 전략을 이겼다 — 축소 지분이 너무 작다");

  // (5) ★인정 문턱의 경계★ — 29건은 아직 '모름', 30건부터 실적으로 센다
  const nearMiss = { NEAR: { trades: M.SIGPICK.trustN - 1, wins: 20, sumPnlPct: (M.SIGPICK.trustN - 1) * 4.0 },
                     SOLID: { trades: 200, wins: 120, sumPnlPct: 200 * 1.2 } };
  r = M._pickBestSignal([mk("NEAR", 0.5), mk("SOLID", 0.5)], nearMiss);
  chk(r && r.name === "SOLID",
    "인정문턱 " + M.SIGPICK.trustN + " 미만(" + (M.SIGPICK.trustN - 1) + "건 ×4.0%)은 아직 실적으로 안 센다",
    "문턱 아래 이력이 이미 실적처럼 쓰인다");
  const justOver = { NEAR: { trades: M.SIGPICK.trustN, wins: 22, sumPnlPct: M.SIGPICK.trustN * 4.0 },
                     SOLID: { trades: 200, wins: 120, sumPnlPct: 200 * 1.2 } };
  r = M._pickBestSignal([mk("NEAR", 0.5), mk("SOLID", 0.5)], justOver);
  chk(r && r.name === "NEAR",
    "문턱을 넘으면(" + M.SIGPICK.trustN + "건) 실적으로 세어 더 나은 쪽이 이긴다",
    "문턱을 넘어도 실적이 반영되지 않는다");
  // ★비대칭★ — 빼는 문턱은 낮고 인정하는 문턱은 높다
  chk(M.SIGPICK.pruneN < M.SIGPICK.trustN,
    "가지치기 문턱(" + M.SIGPICK.pruneN + ") < 인정 문턱(" + M.SIGPICK.trustN + ") — 비용이 다르므로 자도 다르다",
    "두 문턱이 같다 — 지는 신호를 빼는 비용과 이기는 신호를 인정하는 비용은 다르다");
  const smallLoss = { L2: { trades: M.SIGPICK.pruneN, wins: 0, sumPnlPct: M.SIGPICK.pruneN * -3.0 } };
  chk(!M._pickBestSignal([mk("L2", 0.9)], smallLoss),
    "지는 신호는 " + M.SIGPICK.pruneN + "건만 있어도 뺀다(인정은 " + M.SIGPICK.trustN + "건 필요)",
    "적은 표본의 손실 신호를 그대로 쓴다");

  chk(!M._pickBestSignal([], {}) && !M._pickBestSignal(null, {}), "후보가 없으면 null", "빈 후보에서 죽는다");
}

console.log("④ 배선 — 우선순위가 아니라 선택인가");
{
  const ev = S.slice(S.indexOf("function evaluateAllStrategies"), S.indexOf("function evaluateAllStrategies") + 3500);
  chk(!/evaluateIndexFlowEntry\([^)]*\)\s*\n?\s*\|\|/.test(ev),
    "`A || B || C` 우선순위 사슬이 사라졌다",
    "여전히 첫 번째로 걸리는 것을 쓴다 — 선택이 아니다");
  chk(/_pickBestSignal\(_cands/.test(ev), "후보를 모아 _pickBestSignal 로 고른다", "선택기를 호출하지 않는다");
  const pushes = (ev.match(/_push\(evaluate/g) || []).length;
  chk(pushes === 5, "다섯 평가기 전부가 후보에 들어간다(" + pushes + "/5)",
    "후보에 " + pushes + "개만 들어간다 — 나머지는 평가조차 안 된다");
  // 켈리는 그대로인가 — 사용자가 명시적으로 버리지 말라고 한 것
  chk(/_md\.sizeMult = _md\.allow \? mlKellySize\(_md\.p, _md\.uncertainty\) : 1/.test(S),
    "켈리 사이징이 그대로 살아 있다(선택은 '무엇을', 켈리는 '얼마나')",
    "켈리 사이징이 사라졌다 — 선택과 크기는 다른 층이다");
  chk(/signal\.sizeMult/.test(S) && /mlKellySize/.test(S),
    "신호 배율(변동성 타겟)과 켈리 배율이 둘 다 남아 있다", "두 사이징 층 중 하나가 사라졌다");
}

console.log(fails ? "\n✗ 이중헤드·전략선택 검사 " + fails + "건 실패" : "\n✓ 이중헤드·전략선택 검사 통과");
process.exit(fails ? 1 : 0);
