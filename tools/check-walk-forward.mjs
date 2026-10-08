/* [V33.522] ★다구간 전진평가(부스터 학습 방식)★ — 한 구간·한 조건의 승리는 옮겨지지 않았다(V33.516→518 되돌림).
 *   ① 무겁다 → 사람이 건 target=ablate 회차에서만 돈다(정기 회차 예산을 안 먹는다)
 *   ② 라벨 실험대 끝에서 플래그로만 부른다 · 실패해도 실험대·학습을 안 죽인다
 *   ③ 미리 정한 규칙: 상대 승리(시장중립IC 창 평균 > P · 3/4창 · IC·스프레드 ≥ P) + ★절대 바닥★(자기 시장중립 t ≥ 1.65 · 초과 > 0)
 *   ④ 실제 파이썬으로 잰다 — 국면이 바뀌는 합성 표본에선 최근창 후보를 고르고, 실력 0 표본에선 아무것도 안 고른다 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const T = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
chk(/_ABL_WALKFWD = \(target == "ablate"\)/.test(T) && /^_ABL_WALKFWD = False/m.test(T), "target=ablate 회차에서만 켠다(기본 꺼짐)");
const la = T.slice(T.indexOf("def _label_ablation("), T.indexOf("def _walk_forward_boost("));
chk(/if _ABL_WALKFWD:\n        try:\n[\s\S]{0,200}_walk_forward_boost\(Xs, Ps, TSs, UWs, _MKs, _absmed\)\n        except Exception as e:/.test(la), "실험대 끝에서 플래그로만 · 예외는 삼킨다");
const wf = T.slice(T.indexOf("def _walk_forward_boost("), T.indexOf("def _train_and_upload_boosters("));
chk(/TSs\[:a\] < t_start - gap/.test(wf) && /gap = max\(float\(_EMBARGO_MS or 0\), float\(_HORIZON_MS or 0\)\)/.test(wf), "창마다 그 직전까지만 학습 · 엠바고/지평만큼 비운다(누출 없음)");
chk(/mmt >= 1\.65 and mex is not None and mex > 0/.test(wf) && /wins >= 3/.test(wf), "규칙: 상대 승리 + 절대 바닥(시장중립 t ≥ 1.65 · 초과 > 0)");
chk(!/requests\.|_upload|import-/.test(wf), "아무것도 업로드하지 않는다");
const py = (signal) => `
import ast, numpy as np
src = open(${JSON.stringify(new URL("../trainer/modal/modal_train.py", import.meta.url).pathname)}, encoding="utf-8").read()
tree = ast.parse(src)
want = {"_walk_forward_boost", "_calc_ic", "_calc_ic_blocks", "_demean_by"}
ns = {"_EMBARGO_MS": 2*86400000.0, "_HORIZON_MS": 10*86400000.0}
exec("import numpy as np, math\\n" + "\\n\\n".join(ast.get_source_segment(src, n) for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in want), ns)
rng = np.random.default_rng(1); n = 60000
TS = np.sort(rng.uniform(0, 1500, n)) * 86400000.0 + 1.6e12
X = rng.normal(size=(n, 6)); recent = TS > np.quantile(TS, 0.7)
sig = ${signal ? "np.where(recent, X[:, 1], X[:, 0]) * 0.3" : "np.zeros(n)"}
P = sig + rng.normal(size=n); MK = np.where(rng.uniform(size=n) < 0.5, "us", "kr")
v = ns["_walk_forward_boost"](X, P, TS, np.ones(n), MK, float(np.median(np.abs(P))))
print("ADOPT", ",".join(sorted(k[:2].strip() for k, x in v.items() if x["adopt"])) or "-")
print("NW", min(x["n"] for x in v.values()))
`;
const run = (sig) => { try { return execFileSync("python3", ["-c", py(sig)], { encoding: "utf8", timeout: 240000 }); } catch (e) { return String(e.stdout || "") + String(e.message || ""); } };
const r1 = run(true), r0 = run(false);
const a1 = (/ADOPT (\S+)/.exec(r1) || [])[1], a0 = (/ADOPT (\S+)/.exec(r0) || [])[1];
chk(/NW 4/.test(r1), "4창 모두 채점된다", r1.slice(-300));
chk(a1 && a1.split(",").includes("RL") && !a1.split(",").includes("P"), "국면 전환 합성 표본: 최근창 재적합(RL)을 고른다 · 기준(P)은 후보가 아니다", "ADOPT " + a1);
chk(a0 === "-", "실력 0 합성 표본: 아무것도 고르지 않는다(상대 승리만으로는 안 된다)", "ADOPT " + a0);
if (fails) { console.log("\n✗ 전진평가 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 전진평가 계약 통과");
