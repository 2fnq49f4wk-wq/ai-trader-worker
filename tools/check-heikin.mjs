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

console.log(fails ? "\n하이킨아시 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   하이킨아시 추세반전 계약 통과");
process.exit(fails ? 1 : 0);
