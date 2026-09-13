/* [V33.350] Modal 학습이 예산을 넘겨 죽고, 뒤쪽 단계가 통째로 안 돌던 것
 *
 *   사용자 보고: "github에 modal 학습 push전부다 실패하고 있던데".
 *
 *   실측(2026-09-13 00:33, GitHub Actions run #114 · 표본 1,053,656):
 *       ① 표본 수집 4분54초 · ② DNN 6시드 32분30초(★예산의 54%★) · ⑤ GBDT 8분51초
 *       ⑥ 부스터 2분23초 · 시장별 5분58초 · ⑦ MIND 진행 중 timeout 3600s 로 ★강제 종료★
 *   그래서 (1) 앞서 성공한 GBDT·부스터·시장별 업로드까지 "실패한 실행" 으로 묻히고
 *   (2) MIND 뒤의 단타·SEQ·MEMO·STACK 경계 통지는 ★한 번도 실행되지 않았다★ —
 *   매 회차 같은 자리에서 잘리니 구조적으로 굶는다.
 *
 *   고침: 예산이 모자라면 죽지 말고 ★건너뛰고 기록★ 하고, ★다음 회차는 그 단계부터★ 돈다.
 *   이 게이트는 소스 문자열을 세지 않는다(V33.337 교훈) — 파이썬 헬퍼를 ★실제로 실행해★
 *   회전·예산 판정·실측 적립이 굶주림을 없애는지 확인한다.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PY = `
import ast, sys, types, json
src = open(${JSON.stringify(join(root, "trainer/modal/modal_train.py"))}, encoding="utf-8").read()

# modal 없이 모듈 상단을 살리기 위한 최소 스텁 — 우리가 검사할 것은 순수 헬퍼뿐이다.
class _Any:
    """무엇을 불러도·무엇을 꺼내도 자기 자신을 주는 스텁. 데코레이터로 쓰이면 원 함수를 그대로 돌려준다."""
    def __getattr__(self, n): return _Any()
    def __call__(self, *a, **k):
        if len(a) == 1 and not k and callable(a[0]): return a[0]
        return _Any()
class _Stub(types.ModuleType):
    def __getattr__(self, n): return _Any()
sys.modules["modal"] = _Stub("modal")
g = {"__name__": "modal_train_probe"}
exec(compile(src, "modal_train.py", "exec"), g)

rotate = g["_rotate_plan"]; fits = g["_stage_fits"]; nextcost = g["_next_cost"]
DEFAULT = g["STAGE_COST_DEFAULT"]; TIMEOUT = g["JOB_TIMEOUT_S"]; MARGIN = g["JOB_MARGIN_S"]
STAGES = ["gbdt", "boosters", "markets", "mind", "scalp", "seq", "memo"]

out = {}
out["defaults_cover_all"] = all(s in DEFAULT for s in STAGES)
out["margin_positive"] = MARGIN > 0 and MARGIN < TIMEOUT

# 회전: 끊긴 지점부터 시작하고, 모든 단계가 정확히 한 번씩 남는다
r = rotate(STAGES, "mind")
out["rotate_starts_at"] = r[0]
out["rotate_is_permutation"] = sorted(r) == sorted(STAGES) and len(r) == len(STAGES)
out["rotate_none_keeps_order"] = rotate(STAGES, None) == STAGES
out["rotate_unknown_keeps_order"] = rotate(STAGES, "nope") == STAGES

# 예산 판정
out["fits_true"] = fits(900, 600)
out["fits_false"] = fits(100, 600)
out["fits_bad_input"] = fits(None, 600)

# 실측 적립: 관측 * 1.2, 하한 30
out["cost_accrues"] = nextcost(600, 500) == 600 and nextcost(600, 1000) == 1200
out["cost_floor"] = nextcost(600, 1) == 30

# ★굶주림 시뮬레이션★ — 실측 그대로의 예산에서 회차를 반복해 모든 단계가 도는지 본다.
#   ② DNN 이 32.5분, ①수집 4.9분을 먹고 남는 시간으로 뒤 단계를 돌린다.
TRUE_COST = {"gbdt": 531, "boosters": 143, "markets": 358, "mind": 900,
             "scalp": 300, "seq": 900, "memo": 600}
def simulate(rotate_on, runs=6):
    costs = dict(DEFAULT); rot = None; seen = {s: 0 for s in STAGES}
    for _ in range(runs):
        left = TIMEOUT - MARGIN - (294 + 1950 + 22)   # 수집 + DNN 6시드 + 업로드
        order = rotate(STAGES, rot) if rotate_on else list(STAGES)
        skipped = []
        for nm in order:
            need = costs.get(nm, 600)
            if not fits(left, need):
                skipped.append(nm); continue
            el = TRUE_COST[nm]
            left -= el; costs[nm] = nextcost(costs.get(nm), el); seen[nm] += 1
        rot = skipped[0] if skipped else None
    return seen
out["with_rotation"] = simulate(True)
out["without_rotation"] = simulate(False)

# ── 구조 확인은 AST 로 한다(문자열 세기가 아니다) ──
tree = ast.parse(src)
def _fn(name, node=None):
    for n in ast.walk(node or tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name:
            return n
    return None
tj = _fn("train_job")
out["train_job_found"] = tj is not None
# 모든 단계가 _stage 를 거치는가 — 하나라도 맨 호출로 남아 있으면 그 단계는 예산을 안 본다
out["stage_calls"] = len([n for n in ast.walk(tj)
                          if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "_stage"])
# _plan 리스트 리터럴에서 단계 이름을 뽑는다(호출은 루프 한 곳이라 인자가 상수가 아니다)
staged = []
for n in ast.walk(tj):
    if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_PLAN" for t in n.targets):
        if isinstance(n.value, ast.List):
            for el in n.value.elts:
                if isinstance(el, ast.Tuple) and el.elts and isinstance(el.elts[0], ast.Constant):
                    staged.append(el.elts[0].value)
out["staged_names"] = sorted(staged)
# 회전·관문을 우회해 단계 함수를 직접 부르는 곳이 남아 있으면 그 단계는 예산을 안 본다
TRAINERS = ("_train_and_upload_gbdt", "_train_and_upload_boosters", "_train_per_market",
            "_train_and_upload_scalp", "_train_and_upload_seq", "_train_and_upload_memo")
direct = []
for n in ast.walk(tj):
    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in TRAINERS:
        # lambda 안(=_plan 항목)이면 정상. lambda 밖에서 직접 부르면 관문 우회다.
        direct.append(n.lineno)
lam = set()
for n in ast.walk(tj):
    if isinstance(n, ast.Lambda):
        for x in ast.walk(n):
            if isinstance(x, ast.Call) and isinstance(x.func, ast.Name) and x.func.id in TRAINERS:
                lam.add(x.lineno)
out["bypass_lines"] = sorted(set(direct) - lam)

# _dnn_uw 를 정의한 함수 밖에서 참조하면 매 회차 NameError 다(실제로 났다)
owner = None
for n in ast.walk(tree):
    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
        for t in ast.walk(n):
            if isinstance(t, ast.Name) and t.id == "_dnn_uw" and isinstance(t.ctx, ast.Store):
                owner = n
if owner is None:
    out["dnn_uw_leak"] = "정의를 못 찾음"
else:
    inner = {id(x) for x in ast.walk(owner)}
    leaks = [x.lineno for x in ast.walk(tree)
             if isinstance(x, ast.Name) and x.id == "_dnn_uw" and id(x) not in inner]
    out["dnn_uw_leak"] = leaks
print(json.dumps(out, ensure_ascii=False))
`;

let R;
try {
  R = JSON.parse(execFileSync("python3", ["-c", PY], { encoding: "utf8", cwd: root }));
} catch (e) {
  console.log("✗ FAIL 파이썬 헬퍼를 실행하지 못했다:\n" + String(e.stdout || "") + String(e.stderr || e.message));
  process.exit(1);
}

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

ok(R.defaults_cover_all, "단계 7종 전부에 예상 소요 기본값이 있다(없으면 600s 추측으로 떨어진다)");
ok(R.margin_positive, "마무리 여유(JOB_MARGIN_S)가 타임아웃 안에서 양수다");
ok(R.rotate_starts_at === "mind", `회전: 지난 회차가 끊긴 'mind' 부터 시작한다 (실제 ${R.rotate_starts_at})`);
ok(R.rotate_is_permutation, "회전해도 단계가 빠지거나 중복되지 않는다");
ok(R.rotate_none_keeps_order && R.rotate_unknown_keeps_order, "커서가 없거나 모르는 이름이면 원래 순서");
ok(R.fits_true && !R.fits_false, "예산 판정: 남은 시간이 예상보다 많을 때만 시작한다");
ok(!R.fits_bad_input, "예산 값이 이상하면 시작하지 않는다(모르면 안 한다)");
ok(R.cost_accrues, "실측 적립: 관측 소요 ×1.2 를 다음 회차 예상치로 쓴다");
ok(R.cost_floor, "실측이 아주 짧아도 하한 30s — 0 이 되어 무한히 밀어넣지 않는다");

// ★핵심★ 회전이 굶주림을 없애는가
const W = R.with_rotation, N = R.without_rotation;
const starvedW = Object.entries(W).filter(([, v]) => v === 0).map(([k]) => k);
const starvedN = Object.entries(N).filter(([, v]) => v === 0).map(([k]) => k);
console.log("       회전 있음: " + JSON.stringify(W));
console.log("       회전 없음: " + JSON.stringify(N));
ok(starvedN.length > 0, `전제 확인 — 회전이 없으면 굶는 단계가 실제로 생긴다 (${starvedN.join(", ") || "없음"})`);
ok(starvedW.length === 0, `회전을 켜면 6회차 안에 모든 단계가 최소 1번 돈다 (굶은 단계: ${starvedW.join(", ") || "없음"})`);

// ── 구조: 모든 단계가 예산 관문을 지나는가 ──
const WANT = ["boosters", "gbdt", "markets", "memo", "mind", "scalp", "seq"];
ok(R.train_job_found, "train_job 을 찾았다");
ok(R.stage_calls >= 1, `단계 실행이 _stage() 관문을 통해 일어난다 (호출 지점 ${R.stage_calls})`);
ok(JSON.stringify(R.staged_names) === JSON.stringify(WANT),
   `예산 관문에 등록된 단계가 7종 전부다: ${JSON.stringify(R.staged_names)}`);
ok(R.bypass_lines.length === 0,
   R.bypass_lines.length
     ? `관문을 우회해 학습 함수를 직접 부르는 곳이 있다 (줄 ${R.bypass_lines.join(", ")}) — 그 단계는 예산을 안 본다`
     : "관문을 우회해 학습 함수를 직접 부르는 곳이 없다");
ok(Array.isArray(R.dnn_uw_leak) && R.dnn_uw_leak.length === 0,
   Array.isArray(R.dnn_uw_leak) && R.dnn_uw_leak.length
     ? `_dnn_uw 를 정의 함수 밖에서 참조한다 → 매 회차 NameError (줄 ${R.dnn_uw_leak.join(", ")})`
     : "_dnn_uw 를 정의한 함수 밖에서 참조하지 않는다(고유도 필드가 실제로 올라간다)");

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
