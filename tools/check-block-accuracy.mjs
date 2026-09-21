// [V33.398] ★행을 세지 말고 사건을 세라★ — 정확도 하한이 독립 관측을 잘못 세고 있었다
//
//   사용자 화면 실측(2026-09-21):
//     워커 GBDT  검증 9,000행 · 유효 432 · 하한 70.4% → 위원회 지분 0.71
//     Modal LGB  검증 276,251행 · 유효 8,442 · 하한 51.1% → 지분 0.20
//   산수를 하면 답이 나온다. 9,000행 ÷ 종목 600 = 종목당 15봉 ≈ 15거래일, 라벨 지평 10일
//   → ★겹치지 않는 블록 1.5개★. "그 15일 동안 시장이 올랐다" 는 ★사건 하나★ 다.
//   276,251행 쪽은 같은 계산으로 블록 46개 — 진짜로 여러 사건을 봤다.
//
//   고유도(de Prado)는 ★같은 종목 안에서만★ 겹침을 센다. 그 주석이 그렇게 적혀 있다:
//     "다른 종목의 같은 기간은 상관은 있어도 같은 사건이 아니다"
//   횡단면 수익엔 맞지만 ★방향성 라벨★ 엔 틀리다. 그래서 Wilson 하한을 432 로 재면
//   15일치 시장 방향이 70.4% 의 확신으로 둔갑한다.
//
//   이 저장소는 ★IC 에 대해서는 이미★ 블록으로 센다(t = ICIR×√K). 정확도만 예외였다.
import fs from "node:fs";
const S = fs.readFileSync("src/index.js", "utf8");
const M = await import("../src/index.js");
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };

const H = 10 * 86400000;
const rnd = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
/* 시장 방향을 ★전 종목이 공유★ 하는 합성표본 — 이 구조가 바로 문제의 핵심이다. */
function mkt(days, syms, pUp, noise, seed) {
  const r = rnd(seed), hits = [], ts = [];
  const t0 = Date.UTC(2026, 0, 1);
  for (let d = 0; d < days; d++) {
    const up = r() < pUp;
    for (let k = 0; k < syms; k++) {
      const actual = (r() < noise) ? !up : up;
      hits.push(actual ? 1 : 0);                 // 모델은 늘 "오른다" → 실력 0
      ts.push(t0 + d * 86400000);
    }
  }
  return { hits, ts };
}

// ── ① ★짧은 창은 못 쟀다고 말한다★ — 그게 이 개혁의 전부다 ────────────────────
{
  const a = mkt(15, 600, 0.74, 0.06, 7);         // 워커 GBDT 창
  const r = M._blockAccLB(a.hits, a.ts, H);
  if (r.lb != null) no(`블록정확도: 15거래일 창(블록 ${r.k}개)인데 하한을 냈다 — 사건 하나를 실력으로 읽는다`);
  else ok(`15거래일 창 → 블록 ${r.k}개 → ★못 쟀다★ ("${String(r.why).slice(0, 40)}…")`);
  const b = mkt(460, 600, 0.74, 0.06, 7);        // Modal 창
  const r2 = M._blockAccLB(b.hits, b.ts, H);
  if (r2.lb == null) no("블록정확도: 460거래일 창인데도 못 잰다 — 긴 창까지 죽이면 개혁이 아니라 파괴다");
  else ok(`460거래일 창 → 블록 ${r2.k}개 → 하한 ${(r2.lb * 100).toFixed(1)}% (긴 창은 그대로 산다)`);
}

// ── ② 블록 간 산포를 실제로 쓰는가 — 같은 평균이라도 흔들리면 하한이 낮아야 한다 ──
{
  const t0 = Date.UTC(2026, 0, 1);
  const mk = (per) => { const hits = [], ts = []; per.forEach((acc, b) => {
    for (let i = 0; i < 200; i++) { hits.push(i < acc * 200 ? 1 : 0); ts.push(t0 + b * H + 1); } }); return { hits, ts }; };
  const steady = mk([0.6, 0.6, 0.6, 0.6, 0.6, 0.6]);
  const jumpy = mk([0.2, 1.0, 0.2, 1.0, 0.2, 1.0]);
  const a = M._blockAccLB(steady.hits, steady.ts, H), b = M._blockAccLB(jumpy.hits, jumpy.ts, H);
  if (a.lb == null || b.lb == null) no("블록정확도: 6블록인데 못 쟀다");
  else if (!(b.lb < a.lb - 0.05))
    no(`블록정확도: 평균이 같은데(0.60) 흔들리는 쪽 하한이 안 낮다(안정 ${a.lb.toFixed(3)} vs 요동 ${b.lb.toFixed(3)})`);
  else ok(`같은 평균 0.60 — 안정 ${(a.lb * 100).toFixed(1)}% vs 요동 ${(b.lb * 100).toFixed(1)}% (블록 간 산포를 실제로 쓴다)`);
}

// ── ③ ★하한은 더 정직해지기만 한다★ — 느슨해지는 방향이 없어야 한다 ───────────
/* [V33.408] 글자가 아니라 ★뜻★ 으로 잰다 — V33.408 이 이 자리를 τ* 뒤로 옮기면서
   옛 고정 문구가 깨졌다. 계약은 그대로다: "블록 하한을 채택하는 곳은 한 군데뿐이고,
   그 자리는 ★더 작을 때만★ 갈아 끼운다." 그래서 대입 자리를 세고 가드를 확인한다. */
for (const [nm, lbv, accv] of [["GBDT", "_blk", "accLB"], ["DNN", "_blkD", "dnnLB"]]) {
  const asg = [...S.matchAll(new RegExp(accv + " = \\+" + lbv + "\\.lb\\.toFixed\\(4\\);", "g"))];
  if (asg.length !== 1) { no(`블록정확도: ${nm} 가 블록 하한을 ${asg.length} 곳에서 채택한다 — 한 곳이어야 순서가 안 되살아난다`); continue; }
  const pre = S.slice(Math.max(0, asg[0].index - 300), asg[0].index);
  const g = new RegExp("if \\(" + lbv + "\\.lb != null && " + lbv + "\\.lb < " + accv + "\\)[\\s\\S]{0,120}$");
  if (!g.test(pre)) no(`블록정확도: ${nm} 가 블록 하한을 '둘 중 작은 값' 으로 쓰지 않는다 — 느슨해질 수 있다`);
  if (new RegExp(lbv + "\\.lb > " + accv).test(pre)) no(`블록정확도: ${nm} 에 하한을 ★올려 쓰는★ 방향이 생겼다`);
}
ok("GBDT·DNN 둘 다 '더 작은 하한' 만, ★한 자리에서만★ 채택한다(느슨해지는 방향 없음)");

// ── ④ 못 쟀으면 ★승격을 막는가★ — 못 잰 것을 통과로 읽지 않는다 ────────────────
{
  for (const [nm, re] of [
    ["GBDT", /if \(_blk\.lb == null\) \{[\s\S]{0,400}?setState\(DB, "gbdt_trust", trust\);[\s\S]{0,200}?return/],
    ["DNN", /if \(_blkD\.lb == null\) \{[\s\S]{0,300}?setState\(DB, "dnn_trust", trust\);[\s\S]{0,120}?return/],
  ]) if (!re.test(S)) no(`블록정확도: ${nm} 가 '못 쟀다' 인데 승격 경로로 계속 간다`);
  ok("못 쟀으면 두 경로 모두 그 자리에서 멈춘다");
  /* ★사유를 남기는가★ — 멈추기만 하고 이유가 없으면 화면이 "미학습" 으로 뭉갠다(돌연변이 B5). */
  for (const [nm, re] of [
    ["GBDT", /if \(_blk\.lb == null\) \{[\s\S]{0,200}?trust\.reason = "블록 기준 못 쟀다/],
    ["DNN", /if \(_blkD\.lb == null\) \{[\s\S]{0,200}?trust\.reason = "블록 기준 못 쟀다/],
  ]) if (!re.test(S)) no(`블록정확도: ${nm} 가 '못 쟀다' 사유를 trust.reason 에 안 남긴다`);
  ok("두 경로 모두 '못 쟀다' 사유를 기록에 남긴다");
  /* ★그 값이 정말 _blockAccLB 에서 오는가★ — 상수로 바꿔치기하면 검사가 통째로 무의미해진다
     (돌연변이 B6 가 그렇게 빠져나갔다). */
  /* [V33.408] GBDT 는 τ* 가 이기면 ★calB 로 다시 잰다★ — 그래서 대입이 한 번이 아니다.
     계약을 다시 세운다: "_blk / _blkD 에 들어가는 값은 ★전부★ _blockAccLB 호출에서 온다."
     상수를 한 군데라도 끼워 넣으면(돌연변이 B6) 여기서 걸린다. */
  for (const [nm, lbv] of [["GBDT", "_blk"], ["DNN", "_blkD"]]) {
    const asg = [...S.matchAll(new RegExp("(?:const |let |)\\b" + lbv + " = ([^;\\n]+);", "g"))];
    if (!asg.length) { no(`블록정확도: ${nm} 의 블록 하한 대입을 못 찾는다`); continue; }
    const bad = asg.filter(m => !/^_blockAccLB\(/.test(m[1].trim()));
    if (bad.length) no(`블록정확도: ${nm} 의 블록 하한이 _blockAccLB 아닌 데서 온다 — ${bad.map(b => b[1].trim()).join(" / ")}`);
  }
  ok("두 경로의 블록 하한이 ★대입마다 전부★ 실제 _blockAccLB 호출에서 나온다");
  /* 적중·시각이 ★검증행에서★ 모이는가 — 빈 배열을 넘기면 언제나 '못 쟀다' 가 되어
     겉보기엔 안전하지만 실제로는 아무 모델도 승격 못 한다(조용한 마비). */
  for (const re of [/_bHit\.push\(_ok \? 1 : 0\); _bTs\.push\(_num\(d\.ts, 0\)\)/,
                    /_bHitD\.push\(_ok \? 1 : 0\); _bTsD\.push\(_num\(t\.ts, 0\)\)/])
    if (!re.test(S)) no("블록정확도: 검증행의 적중·시각을 모으는 코드가 없다");
  ok("검증행마다 적중·시각을 모은다(빈 배열로 조용히 마비되지 않는다)");
  if (!/blockAccLB/.test(S) || !/blockK/.test(S))
    no("블록정확도: 블록 하한·블록 수를 기록에 안 남긴다 — 화면이 이유를 말할 수 없다");
  else ok("blockAccLB·blockK 를 기록에 남긴다");
}

// ── ⑤ 문턱 상수를 안 건드렸는가 — ★자를 고친 것이지 문턱을 올린 게 아니다★ ──────
{
  /* ★문턱 상수 전수 검사★ — 처음엔 GBDT·DNN 두 개만 봤더니, 파일의 다른 0.505 를 바꾼
     돌연변이(B8)가 그대로 통과했다. 이 변경은 ★자만★ 고치는 것이므로 문턱은 전부 그대로여야 한다. */
  {
    const floors = { GBDT: M.GBDT.trustFloor, DNN: M.DNN.trustFloor,
                     MIND: M.MIND && M.MIND.trustFloor, SEQ: M.SEQML && M.SEQML.trustFloor };
    const moved = Object.entries(floors).filter(([, v]) => v != null && Math.abs(v - 0.505) > 1e-9);
    if (moved.length) no("블록정확도: 문턱 상수가 바뀌었다 — " + moved.map(([k, v]) => `${k}=${v}`).join("·") +
                          " (이 변경은 자만 고치는 것이다)");
    else ok(`문턱 상수 ${Object.keys(floors).filter((k) => floors[k] != null).length}종 전부 0.505 그대로 — 바꾼 것은 '무엇을 세는가' 하나다`);
    const lit = (fs.readFileSync("src/index.js", "utf8").match(/trustFloor: 0\.505/g) || []).length;
    if (lit < 3) no(`블록정확도: 소스의 trustFloor 0.505 리터럴이 ${lit}개뿐이다 — 누가 조용히 옮겼다`);
    else ok(`소스에 trustFloor 0.505 리터럴 ${lit}개 — 전부 제자리`);
  }
  if (!(M.BLKACC && M.BLKACC.minBlocks >= 4))
    no("블록정확도: 최소 블록 수가 4 미만이다 — 두세 블록의 산포는 산포가 아니다");
  else ok(`최소 블록 ${M.BLKACC.minBlocks}개 · 단측 ${M.BLKACC.tMul}σ`);
}

/* [기록] 돌연변이 B7(`if (K < minBlocks)` 무력화)은 ★잡히지 않는다 — 무해하기 때문이다.★
   아래 두 번째 가드(채워진 블록 수 < minBlocks)가 같은 경우를 덮고, K=0 이어도
   길이 0 배열에 쓰는 것이라 조용히 무시되어 acc.length=0 → '못 쟀다' 가 된다.
   ★잡히지 않는 이유를 적어 두지 않으면 다음 사람이 이 게이트를 헐겁다고 오해한다.★ */

// ── ⑥ 경계 — 표본이 적거나 시각이 없으면 조용히 통과시키지 않는다 ─────────────
{
  const cases = [
    ["표본 4행", { hits: [1, 0, 1, 1], ts: [1, 2, 3, 4] }],
    ["시각 전부 0", { hits: new Array(100).fill(1), ts: new Array(100).fill(0) }],
    ["지평 0", { hits: new Array(100).fill(1), ts: new Array(100).fill(0).map((_, i) => i * 86400000) }],
  ];
  for (const [nm, c] of cases) {
    const r = M._blockAccLB(c.hits, c.ts, nm === "지평 0" ? 0 : H);
    if (r.lb != null) no(`블록정확도: ${nm} 인데 하한을 냈다`);
  }
  ok("표본 부족·시각 없음·지평 0 — 전부 '못 쟀다'(조용한 통과 없음)");
}

console.log(bad ? `\n블록 정확도 게이트 실패 ${bad}건` : "\n블록 정확도 게이트 통과");
process.exit(bad ? 1 : 0);
