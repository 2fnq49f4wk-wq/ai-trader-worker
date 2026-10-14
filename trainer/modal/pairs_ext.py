"""[V33.594] 페어(PR_OU) — 전 종목 공적분 페어 + 표본 밖 걷기 검증 · GitHub Actions(무료)에서 돈다.

왜: 워커 안 패널(rvBuildPanel)은 벽시계 12초에 잘려 63종목 · 13쌍뿐이었다 → PR_OU 체결 0건(원장 전 기간).
    워커 CPU 를 더 쓰지 않고(사용자: "cpu 낭비 줄이고 · 외부 학습은 무료로") OMNI-Q 가 이미 받아 둔 전 종목 일봉으로 만든다.

★미리 고정(데이터 보기 전 · 바꾸려면 사용자 결정)★
  형성   직전 120거래일 로그종가 · 최근 60일 수익률 상관 ≥ 0.70 인 같은 시장 최상위 짝 1개 · OLS(logA = α + β·logB)
         β 0.05~20 · 스프레드 분산비 VR(5) ≤ 0.85 · OU 반감기 2~30일 (워커 RVSTRAT.pr 와 같은 문턱)
  진입   z = (스프레드 − 형성기 평균)/형성기 표준편차 ≤ −2 · A 종가 > MA50×0.93 · ★신호 다음 날 종가에 산다★(앞을 보지 않는다)
  청산   z ≥ 0 이 된 다음 날 종가 · 아니면 10거래일째 종가
  잣대   같은 기간 그 시장 동일가중 평균 대비 초과수익 − 왕복비용(미 0.10% · 한 0.30%)
  걷기   20거래일마다 다시 형성(형성 구간과 거래 구간이 겹치지 않는다) · 최근 2년
  관문   거래 ≥ 100 · 평균 순초과 > 0 · t ≥ 2.0 → pass. 못 넘으면 워커가 페어로 사지 않는다(패널 기록만).
"""
import math
import time

import numpy as np

FORM = 120
CORR_WIN = 60
MIN_CORR = 0.70
MAX_VR = 0.85
HL_MIN, HL_MAX = 2.0, 30.0
ENTRY_Z = -2.0
MAX_HOLD = 10
STEP = 20
BT_DAYS = 500
COST = {"us": 0.10, "kr": 0.30}
PASS = {"minN": 100, "minT": 2.0}


def _wide(daily, mkt_by_sym, market, day_key_of, max_days=760):
    import pandas as pd
    cols = {}
    for s, bd in daily.items():
        if mkt_by_sym.get(s, "us") != market or not bd or not bd.get("t") or s.startswith("^"):
            continue
        if len(bd["t"]) < FORM + 60:
            continue
        idx = [day_key_of(t) for t in bd["t"]]
        c = pd.Series(np.asarray(bd["c"], dtype=float), index=idx)
        c = c[~c.index.duplicated(keep="last")]
        cols[s] = c
    if len(cols) < 30:
        return None
    df = pd.DataFrame(cols).sort_index()
    df = df.iloc[-max_days:]
    df = df.where(df > 1.0)
    return df


def _vr(sp, k=5):
    d1 = np.diff(sp)
    dk = sp[k:] - sp[:-k]
    v1 = np.var(d1)
    return float(np.var(dk) / (k * v1)) if v1 > 1e-12 else None


def _hl(sp):
    x = sp[:-1] - sp[:-1].mean()
    y = np.diff(sp)
    den = float((x * x).sum())
    if den <= 1e-12:
        return None
    b = float((x * y).sum() / den)
    if b >= 0:
        return None
    return float(-math.log(2) / math.log(1 + b)) if b > -1 else None


def form_pairs(L, end):
    """L: 로그종가 넓은 표(numpy · 일×종목) · end: 형성 구간 끝(미포함). → {i: (j, alpha, beta, mu, sd, corr, hl, vr)}"""
    W = L[end - FORM:end]
    ok = ~np.isnan(W).any(axis=0)
    idx = np.where(ok)[0]
    if len(idx) < 30:
        return {}
    Wi = W[:, idx]
    R = np.diff(Wi[-CORR_WIN - 1:], axis=0)
    R = (R - R.mean(0)) / (R.std(0) + 1e-12)
    C = (R.T @ R) / R.shape[0]
    np.fill_diagonal(C, -1)
    out = {}
    for a in range(len(idx)):
        order = np.argsort(-C[a])[:3]
        for b in order:
            c = float(C[a, b])
            if c < MIN_CORR:
                break
            y, x = Wi[:, a], Wi[:, b]
            xm, ym = x.mean(), y.mean()
            vx = float(((x - xm) ** 2).sum())
            if vx <= 1e-12:
                continue
            beta = float(((x - xm) * (y - ym)).sum() / vx)
            if not (0.05 < beta <= 20):
                continue
            alpha = float(ym - beta * xm)
            sp = y - alpha - beta * x
            vr = _vr(sp)
            if vr is None or vr > MAX_VR:
                continue
            hl = _hl(sp)
            if hl is None or not (HL_MIN <= hl <= HL_MAX):
                continue
            out[int(idx[a])] = (int(idx[b]), alpha, beta, float(sp.mean()), float(sp.std() + 1e-12), c, hl, vr)
            break
    return out


def backtest(df, market):
    P = df.values
    L = np.log(P)
    T, N = L.shape
    mkt_ret = np.nanmean(np.diff(P, axis=0) / P[:-1], axis=1)   # 동일가중 일간 수익
    ma50 = df.rolling(50).mean().values
    cost = COST[market]
    rets = []
    start = max(FORM + 1, T - BT_DAYS)
    for f in range(start, T - 2, STEP):
        pairs = form_pairs(L, f)
        busy = {}
        for t in range(f, min(f + STEP, T - 2)):
            for a, (b, al, be, mu, sd, _c, _h, _v) in pairs.items():
                if busy.get(a, -1) >= t:
                    continue
                la, lb = L[t, a], L[t, b]
                if np.isnan(la) or np.isnan(lb):
                    continue
                z = (la - al - be * lb - mu) / sd
                if z > ENTRY_Z or not (P[t, a] > ma50[t, a] * 0.93):
                    continue
                e = t + 1                       # 다음 날 종가에 산다
                x = None
                for k in range(e, min(e + MAX_HOLD, T - 1)):
                    zk = (L[k, a] - al - be * L[k, b] - mu) / sd
                    if zk >= 0:
                        x = k + 1               # 다음 날 종가에 판다
                        break
                if x is None:
                    x = min(e + MAX_HOLD, T - 1)
                x = min(x, T - 1)
                if np.isnan(P[x, a]) or np.isnan(P[e, a]):
                    continue
                raw = (P[x, a] / P[e, a] - 1) * 100
                mk = (np.prod(1 + np.nan_to_num(mkt_ret[e:x])) - 1) * 100
                rets.append((raw - mk - cost, raw - cost))
                busy[a] = x
    if not rets:
        return {"n": 0, "pass": False}
    ex = np.array([r[0] for r in rets])
    raw = np.array([r[1] for r in rets])
    n = len(ex)
    t = float(ex.mean() / (ex.std(ddof=1) / math.sqrt(n))) if n > 2 and ex.std() > 0 else 0.0
    ok = n >= PASS["minN"] and ex.mean() > 0 and t >= PASS["minT"]
    return {"n": n, "meanEx": round(float(ex.mean()), 4), "t": round(t, 2), "win": round(float((ex > 0).mean() * 100), 1),
            "meanRaw": round(float(raw.mean()), 4), "pass": bool(ok), "days": BT_DAYS, "cost": cost}


def run(daily, mkt_by_sym, day_key_of, BASE=None, HDR=None, upload=True, log=print):
    for market in ("us", "kr"):
        t0 = time.time()
        df = _wide(daily, mkt_by_sym, market, day_key_of)
        if df is None:
            log("   · [페어] %s 일봉 부족 — 건너뜀" % market)
            continue
        bt = backtest(df, market)
        L = np.log(df.values)
        T = L.shape[0]
        cur = form_pairs(L, T)
        syms = list(df.columns)
        ma50 = df.rolling(50).mean().values[-1]
        out = {}
        for a, (b, al, be, mu, sd, c, hl, vr) in cur.items():
            z = (L[-1, a] - al - be * L[-1, b] - mu) / sd
            if np.isnan(z):
                continue
            out[syms[a]] = {"b": syms[b], "alpha": round(al, 6), "beta": round(be, 5), "mu": round(mu, 6), "sd": round(sd, 6),
                            "corr": round(c, 3), "hl": round(hl, 1), "vr": round(vr, 3), "z": round(float(z), 3),
                            "ma50ok": bool(df.values[-1, a] > ma50[a] * 0.93) if not np.isnan(ma50[a]) else False}
        day = str(df.index[-1])
        log("   · [페어] %s 종목 %d · 페어 %d · z≤−2 %d · 걷기검증 n=%s 순초과 %s%% t=%s 승률 %s%% → %s (%.0fs)" % (
            market, len(syms), len(out), sum(1 for v in out.values() if v["z"] <= ENTRY_Z), bt.get("n"), bt.get("meanEx"), bt.get("t"),
            bt.get("win"), "통과" if bt.get("pass") else "미통과", time.time() - t0))
        if upload and BASE:
            try:
                import requests
                r = requests.post(BASE + "/api/rv-pairs", headers=HDR, json={"mkt": market, "day": day, "pairs": out, "bt": bt,
                                                                            "rule": {"form": FORM, "entryZ": ENTRY_Z, "maxHold": MAX_HOLD}},
                                  timeout=120)
                log("   · [페어] %s 업로드 %s" % (market, r.status_code))
            except Exception as e:  # noqa: BLE001
                log("   ⚠️ [페어] 업로드 실패 %s" % e)
