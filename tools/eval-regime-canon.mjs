#!/usr/bin/env node
/* [V33.797 국면] 정식 국면 평가 — 10년 일봉으로 '앞으로의 국면' 정답표를 만들고 원천별·정식 국면(종전 min vs 새 가중 투표)을 잰다.
   사용: node tools/eval-regime-canon.mjs <yahoo-chart-json 폴더> [--tune]
     폴더에 SPY QQQ SOXX GSPC IXIC DJI RUT KS11 KQ11 069500.KS VIX VIX9D HYG TLT UUP BTC-USD .json (Yahoo v8 chart range=10y)
   정답(앞으로 국면, 시장별 배율 k = US 1 · KR 1.25): 진실 지수(美 SPY·QQQ·SOXX / 韓 KOSPI·KOSDAQ·069500 등가중)에서
     CRASH = 20일 최대낙폭 ≤ −7k% 또는 5일 ≤ −4k% · BEAR = 20일 ≤ −2.5k% 또는 20일 낙폭 ≤ −4.5k% ·
     SURGE = 20일 ≥ +5k% 이고 낙폭 > −2.5k% · BULL = 20일 ≥ +1.5k% · 그 밖 NEUTRAL.
   거짓 폭락 = 정식 CRASH 인데 다음 20일 낙폭 > −3k% 이고 20일 수익 > 0.
   지연 = 고점 대비 −10k% 이상 하락 구간: 고점 → 처음 CRASH/BEAR 까지 거래일 · 바닥 → 처음 NEUTRAL 이상까지.
   인버스 손익 = 정식 CRASH 면 다음 날 −2x, BEAR 면 −1x (인버스 차선 대리).
   학습기 pb_regime 은 지수 등가중 _regime(폭락·폭등 3일 끈적임) · 하루 늦게(전날 종가) · ts 나이 = 달력 일수.
   거시 ctx 는 _computeRiskScore 를 일봉 등락으로 재현(위기 게이지 제외) · 韓 은 전날 美 값. 시장폭은 과거 자료가 없어 평가에서 빠진다. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js"), "utf8");
function grab(name) {
  const i = SRC.search(new RegExp("^(const|function) " + name + "\\b", "m")); if (i < 0) throw new Error("없음 " + name);
  let j = SRC.indexOf("{", i), d = 0;
  for (; j < SRC.length; j++) { if (SRC[j] === "{") d++; else if (SRC[j] === "}") { d--; if (!d) break; } }
  return SRC.slice(i, j + 1) + (SRC[i] === "c" ? ";" : "");
}
const lib = new Function(["function _num(v,d){v=Number(v);return isFinite(v)?v:d;}",
  grab("REGIME_CANON_RANK"), grab("REGIME_CANON_KO"), grab("REGIME_CANON_CFG"), grab("regimeFeat"), grab("regimeCanon"),
  "return {regimeFeat, regimeCanon, CFG: REGIME_CANON_CFG, RANK: REGIME_CANON_RANK};"].join("\n"))();

/* 자체 시험(데이터 없이) — 11/9 사고 재현: 美 위상 MELTUP · 학습기 CRASH(3일 묵음) → CRASH 가 아니어야 · 진짜 폭락은 CRASH */
{ const now = Date.now(), A = (c, m) => { if (!c) { console.log("FAIL " + m); process.exit(1); } };
  const x1 = lib.regimeCanon("MELTUP", { regime: "CRASH", ts: now - 3 * 864e5 }, { regime: "neutral", ts: now }, { day: 1.8, r5: 3, vs50: 1, s50: .2, dd60: -3, rv20: 22 }, { market: "us", prev: "CRASH" });
  A(x1.canon !== "CRASH" && x1.canon !== "BEAR", "11/9 묵은 학습기 폭락이 폭등장을 폭락으로 " + x1.canon);
  const x2 = lib.regimeCanon("CRASH", { regime: "BEAR", ts: now - 432e5 }, { regime: "risk_off", ts: now }, { day: -3.4, r5: -6, vs50: -5, s50: -.5, dd60: -9, rv20: 35 }, { market: "us" });
  A(x2.canon === "CRASH", "진짜 폭락을 놓침 " + x2.canon);
  const x3 = lib.regimeCanon("CRASH", null, null, { day: -2.2, r5: -1, vs50: 2, s50: .3, dd60: -2.5, rv20: 15 }, { market: "kr" });
  A(x3.canon === "BEAR", "하루 급락은 최소 하락 " + x3.canon);
  const x4 = lib.regimeCanon("RANGE", null, null, null, { market: "kr" });
  A(x4.canon === "NEUTRAL" && Array.isArray(x4.comps) && x4.conf >= 0, "원천 하나 " + JSON.stringify(x4));
  console.log("자체 시험 통과 · 11/9 → " + x1.canon + " (점수 " + x1.score + " · 신뢰 " + x1.conf + ") · 폭락 → " + x2.canon + " · 하루 급락 → " + x3.canon); }
const DIR = process.argv[2];
if (!DIR || !fs.existsSync(DIR)) { console.log("데이터 폴더 없음 — 건너뜀(사용법은 머리 주석)"); process.exit(0); }
function load(sym) {
  const r = JSON.parse(fs.readFileSync(path.join(DIR, sym + ".json"), "utf8")).chart.result[0];
  const m = new Map(), c = r.indicators.adjclose ? r.indicators.adjclose[0].adjclose : r.indicators.quote[0].close;
  r.timestamp.forEach(function (t, i) { if (c[i] > 0) m.set(new Date((t + 9 * 3600) * 1000).toISOString().slice(0, 10), c[i]); });
  return m;
}
const S = {}; for (const s of ["SPY","QQQ","SOXX","GSPC","IXIC","DJI","RUT","KS11","KQ11","069500.KS","VIX","VIX9D","HYG","TLT","UUP","BTC-USD"]) S[s] = load(s);
const MK = { us: { idx: ["IXIC","DJI","GSPC","RUT"], truth: ["SPY","QQQ","SOXX"], k: 1 }, kr: { idx: ["KS11","KQ11"], truth: ["KS11","KQ11","069500.KS"], k: 1.25 } };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* 거시 riskScore(일봉) — _computeRiskScore 와 같은 가중 */
const usDates = [...S.GSPC.keys()].sort();
const pct = (m, d, p) => (m.get(d) && m.get(p)) ? (m.get(d) / m.get(p) - 1) * 100 : 0;
const ctxByDate = {};
for (let i = 1; i < usDates.length; i++) { const d = usDates[i], p = usDates[i - 1];
  let s = clamp(pct(S.HYG, d, p) * 0.5, -.4, .4) + clamp(pct(S["BTC-USD"], d, p) * .04, -.25, .25) - clamp(pct(S.UUP, d, p) * .2, -.2, .2) - clamp(pct(S.VIX9D, d, p) * .025, -.3, .3);
  const v9 = S.VIX9D.get(d), v30 = S.VIX.get(d); if (v9 && v30) s -= clamp((v9 / v30 - 1) * .8, -.05, .25);
  s -= clamp(pct(S.TLT, d, p) * .08, -.15, .15); s = clamp(s, -1, 1);
  ctxByDate[d] = s <= -.4 ? "risk_off" : s < -.15 ? "caution" : s >= .4 ? "risk_on" : s > .15 ? "mild_on" : "neutral"; }

function oldCanon(phase, pbv, pbAge, ctx) {   // V33.794 — 가장 방어적인 값
  const R = lib.RANK, PH = { CRASH: "CRASH", TREND_DOWN: "BEAR", RANGE: "NEUTRAL", TREND_UP: "BULL", MELTUP: "SURGE" }, CX = { risk_off: "BEAR", caution: "NEUTRAL" };
  const v = []; if (PH[phase]) v.push(PH[phase]); if (pbv && pbAge < 4) v.push(pbv); if (CX[ctx]) v.push(CX[ctx]);
  return v.length ? v.reduce((a, b) => R[b] < R[a] ? b : a) : "NEUTRAL";
}

function build(mk) {
  const M = MK[mk];
  const dates = [...S[M.idx[0]].keys()].filter(d => M.idx.every(s => S[s].has(d)) && M.truth.every(s => S[s].has(d))).sort();
  const n = dates.length, ser = M.idx.map(s => dates.map(d => S[s].get(d)));
  // 진실 지수(등가중 누적)
  const tr = [1]; for (let i = 1; i < n; i++) { let r = 0; for (const s of M.truth) r += S[s].get(dates[i]) / S[s].get(dates[i - 1]) - 1; tr.push(tr[i - 1] * (1 + r / M.truth.length)); }
  // 학습기 _regime 재현(지수 등가중)
  const ew = [1], er = [0]; for (let i = 1; i < n; i++) { let r = 0; for (const a of ser) r += a[i] / a[i - 1] - 1; r /= ser.length; er.push(r); ew.push(ew[i - 1] * (1 + r)); }
  const pbReg = []; const mean = (a, i, w) => { if (i + 1 < w) return null; let s = 0; for (let k = i - w + 1; k <= i; k++) s += a[k]; return s / w; };
  for (let i = 0; i < n; i++) {
    const m200 = mean(ew, i, 200), m50 = mean(ew, i, 50), m50p = i >= 10 ? mean(ew, i - 10, 50) : null;
    let reg = "NEUTRAL"; if (m200 && m50 && m50p) { const up = m50 > m50p; reg = ew[i] > m200 && up ? "BULL" : ew[i] < m200 && !up ? "BEAR" : "NEUTRAL"; }
    let cr = false, su = false; for (let k = Math.max(0, i - 2); k <= i; k++) { const r5 = k >= 5 ? ew[k] / ew[k - 5] - 1 : 0; if (er[k] <= -.025 || r5 <= -.06) cr = true; if (er[k] >= .025 || r5 >= .06) su = true; }
    pbReg.push(cr ? "CRASH" : su ? "SURGE" : reg);
  }
  const rows = [];
  for (let i = 60; i < n - 20; i++) {
    const d = dates[i], k = M.k;
    // 지수 위상(analyzeMarketRegime 과 같은 분기)
    let tot = 0, worst = 999, above = 0, below = 0; const r20s = [], ers = [], r5s = [];
    const hists = ser.map(a => a.slice(i - 59, i + 1));
    for (const h of hists) { const dp = (h[59] / h[58] - 1) * 100; tot += dp; worst = Math.min(worst, dp);
      const ma20 = h.slice(40).reduce((x, y) => x + y, 0) / 20; if (h[59] >= ma20) above++; else below++;
      r20s.push((h[59] / h[39] - 1) * 100); const seg = h.slice(-21); let p = 0; for (let j = 1; j < 21; j++) p += Math.abs(seg[j] - seg[j - 1]);
      ers.push(Math.abs(seg[20] - seg[0]) / p); r5s.push((seg[20] / seg[15] - 1) * 100); }
    const av = a => a.reduce((x, y) => x + y, 0) / a.length;
    const today = tot / hists.length, r5 = av(r5s), r20 = av(r20s), erv = av(ers);
    let phase; if (worst <= -2.5 || today <= -2 || (today <= -1 && r5 <= -4)) phase = "CRASH";
    else if (today >= 2 || (today >= 1 && r5 >= 3) || (erv >= .34 && r20 >= 6 && above >= below)) phase = "MELTUP";
    else if (today >= .8 || (r5 >= 2 && today >= 0) || (erv >= .22 && r20 >= 1.5 && above >= below)) phase = "TREND_UP";
    else if (today <= -.8 || (r5 <= -2 && today <= 0) || (erv >= .22 && r20 <= -1.5)) phase = "TREND_DOWN"; else phase = "RANGE";
    const pbv = pbReg[i - 1], pbAge = (Date.parse(d) - Date.parse(dates[i - 1])) / 864e5;
    let ctx; if (mk === "us") ctx = ctxByDate[d]; else { let j = usDates.findIndex(x => x >= d) - 1; ctx = ctxByDate[usDates[Math.max(0, j)]]; }
    const feat = Object.assign(lib.regimeFeat(hists), { day: today });
    // 정답
    const c0 = tr[i]; let mdd = 0; for (let j = i + 1; j <= i + 20; j++) mdd = Math.min(mdd, tr[j] / c0 - 1);
    const f5 = tr[i + 5] / c0 - 1, f20 = tr[i + 20] / c0 - 1;
    const truth = (mdd <= -.07 * k || f5 <= -.04 * k) ? "CRASH" : (f20 <= -.025 * k || mdd <= -.045 * k) ? "BEAR" : (f20 >= .05 * k && mdd > -.025 * k) ? "SURGE" : f20 >= .015 * k ? "BULL" : "NEUTRAL";
    const rc = tr[i + 10] / tr[i - 10] - 1;   // 지금 국면(가운데 창 ±10일 · 사후) — 탐지 정확도용
    const st = rc <= -.07 * k ? "CRASH" : rc <= -.025 * k ? "BEAR" : rc >= .05 * k ? "SURGE" : rc >= .015 * k ? "BULL" : "NEUTRAL";
    rows.push({ d, i, st, phase, pbv, pbAge, ctx, feat, truth, mdd, f20, nxt: tr[i + 1] / c0 - 1, tr: c0 });
  }
  return rows;
}

function runNew(rows, mk, cfg) {
  let prev = null; return rows.map(r => { const now = Date.parse(r.d) + 864e5 * 0.3;
    const o = lib.regimeCanon(r.phase, { regime: r.pbv, ts: now - r.pbAge * 864e5 }, r.ctx, r.feat, { market: mk, prev, now, cfg }); prev = o.canon; return o.canon; });
}
const PHC = { CRASH: "CRASH", TREND_DOWN: "BEAR", RANGE: "NEUTRAL", TREND_UP: "BULL", MELTUP: "SURGE" };
const CXC = { risk_off: "BEAR", caution: "NEUTRAL", neutral: "NEUTRAL", mild_on: "BULL", risk_on: "BULL" };
function metrics(rows, pred, mk) {
  const k = MK[mk].k, L = ["CRASH","BEAR","NEUTRAL","BULL","SURGE"], G = x => x === "CRASH" || x === "BEAR" ? -1 : x === "NEUTRAL" ? 0 : 1;
  let sHit = 0, sDir = 0, hit = 0, dir = 0, fc = 0, nc = 0, flips = 0, eq = 1, rets = []; const pc = {};
  for (const l of L) pc[l] = { tp: 0, p: 0, t: 0 };
  rows.forEach((r, i) => { const p = pred[i]; if (p === r.truth) hit++; if (p === r.st) sHit++; if (G(p) === G(r.st)) sDir++; if (G(p) === G(r.truth)) dir++;
    pc[p].p++; pc[r.truth].t++; if (p === r.truth) pc[p].tp++;
    if (p === "CRASH") { nc++; if (r.mdd > -.03 * k && r.f20 > 0) fc++; }
    if (i && p !== pred[i - 1]) flips++;
    const lev = p === "CRASH" ? -2 : p === "BEAR" ? -1 : 0; const x = lev * r.nxt; eq *= 1 + x; rets.push(x); });
  // 지연 — 고점 대비 −10k% 구간
  const lat = [], rec = []; let miss = 0;
  let pk = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].tr > rows[pk].tr) { pk = i; continue; }
    if (rows[i].tr / rows[pk].tr - 1 <= -.10 * k) {
      let tr;
      // 바닥 = 다음 신고점 전 최저점
      let nx = i; while (nx < rows.length && rows[nx].tr <= rows[pk].tr) nx++;
      tr = pk; for (let j = pk; j < nx; j++) if (rows[j].tr < rows[tr].tr) tr = j;
      let det = -1; for (let j = pk; j <= tr; j++) if (pred[j] === "CRASH" || pred[j] === "BEAR") { det = j - pk; break; }
      if (det < 0) miss++; else lat.push(det);
      let rc = -1; for (let j = tr; j < Math.min(nx, rows.length); j++) if (G(pred[j]) >= 0) { rc = j - tr; break; } if (rc >= 0) rec.push(rc);
      pk = nx; i = nx;
    }
  }
  const avg = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length, sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length);
  return { n: rows.length, stAcc: +(sHit / rows.length * 100).toFixed(1), stDir: +(sDir / rows.length * 100).toFixed(1), acc: +(hit / rows.length * 100).toFixed(1), dirAcc: +(dir / rows.length * 100).toFixed(1),
    crashP: pc.CRASH.p ? +(pc.CRASH.tp / pc.CRASH.p * 100).toFixed(1) : null, crashR: pc.CRASH.t ? +(pc.CRASH.tp / pc.CRASH.t * 100).toFixed(1) : null,
    bearP: pc.BEAR.p ? +(pc.BEAR.tp / pc.BEAR.p * 100).toFixed(1) : null, crashDays: nc, falseCrash: nc ? +(fc / nc * 100).toFixed(1) : 0,
    flipsYr: +(flips / rows.length * 252).toFixed(0), episodes: lat.length + miss, missed: miss, latency: avg(lat), recovery: avg(rec),
    invRet: +((eq - 1) * 100).toFixed(1), invSharpe: sd ? +(m / sd * Math.sqrt(252)).toFixed(2) : 0,
    perClass: Object.fromEntries(L.map(l => [l, pc[l].p ? +(pc[l].tp / pc[l].p * 100).toFixed(0) : null])) };
}

const SPLIT = "2022-01-01", out = {};
const obj = m => m.missed > 0 ? -1e9 : m.stDir + 0.5 * m.dirAcc + 0.15 * (m.crashP || 0) - 0.4 * m.falseCrash + 8 * m.invSharpe - 0.8 * (m.latency || 0) - 0.05 * m.flipsYr;
if (process.argv.includes("--tune")) {
  const pick = a => a[Math.floor(Math.random() * a.length)], best = {};
  for (const mk of ["us", "kr"]) { const rows = build(mk).filter(r => r.d < SPLIT); best[mk] = { o: -1e9 };
    for (let it = 0; it < +(process.env.ITERS || 1500); it++) {
      const c = JSON.parse(JSON.stringify(lib.CFG));
      for (const w in c.w[mk]) c.w[mk][w] = pick([0, .15, .3, .6, 1, 1.4]);
      c.thr[mk] = { crash: pick([-1.4, -1.2, -1, -.8, -.6]), bear: pick([-.55, -.4, -.3, -.2]), bull: pick([.2, .3, .4, .55]), surge: pick([.8, 1, 1.2, 1.4]) };
      c.hyst = pick([0, .1, .2, .3]); c.combine = pick(["score", "guard"]); c.pbHalfDays = pick([.5, 1, 2]);
      const o = obj(metrics(rows, runNew(rows, mk, c), mk)); if (o > best[mk].o) best[mk] = { o, c: { w: c.w[mk], thr: c.thr[mk], hyst: c.hyst, combine: c.combine, pbHalfDays: c.pbHalfDays } }; }
    { const c = JSON.parse(JSON.stringify(lib.CFG)); c.w[mk] = best[mk].c.w; c.thr[mk] = best[mk].c.thr; c.hyst = best[mk].c.hyst; c.combine = best[mk].c.combine; c.pbHalfDays = best[mk].c.pbHalfDays;
      const te = build(mk).filter(r => r.d >= SPLIT); console.log(mk, "test best", JSON.stringify(metrics(te, runNew(te, mk, c), mk)), "\n   test cur", JSON.stringify(metrics(te, runNew(te, mk), mk))); }
    console.log(mk, "base", obj(metrics(rows, runNew(rows, mk), mk)).toFixed(1), "best", best[mk].o.toFixed(1), JSON.stringify(best[mk].c)); }
  process.exit(0);
}
for (const mk of ["us", "kr"]) {
  const all = build(mk);
  for (const [nm, rows] of [["train", all.filter(r => r.d < SPLIT)], ["test", all.filter(r => r.d >= SPLIT)]]) {
    const o = {};
    o.phase = metrics(rows, rows.map(r => PHC[r.phase]), mk);
    o.pb = metrics(rows, rows.map(r => r.pbv), mk);
    o.ctx = metrics(rows, rows.map(r => CXC[r.ctx] || "NEUTRAL"), mk);
    o.oldCanon = metrics(rows, rows.map(r => oldCanon(r.phase, r.pbv, r.pbAge, r.ctx)), mk);
    o.newCanon = metrics(rows, runNew(rows, mk), mk);
    if (process.env.VAR) { const R = lib.RANK, N = ["CRASH","BEAR","NEUTRAL","BULL","SURGE"];
      const V = (fn) => metrics(rows, rows.map(fn), mk);
      const PHm = { CRASH: 0, TREND_DOWN: 1, RANGE: 2, TREND_UP: 3, MELTUP: 4 };
      // A: pb 가 지수 위상과 정반대(위상 상승↑)면 한 칸만 — pb CRASH → NEUTRAL
      o.A = V(r => { const p = PHm[r.phase]; let pb = r.pbAge < 4 ? R[r.pbv] : 4; if (p >= 3 && pb <= 1) pb = 2; const cx = r.ctx === "risk_off" ? 1 : r.ctx === "caution" ? 2 : 4; return N[Math.min(p, pb, cx)]; });
      // B: A + CRASH 는 두 원천 확인(위상 CRASH 와 [pb≤BEAR 또는 dd60≤-6 또는 추세 음]) 아니면 BEAR
      const B = r => { const p = PHm[r.phase]; let pb = r.pbAge < 4 ? R[r.pbv] : 4; if (p >= 3 && pb <= 1) pb = 2; const cx = r.ctx === "risk_off" ? 1 : r.ctx === "caution" ? 2 : 4; let m = Math.min(p, pb, cx);
        if (m === 0) { const f = r.feat, k = (p === 0 ? 1 : 0) + (pb === 0 ? 1 : 0) + ((f.dd60 != null && f.dd60 <= -6) ? 1 : 0) + ((f.vs50 != null && f.vs50 < -2 && f.s50 < 0) ? 1 : 0); if (k < 2 && !(f.day <= -3)) m = 1; } return N[m]; };
      o.B = V(B);
      // C: B + 지수 위상 CRASH 가 오늘만의 급락(5일 > 0)이면 BEAR
      o.C = V(r => { let x = B(r); if (x === "CRASH" && r.feat.r5 > 0 && !(r.feat.day <= -3)) x = "BEAR"; return x; });
    }
    if (process.env.SWEEP) for (const v of [null, -4, -6, -8, -10]) { const c = JSON.parse(JSON.stringify(lib.CFG)); c.crashNeedDd = v; o["dd" + v] = metrics(rows, runNew(rows, mk, c), mk); }
    out[mk + ":" + nm] = o;
  }
}
const cols = ["stAcc","stDir","acc","dirAcc","crashP","crashR","bearP","crashDays","falseCrash","flipsYr","episodes","missed","latency","recovery","invRet","invSharpe"];
for (const k in out) { console.log("\n== " + k + " (n=" + out[k].phase.n + ")"); console.log(["src"].concat(cols).join("\t"));
  for (const s in out[k]) console.log([s].concat(cols.map(c => out[k][s][c])).join("\t")); }
if (process.argv.includes("--json")) console.log(JSON.stringify(out));
