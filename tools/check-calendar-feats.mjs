/* ═══════════════════════════════════════════════════════════════════════════
   [V33.265] 달력 사건 피처 — OpEx · FOMC (featVer 14 → 15, 69 → 75)

   옵션 미시구조(V33.264)는 과거 체인이 없어 ★기록만★ 했다. 이쪽은 다르다 —
   날짜만 있으면 과거를 전부 재구성할 수 있어서 소급이 가능하고, 그래서 진짜로
   학습 대상이 된다. 대신 조용히 죽는 길이 셋 있다:

     ① obsTs 를 안 넘기는 호출부가 하나라도 있으면 그 경로의 표본은 달력이 전부 0 이 된다.
        V12.47 이 정확히 그 사고였다 — 원핫 4개가 출처 무관 영구 0.
     ② 수확기가 ★정렬용 근사 ts★ 를 그대로 쓰면 2000봉짜리 종목은 800일 가까이 어긋난다.
        시간순 분할에는 단조롭기만 하면 되지만 달력에는 치명적이다.
     ③ FOMC 표가 만료되면 그날부터 전 표본이 fomcKnown=0 이 되고 아무도 모른다.

   셋 다 예외를 던지지 않는다. 그래서 검사가 필요하다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const D = (s) => Date.parse(s + "T00:00:00Z");

console.log("① OpEx — 세 번째 금요일은 산술이다(전수검사)");
{
  let n = 0, err = [];
  for (let y = 2000; y <= 2030; y++) for (let m = 0; m < 12; m++) {
    const t = M._thirdFriday(y, m), d = new Date(t); n++;
    if (d.getUTCDay() !== 5 || d.getUTCDate() < 15 || d.getUTCDate() > 21 || d.getUTCMonth() !== m || d.getUTCFullYear() !== y)
      err.push(y + "-" + (m + 1));
  }
  chk(err.length === 0, n + "개월 전수검사 — 전부 그 달의 금요일이고 15~21일 사이다",
    "위반 " + err.length + "건: " + err.slice(0, 5).join(", "));
  // 알려진 네마녀 날짜와 대조
  for (const [y, m, day] of [[2026,5,19],[2025,11,19],[2023,8,15],[2021,2,19]]) {
    const d = new Date(M._thirdFriday(y, m));
    if (d.getUTCDate() !== day) { console.log("  FAIL " + y + "-" + (m+1) + " 세번째 금요일이 " + d.getUTCDate() + "일 (기대 " + day + ")"); fails++; }
  }
  console.log("  ok   알려진 네마녀 4건과 일치");
  const w = M._opexCtx(D("2026-06-19"));
  chk(w && w.toNext === 0 && w.inWeek === 1 && w.quad === 1,
    "만기 당일: 남은 0일 · 만기주 1 · 네마녀 1", "만기 당일 판정이 틀렸다: " + JSON.stringify(w));
  const w2 = M._opexCtx(D("2026-06-22"));
  chk(w2 && w2.inWeek === 0 && w2.toNext > 20,
    "만기 다음 영업일: 만기주 0, 다음 만기까지 " + (w2 && w2.toNext) + "일", "만기 통과 후 롤오버가 안 된다");
  const w3 = M._opexCtx(D("2026-07-10"));
  chk(w3 && w3.quad === 0, "7월 만기는 네마녀가 아니다", "네마녀 월 판정이 틀렸다");
}

console.log("\n② FOMC — 표는 표일 뿐, 밖은 모른다고 말해야 한다");
{
  /* [V33.265] 처음엔 48 로 못 박았는데, 게이트가 "표가 곧 끝난다" 며 배포를 막아 2027 을
     연장하자 56 이 되어 ★멀쩡한 연장이 실패★ 했다. 개수를 박으면 표를 늘릴 때마다 걸린다.
     세어야 할 것은 개수가 아니라 ★해마다 8회인가★ 다. */
  const byYear = {};
  for (const d of M.FOMC_DAYS) { const y = d.slice(0, 4); byYear[y] = (byYear[y] || 0) + 1; }
  const years = Object.keys(byYear).sort();
  const notEight = years.filter(y => byYear[y] !== 8);
  chk(notEight.length === 0,
    "발표일 " + M.FOMC_DAYS.length + "건 — " + years[0] + "~" + years[years.length - 1] + " 매년 정확히 8회",
    "연 8회가 아닌 해: " + notEight.map(y => y + "=" + byYear[y] + "회").join(", ") + " — 빠뜨렸거나 중복이다");
  const asc = M.FOMC_DAYS.every((d, i) => i === 0 || D(d) > D(M.FOMC_DAYS[i - 1]));
  chk(asc, "날짜가 오름차순이고 중복이 없다", "표에 순서 오류나 중복이 있다");
  const dows = M.FOMC_DAYS.map(d => new Date(D(d)).getUTCDay());
  const wed = dows.filter(x => x === 3).length;
  chk(wed >= M.FOMC_DAYS.length - 2,
    "발표일 " + wed + "/" + M.FOMC_DAYS.length + " 이 수요일 — 2일 회의의 둘째 날이 맞다",
    "수요일이 " + wed + "건뿐 — 발표일이 아니라 회의 첫날을 넣었을 수 있다");
  // 회의 간격은 5~10주 사이여야 한다(연 8회)
  const gaps = M.FOMC_DAYS.slice(1).map((d, i) => (D(d) - D(M.FOMC_DAYS[i])) / 86400000);
  const bad = gaps.filter(g => g < 28 || g > 80);
  chk(bad.length === 0, "회의 간격 " + Math.min(...gaps) + "~" + Math.max(...gaps) + "일 (연 8회와 정합)",
    "간격 이상 " + bad.length + "건: " + bad.slice(0, 4).join(", ") + "일 — 날짜를 잘못 적었을 수 있다");

  chk(M._fomcCtx(D("2019-01-02")) === null, "표 밖(2019)은 null — 가장 가까운 날짜로 때우지 않는다",
    "★표 밖인데 값을 지어낸다★ — 2019년 표본에 2021년 회의가 붙는다");
  /* [V33.374] ★표 ★이후★ 방향도 본다.★ 종전엔 '이전' 만 봤다(2019).
     그 사이 400일 유예 구간에서 next 가 null 인데 호출부가 상한상수(45)로 채우고
     fomcKnown 은 1 이었다 — 모르는 값을 안다고 말했다. 실측 2028-06: to=45 since=45 known=1.
     "가장 가까운 날짜로 때우면 값이 아니라 거짓이다" 는 이 파일의 규칙 그대로다. */
  {
    const lastD = M.FOMC_DAYS[M.FOMC_DAYS.length - 1];
    const after = (days) => D(lastD) + days * 86400000;
    chk(M._fomcCtx(after(12)) === null,
      "표 마지막 회의 이후는 null — '다음 회의' 를 지어내지 않는다",
      "★표가 끝났는데 다음 회의를 안다고 한다★ — fomcTo 가 상한상수로 채워진다");
    chk(M._fomcCtx(after(200)) === null, "한참 뒤도 null", "★유예 구간에서 값을 지어낸다★");
    const f = M._calFeats(after(12));
    chk(f.fomcKnown === 0 && f.fomcTo === 0 && f.fomcSince === 0,
      "표 이후 피처 셋은 전부 0 + known=0 (모델이 무시한다)",
      "표 이후인데 값이 실린다: " + JSON.stringify(f));
    // ★표 안은 종전 그대로여야 한다 — 이 고침이 오늘 동작을 바꾸면 안 된다★
    const inside = M._calFeats(D("2026-06-15"));
    chk(inside.fomcKnown === 1 && inside.fomcTo === 2,
      "표 안(2026-06-15)은 종전 그대로 known=1 · to=2 — 오늘 동작은 안 바뀐다",
      "표 안 동작이 바뀌었다: " + JSON.stringify(inside));
  }
  const c = M._fomcCtx(D("2026-06-17"));
  chk(c && c.since === 0, "발표 당일: 경과 0일", "발표 당일 경과일이 " + (c && c.since));
  const c2 = M._fomcCtx(D("2026-06-16"));
  chk(c2 && c2.to === 1, "발표 전날: 남은 1일 (pre-FOMC drift 구간)", "발표 전날 남은일이 " + (c2 && c2.to));

  /* ★표가 조용히 만료되는 것을 막는다.★ 만료되면 그날부터 fomcKnown 이 전부 0 이 되고
     피처 셋이 죽는데 예외도 로그도 없다. 남은 기간이 짧아지면 배포를 막아 사람이 늘리게 한다. */
  const last = D(M.FOMC_DAYS[M.FOMC_DAYS.length - 1]);
  const left = Math.round((last - Date.now()) / 86400000);
  chk(left > 120, "표가 앞으로 " + left + "일 남았다 — 아직 만료 걱정 없음",
    "★FOMC 표가 " + left + "일 뒤 끝난다 — 지금 연장하지 않으면 그날부터 fomcKnown 이 전부 0 이 된다★");
}

console.log("\n③ 없는 값을 지어내지 않는가");
{
  const z = M._calFeats(null);
  chk(z.fomcKnown === 0 && z.fomcTo === 0 && z.fomcSince === 0 && z.opexToNext === 0,
    "obsTs 가 없으면 전부 0 + fomcKnown=0 (모른다)", "obsTs 없이 값을 만들어낸다: " + JSON.stringify(z));
  const k = M._calFeats(D("2026-06-15"));
  chk(k.fomcKnown === 1 && k.fomcTo === 2 && k.opexWeek === 1 && k.opexQuad === 1,
    "2026-06-15: FOMC 2일 전 · 만기주 · 네마녀 (known=1)", "값이 틀렸다: " + JSON.stringify(k));
  const o = M._calFeats(D("2019-01-02"));
  chk(o.fomcKnown === 0 && o.opexToNext > 0,
    "표 밖이라도 OpEx 는 산술이라 계산된다(FOMC 만 모른다)",
    "표 밖 처리가 틀렸다: " + JSON.stringify(o));
  // 클램프
  const big = M._calFeats(D("2026-08-01"));
  chk(big.fomcSince <= M.LUXML.featNames.length && big.fomcSince <= 45 && big.fomcTo <= 45,
    "일수가 45일로 클램프된다(꼬리가 학습을 지배하지 않게)", "클램프가 안 걸린다");
}

console.log("\n④ 호출부가 하나도 빠지지 않았는가 — 빠지면 그 경로만 조용히 0 이 된다");
{
  let i = 0, total = 0, missing = [];
  while ((i = S.indexOf("mlBuildFeatures({", i + 1)) > 0) {
    let d = 0, k = S.indexOf("{", i + 16), e = k;
    for (; e < S.length; e++) { const c = S[e]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
    total++;
    if (!/obsTs\s*:/.test(S.slice(k, e + 1))) missing.push(S.slice(0, i).split("\n").length);
  }
  chk(total >= 8, "호출부 " + total + "곳을 찾았다", "호출부가 " + total + "곳뿐 — 추출이 깨졌다");
  chk(missing.length === 0, "전 호출부가 obsTs 를 넘긴다",
    "obsTs 누락 " + missing.length + "곳(줄 " + missing.join(", ") + ") — 그 경로 표본은 달력이 영구 0 이다");
}

console.log("\n⑤ 수확기가 정렬용 근사 ts 를 달력에 쓰지 않는가");
{
  const h = S.slice(S.indexOf("strategy: \"hv\", market: mkt") - 2500, S.indexOf("strategy: \"hv\", market: mkt") + 200);
  chk(/obsTs:\s*\(Array\.isArray\(dd\.days\)/.test(h),
    "수확기는 dd.days[i](진짜 봉 날짜)를 쓴다", "수확기가 봉 날짜를 안 쓴다 — 달력이 어긋난다");
  chk(!/obsTs:\s*ts\b/.test(h) && !/obsTs:\s*baseTs/.test(h),
    "정렬용 근사(ts · baseTs)를 달력에 쓰지 않는다",
    "★근사 ts 를 달력에 쓴다 — 2000봉이면 800일 어긋난다(2022년이 2024년이 된다)★");
  chk(/dd\.days\.length === closes\.length/.test(h),
    "길이가 안 맞는 옛 캐시는 쓰지 않는다(인덱스가 밀리면 다른 날짜가 붙는다)",
    "days 배열 길이를 확인하지 않는다");
  chk(/:\s*null;?\s*$/m.test(h) || /:\s*null,/.test(h) || /\? _num\(dd\.days\[i\], 0\) \* 86400000 : null/.test(h),
    "봉 날짜가 없으면 null(모른다) — 오늘 날짜로 때우지 않는다", "봉 날짜가 없을 때 대체값을 지어낸다");
}

console.log("\n⑥ featVer 와 피처 수가 함께 올라갔는가");
{
  /* [V33.334] 숫자를 박아 두면 판이 오를 때마다 이 검사가 무관하게 깨지고, 그 습관이
     "게이트는 숫자만 고쳐 통과시키는 것"으로 굳는다. 지켜야 할 것은 특정 숫자가 아니라
     ★피처가 늘면 featVer 도 함께 오른다★ 는 관계다. 그래서 판별식으로 적는다.
     기준점: V33.265 에서 featVer 15 = 75종. 이후 판은 "늘어난 만큼 올랐는가"만 본다. */
  chk(M.LUXML.featVer >= 15, "featVer " + M.LUXML.featVer + " (달력 도입판 15 이상)",
      "featVer 가 " + M.LUXML.featVer + " — 달력 도입 이전으로 되돌아갔다");
  chk(M.LUXML.featNames.length >= 75,
      "피처 " + M.LUXML.featNames.length + "종 (달력 도입판 75 이상)",
      "피처가 " + M.LUXML.featNames.length + "종 — 달력 6종이 빠졌다");
  chk(M.LUXML.featVer - 15 >= (M.LUXML.featNames.length > 75 ? 1 : 0),
      "피처가 늘어난 판에서 featVer 도 함께 올랐다",
      "★피처는 늘었는데 featVer 가 그대로다 — 옛 표본과 새 표본이 같은 판으로 섞인다★");
  for (const n of ["opexToNext", "opexWeek", "opexQuad", "fomcTo", "fomcSince", "fomcKnown"])
    if (M.LUXML.featNames.indexOf(n) < 0) { console.log("  FAIL 피처 이름 누락: " + n); fails++; }
  console.log("  ok   달력 6종이 featNames 에 있다");
  // 벡터 길이와 이름 수가 같아야 한다
  const v = M.mlBuildFeatures({ closes: Array.from({ length: 300 }, (_, i) => 100 + i * 0.1), price: 130, market: "us", obsTs: D("2026-06-15") });
  chk(v.length === M.LUXML.featNames.length, "벡터 길이 " + v.length + " == 이름 수", "벡터와 이름 수가 다르다");
  const ix = (n) => M.LUXML.featNames.indexOf(n);
  chk(v[ix("fomcKnown")] === 1 && v[ix("opexQuad")] === 1,
    "실제 벡터에 값이 실린다(fomcKnown=1 · opexQuad=1)", "벡터에 달력 값이 안 실린다 — 이름만 있고 배선이 없다");
}

console.log(fails === 0 ? "\n✓ 달력 사건 피처 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
