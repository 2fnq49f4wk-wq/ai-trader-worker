/* ═══════════════════════════════════════════════════════════════════════════
   [V33.249] ★위원장 자리는 두고 내용물을 바꾼다★ — MIND 를 FM 에서 트리로

   사용자 질문: "CPU 한도 걸리면 MIND 도 그냥 Modal 로 보내서 학습시키면 안 되냐?"
   답: 이미 보내고 있었다. 그리고 보냈더니 이렇게 나왔다(2026-08-25, 표본 518,004):

     FM(MIND): K=8 seeds=6 valAcc=0.479 lb=0.466 (유효 3555/51800)
     FM(MIND) 업로드 OK: {"activated": false, "sane": false,
                          "note": "정합/검증바닥 미달 — 섀도우 유지"}

   GPU 완전수렴 · 시드 6 · 검증 51,800행이다. ★측정 문제가 아니다.★
   같은 표본 같은 날 트리들은 전부 53.5~54.2% 였다(IC t 2.5~4.7):
     GBDT 54.2 · XGB 53.6 · LGB 53.5 · Cat 54.1 · gbdt_kr 54.1
   즉 CPU·수렴이 아니라 ★모델 형태가 이 과제에 안 맞는 것★ 이다.

   그런데 그 47.9% 하나가 없다는 이유로 시스템 전체가 RULE_FALLBACK 이었다 —
   __aiReady = !!(__mind && (__dnn || __gbdt)) 에서 MIND 가 하드 요구사항이기 때문이다.
   자리는 그대로 두고(안전장치를 지키려고) 내용물만 트리로 바꾼다.

   여기서 지키는 것:
     · 위원장 슬롯이 트리를 ★실제로 채점★ 하는가 (문구가 아니라 확률로 확인한다)
     · 트리 위원장도 FM 과 ★똑같은 안전장치★ 를 통과해야 하는가
       (변환정합 probe ≤0.03 · valAccLB ≥ trustFloor — V33.14 가 이 probe 로 사고를 잡았다)
     · gbdt_model 의 ★사본이 아닌가★ (같은 설정이면 위원회에 같은 의견이 두 표 들어간다)
     · 학습기를 복제하지 않았는가 (복제하면 한쪽만 고쳐지는 날이 온다)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* ── ① 실제 채점 — 트리 위원장이 트리 확률을 그대로 내는가 ── */
console.log("① 실제 채점 (합성 트리를 위원장 슬롯에 넣고 돌린다)");
{
  const D = M.LUXML.featNames.length;
  // 결정적 합성 트리 3그루 — 피처 0/3/7 로 가른다.
  const trees = [
    { f: 0, t: 0.5, l: { w: -1.2 }, r: { w: 0.9 } },
    { f: 3, t: -0.2, l: { w: 0.4 }, r: { w: -0.7 } },
    { f: 7, t: 1.0, l: { w: 0.15 }, r: { w: 1.1 } },
  ];
  const core = { trees, eta: 0.3, bias: 0.05 };
  const mindTree = Object.assign({ meta: { w: [1], b: 0 }, experts: ["tree"],
    featVer: M.LUXML.featVer, valAcc: 0.54, valAccLB: 0.53, valN: 3000 }, core);

  const mk = (seed) => { let s = seed >>> 0; return Array.from({ length: D }, () => {
    s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 4 - 2; }); };

  let maxDiff = 0, n = 0, allSame = true, prev = null;
  for (let i = 0; i < 40; i++) {
    const x = mk(1000 + i);
    const direct = M.mlGBDTScore(core, x);
    const viaMind = await M.mlMindScore(null, mindTree, x, null);
    if (direct == null || !viaMind) { chk(false, "", "채점이 null 을 돌려줬다(i=" + i + ")"); break; }
    maxDiff = Math.max(maxDiff, Math.abs(direct - viaMind.p)); n++;
    if (prev !== null && Math.abs(viaMind.p - prev) > 1e-12) allSame = false;
    prev = viaMind.p;
  }
  chk(n === 40, "40개 입력을 모두 채점했다", "채점이 중간에 끊겼다(" + n + "/40)");
  chk(maxDiff < 1e-9,
    "위원장 확률 = 트리 확률 (최대차 " + maxDiff.toExponential(1) + ") — meta 항등이 그대로 통과시킨다",
    "위원장 확률이 트리 확률과 다르다(최대차 " + maxDiff + ") — meta/experts 조립이 어긋났다");
  chk(!allSame, "입력에 따라 확률이 달라진다(상수를 찍고 있지 않다)", "모든 입력에 같은 확률 — 트리가 안 먹고 있다");

  // ★mean/std 가 없어도 죽지 않아야 한다★ — 트리 위원장에는 그 필드가 아예 없다
  chk(!("mean" in mindTree) && !("std" in mindTree),
    "트리 위원장에는 mean/std 가 없다(트리는 원피처를 그대로 가른다)",
    "트리 위원장이 mean/std 를 들고 있다 — 불필요한 결합");
  const seg = S.slice(S.indexOf("async function mlMindScore"), S.indexOf("async function mlGuardObserve"));
  chk(/_isTree \? null : _mindStd/.test(seg),
    "FM 일 때만 z 표준화를 만든다(트리일 때 _mindStd 를 부르지 않는다)",
    "트리인데도 _mindStd 를 부른다 — mean/std 가 없으면 그 자리에서 죽는다");
}

/* ── ② FM 위원장이 여전히 동작하는가 (회귀 금지) ── */
console.log("② FM 위원장 무회귀");
{
  const D = M.LUXML.featNames.length;
  const fm = { w: Array.from({ length: D }, (_, i) => (i % 7 - 3) * 0.03), K: 2,
    V: Array.from({ length: D }, (_, i) => [0.01 * (i % 5), -0.02 * (i % 3)]),
    b: 0.1, mean: new Array(D).fill(0), std: new Array(D).fill(1) };
  const mindFm = { fm, meta: { w: [1], b: 0 }, experts: ["fm"], mean: fm.mean, std: fm.std, featVer: M.LUXML.featVer };
  const x = Array.from({ length: D }, (_, i) => Math.sin(i) * 1.5);
  const r = await M.mlMindScore(null, mindFm, x, null);
  chk(r && r.p > 0 && r.p < 1, "FM 위원장도 그대로 채점된다(p=" + (r ? r.p.toFixed(4) : "null") + ")",
    "FM 경로가 깨졌다 — 트리 추가가 기존 위원장을 죽였다");
}

/* ── ③ 안전장치 — 트리 경로가 FM 과 같은 문턱을 지나는가 ── */
console.log("③ 안전장치 동등성");
{
  const ep = S.slice(S.indexOf('if (path === "/api/mind-import"'), S.indexOf('if (path === "/api/fm-import"'));
  chk(ep.length > 500, "/api/mind-import 엔드포인트를 찾았다", "엔드포인트가 없다");
  chk(/mlGBDTScore\(_core, pr\.x/.test(ep),
    "변환정합 probe 를 워커의 트리 스코어러로 직접 재현한다",
    "probe 검증이 없다 — V33.14(표준화 불일치 conv 0.6265)를 못 잡는다");
  chk(/_cMax <= 0\.03/.test(ep), "정합 허용오차가 FM 경로와 같은 0.03 이다", "정합 문턱이 다르거나 없다");
  /* [V33.292] 문턱의 ★기준점★ 이 상수에서 _accFloor(상수, 무실력 정확도) 로 바뀌었다.
     그 함수는 상수보다 낮은 값을 절대 안 돌려주므로(Math.max) 계약은 더 세졌을 뿐이다.
     계약은 "MIND.trustFloor 에서 나온 문턱을 넘어야 하고, 정합과 ★함께★ 통과해야 한다" 다. */
  chk(/_mLB >= (_accFloor\()?MIND\.trustFloor/.test(ep),
    "검증 하한이 MIND.trustFloor(이상)를 넘어야 승격한다", "trustFloor 게이트가 없다");
  chk(/_mSane = _cOK && _mLB >= (_accFloor\()?MIND\.trustFloor/.test(ep),
    "두 조건을 ★모두★ 통과해야 sane 이다", "두 안전장치가 OR 로 느슨해졌다");
  chk(/function _accFloor\(base, noSkill\)[\s\S]{0,400}Math\.max\(f,/.test(S),
    "그 기준점은 상수보다 ★낮아질 수 없다★(Math.max) — 완화 경로가 아니다",
    "★기준점이 상수보다 낮아질 수 있다 — 게이트가 느슨해질 수 있다★");
  chk(/mind_tree_ext/.test(ep), "미달이면 라이브가 아니라 섀도우로 저장한다", "미달분이 라이브 위원장을 덮어쓸 수 있다");
  chk(/_validTree/.test(ep) && /node\.f < _D/.test(ep),
    "트리 구조·피처 인덱스를 검증한다(범위 밖 인덱스는 채점에서 undefined 가 된다)",
    "구조 검증이 없다 — 망가진 트리가 위원장이 된다");
}

/* ── ④ 사본 금지 · 학습기 복제 금지 ── */
console.log("④ 위원장이 GBDT 의 사본이 아닌가");
{
  chk(/endpoint="\/api\/mind-import"/.test(PY), "Modal 이 위원장 슬롯으로 업로드한다", "Modal 이 여전히 gbdt-import 로만 올린다");
  const call = PY.slice(PY.indexOf('endpoint="/api/mind-import"') - 400, PY.indexOf('endpoint="/api/mind-import"') + 400);
  const hp = /hp=\{([^}]*)\}/.exec(call);
  chk(!!hp, "위원장 학습에 별도 설정(hp)을 준다", "hp 없이 기본 설정으로 돈다 — gbdt_model 과 같은 모델이 된다");
  if (hp) {
    const body = hp[1];
    const get = (k) => { const m = new RegExp('"' + k + '":\\s*([0-9.]+)').exec(body); return m ? Number(m[1]) : null; };
    // 기본값(gbdt_model)과 실제로 달라야 한다
    const base = { eta: 0.03, depth: 4, sub: 0.8, col: 0.8, seed: 12345 };
    const diffs = Object.keys(base).filter(k => get(k) !== null && get(k) !== base[k]);
    chk(diffs.length >= 4,
      "기본 설정과 " + diffs.length + "개 항목이 다르다 (" + diffs.join(", ") + ") — 다른 관점의 모델이다",
      "설정이 " + diffs.length + "개만 다르다 — 사실상 gbdt_model 의 사본이다");
    chk(get("seed") !== base.seed, "시드가 다르다(같은 시드면 부트스트랩까지 동일하다)", "시드가 같다");
  }
  // 학습기를 복제하지 않았는가
  const defs = (PY.match(/^def _train_and_upload_gbdt\(/gm) || []).length;
  chk(defs === 1, "트리 학습기 정의는 하나뿐이다(복제 없음)", "학습기가 " + defs + "개로 복제됐다 — 한쪽만 고쳐지는 날이 온다");
  chk(/def _train_and_upload_gbdt\([^)]*endpoint=/s.test(PY),
    "같은 학습기를 endpoint/tag/hp 로 재사용한다",
    "재사용 파라미터가 없다");
}

/* ── ⑤ 준비완료 판정이 트리 위원장도 인정하는가 ── */
console.log("⑤ aiReady 판정");
{
  chk(/json_array_length\(v,'\$\.trees'\)/.test(S),
    "ai-mode 프로브가 트리 위원장도 '저장됨' 으로 센다",
    "프로브가 $.fm 만 본다 — 트리 위원장을 올려도 화면은 계속 '미학습' 이다");
  chk(/_probe\.mfm \|\| _num\(_probe\.mtrees, 0\) > 0/.test(S),
    "mindOk 가 FM 또는 트리 둘 중 하나면 참이다",
    "mindOk 가 여전히 FM 만 인정한다");
  const load = S.slice(S.indexOf("async function mlMindLoad"), S.indexOf("async function mlMindScore"));
  chk(/Array\.isArray\(m\.trees\) && m\.trees\.length/.test(load),
    "mlMindLoad 가 트리 위원장을 적재한다",
    "로더가 m.fm 을 요구한다 — 트리 위원장이 항상 null 로 떨어진다");
  /* [V33.422] DNN 퇴역 — 조건이 (__mind && (__dnn || __gbdt)) → (__mind && __gbdt) 로 ★좁아졌다★.
     계약의 뜻은 "MIND 는 하드 요구사항이고, 실제로 로드된 모델이 하나는 있어야 한다" 이다.
     느슨해지는 방향(예: __mind 만)으로 바뀌면 여전히 막는다. */
  chk(/__aiReady = !!\(__mind && __gbdt\)/.test(S),
    "aiReady 가 MIND + 실제 로드된 위원(GBDT) 을 함께 요구한다",
    "aiReady 조건이 완화됐다 — MIND 만으로 준비완료가 되면 빈 위원회로 돈다");
}

console.log(fails ? "\n✗ 트리 위원장 검사 " + fails + "건 실패" : "\n✓ 트리 위원장 검사 통과");
process.exit(fails ? 1 : 0);
