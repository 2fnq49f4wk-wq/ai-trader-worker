"""[V33.798] 신규 매매법 후보 검증(연구용 · CI·배포에서 안 돈다).

  WF_PX=./wf_px python trainer/research/newpb_eval.py us   # 먼저 playbook_wf10y.py fetch 로 10년 일봉

규칙: 신호는 playbook_sim._new_signals(학습기와 같은 코드) · 진입은 ★하루 늦은 종가★(실전과 같다) · 같은 종목 보유 중 재진입 없음.
청산 후보 5종(손절%·익절%·최대 보유일) 중 ★앞 70% 에서만★ PF 로 고르고 뒤 30%(판정 · 고르기에 안 씀)를 그대로 잰다.
비용은 왕복 COST_RT(미 0.10% · 한 0.30% = 매도세+수수료) 를 거래마다 뺀다. 같은 날 손절·익절이 둘 다 닿으면 손절로 본다(보수적).
채택(정식 2순위): 판정 PF ≥ 1.1 · 판정 거래 ≥ 100 · 앞 구간 PF ≥ 1.0 · 판정 시장 초과 > 0. 미달은 그림자(시뮬 표에만 · 실전 목록 안 보냄).
주의: 지금 유니버스를 과거에 적용 — 생존 편향(상대 비교용).
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "modal"))
import playbook_wf10y as WF  # noqa: E402
import playbook_sim as PB  # noqa: E402

EXITS = [(8, None, 10), (8, 15, 20), (10, None, 30), (6, 6, 5), (5, None, 5)]
CUT = 0.70
MIN_HO_N, MIN_PF = 100, 1.1


def sim(sig, c, h, l, mcum, cost, stop, tp, hold):
    s = sig.shift(1, fill_value=False).values
    T, N = c.shape
    out = []
    for j in range(N):
        busy = -1
        for t0 in np.nonzero(s[:, j])[0]:
            if t0 < 250 or t0 <= busy or t0 + hold >= T or not np.isfinite(c[t0, j]):
                continue
            e, ex, k = c[t0, j], None, t0
            for k in range(t0 + 1, t0 + hold + 1):
                if np.isfinite(l[k, j]) and l[k, j] <= e * (1 - stop / 100):
                    ex = e * (1 - stop / 100)
                    break
                if tp and np.isfinite(h[k, j]) and h[k, j] >= e * (1 + tp / 100):
                    ex = e * (1 + tp / 100)
                    break
            if ex is None:
                ex = c[k, j]
            if not np.isfinite(ex):
                continue
            r = (ex / e - 1) * 100 - cost
            out.append((t0, k, r, r - (mcum[k] / mcum[t0] - 1) * 100))
            busy = k
    return np.array(out) if out else np.zeros((0, 4))


def stat(a):
    if len(a) == 0:
        return {"n": 0}
    r = a[:, 2]
    g, b = r[r > 0].sum(), -r[r < 0].sum()
    return {"n": int(len(r)), "pf": round(float(g / b), 2) if b > 0 else 99.0, "win": round(float((r > 0).mean() * 100), 1),
            "mean": round(float(r.mean()), 2), "exMkt": round(float(a[:, 3].mean()), 2)}


def main(mk):
    WF.PX = os.environ.get("WF_PX", "wf_px")
    P = WF.panel(mk)
    S = PB._new_signals(P, list(PB.NEW_CAND))
    c, h, l = P["close"].values, P["high"].values, P["low"].values
    with np.errstate(all="ignore"):
        mr = np.nanmean(c[1:] / c[:-1] - 1, axis=1)
    mcum = np.concatenate([[1.0], np.cumprod(1 + np.nan_to_num(mr))])
    cut = int(c.shape[0] * CUT)
    cost = PB.COST_RT[mk]
    res = {}
    for nm, sig in S.items():
        best = None
        for stop, tp, hold in EXITS:
            a = sim(sig, c, h, l, mcum, cost, stop, tp, hold)
            tr, ho = stat(a[a[:, 0] < cut]), stat(a[a[:, 0] >= cut])
            if tr["n"] >= 30 and (best is None or tr["pf"] > best["train"]["pf"]):
                best = {"train": tr, "hold": ho, "exit": {"stop": stop, "tp": tp, "hold": hold}}
        if best:
            ho = best["hold"]
            best["enable"] = bool(ho.get("n", 0) >= MIN_HO_N and ho.get("pf", 0) >= MIN_PF and best["train"]["pf"] >= 1.0 and ho.get("exMkt", -1) > 0)
        res[nm] = best
        print(mk, nm, json.dumps(best, ensure_ascii=False), flush=True)
    return res


if __name__ == "__main__":
    r = main(sys.argv[1])
    if len(sys.argv) > 2:
        json.dump(r, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
