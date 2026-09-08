/* ═══════════════════════════════════════════════════════════════════════════
   [V33.269] SEQ 3D 관측 — 요청: "인공신경망 연결된 걸 transformer 모양으로 3D 재설계".

   ■ 왜 3D 여야 했나
     다른 위원은 전부 "한 시점의 벡터 하나 → 층" 이라 2D 로 충분하다. 이 모델만 축이
     ★셋★ 이다: 피처(D) · 시점(L) · 단계(사영→어텐션→FFN→출력). 납작하게 그리면
     그 중 하나가 접힌다 — 특히 "어느 시점이 어느 시점을 보는가" 가 사라지는데,
     그게 이 모델을 넣은 이유다.

   ■ 이 검사가 묻는 것
     ① 서버가 내려주는 숫자가 ★저장된 가중치에서 나온 것★ 인가(장식이 아닌가)
     ② 어텐션은 ★채점에 쓰이는 그 함수★ 에서 나오는가(두 번째 구현이 아닌가)
     ③ 3D 사영 수학이 실제로 3D 인가 — 회전이 먹고, 원근이 있고, 깊이 순서가 맞는가
     ④ 모르는 것을 안 그리는가(미학습·표본 없음에서 숫자를 지어내지 않는가)

   ■ 화면 코드는 index.html 안에 있다 — 그래서 ★그 텍스트를 떼어 그대로 실행★ 한다.
     브라우저를 띄우지 않는다(배포마다 크로미움을 켜는 값을 이 저장소는 안 낸다).
     대신 순수부(사영·집계)를 실제로 돌린다 — 버그가 숨는 곳이 정확히 거기다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const HV = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

/* ── index.html 에서 함수 본문을 중괄호 균형으로 떼어 온다(고정폭 창은 코드가 자라면 깨진다) ── */
function grabFn(name) {
  const i = HV.indexOf("function " + name + "(");
  if (i < 0) return null;
  let dep = 0, st = -1;
  for (let j = i; j < HV.length; j++) {
    const c = HV[j];
    if (c === "{") { if (st < 0) st = j; dep++; }
    else if (c === "}") { dep--; if (dep === 0 && st >= 0) return HV.slice(i, j + 1); }
  }
  return null;
}

// ── 모델 픽스처(실제 형상) ──────────────────────────────────────────────────
let _s = 99; const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff * 2 - 1; };
const mat = (a, b) => Array.from({ length: a }, () => Array.from({ length: b }, () => rnd() * 0.4));
const vec = (n, f) => Array.from({ length: n }, () => (f == null ? rnd() * 0.4 : f));
const D = M.LUXML.featNames.length, dm = 32, L = 16, H = 2;
const mkBlock = () => ({
  ln1g: vec(dm, 1), ln1b: vec(dm), Wq: mat(dm, dm), bq: vec(dm), Wk: mat(dm, dm), bk: vec(dm),
  Wv: mat(dm, dm), bv: vec(dm), Wo: mat(dm, dm), bo: vec(dm),
  ln2g: vec(dm, 1), ln2b: vec(dm), W1: mat(dm * 4, dm), b1: vec(dm * 4), W2: mat(dm, dm * 4), b2: vec(dm)
});
/* ★픽스처는 다층이다.★ 단층으로만 검사하면 층을 늘리는 순간 이 검사가 지키던 것이
   전부 빠져나간다(블록별 어텐션·블록별 노드가 정확히 그 자리다). */
const mkModel = (over) => Object.assign({
  featVer: M.LUXML.featVer, L, D, d: dm, heads: H, trusted: true, w: 0.31, admitPath: "acc",
  admitWhy: "정확도 경로", valAccLB: 0.512, valICt: 2.4, probeMaxDiff: 0.0009, probeN: 64, trainedAt: Date.now(),
  mean: vec(D), std: vec(D).map(v => Math.abs(v) + 0.5), Win: mat(dm, D), bin: vec(dm), pos: mat(L, dm),
  blocks: [mkBlock(), mkBlock()],
  lng: vec(dm, 1), lnb: vec(dm), Wh: vec(dm), bh: rnd(),
  vizSeq: Array.from({ length: L }, () => Array.from({ length: D }, () => rnd() * 2)), vizP: 0.58
}, over || {});

console.log("① 화면이 그리는 숫자가 ★저장된 가중치★ 에서 나오는가");
{
  const m = mkModel();
  const v = M._seqVizFrom(m, { trusted: true, wSeq: 0.31 });
  chk(v && v.kind === "seq" && v.trained === true, "학습된 모델에서 관측 데이터를 만든다", "관측 데이터를 못 만든다");
  chk(v.L === L && v.d === dm && v.heads === H && v.D === D,
    `형상을 모델에서 읽는다 (L${v.L}·d${v.d}·헤드${v.heads}·피처${v.D})`, "형상이 설정값에서만 온다 — 모델과 어긋나도 모른다");
  /* ★피처 강도는 Win 의 그 열 노름이어야 한다.★ 한 열만 크게 만들어 그 피처가 1위로
     올라오는지 본다 — 강도를 아무 데서나 만들면 이게 안 움직인다. */
  const m2 = mkModel();
  const pick = 37;
  for (let i = 0; i < dm; i++) m2.Win[i][pick] = 9;
  const v2 = M._seqVizFrom(m2, null);
  chk(v2.topFeatures[0] && v2.topFeatures[0].i === pick,
    `가중치를 키운 피처(${M.LUXML.featNames[pick]})가 실제로 1위로 올라온다`,
    `피처 강도가 가중치를 안 따라간다 (1위 ${v2.topFeatures[0] && v2.topFeatures[0].name}) — 화면 숫자가 모델과 무관하다`);
  chk(v2.inputFeatures.length === D && v2.inputFeatures.every(f => f.strength >= 0 && f.strength <= 1),
    "피처 강도는 전부 [0,1] 로 정규화돼 있다", "강도가 범위를 벗어난다 — 막대가 넘친다");
  chk(v2.inputFeatures.every((f, i) => f.name === M.LUXML.featNames[i]),
    "피처 이름이 서버 featNames 순서와 정확히 일치한다", "★이름과 값이 어긋난다 — 다른 피처 강도를 그 이름으로 그린다★");
  /* FFN 죽은 유닛 — 실제로 0 인 행을 넣으면 세어야 한다. */
  const m3 = mkModel();
  for (let i = 0; i < 20; i++) for (let j = 0; j < dm; j++) m3.blocks[0].W1[i][j] = 0;
  const v3 = M._seqVizFrom(m3, null);
  chk(v3.ffDeadByBlock[0] >= 20, `죽은 FFN 유닛을 블록별로 센다 (블록0 에서 0 으로 만든 20개 중 ${v3.ffDeadByBlock[0]}개 검출)`,
    `죽은 유닛을 못 센다 (${JSON.stringify(v3.ffDeadByBlock)}) — "잘 돌고 있다" 는 그림만 남는다`);
}

console.log("\n② 어텐션은 ★채점에 쓰이는 그 함수★ 에서 나오는가");
{
  const m = mkModel();
  const v = M._seqVizFrom(m, null);
  const A0 = v.attnByBlock && v.attnByBlock[0];
  chk(A0 && v.attnByBlock.length === (v.layers || 1) && A0.length === H && A0[0].length === L && A0[0][0].length === L,
    `어텐션을 ★블록별로★ 낸다 (${v.layers}층 × ${H}헤드 × ${L}×${L}) — 층마다 보는 곳이 다르다`,
    "어텐션을 못 내거나 블록 구분이 없다 — 층이 여럿인데 하나로 뭉치면 어느 층의 그림인지 말할 수 없다");
  let worst = 0;
  for (const bl of v.attnByBlock) for (const hd of bl) for (const row of hd) worst = Math.max(worst, Math.abs(row.reduce((a, b) => a + b, 0) - 1));
  chk(worst < 5e-3, `어텐션 각 행의 합이 1 이다(softmax — 최대 오차 ${worst.toExponential(1)})`,
    `행 합이 1 이 아니다(오차 ${worst}) — 정규화 안 된 값을 비중처럼 그린다`);
  chk(/const p = seqFormerScore\(m, m\.vizSeq, cap\)/.test(code),
    "★관측용 두 번째 구현을 만들지 않는다★ — 채점기 seqFormerScore 에서 캡처한다",
    "관측이 별도 계산을 쓴다 — 화면의 어텐션이 실제 판단과 다른 값일 수 있다");
  /* 캡처가 채점값을 바꾸면 안 된다 — 관측이 판단을 건드리는 순간 그건 관측이 아니다. */
  const a = M.seqFormerScore(m, m.vizSeq), cap = {}, b = M.seqFormerScore(m, m.vizSeq, cap);
  chk(a === b && cap.attn && cap.attn.length === H,
    "어텐션을 캡처해도 채점 결과가 한 비트도 안 바뀐다", "★관측이 채점을 바꾼다★");
  /* 표본이 없으면 ★안 그린다★ */
  const vNo = M._seqVizFrom(mkModel({ vizSeq: null }), null);
  chk(vNo.attnByBlock === null && !!vNo.attnErr,
    `표본이 없으면 어텐션을 지어내지 않고 사유를 적는다 ("${String(vNo.attnErr).slice(0, 30)}…")`,
    "표본 없이도 어텐션을 그린다 — 그건 관측이 아니라 장식이다");
}

console.log("\n②-b 노드 ★값★ — 가중치만으로는 못 그린다(입력이 있어야 존재한다)");
{
  const m = mkModel();
  const v = M._seqVizFrom(m, null);
  const B0 = v.nodes && v.nodes.byBlock && v.nodes.byBlock[0];
  chk(v.nodes && v.nodes.proj.length === L && v.nodes.proj[0].length === dm &&
      B0 && B0.attn.length === L && B0.ffn.length === L && v.nodes.byBlock.length === (v.layers || 1),
    `단계별 노드 값을 ★블록별로★ ${L}시점 × ${dm}차원으로 낸다 (${v.layers}층)`,
    "노드 값을 안 내거나 블록 구분이 없다 — 층이 여럿인데 하나로 뭉치면 '두 층이 같은 일을 한다' 는 그림이 된다");
  /* 단계·블록이 같은 배열이면 그건 한 번 계산해 여러 번 붙인 것이다 — 그림만 여럿으로 보인다. */
  const B1 = v.nodes.byBlock[1];
  const same = JSON.stringify(v.nodes.proj) === JSON.stringify(B0.attn) ||
               JSON.stringify(B0.attn) === JSON.stringify(B0.ffn) ||
               (B1 && JSON.stringify(B0.ffn) === JSON.stringify(B1.ffn));
  chk(!same, "단계도 블록도 서로 다른 값이다(잔차가 실제로 쌓인다)", "★같은 값을 여러 번 붙였다 — 층이 실제로 안 도는 것이다★");
  /* 캡처가 채점 경로 그 자체인지 — 값을 바꾸면 확률도 따라 움직여야 한다. */
  const m2 = mkModel(); for (let i = 0; i < dm; i++) m2.bin[i] += 3;
  const v2 = M._seqVizFrom(m2, null);
  chk(JSON.stringify(v2.nodes.proj) !== JSON.stringify(v.nodes.proj) && v2.attnP !== v.attnP,
    "가중치를 바꾸면 노드 값과 확률이 함께 움직인다(같은 계산에서 나온다)",
    "가중치를 바꿔도 노드 값이 그대로다 — 채점과 다른 곳에서 나온 수다");
  chk(Array.isArray(B0.ffLive) && B0.ffLive.length === L && B0.ffLive.every(x => x >= 0 && x <= (v.ffHidden || 0)),
    `시점마다 FFN 활성 유닛 수를 센다 (블록0 t${L - 1}: ${B0.ffLive[L - 1]}/${v.ffHidden})`, "활성 유닛을 안 센다");
  /* ★노드 역할★ — DNN 이 피처 역할을 보여 주듯, 모델 차원 하나가 무엇을 읽는지. */
  chk(Array.isArray(v.nodeRoles) && v.nodeRoles.length === dm && v.nodeRoles[0].top.length === 3,
    `노드 ${dm}개마다 '무엇을 읽는가(상위 3피처)' 와 '출력에 실리는 몫' 을 낸다`, "노드 역할을 안 낸다 — 노드를 눌러도 할 말이 없다");
  {
    /* 노드 j 의 Win 행을 한 피처로 몰면 그 피처가 1위로 올라와야 한다 — 역할이 진짜 그 행에서 나오는지. */
    const mR = mkModel(); const J = 3, FI = 21;
    for (let k = 0; k < D; k++) mR.Win[J][k] = 0;
    mR.Win[J][FI] = 5;
    const vR = M._seqVizFrom(mR, null);
    chk(vR.nodeRoles[J].top[0].i === FI && vR.nodeRoles[J].top[0].name === M.LUXML.featNames[FI],
      `노드 역할이 Win 의 그 ★행★ 에서 나온다 (노드 ${J} → ${M.LUXML.featNames[FI]})`,
      "노드 역할이 가중치를 안 따라간다 — 화면 설명이 모델과 무관하다");
    /* '출력에 실리는 몫' 도 실제 Wh 를 따라야 한다 — 상수로 두면 어느 노드가 결과를
       움직이는지 화면이 아무 말도 못 하면서 말하는 것처럼 보인다. */
    const mO = mkModel(); const JO = 9;
    for (let k = 0; k < dm; k++) mO.Wh[k] = 0.01;
    mO.Wh[JO] = 9;
    const vO = M._seqVizFrom(mO, null);
    const topOut = vO.nodeRoles.slice().sort((a, b) => b.out - a.out)[0];
    chk(topOut && topOut.j === JO && vO.nodeRoles[JO].out > 0.9,
      `'출력에 실리는 몫' 이 |Wh| 를 따라간다 (노드 ${JO} 가 1위, ${(vO.nodeRoles[JO].out * 100).toFixed(0)}%)`,
      "출력 몫이 가중치를 안 따라간다 — 어느 노드가 결과를 움직이는지 말하지 못한다");
  }
  chk(Array.isArray(v.vizSeq) && v.vizSeq.length === L && v.vizSeq[0].length === D,
    "표본 입력값도 함께 내려간다(피처를 눌렀을 때 '그때 값' 을 보여줄 수 있다)", "표본 입력을 안 내려보낸다 — 피처 상세가 반쪽이 된다");
}

console.log("\n③ 미학습·구 판 — 모르는 것을 아는 것처럼 그리지 않는가");
{
  const v = M._seqVizFrom(null, null);
  chk(v.trained === false && !!v.cfg && !v.inputFeatures && !v.attn,
    "미학습이면 구조(cfg)만 주고 강도·어텐션은 주지 않는다", "미학습인데 강도를 만들어 낸다");
  chk(v.cfg.L === M.SEQML.L && v.cfg.d === M.SEQML.d && v.cfg.heads === M.SEQML.heads,
    "미학습 구조는 설정값 그대로다(지어낸 수가 아니다)", "구조가 설정과 다르다");
  const seq3d = grabFn("NNV_renderSeq3D") || "";
  chk(/구 featVer/.test(seq3d) && /featVer!==data\.serverFeatVer/.test(seq3d.replace(/\s/g, "")),
    "화면이 구 featVer 모델을 '안 실린다' 고 적는다", "판이 어긋난 모델을 실리는 것처럼 그린다");
  chk(/미승격/.test(seq3d) && /admitWhy/.test(seq3d),
    "승격 못 한 모델은 ★사유까지★ 화면에 적는다", "왜 안 실리는지 화면에 안 나온다");
  chk(/학습 전에는 알 수 없는 값/.test(seq3d) || /학습 전에는 알 수 없어 그리지 않습니다/.test(seq3d),
    "미학습 화면이 '강도는 표시하지 않는다' 고 명시한다", "미학습인데 그림만 그럴듯하게 그린다");
}

// Codex: geometry, attention and node mapping run against the replacement engine.
await import('./check-neural-engine.mjs');

console.log("\n⑥ 배선 — 탭·라우팅·기본 시점");
{
  chk(/data-model="seq"/.test(HV), "구조 관측 탭에 SEQ 가 있다", "탭이 없다 — 화면을 열 방법이 없다");
  chk(/\['seq','SEQ/.test(HV), "사이드바 모델 목록에도 있다(고른 모델이 활성표시된다)", "사이드바 목록에 빠졌다");
  chk(/\(modelSel === "seq"\) \? await mlSeqVizData\(env\.DB\)/.test(code),
    "서버가 seq 를 전용 렌더러 데이터로 보낸다", "★탭은 있는데 라우팅이 없다 — 조용히 DNN 구조를 보여준다★");
  chk(/d\.kind === 'seq'\)\{ NNV_renderSeq3D\(d\); return; \}/.test(HV),
    "화면이 kind==='seq' 를 3D 렌더러로 보낸다", "3D 렌더러로 안 간다 — 다른 렌더러가 잘못 그린다");
  chk(/vizSeq: _vz/.test(code) && /body\.probe\[0\]/.test(code),
    "관측용 표본은 probe(트레이너 검증구간 실제 행)에서 온다", "관측 표본의 출처가 없다");
}

console.log(fails === 0 ? "\n✓ SEQ 3D 관측 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
