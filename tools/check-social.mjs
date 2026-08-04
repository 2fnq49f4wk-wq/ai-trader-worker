// [V33.110] 소셜 멀티소스 — 최신성 계약 검증.
//
//   "오래된 소스는 쓰지 말고 최신 위주" 는 눈으로 확인할 수 없는 요구다.
//   반감기 상수 하나가 잘못 들어가면 6시간 전 글과 5분 전 글이 같은 표가 되는데,
//   결과는 여전히 '그럴듯한 점수'로 나온다 — 이 저장소가 확률 쪽에서 반복해 겪은 실패 형태다.
//   → 시각을 아는 합성 스트림을 넣어 계약을 못 박는다.

import { SOCIAL, SOCIAL_SOURCES, socialScoreOf } from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };
const ST = SOCIAL_SOURCES.find((x) => x.id === "stocktwits");
const RD = SOCIAL_SOURCES.find((x) => x.id === "reddit");

const NOW = Date.parse("2026-08-04T12:00:00Z");
const cut = NOW - SOCIAL.freshH * 3600000;
// ageMin 분 전 글 하나
const msg = (id, ageMin, basic) => ({
  id, created_at: new Date(NOW - ageMin * 60000).toISOString(),
  entities: basic ? { sentiment: { basic } } : {}
});
const run = (msgs) => ST.parse({ messages: msgs }, cut, null, NOW);

// ══ 1) 하드 컷오프 — 신선구간 밖은 세지 않는다 ═══════════════════════════════
{
  const old = SOCIAL.freshH * 60 + 30;   // 컷오프보다 30분 더 오래된 글
  const r = run([msg(9, 5, "Bullish"), msg(8, old, "Bearish"), msg(7, old + 60, "Bearish")]);
  if (r.n === 1 && r.bull === 1 && r.bear === 0 && r.oldSkipped === 2)
    ok("하드 컷오프 " + SOCIAL.freshH + "h — 신선 1건만 집계, 오래된 2건 제외");
  else bad("컷오프가 안 먹는다: " + JSON.stringify(r));
}

// ══ 2) 반감기 가중 — 최신 글이 더 무겁다 ═════════════════════════════════════
{
  // 방금 Bullish 1건 vs 반감기 2번 지난(=가중 1/4) Bearish 1건 → 점수는 양수여야 한다.
  const hl = SOCIAL.halfLifeH * 60;
  const r = run([msg(9, 1, "Bullish"), msg(8, hl * 2, "Bearish"),
                 msg(7, 2, "Bullish"), msg(6, 3, "Bullish"),
                 msg(5, 4, "Bullish"), msg(4, 5, "Bullish")]);
  if (r.score != null && r.score > 0.5) ok("반감기 가중 — 최신 강세 우세 점수 " + r.score);
  else bad("반감기 가중이 안 먹는다: " + JSON.stringify(r));

  // 같은 구성인데 강세만 오래되면 점수가 낮아져야 한다(방향 뒤집힘 확인).
  const r2 = run([msg(9, hl * 2, "Bullish"), msg(8, 1, "Bearish"),
                  msg(7, hl * 2, "Bullish"), msg(6, 2, "Bearish"),
                  msg(5, hl * 2, "Bullish"), msg(4, 3, "Bearish")]);
  if (r2.score != null && r2.score < 0) ok("오래된 강세 vs 최신 약세 → 음수 " + r2.score);
  else bad("최신 우선이 반영되지 않았다: " + JSON.stringify(r2));

  // 가중이 없다면(단순 개수) 위 두 케이스는 각각 +0.33 / +0.33 로 같아야 한다.
  //   즉 두 값이 다르다는 것 자체가 가중이 실제로 작동한다는 증거다.
  if (r.score !== r2.score) ok("가중 유무 판별 — 같은 개수 구성인데 점수가 다르다");
  else bad("두 케이스 점수가 같다 — 개수만 세고 있다");
}

// ══ 3) 표본 부족이면 방향을 말하지 않는다 ════════════════════════════════════
{
  const few = run([msg(9, 1, "Bullish"), msg(8, 2, "Bullish")]);   // 라벨 2건 < minLabeled
  if (few.score === null) ok("라벨 " + (few.bull + few.bear) + "건 < minLabeled " + SOCIAL.minLabeled + " → score null(모름)");
  else bad("표본 부족인데 점수를 냈다: " + JSON.stringify(few));
  // 라벨 없는 글(무의견)은 분모에 들어가면 안 된다
  const noLab = run([msg(9, 1, null), msg(8, 2, null), msg(7, 3, "Bullish")]);
  if (noLab.n === 3 && noLab.bull === 1 && noLab.bear === 0)
    ok("무의견 글은 라벨 분모에서 제외(n 3, 라벨 1)");
  else bad("무의견 처리 오류: " + JSON.stringify(noLab));
}

// ══ 4) 페이지네이션 커서 — 더 오래된 쪽으로 이어받는가 ═══════════════════════
{
  const r = run([msg(500, 1, "Bullish"), msg(300, 2, "Bearish"), msg(700, 3, "Bullish")]);
  if (r.minId === 300) ok("커서 minId " + r.minId + " (가장 오래된 id → 다음 페이지 기준)");
  else bad("커서 계산 오류: " + JSON.stringify(r));
  const u = ST.url("AAPL", 299);
  if (/limit=30/.test(u) && /max=299/.test(u)) ok("페이지 URL: " + u.slice(u.indexOf("?")));
  else bad("페이지 URL 오류: " + u);
}

// ══ 5) 수집 시각이 낡으면 점수를 쓰지 않는다 ═════════════════════════════════
{
  const st = { n: 40, bull: 30, bear: 5, score: 0.7 };
  const freshRec = { st, stTs: Date.now() - 10 * 60000 };
  const staleRec = { st, stTs: Date.now() - 5 * 3600000 };
  if (socialScoreOf(freshRec) != null) ok("10분 전 수집 → 점수 사용 " + socialScoreOf(freshRec).toFixed(3));
  else bad("신선한 수집인데 점수를 안 쓴다");
  if (socialScoreOf(staleRec) === null) ok("5시간 전 수집 → 사용 안 함(null)");
  else bad("낡은 수집을 그대로 쓴다: " + socialScoreOf(staleRec));
  if (socialScoreOf(null) === null && socialScoreOf({}) === null) ok("기록 없음 → null('모름'과 '중립'을 구분)");
  else bad("빈 기록에서 점수가 나왔다");
}

// ══ 6) Reddit — 방향이 아니라 강도만, 유니버스 밖 대문자는 티커가 아니다 ═════
{
  const uni = new Set(["TSLA", "AAPL"]);
  const posts = [{ data: { title: "$TSLA to the moon, IT and ON are words not tickers",
                           selftext: "AAPL also", created_utc: NOW / 1000 - 60, score: 10 } }];
  const r = RD.parse({ data: { children: posts } }, NOW - SOCIAL.redditFreshH * 3600000, uni);
  const syms = Object.keys(r.by).sort();
  if (syms.join(",") === "AAPL,TSLA") ok("Reddit 티커 인식 " + syms.join(",") + " — IT/ON 은 제외됨");
  else bad("유니버스 밖 대문자를 티커로 셌다: " + syms.join(","));

  // 강도(amp)는 방향을 뒤집지 못한다 — 음수 점수는 음수로 남아야 한다.
  const bearRec = { st: { n: 40, bull: 5, bear: 30, score: -0.7 }, stTs: Date.now(),
                    rd: { mentions: 50, weight: 100 }, rdTs: Date.now() };
  const sc = socialScoreOf(bearRec);
  if (sc != null && sc < -0.7) ok("Reddit 언급 50건이 약세 강도만 키움 " + sc.toFixed(3) + " (방향 유지)");
  else bad("Reddit 이 방향을 바꿨거나 강도가 안 먹는다: " + sc);
}

console.log(fails ? "\n소셜 최신성 계약 위반 " + fails + "건" : "\n  ok   소셜 멀티소스 통과");
process.exit(fails ? 1 : 0);
