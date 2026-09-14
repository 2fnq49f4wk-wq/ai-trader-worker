/* [V33.351 · A-2 + A-8] 세션 창이 네 벌로 흩어져 있었고, 날짜별 예외를 아무도 몰랐다
 *
 *   A-2 — 같은 창이 코드 곳곳에 숫자로 박혀 있었다(미국 pre 420~570 / post 960~1200,
 *   한국 pre 480~540 / post 930~1200 이 각각 대여섯 군데). 한 곳을 고치면 나머지가 조용히
 *   갈라진다. 실제로 Codex V33.346 이 NXT 실제 체결창을 ★시세 경로에만★ 반영해,
 *   거래 세션 판정(extTradeSession)은 옛 창을 들고 있었다 — 두 층이 다른 시각을 믿었다.
 *
 *   A-8 — 창은 날마다 같지 않다.
 *     · 미국 반장 13:00 ET 마감: 2026-11-27 · 2026-12-24
 *       그날 13:00~16:00 을 정규장으로 믿으면 얼어붙은 종가로 거래하면서
 *       야후가 정확히 주고 있는 장후 체결가를 normalizeExtUS 가 지운다
 *     · 한국 수능일 전 일정 1시간 지연: 2026-11-19
 *       09:00~10:00 을 정규장으로(실제 휴장), 15:30~16:00 을 장후로(실제 정규장) 믿는다
 *
 *   이 게이트가 지키는 것:
 *     ① ★평범한 날에는 종전과 한 분도 다르지 않다★ — 옛 리터럴을 이 파일에 그대로 적어 두고
 *        하루 1,440분 × 두 시장 × 한 주를 전수 대조한다(회귀가 나면 바로 잡힌다).
 *     ② 특례일에는 실제로 달라진다 — 반장·수능일의 각 경계를 분 단위로 확인한다.
 *     ③ 모든 세션 함수가 ★같은 한 곳★ 을 본다 — 특례를 넣으면 전부 같이 움직인다.
 */
import {
  MARKET_HOURS, MARKET_HOURS_SPECIAL, marketWindows, marketSessionNow,
  isMarketOpen, isTradingWindow, isQuoteRefreshWindow, isExtendedHoursWindow,
  minutesToClose, isLLMTriggerWindow, extTradeSession, _extSessionAt, extKeepMaskFor,
  sessionElapsedFraction, marketMinutesUntilClose, extBuyGuard
} from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

/* ── 종전 구현을 ★그대로★ 옮겨 적는다(참조 구현). 새 코드와 분 단위로 대조한다. ── */
const OLD = {
  us: { pre: [420, 570], regular: [570, 960], post: [960, 1200], quoteEnd: 970, llmLead: 10 },
  kr: { pre: [480, 540], regular: [540, 930], post: [930, 1200], quoteEnd: 930, llmLead: 0 }
};
const oldSession = (mk, day, min) => {
  if (day < 1 || day > 5) return "CLOSED";
  const o = OLD[mk];
  if (min >= o.regular[0] && min < o.regular[1]) return "REGULAR";
  if (min >= o.pre[0] && min < o.pre[1]) return "PRE";
  if (min >= o.post[0] && min < o.post[1]) return "POST";
  return "CLOSED";
};

/* 시장 현지 시각 d일 h시 m분을 UTC Date 로. 미국은 ET(9월 = EDT, UTC−4), 한국은 KST(UTC+9). */
const atUS = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h + 4, mi));
const atKR = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h - 9, mi));

/* ── ① 평범한 주: 1분도 다르면 안 된다 ── */
{
  let diff = 0, checked = 0, firstDiff = null;
  // 2026-09-14(월) ~ 09-20(일) — 특례일이 아닌 평범한 한 주
  for (let d = 14; d <= 20; d++) {
    for (let min = 0; min < 1440; min++) {
      const h = Math.floor(min / 60), mi = min % 60;
      for (const [mk, at] of [["us", atUS], ["kr", atKR]]) {
        const when = at(2026, 9, d, h, mi);
        const t = mk === "us" ? new Date(when.getTime() - 4 * 3600000) : new Date(when.getTime() + 9 * 3600000);
        const dow = t.getUTCDay();
        const want = oldSession(mk, dow, min);
        const got = marketSessionNow(mk, when);
        checked++;
        if (got !== want) { diff++; if (!firstDiff) firstDiff = `${mk} 09-${d} ${h}:${String(mi).padStart(2, "0")} ${got}≠${want}`; }
      }
    }
  }
  ok(diff === 0, `평범한 한 주 전수 대조 ${checked.toLocaleString()}분 — 차이 ${diff}건${firstDiff ? " (" + firstDiff + ")" : ""}`);
}

/* ── ② 모든 세션 함수가 같은 한 곳을 본다 ── */
{
  const cfg = { extTrade: { enabled: true, entries: true, us: { pre: true, post: true }, kr: { pre: true, post: true } } };
  /* 평범한 날뿐 아니라 ★특례일★ 도 넣는다 — 어떤 함수가 자기만 옛 창을 들고 있으면
     평범한 날에는 안 드러나고 특례일에만 갈라진다. A-2 가 정확히 그렇게 숨어 있었다
     (Codex V33.346 이 시세 경로만 고쳤을 때 거래 판정이 옛 창을 들고 있었다).
     반장 2026-11-27 은 EST(UTC−5), 수능 2026-11-19 은 KST(UTC+9). */
  const atUSw = (h, mi) => new Date(Date.UTC(2026, 10, 27, h + 5, mi));
  const atKRw = (h, mi) => new Date(Date.UTC(2026, 10, 19, h - 9, mi));
  const cases = [
    ["us", atUS(2026, 9, 15, 10, 0), "REGULAR"], ["us", atUS(2026, 9, 15, 8, 0), "PRE"],
    ["us", atUS(2026, 9, 15, 17, 0), "POST"], ["us", atUS(2026, 9, 15, 21, 0), "CLOSED"],
    ["kr", atKR(2026, 9, 15, 10, 0), "REGULAR"], ["kr", atKR(2026, 9, 15, 8, 30), "PRE"],
    ["kr", atKR(2026, 9, 15, 17, 0), "POST"], ["kr", atKR(2026, 9, 15, 21, 0), "CLOSED"],
    // ★특례일★ — 옛 창을 들고 있는 함수가 있으면 여기서 갈라진다
    ["us", atUSw(12, 30), "REGULAR"], ["us", atUSw(14, 0), "POST"], ["us", atUSw(16, 30), "POST"],
    ["us", atUSw(18, 0), "CLOSED"],
    ["kr", atKRw(9, 30), "PRE"], ["kr", atKRw(11, 0), "REGULAR"], ["kr", atKRw(15, 45), "REGULAR"],
    ["kr", atKRw(17, 0), "POST"], ["kr", atKRw(20, 30), "POST"]
  ];
  let bad = 0;
  for (const [mk, when, want] of cases) {
    const sess = marketSessionNow(mk, when);
    const agree =
      sess === want &&
      isMarketOpen(mk, when) === (want === "REGULAR") &&
      isTradingWindow(mk, when) === (want === "REGULAR") &&
      isExtendedHoursWindow(mk, when) === (want === "PRE" || want === "POST") &&
      (extTradeSession(mk, cfg, when) === (want === "PRE" ? "pre" : want === "POST" ? "post" : null)) &&
      (_extSessionAt(mk, when.getTime()) === (want === "PRE" ? "pre" : want === "POST" ? "post" : null)) &&
      (extKeepMaskFor(mk, sess).post === (want === "POST" || want === "CLOSED"));
    if (!agree) { bad++; console.log(`       불일치 ${mk} ${when.toISOString()} sess=${sess}`); }
  }
  ok(bad === 0, `세션 함수 7종이 같은 답을 준다 (${cases.length}개 시점)`);
}

/* ── ③ 미국 반장(13:00 ET 마감) ── */
{
  const D = [2026, 11, 27];   // 추수감사절 다음날. ET = EST(UTC−5) 이지만 판정은 현지 분으로 한다.
  const at = (h, mi) => new Date(Date.UTC(D[0], D[1] - 1, D[2], h + 5, mi));
  ok(!!MARKET_HOURS_SPECIAL.us["2026-11-27"], "2026-11-27 이 특례표에 있다");
  ok(marketWindows("us", at(12, 0)).special != null, `특례로 인식된다: ${marketWindows("us", at(12, 0)).special}`);
  ok(marketSessionNow("us", at(12, 59)) === "REGULAR", "12:59 ET → 아직 정규장");
  ok(marketSessionNow("us", at(13, 0)) === "POST", "★13:00 ET → 장후★ (종전엔 정규장이라 믿었다)");
  ok(marketSessionNow("us", at(15, 30)) === "POST", "15:30 ET → 장후(종전엔 정규장)");
  ok(marketSessionNow("us", at(17, 0)) === "CLOSED", "17:00 ET → 휴장(반장의 장후는 17시에 끝난다)");
  ok(minutesToClose("us", at(12, 30)) === 30, `반장의 '마감까지 남은 분' 도 짧아진다: ${minutesToClose("us", at(12, 30))}분`);
  ok(!isQuoteRefreshWindow("us", at(13, 30)), "13:30 에는 정규장 시세창이 닫혀 있다");
  // ★핵심★ 그 시간대에 장후 값이 살아남는가(종전엔 normalizeExtUS 가 지웠다)
  ok(extKeepMaskFor("us", marketSessionNow("us", at(14, 0))).post === true,
     "★14:00 ET 에 장후 체결가가 보존된다★ — 종전엔 REGULAR 로 보고 지웠다");
  // 평범한 금요일은 그대로
  const nd = (h, mi) => new Date(Date.UTC(2026, 10, 20, h + 5, mi));
  ok(marketSessionNow("us", nd(14, 0)) === "REGULAR", "특례가 아닌 금요일 14:00 은 여전히 정규장");
}

/* ── ④ 한국 수능일(전 일정 1시간 지연) ── */
{
  const at = (h, mi) => new Date(Date.UTC(2026, 10, 19, h - 9, mi));
  ok(!!MARKET_HOURS_SPECIAL.kr["2026-11-19"], "2026-11-19(수능) 이 특례표에 있다");
  ok(marketSessionNow("kr", at(9, 30)) === "PRE", "★09:30 → 장전★ (종전엔 정규장이라 믿었다)");
  ok(marketSessionNow("kr", at(10, 0)) === "REGULAR", "10:00 → 정규장(1시간 지연 개장)");
  ok(marketSessionNow("kr", at(15, 45)) === "REGULAR", "★15:45 → 정규장★ (종전엔 장후라 믿었다)");
  ok(marketSessionNow("kr", at(16, 0)) === "POST", "16:00 → 장후");
  ok(marketSessionNow("kr", at(21, 0)) === "CLOSED", "21:00 → 휴장");
  ok(minutesToClose("kr", at(15, 0)) === 60, `마감까지 남은 분이 16:00 기준이다: ${minutesToClose("kr", at(15, 0))}분`);
  ok(isLLMTriggerWindow("kr", at(10, 30)) && !isLLMTriggerWindow("kr", at(9, 30)),
     "LLM 트리거 창도 같이 밀린다(09:30 밖 · 10:30 안)");
  const nd = (h, mi) => new Date(Date.UTC(2026, 10, 18, h - 9, mi));
  ok(marketSessionNow("kr", nd(9, 30)) === "REGULAR", "전날(11-18)은 여전히 09:30 정규장");
}

/* ── ⑤ 표 자체의 위생 ── */
{
  let bad = [];
  for (const mk of Object.keys(MARKET_HOURS_SPECIAL)) {
    for (const [day, sp] of Object.entries(MARKET_HOURS_SPECIAL[mk])) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) bad.push(`${mk} ${day}: 날짜 형식`);
      for (const k of ["pre", "regular", "post"]) {
        const w = sp[k];
        if (w && (!Array.isArray(w) || w.length !== 2 || !(w[0] < w[1]) || w[0] < 0 || w[1] > 1560))
          bad.push(`${mk} ${day}.${k}: 창이 이상하다 ${JSON.stringify(w)}`);
      }
      const m = marketWindows(mk, null);
      if (!sp.why) bad.push(`${mk} ${day}: why(사유)가 없다 — 왜 특례인지 적지 않으면 다음 사람이 못 지운다`);
      const full = { ...MARKET_HOURS[mk], ...sp };
      if (full.regular[1] > full.post[0] + 1e-9 && sp.post) bad.push(`${mk} ${day}: 정규장 끝이 장후 시작보다 늦다`);
    }
  }
  ok(bad.length === 0, bad.length ? `특례표 문제: ${bad.join(" / ")}` : `특례표 ${Object.values(MARKET_HOURS_SPECIAL).reduce((a, o) => a + Object.keys(o).length, 0)}건 형식·사유·순서 정상`);
  // 다가오는 특례일이 남아 있는가 — 표가 비면 그날 조용히 틀린다
  const future = Object.values(MARKET_HOURS_SPECIAL)
    .flatMap((o) => Object.keys(o)).filter((d) => new Date(d + "T00:00:00Z") > new Date());
  ok(future.length > 0, `아직 오지 않은 특례일 ${future.length}건이 표에 있다 (${future.slice(0, 3).join(", ")}…)`);
}

/* ── ⑤-b 창 ★길이★ 를 쓰는 계산도 그날 창을 따라가는가 ──
   경과율의 분모(정규장 길이)를 390 으로 박아 두면, 반장(210분)·수능일(360분)에
   당일봉 거래량 환산이 어긋난다. 경계 숫자 검사로는 안 잡히는 종류라 따로 본다. */
{
  const nrm = (h, mi) => new Date(Date.UTC(2026, 8, 15, h - 9, mi));     // 평범한 화요일 KST
  const hlf = (h, mi) => new Date(Date.UTC(2026, 10, 27, h + 5, mi));    // 미국 반장 ET
  const su = (h, mi) => new Date(Date.UTC(2026, 10, 19, h - 9, mi));     // 한국 수능일 KST
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(near(sessionElapsedFraction("kr", nrm(12, 15)), 195 / 390),
     `평범한 날 경과율은 종전과 같다 (${sessionElapsedFraction("kr", nrm(12, 15)).toFixed(4)} = 195/390)`);
  ok(near(sessionElapsedFraction("us", hlf(12, 0)), 150 / 210),
     `★반장 경과율의 분모가 210분★ — 12:00 ET → ${sessionElapsedFraction("us", hlf(12, 0)).toFixed(4)} (390 고정이면 0.3846)`);
  ok(near(sessionElapsedFraction("kr", su(13, 0)), 180 / 360),
     `★수능일 경과율의 분모가 360분★ — 13:00 → ${sessionElapsedFraction("kr", su(13, 0)).toFixed(4)}`);
  ok(sessionElapsedFraction("us", hlf(14, 0)) === null, "반장 14:00 은 정규장 밖이라 null");
  ok(marketMinutesUntilClose("us", hlf(12, 30)) === 30, "marketMinutesUntilClose 도 같은 답을 낸다(두 벌이 아니다)");
}

/* ── ⑤-c 세션 시작 시각을 쓰는 곳도 그날 창을 따라가는가 ──
   시간외 진입의 '세션당 신규 종목 수' 는 세션 시작부터 지금까지를 센다.
   그 시작 분만 옛 숫자면, 반장 날엔 엉뚱한 창(16:00~)에서 세게 된다. */
{
  const hlf = (h, mi) => new Date(Date.UTC(2026, 10, 27, h + 5, mi));
  let asked = null;
  const DB = { prepare: () => ({ bind: (...b) => { asked = b; return { first: async () => ({ n: 0 }) }; } }) };
  const cfg = { extTrade: { enabled: true, entries: true, minPickP: 0.5, sizeMult: 0.5, maxNewPerSession: 2,
                            us: { pre: true, post: true }, kr: { pre: true, post: true } } };
  const now = hlf(14, 0).getTime();   // 반장의 장후(13:00 시작)
  /* 체결 시각(extTs)의 신선도는 ★실제 지금★ 을 기준으로 본다(V33.340) — 그래서 거기에는
     진짜 Date.now() 를 넣는다. 세션 판정만 반장 날 시각으로 돌린다. */
  const r = await extBuyGuard(DB, "us", 10, 100, { mlMindP: 0.9 }, cfg,
                              { quote: { mstate: "POST", post: 100, postPct: 0.5, extTs: Date.now() } }, now);
  const startTs = asked ? asked[1] : null;
  const startHourET = startTs != null ? new Date(startTs - 5 * 3600000).getUTCHours() : null;
  ok(startHourET === 13,
     `★반장의 장후 세션 시작을 13:00 ET 로 센다★ (실제 ${startHourET}시 · 옛 숫자면 16시)`);
  ok(r && typeof r.ok === "boolean", `가드가 답을 낸다 (ok=${r && r.ok} why=${r && r.why || "-"})`);
}

/* ── ⑥ 소스에 창 숫자가 다시 박히지 않았는가 ──
   A-2 의 본질은 "같은 창이 여러 벌" 이다. 한 곳으로 모아 놨어도 누가 다시 숫자를 박으면
   그 순간 갈라지기 시작한다. 세션 경계 분(420·480·540·570·930·960·1200)이
   MARKET_HOURS/MARKET_HOURS_SPECIAL 밖의 세션 판정 코드에 나타나면 실패시킨다.
   ※ 무관한 숫자(예산·타임아웃 등)와 섞이지 않게 totalMin 비교 형태만 본다. */
{
  const { readFileSync } = await import("node:fs");
  const SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const t0 = SRC.indexOf("const MARKET_HOURS = {");
  const t1 = SRC.indexOf("function marketLocalTime(");
  const table = SRC.slice(t0, t1);          // 표 자체는 숫자를 가져야 한다 — 여기만 예외
  /* 세션이 아니라 ★크론 트리거 창★ 인 두 함수는 뺀다 — 우연히 같은 숫자를 쓸 뿐,
     장이 몇 시에 열리는가와 무관하다(매크로 수집 07:00~09:00 · 원자재 16:00~17:00 KST).
     빼는 것도 이름으로 명시한다 — "예외가 있다" 를 코드가 말하게 한다. */
  const NOT_SESSION = ["function isMacroTriggerTime()", "function isCommodityTriggerTime()"];
  let body = SRC.slice(0, t0) + SRC.slice(t1);
  for (const fn of NOT_SESSION) {
    const i = body.indexOf(fn);
    if (i >= 0) { const j = body.indexOf("\n}", i); if (j > i) body = body.slice(0, i) + body.slice(j); }
  }
  const rest = body;
  const BOUND = [420, 480, 540, 570, 930, 960, 1200];
  const hits = [];
  const re = /totalMin\s*(>=|<|>|<=)\s*(\d+)/g;
  let m;
  while ((m = re.exec(rest)) !== null) {
    if (BOUND.includes(Number(m[2]))) {
      const line = rest.slice(0, m.index).split("\n").length;
      hits.push(`${m[0]} (재구성 줄 ${line})`);
    }
  }
  ok(hits.length === 0, hits.length
    ? `세션 경계 숫자가 표 밖에 다시 박혔다 — A-2 재발: ${hits.slice(0, 4).join(", ")}`
    : "세션 경계 분이 MARKET_HOURS 표 밖에서는 쓰이지 않는다(창이 한 벌이다)");
  ok(/420/.test(table) && /1200/.test(table), "표 안에는 당연히 숫자가 있다(대조군)");
}

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
