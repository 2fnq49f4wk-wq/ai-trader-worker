// [V33.108] 재무제표 툴킷 검증.
//
//   재무지표는 부호 하나만 뒤집혀도 "우량" 과 "위험" 이 바뀐다. 그런데 화면·리포트만 보고는
//   그게 맞는지 알 수 없다(그럴듯한 숫자가 나오기 때문이다 — 이 저장소가 확률 쪽에서
//   반복해서 겪은 바로 그 실패 형태다).
//   → 답을 아는 합성 재무제표를 넣어 각 툴이 그 답을 되찾는지 확인한다.
//   추가로 ★데이터 부족(needs 미충족)과 '계산했는데 나쁨' 이 구분되는가★ 를 못 박는다 —
//   이 구분이 없으면 재무 미수집 종목이 '위험' 으로 잘못 취급된다.

import { FIN_TOOLS, finToolsRun } from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };
const get = (r, n) => (r.tools || []).find((t) => t.name === n);

// 완전한 2개년 재무제표를 만든다(단위: 원/달러 무관, 비율만 본다).
function stmt(over0, over1) {
  const base = {
    TotalRevenue: 1000, GrossProfit: 400, OperatingIncome: 150, NetIncome: 100,
    TotalAssets: 2000, TotalLiabilitiesNetMinorityInterest: 800,
    CurrentAssets: 900, CurrentLiabilities: 300, StockholdersEquity: 1200,
    RetainedEarnings: 500, OperatingCashFlow: 130, FreeCashFlow: 90,
    BasicAverageShares: 100, Receivables: 150, CostOfRevenue: 600,
    SellingGeneralAndAdministration: 200, ReconciledDepreciation: 50,
    NetPPE: 700, CurrentDebt: 50, LongTermDebt: 250
  };
  const y0 = Object.assign({}, base, over0 || {});   // 직전연도
  const y1 = Object.assign({}, base, over1 || {});   // 최근연도
  return { symbol: "TEST", order: ["2024-12-31", "2025-12-31"],
           years: { "2024-12-31": y0, "2025-12-31": y1 } };
}

// ══ 1) 레지스트리 형태(LangChain Tool 규약) ═══════════════════════════════════
{
  const badTools = FIN_TOOLS.filter((t) => !t.name || !t.ko || !t.desc || !Array.isArray(t.needs) || typeof t.run !== "function");
  if (!badTools.length) ok("툴 레지스트리 " + FIN_TOOLS.length + "종 — name/ko/desc/needs/run 규약 준수");
  else bad("규약 위반 툴: " + badTools.map((t) => t.name || "?").join(", "));
  const names = FIN_TOOLS.map((t) => t.name);
  if (new Set(names).size === names.length) ok("툴 이름 중복 없음");
  else bad("툴 이름 중복: " + names.join(","));
}

// ══ 2) 넷넷(NCAV) — 손으로 계산한 값과 일치하는가 ════════════════════════════
{
  // NCAV = 유동자산 900 − 총부채 800 = 100, 주식 100주 → 주당 1.0
  const r = finToolsRun(stmt(), 1000, 0.5);       // 가격 0.5 → 0.5배 = 넷넷
  const t = get(r, "ncav");
  if (t && t.ok && Math.abs(t.value - 1.0) < 1e-9 && Math.abs(t.ratio - 0.5) < 1e-9 && /넷넷/.test(t.verdict))
    ok("NCAV 주당 " + t.value + " · 가격/가치 " + t.ratio + "배 → " + t.verdict);
  else bad("NCAV 계산 오류: " + JSON.stringify(t));
  // 가격이 높으면 넷넷이 아니어야 한다(부호·방향 확인)
  const t2 = get(finToolsRun(stmt(), 1000, 5), "ncav");
  if (t2 && /고가/.test(t2.verdict)) ok("가격 5배일 때 '청산가치 대비 고가' 판정");
  else bad("NCAV 방향 오류: " + JSON.stringify(t2));
}

// ══ 3) FCF 수익률 · 오너 어닝스 ══════════════════════════════════════════════
{
  const r = finToolsRun(stmt(), 1000, 10);        // 시총 1000, FCF 90 → 9%
  const f = get(r, "fcfYield");
  if (f && f.ok && Math.abs(f.value - 9) < 1e-6 && /높음/.test(f.verdict)) ok("FCF 수익률 " + f.value + "% → " + f.verdict);
  else bad("FCF 수익률 오류: " + JSON.stringify(f));
  // 오너 어닝스 = (CFO 130 − 감가 50)/1000 = 8%
  const o = get(r, "ownerEarnings");
  if (o && o.ok && Math.abs(o.value - 8) < 1e-6 && /우수/.test(o.verdict)) ok("오너 어닝스 " + o.value + "% → " + o.verdict);
  else bad("오너 어닝스 오류: " + JSON.stringify(o));
  // 현금흐름 적자면 반드시 그렇게 말해야 한다
  const neg = get(finToolsRun(stmt(null, { FreeCashFlow: -40 }), 1000, 10), "fcfYield");
  if (neg && /적자/.test(neg.verdict)) ok("FCF 음수 → '현금흐름 적자' 판정");
  else bad("FCF 음수 판정 실패: " + JSON.stringify(neg));
}

// ══ 4) 현금전환(CFO/NI) ══════════════════════════════════════════════════════
{
  const good = get(finToolsRun(stmt(), 1000, 10), "cashConversion");   // 130/100 = 1.3
  if (good && Math.abs(good.value - 1.3) < 1e-9 && /우수/.test(good.verdict)) ok("현금전환 " + good.value + "배 → " + good.verdict);
  else bad("현금전환 오류: " + JSON.stringify(good));
  const poor = get(finToolsRun(stmt(null, { OperatingCashFlow: 40 }), 1000, 10), "cashConversion");  // 0.4
  if (poor && /현금 부족/.test(poor.verdict)) ok("CFO 0.4배 → '이익 대비 현금 부족' 판정");
  else bad("낮은 현금전환 판정 실패: " + JSON.stringify(poor));
}

// ══ 5) C-Score — 분식 징후를 실제로 잡는가 ═══════════════════════════════════
{
  // 깨끗한 회사: 전년과 거의 동일 → 징후 없음
  const clean = get(finToolsRun(stmt(), 1000, 10), "cScore");
  if (clean && clean.ok && clean.value <= 1) ok("정상 기업 C-Score " + clean.value + clean.unit + " → " + clean.verdict);
  else bad("정상 기업인데 징후가 잡혔다: " + JSON.stringify(clean));

  // 조작 의심: NI 유지·CFO 급감, 매출채권 급증, 감가상각률 하락, 총자산 급증, 매출총이익률 급등
  const dirty = get(finToolsRun(stmt(null, {
    OperatingCashFlow: 20,          // ① NI−CFO 괴리 확대
    Receivables: 300,               // ② 매출채권 2배(매출은 그대로)
    ReconciledDepreciation: 20,     // ③ 감가상각률 하락
    NetPPE: 700,
    TotalAssets: 2600,              // ④ 총자산 +30%
    GrossProfit: 560                // ⑤ 매출총이익률 40% → 56%
  }), 1000, 10), "cScore");
  if (dirty && dirty.ok && dirty.value >= 4 && /다수/.test(dirty.verdict))
    ok("조작 의심 기업 C-Score " + dirty.value + dirty.unit + " → " + dirty.verdict);
  else bad("분식 징후를 못 잡았다: " + JSON.stringify(dirty));
}

// ══ 6) 추세 기울기 — 성장/역성장 방향 ════════════════════════════════════════
{
  const grow = { symbol: "G", order: ["2022", "2023", "2024", "2025"], years: {} };
  const shrink = { symbol: "S", order: ["2022", "2023", "2024", "2025"], years: {} };
  const b = stmt().years["2025-12-31"];
  [0, 1, 2, 3].forEach((i) => {
    grow.years[grow.order[i]] = Object.assign({}, b, { TotalRevenue: 1000 * Math.pow(1.2, i), OperatingIncome: 150 * Math.pow(1.3, i) });
    shrink.years[shrink.order[i]] = Object.assign({}, b, { TotalRevenue: 1000 * Math.pow(0.9, i), OperatingIncome: 150 * Math.pow(0.8, i) });
  });
  const g = get(finToolsRun(grow, 1000, 10), "revTrend");
  const sh = get(finToolsRun(shrink, 1000, 10), "revTrend");
  if (g && g.ok && g.value > 0 && g.marginSlope > 0 && /동반 개선/.test(g.verdict)) ok("성장기업 매출 " + g.value + "%/년 · 마진 " + g.marginSlope + "%p/년 → " + g.verdict);
  else bad("성장 추세 오판: " + JSON.stringify(g));
  if (sh && sh.ok && sh.value < 0 && /역성장/.test(sh.verdict)) ok("역성장기업 매출 " + sh.value + "%/년 → " + sh.verdict);
  else bad("역성장 추세 오판: " + JSON.stringify(sh));
}

// ══ 7) 부채 부담 ═════════════════════════════════════════════════════════════
{
  // 차입 300 / EBITDA(150+50=200) = 1.5배
  const d = get(finToolsRun(stmt(), 1000, 10), "debtLoad");
  if (d && Math.abs(d.value - 1.5) < 1e-9 && /감당/.test(d.verdict)) ok("순부채/EBITDA " + d.value + "배 → " + d.verdict);
  else bad("부채 부담 오류: " + JSON.stringify(d));
  const heavy = get(finToolsRun(stmt(null, { LongTermDebt: 1150 }), 1000, 10), "debtLoad");  // 1200/200 = 6
  if (heavy && /과다/.test(heavy.verdict)) ok("차입 6배 → '과다차입' 판정");
  else bad("과다차입 판정 실패: " + JSON.stringify(heavy));
  // EBITDA 음수면 '상환력 없음' 이라고 분명히 말해야 한다
  const dead = get(finToolsRun(stmt(null, { OperatingIncome: -200 }), 1000, 10), "debtLoad");
  if (dead && /상환력 없음/.test(dead.verdict)) ok("EBITDA 음수 → '차입 상환력 없음' 명시");
  else bad("EBITDA 음수 처리 실패: " + JSON.stringify(dead));
}

// ══ 8) ★데이터 부족과 '나쁨' 이 구분되는가★ ═════════════════════════════════
//   이게 깨지면 재무 미수집 종목이 전부 '위험' 으로 취급된다 — 실제 매매를 막는 사고다.
{
  const sparse = { symbol: "X", order: ["2025"], years: { "2025": { TotalRevenue: 1000, NetIncome: 100 } } };
  const r = finToolsRun(sparse, 1000, 10);
  const na = r.tools.filter((t) => !t.ok);
  const done = r.tools.filter((t) => t.ok);
  if (r.ok && na.length >= 5 && na.every((t) => Array.isArray(t.missing) && t.missing.length))
    ok("빈약한 재무제표 — 미산출 " + na.length + "종이 'missing' 사유와 함께 보고됨 (산출 " + done.length + "종)");
  else bad("데이터 부족이 사유 없이 처리됐다: " + JSON.stringify(r.tools.map((t) => [t.name, t.ok])));
  // 재무 자체가 없으면 ok:false 로 분명히 말해야 한다
  const none = finToolsRun({ symbol: "Y", order: [], years: {} }, 1000, 10);
  if (!none.ok && /없음/.test(none.reason || "")) ok("재무 데이터 없음 → ok:false + 사유 반환");
  else bad("빈 재무제표 처리 실패: " + JSON.stringify(none));
}

console.log(fails ? "\n재무제표 툴킷 검증 실패 " + fails + "건" : "\n  ok   재무제표 툴킷 통과");
process.exit(fails ? 1 : 0);
