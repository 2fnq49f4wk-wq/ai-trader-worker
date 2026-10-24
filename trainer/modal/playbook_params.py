"""[V33.664] ★매매법 진입 수식의 미지수화★ — 사용자 10/24 "매매법을 여러 미지수의 수식으로 · 미지수를 바꿀 수 있게 · 종목 특성에 맞춰 스스로 조율".
ENTRY[pb] = (fn(P, p) → 날짜×종목 bool, 기본값, 사다리). 기본값은 strategy_catalog 와 워커 pbDailyFires 의 지금 값과 같다
(기본값으로 돌리면 지금 신호와 한 칸도 다르지 않다 — check-playbook 대조). 워커는 PB_EP_DEF 에 같은 기본값 · pbDailyFires(D, ep).
종목 특성 = groups(): 지난 250거래일 평균 ATR% 의 그날 횡단면 3분위(0 저변동 · 1 중간 · 2 고변동) — 미래를 보지 않는다.
개별 종목마다 조율하지 않는 이유: 종목 하나의 매매법 신호는 10년에 수십 건이라 미지수가 과거에만 맞는다(lab ptune · 그룹도 대부분 기준 미달)."""
import numpy as np
import pandas as pd
import strategy_catalog as CAT

A, X = CAT._and, CAT._xrank


def _I(P):
    return CAT._ind(P)


def _cache(P, key, fn):
    c = P.setdefault("_pp", {})
    if key not in c:
        c[key] = fn()
    return c[key]


def trend_align(P, p):
    I = _I(P)
    return A(I["ma20"] > I["ma50"], I["ma50"] > I["ma200"], I["c"] > I["ma20"], I["rsi14"] >= p["rsiLo"], I["rsi14"] <= p["rsiHi"])


def tr_breakout(P, p):
    I = _I(P)
    hp = _cache(P, ("hp", p["n"]), lambda: I["c"].shift(1).rolling(p["n"], min_periods=p["n"]).max())
    return A(I["c"] > hp, I["c"] > I["ma50"], I["ret1"] > 0, I["vr"] >= p["vr"])


def rs_leader(P, p):
    I = _I(P)
    r = _cache(P, ("xr", p["lb"]), lambda: X(I["c"].pct_change(p["lb"], fill_method=None)))
    return A(r >= p["x"], I["c"] > I["ma50"], I["ma20"] > I["ma50"], I["rsi14"] <= p["rsiHi"])


def vt_trend(P, p):
    I = _I(P)
    return A(I["c"] > I["ma50"], I["ma20"] > I["ma50"], I["atr"] < p["atrMax"], I["ret20"] > 0)


def tr_pullback(P, p):
    I = _I(P)
    gap = (I["c"] / I["ma20"] - 1).abs()
    return A(I["ma20"] > I["ma50"], gap <= p["gap"], I["ret1"] > 0, I["rsi14"] >= p["rsiLo"], I["rsi14"] <= p["rsiHi"])


def ma_pullback(P, p):
    I = _I(P)
    return A(I["ma50"] > I["ma200"], I["ma20"] > I["ma50"], I["l"] <= I["ma20"] * p["touch"], I["c"] > I["ma20"], I["ret1"] > 0)


def sn_rsi2(P, p):
    I = _I(P)
    return A(I["c"] > I["ma200"], I["ma50"] > I["ma200"], I["rsi2"] <= p["rsi2"], I["c"] < I["ma5"], I["rsi14"] <= p["rsi14"],
             (I["ret1"] > 0) | (I["cpos"] >= 0.5) | (I["rsi2"] <= 3))


def ha_rev(P, p):
    I = _I(P)
    o, h, l, c = I["o"], I["h"], I["l"], I["c"]
    bull = _cache(P, "habull", lambda: (o + h + l + c) / 4 > (o.shift(1) + c.shift(1)) / 2)
    return A(bull, ~bull.shift(1, fill_value=True), ~bull.shift(2, fill_value=True), I["c"] > I["ma50"] * p["f"])


def bb_low(P, p):
    I = _I(P)
    return A(I["c"] <= I["bbl"], I["rsi14"] < p["rsiHi"], I["rsi14"] > p["rsiLo"], I["ret1"] > 0)


def stoch_cross(P, p):
    I = _I(P)
    k, d = I["sk"], I["sd"]
    return A((k > d) & (k.shift(1) <= d.shift(1)), k.shift(1) <= p["k"], I["c"] > I["ma200"] * 0.95)


def stoch_os_exit(P, p):
    I = _I(P)
    k = I["sk"]
    return A(k > p["k"], k.shift(1) <= p["k"], I["ret1"] > 0, I["c"] > I["ma200"] * 0.95)


def vol_breakout(P, p):
    I = _I(P)
    hp = _cache(P, ("hp", p["n"]), lambda: I["c"].shift(1).rolling(p["n"], min_periods=p["n"]).max())
    return A(I["vr"] >= p["vr"], I["c"] > hp, I["ret1"] > 0, I["c"] > I["ma50"])


def vol_revert(P, p):
    I = _I(P)
    return A(I["vr"] >= p["vr"], I["ret1"] <= p["r1"], I["ret1"] >= -18.0, I["cpos"] <= 0.45, I["rsi2"] <= p["rsi2"], I["c"] > I["ma200"])


def os_deep(P, p):
    I = _I(P)
    return A(I["rsi2"] <= p["rsi2"], I["c"] <= I["bbl"], I["ret5"] <= p["r5"], I["rsi14"] <= p["rsi14"])


def capit_rev(P, p):
    I = _I(P)
    return A(I["vr"] >= p["vr"], I["ret1"] <= p["r1"], I["ret1"] >= -25.0, I["c"] <= I["ma20"] * p["f"])


def ichimoku(P, p):
    I = _I(P)
    h, l, c = I["h"], I["l"], I["c"]

    def parts():
        ten = (h.rolling(9).max() + l.rolling(9).min()) / 2
        kij = (h.rolling(26).max() + l.rolling(26).min()) / 2
        sa = ((ten + kij) / 2).shift(26)
        sb = ((h.rolling(52).max() + l.rolling(52).min()) / 2).shift(26)
        return ten, kij, sa, sb, sa.where(sa > sb, sb)
    ten, kij, sa, sb, top = _cache(P, "ich", parts)
    return A(c > top, c.shift(1) <= top.shift(1), ten > kij, (sa - sb).abs() / c <= p["thick"])


def keltner(P, p):
    I = _I(P)
    h, l, c = I["h"], I["l"], I["c"]

    def parts():
        pc = c.shift(1)
        tr = pd.concat([(h - l), (h - pc).abs(), (l - pc).abs()]).groupby(level=0).max().reindex(c.index)
        return CAT._ema(c, 20), tr.rolling(10).mean()
    e, a = _cache(P, "kel", parts)
    up = e + p["mult"] * a
    return A(c > up, c.shift(1) <= up.shift(1), I["ret1"] > 0)


def donchian(P, p):
    I = _I(P)
    hp = _cache(P, ("dh", p["n"]), lambda: I["h"].shift(1).rolling(p["n"]).max())
    return A(I["c"] > hp, I["c"].shift(1) <= hp.shift(1))


def macd_x(P, p):
    I = _I(P)
    m = _cache(P, ("macd", p["fast"], p["slow"]), lambda: CAT._ema(I["c"], p["fast"]) - CAT._ema(I["c"], p["slow"]))
    s = CAT._ema(m, 9)
    xs = (m > s) & (m.shift(1) <= s.shift(1))
    xz = (m > 0) & (m.shift(1) <= 0)
    return ((xs & (m < 0)) | (xz & (m > s))).fillna(False)


def envelope(P, p):
    I = _I(P)
    lo = I["ma20"] * p["f"]
    return A(I["c"].shift(1) < lo.shift(1), I["c"] > lo, I["ret1"] > 0)


def elder_ray(P, p):
    I = _I(P)
    e = _cache(P, ("ema", p["n"]), lambda: CAT._ema(I["c"], p["n"]))
    bear = I["l"] - e
    return A(e > e.shift(1), bear < 0, bear > bear.shift(1), bear.shift(1) <= bear.shift(2))


def willr(P, p):
    I = _I(P)
    n = p["n"]

    def wr_():
        hh, ll = I["h"].rolling(n).max(), I["l"].rolling(n).min()
        rg = hh - ll
        return ((hh - I["c"]) / rg.where(rg > 0) * -100).fillna(-50.0).where(hh.notna())
    wr = _cache(P, ("wr", n), wr_)
    return A(wr.shift(1) <= p["lvl"], wr > p["lvl"])


def cci_rev(P, p):
    c = _cache(P, ("cci", p["n"]), lambda: CAT._cci(P, p["n"]))
    return A(c.shift(1) <= p["lvl"], c > p["lvl"])


def psar(P, p):
    return _cache(P, "psar", lambda: CAT.e_psar(P))


def triple_scr(P, p):
    I = _I(P)
    e = _cache(P, "ema65", lambda: CAT._ema(I["c"], 65))
    return A(e > e.shift(5), I["sk"].shift(1) <= p["k"], I["c"] > I["h"].shift(1))


def ibs_low(P, p):
    I = _I(P)
    return A(I["cpos"] <= p["cpos"], I["ret1"] < 0, I["c"] > I["ma200"])


def hi52_near(P, p):
    I = _I(P)
    hi = _cache(P, "hi252", lambda: I["h"].rolling(252).max())
    near = I["c"] / hi >= p["near"]
    return A(near, ~near.shift(1, fill_value=True), I["c"] > I["ma50"], I["ret1"] > 0)


def squeeze(P, p):
    I = _I(P)
    w = I["bbw"]
    low = w.shift(1) <= _cache(P, ("sqq", p["q"]), lambda: w.shift(1).rolling(120, min_periods=60).quantile(p["q"]))
    return A(low, I["c"] > I["bbu"], I["c"] > I["ma50"])


def xs_arb(P, p):
    I = _I(P)

    def z_():
        r = I["ret5"]
        return r.sub(r.mean(axis=1), axis=0).div(r.std(axis=1).replace(0, np.nan), axis=0)
    z = _cache(P, "xsz", z_)
    return A(z <= p["z"], I["c"] > I["ma200"])


def dual_mom(P, p):
    I = _I(P)
    c = I["c"]
    m = _cache(P, ("dm", p["lb"]), lambda: c.shift(21) / c.shift(p["lb"]) - 1)
    xr = _cache(P, ("dmx", p["lb"]), lambda: X(m))
    return A(m > 0, xr >= p["x"], c > I["ma200"])


def herd_rebound(P, p):
    I = _I(P)

    def base():
        surge = ((I["vr"] >= p["vr"]) & (I["ret1"] > 0)).astype(float)
        recent = surge.rolling(6, min_periods=1).max().shift(1) > 0
        hi6 = I["c"].rolling(6, min_periods=2).max().shift(1)
        return recent, (I["c"] / hi6 - 1) * 100
    recent, dd = _cache(P, ("herd", p["vr"]), base)
    return A(recent, dd <= p["ddHi"], dd >= p["ddLo"], I["c"] > I["ma20"] * 0.98, I["ret1"] > 0)


ENTRY = {
    "TREND_ALIGN": (trend_align, {"rsiLo": 45, "rsiHi": 72}, {"rsiLo": [35, 40, 45, 50, 55], "rsiHi": [65, 68, 72, 76, 80]}),
    "TR_BREAKOUT": (tr_breakout, {"n": 20, "vr": 1.5}, {"n": [10, 20, 40, 55], "vr": [1.0, 1.25, 1.5, 2.0, 2.5]}),
    "RS_LEADER": (rs_leader, {"lb": 20, "x": 0.9, "rsiHi": 78}, {"lb": [10, 20, 60], "x": [0.8, 0.85, 0.9, 0.95], "rsiHi": [70, 74, 78, 82, 90]}),
    "VT_TREND": (vt_trend, {"atrMax": 4.0}, {"atrMax": [2.5, 3.0, 4.0, 5.0, 6.0]}),
    "TR_PULLBACK": (tr_pullback, {"gap": 0.04, "rsiLo": 37, "rsiHi": 68}, {"gap": [0.02, 0.03, 0.04, 0.06], "rsiLo": [30, 37, 45], "rsiHi": [60, 68, 75]}),
    "MA_PULLBACK": (ma_pullback, {"touch": 1.003}, {"touch": [1.0, 1.003, 1.01, 1.02]}),
    "SN_RSI2": (sn_rsi2, {"rsi2": 12, "rsi14": 55}, {"rsi2": [5, 8, 12, 15, 20], "rsi14": [45, 50, 55, 65]}),
    "HA_REV": (ha_rev, {"f": 0.97}, {"f": [0.9, 0.95, 0.97, 1.0]}),
    "BB_LOW": (bb_low, {"rsiHi": 38, "rsiLo": 20}, {"rsiHi": [30, 34, 38, 42, 46], "rsiLo": [10, 15, 20, 25]}),
    "STOCH_CROSS": (stoch_cross, {"k": 30}, {"k": [20, 25, 30, 40]}),
    "STOCH_OS_EXIT": (stoch_os_exit, {"k": 20}, {"k": [10, 15, 20, 25, 30]}),
    "VOL_BREAKOUT": (vol_breakout, {"n": 20, "vr": 2.0}, {"n": [10, 20, 55], "vr": [1.5, 2.0, 2.5, 3.0, 4.0]}),
    "VOL_REVERT": (vol_revert, {"vr": 3.0, "r1": -4.0, "rsi2": 8}, {"vr": [2.0, 2.5, 3.0, 4.0], "r1": [-2.0, -3.0, -4.0, -6.0], "rsi2": [5, 8, 12, 20]}),
    "OS_DEEP": (os_deep, {"rsi2": 5, "r5": -7, "rsi14": 35}, {"rsi2": [3, 5, 8, 10], "r5": [-4, -5, -7, -10], "rsi14": [30, 35, 40]}),
    "CAPIT_REV": (capit_rev, {"vr": 2.0, "r1": -5.0, "f": 0.90}, {"vr": [1.5, 2.0, 3.0], "r1": [-3.0, -5.0, -7.0], "f": [0.85, 0.90, 0.95]}),
    "ICHIMOKU": (ichimoku, {"thick": 0.05}, {"thick": [0.02, 0.05, 0.1, 1.0]}),
    "KELTNER": (keltner, {"mult": 2.0}, {"mult": [1.5, 2.0, 2.5, 3.0]}),
    "DONCHIAN": (donchian, {"n": 55}, {"n": [20, 40, 55, 100]}),
    "MACD_X": (macd_x, {"fast": 12, "slow": 26}, {"fast": [8, 12, 19], "slow": [21, 26, 39]}),
    "ENVELOPE": (envelope, {"f": 0.93}, {"f": [0.88, 0.90, 0.93, 0.95, 0.97]}),
    "ELDER_RAY": (elder_ray, {"n": 13}, {"n": [9, 13, 21]}),
    "WILLR": (willr, {"n": 14, "lvl": -80}, {"n": [10, 14, 21], "lvl": [-90, -85, -80, -75, -70]}),
    "CCI_REV": (cci_rev, {"n": 20, "lvl": -100}, {"n": [14, 20, 30], "lvl": [-150, -125, -100, -75]}),
    "PSAR": (psar, {}, {}),
    "TRIPLE_SCR": (triple_scr, {"k": 30}, {"k": [20, 25, 30, 40]}),
    "IBS_LOW": (ibs_low, {"cpos": 0.2}, {"cpos": [0.1, 0.15, 0.2, 0.25, 0.3]}),
    "HI52_NEAR": (hi52_near, {"near": 0.97}, {"near": [0.93, 0.95, 0.97, 0.99]}),
    "SQUEEZE": (squeeze, {"q": 0.10}, {"q": [0.05, 0.10, 0.20, 0.30]}),
    "XS_ARB": (xs_arb, {"z": -1.8}, {"z": [-1.2, -1.5, -1.8, -2.2, -2.6]}),
    "DUAL_MOM": (dual_mom, {"lb": 252, "x": 0.8}, {"lb": [126, 252], "x": [0.7, 0.8, 0.9]}),
    "HERD_REBOUND": (herd_rebound, {"vr": 2.5, "ddHi": -5, "ddLo": -12}, {"vr": [2.0, 2.5, 3.0], "ddHi": [-3, -5, -7], "ddLo": [-10, -12, -15]}),
}


def sig(P, pb, p=None):
    fn, d, _ = ENTRY[pb]
    q = dict(d, **(p or {}))
    key = (pb,) + tuple(sorted(q.items()))
    c = P.setdefault("_ppsig", {})
    if key not in c:
        if len(c) > 400:
            c.clear()
        c[key] = fn(P, q).fillna(False).values.astype(bool)
    return c[key]


def groups(P, n=3, win=250):
    """종목 특성 그룹 — 지난 win 거래일 평균 ATR% 의 그날 횡단면 순위로 n 분위(0 = 저변동). 미래를 보지 않는다."""
    a = CAT._ind(P)["atr"].rolling(win, min_periods=120).mean()
    r = a.rank(axis=1, pct=True)
    g = np.floor(r.values * n).clip(0, n - 1)
    return np.where(np.isfinite(g), g, -1).astype(np.int8)

