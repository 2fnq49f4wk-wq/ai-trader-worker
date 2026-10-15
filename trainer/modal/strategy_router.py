"""[V33.602 · Phase B+C] 매매법 선택 AI(Strategy-Router) — 표본 생성 + 걷기 검증 · GitHub Actions(무료)에서 돈다. [V33.603] 관문 통과 시장은 워커 STRAT_ROUTE 가 picks 를 실제로 산다

Phase B  표본: 도감(strategy_catalog) 17개 매매법이 전 종목 일봉에서 낸 신호마다 '그 매매법의 청산 프로필대로 샀다면' 을 계산한다
         → [매매법 · 종목 · 날짜 · 국면 · 순초과수익(시장 동일가중 대비 · 왕복비용 차감) · 보유일].
Phase C  선택: 날짜 d 에는 d 이전에 ★끝난★ 표본만 보고 (매매법 × 국면) 기대수익을 베이즈 수축으로 추정한다
         (표본이 적으면 묶음(TREND·MEANREV·VOLVOL) 평균 쪽으로, 묶음도 적으면 0 쪽으로 당긴다).
         그날 국면에서 기대수익 > 0 인 매매법의 신호만 사고, 한 종목에 여러 신호면 기대수익이 가장 큰 매매법 하나로 산다.

★미리 고정(데이터 보기 전 · 바꾸려면 사용자 결정)★
  진입   신호 다음 날 종가(앞을 보지 않는다) · 같은 종목은 앞 거래가 끝나야 다시 산다
  청산   손절 = min(프로필 stop%, ATR×배수) — 저가가 닿으면 그 값(갭이면 시가) · 1차 익절 R 에 닿으면 손절을 본전으로 · 최대 보유일 종가
  국면   시장 동일가중 지수 > MA200 이고 MA50 10일 상승 → BULL · < MA200 이고 하락 → BEAR · 나머지 NEUTRAL
  수축   k = 30 (n 개 표본의 평균을 묶음 평균 쪽으로 k/(n+k) 만큼)
  걷기   21거래일마다 다시 추정 · 최근 500거래일
  관문   거래 ≥ 100 · 평균 순초과 > 0 · t ≥ 2.0 · 그리고 '도감 신호 전부 사기' 보다 평균이 높다 → pass.
         pass 한 시장만 워커가 산다(잠정 ×0.5 · 관문은 워커가 다시 판정).
"""
import math
import time

import numpy as np
import pandas as pd

import strategy_catalog as C

K_SHRINK = 30.0
STEP = 21
BT_DAYS = 500
MIN_N_SEL = 20
PASS = {"minN": 100, "minT": 2.0}
REGIMES = ("BULL", "NEUTRAL", "BEAR", "CRASH", "SURGE")   # [V33.606] 폭락·폭등 국면 추가


def _panel(daily, mkt_by_sym, market, day_key_of, max_days=760, min_len=260):
    cols = {k: {} for k in ("open", "high", "low", "close", "volume")}
    src = {"open": "o", "high": "h", "low": "l", "close": "c", "volume": "v"}
    for s, bd in daily.items():
        if mkt_by_sym.get(s, "us") != market or not bd or not bd.get("t") or s.startswith("^"):
            continue
        if len(bd["t"]) < min_len or not bd.get("c"):
            continue
        idx = [day_key_of(t) for t in bd["t"]]
        for k, f in src.items():
            arr = bd.get(f) or bd["c"]
            if len(arr) != len(idx):
                arr = bd["c"]
            x = pd.Series(np.asarray(arr, dtype=float), index=idx)
            cols[k][s] = x[~x.index.duplicated(keep="last")]
    if len(cols["close"]) < 30:
        return None
    P = {}
    for k, d in cols.items():
        P[k] = pd.DataFrame(d).sort_index().iloc[-max_days:]
    good = P["close"] > 1.0
    for k in P:
        P[k] = P[k].where(good)
    if P["volume"].isna().all().all() or (P["volume"].fillna(0) <= 0).all().all():
        P.pop("volume")
    return P


def _regime(close):
    r = close.pct_change(fill_method=None).mean(axis=1).fillna(0)
    idx = (1 + r).cumprod()
    m200, m50 = idx.rolling(200, min_periods=120).mean(), idx.rolling(50, min_periods=40).mean()
    up = m50 > m50.shift(10)
    reg = np.where((idx > m200) & up, "BULL", np.where((idx < m200) & ~up, "BEAR", "NEUTRAL"))
    # [V33.606] 폭락·폭등 — 시장 동일가중 하루 ≤ −2.5%(≥ +2.5%) 또는 5일 ≤ −6%(≥ +6%) 가 난 날부터 3거래일은 그 국면(미리 고정)
    r5 = (1 + r).rolling(5).apply(np.prod, raw=True) - 1
    crash = ((r <= -0.025) | (r5 <= -0.06)).astype(float).rolling(3, min_periods=1).max() > 0
    surge = ((r >= 0.025) | (r5 >= 0.06)).astype(float).rolling(3, min_periods=1).max() > 0
    reg = np.where(crash.values, "CRASH", np.where(surge.values, "SURGE", reg))
    return pd.Series(reg, index=close.index), r.values


def _atr_pct(P):
    c, h, l = P["close"], P["high"], P["low"]
    pc = c.shift(1)
    tr = np.maximum(h - l, np.maximum((h - pc).abs(), (l - pc).abs()))
    return (tr.rolling(14, min_periods=14).mean() / c * 100).values


FEATS = ("rsi14", "atr", "ret5", "ret20", "ret60", "gap20", "gap50", "pos250", "vr20", "mret20",
         "m_r1", "m_r5", "m_volr", "m_disp", "ev_fomc_to", "ev_fomc_since", "ev_cpi_to", "ev_cpi_since")

# [V33.606] 미국 거시 발표일(공식 일정 · 한국 종목도 이 날 크게 흔들린다). 발표 '전 며칠·후 며칠' 을 피처로(발표 수치 자체는 시장 반응 m_r1 이 담는다).
FOMC = [20230201, 20230322, 20230503, 20230614, 20230726, 20230920, 20231101, 20231213,
        20240131, 20240320, 20240501, 20240612, 20240731, 20240918, 20241107, 20241218,
        20250129, 20250319, 20250507, 20250618, 20250730, 20250917, 20251029, 20251210,
        20260128, 20260318, 20260429, 20260617, 20260729, 20260916, 20261028, 20261209]
CPI = [20230112, 20230214, 20230314, 20230412, 20230510, 20230613, 20230712, 20230810, 20230913, 20231012, 20231114, 20231212,
       20240111, 20240213, 20240312, 20240410, 20240515, 20240612, 20240711, 20240814, 20240911, 20241010, 20241113, 20241211,
       20250115, 20250212, 20250312, 20250410, 20250513, 20250611, 20250715, 20250812, 20250911, 20251024, 20251218,
       20260113, 20260211, 20260311, 20260410, 20260512, 20260610, 20260714, 20260812, 20260911, 20261014, 20261110, 20261210]
EV_CAP = 10.0


def _ev_days(dates, evs):
    """거래일 단위로 다음 발표까지 · 지난 발표 이후(0 = 발표 당일, 최대 10). 일정표 밖은 NaN."""
    dk = np.asarray([int(d) for d in dates])
    pos = np.searchsorted(dk, np.asarray(evs))          # 발표일이 들어갈 거래일 자리
    to, since = np.full(len(dk), np.nan), np.full(len(dk), np.nan)
    inside = (dk >= min(evs) - 100) & (dk <= max(evs))
    for t in range(len(dk)):
        nxt = pos[pos >= t]
        prv = pos[pos <= t]
        if len(nxt):
            to[t] = min(EV_CAP, nxt[0] - t)
        if len(prv):
            since[t] = min(EV_CAP, t - prv[-1])
    to[~inside] = np.nan
    return to, since


def _feats(P):
    """[V33.604] 종목 특성(신호 날 · 그날까지의 값만) — 같은 매매법이라도 종목마다 맞고 안 맞음을 배운다."""
    c = P["close"]
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    v = P.get("volume")
    mr = c.pct_change(fill_method=None).mean(axis=1)
    F = {"rsi14": (100 - 100 / (1 + up / dn.replace(0, np.nan))).values, "atr": _atr_pct(P),
         "ret5": (c / c.shift(5) - 1).values * 100, "ret20": (c / c.shift(20) - 1).values * 100, "ret60": (c / c.shift(60) - 1).values * 100,
         "gap20": (c / c.rolling(20).mean() - 1).values * 100, "gap50": (c / c.rolling(50).mean() - 1).values * 100,
         "pos250": (c / c.rolling(250, min_periods=120).max()).values,
         "vr20": (v / v.rolling(20).mean()).values if v is not None else np.full(c.shape, np.nan),
         "mret20": np.repeat(((1 + mr).rolling(20).apply(np.prod, raw=True) - 1).values[:, None] * 100, c.shape[1], axis=1)}
    # [V33.606] 시장 상태(폭락·폭등 강도) + 거시 발표 전후 — 날짜마다 같은 값(모든 종목)
    rr = c.pct_change(fill_method=None)
    rep = lambda x: np.repeat(np.asarray(x, dtype=float)[:, None], c.shape[1], axis=1)  # noqa: E731
    F["m_r1"] = rep(mr.values * 100)
    F["m_r5"] = rep(((1 + mr).rolling(5).apply(np.prod, raw=True) - 1).values * 100)
    F["m_volr"] = rep((mr.rolling(5).std() / mr.rolling(60).std()).values)
    F["m_disp"] = rep(rr.std(axis=1).values * 100)
    for nm, ev in (("fomc", FOMC), ("cpi", CPI)):
        to, since = _ev_days(c.index, ev)
        F["ev_%s_to" % nm], F["ev_%s_since" % nm] = rep(to), rep(since)
    return F


def event_cols(dks, syms, market, ext):
    """[V33.606] 종목 사건 피처 — 실적(미국: 서프라이즈·경과일·최근 4번 상회율) · 뉴스(한국: 건수·급증·논조·공백).
    omni.earn_feats / news_feats 를 그대로 쓴다(그 날짜까지만 · 미래를 안 본다). ext 없으면 빈 표."""
    import omni
    rows = []
    ear, nws = (ext or {}).get("earn") or {}, (ext or {}).get("news") or {}
    cache = {}
    for dk, sy in zip(dks, syms):
        k = (dk, sy)
        if k not in cache:
            r = {}
            if ear:
                r.update(omni.earn_feats(ear.get(sy), dk))
            if nws:
                r.update(omni.news_feats(nws.get(sy), dk))
            cache[k] = r
        rows.append(cache[k])
    return pd.DataFrame(rows)


def build_samples(P, market):
    """Phase B — 모든 매매법 신호의 결과표. 같은 매매법·종목은 앞 거래가 끝나기 전엔 다시 세지 않는다."""
    O, H, L, Cl = (P[k].values for k in ("open", "high", "low", "close"))
    T, N = Cl.shape
    reg, mret = _regime(P["close"])
    regv = reg.values
    atr = _atr_pct(P)
    cost = C.COST_RT[market]
    sig = C.signals(P)
    rows = []
    for s in C.CATALOG:
        S = sig[s["id"]].values
        ex = s["exit"]
        ii, jj = np.nonzero(S[: T - 2])
        busy = np.full(N, -1)
        for i, j in zip(ii, jj):                 # np.nonzero 는 행(날짜) 순서 → busy 판정이 시간순
            if i <= busy[j]:
                continue
            e = i + 1
            pe = Cl[e, j]
            if not (pe > 0) or np.isnan(atr[i, j]):
                continue
            stop = min(ex["stop"], ex["atr"] * atr[i, j])
            spx = pe * (1 - stop / 100)
            tp = pe * (1 + ex["tp1R"] * stop / 100)
            last = min(e + ex["hold"], T - 1)
            px, x = None, last
            for k in range(e + 1, last + 1):
                if L[k, j] <= spx:
                    px = min(O[k, j], spx) if O[k, j] == O[k, j] else spx
                    x = k
                    break
                if H[k, j] >= tp:
                    spx = max(spx, pe)           # 본전 손절로 올린다
            if px is None:
                px = Cl[x, j]
            if not (px > 0):
                continue
            raw = (px / pe - 1) * 100
            mk = (np.prod(1 + mret[e + 1:x + 1]) - 1) * 100
            rows.append((s["id"], j, i, x, regv[i], raw - mk - cost, raw - cost))
            busy[j] = x
    df = pd.DataFrame(rows, columns=["sid", "j", "i", "x", "reg", "ex", "raw"])
    if len(df):
        F = _feats(P)
        for k in FEATS:
            df[k] = F[k][df["i"].values, df["j"].values]
        sv = {s["id"]: min(s["exit"]["stop"], 1e9) for s in C.CATALOG}
        am = {s["id"]: s["exit"]["atr"] for s in C.CATALOG}
        df["stop"] = np.minimum(df["sid"].map(sv).values, df["sid"].map(am).values * df["atr"].values)
    return df, sig, reg


def _cluster_of():
    return {sid: k for k, v in C.CLUSTERS.items() for sid in v}


def _shrunk(hist):
    """(매매법, 국면) → 수축 평균. 묶음 평균은 0 쪽으로 · 매매법 평균은 묶음 쪽으로."""
    cl = _cluster_of()
    out = {}
    if hist.empty:
        return out
    g = hist.groupby(["sid", "reg"])["ex"].agg(["sum", "count"])
    hist = hist.assign(cl=hist["sid"].map(cl))
    gc = hist.groupby(["cl", "reg"])["ex"].agg(["sum", "count"])
    for (sid, rg), r in g.iterrows():
        cs = gc.loc[(cl.get(sid), rg)] if (cl.get(sid), rg) in gc.index else None
        prior = float(cs["sum"] / (cs["count"] + K_SHRINK)) if cs is not None else 0.0
        out[(sid, rg)] = (float((r["sum"] + K_SHRINK * prior) / (r["count"] + K_SHRINK)), int(r["count"]))
    return out


def _stats(x):
    x = np.asarray(x, dtype=float)
    n = len(x)
    if n < 3 or x.std(ddof=1) == 0:
        return {"n": n, "mean": round(float(x.mean()), 4) if n else None, "t": 0.0, "win": None}
    return {"n": n, "mean": round(float(x.mean()), 4), "t": round(float(x.mean() / (x.std(ddof=1) / math.sqrt(n))), 2),
            "win": round(float((x > 0).mean() * 100), 1)}


def walk_forward(df, T):
    """Phase C — 21일마다 그 전에 끝난 표본만으로 고르고, 다음 21일 신호를 산다."""
    start = max(260, T - BT_DAYS)
    picked, allsig = [], []
    for f in range(start, T - 2, STEP):
        hist = df[(df["x"] < f) & (df["i"] >= f - BT_DAYS)]
        est = _shrunk(hist)
        blk = df[(df["i"] >= f) & (df["i"] < f + STEP)]
        if blk.empty:
            continue
        allsig.extend(blk["ex"].tolist())
        b = blk.assign(mu=[est.get((s, r), (0.0, 0))[0] for s, r in zip(blk["sid"], blk["reg"])],
                       nn=[est.get((s, r), (0.0, 0))[1] for s, r in zip(blk["sid"], blk["reg"])])
        b = b[(b["mu"] > 0) & (b["nn"] >= MIN_N_SEL)]
        if b.empty:
            continue
        b = b.sort_values(["i", "mu"], ascending=[True, False]).drop_duplicates(["i", "j"])   # 한 종목·하루 = 매매법 하나
        busy = {}
        for r in b.itertuples():
            if busy.get(r.j, -1) >= r.i:
                continue
            picked.append(r.ex)
            busy[r.j] = r.x
    rt, base = _stats(picked), _stats(allsig)
    ok = (rt["n"] >= PASS["minN"] and (rt["mean"] or 0) > 0 and rt["t"] >= PASS["minT"]
          and base["mean"] is not None and rt["mean"] > base["mean"])
    return {"router": rt, "baseline": base, "pass": bool(ok), "days": BT_DAYS, "step": STEP, "k": K_SHRINK}


LGB_RETRAIN = 63
SIDS = [s["id"] for s in C.CATALOG]


QCOLS = []   # attach_omni 가 채운다(시장마다)


def _X(d):
    X = d[list(FEATS) + [c for c in QCOLS if c in d.columns]].astype(float).copy()
    X["sid"] = pd.Categorical(d["sid"], categories=SIDS).codes
    X["reg"] = pd.Categorical(d["reg"], categories=list(REGIMES)).codes
    return X


def _lgb_fit(hist):
    import lightgbm as lgb
    y = hist["ex"].clip(-15, 15).values                 # 꼬리 몇 건이 모델을 끌고 가지 않게
    prm = {"objective": "regression", "learning_rate": 0.03, "num_leaves": 15, "min_data_in_leaf": 80, "bagging_fraction": 0.8, "bagging_freq": 1,
           "feature_fraction": 0.8, "lambda_l2": 5.0, "verbose": -1, "num_threads": 4, "seed": 7}
    m = lgb.train(prm, lgb.Dataset(_X(hist), y, categorical_feature=["sid", "reg"]), num_boost_round=200)
    return m


OMNI_MAX_FEATS = 60   # OMNI-Q 피처 166개 중 표본 수를 감당할 만큼만(분산이 큰 순)


def attach_omni(df, P, ox, log=print):
    """[V33.605] OMNI-Q 피처(동물원 166개 · 날짜별 횡단면 순위)를 표본에 붙인다 — 같은 날·같은 종목 값(앞을 보지 않는다).
    피처가 많으면 표본이 모자라니 분산이 큰 OMNI_MAX_FEATS 개만 쓴다. 이름은 'q_' 접두."""
    if not ox or df.empty:
        return df, []
    di = {d: k for k, d in enumerate(ox["dates"])}
    si = {s: k for k, s in enumerate(ox["syms"])}
    dates, syms = list(P["close"].index), list(P["close"].columns)
    a = np.array([di.get(dates[i], -1) for i in df["i"].values])
    b = np.array([si.get(syms[j], -1) for j in df["j"].values])
    ok = (a >= 0) & (b >= 0)
    if ok.mean() < 0.5:
        log("      ⚠️ [매매법AI] OMNI-Q 피처 정렬 실패(%.0f%%) — 기본 특성만" % (ok.mean() * 100))
        return df, []
    X = ox["X"]
    M = np.full((len(df), X.shape[2]), np.nan, dtype=np.float32)
    M[ok] = X[a[ok], b[ok], :]
    var = np.nanvar(M, axis=0)
    keep = np.argsort(-np.nan_to_num(var))[:OMNI_MAX_FEATS]
    cols = ["q_" + str(ox["names"][k]) for k in keep]
    df = pd.concat([df.reset_index(drop=True), pd.DataFrame(M[:, keep], columns=cols)], axis=1)
    return df, cols


def omni_today(P, ox, cols, js):
    """오늘(마지막 날) 종목 js 의 OMNI-Q 피처 — attach_omni 와 같은 열."""
    if not cols:
        return None
    si = {s: k for k, s in enumerate(ox["syms"])}
    names = {"q_" + str(n): k for k, n in enumerate(ox["names"])}
    d = ox["dates"].index(P["close"].index[-1]) if P["close"].index[-1] in ox["dates"] else None
    syms = list(P["close"].columns)
    M = np.full((len(js), len(cols)), np.nan, dtype=np.float32)
    if d is None:
        return pd.DataFrame(M, columns=cols)
    for r, j in enumerate(js):
        b = si.get(syms[j])
        if b is not None:
            M[r] = ox["X"][d, b, [names[c] for c in cols]]
    return pd.DataFrame(M, columns=cols)


def walk_forward_lgb(df, T):
    """[V33.604] 종목별 매매법 선택 — LightGBM 이 (매매법 · 국면 · 종목 특성) → 순초과를 예측.
    63거래일마다 그 전에 ★끝난★ 표본만으로 다시 학습 · 한 종목·하루에 신호가 여럿이면 예측이 가장 큰 매매법 · 예측 > 0 만 산다."""
    start = max(260, T - BT_DAYS)
    picked, allsig = [], []
    m, mf = None, -10 ** 9
    for f in range(start, T - 2, STEP):
        if f - mf >= LGB_RETRAIN or m is None:
            hist = df[(df["x"] < f) & (df["i"] >= f - 750)]
            if len(hist) < 2000:
                continue
            m, mf = _lgb_fit(hist), f
        blk = df[(df["i"] >= f) & (df["i"] < f + STEP)]
        if blk.empty:
            continue
        allsig.extend(blk["ex"].tolist())
        b = blk.assign(mu=m.predict(_X(blk)))
        b = b[b["mu"] > 0].sort_values(["i", "mu"], ascending=[True, False]).drop_duplicates(["i", "j"])
        busy = {}
        for r in b.itertuples():
            if busy.get(r.j, -1) >= r.i:
                continue
            picked.append(r.ex)
            busy[r.j] = r.x
    rt, base = _stats(picked), _stats(allsig)
    ok = (rt["n"] >= PASS["minN"] and (rt["mean"] or 0) > 0 and rt["t"] >= PASS["minT"]
          and base["mean"] is not None and rt["mean"] > base["mean"])
    return {"router": rt, "baseline": base, "pass": bool(ok), "days": BT_DAYS, "step": STEP, "model": "lgb"}


def run(daily, mkt_by_sym, day_key_of, BASE=None, HDR=None, upload=True, log=print, omni_x=None, events=None):
    for market in ("us", "kr"):
        t0 = time.time()
        P = _panel(daily, mkt_by_sym, market, day_key_of)
        if P is None:
            log("   · [매매법AI] %s 일봉 부족 — 건너뜀" % market)
            continue
        df, sig, reg = build_samples(P, market)
        ox = (omni_x or {}).get(market)
        ext = (events or {}).get(market)
        df, qc = attach_omni(df, P, ox, log)
        syms0, dts0 = list(P["close"].columns), list(P["close"].index)
        ec = []
        try:
            E = event_cols([dts0[i] for i in df["i"].values], [syms0[j] for j in df["j"].values], market, ext)
            ec = [c for c in E.columns if E[c].notna().mean() >= 0.2]   # 덮은 표본이 20% 미만이면 안 쓴다
            if ec:
                df = pd.concat([df.reset_index(drop=True), E[ec].reset_index(drop=True)], axis=1)
        except Exception as e:  # noqa: BLE001
            log("      ⚠️ [매매법AI] 사건 피처 실패 %s" % e)
        QCOLS[:] = qc + ec
        T = P["close"].shape[0]
        wf_s = walk_forward(df, T)
        wf_s["model"] = "shrink"
        try:
            wf_l = walk_forward_lgb(df, T)
        except Exception as e:  # noqa: BLE001
            log("   ⚠️ [매매법AI] LightGBM 실패 %s — 수축 모델만" % e)
            wf_l = {"pass": False, "model": "lgb", "router": {"n": 0, "mean": None, "t": 0.0}}
        # 미리 고정: 통과한 쪽 중 걷기 평균이 높은 모델 · 둘 다 못 넘으면 수축(기록만)
        cand = [w for w in (wf_l, wf_s) if w["pass"]]
        wf = max(cand, key=lambda w: w["router"]["mean"]) if cand else wf_s
        wf["alt"] = {"model": (wf_l if wf is wf_s else wf_s).get("model"), "router": (wf_l if wf is wf_s else wf_s)["router"]}
        # 매매법별 성적(최근 500일 · 국면별) — 화면·사람 검토용
        rec = df[df["i"] >= T - BT_DAYS]
        table = {}
        for sid, g in rec.groupby("sid"):
            table[sid] = {"all": _stats(g["ex"]), **{rg: _stats(g[g["reg"] == rg]["ex"]) for rg in REGIMES if (g["reg"] == rg).any()}}
        # 오늘 선택(그림자) — 지금 국면에서 기대수익 > 0 인 매매법의 마지막 날 신호
        est = _shrunk(df[df["x"] < T - 1])
        now = str(reg.iloc[-1])
        syms = list(P["close"].columns)
        F = _feats(P)
        cat = C.by_id()
        last = []                                     # 오늘 신호 전부(종목 × 매매법) + 특성
        for s in C.CATALOG:
            for j in np.nonzero(sig[s["id"]].values[-1])[0]:
                row = {"sid": s["id"], "j": int(j), "reg": now}
                row.update({k: F[k][-1, j] for k in FEATS})
                last.append(row)
        L = pd.DataFrame(last)
        if len(L) and qc:
            L = pd.concat([L.reset_index(drop=True), omni_today(P, ox, qc, L["j"].tolist())], axis=1)
        if len(L) and ec:
            E2 = event_cols([P["close"].index[-1]] * len(L), [syms[j] for j in L["j"]], market, ext)
            L = pd.concat([L.reset_index(drop=True), E2.reindex(columns=ec).reset_index(drop=True)], axis=1)
        picks = {}
        if len(L):
            if wf.get("model") == "lgb":
                L["mu"] = _lgb_fit(df[(df["x"] < T - 1) & (df["i"] >= T - 750)]).predict(_X(L))
                L["n"] = [est.get((sid, now), (0.0, 0))[1] for sid in L["sid"]]
            else:
                L["mu"] = [est.get((sid, now), (0.0, 0))[0] for sid in L["sid"]]
                L["n"] = [est.get((sid, now), (0.0, 0))[1] for sid in L["sid"]]
                L = L[L["n"] >= MIN_N_SEL]
            L = L[L["mu"] > 0].sort_values("mu", ascending=False).drop_duplicates("j")
            for r in L.itertuples():
                ex = cat[r.sid]["exit"]
                stop = float(min(ex["stop"], ex["atr"] * r.atr)) if r.atr == r.atr else float(ex["stop"])
                picks[syms[r.j]] = {"sid": r.sid, "mu": round(float(r.mu), 4), "n": int(r.n), "hold": ex["hold"], "horizon": cat[r.sid]["horizon"],
                                    "stop": round(max(1.5, stop), 2)}
        sel = sorted(({"sid": k[0], "mu": round(v[0], 4), "n": v[1]} for k, v in est.items() if k[1] == now and v[1] >= MIN_N_SEL),
                     key=lambda r: -r["mu"])
        day = str(P["close"].index[-1])
        log("   · [매매법AI] %s OMNI-Q 피처 %d · 사건 피처 %d · 모델 %s(대안 %s 평균 %s%%) · 종목 %d · 표본 %d · 국면 %s · 걷기검증 n=%s 평균 %s%% t=%s (전부사기 %s%%) → %s · 오늘 후보 %d (%.0fs)" % (
            market, len(qc), len(ec), wf.get("model"), wf["alt"]["model"], wf["alt"]["router"].get("mean"), len(syms), len(df), now, wf["router"]["n"], wf["router"]["mean"], wf["router"]["t"], wf["baseline"]["mean"],
            "통과" if wf["pass"] else "미통과", len(picks), time.time() - t0))
        if upload and BASE:
            try:
                import requests
                body = {"mkt": market, "omniFeats": len(qc), "eventFeats": ec, "model": wf.get("model"), "day": day, "regime": now, "nSamples": int(len(df)), "wf": wf, "table": table,
                        "ranking": sel[:17], "picks": dict(sorted(picks.items(), key=lambda kv: -kv[1]["mu"])[:40])}
                r = requests.post(BASE + "/api/strategy-router", headers=HDR, json=body, timeout=120)
                log("   · [매매법AI] %s 업로드 %s" % (market, r.status_code))
            except Exception as e:  # noqa: BLE001
                log("   ⚠️ [매매법AI] 업로드 실패 %s" % e)
