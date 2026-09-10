/* ═══════════════════════════════════════════════════════════════════════════
   [V33.275] 단타 표본의 달력 6칸 소급복원 — 되살릴 것만 되살리는가.

   ■ 무엇이 있었나 (Modal 실측 2026-08-29)
       ⑧ 단타(장중) 학습 — 표본 16건 / 최근 14일
          (일봉피처 폭 불일치 ★67,623건 제외★ / 기준 75칸) → 표본 부족(16/3000) — 생략
     wrangler.toml 이 "이 시스템에서 가장 성적이 좋은 모델(valAccLB 0.6196)" 이라고
     적어 둔 모델이 표본 6만 7천을 못 쓰고 16건으로 굶고 있었다. 고장이 아니라
     판갈이(V33.265, 69→75)의 그림자다 — 일봉은 featver 로 갈라 재수확했지만
     R2 의 장중 표본에는 그 경로가 없었다.

   ■ 되살릴 수 있는 이유
     그 6칸은 달력사건(OpEx·FOMC)이고, V33.265 가 그 자리에 직접 적어 뒀다:
     "날짜만 있으면 과거를 전부 재구성할 수 있다." 표본은 자기 ts 를 들고 있으므로
     ★근사가 아니라 원래 값과 같은 값★ 이 복원된다.

   ■ 이 검사가 무는 것 — 되살리기는 조용히 오염되기 가장 쉬운 종류다
     ① 복원값이 라이브 조립과 ★정확히 일치★ 하는가 (같은 _calFeats 를 쓰는가)
     ② 달력 6종이 featNames 의 꼬리가 아니면 ★아무것도 안 하는가★
     ③ 65칸(하이킨아시 이전)은 되살리지 않는가 — 날짜로 못 만드는 것은 안 만든다
     ④ ts 가 없거나 엉터리면 Date.now() 로 때우지 않는가 (V33.265 금지사항)
     ⑤ 이미 75칸인 표본은 건드리지 않는가
     ⑥ 파이썬 트레이너가 달력을 ★다시 구현하지 않는가★ (규칙이 두 곳에 살면 갈라진다)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const names = M.LUXML.featNames, D = names.length, C = M.CAL_FEATS.length;
/* [V33.334] ★달력 6칸은 더 이상 꼬리가 아니다.★ 그 뒤에 DS 5칸이 붙었다.
   그래서 위치 산수가 바뀐다 — 달력은 [D−S−C, D−S), DS 는 [D−S, D).
   복원기도 두 단계가 됐다: D−S−C 칸(둘 다 없는 판) → 달력 → DS, D−S 칸 → DS 만.
   이 검사의 의도 여섯 가지는 그대로다. 바뀐 것은 '어디에 있는가' 뿐이다. */
const S_ = M.DS_FEATS.length;
const CAL_AT = D - S_ - C;          // 달력 6칸 시작 위치
const OLDW = D - S_ - C;            // 달력도 DS 도 없는 옛 판의 폭

console.log("① 복원값이 라이브 조립과 정확히 같은가 (같은 자를 쓰는가)");
{
  // 라이브가 만드는 벡터를 실제로 뽑아, 그 앞 69칸에서 되살린 것이 원본과 같은지 본다.
  const days = ["2026-08-14", "2026-03-17", "2025-12-09", "2024-06-11", "2022-01-25", "2021-09-23"];
  let worst = 0, tested = 0;
  for (const d of days) {
    const ts = Date.parse(d + "T14:30:00Z");
    const cal = M._calFeats(ts);
    const full = new Array(D).fill(0);
    for (let i = 0; i < C; i++) full[CAL_AT + i] = cal[M.CAL_FEATS[i]];
    // DS 5칸은 이 경로에서 '모른다'로 채워진다 — 그 기대값을 그대로 적어 둔다.
    for (let i = 0; i < S_; i++) full[D - S_ + i] = M.DS_NEUTRAL[M.DS_FEATS[i]];
    for (let j = 0; j < OLDW; j++) full[j] = ((j * 37) % 19) / 7 - 1;   // 앞칸은 아무 값이나(보존만 보면 된다)
    const old = full.slice(0, OLDW);
    const back = M._calBackfillX(old, ts);
    if (!back) { chk(false, "", `${d}: 되살리기가 null 을 냈다`); continue; }
    tested++;
    for (let j = 0; j < D; j++) worst = Math.max(worst, Math.abs(back[j] - full[j]));
  }
  console.log(`       ${tested}개 날짜 · 라이브 벡터와 최대 오차 ${worst}`);
  chk(tested === days.length && worst === 0,
    `되살린 ${D}칸이 라이브가 만드는 값과 ★완전히 동일★ 하다(달력은 실값, DS 는 dsKnown=0 중립 · 오차 0)`,
    `되살린 값이 라이브와 다르다(최대 오차 ${worst}) — 근사가 섞였다`);
  // 앞 69칸이 그대로 보존되는지 — 순서가 밀리면 모든 피처의 뜻이 바뀐다.
  const probe = Array.from({ length: OLDW }, (_, j) => j + 0.5);
  const got = M._calBackfillX(probe, Date.parse("2026-08-14T14:30:00Z"));
  chk(got && got.length === D && probe.every((v, j) => got[j] === v),
    `앞 ${OLDW}칸이 한 칸도 밀리지 않고 그대로 보존된다(→ ${D}칸)`, "★앞칸이 밀렸다 — 모든 피처의 뜻이 바뀐다★");
  // 달력까지 있는 판(D−5)은 DS 만 붙어야 한다 — 달력을 또 붙이면 앞칸이 밀린다.
  const mid = Array.from({ length: D - S_ }, (_, j) => j + 0.25);
  const got2 = M._featBackfillX(mid, Date.parse("2026-08-14T14:30:00Z"), null);
  chk(got2 && got2.length === D && mid.every((v, j) => got2[j] === v),
    `달력까지 있는 ${D - S_}칸은 DS 5칸만 덧붙는다 — 달력을 두 번 붙이지 않는다`,
    "★중간 판에 달력이 다시 붙었다 — 앞칸이 밀린다★");
}

console.log("\n② 달력·DS 가 featNames 의 정해진 자리에 있는가 — 아니면 아무것도 안 하는가");
{
  const calSeg = names.slice(CAL_AT, CAL_AT + C), dsTail = names.slice(D - S_);
  chk(calSeg.every((n, i) => n === M.CAL_FEATS[i]),
    `달력 6종이 [${CAL_AT}, ${CAL_AT + C}) 에 있다 (${calSeg.join(",")})`,
    `★달력 6종이 제자리에 없다 — 소급복원이 앞칸을 오염시킨다★ (${calSeg.join(",")})`);
  chk(dsTail.every((n, i) => n === M.DS_FEATS[i]),
    `DS 5종이 featNames 의 꼬리다 (${dsTail.join(",")})`,
    `★DS 5종이 꼬리가 아니다 — 덧붙이기가 앞칸을 밀어낸다★ (${dsTail.join(",")})`);
  chk(/if \(names\[D - S \+ i\] !== DS_FEATS\[i\]\) return null;/.test(code)
      && /if \(names\[D - S - C \+ i\] !== CAL_FEATS\[i\]\) return null;/.test(code),
    "복원기가 두 자리를 ★스스로 확인하고★ 아니면 기권한다(손으로 믿지 않는다)",
    "복원기가 배치를 확인하지 않는다 — featNames 순서가 바뀌면 조용히 오염된다");
  chk((code.match(/DS_FEATS = \[/g) || []).length === 1,
    "DS 목록도 선언부 딱 하나뿐이다(손복사 없음)", "DS 목록이 두 곳에 적혀 있다");
  chk((code.match(/CAL_FEATS = \[/g) || []).length === 1,
    "달력 목록이 선언부 딱 하나뿐이다(손복사 없음)", "달력 목록이 두 곳에 적혀 있다");
}

console.log("\n③~⑤ 되살리지 않아야 할 것은 되살리지 않는가");
{
  const ts = Date.parse("2026-08-14T14:30:00Z");
  chk(M._calBackfillX(new Array(OLDW - 4).fill(0), ts) === null,
    `${OLDW - 4}칸(하이킨아시 이전)은 되살리지 않는다 — 가격이 있어야 만드는 값이다`,
    "★못 만드는 판을 되살렸다 — 날짜로 못 만드는 값을 지어냈다★");
  const cur = M._calBackfillX(new Array(D).fill(0), ts);
  chk(cur && cur.length === D,
    `이미 ${D}칸인 표본은 폭이 그대로다(또 늘리지 않는다)`, "이미 현재 판인 표본을 또 늘린다");
  chk(M._calBackfillX(new Array(OLDW).fill(0), 0) === null
      && M._calBackfillX(new Array(OLDW).fill(0), null) === null,
    "ts 가 없으면 기권한다 — Date.now() 로 때우지 않는다(V33.265 금지사항)",
    "★ts 가 없는데도 되살린다 — 과거 표본에 오늘 달력이 붙는다★");
  chk(!/_calBackfillX[\s\S]{0,600}Date\.now\(\)/.test(code),
    "복원기 안에 Date.now() 가 없다", "★복원기가 Date.now() 를 쓴다★");
  // 판 밖 날짜(FOMC 표 이전)는 값이 아니라 ★결측 표식★ 으로 정직하게 표시돼야 한다.
  const preTable = M._calBackfillX(new Array(OLDW).fill(0), Date.parse("2015-05-05T14:30:00Z"));
  chk(preTable && preTable[names.indexOf("fomcKnown")] === 0,
    "FOMC 표 밖(2021 이전) 날짜는 fomcKnown=0 으로 '모른다' 고 말한다",
    "표 밖 날짜인데 fomcKnown 이 1 이다 — 모르는 것을 안다고 한다");
}

console.log("\n⑥ 배선 — 서버가 내보내기 직전에 하고, 파이썬은 다시 구현하지 않는가");
{
  chk(/const _fixed = _calBackfillX\(sm\.x, sm\.ts\);/.test(code),
    "장중 익스포트가 내보내기 직전에 되살린다", "익스포트에 복원 배선이 없다");
  chk(/calBackfilled: _calFix, calUnfixable: _calSkip/.test(code),
    "되살린 수·못 되살린 수가 응답에 실린다(조용히 사라지지 않는다)", "복원 건수가 안 보인다");
  chk(/cal_fix \+= int\(j\.get\("calBackfilled"\)/.test(PY),
    "트레이너가 그 수를 받아 합산한다", "트레이너가 복원 건수를 안 읽는다");
  // ★파이썬이 달력을 다시 계산하면 규칙이 두 곳에 살게 된다 — 그게 이 저장소의 단골 사고다.
  chk(!/third.?friday|_thirdFriday|FOMC_DAYS|opexToNext|fomcSince/i.test(PY),
    "파이썬 트레이너에 달력 계산이 ★없다★ — 규칙은 워커 한 곳에만 산다",
    "★파이썬이 달력을 다시 구현했다 — 두 구현은 언젠가 갈라진다★");
  chk(/len\(x\) != xn/.test(PY),
    "트레이너의 폭 가드는 그대로다(복원 실패분은 종전대로 걸러진다)", "폭 가드가 사라졌다 — 차원이 섞인다");
}

console.log(fails === 0 ? "\n✓ 달력 소급복원 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
