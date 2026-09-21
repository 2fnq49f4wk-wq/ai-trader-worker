/* ═══════════════════════════════════════════════════════════════════════════
   [V33.408] V33.398 은 옳았고 ★자리★ 가 틀렸다 — τ* 가 블록 하한을 도로 올렸다

   ■ 화면 실측 (2026-09-22 08:09)
       GBDT 가동 w=0.6677 · 검증 73.7% · 하한 ★70.1%★ · Worker · 검증 유효 433/9,000(고유도 0.05)
     위원회 최대 지분을 이 하한이 가져가고 있었다.

   ■ 그 70.1% 는 어디서 나오나 — ★재현된다★
       9,000행 = 600종목 × 15거래일 · 라벨 지평 10일 → 겹치지 않는 블록 ★1개★
       같은 형상의 행 기반 Wilson(유효 433) = ★0.7009★   ← 화면의 70.1% 와 같은 산수다
     즉 실력 수준이 아니라 ★상관된 9,000행을 독립으로 센 결과★ 다.
     (이 검사 ③ 이 두 숫자를 실제로 계산해 확인한다.)

   ■ V33.398 이 그걸 막으려 했는데 왜 살아남았나
     accLB = min(accLB, 블록하한) 을 ★먼저★ 적용한 뒤, 아래 임계값 캘리브레이션이
     `if (accLBC > accLB) accLB = accLBC` 로 ★행 수 기반 Wilson 을 다시 얹는다.★
     블록 보정이 통째로 지워졌다. 의도는 옳았고 ★순서★ 가 틀렸다.

   ■ 막기만 하면 반쪽이다
     15일 창에서는 블록이 1개라 "못 쟀다" 로 ★영원히 승격 불가★ 가 된다.
     V33.326 이 FLOW·XALPHA·STACK 에 대해 같은 진단을 하고 달력 고정으로 고쳤다 —
     "표에는 재료가 있는데 안 읽은 것이다." 같은 처방을 GBDT 에도 쓴다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① ★순서★ — 블록 최소값이 accLB 확정 뒤에 오는가");
{
  const iMeasure = S.indexOf("let _blk = _blockAccLB(_bHit, _bTs, _hor);");
  const iTau = S.indexOf("if (accLBC > accLB) {");
  const iApply = S.indexOf("if (_blk.lb != null && _blk.lb < accLB) {");
  chk(iMeasure > 0 && iTau > iMeasure, "블록은 τ* 단계 ★앞★ 에서 재기만 한다", "블록 측정 자리를 못 찾는다");
  chk(iApply > iTau,
    "블록 최소값을 ★τ* 뒤★ 에 씌운다 — 되올림이 불가능하다",
    "★블록 최소값이 τ* 앞에 있다 — 캘리브레이션이 도로 올린다(V33.398 이 무력화된 그 자리)★");
  // 앞자리에서 몰래 다시 씌우면 안 된다(두 번 적용 = 순서가 되살아난다)
  const applies = (S.match(/_blk\.lb < accLB/g) || []).length;
  chk(applies === 1, "최소값을 씌우는 곳이 ★한 곳뿐★ 이다(" + applies + ")",
    "★최소값을 " + applies + "곳에서 씌운다 — 앞자리가 살아 있으면 순서가 되살아난다★");
}

console.log("\n② ★하한이 자기가 주장하는 모집단에서 재어지는가★ (τ* 가 이기면 calB 다)");
{
  chk(/_bHitC\.push\(_okC \? 1 : 0\); _bTsC\.push\(_num\(d\.ts, 0\)\);/.test(S),
    "calB 채점 루프에서 블록 재료(적중·시각)를 모은다",
    "★calB 의 블록 재료를 안 모은다 — 다른 구간의 블록을 씌우게 된다★");
  const i = S.indexOf("if (accLBC > accLB) {");
  const blk = S.slice(i, i + 420);
  chk(/_blk = _blockAccLB\(_bHitC, _bTsC, _hor\);/.test(blk),
    "τ* 가 이기면 블록도 ★calB 로 다시 잰다★ — 하한과 블록이 같은 구간이다",
    "★τ* 가 이겨도 옛 구간의 블록을 쓴다 — 딴 자로 잰 하한이다★");
}

console.log("\n③ ★화면의 70.1% 를 재현한다★ (실제로 계산해서 확인)");
{
  const D = 86400000, H = 10 * D, t0 = Date.parse("2026-09-01T00:00:00Z");
  const h = [], t = [];
  for (let d = 0; d < 15; d++) for (let i = 0; i < 600; i++) { h.push(i % 1000 < 737 ? 1 : 0); t.push(t0 + d * D); }
  const r = M._blockAccLB(h, t, H);
  chk(r.lb === null && r.k < M.BLKACC.minBlocks,
    "9,000행(600종목×15거래일) → 겹치지 않는 블록 " + r.k + "개 → ★못 쟀다★",
    "★15거래일 창이 측정 가능으로 나온다 — 블록 셈이 깨졌다★");
  const rowLB = M._wilsonLB(0.737, 433);
  chk(Math.abs(rowLB - 0.701) < 0.002,
    "같은 형상의 ★행 기반★ Wilson(유효 433) = " + rowLB.toFixed(4) + " — 화면의 70.1% 와 같은 산수다",
    "★재현이 안 된다(" + rowLB.toFixed(4) + ") — 이 고침의 근거가 약해진다★");
}

console.log("\n④ ★막기만 하지 않는가★ — 잴 수 있는 창을 ★실제로★ 준다(V33.326 과 같은 처방)");
{
  // 글자가 아니라 ★분할 함수를 돌려서★ 확인한다 — 창을 몰래 좁히면 여기서 잡힌다.
  const D = 86400000, hd = 10;
  const needB = (M.BLKACC.minBlocks + 2) * hd;          // 채점 구간
  const need = Math.max(hd, Math.floor(needB / 2)) + needB;
  const mk = (days) => {                      // 하루에 600종목씩 쌓이는 실제 수확 모양
    const t0 = Date.parse("2026-01-01T00:00:00Z"), a = [];
    for (let d = 0; d < days; d++) for (let i = 0; i < 600; i++) a.push({ ts: t0 + d * D, y: i & 1, x: [] });
    return a;
  };
  const okData = mk(need + M.MINIHOLD.minTrainDays + 40);
  const sp = M._gbdtCalSplit(okData, hd, M.GBDT.minTrainSamples, 20);
  chk(sp.need === need, "목표 기간을 ★(minBlocks+2) × 라벨지평★ 에서 ★채점 구간 기준★ 으로 잡는다(" + sp.need + "일)",
    "★기간 셈이 어긋난다(" + sp.need + " ≠ " + need + ") — 상수를 박았거나 절반으로 나눴다★");
  chk(sp.a && sp.b, "이력이 넉넉하면 달력 분할이 ★성립한다★ (" + (sp.mode || sp.why) + ")",
    "★넉넉한 이력에서도 달력 분할이 안 된다(" + sp.why + ") — 고쳐도 여전히 행 기반이다★");
  if (sp.b) {
    const bDays = (sp.b[sp.b.length - 1].ts - sp.b[0].ts) / D;
    const blk = M._blockAccLB(sp.b.map(() => 1), sp.b.map(o => o.ts), hd * D);
    chk(blk.lb != null && blk.k >= M.BLKACC.minBlocks,
      "★채점 구간 자체가 측정 가능하다★ — " + Math.round(bDays) + "일 → 블록 " + blk.k +
      "개 ≥ 최소 " + M.BLKACC.minBlocks + "개",
      "★창을 만들어 놓고 채점 구간은 여전히 못 잰다(블록 " + blk.k + "개, " + Math.round(bDays) +
      "일) — 고친 시늉만 한 것이다★");
    const trN = okData.length - (sp.a.length + sp.b.length);
    chk(trN >= M.GBDT.minTrainSamples,
      "학습에 " + trN + "행이 남는다 ≥ 최소 " + M.GBDT.minTrainSamples,
      "★잣대를 고치려다 학습을 굶겼다(" + trN + "행)★");
    // τ* 선택 구간이 ★비면★ 임계값이 NaN 이 되어 model.bias 가 통째로 망가진다.
    chk(sp.a.length >= 20 && sp.b.length >= 20,
      "양쪽 다 실체가 있다 — τ* 선택 " + sp.a.length + "행 · 채점 " + sp.b.length + "행",
      "★한쪽이 비었다(τ* " + sp.a.length + "/채점 " + sp.b.length + ") — 임계값이 NaN 이 되어 모델이 망가진다★");
    chk(sp.a.length > 0 && sp.b.length > 0 && sp.a[sp.a.length - 1].ts < sp.b[0].ts,
      "τ* 선택 구간이 채점 구간보다 ★앞★ 에 있다 — 고른 임계값으로 자기를 채점하지 않는다",
      "★두 구간이 겹치거나 뒤집혔다 — 선택 편향이 그대로 하한에 들어간다★");
  } else { fails += 4; }

  // 라벨 지평이 바뀌면 기간도 따라와야 한다 — 상수를 박으면 여기서 어긋난다
  {
    const hd2 = 20, needB2 = (M.BLKACC.minBlocks + 2) * hd2;
    const want2 = Math.max(hd2, Math.floor(needB2 / 2)) + needB2;
    const sp2h = M._gbdtCalSplit(mk(want2 + M.MINIHOLD.minTrainDays + 40), hd2, M.GBDT.minTrainSamples, 20);
    chk(sp2h.need === want2,
      "라벨 지평 " + hd2 + "일이면 기간도 " + sp2h.need + "일로 ★따라 늘어난다★",
      "★지평이 바뀌어도 기간이 " + sp2h.need + "일에 머문다(기대 " + want2 + ") — 상수를 박았다★");
    const bk2 = sp2h.b ? M._blockAccLB(sp2h.b.map(() => 1), sp2h.b.map(o => o.ts), hd2 * 86400000) : { k: 0, lb: null };
    chk(bk2.lb != null && bk2.k >= M.BLKACC.minBlocks,
      "그 창도 ★측정 가능하다★ — 블록 " + bk2.k + "개", "★지평이 늘면 다시 못 재게 된다★");
  }

  // 굶기면 ★쓰지 않는다★ — 폴백이 살아 있어야 이력 짧은 판갈이 직후에 학습이 멈추지 않는다
  const thin = mk(need + 2);
  const sp2 = M._gbdtCalSplit(thin, hd, M.GBDT.minTrainSamples, 20);
  chk(!sp2.a && !sp2.b, "이력이 짧으면 달력 분할을 ★포기한다★ (" + sp2.why + ") — 호출부가 행 기반으로 물러선다",
    "★이력이 짧아도 달력으로 잘라 학습을 굶긴다★");
  const starve = mk(need + M.MINIHOLD.minTrainDays + 40);
  const sp3 = M._gbdtCalSplit(starve, hd, 1e9, 20);
  chk(!sp3.a, "학습 표본이 모자라면 ★포기한다★ (" + sp3.why + ")", "★학습 굶김 보호가 안 걸린다★");

  // 호출부 배선: 함수를 쓰고, 실패하면 종전 행 기반으로 물러서고, 방식을 로그에 적는가
  chk(/const _sp = _gbdtCalSplit\(data, _hd, GBDT\.minTrainSamples, 20\);/.test(S),
    "야간 학습이 그 분할 함수를 ★실제로 부른다★", "★함수만 있고 배선이 없다★");
  chk(/else \{[\s\S]{0,200}data\.slice\(data\.length - nCal, data\.length - nCal \+ half\)/.test(S),
    "달력 분할이 불가하면 ★종전 행 기반으로 물러선다★(회귀 안전)",
    "★폴백이 없다 — 이력이 짧은 판갈이 직후에 학습이 통째로 멈춘다★");
  chk(/홀드아웃=" \+ _calMode/.test(S), "어느 방식으로 잘랐는지 로그가 적는다", "방식을 안 적는다");
}

console.log("\n⑤ 하한은 ★더 정직해지기만★ 하는가 (느슨해지는 방향이 없다)");
{
  const i = S.indexOf("if (_blk.lb != null && _blk.lb < accLB) {");
  const blk = S.slice(i, i + 420);
  chk(/accLB = \+_blk\.lb\.toFixed\(4\);/.test(blk) && !/_blk\.lb > accLB/.test(blk),
    "작을 때만 갈아 끼운다 — 블록 하한이 높다고 올려 쓰지 않는다",
    "★블록 하한이 높으면 올려 쓴다 — 느슨해지는 방향이 생겼다★");
  chk(/if \(_blk\.lb == null\) \{[\s\S]{0,320}return "\[GBDT\] " \+ trust\.reason;/.test(S),
    "못 쟀으면 ★승격하지 않는다★(종전 규율 유지)", "★못 잰 것을 통과로 읽는다★");
}

console.log(fails === 0 ? "\n✓ 블록 하한 적용순서 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
