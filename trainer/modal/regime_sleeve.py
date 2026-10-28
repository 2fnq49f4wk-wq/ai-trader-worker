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
CELL_REGS = ("SURGE", "BEAR")   # [V33.696] 이 국면은 중기 방향(M: 상승·보합·하락)으로 나눠 따로 고른다 — 하락장 속 반등 폭등 ≠ 상승장 속 폭등
SCORE = "lcb"   # [V33.696] 고르기 점수 = 평균 − 표준오차(표본 적은 우연을 덜 탄다)
CRASH_EXIT = False   # 국면 깨짐 청산 — 실험실 A/B(검증 구간만 비교)에서 우열 없음 → 단순한 쪽(끔). 켜면 워커도 cfg.crashExit 로 따른다
CAP_DAY = 6
REG5 = ("SURGE", "BULL", "NEUTRAL", "BEAR", "CRASH")
REG_KO = {"SURGE": "폭등", "BULL": "상승", "NEUTRAL": "보합", "BEAR": "하락", "CRASH": "폭락"}
PROFS = {"h10": dict(stop=8, atr=3, hold=10, tpR=None, be=0), "h20": dict(stop=10, atr=3, hold=20, tpR=None, be=0),
         "h40": dict(stop=12, atr=4, hold=40, tpR=None, be=0), "h60": dict(stop=12, atr=4, hold=60, tpR=None, be=0),
         "r60": dict(stop=12, atr=4, hold=60, trail=20, trailAct=10, tpR=None, be=0), "h60w": dict(stop=20, atr=6, hold=60, tpR=None, be=0)}
ETFS = {"kr": {"lev": "122630.KS", "idx": "069500.KS", "inv": "114800.KS", "inv2": "252670.KS"},
        "us": {"lev": "TQQQ", "idx": "SPY", "inv": "SH", "inv2": "SQQQ"}}
FAM_KO = {"rs60t5": "60일 상대강도 상위 5% · 20일선 위", "rs120t5": "120일 상대강도 상위 5% · 50일선 위", "rs20t5": "20일 상대강도 상위 5%",
          "rs250t5": "1년 상대강도 상위 5% · 50일선 위", "rs60t10dip": "60일 강세 상위 10% 의 20일선 눌림(50일선 위)",
          "lead_fall10": "120일 주도주(상위 20%) 10일 −10% 급락", "lead_fall10_up": "주도주 10일 −10% 급락 뒤 첫 양봉",
          "mega_rs": "대형주(거래대금 상위 10%) 중 60일 강세", "mega_fall": "대형주 10일 −8% 급락", "mega_fall_up": "대형주 급락 뒤 첫 양봉",
          "newhi250": "52주 신고가 근처 · 60일 강세", "newhi60_mega": "대형주 60일 신고가", "rsi_lo_lead": "1년 주도주 RSI 과매도(200일선 위)",
          "lowvol_lead": "저변동 주도주(120일 강세 · 50일선 위)", "above200_lo20": "200일선 위 20일 저점 근처 강세주", "crash_quality": "200일선 위 종목의 5일 −7% 뒤 첫 양봉"}
for _k, _v in {"lev": "레버리지 지수 ETF", "idx": "지수 ETF", "inv": "인버스 ETF", "inv2": "인버스 2배 ETF"}.items():
    FAM_KO["etf_" + _k] = _v
    FAM_KO["etf_" + _k + "_up1"] = _v + " · 양봉 날"
    FAM_KO["etf_" + _k + "_dn5"] = _v + " · 5일 −4% 뒤"
PROF_KO = {"h10": "10일 보유", "h20": "20일 보유", "h40": "40일 보유", "h60": "60일 보유", "r60": "따라붙는 손절(고점 −20%) · 60일", "h60w": "넓은 손절(20%) · 60일"}


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
    with np.errstate(invalid="ignore"):
        F = {"rs60t5": (r60r >= .95) & (C > ma20), "rs120t5": (r120r >= .95) & (C > ma50), "rs20t5": r20r >= .95, "rs250t5": (r250r >= .95) & (C > ma50),
             "rs60t10dip": (r60r >= .90) & (C < ma20) & (C > ma50), "lead_fall10": (r120r >= .8) & (r10 <= -.10), "lead_fall10_up": (r120r >= .8) & (r10 <= -.10) & up1,
             "mega_rs": (dvr >= .9) & (r60r >= .7) & (C > ma20), "mega_fall": (dvr >= .9) & (r10 <= -.08), "mega_fall_up": (dvr >= .9) & (r10 <= -.08) & up1,
             "newhi250": (C >= hi250 * .995) & (r60r >= .7), "newhi60_mega": (C >= hi60 * .995) & (dvr >= .8),
             "rsi_lo_lead": (r250r >= .8) & (rsi < 30) & (C > ma200), "lowvol_lead": (vol20 <= .3) & (r120r >= .8) & (C > ma50),
             "above200_lo20": (C > ma200) & (C <= lo20 * 1.01) & (r120r >= .6), "crash_quality": (C > ma200) & (r5 <= -.07) & up1}
    cols = list(P["close"].columns)
    for k_, s_ in ETFS.get(mk, {}).items():
        m = np.zeros((T, N), bool)
        if s_ in cols:
            m[:, cols.index(s_)] = True
        F["etf_" + k_] = m
        F["etf_" + k_ + "_up1"] = m & up1
        F["etf_" + k_ + "_dn5"] = m & (r5 <= -.04)
    return F, r60r


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
    wfV, wfH = walk(TR, c1, c2), walk(TR, c2, T)
    q = T - 1
    by = {}
    m_now = str(M3s[-1])
    for rg in REG5:
        p, used = pick_cell(TR, rg, q, m_now)
        by[rg] = ({"fam": p[0][0], "prof": p[0][1], "mean": p[1], "n": p[2], "famKo": FAM_KO.get(p[0][0], p[0][0]), "profKo": PROF_KO.get(p[0][1], p[0][1]),
                   "cell": used} if p else None)   # cell = 이 국면을 오늘 중기 방향 칸으로 골랐으면 그 칸
    rg_now = str(reg5[-1])
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
           "prof": ({k: v for k, v in pr.items() if v is not None} if pr else None), "cfg": {"win": WIN, "step": STEP, "nmin": NMIN, "th": TH, "capDay": CAP_DAY, "target": 5.0, "crashExit": CRASH_EXIT, "score": SCORE, "cellRegs": list(CELL_REGS)}, "mNow": m_now,
           "cut": [str(P["close"].index[c1]), str(P["close"].index[c2])]}
    log("   · [국면전략] %s 지금 %s → %s · 오늘 %d종 · 실전 %s · 워크포워드 판정 %s" % (
        mk, REG_KO.get(rg_now), (cur["famKo"] + " · " + cur["profKo"] + " (직전 3년 %+.2f%% n%d)" % (cur["mean"], cur["n"])) if cur else "쉼(근거 부족)", len(syms),
        "켬" if ok else "관측", " · ".join("%s %s(%d)" % (REG_KO[r], ("%+.2f%%" % v["mean"]) if v["mean"] is not None else "—", v["n"]) for r, v in wfH.items())))
    return out
