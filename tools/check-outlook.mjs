// [게이트] AI 전망 엔진(public/outlook.js) + 역사 보정 가중치(public/outlook-weights.json)
//  1) 가중치 파일: 0 이 아닌 가중치는 모두 '자기 기간' 규칙이고, 홀드아웃 |t| >= 2 · 선택/홀드아웃 부호가 손으로 정한 방향과 같다
//  2) 가중치 없이(fetch 없음) 옛 정수 규칙으로 동작 — 반환 모양 {s,m,l}{score,cls,label,why,conf}
//  3) 가중치를 넣으면 라벨 경계(thr)대로 라벨이 정해지고, 과거 성적 p·ex·n 이 붙는다
//  4) 공개 API(stock/basket/ctxOf/whyHtml/BASKETS/THEME/sectorOf) 유지
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public/outlook.js"), "utf8");
const W = JSON.parse(fs.readFileSync(path.join(root, "public/outlook-weights.json"), "utf8"));
let fails = 0;
const ok = (c, m) => { if (!c) { console.error("✗ " + m); fails++; } };

function load() {
  const win = {};
  vm.runInNewContext(src, { window: win, console });   // fetch 를 일부러 안 준다 — 폴백 경로
  return win.luxOutlook;
}

// ── 1) 가중치 파일 구조 ──
ok(W.tGate >= 2, "tGate >= 2");
let nz = 0;
for (const mk of ["kr", "us"]) {
  for (const hz of ["s", "m", "l"]) {
    const H = W[mk] && W[mk][hz];
    ok(H && H.rules && H.labels, `${mk}.${hz} 구조`);
    if (!H) continue;
    for (const [id, r] of Object.entries(H.rules)) {
      if (!r.w) continue;
      nz++;
      ok(r.own === true && !r.market, `${mk}.${hz}.${id} 가중치는 자기 기간·종목 규칙만`);
      ok(r.hold && typeof r.hold.t === "number" && Math.abs(r.hold.t) >= 2, `${mk}.${hz}.${id} 홀드아웃 t 기록 · |t|>=2 (t=${r.hold && r.hold.t})`);
      ok(r.sel && typeof r.sel.t === "number", `${mk}.${hz}.${id} 선택 t 기록`);
      ok(Math.sign(r.w) === r.sign && Math.sign(r.hold.t) === r.sign && Math.sign(r.sel.t) === r.sign, `${mk}.${hz}.${id} 부호 일치(가중·선택·홀드아웃·손규칙)`);
      ok(Math.abs(r.w) <= 1.5 + 1e-9 && Math.abs(r.w) >= 0.3 - 1e-9, `${mk}.${hz}.${id} 가중치 크기 범위`);
    }
    for (const [L, d] of Object.entries(H.labels)) ok(["pos", "pos1", "mid", "neg1", "neg"].includes(L) && d.n >= 0, `${mk}.${hz} 라벨 이름 ${L}`);
    if (H.thr) ok(H.thr.pos >= H.thr.pos1 && H.thr.neg <= H.thr.neg1, `${mk}.${hz} 경계 순서`);
  }
}
console.log(`가중치 0 아닌 규칙 ${nz}개 확인`);

// ── 2) 폴백(가중치 없음) ──
{
  const L = load();
  ok(["setWeights", "whyHtml", "stock", "basket", "ctxOf", "BASKETS", "THEME", "sectorOf"].every((k) => k in L), "공개 API");
  ok(L.sectorOf("NVDA") === "semis" && L.sectorOf("ZZZZ") === null, "sectorOf");
  ok(L.stock(null) === null && L.stock({ price: 0 }) === null, "빈 입력");
  const q = { symbol: "AAA", market: "us", price: 100, rsi: 25, return5: -12, ma: 105, dailyMaShort: 101, ma50: 90, return60: 20, ret1y: 30, ret5y: 150 };
  const C = { ixDay: -0.5, ix60: 5, upRatio: 0.5, regime: null, mk: "us" };
  const o = L.stock(q, C);
  for (const h of ["s", "m", "l"]) {
    const v = o[h];
    ok(v && typeof v.score === "number" && typeof v.cls === "string" && typeof v.label === "string" && Array.isArray(v.why) && typeof v.conf === "string", `폴백 모양 ${h}`);
    ok(!("p" in v) && !("ex" in v), `폴백엔 과거 성적 필드 없음 ${h}`);
  }
  // 옛 규칙 그대로: RSI 과매도 +1, 5일 급락 +1, 5일선<20일선 & 가격<20일선? (101<105 && 100<105) → −1 ⇒ 단기 +1 ⇒ 약간 긍정
  ok(o.s.score === 1 && o.s.label === "약간 긍정", `폴백 단기 점수 ${o.s.score}`);
  // 중기: 50일선 위 +1, 20일선(105)>50일선(90) +1, 60일 수익 20 − 지수 5 = 15 ≥ 5 +1 → 3 → 긍정
  ok(o.m.score === 3 && o.m.label === "긍정", `폴백 중기 점수 ${o.m.score}`);
  ok(o.l.score === 2 && o.l.label === "긍정", `폴백 장기 점수 ${o.l.score}`);
  const lev = L.stock({ symbol: "SOXL", market: "us", price: 10 }, C);
  ok(lev.l.score === -2 && lev.l.label === "주의", "레버리지 장기 주의");
  ok(typeof L.whyHtml(["가", "a"], (x) => x) === "string" && L.whyHtml("x", (x) => x) === "x", "whyHtml");
  const st = { indices: [{ symbol: "^GSPC", price: 110, dayPct: 0.1, history: Array.from({ length: 60 }, (_, i) => 100 + i * 0.2) }],
    watchlist: [{ symbol: "NVDA", market: "us", price: 100, dayPct: 1, return5: 2, return60: 10, ma50: 90, mcap: 1e12 }, { symbol: "AMD", market: "us", price: 90, dayPct: -1, return5: 1, return60: 5, ma50: 95, mcap: 1e11 }] };
  const b = L.basket("semis", st, null);
  ok(b && b.key === "semis" && b.s && b.m && b.l && typeof b.s.label === "string", "basket 모양");
  ok(L.ctxOf(st, "us", "BULL").mk === "us", "ctxOf");
}

// ── 3) 주입한 가중치: 라벨 경계·과거 성적 ──
{
  const L = load();
  const inj = {
    kr: {
      s: { h: 10, rules: { rsi_lo: { own: true, w: 0 }, ma_dn: { own: true, w: -0.4 }, ma_up: { own: true, w: 0.5 } }, thr: { neg: -99, neg1: 0, pos1: 0, pos: 99 }, labels: { pos1: { p: 0.51, ex: 0.3, n: 1234 }, neg1: { p: 0.43, ex: -2.1, n: 999 }, mid: { p: 0.5, ex: 0, n: 50 } } },
      m: { h: 60, rules: {}, thr: null, labels: { mid: { p: 0.5, ex: 0, n: 10 } } },
      l: { h: 250, rules: {}, thr: null, labels: { mid: { p: 0.5, ex: 0, n: 10 } } },
    },
    us: { s: { rules: { rsi_lo: { own: true, w: 0 } }, thr: null, labels: {} }, m: { rules: {}, thr: null, labels: {} }, l: { rules: {}, thr: null, labels: {} } },
  };
  L.setWeights(inj);
  const dn = { symbol: "005930.KS", market: "kr", price: 100, ma: 105, dailyMaShort: 101, rsi: 20 };
  const o = L.stock(dn, { mk: "kr", ixDay: 0, ix60: null, upRatio: 0.5 });
  ok(o.s.cls === "neg1" && o.s.label === "약간 주의" && o.s.score === -1, `주입: 단기 라벨 ${o.s.label}`);
  ok(o.s.p === 0.43 && o.s.ex === -2.1 && o.s.n === 999, "주입: p·ex·n 붙음");
  ok(o.s.why.some((w) => Array.isArray(w) && /과거 비슷한 신호/.test(w[0]) && /−2\.1%p/.test(w[0]) && /43%/.test(w[0]) && w[1].length > 10), "주입: 과거 성적 문장 [ko,en]");
  ok(o.s.why.some((w) => Array.isArray(w) && /^참고\(점수 미반영\)/.test(w[0]) && /RSI/.test(w[0])), "주입: 가중치 0 규칙은 참고 문구로만");
  const up = L.stock({ symbol: "005930.KS", price: 110, ma: 105, dailyMaShort: 108 }, { mk: "kr", upRatio: 0.5 });
  ok(up.s.cls === "pos1" && up.s.p === 0.51, "주입: 양수 → 약간 긍정 (심볼로 시장 추정)");
  const none = L.stock({ symbol: "005930.KS", price: 100 }, { mk: "kr", upRatio: 0.5 });
  ok(none.s.cls === "mid" && none.s.p === 0.5, "주입: 규칙 없음 → 중립 + 기준선");
  // 국면(사람 요인)이 얹히면 과거 성적을 붙이지 않는다
  const reg = L.stock({ symbol: "005930.KS", price: 100, ma50: 90 }, { mk: "kr", regime: "BEAR", upRatio: 0.5 });
  ok(!("p" in reg.m), "국면이 얹히면 p 없음");
  // 미국: 점수에 넣은 규칙이 없으면 conf 낮음
  const us = L.stock({ symbol: "AAPL", price: 100, rsi: 20 }, { mk: "us", upRatio: 0.5 });
  ok(us.s.conf === "낮음" && us.s.cls === "mid", "주입: 검증된 규칙 없음 → 중립·신뢰 낮음");
  // 실제 JSON 도 같은 경로로 모양이 맞다
  L.setWeights(W);
  const real = L.stock({ symbol: "TSLA", market: "us", price: 100, rsi: 80, return5: 20, ma: 90, dailyMaShort: 95, ma50: 80, return60: 30, ret1y: 50, ret5y: 300 }, { mk: "us", ixDay: 0, ix60: 5, upRatio: 0.5 });
  for (const h of ["s", "m", "l"]) ok(real[h] && ["pos", "pos1", "mid", "neg1", "neg"].includes(real[h].cls) && Array.isArray(real[h].why), `실제 가중치 모양 ${h}`);
  L.setWeights(null);
  ok(L.stock({ symbol: "AAPL", price: 100, rsi: 20 }, { mk: "us" }).s.score === 1, "가중치 해제 → 폴백");
}

if (fails) { console.error(`\n${fails}건 실패`); process.exit(1); }
console.log("✅ check-outlook 통과");
