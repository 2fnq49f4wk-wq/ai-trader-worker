// [V33.141] 경계 퍼징 계약 — 학습이 검증 구간의 가격을 미리 보는 경로를 막는다.
//
//   ★배경★ flow/xalpha 는 홀드아웃 IC 0.19 인데 전진 IC 는 0.02 였다(10배).
//   분할은 시간순이라 "검증이 미래" 는 맞다. 다만 라벨 지평이 5일이라, 경계 직전
//   학습표본의 결과 구간이 검증 구간 안으로 뻗는다 — de Prado(AFML 7장)가 purging 으로
//   잘라내는 누출이다. 그래서 퍼징을 넣었다.
//
//   ★그런데 재봤더니 그게 10배 갭의 원인은 아니었다.★ 합성자료에서 퍼징 전후 홀드아웃 IC
//   차이는 0.0001 — 잡음 수준이다. 첫 판본은 "퍼징이 부풀림을 줄인다" 를 계약으로 걸고
//   그 0.0001 로 ★통과★ 시켰다. 그건 거짓 통과라 계약을 바꿨다.
//   운영의 10배 갭은 측정 버그가 아니라 ★일반화 갭★ 이고, 전진검증이 정확히 그걸 잡아낸 것이다
//   (이 저장소는 이미 check-prob-fitters 에서 "겹침 때문에 블록 t 가 부풀 것" 이라는 추측을
//    측정으로 기각한 적이 있다 — 같은 실수를 반복하지 않으려고 이 기록을 남긴다).
//
//   그러므로 이 게이트가 검사하는 것은 두 가지다:
//     ① 퍼징이 ★해롭지 않은가★ (홀드아웃을 부풀리지 않고, 진짜 신호를 지우지 않는가)
//     ② 구현이 ★올바른 방향★ 인가 (부분 퍼징 금지 · 표본 부족 시 학습 보류)

import { readFileSync } from "node:fs";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const DAY = 86400000;

// 합성: 하루 SYMS 종목, 라벨은 '그날부터 SPAN 일간 공통충격 + 개별잡음 + 약한 신호'.
//   공통충격이 날짜별로 존재하므로, 같은 충격을 공유하는 표본은 서로 정보가 샌다.
function gen({ days, syms, spanDays, signal }) {
  const shock = []; for (let d = 0; d < days + spanDays + 2; d++) shock.push(randn());
  const rows = [];
  for (let d = 0; d < days; d++) {
    for (let k = 0; k < syms; k++) {
      const x = randn();
      // 라벨 결정에 쓰이는 미래 구간 충격의 평균 — 이웃 표본과 겹친다(그래서 누출이 생긴다)
      let fut = 0; for (let j = 0; j < spanDays; j++) fut += shock[d + j];
      fut /= spanDays;
      const z = signal * x + fut + 0.8 * randn();
      rows.push({ t: d * DAY, x, y: z > 0 ? 1 : 0 });
    }
  }
  return rows;
}
const pearson = (a, b) => {
  const n = a.length; if (n < 8) return 0;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sa = 0, sb = 0, sab = 0;
  for (let i = 0; i < n; i++) { const p = a[i] - ma, q = b[i] - mb; sa += p * p; sb += q * q; sab += p * q; }
  return (sa > 1e-12 && sb > 1e-12) ? sab / Math.sqrt(sa * sb) : 0;
};
// 1차원 로지스틱(부호만 맞으면 IC 계산에 충분)
function fit(rows) {
  let w = 0, b = 0;
  for (let ep = 0; ep < 200; ep++) {
    let gw = 0, gb = 0;
    for (const r of rows) { const p = 1 / (1 + Math.exp(-(w * r.x + b))); gw += (p - r.y) * r.x; gb += (p - r.y); }
    w -= 0.1 * gw / rows.length; b -= 0.1 * gb / rows.length;
  }
  return { w, b };
}
const score = (m, rows) => rows.map((r) => 1 / (1 + Math.exp(-(m.w * r.x + m.b))));

// ── ① 누출 재현과 퍼징 효과 ──────────────────────────────────────────────
{
  const SPAN = 5, DAYS = 40, SYMS = 60;
  let noPurge = 0, purged = 0, future = 0, REP = 60;
  for (let r = 0; r < REP; r++) {
    const all = gen({ days: DAYS + 10, syms: SYMS, spanDays: SPAN, signal: 0.25 });
    const inWin = all.filter((x) => x.t < DAYS * DAY);           // 학습·검증에 쓰는 창
    const fut = all.filter((x) => x.t >= (DAYS + SPAN) * DAY);   // ★진짜 미래★ (겹침 없음)
    const nval = Math.floor(inWin.length * 0.2);
    const ntr0 = inWin.length - nval;
    const val = inWin.slice(ntr0);
    const bound = val[0].t;

    // (a) 퍼징 없음 — 종전 동작
    const trA = inWin.slice(0, ntr0);
    const mA = fit(trA);
    noPurge += pearson(score(mA, val), val.map((v) => v.y));

    // (b) 퍼징 — 라벨 구간이 경계를 넘는 학습표본 제거
    let keep = ntr0;
    while (keep > 0 && inWin[keep - 1].t + SPAN * DAY > bound) keep--;
    const mB = fit(inWin.slice(0, keep));
    purged += pearson(score(mB, val), val.map((v) => v.y));

    // (c) 진짜 미래 성적 — 어느 쪽이 정직한지 판단할 기준선
    future += pearson(score(mB, fut), fut.map((v) => v.y));
  }
  noPurge /= REP; purged /= REP; future /= REP;
  console.log(`       홀드아웃 IC — 퍼징없음 ${noPurge.toFixed(4)} · 퍼징 ${purged.toFixed(4)} · 진짜미래 ${future.toFixed(4)}`);

  // ★여기서 주장을 조심해야 한다.★ 첫 판본은 "퍼징이 부풀림을 줄인다" 를 계약으로 걸고
  //   통과시켰는데, 실제 감소폭은 0.0001 이었다 — 잡음 수준이다. 그건 거짓 통과다.
  //   측정된 사실은 이렇다:
  //     · 홀드아웃은 진짜 미래보다 약간 부풀어 있다(유한표본 낙관 — 어느 방법이든 남는다)
  //     · 그 부풀림의 원인은 ★경계 겹침이 아니다★ — 퍼징해도 거의 안 변한다
  //   그러므로 이 게이트는 "퍼징이 갭을 고친다" 를 주장하지 않는다.
  //   퍼징은 ★교과서적으로 옳은 위생★ 이고(경계에서 학습이 검증 구간 가격을 보는 경로를 없앤다),
  //   여기서 검사할 것은 "해롭지 않은가" 와 "실력을 지우지 않는가" 뿐이다.
  if (purged <= noPurge + 0.005)
    ok(`퍼징이 홀드아웃을 부풀리지 않는다 (${noPurge.toFixed(4)} → ${purged.toFixed(4)}, 진짜미래 ${future.toFixed(4)})`);
  else bad(`퍼징 후 홀드아웃이 오히려 올랐다: ${noPurge.toFixed(4)} → ${purged.toFixed(4)}`);
  console.log(`       ※ 부풀림 ${((noPurge - future) * 100).toFixed(1)}%p 중 퍼징이 걷어낸 몫 ${((noPurge - purged) * 100).toFixed(2)}%p` +
              ` — 경계 겹침은 이 갭의 주원인이 ★아니다★. 운영의 홀드아웃 0.19 vs 전진 0.02 는` +
              ` 측정 버그가 아니라 ★일반화 갭★ 이고, 전진검증이 그걸 잡아낸 것이다.`);
}

// ── ② 퍼징이 진짜 신호까지 지우지는 않는다 ──────────────────────────────
//   누출만 걷어내야지, 실력까지 0 으로 만들면 그건 과잉 교정이다.
{
  const SPAN = 5, DAYS = 40, SYMS = 60;
  let purged = 0; const REP = 40;
  for (let r = 0; r < REP; r++) {
    const all = gen({ days: DAYS, syms: SYMS, spanDays: SPAN, signal: 0.6 });   // 강한 신호
    const nval = Math.floor(all.length * 0.2), ntr0 = all.length - nval;
    const val = all.slice(ntr0), bound = val[0].t;
    let keep = ntr0; while (keep > 0 && all[keep - 1].t + SPAN * DAY > bound) keep--;
    purged += pearson(score(fit(all.slice(0, keep)), val), val.map((v) => v.y));
  }
  purged /= REP;
  if (purged > 0.10) ok(`강한 신호(0.6)는 퍼징 후에도 홀드아웃 IC ${purged.toFixed(3)} 로 살아남는다`);
  else bad(`퍼징이 진짜 신호까지 지웠다: IC ${purged.toFixed(3)}`);
}

// ── ③ 소스 계약 ────────────────────────────────────────────────────────
{
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  if (/while \(_keep > 0 && _num\(T\[_keep - 1\], 0\) \+ _span > _bound\) _keep--;/.test(src))
    ok("경계보다 라벨 구간이 뻗는 학습표본을 잘라낸다");
  else bad("퍼징 루프가 없다");
  if (/if \(ntr < opts\.minN\) \{[\s\S]{0,320}?퍼징 후 학습표본/.test(src))
    ok("퍼징 후 표본이 모자라면 ★학습을 미룬다★ (누출을 남기고 학습하지 않는다)");
  else bad("퍼징 후 표본 부족 시 그냥 학습한다 — 누출이 남는다");
  if (/ntr = _keep;/.test(src) && !/Math\.max\(Math\.min\(ntr, _floorN\), _keep\)/.test(src))
    ok("부분 퍼징을 하지 않는다 — 첫 판본은 ★경계에 가장 가까운(가장 누출된)★ 표본을 남기는 식이었다");
  else bad("부분 퍼징 식이 남아 있다 — 가장 누출된 표본을 남기는 방향이다");
  if (/purged: _purged/.test(src)) ok("잘라낸 건수를 모델에 남긴다(홀드아웃 신뢰의 근거)");
  else bad("퍼징 건수를 기록하지 않는다");
}

// ── [V33.155] ★홀드아웃 경계는 퍼징으로 움직이지 않는다★ ─────────────────
//   실제 사고: 퍼징이 ntr 을 줄인 뒤 검증 루프가 `i = ntr` 부터 돌아, 잘라낸 구간이
//   그대로 홀드아웃에 흡수됐다. 증상이 숫자로 남아 있었다 —
//   운영 스냅샷의 XALPHA valAcc 가 ★2.4159★. 분류 정확도는 1 을 넘을 수 없다.
//   (루프는 늘어난 구간을 돌고 분모는 원래 nval 이었다)
//   통계적으로 더 나쁜 건: 퍼징 구간은 라벨이 학습구간과 겹쳐 적합값 쪽으로 끌리는
//   ★다른 모집단★ 이다. 진짜 홀드아웃과 섞이면 블록 간 분산이 커져 t 가 주저앉는다.
{
  const src2 = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const fn = src2.slice(src2.indexOf("async function _miniLogisticTrain"),
                        src2.indexOf("async function flowTrainNightly"));
  if (/const nvalStart = N - nval;/.test(fn)) ok("홀드아웃 시작점(nvalStart)을 못 박는다");
  else bad("홀드아웃 시작점이 없다 — 퍼징이 경계를 움직인다");
  if (/for \(let i = nvalStart; i < N; i\+\+\) \{/.test(fn))
    ok("검증 루프가 nvalStart 부터 돈다(퍼징 구간은 학습에서만 빠진다)");
  else bad("검증 루프가 퍼징된 ntr 부터 돈다 — 잘라낸 구간이 홀드아웃에 섞인다");
  if (/const acc = correct \/ Math\.max\(1, N - nvalStart\);/.test(fn))
    ok("정확도 분모가 실제로 돈 횟수와 같다(1 을 넘을 수 없다)");
  else bad("정확도 분모가 루프 횟수와 다르다 — valAcc 가 1 을 넘을 수 있다");
  if (/let _nEff = 0; for \(let i = nvalStart; i < N; i\+\+\)/.test(fn))
    ok("유효표본수도 같은 구간에서 센다");
  else bad("유효표본수를 다른 구간에서 센다 — 고유도·Wilson 하한이 어긋난다");
  if (/const _bound = _num\(T\[nvalStart\], 0\);/.test(fn))
    ok("퍼징 경계 시각이 홀드아웃 첫 표본이다(퍼징으로 스스로 움직이지 않는다)");
  else bad("퍼징 경계가 ntr 을 참조한다 — 자기가 자른 결과를 다시 경계로 삼는다");
}

// 산식이 실제로 1 을 못 넘는지 — 계약을 글이 아니라 수로 확인한다.
{
  const N = 5000, nval = Math.max(100, Math.floor(N * 0.2));
  const nvalStart = N - nval;
  let worst = 0;
  for (const purged of [0, 500, 2000, nvalStart - 1]) {
    const ntr = Math.max(0, nvalStart - purged);
    const loops = N - nvalStart;                  // 고친 판: 경계 고정
    const acc = loops / Math.max(1, N - nvalStart);
    worst = Math.max(worst, acc);
    // 종전 판을 재현해 1 을 넘는지도 확인
    const accOld = (N - ntr) / Math.max(1, nval);
    if (purged > 0 && !(accOld > 1)) bad(`종전 산식이 퍼징 ${purged}건에서 1 을 안 넘는다 — 재현 실패`);
  }
  if (worst <= 1) ok(`고친 산식은 퍼징량과 무관하게 정확도 ≤ 1 (최대 ${worst.toFixed(3)})`);
  else bad(`고친 산식도 정확도가 1 을 넘는다(${worst.toFixed(3)})`);
}

// ── [V33.156] ★퍼징은 한 모델의 기능이 아니라 계약이다★ ────────────────────
//   V33.141 은 _miniLogisticTrain(flow·xalpha·stack·dual)에만 퍼징을 넣었다.
//   그런데 MEMO 는 ★같은 ml_samples 를 같은 10일 라벨 지평★ 으로 쓰면서 퍼징이 없었다.
//   운영 스냅샷이 그 서명을 그대로 보였다 — 홀드아웃 IC 0.167 vs 전진 IC 0.044(3.8배).
//   퍼징을 만들게 한 FLOW 의 "홀드아웃 0.19 vs 전진 0.02" 와 같은 모양이다.
//   → 시간분할 홀드아웃으로 학습하는 야간 학습기는 ★전부★ 퍼징해야 한다. 여기서 강제한다.
{
  const src3 = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const cut = (a, b) => { const i = src3.indexOf(a); const j = b ? src3.indexOf(b, i) : src3.length; return src3.slice(i, j); };
  const trainers = [
    ["_miniLogisticTrain", cut("async function _miniLogisticTrain", "async function flowTrainNightly")],
    ["memoTrainNightly",   cut("async function memoTrainNightly", "function memoScore")]
  ];
  for (const [nm, body] of trainers) {
    if (!body || body.length < 200) { bad(`${nm} 본문을 못 찾았다 — 검사가 헛돈다`); continue; }
    // ① 홀드아웃 경계를 고정하는가
    if (/const nvalStart = N - nval;/.test(body)) ok(`${nm}: 홀드아웃 경계(nvalStart)를 못 박는다`);
    else bad(`${nm}: 홀드아웃 경계가 고정돼 있지 않다 — 퍼징이 경계를 움직인다`);
    // ② 라벨 지평만큼 학습 끝을 잘라내는가
    if (/_num\(T\[_keep - 1\], 0\) \+ _span > _bound/.test(body)) ok(`${nm}: 라벨 구간이 경계를 넘는 학습표본을 잘라낸다`);
    else bad(`${nm}: 퍼징이 없다 — 경계 직전 학습표본의 결과가 홀드아웃 안으로 뻗는다(누출)`);
    // ③ 잘라서 모자라면 학습을 미루는가(부분 퍼징 금지)
    if (/퍼징 후 학습표본/.test(body)) ok(`${nm}: 퍼징 후 표본이 모자라면 학습을 미룬다`);
    else bad(`${nm}: 퍼징 후 부족을 처리하지 않는다`);
    // ④ 검증 루프가 고정 경계에서 시작하는가
    if (/for \(let i = nvalStart; i < N; i\+\+\)/.test(body)) ok(`${nm}: 검증이 고정 경계에서 시작한다`);
    else bad(`${nm}: 검증이 퍼징된 ntr 에서 시작한다 — 잘라낸 구간이 홀드아웃에 섞인다`);
    // ⑤ 근거를 모델에 남기는가
    if (/purged: _purged/.test(body)) ok(`${nm}: 잘라낸 건수를 모델에 남긴다`);
    else bad(`${nm}: 퍼징 건수를 남기지 않는다 — 홀드아웃을 믿을 근거가 화면에 없다`);
  }
}

console.log(fails ? "\n퍼징 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   퍼징 계약 통과");
process.exit(fails ? 1 : 0);
