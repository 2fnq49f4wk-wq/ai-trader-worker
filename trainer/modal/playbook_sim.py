"""[V33.607] 매매법 모의 시뮬레이터(Playbook-Sim) — '확률 높은 종목을 먼저 뽑고 · 그 종목에 맞는 매매법을 고른다'.

사용자 설계(10/15):
  ① 지금 확률 높은 종목(OMNI-Q 상위)이 들어오면  ② 그 종목의 지금 차트(일봉 · 5분봉)와 ★닮은 과거★를 찾아
  ③ 모든 매매법을 그 과거에 가상으로 적용한 ★성공 확률·평균 순수익★을 보고  ④ 가장 좋은 매매법으로 사서 그 매도법으로 관리한다.
  모의 시뮬은 GitHub Actions(무료)가 매 회차 다시 돌려 표를 갱신하고, 워커는 매 분 ★표를 조회만★ 한다(CPU 거의 0).

'닮은 과거' = 상황 열쇠(situation key). 지금 상황을 몇 개의 칸으로 나눈 이름이다 — 워커가 같은 칸을 실시간으로 계산한다.
  일봉 열쇠  국면(5) · RSI14(4) · MA20 거리(4) · 5일 수익(3) · 거래량 배수(3) · FOMC/CPI ±2거래일(2)
  5분 열쇠   국면(5) · 장중 등락(5) · 장 시작 후 시간대(4) · 일봉 추세(MA20 위/아래)(2)
  칸에 표본이 적으면 위 칸(조건을 하나씩 뺀 칸)의 확률 쪽으로 당긴다(베이즈 수축 k=40) — 표본이 적은 상황을 과신하지 않는다.

매매법(= 사는 방식 + 파는 방식). 전부 '지금 산다' 에서 시작하고, 파는 규칙이 다르다:
  일봉(스윙)  REBOUND · PULLBACK · TREND · MOMENTUM · BREAKOUT · VOLX  (손절 % · ATR 배수 · 본전 이동 R · 최대 보유일)
  5분(단타)   SCALP_Q(+0.7/−0.5 · 30분) · SCALP_M(+1.2/−0.8 · 90분) · SCALP_L(+2.0/−1.2 · 장 끝) · DAY_HOLD(−1.5 · 장 끝)
  1분봉은 과거 기록이 저장돼 있지 않아 5분봉으로 한다(1분 이력이 쌓이면 같은 틀에 넣는다).

★미리 고정(데이터 보기 전 · 바꾸려면 사용자 결정)★
  비용     왕복 미 0.10% · 한 0.30% 를 모든 시뮬 결과에서 뺀다 · 일봉은 시장 동일가중 대비 초과(국면 효과를 빼고 매매법만 잰다)
  검증     시간순 앞 70% 로 표를 만들고 → 뒤 30% 에서 '표가 고른 매매법' 의 실제 결과를 잰다(앞을 보지 않는다)
  관문     뒤 30% 에서 고른 매매법 평균 순수익 > 0 · '아무 매매법이나' 평균보다 높다 · t ≥ 2 → 그 시장·그 봉(일봉/5분)만 실전 사용
           (실전 거래 100건 같은 기준은 없다 — 신뢰도는 시뮬 표본 수와 수축이 맡는다)
  선택     칸의 수축 평균 순수익 > 0 이고 수축 성공확률 ≥ 50% 인 매매법 중 평균이 가장 큰 것
"""
import math
import time

import numpy as np
import pandas as pd

K_SHRINK = 40.0
TRAIN_FRAC = 0.70
COST_RT = {"us": 0.10, "kr": 0.30}
PASS_T = 2.0

# ── 매매법 ─────────────────────────────────────────────────────────
# stop: 최대 손절 % · atr: ATR 손절 배수(작은 쪽) · be: 이 R 에 닿으면 손절을 본전으로 · hold: 최대 보유 거래일 · tpR: 전량 익절 R(None=없음)
DAILY_PB = {
    "REBOUND":  {"stop": 4.0, "atr": 1.5, "be": 0.8, "hold": 5,  "tpR": 1.5, "label": "단기 반등 — 짧게 먹고 나온다"},
    "PULLBACK": {"stop": 5.0, "atr": 2.0, "be": 1.0, "hold": 10, "tpR": 2.0, "label": "눌림목 — 반등 확인 뒤 2R"},
    "TREND":    {"stop": 7.0, "atr": 2.5, "be": 1.5, "hold": 30, "tpR": None, "label": "추세 추종 — 익절 없이 길게"},
    "MOMENTUM": {"stop": 8.0, "atr": 3.0, "be": 2.0, "hold": 20, "tpR": None, "label": "모멘텀 — 넓은 손절 · 강한 종목 보유"},
    "BREAKOUT": {"stop": 4.0, "atr": 1.5, "be": 1.0, "hold": 10, "tpR": 3.0, "label": "돌파 — 좁은 손절 · 큰 목표"},
    "VOLX":     {"stop": 5.0, "atr": 1.8, "be": 1.0, "hold": 7,  "tpR": 1.2, "label": "거래량 급증 — 빠른 회수"},
}
INTRA_PB = {   # tpPct/sl %, bars = 최대 5분봉 수(0 = 장 끝까지) · 장 끝에는 무조건 판다
    "SCALP_Q":  {"tpPct": 0.7, "sl": 0.5, "bars": 6,  "label": "초단타 — +0.7% / −0.5% · 30분"},
    "SCALP_M":  {"tpPct": 1.2, "sl": 0.8, "bars": 18, "label": "단타 — +1.2% / −0.8% · 90분"},
    "SCALP_L":  {"tpPct": 2.0, "sl": 1.2, "bars": 0,  "label": "당일 스윙 — +2.0% / −1.2% · 장 끝"},
    "DAY_HOLD": {"tpPct": None, "sl": 1.5, "bars": 0, "label": "당일 보유 — −1.5% 손절만 · 장 끝"},
}

# ── 상황 열쇠(워커 PB_KEYS 와 같은 경계 · 한쪽만 바꾸면 갈라진다 — 게이트가 대조) ───────
B_RSI = (30, 50, 70)            # → 0..3
B_GAP20 = (-5, 0, 5)            # % → 0..3
B_RET5 = (-3, 3)                # % → 0..2
B_VR = (0.8, 1.5)               # 배 → 0..2
B_DAYPCT = (-2, -0.5, 0.5, 2)   # % → 0..4
B_TOD = (30, 120, 270)          # 장 시작 후 분 → 0..3
REGIMES = ("BULL", "NEUTRAL", "BEAR", "CRASH", "SURGE")


def _bk(x, edges):
    return np.searchsorted(np.asarray(edges, dtype=float), x, side="right")


def daily_keys(reg, rsi, gap20, ret5, vr, ev):
    """일봉 열쇠 4단(가장 구체적 → 가장 넓은). 각 단은 문자열 배열."""
    r = np.asarray(reg).astype(str)
    a, b, c = _bk(rsi, B_RSI).astype(str), _bk(gap20, B_GAP20).astype(str), _bk(ret5, B_RET5).astype(str)
    d, e = _bk(vr, B_VR).astype(str), np.asarray(ev).astype(int).astype(str)
    k3 = np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(r, "|"), a), "|"), b), "|"), c), "|"), d), np.char.add("|", e))
    k2 = np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(r, "|"), a), "|"), b), "|*")
    k1 = np.char.add(r, "|*")
    return [k3, k2, k1, np.full(len(r), "*")]


def intra_keys(reg, daypct, tod, up):
    r = np.asarray(reg).astype(str)
    a, b, c = _bk(daypct, B_DAYPCT).astype(str), _bk(tod, B_TOD).astype(str), np.asarray(up).astype(int).astype(str)
    k3 = np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(r, "|"), a), "|"), b), "|"), c)
    k2 = np.char.add(np.char.add(np.char.add(r, "|"), a), "|*")
    k1 = np.char.add(r, "|*")
    return [k3, k2, k1, np.full(len(r), "*")]


# ── 일봉 시뮬(전 종목 × 전 날짜 × 매매법 · 벡터화) ──────────────────────
def _regime(close):
    """strategy_router._regime 과 같은 정의(폭락·폭등 포함)."""
    r = close.pct_change(fill_method=None).mean(axis=1).fillna(0)
    idx = (1 + r).cumprod()
    m200, m50 = idx.rolling(200, min_periods=120).mean(), idx.rolling(50, min_periods=40).mean()
    up = m50 > m50.shift(10)
    reg = np.where((idx > m200) & up, "BULL", np.where((idx < m200) & ~up, "BEAR", "NEUTRAL"))
    r5 = (1 + r).rolling(5).apply(np.prod, raw=True) - 1
    crash = ((r <= -0.025) | (r5 <= -0.06)).astype(float).rolling(3, min_periods=1).max() > 0
    surge = ((r >= 0.025) | (r5 >= 0.06)).astype(float).rolling(3, min_periods=1).max() > 0
    reg = np.where(crash.values, "CRASH", np.where(surge.values, "SURGE", reg))
    return reg, r.values


def _daily_state(P, ev_dates):
    c = P["close"]
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    rsi = (100 - 100 / (1 + up / dn.replace(0, np.nan))).where(dn > 0, 100.0).values
    gap20 = ((c / c.rolling(20).mean() - 1) * 100).values
    ret5 = ((c / c.shift(5) - 1) * 100).values
    v = P.get("volume")
    vr = (v / v.rolling(20).mean()).values if v is not None else np.ones(c.shape)
    pc = c.shift(1)
    tr = np.maximum(P["high"] - P["low"], np.maximum((P["high"] - pc).abs(), (P["low"] - pc).abs()))
    atr = (tr.rolling(14, min_periods=14).mean() / c * 100).values
    # FOMC/CPI ±2 거래일
    dk = np.asarray([int(x) for x in c.index])
    pos = np.searchsorted(dk, np.asarray(sorted(ev_dates)))
    near = np.zeros(len(dk), dtype=bool)
    for p in pos:
        near[max(0, p - 2):min(len(dk), p + 3)] = True
    return rsi, gap20, ret5, vr, atr, near


def sim_daily(P, market, ev_dates):
    """모든 (날짜 t · 종목 j) 에서 t 종가에 샀다고 보고 매매법마다 결과(순초과 %) — 반환 표: [t, j, pb, ex, win]."""
    O, H, L, C = (P[k].values for k in ("open", "high", "low", "close"))
    T, N = C.shape
    reg, mret = _regime(P["close"])
    rsi, gap20, ret5, vr, atr, near = _daily_state(P, ev_dates)
    cost = COST_RT[market]
    mcum = np.concatenate([[1.0], np.cumprod(1 + mret)])
    out = []
    for pb, pr in DAILY_PB.items():
        hold = pr["hold"]
        t_end = T - 1 - hold
        if t_end < 260:
            continue
        ts = np.arange(250, t_end)
        pe = C[ts]                                           # (nt, N)
        stp = np.minimum(pr["stop"], pr["atr"] * atr[ts])    # %
        sl = pe * (1 - stp / 100)
        R = pe * stp / 100
        be_px = pe + pr["be"] * R
        tp_px = pe + pr["tpR"] * R if pr["tpR"] else np.full_like(pe, np.inf)
        alive = np.isfinite(pe) & np.isfinite(stp) & (pe > 0)
        px = np.full_like(pe, np.nan)
        xk = np.full(pe.shape, hold)
        for k in range(1, hold + 1):
            o, h, lo, cl = O[ts + k], H[ts + k], L[ts + k], C[ts + k]
            hit_sl = alive & (lo <= sl)
            px = np.where(hit_sl, np.minimum(np.where(np.isfinite(o), o, sl), sl), px)
            xk = np.where(hit_sl, k, xk)
            alive &= ~hit_sl
            hit_tp = alive & (h >= tp_px)
            px = np.where(hit_tp, np.maximum(np.where(np.isfinite(o), o, tp_px), tp_px), px)
            xk = np.where(hit_tp, k, xk)
            alive &= ~hit_tp
            sl = np.where(alive & (h >= be_px), np.maximum(sl, pe), sl)       # 본전으로
            if k == hold:
                px = np.where(alive, cl, px)
        raw = (px / pe - 1) * 100
        mk = (mcum[ts[:, None] + xk + 1] / mcum[ts[:, None] + 1] - 1) * 100
        ex = raw - mk - cost
        ok = np.isfinite(ex)
        ti, jj = np.nonzero(ok)
        out.append(pd.DataFrame({"t": ts[ti], "j": jj, "pb": pb, "ex": ex[ti, jj].astype(np.float32)}))
    df = pd.concat(out, ignore_index=True) if out else pd.DataFrame(columns=["t", "j", "pb", "ex"])
    t, j = df["t"].values, df["j"].values
    ks = daily_keys(reg[t], rsi[t, j], gap20[t, j], ret5[t, j], vr[t, j], near[t])
    for lv, k in enumerate(ks):
        df["k%d" % lv] = k
    return df, str(reg[-1])


# ── 5분봉 시뮬(단타) ───────────────────────────────────────────────
TZ_OFF = {"us": -4 * 3600, "kr": 9 * 3600}
SAMPLE_EVERY = 3     # 15분마다 한 번 '여기서 산다면' 을 본다(표본 수 · 시간 절약)


def sim_intra(bars5, daily_reg, market, day_key_of=None):
    """bars5: {sym: {t,o,h,l,c}} · daily_reg: {날짜키: 국면}. 반환 표 [day, pb, ex, k0..k3]."""
    cost = COST_RT[market]
    rows = []
    for s, bd in bars5.items():
        if not bd or not bd.get("t") or len(bd["t"]) < 500:
            continue
        t = np.asarray(bd["t"], dtype=np.int64)
        if t[0] > 10 ** 11:                         # 밀리초면 초로
            t = t // 1000
        c = np.asarray(bd["c"], dtype=float)
        h = np.asarray(bd.get("h") or bd["c"], dtype=float)
        l = np.asarray(bd.get("l") or bd["c"], dtype=float)
        if not (len(h) == len(l) == len(c) == len(t)):
            continue
        loc = t + TZ_OFF[market]
        day = (loc // 86400).astype(np.int64)
        # 날마다 묶는다
        cut = np.nonzero(np.diff(day))[0] + 1
        starts = np.concatenate([[0], cut])
        ends = np.concatenate([cut, [len(t)]])
        prev_close, closes_d = None, []
        for a, b in zip(starts, ends):
            n = b - a
            if n < 20:
                prev_close = c[b - 1]
                continue
            dkey = int(pd.Timestamp(int(day[a]) * 86400, unit="s").strftime("%Y%m%d"))
            closes_d.append(c[b - 1])
            ma20 = np.mean(closes_d[-21:-1]) if len(closes_d) > 20 else None
            rg = daily_reg.get(dkey)
            if prev_close is None or rg is None:
                prev_close = c[b - 1]
                continue
            up = 1 if (ma20 is not None and prev_close > ma20) else 0
            for i in range(a + 1, b - 2, SAMPLE_EVERY):
                pe = c[i]
                if not (pe > 0):
                    continue
                daypct = (pe / prev_close - 1) * 100
                tod = (i - a) * 5
                for pb, pr in INTRA_PB.items():
                    last = b - 1 if pr["bars"] == 0 else min(b - 1, i + pr["bars"])
                    tp = pe * (1 + pr["tpPct"] / 100) if pr["tpPct"] else np.inf
                    sl = pe * (1 - pr["sl"] / 100)
                    hh, ll = h[i + 1:last + 1], l[i + 1:last + 1]
                    xs = np.nonzero(ll <= sl)[0]
                    xt = np.nonzero(hh >= tp)[0]
                    fs = xs[0] if len(xs) else 10 ** 9
                    ft = xt[0] if len(xt) else 10 ** 9
                    if fs == 10 ** 9 and ft == 10 ** 9:
                        px = c[last]
                    elif fs <= ft:                        # 같은 봉이면 손절이 먼저(보수적)
                        px = sl
                    else:
                        px = tp
                    rows.append((dkey, pb, (px / pe - 1) * 100 - cost, rg, daypct, tod, up))
            prev_close = c[b - 1]
    if not rows:
        return pd.DataFrame(columns=["day", "pb", "ex"])
    df = pd.DataFrame(rows, columns=["day", "pb", "ex", "reg", "daypct", "tod", "up"])
    ks = intra_keys(df["reg"].values, df["daypct"].values, df["tod"].values, df["up"].values)
    for lv, k in enumerate(ks):
        df["k%d" % lv] = k
    return df


# ── 표 만들기 · 검증 ───────────────────────────────────────────────
def _shrunk_table(df):
    """열쇠 4단 × 매매법 → (n, 성공확률, 평균 순수익). 넓은 칸부터 내려가며 수축한다:
    k0 = '*' · k1 = 국면 · k2 = 국면+2조건 · k3 = 전체 조건. 구체 칸은 표본이 적을수록 부모 칸 값에 가깝다."""
    df = df.assign(win=(df["ex"] > 0).astype(np.float32))
    tab = {}
    # 맨 위('*')
    g0 = df.groupby("pb").agg(n=("ex", "size"), s=("ex", "sum"), w=("win", "sum"))
    for pb, r in g0.iterrows():
        n = float(r["n"])
        tab[("*", pb)] = (int(n), float((r["w"] + K_SHRINK * 0.5) / (n + K_SHRINK)), float(r["s"] / (n + K_SHRINK)))
    for lv, plv in ((1, 0), (2, 1), (3, 2)):
        col, pcol = "k%d" % lv, "k%d" % plv
        g = df.groupby([col, pcol, "pb"]).agg(n=("ex", "size"), s=("ex", "sum"), w=("win", "sum")).reset_index()
        for r in g.itertuples(index=False):
            k, pk, pb, n, s, w = r
            par = tab.get((pk, pb))
            pn, pw, pm = par if par else (0, 0.5, 0.0)
            tab[(k, pb)] = (int(n), float((w + K_SHRINK * pw) / (n + K_SHRINK)), float((s + K_SHRINK * pm) / (n + K_SHRINK)))
    return tab


def choose(tab, keys, pbs):
    """가장 구체적인 칸부터 — 표에 있으면 그 칸 값(이미 부모 쪽으로 수축됨). → (pb, n, win, mean) 또는 None."""
    for k in keys:
        best = None
        for pb in pbs:
            v = tab.get((k, pb))
            if v is None:
                continue
            n, w, m = v
            if m > 0 and w >= 0.5 and (best is None or m > best[3]):
                best = (pb, n, w, m)
        if any((k, pb) in tab for pb in pbs):
            return best
    return None


def validate(df, timecol, pbs):
    """시간순 앞 70% 로 표 → 뒤 30% 에서 표가 고른 매매법의 실제 결과."""
    ts = np.sort(df[timecol].unique())
    if len(ts) < 20:
        return {"pass": False, "why": "기간 부족"}, None
    cut = ts[int(len(ts) * TRAIN_FRAC)]
    tr, te = df[df[timecol] < cut], df[df[timecol] >= cut]
    tab = _shrunk_table(tr)
    base = te["ex"].values
    picked = []
    # 같은 (시각, 열쇠) 행 묶음마다 표가 고른 매매법의 결과만
    for keys, g in te.groupby(["k3", "k2", "k1"], sort=False):
        ch = choose(tab, list(keys) + ["*"], pbs)
        if ch is None:
            continue
        picked.append(g[g["pb"] == ch[0]]["ex"].values)
    pk = np.concatenate(picked) if picked else np.array([])
    n = len(pk)
    st = {"n": int(n), "mean": round(float(pk.mean()), 4) if n else None,
          "win": round(float((pk > 0).mean() * 100), 1) if n else None,
          "t": round(float(pk.mean() / (pk.std(ddof=1) / math.sqrt(n))), 2) if n > 2 and pk.std() > 0 else 0.0,
          "base": round(float(base.mean()), 4) if len(base) else None, "cut": str(cut)}
    st["pass"] = bool(n >= 30 and st["mean"] > 0 and st["t"] >= PASS_T and st["base"] is not None and st["mean"] > st["base"])
    return st, tab


def _relevel(df):
    """k0(구체)…k3('*') 를 _shrunk_table 이 기대하는 순서로: k3(구체)…k0('*') → 열 이름 뒤집기."""
    m = {"k0": "k3", "k1": "k2", "k2": "k1", "k3": "k0"}
    return df.rename(columns=m)


def export(tab, pbs, min_n=20):
    """워커로 보낼 표 — 열쇠마다 매매법별 [n, 성공확률, 평균]. 표본 적은 구체 칸은 버린다(부모가 대신한다)."""
    out = {}
    for (k, pb), (n, w, m) in tab.items():
        if k.count("|") >= 3 and n < min_n:
            continue
        out.setdefault(k, {})[pb] = [n, round(w, 4), round(m, 4)]
    return out


def run(daily, mkt_by_sym, day_key_of, BASE=None, HDR=None, upload=True, log=print, bars5=None, ev_dates=()):
    import strategy_router as SR
    for market in ("us", "kr"):
        t0 = time.time()
        P = SR._panel(daily, mkt_by_sym, market, day_key_of)
        if P is None:
            log("   · [매매법시뮬] %s 일봉 부족 — 건너뜀" % market)
            continue
        ddf, reg_now = sim_daily(P, market, ev_dates)
        ddf = _relevel(ddf)
        dst, _ = validate(ddf, "t", list(DAILY_PB))
        dtab = _shrunk_table(ddf)                       # 실전 표는 전 기간으로
        reg_series, _ = _regime(P["close"])
        reg_by_day = {int(d): r for d, r in zip(P["close"].index, reg_series)}
        ist, itab = {"pass": False, "why": "5분봉 없음"}, {}
        b5 = {s: v for s, v in (bars5 or {}).items() if mkt_by_sym.get(s) == market}
        if b5:
            idf = sim_intra(b5, reg_by_day, market)
            if len(idf):
                idf = _relevel(idf)
                ist, _ = validate(idf, "day", list(INTRA_PB))
                itab = _shrunk_table(idf)
            log("   · [매매법시뮬] %s 5분봉 %d종목 · 시뮬 %d건" % (market, len(b5), len(idf)))
        log("   · [매매법시뮬] %s 국면 %s · 일봉 시뮬 %d건 · 검증 n=%s 평균 %s%% 승률 %s%% t=%s (아무거나 %s%%) → %s · 5분 검증 n=%s 평균 %s%% t=%s → %s (%.0fs)" % (
            market, reg_now, len(ddf), dst.get("n"), dst.get("mean"), dst.get("win"), dst.get("t"), dst.get("base"),
            "통과" if dst.get("pass") else "미통과", ist.get("n"), ist.get("mean"), ist.get("t"), "통과" if ist.get("pass") else "미통과",
            time.time() - t0))
        if upload and BASE:
            try:
                import requests
                body = {"mkt": market, "day": str(P["close"].index[-1]), "regime": reg_now,
                        "daily": {"val": dst, "table": export(dtab, list(DAILY_PB)), "pb": {k: {kk: vv for kk, vv in v.items()} for k, v in DAILY_PB.items()}},
                        "intra": {"val": ist, "table": export(itab, list(INTRA_PB)), "pb": INTRA_PB}}
                r = requests.post(BASE + "/api/playbook", headers=HDR, json=body, timeout=180)
                log("   · [매매법시뮬] %s 업로드 %s" % (market, r.status_code))
            except Exception as e:  # noqa: BLE001
                log("   ⚠️ [매매법시뮬] 업로드 실패 %s" % e)
