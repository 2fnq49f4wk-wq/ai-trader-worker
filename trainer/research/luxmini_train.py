#!/usr/bin/env python3
"""LUX-Mini — 브라우저에서 도는 아주 작은 주식 전용 판단 모델(단기 5일 · 중기 20일 · 장기 120일 × 한국·미국).

사용:
  python3 luxmini_train.py --kr KR_P.pkl --us US_P.pkl --out public/luxmini.json [--mode auto|raw|pct] [--trees 64] [--report LOG]
  P.pkl = dict(open/high/low/close/volume → DataFrame[int YYYYMMDD × 종목], 수정주가)

설계(정직하게 작게):
  · 입력 = 사이트가 /api/state watchlist 로 ★이미 보내는 시세 필드★ 로만 만든 특징(가격·전일종가·RSI14·5/20/50일선·ATR14·볼린저·
    5/20/60일·1년 수익). 시장 맥락은 같은 시장 watchlist 로 화면이 센다(학습 패널 = 같은 종목 집합: 한국 443/446 · 미국 552/558).
    → 추론에 새 데이터·서버 CPU 가 필요 없다.
    특징 방식 두 가지(--mode): raw = 원값 + 시장 맥락(상승 비율·수익 중앙값) · pct = 같은 날 같은 시장 안 백분위.
    auto = 둘 다 학습하고 ★검증 구간 IC 평균★ 이 큰 쪽을 고른다(홀드아웃은 고르는 데 안 쓴다 — 둘 다 보고만 한다).
  · 목표 = h 거래일 뒤 수익이 ★같은 날 같은 시장 종목 중앙값★ 을 넘는가(이진) — h = 5 · 20 · 120.
  · 모델 = 머리당 LightGBM 얕은 나무(깊이 ≤ 3 · 잎 ≤ 8 · 나무 ≤ 64 · 검증 logloss 조기 종료). 확률은 검증 구간 Platt 보정.
    목표가 '같은 날 중앙값 대비' 라 그날 시장 평균 확률은 정의상 0.5 다 → 화면은 그날 같은 시장 평균이 0.5 가 되게 옮긴다(p 중심화).
    (1차 시험에서 중심화 없이 한국 폭락일에 446종 중 204종이 '긍정' 으로 쏠렸다 — 원값이 한꺼번에 움직여서.)
    라벨·기대 초과수익(ex)은 ★그날 같은 시장 안 점수 10분위★ 로 읽는다(ex 표 = 검증 구간 같은 10분위의 실제 초과수익 분포).
  · 근거 = Saabas(경로 기여도: 노드 값 변화를 그 노드의 특징에 돌린다 — 합이 정확히 점수) 상위 3개 → 화면 문장.
    문장의 '과거 승률' 은 학습 구간에서 그 특징 값 10분위별 실제 승률(모델이 아닌 원자료).
  · 검증 = 날짜 순 walk-forward: 학습(앞 60%) → 검증(60~75%: 조기 종료·Platt·ex 표·방식 선택) → 홀드아웃(뒤 25%: 아무것도 안 고른다).
    구간 사이 h 일 엠바고. 지표: AUC · 순위 IC(날짜별 Spearman 평균) · 상위 10% 초과수익(동일가중 평균 대비 · 왕복 비용 차감,
    KR 0.30% · US 0.10%). t = 날짜 블록(2h 거래일) 평균의 군집-강건 t. 기준선 = 60일 수익 순위(모멘텀) · 무작위.
    usable = IC t ≥ 2 · (IC − 기준선 IC) t ≥ 2 · 상위 10% 순초과 > 0. 아니면 화면에 '참고(검증 미달)'.
한계: 유니버스가 오늘의 구성 종목(생존 편향) · 지수 대신 유니버스 중앙값 · 장중 값(dayPct)은 종가 기준으로 학습.
"""
import argparse, json, pickle, sys, time
import numpy as np, pandas as pd
import lightgbm as lgb

H = {'s': 5, 'm': 20, 'l': 120}
COST = {'kr': 0.30, 'us': 0.10}
SPLIT = (0.60, 0.75)
SEED = 7

# 특징 이름 = JS(public/luxmini.js FEATS)와 같은 순서·같은 정의. 바꾸면 양쪽을 같이 바꾼다.
_BASE = ['dayPct', 'rsi', 'pMa5', 'pMa20', 'pMa50', 'ma5_20', 'ma20_50', 'atrPct', 'bbPos', 'bbWidth', 'r5', 'r20', 'r60', 'r1y']
FEATS = {'pct': _BASE, 'raw': _BASE + ['rel5', 'rel20', 'rel60', 'breadth', 'mDay', 'm5', 'm60']}


def quote_fields(P):
    """패널 → 날짜×종목 '시세 필드'(사이트 saveQuote 와 같은 정의)."""
    C = P['close'].astype(float); Hh = P['high'].astype(float); L = P['low'].astype(float)
    C = C.where(C > 0)
    C1 = C.shift(1)
    tr = np.maximum.reduce([(Hh - L).values, (Hh - C1).abs().values, (L - C1).abs().values])
    tr = pd.DataFrame(tr, index=C.index, columns=C.columns)
    tr = tr.where(Hh.notna() & L.notna(), (C - C1).abs())
    atr = tr.rolling(14).mean()                                    # getATR: 최근 14개 TR 단순평균
    d = C.diff()
    aG = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()   # getRSI: Wilder
    aL = (-d).clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    rsi = 100 - 100 / (1 + aG / aL.replace(0, np.nan))
    rsi = rsi.where(aL > 0, np.where(aG > 0, 100.0, 50.0)).where(C.notna() & C1.notna())
    ma20 = C.rolling(20).mean(); sd20 = C.rolling(20).std(ddof=0)
    Q = dict(price=C, prevClose=C1, dayPct=(C / C1 - 1) * 100, rsi=rsi, ma=ma20,
             dailyMaShort=C.rolling(5).mean(), ma50=C.rolling(50).mean(), atr=atr,
             bbLower=ma20 - 2 * sd20, bbUpper=ma20 + 2 * sd20)
    for n, k in ((5, 'return5'), (20, 'return20'), (60, 'return60'), (252, 'ret1y')):
        Q[k] = (C / C.shift(n) - 1) * 100
    return Q, C


def feats_from_quote(Q):
    """시세 필드 → 원값 특징(종목 단위 · JS rawFeats 와 1:1)."""
    p = Q['price']
    def pct(a, b):
        return (a / b - 1) * 100
    F = {}
    F['dayPct'] = Q['dayPct']
    F['rsi'] = Q['rsi']
    F['pMa5'] = pct(p, Q['dailyMaShort'])
    F['pMa20'] = pct(p, Q['ma'])
    F['pMa50'] = pct(p, Q['ma50'])
    F['ma5_20'] = pct(Q['dailyMaShort'], Q['ma'])
    F['ma20_50'] = pct(Q['ma'], Q['ma50'])
    F['atrPct'] = Q['atr'] / p * 100
    w = Q['bbUpper'] - Q['bbLower']
    F['bbPos'] = ((p - Q['bbLower']) / w.where(w > 0)).clip(-1, 2)
    F['bbWidth'] = w / Q['ma'] * 100
    F['r5'] = Q['return5']; F['r20'] = Q['return20']; F['r60'] = Q['return60']; F['r1y'] = Q['ret1y']
    return F


def market_ctx(Q):
    """시장 맥락(날짜별 스칼라) — 화면은 같은 시장 watchlist 로 같은 값을 센다(luxMini.ctxFrom)."""
    dp = Q['dayPct']
    up = (dp > 0.005).sum(axis=1); dn = (dp < -0.005).sum(axis=1)
    return dict(breadth=(up / (up + dn).replace(0, np.nan)),
                mDay=dp.median(axis=1), m5=Q['return5'].median(axis=1),
                m20=Q['return20'].median(axis=1), m60=Q['return60'].median(axis=1))


def build(P, mode):
    Q, C = quote_fields(P)
    F = feats_from_quote(Q)
    shape = C.shape
    FE = FEATS[mode]
    X = np.full((len(FE),) + shape, np.nan, dtype=np.float32)
    live = C.notna()
    if mode == 'pct':
        for i, k in enumerate(FE):
            # 같은 날 백분위 = (평균 순위)/n — JS pctRank 와 같은 정의(동률은 평균 순위)
            X[i] = F[k].where(live).rank(axis=1, pct=True, method='average').values
    else:
        M = market_ctx(Q)
        F['rel5'] = F['r5'].sub(M['m5'], axis=0); F['rel20'] = F['r20'].sub(M['m20'], axis=0); F['rel60'] = F['r60'].sub(M['m60'], axis=0)
        for i, k in enumerate(FE):
            X[i] = np.repeat(M[k].values[:, None], shape[1], axis=1) if k in M else F[k].values
    Y = {}
    for hk, h in H.items():
        fr = (C.shift(-h) / C - 1).clip(-0.9, 3.0) * 100
        Y[hk] = fr.sub(fr.median(axis=1), axis=0).values.astype(np.float32)   # 같은 날 중앙값 대비 초과(%p)
    valid = C.notna().values & ~np.isnan(X[FE.index('r60')]) & ~np.isnan(X[FE.index('pMa50')])
    return X, Y, valid, C.index.values, Q


def spearman_by_date(score, y):
    """score,y: [T,N] (NaN = 없음). 날짜별 Spearman. 반환 (T,)"""
    out = np.full(score.shape[0], np.nan)
    for t in range(score.shape[0]):
        m = ~np.isnan(score[t]) & ~np.isnan(y[t])
        if m.sum() < 20:
            continue
        a = pd.Series(score[t][m]).rank().values; b = pd.Series(y[t][m]).rank().values
        out[t] = np.corrcoef(a, b)[0, 1]
    return out


def topdec_by_date(score, y, q=0.10):
    out = np.full(score.shape[0], np.nan)
    for t in range(score.shape[0]):
        m = ~np.isnan(score[t]) & ~np.isnan(y[t])
        n = m.sum()
        if n < 20:
            continue
        s, yy = score[t][m], y[t][m]
        k = max(1, int(round(n * q)))
        out[t] = yy[np.argsort(-s)[:k]].mean() - yy.mean()   # 상위 10% − 같은 날 동일가중 평균(중앙값 아님: 오른쪽 꼬리 때문에 무작위도 +)
    return out


def block_t(series, B):
    """날짜 블록(B 거래일) 평균의 t — 겹치는 라벨의 자기상관을 블록 안에 가둔다."""
    s = np.asarray(series, float)
    idx = np.arange(len(s)) // B
    df = pd.DataFrame({'b': idx, 'v': s}).dropna()
    g = df.groupby('b')['v'].mean()
    if len(g) < 3:
        return float('nan'), float(df['v'].mean()) if len(df) else float('nan'), len(g)
    return float(g.mean() / (g.std(ddof=1) / np.sqrt(len(g)))), float(df['v'].mean()), int(len(g))


def auc(p, y):
    o = np.argsort(p); r = np.empty(len(p)); r[o] = np.arange(1, len(p) + 1)
    pos = y == 1; n1 = pos.sum(); n0 = len(y) - n1
    if n1 == 0 or n0 == 0:
        return float('nan')
    return float((r[pos].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def tree_export(tree):
    """LightGBM 나무 1개 → 평평한 배열 {f,t,l,r,m,v}. v = 노드 값(잎=출력, 내부=잎 출력의 표본가중 평균 → Saabas)."""
    f, t, l, r, m, v = [], [], [], [], [], []
    def walk(nd):
        i = len(f)
        f.append(-1); t.append(0.0); l.append(-1); r.append(-1); m.append(0); v.append(0.0)
        if 'leaf_index' in nd or 'split_feature' not in nd:
            v[i] = float(nd['leaf_value']); cnt = nd.get('leaf_count', 1)
            return i, v[i], cnt
        f[i] = int(nd['split_feature']); t[i] = float(nd['threshold'])
        if nd.get('decision_type', '<=') != '<=':
            raise SystemExit('unsupported decision_type')
        mt = nd.get('missing_type', 'None')
        if mt == 'Zero':
            raise SystemExit('unsupported missing_type Zero')
        # m: 0 = 결측을 0 으로 보고 비교(LightGBM None) · 1 = 결측이면 왼쪽 · 2 = 결측이면 오른쪽
        m[i] = 0 if mt == 'None' else (1 if nd.get('default_left', True) else 2)
        li, lv, lc = walk(nd['left_child']); ri, rv, rc = walk(nd['right_child'])
        l[i] = li; r[i] = ri
        v[i] = (lv * lc + rv * rc) / max(lc + rc, 1)
        return i, v[i], lc + rc
    walk(tree['tree_structure'])
    rd = lambda a: [float('%.6g' % x) for x in a]
    return {'f': f, 't': rd(t), 'l': l, 'r': r, 'm': m, 'v': rd(v)}


def js_tree_raw(T, x):
    """JS 와 같은 규칙으로 나무를 걷는다(내보낸 배열 기준 — 패리티 확인용)."""
    i = 0
    while T['f'][i] >= 0:
        xv = x[T['f'][i]]
        if np.isnan(xv):
            if T['m'][i] == 0:
                xv = 0.0
            else:
                i = T['l'][i] if T['m'][i] == 1 else T['r'][i]; continue
        i = T['l'][i] if xv <= T['t'][i] else T['r'][i]
    return T['v'][i]


def rank_pct_rows(S):
    """[T,N] → 날짜별 평균순위/n (NaN 유지)."""
    return pd.DataFrame(S).rank(axis=1, pct=True, method='average').values


def predict_rows(bst, nt, X, valid, rows):
    """rows 날짜 전부 × 전 종목 점수 [len(rows), N] (무효 = NaN)."""
    N = X.shape[2]
    Xr = X[:, rows, :].transpose(1, 2, 0).reshape(-1, X.shape[0])
    vm = valid[rows].reshape(-1)
    out = np.full(len(vm), np.nan)
    if vm.any():
        out[vm] = bst.predict(Xr[vm], num_iteration=nt, raw_score=True)
    return out.reshape(len(rows), N)


def sample_rows(X, Y, valid, rows, hk, step):
    rs = rows[::step]
    yy = Y[hk][rs]
    mk = valid[rs] & ~np.isnan(yy)
    Xs = X[:, rs, :].transpose(1, 2, 0)[mk]
    return Xs, (yy[mk] > 0).astype(np.int8), yy[mk]


def metrics(S, Yh, X, FE, rows, mk, h):
    base = X[FE.index('r60'), rows].astype(float); base[np.isnan(S)] = np.nan
    rnd = np.random.default_rng(SEED).standard_normal(S.shape); rnd[np.isnan(S)] = np.nan
    B = 2 * h
    st = {}
    for name, sc in (('model', S), ('mom60', base), ('random', rnd)):
        ic = spearman_by_date(sc, Yh)
        td = topdec_by_date(sc, Yh) - COST[mk]
        ict, icm, nb = block_t(ic, B); tdt, tdm, _ = block_t(td, B)
        st[name] = dict(ic=icm, ic_t=ict, top10_net=tdm, top10_t=tdt, blocks=nb, ic_series=ic)
    dt, dm, _ = block_t(st['model']['ic_series'] - st['mom60']['ic_series'], B)
    return st, dm, dt, base


def run_market(mk, P, mode, ntrees, log):
    t0 = time.time()
    FE = FEATS[mode]
    X, Y, valid, dates, Q = build(P, mode)
    T = len(dates)
    i1, i2 = int(T * SPLIT[0]), int(T * SPLIT[1])
    out = {'heads': {}, 'bins': {}, 'asof': int(dates[-1]), 'n_syms': int(X.shape[2]),
           'split': {'train': [int(dates[260]), int(dates[i1 - 1])], 'val': [int(dates[i1]), int(dates[i2 - 1])],
                     'hold': [int(dates[i2]), int(dates[-1])]}}
    tr_rows_all = np.arange(260, i1)
    edges = {}
    for j, k in enumerate(FE):   # 특징 10분위 경계(학습 구간 · 문장의 '과거 승률' 용)
        xv = X[j, tr_rows_all][valid[tr_rows_all]]
        xv = xv[~np.isnan(xv)]
        e = np.unique(np.quantile(xv, np.linspace(0.1, 0.9, 9)).astype(float))
        edges[k] = [float('%.4g' % z) for z in e]
    out['edges'] = edges
    for hk, h in H.items():
        tr_rows = np.arange(260, i1 - h)          # 엠바고: 학습 라벨이 검증 구간으로 넘어가지 않게
        va_rows = np.arange(i1, i2 - h)
        ho_rows = np.arange(i2, T - h)
        step = 2 if h <= 5 else 3
        Xtr, ytr, _ = sample_rows(X, Y, valid, tr_rows, hk, step)
        Xva, yva, _ = sample_rows(X, Y, valid, va_rows, hk, 1)
        params = dict(objective='binary', learning_rate=0.08, num_leaves=8, max_depth=3, min_data_in_leaf=3000,
                      feature_fraction=0.8, bagging_fraction=0.7, bagging_freq=1, lambda_l2=10.0, seed=SEED,
                      verbose=-1, num_threads=4, max_bin=63)
        dtr = lgb.Dataset(Xtr, ytr, feature_name=FE, free_raw_data=False)
        dva = lgb.Dataset(Xva, yva, reference=dtr)
        bst = lgb.train(params, dtr, num_boost_round=ntrees, valid_sets=[dva],
                        callbacks=[lgb.early_stopping(16, verbose=False)])
        nt = bst.best_iteration or ntrees
        dump = bst.dump_model(num_iteration=nt)
        trees = [tree_export(tr) for tr in dump['tree_info'][:nt]]
        # ── 검증 구간: Platt · 같은 날 10분위 ex 표 · 방식 선택용 IC ──
        rva = bst.predict(Xva, num_iteration=nt, raw_score=True)
        a, b = platt(rva, yva)
        Sva = predict_rows(bst, nt, X, valid, va_rows); Yva = Y[hk][va_rows].astype(float)
        Yva[np.isnan(Sva)] = np.nan; Sva[np.isnan(Yva)] = np.nan
        dec = np.minimum(9, np.floor(rank_pct_rows(Sva) * 10)); dec[np.isnan(Sva)] = np.nan
        extab = []
        for k in range(10):
            z = Yva[dec == k]
            extab.append([float('%.4g' % np.median(z)), float('%.4g' % np.quantile(z, 0.25)),
                          float('%.4g' % np.quantile(z, 0.75)), float('%.4g' % z.mean()),
                          round(float((z > 0).mean()), 3)] if len(z) else [0, 0, 0, 0, 0.5])
        vst, _, _, _ = metrics(Sva, Yva, X, FE, va_rows, mk, h)
        val = dict(ic=round(vst['model']['ic'], 4), ic_t=round(vst['model']['ic_t'], 2), base_ic=round(vst['mom60']['ic'], 4))
        # ── 홀드아웃: 전 날짜 · 전 종목(아무것도 고르지 않는다) ──
        S = predict_rows(bst, nt, X, valid, ho_rows); Yh = Y[hk][ho_rows].astype(float)
        Yh[np.isnan(S)] = np.nan; S[np.isnan(Yh)] = np.nan
        st, dm, dt, base = metrics(S, Yh, X, FE, ho_rows, mk, h)
        m = ~np.isnan(S)
        P_ = 1 / (1 + np.exp(-(a * S + b)))
        Pc = np.clip(P_ - np.nanmean(P_, axis=1, keepdims=True) + 0.5, 0.01, 0.99)   # 화면과 같은 날짜 중심화
        yh = (Yh[m] > 0).astype(int)
        hold = dict(auc=round(auc(S[m], yh), 4), auc_mom60=round(auc(np.nan_to_num(base[m], nan=0.0), yh), 4),
                    brier=round(float(np.mean((Pc[m] - yh) ** 2)), 4), brier_uncentered=round(float(np.mean((P_[m] - yh) ** 2)), 4),
                    brier_const=round(float(np.mean((yh.mean() - yh) ** 2)), 4),
                    ic=round(st['model']['ic'], 4), ic_t=round(st['model']['ic_t'], 2),
                    top10_net=round(st['model']['top10_net'], 3), top10_t=round(st['model']['top10_t'], 2), blocks=st['model']['blocks'],
                    base_ic=round(st['mom60']['ic'], 4), base_ic_t=round(st['mom60']['ic_t'], 2),
                    base_top10_net=round(st['mom60']['top10_net'], 3), base_top10_t=round(st['mom60']['top10_t'], 2),
                    rand_ic=round(st['random']['ic'], 4), rand_top10_net=round(st['random']['top10_net'], 3),
                    d_ic=round(dm, 4), d_ic_t=round(dt, 2), cost=COST[mk], n_dates=int(len(ho_rows)))
        pc = Pc[m]; qq = np.quantile(pc, [0.2, 0.4, 0.6, 0.8]); cb = np.searchsorted(qq, pc, side='right')
        hold['calib'] = [[round(float(pc[cb == k].mean()), 3), round(float(yh[cb == k].mean()), 3)] for k in range(5) if (cb == k).any()]
        hold['usable'] = bool(hold['ic_t'] >= 2 and hold['d_ic_t'] >= 2 and hold['top10_net'] > 0)
        # 특징 10분위별 학습 구간 실제 승률(문장용)
        wr = {}
        for j, k in enumerate(FE):
            xv = Xtr[:, j]; ok = ~np.isnan(xv)
            bk = np.searchsorted(np.array(edges[k]), xv[ok], side='right')
            wr[k] = [round(float(ytr[ok][bk == z].mean()), 3) if (bk == z).sum() > 200 else None for z in range(len(edges[k]) + 1)]
        out['bins'][hk] = wr
        # 패리티 시험 벡터(JS 가 같은 점수를 내는지 게이트가 확인 · 첫 벡터는 결측 경로)
        pv = []
        for z in (0, len(Xva) // 3, 2 * len(Xva) // 3):
            x = Xva[z].astype(float).copy()
            if z == 0:
                x[FE.index('pMa50')] = np.nan
            raw = bst.predict(x[None, :], num_iteration=nt, raw_score=True)[0]
            pv.append({'x': [None if np.isnan(q) else float(q) for q in x], 'raw': float(raw)})
        init = float(raw_check(trees, pv[1]['x'], pv[1]['raw']))
        out['heads'][hk] = dict(h=h, init=init, trees=trees, platt=[round(a, 5), round(b, 5)], ex_tab=extab,
                                val=val, hold=hold, n_train=int(len(ytr)), parity=pv)
        log('%s/%s %s h=%d trees=%d | VAL IC %.4f t%.2f (mom %.4f) | HOLD AUC %.3f(mom %.3f) IC %.4f t%.2f mom %.4f dIC t%.2f top10net %.3f t%.2f (mom %.3f rnd %.3f) brier %.4f/%.4f usable=%s %.0fs' % (
            mode, mk, hk, h, nt, val['ic'], val['ic_t'], val['base_ic'], hold['auc'], hold['auc_mom60'], hold['ic'], hold['ic_t'],
            hold['base_ic'], hold['d_ic_t'], hold['top10_net'], hold['top10_t'], hold['base_top10_net'], hold['rand_top10_net'],
            hold['brier'], hold['brier_const'], hold['usable'], time.time() - t0))
    return out


def raw_check(trees, x, raw):
    """init(LightGBM 의 시작 점수)은 덤프에 따로 없어서 = raw − Σ 잎 출력 으로 맞춘다(모든 벡터에서 같아야 한다)."""
    xx = np.array([np.nan if q is None else q for q in x], float)
    return raw - sum(js_tree_raw(T, xx) for T in trees)


def platt(r, y, it=60):
    a, b = 1.0, 0.0
    for _ in range(it):
        z = a * r + b; p = 1 / (1 + np.exp(-z)); g = p - y; w = p * (1 - p) + 1e-9
        ga, gb = (g * r).mean(), g.mean()
        haa, hab, hbb = (w * r * r).mean(), (w * r).mean(), w.mean()
        det = haa * hbb - hab * hab
        if det <= 0:
            break
        da = (hbb * ga - hab * gb) / det; db = (haa * gb - hab * ga) / det
        a -= da; b -= db
        if abs(da) + abs(db) < 1e-9:
            break
    return float(a), float(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kr', required=True); ap.add_argument('--us', required=True)
    ap.add_argument('--out', required=True); ap.add_argument('--trees', type=int, default=64)
    ap.add_argument('--mode', default='auto', choices=['auto', 'raw', 'pct'])
    ap.add_argument('--report', default=None)
    a = ap.parse_args()
    lines = []
    def log(s):
        print(s, flush=True); lines.append(s)
    modes = ['raw', 'pct'] if a.mode == 'auto' else [a.mode]
    panels = {'kr': pickle.load(open(a.kr, 'rb')), 'us': pickle.load(open(a.us, 'rb'))}
    runs = {md: {mk: run_market(mk, panels[mk], md, a.trees, log) for mk in ('kr', 'us')} for md in modes}
    vic = {md: float(np.mean([runs[md][mk]['heads'][hk]['val']['ic'] for mk in runs[md] for hk in H])) for md in modes}
    pick = max(modes, key=lambda md: vic[md])
    log('selection by mean VALIDATION IC: %s -> %s' % (json.dumps({k: round(v, 4) for k, v in vic.items()}), pick))
    res = {'v': 1, 'mode': pick, 'feats': FEATS[pick], 'horizons': H, 'cost': COST,
           'rule': 'usable = holdout IC t>=2 & (IC - mom60 IC) t>=2 & top10 net-of-cost excess vs equal-weight mean > 0 (t over blocks of 2h dates)',
           'selection': {'by': 'mean validation IC over 6 heads', 'val_ic': {k: round(v, 4) for k, v in vic.items()},
                         'alt_hold': {md: {mk: {hk: {q: runs[md][mk]['heads'][hk]['hold'][q] for q in ('ic', 'ic_t', 'd_ic_t', 'top10_net', 'usable')}
                                                    for hk in H} for mk in runs[md]} for md in modes if md != pick}},
           'mk': runs[pick]}
    for mk in res['mk']:   # 패리티: 모든 벡터에서 init 이 같아야 한다(내보낸 나무 = LightGBM 나무)
        for hk, hd in res['mk'][mk]['heads'].items():
            for pv in hd['parity']:
                d = raw_check(hd['trees'], pv['x'], pv['raw']) - hd['init']
                if abs(d) > 1e-4:
                    sys.exit('parity fail %s %s %g' % (mk, hk, d))
            hd['init'] = round(hd['init'], 6)
            for pv in hd['parity']:
                pv['raw'] = round(pv['raw'], 6)
    s = json.dumps(res, ensure_ascii=False, separators=(',', ':'))
    open(a.out, 'w').write(s)
    log('wrote %s %.1f KB' % (a.out, len(s) / 1024))
    if a.report:
        open(a.report, 'w').write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
