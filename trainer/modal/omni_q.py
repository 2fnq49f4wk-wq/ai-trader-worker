"""[V33.535] ★OMNI-Q — Qlib 표준 머리(Vibe 동물원 피처 166 × LightGBM 순위) · 실력 증명 관문★

왜: OMNI 의 옛 발언 관문(상위 ≥10% 정밀도 하한 ≥ 60%)은 공개 데이터로 도달할 수 없는 기준이었다.
  가장 강한 공개 표준(Qlib LightGBM + Alpha158/101 류)을 우리 12년 일봉으로 표본 밖 검정하면(run 37762301209)
  상위 10% 의 '같은 날 동료 중앙값을 이긴 비율' 이 미국 52.1%(t 7.5) · 한국 53.6%(t 16) — 매우 확실한 실력이지만 60% 와는 거리가 멀다.
  (IC r 이면 상위10% 승률 ≈ Φ(1.75r): 60% 는 r≈0.15 — 어떤 공개 일봉 모델도 못 낸다.) 지금 OMNI 머리는 49~52%, t<1.4.
  사용자 결정(10/08): 60% 정밀도 대신 ★실력 증명 관문★ 으로 교체.

★관문(미리 등록 · 셋 다 통과해야 발언)★
  ① 통계적 실력 — 표본 밖(퍼지 전진) 상위 10% 의 동료 중앙값 승률: 95% 하한 > 50% 이고 t ≥ 3 (날짜 단위 t)
  ② 비용 뺀 수익 — 상위 10% 동일비중을 H일마다 갈아탈 때, 회전 비용 뺀 '유니버스 동일비중 대비 초과' 가 시험 구간의 ≥ 75%(최소 3)에서 > 0
  ③ 라이브 전진 — 학습기가 매 회차 올린 '그날 상위 10%' 를 워커가 ★덮어쓰기 금지★ 장부로 보관하고, H일 뒤 실제 가격으로 채점:
     채점된 날 ≥ 30 · 95% 하한 > 50%
  발언하면 워커는 ★좁히기만★ 한다: 신규 추세·스냅 진입 중 OMNI-Q 하위 절반을 막는다(OMNIQ_LOW). 넓히는 일은 없다.
"""
from __future__ import annotations

import math
import time

import numpy as np

H = 5
Q = 0.10
FOLDS = 5
G1_T = 3.0
G2_FRAC = 0.75
G2_MIN = 3
G3_MIN_DAYS = 30
BAND = 0.25          # [반복 2] ② 보유 띠: 상위 10% 로 들어가 상위 25% 밖으로 밀려야 교체(Qlib TopK-Dropout 의 회전 억제)
ZOOS_Q = ("qlib158", "academic", "alpha101")   # [반복 2] alpha101 추가 — 12년 선별에서 한국 상위 통과(alpha101_040·044 t 9~10)
COST_RT = {"us": 0.0005 + 0.0005, "kr": (0.00015 + 0.001) + (0.00015 + 0.001 + 0.002)}   # 왕복(실험실 COST 와 같다)


def _lgb_params(seed=7):
    import os
    return {"objective": "regression", "learning_rate": 0.05, "num_leaves": 31, "min_data_in_leaf": 200,
            "feature_fraction": 0.8, "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 1.0,
            "verbose": -1, "seed": seed, "num_threads": int(os.environ.get("OMNI_THREADS", "8"))}


def beat_rate(scores, y, days, q=Q):
    """날마다 점수 상위 q 가 y(동료 순위 0~1) > 0.5 인 비율 → (평균, 표준오차, t, 날 수)."""
    per = []
    for d in days:
        a, b = scores[d], y[d]
        ok = np.isfinite(a) & np.isfinite(b)
        if ok.sum() < 20:
            continue
        aa, bb = a[ok], b[ok]
        k = max(1, int(round(len(aa) * q)))
        top = np.argsort(-aa)[:k]
        per.append(float(np.mean(bb[top] > 0.5)))
    v = np.array(per)
    if len(v) < 2:
        return {"mu": None, "lb": None, "t": None, "days": int(len(v))}
    mu, se = float(v.mean()), float(v.std(ddof=1) / math.sqrt(len(v)))
    return {"mu": round(mu, 4), "lb": round(mu - 1.96 * se, 4), "t": round((mu - 0.5) / se, 2) if se > 0 else None, "days": int(len(v))}


def gate1(br):
    return bool(br["lb"] is not None and br["lb"] > 0.5 and br["t"] is not None and br["t"] >= G1_T)


def decile_excess(scores, fwd, days, cost_rt, q=Q, step=H, band=None):
    """H일마다 다시 보는 상위 q 동일비중의 '유니버스 동일비중 대비 초과' (회전 비용 뺀 뒤) — 기간 목록.
    band=None: 매번 상위 q 로 통째 교체. band=b: 보유 종목은 상위 b 안에 있는 한 유지하고, 빈자리만 상위 q 의 최상위로 채운다."""
    prev, xs = None, []
    for d in days[::step]:
        a, r = scores[d], fwd[d]
        ok = np.isfinite(a) & np.isfinite(r)
        if ok.sum() < 20:
            continue
        idx = np.where(ok)[0]
        k = max(1, int(round(len(idx) * q)))
        order = idx[np.argsort(-a[idx])]
        if band is None or prev is None:
            top = set(order[:k].tolist())
        else:
            kb = max(k, int(round(len(idx) * band)))
            keep = prev & set(order[:kb].tolist())
            top = set(keep)
            for j in order:
                if len(top) >= k:
                    break
                top.add(int(j))
        turn = 1.0 if prev is None else len(top - prev) / float(k)
        xs.append(float(np.mean(r[list(top)]) - np.mean(r[idx])) - turn * cost_rt)
        prev = top
    return xs


def gate2(fold_x):
    vals = [x for x in fold_x if x is not None]
    pos = sum(1 for x in vals if x > 0)
    need = max(G2_MIN, int(math.ceil(G2_FRAC * len(vals))))
    return bool(len(vals) >= G2_MIN and pos >= need), pos, need


def gate3(picks, C, y_rank, dk_index):
    """라이브 장부 채점 — picks: [{day, top:[sym]}]. y_rank: 날짜×종목 동료 순위(라벨과 같은 정의). 채점 가능한 날만."""
    per = []
    col = {s: j for j, s in enumerate(C.columns)}
    for p in picks or []:
        d = dk_index.get(str(p.get("day")))
        if d is None:
            continue
        b = y_rank[d]
        js = [col[s] for s in (p.get("top") or []) if s in col and np.isfinite(b[col[s]])]
        if len(js) < 3:
            continue
        per.append(float(np.mean(b[js] > 0.5)))
    v = np.array(per)
    if len(v) < 2:
        return {"days": int(len(v)), "mu": None, "lb": None, "ok": False}
    mu, se = float(v.mean()), float(v.std(ddof=1) / math.sqrt(len(v)))
    lb = mu - 1.96 * se
    return {"days": int(len(v)), "mu": round(mu, 4), "lb": round(lb, 4), "ok": bool(len(v) >= G3_MIN_DAYS and lb > 0.5)}


def _features_q(P, log):
    """portfolio_lab._features 와 같되 동물원에 alpha101 을 더한다(반복 2)."""
    import factor_screen as fs
    old = fs.ZOOS
    facs = None
    fs.ZOOS = ZOOS_Q
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
    log("      피처 %d개 (%s · %.0fs)" % (len(names), "+".join(ZOOS_Q), time.time() - t0))
    return (np.stack(out, axis=2) if out else None), names


def run(daily, mkt_by_sym, day_key_of, BASE=None, HDR=None, upload=True, log=print):
    import lightgbm as lgb
    import factor_screen as fs
    import portfolio_lab as pl
    pl._vt()
    from src.quantlib.crossvalidation import purged_walk_forward_splits
    req = None
    if upload and BASE:
        import requests as req
    log("   ── [OMNI-Q] Qlib 표준 머리(동물원 피처 LightGBM 순위 · H=%d) · 실력 증명 관문 ①②③ ──" % H)
    out = {}
    for mk in ("us", "kr"):
        t0 = time.time()
        P = fs.build_wide(daily, mkt_by_sym, mk, day_key_of)
        if P is None:
            continue
        C = P["close"]
        D, S = C.shape
        X, names = _features_q(P, log)
        if X is None:
            continue
        fwd = (C.shift(-(H + 1)) / C.shift(-1) - 1.0)
        y = fwd.rank(axis=1, pct=True).values
        fwdv = fwd.values
        valid = np.isfinite(y).sum(axis=1) >= 20
        days = np.where(valid & (np.arange(D) >= 120))[0]
        if len(days) < 200:
            log("   · %s 표본일 부족" % mk)
            continue
        lab_end = np.arange(len(days)) + H + 1
        splits = list(purged_walk_forward_splits(len(days), label_end_times=lab_end, n_folds=FOLDS, embargo_fraction=0.02, expanding=True))
        scores = np.full((D, S), np.nan, dtype=np.float32)
        test_all, fold_x, fold_x0 = [], [], []
        for sp in splits:
            tr, te = days[sp.train], days[sp.test]
            Xtr, ytr = X[tr].reshape(-1, X.shape[2]), y[tr].reshape(-1)
            m = np.isfinite(ytr)
            if m.sum() < 5000:
                continue
            bst = lgb.train(_lgb_params(), lgb.Dataset(Xtr[m], label=ytr[m]), num_boost_round=300)
            scores[te] = bst.predict(X[te].reshape(-1, X.shape[2])).reshape(len(te), S).astype(np.float32)
            xs = decile_excess(scores, fwdv, list(te), COST_RT[mk], band=BAND)          # [반복 2] ② = 보유 띠
            xs0 = decile_excess(scores, fwdv, list(te), COST_RT[mk])                   # 참고: 통째 교체(반복 1 정의)
            fold_x.append(round(float(np.mean(xs)), 5) if xs else None)
            fold_x0.append(round(float(np.mean(xs0)), 5) if xs0 else None)
            test_all += list(te)
        br = beat_rate(scores, y, test_all)
        g1 = gate1(br)
        g2, pos, need = gate2(fold_x)
        log("      [OMNI-Q %s] ① 상위10%% 승률 %s · 하한 %s · t %s · 날 %d → %s" % (mk, br["mu"], br["lb"], br["t"], br["days"], "통과" if g1 else "미달"))
        log("      [OMNI-Q %s] ② 비용 뺀 %d일 초과(보유 띠 상위%d%%→%d%%, 구간별) %s → 양수 %d/%d 필요 %d → %s · 참고 통째교체 %s" % (mk, H, int(Q * 100), int(BAND * 100), fold_x, pos, len(fold_x), need, "통과" if g2 else "미달", fold_x0))
        # 최종 모델: 라벨이 있는 모든 날로 학습 → 마지막 날(오늘 피처) 채점
        Xa, ya = X[days].reshape(-1, X.shape[2]), y[days].reshape(-1)
        m = np.isfinite(ya)
        bst = lgb.train(_lgb_params(), lgb.Dataset(Xa[m], label=ya[m]), num_boost_round=300)
        last = D - 1
        # 미완성 봉 금지: 한국 장중(00:00~06:30Z)에 돌면 오늘 일봉이 덜 찼다 → 어제까지(미국은 이 학습기 시각(00:10·12:10Z)에 장이 닫혀 있다)
        if mk == "kr":
            import datetime as _dt
            now = _dt.datetime.utcnow()
            kst_today = int((now + _dt.timedelta(hours=9)).strftime("%Y%m%d"))
            try:
                if now.hour < 7 and int(C.index[last]) >= kst_today and last > 0:
                    last -= 1
            except (TypeError, ValueError):
                pass
        s_last = bst.predict(X[last]).astype(np.float64)
        ok = np.isfinite(s_last) & np.isfinite(X[last]).any(axis=1)
        syms = [C.columns[j] for j in range(S) if ok[j]]
        sv = s_last[ok]
        pct = (np.argsort(np.argsort(sv)) + 0.5) / len(sv) if len(sv) else sv
        sc = {s: round(float(p), 4) for s, p in zip(syms, pct)}
        k = max(1, int(round(len(syms) * Q)))
        top = [syms[j] for j in np.argsort(-sv)[:k]]
        day = str(C.index[last])
        # ③ 라이브 장부 채점(워커가 보관한 과거 '그날 상위 10%')
        g3 = {"days": 0, "mu": None, "lb": None, "ok": False}
        if req is not None:
            try:
                r = req.get(BASE + "/api/omni-q-picks", params={"mkt": mk}, headers=HDR, timeout=60)
                r.raise_for_status()
                dk_index = {str(k2): i for i, k2 in enumerate(C.index)}
                g3 = gate3(r.json().get("picks") or [], C, y, dk_index)
            except Exception as e:  # noqa: BLE001
                log("      ⚠️ [OMNI-Q %s] 장부 읽기 실패: %r — ③ 미달로 둔다" % (mk, e))
        log("      [OMNI-Q %s] ③ 라이브 장부 채점 날 %d · 승률 %s · 하한 %s (필요 %d일·하한>50%%) → %s" % (mk, g3["days"], g3["mu"], g3["lb"], G3_MIN_DAYS, "통과" if g3["ok"] else "미달"))
        speak = bool(g1 and g2 and g3["ok"])
        body = {"mkt": mk, "day": day, "h": H, "q": Q, "trainedAt": int(time.time() * 1000), "nFeat": len(names), "n": len(sc),
                "scores": sc, "top": top,
                "gate": {"g1": dict(br, ok=g1, needT=G1_T), "g2": {"folds": fold_x, "foldsFullSwap": fold_x0, "band": BAND, "pos": pos, "need": need, "ok": g2},
                         "g3": dict(g3, needDays=G3_MIN_DAYS), "speak": speak}}
        out[mk] = body["gate"]
        log("      [OMNI-Q %s] 오늘(%s) %d종목 채점 · 상위 %d · 발언 %s (%.0fs)" % (mk, day, len(sc), len(top), "가능" if speak else "불가(섀도우)", time.time() - t0))
        if req is not None:
            try:
                r = req.post(BASE + "/api/omni-q", headers=HDR, json=body, timeout=120)
                log("      [OMNI-Q %s] 업로드 %s %s" % (mk, r.status_code, r.text[:200]))
            except Exception as e:  # noqa: BLE001
                log("      ⚠️ [OMNI-Q %s] 업로드 실패: %r" % (mk, e))
    return out
