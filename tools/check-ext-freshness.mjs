/* [V33.340] 시간외 체결가 신선도 — ★가드가 실제로 걸리는가★
 *
 *   V33.331~332 는 시간외 거래를 열면서 "낡은 값으로는 거래하지 않는다" 는 가드를 넣었다.
 *   설정에도 `freshMs: 420000` 이 있고 주석도 그렇게 적혀 있었다.
 *   ★그런데 그 가드는 한 번도 걸린 적이 없다.★
 *     extTradePrice 는 `q.ts` 를 읽는데, 거래 경로가 넘기는 quote 는 fetchBatchQuotes 가
 *     만든 객체다 — 거기엔 ts 필드가 아예 없다. `_ts > 0` 이 항상 거짓 → 검사 통째로 건너뜀.
 *     (DB 에 저장된 행에는 ts 가 있지만 그건 '가격 샤드가 마지막으로 쓴 시각' 이지
 *      체결 시각이 아니다 — 그 값을 썼어도 5시간 전 체결이 '방금' 으로 통과한다.)
 *   실측: extTradePrice({pre:100, prePct:1}, "pre", cfg) → 100 을 그대로 돌려준다.
 *
 *   ★왜 위험한가★ 얇은 종목은 프리마켓에 04:05 한 번 찍고 09:00 까지 체결이 없다.
 *   fetchExtendedQuoteUS 는 '창 안의 마지막 체결' 을 고르므로 그 04:05 값을 돌려주고,
 *   그 값으로 손절이 나가거나 신규 진입이 들어갔다.
 *
 *   무는 것: ①값을 만드는 세 경로가 전부 체결 시각을 싣는가 ②시각을 모르면 거래를 막는가
 *            ③낡으면 막고 신선하면 통과하는가 ④저장·복원에서 시각이 값과 함께 살고 죽는가
 *            ⑤표시 경로는 종전대로 마지막 체결을 계속 보여 주는가(둘은 다른 문제다)
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };
const cut = (a, b) => {
  const i = S.indexOf(a), j = S.indexOf(b, i + 1);
  if (i < 0 || j < 0) { bad(`★앵커가 소스에서 사라졌다: ${a.trim().slice(0, 60)}★`); return ""; }
  return S.slice(i, j);
};

// ── ① 값을 만드는 세 경로가 전부 체결 시각을 싣는가 ────────────────────
{
  const fx = cut("async function fetchExtendedQuoteUS(symbol) {", "\n// [프리/애프터마켓] 네이버");
  if (/o\.extTs = preT \* 1000;/.test(fx) && /o\.extTs = postT \* 1000;/.test(fx))
    ok("v8 분봉 경로 — 고른 ★봉의 시각★ 을 함께 싣는다(창 안 마지막 체결이 몇 시간 전일 수 있다)");
  else bad("★분봉 경로가 체결 시각을 안 싣는다★ — 몇 시간 전 체결을 '지금 값' 으로 내보낸다");
  if (/"preMarketTime", "postMarketTime"/.test(S))
    ok("v7 요청이 preMarketTime·postMarketTime 을 명시적으로 요구한다 — 안 물으면 안 준다");
  else bad("★v7 에 시간외 체결 시각을 요구하지 않는다★");
  if (/o\.extTs = row\.preMarketTime \* 1000/.test(S) && /o\.extTs = row\.postMarketTime \* 1000/.test(S))
    ok("v7 경로가 그 시각을 ms 로 맞춰 싣는다(야후는 초 단위 epoch 로 준다)");
  else bad("★v7 경로가 시간외 체결 시각을 버린다★");
  const kr = cut("function applyKrOverMarket(o, d) {", "\n// [PRE/POST 표시]");
  if (/o\.extTs = Date\.now\(\);/.test(kr))
    ok("KR 네이버 경로 — 폴링은 호출 시점 값이므로 그 시각을 적는다(시장마다 다른 규칙을 두지 않는다)");
  else bad("★KR 경로만 시각을 안 싣는다★ — 신선도 규칙이 시장마다 갈린다");
  /* 폴백(일봉 chart) 경로가 ★추측★ 으로 시간외를 만들지 않는지도 본다. */
  const vc = cut("async function fetchQuoteViaChart(symbol) {", "async function fetchQuoteViaChartFallback");
  if (!/5\.5 \* 3600/.test(vc)) ok("폴백 경로가 '정규장 5.5시간 전이면 장전' 손으로 적은 창을 더는 안 쓴다");
  else bad("★폴백이 아직 손으로 적은 5.5시간 창으로 세션을 추측한다★ — 야후가 창을 이미 준다");
  if (/_in\(_cp\.pre\)/.test(vc) && /_in\(_cp\.post\)/.test(vc) && /meta\.regularMarketTime/.test(vc))
    ok("폴백이 ★체결 시각이 pre/post 창 안인가★ 를 재서 판정한다 — 값의 차이로 추측하지 않는다");
  else bad("★폴백이 아직 값의 차이로 '시간외 체결' 을 추측한다★ — 일봉 갱신 지연을 시간외로 읽는다");
}

// ── ②③ ★가드를 실제로 돌린다★ ─────────────────────────────────────────
{
  const i = S.indexOf("function extTradePriceEx(q, session, cfg) {");
  const j = S.indexOf("// [V8.6] 엔진이 거래해도 되는 시간");
  if (i < 0 || j <= i) bad("★가드 본문을 못 잘라냈다 — 실행 검사를 못 한다★");
  else {
    const ctx = {
      DEFAULT_CFG: { extTrade: { minPrice: 3, maxMovePct: 12, freshMs: 420000 } },
      _num: (v, d) => (typeof v === "number" && isFinite(v)) ? v : d, isFinite, Date, console
    };
    vm.createContext(ctx);
    vm.runInContext(S.slice(i, j), ctx);
    const cfg = { extTrade: { minPrice: 3, maxMovePct: 12, freshMs: 420000 } };
    const P = (q, sess) => ctx.extTradePrice(q, sess || "pre", cfg);
    const W = (q, sess) => ctx.extTradePriceEx(q, sess || "pre", cfg).why;
    const now = Date.now();

    /* ★막은 값뿐 아니라 막은 이유도 못박는다.★ 자가진단은 이 이름표로
       "시장이 조용하다" 와 "수집이 고장났다" 를 가른다 — 이름표가 뭉개지면 그 구분이 사라진다.
       (돌연변이 시험에서 실제로 새어 나갔다: 시각 미상 분기를 죽여도 낡은값 검사가 대신
        막아 주므로 ★가격만 보면 통과★ 한다. 그러면 시각을 안 주기 시작한 사고가
        "낡은체결" 로 보고돼 원인을 엉뚱한 데서 찾게 된다.) */
    if (W({ pre: 100, prePct: 1 }) === "nots")
      ok("시각이 없으면 사유가 '시각미상' 이다 — '낡은체결' 과 섞이지 않는다");
    else bad(`★시각 미상을 다른 이름으로 보고한다(${W({ pre: 100, prePct: 1 })})★ — 수집 고장이 시장 정적으로 읽힌다`);
    if (W({ pre: 100, prePct: 1, extTs: now - 5 * 3600e3 }) === "stale")
      ok("시각은 아는데 낡았으면 사유가 '낡은체결' 이다");
    else bad("★낡은 체결을 다른 이름으로 보고한다★");
    if (W({ pre: null, prePct: null }) === "noprice")
      ok("체결 자체가 없으면 사유가 '체결없음' 이다 — 시간외의 정상 상태다");
    else bad("★체결없음을 다른 이름으로 보고한다★");
    if (W({ pre: 100, prePct: 1, extTs: now - 60000 }) === null)
      ok("통과할 때는 사유가 없다");
    else bad("★통과했는데 사유가 붙는다★");
    /* 문구표는 const 라 컨텍스트 속성으로 안 잡힌다 — 안에서 평가해 확인한다.
       그리고 표만 있는지가 아니라 ★세는 쪽이 쓰는 요약이 실제로 사유를 구분하는지★ 를 본다. */
    const summ = vm.runInContext(
      'extBlockSummary({ noprice: 30, nots: 12, stale: 3 })', ctx);
    if (/체결없음 30/.test(summ) && /시각 ?미상|★체결시각 미상★ 12/.test(summ) && /낡은체결 3/.test(summ))
      ok(`요약 한 줄이 사유를 구분해 적는다 — "${summ}"`);
    else bad(`★요약이 사유를 구분하지 못한다★ — "${summ}"`);

    /* ★종전 그대로의 입력★ — 배치가 만든 객체엔 시각이 없다. 이게 통과하면 회귀다. */
    if (P({ pre: 100, prePct: 1 }) === null)
      ok("시각을 모르는 값으로는 거래하지 않는다 — 배치가 만든 객체(시각 없음)가 막힌다");
    else bad("★시각 없는 값이 그대로 통과한다★ — 가드가 여전히 죽어 있다(회귀)");

    if (P({ pre: 100, prePct: 1, ts: now }) === null)
      ok("q.ts(가격 샤드가 쓴 시각)로는 통과하지 못한다 — 그건 체결 시각이 아니다");
    else bad("★q.ts 를 체결 시각으로 오인한다★ — 샤드가 덮어쓰면 5시간 전 값이 '방금' 이 된다");

    if (P({ pre: 100, prePct: 1, extTs: now - 5 * 3600e3 }) === null)
      ok("5시간 전 프리마켓 체결가는 막힌다 — 얇은 종목의 04:05 체결로 09:00 에 손절하지 않는다");
    else bad("★5시간 전 체결가로 거래한다★");

    if (P({ pre: 100, prePct: 1, extTs: now - 8 * 60000 }) === null)
      ok("문턱(7분) 바로 바깥(8분)도 막힌다");
    else bad("★문턱을 넘겼는데 통과한다★");

    if (P({ pre: 100, prePct: 1, extTs: now - 60000 }) === 100)
      ok("1분 전 체결가는 통과한다 — 가드가 정상 거래까지 막지는 않는다");
    else bad("★신선한 값까지 막는다★ — 시간외 거래가 통째로 멈춘다");

    if (P({ post: 200, postPct: -1, extTs: now - 60000 }, "post") === 200)
      ok("장후 경로도 같은 규칙으로 통과한다");
    else bad("★장후 경로가 막힌다★");

    // 기존 가드들이 그대로 사는지 — 신선하다고 다 통과하면 안 된다
    if (P({ pre: 2, prePct: 1, extTs: now }) === null) ok("초저가(<3) 가드가 그대로 산다");
    else bad("★초저가 가드가 죽었다★");
    if (P({ pre: 100, prePct: 20, extTs: now }) === null) ok("과대변동(>12%) 가드가 그대로 산다");
    else bad("★과대변동 가드가 죽었다★");
  }
}

// ── ④ 저장·복원에서 시각이 값과 함께 살고 죽는가 ──────────────────────
{
  const sq = cut("async function saveQuote(DB, symbol, market, q)", "\n// === [V8] 헬퍼: N일 최고가");
  if (/extTs: _keepExt\("extTs", _mask\.pre \|\| _mask\.post\)/.test(sq))
    ok("saveQuote 가 시각을 값과 같은 마스크로 이어받는다 — 짝이 어긋나지 않는다");
  else bad("★saveQuote 가 시각을 버리거나 값과 다른 규칙으로 지킨다★");
  if (/'\$\.extTs', CASE WHEN \?15 = 1 THEN NULL ELSE COALESCE\(\?14/.test(S))
    ok("가격 샤드도 시각을 함께 쓰고, 세션이 바뀌면 함께 지운다");
  else bad("★가격 샤드가 시각을 저장하지 않는다★ — DB 를 거치면 시각이 사라져 거래가 통째로 막힌다");
  if (/mstate: intra\.mstate[\s\S]{0,160}extTs: intra\.extTs/.test(S))
    ok("refreshQuotesOnly 도 시각을 넘긴다 — 손으로 필드를 골라 담다가 또 빠뜨리지 않는다");
  else bad("★refreshQuotesOnly 가 시각을 빠뜨린다★ — 이 경로로 저장된 종목은 시간외 거래가 막힌다");
  const nz = cut("function normalizeExtUS(o, state) {", "/* [V33.331] ★지금 이 시장이");
  if (/if \(!keep\.pre && !keep\.post\) o\.extTs = null;/.test(nz))
    ok("값이 지워지면 시각도 지워진다 — 다음 세션 값이 옛 시각을 물려받지 않는다");
  else bad("★값만 지우고 시각은 남긴다★ — 새 값이 낡은 시각을 쓰거나 그 반대가 된다");
}

// ── ⑤ 표시는 막지 않는다 — 화면에 남는 것과 돈을 거는 것은 다르다 ──────
{
  const dz = cut("function applyDisplayOverMarket(q) {", "async function fetchBatchQuotes(symbols, opts)");
  if (dz && !/extTs/.test(dz))
    ok("표시 경로는 신선도를 안 본다 — 마지막 체결을 계속 보여 준다(야후와 같은 규칙)");
  else bad("표시 경로까지 신선도로 막았다 — 마지막 체결이 화면에서 사라진다(과잉 수정)");
}

if (fails) { console.error(`\n✗ 시간외 신선도 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 시간외 신선도 통과 — 값이 언제 찍혔는지 모르면 그 값으로 거래하지 않는다");
