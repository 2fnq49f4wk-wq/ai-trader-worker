// [V33.202] 통화 혼합 계약 게이트
//   이 저장소는 같은 결함을 ★세 번★ 고쳤다:
//     V33.125 selfreview 의 worstStrategies 정렬 (원화 거래가 자릿수 1,000배라 항상 최악)
//     V33.135 portstats 의 profitFactor      (금액 PF 0.716 vs 수익률 omega 2.278)
//     V33.202 selfreview 의 헤드라인 PF·진단 게이트·자동차단 관문
//   매번 "여기 하나만" 고쳤기 때문이다. trades.pnl 은 KRW 와 USD 가 한 열에 섞여 있고,
//   그걸 시장 구분 없이 더한 값은 ★단위가 없는 수★ 다 — 표시가 틀린 정도가 아니라
//   그 위에 세운 판단이 전부 무효다. 실제로 V33.202 에서 확인된 피해가 그것이다:
//     승률 56.3% · 수익률 손익비 2.15 · 시장별 금액 전부 마이너스
//     → "소수 대형손실·사이징 집중" 이 정확한 진단인데, 섞인 PF 0.67 이 조건을 거짓으로 만들어
//       ★시스템이 답을 알고도 말하지 못했다★.
import fs from "node:fs";
const src = fs.readFileSync("src/index.js", "utf8");
const ln = (i) => src.slice(0, i).split("\n").length;
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };

const fnBody = (name, span = 5000) => {
  const i = src.indexOf("function " + name + "(");
  return i < 0 ? null : { i, body: src.slice(i, i + span) };
};

// ── ① 통화가 섞인 값을 판단에 쓰지 않는다 ────────────────────────────────
{
  const f = fnBody("mlSelfReview", 7000);
  if (!f) no("통화계약: mlSelfReview 를 찾을 수 없다");
  else {
    // 진단 게이트는 수익률 기준 손익비(pfPct)를 봐야 한다
    if (!/pfPct/.test(f.body)) no(`통화계약: selfreview(@${ln(f.i)}) 에 통화중립 손익비(pfPct)가 없다`);
    if (/winRate >= 0\.5 && pf >= 1\.3/.test(f.body))
      no(`통화계약: selfreview(@${ln(f.i)}) 의 핵심 진단이 통화혼합 pf 를 조건으로 쓴다 — 그 조건은 참이 될 수 없다`);
    if (/&& tot < 0\)/.test(f.body))
      no(`통화계약: selfreview(@${ln(f.i)}) 가 통화혼합 총손익(tot)의 부호로 판단한다 — 시장별로 봐야 한다`);
    // 자동차단 관문도 금액이 아니라 수익률
    if (/byEntry\[e\]\.pnl < 0 && st\.pNeg/.test(f.body))
      no(`통화계약: selfreview(@${ln(f.i)}) 의 자동차단 관문이 금액을 본다 — 한국 거래가 섞인 전략만 걸린다`);
    if (!/sumPct[^\n]{0,40}< 0 && st\.pNeg/.test(f.body))
      no(`통화계약: selfreview(@${ln(f.i)}) 의 자동차단이 수익률 기준(sumPct)이 아니다`);
    // 헤드라인이 혼합 값을 앞세우지 않는다
    if (/"% PF" \+ pf\.toFixed/.test(f.body))
      no(`통화계약: selfreview(@${ln(f.i)}) 헤드라인이 통화혼합 PF 를 앞세운다`);
    if (/" 손익" \+ tot\.toFixed/.test(f.body))
      no(`통화계약: selfreview(@${ln(f.i)}) 헤드라인이 통화혼합 총손익을 앞세운다`);
  }
}

// ── ② 혼합 값을 내보낼 때는 반드시 이름으로 경고한다 ──────────────────────
{
  let b0 = bad;
  for (const [fn, span] of [["mlSelfReview", 7000], ["portfolioStatsNightly", 3000]]) {
    const f = fnBody(fn, span);
    if (!f) { no(`통화계약: ${fn} 를 찾을 수 없다`); continue; }
    if (/totalPnl:/.test(f.body) && !/totalPnlMixedCcy/.test(f.body))
      no(`통화계약: ${fn}(@${ln(f.i)}) 가 totalPnl 을 경고 없이 내보낸다`);
    if (/profitFactor:/.test(f.body) && !/profitFactorMixedCcy/.test(f.body))
      no(`통화계약: ${fn}(@${ln(f.i)}) 가 profitFactor 를 경고 없이 내보낸다`);
  }
  if (bad === b0) ok("통화혼합 값은 전부 이름으로 경고한다(totalPnlMixedCcy · profitFactorMixedCcy)");
}

// ── ③ 두 화면의 손익비가 같은 정의인가 ───────────────────────────────────
//   portstats 의 omega 와 selfreview 의 pfPct 는 ★같은 산식★ 이어야 한다.
//   다르면 또 두 화면이 다른 숫자를 같은 이름으로 부르게 된다.
{
  const hasOmega = /sumLossPct > 1e-9 \? sumWinPct \/ sumLossPct/.test(src);
  const hasPfPct = /gLp > 1e-9 \? gWp \/ gLp/.test(src);
  if (!hasOmega) no("통화계약: portstats 의 omega(수익률 이익합/손실합) 산식을 찾을 수 없다");
  if (!hasPfPct) no("통화계약: selfreview 의 pfPct 가 omega 와 같은 산식이 아니다");
  if (hasOmega && hasPfPct) ok("두 화면의 손익비가 같은 정의다(수익률 이익합 / 손실합)");
}

// ── ④ 산식 동치 확인 — 같은 원장에서 같은 값이 나오는가 ────────────────────
//   금액과 수익률이 갈리는 상황을 실제로 만들어, 섞인 PF 가 어떻게 판단을 뒤집는지 재현한다.
{
  // 원화 거래는 금액 자릿수가 1,000배 크다 — 승률·수익률은 좋은데 금액은 마이너스인 원장.
  //   실측(2026-08-22)에 가깝게 만든다: 승률 56% · 수익률 손익비 2.15 · 금액은 마이너스.
  //   퇴화한 예(한쪽 시장이 전부 이기고 다른 쪽이 전부 지는)로는 계약을 증명할 수 없다 —
  //   두 시장 모두 이기고 지되, ★지는 거래에 큰 돈이 실린다★ 는 실제 모양이어야 한다.
  const trades = [];
  for (let i = 0; i < 45; i++) trades.push({ market: "us", pnl: 210, pnl_pct: 2.6 });    // 미국 이익
  for (let i = 0; i < 20; i++) trades.push({ market: "us", pnl: -95, pnl_pct: -1.1 });   // 미국 손실
  for (let i = 0; i < 12; i++) trades.push({ market: "kr", pnl: 260000, pnl_pct: 2.2 }); // 한국 이익
  for (let i = 0; i < 23; i++) trades.push({ market: "kr", pnl: -290000, pnl_pct: -1.6 });// 한국 손실(큰 사이즈)
  let gW = 0, gL = 0, gWp = 0, gLp = 0, tot = 0, wins = 0;
  for (const t of trades) {
    tot += t.pnl;
    if (t.pnl > 0) { wins++; gW += t.pnl; } else gL += Math.abs(t.pnl);
    if (t.pnl_pct > 0) gWp += t.pnl_pct; else gLp += Math.abs(t.pnl_pct);
  }
  const pfMixed = gW / gL, pfPct = gWp / gLp, winRate = wins / trades.length;
  const firesMixed = (winRate >= 0.5 && pfMixed >= 1.3 && tot < 0);
  const firesPct = (winRate >= 0.5 && pfPct >= 1.3);
  if (firesMixed) no("통화계약: 재현 실패 — 혼합 PF 로도 진단이 떠서는 이 게이트가 무의미하다");
  if (!firesPct) no("통화계약: 통화중립 PF 로도 진단이 안 뜬다 — 산식이 틀렸다");
  if (!firesMixed && firesPct)
    ok(`혼합 PF ${pfMixed.toFixed(2)} 는 진단을 막고, 통화중립 PF ${pfPct.toFixed(2)} 는 정확히 띄운다` +
       `(승률 ${(winRate * 100).toFixed(0)}% · 금액합 ${tot.toFixed(0)})`);
}

if (bad) { console.error(`\n통화 혼합 계약 위반 ${bad}건 — 배포 차단`); process.exit(1); }
console.log("  ok   통화 혼합 계약 통과 — 원과 달러를 더한 수로 판단하지 않는다");
