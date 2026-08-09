// [V33.116] 원장 성과 통계와 ★자동차단의 유의성★ 계약 검증.
//
//   이 저장소는 모델 검증 쪽(블록 IC·t·본페로니·전진검증)에는 계약을 촘촘히 깔아놓고,
//   정작 ★실제 돈이 걸린 원장 판정★ 은 전부 맨 문턱이었다:
//     · mlSelfReview     n≥15 · 승률<35% · 손익<0   → 진입전략 차단
//     · 신호 자동비활성  기대값<0 & n≥25            → 신호 차단
//     · 전략 자동비활성  exp≤−0.5 & WR≤33 & n≥25    → 전략 차단
//     · 시장×전략 차단   n≥40 · 승률<42% · 평균<0   → ★라이브 매수 차단★
//   이항분포로 실측하면 진짜 승률 50% 인 ★공정한★ 전략도
//     n=15 에서 15.1% / n=40·WR<42% 에서 26.8% 확률로 걸린다.
//   전략·신호·조합이 여럿이고 판정이 매일 반복되므로, 사실상 "언젠가 전부 한 번씩
//   부당하게 꺼지는" 장치였다. V33.116 에서 방향 조건은 그대로 두고 단측 t검정 +
//   본페로니를 필요조건으로 추가했다.
//
//   여기서 못 박는 것:
//     ① _edgeStats 의 t/SQN/p 가 참값을 되찾는가 (Van Tharp SQN = √n·평균/표준편차 = t)
//     ② 순수 잡음(진짜 기대값 0)에서 오차단률이 실제로 떨어졌는가 — 몬테카를로
//     ③ 진짜 나쁜 전략은 여전히 잡히는가 (검정력을 잃으면 그건 고친 게 아니라 끈 것이다)
//     ④ 확장 지표(Sortino·Omega·꼬리비율·Ulcer·SQN)가 답을 아는 자료에서 맞는가
//     ⑤ 자산곡선 지표가 ★시간순★ 으로 계산되는가 (질의는 DESC 다)

import { _edgeStats, _pctile, portfolioStatistics, _tSf,
         computeSignalWeight, SIGNAL_TYPES, DEFAULT_CFG,
         mlGuardObserve, MIND } from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);

// 결정적 정규난수 — CI 에서 흔들리면 게이트가 아니라 소음이 된다.
let _s = 20260804;
function rnd() { _s = (_s * 1664525 + 1013904223) >>> 0; return (_s + 0.5) / 4294967296; }
function gauss() { return Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd()); }

// ══ ① _edgeStats 참값 회복 ══════════════════════════════════════════════════
{
  // 손으로 계산 가능한 자료: [1,2,3,4,5] → 평균 3, 표본표준편차 √2.5, t = 3/(√2.5/√5)
  const e = _edgeStats([1, 2, 3, 4, 5]);
  const sd = Math.sqrt(2.5), t = 3 / (sd / Math.sqrt(5));
  if (e.n === 5 && near(e.mean, 3) && near(e.sd, sd, 1e-9) && near(e.t, +t.toFixed(3), 1e-3))
    ok("_edgeStats 손계산 일치 (평균 3 · sd " + sd.toFixed(4) + " · t " + e.t + ")");
  else bad("_edgeStats 불일치: " + JSON.stringify(e) + " (기대 t=" + t.toFixed(3) + ")");
  if (e.df === 4) ok("df = n−1 = 4"); else bad("df 가 " + e.df);
  if (e.sqn === e.t) ok("SQN == t (같은 수를 두 이름으로 쓴다)");
  else bad("SQN " + e.sqn + " != t " + e.t);
  // 강한 양의 성적은 pNeg 가 1 에 가까워야 한다(나쁠 확률이 없다)
  if (e.pNeg > 0.98) ok("좋은 성적의 pNeg " + e.pNeg.toFixed(4) + " ≈ 1");
  else bad("좋은 성적인데 pNeg 가 " + e.pNeg);
  // 부호 대칭
  const eN = _edgeStats([-1, -2, -3, -4, -5]);
  if (near(eN.t, -e.t, 1e-3) && eN.pNeg < 0.02) ok("부호 반전 시 t 반전 · pNeg " + eN.pNeg.toFixed(4) + " 로 유의");
  else bad("부호 대칭 실패: " + JSON.stringify(eN));
  // 표본 부족 방어
  const e1 = _edgeStats([5]);
  if (e1.pNeg === 1 && e1.t === 0) ok("n=1 이면 판정 불가(pNeg=1) — 차단으로 이어지지 않는다");
  else bad("n=1 처리: " + JSON.stringify(e1));
}

// ══ ② 순수 잡음에서 오차단률 — 몬테카를로 ══════════════════════════════════
//   "진짜 기대값 0" 인 전략을 만들어 종전 규칙과 새 규칙이 각각 몇 번 차단하는지 센다.
{
  const TRIALS = 4000, N = 20, SD = 4;          // 거래당 표준편차 4% (우리 원장 대략치)
  const K = 6;                                   // 동시검정 전략 수
  const alpha = 0.10 / K;
  let oldFire = 0, newFire = 0;
  for (let it = 0; it < TRIALS; it++) {
    const R = []; let wins = 0, sum = 0;
    for (let i = 0; i < N; i++) { const x = gauss() * SD; R.push(x); sum += x; if (x > 0) wins++; }
    // 종전 규칙(mlSelfReview): n≥15 · 승률<35% · 손익<0
    if (N >= 15 && wins / N < 0.35 && sum < 0) oldFire++;
    // 새 규칙: 손익<0 이고 단측 t 가 본페로니 α 이하
    const st = _edgeStats(R);
    if (sum < 0 && st.pNeg <= alpha) newFire++;
  }
  const oldPct = oldFire / TRIALS * 100, newPct = newFire / TRIALS * 100;
  console.log("  info 잡음 " + TRIALS + "회 · n=" + N + " · 전략 " + K + "종 동시검정(α=" + alpha.toFixed(4) + ")");
  if (oldPct > 2) ok("종전 규칙 오차단률 " + oldPct.toFixed(1) + "% — 실제로 높았다");
  else bad("종전 규칙 오차단률이 " + oldPct.toFixed(1) + "% 밖에 안 된다 — 이 시험의 전제가 틀렸다");
  // 기대치는 ★α 자체★ 다 — 단측 검정이 제대로면 오차단률이 α 근방에서 멈춘다.
  //   (손익<0 조건은 유의한 음의 t 에 이미 함의돼 있어 추가로 깎지 않는다)
  //   4,000회 몬테카를로의 표준오차는 약 0.2%p 이므로 α 의 1.5배를 상한으로 둔다.
  const aPct = alpha * 100;
  if (newPct <= aPct * 1.5) ok("새 규칙 오차단률 " + newPct.toFixed(2) + "% ≤ α " + aPct.toFixed(2) + "% × 1.5 — 본페로니와 정합");
  else bad("새 규칙 오차단률이 " + newPct.toFixed(2) + "% (α " + aPct.toFixed(2) + "%) — 유의성 보정이 듣지 않는다");
  if (newPct < oldPct) ok("오차단 " + oldPct.toFixed(1) + "% → " + newPct.toFixed(2) + "% 로 감소");
  else bad("오차단이 줄지 않았다");
}

// ══ ③ 검정력 — 진짜 나쁜 전략은 여전히 잡히는가 ════════════════════════════
//   유의성을 붙여 오차단만 줄이고 진짜 손실전략을 놓치면, 고친 게 아니라 끈 것이다.
{
  const TRIALS = 2000, SD = 4, alpha = 0.10 / 6;
  for (const [N, MU, want] of [[60, -2.0, 0.90], [120, -1.5, 0.95], [40, -3.0, 0.90]]) {
    let fire = 0;
    for (let it = 0; it < TRIALS; it++) {
      const R = []; let sum = 0;
      for (let i = 0; i < N; i++) { const x = MU + gauss() * SD; R.push(x); sum += x; }
      const st = _edgeStats(R);
      if (sum < 0 && st.pNeg <= alpha) fire++;
    }
    const pw = fire / TRIALS;
    if (pw >= want) ok("검정력 n=" + N + " 기대값 " + MU + "%/건 → " + (pw * 100).toFixed(1) + "% 검출 (≥" + (want * 100) + "%)");
    else bad("검정력 부족: n=" + N + " 기대값 " + MU + " 에서 " + (pw * 100).toFixed(1) + "% 만 검출 — 진짜 손실전략을 놓친다");
  }
}

// ══ ④ 확장 지표 — 답을 아는 자료 ═══════════════════════════════════════════
{
  // 백분위
  const s = [1, 2, 3, 4, 5];
  if (near(_pctile(s, 0), 1) && near(_pctile(s, 1), 5) && near(_pctile(s, 0.5), 3)) ok("_pctile 경계·중앙값");
  else bad("_pctile: " + [_pctile(s, 0), _pctile(s, 0.5), _pctile(s, 1)].join(","));
  if (near(_pctile(s, 0.25), 2)) ok("_pctile 선형보간 (0.25 → 2)");
  else bad("_pctile 보간이 " + _pctile(s, 0.25));

  // 합성 원장으로 portfolioStatistics 를 실제로 돌린다.
  //   설계: 수익 +2% 6건, 손실 −1% 4건 → 승률 0.6, 평균 +0.8, Omega = 12/4 = 3
  const R = [2, 2, 2, 2, 2, 2, -1, -1, -1, -1];
  const T0 = Date.UTC(2026, 0, 1);
  // 질의는 ts DESC 로 돌려주므로, 우리가 넘겨줄 rows 도 ★역순★ 이어야 실제와 같다.
  const rowsDesc = R.map((p, i) => ({ pnl: p * 100, pnl_pct: p, ts: T0 + i * 5 * 86400000 }))
                    .slice().reverse();
  const db = {
    prepare() {
      const st = { bind() { return st; }, async all() { return { results: rowsDesc }; },
                   async first() { return null; }, async run() { return {}; } };
      return st;
    }
  };
  const ps = await portfolioStatistics(db, { limit: 400 });
  if (!ps.ready) { bad("portfolioStatistics 가 ready=false: " + JSON.stringify(ps)); }
  else {
    if (near(ps.winRate, 0.6, 1e-4)) ok("승률 0.6"); else bad("승률 " + ps.winRate);
    if (near(ps.expectancy, 0.8, 1e-3)) ok("기대값 +0.8%/건"); else bad("기대값 " + ps.expectancy);
    if (near(ps.omega, 3, 1e-3)) ok("Omega(0) = 이익합/손실합 = 12/4 = 3"); else bad("Omega " + ps.omega);
    if (near(ps.payoff, 2, 1e-3)) ok("손익비 2.0"); else bad("손익비 " + ps.payoff);
    // Kelly = 0.6 − 0.4/2 = 0.4
    if (near(ps.kelly, 0.4, 1e-3)) ok("Kelly 0.4"); else bad("Kelly " + ps.kelly);
    // Sortino = 평균 / √(Σ음수² / n) = 0.8 / √(4/10) = 0.8/0.63246 = 1.2649
    if (near(ps.sortino, 1.265, 2e-3)) ok("Sortino 1.265 (하방편차만)"); else bad("Sortino " + ps.sortino);
    // SQN = √10 × 0.8 / sd,  sd = 표본표준편차
    const e = _edgeStats(R);
    if (near(ps.sqn, e.sqn, 1e-3)) ok("SQN " + ps.sqn + " == _edgeStats 와 동일한 자");
    else bad("SQN 불일치: " + ps.sqn + " vs " + e.sqn);
    if (ps.edgeDf === 9) ok("df 9"); else bad("df " + ps.edgeDf);
    // ★순서 의존★ — 질의는 ts DESC 다. 시간순으로 뒤집지 않으면 거래를 거꾸로 재생하는 셈이라
    //   자산곡선(Ulcer)이 달라진다. 여기 자료는 이익 6건 뒤 손실 4건 순서이므로:
    //     시간순  → 고점 뒤 4연속 손실, 낙폭 0,0,0,0,0,0,−1,−1.99,−2.97,−3.94 → Ulcer 1.712
    //     역순    → 손실이 먼저 나고 이후 회복,               → Ulcer 1.827
    //   (최대낙폭은 이 자료에서 우연히 양쪽 −3.94% 로 같다 — 그래서 판별에 쓰지 않는다)
    // [V33.125] ★단순합 누적★ 으로 바꿨다. 복리로 쌓으면 매 거래에 계좌 전액을 넣는다는 뜻이 되고,
    //   실측에서 누적 11,642% · 최대낙폭 −43% 라는 자릿수 틀린 숫자가 나왔다(거래당 리스크는 0.5~3%).
    //   자료: 이익 +2 ×6, 손실 −1 ×4 (시간순) → 누적 12 에서 고점, 이후 4연속 손실로 −4%p 낙폭.
    if (near(ps.tradeSeqRet, 8, 1e-6)) ok("거래수열 누적 " + ps.tradeSeqRet + "%p = 단순합(12−4)");
    else bad("누적이 " + ps.tradeSeqRet + " — 단순합 8 이어야 한다(복리로 되돌아갔다)");
    if (near(ps.tradeSeqMaxDD, -4, 1e-6)) ok("거래수열 최대낙폭 " + ps.tradeSeqMaxDD + "%p (고점 12 → 8)");
    else bad("최대낙폭이 " + ps.tradeSeqMaxDD + " — −4 이어야 한다");
    // 순서 의존 — 손실이 앞에 오면 낙폭 모양이 달라진다(질의는 DESC 라 뒤집어야 한다).
    const _uExp = Math.sqrt((0*6 + 1 + 4 + 9 + 16) / 10);
    if (near(ps.tradeSeqUlcer, _uExp, 2e-3)) ok("거래수열 Ulcer " + ps.tradeSeqUlcer + " — 시간순으로 재생된다");
    else bad("Ulcer 가 " + ps.tradeSeqUlcer + " (시간순 기대 " + _uExp.toFixed(3) + ") — DESC 를 안 뒤집었다");
    // ★계좌 지표로 오인되지 않게 이름에 tradeSeq 가 박혀 있어야 한다★
    if (ps.ulcer === undefined && ps.maxDD === undefined && ps.totalRet === undefined)
      ok("옛 이름(ulcer/maxDD/totalRet) 제거 — 계좌 낙폭으로 오인될 수 없다");
    else bad("옛 이름이 남아 있다 — 계좌 지표처럼 읽힌다");
    if (ps.spanDays === 45) ok("기간 45일"); else bad("기간 " + ps.spanDays);
    // 45일 < 60일이므로 UPI 는 연환산하지 않는다(짧은 기간의 연환산은 거짓말이다)
    if (ps.tradeSeqUpi === null) ok("기간 60일 미만 → UPI 생략(짧은 기간 연환산 금지)");
    else bad("45일인데 UPI 를 냈다: " + ps.tradeSeqUpi);
  }
}

// ══ ⑤ 회귀 차단 — 맨 문턱 차단이 되살아나지 않는가 ═════════════════════════
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const need = [
    [/_ms\.avgPnl < 0 && _msSig/, "시장×전략 라이브 차단이 유의성을 확인한다"],
    [/if \(!\(_num\(s\.pNeg, 1\) <= _sigAlpha\)\) continue;/, "신호 자동비활성이 유의성을 확인한다"],
    [/wr <= sadCfg\.winRateOff && _sig/, "전략 자동비활성이 유의성을 확인한다"],
    [/byEntry\[e\]\.pnl < 0 && st\.pNeg <= _alpha/, "mlSelfReview 자동차단이 유의성을 확인한다"]
  ];
  for (const [re, what] of need) {
    if (re.test(src)) ok(what);
    else bad(what + " — 유의성 조건이 사라졌다(맨 문턱으로 회귀)");
  }
  // 본페로니 보정이 네 경로 모두에 있는가
  const nAlpha = (src.match(/0\.10 \/ (?:Math\.max\(1, )?_?\w+/g) || []).length;
  if (nAlpha >= 4) ok("본페로니 α 분모가 " + nAlpha + "곳 — 네 경로 모두 동시검정 수로 나눈다");
  else bad("본페로니 보정이 " + nAlpha + "곳뿐");
}

// ══ ⑥ 신호별 켈리 — "음수 켈리 = 매수 완전 금지" 도 유의성으로 판정하는가 ══════
//   여기서 반환값 0 은 ★그 신호로는 아예 사지 않는다★ 는 뜻이다. 가장 센 조치인데
//   종전엔 점추정 켈리의 ★부호★ 하나로 결정됐다. 부호는 표본이 아무리 늘어도
//   진짜 엣지가 0 이면 50% 확률로 음수다 — 축소로도 못 고치는 종류의 오류다.
{
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
  const sw = cfg.signalTypeWeights;
  const kMin = sw.kellyWeightMin;

  // 진짜 엣지 0 인 신호를 만들어 '완전 금지'가 몇 번 나오는지 센다.
  function synth(N, mu, sd) {
    let nW = 0, nL = 0, sW = 0, sL = 0, sumSq = 0, sum = 0;
    for (let i = 0; i < N; i++) {
      const x = mu + gauss() * sd;
      if (x > 0) { nW++; sW += x; } else { nL++; sL += -x; }
      sum += x; sumSq += x * x;
    }
    return { trades: N, wins: nW, sumPnlPct: sum, sumWin: sW, sumLoss: sL, nWin: nW, nLoss: nL,
             sumSq: sumSq, nSq: N, sumSqPnl: sum };
  }
  const TR = 4000, SD = 4;
  for (const N of [20, 40]) {
    let zero = 0, zeroNoSq = 0;
    for (let it = 0; it < TR; it++) {
      const st = synth(N, 0, SD);
      if (st.nWin === 0 || st.nLoss === 0) continue;
      if (computeSignalWeight(st, cfg) === 0) zero++;
      // 구 상태(제곱합 없음) — 종전 동작이 유지되는지도 함께 본다
      const stOld = Object.assign({}, st); delete stOld.sumSq; delete stOld.nSq; delete stOld.sumSqPnl;
      if (computeSignalWeight(stOld, cfg) === 0) zeroNoSq++;
    }
    const pct = zero / TR * 100, pctOld = zeroNoSq / TR * 100;
    const alpha = 0.10 / SIGNAL_TYPES.length * 100;
    if (pctOld > 20) ok("n=" + N + " 구 상태(제곱합 없음): 엣지 0 인 신호를 " + pctOld.toFixed(1) + "% 완전금지 — 종전 동작 유지");
    else bad("n=" + N + " 구 상태 오차단률이 " + pctOld.toFixed(1) + "% — 종전 동작이 아니다(하위호환 깨짐)");
    if (pct <= Math.max(1.0, alpha * 2))
      ok("n=" + N + " 유의성 적용 후: " + pct.toFixed(2) + "% (α=" + alpha.toFixed(2) + "%, 신호 " + SIGNAL_TYPES.length + "종 본페로니)");
    else bad("n=" + N + " 유의성 적용 후에도 " + pct.toFixed(2) + "% 가 완전금지된다 (α=" + alpha.toFixed(2) + "%)");
  }
  // 진짜 나쁜 신호는 여전히 완전금지되는가 — 검정력을 잃으면 고친 게 아니다.
  {
    let zero = 0; const TR2 = 2000, N = 60, MU = -2.5;
    for (let it = 0; it < TR2; it++) {
      const st = synth(N, MU, SD);
      if (st.nWin === 0 || st.nLoss === 0) continue;
      if (computeSignalWeight(st, cfg) === 0) zero++;
    }
    const pw = zero / TR2;
    if (pw >= 0.85) ok("진짜 손실신호(n=60, 기대값 " + MU + "%/건) → " + (pw * 100).toFixed(1) + "% 완전금지 (검정력 유지)");
    else bad("진짜 손실신호를 " + (pw * 100).toFixed(1) + "% 만 막는다 — 유의성을 붙이며 검정력을 잃었다");
  }
  // 표본 부족(제곱합은 있으나 minN 미만)이면 죽이지 않고 최소가중
  {
    const st = synth(12, -3, SD);
    st.nSq = 12;
    const w = computeSignalWeight(st, cfg);
    if (w === 0) bad("nSq=12 · 기대값 −3%/건(t≈−2.6, df11, p≈0.012 > α) 인데 완전금지했다 — 근거가 부족한데 죽였다");
    else ok("nSq 12 · 근거 부족(p≈0.012 > α=0.0091) → 완전금지 대신 가중 " + w.toFixed(2));
  }
  // 좋은 신호는 가중이 커지는가(회귀 확인)
  {
    const st = synth(60, 1.5, SD);
    const w = computeSignalWeight(st, cfg);
    if (w > 1) ok("좋은 신호(기대값 +1.5%/건) → 가중 " + w.toFixed(2) + " > 1");
    else bad("좋은 신호인데 가중이 " + w.toFixed(2));
  }
  if (kMin > 0) ok("최소가중 " + kMin + " — '모르겠다' 는 0 이 아니다");
}

// ══ ⑦ MIND 자기불신 가드 — 문턱이 표본오차를 반영하는가 ═══════════════════════
//   distrust 가 켜지면 ★ML 개입이 통째로 중단★ 된다(규칙엔진 폴백). 가장 센 스위치인데
//   종전엔 관측창이 25건이든 60건이든 "8%p 하락" 하나로 판정했다. 정확도 55% 모델의
//   25건 표본오차는 ±9.9%p 라, 성능이 전혀 안 변해도 18.3% 확률로 불신이 걸렸다.
{
  function fakeGuardDB(init) {
    const m = new Map(Object.entries(init || {}).map(([k, v]) => [k, JSON.stringify(v)]));
    return {
      prepare(sql) {
        const st = { _a: [], bind(...a) { st._a = a; return st; },
          async first() {
            if (/SELECT v FROM state WHERE k = \?/.test(sql)) { const v = m.get(st._a[0]); return v === undefined ? null : { v }; }
            return null;
          },
          async all() { return { results: [] }; },
          async run() { if (/INSERT INTO state/.test(sql)) m.set(st._a[0], st._a[1]); return {}; } };
        return st;
      },
      async batch(a) { for (const s of a) await s.run(); return []; },
      get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); }
    };
  }
  // 관측창을 원하는 승패열로 채운 뒤 가드를 한 번 더 돌려 판정을 읽는다.
  //   [V33.127] liveBase(라이브 기준선)를 인자로 받는다 — 검증정확도(baseAcc)는 이제 판정에 안 쓴다.
  async function tripAt(nLive, hits, baseAcc, liveBase, liveBaseN) {
    const live = [];
    for (let i = 0; i < nLive - 1; i++) live.push({ p: 0.6, w: i < hits ? 1 : 0 });
    const st = { live: live, distrust: false, baseAcc: baseAcc };
    // nTotal — 기준선 이후 새 관측이 충분히 쌓였다는 표시. 없으면 가드가 '수집중' 으로 대기한다.
    if (liveBase != null) { st.liveBase = liveBase; st.liveBaseN = liveBaseN || 25; st.nTotal = (liveBaseN || 25) + 999; }
    const db = fakeGuardDB({ mind_guard: st });
    // 마지막 한 건을 넣어 판정을 트리거한다(맞춘 건인지 여부는 hits 에 반영해 둔다)
    await mlGuardObserve(db, 0.6, hits >= nLive);
    return db.get("mind_guard");
  }
  // (a) ★기준선이 없으면 발동하지 않고, 첫 창으로 기준선을 얼린다★
  //   비교 대상이 없는데 AI 를 끄는 건 측정이 아니라 사고다.
  const g0 = await tripAt(25, 8, 0.55, null);
  if (g0 && !g0.distrust) ok("라이브 기준선 없음 → 불신 발동 안 함(성적이 나빠도 비교 대상이 없다)");
  else bad("기준선도 없이 불신이 걸렸다");
  if (g0 && g0.guardNote && /기준선 이후 관측/.test(g0.guardNote))
    ok("대기 사유를 남긴다: " + g0.guardNote);
  else bad("기준선 직후인데 대기 사유가 없다 — 얼리기가 판정을 무력화하고 있다");
  // ★기준선과 겹치는 동안은 발동하지 않는다★ — 이 조건이 없으면 위 얼리기가 가드를 죽인다.
  const gOverlap = await tripAt(60, 18, 0.55, 0.56, 25);   // nTotal 미지정 → 겹침 구간
  gOverlap.__note = 1;
  if (g0 && near(g0.liveBase, 0.32, 0.01) && g0.liveBaseN === 25)
    ok("첫 " + g0.liveBaseN + "건으로 라이브 기준선 " + g0.liveBase + " 고정");
  else bad("기준선이 안 얼려졌다: " + JSON.stringify(g0 && { b: g0.liveBase, n: g0.liveBaseN }));

  // (b) ★검증정확도(baseAcc)는 판정에 쓰이지 않는다★ — 이번 수정의 핵심.
  //   실측 사고: baseAcc 0.7072(수확표본) vs 라이브 승률 0.562 → 격차 14.5%p 로 무조건 발동했다.
  //   baseAcc 를 극단으로 흔들어도 판정·문턱이 안 변해야 고쳐진 것이다.
  const bLow = await tripAt(60, 34, 0.50, 0.56, 25);
  const bHigh = await tripAt(60, 34, 0.99, 0.56, 25);
  if (bLow && bHigh && bLow.distrust === bHigh.distrust && near(bLow.guardNeed, bHigh.guardNeed, 1e-9))
    ok("검증정확도 0.50↔0.99 로 바꿔도 판정·문턱 불변 — 더 이상 비교에 안 쓴다");
  else bad("검증정확도가 아직 판정에 영향을 준다: " + JSON.stringify([bLow && bLow.distrust, bHigh && bHigh.distrust]));

  // (c) 기준선 대비 소폭 하락은 참고, 큰 하락은 잡는다
  const mild = await tripAt(60, 32, 0.7072, 0.56, 25);
  if (mild && !mild.distrust) ok("기준선 56% → " + (mild.liveAcc * 100).toFixed(0) + "% (소폭) → 불신 없음");
  else bad("소폭 하락에 불신이 걸렸다: " + JSON.stringify(mild && mild.liveAcc));
  const hard = await tripAt(60, 18, 0.7072, 0.56, 25);
  if (hard && hard.distrust) ok("기준선 56% → " + (hard.liveAcc * 100).toFixed(0) + "% (큰 하락) → 불신 발동(검정력 유지)");
  else bad("명백한 열화를 못 잡는다: " + JSON.stringify(hard && { a: hard.liveAcc, need: hard.guardNeed }));

  // (d) 두 비율 검정 — 기준선 표본이 적을수록 문턱이 넓어야 한다
  const wideB = await tripAt(60, 32, 0.7072, 0.56, 25);
  const tightB = await tripAt(60, 32, 0.7072, 0.56, 400);
  if (wideB && tightB && wideB.guardNeed > tightB.guardNeed)
    ok("기준선 표본 25건 문턱 " + wideB.guardNeed + " > 400건 " + tightB.guardNeed + " (양쪽 오차 반영)");
  else bad("기준선 표본수가 문턱에 반영되지 않는다");

  // (e) ★실측 사고 재현★ — 종전 규칙이면 발동, 새 규칙이면 발동 안 함
  const real = await tripAt(60, 34, 0.7072, 0.56, 60);
  const oldWouldFire = (0.7072 - 34 / 60) > 0.08;
  if (oldWouldFire && real && !real.distrust)
    ok("실측 사고 재현: 종전이면 발동(격차 " + ((0.7072 - 34 / 60) * 100).toFixed(1) + "%p > 8%p), 새 규칙은 발동 안 함");
  else bad("실측 조건에서 여전히 발동한다: " + JSON.stringify(real && { a: real.liveAcc, need: real.guardNeed, d: real.distrust }));

  // (f) 몬테카를로 — 성능 불변인데 발동하는 비율
  {
    const T = 20000, p = 0.56, nB = 25, nW = 60;
    let fire = 0;
    for (let it = 0; it < T; it++) {
      let hb = 0; for (let i = 0; i < nB; i++) if (rnd() < p) hb++;
      let hw = 0; for (let i = 0; i < nW; i++) if (rnd() < p) hw++;
      const pB = hb / nB, pW = hw / nW;
      const pPool = (pB * nB + pW * nW) / (nB + nW);
      const se = Math.sqrt(pPool * (1 - pPool) * (1 / nB + 1 / nW));
      const need = Math.max(MIND.guardMargin, MIND.guardZ * se);
      if ((pB - pW) > need) fire++;
    }
    const pct = fire / T * 100;
    if (pct <= 12) ok("성능 불변 시 오발 " + pct.toFixed(1) + "% (두 비율 검정)");
    else bad("오발률이 " + pct.toFixed(1) + "% — 너무 자주 AI 를 끈다");
  }
}

console.log(fails ? "\n원장 유의성 계약 위반 " + fails + "건" : "\n  ok   원장 유의성 계약 통과");
process.exit(fails ? 1 : 0);
