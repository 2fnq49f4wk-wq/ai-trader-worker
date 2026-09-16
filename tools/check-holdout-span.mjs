/* [V33.376] 홀드아웃을 ★기간★ 으로 정하는가 — 실제로 _split_ts 를 돌려 본다.
 *
 *   ★왜★ G-2 가 남긴 실측: 위원 대부분이 못 드는 이유는 실력이 아니라 검정력이었다.
 *     XGB t 1.36 · LGB 1.48 · CAT 1.14 — 전부 문턱 1.65 ★바로 아래★ 다.
 *     t = ICIR × √K 이고 K(겹치지 않는 관측)는 ★행 수가 아니라 기간★ 에서 나온다.
 *     그런데 분할은 기간을 한 번도 안 봤다 — 행의 20% 를 떼고 끝이었다.
 *
 *   ★문턱은 건드리지 않는다.★ (B-6 "문턱을 낮춰 수를 늘리지 말 것.")
 *   늘리는 것은 관측 기간이고, 그건 ★더 엄한 시험★ 이다 — 더 긴 기간에 걸쳐
 *   일관되게 맞혀야 t 가 선다.
 *
 *   ★그리고 이 코드는 잘못 쓰면 학습을 굶긴다.★ 홀드아웃은 시간축 뒤쪽이라,
 *   늘리는 만큼 학습이 최근을 못 본다. 두 상한이 실제로 작동하는지를 여기서 본다.
 *   글자가 아니라 ★소스의 그 함수를 꺼내 돌린다★.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fails++; console.error("  ✗ FAIL " + m); } };

// ── 소스에서 정책·함수를 그대로 잘라 온다(베끼면 언젠가 갈라진다) ──────────────
const iH = PY.indexOf("HOLDOUT = {");
const iF = PY.indexOf("def _holdout_rows(");
const iS = PY.indexOf("def _split_ts(");
const iE = PY.indexOf("def _neff_of(");
ok(iH > 0 && iF > iH && iS > iF && iE > iS, "정책표 HOLDOUT · _holdout_rows · _split_ts 를 소스에서 찾았다");
if (iH < 0 || iE < 0) { console.error("\n✗ 소스 구조가 바뀌었다"); process.exit(1); }
const SRC = PY.slice(iH, iE);

const script = `
import json, sys, contextlib, numpy as np
${SRC}
DAY = 86400000
def run(total_days, rows, val_frac=0.2, horizon_d=10, min_val=200, skew=1.3, **kw):
    # 거래일처럼 ★고르지 않게★ 흩뿌린다 — 균일 격자면 행 비율과 기간이 우연히 같아진다.
    rng = np.random.default_rng(7)
    # skew>1 이면 ★최근에 행이 몰린다★(거래가 늘어난 판). 균일 격자면 행 비율과 기간이 우연히 같아진다.
    u = np.sort(rng.random(rows))
    ts = (1.0 - (1.0 - u) ** skew) * (total_days * DAY)
    # 진단 출력은 stderr 로 보낸다 — stdout 은 이 하네스의 JSON 통로다.
    with contextlib.redirect_stdout(sys.stderr):
        order, tr, cal, va, nval, emb = _split_ts(ts, val_frac, 0, min_val=min_val,
                                                  horizon_ms=horizon_d * DAY, **kw)
    ts_s = np.sort(ts)
    hs = (ts_s[-1] - ts_s[len(ts_s) - nval]) / DAY
    trs = (ts_s[len(ts_s) - nval] - ts_s[0]) / DAY
    return {"nval": int(nval), "rows": rows, "frac": nval / rows,
            "holdDays": float(hs), "trainDays": float(trs),
            "blocks": int(hs // (2 * horizon_d)), "ntr": int(len(tr))}
out = {
  "policy": HOLDOUT,
  # 옛 동작(정책을 끄면) — 행의 20% 그대로여야 한다. 아래 rich 와 ★같은 표본★ 이다.
  "off":    run(1000, 60000, skew=1.0, min_blocks=0),
  # 기간은 있는데 20% 로는 목표(블록 12개=240일)에 못 닿는 판 — 늘려서 닿아야 한다
  "rich":   run(1000, 60000, skew=1.0),
  # 표본이 옛날에 몰린 판 — 뒤쪽 행을 조금만 떼도 달력이 크게 먹힌다 → ★학습 기간 보호★ 가 건다
  "span":   run(600, 60000, skew=0.7),
  "spanOff": run(600, 60000, skew=0.7, min_blocks=0),
  # 최근에 행이 몰린 판 — 목표 기간을 덮으려면 행을 너무 많이 떼야 한다 → ★행 상한★ 이 건다
  "rowcap": run(1000, 60000, skew=4.0),
  # 이미 20% 가 목표를 넘는 판 — ★줄이면 안 된다★
  "big":    run(20000, 60000, skew=1.0),
}
print(json.dumps(out))
`;
const tmp = join(tmpdir(), "hspan-" + process.pid + ".py");
let R;
try {
  writeFileSync(tmp, script);
  R = JSON.parse(execFileSync("python3", [tmp], { encoding: "utf8", timeout: 300000 }).trim());
} catch (e) {
  console.error("  ✗ FAIL 모의 실행 실패: " + String(e.stdout || e.message).slice(0, 400));
  process.exit(1);
} finally { try { unlinkSync(tmp); } catch (e) {} }

const P = R.policy;
console.log(`\n     정책: 목표 블록 ${P.minBlocks}개 · 행 상한 ${(P.maxFrac * 100).toFixed(0)}% · 학습기간 ≥ ${P.trainSpanMult}×홀드아웃\n`);
for (const k of ["off", "rich", "span", "rowcap", "big"]) {
  const r = R[k];
  console.log(`     ${k.padEnd(6)} 홀드아웃 ${r.holdDays.toFixed(0).padStart(5)}일 · 학습 ${r.trainDays.toFixed(0).padStart(5)}일`
            + ` · 행 ${(r.frac * 100).toFixed(1).padStart(5)}% · 블록 ${String(r.blocks).padStart(3)}개`);
}
console.log("");

// ── ① 끄면 옛 동작 그대로인가(무해성) ──────────────────────────────────────
ok(Math.abs(R.off.frac - 0.2) < 0.01, "정책을 끄면 ★행의 20%★ 그대로다 — 새 규칙이 없던 동작을 덮지 않는다");
ok(R.off.blocks < P.minBlocks,
   `그 옛 동작에서는 블록이 ${R.off.blocks}개뿐이다 — ★이것이 고치려는 상태다★(목표 ${P.minBlocks})`);

// ── ② 기간이 있으면 실제로 목표를 채우는가 ────────────────────────────────
ok(R.rich.blocks >= P.minBlocks,
   `기간이 넉넉하면 블록 ${R.rich.blocks}개 ≥ 목표 ${P.minBlocks} — ★검정력을 기간으로 확보한다★`);
ok(R.rich.frac > R.off.frac, "그러기 위해 홀드아웃을 늘렸다(행 비율이 20% 보다 크다)");
ok(R.rich.holdDays > R.off.holdDays, `늘어난 것이 ★기간★ 이다 — ${R.off.holdDays.toFixed(0)}일 → ${R.rich.holdDays.toFixed(0)}일`);
ok(R.rich.blocks > R.off.blocks, `그 결과 블록이 ${R.off.blocks} → ${R.rich.blocks} 개로 는다(t = ICIR×√K 의 K 다)`);

// ── ③ ★학습을 굶기지 않는가★ — 두 상한이 실제로 걸리는가 ──────────────────
ok(R.rich.frac <= P.maxFrac + 1e-6, `행 상한 ${(P.maxFrac * 100).toFixed(0)}% 를 넘지 않는다`);
ok(R.rowcap.frac <= P.maxFrac + 1e-6, `최근에 행이 몰린 판에서도 ★행 상한에서 멈춘다★(${(R.rowcap.frac * 100).toFixed(1)}%)`);
ok(R.span.holdDays > R.spanOff.holdDays, "그 판도 늘리기는 한다(늘림 자체가 막힌 게 아니다)");
ok(R.span.trainDays >= P.trainSpanMult * R.span.holdDays * 0.98,
   `그러나 ★학습 기간 ${R.span.trainDays.toFixed(0)}일 = ${P.trainSpanMult}×홀드아웃 ${R.span.holdDays.toFixed(0)}일★ 에서 멈춘다 — 학습을 굶기지 않는다`);
ok(R.span.frac < P.maxFrac - 1e-6,
   `그때 멈춘 이유가 행 상한이 아니다(행 ${(R.span.frac * 100).toFixed(1)}% < ${(P.maxFrac * 100).toFixed(0)}%) — ★기간 보호가 실제로 작동한다★`);
ok(R.span.blocks < P.minBlocks,
   "그래서 그 판은 목표에 못 닿는다 — ★못 닿았다는 사실을 숨기지 않는다★(로그가 말한다)");
ok(R.rich.ntr > 0 && R.span.ntr > 0 && R.rowcap.ntr > 0 && R.big.ntr > 0, "어느 판에서도 학습 집합이 비지 않는다");

// ── ④ 절대 ★줄이지★ 않는가 ────────────────────────────────────────────────
ok(R.big.frac >= 0.2 - 1e-6,
   "이미 20% 가 목표를 넘는 판에서 홀드아웃을 ★줄이지 않는다★ — 줄이면 그건 문턱을 낮추는 것과 같다");

// ── ⑤ 상한이 정책표 한 곳에서 오는가 ──────────────────────────────────────
ok(typeof P.minBlocks === "number" && typeof P.maxFrac === "number" && typeof P.trainSpanMult === "number",
   "세 값이 전부 정책표 HOLDOUT 에 있다 — 학습기마다 손으로 적히지 않는다");
/* ★정책값 자체에도 상한이 있어야 한다.★ 상한을 크게 열면 "행 상한을 넘지 않는다" 라는
   위 단언은 그대로 통과하면서 학습이 굶는다 — 돌연변이 시험에서 실제로 안 잡혔다.
   검정력을 얻자고 학습을 반 넘게 떼면 모델 자체가 무너진다. 그건 다른 방식의 자해다. */
ok(P.maxFrac <= 0.40, `행 상한 ${(P.maxFrac * 100).toFixed(0)}% 가 40% 이하다 — 검정력을 얻자고 학습을 굶기지 않는다`);
ok(P.trainSpanMult >= 1.5, `학습 기간 배수 ${P.trainSpanMult} ≥ 1.5 — 학습이 홀드아웃보다 짧아지지 않는다`);
ok(P.minBlocks >= 6, `목표 블록 ${P.minBlocks} ≥ 6 — 6 미만이면 t 검정의 명목 수준 자체가 안 맞는다(df 5)`);
ok(R.rowcap.trainDays > R.rowcap.holdDays * P.trainSpanMult,
   "행 상한에 걸린 판에서도 학습 기간이 홀드아웃보다 충분히 길다");
ok(/_holdout_rows\(ts_s, nval, horizon_ms, min_blocks, max_frac\)/.test(PY),
   "_split_ts 가 그 한 곳을 부른다 — 학습기 6곳이 같은 자를 쓴다");
{
  const calls = (PY.match(/_split_ts\(/g) || []).length - 1;
  ok(calls >= 6, `학습기 ${calls}곳이 전부 이 분할을 쓴다(한 곳만 고치면 자가 다시 갈린다)`);
}

if (fails) { console.error(`\n✗ 홀드아웃 기간 계약 ${fails}건 실패 (총 ${n})`); process.exit(1); }
console.log(`\n✓ 홀드아웃 기간 계약 통과 (${n}개 단언) — 문턱이 아니라 ★관측 기간★ 으로 검정력을 얻는다`);
