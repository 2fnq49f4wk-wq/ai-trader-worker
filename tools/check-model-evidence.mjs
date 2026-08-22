// [V33.191] 모델 증거 계약 — "누가 어떤 근거로 표를 받는가" 와 "어디서 학습되는가".
//
//   세 가지 사고를 한꺼번에 못박는다.
//
//   ① DNN 이 GPU 예산과 워커 예산을 같은 값으로 쓰고 있었다.
//      운영 실측: architecture 65-640-…-32-1×4 · n 5,000 · valAcc 0.404.
//      다수클래스만 찍어도 57%(posRate 0.429) 인 라벨에서 40.4% 다. 종전 주석이 스스로
//      "순수 JS Worker 에선 완전학습이 어렵다" 고 적어 두고 있었다 — 한 번도 수렴한 적 없는
//      망이 매일 밤 만들어져 위원회 앞에 놓였다. 반대로 Modal(T4·185,408표본·400에폭·6시드)
//      에서는 그 크기를 줄일 이유가 없다. ★같은 상수를 두 예산이 나눠 쓰면 둘 다 틀린다.★
//   ② 그 DNN 이 표본까지 굶고 있었다 — 185,408건 중 5,000건, 그것도 전부 최근 구간.
//      검증 홀드아웃도 같은 며칠에서 잘리니 valAcc 가 '한 국면의 성적' 이 된다.
//   ③ 정확도 하한이 동전보다 낮은 부스터가 위원회에 있었다(XGB 0.4836 / LGB 0.4871).
//      같은 순간 워커 DNN 은 floor 50.5 에 막혀 있었다 — 한 위원회에 두 개의 잣대.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const cblk = (n) => { const i = src.indexOf("const " + n + " = {"); return src.slice(i, src.indexOf("\n};", i) + 3); };

const ctx = vm.createContext({ Math, Number, Object, Array, isFinite, console });
new vm.Script(`
function _num(v,d){var n=Number(v);return isFinite(n)?n:d;}
function _clamp(v,a,b){return v<a?a:(v>b?b:v);}
${cblk("DNN")}
${src.slice(src.indexOf("const DNNW = Object.assign({}, DNN, {"), src.indexOf("});", src.indexOf("const DNNW = Object.assign({}, DNN, {")) + 3)}
${src.slice(src.indexOf("function _coefShrink(tval) {"), src.indexOf("\n}", src.indexOf("function _coefShrink(tval) {")) + 2)}
this.DNN=DNN; this.DNNW=DNNW; this._coefShrink=_coefShrink;
`).runInContext(ctx);
const { DNN, DNNW, _coefShrink } = ctx;

const params = (D, hidden) => {
  const dims = [D].concat(hidden).concat([1]);
  let w = 0, b = 0;
  for (let i = 0; i < dims.length - 1; i++) { w += dims[i] * dims[i + 1]; b += dims[i + 1]; }
  return w + b;
};

// ── ① GPU 와 워커 구조가 분리됐는가 ────────────────────────────────────────
{
  const gpu = params(65, DNN.hidden), wk = params(65, DNNW.hidden);
  chk(/return \{ hidden: DNN\.hidden, seeds: DNN\.seeds/.test(src),
    "/api/dnn-config 는 정식(GPU) 구조를 내려보낸다 — Modal 이 큰 망을 학습한다",
    "트레이너에 내려가는 구조가 DNN.hidden 이 아니다 — GPU 가 워커용 작은 망을 학습하게 된다");
  chk(/const dims = \[D\]\.concat\(DNNW\.hidden\)/.test(src),
    "워커 폴백은 DNNW.hidden 으로 학습한다(GPU 구조와 분리)",
    "워커 폴백이 아직 GPU 구조로 학습한다 — CPU 300s 안에서 수렴할 수 없다");
  chk(gpu >= 700000, `정식(GPU) 망 용량이 유지된다 — 넷당 ${gpu.toLocaleString()} 파라미터`,
    `GPU 망이 넷당 ${gpu} 파라미터로 줄었다 — GPU 예산에서 용량을 줄일 이유가 없다`);
  /* 깊이는 ★사용자가 정한 값★ 이다(은닉 10층). 여기서 '몇 층이 옳은가' 를 게이트가 판정하지
     않는다 — 그건 코드가 아니라 사람이 정할 문제다. 게이트가 막는 것은 ★모르는 사이에 바뀌는
     것★ 이다: 아래 EXPECT 와 다르면 배포가 멈추고, 바꾸려면 이 줄을 함께 고쳐야 한다.
     (V33.188 이 10→2, V33.191 이 2→5 로 바꾸는 동안 아무 게이트도 그걸 붙잡지 못했다.) */
  const EXPECT_HIDDEN = [640, 512, 384, 256, 192, 128, 96, 64, 48, 32];
  chk(DNN.hidden.length === EXPECT_HIDDEN.length && DNN.hidden.every((v, i) => v === EXPECT_HIDDEN[i]),
    `정식 망 구조가 선언된 값과 같다 — 은닉 ${DNN.hidden.length}층 ${DNN.hidden.join("-")}`,
    `정식 망 구조가 바뀌었다: ${DNN.hidden.join("-")} ≠ ${EXPECT_HIDDEN.join("-")} — 의도한 변경이면 이 게이트의 EXPECT_HIDDEN 도 함께 고칠 것`);
  chk(gpu === 763345 && gpu * 6 === 4580070,
    `파라미터 수가 산식과 일치한다 — 넷당 ${gpu.toLocaleString()} · 6시드 ${(gpu * 6).toLocaleString()}`,
    `파라미터 수가 예상과 다르다(넷당 ${gpu}) — 구조 변경이 화면 표시와 어긋날 수 있다`);
  chk(wk < gpu / 10, `워커 폴백은 넷당 ${wk.toLocaleString()} 파라미터(GPU 망의 1/${Math.round(gpu / wk)})`,
    `워커 폴백이 넷당 ${wk} 파라미터다 — CPU 예산 안에서 못 끝낸다`);
  chk(DNNW.seeds <= DNN.seeds, `워커 시드 ${DNNW.seeds} ≤ GPU 시드 ${DNN.seeds}`,
    "워커가 GPU 보다 많은 시드를 돌린다 — 예산을 수렴이 아니라 개수에 쓴다");
  chk(DNNW.dropout < DNN.dropout,
    `작은 망에 맞춰 드롭아웃을 낮췄다(${DNN.dropout} → ${DNNW.dropout})`,
    "작은 망에 대형 망용 드롭아웃을 그대로 쓴다 — 이번엔 과소적합한다");
  chk(/_dnnTrainOne\(train, val, dims, deadline, warm, DNNW\)/.test(src)
      && /function _dnnTrainOne\(train, val, dims, deadline, warm, hp\)/.test(src),
    "학습 하이퍼파라미터가 인자로 전달된다 — 워커와 GPU 가 서로의 값을 안 쓴다",
    "_dnnTrainOne 이 아직 전역 DNN 상수를 직접 읽는다 — 분리가 절반만 된 것이다");
}

// ── ①-b 파라미터 수를 ★세어서★ 말하는가 (화면이 "3M" 을 외우고 있었다) ───
{
  const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  chk(/function _dnnParamCount\(dims\)/.test(src),
    "파라미터를 dims 에서 세는 단일 진실(_dnnParamCount)이 있다",
    "파라미터를 세는 곳이 없다 — 화면과 서버가 서로 다른 숫자를 말하게 된다");
  chk(/paramsPerNet: _dnnParamCount\(_dimsPrev\)/.test(src),
    "미학습 미리보기도 실제 dims 로 센 값을 내려보낸다",
    "미학습 경로가 파라미터 수를 안 내려보낸다 — 화면이 상수를 지어내게 된다");
  // ★하드코딩된 '3M' 이 화면에 남아 있으면 안 된다★ — 구조가 바뀌면 곧바로 거짓이 된다.
  const bad3m = (H.match(/>3M[^<]*파라미터|3M은 Worker|3M 파라미터/g) || []).length;
  chk(bad3m === 0, "화면에 하드코딩된 '3M' 표기가 남아 있지 않다",
    `화면이 아직 '3M' 을 문자열로 들고 있다(${bad3m}곳) — 구조를 바꾸는 순간 거짓이 된다`);
  chk(/d\.params\.toLocaleString\(\)/.test(H) && !/\(d\.params\/1e6\)\.toFixed/.test(H),
    "화면이 정확한 개수를 그대로 적는다(백만 단위 반올림 금지)",
    "화면이 파라미터를 'M' 으로 반올림한다 — 워커 폴백(33,538)과 GPU 망이 구별되지 않는다");
}

// ── ② 표본이 전 구간을 보는가 ──────────────────────────────────────────────
{
  chk(/spanBuckets/.test(code) && /AND id >= \? ORDER BY id ASC LIMIT \?/.test(src),
    "워커 DNN 이 id 범위를 균등 분할해 전 구간에서 표본을 뽑는다",
    "워커 DNN 이 아직 최근 구간만 읽는다 — 검증까지 한 국면 안에서 잘린다");
  chk(_num(DNNW.dnnMaxSamples) > 2000,
    `워커 학습표본 상한 ${DNNW.dnnMaxSamples}(종전 2,000)`,
    "워커 학습표본이 아직 2,000 이하다");
  // ★상한을 넘길 때 '최근만 남기기' 로 되돌아가면 애써 넓힌 기간이 사라진다★
  chk(!/train = train\.slice\(train\.length - DNNW?\.dnnMaxSamples\)/.test(code)
      && /const _thin = \[\];/.test(src),
    "상한 초과분은 균등 솎아내기로 줄인다 — 기간을 유지한 채 개수만 준다",
    "상한 초과분을 뒤쪽(최근)만 남겨 자른다 — 전 구간 추출이 무의미해진다");
  function _num(v) { return (typeof v === "number" && isFinite(v)) ? v : 0; }
}

// ── ③ 부스터가 '떨어진 축' 으로 표를 받지 않는가 ───────────────────────────
{
  chk(/icPathAccFloor/.test(code), "IC 단독 통과에 정확도 하한 바닥이 있다",
    "IC 경로에 정확도 바닥이 없다 — 동전보다 못한 모델이 IC 로 위원회에 들어온다");
  const imp = src.slice(src.indexOf("const _icOnly = !_passAcc && _passIC;"));
  chk(/_icBlockWhy = "IC 경로 — 블록 유의성 t "/.test(imp.slice(0, 2000)),
    "IC 단독 통과는 ★블록 유의성★ 까지 요구한다(점추정·Fisher 하한만으로는 부족)",
    "IC 단독 통과에 블록 유의성 요구가 없다");
  chk(/if \(\(_passAcc \|\| _passIC\) && !_icBlockWhy\) \{/.test(src),
    "정확도로 통과한 모델(_passAcc)에는 아무 변화가 없다 — 문을 좁힌 것은 IC 경로뿐이다",
    "정확도 경로까지 함께 막혔다 — 의도보다 넓게 조인 것이다");
  // 읽는 쪽에도 같은 문턱이 있어야 한다(이미 저장된 trusted 를 6시간 동안 그대로 쓰지 않게)
  const bc = src.slice(src.indexOf("async function _boostersCached(DB) {"));
  chk(/_okEvidence/.test(bc.slice(0, 2500)) && /GBDT\.icPathAccFloor/.test(bc.slice(0, 2500)),
    "읽는 쪽(_boostersCached)에도 같은 문턱이 있다 — 저장된 옛 판정이 그대로 투표하지 않는다",
    "승격 시점만 고쳤다 — 이미 trusted 로 저장된 모델이 다음 업로드까지 계속 투표한다");
}

// ── ④ 시장 거버너 — 끄지 않고 줄인다 ───────────────────────────────────────
{
  const mg = (src.match(/marketGovernor: \{[\s\S]*?\},/) || [""])[0];
  const floor = Number((mg.match(/floorMult:\s*([\d.]+)/) || [])[1]);
  const minN = Number((mg.match(/minN:\s*(\d+)/) || [])[1]);
  chk(floor > 0, `증거가 잡음이어도 크기가 0 이 되지 않는다(바닥 ×${floor})`,
    "바닥이 0 이다 — 크기를 0 으로 만들면 표본이 안 쌓여 증거가 영원히 갱신되지 않는다(자기실현적 정지)");
  chk(minN >= 40, `표본 ${minN}건 미만이면 아무것도 하지 않는다 — 안 잰 것을 잰 척하지 않는다`,
    "표본 문턱이 너무 낮다 — 몇 건의 운으로 시장 크기가 흔들린다");
  chk(!/tradeState[^\n]*=\s*"HALT"/.test(mg), "거버너가 시장을 차단하지 않는다(연속 수축만 한다)",
    "거버너가 시장을 끈다 — KR 은 edgePNeg 0.7954 로 '기대값 음수' 를 말할 수 없다");
  // 실측값을 넣어 방향과 크기를 확인한다
  const mult = (t) => Math.max(floor, Math.min(1, floor + (1 - floor) * _coefShrink(t)));
  const us = mult(3.785), kr = mult(0.827);
  chk(us > 0.99, `US SQN 3.785 → ×${us.toFixed(2)} (증거가 강한 시장은 안 건드린다)`,
    `US 가 ×${us.toFixed(2)} 로 줄어든다 — 잘 되는 시장을 벌주면 안 된다`);
  chk(kr <= 0.5 && kr >= floor - 1e-9, `KR SQN 0.827 → ×${kr.toFixed(2)} (켈리 비 0.26 과 같은 방향, 더 보수적이지 않다)`,
    `KR 이 ×${kr.toFixed(2)} — 증거 대비 수축이 맞지 않는다`);
  chk(/riskPct = _clamp\(riskPct \* _gm/.test(src) && /__portStats\[market\]/.test(src),
    "수축이 그 시장 자신의 원장(port_stats[market])으로 계산된다",
    "거버너가 시장별 실적이 아닌 값으로 크기를 줄인다");
}

console.log(fails ? "\n모델 증거 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   모델 증거 계약 통과");
process.exit(fails ? 1 : 0);
