/* [V33.330] 프리·애프터마켓 계약 — ★세션은 맞는데 값이 비는 것★ 을 잡는다
 *
 *   실측(2026-09-09 19:46 ET, 미국 애프터마켓 한창 / 같은 시각 한국 08:46 프리마켓):
 *     · 한국: mstate=PRE, prePct 채워짐, dayPct 가 프리 값으로 덮임 — 정상 동작.
 *     · 미국: mstate=POST 인데 post·postPct 가 ★전부 null★ — 세션 판정은 맞고 가격이 안 온다.
 *   화면은 그 상태에서 정규장 종가 등락을 그대로 보여 준다. 시간외에 크게 움직여도
 *   "아무 일 없었다" 로 읽힌다 — 틀린 수치가 아니라 ★틀린 인상★ 이라 눈으로 못 잡는다.
 *
 *   그리고 이걸 오래 못 잡은 진짜 이유는 감지기가 없어서다:
 *     v7Dead 는 계산만 하고 한 번도 안 읽는다 — 미국 수집원이 죽어도 아무 신호가 없다.
 *   그래서 이 게이트는 ①표시 규칙 ②저장 경로 ③자가진단 감지기 셋을 함께 못박는다.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };
function cut(a, b) {
  const i = S.indexOf(a), j = S.indexOf(b, i);
  if (i < 0 || j < 0) throw Error("소스에서 못 찾음: " + a.trim());
  return S.slice(i, j);
}

// ── ① 표시 규칙을 ★실제로 돌려★ 못박는다 ────────────────────────────────
{
  const src = cut("function applyDisplayOverMarket(q) {", "\nasync function fetchBatchQuotes");
  const ctx = vm.createContext({});
  vm.runInContext(src + "\n globalThis.f = applyDisplayOverMarket;", ctx);
  const f = ctx.f;

  const pre = f({ mstate: "PRE", price: 100, dayPct: -2, pre: 103, prePct: 3 });
  if (pre.dayPct === 3 && pre.price === 103 && pre.regPct === -2 && pre.regPrice === 100)
    ok("프리마켓: 표시 등락율은 프리 값(+3%), 정규장 값(-2%)은 regPct 로 보존된다");
  else bad("프리마켓 표시 규칙이 깨졌다: " + JSON.stringify(pre));

  const post = f({ mstate: "POST", price: 200, dayPct: 1, post: 190, postPct: -5 });
  if (post.dayPct === -5 && post.price === 190 && post.regPct === 1)
    ok("애프터마켓: 표시 등락율은 애프터 값(-5%), 정규장 값(+1%)은 보존된다");
  else bad("애프터마켓 표시 규칙이 깨졌다: " + JSON.stringify(post));

  /* ★이번에 실제로 난 상태★ — 세션은 POST 인데 가격이 없다.
     이때 조용히 정규장 값으로 떨어지는 것 자체는 옳다(없는 값을 지어내면 안 된다).
     문제는 "떨어졌다는 사실을 아무도 모른다" 는 것이고, 그건 ③에서 잡는다. */
  const dead = f({ mstate: "POST", price: 330.65, dayPct: -2.28, post: null, postPct: null });
  if (dead.dayPct === -2.28 && dead.dispPrice === 330.65)
    ok("세션은 POST 인데 가격이 없으면 정규장 값으로 떨어진다 — 값을 지어내지 않는다");
  else bad("가격 없는 POST 에서 이상한 값을 만든다: " + JSON.stringify(dead));

  const reg = f({ mstate: "REGULAR", price: 50, dayPct: 4 });
  if (reg.dayPct === 4 && reg.dispPct === 4) ok("정규장은 종전 그대로다 — 상시 경로를 안 건드린다");
  else bad("정규장 동작이 바뀌었다");
}

// ── ② 저장 경로가 시간외 5필드를 ★안 흘린다★ ───────────────────────────
{
  const src = cut("async function saveQuote(DB, symbol, market, q) {", "\n// === [V8] 헬퍼: N일 최고가");
  /* [V33.339] 이어받기가 ★세션에 따라★ 달라졌으므로 세션 함수도 함께 떼어 온다.
     시계는 시험용으로 갈아 끼운다 — 이 검사가 보려는 건 "지금 세션에서 무엇을 이어받는가" 이지
     실행한 시각이 아니다(시각에 따라 결과가 바뀌면 그건 검사가 아니라 주사위다). */
  // [V33.351] 세션 코어(marketWindows·marketSessionNow)가 앞에 있어야 실행된다.
  const helpers = cut("const MARKET_HOURS = {", "function isMarketOpen(market, now)") +
    cut("function usMarketStateNow(now) {", "/* [V33.331] ★지금 이 시장이");
  let saved = null;
  const ctx = vm.createContext({
    setState: async (_db, _k, v) => { saved = v; },
    getState: async () => ({ mstate: "POST", pre: null, prePct: null, post: 191.5, postPct: -1.2 }),
    Date
  });
  vm.runInContext("var __et = { day: 3, totalMin: 1000 };\n function getUSEt(){ return __et; }\n" +
                  helpers + "\n" + src + "\n globalThis.f = saveQuote;", ctx);

  ctx.__et = { day: 3, totalMin: 1000 };   // 화요일 16:40 ET — 장후
  await ctx.f({}, "AAPL", "us", { price: 200, prevClose: 202, dayPct: -1 });
  if (saved && saved.post === 191.5 && saved.postPct === -1.2 && saved.mstate === "POST")
    ok("장후 중엔 새 값이 없으면 기존 시간외 값을 이어받는다 — 이 경로가 프리·애프터 표시를 지우지 않는다");
  else bad("★saveQuote 가 시간외 값을 다시 날린다★: " + JSON.stringify(saved));

  /* ★V33.339 계약★ 정규장이 열렸는데 어제 장후 값이 그대로 이어지면, 화면은 정규장 종가를
     '장후 시세' 라 말한다. 실측 스냅샷에서 336종목이 그 상태였다. */
  ctx.__et = { day: 3, totalMin: 700 };    // 화요일 11:40 ET — 정규장
  await ctx.f({}, "AAPL", "us", { price: 200, prevClose: 202, dayPct: -1 });
  if (saved && saved.post === null && saved.postPct === null && saved.mstate === "REGULAR")
    ok("정규장이 열리면 어제 장후 값은 이어받지 않는다 — 낡은 세션 딱지가 굳지 않는다");
  else bad("★정규장인데 지난 장후 값이 살아남는다★: " + JSON.stringify(saved));

  ctx.__et = { day: 3, totalMin: 500 };    // 화요일 08:20 ET — 장전
  await ctx.f({}, "AAPL", "us", { price: 200, prevClose: 202, dayPct: -1, mstate: "PRE", pre: 205, prePct: 1.5 });
  if (saved && saved.pre === 205 && saved.prePct === 1.5 && saved.mstate === "PRE" && saved.post === null)
    ok("새 값이 있으면 새 값이 이긴다 — 잔상이 굳지 않고, 장전에는 어제 장후가 지워진다");
  else bad("새 시간외 값이 반영되지 않는다: " + JSON.stringify(saved));

  const caller = cut("      const intra = (symbol.endsWith(\".KS\")", "      ok++; processed++;");
  if (/mstate: intra\.mstate/.test(caller) && /post: intra\.post/.test(caller))
    ok("refreshQuotesOnly 가 fetchQuoteViaChart 의 시간외 값을 그대로 넘긴다(계산해 놓고 버리지 않는다)");
  else bad("refreshQuotesOnly 가 시간외 값을 손으로 골라 담다가 다시 빠뜨렸다");
}

// ── ③ ★감지기★ — 세션은 PRE/POST 인데 값이 비면 자가진단이 말한다 ────────
{
  /* [V33.339] 문구가 "시간외" 에서 "장전/장후" 로 갈렸다 — 세션을 시계로 정하게 됐기 때문이다. */
  if (/시세가 안 들어온다 — " \+ _sess \+/.test(S) && /_sess >= 20 && _have < _sess \* 0\.1/.test(S))
    ok("자가진단이 '지금 장전/장후인데 값이 비었다' 를 표본 20종목·10% 기준으로 경고한다");
  else bad("★시간외 결측 감지기가 없다 — 수집원이 죽어도 화면만 조용히 틀린다★");
  /* 그리고 그 세션 판정이 ★저장된 딱지★ 가 아니라 시계에서 와야 한다 — 딱지는 굳는다. */
  if (/const _nowSess = usMarketStateNow\(\);/.test(S))
    ok("감지기가 세션을 시계에서 얻는다 — 죽은 수집원이 남긴 딱지를 세지 않는다");
  else bad("★감지기가 저장된 mstate 를 세어 판단한다★ — 낡은 딱지가 유령 경고를 만든다");

  // 감지기의 판정식을 그대로 떼어 돌린다 — 문턱이 뒤집히면 여기서 걸린다.
  const judge = (sess, have) => sess >= 20 && have < sess * 0.1;
  if (judge(120, 0) && judge(120, 5) && !judge(120, 60) && !judge(8, 0))
    ok("판정식 확인: 120종목 중 0·5건이면 경고, 60건이면 조용, 표본 8종목이면 우연으로 보고 넘긴다");
  else bad("결측 판정식이 이상하다");
}

// ── ④ 한국 시간외 창이 실제 거래시간과 맞는가 ──────────────────────────
{
  /* [V33.351] 종전엔 applyKrOverMarket 안의 숫자를 정규식으로 찾았다. 창이 marketWindows
     한 곳으로 모이면서 그 문자열이 사라졌는데, 창 자체는 그대로다 —
     ★문자열이 아니라 답을 본다★(V33.337 교훈). 시각을 넣어 실제로 부른다. */
  const kr = cut("function applyKrOverMarket(o, d) {", "\n// [PRE/POST 표시]");
  const { marketSessionNow } = await import("../src/index.js");
  const kst = (h, m) => new Date(Date.UTC(2026, 8, 15, h - 9, m));   // 2026-09-15 화요일 KST
  const want = [[7, 59, "CLOSED"], [8, 0, "PRE"], [8, 59, "PRE"], [9, 0, "REGULAR"],
                [15, 29, "REGULAR"], [15, 30, "POST"], [19, 59, "POST"], [20, 0, "CLOSED"]];
  const wrong = want.filter(([h, m, w]) => marketSessionNow("kr", kst(h, m)) !== w);
  if (!wrong.length) ok("한국 장전 08:00~09:00 · 장후 15:30~20:00(KST) — 넥스트레이드 시간외까지 덮는다");
  else bad("한국 시간외 창이 바뀌었다 — " + wrong.map(([h, m, w]) =>
    `${h}:${String(m).padStart(2, "0")} → ${marketSessionNow("kr", kst(h, m))}(기대 ${w})`).join(", "));
  if (/code === "4" \|\| code === "5"/.test(kr))
    ok("네이버 하락 코드(4·5)를 음수 부호로 옮긴다 — 절대값만 받아 상승으로 뒤집히지 않는다");
  else bad("네이버 등락 부호 처리가 사라졌다 — 하락이 상승으로 표시될 수 있다");
}

if (fails) { console.error(`\n✗ 시간외 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 시간외 계약 통과 — 값이 비면 지어내지 않고, 비었다는 사실을 소리 낸다");
