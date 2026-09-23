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


# ═══════════════════════════════════════════════════════════════════════════════════════
# [V33.420] 라벨 · 데이터셋 · 학습 · 정직한 평가 · 내보내기
# ═══════════════════════════════════════════════════════════════════════════════════════

# ─────────────────────────── 라벨 — 변동성 비례 삼중배리어 ───────────────────────────
# 실험대가 이미 답을 냈다(V33.405): 부호 라벨보다 ★변동성으로 정규화한★ 라벨이 이겼다(후보 D).
# 배리어를 그 종목·그 시점의 변동성에 비례시키면 "±1%" 가 조용한 종목에선 큰 사건, 요동치는
# 종목에선 잡음이 되는 문제가 사라진다 — 모든 행이 ★같은 질문★ 을 한다.
BARRIER_K = 1.0                 # 배리어 = ±k × σ_지평
SIGMA_FLOOR = 1e-4


def barrier_outcome(c0, highs, lows, up, dn):
    """앞으로의 봉들에서 어느 배리어를 먼저 치는가.
    반환 (1|0|None, 사유). 한 봉에서 둘 다 치면 순서를 모른다 → ★제외★(추측하지 않는다)."""
    for k in range(len(highs)):
        hu = math.log(highs[k] / c0) >= up
        hd = math.log(lows[k] / c0) <= dn
        if hu and hd:
            return None, "amb"
        if hu:
            return 1, "up"
        if hd:
            return 0, "dn"
    return None, "timeout"


def horizon_sigma(f, hz):
    """지평별 σ. 장중 30·60분은 5분봉 변동(48봉) × √봉수 · 1일은 일봉 변동(20일) ·
    5·20일은 일봉 변동 × √일수. 1일을 5분봉 변동으로 늘리면 밤사이 갭을 못 담아 과소평가된다."""
    fi = {k: v for k, v in zip(FEATS, f)}
    if hz in ("30m", "60m"):
        s = fi["m_rv48"]
        return s * math.sqrt(H_BARS[hz]) if s == s and s > 0 else NAN
    s = fi["d_rv20"]
    if not (s == s and s > 0):
        return NAN
    return s if hz == "1d" else s * math.sqrt(H_DAYS[hz])


# ─────────────────────────── 데이터셋 ───────────────────────────
INTRA_STEP = 6                  # 장중 결정점 간격(5분봉 6개 = 30분)
DAILY_STEP = 2                  # 장타 결정점 간격(일)
MIN_I = 60                      # 5분봉 창이 다 차는 첫 인덱스
INTRA_MAX_POINTS = 3000         # 장중 결정점 상한(≈230거래일) — 저장소가 커져도 학습 메모리가 선형으로 늘지 않게
DAILY_MAX_POINTS = 1000         # 장타 결정점 상한(최근 ~8년) — 24년 전 체제까지 같은 무게로 배우지 않는다
# 라벨 창의 달력 길이 상한. 30·60분은 ★같은 세션 안에서★ 끝나야 한다(장 마감을 넘기면 밤사이 갭이
# 섞여 다른 질문이 된다 — 단타는 장중 청산이다). 1일·5일·20일은 데이터 구멍을 건너지 않게만 막는다.
MAX_SPAN_SEC = {"30m": 6 * BASE_SEC + 60, "60m": 12 * BASE_SEC + 60, "1d": 5 * 86400,
                "5d": 10 * 86400, "20d": 35 * 86400}


def uniq_weight(hz):
    """겹침 가중(닫힌 식). 결정점 간격보다 지평이 길면 이웃 행의 라벨 구간이 겹친다 —
    1일 지평(78봉)을 30분마다 찍으면 한 사건을 13번 센다. 그 몫만큼 발언권을 나눈다(de Prado 고유도)."""
    if hz in H_BARS:
        return min(1.0, INTRA_STEP / float(H_BARS[hz]))
    return min(1.0, DAILY_STEP / float(H_DAYS[hz]))


def build_rows(sym, mkt, b5, bd):
    """한 종목의 모든 행. 각 행 = (피처 40, 매매법, 지평, 라벨, 가중, 결정시각, 라벨끝시각, 사후수익).
    ★마지막 봉은 버린다★ — 수집 시점에 진행 중이던 봉일 수 있다(확정값이 아니다)."""
    rows = []
    stats = {"amb": 0, "timeout": 0, "nosig": 0, "span": 0}
    if b5 and len(b5.get("t", [])) > MIN_I + 1:
        b5 = {k: b5[k][:-1] for k in ("t", "o", "h", "l", "c", "v")}
        n = len(b5["t"])
        i0 = max(MIN_I, n - 1 - INTRA_MAX_POINTS * INTRA_STEP)
        i0 += (n - 1 - i0) % INTRA_STEP
        for i in range(i0, n, INTRA_STEP):
            x, st = feature_point(b5, bd, i, mkt)
            for hz in ("30m", "60m", "1d"):
                nb = H_BARS[hz]
                if i + nb >= n:
                    continue
                if b5["t"][i + nb] - b5["t"][i] > MAX_SPAN_SEC[hz]:
                    stats["span"] += 1      # 30·60분은 장 안에서 끝나야 한다 · 1일은 데이터 구멍을 건너지 않는다
                    continue
                sg = horizon_sigma(x, hz)
                if not (sg == sg):
                    stats["nosig"] += 1
                    continue
                sg = max(sg, SIGMA_FLOOR)
                y, why = barrier_outcome(b5["c"][i], b5["h"][i + 1:i + 1 + nb], b5["l"][i + 1:i + 1 + nb],
                                         BARRIER_K * sg, -BARRIER_K * sg)
                if y is None:
                    stats[why] += 1
                    continue
                rows.append((x, st, HORIZONS.index(hz), y, uniq_weight(hz),
                             b5["t"][i] + BASE_SEC, b5["t"][i + nb] + BASE_SEC,
                             math.log(b5["c"][i + nb] / b5["c"][i]), sym, mkt))
    if bd and len(bd.get("t", [])) > D_LOOKBACK + 1:
        bd2 = {k: bd[k][:-1] for k in ("t", "o", "h", "l", "c", "v")}
        n = len(bd2["t"])
        j0 = max(D_LOOKBACK - 1, n - 1 - DAILY_MAX_POINTS * DAILY_STEP)
        j0 += (n - 1 - j0) % DAILY_STEP          # 끝에서부터 같은 격자 — 수집일에 따라 격자가 흔들리지 않게
        for j in range(j0, n, DAILY_STEP):
            x, st = feature_point(None, bd2, None, mkt, daily_row=True, j=j)
            for hz in ("5d", "20d"):
                nd = H_DAYS[hz]
                if j + nd >= n:
                    continue
                if bd2["t"][j + nd] - bd2["t"][j] > MAX_SPAN_SEC[hz]:
                    stats["span"] += 1
                    continue
                sg = horizon_sigma(x, hz)
                if not (sg == sg):
                    stats["nosig"] += 1
                    continue
                sg = max(sg, SIGMA_FLOOR)
                y, why = barrier_outcome(bd2["c"][j], bd2["h"][j + 1:j + 1 + nd], bd2["l"][j + 1:j + 1 + nd],
                                         BARRIER_K * sg, -BARRIER_K * sg)
                if y is None:
                    stats[why] += 1
                    continue
                rows.append((x, st, HORIZONS.index(hz), y, uniq_weight(hz),
                             bd2["t"][j] + 86400, bd2["t"][j + nd] + 86400,
                             math.log(bd2["c"][j + nd] / bd2["c"][j]), sym, mkt))
    return rows, stats


def design_row(x, setup, hz):
    """모델 입력 = 피처 40 + 지평 원핫 5 + 매매법 원핫 7 = 52칸.
    원핫으로 두는 이유: 트리가 ★숫자 문턱 분기만★ 쓰게 해 내보내기·워커 채점이 단순해진다
    (LightGBM 범주 분기는 집합 비교라 옮기다 틀리기 쉽다)."""
    return list(x) + [1.0 if k == hz else 0.0 for k in range(len(HORIZONS))] + \
                     [1.0 if k == setup else 0.0 for k in range(len(SETUPS))]


MODEL_FEATS = FEATS + ["hz_" + h for h in HORIZONS] + ["st_" + s for s in SETUPS]


# ─────────────────────────── 정직한 평가 (워커 _blockAccLB / _speakPoint 와 같은 규칙) ───────────────────────────
BLK_T = 1.64                    # 워커 BLKACC.tMul
BLK_MIN = 4                     # 워커 BLKACC.minBlocks
SPEAK_TARGET = 0.60             # 워커 SPEAK.target — 사용자 지정
SPEAK_BASE_MARGIN = 0.015       # 워커 SPEAK.baseMargin
SPEAK_CAL_MARGIN = 0.02         # 워커 SPEAK.calMargin
SPEAK_MIN_COV = 0.10            # 워커 SPEAK.minCoverage
SPEAK_MIN_N = 200               # 워커 SPEAK.minSpeakN
HZ_SEC = {"30m": 86400, "60m": 86400, "1d": 86400, "5d": 5 * 86400, "20d": 20 * 86400}
# ↑ 블록 길이: 장중 지평은 ★하루★ — 같은 날 여러 종목은 같은 시장 사건이다(V33.398 의 교훈).


def block_lb(hits, ts, hz_sec):
    """겹치지 않는 시간 블록별 적중률의 평균 − t×se. 블록이 모자라면 None(못 쟀다)."""
    n = min(len(hits), len(ts))
    if n < 8:
        return None, 0
    lo = min(ts)
    hi = max(ts)
    if not hi > lo:
        return None, 0
    K = int((hi - lo) // hz_sec)
    if K < BLK_MIN:
        return None, max(0, K)
    s = [0.0] * K
    c = [0.0] * K
    for h, t in zip(hits, ts):
        b = int((t - lo) // hz_sec)
        b = min(max(b, 0), K - 1)
        s[b] += h
        c[b] += 1
    acc = [s[b] / c[b] for b in range(K) if c[b] >= 8]
    if len(acc) < BLK_MIN:
        return None, len(acc)
    m = sum(acc) / len(acc)
    v = sum((a - m) ** 2 for a in acc) / max(1, len(acc) - 1)
    return max(0.0, min(1.0, m - BLK_T * math.sqrt(v / len(acc)))), len(acc)


def speak_long(p, y, ts, hz_sec):
    """★사는 쪽★ 발언점 — 이 시스템은 산다. "OMNI 가 사라고 할 때 위 배리어를 먼저 칠 확률" 이
    사용자가 실제로 묻는 숫자다. 문턱 τ 는 ★앞 25%(시간순)★ 에서 고르고 뒤 75% 에서 잰다.
    문턱 = max(목표 60%, 발언 구간 무실력 + 여유) — 쏠린 라벨에서 60% 는 실력이 아니다(V33.414)."""
    idx = sorted(range(len(p)), key=lambda k: ts[k])
    ncal = max(SPEAK_MIN_N, int(len(idx) * 0.25))
    if len(idx) - ncal < SPEAK_MIN_N:
        return {"ok": False, "why": "홀드아웃 %d행 — 고르기/재기로 가르기엔 부족" % len(idx)}
    cal, ev = idx[:ncal], idx[ncal:]
    best = None
    for q in range(0, 91, 2):
        cp = sorted(p[k] for k in cal)
        tau = cp[min(len(cp) - 1, int(q / 100.0 * len(cp)))]
        sel = [k for k in cal if p[k] >= tau]
        if len(sel) < SPEAK_MIN_N:
            break
        prec = sum(y[k] for k in sel) / len(sel)
        base = sum(y[k] for k in cal) / len(cal)          # 사는 쪽 무실력 = 전체 상승 비율
        need = max(SPEAK_TARGET, base + SPEAK_BASE_MARGIN)
        # 고르는 쪽도 ★블록 하한★ 으로 고른다 — 점추정 + 2%p 로 고르면 재는 쪽에서 평균으로 돌아가
        # 문턱 바로 밑에 떨어진다(합성 검사 실측: 고르기 62% → 재기 59.4%). 고르기 블록이 모자랄
        # 때만 워커 규칙(점추정 + calMargin)으로 물러선다.
        lbc, _ = block_lb([y[k] for k in sel], [ts[k] for k in sel], hz_sec)
        if (lbc is not None and lbc >= need) or (lbc is None and prec >= need + SPEAK_CAL_MARGIN):
            best = (tau, len(sel) / len(cal))
            break
    if best is None:
        return {"ok": False, "why": "캘리브레이션에서 사는 쪽 문턱을 못 넘었다"}
    tau = best[0]
    sel = [k for k in ev if p[k] >= tau]
    cov = len(sel) / float(len(ev))
    if len(sel) < SPEAK_MIN_N:
        return {"ok": False, "tau": tau, "cov": cov, "why": "발언 %d건 < %d" % (len(sel), SPEAK_MIN_N)}
    base = sum(y[k] for k in ev) / float(len(ev))
    lb, K = block_lb([y[k] for k in sel], [ts[k] for k in sel], hz_sec)
    prec = sum(y[k] for k in sel) / float(len(sel))
    need = max(SPEAK_TARGET, base + SPEAK_BASE_MARGIN)
    out = {"tau": tau, "cov": cov, "n": len(sel), "prec": prec, "lb": lb, "k": K, "base": base, "need": need}
    if lb is None:
        out.update(ok=False, why="블록 %d개 < %d (못 쟀다)" % (K, BLK_MIN))
    elif lb < need:
        out.update(ok=False, why="하한 %.1f%% < 문턱 %.1f%%" % (lb * 100, need * 100))
    elif cov < SPEAK_MIN_COV:
        out.update(ok=False, why="적용률 %.1f%% < %d%%" % (cov * 100, SPEAK_MIN_COV * 100))
    else:
        out.update(ok=True, why=None)
    return out


# ─────────────────────────── 내보내기 — LightGBM 의 ★정확한★ 분기 규칙 ───────────────────────────
def export_tree(n):
    """LightGBM Tree::NumericalDecision 을 그대로 옮긴다:
         x 가 NaN 이고 missing_type 이 NaN 이 아니면 → x = 0
         (missing_type==Zero 이고 x≈0) 또는 (missing_type==NaN 이고 x 가 NaN) → default_left
         그 밖: x <= threshold 이면 왼쪽
    기존 부스터 변환기(_plgb)는 결측 규칙을 버렸다 — 부스터 피처엔 NaN 이 없어서 무해했지만,
    OMNI 의 장타 행은 ★장중 칸이 설계상 NaN★ 이다. 그대로 옮기면 그 행 예측이 조용히 갈린다."""
    if "leaf_value" in n:
        return {"w": float(n["leaf_value"])}
    mt = {"None": 0, "Zero": 1, "NaN": 2}.get(str(n.get("missing_type", "None")), 0)
    if str(n.get("decision_type", "<=")) != "<=":
        raise ValueError("숫자 분기만 지원한다(decision_type=%s)" % n.get("decision_type"))
    return {"f": int(n["split_feature"]), "t": float(n["threshold"]),
            "dl": 1 if n.get("default_left", True) else 0, "mt": mt,
            "l": export_tree(n["left_child"]), "r": export_tree(n["right_child"])}


def score_tree(tr, x):
    """export_tree 결과를 채점하는 ★기준★ 구현 — 워커 omniScoreRaw 와 같은 규칙이어야 한다."""
    while "w" not in tr:
        v = x[tr["f"]]
        isnan = (v != v)
        if isnan and tr["mt"] != 2:
            v = 0.0
            isnan = False
        if (tr["mt"] == 1 and abs(v) <= 1e-35) or (tr["mt"] == 2 and isnan):
            tr = tr["l"] if tr["dl"] else tr["r"]
        else:
            tr = tr["l"] if v <= tr["t"] else tr["r"]
    return tr["w"]


# ═══════════════════════════════════════════════════════════════════════════════════════
# 학습 · 평가 · 업로드 드라이버
#
# ■ 분할 — ★전역 절단점 하나★
#   C = (가장 늦은 결정시각) − HOLD_DAYS. 학습 = 라벨이 C 전에 ★끝난★ 행(퍼징), 홀드아웃 = C 이후에
#   결정한 행. 지평마다 따로 자르면 한 모델이 다른 지평의 미래를 배워 버린다(1일 라벨이 5일 라벨의
#   앞 구간이다) — 절단점은 모두에게 하나다.
# ■ 조기종료 — 학습 구간 ★안에서★ 뒤 15% 를 떼어 쓴다. 홀드아웃은 한 번도 보지 않는다.
# ■ 배포 = 잰 모델. 홀드아웃까지 다시 넣어 재학습(refit)하지 않는다 — 그러면 잰 숫자가 배포된
#   모델의 숫자가 아니게 된다(#12 의 교훈: 신뢰도는 ★올라간 그 모델★ 의 것이어야 한다).
# ═══════════════════════════════════════════════════════════════════════════════════════
HOLD_DAYS = 35
INNER_VAL_FRAC = 0.15
LGB_PARAMS = {"objective": "binary", "learning_rate": 0.03, "num_leaves": 31, "min_data_in_leaf": 400,
              "feature_fraction": 0.8, "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 10.0,
              "max_bin": 255, "verbose": -1, "seed": 7, "deterministic": True, "force_row_wise": True}
MAX_ROUNDS = 400
EARLY_STOP = 40


def rows_to_arrays(rows):
    """행 목록 → numpy 배열. ★float64★ 로 둔다 — 워커(JS)는 double 로 채점한다. float32 로 학습하면
    문턱 근처 값이 반대편으로 갈 수 있다(같은 봉에서 다른 가지)."""
    import numpy as np
    n = len(rows)
    X = np.empty((n, len(MODEL_FEATS)), dtype=np.float64)
    meta = {k: [] for k in ("st", "hz", "y", "w", "td", "te", "fr", "sym", "mkt")}
    for k, r in enumerate(rows):
        X[k] = design_row(r[0], r[1], r[2])
        meta["st"].append(r[1]); meta["hz"].append(r[2]); meta["y"].append(r[3]); meta["w"].append(r[4])
        meta["td"].append(r[5]); meta["te"].append(r[6]); meta["fr"].append(r[7])
        meta["sym"].append(r[8]); meta["mkt"].append(r[9])
    A = {"X": X}
    for k in ("st", "hz", "y"):
        A[k] = np.asarray(meta[k], dtype=np.int64)
    for k in ("w", "td", "te", "fr"):
        A[k] = np.asarray(meta[k], dtype=np.float64)
    A["sym"] = meta["sym"]
    A["mkt"] = np.asarray([0 if m == "us" else 1 for m in meta["mkt"]], dtype=np.int64)
    return A


def concat_arrays(parts):
    import numpy as np
    parts = [p for p in parts if p is not None and len(p["y"])]
    if not parts:
        return None
    out = {}
    for k in parts[0]:
        if k == "sym":
            out[k] = [s for p in parts for s in p[k]]
        else:
            out[k] = np.concatenate([p[k] for p in parts])
    return out


def take(A, idx):
    import numpy as np
    idx = np.asarray(idx)
    out = {k: (A[k][idx] if k != "sym" else [A[k][i] for i in idx]) for k in A}
    return out


def split_cutoff(A, hold_days=HOLD_DAYS):
    """전역 절단점. 학습 = 라벨 끝 < C · 홀드아웃 = 결정 ≥ C."""
    import numpy as np
    C = float(A["td"].max()) - hold_days * 86400
    tr = np.where(A["te"] < C)[0]
    ho = np.where(A["td"] >= C)[0]
    return C, tr, ho


def _auc(p, y):
    import numpy as np
    p = np.asarray(p, dtype=np.float64)
    y = np.asarray(y)
    npos = int((y == 1).sum())
    nneg = int((y == 0).sum())
    if npos == 0 or nneg == 0:
        return None
    order = np.argsort(p, kind="mergesort")
    ranks = np.empty(len(p), dtype=np.float64)
    ps = p[order]
    k = 0
    while k < len(ps):                     # 동점은 평균 순위
        m = k
        while m + 1 < len(ps) and ps[m + 1] == ps[k]:
            m += 1
        ranks[order[k:m + 1]] = (k + m) / 2.0 + 1
        k = m + 1
    return float((ranks[y == 1].sum() - npos * (npos + 1) / 2.0) / (npos * nneg))


def evaluate_heads(p, A):
    """지평별(=장타·단타 머리별) 정직한 성적. 반환 {hz: {...}}.
    ok=True 인 머리만 워커가 쓴다 — 못 잰 머리(블록 부족)는 ★못 쟀다★ 고 적는다(추정하지 않는다)."""
    import numpy as np
    out = {}
    for hk, hz in enumerate(HORIZONS):
        ix = np.where(A["hz"] == hk)[0]
        rec = {"n": int(len(ix))}
        if len(ix) < 50:
            rec.update(ok=False, why="홀드아웃 %d행 — 잴 게 없다" % len(ix))
            out[hz] = rec
            continue
        ph = p[ix]
        yh = A["y"][ix]
        th = A["td"][ix]
        base = float(yh.mean())
        hits = ((ph >= 0.5).astype(np.int64) == yh).astype(np.float64)
        lb, K = block_lb(list(hits), list(th), HZ_SEC[hz])
        rec.update(base=base, acc=float(hits.mean()), accLB=lb, blocks=K, auc=_auc(ph, yh),
                   noSkill=max(base, 1 - base))
        sp = speak_long(list(ph), list(yh), list(th), HZ_SEC[hz])
        rec["speak"] = sp
        rec["ok"] = bool(sp.get("ok"))
        rec["tau"] = sp.get("tau") if rec["ok"] else None
        rec["why"] = sp.get("why")
        # 시장별 · 매매법별 — 정보용(문턱은 머리 하나에 하나). 발언 구간 정밀도를 무실력과 나란히 적는다.
        tau = sp.get("tau")
        for name, key, labels in (("byMkt", "mkt", ["us", "kr"]), ("bySetup", "st", SETUPS)):
            d = {}
            for v, lab in enumerate(labels):
                jx = np.where(A[key][ix] == v)[0]
                if len(jx) < 30:
                    continue
                r = {"n": int(len(jx)), "base": float(yh[jx].mean()), "auc": _auc(ph[jx], yh[jx])}
                if tau is not None:
                    sel = jx[ph[jx] >= tau]
                    r["nSpeak"] = int(len(sel))
                    r["prec"] = float(yh[sel].mean()) if len(sel) else None
                d[lab] = r
            rec[name] = d
        out[hz] = rec
    return out


def train_model(A, log=print):
    """A 전체에서 분할 → 학습 → 홀드아웃 평가. 반환 (booster, report)."""
    import numpy as np
    import lightgbm as lgb
    C, tr, ho = split_cutoff(A)
    if len(tr) < 2000 or len(ho) < 500:
        return None, {"ok": False, "why": "표본 부족 — 학습 %d · 홀드아웃 %d" % (len(tr), len(ho)), "cutoff": C}
    # 학습 구간 안에서 조기종료용 검증을 떼어낸다(같은 퍼징 규칙)
    Atr = take(A, tr)
    C2 = float(np.quantile(Atr["td"], 1 - INNER_VAL_FRAC))
    fit = np.where(Atr["te"] < C2)[0]
    val = np.where(Atr["td"] >= C2)[0]
    dfit = lgb.Dataset(Atr["X"][fit], label=Atr["y"][fit], weight=Atr["w"][fit],
                       feature_name=MODEL_FEATS, free_raw_data=True)
    dval = lgb.Dataset(Atr["X"][val], label=Atr["y"][val], weight=Atr["w"][val], reference=dfit)
    bst = lgb.train(LGB_PARAMS, dfit, num_boost_round=MAX_ROUNDS, valid_sets=[dval],
                    callbacks=[lgb.early_stopping(EARLY_STOP, verbose=False)])
    best = int(bst.best_iteration or bst.current_iteration())
    Aho = take(A, ho)
    raw = bst.predict(Aho["X"], num_iteration=best, raw_score=True)
    p = 1.0 / (1.0 + np.exp(-raw))
    heads = evaluate_heads(p, Aho)
    rep = {"ok": True, "cutoff": C, "innerCut": C2, "nTrain": int(len(fit)), "nVal": int(len(val)),
           "nHold": int(len(ho)), "bestIter": best, "heads": heads}
    return (bst, best), rep


def export_model(bst, best):
    """LightGBM → 워커 형식. ★best 까지만★ 내보낸다 — 잰 모델 = 올라가는 모델."""
    dump = bst.dump_model(num_iteration=best)
    if dump.get("objective", "").split(" ")[0] != "binary":
        raise ValueError("binary 목적만 지원")
    if len(dump.get("feature_names", [])) != len(MODEL_FEATS):
        raise ValueError("피처 수 불일치")
    return [export_tree(t["tree_structure"]) for t in dump["tree_info"]]


def score_raw(trees, x):
    return sum(score_tree(t, x) for t in trees)


# ─────────────────────────── 워커와 주고받기 ───────────────────────────
FETCH_BATCH = {"5m": 6, "1d": 20}
PROBE_N = 200                   # 워커가 업로드를 받기 전에 ★직접 채점해 보는★ 행 수(정합 probe)


def _get_bars(BASE, HDR, syms, res, log):
    import requests
    out = {}
    B = FETCH_BATCH[res]
    for k in range(0, len(syms), B):
        chunk = syms[k:k + B]
        for attempt in range(3):
            try:
                q = requests.get(BASE + "/api/omni-bars", params={"s": ",".join(chunk), "res": res},
                                 headers=HDR, timeout=120)
                q.raise_for_status()
                out.update(q.json().get("bars") or {})
                break
            except Exception as e:  # noqa: BLE001 — 세 번 실패하면 그 묶음만 비운다(전체를 죽이지 않는다)
                if attempt == 2:
                    log("   ⚠️ OMNI 봉 받기 실패 %s %s…: %s" % (res, chunk[0], e))
        yield out
        out = {}


def build_dataset_stream(BASE, HDR, log=print, limit=None):
    """★흘려서★ 만든다 — 5분봉을 묶음으로 받아 곧바로 행으로 바꾸고 원시 봉은 버린다.
    저장소가 커져도(종목당 5분봉 4만 개) 원시 봉 전체를 한꺼번에 메모리에 올리지 않는다."""
    import time
    import requests
    t0 = time.time()
    r = requests.get(BASE + "/api/omni-bars-index", headers=HDR, timeout=60)
    r.raise_for_status()
    ix = (r.json().get("index") or {}).get("s") or {}
    syms = sorted(ix)
    if limit:
        syms = syms[:limit]
    daily = {}
    for got in _get_bars(BASE, HDR, [s for s in syms if (ix[s].get("1d") or {}).get("n")], "1d", log):
        daily.update(got)
    parts = []
    tot = {"amb": 0, "timeout": 0, "nosig": 0, "span": 0}
    seen = set()
    n5 = 0

    def _eat(s, b5):
        rows, st = build_rows(s, ix[s].get("m", "us"), b5, daily.get(s))
        for k in tot:
            tot[k] += st.get(k, 0)
        if rows:
            parts.append(rows_to_arrays(rows))
            seen.add(s)

    for got in _get_bars(BASE, HDR, [s for s in syms if (ix[s].get("5m") or {}).get("n")], "5m", log):
        for s, b5 in got.items():
            if s in ix:
                n5 += 1
                _eat(s, b5)
    for s in syms:                      # 5분봉이 없는 종목도 장타 행은 만든다
        if s not in seen and s in daily:
            _eat(s, None)
    A = concat_arrays(parts)
    log("   · OMNI 봉 수신 %d종목 (5분봉 %d · 일봉 %d)" % (len(syms), n5, len(daily)))
    log("   · OMNI 표본 %s행 · 종목 %d · 제외(동시타격 %d · 시간초과 %d · σ없음 %d · 구멍 %d) · %.0fs" % (
        0 if A is None else len(A["y"]), len(seen), tot["amb"], tot["timeout"], tot["nosig"], tot["span"],
        time.time() - t0))
    return A, tot, len(seen)


def build_dataset(data, log=print):
    """메모리에 이미 있는 봉(자가검사용)."""
    import time
    t0 = time.time()
    parts = []
    tot = {"amb": 0, "timeout": 0, "nosig": 0, "span": 0}
    nsym = 0
    for s, d in data.items():
        rows, st = build_rows(s, d["m"], d.get("5m"), d.get("1d"))
        for k in tot:
            tot[k] += st.get(k, 0)
        if rows:
            parts.append(rows_to_arrays(rows))
            nsym += 1
    A = concat_arrays(parts)
    log("   · OMNI 표본 %s행 · 종목 %d · 제외(동시타격 %d · 시간초과 %d · σ없음 %d · 구멍 %d) · %.0fs" % (
        0 if A is None else len(A["y"]), nsym, tot["amb"], tot["timeout"], tot["nosig"], tot["span"],
        time.time() - t0))
    return A, tot, nsym


def head_line(hz, h):
    if not h or h.get("n", 0) < 50:
        return "%s: 홀드아웃 부족" % hz
    s = "%s: n=%d 기본 %.1f%% · AUC %s · 정확도 %.1f%% (무실력 %.1f%%)" % (
        hz, h["n"], h["base"] * 100, "—" if h.get("auc") is None else "%.3f" % h["auc"],
        h["acc"] * 100, h["noSkill"] * 100)
    sp = h.get("speak") or {}
    if sp.get("prec") is not None:
        s += " · 사라 발언 %d건 정밀 %.1f%% 하한 %s vs 문턱 %.1f%% 적용 %.1f%%" % (
            sp["n"], sp["prec"] * 100, "못 쟀다" if sp.get("lb") is None else "%.1f%%" % (sp["lb"] * 100),
            sp["need"] * 100, sp["cov"] * 100)
    s += " → " + ("✅ 사용" if h.get("ok") else "보류(" + str(h.get("why")) + ")")
    return s


def _clean(o):
    """JSON 에 NaN·Inf 를 싣지 않는다 — 파이썬은 NaN 을 그대로 쓰지만 JS JSON.parse 는 거부한다."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if hasattr(o, "item"):              # numpy 스칼라
        return _clean(o.item())
    return o


def make_probe(bst, best, A, n=PROBE_N, seed=5):
    """정합 probe — 홀드아웃에서 장타·장중을 반씩(장타 행은 장중 칸이 NaN). 기대값은 lgb 자체의 raw."""
    import numpy as np
    rng = np.random.default_rng(seed)
    d_ix = np.where(A["hz"] >= 3)[0]
    i_ix = np.where(A["hz"] < 3)[0]
    pick = np.concatenate([rng.choice(d_ix, min(n // 2, len(d_ix)), replace=False) if len(d_ix) else [],
                           rng.choice(i_ix, min(n - n // 2, len(i_ix)), replace=False) if len(i_ix) else []])
    pick = pick.astype(np.int64)
    X = A["X"][pick]
    raw = bst.predict(X, num_iteration=best, raw_score=True)
    return [{"x": [None if v != v else float(v) for v in x], "raw": float(r)} for x, r in zip(X, raw)]


def run(BASE, KEY, HDR, upload=True, log=print, A=None, limit=None):
    """수집 → 표본 → 학습 → 평가 → 업로드. 업로드는 ★섀도우★ — 워커가 라이브에 쓰는 건 머리별 ok 뿐."""
    import time
    import json
    import requests
    import numpy as np
    excl, nsym = {}, 0
    if A is None:
        A, excl, nsym = build_dataset_stream(BASE, HDR, log=log, limit=limit)
    if A is None:
        log("   ⏭ OMNI 표본 0 — 수집기가 아직 봉을 못 모았다")
        return None
    m, rep = train_model(A, log=log)
    if m is None:
        log("   ⏭ OMNI " + rep["why"])
        return rep
    bst, best = m
    trees = export_model(bst, best)
    C, _, ho = split_cutoff(A)
    probe = make_probe(bst, best, take(A, ho))
    mine = [score_raw(trees, [NAN if v is None else v for v in pr["x"]]) for pr in probe]
    pmax = max([abs(a - pr["raw"]) for a, pr in zip(mine, probe)] or [0.0])
    log("   · OMNI 나무 %d · 학습 %d · 조기종료검증 %d · 홀드아웃 %d (절단 %s) · 자체 정합 %.2g" % (
        len(trees), rep["nTrain"], rep["nVal"], rep["nHold"],
        __import__("datetime").datetime.fromtimestamp(rep["cutoff"], __import__("datetime").timezone.utc)
        .strftime("%Y-%m-%d"), pmax))
    for hz in HORIZONS:
        log("   · OMNI " + head_line(hz, rep["heads"].get(hz)))
    if pmax > 1e-9:
        log("   ⚠️ OMNI 내보낸 나무가 LightGBM 과 다른 답을 낸다(%.3g) — 업로드하지 않는다" % pmax)
        return rep
    payload = _clean({"v": OMNI_VER, "feats": MODEL_FEATS, "horizons": HORIZONS, "setups": SETUPS,
               "consts": {"sess": SESS_MIN, "openUs": OPEN_MIN["us"], "openKr": OPEN_MIN["kr"],
                          "hLook": H_LOOKBACK, "dLook": D_LOOKBACK, "base": BASE_SEC},
               "trees": trees, "probe": probe, "heads": rep["heads"], "cutoff": rep["cutoff"],
               "bestIter": best, "nTrain": rep["nTrain"], "nHold": rep["nHold"], "nSym": nsym,
               "excl": excl, "trainedAt": int(time.time() * 1000), "params": LGB_PARAMS,
               "barrierK": BARRIER_K, "holdDays": HOLD_DAYS})
    body = json.dumps(payload, allow_nan=False, separators=(",", ":"))
    log("   · OMNI 업로드 크기 %.1f MB" % (len(body) / 1e6))
    if upload:
        for attempt in range(3):
            try:
                r = requests.post(BASE + "/api/omni-import", params={"key": KEY},
                                  headers=dict(HDR, **{"content-type": "application/json"}),
                                  data=body, timeout=180)
                log("   ✅ OMNI 업로드 %s %s" % (r.status_code, r.text[:300]))
                break
            except requests.RequestException as e:
                if attempt == 2:
                    log("   ⚠️ OMNI 업로드 실패: %s" % e)
    return payload
