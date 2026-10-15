"""[V33.602 · Phase B+C] 매매법 선택 AI(Strategy-Router) — 표본 생성 + 걷기 검증 · GitHub Actions(무료)에서 돈다. ★주문 영향 없음(그림자)★

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
         pass 여도 이번 단계는 기록만 한다(그림자 4주 · 실전 연결은 사용자 결정).
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
REGIMES = ("BULL", "NEUTRAL", "BEAR")


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
    return pd.Series(reg, index=close.index), r.values


def _atr_pct(P):
    c, h, l = P["close"], P["high"], P["low"]
    pc = c.shift(1)
    tr = np.maximum(h - l, np.maximum((h - pc).abs(), (l - pc).abs()))
    return (tr.rolling(14, min_periods=14).mean() / c * 100).values


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


def run(daily, mkt_by_sym, day_key_of, BASE=None, HDR=None, upload=True, log=print):
    for market in ("us", "kr"):
        t0 = time.time()
        P = _panel(daily, mkt_by_sym, market, day_key_of)
        if P is None:
            log("   · [매매법AI] %s 일봉 부족 — 건너뜀" % market)
            continue
        df, sig, reg = build_samples(P, market)
        T = P["close"].shape[0]
        wf = walk_forward(df, T)
        # 매매법별 성적(최근 500일 · 국면별) — 화면·사람 검토용
        rec = df[df["i"] >= T - BT_DAYS]
        table = {}
        for sid, g in rec.groupby("sid"):
            table[sid] = {"all": _stats(g["ex"]), **{rg: _stats(g[g["reg"] == rg]["ex"]) for rg in REGIMES if (g["reg"] == rg).any()}}
        # 오늘 선택(그림자) — 지금 국면에서 기대수익 > 0 인 매매법의 마지막 날 신호
        est = _shrunk(df[df["x"] < T - 1])
        now = str(reg.iloc[-1])
        syms = list(P["close"].columns)
        picks = {}
        for s in C.CATALOG:
            mu, n = est.get((s["id"], now), (0.0, 0))
            if mu <= 0 or n < MIN_N_SEL:
                continue
            for j in np.nonzero(sig[s["id"]].values[-1])[0]:
                sym = syms[j]
                if sym not in picks or picks[sym]["mu"] < mu:
                    picks[sym] = {"sid": s["id"], "mu": round(mu, 4), "n": n}
        sel = sorted(({"sid": k[0], "mu": round(v[0], 4), "n": v[1]} for k, v in est.items() if k[1] == now and v[1] >= MIN_N_SEL),
                     key=lambda r: -r["mu"])
        day = str(P["close"].index[-1])
        log("   · [매매법AI] %s 종목 %d · 표본 %d · 국면 %s · 걷기검증 n=%s 평균 %s%% t=%s (전부사기 %s%%) → %s · 오늘 후보 %d (%.0fs)" % (
            market, len(syms), len(df), now, wf["router"]["n"], wf["router"]["mean"], wf["router"]["t"], wf["baseline"]["mean"],
            "통과" if wf["pass"] else "미통과", len(picks), time.time() - t0))
        if upload and BASE:
            try:
                import requests
                body = {"mkt": market, "day": day, "regime": now, "nSamples": int(len(df)), "wf": wf, "table": table,
                        "ranking": sel[:17], "picks": dict(sorted(picks.items(), key=lambda kv: -kv[1]["mu"])[:40])}
                r = requests.post(BASE + "/api/strategy-router", headers=HDR, json=body, timeout=120)
                log("   · [매매법AI] %s 업로드 %s" % (market, r.status_code))
            except Exception as e:  # noqa: BLE001
                log("   ⚠️ [매매법AI] 업로드 실패 %s" % e)
