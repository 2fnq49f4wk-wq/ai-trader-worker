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
import os
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
# ── [V33.539] 복합 모델(사용자 10/11: "OMNI 를 여러 역할을 하는 복합 모델로 · GitHub 검증 모델 개조 사용 OK") ──
#   같은 피처 패널을 공유하는 머리 여러 개: 순위 1·5·20일(5일 = 발언 머리 · 관문 ①②③) · 상승 확률(절대 · 위원회 후보) · 위험(다음 5일 실현변동성 순위).
#   학습기 두 종: LightGBM(Qlib 기본) vs DoubleEnsemble(Qlib 벤치마크 상위 — 표본 재가중 SR + 피처 선택 FS 로 하위 모델을 쌓는다, Zhang et al. 2020 ICDM).
#   ★미리 등록(데이터 보기 전)★: DE 는 두 시장 모두에서 ① 하한이 LGB 보다 ≥0.002 높고 ② 를 통과할 때만 5일 머리 학습기로 채택(LEARNER_5D).
HEADS_RANK = (1, 5, 20)
H20 = 20                    # [V33.543] 두 번째 발언 머리 지평
LEARNER_5D = "lgb"          # 연구 회차(OMNIQ_LAB=1) 결과로만 바꾼다
#   [V33.558] 후보 "lgb_reg"(정규화 강화 · 잎 15 · 잎당 1,000 · L2 10 · 피처 60% · 150판) — 같은 규칙(두 시장 ① 하한 +0.002 · ② 통과)일 때만 채택.
DE_K = 4                    # DoubleEnsemble 하위 모델 수
DE_SR_BINS, DE_FS_BINS = 10, 5
DE_FS_RATIO = (0.8, 0.7, 0.6, 0.5, 0.4)
COST_RT = {"us": 0.0005 + 0.0005, "kr": (0.00015 + 0.001) + (0.00015 + 0.001 + 0.002)}   # 왕복(실험실 COST 와 같다)

# ── [V33.584] ★학습은 금요일 한 번 · 평일은 채점만★ — 사용자(10/13): "ai 모델 학습을 금요일 한번만 · 그 전까지는 수집만".
#   워커 매매 경로(OMNIQ_ROUTE)는 ★그날 피처★ 로 매긴 점수가 필요하다(점수 5일 넘으면 낡음). 그래서 평일 회차는 학습(퍼지 전진 5구간 ·
#   최종 적합)을 건너뛰고 ★금요일 모델로 그날 피처만 다시 채점★ 해 올린다. 관문 ①② 는 금요일 학습 결과 그대로, ③(라이브 장부)은 매번 다시 잰다
#   (장부 채점은 학습이 아니다 — 지난 픽을 실제 가격으로 맞춰 보는 것뿐). 모델은 GHA 캐시(actions/cache)에 둔다.
TRAIN_DOW = 4                    # 금요일(파이썬 월=0)
TRAIN_FROM_HOUR = 7              # 07시Z(한국장 마감 뒤) 이후 첫 회차가 학습한다
MODEL_MAX_AGE_S = 7.5 * 86400    # 금요일 학습이 빠졌으면(캐시 만료·실패) 다음 회차가 학습한다 — 자가 복구


LAST_OOS = {}  # [V33.610] 시장별 표본 밖(퍼지 전진) 5일 점수(날짜×종목) — playbook_sim 이 과거 후보(상위 20%)를 고른다
LAST_X = {}   # [V33.605] 시장별 마지막 피처 텐서(날짜×종목×피처 · 횡단면 순위) — strategy_router 가 빌려 쓴다


def should_train(mode, cached, names, now_ts=None):
    """이번 회차가 학습할지와 그 이유. mode: auto(기본) · train(강제) · score(채점만 — 캐시가 맞을 때만)."""
    import datetime as _dt
    now_ts = time.time() if now_ts is None else now_ts
    if mode == "train":
        return True, "강제 학습"
    if not cached or list(cached.get("names") or []) != list(names):
        return True, "캐시 없음 또는 피처 목록이 바뀜"
    t_at = float(cached.get("trainedAt") or 0) / 1000.0
    if now_ts - t_at > MODEL_MAX_AGE_S:
        return True, "모델 %.1f일 — 금요일 학습이 빠졌다" % ((now_ts - t_at) / 86400)
    if mode == "score":
        return False, "강제 채점"
    now = _dt.datetime.utcfromtimestamp(now_ts)
    if now.weekday() == TRAIN_DOW and now.hour >= TRAIN_FROM_HOUR:
        t = _dt.datetime.utcfromtimestamp(t_at)
        if t.date() != now.date() or t.hour < TRAIN_FROM_HOUR:
            return True, "금요일 학습"
    return False, "금요일 모델로 채점만"


def load_cache(path):
    import pickle
    try:
        with open(path, "rb") as f:
            c = pickle.load(f)
        return c if isinstance(c, dict) else {}
    except Exception:  # noqa: BLE001 — 캐시가 없거나 깨졌으면 학습한다
        return {}


def save_cache(path, cache):
    import os
    import pickle
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(cache, f, protocol=pickle.HIGHEST_PROTOCOL)


def _last_row(mk, C, D):
    """채점할 마지막 날 — 한국 장중(00:00~06:30Z)에 돌면 오늘 일봉이 덜 찼다 → 어제까지."""
    last = D - 1
    if mk == "kr":
        import datetime as _dt
        now = _dt.datetime.utcnow()
        kst_today = int((now + _dt.timedelta(hours=9)).strftime("%Y%m%d"))
        try:
            if now.hour < 7 and int(C.index[last]) >= kst_today and last > 0:
                last -= 1
        except (TypeError, ValueError):
            pass
    return last


def _lgb_params(seed=7, reg=False):
    import os
    p = {"objective": "regression", "learning_rate": 0.05, "num_leaves": 31, "min_data_in_leaf": 200,
         "feature_fraction": 0.8, "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 1.0,
         "verbose": -1, "seed": seed, "num_threads": int(os.environ.get("OMNI_THREADS", "8"))}
    if reg:
        # [V33.558] 정규화 강화 후보(과적합 대응 · 연구 회차에서만 비교) — 잎 15 · 잎당 최소 1,000행 · L2 10 · 피처 60%
        p.update({"num_leaves": 15, "min_data_in_leaf": 1000, "lambda_l2": 10.0, "feature_fraction": 0.6})
    return p


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


def _fit_lgb(X, y, objective="regression", rounds=300, weight=None, seed=7, reg=False):
    import lightgbm as lgb
    p = _lgb_params(seed, reg=reg)
    p["objective"] = objective
    return lgb.train(p, lgb.Dataset(X, label=y, weight=weight), num_boost_round=rounds)


class DoubleEnsemble:
    """Qlib DEnsembleModel 의 핵심을 옮긴 것(MIT, microsoft/qlib) — 하위 LightGBM K 개를
    ① 표본 재가중(SR): 앞 모델의 학습 손실 곡선(끝 손실 + 감소 정도)을 구간으로 나눠, 잘 못 맞히는 구간에 무게를 더 준다(감쇠)
    ② 피처 선택(FS): 피처를 섞었을 때 손실이 얼마나 느는지(g)로 구간을 나눠, 덜 중요한 구간일수록 덜 뽑는다
    로 차례로 만들고 예측을 평균한다. 계산량 때문에 SR 곡선·FS 는 표본 일부(최대 4만 행)로 잰다."""
    def __init__(self, k=DE_K, rounds=300, seed=7):
        self.k, self.rounds, self.seed = k, rounds, seed
        self.models, self.feats = [], []

    def fit(self, X, y):
        rng = np.random.default_rng(self.seed)
        n, f = X.shape
        w = np.ones(n, dtype=np.float32)
        feats = np.arange(f)
        sub = rng.choice(n, size=min(n, 40000), replace=False)
        for i in range(self.k):
            m = _fit_lgb(X[:, feats], y, rounds=self.rounds, weight=w, seed=self.seed + i)
            self.models.append(m)
            self.feats.append(feats.copy())
            if i == self.k - 1:
                break
            # ① SR — 손실 곡선(5개 지점)
            pts = [max(1, int(self.rounds * r)) for r in (0.2, 0.4, 0.6, 0.8, 1.0)]
            Lc = np.stack([(m.predict(X[sub][:, feats], num_iteration=t) - y[sub]) ** 2 for t in pts], axis=1)
            l_end = Lc[:, -1]
            l_dec = Lc[:, 0] - Lc[:, -1]
            h = 0.5 * _rank01(l_end) + 0.5 * (1.0 - _rank01(l_dec))
            bins = np.minimum((h * DE_SR_BINS).astype(int), DE_SR_BINS - 1)
            hb = np.array([h[bins == b].mean() if np.any(bins == b) else 0.0 for b in range(DE_SR_BINS)])
            wb = 1.0 / (0.9 ** (i + 1) * hb + 0.1)
            # 전체 표본에 무게를 주려면 전체 손실이 필요하다 — 마지막 지점만 전체로 잰다(비용 절충)
            l_all = (m.predict(X[:, feats]) - y) ** 2
            b_all = np.minimum((_rank01(l_all) * DE_SR_BINS).astype(int), DE_SR_BINS - 1)
            w = wb[b_all].astype(np.float32)
            w = w / w.mean()
            # ② FS — 섞었을 때 손실 증가
            base = float(np.mean(l_end))
            g = np.zeros(len(feats))
            Xs = X[sub][:, feats].copy()
            for j in range(len(feats)):
                col = Xs[:, j].copy()
                Xs[:, j] = rng.permutation(col)
                g[j] = float(np.mean((m.predict(Xs) - y[sub]) ** 2)) - base
                Xs[:, j] = col
            order = np.argsort(-g)
            chunks = np.array_split(order, DE_FS_BINS)
            keep = []
            for b, ch in enumerate(chunks):
                kk = max(1, int(round(len(ch) * DE_FS_RATIO[b])))
                keep += list(rng.choice(ch, size=min(len(ch), kk), replace=False))
            feats = feats[np.sort(np.array(keep))]
        return self

    def predict(self, X):
        return np.mean([m.predict(X[:, fs]) for m, fs in zip(self.models, self.feats)], axis=0)


def _rank01(v):
    r = np.argsort(np.argsort(v))
    return r / max(1, len(v) - 1)


def _auc(p, yb):
    pos, neg = p[yb == 1], p[yb == 0]
    if len(pos) < 10 or len(neg) < 10:
        return None
    r = _rank01(np.concatenate([pos, neg])) * (len(pos) + len(neg) - 1) + 1
    return float((r[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


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
    # [V33.596] ★원장에서 번 규칙 전략을 AI 가 배운다★(사용자 10/14: "승률 높던 규칙 매수 전략을 전략 중 하나로 학습시켜")
    #   미국 SN_RSI2(상승추세 단기 과매도 · 20포지션 +0.70% t 2.3) · 한국 TR_PULLBACK(추세 안 눌림 · 34포지션 +0.91%) 의 조건을
    #   피처로 넣는다(워커 evaluateSnapEntry · evaluateTrendEntry 와 같은 정의). 다른 피처처럼 날짜별 횡단면 순위로 바꾸며,
    #   쓸모는 OMNI-Q 관문(표본 밖 걷기)이 판정한다 — 피처를 넣는다고 발언이 열리지 않는다. 끄려면 OMNIQ_RULEFEAT=0.
    if os.environ.get("OMNIQ_RULEFEAT", "1") != "0":
        try:
            for nm, F in _rule_feats(P):
                F = F.replace([np.inf, -np.inf], np.nan).reindex_like(P["close"])
                out.append(F.rank(axis=1, pct=True).values.astype(np.float32))
                names.append(nm)
        except Exception as e:  # noqa: BLE001
            log("      ⚠️ 규칙 피처 실패: %s" % e)
    log("      피처 %d개 (%s · %.0fs)" % (len(names), "+".join(ZOOS_Q), time.time() - t0))
    return (np.stack(out, axis=2) if out else None), names


def _rule_feats(P):
    """[V33.596] 규칙 전략 조건 → 피처(이름 rule_*). P: 날짜×종목 넓은 표."""
    c = P["close"]
    ma5, ma20, ma50, ma200 = (c.rolling(n, min_periods=n).mean() for n in (5, 20, 50, 200))
    d = c.diff()
    up2 = d.clip(lower=0).rolling(2).mean()
    dn2 = (-d.clip(upper=0)).rolling(2).mean()
    rsi2 = 100 - 100 / (1 + up2 / dn2.replace(0, np.nan))
    rsi2 = rsi2.where(dn2 > 0, 100.0)
    hi20 = c.rolling(20, min_periods=20).max()
    up = (c > ma200) & (ma50 > ma200)
    sn = (up & (rsi2 <= 12) & (c < ma5)).astype(float)
    gap20 = c / ma20 - 1
    trpb = ((ma20 > ma50) & (gap20.abs() <= 0.04) & (d > 0)).astype(float)
    return [("rule_rsi2", -rsi2),                        # 낮을수록(과매도) 높은 순위
            ("rule_sn_rsi2", sn.where(ma200.notna())),
            ("rule_tr_pullback", trpb.where(ma50.notna())),
            ("rule_pb_depth", (-(gap20)).where(ma20 > ma50)),   # 추세 안에서 MA20 아래로 깊을수록
            ("rule_off_hi20", -(c / hi20 - 1))]


def _ledger(req, BASE, HDR, mk, C, ylab, h, log):
    """③ 라이브 장부 채점(학습 아님) — 워커가 보관한 과거 '그날 상위 10%' 를 실제 가격으로 맞춰 본다."""
    g = {"days": 0, "mu": None, "lb": None, "ok": False}
    if req is None:
        return g
    try:
        params = {"mkt": mk} if h == H else {"mkt": mk, "h": str(h)}
        r = req.get(BASE + "/api/omni-q-picks", params=params, headers=HDR, timeout=60)
        r.raise_for_status()
        g = gate3(r.json().get("picks") or [], C, ylab, {str(k2): i for i, k2 in enumerate(C.index)})
    except Exception as e:  # noqa: BLE001
        log("      ⚠️ [OMNI-Q %s] %d일 장부 읽기 실패: %r — ③ 미달로 둔다" % (mk, h, e))
    return g


def _score_only(mk, cached, C, X, y, req, BASE, HDR, log):
    """[V33.584] 금요일 모델(cached)로 그날 피처만 채점한다 — 학습 없음. 관문 ①② 는 금요일 결과 · ③ 은 다시 잰다."""
    try:
        D, S = C.shape
        last = _last_row(mk, C, D)
        xl = X[last]
        s_last = cached["bst"].predict(xl).astype(np.float64)
        ok = np.isfinite(s_last) & np.isfinite(xl).any(axis=1)
        syms = [C.columns[j] for j in range(S) if ok[j]]
        sv = s_last[ok]
        if len(sv) < 20:
            return None
        pct = (np.argsort(np.argsort(sv)) + 0.5) / len(sv)
        sc = {s_: round(float(p_), 4) for s_, p_ in zip(syms, pct)}
        k = max(1, int(round(len(syms) * Q)))
        top = [syms[j] for j in np.argsort(-sv)[:k]]
        extra = {}
        for hk, mdl in (cached.get("heads") or {}).items():
            try:
                v = mdl.predict(xl)[ok]
                if hk == "pUp":
                    extra[hk] = {s_: round(float(p_), 4) for s_, p_ in zip(syms, v)}
                else:
                    pv = (np.argsort(np.argsort(v)) + 0.5) / len(v)
                    extra[hk] = {s_: round(float(p_), 4) for s_, p_ in zip(syms, pv)}
            except Exception as e:  # noqa: BLE001
                log("      ⚠️ [OMNI-Q %s] 머리 %s 채점 실패: %r" % (mk, hk, e))
        f20 = (C.shift(-(H20 + 1)) / C.shift(-1) - 1.0)
        y20 = f20.rank(axis=1, pct=True).values
        g3 = _ledger(req, BASE, HDR, mk, C, y, H, log)
        g3_20 = _ledger(req, BASE, HDR, mk, C, y20, H20, log)
        gate = dict(cached.get("gate") or {})
        gate["g3"] = dict(g3, needDays=G3_MIN_DAYS)
        gate["speak"] = bool((gate.get("g1") or {}).get("ok") and (gate.get("g2") or {}).get("ok") and g3["ok"])
        gate20 = dict(cached.get("gate20") or {})
        if gate20:
            gate20["g3"] = dict(g3_20, needDays=G3_MIN_DAYS)
            gate20["speak"] = bool((gate20.get("g1") or {}).get("ok") and (gate20.get("g2") or {}).get("ok") and g3_20["ok"])
        top20 = []
        r20 = extra.get("r20") or {}
        if r20:
            k20 = max(1, int(round(len(r20) * Q)))
            top20 = [s_ for s_, _ in sorted(r20.items(), key=lambda kv: -kv[1])[:k20]]
        log("      [OMNI-Q %s] ③ 라이브 장부 날 %d · 하한 %s → %s · 20일 ③ 날 %d → %s" % (
            mk, g3["days"], g3["lb"], "통과" if g3["ok"] else "미달", g3_20["days"], "통과" if g3_20["ok"] else "미달"))
        return {"mkt": mk, "day": str(C.index[last]), "h": H, "q": Q, "trainedAt": int(cached["trainedAt"]),
                "scoredAt": int(time.time() * 1000), "scoreOnly": True, "nFeat": int(cached.get("nFeat") or xl.shape[1]), "n": len(sc),
                "scores": sc, "top": top, "heads": extra, "learner": cached.get("learner") or LEARNER_5D, "lab": cached.get("lab"),
                "gate": gate, "top20": top20, "gate20": gate20 or None}
    except Exception as e:  # noqa: BLE001
        log("      ⚠️ [OMNI-Q %s] 채점만 예외: %r" % (mk, e))
        return None


def run(daily, mkt_by_sym, day_key_of, BASE=None, HDR=None, upload=True, log=print, cache=None, mode="auto"):
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
        LAST_X[mk] = {"X": X, "names": names, "dates": list(C.index), "syms": list(C.columns)}   # [V33.605] 매매법 선택 AI 가 같은 피처를 쓴다(다시 계산하지 않는다)
        fwd = (C.shift(-(H + 1)) / C.shift(-1) - 1.0)
        y = fwd.rank(axis=1, pct=True).values
        fwdv = fwd.values
        valid = np.isfinite(y).sum(axis=1) >= 20
        days = np.where(valid & (np.arange(D) >= 120))[0]
        if len(days) < 200:
            log("   · %s 표본일 부족" % mk)
            continue
        # [V33.584] 학습 회차인가(금요일) — 아니면 금요일 모델로 그날 피처만 채점해 올리고 다음 시장으로
        cached = cache.get(mk) if isinstance(cache, dict) else None
        do_train, why_train = should_train(mode, cached, names)
        log("   · [OMNI-Q %s] %s — %s" % (mk, "학습" if do_train else "채점만(학습 없음)", why_train))
        if not do_train:
            body = _score_only(mk, cached, C, X, y, req, BASE, HDR, log)
            if body is not None:
                out[mk] = body["gate"]
                log("      [OMNI-Q %s] 오늘(%s) %d종목 채점(금요일 모델 · 학습 %s) · 발언 %s (%.0fs)" % (
                    mk, body["day"], body["n"], time.strftime("%m-%d %H:%MZ", time.gmtime(body["trainedAt"] / 1000.0)),
                    "가능" if body["gate"]["speak"] else "불가(섀도우)", time.time() - t0))
                if req is not None:
                    try:
                        r = req.post(BASE + "/api/omni-q", headers=HDR, json=body, timeout=120)
                        log("      [OMNI-Q %s] 업로드 %s %s" % (mk, r.status_code, r.text[:200]))
                    except Exception as e:  # noqa: BLE001
                        log("      ⚠️ [OMNI-Q %s] 업로드 실패: %r" % (mk, e))
                continue
            log("      ⚠️ [OMNI-Q %s] 채점만 실패 — 이번 회차는 학습한다" % mk)
        lab_end = np.arange(len(days)) + H + 1
        splits = list(purged_walk_forward_splits(len(days), label_end_times=lab_end, n_folds=FOLDS, embargo_fraction=0.02, expanding=True))
        F = X.shape[2]

        fitdiag = {}

        def cv(lab, learner="lgb", objective="regression", diag=None, diag_y=None):
            """퍼지 전진 표본 밖 점수(날짜×종목) + 시험 날 목록.
            [V33.558] diag 이름을 주면 ★적합 진단★ — 마지막 구간 모델로 학습구간 끝 250일의 승률(표본 안)을 재서 표본 밖 승률과 나란히 둔다.
            표본 안 ≫ 표본 밖(차 > 0.08) = 과적합 · 둘 다 ≈ 0.5 = 과소적합. 판정에 쓰지 않는다(기록·관측)."""
            sc = np.full((D, S), np.nan, dtype=np.float32)
            tdays = []
            last = None
            for sp in splits:
                tr, te = days[sp.train], days[sp.test]
                Xtr, ytr = X[tr].reshape(-1, F), lab[tr].reshape(-1)
                mm = np.isfinite(ytr)
                if mm.sum() < 5000:
                    continue
                mdl = (DoubleEnsemble().fit(Xtr[mm], ytr[mm]) if learner == "de" else
                       _fit_lgb(Xtr[mm], ytr[mm], objective, rounds=(150 if learner == "lgb_reg" else 300), reg=(learner == "lgb_reg")))
                sc[te] = mdl.predict(X[te].reshape(-1, F)).reshape(len(te), S).astype(np.float32)
                tdays += list(te)
                last = (mdl, tr, te)
            if diag and last is not None:
                try:
                    mdl, tr, te = last
                    ins = tr[-250:]
                    si = np.full((D, S), np.nan, dtype=np.float32)
                    si[ins] = mdl.predict(X[ins].reshape(-1, F)).reshape(len(ins), S).astype(np.float32)
                    yy = y if diag_y is None else diag_y
                    bi, bo = beat_rate(si, yy, list(ins)), beat_rate(sc, yy, list(te))
                    gap = (bi["mu"] - bo["mu"]) if (bi["mu"] is not None and bo["mu"] is not None) else None
                    kind = ("과적합 의심" if gap is not None and gap > 0.08 else
                            "과소적합 의심" if (bi["mu"] is not None and bi["mu"] < 0.51) else "정상 범위")
                    fitdiag[diag] = {"inMu": bi["mu"], "outMu": bo["mu"], "gap": None if gap is None else round(gap, 4), "kind": kind}
                    log("      [OMNI-Q %s · 적합 진단 %s] 표본 안(학습 끝 250일) 승률 %s · 표본 밖(마지막 구간) %s · 차 %s → %s" %
                        (mk, diag, bi["mu"], bo["mu"], fitdiag[diag]["gap"], kind))
                except Exception as e:  # noqa: BLE001 — 진단은 본 판정을 막지 않는다
                    log("      [OMNI-Q 적합 진단 실패] %s" % e)
            return sc, tdays

        def judge(sc, tdays, lab_rank, fwd_vals, tag, step=H):
            fx, fx0 = [], []
            for sp in splits:
                te = [d for d in days[sp.test] if d in set(tdays)]
                if not te:
                    continue
                xs = decile_excess(sc, fwd_vals, te, COST_RT[mk], band=BAND, step=step)   # 지평만큼 쉬고 갈아탄다(겹침 없음)
                xs0 = decile_excess(sc, fwd_vals, te, COST_RT[mk], step=step)
                fx.append(round(float(np.mean(xs)), 5) if xs else None)
                fx0.append(round(float(np.mean(xs0)), 5) if xs0 else None)
            b = beat_rate(sc, lab_rank, tdays)
            g2_, pos_, need_ = gate2(fx)
            log("      [OMNI-Q %s · %s] ① 상위10%% 승률 %s · 하한 %s · t %s · 날 %d → %s · ② 띠 %s 양수 %d/%d → %s" %
                (mk, tag, b["mu"], b["lb"], b["t"], b["days"], "통과" if gate1(b) else "미달", fx, pos_, len(fx), "통과" if g2_ else "미달"))
            return b, fx, fx0, g2_, pos_, need_

        import os as _os
        LAB = _os.environ.get("OMNIQ_LAB") == "1"
        scores, test_all = cv(y, LEARNER_5D, diag="5일")
        LAST_OOS[mk] = {"sc": scores, "dates": list(C.index), "syms": list(C.columns)}   # [V33.610] 표본 밖 5일 점수 — 매매법 시뮬 후보를 실전과 같게
        br, fold_x, fold_x0, g2, pos, need = judge(scores, test_all, y, fwdv, "5일 · " + LEARNER_5D)
        # [V33.543] ★두 번째 발언 머리 — 20일 순위★(연구 회차 10/11: 미국 ① 53.3% t 12.9 · 한국 54.0% t 18.0 · ② 4/4). 관문 ①②③ 동일 · 20일마다 갈아탐.
        f20 = (C.shift(-(H20 + 1)) / C.shift(-1) - 1.0)
        y20 = f20.rank(axis=1, pct=True).values
        s20, t20 = cv(y20, diag="20일", diag_y=y20)
        br20, fx20, _, g2_20, pos20, need20 = judge(s20, t20, y20, f20.values, "20일 순위(발언 머리 2)", step=H20)
        g1_20 = gate1(br20)
        lab_rep = {}
        if LAB:
            # (연구) DoubleEnsemble vs LightGBM — 미리 등록한 채택 규칙의 재료
            sde, tde = cv(y, "de")
            bde, fde, _, g2de, _, _ = judge(sde, tde, y, fwdv, "5일 · DoubleEnsemble")
            lab_rep["de"] = {"lb": bde["lb"], "t": bde["t"], "g2": g2de, "folds": fde, "lgbLb": br["lb"]}
            # (연구) [V33.558] 정규화 강화 LightGBM — 과적합 대응. ★미리 등록★: 두 시장 모두 ① 하한이 LGB 보다 ≥0.002 높고 ② 통과일 때만 채택
            sreg, treg = cv(y, "lgb_reg", diag="5일·정규화")
            breg, freg, _, g2reg, _, _ = judge(sreg, treg, y, fwdv, "5일 · 정규화 강화")
            lab_rep["reg"] = {"lb": breg["lb"], "t": breg["t"], "g2": g2reg, "folds": freg, "lgbLb": br["lb"],
                              "fit": fitdiag.get("5일·정규화"), "fitLgb": fitdiag.get("5일")}
            # (연구) 순위 머리 1·20일
            for Hh in (1,):   # 20일은 위에서 매 회차 잰다
                fh = (C.shift(-(Hh + 1)) / C.shift(-1) - 1.0)
                yh = fh.rank(axis=1, pct=True).values
                sh, th = cv(yh)
                bh, fxh, _, g2h, _, _ = judge(sh, th, yh, fh.values, "%d일 순위" % Hh)
                lab_rep["r%d" % Hh] = {"lb": bh["lb"], "t": bh["t"], "g2": g2h, "folds": fxh}
            # (연구) 상승 확률(절대) — AUC · 상위10% 상승 적중
            ydir = np.where(np.isfinite(fwdv), (fwdv > 0).astype(np.float32), np.nan)
            sd, td = cv(ydir, objective="binary")
            pp, yy = sd[td].reshape(-1), ydir[td].reshape(-1)
            mm = np.isfinite(pp) & np.isfinite(yy)
            auc = _auc(pp[mm], yy[mm].astype(int))
            log("      [OMNI-Q %s · 상승확률] 표본 밖 AUC %s · 기저 상승률 %.3f" % (mk, None if auc is None else round(auc, 4), float(np.mean(yy[mm]))))
            lab_rep["dir"] = {"auc": None if auc is None else round(auc, 4), "base": round(float(np.mean(yy[mm])), 4)}
            # (연구) 위험 — 다음 5일 실현변동성 순위 예측의 순위 IC
            vol = P["close"].pct_change(fill_method=None).rolling(5).std().shift(-5)
            yv = vol.rank(axis=1, pct=True).values
            sv_, tv_ = cv(yv)
            ics = []
            for d in tv_:
                a_, b_ = sv_[d], yv[d]
                ok_ = np.isfinite(a_) & np.isfinite(b_)
                if ok_.sum() >= 20:
                    ics.append(np.corrcoef(_rank01(a_[ok_]), _rank01(b_[ok_]))[0, 1])
            ric = float(np.nanmean(ics)) if ics else None
            log("      [OMNI-Q %s · 위험] 다음 5일 변동성 순위 IC %s (날 %d)" % (mk, None if ric is None else round(ric, 4), len(ics)))
            lab_rep["risk"] = {"ic": None if ric is None else round(ric, 4)}
            # [V33.543] ★위험 사이징 미리 등록 검정★ — 5일 상위10% 를 동일비중 vs 예측 위험 역가중(w ∝ 1/(0.5+위험순위), 평균 1, 0.6~1.4)
            #   채택: 두 시장 모두 ≥3/4 구간에서 샤프(기간 수익 평균/표준편차) ≥ 동일비중 × 1.10 · 평균 수익 하락 ≤ 0.02%p/기간
            sz = []
            for sp in splits:
                te = [d for d in days[sp.test] if d in set(test_all) and d in set(tv_)]
                eq_r, rw_r = [], []
                for d in te[::H]:
                    a5, rk, rr = scores[d], sv_[d], fwdv[d]
                    ok_ = np.isfinite(a5) & np.isfinite(rk) & np.isfinite(rr)
                    if ok_.sum() < 20:
                        continue
                    idx = np.where(ok_)[0]
                    kq = max(1, int(round(len(idx) * Q)))
                    top_ = idx[np.argsort(-a5[idx])[:kq]]
                    rkq = _rank01(sv_[d][idx])[np.argsort(-a5[idx])[:kq]]
                    w = 1.0 / (0.5 + rkq)
                    w = np.clip(w / w.mean(), 0.6, 1.4)
                    w = w / w.mean()
                    eq_r.append(float(np.mean(rr[top_])))
                    rw_r.append(float(np.sum(w * rr[top_]) / len(top_)))
                if len(eq_r) >= 10:
                    se, sr = float(np.std(eq_r)), float(np.std(rw_r))
                    sh_e = float(np.mean(eq_r)) / se if se > 0 else 0.0
                    sh_r = float(np.mean(rw_r)) / sr if sr > 0 else 0.0
                    sz.append({"shEq": round(sh_e, 4), "shRw": round(sh_r, 4), "muEq": round(float(np.mean(eq_r)), 5), "muRw": round(float(np.mean(rw_r)), 5),
                               "win": bool(sh_r >= sh_e * 1.10 and float(np.mean(rw_r)) >= float(np.mean(eq_r)) - 0.0002)})
            nwin = sum(1 for z in sz if z["win"])
            ok_sz = bool(len(sz) >= 3 and nwin >= max(3, int(math.ceil(0.75 * len(sz)))))
            log("      [OMNI-Q %s · 위험 사이징] 구간 %s → 이김 %d/%d → %s" % (mk, sz, nwin, len(sz), "통과" if ok_sz else "미달"))
            lab_rep["sizing"] = {"folds": sz, "wins": nwin, "ok": ok_sz}
        g1 = gate1(br)
        # 최종 모델: 라벨이 있는 모든 날로 학습 → 마지막 날(오늘 피처) 채점
        Xa, ya = X[days].reshape(-1, F), y[days].reshape(-1)
        m = np.isfinite(ya)
        bst = (DoubleEnsemble().fit(Xa[m], ya[m]) if LEARNER_5D == "de" else
               _fit_lgb(Xa[m], ya[m], rounds=(150 if LEARNER_5D == "lgb_reg" else 300), reg=(LEARNER_5D == "lgb_reg")))
        # 미완성 봉 금지: 한국 장중(00:00~06:30Z)에 돌면 오늘 일봉이 덜 찼다 → 어제까지(미국은 이 학습기 시각에 장이 닫혀 있다)
        last = _last_row(mk, C, D)
        s_last = bst.predict(X[last]).astype(np.float64)
        ok = np.isfinite(s_last) & np.isfinite(X[last]).any(axis=1)
        syms = [C.columns[j] for j in range(S) if ok[j]]
        sv = s_last[ok]
        pct = (np.argsort(np.argsort(sv)) + 0.5) / len(sv) if len(sv) else sv
        sc = {s: round(float(p), 4) for s, p in zip(syms, pct)}
        k = max(1, int(round(len(syms) * Q)))
        top = [syms[j] for j in np.argsort(-sv)[:k]]
        day = str(C.index[last])
        # [V33.539] 복합 머리 — 오늘 점수(같은 피처 · 각자 라벨로 전체 학습). 발언은 5일 머리만(관문 ①②③). 나머지는 기록·관측용.
        extra = {}
        head_models = {}   # [V33.584] 평일 채점용으로 보관(캐시)
        try:
            def _final(lab, objective="regression", key=None):
                la = lab[days].reshape(-1)
                mm = np.isfinite(la)
                mdl_ = _fit_lgb(Xa[mm], la[mm], objective)
                if key:
                    head_models[key] = mdl_
                return mdl_.predict(X[last])[ok]
            def _pctmap(v):
                pv = (np.argsort(np.argsort(v)) + 0.5) / len(v)
                return {s_: round(float(p_), 4) for s_, p_ in zip(syms, pv)}
            for Hh in (1, 20):
                fh = (C.shift(-(Hh + 1)) / C.shift(-1) - 1.0)
                extra["r%d" % Hh] = _pctmap(_final(fh.rank(axis=1, pct=True).values, key="r%d" % Hh))
            ydir = np.where(np.isfinite(fwdv), (fwdv > 0).astype(np.float32), np.nan)
            extra["pUp"] = {s_: round(float(p_), 4) for s_, p_ in zip(syms, _final(ydir, "binary", key="pUp"))}
            vol = P["close"].pct_change(fill_method=None).rolling(5).std().shift(-5)
            extra["risk"] = _pctmap(_final(vol.rank(axis=1, pct=True).values, key="risk"))
        except Exception as e:  # noqa: BLE001
            log("      ⚠️ [OMNI-Q %s] 복합 머리 채점 실패: %r — 5일 머리만 올린다" % (mk, e))
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
        # [V33.543] 20일 머리 — 오늘 상위 10%(장부) · ③ 은 픽 뒤 21거래일이 지나야 채점된다(장부 h=20 · 덮어쓰기 금지)
        top20, g3_20 = [], {"days": 0, "mu": None, "lb": None, "ok": False}
        r20 = extra.get("r20") or {}
        if r20:
            k20 = max(1, int(round(len(r20) * Q)))
            top20 = [s_ for s_, _ in sorted(r20.items(), key=lambda kv: -kv[1])[:k20]]
        if req is not None:
            try:
                r = req.get(BASE + "/api/omni-q-picks", params={"mkt": mk, "h": "20"}, headers=HDR, timeout=60)
                r.raise_for_status()
                g3_20 = gate3(r.json().get("picks") or [], C, y20, {str(k2): i for i, k2 in enumerate(C.index)})
            except Exception as e:  # noqa: BLE001
                log("      ⚠️ [OMNI-Q %s] 20일 장부 읽기 실패: %r — ③ 미달로 둔다" % (mk, e))
        speak20 = bool(g1_20 and g2_20 and g3_20["ok"])
        log("      [OMNI-Q %s · 20일] ③ 장부 채점 날 %d · 하한 %s → %s · 발언 %s" % (mk, g3_20["days"], g3_20["lb"], "통과" if g3_20["ok"] else "미달", "가능" if speak20 else "불가(섀도우)"))
        t_ms = int(time.time() * 1000)
        body = {"mkt": mk, "day": day, "h": H, "q": Q, "trainedAt": t_ms, "scoredAt": t_ms, "scoreOnly": False, "nFeat": len(names), "n": len(sc),
                "scores": sc, "top": top, "heads": extra, "learner": LEARNER_5D, "lab": lab_rep or None,
                "gate": {"g1": dict(br, ok=g1, needT=G1_T), "g2": {"folds": fold_x, "foldsFullSwap": fold_x0, "band": BAND, "pos": pos, "need": need, "ok": g2},
                         "g3": dict(g3, needDays=G3_MIN_DAYS), "speak": speak, "fit": fitdiag.get("5일")},
                "top20": top20,
                "gate20": {"g1": dict(br20, ok=g1_20, needT=G1_T), "g2": {"folds": fx20, "band": BAND, "step": H20, "pos": pos20, "need": need20, "ok": g2_20},
                           "g3": dict(g3_20, needDays=G3_MIN_DAYS), "speak": speak20, "fit": fitdiag.get("20일")}}
        out[mk] = body["gate"]
        if isinstance(cache, dict):   # [V33.584] 다음 금요일까지 평일 회차가 이 모델로 채점한다
            cache[mk] = {"names": list(names), "trainedAt": t_ms, "learner": LEARNER_5D, "bst": bst, "heads": head_models,
                         "gate": body["gate"], "gate20": body["gate20"], "lab": body["lab"], "nFeat": len(names)}
            cache["_trained"] = True
        log("      [OMNI-Q %s] 오늘(%s) %d종목 채점 · 상위 %d · 발언 %s (%.0fs)" % (mk, day, len(sc), len(top), "가능" if speak else "불가(섀도우)", time.time() - t0))
        if req is not None:
            try:
                r = req.post(BASE + "/api/omni-q", headers=HDR, json=body, timeout=120)
                log("      [OMNI-Q %s] 업로드 %s %s" % (mk, r.status_code, r.text[:200]))
            except Exception as e:  # noqa: BLE001
                log("      ⚠️ [OMNI-Q %s] 업로드 실패: %r" % (mk, e))
    return out
