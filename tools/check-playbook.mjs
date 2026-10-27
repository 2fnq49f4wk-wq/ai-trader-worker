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
# [V33.624] 국면 거부권 — 전체 성적은 좋아도 지금 국면 칸이 음이면 안 고른다
tv = {("*", "A"): (500, 0.6, 1.0, 0.8, 5.0), ("CRASH|*", "A"): (80, 0.3, -2.0, -2.5, 5.0), ("*", "B"): (500, 0.5, 0.3, 0.2, 5.0), ("CRASH|*", "B"): (80, 0.5, 0.2, 0.1, 5.0)}
veto = [PB.choose(tv, ["CRASH|*", "*"], ["A", "B"], "m")[0], PB.choose(tv, ["BULL|*", "*"], ["A", "B"], "m")[0]]
# [V33.618] 폭락장 반등 2종 대조 — 변동성 큰 무작위 시세(투매일이 나오게)
import strategy_catalog as CAT
cv = pd.DataFrame(50*np.exp(np.cumsum(rng.normal(-0.001,0.04,(400,40)),axis=0)), index=[20240101+k for k in range(400)])
ov = cv*(1+rng.normal(0,0.01,(400,40)))
Pv = {"close":cv,"open":ov,"high":np.maximum(cv,ov)*(1+rng.uniform(0,0.02,(400,40))),"low":np.minimum(cv,ov)*(1-rng.uniform(0,0.02,(400,40))),"volume":pd.DataFrame(rng.lognormal(13,.9,(400,40)), index=cv.index)}   # [V33.622] 심지 크기 무작위(IBS 가 뜨게)
sv = CAT.signals(Pv, ids=["OS_DEEP","CAPIT_REV","ICHIMOKU","KELTNER","DONCHIAN","MACD_X","ENVELOPE","ELDER_RAY","WILLR","CCI_REV","PSAR","TRIPLE_SCR","IBS_LOW","HI52_NEAR"])
# [V33.619] 자동 조율 거르개 대조(같은 변동성 큰 시세)
regv = PB._regime(Pv["close"])[0]; atrv = PB._daily_state(Pv, [])[4]; fmv = PB._flt_masks(Pv, regv, atrv)
FMv = {k: np.asarray(fmv[k])[-120:].astype(int).tolist() for k in ("trend", "noBear", "calm", "up20", "notExt", "dip5", "rsiMid")}
FMv["trend+dip5"] = (np.asarray(fmv["trend"]) & np.asarray(fmv["dip5"]))[-120:].astype(int).tolist()
# [V33.620] 최근 성적 스위치 · 최근 가중 표
import pandas as _pd
hist = _pd.DataFrame({"pb": ["A"] * 20 + ["B"] * 20, "x": list(range(80, 100)) * 2, "ex": [-1.0] * 20 + [1.0] * 20, "t": list(range(70, 90)) * 2})
te = _pd.DataFrame({"pb": ["A", "B", "A"], "t": [101, 101, 200]})
gok = PB._gate_ok(hist, te, 40).astype(int).tolist()
dd = _pd.DataFrame({"pb": ["A"] * 200, "t": list(range(200)), "ex": [-1.0] * 100 + [1.0] * 100, "hd": 1.0})
for k_ in ("k0", "k1", "k2", "k3"):
    dd[k_] = "*"
dec = [PB._shrunk_table(dd)[("*", "A")][2], PB._shrunk_table(dd, decay=20, tcol="t", ref=200)[("*", "A")][2]]; RGv = [str(x) for x in regv[-120:]]
# [V33.619] 자동 조율 귀무·양성 대조 — 하루를 26걸음으로 걸은 무작위 시세(진짜 고가·저가)
def _path(seed, T=800, N=220, sub=26, sg=0.018):
    r2 = np.random.default_rng(seed)
    lp = np.log(50) + np.cumsum(r2.normal(0, sg / np.sqrt(sub), (T * sub, N)), axis=0).reshape(T, sub, N)
    prev = np.concatenate([np.full((1, N), np.log(50)), lp[:-1, -1, :]], axis=0)
    o_ = np.exp(prev + r2.normal(0, 0.002, (T, N))); al = np.concatenate([np.log(o_)[:, None, :], lp], axis=1)
    ix = [20220101 + k for k in range(T)]; D_ = lambda a: pd.DataFrame(a, index=ix)
    return {"close": D_(np.exp(lp[:, -1, :])), "open": D_(o_), "high": D_(np.exp(al.max(axis=1))), "low": D_(np.exp(al.min(axis=1))), "volume": D_(r2.lognormal(13, .5, (T, N)))}
Pn = _path(4); _, tn = PB.tune_daily(Pn, "us", CAT.signals(Pn), log=lambda *a: None)
tnull = [k for k, v in tn.items() if v["prof"] != "base" or v["flt"]]
Pp = _path(5); C_ = Pp["close"]; Sx = CAT.signals(Pp, ids=["ENVELOPE"])["ENVELOPE"].values & (C_ > C_.rolling(200).mean()).values
add = np.zeros(C_.shape)
for t_, j_ in zip(*np.nonzero(Sx)):
    add[t_ + 1:t_ + 11, j_] += 0.004
cum = np.exp(np.cumsum(add, axis=0)); pcum = np.vstack([np.ones((1, C_.shape[1])), cum[:-1]])
Pp = {"close": Pp["close"] * cum, "high": Pp["high"] * cum, "low": Pp["low"] * cum, "open": Pp["open"] * pcum, "volume": Pp["volume"]}
_, tp_ = PB.tune_daily(Pp, "us", CAT.signals(Pp), log=lambda *a: None)
tpos = tp_["ENVELOPE"]
Pva = {k: Pv[k].values.round(6).tolist() for k in ("open","high","low","close","volume")}
# [V33.664] 진입 미지수 — 기본값 = 지금 신호(도감 전부) · 무작위 미지수에서 학습기 = 워커
import playbook_params as PPm
svAll = CAT.signals(Pv)
ppEq = [pb for pb in PPm.ENTRY if (PPm.sig(Pv, pb) != svAll[pb].fillna(False).values.astype(bool)).sum()]
rr_ = np.random.default_rng(9)
EPr = {pb: {k: lad[int(rr_.integers(len(lad)))] for k, lad in v[2].items()} for pb, v in PPm.ENTRY.items() if pb not in PB.CROSS_PB and v[2]}
SvP = {pb: PPm.sig(Pv, pb, EPr[pb])[-120:].astype(int).tolist() for pb in EPr}
GRv = PPm.groups(Pv)[-1].tolist()
# [V33.667] 공통 수식 조건(무작위) — 학습기 = 워커(rs6 는 어제 순위)
rr2 = np.random.default_rng(13)
EPm = {pb: dict(EPr[pb], **{k: lad[int(rr2.integers(1, len(lad)))] for k, lad in PPm.MODS.items() if rr2.random() < 0.6}) for pb in EPr}
SvM = {pb: PPm.sig(Pv, pb, EPm[pb])[-120:].astype(int).tolist() for pb in EPm}
RS6 = np.round(PPm.rs6(Pv).shift(1).values[-120:], 6).tolist()
# [V33.672] 고차원 수식(메타) — 학습기 = 워커 · 무작위 계수
MFv = PB.meta_features(Pv)
rr3 = np.random.default_rng(21)
MM = {"mu": rr3.normal(0, 1, len(PB.META_FEATS)).tolist(), "sd": (rr3.uniform(0.5, 3, len(PB.META_FEATS))).tolist(), "b": rr3.normal(0, 1, len(PB.META_FEATS) + 1).tolist(), "th": 0.0}
MP = []
for q in range(0, 120, 7):
    t_ = Pv["close"].shape[0] - 120 + q
    row = []
    for j_ in range(0, 40, 3):
        x = np.array([f[t_, j_] for f in MFv], dtype=float)
        row.append(None if not np.isfinite(x).all() else float(PB.meta_pred((np.array(MM["mu"]), np.array(MM["sd"]), np.array(MM["b"])), x[None, :])[0]))
    MP.append(row)
Sv = {k: sv[k].values[-120:].astype(int).tolist() for k in sv}
# 5분 단타 진입 — 무작위 하루 30개(봉 78개)
ib = []
for q in range(30):
    cc = 50*np.exp(np.cumsum(rng.normal(0, 0.003, 78))); hh = cc*(1+rng.uniform(0,0.002,78)); ll = cc*(1-rng.uniform(0,0.002,78)); vv = rng.lognormal(8,.6,78)
    pc_ = float(cc[0] / 0.98) if q % 2 == 0 else float(cc[0] * (1 + rng.normal(0, 0.01)))   # [V33.619] 반은 −2% 하락 갭
    ctx = {"pc": pc_, "ph": pc_ * 1.01, "pl": pc_ * 0.97}
    F = PB.intra_fires(cc, hh, ll, vv, ctx)
    ib.append({"c": cc.tolist(), "h": hh.tolist(), "l": ll.tolist(), "v": vv.tolist(), "ctx": ctx, "F": {k: v.astype(int).tolist() for k, v in F.items()}})
S = json.loads(${JSON.stringify(JSON.stringify(samples))})
s = np.array([[np.nan if x is None else x for x in r] for r in S], dtype=float)
dk = PB.daily_keys(["BULL"]*len(s), s[:,0], s[:,1], s[:,2], s[:,3], s[:,4].astype(int))
I = np.array(${JSON.stringify(isamp)}, dtype=float)
ik = PB.intra_keys(["CRASH"]*len(I), I[:,0], I[:,1], I[:,2].astype(int))
print(json.dumps({"null": null_d.get("pass"), "pos": pos, "pick": ch and ch[0], "G": G, "Pa": Pa, "Sd": Sd, "K": K, "ib": ib, "dk": [[str(x) for x in lv] for lv in dk], "ik": [[str(x) for x in lv] for lv in ik],
  "veto": veto, "Pva": Pva, "Sv": Sv, "ppEq": ppEq, "EPr": EPr, "SvP": SvP, "GRv": GRv, "EPm": EPm, "SvM": SvM, "MM": MM, "MP": MP, "RS6": [[None if x != x else x for x in r] for r in RS6], "FMv": FMv, "gok": gok, "dec": dec, "rulesA": PB.RULES_ADAPT, "cqs": list(PB.CAND_QS), "RGv": RGv, "tnull": tnull, "tpos": tpos, "INPB": sorted(PB.INTRA_PB), "LF": LF, "MR": MR, "RG": RG, "tab5len": len(next(iter(tab5.values()))), "snapMr": sorted(k for k, v in PB.DAILY_PB.items() if v.get("mr")),
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
const W = new Function("_num", "getMA", "getRSI", "STRAT_ROUTE", "MACRO_SCHED", fnSrc + "; return { pbMetaFeats, pbMetaScore, PB_ABS_TRIAL, PB_EP_DEF, PB_KEYS, PB_ROUTE, pbDailyKeys, pbIntraKeys, pbChoose, _pbPass, pbRoutePick, pbExitWhy, pbEvNear, pbDailyFires, pbIntraFires, pbAgg5, pbLiveDaily, pbLiveFilterOk };")(_num, getMA, getRSI, STRAT_ROUTE, MACRO_SCHED);

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
  { const T = o.Pva.close.length, cnt = Object.fromEntries(["OS_DEEP","CAPIT_REV","ICHIMOKU","KELTNER","DONCHIAN","MACD_X","ENVELOPE","ELDER_RAY","WILLR","CCI_REV","PSAR","TRIPLE_SCR","IBS_LOW","HI52_NEAR"].map((k) => [k, 0])), bad = [];
    for (let j = 0; j < o.Pva.close[0].length; j++) {
      const col = (k) => o.Pva[k].map((r) => r[j]);
      const A = { o: col("open"), h: col("high"), l: col("low"), c: col("close"), v: col("volume") };
      for (let q = 0; q < 120; q++) { const t = T - 120 + q, F = W.pbDailyFires({ o: A.o.slice(0, t + 1), h: A.h.slice(0, t + 1), l: A.l.slice(0, t + 1), c: A.c.slice(0, t + 1), v: A.v.slice(0, t + 1) });
        for (const pb of ["OS_DEEP","CAPIT_REV","ICHIMOKU","KELTNER","DONCHIAN","MACD_X","ENVELOPE","ELDER_RAY","WILLR","CCI_REV","PSAR","TRIPLE_SCR","IBS_LOW","HI52_NEAR"]) { const js = F.includes(pb) ? 1 : 0; cnt[pb] += js; if (js !== o.Sv[pb][q][j]) bad.push([pb, t, j, js]); } } }
    chk(!bad.length && Object.values(cnt).every((x) => x > 0), "[V33.618·619] 폭락장 반등 2종 + 고전 기술적 10종(이치모쿠·켈트너·돈치안·MACD·엔벨로프·엘더·%R·CCI·SAR·삼중창) 학습기 = 워커 " + JSON.stringify(cnt), JSON.stringify(bad.slice(0, 4))); }
  { // [V33.664] 무작위 미지수 대조
    const T = o.Pva.close.length, bad = [], cnt = {};
    for (const pb in o.EPr) cnt[pb] = 0;
    for (let j = 0; j < o.Pva.close[0].length; j++) {
      const col = (k) => o.Pva[k].map((r) => r[j]);
      const A = { o: col("open"), h: col("high"), l: col("low"), c: col("close"), v: col("volume") };
      for (let q = 0; q < 120; q++) { const t = T - 120 + q, F = W.pbDailyFires({ o: A.o.slice(0, t + 1), h: A.h.slice(0, t + 1), l: A.l.slice(0, t + 1), c: A.c.slice(0, t + 1), v: A.v.slice(0, t + 1) }, o.EPr);
        for (const pb in o.EPr) { const js = F.includes(pb) ? 1 : 0; cnt[pb] += js; if (js !== o.SvP[pb][q][j]) bad.push([pb, t, j, js, JSON.stringify(o.EPr[pb])]); } } }
    const fired = Object.values(cnt).filter((x) => x > 0).length;
    chk(!bad.length && fired >= 15, "[V33.664] 진입 미지수(무작위 값) — 학습기 = 워커 · " + Object.keys(o.EPr).length + "종 중 " + fired + "종 발화 " + JSON.stringify(cnt), JSON.stringify(bad.slice(0, 4)));
    { const bad2 = [], cnt2 = {}; for (const pb in o.EPm) cnt2[pb] = 0;
      for (let j = 0; j < o.Pva.close[0].length; j++) {
        const col = (k) => o.Pva[k].map((r) => r[j]);
        const A = { o: col("open"), h: col("high"), l: col("low"), c: col("close"), v: col("volume") };
        for (let q = 0; q < 120; q++) { const t = T - 120 + q, F = W.pbDailyFires({ o: A.o.slice(0, t + 1), h: A.h.slice(0, t + 1), l: A.l.slice(0, t + 1), c: A.c.slice(0, t + 1), v: A.v.slice(0, t + 1) }, o.EPm, o.RS6[q][j]);
          for (const pb in o.EPm) { const js = F.includes(pb) ? 1 : 0; cnt2[pb] += js; if (js !== o.SvM[pb][q][j]) bad2.push([pb, t, j, js, JSON.stringify(o.EPm[pb])]); } } }
      chk(!bad2.length && Object.values(cnt2).filter((x) => x > 0).length >= 10, "[V33.667] 공통 수식 조건(추세·6개월 순위·거래량·ATR 무작위) — 학습기 = 워커 " + JSON.stringify(cnt2), JSON.stringify(bad2.slice(0, 4))); }
    { const bad3 = []; let nOk = 0;
      for (let qi = 0; qi < o.MP.length; qi++) { const q = qi * 7, t = T - 120 + q;
        for (let ji = 0; ji < o.MP[qi].length; ji++) { const j = ji * 3, col = (k) => o.Pva[k].map((r) => r[j]).slice(0, t + 1);
          const D = { o: col("open"), h: col("high"), l: col("low"), c: col("close"), v: col("volume") };
          const js = W.pbMetaScore(W.pbMetaFeats(D, t, o.RS6[q][j]), o.MM), py = o.MP[qi][ji];
          if (py == null ? js != null : (js == null || Math.abs(js - py) > 1e-4 * Math.max(1, Math.abs(py)))) bad3.push([t, j, js, py]); else if (py != null) nOk++; } }
      chk(!bad3.length && nOk >= 100, "[V33.672] 고차원 수식(지표 11개 · 무작위 계수) 학습기 = 워커 (" + nOk + "칸)", JSON.stringify(bad3.slice(0, 3))); }
    chk(Array.isArray(o.ppEq) && o.ppEq.length === 0, "[V33.664] 미지수 기본값 = 지금 도감 신호(31종)", JSON.stringify(o.ppEq));
    const Wd = new Function("_num", "getMA", "getRSI", "STRAT_ROUTE", "MACRO_SCHED", fnSrc + "; return { PB_EP_DEF };")(_num, getMA, getRSI, STRAT_ROUTE, MACRO_SCHED);
    chk(/"epDef": \{k: v\[1\] for k, v in PP\.ENTRY\.items\(\)\}/.test(readFileSync(dir + "playbook_sim.py", "utf8")) && Object.keys(Wd.PB_EP_DEF).length === 27,
        "[V33.664] 워커 미지수 기본표 27종(횡단면 3종·SAR 은 학습기 목록) · 학습기가 기본표를 함께 보냄"); }
  chk(JSON.stringify(o.veto) === '["B","A"]', "[V33.624] 학습기 국면 거부권: 폭락 국면 칸이 음(−2%)인 A 는 전체 성적이 좋아도 폭락장에선 안 고르고 B · 강세장에선 A", JSON.stringify(o.veto));
  { const Tt = { "*": { A: [500, 0.6, 1.0, 0.8, 5], B: [500, 0.5, 0.3, 0.2, 5] }, "CRASH|*": { A: [80, 0.3, -2.0, -2.5, 5], B: [80, 0.5, 0.2, 0.1, 5] } };
    const c1 = W.pbChoose(Tt, ["CRASH|1|1|1|1|0", "CRASH|1|1|*", "CRASH|*", "*"], ["A", "B"], { score: "lcb", level: "global" }),
          c2 = W.pbChoose(Tt, ["BULL|1|1|1|1|0", "BULL|1|1|*", "BULL|*", "*"], ["A", "B"], { score: "lcb", level: "global" });
    chk(c1 && c1.pb === "B" && c2 && c2.pb === "A" && c1.alts.some((x) => x[0] === "A" && /국면 거부/.test(x[5] || "")),
        "[V33.624] 워커 국면 거부권: '매매법 전체 성적' 규칙이라도 지금 국면 칸이 음이면 거부(관측창에 사유)", JSON.stringify([c1, c2])); }
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
  { let bad = [], fired = 0; const per = {};
    for (const b of o.ib) for (let i = 2; i < b.c.length; i++) {
      const jsA = W.pbIntraFires(b.c.slice(0, i + 1), b.h.slice(0, i + 1), b.l.slice(0, i + 1), b.v.slice(0, i + 1), b.ctx); jsA.forEach((k) => { per[k] = (per[k] || 0) + 1; });
      const js = jsA.sort().join(",");
      const py = Object.keys(b.F).filter((k) => b.F[k][i]).sort().join(",");
      if (py) fired++;
      if (js !== py && bad.length < 5) bad.push("i" + i + " py[" + py + "] js[" + js + "]");
    }
    chk(bad.length === 0 && fired > 30, "5분 단타 진입 조건: 학습기 ↔ 워커 같은 봉(발화 " + fired + ")", bad.join(" | "));
    chk(per.GAP_FILL > 0 && per.PIVOT_BNC > 0 && o.INPB.includes("GAP_FILL") && o.INPB.includes("PIVOT_BNC"), "[V33.619] 갭 메우기 · 피봇 반등(전일 고·저·종) 학습기 = 워커 " + JSON.stringify(per)); }
  // [V33.619] 자동 조율
  { let bad = [];
    const T = o.Pva.close.length;
    for (let j = 0; j < o.Pva.close[0].length; j++) {
      const col = (k) => o.Pva[k].map((r) => r[j]);
      const A = { o: col("open"), h: col("high"), l: col("low"), c: col("close"), v: col("volume") };
      for (let q = 0; q < 120; q++) { const t = T - 120 + q, D = { o: A.o.slice(0, t + 1), h: A.h.slice(0, t + 1), l: A.l.slice(0, t + 1), c: A.c.slice(0, t + 1), v: A.v.slice(0, t + 1) };
        for (const f of ["trend", "noBear", "calm", "up20", "notExt", "dip5", "rsiMid", "trend+dip5"]) { const js = W.pbLiveFilterOk("ZZ", D, o.RGv[q], { flt: f }) ? 1 : 0; if (js !== o.FMv[f][q][j] && bad.length < 5) bad.push([f, t, j, js]); } } }
    chk(!bad.length, "[V33.619·620] 조율 거르개 7종(trend·noBear·calm·up20·notExt·dip5·rsiMid) + 2개 조합 학습기 = 워커", JSON.stringify(bad));
    chk(JSON.stringify(o.gok) === "[0,1,1]", "[V33.620] 최근 성적 스위치: 최근 40일 끝난 모의 거래 평균 < 0(표본 ≥ 15)인 매매법은 쉬고, 오래된 손실은 안 센다", JSON.stringify(o.gok));
    chk(Math.abs(o.dec[0]) < 0.2 && o.dec[1] > 0.5, "[V33.620] 최근 가중 표: 앞 절반 손실·뒤 절반 이익이면 가중 표가 이익 쪽(국면 변화 적응)", JSON.stringify(o.dec));
    chk(o.rulesA.some((r) => r.decay) && o.rulesA.some((r) => r.gate) && JSON.stringify(o.cqs) === "[0.8,0.6,0.4,0]", "[V33.620·621] 규칙 후보에 최근 가중·성적 스위치 · 후보 폭 상위 20·40·60% · OMNI-Q 거름 없음 중 검증이 고른다");
    chk(o.tnull.length <= 2, "[V33.619] 조율 귀무: 무작위 시세(진짜 고·저가)에선 29종 중 2종 이하만 바꾼다(달 묶음 t · 확인 구간)", JSON.stringify(o.tnull));
    chk(String(o.tpos.flt || "").split("+").includes("trend") && o.tpos.test.tuned[1] > o.tpos.test.base[1] + 0.5, "[V33.620] 정밀 조율 양성: '종가 > MA200 일 때만 오르는' 엔벨로프 우위를 심으면 한 칸씩 올라 trend 거르개를 찾고 손대지 않은 구간에서도 낫다", JSON.stringify(o.tpos));
    chk(o.tpos.diag && o.tpos.diag.rc && Array.isArray(o.tpos.problems) && Array.isArray(o.tpos.path) && o.tpos.path.length >= 2, "[V33.620] 매매법 진단(청산 사유·국면별·문제) · 걸어온 길 기록", JSON.stringify([o.tpos.problems, o.tpos.path])); }
  { const Wg = new Function("_num", "getMA", "getRSI", "STRAT_ROUTE", "MACRO_SCHED", fnSrc + "; return { pbGateOff, pbCandMin, pbChoose, pbCandScoreMap };")(_num, getMA, getRSI, STRAT_ROUTE, MACRO_SCHED);
    const dly = { val: { rule: { score: "lcb", level: "global", gate: 40 } }, gate: { A: [20, -0.4], B: [20, 0.3], C: [5, -2] } };
    chk(JSON.stringify(Wg.pbGateOff(dly, ["A", "B", "C"])) === '["A"]' && Wg.pbGateOff({ ...dly, val: { rule: { score: "m", level: "fine" } } }, ["A"]).length === 0,
        "[V33.620] 워커 성적 스위치: 규칙에 gate 가 있을 때만 · 표본 ≥ 15 · 평균 < 0 인 매매법만 쉰다");
    { const oq = { ts: 1, scores: { a: 0.9, b: 0.2, c: 0.5 }, heads: { r20: { a: 0.3, b: 0.8, c: 0.6 } } }, sh = (h) => ({ daily: { val: { candHead: h } } });
      const m20 = Wg.pbCandScoreMap(sh("20"), { ...oq }), mav = Wg.pbCandScoreMap(sh("avg"), { ...oq }), m5 = Wg.pbCandScoreMap(sh("5"), { ...oq });
      chk(m20.b === 1 && m20.a < m20.c && mav.a === 1 && mav.b < mav.c && m5.a === 1 && m5.b < m5.c, "[V33.622] 후보 머리 = 학습기 검증이 고른 5일·20일·평균(그날 종목 간 순위로 다시 매김)", JSON.stringify([m5, m20, mav])); }
    chk(Wg.pbCandMin({ daily: { val: { candQ: 0.6 } } }) === 0.6 && Wg.pbCandMin({ daily: { val: {} } }) === 0.8, "[V33.620] 후보 폭 = 학습기 검증이 고른 값(없으면 상위 20%)");
    const ch = Wg.pbChoose({ "*": { A: [100, 0.5, 0.5, 0.4, 1], B: [100, 0.5, -0.2, -0.3, 1] } }, ["*"], ["A", "B", "Z"]);
    chk(ch && ch.pb === "A" && ch.alts.length === 3, "[V33.620] 고른 근거: 뜬 매매법마다 칸 값(관측창)", JSON.stringify(ch));
    chk(/cross: \(x\.cross && typeof x\.cross === "object"\) \? x\.cross : \{\}, gate:/.test(S), "[V33.620] 업로드가 cross(횡단면 3종)·gate 를 버리지 않는다 — 종전엔 상대강도·5일 낙폭·듀얼 모멘텀이 실전에서 한 번도 안 떴다"); }
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
{ // [V33.662] 프리·애프터 진입 — 정규장 종가 일봉으로 신호 · 시간외 체결가가 종가 ±extGapMax% 안일 때만 · 정규장 중간(마감 30분 밖)은 그대로 안 삼
  const stD = { ...st, intra: null }, ref = cs[N0 - 1], base = { ...ctx, minToClose: null, bars5: null };
  const a = W.pbRoutePick(stD, { ...base, session: "post", extPx: ref * 1.01, refPx: ref }, now);
  const b = W.pbRoutePick(stD, { ...base, session: "post", extPx: ref * 1.05, refPx: ref }, now);
  const c = W.pbRoutePick(stD, { ...base, session: "pre", extPx: ref * 0.99, refPx: ref }, now);
  const d = W.pbRoutePick(stD, { ...ctx, minToClose: 200, bars5: null }, now);
  const e = W.pbRoutePick(stD, { ...base, session: "post", extPx: ref * 1.05, refPx: ref, shadow: true }, now);
  chk(a && a.kind === "daily" && a.session === "post" && b === null && c && c.session === "pre" && d === null && e && e.outWin === true && e.xGap === 5,
      "[V33.662] 애프터·프리: 종가 ±2% 안이면 일봉 매매법 매수(장 상태 표시) · 벗어나면 안 삼(관측엔 차이 %) · 정규장 중간은 그대로 안 삼", JSON.stringify([a && a.session, b, c && c.session, d, e && [e.outWin, e.xGap]]));
}
{ // [V33.669] /api/playbook 응답의 주력·연속 통과·독립 통과 칸이 줄 끝 주석에 묻히지 않았는가(실제 사고: 주석이 primary 를 삼킴)
  const ln = S.split("\n").find((x) => x.includes("primary: pbPrimaryOn(r, Date.now())")) || "";
  chk(ln && ln.indexOf("//") < 0 || (ln.indexOf("//") > ln.indexOf("indep: pbIndepPasses(r.passLog)")), "[V33.669] /api/playbook primary·passStreak·indep 가 코드로 살아 있다(주석 안 아님)", ln.slice(0, 160));
}
{ // [V33.669] 미국 절대 성적 기준 시험 매수(사용자 승인) — 미국만 · 주력은 종전 기준 · 최근 확실한 악화면 안 삼
  const vA = { ...val, pass: false, n: 3000, mean: 0.75, t: 2.96, base: 0.94, recent: { ok: true } };
  const stA = { ...st, intra: null, daily: { ...st.daily, val: vA } }, cU = { ...ctx, minToClose: 20, bars5: null, symbol: "AAA" }, cK = { ...cU, symbol: "005930.KS" };
  const u1 = W.pbRoutePick({ ...stA, mkt: "us" }, cU, now), k1 = W.pbRoutePick({ ...stA, mkt: "kr" }, cK, now);
  const u2 = W.pbRoutePick({ ...stA, mkt: "us", daily: { ...stA.daily, val: { ...vA, recent: { ok: false } } } }, cU, now);
  const u3 = W.pbRoutePick({ ...stA, mkt: "us", daily: { ...stA.daily, val: { ...vA, t: 1.5 } } }, cU, now);
  chk(u1 && u1.kind === "daily" && k1 === null && u2 === null && u3 === null && /pbPrimaryOn\(st, nowMs\) \{ return !!\(st && st\.daily && _pbPass\(st\.daily\.val\)/.test(S),
      "[V33.669] 미국: 무작위 미달이어도 평균>0·t≥2·최근 악화 없음이면 시험 매수 / 한국은 안 삼 / t<2·최근 악화면 안 삼 / 주력은 종전 기준", JSON.stringify([u1 && u1.pb, k1, u2, u3]));
}
{ // [V33.674] 월 맞춤 판정(사용자 (나)): 주력 자격 = 같은 달 무작위 초과 mx>0 · 달 t mT≥2 / 시험 매수는 종전 거래 t 통과(passTrade)로도 연다 · 둘 다 아니면 한국은 안 삼
  const vM = { ...val, pass: false, passMode: "matched", passTrade: true, n: 3000, mean: 0.9, t: 2.4, base: 0.5, mx: -0.1, mT: -0.4, recent: { ok: true } };
  const stM = { ...st, intra: null, mkt: "kr", daily: { ...st.daily, val: vM } }, cK = { ...ctx, minToClose: 20, bars5: null, symbol: "005930.KS" };
  const k1 = W.pbRoutePick(stM, cK, now), k2 = W.pbRoutePick({ ...stM, daily: { ...stM.daily, val: { ...vM, passTrade: false } } }, cK, now);
  const k3 = W.pbRoutePick({ ...stM, daily: { ...stM.daily, val: { ...vM, passTrade: true, recent: { ok: false } } } }, cK, now);
  const p1 = W._pbPass({ ...vM, pass: true, mx: 0.2, mT: 2.1, fwd: { ok: true } }) && !W._pbPass({ ...vM, pass: true, mx: 0.2, mT: 2.1, fwd: { ok: false } }) && !W._pbPass({ ...vM, pass: true, mx: 0.2, mT: 2.1 }), p2 = W._pbPass({ ...vM, pass: true, mx: 0.2, mT: 1.9 }), p3 = W._pbPass({ ...vM, pass: true, passMode: undefined, t: 2.4, mean: 0.9, base: 0.5 });
  chk(k1 && k1.kind === "daily" && k2 === null && k3 === null && p1 && !p2 && p3 && /PASS_MODE = os\.environ\.get\("PB_PASS", "matched"\)/.test(readFileSync(dir + "playbook_sim.py", "utf8")),
      "[V33.674] 판정=월 맞춤(달 t≥2) · 시험 매수는 종전 기준으로도 유지 · 최근 악화·둘 다 미달이면 안 삼 · 옛 업로드는 종전 판정", JSON.stringify([k1 && k1.pb, k2, k3, p1, p2, p3]));
}
{ const Q = readFileSync(dir + "playbook_sim.py", "utf8");
  chk(/FWD_START = int\(os\.environ\.get\("PB_FWD_START", "20261027"\)\)/.test(Q) && /FWD_MIN_DAYS = 60/.test(Q) && /out\["ok"\] = bool\(days >= FWD_MIN_DAYS and out\["n"\] >= 30 and \(out\.get\("wx"\) or 0\) > 0 and \(out\.get\("wT"\) or 0\) >= 2\)/.test(Q),
      "[V33.675] 전진 구간 사전 등록: 2026-10-27 동결 · 거래일 ≥ 60 · 거래 ≥ 30 · 같은 주 무작위 초과 > 0 · 주 묶음 t ≥ 2 (주력 자격)");
  chk(/CAP_ON = os\.environ\.get\("PB_CAP", "1"\) != "0"/.test(Q) && /if day_n >= CAP\["day"\] or len\(opn\) >= CAP\["open"\]/.test(Q) && /CAP\["on"\] = bool\(CAP_ON and timecol == "t"\)/.test(Q),
      "[V33.675] 시뮬도 실전 상한(하루 6 · 동시 min(12, 시장 상한)) — 고른 것·무작위 둘 다");
  chk(/def luck_level\(K\)/.test(Q) && /best_q\[0\] < luck\["level"\]/.test(Q), "[V33.675] 고르기 운 보정: 설정·규칙 K 개 최대의 기대(운 수준) 이하면 사전 등록 기본 설정");
  chk(/PB_SEL = os\.environ\.get\("PB_SEL", "m"\)/.test(Q), "[V33.675] 고르기 잣대 = 판정과 같은 월 맞춤 달 묶음 t");
  chk(/st\["legacy"\] = l0/.test(Q), "[V33.675] 시험 매수용 종전 표본(상한 없음) 판정을 legacy 로 함께 보낸다");
  chk(/RANK_MODE = os\.environ\.get\("PB_RANK", "omq"\)/.test(Q) && /_hot\.sort\(function \(a, b\) \{ return b\[1\] - a\[1\]; \}\)/.test(S),
      "[V33.682] 상한이 찰 때 OMNI-Q 순위 높은 후보부터 — 학습기 시뮬(PB_RANK=omq)과 워커 실전(_hot 정렬)이 같은 순서");
  chk(/def panic_book\(P, oos, reg, head="5", q=0\.8, mk="kr"\)/.test(Q) && /lag = np\.concatenate\(\[\[False\], pn\[:-1\]\]\)/.test(Q) && /out\["ok"\] = bool\(pr\["n"\] >= PANIC_BOOK_MIN and \(pr\["mean"\] or 0\) > 0 and \(pr\["t"\] or 0\) >= 2 and \(po\["mean"\] or 0\) > 0\)/.test(Q)
      && /panicBook: r\.panicBook \|\| null/.test(S), "[V33.683] 공황 반등 바구니 — 하루 늦은 공황 · 사전 등록 규칙(앞80% n≥20·평균>0·t≥2 · 뒤20% 양수) · API 전달"); }
{ // [V33.675] 시험 매수 = legacy(종전 표본) 기준 — 상한 표본이 작아 t 가 낮아도 시험 매수는 (나) 대로 유지
  const v = { ...val, pass: false, passMode: "matched", passTrade: false, n: 150, mean: 1.2, t: 0.7, base: 3.3, legacy: { passTrade: false, n: 3000, mean: 0.78, t: 3.0, base: 0.98, recent: { ok: true } } };
  const stU = { ...st, intra: null, mkt: "us", daily: { ...st.daily, val: v } }, cU = { ...ctx, minToClose: 20, bars5: null, symbol: "AAA" };
  const u1 = W.pbRoutePick(stU, cU, now), u2 = W.pbRoutePick({ ...stU, daily: { ...stU.daily, val: { ...v, legacy: { ...v.legacy, t: 1.2 } } } }, cU, now);
  chk(u1 && u1.kind === "daily" && u2 === null, "[V33.675] 미국 절대 시험은 legacy 표본으로 판정(t≥2) · legacy t<2 면 안 삼", JSON.stringify([u1 && u1.pb, u2])); }
{ // [V33.664] 종목 그룹 → 그 그룹의 진입·청산 미지수(학습기가 시스템 검증을 통과시킨 것만 보냄)
  const P0 = firedNow.find((x) => W.PB_EP_DEF && x in W.PB_EP_DEF) || firedNow[0], d0 = (W.PB_EP_DEF || {})[P0] || {}, k0 = Object.keys(d0)[0];
  const ep2 = k0 ? { [k0]: d0[k0] } : {};
  const stG = { ...st, intra: null, daily: { ...st.daily, grp: { AAA: 2 }, pb: { ...st.daily.pb, [P0]: { ...st.daily.pb[P0], ep: { "2": ep2 }, grp: { "2": { hold: 17 } } } } } };
  const g2 = W.pbRoutePick(stG, { ...ctx, minToClose: 20, bars5: null }, now), g0 = W.pbRoutePick({ ...stG, daily: { ...stG.daily, grp: { AAA: 0 } } }, { ...ctx, minToClose: 20, bars5: null }, now);
  chk(g2 && g2.grp === 2 && (g2.pb !== P0 || (g2.tunedExit === true && g2.hold === 17 && JSON.stringify(g2.tunedEp) === JSON.stringify(ep2))) && g0 && g0.grp === 0 && !g0.tunedExit && g0.hold === 8,
      "[V33.664] 종목 그룹 2 → 그 그룹 진입 미지수·청산 미지수(보유 17일) · 그룹 0 → 기본", JSON.stringify([P0, g2 && [g2.pb, g2.grp, g2.hold, g2.tunedExit], g0 && [g0.pb, g0.grp, g0.hold]]));
  chk(/tier2: Array\.isArray\(x\.tier2\) \? x\.tier2\.map\(String\) : \[\], grp: _obj\(x\.grp\)/.test(S), "[V33.664] 워커가 학습기 업로드의 tier2(보조 목록)·grp(종목 그룹)를 저장한다(종전엔 tier2 를 버려 보조 순위 규칙이 실전에 없었다)");
}
{ // [V33.662] 시간외 공통 관문: 매매법 AI 는 위원회 확률 대신 검증 통과로 · trades.session 기록
  chk(/const _pbRoute = !!\(signal && signal\.isStratRoute && signal\.sr\);/.test(S) && /if \(!_pbRoute && !\(typeof p === "number"/.test(S) && /Math\.floor\(qty \* _clamp\(_num\(et\.sizeMult, 0\.5\)/.test(S),
      "[V33.662] 시간외 매매법 매수: 확률 바닥만 면제 · 크기 ×0.5 · 세션당 개수 · 체결시각 검증 가격은 그대로");
  chk(/ALTER TABLE trades ADD COLUMN session TEXT/.test(S) && (S.match(/INSERT INTO trades \(ts, market, symbol, side, qty, price, pnl, pnl_pct, reason, session\)/g) || []).length === 2 && /if \(__tradesSessCol\) return DB\.prepare/.test(S),
      "[V33.662] trades.session(프리·정규·애프터) — 두 기록 경로 모두 · 칸이 생긴 뒤에만 씀");
  chk(/function tradeSessionOf\(market, ts\) \{\n  if \(!MARKET_HOURS\[market\]\) return null;/.test(S), "[V33.663] 장 시간표 없는 시장(cm 등)은 session 을 비운다('장외' 오표기 금지)");
  chk(/intra: \{ symbol: symbol, price: evPrice, prevClose: bq\.prevClose, regPrice: bq\.price/.test(S) && /session: extSessMkt \|\| null, extPx: price, refPx: _pbRef/.test(S),
      "[V33.662] 메인 루프가 시간외 세션·정규장 종가를 매매법 AI 에 넘긴다");
}
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
{ const sg = { sid: "GAP_FILL", kind: "intra", tpPct: null, tpPx: 102, bars: 0 };
  chk(/^SR-TP/.test(W.pbExitWhy(sg, 100, 102.05, now - 60000, now, 200) || "") && W.pbExitWhy(sg, 100, 101.5, now - 60000, now, 200) === null, "[V33.619] 단타 가격 목표(갭 = 전일 종가 · 피봇)에서 익절");
  const sq = { sid: "WILLR", kind: "daily", stop: 3, tpR: null, tpPct: 3, hold: 5, tstop: 3 };
  chk(/^SR-TIME/.test(W.pbExitWhy(sq, 100, 99, now - 4.5 * 86400000, now, 200) || "") && W.pbExitWhy(sq, 100, 101, now - 4.5 * 86400000, now, 200) === null && /^SR-TP/.test(W.pbExitWhy(sq, 100, 103.1, now, now, 200) || ""),
      "[V33.619] 조율 프로필 quick: 3거래일 지나 손실이면 매도 · +3% 익절(평균회귀 밖에서도)");
  chk(/pbLiveFilterOk\(pb, D, ctx\.reg, st\.daily\.pb && st\.daily\.pb\[pb\]\)/.test(S) && /tpPx: _sp\.tpPx == null \? null : _sp\.tpPx/.test(S), "[V33.619] 조율 거르개가 실전 판정에 · 가격 목표가 매수 메타에"); }
const sd = { sid: "PULLBACK", kind: "daily", stop: 5, tpR: 2, hold: 10 };
chk(/^SR-TP/.test(W.pbExitWhy(sd, 100, 110.5, now, now, 200)) && /^SR-TIME/.test(W.pbExitWhy(sd, 100, 101, now - 15 * 86400000, now, 200)) && W.pbExitWhy(sd, 100, 101, now - 86400000, now, 200) === null,
    "스윙 청산: 익절(2R = 10%) · 최대 보유(10거래일 ≈ 14.5일)");
chk(/_pbS >= pbCandMin\(__sr\)/.test(S) && /candMin: 0\.80/.test(S) && /omniqFresh\(__omniq, Date\.now\(\)\)/.test(S), "후보 = OMNI-Q 5일 머리 상위 20%(신선할 때만)");
chk(/getState\(DB, "playbook:" \+ market/.test(S) && /path === "\/api\/playbook" && request\.method === "POST"/.test(S), "표 업로드·조회 배선");
chk(/playbook_sim\.run\(/.test(readFileSync(dir + "omniq_gha.py", "utf8")) && /"5m"/.test(readFileSync(dir + "omniq_gha.py", "utf8")), "GHA 회차: 5분봉 받아 시뮬");
// [V33.609] 선택 규칙 · 자동 주력 전환 · 위원회 퇴역
{ const T2 = { "BULL|0|0|0|0|0": { A: [12, 0.7, 2.0, -0.4] }, "BULL|*": { A: [900, 0.55, 0.3, 0.2], B: [900, 0.56, 0.5, 0.1] }, "*": { A: [9000, 0.5, 0.05, 0.03], B: [9000, 0.52, 0.2, 0.15] } };
  const KK = ["BULL|0|0|0|0|0", "BULL|0|0|*", "BULL|*", "*"];
  chk(W.pbChoose(T2, KK, ["A", "B"], { score: "m", level: "fine" })?.pb === "A", "규칙 평균·전체 칸: 표본 12개짜리 높은 평균(A)을 고른다");
  chk(W.pbChoose(T2, KK, ["A", "B"], { score: "lcb", level: "fine" })?.pb === "B", "규칙 하한·전체 칸: 표본 적은 칸의 우연한 고평균을 버린다(승자의 저주)");
  chk(W.pbChoose(T2, KK, ["A", "B"], { score: "lcb", level: "regime" })?.pb === "A" && W.pbChoose(T2, KK, ["A", "B"], { score: "lcb", level: "global" })?.pb === "B", "규칙 칸 단계: 국면 칸까지만 · 매매법 전체만"); }
{ const now2 = Date.now(), v = { pass: true, n: 400, mean: 0.3, t: 2.4, base: 0.05 };
  const M2 = new Function("_num", "getMA", "getRSI", "STRAT_ROUTE", "MACRO_SCHED", fnSrc + "; return { pbPrimaryOn, PB_PRIMARY_CAPS, pbIndepPasses };")(_num, getMA, getRSI, STRAT_ROUTE, MACRO_SCHED);
  const PL = ["20260301", "20260801"];
  chk(M2.pbPrimaryOn({ ts: now2, passStreak: 2, passLog: PL, daily: { val: v } }, now2) && !M2.pbPrimaryOn({ ts: now2, passStreak: 1, passLog: PL, daily: { val: v } }, now2)
      && !M2.pbPrimaryOn({ ts: now2, passStreak: 2, passLog: PL, daily: { val: { ...v, pass: false } } }, now2) && !M2.pbPrimaryOn({ ts: now2 - 40 * 3600000, passStreak: 2, passLog: PL, daily: { val: v } }, now2),
      "[V33.621] 주력 전환은 일봉 검증 ★2회 연속★ 통과 + 표 신선(36시간)일 때만(한 번 통과는 운일 수 있다)");
  chk(!M2.pbPrimaryOn({ ts: now2, passStreak: 5, passLog: ["20260801", "20260802", "20260901"], daily: { val: v } }, now2) && !M2.pbPrimaryOn({ ts: now2, passStreak: 5, daily: { val: v } }, now2)
      && M2.pbIndepPasses(["20260801", "20260802", "20260901", "20261220", "bad"]) === 2 && M2.pbIndepPasses(null) === 0,
      "[V33.626] 주력은 ★겹치지 않는 판정 구간(시작일 140일 이상 차이) 두 번★ 통과해야 — 같은 구간을 하루 2번 다시 본 연속 통과는 독립 증거가 아니다");
  chk(/dst\["hoFrom"\] = str\(P\["close"\]\.index\[int\(\(dst\.get\("cut"\)/.test(readFileSync(dir + "playbook_sim.py", "utf8")) && /rec\.passLog = _pl;/.test(S), "[V33.626] 학습기가 판정 구간 시작일(hoFrom)을 보내고 워커가 통과 기록(passLog)에 쌓는다");
  chk(/rec\.passStreak = rec\.pass\.daily \? _num\(_prev && _prev\.passStreak, 0\) \+ 1 : 0/.test(S), "[V33.621] 업로드가 연속 통과 수를 센다(미통과면 0)");
  chk(/_ap && _ap\.enabled && __aiReady && !__pbPrim && stratResults\.length === 0/.test(S), "주력 전환된 시장은 AI_PRIMARY 신규 진입을 끈다(미통과 시장은 그대로)");
  chk(/__pbCap = __pbPrim \? PB_PRIMARY_CAPS : STRAT_ROUTE/.test(S) && /signal\.isStratRoute && !\(signal\.sr && signal\.sr\.primary\)/.test(S) && M2.PB_PRIMARY_CAPS.mult === 1.0, "주력 시장은 상한을 올리고 크기 ×1.0 · 아니면 잠정 ×0.5");
  chk(["l1", "icfamily", "bandit", "brain", "mind", "gbdt"].every((k) => new RegExp('if \\(!__pbRetire\\) await _stg\\("' + k + '"').test(S)) && /__pbRetire = pbPrimaryOn\(await getState\(env\.DB, "playbook:us"/.test(S),
      "미·한 둘 다 주력이면 위원회 학습(워커) 퇴역");
  chk(/위원회 학습 건너뜀/.test(readFileSync(dir + "train_gha.py", "utf8")), "미·한 둘 다 주력이면 위원회 학습(GitHub Actions) 퇴역"); }
{ const Q = readFileSync(dir + "playbook_sim.py", "utf8");
  chk(/LAG_FIX = os\.environ\.get\("PB_LAG_FIX", "1"\) != "0"/.test(Q) && /out = np\.vstack\(\[np\.zeros\(\(1, out\.shape\[1\]\), dtype=bool\), out\[:-1\]\]\)/.test(Q)
      && /sig\[pb\] = sig\[pb\]\.shift\(1, fill_value=False\)/.test(Q) && /P\["_grp"\] = _lag1\(P\["_grp_now"\]\)/.test(Q) && /def _cross_now\(pb\)/.test(Q),
      "[V33.671] 시뮬 = 실전 시점: 횡단면 3종 신호·OMNI-Q 후보·변동성 그룹을 하루 늦춤(워커는 학습기 목록을 다음 거래일에 씀) · 워커에 보내는 오늘 목록은 늦추기 전");
  chk(/SPLIT = \(0\.60, 0\.80\)/.test(Q) && /ho = df\[df\[timecol\] >= c2\]/.test(Q), "검증 3구간: 규칙은 [60,80%) 에서 고르고 판정은 손대지 않은 [80,100%) 에서만");
  chk(/busy\.get\(r\.j, -1\) >= r\.t/.test(Q), "검증도 실전처럼 같은 종목은 앞 거래가 끝나야 다시 산다(겹친 표본으로 t 를 부풀리지 않는다)");
  chk(/REC_T = -2\.0/.test(Q) && /rec\["t"\] > REC_T/.test(Q) && !/rx\.mean\(\) > rb\)\)/.test(Q),
      "[V33.660] 최근 구간은 확실한 악화(초과 t ≤ −2)만 미달 — 평균 한 점 비교(적중 52%)로 되돌리지 않는다"); }
{ const Q = readFileSync(dir + "playbook_sim.py", "utf8");
  chk(/\(t < t_fit\) & \(xe < t_fit\)/.test(Q),
      "[V33.672] 메타 수식 학습은 청산까지 t_fit 전에 끝난 거래만 — 라벨이 검증 구간을 엿보지 않는다");
  chk(/vm >= bm \+ TUNE_MARGIN and vt >= bt and \(vp or not bp\)/.test(Q), "[V33.673] 고차원 수식 채택은 검증 평균 +0.05%p 이상 · t 안 낮춤 — 잡음 차이로 안 씀"); }
{ // [V33.609] 관측창 배선
  const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), U = readFileSync(new URL("../public/workspace-ui.js", import.meta.url), "utf8");
  const O = readFileSync(new URL("../public/playbook-observatory.js", import.meta.url), "utf8");
  chk(/id="page-nnviz" data-brain-view="operations"/.test(H) && !/data-brain-tab="playbook"/.test(H) && /<section id="pbObs"/.test(H), "[V33.612] 매매법 AI 실시간 판정은 01 작동 화면 안(00 탭 없음)");
  chk(/if \(view === 'operations'\) pbObs\(\);/.test(U) && /playbook-observatory\.js/.test(U), "01 작동 화면을 열 때 지연 로드");
  { const ST = readFileSync(new URL("../studio/src/models.ts", import.meta.url), "utf8"), BS = readFileSync(new URL("../public/brain-studio.js", import.meta.url), "utf8");
    chk(/key: "playbook"/.test(ST) && /\/api\/playbook/.test(readFileSync(new URL("../studio/src/data.ts", import.meta.url), "utf8")) && /판단 흐름/.test(BS) && /규칙 비교/.test(BS) && /후보 폭 비교/.test(BS), "[V33.612·632] 02 모델 구조(Brain Studio)에 '매매법 AI' 모델 · 새 구조관측(판단 흐름 · 실제 표) 번들 반영"); }
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
  chk(/dWin0 = ctx\.minToClose != null && ctx\.minToClose <= PB_ROUTE\.dailyEntryWin/.test(S) && M3.PB_ROUTE.dailyEntryWin === 30, "[V33.621·662] 일봉 매매법 정규장 진입은 마감 전 30분(+ 프리·애프터는 종가 ±2% 안)(시뮬 = 신호 봉 종가 체결 — 60분이면 그사이 신호가 꺼지는 괴리가 컸다)");
  chk(/AVG\(pnl_pct\) AS m FROM trades WHERE market = \? AND side = 'SELL' AND reason LIKE 'SR-%'/.test(S) && /!_secFull && !_braked/.test(S) && /PB_BRAKE = \{ days: 30, minN: 12, mean: -0\.4/.test(S),
      "[V33.621] 실전 손실 제동(최근 30일 실제 청산 12건+ 평균 ≤ −0.4% → 신규 매수 멈춤) · 같은 섹터 보유 상한 3");
  chk(/const _hf = orderedEval\.filter\(function \(it\) \{ return it && heldSymbols\.has\(it\.symbol\); \}\)/.test(S), "[V33.621] 보유 종목은 사이클마다 맨 먼저 평가(마감 창 청산을 놓치지 않게)");
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
  chk(/#page-nnviz\[data-brain-view="operations"\] \.nnviz-content > :not\(\.nnv-head\):not\(\.mission-nav\):not\(#pbObs\) \{ display:none!important; \}/.test(L)
      && /AI 스캔 · 매매법 판정/.test(readFileSync(new URL("../public/playbook-observatory.js", import.meta.url), "utf8")),
      "[V33.620] 01 작동 화면 = 매매법 AI 하나(옛 위원회 스캔 순회를 'AI 스캔 · 매매법 판정' 으로 합침 · 주력 여부와 무관)");
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
{ // [V33.625] 모멘텀 붕괴 차단(공황 국면 추세·모멘텀 쉼)
  const pyP = `
import sys, json, numpy as np, pandas as pd
sys.path.insert(0, ${JSON.stringify(dir)})
import playbook_sim as PB
rng = np.random.default_rng(9); T, N = 620, 60
r = rng.normal(0.0004, 0.008, (T, 1)) + rng.normal(0, 0.012, (T, N)); r[420:480] = r[420:480] * 2.5 - 0.006
c = pd.DataFrame(50*np.exp(np.cumsum(r, axis=0)), index=[20240101+k for k in range(T)])
o = c*(1+rng.normal(0,0.004,(T,N)))
P = {"close":c,"open":o,"high":np.maximum(c,o)*1.01,"low":np.minimum(c,o)*0.99,"volume":pd.DataFrame(rng.lognormal(13,.5,(T,N)), index=c.index)}
reg, _ = PB._regime(c); pn = PB._panic(c, reg)
d, _r, sig = PB.sim_daily(P, "us", [])
pt = set(np.nonzero(pn)[0].tolist())
mom = d[d["pb"].isin(PB.PANIC_PB)]; mr = d[~d["pb"].isin(PB.PANIC_PB)]
# 미래를 안 본다: 앞 450일만 넣어도 그 구간 값이 같다
c2 = c.iloc[:450]; reg2, _ = PB._regime(c2); pn2 = PB._panic(c2, reg2)
print(json.dumps({"pb": sorted(PB.PANIC_PB), "calm": float(pn[250:400].mean()), "storm": float(pn[440:480].mean()),
  "momIn": int(mom["t"].isin(pt).sum()), "mrIn": int(mr["t"].isin(pt).sum()), "momN": int(len(mom)), "causal": bool((pn2 == pn[:450]).all())}))
`;
  const rp = spawnSync("python3", ["-c", pyP], { encoding: "utf8", maxBuffer: 1 << 26 });
  let q = null; try { q = JSON.parse(rp.stdout.trim().split("\n").pop()); } catch (e) { console.log(rp.stderr.slice(-1500)); }
  chk(q && q.storm > 0.5 && q.calm < 0.3 && q.causal, "[V33.625] 공황 판정: 하락 뒤 고변동 구간에서 켜지고 평온한 상승장에선 대부분 꺼진다 · 미래를 안 본다", JSON.stringify(q && [q.calm, q.storm, q.causal]));
  chk(q && q.momN > 0 && q.momIn === 0 && q.mrIn > 0, "[V33.625] 시뮬: 공황일엔 추세·모멘텀·돌파 진입 0건 · 평균회귀·반등은 그대로 뜬다", JSON.stringify(q && [q.momN, q.momIn, q.mrIn]));
  const Wp = new Function("_num", "getMA", "getRSI", "STRAT_ROUTE", "MACRO_SCHED", fnSrc + "; return { pbPanicOff, PB_PANIC_PB };")(_num, getMA, getRSI, STRAT_ROUTE, MACRO_SCHED);
  chk(q && JSON.stringify(Object.keys(Wp.PB_PANIC_PB).sort()) === JSON.stringify(q.pb), "[V33.625] 차단 매매법 목록 학습기 PANIC_PB = 워커 PB_PANIC_PB", JSON.stringify([Object.keys(Wp.PB_PANIC_PB).length, q && q.pb.length]));
  chk(JSON.stringify(Wp.pbPanicOff({ panic: true }, ["DUAL_MOM", "SN_RSI2", "KELTNER"])) === '["DUAL_MOM","KELTNER"]' && Wp.pbPanicOff({ panic: false }, ["DUAL_MOM"]).length === 0 && Wp.pbPanicOff({}, ["DUAL_MOM"]).length === 0,
      "[V33.625] 워커: 학습기가 공황이라 보낸 날만 추세·모멘텀을 쉰다");
  chk(/panic: body\.panic === true/.test(S) && /"panic": panic_now/.test(readFileSync(dir + "playbook_sim.py", "utf8")), "[V33.625] 학습기 업로드 → 워커 저장(panic)"); }
{ // [V33.634] 퇴역 위원회·옛 OMNI 전용 매분 수집 끔(CPU 낭비) — OMNI-Q 가 쓰는 봉·뉴스·실적 수집은 그대로
  chk(/if \(!COMMITTEE_RETIRED && HARVEST\.enabled && LUXML\.enabled\)/.test(S) && /if \(!COMMITTEE_RETIRED && Date\.now\(\) - _cfLock > 4 \* 3600000\)/.test(S)
      && /if \(!COMMITTEE_RETIRED && Date\.now\(\) - _ofLock >/.test(S) && /if \(!COMMITTEE_RETIRED && Date\.now\(\) - _osLock >/.test(S)
      && /__prof\.mark\("ai\.deephist"\);\s*if \(!COMMITTEE_RETIRED\) try \{/.test(S) && /if \(_bigR2\(\) && !COMMITTEE_RETIRED\) \{/.test(S),
      "[V33.634] 표본 캐치업·반사실 라벨·한국 수급·옛 OMNI 채점·딥이력·표본 스냅샷 — 퇴역 스위치로 끔");
  const o1 = S.indexOf('__prof.mark("ai.omniBars")'), o2 = S.indexOf('__prof.mark("ai.krNews")'), o3 = S.indexOf('__prof.mark("ai.earnings")');
  chk(o1 > 0 && !/COMMITTEE_RETIRED/.test(S.slice(o1, o1 + 600)) && !/COMMITTEE_RETIRED/.test(S.slice(o2, o2 + 400)) && !/COMMITTEE_RETIRED/.test(S.slice(o3, o3 + 400)),
      "[V33.634] OMNI-Q 재료(분·일봉 · 한국 뉴스 · 미국 실적) 수집은 그대로 돈다"); }
if (fails) { console.log("check-playbook: FAIL " + fails); process.exit(1); }
console.log("check-playbook: ok");
