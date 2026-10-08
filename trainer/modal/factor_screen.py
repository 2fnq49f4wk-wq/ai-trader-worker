"""[V33.529] ★Vibe-Trading 알파 동물원 → 우리 유니버스 실측 선별★ (아무것도 업로드하지 않는다)

사용자: "홍콩대 오픈소스 vibe-trading 에서 소스 가져와 수익률 분야 대폭 업그레이드".
그대로 붙이면 안 된다 — 이 저장소가 배운 것: '남의 표에서 좋던 것' 은 우리 표본에서 다시 재야 한다(V33.516→518).
여기서는 Vibe-Trading 의 Alpha158(qlib) · Alpha101 · GTJA191 공식(vt/, MIT·Apache 표기 보존)을
★우리 미국·한국 일봉★ 위에서 계산하고, 각 팩터가 앞으로의 수익률을 맞히는지 잰다.

잣대(모두 시장별 · 같은 날 종목 사이 순위 — 시장 전체 방향은 지운다):
  · 랭크 IC  = 그날 팩터 순위 vs 다음날 종가 → h일 뒤 종가 수익률 순위의 상관(실행 지연 1일 — 같은 종가 체결 착시 제거)
  · t        = 모든 날 IC 평균 / Newey-West(지연 h) 표준오차 — 겹친 수익률 창의 자기상관 보정
  · 안정성   = 기간을 4등분해 IC 부호가 몇 구간에서 같은가
  · 중복도   = 우리 모델이 이미 보는 기본 칸(5·20일 수익률 · 20일 변동성 · RSI14)과의 평균 순위상관 최대값
  · 잔차 IC  = 그 기본 칸 4개를 그날 회귀로 빼고 남은 순위의 IC — ★새 정보★ 가 있는지
★미리 정한 통과 기준★(다중검정 보정 — 약 450 팩터 × 2시장 × 2지평):
  |t| ≥ max(3.5, ★위약 문턱★) · 4구간 중 ≥3 같은 부호 · ★앞·뒤 절반 각각 |t|≥2 같은 부호★ · IC 잰 날 ≥ 250
  · 잔차 IC 의 |t| ≥ 2.5 · 중복도 < 0.7
  위약 문턱: 미래수익의 종목 이름표를 고정 순열로 섞어(시계열 구조 보존 · 진짜 연결만 끊음) 모든 팩터를 다시 재고,
  그 |t| 의 최댓값(위약 8벌 · 가족 단위 오류율 ≈ 1/9). 합성 실력 0 실험에서 Newey-West 만으로는 450개 중 3~5개가 통과했다(최대 |t| 5.7) — 이게 그 구멍을 막는다.
"""
from __future__ import annotations

import glob
import importlib
import math
import os
import signal
import sys
import time

import numpy as np

HORIZONS = (5, 20)
MIN_NAMES = 40
PASS_T, PASS_RES_T, PASS_WIN, MAX_RED = 3.5, 2.5, 3, 0.7
ZOOS = ("qlib158", "alpha101", "gtja191", "academic")   # [V33.531] academic(BAB·Carhart·52주고점·비유동성·왜도·단기반전 …) 추가
PER_FACTOR_SEC = 120
PASS_HALF_T = 2.0      # 앞·뒤 절반 각각 |t| ≥ 2 · 같은 부호(반분 재현)
MIN_DAYS = 250         # IC 를 잰 날이 1년 미만인 팩터는 판정하지 않는다(긴 예열 팩터)
N_PLACEBO = 8          # 위약: 종목 이름표를 고정 순열로 섞은 미래수익 — 시계열 구조(지속성·겹친 창)는 그대로, 진짜 연결만 끊는다
PLACEBO_Q = 1.0        # 통과 문턱 = max(PASS_T, 위약 |t| 의 ★최댓값★) — 시장·지평별. 99% 분위로는 450개 중 4~5개가 우연히 넘었다(합성 실험) —
                       #   팩터 '모두' 를 한 가족으로 보고 가족 최댓값으로 막는다(위약 8벌의 최대 → 가족 오류율 ≈ 1/9)


def _vt_path():
    for p in ("/root/vt", os.path.join(os.path.dirname(os.path.abspath(__file__)), "vt")):
        if os.path.isdir(os.path.join(p, "src", "factors")):
            return p
    return None


def build_wide(daily, mkt_by_sym, market, day_key_of):
    """일봉 {sym: {t,o?,h,l,c,v}} → 날짜×종목 넓은 표 6장(open·high·low·close·volume·vwap·amount)."""
    import pandas as pd
    cols = {}
    for s, bd in daily.items():
        if mkt_by_sym.get(s, "us") != market or not bd or not bd.get("t"):
            continue
        n = len(bd["t"])
        if n < 80:
            continue
        idx = [day_key_of(t) for t in bd["t"]]
        c = np.asarray(bd["c"], dtype=float)
        h = np.asarray(bd.get("h") or bd["c"], dtype=float)
        l = np.asarray(bd.get("l") or bd["c"], dtype=float)
        o = np.asarray(bd.get("o") or ([np.nan] + list(c[:-1])), dtype=float)   # 시가가 없으면 전일 종가(갭 0) — 표시만
        v = np.asarray(bd.get("v") or [np.nan] * n, dtype=float)
        df = pd.DataFrame({"open": o, "high": h, "low": l, "close": c, "volume": v}, index=idx)
        df = df[~df.index.duplicated(keep="last")]
        cols[s] = df
    if len(cols) < MIN_NAMES:
        return None
    out = {}
    for k in ("open", "high", "low", "close", "volume"):
        out[k] = pd.DataFrame({s: d[k] for s, d in cols.items()}).sort_index()
    out["close"] = out["close"].where(out["close"] > 0)
    out["vwap"] = (out["high"] + out["low"] + out["close"]) / 3.0          # 체결가중 평균이 없어 대표가격으로 대신(표기)
    out["amount"] = out["close"] * out["volume"]
    out["returns"] = out["close"].pct_change(fill_method=None)
    return out


def _row_rank(df):
    return df.rank(axis=1, pct=True)


def _row_corr(a, b):
    """같은 날(행)끼리 상관 — 둘 다 값이 있는 칸만. 반환: 날짜별 상관(Series) · 칸 수."""
    m = a.notna() & b.notna()
    a = a.where(m)
    b = b.where(m)
    n = m.sum(axis=1)
    am = a.sub(a.mean(axis=1), axis=0)
    bm = b.sub(b.mean(axis=1), axis=0)
    num = (am * bm).sum(axis=1)
    den = np.sqrt((am ** 2).sum(axis=1) * (bm ** 2).sum(axis=1))
    r = num / den.replace(0, np.nan)
    return r.where(n >= MIN_NAMES), n


def _ic_stats(ic, h):
    """모든 날의 IC 평균 · ★Newey-West(지연 h)★ 표준오차 — 앞으로 h일 수익률 창이 겹쳐 생기는 자기상관을 보정한다.
    (처음엔 h일마다 한 날만 뽑았다 — 합성 실험에서 시작일에 따라 평균이 −0.002 ↔ +0.086 로 뒤집혀 실력 0 팩터가 t 3 을 냈다.)"""
    s = ic.dropna()
    n = len(s)
    if n < 4 * h or n < 40:
        return None
    x = s.values - s.values.mean()
    L = max(2, int(2 * h))   # 지평의 2배 — 오래 가는 팩터(60일 창)는 h 만으로는 자기상관이 덜 걷힌다(합성 실력 0 에서 t 3.1)
    g0 = float(np.dot(x, x) / n)
    var = g0
    for k in range(1, L + 1):
        gk = float(np.dot(x[k:], x[:-k]) / n)
        var += 2.0 * (1.0 - k / (L + 1.0)) * gk
    var = max(var, g0 * 1e-3)
    m = float(s.values.mean())
    t = m / math.sqrt(var / n)
    # [반분 재현] 앞 절반 · 뒤 절반 각각의 t(같은 Newey-West) — 한 구간의 우연한 연결이 전체 t 를 끌어올린 경우를 거른다
    halves = []
    for part in np.array_split(s.values, 2):
        xp = part - part.mean(); npn = len(part)
        if npn < 2 * L + 10:
            halves.append(0.0); continue
        vp = float(np.dot(xp, xp) / npn)
        for k in range(1, L + 1):
            vp += 2.0 * (1.0 - k / (L + 1.0)) * float(np.dot(xp[k:], xp[:-k]) / npn)
        vp = max(vp, float(np.dot(xp, xp) / npn) * 1e-3)
        halves.append(float(part.mean()) / math.sqrt(vp / npn))
    q = np.array_split(s.values, 4)
    signs = [np.sign(np.nanmean(v)) for v in q if len(v)]
    same = max(sum(1 for v in signs if v > 0), sum(1 for v in signs if v < 0))
    return {"ic": m, "t": t, "n": n, "win": same, "half": halves}


def _residualize(fr, bases):
    """그날 횡단면에서 기본 칸 순위로 회귀하고 남은 것(새 정보)."""
    out = fr.copy() * np.nan
    B = [b.reindex_like(fr) for b in bases]
    for d in fr.index:
        y = fr.loc[d].values
        X = np.column_stack([b.loc[d].values for b in B])
        ok = np.isfinite(y) & np.all(np.isfinite(X), axis=1)
        if ok.sum() < MIN_NAMES:
            continue
        Xo = np.column_stack([np.ones(ok.sum()), X[ok]])
        beta, *_ = np.linalg.lstsq(Xo, y[ok], rcond=None)
        r = np.full(len(y), np.nan)
        r[ok] = y[ok] - Xo @ beta
        out.loc[d] = r
    return out


class _Timeout(Exception):
    pass


def _alarm(sig, frm):
    raise _Timeout()


def load_factors(log=print):
    vt = _vt_path()
    if vt is None:
        log("   ⚠️ vt/ 를 못 찾았다 — 팩터 선별 생략")
        return []
    if vt not in sys.path:
        sys.path.insert(0, vt)
    fs = []
    for z in ZOOS:
        for p in sorted(glob.glob(os.path.join(vt, "src", "factors", "zoo", z, "*.py"))):
            name = os.path.basename(p)[:-3]
            if name.startswith("_"):
                continue
            try:
                mod = importlib.import_module("src.factors.zoo.%s.%s" % (z, name))
                meta = getattr(mod, "__alpha_meta__", {}) or {}
                if callable(getattr(mod, "compute", None)):
                    fs.append((meta.get("id") or (z + "_" + name), mod.compute, set(meta.get("columns_required") or ["close"])))
            except Exception as e:  # noqa: BLE001 — 한 팩터가 깨져도 나머지는 잰다
                log("   · 팩터 불러오기 실패 %s/%s: %s" % (z, name, str(e)[:80]))
    return fs


def screen(daily, mkt_by_sym, day_key_of, log=print, limit_factors=None):
    import pandas as pd
    t0 = time.time()
    facs = load_factors(log)
    if limit_factors:
        facs = facs[:limit_factors]
    log("   ── [팩터선별] Vibe-Trading 동물원 %d개(qlib158·alpha101·gtja191) × 시장 × 지평 %s ──" % (len(facs), "/".join("%dd" % h for h in HORIZONS)))
    results = []
    thr = {}
    use_alarm = hasattr(signal, "SIGALRM")
    if use_alarm:
        signal.signal(signal.SIGALRM, _alarm)
    for mk in ("us", "kr"):
        P = build_wide(daily, mkt_by_sym, mk, day_key_of)
        if P is None:
            log("   · %s 종목 부족 — 생략" % mk)
            continue
        C = P["close"]
        log("   · %s 넓은 표: %d일 × %d종목 (%s ~ %s)" % (mk, C.shape[0], C.shape[1], C.index[0], C.index[-1]))
        fwd = {h: _row_rank(C.shift(-(h + 1)) / C.shift(-1) - 1.0) for h in HORIZONS}
        _rng = np.random.default_rng(20261008)
        _perms = [_rng.permutation(C.shape[1]) for _ in range(N_PLACEBO)]
        fwd_pl = {h: [pd.DataFrame(fwd[h].values[:, pm], index=fwd[h].index, columns=fwd[h].columns) for pm in _perms] for h in HORIZONS}
        placebo_t = {h: [] for h in HORIZONS}
        r5 = C / C.shift(5) - 1.0
        r20 = C / C.shift(20) - 1.0
        vol20 = P["returns"].rolling(20, min_periods=15).std()
        d = C.diff()
        up = d.clip(lower=0).rolling(14, min_periods=10).mean()
        dn = (-d.clip(upper=0)).rolling(14, min_periods=10).mean()
        rsi = 100 - 100 / (1 + up / dn.replace(0, np.nan))
        bases = [_row_rank(x) for x in (r5, r20, vol20, rsi)]
        avail = {"open", "high", "low", "close", "volume", "vwap", "amount", "returns"}
        for fid, fn, need in facs:
            if not need <= avail:
                continue
            tf = time.time()
            try:
                if use_alarm:
                    signal.alarm(PER_FACTOR_SEC)
                F = fn({k: P[k] for k in avail})
                if use_alarm:
                    signal.alarm(0)
            except _Timeout:
                log("   · %s 시간초과(%ds) — 생략" % (fid, PER_FACTOR_SEC))
                continue
            except Exception as e:  # noqa: BLE001
                if use_alarm:
                    signal.alarm(0)
                log("   · %s 계산 실패: %s" % (fid, str(e)[:80]))
                continue
            if not isinstance(F, pd.DataFrame) or F.shape[1] < MIN_NAMES:
                continue
            F = F.replace([np.inf, -np.inf], np.nan)
            FR = _row_rank(F.reindex_like(C))
            red = 0.0
            for b in bases:
                rc, _ = _row_corr(FR, b)
                v = rc.dropna()
                if len(v):
                    red = max(red, abs(float(v.mean())))
            row = {"id": fid, "m": mk, "red": red, "sec": round(time.time() - tf, 1)}
            res = None
            for h in HORIZONS:
                ic, _ = _row_corr(FR, fwd[h])
                st = _ic_stats(ic, h)
                if st is None:
                    continue
                row["h%d" % h] = st
                for fp in fwd_pl[h]:
                    icp, _ = _row_corr(FR, fp)
                    sp = _ic_stats(icp, h)
                    if sp is not None:
                        placebo_t[h].append(abs(sp["t"]))
            # 잔차 IC 는 비싸다 — 1차 기준(|t|≥PASS_T · 안정성)을 넘은 것만 잰다(위약 문턱은 더 높을 수 있다 — 판정은 뒤에서)
            for h in HORIZONS:
                st = row.get("h%d" % h)
                if st and abs(st["t"]) >= PASS_T and st["win"] >= PASS_WIN and red < MAX_RED:
                    if res is None:
                        res = _residualize(FR, bases)
                    ic2, _ = _row_corr(_row_rank(res), fwd[h])
                    st["res"] = _ic_stats(ic2, h)
            results.append(row)
        thr[mk] = {h: max(PASS_T, float(np.quantile(placebo_t[h], PLACEBO_Q)) if placebo_t[h] else PASS_T) for h in HORIZONS}
        log("   · %s 위약 문턱(|t| 최댓값 · 위약 %d벌): %s" % (mk, N_PLACEBO, " · ".join("%dd %.2f(위약 최대 %.2f)" % (
            h, thr[mk][h], max(placebo_t[h]) if placebo_t[h] else 0) for h in HORIZONS)))
        log("   · %s 끝 — 누적 %d행 · %.0fs" % (mk, len(results), time.time() - t0))
    # ── 보고 ──
    def _passes(r, h):
        st = r.get("h%d" % h)
        rs = st and st.get("res")
        T = (thr.get(r["m"]) or {}).get(h, PASS_T)
        hv = (st or {}).get("half") or [0.0, 0.0]
        return bool(st and abs(st["t"]) >= T and st["win"] >= PASS_WIN and st["n"] >= MIN_DAYS
                    and all(abs(x) >= PASS_HALF_T and np.sign(x) == np.sign(st["ic"]) for x in hv) and r["red"] < MAX_RED and rs and abs(rs["t"]) >= PASS_RES_T
                    and np.sign(rs["ic"]) == np.sign(st["ic"]))
    for mk in ("us", "kr"):
        for h in HORIZONS:
            rows = [r for r in results if r["m"] == mk and r.get("h%d" % h)]
            rows.sort(key=lambda r: -abs(r["h%d" % h]["t"]))
            log("   ── [팩터선별] %s · %dd — |t| 상위 20 (IC · t · 4구간 같은부호 · 중복도 · 잔차IC·t) ──" % (mk, h))
            for r in rows[:20]:
                st = r["h%d" % h]
                rs = st.get("res")
                log("      %-22s IC %+.4f  t %+6.2f  반분 %+.1f/%+.1f  구간 %d/4  일 %d  중복 %.2f  잔차 %s%s" % (
                    r["id"][:22], st["ic"], st["t"], (st.get("half") or [0, 0])[0], (st.get("half") or [0, 0])[1], st["win"], st["n"], r["red"],
                    ("—" if not rs else "%+.4f·t%+.2f" % (rs["ic"], rs["t"])), "  ★통과" if _passes(r, h) else ""))
    passed = [(r["id"], r["m"], h, r["h%d" % h]["ic"], r["h%d" % h]["t"]) for r in results for h in HORIZONS if _passes(r, h)]
    log("   ── [팩터선별] 미리 정한 기준 통과 %d건 (|t|≥max(%.1f, 위약문턱) · 구간≥%d/4 · 중복<%.1f · 잔차|t|≥%.1f) · %.0fs ──" % (
        len(passed), PASS_T, PASS_WIN, MAX_RED, PASS_RES_T, time.time() - t0))
    for p in passed:
        log("      ★ %s · %s · %dd · IC %+.4f · t %+.2f" % p)
    return {"rows": results, "passed": passed, "thr": thr}
