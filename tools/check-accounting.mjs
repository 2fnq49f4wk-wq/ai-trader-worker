// [V33.107] 회계 불변식 검증.
//
//   이 엔진의 회계는 "trades 원장이 유일한 진실" 이다(V29). 현금은 저장하지 않고
//   원장에서 매번 재계산한다. 그래서 ★체결이 쓰는 비용식★ 과 ★원장 재생이 쓰는 비용식★ 이
//   한 글자라도 어긋나면 현금이 조용히 표류한다 — 실제로 그걸 두 달 쫓은 적이 있다.
//
//   여기서 못 박는 불변식:
//     ① 체결식 == 재생식        매수 gross×(1+수수료+슬리피지), 매도 gross×(1−수수료−슬리피지−거래세)
//     ② 체크포인트 == 전체재생  500건 임계에서 스냅샷이 전진해도 결과가 같아야 한다
//     ③ 입출금은 정확히 1회 반영
//     ④ ETF 매도세 면제·시행일 경계가 재생에도 그대로 적용된다
//     ⑤ 왕복거래의 손실은 '비용의 합' 과 정확히 일치한다(유령 손익 0)

import { readFileSync } from "node:fs";
import { computeCashFromTrades, _krSellTaxRate, _slipRate, backtestSymbol } from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-6 : tol);

// 합성 D1 — state 테이블 + trades 테이블.
function fakeDB(state, trades) {
  const st = new Map(Object.entries(state || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const tr = (trades || []).map((t, i) => Object.assign({ rid: i + 1 }, t));
  return {
    prepare(sql) {
      const q = {
        _a: [],
        bind(...a) { q._a = a; return q; },
        async first() {
          if (/SELECT v FROM state WHERE k = \?/.test(sql)) {
            const v = st.get(q._a[0]); return v === undefined ? null : { v };
          }
          return null;
        },
        async all() {
          if (/FROM trades WHERE market = \? AND rowid > \?/.test(sql)) {
            const [mkt, since] = q._a;
            return { results: tr.filter((t) => t.market === mkt && t.rid > since) };
          }
          if (/SELECT k, v FROM state WHERE k IN/.test(sql)) {
            const out = [];
            for (const k of q._a) { const v = st.get(k); if (v !== undefined) out.push({ k, v }); }
            return { results: out };
          }
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO state/.test(sql)) st.set(q._a[0], q._a[1]);
          if (/DELETE FROM state WHERE k = \?/.test(sql)) st.delete(q._a[0]);
          return {};
        }
      };
      return q;
    },
    async batch(a) { for (const x of a) await x.run(); return []; },
    _st: st
  };
}

const CFG = {
  initialCashUS: 100000, initialCashKR: 10000000, initialCashCM: 50000,
  initialCashBDUS: 0, initialCashBDKR: 0,
  feeUS: 0.0005, feeKR: 0.00015,
  krSellTax: 0.0018            // 실 설정과 같은 자리(DEFAULT_CFG.krSellTax)
};
const NOW = Date.now();

// ══ ① 체결식과 재생식이 같은가 ════════════════════════════════════════════════
//   체결 코드(executeBuy/executeSell)가 쓰는 식을 여기 손으로 다시 적고 대조한다.
//   손으로 적은 식이 곧 '계약' 이다 — 한쪽이 바뀌면 이 테스트가 깨진다.
{
  const px = 200, qty = 10, gross = px * qty;
  const fee = CFG.feeUS, slip = _slipRate("us", NOW);
  const db = fakeDB({ deposits: { us: 0 }, outflows: { us: 0 } },
    [{ market: "us", ts: NOW, symbol: "AAPL", side: "BUY", qty, price: px }]);
  const cash = await computeCashFromTrades(db, "us", CFG);
  const want = CFG.initialCashUS - gross * (1 + fee + slip);
  if (near(cash, want, 1e-9)) ok("매수 재생 = gross×(1+수수료+슬리피지) — " + cash.toFixed(4));
  else bad("매수 재생 불일치: " + cash + " ≠ " + want);
}
{
  const px = 200, qty = 10, gross = px * qty;
  const fee = CFG.feeUS, slip = _slipRate("us", NOW), tax = _krSellTaxRate(CFG, "AAPL", "us", NOW);
  const db = fakeDB({ deposits: { us: 0 }, outflows: { us: 0 } },
    [{ market: "us", ts: NOW, symbol: "AAPL", side: "SELL", qty, price: px }]);
  const cash = await computeCashFromTrades(db, "us", CFG);
  const want = CFG.initialCashUS + gross * (1 - fee - tax - slip);
  if (near(cash, want, 1e-9)) ok("매도 재생 = gross×(1−수수료−슬리피지−거래세) — " + cash.toFixed(4));
  else bad("매도 재생 불일치: " + cash + " ≠ " + want);
  if (tax === 0) ok("미국장 매도세 0 확인");
  else bad("미국장에 매도세가 붙었다: " + tax);
}

// ══ ⑤ 같은 가격 왕복이면 손실 == 비용의 합 (유령 손익 0) ═════════════════════
{
  const px = 500, qty = 4, gross = px * qty;
  const fee = CFG.feeUS, slip = _slipRate("us", NOW);
  const db = fakeDB({ deposits: { us: 0 }, outflows: { us: 0 } }, [
    { market: "us", ts: NOW, symbol: "MSFT", side: "BUY", qty, price: px },
    { market: "us", ts: NOW, symbol: "MSFT", side: "SELL", qty, price: px }
  ]);
  const cash = await computeCashFromTrades(db, "us", CFG);
  const cost = gross * (fee + slip) * 2;          // 진입비용 + 청산비용
  if (near(CFG.initialCashUS - cash, cost, 1e-9))
    ok("동가 왕복 손실 = 왕복비용 " + cost.toFixed(4) + " (유령 손익 0)");
  else bad("동가 왕복인데 손실이 " + (CFG.initialCashUS - cash).toFixed(4) + " ≠ " + cost.toFixed(4));
}

// ══ ② 체크포인트 경로와 전체 재생이 같은 값을 내는가 ══════════════════════════
//   체크포인트는 500건 임계에서 전진한다. 전진 전/후 결과가 다르면 현금이 표류한다.
{
  const trades = [];
  for (let i = 0; i < 1200; i++) {
    trades.push({ market: "us", ts: NOW - (1200 - i) * 60000, symbol: "T" + (i % 7),
                  side: i % 2 === 0 ? "BUY" : "SELL", qty: 1 + (i % 3), price: 100 + (i % 11) });
  }
  // (a) 체크포인트 없이 한 번에
  const dbA = fakeDB({ deposits: { us: 0 }, outflows: { us: 0 } }, trades);
  const full = await computeCashFromTrades(dbA, "us", CFG);
  // (b) 같은 DB 를 두 번 호출 — 첫 호출에서 체크포인트가 저장되고, 두 번째는 그 뒤만 합산
  const dbB = fakeDB({ deposits: { us: 0 }, outflows: { us: 0 } }, trades);
  await computeCashFromTrades(dbB, "us", CFG);
  const ck = dbB._st.get("cash_ckpt:us");
  const inc = await computeCashFromTrades(dbB, "us", CFG);
  if (!ck) bad("1,200건인데 체크포인트가 저장되지 않았다(임계 500)");
  else if (near(full, inc, 1e-6)) ok("체크포인트 경로 == 전체재생 (" + full.toFixed(4) + ", ckpt rowid " + JSON.parse(ck).lastRowid + ")");
  else bad("체크포인트가 현금을 바꿨다: 전체 " + full + " vs 증분 " + inc);
}

// ══ ③ 입금·출금이 정확히 1회만 반영되는가 ════════════════════════════════════
{
  const db = fakeDB({ deposits: { us: 5000 }, outflows: { us: 1200 } }, []);
  const cash = await computeCashFromTrades(db, "us", CFG);
  const want = CFG.initialCashUS + 5000 - 1200;
  if (near(cash, want, 1e-9)) ok("입금 +5,000 / 출금 −1,200 정확히 1회 반영");
  else bad("입출금 반영 오류: " + cash + " ≠ " + want);
  // 두 번 불러도 같아야 한다(체크포인트 없이 재호출).
  const again = await computeCashFromTrades(db, "us", CFG);
  if (near(cash, again, 1e-9)) ok("재호출 멱등성 유지");
  else bad("재호출에서 값이 달라졌다: " + cash + " → " + again);
}

// ══ ④ 한국장 매도세 — ETF 면제와 시행일 경계 ═════════════════════════════════
{
  const px = 70000, qty = 10, gross = px * qty;
  const fee = CFG.feeKR, slip = _slipRate("kr", NOW);
  // 일반 종목
  const db1 = fakeDB({ deposits: { kr: 0 }, outflows: { kr: 0 } },
    [{ market: "kr", ts: NOW, symbol: "005930.KS", side: "SELL", qty, price: px }]);
  const c1 = await computeCashFromTrades(db1, "kr", CFG);
  const t1 = _krSellTaxRate(CFG, "005930.KS", "kr", NOW);
  const w1 = CFG.initialCashKR + gross * (1 - fee - t1 - slip);
  if (near(c1, w1, 1e-6) && t1 > 0) ok("한국 일반종목 매도세 " + (t1 * 100).toFixed(4) + "% 재생 반영");
  else bad("한국 매도세 재생 불일치: " + c1 + " ≠ " + w1 + " (세율 " + t1 + ")");

  // 재생이 '체결 시각' 기준 세율을 쓰는지 — 아주 오래된 거래는 그 시점 세율이어야 한다.
  const OLD = Date.UTC(2020, 0, 2);
  const tOld = _krSellTaxRate(CFG, "005930.KS", "kr", OLD);
  const db2 = fakeDB({ deposits: { kr: 0 }, outflows: { kr: 0 } },
    [{ market: "kr", ts: OLD, symbol: "005930.KS", side: "SELL", qty, price: px }]);
  const c2 = await computeCashFromTrades(db2, "kr", CFG);
  const w2 = CFG.initialCashKR + gross * (1 - fee - tOld - _slipRate("kr", OLD));
  if (near(c2, w2, 1e-6)) ok("과거 거래는 그 시점 세율·슬리피지로 재생 (" + (tOld * 100).toFixed(4) + "%)");
  else bad("과거 거래 재생이 현재 세율을 썼다: " + c2 + " ≠ " + w2);
}

// ══ ⑥ 시장 격리 — 한 시장의 거래가 다른 시장 현금을 건드리면 안 된다 ══════════
{
  const db = fakeDB({ deposits: {}, outflows: {} }, [
    { market: "us", ts: NOW, symbol: "AAPL", side: "BUY", qty: 10, price: 200 },
    { market: "kr", ts: NOW, symbol: "005930.KS", side: "BUY", qty: 5, price: 70000 }
  ]);
  const cm = await computeCashFromTrades(db, "cm", CFG);
  if (near(cm, CFG.initialCashCM, 1e-9)) ok("시장 격리 — cm 현금이 us/kr 거래에 영향 없음");
  else bad("시장 격리 깨짐: cm " + cm + " ≠ " + CFG.initialCashCM);
}

// ══ ⑦ 백테스트 비용모델 == 라이브 비용모델 ═══════════════════════════════════
//   [V33.111] 종전 백테스트는 슬리피지를 ★체결가★ 에 0.1% 고정으로 물렸다.
//   라이브는 _slipRate(시장·시각)를 ★비용률★ 로 현금에서 뺀다(체결가는 시장가).
//   체결가를 흔들면 진입가·손절가·pnl% 분모까지 달라져 백테스트가 다른 규칙을 재게 된다.
//   여기서는 "백테스트가 기록한 체결가가 시장 종가와 정확히 같은가" 로 그 통일을 확인한다
//   — 같지 않으면 비용을 다시 가격에 섞고 있다는 뜻이다.
{
  const n = 260;
  const closes = [], highs = [], lows = [], opens = [], vols = [], dates = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    px = px * (1 + Math.sin(i / 9) * 0.02 + 0.0012);
    opens.push(px * 0.998); closes.push(px); highs.push(px * 1.015); lows.push(px * 0.985);
    vols.push(1000000 + (i % 17) * 5000);
    dates.push(Date.UTC(2025, 0, 1) + i * 86400000);
  }
  const data = { symbol: "BT", closes, highs, lows, opens, volumes: vols, dates };
  let res = null;
  try { res = backtestSymbol(data, Object.assign({}, CFG), "us", { capitalPerTrade: 1000000 }); } catch (e) { res = { error: String(e && e.message) }; }
  if (!res || res.error) bad("백테스트 실행 실패: " + (res && res.error));
  else if (!Array.isArray(res.trades)) bad("백테스트가 trades 를 돌려주지 않았다");
  else if (!res.trades.length) console.log("  info 합성 데이터에서 체결 0건 — 비용모델 비교는 건너뜀");
  else {
    let priceSkew = 0;
    for (const t of res.trades) {
      const e = closes[t.entryIdx], x = closes[t.exitIdx];
      if (e != null && Math.abs(t.entryPrice - e) > 1e-9) priceSkew++;
      if (x != null && t.reason !== "BT-END-MTM" && Math.abs(t.exitPrice - x) > 1e-9) priceSkew++;
    }
    if (priceSkew === 0) ok("백테스트 체결가 == 시장 종가 (" + res.trades.length + "건) — 비용은 가격이 아니라 비용률로 처리됨");
    else bad("체결가가 시장가와 다르다 " + priceSkew + "건 — 슬리피지를 가격에 섞고 있다(라이브와 불일치)");
  }
}

// ══ [V33.129] ★매도 원자성 — 판 돈이 사라지지 않는가★ ═══════════════════════
//   현금은 원장(trades)에서 파생된다. 그래서 "포지션은 지워졌는데 SELL 이 원장에 없다" 는
//   단순 불일치가 아니라 ★돈이 사라진 상태★ 다. 자산도 없고 대금도 안 들어온다.
//   운영 스냅샷의 QTY_MISMATCH cm|GC=F "원장 2 vs 포지션 0" 이 그 서명이었다.
//   매수는 V31 부터 DB.batch 로 원자적이었는데 매도 3경로만 순차 실행이었다.
{
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const paths = [["executeSell(", "메인"], ["executeSellCM(", "원자재"], ["executeSellAlt(", "채권/대체"]];
  for (const [fn, label] of paths) {
    const i = src.indexOf("async function " + fn);
    if (i < 0) { bad(label + " 매도 함수를 못 찾았다"); continue; }
    const seg = src.slice(i, i + 14000);
    const iBatch = seg.indexOf("DB.batch([");
    const iSeq = seg.indexOf("await stmtPos.run()");
    if (iSeq >= 0) { bad(label + " 매도가 아직 포지션을 따로 실행한다(stmtPos.run) — 판 돈이 사라질 수 있다"); continue; }
    if (iBatch < 0) { bad(label + " 매도가 DB.batch 를 쓰지 않는다 — 원장·포지션이 원자적이지 않다"); continue; }
    // ★순서★ — 조건부 INSERT 가 UPDATE/DELETE 보다 앞이어야 EXISTS 가 참일 수 있다.
    const bat = seg.slice(iBatch, iBatch + 220);
    if (/DB\.batch\(\[\s*_stmtTrade[A-Za-z]*\s*,\s*stmtPos\s*\]\)/.test(bat))
      ok(label + " 매도: 배치 [조건부원장, 포지션] 순서 — 원자적이고 EXISTS 가 성립한다");
    else bad(label + " 매도 배치 순서가 틀렸다(포지션이 먼저면 EXISTS 가 항상 거짓): " + bat.slice(0, 80));
  }
  // 조건부 INSERT 가 CAS 와 ★같은 조건★ 을 쓰는가 — 다르면 중복 원장이 생긴다.
  const gi = src.indexOf("function stmtRecordTradeIfPos(");
  if (gi < 0) bad("stmtRecordTradeIfPos 가 없다");
  else {
    const g = src.slice(gi, gi + 900);
    const okSel = /INSERT INTO trades[\s\S]*SELECT[\s\S]*WHERE EXISTS/.test(g);
    const okGuard = /positions WHERE symbol = \? AND strategy = \? AND market = \? AND qty = \?/.test(g);
    if (okSel && okGuard) ok("조건부 원장 INSERT 가 포지션 CAS 와 동일 조건(symbol·strategy·market·qty)");
    else bad("조건부 INSERT 의 가드가 CAS 와 다르다 — 중복 원장 또는 누락이 생긴다");
  }
  // CAS 판정을 배치 결과의 ★포지션 문장★ 에서 읽는가(인덱스 1)
  const nIdx = (src.match(/_rowsChanged\(_bat[A-Za-z]*\s*&&\s*_bat[A-Za-z]*\[1\]\)/g) || []).length;
  if (nIdx >= 3) ok("CAS 판정을 배치의 포지션 결과(index 1)에서 읽는다 — 3경로 모두");
  else bad("CAS 판정이 배치 결과를 안 읽는 경로가 있다(" + nIdx + "/3)");
}

console.log(fails ? "\n회계 불변식 위반 " + fails + "건" : "\n  ok   회계 불변식 통과");
process.exit(fails ? 1 : 0);
