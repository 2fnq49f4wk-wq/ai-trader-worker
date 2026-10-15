/* [V33.602 · Phase B+C] 매매법 선택 AI 계약 — trainer/modal/strategy_router.py
 *   ① 무작위 시세(우위 없음)에서는 걷기 검증이 통과하지 않는다(귀무)
 *   ② 한 매매법·국면에만 우위를 심으면 라우터가 그것을 골라 통과하고 '전부 사기'보다 낫다(양성 대조)
 *   ③ 선택은 그 전에 ★끝난★ 표본만 본다 — 미래 라벨을 뒤집어도 과거 선택이 같다
 *   ④ [V33.603] 실전 경로 STRAT_ROUTE — 워커 관문 재판정 · 신선도 · 잠정 크기 · 꼬리표 · 최대 보유 청산 */
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
chk(/mult: 0\.5/.test(S.slice(S.indexOf("const STRAT_ROUTE"), S.indexOf("const STRAT_ROUTE") + 200)) && /signal\.isStratRoute && !\(signal\.sr && signal\.sr\.primary\) && STRAT_ROUTE\.mult/.test(S), "잠정 크기 ×0.5(주력 전환 시장 제외)");
chk(/\? "SROUTE"/.test(S) && /LIKE '\[SROUTE\]%'/.test(S), "원장 꼬리표 [SROUTE] · 하루 상한");
chk(/"SR-TIME "/.test(S) && /sr: \(signal && signal\.isStratRoute/.test(S), "그 매매법 최대 보유일 → SR-TIME 청산");
chk(/"hold": ex\["hold"\], "horizon": cat\[r\.sid\]\["horizon"\]/.test(readFileSync(dir + "strategy_router.py", "utf8")), "학습기가 picks 에 보유일·기간을 싣는다");
chk(/signal\.isStratRoute && signal\.sr && _num\(signal\.sr\.stop, 0\) > 0\)[^\n]*\n\s*\? \{ stopPctOverride: signal\.sr\.stop \}/.test(S), "[V33.605] 매매법별 손절폭이 실전 매수 손절로 들어간다");
chk(/LAST_X\[mk\] = /.test(readFileSync(dir + "omni_q.py", "utf8")) && /omni_x=omni_q\.LAST_X/.test(readFileSync(dir + "omniq_gha.py", "utf8")), "[V33.605] OMNI-Q 피처를 매매법 선택이 빌려 쓴다");
{ const Q = readFileSync(dir + "strategy_router.py", "utf8");
  chk(/"CRASH", "SURGE"/.test(Q) && /r <= -0\.025\) \| \(r5 <= -0\.06/.test(Q), "[V33.606] 폭락·폭등 국면(하루 ±2.5% · 5일 ±6% · 3거래일)");
  chk(/"ev_fomc_to"/.test(Q) && /20261028/.test(Q) && /omni\.earn_feats/.test(Q) && /omni\.news_feats/.test(Q), "[V33.606] 거시 발표 전후 · 실적 · 뉴스 피처");
  chk(/events=ev\)/.test(readFileSync(dir + "omniq_gha.py", "utf8")), "실적·뉴스 이력을 GHA 회차가 넘긴다"); }
chk(/strategy_router\.run\(/.test(readFileSync(dir + "omniq_gha.py", "utf8")), "GHA 회차에 연결");
if (fails) { console.log("check-strategy-router: FAIL " + fails); process.exit(1); }
console.log("check-strategy-router: ok");
