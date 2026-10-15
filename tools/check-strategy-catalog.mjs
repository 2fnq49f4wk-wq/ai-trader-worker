/* [V33.601 · Phase A] 매매법 도감 계약 — trainer/modal/strategy_catalog.py
 *   ① 모든 매매법이 같은 규격(id · family · horizon · entry · exit · regimes · status)이고 17개가 신호를 낸다
 *   ② ★미래 정보 누출 없음★ — 끝 20일을 지워도 앞 구간 신호가 같다(가짜 학습 표본을 막는다)
 *   ③ 거래량이 없어도 죽지 않는다 · 단타는 BLOCKED(학습 제외) · 과열 이탈은 진입이 아닌 청산 신호
 *   ④ 워커 규칙의 핵심 문턱이 도감과 같다(한쪽만 바꾸면 갈라진다) */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const dir = new URL("../trainer/modal/", import.meta.url).pathname;
const py = `
import sys, json, numpy as np, pandas as pd
sys.path.insert(0, ${JSON.stringify(dir)})
import strategy_catalog as C
rng = np.random.default_rng(3); T, N = 700, 60
mk = np.cumsum(rng.normal(0.0003, 0.008, T))
c = pd.DataFrame(50*np.exp(mk[:,None]+np.cumsum(rng.normal(0,0.017,(T,N)),axis=0)))
o = c.shift(1).fillna(c); h = np.maximum(c,o)*(1+rng.uniform(0,0.01,(T,N))); l = np.minimum(c,o)*(1-rng.uniform(0,0.01,(T,N)))
v = pd.DataFrame(rng.lognormal(13,0.5,(T,N))*(1+3*(rng.random((T,N))<0.03)))
P = {"close":c,"open":o,"high":h,"low":l,"volume":v}
S = C.signals(P); S2 = C.signals({k:x.iloc[:-20] for k,x in P.items()})
S3 = C.signals({k:x for k,x in P.items() if k!="volume"})
print(json.dumps({"n": len(C.CATALOG), "fired": {k:int(d.values.sum()) for k,d in S.items()},
  "leak": [k for k in S if not S[k].iloc[:-20].equals(S2[k])], "novol": int(sum(d.values.sum() for d in S3.values())),
  "keys": sorted(set().union(*[set(d.keys()) for d in C.describe()])), "blocked": [b["id"] for b in C.BLOCKED],
  "exitsig": list(C.EXIT_SIGNALS), "clusters": {k:len(v) for k,v in C.CLUSTERS.items()}}))
`;
const r = spawnSync("python3", ["-c", py], { encoding: "utf8", timeout: 120000 });
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
let o = null; try { o = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) {}
chk(o, "도감을 불러온다", (r.stderr || "").slice(-300));
if (o) {
  chk(o.n === 19 && Object.values(o.fired).filter((x) => x > 0).length >= 18, "19개 매매법(V33.618 폭락장 반등 2종 포함) · 거의 전부 신호를 낸다", JSON.stringify(o.fired));
  chk(["cluster", "exit", "family", "horizon", "id", "note", "regimes", "status"].every((k) => o.keys.includes(k)), "같은 규격(family·horizon·exit·regimes·status)");
  chk(o.leak.length === 0, "미래 정보 누출 없음(끝 20일을 지워도 앞 구간 신호 동일)", JSON.stringify(o.leak));
  chk(o.novol > 0, "거래량이 없어도 죽지 않는다");
  chk(o.blocked.includes("SC_VWAP") && o.exitsig.includes("stoch_overbought_exit"), "단타는 학습 제외 · 과열 이탈은 청산 신호(공매도 없음)");
  chk(o.clusters.TREND >= 5 && o.clusters.MEANREV >= 5 && o.clusters.VOLVOL >= 3, "표본 부족 대비 3개 묶음(TREND·MEANREV·VOLVOL)");
}
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8"), Q = readFileSync(dir + "strategy_catalog.py", "utf8");
chk(/rsi2Max != null \? sn\.rsi2Max : 12/.test(S) && /I\["rsi2"\] <= 12/.test(Q), "SN_RSI2 문턱(RSI2 ≤ 12)이 워커와 같다");
chk(/pullbackBandPct \|\| 4/.test(S) && /gap <= 0\.04/.test(Q), "TR_PULLBACK 밴드(±4%)가 워커와 같다");
chk(/volMult: 3\.0, minDropPct: -4\.0, maxDropPct: -18\.0/.test(S) && /vr"\] >= 3\.0.*-4\.0.*-18\.0/s.test(Q), "VS_REV 문턱(3배 · −4~−18%)이 워커와 같다");
if (fails) { console.log("check-strategy-catalog: FAIL " + fails); process.exit(1); }
console.log("check-strategy-catalog: ok");
