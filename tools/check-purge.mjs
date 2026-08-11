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

console.log(fails ? "\n퍼징 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   퍼징 계약 통과");
process.exit(fails ? 1 : 0);
