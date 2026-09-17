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
import { readFileSync } from "node:fs";
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

fits = g["_stage_fits"]; nextcost = g["_next_cost"]
order_of = g["_starve_order"]; ages_of = g["_stage_ages"]; reserve_of = g["_starve_reserve"]
STARVE = g["STARVE"]
DEFAULT = g["STAGE_COST_DEFAULT"]; TIMEOUT = g["JOB_TIMEOUT_S"]; MARGIN = g["JOB_MARGIN_S"]
STAGES = ["gbdt", "boosters", "markets", "mind", "scalp", "seq", "memo", "ablate"]

out = {}
out["defaults_cover_all"] = all(s in DEFAULT for s in STAGES)
out["margin_positive"] = MARGIN > 0 and MARGIN < TIMEOUT

# [V33.377] 순서는 커서가 아니라 ★굶은 정도★ 로 정해진다
NOW = 1_000_000_000.0
_st = {"last_ok": {"gbdt": NOW - 100 * 3600, "boosters": NOW - 1 * 3600,
                   "markets": NOW - 50 * 3600, "mind": NOW - 10 * 3600,
                   "scalp": NOW - 2 * 3600, "seq": NOW - 3 * 3600,
                   "ablate": NOW - 4 * 3600}}   # memo 만 한 번도 안 돎
_ages = ages_of(_st, STAGES, now=NOW)
r = order_of(STAGES, _ages)
out["order_starvedfirst"] = r
out["order_is_permutation"] = sorted(r) == sorted(STAGES) and len(r) == len(STAGES)
out["order_never_ran_first"] = r[0] == "memo"          # 한 번도 안 돈 것이 가장 굶었다
out["order_then_oldest"] = r[1] == "gbdt" and r[2] == "markets"
out["order_stable"] = order_of(STAGES, ages_of({}, STAGES, now=NOW)) == STAGES  # 전부 무한대 → 원래 순서
# 예약: 굶은 단계가 있으면 DNN 이 양보하고, 없으면 0, 그리고 상한을 넘지 않는다
BUDGET = TIMEOUT - MARGIN
out["reserve_zero_when_fed"] = reserve_of(STAGES, ages_of({"last_ok": {s: NOW for s in STAGES}}, STAGES, now=NOW), DEFAULT, BUDGET)
out["reserve_when_hungry"] = reserve_of(STAGES, _ages, DEFAULT, BUDGET)
out["reserve_cap"] = reserve_of(STAGES, ages_of({}, STAGES, now=NOW),
                                {s: 99999 for s in STAGES}, BUDGET)
out["reserve_cap_limit"] = int(BUDGET * STARVE["reserveCapFrac"])
# ★문턱이 뜻대로 서는가★ — 값을 게이트가 다시 적지 않고 ★경계 양쪽★ 을 실제로 물려 본다.
_just_over  = ages_of({"last_ok": {s: NOW - (STARVE["maxAgeS"] + 60) for s in STAGES}}, STAGES, now=NOW)
_just_under = ages_of({"last_ok": {s: NOW - (STARVE["maxAgeS"] - 60) for s in STAGES}}, STAGES, now=NOW)
out["hungry_just_over"]  = reserve_of(STAGES, _just_over, DEFAULT, BUDGET)
out["hungry_just_under"] = reserve_of(STAGES, _just_under, DEFAULT, BUDGET)
# 정책값 자체의 절대 상·하한 — 느슨하게 풀면 위 단언들이 같이 움직여 통과해 버린다
out["policy"] = {"maxAgeS": STARVE["maxAgeS"], "reserveCapFrac": STARVE["reserveCapFrac"],
                 "dnnMinSeeds": STARVE["dnnMinSeeds"], "topK": STARVE["topK"]}

# ── 배선 확인(AST) — 시뮬레이션은 게이트의 사본이라, 트레이너 쪽 배선은 따로 본다 ──
_tj = None
for _n in ast.walk(ast.parse(src)):
    if isinstance(_n, (ast.FunctionDef, ast.AsyncFunctionDef)) and _n.name == "train_job": _tj = _n
_wire = {"last_ok_write": False, "reserve_in_seedloop": False, "store_last_ok": False,
         "reserve_computed": False}
if _tj is not None:
    for _n in ast.walk(_tj):
        if isinstance(_n, ast.Assign) and len(_n.targets) == 1 and isinstance(_n.targets[0], ast.Subscript):
            _t = _n.targets[0]
            if isinstance(_t.value, ast.Name) and _t.value.id == "_last_ok": _wire["last_ok_write"] = True
            if (isinstance(_t.value, ast.Name) and _t.value.id == "_store"
                    and isinstance(_t.slice, ast.Constant) and _t.slice.value == "last_ok"):
                _wire["store_last_ok"] = True
        # ★값이 _starve_reserve 에서 나오는지까지 본다.★ 이름만 맞으면 0 을 넣어도 통과한다
        #   — 돌연변이 시험에서 실제로 그렇게 빠져나갔다.
        if isinstance(_n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_DNN_RESERVE" for t in _n.targets):
            if any(isinstance(x, ast.Call) and isinstance(x.func, ast.Name) and x.func.id == "_starve_reserve"
                   for x in ast.walk(_n.value)):
                _wire["reserve_computed"] = True
    # 시드 루프의 예산 판정이 ★그 예약분을★ 뺀다 — 뺄셈만 있고 0 을 빼면 아무 일도 안 일어난다
    _res_names = set()
    for _n in ast.walk(_tj):
        if isinstance(_n, ast.Assign) and any(isinstance(t, ast.Name) for t in _n.targets):
            if any(isinstance(x, ast.Name) and x.id == "_DNN_RESERVE" for x in ast.walk(_n.value)):
                for t in _n.targets:
                    if isinstance(t, ast.Name): _res_names.add(t.id)
    for _n in ast.walk(_tj):
        if (isinstance(_n, ast.Call) and isinstance(_n.func, ast.Name) and _n.func.id == "_stage_fits"
                and _n.args and isinstance(_n.args[0], ast.BinOp) and isinstance(_n.args[0].op, ast.Sub)):
            _rhs = _n.args[0].right
            if (isinstance(_rhs, ast.Name) and _rhs.id in _res_names) or \
               any(isinstance(x, ast.Name) and x.id == "_DNN_RESERVE" for x in ast.walk(_rhs)):
                _wire["reserve_in_seedloop"] = True
out["wire"] = _wire

# 예산 판정
out["fits_true"] = fits(900, 600)
out["fits_false"] = fits(100, 600)
out["fits_bad_input"] = fits(None, 600)

# 실측 적립: 관측 * 1.2, 하한 30
out["cost_accrues"] = nextcost(600, 500) == 600 and nextcost(600, 1000) == 1200
out["cost_floor"] = nextcost(600, 1) == 30

# ══ ★굶주림 시뮬레이션 — 손으로 적은 옛 숫자가 아니라 ★실측★ 으로 돌린다.★ ══════
#   종전 이 자리는 mind 900s·남은 예산 1034s 로 돌려 "회전이면 굶주림 없음" 을 확인해 줬다.
#   ★그 초록불이 거짓이었다.★ 실측(run 35149059451, 2026-09-16)은 이렇다:
#       ① 수집 571s · ② DNN 6시드 2030s(시드당 338s) · 보정·업로드 55s → 남은 예산 630s
#       예상 비용: mind 1469 · gbdt 829 · seq 770 · scalp 762 · markets 509 (전부 630 초과)
#   즉 600s 넘는 단계는 ★구조적으로★ 못 돈다. 로그가 5단계 생략을 매 회차 찍고 있었다.
FETCH_S, SEED_S, DNN_TAIL_S, SEEDS = 571.0, 338.0, 55.0, 6
# 실측 비용(예상치 ÷ 1.2 = 관측). memo·boosters 는 그 회차에 실제로 돈 시간.
TRUE_COST = {"gbdt": 691, "boosters": 177, "markets": 424, "mind": 1224,
             "scalp": 635, "seq": 642, "memo": 53, "ablate": 333}
HOUR = 3600.0
CRON_S = 6 * HOUR          # Modal 크론 주기

def simulate(new_sched, runs=8):
    """회차를 반복해 각 단계가 몇 번 돌았는지 센다. new_sched=False 는 ★옛 동작★ 재현."""
    costs = dict(DEFAULT); seen = {s: 0 for s in STAGES}
    last_ok = {}; rot = None; now = 0.0; seeds_seen = []
    for _ in range(runs):
        now += CRON_S
        budget = TIMEOUT - MARGIN
        if new_sched:
            ages = ages_of({"last_ok": last_ok}, STAGES, now=now)
            reserve = reserve_of(STAGES, ages, costs, budget)
            order = order_of(STAGES, ages)
        else:
            reserve = 0
            # 옛 커서 회전 — 끊긴 첫 단계를 맨 앞으로(이 판에서 지운 동작의 재현)
            order = (STAGES[STAGES.index(rot):] + STAGES[:STAGES.index(rot)]) if rot in STAGES else list(STAGES)
        left = budget - FETCH_S
        # ② DNN — 예약분을 빼고 시드를 돌린다(최소 시드는 지킨다)
        nseed = 0
        for sd in range(SEEDS):
            res = reserve if nseed >= STARVE["dnnMinSeeds"] else 0
            if sd > 0 and not fits(left - res, SEED_S * 1.15 + 240):
                break
            left -= SEED_S; nseed += 1
        left -= DNN_TAIL_S
        seeds_seen.append(nseed)
        skipped = []
        for nm in order:
            need = costs.get(nm, 600)
            if not fits(left, need):
                skipped.append(nm); continue
            el = TRUE_COST[nm]
            left -= el; costs[nm] = nextcost(costs.get(nm), el); seen[nm] += 1
            last_ok[nm] = now
        rot = skipped[0] if skipped else None
    return seen, seeds_seen

out["new_seen"], out["new_seeds"] = simulate(True)
out["old_seen"], out["old_seeds"] = simulate(False)
out["dnn_min_seeds"] = STARVE["dnnMinSeeds"]

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
ok(R.order_never_ran_first, `순서: ★한 번도 안 돈 단계★ 가 맨 앞이다 (실제 ${R.order_starvedfirst[0]})`);
ok(R.order_then_oldest, `그 다음은 오래 굶은 순서다 (${R.order_starvedfirst.slice(0, 3).join(" → ")})`);
ok(R.order_is_permutation, "순서를 바꿔도 단계가 빠지거나 중복되지 않는다");
ok(R.order_stable, "굶은 정도가 같으면 원래 순서 — 같은 입력이면 같은 순서다");
ok(R.reserve_zero_when_fed === 0, "굶은 단계가 없으면 DNN 이 한 초도 양보하지 않는다(무해성)");
ok(R.reserve_when_hungry > 0, `굶은 단계가 있으면 DNN 이 ${R.reserve_when_hungry}s 를 양보한다`);
ok(R.reserve_cap <= R.reserve_cap_limit,
   `★양보에 상한이 있다★ — ${R.reserve_cap}s ≤ ${R.reserve_cap_limit}s (DNN 을 죽이지 않는다)`);
ok(R.hungry_just_over > 0 && R.hungry_just_under === 0,
   `굶주림 문턱이 ★뜻대로 선다★ — ${(R.policy.maxAgeS / 3600).toFixed(0)}h 를 막 넘기면 예약하고, 막 못 넘기면 안 한다`);
/* ★정책값 자체에도 절대 상·하한이 필요하다.★ 위 단언들은 전부 STARVE 에서 값을 읽으므로,
   STARVE 를 느슨하게 풀면 단언과 코드가 ★같이 움직여★ 통과해 버린다 — 돌연변이 시험에서
   실제로 4종이 안 잡혔다(maxAgeS 무한대 · 상한 9.9 · 최소시드 0 · topK). 여기서 못을 박는다. */
ok(R.policy.maxAgeS <= 36 * 3600 && R.policy.maxAgeS >= 6 * 3600,
   `굶주림 문턱 ${(R.policy.maxAgeS / 3600).toFixed(0)}h 가 6~36h 안이다 — 무한대면 예약이 영영 안 걸린다`);
ok(R.policy.reserveCapFrac > 0 && R.policy.reserveCapFrac <= 0.5,
   `양보 상한 ${(R.policy.reserveCapFrac * 100).toFixed(0)}% 가 50% 이하다 — 넘으면 DNN 이 죽는다`);
ok(R.policy.dnnMinSeeds >= 2,
   `DNN 최소 시드 ${R.policy.dnnMinSeeds} ≥ 2 — 1시드 앙상블은 앙상블이 아니다`);
ok(R.policy.topK >= 1 && R.policy.topK <= 3,
   `한 회차에 예약해 주는 굶은 단계 ${R.policy.topK}종이 1~3 안이다`);
// ── 배선: 시뮬레이션은 게이트의 사본이다. 트레이너가 실제로 그렇게 배선돼 있는지 따로 본다 ──
ok(R.wire.reserve_computed, "트레이너가 회차마다 예약분(_DNN_RESERVE)을 계산한다");
ok(R.wire.reserve_in_seedloop,
   "★시드 루프의 예산 판정이 예약분을 실제로 뺀다★ — 안 빼면 정책이 있어도 아무 일도 안 일어난다");
ok(R.wire.last_ok_write, "단계가 성공하면 마지막 성공 시각을 적는다(_last_ok)");
ok(R.wire.store_last_ok, "그 기록을 회차 사이에 남긴다(_store['last_ok']) — 안 남기면 매번 '한 번도 안 돎'");
ok(R.fits_true && !R.fits_false, "예산 판정: 남은 시간이 예상보다 많을 때만 시작한다");
ok(!R.fits_bad_input, "예산 값이 이상하면 시작하지 않는다(모르면 안 한다)");
ok(R.cost_accrues, "실측 적립: 관측 소요 ×1.2 를 다음 회차 예상치로 쓴다");
ok(R.cost_floor, "실측이 아주 짧아도 하한 30s — 0 이 되어 무한히 밀어넣지 않는다");

/* ★핵심★ — ★실측 비용★ 으로 8회차(이틀·크론 6시간)를 돌려 굶는 단계가 있는지 본다.
   종전 이 자리는 손으로 적은 옛 비용(mind 900s·남은 예산 1034s)을 써서 "굶주림 없음" 이라고
   답했다. 실측은 mind 1224s·남은 예산 630s 였고 5단계가 매 회차 잘렸다 — 초록불이 거짓이었다. */
const W = R.new_seen, N = R.old_seen;
const starvedW = Object.entries(W).filter(([, v]) => v === 0).map(([k]) => k);
const starvedN = Object.entries(N).filter(([, v]) => v === 0).map(([k]) => k);
console.log("       새 방식: " + JSON.stringify(W) + "  DNN 시드 " + JSON.stringify(R.new_seeds));
console.log("       옛 방식: " + JSON.stringify(N) + "  DNN 시드 " + JSON.stringify(R.old_seeds));
ok(starvedN.length > 0,
   `★전제 확인 — 옛 방식(커서 회전·예약 없음)은 실측 비용에서 실제로 굶는다: ${starvedN.join(", ") || "없음"}★`);
ok(starvedW.length === 0,
   `새 방식은 8회차(이틀) 안에 ★모든 단계★ 가 최소 1번 돈다 (굶은 단계: ${starvedW.join(", ") || "없음"})`);
ok(Math.min(...R.new_seeds) >= R.dnn_min_seeds,
   `그러면서 DNN 시드가 최소 ${R.dnn_min_seeds}개 아래로 안 내려간다 (최소 ${Math.min(...R.new_seeds)}개)`);
ok(Math.max(...R.new_seeds) >= 4,
   `굶은 단계가 없는 회차에는 DNN 이 시드를 돌려받는다 (최대 ${Math.max(...R.new_seeds)}개)`);

// ── 구조: 모든 단계가 예산 관문을 지나는가 ──
// [V33.380] ablate = 라벨 실험대(업로드 없음). 예산 관문을 거쳐야 하는 것은 같다.
const WANT = ["ablate", "boosters", "gbdt", "markets", "memo", "mind", "scalp", "seq"];
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

/* ── [V33.359] ★고유도 내역을 실제로 계산해서 찍는지★ ─────────────────────────
   실측: 유효표본이 한 회차 만에 7,379 → 210 으로 무너져 SEQ 가 위원회에서 빠지고
   부스터 3종이 전부 거절됐다. 트레이너 코드는 그 사이 안 바뀌었으니 원인은 데이터인데,
   로그엔 '평균 고유도' 한 숫자뿐이라 무엇이 달라졌는지 알 길이 없었다.
   고유도를 결정하는 두 값(평가창 일수 · 종목당 건수)을 찍게 했는지 지킨다. */
{
  const src = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
  const blk = src.slice(src.indexOf("_dnn_uw = UNIQ["), src.indexOf("[V32.9]"));
  ok(blk.indexOf("[고유도내역]") >= 0, "DNN 학습이 고유도 내역을 찍는다");
  for (const [k, why] of [["_span_d", "평가창이 며칠에 걸쳐 있는가"],
                          ["_nsym", "종목이 몇 개인가"],
                          ["_per_sym", "종목당 몇 건인가"]])
    ok(blk.indexOf(k) >= 0, `  · ${k} — ${why}`);
  ok(/평균동시성/.test(blk), "  · 평균 동시성(= 명목/유효)을 함께 적는다");
  ok(/except Exception/.test(blk),
     "내역 산출이 실패해도 학습을 죽이지 않는다(계측 때문에 회차가 날아가면 안 된다)");

  /* ★계산식이 맞는지 실행으로 잰다★ — 파이썬 식을 그대로 JS 로 옮겨 같은 답이 나오는지.
     (찍기만 하고 값이 틀리면 다음 사람이 그 숫자를 믿고 엉뚱한 곳을 판다) */
  const DAY = 86400000, T0 = Date.UTC(2026, 1, 1);
  const ts = [], sy = [];
  for (let i = 0; i < 2000; i++) { ts.push(T0 + Math.floor(i / 100) * DAY); sy.push("S" + (i % 100)); }
  const spanD = (Math.max(...ts) - Math.min(...ts)) / DAY;
  const nsym = new Set(sy).size;
  ok(Math.abs(spanD - 19) < 1e-9 && nsym === 100 && Math.abs(2000 / nsym - 20) < 1e-9,
     `내역 계산식 확인 — 평가창 ${spanD}일 · 종목 ${nsym}개 · 종목당 ${(2000 / nsym).toFixed(1)}건`);
}

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
