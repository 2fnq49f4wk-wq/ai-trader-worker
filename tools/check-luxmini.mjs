/* ═══════════════════════════════════════════════════════════════════════════
   LUX-Mini 검사 — 브라우저에서 도는 작은 주식 판단 모델(public/luxmini.js + public/luxmini.json)

   ■ 왜 필요한가
     이 모델은 서버를 거치지 않고 화면이 직접 '긍정·주의' 와 근거 문장을 낸다. 그래서 깨지면
     아무도 모른다 — 가중치 파일과 JS 가 어긋나면 엉뚱한 점수가 ★조용히★ 나가고,
     검증을 못 넘은 머리가 '검증 통과' 로 표시되면 그게 곧 거짓 광고다.

   ■ 이 검사가 무는 것
     ① 파일 크기·모양: 머리 6개(한·미 × 5·20·120일) · 나무 ≤ 64 · 깊이 ≤ 3 · JSON < 150KB
     ② JS 나무 걷기 = 파이썬 LightGBM 점수(학습기가 남긴 패리티 벡터 · 결측 경로 포함)
     ③ 합성 시세로 predict: 출력 모양 · NaN 없음 · 확률 0~1 · 근거 [ko,en] · 결정적(두 번 같다) · 종목당 < 5ms
     ④ 'usable' 인 머리는 저장된 홀드아웃 통계가 문턱(IC t ≥ 2 · 기준선 대비 IC t ≥ 2 · 상위10% 순초과 > 0)을 넘는다
        — 못 넘은 머리는 grade '참고(검증 미달)'
     ⑤ 맥락(같은 시장 목록) 없이 부르면 판단하지 않는다(null) · 서버 API 를 부르지 않는다(Worker 비용 0)
     ⑥ 돌연변이: 문턱 미달 머리를 usable 로 바꾸면 ④가 잡는다(검사가 헛돌지 않는다)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, statSync } from "node:fs";
import vm from "node:vm";

let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.log("  ✗ FAIL " + m); } };

const SRC = readFileSync(new URL("../public/luxmini.js", import.meta.url), "utf8");
const JPATH = new URL("../public/luxmini.json", import.meta.url);
const J = JSON.parse(readFileSync(JPATH, "utf8"));

function fresh() {
  const win = {};
  const ctx = vm.createContext({ window: win });
  vm.runInContext(SRC, ctx, { filename: "luxmini.js" });
  return win.luxMini;
}

/* ① 모양 */
const size = statSync(JPATH).size;
ok(size < 150 * 1024, `luxmini.json ${(size / 1024).toFixed(1)}KB < 150KB`);
ok(J.mode === "raw" || J.mode === "pct", `특징 방식 = ${J.mode}`);
const MKS = ["kr", "us"], HKS = ["s", "m", "l"], HV = { s: 5, m: 20, l: 120 };
let maxDepth = 0, maxTrees = 0, nHeads = 0;
function depth(T, i) { return T.f[i] < 0 ? 0 : 1 + Math.max(depth(T, T.l[i]), depth(T, T.r[i])); }
for (const mk of MKS) for (const hk of HKS) {
  const H = J.mk && J.mk[mk] && J.mk[mk].heads && J.mk[mk].heads[hk];
  if (!H) { ok(false, `머리 ${mk}/${hk} 있음`); continue; }
  nHeads++;
  ok(H.h === HV[hk], `${mk}/${hk} 지평 ${H.h}일`);
  maxTrees = Math.max(maxTrees, H.trees.length);
  for (const T of H.trees) {
    maxDepth = Math.max(maxDepth, depth(T, 0));
    for (let i = 0; i < T.f.length; i++) if (T.f[i] >= J.feats.length) { ok(false, `${mk}/${hk} 특징 번호 범위`); break; }
  }
  ok(Array.isArray(H.ex_tab) && H.ex_tab.length === 10, `${mk}/${hk} 10분위 ex 표`);
  ok(H.hold && typeof H.hold.ic === "number" && typeof H.hold.ic_t === "number" && typeof H.hold.d_ic_t === "number", `${mk}/${hk} 홀드아웃 통계 저장됨`);
  ok(Array.isArray(H.parity) && H.parity.length >= 3, `${mk}/${hk} 패리티 벡터 ${H.parity ? H.parity.length : 0}개`);
}
ok(nHeads === 6, `머리 ${nHeads}/6`);
ok(maxTrees <= 64 && maxTrees > 0, `머리당 나무 최대 ${maxTrees} ≤ 64`);
ok(maxDepth <= 3, `나무 깊이 최대 ${maxDepth} ≤ 3`);

/* ② 패리티 */
const L = fresh();
await L.load(J);
ok(L.ready(), "load(obj) 후 ready()");
let pmax = 0, pn = 0, missingSeen = false;
for (const mk of MKS) for (const hk of HKS) for (const pv of J.mk[mk].heads[hk].parity) {
  pmax = Math.max(pmax, Math.abs(L._rawX(mk, hk, pv.x) - pv.raw)); pn++;
  if (pv.x.some((v) => v == null)) missingSeen = true;
}
ok(pn >= 18 && pmax < 1e-4, `JS 점수 = LightGBM 점수 (${pn}개 · 최대 차 ${pmax.toExponential(2)})`);
ok(missingSeen, "결측 경로도 패리티에 들어 있다");

/* ③ 합성 시세 */
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
function synth(mk, i) {
  const price = 10 + rnd() * 200, ma = price * (0.85 + rnd() * 0.3), ma5 = price * (0.95 + rnd() * 0.1), ma50 = price * (0.7 + rnd() * 0.6);
  const sd = price * (0.01 + rnd() * 0.06), dp = (rnd() - 0.5) * 8;
  return { symbol: mk === "kr" ? String(100000 + i).padStart(6, "0") + ".KS" : "SYN" + i, market: mk, price, prevClose: price / (1 + dp / 100), dayPct: dp,
    rsi: 10 + rnd() * 80, ma, dailyMaShort: ma5, ma50, atr: price * (0.01 + rnd() * 0.05), bbLower: ma - 2 * sd, bbUpper: ma + 2 * sd,
    return5: (rnd() - 0.5) * 20, return20: (rnd() - 0.5) * 40, return60: (rnd() - 0.5) * 80, ret1y: (rnd() - 0.5) * 150, ret5y: null,
    vol: 1e6 * rnd(), avgVol20: 1e6, isEtf: false };
}
const WL = [];
for (const mk of MKS) for (let i = 0; i < 120; i++) WL.push(synth(mk, i));
WL[3].ma50 = null;      // 50일선 없는 종목 → 판단 안 함
WL[5].ret1y = null;     // 1년 수익 없는 종목 → 결측 경로로 판단
WL[7].regPrice = WL[7].price * 0.98; WL[7].regPct = -1.2;   // 시간외(정규장 값 우선)
const st = { watchlist: WL };
function hasBad(o) {
  if (typeof o === "number") return !isFinite(o);
  if (o && typeof o === "object") return Object.values(o).some(hasBad);
  return false;
}
let shapeOk = true, bad = 0, nPred = 0, nullOk = true, gradeOk = true;
const t0 = performance.now();
const outs = {};
for (const mk of MKS) {
  const c = L.ctxFrom(st, mk);
  for (const q of WL.filter((x) => x.market === mk)) {
    const r = L.predict(q, c);
    if (q.ma50 == null) { if (r !== null) nullOk = false; continue; }
    if (!r) { shapeOk = false; continue; }
    nPred++; outs[q.symbol] = r;
    if (hasBad(r)) bad++;
    for (const hk of HKS) {
      const h = r[hk];
      if (!h || !(h.p > 0 && h.p < 1) || typeof h.ex !== "number" || typeof h.label !== "string" || !(h.decile >= 1 && h.decile <= 10)
        || !Array.isArray(h.why) || h.why.length < 1 || h.why.length > 3
        || !h.why.every((w) => Array.isArray(w) && w.length === 2 && typeof w[0] === "string" && typeof w[1] === "string" && w[0].length > 4)
        || typeof h.usable !== "boolean" || r.usable[hk] !== h.usable) shapeOk = false;
      const H = J.mk[mk].heads[hk];
      if (h && (h.usable !== !!H.hold.usable || h.grade[0] !== (H.hold.usable ? "검증 통과" : "참고(검증 미달)"))) gradeOk = false;
    }
  }
}
const ms = (performance.now() - t0) / Math.max(1, nPred);
ok(nPred >= 230, `합성 종목 ${nPred}개 판단`);
ok(shapeOk, "출력 모양(s/m/l · p∈(0,1) · decile 1~10 · ex · label · why [ko,en] 1~3줄 · usable)");
ok(bad === 0, `NaN/Infinity 없음 (${bad}건)`);
ok(nullOk, "50일선 없는 종목은 판단하지 않는다(null)");
ok(gradeOk, "usable 이 아닌 머리는 '참고(검증 미달)' 로 표시된다");
ok(ms < 5, `종목당 ${ms.toFixed(3)}ms < 5ms (맥락 계산 포함)`);
ok(outs[WL[5].symbol] != null, "1년 수익 결측 종목도 판단한다(결측 경로)");
// 중심화: 같은 시장 평균 p ≈ 0.5
for (const mk of MKS) {
  const ps = Object.values(outs).filter((r) => r.mk === mk).map((r) => r.m.p);
  const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
  ok(Math.abs(mean - 0.5) < 0.02, `${mk} 중기 평균 p ${mean.toFixed(3)} ≈ 0.5 (목표가 같은 날 중앙값 대비)`);
}
// 결정적: 새 인스턴스 · 새 맥락으로 다시 계산해도 같다
const L2 = fresh(); await L2.load(J);
const again = {};
for (const mk of MKS) { const all = L2.predictAll(st, mk); for (const k in all) again[k] = all[k]; }
ok(JSON.stringify(again) === JSON.stringify(outs), "결정적(두 번 계산해도 같다 · predictAll = predict)");

/* ⑤ 맥락 없이 · 서버 호출 없음 */
ok(L.predict(WL[0], null) === null && L.predict(WL[0], L.ctxFrom(st, "us")) === null, "같은 시장 맥락 없이는 판단하지 않는다");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");   // 주석 속 '/api/state' 설명은 호출이 아니다
ok(!/\/api\//.test(CODE) && (CODE.match(/fetch\(/g) || []).length === 1, "luxmini.js 는 서버 API 를 부르지 않는다(Worker CPU·요청 0)");
ok(/"\/luxmini\.json"/.test(SRC), "가중치는 정적 파일 /luxmini.json");

/* ④ usable 문턱 */
function meets(h) { return h && h.ic_t >= 2 && h.d_ic_t >= 2 && h.top10_net > 0; }
function usableViolations(j) {
  const v = [];
  for (const mk of MKS) for (const hk of HKS) { const h = j.mk[mk].heads[hk].hold; if (h.usable && !meets(h)) v.push(mk + "/" + hk); }
  return v;
}
const viol = usableViolations(J);
ok(viol.length === 0, `usable 머리는 홀드아웃 문턱을 넘는다 (위반 ${viol.join(",") || "없음"})`);
const used = [];
for (const mk of MKS) for (const hk of HKS) if (J.mk[mk].heads[hk].hold.usable) used.push(mk + "/" + hk);
console.log("     usable 머리: " + (used.join(" · ") || "없음"));
/* ⑥ 돌연변이 — 문턱 미달 머리를 usable 로 바꾸면 잡혀야 한다 */
const M = JSON.parse(JSON.stringify(J));
let target = null;
for (const mk of MKS) for (const hk of HKS) if (!target && !meets(M.mk[mk].heads[hk].hold)) target = [mk, hk];
if (!target) { target = ["kr", "s"]; M.mk.kr.heads.s.hold.ic_t = 1.0; }
M.mk[target[0]].heads[target[1]].hold.usable = true;
ok(usableViolations(M).length > 0, `돌연변이(${target.join("/")} 를 usable 로) → 잡힌다`);

console.log(fail ? `\n✗ LUX-Mini 검사 ${fail}/${n} 실패` : `\n✅ LUX-Mini 검사 ${n}종 통과`);
process.exit(fail ? 1 : 0);
