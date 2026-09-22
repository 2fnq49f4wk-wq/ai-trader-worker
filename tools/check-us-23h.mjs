/* ═══════════════════════════════════════════════════════════════════════════
   [V33.417] ★미국 23시간 장 대비★ — 2026-12-06 부터 (사용자 지시)

   ■ 이 변경의 전부는 "무엇이 바뀌고 무엇이 안 바뀌는가" 다
     ★정규장은 그대로 09:30~16:00 ET 다.★ 늘리지 않는다:
       · ★공식 종가★ 가 거기서 난다 — 일봉·라벨·수익률·dayPct 가 전부 그 종가에 걸려 있다
       · minutesToClose(마감 전 노출 축소)·quoteTail(공식 종가 프린트 대기)도 그 창의 함수다
       · 정규장을 23시간으로 적으면 "마감까지 남은 분" 이 23시간이 되고 종가는 영영 안 온다
     ★23시간은 정규장이 늘어나는 것이 아니라 시간외가 넓어지는 것이다.★

   ■ ★돈을 거는 창은 넓히지 않는다★ — 이 검사가 가장 세게 붙드는 계약
     야간 호가는 얇고, 슬리피지·신선도 가정(A-3/A-4)이 그 구간에서도 맞는지 ★아직 안 쟀다.★
     preTrade/postTrade 를 명시하지 않으면 pre/post 로 떨어져 ★23시간이 통째로 거래창★ 이 된다.
     이 파일이 이미 적어 둔 원칙 그대로다: "보는 것과 돈을 거는 것은 다른 문제다."
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
/* EST(UTC−5). 12월이므로 서머타임 아님 — ET 시각을 그대로 만들 수 있다. */
const et = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h + 5, mi || 0));
const sess = (d) => M.marketSessionNow("us", d);

console.log("① ★정규장은 한 칸도 안 늘었다★ (공식 종가·일봉·라벨의 뿌리)");
{
  const before = M.marketWindows("us", et(2026, 11, 7, 10));
  const after = M.marketWindows("us", et(2026, 12, 7, 10));
  chk(JSON.stringify(after.regular) === JSON.stringify([570, 960]),
    "시행 후에도 정규장 09:30~16:00 ET 그대로 " + JSON.stringify(after.regular),
    "★정규장이 " + JSON.stringify(after.regular) + " 로 바뀌었다 — 공식 종가가 사라진다★");
  chk(JSON.stringify(before.regular) === JSON.stringify(after.regular),
    "시행 전후 정규장이 같다", "★시행일에 정규장이 움직인다★");
  chk(M.minutesToClose("us", et(2026, 12, 7, 10)) === 360,
    "마감까지 남은 분이 여전히 정규장 기준이다(월 10:00 → 360분)",
    "★마감까지가 " + M.minutesToClose("us", et(2026, 12, 7, 10)) + "분 — 23시간을 마감으로 읽는다★");
  chk(M.isMarketOpen("us", et(2026, 12, 7, 10)) === true &&
      M.isMarketOpen("us", et(2026, 12, 7, 21)) === false,
    "isMarketOpen 은 ★정규장만★ 참이다(야간 21:00 은 거짓)",
    "★야간을 정규장으로 읽는다 — 얼어붙은 종가로 거래하게 된다★");
}

console.log("\n② ★돈을 거는 창은 넓히지 않았다★ (이 검사가 가장 세게 붙드는 계약)");
{
  const after = M.marketWindows("us", et(2026, 12, 7, 10));
  chk(JSON.stringify(after.preTrade) === JSON.stringify([420, 570]),
    "preTrade 07:00~09:30 그대로 " + JSON.stringify(after.preTrade),
    "★preTrade 가 " + JSON.stringify(after.preTrade) + " 로 넓어졌다 — 안 잰 구간에 돈을 건다★");
  chk(JSON.stringify(after.postTrade) === JSON.stringify([960, 1200]),
    "postTrade 16:00~20:00 그대로 " + JSON.stringify(after.postTrade),
    "★postTrade 가 " + JSON.stringify(after.postTrade) + " 로 넓어졌다 — 야간 얇은 호가에 돈을 건다★");
  // ★명시★ 되어 있어야 한다 — 빠지면 pre/post 로 떨어져 23시간이 통째로 거래창이 된다
  const i = S.indexOf("const MARKET_HOURS_US_23H = {");
  const blk = i > 0 ? S.slice(i, S.indexOf("};", i)) : "";
  chk(/preTrade: \[420, 570\]/.test(blk) && /postTrade: \[960, 1200\]/.test(blk),
    "23시간 프로필이 두 거래창을 ★명시★ 한다(폴백에 맡기지 않는다)",
    "★거래창을 안 적었다 — pre/post 로 떨어져 23시간이 통째로 거래창이 된다★");
  // 야간에는 거래 세션이 잡히면 안 된다
  const _ts = (d) => { try { return M.tradeSessionNow ? M.tradeSessionNow("us", d) : null; } catch (e) { return null; } };
  if (M.tradeSessionNow) {
    chk(_ts(et(2026, 12, 7, 3)) == null, "새벽 03:00 은 ★거래 세션이 아니다★",
      "★새벽을 거래 세션으로 읽는다★");
    chk(_ts(et(2026, 12, 7, 22)) == null, "밤 22:00 은 ★거래 세션이 아니다★",
      "★밤을 거래 세션으로 읽는다★");
  }
}

console.log("\n③ ★시행일에 스스로 바뀐다★ (사람이 그날 배포를 기억하지 않아도 된다)");
{
  chk(sess(et(2026, 12, 4, 21)) === "CLOSED",
    "시행 전 금요일 21:00 → CLOSED(종전 창)", "★시행 전인데 벌써 열려 있다★");
  chk(sess(et(2026, 12, 7, 3)) === "PRE",
    "시행 후 월요일 03:00 → PRE(야간)", "★시행일이 지나도 안 바뀐다★");
  chk(/const MARKET_HOURS_23H_FROM = "2026-12-06";/.test(S),
    "시행일이 상수 한 곳에 있다(2026-12-06)", "★시행일 상수가 2026-12-06 이 아니다★");
  /* ★행동으로도 가른다.★ 03:00 ET 는 두 창이 갈리는 시각이다 —
     종전 pre 는 04:00(240분)부터라 CLOSED, 23시간 창은 PRE 다.
     (금요일 저녁은 두 창 모두 CLOSED 라 시행일을 앞당겨도 안 걸린다 — 그 함정을 피한다) */
  chk(sess(et(2026, 11, 9, 3)) === "CLOSED",
    "시행 ★한 달 전★ 월요일 03:00 → CLOSED(종전 창은 04:00부터)",
    "★시행일 전인데 야간이 이미 열려 있다 — 시행일이 앞당겨졌다★");
  chk(sess(et(2026, 12, 7, 3)) === "PRE",
    "시행 후 같은 시각은 PRE — ★그 날짜에 실제로 갈린다★",
    "★시행 후에도 안 열린다★");
  chk(/_d >= MARKET_HOURS_23H_FROM/.test(S), "그 날짜로 창을 갈아 끼운다", "★날짜 판정이 없다★");
}

console.log("\n④ ★한 주의 가장자리★ — 일요일 저녁은 열리고 금요일 저녁은 안 연다");
{
  const cases = [
    ["일 21:00", et(2026, 12, 6, 21), "POST"],
    ["월 03:00", et(2026, 12, 7, 3), "PRE"],
    ["월 10:00", et(2026, 12, 7, 10), "REGULAR"],
    ["월 17:00", et(2026, 12, 7, 17), "POST"],
    ["월 19:30", et(2026, 12, 7, 19, 30), "CLOSED"],   // 유지보수 중단
    ["월 21:00", et(2026, 12, 7, 21), "POST"],
    ["금 17:00", et(2026, 12, 11, 17), "POST"],
    ["금 21:00", et(2026, 12, 11, 21), "CLOSED"],      // ★금요일 저녁 야간 없음★
    ["토 03:00", et(2026, 12, 12, 3), "CLOSED"],
    ["토 21:00", et(2026, 12, 12, 21), "CLOSED"]
  ];
  for (const [lbl, d, want] of cases)
    chk(sess(d) === want, lbl + " → " + want, "★" + lbl + " 이 " + sess(d) + " 다(기대 " + want + ")★");
}

console.log("\n⑤ ★유지보수 중단이 진짜 구멍인가★ · ★한국은 안 건드렸는가★");
{
  chk(sess(et(2026, 12, 7, 18, 59)) === "POST" && sess(et(2026, 12, 7, 19, 1)) === "CLOSED" &&
      sess(et(2026, 12, 7, 19, 59)) === "CLOSED" && sess(et(2026, 12, 7, 20, 1)) === "POST",
    "19:00~20:00 이 ★정확히★ 닫힌다(18:59 열림 · 19:01 닫힘 · 19:59 닫힘 · 20:01 열림)",
    "★유지보수 구멍의 경계가 어긋난다★");
  const kr = M.marketWindows("kr", et(2026, 12, 7, 10));
  chk(JSON.stringify(kr.regular) === JSON.stringify([540, 930]),
    "한국 정규장 09:00~15:30 그대로", "★한국 창이 바뀌었다★");
  chk(M.marketSessionNow("kr", new Date(Date.UTC(2026, 11, 6, 3))) === "CLOSED",
    "한국은 일요일에 안 연다(미국 변경이 안 샜다)", "★한국이 일요일에 열린다★");
}

console.log("\n⑥ ★모르면 닫혀 있다★ — 요일을 안 넘기면 요일 제한 구간은 안 맞는다");
{
  chk(M._inWin(100, [{ a: 0, b: 570, days: [1, 2, 3, 4, 5] }]) === false,
    "요일 지정 구간에 day 를 안 넘기면 ★거짓★ (모르면 닫혀 있다)",
    "★모르면 열려 있다로 읽는다 — 안전한 기본값이 아니다★");
  chk(M._inWin(100, [{ a: 0, b: 570, days: [1, 2, 3, 4, 5] }], 1) === true,
    "요일을 넘기면 정상 판정", "★요일을 넘겨도 안 맞는다★");
  chk(M._inWin(600, [570, 960]) === true && M._inWin(600, [570, 960], 3) === true,
    "종전 표기 [a,b] 는 ★그대로★ 돈다(요일 기본 월~금)", "★종전 표기가 깨졌다★");
  chk(M._inWin(600, [570, 960], 0) === false, "종전 표기도 일요일엔 안 맞는다", "★일요일에 열린다★");
}

console.log(fails === 0 ? "\n✓ 미국 23시간 장 대비 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
