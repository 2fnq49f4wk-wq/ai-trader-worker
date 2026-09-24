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

console.log(fails ? "\n✗ OMNI-NN 검사 실패 " + fails : "\n✓ OMNI-NN 검사 통과");
process.exit(fails ? 1 : 0);
