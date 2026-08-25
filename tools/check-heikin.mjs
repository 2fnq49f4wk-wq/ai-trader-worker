/* ═══════════════════════════════════════════════════════════════════════════
   [V33.239] 하이킨아시(平均足) 추세반전 피처 계약

   사용자 요청으로 "하이킨아시 추세 반전 매매법" 을 학습 피처로 넣었다.
   이 검사가 지키는 것은 ★공식이 실제로 하이킨아시인가★ 다. 이름만 하이킨아시인
   값이 65만 표본에 박제되면 되돌릴 방법이 없다(featVer 를 또 올려야 한다).

   특히 haOpen 은 ★재귀★ 다 — haOpen[i] = (haOpen[i-1] + haClose[i-1])/2.
   중간부터 계산하면 값이 달라지므로, 창 처음부터 순차로 만들었는지 수렴으로 확인한다.
   ═══════════════════════════════════════════════════════════════════════════ */
import assert from "node:assert";
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

// ── 독립 구현(참조) — 검사 대상과 같은 공식을 따로 적어 값으로 대조한다 ──
function refHA(O, H, L, C) {
  const n = C.length, haO = [], haC = [], haH = [], haL = [];
  haC[0] = (O[0] + H[0] + L[0] + C[0]) / 4;
  haO[0] = (O[0] + C[0]) / 2;
  haH[0] = Math.max(H[0], haO[0], haC[0]); haL[0] = Math.min(L[0], haO[0], haC[0]);
  for (let i = 1; i < n; i++) {
    haC[i] = (O[i] + H[i] + L[i] + C[i]) / 4;
    haO[i] = (haO[i - 1] + haC[i - 1]) / 2;
    haH[i] = Math.max(H[i], haO[i], haC[i]);
    haL[i] = Math.min(L[i], haO[i], haC[i]);
  }
  return { haO, haC, haH, haL };
}
function mkBars(n, fn) {
  const O = [], H = [], L = [], C = [];
  for (let i = 0; i < n; i++) { const b = fn(i); O.push(b.o); H.push(b.h); L.push(b.l); C.push(b.c); }
  return { O, H, L, C };
}

console.log("① 공식 — 마지막 봉의 몸통·꼬리가 참조구현과 일치하는가");
{
  let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let px = 100;
  const b = mkBars(90, () => {
    const o = px; px = px * (1 + (rnd() - 0.48) * 0.02);
    const c = px, h = Math.max(o, c) * (1 + rnd() * 0.006), l = Math.min(o, c) * (1 - rnd() * 0.006);
    return { o, h, l, c };
  });
  const r = refHA(b.O, b.H, b.L, b.C);
  const i = b.C.length - 1;
  const rng = r.haH[i] - r.haL[i];
  const wantBody = Math.abs(r.haC[i] - r.haO[i]) / rng;
  const wantShad = ((r.haH[i] - Math.max(r.haO[i], r.haC[i])) - (Math.min(r.haO[i], r.haC[i]) - r.haL[i])) / rng;
  const got = M._mlHeikinFeats(b.C, b.H, b.L, b.O);
  chk(Math.abs(got.haBodyR - wantBody) < 1e-9,
    `haBodyR ${got.haBodyR.toFixed(6)} = 참조 ${wantBody.toFixed(6)}`,
    `haBodyR ${got.haBodyR} ≠ 참조 ${wantBody} — 몸통 공식이 다르다`);
  chk(Math.abs(got.haShadow - wantShad) < 1e-9,
    `haShadow ${got.haShadow.toFixed(6)} = 참조 ${wantShad.toFixed(6)}`,
    `haShadow ${got.haShadow} ≠ 참조 ${wantShad} — 꼬리 공식이 다르다`);
}

console.log("② haOpen 재귀 — 창 처음부터 만들었는가(중간부터면 값이 다르다)");
{
  /* 같은 꼬리 구간을 ★긴 창★ 과 ★짧은 창★ 으로 각각 계산한다. haOpen 은 재귀라
     짧은 창은 시드가 달라 값이 어긋난다. 우리 구현이 '받은 창 전체' 를 쓰는지 확인하고,
     동시에 재귀가 실제로 수렴한다는 것(=창이 충분히 길면 차이가 사라진다)도 보인다. */
  let px = 50; const bars = mkBars(400, (i) => {
    px = px * (1 + Math.sin(i / 9) * 0.004 + 0.0006);
    const o = px * 0.998, c = px, h = Math.max(o, c) * 1.003, l = Math.min(o, c) * 0.997;
    return { o, h, l, c };
  });
  const cut = (k) => ({ C: bars.C.slice(-k), H: bars.H.slice(-k), L: bars.L.slice(-k), O: bars.O.slice(-k) });
  const a = cut(400), sh = cut(15);
  const gA = M._mlHeikinFeats(a.C, a.H, a.L, a.O);
  const gS = M._mlHeikinFeats(sh.C, sh.H, sh.L, sh.O);
  const rA = refHA(a.O, a.H, a.L, a.C), rS = refHA(sh.O, sh.H, sh.L, sh.C);
  const dRef = Math.abs(rA.haO[rA.haO.length - 1] - rS.haO[rS.haO.length - 1]);
  chk(dRef > 1e-9, `짧은 창(15봉)은 참조에서도 haOpen 이 ${dRef.toExponential(2)} 만큼 다르다 — 재귀가 실재한다`,
    "짧은 창에서도 참조 haOpen 이 같다 — 이 검사의 전제가 성립하지 않는다");
  // 우리 구현도 참조와 같은 방향으로 갈려야 한다(=받은 창을 그대로 쓴다)
  const wantS = Math.abs(rS.haC[rS.haC.length - 1] - rS.haO[rS.haO.length - 1]) / (rS.haH[rS.haH.length - 1] - rS.haL[rS.haL.length - 1]);
  chk(Math.abs(gS.haBodyR - wantS) < 1e-9,
    "짧은 창도 그 창의 참조값과 일치 — 받은 창 처음부터 순차로 만든다",
    `짧은 창 haBodyR ${gS.haBodyR} ≠ 그 창 참조 ${wantS} — 창을 임의로 자르거나 캐시하고 있다`);
  chk(gA.haBodyR >= 0 && gA.haBodyR <= 1, "긴 창에서도 몸통비가 0~1 안에 있다", "몸통비가 범위를 벗어났다");
}

console.log("③ 반전 신호 — 실제 국면에서 뜻대로 나오는가");
{
  // (가) 강한 상승 런 → 하이킨아시가 연속 양봉, haRun 이 +1 에 붙는다
  let px = 100;
  const up = mkBars(60, () => { const o = px; px *= 1.012; const c = px; return { o, h: c * 1.001, l: o * 0.999, c }; });
  const gu = M._mlHeikinFeats(up.C, up.H, up.L, up.O);
  chk(gu.haRun > 0.8, `상승 런 → haRun ${gu.haRun.toFixed(2)} (연속 양봉)`, `상승 런인데 haRun ${gu.haRun}`);

  // (나) 긴 상승 뒤 급반전 → 색이 뒤집히고 haRev 가 음수(약세전환)
  let px2 = 100; const seq = [];
  for (let i = 0; i < 50; i++) { const o = px2; px2 *= 1.012; seq.push({ o, h: px2 * 1.001, l: o * 0.999, c: px2 }); }
  for (let i = 0; i < 3; i++) { const o = px2; px2 *= 0.965; seq.push({ o, h: o * 1.001, l: px2 * 0.999, c: px2 }); }
  const rv = mkBars(seq.length, (i) => seq[i]);
  const gr = M._mlHeikinFeats(rv.C, rv.H, rv.L, rv.O);
  chk(gr.haRun < 0, `급반전 후 색이 음(−)으로 뒤집혔다 — haRun ${gr.haRun.toFixed(2)}`,
    `반전했는데 haRun 이 ${gr.haRun} — 색 판정이 안 뒤집힌다`);

  // (다) 색이 막 뒤집힌 그 봉에서 haRev 가 켜지고, 부호가 새 방향을 가리킨다
  const flipSeq = seq.slice(0, 51);   // 상승 50봉 + 하락 1봉 = 방금 뒤집힌 순간
  const fl = mkBars(flipSeq.length, (i) => flipSeq[i]);
  const gf = M._mlHeikinFeats(fl.C, fl.H, fl.L, fl.O);
  chk(gf.haRev < -0.4, `긴 상승을 끊은 하락 전환 → haRev ${gf.haRev.toFixed(2)} (약세전환)`,
    `전환 순간인데 haRev ${gf.haRev} — 긴 런을 끊은 전환을 못 잡는다`);

  // (라) 아무 일 없는 횡보에서는 전환신호가 함부로 켜지지 않는다
  let px3 = 100;
  const flat = mkBars(80, (i) => { const o = px3; px3 *= (i % 2 ? 1.0004 : 0.9996); const c = px3;
    return { o, h: Math.max(o, c) * 1.0008, l: Math.min(o, c) * 0.9992, c }; });
  const gflat = M._mlHeikinFeats(flat.C, flat.H, flat.L, flat.O);
  chk(Math.abs(gflat.haRev) < 0.25, `횡보에서 haRev ${gflat.haRev.toFixed(2)} — 과하게 켜지지 않는다(최근 대비 수축으로 판정)`,
    `횡보인데 haRev ${gflat.haRev} — 아무 때나 전환이라 외친다`);
}

console.log("④ 배선 — 수확·라이브 공통 경로에 실제로 실려 나가는가");
{
  const src = (await import("node:fs")).readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const names = M.LUXML.featNames;
  for (const k of ["haRun", "haBodyR", "haShadow", "haRev"])
    chk(names.indexOf(k) >= 0, `featNames 에 ${k} 가 있다`, `featNames 에 ${k} 가 없다 — 모델이 못 본다`);
  chk(/const ha = _mlHeikinFeats\(closes, args\.highs, args\.lows, args\.opens\);/.test(src),
    "mlBuildFeatures(수확·라이브 단일 출처)에서 계산한다 — train/serve 분포가 갈리지 않는다",
    "mlBuildFeatures 에서 안 부른다 — 라이브에만 있거나 수확에만 있으면 스큐가 된다");
  chk(M.LUXML.featVer >= 14,
    `featVer ${M.LUXML.featVer} — 피처가 늘었으므로 판을 올려 옛 표본과 섞이지 않게 했다`,
    `featVer ${M.LUXML.featVer} — 차원이 바뀌었는데 판을 안 올렸다. 옛 표본과 섞여 모델이 깨진다`);
  // 차원 정합 — 실제로 만들어 본다
  let px = 30; const b = mkBars(300, () => { const o = px; px *= 1.001; const c = px;
    return { o, h: c * 1.002, l: o * 0.998, c }; });
  const vec = M.mlBuildFeatures({ closes: b.C, highs: b.H, lows: b.L, opens: b.O, volumes: b.C.map(() => 1e6),
    price: b.C[b.C.length - 1], prevClose: b.C[b.C.length - 2], dayPct: 0.1, regime: "BULL", strategy: "hv", market: "us", ev: {} });
  chk(Array.isArray(vec) && vec.length === names.length,
    `피처 벡터 ${vec.length}차원 = featNames ${names.length} — 어긋나면 표본이 통째로 버려진다`,
    `피처 벡터 ${vec && vec.length} ≠ featNames ${names.length}`);
  const bad = vec.filter((v) => !isFinite(v));
  chk(!bad.length, "피처 벡터에 NaN/Infinity 가 없다", `유한하지 않은 값 ${bad.length}개 — 학습이 통째로 깨진다`);
}

/* ══ [V33.254] ★피처만 있고 진입이 없었다★ ══════════════════════════════════
   V33.239 는 사용자 요청("하이킨아시 추세 반전 매매법도 학습시켜서 ★사용하게★")의
   앞 절반만 했다 — 위원회는 haRun·haBodyR·haShadow·haRev 를 '학습' 하는데, 그것으로
   ★진입하는 전략★ 이 없었다. 모델이 보는 것과 손이 하는 것이 달랐다.
   여기서는 그 진입 규칙이 ①실제로 발화하고 ②아무 때나 켜지지 않는지 돌려서 확인한다. */
console.log("⑦ HA_REV 진입 전략 (피처가 아니라 규칙으로)");
{
  const M2 = await import("../src/index.js");
  const CFG = { atrPeriod: 14, rvStrat: { enabled: true } };
  /* 하이킨아시 색은 haC vs haO 로 정해지고 haO 는 재귀평균이라, 원하는 패턴을 얻으려면
     ★실제 가격열★ 을 만들어 함수에 통과시켜야 한다. 상승추세(MA200 위) → 짧은 하락(빨강 런)
     → 강한 반등(초록 전환) 순서로 만든다. */
  const mk = (revBars, up) => {
    const c = [], h = [], l = [], o = [];
    let px = 100;
    for (let i = 0; i < 240; i++) { px *= 1.0025; c.push(px); o.push(px * 0.999); h.push(px * 1.004); l.push(px * 0.996); }
    for (let i = 0; i < 6; i++) { px *= 0.978; c.push(px); o.push(px * 1.012); h.push(px * 1.014); l.push(px * 0.997); }  // 빨강 런
    for (let i = 0; i < revBars; i++) { px *= up; c.push(px); o.push(px * 0.985); h.push(px * 1.004); l.push(px * 0.984); } // 초록 전환
    return { closes: c, highs: h, lows: l, opens: o, volumes: c.map(() => 1e6) };
  };
  /* ★1봉 +3% 로는 색이 안 뒤집힌다.★ 하이킨아시는 haO 가 재귀평균이라 평활되기 때문이다 —
     실측: 반등 1봉 +3% 에서 haRun −0.70(아직 빨강), haRev 0.58 은 '소진' 가지에서 나온 값이다.
     그건 우리가 일부러 제외하는 자리다(아직 빨강인데 사는 것 = 칼날). 실제로 뒤집히는 크기로 만든다. */
  const d = mk(1, 1.05);
  const ha = M2._mlHeikinFeats(d.closes, d.highs, d.lows, d.opens);
  console.log("   합성 전환봉의 하이킨아시: haRun " + ha.haRun.toFixed(2) +
              " haRev " + ha.haRev.toFixed(2) + " haBodyR " + ha.haBodyR.toFixed(2));
  const sig = M2.evaluateHeikinReversalEntry(d.closes[d.closes.length - 1], d, CFG, null, "us");
  chk(!!sig && sig.name === "HA_REV", "긴 빨강 런을 끊은 초록 전환에서 발화 — " + (sig ? sig.detail : "null"),
    "전환을 만들었는데 발화하지 않는다 (haRun " + ha.haRun.toFixed(2) + " haRev " + ha.haRev.toFixed(2) +
    " haBodyR " + ha.haBodyR.toFixed(2) + ")");
  chk(!!sig && /강세전환만/.test(sig.detail),
    "문구가 '강세 전환만(공매도 없음)' 을 명시한다 — 반전 매매법이 양방향으로 오해되지 않게",
    "한계 표기가 없다");

  // 추세 없는 횡보에서는 침묵해야 한다(V33.239 가 겪은 '아무 일 없는데 전환' 재발 방지)
  {
    const c = [], h = [], l = [], o = [];
    let px = 100;
    for (let i = 0; i < 250; i++) { px *= (1 + (i % 2 ? 0.0008 : -0.0008)); c.push(px); o.push(px * 0.9995); h.push(px * 1.001); l.push(px * 0.999); }
    const flat = { closes: c, highs: h, lows: l, opens: o, volumes: c.map(() => 1e6) };
    chk(!M2.evaluateHeikinReversalEntry(c[c.length - 1], flat, CFG, null, "us"),
      "저변동 횡보에서는 침묵한다", "횡보에서도 전환이라 외친다");
  }
  // 하락추세(MA200 아래)에서는 침묵 — 떨어지는 칼날
  {
    const c = [], h = [], l = [], o = [];
    let px = 300;
    for (let i = 0; i < 240; i++) { px *= 0.994; c.push(px); o.push(px * 1.004); h.push(px * 1.006); l.push(px * 0.997); }
    for (let i = 0; i < 1; i++) { px *= 1.03; c.push(px); o.push(px * 0.985); h.push(px * 1.004); l.push(px * 0.984); }
    const bear = { closes: c, highs: h, lows: l, opens: o, volumes: c.map(() => 1e6) };
    chk(!M2.evaluateHeikinReversalEntry(c[c.length - 1], bear, CFG, null, "us"),
      "MA200 아래 구조적 하락에서는 침묵한다(반전이 아니라 칼날)", "하락추세에서도 산다");
  }
  /* ★전환봉에서만 산다 — 그 다음 봉은 추격이다.★
     haRev 는 run===1(방금 뒤집힘)일 때만 값을 갖는다. 실측으로 그 성질을 고정한다:
     반등 2봉 +5% 는 이미 run=2 라 haRev 0.00 → 침묵해야 한다. */
  {
    const d2 = mk(2, 1.05);
    const ha2 = M2._mlHeikinFeats(d2.closes, d2.highs, d2.lows, d2.opens);
    chk(!M2.evaluateHeikinReversalEntry(d2.closes[d2.closes.length - 1], d2, CFG, null, "us"),
      "전환 다음 봉(run " + Math.round(Math.abs(ha2.haRun) * 10) + ")에서는 침묵한다 — 추격하지 않는다",
      "전환 이후에도 계속 발화한다 — 같은 전환을 여러 번 사게 된다");
  }
  /* ★가드마다 그것이 ★유일한 차단자★ 인 케이스를 쓴다.★
     처음엔 한 케이스로 둘을 같이 시험했는데, 소진(haRun<0)이면서 몸통도 작은 자리라
     두 가드가 서로를 가렸다 — 어느 쪽을 지워도 게이트가 안 물었다(변이시험에서 드러났다).
     조건을 갈라 각각 단독으로 막게 만든다. */
  // (a) haRun>0 가드만이 막는 자리 — 아직 빨강인데 haRev 0.51, 몸통 0.336(문턱 0.30 통과)
  {
    const c = [], h = [], l = [], o = [];
    let px = 100;
    for (let i = 0; i < 240; i++) { px *= 1.0025; c.push(px); o.push(px * 0.999); h.push(px * 1.0005); l.push(px * 0.9995); }
    for (let i = 0; i < 6; i++) { px *= 0.97; c.push(px); o.push(px * 1.031); h.push(px * 1.0315); l.push(px * 0.9995); }
    px *= 0.999; c.push(px); o.push(px * 1.004); h.push(px * 1.07); l.push(px * 0.93);
    const d3 = { closes: c, highs: h, lows: l, opens: o, volumes: c.map(() => 1e6) };
    const ha3 = M2._mlHeikinFeats(c, h, l, o);
    chk(ha3.haRun < 0 && ha3.haRev >= 0.5 && ha3.haBodyR >= 0.30,
      "합성: 빨강(haRun " + ha3.haRun.toFixed(2) + ") · haRev " + ha3.haRev.toFixed(2) +
        " · 몸통 " + ha3.haBodyR.toFixed(2) + " — ★haRun 가드만★ 이 막는 자리",
      "이 케이스를 재현하지 못해 다음 단언이 무의미하다");
    chk(!M2.evaluateHeikinReversalEntry(c[c.length - 1], d3, CFG, null, "us"),
      "haRev·몸통이 다 통과해도 색이 빨강이면 사지 않는다(확인된 전환만)",
      "빨강인 채로 산다 — 떨어지는 칼날이고 VS_REV 와 근거가 겹친다");
  }
  // (b) 몸통 가드만이 막는 자리 — 뒤집혔고(haRun>0) haRev 1.00 인데 몸통 0.125
  {
    const c = [], h = [], l = [], o = [];
    let px = 100;
    for (let i = 0; i < 240; i++) { px *= 1.0025; c.push(px); o.push(px * 0.999); h.push(px * 1.004); l.push(px * 0.996); }
    for (let i = 0; i < 6; i++) { px *= 0.978; c.push(px); o.push(px * 1.012); h.push(px * 1.014); l.push(px * 0.997); }
    px *= 1.04; c.push(px); o.push(px * 0.985); h.push(px * 1.03); l.push(px * 0.97);
    const d4 = { closes: c, highs: h, lows: l, opens: o, volumes: c.map(() => 1e6) };
    const ha4 = M2._mlHeikinFeats(c, h, l, o);
    chk(ha4.haRun > 0 && ha4.haRev >= 0.5 && ha4.haBodyR < 0.30,
      "합성: 전환(haRun " + ha4.haRun.toFixed(2) + ") · haRev " + ha4.haRev.toFixed(2) +
        " · 몸통 " + ha4.haBodyR.toFixed(3) + " — ★몸통 가드만★ 이 막는 자리",
      "이 케이스를 재현하지 못해 다음 단언이 무의미하다");
    chk(!M2.evaluateHeikinReversalEntry(c[c.length - 1], d4, CFG, null, "us"),
      "도지에서 뒤집힌 전환은 사지 않는다(확신 없는 전환)",
      "몸통 없는 전환도 산다 — 전환의 '강도' 를 안 본다");
  }
  // 후보 풀·레짐 분류에 편입됐는가
  const SRC = (await import("node:fs")).readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  chk(/_push\(evaluateHeikinReversalEntry/.test(SRC),
    "후보 풀에 들어가 다른 전략과 실현기대값으로 경쟁한다",
    "만들어만 두고 후보에 안 넣었다 — V33.239 와 같은 실수의 반복이다");
  chk(/"VS_REV", "HA_REV"/.test(SRC), "레짐 틸트(회귀 계열) 분류에 등록됐다", "레짐 보정에서 빠진다");
}

console.log(fails ? "\n하이킨아시 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   하이킨아시 추세반전 계약 통과");
process.exit(fails ? 1 : 0);
