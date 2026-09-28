/* ═══════════════════════════════════════════════════════════════════════════
   [V33.428] ★OMNI-NN — 워커 신경망이 학습기 신경망과 같은가★

   학습기(omni.py)는 한 몸통 · 다섯 머리 신경망을 numpy 로 배우고, 기준 채점기
   nn_score_row(double) 로 고정물(tools/fixtures/omni-nn.json)을 만든다. 워커는 그 식을
   JS 로 옮겼다(omniNnScore). 둘이 조용히 갈리면 섀도우 채점이 ★다른 모델★ 을 재게 된다.

     ① 고정물의 모든 행(장타 행 = 장중 칸 결측 포함)에서 워커 로짓 = 기준 로짓 (≤ 1e-12)
     ② 섞기: α=0 인 지평은 나무 그대로(신경망을 계산조차 안 한다) · α>0 은 (1−α)·나무 + α·신경망
     ③ 검증기: 모양이 틀린 신경망 · 범위 밖 α 는 모델째 거절 (대조: 멀쩡한 본문은 통과)
     ④ 배선: 업로드 검증 · 섀도우 채점이 ★같은 섞기 함수★ 를 쓴다(한쪽만 나무로 채점하면 안 된다)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const FX = JSON.parse(readFileSync(new URL("./fixtures/omni-nn.json", import.meta.url), "utf8"));
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 워커 순전파 = 학습기 기준 채점기");
{
  chk(FX.feats.join("|") === [...M.OMNI_FEATS, ...M.OMNI_HORIZONS.map((h) => "hz_" + h), ...M.OMNI_SETUPS.map((s) => "st_" + s)].join("|"),
    "고정물 칸 명세 = 워커 칸 명세 (" + FX.feats.length + "칸)", "★고정물이 다른 칸 명세로 만들어졌다 — 다시 만들 것★");
  let md = 0, nan = 0;
  for (let i = 0; i < FX.rows.length; i++) {
    const z = M.omniNnScore(FX.nn, FX.rows[i], FX.hz[i]);
    const d = Math.abs(z - FX.z[i]);
    if (!(d <= md)) md = d;
    if (FX.rows[i].some((v) => v === null)) nan++;
  }
  chk(md <= 1e-12 && FX.rows.length >= 200, "행 " + FX.rows.length + "(결측 포함 " + nan + ") 최대차 " + md.toExponential(1),
    "★워커 신경망이 학습기와 다르다 — 최대차 " + md + "★");
  chk(nan >= 50, "결측 행 " + nan + " — 결측표시 입력 경로를 실제로 탄다", "★결측 행이 " + nan + "뿐 — 결측표시 경로를 안 본다★");
  const hzs = new Set(FX.hz);
  chk(hzs.size === M.OMNI_HORIZONS.length, "다섯 머리 전부 검사(" + [...hzs].sort().join(",") + ")", "★검사하지 않은 머리가 있다★");
  /* 대조 — 머리를 바꾸면 값이 달라야 한다(머리 선택이 실제로 작동한다) */
  let diff = 0;
  for (let i = 0; i < 20; i++) if (M.omniNnScore(FX.nn, FX.rows[i], (FX.hz[i] + 1) % 5) !== FX.z[i]) diff++;
  chk(diff >= 18, "대조: 다른 머리로 채점하면 값이 바뀐다(" + diff + "/20)", "★머리 번호가 무시된다★");
}

console.log("\n② 섞기 — 지평별 α");
{
  const trees = [{ w: 0.25 }];
  const x = FX.rows[0], hz = FX.hz[0];
  const zn = M.omniNnScore(FX.nn, x, hz);
  const a0 = [0, 0, 0, 0, 0], a1 = [0, 0, 0, 0, 0];
  a1[hz] = 0.3;
  chk(M.omniBlendRaw({ trees, nn: FX.nn, alpha: a0 }, x, hz) === 0.25, "α=0 → 나무 그대로", "★α=0 인데 신경망이 섞였다★");
  chk(M.omniBlendRaw({ trees, nn: FX.nn, alpha: a1 }, x, hz) === (1 - 0.3) * 0.25 + 0.3 * zn,
    "α=0.3 → (1−α)·나무 + α·신경망 (학습기와 같은 식)", "★섞는 식이 학습기와 다르다★");
  chk(M.omniBlendRaw({ trees, nn: null, alpha: null }, x, hz) === 0.25, "신경망 없는 옛 모델 → 나무 그대로", "★옛 모델 채점이 깨졌다★");
}

console.log("\n③ 검증기 — 틀린 신경망은 모델째 거절");
{
  const D = FX.feats.length;
  const ok = M.omniNnValidate(FX.nn, [0, 0.5, 1, 0, 0], D);
  chk(ok === null, "멀쩡한 신경망 · α 통과", "★멀쩡한 본문을 거절했다: " + ok + "★");
  const cl = () => JSON.parse(JSON.stringify(FX.nn));
  const cases = [
    ["α 가 5개가 아니다", cl(), [0.5]],
    ["α 가 1 을 넘는다", cl(), [0, 0, 1.5, 0, 0]],
    ["입력 칸 번호가 범위 밖", Object.assign(cl(), { cols: [...FX.nn.cols.slice(0, -1), D + 3] }), [0, 0, 0, 0, 0]],
    ["척도 0", (() => { const n = cl(); n.sc[0] = 0; return n; })(), [0, 0, 0, 0, 0]],
    ["첫 층 행 수 ≠ 입력 수", (() => { const n = cl(); n.nets[0].W[0].pop(); return n; })(), [0, 0, 0, 0, 0]],
    ["가중치에 NaN", (() => { const n = cl(); n.nets[0].W[1][0][0] = NaN; return n; })(), [0, 0, 0, 0, 0]],
    ["머리 열 수 ≠ 5", (() => { const n = cl(); n.nets[0].Wh = n.nets[0].Wh.map((r) => r.slice(0, 4)); return n; })(), [0, 0, 0, 0, 0]],
    ["결측표시 칸이 범위 밖", Object.assign(cl(), { flags: [9999] }), [0, 0, 0, 0, 0]],
  ];
  for (const [nm, nn, al] of cases) {
    const e = M.omniNnValidate(nn, al, D);
    chk(typeof e === "string" && e.length > 0, "거절: " + nm + " (" + e + ")", "★통과시켰다: " + nm + "★");
  }
}

console.log("\n④ 배선 — 업로드 검증과 섀도우 채점이 같은 식을 쓴다");
{
  const fn = (name) => { const i = S.indexOf("function " + name + "("); return i < 0 ? "" : S.slice(i, S.indexOf("\n}\n", i)); };
  const v = fn("omniValidate"), sh = fn("omniShadowScore");
  chk(/omniBlendRaw\(M, pr\.x, hz\)/.test(v) && /omniNnValidate\(body\.nn, body\.alpha, D\)/.test(v),
    "업로드 검증: 신경망 모양 검사 + probe 를 섞인 식으로 재현", "★업로드 검증이 신경망을 안 본다 — 섞인 probe 를 나무로 재현하면 전부 거절된다★");
  chk(/omniBlendRaw\(M, omniDesign\(/.test(sh) && !/omniScoreRaw\(trees, omniDesign/.test(sh),
    "섀도우 채점: 섞인 식으로 채점(나무만 채점하는 옛 줄 없음)", "★섀도우 채점이 검증한 모델과 다른 식으로 잰다★");
  const imp = S.slice(S.indexOf('path === "/api/omni-import"'), S.indexOf('path === "/api/omni-status"'));
  chk(/nn: undefined/.test(imp) && /delete meta\.nn/.test(imp), "신경망 가중치는 메타(D1)에 안 싣는다 — R2 모델 파일에만",
    "★신경망 가중치가 D1 메타로 들어간다(행 크기 한도)★");
}

console.log("\n⑤ 신경망 보고서는 작게 — 가중치가 섞여 와도 메타(D1)가 부풀지 않는다");
{
  const big = { edgeB: { auc: 0.51 }, export: FX.nn, zHold: new Array(5000).fill(0.1), grid: [{ valAuc: 0.52 }] };
  const r = M._omNnRepSlim(big);
  chk(r && r.edgeB && r.grid && !("export" in r) && !("zHold" in r), "모르는 칸(가중치·홀드아웃 로짓)은 버리고 아는 칸만 남긴다",
    "★가중치가 메타로 샌다★");
  const huge = { grid: new Array(4000).fill({ valAuc: 0.5, cfg: { name: "x".repeat(20) } }) };
  chk(M._omNnRepSlim(huge) === null, "60KB 를 넘으면 통째로 버린다(없다고 말한다)", "★큰 보고서가 그대로 들어간다★");
  chk(M._omNnRepSlim(null) === null && M._omNnRepSlim([1]) === null, "빈 값·배열은 null", "★형식 검사 없음★");
}

console.log("\n⑥ 전진 교차검증 표 — 작게 · 숫자만");
{
  const c = M._omCvSlim({ pick: "G3", folds: 3, cuts: [1, 2, 3], junk: "x".repeat(5000),
    table: [{ name: "G0", why: "지금 구성", folds: [0.51, NaN, 0.52], mean: 0.515, extra: [1, 2, 3] },
            { name: "G3", why: "w".repeat(500), folds: [0.52, 0.53, 0.54], mean: 0.53, wins: 3 }] });
  chk(c && c.pick === "G3" && c.table.length === 2 && c.table[0].folds[1] === null && !("extra" in c.table[0]) &&
      c.table[1].why.length === 80 && !("junk" in c), "모르는 칸 버림 · NaN → null · 설명 80자", "★교차검증 표가 걸러지지 않는다★");
  chk(M._omCvSlim(null) === null && M._omCvSlim({ table: "x" }) === null, "형식이 아니면 null", "★형식 검사 없음★");
}

console.log("\n⑦ 눕힌 세계수 3D — 모든 입력이 뿌리 가닥 중 하나에 · 흰색만 · 떠 있는 선 없음 · 값이 없으면 밝히지 않는다");
{
  const src = readFileSync(new URL("../public/neural-observatory.js", import.meta.url), "utf8");
  const G = {}; new Function("globalThis", "window", src)(G, G);
  const NO = G.NeuralObservatory;
  const names = FX.nn.cols.map((c) => FX.feats[c]).concat(FX.nn.flags.map((j) => "결측:" + FX.feats[FX.nn.cols[j]]));
  const L = (n, sz) => ({ name: n, size: sz, strength: Array.from({ length: sz }, (_, i) => (i % 7) / 7) });
  const nnViz = { layers: [Object.assign(L("입력", names.length), { names }), L("몸통 1", 64), L("몸통 2", 32),
                           { name: "지평 머리", size: 5, names: M.OMNI_HORIZONS, strength: [0.01, null, 0.02, 0.0, 0.03] }],
                  edges: [[[0, 0, 0.5, 1], [3, 5, 1, -1]], [[1, 2, 0.3, 1]], [[4, 0, 0.9, 1], [2, 4, 0.2, -1]]] };
  const d = { horizons: M.OMNI_HORIZONS, feats: M.OMNI_FEATS, nTrees: 73, seeds: 4, alpha: [0, 0, 0.5, 0, 0], nnViz,
              groups: [{ name: "일봉(장타)", share: 0.3 }, { name: "5분봉(단타)", share: 0.2 }],
              heads: M.OMNI_HORIZONS.map((h) => ({ hz: h, auc: 0.51 })) };
  for (const [tag, dd] of [["신경망 있음", d], ["신경망 없음(옛 모델)", Object.assign({}, d, { nnViz: null, alpha: null })]]) {
    const sc = NO.omniScene(dd, { spread: 1 });
    const roots = sc.groups.filter((g) => sc.nodes[g.ids[0]] && sc.nodes[g.ids[0]].kind === "input");
    const inputs = sc.nodes.filter((n) => n.kind === "input");
    const want = dd.nnViz ? names.length : M.OMNI_FEATS.length;
    const dangling = sc.edges.filter((e) => !sc.nodes[e.a] || !sc.nodes[e.b]).length;
    const nonfinite = sc.nodes.filter((n) => ![n.x, n.y, n.z].every(Number.isFinite)).length;
    const badV = sc.edges.filter((e) => !(e.v >= 0 && e.v <= 1)).length;
    chk(inputs.length === want && roots.reduce((a, g) => a + g.count, 0) === want,
      tag + ": 입력 " + inputs.length + "칸 전부 뿌리 " + roots.length + "가닥에 실렸다(" + roots.map((g) => g.count).join("/") + ")",
      "★" + tag + ": 뿌리에 안 실린 입력이 있다(" + inputs.length + " ≠ " + want + ")★");
    chk(dangling === 0 && nonfinite === 0 && badV === 0, tag + ": 떠 있는 선 0 · 좌표 전부 유한 · 선 세기 0~1",
      "★" + tag + ": 떠 있는 선 " + dangling + " · 비유한 좌표 " + nonfinite + " · 범위 밖 세기 " + badV + "★");
    const invented = sc.nodes.filter((n) => n.label === "수관 · 나무 숲" && n.v != null).length +
                     (dd.nnViz ? 0 : sc.nodes.filter((n) => n.kind === "input" && n.v != null).length);
    chk(invented === 0, tag + ": 값이 없는 곳(숲 잎 · 신경망 없는 입력)은 밝히지 않는다", "★값 없는 점 " + invented + "개를 밝혔다(지어낸 세기)★");
    const tips = sc.nodes.filter((n) => /^최종 확률/.test(n.name));
    chk(tips.length === 5, tag + ": 끝눈(지평별 최종 확률) 5개", "★끝눈 " + tips.length + "개★");
    chk(!sc.nodes.some((n) => n.rgb) && !/rgba\('\s*\+/.test(src) && !/샘|이그드라실|황금 사과/.test(src),
      tag + ": 흰색만 · 신화 이름 없음(사용자 지시)", "★색이나 신화 이름이 남아 있다★");
    const xs = (lbl) => sc.nodes.filter((n) => lbl(n)).map((n) => n.x);
    const mean = (a) => a.reduce((p, q) => p + q, 0) / Math.max(1, a.length);
    chk(mean(xs((n) => n.kind === "input")) < mean(xs((n) => /^최종 확률/.test(n.name))),
      tag + ": 옆으로 눕혔다 — 뿌리(왼쪽) → 끝눈(오른쪽)", "★좌→우 흐름이 아니다★");
  }
  const sc = NO.omniScene(d, { spread: 1 });
  /* [V33.430c] ★선이 겹쳐 보였다(사용자)★ — 평소 보이는 선(다발)은 적어야 하고, 뉴런별 실제 선은 누를 때만 */
  const visible = sc.edges.filter((e) => !e.detail && !e.strand);
  const detail = sc.edges.filter((e) => e.detail);
  const nnLines = d.nnViz.edges.reduce((a, es) => a + es.length, 0);
  chk(visible.length <= 40 && detail.length >= nnLines && sc.edges.filter((e) => e.measured && !e.detail && !e.bundle).length === 0,
    "평소 보이는 선 " + visible.length + "개(다발) · 뉴런별 실제 선 " + detail.length + "개는 누를 때만",
    "★선이 너무 많이 보인다(" + visible.length + ") 또는 뉴런별 선이 늘 보인다★");
  const eng = src.slice(src.indexOf("function draw("), src.indexOf("function tick("));
  chk(/if\(e\.detail&&!focus\)continue;/.test(eng), "그리기: detail 선은 누른 점에 닿을 때만 그린다", "★그리기가 detail 을 늘 그린다★");
  const nullHead = sc.nodes.find((n) => n.name === "가지 · 60분 머리");
  chk(nullHead && nullHead.v === null, "홀드아웃을 못 잰 머리는 흐리게(v=null)", "★못 잰 머리에 세기를 지어냈다★");
}

console.log(fails ? "\n✗ OMNI-NN 검사 실패 " + fails : "\n✓ OMNI-NN 검사 통과");
process.exit(fails ? 1 : 0);
