/* [V33.620] OMNI-Q 거시·섹터 피처 계약 — trainer/modal/omni_q._macro_feats
 *   ① 섹터 자동 배정: 섹터 ETF 와 같이 움직이는 종목을 그 섹터로(미국 = 같은 날 · 한국 = 전날 미국)
 *   ② 미래 누출 없음: 어느 날 이후의 ETF·거시(발표) 값을 바꿔도 그 날까지의 피처는 같다
 *   ③ 서프라이즈 = 실제 변화 − 직전 추세(표준화) · 발표 뒤 반감 · 한국은 발표 다음 날부터
 *   ④ 순위 피처라 그날 모두 같은 값은 쓸모없다 → 거시는 종목별 민감도 × 거시 상태로 넣는다 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const dir = new URL("../trainer/modal/", import.meta.url).pathname;
const py = `
import sys, json, numpy as np, pandas as pd
sys.path.insert(0, ${JSON.stringify(dir)})
import omni_q as Q
rng = np.random.default_rng(1); T = 700
idx = [int((pd.Timestamp("2023-01-02") + pd.Timedelta(days=int(k * 1.4))).strftime("%Y%m%d")) for k in range(T)]
mkt = rng.normal(0.0004, 0.01, T); rate = rng.normal(0, 0.008, T)
secs = Q.SECTOR_ETFS; fac = {s: rng.normal(0, 0.008, T) for s in secs}
etf = {"SPY": 100 * np.cumprod(1 + mkt), "TLT": 100 * np.cumprod(1 + rate), "GLD": 100 * np.cumprod(1 + rng.normal(0, .01, T))}
for s in secs: etf[s] = 100 * np.cumprod(1 + mkt + fac[s])
N = 80; true = rng.integers(0, len(secs), N)
lag = lambda x: np.concatenate([[0], x[:-1]])
Cu = {"S%d" % j: 50 * np.cumprod(1 + mkt + fac[secs[true[j]]] + rng.normal(0, 0.012, T)) for j in range(N)}
Ck = {"S%d" % j: 50 * np.cumprod(1 + 0.6 * lag(mkt + fac[secs[true[j]]]) + rng.normal(0, 0.012, T)) for j in range(N)}
mon = pd.date_range("2018-01-01", "2026-09-01", freq="MS")
fred = {sid: [(d.strftime("%Y-%m-%d"), 100 * (1.002 ** k) * (1 + rng.normal(0, 0.002))) for k, d in enumerate(mon)] for sid in ("CPIAUCSL", "CPILFESL", "PPIFIS", "PAYEMS")}
fred["UNRATE"] = [(d.strftime("%Y-%m-%d"), 4 + rng.normal(0, 0.1)) for d in mon]
fred["DFF"] = [(d.strftime("%Y-%m-%d"), 5.0 - 0.0005 * k) for k, d in enumerate(pd.date_range("2021-01-01", "2026-10-15"))]
def run(C, mk, etf_, fred_):
    Q.MACRO = {"etf": {k: dict(zip(idx, v)) for k, v in etf_.items()}, "fred": fred_}
    out = Q._macro_feats({"close": pd.DataFrame(C, index=idx)}, mk, lambda *a: None)
    return {n: F.values for n, F in out}
acc = {}
for mk, C in (("us", Cu), ("kr", Ck)):
    run(C, mk, etf, fred)
    acc[mk] = float(np.mean([Q.SECTOR_NOW[mk].get("S%d" % j) == secs[true[j]] for j in range(N)]))
# 누출: t0 이후 ETF·거시를 바꾼다
t0 = 500; cut_dk = idx[t0]
etf2 = {k: np.concatenate([v[:t0 + 1], v[t0 + 1:] * 1.3]) for k, v in etf.items()}
fred2 = {k: [(d, (x * 2 if int(d.replace("-", "")) > cut_dk - 100 else x)) for d, x in v] for k, v in fred.items()}
leak = {}
for mk, C in (("us", Cu), ("kr", Ck)):
    a, b = run(C, mk, etf, fred), run(C, mk, etf2, fred2)
    leak[mk] = [n for n in a if not np.allclose(np.nan_to_num(a[n][:t0 - 40]), np.nan_to_num(b[n][:t0 - 40]))]
names = list(run(Ck, "kr", etf, fred))
s_us = Q._macro_surprise(fred, [20260915], False)["CPIAUCSL"][0]; s_kr = Q._macro_surprise(fred, [20260915], True)["CPIAUCSL"][0]
print(json.dumps({"acc": acc, "leak": leak, "names": names, "sur": [s_us, s_kr], "groups": Q._groups(names)}))
`;
const r = spawnSync("python3", ["-c", py], { encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
let o = null; try { o = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) {}
chk(o, "거시·섹터 피처를 불러온다", (r.stderr || "").slice(-500));
if (o) {
  chk(o.acc.us >= 0.95 && o.acc.kr >= 0.95, "섹터 자동 배정 — 미국(같은 날) · 한국(전날 미국 섹터 ETF)", JSON.stringify(o.acc));
  chk(!o.leak.us.length && !o.leak.kr.length, "미래 누출 없음 — 뒤 날짜의 ETF·발표 값을 바꿔도 앞 피처가 같다", JSON.stringify(o.leak));
  chk(o.names.length >= 20 && ["mx_rate20", "mx_def_stress", "mx_gro_rate", "mx_fin_yield", "mx_fed_gro", "mx_us_night", "mx_s_cpiaucsl_rate"].every((n) => o.names.includes(n)),
      "금리·스트레스(방어주)·성장주×금리·금융×수익률·연준 인하×성장·미국 밤사이·CPI 서프라이즈 × 민감도", o.names.join(","));
  chk(o.sur[0] === o.sur[1] || isFinite(o.sur[0]), "발표 서프라이즈 값(추세 대비 · 반감)", JSON.stringify(o.sur));
  chk(o.groups["거시·섹터"] === o.names.length, "모델 구조창 묶음 '거시·섹터'", JSON.stringify(o.groups));
}
{ // [V33.631] OMNI-Q 구조 전부(구조 관측 '옛날처럼 노드를 다 보기')
  const pyS = `
import sys, json, numpy as np, lightgbm as lgb
sys.path.insert(0, ${JSON.stringify(new URL("../trainer/modal/", import.meta.url).pathname)})
import omni_q as Q
rng = np.random.default_rng(3); X = rng.random((600, 9)); y = X[:, 2] * 2 + rng.random(600) * .1
b = lgb.train({"objective": "regression", "verbose": -1, "num_leaves": 7}, lgb.Dataset(X, y), num_boost_round=25)
s = Q._struct(b, ["f%d" % i for i in range(9)])
print(json.dumps({"n": len(s["feat"]), "g": len(s["gain"]), "gsum": sum(s["gain"]), "t": len(s["trees"]), "nT": s["nTrees"], "top": max(range(9), key=lambda i: s["gain"][i]),
  "ok": all(0 <= f < 9 for t in s["trees"] for f in t), "f2": sum(1 for t in s["trees"] for f in t if f == 2)}))
`;
  const r = spawnSync("python3", ["-c", pyS], { encoding: "utf8" });
  let o = null; try { o = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) { console.log(r.stderr.slice(-800)); }
  chk(o && o.n === 9 && o.g === 9 && Math.abs(o.gsum - 1) < 1e-3 && o.t === 25 && o.nT === 25 && o.top === 2 && o.ok && o.f2 > 0,
      "학습기 _struct: 피처 전부 · gain 합 1 · 나무마다 실제 분기 피처(신호 피처 f2 가 1위)", JSON.stringify(o));
  const M = await import("../src/index.js");
  const c1 = M.omniqStructClean({ feat: ["a", "b", "c"], gain: [.5, .3, .2], split: [3, 2, 1], trees: [[0, 1, 9, -1, 2], "x"], nTrees: 40 });
  chk(c1 && c1.trees[0].join() === "0,1,2" && c1.trees[1].length === 0 && c1.nTrees === 40 && M.omniqStructClean({ feat: [] }) === null && M.omniqStructClean({ feat: ["a"], gain: [1, 2] }).gain === null,
      "워커 검증: 범위 밖 피처 번호 제거 · 모양 틀린 배열은 버림 · 빈 피처는 저장 안 함", JSON.stringify(c1));
  const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8"), Q2 = readFileSync(new URL("../trainer/modal/omni_q.py", import.meta.url), "utf8");
  const N = readFileSync(new URL("../studio/src/gl/netScenes.ts", import.meta.url), "utf8"), O = readFileSync(new URL("../studio/src/views/OmniQ.tsx", import.meta.url), "utf8"), R = readFileSync(new URL("../studio/src/views/NodeRoles.tsx", import.meta.url), "utf8");
  chk(/"struct": _struct\(bst, names\)/.test(Q2) && /"struct": cached\.get\("struct"\)/.test(Q2) && /setState\(env\.DB, "omniq_struct:" \+ mk/.test(S) && /path === "\/api\/omniq-struct"/.test(S),
      "배선: 학습·채점만 회차 모두 struct 업로드 → 워커 omniq_struct:{mk} → GET /api/omniq-struct");
  chk(/export function omniqNet\(d: any, mk: "us" \| "kr" = "us", st\?: any\)/.test(N) && /getJSON\("\/api\/omniq-struct\?mkt=" \+ mk\)/.test(O) && /노드 찾기/.test(R),
      "화면: 실제 구조로 그림(피처 전부 · 실제 나무 분기) · 노드 찾기(이름·역할)");
}
if (fails) { console.log("check-omniq-macro: FAIL " + fails); process.exit(1); }
console.log("check-omniq-macro: ok");
