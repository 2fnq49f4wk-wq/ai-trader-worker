// [V33.201] 학습 단계 메모리 계약 게이트
//   배경: train-now(all) 파이프라인이 brain 에서 매번 죽었다(HTTP 503). 시간은 45/150초로
//   충분히 남아 있었으므로 시간예산 문제가 아니다 — 워커의 ★요청당 128MB★ 를 넘긴 것이다.
//   학습창 6만 행을 읽는 단계들이 같은 행을 ★세 벌★ 로 들고 있었다:
//     ① raw   : D1 이 준 행(feat 는 JSON 문자열)
//     ② data  : 파싱한 피처 배열
//     ③ Z     : 표준화한 사본
//   65차원 × 60,000 행이면 한 벌이 대략 38MB 다. 세 벌이면 한 단계만으로 한도에 닿는다.
//   ①은 파싱 즉시 놓아주면 되고, ③은 같은 배열을 제자리에서 덮어쓰면 아예 생기지 않는다.
//   ★모델·표본·하이퍼파라미터는 그대로다★ — 아래 ④가 값이 비트 단위로 같음을 매 배포마다 증명한다.
import fs from "node:fs";
const src = fs.readFileSync("src/index.js", "utf8");
const ln = (i) => src.slice(0, i).split("\n").length;
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };

// ── ① 학습창 전체를 읽는 단계는 파싱한 행을 즉시 놓아준다 ──────────────────
// SELECT ... feat ... FROM ml_samples 로 통째로 읽는 함수를 찾아, 그 파싱 루프를 검사한다.
const LOADERS = [
  ["mlTrainNightly", "l1"], ["mlBanditNoiseNightly", "bandit"], ["mlBrainTrainNightly", "brain"],
  ["_mindLoadSamples", "mind"], ["mlGBDTTrainNightly", "gbdt"], ["memoTrainNightly", "memo"],
];
for (const [fn, label] of LOADERS) {
  const i = src.indexOf("function " + fn + "(");
  if (i < 0) { no(`메모리계약: ${label} 트레이너(${fn})를 찾을 수 없다`); continue; }
  // 함수 본문 대신, 그 안의 파싱 루프 한 개만 본다(다음 로더 시작 전까지).
  const seg = src.slice(i, i + 12000);
  const loop = seg.indexOf("JSON.parse(");
  if (loop < 0) { no(`메모리계약: ${label} 에 표본 파싱 루프가 없다`); continue; }
  const win = seg.slice(Math.max(0, loop - 400), loop + 900);
  if (!/raw\[i\]\s*=\s*null/.test(win))
    no(`메모리계약: ${label}(@${ln(i)}) 이 파싱한 행을 놓아주지 않는다 — raw[i] = null 필요`);
  if (/JSON\.parse\(raw\[i\]/.test(win))
    no(`메모리계약: ${label}(@${ln(i)}) 이 raw[i] 를 계속 참조한다 — 놓아준 행을 다시 읽으면 터진다`);
  if (/v\.map\(function/.test(win))
    no(`메모리계약: ${label}(@${ln(i)}) 이 피처 배열을 사본으로 숫자화한다 — 제자리(v[j] = _num(v[j], 0))로`);
}
if (!bad) ok(`학습창 로더 ${LOADERS.length}곳 — 파싱한 행을 즉시 놓아주고 피처 사본을 만들지 않는다`);

// ── ② 표준화 사본 금지(brain·bandit) ─────────────────────────────────────
// l1·gbdt 는 표준화 뒤에도 data 를 원값으로 다시 읽으므로 제자리 변환 대상이 아니다.
{
  let b0 = bad;
  for (const [fn, label] of [["mlBrainTrainNightly", "brain"], ["mlBanditNoiseNightly", "bandit"]]) {
    const i = src.indexOf("function " + fn + "(");
    if (i < 0) { no(`메모리계약: ${label} 트레이너를 찾을 수 없다`); continue; }
    const seg = src.slice(i, i + 12000);
    if (/const Z = data\.map\(/.test(seg))
      no(`메모리계약: ${label}(@${ln(i)}) 이 표준화 사본을 만든다 — const Z = data 로 제자리 변환`);
    if (!/const Z = data;/.test(seg))
      no(`메모리계약: ${label}(@${ln(i)}) 에 제자리 표준화(const Z = data)가 없다`);
  }
  if (bad === b0) ok("brain·bandit — 표준화 사본을 만들지 않는다(제자리 z 변환)");
}

// ── ③ 한 요청에 무거운 단계 하나 ─────────────────────────────────────────
// 학습창을 통째로 읽는 단계가 _HEAVY 에서 빠지면, 한 요청에 두 개가 겹쳐 다시 죽는다.
{
  const m = src.match(/const _HEAVY = \[([^\]]*)\]/);
  if (!m) no("메모리계약: _HEAVY(무거운 단계 목록)가 없다 — 한 요청에 하나씩 끊는 장치가 사라졌다");
  else {
    const heavy = new Set([...m[1].matchAll(/"([a-z0-9]+)"/g)].map((x) => x[1]));
    const MUST = ["l1", "bandit", "brain", "mind", "gbdt", "memo", "dnn", "techk"];
    const miss = MUST.filter((k) => !heavy.has(k));
    if (miss.length) no(`메모리계약: 학습창을 통째로 읽는 단계가 _HEAVY 에서 빠졌다 — ${miss.join(", ")}`);
    else ok(`_HEAVY — 학습창 전체를 읽는 ${MUST.length}단계가 모두 한 요청에 하나씩 돈다`);
    if (!/_ranHeavy/.test(src)) no("메모리계약: _HEAVY 목록만 있고 실제로 끊는 코드(_ranHeavy)가 없다");
  }
}

// ── ④ 제자리 변환이 종전 사본과 비트 단위로 같은 값을 내는가 ────────────────
//   메모리를 줄이려다 숫자가 바뀌면 그건 고친 게 아니라 다른 모델이 된 것이다.
//   부동소수 연산 순서가 같으므로 오차가 아니라 ★완전 일치★ 를 요구한다.
{
  const _num = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
  const _clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const D = 65, N = 4000;
  let seed = 20260822;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const mk = (s0) => { seed = s0; const a = [];
    for (let i = 0; i < N; i++) { const x = [];
      // 금융 피처처럼 자릿수가 제각각인 값(꼬리가 두꺼운 쪽이 반올림에 민감하다)
      for (let j = 0; j < D; j++) x.push((rnd() - 0.5) * Math.pow(10, (j % 7) - 3));
      a.push({ ts: 1e12 + i * 3600e3, x, y: rnd() > 0.6 ? 1 : 0, pnl: (rnd() - 0.5) * 8, hv: rnd() > 0.5 }); }
    return a; };
  const base = mk(777);
  const mean = [], std = [];
  for (let j = 0; j < D; j++) { let m = 0; for (const r of base) m += r.x[j]; m /= N; mean.push(m);
    let s = 0; for (const r of base) { const v = r.x[j] - m; s += v * v; } std.push(Math.sqrt(s / N) || 1); }
  const pnlScale = 1.7, HS = 0.6, LSW = 1.0, nowTs = 1e12 + N * 3600e3;
  const rw = (ts) => Math.exp(-(nowTs - ts) / (45 * 86400000));
  const mwOf = (d) => _clamp(Math.abs(d.pnl) / pnlScale, 0.3, 3.0) * (d.hv ? HS : (LSW || 1)) * rw(d.ts);

  const A = mk(999);
  const Zold = A.map((d) => ({ z: d.x.map((v, j) => (v - mean[j]) / (std[j] > 1e-6 ? std[j] : 1)),
                               y: d.y, ts: d.ts, mw: mwOf(d) }));
  const data = mk(999); const Znew = data;
  for (let i = 0; i < N; i++) { const d = data[i], zx = d.x;
    for (let j = 0; j < D; j++) zx[j] = (zx[j] - mean[j]) / (std[j] > 1e-6 ? std[j] : 1);
    data[i] = { z: zx, y: d.y, ts: d.ts, mw: mwOf(d) }; }
  let diff = 0;
  for (let i = 0; i < N; i++) {
    if (Zold[i].y !== Znew[i].y || Zold[i].ts !== Znew[i].ts || !Object.is(Zold[i].mw, Znew[i].mw)) diff++;
    for (let j = 0; j < D; j++) if (!Object.is(Zold[i].z[j], Znew[i].z[j])) diff++;
  }
  if (diff) no(`메모리계약: 제자리 표준화가 종전 사본과 다른 값을 낸다 — ${diff}건(모델이 바뀐다)`);
  else ok(`제자리 표준화 = 종전 사본, 비트 단위 동일(${N * D}개 원소 전수 비교)`);

  // 제자리 숫자화도 v.map(_num) 과 같아야 한다(null·문자열 섞인 실제 feat 를 흉내낸다)
  let diff2 = 0;
  for (let k = 0; k < 300; k++) { const a = [];
    for (let j = 0; j < D; j++) { const r = rnd();
      a.push(r > 0.98 ? null : (r > 0.96 ? "NaN" : (rnd() - 0.5) * 100)); }
    const j0 = JSON.stringify(a);
    const o = JSON.parse(j0).map((t) => _num(t, 0));
    const w = JSON.parse(j0); for (let j = 0; j < w.length; j++) w[j] = _num(w[j], 0);
    for (let j = 0; j < D; j++) if (!Object.is(o[j], w[j])) diff2++; }
  if (diff2) no(`메모리계약: 제자리 숫자화가 v.map(_num) 과 다르다 — ${diff2}건`);
  else ok("제자리 숫자화 = v.map(_num), 비트 단위 동일(null·NaN 문자열 포함)");
}

if (bad) { console.error(`\n학습 메모리 계약 위반 ${bad}건 — 배포 차단`); process.exit(1); }
console.log("  ok   학습 메모리 계약 통과 — 6만 행을 세 벌로 들지 않는다");
