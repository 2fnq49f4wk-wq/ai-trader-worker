/* [V33.529] Vibe-Trading 팩터 선별기(trainer/modal/factor_screen.py) — 실제 파이썬으로 잰다.
 *   ① 귀무: 실력 0 합성 일봉(무작위 걸음)에서 qlib158 60개를 재면 ★통과 0★ (Newey-West + 위약 문턱 + 반분 재현)
 *   ② 양성 대조: 오늘 몸통(종가−시가)/시가 가 2~6일 뒤 수익을 밀어 올리도록 심으면 qlib158_kmid 를 ★찾는다★
 *   ③ 라이선스: vt/ 에 MIT LICENSE · NOTICE · qlib158 Apache 표기 · 수정 표기 · 업스트림 커밋이 있다
 *   ④ 업로드 없음 — 선별기는 연구용(운영 반영은 모델 전진평가·신뢰 관문을 다시 거친다) */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
const T = new URL("../trainer/modal/", import.meta.url).pathname;
const S = readFileSync(T + "factor_screen.py", "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
chk(existsSync(T + "vt/LICENSE") && /MIT License/.test(readFileSync(T + "vt/LICENSE", "utf8")) && existsSync(T + "vt/NOTICE")
  && existsSync(T + "vt/src/factors/zoo/qlib158/LICENSE.md") && existsSync(T + "vt/UPSTREAM_COMMIT") && /\[LUX 수정/.test(readFileSync(T + "vt/src/factors/_backend.py", "utf8")),
  "vt/: MIT LICENSE·NOTICE · qlib158 Apache 표기 · 업스트림 커밋 · 수정 표기");
chk(!/requests\.|import requests|\/api\//.test(S), "선별기는 아무것도 올리지 않는다(네트워크 없음)");
const py = (plant) => `
import sys, time, numpy as np
sys.path.insert(0, ${JSON.stringify(T)})
import factor_screen as fs
rng = np.random.default_rng(7)
daily, mk = {}, {}
T, N = 460, 70
for i in range(N):
    s = "S%03d" % i
    o = np.zeros(T); c = np.zeros(T); h = np.zeros(T); l = np.zeros(T)
    drift = np.zeros(T + 10)
    prev = 100.0
    for t in range(T):
        o[t] = prev * (1 + rng.normal(0, .006))
        c[t] = o[t] * np.exp(rng.normal(0, .018) + drift[t])
        km = (c[t] - o[t]) / o[t]
        ${plant ? "drift[t+2:t+7] += 0.12 * km" : "pass"}
        h[t] = max(o[t], c[t]) * (1 + abs(rng.normal(0, .006))); l[t] = min(o[t], c[t]) * (1 - abs(rng.normal(0, .006)))
        prev = c[t]
    daily[s] = {"t": [1.6e12 + k * 86400000 for k in range(T)], "o": list(o), "h": list(h), "l": list(l), "c": list(c), "v": list(rng.lognormal(10, .5, T))}
    mk[s] = "us"
dk = lambda t: int(time.strftime("%Y%m%d", time.gmtime(t / 1000)))
fs.ZOOS = ("qlib158",)
out = fs.screen(daily, mk, dk, log=lambda *a: None, limit_factors=60)
print("PASSED", ",".join(sorted(set(p[0] for p in out["passed"]))) or "-")
`;
const run = (p) => { try { return execFileSync("python3", ["-c", py(p)], { encoding: "utf8", timeout: 600000 }); } catch (e) { return String(e.stdout || "") + String(e.stderr || e.message); } };
const r0 = run(false), r1 = run(true);
const p0 = (/PASSED (\S+)/.exec(r0) || [])[1], p1 = (/PASSED (\S+)/.exec(r1) || [])[1];
chk(p0 === "-", "귀무(실력 0): 통과 0", "PASSED " + p0 + " " + r0.slice(-300));
chk(p1 && p1.split(",").includes("qlib158_kmid"), "양성 대조(몸통이 2~6일 뒤 수익을 민다): qlib158_kmid 를 찾는다", "PASSED " + p1 + " " + r1.slice(-300));
if (fails) { console.log("\n✗ 팩터 선별기 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 팩터 선별기 계약 통과");
