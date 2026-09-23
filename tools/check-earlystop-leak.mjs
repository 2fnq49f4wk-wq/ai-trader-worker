// [V33.388] ★멈출 때를 고르는 행과 채점하는 행이 같으면 점수가 부푼다★
//
//   이 저장소는 같은 종류의 누출을 이미 두 번 막았다 — τ*(V33.341)를 검증 앞 절반에서
//   고르던 것, SEQ 가 엠바고 없이 검증받던 것(B-2). 그런데 ★조기중단★ 은 전 학습기에서
//   그대로 남아 있었다: 검증구간 손실이 가장 낮은 판(에폭·트리 수)을 고르고, 그 판의
//   정확도·Wilson 하한·블록 IC 를 ★같은 검증행★ 에서 냈다. 후보가 600~1,000판이다.
//   최댓값을 고른 자로 채점하면 그 최댓값은 실력이 아니라 운을 포함한다.
//
//   고친 방향: 학습 꼬리에서 ★보정구간★ 을 떼어 거기서 멈출 때를 고른다.
//   엠바고가 검증과 갈라 놓으므로 누출이 없고, 검증은 채점에만 쓴다.
//   ★이 변경은 보고되는 숫자를 낮춘다 — 낮아진 쪽이 참이다.★
//
//   이 게이트는 학습기별로 "멈추는 판단이 검증행을 보는가" 를 소스 구조로 확인한다.
//   문자열 한 줄이 아니라, 각 학습부 블록을 잘라서 그 안의 평가집합 인자를 본다.
import fs from "node:fs";
const py = fs.readFileSync("trainer/modal/modal_train.py", "utf8");
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };

const cut = (from, to, after = 0) => {
  const i = py.indexOf(from, after);
  if (i < 0) return null;
  const j = py.indexOf(to, i);
  return j < 0 ? null : py.slice(i, j);
};

// ── ① 학습기별 "멈출 때를 고르는 자리" 가 검증행을 안 본다 ───────────────────
const sites = [
  { name: "DNN(에폭 조기중단)",
    blk: cut("_esX, _esY = ", "if best_state: net.load_state_dict"),
    must: [/_esX, _esY = \(Xcal, Ycal_t\) if _hasCal else \(Xva, Yva\)/,
           /vl = \(nn\.functional\.binary_cross_entropy_with_logits\(\s*net\(_esX, False\)/],
    forbid: [/if vl < best[\s\S]*?net\(Xva/] },
  { name: "GBDT(트리 수 조기중단)",
    blk: cut("raw = np.full(Ntr, bias); eraw", "if best_k > 0:"),
    must: [/eraw = eraw \+ ETA \* apply_tree\(tree, Xes\)/,
           /vloss = float\(-np\.mean\(Yes \*/],
    forbid: [/apply_tree\(tree, Xva\)/, /np\.mean\(Yva \*/] },
  { name: "XGBoost",
    blk: cut("dtr = xgb.DMatrix(Xtr", "def _pxgb("),
    must: [/des = xgb\.DMatrix\(Xes, label=Yes/, /evals=\[\(des, "es"\)\]/],
    forbid: [/evals=\[\(dva/, /xgb\.DMatrix\(Xva, label=Yva/] },
  { name: "LightGBM",
    blk: cut("ltr = lgb.Dataset(Xtr, label=Ytr, weight=Wtr)\n        # [V33.388]", "def _plgb("),
    must: [/les = lgb\.Dataset\(Xes, label=Yes/, /valid_sets=\[les\]/],
    forbid: [/valid_sets=\[lva\]/, /lgb\.Dataset\(Xva, label=Yva/] },
  { name: "CatBoost",
    blk: cut("cb = CatBoostClassifier(", "tf = tempfile.mktemp"),
    must: [/eval_set=\(Xes, Yes\)/],
    forbid: [/eval_set=\(Xva, Yva\)/] },
  { name: "시장별 LGBM",
    blk: cut("_d1 = lgb.Dataset(Xtr, label=Ytr, weight=Wtr)\n            #", "cand.append((\"lgbm\""),
    must: [/_d2 = lgb\.Dataset\(Xes, label=Yes/],
    forbid: [/lgb\.Dataset\(Xva, label=Yva/] },
  { name: "DoubleEnsemble",
    blk: cut("def _train_double_ensemble(", "    print(f\"   DoubleEnsemble: 서브모델"),
    must: [/def _train_double_ensemble\(Xtr, Ytr, Xes, Yes/, /dv = lgb\.Dataset\(Xes\[:, feat_idx\], label=Yes/],
    forbid: [/Xva|Yva/] },
  { name: "단타(스칼프) LGBM",
    blk: cut("_ncal = int(len(Ytr) * 0.10)", "best = bst.best_iteration or 700"),
    must: [/les = lgb\.Dataset\(Xes, label=Yes, weight=Wes/, /valid_sets=\[les\]/],
    forbid: [/valid_sets=\[lva\]/] },
];
for (const s of sites) {
  if (!s.blk) { no(`조기중단누출: ${s.name} — 학습부 블록을 못 찾겠다(구조가 바뀌었다)`); continue; }
  let okAll = true;
  for (const re of s.must) if (!re.test(s.blk)) { no(`조기중단누출: ${s.name} — 보정구간에서 멈출 때를 고르지 않는다 (${re})`); okAll = false; }
  for (const re of s.forbid) if (re.test(s.blk)) { no(`조기중단누출: ${s.name} — 멈추는 판단이 ★검증행★ 을 본다 (${re})`); okAll = false; }
  if (okAll) ok(`${s.name} — 멈출 때는 보정행, 채점은 검증행`);
}

// ── ② 보정구간이 ★실제로 만들어진다★ ─────────────────────────────────────────
//   cal_frac 을 안 주면 _split_ts 는 빈 배열을 돌려준다 — 그러면 전부 검증으로 떨어진다.
// [V33.422] DNN 퇴역 — 남은 학습 경로만 본다.
for (const tag of ["부스팅", "시장별", "tag=tag"]) {
  const re = new RegExp(`_split_ts\\([^)]*?cal_frac=0\\.10[^)]*?tag=${tag === "tag=tag" ? "tag" : `"${tag}"`}`, "s");
  if (!re.test(py)) no(`조기중단누출: ${tag} 분할에 cal_frac 이 없다 — 보정구간이 비어 전부 검증으로 떨어진다`);
}
ok("DNN·부스팅·시장별·GBDT 네 분할이 보정구간을 실제로 뗀다(cal_frac=0.10)");

// 단타는 _split_ts 를 안 쓰고 직접 나눈다 — 거기서도 꼬리를 떼는지 본다.
{
  const blk = cut("_ncal = int(len(Ytr) * 0.10)", "print(\"   [조기중단] 기준=");
  if (!blk) no("조기중단누출: 단타의 보정구간 분리부를 못 찾겠다");
  else if (!/Xtr, Ytr, Wtr = Xtr\[:-_ncal\], Ytr\[:-_ncal\], Wtr\[:-_ncal\]/.test(blk))
    no("조기중단누출: 단타가 보정구간을 학습에서 ★빼지 않는다★ — 그러면 그 구간 예측이 부풀어 조기중단이 늦어진다");
  else ok("단타가 보정구간을 학습에서 뺀다(같은 행으로 배우고 멈출 때를 고르지 않는다)");
}

// ── ③ 보정구간이 모자랄 때 ★조용히 넘어가지 않는다★ ─────────────────────────
//   폴백 자체는 옳다(없으면 못 고른다). 다만 그 회차 점수가 부풀어 있다는 것을 말해야 한다.
{
  // ★학습기 수만큼★ 있어야 한다 — 한 곳만 지워도 그 학습기는 조용히 부푼 점수를 낸다.
  const NEED = 5;   // DNN · GBDT · 부스터 · 시장별 · 단타
  const warns = py.match(/★검증\(보정구간[^"]*부풀어 있다\)★/g) || [];
  if (warns.length < NEED)
    no(`조기중단누출: 보정구간 부족 폴백 경고가 ${warns.length}/${NEED} 곳뿐이다 — 빠진 학습기는 부푼 점수를 조용히 낸다`);
  else ok(`보정구간 부족 시 ${warns.length}곳(학습기 전부)이 "이 회차 점수는 부풀어 있다" 고 말한다`);
  const gates = py.match(/_hasCal = len\((?:cal|_cali)\) >= \d+/g) || [];
  if (gates.length < 3) no("조기중단누출: _hasCal 판정이 학습기마다 없다");
  else ok(`_hasCal 판정 ${gates.length}곳 — 보정구간이 있을 때만 쓴다`);
}

// ── ④ A/B 승자도 검증행에서 고르지 않는다 ────────────────────────────────────
//   시장별 학습은 단일 LGBM 과 DoubleEnsemble 중 이긴 쪽을 올린다. 그 승부를 검증에서
//   가리면, 이긴 쪽 점수만 골라 올리는 셈이라 채점표가 또 부푼다.
{
  const blk = cut("def _ic_on(pv, yy):", "print(f\"   {mk.upper()} 채택:");
  if (!blk) no("조기중단누출: 시장별 A/B 선택부를 못 찾겠다");
  else if (!/max\(cand, key=lambda c: _ic_on\(c\[5\], Yes\)\)/.test(py))
    no("조기중단누출: A/B 승자를 보정행 IC 로 고르지 않는다 — 고른 자로 채점하게 된다");
  else ok("A/B 승자를 보정행 IC 로 고른다(검증은 기록으로만 찍는다)");
  if (!/\[기록·검증\]/.test(py))
    no("조기중단누출: 검증행 값을 '기록' 이라고 표시하지 않는다 — 선택근거로 오독된다");
  else ok("검증행 값은 [기록·검증] 로 표시돼 선택근거와 구분된다");
}

// ── ⑤ 종전 방식이 가져가던 이득의 크기를 ★적는다★ ───────────────────────────
//   고쳤다고만 하면 얼마나 부풀어 있었는지 아무도 모른다. DNN 은 매 에폭 검증손실을
//   기록만 하므로(선택엔 안 씀) 그 최솟값과 선택시점 값의 차이가 곧 종전의 이득이다.
if (!/print\(f"   \[조기중단\] 기준=/.test(py))
  no("조기중단누출: DNN 이 조기중단 기준을 로그로 말하지 않는다");
else if (!/전구간최저 \{_bs:\.4f\}/.test(py) || !/f" → 종전 방식이 가져가던 이득 \{\(_pk - _bs\):\.4f\}"\)/.test(py))
  no("조기중단누출: 종전 방식이 가져가던 이득(선택시점 vs 전구간최저)을 안 적는다 — 크기를 모르면 고친 값어치도 모른다");
else ok("종전 방식이 가져가던 이득을 매 회차 숫자로 적는다");
{
  const blk = cut("_va_at_pick, _va_best = None, 1e9", "if best_state: net.load_state_dict");
  if (!blk) no("조기중단누출: DNN 기록부를 못 찾겠다");
  else if (!/_vl_va = nn\.functional\.binary_cross_entropy_with_logits\(/.test(blk))
    no("조기중단누출: 검증손실을 기록조차 안 한다 — 편향 크기를 영영 못 잰다");
  else if (!/★기록 전용 — 선택에 안 쓴다★/.test(blk))
    no("조기중단누출: 검증손실이 기록 전용이라는 표시가 없다 — 다음 사람이 선택에 쓸 수 있다");
  else ok("검증손실은 기록 전용(선택에 안 쓴다)이라고 코드가 스스로 말한다");
}

// ── ⑥ ★워커 자체 학습기도 같은 병이었다★ ────────────────────────────────────
//   V33.388 은 Modal 8곳만 고쳤다. 워커의 폴백 DNN·GBDT 는 그대로였는데, 이게 그냥 남는
//   문제가 아니다: 워커 폴백의 accLB 는 ★외부(Modal) 모델의 accLB 와 맞대어★ 어느 쪽을
//   쓸지 정하는 데 쓰인다(dnn 재학습 경로). 한쪽만 정직해지면 그 비교가 기울어져,
//   정직해진 외부 모델이 부푼 폴백에 밀려난다 — 고치다 만 것이 안 고친 것보다 나쁜 자리다.
{
  const js = fs.readFileSync("src/index.js", "utf8");
  /* [V33.422] 워커 DNN 조기중단 계약 삭제 — DNN 퇴역으로 _dnnTrainOne 이 코드에서 사라졌다.
     (그 계약이 막던 사고 — "홀드아웃으로 멈추고 그 홀드아웃으로 채점" — 는 아래 GBDT 와
      Modal 쪽 학습기들에서 그대로 검사된다.) */
  // 워커 GBDT: innerStop 이 실제로 train 을 잘라 val 을 덮는가 + 새는 호출부 두 곳이 그걸 켜는가
  const iG = js.indexOf("if (opts.innerStop && train.length >= 80)");
  if (iG < 0) no("조기중단누출(워커): _gbdtFit 에 innerStop 이 없다 — 폴드/홀드아웃 검증으로 트리 수를 고른다");
  else {
    const blk = js.slice(iG, iG + 400);
    if (!/val = train\.slice\(train\.length - _ni\)/.test(blk) || !/train = train\.slice\(0, train\.length - _ni\)/.test(blk))
      no("조기중단누출(워커): innerStop 이 train 을 안 자르고 val 도 안 덮는다 — 이름만 있는 옵션이다");
    else ok("워커 GBDT — innerStop 이 학습 꼬리를 떼어 val 을 덮는다(넘어온 val 은 채점 전용)");
  }
  for (const [pat, why] of [
    [/_gbdtFit\(ftr, fvl, \{ maxTrees: GBDT\.cvMaxTrees, deadline: cvDeadline, innerStop: true \}\)/, "CV 폴드"],
    [/_gbdtFit\(tr, vl, \{ deadline: cvDeadline, innerStop: true \}\)/, "홀드아웃 폴백"],
  ]) if (!pat.test(js)) no(`조기중단누출(워커): GBDT ${why} 호출이 innerStop 을 안 켠다 — 그 구간 정확도가 부푼다`);
  ok("워커 GBDT 새던 호출부 2곳(CV 폴드·홀드아웃 폴백)이 innerStop 을 켠다");
  // 메타모델 경로는 ★이미★ 제대로 된 내부셋을 넘긴다 — 거기까지 켜면 두 번 뗀다.
  if (/_gbdtFit\(_tr, _in, \{ D: D,[^}]*innerStop/.test(js))
    no("조기중단누출(워커): 메타모델 경로에 innerStop 을 켰다 — 이미 내부셋을 넘기는 곳이라 두 번 뗀다");
  else ok("이미 내부셋을 넘기는 메타모델 경로는 안 건드렸다");
}

console.log(bad ? `\n조기중단 누출 게이트 실패 ${bad}건` : "\n조기중단 누출 게이트 통과");
process.exit(bad ? 1 : 0);
