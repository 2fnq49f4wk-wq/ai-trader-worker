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

/* ══ [V33.422] ①·①-b·② 삭제 — DNN 퇴역. ═══════════════════════════════════════════════
   이 세 절은 전부 ★워커 폴백 DNN★ 의 계약이었다(GPU/워커 구조 분리 · 파라미터 세기 ·
   전 구간 표본 추출). DNN 이 코드에서 사라졌으므로 지킬 대상이 없다.
   남은 절(③ 부스터 증거 · ④ 사실표 단일출처 · ⑤ 화면 표기)은 그대로 유효하다. */

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
  /* 읽는 쪽에도 같은 문턱이 있어야 한다(이미 저장된 trusted 를 다음 업로드까지 그대로 쓰지 않게).
     [V33.339] 그 문턱은 이제 _boosterAdmit 한 곳에 있고, 읽는 쪽은 그 함수를 부른다 —
     조건을 두 번 적지 않는 것이 목적이므로, ★같은 곳을 부르는지★ 를 본다. */
  const ba = src.slice(src.indexOf("function _boosterAdmit("), src.indexOf("async function _boostersCached(DB)"));
  chk(/const okEv =/.test(ba) && /GBDT\.icPathAccFloor/.test(ba) && /GBDT\.trustFloor/.test(ba),
    "판정 함수(_boosterAdmit)가 정확도·IC 두 문턱을 함께 본다",
    "승격 시점만 고쳤다 — 이미 trusted 로 저장된 모델이 다음 업로드까지 계속 투표한다");
  const bc = src.slice(src.indexOf("async function _boostersCached(DB) {"));
  chk(/_boosterAdmit\(T\[nm \+ "_trust"\]/.test(bc.slice(0, 2500)),
    "읽는 쪽(_boostersCached)이 그 판정 함수를 그대로 부른다 — 문턱이 두 벌이 될 자리가 없다",
    "★읽는 쪽이 조건을 다시 적는다★ — 한쪽만 고쳐지면 화면과 실물이 갈라진다");
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

// ── ⑤ [V33.195] 두 화면이 같은 사실을 말하는가 ─────────────────────────────
//   실측 사고: 같은 순간 같은 DNN 을 두고
//     AI 두뇌 관측(/api/ml-status)  → "검증 정확도 49.5%"   ← valAcc
//     AI 운용상태 사이드바(/api/ai-mode) → "검증 47%"        ← accLB(Wilson 하한)
//   둘 다 사실인데 ★이름이 같아서★ 사용자는 어느 쪽도 믿을 수 없게 됐다.
//   고칠 것은 숫자가 아니라 이름이고, 두 화면이 같은 사실표를 쓰게 하는 것이다.
{
  const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  chk(/function _modelFacts\(trust, meta, opts\)/.test(src),
    "모델 사실표를 만드는 단일 함수(_modelFacts)가 있다",
    "사실표를 각 엔드포인트가 따로 조립한다 — 같은 모델이 화면마다 다른 숫자로 보이게 된다");
  chk(/gbdt: Object\.assign\(_modelFacts\(_gt/.test(src),
    "/api/ai-mode 의 GBDT 행이 그 사실표에서 나온다(DNN 은 퇴역)",
    "ai-mode 가 아직 필드를 손으로 조립한다");
  // 두 값이 ★둘 다★ 실려야 한다 — 하나만 실으면 화면은 다시 이름을 겹쳐 쓰게 된다.
  chk(/valAcc: pct\(raw\)/.test(src) && /accLB: pct\(lb\)/.test(src),
    "사실표가 valAcc(맞힌 비율)와 accLB(신뢰하한)를 둘 다 싣는다",
    "사실표에 두 값 중 하나가 없다 — 화면이 다시 한 이름으로 두 통계를 부르게 된다");
  /* [V33.422] /api/ml-status 의 DNN accLB·floor 검사 삭제 — DNN 퇴역.
     같은 계약(하한과 문턱을 같은 이름으로 싣는다)은 위 _modelFacts 단일출처 검사가 지킨다. */
  // ★같은 모델을 보고 있는지 판별할 키★ — 캐시 창이 다르면 값이 갈릴 수 있다.
  chk(/trainedAt: pick\(t \? _num\(t\.trainedAt, null\)/.test(src),
    "사실표가 trainedAt 을 싣는다 — 두 화면이 같은 모델인지 대조할 수 있다",
    "trainedAt 이 없다 — 숫자가 갈렸을 때 버그인지 낡은 캐시인지 구분할 수 없다");
  // 화면: 두 값을 다른 이름으로 적는가
  chk(/parts\.push\('검증 '\+d\.valAcc\.toFixed\(1\)/.test(H) && /parts\.push\('하한 '\+d\.accLB\.toFixed\(1\)/.test(H),
    "사이드바가 '검증' 과 '하한' 을 구분해 적는다",
    "사이드바가 두 통계를 한 이름으로 적는다 — 이번 사고가 그대로 재발한다");
  chk(/chip\('신뢰하한\(게이트 기준\)'/.test(H) && /chip\('신뢰 문턱'/.test(H),
    "두뇌관측도 신뢰하한·문턱을 함께 보인다(게이트가 보는 값이 무엇인지 화면이 말한다)",
    "두뇌관측이 valAcc 만 보인다 — 왜 억제 중인지 화면만으로 알 수 없다");
  /* ★관측 화면은 모르는 것을 지어내면 안 된다.★ 미학습 미리보기가 뉴런 강도를 난수로
     채워 새로고침마다 다른 그림을 보여주고 있었다. 구조(층·뉴런 수)는 사실이지만
     강도는 알 수 없는 값이다 — 알 수 없으면 비워 두고 그렇다고 말해야 한다. */
  chk(!/Math\.random\(\)/.test(H),
    "구조 관측이 난수로 그리는 곳이 없다 — 모르는 값을 지어내지 않는다",
    "화면이 아직 Math.random() 으로 뉴런 강도를 그린다 — 새로고침마다 다른 '사실' 을 보여준다");
  chk(/미학습 — 구조만 표시/.test(H) && /뉴런 강도는 표시하지 않습니다/.test(H),
    "미학습일 때 '구조는 사실 · 강도는 없음' 을 명시한다",
    "미학습 미리보기가 무엇이 사실이고 무엇이 비어 있는지 말하지 않는다");
}

console.log(fails ? "\n모델 증거 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   모델 증거 계약 통과");
process.exit(fails ? 1 : 0);
