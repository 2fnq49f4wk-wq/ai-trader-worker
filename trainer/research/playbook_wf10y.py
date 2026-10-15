"""[V33.626] 매매법 선택의 10년 걷기 검증(연구용 · CI·배포에서 안 돈다).

학습기 playbook_sim.validate 와 ★같은★ 3구간(표 60% · 규칙 고르기 20% · 판정 20%)을 500 거래일 창으로 100일씩 밀며 반복한다.
판정 구간 하나(최근 ~5개월)는 한 번의 표본일 뿐이라, 10년 동안 같은 절차를 17~18번 돌려 '이 구조가 평소에 버는가' 를 본다.

  python trainer/research/playbook_wf10y.py fetch     # 야후 10년 일봉(DEFAULT_US·DEFAULT_KR) → ./wf_px/
  python trainer/research/playbook_wf10y.py run us    # 시뮬 + 걷기 검증 요약

주의: 지금 유니버스(현재 시총 상위)를 과거에 적용 — 생존 편향(특히 한국 모멘텀이 부풀려진다). 상대 비교용.
2026-10-15 실측(공황 차단 포함 · OMNI-Q 후보 거름 없음): 미 18구간 평균 −0.52%/거래 · 무작위 대비 −0.29%p(t −3.1) · 양수 0 · 통과 0
  · 한 17구간 −0.38% · 무작위 대비 +0.04%p · 양수 6 · 통과 1. 규칙을 '매매법 전체'·'세밀 칸'·'성적 스위치' 하나로 고정해도 전부 음.
"""
import datetime as dt
import json
import os
import re
import sys
import time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "modal"))
import playbook_sim as PB  # noqa: E402

PX = os.environ.get("WF_PX", "wf_px")
OFF = {"us": -4 * 3600, "kr": 9 * 3600}
W, STEP = 500, 100


def universe():
    S = open(os.path.join(HERE, "..", "..", "src", "index.js"), encoding="utf8").read()
    out = {}
    for mk, nm in (("us", "DEFAULT_US"), ("kr", "DEFAULT_KR")):
        i = S.index("const %s = [" % nm)
        out[mk] = re.findall(r'"([^"]+)"', S[i:S.index("];", i)])
    return out


def fetch():
    import concurrent.futures as cf
    import requests
    os.makedirs(PX, exist_ok=True)

    def get(s):
        fn = os.path.join(PX, s + ".json")
        if os.path.exists(fn):
            return True
        for k in range(3):
            try:
                r = requests.get("https://query1.finance.yahoo.com/v8/finance/chart/%s?range=10y&interval=1d" % s, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
                j = r.json()["chart"]["result"][0]
                q = j["indicators"]["quote"][0]
                json.dump({"t": j["timestamp"], "o": q["open"], "h": q["high"], "l": q["low"], "c": q["close"], "v": q["volume"]}, open(fn, "w"))
                return True
            except Exception:  # noqa: BLE001
                time.sleep(1 + k)
        return False
    U = universe()
    with cf.ThreadPoolExecutor(8) as ex:
        print("ok", sum(ex.map(get, U["us"] + U["kr"])))


def panel(mk):
    cols = {k: {} for k in "ohlcv"}
    for s in universe()[mk]:
        fn = os.path.join(PX, s + ".json")
        if not os.path.exists(fn):
            continue
        d = json.load(open(fn))
        if not d["t"] or len(d["t"]) < 300:
            continue
        idx = [int(dt.datetime.utcfromtimestamp(t + OFF[mk]).strftime("%Y%m%d")) for t in d["t"]]
        for k in "ohlcv":
            ser = pd.Series(d[k], index=idx, dtype=float)
            cols[k][s] = ser[~ser.index.duplicated(keep="last")]
    P = {nm: pd.DataFrame(cols[k]).sort_index() for k, nm in zip("ohlcv", ("open", "high", "low", "close", "volume"))}
    keep = P["close"].notna().sum(axis=1) >= 0.5 * P["close"].shape[1]
    P = {k: v.loc[keep] for k, v in P.items()}
    for nm in ("open", "high", "low"):
        P[nm] = P[nm].where(P[nm] > 0, P["close"])
    return P


def walk(df):
    T = int(df["t"].max()) + 1
    out = []
    for E in range(250 + W, T + 1, STEP):
        sub = df[(df["t"] >= E - W) & (df["t"] < E) & (df["x"] < E)]   # 창 끝 뒤에 끝나는 거래는 학습기처럼 안 보인다
        st, _ = PB.validate(sub, "t")
        out.append({"E": E, "n": st["n"], "mean": st["mean"], "base": st["base"], "t": st["t"], "pass": st["pass"], "rule": st["rule"]})
    m = np.array([o["mean"] or 0 for o in out]); d = m - np.array([o["base"] or 0 for o in out])
    return out, {"windows": len(out), "avgMean": round(float(m.mean()), 3), "avgEdge": round(float(d.mean()), 3),
                 "edgeT": round(float(d.mean() / (d.std(ddof=1) / np.sqrt(len(d)))), 2), "posWin": int((m > 0).sum()), "pass": int(sum(o["pass"] for o in out))}


if __name__ == "__main__":
    if sys.argv[1] == "fetch":
        fetch()
    else:
        mk = sys.argv[2]
        PB.BASE_DRAWS = 8
        P = panel(mk)
        df, _, _ = PB.sim_daily(P, mk, [])
        out, sm = walk(PB._relevel(df))
        for o in out:
            print(json.dumps(o, ensure_ascii=False))
        print("SUMMARY", mk, json.dumps(sm))
