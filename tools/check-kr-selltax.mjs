/* [V33.348] 한국 매도세 — ★법정세율과 코드가 2년째 달랐다★
 *
 *   cfg.krSellTax 는 연도 구분 없는 단일 상수 0.0018 이었고, _krSellTaxRate 는 체결 시각(ts)을
 *   받아 놓고 ★ETF 면제 시행일 판정에만★ 썼다. 실제 합산세율(증권거래세 + 농어촌특별세)은:
 *      2024  0.18%   2025  0.15%   2026~  0.20%   (각 해 1월 1일 이후 양도분부터)
 *   2025년은 0.03%p 과대, 2026년은 0.02%p 과소로 원장에 적혀 왔다.
 *   현금은 원장 재생(computeCashFromTrades)으로 파생되므로 이 오차는 누적되고,
 *   그 pnl 이 그대로 학습 라벨이 된다 — ★비용을 낮게 잡는 것은 수익을 지어내는 것과 같다.★
 *
 *   지켜야 할 것이 네 가지다. 전부 ★함수를 실제로 호출해★ 확인한다(문자열 검사 아님):
 *     ① 연도별로 다른 값이 나온다
 *     ② 연 경계는 ★KST★ 로 갈린다 (UTC 로 재면 12/31 밤 체결이 다음 해로 밀린다)
 *     ③ 표에 없는 미래 연도가 0% 가 되지 않는다 (0% 면 그 해 내내 세금을 안 문다)
 *     ④ 소급하지 않는다 — 같은 ts 는 언제 물어도 같은 답 (회계 결정성, V33.87 원칙)
 */
import { _krSellTaxRate, KR_SELL_TAX_BY_YEAR } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };
const cfg = { krSellTax: 0.0018 };
const KST = (y, m, d, h = 12) => Date.UTC(y, m - 1, d, h - 9);
const rate = (ts, mkt = "kr", sym = "005930.KS") => _krSellTaxRate(cfg, sym, mkt, ts);
const pct = (v) => (v * 100).toFixed(3) + "%";

// ① 연도별로 갈린다
for (const [y, want] of [[2024, 0.0018], [2025, 0.0015], [2026, 0.0020]]) {
  const got = rate(KST(y, 6, 1));
  ok(Math.abs(got - want) < 1e-12, `${y}년 체결 → ${pct(got)} (법정 ${pct(want)})`);
}
ok(rate(KST(2025, 6, 1)) !== rate(KST(2026, 6, 1)), "연도가 다르면 세율이 실제로 달라진다(단일 상수가 아니다)");

// ② 연 경계는 KST 로 갈린다
const eve = Date.UTC(2025, 11, 31, 14, 30);   // KST 2025-12-31 23:30
const nye = Date.UTC(2025, 11, 31, 15, 30);   // KST 2026-01-01 00:30
ok(Math.abs(rate(eve) - 0.0015) < 1e-12, `KST 2025-12-31 23:30 → ${pct(rate(eve))} (2025년 세율)`);
ok(Math.abs(rate(nye) - 0.0020) < 1e-12, `KST 2026-01-01 00:30 → ${pct(rate(nye))} (2026년 세율) — UTC 로 쟀다면 2025년으로 밀렸다`);

// ③ 표 밖 연도가 0% 가 되면 안 된다
const years = Object.keys(KR_SELL_TAX_BY_YEAR).map(Number).sort((a, b) => a - b);
const hi = years[years.length - 1], lo = years[0];
for (const y of [hi + 1, hi + 5, lo - 1, lo - 10]) {
  const got = rate(KST(y, 6, 1));
  ok(got > 0, `표 밖 ${y}년 → ${pct(got)} (0% 가 아니다)`);
}
ok(Math.abs(rate(KST(hi + 3, 6, 1)) - KR_SELL_TAX_BY_YEAR[hi]) < 1e-12, `미래 연도는 가장 최근 연도(${hi}) 값을 잇는다`);

// ④ 소급하지 않는다 — 같은 ts 는 언제 물어도 같은 답
const ts = KST(2025, 3, 3);
ok(rate(ts) === rate(ts) && rate(ts) === _krSellTaxRate(cfg, "005930.KS", "kr", ts),
   "같은 체결 시각은 항상 같은 세율(현금 체크포인트가 지워져도 같은 잔고가 나온다)");

// 종전 규칙이 깨지지 않았는지 — 원화 슬리브만 과세, ETF 면제는 시행일 이후
ok(rate(KST(2026, 6, 1), "us", "NVDA") === 0, "USD 슬리브(us)는 매도세 없음");
ok(rate(KST(2026, 9, 1), "kr", "069500.KS") === 0, "KR ETF 는 시행일(2026-08-02) 이후 면제");
ok(rate(KST(2026, 7, 1), "kr", "069500.KS") > 0, "시행일 이전 ETF 체결은 종전대로 과세(소급 안 함)");
ok(rate(KST(2026, 9, 1), "bdkr", "148070.KS") === 0, "채권 슬리브(bdkr)는 전 종목 ETF → 면제");
ok(_krSellTaxRate(cfg, "005930.KS", "kr", null) === cfg.krSellTax, "ts 가 없으면 cfg 폴백(호출부 동작 불변)");

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
