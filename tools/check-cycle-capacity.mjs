/* [V33.383] 정기 회차가 ★일을 끝낼 수 있는 크기인가★ — 그리고 그 사실이 로그에 보이는가.
 *
 *   ★왜★ 사용자 보고: "아직도 ai가 제 성능 못내고 있다 … 6시간 주기 회차가 제대로
 *   작동하는지 확인하고 주기의 문제면 시간 더 늘려".
 *
 *   크론은 ★돌고 있다★ — 화면의 "DNN 3.5시간 전 / GBDT 27.2시간 전" 이 증거다
 *   (6시간 주기인데 DNN 만 신선하다 = 크론은 뛰고 뒤 단계가 굶는다).
 *   문제는 주기가 아니라 ★한 회차가 일을 못 끝내는 것★ 이다. 실측:
 *       예산 3,300s = 수집 571s + DNN 6시드 1,860s + 마무리 55s + ★후속 814s★
 *       후속 8단계 총량 4,179s  →  전 단계 한 바퀴 5.1회차 = ★31시간★
 *
 *   ★그리고 주기를 늘리면 더 나빠진다.★ 회차 수가 줄어 한 바퀴가 더 길어진다.
 *   고칠 곳은 ①회차 시간(timeout) ②DNN 시드 ③GPU/CPU 분리 셋 중 하나다.
 *
 *   이 검사가 무는 것
 *     ① 상태 저장소가 죽어도 ★순서가 돈다★ (안 돌면 W-3 교착이 다른 원인으로 재발한다)
 *     ② 저장소 상태를 ★로그가 말한다★ (조용히 죽으면 몇 달을 모른다)
 *     ③ 회전 주기를 ★숫자로★ 찍는다 — "며칠 걸리는지" 를 사람이 세지 않아도 된다
 *     ④ 하루가 넘으면 ★주기를 늘리는 것이 답이 아니라고★ 로그가 말한다
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "trainer/modal/modal_train.py");
const PY = readFileSync(SRC, "utf8");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.error("  ✗ FAIL " + m); } };

// ── ① 기억이 없어도 순서가 도는가 — 실제로 함수를 돌려 본다 ──────────────────
{
  const script = `
import json, sys, types
class _Any:
    def __getattr__(self, n): return _Any()
    def __call__(self, *a, **k):
        if len(a) == 1 and not k and callable(a[0]): return a[0]
        return _Any()
class _Stub(types.ModuleType):
    def __getattr__(self, n): return _Any()
sys.modules["modal"] = _Stub("modal")
g = {"__name__": "probe"}
exec(compile(open(${JSON.stringify(SRC)}, encoding="utf-8").read(), "m.py", "exec"), g)
order_of, ages_of = g["_starve_order"], g["_stage_ages"]
STAGES = sorted(g["STAGE_COST_DEFAULT"])
# 기억이 전혀 없을 때(모두 무한대) — 시각 회전을 흉내내 회차마다 선두가 바뀌는지
firsts = []
for cyc in range(len(STAGES) * 2):
    o = order_of(STAGES, ages_of({}, STAGES, now=0))
    k = cyc % len(o)
    o = o[k:] + o[:k]
    firsts.append(o[0])
print(json.dumps({"stages": STAGES, "firsts": firsts,
                  "distinct": len(set(firsts)), "total": len(STAGES)}))
`;
  const tmp = join(tmpdir(), "cyccap-" + process.pid + ".py");
  let R;
  try { writeFileSync(tmp, script); R = JSON.parse(execFileSync("python3", [tmp], { encoding: "utf8", timeout: 60000 }).trim()); }
  catch (e) { console.error("  ✗ FAIL 실행 실패: " + String(e.stdout || e.message).slice(0, 300)); process.exit(1); }
  finally { try { unlinkSync(tmp); } catch (e) {} }
  console.log(`\n     단계 ${R.total}종 · 기억 없을 때 선두: ${R.firsts.slice(0, R.total).join(" → ")}\n`);
  ok(R.distinct === R.total,
     `★기억이 없어도 ${R.total}종 전부가 한 번씩 선두가 된다★ (${R.distinct}/${R.total}) — 안 그러면 뒤쪽이 영영 안 돈다`);
}

// ── ② 저장소가 죽었는지를 로그가 말하는가 ────────────────────────────────────
/* ★실제로 print 하는지★ 를 본다 — 문자열만 찾으면 주석 처리해도 통과한다
   (돌연변이 시험에서 실제로 빠져나갔다). */
ok(/print\("   \[상태저장소\] 살아 있음/.test(PY),
   "저장소가 살아 있으면 그렇다고 ★찍는다★(조용히 도는 것과 구분된다)");
ok(/열렸지만 ★쓰기가 안 남는다★/.test(PY),
   "★열렸지만 쓰기가 안 남는 경우★ 를 따로 말한다 — 예외만 잡으면 이 경우를 못 본다");
ok(/d\["_probe"\] = _p[\s\S]{0,120}d\.get\("_probe", -1\)\) != _p/.test(PY),
   "★왕복으로 확인한다★ — 열리는 것과 남는 것은 다르다");
ok(/if _store is None and len\(_order\) > 1:/.test(PY),
   "기억이 없으면 ★시각 기반 회전★ 으로 대체한다");

// ── ③ 회전 주기를 숫자로 찍는가 · ④ 주기를 늘리는 것이 답이 아니라고 말하는가 ──
ok(/\[회전주기\]/.test(PY), "회전 주기를 ★숫자로★ 찍는다(사람이 며칠인지 세지 않아도 된다)");
ok(/전 단계 한 바퀴에 약 \{_cyc:\.1f\}회차/.test(PY), "몇 회차·몇 시간인지 함께 적는다");
ok(/주기를 늘리면 회차 수가 줄어 ★더 나빠진다★/.test(PY),
   "★하루가 넘으면 '주기를 늘리는 것이 답이 아니다' 라고 로그가 말한다★ — 잘못된 처방을 막는다");
ok(/①회차 시간\(timeout\) ②DNN 시드 ③GPU\/CPU 분리/.test(PY), "고칠 곳 후보를 함께 적는다");

// ── ⑤ 비용 주석이 실측에 붙어 있는가(옛 규모의 숫자가 남아 있지 않은가) ───────
/* ★인용과 주장을 가른다.★ 새 주석은 옛 문장을 ★역사로 인용★ 하므로 단순 부분문자열
   검사는 자기 인용에 걸린다(첫 판에서 실제로 그랬다). 살아 있는 주장은 gpu= 줄에 붙은
   꼬리 주석이므로 ★그 줄★ 에 비용 주장이 없는지를 본다. */
{
  /* ★설명 주석이 아니라 '실제 인자 줄' 을 본다.★ 파일 위쪽에 `gpu="T4" 추가` 라는
     안내 주석이 있어서, 첫 일치를 쓰면 엉뚱한 줄을 검사한다(첫 판이 그랬다). */
  const gpuLine = PY.split("\n").find((l) => /^\s*gpu\s*=\s*"T4"/.test(l)) || "";
  ok(!!gpuLine, "gpu 인자 줄을 찾았다");
  ok(!/\$\s*1\b|\$1 수준/.test(gpuLine),
     `★gpu= 줄에 옛 비용 주장이 붙어 있지 않다★ (지금: ${gpuLine.trim()})`);
  ok(/적혀 있던 말: "12h마다 2분이라 월 크레딧 \$1 수준/.test(PY),
     "옛 주장은 ★역사로 남겨 뒀다★ — 왜 60배 틀렸는지 다음 사람이 읽을 수 있다");
}
ok(/104\.8 GPU시간\/월/.test(PY) && /\$62\/월/.test(PY),
   "비용 주석이 ★실측 근거(회차 분·회/일·GPU시간)★ 를 달고 있다");
ok(/12h 가 아니라 ★6h★/.test(PY), "크론 주기가 주석과 어긋났던 사실도 적혀 있다");

// ── ⑥ 크론과 타임아웃이 서로 말이 되는가 ─────────────────────────────────────
{
  const cron = /modal\.Cron\("(\d+) \*\/(\d+) \* \* \*"\)/.exec(PY);
  const to = /JOB_TIMEOUT_S = (\d+)/.exec(PY);
  const mg = /JOB_MARGIN_S = (\d+)/.exec(PY);
  ok(!!cron && !!to && !!mg, "크론·타임아웃·여유를 소스에서 읽었다");
  if (cron && to && mg) {
    const everyH = Number(cron[2]), T = Number(to[1]), M = Number(mg[1]);
    console.log(`\n     크론 ${everyH}시간마다 · 타임아웃 ${T / 60}분 · 여유 ${M / 60}분\n`);
    ok(T + M < everyH * 3600,
       `★한 회차가 다음 회차를 밀지 않는다★ (타임아웃 ${T / 60}분 < 주기 ${everyH * 60}분)`);
    ok(M > 0 && M < T / 2, `마무리 여유 ${M}s 가 타임아웃의 절반 미만이다`);
  }
}

if (fail) { console.error(`\n✗ 회차 용량 계약 ${fail}건 실패 (총 ${n})`); process.exit(1); }
console.log(`\n✓ 회차 용량 계약 통과 (${n}개 단언)`);
