"""[V33.531] ★포트폴리오 실험실 — Vibe-Trading(HKUDS, MIT) 부품 + Qlib 의 표준 구성(Alpha158 LightGBM + TopK-Dropout)★
업로드하지 않는다(연구용). 사용자: "최대한 많은 요소를 홍콩대 vibe 에서 가지고 와라".

원장 감사(V33.530)가 말한 두 가지 병 — ① 고른 종목이 시장보다 못하다(미국 20일 −1.35%p) ② 회전이 너무 많아 비용이 수익을 먹는다
(미국 4개월 40배 · 비용 ≈ 실현 수익) — 를 ★구조로★ 고치는 방식이 Qlib 의 TopK-Dropout 이다: 매일 전 종목을 모델 점수로 줄 세우고
상위 K 개를 들고 있다가, 하루에 최하위 n_drop 개만 갈아 끼운다(회전 상한이 구조적으로 정해진다). 사건(신호)이 아니라 순위로 산다.

여기서 쓰는 Vibe-Trading 부품(vt/, MIT · qlib158 Apache):
  · 피처: src/factors/zoo/qlib158(≈150) + academic(BAB·Carhart·52주고점·비유동성·왜도·단기반전 …)
  · 검증 분할: src/quantlib/crossvalidation.purged_walk_forward_splits(퍼지 + 엠바고 — 겹친 라벨 누출 제거)
  · 비중: backtest/optimizers(동일변동성 · 위험균형) vs 동일비중
  · 판정: src/quantlib/multipletesting(확률적·디플레이티드 샤프 — 여러 구성을 시험한 만큼 문턱을 올린다) · backtest/validation.bootstrap_sharpe_ci
★미리 정한 통과 기준★(구성별 · 시장별, 비용 뺀 뒤 · 동일비중 유니버스 대비 초과수익 계열로):
  시험 구간(≥3) 중 ≥max(3, 75%) 구간 초과 > 0 · 디플레이티드 샤프 확률 ≥ 0.95(시험한 구성 수 반영) · 최대낙폭이 기준보다 5%p 넘게 나쁘지 않음.
"""
from __future__ import annotations

import math
import os
import sys
import time

import numpy as np

H = 5                     # 라벨 지평(일) — 결정 다음날 종가 → H일 뒤 종가
COST = {"us": {"buy": 0.0005, "sell": 0.0005}, "kr": {"buy": 0.00015 + 0.001, "sell": 0.00015 + 0.001 + 0.002}}   # 수수료+슬리피지(+한국 매도세)
CONFIGS = [(K, d, w) for K in (10, 20) for d in (2,) for w in ("equal", "invvol", "riskparity")]
FOLDS = 5          # 확장 전진이라 첫 구간은 학습이 짧아 보통 빠진다 → 시험 구간 ≈4


def _vt():
    import factor_screen
    p = factor_screen._vt_path()
    if p and p not in sys.path:
        sys.path.insert(0, p)
    return p


def _features(P, log):
    """Vibe 동물원 qlib158 + academic → 날짜×종목 순위(0~1) 묶음. 실패·시간초과 팩터는 뺀다."""
    import factor_screen as fs
    old = fs.ZOOS
    fs.ZOOS = ("qlib158", "academic")
    try:
        facs = fs.load_factors(log)
    finally:
        fs.ZOOS = old
    avail = {"open", "high", "low", "close", "volume", "vwap", "amount", "returns"}
    out, names = [], []
    t0 = time.time()
    for fid, fn, need in facs:
        if not need <= avail:
            continue
        try:
            F = fn({k: P[k] for k in avail})
        except Exception:  # noqa: BLE001
            continue
        if F is None or getattr(F, "shape", (0, 0))[1] < 20:
            continue
        F = F.replace([np.inf, -np.inf], np.nan).reindex_like(P["close"])
        out.append(F.rank(axis=1, pct=True).values.astype(np.float32))
        names.append(fid)
    log("      피처 %d개 (%.0fs)" % (len(names), time.time() - t0))
    return np.stack(out, axis=2) if out else None, names


def _topk_dropout(score_row, held, K, n_drop):
    """Qlib TopkDropoutStrategy 와 같은 생각: 보유 중 순위 밖으로 밀린 것 최대 n_drop 개만 팔고, 비지 않은 최상위로 채운다."""
    order = [j for j in np.argsort(-score_row) if np.isfinite(score_row[j])]
    rank = {j: r for r, j in enumerate(order)}
    top = set(order[:K])
    out_of_top = sorted([j for j in held if j not in top], key=lambda j: -rank.get(j, 10 ** 9))
    sell = set(out_of_top[:n_drop])
    keep = [j for j in held if j not in sell and j in rank]
    buy = [j for j in order if j not in held][: max(0, K - len(keep))]
    return set(keep) | set(buy)


def _maxdd(eq):
    peak = np.maximum.accumulate(eq)
    return float(np.max(1 - eq / peak)) if len(eq) else 0.0


def run_lab(daily, mkt_by_sym, day_key_of, log=print):
    import lightgbm as lgb
    import pandas as pd
    import factor_screen as fs
    _vt()
    from src.quantlib.crossvalidation import purged_walk_forward_splits
    from src.quantlib import multipletesting as mt
    from backtest.validation import bootstrap_sharpe_ci
    from backtest.optimizers import equal_volatility as ev, risk_parity as rp
    t_all = time.time()
    log("   ── [포트폴리오실험실] Vibe 동물원(qlib158·academic) → LightGBM 순위 → TopK-Dropout · 비중(동일·동일변동성·위험균형) · 퍼지 전진 %d구간 ──" % FOLDS)
    verdicts = {}
    for mk in ("us", "kr"):
        P = fs.build_wide(daily, mkt_by_sym, mk, day_key_of)
        if P is None:
            log("   · %s 종목 부족 — 생략" % mk)
            continue
        C = P["close"]
        D, S = C.shape
        log("   · %s %d일 × %d종목" % (mk, D, S))
        X, names = _features(P, log)
        if X is None:
            continue
        r1 = (C.shift(-1) / C - 1.0).values                      # t → t+1 수익(포트폴리오 일별)
        fwd = (C.shift(-(H + 1)) / C.shift(-1) - 1.0)           # 라벨: t+1 → t+1+H
        y = fwd.rank(axis=1, pct=True).values
        valid_day = np.isfinite(y).sum(axis=1) >= 20
        days = np.where(valid_day & (np.arange(D) >= 120))[0]   # 앞 120일은 피처 예열
        if len(days) < 200:
            log("   · %s 표본일 부족(%d) — 생략" % (mk, len(days)))
            continue
        # 날짜 단위로 쪼갠다(같은 날 종목들은 한 덩어리) — 라벨 끝 = 날짜 위치 + H + 1
        lab_end = np.arange(len(days)) + H + 1
        splits = list(purged_walk_forward_splits(len(days), label_end_times=lab_end, n_folds=FOLDS, embargo_fraction=0.02, expanding=True))
        scores = np.full((D, S), np.nan, dtype=np.float32)
        fold_of_day = np.full(D, -1)
        for fi, sp in enumerate(splits):
            tr_days, te_days = days[sp.train], days[sp.test]
            Xtr = X[tr_days].reshape(-1, X.shape[2]); ytr = y[tr_days].reshape(-1)
            m = np.isfinite(ytr)
            if m.sum() < 5000:
                continue
            bst = lgb.train({"objective": "regression", "learning_rate": 0.05, "num_leaves": 31, "min_data_in_leaf": 200,
                             "feature_fraction": 0.8, "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 1.0,
                             "verbose": -1, "seed": 7, "num_threads": int(os.environ.get("OMNI_THREADS", "8"))},
                            lgb.Dataset(Xtr[m], label=ytr[m]), num_boost_round=300)
            Xte = X[te_days].reshape(-1, X.shape[2])
            scores[te_days] = bst.predict(Xte).reshape(len(te_days), S).astype(np.float32)
            fold_of_day[te_days] = fi
            # 그 구간 순위 IC(검증) — 모델이 실제로 줄을 세우는지 먼저 본다
            ic = []
            for d in te_days:
                a, b = scores[d], y[d]
                ok = np.isfinite(a) & np.isfinite(b)
                if ok.sum() >= 20:
                    ic.append(np.corrcoef(pd.Series(a[ok]).rank(), pd.Series(b[ok]).rank())[0, 1])
            log("      구간%d 학습일 %d · 시험일 %d(퍼지 %d · 엠바고 %d) · 순위IC %.4f" % (fi + 1, len(tr_days), len(te_days), sp.purged, sp.embargoed, float(np.nanmean(ic)) if ic else float("nan")))
        test_days = [d for d in range(D) if fold_of_day[d] >= 0 and d + 2 < D]
        if len(test_days) < 60:
            continue
        idx = pd.to_datetime([str(k) for k in C.index])
        ret_df = pd.DataFrame(r1, index=idx, columns=C.columns).shift(1)   # 그날 종가까지 실현된 1일 수익(비중 계산용 · 미래 안 봄)
        bench = np.nanmean(np.where(np.isfinite(r1[np.array(test_days) + 1]), r1[np.array(test_days) + 1], np.nan), axis=1)
        results = []
        for (K, nd, wmode) in CONFIGS:
            held, w_prev = set(), np.zeros(S)
            pos_rows = []
            for d in test_days:
                held = _topk_dropout(scores[d], held, K, nd)
                row = np.zeros(S); row[list(held)] = 1.0
                pos_rows.append(row)
            pos = pd.DataFrame(np.array(pos_rows), index=idx[test_days], columns=C.columns)
            if wmode == "invvol":
                W = ev.optimize(ret_df.loc[:idx[test_days[-1]]], pos, pos.index, lookback=60)
            elif wmode == "riskparity":
                W = rp.optimize(ret_df.loc[:idx[test_days[-1]]], pos, pos.index, lookback=60)
            else:
                W = pos
            W = W.fillna(0.0).values
            W = W / np.maximum(W.sum(axis=1, keepdims=True), 1e-12)
            net, turn = [], []
            for i, d in enumerate(test_days):
                w = W[i]
                rr = r1[d + 1]                         # 결정 d(종가) → 다음날 종가에 체결 → 그 다음날까지 보유: 보수적으로 d+1 → d+2
                gross = float(np.nansum(w * np.where(np.isfinite(rr), rr, 0.0)))
                dw = w - w_prev
                cost = float(np.sum(np.clip(dw, 0, None)) * COST[mk]["buy"] + np.sum(np.clip(-dw, 0, None)) * COST[mk]["sell"])
                net.append(gross - cost); turn.append(float(np.sum(np.abs(dw))) / 2)
                # 다음날 비중은 가격 변동만큼 흘러간다
                g = w * (1 + np.where(np.isfinite(rr), rr, 0.0)); w_prev = g / max(g.sum(), 1e-12)
            net = np.array(net); ex = net - np.nan_to_num(bench)
            folds = [fold_of_day[d] for d in test_days]
            per = []
            for f in sorted(set(folds)):
                msk = np.array([x == f for x in folds])
                per.append(float(ex[msk].mean() * 252))
            sr = float(mt.sharpe_ratio(ex)) * math.sqrt(252) if len(ex) > 2 else 0.0
            eq, eqb = np.cumprod(1 + net), np.cumprod(1 + np.nan_to_num(bench))
            results.append({"K": K, "nd": nd, "w": wmode, "annNet": float(net.mean() * 252), "annBench": float(np.nanmean(bench) * 252),
                            "annEx": float(ex.mean() * 252), "srEx": sr, "srDaily": float(mt.sharpe_ratio(ex)), "foldEx": per,
                            "turn": float(np.mean(turn)), "mdd": _maxdd(eq), "mddB": _maxdd(eqb), "n": len(ex), "ex": ex})
        srs = [r["srDaily"] for r in results]
        sd_tr = float(np.std(srs, ddof=1)) if len(srs) > 1 else 0.0
        log("   ── [포트폴리오실험실] %s 결과(시험일 %d · 비용 뺀 뒤 · 기준=유니버스 동일비중) ──" % (mk, len(test_days)))
        log("      %-22s %8s %8s %8s %6s %7s %7s %7s  %s" % ("구성", "연수익", "기준", "초과", "샤프x", "일회전", "낙폭", "기준낙폭", "구간별 초과(연)"))
        best = None
        for r in results:
            from scipy.stats import skew, kurtosis
            ex = r["ex"]
            dsr = mt.deflated_sharpe_ratio(r["srDaily"], n_trials=len(results), n_observations=len(ex), trial_sharpe_std=max(sd_tr, 1e-6),
                                           skew=float(skew(ex)), kurtosis=float(kurtosis(ex, fisher=False)))
            p_dsr = float(dsr.deflated_sharpe_ratio)   # Vibe multipletesting — 시험한 구성 수만큼 기대 최대 샤프를 빼고 남는 확률
            r["dsr"] = p_dsr
            nf = len(r["foldEx"])
            r["pass"] = bool(nf >= 3 and sum(1 for x in r["foldEx"] if x > 0) >= max(3, math.ceil(0.75 * nf)) and p_dsr >= 0.95 and r["mdd"] <= r["mddB"] + 0.05)
            log("      K%-3d drop%d %-11s %+7.1f%% %+7.1f%% %+7.1f%% %6.2f %6.1f%% %6.1f%% %6.1f%%  %s  DSR %.2f%s" % (
                r["K"], r["nd"], r["w"], r["annNet"] * 100, r["annBench"] * 100, r["annEx"] * 100, r["srEx"], r["turn"] * 100,
                r["mdd"] * 100, r["mddB"] * 100, " ".join("%+.0f%%" % (x * 100) for x in r["foldEx"]), p_dsr, "  ★통과" if r["pass"] else ""))
            if r["pass"] and (best is None or r["srEx"] > best["srEx"]):
                best = r
        try:
            if best is not None:
                ci = bootstrap_sharpe_ci(pd.Series(np.cumprod(1 + best["ex"])), n_bootstrap=500)
                log("      최선 통과 구성 K%d %s — 초과 샤프 부트스트랩 95%%CI %s" % (best["K"], best["w"], {k: (round(v, 2) if isinstance(v, float) else v) for k, v in ci.items() if not isinstance(v, (list, tuple, np.ndarray))}))
        except Exception as e:  # noqa: BLE001
            log("      부트스트랩 실패: %s" % e)
        verdicts[mk] = None if best is None else {k: best[k] for k in ("K", "nd", "w", "annEx", "srEx", "dsr", "turn")}
        log("      결론(%s): %s" % (mk, "통과 구성 없음 → 운영 반영 안 함" if best is None else "★통과★ " + str(verdicts[mk])))
    log("   · 포트폴리오 실험실 끝 %.0fs" % (time.time() - t_all))
    return verdicts
