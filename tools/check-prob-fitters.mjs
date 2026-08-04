// [V33.105] 확률 계수 적합기 회복력 검증.
//
//   이 프로젝트에서 확률 관련 사고는 전부 "식은 그럴듯한데 실제로는 안 맞는" 형태였다
//   (확률공간 선형혼합, 점추정 IC 게이트, in-sample 누출, 무의미한 EV 스케일링 …).
//   그래서 적합기는 ★참값을 아는 합성자료★ 로 되찾아지는지 매 배포마다 확인한다.
//   되찾지 못하면 그 계수는 확률 체인에 넣을 자격이 없다.

import { shockPriorFitNightly, decisionBlendFitNightly, _shockLogitShift, _coefShrink, SHOCKCAL }
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

console.log(fails ? "\n확률 계수 검증 실패 " + fails + "건" : "\n  ok   확률 계수 적합기 통과");
process.exit(fails ? 1 : 0);
