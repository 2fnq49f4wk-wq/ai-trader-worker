// [V33.131] 전략버킷 예산 가드 검증 — "넘으면 버린다" 가 아니라 "넘으면 줄인다" 인지 본다.
//
//   왜 게이트로 만드는가.
//   종전 코드는 수량을 ① 신호 사이즈 ② 종목비중 상한 ③ 가용현금 으로만 깎고,
//   ★버킷 예산은 통과/탈락 판정에만★ 썼다. 그래서 "종목비중 상한이 버킷 예산보다 큰" 상태가
//   되면 첫 주문부터 한도를 넘어 탈락하고, 다음 사이클이 ★같은 수량을 다시 제시★ 하므로
//   영원히 못 산다. 잔액이 줄어야 풀리는데 아무것도 안 사니 잔액이 안 준다 — 교착이다.
//
//   프로덕션 로그(2026-08-06~08)의 예산 차단 25건이 전부 `누적=0` 이었다.
//     누적=0+6249 > 4460 (40% 초과) · 누적=0+15341 > 14639 (4.8% 초과)
//   같은 기간 금요일 미국장 마지막 30분 16개 사이클은 심사에서 "진입 1~3" 을 통과시키고도
//   전부 buy=0 으로 끝났다. 계좌가 대부분 투자돼 현금이 마르면 cash×split < equity×maxPosPct 가
//   자동으로 성립하므로, 보유가 쌓일수록 추세 버킷이 통째로 잠기는 구조였다.
//
//   그래서 두 가지를 동시에 지켜야 한다 — 하나만 보면 반대쪽으로 틀린다:
//     ① 교착이 풀린다     — 한도를 넘는 주문은 한도에 맞게 ★줄여서★ 체결된다
//     ② 한도는 안 넘는다  — 어떤 입력에서도 버킷 누적지출이 상한을 초과하지 않는다
//   ②만 보면 "전부 차단" 이 만점이고(=종전 버그), ①만 보면 예산 가드가 무의미해진다.

import { readFileSync } from "node:fs";
import { RISKENG } from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };

// ── 소스 계약: 클램프가 존재하고, ★판정보다 먼저★ 적용되는가 ──────────────────
{
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const iClamp = src.indexOf("const _maxByBudget =");
  const iTrim  = src.indexOf("_budgetTrim = qty - Math.max(0, _maxByBudget)");
  //   ※ `const totalCost = qty * price * (1 + feeRate);` 는 executeBuy 쪽에도 있어 파일에 3번 나온다.
  //     전역 indexOf 로 찾으면 예산 가드보다 ★앞선★ 것을 집어 순서 검사가 무의미하게 통과한다
  //     (첫 판본이 실제로 그렇게 오작동했다). 반드시 클램프 위치 뒤에서 찾는다.
  const iCost  = iTrim > 0 ? src.indexOf("const totalCost = qty * price * (1 + feeRate);", iTrim) : -1;
  const iSpend = iCost > 0 ? src.indexOf("const wouldSpend = _spentSoFar + totalCost;", iCost) : -1;

  if (iClamp > 0) ok("버킷 잔여 기준 최대수량(_maxByBudget) 을 계산한다");
  else bad("버킷 잔여로 수량을 깎는 계산이 없다 — 한도 초과 주문이 통째로 버려진다(교착)");

  if (iTrim > 0 && iClamp > 0 && iTrim > iClamp) ok("초과분을 실제로 qty 에서 깎는다");
  else bad("_maxByBudget 을 계산만 하고 qty 에 반영하지 않는다");

  if (iTrim > 0 && iCost > iTrim) ok("수량 축소가 totalCost 산출 ★앞★ 에 있다");
  else bad("totalCost 를 먼저 구한 뒤 깎는다 — 축소가 판정에 반영되지 않는다");

  if (iCost > 0 && iSpend > iCost) ok("wouldSpend 가 축소된 totalCost 를 쓴다");
  else bad("wouldSpend 가 축소 전 비용을 쓴다");

  if (src.includes("RISKENG.minNotional[market]")) ok("축소 결과가 최소 명목가 미달일 때만 차단한다");
  else bad("최소 명목가 검사가 없다 — 수수료가 기대수익을 먹는 티끌주문이 나간다");
}

// ── 동작 계약: 소스의 산술을 그대로 옮겨 시뮬레이션 ──────────────────────────
//   (아래 decide 는 src/index.js 의 예산 가드 구간과 같은 식이다. 식이 바뀌면
//    위 소스 계약이 먼저 깨지므로 둘이 함께 어긋난 채로 통과할 수 없다.)
function decide({ qty, price, feeRate, cap, spent, market }) {
  const epsilon = market === "us" ? 0.01 : 1;
  const budgetLeft = cap - spent;
  const unit = price * (1 + feeRate);
  const maxByBudget = unit > 0 ? Math.floor(budgetLeft / unit) : 0;
  let trim = 0;
  if (qty > 0 && maxByBudget < qty) { trim = qty - Math.max(0, maxByBudget); qty = Math.max(0, maxByBudget); }
  const totalCost = qty * price * (1 + feeRate);
  const minN = RISKENG.minNotional[market] || 0;
  const wouldSpend = spent + totalCost;
  if (trim > 0 && (qty <= 0 || (minN > 0 && qty * price < minN))) return { buy: false, why: "min_notional", qty: 0, totalCost: 0 };
  if (qty > 0 && wouldSpend > cap + epsilon) return { buy: false, why: "over_cap_after_clamp", qty, totalCost };
  if (qty <= 0) return { buy: false, why: "qty_zero", qty: 0, totalCost: 0 };
  return { buy: true, why: trim > 0 ? "trimmed" : "full", qty, totalCost, trim };
}

// ① 실제 사고 재현 — 로그에 찍힌 두 사례가 이제 체결되는가
{
  // 누적=0+6249 > 4460 : price 미상이므로 로그의 비용비로 역산(주당 100.1 가정, 62주)
  const a = decide({ qty: 62, price: 100, feeRate: 0.001, cap: 4460, spent: 0, market: "us" });
  if (a.buy && a.qty === 44 && a.totalCost <= 4460) ok(`사고재현 A(6249>4460): 62주 → ${a.qty}주 체결, 비용 ${a.totalCost.toFixed(0)} ≤ 4460`);
  else bad(`사고재현 A 가 여전히 막힌다: ${JSON.stringify(a)}`);

  // 누적=0+15341 > 14639 : 4.8% 초과 — 거의 다 사면 된다
  const b = decide({ qty: 100, price: 153.26, feeRate: 0.001, cap: 14639, spent: 0, market: "us" });
  if (b.buy && b.qty === 95 && b.totalCost <= 14639) ok(`사고재현 B(15341>14639): 100주 → ${b.qty}주 체결, 비용 ${b.totalCost.toFixed(0)} ≤ 14639`);
  else bad(`사고재현 B 가 여전히 막힌다: ${JSON.stringify(b)}`);
}

// ② 교착이 구조적으로 사라졌는가 — 버킷을 한 푼도 안 쓴 상태에서 차단되면 그건 교착이다
{
  let deadlock = 0, tested = 0;
  for (let i = 0; i < 20000; i++) {
    const market = ["us", "kr"][i % 2];
    const price = market === "us" ? 5 + Math.random() * 900 : 2000 + Math.random() * 800000;
    const cap = (market === "us" ? 200 : 200000) * (1 + Math.random() * 400);
    const qty = 1 + Math.floor(Math.random() * 500);
    const r = decide({ qty, price, feeRate: 0.001, cap, spent: 0, market });
    if (!r.buy) {
      tested++;
      // 잔여예산으로 최소 명목가조차 못 채우면 차단이 맞다. 그 외의 차단은 교착이다.
      const affordable = Math.floor(cap / (price * 1.001));
      if (affordable * price >= (RISKENG.minNotional[market] || 0) && affordable > 0) deadlock++;
    }
  }
  if (deadlock === 0) ok(`누적=0 교착 0건 (차단 ${tested}건은 전부 잔여로 최소주문 불가한 정당한 차단)`);
  else bad(`누적=0 인데 살 수 있는데도 차단된 교착 ${deadlock}건`);
}

// ③ 반대편 — 어떤 입력에서도 버킷 상한을 넘지 않는가(몬테카를로, 사이클 누적 포함)
{
  let over = 0, buys = 0, trims = 0;
  for (let c = 0; c < 4000; c++) {
    const market = ["us", "kr"][c % 2];
    const cap = (market === "us" ? 1000 : 1000000) * (1 + Math.random() * 50);
    let spent = 0;
    for (let k = 0; k < 40; k++) {
      const price = market === "us" ? 5 + Math.random() * 900 : 2000 + Math.random() * 800000;
      const qty = 1 + Math.floor(Math.random() * 300);
      const r = decide({ qty, price, feeRate: 0.001, cap, spent, market });
      if (r.buy) { spent += r.totalCost; buys++; if (r.why === "trimmed") trims++; }
      if (spent > cap + (market === "us" ? 0.01 : 1)) { over++; break; }
    }
  }
  if (over === 0) ok(`버킷 상한 초과 0건 (매수 ${buys}건 중 축소체결 ${trims}건, 4000 사이클×40회)`);
  else bad(`버킷 상한을 넘긴 사이클 ${over}건 — 예산 가드가 뚫렸다`);
}

// ④ 정당한 차단은 여전히 차단하는가 — 게이트를 없앤 것이 아님을 확인
{
  const r = decide({ qty: 10, price: 100, feeRate: 0.001, cap: 15, spent: 0, market: "us" });
  if (!r.buy && r.why === "min_notional") ok("잔여 15달러(최소 20달러 미만) → 티끌주문 차단 유지");
  else bad(`최소 명목가 미달인데 체결됐다: ${JSON.stringify(r)}`);

  const r2 = decide({ qty: 10, price: 100, feeRate: 0.001, cap: 1000, spent: 1000, market: "us" });
  if (!r2.buy) ok("버킷 소진(누적=상한) → 차단 유지");
  else bad(`버킷을 다 썼는데 체결됐다: ${JSON.stringify(r2)}`);

  // 한도 안이면 깎지 않는다 — 멀쩡한 주문을 줄이면 그것도 버그다
  const r3 = decide({ qty: 10, price: 100, feeRate: 0.001, cap: 99999, spent: 0, market: "us" });
  if (r3.buy && r3.qty === 10 && r3.why === "full") ok("한도 여유 충분 → 수량 그대로(불필요한 축소 없음)");
  else bad(`여유가 있는데 수량이 깎였다: ${JSON.stringify(r3)}`);
}

console.log(fails ? "\n예산 클램프 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   예산 클램프 계약 통과");
process.exit(fails ? 1 : 0);
