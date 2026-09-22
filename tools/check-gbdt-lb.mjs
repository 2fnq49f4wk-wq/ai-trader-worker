/* ═══════════════════════════════════════════════════════════════════════════
   [V33.413] ★"못 쟀다" 고 해놓고 그 숫자를 화면에 올리면 안 된다★ (BC-1)
             ★그리고 영원히 못 재게 두어서도 안 된다★ (BC-2)
             ★"잡음과 구별 안 됨" 을 '왜' 로 바꾼다★ (BC-3)

   ■ 사용자 관측 — "gbdt 검증하한 오류난 것 같다"
     맞는 지적이다. 화면이 ★"하한 70.1%" 와 "블록 기준 못 쟀다" 를 나란히★ 띄우고 있었다.
     V33.408 이 "이 숫자는 같은 사건을 여러 번 센 것" 이라고 판정한 바로 그 값을,
     승격만 막고 ★표시로는 그대로 내보냈다.★ 자기모순이고, 사람이 그걸 보고 판단한다.
     (거래 경로는 trusted·wGbdt 로 막혀 있어 돈에는 안 닿았다 — 틀린 것은 ★표시★ 였다.)

   ■ 그리고 더 나쁜 것 — 막기만 하고 길을 안 열어 뒀다
     실측: [GBDT] 겹치지 않는 블록 ★2개★ < 4. 달력 분할이 요구하는 이력은 120일인데
     trainWindow 60,000행이 달력으로 ★약 100일★ 이라 한 번도 안 걸렸다.
     즉 GBDT 는 ★영구 미승격★ 이었다. 위원회 최대 지분을 비워 놓고 그대로 둘 수는 없다.
     ★문턱은 한 칸도 안 깎는다★ — 대신 (a) 고르는 쪽은 블록이 필요 없으니 짧게,
     (b) 홀드아웃을 ★날짜로★ 따로 긁어 달력 길이를 행 예산에서 떼어낸다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const D = 86400000;

console.log("① ★못 쟀으면 하한을 내보내지 않는다★ (BC-1 — 사용자가 본 그 오류)");
{
  const i = S.indexOf("if (_blk.lb == null) {");
  const blk = strip(S.slice(i, i + 1400));
  chk(/trust\.gbdtAccLB = null;/.test(blk),
    "못 쟀으면 gbdtAccLB 를 ★null★ 로 둔다 — 숫자를 만들지 않는다",
    "★못 쟀다면서 행 기반 하한을 그대로 내보낸다 — 화면이 '70.1% · 못 쟀다' 를 나란히 띄운다★");
  chk(/trust\.gbdtAccLBRow = trust\.gbdtAccLB;/.test(blk),
    "행 기반 값은 ★버리지 않고★ 이름을 붙여 남긴다(진단용)",
    "★행 기반 값을 통째로 버린다 — 얼마나 부풀었는지 다음 사람이 못 본다★");
  const iRow = blk.indexOf("trust.gbdtAccLBRow"), iNull = blk.indexOf("trust.gbdtAccLB = null");
  chk(iRow > 0 && iNull > iRow,
    "순서가 맞다 — ★남긴 뒤에★ 지운다(먼저 지우면 null 을 남기게 된다)",
    "★null 을 먼저 넣고 그 뒤에 남긴다 — 진단칸이 null 이 된다★");
  chk(/trust\.accLBWhy = /.test(blk), "왜 못 쟀는지 사유를 남긴다", "★사유가 없다 — 화면이 '미학습' 으로 뭉갠다★");
  // 위원회 표 두 곳 모두 숫자를 만들어 내지 않는다(한 곳만 고치면 두 화면이 갈린다)
  const rows = [...S.matchAll(/committee\w*\.push\(\{ name: "GBDT"/g)];
  chk(rows.length === 2, "GBDT 위원회 행이 두 곳이다(" + rows.length + ")", "구조가 바뀌었다 — 이 검사를 다시 세울 것");
  for (const m of rows) {
    const seg = S.slice(m.index, m.index + 420);
    chk(/gtrust\.gbdtAccLB == null && gtrust\.accLBWhy\) \? null/.test(seg),
      "그 행이 못 잰 경우 ★acc 를 null★ 로 둔다",
      "★못 잰 경우 gbdtAcc(행 기반 관측치)로 떨어진다 — 또 다른 숫자를 세워 같은 오해를 만든다★");
    chk(/accWhy: gtrust\.accLBWhy/.test(seg), "그 행이 사유를 함께 싣는다", "★사유 없이 빈칸만 보낸다★");
  }
}

console.log("\n② ★영원히 못 재게 두지 않는다★ (BC-2) — 문턱은 한 칸도 안 깎는다");
{
  const hd = 10;
  const mk = (days) => {
    const t0 = Date.parse("2026-01-01T00:00:00Z"), a = [];
    for (let d = 0; d < days; d++) for (let i = 0; i < 600; i++) a.push({ ts: t0 + d * D, y: i & 1, x: [] });
    return a;
  };
  // 실측 상황: 이력 약 100일. 종전(needA=30)이면 120일이 필요해 ★한 번도 안 걸렸다★
  const sp = M._gbdtCalSplit(mk(110), hd, M.GBDT.minTrainSamples, 20);
  chk(!!(sp.a && sp.b), "이력 110일에서 달력 분할이 ★성립한다★ (" + (sp.mode || sp.why) + ")",
    "★110일에서도 안 걸린다(" + sp.why + ") — 실측 이력(약 100일)에서는 영원히 못 잰다★");
  chk(sp.need <= 100, "필요 이력 " + sp.need + "일 ≤ 100일 — 실측 구간이 닿는다",
    "★필요 이력이 " + sp.need + "일이라 실측(약 100일)이 못 닿는다★");
  if (sp.b) {
    const k = M._blockAccLB(sp.b.map(() => 1), sp.b.map(o => o.ts), hd * D);
    chk(k.lb != null && k.k >= M.BLKACC.minBlocks,
      "★채점 구간은 한 칸도 안 줄었다★ — 블록 " + k.k + "개 ≥ 최소 " + M.BLKACC.minBlocks + "개",
      "★채점 구간이 " + k.k + "블록으로 줄었다 — 문턱을 깎아서 통과시킨 것이다★");
    const evalD = Math.round((sp.b[sp.b.length - 1].ts - sp.b[0].ts) / D);
    chk(evalD >= (M.BLKACC.minBlocks + 1) * hd,
      "채점 구간 " + evalD + "일 ≥ " + ((M.BLKACC.minBlocks + 1) * hd) + "일",
      "★채점 구간이 " + evalD + "일로 짧아졌다★");
  } else fails += 2;
  chk(/const _needB = \(_num\(BLKACC\.minBlocks, 4\) \+ 2\) \* _hd;/.test(S),
    "채점 구간은 여전히 (minBlocks+2)×지평 이다(상수를 안 박았다)",
    "★채점 구간 식이 바뀌었다★");
  chk(/const _needA = _hd;/.test(S),
    "고르는 쪽만 ★라벨 지평 한 칸★ 으로 줄였다(블록이 필요 없는 쪽이다)",
    "★고르는 쪽이 여전히 길다 — 그게 실측 이력을 못 닿게 한 원인이다★");
  // 홀드아웃을 ★날짜로★ 따로 긁는가 — 달력 길이가 행 예산의 부산물이면 안 된다
  const g = S.slice(S.indexOf("async function mlGBDTTrainNightly("), S.indexOf("async function mlGBDTTrainNightly(") + 9000);
  chk(/_GCOLS \+ " WHERE featver = \? AND ts >= \? AND ts < \? ORDER BY ts DESC LIMIT \?"/.test(g),
    "홀드아웃을 ★날짜 구간★ 으로 칸을 나눠 긁는다 — 기간이 행 예산에 안 묶인다",
    "★여전히 한 방 LIMIT 질의다 — 관측 기간이 수확량의 부산물이 된다★");
  chk(/_GCOLS \+ " WHERE featver = \? AND ts < \? ORDER BY ts DESC LIMIT \?"/.test(g),
    "학습은 그 앞에서 ★엠바고를 뗀 뒤★ 따로 긁는다",
    "★학습과 홀드아웃이 안 갈렸다 — 경계가 샌다★");
  chk(/if \(!raw\.length\) \{[\s\S]{0,300}ORDER BY ts DESC LIMIT \?"\)/.test(g),
    "달력 질의가 안 되면 ★종전 한 방 질의로 물러선다★(회귀 안전)",
    "★폴백이 없다 — 질의가 실패하면 학습이 통째로 멈춘다★");
  chk(/_tr\.length >= GBDT\.minTrainSamples/.test(g),
    "달력으로 갈랐을 때 ★학습이 굶으면 쓰지 않는다★",
    "★학습 표본 보호가 없다★");
}

console.log("\n②-1 ★고르는 쪽이 비어도 달력 분할이 살아남는가★ (BF-1 — 실측이 잡은 자리)");
{
  /* 실측(회차 35796753007): 홀드아웃=행기반 ★(한쪽이 얇다(0/7555))★ —
     calA 로 잡은 10일 창에 표본이 ★한 줄도 없었다.★ 수확·소급 적재는 날짜별로 고르지 않아
     중간에 빈 구간이 생긴다. 고르는 쪽은 임계값 하나를 고를 뿐이라 ★날짜가 아니라 행★ 이 필요하다. */
  const hd = 10, D3 = 86400000, T3 = Date.parse("2026-01-01T00:00:00Z");
  const holed = [];
  for (let d = 0; d < 200; d++) {
    if (d >= 130 && d < 140) continue;              // ★60~70일 전 구간이 통째로 비어 있다★
    for (let j = 0; j < 300; j++) holed.push({ ts: T3 + d * D3, y: j & 1, x: [] });
  }
  const r = M._gbdtCalSplit(holed, hd, M.GBDT.minTrainSamples, 20);
  chk(!!(r.a && r.b),
    "고르는 쪽 날짜 창이 비어 있어도 ★분할이 성립한다★ (" + (r.mode || r.why) + ")",
    "★빈 날짜 창 하나 때문에 달력 분할이 통째로 무산된다(" + r.why + ") — 실측 그대로다★");
  if (r.b) {
    const k = M._blockAccLB(r.b.map(() => 1), r.b.map(o => o.ts), hd * D3);
    chk(k.lb != null && k.k >= M.BLKACC.minBlocks,
      "★채점 쪽은 여전히 날짜로 자른다★ — 블록 " + k.k + "개 ≥ " + M.BLKACC.minBlocks,
      "★채점 쪽까지 행으로 잘랐다 — 블록 " + k.k + "개로 못 잰다★");
    chk(r.a.length > 0 && r.a[r.a.length - 1].ts < r.b[0].ts,
      "고르는 쪽이 채점 쪽보다 ★앞★ 이다(누출 없음)",
      "★두 구간이 겹친다 — 고른 임계값으로 자기를 채점한다★");
  } else fails += 2;
  chk(/const _a = _before\.slice\(Math\.max\(0, _before\.length - _aWant\)\);/.test(S),
    "고르는 쪽을 ★경계 바로 앞의 행★ 으로 센다(빌 수가 없다)",
    "★고르는 쪽을 여전히 날짜 창으로 잡는다★");
  chk(/const _b = data\.filter\(function \(d\) \{ return _num\(d\.ts, 0\) >= _mid; \}\);/.test(S),
    "채점 쪽은 ★날짜★ 로 자른다(블록이 필요하다)", "★채점 쪽이 행 기반이 됐다★");
}

console.log("\n②-1b ★시계가 무엇을 재는지 적는가★ (BF-2 — 'CV 0s' 를 '안 돌았다' 로 읽지 않게)");
{
  /* 실측: 시간[적재 7s · CV ★0s★ · 최종 ★0s★] — CV 가 폴드마다 나무 ~160그루를 세우고도 0ms.
     계측이 틀린 게 아니라 ★워커의 Date.now() 는 순수 계산 중에 안 움직인다★(I/O 때만 밀린다).
     그래서 이 저장소의 CPU 예산 가드는 순수 계산을 못 막는다 — 나무 0개 사고가 그 모양이었다. */
  chk(/시간\[I\/O기준 · 적재 /.test(S),
    "시간 내역에 ★I/O기준★ 이라고 못 박는다",
    "★그냥 '시간' 이라 적는다 — CPU 시간으로 읽힌다★");
  chk(/0s = 계측 불가, 미실행 아님/.test(S),
    "0s 가 ★미실행이 아니라 계측 불가★ 임을 적는다",
    "★0s 를 설명하지 않는다 — 다음 사람이 'CV 가 안 돌았다' 로 읽는다★");
  chk(/워커 시계가 안 움직인다/.test(S),
    "왜 0s 인지(순수 계산 중 시계 정지)를 적는다", "★이유를 안 적는다★");
}

console.log("\n②-2 ★나무 0개 모델은 저장하지 않는다★ (BD-1 — 실측이 잡은 자리)");
{
  /* 실측(회차 35688362304): [GBDT] ★trees=0★ n=67653 OOF=48.6%(하한 47.0%)
     _gbdtFit 의 마감 검사는 루프 ★맨 위★ 라, 최종 적합 시작 시 이미 예산이 지나 있으면
     한 그루도 못 세우고 break 한다 — 그래도 모델은 저장됐다. 그 모델은 상수만 돌려주는데
     화면의 정확도는 ★CV 폴드 모델★ 의 값이다: 저장된 물건과 보고된 숫자가 다른 것을 가리킨다. */
  const g = S.slice(S.indexOf("async function mlGBDTTrainNightly("));
  const iGuard = g.indexOf("if (!model.trees || model.trees.length === 0) {");
  const iSave = g.indexOf('await setState(DB, "gbdt_model", model)');
  chk(iGuard > 0, "나무 0개를 ★검사한다★", "★나무가 0개여도 그대로 저장한다 — 상수 모델이 위원이 된다★");
  chk(iGuard > 0 && iSave > iGuard,
    "그 검사가 ★저장보다 앞★ 이다", "★검사가 저장 뒤다 — 이미 저장된 뒤에 막아도 소용없다★");
  if (iGuard > 0) {
    let d = 0, blk = "";
    for (let k = g.indexOf("{", iGuard); k < g.length && k > 0; k++) {
      if (g[k] === "{") d++; else if (g[k] === "}") { d--; if (!d) { blk = g.slice(iGuard, k + 1); break; } }
    }
    chk(/return "\[GBDT\] " \+ _why;/.test(blk), "그 자리에서 ★멈춘다★", "★멈추지 않고 계속 간다★");
    chk(/gbdtAccLB: null/.test(blk),
      "하한을 ★null★ 로 둔다 — CV 폴드 숫자를 이 물건의 성적처럼 내보내지 않는다",
      "★CV 폴드에서 나온 숫자를 저장 안 된 모델의 성적으로 내보낸다★");
    chk(/trusted: false/.test(blk) && !/wGbdt: [^0]/.test(blk), "지분을 주지 않는다", "★지분을 준다★");
  }
  // 적재량이 늘어나면 같은 일이 또 난다 — 총량을 종전과 같게 묶는가
  chk(/_num\(LUXML\.trainWindow, 60000\) - _hold\.length/.test(g),
    "달력 분할이 ★데이터량을 늘리지 않는다★ — 학습 한도에서 홀드아웃만큼 뺀다",
    "★홀드아웃을 trainWindow 위에 얹는다 — 적재가 길어져 최종 적합이 예산을 넘긴다(trees=0 의 원인)★");
}

console.log("\n②-3 ★60% 를 절대값으로 쓰지 않는가★ (BD-2 — 내가 만든 함정에 내가 빠졌다)");
{
  /* 실측: [DUAL-BULL] 발언점[★68.4%★ · 적용률 100%] — 그런데 ★무실력 74.7%★ 다.
     다수클래스만 찍어도 74.7% 인데 68.4% 를 "목표 60% 통과" 로 판정했다.
     쏠린 라벨에서 60% 는 ★실력의 증거가 아니라 무능의 증거★ 다. */
  const D2 = 86400000, T0 = Date.parse("2026-01-01T00:00:00Z");
  const mk = (n, acc, pos, seed) => {
    let s2 = seed || 7;
    const r = () => (s2 = (s2 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const p = [], y = [], t = [];
    for (let i = 0; i < n; i++) {
      const truth = r() < pos ? 1 : 0, ok = r() < acc;
      p.push(ok ? (truth ? 0.8 : 0.2) : (truth ? 0.2 : 0.8));
      y.push(truth); t.push(T0 + Math.floor(i / 80) * D2);
    }
    return { p, y, t };
  };
  const A = mk(6000, 0.684, 0.747, 11), B = mk(6000, 0.684, 0.747, 22);
  const r = M._speakPoint(A.p, A.y, B.p, B.y, B.t, 10 * D2, M.SPEAK);
  chk(!r.ok, "무실력 74.7% 구간의 68.4% 모델을 ★미달로 잡는다★ — " + (r.why || "").slice(0, 60),
    "★무실력보다 낮은 모델을 '목표 60% 통과' 로 내보낸다 — 숫자만 60% 로 만드는 그 함정이다★");
  chk(/무실력/.test(r.why || ""), "사유에 ★무실력★ 을 적는다", "★왜 미달인지 기저율을 안 적는다★");
  // 기저율이 낮은 구간에서는 종전대로 60% 가 문턱이다(과하게 막지 않는가)
  const C1 = mk(6000, 0.70, 0.50, 33), C2 = mk(6000, 0.70, 0.50, 44);
  const r2 = M._speakPoint(C1.p, C1.y, C2.p, C2.y, C2.t, 10 * D2, M.SPEAK);
  chk(r2.ok, "기저율 50% 구간의 70% 모델은 ★통과한다★(과하게 막지 않는다) — " +
    (r2.ok ? "하한 " + (r2.lb * 100).toFixed(1) + "% · 무실력 " + (r2.base * 100).toFixed(1) + "%" : r2.why),
    "★실력이 있는 모델까지 막는다(" + (r2.why || "") + ")★");
  chk(M.SPEAK.baseMargin > 0, "무실력 대비 여유 " + M.SPEAK.baseMargin + " 가 살아 있다",
    "★여유가 0 이다 — 무실력과 동률이면 통과한다★");
  /* ★두 구간의 쏠림이 다르면?★ 캘리브레이션은 균형(50%)인데 홀드아웃이 쏠려 있으면(85%),
     고르는 쪽 검사는 통과하고 ★재는 쪽만★ 남는다. 거기가 절대 60% 면 무능이 통과한다.
     (돌연변이 D5 가 정확히 이 자리로 빠져나갔다 — 앞 관문이 가려 주고 있었을 뿐이다.) */
  {
    const cal = mk(6000, 0.70, 0.50, 55);        // 고르는 쪽: 균형 · 실력 있음
    const hol = mk(6000, 0.66, 0.85, 66);        // 재는 쪽: 크게 쏠림 → 무실력 85%
    const r3 = M._speakPoint(cal.p, cal.y, hol.p, hol.y, hol.t, 10 * D2, M.SPEAK);
    chk(!r3.ok,
      "고르는 쪽이 균형이어도 ★재는 쪽의 쏠림★ 을 다시 본다 — " + (r3.why || "").slice(0, 70),
      "★재는 쪽 무실력(85%)을 안 보고 절대 60% 로 통과시킨다 — 앞 관문이 가려 준 자리다★");
    chk(r3.base == null || r3.base > 0.7 || /무실력/.test(r3.why || ""),
      "그 판정이 ★재는 쪽 기저율★ 을 근거로 삼는다",
      "★기저율을 안 적는다★");
  }
  chk(/const need = Math\.max\(target, _maj\(ys\) \+ bMar\);/.test(S),
    "캘리브레이션 쪽도 ★둘 중 큰 쪽★ 을 문턱으로 쓴다",
    "★고르는 쪽은 절대 60% 만 본다 — 거기서 이미 잘못 고른다★");
  chk(/무실력 " \+ \(\(_num\(sp\.base, 0\)\) \* 100\)/.test(S),
    "표기에 ★무실력★ 과 ★문턱★ 을 같이 적는다", "★하한만 적어 60% 가 좋아 보이게 둔다★");
}

console.log("\n②-4 ★최종 적합이 굶지 않는가★ (BE-1 — 화면의 'GBDT 모델 없음' 이 여기서 났다)");
{
  /* 실측: [GBDT] ★trees=0★ · 단계 전체 ★326초★(예산 90초).
     _gbdtFit 의 마감 검사는 루프 맨 위라, 최종 적합 시작 시 deadline 이 이미 지나 있으면
     한 그루도 못 세운다. V33.414 가 그런 모델의 ★저장★ 은 막았지만, 막기만 하면 GBDT 는
     영원히 "모델 없음" 이다 — roster 의 gStored 가 ★gtrees > 0★ 으로 판정하기 때문이다.
     ★막는 것과 되게 하는 것은 다른 일이다.★ */
  chk(/const _finalDL = Math\.max\(deadline, Date\.now\(\) \+ _num\(GBDT\.finalMinMs, 25000\)\);/.test(S),
    "최종 적합에 ★지금부터★ 최소 시간을 보장한다(절대 deadline 은 이미 지났을 수 있다)",
    "★최종 적합이 이미 지난 deadline 을 그대로 쓴다 — 나무 0개가 다시 난다★");
  chk(/deadline: _finalDL/.test(S), "그 보장을 ★실제로 넘긴다★", "★보장을 만들고 안 쓴다★");
  chk(M.GBDT.finalMinMs >= 15000,
    "보장 시간 " + M.GBDT.finalMinMs + "ms ≥ 15s",
    "★보장 시간이 " + M.GBDT.finalMinMs + "ms 로 너무 짧다 — 나무를 못 세운다★");
  // 화면이 "모델 없음" 이라고 읽는 그 술어를 못 박는다(둘이 갈리면 또 헷갈린다)
  chk(/const gStored = !!\(probe && _num\(probe\.gtrees, 0\) > 0\);/.test(S),
    "화면은 ★나무 수★ 로 모델 유무를 판정한다 — 나무 0개면 '모델 없음' 이 맞다",
    "구조가 바뀌었다 — 이 검사를 다시 세울 것");
  chk(/적재 " \+ Math\.round\(_gbLoadMs/.test(S) && /_gbCvMs/.test(S) && /_gbFitMs/.test(S),
    "적재·CV·최종 시간을 ★갈라서★ 적는다(326초가 어디로 갔는지 추측하지 않는다)",
    "★시간을 안 가른다 — 다음에도 추측하게 된다★");
  chk(/나무 " \+ _num\(model\.nTrees, 0\) \+ "그루\/목표 " \+ fixedTrees/.test(S),
    "몇 그루를 목표로 몇 그루가 섰는지 적는다", "★나무 수를 안 적는다★");
  /* ★만드는 것과 싣는 것은 다른 일이다.★ 이 검사에서 "선언만 보고 사용을 안 본" 실수가
     이번 판에만 ★세 번★ 났다(flag · fwdTrust · 여기). 두 줄을 같이 두는 것을 규칙으로 삼는다. */
  chk(/_speakNote\(model\.speak\) \+ _gbTimeNote;/.test(S),
    "그 시간 내역을 ★완료 로그에 실제로 싣는다★",
    "★시간 내역을 만들어 놓고 로그에 안 싣는다 — 화면엔 안 나온다★");
  chk(/_gbTimeNote \+ " — ★상수 모델을 저장하지 않는다★"/.test(S),
    "나무 0개로 멈출 때도 ★그 사유에 시간 내역을 싣는다★(원인을 바로 본다)",
    "★멈출 때 시간 내역이 빠진다 — 왜 못 세웠는지 화면이 답을 못 한다★");
}

console.log("\n③ ★'잡음과 구별 안 됨' 을 '왜' 로 바꾼다★ (BC-3)");
{
  // 실측: FLOW 풀드 +0.0155 / 블록 −0.0589 — 부호가 갈린다. 잡음이 아니라 구조다.
  const n1 = M._simpsonNote(0.0155, -0.0589);
  chk(/날짜 사이에서만 맞는다/.test(n1), "풀드>0>블록 이면 ★뜻을 말로 적는다★ — " + n1.trim().slice(0, 40) + "…",
    "★부호가 갈려도 아무 말 안 한다 — 다음 사람이 또 '잡음인가 보다' 로 읽는다★");
  chk(M._simpsonNote(0.0295, 0.0345) === "", "부호가 같으면 ★아무 말 안 한다★(잡소리를 안 만든다)",
    "★부호가 같은데도 경고를 낸다★");
  chk(M._simpsonNote(0, 0) === "" && M._simpsonNote(null, null) === "",
    "잴 수 없으면 조용하다", "★없는 것에 대해 말한다★");
  // 종목을 가리키는 칸 — 분산분해가 실제로 맞는가
  const X = [], Sy = [];
  for (let i = 0; i < 400; i++) for (let t = 0; t < 20; t++) {
    Sy.push("S" + i);
    X.push([i / 400, Math.sin(t) / 2 + 0.5, i / 400 + (t % 2) * 1e-5]);
  }
  const w = M._withinSymbolShare(X, Sy, 3, 0, X.length);
  chk(w.cols.length === 3 && w.cols[0] < 0.05 && w.cols[1] > 0.9 && w.cols[2] < 0.05,
    "분산분해가 맞다 — 종목고정 " + w.cols[0] + " · 시간변동 " + w.cols[1] + " · 거의고정 " + w.cols[2],
    "★분산분해가 틀렸다(" + w.cols.join(",") + ")★");
  chk(w.staticN === 2, "정적 칸을 " + w.staticN + "개 짚는다", "★정적 칸을 못 짚는다(" + w.staticN + ")★");
  // ★학습 구간만 본다★ — 홀드아웃을 보면 또 다른 누출이다
  const half = M._withinSymbolShare(X, Sy, 3, 0, Math.floor(X.length / 2));
  chk(half.n === Math.floor(X.length / 2), "구간을 받아 ★그 안만★ 센다(n=" + half.n + ")",
    "★구간 인자를 무시하고 전 구간을 센다 — 홀드아웃을 보게 된다★");
  chk(/_withinSymbolShare\(X, S, D, 0, ntr\)/.test(S),
    "학습기가 ★0..ntr(학습행)★ 만 넘긴다 — 홀드아웃을 안 본다",
    "★홀드아웃까지 넘긴다 — 진단이 검증 구간을 엿본다★");
  chk(/정적칸 " \+ _wss\.staticN/.test(S) && /opts\.featNames && opts\.featNames\[o\.j\]/.test(S),
    "로그가 정적 칸 수와 ★이름★ 을 적는다(번호만 적으면 아무도 안 고친다)",
    "★정적 칸을 안 적거나 번호만 적는다★");
  chk(/_speakNote\(_speak\) \+ _simp \+/.test(S), "심프슨 진단이 학습완료 줄에 실린다", "★진단을 만들고 안 싣는다★");
}

console.log("\n③-2 ★정적 칸을 빼면 나아지는가 — 주장하지 말고 잰다★ (BD-3)");
{
  const g = S.slice(S.indexOf("async function _miniLogisticTrain("));
  chk(/_altNote = " ★정적칸빼면★\[블록IC "/.test(g),
    "정적 칸을 중립화한 ★팔★ 을 하나 더 돌려 숫자를 남긴다",
    "★정적 칸을 짚어 놓고 '빼면 나아진다' 를 재지 않는다 — 다음 판이 또 추측한다★");
  chk(/보고만 한다\(운영 모델은 그대로\)/.test(g),
    "그 팔이 ★보고만 한다★ 고 로그에 못 박는다(운영 모델을 안 바꾼다)",
    "★실험 팔인지 운영 변경인지 로그가 구분 안 된다★");
  // ★운영 경로가 안 바뀌었는가★ — 실험 팔이 모델·게이트에 닿으면 안 된다
  const noStr = t => t.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  /* ★문장 단위로 본다.★ 문맥 창을 뜨면 자른 자리가 낱말 가운데라 `_gb = 0` 의 "b = 0" 이
     `\bb\s*=` 에 걸리는 식의 거짓양성이 난다(실제로 한 번 났다).
     계약은 "실험 팔의 값이 ★운영 이름에 대입되지 않는다★" 이므로 대입문만 보면 된다. */
  const gg = noStr(strip(g));
  const stmts = gg.split(/[;\n]/);
  const OPER = /^\s*(?:const |let |var )?(model(?:\.\w+)?|w|b|pv|acc|ic|_bIC|_tv|_st|valAcc|valIC)\s*=[^=]/;
  const leak = stmts.filter(st => /_w2|_b2|_pv2|_st2/.test(st) && OPER.test(st))
                    .map(st => st.trim().slice(0, 90));
  chk(leak.length === 0,
    "실험 팔(_w2·_pv2·_st2)이 ★운영 이름에 대입되지 않는다★",
    "★실험 팔이 운영 경로에 닿는다: " + leak.slice(0, 1).join("") + "★");
  // 그리고 실험 팔은 ★자기 변수에만★ 쓴다 — 운영 변수를 덮어쓰지 않는가(반대 방향도 확인)
  chk(!/(?:^|[;\n])\s*(?:model|pv|acc|_st|_bIC)\b[^;\n]*=\s*_(?:w2|b2|pv2|st2)\b/.test(gg),
    "운영 변수가 실험 팔에서 값을 받지 않는다", "★운영 변수가 실험 팔 값을 받는다★");
  chk(/if \(_wss && _wss\.staticN > 0 && _wss\.staticN < D/.test(g),
    "정적 칸이 없거나 ★전부★ 정적이면 안 돌린다(빈 모델을 만들지 않는다)",
    "★정적 칸이 0개거나 D개여도 돌린다 — 뜻 없는 숫자를 만든다★");
  chk(/_st2 && _st2\.blockIC != null/.test(g),
    "그 팔도 ★블록(사건) 기반★ 으로만 적는다", "★행 기반 숫자를 적는다★");
}

console.log("\n④ ★문턱은 한 톨도 안 건드렸는가★");
{
  const floors = { GBDT: M.GBDT.trustFloor, DNN: M.DNN.trustFloor, MIND: M.MIND.trustFloor };
  for (const [n, v] of Object.entries(floors))
    chk(v === 0.505, n + " 문턱 0.505 그대로", "★" + n + " 문턱이 " + v + " 로 바뀌었다★");
  chk((S.match(/trustFloor: 0\.505/g) || []).length === 4, "trustFloor 0.505 리터럴 4개", "★어딘가 낮췄다★");
  chk(M.BLKACC.minBlocks >= 4, "최소 블록 " + M.BLKACC.minBlocks + "개 그대로", "★최소 블록이 낮아졌다★");
  chk(M.ICGATE.tMin >= 2.5, "IC t 문턱 " + M.ICGATE.tMin + " 그대로", "★IC t 문턱이 낮아졌다★");
  chk(M.SPEAK.target >= 0.60, "발언 목표 " + (M.SPEAK.target * 100).toFixed(0) + "% 그대로", "★목표가 낮아졌다★");
}

console.log(fails === 0 ? "\n✓ GBDT 하한 표시·측정가능성 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
