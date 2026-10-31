/* [V33.710] ★더 세심한 칸(k4) 계약★ — 사용자 10/29 "매매법 고르기에 더 많은 조건 · 단 아무것도 못 고르는 일은 없게".
   학습기 flow_bucket·deep_key 와 워커 pbFlowB·pbDeepKey 가 같은 값 → 같은 칸 이름을 내는지 · k4 수축(부모로) · deep 규칙은 후보로만(검증이 고름 · 운 수준 K 포함). */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const R = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const S = R("src/index.js"), PB = R("trainer/modal/playbook_sim.py");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const src = (S.match(/function pbFlowB\(v\)[^\n]*\n/) || [""])[0] + (S.match(/function pbDeepKey\(kfine, grp, flowV\)[^\n]*\n/) || [""])[0];
const W = new Function(src + "; return { pbFlowB, pbDeepKey };")();
const cases = [["BULL|1|2|0|1|0", 0, 0.95], ["BEAR|0|0|2|2|1", 2, 0.9], ["CRASH|3|3|1|0|0", 1, 0.5], ["NEUTRAL|2|1|1|1|0", -1, null], ["SURGE|1|1|1|1|1", null, 0.51], ["BULL|0|0|0|0|0", 2, 0.0]];
const js = cases.map(([k, g, f]) => W.pbDeepKey(k, g, f));
const py = JSON.parse(execFileSync("python3", ["-c", `
import sys, json, numpy as np
sys.path.insert(0, "trainer/modal")
import playbook_sim as PB
C = json.loads(sys.argv[1])
g = np.array(["x" if (c[1] is None or c[1] < 0) else str(int(c[1])) for c in C])
f = PB.flow_bucket(np.array([np.nan if c[2] is None else c[2] for c in C], dtype=float))
print(json.dumps([str(x) for x in PB.deep_key([c[0] for c in C], g, f)]))`, JSON.stringify(cases)], { cwd: new URL("..", import.meta.url), encoding: "utf8" }));
chk(JSON.stringify(js) === JSON.stringify(py), "학습기·워커 k4 칸 이름이 같다(경계 0.5·0.9 · 결측 · 그룹 없음)", JSON.stringify({ js, py }));
chk(/\+ \(\(\(4, 3\),\) if "k4" in df\.columns else \(\)\)/.test(PB), "k4 는 부모(세부 칸)로 수축 — 빈 칸이 '고를 것 없음' 을 늘리지 않는다", "★k4 수축이 빠졌다★");
chk(/"deep": \("k4", "k3", "k2", "k1", "k0"\)/.test(PB), "deep 은 k4 → 세부 → 국면 → 전체 순으로 내려간다", "★deep 단계 순서가 바뀌었다★");
chk(/rules = rules \+ RULES_DEEP/.test(PB) && /\+ len\(RULES_DEEP\)\)/.test(PB), "deep 규칙은 후보로만(검증 구간 · 운 수준 K 포함)", "★deep 규칙이 검증 없이 쓰인다★");
chk(/_rl && _rl\.level === "deep" \? \[pbDeepKey\(ks\[0\], grp, st\.daily\.flow && st\.daily\.flow\[ctx\.symbol\]\)\]\.concat\(ks\) : ks/.test(S), "워커는 deep 규칙일 때만 k4 를 앞에 붙인다", "★워커 k4 배선이 끊겼다★");
if (fails) { console.log("✗ 더 세심한 칸 계약 실패 " + fails); process.exit(1); }
console.log("✓ 더 세심한 칸 계약 통과");
