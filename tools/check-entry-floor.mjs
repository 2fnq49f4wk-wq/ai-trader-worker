// [V33.135] AI 진입 문턱의 절대 하한 계약 검증.
//
//   왜 게이트로 만드는가. 이 값은 ★거래를 늘리는 방향★ 으로 바뀌었다. 그런 변경은
//   "그럴듯해서" 가 아니라 "숫자가 그렇게 말해서" 여야 하고, 나중에 누가 상수 하나를
//   되돌려도 조용히 넘어가면 안 된다.
//
//   근거는 단순하다. 라벨이 `pnl_pct > 0`(_labelOfRow) 이므로 위원회의 p 는 승률 확률이다.
//   그러면 사면 이득인 경계는 동전던지기(0.5)가 아니라 손익비가 정한다:
//       EV = p·avgWin − (1−p)·avgLoss > 0  ⟺  p > 1/(1+payoff)
//   실측(2026-08-10 스냅샷): US payoff 1.316 → 0.4318 / KR 1.705 → 0.3698.
//   종전 상수 0.53 은 그 위라, 기대값이 양수인 구간을 통째로 버렸다.
//   그 결과 위원회 400건 중 p≥0.5 는 3건(0.8%)뿐인데 목표(topPct)는 18% 였고,
//   로그에는 "진입 0 · 보류 22 — 주요사유 ai_primary_gate:21" 이 매 사이클 찍혔다.
//
//   ★양쪽을 함께 본다★ — 한쪽만 보면 반대로 틀린다:
//     ① 문이 열린다     — 기대값이 양수인 구간이 더는 상수에 막히지 않는다
//     ② 문이 닫혀 있다  — 기대값이 음수인 구간은 여전히 못 지나간다

import { readFileSync } from "node:fs";
import { aiEntryFloor, DEFAULT_CFG, AI_PARAMS } from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };

const AP = (AI_PARAMS && AI_PARAMS.aiPrimary) || {};
const ps = (payoff, n, market) => {
  const o = { ready: true, n: n, payoff: payoff };
  return market === "us" ? { us: o } : market === "kr" ? { kr: o } : { all: o };
};

// ── 계약 ① 손익분기에서 나온 값인가 ────────────────────────────────
{
  const f = aiEntryFloor(ps(1.316, 236, "us"), "us", AP);
  const be = 1 / (1 + 1.316);
  const want = be + (AP.floorFromPayoff ? AP.floorFromPayoff.margin : 0.05);
  if (Math.abs(f.floor - want) < 1e-6) ok(`US 손익비 1.316 → 하한 ${f.floor.toFixed(4)} (분기 ${be.toFixed(4)} + 여유)`);
  else bad(`US 하한이 손익분기에서 안 나온다: ${f.floor} (기대 ${want.toFixed(4)})`);

  const f2 = aiEntryFloor(ps(1.705, 156, "kr"), "kr", AP);
  if (f2.floor < 0.53) ok(`KR 손익비 1.705 → 하한 ${f2.floor.toFixed(4)} < 종전 상수 0.53 (막혀 있던 구간이 열린다)`);
  else bad(`KR 하한 ${f2.floor} 이 여전히 0.53 이상 — 적응 문턱이 계속 무력화된다`);
}

// ── 계약 ② 기대값이 음수인 구간은 여전히 막는가 ──────────────────
//   손익비가 나쁘면(1 미만) 손익분기가 0.5 를 넘어가고, 하한도 따라 올라가야 한다.
{
  const f = aiEntryFloor(ps(0.6, 300, "us"), "us", AP);
  const be = 1 / 1.6;   // 0.625
  if (f.floor >= Math.min(be, 0.60) - 1e-9) ok(`손익비 0.6(나쁨) → 하한 ${f.floor.toFixed(4)} 로 ★올라간다★ (분기 ${be.toFixed(3)})`);
  else bad(`손익비가 나쁜데 하한이 안 올라간다: ${f.floor}`);

  // 어떤 손익비에서도 하한 아래 거래는 기대값이 음수여야 한다 — 몬테카를로
  let leak = 0, tested = 0;
  for (let i = 0; i < 20000; i++) {
    const payoff = 0.3 + Math.random() * 4;
    const f2 = aiEntryFloor(ps(payoff, 200, "us"), "us", AP);
    const be2 = 1 / (1 + payoff);
    tested++;
    // 하한이 hardMin 에 걸려 손익분기 아래로 내려간 경우만 문제다
    if (f2.floor < be2 - 1e-9) leak++;
  }
  if (leak === 0) ok(`손익비 0.3~4.3 전 구간 ${tested}회 — 하한이 손익분기 아래로 내려간 경우 0건`);
  else bad(`하한이 손익분기 아래인 경우 ${leak}/${tested}건 — 기대값 음수 거래가 통과한다`);
}

// ── 계약 ③ 표본이 없으면 쓰지 않는다(폴백) ──────────────────────
{
  const f = aiEntryFloor({ us: { ready: true, n: 20, payoff: 3.0 } }, "us", AP);
  if (Math.abs(f.floor - (AP.absFloor != null ? AP.absFloor : 0.53)) < 1e-9) ok(`표본 20건(<minN) → 고정 하한 ${f.floor} 폴백`);
  else bad(`표본이 적은데 손익비 하한을 썼다: ${JSON.stringify(f)}`);

  const f2 = aiEntryFloor(null, "us", AP);
  if (Math.abs(f2.floor - (AP.absFloor != null ? AP.absFloor : 0.53)) < 1e-9) ok("port_stats 없음 → 고정 하한 폴백");
  else bad(`통계가 없는데 하한이 바뀌었다: ${JSON.stringify(f2)}`);

  const f3 = aiEntryFloor({ us: { ready: true, n: 500, payoff: 0 } }, "us", AP);
  if (Math.abs(f3.floor - (AP.absFloor != null ? AP.absFloor : 0.53)) < 1e-9) ok("손익비 0(무효) → 고정 하한 폴백");
  else bad(`무효 손익비인데 하한이 바뀌었다: ${JSON.stringify(f3)}`);
}

// ── 계약 ④ 상·하한으로 감싸는가 ────────────────────────────────
{
  const c = AP.floorFromPayoff || {};
  const lo = c.hardMin != null ? c.hardMin : 0.45, hi = c.hardMax != null ? c.hardMax : 0.60;
  const fHi = aiEntryFloor(ps(50, 400, "us"), "us", AP);    // 손익비 폭발 → 분기 ≈ 0.02
  const fLo = aiEntryFloor(ps(0.05, 400, "us"), "us", AP);  // 손익비 붕괴 → 분기 ≈ 0.95
  if (fHi.floor >= lo - 1e-9) ok(`손익비 50(이상치) → 하한 ${fHi.floor} ≥ 하드바닥 ${lo} (문이 활짝 열리지 않는다)`);
  else bad(`이상치 손익비가 하한을 ${fHi.floor} 까지 끌어내렸다`);

  //   ※ 위쪽은 대칭이 아니다. 처음엔 `floor ≤ hardMax` 를 요구했는데 그게 틀린 계약이었다 —
  //     손익비가 파국적이면(0.05 → 분기 0.952) 하한이 hardMax(0.60)를 넘어서는 것이 ★옳다★.
  //     거기서 천장을 씌우면 기대값이 음수인 거래를 통과시키게 된다. hardMax 는 여유폭만
  //     제한하고, 손익분기는 언제나 이긴다. 기대값이 음수인 국면에서 거래가 마르는 것은
  //     막아야 할 증상이 아니라 원하는 결과다.
  const beLo = 1 / 1.05;
  if (fLo.floor >= beLo - 1e-9 && fLo.floor < 1) ok(`손익비 0.05(파국) → 하한 ${fLo.floor.toFixed(4)} 가 hardMax 를 넘어 분기 ${beLo.toFixed(4)} 를 지킨다(거래 정지가 정답)`);
  else bad(`파국적 손익비인데 하한이 ${fLo.floor} — 손익분기 ${beLo.toFixed(4)} 를 못 지킨다`);
}

// ── 계약 ⑤ 소스 계약: 클램프 하한도 같은 floor 를 쓰는가 ────────
//   종전엔 _clamp(…, 0.5, 0.9) 의 하한 0.5 가 별도로 박혀 있어, floor 를 내려도
//   클램프가 다시 0.5 로 올려버렸다. 둘이 어긋나면 이 수정 자체가 무의미해진다.
{
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  if (/_clamp\(Math\.max\(_floor, _pctThr\), _floor, 0\.9\)/.test(src))
    ok("백분위 문턱 클램프의 하한이 손익비 floor 와 같은 값이다");
  else if (/_clamp\(Math\.max\(_floor, _pctThr\), 0\.5, 0\.9\)/.test(src))
    bad("클램프 하한이 0.5 로 박혀 있다 — floor 를 내려도 0.5 로 되돌아간다(수정 무효)");
  else bad("백분위 문턱 클램프를 찾지 못했다 — 코드 구조가 바뀌었으면 이 검사를 갱신할 것");

  if (/const _fl = aiEntryFloor\(__portStats, market, _ap2\);/.test(src)) ok("게이트가 시장별 손익비로 하한을 구한다");
  else bad("게이트가 aiEntryFloor 를 쓰지 않는다");
}

// ── 계약 ⑥ 실제 스냅샷 재현 — 적응 문턱이 되살아나는가 ──────────
//   V33.80 의 백분위 문턱(상위 18%)이 상수에 눌려 한 번도 적용되지 못했다.
{
  const cases = [
    { mk: "us", payoff: 1.316, n: 236, pct: 0.5209 },
    { mk: "kr", payoff: 1.705, n: 156, pct: 0.4906 }
  ];
  for (const c of cases) {
    const f = aiEntryFloor(ps(c.payoff, c.n, c.mk), c.mk, AP).floor;
    const thr = Math.max(Math.min(Math.max(f, c.pct), 0.9), f);
    if (Math.abs(thr - c.pct) < 1e-9) ok(`${c.mk.toUpperCase()} 적응 문턱 ${c.pct} 가 실제로 적용된다(하한 ${f.toFixed(4)} 에 안 눌림)`);
    else bad(`${c.mk.toUpperCase()} 문턱이 ${thr.toFixed(4)} 로 눌린다 — 백분위 ${c.pct} 가 무시된다`);
  }
}

console.log(fails ? "\n진입 하한 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   진입 하한 계약 통과");
process.exit(fails ? 1 : 0);
