/* ═══════════════════════════════════════════════════════════════════════════
   [V33.304] FLOW 피어 상관 — ★같은 답을 더 싸게★ 구하는가.

   ■ 무엇이 있었나 (운영 스냅샷 2026-09-04)
       [EVAL-COST] US 종목당 평균 1342ms · 부가조회 ★7242/7200ms(예산소진 3건 생략)★
                   · FLOW갱신 6종목 · scalp 505ms · ★flow 6737ms★
       [EVAL-COST] KR … 부가조회 7278/7200ms(★예산소진 30건 생략★) · scalp 4003ms
       [TIME-CAP]  KR 평가 37/446종목(8%) 후 중단 — 전종목 한바퀴 ~27사이클
     부가조회 지갑 7.2초의 93% 를 flow 하나가 먹었다. 그 사이클에 flow 가 네트워크를
     탄 종목은 ★6개★ 뿐이다 — 6.7초는 fetch 대기가 아니라 ★순수 CPU★ 였다.

     flowPeerFeat 은 종목을 평가할 때마다 유니버스 전체를 돌며 종목마다 60개짜리
     로그수익 배열을 ★새로 만들고★ Math.log 를 60번 불렀다. dailyCache 는 사이클당
     한 번 만들어 놓고 안 바뀌는데도. 평가 124종목이면 Math.log 약 400만 번이다.

   ■ 이 검사가 무는 것 — ★성능을 낮춰 CPU 를 벌지 않았다는 증명★
     ① 옛 구현을 이 파일 안에 그대로 두고, 같은 입력에서 ★값이 완전히 같은지★ 본다
     ② 실제로 빨라졌는지 잰다(느려졌으면 고친 의미가 없다)
     ③ 캐시가 dailyCache 를 오염시키지 않는가 — for..in 이 도는 객체다.
        여기 필드를 붙이면 그게 '종목' 으로 읽혀 조용히 틀린 피어가 섞인다.
     ④ 길이가 다른 계열은 종전 경로로 폴백하는가(폴백을 지우면 잡는다)
     ⑤ 변이 — 캐시가 틀린 값을 주면 ①이 실패하는가(검사가 살아 있는가)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* ── 옛 구현(V33.303 이전)을 그대로 옮겨 둔다 — 대조군이 없으면 "같다" 를 증명할 수 없다 ── */
function oldPeerFeat(symbol, market, dailyCache) {
  const me = dailyCache && dailyCache[symbol];
  if (!me || !Array.isArray(me.closes) || me.closes.length < 25) return null;
  const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const _ret = function (c, n) {
    if (!Array.isArray(c) || c.length < n + 1) return null;
    const a = c[c.length - 1 - n], b = c[c.length - 1];
    return (a > 0 && b > 0) ? (b / a - 1) * 100 : null;
  };
  const _logret = function (c, n) {
    const out = [];
    for (let i = Math.max(1, c.length - n); i < c.length; i++)
      if (c[i] > 0 && c[i - 1] > 0) out.push(Math.log(c[i] / c[i - 1]));
    return out;
  };
  const mine = _logret(me.closes, 60);
  if (mine.length < 25) return null;
  const _corr = function (a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 20) return 0;
    const A = a.slice(a.length - n), B = b.slice(b.length - n);
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += A[i]; mb += B[i]; }
    ma /= n; mb /= n;
    let sa = 0, sb = 0, sab = 0;
    for (let i = 0; i < n; i++) { const x = A[i] - ma, y = B[i] - mb; sa += x * x; sb += y * y; sab += x * y; }
    return (sa > 1e-12 && sb > 1e-12) ? sab / Math.sqrt(sa * sb) : 0;
  };
  const cands = [];
  for (const sy in dailyCache) {
    if (sy === symbol) continue;
    const isKR = /\.(KS|KQ)$/.test(sy);
    if ((market === "kr") !== isKR) continue;
    const d = dailyCache[sy];
    if (!d || !Array.isArray(d.closes) || d.closes.length < 25) continue;
    const c = _corr(mine, _logret(d.closes, 60));
    if (c > 0.25) cands.push({ sy: sy, c: c });
    if (cands.length > 400) break;
  }
  if (cands.length < 3) return null;
  cands.sort(function (a, b) { return b.c - a.c; });
  const top = cands.slice(0, 12);
  let r5 = 0, r20 = 0, r1 = 0, cs = 0, n5 = 0;
  const r5arr = [];
  for (const t of top) {
    const c = dailyCache[t.sy].closes;
    const a5 = _ret(c, 5), a20 = _ret(c, 20), a1 = _ret(c, 1);
    if (a5 != null) { r5 += a5; r5arr.push(a5); n5++; }
    if (a20 != null) r20 += a20;
    if (a1 != null) r1 += a1;
    cs += t.c;
  }
  if (!n5) return null;
  r5 /= n5; r20 /= n5; r1 /= n5; cs /= top.length;
  let disp = 0;
  for (const v of r5arr) disp += (v - r5) * (v - r5);
  disp = Math.sqrt(disp / r5arr.length);
  const my5 = _ret(me.closes, 5), my1 = _ret(me.closes, 1);
  return {
    peerRet5: _clamp(r5, -30, 30), peerRet20: _clamp(r20, -60, 60),
    peerDisp: _clamp(disp, 0, 30),
    peerRel5: _clamp((my5 != null ? my5 : 0) - r5, -30, 30),
    peerCorrAvg: _clamp(cs, 0, 1),
    peerLead: _clamp(r1 - (my1 != null ? my1 : 0), -15, 15),
    nPeers: top.length
  };
}

/* ── 합성 유니버스 — 운영과 같은 모양(공통인자 + 종목 고유잡음, 320봉) ── */
function mkCache(nUS, nKR, bars, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const mkt = []; for (let i = 0; i < bars; i++) mkt.push(gauss() * 0.01);
  const cache = {};
  const one = (name, beta, len) => {
    const closes = [100];
    for (let i = 1; i < len; i++) closes.push(closes[i - 1] * (1 + beta * mkt[i % bars] + gauss() * 0.012));
    cache[name] = { closes: closes };
  };
  for (let i = 0; i < nUS; i++) one("US" + i, 0.4 + rnd(), bars);
  for (let i = 0; i < nKR; i++) one("K" + i + ".KS", 0.4 + rnd(), bars);
  return cache;
}

console.log("① 값이 완전히 같은가 — 옛 구현과 대조");
{
  const cache = mkCache(120, 60, 320, 12345);
  const syms = Object.keys(cache).filter((k) => !/\.(KS|KQ)$/.test(k)).slice(0, 25)
    .concat(Object.keys(cache).filter((k) => /\.(KS|KQ)$/.test(k)).slice(0, 15));
  let diffs = 0, checked = 0, both = 0;
  for (const sy of syms) {
    const mk = /\.(KS|KQ)$/.test(sy) ? "kr" : "us";
    const a = oldPeerFeat(sy, mk, cache);
    const b = await M.flowPeerFeat(null, sy, mk, cache);
    checked++;
    if (a == null && b == null) continue;
    if (a == null || b == null) { diffs++; continue; }
    both++;
    for (const k of Object.keys(a)) if (!Object.is(a[k], b[k])) {
      diffs++;
      if (diffs <= 3) console.log(`       ${sy}.${k}: 옛 ${a[k]} vs 새 ${b[k]}`);
      break;
    }
  }
  console.log(`       종목 ${checked}개 대조(피어 성립 ${both}개)`);
  chk(both >= 20, `피어가 실제로 성립한 종목이 ${both}개 — 대조가 빈 값끼리가 아니다`,
    "피어가 거의 안 생겨 대조가 무의미하다");
  chk(diffs === 0, "★모든 종목에서 값이 비트 단위로 같다★ — 정확도를 판 게 아니다",
    `★${diffs}종목에서 값이 달라졌다 — 성능을 낮춘 것이다★`);
}

console.log("\n② 실제로 빨라졌는가");
{
  /* ══ [V33.393] ★이 측정이 배포를 막았다 — 계약이 아니라 러너의 기분을 재고 있었다.★ ══
     실측(CI run 35417376999): 옛 22ms → 새 16ms = 1.4배 → 실패 → 배포 중단.
     같은 코드가 이 기계에서는 35ms → 14ms = 2.5배다. 틀린 것은 코드가 아니라 ★측정★ 이다:
       ① 예열이 없었다 — 먼저 도는 옛 경로가 JIT 비용을 혼자 뒤집어쓰거나 그 반대가 된다.
       ② 20ms 규모에서 ±3ms 스케줄러 잡음이 배수를 1.4~2.6 사이로 흔든다.
       ③ 1회 측정이라 그 잡음을 걸러낼 방법이 없었다.
     계약("캐시가 실제로 값을 한다")은 옳다 — 문턱을 낮추지 않고 ★측정을 고친다★:
       · ★별도 캐시★ 로 양쪽을 예열한다(측정 대상 메모를 미리 채우면 새 경로를 과대평가한다)
       · 종목 수를 늘려 측정을 ±잡음보다 훨씬 크게 만든다
       · 여러 번 재고 ★최솟값★ 을 쓴다(최솟값은 스케줄러 잡음에 로버스트한 추정량이다)
       · 새 경로는 ★매 회 새 객체★ 로 잰다 — 메모 구축 비용을 항상 포함시킨다(공짜로 안 준다) */
  const mkOf = (sy) => (/\.(KS|KQ)$/.test(sy) ? "kr" : "us");
  const base = mkCache(300, 250, 320, 777);
  const syms = Object.keys(base).slice(0, 200);
  {  // 예열 — 측정 대상이 아닌 별도 캐시로만
    const w = mkCache(120, 100, 320, 4242), ws = Object.keys(w).slice(0, 40);
    for (let r = 0; r < 2; r++) {
      for (const sy of ws) oldPeerFeat(sy, mkOf(sy), w);
      for (const sy of ws) await M.flowPeerFeat(null, sy, mkOf(sy), { ...w });
    }
  }
  const REPS = 3;
  let tOld = Infinity, tNew = Infinity;
  const _reps = [];
  for (let r = 0; r < REPS; r++) {
    const cOld = { ...base };                       // 같은 데이터, 새 객체 — 조건을 맞춘다
    let t = Date.now();
    for (const sy of syms) oldPeerFeat(sy, mkOf(sy), cOld);
    const a = Date.now() - t;
    const cNew = { ...base };                       // ★메모가 항상 차갑다★ — 구축 비용 포함
    t = Date.now();
    for (const sy of syms) await M.flowPeerFeat(null, sy, mkOf(sy), cNew);
    const b = Date.now() - t;
    tOld = Math.min(tOld, a); tNew = Math.min(tNew, b); _reps.push(`${a}/${b}`);
  }
  const ratio = tOld / Math.max(1, tNew);
  console.log(`       종목 ${syms.length}개 · 유니버스 ${Object.keys(base).length}개 · ${REPS}회 최솟값`
    + ` — 옛 ${tOld}ms → 새 ${tNew}ms (${ratio.toFixed(1)}배) · 회차별 옛/새 ${_reps.join(" ")}`);
  chk(tNew < tOld, `빨라졌다 (${ratio.toFixed(1)}배)`, `★안 빨라졌다 — 옛 ${tOld}ms · 새 ${tNew}ms★`);
  chk(ratio >= 1.5, `${ratio.toFixed(1)}배 빨라졌다 (예열 후 ${REPS}회 최솟값)`,
    `배수가 ${ratio.toFixed(1)} 뿐 — 캐시가 안 먹고 있다`);
  /* ★여기서 정직해야 한다★ — 이 배수는 순수 CPU 몫이고, 운영의 6,737ms 는 그것만이
     아니었다. 아래 ⑥이 진짜 큰 몫(D1 왕복)을 검사한다. 이 항목만 보고
     "6.7초가 해결됐다" 고 읽으면 안 된다. */
}

console.log("\n③ 캐시가 dailyCache 를 오염시키지 않는가");
{
  const cache = mkCache(20, 10, 200, 42);
  const before = Object.keys(cache).length;
  const beforeKeys = new Set(Object.keys(cache));
  await M.flowPeerFeat(null, "US0", "us", cache);
  const after = Object.keys(cache);
  chk(after.length === before && after.every((k) => beforeKeys.has(k)),
    `dailyCache 키가 그대로다(${before}개) — for..in 이 캐시를 종목으로 읽지 않는다`,
    "★캐시가 dailyCache 에 필드를 붙였다 — for..in 이 그걸 종목으로 읽는다★");
  chk(/const __PEER_MEMO = new WeakMap\(\);/.test(S),
    "캐시는 WeakMap 이다 — dailyCache 가 사라지면 같이 사라진다(사이클 간 누수 없음)",
    "★캐시가 전역 Map 이다 — 사이클마다 쌓여 메모리를 먹는다★");
}

console.log("\n④ 길이가 다른 계열은 종전 경로로 폴백하는가");
{
  const cache = mkCache(40, 0, 320, 99);
  // 절반은 짧게 잘라 로그수익 길이를 다르게 만든다 — 빠른 경로가 못 쓰는 조건
  const keys = Object.keys(cache);
  for (let i = 0; i < keys.length; i += 2) cache[keys[i]] = { closes: cache[keys[i]].closes.slice(-40) };
  let diffs = 0, both = 0;
  for (const sy of keys.slice(0, 20)) {
    const a = oldPeerFeat(sy, "us", cache);
    const b = await M.flowPeerFeat(null, sy, "us", cache);
    if (a == null && b == null) continue;
    if (a == null || b == null) { diffs++; continue; }
    both++;
    for (const k of Object.keys(a)) if (!Object.is(a[k], b[k])) { diffs++; break; }
  }
  console.log(`       길이 혼합 유니버스 — 피어 성립 ${both}개`);
  chk(diffs === 0, "길이가 섞여도 값이 같다(폴백이 살아 있다)", `★길이 혼합에서 ${diffs}건 달라졌다★`);
  chk(/if \(c == null\) c = _corr\(mine, _pe \? _pe\.v : _logret\(d\.closes, 60\)\);/.test(S),
    "빠른 경로가 못 쓰면 종전 _corr 로 내려간다(코드에 폴백이 남아 있다)",
    "폴백이 사라졌다 — 길이가 다른 계열에서 조용히 0 이 된다");
}

console.log("\n⑤ 변이 시험 — 캐시가 틀린 값을 주면 ①이 실패하는가");
{
  const cache = mkCache(60, 0, 320, 2024);
  const sy = "US0";
  const good = await M.flowPeerFeat(null, sy, "us", cache);
  // 같은 dailyCache 를 조금 바꿔 다른 객체로 만든다 — 캐시가 살아 있으면 옛 값을 준다
  const cache2 = Object.assign({}, cache);
  cache2["US1"] = { closes: cache["US1"].closes.map((v) => v * 1.5) };
  const b2 = await M.flowPeerFeat(null, sy, "us", cache2);
  const a2 = oldPeerFeat(sy, "us", cache2);
  chk(good != null && a2 != null && b2 != null, "세 계산 모두 값을 냈다", "값이 안 나와 변이 시험이 성립하지 않는다");
  let same = true;
  if (a2 && b2) for (const k of Object.keys(a2)) if (!Object.is(a2[k], b2[k])) { same = false; break; }
  chk(same, "★다른 dailyCache 면 캐시가 새로 만들어진다★ — 옛 값을 재사용하지 않는다",
    "★캐시가 옛 dailyCache 의 값을 재사용한다 — 조용히 틀린 피어가 나온다★");
}

console.log("\n⑥ ★진짜 큰 몫★ — 종목마다 D1 을 왕복하지 않는가");
{
  /* 실측 flow 6,737ms 인데 그 사이클에 네트워크를 탄 종목은 6개뿐이었다.
     남는 설명은 하나 — flowBuildFeat 이 종목마다 getState 를 두 번 부른다(왕복 248회).
     daily: 는 이미 질의 한 번으로 1,000행을 읽고 있었다. 같은 방법을 여기에도 쓴다. */
  chk(/SELECT k, v FROM state WHERE \(k >= 'flowpos:' AND k < 'flowpos;'\)/.test(S),
    "포지셔닝·풋콜 캐시를 ★사이클당 질의 1회★ 로 통째 읽는다",
    "★여전히 종목마다 읽는다 — 평가 124종목이면 D1 왕복 248회다★");
  chk(/const _pre = \(opts && opts\.pre\) \|\| null;/.test(S) &&
      (S.match(/hasOwnProperty\.call\(_pre, key\)/g) || []).length === 2,
    "두 조회기(포지셔닝·풋콜)가 모두 프리로드 표를 먼저 본다",
    "한쪽만 고쳤다 — 나머지 하나가 그대로 왕복한다");
  chk(/hasOwnProperty\.call\(_pre, key\) \? _pre\[key\] : null/.test(S),
    "표에 ★없다는 사실★ 도 결과로 쓴다 — 없는 키를 D1 에 다시 묻지 않는다",
    "캐시 미스를 D1 에 다시 묻는다 — 왕복의 절반이 그대로 남는다");
  chk((S.match(/if \(_pre\) _pre\[key\] = \{ v: v, ts: Date\.now\(\) \};/g) || []).length === 2,
    "네트워크 갱신이 일어나면 표도 같이 갱신한다(같은 사이클 안에서 어긋나지 않는다)",
    "갱신이 표에 반영되지 않는다 — 같은 사이클에서 옛 값을 본다");
  chk(/\{ noFetch: _flowNoFetch, pre: __flowSideCache \}/.test(S),
    "평가 루프가 그 표를 실제로 넘긴다(만들어 놓고 안 쓰면 아무 의미가 없다)",
    "★표를 만들어 놓고 안 넘긴다 — 이 저장소가 이미 겪은 사고다(V33.227 '읽어 놓고 안 썼다')★");
}

console.log(fails === 0 ? "\n✓ FLOW 평가비용 검사 통과 — 같은 답, 더 싸게"
                        : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
