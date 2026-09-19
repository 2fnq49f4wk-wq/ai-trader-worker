// [V33.394] ★워커가 정말 그 모델을 돌리는가★ — DNN 만 변환정합 검사가 없었다
//
//   GBDT·단타·SEQ·MEMO 는 업로드 때 probe 로 "워커 추론이 트레이너 확률을 재현하는가" 를
//   확인하고, 못 하면 승격을 막는다. ★DNN 만 없었다.★ 그런데 DNN 은 변환이 제일 많다:
//     ① BatchNorm 접기   relu(BN(Wx+b)) → relu(W'x+b'),  a = gamma/sqrt(var+eps)
//     ② τ* 를 마지막 층 bias 에 굽기
//     ③ 접힌 계수를 ★소수 5자리로 반올림★ 해서 전송
//   ③이 특히 위험하다 — gamma 가 작아 a 가 작으면 W' 가 1e-6 수준이 되어 ★0 으로 반올림★ 된다.
//   그 채널은 조용히 사라지고, "검증 47.3%" 는 이 워커가 계산하는 값이 아니게 된다.
//   이 게이트는 ★접기를 실제로 돌려★ 확인하고, 워커의 판정 경로를 ★실행으로★ 확인한다.
import fs from "node:fs";
const S = fs.readFileSync("src/index.js", "utf8");
const PY = fs.readFileSync("trainer/modal/modal_train.py", "utf8");
const M = await import("../src/index.js");
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };

// ── ① 접기 수식이 옳은가 — ★직접 돌려★ BN 경로와 평면 경로를 대조한다 ────────────
//   y = gamma*(h-mean)/sqrt(var+eps)+beta, h = Wx+b  →  y = (a*W)x + (a*b + beta - a*mean)
{
  const rnd = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  const r = rnd(4242);
  const nIn = 6, nOut = 5;
  const W = Array.from({ length: nOut }, () => Array.from({ length: nIn }, () => r() * 0.8));
  const b = Array.from({ length: nOut }, () => r() * 0.3);
  const gamma = Array.from({ length: nOut }, () => 0.5 + Math.abs(r()));
  const beta = Array.from({ length: nOut }, () => r() * 0.2);
  const bnMean = Array.from({ length: nOut }, () => r() * 0.4);
  const bnVar = Array.from({ length: nOut }, () => 0.2 + Math.abs(r()));
  const eps = 1e-5;
  const x = Array.from({ length: nIn }, () => r() * 2);
  // 접기 전: relu(BN(Wx+b))
  const before = [];
  for (let o = 0; o < nOut; o++) {
    let h = b[o]; for (let i = 0; i < nIn; i++) h += W[o][i] * x[i];
    const y = gamma[o] * (h - bnMean[o]) / Math.sqrt(bnVar[o] + eps) + beta[o];
    before.push(Math.max(0, y));
  }
  // 접기 후: relu(W'x + b')  — 트레이너 코드와 같은 식
  const after = [];
  for (let o = 0; o < nOut; o++) {
    const a = gamma[o] / Math.sqrt(bnVar[o] + eps);
    let h = a * b[o] + (beta[o] - a * bnMean[o]);
    for (let i = 0; i < nIn; i++) h += (W[o][i] * a) * x[i];
    after.push(Math.max(0, h));
  }
  const d = Math.max(...before.map((v, i) => Math.abs(v - after[i])));
  if (!(d < 1e-12)) no(`접기수식: BN 경로와 평면 경로가 다르다(최대 ${d.toExponential(2)}) — 트레이너 식이 틀렸다`);
  else ok(`접기 수식이 BN 과 정확히 같다(최대 오차 ${d.toExponential(1)})`);
  // 트레이너가 ★그 식 그대로★ 쓰는가
  if (!/a = gamma \/ np\.sqrt\(bn_var \+ bn\.eps\)/.test(PY) || !/W = W \* a\[:, None\]/.test(PY)
      || !/b = a \* b \+ \(beta - a \* bn_mean\)/.test(PY))
    no("접기수식: 트레이너의 접기 식이 위에서 검산한 식과 다르다");
  else ok("트레이너가 검산된 그 식을 쓴다");
}

// ── ② 반올림이 ★작은 가중치를 0 으로 죽이는가★ — 위험을 수치로 못 박는다 ──────────
{
  const m = PY.match(/np\.round\(W, (\d+)\)/);
  if (!m) no("반올림: 접힌 W 의 반올림 자릿수를 못 찾겠다");
  else {
    const dg = parseInt(m[1], 10);
    const dead = Math.pow(10, -dg) / 2;          // 이보다 작은 |w| 는 0 이 된다
    ok(`접힌 W 를 소수 ${dg}자리로 보낸다 → |w| < ${dead.toExponential(0)} 인 가중치는 0 이 된다`);
    if (dg < 5) no(`반올림: 자릿수가 ${dg} 로 너무 낮다 — 접힌 계수는 커질 수 있다`);
    // 트레이너가 ★0 이 된 비율을 보고하는가★ — 안 보면 조용히 채널이 사라진다
    if (!/반올림으로 0 이 된 가중치/.test(PY))
      no("반올림: 0 으로 죽은 가중치 비율을 안 적는다 — 채널이 조용히 사라진다");
    else ok("반올림으로 0 이 된 가중치 비율을 매 회차 적는다");
  }
}

// ── ③ 트레이너가 probe 를 ★표준화 전 원본★ 으로 싣는가 ──────────────────────────
//   표준화 후 값을 싣면 워커의 mean/std·클리핑 경로가 검증에서 통째로 빠진다.
{
  const i0 = PY.indexOf("probe = [{\"x\": X[int(r)]");
  if (i0 < 0) no("정합probe: 트레이너가 probe 를 만들지 않는다");
  else ok("probe 를 만든다");
  if (/probe = \[\{"x": Xn\[/.test(PY))
    no("정합probe: 표준화 ★후★ 값을 싣는다 — 워커의 mean/std·클리핑이 검증에서 빠진다");
  else ok("표준화 전 원본 x 를 싣는다(워커의 mean/std·클리핑까지 검증된다)");
  /* ★DNN 의 meta 블록 안에서만 본다★ — 처음엔 `"probe": probe}` 를 파일 전체에서 찾았는데,
     SEQ·GBDT 업로드에도 같은 줄이 있어서 DNN 에서 빼도 게이트가 통과했다(돌연변이 D6 가 잡았다). */
  const iM = PY.indexOf("_dnn_meta = {\"featVer\": featver");
  const mb = iM >= 0 ? PY.slice(iM, PY.indexOf("_post({\"key\": KEY, \"stage\": \"begin\"}", iM)) : "";
  if (!mb) no("정합probe: DNN meta 조립부를 못 찾겠다");
  else if (!/"probe": probe/.test(mb))
    no("정합probe: 만든 probe 를 ★DNN★ 업로드 본문에 안 싣는다");
  else ok("probe 가 DNN begin 본문에 실린다");
  // 트레이너도 ★접힌 가중치로 직접 재현★ 해 오차를 찍는가 — 원인을 업로드 전에 알아야 한다
  if (!/\[변환정합\] 접기\+반올림 후 최대 확률차/.test(PY))
    no("정합probe: 트레이너가 접기 오차를 스스로 안 잰다 — 실패 원인을 워커 로그로만 추측하게 된다");
  else ok("트레이너가 접힌 가중치로 다시 채점해 오차를 찍는다");
}

// ── ④ 워커가 ★실제로 판정하는가★ — 판정식을 떼어 내 돌린다 ─────────────────────
{
  const tol = (M.DNN && M.DNN.probeTol);
  if (!(typeof tol === "number" && tol > 0 && tol <= 0.05))
    no(`정합probe: DNN.probeTol 이 없거나 이상하다(${tol}) — 문턱이 없으면 검사도 없다`);
  else ok(`허용오차 DNN.probeTol = ${tol}`);
  const i0 = S.indexOf("let _probeDiff = null, _probeN = 0, _probeWhy = null;");
  const i1 = S.indexOf("return await _finishImport(saveInfo, stg.valAcc", i0);
  const blk = i0 >= 0 && i1 >= 0 ? S.slice(i0, i1) : "";
  if (!blk) { no("정합probe: 워커의 정합 검증부를 못 찾겠다"); }
  else {
    if (!/mlDNNScore\(_m, pr\.x\)/.test(blk))
      no("정합probe: 워커가 ★자기 추론기★ 로 재현을 확인하지 않는다 — 다른 경로로 재면 뜻이 없다");
    else ok("워커가 mlDNNScore(라이브와 같은 함수)로 재현을 확인한다");
    if (!/trusted: false/.test(blk) || !/wDnn: 0/.test(blk))
      no("정합probe: 정합 실패인데 승격을 안 막는다");
    else ok("정합 실패면 저장은 하되 ★승격을 막는다★(wDnn 0)");
    if (!/log\(env\.DB, "ERROR"/.test(blk))
      no("정합probe: 정합 실패를 ERROR 로 안 남긴다 — 조용히 억제되면 아무도 모른다");
    else ok("정합 실패를 ERROR 로 남긴다");
    // 판정식을 떼어 내 경계에서 돌린다 — 문턱 위/아래가 실제로 갈리는가
    const decide = (md) => (md > tol);
    if (!(decide(tol + 1e-9) === true && decide(tol) === false && decide(0) === false))
      no("정합probe: 문턱 판정이 경계에서 뒤집히지 않는다");
    else ok("문턱 판정이 경계에서 정확히 갈린다(> tol 만 실패)");
  }
  // probe 가 없던 회차를 ★정합 통과로 위장하지 않는가★
  if (!/정합 미확인 — probe 미동봉\(구버전 학습기\)/.test(S))
    no("정합probe: probe 가 없을 때 '미확인' 이라고 말하지 않는다 — 없는 검사를 통과로 읽게 된다");
  else ok("probe 가 없으면 '미확인' 이라고 말한다(통과로 위장하지 않는다)");
}

// ── ⑤ 결과가 ★화면까지★ 가는가 ─────────────────────────────────────────────────
{
  if (!/trust\.probeMaxDiff = _num\(_vs\.probeMaxDiff, null\);/.test(S))
    no("정합probe: 정합 오차를 trust 에 안 남긴다 — 화면이 말할 근거가 없다");
  else ok("정합 오차가 dnn_trust 에 남는다");
  if (!/★변환정합 실패★ 최대 확률차/.test(S))
    no("정합probe: 화면이 정합 실패를 말하지 않는다");
  else ok("전체 구조 화면이 정합 실패를 사유로 적는다");
  if (!/정합 미확인\(구버전 학습기\)/.test(S))
    no("정합probe: 정합을 확인 못 한 모델을 화면이 그냥 '신뢰 통과' 로만 적는다");
  else ok("정합 미확인도 화면이 그대로 적는다");
}

console.log(bad ? `\nDNN 변환정합 게이트 실패 ${bad}건` : "\nDNN 변환정합 게이트 통과");
process.exit(bad ? 1 : 0);
