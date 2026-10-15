/* [V33.602 · Phase B+C] 매매법 선택 AI 계약 — trainer/modal/strategy_router.py
 *   ① 무작위 시세(우위 없음)에서는 걷기 검증이 통과하지 않는다(귀무)
 *   ② 한 매매법·국면에만 우위를 심으면 라우터가 그것을 골라 통과하고 '전부 사기'보다 낫다(양성 대조)
 *   ③ 선택은 그 전에 ★끝난★ 표본만 본다 — 미래 라벨을 뒤집어도 과거 선택이 같다
 *   ④ 그림자: 워커 진입 경로가 strat_router 를 읽지 않는다 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const dir = new URL("../trainer/modal/", import.meta.url).pathname;
const py = `
import sys, json, numpy as np, pandas as pd
sys.path.insert(0, ${JSON.stringify(dir)})
import strategy_router as R
rng = np.random.default_rng(5); T, N = 700, 200
c = pd.DataFrame(50*np.exp(np.cumsum(rng.normal(0.0002,0.018,(T,N)),axis=0)))
o = c*(1+rng.normal(0,0.004,(T,N))); P = {"close":c,"open":o,"high":np.maximum(c,o)*1.008,"low":np.minimum(c,o)*0.992,"volume":pd.DataFrame(rng.lognormal(13,.5,(T,N)))}
df, sig, reg = R.build_samples(P, "us"); null = R.walk_forward(df, T)
# 양성 대조: 표본표에 직접 우위를 심는다(SN_RSI2 · BULL 만 +1.5%)
d2 = df.copy(); d2["reg"] = np.where(d2["i"] % 2 == 0, "BULL", "NEUTRAL")
d2["ex"] = rng.normal(-0.3, 3, len(d2)); m = (d2["sid"]=="SN_RSI2") & (d2["reg"]=="BULL"); d2.loc[m,"ex"] += 1.8
pos = R.walk_forward(d2, T)
# 누출: 마지막 블록 이후의 라벨을 바꿔도 앞 블록 추정은 같다
f = T - 100; a = R._shrunk(d2[d2["x"] < f]); d3 = d2.copy(); d3.loc[d3["i"] >= f, "ex"] = 99; b = R._shrunk(d3[d3["x"] < f])
print(json.dumps({"n": len(df), "null": null["pass"], "pos": pos["pass"], "posR": pos["router"], "posB": pos["baseline"], "leak": a != b}))
`;
const r = spawnSync("python3", ["-c", py], { encoding: "utf8", timeout: 300000 });
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
let o = null; try { o = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) {}
chk(o, "라우터를 불러온다", (r.stderr || "").slice(-400));
if (o) {
  chk(o.n > 1000, "표본 생성(Phase B)", String(o.n));
  chk(o.null === false, "귀무: 무작위 시세는 통과 못 한다");
  chk(o.pos === true && o.posR.mean > o.posB.mean, "양성 대조: 심은 우위를 골라 통과 · 전부 사기보다 낫다", JSON.stringify([o.posR, o.posB]));
  chk(o.leak === false, "미래 라벨 누출 없음");
}
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
chk((S.match(/strat_router:/g) || []).length === 2, "그림자: strat_router 는 업로드 저장·조회에서만 쓴다(진입 경로가 읽지 않음)");
chk(/strategy_router\.run\(/.test(readFileSync(dir + "omniq_gha.py", "utf8")), "GHA 회차에 연결");
if (fails) { console.log("check-strategy-router: FAIL " + fails); process.exit(1); }
console.log("check-strategy-router: ok");
