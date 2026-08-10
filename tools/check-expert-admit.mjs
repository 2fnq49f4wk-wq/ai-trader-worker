// [V33.138] 위원 자격 계약 — 이분법(trusted)에서 '증거 비례' 로 바꾼 것을 검증한다.
//
//   왜 게이트인가. 이 변경은 ★위원회에 모델을 더 넣는 방향★ 이다. 그런 변경은 "그럴듯해서"가
//   아니라 "잡음이 안 들어오는 것을 실측해서" 여야 한다. 그리고 반대편도 함께 봐야 한다 —
//   전부 막으면 잡음은 0 이지만 그게 바로 종전 상태다(실력 있는 모델도 영영 대기).
//
//   실제 상태(2026-08-10 스냅샷)에서 막힌 이유가 넷 다 달랐다:
//     flow   홀드아웃 t 2.82 통과 · 전진 IC +0.016 양수 · 전진 t 가 1.0 미달
//     stack  홀드아웃 t 3.24 통과 · 전진표본 358/400 (42건 부족)
//     memo   홀드아웃 t 2.32 — 본페로니 문턱 2.50 에 0.18 부족
//     xalpha 홀드아웃 t 3.20 통과인데 ★전진 IC −0.069(음수)★
//   앞의 셋은 "증거가 덜 쌓임", 마지막은 "일반화 실패" 다. 같은 0 점을 주면 정보를 버린다.

import { expertAdmit, ICGATE } from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };

const M = (o) => Object.assign({
  valICt: 3.0, valICBlock: 0.05, fwdReady: true, fwdIC: 0.05, fwdICt: 2.0, fwdN: 2000, trusted: false
}, o);

// ── ① 전진 IC 가 음수면 어떤 홀드아웃 성적으로도 못 들어온다 ────────────────
{
  const r = expertAdmit(M({ valICt: 9, valICBlock: 0.5, fwdIC: -0.069, fwdICt: -2 }));
  if (!r.admit && r.tier === "reject") ok(`전진 IC −0.069 → 제외 (홀드아웃 t 9.0 이어도) — "${r.why.slice(0, 46)}…"`);
  else bad(`전진 IC 음수인데 합류했다: ${JSON.stringify(r)}`);

  // 홀드아웃이 아무리 좋아도 뒤집히지 않는지 몬테카를로로 확인
  let leak = 0;
  for (let i = 0; i < 20000; i++) {
    const r2 = expertAdmit(M({ valICt: 1 + Math.random() * 12, valICBlock: Math.random() * 0.6,
                               fwdIC: -Math.random() * 0.3, fwdICt: -Math.random() * 4, fwdN: 400 + Math.floor(Math.random() * 4000) }));
    if (r2.admit) leak++;
  }
  if (leak === 0) ok("전진 IC 음수 20,000 케이스 — 합류 0건 (문턱이 아니라 방향 증거로 막는다)");
  else bad(`전진 IC 음수인데 ${leak}/20000 건 합류`);
}

// ── ② 잡음 모델은 잠정으로도 못 들어온다 ────────────────────────────────
//   순수 잡음의 블록 IC t 는 대략 표준정규다. tMin(1.65) 은 개별 단측 5% 이므로
//   합류율이 5% 근처여야 하고, 합류해도 가중이 작아야 한다.
{
  const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let admitted = 0, wsum = 0, full = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) {
    const t = randn();                                   // 잡음 → t ~ N(0,1)
    const fIC = randn() * 0.02;                          // 전진 IC 도 0 주변
    const fT = randn();
    const r = expertAdmit(M({ valICt: t, valICBlock: Math.max(0, t) * 0.02, fwdIC: fIC, fwdICt: fT, fwdN: 2000 }));
    if (r.admit) { admitted++; wsum += r.mult; if (r.tier === "full") full++; }
  }
  const rate = admitted / N * 100, avgW = admitted ? wsum / admitted : 0;
  if (rate < 6) ok(`잡음 모델 합류율 ${rate.toFixed(2)}% (개별 5% 문턱과 일치) · 합류해도 평균 가중 ×${avgW.toFixed(2)}`);
  else bad(`잡음 합류율 ${rate.toFixed(2)}% — 너무 높다`);
  if (full === 0) ok("잡음 모델이 ★정식★ 위원이 된 경우 0건 (trusted 는 여전히 야간학습이 정한다)");
  else bad(`잡음이 정식 위원이 됐다: ${full}건`);
  //   ※ 배수 자체를 문턱과 비교하는 것은 ★틀린 계약★ 이다(첫 판본이 그랬다).
  //     실제로 중요한 건 배수가 아니라 위원회에서 차지하는 ★지분★ 이고, 지분은
  //     w = exp(60 × clamp(ic, −0.05, 0.25)) 라 IC 에 지수적으로 반응한다.
  //     같은 배수라도 IC 가 작으면 지분은 무시할 수준이 된다 — 그걸 직접 잰다.
  const W = (ic) => Math.exp(60 * Math.max(-0.05, Math.min(0.25, ic)));
  const REAL = [0.08, 0.06, 0.12, 0.05];        // mind · dnn · gbdt · boost 의 현실적 유효 IC
  const realW = REAL.reduce((a, x) => a + W(x), 0);
  let shareSum = 0, shareMax = 0, cnt = 0;
  for (let i = 0; i < 40000; i++) {
    const t = randn();
    const r = expertAdmit(M({ valICt: t, valICBlock: Math.max(0, t) * 0.02, fwdIC: randn() * 0.02, fwdICt: randn(), fwdN: 2000 }));
    if (!r.admit) continue;
    // _icEffective 와 같은 식: max(0,blockIC) × clamp(t/2,0,1), 여기에 증거배수를 곱한다
    const icEff = Math.max(0, Math.max(0, t) * 0.02) * Math.min(1, Math.max(0, t / 2)) * r.mult;
    const sh = W(icEff) / (realW + W(icEff));
    shareSum += sh; if (sh > shareMax) shareMax = sh; cnt++;
  }
  const avgShare = cnt ? shareSum / cnt : 0;
  if (avgShare < 0.05) ok(`합류한 잡음의 위원회 지분 평균 ${(avgShare * 100).toFixed(2)}% · 최대 ${(shareMax * 100).toFixed(2)}% — 결정을 흔들 수 없다`);
  else bad(`잡음 지분이 평균 ${(avgShare * 100).toFixed(2)}% — 너무 크다`);
}

// ── ③ 실력 있는 모델은 증거가 쌓일수록 가중이 단조 증가한다 ────────────────
{
  const seq = [0, 100, 200, 300, 399].map((n) => expertAdmit(M({ trusted: false, fwdReady: false, fwdIC: null, fwdICt: null, fwdN: n })).mult);
  let mono = true;
  for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1] - 1e-9) mono = false;
  if (mono && seq[4] > seq[0]) ok(`전진표본 0→399 축적 시 가중 단조 증가: ${seq.map((x) => x.toFixed(2)).join(" → ")}`);
  else bad(`가중이 단조 증가하지 않는다: ${seq.join(",")}`);

  const provFull = expertAdmit(M({ trusted: false, fwdReady: true, fwdIC: 0.05, fwdICt: 2.0 })).mult;
  const trusted = expertAdmit(M({ trusted: true })).mult;
  if (trusted === 1 && provFull < 1) ok(`정식(×${trusted.toFixed(2)}) > 잠정 최대(×${provFull.toFixed(2)}) — 정식이 항상 더 무겁다`);
  else bad(`잠정이 정식만큼 무겁다: 잠정 ${provFull} / 정식 ${trusted}`);
}

// ── ④ 실제 사고 재현 — 넷의 판정이 각각 달라야 한다 ───────────────────────
{
  const cases = [
    { nm: "flow",   m: M({ valICt: 2.819, valICBlock: 0.1961, fwdReady: true,  fwdIC: 0.01614, fwdICt: 0.78, fwdN: 2319 }), want: "provisional" },
    { nm: "stack",  m: M({ valICt: 3.242, valICBlock: 0.3397, fwdReady: false, fwdIC: null, fwdICt: null, fwdN: 358 }),     want: "provisional" },
    { nm: "memo",   m: M({ valICt: 2.323, valICBlock: 0.1358, fwdReady: false, fwdIC: null, fwdICt: null, fwdN: 357 }),     want: "provisional" },
    { nm: "xalpha", m: M({ valICt: 3.199, valICBlock: 0.1955, fwdReady: true,  fwdIC: -0.06901, fwdICt: -3.3, fwdN: 2319 }), want: "reject" }
  ];
  for (const c of cases) {
    const r = expertAdmit(c.m);
    if (r.tier === c.want) ok(`${c.nm.padEnd(7)} → ${r.tier}${r.admit ? " ×" + r.mult.toFixed(2) : ""}  ${r.why.slice(0, 52)}`);
    else bad(`${c.nm} 판정이 ${r.tier} (기대 ${c.want}) — ${r.why}`);
  }
  // 셋은 들어오고 하나는 안 들어온다 — 그게 이 변경의 핵심이다
  const admitted = cases.filter((c) => expertAdmit(c.m).admit).length;
  if (admitted === 3) ok("넷 중 셋 합류 · 전진 IC 음수인 xalpha 만 보류 (전부 막던 종전 대비 +3)");
  else bad(`합류 수가 ${admitted} — 기대 3`);
}

// ── ⑤ 가중은 확률이 아니라 IC 에 곱해진다(경계 확인) ─────────────────────
{
  let out = 0;
  for (let i = 0; i < 20000; i++) {
    const r = expertAdmit(M({ valICt: Math.random() * 8, valICBlock: Math.random() * 0.4,
                              fwdReady: Math.random() < 0.5, fwdIC: Math.random() * 0.2,
                              fwdICt: Math.random() * 3, fwdN: Math.floor(Math.random() * 3000) }));
    if (r.mult < 0 || r.mult > 1) out++;
  }
  if (out === 0) ok("가중 배수가 항상 [0,1] 안 — IC 를 키우는 방향으로는 절대 작동하지 않는다");
  else bad(`가중이 범위를 벗어난 경우 ${out}건`);
}

console.log(fails ? "\n위원 자격 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   위원 자격 계약 통과");
process.exit(fails ? 1 : 0);
