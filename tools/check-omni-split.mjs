/* [V33.480] OMNI 시장 분리 실험 배선 — 재기만(업로드 거부) · 실력 관문 앞에서 돈다 · Modal/워크플로 입력 · 자가검사 포함. */
import { readFileSync } from "node:fs";
/* 경로는 ★글자 그대로★ — 앵커 메타검사(check-gate-anchors)가 이 형태로만 읽는 파일을 찾는다(동적 경로면 조용히 건너뛴다). */
const PY = readFileSync(new URL("../trainer/modal/omni.py", import.meta.url), "utf8");
const MT = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const MD = readFileSync(new URL("../.github/workflows/modal-deploy.yml", import.meta.url), "utf8");
const ST = readFileSync(new URL("../trainer/modal/omni_selftest.py", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const RUN = PY.slice(PY.indexOf("def run(BASE"));
const iS = RUN.indexOf("    if SPLIT:\n"), iG = RUN.indexOf('    if len(trees) < 2 or not _edge["ok"]:');
chk(/SPLIT = os\.environ\.get\("OMNI_SPLIT"\) == "1"/.test(PY) && /def split_compare\(A, rep_pool/.test(PY), "스위치 · split_compare", "★시장 분리 실험이 없다★");
chk(iS > 0 && iG > 0 && iS < iG, "실력 관문 앞에서 잰다(섞은 모델이 무실력이어도 돈다)", "★관문 뒤에 있다★");
chk(/OMNI_SPLIT 실험 회차 — 업로드 안 함/.test(RUN.slice(iS, iG)) && /rep\["ok"\] = False/.test(RUN.slice(iS, iG)), "업로드 거부", "★실험 회차가 업로드할 수 있다★");
chk(/adopt = bool\(e\.get\("ok"\)\) and gain is not None and gain >= SPLIT_GAIN and wins >= 2/.test(PY), "판정: 같은 실력 관문 + 섞음 대비 +0.005 + 전진 2승", "★판정 규칙이 바뀌었다★");
chk(/split: int = 0/.test(MT) && /os\.environ\["OMNI_SPLIT"\] = "1"/.test(MT) && /omni_split:/.test(MD) && /--split \$\{\{ inputs\.omni_split && 1 \|\| 0 \}\}/.test(MD), "Modal 입력(omni_split → --split → OMNI_SPLIT)", "★손으로 돌릴 방법이 없다★");
chk(/def check_split\(\)/.test(ST) && /\n    check_split\(\)\n/.test(ST), "학습기 자가검사: 반대 신호 통과 · 잡음 불통과", "★자가검사가 없다★");
/* [V33.481] 전진 평가 — 같은 규율(관문 앞 · 업로드 거부 · 입력 배선 · 자가검사) + 판정 규칙이 낮아지지 않았나 */
const iW = RUN.indexOf("    if WF:\n");
chk(/WF = os\.environ\.get\("OMNI_WF"\) == "1"/.test(PY) && /def wf_eval\(A, rep_pool/.test(PY) && iW > 0 && iW < iG && /OMNI_WF 실험 회차 — 업로드 안 함/.test(RUN.slice(iW, iG)), "전진 평가: 관문 앞 · 업로드 거부", "★전진 평가 배선이 틀렸다★");
chk(/auc - 0\.5 >= 0\.005 and tA is not None and tA >= 3\.0/.test(PY) && /pk\["net"\] > 0 and tN is not None and tN >= 2\.0/.test(PY) && /adj = WF_HDAYS\[hz\] \*\* 0\.5/.test(PY), "판정: AUC+0.005 · 날짜 t≥3 · 비용 뺀 순초과>0 · t≥2 (장타는 √일수로 깎음)", "★전진 평가 판정이 느슨해졌다★");
chk(/wf: int = 0/.test(MT) && /os\.environ\["OMNI_WF"\] = "1"/.test(MT) && /omni_wf:/.test(MD) && /--wf \$\{\{ inputs\.omni_wf && 1 \|\| 0 \}\}/.test(MD) && /def check_wf\(\)/.test(ST) && /\n    check_wf\(\)\n/.test(ST), "Modal 입력 · 자가검사", "★전진 평가 입력 또는 자가검사가 없다★");
console.log(fails ? "\n✗ 시장 분리 실험 검사 실패 " + fails : "\n✓ 시장 분리 실험 검사 통과");
process.exit(fails ? 1 : 0);
