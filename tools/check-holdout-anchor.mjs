/* ═══════════════════════════════════════════════════════════════════════════
   [V33.303] 홀드아웃이 ★달력에 못 박혀 있는가★ · 전진 0 이 자기 이유를 말하는가.

   ■ 무엇이 있었나 (2026-09-04 운영 실측)
       MEMO 홀드아웃 블록IC ★−0.0390★ (t −1.88)  ← 게이트가 보는 값
       MEMO 전진(진짜 표본밖) IC ★+0.14781★ (t 2.421 · n 1,028)
     부호가 반대다. 같은 밤 로그가 "섞어재면 −0.0113 t −0.40" 이라 적는다 —
     −0.039 의 대부분은 ★그 13일 시장의 방향★ 이지 모델이 아니었다.

     13일이 나온 경위: 창이 "가장 최근 24,000행" 인데 수확이 한 봉 날짜에 전 종목을
     함께 쌓아 24,000행 = 67일이고, 그 20% 가 13일이다. 라벨 지평 10일이므로 겹치지
     않는 관측은 ★1개★ — V33.300 이 '못 쟀다' 로 판정하는 그 상태다.
     그런데 표에는 564,735행(4년치)이 있었다. 잴 재료가 없던 게 아니라 안 읽었다.

     그리고 V33.285 가 이미 답을 적어 뒀다 — "홀드아웃을 고정한 채 학습창만 바꿔 재야
     한다". 그 고정을 이 판이 한다.

   ■ 이 검사가 무는 것
     ① 홀드아웃 기간이 ★판정 가능한 최소치★(minBlocks × 라벨지평) 이상으로 잡혀 있는가
     ② 학습이 홀드아웃+엠바고 ★이전★ 에서만 뽑히는가(경계가 달력으로 벌어져 있는가)
     ③ 기간을 지키면서 행 수를 묶는가(예산을 안 늘린다) — 균등 칸 추출
     ④ 이력이 짧으면 종전 방식으로 물러서고 ★그렇다고 로그가 말하는가★
     ⑤ 실제로 돌려 — 60일 홀드아웃이면 expertAdmit 이 'pending' 을 벗어나는가
     ⑥ 전진표본 0 이 ★왜 0 인지★ 계측해 말하는가(고를 행 없음/배치하한/라벨/NaN 구분)
     ⑦ 변이 — 엠바고를 빼거나 holdDays 를 지평 아래로 낮추면 이 검사가 실패하는가
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const HV = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

const H = M.AI_PARAMS.predictionHorizonDays;
const MINB = M.ICGATE.minBlocks;

console.log("① 홀드아웃 기간이 판정 가능한 최소치 이상인가");
{
  const hd = M.MEMOML.holdDays;
  console.log(`       holdDays ${hd}일 · 라벨지평 ${H}일 · minBlocks ${MINB} → 필요 ${MINB * H}일`);
  chk(typeof hd === "number" && hd >= MINB * H,
    `홀드아웃 ${hd}일 ≥ ${MINB}×${H} = ${MINB * H}일 — 겹치지 않는 관측이 문턱을 넘는다`,
    `★홀드아웃 ${hd}일 < ${MINB * H}일 — 못 재는 잣대를 그대로 둔 것이다★`);
  chk(M.MEMOML.holdCap > 0 && M.MEMOML.holdBuckets >= 2,
    `기간을 ${M.MEMOML.holdBuckets}칸으로 나눠 최대 ${M.MEMOML.holdCap}행만 읽는다(예산 불변)`,
    "행 수 상한·칸 수가 없다 — 기간을 늘리면 메모리도 같이 늘어난다");
}

console.log("\n② 학습이 홀드아웃+엠바고 이전에서만 뽑히는가");
{
  chk(/WHERE featver = \? AND ts < \? ORDER BY ts DESC LIMIT \?/.test(S) && /_hf - _emb, MEMOML\.trainWindow/.test(S),
    "학습 질의가 ★홀드아웃 시작 − 엠바고★ 이전만 본다(경계가 달력으로 벌어진다)",
    "★학습이 홀드아웃과 붙어 있다 — 라벨 구간이 홀드아웃으로 뻗는다★");
  chk(/const _emb = _num\(AI_PARAMS\.predictionHorizonDays, 10\) \* 86400000;/.test(S),
    "엠바고가 ★라벨 지평★ 에서 나온다(손으로 적은 상수가 아니다)",
    "엠바고가 지평과 무관하다");
  chk(/let _keep = nvalStart;\s*\n\s*while \(_keep > 0 && _num\(T\[_keep - 1\], 0\) \+ _span > _bound\) _keep--;/.test(S),
    "퍼징 안전망은 그대로 남아 있다(엠바고가 실패해도 경계를 지킨다)",
    "퍼징을 걷어냈다 — 안전망이 하나 줄었다");
}

console.log("\n③ 기간을 지키면서 행을 묶는가 — 균등 칸 추출");
{
  chk(/for \(let b = _B - 1; b >= 0; b--\)/.test(S),
    "최신 칸부터 읽어 이어 붙인다 — 결과 배열이 ts DESC 를 유지한다(아래 루프의 전제)",
    "★칸 순서가 뒤집혀 있다 — 배열이 시간순이 아니게 되어 퍼징·블록이 전부 어긋난다★");
  chk(/ts >= \? AND ts < \? ORDER BY ts DESC LIMIT \?/.test(S),
    "칸마다 기간을 걸고 상한을 둔다", "칸 질의가 기간을 안 건다");
}

console.log("\n④ 이력이 짧으면 물러서고, 그렇다고 말하는가");
{
  chk(/_calWhy = "이력 " \+/.test(S) && /_calWhy = "홀드아웃 " \+/.test(S),
    "물러선 이유를 문장으로 남긴다(이력 부족·행 부족을 구분한다)",
    "★물러선 이유가 없다 — 다음에 또 코드를 읽어야 안다★");
  chk(/달력홀드아웃없음\[/.test(S) && /달력홀드아웃\[/.test(S),
    "로그가 잣대가 달력에 못 박혔는지 매번 적는다",
    "로그가 잣대를 안 적는다 — 화면만 보고는 어느 경로로 쟀는지 모른다");
  chk(/if \(_hold\.length >= 400 && _tr\.length >= MEMOML\.minTrainSamples\)/.test(S),
    "홀드아웃·학습 둘 다 최소치를 넘을 때만 달력 경로를 쓴다(학습을 굶기지 않는다)",
    "학습이 굶어도 달력 경로를 쓴다");
}

console.log("\n⑤ ★실제로 돌린다★ — 60일 홀드아웃이면 판정이 되는가");
{
  const day = 86400000, now = Date.now();
  const mk = (spanDays, n) => {
    const T = [];
    for (let i = 0; i < n; i++) T.push(now - spanDays * day + Math.floor(i * spanDays * day / Math.max(1, n - 1)));
    return T;
  };
  const cases = [[13, "종전(창 67일의 20%)"], [21, "XALPHA 현재"], [M.MEMOML.holdDays, "이 판(달력 고정)"]];
  for (const [d, label] of cases) {
    const T = mk(d, 4000);
    const span = M._holdSpanDays(T, 0, T.length);
    const eff = M._effBlocks(span, H * day);
    const a = M.expertAdmit({ valICt: 3.0, valICBlock: 0.05, valICdf: 11, valICeff: eff, valICspanD: span,
                              holdPass: true, fwdReady: false, fwdN: 0, tMinUsed: 2.69 });
    console.log(`       ${label}: 홀드아웃 ${span}일 → 관측 ${eff}개 → ${a.tier}`);
    if (d >= MINB * H)
      chk(a.tier !== "pending", `${label} — 'pending(못 쟀다)' 를 벗어난다`, `★${label} 인데도 못 쟀다로 남는다★`);
    else
      chk(a.tier === "pending", `${label} — 여전히 '못 쟀다'(옳다: ${eff} < ${MINB})`, `${label} 가 못 쟀다로 안 잡힌다`);
  }
}

console.log("\n⑥ 전진표본 0 이 왜 0 인지 말하는가");
{
  for (const [re, what] of [
    [/_why = "고른 행 " \+ rows\.length \+ " < 배치하한 "/, "고를 행이 배치하한에 못 미침"],
    [/_why = "행 " \+ rows\.length \+ "건 중 채점 가능 "/, "라벨·피처에서 걸러짐"],
    [/IC 가 NaN — 라벨이 한쪽으로 쏠려/, "IC 가 NaN(라벨 쏠림)"],
    [/날짜 " \+ _v\.length \+ "\/" \+ FWDLED\.minDays/, "표본은 찼지만 날짜가 모자람"]
  ]) chk(re.test(S), `구분한다 — ${what}`, `★'${what}' 를 구분하지 않는다 — 처방이 다른데 화면이 같은 말을 한다★`);
  chk(/fwdWhy: _fwd \? \(_fwd\.why \|\| null\) : /.test(S) && /model\.fwdWhy = _fwd \?/.test(S),
    "선형 위원들과 MEMO 가 ★같은 필드★ 로 남긴다(모델마다 다른 말을 하지 않는다)",
    "일부 모델만 이유를 남긴다");
  chk(/fwdWhy: m \? \(m\.fwdWhy \|\| null\) : null/.test(S), "API 가 그 문장을 화면에 준다", "API 가 안 싣는다");
  chk(/o\.fwdWhy\?\(' — '\+esc\(String\(o\.fwdWhy\)/.test(HV), "사이드바가 그 문장을 적는다", "화면이 여전히 숫자만 적는다");
}

console.log("\n⑦ 같은 모델의 '문턱' 을 두 화면이 다르게 적지 않는가 (V33.301 의 숫자 판)");
{
  chk(/accLB: _dnnLB, floor: _num\(DNN\.trustFloor, 0\.505\)/.test(S),
    "구조 관측의 DNN 문턱이 ★게이트가 쓰는 상수★ 다(사이드바 _diag 와 같은 값)",
    "★구조 관측이 MIND 하한을 DNN 문턱이라 적는다 — 실측 51.6% vs 52.1% 로 모순이 보였다★");
  chk(/accLB: gT \? _num\(gT\.gbdtAccLB, null\) : null, floor: _num\(GBDT\.trustFloor, 0\.505\)/.test(S),
    "GBDT 도 같은 상수를 적는다", "GBDT 문턱이 두 화면에서 다르다");
  chk(/floor: DNN\.trustFloor/.test(S) && /floor: GBDT\.trustFloor/.test(S),
    "사이드바(_modelFacts)가 쓰는 상수와 같은 이름이다", "사이드바 쪽 상수를 못 찾는다");
}

console.log("\n⑧ 변이 시험 — 계약을 깨면 이 검사가 실패하는가");
{
  /* [V33.326] ★replace → replaceAll★ — 이 변이 시험이 스스로 헛돌게 된 적이 있다.
     V33.326 이 공용 미니 트레이너(flow·xalpha·stack·이중헤드)에도 같은 달력 홀드아웃을
     넣으면서 `_calWhy = "이력 " +` 이 ★두 곳★ 이 됐다. String.replace 는 첫 번째만 바꾸므로
     변이가 미니 트레이너 쪽만 지웠고, 정규식은 남은 MEMO 쪽에 걸려 "계약이 지켜진다" 고
     답했다 — 즉 계약을 다 지워도 통과하는 상태였다. 이 검사가 그걸 스스로 잡아 실패했다.
     같은 계약을 지키는 자리가 늘어난 만큼, 변이도 ★전부★ 지워야 의미가 있다. */
  const muts = [
    [S.replaceAll("_hf - _emb, MEMOML.trainWindow", "_hf, MEMOML.trainWindow"),
     /_hf - _emb, MEMOML\.trainWindow/, "엠바고를 빼면"],
    [S.replaceAll("_calWhy = \"이력 \" +", "_calWhy = null; void (\"이력 \" +"),
     /_calWhy = "이력 " \+/, "물러선 이유를 지우면"]
  ];
  for (const [mutated, re, why] of muts)
    chk(!re.test(mutated), `${why} 잡는다`, `★${why} 도 통과한다 — 이 검사는 헛돈다★`);
  // holdDays 를 지평 아래로 낮추면 ① 이 무너져야 한다(계약을 숫자로 확인한다)
  chk(!(H - 1 >= MINB * H), "holdDays 를 지평 아래로 낮추면 ①의 부등식이 깨진다", "①이 숫자와 무관하다");
}

console.log(fails === 0 ? "\n✓ 홀드아웃 고정·전진 사유 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
