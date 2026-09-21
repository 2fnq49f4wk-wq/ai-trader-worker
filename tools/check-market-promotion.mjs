/* ═══════════════════════════════════════════════════════════════════════════
   [V33.402] 시장전용 모델 승격 — 두 하한을 맞대 놓고 비교하면 안 된다

   ■ 실측이 드러낸 자리 (2026-09-21 회차)
       gbdt_kr  하한 52.93% · KR 검증 194,212행(유효 6,680) · 블록IC 0.0669 ★t 4.01★
       → {"activated": false, "shadow": true, "trusted": true, "sane": true}
     셋 다 통과인데 승격이 안 됐다. 막은 것은 통합 gbdt_model 의 하한 ★70.4%★ 다.
     그런데 그 70.4% 는 V33.398(AN-1)이 "검증 9,000행 = 종목당 15봉 ≈
     ★겹치지 않는 블록 1.5개★" 라고 밝힌 바로 그 숫자다.
     ★15일 동안 시장이 올랐다는 사건 하나가, 22개 블록·t 4.01 로 잰 모델을 막고 있었다.★

   ■ 두 가지가 틀렸고 둘 다 이 저장소가 다른 자리에서 이미 고친 병이다
     ① 기저율이 다르다 — gbdt_kr 은 KR 행에서, 통합은 전 시장에서 쟀다.
        V33.397(AM-1)이 "0.5 로부터의 거리는 실력이 아니다" 로 고친 것과 같은 병이
        모델 대 모델 비교에서 되풀이된다 → ★각자의 무실력 기준점 대비 초과★ 로 잰다.
     ② 못 잰 기준이 거부권을 갖고 있었다 — AN-1 의 규율("못 쟀으면 통과로 읽지 않는다")은
        ★대칭★ 이어야 한다. 못 잰 기준은 ★이겼다고도 읽지 않는다.★

   ■ 이 검사가 무는 것
     · 판정을 요청 핸들러 안에 인라인으로 되돌리면(게이트가 못 돌려 봄) 실패한다
     · 비교가 다시 날것 하한으로 돌아가면 실패한다
     · 못 잰 기준이 다시 거부권을 가지면 실패한다
     · 반대로 ★진짜로 더 나은 통합 모델을 못 막게 되면★ 도 실패한다(가드를 풀어준 게 아니다)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const T = (gLB, gBase, pLB, pBase, blkLB, blkK) =>
  M._mktBeatsPooled(gLB, gBase,
    { featVer: M.LUXML.featVer, valAccLB: pLB, valAccBase: pBase, valAcc: pLB, valN: 9000 },
    { blockAccLB: blkLB, blockK: blkK }, true, 4);

console.log("① ★실측 재현 — 사건 하나로 얻은 70.4% 가 t 4.01 을 막지 못한다★");
{
  const r = T(0.5293, 0.504, 0.704, null, null, 1);
  chk(r.block === false, "통합 기준점 미측정 → 막지 않는다 (" + r.why + ")",
    "★사건 1.5개로 얻은 70.4% 가 여전히 막는다 — gbdt_kr(t 4.01)이 섀도우에 갇힌다★");
  const r2 = T(0.5293, 0.504, 0.704, 0.50, 0.704, 1);
  chk(r2.block === false, "기준점이 있어도 블록 " + 1 + "개 < 4 면 막지 않는다 (아직 못 잰 값이다)",
    "★블록 1개짜리 하한이 거부권을 갖는다★");
}

console.log("\n② ★비교는 각자의 무실력 기준점 대비 초과로 한다★");
{
  // 날것 하한은 전용이 낮지만(0.53 < 0.60), 기저율을 빼면 전용이 더 낫다(3%p vs 2%p)
  const r = T(0.53, 0.50, 0.60, 0.58, 0.60, 20);
  chk(r.block === false,
    "날것 하한은 낮아도(53% < 60%) 초과가 크면 승격한다 — 3.00%p ≥ 2.00%p",
    "★날것 하한으로 비교한다 — 기저율이 다른 두 자를 맞대고 있다★");
  // 반대 방향 — 날것은 전용이 높지만 초과는 낮다
  const r2 = T(0.60, 0.58, 0.53, 0.50, 0.53, 20);
  chk(r2.block === true,
    "날것 하한이 높아도(60% > 53%) 초과가 작으면 막는다 — 2.00%p < 3.00%p",
    "★초과가 낮은데 날것이 높다고 통과시킨다★");
}

console.log("\n③ ★가드를 풀어준 게 아니다 — 진짜로 나은 통합 모델은 여전히 막는다★");
{
  const r = T(0.5293, 0.504, 0.60, 0.50, 0.60, 20);
  chk(r.block === true, "통합이 사건으로도 세고 기준점도 있고 실제로 더 나으면 막는다 (" + r.why + ")",
    "★진짜로 나은 통합 모델도 못 막는다 — 분리학습이 성능을 떨어뜨린다★");
  chk(/승격보류/.test(r.why), "막을 때 이유를 적는다", "막는 이유가 없다");
}

console.log("\n④ 못 잰 기준은 어느 경우에도 거부권이 없다");
{
  const cases = [
    ["통합모델 없음", M._mktBeatsPooled(0.53, 0.50, null, null, false, 4)],
    ["판 불일치", M._mktBeatsPooled(0.53, 0.50, { featVer: -1, valAccLB: 0.9 }, null, false, 4)],
    ["전용 기준점 미측정", T(0.53, null, 0.60, 0.50, 0.60, 20)],
    ["사건 수 미검증", T(0.53, 0.50, 0.70, 0.50, null, null)]
  ];
  for (const [nm, r] of cases)
    if (r.block !== false) { console.log("  FAIL ★" + nm + " 인데 막는다: " + r.why + "★"); fails++; }
  console.log("  ok   네 경우 모두 막지 않는다(통합없음 · 판불일치 · 기준점미측정 · 사건수미검증)");
  for (const [nm, r] of cases)
    if (!/막지 않는다/.test(r.why)) { console.log("  FAIL ★" + nm + " 의 사유가 그 사실을 안 적는다★"); fails++; }
  console.log("  ok   네 경우 모두 ★왜 비교를 생략했는지★ 를 적는다");
}

console.log("\n⑤ 판정이 한 곳에만 사는가 (호출부가 인라인으로 되돌아가지 않았는가)");
{
  chk(typeof M._mktBeatsPooled === "function", "판정이 순수 함수로 분리돼 있다(게이트가 돌려 볼 수 있다)",
    "★판정이 핸들러 안에 인라인이다 — 게이트는 '있는가' 만 보게 된다★");
  const i = S.indexOf('if (promote && (_mname === "gbdt_us"');
  const blk = S.slice(i, i + 900);
  chk(/_mktBeatsPooled\(/.test(blk), "호출부가 그 함수를 쓴다", "★호출부가 자기 사본을 갖고 있다★");
  chk(!/gLB < _pLB/.test(S), "날것 하한 비교(gLB < _pLB)가 소스에 남아 있지 않다",
    "★옛 비교가 어딘가 남아 있다 — 두 판정이 갈린다★");
  chk(/gbdt_trust/.test(blk), "통합모델의 ★사건 수★ 기록(gbdt_trust)을 읽는다",
    "사건 수를 안 읽는다 — 블록 1개짜리 하한을 그대로 믿는다");
}

console.log("\n⑥ B-3 회귀 — 전진 IC 의 ★부호★ 가 배수를 가르는가 (이미 고쳐진 것을 또 고치지 않게)");
{
  const mk = (o) => Object.assign({ valICt: 3.0, valICBlock: 0.05, valICeff: 12, valICspanD: 240, tMinUsed: 2.5 }, o);
  const pos = M.expertAdmit(mk({ fwdReady: false, fwdIC: +0.039, fwdN: 399 }));
  const neg = M.expertAdmit(mk({ fwdReady: false, fwdIC: -0.039, fwdN: 399 }));
  const non = M.expertAdmit(mk({ fwdReady: false, fwdIC: null, fwdN: 0 }));
  chk(pos.mult > 0 && neg.mult === 0,
    "같은 표본(399)에서 전진 IC +0.039 → ×" + pos.mult + " · −0.039 → 제외 (V33.355 가 이미 고쳤다)",
    "★부호가 배수를 안 가른다 — 반대 방향 증거가 쌓일수록 가중이 커진다(B-3)★");
  chk(non.mult > 0 && non.tier === "provisional",
    "전진이 아직 ★미측정★ 이면 벌하지 않는다(×" + non.mult + ") — 없는 증거로 벌하는 것과 다르다",
    "★측정도 안 된 것을 벌한다★");
  /* ★한 점만 보면 경사로가 평평해진 것을 못 잡는다.★ 처음 이 검사를 fwdN=399 한 점으로만
     썼더니, frac 을 상수로 못 박는 돌연변이를 놓쳤다 — 부호는 여전히 갈리지만 ★표본이
     쌓여도 안 내려간다★. B-3 의 계약은 부호만이 아니라 ★단조성★ 이다:
     음수 증거는 쌓일수록 0 으로 내려가고 minForward 에서 하드 리젝과 이어져야 한다. */
  {
    const ns = [50, 100, 200, 300, 399];
    const negs = ns.map(function (n) { return M.expertAdmit(mk({ fwdReady: false, fwdIC: -0.039, fwdN: n })).mult; });
    const poss = ns.map(function (n) { return M.expertAdmit(mk({ fwdReady: false, fwdIC: +0.039, fwdN: n })).mult; });
    const negMono = negs.every(function (v, i) { return i === 0 || v <= negs[i - 1] + 1e-12; });
    const posMono = poss.every(function (v, i) { return i === 0 || v >= poss[i - 1] - 1e-12; });
    chk(negMono && negs[0] > negs[negs.length - 1],
      "음수 증거는 표본이 쌓일수록 ★단조 감소★ 한다 — " + negs.map(function (v) { return "×" + v; }).join(" → "),
      "★음수 경사로가 평평하거나 되레 오른다 — 반대 증거가 쌓여도 가중이 안 줄어든다(B-3)★");
    chk(negs[negs.length - 1] === 0,
      "minForward 에 닿기 전에 0 이 되어 하드 리젝과 ★이어진다★(절벽이 없다)",
      "★경사로 끝과 하드 리젝 사이에 절벽이 남아 있다★");
    chk(posMono && poss[poss.length - 1] > poss[0],
      "양수 증거는 반대로 ★단조 증가★ 한다 — " + poss.map(function (v) { return "×" + v; }).join(" → "),
      "★양수 경사로가 표본에 반응하지 않는다 — frac 이 상수로 박혔을 수 있다★");
  }
  chk(!/미해결 결함 B-3/.test(S),
    "소스에 '미해결 결함 B-3' 경고가 남아 있지 않다 — 고쳐진 것은 고쳐졌다고 적는다",
    "★낡은 경고가 남아 있다 — 없는 구멍을 있다고 말해 같은 고침을 두 번 넣게 만든다(실제로 그럴 뻔했다)★");
}

console.log(fails === 0 ? "\n✓ 시장전용 승격·전진증거 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
