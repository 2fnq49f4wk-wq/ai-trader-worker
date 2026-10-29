"""[V33.704] 한국 수급(외국인·기관 순매수) — 사용자 10/29 "수급 데이터부터 넣어서 한국장 성능 끌어올려".

원천: 네이버 m.stock.naver.com/api/stock/{code}/trend (한 쪽 60거래일 · bizdate 로 과거로 넘김 · 2016년부터 있음).
GHA 캐시(~/.pbflow/flow_kr.json)에 쌓고, 회차마다 마지막 날짜 이후만 받는다(첫 회차 ≈ 종목당 42쪽 · 이후 종목당 1쪽).
워커 D1 은 쓰지 않는다(학습기가 직접 받는다).

실험실(lab/r4/flowlab.py · flow3.py · [0,80%) 만): 지난 20일 (외국인+기관 순매수)/거래량 이 높은 종목일수록 다음 20일 시장 대비 덜 올랐다
(하위 50% − 상위 50% = 2016~2024 연 +0.3~+1.0%p · 지난 20일 수익을 통제해도 같은 방향) — '이미 몰린 종목' 회피 신호.
쓰는 곳: 매매법 AI 규칙 후보 'fveto'(수급 과열 상위 10% 제외) — 검증 구간 [60,80%) 이 고를 때만 쓰인다."""
import json
import os
import time

import numpy as np
import pandas as pd

CACHE = os.path.expanduser(os.environ.get("PB_FLOW_CACHE", "~/.pbflow/flow_kr.json"))
START = 20160901
WIN = 20


def _num(v):
    try:
        return float(str(v).replace(",", "").replace("+", "").replace("%", ""))
    except Exception:  # noqa: BLE001
        return None


def _get(S, code, last_have):
    rows, bd = {}, None
    for _ in range(50):
        url = "https://m.stock.naver.com/api/stock/%s/trend?pageSize=60%s" % (code, "&bizdate=%d" % bd if bd else "")
        a = None
        for t in range(3):
            try:
                r = S.get(url, timeout=20)
                if r.status_code == 200:
                    a = r.json()
                    break
            except Exception:  # noqa: BLE001
                pass
            time.sleep(1 + t)
        if not isinstance(a, list) or not a:
            break
        for x in a:
            try:
                f, o = _num(x.get("foreignerPureBuyQuant")), _num(x.get("organPureBuyQuant"))
                if f is not None and o is not None:
                    rows[int(x["bizdate"])] = [f, o]
            except Exception:  # noqa: BLE001
                pass
        last = int(a[-1]["bizdate"])
        if last < START or len(a) < 60 or (last_have and last <= last_have):
            break
        bd = last
    return rows


def update(syms, log=print, budget_s=1800):
    """캐시를 읽고 모자란 날만 받아 저장 → {sym: {yyyymmdd: [외국인, 기관]}}. 실패해도 있는 것만 돌려준다."""
    import requests
    from concurrent.futures import ThreadPoolExecutor
    data = {}
    try:
        with open(CACHE) as f:
            data = {s: {int(k): v for k, v in d.items()} for s, d in json.load(f).items()}
    except Exception:  # noqa: BLE001
        data = {}
    S = requests.Session()
    S.headers.update({"User-Agent": "Mozilla/5.0", "Referer": "https://m.stock.naver.com/"})
    t0 = time.time()
    todo = [s for s in syms if s.endswith((".KS", ".KQ"))]

    def one(s):
        if time.time() - t0 > budget_s:
            return s, None
        have = data.get(s) or {}
        return s, _get(S, s.split(".")[0], max(have) if have else None)

    got = 0
    with ThreadPoolExecutor(8) as ex:
        for s, r in ex.map(one, todo):
            if r:
                data.setdefault(s, {}).update(r)
                got += 1
    try:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        with open(CACHE, "w") as f:
            json.dump({s: {str(k): v for k, v in d.items()} for s, d in data.items()}, f)
    except Exception as e:  # noqa: BLE001
        log("   ⚠️ [수급] 캐시 저장 실패 %s" % e)
    n_full = sum(1 for d in data.values() if len(d) > 2000)
    log("   · [수급] 한국 %d종목 갱신 · 캐시 %d종목(10년 가까이 %d) · %.0fs" % (got, len(data), n_full, time.time() - t0))
    return data


def crowd_rank(P, data):
    """t×j — 지난 20거래일 (외국인+기관 순매수 합)/(거래량 합) 의 그날 횡단면 백분위, ★하루 늦춤★(t 에는 t−1 까지만).
    없으면 NaN(규칙이 거르지 않는다)."""
    idx, cols = P["close"].index, P["close"].columns
    fo = pd.DataFrame({s: pd.Series({d: v[0] + v[1] for d, v in (data.get(s) or {}).items()}, dtype=float).reindex(idx) for s in cols})
    vol = P["volume"].reindex(index=idx, columns=cols).astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        x = fo.rolling(WIN, min_periods=int(WIN * .7)).sum() / vol.rolling(WIN, min_periods=int(WIN * .7)).sum()
    r = x.rank(axis=1, pct=True)
    return r.shift(1).values, r.values[-1]
