# -*- coding: utf-8 -*-
"""
══════════════════════════════════════════════════════════════════════════════════════
[V33.419] OMNI — 하나의 복합 모델 (분봉 기준 · 장타·단타·여러 매매법을 한 모델이 배운다)

사용자 지시: "ai 모델 전면 재설계 · 분봉 기준 · 하나의 모델로 장타·단타·다양한 매매법을
학습하고 사용 · 사실상 의미 없는 모델은 제거하고 그 역할을 전부 하는 복합 모델".

■ 이 파일이 ★기준 구현★ 이다
  피처 정의의 유일한 진본은 여기 있는 feature_point() 다. 워커(JS)의 omniFeatures() 는
  이것을 ★그대로 옮긴 것★ 이고, tools/check-omni-parity.mjs 가 같은 봉에서 두 구현이
  같은 값을 내는지 확인한다. 한쪽만 고치면 그 검사가 배포를 막는다.
  (이 저장소가 반복해서 겪은 사고 — "학습과 추론이 다른 피처를 본다" — 를 구조로 막는다.)

■ 입력 — 원시 봉만 (V33.418 데이터층)
  5분봉(기준봉) · 일봉. 60분봉은 5분봉을 ★시계 정각 경계★ 로 묶어 만든다(양쪽이 같은 규칙).
  모든 창은 ★고정 길이★ 다 — 학습 쪽 이력이 아무리 길어도 추론 쪽이 가진 만큼만 본다.
  그래야 두 쪽이 같은 값을 낸다(학습은 2년치, 추론은 5일치를 가져도).

■ 모든 수학은 단순하게
  EMA 처럼 ★초기값이 이력 길이에 따라 달라지는★ 지표는 쓰지 않는다(SMA 로 대신한다).
  RSI 는 평활 없는 비율형(상승합/(상승합+하락합)). 표준편차는 모집단(÷n).
  그래야 두 언어에서 같은 입력이 같은 출력을 낸다.
══════════════════════════════════════════════════════════════════════════════════════
"""
import math

OMNI_VER = 1
BASE_SEC = 300                 # 5분봉 — 워커 OMNIBARS.baseSec 와 같아야 한다
SESS_MIN = 390                 # 정규장 길이(분) — 미국 09:30~16:00 · 한국 09:00~15:30 둘 다 390
OPEN_MIN = {"us": 570, "kr": 540}
H_LOOKBACK = 312               # 60분봉을 만들 때 보는 5분봉 수(≈4거래일) — 추론 쪽도 정확히 이만큼
D_LOOKBACK = 260               # 일봉 창 — 252일 고가를 보려면 이만큼

FEATS = [
    # 5분봉(단타 미시구조)
    "m_r3", "m_r6", "m_r12", "m_r24", "m_rv12", "m_rv48", "m_vr", "m_rsi14", "m_bbz20",
    "m_ofi12", "m_rho24", "m_relvol12", "m_range48", "m_hl12",
    # 세션(장중 위치)
    "s_frac", "s_vwapdev", "s_ret", "s_gap",
    # 60분봉(중기)
    "h_r6", "h_r24", "h_rv24", "h_rsi14", "h_sma20gap",
    # 일봉(장타)
    "d_r1", "d_r5", "d_r20", "d_r60", "d_rv20", "d_rv60", "d_rsi14", "d_sma50gap", "d_sma200gap",
    "d_hi252", "d_lo20", "d_atr14", "d_volr", "d_bbz20",
    # 맥락
    "x_mkt", "x_dow", "x_tod",
]
NAN = float("nan")

# 매매법(범주) — 한 모델이 여러 매매법을 배우게 하는 입력. 우선순위대로 첫 번째로 맞는 것.
SETUPS = ["generic", "breakout", "pullback", "meanrev", "momentum", "gap", "trend"]
# 지평(범주) — 한 모델이 장타·단타를 같이 배우게 하는 입력
HORIZONS = ["30m", "60m", "1d", "5d", "20d"]
H_BARS = {"30m": 6, "60m": 12, "1d": 78}   # 5분봉 수
H_DAYS = {"5d": 5, "20d": 20}              # 일봉 수


# ─────────────────────────── 시각 (워커 getUSEt/getKST 와 같은 규칙) ───────────────────────────
def _days_in_month_sunday(y, m, n):
    """y년 m월(1~12)의 n번째 일요일 날짜."""
    import datetime as _dt
    first = _dt.date(y, m, 1)
    dow = (first.weekday() + 1) % 7         # 0=일
    first_sun = 1 if dow == 0 else 8 - dow
    return first_sun + (n - 1) * 7


def us_offset_h(t_sec):
    """미국 동부 UTC 오프셋(시간). 3월 둘째 일요일 07:00 UTC ~ 11월 첫째 일요일 06:00 UTC 는 −4.
    워커는 IANA 표준시 DB 를 먼저 쓰는데, 현행 미국법(2007~) 아래서 이 규칙과 같다.
    Modal 이미지에 tzdata 가 없을 수 있어 규칙을 직접 쓴다(검사가 서머타임 경계를 확인한다)."""
    import datetime as _dt
    y = _dt.datetime.fromtimestamp(t_sec, _dt.timezone.utc).year
    s = _dt.datetime(y, 3, _days_in_month_sunday(y, 3, 2), 7, 0, 0, tzinfo=_dt.timezone.utc)
    e = _dt.datetime(y, 11, _days_in_month_sunday(y, 11, 1), 6, 0, 0, tzinfo=_dt.timezone.utc)
    ss = s.timestamp()
    es = e.timestamp()
    return -4 if ss <= t_sec < es else -5


def local_parts(t_sec, mkt):
    """(현지 분 0~1439, 요일 0=일, 현지 날짜 키 yyyymmdd)"""
    import datetime as _dt
    off = us_offset_h(t_sec) if mkt == "us" else 9
    d = _dt.datetime.fromtimestamp(t_sec + off * 3600, _dt.timezone.utc)
    return d.hour * 60 + d.minute, (d.weekday() + 1) % 7, d.year * 10000 + d.month * 100 + d.day


def day_key_of_daily(t_sec):
    """일봉 t 는 현지 날짜 00:00 UTC 로 저장돼 있다(V33.418 _obDayKey)."""
    import datetime as _dt
    d = _dt.datetime.fromtimestamp(t_sec, _dt.timezone.utc)
    return d.year * 10000 + d.month * 100 + d.day


# ─────────────────────────── 작은 도구 (JS 와 같은 순서로 더한다) ───────────────────────────
def _lr(a, b):
    return math.log(a / b) if (a is not None and b is not None and a > 0 and b > 0) else NAN


def _mean(xs):
    s = 0.0
    for x in xs:
        s += x
    return s / len(xs) if xs else NAN


def _pstd(xs):
    n = len(xs)
    if n < 2:
        return NAN
    m = _mean(xs)
    s = 0.0
    for x in xs:
        s += (x - m) * (x - m)
    return math.sqrt(s / n)


def _rsi(c, i, n):
    if i - n < 0:
        return NAN
    g = 0.0
    lo = 0.0
    for k in range(i - n + 1, i + 1):
        d = c[k] - c[k - 1]
        if d > 0:
            g += d
        else:
            lo += -d
    return 0.5 if g + lo == 0 else g / (g + lo)


def _bbz(c, i, n):
    if i - n + 1 < 0:
        return NAN
    w = c[i - n + 1:i + 1]
    s = _pstd(w)
    return (c[i] - _mean(w)) / s if s > 0 else NAN


def _rets(c, i, n):
    """c[i-n+1..i] 까지 n 개의 1봉 로그수익."""
    if i - n < 0:
        return None
    return [_lr(c[k], c[k - 1]) for k in range(i - n + 1, i + 1)]


def _corr1(r):
    if r is None or len(r) < 3:
        return NAN
    a = r[:-1]
    b = r[1:]
    ma = _mean(a)
    mb = _mean(b)
    sab = 0.0
    saa = 0.0
    sbb = 0.0
    for k in range(len(a)):
        sab += (a[k] - ma) * (b[k] - mb)
        saa += (a[k] - ma) * (a[k] - ma)
        sbb += (b[k] - mb) * (b[k] - mb)
    return sab / math.sqrt(saa * sbb) if saa > 0 and sbb > 0 else NAN


def _fin(x):
    return x if (isinstance(x, float) and math.isfinite(x)) or isinstance(x, int) else NAN


# ─────────────────────────── 60분봉 — 5분봉을 정각 경계로 묶는다 ───────────────────────────
def hourly_closes(t, c, i):
    """5분봉 [i-H_LOOKBACK+1 .. i] 를 floor(t/3600) 칸으로 묶은 종가열. ★창은 고정★."""
    a = max(0, i - H_LOOKBACK + 1)
    out = []
    cur = None
    for k in range(a, i + 1):
        key = (t[k] // 3600) * 3600
        if key != cur:
            out.append(c[k])
            cur = key
        else:
            out[-1] = c[k]
    return out


# ─────────────────────────── 한 시점의 피처 (기준 구현) ───────────────────────────
def feature_point(b5, bd, i, mkt, daily_row=False, j=None):
    """
    b5: 5분봉 dict(t,o,h,l,c,v) · bd: 일봉 dict · i: 5분봉 결정 인덱스(그 봉까지 확정)
    daily_row=True 면 장중 정보 없이 일봉 j 까지만 쓴다(장타 행).
    반환: FEATS 순서의 값 리스트 + setup 인덱스.
    ★미래를 보지 않는다★ — i(또는 j) 뒤의 봉은 한 칸도 읽지 않는다.
    """
    f = {k: NAN for k in FEATS}
    f["x_mkt"] = 0.0 if mkt == "us" else 1.0

    if not daily_row:
        t, o, h, l, c, v = b5["t"], b5["o"], b5["h"], b5["l"], b5["c"], b5["v"]
        # 5분봉
        for key, k in (("m_r3", 3), ("m_r6", 6), ("m_r12", 12), ("m_r24", 24)):
            f[key] = _lr(c[i], c[i - k]) if i - k >= 0 else NAN
        r12 = _rets(c, i, 12)
        r48 = _rets(c, i, 48)
        f["m_rv12"] = _pstd(r12) if r12 is not None else NAN
        f["m_rv48"] = _pstd(r48) if r48 is not None else NAN
        f["m_vr"] = (f["m_rv12"] / f["m_rv48"]) if (f["m_rv48"] == f["m_rv48"] and f["m_rv48"] > 0
                                                  and f["m_rv12"] == f["m_rv12"]) else NAN
        f["m_rsi14"] = _rsi(c, i, 14)
        f["m_bbz20"] = _bbz(c, i, 20)
        if i - 12 >= 0:
            num = 0.0
            den = 0.0
            for k in range(i - 11, i + 1):
                d = c[k] - c[k - 1]
                sg = 1.0 if d > 0 else (-1.0 if d < 0 else 0.0)
                num += sg * v[k]
                den += v[k]
            f["m_ofi12"] = num / den if den > 0 else NAN
        f["m_rho24"] = _corr1(_rets(c, i, 24))
        if i - 59 >= 0:
            s12 = 0.0
            for k in range(i - 11, i + 1):
                s12 += v[k]
            s60 = 0.0
            for k in range(i - 59, i + 1):
                s60 += v[k]
            f["m_relvol12"] = s12 / (s60 / 5.0) if s60 > 0 else NAN
        if i - 47 >= 0:
            lo = min(l[i - 47:i + 1])
            hi = max(h[i - 47:i + 1])
            f["m_range48"] = (c[i] - lo) / (hi - lo) if hi > lo else NAN
        if i - 11 >= 0:
            f["m_hl12"] = _lr(max(h[i - 11:i + 1]), min(l[i - 11:i + 1]))

        # 세션 — 봉 i 와 같은 현지 날짜의 첫 봉부터
        mi, dow, dk = local_parts(t[i], mkt)
        f["x_dow"] = float(dow)
        f["x_tod"] = (mi + BASE_SEC // 60) / 1440.0
        f["s_frac"] = (mi + BASE_SEC // 60 - OPEN_MIN[mkt]) / float(SESS_MIN)
        s0 = i
        while s0 - 1 >= 0 and local_parts(t[s0 - 1], mkt)[2] == dk:
            s0 -= 1
        pv = 0.0
        vv = 0.0
        for k in range(s0, i + 1):
            tp = (h[k] + l[k] + c[k]) / 3.0
            pv += tp * v[k]
            vv += v[k]
        f["s_vwapdev"] = _lr(c[i], pv / vv) if vv > 0 else NAN
        f["s_ret"] = _lr(c[i], o[s0])
        # 전일 종가 — 일봉 중 날짜 < 오늘인 마지막 봉
        jj = _last_daily_before(bd, dk)
        f["s_gap"] = _lr(o[s0], bd["c"][jj]) if jj is not None else NAN
        # 60분봉
        hc = hourly_closes(t, c, i)
        n = len(hc)
        f["h_r6"] = _lr(hc[-1], hc[-7]) if n >= 7 else NAN
        f["h_r24"] = _lr(hc[-1], hc[-25]) if n >= 25 else NAN
        if n >= 25:
            f["h_rv24"] = _pstd([_lr(hc[k], hc[k - 1]) for k in range(n - 24, n)])
        f["h_rsi14"] = _rsi(hc, n - 1, 14) if n >= 15 else NAN
        f["h_sma20gap"] = _lr(hc[-1], _mean(hc[-20:])) if n >= 20 else NAN
        j = jj
    else:
        f["x_dow"] = NAN
        f["x_tod"] = NAN

    # 일봉 — j 까지(장중 행이면 '오늘 이전 마지막 확정일')
    if j is not None and j >= 0:
        _daily_feats(bd, j, f)

    vals = [_fin(float(f[k])) if f[k] == f[k] else NAN for k in FEATS]
    return vals, setup_of(f, daily_row, b5, i, bd, j)


def _last_daily_before(bd, dk):
    """일봉 중 현지 날짜 키가 dk 보다 작은 마지막 인덱스(없으면 None). 이분 탐색."""
    t = bd["t"]
    lo, hi = 0, len(t) - 1
    ans = None
    while lo <= hi:
        mid = (lo + hi) // 2
        if day_key_of_daily(t[mid]) < dk:
            ans = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return ans


def _daily_feats(bd, j, f):
    C, H, L, V = bd["c"], bd["h"], bd["l"], bd["v"]
    a = max(0, j - D_LOOKBACK + 1)                 # ★고정 창★ — 추론 쪽도 이만큼만 본다
    for key, k in (("d_r1", 1), ("d_r5", 5), ("d_r20", 20), ("d_r60", 60)):
        f[key] = _lr(C[j], C[j - k]) if j - k >= a else NAN
    for key, n in (("d_rv20", 20), ("d_rv60", 60)):
        if j - n >= a:
            f[key] = _pstd([_lr(C[k], C[k - 1]) for k in range(j - n + 1, j + 1)])
    f["d_rsi14"] = _rsi(C, j, 14) if j - 14 >= a else NAN
    if j - 49 >= a:
        f["d_sma50gap"] = _lr(C[j], _mean(C[j - 49:j + 1]))
    if j - 199 >= a:
        f["d_sma200gap"] = _lr(C[j], _mean(C[j - 199:j + 1]))
    if j - 251 >= a:
        f["d_hi252"] = _lr(C[j], max(H[j - 251:j + 1]))
    if j - 19 >= a:
        f["d_lo20"] = _lr(C[j], min(L[j - 19:j + 1]))
    if j - 14 >= a:
        s = 0.0
        for k in range(j - 13, j + 1):
            tr = max(H[k] - L[k], abs(H[k] - C[k - 1]), abs(L[k] - C[k - 1]))
            s += tr
        f["d_atr14"] = (s / 14.0) / C[j] if C[j] > 0 else NAN
    if j - 59 >= a:
        s20 = 0.0
        for k in range(j - 19, j + 1):
            s20 += V[k]
        s60 = 0.0
        for k in range(j - 59, j + 1):
            s60 += V[k]
        f["d_volr"] = (s20 / 20.0) / (s60 / 60.0) if s60 > 0 else NAN
    if j - 19 >= a:
        w = C[j - 19:j + 1]
        s = _pstd(w)
        f["d_bbz20"] = (C[j] - _mean(w)) / s if s > 0 else NAN


def _g(f, k):
    x = f.get(k, NAN)
    return x if x == x else None


def setup_of(f, daily_row, b5, i, bd, j):
    """매매법 판정 — 결정적 규칙. 우선순위대로 첫 번째로 맞는 것(없으면 generic).
    ★입력 피처에서만★ 판정한다 — 미래를 안 본다."""
    if not daily_row:
        sf, sg = _g(f, "s_frac"), _g(f, "s_gap")
        if sf is not None and sg is not None and sf < 0.15 and abs(sg) > 0.015:
            return SETUPS.index("gap")
        h, c = b5["h"], b5["c"]
        rv = _g(f, "m_relvol12")
        if i - 48 >= 0 and rv is not None and rv > 1.2 and c[i] >= max(h[i - 48:i]):
            return SETUPS.index("breakout")
        rs, bz = _g(f, "m_rsi14"), _g(f, "m_bbz20")
        if (rs is not None and rs < 0.3) or (bz is not None and bz < -2.0):
            return SETUPS.index("meanrev")
        g50, r12, vd = _g(f, "d_sma50gap"), _g(f, "m_r12"), _g(f, "s_vwapdev")
        if g50 is not None and r12 is not None and vd is not None and g50 > 0 and r12 < 0 and vd > -0.005:
            return SETUPS.index("pullback")
        d5, of = _g(f, "d_r5"), _g(f, "m_ofi12")
        if r12 is not None and d5 is not None and of is not None and r12 > 0 and d5 > 0 and of > 0:
            return SETUPS.index("momentum")
        r60 = _g(f, "d_r60")
        if g50 is not None and r60 is not None and g50 > 0 and r60 > 0:
            return SETUPS.index("trend")
        return SETUPS.index("generic")
    # 장타 행 — 일봉 규칙만
    if j is not None and j - 20 >= 0 and bd["c"][j] >= max(bd["h"][j - 20:j]):
        return SETUPS.index("breakout")
    rs, bz = _g(f, "d_rsi14"), _g(f, "d_bbz20")
    if (rs is not None and rs < 0.3) or (bz is not None and bz < -2.0):
        return SETUPS.index("meanrev")
    g50, d5, d20, r60 = _g(f, "d_sma50gap"), _g(f, "d_r5"), _g(f, "d_r20"), _g(f, "d_r60")
    if g50 is not None and d5 is not None and g50 > 0 and d5 < 0:
        return SETUPS.index("pullback")
    if d5 is not None and d20 is not None and d5 > 0 and d20 > 0:
        return SETUPS.index("momentum")
    if g50 is not None and r60 is not None and g50 > 0 and r60 > 0:
        return SETUPS.index("trend")
    return SETUPS.index("generic")
