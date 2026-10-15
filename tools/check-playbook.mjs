/* [V33.607] 매매법 모의 시뮬(Playbook-Sim) 계약 — trainer/modal/playbook_sim.py ↔ 워커 PB_ROUTE
 *   ① 귀무: 무작위 시세 → 일봉·5분 검증 둘 다 통과 못 한다
 *   ② 양성 대조: 한 상황 칸에서 한 매매법만 이기게 심으면 표가 그 매매법을 고르고 뒤 30% 에서 통과한다
 *   ③ 상황 열쇠 경계가 학습기와 워커에서 같다(같은 값 → 같은 칸 이름)
 *   ④ 워커: 표 조회(가장 구체 칸 → 넓은 칸) · 관문 재판정 · 매매법별 청산(SR-TP · SR-TIME · SR-EOD) · 후보 = OMNI-Q 상위 20% */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const dir = new URL("../trainer/modal/", import.meta.url).pathname;
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };

const samples = [[25, -6, -4, 0.5, 1], [30, -5, -3, 0.8, 0], [49.9, 0, 3, 1.5, 0], [70, 5, 10, 2.2, 1], [55, 2.5, 0, 1.0, 0], [NaN, NaN, NaN, NaN, 0]];
const isamp = [[-3, 10, 1], [-2, 30, 0], [0, 125, 1], [0.5, 300, 0], [2.4, 270, 1]];
const py = `
import sys, json, math, numpy as np, pandas as pd
sys.path.insert(0, ${JSON.stringify(dir)})
import playbook_sim as PB
rng = np.random.default_rng(4); T, N = 600, 120
c = pd.DataFrame(50*np.exp(np.cumsum(rng.normal(0.0002,0.018,(T,N)),axis=0)), index=[20240101+k for k in range(T)])
o = c*(1+rng.normal(0,0.004,(T,N)))
P = {"close":c,"open":o,"high":np.maximum(c,o)*1.008,"low":np.minimum(c,o)*0.992,"volume":pd.DataFrame(rng.lognormal(13,.5,(T,N)), index=c.index)}
d, reg = PB.sim_daily(P, "us", []); d = PB._relevel(d)
null_d, _ = PB.validate(d, "t", list(PB.DAILY_PB))
# 양성 대조: 표본표에 직접 우위를 심는다 — 칸 X 에서 TREND 만 +1.5%
e = d.copy(); e["ex"] = rng.normal(-0.3, 2.5, len(e)).astype(np.float32)
X = e["k3"].value_counts().index[0]
m = (e["k3"] == X) & (e["pb"] == "TREND"); e.loc[m, "ex"] += 1.8
pos, tab = PB.validate(e, "t", list(PB.DAILY_PB))
ch = PB.choose(tab, [X, "*"], list(PB.DAILY_PB))
S = json.loads(${JSON.stringify(JSON.stringify(samples))})
s = np.array([[np.nan if x is None else x for x in r] for r in S], dtype=float)
dk = PB.daily_keys(["BULL"]*len(s), s[:,0], s[:,1], s[:,2], s[:,3], s[:,4].astype(int))
I = np.array(${JSON.stringify(isamp)}, dtype=float)
ik = PB.intra_keys(["CRASH"]*len(I), I[:,0], I[:,1], I[:,2].astype(int))
print(json.dumps({"null": null_d.get("pass"), "pos": pos, "pick": ch and ch[0], "dk": [[str(x) for x in lv] for lv in dk], "ik": [[str(x) for x in lv] for lv in ik],
  "pbs": sorted(PB.DAILY_PB), "ipbs": sorted(PB.INTRA_PB), "B": [PB.B_RSI, PB.B_GAP20, PB.B_RET5, PB.B_VR, PB.B_DAYPCT, PB.B_TOD]}))
`;
const r = spawnSync("python3", ["-c", py], { encoding: "utf8", timeout: 300000 });
let o = null; try { o = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) {}
chk(o, "시뮬레이터를 불러온다", (r.stderr || "").slice(-400));

const fnSrc = S.slice(S.indexOf("const PB_KEYS"), S.indexOf("function _omqHeadOn"));
const _num = (v, d) => (typeof v === "number" && isFinite(v) ? v : (v != null && v !== "" && isFinite(+v) ? +v : d));
const getMA = (h, p) => { if (!Array.isArray(h) || h.length < p) return null; let s = 0; for (let i = h.length - p; i < h.length; i++) s += h[i]; return s / p; };
const getRSI = () => 25;
const STRAT_ROUTE = { enabled: true, freshMs: 36 * 3600000, calPerTradingDay: 1.45 };
const MACRO_SCHED = { us: { fed_rate: ["2026-10-28"], cpi: ["2026-11-10"] } };
const W = new Function("_num", "getMA", "getRSI", "STRAT_ROUTE", "MACRO_SCHED", fnSrc + "; return { PB_KEYS, PB_ROUTE, pbDailyKeys, pbIntraKeys, pbChoose, _pbPass, pbRoutePick, pbExitWhy, pbEvNear };")(_num, getMA, getRSI, STRAT_ROUTE, MACRO_SCHED);

if (o) {
  chk(o.null === false, "귀무: 무작위 시세는 일봉 검증을 통과 못 한다", JSON.stringify(o.null));
  chk(o.pos.pass === true && o.pick === "TREND", "양성 대조: 심은 칸·매매법을 골라 뒤 30% 에서 통과", JSON.stringify([o.pos, o.pick]));
  const B = o.B;
  chk(JSON.stringify(B) === JSON.stringify([W.PB_KEYS.rsi, W.PB_KEYS.gap20, W.PB_KEYS.ret5, W.PB_KEYS.vr, W.PB_KEYS.daypct, W.PB_KEYS.tod]), "열쇠 경계가 학습기와 같다");
  let same = true, bad = "";
  samples.forEach((sm, i) => {
    const k = W.pbDailyKeys("BULL", sm[0], sm[1], sm[2], sm[3], !!sm[4]);
    for (let lv = 0; lv < 4; lv++) if (k[lv] !== o.dk[lv][i]) { same = false; bad = k[lv] + " ≠ " + o.dk[lv][i]; }
  });
  chk(same, "일봉 상황 열쇠: 같은 값 → 같은 칸 이름(경계값 · NaN 포함)", bad);
  same = true; bad = "";
  isamp.forEach((sm, i) => {
    const k = W.pbIntraKeys("CRASH", sm[0], sm[1], !!sm[2]);
    for (let lv = 0; lv < 4; lv++) if (k[lv] !== o.ik[lv][i]) { same = false; bad = k[lv] + " ≠ " + o.ik[lv][i]; }
  });
  chk(same, "5분 상황 열쇠: 같은 값 → 같은 칸 이름", bad);
}
// 워커 표 조회 · 관문 · 청산
const tab = { "BULL|0|0|0|0|0": { TREND: [12, 0.6, 0.9], REBOUND: [12, 0.55, 0.4] }, "BULL|0|0|*": { TREND: [80, 0.4, -0.1] }, "BULL|*": { REBOUND: [500, 0.52, 0.2] }, "*": { REBOUND: [9000, 0.5, 0.01] } };
chk(W.pbChoose(tab, ["BULL|0|0|0|0|0", "BULL|0|0|*", "BULL|*", "*"])?.pb === "TREND", "가장 구체적인 칸에서 평균이 큰 매매법");
chk(W.pbChoose(tab, ["BULL|0|0|1|0|0", "BULL|0|0|*", "BULL|*", "*"]) === null, "칸이 있는데 전부 평균 ≤ 0 이면 안 산다(넓은 칸으로 도망가지 않는다)");
chk(W.pbChoose(tab, ["BULL|3|3|1|0|0", "BULL|3|3|*", "BULL|*", "*"])?.pb === "REBOUND", "구체 칸이 없으면 넓은 칸");
chk(W.pbChoose({ "*": { A: [100, 0.45, 0.5] } }, ["*"]) === null, "성공확률 < 50% 면 안 고른다");
const val = { pass: true, n: 400, mean: 0.3, t: 2.4, base: 0.05 };
chk(W._pbPass(val) && !W._pbPass({ ...val, t: 1.9 }) && !W._pbPass({ ...val, mean: 0.01, base: 0.05 }) && !W._pbPass({ ...val, n: 10 }), "관문 재판정: t ≥ 2 · 평균 > 0 · 아무거나보다 높음 · 시뮬 표본 ≥ 30");
const now = Date.now();
const st = { ts: now, regime: "BULL", daily: { val, table: { "*": { TREND: [9000, 0.55, 0.4] } }, pb: { TREND: { stop: 7, hold: 30, tpR: null } } },
             intra: { val, table: { "*": { SCALP_M: [9000, 0.56, 0.6] } }, pb: { SCALP_M: { tpPct: 1.2, sl: 0.8, bars: 18 } } } };
const closes = Array.from({ length: 80 }, (_, i) => 100 + i * 0.1), volumes = closes.map(() => 1e6);
const pk = W.pbRoutePick(st, { reg: "BULL", closes, volumes, price: 108, prevClose: 107.9, evNear: false, minToClose: 200 }, now);
chk(pk && pk.kind === "intra" && pk.pb === "SCALP_M" && pk.stop === 0.8, "일봉·5분 중 평균이 큰 쪽(단타)을 고르고 그 손절폭", JSON.stringify(pk));
chk(W.pbRoutePick(st, { reg: "BULL", closes, volumes, price: 108, prevClose: 107.9, evNear: false, minToClose: 20 }, now)?.kind === "daily", "마감 30분 안엔 단타를 고르지 않는다");
chk(W.pbRoutePick({ ...st, ts: now - 40 * 3600000 }, { reg: "BULL", closes, volumes, price: 108, prevClose: 107.9, minToClose: 200 }, now) === null, "36시간 넘은 표 → 안 산다");
chk(W.pbRoutePick({ ...st, daily: { ...st.daily, val: { ...val, pass: false } }, intra: null }, { reg: "BULL", closes, volumes, price: 108, prevClose: 107.9, minToClose: 200 }, now) === null, "검증 미통과 봉은 안 쓴다");
const si = { sid: "SCALP_M", kind: "intra", tpPct: 1.2, bars: 18 };
chk(/^SR-TP/.test(W.pbExitWhy(si, 100, 101.3, now - 60000, now, 200)) && /^SR-TIME/.test(W.pbExitWhy(si, 100, 100.2, now - 91 * 60000, now, 200))
    && /^SR-EOD/.test(W.pbExitWhy(si, 100, 100.2, now - 60000, now, 8)) && W.pbExitWhy(si, 100, 100.2, now - 60000, now, 200) === null, "단타 청산: 익절 · 시간 · 마감 10분 전");
const sd = { sid: "PULLBACK", kind: "daily", stop: 5, tpR: 2, hold: 10 };
chk(/^SR-TP/.test(W.pbExitWhy(sd, 100, 110.5, now, now, 200)) && /^SR-TIME/.test(W.pbExitWhy(sd, 100, 101, now - 15 * 86400000, now, 200)) && W.pbExitWhy(sd, 100, 101, now - 86400000, now, 200) === null,
    "스윙 청산: 익절(2R = 10%) · 최대 보유(10거래일 ≈ 14.5일)");
chk(/_pbS >= PB_ROUTE\.candMin/.test(S) && /candMin: 0\.80/.test(S) && /omniqFresh\(__omniq, Date\.now\(\)\)/.test(S), "후보 = OMNI-Q 5일 머리 상위 20%(신선할 때만)");
chk(/getState\(DB, "playbook:" \+ market/.test(S) && /path === "\/api\/playbook" && request\.method === "POST"/.test(S), "표 업로드·조회 배선");
chk(/playbook_sim\.run\(/.test(readFileSync(dir + "omniq_gha.py", "utf8")) && /"5m"/.test(readFileSync(dir + "omniq_gha.py", "utf8")), "GHA 회차: 5분봉 받아 시뮬");
if (fails) { console.log("check-playbook: FAIL " + fails); process.exit(1); }
console.log("check-playbook: ok");
