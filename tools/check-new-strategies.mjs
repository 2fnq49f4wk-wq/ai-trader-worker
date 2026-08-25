/* ═══════════════════════════════════════════════════════════════════════════
   [V33.250] 신규 전략 5종 — 실제로 발화하는가, 그리고 ★이름값을 하는가★

   사용자 요청: index rebalance flow · vol-targeted trend · cointegrated pair OU spread ·
   volume-spike mean reversion · cross-sectional statistical arbitrage 추가.

   ★먼저 정직하게 못박아 둘 것 — 이 엔진은 공매도를 하지 않는다.★
   하방 수단은 인버스 ETF 매수뿐이다(SH·SQQQ·SPXU·252670.KS …).
   그래서 페어(PR_OU)와 횡단면(XS_ARB)은 교과서 형태가 아니라 ★롱 다리만★ 이다.
   시장중립이 아니고 베타가 남는다. 이 검사는 그 사실이 신호 문구에 남아 있는지까지 본다 —
   이름만 페어인 것을 페어라고 부르면 성적을 잘못 읽게 된다.

   지수 리밸런스(XR_FLOW)도 마찬가지다: 편입/제외 ★공시 피드가 없다.★
   공개된 정기변경 달력 + 실시간 시총순위 밴드 진입으로 만든 ★대리지표★ 다.

   여기서 지키는 것:
     · 다섯 전부 합성 데이터에서 실제로 발화하는가(구현했는데 절대 안 켜지면 없는 것과 같다)
     · 조건이 안 맞으면 확실히 침묵하는가(아무 때나 켜지면 전략이 아니다)
     · 수학이 맞는가 — OU 반감기·분산비·OLS β 를 알려진 값으로 확인한다
     · 한계 표기가 신호에 남아 있는가(롱다리만 · 대리지표)
     · VT_TREND 의 sizeMult 가 ★실제 수량에 연결★ 돼 있는가(안 그러면 숫자만 붙은 추세진입이다)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* 합성 일봉 — 추세/변동성/거래량을 원하는 대로 만든다 */
function series(n, fn) {
  const closes = [], highs = [], lows = [], opens = [], volumes = [];
  for (let i = 0; i < n; i++) {
    const c = fn(i);
    closes.push(c); opens.push(c * 0.999);
    highs.push(c * 1.008); lows.push(c * 0.992); volumes.push(1e6);
  }
  return { closes, highs, lows, opens, volumes };
}
const CFG = { atrPeriod: 14, rvStrat: { enabled: true } };

/* ── ① 수학 검증 — 알려진 값으로 ── */
console.log("① 수학 (OLS β · OU 반감기 · 분산비)");
{
  // β=2.0 인 관계를 정확히 복원하는가
  const yb = Array.from({ length: 120 }, (_, i) => Math.sin(i / 9) + i * 0.004);
  const ya = yb.map(v => 3.5 + 2.0 * v);
  const o = M._rvOlsBeta(ya, yb);
  chk(o && Math.abs(o.beta - 2.0) < 1e-9, "OLS β 복원 " + (o ? o.beta.toFixed(6) : "null") + " (참값 2.0)",
    "β 를 복원하지 못한다");

  // AR(1) φ 가 알려진 OU 과정 — s_t = ρ·s_{t-1} + ε, ρ=0.9 → 반감기 = ln2/ln(1/0.9) ≈ 6.58
  let seed = 42, rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  let v = 0; const sp = [];
  for (let i = 0; i < 4000; i++) { v = 0.9 * v + rnd() * 0.2; sp.push(v); }
  const hl = M._rvHalfLife(sp);
  const want = Math.log(2) / Math.log(1 / 0.9);
  chk(hl != null && Math.abs(hl - want) < 1.2,
    "OU 반감기 " + (hl ? hl.toFixed(2) : "null") + "일 (ρ=0.9 이론값 " + want.toFixed(2) + ")",
    "반감기가 이론값과 크게 다르다: " + hl);

  // 랜덤워크는 반감기가 없어야 한다(평균회귀가 아니다)
  let w = 0; const rw = [];
  for (let i = 0; i < 4000; i++) { w += rnd() * 0.2; rw.push(w); }
  const hlRw = M._rvHalfLife(rw);
  const vrRw = M._rvVarRatio(rw, 5);
  chk(hlRw == null || hlRw > 60, "랜덤워크는 반감기를 주지 않는다(" + hlRw + ")", "랜덤워크에 반감기가 나왔다 " + hlRw);
  chk(vrRw != null && vrRw > 0.7, "랜덤워크 분산비 " + vrRw.toFixed(2) + " ≈ 1", "랜덤워크 분산비가 이상하다 " + vrRw);
  const vrOu = M._rvVarRatio(sp, 5);
  chk(vrOu != null && vrOu < 0.85, "평균회귀 분산비 " + vrOu.toFixed(2) + " < 0.85 (문턱 통과)",
    "OU 인데 분산비가 문턱을 못 넘는다 " + vrOu);
  chk(vrOu < vrRw, "분산비가 두 과정을 실제로 구분한다(" + vrOu.toFixed(2) + " vs " + vrRw.toFixed(2) + ")",
    "분산비가 평균회귀와 랜덤워크를 구분하지 못한다");
}

/* ── ② VS_REV 거래량 급증 평균회귀 ── */
console.log("② VS_REV (거래량 급증 평균회귀)");
{
  const d = series(260, i => 100 * (1 + i * 0.0015));      // 완만한 상승추세(MA200 위)
  // 마지막 봉: 대량거래 + 급락 + 저가권 마감
  const n = d.closes.length - 1;
  d.closes[n] = d.closes[n - 1] * 0.93;
  d.highs[n] = d.closes[n - 1] * 1.001; d.lows[n] = d.closes[n] * 0.998;
  d.volumes[n] = 6e6;
  d.closes[n - 1] = d.closes[n - 1];
  const price = d.closes[n];
  const sig = M.evaluateVolSpikeRevertEntry(price, -7.0, d, CFG, null, "us");
  chk(sig && sig.name === "VS_REV", "발화한다 — " + (sig ? sig.detail : "null"), "발화하지 않는다");
  // 거래량이 평범하면 침묵해야 한다
  d.volumes[n] = 1.05e6;
  chk(!M.evaluateVolSpikeRevertEntry(price, -7.0, d, CFG, null, "us"),
    "거래량이 평범하면 침묵한다", "거래량 조건 없이도 발화한다 — 전략이 아니다");
  // 하락이 과하면(칼날) 침묵
  d.volumes[n] = 6e6;
  chk(!M.evaluateVolSpikeRevertEntry(price, -25.0, d, CFG, null, "us"),
    "낙폭 −25% 는 제외한다(떨어지는 칼날)", "추락까지 잡는다");
}

/* ── ③ VT_TREND 변동성 타겟 추세 + 사이즈 연결 ── */
console.log("③ VT_TREND (변동성 타겟) + 수량 연결");
{
  /* 두 계열은 ★변동성만★ 달라야 한다 — 첫 시도에서 '고변동성' 계열이 20일 신고가 조건을
     못 맞춰 아예 발화하지 않았다(코드가 아니라 테스트 구성 문제였다).
     같은 추세·같은 마지막 위치(신고가)로 고정하고 진폭만 바꾼다. */
  const mk = (amp) => {
    let sd = 7;
    const z = Array.from({ length: 280 }, () => { sd = (sd * 1103515245 + 12345) >>> 0; return sd / 4294967296 - 0.5; });
    const d = series(280, i => 100 * (1 + i * 0.002) * (1 + amp * z[i]));
    const n = d.closes.length - 1;
    let mx = 0; for (let i = n - 20; i < n; i++) mx = Math.max(mx, d.closes[i]);
    d.closes[n] = mx * 1.01;                       // 마지막은 항상 20일 신고가
    d.highs[n] = d.closes[n] * 1.004; d.lows[n] = d.closes[n] * 0.996;
    return d;
  };
  /* 진폭을 더 올리면 ADX 가 무너져 ★진입 자체가 거부★ 된다 — 그건 필터가 제 일을 하는 것이라
     비교 대상이 못 된다. 둘 다 발화하면서 변동성만 다른 구간(0.26% vs 1.18%)을 쓴다. */
  const calm = mk(0.004), wild = mk(0.03);
  const sC = M.evaluateVolTargetTrendEntry(calm.closes[calm.closes.length - 1], calm, CFG, null, "us");
  const sW = M.evaluateVolTargetTrendEntry(wild.closes[wild.closes.length - 1], wild, CFG, null, "us");
  chk(sC && sC.name === "VT_TREND", "저변동성에서 발화 — " + (sC ? sC.detail : "null"), "저변동성에서 발화하지 않는다");
  chk(!!sW, "고변동성에서도 발화 — " + (sW ? sW.detail : "null"), "고변동성 계열이 발화하지 않아 비교 불가");
  if (sC && sW) {
    chk(sW.sizeMult < sC.sizeMult,
      "변동성이 크면 더 작게 산다 (조용 ×" + sC.sizeMult + " vs 시끄러움 ×" + sW.sizeMult + ")",
      "변동성이 커도 같은 크기다 — 타겟팅이 작동하지 않는다");
    // ★공식 자체★ 를 확인한다 — 상한에 안 걸린 쪽은 목표변동성/실현변동성 과 같아야 한다
    const rvW = M._rvRealVolPct(wild.closes, M.RVSTRAT.vt.volLookback);
    const want = M.RVSTRAT.vt.targetVolPct / rvW;
    chk(Math.abs(sW.sizeMult - want) < 0.02,
      "배율 = 목표변동성/실현변동성 (" + sW.sizeMult + " ≈ " + want.toFixed(3) + ")",
      "배율이 공식과 다르다 (" + sW.sizeMult + " vs " + want.toFixed(3) + ")");
    chk(sC.sizeMult === M.RVSTRAT.vt.sizeMax,
      "실현변동성이 아주 낮으면 상한 " + M.RVSTRAT.vt.sizeMax + " 에서 멈춘다(레버리지 폭주 방지)",
      "상한이 안 걸린다");
  }
  // ★수량에 실제로 연결됐는가★ — 문구가 아니라 코드 경로
  const seg = S.slice(S.indexOf("const riskDollar = equity"), S.indexOf("const riskDollar = equity") + 1400);
  /* ★본문이 있는 것과 그 본문에 ★도달하는★ 것은 다르다.★
     처음엔 /signal\.sizeMult/ 만 봤는데, 조건을 `if (false)` 로 바꾸는 변이가 그대로 통과했다
     (본문 문자열은 남아 있으니까). 이 세션에서 세 번째로 같은 함정을 밟았다 —
     주석을 코드로 세고, 죽은 코드를 산 코드로 셌다. 조건문 자체를 고정한다. */
  chk(/if \(signal && typeof signal\.sizeMult === "number" && signal\.sizeMult > 0 && signal\.sizeMult !== 1\)/.test(seg),
    "sizeMult 적용 조건이 실제로 signal.sizeMult 를 검사한다(도달 가능)",
    "적용 블록이 죽어 있다(조건이 상수이거나 signal.sizeMult 를 안 본다) — VT_TREND 는 숫자만 붙은 추세진입이 된다");
  chk(/qty = Math\.max\(0, Math\.floor\(qty \* _sgm\)\)/.test(seg),
    "배율이 리스크 수량에 실제로 곱해진다",
    "수량 계산에 배율이 반영되지 않는다");
  chk(/_clamp\(signal\.sizeMult, 0\.2, 2\.0\)/.test(seg),
    "배율에 상하한이 있다(폭주 방지)", "배율이 무제한이다");
}

/* ── ④ PR_OU / XS_ARB — 발화 + ★한계 표기★ ── */
console.log("④ PR_OU · XS_ARB (롱 다리만)");
{
  const d = series(260, i => 100 * (1 + i * 0.001));
  const price = d.closes[d.closes.length - 1];
  const ctxP = { pair: { b: "PEER.KS", beta: 1.1, corr: 0.82, z: -2.4, hl: 8.0, vr: 0.6 }, xs: null, retDays: 5 };
  const p = M.evaluatePairOuEntry(price, d, CFG, "us", ctxP);
  chk(p && p.name === "PR_OU", "PR_OU 발화 — " + (p ? p.detail : "null"), "PR_OU 가 발화하지 않는다");
  chk(p && /롱다리만/.test(p.detail) && /시장중립 아님/.test(p.detail),
    "PR_OU 문구가 '롱다리만 · 시장중립 아님' 을 명시한다",
    "한계 표기가 없다 — 화면에서 진짜 페어로 오해하게 된다");
  // z 가 얕으면 침묵
  chk(!M.evaluatePairOuEntry(price, d, CFG, "us", { pair: Object.assign({}, ctxP.pair, { z: -0.8 }), retDays: 5 }),
    "z −0.8 은 침묵한다(문턱 −2.0)", "얕은 괴리에도 진입한다");
  // 분산비가 랜덤워크급이면 침묵(공적분이 아니다)
  chk(!M.evaluatePairOuEntry(price, d, CFG, "us", { pair: Object.assign({}, ctxP.pair, { vr: 0.98 }), retDays: 5 }),
    "분산비 0.98(랜덤워크)은 침묵한다", "공적분이 아닌 쌍도 거래한다");

  const x = M.evaluateXsArbEntry(price, d, CFG, "us", { xs: { z: -2.3, n: 40 }, retDays: 5 });
  chk(x && x.name === "XS_ARB", "XS_ARB 발화 — " + (x ? x.detail : "null"), "XS_ARB 가 발화하지 않는다");
  chk(x && /롱다리만/.test(x.detail) && /베타 잔존/.test(x.detail),
    "XS_ARB 문구가 '롱다리만 · 베타 잔존' 을 명시한다", "한계 표기가 없다");
  chk(!M.evaluateXsArbEntry(price, d, CFG, "us", { xs: { z: -2.3, n: 5 }, retDays: 5 }),
    "동료가 5종목뿐이면 침묵한다(횡단면이 성립 안 함)", "표본 없이도 횡단면을 주장한다");
}

/* ── ⑤ XR_FLOW — 달력 + 순위밴드, 그리고 '대리' 표기 ── */
console.log("⑤ XR_FLOW (지수 리밸런스 대리지표)");
{
  const d = series(260, i => 100 * (1 + i * 0.002));
  const price = d.closes[d.closes.length - 1];
  const ctx = { rank: { now: 210, prev: 240 }, retDays: 5 };
  const sig = M.evaluateIndexFlowEntry(price, d, CFG, "kr", ctx);
  // 정기변경 창 밖이면 null 이 정상이다 — 그 경우 달력 자체를 검사한다
  if (sig) {
    chk(/대리지표/.test(sig.detail) && /편입공시 아님/.test(sig.detail),
      "발화 시 '대리지표 · 편입공시 아님' 을 명시한다 — " + sig.detail,
      "공시를 아는 것처럼 적는다");
  } else {
    console.log("  ..   지금은 정기변경 창 밖이라 침묵(정상) — 달력·밴드 로직만 확인한다");
  }
  chk(!M.evaluateIndexFlowEntry(price, d, CFG, "kr", { rank: { now: 210, prev: 212 } }),
    "순위가 거의 안 움직였으면 침묵한다(밴드에 '있는' 것과 '올라오는' 것은 다르다)",
    "정체된 순위에도 발화한다");
  chk(!M.evaluateIndexFlowEntry(price, d, CFG, "kr", { rank: { now: 950, prev: 1200 } }),
    "밴드 밖(950위)은 침묵한다", "편입 밴드와 무관하게 발화한다");
  const fn = S.slice(S.indexOf("function _rvIndexReviewNear"), S.indexOf("function evaluateIndexFlowEntry"));
  chk(/months = \(market === "kr"\) \? \[5, 11\]/.test(fn),
    "코스피200 은 6·12월, 그 외는 분기(3·6·9·12) 정기변경 달력을 쓴다",
    "정기변경 달력이 시장별로 갈리지 않는다");
}

/* ── ⑥ 배선 — 평가·주입·야간단계·중복진입 방지 ── */
console.log("⑥ 배선");
{
  const ev = S.slice(S.indexOf("function evaluateAllStrategies"), S.indexOf("function evaluateAllStrategies") + 3000);
  for (const nm of ["evaluateIndexFlowEntry", "evaluateVolSpikeRevertEntry", "evaluatePairOuEntry",
                    "evaluateXsArbEntry", "evaluateVolTargetTrendEntry"]) {
    chk(ev.indexOf(nm) > 0, nm + " 가 평가 경로에 있다", nm + " 가 호출되지 않는다 — 만들어만 뒀다");
  }
  chk(/if \(!sig && _rvOn\)/.test(ev),
    "기존 신호가 없을 때만 평가한다(같은 종목 중복진입 방지 — SNAP 과 같은 규약)",
    "기존 신호와 겹쳐 발화할 수 있다");
  /* [V33.251] 가지치기는 _pickBestSignal 안으로 옮겼다(선택과 같은 자리에서 판단해야
     "후보 중 최선" 이 성립한다). 계약은 그대로이므로 ★위치가 아니라 동작★ 으로 확인한다 —
     신규 전략 이름으로 지는 이력을 만들어 실제로 걸러지는지 돌려 본다. */
  chk(/_pickBestSignal\(_cands/.test(ev), "선택기를 거친다(가지치기가 그 안에 있다)", "선택기를 안 거친다");
  {
    const losing = { XS_ARB: { trades: 40, wins: 6, sumPnlPct: 40 * -3.0 } };
    const cand = { name: "XS_ARB", confidence: 0.95, type: "SNAP", detail: "x", members: ["XS_ARB"] };
    chk(!M._pickBestSignal([cand], losing),
      "신규 전략도 실현기대 −3.0%/건이면 걸러진다(confidence 0.95 무시)",
      "새 전략만 기대값 게이트를 면제받는다");
    chk(!!M._pickBestSignal([cand], {}),
      "이력이 없으면 정상 통과한다(가지치기가 신규를 무조건 막지 않는다)",
      "이력 없는 신규까지 막힌다");
  }
  chk(/eventData\.rvPanel = await getState\(DB, "rv_panel"/.test(S),
    "사이클이 상대가치 패널을 주입한다", "패널이 주입되지 않아 페어·횡단면이 영영 null 이다");
  chk(/_stg\("rvpanel"/.test(S), "야간 파이프라인에 rvpanel 단계가 등록됐다", "패널을 만드는 단계가 없다");
  chk(/\["rvpanel", function \(DB\)/.test(S), "수동 실행 목록에도 있다(확인 경로)", "수동으로 돌려볼 방법이 없다");
  chk(/panelStaleH/.test(S) && /Date\.now\(\) - panel\.ts\) > RVSTRAT\.panelStaleH/.test(S),
    "낡은 패널은 쓰지 않는다(공적분은 깨진다)", "낡은 관계로 조용히 매매할 수 있다");
  chk(/"XR_FLOW", "VT_TREND"/.test(S) && /"PR_OU", "XS_ARB", "VS_REV"/.test(S),
    "신규 5종이 레짐 틸트(돌파/회귀) 분류에 등록됐다",
    "레짐 보정에서 조용히 빠진다");
}

console.log(fails ? "\n✗ 신규 전략 검사 " + fails + "건 실패" : "\n✓ 신규 전략 검사 통과");
process.exit(fails ? 1 : 0);
