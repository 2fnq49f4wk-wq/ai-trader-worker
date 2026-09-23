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

■ 라벨 — [V33.425] ★횡단면 상대★ (v3)
  y = 1 ⇔ 이 종목의 지평 수익이 ★같은 시각 · 같은 시장 동료들의 중앙값★ 보다 높다.
  절대 등락(오를 것인가)이 아니다. 절대 라벨에는 아무도 예측 못 하는 공통성분(시장 방향)이
  통째로 들어 있어, 실데이터에서 모델이 그걸 배우고 홀드아웃에서 통째로 뒤집혔다
  (2026-09-23 · AUC 0.492 / 0.488 / 0.502 — 0.5 ★아래★). 자세한 근거는 xsec_label() 위 주석.
  삼중 배리어는 남아 있지만 이제 ★진단★ 이다 — 어느 행도 그것 때문에 버리지 않는다.

■ 모든 수학은 단순하게
  EMA 처럼 ★초기값이 이력 길이에 따라 달라지는★ 지표는 쓰지 않는다(SMA 로 대신한다).
  RSI 는 평활 없는 비율형(상승합/(상승합+하락합)). 표준편차는 모집단(÷n).
  그래야 두 언어에서 같은 입력이 같은 출력을 낸다.
══════════════════════════════════════════════════════════════════════════════════════
"""
import math
import os

OMNI_VER = 3
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
    # ══ [V33.423] ★XALPHA 가 하던 일 — 형식알파★ (퇴역 모델의 능력을 흡수한다) ═══════════
    #   XALPHA 는 WorldQuant-101 계열 알파를 봤다. 그 아이디어는 옳았고 ★정적칸 24/25★ 가
    #   문제였다(종목 안에서 안 변하는 칸이라 모델이 종목을 외웠다). 그래서 여기서는
    #   ★전부 변화·상대량★ 으로만 만든다 — 종목 고유의 수준을 그대로 싣지 않는다.
    "a_cvol20",    # corr(종가, 거래량) 20일 — 가격·거래량 동조(수급 동행)
    "a_hlpos",     # ((고+저)/2 − 종가) / ATR — 종가가 봉 어디에 붙었나(장중 압력의 잔상)
    "a_vwdev20",   # 20일 VWAP 이탈 — 평균 체결가 대비 지금 가격
    "a_ill20",     # Amihud 비유동성 = mean(|수익|/거래대금) — 충격비용 대리
    "a_skew20",    # 일간수익 왜도 — 복권성향(양의 왜도에 음의 프리미엄)
    "a_kurt20",    # 첨도 — 꼬리 위험
    "a_max5",      # 최근 5일 최대 일간수익 — MAX 효과
    "a_dnvolr",    # 하락일 거래량 비중 — 팔자 압력 쏠림
    "a_rev1",      # 전일 반전 = −d_r1 를 변동으로 정규화
    # ══ [V33.423] ★XALPHA 의 횡단면 랭크 + FLOW 의 피어축★ — ★패널★ 에서 나온다 ═════════
    #   실측(V33.413)이 말한 것: ★통합 IC > 0 > 블록 IC★. 즉 "어느 날이 오르나" 는 맞히는데
    #   ★같은 날 안에서 어느 종목이 오르나★ 는 못 맞혔다. 그게 이 시스템이 실제로 하는 일인데.
    #   원인은 분명하다 — 40칸이 전부 ★그 종목 혼자만 보는 값★ 이라 종목끼리 견줄 수가 없다.
    #   랭크는 그 견줌을 직접 준다(같은 날 같은 시장 안에서 0~1 분위).
    #   ★패널은 전일 확정 일봉으로 만든다.★ 장중 시각마다 만들면 학습(전 종목·정확한 시각)과
    #   추론(그 사이클에 본 종목·근사 시각)이 달라져 값이 갈린다 — 이 저장소가 반복해 당한 사고다.
    #   하루에 하나면 두 쪽이 ★같은 패널★ 을 쓴다. 장중 랭크를 포기하고 정합을 얻는다.
    "q_r1", "q_r5", "q_r20", "q_rv20", "q_rsi", "q_volr", "q_hi252", "q_ill",
    "p_ex1", "p_ex5", "p_ex20",   # 시장 중앙값 대비 초과수익(피어 상대)
    "p_beta60", "p_corr60",       # 시장(패널 중앙값 수익률) 대비 베타·상관
    "p_disp", "p_n",              # 그날 종목 간 산포(국면) · 패널 크기(신뢰도)
]
# 패널에서 채우는 칸(나머지는 종목 하나만으로 계산된다) — 두 단계를 코드가 아니라 ★표★ 로 가른다.
# ══ [V33.425g] ★장중 횡단면 — 재 보기 전에는 싣지 않는다(실험 스위치).★ ═══════════════════
#   라벨은 "같은 시각 · 같은 시장 동료보다 잘하는가" 인데, 지금 있는 횡단면 칸(q_*·p_* 15칸)은
#   전부 ★전일 일봉★ 이다 — 장중 상대 위치를 아무도 안 보고 있다. 그래서 장중 랭크가 다음 수다.
#   ★그런데 V33.423 이 그걸 의도적으로 뺐다★ — 학습은 전 종목을 정확한 시각에 보지만 추론은
#   그 사이클에 본 종목을 근사 시각에 본다. 그 어긋남이 이 저장소가 반복해 당한 사고다.
#   그리고 워커가 30분마다 1,008종목 피처를 다시 계산해야 한다(Cloudflare CPU 한도).
#   → 비싼 쪽(워커 배선)을 만들기 ★전에★ 값이 있는지부터 잰다. OMNI_KSEC=1 인 회차에서만
#     칸이 붙고, 그 회차는 ★올리지 않는다★(실험은 운영에 안 섞인다 — 관문이 확인한다).
#
#   ■■ 실측 결과(2026-09-23 · 회차 197 · 1,005종목 · 3,137,890행) — ★도움이 안 된다.★ ■■
#      칸은 제대로 붙었다(묶음 2,983 중 2,898 사용 · 3,145,531행 전부 채움).
#        없음  30m 0.507 · 60m 0.510 · 1d 0.512 · 5d 0.507 · 20d 0.518 → 가중평균 ★0.5097★
#        있음  30m 0.506 · 60m 0.508 · 1d 0.509 · 5d 0.501 · 20d 0.513 → 가중평균 ★0.5076★
#      다섯 머리 전부 같거나 ★약간 나빠졌다★. 칸이 늘어난 만큼 잡음도 늘어난 쪽에 가깝다.
#      → ★워커 장중 패널을 만들지 않는다.★ 30분마다 1,008종목 피처를 다시 계산하는 비용을
#        지불할 근거가 없다. V33.423 이 "장중 랭크를 포기하고 정합을 얻는다" 고 한 판단은
#        ★결과적으로 옳았다★ — 이제 그게 취향이 아니라 ★측정★ 이다.
#      스위치는 남겨 둔다. 다음에 다른 칸을 재 볼 때 같은 방식(붙여서 재고, 안 올린다)을 쓴다.
KSEC = os.environ.get("OMNI_KSEC") == "1"
KSEC_MIN = 20
KSEC_SRC = {"k_r12": "m_r12", "k_r24": "m_r24", "k_sret": "s_ret", "k_gap": "s_gap",
            "k_relvol": "m_relvol12", "k_rv48": "m_rv48", "k_rsi": "m_rsi14", "k_vwdev": "s_vwapdev"}
KSEC_FEATS = ["k_r12", "k_r24", "k_sret", "k_gap", "k_relvol", "k_rv48", "k_rsi", "k_vwdev", "k_n"]
if KSEC:
    FEATS = FEATS + KSEC_FEATS

PANEL_FEATS = ["q_r1", "q_r5", "q_r20", "q_rv20", "q_rsi", "q_volr", "q_hi252", "q_ill",
               "p_ex1", "p_ex5", "p_ex20", "p_beta60", "p_corr60", "p_disp", "p_n"]
PANEL_MIN = 20          # 이보다 적으면 랭크를 만들지 않는다(모르면 모른다)
PANEL_SRC = {"q_r1": "d_r1", "q_r5": "d_r5", "q_r20": "d_r20", "q_rv20": "d_rv20",
             "q_rsi": "d_rsi14", "q_volr": "d_volr", "q_hi252": "d_hi252", "q_ill": "a_ill20"}
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
        _alpha_feats(bd, j, f)      # [V33.423] 형식알파 — 일봉 칸이 채워진 ★뒤에★ (ATR·rv20 을 쓴다)
    # 패널 칸은 여기서 안 채운다 — 같은 날 다른 종목이 있어야 만들 수 있다(panel_fill).

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


def _last_daily_le(bd, dk):
    """[V33.423] 날짜 키가 dk ★이하★ 인 마지막 일봉. `_last_daily_before(bd, dk + 1)` 로 쓰면 안 된다 —
    날짜 키는 YYYYMMDD 라 20260918 + 1 = 20260919 가 ★실제로 있는 날★ 이다(하루를 더 먹는다)."""
    t = bd["t"]
    lo, hi = 0, len(t) - 1
    ans = None
    while lo <= hi:
        mid = (lo + hi) // 2
        if day_key_of_daily(t[mid]) <= dk:
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


def _alpha_feats(bd, j, f):
    """[V33.423] 형식알파 — XALPHA 가 하던 일. ★전부 변화·상대량★ 이다(정적칸을 만들지 않는다).
    일봉 j 까지만 본다. 창이 모자라면 NaN — 0 으로 메우지 않는다(모르는 것을 아는 척하지 않는다)."""
    C, H, L, V = bd["c"], bd["h"], bd["l"], bd["v"]
    a = max(0, j - D_LOOKBACK + 1)
    if j - 19 >= a:
        c20 = C[j - 19:j + 1]
        v20 = V[j - 19:j + 1]
        f["a_cvol20"] = _pearson(c20, v20)
        # VWAP20 = Σ(종가×거래량)/Σ거래량 — 거래량이 0 이면 못 구한다
        sv = 0.0
        sp = 0.0
        for k in range(20):
            sv += v20[k]
            sp += c20[k] * v20[k]
        f["a_vwdev20"] = _lr(C[j], sp / sv) if sv > 0 and sp > 0 else NAN
        r20 = [_lr(C[k], C[k - 1]) for k in range(j - 19, j + 1)] if j - 20 >= a else None
        if r20 is not None and all(x == x for x in r20):
            f["a_skew20"] = _moment(r20, 3)
            f["a_kurt20"] = _moment(r20, 4)
            # Amihud: |수익| / 거래대금(종가×거래량). 단위가 종목마다 다르므로 ★로그★ 로 눕힌다.
            il = []
            for k in range(20):
                dv = c20[k] * v20[k]
                if dv > 0:
                    il.append(abs(r20[k]) / dv)
            f["a_ill20"] = math.log(sum(il) / len(il)) if il else NAN
            dn = 0.0
            tot = 0.0
            for k in range(20):
                tot += v20[k]
                if r20[k] < 0:
                    dn += v20[k]
            f["a_dnvolr"] = (dn / tot) if tot > 0 else NAN
    atr = f.get("d_atr14", NAN)
    if atr == atr and atr > 0 and C[j] > 0:
        f["a_hlpos"] = (((H[j] + L[j]) / 2.0) - C[j]) / (atr * C[j])
    if j - 5 >= a:
        f["a_max5"] = max(_lr(C[k], C[k - 1]) for k in range(j - 4, j + 1))
    rv = f.get("d_rv20", NAN)
    r1 = f.get("d_r1", NAN)
    if rv == rv and rv > 0 and r1 == r1:
        f["a_rev1"] = -r1 / rv          # 변동으로 눕힌 전일 반전(종목 간 견줄 수 있게)


def _pearson(x, y):
    n = len(x)
    if n < 3:
        return NAN
    mx, my = _mean(x), _mean(y)
    sx = sy = sxy = 0.0
    for k in range(n):
        dx, dy = x[k] - mx, y[k] - my
        sx += dx * dx
        sy += dy * dy
        sxy += dx * dy
    return sxy / math.sqrt(sx * sy) if sx > 0 and sy > 0 else NAN


def _moment(r, p):
    """표준화 적률 — 3=왜도 · 4=첨도(초과 아님). 모집단 표준편차를 쓴다(피처 규약과 같게)."""
    n = len(r)
    m = _mean(r)
    sd = _pstd(r)
    if not (sd > 0):
        return NAN
    s = 0.0
    for v in r:
        s += ((v - m) / sd) ** p
    return s / n


# ══════════════════════════════════════════════════════════════════════════════════════
# [V33.423] 패널 — ★같은 날 같은 시장의 종목들을 나란히 놓고 견준다★
#   이 시스템이 실제로 하는 일은 "오늘 무엇을 사나" 이고, 그건 ★종목 간 비교★ 다.
#   40칸은 전부 종목 혼자만 보는 값이라 그 비교를 못 했다(통합 IC > 0 > 블록 IC).
#   패널은 ★전일 확정 일봉★ 하나로 만든다 — 학습과 추론이 같은 패널을 쓰게 하는 유일한 방법이다.
# ══════════════════════════════════════════════════════════════════════════════════════
def _qrank(vals):
    """0~1 분위. 동점은 평균 순위. None/NaN 은 제외하고, 그 자리엔 None 을 돌려준다.
    ★패널 크기에 둔감해야 한다★ — 학습 패널과 추론 패널의 종목 수가 다를 수 있다."""
    idx = [k for k, v in enumerate(vals) if v is not None and v == v]
    out = [None] * len(vals)
    n = len(idx)
    if n < PANEL_MIN:
        return out
    order = sorted(idx, key=lambda k: vals[k])
    k = 0
    while k < n:
        m = k
        while m + 1 < n and vals[order[m + 1]] == vals[order[k]]:
            m += 1
        r = (k + m) / 2.0
        for q in range(k, m + 1):
            out[order[q]] = r / (n - 1) if n > 1 else 0.5
        k = m + 1
    return out


def build_panel(daily_by_sym, mkt_by_sym, day_key):
    """그 날짜(현지 날짜 키)의 패널. 반환 {sym: {패널칸: 값}}.
    ★그 날짜까지 확정된 일봉만★ 본다 — 미래를 한 칸도 안 읽는다."""
    per = {}
    for sym, bd in daily_by_sym.items():
        if not bd or not bd.get("t"):
            continue
        j = _last_daily_le(bd, day_key)             # day_key 자신까지 포함(YYYYMMDD 는 +1 이 실제 날짜다)
        if j is None or j < 60:
            continue
        f = {k: NAN for k in FEATS}
        _daily_feats(bd, j, f)
        _alpha_feats(bd, j, f)
        rets = [_lr(bd["c"][k], bd["c"][k - 1]) for k in range(j - 59, j + 1)]
        per[sym] = {"m": mkt_by_sym.get(sym, "us"), "f": f, "rets": rets}
    out = {}
    for mk in ("us", "kr"):
        syms = [s for s in per if per[s]["m"] == mk]
        if not syms:
            continue
        # ① 횡단면 랭크
        ranks = {}
        for qk, src in PANEL_SRC.items():
            col = [_g(per[s]["f"], src) for s in syms]
            ranks[qk] = _qrank(col)
        # ② 시장 = 패널 ★중앙값 수익률★ (지수를 따로 받지 않는다 — 없던 자료를 만들지 않는다)
        mret = []
        for t in range(60):
            col = sorted(per[s]["rets"][t] for s in syms if per[s]["rets"][t] == per[s]["rets"][t])
            mret.append(col[len(col) // 2] if col else NAN)
        n = len(syms)
        med = {}
        for key, src in (("p_ex1", "d_r1"), ("p_ex5", "d_r5"), ("p_ex20", "d_r20")):
            col = sorted(v for v in (_g(per[s]["f"], src) for s in syms) if v is not None)
            med[key] = col[len(col) // 2] if col else None
        # 그날 종목 간 산포 — 국면(쏠린 날 vs 흩어진 날)
        c1 = [v for v in (_g(per[s]["f"], "d_r1") for s in syms) if v is not None]
        disp = _pstd(c1) if len(c1) >= PANEL_MIN else NAN
        for a, s2 in enumerate(syms):
            row = {}
            for qk in PANEL_SRC:
                r = ranks[qk][a]
                row[qk] = r if r is not None else NAN
            for key, src in (("p_ex1", "d_r1"), ("p_ex5", "d_r5"), ("p_ex20", "d_r20")):
                v = _g(per[s2]["f"], src)
                row[key] = (v - med[key]) if (v is not None and med[key] is not None and n >= PANEL_MIN) else NAN
            if n >= PANEL_MIN:
                rr = per[s2]["rets"]
                ok = [t for t in range(60) if rr[t] == rr[t] and mret[t] == mret[t]]
                if len(ok) >= 40:
                    x = [mret[t] for t in ok]
                    y = [rr[t] for t in ok]
                    vx = _pstd(x)
                    row["p_corr60"] = _pearson(x, y)
                    if vx > 0:
                        mx, my = _mean(x), _mean(y)
                        cov = sum((x[t] - mx) * (y[t] - my) for t in range(len(ok))) / len(ok)
                        row["p_beta60"] = cov / (vx * vx)
                    else:
                        row["p_beta60"] = NAN
                else:
                    row["p_corr60"] = NAN
                    row["p_beta60"] = NAN
            else:
                row["p_corr60"] = NAN
                row["p_beta60"] = NAN
            row["p_disp"] = disp
            row["p_n"] = float(n)
            out[s2] = row
    return out


PANEL_MAX_DAYS = 1200      # 패널을 만드는 날 수 상한(최근부터) — 학습 시간이 종목×날로 늘어나는 걸 막는다


def build_panels(daily_by_sym, mkt_by_sym, max_days=PANEL_MAX_DAYS):
    """여러 날의 패널을 한 번에. 반환 {날짜키: {sym: 패널행}}.
    날짜는 ★일봉이 실제로 있는 날★ 만 — 없는 날의 패널을 지어내지 않는다."""
    keys = set()
    for bd in daily_by_sym.values():
        if bd and bd.get("t"):
            for t in bd["t"]:
                keys.add(day_key_of_daily(t))
    days = sorted(keys)[-max_days:]
    out = {}
    for dk in days:
        pr = build_panel(daily_by_sym, mkt_by_sym, dk)
        if pr:
            out[dk] = pr
    return out


def panel_day_of(bd, j):
    """행이 쓰는 패널 날짜 = ★그 행이 본 마지막 확정 일봉의 날짜★ (feature_point 와 같은 규칙)."""
    if bd is None or j is None or j < 0 or j >= len(bd.get("t", [])):
        return None
    return day_key_of_daily(bd["t"][j])


def panel_fill(vals, prow):
    """feature_point 가 낸 값 배열의 ★패널 칸만★ 채운다. 패널이 없으면 그대로 NaN 이다.
    ★배열을 새로 만들지 않는다★ — 같은 자리에 꽂아야 학습과 추론이 같은 칸을 본다."""
    if not prow:
        return vals
    for k in PANEL_FEATS:
        v = prow.get(k, NAN)
        vals[FEATS.index(k)] = _fin(float(v)) if v == v else NAN
    return vals


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


def horizon_sigma(f, hz, intra=None):
    """지평별 σ. 장중 30·60분은 5분봉 변동(48봉) × √봉수 · 1일은 일봉 변동(20일) ·
    5·20일은 일봉 변동 × √일수. 1일을 5분봉 변동으로 늘리면 밤사이 갭을 못 담아 과소평가된다."""
    fi = {k: v for k, v in zip(FEATS, f)}
    if hz in ("30m", "60m"):
        s = fi["m_rv48"] if intra is None else intra
        return s * math.sqrt(H_BARS[hz]) if s == s and s > 0 else NAN
    s = fi["d_rv20"]
    if not (s == s and s > 0):
        return NAN
    return s if hz == "1d" else s * math.sqrt(H_DAYS[hz])


def intra_sigma(b5, i, n=48, min_n=24):
    """[V33.421] 라벨용 5분봉 σ — ★세션을 건너는 수익률(밤사이 갭)은 뺀다.★
    피처 m_rv48 은 창이 개장을 걸치면 밤사이 갭 하나를 품는다(피처로는 그게 정보다). 그걸 30·60분 배리어
    폭으로 쓰면 장중 변동보다 배리어가 넓어져 대부분 시간초과가 된다 — 첫 실데이터 학습에서 제외
    172,554 건 중 대부분이 시간초과였다. 라벨은 워커와 정합할 필요가 없다(워커는 라벨을 만들지 않는다)."""
    t, c = b5["t"], b5["c"]
    r = []
    k = i
    while k > 0 and len(r) < n and i - k < 4 * n:
        if t[k] - t[k - 1] == BASE_SEC and c[k] > 0 and c[k - 1] > 0:
            r.append(math.log(c[k] / c[k - 1]))
        k -= 1
    if len(r) < min_n:
        return NAN
    return _pstd(r)


def daily_spacing_ok(bd, max_med=4 * 86400):
    """[V33.421] 일봉이 정말 일봉인가 — 간격 중앙값. 야후 range=max 는 굵은 간격(월·분기)을 줄 수 있다."""
    t = bd.get("t") or []
    if len(t) < 5:
        return True
    d = sorted(t[k] - t[k - 1] for k in range(1, len(t)))
    return d[len(d) // 2] <= max_med


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


def _barrier_diag(x, hz, stats, c0, highs, lows, intra=None):
    """[V33.425] 삼중 배리어는 이제 ★라벨이 아니라 진단★ 이다 — 행을 버리지 않는다.
    반환 1|0|-1(못 정함). 시간초과·동시타격 비율은 배리어 폭이 맞는지 보는 눈으로만 남긴다."""
    sg = horizon_sigma(x, hz, intra=intra)
    if not (sg == sg):
        stats["nosig"] += 1
        return -1
    sg = max(sg, SIGMA_FLOOR)
    y, why = barrier_outcome(c0, highs, lows, BARRIER_K * sg, -BARRIER_K * sg)
    if y is None:
        stats[why] += 1
        if why == "timeout":
            stats["to"][hz] += 1
        return -1
    stats["n"][hz] += 1
    return y


def build_rows(sym, mkt, b5, bd, panels=None):
    """한 종목의 모든 행. 각 행 = (피처 40, 매매법, 지평, 라벨, 가중, 결정시각, 라벨끝시각, 사후수익, 종목, 시장, 배리어).
    ★마지막 봉은 버린다★ — 수집 시점에 진행 중이던 봉일 수 있다(확정값이 아니다)."""
    rows = []
    stats = {"amb": 0, "timeout": 0, "nosig": 0, "span": 0, "badDaily": 0, "n": {h: 0 for h in HORIZONS},
             "to": {h: 0 for h in HORIZONS}}
    if bd and not daily_spacing_ok(bd):
        stats["badDaily"] = 1
        bd = None                       # 일봉이 아닌 '일봉' 으로 장타 행·일봉 피처를 만들지 않는다
    if b5 and len(b5.get("t", [])) > MIN_I + 1:
        bdi = bd if bd else {k: [] for k in ("t", "o", "h", "l", "c", "v")}   # 일봉 없음 = 일봉 칸 NaN(죽지 않는다)
        b5 = {k: b5[k][:-1] for k in ("t", "o", "h", "l", "c", "v")}
        n = len(b5["t"])
        i0 = max(MIN_I, n - 1 - INTRA_MAX_POINTS * INTRA_STEP)
        for i in range(i0, n):
            # [V33.425] ★격자를 절대 시계에 건다.★ 예전엔 '배열 끝에서 6봉마다' 였다 — 종목마다
            #   봉 수와 구멍이 달라 결정시각이 어긋난다. 합성 자료는 모든 종목이 같은 격자라
            #   자가검사가 그걸 못 봤지만, 실데이터에선 횡단면 묶음이 통째로 못 만들어진다.
            #   t % 1800 == 0 은 미국(09:30 개장)·한국(09:00) 둘 다 개장부터 30분 격자다.
            if b5["t"][i] % (INTRA_STEP * BASE_SEC):
                continue
            x, st = feature_point(b5, bdi, i, mkt)
            if panels and bdi.get("t"):   # [V33.423] 횡단면 칸 — feature_point 와 ★같은 규칙★ 으로 일봉을 고른다
                _pd = panel_day_of(bdi, _last_daily_before(bdi, local_parts(b5["t"][i], mkt)[2]))
                if _pd is not None:
                    x = panel_fill(x, (panels.get(_pd) or {}).get(sym))
            isg = intra_sigma(b5, i)
            for hz in ("30m", "60m", "1d"):
                nb = H_BARS[hz]
                if i + nb >= n:
                    continue
                if b5["t"][i + nb] - b5["t"][i] > MAX_SPAN_SEC[hz]:
                    stats["span"] += 1      # 30·60분은 장 안에서 끝나야 한다 · 1일은 데이터 구멍을 건너지 않는다
                    continue
                if not (b5["c"][i] > 0 and b5["c"][i + nb] > 0):
                    continue
                yb = _barrier_diag(x, hz, stats, b5["c"][i], b5["h"][i + 1:i + 1 + nb],
                                   b5["l"][i + 1:i + 1 + nb], intra=isg)
                rows.append((x, st, HORIZONS.index(hz), 0, uniq_weight(hz),
                             b5["t"][i] + BASE_SEC, b5["t"][i + nb] + BASE_SEC,
                             math.log(b5["c"][i + nb] / b5["c"][i]), sym, mkt, yb))
    if bd and len(bd.get("t", [])) > D_LOOKBACK + 1:
        bd2 = {k: bd[k][:-1] for k in ("t", "o", "h", "l", "c", "v")}
        n = len(bd2["t"])
        j0 = max(D_LOOKBACK - 1, n - 1 - DAILY_MAX_POINTS * DAILY_STEP)
        for j in range(j0, n):
            # [V33.425] 장타 격자도 같은 이유로 ★날짜★ 에 건다 — '배열 끝에서 2봉마다' 는 종목마다
            #   이력 길이가 달라 홀짝이 갈린다(횡단면 묶음이 반씩 쪼개진다).
            if (bd2["t"][j] // 86400) % DAILY_STEP:
                continue
            x, st = feature_point(None, bd2, None, mkt, daily_row=True, j=j)
            if panels:
                _pd = panel_day_of(bd2, j)
                if _pd is not None:
                    x = panel_fill(x, (panels.get(_pd) or {}).get(sym))
            for hz in ("5d", "20d"):
                nd = H_DAYS[hz]
                if j + nd >= n:
                    continue
                if bd2["t"][j + nd] - bd2["t"][j] > MAX_SPAN_SEC[hz]:
                    stats["span"] += 1
                    continue
                if not (bd2["c"][j] > 0 and bd2["c"][j + nd] > 0):
                    continue
                yb = _barrier_diag(x, hz, stats, bd2["c"][j], bd2["h"][j + 1:j + 1 + nd],
                                   bd2["l"][j + 1:j + 1 + nd])
                rows.append((x, st, HORIZONS.index(hz), 0, uniq_weight(hz),
                             bd2["t"][j] + 86400, bd2["t"][j + nd] + 86400,
                             math.log(bd2["c"][j + nd] / bd2["c"][j]), sym, mkt, yb))
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


def n_threads():
    """[V33.425c] LightGBM 이 쓸 스레드 수 — ★컨테이너에 실제로 준 코어★ 로 잡는다.
    기본값(=호스트의 논리 코어 수)으로 두면, CPU 가 제한된 컨테이너에서 OpenMP 가 할당량보다
    훨씬 많은 스레드를 띄워 서로 밀어낸다. 실측(2026-09-23): ★같은 커밋★ 의 자가검사가
    러너 A 에서 2분 50초, 러너 B 에서 ★13분 넘게★ 안 끝났다(끝나기 전에 취소했다) —
    코드가 아니라 러너가 달랐다. 몇 배까지 벌어지는지는 안 재 봤다(취소해서 못 쟀다).
    OMNI_THREADS 가 있으면 그걸 쓴다(Modal 은 cpu= 값을 그대로 넣어 준다)."""
    import os
    v = os.environ.get("OMNI_THREADS")
    if v and v.strip().isdigit() and int(v) > 0:
        return int(v)
    try:
        return max(1, len(os.sched_getaffinity(0)))
    except Exception:  # noqa: BLE001 — 플랫폼이 없으면 cpu_count 로 떨어진다
        return max(1, os.cpu_count() or 1)
EARLY_STOP = 40
# ══ [V33.425f] ★"모델이긴 한가" 를 대리지표로 묻던 관문 둘을 버렸다.★ ═══════════════════
#   MIN_TREES(나무 총수) — 시드 수에 속는다. 실데이터에서 시드 4 × 7~8라운드 = ★정확히 30그루★
#     가 문턱 30 을 통과했다. 시드를 늘리면 학습이 안 돼도 나무는 늘어난다.
#   MIN_ITERS(라운드 수) — 약한 신호를 실패로 오인한다. V33.425e 에서 라운드 중앙값 10 인
#     모델이 홀드아웃에서 다섯 머리 전부 0.5 위(30m 0.507 · n=192,802 · ★5시그마★)였는데
#     문턱 15 가 그걸 거절했다. 약한 신호도 신호다.
#   둘 다 "배웠나" 를 ★옆에서★ 보는 숫자다. 홀드아웃 성적은 ★직접★ 잴 수 있다 —
#   그래서 holdout_edge() 하나로 바꿨다(아래). 라운드 수와 나무 수는 로그·업로드에 남긴다.
# ══ [V33.424] ★지평 균형 — 실측이 드러낸 구조 결함.★ ═══════════════════════════════════════
#   2026-09-23 실데이터(948종목·1,491,195행): ★나무 2그루★ 로 끝났다(사실상 학습 실패).
#   원인은 하이퍼파라미터가 아니라 ★행 구성★ 이다:
#       30분 182,541 · 60분 152,417 · 1일 202,740 · 5일 ★457,928★ · 20일 ★495,569★
#   5분봉은 공급자가 60일만 주는데 일봉은 몇 년치다. 그래서 장타 두 지평이 표본의 ★64%★ 를
#   차지하고, 그 대부분이 ★오래된 구간★ 이다. 반면 홀드아웃은 최근 35일이라 거의 장중이다
#   (장타는 라벨이 아직 안 끝나 홀드아웃에 못 들어온다 — 20일 홀드아웃 463행).
#   즉 ★옛 장타로 배우고 최근 장중으로 검증★ 하는 꼴이라, 첫 몇 라운드 뒤 검증손실이 바로
#   나빠져 조기종료가 2에서 멈춘다. 한 모델이 여러 지평을 배우려면 지평이 ★같은 발언권★ 을
#   가져야 한다 — 표본 수가 곧 발언권이 되게 두면 자료가 많은 지평이 모델을 통째로 가져간다.
#   → 지평별 가중 합을 같게 맞춘다. 행을 버리지 않는다(정보를 버리는 게 아니라 나눠 준다).
HZ_BALANCE = True


def balance_horizons(A, log=print):
    """지평별 가중 합을 같게. ★고유도 가중의 상대비는 지평 안에서 그대로 유지된다★ —
    지평마다 배수 하나를 곱할 뿐이라, de Prado 고유도가 뜻하는 '겹친 사건은 덜 센다' 는 안 깨진다."""
    import numpy as np
    if not HZ_BALANCE:
        return A, None
    w = A["w"].astype(np.float64).copy()
    tot = []
    for k in range(len(HORIZONS)):
        m = A["hz"] == k
        tot.append(float(w[m].sum()) if m.any() else 0.0)
    live = [t for t in tot if t > 0]
    if len(live) < 2:
        return A, None
    tgt = float(np.mean(live))
    mult = []
    for k in range(len(HORIZONS)):
        f = (tgt / tot[k]) if tot[k] > 0 else 0.0
        mult.append(f)
        if f > 0:
            w[A["hz"] == k] *= f
    A = dict(A)
    A["w"] = w
    log("   · OMNI 지평 균형 — 가중 배수 " + " · ".join(
        "%s ×%.2f" % (HORIZONS[k], mult[k]) for k in range(len(HORIZONS)) if mult[k] > 0))
    return A, mult
# [V33.423] ★시드 앙상블 — DNN 이 하던 일(Deep Ensembles)★ 을 흡수한다.
#   한 시드의 나무는 행 순서·부트스트랩에 흔들린다. 여러 시드의 로짓을 평균하면 그 흔들림이 준다
#   ("모자란 앙상블이 없는 앙상블보다 낫다" — 같은 이유로 DNN 도 6시드였다).
#   ★시드 불일치★ 를 같이 잰다 — 시드끼리 답이 갈리는 행은 모델이 모르는 행이다(불확실성).
SEEDS = 4


def rows_to_arrays(rows):
    """행 목록 → numpy 배열. ★float64★ 로 둔다 — 워커(JS)는 double 로 채점한다. float32 로 학습하면
    문턱 근처 값이 반대편으로 갈 수 있다(같은 봉에서 다른 가지)."""
    import numpy as np
    n = len(rows)
    X = np.empty((n, len(MODEL_FEATS)), dtype=np.float64)
    meta = {k: [] for k in ("st", "hz", "y", "yb", "w", "td", "te", "fr", "sym", "mkt")}
    for k, r in enumerate(rows):
        X[k] = design_row(r[0], r[1], r[2])
        meta["st"].append(r[1]); meta["hz"].append(r[2]); meta["y"].append(r[3]); meta["w"].append(r[4])
        meta["td"].append(r[5]); meta["te"].append(r[6]); meta["fr"].append(r[7])
        meta["sym"].append(r[8]); meta["mkt"].append(r[9]); meta["yb"].append(r[10])
    A = {"X": X}
    for k in ("st", "hz", "y", "yb"):
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


# ══ [V33.425] ★횡단면 라벨 — 실데이터가 두 번 연속 말해 준 것.★ ═══════════════════════════
#   2026-09-23 실데이터(1,008종목 · 1,735,157행 · 피처 76칸 · 지평 균형까지 넣은 회차):
#       나무 30(=시드 4 × 7~8라운드) · 30m AUC 0.492 · 60m 0.488 · 1d 0.502 · 20d 0.834
#   AUC 가 0.5 ★아래로★ 4~6시그마 벗어났다 — 잡음이 아니라 ★뒤집힌 신호★ 다. 그리고 홀드아웃
#   기본율이 30m 48.2% · 60m 47.3% · 1d 44.6% 로 학습 구간과 크게 달랐다. 즉 모델이 배운 건
#   종목 고르기가 아니라 ★그 시절의 시장 방향★ 이었고, 홀드아웃에서 방향이 바뀌자 그대로 뒤집혔다.
#   20일 AUC 0.834 도 같은 물건이다 — 정확도가 무실력과 ★동률★ 이었다(확률이 전부 0.5 한쪽에
#   몰려 있었다. 순위만 시장 방향을 따라간 것이다).
#   절대 등락 라벨에는 ★아무도 예측 못 하는 공통성분(시장)★ 이 통째로 들어 있다. 그게 라벨 분산을
#   지배하고 기본율을 시기마다 흔들어, 검증손실이 첫 라운드부터 나빠지고 조기종료가 즉시 멈춘다.
#   지평 균형(V33.424)은 ★발언권★ 문제를 고쳤지만 ★질문★ 이 틀린 건 못 고친다.
#   → 라벨을 ★같은 시각 · 같은 시장 · 같은 지평의 동료들과 견준 상대★ 로 바꾼다.
#       y = 1  ⇔  이 종목의 지평 수익이 그 순간 동료들의 ★중앙값보다 높다★.
#     · 공통성분이 정의상 빠진다 — 시장이 통째로 오르내려도 라벨은 안 흔들린다.
#     · 기본율이 어느 시기든 ★정확히 50%★ 다 — 기본율 표류로 인한 조기종료가 사라진다.
#     · 무실력 기준선이 50.0% 로 고정돼, 정확도 60% 가 ★진짜 60%★ 가 된다(하한을 낮춘 게 아니다).
#     · 위원회가 실제로 하는 일(후보 중 무엇을 살까)과 ★같은 질문★ 이다.
#   그리고 시간초과 · 동시타격 행을 ★더는 버리지 않는다★ — 동료가 오를 때 조용했던 종목은 못
#   따라간 것이고 그건 정보다. 버리면 표본이 '앞으로 크게 움직인 행' 으로 선택된다(미래를 조건으로
#   건 표본). 실데이터에서 그렇게 사라지던 행이 ★1,398,261행★ 이었다.
XSEC_MIN = 20                   # 같은 시각 · 같은 시장에 이만큼은 있어야 '상대' 라고 말한다


def xsec_feats(A, log=print, min_n=KSEC_MIN):
    """[V33.425g] (시장 · 결정시각) 묶음 안에서 장중 피처의 순위를 매긴다 — ★미래를 안 쓴다★
    (결정시각까지의 값만 쓴다). 한 종목이 지평마다 여러 행으로 있으므로 ★종목 단위로 한 번★
    순위를 내고 그 종목의 모든 행에 같은 값을 넣는다(행 수로 세면 지평이 덜 붙은 종목이 손해다)."""
    import numpy as np
    if not KSEC or A is None or not len(A["y"]):
        return A, {"on": False}
    cols = [FEATS.index(k) for k in KSEC_FEATS]
    src = [FEATS.index(KSEC_SRC[k]) for k in KSEC_FEATS if k in KSEC_SRC]
    order = np.lexsort((A["td"], A["mkt"]))
    md, tdv = A["mkt"][order], A["td"][order]
    n = len(order)
    newg = np.empty(n, dtype=bool)
    newg[0] = True
    newg[1:] = (md[1:] != md[:-1]) | (tdv[1:] != tdv[:-1])
    starts = np.flatnonzero(newg)
    ends = np.append(starts[1:], n)
    X = A["X"]
    used = filled = 0
    for a, b in zip(starts, ends):
        ix = order[a:b]
        syms = {}
        for i in ix:                       # 종목 단위로 접는다(같은 종목의 행은 값이 같다)
            syms.setdefault(A["sym"][i], []).append(i)
        if len(syms) < min_n:
            continue
        keys = list(syms)
        used += 1
        for c, sc in zip(cols, src):
            vals = [X[syms[k][0], sc] for k in keys]
            rk = _qrank(vals)
            for k, r in zip(keys, rk):
                v = NAN if r is None else r
                for i in syms[k]:
                    X[i, c] = v
        for k in keys:                     # k_n — 그 시각에 견준 동료 수(신뢰도)
            for i in syms[k]:
                X[i, cols[-1]] = float(len(keys))
        filled += len(ix)
    info = {"on": True, "groups": int(len(starts)), "used": int(used), "rows": int(filled),
            "cols": len(KSEC_FEATS), "minN": int(min_n)}
    log("   · OMNI 장중 횡단면(실험) — 묶음 %d(쓴 묶음 %d) · %d행에 %d칸 채움" % (
        info["groups"], used, filled, len(KSEC_FEATS)))
    return A, info


def xsec_label(A, log=print, min_n=XSEC_MIN):
    """(시장 · 지평 · 결정시각) 묶음 안에서 지평 수익을 중앙값과 견준다.
    중앙값과 정확히 같은 행은 버린다(어느 쪽도 아니다 — 추측하지 않는다).
    묶음이 작으면 통째로 버린다(동료가 없으면 '상대' 라는 말이 성립하지 않는다)."""
    import numpy as np
    info = {"minN": int(min_n), "was": 0, "kept": 0, "groups": 0, "used": 0,
            "dropSmall": 0, "dropTie": 0, "perHz": {}}
    if A is None or not len(A["y"]):
        return A, info
    order = np.lexsort((A["td"], A["hz"], A["mkt"]))
    md, hzv, tdv, fr = A["mkt"][order], A["hz"][order], A["td"][order], A["fr"][order]
    n = len(order)
    newg = np.empty(n, dtype=bool)
    newg[0] = True
    newg[1:] = (md[1:] != md[:-1]) | (hzv[1:] != hzv[:-1]) | (tdv[1:] != tdv[:-1])
    starts = np.flatnonzero(newg)
    ends = np.append(starts[1:], n)
    y = np.zeros(n, dtype=np.int64)
    keep = np.zeros(n, dtype=bool)
    small = tie = used = 0
    for a, b in zip(starts, ends):
        if b - a < min_n:
            small += int(b - a)
            continue
        seg = fr[a:b]
        med = float(np.median(seg))
        hi = seg > med
        lo = seg < med
        tie += int((b - a) - int(hi.sum()) - int(lo.sum()))
        y[a:b][hi] = 1
        keep[a:b] = hi | lo
        used += 1
    sel = order[keep]
    B = {k: ([A["sym"][i] for i in sel] if k == "sym" else A[k][sel]) for k in A}
    B["y"] = y[keep]
    info.update(was=int(n), kept=int(len(sel)), groups=int(len(starts)), used=int(used),
                dropSmall=int(small), dropTie=int(tie),
                perHz={HORIZONS[k]: int((B["hz"] == k).sum()) for k in range(len(HORIZONS))
                       if (B["hz"] == k).any()})
    base = float(B["y"].mean()) if len(sel) else 0.0
    agree = float((B["y"] == B["yb"]).mean()) if len(sel) else 0.0
    log("   · OMNI 횡단면 라벨 — 묶음 %d(쓴 묶음 %d) · %d행 → %d행 (작은묶음 −%d · 동점 −%d) · "
        "기본율 %.2f%% · 절대라벨과 일치 %.1f%%" % (info["groups"], used, n, len(sel), small, tie,
                                                base * 100, agree * 100))
    log("   · OMNI 횡단면 지평별 " + " · ".join("%s %d" % (h, c) for h, c in info["perHz"].items()))
    return B, info


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


def holdout_edge(heads):
    """[V33.425f] ★"모델이긴 한가" 를 대리지표가 아니라 홀드아웃에서 직접 묻는다.★
    머리별 AUC 를 홀드아웃 행 수로 가중평균하고, 우연으로 이만큼 나올 수 있는지 잰다.

    왜 라운드 수를 그만 쓰는가: V33.425e 실데이터에서 라운드 중앙값 10 인 모델이 홀드아웃에서
      30m 0.507(n=192,802) · 60m 0.510 · 1d 0.512 · 5d 0.507 · 20d 0.518 — ★다섯 전부 0.5 위★,
      30m 만 해도 5시그마였다. 그런데 MIN_ITERS(15) 가 그 모델을 거절했다. 라운드 수는 신호가
      약할수록 짧아지는 ★대리지표★ 일 뿐이고, 약한 신호도 신호다. 반대로 V33.424 의 나무 2그루
      모델은 머리가 0.490~0.504 여서 이 검사에 걸린다 — 잡으려던 건 그쪽이다.

    문턱: 0.5 초과분이 ★3시그마★ 를 넘고, 동시에 ★0.005 이상★ 이어야 한다.
      se 는 귀무가설에서의 AUC 표준오차 1/sqrt(3N)(Bamber). 같은 날 행끼리 상관이 있어 se 가
      과소평가되므로 효과크기 하한(0.005)을 같이 둔다 — 시그마만 믿지 않는다.
      ※ 이건 ★올릴지 말지★ 의 문턱이지 ★발언★ 문턱이 아니다. 발언은 그대로 60% 다."""
    tot = n = 0.0
    for h in (heads or {}).values():
        if (h or {}).get("n", 0) >= 50 and h.get("auc") is not None:
            tot += float(h["auc"]) * int(h["n"])
            n += int(h["n"])
    if n < 1000:
        return {"auc": None, "n": int(n), "se": None, "ok": False, "why": "홀드아웃 %d행 — 잴 게 없다" % n}
    auc = tot / n
    se = 1.0 / math.sqrt(3.0 * n)
    need = max(3.0 * se, 0.005)
    ok = (auc - 0.5) > need
    return {"auc": auc, "n": int(n), "se": se, "need": need, "ok": bool(ok),
            "why": None if ok else "가중평균 홀드아웃 AUC %.4f — 0.5 초과분 %.4f 가 문턱 %.4f 에 못 미친다"
                                   % (auc, auc - 0.5, need)}


def train_model(A, log=print):
    """A 전체에서 분할 → 학습 → 홀드아웃 평가. 반환 (booster, report)."""
    import numpy as np
    import lightgbm as lgb
    A, _hzMult = balance_horizons(A, log=log)
    C, tr, ho = split_cutoff(A)
    if len(tr) < 2000 or len(ho) < 500:
        return None, {"ok": False, "why": "표본 부족 — 학습 %d · 홀드아웃 %d" % (len(tr), len(ho)), "cutoff": C}
    # ══ [V33.425e] ★조기종료 검증이 학습과 다른 질문을 보고 있었다.★ ═══════════════════════
    #   실측(2026-09-23 · 1,005종목 · 3,137,890행 · 횡단면 라벨):
    #     학습(fit)  30m 104,641 · 60m 94,893 · 1d 107,538 · 5d ★907,183★ · 20d ★913,753★
    #     검증(val)  30m 126,208 · 60m 114,644 · 1d 131,046 · 5d 7,532 · 20d ★0★
    #   지평 균형을 넣어도 이렇게 된다 — 균형은 ★전체★ 의 지평별 가중 합을 맞출 뿐이고,
    #   그 뒤에 ★시간으로 한 번 더 자르면★ 장타는 라벨이 길어서 거의 전부 fit 쪽에 남는다
    #   (5·20일 행의 98% 가 fit 에 있고, val 에는 20일이 ★한 행도 없다★).
    #   그래서 fit 가중의 ★72%★ 가 val 이 볼 수 없는 지평에 쓰인다. 모델이 거기서 아무리
    #   배워도 검증손실은 안 내려가고, 조기종료는 몇 라운드에서 멈춘다(실측 [8,5,4,5]).
    #   → 시간 절단을 ★지평마다 따로★ 건다. 퍼징 규칙(라벨 끝 < 절단 · 결정 ≥ 절단)은 그대로다.
    #     지평 구성이 fit 와 val 에서 같아지면, 검증손실이 비로소 ★학습과 같은 질문★ 을 본다.
    Atr = take(A, tr)
    _fit, _val = [], []
    for _k in range(len(HORIZONS)):
        _ix = np.where(Atr["hz"] == _k)[0]
        if len(_ix) < 200:              # 이만큼도 없으면 나눌 게 없다 — 전부 학습에 둔다
            _fit.append(_ix)
            continue
        _c = float(np.quantile(Atr["td"][_ix], 1 - INNER_VAL_FRAC))
        _fit.append(_ix[Atr["te"][_ix] < _c])
        _val.append(_ix[Atr["td"][_ix] >= _c])
    fit = np.concatenate(_fit) if _fit else np.array([], dtype=np.int64)
    val = np.concatenate(_val) if _val else np.array([], dtype=np.int64)
    C2 = None
    if len(val) < 500:
        return None, {"ok": False, "why": "조기종료 검증 %d행 — 지평별로 나눌 표본이 모자라다" % len(val),
                      "cutoff": C}
    dfit = lgb.Dataset(Atr["X"][fit], label=Atr["y"][fit], weight=Atr["w"][fit],
                       feature_name=MODEL_FEATS, free_raw_data=False)
    dval = lgb.Dataset(Atr["X"][val], label=Atr["y"][val], weight=Atr["w"][val], reference=dfit)
    Aho = take(A, ho)
    _nt = n_threads()
    log("   · OMNI 학습 스레드 %d (초과구독 방지 — 컨테이너에 준 코어만 쓴다)" % _nt)
    boosters, raws = [], []
    for sd in range(SEEDS):
        P = dict(LGB_PARAMS, num_threads=_nt, seed=LGB_PARAMS["seed"] + sd * 101,
                 bagging_seed=LGB_PARAMS["seed"] + sd * 211,
                 feature_fraction_seed=LGB_PARAMS["seed"] + sd * 307)
        b = lgb.train(P, dfit, num_boost_round=MAX_ROUNDS, valid_sets=[dval],
                      callbacks=[lgb.early_stopping(EARLY_STOP, verbose=False)])
        it = int(b.best_iteration or b.current_iteration())
        boosters.append((b, it))
        raws.append(b.predict(Aho["X"], num_iteration=it, raw_score=True))
    # 검증손실이 ★동전던지기(ln2)★ 보다 실제로 내려갔나 — 횡단면 라벨이라 기본율이 정확히 50%
    #   이므로 무학습 손실이 ln2 로 ★딱 떨어진다★. 라운드 수 옆에 이 숫자를 같이 남긴다.
    _vg = []
    for b, it in boosters:
        try:
            _vg.append(math.log(2.0) - float(list(list(b.best_score.values())[0].values())[0]))
        except Exception:  # noqa: BLE001 — 관측용이다. 못 읽어도 학습을 막지 않는다
            pass
    raw = np.mean(raws, axis=0)
    dis = float(np.mean(np.std(raws, axis=0))) if len(raws) > 1 else 0.0   # 시드 불일치(불확실성)
    p = 1.0 / (1.0 + np.exp(-raw))
    heads = evaluate_heads(p, Aho)
    best = int(np.mean([it for _, it in boosters]))
    # 지평별 행 수를 남긴다 — 불균형이 다시 생기면 ★로그에서 바로 보인다★(숫자를 숨기지 않는다)
    import collections as _co
    _cnt = lambda ix: dict(_co.Counter(HORIZONS[h] for h in A["hz"][ix]))
    _bl = lambda Z, ix: " · ".join(
        "%s %.1f%%(%d)" % (HORIZONS[k], 100.0 * Z["y"][ix][Z["hz"][ix] == k].mean(),
                           int((Z["hz"][ix] == k).sum()))
        for k in range(len(HORIZONS)) if (Z["hz"][ix] == k).any())
    log("   · OMNI 기본율 학습 " + _bl(Atr, fit))
    log("   · OMNI 기본율 검증 " + _bl(Atr, val))
    log("   · OMNI 기본율 홀드 " + _bl(A, ho))
    log("   · OMNI 시드별 라운드 %s (중앙값 %.0f) · 검증손실 ln2 대비 %s (참고 — 낙관 편향)" % (
        [it for _, it in boosters], float(np.median([it for _, it in boosters])),
        ("—" if not _vg else " · ".join("%+.4f" % v for v in _vg))))
    # 지평 구성이 정말 같아졌는가 — 가중 비중으로 남긴다(다시 갈라지면 여기서 바로 보인다)
    _share = lambda ix: {HORIZONS[k]: round(float(Atr["w"][ix][Atr["hz"][ix] == k].sum())
                                            / max(1e-9, float(Atr["w"][ix].sum())), 4)
                         for k in range(len(HORIZONS)) if (Atr["hz"][ix] == k).any()}
    _sf, _sv = _share(fit), _share(val)
    log("   · OMNI 지평 가중비중 학습 " + " · ".join("%s %.0f%%" % (h, v * 100) for h, v in _sf.items()))
    log("   · OMNI 지평 가중비중 검증 " + " · ".join("%s %.0f%%" % (h, v * 100) for h, v in _sv.items()))
    rep = {"ok": True, "cutoff": C, "innerCut": C2, "nTrain": int(len(fit)), "nVal": int(len(val)),
           "hzFitShare": _sf, "hzValShare": _sv,
           "nHold": int(len(ho)), "bestIter": best, "seeds": len(boosters), "seedDisagree": dis,
           "iters": [it for _, it in boosters], "heads": heads,
           "valGain": [float(v) for v in _vg],
           "hzMult": _hzMult, "hzTrain": _cnt(tr), "hzHold": _cnt(ho)}
    return (boosters, best), rep


def _scale_leaves(t, k):
    """잎 값에 배수를 먹인다 — 앙상블 평균을 ★나무 합★ 으로 바꾸는 유일한 손질."""
    if "w" in t:
        return {"w": t["w"] * k}
    return {"f": t["f"], "t": t["t"], "dl": t["dl"], "mt": t["mt"],
            "l": _scale_leaves(t["l"], k), "r": _scale_leaves(t["r"], k)}


def export_model(boosters, best=None):
    """[V33.423] 시드 앙상블 → 워커 형식. ★채점기를 안 건드린다★:
       앙상블 값 = (1/S)·Σ_s Σ_t 잎  =  Σ (잎/S) — 잎에 1/S 를 먹여 전부 이어 붙이면
       워커의 '나무 합' 채점이 그대로 앙상블 평균이 된다(새 코드 0줄).
       각 시드는 ★자기 best★ 까지만 — 잰 모델 = 올라가는 모델."""
    if not isinstance(boosters, list):
        boosters = [(boosters, best)]
    k = 1.0 / len(boosters)
    out = []
    for b, it in boosters:
        dump = b.dump_model(num_iteration=it)
        if dump.get("objective", "").split(" ")[0] != "binary":
            raise ValueError("binary 목적만 지원")
        if len(dump.get("feature_names", [])) != len(MODEL_FEATS):
            raise ValueError("피처 수 불일치")
        for t in dump["tree_info"]:
            out.append(_scale_leaves(export_tree(t["tree_structure"]), k))
    return out


def feature_gain(boosters):
    """[V33.423] ★구조 관측용★ — 어느 칸이 실제로 갈림을 만들었나(gain 합, 시드 합산 후 정규화).
    DNN 의 '두뇌 구조' 가 사라진 자리를 이 모델의 ★진짜 구조★ 로 채운다(지어내지 않는다)."""
    tot = [0.0] * len(MODEL_FEATS)
    for b, it in boosters:
        g = b.feature_importance(importance_type="gain", iteration=it)
        for k in range(min(len(tot), len(g))):
            tot[k] += float(g[k])
    s = sum(tot)
    return [(v / s if s > 0 else 0.0) for v in tot]


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


def _new_tot():
    return {"amb": 0, "timeout": 0, "nosig": 0, "span": 0, "badDaily": 0,
            "n": {h: 0 for h in HORIZONS}, "to": {h: 0 for h in HORIZONS}}


def _acc(tot, st):
    for k, v in st.items():
        if isinstance(v, dict):
            for h, x in v.items():
                tot[k][h] = tot[k].get(h, 0) + x
        else:
            tot[k] = tot.get(k, 0) + v


def _tot_line(tot):
    """[V33.425] 배리어는 이제 ★진단★ 이다(라벨 아님). 지평별 배리어 적중 수와 시간초과 비율 —
    배리어 폭이 맞는지 보는 눈으로만 남긴다. 어느 쪽도 행을 버리지 않는다."""
    per = " · ".join("%s %d(초과 %.0f%%)" % (h, tot["n"][h], 100.0 * tot["to"][h] / max(1, tot["n"][h] + tot["to"][h]))
                     for h in HORIZONS)
    return "배리어 진단(동시타격 %d · 시간초과 %d · σ없음 %d) · 구멍 %d · 일봉아님 %d종목 · 지평별 %s" % (
        tot["amb"], tot["timeout"], tot["nosig"], tot["span"], tot["badDaily"], per)


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
    # [V33.423] ★패널을 먼저 만든다★ — 횡단면 칸은 같은 날 다른 종목이 있어야 생긴다.
    #   일봉은 전부 받아 둔 상태이므로 여기가 유일하게 가능한 자리다(5분봉은 흘려서 버린다).
    _t1 = time.time()
    panels = build_panels(daily, {s: ix[s].get("m", "us") for s in syms})
    log("   · OMNI 패널 %d일 (종목 %d · %.0fs) — 횡단면 랭크·시장 상대가 여기서 나온다" % (
        len(panels), len(daily), time.time() - _t1))
    parts = []
    tot = _new_tot()
    seen = set()
    n5 = 0

    def _eat(s, b5):
        rows, st = build_rows(s, ix[s].get("m", "us"), b5, daily.get(s), panels=panels)
        _acc(tot, st)
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
    A, tot["ksec"] = xsec_feats(A, log=log)
    A, tot["xsec"] = xsec_label(A, log=log)
    log("   · OMNI 봉 수신 %d종목 (5분봉 %d · 일봉 %d)" % (len(syms), n5, len(daily)))
    # 색인이 말하는 실제 간격(야후 dataGranularity)과 저장 판 — 수집기가 무엇을 받았는지 그대로 보인다
    gr = {}
    for s in syms:
        e = ix[s].get("1d") or {}
        key = "%s/v%s%s" % (e.get("g") or "?", e.get("v") or 1, "/거부" if e.get("bad") else "")
        gr[key] = gr.get(key, 0) + 1
    log("   · OMNI 일봉 색인 간격/판: " + " · ".join("%s %d" % kv for kv in sorted(gr.items())))
    log("   · OMNI 표본 %s행 · 종목 %d · %.0fs" % (0 if A is None else len(A["y"]), len(seen), time.time() - t0))
    log("   · OMNI " + _tot_line(tot))
    return A, tot, len(seen)


def build_dataset(data, log=print, panels=None):
    """메모리에 이미 있는 봉(자가검사용)."""
    import time
    t0 = time.time()
    if panels is None:
        panels = build_panels({s: d.get("1d") for s, d in data.items()},
                              {s: d["m"] for s, d in data.items()})
    parts = []
    tot = _new_tot()
    nsym = 0
    for s, d in data.items():
        rows, st = build_rows(s, d["m"], d.get("5m"), d.get("1d"), panels=panels)
        _acc(tot, st)
        if rows:
            parts.append(rows_to_arrays(rows))
            nsym += 1
    A = concat_arrays(parts)
    A, tot["ksec"] = xsec_feats(A, log=log)
    A, tot["xsec"] = xsec_label(A, log=log)
    log("   · OMNI 표본 %s행 · 종목 %d · %.0fs" % (0 if A is None else len(A["y"]), nsym, time.time() - t0))
    log("   · OMNI " + _tot_line(tot))
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


def make_probe(boosters, best, A, n=PROBE_N, seed=5):
    """정합 probe — 홀드아웃에서 장타·장중을 반씩(장타 행은 장중 칸이 NaN). 기대값은 lgb 자체의 raw."""
    import numpy as np
    rng = np.random.default_rng(seed)
    d_ix = np.where(A["hz"] >= 3)[0]
    i_ix = np.where(A["hz"] < 3)[0]
    pick = np.concatenate([rng.choice(d_ix, min(n // 2, len(d_ix)), replace=False) if len(d_ix) else [],
                           rng.choice(i_ix, min(n - n // 2, len(i_ix)), replace=False) if len(i_ix) else []])
    pick = pick.astype(np.int64)
    X = A["X"][pick]
    if not isinstance(boosters, list):
        boosters = [(boosters, best)]
    raw = np.mean([b.predict(X, num_iteration=it, raw_score=True) for b, it in boosters], axis=0)
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
    boosters, best = m
    trees = export_model(boosters)
    gain = feature_gain(boosters)
    C, _, ho = split_cutoff(A)
    probe = make_probe(boosters, best, take(A, ho))
    mine = [score_raw(trees, [NAN if v is None else v for v in pr["x"]]) for pr in probe]
    pmax = max([abs(a - pr["raw"]) for a, pr in zip(mine, probe)] or [0.0])
    log("   · OMNI 나무 %d(시드 %d · 불일치 %.4f) · 학습 %d · 조기종료검증 %d · 홀드아웃 %d (절단 %s) · 자체 정합 %.2g" % (
        len(trees), rep.get("seeds", 1), rep.get("seedDisagree", 0.0),
        rep["nTrain"], rep["nVal"], rep["nHold"],
        __import__("datetime").datetime.fromtimestamp(rep["cutoff"], __import__("datetime").timezone.utc)
        .strftime("%Y-%m-%d"), pmax))
    for hz in HORIZONS:
        log("   · OMNI " + head_line(hz, rep["heads"].get(hz)))
    # ══ [V33.425f] ★"모델이긴 한가" 를 홀드아웃에서 직접 묻는다.★ ═══════════════════════
    #   V33.424 에서는 나무 2그루짜리가 정합·형식·probe 를 전부 통과해 올라갔다 — 관문들이
    #   "맞는 모델인가" 만 보고 "모델이긴 한가" 를 안 봤기 때문이다. 그때 세운 관문(나무 수 ·
    #   라운드 수)은 ★대리지표★ 였고, V33.425e 에서 실제로 ★실력 있는 모델을 거절했다★
    #   (라운드 중앙값 10 인데 다섯 머리 전부 0.5 위 · 30m 만 5시그마). 대리지표를 버리고
    #   홀드아웃 성적을 직접 본다 — 잴 수 있는 것을 재지 않을 이유가 없다.
    _its = sorted(rep.get("iters") or [best])
    _med = _its[len(_its) // 2] if len(_its) % 2 else (_its[len(_its) // 2 - 1] + _its[len(_its) // 2]) / 2.0
    _edge = holdout_edge(rep.get("heads"))
    rep["edge"] = _edge
    log("   · OMNI 홀드아웃 실력 — 가중평균 AUC %s · %d행 · 필요 초과분 %s · %s" % (
        "—" if _edge["auc"] is None else "%.4f" % _edge["auc"], _edge["n"],
        "—" if _edge.get("need") is None else "%.4f" % _edge["need"],
        "✅ 올린다" if _edge["ok"] else "보류"))
    if len(trees) < 2 or not _edge["ok"]:
        log("   ⏭ OMNI 나무 %d그루 · 라운드 %s(중앙값 %.1f) · %s — ★배운 것이 없어 올리지 않는다★"
            % (len(trees), _its, _med, _edge.get("why")))
        rep["ok"] = False
        rep["why"] = _edge.get("why") or "나무 %d그루" % len(trees)
        return rep
    if KSEC:
        log("   ⏭ OMNI ★장중 횡단면 실험 회차★ — 칸이 워커에 없다. 재기만 하고 올리지 않는다.")
        rep["ok"] = False
        rep["why"] = "OMNI_KSEC 실험 회차 — 업로드 안 함"
        return rep
    if pmax > 1e-9:
        log("   ⚠️ OMNI 내보낸 나무가 LightGBM 과 다른 답을 낸다(%.3g) — 업로드하지 않는다" % pmax)
        return rep
    payload = _clean({"v": OMNI_VER, "feats": MODEL_FEATS, "horizons": HORIZONS, "setups": SETUPS,
               "consts": {"sess": SESS_MIN, "openUs": OPEN_MIN["us"], "openKr": OPEN_MIN["kr"],
                          "hLook": H_LOOKBACK, "dLook": D_LOOKBACK, "base": BASE_SEC},
               "trees": trees, "probe": probe, "heads": rep["heads"], "cutoff": rep["cutoff"],
               "bestIter": best, "nTrain": rep["nTrain"], "nHold": rep["nHold"], "nSym": nsym,
               "seeds": rep.get("seeds", 1), "seedDisagree": rep.get("seedDisagree", 0.0),
               "gain": gain, "featNames": MODEL_FEATS, "panelFeats": PANEL_FEATS,
               "hzTrain": rep.get("hzTrain"), "hzHold": rep.get("hzHold"), "hzMult": rep.get("hzMult"),
               "label": "xsec", "xsecMin": XSEC_MIN, "xsec": (excl or {}).get("xsec"),
               "iters": rep.get("iters"), "valGain": rep.get("valGain"),
               "hzFitShare": rep.get("hzFitShare"), "hzValShare": rep.get("hzValShare"),
               "edge": rep.get("edge"),
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
