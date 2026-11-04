"""[V33.695] ★국면 전략(regime sleeve)★ — 사용자 10/28 "국면을 장기·중기·단기로 나눠 대응 · 상승·폭등장에서 돈 버는 게 중요 ·
모든 국면에서 거래당 +5% 이상 · 유니버셜하게 대응".

왜 따로 두나: 매매법 표(playbook_sim)는 '그날 뜬 매매법 중 하나' 를 칸 성적으로 고른다. 실험실(scratchpad/lab/r3 e3·c_l1)에서
주도주 보유 같은 강한 전략을 표에 넣어도 OMNI-Q 후보 거름·칸 수축에 묻혀 판정 구간 상승장 거래당 실제 수익이 +1~2% 에 머물렀다.
국면마다 ★전략 묶음 하나(종목 거름 + 청산)★ 를 통째로 고르는 쪽이 국면 차이를 그대로 탄다.

고르는 법(사전 등록 · 실험실 e11·e13·e14 와 같은 식):
  - 후보 = 종목 거름 F(상대강도 상위 · 주도주 급락 · 신고가 · 대형주 · 지수/레버리지/인버스 ETF …) × 청산 6종(10·20·40·60일 · 넓은 손절 · 따라붙는 손절).
  - 거래 = 신호 다음 날(하루 늦은 진입 · 실전과 같다) · 같은 종목 겹침 없음 · 하루 6건 · 60일 상대강도 순.
  - 국면 깨짐 청산(CRASH_EXIT · 기본 끔): 폭락 밖에서 산 거래가 보유 중 단기 폭락을 만나면 다음 날 판다 — 검증 구간 A/B 에서 우열 없음.
  - 분기(63거래일)마다, 국면(5종)마다 ★직전 750거래일에 끝난 거래만★ 으로 평균 실제 수익이 가장 큰 후보를 고른다(표본 ≥ 20 · 평균 ≥ +3% 일 때만 · 아니면 쉰다).
  - 판정 = 같은 고르기를 [60,80%) · [80,100%) 에 그대로 돌린 결과(국면별 거래당 실제 수익). 그 구간 정보는 고르기에 안 쓴다.
"""
import numpy as np
import pandas as pd

WIN, STEP, NMIN, TH = 750, 63, 20, 3.0
CELL_SETS = {"s2": ("SURGE", "BEAR"), "s5": ("SURGE", "BULL", "NEUTRAL", "BEAR", "CRASH")}   # [V33.739] 칸 나누기 두 방식을 매 회차 둘 다 돌려 검증 구간으로 고른다(아래 run)
CELL_REGS = CELL_SETS["s5"]   # [V33.736] 국면 세분화(사용자 11/2) — 5개 국면 전부를 중기 방향(상승·보합·하락)으로 나눠 15칸에서 따로 고른다(칸 표본 < 20 이면 국면 전체로)
SCORE = "lcb"   # [V33.696] 고르기 점수 = 평균 − 표준오차(표본 적은 우연을 덜 탄다)
CRASH_EXIT = False   # 국면 깨짐 청산 — 실험실 A/B(검증 구간만 비교)에서 우열 없음 → 단순한 쪽(끔). 켜면 워커도 cfg.crashExit 로 따른다
CAP_DAY = 6
SEASON_ON = False   # [V33.756] 계절 거름(산타·양도세 1월 반등·중간선거) — 실험실 A/B 로 켤지 정한다
REG5 = ("SURGE", "BULL", "NEUTRAL", "BEAR", "CRASH")
REG_KO = {"SURGE": "폭등", "BULL": "상승", "NEUTRAL": "보합", "BEAR": "하락", "CRASH": "폭락"}
PROFS = {"h10": dict(stop=8, atr=3, hold=10, tpR=None, be=0), "h20": dict(stop=10, atr=3, hold=20, tpR=None, be=0),
         "h40": dict(stop=12, atr=4, hold=40, tpR=None, be=0), "h60": dict(stop=12, atr=4, hold=60, tpR=None, be=0),
         "r60": dict(stop=12, atr=4, hold=60, trail=20, trailAct=10, tpR=None, be=0), "h60w": dict(stop=20, atr=6, hold=60, tpR=None, be=0),
         # [V33.736] ★단타★(사용자 11/2 "국면 전략에 단타도") — 2·3·5일 보유 · 좁은 손절. 같은 고르기·같은 관문(거래당 +5%)을 통과해야만 쓰인다
         "d2": dict(stop=4, atr=2, hold=2, tpR=None, be=0), "d3": dict(stop=5, atr=2, hold=3, tpR=None, be=0), "d5": dict(stop=6, atr=2.5, hold=5, tpR=None, be=0)}
ETFS = {"kr": {"lev": "122630.KS", "idx": "069500.KS", "inv": "114800.KS", "inv2": "252670.KS"},
        "us": {"lev": "TQQQ", "idx": "SPY", "inv": "SH", "inv2": "SQQQ"}}
FAM_KO = {"rs60t5": "60일 상대강도 상위 5% · 20일선 위", "rs120t5": "120일 상대강도 상위 5% · 50일선 위", "rs20t5": "20일 상대강도 상위 5%",
          "rs250t5": "1년 상대강도 상위 5% · 50일선 위", "rs60t10dip": "60일 강세 상위 10% 의 20일선 눌림(50일선 위)",
          "lead_fall10": "120일 주도주(상위 20%) 10일 −10% 급락", "lead_fall10_up": "주도주 10일 −10% 급락 뒤 첫 양봉",
          "mega_rs": "대형주(거래대금 상위 10%) 중 60일 강세", "mega_fall": "대형주 10일 −8% 급락", "mega_fall_up": "대형주 급락 뒤 첫 양봉",
          "newhi250": "52주 신고가 근처 · 60일 강세", "newhi60_mega": "대형주 60일 신고가", "rsi_lo_lead": "1년 주도주 RSI 과매도(200일선 위)",
          "lowvol_lead": "저변동 주도주(120일 강세 · 50일선 위)", "above200_lo20": "200일선 위 20일 저점 근처 강세주", "crash_quality": "200일선 위 종목의 5일 −7% 뒤 첫 양봉",
          "gap_rev": "[단타] 3% 넘게 갭 하락 뒤 시가보다 높게 마감(50일선 위)", "os3_up": "[단타] 3일 연속 하락 · 5일 −6% 뒤 첫 양봉(200일선 위)",
          "vol_brk20": "[단타] 거래량 2배 · 20일 고점 돌파", "st_rev": "[단타] 5일 낙폭 하위 5% 강세주(60일 상위 30%) 반등 양봉",
          "santa_lead": "[계절] 연말 랠리(12/15~1/5) · 60일 주도주 50일선 위", "santa_mega": "[계절] 연말 랠리 · 대형주 20일선 위",
          "jan_rebound": "[계절] 12월 양도세 매도로 20일 낙폭 큰 중소형주 첫 양봉(1월 반등)", "midterm_lead": "[계절] 미 중간선거 해 10월~이듬해 3월 · 60일 주도주",
          "midterm_mega": "[계절] 미 중간선거 해 10월~3월 · 대형주 50일선 위", "midterm_dip": "[계절] 미 중간선거 해 10월~3월 · 강세주 10일 −8% 뒤 첫 양봉",
          "sec_lead": "[업종] 20일 강한 업종(상위 25%) 안 60일 주도주 · 50일선 위", "sec_lead_dip": "[업종] 강한 업종 안 강세주의 20일선 눌림(50일선 위)"}
for _k, _v in {"lev": "레버리지 지수 ETF", "idx": "지수 ETF", "inv": "인버스 ETF", "inv2": "인버스 2배 ETF"}.items():
    FAM_KO["etf_" + _k] = _v
    FAM_KO["etf_" + _k + "_up1"] = _v + " · 양봉 날"
    FAM_KO["etf_" + _k + "_dn5"] = _v + " · 5일 −4% 뒤"
PROF_KO = {"d2": "단타 2일(손절 4%)", "d3": "단타 3일(손절 5%)", "d5": "단타 5일(손절 6%)", "h10": "10일 보유", "h20": "20일 보유", "h40": "40일 보유", "h60": "60일 보유", "r60": "따라붙는 손절(고점 −20%) · 60일", "h60w": "넓은 손절(20%) · 60일"}


def families(P, mk, L3, M3, S3, st):
    C, V = P["close"].values, P["volume"].values
    T, N = C.shape
    rsi = st[0]
    Cd, Vd = pd.DataFrame(C), pd.DataFrame(V)
    ma20 = Cd.rolling(20, min_periods=15).mean().values
    ma50 = Cd.rolling(50, min_periods=40).mean().values
    ma200 = Cd.rolling(200, min_periods=150).mean().values
    rk = lambda n: (Cd / Cd.shift(n) - 1).rank(axis=1, pct=True).values
    r20r, r60r, r120r, r250r = rk(20), rk(60), rk(120), rk(250)
    r5, r10 = (Cd / Cd.shift(5) - 1).values, (Cd / Cd.shift(10) - 1).values
    dvr = (Cd * Vd).rolling(60, min_periods=40).mean().rank(axis=1, pct=True).values
    hi250 = Cd.rolling(250, min_periods=200).max().values
    hi60 = Cd.rolling(60, min_periods=40).max().values
    lo20 = Cd.rolling(20, min_periods=15).min().values
    vol20 = pd.DataFrame(np.log(C)).diff().rolling(20).std().rank(axis=1, pct=True).values
    up1 = np.vstack([np.full((1, N), False), C[1:] > C[:-1]])
    O = P["open"].values
    dn1 = np.vstack([np.full((1, N), False), C[1:] < C[:-1]])
    dn3 = dn1 & np.vstack([np.full((1, N), False), dn1[:-1]]) & np.vstack([np.full((2, N), False), dn1[:-2]])
    vma20 = Vd.rolling(20, min_periods=15).mean().shift(1).values
    hi20p = Cd.rolling(20, min_periods=15).max().shift(1).values
    gap = np.vstack([np.full((1, N), np.nan), O[1:] / C[:-1] - 1])
    r5r = (Cd / Cd.shift(5) - 1).rank(axis=1, pct=True).values
    with np.errstate(invalid="ignore"):
        F = {"rs60t5": (r60r >= .95) & (C > ma20), "rs120t5": (r120r >= .95) & (C > ma50), "rs20t5": r20r >= .95, "rs250t5": (r250r >= .95) & (C > ma50),
             "rs60t10dip": (r60r >= .90) & (C < ma20) & (C > ma50), "lead_fall10": (r120r >= .8) & (r10 <= -.10), "lead_fall10_up": (r120r >= .8) & (r10 <= -.10) & up1,
             "mega_rs": (dvr >= .9) & (r60r >= .7) & (C > ma20), "mega_fall": (dvr >= .9) & (r10 <= -.08), "mega_fall_up": (dvr >= .9) & (r10 <= -.08) & up1,
             "newhi250": (C >= hi250 * .995) & (r60r >= .7), "newhi60_mega": (C >= hi60 * .995) & (dvr >= .8),
             "rsi_lo_lead": (r250r >= .8) & (rsi < 30) & (C > ma200), "lowvol_lead": (vol20 <= .3) & (r120r >= .8) & (C > ma50),
             "above200_lo20": (C > ma200) & (C <= lo20 * 1.01) & (r120r >= .6), "crash_quality": (C > ma200) & (r5 <= -.07) & up1,
             # [V33.736] 단타 거름
             "gap_rev": (gap <= -.03) & (C > O) & (C > ma50), "os3_up": np.vstack([np.full((1, N), False), dn3[:-1]]) & up1 & (r5 <= -.06) & (C > ma200),
             "vol_brk20": (V > 2 * vma20) & (C > hi20p) & (C > ma50), "st_rev": (r5r <= .05) & (r60r >= .7) & up1}
    # [V33.740] ★업종(분야)별 조절★(사용자 11/2 "기술주·금융주 같은 분야별 조절을 국면 전략에도") — OMNI-Q 가 만든 날짜별 섹터 배정(과거 250일 상관)과
    #   섹터 20일 강도 순위로 '지금 강한 업종 안의 주도주' 거름 2종을 후보에 더한다. 같은 고르기·같은 관문(검증 구간)으로만 쓰인다.
    try:
        import sys as _sys
        OQ = _sys.modules.get("omni_q")
        SI = OQ.SECTOR_IDX.get(mk) if OQ is not None and hasattr(OQ, "SECTOR_IDX") else None
        if SI is not None:
            ti_ = pd.Index(SI["index"]).get_indexer(P["close"].index)
            cj_ = pd.Index(SI["cols"]).get_indexer([str(c) for c in P["close"].columns])
            idx_ = SI["idx"][np.clip(ti_, 0, None)][:, np.clip(cj_, 0, None)].astype(int)
            sr_ = SI["srank"][np.clip(ti_, 0, None)]
            secr = np.take_along_axis(sr_, np.clip(idx_, 0, None), axis=1).astype(float)
            secr[(idx_ < 0) | (ti_[:, None] < 0) | (cj_[None, :] < 0)] = np.nan
            with np.errstate(invalid="ignore"):
                F["sec_lead"] = (secr >= .75) & (r60r >= .8) & (C > ma50)
                F["sec_lead_dip"] = (secr >= .75) & (r60r >= .7) & (C < ma20) & (C > ma50)
    except Exception:  # noqa: BLE001
        pass
    # [V33.753] ★계절성★(사용자 11/4 "중간선거 · 크리스마스 랠리 같은 것도 매매법 AI 가 학습하게") — 날짜만으로 아는 달력 창(미래 정보 없음).
    #   같은 고르기(직전 3년 끝난 거래 · 평균−표준오차)·같은 관문(국면별 워크포워드 두 구간 ≥ +5%)으로만 쓰인다 — 창이 맞아도 성적이 없으면 안 뽑힌다.
    SW = season_masks(P["close"].index, T)
    if SEASON_ON:
      with np.errstate(invalid="ignore"):
          lead = (r60r >= .8) & (C > ma50)
          F["santa_lead"] = SW["santa"][:, None] & lead
          F["santa_mega"] = SW["santa"][:, None] & (dvr >= .8) & (C > ma20)
          F["jan_rebound"] = SW["taxsell"][:, None] & (dvr <= .6) & (r20r <= .15) & (C > ma200 * .8) & up1
          F["midterm_lead"] = SW["midterm"][:, None] & lead
          F["midterm_mega"] = SW["midterm"][:, None] & (dvr >= .9) & (r60r >= .5) & (C > ma50)
          F["midterm_dip"] = SW["midterm"][:, None] & (r120r >= .7) & (r10 <= -.08) & up1
    cols = list(P["close"].columns)
    for k_, s_ in ETFS.get(mk, {}).items():
        m = np.zeros((T, N), bool)
        if s_ in cols:
            m[:, cols.index(s_)] = True
        F["etf_" + k_] = m
        F["etf_" + k_ + "_up1"] = m & up1
        F["etf_" + k_ + "_dn5"] = m & (r5 <= -.04)
    return F, r60r


# [V33.756] ★한국 국면은 코스피 지수로★(사용자 11/4 "한국장 실전 투입 가능할 때까지 전략·수식 수정") — 실험실 krlab(야후 일봉 443종 2003~ · 변형 128종 동시):
#   국면 정의 4종(등가중 · 문턱 3%/7% · 코스피 ^KS11 · 거래대금 상위 30%) × 창 2 × 점수 2 × 칸 2 × 계절 2 × 긴 보유 2 를 ★검증 구간만★ 으로 비교 —
#   요인별 평균(검증 거래 가중) 코스피 5.11% vs 등가중 2.26% · 상위 10개 전부 코스피. 등가중 지수는 소형주 잡음으로 폭락·폭등이 너무 자주 켜졌다.
#   나머지 손잡이(창 750 · 점수 lcb1 · 계절 끔 · 긴 보유 끔)는 지금 값이 검증에서 가장 좋거나 같았다 → 바꾸는 것은 국면 지수 하나뿐(사전 규칙).
#   판정 구간(한 번만 봄): 상승 +9.21%(n247) 실전 · 폭락 +3.07%(n204) 시험 · 보합 +5.63% · 폭등 +2.58% · 하락 −2.47%(종전 −1.51/+7.11/+0.17/+1.64/+0.38).
#   코스피 지수가 없으면 KODEX 200(069500.KS) → 그것도 없으면 종전 등가중(regSrc 로 알린다).
REG_INDEX = {"kr": "^KS11"}
KR_IDX_ETF = "069500.KS"


def fetch_index_close(sym, index, log=print):
    """야후 일봉 종가(한국 시각 날짜 키) → index 에 맞춘 Series(없는 날 NaN). 실패하면 None."""
    try:
        import datetime
        import time as _t
        import requests
        r = requests.get("https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=946684800&period2=%d&interval=1d" % (sym, int(_t.time())),
                         headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        j = r.json()["chart"]["result"][0]
        d = [int((datetime.datetime.utcfromtimestamp(x) + datetime.timedelta(hours=9)).strftime("%Y%m%d")) for x in j["timestamp"]]
        s = pd.Series(j["indicators"]["quote"][0]["close"], index=d, dtype=float).groupby(level=0).last()
        out = s.reindex([int(x) for x in index])
        out.index = index
        return out if out.notna().sum() > 500 else None
    except Exception as e:  # noqa: BLE001
        log("   ⚠️ [국면전략] 지수 %s 못 받음 %s" % (sym, e))
        return None


def regime_from_returns(r, th1=0.025, th5=0.06):
    """playbook_sim._regime 과 같은 식 — 지수 하루 수익률 r 로 5국면 + 중기 칸(UP·FLAT·DOWN) + 시간외 덧붙이기용 꼬리."""
    r = pd.Series(np.asarray(r, float)).fillna(0)
    idx = (1 + r).cumprod()
    m200, m50 = idx.rolling(200, min_periods=120).mean(), idx.rolling(50, min_periods=40).mean()
    up = m50 > m50.shift(10)
    base = np.where((idx > m200) & up, "BULL", np.where((idx < m200) & ~up, "BEAR", "NEUTRAL"))
    r5 = (1 + r).rolling(5).apply(np.prod, raw=True) - 1
    cr1 = (r <= -th1) | (r5 <= -th5)
    su1 = (r >= th1) | (r5 >= th5)
    crash = cr1.astype(float).rolling(3, min_periods=1).max() > 0
    surge = su1.astype(float).rolling(3, min_periods=1).max() > 0
    reg = np.where(crash.values, "CRASH", np.where(surge.values, "SURGE", base))
    M = np.where((idx > m50) & up, "UP", np.where((idx < m50) & ~up, "DOWN", "FLAT"))
    tail = {"r": [round(float(x), 5) for x in r.values[-4:]], "cr": [bool(x) for x in cr1.values[-2:]], "su": [bool(x) for x in su1.values[-2:]],
            "base": str(base[-1]), "th1": th1, "th5": th5}
    return np.asarray(reg).astype(str), np.asarray(M).astype(str), tail


def index_returns(P, mk, log=print):
    """국면 지수 하루 수익률과 출처 — (r, src). 한국 = 코스피 → KODEX 200 → 등가중."""
    cl = P["close"]
    ew = cl.pct_change(fill_method=None).mean(axis=1)
    sym = REG_INDEX.get(mk)
    if sym:
        s = fetch_index_close(sym, cl.index, log)
        if s is not None:
            return s.ffill().pct_change().values, "코스피 지수(" + sym + ")"
        if mk == "kr" and KR_IDX_ETF in cl.columns and cl[KR_IDX_ETF].notna().sum() > 500:
            return cl[KR_IDX_ETF].ffill().pct_change().values, "KODEX 200(" + KR_IDX_ETF + ")"
    return ew.values, "등가중 유니버스"


MIDTERM_YEARS = tuple(range(2002, 2100, 4))   # 미국 중간선거 해(2002 · 2006 · … · 2026)


def season_masks(index, T):
    """날짜(YYYYMMDD) → 달력 창 3종(bool 배열).
    santa   = 12/15 ~ 1/5  (연말 랠리 — 미국 '산타 랠리' 와 한국 연말 배당·윈도드레싱)
    taxsell = 12/1 ~ 12/27 (한국 대주주 양도세 회피 매도가 몰리는 12월 — 낙폭 큰 중소형주를 사서 1월 반등을 노린다)
    midterm = 중간선거 해 10/1 ~ 이듬해 3/31 (선거 전후 불확실성 해소 랠리 · 대통령 임기 주기 3년차 강세)"""
    d = np.asarray([int(x) for x in index])[:T]
    y, md = d // 10000, d % 10000
    santa = (md >= 1215) | (md <= 105)
    taxsell = (md >= 1201) & (md <= 1227)
    my = np.isin(y, MIDTERM_YEARS)
    midterm = (my & (md >= 1001)) | (np.isin(y - 1, MIDTERM_YEARS) & (md <= 331))
    return {"santa": santa, "taxsell": taxsell, "midterm": midterm}


def _trades(S, ex, xo, C, r60r, mcum, cost, S3, crash_start):
    T, N = C.shape
    S = np.vstack([np.zeros((1, N), bool), S[:-1]]) & np.isfinite(ex)   # 하루 늦은 진입
    ti, jj = np.nonzero(S)
    if not len(ti):
        return None
    o = np.lexsort((-np.nan_to_num(r60r[ti, jj]), ti))
    ti, jj = ti[o], jj[o]
    busy, keep, dayn = {}, [], {}
    for a, b in zip(ti, jj):
        if busy.get(b, -1) >= a or dayn.get(a, 0) >= CAP_DAY:
            continue
        keep.append((a, b)); busy[b] = xo[a, b]; dayn[a] = dayn.get(a, 0) + 1
    ti = np.array([k[0] for k in keep]); jj = np.array([k[1] for k in keep]); x = xo[ti, jj].astype(int).copy()
    raw = ex[ti, jj] + (mcum[np.minimum(x + 1, T)] / mcum[ti + 1] - 1) * 100 + cost
    for n_ in (range(len(ti)) if CRASH_EXIT else ()):   # 국면 깨짐 청산
        t0 = ti[n_]
        if S3[t0] == "CRASH":
            continue
        ks = np.nonzero(crash_start[t0 + 1:x[n_] + 1])[0]
        if len(ks):
            k2 = min(t0 + 1 + ks[0] + 1, T - 1)
            pe, px = C[t0, jj[n_]], C[k2, jj[n_]]
            if pe > 0 and px > 0:
                raw[n_] = (px / pe - 1) * 100 - cost
                x[n_] = k2
    return ti, raw, x


def pick_at(TR, rg, q, cell=None):
    """q 날 직전 WIN 거래일에 ★끝난★ 거래만으로 국면 rg(· 중기 칸 cell)의 최선 — (키, 평균, 표본) · 문턱 미달이면 None.
    점수 = SCORE(lcb: 평균 − 표준오차) · 평균 ≥ TH 인 후보만."""
    best, bs, bm, bn = None, -1e9, None, 0
    for k, (ti, rr, x, rg_, m3_) in TR.items():
        m = (rg_ == rg) & (ti >= q - WIN) & (x < q)
        if cell is not None:
            m &= (m3_ == cell)
        n = int(m.sum())
        if n < NMIN:
            continue
        v = rr[m]
        mu = float(v.mean())
        if mu < TH:
            continue
        sc = mu - float(v.std(ddof=1)) / np.sqrt(n) if SCORE == "lcb" else mu
        if sc > bs:
            best, bs, bm, bn = k, sc, mu, n
    if best is None:
        return None
    return best, round(bm, 3), bn


def pick_cell(TR, rg, q, cell):
    """칸 국면이면 칸에서 먼저, 칸 표본이 모자라면 국면 전체."""
    if rg in CELL_REGS:
        p = pick_at(TR, rg, q, cell)
        if p:
            return p, cell
    return pick_at(TR, rg, q), None


def walk(TR, a0, b0):
    res = {r: [] for r in REG5}
    for q in range(a0, b0, STEP):
        for rg in REG5:
            for cl in (("UP", "FLAT", "DOWN") if rg in CELL_REGS else (None,)):
                p, used = pick_cell(TR, rg, q, cl) if cl else (pick_at(TR, rg, q), None)
                if not p:
                    continue
                ti, rr, x, rg_, m3_ = TR[p[0]]
                m = (rg_ == rg) & (ti >= q) & (ti < min(q + STEP, b0))
                if cl is not None:
                    m &= (m3_ == cl)
                res[rg] += list(rr[m])
    return {r: ({"n": len(v), "mean": round(float(np.mean(v)), 3), "win": round(float(np.mean(np.array(v) > 0) * 100), 1)} if v else {"n": 0, "mean": None, "win": None}) for r, v in res.items()}


def run(P, mk, PB, log=print):
    """→ 업로드할 sleeve 딕셔너리(또는 None). PB = playbook_sim 모듈(_sim_profile · _regime · regime3 · _daily_state · COST_RT 재사용)."""
    C = P["close"].values
    T, N = C.shape
    if T < 1100:
        return None
    O, H, L = P["open"].values, P["high"].values, P["low"].values
    reg5, mret = PB._regime(P["close"])
    reg5 = np.asarray(reg5).astype(str)
    mcum = np.concatenate([[1.0], np.cumprod(1 + np.nan_to_num(np.asarray(mret, dtype=float)))])
    L3, M3, S3, _ = PB.regime3(P["close"])
    S3 = np.asarray(S3).astype(str)
    M3s = np.asarray(M3).astype(str)
    # [V33.756] 국면·중기 칸은 국면 지수로(한국 = 코스피) — 거래 수익(mcum)은 종전 그대로
    rix, reg_src = index_returns(P, mk, log)
    ext_tail = None
    if reg_src != "등가중 유니버스":
        reg5, M3s, ext_tail = regime_from_returns(rix)
    log("   · [국면전략] %s 국면 지수 %s" % (mk, reg_src))
    crash_start = (S3 == "CRASH") & np.concatenate([[False], S3[:-1] != "CRASH"])
    st = PB._daily_state(P, ())
    atr = st[4]
    cost = PB.COST_RT[mk]
    F, r60r = families(P, mk, L3, M3, S3, st)
    TR = {}
    for pn, pr in PROFS.items():
        ex, xo = PB._sim_profile(O, H, L, C, atr, mcum, pr, cost)
        for fn, S in F.items():
            r = _trades(S, ex, xo, C, r60r, mcum, cost, S3, crash_start)
            if r is not None and len(r[0]) >= 10:
                TR[(fn, pn)] = (r[0], r[1], r[2], reg5[r[0]], M3s[r[0]])
    c1, c2 = int(T * .6), int(T * .8)
    # [V33.739] ★칸 나누기 방식은 검증 구간으로 고른다★ — s2(폭등·하락만 중기 방향으로) vs s5(5국면 전부 · 15칸).
    #   V33.736 에서 15칸을 켰더니 판정 구간 평균이 미 7.99→7.02 · 한 4.68→3.69 로 나빠졌다(표본이 칸마다 줄어 우연에 맞춘 듯).
    #   원칙대로 판정 구간은 고르기에 안 쓴다 — 검증 구간 거래 가중 평균이 큰 쪽(같으면 단순한 s2)을 쓴다.
    global CELL_REGS
    alt = {}
    for nm_, cs_ in CELL_SETS.items():
        CELL_REGS = cs_
        v_, h_ = walk(TR, c1, c2), walk(TR, c2, T)
        nn = sum(x["n"] for x in v_.values())
        alt[nm_] = (v_, h_, (sum((x["mean"] or 0) * x["n"] for x in v_.values()) / nn) if nn else -99, nn)
    pick_cs = max(alt, key=lambda k: (round(alt[k][2], 3), k == "s2"))
    CELL_REGS = CELL_SETS[pick_cs]
    wfV, wfH = alt[pick_cs][0], alt[pick_cs][1]
    log("   · [국면전략] %s 칸 방식 — %s · 검증 구간 거래당 s2 %+.2f%%(n%d) vs s5 %+.2f%%(n%d) → %s" % (mk, "검증으로 선택", alt["s2"][2], alt["s2"][3], alt["s5"][2], alt["s5"][3], pick_cs))
    q = T - 1
    by = {}
    m_now = str(M3s[-1])
    for rg in REG5:
        p, used = pick_cell(TR, rg, q, m_now)
        by[rg] = ({"fam": p[0][0], "prof": p[0][1], "mean": p[1], "n": p[2], "famKo": FAM_KO.get(p[0][0], p[0][0]), "profKo": PROF_KO.get(p[0][1], p[0][1]),
                   "cell": used} if p else None)   # cell = 이 국면을 오늘 중기 방향 칸으로 골랐으면 그 칸
    rg_now = str(reg5[-1])
    # [V33.756] 국면마다 오늘 종목·청산(워커가 시간외로 국면을 다시 정하면 그 국면 것으로 바꿔 쓴다)
    by_syms = {}
    for rg in REG5:
        b_ = by.get(rg)
        if not b_:
            continue
        sig_ = F[b_["fam"]][-1]
        jj_ = np.nonzero(sig_ & np.isfinite(C[-1]))[0]
        jj_ = jj_[np.argsort(-np.nan_to_num(r60r[-1, jj_]))][:CAP_DAY]
        by_syms[rg] = [str(P["close"].columns[j]) for j in jj_]
        b_["pr"] = {k: v for k, v in PROFS[b_["prof"]].items() if v is not None}
    # 시간외 바구니 = 60일 거래대금 상위 30종(비중 = 거래대금 몫) — 지수 대용
    basket = {}
    try:
        dv_ = (P["close"] * P["volume"]).iloc[-60:].mean()
        dv_ = dv_[[c for c in dv_.index if not str(c).startswith(("069500", "122630", "114800", "252670"))]].dropna().sort_values(ascending=False)[:30]
        basket = {str(k): round(float(v / dv_.sum()), 4) for k, v in dv_.items()}
    except Exception:  # noqa: BLE001
        basket = {}
    cur = by.get(rg_now)
    syms = []
    if cur:
        sig = F[cur["fam"]][-1]   # 오늘 신호(워커는 다음 거래일에 산다 — 시뮬의 하루 늦은 진입과 같다)
        jj = np.nonzero(sig & np.isfinite(C[-1]))[0]
        jj = jj[np.argsort(-np.nan_to_num(r60r[-1, jj]))][:CAP_DAY]
        syms = [str(P["close"].columns[j]) for j in jj]
    # 실전 자격(사전 등록): 지금 국면의 [60,80%) · [80,100%) 워크포워드 둘 다 거래당 ≥ +5% · 각 표본 ≥ 20
    ok = bool(cur) and all((w.get(rg_now) or {}).get("n", 0) >= NMIN and ((w.get(rg_now) or {}).get("mean") or -99) >= 5.0 for w in (wfV, wfH))
    pr = PROFS[cur["prof"]] if cur else None
    out = {"reg": rg_now, "regKo": REG_KO.get(rg_now, rg_now), "cur": cur, "syms": syms, "live": ok, "by": by, "wf": {"V": wfV, "H": wfH},
           "prof": ({k: v for k, v in pr.items() if v is not None} if pr else None), "cfg": {"win": WIN, "step": STEP, "nmin": NMIN, "th": TH, "capDay": CAP_DAY, "target": 5.0, "crashExit": CRASH_EXIT, "score": SCORE, "cellRegs": list(CELL_REGS), "cellSet": pick_cs, "cellCmp": {k: {"v": round(v[2], 3), "n": v[3]} for k, v in alt.items()}}, "mNow": m_now,
           "cut": [str(P["close"].index[c1]), str(P["close"].index[c2])],
           "regSrc": reg_src, "bySyms": by_syms, "ext": (dict(ext_tail, basket=basket) if ext_tail else None)}
    log("   · [국면전략] %s 지금 %s → %s · 오늘 %d종 · 실전 %s · 워크포워드 판정 %s" % (
        mk, REG_KO.get(rg_now), (cur["famKo"] + " · " + cur["profKo"] + " (직전 3년 %+.2f%% n%d)" % (cur["mean"], cur["n"])) if cur else "쉼(근거 부족)", len(syms),
        "켬" if ok else "관측", " · ".join("%s %s(%d)" % (REG_KO[r], ("%+.2f%%" % v["mean"]) if v["mean"] is not None else "—", v["n"]) for r, v in wfH.items())))
    return out
