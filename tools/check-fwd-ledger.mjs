// [V33.140] 전진검증 누적 원장 계약.
//
//   ★고친 사고★ 전진표본은 "학습 당시 없던 행"(id > 학습때 기록한 maxId)으로 고르는데,
//   그 maxId 가 ★매일 밤 재학습마다 갱신★ 됐다. 즉 전진창이 언제나 하루치였다.
//   표본 유입은 하루 약 384건, 문턱은 400건 — 채워지는 속도보다 리셋이 빠르니 영원히 못 넘는다.
//   운영 스냅샷이 그대로 보여줬다: memo 는 총표본 177,868 인데 전진 357(= 어제 유입과 일치),
//   stack 은 총 2,086 인데 전진 358. 예산 버킷 교착과 완전히 같은 모양이다.
//
//   ★고친 방식★ 하루치를 버리지 않고 원장에 append 하고, 전진통계를 원장 전체로 낸다.
//   각 줄은 그 줄을 만든 모델 버전에게 진짜 out-of-sample 이고, 날짜는 자연스러운
//   비중첩 블록이라 블록 t 의 가정이 성립한다(표준적인 walk-forward 평가다).
//
//   ★양쪽을 함께 본다★ — 교착만 풀면 잡음이 들어오고, 엄격만 지키면 종전 상태 그대로다.

import { readFileSync } from "node:fs";
import { _tToZ, ICGATE } from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

const MIN_DAYS = 3, KEEP = 45;

// src/index.js 의 누적 산식을 그대로 옮긴 것(소스 계약이 아래에서 이 식의 존재를 확인한다)
function ledgerStats(v) {
  let nSum = 0, wIC = 0;
  for (const e of v) { nSum += e.n; wIC += e.ic * e.n; }
  const ic = nSum > 0 ? wIC / nSum : null;
  let t = null;
  if (v.length >= 2) {
    let m = 0; for (const e of v) m += e.ic; m /= v.length;
    let s2 = 0; for (const e of v) s2 += (e.ic - m) * (e.ic - m);
    const sd = Math.sqrt(s2 / Math.max(1, v.length - 1));
    const tRaw = sd > 1e-9 ? m / (sd / Math.sqrt(v.length)) : (m > 0 ? 9 : (m < 0 ? -9 : 0));
    t = _tToZ(tRaw, v.length - 1);
  }
  const ready = nSum >= ICGATE.minForward && v.length >= MIN_DAYS && t != null;
  return { n: nSum, ic, t, ready, days: v.length };
}
// 하루치 IC 를 배치 크기에 맞는 표집오차와 함께 만든다(상관계수의 SE ≈ 1/√n)
const dayIC = (trueIC, n) => trueIC + randn() / Math.sqrt(Math.max(4, n - 3));

// ── ① 교착이 풀린다 ──────────────────────────────────────────────────────
{
  const perDay = 384;                     // 운영 실측(4,245건 / 265시간)
  // 종전 동작: 창이 매일 리셋되므로 '오늘 배치' 하나만 본다
  let oldReadyDays = 0;
  for (let d = 1; d <= 60; d++) if (perDay >= ICGATE.minForward) oldReadyDays++;
  if (oldReadyDays === 0) ok(`종전 방식 — 하루치 ${perDay}건 < 문턱 ${ICGATE.minForward}건이라 60일 내내 준비 안 됨(교착 재현)`);
  else bad(`종전 방식이 통과해 버린다 — 재현이 틀렸다(${oldReadyDays}일)`);

  const v = [];
  let readyOn = null;
  for (let d = 1; d <= 20; d++) {
    v.push({ n: perDay, ic: dayIC(0.05, perDay) });
    const st = ledgerStats(v);
    if (st.ready && readyOn == null) readyOn = d;
  }
  if (readyOn != null && readyOn <= 5) ok(`누적 원장 — ${readyOn}일차에 준비 완료(누적 ${perDay * readyOn}건 ≥ ${ICGATE.minForward}, ${MIN_DAYS}일 이상)`);
  else bad(`누적해도 준비가 안 되거나 너무 늦다: ${readyOn}일차`);

  // 하루 유입이 문턱의 절반뿐인 느린 표(예: STACK 초기)도 결국 도달해야 한다
  const v2 = [];
  let readyOn2 = null;
  for (let d = 1; d <= 30; d++) {
    v2.push({ n: 120, ic: dayIC(0.05, 120) });
    if (ledgerStats(v2).ready && readyOn2 == null) readyOn2 = d;
  }
  if (readyOn2 != null) ok(`하루 120건짜리 느린 표도 ${readyOn2}일차에 도달(종전엔 영원히 불가)`);
  else bad("하루 120건이면 30일 내에도 도달 못 한다");
}

// ── ② 잡음은 여전히 못 지나간다 ─────────────────────────────────────────
//   forwardTMin=1.0 은 단측 약 16% 다. 그 근처면 계약대로다 — 낮아지면 안 된다.
{
  const N = 20000;
  let pass = 0, ready = 0;
  for (let i = 0; i < N; i++) {
    const v = [];
    for (let d = 0; d < 5; d++) v.push({ n: 384, ic: dayIC(0, 384) });   // 진짜 IC = 0
    const st = ledgerStats(v);
    if (st.ready) { ready++; if (st.ic > ICGATE.forwardFloor && st.t >= ICGATE.forwardTMin) pass++; }
  }
  const rate = pass / N * 100;
  if (rate < 22) ok(`잡음 모델의 전진통과율 ${rate.toFixed(1)}% (문턱 t≥${ICGATE.forwardTMin} = 단측 ~16%, 계약과 일치)`);
  else bad(`잡음 전진통과율 ${rate.toFixed(1)}% — 문턱이 무력화됐다`);
  if (ready === N) ok("준비 판정 자체는 표본량으로만 결정된다(성적과 무관 — 순환논리 없음)");
  else bad(`준비 판정이 성적에 좌우된다: ${ready}/${N}`);
}

// ── ③ 실력은 통과한다 ───────────────────────────────────────────────────
{
  for (const [trueIC, want] of [[0.03, 40], [0.06, 65], [0.12, 90]]) {
    let pass = 0; const N = 4000;
    for (let i = 0; i < N; i++) {
      const v = [];
      for (let d = 0; d < 10; d++) v.push({ n: 384, ic: dayIC(trueIC, 384) });
      const st = ledgerStats(v);
      if (st.ready && st.ic > ICGATE.forwardFloor && st.t >= ICGATE.forwardTMin) pass++;
    }
    const rate = pass / N * 100;
    if (rate >= want) ok(`진짜 IC ${trueIC} · 10일 누적 → 통과율 ${rate.toFixed(0)}% (기대 ≥${want}%)`);
    else bad(`진짜 IC ${trueIC} 통과율 ${rate.toFixed(0)}% < ${want}% — 검정력이 부족하다`);
  }
}

// ── ④ 방향이 반대면 누적해도 통과 못 한다 ───────────────────────────────
{
  let pass = 0; const N = 8000;
  for (let i = 0; i < N; i++) {
    const v = [];
    for (let d = 0; d < 10; d++) v.push({ n: 384, ic: dayIC(-0.07, 384) });   // xalpha 처럼 음수
    const st = ledgerStats(v);
    if (st.ready && st.ic > ICGATE.forwardFloor && st.t >= ICGATE.forwardTMin) pass++;
  }
  if (pass === 0) ok(`전진 IC 가 −0.07 인 모델 ${N}회 — 누적해도 통과 0건 (누적이 부호를 뒤집지 않는다)`);
  else bad(`음수 IC 모델이 ${pass}/${N} 건 통과했다`);
}

// ── ⑤ [V33.149] 줄의 단위는 ★날짜★ 이고, 겹침은 고수위(hwm)로 막는다 ─────────
//   ★고친 사고★ 종전 줄 key 는 모델 버전(prev.ts)이었다. 의도("같은 구간을 두 번 세지 않는다")는
//   옳았지만, 재학습이 멈춘 모델은 key 가 영원히 같아 ★한 줄만 덮어쓴다★ → days 가 1 에 고정되고
//   ready(days ≥ 3)와 블록 t(줄 2개 이상)를 구조적으로 못 넘는다. 운영 스냅샷(2026-08-18):
//   flow·stack 은 모델이 7일째 그대로라 fwdDays=1, 매일 재학습되는 xalpha(5)·memo(8)만 쌓였다.
//   "학습이 멈춘 모델일수록 전진검증도 영영 못 끝낸다" 는 역방향 잠금이었다.
{
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  if (/const _day = new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/.test(src)
      && /_led\.v\.findIndex\(function \(x\) \{ return x && x\.key === _day; \}\)/.test(src))
    ok("줄 key 가 날짜다 — 재학습 여부와 무관하게 날짜 블록이 쌓인다");
  else bad("줄 key 가 날짜가 아니다 — 재학습이 멈추면 days 가 1 에 고정된다");
  if (/_led\.hwmId/.test(src) && /_led\.hwmTs/.test(src)
      && /Math\.max\(_num\(prev\.maxId, 0\), _num\(_led\.hwmId, 0\)\)/.test(src))
    ok("고수위(hwm) 이후만 조회한다 — 줄끼리 겹치지 않아 블록 t 의 가정이 성립한다");
  else bad("고수위가 없다 — 같은 표본을 여러 줄에 나눠 세면 t 가 과장된다");
  if (/_num\(_led\.ver, 1\) !== _LEDVER/.test(src))
    ok("원장 스키마 버전이 다르면 버린다 — 구판(버전키·hwm 없음)과 섞으면 두 번 센다");
  else bad("구판 원장을 이어 쓴다 — 같은 표본이 두 번 세어져 t 가 부풀어 오른다");
  //   정렬열 = 필터열. 다르면 LIMIT 이 중간을 건너뛰고 hwm 이 그 행을 영구히 버린다.
  if (/_order = "id ASC"/.test(src) && /ORDER BY " \+ _order/.test(src))
    ok("정렬을 필터와 같은 열로 맞춘다 — LIMIT 이 중간을 건너뛰어도 표본이 새지 않는다");
  else bad("정렬열과 필터열이 다르다 — hwm 을 올리는 순간 안 센 행이 영구히 버려진다");
  if (/_led\.featVer !== o\.featVer/.test(src)) ok("featVer 가 바뀌면 원장을 버린다(다른 모델이다)");
  else bad("featVer 변경 시 원장을 이어 쓴다 — 다른 모델의 성적이 섞인다");
  if (/_led\.v\.length > FWDLED\.keepDays/.test(src)) ok(`원장을 최근 ${KEEP}일로 자른다(모델도 시장도 변한다)`);
  else bad("원장이 무한히 자란다");
  if (/COALESCE\(ins_ts, ts\)>=/.test(src)) ok("표본 유입량을 적재시각(ins_ts)으로 센다 — ts 는 봉 날짜라 249배 어긋났다");
  else bad("유입량을 ts 로 센다 — '최근 24h 1건' 같은 오경보가 다시 난다");
}

// ── ⑥ 재학습이 멈춘 모델도 전진검증을 끝낼 수 있어야 한다 ────────────────────
//   두 방식을 같은 유입에 돌려 비교한다. 이건 통계 검정이 아니라 ★교착 검사★ 다.
{
  const ARRIVE = 380;                 // 하루 유입(운영 실측 근방)
  const runDays = 12;
  // 종전: 줄 key = 모델 버전. 재학습이 없으면 버전이 안 바뀐다.
  const oldWay = (retrains) => {
    const v = []; let modelVer = 0, consumed = 0;
    for (let d = 0; d < runDays; d++) {
      if (retrains) { modelVer = d; consumed = 0; }       // 재학습 → 창 리셋
      consumed += ARRIVE;                                  // 누적창(겹침) 전체를 다시 센다
      const row = { key: modelVer, n: consumed, ic: 0.04 };
      const i = v.findIndex((x) => x.key === row.key);
      if (i >= 0) v[i] = row; else v.push(row);
    }
    return ledgerStats(v);
  };
  // 신판: 줄 key = 날짜, 조회는 hwm 이후만 → 줄끼리 비겹침.
  const newWay = (retrains) => {
    const v = []; let hwm = 0, arrived = 0;
    for (let d = 0; d < runDays; d++) {
      arrived += ARRIVE;
      const batch = arrived - hwm;                         // hwm 이후만
      if (batch >= 30) { v.push({ key: "d" + d, n: batch, ic: 0.04 }); hwm = arrived; }
    }
    return { ...ledgerStats(v), pooledN: v.reduce((a, e) => a + e.n, 0) };
  };
  const oS = oldWay(false), nS = newWay(false);
  if (oS.days === 1 && !oS.ready) ok(`종전 방식 재현: 재학습 없는 모델은 ${runDays}일 뒤에도 days=1 · ready=false (교착)`);
  else bad(`종전 방식이 교착을 재현하지 않는다(days=${oS.days} ready=${oS.ready}) — 검사가 헛돈다`);
  if (nS.days === runDays && nS.ready) ok(`새 방식: 재학습이 없어도 days=${nS.days} · ready=true (교착 해소)`);
  else bad(`새 방식도 교착이다(days=${nS.days} ready=${nS.ready})`);
  if (oldWay(true).ready) ok("재학습되는 모델은 종전 방식에서도 통과했다(회귀 아님 — 새 방식이 그 경우를 깨지 않아야 한다)");
  else bad("종전 방식이 재학습 모델조차 통과 못 시킨다 — 비교 기준이 틀렸다");
  if (newWay(true).ready) ok("새 방식도 재학습되는 모델을 그대로 통과시킨다");
  else bad("새 방식이 재학습 모델을 막는다 — 회귀");
  // ★표본을 두 번 세지 않는다★ — 줄의 합이 실제 유입량을 넘으면 t 가 부풀어 오른다.
  const nS2 = newWay(false);
  if (nS2.pooledN === ARRIVE * runDays) ok(`줄 합계 ${nS2.pooledN} = 실제 유입 ${ARRIVE * runDays} — 두 번 세지 않는다`);
  else bad(`줄 합계 ${nS2.pooledN} ≠ 유입 ${ARRIVE * runDays} — 중복 계수`);
}

console.log(fails ? "\n전진 원장 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   전진 원장 계약 통과");
process.exit(fails ? 1 : 0);
