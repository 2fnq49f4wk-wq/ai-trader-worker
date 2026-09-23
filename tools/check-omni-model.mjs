/* ═══════════════════════════════════════════════════════════════════════════
   [V33.420] ★OMNI 모델 정합★ — LightGBM 이 낸 값 = 파이썬 기준 채점기 = 워커 JS 채점기

   피처 정합(check-omni-parity)이 "같은 봉 → 같은 입력" 을 지킨다면, 이 검사는
   "같은 입력 → 같은 출력" 을 지킨다. 둘이 합쳐져야 학습 때 잰 성적이 운영의 성적이다.

   고정물(tools/fixtures/omni-model.json)은 trainer/modal/omni_selftest.py --fixture 로 만든다:
   합성 시장에서 ★실제 LightGBM★ 으로 학습한 나무 + 행 400(장타 행은 장중 칸이 NaN · 결측/0 을
   억지로 넣은 행 포함) + lgb.predict(raw_score=True) 값. 여기선 LightGBM 없이 그 값과 비교한다.

   그리고 업로드 관문(omniValidate)이 ★틀린 모델을 실제로 거부하는지★ 를 돌려 본다 —
   문턱 하나를 바꾼 나무, 다른 피처 명세, 다른 상수, probe 부족.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + (bad || ok)); fails++; } };

const FX = JSON.parse(readFileSync(join(root, "tools/fixtures/omni-model.json"), "utf8"));
console.log(`\n■ 고정물 — 나무 ${FX.trees.length} · 행 ${FX.rows.length} · NaN 행 ${FX.nanRows}`);
chk(FX.feats.join("|") === M.OMNI_MODEL_FEATS.join("|"), `고정물 피처 명세 = 워커 OMNI_MODEL_FEATS (${M.OMNI_MODEL_FEATS.length}칸)`,
    "고정물 피처 명세가 워커와 다르다 — 고정물을 다시 만들 것");
chk(FX.rows.length >= 300 && FX.nanRows >= 100, `검사 행이 충분하고 NaN 행을 포함한다 (${FX.rows.length} · NaN ${FX.nanRows})`);
/* [V33.423] 시드 앙상블 — 고정물의 잎에는 1/시드수 가 먹여져 있다(export_model 의 유일한 손질).
   ※ export_model 자체(배수를 만드는 쪽)는 LightGBM 이 있어야 돌므로 여기서 못 본다 —
     그건 omni_selftest 의 앙상블 정합이 잡는다(Modal 배포 게이트에서 돈다). 역할을 나눈다. */
chk(typeof FX.scale === "number" && FX.scale > 0 && FX.scale <= 1,
  `고정물이 앙상블 배수(1/시드수 = ${FX.scale})를 싣는다`,
  "고정물에 앙상블 배수가 없다 — 변환을 검사할 수 없다");

/* 고정물 나무가 결측 가지를 실제로 밟는가 — 안 밟으면 NaN 규칙을 바꿔도 이 검사가 모른다 */
const cnt = { mt0: 0, mt2: 0, dl0: 0, dl1: 0 };
(function walk(ts) { for (const t of ts) { const st = [t]; while (st.length) { const n = st.pop(); if (n.w !== undefined) continue;
  if (n.mt === 0) cnt.mt0++; if (n.mt === 2) cnt.mt2++; if (n.dl) cnt.dl1++; else cnt.dl0++; st.push(n.l, n.r); } } })(FX.trees);
chk(cnt.mt0 > 0 && cnt.mt2 > 0 && cnt.dl0 > 0 && cnt.dl1 > 0,
    `나무가 결측 규칙 네 경우를 다 가진다 (None ${cnt.mt0} · NaN ${cnt.mt2} · 기본왼쪽 ${cnt.dl1} · 기본오른쪽 ${cnt.dl0})`);

/* ① 워커 JS 채점기 = LightGBM */
let mdJs = 0, nanHit = 0;
FX.rows.forEach((x, k) => {
  const d = Math.abs(M.omniScoreRaw(FX.trees, x) - FX.raw[k]);
  if (!(d <= mdJs)) mdJs = d;
});
chk(mdJs <= 1e-9, `워커 omniScoreRaw = LightGBM raw (최대 오차 ${mdJs.toExponential(2)}, 400행)`,
    `워커 채점기가 LightGBM 과 다르다 (최대 오차 ${mdJs})`);
/* 경로가 실제로 NaN 가지를 탔는가 — 같은 행의 NaN 을 0 으로 바꾸면 값이 달라지는 행이 있어야 한다 */
FX.rows.forEach((x) => {
  if (!x.some((v) => v === null)) return;
  const z = x.map((v) => (v === null ? 0 : v));
  if (Math.abs(M.omniScoreRaw(FX.trees, x) - M.omniScoreRaw(FX.trees, z)) > 1e-12) nanHit++;
});
chk(nanHit >= 20, `NaN 과 0 을 다르게 다루는 행이 실제로 있다 (${nanHit}행) — 결측 규칙이 검사된다`);

/* ② 파이썬 기준 채점기 = LightGBM (그리고 명세·설계가 워커와 같다) */
const py = String.raw`
import json, sys
sys.path.insert(0, sys.argv[1])
import omni
fx = json.load(open(sys.argv[2]))
md = 0.0
for x, r in zip(fx["rows"], fx["raw"]):
    xx = [float("nan") if v is None else v for v in x]
    md = max(md, abs(omni.score_raw(fx["trees"], xx) - r))
# [V33.423] 시드 앙상블 — 고정물의 잎은 1/S 가 먹여져 있다(export_model 이 하는 유일한 손질).
_sc = fx.get("scale", 1.0)
conv = [omni._scale_leaves(omni.export_tree(t), _sc) for t in fx.get("lgbDump", [])]
des = [omni.design_row([0.1 * k for k in range(40)], s, h) for s in range(7) for h in range(5)]
print(json.dumps({"md": md, "feats": omni.MODEL_FEATS, "des": des, "conv": conv,
                  "consts": {"sess": omni.SESS_MIN, "openUs": omni.OPEN_MIN["us"], "openKr": omni.OPEN_MIN["kr"],
                             "hLook": omni.H_LOOKBACK, "dLook": omni.D_LOOKBACK, "base": omni.BASE_SEC}}))
`;
let P = null;
try {
  P = JSON.parse(execFileSync("python3", ["-c", py, join(root, "trainer/modal"), join(root, "tools/fixtures/omni-model.json")],
                              { encoding: "utf8", maxBuffer: 64 << 20 }));
} catch (e) { chk(false, "", "파이썬 기준 구현을 돌리지 못했다: " + (e && e.message)); }
if (P) {
  chk(P.md <= 1e-9, `파이썬 score_tree = LightGBM raw (최대 오차 ${Number(P.md).toExponential(2)})`,
      `파이썬 기준 채점기가 LightGBM 과 다르다 (${P.md})`);
  chk(P.feats.join("|") === M.OMNI_MODEL_FEATS.join("|"), "파이썬 MODEL_FEATS = 워커 OMNI_MODEL_FEATS");
  let desOk = true, k = 0;
  for (let s = 0; s < 7; s++) for (let h = 0; h < 5; h++) {
    const js = M.omniDesign(Array.from({ length: 40 }, (_, q) => 0.1 * q), s, h);
    if (JSON.stringify(js) !== JSON.stringify(P.des[k++])) desOk = false;
  }
  chk(desOk, "입력 설계(피처 40 + 지평 원핫 5 + 매매법 원핫 7)가 두 쪽에서 같다 — 35 조합 전부");
  chk(P.conv.length >= 5 && JSON.stringify(P.conv) === JSON.stringify(FX.trees.slice(0, P.conv.length)),
      `변환기 export_tree(LightGBM 원본 덤프 ${P.conv.length}그루) = 고정물 나무 — 결측 규칙·기본방향을 옮기다 바꾸지 않는다`,
      "export_tree 가 LightGBM 덤프를 다르게 옮긴다(결측 규칙·기본방향·문턱)");
  chk(Object.keys(P.consts).every((q) => P.consts[q] === M.OMNI_CONSTS[q]), "업로드가 싣는 상수 = 워커 OMNI_CONSTS");
}

/* ②-b 경계 — 고정물은 ★문턱과 정확히 같은 값★ 과 ★Zero 결측 규칙★ 을 거의 안 지난다
   (LightGBM 문턱은 두 값의 중간점이고, zero_as_missing 을 안 쓰니 mt=1 이 안 나온다).
   그래서 손으로 만든 한 마디 나무로 모든 조합을 두 구현에 돌려 같은지 본다:
   결측규칙 3 × 기본방향 2 × 문턱 3 × 입력 8(NaN · 0 · ±1e-36 · 문턱 그 자체 · 문턱±) = 144 */
{
  const cases = [];
  for (const mt of [0, 1, 2]) for (const dl of [0, 1]) for (const t of [-0.5, 0, 0.5]) {
    for (const v of [null, 0, 1e-36, -1e-36, t, t - 1e-12, t + 1e-12, 1]) cases.push({ mt, dl, t, v });
  }
  const tree = (c) => ({ f: 0, t: c.t, dl: c.dl, mt: c.mt, l: { w: -1 }, r: { w: 1 } });
  const js = cases.map((c) => M.omniScoreTree(tree(c), [c.v]));
  const pyE = String.raw`
import json, sys
sys.path.insert(0, sys.argv[1])
import omni
cs = json.loads(sys.stdin.read())
out = []
for c in cs:
    tr = {"f": 0, "t": c["t"], "dl": c["dl"], "mt": c["mt"], "l": {"w": -1.0}, "r": {"w": 1.0}}
    out.append(omni.score_tree(tr, [float("nan") if c["v"] is None else c["v"]]))
print(json.dumps(out))
`;
  let pyv = null;
  try { pyv = JSON.parse(execFileSync("python3", ["-c", pyE, join(root, "trainer/modal")], { input: JSON.stringify(cases), encoding: "utf8" })); }
  catch (e) { chk(false, "", "경계 검사를 파이썬에서 못 돌렸다: " + (e && e.message)); }
  if (pyv) {
    const diff = cases.filter((c, k) => js[k] !== pyv[k]);
    chk(diff.length === 0, `경계 ${cases.length}조합에서 JS = 파이썬 (문턱과 같은 값 · Zero/NaN 결측 규칙)`,
        `경계에서 두 채점기가 갈린다 ${diff.length}건: ` + JSON.stringify(diff.slice(0, 3)));
    // 기준 구현 자체가 LightGBM 규칙인가 — 몇 칸은 손으로 못 박는다
    const at = (mt, dl, t, v) => pyv[cases.findIndex((c) => c.mt === mt && c.dl === dl && c.t === t && c.v === v)];
    chk(at(0, 0, 0.5, 0.5) === -1 && at(0, 1, -0.5, null) === 1 && at(2, 0, 0.5, null) === 1 && at(2, 1, -0.5, null) === -1 &&
        at(1, 0, 0.5, 0) === 1 && at(1, 1, -0.5, 1e-36) === -1 && at(1, 0, 0.5, null) === 1 && at(0, 0, 0, 1e-36) === 1,
        "기준 구현이 LightGBM NumericalDecision 이다(문턱과 같으면 왼쪽 · None 은 NaN→0 · NaN 은 기본방향 · Zero 는 ±1e-35 안이 기본방향)");
  }
}

/* ③ 업로드 관문이 틀린 모델을 거부한다 */
console.log("\n■ 업로드 관문(omniValidate)");
const good = () => ({ v: M.OMNI_VER, feats: M.OMNI_MODEL_FEATS.slice(), consts: Object.assign({}, M.OMNI_CONSTS),
  trees: JSON.parse(JSON.stringify(FX.trees)), probe: FX.rows.slice(0, 200).map((x, k) => ({ x: x, raw: FX.raw[k] })), heads: {} });
const g = M.omniValidate(good());
chk(g.ok && g.probeN === 200 && g.probeNanRows > 0, `올바른 모델은 받는다 (probe ${g.probeN} · NaN 행 ${g.probeNanRows})`,
    "올바른 모델을 거부했다: " + g.err);
const mut = (name, f) => { const b = good(); f(b); const r = M.omniValidate(b); chk(!r.ok, `거부: ${name} — ${r.err}`, `★통과시켰다★: ${name}`); };
mut("문턱 하나를 바꾼 나무(probe 가 잡아야 한다)", (b) => {
  // 첫 probe 행이 뿌리에서 ★반대쪽으로 가게★ 뿌리 문턱을 옮긴다
  const x = b.probe[0].x, n = b.trees[0], v = x[n.f] === null ? 0 : x[n.f];
  n.t = v <= n.t ? v - 1e-9 : v + 1e-9;
});
mut("결측 기본방향을 뒤집은 나무", (b) => { for (const t of b.trees) { const st = [t]; while (st.length) { const n = st.pop(); if (n.w !== undefined) continue; if (n.mt === 2) n.dl = 1 - n.dl; st.push(n.l, n.r); } } });
mut("피처 명세가 다르다(두 칸 순서)", (b) => { const t = b.feats[0]; b.feats[0] = b.feats[1]; b.feats[1] = t; });
mut("상수가 다르다(60분봉 창)", (b) => { b.consts.hLook = 300; });
mut("판 번호가 다르다", (b) => { b.v = M.OMNI_VER + 1; });
mut("probe 부족", (b) => { b.probe = b.probe.slice(0, 10); });
mut("probe 없음", (b) => { delete b.probe; });
mut("잎 값이 NaN", (b) => { let n = b.trees[0]; while (n.w === undefined) n = n.l; n.w = NaN; });
mut("피처 번호 범위 밖", (b) => { b.trees[0].f = 52; });
mut("나무 없음", (b) => { b.trees = []; });

/* ④ 배선 — 관문을 거친 뒤에만 저장하고, 옛 모델은 남기고, 섀도우로 시작한다 */
console.log("\n■ 배선");
const src = readFileSync(join(root, "src/index.js"), "utf8");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
function block(text, head) {
  const i = text.indexOf(head); if (i < 0) return "";
  let d = 0, k = text.indexOf("{", i);
  for (let j = k; j < text.length; j++) { if (text[j] === "{") d++; else if (text[j] === "}") { d--; if (d === 0) return text.slice(i, j + 1); } }
  return "";
}
const EP = strip(block(src, 'if (path === "/api/omni-import" && request.method === "POST")'));
chk(EP.length > 200, "업로드 엔드포인트가 있다");
const iV = EP.indexOf("omniValidate("), iPut = EP.indexOf("R2.put(OMNI_MODEL.r2Key");
chk(iV > 0 && iPut > iV && /if \(!vr\.ok\) return/.test(EP), "★검증을 통과한 뒤에만★ 저장한다(실패하면 400 으로 돌려보낸다)");
chk(/R2\.put\(OMNI_MODEL\.r2Prev/.test(EP) && EP.indexOf("R2.put(OMNI_MODEL.r2Prev") < iPut, "새 모델을 쓰기 ★전에★ 옛 모델을 prev 로 남긴다");
chk(/mode: "shadow"/.test(EP), "섀도우로 시작한다(매매에 쓰지 않는다)");
chk(/_trainAuthed\(\)/.test(EP), "업로드는 학습 키로만 받는다");
const TR = readFileSync(join(root, "trainer/modal/omni.py"), "utf8");
chk(/"\/api\/omni-import"/.test(TR) && /allow_nan=False/.test(TR), "트레이너가 NaN 없는 JSON 으로 /api/omni-import 에 올린다");
chk(/"probe": probe/.test(TR) && /if pmax > 1e-9:/.test(TR), "트레이너가 probe 를 싣고, 자기 채점과 LightGBM 이 다르면 올리지 않는다");
const MT = readFileSync(join(root, "trainer/modal/modal_train.py"), "utf8");
const sp = /try:\s*\n\s*omni_job\.spawn\(\)/.test(MT);
chk(sp, "train_job 이 OMNI 를 ★try 안에서★ 띄운다 — 실패해도 기존 학습은 계속된다");
chk(/def _omni_image\(\):[\s\S]*?except Exception/.test(MT), "OMNI 이미지 준비 실패가 기존 학습기 배포를 막지 않는다");
chk(!/gpu=/.test((MT.split("def omni_job")[0].split("@app.function(image=_OMNI_IMAGE").pop()) || ""), "OMNI 는 GPU 를 쓰지 않는다");

console.log(fails ? `\n❌ OMNI 모델 정합 ${fails}건 실패` : "\n✅ OMNI 모델 정합 통과");
process.exit(fails ? 1 : 0);
