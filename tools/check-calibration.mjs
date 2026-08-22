// [V33.188] 확률 보정 계약.
//
//   ★왜 손댔나★ 운영 스냅샷(2026-08-22)에서 위원회 보정이 이랬다:
//     committee_cal = { T: 6, ece: 0.1719,
//                       diagram: [{ bin:"0.5-0.6", n:400, predicted:0.514, actual:0.343 }] }
//   모형이 51.4% 라고 말한 자리의 실제 승률이 34.3% 였다. 진입문턱(us 0.503 / kr 0.45)이
//   정확히 그 구간에 있으므로, 이 17%p 는 켈리·사이징·게이트로 그대로 흘러간다.
//
//   ★원인은 튜닝이 아니라 가족 선택이다★ 온도보정 σ(logit(p)/T) 는 T 가 무엇이든 0.5→0.5 를
//   고정한다. 즉 '뾰족함' 만 줄일 뿐 ★치우침★ 은 표현할 수 없다. 종전 코드는 T 가 탐색 상한에
//   붙자 상한을 3→6 으로 올렸는데(V12.49), 그건 못 맞추는 가족을 더 세게 밀어붙인 것뿐이다.
//
//   이 게이트가 지키는 것:
//     ① 적용 경로가 하나뿐인가(_calApply) — 화면·라이브·학습이 서로 다른 보정을 쓰면 안 된다
//     ② 적용측 가드가 cal.T 에 매여 있지 않은가 — 매여 있으면 베타 보정이 조용히 무시된다
//     ③ 단조성 — 보정기가 순위를 뒤집으면 그건 보정이 아니라 파괴다
//     ④ 모형 선택이 ★교차검증★ 인가 — 학습표본 NLL 로 고르면 항상 모수 많은 쪽이 이긴다
//     ⑤ 실제로 치우침을 고치는가 — 실측 모양(0.514→0.343)을 합성해 몬테카를로로 확인한다
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

// ── ① 적용은 한 곳으로 모였는가 ────────────────────────────────────────────
{
  chk(/function _calApply\(cal, p\)/.test(src) && /function _calZ\(cal, p\)/.test(src),
    "_calApply / _calZ 가 있다 — 보정 적용 경로가 하나다",
    "_calApply 가 없다 — 보정이 여러 곳에서 제각기 적용되면 화면과 라이브가 갈라진다");
  // 옛 형태(온도 직접 적용)가 확률 체인에 남아 있으면 안 된다.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const legacy = code.match(/_sigmoid\(_logitD?\([^)]*\)\s*\/\s*(?:cal|_fc)\.T\)/g) || [];
  chk(legacy.length === 0,
    "확률 체인에 온도를 직접 적용하는 옛 경로가 남아 있지 않다",
    "온도를 직접 적용하는 코드가 " + legacy.length + "곳 남아 있다 — 베타로 적합된 날 두 경로가 어긋난다");
}

// ── ② 적용측 가드가 cal.T 에 매여 있지 않은가 ──────────────────────────────
//   여기가 이 변경에서 가장 조용히 깨질 수 있는 곳이다. 가드를 typeof cal.T === "number" 로
//   두면 베타/플랫 보정기는 T 가 없어 ★통째로 무시★ 되고, 아무 로그도 남지 않는다.
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const bad = (code.match(/typeof\s+(?:cal|_fc)\.T\s*===\s*"number"/g) || []).length;
  chk(bad === 0, "적용측 가드가 cal.T 유무로 보정을 건너뛰지 않는다",
    "가드가 아직 cal.T 를 본다(" + bad + "곳) — 베타 보정이 조용히 무시된다");
  chk(/_calApply\(cal, pCombined\)/.test(code) && /_calApply\(_fc, pCombined\)/.test(code),
    "체인 중간(committee_cal)·끝(final_cal) 모두 _calApply 를 지난다",
    "확률 체인의 두 보정 지점 중 _calApply 를 안 쓰는 곳이 있다");
}

// ── ③~⑤ 실제로 동작하는가 — 모듈을 떼어 내 돌린다 ─────────────────────────
const grabFrom = (startMark, endMark) => {
  const i = src.indexOf(startMark), j = src.indexOf(endMark, i);
  if (i < 0 || j < 0) throw new Error("보정 모듈을 못 찾았다");
  return src.slice(i, j);
};
const mod = grabFrom("const CALFAM = {", "// ════════════════════════════════════════════════════════════════════════════\n// [V33.94] ★최종 확률 보정(T2)");
const ctx = vm.createContext({ Math, Number, Array, Object, String, isFinite, JSON, console });
new vm.Script(`
function _num(v,d){var n=Number(v);return isFinite(n)?n:d;}
function _clamp(v,a,b){return v<a?a:(v>b?b:v);}
${mod}
this.calFitBest=calFitBest; this._calApply=_calApply; this._calECE=_calECE; this._calDesc=_calDesc; this.CALFAM=CALFAM;
`).runInContext(ctx);
const { calFitBest, _calApply, _calECE, CALFAM } = ctx;

// 재현 가능한 난수
let seed = 20260822;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
// 운영 실측과 같은 모양: 예측이 0.50~0.60 에 몰려 있고 그 구간 실제 승률은 34.3%
const genBiased = (n) => {
  const o = [];
  for (let i = 0; i < n; i++) {
    const p = 0.50 + rnd() * 0.10;
    const truth = Math.max(0.02, Math.min(0.95, 0.343 + (p - 0.514) * 1.2));
    o.push([+p.toFixed(4), rnd() < truth ? 1 : 0]);
  }
  return o;
};

// ── ③ 단조성 — 보정 후에도 순위가 보존되는가 ───────────────────────────────
{
  const fit = calFitBest(genBiased(400), { tLo: 0.5, tHi: 6 });
  let mono = true, prev = -1;
  for (let p = 0.02; p <= 0.98; p += 0.01) { const q = _calApply(fit, p); if (q < prev - 1e-9) mono = false; prev = q; }
  chk(mono, "보정 후에도 확률 순위가 보존된다(단조 증가) — 보정이 순위를 뒤집지 않는다",
    "보정기가 단조가 아니다 — 확률이 높을수록 덜 맞다고 주장하는 꼴이라 순위가 뒤집힌다");
  chk(_num0(fit.a) >= 0 && _num0(fit.b) >= 0 || fit.mode === "temp",
    "베타/플랫 계수가 음수로 적합되지 않는다(Kull et al. 2017 의 단조 제약)",
    "보정 계수가 음수다 — 단조 제약이 걸려 있지 않다");
  function _num0(v) { return (typeof v === "number" && isFinite(v)) ? v : 0; }
}

// ── ④ 모형 선택이 교차검증인가 ─────────────────────────────────────────────
{
  chk(/function _calCV\(pairs, fitFn\)/.test(src) && /const a = Math\.floor\(n \* k \/ K\)/.test(src),
    "시간순 연속 블록 교차검증으로 가족을 고른다(무작위 섞기 아님)",
    "교차검증이 없거나 무작위 섞기다 — 이웃 거래가 같은 국면을 공유해 낙관편향이 생긴다");
  chk(_num(CALFAM.gainNats) > 0,
    `모수를 늘리려면 CV NLL 이 ${CALFAM.gainNats} 만큼은 좋아져야 한다(공짜로 안 늘어난다)`,
    "모수를 늘리는 문턱(gainNats)이 없다 — 표본 잡음만으로 3모수가 채택된다");
  // 표본이 적으면 후보에서 빠지는가
  const small = calFitBest(genBiased(120), { tLo: 0.5, tHi: 6 });
  chk(small.chosen === "temp", `n=120 이면 온도로 물러난다(현재 선택 ${small.chosen})`,
    `표본 120건인데 ${small.chosen} 를 골랐다 — 소표본에서 모수를 늘리면 보정이 잡음을 외운다`);
  function _num(v) { return (typeof v === "number" && isFinite(v)) ? v : 0; }
}

// ── ⑤ 실측 모양에서 실제로 치우침이 잡히는가(몬테카를로) ────────────────────
//   ★홀드아웃에서 잰다★ — 같은 표본에서 재면 모수 많은 쪽이 언제나 이긴다.
{
  const R = 40;
  let winT = 0, sumT = 0, sumF = 0, sumRaw = 0;
  for (let r = 0; r < R; r++) {
    const tr = genBiased(400), te = genBiased(400);
    const fit = calFitBest(tr, { tLo: 0.5, tHi: 6 });
    // 온도만 쓰던 종전 동작
    let bT = 1, bL = Infinity;
    for (let T = 0.5; T <= 6.001; T += 0.1) {
      let s = 0;
      for (const x of tr) { const pc = _calApply({ mode: "temp", T: T }, x[0]); s += -(x[1] * Math.log(pc) + (1 - x[1]) * Math.log(1 - pc)); }
      s /= tr.length; if (s < bL) { bL = s; bT = T; }
    }
    const eT = _calECE({ mode: "temp", T: bT }, te).ece;
    const eF = _calECE(fit, te).ece;
    const e0 = _calECE({ mode: "temp", T: 1 }, te).ece;
    sumT += eT; sumF += eF; sumRaw += e0;
    if (eF < eT) winT++;
  }
  const mT = sumT / R, mF = sumF / R, m0 = sumRaw / R;
  chk(mF < mT * 0.75,
    `홀드아웃 ECE: 무보정 ${(m0 * 100).toFixed(1)}% · 온도만 ${(mT * 100).toFixed(1)}% · 새 보정 ${(mF * 100).toFixed(1)}%`,
    `새 보정이 온도보다 확실히 낫지 않다(${(mF * 100).toFixed(1)}% vs ${(mT * 100).toFixed(1)}%)`);
  chk(winT >= R * 0.9, `${R}회 중 ${winT}회에서 온도보다 홀드아웃 ECE 가 낮다`,
    `온도를 이긴 횟수가 ${winT}/${R} 뿐이다 — 우연일 수 있다`);
  // 온도로는 애초에 못 고친다는 것 자체를 못박는다(이게 이 변경의 전제다).
  const te2 = genBiased(2000);
  let best = Infinity;
  for (let T = 0.2; T <= 12.001; T += 0.1) { const e = _calECE({ mode: "temp", T: T }, te2).ece; if (e < best) best = e; }
  chk(best > 0.05,
    `온도는 T 를 아무리 뒤져도 이 치우침을 ${(best * 100).toFixed(1)}% 아래로 못 내린다(0.5→0.5 고정이라)`,
    "온도만으로도 치우침이 잡힌다 — 이 변경의 전제가 틀렸다는 뜻이니 설계를 다시 봐야 한다");
}

console.log(fails ? "\n확률 보정 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   확률 보정 계약 통과");
process.exit(fails ? 1 : 0);
