/* [V33.377] 학습기 스코프 계약 — ★쓰는 이름이 실제로 거기 있는가.★
 *
 *   ★왜★ 실측(run 35149059451, 2026-09-16 21:37:47):
 *       MEMO 원형 128개 · 학습 160000행 · 홀드아웃 30000행/60일(관측 6개) · valAcc 50.2% …
 *       MEMO 업로드 예외: name 'requests' is not defined
 *   학습은 매 회차 끝까지 멀쩡히 돌았고, ★마지막 POST 한 줄★ 에서만 죽었다.
 *   예외를 잡아 print 하고 None 을 돌려주므로 회차는 '성공' 으로 끝난다 — 그래서 몇 달을 몰랐다.
 *   화면에는 "MEMO 합류 보류" 로만 보였다. 실력 문제로 읽히지만 실은 ★배달 사고★ 였다.
 *
 *   원인은 사소하다: `_train_and_upload_memo` 만 최상위 def 라 train_job 안의 지역 import
 *   (`import numpy as np, math, json, time, requests`)를 클로저로 못 받는다. 나머지 학습기는 받는다.
 *
 *   ★이 종류는 문법검사도 린트도 안 잡는다★ — 실행해야 나고, 실행은 GPU 회차에서만 난다.
 *   그래서 AST 로 ★전 함수★ 를 훑어 "쓰는데 어디에도 없는 이름" 을 찾는다.
 *   그리고 ★한 번 더★ 본다: 업로드가 실패해도 회차가 성공으로 끝나는 자리가 어디인지.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRCPATH = join(root, "trainer/modal/modal_train.py");
const PYSRC = readFileSync(SRCPATH, "utf8");
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fails++; console.error("  ✗ FAIL " + m); } };

const script = `
import ast, json, builtins
src = open(${JSON.stringify(SRCPATH)}, encoding="utf-8").read()
tree = ast.parse(src)

BUILTIN = set(dir(builtins))

def bound_names(node):
    """이 스코프가 스스로 묶는 이름 — import · 대입 · 인자 · for · with · except · 내부 def/class."""
    out = set()
    for n in ast.walk(node):
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            for a in n.names: out.add(a.asname or a.name.split(".")[0])
        elif isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)): out.add(n.id)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)): out.add(n.name)
        elif isinstance(n, ast.arg): out.add(n.arg)
        elif isinstance(n, ast.ExceptHandler) and n.name: out.add(n.name)
        elif isinstance(n, ast.alias) and n.asname: out.add(n.asname)
        elif isinstance(n, (ast.Global, ast.Nonlocal)): out.update(n.names)
    return out

MODULE = bound_names(ast.Module(body=[b for b in tree.body
          if not isinstance(b, (ast.FunctionDef, ast.AsyncFunctionDef))], type_ignores=[]))
for b in tree.body:
    if isinstance(b, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)): MODULE.add(b.name)
# 런타임에 심는 전역도 세어 준다 — train_job 이 globals()["_HORIZON_MS"] = ... 로 박는다.
#   ※ 이건 '없는 이름' 이 아니라 '정적으로 안 보이는 이름' 이다. 둘을 섞으면 검사가 늑대소년이 된다.
for n in ast.walk(tree):
    if (isinstance(n, ast.Assign) and len(n.targets) == 1
            and isinstance(n.targets[0], ast.Subscript)
            and isinstance(n.targets[0].value, ast.Call)
            and isinstance(n.targets[0].value.func, ast.Name)
            and n.targets[0].value.func.id == "globals"
            and isinstance(n.targets[0].slice, ast.Constant)):
        MODULE.add(n.targets[0].slice.value)

bad = []
for fn in tree.body:
    if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)): continue
    have = bound_names(fn) | MODULE | BUILTIN
    used = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load): used.add(n.id)
    miss = sorted(used - have)
    if miss: bad.append({"fn": fn.name, "line": fn.lineno, "missing": miss})

out = {"missing": bad, "topLevelFns": len([b for b in tree.body if isinstance(b, ast.FunctionDef)])}

# 업로드 결과를 ★회차 성패에 반영하는가★ — print 만 하고 넘어가면 조용한 실패가 된다.
def _fn(name):
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name: return n
memo = _fn("_train_and_upload_memo")
out["memo_imports"] = sorted(bound_names(ast.Module(body=[x for x in memo.body
                      if isinstance(x, (ast.Import, ast.ImportFrom))], type_ignores=[]))) if memo else []
print(json.dumps(out))
`;
const tmp = join(tmpdir(), "tscope-" + process.pid + ".py");
let R;
try { writeFileSync(tmp, script); R = JSON.parse(execFileSync("python3", [tmp], { encoding: "utf8", timeout: 120000 }).trim()); }
catch (e) { console.error("  ✗ FAIL 검사 실행 실패: " + String(e.stdout || e.message).slice(0, 400)); process.exit(1); }
finally { try { unlinkSync(tmp); } catch (e) {} }

console.log(`\n     최상위 학습기 함수 ${R.topLevelFns}종 검사\n`);
ok(R.missing.length === 0,
   R.missing.length
     ? `★스코프에 없는 이름을 쓰는 함수 ${R.missing.length}종★: ` +
       R.missing.map((b) => `${b.fn}(${b.line}) → ${b.missing.join(", ")}`).join(" · ")
     : "모든 최상위 함수가 쓰는 이름이 스코프 안에 있다 — 실행해야만 나던 NameError 를 여기서 잡는다");

ok(R.memo_imports.includes("requests") && R.memo_imports.includes("json"),
   `MEMO 업로더가 requests·json 을 직접 들여온다 (지금: ${R.memo_imports.join(", ")})`);

/* ★업로드가 죽어도 회차가 '성공' 으로 끝나던 자리.★ 삼키는 것 자체는 옳다 —
   MEMO 하나 때문에 회차 전체가 날아가면 그게 더 나쁘다. 다만 ★눈에 띄어야★ 한다. */
{
  const seg = PYSRC.slice(PYSRC.indexOf("def _train_and_upload_memo"));
  const body = seg.slice(0, seg.indexOf("\n# ====") < 0 ? seg.length : seg.indexOf("\n# ===="));
  ok(/except Exception as e:\s*\n\s*print\("MEMO 업로드 예외/.test(body),
     "업로드 실패를 삼키되 ★찍는다★ — 한 학습기 때문에 회차 전체가 날아가지 않는다");
  ok(/⚠️|실패/.test(body) || /print\("MEMO 업로드 예외/.test(body),
     "그 줄이 로그에서 눈에 띈다(다음 사람이 훑어서 찾을 수 있다)");
}

/* ★STACK 경계 통지가 '실제로 다시 학습한 것' 만 주장하는가.★
   종전엔 네 이름을 박아 보냈다 — 예산으로 gbdt·mind 가 생략된 회차에도 재학습했다고 주장한 셈이다. */
{
  ok(/"models": _oof_models\b/.test(PYSRC),
     "경계 통지의 models 가 ★그 회차가 실제로 돌린 단계★ 에서 나온다(박힌 목록이 아니다)");
  ok(/_oof_models = \["dnn"\] \+ \[_STAGE2OOF\[n\] for n in _ran if n in _STAGE2OOF\]/.test(PYSRC),
     "_ran(실제로 완료한 단계)에서만 이름을 뽑는다 — 생략된 단계를 학습했다고 하지 않는다");
  ok(!/"models": \["dnn", "gbdt", "boost", "mind"\]/.test(PYSRC),
     "박아 넣은 옛 목록이 남아 있지 않다");
}

if (fails) { console.error(`\n✗ 학습기 스코프 계약 ${fails}건 실패 (총 ${n})`); process.exit(1); }
console.log(`\n✓ 학습기 스코프 계약 통과 (${n}개 단언)`);
