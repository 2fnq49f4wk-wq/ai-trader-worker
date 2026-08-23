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
// 케이스별로 응답 길이를 바꿔야 하므로(60d 판정 검증) 스텁이 참조를 통해 읽는다.
const BARS_REF = { cur: BARS };

// ── 야후 chart 응답 스텁 ──
globalThis.fetch = async function (url) {
  const u = String(url);
  if (u.indexOf("/v8/finance/chart/") >= 0) {
    const B = BARS_REF.cur;
    return {
      ok: true, status: 200,
      json: async function () {
        return { chart: { result: [{
          meta: { regularMarketPrice: B.c[B.c.length - 1] },
          timestamp: B.ts,
          indicators: { quote: [{ open: B.o, high: B.h, low: B.l, close: B.c, volume: B.v }] }
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

// ══ 1-b) 긴 range(60일) 판정 · 마감시한 · 청크 플러시 ═════════════════════════
//   [V33.106] 같은 fetch 1회로 봉을 2배 받는 경로. 야후가 60d 를 실제로 주면 그대로 쓰고,
//   1mo 분량만 오면 자동 강등한다 — 그 판정이 실제로 도는지 확인한다.
{
  /* [V33.222] ★고정 봉 수는 봉 길이가 바뀌면 다른 기간을 뜻한다.★
     3400봉은 5분봉일 때 60일치지만 1분봉이면 9일치다 — 같은 숫자가 다른 시험이 된다.
     기간(분)으로 잡고 봉 수를 파생시킨다. 아래 기대값들도 같은 방식으로 스케일한다. */
  const _BM = M.SCALP_BAR_MIN || 5;
  const LONG_MIN = 3400 * 5;                  // 종전 시험이 다루던 실제 기간(분)
  const LONG = synthBars(Math.round(LONG_MIN / _BM), 777);
  const prevBars = BARS_REF.cur;
  BARS_REF.cur = LONG;
  const daily = JSON.stringify(synthDaily(300));
  const db = fakeDB([["daily:AAA", daily], ["daily:BBB", daily]]);
  const r2 = { _objs: [], async put(k, body) { this._objs.push({ k, o: JSON.parse(body) }); } };
  M._setR2ForTest(r2);
  const res = await M.stinBackfill(db, { maxSyms: 2, maxSamples: 100000 });
  const n = r2._objs.reduce(function (a, x) { return a + x.o.n; }, 0);
  console.log("  [긴range] " + res);
  const rs = JSON.parse(db._state.get("stin_bf_range") || "null");
  /* 계약의 실질은 "봉이 실제로 길게 오면 강등하지 않는다" 이다. 시작 range 는 봉 길이가 정한다
     — 1분봉은 야후가 약 7일까지만 주므로 60d 로 시작하는 것 자체가 틀린 요청이다. */
  const _wantRange = _BM <= 1 ? "7d" : "60d";
  if (rs && rs.v === _wantRange && !rs.demoted) ok("긴 range 유지 (" + _wantRange + " · 봉이 실제로 길면 강등 안 함)");
  else bad("긴 range 가 강등됐다 — " + JSON.stringify(rs) + " (기대 " + _wantRange + ")");
  // 수율도 봉 길이에 따라 달라진다: 표본 간격(minGapMin)이 분 단위라 1분봉이면 봉 25개마다 1건.
  const _wantN = Math.round(400 * (5 / _BM) / (5 / _BM));   // 기간이 같으면 표본 수도 같아야 한다
  if (n > _wantN) ok("긴 range 수율 " + n + "건/2종목 (봉 " + _BM + "분 기준)");
  else bad("긴 range 인데 수율이 " + n + "건뿐 (기대 >" + _wantN + ")");

  // 마감시한 0 이면 한 종목도 안 돈다(벽시계 가드가 실제로 먹는지).
  const db2 = fakeDB([["daily:AAA", daily], ["daily:BBB", daily]]);
  const r2b = { _n: 0, async put(k, b) { this._n += JSON.parse(b).n; } };
  M._setR2ForTest(r2b);
  const res2 = await M.stinBackfill(db2, { maxSyms: 2, maxSamples: 100000, deadlineMs: -1 });
  if (r2b._n === 0 && /0건/.test(res2)) ok("마감시한 가드 동작 (deadlineMs=-1 → 0건)");
  else bad("마감시한을 무시했다 — " + res2);

  // 청크 플러시: 4,000건마다 오브젝트가 나뉘어야 한다(메모리 상한 방어).
  // 종목당 약 280표본이므로 4,000 경계를 넘기려면 20종목이 필요하다.
  const _rows3 = [];
  for (let i = 0; i < 20; i++) _rows3.push(["daily:A" + (i < 10 ? "0" + i : i), daily]);
  const db3 = fakeDB(_rows3);
  const r2c = { _objs: [], async put(k, b) { this._objs.push(JSON.parse(b).n); } };
  M._setR2ForTest(r2c);
  await M.stinBackfill(db3, { maxSyms: 20, maxSamples: 100000 });
  const tot = r2c._objs.reduce(function (a, b) { return a + b; }, 0);
  if (tot > 4000 && r2c._objs.length >= 2 && Math.max.apply(null, r2c._objs) <= 4600)
    ok("청크 플러시 " + r2c._objs.length + "파일 · 총 " + tot + "건 (파일당 최대 " + Math.max.apply(null, r2c._objs) + ")");
  else bad("청크 분할이 안 됐다: 파일 " + r2c._objs.length + " 총 " + tot + " 최대 " + (r2c._objs.length ? Math.max.apply(null, r2c._objs) : 0));

  // [V33.106] 회전 오프셋은 ★실제로 본 종목 수★ 만큼만 밀려야 한다.
  //   마감시한으로 중간에 끊겼는데 picked 전체만큼 밀면 못 본 종목이 영영 건너뛰어진다
  //   (전수 커버가 조용히 깨지고, 로그만 보면 정상으로 보인다).
  {
    const _rows4 = [];
    for (let i = 0; i < 12; i++) _rows4.push(["daily:B" + (i < 10 ? "0" + i : i), daily]);
    const db4 = fakeDB(_rows4);
    const r2d = { async put() {} };
    M._setR2ForTest(r2d);
    // 표본 상한을 아주 낮게 잡아 첫 종목에서 끊기게 만든다.
    await M.stinBackfill(db4, { maxSyms: 12, maxSamples: 10 });
    const off = JSON.parse(db4._state.get("stin_bf_offset") || "{}");
    if (Number(off.v) > 0 && Number(off.v) <= 3)
      ok("회전 오프셋이 처리분(" + off.v + ")만큼만 전진 — 미처리 종목 건너뜀 없음");
    else bad("오프셋이 " + off.v + " 로 밀렸다 — 못 본 종목이 회전에서 사라진다");
  }

  BARS_REF.cur = prevBars;
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

/* ══ [V33.180] ★화면은 없는 폴백을 있다고 말하면 안 된다★ ══
   V33.110 이 장중(단타) 표본의 D1 폴백을 제거했다 — R2 가 없으면 우회하지 않고 수집이 멈춘다.
   그런데 화면과 /api/r2-status 는 그 뒤로도 "D1 폴백으로 동작 중 (표본 수집·학습 가능)" 이라고
   답했다. 실제로 R2 가 9회 연속 미바인딩이라 수집이 멈춰 있던 시간에도 그렇게 적혀 있었다.
   ★고장났는데 초록불★ 은 이 저장소가 반복해 겪은 실패 방식이라, 문구 자체를 계약으로 못 박는다.
   (대형모델의 D1 청크 폴백은 실제로 남아 있다 — 그건 금지 대상이 아니다) */
{
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

  /* 금지: '표본 수집' 이 D1 폴백으로 가능하다는 취지의 문구.
     ★줄 단위로 본다.★ 처음엔 줄바꿈을 넘나드는 패턴으로 썼는데, 그러면 "종전 문구는 …였다" 라고
     ★옛 문구를 인용한 주석★ 까지 걸린다(실제로 이 검사가 그렇게 자기 자신을 잡았다).
     화면에 실제로 나가는 문자열은 한 줄짜리 push 이므로 줄 안에서만 찾으면 충분하고,
     사고 경위를 주석으로 남기는 일을 막지 않는다 — 그 기록이 다음 사람에게 필요하다. */
  const lie = /D1 폴백으로 동작 중[^<\n]*표본 수집/;
  const hit = html.split("\n").findIndex(function (L) { return lie.test(L); });
  if (hit < 0) ok("화면: '표본 수집이 D1 폴백으로 가능' 이라는 문구가 없다");
  else bad("화면이 없는 폴백을 안내한다(" + (hit + 1) + "행) — V33.110 이후 R2 없으면 장중 표본 수집은 멈춘다");

  // 단타 저장경로 칸이 미바인딩을 '폴백'(정상처럼)으로 적지 않는다.
  const storeBlk = html.slice(Math.max(0, html.indexOf("sc.r2Bound === false")), html.indexOf("sc.r2Bound === false") + 400);
  if (storeBlk && !/col\('D1 폴백'/.test(storeBlk)) ok("화면: 단타 저장경로가 미바인딩을 'D1 폴백' 이라 적지 않는다");
  else bad("단타 저장경로가 'D1 폴백' 으로 표시된다 — 멈춘 상태를 동작 중으로 읽게 만든다");

  // 서버 응답도 같은 자로. bound:false 응답이 수집 중단임을 명시해야 한다.
  if (/scalpCollection:\s*"stopped"/.test(src)) ok("서버: /api/r2-status 가 미바인딩 시 '장중 표본 수집 중단' 을 명시한다");
  else bad("서버: /api/r2-status 가 미바인딩을 '폴백' 으로만 답한다 — 화면과 같은 거짓말이 된다");

  // V33.110 의 사실 자체가 유지되는지 — 폴백이 되살아나면 위 문구 금지도 뜻이 없다.
  if (/D1 폴백 제거/.test(src)) ok("소스: 장중 표본의 D1 폴백 제거가 유지된다(문구 계약의 전제)");
  else bad("소스에서 'D1 폴백 제거' 근거가 사라졌다 — 폴백이 되살아났다면 위 문구 계약을 재검토할 것");
}

/* ── [V33.222] 기준봉 파생 계약 — '5' 가 다시 흩어지지 않게 ─────────────────────
   봉 길이는 상수 하나(SCALP_BAR_MIN)여야 하고, 시간 개념(지평·세션·창)은 전부 ★분★ 으로
   적힌 뒤 _barsFor 로 봉 수가 되어야 한다. 봉 수를 직접 상수로 쓰면 봉 길이를 바꾸는 순간
   그 값이 다른 시간을 뜻하게 되는데, 아무 데도 안 적혀 조용히 어긋난다.
   실제로 그랬다: horizonBars 12(=60분) · sessFrac 분모 78 · 모멘텀 3봉 · barMin 5. */
{
  const { readFileSync: _rf } = await import("node:fs");
  // 주석은 지우고 ★코드만★ 본다 — 주석이 옛 상태를 설명하면(예: "종전엔 barMin: 5 였다")
  //   그 문장이 잔재로 잡혀 거짓 실패가 난다.
  const src2 = _rf(new URL("../src/index.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const bm = M.SCALP_BAR_MIN;
  if (!(typeof bm === "number" && bm > 0)) bad("SCALP_BAR_MIN 이 내보내지지 않는다 — 게이트가 봉 길이를 알 수 없다");
  else ok("기준봉 상수 SCALP_BAR_MIN = " + bm + "분");

  // 지평은 분으로 적히고 봉 수는 파생돼야 한다.
  if (!/horizonMin:\s*60/.test(src2) || !/get horizonBars\(\)\s*\{\s*return _barsFor\(this\.horizonMin\)/.test(src2))
    bad("STIN 라벨 지평이 분(horizonMin)에서 파생되지 않는다 — 봉을 바꾸면 지평이 조용히 달라진다");
  else ok("라벨 지평이 분으로 적히고 봉 수는 파생된다(horizonBars = _barsFor(horizonMin))");
  if (M.STIN && M.STIN.horizonBars !== Math.max(1, Math.round(60 / bm)))
    bad("지평 봉 수가 기준봉과 안 맞는다: " + (M.STIN && M.STIN.horizonBars));
  else ok("지평 " + (M.STIN ? M.STIN.horizonBars : "?") + "봉 = 60분 (기준봉 " + bm + "분)");

  // 봉 수를 직접 박은 잔재가 없어야 한다.
  const strays = [];
  if (/_sessN \/ 78\b/.test(src2)) strays.push("세션 분모 78(5분봉 전제)");
  if (/barMin:\s*5\b/.test(src2)) strays.push("barMin: 5");
  if (/horizonBars \* 5\b/.test(src2)) strays.push("horizonBars * 5");
  if (/interval:\s*"5m"/.test(src2)) strays.push('interval: "5m" 하드코딩');
  if (/Math\.min\(3, closes\.length - 1\)/.test(src2)) strays.push("모멘텀 3봉 하드코딩");
  if (strays.length) bad("기준봉과 무관하게 박힌 상수가 남아 있다: " + strays.join(" · "));
  else ok("봉 수를 직접 박은 잔재가 없다(세션·barMin·지평·interval·모멘텀 전부 파생)");

  // _barsFor 는 최소 1봉을 보장해야 한다 — 0봉이면 나눗셈·인덱싱이 무너진다.
  if (M._barsFor && M._barsFor(0) >= 1 && M._barsFor(0.4) >= 1) ok("_barsFor 는 최소 1봉을 보장한다");
  else bad("_barsFor 가 0 을 돌려줄 수 있다 — 0봉 창은 나눗셈·인덱싱을 무너뜨린다");
}

console.log(fails ? "\n단타 파이프라인 검증 실패 " + fails + "건" : "\n  ok   단타 표본 파이프라인 통과");
process.exit(fails ? 1 : 0);
