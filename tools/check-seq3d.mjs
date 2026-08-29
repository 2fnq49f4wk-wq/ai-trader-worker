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

console.log("\n②-c 눌러서 볼 수 있는가 — 피처 75개·노드 32개가 낱개로 있는가");
{
  const draw = grabFn("sq3Draw") || "", pick = grabFn("sq3DrawPick") || "";
  chk(/NB=IF\?IF\.length:24/.test(draw.replace(/\s/g, "")),
    "입력 피처를 ★낱개로★ 그린다(묶으면 무엇이 세게 들어가는지 못 묻는다)",
    "입력을 묶음 막대로만 그린다 — 개별 피처를 가리킬 수 없다");
  chk(/data-pick="feat:/.test(draw) && /data-pick="node:/.test(draw) && /data-pick="step:/.test(draw),
    "피처·노드·시점이 전부 클릭 대상이다", "클릭 대상이 없다 — 볼 수는 있어도 물어볼 수는 없다");
  chk(/<title>/.test(draw), "마우스를 올리면 이름과 값이 뜬다(네이티브 title)", "툴팁이 없다");
  chk(/nSrc=d\.nodes\.byBlock&&d\.nodes\.byBlock\[S\.blk\|\|0\]/.test(draw.replace(/\s/g, "").replace("varbb=", "nSrc=")) ||
      /d\.nodes\.byBlock\[S\.blk/.test(draw.replace(/\s/g, "")),
    "카드 안 칸은 ★그 블록의★ 노드 값을 그린다(층마다 다른 값이다)",
    "카드 안이 가중치 노름뿐이거나 블록 구분이 없다");
  chk(/neg\?'255,110,140':'0,224,255'/.test(draw.replace(/\s/g, "")),
    "부호를 색으로 나눈다(절댓값만 그리면 밀어 올린 노드와 눌러 내린 노드가 같아 보인다)", "부호가 안 보인다");
  chk(/addEventListener\('click'/.test(HV) && /data-pick/.test(HV),
    "클릭은 위임으로 받는다(SVG 를 매 프레임 다시 만들므로 개별 리스너는 죽는다)", "개별 리스너를 단다 — 회전 한 번에 죽는다");
  /* ★설명 문장을 찾으면 안 된다.★ 처음엔 '받는 주목' 이라는 말을 찾았는데, 필드 라벨에서
     그 말을 지워도 아래 설명 문단에 같은 말이 남아 검사가 통과했다. 세어야 할 것은 말이 아니라
     ★계산★ 이다: 행(내가 보는 것)과 열(내가 받는 것)은 다른 합이다. 열 합을 실제로 구하는가. */
  chk(/col\+=\(AB\[hh\]\[r2\]&&AB\[hh\]\[r2\]\[t\]\)\|\|0/.test(pick.replace(/\s/g, "")),
    "'받는 주목' 을 어텐션 행렬의 ★열★ 로 실제 계산한다(행과 열은 다른 값이다)",
    "★열 합을 구하지 않는다 — 행 하나로 두 방향을 다 말하면 그 중 하나는 틀린 값이다★");
  chk(/보는 비중/.test(pick), "두 방향을 화면에 구분해 적는다", "방향 구분이 화면에 없다");
  chk(/그 표본이 지나갈 때의 실제 값/.test(pick),
    "노드 상세가 '가중치가 아니라 그 표본의 값' 이라고 명시한다", "값의 출처를 안 적는다");
  chk(/SQ3\.cells && SQ3\.spin/.test(HV) && /SQ3\.spin=false/.test(HV.replace(/\s/g, "")),
    "낱개 보기를 켜면 자동회전을 멈춘다(조용히 느려지지 않는다)", "낱개 + 회전을 같이 돌린다 — 프레임이 끊긴다");
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

console.log("\n④ 3D 사영이 정말 3D 인가 — 회전·원근·깊이순서");
{
  const src = [grabFn("sq3Proj"), grabFn("sq3Quad")].filter(Boolean).join("\n");
  chk(!!grabFn("sq3Proj") && !!grabFn("sq3Quad"), "사영 함수를 화면 코드에서 떼어 왔다", "사영 함수를 못 찾는다 — 검사가 헛돈다");
  const F = new Function(src + "\nreturn { sq3Proj: sq3Proj, sq3Quad: sq3Quad };")();
  const C = { yaw: 0, pitch: 0, dist: 900, s: 1, cx: 450, cy: 250 };
  /* 원근 — 멀리 있는 같은 크기의 것이 작게 보여야 한다. 아니면 그건 3D 가 아니라 기울인 2D 다. */
  const near = F.sq3Proj({ x: 100, y: 0, z: -200 }, C), far = F.sq3Proj({ x: 100, y: 0, z: 200 }, C);
  chk(Math.abs(near.X - C.cx) > Math.abs(far.X - C.cx) && near.f > far.f,
    `원근이 있다 (가까운 쪽 배율 ${near.f.toFixed(3)} > 먼 쪽 ${far.f.toFixed(3)})`,
    "원근이 없다 — 깊이가 크기로 안 나타나면 3D 로 안 읽힌다");
  /* 회전 — yaw 를 돌리면 화면 좌표가 바뀌어야 한다(안 바뀌면 드래그가 죽은 것이다). */
  const p0 = F.sq3Proj({ x: 100, y: 0, z: 0 }, C);
  const p1 = F.sq3Proj({ x: 100, y: 0, z: 0 }, Object.assign({}, C, { yaw: 0.7 }));
  chk(Math.abs(p0.X - p1.X) > 1, `yaw 회전이 화면에 반영된다 (Δ ${Math.abs(p0.X - p1.X).toFixed(1)}px)`,
    "yaw 를 돌려도 그림이 안 변한다 — 회전이 죽어 있다");
  const q0 = F.sq3Proj({ x: 0, y: 100, z: 0 }, C);
  const q1 = F.sq3Proj({ x: 0, y: 100, z: 0 }, Object.assign({}, C, { pitch: 0.7 }));
  chk(Math.abs(q0.Y - q1.Y) > 1, `pitch 회전이 화면에 반영된다 (Δ ${Math.abs(q0.Y - q1.Y).toFixed(1)}px)`,
    "pitch 를 돌려도 그림이 안 변한다");
  /* ★Y 축은 위가 위여야 한다★ — SVG 는 Y 가 아래로 자란다. 부호를 빼먹으면 그림이 뒤집힌다. */
  const up = F.sq3Proj({ x: 0, y: 50, z: 0 }, C), dn = F.sq3Proj({ x: 0, y: -50, z: 0 }, C);
  chk(up.Y < dn.Y, "위(y+)가 화면에서 위로 간다(SVG 의 뒤집힌 Y 를 처리한다)", "★그림이 위아래로 뒤집혀 있다★");
  /* 깊이 정렬 — 화가 알고리즘의 근거값이 실제 깊이를 따라야 한다. */
  const qn = F.sq3Quad([{x:0,y:0,z:-200},{x:10,y:0,z:-200},{x:10,y:10,z:-200},{x:0,y:10,z:-200}], C);
  const qf = F.sq3Quad([{x:0,y:0,z:200},{x:10,y:0,z:200},{x:10,y:10,z:200},{x:0,y:10,z:200}], C);
  chk(qf.z > qn.z, `깊이값이 먼 면에서 더 크다 (먼 ${qf.z.toFixed(0)} > 가까운 ${qn.z.toFixed(0)}) — 정렬 기준이 산다`,
    "깊이값이 거꾸로다 — 먼 면이 가까운 면을 덮는다");
  /* ★무대축을 정면으로 보면 단계 5개가 한 자리에 겹친다★ — 돌려보다 그 각도에 닿으면
     화면이 고장난 것처럼 보인다. 한계가 없으면 그 각도는 반드시 나온다(자동회전이 계속
     같은 방향으로 도니까). 실제로 처음엔 그랬다. */
  const clamped = /YAW_MAX:\s*([0-9.]+)/.exec(HV);
  chk(clamped && parseFloat(clamped[1]) <= 1.2,
    `회전 각도가 ±${clamped ? clamped[1] : "?"}rad 로 묶여 있다 — 단계가 겹치는 정면 각도에 못 간다`,
    "회전에 한계가 없다 — 무대축 정면에서 단계 5개가 한 자리로 겹쳐 아무것도 안 읽힌다");
  chk(/SQ3\.dir = -1/.test(HV) && /SQ3\.dir = 1/.test(HV),
    "자동회전은 한계 안에서 왕복한다(한계에 닿아 멈추지 않는다)", "자동회전이 한계에서 멎는다");
  chk(/sq3Clamp\(SQ3\.yaw/.test(HV) && /sq3Clamp\(SQ3\.pitch/.test(HV),
    "드래그도 같은 한계를 따른다(손으로는 넘어갈 수 있으면 한계가 아니다)", "드래그가 한계를 무시한다");
  chk(/parts\.sort\(function\(a,b\)\{ return b\.z-a\.z; \}\)/.test(HV.replace(/\s+/g, " ").replace(/parts\.sort\(function \(a, b\) \{ return b\.z - a\.z; \}\)/, "parts.sort(function(a,b){ return b.z-a.z; })")) ||
      /parts\.sort\([\s\S]{0,60}b\.z\s*-\s*a\.z/.test(HV),
    "먼 것부터 그린다(화가 알고리즘)", "정렬 없이 그린다 — 앞뒤가 뒤섞인다");
}

console.log("\n⑤ 어텐션 집계 — 어느 시점이 어느 시점을 보는가(이 화면의 존재 이유)");
{
  const src = grabFn("sq3AttnRow");
  chk(!!src && !!grabFn("sq3AttnOf"), "집계 함수를 화면 코드에서 떼어 왔다", "집계 함수를 못 찾는다");
  const f0 = new Function(grabFn("sq3AttnOf") + "\n" + src + "\nreturn sq3AttnRow;")();
  const f = (dd, h, r, L2) => f0(dd, h, r, L2, -1);
  /* 헤드 0 은 t=3 만, 헤드 1 은 t=9 만 보게 만든 인공 어텐션 — 집계가 어느 헤드를 봤는지 드러난다. */
  const one = (k) => { const r = new Array(L).fill(0); r[k] = 1; return r; };
  const d = { trained: true, attnByBlock: [[Array.from({ length: L }, () => one(3)), Array.from({ length: L }, () => one(9))]] };
  const h0 = f(d, 0, L - 1, L), h1 = f(d, 1, L - 1, L), all = f(d, -1, L - 1, L);
  chk(h0 && h0[3] === 1 && h0[9] === 0, "헤드 #0 을 고르면 헤드 #0 만 본다", "헤드 선택이 안 먹는다 — 다른 헤드가 섞인다");
  chk(h1 && h1[9] === 1 && h1[3] === 0, "헤드 #1 을 고르면 헤드 #1 만 본다", "헤드 선택이 안 먹는다");
  chk(all && Math.abs(all[3] - 0.5) < 1e-9 && Math.abs(all[9] - 0.5) < 1e-9,
    "'전체' 는 헤드 평균이다(합이 아니다 — 합이면 비중이 1 을 넘는다)", "전체 집계가 평균이 아니다");
  chk(Math.abs(all.reduce((a, b) => a + b, 0) - 1) < 1e-9, "집계 결과의 합이 1 이다", "집계 합이 1 이 아니다 — 비중으로 못 읽는다");
  /* 행 선택 — 다른 시점을 고르면 다른 행을 봐야 한다. */
  const d2 = { trained: true, attnByBlock: [[Array.from({ length: L }, (_, t) => one(t))]] };
  chk(f(d2, 0, 2, L)[2] === 1 && f(d2, 0, 11, L)[11] === 1,
    "보는 시점을 바꾸면 그 시점의 행을 읽는다", "★행 선택이 고정돼 있다 — 어느 시점을 골라도 같은 그림이다★");
  /* ★없으면 null.★ 0 배열을 주면 화면은 "아무 데도 안 본다" 는 틀린 말을 그린다. */
  chk(f({ trained: false }, -1, 0, L) === null && f({ trained: true, attnByBlock: null }, -1, 0, L) === null,
    "어텐션이 없으면 null 이다(0 으로 채우지 않는다)", "없는 어텐션을 0 으로 채운다 — '안 본다' 는 틀린 그림이 된다");
  /* ★미학습 표시인데 어텐션 배열이 남아 있는 상태★ 는 실제로 생긴다(캐시된 옛 응답 위에
     새 미학습 응답이 얹히는 경로). 그때 옛 어텐션을 그리면 학습도 안 된 모델이
     "이 시점을 본다" 고 말하게 된다 — trained 를 보는 이유가 그것이다. */
  chk(f({ trained: false, attnByBlock: [[Array.from({ length: L }, () => one(3))]] }, -1, L - 1, L) === null,
    "미학습 응답에 옛 어텐션이 남아 있어도 그리지 않는다", "★미학습인데 남아 있던 어텐션을 그린다★");
  chk(f({ trained: true, attnByBlock: [[]] }, 5, 0, L) === null, "없는 헤드를 고르면 null 이다", "없는 헤드에서 값을 만든다");
}

console.log("\n⑥ 배선 — 탭·라우팅·기본 시점");
{
  chk(/data-model="seq"/.test(HV), "구조 관측 탭에 SEQ 가 있다", "탭이 없다 — 화면을 열 방법이 없다");
  chk(/\['seq','SEQ/.test(HV), "사이드바 모델 목록에도 있다(고른 모델이 활성표시된다)", "사이드바 목록에 빠졌다");
  chk(/\(modelSel === "seq"\) \? await mlSeqVizData\(env\.DB\)/.test(code),
    "서버가 seq 를 전용 렌더러 데이터로 보낸다", "★탭은 있는데 라우팅이 없다 — 조용히 DNN 구조를 보여준다★");
  chk(/d\.kind === 'seq'\)\{ NNV_renderSeq3D\(d\); return; \}/.test(HV),
    "화면이 kind==='seq' 를 3D 렌더러로 보낸다", "3D 렌더러로 안 간다 — 다른 렌더러가 잘못 그린다");
  const seq3d = grabFn("NNV_renderSeq3D") || "";
  chk(/SQ3\.row = L-1/.test(seq3d.replace(/\s/g, " ")) || /SQ3\.row\s*=\s*L\s*-\s*1/.test(seq3d),
    "기본으로 보는 시점은 ★마지막★ 이다 — 모델이 실제로 읽는 자리다", "기본 시점이 마지막이 아니다 — 첫 화면이 안 쓰이는 자리를 보여준다");
  chk(/vizSeq: _vz/.test(code) && /body\.probe\[0\]/.test(code),
    "관측용 표본은 probe(트레이너 검증구간 실제 행)에서 온다", "관측 표본의 출처가 없다");
}

console.log(fails === 0 ? "\n✓ SEQ 3D 관측 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
