/* [V33.488] OMNI 섀도우 전용 업로드 — 실력 관문 미달이어도 올리되(패널 신선 → 섀도우 전진검증이 돈다) 라이브 발언은 0.
   사고: 관문이 엄해진 뒤 모든 회차가 미달 → 아무것도 안 올라감 → 패널 낡음 → "[OMNI-SHADOW] 패널이 N일 낡았다 — 채점하지 않는다".
   ① 학습기: 관문 미달에서 일찍 돌아가지 않고 머리를 발언 0 으로 묶어 올린다 · shadowOnly 표시 · 자가검사
   ② 워커: shadowOnly 면 머리를 한 번 더 발언 0 으로 묶는다 · omniHeadsOk 가 그런 머리를 안 센다 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/omni.py", import.meta.url), "utf8");
const ST = readFileSync(new URL("../trainer/modal/omni_selftest.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
console.log("① 학습기");
chk(/_shadow_only = not _edge\["ok"\]/.test(PY) && !/if len\(trees\) < 2 or not _edge\["ok"\]:/.test(PY), "관문 미달이 업로드를 막지 않는다(나무 < 2 만 막는다)", "★관문 미달이면 아무것도 안 올린다 — 섀도우 채점이 다시 굶는다★");
chk(/h\["ok"\] = False\s*\n\s*h\["tau"\] = None/.test(PY) && /"shadowOnly": bool\(rep\.get\("shadowOnly"\)\)/.test(PY), "머리 전부 발언 0(ok=False · tau=None) · shadowOnly 표시", "★미달 모델의 머리가 발언할 수 있다★");
chk(/def check_shadow_upload\(data\)/.test(ST) && /fails \+= check_shadow_upload\(data\)/.test(ST), "자가검사가 관문 미달 업로드를 실제로 돌려 본다", "★자가검사가 없다★");
console.log("② 워커");
chk(/const _shadowOnly = body\.shadowOnly === true;/.test(S) && /_h\.ok = false; _h\.tau = null;/.test(S), "shadowOnly 업로드는 워커가 한 번 더 발언 0 으로 묶는다", "★워커가 학습기를 그대로 믿는다★");
chk(M.omniHeadsOk({ "5d": { ok: false, tau: null }, "20d": { ok: true, tau: 0.6 }, "1d": { ok: true, tau: null } }).join() === "20d", "omniHeadsOk: ok===true 이고 tau 가 숫자인 머리만", "★발언 0 머리를 센다★");
console.log(fails ? "\n✗ 섀도우 전용 업로드 검사 실패 " + fails : "\n✓ 섀도우 전용 업로드 검사 통과");
process.exit(fails ? 1 : 0);
