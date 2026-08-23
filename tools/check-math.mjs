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

// ── ⑧ 저장되는 지표에 범위 가드가 있는가 ──────────────────────────────────
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

if (bad) { console.error(`\n수치 계산식 위반 ${bad}건 — 배포 차단`); process.exit(1); }
console.log("  ok   수치 계산식 감사 통과");
