/* [V33.531] 포트폴리오 실험실(trainer/modal/portfolio_lab.py) — Qlib TopK-Dropout + Vibe-Trading 부품. 실제 파이썬으로 잰다.
 *   ① Vibe 부품을 진짜로 쓴다: 퍼지·엠바고 전진 분할 · 디플레이티드 샤프 · 동일변동성/위험균형 최적화기 · 부트스트랩 샤프 CI · 동물원 피처
 *   ② 귀무(실력 0): 통과 구성 0 · ③ 양성 대조(몸통이 2~6일 뒤 수익을 민다): 통과 · ④ 업로드 없음 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const T = new URL("../trainer/modal/", import.meta.url).pathname;
const S = readFileSync(T + "portfolio_lab.py", "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
chk(/from src\.quantlib\.crossvalidation import purged_walk_forward_splits/.test(S) && /mt\.deflated_sharpe_ratio\(/.test(S)
  && /ev\.optimize\(/.test(S) && /rp\.optimize\(/.test(S) && /bootstrap_sharpe_ci\(/.test(S) && /\("qlib158", "academic"\)/.test(S), "Vibe 부품(분할·DSR·최적화기·부트스트랩·동물원)을 실제로 부른다");
chk(/def _topk_dropout\(/.test(S) && /n_drop/.test(S), "Qlib TopK-Dropout(하루 최대 n_drop 교체 — 회전 상한)");
chk(!/requests\.|\/api\//.test(S), "업로드 없음(연구용)");
const py = (plant) => `
import sys, time, numpy as np
sys.path.insert(0, ${JSON.stringify(T)})
import portfolio_lab as pl, factor_screen as fs
fs.PER_FACTOR_SEC = 60
rng = np.random.default_rng(5)
daily, mk = {}, {}
T, N = 480, 70
for i in range(N):
    s = "S%03d" % i
    o = np.zeros(T); c = np.zeros(T); h = np.zeros(T); l = np.zeros(T); drift = np.zeros(T + 10); prev = 100.0
    for t in range(T):
        o[t] = prev * (1 + rng.normal(0, .006)); c[t] = o[t] * np.exp(rng.normal(0, .018) + drift[t])
        ${plant ? "drift[t+2:t+7] += 0.10 * (c[t] - o[t]) / o[t]" : "pass"}
        h[t] = max(o[t], c[t]) * (1 + abs(rng.normal(0, .006))); l[t] = min(o[t], c[t]) * (1 - abs(rng.normal(0, .006))); prev = c[t]
    daily[s] = {"t": [1.6e12 + k * 86400000 for k in range(T)], "o": list(o), "h": list(h), "l": list(l), "c": list(c), "v": list(rng.lognormal(10, .5, T))}
    mk[s] = "us"
dk = lambda t: int(time.strftime("%Y%m%d", time.gmtime(t / 1000)))
v = pl.run_lab(daily, mk, dk, log=lambda *a: None)
print("PASS", "yes" if v.get("us") else "no")
`;
const run = (p) => { try { return execFileSync("python3", ["-c", py(p)], { encoding: "utf8", timeout: 900000 }); } catch (e) { return String(e.stdout || "") + String(e.stderr || e.message); } };
const r0 = run(false), r1 = run(true);
chk(/PASS no/.test(r0), "귀무(실력 0): 통과 구성 없음", r0.slice(-300));
chk(/PASS yes/.test(r1), "양성 대조: 통과", r1.slice(-300));
if (fails) { console.log("\n✗ 포트폴리오 실험실 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 포트폴리오 실험실 계약 통과");
