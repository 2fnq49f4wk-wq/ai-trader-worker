/* [V33.607] 매매법 모의 시뮬(Playbook-Sim) 계약 — trainer/modal/playbook_sim.py ↔ 워커 PB_ROUTE
 *   ① 귀무: 무작위 시세 → 일봉·5분 검증 둘 다 통과 못 한다
 *   ② 양성 대조: 한 상황 칸에서 한 매매법만 이기게 심으면 표가 그 매매법을 고르고 뒤 30% 에서 통과한다
 *   ③ 상황 열쇠 경계가 학습기와 워커에서 같다(같은 값 → 같은 칸 이름)
 *   ④ 워커: 표 조회(가장 구체 칸 → 넓은 칸) · 관문 재판정 · 매매법별 청산(SR-TP · SR-TIME · SR-EOD) · 후보 = OMNI-Q 상위 20%
 *   ⑤ [V33.608] 진입 조건 — 도감 14종(횡단면 3종 제외) · 5분 단타 5종이 무작위 시세에서 학습기와 워커가 ★같은 날·같은 봉에 뜬다★ */
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
d, reg, sig = PB.sim_daily(P, "us", []); d = PB._relevel(d)
null_d, _ = PB.validate(d, "t")
# 양성 대조: 표본표에 직접 우위를 심는다 — 가장 자주 뜨는 매매법 G 가 모든 칸에서 +1.8%
e = d.copy(); e["ex"] = rng.normal(-0.3, 2.5, len(e)).astype(np.float32)
G = e["pb"].value_counts().index[0]
e.loc[e["pb"] == G, "ex"] += 1.8
pos, tab = PB.validate(e, "t")
X = e[e["pb"] == G]["k3"].value_counts().index[0]
ch = PB.choose(tab, [X, "*"], list(PB.DAILY_PB))
# 진입 조건 대조용 — 종목 40개 · 마지막 60일의 도감 신호(횡단면 제외)
K = 60; J = 40
Pa = {k: P[k].values[:, :J].round(6).tolist() for k in ("open", "high", "low", "close", "volume")}
Sd = {pb: sig[pb].values[-K:, :J].astype(int).tolist() for pb in PB.DAILY_PB if pb not in PB.CROSS_PB}
# [V33.618] 실전 거르개 · 평균회귀 청산 대조
atr_ = PB._daily_state(P, [])[4]
regs = PB._regime(P["close"])[0]
LF = PB._live_filters(P, regs, atr_)["SN_RSI2"][-K:, :J].astype(int).tolist(); MR = PB._mr_exit(P)[-K:, :J].astype(int).tolist(); RG = [str(x) for x in regs[-K:]]
tab5 = PB._shrunk_table(d.head(400))
# [V33.618] 폭락장 반등 2종 대조 — 변동성 큰 무작위 시세(투매일이 나오게)
import strategy_catalog as CAT
cv = pd.DataFrame(50*np.exp(np.cumsum(rng.normal(-0.001,0.04,(400,40)),axis=0)), index=[20240101+k for k in range(400)])
ov = cv*(1+rng.normal(0,0.01,(400,40)))
Pv = {"close":cv,"open":ov,"high":np.maximum(cv,ov)*1.01,"low":np.minimum(cv,ov)*0.99,"volume":pd.DataFrame(rng.lognormal(13,.9,(400,40)), index=cv.index)}
sv = CAT.signals(Pv, ids=["OS_DEEP","CAPIT_REV"])
Pva = {k: Pv[k].values.round(6).tolist() for k in ("open","high","low","close","volume")}
Sv = {k: sv[k].values[-120:].astype(int).tolist() for k in sv}
# 5분 단타 진입 — 무작위 하루 30개(봉 78개)
ib = []
for q in range(30):
    cc = 50*np.exp(np.cumsum(rng.normal(0, 0.003, 78))); hh = cc*(1+rng.uniform(0,0.002,78)); ll = cc*(1-rng.uniform(0,0.002,78)); vv = rng.lognormal(8,.6,78)
    F = PB.intra_fires(cc, hh, ll, vv)
    ib.append({"c": cc.tolist(), "h": hh.tolist(), "l": ll.tolist(), "v": vv.tolist(), "F": {k: v.astype(int).tolist() for k, v in F.items()}})
S = json.loads(${JSON.stringify(JSON.stringify(samples))})
s = np.array([[np.nan if x is None else x for x in r] for r in S], dtype=float)
dk = PB.daily_keys(["BULL"]*len(s), s[:,0], s[:,1], s[:,2], s[:,3], s[:,4].astype(int))
I = np.array(${JSON.stringify(isamp)}, dtype=float)
ik = PB.intra_keys(["CRASH"]*len(I), I[:,0], I[:,1], I[:,2].astype(int))
print(json.dumps({"null": null_d.get("pass"), "pos": pos, "pick": ch and ch[0], "G": G, "Pa": Pa, "Sd": Sd, "K": K, "ib": ib, "dk": [[str(x) for x in lv] for lv in dk], "ik": [[str(x) for x in lv] for lv in ik],
  "Pva": Pva, "Sv": Sv, "LF": LF, "MR": MR, "RG": RG, "tab5len": len(next(iter(tab5.values()))), "snapMr": sorted(k for k, v in PB.DAILY_PB.items() if v.get("mr")),
  "rules": PB.RULES, "chLow": PB.choose({("*", "A"): (100, 0.3, 0.6, 0.4, 2.0)}, ["*"], ["A"]), "pbs": sorted(PB.DAILY_PB), "ipbs": sorted(PB.INTRA_PB), "B": [PB.B_RSI, PB.B_GAP20, PB.B_RET5, PB.B_VR, PB.B_DAYPCT, PB.B_TOD]}))
`;
const r = spawnSync("python3", ["-c", py], { encoding: "utf8", timeout: 300000, maxBuffer: 256 * 1024 * 1024 });
let o = null; try { o = JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) {}
chk(o, "시뮬레이터를 불러온다", (r.stderr || "").slice(-400));

const fnSrc = S.slice(S.indexOf("const PB_KEYS"), S.indexOf("function _omqHeadOn"));
const _num = (v, d) => (typeof v === "number" && isFinite(v) ? v : (v != null && v !== "" && isFinite(+v) ? +v : d));
const getMA = (h, p) => { if (!Array.isArray(h) || h.length < p) return null; let s = 0; for (let i = h.length - p; i < h.length; i++) s += h[i]; return s / p; };
const getRSI = () => 25;
const STRAT_ROUTE = { enabled: true, freshMs: 36 * 3600000, calPerTradingDay: 1.45 };
const MACRO_SCHED = { us: { fed_rate: ["2026-10-28"], cpi: ["2026-11-10"] } };
const W = new Function("_num", "getMA", "getRSI", "STRAT_ROUTE", "MACRO_SCHED", fnSrc + "; return { PB_KEYS, PB_ROUTE, pbDailyKeys, pbIntraKeys, pbChoose, _pbPass, pbRoutePick, pbExitWhy, pbEvNear, pbDailyFires, pbIntraFires, pbAgg5, pbLiveDaily, pbLiveFilterOk };")(_num, getMA, getRSI, STRAT_ROUTE, MACRO_SCHED);

if (o) {
  chk(o.tab5len === 5 && o.rules.some((x) => x.score === "mpd") && o.rules.some((x) => x.score === "lcbpd") && o.chLow && o.chLow[0] === "A", "[V33.618] 학습기: 표 = (n,w,m,lcb,hd) · 하루당 규칙 · 승률 30% 도 고른다");
  chk(["SN_RSI2", "BB_LOW", "STOCH_CROSS"].every((x) => o.snapMr.includes(x)) && !o.snapMr.includes("TR_BREAKOUT"), "[V33.618] 스냅 매매법 = 평균회귀 청산 프로필", o.snapMr.join(","));
  { let bad = [], badm = [], nOk = 0, nMr = 0; const T = o.Pa.close.length;
    for (let j = 0; j < o.Pa.close[0].length; j++) {
      const col = (k) => o.Pa[k].map((r) => r[j]);
      const A = { o: col("open"), h: col("high"), l: col("low"), c: col("close"), v: col("volume") };
      for (let q = 0; q < o.K; q++) {
        const t = T - o.K + q, D = { o: A.o.slice(0, t + 1), h: A.h.slice(0, t + 1), l: A.l.slice(0, t + 1), c: A.c.slice(0, t + 1), v: A.v.slice(0, t + 1) };
        const js = W.pbLiveFilterOk("SN_RSI2", D, o.RG[q]) ? 1 : 0; nOk += js;
        if (js !== o.LF[q][j]) bad.push([t, j, js, o.LF[q][j]]);
        const sm = { sid: "SN_RSI2", kind: "daily", mr: true, stop: 3.5, hold: 8, tstop: 5, rsi2x: 65 }, px = D.c[t];
        const mr = /^SR-MR/.test(W.pbExitWhy(sm, px, px, Date.now(), Date.now(), 30, D) || "") ? 1 : 0; nMr += mr;
        if (mr !== o.MR[q][j]) badm.push([t, j, mr, o.MR[q][j]]);
      } }
    chk(!bad.length && nOk > 0 && W.pbLiveFilterOk("TR_BREAKOUT", { c: [1] }, "CRASH"), "[V33.618] RSI2 실전 거르개(약세 금지·−12%·ATR 5%·당일 −4%) 학습기 = 워커 (통과 " + nOk + ")", JSON.stringify(bad.slice(0, 4)));
    chk(!badm.length && nMr > 0, "[V33.618] 평균회귀 청산(종가 > MA5 · RSI2 ≥ 65) 학습기 = 워커 (" + nMr + ")", JSON.stringify(badm.slice(0, 4))); }
  { const T = o.Pva.close.length, cnt = { OS_DEEP: 0, CAPIT_REV: 0 }, bad = [];
    for (let j = 0; j < o.Pva.close[0].length; j++) {
      const col = (k) => o.Pva[k].map((r) => r[j]);
      const A = { o: col("open"), h: col("high"), l: col("low"), c: col("close"), v: col("volume") };
      for (let q = 0; q < 120; q++) { const t = T - 120 + q, F = W.pbDailyFires({ o: A.o.slice(0, t + 1), h: A.h.slice(0, t + 1), l: A.l.slice(0, t + 1), c: A.c.slice(0, t + 1), v: A.v.slice(0, t + 1) });
        for (const pb of ["OS_DEEP", "CAPIT_REV"]) { const js = F.includes(pb) ? 1 : 0; cnt[pb] += js; if (js !== o.Sv[pb][q][j]) bad.push([pb, t, j, js]); } } }
    chk(!bad.length && cnt.OS_DEEP > 0 && cnt.CAPIT_REV > 0, "[V33.618] 폭락장 반등 2종(OS_DEEP·CAPIT_REV) 학습기 = 워커 " + JSON.stringify(cnt), JSON.stringify(bad.slice(0, 4))); }
  chk(o.null === false, "귀무: 무작위 시세는 일봉 검증을 통과 못 한다", JSON.stringify(o.null));
  chk(o.pos.pass === true && o.pick === o.G, "양성 대조: 심은 매매법을 골라 뒤 30% 에서 통과", JSON.stringify([o.pos, o.pick, o.G]));
  // ⑤ 진입 조건 대조(일봉 도감)
  { let tot = 0, fired = 0, bad = []; const T = o.Pa.close.length;
    for (let j = 0; j < o.Pa.close[0].length; j++) {
      const col = (k) => o.Pa[k].map((r) => r[j]);
      const A = { o: col("open"), h: col("high"), l: col("low"), c: col("close"), v: col("volume") };
      for (let q = 0; q < o.K; q++) {
        const t = T - o.K + q, D = { o: A.o.slice(0, t + 1), h: A.h.slice(0, t + 1), l: A.l.slice(0, t + 1), c: A.c.slice(0, t + 1), v: A.v.slice(0, t + 1) };
        const js = W.pbDailyFires(D).sort().join(","), py = Object.keys(o.Sd).filter((pb) => o.Sd[pb][q][j]).sort().join(",");
        tot++; if (py) fired++;
        if (js !== py && bad.length < 5) bad.push("j" + j + " t" + t + " py[" + py + "] js[" + js + "]");
      }
    }
    chk(bad.length === 0 && fired > 50, "도감 진입 조건: 학습기 ↔ 워커 같은 날 같은 매매법(" + tot + "칸 · 발화 " + fired + ")", bad.join(" | ")); }
  // ⑤ 진입 조건 대조(5분 단타)
  { let bad = [], fired = 0;
    for (const b of o.ib) for (let i = 2; i < b.c.length; i++) {
      const js = W.pbIntraFires(b.c.slice(0, i + 1), b.h.slice(0, i + 1), b.l.slice(0, i + 1), b.v.slice(0, i + 1)).sort().join(",");
      const py = Object.keys(b.F).filter((k) => b.F[k][i]).sort().join(",");
      if (py) fired++;
      if (js !== py && bad.length < 5) bad.push("i" + i + " py[" + py + "] js[" + js + "]");
    }
    chk(bad.length === 0 && fired > 30, "5분 단타 진입 조건: 학습기 ↔ 워커 같은 봉(발화 " + fired + ")", bad.join(" | ")); }
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
const tab = { "BULL|0|0|0|0|0": { STOCH_CROSS: [12, 0.6, 0.9], SN_RSI2: [12, 0.55, 0.4] }, "BULL|0|0|*": { TR_PULLBACK: [80, 0.4, -0.1] }, "BULL|*": { SN_RSI2: [500, 0.52, 0.2], HA_REV: [500, 0.6, 0.3] }, "*": { HA_REV: [9000, 0.5, 0.01] } };
const K0 = ["BULL|0|0|0|0|0", "BULL|0|0|*", "BULL|*", "*"];
chk(W.pbChoose(tab, K0, ["STOCH_CROSS", "SN_RSI2"])?.pb === "STOCH_CROSS", "뜬 매매법 중 그 칸 평균이 큰 것(스토캐스틱)");
chk(W.pbChoose(tab, K0, ["SN_RSI2"])?.pb === "SN_RSI2" && W.pbChoose(tab, K0, ["HA_REV"])?.m === 0.3, "매매법마다 그것이 있는 가장 구체적인 칸 값");
chk(W.pbChoose(tab, K0, ["TR_PULLBACK"]) === null, "그 칸 평균 ≤ 0 이면 안 산다(넓은 칸으로 도망가지 않는다)");
chk(W.pbChoose(tab, K0, []) === null, "뜬 매매법이 없으면 안 산다");
chk(W.pbChoose({ "*": { A: [100, 0.3, 0.5] } }, ["*"], ["A"])?.pb === "A" && W.PB_ROUTE.minWin === 0, "[V33.618] 성공확률 조건 없음 — 승률 30% 라도 기대값 > 0 이면 고른다(사용자 결정)");
{ const T5 = { "*": { A: [100, 0.6, 1.0, 0.8, 10], B: [100, 0.5, 0.5, 0.4, 1] } };
  chk(W.pbChoose(T5, ["*"], ["A", "B"], { score: "m", level: "fine" })?.pb === "A" && W.pbChoose(T5, ["*"], ["A", "B"], { score: "mpd", level: "fine" })?.pb === "B"
      && W.pbChoose(T5, ["*"], ["A", "B"], { score: "lcbpd", level: "regime" })?.pb === "B", "[V33.618] 하루당 점수(mpd·lcbpd): 10일 +1% 보다 1일 +0.5% 를 고른다");
  chk(W.pbChoose({ "*": { A: [100, 0.5, 0.5, 0.4] } }, ["*"], ["A"], { score: "mpd", level: "fine" })?.hd === 1, "옛 표(보유일 없음)는 보유 1일로 본다"); }
const val = { pass: true, n: 400, mean: 0.3, t: 2.4, base: 0.05 };
chk(W._pbPass(val) && !W._pbPass({ ...val, t: 1.9 }) && !W._pbPass({ ...val, mean: 0.01, base: 0.05 }) && !W._pbPass({ ...val, n: 10 }), "관문 재판정: t ≥ 2 · 평균 > 0 · 아무거나보다 높음 · 시뮬 표본 ≥ 30");
const now = Date.now();
// 지금 STOCH_OS_EXIT 와 MOM3 가 뜨도록 만든 시세
const N0 = 260, cs = Array.from({ length: N0 }, (_, i) => 100 + i * 0.05);
for (let i = N0 - 7; i < N0 - 1; i++) cs[i] = cs[i - 1] * 0.99;
cs[N0 - 1] = cs[N0 - 2] * 1.04;
const Dd = { c: cs, h: cs.map((x) => x * 1.005), l: cs.map((x) => x * 0.995), o: cs.map((x) => x), v: cs.map(() => 1e6) };
const firedNow = W.pbDailyFires(Dd);
const b5 = { c: [100, 100.1, 100.2, 100.1, 100.3, 100.2, 100.25, 100.3, 100.5, 100.9], h: [], l: [], v: [] };
b5.h = b5.c.map((x) => x * 1.001); b5.l = b5.c.map((x) => x * 0.999); b5.v = b5.c.map(() => 1000);
const firedI = W.pbIntraFires(b5.c, b5.h, b5.l, b5.v);
const st = { ts: now, regime: "BULL", daily: { val, table: { "*": Object.fromEntries(firedNow.map((p) => [p, [9000, 0.55, 0.4]])) }, pb: Object.fromEntries(firedNow.map((p) => [p, { stop: 4, atr: 1.5, hold: 8, tpR: 1.5 }])) },
             intra: { val, table: { "*": Object.fromEntries(firedI.map((p) => [p, [9000, 0.56, 0.6]])) }, pb: Object.fromEntries(firedI.map((p) => [p, { tpPct: 1.0, sl: 0.6, bars: 6 }])) } };
const ctx = { reg: "BULL", symbol: "AAA", D: Dd, bars5: b5, prevClose: cs[N0 - 2], evNear: false, minToClose: 200 };
const pk = W.pbRoutePick(st, ctx, now);
chk(firedNow.length > 0 && firedI.indexOf("MOM3") >= 0 && pk && pk.kind === "intra" && firedI.indexOf(pk.pb) >= 0 && pk.stop === 0.6, "지금 뜬 매매법 중 표 평균이 큰 쪽(5분 단타)을 고르고 그 손절폭", JSON.stringify([firedNow, firedI, pk]));
const pk2 = W.pbRoutePick(st, { ...ctx, minToClose: 20 }, now);
chk(pk2 && pk2.kind === "daily" && firedNow.indexOf(pk2.pb) >= 0, "마감 30분 안엔 단타 대신 일봉 매매법", JSON.stringify(pk2));
chk(W.pbRoutePick({ ...st, daily: { ...st.daily, table: { "*": { NOPE: [9000, 0.6, 0.9] } } }, intra: null }, ctx, now) === null, "뜬 매매법이 표에 없으면 안 산다(안 뜬 매매법으론 안 산다)");
chk(W.pbRoutePick({ ...st, ts: now - 40 * 3600000 }, ctx, now) === null, "36시간 넘은 표 → 안 산다");
chk(W.pbRoutePick({ ...st, daily: { ...st.daily, val: { ...val, pass: false } }, intra: null }, ctx, now) === null, "검증 미통과 봉은 안 쓴다");
chk(W.pbRoutePick({ ...st, daily: { ...st.daily, table: { "*": { RS_LEADER: [9000, 0.6, 0.9] } }, pb: { RS_LEADER: { stop: 8, atr: 2.5, hold: 30, tpR: null } }, cross: { RS_LEADER: ["AAA"] } }, intra: null }, { ...ctx, minToClose: 20 }, now)?.pb === "RS_LEADER",
    "횡단면 매매법(RS_LEADER 등)은 학습기가 보낸 오늘 발화 목록으로");
{ const mb = { closes: [10, 10.1, 10.2, 10.3, 10.4, 10.5], highs: [10, 10.2, 10.2, 10.3, 10.6, 10.5], lows: [9.9, 10, 10.1, 10.2, 10.3, 10.4], volumes: [1, 2, 3, 4, 5, 6], times: [0, 60, 120, 240, 300, 360].map((x) => 1760000100 + x) };
  const a5 = W.pbAgg5(mb);
  chk(a5.c.length === 2 && a5.c[0] === 10.3 && a5.h[0] === 10.3 && a5.v[0] === 10 && a5.c[1] === 10.5 && a5.h[1] === 10.6, "1분봉 → 5분봉 묶기(5분 경계 · 종가 = 마지막 · 고가 = 최대 · 거래량 합)", JSON.stringify(a5)); }
{ const dl = { closes: [1, 2, 3], highs: [1, 2, 3], lows: [1, 2, 3], opens: [1, 2, 3], volumes: [5, 5, 5] };
  const a = W.pbLiveDaily(dl, 3.3, 3), b = W.pbLiveDaily(dl, 3.3, 2);
  chk(a.c.length === 4 && a.c[3] === 3.3 && b.c.length === 3 && b.c[2] === 3.3 && b.h[2] === 3.3, "일봉 지금 봉: 오늘 봉이 없으면 붙이고 · 있으면 지금 가격으로 갱신"); }
const si = { sid: "SCALP_M", kind: "intra", tpPct: 1.2, bars: 18 };
chk(/^SR-TP/.test(W.pbExitWhy(si, 100, 101.3, now - 60000, now, 200)) && /^SR-TIME/.test(W.pbExitWhy(si, 100, 100.2, now - 91 * 60000, now, 200))
    && /^SR-EOD/.test(W.pbExitWhy(si, 100, 100.2, now - 60000, now, 8)) && W.pbExitWhy(si, 100, 100.2, now - 60000, now, 200) === null, "단타 청산: 익절 · 시간 · 마감 10분 전");
const sd = { sid: "PULLBACK", kind: "daily", stop: 5, tpR: 2, hold: 10 };
chk(/^SR-TP/.test(W.pbExitWhy(sd, 100, 110.5, now, now, 200)) && /^SR-TIME/.test(W.pbExitWhy(sd, 100, 101, now - 15 * 86400000, now, 200)) && W.pbExitWhy(sd, 100, 101, now - 86400000, now, 200) === null,
    "스윙 청산: 익절(2R = 10%) · 최대 보유(10거래일 ≈ 14.5일)");
chk(/_pbS >= PB_ROUTE\.candMin/.test(S) && /candMin: 0\.80/.test(S) && /omniqFresh\(__omniq, Date\.now\(\)\)/.test(S), "후보 = OMNI-Q 5일 머리 상위 20%(신선할 때만)");
chk(/getState\(DB, "playbook:" \+ market/.test(S) && /path === "\/api\/playbook" && request\.method === "POST"/.test(S), "표 업로드·조회 배선");
chk(/playbook_sim\.run\(/.test(readFileSync(dir + "omniq_gha.py", "utf8")) && /"5m"/.test(readFileSync(dir + "omniq_gha.py", "utf8")), "GHA 회차: 5분봉 받아 시뮬");
// [V33.609] 선택 규칙 · 자동 주력 전환 · 위원회 퇴역
{ const T2 = { "BULL|0|0|0|0|0": { A: [12, 0.7, 2.0, -0.4] }, "BULL|*": { A: [900, 0.55, 0.3, 0.2], B: [900, 0.56, 0.5, 0.1] }, "*": { A: [9000, 0.5, 0.05, 0.03], B: [9000, 0.52, 0.2, 0.15] } };
  const KK = ["BULL|0|0|0|0|0", "BULL|0|0|*", "BULL|*", "*"];
  chk(W.pbChoose(T2, KK, ["A", "B"], { score: "m", level: "fine" })?.pb === "A", "규칙 평균·전체 칸: 표본 12개짜리 높은 평균(A)을 고른다");
  chk(W.pbChoose(T2, KK, ["A", "B"], { score: "lcb", level: "fine" })?.pb === "B", "규칙 하한·전체 칸: 표본 적은 칸의 우연한 고평균을 버린다(승자의 저주)");
  chk(W.pbChoose(T2, KK, ["A", "B"], { score: "lcb", level: "regime" })?.pb === "A" && W.pbChoose(T2, KK, ["A", "B"], { score: "lcb", level: "global" })?.pb === "B", "규칙 칸 단계: 국면 칸까지만 · 매매법 전체만"); }
{ const now2 = Date.now(), v = { pass: true, n: 400, mean: 0.3, t: 2.4, base: 0.05 };
  const M2 = new Function("_num", "getMA", "getRSI", "STRAT_ROUTE", "MACRO_SCHED", fnSrc + "; return { pbPrimaryOn, PB_PRIMARY_CAPS };")(_num, getMA, getRSI, STRAT_ROUTE, MACRO_SCHED);
  chk(M2.pbPrimaryOn({ ts: now2, daily: { val: v } }, now2) && !M2.pbPrimaryOn({ ts: now2, daily: { val: { ...v, pass: false } } }, now2) && !M2.pbPrimaryOn({ ts: now2 - 40 * 3600000, daily: { val: v } }, now2),
      "주력 전환은 그 시장 일봉 검증 통과 + 표 신선(36시간)일 때만");
  chk(/_ap && _ap\.enabled && __aiReady && !__pbPrim && stratResults\.length === 0/.test(S), "주력 전환된 시장은 AI_PRIMARY 신규 진입을 끈다(미통과 시장은 그대로)");
  chk(/__pbCap = __pbPrim \? PB_PRIMARY_CAPS : STRAT_ROUTE/.test(S) && /signal\.isStratRoute && !\(signal\.sr && signal\.sr\.primary\)/.test(S) && M2.PB_PRIMARY_CAPS.mult === 1.0, "주력 시장은 상한을 올리고 크기 ×1.0 · 아니면 잠정 ×0.5");
  chk(["l1", "icfamily", "bandit", "brain", "mind", "gbdt"].every((k) => new RegExp('if \\(!__pbRetire\\) await _stg\\("' + k + '"').test(S)) && /__pbRetire = pbPrimaryOn\(await getState\(env\.DB, "playbook:us"/.test(S),
      "미·한 둘 다 주력이면 위원회 학습(워커) 퇴역");
  chk(/위원회 학습 건너뜀/.test(readFileSync(dir + "train_gha.py", "utf8")), "미·한 둘 다 주력이면 위원회 학습(GitHub Actions) 퇴역"); }
{ const Q = readFileSync(dir + "playbook_sim.py", "utf8");
  chk(/SPLIT = \(0\.60, 0\.80\)/.test(Q) && /ho = df\[df\[timecol\] >= c2\]/.test(Q), "검증 3구간: 규칙은 [60,80%) 에서 고르고 판정은 손대지 않은 [80,100%) 에서만");
  chk(/busy\.get\(r\.j, -1\) >= r\.t/.test(Q), "검증도 실전처럼 같은 종목은 앞 거래가 끝나야 다시 산다(겹친 표본으로 t 를 부풀리지 않는다)"); }
{ // [V33.609] 관측창 배선
  const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), U = readFileSync(new URL("../public/workspace-ui.js", import.meta.url), "utf8");
  const O = readFileSync(new URL("../public/playbook-observatory.js", import.meta.url), "utf8");
  chk(/id="page-nnviz" data-brain-view="operations"/.test(H) && !/data-brain-tab="playbook"/.test(H) && /<section id="pbObs"/.test(H), "[V33.612] 매매법 AI 실시간 판정은 01 작동 화면 안(00 탭 없음)");
  chk(/if \(view === 'operations'\) pbObs\(\);/.test(U) && /playbook-observatory\.js/.test(U), "01 작동 화면을 열 때 지연 로드");
  { const ST = readFileSync(new URL("../studio/src/models.ts", import.meta.url), "utf8"), BS = readFileSync(new URL("../public/brain-studio.js", import.meta.url), "utf8");
    chk(/key: "playbook"/.test(ST) && /\/api\/playbook/.test(readFileSync(new URL("../studio/src/data.ts", import.meta.url), "utf8")) && /매매법 현황/.test(BS), "[V33.612] 02 모델 구조(Brain Studio)에 '매매법 AI' 모델 · 번들 반영"); }
  chk(/window\.PlaybookObs/.test(O) && /\/api\/playbook/.test(O) && !/https?:\/\//.test(O.replace(/\/\*[\s\S]*?\*\//g, "")), "관측창은 /api/playbook 만 읽는다(외부 주소 없음)");
  chk(/recent: recent, exits: exits, open: open/.test(S), "관측창 API: 최근 매수·청산·보유"); }
{ // [V33.610] 시뮬과 실전 맞추기
  const M3 = new Function("_num", "getMA", "getRSI", "STRAT_ROUTE", "MACRO_SCHED", fnSrc + "; return { pbSellRule, pbLiveDaily, PB_ROUTE };")(_num, getMA, getRSI, STRAT_ROUTE, MACRO_SCHED);
  const pos = { avg: 100, qty: 1, meta: { sr: { sid: "SN_RSI2", kind: "daily", stop: 4, be: 0.8 }, stopPrice: 96, peakPrice: 100 } };
  chk(/^SR-STOP/.test(M3.pbSellRule(pos, 95.9).reason || "") && !M3.pbSellRule(pos, 99).sell, "매매법 보유 손절 = 진입 손절가");
  { const pm = { avg: 100, qty: 1, meta: { sr: { sid: "SN_RSI2", kind: "daily", stop: 3.5, be: 0, bePct: 2, mr: true }, stopPrice: 96.5, peakPrice: 102.1 } };
    chk(/^SR-BE/.test(M3.pbSellRule(pm, 99.9).reason || "") && !M3.pbSellRule({ ...pm, meta: { ...pm.meta, peakPrice: 101.9 } }, 99.9).sell, "[V33.618] 스냅 본전 이동: +2% 넘은 뒤 평단 아래면 SR-BE"); }
  chk(/pbExitWhy\(held\.meta\.sr, held\.avg, price, held\.opened_ts, Date\.now\(\), __pbMtc, held\.meta\.sr\.mr \? pbLiveDaily\(daily, price, prevClose, __pbMtc\) : null\)/.test(S)
      && /mr: _sp\.mr === true, bePct:/.test(S), "[V33.618] 평균회귀 청산 배선(보유 판정에 지금 일봉 · 매수 메타에 mr·bePct·tstop)");
  chk(/^SR-BE/.test(M3.pbSellRule({ ...pos, meta: { ...pos.meta, peakPrice: 103.3 } }, 99.9).reason || "") && !M3.pbSellRule({ ...pos, meta: { ...pos.meta, peakPrice: 103 } }, 99.9).sell, "본전 이동: 고점이 0.8R(=+3.2%) 넘은 뒤 평단 아래면 SR-BE");
  chk(/if \(pos\.meta && pos\.meta\.sr && pos\.meta\.sr\.sid\) return pbSellRule\(pos, price\);/.test(S) && /!_pairHeld && !\(held\.meta && held\.meta\.sr\)/.test(S),
      "매매법 보유엔 공통 분할익절·트레일·타임스톱·MODEL_EXIT 를 걸지 않는다(시뮬에 없던 매도)");
  chk(/dWin = ctx\.minToClose != null && ctx\.minToClose <= PB_ROUTE\.dailyEntryWin/.test(S) && M3.PB_ROUTE.dailyEntryWin === 60, "일봉 매매법 진입은 마감 전 60분(시뮬 = 신호 봉 종가 체결)");
  const dl = { closes: [1, 2, 3], highs: [1, 2, 3], lows: [1, 2, 3], opens: [1, 2, 3], volumes: [5, 5, 100] };
  chk(Math.abs(M3.pbLiveDaily(dl, 3.1, 2, 195).v[2] - 200) < 1e-6, "장중 거래량을 지난 시간 비율로 하루치 추정(195분 남음 → ×2)");
  chk(/setState\(DB, "pb_live:" \+ market/.test(S) && /live: live/.test(S) && /shadow: true/.test(S), "후보별 판정(그림자 포함)을 매 사이클 관측창에 남긴다");
  chk(/LAST_OOS\[mk\] = /.test(readFileSync(dir + "omni_q.py", "utf8")) && /oos=omni_q\.LAST_OOS/.test(readFileSync(dir + "omniq_gha.py", "utf8")) && /def cand_mask/.test(readFileSync(dir + "playbook_sim.py", "utf8")),
      "시뮬 후보 = 그날 OMNI-Q 표본 밖 상위 20%(실전 후보와 같게)"); }
{ // [V33.614] 조건부 퇴역 · 화면 전환 · 속도
  chk(/OMNIQ_ROUTE\.enabled && __omniq && !__pbPrim/.test(S), "매매법 AI 주력 시장은 OMNI-Q 단독 매수 퇴역");
  chk(/\(\(_ap && _ap\.enabled && __aiReady\) \|\| __pbPrim\) stratResults = stratResults\.filter/.test(S), "주력 시장은 위원회 가동과 무관하게 규칙 신호를 버린다");
  chk(/★매매법 AI 선행 판정\(속도\)★/.test(S) && /for \(const it of _take\) _evalPromoted\.add\(it\)/.test(S) && /__pbMb = mbPrefetchStart\(_pc/.test(S) && /__pbMb\.take\(symbol\)/.test(S),
      "선행 판정: 전 후보 기록 · 살 수 있는 후보 앞당김(순환 진도 제외) · 후보 분봉 병렬 선행 조회");
  const L = readFileSync(new URL("../public/workspace-layout.css", import.meta.url), "utf8"), A = readFileSync(new URL("../studio/src/App.tsx", import.meta.url), "utf8");
  chk(/#page-nnviz\.pb-primary\[data-brain-view="operations"\]/.test(L) && /classList\.toggle\('pb-primary'/.test(readFileSync(new URL("../public/playbook-observatory.js", import.meta.url), "utf8")),
      "주력이면 01 작동 화면에서 AI_PRIMARY(위원회) 화면을 걷어낸다");
  chk(/const groups = \["주력", "후보 선별"\]/.test(A), "02 모델 구조에서 위원회 모델을 걷어낸다(V33.617 상시)"); }
{ // [V33.615] OMNI-Q 재구성 — 후보 선별기 · 피처 추가
  const Q = readFileSync(dir + "omni_q.py", "utf8"), G = readFileSync(dir + "omniq_gha.py", "utf8");
  chk(/def _pb_feats/.test(Q) && /"pb_" \+ pid/.test(Q) && /def _event_feats/.test(Q) && /OMNIQ_PBFEAT/.test(Q) && /OMNIQ_EVFEAT/.test(Q), "OMNI-Q 피처: 매매법 신호 34 · 실적·뉴스(끄개 있음)");
  chk(/omni_q\.EVENTS = EV/.test(G) && G.indexOf("omni_q.EVENTS = EV") < G.indexOf("omni_q.run("), "실적·뉴스를 OMNI-Q 학습 전에 넣는다");
  chk(/featGroups: \(body\.featGroups/.test(S) && /featGroups: q\.featGroups/.test(S), "피처 묶음·중요도를 저장·공개(모델 구조창)");
  chk(/key: "omniq"/.test(readFileSync(new URL("../studio/src/models.ts", import.meta.url), "utf8")) && /\["주력", "후보 선별"\]/.test(readFileSync(new URL("../studio/src/App.tsx", import.meta.url), "utf8")),
      "모델 구조창: 주력 매매법 AI + 후보 선별 OMNI-Q(주력 전환 뒤에도 남는다)"); }
{ // [V33.616] 시간외 시세·스캔
  chk(/const _pp = isExtendedHoursWindow\("us"\) \? "&includePrePost=true" : "";/.test(S), "미국 시간외엔 분봉에 프리·애프터를 담는다(includePrePost)");
  chk(/_bothExt \? \(_m % 2\) !== \(market === "kr" \? 0 : 1\)/.test(S), "두 시장이 다 시간외면 분마다 번갈아(한쪽이 사이클을 다 써도 다른 쪽이 굶지 않게)");
  chk(/await pbObserveScan\(DB, market, batchQuotes, __sr, __omniq\)/.test(S) && /async function pbObserveScan/.test(S), "거래 창 밖 시간외에도 매매법 AI 후보 스캔(매수 없음)"); }
{ // [V33.617] 위원회 퇴역 · OMNI-Q 신경망
  chk(/const COMMITTEE_RETIRED = true;/.test(S) && /let __pbRetire = COMMITTEE_RETIRED;/.test(S) && /if \(!COMMITTEE_RETIRED\) await _stg\("harvest"/.test(S) && /if \(!COMMITTEE_RETIRED\) await _stg\("omniscore"/.test(S)
      && /_bigR2\(\) && !COMMITTEE_RETIRED\) __stinPend/.test(S), "위원회 학습·표본 수집 퇴역(추론은 유지)");
  chk(/CRON = None if COMMITTEE_RETIRED/.test(readFileSync(dir + "modal_train.py", "utf8")) && /FORCE_COMMITTEE/.test(readFileSync(dir + "train_gha.py", "utf8"))
      && /# schedule:/.test(readFileSync(new URL("../.github/workflows/modal-watchdog.yml", import.meta.url), "utf8")), "Modal·GHA 위원회 학습 예약 끔");
  const MS = readFileSync(new URL("../studio/src/models.ts", import.meta.url), "utf8");
  chk(!/key: "mind"|key: "gbdt"|key: "omni",/.test(MS) && /export function omniqNet/.test(readFileSync(new URL("../studio/src/gl/netScenes.ts", import.meta.url), "utf8")), "모델 구조창: 위원회·옛 OMNI 목록 없음 · OMNI-Q 신경망"); }
if (fails) { console.log("check-playbook: FAIL " + fails); process.exit(1); }
console.log("check-playbook: ok");
