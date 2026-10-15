"""[V33.607·608] 매매법 모의 시뮬레이터(Playbook-Sim) — '확률 높은 종목을 먼저 뽑고 · 그 종목에 맞는 매매법으로 산다'.

사용자 설계(10/15):
  ① 지금 확률 높은 종목(OMNI-Q 상위 20%)이 후보가 된다.
  ② 그 종목에서 ★지금 진입 신호가 뜬 매매법들★(일봉 도감 17종 — 스토캐스틱·RSI2·눌림·돌파·거래량… / 5분 단타 5종 — 시가범위 돌파·
     장중 눌림 반등·5분 스토캐스틱·5분 모멘텀·VWAP 회복) 중에서
  ③ 그 종목의 ★지금 상황과 닮은 과거★(상황 칸)에서 그 매매법이 낸 모의 성적(성공확률·평균 순수익)이 가장 좋은 것으로 산다.
  ④ 매도는 그 매매법의 규칙(손절 · 익절 · 본전 이동 · 최대 보유 · 단타는 장 끝).
  모의 시뮬은 GitHub Actions(무료)가 매 회차 과거 전 종목에 모든 매매법을 적용해 다시 만들고, 워커는 매 분 신호 판정 + ★표 조회★ 만 한다.

'닮은 과거' = 상황 칸(situation key) — 워커가 같은 칸을 실시간으로 계산한다(경계는 check-playbook 이 대조).
  일봉 칸  국면(5) · RSI14(4) · MA20 거리(4) · 5일 수익(3) · 거래량 배수(3) · FOMC/CPI ±2거래일(2)
  5분 칸   국면(5) · 장중 등락(5) · 장 시작 후 시간대(4) · 일봉 추세(MA20 위/아래)(2)
  칸에 표본이 적으면 넓은 칸(조건을 뺀 칸) 값 쪽으로 당긴다(베이즈 수축 k=40).

1분봉은 과거 기록이 저장돼 있지 않아 단타 시뮬은 5분봉으로 한다(워커는 1분봉을 5분으로 묶어 같은 조건을 본다).

★미리 고정(데이터 보기 전 · 바꾸려면 사용자 결정)★
  체결     신호가 뜬 봉의 종가에 산다(워커는 신호가 뜬 그 분의 현재가) · 같은 봉에서 손절·익절이 둘 다 닿으면 손절(보수적)
  비용     왕복 미 0.10% · 한 0.30% 차감 · 일봉은 시장 동일가중 대비 초과(국면 효과를 빼고 매매법만 잰다)
  검증     시간순 앞 70% 로 표 → 뒤 30% 에서 '후보마다 뜬 매매법 중 표가 고른 것' 의 실제 결과
  관문     그 결과 평균 > 0 · t ≥ 2 · '뜬 매매법 아무거나' 평균보다 높다 · 표본 ≥ 30 → 그 시장·그 봉(일봉/5분)만 실전
  선택     뜬 매매법 중 (칸의 수축 평균 > 0 · 수축 성공확률 ≥ 50%) 이고 평균이 가장 큰 것 — 없으면 안 산다
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
# 일봉: 도감(strategy_catalog) 17종 그대로 — 진입 = 그 매매법의 신호 · 매도 = 그 매매법의 청산 프로필.
#   stop: 최대 손절 % · atr: ATR 손절 배수(작은 쪽) · be: 이 R 에 닿으면 손절을 본전으로 · hold: 최대 보유 거래일 · tpR: 전량 익절 R(None=없음)
import strategy_catalog as CAT  # noqa: E402

TPR = {"trend": None, "pullbk": 2.0, "snap": 1.5, "stoch": 1.5, "volume": 2.0, "vol": 2.5, "value": 1.5, "mom": None}
DAILY_PB = {s_["id"]: {"stop": s_["exit"]["stop"], "atr": s_["exit"]["atr"], "be": s_["exit"]["tp1R"], "hold": s_["exit"]["hold"],
                       "tpR": TPR[s_["exitKey"]], "family": s_["family"], "label": s_["note"] or s_["family"]} for s_ in CAT.CATALOG}
# [V33.618] ★스냅(반등·스토캐스틱·거래량 단기) 매매법 = 워커 실전 스냅 청산(snapRules)★ — 사용자 10/15 "규칙으로 돌렸을 때 RSI2 반등이 가장 많이 벌었는데 왜?"
#   원인: 시뮬이 스냅 매매법에 '손절 4% · 1.5R 익절 · 8일 보유' 같은 일반 프로필을 썼다. 실전은 평균회귀 청산이다 —
#   종가 > MA5 또는 RSI2 ≥ 65 이면 그날 종가에 판다 · +5% 익절 · +2% 에 본전 이동 · 5거래일 지나도 손실이면 판다 · 손절 min(3.5%, ATR×1.5).
#   반등을 먹고 바로 나오는 이 청산이 RSI2 반등의 실력이다 — 일반 프로필로는 반등 뒤 되밀림을 다 맞았다.
SNAP_MR = {"mr": True, "stop": 3.5, "atr": 1.5, "be": 0.0, "tpR": None, "tpPct": 5.0, "bePct": 2.0, "tstop": 5, "rsi2x": 65}
for _id, _p in DAILY_PB.items():
    _h = next(s_["horizon"] for s_ in CAT.CATALOG if s_["id"] == _id)
    if _h == "snap":
        _p.update(SNAP_MR)
        _p["hold"] = max(_p["hold"], 8)
CROSS_PB = ("RS_LEADER", "XS_ARB", "DUAL_MOM")   # 횡단면(전 종목 순위) 조건 — 워커는 학습기가 보낸 '오늘 뜬 종목' 목록을 쓴다
# 5분 단타: 진입 조건(오늘 5분봉) + tpPct/sl % · bars = 최대 5분봉 수(0 = 장 끝까지) · 장 끝에는 무조건 판다
INTRA_PB = {
    "ORB":     {"tpPct": 1.5, "sl": 0.8, "bars": 0,  "label": "시가 범위 돌파 — 첫 30분 고가를 위로 · 장 끝까지"},
    "DIP_REV": {"tpPct": 1.0, "sl": 0.7, "bars": 12, "label": "장중 눌림 반등 — 당일 고점 −1% 아래에서 반등 봉 · 60분"},
    "STOCH5":  {"tpPct": 0.8, "sl": 0.6, "bars": 12, "label": "5분 스토캐스틱 — 과매도(≤25) %K↗%D · 60분"},
    "MOM3":    {"tpPct": 1.0, "sl": 0.6, "bars": 6,  "label": "5분 모멘텀 — 3봉 연속 상승 +0.5% · 30분"},
    "VWAP_RE": {"tpPct": 1.0, "sl": 0.6, "bars": 18, "label": "VWAP 회복 — 아래에서 위로 · 90분"},
}
INTRA_MIN_LEFT = 6   # 장 끝까지 5분봉 6개(30분) 넘게 남아야 산다(워커 intraMinToClose 30분과 같다)


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


def _sim_profile(O, H, L, C, atr, mcum, pr, cost, t0=250, mrx=None):
    """모든 (날짜 t ≥ t0 · 종목 j) 에서 t 종가에 샀다면 — 그 청산 프로필의 순초과 % (T×N · 시뮬 못 하는 칸 NaN)."""
    T, N = C.shape
    hold = pr["hold"]
    out = np.full((T, N), np.nan, dtype=np.float32)
    xo = np.full((T, N), -1, dtype=np.int32)
    t_end = T - 1 - hold
    if t_end <= t0:
        return out, xo
    ts = np.arange(t0, t_end)
    pe = C[ts]
    stp = np.minimum(pr["stop"], pr["atr"] * atr[ts])
    sl = pe * (1 - stp / 100)
    R = pe * stp / 100
    be_px = pe * (1 + pr["bePct"] / 100) if pr.get("bePct") else pe + pr["be"] * R if pr["be"] else np.full_like(pe, np.inf)
    tp_px = (pe * (1 + pr["tpPct"] / 100) if pr.get("tpPct") else pe + pr["tpR"] * R if pr["tpR"] else np.full_like(pe, np.inf))
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
        if pr.get("mr") and mrx is not None:                              # [V33.618] 평균회귀 청산(종가 > MA5 · RSI2 ≥ 65) — 그날 종가
            hit_mr = alive & mrx[ts + k]
            px = np.where(hit_mr, cl, px); xk = np.where(hit_mr, k, xk); alive &= ~hit_mr
        if pr.get("tstop") and k == pr["tstop"]:                          # [V33.618] N거래일 지나도 손실이면 판다
            hit_ts = alive & (cl < pe)
            px = np.where(hit_ts, cl, px); xk = np.where(hit_ts, k, xk); alive &= ~hit_ts
        if k == hold:
            px = np.where(alive, cl, px)
    raw = (px / pe - 1) * 100
    mk = (mcum[ts[:, None] + xk + 1] / mcum[ts[:, None] + 1] - 1) * 100
    out[ts] = (raw - mk - cost).astype(np.float32)
    xo[ts] = (ts[:, None] + xk).astype(np.int32)
    return out, xo


CAND_Q = 0.80        # 후보 = 그날 OMNI-Q 표본 밖 점수 상위 20%(워커 PB_ROUTE.candMin 과 같다)
CAND_MIN_ROWS = 3000  # 후보로 거른 표본이 이보다 적으면 전 종목으로(기록에 남긴다)


def cand_mask(P, oos):
    """OMNI-Q 표본 밖 점수(날짜×종목) → P 와 같은 모양의 '그날 후보(상위 20%)' bool. 점수 없는 날은 전부 False."""
    if not oos or oos.get("sc") is None:
        return None
    di = {d: k for k, d in enumerate(oos["dates"])}
    si = {s_: k for k, s_ in enumerate(oos["syms"])}
    dates, syms = list(P["close"].index), list(P["close"].columns)
    a = np.array([di.get(d, -1) for d in dates])
    b = np.array([si.get(s_, -1) for s_ in syms])
    M = np.full((len(dates), len(syms)), np.nan, dtype=np.float32)
    ra, cb = np.nonzero(a >= 0)[0], np.nonzero(b >= 0)[0]
    if len(ra) == 0 or len(cb) == 0:
        return None
    M[np.ix_(ra, cb)] = oos["sc"][np.ix_(a[ra], b[cb])]
    rk = pd.DataFrame(M).rank(axis=1, pct=True).values
    return np.nan_to_num(rk, nan=0.0) >= CAND_Q


def _mr_exit(P):
    """[V33.618] 평균회귀 청산 신호(T×N) — 종가 > MA5 또는 RSI2(단순 2봉) ≥ 65. 워커 snapRules.exitAboveMa5 · exitRsi2 와 같다."""
    C = P["close"]
    ma5 = C.rolling(5, min_periods=5).mean()
    d = C.diff()
    up = d.clip(lower=0).rolling(2).mean()
    dn = (-d.clip(upper=0)).rolling(2).mean()
    rsi2 = (100 - 100 / (1 + up / dn.replace(0, np.nan))).where(dn > 0, 100.0)
    return ((C > ma5) | (rsi2 >= SNAP_MR["rsi2x"])).fillna(False).values


LIVE_FILTER_PB = ("SN_RSI2",)


def _live_filters(P, reg, atr):
    """[V33.618] 실전 규칙의 진입 거르개(snapRules) — RSI2 반등에만: 약세·폭락 국면 금지 · 20일 고점 대비 −12% 이내 · ATR ≤ 5% · 당일 −4% 이상.
    워커 pbLiveFilterOk 와 같다(check-playbook 대조)."""
    C = P["close"]
    hi20 = C.rolling(20, min_periods=20).max()
    pull = (C / hi20 - 1) * 100
    ret1 = C.pct_change(fill_method=None) * 100
    regok = ~np.isin(np.asarray(reg).astype(str), ["BEAR", "CRASH"])
    ok = (pull >= -12).values & (atr <= 5) & (ret1 >= -4).values & regok[:, None]
    return {pb: np.nan_to_num(ok, nan=0).astype(bool) for pb in LIVE_FILTER_PB}


def sim_daily(P, market, ev_dates, sig=None, cand=None):
    """도감 매매법이 뜬 모든 (날짜 · 종목 · 매매법) 의 모의 결과 — 표: [t, j, inst, pb, ex, k0..k3]. inst = 같은 후보(날짜·종목)."""
    O, H, L, C = (P[k].values for k in ("open", "high", "low", "close"))
    T, N = C.shape
    reg, mret = _regime(P["close"])
    rsi, gap20, ret5, vr, atr, near = _daily_state(P, ev_dates)
    cost = COST_RT[market]
    mcum = np.concatenate([[1.0], np.cumprod(1 + mret)])
    sig = sig if sig is not None else CAT.signals(P)
    cache = {}
    out = []
    mrx, live_ok = _mr_exit(P), _live_filters(P, reg, atr)
    for pb, pr in DAILY_PB.items():
        key = (pr["stop"], pr["atr"], pr["be"], pr["hold"], pr["tpR"], pr.get("mr"), pr.get("tpPct"), pr.get("bePct"), pr.get("tstop"))
        if key not in cache:
            cache[key] = _sim_profile(O, H, L, C, atr, mcum, pr, cost, mrx=mrx)
        ex, xo = cache[key]
        S = sig[pb].values & np.isfinite(ex)
        if pb in live_ok:
            S = S & live_ok[pb]
        if cand is not None:
            S = S & cand
        ti, jj = np.nonzero(S)
        if len(ti):
            out.append(pd.DataFrame({"t": ti, "j": jj, "x": xo[ti, jj], "pb": pb, "ex": ex[ti, jj]}))
    df = pd.concat(out, ignore_index=True) if out else pd.DataFrame({"t": [], "j": [], "x": [], "pb": [], "ex": []})
    t, j = df["t"].values.astype(int), df["j"].values.astype(int)
    df["inst"] = t.astype(np.int64) * 100000 + j
    df["hd"] = (df["x"].values - t).clip(1, None).astype(np.float32)   # [V33.618] 실제 보유 거래일(하루당 수익 점수용)
    ks = daily_keys(reg[t], rsi[t, j], gap20[t, j], ret5[t, j], vr[t, j], near[t])
    for lv, k in enumerate(ks):
        df["k%d" % lv] = k
    return df, str(reg[-1]), sig


def exit_diag(P, market, sig, cand=None):
    """[V33.613] ★진단(기록만 · 판정에 안 씀)★ 매매법마다 지금 손절(% 와 ATR×배수 중 타이트한 쪽) vs '고정 % 손절만'(넓은 쪽)의
    평균 순초과·승률 — 승률 39~41% 가 너무 타이트한 손절 때문인지 본다. 전 기간 · 후보 거른 표본."""
    O, H, L, C = (P[k].values for k in ("open", "high", "low", "close"))
    _r, mret = _regime(P["close"])
    atr = _daily_state(P, [])[4]
    mcum = np.concatenate([[1.0], np.cumprod(1 + mret)])
    cost = COST_RT[market]
    out = {}
    cache = {}
    mrx = _mr_exit(P)
    for pb, pr in DAILY_PB.items():
        S = sig[pb].values if pb in sig else None
        if S is None:
            continue
        if cand is not None:
            S = S & cand
        row = {}
        for tag, prof in (("cur", pr), ("wide", dict(pr, atr=99.0))):
            key = (prof["stop"], prof["atr"], prof["be"], prof["hold"], prof["tpR"], prof.get("mr"), prof.get("tpPct"))
            if key not in cache:
                cache[key] = _sim_profile(O, H, L, C, atr, mcum, prof, cost, mrx=mrx)[0]
            ex = cache[key]
            v = ex[S & np.isfinite(ex)]
            row[tag] = [int(len(v)), round(float(v.mean()), 3) if len(v) else None, round(float((v > 0).mean() * 100), 1) if len(v) else None]
        out[pb] = row
    return out


# ── 5분봉 시뮬(단타) ───────────────────────────────────────────────
TZ_OFF = {"us": -4 * 3600, "kr": 9 * 3600}


def _roll(x, n, fn):
    out = np.full(len(x), np.nan)
    for i in range(n - 1, len(x)):
        out[i] = fn(x[i - n + 1:i + 1])
    return out


def intra_fires(c, h, l, v):
    """오늘 5분봉(첫 봉부터) → 매매법별 '이 봉에서 진입 신호' bool 배열. 워커 pbIntraFires 와 같은 정의(check-playbook 이 대조)."""
    n = len(c)
    F = {k: np.zeros(n, dtype=bool) for k in INTRA_PB}
    if n < 3:
        return F
    if n > 6:
        orh = np.max(h[:6])
        i = np.arange(6, n)
        F["ORB"][i] = (c[i] > orh) & (c[i - 1] <= orh)
    hmax = np.maximum.accumulate(h)
    i = np.arange(2, n)
    F["DIP_REV"][i] = (c[i] / hmax[i] - 1 <= -0.01) & (c[i] > c[i - 1]) & (c[i - 1] < c[i - 2])
    if n >= 19:
        hh, ll = _roll(h, 14, np.max), _roll(l, 14, np.min)
        rng = hh - ll
        fast = np.where(rng > 0, (c - ll) / np.where(rng > 0, rng, 1) * 100, 50.0)
        fast[np.isnan(hh)] = np.nan
        k = _roll(fast, 3, np.mean)
        d = _roll(k, 3, np.mean)
        i = np.arange(1, n)
        F["STOCH5"][i] = (k[i] > d[i]) & (k[i - 1] <= d[i - 1]) & (k[i - 1] <= 25)
    if n > 3:
        i = np.arange(3, n)
        F["MOM3"][i] = (c[i] > c[i - 1]) & (c[i - 1] > c[i - 2]) & (c[i - 2] > c[i - 3]) & (c[i] / c[i - 3] - 1 >= 0.005)
    if v is not None:
        cv, cs = np.cumsum(c * v), np.cumsum(v)
        vw = np.where(cs > 0, cv / np.where(cs > 0, cs, 1), np.nan)
        i = np.arange(1, n)
        F["VWAP_RE"][i] = (c[i - 1] < vw[i - 1]) & (c[i] > vw[i])
    return F


def _intra_exit(c, h, l, i, pr, b_end):
    """i 봉 종가에 사서 — 익절/손절/시간/장 끝 → (청산가, 청산 봉). 같은 봉에서 둘 다 닿으면 손절."""
    pe = c[i]
    last = b_end if pr["bars"] == 0 else min(b_end, i + pr["bars"])
    tp = pe * (1 + pr["tpPct"] / 100) if pr["tpPct"] else np.inf
    sl = pe * (1 - pr["sl"] / 100)
    hh, ll = h[i + 1:last + 1], l[i + 1:last + 1]
    xs = np.nonzero(ll <= sl)[0]
    xt = np.nonzero(hh >= tp)[0]
    fs = xs[0] if len(xs) else 10 ** 9
    ft = xt[0] if len(xt) else 10 ** 9
    if fs == 10 ** 9 and ft == 10 ** 9:
        return c[last], last
    return (sl, i + 1 + fs) if fs <= ft else (tp, i + 1 + ft)


def sim_intra(bars5, daily_reg, market, day_key_of=None):
    """bars5: {sym: {t,c,h,l,v}} · daily_reg: {날짜키: 국면}. 단타 매매법이 뜬 모든 봉의 모의 결과 — [day, inst, pb, ex, k0..k3]."""
    cost = COST_RT[market]
    rows = []
    inst = 0
    for si, (s, bd) in enumerate(bars5.items()):
        if not bd or not bd.get("t") or len(bd["t"]) < 500:
            continue
        t = np.asarray(bd["t"], dtype=np.int64)
        if t[0] > 10 ** 11:                         # 밀리초면 초로
            t = t // 1000
        c = np.asarray(bd["c"], dtype=float)
        h = np.asarray(bd.get("h") or bd["c"], dtype=float)
        l = np.asarray(bd.get("l") or bd["c"], dtype=float)
        v = np.asarray(bd["v"], dtype=float) if bd.get("v") and len(bd["v"]) == len(c) else None
        if not (len(h) == len(l) == len(c) == len(t)):
            continue
        day = ((t + TZ_OFF[market]) // 86400).astype(np.int64)
        cut = np.nonzero(np.diff(day))[0] + 1
        starts = np.concatenate([[0], cut])
        ends = np.concatenate([cut, [len(t)]])
        prev_close, closes_d = None, []
        for a, b in zip(starts, ends):
            if b - a < 20:
                prev_close = c[b - 1]
                continue
            dkey = int(pd.Timestamp(int(day[a]) * 86400, unit="s").strftime("%Y%m%d"))
            ma20 = np.mean(closes_d[-20:]) if len(closes_d) >= 20 else None
            closes_d.append(c[b - 1])
            rg = daily_reg.get(dkey)
            if prev_close is None or rg is None:
                prev_close = c[b - 1]
                continue
            up = 1 if (ma20 is not None and prev_close > ma20) else 0
            cc, hh_, ll_ = c[a:b], h[a:b], l[a:b]
            F = intra_fires(cc, hh_, ll_, v[a:b] if v is not None else None)
            n = b - a
            fired_at = {}
            for pb, arr in F.items():
                for i in np.nonzero(arr[: max(0, n - INTRA_MIN_LEFT)])[0]:
                    fired_at.setdefault(int(i), []).append(pb)
            for i, pbs in fired_at.items():
                pe = cc[i]
                if not (pe > 0):
                    continue
                inst += 1
                for pb in pbs:
                    px, xb = _intra_exit(cc, hh_, ll_, i, INTRA_PB[pb], n - 1)
                    rows.append((dkey, inst, si, a + i, a + xb, pb, (px / pe - 1) * 100 - cost, rg, (pe / prev_close - 1) * 100, i * 5, up))
            prev_close = c[b - 1]
    if not rows:
        return pd.DataFrame(columns=["day", "inst", "j", "t", "x", "pb", "ex"])
    df = pd.DataFrame(rows, columns=["day", "inst", "j", "t", "x", "pb", "ex", "reg", "daypct", "tod", "up"])
    df["hd"] = ((df["x"] - df["t"]).clip(1, None) / 78.0).astype(np.float32)   # [V33.618] 보유 5분봉 → 거래일
    ks = intra_keys(df["reg"].values, df["daypct"].values, df["tod"].values, df["up"].values)
    for lv, k in enumerate(ks):
        df["k%d" % lv] = k
    return df


# ── 표 만들기 · 검증 ───────────────────────────────────────────────
def _shrunk_table(df):
    """열쇠 4단 × 매매법 → (n, 성공확률, 평균, 하한). 넓은 칸부터 내려가며 수축한다:
    k0 = '*' · k1 = 국면 · k2 = 국면+2조건 · k3 = 전체 조건. 구체 칸은 표본이 적을수록 부모 칸 값에 가깝다.
    [V33.609] 하한(lcb) = 수축 평균 − 표준오차(표준편차/√(n+k)) — 표본 적은 칸이 우연히 높게 나온 것을 고르지 않게(승자의 저주)."""
    if "hd" not in df.columns:
        df = df.assign(hd=1.0)
    df = df.assign(win=(df["ex"] > 0).astype(np.float32), ex2=df["ex"].astype(float) ** 2)
    tab = {}

    def put(key, n, s, s2, w, hs, pw, pm, ph):
        n = float(n)
        m = (s + K_SHRINK * pm) / (n + K_SHRINK)
        var = max(0.0, s2 / n - (s / n) ** 2) if n > 1 else 9.0
        lcb = m - math.sqrt(var / (n + K_SHRINK))
        hd = (hs + K_SHRINK * ph) / (n + K_SHRINK)   # 평균 보유 거래일(수축)
        tab[key] = (int(n), float((w + K_SHRINK * pw) / (n + K_SHRINK)), float(m), float(lcb), float(max(hd, 0.05)))

    g0 = df.groupby("pb").agg(n=("ex", "size"), s=("ex", "sum"), s2=("ex2", "sum"), w=("win", "sum"), h=("hd", "sum"))
    for pb, r in g0.iterrows():
        put(("*", pb), r["n"], r["s"], r["s2"], r["w"], r["h"], 0.5, 0.0, r["h"] / max(1.0, r["n"]))
    for lv, plv in ((1, 0), (2, 1), (3, 2)):
        col, pcol = "k%d" % lv, "k%d" % plv
        g = df.groupby([col, pcol, "pb"]).agg(n=("ex", "size"), s=("ex", "sum"), s2=("ex2", "sum"), w=("win", "sum"), h=("hd", "sum")).reset_index()
        for r in g.itertuples(index=False):
            k, pk, pb, n, s_, s2, w, h = r
            par = tab.get((pk, pb))
            pw, pm, ph = (par[1], par[2], par[4]) if par else (0.5, 0.0, h / max(1.0, n))
            put((k, pb), n, s_, s2, w, h, pw, pm, ph)
    return tab


# [V33.609] 선택 규칙 후보(미리 고정) — 검증 구간에서 하나를 고르고, 판정은 손대지 않은 마지막 구간에서만 한다.
#   score: 'm' 평균 · 'lcb' 하한 / level: 'fine' 전체 칸 · 'regime' 국면 칸까지만 · 'global' 매매법 전체 성적만
#   [V33.618] 승률 50% 조건 삭제(사용자 결정) — 기대값만 본다. 'mpd'·'lcbpd' = 하루당 평균·하한(보유 기간이 긴 매매법이 한 거래 평균만으로 유리하지 않게).
RULES = [{"score": "m", "level": "fine"}, {"score": "lcb", "level": "fine"}, {"score": "lcb", "level": "regime"}, {"score": "lcb", "level": "global"},
         {"score": "mpd", "level": "fine"}, {"score": "lcbpd", "level": "regime"}]


def score_of(v, score):
    """표 값 (n, w, m, lcb, hd) → 규칙 점수. 워커 pbChoose 와 같은 식."""
    m, lcb, hd = v[2], v[3], max(v[4] if len(v) > 4 else 1.0, 0.05)
    return m if score == "m" else lcb if score == "lcb" else m / hd if score == "mpd" else lcb / hd
LEVEL_COLS = {"fine": ("k3", "k2", "k1", "k0"), "regime": ("k1", "k0"), "global": ("k0",)}
SPLIT = (0.60, 0.80)   # 표 [0,60%) → 규칙 고르기 [60,80%) → 표 [0,80%) → 판정 [80,100%)


def lookup(tab, keys, pb):
    """그 매매법이 있는 가장 구체적인 칸의 값(이미 넓은 칸 쪽으로 수축됨) → (n, w, m, lcb) | None. 워커 pbChoose 와 같은 규칙."""
    for k in keys:
        v = tab.get((k, pb))
        if v is not None:
            return v
    return None


def choose(tab, keys, fired, score="m"):
    """뜬 매매법들 중 점수 > 0 이고 점수가 가장 큰 것 → (pb, n, w, m, lcb, hd) | None. [V33.618] 승률 조건 없음."""
    best, bs = None, None
    for pb in fired:
        v = lookup(tab, keys, pb)
        if v is None:
            continue
        sc = score_of(v, score)
        if sc > 0 and (bs is None or sc > bs):
            best, bs = (pb,) + tuple(v), sc
    return best


def _row_vals(tab, df, rule):
    """행마다 lookup(그 규칙의 칸 단계) 의 (w, 점수) — 벡터화."""
    w = np.full(len(df), np.nan)
    sc = np.full(len(df), np.nan)
    for col in LEVEL_COLS[rule["level"]]:
        need = np.isnan(sc)
        if not need.any():
            break
        got = [tab.get(k) for k in zip(df[col].values[need], df["pb"].values[need])]
        idx = np.nonzero(need)[0]
        sc[idx] = np.array([score_of(g, rule["score"]) if g else np.nan for g in got])
        w[idx] = np.array([g[1] if g else np.nan for g in got])
    return w, sc


def _pick(tab, te, rule):
    """후보(inst)마다 뜬 매매법 중 규칙이 고른 것 · 같은 종목은 앞 거래가 끝나야 다시 산다(실전과 같다)."""
    w, sc = _row_vals(tab, te, rule)
    ok = sc > 0   # [V33.618] 승률 50% 조건 삭제
    sel = te.assign(_s=sc)[ok].sort_values("_s", ascending=False).drop_duplicates("inst").sort_values("t")
    keep, busy = [], {}
    for r in sel[["j", "t", "x"]].itertuples(index=True):
        if busy.get(r.j, -1) >= r.t:
            continue
        keep.append(r.Index)
        busy[r.j] = r.x
    return sel.loc[keep]


BASE_DRAWS = 30   # [V33.613] 공정한 '아무거나' — 후보마다 뜬 매매법 중 무작위 하나 · 같은 겹침 규칙 · 30번 평균


def _nonoverlap(sel):
    keep, busy = [], {}
    for r in sel[["j", "t", "x"]].itertuples(index=True):
        if busy.get(r.j, -1) >= r.t:
            continue
        keep.append(r.Index)
        busy[r.j] = r.x
    return sel.loc[keep]


def fair_base(te, draws=BASE_DRAWS, seed=11):
    """[V33.613] 고른 것과 같은 조건의 기준선: 후보(inst)마다 뜬 매매법 중 ★무작위 하나★ → 같은 종목 겹침 제외 → 평균.
    (V33.609~612 의 '아무거나' 는 겹친 거래까지 전부 평균이라, 추세 종목이 연일 신호를 내면 여러 번 세어 기준이 부풀었다.)"""
    if not len(te):
        return None, None
    rng = np.random.default_rng(seed)
    ms, ns = [], []
    for _ in range(draws):
        sh = te.assign(_r=rng.random(len(te))).sort_values("_r").drop_duplicates("inst").sort_values("t")
        pk = _nonoverlap(sh)["ex"].values.astype(float)
        if len(pk):
            ms.append(pk.mean()); ns.append(len(pk))
    return (round(float(np.mean(ms)), 4) if ms else None), (int(np.mean(ns)) if ns else None)


def _stats(pk, base):
    n = len(pk)
    return {"n": int(n), "mean": round(float(pk.mean()), 4) if n else None, "win": round(float((pk > 0).mean() * 100), 1) if n else None,
            "t": round(float(pk.mean() / (pk.std(ddof=1) / math.sqrt(n))), 2) if n > 2 and pk.std() > 0 else 0.0,
            "base": round(float(base.mean()), 4) if len(base) else None}


def validate(df, timecol, pbs=None):
    """3구간: 표 [0,60%) → 규칙 후보 4개를 [60,80%) 에서 비교해 하나 고름 → 표 [0,80%) → 손대지 않은 [80,100%) 에서만 판정."""
    ts = np.sort(df[timecol].unique())
    if len(ts) < 30:
        return {"pass": False, "why": "기간 부족"}, None
    c1, c2 = ts[int(len(ts) * SPLIT[0])], ts[int(len(ts) * SPLIT[1])]
    tab1 = _shrunk_table(df[df[timecol] < c1])
    va = df[(df[timecol] >= c1) & (df[timecol] < c2)]
    cmp_ = []
    vbase, _vn = fair_base(va)
    for rule in RULES:
        pk = _pick(tab1, va, rule)
        st_ = _stats(pk["ex"].values.astype(float), va["ex"].values.astype(float))
        st_["baseAll"], st_["base"] = st_["base"], vbase
        cmp_.append({"rule": rule, **st_})
    elig = [c for c in cmp_ if c["n"] >= 30 and c["mean"] is not None]
    best = max(elig, key=lambda c: c["mean"]) if elig else cmp_[1]
    rule = best["rule"]
    tab2 = _shrunk_table(df[df[timecol] < c2])
    ho = df[df[timecol] >= c2]
    pk = _pick(tab2, ho, rule)
    st = _stats(pk["ex"].values.astype(float), ho["ex"].values.astype(float))
    hb, hn = fair_base(ho)
    st["baseAll"], st["base"], st["baseN"] = st["base"], hb, hn   # 판정 기준 = 공정한 무작위 기준선 · 옛 '전부 평균' 은 baseAll 로 남긴다
    st.update({"rule": rule, "cut": [str(c1), str(c2)], "valCmp": cmp_, "byPb": {k: int(v) for k, v in pk["pb"].value_counts().items()}})
    st["pass"] = bool(st["n"] >= 30 and st["mean"] > 0 and st["t"] >= PASS_T and st["base"] is not None and st["mean"] > st["base"])
    return st, tab2


def _relevel(df):
    """k0(구체)…k3('*') 를 _shrunk_table 이 기대하는 순서로: k3(구체)…k0('*') → 열 이름 뒤집기."""
    m = {"k0": "k3", "k1": "k2", "k2": "k1", "k3": "k0"}
    return df.rename(columns=m)


def export(tab, pbs, min_n=30, max_bytes=1200000):
    """워커로 보낼 표 — 열쇠마다 매매법별 [n, 성공확률, 평균]. 표본 적은 구체 칸은 버린다(부모가 대신한다).
    워커 상태 한 칸(D1) 크기 한도 때문에 max_bytes 를 넘으면 가장 구체적인 칸의 문턱(min_n)을 올린다."""
    import json
    while True:
        out = {}
        for (k, pb), (n, w, m, lcb, hd) in tab.items():
            if k.count("|") >= 3 and n < min_n:
                continue
            out.setdefault(k, {})[pb] = [n, round(w, 3), round(m, 3), round(lcb, 3), round(hd, 2)]
        if len(json.dumps(out, separators=(",", ":"))) <= max_bytes or min_n > 100000:
            return out
        min_n *= 2


def run(daily, mkt_by_sym, day_key_of, BASE=None, HDR=None, upload=True, log=print, bars5=None, ev_dates=(), oos=None):
    import strategy_router as SR
    for market in ("us", "kr"):
        t0 = time.time()
        P = SR._panel(daily, mkt_by_sym, market, day_key_of)
        if P is None:
            log("   · [매매법시뮬] %s 일봉 부족 — 건너뜀" % market)
            continue
        cm = cand_mask(P, (oos or {}).get(market))
        ddf, reg_now, sig = sim_daily(P, market, ev_dates, cand=cm)
        cand_src = "OMNI-Q 표본 밖 상위 20%"
        if cm is None or len(ddf) < CAND_MIN_ROWS:
            log("   · [매매법시뮬] %s 후보 거름 %s → 전 종목으로" % (market, "점수 없음" if cm is None else "표본 %d 부족" % len(ddf)))
            ddf, reg_now, sig = sim_daily(P, market, ev_dates, sig=sig)
            cand_src = "전 종목(OMNI-Q 과거 점수 없음·부족)"
        ddf = _relevel(ddf)
        dst, _ = validate(ddf, "t")
        dst["cand"] = cand_src
        try:
            dst["exitDiag"] = exit_diag(P, market, sig, cm if cand_src.startswith("OMNI") else None)
            ed = dst["exitDiag"]
            log("   · [매매법시뮬] %s 손절 진단(기록만) — " % market + " · ".join(
                "%s 지금 %s%%/%s%% 넓게 %s%%/%s%%" % (k, v["cur"][1], v["cur"][2], v["wide"][1], v["wide"][2]) for k, v in list(ed.items())[:6]))
        except Exception as e:  # noqa: BLE001
            log("   ⚠️ [매매법시뮬] 손절 진단 실패 %s" % e)
        syms_all = list(P["close"].columns)
        cross = {pb: [syms_all[j] for j in np.nonzero(sig[pb].values[-1])[0]] for pb in CROSS_PB if pb in sig}
        dtab = _shrunk_table(ddf)                       # 실전 표는 전 기간으로
        reg_series, _ = _regime(P["close"])
        reg_by_day = {int(d): r for d, r in zip(P["close"].index, reg_series)}
        ist, itab = {"pass": False, "why": "5분봉 없음"}, {}
        b5 = {s: v for s, v in (bars5 or {}).items() if mkt_by_sym.get(s) == market}
        if b5:
            idf = sim_intra(b5, reg_by_day, market)
            if len(idf):
                idf = _relevel(idf)
                ist, _ = validate(idf, "day")
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
                        "daily": {"val": dst, "table": export(dtab, list(DAILY_PB)), "pb": DAILY_PB, "cross": cross},
                        "intra": {"val": ist, "table": export(itab, list(INTRA_PB)), "pb": INTRA_PB}}
                r = requests.post(BASE + "/api/playbook", headers=HDR, json=body, timeout=180)
                log("   · [매매법시뮬] %s 업로드 %s" % (market, r.status_code))
            except Exception as e:  # noqa: BLE001
                log("   ⚠️ [매매법시뮬] 업로드 실패 %s" % e)
