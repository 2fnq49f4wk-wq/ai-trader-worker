/* [V33.331] 시간외 거래 계약 — ★가격·시각·집행★ 셋을 함께 못박는다
 *
 *   사용자 지시: "에프터랑 프리 가격 들어오게 하고, 서머타임도 자동으로, 거래도 시간외에서."
 *   시간외는 정규장과 성질이 다르다. 호가가 얇아 한 호가에 몇 %가 튀고 오입력도 잦다.
 *   그래서 이 게이트가 지키는 것은 "시간외에 거래가 된다" 가 아니라
 *   ★값이 미덥지 않으면 거래하지 않는다★ 는 쪽이다. 특히 다음 하나가 핵심이다:
 *     시간외 가격이 없을 때 ★정규장 가격으로 조용히 떨어지면 안 된다.★
 *     그건 "16시에 본 값으로 20시에 판다" 는 뜻이고, 시간외에 20% 빠진 종목을
 *     멀쩡한 값으로 사고파는 사고가 된다. 없으면 없는 대로 쉬는 게 맞다.
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
const _num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// ── ① 서머타임을 손으로 계산하지 않는다 ──────────────────────────────────
{
  const src = cut("const __tzFmt = {};", "// [V8.6] 미국 ET 분 단위 시각");
  const ctx = vm.createContext({ Intl, Date, Object, Number, Math, isFinite });
  vm.runInContext(src + "\n globalThis.f = getUSEtOffset;", ctx);
  const cases = [
    ["2026-01-15T12:00:00Z", -5], ["2026-03-08T06:59:00Z", -5], ["2026-03-08T07:01:00Z", -4],
    ["2026-07-01T12:00:00Z", -4], ["2026-11-01T05:59:00Z", -4], ["2026-11-01T06:01:00Z", -5],
    ["2027-03-14T07:01:00Z", -4], ["2027-11-07T06:01:00Z", -5], ["2028-03-12T07:01:00Z", -4]
  ];
  const wrong = cases.filter(([iso, w]) => ctx.f(new Date(iso)) !== w);
  if (!wrong.length) ok(`DST 전환 경계 ${cases.length}건 전부 맞다(2026~2028 봄·가을 전환 포함)`);
  else bad(`DST 판정이 틀린다: ${wrong.map(([i, w]) => i + "(기대 " + w + ")").join(", ")}`);

  if (/_tzOffsetHours\(now, "America\/New_York"\)/.test(S))
    ok("표준시 DB(IANA)에 먼저 묻는다 — 규칙이 바뀌어도 코드를 안 고쳐도 된다");
  else bad("★DST 를 손계산에만 의존한다 — 규칙이 바뀌면 조용히 틀린다★");
  if (/nthSundayOfMonth/.test(S)) ok("Intl 이 없는 환경을 위한 손계산 폴백이 남아 있다");
  else bad("폴백이 사라졌다 — Intl 이 막힌 런타임에서 세션 판정이 통째로 죽는다");
}

// ── ② 시간외 세션 판정 ───────────────────────────────────────────────────
{
  const src = cut("function extTradeSession(market, cfg) {", "\n/* [V33.331] 시간외 거래에 쓸 가격을");
  const ctx = vm.createContext({
    DEFAULT_CFG: { extTrade: { enabled: true, us: { pre: true, post: true }, kr: { pre: true, post: true } } },
    getUSEt: (d) => ({ day: d.__day, totalMin: d.__min }),
    getKST: (d) => ({ day: d.__day, totalMin: d.__min }),
    Date: function (){ return globalThis.__now; }
  });
  ctx.Date = function () { return ctx.__now; };
  vm.runInContext(src + "\n globalThis.f = extTradeSession;", ctx);
  const at = (day, min) => { ctx.__now = { __day: day, __min: min }; };
  const cfgOn = { extTrade: { enabled: true, us: { pre: true, post: true }, kr: { pre: true, post: true } } };

  at(3, 500); if (ctx.f("us", cfgOn) === "pre") ok("미국 08:20 ET → pre(프리 07:00~09:30)"); else bad("미국 프리 판정 실패");
  at(3, 1100); if (ctx.f("us", cfgOn) === "post") ok("미국 18:20 ET → post(애프터 16:00~20:00)"); else bad("미국 애프터 판정 실패");
  at(3, 700); if (ctx.f("us", cfgOn) === null) ok("정규장(11:40 ET) 중엔 시간외 세션이 아니다 — 두 경로가 겹치지 않는다"); else bad("정규장이 시간외로 잡힌다");
  at(3, 1250); if (ctx.f("us", cfgOn) === null) ok("20:50 ET(애프터 종료 후)는 거래하지 않는다"); else bad("애프터 종료 후에도 거래한다");
  at(6, 1100); if (ctx.f("us", cfgOn) === null) ok("토요일은 시간외도 없다"); else bad("주말에 시간외 거래를 연다");
  at(3, 500); if (ctx.f("kr", cfgOn) === "pre") ok("한국 08:20 KST → pre(장전 08:00~09:00)"); else bad("한국 장전 판정 실패");
  at(3, 1000); if (ctx.f("kr", cfgOn) === "post") ok("한국 16:40 KST → post(장후 15:30~20:00, 넥스트레이드 포함)"); else bad("한국 장후 판정 실패");

  at(3, 1100);
  if (ctx.f("us", { extTrade: { enabled: false, us: { pre: true, post: true } } }) === null)
    ok("enabled:false 면 시간외 거래가 통째로 닫힌다 — 되돌릴 스위치가 실제로 동작한다");
  else bad("★끄는 스위치가 안 먹는다★");
  if (ctx.f("us", { extTrade: { enabled: true, us: { pre: true, post: false } } }) === null)
    ok("세션별로 따로 끌 수 있다(애프터만 끄기)");
  else bad("세션별 스위치가 안 먹는다");
}

// ── ③ ★가격 가드★ — 미덥지 않으면 거래하지 않는다 ──────────────────────
{
  const src = cut("function extTradePrice(q, session, cfg) {", "\n// [V8.6] 엔진이 거래해도 되는 시간");
  const ctx = vm.createContext({
    DEFAULT_CFG: { extTrade: { minPrice: 3, maxMovePct: 12, freshMs: 420000 } },
    _num, Date, isFinite
  });
  vm.runInContext(src + "\n globalThis.f = extTradePrice;", ctx);
  const cfg = { extTrade: { minPrice: 3, maxMovePct: 12, freshMs: 420000 } };
  const now = Date.now();

  if (ctx.f({ price: 330, post: 300, postPct: -9.1, ts: now }, "post", cfg) === 300)
    ok("정상 애프터 값(-9.1%)은 그대로 쓴다 — 큰 하락이라고 무시하지 않는다");
  else bad("정상 시간외 값을 못 쓴다");

  // ★핵심★ — 값이 없을 때 정규장 가격으로 떨어지면 안 된다
  const none = ctx.f({ price: 330.65, dayPct: -2.28, post: null, postPct: null, ts: now }, "post", cfg);
  if (none === null) ok("★시간외 값이 없으면 null — 정규장 가격으로 조용히 떨어지지 않는다★");
  else bad(`★시간외 값이 없는데 ${none} 을 돌려준다 — 16시 값으로 20시에 거래하게 된다★`);

  if (ctx.f({ post: 300, postPct: -30, ts: now }, "post", cfg) === null)
    ok("변동 -30%(상한 12% 초과)는 손대지 않는다 — 이상호가·오입력 방어");
  else bad("비정상 변동에도 거래한다");
  if (ctx.f({ post: 1.2, postPct: -1, ts: now }, "post", cfg) === null)
    ok("초저가(1.2달러)는 시간외 스프레드를 감당 못 해 제외한다");
  else bad("초저가 종목을 시간외에 거래한다");
  if (ctx.f({ post: 300, postPct: -1, ts: now - 900000 }, "post", cfg) === null)
    ok("15분 지난 값으로는 거래하지 않는다(신선도 7분)");
  else bad("★낡은 가격으로 거래한다★");
  if (ctx.f({ pre: 205, prePct: 1.5, ts: now }, "pre", cfg) === 205)
    ok("프리 세션은 pre 값을 쓴다(post 와 섞이지 않는다)");
  else bad("프리/애프터 값이 섞인다");
  if (ctx.f({ pre: 205, prePct: 1.5, ts: now }, "post", cfg) === null)
    ok("애프터 세션인데 pre 값만 있으면 거래하지 않는다");
  else bad("세션과 다른 값을 끌어다 쓴다");
}

// ── ④ 분봉에서 시간외 체결가를 실제로 뽑는다 ────────────────────────────
{
  const src = cut("async function fetchExtendedQuoteUS(symbol) {", "\n// [프리/애프터마켓] 네이버 realtime");
  const nowSec = Math.floor(Date.now() / 1000);
  const reg = { start: nowSec - 7200, end: nowSec - 3600 };
  const pre = { start: nowSec - 14400, end: reg.start };
  const post = { start: reg.end, end: nowSec + 3600 };          // 지금은 애프터 한복판
  const ctx = vm.createContext({
    Date, Math, isFinite, encodeURIComponent,
    yahooFetch: async () => ({ chart: { result: [{
      meta: { currentTradingPeriod: { pre, regular: reg, post },
              chartPreviousClose: 100, regularMarketPrice: 110 },
      timestamp: [pre.start + 60, reg.start + 60, reg.end + 60, reg.end + 600],
      indicators: { quote: [{ close: [98, 105, 111, 99] }] }
    }] } })
  });
  vm.runInContext(src + "\n globalThis.f = fetchExtendedQuoteUS;", ctx);
  const r = await ctx.f("TEST");
  if (r && r.mstate === "POST" && r.post === 99 && Math.abs(r.postPct - (-10)) < 0.001)
    ok("분봉에서 애프터 마지막 체결(99)을 뽑고 정규장 종가(110) 대비 -10.00% 로 계산한다");
  else bad("애프터 체결 추출이 틀렸다: " + JSON.stringify(r));

  // 시간외 창 밖이면 값을 만들지 않는다
  const ctx2 = vm.createContext({
    Date, Math, isFinite, encodeURIComponent,
    yahooFetch: async () => ({ chart: { result: [{
      meta: { currentTradingPeriod: { pre: { start: 1, end: 2 }, regular: { start: nowSec - 60, end: nowSec + 60 }, post: { start: nowSec + 3600, end: nowSec + 7200 } },
              chartPreviousClose: 100, regularMarketPrice: 110 },
      timestamp: [nowSec - 30], indicators: { quote: [{ close: [110] }] }
    }] } })
  });
  vm.runInContext(src + "\n globalThis.f = fetchExtendedQuoteUS;", ctx2);
  if ((await ctx2.f("TEST")) === null) ok("정규장 중에는 시간외 값을 만들어내지 않는다");
  else bad("정규장 중에 시간외 값을 지어낸다");
}

// ── ⑤ 수집: v7 에 시간외 필드를 실제로 요구하는가 ───────────────────────
{
  if (/preMarketPrice", "preMarketChangePercent"/.test(S) && /postMarketPrice", "postMarketChangePercent"/.test(S))
    ok("v7 요청이 preMarket·postMarket 필드를 명시적으로 요구한다(안 물으면 안 준다 — V33.330 의 원인)");
  else bad("★v7 에 시간외 필드를 요구하지 않는다 — 기본 필드셋만 받는다★");
  const blk = cut("let v7Dead = false, v7Fields = true, v7First = 0;", "// --- 2) v7 으로 채워지지 않은");
  if (/v7Url\(slices\[0\], true\)/.test(blk) && /v7Fields = false;/.test(blk) && /v7Url\(slices\[0\], false\)/.test(blk))
    ok("fields= 를 거부하는 환경이면 필드 없이 한 번 더 본 뒤에야 v7 이 죽었다고 판정한다");
  else bad("fields= 가 거부되면 v7 을 통째로 포기한다 — 있는 길을 스스로 닫는다");
  if (/setState\(opts\.DB, "yahoo_v7"/.test(S))
    ok("v7 상태를 기록한다 — 종전엔 v7Dead 를 계산만 하고 안 읽어 수집원이 죽어도 신호가 없었다");
  else bad("v7 생사 신호가 여전히 없다");
}

// ── ⑥ 집행: 시간외에 청산·진입이 실제로 열리는가 ────────────────────────
{
  if (/let usCanTrade = isTradingWindow\("us"\) \|\| !!_usExtSess;/.test(S))
    ok("시간외 세션이 거래가능 시장 명단에 들어간다");
  else bad("시간외에 거래 명단이 안 열린다");
  const fw = cut("async function runFastWatch(env, cronStart) {", "\n// [V25 감사 A]");
  if (/const _s = extTradeSession\(_m, cfg\);/.test(fw))
    ok("fastWatch 가 시간외 세션을 스스로 판정한다 — 메인 사이클 명단이 낡아도 감시가 안 쉰다");
  else bad("시간외 감시가 남의 기록(fastwatch:markets)에만 의존한다");
  if (/price = extTradePrice\(q, _xs, cfg\);\n\s*if \(price == null\) continue;/.test(fw))
    ok("청산 판단이 시간외 체결가로 이뤄지고, 값이 없으면 그 종목을 건너뛴다");
  else bad("★청산이 정규장 가격으로 판단된다 — 시간외 급락을 못 본다★");
  if (/ai_picks:" \+ market/.test(fw) && /minPickP/.test(fw))
    ok("시간외 진입은 그날 위원회가 통과시킨 종목에서만 고른다(새 판단을 시간외에 내리지 않는다)");
  else bad("시간외에 아무 종목이나 진입한다");
  if (/_num\(_et\.maxNewPerSession, 2\) - _num\(_ctr\.n, 0\)/.test(fw) && /ext_entry:/.test(fw))
    ok("세션당 신규 진입 상한을 D1 카운터로 센다 — 틱·크론을 넘어 누적된다");
  else bad("시간외 진입 상한이 세션 전체로 안 걸린다");
  if (/_num\(_et\.sizeMult, 0\.5\)/.test(fw))
    ok("시간외 진입 크기를 배수로 줄인다 — 얇은 호가에 전액을 싣지 않는다");
  else bad("시간외에도 정규장과 같은 크기로 산다");
  if (/_extEntryOn = !!\(cfg\.extTrade && cfg\.extTrade\.enabled !== false && cfg\.extTrade\.entries !== false\)/.test(fw))
    ok("entries:false 로 두면 청산만 한다 — 보수적으로 쓸 여지를 남긴다");
  else bad("청산만 하는 설정이 없다");

  /* ★정규장 진입에 걸린 상한을 시간외라고 건너뛰면 안 된다.★
     이 경로는 메인 루프 밖이라 동시보유·현금·중복을 스스로 세야 한다 —
     빠지면 "시간외에만 포지션이 불어나는" 구멍이 되고, 그건 눈에 안 띈다. */
  if (/_openN >= _maxConc\) break;/.test(fw) && /COUNT\(DISTINCT symbol\) n FROM positions WHERE market/.test(fw))
    ok("시간외 진입도 동시보유 상한(maxConcurrent)을 지킨다 — 메인 루프 밖이라 직접 센다");
  else bad("★시간외 진입이 동시보유 상한을 건너뛴다 — 시간외에만 포지션이 불어난다★");
  if (/_openN = 9999;/.test(fw))
    ok("보유 수를 못 세면 사지 않는다 — 모르면 쉰다");
  else bad("보유 수 조회가 실패해도 진입을 강행한다");
  if (/_num\(cash\[market\], 0\) \* \(_num\(_sz\.maxPositionPct/.test(fw) && /_qty \* _px > _num\(cash\[market\], 0\)/.test(fw))
    ok("매수마다 줄어든 현금을 다시 읽는다 — 두 번째 매수가 없는 돈을 쓰지 않는다");
  else bad("현금을 루프 밖에서 한 번만 읽는다 — 연속 매수가 잔고를 넘길 수 있다");
  if (/_extBought\.has\(market \+ "\|" \+ _sym\)/.test(fw) && /_extBought\.add\(market \+ "\|" \+ _sym\)/.test(fw))
    ok("같은 종목을 이 호출에서 두 번 사지 않는다(틱이 5번 돌아도 한 번)");
  else bad("★한 호출 안에서 같은 종목을 여러 틱에 걸쳐 반복 매수할 수 있다★");
}

if (fails) { console.error(`\n✗ 시간외 거래 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 시간외 거래 계약 통과 — 값이 미덥지 않으면 거래하지 않는다");
