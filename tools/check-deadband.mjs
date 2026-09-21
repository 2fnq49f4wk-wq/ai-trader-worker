/* ═══════════════════════════════════════════════════════════════════════════
   [V33.409] ★데드밴드는 학습에만 건다 — 홀드아웃은 한 행도 안 건드린다★

   ■ 왜 필요한가 (화면 실측 2026-09-22 08:09)
       FLOW   합류 보류 · 홀드아웃 블록IC t ★−0.59★
       XALPHA 합류 보류 · 홀드아웃 블록IC t ★−0.89★
     약한 게 아니라 ★부호가 반대★ 다. 두 모델의 라벨은 적재 시점에
     `pnl_pct > 0 ? 1 : 0` 로 굳는다 — 10일에 +0.02% 가 1, −0.02% 가 0 이다.
     경제적으로 같고 통계적으로 구분 불가능한 띠에 모델 용량이 소모된다.

   ■ 실험대(V33.405)가 ml_samples 에서 같은 진단을 측정했다
       A 운영(sign)              +2.26%p / IC 0.0663
       D 변동성정규화+데드밴드    ★+3.12%p / IC 0.0872★

   ■ ★그 숫자를 그대로 베끼면 안 된다★ — 실험대 자신이 경고를 적어 두었다
       "데드밴드 후보는 ★모집단이 다르다★(애매한 띠를 뺀다).
        정확도가 높게 나오는 것은 당연하고, 그 자체로 이겼다는 뜻이 아니다."
     맞는 말이다. 그래서 더 엄하게 쓴다 — ★학습에만★ 걸고 검증은 전 구간 그대로 둔다.
     그러면 홀드아웃 수치가 오르는 것은 모집단이 바뀌어서가 아니라 진짜로 나아진 것이고,
     운영에서 채점당하는 모집단과도 같다. ★검증 하한은 한 톨도 안 낮춘다.★

   이 검사는 글자가 아니라 ★함수를 돌려서★ 그 계약을 확인한다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

// 하루에 여러 종목이 쌓이는 실제 모양 — 시장마다 변동성 규모가 다르게 만든다
const mk = (n, scale, mkt) => {
  const P = [], MK = [];
  for (let i = 0; i < n; i++) { P.push(((i % 41) - 20) / 20 * scale); MK.push(mkt); }
  return { P, MK };
};

console.log("① ★홀드아웃 불가침★ — 데드밴드가 검증 구간을 읽지도 건드리지도 않는가");
{
  const a = mk(3000, 1.0, "us");
  // 홀드아웃 자리(ntr 너머)에 ★극단값★ 을 심는다. 함수가 그걸 보면 문턱이 흔들린다.
  const P = a.P.concat(new Array(1500).fill(9999)), MK = a.MK.concat(new Array(1500).fill("us"));
  const r1 = M._deadbandMask(P, MK, 3000, 100, undefined);
  const r2 = M._deadbandMask(a.P, a.MK, 3000, 100, undefined);
  chk(r1.mask && r2.mask && r1.keep === r2.keep,
    "홀드아웃에 극단값 1,500행을 심어도 결과가 ★한 행도 안 바뀐다★ (keep " + r1.keep + ")",
    "★홀드아웃이 문턱에 스며든다(" + (r1.keep) + " vs " + (r2.keep) + ") — 검증 모집단이 오염된다★");
  chk(r1.mask && r1.mask.length === 3000,
    "마스크 길이가 ★학습행 수★ 와 같다 — 홀드아웃에는 자리 자체가 없다",
    "★마스크가 홀드아웃까지 덮는다 — 검증행을 뺄 수 있다★");
  // 호출부도 ntr 까지만 손댄다
  chk(/for \(let i = 0; i < ntr; i\+\+\) if \(!_db\.mask\[i\]\) \{ uw\[i\] = 0;/.test(S),
    "호출부의 적용 루프가 ★ntr 에서 멈춘다★",
    "★적용 루프가 ntr 을 넘는다 — 검증행의 가중을 0 으로 만든다★");
  chk(/const _db = _deadbandMask\(P, MK, ntr, opts\.minN, opts\.deadband\);/.test(S),
    "호출부가 ntr 을 넘겨 ★애초에 홀드아웃을 볼 수 없게★ 한다", "★배선이 없다★");
  // 검증 루프는 종전 그대로 nvalStart 부터 — 데드밴드가 경계를 못 움직인다
  chk(/for \(let i = nvalStart; i < N; i\+\+\)/.test(S),
    "검증 루프는 종전대로 nvalStart 부터 ★전 구간★ 을 돈다(게이트 모집단 불변)",
    "★검증 루프 경계가 바뀌었다★");
}

console.log("\n② ★누출 금지★ — 문턱(중앙값)을 학습행만으로 재는가");
{
  const a = mk(2000, 1.0, "us");
  const big = mk(2000, 100.0, "us");                 // 뒤쪽에 규모가 100배인 구간
  const r = M._deadbandMask(a.P.concat(big.P), a.MK.concat(big.MK), 2000, 100, undefined);
  const base = M._deadbandMask(a.P, a.MK, 2000, 100, undefined);
  chk(r.mask && base.mask && r.keep === base.keep,
    "뒤 구간의 규모가 100배여도 앞 2,000행의 판정이 ★그대로★ (keep " + r.keep + ")",
    "★미래 구간이 문턱을 정한다 — 전형적 누출이다★");
}

console.log("\n③ ★시장별★ 문턱인가 (C2: 시장을 섞으면 artifact 가 생긴다)");
{
  const us = mk(1200, 1.0, "us"), kr = mk(1200, 50.0, "kr");
  const P = us.P.concat(kr.P), MK = us.MK.concat(kr.MK);
  const r = M._deadbandMask(P, MK, 2400, 100, undefined);
  chk(!!r.mask, "혼합 시장에서 마스크가 나온다", "★혼합 시장에서 못 만든다★");
  if (r.mask) {
    let ku = 0, kk = 0;
    for (let i = 0; i < 1200; i++) if (r.mask[i]) ku++;
    for (let i = 1200; i < 2400; i++) if (r.mask[i]) kk++;
    chk(Math.abs(ku - kk) <= 60,
      "규모가 50배 다른 두 시장에서 ★남는 비율이 같다★ (us " + ku + " / kr " + kk + ") — 시장별로 쟀다",
      "★한 시장이 통째로 쓸려나간다(us " + ku + " / kr " + kk + ") — 공통 문턱을 쓰고 있다★");
    // 섞어 재면 어떻게 되는지 대조군 — 위 등가성이 우연이 아님을 보인다
    const pooled = M._deadbandMask(P, new Array(2400).fill("one"), 2400, 100, undefined);
    let pu = 0, pk = 0;
    for (let i = 0; i < 1200; i++) if (pooled.mask && pooled.mask[i]) pu++;
    for (let i = 1200; i < 2400; i++) if (pooled.mask && pooled.mask[i]) pk++;
    chk(Math.abs(pu - pk) > 200,
      "대조군: 한 바구니로 섞으면 실제로 기울어진다(us " + pu + " / kr " + pk + ") — ③ 이 우연이 아니다",
      "★대조군이 안 기운다 — 이 검사가 시장별 여부를 가릴 힘이 없다★");
  } else fails += 2;
  chk(M.DEADBAND.minMarketN > 0 && /a\.length >= _num\(DEADBAND\.minMarketN, 200\) \? _med\(a\) : _poolMed/.test(S),
    "얇은 시장은 자기 중앙값을 안 쓰고 ★공통값으로 물러선다★",
    "★표본 몇 개짜리 시장의 중앙값을 그대로 믿는다★");
}

console.log("\n④ ★학습을 굶기지 않는가★ — 너무 많이 버리면 쓰지 않는다");
{
  // 절반 넘게 버려야 하는 표본 — |pnl| 이 중앙값 부근에 촘촘히 몰려 있다
  const P = [], MK = [];
  for (let i = 0; i < 3000; i++) { P.push(1 + (i % 7) * 1e-6); MK.push("us"); }
  P[0] = 1e6;                                       // 중앙값을 0 이 아니게 만드는 한 행
  const r = M._deadbandMask(P, MK, 3000, 100, undefined);
  chk(!r.mask, "거의 다 버려야 하는 표본에서는 ★데드밴드를 포기한다★ (" + r.note + ")",
    "★학습행을 거의 다 버리고도 강행한다 — 잣대를 고치려다 모델을 죽인다★");
  const thin = mk(420, 1.0, "us");                  // 남는 행이 minKeepN 아래로 떨어지는 크기
  const r2 = M._deadbandMask(thin.P, thin.MK, 420, 100, undefined);
  chk(!r2.mask, "남는 행이 절대 하한(" + M.DEADBAND.minKeepN + ")에 못 미치면 ★포기한다★ (" + r2.note + ")",
    "★절대 하한을 안 본다★");
  // ★문턱 0 은 적용이 아니다★ — "100% 적용" 이라 적으면 로그가 거짓말을 한다
  const zero = M._deadbandMask(new Array(1000).fill(0), new Array(1000).fill("us"), 1000, 100, undefined);
  chk(!zero.mask && /미적용/.test(zero.note),
    "문턱이 0 이면 ★미적용이라고 적는다★ (" + zero.note + ")",
    "★한 행도 안 뺐는데 '100% 적용' 이라 적는다 — 로그가 거짓말을 한다★");
  const big = mk(20000, 1.0, "us");
  const r3 = M._deadbandMask(big.P, big.MK, 20000, 1e9, undefined);
  chk(!r3.mask, "남는 행이 그 모델의 최소표본에 못 미쳐도 ★포기한다★ (" + r3.note + ")",
    "★minN 을 안 본다 — 데드밴드 뒤 학습이 문턱 아래로 내려갈 수 있다★");
}

console.log("\n⑤ ★끌 수 있는가★ · ★적용률을 적는가★");
{
  const a = mk(3000, 1.0, "us");
  chk(!M._deadbandMask(a.P, a.MK, 3000, 100, false).mask,
    "opts.deadband === false 면 ★안 건다★ (모델별로 끌 수 있다)", "★손잡이가 안 먹는다★");
  const on = M._deadbandMask(a.P, a.MK, 3000, 100, undefined);
  chk(on.mask && /학습만 \d+% 적용/.test(on.note),
    "적용률을 ★숫자로★ 적는다 — " + on.note,
    "★적용률을 안 적는다 — 실험대가 못 박은 규율이다(모집단이 바뀌므로 수치를 못 읽는다)★");
  chk(/" 데드밴드\[" \+ _dbNote \+ "\]"/.test(S), "학습완료 로그에 그 줄이 실린다", "★로그에 안 싣는다★");
  chk(M.DEADBAND.k > 0 && M.DEADBAND.k < 1, "문턱 배수 k=" + M.DEADBAND.k + " (중앙값보다 작다)",
    "★k 가 중앙값 이상이다 — 절반 넘게 버린다★");
}

console.log("\n⑥ ★검증 하한을 낮추지 않았는가★ — 문턱 상수는 한 톨도 안 건드렸다");
{
  const floors = { GBDT: M.GBDT.trustFloor, DNN: M.DNN.trustFloor, MIND: M.MIND.trustFloor };
  for (const [n, v] of Object.entries(floors))
    chk(v === 0.505, n + " 문턱 0.505 그대로", "★" + n + " 문턱이 " + v + " 로 바뀌었다★");
  const lits = (S.match(/trustFloor: 0\.505/g) || []).length;
  chk(lits === 4, "소스의 trustFloor 0.505 리터럴 " + lits + "개 — 전부 제자리",
    "★trustFloor 리터럴이 " + lits + "개다(기대 4) — 어딘가 낮췄다★");
  chk(M.ICGATE.tMin >= 2.5, "블록 IC t 문턱 " + M.ICGATE.tMin + " ≥ 2.5 그대로",
    "★IC t 문턱이 " + M.ICGATE.tMin + " 로 낮아졌다 — 데드밴드는 성능을 올리는 것이지 문을 여는 게 아니다★");
  chk(M.ICGATE.strictMult >= 1.15, "엄격배수 " + M.ICGATE.strictMult + " ≥ 1.15 그대로",
    "★엄격배수가 " + M.ICGATE.strictMult + " 로 낮아졌다★");
  chk(M.ICGATE.forwardTMin >= 1, "전진 t 문턱 " + M.ICGATE.forwardTMin + " ≥ 1 그대로",
    "★전진 t 문턱이 낮아졌다★");
}

console.log(fails === 0 ? "\n✓ 데드밴드 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
