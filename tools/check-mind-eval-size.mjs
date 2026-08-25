/* ═══════════════════════════════════════════════════════════════════════════
   [V33.248] ★위원장이 600행으로 심사받고 있었다★ — 학습 크기와 평가 크기의 분리

   화면은 "MIND 미학습 · 위원장 부재" 를 계속 띄웠고, 로그는 이유를 적고 있었다:

     [MIND] ⚠️ 회귀가드 발동 — 신규 valAcc 54.0%(하한 41.1%)가
            다수클래스 기준 50.4%보다 크게 낮아 발행 거부

   valAcc 54.0% 인데 Wilson 하한이 41.1% 다. 12.9%p 차이는 표본이 적다는 뜻이고,
   실제로 이렇게 적었다:

     trainWindow 15,000 →(val ×0.2) 3,000 →(메타 뒤40%) 1,200 →(τ* 뒤절반) 600
     600 × 고유도 0.0667 = ★유효 40건★  →  하한 41.2%   (관측 41.1% 와 일치)

   표본풀은 518,000건이다. 그런데 위원장은 600행으로 심사받았다.

   ■ 고유도는 범인이 아니다
   0.0667 은 정상값이다 — 일봉·10일 라벨 지평이면 한 종목의 ±10일 창에 15봉쯤이 겹치니
   1/15 가 맞다. 여기를 건드리는 것은 자를 휘는 것이지 고치는 게 아니다.

   ■ 범인은 한 상수에 묶인 두 가지 크기다
   trainWindow 는 FM(고정 20에폭 SGD)이 CPU 예산 안에 ★수렴★ 하는 크기로 정해졌다.
   V12.38·V32.6 이 60000·25000 에서 미수렴을 겪고 두 번 되돌린 근거가 그것이고,
   학습에 대해서는 옳은 판단이다. 그런데 같은 상수가 ★평가 표본 수★ 도 정했다 —
   평가는 전방계산뿐이라 비용이 전혀 다른데도.
   게다가 검증분을 쓰는 두 소비자가 필요 이상으로 먹고 있었다:
     · 메타 = 파라미터 3~4개짜리 로지스틱인데 1,800행
     · τ*  = 36분위 중 하나 고르기인데 600행
   남는 행은 전부 하한을 좁히는 데 써야 한다.

   여기서 지키는 것:
     · 평가 표본이 하한을 잴 수 있는 크기인가
     · ★FM 학습량은 그대로인가★ (창만 키우면 V12.38 의 미수렴이 재발한다 — 짝으로 움직인다)
     · 작은 풀에서는 종전과 동작이 완전히 같은가(상한이 안 걸린다)
     · 고유도 계산은 손대지 않았는가 (그쪽을 고치는 것은 오답이다)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

// ── 소스에서 상수를 읽는다(값을 게이트에 베끼면 드리프트한다) ──
const MINDSRC = S.slice(S.indexOf("const MIND = {"), S.indexOf("};", S.indexOf("const MIND = {")));
const num = (k) => { const m = new RegExp(k + ":\\s*([0-9.]+)").exec(MINDSRC); return m ? Number(m[1]) : null; };
const TW = num("trainWindow"), VF = num("fmValFrac"), FMMAX = num("fmMaxSamples");
const MCAP = num("metaTrainCap"), TCAP = num("tauCalibCap");

// ── 소스의 분할 식을 그대로 옮긴 흐름 계산기 ──
function flow(tw, metaCap, tauCap) {
  const nVal = Math.max(24, Math.floor(tw * VF));
  const mCut = Math.max(10, Math.min(Math.floor(nVal * 0.6), metaCap));
  const mEval = nVal - mCut;
  const halfE = Math.max(1, Math.min(Math.floor(mEval / 2), tauCap));
  const evalR = (halfE >= 20 && mEval - halfE >= 20) ? mEval - halfE : mEval;
  return { nVal, mCut, mEval, halfE, evalR, train: tw - nVal };
}
function wilsonLB(acc, n, z) {   // 소스와 같은 식(z=1.64)
  if (!(n > 0)) return 0; z = z || 1.64;
  const z2 = z * z, den = 1 + z2 / n, cen = acc + z2 / (2 * n);
  const rad = z * Math.sqrt((acc * (1 - acc) + z2 / (4 * n)) / n);
  return Math.max(0, (cen - rad) / den);
}
const effN = (n, u) => (!(n > 0) ? 0 : (!(u > 0) || u >= 1 ? n : Math.max(8, Math.round(n * u))));
const UBAR = 0.0667, ACC = 0.540, MAJ = 0.504, FLOOR = MAJ - 0.03;

console.log("① 실측 재현 (옛 상수로 하한 41.1% 가 나오는가)");
{
  const old = flow(15000, 1e9, 1e9);         // 상한이 없던 종전 동작
  chk(old.evalR === 600, "옛 흐름: 15,000 → val 3,000 → 메타평가 1,200 → 평가 " + old.evalR + "행",
    "옛 흐름 재현 실패(평가 " + old.evalR + "행) — 원인 진단이 틀렸다");
  const oldN = effN(old.evalR, UBAR), oldLB = wilsonLB(ACC, oldN);
  chk(Math.abs(oldLB * 100 - 41.1) < 1.5,
    "유효 " + oldN + "건 → 하한 " + (oldLB * 100).toFixed(1) + "% (관측 41.1%)",
    "재현값 " + (oldLB * 100).toFixed(1) + "% 가 관측 41.1% 와 다르다");
  chk(oldLB < FLOOR, "옛 상태는 통과선 " + (FLOOR * 100).toFixed(1) + "% 미달 — 거부가 재현된다",
    "옛 상태가 통과한다 — 관측(거부)과 어긋난다");
}

console.log("② 지금 — 하한을 잴 수 있는 크기인가");
{
  const now = flow(TW, MCAP, TCAP);
  const nEff = effN(now.evalR, UBAR), lb = wilsonLB(ACC, nEff);
  console.log("   흐름: " + TW + " → val " + now.nVal + " → 메타학습 " + now.mCut +
    " / 평가 " + now.mEval + " → τ* " + now.halfE + " → 평가 " + now.evalR + "행 · 유효 " + nEff + "건");
  chk(now.evalR >= 3000, "정직 평가 표본 " + now.evalR + "행 (종전 600행)",
    "평가 표본이 " + now.evalR + "행뿐이다 — 하한이 여전히 표본부족으로 무너진다");
  chk(nEff >= 150, "유효표본 " + nEff + "건 — 고유도 할인 뒤에도 측정 가능한 크기",
    "유효표본 " + nEff + "건 — 여전히 우연과 구분되지 않는다");
  chk(lb > FLOOR, "같은 valAcc 54.0% 에서 하한 " + (lb * 100).toFixed(1) + "% > 통과선 " + (FLOOR * 100).toFixed(1) + "%",
    "하한 " + (lb * 100).toFixed(1) + "% 로 여전히 거부된다");
  // ★문턱을 낮춘 게 아니라는 것★ — 진짜 나쁜 모델은 여전히 걸려야 한다
  const badLB = wilsonLB(0.470, nEff);
  chk(badLB < FLOOR,
    "다수클래스에 못 미치는 모델(47.0%)은 이 크기에서도 여전히 거부된다(하한 " + (badLB * 100).toFixed(1) + "%)",
    "나쁜 모델까지 통과한다 — 표본을 늘린 게 아니라 게이트를 연 것이다");
}

console.log("③ FM 학습량 — 창을 키워도 그대로인가 (V12.38 미수렴 재발 방지)");
{
  const now = flow(TW, MCAP, TCAP);
  const fmRows = Math.min(now.train, FMMAX);
  const oldFm = Math.min(flow(15000, 1e9, 1e9).train, 15000);   // 종전 실효 FM 학습량
  chk(FMMAX <= now.train,
    "fmMaxSamples(" + FMMAX + ") 가 train(" + now.train + ") 을 실제로 자른다 — 상한이 놀지 않는다",
    "fmMaxSamples(" + FMMAX + ") 가 train(" + now.train + ") 보다 커서 무력하다 — FM 이 " + now.train + "행을 받는다");
  chk(fmRows === oldFm,
    "FM 이 보는 행 수 " + fmRows + " = 종전 " + oldFm + " — CPU 중립",
    "FM 학습량이 " + oldFm + " → " + fmRows + " 로 바뀐다 — 수렴 실패가 재발할 수 있다");
  chk(/fmMaxSamples && fmTrain\.length > MIND\.fmMaxSamples/.test(S),
    "FM 학습분만 잘라 쓰는 경로가 살아 있다",
    "FM 학습 캡 경로가 사라졌다");
}

console.log("④ 작은 풀 무회귀 · 고유도 불변");
{
  // 검증분이 작으면 상한이 안 걸려 종전과 완전히 같아야 한다
  for (const tw of [500, 2000, 6000]) {
    const a = flow(tw, MCAP, TCAP), b = flow(tw, 1e9, 1e9);
    chk(a.evalR === b.evalR && a.mCut === b.mCut,
      "풀 " + tw + ": 상한이 걸리지 않아 종전과 동일(평가 " + a.evalR + "행)",
      "풀 " + tw + "에서 동작이 달라졌다(" + b.evalR + " → " + a.evalR + ") — 작은 풀 회귀");
  }
  // ★고유도 쪽은 손대지 않았다★ — 그걸 고치는 것이 오답이었다
  chk(/_clamp\(s \/ Math\.max\(1, w\.length\), 0\.02, 1\)/.test(S),
    "풀 고유도 계산이 그대로다(자를 휘지 않았다)",
    "고유도 계산이 바뀌었다 — 표본이 적은 문제를 자를 휘어 덮은 것이다");
  chk(/return Math\.max\(8, Math\.round\(nn \* u\)\)/.test(S),
    "유효표본수 = n × 평균고유도 관계가 그대로다",
    "_effN 이 바뀌었다 — 하한을 인위적으로 좁힌 것이다");
  chk(/valN = _effN\(evalR\.length, _uBar\)/.test(S),
    "MIND 하한은 여전히 ★유효★ 표본수로 잰다(명목으로 되돌리지 않았다)",
    "명목 표본수로 되돌렸다 — 하한이 부풀려진다");
}

console.log("⑤ 메모리 — 창을 키운 만큼의 계약");
{
  const lux = /trainWindow:\s*(\d+)/.exec(S.slice(S.indexOf("const LUXML = {"), S.indexOf("const LUXML = {") + 4000));
  chk(TW <= 60000, "MIND 창 " + TW + " 은 다른 학습기(FLOW/XALPHA 40,000 · DUAL 60,000)보다 크지 않다",
    "MIND 창 " + TW + " 이 검증된 범위를 넘는다 — 요청당 128MB 한도 위험");
  const seg = S.slice(S.indexOf("async function _mindLoadSamples"), S.indexOf("function _mindStats"));
  chk(/raw\[i\]\s*=\s*null/.test(seg),
    "MIND 로더가 파싱한 원본 행을 즉시 놓아준다(V33.201 메모리 계약)",
    "로더가 원본을 붙들고 있다 — 창을 키우면 그대로 128MB 를 친다");
}

console.log(fails ? "\n✗ MIND 평가표본 검사 " + fails + "건 실패" : "\n✓ MIND 평가표본 검사 통과");
process.exit(fails ? 1 : 0);
