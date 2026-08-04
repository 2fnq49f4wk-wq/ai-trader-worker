// [V33.105] 확률 계수 적합기 회복력 검증.
//
//   이 프로젝트에서 확률 관련 사고는 전부 "식은 그럴듯한데 실제로는 안 맞는" 형태였다
//   (확률공간 선형혼합, 점추정 IC 게이트, in-sample 누출, 무의미한 EV 스케일링 …).
//   그래서 적합기는 ★참값을 아는 합성자료★ 로 되찾아지는지 매 배포마다 확인한다.
//   되찾지 못하면 그 계수는 확률 체인에 넣을 자격이 없다.

import { shockPriorFitNightly, decisionBlendFitNightly, _shockLogitShift, _coefShrink, SHOCKCAL,
         _expRegBucket, _expRegIC, EXPREG, LUXML,
         _tSf, _normInv, _tToZ, _icBlockStats, _uniqWeights, _wilsonLB }
  from "../src/index.js";

function fakeDB(init) {
  const state = new Map(Object.entries(init || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    prepare(sql) {
      const st = { _a: [], bind(...a) { st._a = a; return st; },
        async first() {
          if (/SELECT v FROM state WHERE k = \?/.test(sql)) {
            const v = state.get(st._a[0]); return v === undefined ? null : { v };
          } return null;
        },
        async all() { return { results: [] }; },
        async run() { if (/INSERT INTO state/.test(sql)) state.set(st._a[0], st._a[1]); return {}; } };
      return st;
    },
    async batch(a) { for (const s of a) await s.run(); return []; },
    get(k) { const v = state.get(k); return v === undefined ? null : JSON.parse(v); }
  };
}

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };

// 결정적 난수 — CI 에서 흔들리면 게이트가 아니라 소음이 된다.
let _s = 987654321;
const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };

// ══ 1) 충격 프라이어 잔여계수 — 참값 회복 ═════════════════════════════════════
//   설정: 엔진이 dz 만큼 밀었지만 ★참 효과는 dz 의 (1+kTrue) 배★ 였다.
//   그러면 오프셋 로지스틱이 잔여 kTrue 를 되찾아야 하고, 배율은 1+kTrue 가 된다.
async function shockCase(kTrue, n, label) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    // dz 는 crash(음수)·rally(양수) 를 섞는다 — 한쪽만이면 계수가 식별되지 않는다.
    const dz = (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 1.2);
    const pBase = 0.35 + rnd() * 0.3;                        // 위원회 확률(적용 전)
    const zApplied = Math.log(pBase / (1 - pBase)) + dz;      // 엔진이 적용한 확률
    const pApplied = 1 / (1 + Math.exp(-zApplied));
    const pTrue = 1 / (1 + Math.exp(-(zApplied + kTrue * dz)));  // 참 승률
    rows.push([dz < 0 ? "crash" : "rally", +dz.toFixed(3), +pApplied.toFixed(4), rnd() < pTrue ? 1 : 0]);
  }
  const db = fakeDB({ shock_cal_buf: { v: rows, ts: Date.now() } });
  const msg = await shockPriorFitNightly(db);
  const st = db.get("shock_prior_k");
  return { msg, st, expect: 1 + kTrue };
}

{
  // (a) 엔진이 2배 과하게 밀었다 → 참 잔여 k = −0.5 → 배율 0.5
  const r = await shockCase(-0.5, 1200, "과대적용");
  if (!r.st) bad("과대적용: 계수가 저장되지 않았다 — " + r.msg);
  else if (Math.abs(r.st.mult - 0.5) <= 0.15) ok("과대적용 회복: 배율 " + r.st.mult.toFixed(3) + " (참값 0.500, t " + r.st.t + ")");
  else bad("과대적용 회복 실패: 배율 " + r.st.mult + " ≠ 0.500 — " + r.msg);
}
{
  // (b) 적용량이 정확했다 → 참 잔여 k = 0 → 배율 1.0 (유의성 없어 수축되어도 1 로 남는다)
  const r = await shockCase(0, 1200, "적정");
  if (!r.st) bad("적정: 계수가 저장되지 않았다 — " + r.msg);
  else if (Math.abs(r.st.mult - 1.0) <= 0.12) ok("적정 적용 확인: 배율 " + r.st.mult.toFixed(3) + " (참값 1.000)");
  else bad("적정인데 배율이 틀어졌다: " + r.st.mult + " — " + r.msg);
}
{
  // (c) 참 효과는 0 인데 표본이 적을 때 — 잡음으로 나온 계수를 믿으면 안 된다.
  //     |t| 가 작아 _coefShrink 가 0 쪽으로 수축시켜 배율 1(= 종전 상수)이 유지돼야 한다.
  //     이게 깨지면 "안 잰 것을 잰 척" 하는 사고가 난다.
  const r = await shockCase(0, 80, "소표본");
  const st = r.st;
  if (st && Math.abs(st.mult - 1.0) <= 0.05)
    ok("소표본(n80·참값 0)에서 배율 " + st.mult.toFixed(3) + " 유지 (원계수 " + st.rawK + ", t " + st.t + ")");
  else bad("소표본인데 배율이 " + (st ? st.mult : "null") + " — 유의성 수축이 안 먹는다");
}
{
  // (d) 참 효과가 크면 소표본이어도 유의해져 반영돼야 한다(수축이 과하면 영영 못 잰다).
  const r = await shockCase(-0.7, 900, "강효과");
  if (r.st && Math.abs(r.st.mult - 0.3) <= 0.12) ok("강효과 반영: 배율 " + r.st.mult.toFixed(3) + " (참값 0.300 = 하한)");
  else bad("강효과가 반영되지 않는다: " + (r.st ? r.st.mult : "null"));
}

// ══ 2) 표본 부족 시엔 아예 재지 않는다(대기) ══════════════════════════════════
{
  const db = fakeDB({ shock_cal_buf: { v: [["crash", -1, 0.4, 1], ["rally", 1, 0.6, 0]], ts: Date.now() } });
  const msg = await shockPriorFitNightly(db);
  if (/대기/.test(msg) && !db.get("shock_prior_k")) ok("표본 부족 시 미측정 유지 (" + msg.slice(0, 40) + "…)");
  else bad("표본 2건인데 계수를 냈다 — " + msg);
}

// ══ 3) 배율이 _shockLogitShift 에 실제로 반영되는가 ═══════════════════════════
{
  const shock = { mode: "crash", sev: 1.0, trend: null };
  const base = _shockLogitShift(shock, 0, 1);
  const half = _shockLogitShift(shock, 0, 0.5);
  if (base < 0 && Math.abs(half - base * 0.5) < 1e-9) ok("배율 반영 확인: 1.0 → " + base.toFixed(3) + ", 0.5 → " + half.toFixed(3));
  else bad("배율이 반영되지 않는다: base " + base + " half " + half);
  // 배율 인자를 안 넘기면 종전 동작(=1) 이어야 한다 — 회귀 방지.
  if (Math.abs(_shockLogitShift(shock, 0) - base) < 1e-9) ok("인자 생략 시 종전 동작 보존");
  else bad("인자 생략 시 값이 달라진다 — 하위호환 깨짐");
  // 상·하한 밖 배율은 잘려야 한다(폭주 방지).
  const huge = _shockLogitShift(shock, 0, 99);
  if (Math.abs(huge - base * SHOCKCAL.kMax) < 1e-9) ok("배율 상한 " + SHOCKCAL.kMax + " 클램프");
  else bad("배율 상한이 안 걸린다: " + huge);
}

// ══ 4) _coefShrink 계약 ═══════════════════════════════════════════════════════
{
  const cases = [[0, 0], [1.65, 0], [2.65, 1], [10, 1], [-2.65, 1]];
  let allOk = true;
  for (const [t, want] of cases) if (Math.abs(_coefShrink(t) - want) > 1e-9) { allOk = false; bad("_coefShrink(" + t + ") = " + _coefShrink(t) + " ≠ " + want); }
  if (allOk) ok("_coefShrink 계약 (|t|≤1.65 → 0, |t|≥2.65 → 1)");
}

// ══ 5) 상황별 반성기억(TradingAgents 이식) — 버킷 판정과 수축 계약 ═══════════
//   위원회 가중을 바꾸는 자리라, "표본이 없으면 종전과 완전히 같아야" 한다는 게 핵심 계약이다.
{
  const D = LUXML.featNames.length;
  const mk = (reg, atr) => {
    const v = new Array(D).fill(0);
    v[LUXML.featNames.indexOf("regBull")] = reg === "BULL" ? 1 : 0;
    v[LUXML.featNames.indexOf("regBear")] = reg === "BEAR" ? 1 : 0;
    v[LUXML.featNames.indexOf("atrPct")] = atr;
    return v;
  };
  const cases = [["BULL", 1.0, "BULL_LO"], ["BULL", 5.0, "BULL_HI"],
                 ["BEAR", 1.0, "BEAR_LO"], ["NEUT", 5.0, "NEUT_HI"]];
  let allOk = true;
  for (const [reg, atr, want] of cases) {
    const got = _expRegBucket(mk(reg, atr));
    if (got !== want) { allOk = false; bad("버킷 판정 " + reg + "/" + atr + " → " + got + " ≠ " + want); }
  }
  if (allOk) ok("레짐×변동성 버킷 판정 4케이스");
  if (_expRegBucket(null) === null && _expRegBucket([1, 2]) === null) ok("잘못된 벡터는 버킷 null (호출부가 전역 IC 로 폴백)");
  else bad("잘못된 벡터에서 버킷이 나왔다");

  // 표본 부족 → 전역 IC 그대로 (종전 동작 보존)
  const few = { mind: { BULL_LO: { n: EXPREG.minBucketN - 1, ic: 0.30, t: 9 } } };
  if (_expRegIC(0.04, few, "mind", "BULL_LO") === 0.04) ok("버킷 표본 부족 시 전역 IC 유지 (0.040)");
  else bad("표본 부족인데 버킷 IC 를 썼다: " + _expRegIC(0.04, few, "mind", "BULL_LO"));

  // t 가 작으면(잡음) 전역 IC 그대로
  const noisy = { mind: { BULL_LO: { n: 5000, ic: 0.30, t: 1.2 } } };
  if (_expRegIC(0.04, noisy, "mind", "BULL_LO") === 0.04) ok("t 1.2(유의성 미달) → 전역 IC 유지");
  else bad("잡음 버킷을 반영했다: " + _expRegIC(0.04, noisy, "mind", "BULL_LO"));

  // t 가 충분히 크면 버킷 IC 로 완전히 이동
  const solid = { mind: { BULL_LO: { n: 5000, ic: 0.12, t: 4.0 } } };
  if (Math.abs(_expRegIC(0.04, solid, "mind", "BULL_LO") - 0.12) < 1e-9) ok("t 4.0(유의) → 버킷 IC 0.120 로 이동");
  else bad("유의한 버킷이 반영되지 않았다: " + _expRegIC(0.04, solid, "mind", "BULL_LO"));

  // 중간 t 는 부분 이동(선형 보간)
  const mid = { mind: { BULL_LO: { n: 5000, ic: 0.12, t: 2.15 } } };  // shrink = (2.15-1.65)/1 = 0.5
  const got = _expRegIC(0.04, mid, "mind", "BULL_LO");
  if (Math.abs(got - (0.04 + 0.5 * (0.12 - 0.04))) < 1e-9) ok("중간 유의성 t 2.15 → 절반만 이동 (" + got.toFixed(3) + ")");
  else bad("부분 이동이 틀렸다: " + got);

  // 표 자체가 없으면(미측정) 전역 IC 그대로 — 배포 직후의 정상 상태
  if (_expRegIC(0.04, null, "mind", "BULL_LO") === 0.04) ok("미측정 상태에서 종전 동작 보존");
  else bad("미측정인데 값이 바뀌었다");
}

// ══ 6) 유의성 자유도 보정 — 문턱의 '원래 의도' 가 복원되는가 ═════════════════
//   블록 IC 의 t 는 자유도 K−1 인 Student-t 인데 문턱은 정규 값(1.65/2.50)이었다.
//   df=4 에서 t 2.50 의 실제 p 는 0.0334 로, 8모델 본페로니가 밤당 23.8% 로 새고 있었다.
{
  // (a) t 꼬리확률이 알려진 값과 맞는가 (scipy 로 검산한 참값)
  const cases = [[1.65, 4, 0.0871], [2.50, 4, 0.0334], [1.65, 9, 0.0667], [2.50, 9, 0.0169],
                 [2.50, 11, 0.0148], [1.96, 1000, 0.0250]];
  let allOk = true;
  for (const [t, df, want] of cases) {
    const got = _tSf(t, df);
    if (Math.abs(got - want) > 0.0015) { allOk = false; bad("_tSf(" + t + "," + df + ") = " + got.toFixed(4) + " ≠ " + want); }
  }
  if (allOk) ok("Student-t 꼬리확률 6케이스 (참값 대조)");

  // (b) 정규 역누적분포
  const ni = [[0.975, 1.959964], [0.95, 1.644854], [0.99, 2.326348], [0.5, 0]];
  let niOk = true;
  for (const [p, want] of ni) if (Math.abs(_normInv(p) - want) > 1e-4) { niOk = false; bad("_normInv(" + p + ") = " + _normInv(p) + " ≠ " + want); }
  if (niOk) ok("정규 역누적분포 4케이스");

  // (c) ★핵심 계약★ — df 가 작으면 z 가 t 보다 작아야 한다(문턱을 넘기 어려워진다).
  const z4 = _tToZ(2.50, 4), z9 = _tToZ(2.50, 9), zBig = _tToZ(2.50, 5000);
  if (z4 < z9 && z9 < zBig && Math.abs(zBig - 2.50) < 0.01)
    ok("자유도 보정: t 2.50 → z " + z4.toFixed(2) + "(df4) < " + z9.toFixed(2) + "(df9) < " + zBig.toFixed(2) + "(대표본)");
  else bad("자유도 보정 방향이 틀렸다: " + [z4, z9, zBig].map((x) => x.toFixed(3)).join(" / "));
  // df=4 에서 t 2.50 의 동등 z 는 약 1.83 이어야 한다(위 실측표).
  if (Math.abs(z4 - 1.83) < 0.03) ok("df4 · t2.50 → z " + z4.toFixed(2) + " (본페로니 문턱 2.50 을 이제 못 넘는다)");
  else bad("df4 환산값이 어긋난다: " + z4);
  // 부호 보존
  if (_tToZ(-2.50, 4) === -z4) ok("음수 t 부호 보존");
  else bad("음수 t 부호가 깨졌다: " + _tToZ(-2.50, 4));

  // (d) 순수 잡음이 게이트를 통과하는 비율 — 보정 전/후 비교(회복력의 실측)
  let sN = 424242;
  const rnd2 = () => { sN = (sN * 1664525 + 1013904223) >>> 0; return sN / 4294967296; };
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd2(); while (v === 0) v = rnd2();
                        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let passRaw = 0, passZ = 0; const TRIALS = 600, N = 1000;
  for (let it = 0; it < TRIALS; it++) {
    const pv = [], yv = [];
    for (let i = 0; i < N; i++) { pv.push(gauss()); yv.push(rnd2() < 0.5 ? 1 : 0); }   // 완전 무관
    const st = _icBlockStats(pv, yv, 5);
    if (st.tRaw != null && Math.abs(st.tRaw) >= 2.50) passRaw++;
    if (st.t != null && Math.abs(st.t) >= 2.50) passZ++;
  }
  const rRaw = passRaw / TRIALS, rZ = passZ / TRIALS;
  if (rZ <= rRaw + 1e-9 && rZ <= 0.05)
    ok("잡음 통과율(모델 1개·양측 |·|≥2.50): 보정전 " + (rRaw * 100).toFixed(1) + "% → 보정후 " + (rZ * 100).toFixed(1) + "%");
  else bad("보정이 잡음 통과를 못 줄였다: 전 " + (rRaw * 100).toFixed(1) + "% / 후 " + (rZ * 100).toFixed(1) + "%");
}

// ══ 7) 표본 고유도(de Prado AFML 4장) — 겹치는 라벨을 한 건으로 세지 않는가 ══
//   수확은 매 봉을 표본으로 만들고 라벨 지평은 10일이다. 이웃 표본끼리 결과 구간이 9/10 겹친다.
//   그대로 세면 명목 n 이 실질의 10배가 되고, Wilson 하한이 √10 ≈ 3.2배만큼 과신한다.
{
  const DAY = 86400000, SPAN = 10 * DAY;
  // (a) 완전히 떨어진 표본 — 전부 고유(가중 1)
  const tsFar = [0, 30 * DAY, 60 * DAY, 90 * DAY];
  const wFar = _uniqWeights(tsFar, ["A", "A", "A", "A"], SPAN);
  if (wFar.every((x) => Math.abs(x - 1) < 1e-9)) ok("겹치지 않는 표본 → 고유도 1.0");
  else bad("독립 표본인데 가중이 1이 아니다: " + wFar.join(","));

  // (b) 매일 1건 × 21일, 지평 10일 → 가운데 표본은 앞뒤 10일씩 겹쳐 동시성 21
  const tsDense = [], symDense = [];
  for (let i = 0; i < 21; i++) { tsDense.push(i * DAY); symDense.push("A"); }
  const wD = _uniqWeights(tsDense, symDense, SPAN);
  const mid = wD[10];
  if (Math.abs(mid - 1 / 21) < 1e-9) ok("조밀 표본 가운데 동시성 21 → 가중 " + mid.toFixed(4));
  else bad("동시성 계산이 틀렸다: 가운데 가중 " + mid);
  const nEff = wD.reduce((a, b) => a + b, 0);
  if (nEff < 21 * 0.35) ok("명목 21건 → 유효 " + nEff.toFixed(1) + "건 (겹침 반영)");
  else bad("유효표본이 줄지 않았다: " + nEff.toFixed(1));

  // (c) ★종목이 다르면 겹쳐도 같은 사건이 아니다★ — 종목별로만 센다
  const wSep = _uniqWeights([0, DAY, 2 * DAY], ["A", "B", "C"], SPAN);
  if (wSep.every((x) => Math.abs(x - 1) < 1e-9)) ok("서로 다른 종목은 동시성에 안 섞인다");
  else bad("다른 종목끼리 겹침으로 셌다: " + wSep.join(","));

  // (d) 실제 영향 — Wilson 하한이 얼마나 달라지나(정확도 게이트의 헐거움)
  const lbNom = _wilsonLB(0.55, 2000), lbEff = _wilsonLB(0.55, 200);
  if (lbNom > lbEff + 0.02)
    ok("정확도 0.55 · Wilson 하한: 명목 n2000 " + lbNom.toFixed(4) + " → 유효 n200 " + lbEff.toFixed(4) +
       " (명목으로 재면 " + ((lbNom - lbEff) * 100).toFixed(1) + "%p 과신)");
  else bad("유효표본 반영이 하한을 바꾸지 못했다");

  // (e) 인자가 비면 안전하게 전부 1 (기능 정지 없음)
  const wNone = _uniqWeights([], [], SPAN);
  const wNoSpan = _uniqWeights([0, DAY], ["A", "A"], 0);
  if (wNone.length === 0 && wNoSpan.every((x) => x === 1)) ok("빈 입력·지평 0 → 가중 1 폴백(종전 동작)");
  else bad("폴백이 깨졌다");
}

console.log(fails ? "\n확률 계수 검증 실패 " + fails + "건" : "\n  ok   확률 계수 적합기 통과");
process.exit(fails ? 1 : 0);
