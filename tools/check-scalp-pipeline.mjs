// [V33.103] 단타(장중) 표본 파이프라인 오프라인 검증기.
//
//   "단타 표본이 한 건도 안 쌓인다" 가 몇 판(V33.40/46/59/63/64/95/102)째 반복된다.
//   매번 프로덕션 로그로만 원인을 좇았고, 그때마다 다른 곳이 막혀 있었다.
//   → 실제 코드(stinBackfill / stinIntradayFeat / stinObserve / stinLabel)를 그대로 import 해
//     합성 5분봉·합성 D1 으로 돌려본다. 표본이 안 나오면 어느 단계에서 끊겼는지 즉시 나온다.
//
//   외부망(야후·네이버)은 globalThis.fetch 스텁으로 대체한다 — 네트워크 없이 결정적으로 돈다.
//   CI 게이트로 쓰기 위해 "표본 > 0" 과 "라이브/백필 피처 정합" 두 가지를 단언한다.

import assert from "node:assert";

// ── 합성 5분봉 생성: 22거래일 × 78봉 = 1,716봉 (야후 range=1mo 와 같은 규모) ──
function synthBars(n, seed) {
  let s = seed >>> 0;
  const rnd = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  // 실제 5분봉처럼 78봉(1세션)마다 야간 공백(17.5시간)을 넣는다 — 세션 경계 판정을 실제와 같게.
  const SESS = 78;
  let tcur = Math.floor(Date.now() / 1000) - Math.ceil(n / SESS) * 86400;
  const ts = [], o = [], h = [], l = [], c = [], v = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    if (i > 0) tcur += (i % SESS === 0) ? (86400 - SESS * 300 + 300) : 300;
    const drift = 0.0002 * Math.sin(i / 60);
    const shock = (rnd() - 0.5) * 0.006;
    const op = px;
    px = Math.max(1, px * (1 + drift + shock));
    const hi = Math.max(op, px) * (1 + rnd() * 0.002);
    const lo = Math.min(op, px) * (1 - rnd() * 0.002);
    ts.push(tcur); o.push(op); h.push(hi); l.push(lo); c.push(px);
    v.push(Math.floor(5000 + rnd() * 20000));
  }
  return { ts, o, h, l, c, v, SESS };
}

const BARS = synthBars(1716, 12345);

// ── 야후 chart 응답 스텁 ──
globalThis.fetch = async function (url) {
  const u = String(url);
  if (u.indexOf("/v8/finance/chart/") >= 0) {
    return {
      ok: true, status: 200,
      json: async function () {
        return { chart: { result: [{
          meta: { regularMarketPrice: BARS.c[BARS.c.length - 1] },
          timestamp: BARS.ts,
          indicators: { quote: [{ open: BARS.o, high: BARS.h, low: BARS.l, close: BARS.c, volume: BARS.v }] }
        }] } };
      },
      text: async function () { return "{}"; }
    };
  }
  throw new Error("unexpected fetch in test: " + u.slice(0, 80));
};

// ── 합성 D1 ──
function fakeDB(rows) {
  const state = new Map(rows || []);
  return {
    prepare(sql) {
      const st = {
        _args: [],
        bind(...a) { st._args = a; return st; },
        async first() {
          if (/SELECT v FROM state WHERE k = \?/.test(sql)) {
            const v = state.get(st._args[0]);
            return v === undefined ? null : { v: v };
          }
          return null;
        },
        async all() {
          if (/SELECT k FROM state WHERE k >= 'daily:'/.test(sql)) {
            const out = [];
            for (const k of state.keys()) if (k.startsWith("daily:")) out.push({ k: k });
            out.sort(function (a, b) { return a.k < b.k ? -1 : 1; });
            return { results: out };
          }
          if (/SELECT k, v FROM state WHERE k IN/.test(sql)) {
            const out = [];
            for (const k of st._args) { const v = state.get(k); if (v !== undefined) out.push({ k: k, v: v }); }
            return { results: out };
          }
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO state/.test(sql)) state.set(st._args[0], st._args[1]);
          return { success: true };
        }
      };
      return st;
    },
    async batch(sts) { for (const s of sts) await s.run(); return []; },
    _state: state
  };
}

// ── 합성 일봉(daily:) ──
function synthDaily(n) {
  const c = [], o = [], h = [], l = [], v = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    px = px * (1 + Math.sin(i / 7) * 0.004 + 0.0005);
    o.push(px * 0.999); c.push(px); h.push(px * 1.01); l.push(px * 0.99); v.push(1000000 + i * 100);
  }
  return { closes: c, opens: o, highs: h, lows: l, volumes: v, price: c[c.length - 1], ts: Date.now() };
}

const M = await import("../src/index.js");

let fails = 0;
const ok = (msg) => console.log("  ok   " + msg);
const bad = (msg) => { fails++; console.log("  FAIL " + msg); };

// ══ 1) 백필이 실제로 표본을 만드는가 ══════════════════════════════════════════
{
  const daily = JSON.stringify(synthDaily(300));
  const db = fakeDB([
    ["daily:AAA", daily], ["daily:BBB", daily], ["daily:CCC", daily]
  ]);
  const r2 = { _puts: [], async put(k, body) { this._puts.push({ k, n: JSON.parse(body).n }); } };
  M._setR2ForTest(r2);
  const res = await M.stinBackfill(db, { maxSyms: 3, maxSamples: 4000 });
  const made = r2._puts.reduce(function (a, p) { return a + p.n; }, 0);
  console.log("  [백필] " + res);
  if (made > 0) ok("백필 표본 생성 " + made + "건 (R2 오브젝트 " + r2._puts.length + ")");
  else bad("백필 표본 0건 — 파이프라인이 막혀 있다: " + res);

  // stin_stats 누적이 실제로 올라갔는가(화면 '표본 N' 의 소스)
  const ss = JSON.parse(db._state.get("stin_stats") || "{}");
  if (Number(ss.total) > 0) ok("stin_stats.total 누적 " + ss.total);
  else bad("stin_stats.total 이 0 — 화면엔 영원히 '표본 0' 으로 보인다");

  // 재실행 시 워터마크로 중복이 차단되는가(무한 사본 증식 방지)
  r2._puts.length = 0;
  const res2 = await M.stinBackfill(db, { maxSyms: 3, maxSamples: 4000 });
  const made2 = r2._puts.reduce(function (a, p) { return a + p.n; }, 0);
  if (made2 === 0) ok("워터마크 재실행 중복차단 (2회차 +" + made2 + ")");
  else bad("워터마크가 안 먹는다 — 같은 봉이 재수확됨 (+" + made2 + "): " + res2);
}

// ══ 2) 라이브 관측 경로가 표본을 만드는가 ════════════════════════════════════
{
  const n = 400;
  const mb = {
    closes: BARS.c.slice(-78), highs: BARS.h.slice(-78), lows: BARS.l.slice(-78),
    volumes: BARS.v.slice(-78), opens: BARS.o.slice(-78), times: BARS.ts.slice(-78),
    allCloses: BARS.c.slice(-n), allHighs: BARS.h.slice(-n), allLows: BARS.l.slice(-n),
    allVolumes: BARS.v.slice(-n), allOpens: BARS.o.slice(-n), allTimes: BARS.ts.slice(-n)
  };
  const px = mb.closes[mb.closes.length - 1];
  const ifeat = M.stinIntradayFeat(mb, px, mb.closes[0]);
  if (Array.isArray(ifeat) && ifeat.length === M.STIN_IFEAT_N) ok("라이브 장중피처 " + ifeat.length + "차원");
  else bad("라이브 장중피처 null — 관측이 구조적으로 0건이 된다");

  const feat = M.mlBuildFeatures({
    closes: synthDaily(300).closes, volumes: [], opens: [], highs: [], lows: [],
    price: px, prevClose: px, dayPct: 0, regime: "NEUTRAL", strategy: "scalp", market: "us", ev: {}
  });
  const pend = { items: [], done: [], fts: 0 };
  const obsOk = M.stinObserve(pend, "AAA", "us", feat, px, ifeat);
  if (obsOk && pend.items.length === 1) ok("stinObserve 관측 적재 1건");
  else bad("stinObserve 가 거부했다 — 라이브 관측 0건의 원인");

  // 배리어 접촉 라벨링
  const it = pend.items[0];
  const labeled = M.stinLabel(pend, function () { return it.p * (1 + (it.b + 0.5) / 100); });
  if (labeled === 1 && pend.done.length === 1 && pend.done[0].y === 1) ok("삼중배리어 라벨링(상단 접촉→y=1)");
  else bad("라벨링 실패 labeled=" + labeled + " done=" + pend.done.length);
}

// ══ 3) 백필이 실제로 내보내는 표본의 세션 피처가 라이브 분포와 같은가 ══════════
//   백필이 '한 달치 전체 창'으로 세션 지표(VWAP 이격·레인지위치·경과율)를 계산하면
//   라이브(오늘 세션)와 의미가 달라진다 — 같은 시장 상태에 다른 입력을 주는 모델이 된다.
//   여기서는 stinBackfill 이 R2 로 내보낸 ix 벡터를 직접 열어 검사한다(구현 추측 없음).
{
  const daily = JSON.stringify(synthDaily(300));
  const db = fakeDB([["daily:AAA", daily]]);
  const r2 = { _objs: [], async put(k, body) { this._objs.push(JSON.parse(body)); } };
  M._setR2ForTest(r2);
  await M.stinBackfill(db, { maxSyms: 1, maxSamples: 4000 });
  const samples = r2._objs.flatMap(function (o) { return o.samples || []; });
  if (!samples.length) { bad("표본이 없어 세션피처 검사 불가"); }
  else {
    // ix 인덱스: 4=vwapDev 6=rangePos 9=sessFrac (stinIntradayFeat 의 out 배열 순서)
    const sf = samples.map(function (s) { return s.ix[9]; });
    const vd = samples.map(function (s) { return Math.abs(s.ix[4]); });
    const sfMax = Math.max.apply(null, sf), sfMin = Math.min.apply(null, sf);
    const vdMax = Math.max.apply(null, vd);
    // 라이브 sessFrac 은 세션 진행률이라 0~1 을 고르게 훑는다. 한 달 창이면 전부 상한(1.2)에 붙는다.
    if (sfMax <= 1.05 && sfMin < 0.6) ok("sessFrac 이 세션 진행률 분포 (" + sfMin.toFixed(2) + "~" + sfMax.toFixed(2) + ")");
    else bad("train/serve 스큐 — sessFrac " + sfMin.toFixed(2) + "~" + sfMax.toFixed(2) + " (라이브는 0~1 분포)");
    // VWAP 이격은 당일 평균단가 대비값이라 한 자릿수 초반이 정상. 한 달 창이면 수 %~수십 %로 튄다.
    if (vdMax <= 5) ok("vwapDev 가 세션 스케일 (|max| " + vdMax.toFixed(2) + "%)");
    else bad("train/serve 스큐 — vwapDev |max| " + vdMax.toFixed(2) + "% (세션 기준이면 5% 이내)");
  }
}

console.log(fails ? "\n단타 파이프라인 검증 실패 " + fails + "건" : "\n  ok   단타 표본 파이프라인 통과");
process.exit(fails ? 1 : 0);
