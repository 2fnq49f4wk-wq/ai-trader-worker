/* ═══════════════════════════════════════════════════════════════════════════
   [V33.268] 최적정지(Longstaff-Schwartz 최소제곱 몬테카를로).

   ■ 왜 이게 이 시스템에 붙는가
     "지금 팔까, 더 들고 갈까" 는 값 매기기가 아니라 ★언제 멈출까★ 의 문제다.
     미국식 옵션의 조기행사와 수학적으로 같은 문제다.

   ■ 이 검사가 묻는 것 — 성능이 아니라 ★맞는 수식인가★
     몬테카를로는 언제나 그럴듯한 숫자를 낸다. 틀려도 낸다. 그래서 답을 아는 문제로
     검산한다:
       ① Longstaff & Schwartz(2001) Table 1 의 공표값 6개
       ② Merton 정리: 배당 없는 주식의 미국식 콜 = 유럽식 콜(블랙숄즈)
       ③ 무차익 한계: 미국식 값 ≥ 내재가치, 유럽식 ≥ … 등 부호 조건
     ①과 ②는 ★외부 기준★ 이다 — 내가 만든 값이 아니라서 구현이 틀리면 못 맞춘다.

   ■ 그리고 ★같은 엔진★ 인지 확인한다
     교과서 문제와 실제 청산 판단이 다른 코드를 쓰면 ①②의 검산은 아무것도
     보증하지 않는다. 둘 다 _lsmCore 를 통과하는지 본다.

   ■ 마지막으로 ★규율★
     새 판단기는 근거가 쌓이기 전에는 실거래를 안 흔든다(LSM.advisoryOnly).
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

console.log("① Longstaff & Schwartz(2001) Table 1 공표값과 대조 — 외부 기준");
{
  /* 논문 Table 1(유한차분 기준값). r=0.06, K=40, 연 50회 행사.
     몬테카를로라 오차가 있다 — 허용치는 표준오차 규모(0.05)로 둔다. */
  const REF = [
    [36, 0.20, 1, 4.472], [36, 0.20, 2, 4.821], [36, 0.40, 1, 7.091],
    [38, 0.20, 1, 3.244], [40, 0.20, 1, 2.313], [44, 0.20, 1, 1.110]
  ];
  let worst = 0, bad = [];
  for (const [S0, sig, T, ref] of REF) {
    const v = M.lsmAmericanPut(S0, 40, 0.06, sig, T, Math.round(50 * T), 20000, 777, false);
    if (v == null) { bad.push(`S=${S0} σ=${sig} T=${T} → null`); continue; }
    const d = Math.abs(v - ref);
    if (d > worst) worst = d;
    if (d > 0.05) bad.push(`S=${S0} σ=${sig} T=${T} → ${v.toFixed(3)} (논문 ${ref}, 차이 ${d.toFixed(3)})`);
  }
  chk(bad.length === 0,
    `공표값 ${REF.length}건을 전부 재현한다 (최대 차이 ${worst.toFixed(3)} ≤ 0.05)`,
    "★논문 공표값을 못 맞춘다★ — " + bad.join(" / "));
}

console.log("\n② Merton 정리 — 배당 없는 주식의 미국식 콜은 유럽식 콜과 같다");
{
  /* 조기행사가 절대 유리하지 않은 경우다. 엔진이 잘못 조기행사하면 BS 아래로 내려간다.
     즉 이 검사는 ★회귀가 계속가치를 과소평가하지 않는가★ 를 직접 잡는다. */
  const erf = (x) => { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
    return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
  const N = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  const bsCall = (S0, K, r, sig, T) => {
    const d1 = (Math.log(S0 / K) + (r + sig * sig / 2) * T) / (sig * Math.sqrt(T)), d2 = d1 - sig * Math.sqrt(T);
    return S0 * N(d1) - K * Math.exp(-r * T) * N(d2);
  };
  let bad = [];
  for (const [S0, K, sig, T] of [[100, 100, 0.25, 1], [90, 100, 0.30, 1], [110, 100, 0.20, 0.5]]) {
    const am = M.lsmAmericanPut(S0, K, 0.05, sig, T, 50, 20000, 4242, true);
    const eu = bsCall(S0, K, 0.05, sig, T);
    if (am == null || Math.abs(am - eu) > 0.06) bad.push(`S=${S0} K=${K} σ=${sig} → 미국식 ${am == null ? "null" : am.toFixed(3)} vs BS ${eu.toFixed(3)}`);
  }
  chk(bad.length === 0, "미국식 콜 3건이 블랙숄즈와 일치한다(조기행사를 잘못 하지 않는다)",
    "★미국식 콜이 유럽식과 다르다 — 조기행사 판정이 틀렸다★: " + bad.join(" / "));
}

console.log("\n③ 무차익 한계 — 어떤 근사도 이 아래로는 못 간다");
{
  const deep = M.lsmAmericanPut(30, 40, 0.06, 0.20, 1, 50, 4000, 1, false);
  chk(deep != null && deep >= 10 - 1e-9, `깊은 내가격 풋은 내재가치 이상이다 (${deep == null ? "null" : deep.toFixed(4)} ≥ 10)`,
    "내재가치보다 싸게 값을 매긴다 — 공짜 차익이 생긴다");
  const lo = M.lsmAmericanPut(36, 40, 0.06, 0.20, 1, 50, 8000, 9, false);
  const hi = M.lsmAmericanPut(36, 40, 0.06, 0.40, 1, 50, 8000, 9, false);
  chk(lo != null && hi != null && hi > lo, `변동성이 커지면 풋도 비싸진다 (σ0.2 ${lo.toFixed(2)} < σ0.4 ${hi.toFixed(2)})`,
    "변동성에 대해 단조롭지 않다");
  const k40 = M.lsmAmericanPut(38, 40, 0.06, 0.20, 1, 50, 8000, 3, false);
  const k44 = M.lsmAmericanPut(38, 44, 0.06, 0.20, 1, 50, 8000, 3, false);
  chk(k44 > k40, `행사가가 높을수록 풋이 비싸다 (K40 ${k40.toFixed(2)} < K44 ${k44.toFixed(2)})`,
    "행사가에 대해 단조롭지 않다");
  chk(M.lsmAmericanPut(36, 40, 0.06, 0.2, 1, 50, 4, 1, false) === null &&
      M.lsmAmericanPut(-1, 40, 0.06, 0.2, 1, 50, 4000, 1, false) === null,
    "말이 안 되는 입력에는 숫자를 지어내지 않는다(null)", "쓰레기 입력에도 그럴듯한 값을 낸다");
}

console.log("\n④ ★교과서 문제와 실제 청산 판단이 같은 엔진인가★");
{
  /* 이게 아니면 ①②의 검산은 실거래 경로에 대해 아무것도 보증하지 않는다. */
  const put = code.slice(code.indexOf("function lsmAmericanPut"), code.indexOf("function lsmAmericanPut") + 1600);
  const ex = code.slice(code.indexOf("function lsmExitValue"), code.indexOf("function lsmExitValue") + 3200);
  chk(/_lsmCore\(/.test(put) && /_lsmCore\(/.test(ex),
    "둘 다 _lsmCore 를 통과한다 — 검산이 실거래 경로를 덮는다",
    "★청산 판단이 별도 엔진이다 — 논문 대조가 그 경로를 보증하지 않는다★");
  chk(/itmOnly: false/.test(ex),
    "청산은 손실 구간에서도 선택지다(itmOnly 를 끈다)",
    "옵션의 '내가격만 회귀' 규칙을 그대로 옮겼다 — 손실 포지션의 정지 판단이 통째로 빠진다");
  chk(/y\.push\(cf\[i\] \* Math\.pow\(disc, tau\[i\] - t\)\)/.test(code),
    "회귀의 y 는 ★실현된 현금흐름★ 이다(추정치를 다시 회귀하지 않는다)",
    "추정치를 회귀에 넣는다 — 오차가 시점마다 누적되고 값이 부풀어 오른다");
  chk(/v \+= cf\[i\] \* Math\.pow\(disc, tau\[i\]\)/.test(code),
    "최종값은 각 경로가 ★실제로 멈춘 시점★ 에서 할인해 온다", "정지 시점을 무시하고 합산한다 — 만기 할인만 남는다");
  /* 블록 부트스트랩. 여기만 소스로 본다 — 합성 잡음에는 보존할 자기상관이 없어서
     "군집이 보존되는가" 를 돌려서 가를 방법이 없다(잰다면 그건 잡음을 재는 것이다).
     소스로 보는 대신 ★죽은 분기에 숨지 못하게★ 실행 경로 한가운데의 표현을 고른다. */
  chk(/if \(b === 0\) \{ pos = Math\.floor\(rng\(\) \* rets\.length\); b = B; \}/.test(code),
    "경로는 블록 부트스트랩으로 만든다(변동성 군집 보존)", "수익률을 매일 독립 추출한다 — 군집이 사라져 손절이 걸리는 상황을 과소평가한다");
}

console.log("\n⑤ 청산 자문이 실제로 답을 내는가 — 그리고 방향이 맞는가");
{
  const rets = [];
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < 250; i++) rets.push((rnd() - 0.5) * 0.04);
  const base = { entry: 100, price: 100, rets, horizonDays: 10, paths: 400, seed: 11 };
  const r = M.lsmExitValue(base);
  chk(r && isFinite(r.holdValue) && isFinite(r.exitNow),
    `자문이 값을 낸다 (지금청산 ${r ? r.exitNow : "?"}% / 계속가치 ${r ? r.holdValue : "?"}% / edge ${r ? r.edgeBps : "?"}bp)`,
    "자문이 값을 못 낸다");
  if (r) {
    /* ★손절이 바로 코앞이면 계속가치는 떨어져야 한다.★ 아래로 갈 길이 막혀 있는 게 아니라
       ★막혀서 그 값에 체결되는★ 것이므로, 손절이 가까울수록 보유가 불리해진다. */
    /* ── 손절 배리어. ★검사할 수 있는 것만 검사한다.★
       "강제청산은 선택지를 뺏는 제약이므로 계속가치를 올릴 수 없다" 는 ★참값★ 에 대한
       정리다. 그런데 LSM 은 근사이고, 근사 정책은 제약이 걸린 쪽이 더 나을 수 있다
       (회귀가 잡음을 맞추느라 못 찾던 '손실을 끊는다' 는 규칙을 배리어가 대신 강제한다).
       실제로 이 구현도 그렇게 나온다. 그러니 그 단조성을 단언하면 ★이 방법이 보장하지
       않는 것★ 을 검사하는 게 된다 — 통과시키려면 코드를 왜곡해야 한다. 그래서 대신
       ★확실히 참인 것★ 을 못 박는다: 배리어가 실제로 작동하는가, 그리고 체결이
       손절가보다 유리한 적이 없는가.
       (초기 구현은 갭하락 경로도 손절가에 팔아 줘서, 손절을 조일수록 계속가치가
        올라갔다. 아래 두 번째 검사가 정확히 그것을 잡는 자다.) */
    const bigP = Object.assign({}, base, { paths: 2000, maxMs: 9000 });
    const none = M.lsmExitValue(Object.assign({}, bigP, { stopPrice: 0 }));
    const near = M.lsmExitValue(Object.assign({}, bigP, { stopPrice: 99.5 }));
    const mid = M.lsmExitValue(Object.assign({}, bigP, { stopPrice: 95 }));
    chk(none && none.stopHits === 0 && near && near.stopHits > 0 && mid && mid.stopHits > 0 &&
        near.stopHits > mid.stopHits,
      `배리어가 살아 있다 (손절 없음 ${none.stopHits}건 · 95 ${mid.stopHits}건 · 99.5 ${near.stopHits}건)`,
      "손절 위치가 경로에 반영되지 않는다 — 배리어가 죽어 있다");
    chk(near.stopFillBest <= near.stopPnl + 1e-9 && mid.stopFillBest <= mid.stopPnl + 1e-9,
      `★손절 체결이 손절가보다 유리한 적이 없다★ (99.5: 가장 유리했던 체결 ${near.stopFillBest}% ≤ 손절가 ${near.stopPnl}%)`,
      `★갭을 뚫고 내려간 경로를 손절가에 팔아 준다 — 실제보다 유리한 체결 가정이다★ (${near.stopFillBest}% > ${near.stopPnl}%)`);
    chk(near.stopFillAvg < near.stopPnl,
      `평균 체결은 손절가보다 나쁘다(갭 손실이 계산에 들어간다: 평균 ${near.stopFillAvg}% < ${near.stopPnl}%)`,
      "평균 체결이 손절가와 같다 — 갭 손실을 0 으로 가정하고 있다");
    chk(near.holdValue !== none.holdValue,
      "손절 위치가 계속가치를 실제로 움직인다", "손절을 바꿔도 계속가치가 그대로다");
    /* ★배리어를 '통계로만' 반영하고 정작 계산에는 안 넘기는 실수를 잡는다.★
       손절가를 현재가 ★위★ 에 두면 거의 모든 경로가 1스텝에서 강제청산된다.
       배리어가 계산에 들어갔으면 평균 정지시점은 1 근처여야 한다. 안 넘겼다면
       최적정지가 지평 전체를 돌아다녀 훨씬 뒤로 밀린다(실측 1.0 → 3.9). */
    const forced = M.lsmExitValue(Object.assign({}, bigP, { stopPrice: 101, horizonDays: 30 }));
    chk(forced && forced.stopHits > forced.paths * 0.9 && forced.meanTauDays < 2.0,
      `강제청산이 계산에 실제로 들어간다 (${forced.stopHits}/${forced.paths} 경로가 1스텝 청산 · 평균 정지 ${forced.meanTauDays}일)`,
      `★손절을 통계로만 세고 계산에는 안 넘긴다 — 평균 정지 ${forced && forced.meanTauDays}일 (1 근처여야 한다)★`);
    /* ★옵션의 '내가격만 회귀' 규칙이 청산에 새어 들어오면 손실 포지션의 정지 판단이
       통째로 사라진다.★ 그 경우 손실 포지션은 아무 데서도 안 멈추고 지평 끝까지 간다
       (실측 2.8일 → 19.8일/지평 20일). 소스에 itmOnly:false 라고 적는 것만으로는
       _lsmCore 가 그 값을 무시하는 변이를 못 잡는다 — 그래서 돌려서 본다. */
    const loser = M.lsmExitValue(Object.assign({}, bigP, { price: 92, horizonDays: 20 }));
    chk(loser && loser.meanTauDays < 12,
      `손실 포지션도 중간에 멈출 수 있다 (평균 정지 ${loser.meanTauDays}일 < 지평 20일)`,
      `★손실 포지션이 지평 끝까지 안 멈춘다 (${loser && loser.meanTauDays}일) — 청산 판단이 통째로 빠졌다★`);
    const up = M.lsmExitValue(Object.assign({}, base, { pUp: 0.85 }));
    const dn = M.lsmExitValue(Object.assign({}, base, { pUp: 0.15 }));
    chk(up && dn && up.holdValue > dn.holdValue,
      `확률 기울임의 방향이 맞다 (pUp .85 → ${up.holdValue}% > .15 → ${dn.holdValue}%)`,
      "확률을 넣어도 계속가치가 안 움직이거나 방향이 반대다");
    chk(M.lsmExitValue(Object.assign({}, base, { maxMs: -1 })) === null,
      "시간 예산을 넘기면 반쪽 계산을 답이라고 내놓지 않는다", "예산 초과에도 값을 낸다");
    chk(M.lsmExitValue(Object.assign({}, base, { rets: rets.slice(0, 20) })) === null,
      "이력이 모자라면 답하지 않는다(분포를 못 만든다)", "20일치로도 분포를 지어낸다");
  }
  chk(/pUp: null,/.test(code) && /모멘텀을 몰래 다시 넣는 것/.test(S),
    "라이브 호출은 기울임 없이(drift 0) 부른다 — 다른 예측기의 성적이 섞이지 않는다",
    "라이브에서 출처가 불분명한 확률로 표류를 준다");
}

console.log("\n⑥ ★근거가 쌓이기 전에는 실거래를 안 흔든다★ — 기록·채점·승격 규율");
{
  chk(M.LSM.advisoryOnly === true, "지금은 자문 전용(결정 미반영)", "측정 전에 이미 결정을 바꾸고 있다");
  /* ★주석을 기준점으로 삼지 않는다.★ code 는 주석줄을 걷어낸 사본이라 /* 로 시작하는
     표식은 여기 없다 — indexOf 가 -1 이 되고 slice(-1,...) 이 엉뚱한 창을 잡는다.
     기준점은 반드시 ★살아 있는 코드★ 여야 한다. */
  const _sa = code.indexOf("lsmExitValue({ entry: held.avg");
  if (_sa < 0) { console.log("  FAIL 라이브 매도 경로에 자문 호출이 없다"); fails++; }
  /* ★창을 자문 블록 안으로만 좁힌다.★ 넉넉히 잡으면 위아래의 다른 청산 코드(MODEL_EXIT,
     sellDecision.sell 처리)가 창에 들어와, "자문이 매도를 건드리지 않는다" 가 항상 실패한다. */
  const _se = _sa < 0 ? 0 : code.indexOf("if (sellDecision.minHoldLock)", _sa);
  const sell = _sa < 0 ? "" : code.slice(_sa, _se > _sa ? _se : _sa + 1800);
  chk(!/sellDecision\.sell\s*=/.test(sell) && !/executeSell\(/.test(sell),
    "자문 블록이 매도 결정을 건드리지 않는다", "★자문이 매도를 직접 바꾼다 — advisoryOnly 가 거짓말이다★");
  chk(/if \(!!sellDecision\.sell !== !_lv\.hold\)/.test(sell),
    "규칙과 ★다르게 말한 순간만★ 기록한다(같은 말은 성적에 정보가 없다)", "전부 기록한다 — D1 만 채운다");
  const sc = code.slice(code.indexOf("async function lsmScoreNightly"), code.indexOf("async function lsmScoreNightly") + 3000);
  chk(/ageD < _num\(r\.h, 10\)/.test(sc), "지평이 지난 행만 채점한다(아직 안 끝난 걸 채점하지 않는다)", "지평 전에 채점한다");
  chk(/st\.z = eff >= 1/.test(sc) && /ICGATE\.provisional/.test(sc),
    "승격 문턱은 다른 게이트와 ★같은 자★ 다(부호검정 z ≥ 1.65)", "승격 기준이 없거나 이 저장소의 다른 문턱과 다르다");
  chk(/_num\(st\.avgGain, 0\) > 0/.test(sc),
    "평균차가 양수일 때만 승격을 논한다(z 만으로는 부족하다)", "방향을 안 보고 유의성만으로 승격한다");
  chk(/lsmscore/.test(code) && /lsmScoreNightly\(env\.DB\)/.test(code),
    "야간 단계에 등록돼 있다(정의만 해 두면 영원히 안 돈다)", "정의만 있고 크론이 안 돌린다");
  chk(/R\.lsm = \{/.test(code),
    "성적이 화면에 나온다 — '쌓고 있다' 를 확인할 수 있다", "★기록만 하고 아무 데도 안 보인다 — 확인할 수 없는 주장이다★");
}

console.log(fails === 0 ? "\n✓ 최적정지(LSM) 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
