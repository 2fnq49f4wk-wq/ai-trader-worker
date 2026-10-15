"""[V33.601 · Phase A] 매매법 도감(Strategy-Catalog) — 매매법을 '같은 규격의 객체'로 정리한다.

사용자 구상(10/15): "AI 가 인간처럼 매우 다양한 매매법을 적재적소에 쓰게". 지금은 '종목 → 확률 하나 → 상위 18% 매수' 다.
이 파일은 그 위에 얹을 선택 층(Strategy-Router)의 1단계 — 후보 매매법들을 한 곳에 같은 규격으로 정의한다.

규격(매매법 하나):
  id        고유 이름                      family   계열(Trend · Pullback · Rebound · Stochastic · Volume · Volatility · Value · Momentum)
  horizon   'snap'(≤10일) · 'swing'(≤30일) — 보유 기간이 크게 다른 것을 한 번에 비교하지 않는다(원칙 3)
  entry     (P) → 날짜×종목 bool 표(신호 발화) — ★전 종목을 한 번에★(벡터화) · 학습 표본 생성(Phase B)이 그대로 쓴다
  exit      청산 프로필(손절 % · ATR 배수 · 1차 익절 R · 최대 보유일 · 추가 청산 신호)
  regimes   이 매매법이 의미 있는 시장 국면(Layer 1 의 BULL/NEUTRAL/BEAR 와 같은 말)
  status    'rule'(워커 규칙 있음) · 'new'(이번에 새로 씀) · 'partial' · 'blocked'(학습 제외)

입력 P: factor_screen.build_wide 가 만드는 날짜×종목 넓은 표 — open · high · low · close · volume (· returns).
출력은 전부 '신호가 떴나' 일 뿐이다 — 얼마나 벌었나(라벨)는 Phase B, 어느 것을 고르나는 Phase C 가 한다.
공매도가 없는 엔진이라 'Overbought Exit' 는 진입 매매법이 아니라 ★청산 신호★(EXIT_SIGNALS)다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

COST_RT = {"us": 0.10, "kr": 0.30}   # 왕복 비용 %(한국은 거래세 포함) — 원칙 5 · 학습 라벨에서 미리 뺀다


# ── 지표(전 종목 벡터화) ────────────────────────────────────────────
def _ma(c, n):
    return c.rolling(n, min_periods=n).mean()


def _rsi(c, n):
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).where(dn > 0, 100.0)


def _rsi_simple(c, n):
    """RSI(2) 처럼 짧은 창 — 단순평균(워커 getRSI 와 같은 계열)."""
    d = c.diff()
    up = d.clip(lower=0).rolling(n).mean()
    dn = (-d.clip(upper=0)).rolling(n).mean()
    return (100 - 100 / (1 + up / dn.replace(0, np.nan))).where(dn > 0, 100.0)


def _stoch_slow(h, l, c, n=14, ks=3, ds=3):
    """스토캐스틱 슬로우(14,3,3) — 워커 getStochSlow 와 같은 정의. 고가=저가면 중립 50."""
    hh, ll = h.rolling(n, min_periods=n).max(), l.rolling(n, min_periods=n).min()
    rng = (hh - ll).where((hh - ll) > 0)
    fast = ((c - ll) / rng * 100).fillna(50.0).where(hh.notna())
    k = fast.rolling(ks, min_periods=ks).mean()
    d = k.rolling(ds, min_periods=ds).mean()
    return k, d


def _bb(c, n=20, k=2.0):
    m = _ma(c, n)
    s = c.rolling(n, min_periods=n).std(ddof=0)
    return m - k * s, m + k * s, (2 * k * s) / m


def _atr_pct(h, l, c, n=14):
    pc = c.shift(1)
    tr = np.maximum(h - l, np.maximum((h - pc).abs(), (l - pc).abs()))
    return tr.rolling(n, min_periods=n).mean() / c * 100


def _xrank(x):
    """날짜별 횡단면 순위(0~1)."""
    return x.rank(axis=1, pct=True)


def _ind(P):
    """한 번 계산해 매매법들이 같이 쓰는 지표 묶음(같은 P 에는 캐시)."""
    cache = P.get("_ind")
    if cache is not None:
        return cache
    c, h, l, o = P["close"], P.get("high", P["close"]), P.get("low", P["close"]), P.get("open", P["close"])
    v = P.get("volume")
    I = {"c": c, "h": h, "l": l, "o": o, "v": v}
    I["ma5"], I["ma10"], I["ma20"], I["ma50"], I["ma200"] = (_ma(c, n) for n in (5, 10, 20, 50, 200))
    I["rsi14"], I["rsi2"] = _rsi(c, 14), _rsi_simple(c, 2)
    I["ret1"] = c.pct_change(fill_method=None) * 100
    I["ret5"], I["ret20"] = c.pct_change(5, fill_method=None) * 100, c.pct_change(20, fill_method=None) * 100
    I["hi20"] = c.rolling(20, min_periods=20).max()
    I["hi20_prev"] = c.shift(1).rolling(20, min_periods=20).max()
    I["atr"] = _atr_pct(h, l, c)
    I["bbl"], I["bbu"], I["bbw"] = _bb(c)
    I["sk"], I["sd"] = _stoch_slow(h, l, c)
    if v is not None:
        I["vavg"] = v.shift(1).rolling(20, min_periods=20).mean()
        I["vr"] = v / I["vavg"].replace(0, np.nan)
    else:
        I["vavg"] = I["vr"] = None
    rng = (h - l).where((h - l) > 0)
    I["cpos"] = ((c - l) / rng).fillna(0.5)
    P["_ind"] = I
    return I


def _and(*xs):
    out = None
    for x in xs:
        out = x if out is None else (out & x)
    return out.fillna(False)


# ── 진입 판정(전 종목 벡터) ─────────────────────────────────────────
# 문턱은 ★워커의 기존 규칙(evaluate*Entry)과 같은 값★ 에서 가져왔다 — 규칙 쪽을 바꾸면 여기도 같이 바꾼다(check-strategy-catalog).
def e_trend_align(P):
    I = _ind(P)
    return _and(I["ma20"] > I["ma50"], I["ma50"] > I["ma200"], I["c"] > I["ma20"], I["rsi14"] >= 45, I["rsi14"] <= 72)


def e_breakout(P):
    I = _ind(P)
    cond = [I["c"] > I["hi20_prev"], I["c"] > I["ma50"], I["ret1"] > 0]
    if I["vr"] is not None:
        cond.append(I["vr"] >= 1.5)
    return _and(*cond)


def e_rs_leader(P):
    I = _ind(P)
    return _and(_xrank(I["ret20"]) >= 0.9, I["c"] > I["ma50"], I["ma20"] > I["ma50"], I["rsi14"] <= 78)


def e_vt_trend(P):
    """변동성 타겟 추세 — 추세 위 + 실현변동성이 낮아(ATR<4%) 크기를 키울 수 있는 상태."""
    I = _ind(P)
    return _and(I["c"] > I["ma50"], I["ma20"] > I["ma50"], I["atr"] < 4.0, I["ret20"] > 0)


def e_pullback(P):
    """TR_PULLBACK — 상승추세 안 MA20 ±4% · 오늘 양봉 · RSI 37~68."""
    I = _ind(P)
    gap = (I["c"] / I["ma20"] - 1).abs()
    return _and(I["ma20"] > I["ma50"], gap <= 0.04, I["ret1"] > 0, I["rsi14"] >= 37, I["rsi14"] <= 68)


def e_ma_pullback(P):
    """상승추세 안 MA20 을 저가로 찍고 종가는 그 위로 회복(지지 확인)."""
    I = _ind(P)
    return _and(I["ma50"] > I["ma200"], I["ma20"] > I["ma50"], I["l"] <= I["ma20"] * 1.003, I["c"] > I["ma20"], I["ret1"] > 0)


def e_sn_rsi2(P):
    """SN_RSI2 — 장기 상승추세(MA50>MA200, 가격>MA200) 안 RSI2 ≤ 12 · MA5 아래 · 반전 확인."""
    I = _ind(P)
    return _and(I["c"] > I["ma200"], I["ma50"] > I["ma200"], I["rsi2"] <= 12, I["c"] < I["ma5"], I["rsi14"] <= 55,
                (I["ret1"] > 0) | (I["cpos"] >= 0.5) | (I["rsi2"] <= 3))


def e_ha_rev(P):
    """하이킨아시 강세 전환 — 직전 2봉 하락 HA, 오늘 양(+)봉 · 아래꼬리 짧음."""
    I = _ind(P)
    o, h, l, c = I["o"], I["h"], I["l"], I["c"]
    hac = (o + h + l + c) / 4
    hao = ((o.shift(1) + c.shift(1)) / 2)
    bull = hac > hao
    return _and(bull, ~bull.shift(1, fill_value=True), ~bull.shift(2, fill_value=True), I["c"] > I["ma50"] * 0.97)


def e_bb_low(P):
    I = _ind(P)
    return _and(I["c"] <= I["bbl"], I["rsi14"] < 38, I["rsi14"] > 20, I["ret1"] > 0)


def e_stoch_cross(P):
    """스토캐스틱 교차 반등 — 과매도권(K≤30)에서 %K 가 %D 를 상향 돌파 · 장기 추세 훼손 없음."""
    I = _ind(P)
    k, d = I["sk"], I["sd"]
    cross = (k > d) & (k.shift(1) <= d.shift(1))
    return _and(cross, k.shift(1) <= 30, I["c"] > I["ma200"] * 0.95)


def e_stoch_oversold_exit(P):
    """과매도 이탈 — %K 가 20 아래에서 20 위로 올라서는 날(상승 전환 시작) · 하락추세 중엔 제외."""
    I = _ind(P)
    k = I["sk"]
    return _and(k > 20, k.shift(1) <= 20, I["ret1"] > 0, I["c"] > I["ma200"] * 0.95)


def e_vol_breakout(P):
    I = _ind(P)
    if I["vr"] is None:
        return pd.DataFrame(False, index=I["c"].index, columns=I["c"].columns)
    return _and(I["vr"] >= 2.0, I["c"] > I["hi20_prev"], I["ret1"] > 0, I["c"] > I["ma50"])


def e_vol_revert(P):
    """VS_REV — 거래량 3배 급증 + −4~−18% 급락 + 저가권 마감 + RSI2 ≤ 8 + MA200 위."""
    I = _ind(P)
    if I["vr"] is None:
        return pd.DataFrame(False, index=I["c"].index, columns=I["c"].columns)
    return _and(I["vr"] >= 3.0, I["ret1"] <= -4.0, I["ret1"] >= -18.0, I["cpos"] <= 0.45, I["rsi2"] <= 8, I["c"] > I["ma200"])


def e_os_deep(P):
    """[V33.618] 깊은 과매도 반등 — RSI2 ≤ 5 · 볼린저 하단 아래 · 5일 −7% 이하 · RSI14 ≤ 35. ★추세 조건 없음★(폭락장 후보용).
    OMNI-Q 가 고르는 후보(급락주)에 맞는 진입이 도감에 없었다 — 반등 매매법이 전부 MA200 위·양봉을 요구했다. 성적은 시뮬이 판정한다."""
    I = _ind(P)
    return _and(I["rsi2"] <= 5, I["c"] <= I["bbl"], I["ret5"] <= -7, I["rsi14"] <= 35)


def e_capit_rev(P):
    """[V33.618] 투매 반등 — 거래량 2배 이상 · 당일 −5~−25% · MA20 대비 −10% 이하 · 그날 종가 매수(추세 조건 없음)."""
    I = _ind(P)
    if I["vr"] is None:
        return pd.DataFrame(False, index=I["c"].index, columns=I["c"].columns)
    return _and(I["vr"] >= 2.0, I["ret1"] <= -5.0, I["ret1"] >= -25.0, I["c"] <= I["ma20"] * 0.90)


# ── [V33.619] 고전 기술적 매매법 10종(사용자 10/15 제안) — 워커 pbDailyFires 와 같은 식(check-playbook 대조) ──
def _ema(x, n):
    """지수이동평균 — pandas ewm(span=n, adjust=False). 워커 _pbEma 와 같다."""
    return x.ewm(span=n, adjust=False).mean()


def e_ichimoku(P):
    """이치모쿠 구름대 돌파 — 종가가 구름 상단(선행스팬 1·2 중 큰 값 · 26일 앞당김)을 오늘 처음 넘음 · 전환선 > 기준선 · 구름 두께 ≤ 5%."""
    I = _ind(P)
    h, l, c = I["h"], I["l"], I["c"]
    ten = (h.rolling(9).max() + l.rolling(9).min()) / 2
    kij = (h.rolling(26).max() + l.rolling(26).min()) / 2
    sa = ((ten + kij) / 2).shift(26)
    sb = ((h.rolling(52).max() + l.rolling(52).min()) / 2).shift(26)
    top = sa.where(sa > sb, sb)
    return _and(c > top, c.shift(1) <= top.shift(1), ten > kij, (sa - sb).abs() / c <= 0.05)


def e_keltner(P):
    """켈트너 채널 돌파 — EMA20 + 2×ATR10(단순평균) 상단을 오늘 처음 넘는 양봉."""
    I = _ind(P)
    h, l, c = I["h"], I["l"], I["c"]
    pc = c.shift(1)
    tr = pd.concat([(h - l), (h - pc).abs(), (l - pc).abs()]).groupby(level=0).max().reindex(c.index)
    up = _ema(c, 20) + 2 * tr.rolling(10).mean()
    return _and(c > up, c.shift(1) <= up.shift(1), I["ret1"] > 0)


def e_donchian(P):
    """돈치안 채널(터틀) 돌파 — 지난 55일 최고가를 오늘 처음 넘음."""
    I = _ind(P)
    hp = I["h"].shift(1).rolling(55).max()
    return _and(I["c"] > hp, I["c"].shift(1) <= hp.shift(1))


def e_macd(P):
    """MACD(12·26·9) — 0 아래에서 시그널 상향 교차(초기 반전) 또는 0선 상향 돌파(시그널 위)."""
    I = _ind(P)
    m = _ema(I["c"], 12) - _ema(I["c"], 26)
    s = _ema(m, 9)
    xs = (m > s) & (m.shift(1) <= s.shift(1))
    xz = (m > 0) & (m.shift(1) <= 0)
    return ((xs & (m < 0)) | (xz & (m > s))).fillna(False)


def e_envelope(P):
    """이격도(엔벨로프) 반등 — 어제 종가가 MA20 −7% 선 아래 · 오늘 그 선 위로 회복한 양봉."""
    I = _ind(P)
    lo = I["ma20"] * 0.93
    return _and(I["c"].shift(1) < lo.shift(1), I["c"] > lo, I["ret1"] > 0)


def e_elder_ray(P):
    """엘더 레이 — EMA13 상승 중 · 베어 파워(저가 − EMA13) 음수이면서 어제 바닥 찍고 오늘 올라섬."""
    I = _ind(P)
    e = _ema(I["c"], 13)
    bear = I["l"] - e
    return _and(e > e.shift(1), bear < 0, bear > bear.shift(1), bear.shift(1) <= bear.shift(2))


def e_williams_r(P):
    """윌리엄스 %R(14) — 어제 −80 이하(과매도) · 오늘 −80 위로."""
    I = _ind(P)
    hh, ll = I["h"].rolling(14).max(), I["l"].rolling(14).min()
    rg = hh - ll
    wr = ((hh - I["c"]) / rg.where(rg > 0) * -100).fillna(-50.0).where(hh.notna())
    return _and(wr.shift(1) <= -80, wr > -80)


def _cci(P, n=20):
    I = _ind(P)
    tp = (I["h"] + I["l"] + I["c"]) / 3
    sma = tp.rolling(n).mean()
    a = tp.values
    mad = np.full(a.shape, np.nan)
    if a.shape[0] >= n:
        from numpy.lib.stride_tricks import sliding_window_view
        w = sliding_window_view(a, n, axis=0)                       # (T-n+1, N, n)
        mad[n - 1:] = np.abs(w - w.mean(axis=2, keepdims=True)).mean(axis=2)
    mad = pd.DataFrame(mad, index=tp.index, columns=tp.columns)
    return (tp - sma) / (0.015 * mad.where(mad > 0))


def e_cci(P):
    """CCI(20) — 어제 −100 이하 · 오늘 −100 위로(평균 회귀)."""
    c = _cci(P)
    return _and(c.shift(1) <= -100, c > -100)


def _psar_flip(h, l):
    """파라볼릭 SAR(0.02 · 최대 0.2) — 하락 → 상승으로 뒤집힌 날 True. 워커 _pbPsarFlipUp 과 같은 순서(첫 유효 봉 = 상승 가정)."""
    H, L = h.values, l.values
    T, N = H.shape
    out = np.zeros((T, N), dtype=bool)
    for j in range(N):
        hj, lj = H[:, j], L[:, j]
        ok = np.isfinite(hj) & np.isfinite(lj)
        idx = np.nonzero(ok)[0]
        if len(idx) < 3:
            continue
        j0 = idx[0]
        up, sar, ep, af = True, lj[j0], hj[j0], 0.02
        p1, p2 = j0, j0                                              # 직전·그 전 유효 봉
        for i in idx[1:]:
            s = sar + af * (ep - sar)
            if up:
                s = min(s, lj[p1], lj[p2])
                if lj[i] < s:
                    up, s, ep, af = False, ep, lj[i], 0.02
                elif hj[i] > ep:
                    ep, af = hj[i], min(af + 0.02, 0.2)
            else:
                s = max(s, hj[p1], hj[p2])
                if hj[i] > s:
                    up, s, ep, af = True, ep, hj[i], 0.02
                    out[i, j] = True
                elif lj[i] < ep:
                    ep, af = lj[i], min(af + 0.02, 0.2)
            sar = s
            p2, p1 = p1, i
    return pd.DataFrame(out, index=h.index, columns=h.columns)


def e_psar(P):
    """파라볼릭 SAR 반전 — 하락 SAR 이 오늘 가격 아래로 뒤집힘(상승 전환)."""
    I = _ind(P)
    return _psar_flip(I["h"], I["l"])


def e_triple_screen(P):
    """삼중창(엘더) — ① 큰 추세: EMA65(≈13주) 가 5일 전보다 위 ② 어제 슬로우 스토캐스틱 %K ≤ 30(눌림) ③ 오늘 종가가 어제 고가 돌파."""
    I = _ind(P)
    e = _ema(I["c"], 65)
    return _and(e > e.shift(5), I["sk"].shift(1) <= 30, I["c"] > I["h"].shift(1))


# ── [V33.622] 인터넷 조사 뒤 추가 2종 — 근거가 있는 것만(사용자 10/15 "필요하면 신규 매매법 찾아 분석해 추가") ──
def e_ibs_low(P):
    """IBS(내부 봉 강도) 저점 — (종가 − 저가)/(고가 − 저가) ≤ 0.2 · 하락일 · 200일선 위. Pagonidis(2014) 이후 ETF·지수에서 반복 확인 · 개별 종목은 약함 → 시뮬이 판정."""
    I = _ind(P)
    return _and(I["cpos"] <= 0.2, I["ret1"] < 0, I["c"] > I["ma200"])


def e_hi52_near(P):
    """52주 고가 근접 — 종가가 252일 최고가의 97% 이상으로 오늘 처음 들어섬 · 50일선 위 · 양봉. George & Hwang(2004, JF): 52주 고가 근접도가 과거 수익보다 미래 수익을 잘 예측 · 되돌림 없음."""
    I = _ind(P)
    hi = I["h"].rolling(252).max()
    near = I["c"] / hi >= 0.97
    return _and(near, ~near.shift(1, fill_value=True), I["c"] > I["ma50"], I["ret1"] > 0)


def e_squeeze(P):
    """볼린저 폭이 최근 120일 하위 10% 로 수축한 뒤 상단 돌파."""
    I = _ind(P)
    w = I["bbw"]
    low = w.shift(1) <= w.shift(1).rolling(120, min_periods=60).quantile(0.10)
    return _and(low, I["c"] > I["bbu"], I["c"] > I["ma50"])


def e_xs_arb(P):
    """XS_ARB — 5일 수익률의 횡단면 z(시장 평균 제거) ≤ −1.8 · MA200 위."""
    I = _ind(P)
    r = I["ret5"]
    z = r.sub(r.mean(axis=1), axis=0).div(r.std(axis=1).replace(0, np.nan), axis=0)
    return _and(z <= -1.8, I["c"] > I["ma200"])


def e_dual_momentum(P):
    """듀얼 모멘텀(종목판) — 절대모멘텀(12−1개월 수익 > 0) + 상대모멘텀(횡단면 상위 20%). 섹터 로테이션은 다음 단계."""
    I = _ind(P)
    c = I["c"]
    m = c.shift(21) / c.shift(252) - 1
    return _and(m > 0, _xrank(m) >= 0.8, c > I["ma200"])


def e_herding_rebound(P):
    """거래량 폭증 뒤 2차 파동 — 최근 6일 안에 거래량 2.5배 양봉이 있었고, 그 고점에서 5~12% 눌린 뒤 MA20 위에서 반등."""
    I = _ind(P)
    if I["vr"] is None:
        return pd.DataFrame(False, index=I["c"].index, columns=I["c"].columns)
    surge = ((I["vr"] >= 2.5) & (I["ret1"] > 0)).astype(float)
    recent = surge.rolling(6, min_periods=1).max().shift(1) > 0
    hi6 = I["c"].rolling(6, min_periods=2).max().shift(1)
    dd = (I["c"] / hi6 - 1) * 100
    return _and(recent, dd <= -5, dd >= -12, I["c"] > I["ma20"] * 0.98, I["ret1"] > 0)


# ── 청산 프로필 ─────────────────────────────────────────────────────
# stop: 최대 손절 % · atr: ATR 손절 배수 · tp1R: 1차 익절(R 배수) · hold: 최대 보유일 · trail: 트레일 시작 R
EXIT = {
    "trend":   {"stop": 7.0, "atr": 2.0, "tp1R": 1.0, "hold": 30, "trail": 1.5},
    "pullbk":  {"stop": 5.0, "atr": 2.0, "tp1R": 1.0, "hold": 20, "trail": 1.2},
    "snap":    {"stop": 4.0, "atr": 1.5, "tp1R": 0.8, "hold": 8,  "trail": 0.8},
    "stoch":   {"stop": 4.0, "atr": 1.5, "tp1R": 1.0, "hold": 10, "trail": 1.0},
    "volume":  {"stop": 5.0, "atr": 1.8, "tp1R": 1.0, "hold": 12, "trail": 1.0},
    "vol":     {"stop": 5.0, "atr": 2.0, "tp1R": 1.2, "hold": 15, "trail": 1.2},
    "value":   {"stop": 5.0, "atr": 1.8, "tp1R": 1.0, "hold": 10, "trail": 1.0},
    "mom":     {"stop": 8.0, "atr": 2.5, "tp1R": 1.5, "hold": 30, "trail": 2.0},
}
# 공매도가 없으니 '과열 이탈' 은 사는 매매법이 아니라 보유 종목을 ★파는★ 신호다.
EXIT_SIGNALS = {
    "stoch_overbought_exit": lambda P: _and(_ind(P)["sk"] < 80, _ind(P)["sk"].shift(1) >= 80, _ind(P)["sk"] < _ind(P)["sd"]),
}

R_BULL, R_NEUT, R_BEAR = "BULL", "NEUTRAL", "BEAR"
ALL = (R_BULL, R_NEUT, R_BEAR)


def _S(id_, family, horizon, entry, exit_, regimes, status, note=""):
    return {"id": id_, "family": family, "horizon": horizon, "entry": entry, "exit": EXIT[exit_], "exitKey": exit_,
            "regimes": regimes, "status": status, "note": note}


CATALOG = [
    _S("TREND_ALIGN", "Trend", "swing", e_trend_align, "trend", (R_BULL, R_NEUT), "rule", "추세 정렬 — 한국 AI_PRIMARY 의 TREND_ALIGNMENT(−1.02%/포지션)와 같은 계열: 선택 모델이 걸러야 한다"),
    _S("TR_BREAKOUT", "Trend", "swing", e_breakout, "trend", (R_BULL,), "rule"),
    _S("RS_LEADER", "Trend", "swing", e_rs_leader, "mom", (R_BULL,), "rule"),
    _S("VT_TREND", "Trend", "swing", e_vt_trend, "trend", (R_BULL, R_NEUT), "rule"),
    _S("TR_PULLBACK", "Pullback", "swing", e_pullback, "pullbk", (R_BULL, R_NEUT), "rule", "한국 +0.91%/포지션(34건) 로 원장에서 번 매매법"),
    _S("MA_PULLBACK", "Pullback", "swing", e_ma_pullback, "pullbk", (R_BULL,), "partial"),
    _S("SN_RSI2", "Rebound", "snap", e_sn_rsi2, "snap", (R_BULL, R_NEUT), "rule", "미국 +0.70%/포지션 t 2.3 — 원장에서 유의하게 번 유일한 규칙"),
    _S("HA_REV", "Rebound", "snap", e_ha_rev, "snap", (R_BULL, R_NEUT), "rule"),
    _S("BB_LOW", "Rebound", "snap", e_bb_low, "snap", (R_NEUT,), "rule"),
    _S("STOCH_CROSS", "Stochastic", "snap", e_stoch_cross, "stoch", (R_BULL, R_NEUT), "new", "과매도권 %K↗%D"),
    _S("STOCH_OS_EXIT", "Stochastic", "snap", e_stoch_oversold_exit, "stoch", (R_BULL, R_NEUT), "new", "%K 20 상향 이탈"),
    _S("VOL_BREAKOUT", "Volume", "snap", e_vol_breakout, "volume", (R_BULL,), "rule"),
    _S("VOL_REVERT", "Volume", "snap", e_vol_revert, "snap", (R_NEUT, R_BULL), "rule", "VS_REV"),
    _S("SQUEEZE", "Volatility", "swing", e_squeeze, "vol", (R_BULL, R_NEUT), "partial"),
    _S("XS_ARB", "Value", "snap", e_xs_arb, "value", ALL, "rule", "낮은 우선순위 — 롱 다리만"),
    _S("DUAL_MOM", "Momentum", "swing", e_dual_momentum, "mom", (R_BULL,), "new", "종목판 — 섹터 로테이션은 다음 단계"),
    _S("HERD_REBOUND", "Volume", "snap", e_herding_rebound, "volume", (R_BULL, R_NEUT), "new", "거래량 폭증 뒤 2차 파동"),
    _S("OS_DEEP", "Rebound", "snap", e_os_deep, "snap", ALL, "new", "깊은 과매도 반등(추세 조건 없음 · 폭락장)"),
    _S("CAPIT_REV", "Volume", "snap", e_capit_rev, "snap", ALL, "new", "투매일 종가 매수(추세 조건 없음 · 폭락장)"),
    # [V33.619] 고전 기술적 매매법 10종
    _S("ICHIMOKU", "Trend", "swing", e_ichimoku, "trend", (R_BULL, R_NEUT), "new", "이치모쿠 구름대 상단 돌파 · 전환선>기준선 · 얇은 구름"),
    _S("KELTNER", "Volatility", "swing", e_keltner, "vol", (R_BULL, R_NEUT), "new", "켈트너 채널(EMA20+2×ATR10) 상단 돌파"),
    _S("DONCHIAN", "Trend", "swing", e_donchian, "trend", (R_BULL, R_NEUT), "new", "돈치안 55일 고점 돌파(터틀)"),
    _S("MACD_X", "Momentum", "swing", e_macd, "pullbk", ALL, "new", "MACD 0 아래 골든크로스 · 0선 돌파"),
    _S("ENVELOPE", "Rebound", "snap", e_envelope, "snap", ALL, "new", "MA20 −7% 엔벨로프 하단 이탈 뒤 회복"),
    _S("ELDER_RAY", "Pullback", "swing", e_elder_ray, "pullbk", (R_BULL, R_NEUT), "new", "EMA13 상승 중 베어 파워 음수에서 반등"),
    _S("WILLR", "Rebound", "snap", e_williams_r, "snap", ALL, "new", "윌리엄스 %R −80 상향 이탈"),
    _S("CCI_REV", "Rebound", "snap", e_cci, "snap", ALL, "new", "CCI −100 상향 복귀"),
    _S("PSAR", "Trend", "swing", e_psar, "trend", ALL, "new", "파라볼릭 SAR 상승 전환"),
    _S("TRIPLE_SCR", "Pullback", "swing", e_triple_screen, "pullbk", (R_BULL, R_NEUT), "new", "삼중창 — 큰 추세↑ · 눌림 · 어제 고가 돌파"),
    _S("IBS_LOW", "Rebound", "snap", e_ibs_low, "snap", (R_BULL, R_NEUT), "new", "IBS ≤ 0.2 저가 마감 반등(200일선 위)"),
    _S("HI52_NEAR", "Momentum", "swing", e_hi52_near, "mom", (R_BULL, R_NEUT), "new", "52주 고가 97% 진입(George & Hwang 2004)"),
]
# 일봉으로 학습할 수 없는 것 — 도감에는 적되 후보에서 뺀다(분봉 매매법 · 보유 기간 충돌 방지)
BLOCKED = [
    {"id": "SC_VWAP", "family": "DayTrading", "status": "blocked", "why": "분봉 · 한국 실적 관문 막힘 — 마지막에 검토"},
    {"id": "SC_MOMENTUM", "family": "DayTrading", "status": "blocked", "why": "분봉"},
    {"id": "SC_PULLBACK", "family": "DayTrading", "status": "blocked", "why": "분봉 · 한국 막힘"},
]
CLUSTERS = {   # 원칙: 표본이 적은 초기엔 3~4 개 큰 묶음으로 먼저 학습(Phase C)
    "TREND": ["TREND_ALIGN", "TR_BREAKOUT", "RS_LEADER", "VT_TREND", "TR_PULLBACK", "MA_PULLBACK", "DUAL_MOM", "ICHIMOKU", "DONCHIAN", "MACD_X", "ELDER_RAY", "PSAR", "TRIPLE_SCR", "HI52_NEAR"],
    "MEANREV": ["SN_RSI2", "HA_REV", "BB_LOW", "STOCH_CROSS", "STOCH_OS_EXIT", "VOL_REVERT", "XS_ARB", "OS_DEEP", "CAPIT_REV", "ENVELOPE", "WILLR", "CCI_REV", "IBS_LOW"],
    "VOLVOL": ["VOL_BREAKOUT", "SQUEEZE", "HERD_REBOUND", "KELTNER"],
}


def by_id():
    return {s["id"]: s for s in CATALOG}


def signals(P, ids=None):
    """매매법별 신호 표(날짜×종목 bool). P 에 거래량이 없으면 거래량 매매법은 전부 False."""
    P = dict(P)
    P.pop("_ind", None)
    out = {}
    for s in CATALOG:
        if ids and s["id"] not in ids:
            continue
        try:
            out[s["id"]] = s["entry"](P).astype(bool)
        except Exception:  # noqa: BLE001 — 한 매매법의 오류가 도감 전체를 죽이지 않는다(빈 신호로)
            c = P["close"]
            out[s["id"]] = pd.DataFrame(False, index=c.index, columns=c.columns)
    return out


def describe():
    return [{"id": s["id"], "family": s["family"], "horizon": s["horizon"], "status": s["status"], "regimes": list(s["regimes"]),
             "exit": s["exit"], "cluster": next((k for k, v in CLUSTERS.items() if s["id"] in v), None), "note": s["note"]} for s in CATALOG]
