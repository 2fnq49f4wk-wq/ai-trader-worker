/* ═══════════════════════════════════════════════════════════════════════════
   [V33.292] 정확도 게이트에도 같은 구멍이 있었다 — 실력 0 이 문턱을 넘는다.

   ■ 무엇이 잘못돼 있었나
     V33.291 은 IC 에서 시장 고정효과를 뺐다. 그런데 이 저장소는 정확도로도 심사한다:
         단타                  valAccLB ≥ ★합쳐 본 다수클래스★ + 1.5%p
         GBDT/DNN/MIND/SEQ     valAccLB ≥ ★고정 0.505★
     둘 다 "시장 안 실력" 을 안 묻는다. 시장만 아는 모델("미국엔 사고 한국엔 팔아라")이
     얻는 정확도는 Σ_m (n_m/N)·max(기저_m, 1−기저_m) 이고, 기저 US 0.55 / KR 0.45 면 ★0.55★ 다.
     그런데 합쳐 본 양성비율은 0.50 이라 다수클래스 기준도 0.50 이고, 고정 문턱은 0.505 다.
     ★실력이 0 인 모델이 두 문턱을 다 넘는다.★

   ■ 고침 — 문턱의 기준점을 '실력 없이 도달 가능한 정확도' 로 바꾼다
     이 값은 정의상 ① 합쳐 본 다수클래스보다 크거나 같고 ② 상수 예측기가 얻는 값보다도
     크거나 같다(상수 예측기는 시장별 최적을 못 고른다). ★한 자로 두 구멍을 다 막는다.★
     문턱 상수(0.505 · +1.5%p)는 안 건드린다 — 바꾸는 것은 "무엇에 대해 그만큼인가" 다.

   ■ 이 검사가 무는 것
     ① 사고 재현 — 실력 0 인 시장전용 예측기가 종전 두 문턱을 넘는다
     ② 새 기준점은 그것을 막는다
     ③ 상수 예측기도 못 넘는다(다수클래스 구멍도 같이 막힌다)
     ④ 시장이 하나면 종전 다수클래스와 ★정확히★ 같다(무해성)
     ⑤ 진짜 실력은 통과한다(과잉교정 금지)
     ⑥ 게이트들이 실제로 이 기준점을 쓰는가 · 트레이너가 실제로 보내는가
     ⑦ 파이썬과 숫자가 같은가
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
let _s = 20260901;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const f4 = v => (v == null ? "null" : (+v).toFixed(4));

/* 두 시장 · 기저가 다르다 · 시장 안 신호는 edge 로 조절한다. */
function mk(bUS, bKR, edge, N) {
  const y = [], m = [], p = [];
  for (let i = 0; i < (N || 20000); i++) {
    const us = (i % 2 === 0), b = us ? bUS : bKR;
    m.push(us ? "us" : "kr");
    const u = rnd();
    y.push((rnd() < b + (edge ? (u - 0.5) * edge : 0)) ? 1 : 0);
    // 시장만 아는 예측기: 그 시장의 다수 클래스를 찍는다.
    p.push((b >= 0.5 ? 1 : 0));
  }
  return { y, m, p };
}
const accOf = (p, y) => { let c = 0; for (let i = 0; i < y.length; i++) if (p[i] === y[i]) c++; return c / y.length; };

console.log("① 사고 재현 — 실력 0 인 ★시장전용 예측기★ 가 종전 문턱을 넘는가");
const d = mk(0.55, 0.45, 0);
const pooled = M._noSkillAcc(d.y, null), noskill = M._noSkillAcc(d.y, d.m);
const acc = accOf(d.p, d.y);
{
  console.log(`       시장전용 예측기 정확도 ${f4(acc)} · 합쳐 본 다수클래스 ${f4(pooled)} · 무실력 기준 ${f4(noskill)}`);
  chk(acc > pooled + 0.02, `실력 0 인데 합쳐 본 다수클래스(${f4(pooled)})를 ${((acc - pooled) * 100).toFixed(1)}%p 넘는다`,
    "★사고가 재현되지 않는다 — 전제부터 다시 봐야 한다★");
  chk(acc > 0.505, `고정 문턱 0.505 도 넘는다(${f4(acc)})`, "고정 문턱을 안 넘는다 — 전제 확인 필요");
  chk(M._accFloor(0.505, null) === 0.505, "기준점을 안 주면 종전 그대로다(구 트레이너 호환)", "기본 동작이 바뀌었다");
}

console.log("\n② 새 기준점은 그것을 막는가");
{
  const fl = M._accFloor(0.505, noskill);
  console.log(`       새 문턱 ${f4(fl)} (상수 0.505 · 무실력 ${f4(noskill)})`);
  chk(acc <= fl + 1e-9, `시장전용 예측기가 새 문턱을 ★못 넘는다★ (${f4(acc)} ≤ ${f4(fl)})`,
    `★막지 못한다(${f4(acc)} > ${f4(fl)})★`);
  chk(Math.abs(noskill - acc) < 0.01,
    `무실력 기준점이 곧 시장전용 예측기의 성적이다(${f4(noskill)} ≈ ${f4(acc)}) — 정의가 맞다`,
    `기준점(${f4(noskill)})과 실제 성적(${f4(acc)})이 다르다 — 식이 틀렸다`);
}

console.log("\n③ 상수 예측기도 못 넘는가 (다수클래스 구멍)");
{
  const e = mk(0.58, 0.58, 0);                    // 두 시장 기저가 같고 한쪽으로 치우쳤다
  const ns = M._noSkillAcc(e.y, e.m);
  const always1 = e.y.map(() => 1);
  const a1 = accOf(always1, e.y);
  console.log(`       늘 '상승' 만 찍는 예측기 ${f4(a1)} · 무실력 기준 ${f4(ns)} · 고정문턱 0.505`);
  chk(a1 > 0.505, "상수 예측기가 고정 문턱 0.505 는 넘는다(종전 구멍)", "전제 확인 필요");
  chk(a1 <= M._accFloor(0.505, ns) + 1e-9,
    `새 문턱(${f4(M._accFloor(0.505, ns))})은 상수 예측기도 막는다`,
    `★상수 예측기가 새 문턱도 넘는다★`);
}

console.log("\n④ 시장이 하나면 종전 다수클래스와 ★정확히★ 같은가 (무해성)");
{
  const e = mk(0.53, 0.53, 0.2);
  const one = e.m.map(() => "us");
  chk(Math.abs(M._noSkillAcc(e.y, one) - M._noSkillAcc(e.y, null)) < 1e-12,
    `한 시장뿐이면 값이 한 톨도 안 변한다(${f4(M._noSkillAcc(e.y, one))})`,
    "★한 시장뿐인데 값이 바뀐다★");
}

console.log("\n⑤ 진짜 실력은 통과하는가 (과잉교정 금지)");
{
  /* 시장 기저는 같고, 시장 ★안★ 에서 순위를 맞히는 모델. */
  const N = 20000, y = [], m = [], p = [];
  for (let i = 0; i < N; i++) {
    const us = (i % 2 === 0); m.push(us ? "us" : "kr");
    const u = rnd(); const hit = rnd() < 0.5 + (u - 0.5) * 0.34;
    y.push(hit ? 1 : 0); p.push(u >= 0.5 ? 1 : 0);
  }
  const ns = M._noSkillAcc(y, m), a = accOf(p, y);
  const fl = M._accFloor(0.505, ns);
  console.log(`       시장 안 실력 모델 ${f4(a)} · 무실력 기준 ${f4(ns)} · 새 문턱 ${f4(fl)}`);
  chk(a > fl, `진짜 실력은 새 문턱을 넘는다(${f4(a)} > ${f4(fl)})`,
    `★진짜 실력까지 막힌다(${f4(a)} ≤ ${f4(fl)}) — 이 자는 쓸 수 없다★`);
}

console.log("\n⑥ 게이트가 실제로 이 기준점을 쓰는가 · 트레이너가 실제로 보내는가");
{
  const want = [
    ["GBDT", /const _gAccFloor = _accFloor\(GBDT\.trustFloor, _num\(body\.accBase, null\)\);/],
    ["MIND(외부 FM)", /_mLB >= _accFloor\(MIND\.trustFloor, _num\(body\.accBase, null\)\)/],
    ["MIND(단발)", /vLB >= _accFloor\(MIND\.trustFloor, _num\(body\.accBase, null\)\)/],
    ["DNN", /_dnnAdmit\(valAccLB, _icT, mindLB, _num\(_vs\.accBase, null\)\)/],
    ["SEQ", /_dnnAdmit\(lb, icT, 0\.5, _num\(body\.accBase, null\)\)/],
    ["단타", /_clamp\(_num\(body\.accBase, 0\), 0, 0\.9\)/]
  ];
  for (const [nm, re] of want) chk(re.test(S), `${nm} 게이트가 무실력 기준점을 본다`, `★${nm} 게이트가 아직 종전 기준점이다★`);
  chk(/valAccBase: _accBase/.test(S), "워커 자체학습도 무실력 기준점을 남긴다", "워커 학습이 기준점을 안 남긴다");
  chk(/def _no_skill_acc\(y, mkt=None\)/.test(PY), "파이썬도 같은 값을 낸다", "★파이썬에 없다 — 외부 모델은 기준점을 못 받는다★");
  chk(/out\["accBase"\] = round\(_ab, 4\)/.test(PY), "블록 IC 를 내는 자리에서 함께 낸다(두 자가 갈라지지 않는다)", "따로 계산한다");
  chk(/"valICK", "accBase"/.test(PY), "DNN 업로드가 accBase 를 함께 보낸다", "DNN 이 accBase 를 안 보낸다");
  chk(/_ic_block_fields\(pva, yva, mkt=_mkt_of_X\(X\[tr_end:\]\)\)/.test(PY), "SEQ 도 시장·기준점을 함께 보낸다", "SEQ 가 안 보낸다");
  // ★문턱 상수는 안 건드렸는가★ — 완화도 강화도 아니고 기준점만 바꾼 것이어야 한다.
  chk(/trustFloor: 0\.505/.test(S) && /_baseline \+ 0\.015/.test(S),
    "문턱 상수(0.505 · +1.5%p)는 그대로다 — 바꾼 것은 '무엇에 대해서' 하나뿐이다",
    "★문턱 상수가 바뀌었다 — 그러면 이 변경의 성격이 달라진다★");
}

console.log("\n⑦ 파이썬과 숫자가 같은가");
{
  const e = mk(0.57, 0.44, 0.15, 12000);
  const js = M._noSkillAcc(e.y, e.m), jsP = M._noSkillAcc(e.y, null);
  const tmp = process.env.TMPDIR || "/tmp";
  const fp = tmp + "/_ns_probe.json";
  writeFileSync(fp, JSON.stringify({ y: e.y, m: e.m }));
  const i = PY.indexOf("def _no_skill_acc(");
  const rest = PY.slice(i);
  const cut = /\n(?=def |# =)/.exec(rest.slice(1));
  const src = cut ? rest.slice(0, cut.index + 1) : rest;
  const py = tmp + "/_ns_probe.py";
  writeFileSync(py, "import json, numpy as np\n" + src +
    "\nd=json.load(open(" + JSON.stringify(fp) + "))\n" +
    "mk=np.asarray(d['m'],dtype=object)\n" +
    "print(json.dumps({'w':_no_skill_acc(d['y'],mk),'p':_no_skill_acc(d['y'],None)}))\n");
  let out = null;
  try { out = JSON.parse(execFileSync("python3", [py], { encoding: "utf8" }).trim()); }
  catch (err) { chk(false, "", "★파이썬을 돌려보지 못했다: " + String(err.message).slice(0, 140) + "★"); }
  if (out) {
    const d1 = Math.abs(js - out.w), d2 = Math.abs(jsP - out.p);
    console.log(`       시장가중 — JS ${f4(js)} / PY ${out.w.toFixed(4)} · 합쳐본 — JS ${f4(jsP)} / PY ${out.p.toFixed(4)}`);
    chk(d1 < 1e-12 && d2 < 1e-12, `두 언어가 같은 값을 낸다(최대 차 ${Math.max(d1, d2).toExponential(1)})`,
      `★두 언어가 다르다(${d1.toExponential(1)} / ${d2.toExponential(1)})★`);
    chk(Math.abs(out.w - out.p) > 0.01, `두 기준점의 차이가 실제로 크다(${out.p.toFixed(4)} → ${out.w.toFixed(4)})`,
      "두 기준점이 거의 같다 — 데이터가 이 계약을 안 물고 있다");
  }
}

/* ══ ⑧ [V33.295] ★불변식 — 시장가중은 합쳐 본 다수클래스보다 절대 낮을 수 없다★ ═══════
   max(·)는 볼록함수이므로 옌센 부등식으로
       Σ_m w_m·max(b_m, 1−b_m)  ≥  max(Σ_m w_m·b_m, 1−Σ_m w_m·b_m)
   이 항상 성립한다. 즉 새 기준점이 종전 기준점보다 낮게 나오면 그건 데이터가 아니라
   ★식이 틀린 것★ 이다.
   V33.292 는 "표본 30건 미만 그룹은 0.5 로 본다" 를 넣었는데, 0.5 를 섞으면 기준점이
   내려간다 — 게이트가 느슨해지는 쪽이다. 운영 실측이 그대로 잡아냈다:
       [STACK] valAcc 52.7%(무실력 ★52.5%★ · 시장무시 ★52.7%★)
   ★불가능한 값이 배포돼 있었는데 검사 일곱 묶음이 전부 통과했다.★ ①~⑦ 이 전부
   '내가 만든 예제'만 봤기 때문이다 — 작은 그룹이 섞인 구성을 하나도 안 만들었다.
   그래서 여기서는 ★무작위 구성 수백 개★ 에 불변식을 건다. */
console.log("\n⑧ 불변식 — 시장가중 ≥ 합쳐 본 다수클래스 (무작위 구성 300개)");
{
  let worst = 1e9, worstDesc = "", tiny = 0;
  for (let trial = 0; trial < 300; trial++) {
    const nG = 1 + Math.floor(rnd() * 4);
    const y = [], m = [];
    for (let g = 0; g < nG; g++) {
      // ★작은 그룹을 일부러 만든다★ — 30건 문턱 아래위를 모두 밟게 한다.
      const n = (rnd() < 0.4) ? (1 + Math.floor(rnd() * 40)) : (50 + Math.floor(rnd() * 900));
      const b = 0.2 + rnd() * 0.6;
      if (n < 30) tiny++;
      for (let i = 0; i < n; i++) { y.push(rnd() < b ? 1 : 0); m.push("m" + g); }
    }
    const w = M._noSkillAcc(y, m), p = M._noSkillAcc(y, null);
    const d = w - p;
    if (d < worst) { worst = d; worstDesc = `그룹 ${nG}개 · n ${y.length} · 가중 ${f4(w)} vs 합쳐 ${f4(p)}`; }
  }
  console.log(`       작은 그룹(<30) 포함 ${tiny}개 · 최악 차이 ${worst.toExponential(2)} (${worstDesc})`);
  chk(worst >= -1e-12,
    `300개 구성 전부에서 시장가중 ≥ 합쳐 본 다수클래스 (최악 ${worst.toExponential(2)})`,
    `★불변식 위반: 시장가중이 합쳐 본 값보다 낮다 — ${worstDesc}. 식이 틀렸다(게이트가 느슨해진다)★`);
  // 작은 그룹을 어떻게 다루는지 — 0.5 를 섞으면 위 불변식이 깨진다. 규칙도 못 박아 둔다.
  /* 규칙도 못 박아 둔다 — 그룹별 자기 비율 + 너무 작은 그룹은 ★가장 큰 그룹에 합치기★.
     "작은 그룹만 전체 비율로" 는 분할이 아니라 섞기라 위 불변식이 깨진다(반례를 실제로 봤다). */
  chk(/if \(s2 !== big && s2\.n < MIN_G\) \{ big\.n \+= s2\.n; big\.pos \+= s2\.pos;/.test(S),
    "표본이 너무 적은 그룹은 가장 큰 그룹에 ★합친다★(분할을 거칠게 할 뿐 — 부등식 유지)",
    "작은 그룹 처리가 바뀌었다 — 섞으면 기준점이 내려갈 수 있다");
  chk(/if m < 8: merged = merged \| sel/.test(PY),
    "파이썬도 같은 규칙이다", "★파이썬만 다른 규칙이다 — 외부 모델 기준점이 달라진다★");
}

console.log(fails === 0 ? "\n✓ 무실력 정확도 기준점 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
