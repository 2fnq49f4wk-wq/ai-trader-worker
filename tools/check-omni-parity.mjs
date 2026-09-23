/* ═══════════════════════════════════════════════════════════════════════════
   [V33.419] ★OMNI 학습/추론 피처 정합★ — 파이썬(학습)과 JS(추론)가 ★같은 봉에서 같은 값★ 을 내는가

   이 저장소가 반복해서 겪은 사고의 모양은 하나다: 학습 쪽과 추론 쪽이 ★다른 피처를 본다★.
   화면엔 아무 에러도 없고, 모델은 학습 때 본 적 없는 분포를 운영에서 받는다.
   그래서 이 검사는 글자를 비교하지 않는다 — ★파이썬을 실제로 돌려★ 값을 비교한다.

   만드는 합성 봉에 일부러 넣은 것:
     · 미국 서머타임 전환(2026-03-08) — 개장 시각이 UTC 로 한 시간 밀리는 주
     · 거래량 0 봉 · 가격이 안 움직이는 구간 — NaN 분기(0으로 나누기)를 태운다
     · 한국장 — KST 세션
   ═══════════════════════════════════════════════════════════════════════════ */
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

let seed = 20260306;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { let u = 0; for (let k = 0; k < 6; k++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };

/* ★5분봉과 일봉이 서로 맞는 합성 시장★ — 첫 판은 둘을 따로 만들어(5분봉 ≈100, 일봉 ≈80)
   모든 '갭' 이 22% 짜리였다. 그래서 갭 매매법 문턱(1.5%)을 2% 로 바꾼 돌연변이(P15)가 빠져나갔다
   — 1.5~2% 구간을 한 번도 안 지났기 때문이다. 이제 일봉의 최근 구간을 5분봉에서 ★묶어서★ 만들고,
   그 앞 이력은 첫 시가에서 끝나도록 거꾸로 이어 붙인다. 그리고 날마다 ★정해진 크기의 밤사이 갭★ 을 넣는다
   (+1.7% · −1.7% · +2.5% · +1.2% …) — 문턱 양쪽을 일부러 지나가게. */
const GAPS = [0, 0.017, -0.017, 0.025, 0.012, -0.022, 0.016, 0.019, -0.013, 0.004];
function genMarket(mkt, startDate, days, flatDay, zeroDay) {
  const b5 = { t: [], o: [], h: [], l: [], c: [], v: [] };
  const recentDaily = [];
  let p = 100, d = new Date(startDate), made = 0;
  while (made < days) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) {
      const openMin = mkt === "us" ? 570 : 540;
      const probe = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12) / 1000;
      const off = mkt === "us" ? M._omUsOff(probe) : 9;
      const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000 + (openMin - off * 60) * 60;
      p *= Math.exp(GAPS[made % GAPS.length]);                       // 밤사이 갭
      const dayO = p; let dayH = p, dayL = p, dayV = 0;
      for (let k = 0; k < 78; k++) {
        const o = p, flat = (made === flatDay);
        if (!flat) p *= Math.exp(gauss() * 0.002);
        const hi = Math.max(o, p) * (1 + (flat ? 0 : Math.abs(gauss()) * 0.0008));
        const lo = Math.min(o, p) * (1 - (flat ? 0 : Math.abs(gauss()) * 0.0008));
        /* 거래량 0 봉을 섞는다 — 그리고 ★하루 통째로 0★ 인 날(zeroDay)도 둔다.
           12봉 연속 0 이어야 ofi 분모가, 60봉 연속이어야 relvol 분모가 0 이 된다(P10·P14). */
        const vol = (made === zeroDay) ? 0 : ((k % 17 === 0) ? 0 : Math.floor(100 + rnd() * 900));
        b5.t.push(base + k * 300); b5.o.push(o); b5.h.push(hi); b5.l.push(lo); b5.c.push(p); b5.v.push(vol);
        if (hi > dayH) dayH = hi; if (lo < dayL) dayL = lo; dayV += vol;
      }
      recentDaily.push({ t: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000, o: dayO, h: dayH, l: dayL, c: p, v: dayV });
      made++;
    }
    d = new Date(d.getTime() + 86400000);
  }
  // 그 앞 290 거래일 — 첫 시가 직전 종가에서 끝나도록 거꾸로 만든다
  const older = []; let q = recentDaily[0].o / Math.exp(GAPS[0]); d = new Date(startDate - 86400000);
  while (older.length < 290) {
    const w = d.getUTCDay();
    if (w >= 1 && w <= 5) {
      const c = q; const o = c / Math.exp(gauss() * 0.015);
      older.unshift({ t: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000, o: o,
                      h: Math.max(o, c) * (1 + Math.abs(gauss()) * 0.006), l: Math.min(o, c) * (1 - Math.abs(gauss()) * 0.006),
                      c: c, v: Math.floor(1e5 + rnd() * 9e5) });
      q = o;
    }
    d = new Date(d.getTime() - 86400000);
  }
  const bd = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (const r of older.concat(recentDaily)) for (const k of ["t", "o", "h", "l", "c", "v"]) bd[k].push(r[k]);
  return { b5, bd };
}

const cases = [];
// 미국 — 서머타임 전환(3/8 일요일)을 가로지르는 주. 3/2(월) 시작 10거래일.
const US = genMarket("us", Date.UTC(2026, 2, 2), 10, 4, 6), us5 = US.b5, usD = US.bd;
// 한국
const KR = genMarket("kr", Date.UTC(2026, 2, 2), 10, -1, 7), kr5 = KR.b5, krD = KR.bd;
for (const [mkt, b5, bd] of [["us", us5, usD], ["kr", kr5, krD]]) {
  const n = b5.t.length;
  // 결정 시점: 초반(창 부족 → NaN) · 각 세션의 첫 봉 · 중간 · 마지막 봉 · 가격이 멈춘 날
  const idx = new Set([0, 5, 11, 23, 47, 59, 60, 77, 78, 79, 150, 311, 312, 313, 390, 400, 500, 600, n - 1]);
  /* ★촘촘하게★ — 첫 판은 37봉 간격이라 매매법 문턱(relvol 1.2 등) 근처를 거의 안 지났다.
     문턱 하나를 1.1 로 바꾼 돌연변이(P8)가 그렇게 빠져나갔다. 모든 봉을 본다. */
  for (let k = 0; k < n; k++) idx.add(k);
  for (const i of [...idx].filter(i => i >= 0 && i < n).sort((a, b) => a - b)) cases.push({ mkt, i, daily: false });
}
// 장타 행(일봉만)
/* 장타 행도 ★모든 일봉★ 을 본다 — 첫 판은 12곳만 봐서 일봉 돌파 창(20→10) 돌연변이(P19)가 빠져나갔다. */
for (let j = 0; j < usD.t.length; j++) cases.push({ mkt: "us", j, daily: true });
for (let j = 0; j < krD.t.length; j++) cases.push({ mkt: "kr", j, daily: true });

const dir = tmpdir(), inF = join(dir, "omni_parity_in.json"), outF = join(dir, "omni_parity_py.json");
/* ══ [V33.423] ★패널(횡단면) 정합★ — 새 칸 15개는 '같은 날 다른 종목' 이 있어야 생긴다.
   한 종목만 비교하면 이 칸들은 양쪽 다 NaN 이라 ★검사가 눈이 먼다.★
   그래서 일봉을 흔들어 ★가짜 종목 30개★ 를 만들고 두 구현이 같은 랭크를 내는지 본다.
   (랭크는 동점·최소 패널·시장 분리에서 갈리기 쉽다 — 그 셋을 일부러 만든다.) */
const panelSyms = {}, panelMkt = {};
for (let q = 0; q < 50; q++) {   // 시장별 25종목 — PANEL_MIN(20) 을 넘겨야 랭크가 실제로 생긴다
  const src = q % 2 === 0 ? usD : krD;
  const b = {};
  /* 종목마다 다른 배수 — 단, 두 종목은 ★같은 값★ 으로 둬 동점 처리를 태운다. */
  const mul = 1 + q * 0.037;
  /* q=6 과 q=8 은 ★완전히 같은 종목★ 으로 둔다(같은 시장·같은 값) — 동점 처리를 태우려면
     "비슷한" 이 아니라 ★똑같아야★ 한다. 첫 판은 sin 항이 달라 동점이 한 번도 안 생겼고,
     그래서 '동점 평균순위' 를 지운 돌연변이가 빠져나갔다. */
  const qq = (q === 8) ? 6 : q;
  for (const k of ["t"]) b[k] = src[k].slice();
  for (const k of ["o", "h", "l", "c"]) b[k] = src[k].map((v, i2) => v * (1 + qq * 0.037) * (1 + 0.004 * Math.sin(i2 + qq)));
  b.v = src.v.map((v, i2) => Math.max(0, Math.round(v * (0.5 + (qq % 7) * 0.2) + (i2 % 5 === 0 ? 0 : 3 * qq))));
  panelSyms["S" + q] = b;
  panelMkt["S" + q] = q % 2 === 0 ? "us" : "kr";
}
/* 검사할 날짜 — 패널이 서는 날(초반은 60봉이 안 차서 빈다) */
const pDays = [];
{
  /* ★날짜 키 규약을 맞춘다.★ 패널이 쓰는 키는 일봉 t 의 YYYYMMDD(omni.day_key_of_daily) 다.
     첫 판은 _obDayKey(초 단위 자정)를 넣어 ★검사가 늘 같은 날을 봤고★, 그래서 경계
     돌연변이(dayKey+1)가 빠져나갔다 — 규약이 어긋나면 검사는 조용히 헛돈다. */
  const dk = (t) => { const d = new Date(t * 1000); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); };
  const all = [...new Set(usD.t.map(dk))].sort((a, b) => a - b);
  for (const q of [70, 90, 120, all.length - 1]) if (all[q] != null) pDays.push(all[q]);
}
writeFileSync(inF, JSON.stringify({ us5, usD, kr5, krD, cases, panelSyms, panelMkt, pDays }));
const py = `
import json, sys, math
sys.path.insert(0, ${JSON.stringify(new URL("../trainer/modal", import.meta.url).pathname)})
import omni
d = json.load(open(${JSON.stringify(inF)}))
out = []
for cs in d["cases"]:
    if cs["daily"]:
        bdd = d["usD"] if cs["mkt"] == "us" else d["krD"]
        x, s = omni.feature_point(None, bdd, None, cs["mkt"], daily_row=True, j=cs["j"])
    else:
        b5 = d["us5"] if cs["mkt"] == "us" else d["kr5"]
        bd = d["usD"] if cs["mkt"] == "us" else d["krD"]
        x, s = omni.feature_point(b5, bd, cs["i"], cs["mkt"])
    out.append({"x": [None if v != v else v for v in x], "s": s})
pan = {}
for dk in d["pDays"]:
    pr = omni.build_panel(d["panelSyms"], d["panelMkt"], dk)
    pan[str(dk)] = {s: {k: (None if v != v else v) for k, v in r.items()} for s, r in pr.items()}
json.dump({"panel": pan, "panelFeats": omni.PANEL_FEATS, "panelMin": omni.PANEL_MIN,
           "feats": omni.FEATS, "setups": omni.SETUPS, "horizons": omni.HORIZONS, "ver": omni.OMNI_VER,
           "consts": {"sess": omni.SESS_MIN, "openUs": omni.OPEN_MIN["us"], "openKr": omni.OPEN_MIN["kr"],
                      "hLook": omni.H_LOOKBACK, "dLook": omni.D_LOOKBACK, "base": omni.BASE_SEC},
           "rows": out}, open(${JSON.stringify(outF)}, "w"))
`;
try { execFileSync("python3", ["-c", py], { stdio: ["ignore", "ignore", "pipe"] }); }
catch (e) { console.log("  FAIL ★파이썬 기준 구현을 못 돌렸다★ — " + String(e.stderr || e.message).slice(0, 300)); process.exit(1); }
const P = JSON.parse(readFileSync(outF, "utf8"));

console.log("① ★이름·순서·판이 같은가★");
chk(JSON.stringify(P.feats) === JSON.stringify(M.OMNI_FEATS), "피처 " + M.OMNI_FEATS.length + "개 이름·순서가 같다",
  "★피처 목록이 갈렸다 — 학습 칸과 추론 칸이 어긋난다★");
chk(JSON.stringify(P.setups) === JSON.stringify(M.OMNI_SETUPS), "매매법 " + M.OMNI_SETUPS.length + "종이 같다", "★매매법 목록이 갈렸다★");
chk(JSON.stringify(P.horizons) === JSON.stringify(M.OMNI_HORIZONS), "지평 " + M.OMNI_HORIZONS.length + "종이 같다", "★지평 목록이 갈렸다★");
chk(P.ver === M.OMNI_VER, "판(OMNI_VER) " + M.OMNI_VER + " 이 같다", "★판이 갈렸다★");
/* 창 상수도 맞춘다 — 값 비교가 못 잡는 자리가 있다: D_LOOKBACK 은 지금 창(최대 252)보다 커서
   값에 영향이 없다(돌연변이 P7 이 무해하게 지나갔다). 그러나 누가 창을 늘리는 날 한쪽만 바뀌면
   그때부터 갈린다 — 그 날을 기다리지 않고 지금 맞춰 둔다. */
chk(JSON.stringify(P.consts) === JSON.stringify(M.OMNI_CONSTS),
  "창·세션 상수가 같다 " + JSON.stringify(M.OMNI_CONSTS),
  "★상수가 갈렸다 — py " + JSON.stringify(P.consts) + " / js " + JSON.stringify(M.OMNI_CONSTS) + "★");
/* ★매매법 경계를 실제로 지나가는가★ — 모든 매매법이 적어도 한 번은 나와야 판정 비교가 뜻이 있다. */
{
  const seen = new Set(P.rows.map(r => r.s));
  chk(seen.size >= 5, "합성 봉에서 매매법 " + seen.size + "종이 실제로 나온다(판정 비교가 뜻이 있다)",
    "★매매법이 " + seen.size + "종만 나온다 — 대부분의 규칙을 한 번도 안 태운다★");
}

console.log("\n② ★같은 봉에서 같은 값인가★ (" + cases.length + "개 시점 × " + M.OMNI_FEATS.length + "칸)");
let worst = 0, worstAt = "", nanMis = 0, setupMis = 0, compared = 0, nanBoth = 0;
cases.forEach((cs, r) => {
  const js = cs.daily ? M.omniFeatures(null, cs.mkt === "us" ? usD : krD, null, cs.mkt, true, cs.j)
                      : M.omniFeatures(cs.mkt === "us" ? us5 : kr5, cs.mkt === "us" ? usD : krD, cs.i, cs.mkt, false);
  const pyr = P.rows[r];
  if (js.setup !== pyr.s) { setupMis++; if (setupMis <= 3) console.log("      매매법 불일치 @" + JSON.stringify(cs) + " js " + js.setup + " py " + pyr.s); }
  for (let k = 0; k < M.OMNI_FEATS.length; k++) {
    const a = js.x[k], b = pyr.x[k];
    const an = !(a === a), bn = (b === null);
    if (an || bn) { if (an !== bn) { nanMis++; if (nanMis <= 5) console.log("      NaN 불일치 " + M.OMNI_FEATS[k] + " @" + JSON.stringify(cs) + " js " + a + " py " + b); } else nanBoth++; continue; }
    compared++;
    const err = Math.abs(a - b) / Math.max(1, Math.abs(b));
    if (err > worst) { worst = err; worstAt = M.OMNI_FEATS[k] + " @" + JSON.stringify(cs) + " js " + a + " py " + b; }
  }
});
chk(nanMis === 0, "NaN 이 나는 자리가 ★양쪽 같다★ (둘 다 NaN " + nanBoth + "칸)", "★NaN 자리가 " + nanMis + "칸 갈렸다 — 한쪽만 창 부족을 NaN 으로 본다★");
chk(worst < 1e-9, "값 " + compared + "칸 최대 상대오차 " + worst.toExponential(2) + " < 1e-9",
  "★값이 갈렸다(최대 " + worst.toExponential(2) + ") — " + worstAt + "★");
chk(setupMis === 0, "매매법 판정이 ★모든 시점에서 같다★", "★매매법 판정이 " + setupMis + "곳에서 갈렸다★");
chk(compared > cases.length * 20, "비교가 실제로 이뤄졌다(" + compared + "칸 — NaN 만 비교해 통과하는 일이 없다)",
  "★거의 다 NaN 이라 비교가 무의미하다(" + compared + "칸)★");

console.log("\n③ ★미래를 보지 않는가★ — i 뒤의 봉을 바꿔도 i 의 피처가 안 바뀐다");
{
  const i = 400;
  const base = M.omniFeatures(us5, usD, i, "us", false).x;
  const fut = JSON.parse(JSON.stringify(us5));
  for (let k = i + 1; k < fut.t.length; k++) { fut.c[k] *= 3; fut.h[k] *= 3; fut.l[k] *= 0.3; fut.v[k] = 1e9; }
  const after = M.omniFeatures(fut, usD, i, "us", false).x;
  const same = base.every((v, k) => (v === after[k]) || (!(v === v) && !(after[k] === after[k])));
  chk(same, "i 뒤 봉을 3배로 바꿔도 피처가 ★한 칸도 안 바뀐다★", "★미래 봉이 피처에 새어 들어간다★");
  // 일봉: 결정일 당일·이후 일봉을 바꿔도 장중 피처(전일까지만 본다)가 안 바뀐다
  const lp = M._omLocal(us5.t[i], "us");
  const dFut = JSON.parse(JSON.stringify(usD));
  for (let k = 0; k < dFut.t.length; k++) {
    const d = new Date(dFut.t[k] * 1000);
    const dk = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    if (dk >= lp.dk) { dFut.c[k] *= 5; dFut.h[k] *= 5; dFut.l[k] *= 0.2; }
  }
  const after2 = M.omniFeatures(us5, dFut, i, "us", false).x;
  const same2 = base.every((v, k) => (v === after2[k]) || (!(v === v) && !(after2[k] === after2[k])));
  chk(same2, "★당일·이후 일봉★ 을 바꿔도 장중 행 피처가 안 바뀐다(전일까지만 본다)",
    "★장중 행이 오늘 일봉(아직 안 끝난 봉)을 본다 — 종가를 미리 안다★");
}

console.log("\n④ ★창이 고정인가★ — 과거 이력이 길어도 짧아도 같은 값(학습 2년치 vs 추론 며칠치)");
{
  const i = us5.t.length - 1;
  const full = M.omniFeatures(us5, usD, i, "us", false).x;
  const cut = 320;   // H_LOOKBACK(312) 보다 조금 길게 — 추론 쪽이 가진 만큼
  const tail = {}; for (const k of ["t", "o", "h", "l", "c", "v"]) tail[k] = us5[k].slice(-cut);
  const dCut = {}; for (const k of ["t", "o", "h", "l", "c", "v"]) dCut[k] = usD[k].slice(-262);
  const short = M.omniFeatures(tail, dCut, cut - 1, "us", false).x;
  const diffs = [];
  full.forEach((v, k) => {
    const a = v, b = short[k];
    const eq = (a === b) || (!(a === a) && !(b === b)) || Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a));
    if (!eq) diffs.push(M.OMNI_FEATS[k]);
  });
  // s_vwapdev·s_ret 는 세션 첫 봉이 잘리면 달라질 수 있다 — 추론은 세션을 통째로 받아야 한다(여기선 잘리지 않게 320)
  chk(diffs.length === 0, "5분봉 320개·일봉 262개만 가진 쪽과 ★전체 이력★ 쪽이 같은 값을 낸다",
    "★이력 길이에 따라 값이 달라진다: " + diffs.join(",") + " — 학습과 추론이 갈린다★");
}

console.log("\n⑤ ★패널(횡단면 랭크·시장 상대)이 두 구현에서 같은가★  [V33.423]");
{
  chk(JSON.stringify(P.panelFeats) === JSON.stringify(M.OMNI_PANEL_FEATS),
    "패널 칸 " + M.OMNI_PANEL_FEATS.length + "개 이름·순서가 같다", "★패널 칸 목록이 갈렸다★");
  let nCmp = 0, nNonNan = 0, worst = 0, bad = [];
  for (const dk of pDays) {
    const js = M.omniBuildPanel(panelSyms, panelMkt, dk);
    const pyp = P.panel[String(dk)] || {};
    const keys = [...new Set([...Object.keys(js), ...Object.keys(pyp)])];
    if (keys.length !== Object.keys(js).length || keys.length !== Object.keys(pyp).length) {
      bad.push("종목 집합이 다르다(" + dk + ")"); continue;
    }
    for (const sym of keys) {
      for (const k of M.OMNI_PANEL_FEATS) {
        const a = js[sym][k], b = pyp[sym][k] == null ? NaN : pyp[sym][k];
        nCmp++;
        if (a === a) nNonNan++;
        const eq = (!(a === a) && !(b === b)) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
        if (!eq) { bad.push(sym + "." + k + " " + a + "≠" + b); worst = Math.max(worst, Math.abs(a - b)); }
      }
    }
  }
  chk(nCmp > 1000, "패널 값 " + nCmp.toLocaleString() + "칸을 비교했다(" + pDays.length + "일 × 50종목)",
    "비교한 칸이 너무 적다 — 검사가 헛돈다");
  chk(nNonNan > nCmp * 0.5, "그중 " + nNonNan.toLocaleString() + "칸이 ★실제 값★ 이다(전부 NaN 이면 검사가 눈이 멀었다)",
    "★패널이 거의 전부 NaN 이다 — 이 검사는 아무것도 확인하지 못했다★");
  chk(bad.length === 0, "두 구현의 패널 값이 같다", "★패널이 갈린다(" + bad.length + "칸): " + bad.slice(0, 3).join(" · ") + "★");
  /* 최소 패널 미만이면 ★랭크를 만들지 않는다★ — 두 구현이 같은 자리에서 같이 기권해야 한다. */
  const few = {}, fewM = {};
  for (let q = 0; q < 5; q++) { few["S" + q] = panelSyms["S" + q]; fewM["S" + q] = "us"; }
  const small = M.omniBuildPanel(few, fewM, pDays[1]);
  const anyRank = Object.values(small).some((r) => r.q_r1 === r.q_r1);
  chk(!anyRank, "패널이 " + M.OMNI_PANEL_MIN + "종목 미만이면 랭크를 ★안 만든다★(모르면 NaN)",
    "★적은 패널에서도 랭크를 만든다 — 두세 종목 순위를 분위라고 부르게 된다★");
}

console.log(fails === 0 ? "\n✓ OMNI 학습/추론 피처 정합 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
