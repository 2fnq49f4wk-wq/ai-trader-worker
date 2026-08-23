// [V33.207] 수치 계산식 감사 게이트
//   이 저장소가 겪은 모델 장애의 상당수는 알고리즘이 아니라 ★산식★ 에서 났다:
//     · XALPHA valAcc 2.4159   — 분류 정확도가 1 을 넘었다(루프 범위와 분모가 어긋남, V33.155)
//     · BRAIN  73%↔33% 진동    — 온도로 결정경계를 옮기려 했다(온도는 부호를 못 바꾼다, V12.50)
//     · DNN    31% 겉보기 붕괴 — 균형가중 학습 + 고정 0.5 컷(V12.33)
//     · Wilson 하한 과신        — 명목 n 으로 재서 겹친 라벨을 독립으로 셌다(V33.115)
//     · PF 0.67 vs omega 2.15  — 원+달러를 더한 수로 판단했다(V33.202)
//   공통점: ★문법도 통과하고 예외도 안 나는데 값이 틀리다.★ 그래서 눈으로는 안 잡힌다.
//   → 순수 수학 함수를 실제 파일에서 뽑아 ★독립 계산한 기준값★ 과 대조한다.
//     기준값은 여기서 다시 유도하거나(정의식) 문헌값을 쓴다 — 구현을 복사하지 않는다.
import fs from "node:fs";
const src = fs.readFileSync("src/index.js", "utf8");
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 실제 파일에서 함수 본문을 그대로 뽑아 평가한다(복사본을 검사하면 의미가 없다).
function grab(names) {
  const out = [];
  for (const n of names) {
    const re = new RegExp("^function " + n + "\\s*\\([\\s\\S]*?\\n\\}", "m");
    const m = src.match(re);
    if (!m) { no(`수식감사: ${n} 을 파일에서 못 찾았다 — 검사가 헛돈다`); return null; }
    out.push(m[0]);
  }
  return out.join("\n");
}
const DEPS = `
  function _num(v, d){ const n = Number(v); return isFinite(n) ? n : d; }
  function _clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
`;
const NAMES = ["_wilsonLB", "_effN", "_srMoments", "_expectedMaxSR", "_probSR", "_erf",
               "_edgeStats", "_pctile", "_sigmoid", "_logit"];
const body = grab(NAMES);
if (!body) { console.error("\n수식감사: 함수 추출 실패 — 배포 차단"); process.exit(1); }
// _normInv·_tSf 는 별도 함수라 스텁으로 주입(여기서 검사하는 대상이 아니다).
const STUB = `
  function _normInv(p){ // Acklam 역정규 — 기준값 대조용 독립 구현
    const a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00];
    const b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01];
    const c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00];
    const d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];
    const pl=0.02425; let q,r;
    if(p<pl){ q=Math.sqrt(-2*Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if(p>1-pl){ q=Math.sqrt(-2*Math.log(1-p));
      return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    q=p-0.5; r=q*q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  function _tSf(t, df){ return 0.5; }   // _edgeStats 의 pNeg 는 여기서 검사 대상이 아니다
`;
const F = new Function(DEPS + STUB + body + "\n return {" + NAMES.join(",") + "};")();

// ── ① Wilson 하한 — 정의식으로 직접 유도한 값과 대조 ──────────────────────
{
  const ref = (p, n, z) => {
    const z2 = z * z;
    return (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  };
  let e = 0;
  for (const [p, n] of [[0.5, 100], [0.55, 400], [0.9, 30], [0.01, 50], [1, 20], [0, 20]]) {
    for (const z of [1.64, 1.96, 2.58]) {
      const got = F._wilsonLB(p, n, z), want = Math.max(0, ref(p, n, z));
      if (!near(got, want, 1e-12)) { e++; no(`수식감사: Wilson 하한 p=${p} n=${n} z=${z} → ${got} (기대 ${want})`); }
    }
  }
  // 성질 검사 — 표본이 늘면 하한은 점추정에 다가가고, 절대 점추정을 넘지 않는다.
  if (!(F._wilsonLB(0.6, 10000, 1.64) > F._wilsonLB(0.6, 100, 1.64))) { e++; no("수식감사: Wilson 하한이 표본수에 단조증가하지 않는다"); }
  if (F._wilsonLB(0.6, 100, 1.64) >= 0.6) { e++; no("수식감사: Wilson 하한이 점추정 이상이다 — 하한이 아니다"); }
  if (F._wilsonLB(0.5, 0, 1.64) !== 0) { e++; no("수식감사: n=0 에서 Wilson 하한이 0 이 아니다"); }
  if (!e) ok("Wilson 하한 = 정의식(18경우 · 오차 1e-12) · 단조성 · 하한성 · n=0 안전");
}

// ── ② 유효표본수 — 겹친 라벨을 독립으로 세면 하한이 과신한다 ────────────────
{
  let e = 0;
  if (F._effN(20000, 0.083) !== Math.round(20000 * 0.083)) { e++; no("수식감사: _effN 이 n×고유도가 아니다"); }
  if (F._effN(1000, 1) !== 1000) { e++; no("수식감사: 고유도 1 인데 유효표본이 줄었다"); }
  if (F._effN(1000, 1.5) !== 1000) { e++; no("수식감사: 고유도가 1 을 넘을 때 n 을 넘겨 부풀렸다"); }
  if (F._effN(1000, 0) !== 1000) { e++; no("수식감사: 고유도 0 에서 폴백이 없다(0 으로 나눔 위험)"); }
  if (F._effN(100, 0.001) < 8) { e++; no("수식감사: 유효표본 하한(8) 이 없다"); }
  if (F._effN(0, 0.5) !== 0) { e++; no("수식감사: n=0 에서 0 이 아니다"); }
  // ★핵심 성질★ — 유효표본으로 잰 하한은 명목으로 잰 것보다 반드시 보수적이어야 한다.
  const lbNom = F._wilsonLB(0.55, 20000, 1.64), lbEff = F._wilsonLB(0.55, F._effN(20000, 0.083), 1.64);
  if (!(lbEff < lbNom)) { e++; no("수식감사: 유효표본 하한이 명목보다 보수적이지 않다 — 과신이 그대로 남는다"); }
  if (!e) ok(`유효표본 — 명목 20,000(고유도 0.083) → ${F._effN(20000, 0.083)} · 하한 ${(lbNom * 100).toFixed(1)}% → ${(lbEff * 100).toFixed(1)}%(보수적)`);
}

// ── ③ 오차함수 — 문헌값 대조(A&S 7.1.26, 절대오차 1.5e-7) ─────────────────
{
  const REF = [[0, 0], [0.5, 0.5204998778], [1, 0.8427007929], [2, 0.9953222650], [3, 0.9999779095]];
  let e = 0;
  for (const [x, want] of REF) {
    if (!near(F._erf(x), want, 1.5e-7)) { e++; no(`수식감사: erf(${x}) = ${F._erf(x)} (문헌 ${want})`); }
    if (!near(F._erf(-x), -want, 1.5e-7)) { e++; no(`수식감사: erf 가 홀함수가 아니다 (x=${x})`); }
  }
  // 표준정규 CDF 로 환산했을 때의 문헌값
  const cdf = (z) => 0.5 * (1 + F._erf(z / Math.SQRT2));
  if (!near(cdf(1.64), 0.9494974, 1e-5)) { e++; no(`수식감사: Φ(1.64) = ${cdf(1.64)} (문헌 0.9495)`); }
  if (!near(cdf(1.96), 0.9750021, 1e-5)) { e++; no(`수식감사: Φ(1.96) = ${cdf(1.96)} (문헌 0.9750)`); }
  if (!e) ok("오차함수 = 문헌값(5점 · 홀함수 · Φ(1.64)=0.9495 · Φ(1.96)=0.9750)");
}

// ── ④ SR 적률 — 정의식으로 유도한 값과 대조 ──────────────────────────────
{
  const R = [];
  let sd0 = 12345;
  const rnd = () => { sd0 = (sd0 * 1103515245 + 12345) & 0x7fffffff; return sd0 / 0x7fffffff; };
  for (let i = 0; i < 600; i++) R.push((rnd() - 0.45) * 3);
  const n = R.length;
  const m = R.reduce((a, b) => a + b, 0) / n;
  let m2 = 0, m3 = 0, m4 = 0;
  for (const r of R) { const d = r - m, d2 = d * d; m2 += d2; m3 += d2 * d; m4 += d2 * d2; }
  m2 /= n; m3 /= n; m4 /= n;
  const sd = Math.sqrt(m2);
  const g = F._srMoments(R);
  let e = 0;
  if (!near(g.sr, m / sd, 1e-12)) { e++; no(`수식감사: SR 이 평균/표준편차가 아니다 (${g.sr} vs ${m / sd})`); }
  if (!near(g.skew, m3 / (sd ** 3), 1e-12)) { e++; no("수식감사: 왜도가 3차적률/σ³ 이 아니다"); }
  if (!near(g.kurt, m4 / (m2 * m2), 1e-12)) { e++; no("수식감사: 첨도가 4차적률/σ⁴ 이 아니다"); }
  // 정규분포면 첨도 ≈ 3 (초과첨도가 아니라 ★원첨도★ 여야 PSR 식의 (ku−1)/4 가 맞다)
  const G = []; for (let i = 0; i < 4000; i++) {
    let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd();
    G.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
  }
  const gk = F._srMoments(G).kurt;
  if (!(gk > 2.6 && gk < 3.4)) { e++; no(`수식감사: 정규표본 첨도가 ${gk.toFixed(2)} — 원첨도(≈3)가 아니면 PSR 의 (ku−1)/4 가 틀어진다`); }
  if (F._srMoments([1, 2]).sr !== 0) { e++; no("수식감사: 표본 2개에서 SR 을 냈다(n<4 가드 없음)"); }
  if (F._srMoments([5, 5, 5, 5]).sr !== 0) { e++; no("수식감사: 표준편차 0 에서 0 으로 나눴다"); }
  if (!e) ok(`SR 적률 = 정의식(600표본) · 정규표본 첨도 ${gk.toFixed(2)}≈3 · n<4·σ=0 안전`);
}

// ── ⑤ PSR / DSR — Bailey & López de Prado (2014) 원식과 대조 ─────────────
{
  let e = 0;
  const mom = { n: 400, sr: 0.12, skew: -0.4, kurt: 4.2 };
  const v = 1 - mom.skew * mom.sr + ((mom.kurt - 1) / 4) * mom.sr * mom.sr;
  const z = (mom.sr - 0) * Math.sqrt(mom.n - 1) / Math.sqrt(v);
  const want = 0.5 * (1 + F._erf(z / Math.SQRT2));
  if (!near(F._probSR(mom, 0), +want.toFixed(4), 1e-4)) { e++; no(`수식감사: PSR 이 원식과 다르다 (${F._probSR(mom, 0)} vs ${want.toFixed(4)})`); }
  // ★성질★ — 기준 SR 을 올리면 확률은 반드시 내려간다(디플레이션의 정의)
  if (!(F._probSR(mom, 0.05) < F._probSR(mom, 0))) { e++; no("수식감사: SR0 를 올렸는데 DSR 이 안 내려간다 — 다중검정 보정이 무효"); }
  // 분모가 음수가 되는 극단 왜도에서는 판정하지 않아야 한다(정의되지 않음)
  if (F._probSR({ n: 100, sr: 3, skew: 5, kurt: 3 }, 0) !== null) { e++; no("수식감사: PSR 분모가 음수인데 값을 냈다"); }
  if (F._probSR({ n: 3, sr: 1, skew: 0, kurt: 3 }, 0) !== null) { e++; no("수식감사: n<4 에서 PSR 을 냈다"); }
  // 기대 최대 SR — K=1 이면 0, K 가 커지면 단조증가
  if (F._expectedMaxSR(0.1, 1) !== 0) { e++; no("수식감사: 시도 1회인데 기대 최대 SR 이 0 이 아니다"); }
  const s5 = F._expectedMaxSR(0.1, 5), s50 = F._expectedMaxSR(0.1, 50);
  if (!(s50 > s5 && s5 > 0)) { e++; no("수식감사: 기대 최대 SR 이 시도수에 단조증가하지 않는다"); }
  if (!e) ok(`PSR = 원식 · SR0↑ → DSR↓ · 분모 음수/n<4 판정보류 · 기대최대SR K=5 ${s5.toFixed(4)} < K=50 ${s50.toFixed(4)}`);
}

// ── ⑥ t 통계 · SQN — 정의식과 대조 ────────────────────────────────────────
{
  const R = [1.2, -0.5, 2.1, 0.3, -1.8, 0.9, 1.5, -0.2, 0.7, 2.4];
  const n = R.length, m = R.reduce((a, b) => a + b, 0) / n;
  let v = 0; for (const r of R) v += (r - m) * (r - m);
  const sd = Math.sqrt(v / (n - 1));
  const t = m / (sd / Math.sqrt(n));
  const g = F._edgeStats(R);
  let e = 0;
  if (!near(g.t, +t.toFixed(3), 1e-9)) { e++; no(`수식감사: t = ${g.t} (정의식 ${t.toFixed(3)})`); }
  if (!near(g.sqn, +t.toFixed(3), 1e-9)) { e++; no("수식감사: SQN 이 t 와 다르다 — SQN = √n·평균/표준편차 = t 여야 한다"); }
  if (g.df !== n - 1) { e++; no(`수식감사: 자유도가 ${g.df} (n−1 = ${n - 1} 이어야 한다)`); }
  if (!near(g.sd, sd, 1e-12)) { e++; no("수식감사: 표준편차가 n−1 로 나눈 표본표준편차가 아니다"); }
  if (F._edgeStats([3]).t !== 0) { e++; no("수식감사: 표본 1개에서 t 를 냈다"); }
  if (F._edgeStats([2, 2, 2]).t !== 0) { e++; no("수식감사: 표준편차 0 에서 0 으로 나눴다"); }
  if (!e) ok(`t 통계 = 정의식(t ${g.t}) · SQN=t · 자유도 n−1 · 표본1·σ=0 안전`);
}

// ── ⑦ 백분위·시그모이드·로짓 — 왕복 항등과 경계 ───────────────────────────
{
  let e = 0;
  const S = [1, 2, 3, 4, 5];
  if (F._pctile(S, 0) !== 1 || F._pctile(S, 1) !== 5) { e++; no("수식감사: 백분위 양 끝이 최소/최대가 아니다"); }
  if (!near(F._pctile(S, 0.5), 3, 1e-12)) { e++; no("수식감사: 중앙값이 틀리다"); }
  if (!near(F._pctile(S, 0.25), 2, 1e-12)) { e++; no("수식감사: 선형보간 25% 가 틀리다"); }
  if (F._pctile([], 0.5) !== 0 || F._pctile([7], 0.9) !== 7) { e++; no("수식감사: 빈 배열/1개 배열 처리가 없다"); }
  // 로짓↔시그모이드 왕복 — 클램프 구간 안에서는 항등이어야 한다
  for (const p of [0.01, 0.2, 0.5, 0.8, 0.99]) {
    if (!near(F._sigmoid(F._logit(p)), p, 1e-9)) { e++; no(`수식감사: 로짓↔시그모이드 왕복이 깨졌다 (p=${p})`); }
  }
  if (!near(F._logit(0.5), 0, 1e-12)) { e++; no("수식감사: logit(0.5) ≠ 0"); }
  // ★온도는 부호를 못 바꾼다★ — V12.50 이 고친 그 성질을 검사로 못 박는다.
  for (const T of [0.5, 2, 6, 100]) {
    if (!near(F._sigmoid(F._logit(0.5) / T), 0.5, 1e-12)) { e++; no(`수식감사: 온도 ${T} 가 0.5 를 옮겼다 — 그럴 수 없다`); }
  }
  if (!e) ok("백분위(양끝·중앙·보간·빈배열) · 로짓↔시그모이드 왕복 · ★온도는 0.5 를 못 옮긴다★");
}

// ── ⑧ ★음수가 될 수 없는 양이 음수(또는 NaN)로 나오지 않는가★ ─────────────
//   사용자 지적: "양수가 나와야 하는 계산식에서 음수가 나온 경우가 있었다."
//   실제로 이 저장소가 반복해 막아 온 두 가지 경로가 있다:
//     ① E[X²]−E[X]² 분산 지름길 — 부동소수 상쇄로 음수가 되고 sqrt 가 NaN 을 낸다
//     ② sqrt 안의 뺄셈 — 인자가 음수면 조용히 NaN 이 흘러간다
//   전수 조사 결과 ①은 전부 Math.max(0,…) 로 막혀 있었고, ②의 두 곳
//   (켈리 corrDiv · _icEffective)도 앞선 클램프·가드로 안전했다.
//   그래서 여기서는 ★적대적 입력★ 을 실제로 넣어 성질이 깨지는지 본다 — 코드를 읽는 것과
//   값을 넣어 보는 것은 다르다(이 세션에서 읽고 세운 가설이 여러 번 계측에 뒤집혔다).
{
  let e = 0;
  const ADV = {
    "전부 음수":       [-1.2, -0.5, -3.1, -0.8, -2.2, -0.1, -1.9, -0.4],
    "전부 동일":       [2, 2, 2, 2, 2, 2],
    "전부 0":          [0, 0, 0, 0, 0],
    "한쪽 극단":       [100, -0.001, -0.001, -0.001, -0.001, -0.001],
    "극단 왜도":       [-0.01, -0.01, -0.01, -0.01, -0.01, 50],
    "미세값":          [1e-12, -1e-12, 1e-12, -1e-12, 1e-12, -1e-12]
  };
  for (const [name, R] of Object.entries(ADV)) {
    const m = F._srMoments(R), g = F._edgeStats(R);
    // 표준편차는 정의상 음수가 될 수 없다
    if (!(g.sd >= 0) || !isFinite(g.sd)) { e++; no(`부호감사: [${name}] 표준편차 ${g.sd} — 음수/NaN 이 될 수 없다`); }
    // 첨도는 정의상 음수가 될 수 없다(원첨도 = 4차적률/σ⁴)
    if (!(m.kurt >= 0) || !isFinite(m.kurt)) { e++; no(`부호감사: [${name}] 첨도 ${m.kurt} — 음수/NaN 이 될 수 없다`); }
    // 자유도·표본수는 음수가 될 수 없다
    if (!(g.df >= 0) || !(g.n >= 0)) { e++; no(`부호감사: [${name}] 자유도/표본수가 음수다`); }
    // t·SR·왜도는 음수가 ★될 수 있다★ — 다만 NaN 은 안 된다(값이 없는 것과 다르다)
    if (!isFinite(g.t) || !isFinite(m.sr) || !isFinite(m.skew)) { e++; no(`부호감사: [${name}] t/SR/왜도에 NaN — 음수는 되지만 NaN 은 안 된다`); }
    // 확률은 [0,1] 밖으로 못 나간다
    const ps = F._probSR(m, 0);
    if (ps != null && !(ps >= 0 && ps <= 1)) { e++; no(`부호감사: [${name}] PSR ${ps} 가 [0,1] 밖이다`); }
  }
  // Wilson 하한 — 어떤 입력에도 음수가 될 수 없다(하한이 0 미만이면 의미가 없다)
  for (const [pv, nv] of [[0, 5], [0.001, 5], [1, 5], [0.5, 1], [0.02, 8]]) {
    const lb = F._wilsonLB(pv, nv, 2.58);
    if (!(lb >= 0) || !isFinite(lb)) { e++; no(`부호감사: Wilson 하한 p=${pv} n=${nv} → ${lb} (음수/NaN 불가)`); }
  }
  // 기대 최대 SR — 시도가 늘수록 커지는 ★양수★ 다(음수면 다중검정 보정이 반대로 작동한다)
  for (const K of [2, 3, 5, 11, 50, 500]) {
    const v = F._expectedMaxSR(0.1, K);
    if (!(v >= 0) || !isFinite(v)) { e++; no(`부호감사: 기대 최대 SR K=${K} → ${v} — 음수면 DSR 이 PSR 보다 커진다(보정이 뒤집힘)`); }
  }
  // 유효표본수 — 음수·NaN 불가
  for (const [nv, uv] of [[100, -0.5], [100, 0], [0, 0.5], [-10, 0.5], [100, NaN]]) {
    const v = F._effN(nv, uv);
    if (!(v >= 0) || !isFinite(v)) { e++; no(`부호감사: 유효표본 n=${nv} u=${uv} → ${v} (음수/NaN 불가)`); }
  }
  // 백분위 — 정렬 배열의 최소~최대 밖으로 나갈 수 없다
  const SS = [-5, -1, 0, 3, 9];
  for (const q of [0, 0.13, 0.5, 0.87, 1]) {
    const v = F._pctile(SS, q);
    if (!(v >= SS[0] && v <= SS[SS.length - 1])) { e++; no(`부호감사: 백분위 q=${q} → ${v} 가 [${SS[0]}, ${SS[SS.length - 1]}] 밖이다`); }
  }
  // 시그모이드는 (0,1) 을 절대 못 벗어난다 — 극단 로짓에서도
  for (const z of [-1e6, -50, 0, 50, 1e6]) {
    const v = F._sigmoid(z);
    if (!(v >= 0 && v <= 1) || !isFinite(v)) { e++; no(`부호감사: 시그모이드(${z}) = ${v} 가 [0,1] 밖이다`); }
  }
  if (!e) ok(`적대적 입력 ${Object.keys(ADV).length}종(전부음수·동일·0·극단왜도·미세값) — 표준편차·첨도·자유도·Wilson하한·기대최대SR·유효표본·백분위·시그모이드 전부 부호와 범위 유지, NaN 0건`);
}

// ── ⑨ 분산 지름길에 상쇄 가드가 남아 있는가 ────────────────────────────────
//   E[X²] − E[X]² 는 크기가 비슷한 두 수의 뺄셈이라 ★부동소수 상쇄로 음수가 될 수 있다★
//   → sqrt 가 NaN 을 내고, 그 NaN 이 조용히 지표를 타고 흐른다.
//   ★이 검사의 정규식을 세 번 고쳤고 그때마다 코드가 아니라 검사가 틀렸다★:
//     sqrt(s2 / n)      — 편차제곱합, 정의상 ≥ 0
//     sqrt(−2 · ln p)   — Box–Muller·역정규의 단항 마이너스, 인자가 언제나 양수
//     sqrt(p · (1 − p)) — 베르누이 분산, p ∈ [0,1] 이면 ≥ 0
//   진짜 위험은 ★마이너스 뒤에 같은 변수의 제곱★ 이 오는 형태다(그게 E[X]² 항이다).
//   역참조(\1)로 그것만 지목한다 — 넓게 잡아 오탐을 내면 검사는 곧 꺼진다.
{
  /* 마이너스는 ★이항★ 이어야 한다 — exp(−a·a)·exp(−x·x/2) 처럼 단항 마이너스 뒤의 제곱은
     지수함수 인자라 언제나 안전하다(오탐 2건이 그것이었다). 앞에 단어/닫는괄호를 요구한다. */
  const RE = /[\w\)\]]\s*-\s*(?:[\w.$]+\s*\*\s*)?([A-Za-z_$][\w.$]*)\s*\*\s*\1\b/g;
  const lines = src.split("\n");
  const hits = [];
  lines.forEach((ln, i) => {
    RE.lastIndex = 0;
    if (!RE.test(ln)) return;
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return;               // 주석은 코드가 아니다
    hits.push({ n: i + 1, s: ln.trim() });
  });
  /* 가드로 인정하는 형태는 둘이다:
       ① Math.max(0, …) / Math.max(1e-…, …)  — 음수를 0 으로 끌어올린다
       ② 그 다음 줄에서 ★그 변수의 양수 검사★  — 음수면 아예 그 경로를 안 쓴다(더 엄격하다)
     ②를 안 봐주면 "abs 를 벗기고 부호로 막는" 더 나은 수정이 오히려 위반으로 잡힌다. */
  const unguarded = hits.filter((h) => {
    if (/Math\.max\(\s*(?:0|1e-)/.test(h.s)) return false;
    const nm = (h.s.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/) || [])[1];
    if (nm) {
      const win = lines.slice(h.n, h.n + 3).join(" ");
      const re = new RegExp("\\b" + nm.replace(/[$]/g, "\\$&") + "\\s*>\\s*(?:0\\b|1e-|[\\w.]+\\s*\\*)");
      if (re.test(win)) return false;
    }
    return true;
  });
  if (!hits.length)
    no("부호감사: 분산 지름길을 하나도 못 찾았다 — 검사가 헛돌고 있다(패턴이 바뀌었는지 확인할 것)");
  else if (unguarded.length)
    no(`부호감사: 분산 지름길에 상쇄 가드가 없다 ${unguarded.length}곳 — 음수 분산 → sqrt NaN\n    `
       + unguarded.slice(0, 4).map((h) => h.n + ": " + h.s.slice(0, 100)).join("\n    "));
  else
    ok(`분산 지름길(E[X²]−E[X]²) ${hits.length}곳 전부 상쇄 가드(Math.max) 보유 — 줄 ${hits.map((h) => h.n).join(", ")}`);
}

// ── ⑨-2 ★상관·회귀가 중심화돼 있는가 — 실측으로 재현한다★ ─────────────────
//   V33.208 이 고친 실제 버그다. 중심화하지 않은 n·Σx² − (Σx)² 는 x 가 크고 변동이 작으면
//   ★분산이 음수★ 로 나오고(실측 −6144), sqrt 가 NaN 이 되고, NaN 비교가 전부 거짓이라
//   상관이 ★조용히 0 으로 삼켜진다★. 참 상관이 +1 인 구간에서 "관계 없음" 이 나온다.
//   예외도 안 나고 로그도 안 남으므로, 이 검사가 없으면 다음에도 못 잡는다.
{
  const pearson = (() => {
    const m = src.match(/^function _pearson\([\s\S]*?\n\}/m);
    if (!m) { no("부호감사: _pearson 을 못 찾았다"); return null; }
    return new Function("function _num(v,d){const n=Number(v);return isFinite(n)?n:d;}"
      + "function _clamp(v,a,b){return v<a?a:(v>b?b:v);}" + m[0] + "return _pearson;")();
  })();
  const ols = (() => {
    const m = src.match(/^function _olsSlope\([\s\S]*?\n\}/m);
    if (!m) { no("부호감사: _olsSlope 을 못 찾았다"); return null; }
    return new Function("function _num(v,d){const n=Number(v);return isFinite(n)?n:d;}"
      + m[0] + "return _olsSlope;")();
  })();
  if (pearson && ols) {
    let e = 0;
    // ★버그를 냈던 바로 그 입력★ — 큰 수준값에 미세 변동(주가·지수·시가총액에서 늘 생긴다)
    const mk = (base, step) => { const a = [], b = []; for (let i = 0; i < 40; i++) {
      a.push(base + (i % 3) * step); b.push(base + (i % 3) * step * 2); } return [a, b]; };
    for (const [base, step] of [[9e7, 0.01], [7.1e4, 0.5], [1e6, 0.001], [3.2e9, 1]]) {
      const [a, b] = mk(base, step);
      const r = pearson(a, b);
      if (!(r > 0.99)) { e++; no(`부호감사: 상관 — 수준 ${base.toExponential()} 변동 ${step} 에서 r=${r} (참값 ≈ +1). 중심화하지 않으면 분산이 음수가 되어 0 으로 삼켜진다`); }
    }
    // 음의 상관도 그대로 나와야 한다
    { const a = [], b = []; for (let i = 0; i < 40; i++) { a.push(1e7 + i * 0.5); b.push(1e7 - i * 0.5); }
      const r = pearson(a, b);
      if (!(r < -0.99)) { e++; no(`부호감사: 음의 상관이 ${r} — 참값 ≈ −1`); } }
    // 상관은 [−1, 1] 을 절대 못 벗어난다
    for (const [base, step] of [[1e9, 1e-6], [1, 1e6]]) {
      const [a, b] = mk(base, step); const r = pearson(a, b);
      if (!(r >= -1 && r <= 1) || !isFinite(r)) { e++; no(`부호감사: 상관 ${r} 이 [−1,1] 밖이거나 NaN`); }
    }
    // 회귀 기울기 — 큰 수준값에서도 참 기울기를 낸다
    { const x = [], y = []; for (let i = 0; i < 60; i++) { const v = 71000 + Math.sin(i / 7) * 80;
        x.push(v); y.push(1234 + 1.5 * v); }
      const b = ols(x, y);
      if (b == null || Math.abs(b - 1.5) > 1e-6) { e++; no(`부호감사: 회귀 기울기 ${b} (참값 1.5) — 중심화 없이는 유효숫자가 날아간다`); } }
    // 분산 0(전부 같은 값)에서는 판정하지 않는다 — 0 으로 나누면 무한대가 흐른다
    if (ols([5, 5, 5, 5], [1, 2, 3, 4]) !== null) { e++; no("부호감사: 분산 0 인데 기울기를 냈다"); }
    if (pearson([5, 5, 5], [1, 2, 3]) !== 0) { e++; no("부호감사: 분산 0 인데 상관을 냈다"); }
    // 소스에 중심화가 실제로 남아 있는가(누가 '최적화' 로 되돌리면 조용히 재발한다)
    if (/n \* sxx - sx \* sx/.test(src))
      { e++; no("부호감사: 중심화하지 않은 n·Σx² − (Σx)² 가 되살아났다 — 분산이 음수가 될 수 있다"); }
    if (!e) ok("상관·회귀 중심화 — 수준 9e7·7.1e4·1e6·3.2e9 에서 r≈+1 재현 · 음의상관 · [−1,1] · 기울기 1.5 · 분산0 판정보류");
  }
}

// ── ⑩ 저장되는 지표에 범위 가드가 있는가 ──────────────────────────────────
//   XALPHA valAcc 2.4159 는 ★분류 정확도가 1 을 넘은 값★ 이었고, 그 상태로 화면에 떴다.
//   산식을 아무리 고쳐도 다음에 또 어긋나면 같은 일이 난다 — 내보내는 자리에서 막는다.
{
  const i = src.indexOf("function _modelFacts");
  if (i < 0) no("수식감사: _modelFacts 를 못 찾았다");
  else {
    const seg = src.slice(i, i + 2000);
    if (!/_rate01|>\s*1\s*\|\||범위 벗어/.test(seg))
      no("수식감사: _modelFacts 가 정확도 범위를 확인하지 않는다 — 2.4159 같은 값이 그대로 화면에 나간다");
    else ok("사실표가 정확도 범위를 확인한다(0~1 밖이면 그대로 내보내지 않는다)");
  }
}

// ── ⑪ 실현변동성 — 하방 반편차의 분모, 그리고 두 값이 같은 자인가 ──────────
/*  이 자리에서 실제로 값이 틀어져 기능 하나가 죽어 있었다.
    semivariance 의 표준 정의는 (1/n)·Σ_{r<0} r² 이고, 대칭분포에서 그 값이 σ²/2 다.
    ×2 보정은 ★분모가 전체 n 일 때만★ σ² 를 준다. 종전 코드는 분모를 '음수의 개수'
    (≈ n/2)로 두고 ×2 를 곱해 2σ² 를 만들었다 — 변동성이 √2 배 부푼다.
    그 값이 Math.min(전체, 하방) 에 들어가니, 하방이 채택될 일이 거의 없었다.
    게다가 전체는 평균을 빼고 하방은 안 빼서 ★애초에 비교가 성립하지 않는 두 자★ 였다. */
{
  const grab = (name) => {
    const i = src.indexOf("function " + name + "(");
    if (i < 0) return null;
    let d = 0, j = src.indexOf("{", i);
    for (let k = j; k < src.length; k++) {
      if (src[k] === "{") d++;
      else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); }
    }
    return null;
  };
  const rv = grab("_rvAnnPct"), sd = grab("_semiDevAnnPct");
  if (!rv || !sd) no("수식감사: 실현변동성 헬퍼(_rvAnnPct/_semiDevAnnPct)가 없다");
  else {
    // 분모 계약 — 하방도 전체 n 으로 나눠야 ×2 가 σ² 를 준다.
    if (!/dn2 \/ n \* 2/.test(sd))
      no("수식감사: 하방 반편차를 전체 n 이 아닌 값으로 나눈다 — ×2 보정이 성립하지 않아 √2 배 부푼다");
    else ok("하방 반편차는 전체 n 으로 나눈다(×2 보정이 σ² 를 주는 유일한 분모)");
    if (/s2 \/ n\s*-|- *m *\* *m|mu \* mu/.test(rv))
      no("수식감사: 단기 실현변동성이 표본평균을 뺀다 — 하방 쪽과 자가 달라져 Math.min 비교가 무너진다");
    else ok("단기 실현변동성은 표본평균을 빼지 않는다(하방 쪽과 같은 자)");
    // 호출부: 두 값이 실제로 이 헬퍼들에서 나와야 한다.
    const i = src.indexOf("_vt.useDownsideVol");
    const seg = i > 0 ? src.slice(i - 900, i + 700) : "";
    if (!/_rvAnnPct\(_lr, 252\)/.test(seg) || !/_semiDevAnnPct\(_lr, 252\)/.test(seg))
      no("수식감사: 목표변동성 스로틀이 공용 헬퍼를 쓰지 않는다 — 두 자가 다시 갈라질 수 있다");
    else ok("목표변동성 스로틀의 두 값이 같은 헬퍼에서 나온다");
  }

  // 수치 재현 — 대칭분포에서 하방변동성은 전체변동성과 같아야 한다(±5%).
  {
    let sd0 = 2024 >>> 0;
    const u = () => { sd0 = (sd0 * 1664525 + 1013904223) >>> 0; return sd0 / 4294967296; };
    const g = () => { const a = Math.max(1e-12, u()), b = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); };
    const SIG = 0.012, LB = 20, T = 40000, ANN = Math.sqrt(252) * 100;
    let tot = 0, now = 0, fix = 0, k = 0;
    for (let t = 0; t < T; t++) {
      let s2 = 0, dn2 = 0, nDn = 0;
      for (let i = 0; i < LB; i++) { const r = SIG * g(); s2 += r * r; if (r < 0) { dn2 += r * r; nDn++; } }
      if (nDn < 5) continue;
      tot += Math.sqrt(s2 / LB) * ANN;
      now += Math.sqrt(dn2 / nDn * 2) * ANN;   // 종전 분모
      fix += Math.sqrt(dn2 / LB * 2) * ANN;    // 표준 분모
      k++;
    }
    const rNow = now / tot, rFix = fix / tot;
    if (!(rNow > 1.25))
      no(`수식감사: 종전 분모가 부풀지 않는다(비율 ${rNow.toFixed(3)}) — 재현이 계약을 증명하지 못한다`);
    else ok(`종전 분모(÷음수개수)는 대칭분포에서 ${((rNow - 1) * 100).toFixed(1)}% 부푼다 — Math.min 이 하방을 고를 수 없었던 이유`);
    if (!(Math.abs(rFix - 1) < 0.05))
      no(`수식감사: 표준 분모가 전체변동성과 안 맞는다(비율 ${rFix.toFixed(3)})`);
    else ok(`표준 분모(÷전체 n)는 대칭분포에서 전체변동성과 일치한다(비율 ${rFix.toFixed(3)})`);
  }
}

if (bad) { console.error(`\n수치 계산식 위반 ${bad}건 — 배포 차단`); process.exit(1); }
console.log("  ok   수치 계산식 감사 통과");
