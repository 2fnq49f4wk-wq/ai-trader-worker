/* [V33.516] 학습에서 애매한 띠 제외 — 라벨 실험대 공정 비교(같은 전체 검증행 · sign · 실제 pnl)가 고른 줄(D).
 *   ① 워커 설정 하나가 출처(LUXML.trainDropAmbig → cfg.trainDropAmbig · 불리언 그대로)
 *   ② 트레이너는 ★학습행만★ 거른다 — 분할 직후 _tri 에만 적용(검증·보정은 그대로 → 신뢰 관문의 자는 불변)
 *   ③ 부스터·GBDT(·같은 함수를 쓰는 MIND) 모두 · 길이가 안 맞으면 조용히 넘기지 않고 경고
 *   ④ 마스크 동작을 실제 파이썬으로 잰다. */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const W = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const T = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
chk(/trainDropAmbig: LUXML\.trainDropAmbig === true,/.test(W) && /^\s*trainDropAmbig: (true|false),/m.test(W), "워커: 설정 하나(현재 끔 — V33.518 시장중립 블록IC 하락으로 되돌림) · 불리언 그대로 내려보낸다");
chk(/_TRAIN_KEEP = _ambig_keep_mask\(X, PNL, featnames\) if bool\(\(cfg or \{\}\)\.get\("trainDropAmbig"\)\) else None/.test(T), "트레이너: 워커 설정으로만 켠다");
const g = T.slice(T.indexOf("def _train_and_upload_gbdt("), T.indexOf("def _train_and_upload_gbdt(") + 4000);
chk(/horizon_ms=_HORIZON_MS, cal_frac=0\.10, tag=tag\)\n    _tri = _apply_train_keep\(order, _tri, tag\)/.test(g), "GBDT·MIND: 분할 직후 학습행만");
const b = T.slice(T.indexOf("def _train_and_upload_boosters("), T.indexOf("def _train_and_upload_boosters(") + 4000);
chk(/tag="부스팅"\)\n    _tri = _apply_train_keep\(order, _tri, "부스팅"\)/.test(b), "부스터: 분할 직후 학습행만");
chk(/마스크 길이 \{len\(k\)\} ≠ 표본/.test(T), "길이 불일치는 경고하고 종전대로");
// ④ 실제 파이썬 — 함수 둘만 잘라 실행
const s0 = T.indexOf("_TRAIN_KEEP = None\n"), s1 = T.indexOf("def _train_and_upload_gbdt(");
const py = T.slice(s0, s1) + `
import numpy as np
X = np.zeros((10, 2)); X[:, 1] = 2.0           # atrPct = 2
P = np.array([0.01, -0.02, 3, -3, 4, -4, 0.0, 5, -5, 6], dtype=float)
k = _ambig_keep_mask(X, P, ["a", "atrPct"])
import sys
_TRAIN_KEEP = k
order = np.arange(10)[::-1].copy()
tri = np.arange(8)
out = _apply_train_keep(order, tri, "t")
print("K", int(k.sum()), list(map(int, k)))
print("OUT", len(out))
`;
let res = "";
try { res = execFileSync("python3", ["-c", py], { encoding: "utf8" }); } catch (e) { res = String(e.stdout || e.message); }
const km = /K (\d+) \[([^\]]*)\]/.exec(res);
chk(km && +km[1] === 7 && km[2] === "0, 0, 1, 1, 1, 1, 0, 1, 1, 1", "마스크: |pnl/ATR| < 0.25×중앙 3행만 뺀다(부호는 안 바꾼다)", res.trim().slice(0, 200));
chk(/OUT (\d+)/.test(res) && +(/OUT (\d+)/.exec(res)[1]) === 8, "남는 학습행 < 200 이면 종전대로(작은 표본에서 학습을 망가뜨리지 않는다)", res.trim().slice(0, 200));
if (fails) { console.log("\n✗ 학습 띠 제외 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 학습 띠 제외 통과");
