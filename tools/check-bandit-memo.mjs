/* ═══════════════════════════════════════════════════════════════════════════
   [V33.273] 미달 모델 둘을 실제로 끌어올렸는지 — 문장이 아니라 수치로 확인한다.

   ■ 무엇이 미달이었나 (2026-08-29 야간 실측)
       [BANDIT] baseAcc 47.6% | 컨텍스트제외 67개 → ★밴딧 미가동(0차원 < 2)★
       [MEMO]   원형 128개(표본 14,827) valAcc 49.6% IC 0.0130 t 0.67 → 합류 보류
     둘 다 "표본이 덜 찼다" 가 아니다. 밴딧은 켜진 적이 없고, MEMO 는 표본 1만 4천에
     정확도가 기저 아래다. 원인은 같은 곳에 있었다 — ★잡음축이 자를 지배한다.★

   ■ 고친 방식은 문턱 완화가 아니다
     밴딧: 낱개 순열이 상관 아래에서 붕괴하므로 ★군집을 통째로 섞어★ 다시 잰다.
           dropFloor 는 그대로다. 못 넘으면 종전처럼 끈다.
     MEMO: 축마다 라벨 상관 |r| 로 축을 눌러 거리를 잰다. 원형 수도 문턱도 그대로다.

   ■ 이 검사가 무는 것
     ① 상관 아래에서 낱개 검정은 붕괴하고 군집 검정은 안 붕괴한다(몬테카를로 재현)
     ② 진짜 무신호에는 군집 검정도 침묵한다 — 위양성 게이트
     ③ 붕괴 시 밴딧 야간검정이 군집 경로로 넘어가 컨텍스트를 실제로 만든다
     ④ MEMO 의 자는 ★학습구간에서만★ 만들어진다(홀드아웃 누출 없음)
     ⑤ 추론이 학습과 같은 공간에서 잰다 — 자를 떼면 성적이 무너진다(변이)
     ⑥ ord 는 조기중단 순서일 뿐 결과를 안 바꾼다
     ⑦ 잡음 72축 + 신호 3축에서 MEMO 가 실제로 신호를 찾는다
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const D = M.LUXML.featNames.length;

/* 결정적 난수 — 검사가 날마다 다른 답을 내면 그건 게이트가 아니다. */
let _s = 20260829;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pearson = (a, b) => {
  const n = a.length; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; sa += x * x; sb += y * y; }
  return (sa > 0 && sb > 0) ? sab / Math.sqrt(sa * sb) : 0;
};

/* ── 상관 블록 데이터 ────────────────────────────────────────────────────
   V33.133 이 몬테카를로로 재현한 그 조건을 그대로 만든다: 진짜 신호가 있는데도
   블록상관 rho≥0.6 이면 낱개 순열이 전부 문턱 미달이 된다.
   블록 안 축들은 같은 잠재요인 + 약한 개별잡음 → 서로 대체 가능하다.            */
function makeBlocks({ n, nBlocks, blockSize, signalBlocks, beta }) {
  const dim = nBlocks * blockSize;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const z = new Array(dim);
    let lin = 0;
    for (let b = 0; b < nBlocks; b++) {
      const latent = gauss();
      for (let k = 0; k < blockSize; k++) {
        // rho ≈ 0.94 — 블록 안 축들은 서로를 거의 완전히 대신할 수 있다.
        //   한 축만 섞어도 나머지 9개가 같은 잠재요인을 들고 있어 정확도가 안 떨어진다.
        z[b * blockSize + k] = 0.97 * latent + 0.243 * gauss();
      }
      if (signalBlocks.includes(b)) lin += beta * latent;
    }
    const y = (1 / (1 + Math.exp(-lin)) > rnd()) ? 1 : 0;
    rows.push({ z, y });
  }
  return { rows, dim };
}

console.log("① 상관 아래 — 낱개는 붕괴하고 군집은 붕괴하지 않는가 (V33.133 실험 재현)");
let grpFound = 0;
{
  const nB = 5, bs = 12, beta = 1.6;
  const { rows, dim } = makeBlocks({ n: 8000, nBlocks: nB, blockSize: bs, signalBlocks: [0, 2], beta });
  // 진짜 계수를 준다(L1 이 살린 상태를 흉내) — 신호 블록의 축들이 실제로 w≠0 이다.
  const w = new Array(dim).fill(0);
  for (let b = 0; b < nB; b++) for (let k = 0; k < bs; k++) {
    w[b * bs + k] = ([0, 2].includes(b) ? beta / bs : 0.02) ;
  }
  const per = M.mlPermutationTest(rows, w, 0);
  const perAlive = per.features.filter(f => f.signal).length;
  const grp = M.mlGroupedPermutationTest(rows, w, 0, null);
  const sig = (grp.clusters || []).filter(c => c.signal);
  grpFound = sig.length;

  console.log(`       낱개 유의 ${perAlive}/${per.features.length} · 군집 ${grp.clusters.length}개 중 신호 ${sig.length}개`
    + ` [상위: ${grp.clusters.slice(0, 3).map(c => `x${c.size} drop ${c.drop.toFixed(4)}`).join(" / ")}]`);

  /* 낱개 검정이 ★군집 검정보다 압도적으로 못 본다★ 는 것이 요점이다.
     "정확히 0개" 를 요구하면 검증행 잡음(정확도 표준오차 ≈ 0.5%p vs 문턱 0.3%p)에 걸려
     검사가 날마다 흔들린다 — 재는 것은 두 자의 ★차이★ 다. */
  const bestPer = Math.max(...per.features.map(f => f.drop));
  const bestGrp = Math.max(...grp.clusters.map(c => c.drop));
  chk(bestGrp > bestPer * 10,
    `군집이 낱개보다 신호를 압도적으로 크게 본다(최대 drop ${bestGrp.toFixed(4)} vs ${bestPer.toFixed(4)}, ${(bestGrp / Math.max(bestPer, 1e-9)).toFixed(0)}배)`,
    `군집이 낱개보다 크게 못 본다(${bestGrp.toFixed(4)} vs ${bestPer.toFixed(4)}) — 고침의 근거가 없다`);
  chk(bestPer < 0.01,
    `낱개 최대 drop 이 ${bestPer.toFixed(4)} — 진짜 신호가 있는데도 거의 안 보인다(붕괴 재현)`,
    `낱개가 신호를 충분히 본다(${bestPer.toFixed(4)}) — 이 실험이 V33.133 조건을 재현하지 못한다`);
  chk(sig.length >= M.LUXBANDIT.minContextDim,
    `군집 순열은 신호를 찾는다(신호 군집 ${sig.length}개 ≥ ${M.LUXBANDIT.minContextDim}) — 밴딧이 켜진다`,
    `군집 순열도 신호를 못 찾았다(${sig.length}개) — 고침이 작동하지 않는다`);
  chk(grp.clusters.length < dim,
    `상관 축들이 실제로 묶였다(${dim}축 → ${grp.clusters.length}군집)`,
    `군집화가 안 됐다(${grp.clusters.length}군집 = ${dim}축) — 낱개 검정과 다를 게 없다`);
  // 신호 군집의 대표는 진짜 신호 블록에서 나와야 한다.
  const okRep = sig.every(c => w[c.rep] > 0.05);
  chk(okRep, "신호 군집의 대표가 실제 신호 블록에서 나왔다", "신호 군집 대표가 잡음 블록을 가리킨다");
}

console.log("\n② 진짜 무신호에는 군집 검정도 침묵하는가 (위양성 게이트)");
{
  const { rows, dim } = makeBlocks({ n: 3000, nBlocks: 6, blockSize: 10, signalBlocks: [], beta: 0 });
  const w = new Array(dim).fill(0.1);
  const grp = M.mlGroupedPermutationTest(rows, w, 0, null);
  const sig = (grp.clusters || []).filter(c => c.signal);
  console.log(`       무신호 데이터 → 신호 군집 ${sig.length}/${grp.clusters.length}`);
  chk(sig.length < M.LUXBANDIT.minContextDim,
    `신호가 없으면 군집 검정도 문턱을 안 넘는다(${sig.length}개) — 켜야 할 때만 켠다`,
    `★위양성★ 무신호인데 신호 군집이 ${sig.length}개 — 잡음으로 사이즈를 흔들게 된다`);
}

console.log("\n③ 야간검정이 붕괴를 감지해 군집 경로로 실제로 넘어가는가");
{
  chk(/mlGroupedPermutationTest\(val, model\.w, model\.b/.test(code),
    "mlBanditNoiseNightly 가 붕괴 시 군집검정을 부른다", "야간검정이 군집검정을 안 부른다 — 배선이 없다");
  chk(/if \(_off && test\.features\.length >= LUXBANDIT\.minContextDim\)/.test(code),
    "군집검정은 ★낱개가 붕괴했을 때만★ 돈다(평소 예산 0)", "군집검정 조건이 붕괴 감지와 안 묶여 있다");
  chk(/result\.mode = "grouped"/.test(code) && /result\.groupTest = \{/.test(code),
    "어느 자로 판정했는지 기록에 남는다(mode·groupTest)", "판정 경로가 기록에 안 남는다 — 다음에 또 추측하게 된다");
  // ★문턱은 그대로여야 한다★ — 통과시키려고 낮춘 흔적이 있으면 이 고침은 무효다.
  chk(/dropFloor: 0\.003/.test(code), "dropFloor 는 0.003 그대로다(완화 없음)",
    "★dropFloor 가 바뀌었다 — 검정을 고친 게 아니라 문턱을 낮춘 것이다★");
  chk(/minContextDim: 2/.test(code), "minContextDim 은 2 그대로다(완화 없음)", "minContextDim 이 바뀌었다 — 완화다");
  // 컨텍스트 조립이 군집 대표만 남긴 excludedIdx 를 그대로 쓰는지 — 끝단까지 이어지는가.
  const w = new Array(D).fill(0); [3, 17, 40, 41].forEach(j => { w[j] = 0.5; });
  const model = { w, mean: new Array(D).fill(0), std: new Array(D).fill(1) };
  const ctx = M.mlBanditContext(model, { excludedIdx: [41] }, new Array(D).fill(1));
  chk(ctx && ctx.idxs.length === 3 && ctx.idxs.indexOf(41) === -1,
    `군집 대표만 남긴 제외목록이 컨텍스트에 그대로 반영된다(차원 ${ctx ? ctx.idxs.length : 0})`,
    "제외목록이 컨텍스트에 반영되지 않는다 — 밴딧이 잡음축을 계속 본다");
}

console.log("\n④~⑦ MEMO — 잡음 72축 + 신호 3축 데이터로 실제 학습시켜 본다");
{
  const SIG = [3, 17, 40];
  const N = 5600;
  const day = 86400000;
  const t0 = Date.parse("2024-01-01T00:00:00Z");
  const rows = [];
  for (let i = 0; i < N; i++) {
    const f = new Array(D);
    for (let j = 0; j < D; j++) f[j] = gauss();
    // 신호는 세 축에만 있다 — 나머지 72축은 순수 잡음이다(운영의 '유의 피처 0/67' 을 흉내).
    const lin = 1.1 * f[SIG[0]] - 0.9 * f[SIG[1]] + 0.8 * f[SIG[2]];
    const pnl = lin + 0.9 * gauss();
    rows.push({ id: i + 1, ts: t0 + i * day, feat: JSON.stringify(f), label: pnl > 0 ? 1 : 0, pnl_pct: +pnl.toFixed(4) });
  }
  rows.reverse();   // 쿼리는 ORDER BY ts DESC — 최신이 앞이다

  const st = new Map();
  const DB = {
    prepare(sql) {
      const q = { args: [] };
      q.bind = function () { q.args = Array.from(arguments); return q; };
      /* 학습기는 파싱이 끝난 행을 raw[i]=null 로 즉시 놓아준다(V33.233 메모리 규율).
         스텁이 같은 배열을 그대로 주면 ★검사의 원본이 파괴된다★ — 사본을 준다. */
      q.all = async () => ({ results: /FROM ml_samples/.test(sql) ? rows.slice() : [] });
      q.first = async () => {
        if (/SELECT v FROM state/.test(sql)) { const v = st.get(q.args[0]); return v == null ? null : { v }; }
        return null;
      };
      q.run = async () => { if (/INSERT INTO state/.test(sql)) st.set(q.args[0], q.args[1]); return {}; };
      return q;
    }
  };

  const t0ms = Date.now();
  const msg = await M.memoTrainNightly(DB);
  console.log("       " + String(msg).slice(0, 190));
  console.log(`       (학습 ${((Date.now() - t0ms) / 1000).toFixed(1)}초)`);

  const model = JSON.parse(st.get("memo_model") || "null");
  chk(!!(model && Array.isArray(model.protos) && model.protos.length >= 8),
    `학습이 끝나 원형이 만들어졌다(${model ? model.protos.length : 0}개)`, "학습이 원형을 못 만들었다: " + msg);

  if (model) {
    console.log("\n④ 자(scale)가 학습구간에서만 만들어졌는가 — 홀드아웃 누출");
    {
      chk(Array.isArray(model.scale) && model.scale.length === D,
        "자가 모델에 실려 있다(학습·추론이 같은 공간을 쓴다는 증거)", "모델에 scale 이 없다");
      // 코드가 홀드아웃 구간(nvalStart 이후)을 자 계산에 못 쓰게 되어 있는지 — 루프 상한이 ntr 인가.
      const blk = code.split("const scale = new Array(D).fill(1);")[1] || "";
      const seg = blk.split("for (let i = 0; i < N; i++) { const z = Z[i];")[0] || "";
      chk(/for \(let i = 0; i < ntr; i\+\+\)/.test(seg) && !/nvalStart|nval\b/.test(seg),
        "상관 루프가 ntr(퍼징된 학습 끝)까지만 돈다 — 홀드아웃을 한 번도 안 본다",
        "★자 계산이 홀드아웃을 본다 — 그러면 홀드아웃 점수는 더 이상 증거가 아니다★");
    }

    console.log("\n⑦ 자가 신호축을 살리고 잡음축을 죽였는가");
    {
      const live = model.scale.filter(v => v >= 0.2).length;
      const sigScale = SIG.map(j => model.scale[j]);
      const noiseMax = Math.max(...model.scale.filter((_, j) => !SIG.includes(j)));
      console.log(`       유효축 ${live}/${D} · 신호축 가중 [${sigScale.map(v => v.toFixed(2)).join(", ")}] · 잡음축 최대 ${noiseMax.toFixed(2)}`);
      chk(live < D * 0.5, `자가 축 절반 이상을 눌러 껐다(유효 ${live}/${D})`,
        `자가 거의 아무 축도 안 껐다(유효 ${live}/${D}) — 등가중과 다를 게 없다`);
      chk(sigScale.every(v => v > noiseMax * 0.9),
        "신호축 셋이 모든 잡음축보다 무겁다 — 이웃을 신호가 정한다",
        `신호축이 잡음축에 밀린다(신호 ${Math.min(...sigScale).toFixed(2)} vs 잡음 ${noiseMax.toFixed(2)})`);
    }

    // 홀드아웃 재채점 — 학습이 남긴 valIC 와 별개로 검사가 직접 잰다.
    const N2 = rows.length, nval = Math.max(200, Math.floor(N2 * 0.2));
    const chrono = rows.slice().reverse();
    const hold = chrono.slice(N2 - nval);
    const scoreWith = (m) => {
      const p = [], y = [];
      for (const r of hold) {
        const v = JSON.parse(r.feat);
        const s = M.memoScore(m, v);
        if (s == null) continue;
        p.push(s); y.push(r.pnl_pct > 0 ? 1 : 0);
      }
      return { ic: pearson(p, y), n: p.length,
               acc: p.reduce((a, s, i) => a + ((s >= 0.5 ? 1 : 0) === y[i] ? 1 : 0), 0) / p.length };
    };

    console.log("\n⑤ 추론이 학습과 같은 공간에서 재는가 (자가 이웃 선택을 뒤집는 최소 사례)");
    {
      /* IC 로는 이 계약을 못 잰다 — 원형은 이미 눌린 공간에 찍혀 있어, 질의점의 자만 떼면
         잡음축 거리항이 모든 원형에 거의 똑같이 더해져 ★순위가 안 바뀐다★(실측 0.7216 vs 0.7254).
         그래서 자가 ★실제로 이웃을 뒤집는★ 최소 구성을 만들어 계약 자체를 결정적으로 확인한다.
           자 적용: 0번축이 1.0, 1번축이 0.1 → A(0번축이 같은 원형)가 가깝다
           자 제거: 1번축이 제 크기로 살아나 → B(1번축이 같은 원형)가 가깝다              */
      const mk = (arr) => { const a = new Array(D).fill(0); arr.forEach(([j, v]) => { a[j] = v; }); return a; };
      const probe = {
        mean: new Array(D).fill(0), std: new Array(D).fill(1),
        scale: mk([[0, 1], [1, 0.1]]),
        protos: [{ c: mk([[0, 1.0]]), p: 0.9, n: 100 }, { c: mk([[1, 0.3]]), p: 0.1, n: 100 }]
      };
      const q = mk([[0, 1], [1, 3]]);
      const pOn = M.memoScore(probe, q);
      const pOff = M.memoScore(Object.assign({}, probe, { scale: null, ord: null }), q);
      console.log(`       자 적용 → ${pOn.toFixed(4)} (A 쪽) · 자 제거 → ${pOff.toFixed(4)} (B 쪽)`);
      chk(pOn > pOff + 0.1,
        `자를 떼면 다른 이웃이 뽑힌다(${pOn.toFixed(4)} → ${pOff.toFixed(4)}) — memoScore 가 자를 실제로 적용한다`,
        `★자를 떼도 같은 답이다(${pOn.toFixed(4)} vs ${pOff.toFixed(4)}) — memoScore 가 자를 무시하고 있다★`);
      chk(M.memoScore(Object.assign({}, probe, { scale: undefined }), q) != null,
        "자가 없는 구 모델도 예외 없이 채점된다(전진검증이 어제 모델을 본다)", "구 모델 채점이 깨진다");

      // 그리고 결과 — 잡음 72축 속에서 실제로 신호를 찾았는가.
      const withS = scoreWith(model);
      console.log(`       홀드아웃 IC ${withS.ic.toFixed(4)} · 정확도 ${(withS.acc * 100).toFixed(1)}% (n${withS.n})`);
      chk(withS.ic > 0.15,
        `잡음 ${D - 3}축 속에서 MEMO 가 신호를 찾았다(홀드아웃 IC ${withS.ic.toFixed(4)})`,
        `홀드아웃 IC ${withS.ic.toFixed(4)} — 신호 3축이 있는데도 못 찾는다`);
      chk(withS.acc > 0.55,
        `홀드아웃 정확도 ${(withS.acc * 100).toFixed(1)}% — 동전던지기가 아니다`,
        `홀드아웃 정확도 ${(withS.acc * 100).toFixed(1)}% — 여전히 동전던지기다`);
    }

    console.log("\n⑥ ord 는 조기중단 순서일 뿐 결과를 안 바꾸는가 (합은 순서 무관)");
    {
      const a = scoreWith(model);
      const shuffled = model.ord.slice().reverse();
      const b = scoreWith(Object.assign({}, model, { ord: shuffled }));
      chk(Math.abs(a.ic - b.ic) < 1e-9,
        `ord 를 뒤집어도 IC 가 같다(${a.ic.toFixed(6)}) — 순서는 속도만 바꾼다`,
        `★ord 가 결과를 바꾼다(${a.ic.toFixed(6)} vs ${b.ic.toFixed(6)}) — 조기중단이 답을 훼손한다★`);
      chk(/const j = ord\[q\]/.test(code) && /const j = _ord \? _ord\[q\] : q/.test(code),
        "학습·추론 두 거리 루프가 같은 순서 규약을 쓴다", "거리 루프 하나가 옛 순서로 돈다");
    }
  }
}

console.log("\n⑧ 완화가 아니라 개선인지 — 문턱·원형 수가 그대로인가");
{
  chk(M.MEMOML.K === 128 && M.MEMOML.neighbors === 8,
    "MEMO 원형 128·이웃 8 그대로(수를 늘려 맞춘 게 아니다)", "MEMO 원형/이웃 수가 바뀌었다");
  chk(M.MEMOML.icFloor === 0.012, "MEMO icFloor 0.012 그대로(게이트 완화 없음)", "★MEMO icFloor 가 완화됐다★");
  chk(M.MEMOML.minTrainSamples === 4000, "MEMO 최소표본 4000 그대로", "MEMO 최소표본이 낮아졌다");
  chk(M.LUXNOISE.dropFloor === 0.003 && M.LUXBANDIT.minContextDim === 2,
    "밴딧 문턱 둘 다 그대로", "★밴딧 문턱이 완화됐다★");
}

console.log(fails === 0 ? "\n✓ 밴딧 상관강건 검정 · MEMO 가중거리 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
