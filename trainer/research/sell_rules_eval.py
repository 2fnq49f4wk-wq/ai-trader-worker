#!/usr/bin/env python3
"""보유 종목 매도 신호 검증 (MY 모의계좌 'AI 매도 의견' 근거).

사용: python3 sell_rules_eval.py KR_P.pkl US_P.pkl OUT_DIR [--stage select|final] [--json public/sell-stats.json]
  P.pkl = dict(open/high/low/close/volume → DataFrame[int YYYYMMDD × 종목], 수정주가)
  select: 선택 구간(앞 70%) 표만 출력.  final: 사전 등록 규칙으로 변형을 고른 뒤 홀드아웃(뒤 30%) 표 + JSON.
방법은 같은 폴더의 사전 등록 README(sellab) 와 동일: 포지션 내 첫 발생, 같은 날짜·보유연령 버킷 기준선 대비 초과,
날짜 블록(2h) 군집-강건 t.
"""
import sys, os, pickle, json, numpy as np, pandas as pd

H = (5, 10, 20)
HOLD = 60
NENT = 60000
SEED = 7
COST = {'kr': 0.30, 'us': 0.10}

def wilder(x, n):
    return x.ewm(alpha=1.0 / n, adjust=False).mean()

def features(P):
    C, O, Hh, L, V = (P[k].astype(float) for k in ('close', 'open', 'high', 'low', 'volume'))
    C1 = C.shift(1)
    tr = pd.concat([(Hh - L), (Hh - C1).abs(), (L - C1).abs()]).groupby(level=0).max().reindex(C.index)
    atr = wilder(tr, 14)
    d = C.diff()
    up, dn = wilder(d.clip(lower=0), 14), wilder((-d).clip(lower=0), 14)
    rsi = 100 - 100 / (1 + up / dn.replace(0, np.nan))
    rsi = rsi.where(dn > 0, 100.0).where(C.notna())
    m20 = C.rolling(20).mean(); sd20 = C.rolling(20).std(ddof=0)
    F = dict(C=C, O=O, V=V, atrp=atr / C * 100, rsi=rsi, m20=m20, sd20=sd20,
             m50=C.rolling(50).mean(), ret5=(C / C.shift(5) - 1) * 100,
             ret60=C / C.shift(60) - 1, vavg=V.rolling(20).mean().shift(1),
             gap=(O / C1 - 1) * 100)
    dd = (C < C1).astype(float).where(C1.notna() & C.notna())
    vu = (V > V.shift(1)).astype(float)
    F['down3'] = ((dd + dd.shift(1) + dd.shift(2)) == 3) & ((vu + vu.shift(1) + vu.shift(2)) == 3)
    r = (C / C1 - 1).clip(-0.5, 0.5)
    idx = (1 + r.mean(axis=1).fillna(0)).cumprod()
    F['mkt_bear'] = (idx < idx.rolling(200).mean()).values  # (T,)
    for h in H:
        F['f%d' % h] = (C.shift(-h) / C - 1).clip(-0.5, 1.0) * 100
    return {k: (v.values if hasattr(v, 'values') else v) for k, v in F.items()}, C.index.values

# ── 후보 변형 정의 (README 표와 동일, 29개) ──
VARIANTS = []
def V_(fam, key, ko, params, cur=False):
    VARIANTS.append(dict(fam=fam, key=key, ko=ko, params=params, cur=cur))
for m in (1.5, 2, 2.5, 3):
    V_('stop_atr', 'stop_atr2' if m == 2 else 'stop_atr%s' % str(m).replace('.', 'p'), '손절선(ATR %s배)' % m,
       dict(atrN=14, atrMult=m, stopMin=4, stopMax=15, base='entryAtr'), cur=(m == 2))
V_('target', 'target_2r', '목표 도달(손절폭 2배)', dict(atrN=14, atrMult=2, stopMin=4, stopMax=15, rMult=2, tpMax=40), cur=True)
for lv in (70, 75, 80):
    V_('rsi', 'rsi%d' % lv, 'RSI %d 이상 과열' % lv, dict(rsiN=14, level=lv, onset=True), cur=(lv == 75))
for k in (2, 2.5):
    V_('bb', 'bb_upper' if k == 2 else 'bb_upper2p5', '볼린저 상단(%sσ) 위' % k, dict(bbN=20, bbK=k, onset=True), cur=(k == 2))
for x in (5, 8, 10):
    V_('trend', 'trend_break' if x == 8 else 'trend_break%d' % x, '20일선 아래 + 5일 −%d%%' % x,
       dict(maN=20, ret5Max=-x, onset=True), cur=(x == 8))
for m in (2, 3, 4):
    V_('trail', 'trail_peak%datr' % m, '고점 대비 ATR %d배 하락' % m, dict(atrN=14, trailAtrMult=m, peak='closeSinceEntry'))
V_('ma50', 'ma50_break', '50일선 하향 이탈', dict(maN=50, onset=True))
for r in (2, 3, 4):
    V_('vol', 'vol_spike%d_down' % r, '거래량 %d배 + 하락' % r, dict(volN=20, volMult=r, onset=True))
for g in (3, 4, 5):
    V_('gap', 'gap_down%d' % g, '갭 하락 %d%% 이상' % g, dict(gapPct=g, onset=True))
V_('down3', 'down3_volup', '3일 연속 하락 + 거래량 증가', dict(days=3, onset=True))
for N, x in ((20, 0), (20, 2), (40, 0), (40, 2)):
    V_('time', 'time_stop%d_%d' % (N, x), '%d일 보유 후 +%d%% 미만' % (N, x), dict(days=N, minRet=x))
V_('mkt', 'mkt_below200', '시장 200일선 하향 이탈', dict(maN=200, index='equalWeight', onset=True))

def conds(G, var):
    """G: [E, HOLD+1] 창 배열 dict. 반환: bool [E, HOLD+1] 조건(onset 처리 전)."""
    fam, p = var['fam'], var['params']
    C = G['C']; C0 = C[:, :1]
    with np.errstate(invalid='ignore'):
        if fam in ('stop_atr', 'target'):
            s = np.clip(p['atrMult'] * G['atrp'][:, :1], p['stopMin'], p['stopMax'])
            if fam == 'stop_atr':
                return C <= C0 * (1 - s / 100)
            return C >= C0 * (1 + np.minimum(p['tpMax'], p['rMult'] * s) / 100)
        if fam == 'rsi':
            return G['rsi'] >= p['level']
        if fam == 'bb':
            return C >= G['m20'] + p['bbK'] * G['sd20']
        if fam == 'trend':
            return (C < G['m20']) & (G['ret5'] <= p['ret5Max'])
        if fam == 'trail':
            pk = np.fmax.accumulate(np.where(np.isnan(C), -np.inf, C), axis=1)
            return (pk - C) / pk * 100 >= p['trailAtrMult'] * G['atrp']
        if fam == 'ma50':
            return C < G['m50']
        if fam == 'vol':
            Cp = np.concatenate([G['Cm1'][:, :1], C[:, :-1]], axis=1)
            return (G['V'] >= p['volMult'] * G['vavg']) & (C < Cp)
        if fam == 'gap':
            return G['gap'] <= -p['gapPct']
        if fam == 'down3':
            return G['down3'].astype(bool)
        if fam == 'time':
            c = np.zeros(C.shape, bool)
            c[:, p['days']] = (C[:, p['days']] / C0[:, 0] - 1) * 100 < p['minRet']
            return c
        if fam == 'mkt':
            return G['mkt_bear'].astype(bool)
    raise KeyError(fam)

def first_event(cond, fam):
    cond = np.nan_to_num(cond, nan=0).astype(bool)
    if fam == 'time':
        on = cond[:, 1:]
    else:
        on = cond[:, 1:] & ~cond[:, :-1]       # 상향 진입(전일 거짓 → 당일 참). 포지션 기준 조건은 k=0 이 거짓.
    has = on.any(1)
    k = on.argmax(1) + 1
    return np.where(has)[0], k[has]

def run_market(mk, P, outdir):
    ck = os.path.join(outdir, 'events_%s.pkl' % mk)
    if os.path.exists(ck):
        return pickle.load(open(ck, 'rb'))
    F, dates = features(P)
    T, N = F['C'].shape
    rng = np.random.default_rng(SEED)
    valid = ~np.isnan(F['C']) & ~np.isnan(F['atrp']) & ~np.isnan(F['m50']) & ~np.isnan(F['ret60'])
    valid[T - 2:] = False
    r60 = pd.DataFrame(np.where(valid, F['ret60'], np.nan)).rank(axis=1, pct=True).values
    mom = valid & (r60 >= 0.8) & (F['C'] > F['m50'])
    split = int(0.7 * T)
    res = {'dates': dates, 'split': split, 'T': T, 'mkt_bear': F['mkt_bear']}
    for meth, mask in (('random', valid), ('momentum', mom)):
        flat = np.flatnonzero(mask)
        pick = np.sort(rng.choice(flat, size=min(NENT, flat.size), replace=False))
        et, es = pick // N, pick % N
        kk = np.arange(HOLD + 1)
        tt = et[:, None] + kk[None, :]
        ok = tt < T
        ttc = np.minimum(tt, T - 1)
        ss = np.broadcast_to(es[:, None], tt.shape)
        G = {}
        for f in ('C', 'O', 'V', 'atrp', 'rsi', 'm20', 'sd20', 'm50', 'ret5', 'vavg', 'gap', 'down3', 'f5', 'f10', 'f20'):
            a = F[f][ttc, ss].astype(float)
            a[~ok] = np.nan
            G[f] = a
        G['Cm1'] = F['C'][np.maximum(et - 1, 0), es][:, None]
        G['mkt_bear'] = np.where(ok, F['mkt_bear'][ttc], False)
        # 기준선: 같은 날짜·보유연령 버킷의 모든 보유 포지션-일
        bk = np.where(kk <= 5, 0, np.where(kk <= 20, 1, 2))[None, :].repeat(len(et), 0)
        held = ok & ~np.isnan(G['C'])
        held[:, 0] = False
        key = (ttc * 3 + bk)
        base = {}
        for h in H:
            f = G['f%d' % h]; m = held & ~np.isnan(f)
            s = np.bincount(key[m], weights=f[m], minlength=T * 3)
            c = np.bincount(key[m], minlength=T * 3)
            d = np.bincount(key[m], weights=(f[m] < 0).astype(float), minlength=T * 3)
            base[h] = (s / np.maximum(c, 1), d / np.maximum(c, 1), c)
        ev = {}
        for var in VARIANTS:
            i, k = first_event(conds(G, var), var['fam'])
            t = et[i] + k
            inb = t < T
            i, k, t = i[inb], k[inb], t[inb]
            row = {'t': t, 'k': k, 'bear': F['mkt_bear'][t]}
            keep = ~np.isnan(G['C'][i, k])
            for h in H:
                f = G['f%d' % h][i, k]
                kb = t * 3 + np.where(k <= 5, 0, np.where(k <= 20, 1, 2))
                row['f%d' % h] = f
                row['b%d' % h] = base[h][0][kb]
                row['bd%d' % h] = base[h][1][kb]
            row = {a: b[keep] for a, b in row.items()}
            ev[var['key']] = row
        # 기준선 자체(무조건 보유)의 요약
        res[meth] = {'ev': ev, 'nent': len(et)}
    pickle.dump(res, open(ck, 'wb'))
    return res

def stats(row, sel):
    out = {'n': int(sel.sum())}
    for h in H:
        f, b, bd = row['f%d' % h][sel], row['b%d' % h][sel], row['bd%d' % h][sel]
        m = ~np.isnan(f)
        f, b, bd, t = f[m], b[m], bd[m], row['t'][sel][m]
        x = f - b
        n = len(x)
        if n < 30:
            out['h%d' % h] = dict(ex=None, down=None, raw=None, bdown=None, t=None, n=n); continue
        g = t // (2 * h)
        _, inv = np.unique(g, return_inverse=True)
        S = np.bincount(inv, weights=x - x.mean())
        G = len(S)
        se = np.sqrt((S ** 2).sum() * G / max(G - 1, 1)) / n
        out['h%d' % h] = dict(ex=float(x.mean()), down=float((f < 0).mean()), raw=float(f.mean()),
                              bdown=float(bd.mean()), t=float(x.mean() / se) if se > 0 else None, n=n)
    return out

def fmt(s):
    h = s['h10']
    if h['ex'] is None: return 'n=%6d  (부족)' % s['n']
    return 'n=%6d ex5=%+6.2f ex10=%+6.2f ex20=%+6.2f down10=%.3f(b %.3f) raw10=%+6.2f t10=%+6.2f' % (
        s['n'], s['h5']['ex'] or 0, h['ex'], s['h20']['ex'] or 0, h['down'], h['bdown'], h['raw'], h['t'])

def main():
    a = sys.argv[1:]
    kr, us, outdir = a[0], a[1], a[2]
    stage = a[a.index('--stage') + 1] if '--stage' in a else 'select'
    jpath = a[a.index('--json') + 1] if '--json' in a else None
    os.makedirs(outdir, exist_ok=True)
    allres = {}
    for mk, path in (('kr', kr), ('us', us)):
        P = pickle.load(open(path, 'rb'))
        R = run_market(mk, P, outdir)
        sp, D = R['split'], R['dates']
        print('\n=== %s  선택 %d..%d  홀드아웃 %d..%d  ===' % (mk, D[0], D[sp - 21], D[sp], D[-1]))
        selmask = lambda r: r['t'] < sp - 20
        hoMask = lambda r: r['t'] >= sp
        table = {}
        for meth in ('momentum', 'random'):
            print('-- %s (진입 %d) 선택 구간' % (meth, R[meth]['nent']))
            for var in VARIANTS:
                r = R[meth]['ev'][var['key']]
                s = stats(r, selmask(r))
                table[(meth, var['key'], 'sel')] = s
                print('  %-18s %s%s' % (var['key'], fmt(s), '  [현행]' if var['cur'] else ''))
        # 사전 등록 선택: 가족별 momentum 선택구간 n≥300 중 t10 최소
        chosen = {}
        for var in VARIANTS:
            s = table[('momentum', var['key'], 'sel')]
            t10 = s['h10']['t']
            if s['n'] < 300 or t10 is None: continue
            c = chosen.get(var['fam'])
            if c is None or t10 < table[('momentum', c['key'], 'sel')]['h10']['t']:
                chosen[var['fam']] = var
        print('선택된 변형:', {f: v['key'] for f, v in chosen.items()})
        allres[mk] = (R, table, chosen)
        if stage != 'final': continue
        print('-- 홀드아웃 (한 번)')
        report = [v for v in VARIANTS if v['cur'] or chosen.get(v['fam']) is v]
        for var in report:
            for meth in ('momentum', 'random'):
                r = R[meth]['ev'][var['key']]
                s = stats(r, hoMask(r))
                table[(meth, var['key'], 'ho')] = s
                # 국면별(서술용)
                for nm, bm in (('bull', ~r['bear'].astype(bool)), ('bear', r['bear'].astype(bool))):
                    table[(meth, var['key'], 'ho_' + nm)] = stats(r, hoMask(r) & bm)
            s = table[('momentum', var['key'], 'ho')]
            print('  %-18s mom %s | rnd ex10=%s t10=%s%s%s' % (var['key'], fmt(s),
                  '%+.2f' % table[('random', var['key'], 'ho')]['h10']['ex'] if table[('random', var['key'], 'ho')]['h10']['ex'] is not None else '-',
                  '%+.2f' % table[('random', var['key'], 'ho')]['h10']['t'] if table[('random', var['key'], 'ho')]['h10']['t'] is not None else '-',
                  '  [현행]' if var['cur'] else '', '  [선택]' if chosen.get(var['fam']) is var else ''))
            for nm in ('bull', 'bear'):
                q = table[('momentum', var['key'], 'ho_' + nm)]
                print('      %s %s' % (nm, fmt(q)))
    if stage == 'final' and jpath:
        out = {'v': 1, 'asOf': '2026-11-05',
               'note': ('보유 포지션에서 신호가 처음 뜬 날 이후 계속 보유했을 때의 전방수익을, 같은 날·같은 보유기간의 다른 보유 종목 평균과 비교(ex, %p). '
                        '홀드아웃(각 시장 최근 30% 기간) · 모멘텀형 진입 기준. down = 추가 하락 확률. useful = 10일 초과 음수 & t≤−2. '
                        '현 구성종목만 쓴 생존편향 있음. 투자 권유 아님.'),
               'markets': {}}
        for mk, (R, table, chosen) in allres.items():
            M = {}
            for var in VARIANTS:
                if not (var['cur'] or chosen.get(var['fam']) is var): continue
                s = table[('momentum', var['key'], 'ho')]; rs = table[('random', var['key'], 'ho')]
                t10 = s['h10']['t']; ex10 = s['h10']['ex']
                useful = bool(ex10 is not None and ex10 < 0 and t10 is not None and t10 <= -2)
                label = 'sell' if useful else ('hold' if (ex10 is not None and ex10 > 0 and t10 is not None and t10 >= 2) else 'weak')
                rd = lambda v, d=2: None if v is None else round(v, d)
                e = {'ko': var['ko'], 'n': s['n']}
                for h in H:
                    e['h%d' % h] = {'ex': rd(s['h%d' % h]['ex']), 'down': rd(s['h%d' % h]['down'], 3), 'raw': rd(s['h%d' % h]['raw'])}
                e['bdown10'] = rd(s['h10']['bdown'], 3)
                e['t10'] = rd(t10)
                e['rnd10'] = {'ex': rd(rs['h10']['ex']), 't': rd(rs['h10']['t'])}
                bb = table[('momentum', var['key'], 'ho_bear')]['h10']; bu = table[('momentum', var['key'], 'ho_bull')]['h10']
                e['regime10'] = {'bull': rd(bu['ex']), 'bear': rd(bb['ex'])}
                e['useful'] = useful
                e['label'] = label
                e['current'] = var['cur']
                e['selected'] = chosen.get(var['fam']) is var
                e['params'] = var['params']
                M[var['key']] = e
            out['markets'][mk] = M
        s = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
        open(jpath, 'w').write(s)
        print('JSON', jpath, len(s.encode()), 'bytes')

if __name__ == '__main__':
    main()
