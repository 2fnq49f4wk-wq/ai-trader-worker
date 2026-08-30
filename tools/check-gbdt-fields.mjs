/* ═══════════════════════════════════════════════════════════════════════════
   [V33.277] 업로드 이름 → 채점 이름. 갈라지면 모델이 조용히 죽는다.

   ■ 무엇이 있었나 (Modal 실측 2026-08-30)
       ⑧ 단타 학습 — 표본 35,072건 · valAcc 0.6313 (하한 0.6189) · blockIC 0.3368 t 9.03
       단타모델 업로드: {"trusted": false, "convMaxDiff": 0.4132, "reason": "정합 미달"}
     이 저장소에서 ★가장 성적이 좋은 모델★ 이 학습에 성공하고도 승격되지 못했다.

   ■ 원인 — 이름이 두 곳에서 갈라져 있었다
     채점기 _gbdtRaw 는 model.bias 와 model.eta 만 읽는다. 그런데
       · /api/gbdt-import  → eta / bias  로 저장(맞다)
       · /api/scalp-import → base / lr   로 저장(채점기가 못 찾는다)
     단타 모델은 base 가 통째로 사라지고 eta 가 0.06(스윙 기본값)으로 대체된 채 채점됐다.
     트레이너는 Σ(트리)×1.0 + base, 워커는 Σ(트리)×0.06 + 0 — 같을 수가 없다.
     ★변환정합 게이트는 제 일을 했다.★ 그게 없었다면 라이브에서 엉뚱한 확률로 매매했다.

   ■ 이 검사가 무는 것
     ① 번역기가 두 이름을 모두 받아 채점 이름으로 옮기는가
     ② 옛 방식(base/lr 로 저장)이 실제로 틀렸음을 ★재현★ 하는가 — 회귀의 증거를 남긴다
     ③ 고친 뒤 워커 채점이 트레이너 확률을 ★오차 0 으로★ 재현하는가
     ④ 두 임포트가 ★같은 번역기★ 를 쓰는가 (이름을 손으로 적은 곳이 없는가)
     ⑤ 채점기가 읽는 이름이 늘어나면 번역기도 따라오는가
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const sig = z => 1 / (1 + Math.exp(-z));

/* 트레이너가 실제로 만드는 모양 그대로 — LightGBM 덤프를 옮긴 이진트리 + margin 보정 base. */
const trees = [
  { f: 0, t: 0.5, l: { w: 0.8 }, r: { w: -0.6 } },
  { f: 1, t: 0.2, l: { w: -0.5 }, r: { w: 0.9 } },
  { f: 2, t: -1.0, l: { w: 0.35 }, r: { w: -0.15 } }
];
const BASE = -0.35, LR = 1.0;
const treeOut = (n, x) => { while (!("w" in n)) n = x[n.f] < n.t ? n.l : n.r; return n.w; };
const trainerP = x => sig(trees.reduce((s, t) => s + treeOut(t, x), 0) * LR + BASE);
const rows = [[0.1, 0.9, -2], [0.9, 0.1, 0], [0.5, 0.2, -1.0], [-3, 5, 7]];

console.log("① 번역기가 두 이름을 모두 받는가");
{
  const a = M._gbdtScoreFields({ lr: 1.0, base: -0.35 }, 0.06);
  chk(a.eta === 1.0 && a.bias === -0.35,
    `트레이너 이름(lr/base)을 채점 이름으로 옮긴다 (eta ${a.eta} · bias ${a.bias})`,
    `lr/base 를 못 옮긴다 (eta ${a.eta} · bias ${a.bias})`);
  const b = M._gbdtScoreFields({ eta: 0.03, bias: 0.2 }, 0.06);
  chk(b.eta === 0.03 && b.bias === 0.2, "채점 이름(eta/bias)으로 와도 그대로 쓴다", "eta/bias 를 무시한다");
  const c = M._gbdtScoreFields({}, 0.06);
  chk(c.eta === 0.06 && c.bias === 0, "둘 다 없으면 주어진 기본값을 쓴다", "기본값 처리가 틀렸다");
  // ★eta 가 0 이어도 기본값으로 덮으면 안 된다★ — 0 은 값이지 '없음' 이 아니다.
  const d = M._gbdtScoreFields({ lr: 0 }, 0.06);
  chk(d.eta === 0, "lr 0 을 '없음' 으로 오해하지 않는다", "0 을 결측으로 보고 기본값으로 덮는다");
}

console.log("\n② 옛 방식이 실제로 틀렸음을 재현하는가 (회귀의 증거)");
{
  // 종전 scalp-import 가 저장하던 모양 — 채점기가 읽는 이름이 아예 없다.
  const oldModel = { trees, base: BASE, lr: LR };
  let worst = 0;
  for (const x of rows) worst = Math.max(worst, Math.abs(M.mlGBDTScore(oldModel, x) - trainerP(x)));
  console.log(`       옛 저장 모양 → 최대 오차 ${worst.toFixed(4)} (승격 문턱 0.03)`);
  chk(worst > 0.03,
    `옛 방식은 문턱을 구조적으로 못 넘는다(최대 오차 ${worst.toFixed(4)}) — 운영 실측 0.4132 와 같은 원인`,
    "옛 방식도 통과한다 — 이 검사가 원인을 잘못 짚었다");
  chk(M.GBDT.eta !== LR,
    `채점기 기본 eta(${M.GBDT.eta})가 트레이너 lr(${LR})과 달라 오차가 생긴다 — 조용한 대체였다`,
    "기본 eta 가 우연히 같아 이 검사가 무의미하다");
}

console.log("\n③ 고친 뒤 — 워커 채점이 트레이너 확률을 재현하는가");
{
  const sf = M._gbdtScoreFields({ lr: LR, base: BASE }, 1);
  const fixed = { trees, eta: sf.eta, bias: sf.bias };
  let worst = 0;
  for (const x of rows) worst = Math.max(worst, Math.abs(M.mlGBDTScore(fixed, x) - trainerP(x)));
  console.log(`       고친 저장 모양 → 최대 오차 ${worst.toExponential(2)}`);
  chk(worst < 1e-12, `트레이너 확률을 ★오차 0★ 으로 재현한다 (${worst.toExponential(2)})`,
    `여전히 어긋난다 (${worst.toFixed(6)})`);
  // 실제 임포트 경로가 저장하는 필드 이름을 소스에서 확인한다(테스트만 통과하는 일이 없게).
  chk(/const model = \{ trees: body\.trees, eta: _sf\.eta, bias: _sf\.bias,/.test(code),
    "단타 임포트가 채점 이름(eta·bias)으로 저장한다", "★단타 임포트가 아직 다른 이름으로 저장한다★");
  chk(!/base: _num\(body\.base, 0\), lr: _num\(body\.lr/.test(code),
    "옛 이름(base/lr) 저장이 남아 있지 않다", "옛 저장 코드가 남아 있다");
}

console.log("\n④~⑤ 두 임포트가 같은 번역기를 쓰는가 · 이름을 손으로 적은 곳이 없는가");
{
  chk(/const _gf = _gbdtScoreFields\(body, GBDT\.eta\);/.test(code),
    "스윙 임포트도 같은 번역기를 쓴다", "스윙 임포트가 이름을 손으로 적는다");
  /* 번역기 자신은 당연히 body.eta/body.bias 를 읽는다 — 그 몸통을 빼고 센다.
     (빼지 않으면 검사가 자기 자신을 '손복사' 로 세어 영원히 실패한다) */
  const transBody = /function _gbdtScoreFields\(body, defEta\) \{[\s\S]*?\n\}/.exec(code);
  const outside = transBody ? code.replace(transBody[0], "") : code;
  const hand = (outside.match(/eta: _num\(body\.eta|bias: _num\(body\.bias/g) || []).length;
  chk(hand === 0, "업로드 이름을 손으로 꺼내 쓰는 곳이 하나도 없다(번역은 한 곳)",
    `★업로드 이름을 손으로 꺼내는 곳이 ${hand}군데 남았다 — 언젠가 또 갈라진다★`);
  // 채점기가 읽는 이름이 정확히 둘인지 — 늘어났는데 번역기가 안 따라오면 같은 사고가 반복된다.
  const raw = /function _gbdtRaw\(model, x\) \{([\s\S]*?)\n\}/.exec(S);
  const reads = [...new Set([...(raw ? raw[1] : "").matchAll(/model\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))]
    .filter(n => n !== "trees");
  console.log(`       채점기가 읽는 이름: ${reads.join(", ")}`);
  const trans = Object.keys(M._gbdtScoreFields({}, 0));
  chk(reads.every(n => trans.includes(n)),
    `채점기가 읽는 이름을 번역기가 전부 만든다 (${trans.join(", ")})`,
    `★채점기는 ${reads.join(",")} 를 읽는데 번역기는 ${trans.join(",")} 만 만든다★`);
}

console.log(fails === 0 ? "\n✓ GBDT 업로드 필드 계약 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
