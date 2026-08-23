// [V33.209] 메타모델 비선형 헤드 계약 게이트
//   STACK 은 전문가 8명의 확률 + 참여마스크(16차원)를 받아 위원회 결합확률을 ★통째로 대체★ 하는
//   자리다. 그 결합기가 지금까지 선형 로지스틱이었다 — 즉 "전문가마다 고정 가중치" 밖에 표현 못 했다.
//   스태킹에서 값이 나오는 구조(조건부 신뢰·마스크 상호작용·과신 구간의 비단조 반응)는 전부
//   상호작용 항이라 선형으로는 원리상 못 잡는다. 그래서 GBDT·MLP 헤드를 후보로 세웠다.
//
//   ★비선형은 공짜가 아니다.★ 후보를 여럿 재고 최고를 고르는 순간 세 가지가 동시에 무너질 수 있다:
//     ① 조기종료를 홀드아웃으로 하면 그 홀드아웃은 더 이상 검증셋이 아니다(학습셋이다).
//     ② 후보 K개의 최댓값은 단일검정과 다른 분포다 — 같은 t 문턱을 대면 잡음이 통과한다.
//     ③ 학습 때 쓴 좌표(표준화)와 채점 때 쓴 좌표가 다르면 완전히 다른 함수가 배포된다.
//   이 게이트는 그 셋을 막는다. 하나라도 뚫리면 "비선형이 더 좋다" 는 결론이 과적합의 다른 이름이 된다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
const src = fs.readFileSync("src/index.js", "utf8");
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };

/* 구현체를 ★src/index.js 에서 그 자리에서 뽑아★ 돌린다. 사본을 저장소에 두면 사본이
   본체와 갈라지고, 그때부터 이 게이트는 배포되지 않는 코드를 검사하게 된다. */
async function _loadImpl() {
  const grab = (name) => {
    const i = src.indexOf("function " + name + "(");
    if (i < 0) throw new Error("추출 실패: " + name);
    let d = 0, j = src.indexOf("{", i);
    for (let k = j; k < src.length; k++) {
      if (src[k] === "{") d++;
      else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); }
    }
    throw new Error("괄호 불일치: " + name);
  };
  const names = ["_mlpFit", "_mlpProb", "_gbdtHistPrep", "_gbdtBuild", "_gbdtFit",
                 "_gbdtTreeOut", "_gbdtRaw", "_gbdtLeaf", "_metaStdz", "stackScore", "flowScore"];
  const pick = (re) => { const m = src.match(re); if (!m) throw new Error("추출 실패: " + re); return m[0]; };
  const body =
    "const _num=(v,d)=>{const n=Number(v);return isFinite(n)?n:d;};\n" +
    "const _clamp=(v,a,b)=>v<a?a:(v>b?b:v);\n" +
    "const _sigmoid=x=>1/(1+Math.exp(-x));\n" +
    "const _logitD=p=>{const q=_clamp(p,1e-4,1-1e-4);return Math.log(q/(1-q));};\n" +
    "const LUXML={featNames:new Array(65).fill(0)};\n" +
    pick(/const GBDT = \{[\s\S]*?\n\};/) + "\n" +
    pick(/const _GBDT_MAXBINS[^\n]*\n/) +
    pick(/const _histG[^\n]*\n/) + pick(/const _histH[^\n]*\n/) +
    names.map(grab).join("\n\n") + "\nexport {" + names.join(",") + "};\n";
  const f = path.join(os.tmpdir(), "meta-heads-" + process.pid + ".mjs");
  fs.writeFileSync(f, body, "utf8");
  try { return await import(url.pathToFileURL(f).href); }
  finally { try { fs.unlinkSync(f); } catch (e) {} }
}

const seg = (from, to, len) => {
  const i = src.indexOf(from);
  if (i < 0) return null;
  return to ? src.slice(i, src.indexOf(to, i) > 0 ? src.indexOf(to, i) : i + (len || 4000)) : src.slice(i, i + (len || 4000));
};

// ── ① 헤드 경합은 켠 곳에서만 돈다 ───────────────────────────────────────────
{
  if (!/opts\.nonlinear/.test(src)) no("헤드: 비선형 경합 스위치(opts.nonlinear)가 없다");
  else ok("비선형 경합은 opts.nonlinear 로만 켜진다");
  const st = seg("async function stackTrainNightly", "\n}\n", 1600);
  if (!st || !/nonlinear:\s*true/.test(st)) no("헤드: STACK 이 비선형 경합을 켜지 않는다");
  else ok("STACK 은 비선형 경합을 켠다");
  for (const [fn, tag] of [["async function flowTrainNightly", "FLOW"], ["async function xalphaTrainNightly", "XALPHA"]]) {
    const s2 = seg(fn, "\n}\n", 1200);
    if (s2 && /nonlinear:\s*true/.test(s2))
      no(`헤드: ${tag} 까지 비선형으로 켰다 — 1차 전문가는 선형으로 두는 게 스태킹의 분업이다`);
  }
  ok("1차 전문가(FLOW/XALPHA)는 선형 그대로");
}

// ── ② 조기종료가 홀드아웃을 만지지 않는다 ★가장 중요★ ──────────────────────
//   홀드아웃으로 트리 수·에폭을 고르면 그 성적은 검증이 아니라 적합이다. 하한이 부풀고,
//   그 부푼 하한으로 "비선형이 선형을 이겼다" 를 판정하게 된다 — 판정 자체가 오염된다.
{
  const s2 = seg("if (opts.nonlinear) {", "let correct = 0;", 6000);
  if (!s2) no("헤드: 경합 블록을 찾을 수 없다");
  else {
    if (!/_trHi\s*=\s*ntr\s*-\s*_nIn/.test(s2))
      no("헤드: GBDT 내부검증이 학습구간(ntr) 안에서 잘리지 않는다 — 홀드아웃으로 조기종료할 위험");
    else ok("GBDT 조기종료는 학습구간 뒤쪽(ntr 안)에서만 — 홀드아웃 불가침");
    if (/_gbdtFit\([^)]*nvalStart/.test(s2) || /for \(let i = nvalStart[\s\S]{0,200}_tr\.push/.test(s2))
      no("헤드: GBDT 학습셋에 홀드아웃 구간이 섞였다");
    else ok("GBDT 학습셋에 홀드아웃이 섞이지 않는다");
    if (!/_mlpFit\(Z, Y, uw, 0, ntr, D/.test(s2))
      no("헤드: MLP 가 학습구간(0..ntr)만 받지 않는다");
    else ok("MLP 도 학습구간(0..ntr)만 받는다");
  }
  const mf = seg("function _mlpFit(", "\n}\n_", 9000) || seg("function _mlpFit(", null, 9000);
  if (!mf) no("헤드: _mlpFit 이 없다");
  else {
    if (!/const trHi = hi - nIn;/.test(mf))
      no("헤드: MLP 조기종료용 내부검증이 자기가 받은 구간 안에서 잘리지 않는다");
    else ok("MLP 조기종료도 자기가 받은 구간 뒤 15% 로만 — 홀드아웃 불가침");
  }
}

// ── ③ 자(ruler)는 후보를 고르기 ★전★ 에 정해진다 ────────────────────────────
//   유효표본수를 후보별로 다시 재면 자가 후보를 따라 움직인다. 그러면 하한 비교가 성립하지 않는다.
{
  const s2 = seg("let _nEffPre = 0;", "let correct = 0;", 7000);
  if (!s2) no("헤드: 선택 전 유효표본수(_nEffPre) 계산이 없다");
  else {
    const iPre = src.indexOf("let _nEffPre = 0;");
    const iSel = src.indexOf("if (opts.nonlinear) {");
    if (!(iPre > 0 && iSel > iPre))
      no("헤드: 유효표본수를 헤드 경합 뒤에 잰다 — 자가 후보를 따라 움직인다");
    else ok("유효표본수(하한의 n)는 헤드 경합 ★전★ 에 한 번만 잰다");
    if (!/_wilsonLB\(acc, _nEffPre\)/.test(s2) || !/_wilsonLB\(a, _nEffPre\)/.test(s2))
      no("헤드: 후보 비교에 같은 자(_nEffPre 기준 Wilson 하한)를 쓰지 않는다");
    else ok("모든 후보를 같은 자로 잰다 — 정확도의 Wilson 하한");
    /* ★선택문 자체★ 를 본다. 마진 상수가 파일 어딘가에 있기만 하면 통과하게 두면,
       선택은 정확도로 하면서 상수만 남겨 두는 변경이 그대로 지나간다(실측으로 뚫렸다). */
    const _sel = s2.match(/for \(let c = 1; c < _cand\.length; c\+\+\) \{[\s\S]{0,300}?\n\s*\}/);
    if (!_sel) no("헤드: 승자 선택 루프를 찾을 수 없다");
    else if (!/_cand\[c\]\.lb\s*>\s*_win\.lb\s*\+/.test(_sel[0]))
      no("헤드: 승자를 하한(lb)+마진으로 고르지 않는다 — 우연히 앞선 정도로 결합기가 바뀐다");
    else if (!/_mar/.test(_sel[0]))
      no("헤드: 선형을 갈아치우는 마진이 선택문에 없다");
    else if (!/_num\(opts\.nlMargin, 0\.005\)/.test(s2))
      no("헤드: 마진 값이 설정에서 오지 않는다");
    else ok("선형이 기본값이고, 갈아타려면 ★하한★ 에서 마진만큼 앞서야 한다(선택문 확인)");
  }
}

// ── ④ 다중검정 보정 ───────────────────────────────────────────────────────
{
  const s2 = seg("const _tMinBase = _tMin;", "const _bIC =", 1800);
  if (!s2) no("헤드: 다중검정 보정 블록이 없다");
  else {
    if (!/_headTag !== "lin"/.test(s2))
      no("헤드: 선형이 그대로 이겼을 때도 벌을 준다/안 준다가 불명확하다");
    else ok("보정은 ★갈아탄 경우★ 에만 — 고르지 않았으면 벌이 없다");
    if (!/icTMinNow\(\{ k: _kFam \* _headK \}/.test(s2))
      no("헤드: 후보 수를 가족 크기에 곱해 t 문턱을 올리지 않는다 — K개 최댓값에 단일검정 문턱을 댄다");
    else ok("후보 수만큼 가족 크기를 늘려 같은 산식(Φ⁻¹(1−α/k))으로 문턱을 올린다");
    if (!/_tAdj > _tMin/.test(s2))
      no("헤드: 보정이 문턱을 낮추는 방향으로도 작동할 수 있다");
    else ok("보정은 문턱을 올리는 방향으로만 적용된다");
  }
}

// ── ⑤ 학습한 것과 같은 것으로 채점한다 ────────────────────────────────────
{
  if (!/function stackScore\(/.test(src)) no("헤드: stackScore 채점기가 없다");
  else ok("헤드별 채점기(stackScore)가 있다");
  const ss = seg("function stackScore(", "\n}\n", 3000);
  if (ss) {
    if (!/_metaStdz\(model, featVec\)/.test(ss))
      no("헤드: 비선형 채점이 학습 때와 같은 표준화를 적용하지 않는다 — 다른 함수가 배포된다");
    else ok("비선형 채점은 학습 때와 같은 표준화(train 평균·표준편차, ±4 클램프) 위에서 돈다");
    if (!/head === "lin"/.test(ss) || !/model\.head/.test(ss))
      no("헤드: 채점기가 model.head 를 보지 않는다");
    else ok("채점기는 모델에 실린 head 를 따른다 — 채점 쪽에서 다시 판단하지 않는다");
    if (!/return flowScore\(model, featVec\)/.test(ss))
      no("헤드: 헤드가 유실됐을 때 선형으로 되돌아가지 않는다");
    else ok("헤드 유실 시 선형 폴백");
  }
  if (/const pS = flowScore\(sm, _stackFeat\)/.test(src))
    no("헤드: 운영 채점이 아직 flowScore 를 쓴다 — 비선형으로 학습하고 선형으로 채점하게 된다");
  else ok("운영 채점이 stackScore 로 간다");
  const fw = seg("_fwd = await icForwardCheck(DB, {", "});", 1200);
  if (!fw || !/opts\.nonlinear \? stackScore/.test(fw))
    no("헤드: 전진검증이 그 모델의 실제 채점기를 쓰지 않는다 — 게이트가 다른 모델을 검증한다");
  else ok("전진검증도 같은 채점기를 쓴다");
}

// ── ⑥ 재현성: 같은 표본이면 같은 모델 ─────────────────────────────────────
//   후보끼리 하한 0.5%p 로 승부를 가르는데 후보 자체가 밤마다 흔들리면 승자가 난수가 된다.
{
  const gf = seg("function _gbdtFit(train, val, opts) {", "\n}\n", 4000);
  if (!gf) no("헤드: _gbdtFit 을 찾을 수 없다");
  else {
    if (!/opts\.rng/.test(gf)) no("헤드: GBDT 서브샘플 난수원을 주입할 수 없다 — 밤마다 다른 모델이 나온다");
    else ok("GBDT 난수원을 주입할 수 있다(안 주면 종전 Math.random — 기존 호출부 무변화)");
    if (/Math\.random\(\) < GBDT\.(subsample|colsample)/.test(gf))
      no("헤드: GBDT 서브샘플이 아직 Math.random 을 직접 쓴다");
    else ok("GBDT 서브샘플·컬럼샘플이 주입된 난수원을 쓴다");
  }
  const s2 = seg("if (opts.nonlinear) {", "let correct = 0;", 6000);
  if (!s2 || !/rng: _rng/.test(s2)) no("헤드: 메타 GBDT 에 고정 씨앗을 넘기지 않는다");
  else ok("메타 GBDT 는 고정 씨앗으로 돈다");
  const mf = seg("function _mlpFit(", null, 9000);
  if (mf && !/_seed = 20250209/.test(mf)) no("헤드: MLP 초기화가 시드 고정이 아니다");
  else ok("MLP 초기화도 시드 고정");
}

// ── ⑦ 출력층 0 초기화 금지 ────────────────────────────────────────────────
//   d1 = e·W2[h]·(1−tanh²) 이므로 W2 가 전부 0 이면 은닉층 기울기가 0 이다. 그러면 은닉층이
//   무작위 고정 피처로 남아 '비선형 헤드' 라는 이름만 남는다.
{
  const mf = seg("function _mlpFit(", null, 9000);
  if (mf && /const W2 = new Array\(H\)\.fill\(0\)/.test(mf))
    no("헤드: MLP 출력층을 0 으로 초기화한다 — 은닉층 기울기가 0 이라 학습되지 않는다");
  else ok("MLP 출력층을 난수로 초기화한다(대칭 파괴)");
}

// ── ⑧ 수치 재현 ─────────────────────────────────────────────────────────
//   계약을 문장으로만 두면 "그렇게 짜여 있다" 까지밖에 확인 못 한다. 실제로 돌려서
//   ⑴ 선형이 원리상 못 푸는 문제를 비선형이 푸는지 ⑵ 같은 씨앗이면 같은 모델인지를 잰다.
{
  const D = 16, N = 1600, ntr = 1280;
  let sd = 777 >>> 0;
  const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const X = [], Y = [];
  for (let i = 0; i < N; i++) {
    const x = []; for (let j = 0; j < D; j++) x.push(rnd() * 2 - 1);
    X.push(x);
    const sig = 3 * x[0] * x[1];        // XOR — 초평면 하나로는 절대 안 갈린다
    Y.push(rnd() < 1 / (1 + Math.exp(-sig)) ? 1 : 0);
  }
  const accOf = (f) => { let c = 0; for (let i = ntr; i < N; i++) if ((f(X[i]) >= 0.5 ? 1 : 0) === Y[i]) c++; return c / (N - ntr); };
  // 선형 로지스틱(본체와 같은 하이퍼)
  const w = new Array(D).fill(0); let b = 0;
  for (let ep = 0; ep < 400; ep++) {
    const gw = new Array(D).fill(0); let gb = 0;
    for (let i = 0; i < ntr; i++) {
      let z = b; for (let j = 0; j < D; j++) z += w[j] * X[i][j];
      const p = 1 / (1 + Math.exp(-z)), e = p - Y[i];
      for (let j = 0; j < D; j++) gw[j] += e * X[i][j]; gb += e;
    }
    for (let j = 0; j < D; j++) w[j] -= 0.08 * (gw[j] / ntr + 1.5 / ntr * w[j]);
    b -= 0.08 * (gb / ntr);
  }
  const accLin = accOf((x) => { let z = b; for (let j = 0; j < D; j++) z += w[j] * x[j]; return 1 / (1 + Math.exp(-z)); });
  const H = await _loadImpl();
  const uw = new Array(N).fill(1);
  const mlp = H._mlpFit(X, Y, uw, 0, ntr, D, { hidden: 10, l2: 1.5, deadline: Date.now() + 60000 });
  const accMlp = mlp ? accOf((x) => H._mlpProb(mlp, x)) : 0;
  const nIn = Math.max(20, Math.floor(ntr * 0.15)), trHi = ntr - nIn, tr = [], iv = [];
  for (let i = 0; i < trHi; i++) tr.push({ x: X[i], y: Y[i], mw: 1 });
  for (let i = trHi; i < ntr; i++) iv.push({ x: X[i], y: Y[i], mw: 1 });
  const mkRng = () => { let s = 20250209 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const g1 = H._gbdtFit(tr, iv, { D, maxTrees: 160, deadline: Date.now() + 60000, rng: mkRng() });
  const g2 = H._gbdtFit(tr, iv, { D, maxTrees: 160, deadline: Date.now() + 60000, rng: mkRng() });
  const accGb = accOf((x) => 1 / (1 + Math.exp(-H._gbdtRaw(g1, x))));

  if (accLin > 0.55) no(`헤드: 선형이 XOR 을 ${(accLin * 100).toFixed(1)}% 로 풀었다 — 재현 문제가 계약을 증명하지 못한다`);
  else ok(`선형은 XOR 을 못 푼다 ${(accLin * 100).toFixed(1)}% (초평면 하나로는 안 갈린다 — 원리상 그렇다)`);
  if (!(accMlp > accLin + 0.08)) no(`헤드: MLP 가 XOR 에서 선형을 못 이긴다 ${(accMlp * 100).toFixed(1)}% — 구현이 학습하지 않는다`);
  else ok(`MLP 는 XOR 을 푼다 ${(accMlp * 100).toFixed(1)}% (선형 대비 +${((accMlp - accLin) * 100).toFixed(1)}%p)`);
  if (!(accGb > accLin + 0.05)) no(`헤드: GBDT 가 XOR 에서 선형을 못 이긴다 ${(accGb * 100).toFixed(1)}%`);
  else ok(`GBDT 도 XOR 을 푼다 ${(accGb * 100).toFixed(1)}% · 트리 ${g1.trees.length}`);

  let mx = 0; for (let i = ntr; i < N; i++) mx = Math.max(mx, Math.abs(H._gbdtRaw(g1, X[i]) - H._gbdtRaw(g2, X[i])));
  if (mx > 0) no(`헤드: 같은 씨앗인데 두 번 학습한 GBDT 출력이 다르다(최대차 ${mx})`);
  else ok("같은 씨앗이면 GBDT 가 비트 단위로 같은 모델을 낸다");

  // 채점 왕복 — 학습 때 확률과 stackScore 의 확률이 같아야 한다(표준화 좌표 일치 확인).
  const mean = new Array(D).fill(0), std = new Array(D).fill(1);
  const model = { w, b, mean, std, head: "blend", gbdt: { trees: g1.trees, eta: g1.eta, bias: g1.bias }, mlp };
  const lgt = (p) => Math.log(Math.max(1e-4, Math.min(1 - 1e-4, p)) / (1 - Math.max(1e-4, Math.min(1 - 1e-4, p))));
  let rt = 0;
  for (let i = ntr; i < N; i++) {
    const pl = 1 / (1 + Math.exp(-(function () { let z = b; for (let j = 0; j < D; j++) z += w[j] * X[i][j]; return z; })()));
    const pg = Math.max(0.001, Math.min(0.999, 1 / (1 + Math.exp(-H._gbdtRaw(g1, X[i])))));
    const pm = H._mlpProb(mlp, X[i]);
    const want = Math.max(0.001, Math.min(0.999, 1 / (1 + Math.exp(-((lgt(pl) + lgt(pg) + lgt(pm)) / 3)))));
    rt = Math.max(rt, Math.abs(H.stackScore(model, X[i]) - want));
  }
  if (rt > 1e-12) no(`헤드: 채점 왕복이 학습 때 확률과 다르다(최대차 ${rt.toExponential(2)})`);
  else ok("채점 왕복 오차 0 — 학습한 함수와 배포되는 함수가 같다");
}

if (bad) { console.error(`\n메타 헤드 계약 위반 ${bad}건 — 배포 차단`); process.exit(1); }
console.log("  ok   메타모델 비선형 헤드 계약 통과 — 비선형은 같은 자로 이겼을 때만 들어온다");
