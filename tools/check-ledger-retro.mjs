/* [V33.354 · D-1] 비용 함수의 ★데이터★ 변경이 원장을 소급해서 다시 쓴다
 *
 *   현금은 저장하지 않고 trades 원장을 ★매번 재생★ 해서 만든다(computeCashFromTrades).
 *   그래서 비용 함수가 과거 체결에 대해 다른 답을 내기 시작하면 ★잔고가 소급해서 바뀐다.★
 *   V33.87 이 그걸 알고 세율·슬리피지 ★규칙★ 에는 시행일 상수를 뒀다
 *   (ETF_TAX_EXEMPT_FROM · SLIPPAGE_FROM · EXT_SLIP_FROM).
 *
 *   ★그런데 "무엇이 ETF 인가" 를 정하는 집합 자체에는 날짜가 없었다.★
 *   한국 종목을 ETF_SYMBOLS 에 나중에 넣으면 시행일 이후의 과거 매도 전부가 비과세로
 *   재계산된다. 게다가 cash_ckpt 가 과거를 얼려 두므로 같은 원장이 체크포인트를 경계로
 *   ★두 규칙으로 계산된다.★
 *
 *   ※ git 이력 확인: 최근 200 커밋 동안 ETF_SYMBOLS 내용은 바뀌지 않았다 —
 *     즉 아직 사고가 난 적은 없고, 구조만 열려 있었다. (D-1 의 '미확인' 항목이 이것이다.)
 *
 *   이 게이트가 지키는 것:
 *     ① 기준 목록에 없는 한국 ETF 가 새로 들어오면 ★시행일을 함께 적었는가★
 *     ② 시행일이 말이 되는가(면제 시행일 이후 · 먼 미래가 아님)
 *     ③ 시행일이 ★실제로 동작하는가★ — 함수를 돌려 과거/이후를 갈라 본다
 *     ④ 같은 체결 시각은 언제 물어도 같은 답(회계 결정성)
 */
import { ETF_TAX_MEMBER_FROM, ETF_TAX_EXEMPT_FROM, ETF_SYMBOLS, _etfTaxExemptAt, _krSellTaxRate } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

/* 2026-09-14 기준 ETF_SYMBOLS 안의 한국 종목. 이 목록은 ★시행일 없이도 면제★ 다 —
   ETF_TAX_EXEMPT_FROM(2026-08-02) 부터 쭉 ETF 였기 때문이다.
   여기 없는 종목이 집합에 들어오면 그건 '나중에 인정한 것' 이므로 날짜가 필요하다. */
const BASELINE = new Set(["0183J0.KS","069500.KS","091160.KS","091170.KS","102110.KS","114800.KS",
  "117460.KS","122630.KS","130680.KS","132030.KS","133690.KS","192090.KS","229200.KS","232080.KS",
  "233740.KS","251340.KS","252670.KS","305540.KS","305720.KS","329200.KS","360750.KS","371460.KS",
  "379800.KS","379810.KS","381170.KS","381180.KS","441680.KS","463250.KS"]);

const krNow = [...ETF_SYMBOLS].filter((s) => /\.(KS|KQ)$/.test(s));
ok(krNow.length > 0, `ETF_SYMBOLS 안의 한국 종목 ${krNow.length}개를 읽었다`);

// ① 새로 들어온 종목은 시행일이 있어야 한다
{
  const added = krNow.filter((s) => !BASELINE.has(s) && ETF_TAX_MEMBER_FROM[s] == null);
  ok(added.length === 0, added.length
    ? `★ETF_SYMBOLS 에 새로 들어왔는데 시행일이 없다: ${added.join(", ")}★ — ` +
      "이대로 두면 시행일 이후의 과거 매도가 전부 비과세로 재계산된다. " +
      "ETF_TAX_MEMBER_FROM 에 넣은 날짜를 적고, 이 게이트의 BASELINE 은 그대로 둘 것."
    : "새로 들어온 한국 ETF 가 없거나, 들어온 것은 전부 시행일을 갖는다");
  const gone = [...BASELINE].filter((s) => !ETF_SYMBOLS.has(s));
  ok(gone.length === 0, gone.length
    ? `기준 목록에 있던 종목이 집합에서 빠졌다: ${gone.join(", ")} — 빼는 것도 소급이다(과거 매도가 다시 과세된다)`
    : "기준 목록의 종목이 그대로 남아 있다");
}

// ② 시행일이 말이 되는가
{
  const bad = [];
  const farFuture = Date.now() + 365 * 86400000;
  for (const [sym, from] of Object.entries(ETF_TAX_MEMBER_FROM)) {
    if (typeof from !== "number" || !isFinite(from)) { bad.push(`${sym}: 날짜가 숫자가 아니다`); continue; }
    if (from < ETF_TAX_EXEMPT_FROM) bad.push(`${sym}: 면제 시행일보다 앞선다(그 앞은 어차피 과세다)`);
    if (from > farFuture) bad.push(`${sym}: 1년 넘게 먼 미래다`);
    if (!ETF_SYMBOLS.has(sym)) bad.push(`${sym}: 집합에 없는 종목의 시행일이 남아 있다`);
  }
  ok(bad.length === 0, bad.length ? `시행일 문제: ${bad.join(" / ")}`
    : `시행일 ${Object.keys(ETF_TAX_MEMBER_FROM).length}건 형식·범위 정상`);
}

// ③ ★실제로 동작하는가★ — 가상의 '나중에 인정한 ETF' 로 갈라 본다
{
  const sym = krNow[0];
  const cutoff = Date.UTC(2026, 10, 1);
  const before = cutoff - 86400000, after = cutoff + 86400000;
  ok(_etfTaxExemptAt(sym, after) === true, `기준 목록 종목은 시행일 없이도 면제다 (${sym})`);
  // 시행일을 넣어 보고 갈라지는지 확인한 뒤 되돌린다
  ETF_TAX_MEMBER_FROM[sym] = cutoff;
  const a = _etfTaxExemptAt(sym, before), b = _etfTaxExemptAt(sym, after);
  delete ETF_TAX_MEMBER_FROM[sym];
  ok(a === false && b === true,
     `★시행일이 실제로 과거/이후를 가른다★ — 이전 면제=${a} · 이후 면제=${b}`);
  ok(_etfTaxExemptAt("005930.KS", after) === false, "ETF 가 아닌 종목은 언제든 과세다(삼성전자)");
  ok(_etfTaxExemptAt(sym, null) === true, "시행일이 없으면 ts 를 몰라도 종전대로 면제(호출부 동작 불변)");
}

// ④ 세율 함수까지 이어지는가 + 회계 결정성
{
  const cfg = { krSellTax: 0.0018 };
  const sym = krNow[0];
  const cutoff = Date.UTC(2026, 10, 1);
  ETF_TAX_MEMBER_FROM[sym] = cutoff;
  const rBefore = _krSellTaxRate(cfg, sym, "kr", cutoff - 86400000);
  const rAfter = _krSellTaxRate(cfg, sym, "kr", cutoff + 86400000);
  const again = _krSellTaxRate(cfg, sym, "kr", cutoff - 86400000);
  delete ETF_TAX_MEMBER_FROM[sym];
  ok(rBefore > 0 && rAfter === 0,
     `세율까지 이어진다 — 시행일 이전 ${(rBefore * 100).toFixed(2)}% · 이후 ${(rAfter * 100).toFixed(2)}%`);
  ok(rBefore === again, "같은 체결 시각은 언제 물어도 같은 답(현금 체크포인트가 지워져도 같은 잔고)");
}

/* ══ [E-2] 돈 경로의 감시자·탐지기가 조용히 죽지 않는가 ══════════════════════════
   빈 catch 는 소스 전체에 1,048곳이다. 전부가 문제는 아니다 — 대부분 선택적 보강이라
   실패해도 돈과 무관하다. ★분류해 보니 돈 경로 함수 안의 빈 catch 는 13곳★ 이었고,
   그중 넷은 "실패가 성공처럼 보이는" 종류였다:
     · verifyAfterTrade 전체       — 체결 뒤 원장↔포지션 대조. 던지면 '이상 없음' 과 구별 불가
     · auditAccounting 자가치유    — 삭제가 던져도 "무효화했다" 고 로그가 찍혔다(거짓말)
     · auditAccounting 중복탐지    — 던지면 '중복 없음' 과 구별 불가
     · 본전 손절 잠금(executeSell) — 던지면 남은 수량의 손절가가 안 올라간다(위험)
   나머지 9곳은 표본 적재·통계·쿨다운·체크포인트 전진이라 실패해도 돈이 안 틀어진다.
   여기서는 그 넷이 ★다시 조용해지지 않는지★ 만 지킨다. */
{
  const { readFileSync } = await import("node:fs");
  const SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const around = (needle, span) => {
    const i = SRC.indexOf(needle);
    return i < 0 ? "" : SRC.slice(i, i + (span || 900));
  };
  // ① verifyAfterTrade — 대조 실패를 말하는가
  const vat = around("async function verifyAfterTrade(", 1800);
  ok(/catch \(e\) \{[^}]*log\(/.test(vat) && /대조 자체가 실패/.test(vat),
     "체결 후 원장↔포지션 대조가 실패하면 그렇다고 말한다(‘이상 없음’ 과 구별된다)");
  // ② 자가치유 — 못 고쳤으면 못 고쳤다고 말하는가
  const healBlk = SRC.slice(Math.max(0, SRC.indexOf("cash 체크포인트 무효화") - 1200), SRC.indexOf("cash 체크포인트 무효화") + 200);
  ok(/_healed/.test(healBlk) && /삭제 실패/.test(healBlk),
     "체크포인트 삭제가 실패하면 ‘무효화했다’ 고 적지 않는다(성공했을 때만 그 줄을 남긴다)");
  ok(/if \(_healed\) await log/.test(healBlk),
     "성공 로그가 삭제 성공에 걸려 있다(조건 없이 찍히면 거짓말이 된다)");
  // ③ 중복 탐지 — 검사 실패를 말하는가
  const dupBlk = SRC.slice(SRC.indexOf("LEDGER_DUP("), SRC.indexOf("LEDGER_DUP(") + 900);
  ok(/원장 중복 검사 실패/.test(dupBlk), "원장 중복 검사가 실패하면 그렇다고 말한다(‘중복 없음’ 과 구별된다)");
  // ④ 본전 손절 잠금 — 안 걸렸으면 말하는가
  const beBlk = SRC.slice(SRC.indexOf("breakEvenLocked = true"), SRC.indexOf("breakEvenLocked = true") + 600);
  ok(/본전 잠금 실패/.test(beBlk), "본전 손절 잠금이 실패하면 그렇다고 말한다(손절가가 안 올라간 채 조용하지 않다)");
}

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
