/* ═══════════════════════════════════════════════════════════════════════════
   [V33.291] IC 를 ★시장을 섞은 채★ 재고 있었다 — 실력 0 이 정식합류한다.

   ■ 무엇이 잘못돼 있었나
     블록 IC 는 미국 표본과 한국 표본을 한 통에 넣고 Pearson 을 쟀다. 그런데 두 시장의
     기저승률이 다르면 "시장을 아는 것" 만으로 p 와 y 가 같이 움직인다. 그리고 시장 원핫
     (mktUS/mktKR/mktCM)은 LUXML 75피처 안에 있으므로 ★어떤 모델이든 공짜로 안다★.
     이 편향은 잡음이 아니라 ★체계적★ 이라 블록마다 같은 값이 나오고, 블록 간 분산이
     0 에 가까워져 t 가 폭발한다 — 게이트가 가장 못 막는 모양이다.

   ■ 고침 — 블록 안에서 시장별 평균을 뺀 뒤 잰다(고정효과 within 추정량)
     "미국이 한국보다 낫다" 는 몫이 사라지고 ★같은 시장 안에서 종목을 갈라 세우는 힘★ 만
     남는다. 위원회가 실제로 쓰는 것이 그것이다(사이징·게이트는 시장별로 따로 돈다).
     시장이 하나뿐이면 상수를 빼는 것이라 ★값이 안 변한다.★

   ■ 이 검사가 무는 것
     ① 섞어 재면 실력 0 이 게이트를 통과한다(사고의 재현 — 이게 재현 안 되면 고칠 게 없다)
     ② 시장 평균을 빼면 그 통과가 사라진다
     ③ ★진짜 실력은 안 깎인다★ — 시장 안 신호가 있으면 그대로 남는다(과잉교정 금지)
     ④ 시장이 하나면 값이 ★한 톨도★ 안 변한다(무해성)
     ⑤ 게이트에 값을 대는 자리들이 실제로 시장을 넘기는가
     ⑥ ★파이썬 학습기와 자가 같은가★ — 외부 모델만 관대한 자로 재면 그게 비대칭이다
        (이 저장소가 _importedICz 로 이미 한 번 막은 사고)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

let _s = 20260831;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };

/* 시장 절편만 아는 모델 — 시장 ★안★ 실력은 정확히 0 이다. */
function mkData(bUS, bKR, edge) {
  const p = [], y = [], m = [], N = 20000;
  for (let i = 0; i < N; i++) {
    const us = (i % 2 === 0), b = us ? bUS : bKR;
    m.push(us ? "us" : "kr");
    // edge > 0 이면 ★시장 안에서도★ 순위를 맞힌다(진짜 실력).
    const u = rnd();
    const hit = rnd() < b + (edge > 0 ? (u - 0.5) * edge : 0);
    p.push(b + (edge > 0 ? (u - 0.5) * 0.10 : 0) + (rnd() - 0.5) * 0.004);
    y.push(hit ? 1 : 0);
  }
  return { p, y, m };
}

console.log("① 섞어 재면 ★실력 0★ 이 게이트를 통과하는가 (사고의 재현)");
const F = M.ICGATE ? _num => _num : null;
const floor = 0.012;
{
  for (const [bu, bk] of [[0.55, 0.45], [0.53, 0.47], [0.51, 0.49]]) {
    const d = mkData(bu, bk, 0);
    const pooled = M._icBlockStats(d.p, d.y, 5);
    console.log(`       기저 US ${bu}/KR ${bk} → 섞어 잰 블록IC ${_f(pooled.blockIC)} t ${_f(pooled.t, 2)}`);
    if (bu === 0.55) {
      chk(pooled.blockIC > floor * 3 && pooled.t > 5,
        `섞어 재면 실력 0 인 모델이 블록IC ${_f(pooled.blockIC)} · t ${_f(pooled.t, 2)} 를 받는다(문턱 ${floor} 을 한참 넘는다)`,
        "★사고가 재현되지 않는다 — 이 검사의 전제가 틀렸으므로 고침의 근거부터 다시 봐야 한다★");
    }
  }
}

console.log("\n② 시장 평균을 빼면 그 통과가 사라지는가");
{
  const d = mkData(0.55, 0.45, 0);
  const w = M._icBlockStats(d.p, d.y, 5, null, d.m);
  console.log(`       시장 고정효과 제거 → 블록IC ${_f(w.blockIC)} t ${_f(w.t, 2)} · (섞어 재면 ${_f(w.blockICPooled)} t ${_f(w.tPooled, 2)})`);
  chk(Math.abs(w.blockIC) < floor,
    `실력 0 은 실력 0 으로 나온다(블록IC ${_f(w.blockIC)} < 문턱 ${floor})`,
    `★시장 평균을 빼도 IC ${_f(w.blockIC)} 가 남는다 — 편향이 안 걷혔다★`);
  chk(w.blockICPooled != null && w.tPooled != null,
    "섞어 잰 값도 함께 돌려준다 — 바뀐 폭을 눈으로 볼 수 있다", "섞어 잰 값을 안 남긴다");
  chk(w.mktFixed === true, "시장 고정효과를 실제로 적용했다는 표시가 남는다", "적용 표시가 없다");
}

console.log("\n③ ★진짜 실력은 안 깎이는가★ (과잉교정 금지)");
{
  const d = mkData(0.50, 0.50, 0.35);   // 기저는 같고 ★시장 안★ 순위 실력만 있다
  const pooled = M._icBlockStats(d.p, d.y, 5);
  const w = M._icBlockStats(d.p, d.y, 5, null, d.m);
  console.log(`       시장 안 실력만 있는 모델 — 섞어 ${_f(pooled.blockIC)} / 시장제거 ${_f(w.blockIC)}`);
  chk(w.blockIC > 0.05 && w.blockIC > pooled.blockIC * 0.9,
    `시장 안 신호는 그대로 남는다(${_f(pooled.blockIC)} → ${_f(w.blockIC)})`,
    `★진짜 실력까지 깎였다(${_f(pooled.blockIC)} → ${_f(w.blockIC)}) — 이 자는 쓸 수 없다★`);
}

console.log("\n④ 시장이 하나면 값이 한 톨도 안 변하는가 (무해성)");
{
  const d = mkData(0.52, 0.52, 0.30);
  const one = d.m.map(() => "us");
  const a = M._icBlockStats(d.p, d.y, 5);
  const b = M._icBlockStats(d.p, d.y, 5, null, one);
  chk(Math.abs(_n(a.blockIC) - _n(b.blockIC)) < 1e-12 && Math.abs(_n(a.t) - _n(b.t)) < 1e-12,
    `한 시장뿐이면 종전과 완전히 같다(블록IC ${_f(a.blockIC)} = ${_f(b.blockIC)})`,
    `★한 시장뿐인데 값이 바뀐다(${_f(a.blockIC)} vs ${_f(b.blockIC)}) — 상수를 빼는 일이 값을 바꿀 수는 없다★`);
  // mkeys 를 아예 안 주면 옛 계약 그대로여야 한다(기존 호출자 전부).
  const c = M._icBlockStats(d.p, d.y, 5);
  chk(c.blockICPooled === undefined && Math.abs(_n(c.blockIC) - _n(a.blockIC)) < 1e-12,
    "mkeys 를 안 주면 종전 계약 그대로다(기존 호출자가 안 깨진다)", "mkeys 없는 호출의 동작이 바뀌었다");
}

console.log("\n⑤ 게이트에 값을 대는 자리들이 실제로 시장을 넘기는가");
{
  const want = [
    ["헤드 경합(고르는 자)", /_icBlockStats\(ps, yv, 5, _blkKeys, _mkKeys\)/],
    ["홀드아웃(판정하는 자)", /_icBlockStats\(pv, yv, 5, _blkKeys, _mkKeys\)/],
    ["MEMO 홀드아웃", /_icBlockStats\(pv, yv, 5, null, _mktOK \? mv : null\)/],
    ["전진검증", /_icBlockStats\(pv, yv, 2, null, _mkAny > 1 \? mv : null\)/],
    ["MIND 메타", /_icBlockStats\(_pv, _yv, 5, null, _mvv\)/],
    ["MIND 규칙엔진", /_icBlockStats\(_rp, _ry, 5, null, _rm\)/],
    ["MIND 섀도우", /_icBlockStats\(pv, yv, 5, null, mvv\)/],
    ["전문가 국면표", /_icBlockStats\(c\.p, c\.y, 5, null, c\.m \|\| null\)/]
  ];
  for (const [nm, re] of want)
    chk(re.test(S), `${nm} 이 시장을 넘긴다`, `★${nm} 이 아직 섞어 잰다★`);
  chk(/SELECT id, ts, market, symbol, feat, label, pnl_pct/.test(S),
    "학습 조회가 market 을 함께 읽는다", "market 을 안 읽는다 — 넘길 값이 없다");
  chk(/"SELECT id, ts, market, " \+ _selAt/.test(S),
    "전진검증 조회도 market 을 함께 읽는다", "전진검증이 market 을 안 읽는다");
  chk(/function _mktOfVec\(v\)/.test(S),
    "피처벡터에서 시장을 읽는 규칙이 ★한 곳★ 에 있다(자리마다 다시 적지 않는다)",
    "시장 판별이 여러 곳에 흩어져 있다");
}

console.log("\n⑥ ★파이썬 학습기와 자가 같은가★ (외부 모델만 관대하면 그게 비대칭이다)");
{
  chk(/def _calc_ic_blocks\(pred, y, K=5, mkt=None\)/.test(PY),
    "파이썬 블록 IC 도 시장을 받는다", "★파이썬은 아직 섞어 잰다 — 외부 모델만 부풀린 자로 심사받는다★");
  chk(/_ic_block_fields\(_p_ic, _y_ic, mkt=_m_ic\)/.test(PY), "DNN 이 시장을 넘긴다", "DNN 이 아직 섞어 잰다");
  chk(/_ic_block_fields\(proba_lib, Yva, mkt=_mkt_of_X\(Xva\)\)/.test(PY), "부스터가 시장을 넘긴다", "부스터가 아직 섞어 잰다");
  chk(/_ic_block_fields\(proba, Yva, mkt=_mkt_of_X\(Xva\)\)/.test(PY), "GBDT 가 시장을 넘긴다", "GBDT 가 아직 섞어 잰다");
  chk(/_set_mkt_cols\(featnames\)/.test(PY), "시장 원핫 열 위치를 학습 시작 때 한 번 잡는다", "열 위치를 안 잡는다");

  /* ★같은 데이터에 두 언어를 돌려 값을 맞춰 본다.★ 이 저장소가 변환정합성(convMaxDiff)에
     쓰는 것과 같은 방식이다 — "둘 다 고쳤다" 는 문장이 아니라 숫자로 확인한다. */
  const d = mkData(0.58, 0.42, 0.20);
  const js = M._icBlockStats(d.p, d.y, 5, null, d.m);
  const jsPooled = M._icBlockStats(d.p, d.y, 5);
  const tmp = process.env.TMPDIR || "/tmp";
  const fp = tmp + "/_mkfe_probe.json";
  writeFileSync(fp, JSON.stringify({ p: d.p, y: d.y, m: d.m }));
  const grab = (name) => {
    const i = PY.indexOf("def " + name + "(");
    if (i < 0) return "";
    const rest = PY.slice(i);
    const m2 = /\n(?=def |# =)/.exec(rest.slice(1));
    return m2 ? rest.slice(0, m2.index + 1) : rest;
  };
  const src = grab("_demean_by") + "\n" + grab("_calc_ic_blocks");
  const py = tmp + "/_mkfe_probe.py";
  writeFileSync(py, "import json, numpy as np\n" + src +
    "\nd=json.load(open(" + JSON.stringify(fp) + "))\n" +
    "mk=np.asarray(d['m'],dtype=object)\n" +
    "w=_calc_ic_blocks(d['p'],d['y'],5,mk)\n" +
    "p0=_calc_ic_blocks(d['p'],d['y'],5,None)\n" +
    "print(json.dumps({'w':w[0],'wt':w[2],'p':p0[0],'pt':p0[2]}))\n");
  let out = null;
  try { out = JSON.parse(execFileSync("python3", [py], { encoding: "utf8" }).trim()); }
  catch (e) { chk(false, "", "★파이썬 쪽을 돌려보지 못했다: " + String(e.message).slice(0, 160) + "★"); }
  if (out) {
    /* 블록 t 는 자유도 보정(z 변환)이 워커에만 있으므로 raw t 로 맞춘다 — 블록 IC 는 동일해야 한다. */
    const dIC = Math.abs(_n(js.blockIC) - _n(out.w)), dP = Math.abs(_n(jsPooled.blockIC) - _n(out.p));
    console.log(`       시장제거 — JS ${_f(js.blockIC)} / PY ${out.w.toFixed(5)} (차 ${dIC.toExponential(1)})`);
    console.log(`       섞어재기 — JS ${_f(jsPooled.blockIC)} / PY ${out.p.toFixed(5)} (차 ${dP.toExponential(1)})`);
    chk(dIC < 1e-9 && dP < 1e-9,
      `두 언어가 같은 값을 낸다(최대 차 ${Math.max(dIC, dP).toExponential(1)}) — 외부 모델과 내부 모델이 같은 자로 심사받는다`,
      `★두 언어의 값이 다르다(시장제거 차 ${dIC.toExponential(1)} · 섞어 ${dP.toExponential(1)})★`);
    chk(Math.abs(_n(out.p) - _n(out.w)) > 0.02,
      `파이썬 쪽에서도 두 자의 차이가 실제로 크다(${out.p.toFixed(4)} → ${out.w.toFixed(4)})`,
      "파이썬 쪽 두 자가 거의 같다 — 데이터가 이 계약을 안 물고 있다");
  }
}

function _n(v) { return (v == null || !isFinite(v)) ? 0 : +v; }
function _f(v, k) { return _n(v).toFixed(k == null ? 4 : k); }

console.log(fails === 0 ? "\n✓ 시장 고정효과 IC 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
