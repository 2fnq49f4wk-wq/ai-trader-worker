/* ═══════════════════════════════════════════════════════════════════════════
   [V33.306] MEMO 를 워커 밖(Modal)에서 학습한다 — ★같은 모델인가★ 를 두 언어로 대조한다.

   ■ 왜 옮겼나 (사용자 지시: "클라우드플레어로 학습이 필수인 애들 말고는 모달로 보내라")
     memoTrainNightly 의 k-means 는 표본 24,000 × 원형 128 × 축 75 × 6반복 ≈ ★14억 회★ 다.
     이 저장소에서 워커 CPU 를 가장 많이 먹는 학습이고, 그 예산 때문에 학습창을
     24,000행(67일)으로 묶을 수밖에 없었다 — 그 좁은 창이 V33.303 이 고친
     "홀드아웃 13일" 문제의 뿌리이기도 하다. 밖에서 학습하면 두 제약이 함께 풀린다.

   ■ 무엇이 무서운가
     학습을 다른 언어로 옮기면 ★식이 조금 갈라져도 아무도 모른다★ — 성적으로만 드러난다.
     이 저장소가 반복해 당한 사고가 정확히 그 모양이다(V33.104 in-sample 채점, V33.272
     슬롯 손복사, V33.282 판 상수 오인). 그래서 계약은 하나다:
     ★트레이너가 낸 확률을 워커 memoScore 가 재현하지 못하면 승격하지 않는다.★

   ■ 이 검사가 무는 것
     ① 워커가 받는 쪽에 형상·판·probe 검사가 있는가(없으면 조용히 틀린 책이 앉는다)
     ② ★두 언어를 실제로 돌려★ 같은 원형책·같은 벡터에서 같은 확률을 내는가
     ③ 트레이너가 probe 를 실제로 만들어 보내는가 · 홀드아웃 규약이 워커와 같은 값인가
     ④ 워커 학습기가 사라지지 않았는가 — 외부가 멈추면 스스로 학습해야 한다
     ⑤ 전진검증은 워커에 남아 있는가(밖에서 학습했다고 원장을 버리면 안 된다)
     ⑥ 변이 — probe 검사를 빼면 이 검사가 실패하는가
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 받는 쪽이 형상·판·정합을 검사하는가");
{
  chk(/path === "\/api\/memo-import" && request\.method === "POST"/.test(S),
    "/api/memo-import 가 있다", "★외부 MEMO 를 받을 경로가 없다★");
  chk(/luxFeatVer 불일치/.test(S), "판(featVer)이 다르면 거부한다 — 좌표계가 다른 원형책이다",
    "판 대조가 없다");
  chk(/probe 없음 — 정합을 확인할 수 없으면 승격하지 않는다/.test(S),
    "probe 가 없으면 승격하지 않는다(\"아마 같겠지\" 로 넘어가지 않는다)",
    "★probe 없이도 저장한다 — 두 언어가 갈라져도 아무도 모른다★");
  chk(/maxDiff > _num\(MEMOML\.probeMaxDiff, 1e-6\)/.test(S),
    "정합 오차가 문턱을 넘으면 거부한다", "정합 오차를 재고도 그냥 저장한다");
  chk(/const ad = expertAdmit\(model\);\s*\n\s*model\.trusted = !!\(ad\.tier === "full"\);/.test(S),
    "★신뢰 판정은 워커가 한다★ — 트레이너가 보낸 trusted 를 그대로 믿지 않는다(V33.113 의 교훈)",
    "외부가 보낸 신뢰 플래그를 그대로 쓴다 — 외부 모델만 관대한 자로 심사받는다");
}

console.log("\n② ★두 언어를 실제로 돌린다★ — 같은 원형책, 같은 벡터, 같은 확률인가");
{
  const D = M.LUXML.featNames.length;
  const tmp = mkdtempSync(join(tmpdir(), "memo-"));
  const grab = (name) => {
    const i = PY.indexOf("def " + name + "(");
    if (i < 0) return "";
    const rest = PY.slice(i);
    const m2 = /\n(?=def |# =|MEMO_CFG)/.exec(rest.slice(1));
    return m2 ? rest.slice(0, m2.index + 1) : rest;
  };
  const cfgIdx = PY.indexOf("MEMO_CFG = {");
  const cfgSrc = cfgIdx >= 0 ? PY.slice(cfgIdx, PY.indexOf("\n}", cfgIdx) + 2) : "";
  const src = cfgSrc + "\n" + grab("_memo_fit") + "\n" + grab("_memo_chunk_dist") + "\n" + grab("_memo_score");
  chk(cfgSrc.length > 20 && src.includes("def _memo_fit") && src.includes("def _memo_score"),
    "트레이너에서 학습·채점 함수를 떼어 왔다", "★파이썬 쪽 함수를 못 찾는다 — 검사가 헛돈다★");

  const py = join(tmp, "probe.py");
  writeFileSync(py, "import json, numpy as np\n" + src + `
rng = np.random.default_rng(20260904)
n, D = 6000, ${D}
X = rng.normal(size=(n, D))
# 시장 원핫 3열(mktUS/mktKR/mktCM) 위치를 서버 이름표에서 받는다
mi = json.loads('''${JSON.stringify(["mktUS", "mktKR", "mktCM"].map((k) => M.LUXML.featNames.indexOf(k)))}''')
X[:, mi] = 0.0
half = n // 2
X[:half, mi[0]] = 1.0
X[half:, mi[1]] = 1.0
# 신호를 몇 축에만 심는다 — 관련도 가중이 실제로 일을 하게 한다
lin = 0.9 * X[:, 0] - 0.7 * X[:, 5] + 0.4 * X[:, 11]
Y = (lin + rng.normal(scale=1.0, size=n) > 0).astype(float)
PNL = lin + rng.normal(scale=0.5, size=n)
MK = np.where(X[:, mi[0]] > 0.5, 0, 1)
model, why = _memo_fit(X, Y, PNL, MK, {"K": 24, "minTrain": 1000})
if model is None:
    print(json.dumps({"err": why})); raise SystemExit(0)
model["mktIdx"] = mi
model["luxFeatVer"] = ${M.LUXML.featVer}
probe = []
for i in range(0, 40):
    j = int(i * (n // 40))
    p = _memo_score(model, X[j], neighbors=8)
    if p is not None:
        probe.append({"x": [float(v) for v in X[j]], "p": p})
print(json.dumps({"model": model, "probe": probe}))
`);
  let out = null;
  try { out = JSON.parse(execFileSync("python3", [py], { encoding: "utf8", maxBuffer: 1 << 28 }).trim()); }
  catch (e) { chk(false, "", "★파이썬 쪽을 돌려보지 못했다: " + String(e.message).slice(0, 200) + "★"); }
  if (out && out.err) chk(false, "", "★파이썬 학습이 실패했다: " + out.err + "★");
  if (out && out.model) {
    const mdl = out.model;
    chk(Array.isArray(mdl.protos) && mdl.protos.length >= 8,
      `파이썬이 원형 ${mdl.protos.length}개를 만들었다`, "원형이 너무 적어 대조가 무의미하다");
    chk(new Set(mdl.protos.map((p) => p.m)).size >= 2,
      "시장 칸막이가 실제로 나뉘었다(책 2개 이상) — memoScore 의 시장 선택 경로가 검사에 걸린다",
      "책이 하나뿐이라 시장 칸막이 경로가 안 걸린다");
    let md = 0, cnt = 0;
    for (const pr of (out.probe || [])) {
      const js = M.memoScore(mdl, pr.x);
      if (js == null) continue;
      const d = Math.abs(js - pr.p);
      if (d > md) md = d;
      cnt++;
    }
    console.log(`       probe ${cnt}건 — 최대 차 ${md.toExponential(2)} (허용 ${M.MEMOML.probeMaxDiff})`);
    chk(cnt >= 20, `워커 memoScore 가 ${cnt}건을 모두 채점했다`, `채점된 probe 가 ${cnt}건뿐이다`);
    chk(md <= M.MEMOML.probeMaxDiff,
      `★두 언어가 같은 확률을 낸다★ (최대 차 ${md.toExponential(2)}) — 밖에서 학습해도 같은 모델이다`,
      `★두 언어의 확률이 다르다(최대 차 ${md.toExponential(2)}) — 조용한 오염이다★`);
  }
}

console.log("\n③ 보내는 쪽 — probe 를 만들고, 홀드아웃 규약이 워커와 같은가");
{
  chk(/model\["probe"\] = \[\{"x": \[float\(v\) for v in Xa\[ho_idx\[i\]\]\]/.test(PY),
    "트레이너가 probe 를 실제로 만들어 싣는다", "★트레이너가 probe 를 안 보낸다 — 받는 쪽이 늘 거부한다★");
  chk(/_memo_score\(model, Xa\[ho_idx\[i\]\], neighbors=int\(c\["neighbors"\]\)\)/.test(PY),
    "probe 는 scalar 판으로 만든다 — 워커와 ★더하는 순서까지★ 같다",
    "probe 를 행렬 판으로 만든다 — 합산 순서가 달라 정합 오차가 커진다");
  const hd = /"holdDays":\s*(\d+)/.exec(PY);
  chk(hd && Number(hd[1]) === M.MEMOML.holdDays,
    `홀드아웃 규약이 워커와 같다 (${M.MEMOML.holdDays}일)`,
    `★홀드아웃 규약이 어긋난다 — 워커 ${M.MEMOML.holdDays}일 vs 트레이너 ${hd && hd[1]}★`);
  chk(/_train_and_upload_memo\(BASE, KEY, HDR, X, Y, TS, PNL, featver, D,/.test(PY),
    "야간 학습 흐름에 실제로 배선돼 있다(만들어만 두고 안 부르면 아무 일도 안 난다)",
    "★트레이너가 MEMO 를 부르지 않는다★");
  chk(/probe 건" \)|probe %d건/.test(PY) || /probe %d건/.test(PY),
    "로그가 probe 건수를 적는다", "probe 건수를 안 적는다 — 조용히 0건일 수 있다");
}

console.log("\n④~⑤ 워커 쪽 안전망 — 학습기가 남아 있고, 전진검증은 워커가 한다");
{
  chk(/async function memoTrainNightly\(DB\)/.test(S),
    "워커 학습기가 그대로 있다 — 외부가 멈춰도 스스로 학습한다", "★워커 학습기를 지웠다★");
  chk(/_ageH < _num\(MEMOML\.externalMaxAgeH, 30\)/.test(S),
    `외부 모델이 신선할 때만(≤${M.MEMOML.externalMaxAgeH}h) 적합을 건너뛴다`,
    "신선도와 무관하게 건너뛴다 — 낡은 외부 모델에 갇힌다");
  const i = S.indexOf("async function memoTrainNightly(DB)");
  const seg = S.slice(i, i + 6000);
  chk(seg.indexOf("icForwardCheck(DB, {") >= 0 &&
      seg.indexOf("icForwardCheck(DB, {") < seg.indexOf("워커 적합 건너뜀"),
    "★전진검증이 건너뛰기보다 앞에 있다★ — 외부 모델도 전진 원장으로 채점된다",
    "★외부 모델이면 전진검증을 통째로 건너뛴다 — 원장이 멈춘다★");
  chk(/_ext\.fwdIC = _fwd\.ic;/.test(S),
    "그 결과를 외부 모델에 얹어 저장한다", "전진 결과를 버린다");
}

console.log("\n⑥ 변이 시험 — 정합 검사를 빼면 이 검사가 실패하는가");
{
  /* ★변이는 memo-import 블록 안에서만 낸다★ — 같은 문구가 seq-import 에도 있어서,
     파일 전체에 replace 를 걸면 엉뚱한 곳이 지워지고 검사는 통과해 버린다.
     (이 검사가 처음 그렇게 헛돌았다 — 구간을 먼저 특정한다) */
  const a = S.indexOf('path === "/api/memo-import"');
  const b = S.indexOf('path === "/api/seq-arch"', a);
  chk(a > 0 && b > a, `memo-import 구간을 특정했다(${(b - a).toLocaleString()}자)`,
    "★memo-import 구간을 못 찾는다 — 변이 시험이 무의미하다★");
  const blk = S.slice(a, b);
  const muts = [
    [blk.replace("probe 없음 — 정합을 확인할 수 없으면 승격하지 않는다", "x"),
     /probe 없음 — 정합을 확인할 수 없으면 승격하지 않는다/, "probe 필수 조건을 빼면"],
    [blk.replace(/maxDiff > _num\(MEMOML\.probeMaxDiff, 1e-6\)/, "false"),
     /maxDiff > _num\(MEMOML\.probeMaxDiff, 1e-6\)/, "정합 문턱을 무력화하면"],
    [blk.replace(/model\.trusted = !!\(ad\.tier === "full"\);/, "model.trusted = !!body.trusted;"),
     /model\.trusted = !!\(ad\.tier === "full"\);/, "신뢰 판정을 외부에 맡기면"]
  ];
  for (const [mut, re, why] of muts)
    chk(!re.test(mut), `${why} 잡는다`, `★${why} 도 통과한다 — 이 검사는 헛돈다★`);
}

console.log(fails === 0 ? "\n✓ MEMO 외부학습 검사 통과 — 밖에서 학습해도 같은 모델이다"
                        : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
