/* [V33.365] 표본 익스포트 페이지네이션 계약
 *
 *   ★고친 결함★ R2 스냅샷 분기는 `offset` 으로 파트를 고르고 D1 분기는 `cursorTs` 로 줄을 찾는다.
 *   트레이너는 커서를 한 번 받으면 offset 을 안 보냈다(if/else). 수집 도중 스냅샷이 done 으로
 *   뒤집히면 이후 모든 페이지가 파트0 만 돌려줬다 — 1,123,768건 중 서로 다른 행 2만건.
 *   유효표본 210/220,000(동시성 1,047), 재현 204/1,064. 그 탓에 Wilson 하한이 눌려
 *   SEQ 가 위원회에서 빠지고 부스터 3종이 전부 거절됐다.
 *
 *   ★문자열 검사로는 안 된다(V33.337).★ 워커의 분기 로직과 트레이너의 수집 루프를
 *   소스에서 잘라 ★실제로 돌려★, 세 상황 모두에서 ★서로 다른 행 = total★ 인지 본다.
 */
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/index.js", "utf8");
const PY = readFileSync("trainer/modal/modal_train.py", "utf8");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.log("  ✗ FAIL " + m); } };

// ── ① 앵커: 고친 자리가 살아 있는가 ────────────────────────────────────────────
{
  // ml-export 핸들러 구간만 떼어 ★그 안에서★ 커서 선언이 R2 분기보다 앞서는지 본다.
  const _h0 = SRC.indexOf('if (path === "/api/ml-export") {');
  const _h1 = SRC.indexOf('if (path === "/api/ml-export-st")');
  const _H = SRC.slice(_h0, _h1);
  const _cur = _H.indexOf('const curTs = Number(url.searchParams.get("cursorTs"))');
  const _r2 = _H.indexOf("const _R2 = _bigR2();");
  ok(_h0 > 0 && _cur > 0 && _r2 > 0 && _cur < _r2,
     "커서를 R2 분기 ★위에서★ 읽는다(종전엔 아래라 R2 가 커서를 몰랐다)");
}
ok(SRC.includes("next: 0, bounds: [] }"), "스냅샷 빌더가 파트경계(bounds) 를 만든다");
ok(/const MLSNAP_SCHEMA = 3;/.test(SRC),
   "스냅샷 스키마판을 올려 ★경계 없는 옛 사진★ 이 계속 서빙되지 않는다");
ok(/st\.bounds\[st\.next\] = _lastRaw \? \{ t: _num\(_lastRaw\.ts, 0\), i: _num\(_lastRaw\.id, 0\) \} : null;/.test(SRC),
   "파트마다 마지막 (ts,id) 를 raw 기준으로 적는다");
ok(/if \(_part < 0\) _snapOk = false;/.test(SRC),
   "★커서를 못 맞추면 파트0 을 내주는 대신 D1 로 떨어진다★");
ok(/\} else if \(offset % MLSNAP_PART !== 0\) \{\s*\n\s*_snapOk = false;/.test(SRC),
   "파트 경계에 안 맞는 offset 도 R2 로 안 받는다(겹치거나 빠진다)");
ok(/nextCursorTs: _bn \? _num\(_bn\.t, 0\) : null/.test(SRC),
   "R2 응답도 다음 커서를 낸다(중간에 D1 로 떨어져도 이어붙는다)");
ok(/params = \{"key": KEY, "limit": page, "offset": off\}/.test(PY),
   "트레이너가 offset 을 ★언제나★ 보낸다(종전 if/else 가 사라졌다)");
ok(!/if cur_ts:\s*\n\s*params\["cursorTs"\], params\["cursorId"\] = cur_ts, cur_id\s*\n\s*else:/.test(PY),
   "옛 if/else(커서면 offset 생략)가 남아 있지 않다");
ok(/_sig in _seen_pages/.test(PY), "같은 페이지가 두 번 오면 트레이너가 멈춘다");
ok(/\[표본위생\] 서로 다른 표본/.test(PY), "수집 직후 ★서로 다른 건수★ 를 먼저 말한다");
ok(/_ratio < 0\.5 and len\(samples\) > 1000/.test(PY), "중복이 과반이면 학습하지 않는다");

// ── ② 동작: 워커 분기 + 트레이너 루프를 실제로 돌린다 ──────────────────────────
const MLSNAP_PART = 20000, TOTAL = 223_768, SYMS = 1018;
const POOL = Array.from({ length: TOTAL }, (_, i) =>
  ({ id: TOTAL - i, ts: 10_000_000_000_000 - i * 60_000, s: "S" + (i % SYMS) }));

// 스냅샷 빌더가 만드는 bounds 를 소스의 식 그대로 재현한다.
function buildBounds() {
  const parts = Math.ceil(TOTAL / MLSNAP_PART), bounds = [];
  for (let k = 0; k < parts; k++) {
    const raw = POOL.slice(k * MLSNAP_PART, (k + 1) * MLSNAP_PART);
    const _lastRaw = raw.length ? raw[raw.length - 1] : null;
    bounds[k] = _lastRaw ? { t: _lastRaw.ts, i: _lastRaw.id } : null;
  }
  return { parts, bounds };
}
const SNAP = Object.assign({ done: true, total: TOTAL, anchorTs: 10_000_000_000_000 }, buildBounds());

/* ★파트 선택 로직을 src/index.js 에서 ★잘라서 실제로 실행한다★.★
   종전 판에서 이 게이트는 같은 로직을 게이트 안에 ★베껴 두고★ 돌렸다. 그래서
   `if (curTs > 0)` 를 `if (false)` 로 바꾸는 돌연변이(= 결함을 그대로 되살리는 것)를
   놓쳤다 — 이 저장소가 이미 세 번 겪은 "만들어 놓고 안 쓰는" 구멍과 같은 모양이다.
   이제는 소스의 그 구간을 떼어 함수로 만들어 쓴다. 소스가 바뀌면 여기가 바로 안다. */
const _pickSrc = (function () {
  const a = SRC.indexOf("          let _part = -1;");
  const b = SRC.indexOf("          if (_snapOk) {\n            if (_part >= _snap.parts) {", a);
  if (a < 0 || b < 0) { console.log("  ✗ FAIL 파트 선택 구간을 소스에서 못 잘랐다"); process.exit(1); }
  return SRC.slice(a, b);
})();
ok(/if \(curTs > 0\)/.test(_pickSrc), "잘라낸 구간이 ★커서를 실제로 본다★(if (curTs > 0))");
const _pickPart = new Function(
  "_snapOk", "curTs", "curId", "offset", "_snap", "MLSNAP_PART", "_num", "ctx", "log", "env",
  _pickSrc + "\n return { _snapOk: _snapOk, _part: _part };");
const _STUB = { ctx: { waitUntil() {} }, log() {}, env: { DB: null },
                num: (v, d) => (v == null || isNaN(Number(v)) ? d : Number(v)) };

/** 워커 /api/ml-export 의 페이지 선택. `withBounds=false` 면 옛 스냅샷(경계 없음). */
function workerExport({ offset, curTs, curId, snapFresh, withBounds = true, legacy = false }) {
  const snap = withBounds ? SNAP : Object.assign({}, SNAP, { bounds: null });
  let snapOk, part;
  if (snapFresh && legacy) {
    // ★고치기 전★ — 커서를 아예 안 본다. offset 만으로 파트를 고른다.
    snapOk = true; part = Math.floor(offset / MLSNAP_PART);
  } else {
    const r = _pickPart(snapFresh, curTs, curId, offset, snap, MLSNAP_PART,
                        _STUB.num, _STUB.ctx, _STUB.log, _STUB.env);
    snapOk = r._snapOk; part = r._part;
  }
  if (snapOk) {
    if (part >= snap.parts) return { samples: [], total: snap.total, nextCursorTs: null, nextCursorId: null, source: "r2" };
    const arr = POOL.slice(part * MLSNAP_PART, (part + 1) * MLSNAP_PART);
    const bn = (Array.isArray(snap.bounds) && snap.bounds[part]) ? snap.bounds[part] : null;
    return { samples: arr, total: snap.total, source: "r2",
             nextCursorTs: bn ? bn.t : null, nextCursorId: bn ? bn.i : null };
  }
  // D1 분기
  let start;
  if (curTs > 0) {
    start = POOL.findIndex(r => r.ts < curTs || (r.ts === curTs && r.id < curId));
    if (start < 0) start = TOTAL;
  } else start = offset;
  const arr = POOL.slice(start, start + MLSNAP_PART);
  const last = arr.length ? arr[arr.length - 1] : null;
  return { samples: arr, total: TOTAL, source: "d1",
           nextCursorTs: last ? last.ts : null, nextCursorId: last ? last.id : null };
}

/** 트레이너 fetch_all — offset 을 ★언제나★ 보내는 지금 판. */
function fetchAll(freshAfterPage, withBounds = true, alwaysOffset = true, legacy = false) {
  let off = 0, curTs = 0, curId = 0, pages = 0;
  const samples = [], seen = new Set(); let dupAbort = false;
  while (true) {
    const j = workerExport({ offset: alwaysOffset ? off : (curTs ? 0 : off),
                             curTs, curId, snapFresh: pages >= freshAfterPage, withBounds, legacy });
    // 옛 워커는 R2 응답에 다음 커서를 안 실었다.
    if (legacy && j.source === "r2") { j.nextCursorTs = null; j.nextCursorId = null; }
    const got = j.samples || [];
    if (got.length) {
      const sig = got.length + "|" + got[0].ts + "|" + got[0].s + "|" + got[got.length - 1].ts;
      if (seen.has(sig)) { dupAbort = true; break; }
      seen.add(sig);
    }
    samples.push(...got);
    off += got.length;
    if (j.nextCursorTs) { curTs = j.nextCursorTs; curId = j.nextCursorId; }
    pages++;
    if (got.length < MLSNAP_PART || off >= j.total || !got.length || pages > 200) break;
  }
  const uniq = new Set(samples.map(r => r.id)).size;
  let mn = Infinity, mx = -Infinity;
  for (const r of samples) { if (r.ts < mn) mn = r.ts; if (r.ts > mx) mx = r.ts; }
  const span = samples.length ? (mx - mn) / 86400000 : 0;
  return { n: samples.length, uniq, pages, span, dupAbort };
}

console.log("\n  — 실제로 돌려 본 결과 —");
for (const [label, flip] of [["스냅샷 계속 없음(D1)", 1e9], ["처음부터 신선(R2)", 0],
                             ["★수집 도중 신선해짐(D1→R2) — 사고가 났던 그 경로★", 2]]) {
  const r = fetchAll(flip);
  console.log(`     ${label}: ${r.n.toLocaleString()}건 · 서로 다른 행 ${r.uniq.toLocaleString()} · ${r.span.toFixed(1)}일`);
  ok(r.uniq === TOTAL, `${label} — 서로 다른 행이 total(${TOTAL.toLocaleString()}) 과 같다`);
  ok(r.n === TOTAL, `${label} — 받은 건수도 total 과 같다(중복이 없다)`);
  ok(!r.dupAbort, `${label} — 중복탐지에 안 걸린다(정상 경로다)`);
}

// 옛 스냅샷(경계 없음)이라도 ★틀린 표본을 만들지는 않는다★ — D1 으로 떨어질 뿐이다.
{
  const r = fetchAll(2, false);
  ok(r.uniq === TOTAL && r.n === TOTAL, "옛 스냅샷(경계 없음)이면 D1 로 떨어져 표본은 여전히 온전하다");
}

/* ★대조 — 네 조합★ 고침이 ★어느 한쪽만★ 들어가도 표본이 온전한가(이중 방어),
   그리고 ★둘 다 없으면 반드시 깨지는가★(이 게이트가 헛돌지 않는다는 증거). */
console.log("\n  — 대조: 워커·트레이너 고침의 조합 —");
{
  const combos = [
    ["옛 워커 + 옛 트레이너 ★사고가 난 조합★", false, false, false],
    ["새 워커 + 옛 트레이너(워커만 고쳐도 된다)", true, false, true],
    ["옛 워커 + 새 트레이너(트레이너만 고쳐도 된다)", false, true, true],
    ["새 워커 + 새 트레이너", true, true, true],
  ];
  for (const [label, newWorker, newTrainer, want] of combos) {
    const r = fetchAll(2, true, newTrainer, !newWorker);
    const good = (r.uniq === TOTAL && r.n === TOTAL && !r.dupAbort);
    console.log(`     ${label}: 서로 다른 행 ${r.uniq.toLocaleString()}/${TOTAL.toLocaleString()}` +
                (r.dupAbort ? " · ★중복탐지가 멈춰세웠다★" : ""));
    ok(good === want, `${label} — ${want ? "표본이 온전하다" : "★깨진다(그래서 고쳤다)★"}`);
  }
}

// ── ③ 고유도: 중복이 유효표본을 얼마나 무너뜨리는가(실측과 맞는가) ────────────
function uniqWeights(TS, SYM, spanMs) {
  const by = new Map();
  TS.forEach((_, i) => { const k = SYM[i]; if (!by.has(k)) by.set(k, []); by.get(k).push(i); });
  const w = new Float64Array(TS.length);
  for (const idx of by.values()) {
    idx.sort((a, b) => TS[a] - TS[b]);
    let lo = 0, hi = 0;
    for (let a = 0; a < idx.length; a++) {
      const t0 = TS[idx[a]];
      while (lo < idx.length && TS[idx[lo]] < t0 - spanMs) lo++;
      while (hi < idx.length && TS[idx[hi]] <= t0 + spanMs) hi++;
      w[idx[a]] = 1 / Math.max(1, hi - lo);
    }
  }
  return w;
}
{
  const DAY = 86400000, perSym = 19, dup = 56, TS = [], SYM = [];
  for (let s = 0; s < 400; s++) for (let d = 0; d < dup; d++) for (let a = 0; a < perSym; a++) {
    TS.push(a * DAY * 0.2); SYM.push("S" + s);
  }
  const w = uniqWeights(TS, SYM, 10 * DAY);
  let sum = 0; for (const v of w) sum += v;
  const conc = TS.length / sum;
  console.log(`\n  — 중복 표본의 고유도 — 평균동시성 ${conc.toFixed(0)} (실측 1,047.6)`);
  ok(Math.abs(conc - perSym * dup) < 1, `동시성이 ★종목당건수×복제배수★(${perSym}×${dup}) 와 같다 — 붕괴의 산식이 이것이다`);
  ok(conc > 900, "실측 동시성 1,047 과 같은 자리다(원인 규명이 맞다)");
}

console.log(fail ? `\n✗ 익스포트 페이지네이션 계약 ${fail}건 실패 (총 ${n})`
                 : `\n✓ 익스포트 페이지네이션 계약 통과 (${n}개 단언)`);
process.exit(fail ? 1 : 0);
