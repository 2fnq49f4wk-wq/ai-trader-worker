/* ═══════════════════════════════════════════════════════════════════════════
   [V33.411] ★"모든 모델 60% 이상" 을 정직하게 만드는 유일한 길 — 기권★

   ■ 사용자 요구 (2026-09-22)
     "신뢰도가 50%밖에 안 나온다. 최소한 모든 모델이 60% 이상 나오게 설계해라. 너무 낮다."
     요구는 옳다 — 50% 짜리 위원이 실제 돈에 표를 던지면 안 된다.
     문제는 ★어떻게★ 다. 부정한 길이 셋 있고, 이 검사가 전부 막는다:
       · 검증 하한을 낮춘다            → ⑤ 가 문턱 상수를 전수 확인한다
       · 데드밴드를 홀드아웃까지 건다  → check-deadband ① 이 막는다
       · 상관된 행을 독립으로 센다     → ③ 이 블록(사건) 기반을 강제한다

   ■ 이 저장소가 ★이미 측정해 둔 벽★ (라벨 실험대)
       스윙 10일 sign      DNN 49.3% · 부스터 52.2~52.5% · IC 0.003~0.032
       단타 60분 삼중배리어 ★57.0%(하한 56.0%)★ · IC 0.207
     "완전히 다른 모델족이 같은 벽에 부딪히면 그 벽은 모델이 아니라 ★라벨·지평★ 이다."
     ★전 구간 10일 방향에서 60% 는 모델을 고쳐서 될 일이 아니다.★

   ■ 정직한 길
     매매는 모든 종목을 맞힐 필요가 없다 — ★확신하는 건만 잡고 나머지는 기권한다.★
     실험대 자신의 규율: "40%만 판정하고 60% 맞힌다" vs "전부 판정하고 52%" 중
     무엇이 나은지는 ★기대수익★ 이 정한다 — 그래서 ★적용률을 반드시 같이 적는다.★
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const D = 86400000, T0 = Date.parse("2026-01-01T00:00:00Z");
/* 확신도가 높을수록 잘 맞는 합성 데이터 — 실제 모델이 가진 성질이다(안 그러면 기권이 무의미하다).
   하루에 50건씩 쌓아 블록이 생기게 한다. rng 는 결정적이어야 검사가 재현된다. */
/* ★실제 모델의 모양을 흉내낸다★ — 확신이 낮은 구간은 ★동전던지기★ 이고, 위쪽에서만
   실력이 난다. 전 구간 평균은 60% ★아래★ 여야 한다(그래야 기권이 값을 하는지 보인다).
   처음엔 모든 확신도에 실력을 깔았더니 적용률 100% 로 통과해 검사가 아무것도 못 걸렀다. */
const mk = (n, edge, seed) => {
  const p = [], y = [], t = [];
  let s = seed || 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < n; i++) {
    const c = rnd();                                  // 확신도 0~1
    const pr = 0.5 + c * 0.45 * (rnd() < 0.5 ? 1 : -1);
    const lift = c <= 0.6 ? 0 : (c - 0.6) / 0.4;      // 0.6 아래는 실력 0(동전던지기)
    const acc = Math.min(0.97, 0.5 + edge * lift);
    const pred = pr >= 0.5 ? 1 : 0;
    y.push(rnd() < acc ? pred : 1 - pred);
    p.push(pr); t.push(T0 + Math.floor(i / 50) * D);
  }
  return { p, y, t };
};

console.log("① ★문턱을 고른 자리에서 재지 않는가★ (선택 편향)");
{
  const A = mk(6000, 0.45, 12345), B = mk(6000, 0.45, 99991);
  const r = M._speakPoint(A.p, A.y, B.p, B.y, B.t, 10 * D, M.SPEAK);
  chk(r.tau != null, "캘리브레이션에서 문턱을 고른다 (τ=" + r.tau + ")", "★문턱을 못 고른다 — " + r.why + "★");
  // 홀드아웃을 ★통째로 뒤집어도★ 문턱은 그대로여야 한다(홀드아웃이 선택에 안 쓰였다는 뜻)
  const Bx = { p: B.p, y: B.y.map(v => 1 - v), t: B.t };
  const r2 = M._speakPoint(A.p, A.y, Bx.p, Bx.y, Bx.t, 10 * D, M.SPEAK);
  chk(r.tau === r2.tau,
    "홀드아웃 라벨을 ★전부 뒤집어도★ 문턱이 안 바뀐다 (" + r.tau + ") — 고르는 데 안 썼다",
    "★홀드아웃이 문턱 선택에 스며든다 — 고른 자리에서 재는 것이다★");
  chk(r2.ok === false, "뒤집힌 홀드아웃은 ★통과하지 못한다★ (" + (r2.why || "") + ")",
    "★성적이 뒤집혔는데도 통과시킨다 — 재는 시늉만 하는 것이다★");
}

console.log("\n② ★기권이 실제로 정확도를 올리는가★ · ★못 하면 못 한다고 말하는가★");
{
  const A = mk(6000, 0.45, 12345), B = mk(6000, 0.45, 99991);
  const r = M._speakPoint(A.p, A.y, B.p, B.y, B.t, 10 * D, M.SPEAK);
  let all = 0; for (let i = 0; i < B.p.length; i++) if (((B.p[i] >= 0.5) ? 1 : 0) === B.y[i]) all++;
  const allAcc = all / B.p.length;
  chk(r.acc != null && r.acc > allAcc,
    "발언 구간 " + (r.acc * 100).toFixed(1) + "% > 전 구간 " + (allAcc * 100).toFixed(1) + "% — 기권이 실제로 값을 한다",
    "★발언 구간이 전 구간보다 안 낫다 — 기권 기준이 확신과 무관하다★");
  chk(r.cov > 0 && r.cov < 1, "적용률이 " + (r.cov * 100).toFixed(1) + "% 로 ★1 미만★ 이다(정말 기권한다)",
    "★전부 발언한다 — 기권이 일어나지 않았다★");
  // 신호가 전혀 없으면 ★못 넘었다고★ 말해야 한다 — 문턱을 깎아 맞추면 안 된다
  const F = mk(6000, 0.0, 777);
  const rf = M._speakPoint(F.p, F.y, F.p, F.y, F.t, 10 * D, M.SPEAK);
  chk(!rf.ok && rf.tau == null,
    "신호가 없으면 ★목표를 못 넘었다고 말한다★ (" + rf.why + ")",
    "★실력이 없는데 통과시킨다★");
  // 살짝 모자란 경우도 통과시키면 안 된다(경계에서 무너지지 않는가)
  const N1 = mk(6000, 0.14, 4242), N2 = mk(6000, 0.14, 5353);
  const rn = M._speakPoint(N1.p, N1.y, N2.p, N2.y, N2.t, 10 * D, M.SPEAK);
  chk(!rn.ok, "목표에 못 미치는 모델도 ★미달로 잡는다★ (" + (rn.why || "") + ")",
    "★목표 근처를 통과시킨다★");
}

console.log("\n③ ★하한이 사건 기반인가★ — 상관된 행을 독립으로 세면 V33.408 의 70.1% 가 다시 난다");
{
  const A = mk(6000, 0.45, 12345);
  const one = { p: [], y: [], t: [] };                // 홀드아웃 전체가 ★같은 날★
  for (let i = 0; i < 6000; i++) { one.p.push(A.p[i]); one.y.push(A.y[i]); one.t.push(T0); }
  const r = M._speakPoint(A.p, A.y, one.p, one.y, one.t, 10 * D, M.SPEAK);
  chk(!r.ok && /블록/.test(r.why || ""),
    "홀드아웃이 하루뿐이면 ★못 쟀다고 한다★ — " + r.why,
    "★한 사건을 6,000 관측으로 세어 통과시킨다 — 고친 그 버그를 다시 만든 것이다★");
  chk(/const blk = _blockAccLB\(bh, bt, horizonMs\);/.test(S),
    "하한을 _blockAccLB 로 잰다", "★행 기반 Wilson 으로 잰다 — 부풀어 오른다★");
  chk(!/out\.lb = \+_wilsonLB\(/.test(S), "발언 하한에 행 기반 Wilson 을 쓰지 않는다",
    "★발언 하한이 행 기반이다★");
}

console.log("\n④ ★적용률을 빼고 적지 않는가★ · ★침묵을 위원으로 세지 않는가★");
{
  const A = mk(6000, 0.45, 12345), B = mk(6000, 0.45, 99991);
  const r = M._speakPoint(A.p, A.y, B.p, B.y, B.t, 10 * D, M.SPEAK);
  const note = M._speakNote(r);
  chk(/적용률/.test(note), "표기에 ★적용률★ 이 항상 들어간다 — " + note.trim(),
    "★정확도만 적고 적용률을 뺀다 — 실험대가 못 박은 규율 위반이다★");
  chk(/적용률/.test(M._speakNote({ ok: false, cov: 0.03, lb: 0.62, why: "적용률 3.0% < 최소 10%" })),
    "미달일 때도 적용률을 적는다", "★미달 사유에 적용률이 없다★");
  // 적용률이 바닥이면 60% 라도 통과하면 안 된다
  const cfg = Object.assign({}, M.SPEAK, { minCoverage: 0.9 });
  const rc = M._speakPoint(A.p, A.y, B.p, B.y, B.t, 10 * D, cfg);
  chk(!rc.ok && /적용률/.test(rc.why || ""),
    "적용률 하한을 못 넘으면 ★60% 라도 미달★ — " + rc.why,
    "★거의 말을 안 하는 모델을 위원으로 통과시킨다★");
  chk(M.SPEAK.minCoverage > 0, "적용률 하한 " + (M.SPEAK.minCoverage * 100).toFixed(0) + "% 가 살아 있다",
    "★적용률 하한이 0 이다 — 1건만 맞혀도 100% 가 된다★");
  chk(M.SPEAK.target >= 0.60, "목표 " + (M.SPEAK.target * 100).toFixed(0) + "% ≥ 60%(사용자 지정)",
    "★목표가 60% 아래로 내려갔다★");
  /* ★통과한 표기★ 에도 적용률이 반드시 있어야 한다 — 미달 문구에만 있으면 정작 위원으로
     쓰이는 순간의 숫자를 못 읽는다(돌연변이 S7 이 그 자리를 노린다). */
  chk(r.ok && /적용률 \d/.test(note) && /%/.test(note),
    "★통과한★ 표기에도 적용률이 숫자로 들어간다",
    "★통과했을 때 적용률이 빠진다 — 위원으로 쓰는 순간의 숫자를 못 읽는다★");
  /* 발언 표본이 ★몇 건뿐★ 이면 하한이 무의미하다 — 캘리브레이션은 넉넉하고 홀드아웃만
     얇은 경우를 따로 만든다(돌연변이 S8). */
  {
    const thin = { p: [], y: [], t: [] };
    for (let i = 0; i < 4000; i++) {                  // 거의 다 저확신 → 발언 표본이 아주 적다
      const hi = i % 400 === 0;
      thin.p.push(hi ? 0.95 : 0.501);
      thin.y.push(1);
      thin.t.push(T0 + Math.floor(i / 50) * D);
    }
    const rt = M._speakPoint(A.p, A.y, thin.p, thin.y, thin.t, 10 * D, M.SPEAK);
    chk(!rt.ok && /발언 표본/.test(rt.why || ""),
      "발언 표본이 얇으면 ★미달로 잡는다★ — " + rt.why,
      "★발언 " + rt.n + "건으로 하한을 만들어 통과시킨다★");
  }
}

console.log("\n⑤ ★기존 게이트를 한 톨도 안 건드렸는가★ (발언점은 덧붙인 자이지 대체가 아니다)");
{
  const floors = { GBDT: M.GBDT.trustFloor, DNN: M.DNN.trustFloor, MIND: M.MIND.trustFloor };
  for (const [n, v] of Object.entries(floors))
    chk(v === 0.505, n + " 문턱 0.505 그대로", "★" + n + " 문턱이 " + v + " 로 바뀌었다★");
  chk((S.match(/trustFloor: 0\.505/g) || []).length === 4, "trustFloor 0.505 리터럴 4개 — 전부 제자리",
    "★어딘가 낮췄다★");
  chk(M.ICGATE.tMin >= 2.5, "블록 IC t 문턱 " + M.ICGATE.tMin + " 그대로", "★IC t 문턱이 낮아졌다★");
  chk(M.BLKACC.minBlocks >= 4, "최소 블록 " + M.BLKACC.minBlocks + "개 그대로", "★최소 블록이 낮아졌다★");
  // ★재기만 한다★ — speak 이 승격·지분에 닿으면 안 된다(적용률을 보기 전에 배선하면 위험하다)
  const noStr = t => t.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const SS = noStr(strip(S));
  const leak = [...SS.matchAll(/\.speak\b/g)]
    .map(m => SS.slice(Math.max(0, m.index - 160), m.index + 80).replace(/\s+/g, " "))
    .filter(c => /\btrusted\s*=|trustFloor|\bwGbdt\s*=|\bwDnn\s*=|accLB\s*=|dnnLB\s*=|\bpromote\b/.test(c));
  chk(leak.length === 0, "발언점이 ★승격·지분·하한 어디에도 안 닿는다★(숫자를 보고 배선한다)",
    "★발언점이 판정에 닿는다: " + leak.slice(0, 1).join("") + "★");
}

console.log("\n⑥ ★조용한 무동작★ 이 없는가 — 발언점 계산이 try 안에서 죽어 null 이 되지 않는가");
{
  // TDZ 사고가 실제로 있었다: _horD 를 선언 ★전★ 에 썼고, ReferenceError 가 catch 에 먹혀
  // _speak 이 조용히 null 이 됐다. 같은 모양을 소스에서 막는다.
  for (const [nm, fnName] of [["DNN", "mlDNNTrainNightly"], ["GBDT", "mlGBDTTrainNightly"], ["공용", "_miniLogisticTrain"]]) {
    const i = S.indexOf("async function " + fnName + "(");
    chk(i > 0, nm + " 학습 함수를 찾았다", "★" + nm + " 함수를 못 찾는다★");
    if (i < 0) continue;
    const body = S.slice(i, i + 200000);
    const si = body.indexOf("_speakPoint(");
    chk(si > 0, nm + " 가 발언점을 ★실제로 부른다★", "★" + nm + " 에 발언점 배선이 없다★");
    if (si < 0) continue;
    // 호출 인자에 쓰인 식별자가 그 뒤에서 const/let 으로 선언되면 TDZ 다
    /* ★호출 인자만★ 정확히 잘라낸다 — 처음엔 400자를 그냥 떴더니 다음 문장까지 걸려
       거짓양성이 났다(_calNEff). 괄호 균형으로 끊는 것이 옳다. */
    let dep = 0, end = si;
    for (let k = si + "_speakPoint".length; k < body.length; k++) {
      if (body[k] === "(") dep++;
      else if (body[k] === ")") { dep--; if (!dep) { end = k + 1; break; } }
    }
    const call = body.slice(si, end);
    const ids = [...call.matchAll(/\b(_[A-Za-z][A-Za-z0-9]*)\b/g)].map(m => m[1]);
    const late = ids.filter(id => {
      const dec = body.search(new RegExp("\\b(?:const|let)\\s+" + id + "\\b"));
      return dec > si;
    });
    chk(late.length === 0,
      nm + ": 발언점 호출이 ★뒤에 선언되는 변수를 안 쓴다★(TDZ → catch → 조용한 null 없음)",
      "★" + nm + " 발언점이 나중에 선언되는 " + late.join(",") + " 를 쓴다 — ReferenceError 가 catch 에 먹혀 조용히 꺼진다★");
  }
  chk(/_speakNote\(model\.speak\)/.test(S) && /_speakNote\(net\.speak\)/.test(S) && /_speakNote\(_speak\)/.test(S),
    "세 학습기 모두 로그에 발언점을 적는다", "★어느 학습기가 재고도 안 적는다★");
}

console.log(fails === 0 ? "\n✓ 발언점(기권) 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
