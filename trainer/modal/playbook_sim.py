"""[V33.607·608] 매매법 모의 시뮬레이터(Playbook-Sim) — '확률 높은 종목을 먼저 뽑고 · 그 종목에 맞는 매매법으로 산다'.

사용자 설계(10/15):
  ① 지금 확률 높은 종목(OMNI-Q 상위 20%)이 후보가 된다.
  ② 그 종목에서 ★지금 진입 신호가 뜬 매매법들★(일봉 도감 17종 — 스토캐스틱·RSI2·눌림·돌파·거래량… / 5분 단타 5종 — 시가범위 돌파·
     장중 눌림 반등·5분 스토캐스틱·5분 모멘텀·VWAP 회복) 중에서
  ③ 그 종목의 ★지금 상황과 닮은 과거★(상황 칸)에서 그 매매법이 낸 모의 성적(성공확률·평균 순수익)이 가장 좋은 것으로 산다.
  ④ 매도는 그 매매법의 규칙(손절 · 익절 · 본전 이동 · 최대 보유 · 단타는 장 끝).
  모의 시뮬은 GitHub Actions(무료)가 매 회차 과거 전 종목에 모든 매매법을 적용해 다시 만들고, 워커는 매 분 신호 판정 + ★표 조회★ 만 한다.

'닮은 과거' = 상황 칸(situation key) — 워커가 같은 칸을 실시간으로 계산한다(경계는 check-playbook 이 대조).
  일봉 칸  국면(5) · RSI14(4) · MA20 거리(4) · 5일 수익(3) · 거래량 배수(3) · FOMC/CPI ±2거래일(2)
  5분 칸   국면(5) · 장중 등락(5) · 장 시작 후 시간대(4) · 일봉 추세(MA20 위/아래)(2)
  칸에 표본이 적으면 넓은 칸(조건을 뺀 칸) 값 쪽으로 당긴다(베이즈 수축 k=40).

1분봉은 과거 기록이 저장돼 있지 않아 단타 시뮬은 5분봉으로 한다(워커는 1분봉을 5분으로 묶어 같은 조건을 본다).

★미리 고정(데이터 보기 전 · 바꾸려면 사용자 결정)★
  체결     신호가 뜬 봉의 종가에 산다(워커는 신호가 뜬 그 분의 현재가) · 같은 봉에서 손절·익절이 둘 다 닿으면 손절(보수적)
  비용     왕복 미 0.10% · 한 0.30% 차감 · 일봉은 시장 동일가중 대비 초과(국면 효과를 빼고 매매법만 잰다)
  검증     시간순 앞 70% 로 표 → 뒤 30% 에서 '후보마다 뜬 매매법 중 표가 고른 것' 의 실제 결과
  관문     그 결과 평균 > 0 · t ≥ 2 · '뜬 매매법 아무거나' 평균보다 높다 · 표본 ≥ 30 → 그 시장·그 봉(일봉/5분)만 실전
  선택     뜬 매매법 중 (칸의 수축 평균 > 0 · 수축 성공확률 ≥ 50%) 이고 평균이 가장 큰 것 — 없으면 안 산다
"""
import json
import math
import os
import time

import numpy as np
import pandas as pd

K_SHRINK = 40.0
TRAIN_FRAC = 0.70
COST_RT = {"us": 0.10, "kr": 0.30}
PASS_T = 2.0

# ── 매매법 ─────────────────────────────────────────────────────────
# 일봉: 도감(strategy_catalog) 17종 그대로 — 진입 = 그 매매법의 신호 · 매도 = 그 매매법의 청산 프로필.
#   stop: 최대 손절 % · atr: ATR 손절 배수(작은 쪽) · be: 이 R 에 닿으면 손절을 본전으로 · hold: 최대 보유 거래일 · tpR: 전량 익절 R(None=없음)
import strategy_catalog as CAT  # noqa: E402
import playbook_params as PP  # noqa: E402

TPR = {"trend": None, "pullbk": 2.0, "snap": 1.5, "stoch": 1.5, "volume": 2.0, "vol": 2.5, "value": 1.5, "mom": None}
DAILY_PB = {s_["id"]: {"stop": s_["exit"]["stop"], "atr": s_["exit"]["atr"], "be": s_["exit"]["tp1R"], "hold": s_["exit"]["hold"],
                       "tpR": TPR[s_["exitKey"]], "family": s_["family"], "label": s_["note"] or s_["family"]} for s_ in CAT.CATALOG}
# [V33.618] ★스냅(반등·스토캐스틱·거래량 단기) 매매법 = 워커 실전 스냅 청산(snapRules)★ — 사용자 10/15 "규칙으로 돌렸을 때 RSI2 반등이 가장 많이 벌었는데 왜?"
#   원인: 시뮬이 스냅 매매법에 '손절 4% · 1.5R 익절 · 8일 보유' 같은 일반 프로필을 썼다. 실전은 평균회귀 청산이다 —
#   종가 > MA5 또는 RSI2 ≥ 65 이면 그날 종가에 판다 · +5% 익절 · +2% 에 본전 이동 · 5거래일 지나도 손실이면 판다 · 손절 min(3.5%, ATR×1.5).
#   반등을 먹고 바로 나오는 이 청산이 RSI2 반등의 실력이다 — 일반 프로필로는 반등 뒤 되밀림을 다 맞았다.
SNAP_MR = {"mr": True, "stop": 3.5, "atr": 1.5, "be": 0.0, "tpR": None, "tpPct": 5.0, "bePct": 2.0, "tstop": 5, "rsi2x": 65}
for _id, _p in DAILY_PB.items():
    _h = next(s_["horizon"] for s_ in CAT.CATALOG if s_["id"] == _id)
    if _h == "snap":
        _p.update(SNAP_MR)
        _p["hold"] = max(_p["hold"], 8)
# [V33.671] ★시뮬 = 실전 시점★ — 학습기가 장 마감 뒤 만든 목록·점수·그룹을 워커는 ★다음 거래일★ 에 쓴다.
#   종전 시뮬은 횡단면 3종 신호 · OMNI-Q 후보 · 변동성 그룹을 '그날 값' 으로 써 실전보다 하루 빠른 정보를 봤다(자가 점검 10/25).
#   LAG_FIX=1(기본): 셋 다 하루 늦춘다. PB_LAG_FIX=0 은 비교 실험용.
LAG_FIX = os.environ.get("PB_LAG_FIX", "1") != "0"


def _lag1(a):
    """날짜×종목 bool/정수 배열을 하루 늦춘다(첫날은 거짓/−1)."""
    a = np.asarray(a)
    fill = -1 if a.dtype.kind in "iu" else False
    return np.vstack([np.full((1,) + a.shape[1:], fill, dtype=a.dtype), a[:-1]])


CROSS_PB = ("RS_LEADER", "XS_ARB", "DUAL_MOM")   # 횡단면(전 종목 순위) 조건 — 워커는 학습기가 보낸 '오늘 뜬 종목' 목록을 쓴다
# 5분 단타: 진입 조건(오늘 5분봉) + tpPct/sl % · bars = 최대 5분봉 수(0 = 장 끝까지) · 장 끝에는 무조건 판다
INTRA_PB = {
    "ORB":     {"tpPct": 1.5, "sl": 0.8, "bars": 0,  "label": "시가 범위 돌파 — 첫 30분 고가를 위로 · 장 끝까지"},
    "DIP_REV": {"tpPct": 1.0, "sl": 0.7, "bars": 12, "label": "장중 눌림 반등 — 당일 고점 −1% 아래에서 반등 봉 · 60분"},
    "STOCH5":  {"tpPct": 0.8, "sl": 0.6, "bars": 12, "label": "5분 스토캐스틱 — 과매도(≤25) %K↗%D · 60분"},
    "MOM3":    {"tpPct": 1.0, "sl": 0.6, "bars": 6,  "label": "5분 모멘텀 — 3봉 연속 상승 +0.5% · 30분"},
    "VWAP_RE": {"tpPct": 1.0, "sl": 0.6, "bars": 18, "label": "VWAP 회복 — 아래에서 위로 · 90분"},
    # [V33.619] tpAt = 목표가가 % 가 아니라 가격(pc 전일 종가 · piv 피봇) — 진입 때 정해진다
    "GAP_FILL":  {"tpPct": None, "tpAt": "pc", "sl": 1.0, "bars": 0, "label": "갭 메우기 — 1.5%+ 하락 갭 뒤 첫 봉 고가 회복(첫 1시간) · 전일 종가까지"},
    "PIVOT_BNC": {"tpPct": None, "tpAt": "piv", "sl": 0.7, "bars": 24, "label": "피봇 지지 반등 — 전일 피봇 1차 지지(S1) 닿고 반등 봉 · 피봇까지 · 2시간"},
    # [V33.651] 갭 앤 고 — +2% 이상 상승 갭 · 둘째 5분봉이 첫 봉 고가를 넘으면 산다 · 장 끝까지(손절 1%). lab 5분봉 60일(미국 150종목):
    #   앞 60% +0.51%(t 2.7) · 60~80% +0.15% · 마지막 20% +0.16% — 시험한 단타 12종 중 세 구간 모두 양수인 유일한 것(근거 약함 · 실전은 5분 검증이 정한다).
    "GAP_GO":    {"tpPct": None, "sl": 1.0, "bars": 0, "label": "갭 앤 고 — +2% 상승 갭 · 둘째 5분봉이 첫 봉 고가 돌파 · 장 끝까지"},
}
# [V33.651] ★성적 미달 단타 퇴출(시장별)★ — 일봉과 같은 규칙(앞 60%·60~80% 두 구간 모두 비용 뺀 평균 ≤ 0). lab 5분봉 60일:
#   한국은 왕복 비용 0.30%(거래세)가 5분 신호의 우위보다 커서 전부 음수(새 후보 5종 포함) → 단타 없음. 미국은 갭 메우기·갭 앤 고만 남는다.
# [V33.706] 사용자 10/29 "단타도 학습하게" — 시장별 영구 퇴출을 풀고 ★5분 검증(3구간)이 매 회차 판정★한다.
#   실전 단타는 여전히 5분 검증 통과(_pbPass(st.intra.val))일 때만 산다(워커 pbRoutePick) — 퇴출을 풀어도 검증 없이 사는 일은 없다.
#   5분봉은 매 회차 쌓이므로(워커 R2) 표본이 늘면 비용(한국 왕복 0.30%)을 넘는 단타가 생기는지 계속 잰다.
INTRA_OFF = {"us": (), "kr": ()}
INTRA_MIN_LEFT = 6   # 장 끝까지 5분봉 6개(30분) 넘게 남아야 산다(워커 intraMinToClose 30분과 같다)


# ── 상황 열쇠(워커 PB_KEYS 와 같은 경계 · 한쪽만 바꾸면 갈라진다 — 게이트가 대조) ───────
B_RSI = (30, 50, 70)            # → 0..3
B_GAP20 = (-5, 0, 5)            # % → 0..3
B_RET5 = (-3, 3)                # % → 0..2
B_VR = (0.8, 1.5)               # 배 → 0..2
B_DAYPCT = (-2, -0.5, 0.5, 2)   # % → 0..4
B_TOD = (30, 120, 270)          # 장 시작 후 분 → 0..3
REGIMES = ("BULL", "NEUTRAL", "BEAR", "CRASH", "SURGE")


def _bk(x, edges):
    return np.searchsorted(np.asarray(edges, dtype=float), x, side="right")


def daily_keys(reg, rsi, gap20, ret5, vr, ev):
    """일봉 열쇠 4단(가장 구체적 → 가장 넓은). 각 단은 문자열 배열."""
    r = np.asarray(reg).astype(str)
    a, b, c = _bk(rsi, B_RSI).astype(str), _bk(gap20, B_GAP20).astype(str), _bk(ret5, B_RET5).astype(str)
    d, e = _bk(vr, B_VR).astype(str), np.asarray(ev).astype(int).astype(str)
    k3 = np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(r, "|"), a), "|"), b), "|"), c), "|"), d), np.char.add("|", e))
    k2 = np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(r, "|"), a), "|"), b), "|*")
    k1 = np.char.add(r, "|*")
    return [k3, k2, k1, np.full(len(r), "*")]


def flow_bucket(fr):
    """[V33.710] 수급 과열 백분위 → 0(하위 50%)·1(50~90%)·2(상위 10%) · 값 없으면 'x'(미국·결측). 워커 pbFlowB 와 같다."""
    fr = np.asarray(fr, dtype=float)
    return np.where(np.isnan(fr), "x", np.where(fr > 0.9, "2", np.where(fr > 0.5, "1", "0")))


def deep_key(kfine, grp, fb):
    """[V33.710] ★더 세심한 칸(k4)★ = 세부 칸(국면·RSI·이격·5일·거래량·사건) + 종목 변동성 그룹 + 수급 과열 단계. 워커 pbDeepKey 와 같다.
    표본 적은 k4 칸은 _shrunk_table 이 부모(세부 칸) 값으로 끌어당긴다 — 칸이 비어도 부모가 대신하므로 '고를 것이 없음' 이 늘지 않는다."""
    return np.char.add(np.char.add(np.char.add(np.char.add(np.asarray(kfine).astype(str), "|g"), np.asarray(grp).astype(str)), "|f"), np.asarray(fb).astype(str))


def intra_keys(reg, daypct, tod, up):
    r = np.asarray(reg).astype(str)
    a, b, c = _bk(daypct, B_DAYPCT).astype(str), _bk(tod, B_TOD).astype(str), np.asarray(up).astype(int).astype(str)
    k3 = np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(np.char.add(r, "|"), a), "|"), b), "|"), c)
    k2 = np.char.add(np.char.add(np.char.add(r, "|"), a), "|*")
    k1 = np.char.add(r, "|*")
    return [k3, k2, k1, np.full(len(r), "*")]


# ── 일봉 시뮬(전 종목 × 전 날짜 × 매매법 · 벡터화) ──────────────────────
def _regime(close):
    """strategy_router._regime 과 같은 정의(폭락·폭등 포함)."""
    r = close.pct_change(fill_method=None).mean(axis=1).fillna(0)
    idx = (1 + r).cumprod()
    m200, m50 = idx.rolling(200, min_periods=120).mean(), idx.rolling(50, min_periods=40).mean()
    up = m50 > m50.shift(10)
    reg = np.where((idx > m200) & up, "BULL", np.where((idx < m200) & ~up, "BEAR", "NEUTRAL"))
    r5 = (1 + r).rolling(5).apply(np.prod, raw=True) - 1
    crash = ((r <= -0.025) | (r5 <= -0.06)).astype(float).rolling(3, min_periods=1).max() > 0
    surge = ((r >= 0.025) | (r5 >= 0.06)).astype(float).rolling(3, min_periods=1).max() > 0
    reg = np.where(crash.values, "CRASH", np.where(surge.values, "SURGE", reg))
    return reg, r.values


# [V33.694] ★국면 3단(장기·중기·단기)★ — 사용자 10/28 "국면을 장기·중기·단기로 나눠 대응 · 지금 국면이 전환된 상황".
#   종전 5종(폭등·상승·보합·하락·폭락)은 장기(200일선)와 단기(3일 충격)를 한 칸에 섞어, 한 달 −22% 뒤 +3% 반등 같은 '전환' 을 못 그렸다.
#   같은 등가중 시장 지수(학습기 _regime 과 같은 바탕)로 셋을 따로 낸다:
#     장기 L = 200일선 위 + 200일선 20일 기울기 > 0 → UP · 아래 + 기울기 < 0 → DOWN · 그 밖 → TURN(전환 중)
#     중기 M = 50일선 위 + 50일선 10일 상승 → UP · 아래 + 하락 → DOWN · 그 밖 FLAT
#     단기 S = 3거래일 안 하루 ±2.5% 또는 5일 ±6% → SURGE/CRASH(폭락 우선) · 아니면 5일 ±2% → UP/DOWN · 그 밖 CALM
REG3_KO = {"L": {"UP": "상승", "DOWN": "하락", "TURN": "전환"}, "M": {"UP": "상승", "DOWN": "하락", "FLAT": "보합"},
           "S": {"SURGE": "폭등", "UP": "상승", "CALM": "보합", "DOWN": "하락", "CRASH": "폭락"}}


def regime3(close):
    r = close.pct_change(fill_method=None).mean(axis=1).fillna(0)
    idx = (1 + r).cumprod()
    m200, m50 = idx.rolling(200, min_periods=120).mean(), idx.rolling(50, min_periods=40).mean()
    s200 = m200 / m200.shift(20) - 1
    L = np.where((idx > m200) & (s200 > 0), "UP", np.where((idx < m200) & (s200 < 0), "DOWN", "TURN"))
    up50 = m50 > m50.shift(10)
    M = np.where((idx > m50) & up50, "UP", np.where((idx < m50) & ~up50, "DOWN", "FLAT"))
    r5 = idx / idx.shift(5) - 1
    crash = ((r <= -0.025) | (r5 <= -0.06)).astype(float).rolling(3, min_periods=1).max() > 0
    surge = ((r >= 0.025) | (r5 >= 0.06)).astype(float).rolling(3, min_periods=1).max() > 0
    S = np.where(crash.values, "CRASH", np.where(surge.values, "SURGE", np.where(r5.values >= 0.02, "UP", np.where(r5.values <= -0.02, "DOWN", "CALM"))))
    num = {"vs200": (idx / m200 - 1) * 100, "r60": (idx / idx.shift(60) - 1) * 100, "r20": (idx / idx.shift(20) - 1) * 100, "r5": r5 * 100, "r1": r * 100}
    return L, M, S, num


def regime3_now(close):
    """오늘(마지막 날) 국면 3단 + 전환 문장 — 워커·화면용."""
    L, M, S, num = regime3(close)
    l, m, s_ = str(L[-1]), str(M[-1]), str(S[-1])
    f = lambda k: (round(float(num[k].iloc[-1]), 2) if num[k].iloc[-1] == num[k].iloc[-1] else None)
    turn = None
    if l == "UP" and m == "DOWN":
        turn = "장기 상승 속 중기 조정"
    elif l == "DOWN" and m == "UP":
        turn = "장기 하락 속 중기 반등"
    elif l == "TURN":
        turn = "장기 추세 전환 중"
    if s_ in ("UP", "SURGE") and m == "DOWN":
        turn = (turn + " · " if turn else "") + "단기 반등"
    elif s_ in ("DOWN", "CRASH") and m == "UP":
        turn = (turn + " · " if turn else "") + "단기 되밀림"
    # 단기가 바뀐 날(오늘 단기 ≠ 어제 단기)
    since = 0
    for k in range(len(S) - 1, 0, -1):
        if S[k - 1] != S[-1]:
            break
        since += 1
    return {"L": l, "M": m, "S": s_, "ko": {"L": REG3_KO["L"].get(l, l), "M": REG3_KO["M"].get(m, m), "S": REG3_KO["S"].get(s_, s_)},
            "x": {k: f(k) for k in ("vs200", "r60", "r20", "r5", "r1")}, "turn": turn, "sDays": since + 1}


def _daily_state(P, ev_dates):
    c = P["close"]
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    rsi = (100 - 100 / (1 + up / dn.replace(0, np.nan))).where(dn > 0, 100.0).values
    gap20 = ((c / c.rolling(20).mean() - 1) * 100).values
    ret5 = ((c / c.shift(5) - 1) * 100).values
    v = P.get("volume")
    vr = (v / v.rolling(20).mean()).values if v is not None else np.ones(c.shape)
    pc = c.shift(1)
    tr = np.maximum(P["high"] - P["low"], np.maximum((P["high"] - pc).abs(), (P["low"] - pc).abs()))
    atr = (tr.rolling(14, min_periods=14).mean() / c * 100).values
    # FOMC/CPI ±2 거래일
    dk = np.asarray([int(x) for x in c.index])
    pos = np.searchsorted(dk, np.asarray(sorted(ev_dates)))
    near = np.zeros(len(dk), dtype=bool)
    for p in pos:
        near[max(0, p - 2):min(len(dk), p + 3)] = True
    return rsi, gap20, ret5, vr, atr, near


RC_NAMES = {1: "손절", 2: "본전", 3: "익절", 4: "평균회귀", 5: "기간 손실", 6: "보유 만기"}


# [V33.694] 추세 타기(+R) 청산 — 사용자 10/28 "상승장·폭등장에서 돈 버는 게 중요". 실험실 r3/e4(10년 · 하루 늦은 진입 · OMNI-Q 상위 40%):
#   후보 전체 실제 수익(판정 구간) 한국 상승 +1.48→+2.92% · 폭락 +0.29→+1.79% · 보합 +0.54→+2.54% / 미국 폭등 +3.71→+7.84% · 하락 +2.86→+5.01%.
#   고정 보유·익절로 추세 중간에 내리던 것을 고점 −15% 까지 탄다(진입 뒤 +8% 를 넘긴 뒤부터). 손절(stop·ATR)은 원래 매매법 그대로.
SLEEVE_ON = os.environ.get("PB_SLEEVE", "1") != "0"   # [V33.695] 국면 전략(regime_sleeve) — 실전 자격은 국면별 워크포워드 두 구간 ≥ +5%
LEAD_ON = os.environ.get("PB_LEAD", "0") == "1"   # 실험실 A/B 확인 전엔 꺼 둔다
LEAD_PB = {"LEAD60_HOLD": 60, "LEAD120_HOLD": 60}
RIDE_ON = os.environ.get("PB_RIDE", "0") == "1"   # 실험실 A/B 확인 전엔 꺼 둔다
RIDE_PROF = {"hold": 60, "trail": 15, "trailAct": 8, "tpR": None, "tpPct": None, "be": 0, "bePct": None, "mr": False, "tstop": 0}


def _sim_profile(O, H, L, C, atr, mcum, pr, cost, t0=250, mrx=None, t_max=None, want_rc=False):
    """모든 (날짜 t ≥ t0 · 종목 j) 에서 t 종가에 샀다면 — 그 청산 프로필의 순초과 % (T×N · 시뮬 못 하는 칸 NaN).
    [V33.620] t_max = 이 날짜 전 진입만(조율 속도) · want_rc = 청산 사유 코드(RC_NAMES)도 돌려준다."""
    T, N = C.shape
    hold = pr["hold"]
    out = np.full((T, N), np.nan, dtype=np.float32)
    xo = np.full((T, N), -1, dtype=np.int32)
    rco = np.zeros((T, N), dtype=np.int8) if want_rc else None
    t_end = T - 1 - hold
    if t_max is not None:
        t_end = min(t_end, int(t_max))
    if t_end <= t0:
        return (out, xo, rco) if want_rc else (out, xo)
    ts = np.arange(t0, t_end)
    pe = C[ts]
    stp = np.minimum(pr["stop"], pr["atr"] * atr[ts])
    sl = pe * (1 - stp / 100)
    R = pe * stp / 100
    be_px = pe * (1 + pr["bePct"] / 100) if pr.get("bePct") else pe + pr["be"] * R if pr["be"] else np.full_like(pe, np.inf)
    tp_px = (pe * (1 + pr["tpPct"] / 100) if pr.get("tpPct") else pe + pr["tpR"] * R if pr["tpR"] else np.full_like(pe, np.inf))
    alive = np.isfinite(pe) & np.isfinite(stp) & (pe > 0)
    # [V33.694] 따라붙는 손절(trail) — 고점(진입 뒤 최고가)이 진입가 +trailAct% 를 넘으면 손절선을 고점 × (1 − trail%) 까지 끌어올린다.
    #   사용자 10/28 "상승장·폭등장에서 돈 버는 게 중요" — 고정 보유·익절로 추세 중간에 내리던 것을 추세가 꺾일 때까지 탄다(워커 pbSellRule 같은 식).
    trail, tact = float(pr.get("trail") or 0), float(pr.get("trailAct") or 0)
    peak = pe.copy() if trail > 0 else None
    px = np.full_like(pe, np.nan)
    xk = np.full(pe.shape, hold)
    rc = np.zeros(pe.shape, dtype=np.int8)
    for k in range(1, hold + 1):
        o, h, lo, cl = O[ts + k], H[ts + k], L[ts + k], C[ts + k]
        hit_sl = alive & (lo <= sl)
        px = np.where(hit_sl, np.minimum(np.where(np.isfinite(o), o, sl), sl), px)
        xk = np.where(hit_sl, k, xk)
        rc = np.where(hit_sl, np.where(sl >= pe, 2, 1), rc)
        alive &= ~hit_sl
        hit_tp = alive & (h >= tp_px)
        px = np.where(hit_tp, np.maximum(np.where(np.isfinite(o), o, tp_px), tp_px), px)
        xk = np.where(hit_tp, k, xk)
        rc = np.where(hit_tp, 3, rc)
        alive &= ~hit_tp
        sl = np.where(alive & (h >= be_px), np.maximum(sl, pe), sl)       # 본전으로
        if peak is not None:                                              # [V33.694] 따라붙는 손절 — 다음 봉부터 적용
            peak = np.where(alive, np.fmax(peak, h), peak)
            sl = np.where(alive & (peak >= pe * (1 + tact / 100)), np.maximum(sl, peak * (1 - trail / 100)), sl)
        if pr.get("mr") and mrx is not None:                              # [V33.618] 평균회귀 청산(종가 > MA5 · RSI2 ≥ 65) — 그날 종가
            hit_mr = alive & mrx[ts + k]
            px = np.where(hit_mr, cl, px); xk = np.where(hit_mr, k, xk); rc = np.where(hit_mr, 4, rc); alive &= ~hit_mr
        if pr.get("tstop") and k == pr["tstop"]:                          # [V33.618] N거래일 지나도 손실이면 판다
            hit_ts = alive & (cl < pe)
            px = np.where(hit_ts, cl, px); xk = np.where(hit_ts, k, xk); rc = np.where(hit_ts, 5, rc); alive &= ~hit_ts
        if k == hold:
            px = np.where(alive, cl, px)
            rc = np.where(alive, 6, rc)
    raw = (px / pe - 1) * 100
    mk = (mcum[ts[:, None] + xk + 1] / mcum[ts[:, None] + 1] - 1) * 100
    out[ts] = (raw - mk - cost).astype(np.float32)
    xo[ts] = (ts[:, None] + xk).astype(np.int32)
    if want_rc:
        rco[ts] = rc
        return out, xo, rco
    return out, xo


CAND_QS = (0.80, 0.60, 0.40, 0.0)   # [V33.620] 후보 폭 후보(상위 20·40·60%) — 검증 구간이 고른다 · [V33.621] 0.0 = OMNI-Q 거름 없음(전 종목) — 'OMNI 먼저' 가 유리한지 검증이 판정
VAL_MIN_N = 60                     # [V33.622] 검증 구간에서 규칙·후보 설정을 고를 최소 거래 수
CAND_HEADS = ("5", "20", "avg")   # [V33.622] 후보 순위 머리 — 5일 · 20일 · 평균(검증이 고른다)
CAND_BUDGET_S = 1500               # 후보 비교(머리 3 × 폭 3 + 거름 없음) 시간 상한
# [V33.650 학습기] ★10년 일봉으로 시뮬★ — 종전 strategy_router._panel 기본 760일(3년)이라 판정 구간 [80%,100%) 이 최근 ≈6개월뿐이었다.
#   로컬 10년 비교(같은 시뮬·같은 규칙 후보·거름 없음): 한국 판정 −0.91%(t −2.51) → +0.98%(t 2.99) · 최근 125일 +0.27% → +1.95% /
#   미국 −2.17%(t −6.29) → +0.29%(t 1.03 · 여전히 미통과) · 최근 125일 −0.44% → +0.10%. 표가 국면 여러 번을 보고 배운다.
PB_MAX_DAYS = 2600
# [V33.650 학습기] ★최근 구간 확인(관문 추가)★ — 판정 구간이 길어진 만큼 '옛날엔 벌었는데 요즘은 잃는' 규칙을 거른다:
#   판정 구간 마지막 REC_DAYS 거래일의 고른 거래 평균이 그 조각의 공정 무작위 기준선보다 낮으면 미통과(거래 ≥ REC_MIN_N 일 때).
REC_DAYS = 125
REC_MIN_N = 30
# [V33.660] ★최근 구간은 '확실한 악화'만 막는다★ — 사용자 10/23 "최근 125일 변동이 심해 오히려 나쁜 표본일 수 있다".
#   실측(lab gatelab·gateana · 표본 밖 고른 거래 · 21거래일 간격 25시점 · 다음 125일 실제 초과로 채점):
#   종전 '최근 평균 > 무작위' 는 한국 판정 적중 52%(동전) — 막은 시점의 다음 125일 초과 +0.78% 가 통과 시점 +0.68% 보다 높았다.
#   '초과의 t ≤ −2 일 때만 미달' 은 한국 적중 68%(막은 시점 다음 +0.12% vs 통과 +0.80%) · 미국 96%. 변동성 보정·250일 창은 나아지지 않았다.
#   최근 125일 한국 시장 변동성 연 36%(10년 상위 9%) · 종목 간 흩어짐 상위 3% — 평균 한 점이 크게 출렁이므로 불확실성(t)으로 본다.
REC_T = -2.0
# [V33.650 학습기] ★성능 안 나오는 매매법 퇴출(시장별)★ — 사용자 10/22 "성능 안 나오는 것들 제거".
#   미리 정한 규칙: 10년 일봉 시뮬(비용·시장 평균 뺀 순초과)에서 앞 60% 와 60~80% ★두 구간 모두★ 평균 ≤ 0 이면 퇴출(마지막 20% 판정 구간은 고르기에 안 씀).
#   판정 구간 확인: 퇴출한 것 중 한국 21/24 · 미국 23/25 가 판정 구간에서도 음수. 평균회귀(RSI2·%R·CCI·HA·IBS·스토캐스틱…)는 두 시장 모두 전 구간 음수.
#   전체(고르는 AI 포함) 판정 구간: 한국 +0.98%(t 2.99) → +1.05%(t 3.27) · 미국 +0.29%(t 1.03 미통과) → +0.46%(t 2.12 통과).
#   새 후보 4종(52주 고가 거래량 돌파·상대강도 신고가·주도주 눌림·NR7 추세)은 개별로는 한국에서 양수였지만 넣으면 검증 구간 t 가 3.19 → 2.27~3.04 로 내려가 넣지 않았다(lab sysval.py).
PB_OFF = {
    "kr": ("CAPIT_REV", "VOL_REVERT", "TR_PULLBACK", "HERD_REBOUND", "TRIPLE_SCR", "OS_DEEP", "ENVELOPE", "MACD_X", "ELDER_RAY", "XS_ARB",
           "STOCH_OS_EXIT", "WILLR", "BB_LOW", "STOCH_CROSS", "CCI_REV", "MA_PULLBACK", "HA_REV", "VT_TREND", "SQUEEZE", "SN_RSI2",
           "VOL_BREAKOUT", "KELTNER", "IBS_LOW", "PSAR"),
    "us": ("CAPIT_REV", "OS_DEEP", "HI52_NEAR", "DONCHIAN", "SQUEEZE", "TREND_ALIGN", "VT_TREND", "MA_PULLBACK", "KELTNER", "TR_PULLBACK",
           "PSAR", "ICHIMOKU", "MACD_X", "TRIPLE_SCR", "ELDER_RAY", "BB_LOW", "VOL_BREAKOUT", "IBS_LOW", "HA_REV", "WILLR",
           "SN_RSI2", "STOCH_OS_EXIT", "CCI_REV", "STOCH_CROSS", "ENVELOPE"),
}
# [V33.651] ★퇴출 매매법 수정판 = 보조 매매법(2순위)★ — 사용자 10/22 "음수 매매법은 산식 조정해 양수로 · 매매법 더 발전".
#   퇴출 매매법마다 진입 거르개 6종(없음·추세 T·주도주 L·둘 다 TL·거래량 V·LV) × 청산 3종(원래·모멘텀 30일·60일)을 앞 60% 에서 t 로 고르고,
#   60~80% 도 양수여야 채택 · 실전처럼 ★하루 늦은 진입★(학습기가 장 마감 뒤 목록을 보내고 워커는 다음 날 종가에 산다)으로 다시 확인.
#   한국 10종 통과(마지막 20%: IBS_LOW+TL +1.62% · PSAR+TL +2.05% · KELTNER+TL +1.47% · HA_REV+TL +1.17% …) · 미국은 통과 4종 중 3종이 마지막 20% 음수 → 미국 적용 안 함.
#   ★2순위★: 같은 종목에 기존(1순위) 매매법이 뜨면 보조는 뺀다 — 함께 경쟁시키면 판정 구간 +1.05% → +0.84% 로 내려갔고(좋은 거래를 밀어냄),
#   2순위로 두면 판정 +1.05%(t 3.27) → +1.14%(t 3.40) · 최근 125일 +1.28% → +1.60%(검증 구간 t 는 3.19 → 2.33 · lab tier.py).
#   거르개: T = 종가 > MA200 · MA50 > MA200 / TL = T + 6개월 수익 횡단면 상위 30% / V = 거래량 1.5배 이상.
MOD_PB = {
    "kr": {"ELDER_RAY+T": ("ELDER_RAY", "T", 60), "HA_REV+TL": ("HA_REV", "TL", 60), "IBS_LOW+TL": ("IBS_LOW", "TL", 60),
           "KELTNER+TL": ("KELTNER", "TL", 60), "PSAR+TL": ("PSAR", "TL", 60), "SQUEEZE+T": ("SQUEEZE", "T", 30),
           "TR_PULLBACK+TL": ("TR_PULLBACK", "TL", 60), "VT_TREND+TL": ("VT_TREND", "TL", 60), "TRIPLE_SCR+V": ("TRIPLE_SCR", "V", 30),
           "VOL_BREAKOUT+T": ("VOL_BREAKOUT", "T", 60)},
    "us": {},
}


# [V33.652] ★문헌 전략 추가(2순위 보조 · 시장별)★ — 사용자 10/22 "인터넷에서 매매전략 더 찾아 추가 · 학습 · 좋은 것만 남겨".
#   후보 16종(코너스 Double 7s·3일 저점 · Da-Gurun-Warachka 개구리 모멘텀 · Blitz 잔차 모멘텀 · Bali MAX 효과 · 고거래량 프리미엄 · 단기 반전 ·
#   저변동성 · 야간 모멘텀 · 월말월초 · 갭하락 반전 · 래리 윌리엄스 변동성 돌파 · 52주 고가 돌파 · 상대강도 신고가 · 주도주 눌림 · NR7 추세)을
#   10년 일봉 · 하루 늦은 진입 · 청산 3종으로 시험(lab strat.py): 앞 60% t 로 청산 고르고 60~80% 양수(t≥1) → 마지막 20% 양수 확인 →
#   ★하나씩 넣어 검증 구간 평균을 낮추지 않는 것만★(sys3.py). 한국 4종 채택 · 주도주 눌림은 판정 +1.14→+0.86% 로 내려 탈락.
#   미국: 통과한 단기 반전·갭하락 반전도 넣으면 판정 +0.46→+0.31·+0.34% 로 내려 탈락(내부자 매수도 손절 규칙 아래 마지막 20% −0.10% 로 탈락).
# [V33.653] 문헌·실무 전략 55종 추가 시험(lab lib50.py · run50.py · sys50.py — 미너비니·VCP·포켓 피봇·와인스타인·슈퍼트렌드·ADX·다바스·컵앤핸들·
#   캔들 8종·코너스 R3/CRSI/TPS·StochRSI·KDJ·MFI·홀리 그레일·터틀 수프·OBV·CMF·TRIX·KAMA …): 한국 13종이 세 구간 모두 양수였지만
#   시스템에 하나씩 넣으면 11종은 고르는 AI 가 한 번도 안 골라 결과가 그대로(표본 적어 하한 ≤ 0) · 미너비니·거래량 마른 눌림은 판정을 낮춤.
#   ★실제로 결과를 바꾸고 낮추지 않은 다바스 박스만 채택★(검증 t 2.33→2.46 · 최근 125일 +1.60→+1.62%).
#   미국: 55종 중 세 구간 양수 3종(갭 메움 · 하이 타이트 플래그 · 거래량 마른 눌림) → 하나씩 넣어 검증 구간 평균을 안 낮춘 갭 메움·거래량 마른 눌림 채택.
#   둘 다 넣으면 미국 판정 +0.46%(t 2.12) → +0.63%(t 2.20) · 최근 125일 +0.08% → +0.81%(무작위 +0.35%).
# [V33.657] 추가 25종(lab lib25 · run25 · sys25 — 볼린저 상단·200일선 회복·TK 교차·헐·앨리게이터·프랙털·라쉬케 3봉·EMA21+ADX·포스 지수·EOM·
#   헤스턴-사드카 계절성·연말·NR4·장대양봉·모멘텀 가속·주도주 급락·변동성 수축·갭 유지·피보나치 눌림·상승 거래량 우위·RSI50·2단계 거래량·주도주 일시 부진):
#   세 구간 양수 한 11 · 미 4 → ★검증 구간 평균과 t 둘 다 낮추지 않는 것만★(강화한 규칙 — 포스 지수는 평균↑·t↓·판정 +1.17→+0.95% 라 탈락).
#   한국: 주도주 일시 부진(검증 t 2.46→2.52) · 미국: 주도주 급락 매수·갭 상승 3일 유지·주도주 일시 부진 → 셋 다 넣으면 미 판정 +0.63%(t 2.20) → +0.88%(t 2.73) · 최근 125일 +0.64% vs 무작위 +0.36%.
# [V33.659] ★단타(2~5일 보유) 후보★ — 사용자 10/23 "미장 국장 단타 매매법 개발". 10년 일봉으로 당일·밤샘·2~10일 보유 후보 약 120종(lab daytrade·daytrade2·3·krshort):
#   하루 포트폴리오(상위 5종목) · 실전과 같은 하루 늦은 진입으로 세 구간 + 최근 125일 모두 기준선 초과만 남기고(미 5 · 한 3) → 시스템에 하나씩(sysshort.py).
#   한국 상한가 따라잡기는 잠긴 상한가(+28% 이상 · 종가에 못 산다)를 빼면 음수라 버림. 미국 단기 눌림 5종은 검증 구간은 올렸지만 시스템 최근 125일을 음수로 만들어 탈락.
#   한국: 거래량 급등 유지(어제 거래량 3배 · +5% 이상 → 오늘 그 가격을 지킴 · 정배열 · 5일 보유) — 검증 t 2.52→2.56 · 평균 1.004→1.024% · 판정 그대로(+1.17% t 3.48) · 최근 125일 +1.38% vs 무작위 +0.20%.
#   (폭락일 정배열 매수는 검증을 올렸지만 고르는 규칙을 바꿔 판정 +1.17→+0.96% · 최근 +1.62→+0.85% 로 내려 보수적으로 제외.)
NEW_PB = {"kr": {"FROG": 60, "RESID_MOM": 60, "RS_NEWHI": 60, "NR7_TREND": 60, "DARVAS": 30, "SECTOR_LAG": 60},
# [V33.661] VOL_SURGE_HOLD 퇴출 — 실전 회차(OMNI-Q 후보로 거른 시뮬)에서 판정 전 n 203 평균 −0.76% · 판정 n 71 −0.82%(전 종목 lab 과 달리 음수).
          "us": {"GAP_FILL_D": 60, "VOL_DRYUP_PB": 60, "DIP_IN_LEADER5": 30, "GAP_UP_HOLD3": 60, "SECTOR_LAG": 60}}
# [V33.665] ★단타는 종목 그룹(변동성 3분위)을 한정★ — lab grpshort·sysgrp(10년 · 하루 늦은 진입): 미국 단기 눌림 4종·한국 거래량 급등 유지는
#   고변동 그룹에서만 앞 60%·60~80%·마지막 20%·최근 125일 모두 기준선 초과(저·중변동은 손실 — 전 종목으로 넣으면 시스템을 낮춰 V33.659·661 에서 탈락).
#   그룹은 앞 두 구간으로만 골랐다(사전 등록) → 시스템에 하나씩: 미 MA5_DIP_LEAD@고변동 검증 t 2.53→2.67 · 평균 2.44→2.61% · 판정 0.88→0.90% /
#   한 VOL_SURGE_HOLD@고변동 t 2.52→2.57 · 평균 1.00→1.03% · 판정 그대로. 갭하락 반등(평균↓)·폭락일 매수(고르는 규칙을 바꿔 판정 1.17→0.98%)는 제외.
# [V33.666] ★둘 다 퇴출★ — 실전 회차(run 40113783147 · OMNI-Q 후보 거름 · 고변동 한정)의 매매법별 성적: 미 MA5_DIP_LEAD 판정 전 −0.13%(n 491) · 판정 −1.12%(n 204) /
#   한 VOL_SURGE_HOLD 판정 전 −2.04%(n 76) · 판정 −0.12%(n 19). lab(전 종목 · 6개월 수익 순위 상위 5)과 실전 후보(OMNI-Q 상위)가 달라 우위가 사라졌다.
NEW_PB_GRP = {"kr": {}, "us": {}}


def _new_signals(P, names):
    """[V33.652] 문헌 전략 신호(날짜×종목 bool · 늦추기 전)."""
    I = CAT._ind(P)
    c, h, l = I["c"], I["h"], I["l"]
    A, X = CAT._and, CAT._xrank
    first = lambda x: x.fillna(False) & ~x.fillna(False).shift(1, fill_value=False)
    r1 = c.pct_change(fill_method=None)
    mret = r1.mean(axis=1)
    m12 = c.shift(21) / c.shift(252) - 1
    out = {}
    if "FROG" in names:   # 개구리 모멘텀 — 12−1개월 상위 20% 중 정보 분산도(ID) 하위 30%(작은 상승이 꾸준히 쌓인 것)
        pos = (r1 > 0).astype(float).shift(21).rolling(231).mean()
        neg = (r1 < 0).astype(float).shift(21).rolling(231).mean()
        ID = np.sign(m12) * (neg - pos)
        out["FROG"] = first(A(X(m12) >= 0.8, X(ID) <= 0.3, m12 > 0))
    if "RESID_MOM" in names:   # 잔차 모멘텀 — 시장 평균을 뺀 12−1개월 수익 ÷ 그 변동성 상위 20% · 200일선 위
        res = r1.sub(mret, axis=0)
        z = res.shift(21).rolling(231).sum() / res.shift(21).rolling(231).std()
        out["RESID_MOM"] = first(A(X(z) >= 0.8, c > I["ma200"]))
    if "RS_NEWHI" in names:   # 상대강도 신고가 — (종가 ÷ 시장 지수) 126일 최고 · 50일선 위 · 12−1개월 양수
        rr = c.div((1 + mret.fillna(0)).cumprod(), axis=0)
        out["RS_NEWHI"] = first(A(rr >= rr.rolling(126, min_periods=120).max(), c > I["ma50"], m12 > 0))
    if "NR7_TREND" in names:   # 7일 중 가장 좁은 봉 다음 날 전일 고가 돌파 · 정배열
        rng = h - l
        out["NR7_TREND"] = A((rng == rng.rolling(7).min()).shift(1, fill_value=False), c > h.shift(1), I["ma20"] > I["ma50"], I["ma50"] > I["ma200"])
    if "DARVAS" in names:   # [V33.653] 다바스 박스 — 4~10일 전 7일 고가(상자 위)를 최근 3일이 못 넘다가 오늘 종가가 넘음 · 정배열 · 거래량 1.2배
        boxtop = h.shift(4).rolling(7).max()
        out["DARVAS"] = A(h.shift(1).rolling(3).max() < boxtop, c > boxtop, c > I["ma200"], I["ma50"] > I["ma200"], I["vr"] >= 1.2)
    if "GAP_FILL_D" in names:   # [V33.653] 갭 메움(일봉) — 2% 이상 하락 갭으로 열고 종가가 전일 종가 위로 회복
        out["GAP_FILL_D"] = A(I["o"] / c.shift(1) - 1 <= -0.02, c > c.shift(1))
    if "VOL_DRYUP_PB" in names:   # [V33.653] 거래량 마른 눌림 — 정배열 · 3일 눌림(종가 < 3일 전) · 그 3일 최대 거래량 < 20일 평균 60% · 오늘 양봉
        out["VOL_DRYUP_PB"] = A(c > I["ma200"], I["ma50"] > I["ma200"], c.shift(1) < c.shift(4), I["v"].shift(1).rolling(3).max() < 0.6 * I["vavg"].shift(1), I["ret1"] > 0)
    if "SECTOR_LAG" in names:   # [V33.657] 주도주 일시 부진 — 1년 수익 상위 20% 인데 최근 20일은 하위 20% · 200일선 위
        out["SECTOR_LAG"] = A(X(c.pct_change(20, fill_method=None)) <= 0.2, X(c.pct_change(252, fill_method=None)) >= 0.8, c > I["ma200"])
    if "DIP_IN_LEADER5" in names:   # [V33.657] 주도주 급락 매수 — 6개월 수익 상위 10% 가 5일 −7% 이하로 밀림 · 200일선 위(30일 보유)
        out["DIP_IN_LEADER5"] = A(X(c.pct_change(126, fill_method=None)) >= 0.9, c.pct_change(5, fill_method=None) <= -0.07, c > I["ma200"])
    if "GAP_UP_HOLD3" in names:   # [V33.657] 갭 상승 3일 유지 — 3일 전 +3% 이상 상승 갭 · 그 뒤 3일 저가가 갭 전 종가 위 · 갭 날보다 높게 마감 · 정배열
        out["GAP_UP_HOLD3"] = A(I["o"].shift(3) / c.shift(4) - 1 >= 0.03, l.rolling(3).min() > c.shift(4), c > c.shift(3), c > I["ma200"], I["ma50"] > I["ma200"])
    if "MA5_DIP_LEAD" in names:   # [V33.665] 주도주 5일선 눌림(단타 2일) — 6개월 수익 상위 20% · 종가 < 5일선 × 0.97 · 50일선 위
        out["MA5_DIP_LEAD"] = A(X(c.pct_change(126, fill_method=None)) >= 0.8, c < c.rolling(5).mean() * 0.97, c > I["ma50"])
    if "VOL_SURGE_HOLD" in names:   # [V33.659] 거래량 급등 유지(단타 5일) — 어제 거래량 20일 평균 3배 · +5% 이상 → 오늘 어제 종가 −2% 이내 · 저가가 그제 종가 위 · 정배열
        vr_ = I["v"] / I["v"].rolling(20).mean()
        out["VOL_SURGE_HOLD"] = A(vr_.shift(1) >= 3, r1.shift(1) >= 0.05, c >= c.shift(1) * 0.98, l > c.shift(2), c > I["ma200"], I["ma50"] > I["ma200"])
    if "LEAD60_HOLD" in names:   # [V33.694] 주도주 보유 — 60일 수익 횡단면 상위 5% · 20일선 위 → 최대 60일(실험실 r3/e7: 상승장 한 +5.9·+6.0% / 미 +4.4·+7.3% 두 구간)
        out["LEAD60_HOLD"] = first(A(X(c.pct_change(60, fill_method=None)) >= 0.95, c > I["ma20"]))
    if "LEAD120_HOLD" in names:   # [V33.694] 주도주 보유(긴) — 120일 수익 상위 5% · 50일선 위 → 최대 60일(미 상승 +5.5·+7.9 · 보합 +8.0·+9.1 · 폭등 +9.6·+17.9)
        out["LEAD120_HOLD"] = first(A(X(c.pct_change(120, fill_method=None)) >= 0.95, c > I["ma50"]))
    return {k: v.fillna(False).astype(bool) for k, v in out.items()}


def _mod_filters(P):
    I = CAT._ind(P)
    c = I["c"]
    r6 = c.pct_change(126, fill_method=None)
    t = CAT._and(c > I["ma200"], I["ma50"] > I["ma200"])
    return {"T": t, "TL": CAT._and(t, CAT._xrank(r6) >= 0.7),
            "V": (I["vr"] >= 1.5).fillna(False) if I["vr"] is not None else CAT._and(c != c)}


def _tier(df, tier2):
    """[V33.651] 2순위 — 같은 후보(inst)에 1순위 매매법 행이 있으면 보조 행을 뺀다(워커 pbRoutePick 과 같다)."""
    if not tier2 or not len(df):
        return df
    is2 = df["pb"].isin(tier2)
    t1 = set(df.loc[~is2, "inst"])
    return df[~is2 | ~df["inst"].isin(t1)]
CAND_Q = 0.80        # 후보 = 그날 OMNI-Q 표본 밖 점수 상위 20%(워커 PB_ROUTE.candMin 과 같다)
CAND_MIN_ROWS = 3000  # 후보로 거른 표본이 이보다 적으면 전 종목으로(기록에 남긴다)


# [V33.683] ★공황 반등 바구니(관측 · 사전 등록)★ — 사용자 10/27 "한국 매매법 강화 · 어떤 상황에서도 그에 맞춰 작동".
#   공황 중엔 개별 추세 매매법이 시장보다 못하다(한국 10년: 공황·반등일 −0.91% · 공황 전체 모든 매매법 음수) → 지금은 쉬는 게 맞다.
#   대신 '공황(전날 학습기 값) 날 OMNI-Q 후보 상위를 바구니로 사서 10거래일' 은 앞 80% +3.1~3.5%(t 1.2~1.4) · 뒤 20% +1.7~2.2%(t 0.8~0.9) — 양쪽 양수지만 근거 약함.
#   지수 ETF(KODEX200·KOSDAQ150)는 실전 하루 늦춤을 넣으면 효과 없음(+0.09% t 0.1) → 안 씀. 그래서 사람 손 없이 회차마다 다시 재고,
#   규칙(사전 등록): 판정 전 구간(앞 80%) 바구니 거래 ≥ 20 · 평균 > 0 · t ≥ 2 그리고 판정 구간(뒤 20%) 평균 > 0 이면 'ok' → 워커 시험 매수 후보(그 전엔 화면 관측만).
PANIC_BOOK_H, PANIC_BOOK_MIN = 10, 20


def panic_book(P, oos, reg, head="5", q=0.8, mk="kr"):
    """공황(하루 늦춤) 날 OMNI-Q 후보(머리 head · 상위 1−q) 동일가중 바구니 → H 일 뒤 종가(비용 차감) · 겹침 없이. 앞 80% · 뒤 20% 통계와 오늘 공황 여부."""
    try:
        pn = _panic(P["close"], reg)
        lag = np.concatenate([[False], pn[:-1]])
        cm = cand_mask(P, oos, q, head)
        if cm is None:
            return None
        C = P["close"].values
        T, H = C.shape[0], PANIC_BOOK_H
        cut = int(T * SPLIT[1])
        out = {"h": H, "head": head, "q": q, "panicNow": bool(pn[-1]), "rule": "앞80%% n≥%d·평균>0·t≥2 그리고 뒤20%% 평균>0" % PANIC_BOOK_MIN}
        for nm, a, b in (("pre", 250, cut), ("post", cut, T - H)):
            v, t = [], a
            while t < b:
                if lag[t] and cm[t].any():
                    f = (C[t + H][cm[t]] / C[t][cm[t]] - 1) * 100 - COST_RT.get(mk, 0.3)
                    f = f[np.isfinite(f)]
                    if len(f):
                        v.append(float(f.mean()))
                        t += H
                        continue
                t += 1
            v = np.array(v)
            out[nm] = {"n": int(len(v)), "mean": round(float(v.mean()), 3) if len(v) else None,
                       "t": round(float(v.mean() / (v.std(ddof=1) / math.sqrt(len(v)))), 2) if len(v) > 2 and v.std() > 0 else None,
                       "win": round(float((v > 0).mean() * 100), 1) if len(v) else None}
        pr, po = out["pre"], out["post"]
        out["ok"] = bool(pr["n"] >= PANIC_BOOK_MIN and (pr["mean"] or 0) > 0 and (pr["t"] or 0) >= 2 and (po["mean"] or 0) > 0)
        return out
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:200]}


def cand_rank(P, oos, head="5"):
    """cand_mask 와 같은 순위(그날 백분위 · 하루 늦춤)를 bool 이 아닌 값으로 — 상한이 찰 때 같은 날 순서용. 점수 없으면 None."""
    m = cand_mask(P, oos, -1.0, head, _rank=True)
    return m


def cand_mask(P, oos, q=None, head="5", _rank=False):
    """OMNI-Q 표본 밖 점수(날짜×종목) → P 와 같은 모양의 '그날 후보(상위 20%)' bool. 점수 없는 날은 전부 False.
    [V33.622] head = "5"(5일 머리) · "20"(20일 머리) · "avg"(둘의 그날 순위 평균) — 워커 pbCandScoreMap 과 같다."""
    if not oos or oos.get("sc") is None:
        return None
    if head in ("20", "avg"):
        if oos.get("sc20") is None:
            return None
        if head == "20":
            oos = dict(oos, sc=oos["sc20"])
        else:
            r5 = pd.DataFrame(oos["sc"]).rank(axis=1, pct=True).values
            r20 = pd.DataFrame(oos["sc20"]).rank(axis=1, pct=True).values
            oos = dict(oos, sc=(r5 + r20) / 2)
    di = {d: k for k, d in enumerate(oos["dates"])}
    si = {s_: k for k, s_ in enumerate(oos["syms"])}
    dates, syms = list(P["close"].index), list(P["close"].columns)
    a = np.array([di.get(d, -1) for d in dates])
    b = np.array([si.get(s_, -1) for s_ in syms])
    M = np.full((len(dates), len(syms)), np.nan, dtype=np.float32)
    ra, cb = np.nonzero(a >= 0)[0], np.nonzero(b >= 0)[0]
    if len(ra) == 0 or len(cb) == 0:
        return None
    M[np.ix_(ra, cb)] = oos["sc"][np.ix_(a[ra], b[cb])]
    rk = pd.DataFrame(M).rank(axis=1, pct=True).values
    if _rank:
        out = np.nan_to_num(rk, nan=0.0).astype(np.float32)
        return np.vstack([np.zeros((1, out.shape[1]), dtype=np.float32), out[:-1]]) if LAG_FIX else out
    out = np.nan_to_num(rk, nan=0.0) >= (CAND_Q if q is None else q)
    if LAG_FIX:   # [V33.671] 실전 = 전날 학습기 점수로 오늘 후보 → 시뮬도 하루 늦은 점수
        out = np.vstack([np.zeros((1, out.shape[1]), dtype=bool), out[:-1]])
    return out


def _mr_exit(P):
    """[V33.618] 평균회귀 청산 신호(T×N) — 종가 > MA5 또는 RSI2(단순 2봉) ≥ 65. 워커 snapRules.exitAboveMa5 · exitRsi2 와 같다."""
    C = P["close"]
    ma5 = C.rolling(5, min_periods=5).mean()
    d = C.diff()
    up = d.clip(lower=0).rolling(2).mean()
    dn = (-d.clip(upper=0)).rolling(2).mean()
    rsi2 = (100 - 100 / (1 + up / dn.replace(0, np.nan))).where(dn > 0, 100.0)
    return ((C > ma5) | (rsi2 >= SNAP_MR["rsi2x"])).fillna(False).values


LIVE_FILTER_PB = ("SN_RSI2",)

# ── [V33.619] ★매매법 자동 조율★ — 사용자 10/15 "승률·수익률 낮은 매매법은 지우지 말고 세부 사항을 고쳐 올려라".
#   사람이 숫자를 골라 넣으면 과거에 맞춘다(과적합). 대신 매매법마다 청산 프로필 6 × 진입 거르개 5 = 30 가지를
#   ★표 구간보다도 앞(앞 55%)★ 에서만 비교해 하한(평균 − 표준오차)이 기본보다 TUNE_MARGIN 이상 좋을 때만 바꾼다.
#   규칙 고르기 [60,80%) · 판정 [80,100%) 는 손대지 않은 채 남는다 — 바꾼 것이 실제로 나은지는 판정 구간이 말한다(tune.test 에 기록).
PROFILES = {
    "trend": {"stop": 7.0, "atr": 2.5, "be": 1.0, "tpR": None, "hold": 30},
    "swing": {"stop": 5.0, "atr": 2.0, "be": 1.0, "tpR": 2.0, "hold": 15},
    "short": {"stop": 4.0, "atr": 1.5, "be": 0.8, "tpR": 1.5, "hold": 8},
    "quick": {"stop": 3.0, "atr": 1.2, "be": 0.0, "tpR": None, "tpPct": 3.0, "bePct": 1.5, "hold": 5, "tstop": 3},
    "mr": dict(SNAP_MR, hold=8),
}
PROF_KEYS = ("stop", "atr", "be", "tpR", "hold", "mr", "tpPct", "bePct", "tstop", "rsi2x", "trail", "trailAct")
FILTERS = (None, "trend", "noBear", "calm", "up20")
TUNE_CUT, TUNE_PICK, TUNE_MIN_N, TUNE_MARGIN, TUNE_T = 0.55, 0.40, 80, 0.05, 3.0
#   고르기 [0,40%) → 확인 [40,55%). 같은 종목 연일 신호는 서로 겹쳐 거래 수만큼 독립이 아니다(무작위 시세 대조에서 29종 중 11종을 '개선' 으로 잘못 골랐다) →
#   ★달(21거래일) 묶음★ 으로 '조율 − 기본' 월평균 차이의 t ≥ TUNE_T · 평균 차이 ≥ TUNE_MARGIN 이고, 확인 구간에서도 조율 평균 ≥ 기본 평균 + TUNE_MARGIN 일 때만 바꾼다.


def _month_diff_t(exa, Sa, exb, Sb, t0, t1):
    """[t0,t1) 날짜를 21일 묶음으로 — 묶음마다 (A 평균 − B 평균) → (평균 차이, t, 묶음 수). 표본 5개 미만 묶음은 뺀다."""
    d = []
    for a in range(t0, t1, 21):
        b = min(t1, a + 21)
        va, vb = exa[a:b][Sa[a:b]], exb[a:b][Sb[a:b]]
        if len(va) >= 5 and len(vb) >= 5:
            d.append(float(va.mean()) - float(vb.mean()))
    if len(d) < 4:
        return None, 0.0, len(d)
    d = np.asarray(d)
    sd = d.std(ddof=1)
    return float(d.mean()), (float(d.mean() / (sd / math.sqrt(len(d)))) if sd > 0 else 0.0), len(d)


def _prof_key(pr):
    return tuple(pr.get(k) for k in PROF_KEYS)


def _apply_prof(base, name):
    if name == "base":
        return dict(base, prof="base")
    out = {k: v for k, v in base.items() if k not in PROF_KEYS}
    out.update({"mr": False, "tpPct": None, "bePct": None, "tstop": 0})
    out.update(PROFILES[name])
    out["prof"] = name
    return out


def _flt_masks(P, reg, atr):
    """[V33.619] 진입 거르개 T×N — 워커 pbTunedFilterOk 와 같다(check-playbook 대조)."""
    C = P["close"]
    shp = C.shape
    ma20, ma50, ma200 = C.rolling(20).mean(), C.rolling(50).mean(), C.rolling(200).mean()
    ret1 = C.pct_change(fill_method=None) * 100
    regok = ~np.isin(np.asarray(reg).astype(str), ["BEAR", "CRASH"])
    rsi14 = _daily_state(P, [])[0]
    ret5 = (C / C.shift(5) - 1) * 100
    return {None: np.ones(shp, dtype=bool), "trend": (C > ma200).values, "noBear": np.broadcast_to(regok[:, None], shp),
            "calm": np.nan_to_num((atr <= 4) & (ret1 >= -4).values, nan=0).astype(bool), "up20": (ma20 > ma50).values,
            # [V33.620] 정밀 조율 거르개 3종 — notExt: 20일선 +8% 이내 · dip5: 5일 수익 ≤ 0 · rsiMid: 40 ≤ RSI14 ≤ 65
            "notExt": (C / ma20 - 1 <= 0.08).values, "dip5": (ret5 <= 0).values, "rsiMid": (rsi14 >= 40) & (rsi14 <= 65)}


def _nmw(v):
    return [int(len(v)), round(float(v.mean()), 3) if len(v) else None, round(float((v > 0).mean() * 100), 1) if len(v) else None]


# ── [V33.620] ★정밀 조율(한 칸씩 오르기)★ — 사용자 10/15 "각 매매법 문제를 찾아 조금씩 매우 정밀하게 조정해 최적으로".
#   V33.619 의 6 프로필 × 5 거르개 는 너무 거칠어 실데이터에서 한 종도 못 바꿨다. 이제 손절 % · ATR 배수 · 보유일 · 익절(R·%) · 본전(R·%) · 기간 손실 정리 ·
#   평균회귀 청산 여부 · 진입 거르개(최대 2개 조합)를 ★한 칸씩★ 움직인다 — 이웃 중 '지금보다' 달 묶음 t ≥ STEP_T 로 나은 것으로 한 걸음(최대 MAX_STEPS).
#   마지막엔 걸어온 길에서 기본 대비 t ≥ TUNE_T · 평균 차이 ≥ TUNE_MARGIN · 확인 구간에서도 + TUNE_MARGIN 인 가장 먼 지점을 쓴다(없으면 기본).
#   고르기·확인은 앞 55% 안 · 판정 구간 불가침. 무작위 시세 귀무 대조는 게이트(check-playbook)가 잰다.
LADDER = {
    "stop": [2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0],
    "atr": [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 99.0],
    "hold": [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40],
    "tpR": [None, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0],
    "tpPct": [None, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0],
    "be": [0.0, 0.5, 0.8, 1.0, 1.5],
    "bePct": [None, 1.0, 1.5, 2.0, 3.0],
    "tstop": [0, 2, 3, 4, 5, 7],
}
FILTERS1 = ("trend", "noBear", "calm", "up20", "notExt", "dip5", "rsiMid")
STEP_T, STEP_MIN, MAX_STEPS, TUNE_BUDGET_S = 1.5, 0.02, 10, 420


def _ladder_nb(lad, v):
    """사다리에서 v 의 이웃(한 칸 아래·위). v 가 사다리에 없으면 가장 가까운 칸 기준."""
    key = [(-1e9 if x is None else x) for x in lad]
    vv = -1e9 if v is None else v
    i = int(np.argmin([abs(k - vv) for k in key]))
    return [lad[j] for j in (i - 1, i + 1) if 0 <= j < len(lad) and lad[j] != v]


def _neighbors(pr, flt):
    """한 칸 이웃: 청산 값 하나 ±1 · 평균회귀 켜고 끄기 · 거르개 하나 더하기·빼기."""
    out = []
    for k, lad in LADDER.items():
        if k == "tpR" and pr.get("tpPct"):
            continue
        if k == "tpPct" and pr.get("tpR"):
            continue
        if k == "be" and pr.get("bePct"):
            continue
        if k == "bePct" and pr.get("be"):
            continue
        for v in _ladder_nb(lad, pr.get(k, 0 if k in ("be", "tstop") else None)):
            q = dict(pr)
            q[k] = v
            out.append((q, flt, "%s→%s" % (k, v)))
    q = dict(pr)
    q["mr"] = not pr.get("mr")
    out.append((q, flt, "평균회귀 " + ("켬" if q["mr"] else "끔")))
    for f in FILTERS1:
        if f in flt:
            out.append((dict(pr), tuple(x for x in flt if x != f), "거르개 −" + f))
        elif len(flt) < 2:
            out.append((dict(pr), tuple(sorted(flt + (f,))), "거르개 +" + f))
    return out


def _flt_key(flt):
    return "+".join(flt) if flt else None


def _diag(ex, rc, S, reg, t0, t1):
    """[V33.620] 매매법 진단 — [t0,t1) 진입: 표본·평균·승률·평균 이익/손실 · 청산 사유별 비중/평균 · 국면별 평균 → (지표, 문제 목록)."""
    m = S.copy()
    m[:t0] = False
    m[t1:] = False
    v, r = ex[m], rc[m]
    ti = np.nonzero(m)[0]
    if len(v) < 30:
        return None, []
    w, l = v[v > 0], v[v <= 0]
    d = {"n": int(len(v)), "mean": round(float(v.mean()), 3), "win": round(float((v > 0).mean() * 100), 1),
         "avgW": round(float(w.mean()), 2) if len(w) else None, "avgL": round(float(l.mean()), 2) if len(l) else None, "rc": {}, "reg": {}}
    for code, name in RC_NAMES.items():
        mm = r == code
        if mm.sum():
            d["rc"][name] = [round(float(mm.mean() * 100), 1), round(float(v[mm].mean()), 2)]
    rg = np.asarray(reg).astype(str)[ti]
    for g in REGIMES:
        mm = rg == g
        if mm.sum() >= 20:
            d["reg"][g] = [int(mm.sum()), round(float(v[mm].mean()), 2)]
    pr_ = []
    st_ = d["rc"].get("손절", [0, 0])
    if st_[0] >= 45:
        pr_.append("손절로 끝나는 거래가 %.0f%% — 손절이 너무 좁거나 진입이 이르다" % st_[0])
    hm = d["rc"].get("보유 만기")
    if hm and hm[0] >= 30 and hm[1] < 0:
        pr_.append("보유 만기 청산이 %.0f%% 이고 평균 %.2f%% — 오래 들고 있어도 안 오른다(보유일·익절)" % (hm[0], hm[1]))
    tp = d["rc"].get("익절")
    if tp is not None and tp[0] < 5:
        pr_.append("익절에 닿는 거래가 %.1f%% 뿐 — 익절 목표가 멀다" % tp[0])
    if d["avgW"] is not None and d["avgL"] is not None and d["avgL"] < 0 and d["win"] < 50 and d["avgW"] < -d["avgL"]:
        pr_.append("승률 %.0f%% 에 평균 이익 %.2f%% < 평균 손실 %.2f%% — 이길 때 적게 · 질 때 크게" % (d["win"], d["avgW"], -d["avgL"]))
    bad = [g for g, x in d["reg"].items() if x[1] < -0.5]
    good = [g for g, x in d["reg"].items() if x[1] > 0]
    if bad and good:
        pr_.append("국면 의존 — %s 에서 손실(%s) · %s 에서 이익" % ("·".join(bad), " ".join("%.2f%%" % d["reg"][g][1] for g in bad), "·".join(good)))
    if d["mean"] < 0 and not pr_:
        pr_.append("평균 순초과 %.2f%% — 비용·시장 대비 우위 없음" % d["mean"])
    return d, pr_


def tune_daily(P, market, sig, log=print, budget_s=TUNE_BUDGET_S, skip=()):
    """매매법별 한 칸씩 오르기 조율 → (조율된 DAILY_PB 사본, 보고). 보고에 진단(기본·조율)과 걸어온 길."""
    t_start = time.time()
    O, H, L, C = (P[k].values for k in ("open", "high", "low", "close"))
    T = C.shape[0]
    reg, mret = _regime(P["close"])
    atr = _daily_state(P, [])[4]
    mcum = np.concatenate([[1.0], np.cumprod(1 + mret)])
    cost = COST_RT[market]
    mrx, live_ok, fm = _mr_exit(P), _live_filters(P, reg, atr), _flt_masks(P, reg, atr)
    ca, cut, c2 = 250 + int((T - 250) * TUNE_PICK), 250 + int((T - 250) * TUNE_CUT), 250 + int((T - 250) * SPLIT[1])
    cache, out, rep_ = {}, {}, {}

    def ex_of(pr):   # 앞 55% 진입만(조율용)
        k = _prof_key(pr)
        if k not in cache:
            cache[k] = _sim_profile(O, H, L, C, atr, mcum, pr, cost, mrx=mrx, t_max=cut)[0]
        return cache[k]

    def fmask(flt):
        m = fm[None]
        for f in flt:
            m = m & fm[f]
        return m

    _off = set(skip or ())   # [V33.650 학습기] 퇴출 매매법은 조율하지 않는다(run 이 PB_OFF 를 넘긴다 · 시간 낭비 · 결과는 어차피 버린다)
    order = sorted([k for k in DAILY_PB if k not in _off], key=lambda k: -int(sig[k].values.sum()) if k in sig else 0)
    skipped = []
    for pb in order:
        base = DAILY_PB[pb]
        b0 = dict(_apply_prof(base, "base"), flt=None)
        out[pb] = b0
        if pb not in sig:
            continue
        S0 = sig[pb].values.astype(bool)
        if pb in live_ok:
            S0 = S0 & live_ok[pb]
        # 기본(진단은 판정 구간 전 [250, c2) · 판정 구간 보고는 [c2,))
        exb_full, _, rcb = _sim_profile(O, H, L, C, atr, mcum, b0, cost, mrx=mrx, want_rc=True)
        Sb_full = S0 & np.isfinite(exb_full)
        dgb, prb = _diag(exb_full, rcb, Sb_full, reg, 250, c2)
        rep_[pb] = {"prof": "base", "flt": None, "diag": dgb, "problems": prb, "path": [], "test": {"base": _nmw(exb_full[c2:][Sb_full[c2:]])}}
        if time.time() - t_start > budget_s:
            skipped.append(pb)
            continue
        exb = ex_of(b0)
        Sb = S0 & np.isfinite(exb)
        if Sb[:ca].sum() < TUNE_MIN_N:
            continue
        cur, curf = dict(b0), ()
        path = [(dict(cur), curf, "기본")]
        for _step in range(MAX_STEPS):
            if time.time() - t_start > budget_s:
                break
            exc = ex_of(cur)
            Sc = S0 & np.isfinite(exc) & fmask(curf)
            best = None
            for q, qf, why in _neighbors(cur, curf):
                exq = ex_of(q)
                Sq = S0 & np.isfinite(exq) & fmask(qf)
                if Sq[:ca].sum() < TUNE_MIN_N:
                    continue
                dm, tt, nb = _month_diff_t(exq, Sq, exc, Sc, 250, ca)
                if dm is not None and tt >= STEP_T and dm >= STEP_MIN and (best is None or dm > best[4]):   # 기준을 넘는 이웃 중 개선 폭이 큰 쪽
                    best = (tt, q, qf, why, dm)
            if best is None:
                break
            cur, curf = best[1], best[2]
            path.append((dict(cur), curf, "%s (t %.1f · %+.2f%%p)" % (best[3], best[0], best[4])))
        # 걸어온 길에서 기본 대비 최종 기준을 넘는 가장 먼 지점
        pick = None
        vb_c = exb[ca:cut][Sb[ca:cut]]
        for q, qf, why in reversed(path[1:]):
            exq = ex_of(q)
            Sq = S0 & np.isfinite(exq) & fmask(qf)
            dm, tt, nb = _month_diff_t(exq, Sq, exb, Sb, 250, ca)
            vq_c = exq[ca:cut][Sq[ca:cut]]
            if (dm is not None and tt >= TUNE_T and dm >= TUNE_MARGIN and len(vq_c) >= 30 and len(vb_c) >= 30
                    and float(vq_c.mean()) >= float(vb_c.mean()) + TUNE_MARGIN):
                pick = (q, qf, tt, dm)
                break
        rep_[pb]["path"] = [w for _, _, w in path]
        if pick is None:
            continue
        q, qf = pick[0], pick[1]
        q = dict(q)
        q["prof"] = "tuned"
        q["flt"] = _flt_key(qf)
        out[pb] = q
        ext_full, _, rct = _sim_profile(O, H, L, C, atr, mcum, q, cost, mrx=mrx, want_rc=True)
        St_full = S0 & np.isfinite(ext_full) & fmask(qf)
        dgt, prt = _diag(ext_full, rct, St_full, reg, 250, c2)
        rep_[pb].update({"prof": "tuned", "flt": q["flt"], "diagT": dgt, "problemsT": prt, "t": round(pick[2], 2), "dm": round(pick[3], 3),
                         "set": {k: q.get(k) for k in PROF_KEYS},
                         "test": {"base": rep_[pb]["test"]["base"], "tuned": _nmw(ext_full[c2:][St_full[c2:]])}})
    ch = [k for k, v in rep_.items() if v["prof"] != "base"]
    log("   · [매매법조율] %s %d종 중 %d종 정밀 조정(%.0fs%s) — %s" % (market, len(rep_), len(ch), time.time() - t_start,
        " · 시간 초과로 %d종 기본" % len(skipped) if skipped else "", " · ".join(
        "%s 판정구간 %s%%/%s%%→%s%%/%s%%" % (k, rep_[k]["test"]["base"][1], rep_[k]["test"]["base"][2], rep_[k]["test"]["tuned"][1], rep_[k]["test"]["tuned"][2]) for k in ch[:12])))
    return out, rep_


# [V33.625] 모멘텀 붕괴 차단 — Daniel & Moskowitz (2016, JFE 122(2) "Momentum Crashes"): 모멘텀 손실은 '시장이 하락한 뒤 · 변동성이 높을 때'
#   몰린다(공황 국면에서 패자 반등 · 승자 급락). 그 국면엔 추세·모멘텀·돌파 매매법 진입을 막는다(평균회귀·반등 매매법은 그대로).
#   공황 = (등가중 시장 60거래일 수익 < 0 이고 20일 변동성 ≥ 지난 1년 80% 분위) 또는 폭락(CRASH) 국면. t 일 종가까지만 본다.
#   근거는 문헌 + 판정 구간 ★전★ 진단(추세·모멘텀이 CRASH 칸에서 −2~−6%) — 판정 구간 결과로 고른 값이 아니다.
PANIC_PB = tuple(CAT.CLUSTERS["TREND"]) + ("VOL_BREAKOUT", "SQUEEZE", "KELTNER")
PANIC_LB, PANIC_VW, PANIC_VQ = 60, 20, 0.8


def _panic(close, reg):
    """[V33.625] 날짜별 공황 여부(bool[T]) — 워커는 학습기가 보낸 마지막 날 값(st.panic)을 쓴다."""
    r = close.pct_change(fill_method=None).mean(axis=1).fillna(0)
    idx = (1 + r).cumprod()
    down = (idx / idx.shift(PANIC_LB) - 1) < 0
    v = r.rolling(PANIC_VW, min_periods=PANIC_VW).std()
    hi = v >= v.rolling(252, min_periods=120).quantile(PANIC_VQ)
    return (down & hi).values.astype(bool) | (np.asarray(reg).astype(str) == "CRASH")


def _live_filters(P, reg, atr):
    """[V33.618] 실전 규칙의 진입 거르개(snapRules) — RSI2 반등에만: 약세·폭락 국면 금지 · 20일 고점 대비 −12% 이내 · ATR ≤ 5% · 당일 −4% 이상.
    워커 pbLiveFilterOk 와 같다(check-playbook 대조)."""
    C = P["close"]
    hi20 = C.rolling(20, min_periods=20).max()
    pull = (C / hi20 - 1) * 100
    ret1 = C.pct_change(fill_method=None) * 100
    regok = ~np.isin(np.asarray(reg).astype(str), ["BEAR", "CRASH"])
    ok = (pull >= -12).values & (atr <= 5) & (ret1 >= -4).values & regok[:, None]
    out = {pb: np.nan_to_num(ok, nan=0).astype(bool) for pb in LIVE_FILTER_PB}
    calm = ~_panic(C, reg)[:, None] & np.ones(C.shape, dtype=bool)   # [V33.625] 공황 국면엔 추세·모멘텀 진입 없음
    for pb in PANIC_PB:
        out[pb] = out[pb] & calm if pb in out else calm
    return out


# [V33.664] ★미지수 조율(종목 특성 그룹별)★ — 사용자 10/24 "매매법을 여러 미지수의 수식으로 · 종목 특성에 맞춰 스스로 조율 · 승률·수익률 높게".
#   매매법마다 진입 미지수(playbook_params 사다리) + 청산 미지수(LADDER)를 변동성 3그룹(저·중·고) 각각 한 칸씩 오르기로 조율 —
#   자동 조율(tune_daily)과 같은 규칙: 고르기 [250, 40%) 월 묶음 t ≥ STEP_T · 최종 기본 대비 월 묶음 t ≥ TUNE_T · 확인 [40,55%) 에서도 + TUNE_MARGIN.
#   ★그다음 시스템 검증★: 통과 후보를 하나씩 시스템에 넣어 검증 구간(60~80%) 평균·t 둘 다 낮추지 않고 통과를 유지할 때만 실전에 쓴다.
#   lab(ptune·psys 10년): 한국 조율 통과 9건 · 미국 1건 — 그중 시스템을 안 낮춘 건 한국 이치모쿠 저변동 그룹뿐
#   (RS_LEADER 는 단독 +1.27%p 였지만 시스템 판정 +1.17→+0.71% — 한 매매법의 신호가 바뀌면 고르는 표가 흔들린다).
PTUNE_BUDGET_S, PTUNE_SYS_MAX, PTUNE_GROUPS = 540, 4, 3   # [V33.672] 300→540초 — v2(사다리 전체 탐색)가 300초에 뒤쪽 매매법을 '시간 상한' 으로 못 봤다(로컬 run 실측)


def param_tune(P, market, sig, dpb, pbs_list, cand=None, log=print, budget_s=PTUNE_BUDGET_S):
    """[V33.667] 조율기 v2 → (후보 {pb: {g: (ep 바뀐 것만, 청산 바뀐 것만, 사유, t)}}, 보고 {pb: {g: 사유 | {why, ep, ex}}}).
    v1 의 문제(자가 평가): ① 전 종목으로 조율 → 실전 후보(OMNI-Q 상위)와 표본이 달라 lab 통과분이 실전에서 음수(단타 2종 퇴출 사례)
    ② 기본값에서 ±1칸씩 · 걸음마다 t ≥ 1.5 → 대부분 0걸음에서 멈춤 ③ 고르기 한 번 + 확인 한 번(분할 운에 좌우) ④ 공통 조건이 없어 수식이 문턱 몇 개뿐.
    v2: ★실전과 같은 후보 거름(cand)★ 안에서만 · 사다리 전체 좌표 탐색(진입 + 공통 조건 MODS + 청산 · 최대 3바퀴 · 바퀴마다 t 최대 한 칸) ·
    최종 = 월 묶음 t ≥ TUNE_T · 차이 ≥ TUNE_MARGIN · ★고르기 구간 4등분 중 3곳 이상 개선★ · 확인 구간 + TUNE_MARGIN."""
    t0 = time.time()
    O, H, L, C = (P[k].values for k in ("open", "high", "low", "close"))
    T = C.shape[0]
    reg, mret = _regime(P["close"])
    atr = _daily_state(P, [])[4]
    mcum = np.concatenate([[1.0], np.cumprod(1 + mret)])
    cost = COST_RT[market]
    mrx, live_ok = _mr_exit(P), _live_filters(P, reg, atr)
    ca, cut = 250 + int((T - 250) * TUNE_PICK), 250 + int((T - 250) * TUNE_CUT)
    G = P["_grp"]
    CM = cand if cand is not None else np.ones(C.shape, dtype=bool)
    lo_t = max(250, int(np.argmax(CM.any(axis=1))) if CM.any() else 250)   # 후보 점수가 있는 첫날부터
    if lo_t >= ca - 84:
        log("   · [미지수조율] %s 후보 점수 기간이 짧아 조율 생략" % market)
        return {}, {}
    folds = np.linspace(lo_t, ca, 5).astype(int)
    cache = {}

    def ex_of(pr):
        k = _prof_key(pr)
        if k not in cache:
            cache[k] = _sim_profile(O, H, L, C, atr, mcum, pr, cost, mrx=mrx, t_max=cut)[0]
        return cache[k]

    def fold_wins(ea, Sa, eb, Sb):
        w = 0
        for a_, b_ in zip(folds[:-1], folds[1:]):
            va, vb = ea[a_:b_][Sa[a_:b_]], eb[a_:b_][Sb[a_:b_]]
            if len(va) >= 10 and len(vb) >= 10 and va.mean() > vb.mean():
                w += 1
        return w

    cands, rep_ = {}, {}
    fmk = _flt_masks(P, reg, atr)
    if pbs_list:   # [V33.672] 날마다 시작 매매법을 돌린다 — 시간 상한에 걸려도 회차마다 다른 매매법이 먼저 조율된다
        k0 = int(time.time() // 86400) % len(pbs_list)
        pbs_list = list(pbs_list[k0:]) + list(pbs_list[:k0])
    for pb in pbs_list:
        if pb not in PP.ENTRY or pb not in dpb:
            continue
        _, d0, ladders = PP.ENTRY[pb]
        lad = dict(ladders)
        lad.update(PP.MODS)
        ep0 = dict(d0, **{k: None for k in PP.MODS})
        pr0 = {k: v for k, v in dpb[pb].items() if k not in ("grp", "ep", "onlyGrp")}
        lo, flt = live_ok.get(pb), (str(dpb[pb]["flt"]).split("+") if dpb[pb].get("flt") else [])
        rep_[pb] = {}
        for g in range(PTUNE_GROUPS):
            if time.time() - t0 > budget_s:
                rep_[pb][str(g)] = "시간 상한"
                continue
            M = (G == g) & CM

            def S_of(ep, pr):
                s0_ = PP.sig(P, pb, ep)
                if LAG_FIX and pb in CROSS_PB:
                    s0_ = _lag1(s0_)   # [V33.671] 횡단면은 실전처럼 하루 늦게
                s_ = s0_ & M & np.isfinite(ex_of(pr))
                if lo is not None:
                    s_ = s_ & lo
                for f_ in flt:
                    s_ = s_ & fmk[f_]
                return s_
            eb, Sb = ex_of(pr0), S_of(ep0, pr0)
            if Sb[lo_t:ca].sum() < TUNE_MIN_N:
                rep_[pb][str(g)] = "표본 부족(%d)" % int(Sb[lo_t:ca].sum())
                continue
            cur = (dict(ep0), dict(pr0))
            for _round in range(3):
                ec, Sc, best = ex_of(cur[1]), S_of(*cur), None
                trial = [(dict(cur[0], **{k: v}), cur[1]) for k, L_ in lad.items() for v in L_ if v != cur[0].get(k)]
                trial += [(cur[0], dict(cur[1], **{k: v})) for k, L_ in LADDER.items() for v in L_
                          if v != cur[1].get(k, 0 if k in ("be", "tstop") else None)
                          and not ((k == "tpR" and cur[1].get("tpPct")) or (k == "tpPct" and cur[1].get("tpR")) or (k == "be" and cur[1].get("bePct")) or (k == "bePct" and cur[1].get("be")))]
                for ep, pr in trial:
                    if time.time() - t0 > budget_s:
                        break
                    Sq = S_of(ep, pr)
                    if Sq[lo_t:ca].sum() < TUNE_MIN_N:
                        continue
                    dm, tt, _n = _month_diff_t(ex_of(pr), Sq, ec, Sc, lo_t, ca)
                    if dm is not None and tt >= 2.0 and dm >= STEP_MIN and (best is None or tt > best[0]):
                        best = (tt, ep, pr)
                if best is None:
                    break
                cur = (best[1], best[2])
            if cur == (ep0, pr0):
                rep_[pb][str(g)] = "기준 미달(개선 이웃 없음)"
                continue
            eq, Sq = ex_of(cur[1]), S_of(*cur)
            dm, tt, _n = _month_diff_t(eq, Sq, eb, Sb, lo_t, ca)
            fw = fold_wins(eq, Sq, eb, Sb)
            vb, vq = eb[ca:cut][Sb[ca:cut]], eq[ca:cut][Sq[ca:cut]]
            why = "t %.1f · %+.2f%%p · 4구간 중 %d · 확인 %s→%s%%" % (tt, dm or 0.0, fw, round(float(vb.mean()), 2) if len(vb) else None, round(float(vq.mean()), 2) if len(vq) else None)
            epd = {k: v for k, v in cur[0].items() if ep0.get(k) != v}
            exd = {k: cur[1].get(k) for k in PROF_KEYS if cur[1].get(k) != pr0.get(k)}
            if not (dm is not None and tt >= TUNE_T and dm >= TUNE_MARGIN and fw >= 3 and len(vq) >= 30 and len(vb) >= 30
                    and float(vq.mean()) >= float(vb.mean()) + TUNE_MARGIN):
                rep_[pb][str(g)] = "기준 미달(" + why + ")"
                continue
            cands.setdefault(pb, {})[str(g)] = (epd, exd, why, tt)
            rep_[pb][str(g)] = {"why": "조율 통과 " + why, "ep": epd, "ex": exd}   # 화면이 '보류' 칸에도 조율안 값을 보인다
    log("   · [미지수조율] %s %d종 × %d그룹(실전 후보 안) — 조율 통과 %d건(%.0fs)" % (market, len(rep_), PTUNE_GROUPS, sum(len(v) for v in cands.values()), time.time() - t0))
    return cands, rep_


# [V33.672] ★고차원 수식(메타 라벨 · López de Prado)★ — 사용자 10/25 "매매법 수식 더 고차원으로".
#   매매법마다 진입 날 지표 11개(META_FEATS)의 선형 수식(능형 회귀 · 표준화)으로 '이번 신호의 기대 순초과' 를 예측하고, 예측이 학습 구간 예측의
#   하위 q 분위 아래면 그 신호를 거른다. 계수는 표를 만드는 구간(검증 전)으로만 · q ∈ META_QS 와 '안 거름' 중 검증 구간 평균·t 둘 다 안 낮추고
#   하나는 올리며 통과를 유지하는 것만(학습기가 회차마다 고른다). lab metalab2(시점 고친 시뮬 · 실전 후보 거름):
#   한국 하위 40% 빼기 검증 t 2.36→3.14 · 평균 0.81→1.38% · 판정 0.51→0.87%(t 2.24 · 무작위 0.61 → 통과) / 미국은 세 거름 모두 검증 하락 → 안 거름.
#   워커 pbMetaScore 가 같은 식(check-playbook 대조) · rs6 는 어제 순위(daily.rs6).
META_FEATS = ("rsi14", "rsi2", "gap20", "ret5", "ret20", "lvr", "atr", "tr200", "ma50_200", "cpos", "rs6")
META_QS = (0.2, 0.4)
META_MIN_N = 300


def meta_features(P):
    I = CAT._ind(P)
    c = I["c"]
    vr = I["vr"] if I["vr"] is not None else c * np.nan
    F = {"rsi14": I["rsi14"], "rsi2": I["rsi2"], "gap20": c / I["ma20"] - 1, "ret5": I["ret5"], "ret20": I["ret20"],
         "lvr": np.log(vr.clip(0.05, 50)), "atr": I["atr"], "tr200": c / I["ma200"] - 1, "ma50_200": I["ma50"] / I["ma200"] - 1,
         "cpos": I["cpos"], "rs6": PP.rs6(P).shift(1)}
    return [F[k].values for k in META_FEATS]


def meta_fit(X, y):
    mu, sd = X.mean(axis=0), X.std(axis=0) + 1e-9
    Z = (X - mu) / sd
    A = np.c_[np.ones(len(Z)), Z]
    lam = 10.0 * len(Z) / 1000
    beta = np.linalg.solve(A.T @ A + lam * np.diag([0.0] + [1.0] * Z.shape[1]), A.T @ y)
    return mu, sd, beta


def meta_pred(m, X):
    mu, sd, beta = m
    return np.c_[np.ones(len(X)), (X - mu) / sd] @ beta


def meta_filter(P, ddf, t_fit, q, Fm=None):
    """ddf(이미 _relevel) → (거른 ddf, {pb: 수식}) — t < t_fit 행으로 매매법마다 수식을 맞추고 예측이 학습 예측 하위 q 분위 미만인 행을 뺀다."""
    Fm = Fm if Fm is not None else meta_features(P)
    t, j = ddf["t"].values.astype(int), ddf["j"].values.astype(int)
    X = np.column_stack([f[t, j] for f in Fm]).astype(float)
    y = np.clip(ddf["ex"].values.astype(float), -30, 30)
    ok = np.isfinite(X).all(axis=1)
    keep, models = np.ones(len(ddf), dtype=bool), {}
    pbv = ddf["pb"].values
    xe = ddf["x"].values.astype(int) if "x" in ddf else t
    ok &= np.isfinite(y)
    for pb in np.unique(pbv):
        tr = (pbv == pb) & (t < t_fit) & (xe < t_fit) & ok   # 청산까지 t_fit 전에 끝난 거래만 — 학습 라벨이 검증 구간 값을 엿보지 않게
        if tr.sum() < META_MIN_N:
            continue
        m = meta_fit(X[tr], y[tr])
        th = float(np.quantile(meta_pred(m, X[tr]), q))
        al = (pbv == pb) & ok
        keep[np.nonzero(al)[0][meta_pred(m, X[al]) < th]] = False
        models[pb] = {"mu": [round(float(x), 6) for x in m[0]], "sd": [round(float(x), 6) for x in m[1]], "b": [round(float(x), 6) for x in m[2]], "th": round(th, 6), "q": q, "n": int(tr.sum())}
    return ddf[keep], models


def grouped_sig(P, pb, ep_by_g, base_sig):
    """그룹별 진입 미지수를 합친 신호(DataFrame) — ep 가 없는 그룹은 기본 신호."""
    G = P["_grp"]
    out = base_sig[pb].fillna(False).values.astype(bool).copy()
    for g_, ep in ep_by_g.items():
        if ep:
            m = G == int(g_)
            s_ = PP.sig(P, pb, ep)
            out = np.where(m, _lag1(s_) if (LAG_FIX and pb in CROSS_PB) else s_, out)
    return pd.DataFrame(out, index=base_sig[pb].index, columns=base_sig[pb].columns)


def sim_daily(P, market, ev_dates, sig=None, cand=None, pbs=None):
    """도감 매매법이 뜬 모든 (날짜 · 종목 · 매매법) 의 모의 결과 — 표: [t, j, inst, pb, ex, k0..k3]. inst = 같은 후보(날짜·종목)."""
    O, H, L, C = (P[k].values for k in ("open", "high", "low", "close"))
    T, N = C.shape
    reg, mret = _regime(P["close"])
    rsi, gap20, ret5, vr, atr, near = _daily_state(P, ev_dates)
    cost = COST_RT[market]
    mcum = np.concatenate([[1.0], np.cumprod(1 + mret)])
    sig = sig if sig is not None else CAT.signals(P)
    cache = {}
    out = []
    mrx, live_ok = _mr_exit(P), _live_filters(P, reg, atr)
    fm = _flt_masks(P, reg, atr)
    for pb, pr in (pbs or DAILY_PB).items():
        key = _prof_key(pr)
        if key not in cache:
            cache[key] = _sim_profile(O, H, L, C, atr, mcum, pr, cost, mrx=mrx)
        ex, xo = cache[key]
        if pr.get("grp") and P.get("_grp") is not None:   # [V33.664] 그룹별 청산 미지수 — 그 그룹 종목만 그 프로필의 결과로
            Gm = P["_grp"]
            for g_, ov in pr["grp"].items():
                prg = {k_: v_ for k_, v_ in pr.items() if k_ not in ("grp", "ep")}
                prg.update(ov)
                kg = _prof_key(prg)
                if kg not in cache:
                    cache[kg] = _sim_profile(O, H, L, C, atr, mcum, prg, cost, mrx=mrx)
                mg = Gm == int(g_)
                ex, xo = np.where(mg, cache[kg][0], ex), np.where(mg, cache[kg][1], xo)
        S = sig[pb].values & np.isfinite(ex)
        if pb in live_ok:
            S = S & live_ok[pb]
        if pr.get("flt"):
            for _f in str(pr["flt"]).split("+"):   # [V33.619] 자동 조율 거르개 · [V33.620] 2개 조합 "a+b"
                S = S & fm[_f]
        if cand is not None:
            S = S & cand
        ti, jj = np.nonzero(S)
        if len(ti):
            out.append(pd.DataFrame({"t": ti, "j": jj, "x": xo[ti, jj], "pb": pb, "ex": ex[ti, jj]}))
    df = pd.concat(out, ignore_index=True) if out else pd.DataFrame({"t": [], "j": [], "x": [], "pb": [], "ex": []})
    t, j = df["t"].values.astype(int), df["j"].values.astype(int)
    df["inst"] = t.astype(np.int64) * 100000 + j
    df["hd"] = (df["x"].values - t).clip(1, None).astype(np.float32)   # [V33.618] 실제 보유 거래일(하루당 수익 점수용)
    ks = daily_keys(reg[t], rsi[t, j], gap20[t, j], ret5[t, j], vr[t, j], near[t])
    for lv, k in enumerate(ks):
        df["k%d" % lv] = k
    if len(t):   # [V33.710] 더 세심한 칸 — 변동성 그룹(하루 늦춘 값) · 수급 과열 단계(한국 · 하루 늦춘 값)
        _G4 = P.get("_grp")
        _g4 = np.asarray(_G4)[t, j].astype(int).astype(str) if _G4 is not None else np.full(len(t), "x")
        _g4 = np.where(_g4 == "-1", "x", _g4)
        _f4 = flow_bucket(FLOW_RANK[np.clip(t, 0, FLOW_RANK.shape[0] - 1), j]) if FLOW_RANK is not None else np.full(len(t), "x")
        df["k4"] = deep_key(ks[0], _g4, _f4)
    # [V33.694] 종목 칸(규칙을 종목마다) = 중기 국면(M) | 종목 변동성 그룹(하루 늦춘 값 · 워커와 같다)
    M3 = np.asarray(regime3(P["close"])[1]).astype(str)
    G_ = P.get("_grp")
    gv = np.asarray(G_)[t, j].astype(int).astype(str) if G_ is not None and len(t) else np.full(len(t), "x")
    df["cell"] = np.char.add(np.char.add(M3[t], "|"), gv) if len(t) else np.array([], dtype=str)
    return df, str(reg[-1]), sig


def exit_diag(P, market, sig, cand=None, pbs=None):
    """[V33.613] ★진단(기록만 · 판정에 안 씀)★ 매매법마다 지금 손절(% 와 ATR×배수 중 타이트한 쪽) vs '고정 % 손절만'(넓은 쪽)의
    평균 순초과·승률 — 승률 39~41% 가 너무 타이트한 손절 때문인지 본다. 전 기간 · 후보 거른 표본."""
    O, H, L, C = (P[k].values for k in ("open", "high", "low", "close"))
    _r, mret = _regime(P["close"])
    atr = _daily_state(P, [])[4]
    mcum = np.concatenate([[1.0], np.cumprod(1 + mret)])
    cost = COST_RT[market]
    out = {}
    cache = {}
    mrx = _mr_exit(P)
    for pb, pr in (pbs or DAILY_PB).items():
        S = sig[pb].values if pb in sig else None
        if S is None:
            continue
        if cand is not None:
            S = S & cand
        row = {}
        for tag, prof in (("cur", pr), ("wide", dict(pr, atr=99.0))):
            key = _prof_key(prof)
            if key not in cache:
                cache[key] = _sim_profile(O, H, L, C, atr, mcum, prof, cost, mrx=mrx)[0]
            ex = cache[key]
            v = ex[S & np.isfinite(ex)]
            row[tag] = [int(len(v)), round(float(v.mean()), 3) if len(v) else None, round(float((v > 0).mean() * 100), 1) if len(v) else None]
        out[pb] = row
    return out


# ── 5분봉 시뮬(단타) ───────────────────────────────────────────────
TZ_OFF = {"us": -4 * 3600, "kr": 9 * 3600}


def _roll(x, n, fn):
    out = np.full(len(x), np.nan)
    for i in range(n - 1, len(x)):
        out[i] = fn(x[i - n + 1:i + 1])
    return out


def intra_fires(c, h, l, v, ctx=None):
    """오늘 5분봉(첫 봉부터) → 매매법별 '이 봉에서 진입 신호' bool 배열. 워커 pbIntraFires 와 같은 정의(check-playbook 이 대조).
    ctx = {pc 전일 종가, ph 전일 고가, pl 전일 저가} — 갭 메우기 · 피봇(없으면 안 뜬다)."""
    n = len(c)
    F = {k: np.zeros(n, dtype=bool) for k in INTRA_PB}
    if n < 3:
        return F
    if ctx and ctx.get("pc") and ctx["pc"] > 0:
        pc = ctx["pc"]
        if c[0] / pc - 1 <= -0.015:
            i = np.arange(1, min(13, n))
            F["GAP_FILL"][i] = (c[i] > h[0]) & (c[i - 1] <= h[0]) & (c[i] < pc)
        if ctx.get("ph") and ctx.get("pl") and ctx["ph"] > 0 and ctx["pl"] > 0:
            piv = (ctx["ph"] + ctx["pl"] + pc) / 3
            s1 = 2 * piv - ctx["ph"]
            i = np.arange(2, n)
            lo3 = np.minimum(np.minimum(l[i - 2], l[i - 1]), l[i])
            F["PIVOT_BNC"][i] = (lo3 <= s1 * 1.002) & (c[i] > s1) & (c[i] > c[i - 1]) & (c[i] < piv)
    if n > 6:
        orh = np.max(h[:6])
        i = np.arange(6, n)
        F["ORB"][i] = (c[i] > orh) & (c[i - 1] <= orh)
    hmax = np.maximum.accumulate(h)
    i = np.arange(2, n)
    F["DIP_REV"][i] = (c[i] / hmax[i] - 1 <= -0.01) & (c[i] > c[i - 1]) & (c[i - 1] < c[i - 2])
    if n >= 19:
        hh, ll = _roll(h, 14, np.max), _roll(l, 14, np.min)
        rng = hh - ll
        fast = np.where(rng > 0, (c - ll) / np.where(rng > 0, rng, 1) * 100, 50.0)
        fast[np.isnan(hh)] = np.nan
        k = _roll(fast, 3, np.mean)
        d = _roll(k, 3, np.mean)
        i = np.arange(1, n)
        F["STOCH5"][i] = (k[i] > d[i]) & (k[i - 1] <= d[i - 1]) & (k[i - 1] <= 25)
    if n > 3:
        i = np.arange(3, n)
        F["MOM3"][i] = (c[i] > c[i - 1]) & (c[i - 1] > c[i - 2]) & (c[i - 2] > c[i - 3]) & (c[i] / c[i - 3] - 1 >= 0.005)
    if v is not None:
        cv, cs = np.cumsum(c * v), np.cumsum(v)
        vw = np.where(cs > 0, cv / np.where(cs > 0, cs, 1), np.nan)
        i = np.arange(1, n)
        F["VWAP_RE"][i] = (c[i - 1] < vw[i - 1]) & (c[i] > vw[i])
    if ctx and ctx.get("pc") and ctx["pc"] > 0 and c[0] / ctx["pc"] - 1 >= 0.02:   # [V33.651] 갭 앤 고 — 둘째 봉에서만
        F["GAP_GO"][1] = c[1] > h[0]
    return F


def _intra_exit(c, h, l, i, pr, b_end, tp_px=None):
    """i 봉 종가에 사서 — 익절/손절/시간/장 끝 → (청산가, 청산 봉). 같은 봉에서 둘 다 닿으면 손절. tp_px = 가격 목표(갭·피봇)."""
    pe = c[i]
    last = b_end if pr["bars"] == 0 else min(b_end, i + pr["bars"])
    tp = tp_px if (tp_px is not None and tp_px > pe) else pe * (1 + pr["tpPct"] / 100) if pr.get("tpPct") else np.inf
    sl = pe * (1 - pr["sl"] / 100)
    hh, ll = h[i + 1:last + 1], l[i + 1:last + 1]
    xs = np.nonzero(ll <= sl)[0]
    xt = np.nonzero(hh >= tp)[0]
    fs = xs[0] if len(xs) else 10 ** 9
    ft = xt[0] if len(xt) else 10 ** 9
    if fs == 10 ** 9 and ft == 10 ** 9:
        return c[last], last
    return (sl, i + 1 + fs) if fs <= ft else (tp, i + 1 + ft)


def sim_intra(bars5, daily_reg, market, day_key_of=None):
    """bars5: {sym: {t,c,h,l,v}} · daily_reg: {날짜키: 국면}. 단타 매매법이 뜬 모든 봉의 모의 결과 — [day, inst, pb, ex, k0..k3]."""
    cost = COST_RT[market]
    rows = []
    inst = 0
    for si, (s, bd) in enumerate(bars5.items()):
        if not bd or not bd.get("t") or len(bd["t"]) < 500:
            continue
        t = np.asarray(bd["t"], dtype=np.int64)
        if t[0] > 10 ** 11:                         # 밀리초면 초로
            t = t // 1000
        c = np.asarray(bd["c"], dtype=float)
        h = np.asarray(bd.get("h") or bd["c"], dtype=float)
        l = np.asarray(bd.get("l") or bd["c"], dtype=float)
        v = np.asarray(bd["v"], dtype=float) if bd.get("v") and len(bd["v"]) == len(c) else None
        if not (len(h) == len(l) == len(c) == len(t)):
            continue
        day = ((t + TZ_OFF[market]) // 86400).astype(np.int64)
        cut = np.nonzero(np.diff(day))[0] + 1
        starts = np.concatenate([[0], cut])
        ends = np.concatenate([cut, [len(t)]])
        prev_close, closes_d, prev_hl = None, [], (None, None)
        for a, b in zip(starts, ends):
            if b - a < 20:
                prev_close, prev_hl = c[b - 1], (float(np.max(h[a:b])), float(np.min(l[a:b])))
                continue
            dkey = int(pd.Timestamp(int(day[a]) * 86400, unit="s").strftime("%Y%m%d"))
            ma20 = np.mean(closes_d[-20:]) if len(closes_d) >= 20 else None
            closes_d.append(c[b - 1])
            rg = daily_reg.get(dkey)
            if prev_close is None or rg is None:
                prev_close, prev_hl = c[b - 1], (float(np.max(h[a:b])), float(np.min(l[a:b])))
                continue
            up = 1 if (ma20 is not None and prev_close > ma20) else 0
            cc, hh_, ll_ = c[a:b], h[a:b], l[a:b]
            ctx = {"pc": float(prev_close), "ph": prev_hl[0], "pl": prev_hl[1]}
            F = intra_fires(cc, hh_, ll_, v[a:b] if v is not None else None, ctx)
            piv = (prev_hl[0] + prev_hl[1] + prev_close) / 3 if prev_hl[0] else None
            n = b - a
            fired_at = {}
            for pb, arr in F.items():
                for i in np.nonzero(arr[: max(0, n - INTRA_MIN_LEFT)])[0]:
                    fired_at.setdefault(int(i), []).append(pb)
            for i, pbs in fired_at.items():
                pe = cc[i]
                if not (pe > 0):
                    continue
                inst += 1
                for pb in pbs:
                    ta = INTRA_PB[pb].get("tpAt")
                    px, xb = _intra_exit(cc, hh_, ll_, i, INTRA_PB[pb], n - 1, tp_px=prev_close if ta == "pc" else piv if ta == "piv" else None)
                    rows.append((dkey, inst, si, a + i, a + xb, pb, (px / pe - 1) * 100 - cost, rg, (pe / prev_close - 1) * 100, i * 5, up))
            prev_close, prev_hl = c[b - 1], (float(np.max(h[a:b])), float(np.min(l[a:b])))
    if not rows:
        return pd.DataFrame(columns=["day", "inst", "j", "t", "x", "pb", "ex"])
    df = pd.DataFrame(rows, columns=["day", "inst", "j", "t", "x", "pb", "ex", "reg", "daypct", "tod", "up"])
    df["hd"] = ((df["x"] - df["t"]).clip(1, None) / 78.0).astype(np.float32)   # [V33.618] 보유 5분봉 → 거래일
    ks = intra_keys(df["reg"].values, df["daypct"].values, df["tod"].values, df["up"].values)
    for lv, k in enumerate(ks):
        df["k%d" % lv] = k
    return df


# ── 표 만들기 · 검증 ───────────────────────────────────────────────
def _decay_w(df, decay, tcol, ref):
    """[V33.620] 최근 가중 — 날짜 순위(tcol 고유값 순서) 기준 반감기 decay 거래일. ref = 기준 날짜(그 순위가 나이 0)."""
    if not decay or tcol not in df.columns or not len(df):
        return None
    u = np.sort(df[tcol].unique())
    rk = np.searchsorted(u, df[tcol].values)
    r0 = np.searchsorted(u, ref) if ref is not None else len(u)
    return np.power(0.5, np.maximum(0, r0 - rk) / float(decay)).astype(np.float64)


def _shrunk_table(df, decay=None, tcol="t", ref=None):
    """열쇠 4단 × 매매법 → (n, 성공확률, 평균, 하한). 넓은 칸부터 내려가며 수축한다:
    k0 = '*' · k1 = 국면 · k2 = 국면+2조건 · k3 = 전체 조건. 구체 칸은 표본이 적을수록 부모 칸 값에 가깝다.
    [V33.609] 하한(lcb) = 수축 평균 − 표준오차(표준편차/√(n+k)) — 표본 적은 칸이 우연히 높게 나온 것을 고르지 않게(승자의 저주)."""
    if "hd" not in df.columns:
        df = df.assign(hd=1.0)
    w = _decay_w(df, decay, tcol, ref)
    if w is None:
        df = df.assign(win=(df["ex"] > 0).astype(np.float32), ex2=df["ex"].astype(float) ** 2)
    else:   # [V33.620] 가중 합 — n 은 유효 표본 수(가중치 합)
        exv = df["ex"].values.astype(float)
        df = df.assign(ex=exv * w, ex2=exv ** 2 * w, win=(exv > 0) * w, hd=df["hd"].values * w, _w=w)
    tab = {}

    def put(key, n, s, s2, w, hs, pw, pm, ph):
        n = float(n)
        if n <= 1e-9:
            return
        m = (s + K_SHRINK * pm) / (n + K_SHRINK)
        var = max(0.0, s2 / n - (s / n) ** 2) if n > 1 else 9.0
        lcb = m - math.sqrt(var / (n + K_SHRINK))
        hd = (hs + K_SHRINK * ph) / (n + K_SHRINK)   # 평균 보유 거래일(수축)
        tab[key] = (int(round(n)), float((w + K_SHRINK * pw) / (n + K_SHRINK)), float(m), float(lcb), float(max(hd, 0.05)))

    nagg = ("_w", "sum") if w is not None else ("ex", "size")
    g0 = df.groupby("pb").agg(n=nagg, s=("ex", "sum"), s2=("ex2", "sum"), w=("win", "sum"), h=("hd", "sum"))
    for pb, r in g0.iterrows():
        put(("*", pb), r["n"], r["s"], r["s2"], r["w"], r["h"], 0.5, 0.0, r["h"] / max(1.0, r["n"]))
    for lv, plv in ((1, 0), (2, 1), (3, 2)) + (((4, 3),) if "k4" in df.columns else ()):   # [V33.710] k4 = 더 세심한 칸
        col, pcol = "k%d" % lv, "k%d" % plv
        g = df.groupby([col, pcol, "pb"]).agg(n=nagg, s=("ex", "sum"), s2=("ex2", "sum"), w=("win", "sum"), h=("hd", "sum")).reset_index()
        for r in g.itertuples(index=False):
            k, pk, pb, n, s_, s2, w, h = r
            par = tab.get((pk, pb))
            pw, pm, ph = (par[1], par[2], par[4]) if par else (0.5, 0.0, h / max(1.0, n))
            put((k, pb), n, s_, s2, w, h, pw, pm, ph)
    return tab


# [V33.609] 선택 규칙 후보(미리 고정) — 검증 구간에서 하나를 고르고, 판정은 손대지 않은 마지막 구간에서만 한다.
#   score: 'm' 평균 · 'lcb' 하한 / level: 'fine' 전체 칸 · 'regime' 국면 칸까지만 · 'global' 매매법 전체 성적만
#   [V33.618] 승률 50% 조건 삭제(사용자 결정) — 기대값만 본다. 'mpd'·'lcbpd' = 하루당 평균·하한(보유 기간이 긴 매매법이 한 거래 평균만으로 유리하지 않게).
RULES = [{"score": "m", "level": "fine"}, {"score": "lcb", "level": "fine"}, {"score": "lcb", "level": "regime"}, {"score": "lcb", "level": "global"},
         {"score": "mpd", "level": "fine"}, {"score": "lcbpd", "level": "regime"}]
# [V33.620] ★국면 변화 적응★ — 사용자 10/15 "승률 조건 복원·국면 칸 말고 다른 해결책". V33.618·619 판정 구간에서 고른 것이 듀얼 모멘텀에 쏠려
#   (앞 구간 성적 → 최근 약세·폭락에서 꺾임) 무작위보다 못했다. 두 장치를 규칙 후보로 더한다(검증 구간이 고르고 판정 구간이 말한다):
#   decay = 표 표본을 최근 가중(반감기 거래일) — 오래된 국면의 성적이 지금 선택을 끌고 가지 않게.
#   gate  = 매매법 최근 성적 스위치 — 그 매매법의 최근 gate 거래일 동안 끝난 모의 거래 평균이 0 아래(표본 ≥ GATE_MIN)면 쉰다.
GATE_MIN = 15
RULES_ADAPT = [{"score": "lcb", "level": "fine", "decay": 120}, {"score": "lcb", "level": "global", "gate": 40},
               {"score": "lcb", "level": "fine", "decay": 120, "gate": 40}, {"score": "lcbpd", "level": "regime", "decay": 120, "gate": 40},
               {"score": "m", "level": "fine", "decay": 60, "gate": 20}]
# [V33.642] 전체 칸 거부권 규칙 후보 — 매매법 자체의 전체 평균(수축) ≤ 0 이면 안 고른다. 쓸지 말지는 검증 구간 t 가 정한다.
RULES_GV = [{"score": "m", "level": "fine", "gveto": True}, {"score": "lcb", "level": "fine", "gveto": True},
            {"score": "lcb", "level": "global", "gate": 40, "gveto": True}, {"score": "lcb", "level": "fine", "decay": 120, "gate": 40, "gveto": True}]

# [V33.704] ★수급 과열 제외 규칙 후보(한국만)★ — 사용자 10/29 "수급 데이터부터 넣어서 한국장 성능". fveto = 지난 20일 (외국인+기관)/거래량
#   횡단면 백분위(하루 늦춤)가 이보다 높은 후보는 고르지 않는다. 쓸지 말지는 다른 규칙과 똑같이 검증 구간 [60,80%) 이 정한다(판정 구간 안 봄).
#   실험실(flow_kr.py 머리말): 이미 몰린 종목은 다음 20일 덜 오른다(2016~2024 연 +0.3~+1.0%p).
FLOW_ON = os.environ.get("PB_FLOW", "1") != "0"
FLOW_RANK = None   # run() 이 한국 회차에 채운다(t×j) · 미국·5분봉은 None
FLOW_VETO = 0.9
RULES_FLOW = [{"score": "m", "level": "fine", "fveto": FLOW_VETO}, {"score": "lcb", "level": "fine", "fveto": FLOW_VETO},
              {"score": "lcb", "level": "fine", "decay": 120, "gate": 40, "fveto": FLOW_VETO}, {"score": "m", "level": "fine", "gveto": True, "fveto": FLOW_VETO}]


# [V33.710] ★더 세심한 칸 규칙 후보(일봉)★ — 사용자 10/29 "매매법 고르기에 더 많은 조건 · 단 아무것도 못 고르는 일은 없게".
#   deep = k4(세부 칸 + 변동성 그룹 + 수급 과열 단계) → 표본 적으면 수축으로 부모 칸 값 → 비면 세부·국면·전체 순으로 내려간다(빈 칸 때문에 못 고르는 일 없음).
#   쓸지 말지는 다른 규칙과 똑같이 검증 구간이 정한다(운 수준 K 에 포함).
RULES_DEEP = [{"score": "m", "level": "deep"}, {"score": "lcb", "level": "deep"}]


def score_of(v, score):
    """표 값 (n, w, m, lcb, hd) → 규칙 점수. 워커 pbChoose 와 같은 식."""
    m, lcb, hd = v[2], v[3], max(v[4] if len(v) > 4 else 1.0, 0.05)
    return m if score == "m" else lcb if score == "lcb" else m / hd if score == "mpd" else lcb / hd
LEVEL_COLS = {"deep": ("k4", "k3", "k2", "k1", "k0"), "fine": ("k3", "k2", "k1", "k0"), "regime": ("k1", "k0"), "global": ("k0",)}
SPLIT = (0.60, 0.80)   # 표 [0,60%) → 규칙 고르기 [60,80%) → 표 [0,80%) → 판정 [80,100%)


def lookup(tab, keys, pb):
    """그 매매법이 있는 가장 구체적인 칸의 값(이미 넓은 칸 쪽으로 수축됨) → (n, w, m, lcb) | None. 워커 pbChoose 와 같은 규칙."""
    for k in keys:
        v = tab.get((k, pb))
        if v is not None:
            return v
    return None


# [V33.624] ★국면 거부권★ — 10/15 학습 실측: 고른 규칙이 판정 구간(최근)에서 미 −0.82% · 한 −1.96%(무작위 −0.28 · −0.56%)로 무너졌다.
#   진단(판정 구간 ★전★ 역사)에서 추세·모멘텀 매매법 거의 전부가 BULL·NEUTRAL 에선 벌고 CRASH·SURGE 에선 −2~−6% 였는데,
#   'lcb · global' 규칙은 국면을 안 봐 한국 폭락장(5일 −16.8%)에서도 듀얼 모멘텀을 샀다. 검증 구간은 국면 교체를 미리 못 본다 —
#   그래서 규칙과 상관없이 ★그 매매법의 지금 국면 칸(수축 평균) 이 0 아래면 고르지 않는다★(표본 REGIME_VETO_N 이상일 때).
REGIME_VETO_N = 30


def _regime_ok(v):
    return v is None or v[0] < REGIME_VETO_N or v[2] >= 0


# [V33.642] ★전체 칸 거부권★ — 10년 실측(판정 구간 = 마지막 45%): 앞 55% 의 매매법 평균 부호가 뒤 45% 부호와 한국 30/31 · 미국 27/31 일치.
#   한국은 앞 구간 양수 매매법만 쓰면 뒤 구간 평균 +1.08%/거래(전체 −0.07%). 칸(국면·세부)이 양수여도 매매법 자체가 음수면 고르지 않는다.
GLOBAL_VETO = False   # 전역 강제는 끔 — 규칙 후보(gveto)로만 쓰고 검증 구간이 고른다(10년: 한 +1.04→+0.98 · 미 +0.09→+0.29 — 시장마다 다르다)
GLOBAL_VETO_N = 100


def _global_ok(v):
    return v is not None and (v[0] < GLOBAL_VETO_N or v[2] > 0)


def choose(tab, keys, fired, score="m"):
    """뜬 매매법들 중 점수 > 0 이고 점수가 가장 큰 것 → (pb, n, w, m, lcb, hd) | None. [V33.618] 승률 조건 없음 · [V33.624] 국면 거부권(keys[-2] = 국면 칸)."""
    best, bs = None, None
    for pb in fired:
        if len(keys) >= 2 and not _regime_ok(tab.get((keys[-2], pb))):
            continue
        if GLOBAL_VETO and keys and not _global_ok(tab.get((keys[-1], pb))):   # [V33.642]
            continue
        v = lookup(tab, keys, pb)
        if v is None:
            continue
        sc = score_of(v, score)
        if sc > 0 and (bs is None or sc > bs):
            best, bs = (pb,) + tuple(v), sc
    return best


def _row_vals(tab, df, rule):
    """행마다 lookup(그 규칙의 칸 단계) 의 (w, 점수) — 벡터화."""
    w = np.full(len(df), np.nan)
    sc = np.full(len(df), np.nan)
    for col in LEVEL_COLS[rule["level"]]:
        need = np.isnan(sc)
        if not need.any():
            break
        got = [tab.get(k) for k in zip(df[col].values[need], df["pb"].values[need])]
        idx = np.nonzero(need)[0]
        sc[idx] = np.array([score_of(g, rule["score"]) if g else np.nan for g in got])
        w[idx] = np.array([g[1] if g else np.nan for g in got])
    return w, sc


def _gate_ok(hist, te, G):
    """[V33.620] te 행마다 — 그 매매법의 (t−G, t) 에 끝난(x < t) 모의 거래 평균 ≥ 0 이거나 표본 < GATE_MIN 이면 True. hist = 끝난 거래 출처(같은 시뮬 표)."""
    ok = np.ones(len(te), dtype=bool)
    tv, pv = te["t"].values, te["pb"].values
    for pb in np.unique(pv):
        h = hist[hist["pb"] == pb]
        if not len(h):
            continue
        o = np.argsort(h["x"].values, kind="stable")
        xs, cs = h["x"].values[o], np.concatenate([[0.0], np.cumsum(h["ex"].values[o].astype(float))])
        m = pv == pb
        t = tv[m]
        lo, hi = np.searchsorted(xs, t - G, "left"), np.searchsorted(xs, t, "left")
        n = hi - lo
        mean = (cs[hi] - cs[lo]) / np.maximum(n, 1)
        ok[np.nonzero(m)[0]] = (n < GATE_MIN) | (mean >= 0)
    return ok


def gate_now(df, G, t_now):
    """[V33.620] 실전용 — 매매법별 (t_now−G, t_now] 에 끝난 모의 거래 [n, 평균]."""
    out = {}
    for pb, h in df[(df["x"] > t_now - G) & (df["x"] <= t_now)].groupby("pb"):
        out[pb] = [int(len(h)), round(float(h["ex"].mean()), 3)]
    return out


def _rule_rows(tab, te, rule):
    """행마다 (점수, 고를 수 있나). [V33.694] rule.cells 면 ★종목 칸(cell)마다 그 칸의 규칙★ — 사용자 10/28 '규칙을 오늘 하나로 정하지 말고 종목마다'."""
    if rule.get("cells") and "cell" in te.columns and len(te):
        sc = np.full(len(te), np.nan); ok = np.zeros(len(te), dtype=bool)
        cv = te["cell"].values.astype(str)
        subs = {}
        for c in np.unique(cv):
            sub = rule["cells"].get(c) or rule["def"]
            subs.setdefault(json.dumps(sub, sort_keys=True), (sub, []))[1].append(c)
        for sub, cs in subs.values():
            m = np.isin(cv, cs)
            s_, o_ = _rule_rows(tab, te[m], sub)
            sc[m], ok[m] = s_, o_
        return sc, ok
    w, sc = _row_vals(tab, te, rule)
    ok = sc > 0   # [V33.618] 승률 50% 조건 삭제
    if len(te) and "k1" in te.columns:   # [V33.624] 국면 거부권 — k1 = 국면 칸(정리 뒤)
        ok = ok & np.array([_regime_ok(tab.get(k)) for k in zip(te["k1"].values, te["pb"].values)], dtype=bool)
    if rule.get("fveto") and FLOW_RANK is not None and len(te) and "j" in te.columns:   # [V33.704] 수급 과열 제외(값 없으면 거르지 않음)
        fr = FLOW_RANK[np.clip(te["t"].values.astype(int), 0, FLOW_RANK.shape[0] - 1), te["j"].values.astype(int)]
        ok = ok & ~(np.nan_to_num(fr, nan=0.0) > float(rule["fveto"]))
    if (GLOBAL_VETO or rule.get("gveto")) and len(te) and "k0" in te.columns:   # [V33.642] 전체 칸 거부권 — 그 매매법의 전체 평균(수축)이 0 이하면 고르지 않는다
        ok = ok & np.array([_global_ok(tab.get(k)) for k in zip(te["k0"].values, te["pb"].values)], dtype=bool)
    return sc, ok


# [V33.694] ★규칙을 종목 칸마다★ — 칸 = 중기 국면(상승·보합·하락) × 종목 변동성 그룹(3분위). 칸마다 규칙을 고르는 일은 [40,60%) 에서만(표 [0,40%)) —
#   그래야 [60,80%) 검증 구간에서 '칸별 규칙' 도 다른 규칙 후보와 같은 조건으로 겨룬다(고른 곳에서 다시 재지 않는다). 칸 표본 < CELL_MIN 이면 기본 규칙.
CELL_ON = os.environ.get("PB_CELL", "0") == "1"   # 실험실 A/B 확인 전엔 꺼 둔다
CELL_MIN = 30
CELL_FIT = 0.40


def _fit_cells(df, ts, c1, log=None):
    c0 = ts[int(len(ts) * CELL_FIT)]
    tabA = _shrunk_table(df[df["t"] < c0], tcol="t", ref=c0)
    vA = df[(df["t"] >= c0) & (df["t"] < c1)]
    subs = [r for r in RULES + RULES_GV if not r.get("gate") and not r.get("decay")]
    res = []
    for r in subs:
        pk = _pick(tabA, vA, r)
        if not len(pk):
            continue
        g = pk.groupby("cell")["ex"].agg(["mean", "size"])
        res.append((r, float(pk["ex"].mean()), int(len(pk)), g))
    res = [x for x in res if x[2] >= VAL_MIN_N]
    if not res:
        return None
    dflt = max(res, key=lambda x: x[1])
    cells = {}
    for c in sorted(set().union(*[set(x[3].index) for x in res])):
        cand = [(x[0], float(x[3].loc[c, "mean"])) for x in res if c in x[3].index and x[3].loc[c, "size"] >= CELL_MIN]
        if not cand:
            continue
        best = max(cand, key=lambda y: y[1])
        d0 = next((y[1] for y in cand if y[0] == dflt[0]), None)
        if best[0] != dflt[0] and (d0 is None or best[1] > d0):
            cells[c] = best[0]
    if not cells:
        return None
    return {"score": dflt[0]["score"], "level": dflt[0]["level"], "gveto": bool(dflt[0].get("gveto")), "def": dflt[0], "cells": cells}


def _pick(tab, te, rule, hist=None):
    """후보(inst)마다 뜬 매매법 중 규칙이 고른 것 · 같은 종목은 앞 거래가 끝나야 다시 산다(실전과 같다).
    [V33.620] rule.gate 면 최근 성적 스위치(hist 의 끝난 거래)로 쉬는 매매법을 먼저 뺀다."""
    if rule.get("gate") and hist is not None and "x" in te.columns and len(te):
        te = te[_gate_ok(hist, te, rule["gate"])]
    sc, ok = _rule_rows(tab, te, rule)
    sel = te.assign(_s=sc)[ok].sort_values("_s", ascending=False).drop_duplicates("inst")
    if CAND_RANK is not None and RANK_MODE == "omq" and CAP.get("daily") and len(sel):   # [V33.684] 일봉(거래일 축)만 — 5분봉 t 는 봉 번호라 순위표(거래일×종목) 밖(실측: index 4137 / 2600 → 시뮬 전체 실패)   # [V33.682] 상한이 찰 때 같은 날 안 순서 = OMNI-Q 순위(검증된 횡단면 실력) → 같으면 표 점수
        sel = sel.assign(_o=CAND_RANK[sel["t"].values.astype(int), sel["j"].values.astype(int)]).sort_values(["_o", "_s"], ascending=False)
    sel = sel.sort_values("t", kind="mergesort")   # 같은 날 안은 위 순서 그대로(상한이 있으면 앞에서부터 산다)
    return _nonoverlap(sel)


BASE_DRAWS = 30   # [V33.613] 공정한 '아무거나' — 후보마다 뜬 매매법 중 무작위 하나 · 같은 겹침 규칙 · 30번 평균


CAND_RANK = None   # [실험] t×j OMNI-Q 그날 백분위(하루 늦춤) — run() 의 후보 고르기가 설정마다 채운다
RANK_MODE = os.environ.get("PB_RANK", "omq")   # [V33.682] 상한이 찰 때 같은 날 순서 = OMNI-Q 순위(워커도 같은 순서로 산다) · 끄기 PB_RANK=score
CAP = {"on": False, "day": 6, "open": 12}   # [V33.675] 실전 상한(주력 PB_PRIMARY_CAPS 하루 6 · 동시 min(12, 시장 상한)) — validate(일봉)가 켠다


def _nonoverlap(sel):
    """같은 종목은 앞 거래가 끝나야 다시 산다. [V33.675] CAP.on 이면 실전처럼 하루 신규 ≤ CAP.day · 동시 보유 ≤ CAP.open(들어온 순서대로 — _pick 은 점수 순, 무작위는 무작위 순).
    종전 시뮬은 뜬 신호를 전부 사서, 실전(상한 때문에 일부만 삼)과 다른 표본을 판정했다."""
    keep, busy = [], {}
    cap = CAP["on"]
    opn, day_t, day_n = [], None, 0
    for r in sel[["j", "t", "x"]].itertuples(index=True):
        if busy.get(r.j, -1) >= r.t:
            continue
        if cap:
            if r.t != day_t:
                day_t, day_n = r.t, 0
                opn = [x for x in opn if x >= r.t]
            if day_n >= CAP["day"] or len(opn) >= CAP["open"]:
                continue
            day_n += 1
            opn.append(r.x)
        keep.append(r.Index)
        busy[r.j] = r.x
    return sel.loc[keep]


def fair_base(te, draws=BASE_DRAWS, seed=11):
    """[V33.613] 고른 것과 같은 조건의 기준선: 후보(inst)마다 뜬 매매법 중 ★무작위 하나★ → 같은 종목 겹침 제외 → 평균.
    (V33.609~612 의 '아무거나' 는 겹친 거래까지 전부 평균이라, 추세 종목이 연일 신호를 내면 여러 번 세어 기준이 부풀었다.)"""
    if not len(te):
        return None, None
    rng = np.random.default_rng(seed)
    ms, ns = [], []
    for _ in range(draws):
        sh = te.assign(_r=rng.random(len(te))).sort_values("_r").drop_duplicates("inst").sort_values("t", kind="mergesort")   # 같은 날 안은 무작위 순
        pk = _nonoverlap(sh)["ex"].values.astype(float)
        if len(pk):
            ms.append(pk.mean()); ns.append(len(pk))
    return (round(float(np.mean(ms)), 4) if ms else None), (int(np.mean(ns)) if ns else None)


# [V33.674] ★월 맞춤 초과 기준★ — 거래 하나하나를 독립 표본으로 센 t 는 같은 날·같은 달 거래가 함께 움직여 크게 부풀고(실측: 미국 검증 2.68 → 월 묶음 0.91),
#   무작위 기준선을 판정 구간 전체로 잡으면 '어느 달(국면)에 샀나' 가 실력처럼 섞인다(폭등 달을 덜 사면 진다). 그래서
#   같은 달 후보 안의 무작위와 비교한 초과(x_m = 고른 평균 − 그 달 무작위)를 달마다 구하고, 그 달들의 t 로 판단한다 — 국면 이름표 없이 국면을 맞춘다.
TIME_MONTH = None   # run() 이 시장마다 채운다: t(거래일 번호) → yyyymm
TIME_REG = None     # t → 국면(SURGE·BULL·NEUTRAL·BEAR·CRASH) — 화면 국면별 표시용
TIME_MCUM = None    # [V33.694] 등가중 시장 누적(1 + 0번 앞) — 거래 실제 수익(raw) = 초과(ex) + 그 보유 기간 시장 + 비용
TIME_COST = 0.0


def _raw(d):
    """[V33.694] 거래의 ★실제 수익 %★ — ex 는 '같은 기간 시장(등가중) 을 뺀 초과' 라 상승장에서 작게 보인다(사용자 10/28 '폭락에서만 번다' 의 오해 원인)."""
    if TIME_MCUM is None or not len(d):
        return np.zeros(len(d))
    t = d["t"].values.astype(int); x = np.clip(d["x"].values.astype(int), t, len(TIME_MCUM) - 2)
    return d["ex"].values + (TIME_MCUM[x + 1] / TIME_MCUM[t + 1] - 1) * 100 + TIME_COST
MATCH_MIN = 3       # 그 달 고른 거래가 이보다 적으면 그 달은 비교에서 뺀다
PB_SEL = os.environ.get("PB_SEL", "m")   # [V33.675] 고르기도 판정과 같은 잣대(월 맞춤 초과의 달 묶음 t)
PASS_MODE = os.environ.get("PB_PASS", "matched")   # [V33.674] 사용자 10/26 (나) — 판정 = 월 맞춤 초과(주력 자격) · 종전 거래 t 판정은 passTrade 로 남아 시험 매수를 연다
PASS_MT = float(os.environ.get("PB_PASS_MT", "2.0"))
REG_KO = {"SURGE": "폭등", "BULL": "상승", "NEUTRAL": "보합", "BEAR": "하락", "CRASH": "폭락"}


def _month_base(w):
    """창 w 의 달마다 공정 무작위 기준선(달 안 후보에서만 뽑는다)."""
    if TIME_MONTH is None or not len(w):
        return {}
    mo = TIME_MONTH[w["t"].values.astype(int)]
    return {int(m): fair_base(w[mo == m], draws=10)[0] for m in np.unique(mo)}


def _matched(pk, mb, per=None):
    """고른 거래 pk 의 달마다 초과 = 고른 평균 − 같은 달 무작위 → {mx: 거래 가중 초과, mT: 달 묶음 t, mWin/mN: 이긴 달/달 수, mAbsT: 달 묶음 절대 t}.
    per = 묶음 배열(기본 달 · 전진 구간은 주)."""
    per = TIME_MONTH if per is None else per
    if per is None or not len(pk) or not mb:
        return {}
    mo = per[pk["t"].values.astype(int)]
    ex = pk["ex"].values.astype(float)
    xs, ws, ps = [], [], []
    for m in np.unique(mo):
        sel = mo == m
        if sel.sum() < MATCH_MIN or mb.get(int(m)) is None:
            continue
        xs.append(ex[sel].mean() - mb[int(m)]); ws.append(sel.sum()); ps.append(ex[sel].mean())
    if len(xs) < 3:
        return {"mN": len(xs)}
    xs, ws, ps = np.array(xs), np.array(ws, float), np.array(ps)
    tt = lambda v: float(v.mean() / (v.std(ddof=1) / math.sqrt(len(v)))) if v.std(ddof=1) > 0 else 0.0
    return {"mx": round(float((xs * ws).sum() / ws.sum()), 4), "mT": round(tt(xs), 2), "mWin": int((xs > 0).sum()), "mN": int(len(xs)), "mAbsT": round(tt(ps), 2)}



REG_GATE_N = 20   # [V33.701] 국면 게이트(사전 등록): 검증 구간 [60,80%) 에서 고른 규칙의 그 국면 거래당 실제 수익 평균 ≤ 0 · 표본 ≥ 20 → 그 국면에선 매매법 AI 신규 매수 쉼


def _reg_gate(pkV, pkH):
    """[V33.701] 사용자 10/29 "성적 안 나오는 것 구조적으로 해결" — 손실 국면에서 쉬기.
    고르기 = 검증 구간만(pkV) · 판정 구간(pkH)은 결과 보고만(게이트 전/후 거래당 실제 수익). 판정(pass)은 바꾸지 않는다."""
    if TIME_REG is None or not len(pkV):
        return None
    rv, rawV = TIME_REG[pkV["t"].values.astype(int)], _raw(pkV)
    v, off = {}, []
    for r in ("SURGE", "BULL", "NEUTRAL", "BEAR", "CRASH"):
        m = rv == r
        n = int(m.sum())
        mu = round(float(rawV[m].mean()), 3) if n else None
        v[r] = {"n": n, "mean": mu}
        if n >= REG_GATE_N and mu is not None and mu <= 0:
            off.append(r)
    out = {"off": off, "v": v, "nmin": REG_GATE_N}
    if len(pkH):
        rh, rawH = TIME_REG[pkH["t"].values.astype(int)], _raw(pkH)
        keep = ~np.isin(rh, off)
        out["ho"] = {"all": {"n": int(len(rawH)), "mean": round(float(rawH.mean()), 3)},
                     "gated": {"n": int(keep.sum()), "mean": round(float(rawH[keep].mean()), 3) if keep.any() else None},
                     "off": {"n": int((~keep).sum()), "mean": round(float(rawH[~keep].mean()), 3) if (~keep).any() else None}}
    return out

def _by_regime(pk, w):
    """국면 5종(폭등·상승·보합·하락·폭락)별 고른 평균 vs 같은 국면 무작위 — 기록·화면용(판정엔 안 쓴다)."""
    if TIME_REG is None or not len(pk):
        return []
    rp, rw = TIME_REG[pk["t"].values.astype(int)], TIME_REG[w["t"].values.astype(int)]
    out = []
    for r in ("SURGE", "BULL", "NEUTRAL", "BEAR", "CRASH"):
        g = pk[rp == r]
        if len(g) < 10:   # [V33.698] 사용자 10/28 "미국은 폭등이 없다" — 정의는 같고 표본만 적다 → 숨기지 않고 '표본 부족' 으로 보낸다
            out.append({"reg": r, "ko": REG_KO[r], "n": int(len(g)), "thin": True,
                        "dayShare": round(len(np.unique(w["t"].values[rw == r])) / max(1, w["t"].nunique()) * 100, 1)})
            continue
        b_ = fair_base(w[rw == r], draws=10)[0]
        rw_ = _raw(w[rw == r])
        out.append({"reg": r, "ko": REG_KO[r], "n": int(len(g)), "mean": round(float(g["ex"].mean()), 3), "base": b_,
                    "raw": round(float(_raw(g).mean()), 3), "rawAll": round(float(rw_.mean()), 3) if len(rw_) else None,   # [V33.694] 실제 수익(고른 · 후보 전체)
                    "hd": round(float(g["hd"].mean()), 1) if "hd" in g else None,
                    "share": round(len(g) / len(pk) * 100, 1), "dayShare": round(len(np.unique(w["t"].values[rw == r])) / max(1, w["t"].nunique()) * 100, 1)})
    return out


CAP_ON = os.environ.get("PB_CAP", "1") != "0"
CAP_OPEN_MK = {"us": 10, "kr": 8}   # 워커 maxOpenPositions(추세) — 주력 maxOpen 12 보다 작으면 이것이 실제 상한
# [V33.675] ★전진 구간(동결)★ — 이 날짜 이후 시세는 어떤 설계 결정에도 쓰이지 않았다(10/26 사용자 지시 시점에 동결 · 사전 등록).
#   주력 전환 = 판정 통과 + 전진 구간 통과(거래일 ≥ FWD_MIN_DAYS · 거래 ≥ 30 · 같은 주 무작위 대비 초과 > 0 · 주 묶음 t ≥ 2).
#   판정 구간은 여러 번 열어 본 탓에 '손대지 않은 표본' 이 아니게 됐다 — 전진 구간만이 아무도 본 적 없는 표본이다.
FWD_START = int(os.environ.get("PB_FWD_START", "20261027"))
FWD_MIN_DAYS = 60
TIME_DATE = None   # t → yyyymmdd
TIME_WEEK = None   # t → 주 번호(전진 구간은 달이 적어 주로 묶는다)


def _ser_base(w, per):
    if per is None or not len(w):
        return {}
    pv = per[w["t"].values.astype(int)]
    return {int(m): fair_base(w[pv == m], draws=10)[0] for m in np.unique(pv)}


def _forward(pk, ho):
    """전진 구간(TIME_DATE ≥ FWD_START) — 고른 거래 vs 같은 주 무작위 · 주 묶음 t · 통과 여부(사전 등록 규칙)."""
    if TIME_DATE is None:
        return None
    fh = ho[TIME_DATE[ho["t"].values.astype(int)] >= FWD_START]
    days = int(fh["t"].nunique()) if len(fh) else 0
    out = {"start": FWD_START, "days": days, "needDays": FWD_MIN_DAYS, "n": 0, "ok": False}
    if not days:
        return out
    fp = pk[TIME_DATE[pk["t"].values.astype(int)] >= FWD_START]
    out["n"] = int(len(fp))
    if len(fp):
        out["mean"] = round(float(fp["ex"].mean()), 4)
        out["base"] = fair_base(fh)[0]
    m = _matched(fp, _ser_base(fh, TIME_WEEK), per=TIME_WEEK)
    out.update({"wx": m.get("mx"), "wT": m.get("mT"), "wWin": m.get("mWin"), "wN": m.get("mN")})
    out["ok"] = bool(days >= FWD_MIN_DAYS and out["n"] >= 30 and (out.get("wx") or 0) > 0 and (out.get("wT") or 0) >= 2)
    return out


# [V33.675] ★고르기 운 보정★ — 후보 설정 × 규칙 K 개 중 최고는 실력이 없어도 높게 나온다. 귀무(실력 0)에서 K 개 최대값의 기대 ≈
#   √(2lnK) − (ln lnK + ln4π) / (2√(2lnK))  (Bailey·López de Prado 'Deflated Sharpe' 의 근사). 검증에서 고른 1등이 이 '운 수준' 을 못 넘으면
#   1등을 믿지 않고 사전에 정한 기본 설정(5일 머리 상위 20% · 그 안 규칙 고르기)으로 간다 — 회차마다 1등이 바뀌며 판정이 출렁이는 것(한국 1.32→0.23)을 줄인다.
def luck_level(K):
    if K < 2:
        return 0.0
    a = math.sqrt(2 * math.log(K))
    return round(a - (math.log(math.log(K)) + math.log(4 * math.pi)) / (2 * a), 2) if K > 2 else round(a, 2)


CV2 = os.environ.get("PB_CV", "0") == "1"
CV_A = 0.40
SEL_KEY = "cvT" if CV2 else {"ex": "exT", "m": "mT"}.get(PB_SEL, "t")   # [실험] 검증 고르기 기준: 절대 t · 무작위 대비 초과 t · 두 접기 평균 t


def _ex_t(pk, b):
    """무작위 기준(b) 대비 초과 t = (평균 − b) ÷ 표준오차 — 판정 기준(평균 > 무작위)과 같은 잣대."""
    n = len(pk)
    if n < 3 or b is None or not pk.std() > 0:
        return 0.0
    return round(float((pk.mean() - b) / (pk.std(ddof=1) / math.sqrt(n))), 2)


def _stats(pk, base):
    n = len(pk)
    return {"n": int(n), "mean": round(float(pk.mean()), 4) if n else None, "win": round(float((pk > 0).mean() * 100), 1) if n else None,
            "t": round(float(pk.mean() / (pk.std(ddof=1) / math.sqrt(n))), 2) if n > 2 and pk.std() > 0 else 0.0,
            "base": round(float(base.mean()), 4) if len(base) else None}


def validate(df, timecol, pbs=None):
    CAP["on"] = bool(CAP_ON and timecol == "t")
    CAP["daily"] = timecol == "t"
    try:
        return _validate(df, timecol, pbs)
    finally:
        CAP["on"] = False


def _validate(df, timecol, pbs=None):
    """3구간: 표 [0,60%) → 규칙 후보 4개를 [60,80%) 에서 비교해 하나 고름 → 표 [0,80%) → 손대지 않은 [80,100%) 에서만 판정."""
    ts = np.sort(df[timecol].unique())
    if len(ts) < 30:
        return {"pass": False, "why": "기간 부족"}, None
    c1, c2 = ts[int(len(ts) * SPLIT[0])], ts[int(len(ts) * SPLIT[1])]
    rules = RULES + (RULES_ADAPT + RULES_GV if timecol == "t" else [])   # 최근 가중·성적 스위치는 일봉(거래일 축)만
    if timecol == "t" and FLOW_RANK is not None:
        rules = rules + RULES_FLOW   # [V33.704] 한국 수급 과열 제외 후보
    if timecol == "t" and "k4" in df.columns:
        rules = rules + RULES_DEEP   # [V33.710] 더 세심한 칸
    if CELL_ON and timecol == "t" and "cell" in df.columns:
        try:
            rc_ = _fit_cells(df, ts, c1)
            if rc_:
                rules = rules + [rc_]
        except Exception as e:  # noqa: BLE001
            print("   ⚠️ [매매법시뮬] 칸별 규칙 실패 %s" % e)
    tabs1 = {}
    va = df[(df[timecol] >= c1) & (df[timecol] < c2)]
    if CV2:
        c0 = ts[int(len(ts) * CV_A)]
        vA = df[(df[timecol] >= c0) & (df[timecol] < c1)]
    cmp_ = []
    vbase, _vn = fair_base(va)
    vmb = _month_base(va) if timecol == "t" else {}
    for rule in rules:
        dk = rule.get("decay")
        if dk not in tabs1:
            tabs1[dk] = _shrunk_table(df[df[timecol] < c1], decay=dk, tcol=timecol, ref=c1)
        tab1 = tabs1[dk]
        pk = _pick(tab1, va, rule, hist=df)
        st_ = _stats(pk["ex"].values.astype(float), va["ex"].values.astype(float))
        st_["baseAll"], st_["base"] = st_["base"], vbase
        st_["exT"] = _ex_t(pk["ex"].values.astype(float), vbase)
        st_.update(_matched(pk, vmb))
        if CV2:   # [실험] 앞 접기 A — 표 [0,40%) → [40,60%) 에서도 같은 규칙 성적. 고르기 = 두 접기 t 평균(접기 하나의 국면 우연을 덜 탄다)
            dkA = ("A", dk)
            if dkA not in tabs1:
                tabs1[dkA] = _shrunk_table(df[df[timecol] < c0], decay=dk, tcol=timecol, ref=c0)
            pa = _pick(tabs1[dkA], vA, rule, hist=df)["ex"].values.astype(float)
            st_["tA"] = round(float(pa.mean() / (pa.std(ddof=1) / math.sqrt(len(pa)))), 2) if len(pa) > 2 and pa.std() > 0 else 0.0
            st_["nA"] = int(len(pa))
            st_["cvT"] = round((st_["tA"] + (st_["t"] or 0.0)) / 2, 2) if st_["nA"] >= VAL_MIN_N else -9.0
        cmp_.append({"rule": rule, **st_})
    # [V33.622] 규칙은 평균이 아니라 ★t(평균 ÷ 불확실성)★ 로 고른다 · 표본 ≥ VAL_MIN_N — 후보 11개 중 '평균 최대' 는 표본 적은 우연을 고른다(무작위 시세에서 실측)
    elig = [c for c in cmp_ if c["n"] >= VAL_MIN_N and c["mean"] is not None]
    elig = elig or [c for c in cmp_ if c["n"] >= 30 and c["mean"] is not None]
    best = max(elig, key=lambda c: (c.get(SEL_KEY) if c.get(SEL_KEY) is not None else -9.0)) if elig else cmp_[1]
    rule = best["rule"]
    tab2 = _shrunk_table(df[df[timecol] < c2], decay=rule.get("decay"), tcol=timecol, ref=c2)
    ho = df[df[timecol] >= c2]
    pk = _pick(tab2, ho, rule, hist=df)
    st = _stats(pk["ex"].values.astype(float), ho["ex"].values.astype(float))
    hb, hn = fair_base(ho)
    st["baseAll"], st["base"], st["baseN"] = st["base"], hb, hn   # 판정 기준 = 공정한 무작위 기준선 · 옛 '전부 평균' 은 baseAll 로 남긴다
    st.update({"rule": rule, "cut": [str(c1), str(c2)], "valCmp": cmp_, "byPb": {k: int(v) for k, v in pk["pb"].value_counts().items()}})
    st["passTrade"] = bool(st["n"] >= 30 and st["mean"] > 0 and st["t"] >= PASS_T and st["base"] is not None and st["mean"] > st["base"])   # 종전(거래 t)
    if timecol == "t":
        st.update(_matched(pk, _month_base(ho)))
        st["byReg"] = _by_regime(pk, ho)
        try:   # [V33.701] 국면 게이트 — 검증 구간에서 고른 규칙 그대로의 거래(pkV)로만 정한다
            st["regGate"] = _reg_gate(_pick(tabs1[rule.get("decay")], va, rule, hist=df), pk)
        except Exception as e:  # noqa: BLE001
            print("   ⚠️ [매매법시뮬] 국면 게이트 실패 %s" % e)
        st["fwd"] = _forward(pk, ho)
        st["cap"] = {"day": CAP["day"], "open": CAP["open"]} if CAP["on"] else None
    st["passMatched"] = bool(st["n"] >= 30 and st["mean"] > 0 and (st.get("mx") or 0) > 0 and (st.get("mT") or 0) >= PASS_MT)
    st["passMode"] = PASS_MODE if (timecol == "t" and TIME_MONTH is not None) else "trade"   # 달 정보가 없으면(단위 시험·5분) 종전 판정
    st["pass"] = st["passMatched"] if st["passMode"] == "matched" else st["passTrade"]
    rec = _recent(pk, ho, timecol)
    if rec:
        st["recent"] = rec
        st["pass"] = bool(st["pass"] and rec["ok"])
    if CAP["on"]:   # [V33.675] 시험 매수(사용자 (나) "시험 매수는 유지")는 종전 표본(상한 없이 뜬 신호 전부)으로 잰 종전 기준으로 연다 — 같은 고른 규칙
        CAP["on"] = False
        try:
            pk0 = _pick(tab2, ho, rule, hist=df)
            l0 = _stats(pk0["ex"].values.astype(float), ho["ex"].values.astype(float))
            l0["base"] = fair_base(ho)[0]
            l0["passTrade"] = bool(l0["n"] >= 30 and l0["mean"] > 0 and l0["t"] >= PASS_T and l0["base"] is not None and l0["mean"] > l0["base"])
            r0 = _recent(pk0, ho, timecol)
            l0["recent"] = r0
            st["legacy"] = l0
        finally:
            CAP["on"] = True
    return st, tab2


def _recent(pk, ho, timecol):
    """[V33.650 학습기] 최근 구간 확인 — 같은 고른 거래 중 판정 구간 마지막 REC_DAYS 거래일 몫 vs 그 조각의 공정 무작위."""
    try:
        tho = np.sort(ho[timecol].unique())
        if len(tho) <= REC_DAYS:
            return None
        cr = tho[-REC_DAYS]
        rx = pk[pk[timecol] >= cr]["ex"].values.astype(float)
        rb, _ = fair_base(ho[ho[timecol] >= cr])
        rec = {"days": REC_DAYS, "n": int(len(rx)), "mean": round(float(rx.mean()), 4) if len(rx) else None, "base": rb}
        sd_ = float(rx.std(ddof=1)) if len(rx) > 2 else 0.0
        rec["t"] = round(float((rx.mean() - rb) / (sd_ / math.sqrt(len(rx)))), 2) if (rb is not None and sd_ > 0) else None
        rec["needT"] = REC_T
        rec["ok"] = bool(len(rx) < REC_MIN_N or rb is None or rec["t"] is None or rec["t"] > REC_T)   # [V33.660] 확실한 악화(t ≤ −2)만 미달
        return rec
    except Exception:  # noqa: BLE001 — 확인 실패는 판정을 바꾸지 않는다
        return None


def _relevel(df):
    """k0(구체)…k3('*') 를 _shrunk_table 이 기대하는 순서로: k3(구체)…k0('*') → 열 이름 뒤집기."""
    m = {"k0": "k3", "k1": "k2", "k2": "k1", "k3": "k0"}
    return df.rename(columns=m)


def export(tab, pbs, min_n=30, max_bytes=1200000):
    """워커로 보낼 표 — 열쇠마다 매매법별 [n, 성공확률, 평균]. 표본 적은 구체 칸은 버린다(부모가 대신한다).
    워커 상태 한 칸(D1) 크기 한도 때문에 max_bytes 를 넘으면 가장 구체적인 칸의 문턱(min_n)을 올린다."""
    import json
    min_d = min_n   # [V33.710] k4(더 세심한 칸 · '|' 7개) 문턱 — 크기가 넘치면 k4 부터 덜어낸다(세부 칸은 지킨다)
    while True:
        out = {}
        for (k, pb), (n, w, m, lcb, hd) in tab.items():
            if k.count("|") >= 7 and n < min_d:
                continue
            if k.count("|") >= 3 and n < min_n:
                continue
            out.setdefault(k, {})[pb] = [n, round(w, 3), round(m, 3), round(lcb, 3), round(hd, 2)]
        if len(json.dumps(out, separators=(",", ":"))) <= max_bytes or min_n > 100000:
            return out
        if min_d <= 100000:
            min_d *= 2
        else:
            min_n *= 2


def run(daily, mkt_by_sym, day_key_of, BASE=None, HDR=None, upload=True, log=print, bars5=None, ev_dates=(), oos=None, sector=None):
    import strategy_router as SR
    for market in ("us", "kr"):
        t0 = time.time()
        P = SR._panel(daily, mkt_by_sym, market, day_key_of, max_days=PB_MAX_DAYS)   # [V33.650 학습기] 10년
        if P is None:
            log("   · [매매법시뮬] %s 일봉 부족 — 건너뜀" % market)
            continue
        global TIME_MONTH, TIME_REG, FLOW_RANK
        FLOW_RANK, flow_now = None, None
        if market == "kr" and FLOW_ON:
            try:   # [V33.704] 한국 수급(학습기가 네이버에서 직접 · GHA 캐시) → 수급 과열 백분위
                import flow_kr as FK
                FLOW_RANK, flow_now = FK.crowd_rank(P, FK.update(list(P["close"].columns), log=log))
                if not np.isfinite(FLOW_RANK).any():
                    FLOW_RANK, flow_now = None, None
            except Exception as e:  # noqa: BLE001
                FLOW_RANK, flow_now = None, None
                log("   ⚠️ [수급] 실패 — 수급 규칙 후보 없이 진행 %s" % e)
        TIME_MONTH = (np.asarray(P["close"].index).astype(np.int64) // 100).astype(np.int64)   # yyyymmdd → yyyymm
        _rg_, _mr_ = _regime(P["close"])
        TIME_REG = np.asarray(_rg_)
        global TIME_MCUM, TIME_COST
        TIME_MCUM = np.concatenate([[1.0], np.cumprod(1 + np.nan_to_num(np.asarray(_mr_, dtype=float)))])
        TIME_COST = COST_RT[market]
        global TIME_DATE, TIME_WEEK
        TIME_DATE = np.asarray(P["close"].index).astype(np.int64)
        TIME_WEEK = np.asarray(pd.to_datetime(TIME_DATE.astype(str), format="%Y%m%d").to_period("W").astype(np.int64))
        CAP["open"] = min(12, CAP_OPEN_MK.get(market, 12))
        sig = CAT.signals(P)
        sig_now = {pb: sig[pb].fillna(False).values[-1].astype(bool).copy() for pb in CROSS_PB if pb in sig}   # 워커에 보낼 '오늘 목록'(늦추기 전)
        if LAG_FIX:
            for pb in CROSS_PB:
                if pb in sig:
                    sig[pb] = sig[pb].shift(1, fill_value=False)
        try:
            dpb, tune_rep = tune_daily(P, market, sig, log=log, skip=PB_OFF.get(market, ()))   # [V33.619] 매매법 자동 조율(앞 55% 만)
        except Exception as e:  # noqa: BLE001
            log("   ⚠️ [매매법조율] %s 실패 %s — 기본 프로필" % (market, e))
            dpb, tune_rep = {k: dict(v, prof="base", flt=None) for k, v in DAILY_PB.items()}, None
        _off = set(PB_OFF.get(market, ()))
        dpb = {k: v for k, v in dpb.items() if k not in _off}   # [V33.650 학습기] 퇴출 매매법은 시뮬·표·워커 목록에서 뺀다
        _newpb = {} if os.environ.get("PB_VARIANT") == "no_new" else NEW_PB.get(market, {})   # [V33.653] A/B 실험 — 문헌 전략 끈 판(업로드 안 함)
        mod_now, tier2 = {}, list(MOD_PB.get(market, {})) + list(_newpb)
        if tier2:   # [V33.651] 보조 매매법 — 시뮬은 하루 늦게(실전과 같게) · 오늘 목록은 늦추지 않은 마지막 날
            _fm = _mod_filters(P)
            for nm, (b_, f_, hd_) in MOD_PB[market].items():
                sm = (sig[b_] & _fm[f_]).fillna(False).astype(bool)
                mod_now[nm] = sm.values[-1]
                sig[nm] = sm.shift(1, fill_value=False)
                dpb[nm] = dict(DAILY_PB["DUAL_MOM"], hold=hd_, family="Mod", label="%s 수정판(%s 거르개 · %d일 보유) — 2순위" % (b_, f_, hd_), prof="mod", flt=None)
            _ns = _new_signals(P, list(_newpb))
            _ng = NEW_PB_GRP.get(market, {})
            if _ng:   # [V33.665] 그룹 한정 단타 — 그 그룹 종목만(오늘 목록도 같은 그룹)
                if P.get("_grp") is None:
                    P["_grp_now"] = PP.groups(P, PTUNE_GROUPS)
                    P["_grp"] = _lag1(P["_grp_now"]) if LAG_FIX else P["_grp_now"]
                for nm, g_ in _ng.items():
                    if nm in _ns:
                        _ns[nm] = _ns[nm] & pd.DataFrame(P["_grp"] == g_, index=_ns[nm].index, columns=_ns[nm].columns)
            for nm, hd_ in _newpb.items():   # [V33.652] 문헌 전략(2순위)
                if nm not in _ns:
                    continue
                mod_now[nm] = _ns[nm].values[-1]
                sig[nm] = _ns[nm].shift(1, fill_value=False)
                dpb[nm] = dict(DAILY_PB["DUAL_MOM"], hold=hd_, family="Lit", label=("%s(단타 · %d일 보유) — 2순위" if hd_ <= 5 else "%s(문헌 전략 · %d일 보유) — 2순위") % (nm, hd_), prof="new", flt=None,
                               onlyGrp=_ng.get(nm))   # [V33.665] 화면: 그룹 한정
        if RIDE_ON:   # [V33.694] ★추세 타기(+R) 변형★ — 같은 신호 · 청산만 '따라붙는 손절 · 길게'. 고르는 AI 가 칸(국면·종목 상태)마다 원래 청산과 겨룬다.
            for nm in list(dpb):
                if nm.endswith("+R") or nm not in sig:
                    continue
                rn = nm + "+R"
                dpb[rn] = dict(dpb[nm], **RIDE_PROF, family=dpb[nm].get("family"), prof="ride", flt=dpb[nm].get("flt"), grp=None,
                               label="%s 추세 타기(고점 −%d%% 따라붙는 손절 · 최대 %d일)" % (nm, RIDE_PROF["trail"], RIDE_PROF["hold"]))
                sig[rn] = sig[nm]
                if nm in mod_now:
                    mod_now[rn] = mod_now[nm]
                if nm in tier2:
                    tier2.append(rn)
        if LEAD_ON:   # [V33.694] ★주도주 보유(1순위)★ — 사용자 10/28 "상승장·폭등장에서 버는 게 중요 · 모든 국면 거래당 +5%". 2순위가 아니라 1순위로 겨룬다(칸·국면마다 표가 고른다)
            _ls = _new_signals(P, list(LEAD_PB))
            for nm, hd_ in LEAD_PB.items():
                if nm not in _ls:
                    continue
                mod_now[nm] = _ls[nm].values[-1]
                sig[nm] = _ls[nm].shift(1, fill_value=False)
                dpb[nm] = dict(DAILY_PB["DUAL_MOM"], stop=12, atr=4, be=0, tpR=None, hold=hd_, family="Lead", prof="lead", flt=None,
                               label="%s(주도주 보유 · 최대 %d일) — 1순위" % (nm, hd_))
        log("   · [매매법시뮬] %s 매매법 %d종 사용 · 퇴출 %d종(성적 미달)" % (market, len(dpb), len(_off)))
        if P.get("_grp") is None:
            P["_grp_now"] = PP.groups(P, PTUNE_GROUPS)
            P["_grp"] = _lag1(P["_grp_now"]) if LAG_FIX else P["_grp_now"]   # [V33.671] 시뮬은 어제 그룹(워커는 학습기가 보낸 그룹을 다음 날 씀)
        # [V33.620] ★후보 폭도 검증이 고른다★ — OMNI-Q 상위 20·40·60%(사용자 10/15 "가장 유리한 방식 · 매수 신호가 나올 넉넉함").
        #   [V33.622] 머리(5일·20일·평균) × 폭 + 거름 없음 = 10 설정. 검증 구간 [60,80%) 에서 고른 규칙의 ★t★ 가 가장 큰(평균 > 0 · 거래 ≥ VAL_MIN_N) 설정 —
        #   평균 최대로 고르면 무작위 시세에서 판정 구간 거래 0 인 설정을 골랐다(다중 비교의 함정). 판정 구간은 고르기에 안 쓴다.
        best_q, cand_cmp, dflt = None, [], None
        t_c = time.time()
        for hd_, q_ in [(h_, q2) for h_ in CAND_HEADS for q2 in CAND_QS if q2 > 0] + [("5", 0.0)]:
            if time.time() - t_c > CAND_BUDGET_S:
                log("   · [매매법시뮬] %s 후보 비교 시간 상한 — 나머지 생략" % market)
                break
            cm_ = cand_mask(P, (oos or {}).get(market), q_, hd_)
            if cm_ is None:
                continue
            global CAND_RANK
            CAND_RANK = cand_rank(P, (oos or {}).get(market), hd_) if RANK_MODE == "omq" else None
            d_, reg_now, _ = sim_daily(P, market, ev_dates, sig=sig, cand=cm_, pbs=dpb)
            d_ = _tier(d_, tier2)
            if len(d_) < CAND_MIN_ROWS:
                continue
            d_ = _relevel(d_)
            st_, _ = validate(d_, "t")
            rsel = st_.get("rule") or {}
            vsel = next((c_ for c_ in (st_.get("valCmp") or []) if c_.get("rule") == rsel), None)   # 그 폭에서 고른 규칙의 검증 구간 성적
            vm = vsel.get("mean") if vsel and vsel.get("n", 0) >= VAL_MIN_N else None
            vt = (vsel.get(SEL_KEY) or 0.0) if vm is not None else None
            log("   · [매매법시뮬] %s 후보 OMNI-Q %s일 머리 상위 %d%% — 검증 구간 %s%%(무작위 %s · 초과 t %s) · 판정 %s%% vs %s(n %s)" % (market, hd_, round((1 - q_) * 100), vm, (vsel or {}).get("base"), (vsel or {}).get("exT"), st_.get("mean"), st_.get("base"), st_.get("n")))
            cand_cmp.append({"q": q_, "head": hd_ if q_ > 0 else None, "val": vm, "valT": vt, "valB": (vsel or {}).get("base"), "valExT": (vsel or {}).get("exT"), "n": st_.get("n"), "mean": st_.get("mean"), "base": st_.get("base"), "t": st_.get("t"), "win": st_.get("win")})   # 기록만(고르기는 val)
            if hd_ == "5" and q_ == CAND_Q:
                dflt = (vt, q_, d_, st_, hd_)   # 검증 구간에서 양수인 설정이 없을 때 쓰는 기본(종전과 같은 5일 상위 20%)
            if vt is not None and vm > 0 and (best_q is None or vt > best_q[0]):   # [V33.622] 검증 구간 t 최대(평균 > 0 · 표본 ≥ VAL_MIN_N)
                best_q = (vt, q_, d_, st_, hd_)
        if best_q is None and dflt is not None:
            log("   · [매매법시뮬] %s 검증 구간에서 양수인 후보 설정 없음 → 기본(5일 머리 상위 20%%)" % market)
            best_q = dflt
        K_ = len(cand_cmp) * (len(RULES + RULES_ADAPT + RULES_GV) + (1 if CELL_ON else 0) + (len(RULES_FLOW) if FLOW_RANK is not None else 0) + len(RULES_DEEP))   # [V33.694] 칸별 규칙 후보 1개 더
        luck = {"K": K_, "level": luck_level(K_), "best": best_q[0] if best_q else None, "fallback": False}
        if best_q is not None and dflt is not None and best_q is not dflt and (best_q[0] is None or best_q[0] < luck["level"]):   # [V33.675] 1등이 운 수준 이하 → 사전 등록 기본
            log("   · [매매법시뮬] %s 검증 1등 %s 이 운 수준 %.2f(설정·규칙 %d개 중 최대의 기대) 이하 → 사전 등록 기본(5일 머리 상위 20%%)" % (market, best_q[0], luck["level"], K_))
            best_q, luck["fallback"] = dflt, True
        if best_q is not None:
            _, q_, ddf, dst, hd_ = best_q
            dst["candHead"] = hd_
            cand_src = ("OMNI-Q 표본 밖 %s일 머리 상위 %d%%" % (hd_, round((1 - q_) * 100))) if q_ > 0 else "OMNI-Q 거름 없음(전 종목 · 검증이 고름)"
            dst["candQ"] = q_
            dst["luck"] = luck
        else:
            log("   · [매매법시뮬] %s 후보 거름 불가(OMNI-Q 과거 점수 없음·부족) → 전 종목으로" % market)
            ddf, reg_now, sig = sim_daily(P, market, ev_dates, sig=sig, pbs=dpb)
            ddf = _tier(ddf, tier2)
            cand_src = "전 종목(OMNI-Q 과거 점수 없음·부족)"
            ddf = _relevel(ddf)
            dst, _ = validate(ddf, "t")
        cm = cand_mask(P, (oos or {}).get(market), dst.get("candQ"), dst.get("candHead") or "5") if dst.get("candQ") else None
        CAND_RANK = cand_rank(P, (oos or {}).get(market), dst.get("candHead") or "5") if (RANK_MODE == "omq" and dst.get("candQ") is not None) else None
        dst["cand"] = cand_src
        ptune_rep = None
        try:   # [V33.664·667] 미지수 조율 — ★실전과 같은 후보 거름(cm)★ 안에서 조율하고 같은 거름으로 시스템 검증(검증 구간 평균·t 안 낮추고 통과 유지만 채택)
            act = [k for k in dpb if k in DAILY_PB]
            pc_, prep_ = param_tune(P, market, sig, dpb, act, cand=cm, log=log)
            ptune_rep = {"tune": prep_, "sys": [], "groups": PTUNE_GROUPS, "v": 2}
            if pc_:
                def _vsys(sg_, pbs_):
                    d_, _, _ = sim_daily(P, market, ev_dates, sig=sg_, pbs=pbs_, cand=cm)
                    d_ = _relevel(_tier(d_, tier2))
                    st_, _ = validate(d_, "t")
                    v_ = next((c_ for c_ in (st_.get("valCmp") or []) if c_.get("rule") == st_.get("rule")), {}) or {}
                    return v_.get("mean"), v_.get("t") or 0.0, bool(st_.get("pass")), st_, d_
                v0 = next((c_ for c_ in (dst.get("valCmp") or []) if c_.get("rule") == dst.get("rule")), {}) or {}
                bm, bt, bp = v0.get("mean"), v0.get("t") or 0.0, bool(dst.get("pass"))   # 기준 = 지금 고른 설정의 검증 구간(같은 시뮬)
                ptune_rep["base"] = [bm, bt, bp]
                t_s, won = time.time(), None
                for pb in sorted(pc_, key=lambda k: -max(x[3] for x in pc_[k].values()))[:PTUNE_SYS_MAX]:   # 조율 t 가 큰 매매법부터
                    if time.time() - t_s > PTUNE_BUDGET_S:
                        ptune_rep["sys"].append({"pb": pb, "ok": False, "why": "시간 상한"})
                        continue
                    gmap = pc_[pb]
                    sig2 = dict(sig)
                    sig2[pb] = grouped_sig(P, pb, {g_: v[0] for g_, v in gmap.items()}, sig)
                    pbs2 = dict(dpb)
                    pbs2[pb] = dict(dpb[pb], ep={g_: v[0] for g_, v in gmap.items() if v[0]}, grp={g_: v[1] for g_, v in gmap.items() if v[1]})
                    vm, vt, vp, st2, d2 = _vsys(sig2, pbs2)
                    # [V33.668] 동률은 채택 안 함 — 실전 회차에서 미 RS_LEADER@저변동이 검증 1.628%·t 4.34 그대로(효과 0)인데 '채택' 됐다. 평균·t 중 하나는 실제로 올라야 한다
                    ok = bool(vm is not None and bm is not None and vm >= bm and vt >= bt and (vm > bm or vt > bt) and (vp or not bp))
                    ptune_rep["sys"].append({"pb": pb, "groups": sorted(gmap), "val": [vm, vt, vp], "ok": ok})
                    log("   · [미지수조율] %s %s 시스템 검증 구간 평균 %s→%s · t %.2f→%.2f → %s" % (market, pb, bm, vm, bt, vt, "채택" if ok else "보류(시스템을 낮춤)"))
                    if ok:
                        sig, dpb, bm, bt, bp, won = sig2, pbs2, vm, vt, vp, (st2, d2)
                if won is not None:   # 채택분이 있으면 판정·표를 그 시뮬로 다시(후보 설정 기록은 그대로)
                    keep = {k: dst.get(k) for k in ("candHead", "candQ", "cand", "luck")}
                    dst, ddf = won
                    dst.update(keep)
        except Exception as e:  # noqa: BLE001
            log("   ⚠️ [미지수조율] %s 실패 %s — 기본 미지수" % (market, e))
        meta_rep = None
        try:   # [V33.672] 고차원 수식(메타 라벨) 거름 — 안 거름 / 하위 20% / 하위 40% 중 검증 구간이 고른다
            Fm = meta_features(P)
            # 2순위 정리 ★전★ 표본에 거름을 건다(워커도 같은 순서 — 1순위 신호가 걸러지면 그 종목의 보조가 살아난다)
            ddf_pre = _relevel(sim_daily(P, market, ev_dates, sig=sig, pbs=dpb, cand=cm)[0])
            ts_ = np.sort(ddf_pre["t"].unique())
            t_fit = ts_[int(len(ts_) * SPLIT[0])]   # validate 와 같은 표 구간 끝(검증 전)
            v0 = next((c_ for c_ in (dst.get("valCmp") or []) if c_.get("rule") == dst.get("rule")), {}) or {}
            bm, bt, bp = v0.get("mean"), v0.get("t") or 0.0, bool(dst.get("pass"))
            meta_rep = {"base": [bm, bt, bp], "cmp": [], "pick": None}
            best = None
            for q_ in META_QS:
                d_m, _mods = meta_filter(P, ddf_pre, t_fit, q_, Fm)
                d_m = _tier(d_m, tier2)
                st_m, _ = validate(d_m, "t")
                vm_ = next((c_ for c_ in (st_m.get("valCmp") or []) if c_.get("rule") == st_m.get("rule")), {}) or {}
                vm, vt, vp = vm_.get("mean"), vm_.get("t") or 0.0, bool(st_m.get("pass"))
                # [V33.673] 조율기와 같은 여유(TUNE_MARGIN) — 검증 평균 +0.045%p 같은 잡음 차이로는 안 쓴다(10/25 한국: 판정 1.32→0.94%)
                ok = bool(vm is not None and bm is not None and vm >= bm + TUNE_MARGIN and vt >= bt and (vp or not bp))
                meta_rep["cmp"].append({"q": q_, "val": [vm, vt, vp], "ok": ok, "ho": [st_m.get("mean"), st_m.get("t"), st_m.get("base")]})
                log("   · [고차원수식] %s 하위 %d%% 거름 — 검증 평균 %s→%s · t %.2f→%.2f → %s" % (market, int(q_ * 100), bm, vm, bt, vt, "후보" if ok else "안 씀"))
                if ok and (best is None or vt > best[0]):
                    best = (vt, q_, st_m, d_m)
            if best is not None:
                _, q_, st_m, d_m = best
                keep = {k: dst.get(k) for k in ("candHead", "candQ", "cand", "luck")}
                dst, ddf = st_m, d_m
                dst.update(keep)
                # 실전 수식 = 판정 구간 전까지(표와 같게 [0,80%))로 다시 맞춘 계수 · 같은 q
                t_live = ts_[int(len(ts_) * SPLIT[1])]
                _, models_live = meta_filter(P, ddf_pre, t_live, q_, Fm)
                for pb_, m_ in models_live.items():
                    if pb_ in dpb:
                        dpb[pb_] = dict(dpb[pb_], meta=m_)
                meta_rep["pick"] = q_
                log("   · [고차원수식] %s 채택 — 하위 %d%% 거름 · 수식 %d종" % (market, int(q_ * 100), len(models_live)))
        except Exception as e:  # noqa: BLE001
            log("   ⚠️ [고차원수식] %s 실패 %s — 안 거름" % (market, e))
        try:   # [V33.626] 판정 구간 시작 날짜 — 워커가 '겹치지 않는 판정 구간 두 번 통과' 를 셀 때 쓴다
            dst["hoFrom"] = str(P["close"].index[int((dst.get("cut") or [0, 0])[1])])
        except Exception:  # noqa: BLE001
            dst["hoFrom"] = None
        dst["candCmp"] = cand_cmp   # [V33.621] 폭별 판정 구간 성적(객관 비교 · 고르기엔 안 씀)
        try:   # [V33.654] ★매매법별 성적(전 매매법 · 보조 포함)★ — 화면이 조율 보고(1순위만) 대신 이걸로 전부 보인다. 같은 시뮬(고른 후보 폭)의 판정 전 / 판정 구간
            _c2 = int((dst.get("cut") or [0, 0])[1])
            def _nmw(x):
                x = np.asarray(x, dtype=float)
                return [int(len(x)), round(float(x.mean()), 3) if len(x) else None, round(float((x > 0).mean() * 100), 1) if len(x) else None]
            dst["pbStat"] = {pb_: {"pre": _nmw(g_[g_["t"] < _c2]["ex"].values), "ho": _nmw(g_[g_["t"] >= _c2]["ex"].values), "tier": 2 if pb_ in tier2 else 1}
                             for pb_, g_ in ddf.groupby("pb")}
        except Exception as e:  # noqa: BLE001
            log("   ⚠️ [매매법시뮬] 매매법별 성적 실패 %s" % e)
        dst["tune"] = tune_rep
        try:
            dst["exitDiag"] = exit_diag(P, market, sig, cm if cand_src.startswith("OMNI") else None, pbs=dpb)
            ed = dst["exitDiag"]
            log("   · [매매법시뮬] %s 손절 진단(기록만) — " % market + " · ".join(
                "%s 지금 %s%%/%s%% 넓게 %s%%/%s%%" % (k, v["cur"][1], v["cur"][2], v["wide"][1], v["wide"][2]) for k, v in list(ed.items())[:6]))
        except Exception as e:  # noqa: BLE001
            log("   ⚠️ [매매법시뮬] 손절 진단 실패 %s" % e)
        syms_all = list(P["close"].columns)
        def _cross_now(pb):   # [V33.671] 오늘 목록 = 늦추기 전 신호(그룹 조율 채택분은 그 그룹의 미지수로)
            row = sig_now[pb].copy()
            for g_, ep in ((dpb.get(pb) or {}).get("ep") or {}).items():
                m = P.get("_grp_now", P["_grp"])[-1] == int(g_)
                row = np.where(m, PP.sig(P, pb, ep)[-1], row)
            return row
        cross = {pb: [syms_all[j] for j in np.nonzero(_cross_now(pb))[0]] for pb in CROSS_PB if pb in sig_now and pb in dpb}
        for nm, row in mod_now.items():   # [V33.651] 보조 매매법 오늘 목록(워커는 다음 거래일 종가 무렵 산다)
            cross[nm] = [syms_all[j] for j in np.nonzero(row)[0]]
        _r = dst.get("rule") or {}
        dtab = _shrunk_table(ddf, decay=_r.get("decay"), tcol="t", ref=int(ddf["t"].max()) + 1 if len(ddf) else None)   # 실전 표는 전 기간으로(고른 규칙의 최근 가중)
        gate_live = gate_now(ddf, _r["gate"], int(P["close"].shape[0]) - 1) if _r.get("gate") else None
        reg_series, _ = _regime(P["close"])
        _pn = _panic(P["close"], reg_series)
        panic_now = bool(_pn[-1])   # [V33.625]
        pbook = panic_book(P, (oos or {}).get(market), reg_series, dst.get("candHead") or "5", dst.get("candQ") or CAND_Q, market) if dst.get("candQ") is not None else None
        if pbook and "pre" in pbook:
            log("   · [공황바구니] %s 공황 날 OMNI-Q 후보 바구니 %d일 — 앞80%% n%d %+.2f%%(t %s) · 뒤20%% n%d %s%%(t %s) → %s" % (
                market, PANIC_BOOK_H, pbook["pre"]["n"], pbook["pre"]["mean"] or 0, pbook["pre"]["t"], pbook["post"]["n"], pbook["post"]["mean"], pbook["post"]["t"], "통과(시험 후보)" if pbook["ok"] else "관측만"))
        log("   · [매매법시뮬] %s 공황 국면(추세·모멘텀 진입 차단) %s · 전 기간 %.1f%% · 최근 60일 %.1f%%" % (
            market, "켜짐" if panic_now else "꺼짐", float(_pn.mean() * 100), float(_pn[-60:].mean() * 100)))
        reg_by_day = {int(d): r for d, r in zip(P["close"].index, reg_series)}
        ist, itab = {"pass": False, "why": "5분봉 없음"}, {}
        b5 = {s: v for s, v in (bars5 or {}).items() if mkt_by_sym.get(s) == market}
        if b5:
            idf = sim_intra(b5, reg_by_day, market)
            if len(idf):
                idf = idf[~idf["pb"].isin(INTRA_OFF.get(market, ()))]   # [V33.651] 성적 미달 단타 퇴출
            if not len(idf):
                ist = {"pass": False, "why": "단타 매매법 없음(전부 성적 미달)"}
            if len(idf):
                idf = _relevel(idf)
                ist, _ = validate(idf, "day")
                itab = _shrunk_table(idf)
            log("   · [매매법시뮬] %s 5분봉 %d종목 · 시뮬 %d건" % (market, len(b5), len(idf)))
        log("   · [매매법시뮬] %s 국면 %s · 일봉 시뮬 %d건 · 검증 n=%s 평균 %s%% 승률 %s%% t=%s (아무거나 %s%%) · 최근 %s → %s · 5분 검증 n=%s 평균 %s%% t=%s → %s (%.0fs)" % (
            market, reg_now, len(ddf), dst.get("n"), dst.get("mean"), dst.get("win"), dst.get("t"), dst.get("base"), (lambda r: ("%s일 n=%s 평균 %s%% vs 무작위 %s%% %s" % (r.get("days"), r.get("n"), r.get("mean"), r.get("base"), "통과" if r.get("ok") else "미달")) if r else "—")(dst.get("recent")),
            "통과" if dst.get("pass") else "미통과", ist.get("n"), ist.get("mean"), ist.get("t"), "통과" if ist.get("pass") else "미통과",
            time.time() - t0))
        log("   · [매매법시뮬] %s 월 맞춤 초과 %s%%p · 달 묶음 t %s · 이긴 달 %s/%s · 절대 달 t %s · 판정 방식 %s(거래 t %s · 월 맞춤 %s) · 국면별 %s" % (
            market, dst.get("mx"), dst.get("mT"), dst.get("mWin"), dst.get("mN"), dst.get("mAbsT"), dst.get("passMode"),
            "통과" if dst.get("passTrade") else "미통과", "통과" if dst.get("passMatched") else "미통과",
            " · ".join("%s n%d 초과 %+.2f vs %s · 실제 %+.2f%%(%s일)" % (r["ko"], r["n"], r["mean"], r["base"], r.get("raw") or 0, r.get("hd")) for r in (dst.get("byReg") or []) if not r.get("thin"))))
        _g = dst.get("regGate") or {}
        if _g:
            log("   · [매매법시뮬] %s 국면 게이트(검증 구간 손실 국면 쉼) 끔 %s · 판정 구간 거래당 실제 전체 %s → 게이트 후 %s(n %s) · 쉰 국면 %s(n %s)" % (
                market, ",".join(_g.get("off") or []) or "없음", ((_g.get("ho") or {}).get("all") or {}).get("mean"), ((_g.get("ho") or {}).get("gated") or {}).get("mean"),
                ((_g.get("ho") or {}).get("gated") or {}).get("n"), ((_g.get("ho") or {}).get("off") or {}).get("mean"), ((_g.get("ho") or {}).get("off") or {}).get("n")))
        if upload and BASE and os.environ.get("PB_VARIANT"):
            log("   · [매매법시뮬] %s A/B 실험판(%s) — 업로드 안 함(기록만)" % (market, os.environ.get("PB_VARIANT")))
        elif upload and BASE:
            try:
                import requests
                try:
                    r3_now = regime3_now(P["close"])   # [V33.694] 국면 3단(장기·중기·단기) — 워커 오른쪽 칸·두뇌관측
                except Exception:  # noqa: BLE001
                    r3_now = None
                sleeve = None
                if SLEEVE_ON:
                    try:   # [V33.695] 국면 전략 — 국면마다 전략 묶음을 분기 워크포워드로 고름(regime_sleeve.py)
                        import sys as _sys
                        import regime_sleeve as RSL
                        sleeve = RSL.run(P, market, _sys.modules[__name__], log=log)
                    except Exception as e:  # noqa: BLE001
                        log("   ⚠️ [국면전략] %s 실패 %s" % (market, e))
                body = {"mkt": market, "day": str(P["close"].index[-1]), "regime": reg_now, "regime3": r3_now, "sleeve": sleeve, "sector": (sector or {}).get(market), "panic": panic_now, "panicBook": pbook,
                        "daily": {"val": dst, "table": export(dtab, list(DAILY_PB)), "pb": dpb, "cross": cross, "gate": gate_live, "tier2": tier2,
                                  "grp": ({syms_all[j]: int(g_) for j, g_ in enumerate(P.get("_grp_now", P.get("_grp"))[-1]) if g_ >= 0} if P.get("_grp") is not None else None),   # [V33.664] 종목 → 변동성 그룹(오늘)
                                  "ptune": ptune_rep, "epDef": {k: v[1] for k, v in PP.ENTRY.items()}, "epLad": dict({k: v[2] for k, v in PP.ENTRY.items()}, _mods=PP.MODS),
                                  "rs6": {syms_all[j]: round(float(x), 3) for j, x in enumerate(PP.rs6(P).values[-1]) if x == x}, "meta": meta_rep, "metaFeats": list(META_FEATS),
                                  "flow": ({syms_all[j]: round(float(x), 3) for j, x in enumerate(flow_now) if x == x} if flow_now is not None else None)},   # [V33.704] 수급 과열 백분위(오늘 · 워커는 다음 거래일에 씀)   # [V33.667] 6개월 순위(오늘 · 워커는 다음 거래일에 '어제 값' 으로 씀)
                        "intra": {"val": ist, "table": export(itab, list(INTRA_PB)), "pb": {k: v for k, v in INTRA_PB.items() if k not in INTRA_OFF.get(market, ())}}}
                r = requests.post(BASE + "/api/playbook", headers=HDR, json=body, timeout=180)
                log("   · [매매법시뮬] %s 업로드 %s" % (market, r.status_code))
            except Exception as e:  # noqa: BLE001
                log("   ⚠️ [매매법시뮬] 업로드 실패 %s" % e)
