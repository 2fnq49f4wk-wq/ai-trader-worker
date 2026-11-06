#!/usr/bin/env python3
"""AI 전망 엔진(public/outlook.js) 규칙 검증·보정.

사용: python3 outlook_eval.py KR_P.pkl US_P.pkl [--out public/outlook-weights.json]
  P.pkl = dict(open/high/low/close/volume → DataFrame[int YYYYMMDD × 종목], 수정주가)

방법(README 참조):
 · 규칙마다 '발동한 종목·날' 의 앞으로 h일 수익을 같은 날 횡단면 중앙값과 뺀 초과수익으로 잰다
   (단기 10일 · 중기 60일 · 장기 250일). 시장 전체 규칙(투매·상승비율)은 종목 순위를 못 바꾸므로
   동일가중 지수의 앞으로 h일 수익으로 잰다 → 점수에 넣지 않고 '참고'.
 · 날짜를 앞 70%(선택) / 뒤 30%(홀드아웃)로 가른다. 선택 구간 끝 h일은 버려 미래가 겹치지 않게 한다.
 · t 는 h일 길이 날짜 블록 군집-강건(겹치는 수익률의 자기상관 보정). 무조건부 평균을 뺀 값으로 낸다.
 · 가중치 = 선택·홀드아웃 부호가 같고 두 구간 |t|>=2 인 규칙만 부호 × clip(|t_선택|/3, 0.3, 1.5).
   나머지는 0(참고 문구만).
 · 라벨 경계 = 선택 구간 점수 분위(10/30/70/90%) → 홀드아웃에서 라벨별 P(시장중앙값 이김)·평균 초과수익.
"""
import sys, json, pickle, datetime
import numpy as np, pandas as pd

HZ = {'s': 10, 'm': 60, 'l': 250}
SPLIT = 0.7
MINN = 30          # 하루에 평가 가능한 종목이 이보다 적으면 그 날은 버린다
TGATE = 2.0
Q = (0.10, 0.30, 0.70, 0.90)


def wilder(x, n):
    return x.ewm(alpha=1.0 / n, adjust=False).mean()


def bc(series, like):
    """날짜별 값(Series)을 종목 수만큼 펼친다(시장 규칙용)."""
    return pd.DataFrame(np.repeat(series.values[:, None], like.shape[1], 1), like.index, like.columns)


def build(P):
    C = P['close'].astype(float)
    r = (C / C.shift(1) - 1).clip(-0.5, 0.5)
    d = C.diff()
    up, dn = wilder(d.clip(lower=0), 14), wilder((-d).clip(lower=0), 14)
    rsi = 100 - 100 / (1 + up / dn.replace(0, np.nan))
    rsi = rsi.where(dn > 0, 100.0).where(C.notna())
    m5, m20, m50 = (C.rolling(n, min_periods=n).mean() for n in (5, 20, 50))
    ret5 = (C / C.shift(5) - 1) * 100
    ret60 = (C / C.shift(60) - 1) * 100
    ret1y = (C / C.shift(252) - 1) * 100
    ret5y = (C / C.shift(1260) - 1) * 100
    ew = (1 + r.mean(axis=1).fillna(0)).cumprod()
    ix60 = (ew / ew.shift(60) - 1) * 100
    ixday = r.mean(axis=1) * 100
    up_n = (r > 0.00005).sum(axis=1)
    dn_n = (r < -0.00005).sum(axis=1)
    upr = up_n / (up_n + dn_n).replace(0, np.nan)
    rel = ret60.sub(ix60, axis=0)
    B = lambda a: a.fillna(False).astype(bool)
    live = C.notna()
    rules = {   # id: (기간, 마스크)
        'rsi_lo':  ('s', B(rsi <= 30)),
        'rsi_hi':  ('s', B(rsi >= 75)),
        'r5_dump': ('s', B(ret5 <= -10)),
        'r5_pump': ('s', B(ret5 >= 15)),
        'ma_dn':   ('s', B((m5 < m20) & (C < m20))),
        'ma_up':   ('s', B((m5 > m20) & (C > m20))),
        'mk_sell': ('s', B(bc(((upr < 0.25) & (ixday <= -2)), C)) & live),
        'mk_up':   ('s', B(bc((upr > 0.7), C)) & live),
        'a50_up':  ('m', B(C > m50)),
        'a50_dn':  ('m', B(C < m50)),
        'al_up':   ('m', B((m20 > m50) & m50.notna())),
        'al_dn':   ('m', B((m20 < m50) & m50.notna())),
        'rs_hi':   ('m', B(rel >= 5)),
        'rs_lo':   ('m', B(rel <= -5)),
        'y1_hi':   ('l', B(ret1y >= 20)),
        'y1_lo':   ('l', B(ret1y <= -20)),
        'y5_hi':   ('l', B(ret5y >= 100)),
        'y5_lo':   ('l', B(ret5y < 0) & ret5y.notna()),
    }
    MKT = {'mk_sell', 'mk_up'}
    sign = {'rsi_lo': 1, 'rsi_hi': -1, 'r5_dump': 1, 'r5_pump': -1, 'ma_dn': -1, 'ma_up': 1, 'mk_sell': -1, 'mk_up': 1,
            'a50_up': 1, 'a50_dn': -1, 'al_up': 1, 'al_dn': -1, 'rs_hi': 1, 'rs_lo': -1, 'y1_hi': 1, 'y1_lo': -1,
            'y5_hi': 1, 'y5_lo': -1}
    E, EM = {}, {}
    for h in set(HZ.values()):
        f = (C.shift(-h) / C - 1).clip(-0.9, 3.0) * 100
        ok = f.notna().sum(axis=1) >= MINN
        med = f.median(axis=1)
        E[h] = f.sub(med, axis=0).where(ok, np.nan)
        mf = (ew.shift(-h) / ew - 1) * 100
        EM[h] = bc(mf.where(ok), C).where(live)
    return C, rules, MKT, sign, E, EM


def clus(x, M, lo, hi, blk, off=0.0):
    """[lo,hi) 구간, 마스크 M 에서 x(원값) 평균·날짜블록 군집-강건 t·이긴 비율.
    t 와 exd 는 무조건부 평균 off 를 뺀 값, ex·p 는 원값."""
    xv = x[lo:hi]
    mv = M[lo:hi] & ~np.isnan(xv)
    n_t = mv.sum(axis=1)
    s_t = np.where(mv, xv, 0.0).sum(axis=1)
    N = n_t.sum()
    if N < 30:
        return dict(n=int(N), ex=None, exd=None, t=None, p=None)
    b = np.arange(hi - lo) // blk
    nb = np.bincount(b, weights=n_t)
    sb = np.bincount(b, weights=s_t)
    mean = sb.sum() / N
    se = np.sqrt(((sb - mean * nb) ** 2).sum()) / N
    hit = ((xv > 0) & mv).sum() / N
    return dict(n=int(N), ex=float(mean), exd=float(mean - off), t=float((mean - off) / se) if se > 0 else None, p=float(hit))


def uncond(x, lo, hi):
    return float(np.nanmean(x[lo:hi]))


def main():
    a = sys.argv[1:]
    out = a[a.index('--out') + 1] if '--out' in a else None
    pk = {'kr': a[0], 'us': a[1]}
    res = {'version': 1, 'generated': datetime.date.today().isoformat(), 'split': SPLIT, 'tGate': TGATE,
           'quantiles': list(Q),
           'note': '초과수익 = 같은 날 횡단면 중앙값 대비 %p. 규칙·라벨 ex 는 그 구간 전체 종목-날 평균 초과수익을 뺀 값(평균>중앙값 왜도 제거), exRaw 는 원값. p = 중앙값을 이긴 비율(원값).'}
    for mk in ('kr', 'us'):
        P = pickle.load(open(pk[mk], 'rb'))
        C, rules, MKT, sign, E, EM = build(P)
        T = len(C)
        cut = int(T * SPLIT)
        res[mk] = {'dates': [int(C.index[0]), int(C.index[cut]), int(C.index[-1])], 'nStocks': int(C.shape[1])}
        Rm = {k: v[1].values for k, v in rules.items()}
        Ev = {h: E[h].values for h in E}
        Emv = {h: EM[h].values for h in EM}
        print('\n=== %s  stocks=%d days=%d split=%d ===' % (mk.upper(), C.shape[1], T, C.index[cut]))
        print('%-8s %-2s %4s | select n / ex / t / p            | holdout n / ex / t / p           | w' % ('rule', 'hz', 'h'))
        for hz, h in HZ.items():
            res[mk][hz] = {'h': h, 'rules': {}}
        for k, (hz0, _) in rules.items():
            for hz, h in HZ.items():
                x = (Emv if k in MKT else Ev)[h]
                u_s = uncond(x, 0, cut - h)
                u_h = uncond(x, cut, T - h)
                s = clus(x, Rm[k], 0, cut - h, h, u_s)
                ho = clus(x, Rm[k], cut, T - h, h, u_h)
                rec = dict(sel=s, hold=ho, sign=sign[k], own=(hz == hz0), market=(k in MKT))
                w = 0.0
                if hz == hz0 and k not in MKT and s['t'] is not None and ho['t'] is not None:
                    # 손으로 정한 방향(sign)과 선택·홀드아웃이 모두 같고, 홀드아웃 |t|>=2 일 때만 가중치.
                    # 방향이 뒤집힌 규칙(flip)은 0 — 반대로 쓰지 않는다(생존편향 가능성이 커서).
                    agree = np.sign(s['t']) == sign[k] and np.sign(ho['t']) == sign[k]
                    if agree and abs(ho['t']) >= TGATE:
                        w = float(sign[k] * np.clip(abs(s['t']) / 3.0, 0.3, 1.5))
                    elif np.sign(ho['t']) == -sign[k] and abs(ho['t']) >= TGATE:
                        rec['flip'] = True
                rec['w'] = round(w, 2)
                res[mk][hz]['rules'][k] = rec
                f = lambda d: '%8d %6.2f %6.1f %.3f' % (d['n'], d['exd'] or 0, d['t'] or 0, d['p'] or 0)
                print('%-8s %-2s %4d | %s | %s | %s' % (k, hz, h, f(s), f(ho), (('%.2f' % w) + (' FLIP' if rec.get('flip') else '')) if rec['own'] else ''))
        for hz, h in HZ.items():
            ws = {k: v['w'] for k, v in res[mk][hz]['rules'].items() if v['own'] and v['w'] != 0}
            sc = np.zeros(C.shape)
            for k, w in ws.items():
                sc += np.where(Rm[k], w, 0.0)
            sc = np.round(np.clip(sc, -3, 3), 4)
            valid = ~np.isnan(Ev[h])
            sv = sc[:cut - h][valid[:cut - h]]
            if len(sv) == 0 or not ws:
                # 점수에 넣을 규칙이 없다 → 전부 '중립'. 기준선(모든 종목-날)의 성적만 남긴다.
                ex0 = Ev[h]
                hr = clus(ex0, np.ones(C.shape, bool), cut, T - h, h, uncond(ex0, cut, T - h))
                res[mk][hz]['thr'] = None
                res[mk][hz]['labels'] = {'mid': dict(p=hr['p'], ex=hr['exd'], exRaw=hr['ex'], n=hr['n'], t=hr['t'])}
                print('  [%s %s] 점수에 넣을 규칙 없음 → 전부 중립 · 기준선 P(win)=%.3f' % (mk, hz, hr['p']))
                continue
            # 점수가 이산적이라 분위 대신: 양수 점수의 중앙값부터 '긍정'(>=), 0 초과는 '약간 긍정'(>) (음수도 대칭).
            # 의미: pos: 점수>=pos · pos1: 점수>pos1(=0) · neg1: 점수<-neg1 · neg: 점수<=-neg ... 여기선 부호 있는 값으로 저장
            ps, ns = sv[sv > 1e-9], sv[sv < -1e-9]
            def top(v):
                if len(v) == 0: return 99.0
                u = np.unique(np.round(np.abs(v), 4)); md = float(np.median(np.abs(v)))
                return round(md, 4) if md > u[0] + 1e-9 else (float(u[1]) if len(u) > 1 else 99.0)
            thr = dict(neg=-top(ns), neg1=0.0, pos1=0.0, pos=top(ps))
            lab = np.full(C.shape, 'mid', dtype=object)
            lab[sc > thr['pos1']] = 'pos1'
            lab[sc >= thr['pos']] = 'pos'
            lab[sc < thr['neg1']] = 'neg1'
            lab[sc <= thr['neg']] = 'neg'
            labs = {}
            ex = Ev[h]
            for L in ('pos', 'pos1', 'mid', 'neg1', 'neg'):
                M = (lab == L)
                hr = clus(ex, M, cut, T - h, h, uncond(ex, cut, T - h))
                sr = clus(ex, M, 0, cut - h, h, uncond(ex, 0, cut - h))
                # ex = 전체 종목 평균 대비(%p) — 원값은 평균이 중앙값보다 커서(오른쪽 꼬리) 늘 + 로 보이므로 exRaw 로만 둔다
                labs[L] = dict(p=hr['p'], ex=hr['exd'], exRaw=hr['ex'], n=hr['n'], t=hr['t'], sel=dict(p=sr['p'], ex=sr['exd'], n=sr['n']))
            res[mk][hz]['thr'] = thr
            res[mk][hz]['labels'] = labs
            print('  [%s %s] 점수 경계 %s  (가중 규칙 %s)' % (mk, hz, {u: round(v, 2) for u, v in thr.items()}, ws))
            rd = lambda v, n: None if v is None else round(v, n)
            for L, d in labs.items():
                print('    %-5s hold n=%8d P(win)=%s ex=%s t=%s | select P=%s ex=%s' % (
                    L, d['n'], rd(d['p'], 3), rd(d['ex'], 2), rd(d['t'], 1), rd(d['sel']['p'], 3), rd(d['sel']['ex'], 2)))
    if out:
        def rnd(o):
            if isinstance(o, float):
                return round(o, 4)
            if isinstance(o, dict):
                return {k: rnd(v) for k, v in o.items()}
            if isinstance(o, list):
                return [rnd(v) for v in o]
            return o
        json.dump(rnd(res), open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
        print('\nwrote', out)


if __name__ == '__main__':
    main()
