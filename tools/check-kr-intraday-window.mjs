/* ═══════════════════════════════════════════════════════════════════════════
   [V33.246] ★줄 것이 없는 시각엔 묻지 않는다★ — KR 장중 소급생성의 헛 fetch

   프로덕션 로그 27사이클(KST 06:33~08:38)에서 같은 문장이 반복됐다:
     [ST-BACKFILL] 0건 — 968종목 중 393~513 구간(120종목)
                   (성공 0 실패 60 짧음 0 기수확 1819, range 5d)
   자가진단은 이것을 "모듈 실패 11건 반복" 으로 올렸다.

   ■ 무엇이 실패했나 — 추정이 아니라 동정(同定)이다
   유니버스는 US/KR 을 번갈아 끼운다. 그러면 각 구간의 ★KR 개수★ 가 곧 실패 수여야 한다.
   관측 12건을 그 가설로 풀면 (US 563 · KR 405) 에서:
       934~34(68)  KR 17 → 실패 17      897~33(104) KR 16 → 실패 16
       926~77(119) KR 38 → 실패 38      753~866(113) KR 29 → 실패 29
       797~897(100) KR  7 → 실패  7     866~934(68) KR  0 → 실패  0
       393·470·513 구간(각 120) KR 60 → 실패 60 (셋 다)
   12건 총 잔차 4 — 그 4 는 US 전용 구간에서도 보이는 진짜 US 실패다.
   즉 ★KR 은 100% 실패하고, 그 외에는 거의 실패하지 않는다.★

   ■ 왜 — 네이버 분봉은 '지금 세션' 만 준다
   위 로그의 시각은 전부 한국장 개장(09:00 KST) 전이다. 그 시각엔 오늘 봉이 없어
   빈 배열이 오고, 코드는 그것을 예외로 올린다. 어제 봉은 이미 워터마크가 덮었다 —
   어느 쪽이든 수확량은 0 이다.

   ■ 비용이 표시보다 크다 — 이건 처리량 문제다
   회차는 벽시계 25초로 끊긴다. KR 한 종목이 실패까지 약 300ms(1분봉 → 5분봉 폴백,
   왕복 2회)를 쓰므로 60종목이면 18초 — ★예산의 7할★ 이 한 번도 성공한 적 없는
   호출에 들어간다. 그래서 같은 회차에서 US 는 12종목밖에 못 본다
   (US 전용 구간에서는 68~96종목을 본다).

   여기서 지키는 것:
     · 한국장 세션 밖에서는 KR 을 ★부르지 않는다★ (수확량 0 이므로 무손실)
     · 세션 안에서는 종전대로 부른다 — 장중 수집을 막는 게 아니다
     · 건너뛴 것을 실패로 세지 않는다(휴장은 고장이 아니다)
     · 실패에는 ★이유★ 가 붙는다 — 이 진단에 로그 왕복이 한 번 더 든 이유가 그것이다
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";

let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* ── ① 프로덕션 수치 재현 — "실패 = 그 구간의 KR 개수" 가설을 12건에 맞춰 본다 ── */
console.log("① 실측 재현 (실패 수 = 구간 내 KR 종목 수인가)");
{
  const N = 968;
  // (오프셋, 구간 종목수, 관측 실패수) — 워커 로그 그대로
  const OBS = [[934, 68, 17], [897, 104, 16], [926, 119, 38], [34, 77, 39], [866, 68, 0],
               [830, 96, 1], [753, 113, 29], [797, 100, 7], [393, 120, 60], [513, 120, 60],
               [470, 120, 60], [77, 120, 62]];
  const build = (nKr) => {
    const nUs = N - nKr, kind = [];
    for (let i = 0; i < Math.max(nUs, nKr); i++) { if (i < nUs) kind.push("u"); if (i < nKr) kind.push("k"); }
    return kind.length === N ? kind : null;
  };
  const score = (nKr) => {
    const kind = build(nKr); if (!kind) return null;
    let err = 0, exact = 0;
    for (const [off, cnt, fail] of OBS) {
      let kr = 0; for (let j = 0; j < cnt; j++) if (kind[(off + j) % N] === "k") kr++;
      const d = Math.abs(kr - fail); err += d; if (d === 0) exact++;
    }
    return { err, exact };
  };
  let best = null, bestKr = 0;
  for (let nKr = 1; nKr < N; nKr++) {
    const s = score(nKr); if (!s) continue;
    if (!best || s.err < best.err) { best = s; bestKr = nKr; }
  }
  chk(best && best.err <= 6,
    "KR=" + bestKr + " 에서 12건 총 잔차 " + best.err + " — 'KR 전량 실패' 가 관측을 설명한다",
    "어떤 분할로도 관측이 설명되지 않는다 — 원인 진단(KR 전량 실패)이 틀렸다");
  chk(best && best.exact >= 8,
    "12건 중 " + best.exact + "건이 정확히 일치 — 우연으로 맞출 수 있는 수가 아니다",
    "정확일치가 너무 적다 — 다른 원인이 섞여 있다");
  // 반증 가능성: 'US 가 전량 실패' 가설은 같은 데이터를 설명하지 못해야 한다
  const usHyp = (() => {
    const kind = build(bestKr); let err = 0;
    for (const [off, cnt, fail] of OBS) {
      let us = 0; for (let j = 0; j < cnt; j++) if (kind[(off + j) % N] === "u") us++;
      err += Math.abs(us - fail);
    }
    return err;
  })();
  chk(usHyp > best.err * 10,
    "'US 전량 실패' 가설은 잔차 " + usHyp + " 로 기각된다 — 검사가 아무 가설이나 받아주지 않는다",
    "반대 가설도 비슷하게 맞는다 — 이 재현은 아무것도 구별하지 못한다");
}

/* ── ② 소스 계약 — 세션 밖 KR 을 건너뛰고, 그것을 실패로 세지 않는가 ── */
console.log("② 소스 계약");
{
  const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const fn = S.slice(S.indexOf("async function stinBackfill"), S.indexOf("\n}", S.indexOf("[ST-BACKFILL] fail:")));
  chk(/_krSessionLive/.test(fn), "세션 판정이 존재한다", "세션 판정이 없다 — 개장 전에도 KR 을 부른다");
  chk(/_mkt === "kr" && !_krSessionLive.*skipClosed\+\+/.test(fn),
    "세션 밖 KR 은 fetch 전에 건너뛴다",
    "건너뛰기가 fetch 뒤에 있거나 없다 — 헛 fetch 비용이 그대로다");
  const skipLine = fn.slice(fn.indexOf('_mkt === "kr" && !_krSessionLive'), fn.indexOf('_mkt === "kr" && !_krSessionLive') + 120);
  chk(!/symFail\+\+/.test(skipLine),
    "건너뛴 것을 실패로 세지 않는다",
    "휴장을 실패로 센다 — 자가진단이 정상 상태에 '모듈 실패 반복' 을 울린다");
  chk(/getKST/.test(fn) && /totalMin >= 540/.test(fn),
    "판정 기준이 KST 09:00 개장이다",
    "개장 시각 기준이 없다 — 장중까지 막으면 수집이 통째로 죽는다");
  chk(/_failWhy|_failTop/.test(fn),
    "실패에 이유가 붙는다",
    "실패 수만 세고 이유가 없다 — 다음 진단도 로그 왕복이 필요하다");
  // 로그 두 줄(0건 / 표본 있음) 모두에 실려야 한다 — 한쪽만이면 정작 0건일 때 안 보인다
  const lines = fn.match(/성공 " \+ symOk/g) || [];
  chk(lines.length >= 2, "성공/실패 요약이 두 경로 모두에 있다", "요약 경로가 " + lines.length + "곳뿐이다");
  const both = (fn.match(/_failTop\(\)/g) || []).length;
  chk(both >= 2, "실패 이유가 두 경로 모두에 실린다(0건일 때도 보인다)",
    "_failTop 이 " + both + "곳에만 있다 — 0건 로그에서 이유가 사라진다");
}

/* ── ③ 실제 실행 — 세션 안/밖에서 동작이 갈리고, 건너뛰어도 표본이 줄지 않는가 ── */
console.log("③ 실제 실행 (개장 전 vs 장중)");
{
  const SESS = 390;
  const mkBars = (n) => {
    let s = 99991, px = 100;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    let t = Math.floor(Date.now() / 1000) - Math.ceil(n / SESS) * 86400;
    const ts = [], o = [], h = [], l = [], c = [], v = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) t += (i % SESS === 0) ? (86400 - SESS * 60 + 60) : 60;
      const op = px; px = Math.max(1, px * (1 + Math.sin(i / 50) * 0.0006 + (rnd() - 0.5) * 0.004));
      ts.push(t); o.push(op); c.push(px); h.push(Math.max(op, px) * 1.001); l.push(Math.min(op, px) * 0.999);
      v.push(5000 + Math.floor(rnd() * 9000));
    }
    return { ts, o, h, l, c, v };
  };
  const B = mkBars(1950);
  let naverCalls = 0, yahooCalls = 0;
  globalThis.fetch = async function (url) {
    const u = String(url);
    if (u.indexOf("api.stock.naver.com") >= 0) {
      naverCalls++;
      // 개장 전 네이버: 200 인데 빈 배열 — 프로덕션에서 관측된 그 모양
      return { ok: true, status: 200, async json() { return []; }, async text() { return "[]"; } };
    }
    if (u.indexOf("/v8/finance/chart/") >= 0) {
      yahooCalls++;
      return { ok: true, status: 200, async text() { return "{}"; }, async json() {
        return { chart: { result: [{ meta: { regularMarketPrice: B.c[B.c.length - 1] }, timestamp: B.ts,
          indicators: { quote: [{ open: B.o, high: B.h, low: B.l, close: B.c, volume: B.v }] } }] } };
      } };
    }
    throw new Error("unexpected fetch: " + u.slice(0, 60));
  };
  const synthDaily = () => { const c = [], o = [], h = [], l = [], v = []; let px = 100;
    for (let i = 0; i < 300; i++) { px *= (1 + Math.sin(i / 7) * 0.004 + 0.0005); o.push(px * 0.999); c.push(px); h.push(px * 1.01); l.push(px * 0.99); v.push(1e6); }
    return JSON.stringify({ closes: c, opens: o, highs: h, lows: l, volumes: v, price: c[c.length - 1], ts: Date.now() }); };
  const fakeDB = (rows) => { const state = new Map(rows);
    return { prepare(sql) { const st = { _args: [], bind(...a) { st._args = a; return st; },
      async first() { if (/SELECT v FROM state WHERE k = \?/.test(sql)) { const v = state.get(st._args[0]); return v === undefined ? null : { v }; } return null; },
      async all() {
        if (/SELECT k FROM state WHERE k >= 'daily:'/.test(sql)) { const out = []; for (const k of state.keys()) if (k.startsWith("daily:")) out.push({ k }); out.sort((a, b) => a.k < b.k ? -1 : 1); return { results: out }; }
        if (/SELECT k, v FROM state WHERE k IN/.test(sql)) { const out = []; for (const k of st._args) { const v = state.get(k); if (v !== undefined) out.push({ k, v }); } return { results: out }; }
        return { results: [] }; },
      async run() { if (/INSERT INTO state/.test(sql)) state.set(st._args[0], st._args[1]); return { success: true }; } }; return st; },
      async batch(sts) { for (const s of sts) await s.run(); return []; }, _state: state }; };

  const M = await import("../src/index.js");
  const d = synthDaily();
  const rows = () => [["daily:AAA", d], ["daily:BBB", d], ["daily:CCC", d],
                      ["daily:005930.KS", d], ["daily:000660.KS", d], ["daily:035720.KQ", d]];

  // 고정 시각으로 돌린다 — 화요일 07:00 KST(개장 전) / 11:00 KST(장중)
  const run = async (isoUtc) => {
    const Real = Date;
    class Fake extends Real { constructor(...a) { if (a.length === 0) super(isoUtc); else super(...a); } static now() { return Real.now(); } }
    globalThis.Date = Fake;
    naverCalls = 0; yahooCalls = 0;
    const r2 = { _puts: [], async put(k, b) { this._puts.push({ k, n: JSON.parse(b).n }); } };
    M._setR2ForTest(r2);
    try {
      const msg = await M.stinBackfill(fakeDB(rows()), { maxSyms: 6, maxSamples: 100000 });
      const made = r2._puts.reduce((a, p) => a + p.n, 0);
      return { msg, made, naverCalls, yahooCalls };
    } finally { globalThis.Date = Real; }
  };

  const pre = await run("2026-08-24T22:00:00Z");    // 화 07:00 KST — 개장 전
  const mid = await run("2026-08-25T02:00:00Z");    // 화 11:00 KST — 장중
  console.log("  [개장 전] " + pre.msg);
  console.log("  [장중]   " + mid.msg);

  chk(pre.naverCalls === 0,
    "개장 전 네이버 호출 0회 — 헛 fetch 가 사라졌다",
    "개장 전에도 네이버를 " + pre.naverCalls + "회 부른다 — 예산이 그대로 샌다");
  chk(/휴장건너뜀 3/.test(pre.msg),
    "건너뛴 KR 3종목이 '휴장건너뜀' 으로 따로 보고된다",
    "휴장 건너뜀이 로그에 안 보인다 — 조용히 빠지면 수집 중단과 구별이 안 된다");
  chk(/실패 0/.test(pre.msg),
    "개장 전 실패 0 — 정상 상태를 고장으로 보고하지 않는다",
    "휴장을 여전히 실패로 센다: " + pre.msg);
  chk(mid.naverCalls > 0,
    "장중에는 네이버를 " + mid.naverCalls + "회 부른다 — 수집을 막은 게 아니다",
    "장중에도 KR 을 건너뛴다 — 한국장 표본이 영영 안 쌓인다");
  chk(/naver candle\/minute empty/.test(mid.msg),
    "장중 실패에는 이유가 붙는다(naver … empty)",
    "실패 이유가 로그에 없다: " + mid.msg);
  chk(pre.made === mid.made && pre.made > 0,
    "표본 수가 같다(" + pre.made + "건) — 건너뛰어도 잃는 표본이 0 이다",
    "표본이 달라진다(개장전 " + pre.made + " vs 장중 " + mid.made + ") — 건너뛰기가 수확을 깎았다");
  chk(pre.yahooCalls === mid.yahooCalls && pre.yahooCalls > 0,
    "US 경로는 두 경우 모두 동일하게 돈다(" + pre.yahooCalls + "회)",
    "US 처리량이 달라졌다 — 건너뛰기가 엉뚱한 곳을 건드렸다");
}

console.log(fails ? "\n✗ KR 장중 창 검사 " + fails + "건 실패" : "\n✓ KR 장중 창 검사 통과");
process.exit(fails ? 1 : 0);
