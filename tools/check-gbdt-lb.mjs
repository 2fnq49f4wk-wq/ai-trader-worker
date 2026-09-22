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
