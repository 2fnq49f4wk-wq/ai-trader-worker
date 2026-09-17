/* [V33.380] 라벨 실험대 — ★재기만 하고, 아무것도 바꾸지 않는가.★
 *
 *   ★왜 만들었나★ 실측이 "모델 문제가 아니다" 라고 말한다. 같은 표본·같은 파이프라인에서
 *       스윙(10일 sign(pnl))   DNN 49.3% · 부스터 52.2~52.5% · IC 0.003~0.032 · 고유도 0.033
 *       단타(60분 삼중배리어)  57.0%(하한 56.0%) · IC 0.207 · 고유도 0.333
 *   11층 MLP 와 부스팅 트리는 ★다른 모델족★ 인데 스윙에서 같은 벽에 부딪힌다 —
 *   그 벽은 모델이 아니라 라벨·지평이다.
 *
 *   ★그런데 이런 실험대는 위험하다.★ "성능을 올린다" 는 명분으로 조용히
 *     · 운영 라벨을 바꾸거나
 *     · 승격 문턱을 건드리거나
 *     · 모집단이 다른 숫자를 같은 자로 비교해 보고하거나
 *   하기 쉽다. 그러면 성능이 오른 것이 아니라 ★자를 바꾼 것★ 이다(B-6 이 금지한 바로 그것).
 *   이 검사는 실험대가 ★측정 도구로만★ 남게 못 박는다.
 */
import { readFileSync } from "node:fs";
import { execFileSync, } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "trainer/modal/modal_train.py");
const PY = readFileSync(SRC, "utf8");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.error("  ✗ FAIL " + m); } };

const out = JSON.parse(execFileSync("python3", ["-c", `
import ast, json
src = open(${JSON.stringify(SRC)}, encoding="utf-8").read()
tree = ast.parse(src)
def fn(name):
    for x in ast.walk(tree):
        if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef)) and x.name == name: return x
f = fn("_label_ablation")
res = {"found": f is not None}
if f is not None:
    body = ast.unparse(f)
    res["uploads"]   = ("requests.post" in body) or ("/api/" in body)
    res["writes_Y"]  = any(isinstance(t, ast.Name) and t.id in ("Y", "PNL", "X")
                           for a in ast.walk(f) if isinstance(a, ast.Assign) for t in a.targets)
    res["uses_split"]= "_split_ts(" in body
    res["uses_uniq"] = "UWs" in body
    res["prints_cov"]= "cov" in body
    res["calls"]     = sorted({x.func.id for x in ast.walk(f)
                               if isinstance(x, ast.Call) and isinstance(x.func, ast.Name)})
# 운영 라벨 줄이 그대로인가
res["prod_label"] = "Y = np.array([1.0 if float(s.get('pnl', 0.0)) > 0 else 0.0 for s in samples], dtype=np.float64)".replace("'", '"') in src
print(json.dumps(res, ensure_ascii=False))
`], { encoding: "utf8" }).trim());

ok(out.found, "라벨 실험대(_label_ablation)가 있다");
ok(out.prod_label, "★운영 라벨 줄이 한 톨도 안 바뀌었다★ — 실험대는 운영을 건드리지 않는다");
ok(!out.uploads, "★실험대가 아무것도 업로드하지 않는다★ — requests.post·/api/ 호출이 없다");
ok(out.uses_split, "운영과 ★같은 분할(_split_ts)★ 을 쓴다 — 다른 자로 재면 비교가 무의미하다");
ok(out.uses_uniq, "고유도 가중을 그대로 쓴다(유효표본 기준이 운영과 같다)");
ok(out.prints_cov, "★적용률(coverage)을 함께 찍는다★ — 모집단이 다른 후보를 정확도만으로 못 비교한다");

/* ★게이트·문턱을 건드리지 않았는가.★ 실험대를 핑계로 승격 기준이 움직이면 그건 성능이 아니다. */
{
  const S = readFileSync(join(root, "src/index.js"), "utf8");
  const M = await import("../src/index.js");
  ok(M.GBDT.trustFloor >= 0.505, `부스터 정확도 문턱이 그대로다 (${M.GBDT.trustFloor})`);
  ok(M.DNN.trustFloor >= 0.505, `DNN 정확도 문턱이 그대로다 (${M.DNN.trustFloor})`);
  ok(M.ICGATE.forwardTMin >= 1.0, `전진 t 문턱이 그대로다 (${M.ICGATE.forwardTMin})`);
  ok(M.ICGATE.minBlocks >= 5, `블록 최소치가 그대로다 (${M.ICGATE.minBlocks})`);
  ok(M.ICGATE.minForward >= 400, `전진표본 최소치가 그대로다 (${M.ICGATE.minForward})`);
  ok(/_accFloor\(GBDT\.trustFloor, _num\(body\.accBase, null\)\)/.test(S),
     "수신 문턱이 여전히 ★무실력 기준선★ 과 묶여 있다(라벨을 바꿔도 이건 안 풀린다)");
  ok(/function _accFloor[\s\S]{0,400}Math\.max/.test(S),
     "_accFloor 가 여전히 max 다 — 무실력 기준선 아래로 못 내려간다");
}

// ── 실험대를 실제로 돌려 본다 — 표가 나오고, 데드밴드가 실제로 표본을 줄이는가 ──
{
  const script = `
import json, sys, types, contextlib, numpy as np
class _Any:
    def __getattr__(self, n): return _Any()
    def __call__(self, *a, **k):
        if len(a) == 1 and not k and callable(a[0]): return a[0]
        return _Any()
class _Stub(types.ModuleType):
    def __getattr__(self, n): return _Any()
sys.modules["modal"] = _Stub("modal")

# ★lightgbm 을 러너에 깔지 않는다.★ 여기서 시험하는 것은 부스팅 구현이 아니라
#   실험대의 ★장부★ 다 — 모집단 마스크가 제대로 걸리는가, 적용률을 맞게 세는가,
#   운영과 같은 분할을 쓰는가, 표가 나오는가. 그래서 결정적인 로지스틱으로 갈음한다.
#   (진짜 lightgbm 을 요구하면 이 검사는 CI 에서만 조용히 꺼진다 — 그게 더 나쁘다.)
_SAW = {"weight": 0, "noweight": 0}
class _FakeDS:
    def __init__(self, data, label=None, weight=None, **k):
        self.X, self.y, self.w = np.asarray(data), np.asarray(label), weight
        _SAW["weight" if weight is not None else "noweight"] += 1
class _FakeBooster:
    def __init__(self, X, y, w):
        Xb = np.hstack([X, np.ones((len(X), 1))])
        ww = np.ones(len(X)) if w is None else np.asarray(w, dtype=np.float64)
        b = np.zeros(Xb.shape[1])
        for _ in range(60):                      # 뉴턴 몇 걸음이면 충분하다
            z = np.clip(Xb @ b, -30, 30); p = 1 / (1 + np.exp(-z))
            gsum = Xb.T @ (ww * (p - y))
            H = Xb.T @ (Xb * (ww * p * (1 - p))[:, None]) + 1e-6 * np.eye(Xb.shape[1])
            b -= np.linalg.solve(H, gsum)
        self.b = b
    def predict(self, X):
        Xb = np.hstack([np.asarray(X), np.ones((len(X), 1))])
        return 1 / (1 + np.exp(-np.clip(Xb @ self.b, -30, 30)))
_fake = types.ModuleType("lightgbm")
_fake.Dataset = _FakeDS
_fake.train = lambda params, ds, num_boost_round=100, **k: _FakeBooster(ds.X, ds.y, ds.w)
sys.modules["lightgbm"] = _fake
src = open(${JSON.stringify(SRC)}, encoding="utf-8").read()
g = {"__name__": "probe"}
exec(compile(src, "modal_train.py", "exec"), g)
g["_HORIZON_MS"] = 10 * 86400000
g["_EMBARGO_MS"] = 10 * 86400000

DAY = 86400000
rng = np.random.default_rng(3)
n = 60000
ts = np.sort(rng.random(n)) * (1200 * DAY)
X = rng.normal(size=(n, 3))
# ★신호를 일부러 심는다★ — 큰 움직임에만 예측 가능성이 있게(데드밴드가 이기는 세계).
big = rng.normal(size=n) * 0.03
pnl = np.where(np.abs(big) > 0.02, big + 0.02 * X[:, 0], rng.normal(size=n) * 0.001)
buf = []
class Cap:
    def write(self, s): buf.append(s)
    def flush(self): pass
with contextlib.redirect_stdout(Cap()):
    g["_label_ablation"](X, pnl, ts, None, None, 17, 3, UNIQ=np.ones(n), featnames=["a","b","c"])
txt = "".join(buf)
rows = [l for l in txt.split("\\n") if "←" in l]
# ★찍힌 표를 실제로 파싱한다★ — 적용률 칸이 살아 있는지 값으로 본다
# ※ 이 스크립트는 JS 템플릿 리터럴 안에 있다 — 역슬래시가 한 겹 먹힌다.
#   그래서 정규식을 쓰지 않는다(첫 판에서 \d 가 d 로 바뀌어 조용히 0개를 읽었다).
cov, neff = [], []
for l in rows:
    try:
        cov.append(float(l.split("%")[0].split()[-1]))
        # 유효n 은 "←" 앞 마지막 정수 칸이다
        neff.append(int(l.split("←")[0].split()[-1]))
    except Exception:
        pass
print(json.dumps({"lines": len(rows), "text": txt[-1800:], "hasA": "A 운영(sign)" in txt,
                  "hasB": "데드밴드" in txt, "hasC": "횡단면" in txt,
                  "cov": cov, "neff": neff, "sawWeight": _SAW["weight"], "sawNoWeight": _SAW["noweight"],
                  "noUpload": "업로드" not in txt.replace("아무것도 업로드하지 않는다", "")}, ensure_ascii=False))
`;
  const tmp = join(tmpdir(), "labbench-" + process.pid + ".py");
  let R = null;
  try { writeFileSync(tmp, script); R = JSON.parse(execFileSync("python3", [tmp], { encoding: "utf8", timeout: 600000 }).trim()); }
  catch (e) { console.log("  —    실행 생략(lightgbm 없음 등): " + String(e.stdout || e.message).slice(0, 160)); }
  finally { try { unlinkSync(tmp); } catch (e) {} }
  ok(!!R, "실험대를 ★실제로 돌렸다★(결정적 학습기로 갈음 — 장부를 시험한다)");
  if (R) {
    console.log("\n" + R.text.split("\n").filter((l) => l.trim()).map((l) => "     " + l).join("\n") + "\n");
    ok(R.lines >= 3, `후보 ${R.lines}종을 실제로 학습해 표를 낸다`);
    ok(R.hasA && R.hasB && R.hasC, "운영·데드밴드·횡단면 후보가 전부 표에 있다");
    ok(R.noUpload, "실행 중 업로드 문구가 나오지 않는다");
    /* ★적용률 칸을 값으로 본다.★ "cov 라는 이름이 있다" 만 보면 인쇄를 지워도 통과한다 —
       돌연변이 시험에서 실제로 안 잡혔다. 표를 파싱해 ★서로 다른 적용률★ 이 찍히는지 본다. */
    ok(Array.isArray(R.cov) && R.cov.length >= 3, `표에서 적용률 ${R.cov.length}개를 읽었다`);
    ok(R.cov.some((c) => c > 99.5), "전수 후보는 적용률 100% 로 찍힌다");
    ok(R.cov.some((c) => c < 95),
       `★데드밴드 후보가 100% 보다 낮게 찍힌다★ (${R.cov.join("% · ")}%) — 모집단이 줄었다는 사실이 표에 있다`);
    /* 고유도 가중이 ★학습기까지★ 닿는가 — "UWs 라는 이름이 코드에 있다" 로는 못 본다. */
    /* ★적용률만 찍고 마스크를 안 거는★ 경우를 잡는다 — cov 는 use.mean() 으로 따로 계산되므로
       인쇄만 보면 통과한다(돌연변이 시험에서 실제로 빠져나갔다). 유효n 이 같이 줄어야 진짜다. */
    {
      const pair = R.cov.map((c, i) => [c, R.neff[i]]).filter((p) => isFinite(p[1]));
      const full = Math.max(...pair.filter(([c]) => c > 99.5).map(([, nn]) => nn));
      const cut = pair.filter(([c]) => c < 95);
      ok(cut.length > 0 && cut.every(([, nn]) => nn < full),
         `★모집단을 줄인 후보는 유효n 도 줄어든다★ (전수 ${full} → ${cut.map(([c, nn]) => `${c}%:${nn}`).join(" · ")}) — 적용률만 찍고 마스크를 안 거는 것을 막는다`);
    }
    ok(R.sawWeight >= 3 && R.sawNoWeight === 0,
       `★모든 후보가 고유도 가중을 학습기에 넘긴다★ (가중 ${R.sawWeight}회 · 무가중 ${R.sawNoWeight}회)`);
  }
}

if (fail) { console.error(`\n✗ 라벨 실험대 계약 ${fail}건 실패 (총 ${n})`); process.exit(1); }
console.log(`\n✓ 라벨 실험대 계약 통과 (${n}개 단언) — ★재기만 하고 아무것도 안 바꾼다★`);
