"""[V33.719] 한국 업종(네이버 industryCode · 64업종) — 업종 안 상대 강도 실험(A/B 실험판 PB_VARIANT=secrev 에서만 쓴다).

원천: m.stock.naver.com/api/stock/{code}/integration 의 industryCode. GHA 캐시(~/.pbflow/ind_kr.json)에 두고 30일마다 다시 받는다.
실험실(lab/r4/sec.py · sec2.py · [0,80%) 만): 하락·폭락장 날 업종 안 20일 상대 강도 하위 20% 가 상위 20% 보다
다음 20일 시장 대비 더 올랐다(폭락 +2.4%p · 하락 +1.2%p · 약세 날 연도별 17년 중 16년 양수). 이를 '약세장에서 업종 안 앞서 달린 종목 빼기' 로 시험한다."""
import json
import os
import time

import numpy as np
import pandas as pd

CACHE = os.path.expanduser(os.environ.get("PB_IND_CACHE", "~/.pbflow/ind_kr.json"))
REFRESH_S = 30 * 86400
WEAK = ("BEAR", "CRASH")   # 사전 등록(실험실 [0,80%))
TOP = 0.8
WIN = 20


def update(syms, log=print):
    """{sym: industryCode} — 캐시가 30일 안이면 그대로, 아니면 다시 받는다. 실패해도 있는 것만."""
    data, ts = {}, 0
    try:
        with open(CACHE) as f:
            j = json.load(f)
        data, ts = j.get("ind") or {}, j.get("ts") or 0
    except Exception:  # noqa: BLE001
        pass
    todo = [s for s in syms if s.endswith((".KS", ".KQ")) and (s not in data or time.time() - ts > REFRESH_S)]
    if todo:
        import requests
        from concurrent.futures import ThreadPoolExecutor
        S = requests.Session()
        S.headers.update({"User-Agent": "Mozilla/5.0", "Referer": "https://m.stock.naver.com/"})

        def one(s):
            for t in range(3):
                try:
                    r = S.get("https://m.stock.naver.com/api/stock/%s/integration" % s.split(".")[0], timeout=20)
                    if r.status_code == 200:
                        return s, r.json().get("industryCode")
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(1 + t)
            return s, data.get(s)

        with ThreadPoolExecutor(8) as ex:
            for s, v in ex.map(one, todo):
                if v is not None:
                    data[s] = v
        try:
            os.makedirs(os.path.dirname(CACHE), exist_ok=True)
            with open(CACHE, "w") as f:
                json.dump({"ts": time.time(), "ind": data}, f)
        except Exception as e:  # noqa: BLE001
            log("   ⚠️ [업종] 캐시 저장 실패 %s" % e)
    log("   · [업종] 한국 %d종목 업종 · %d업종 · 새로 받음 %d" % (len(data), len(set(data.values())), len(todo)))
    return data


def rel_rank(P, ind, n=WIN):
    """t×j — 지난 n일 수익 − 같은 업종 평균(그날 횡단면 백분위) ★하루 늦춤★. 업종 3종목 미만·없음은 NaN(거르지 않음)."""
    C = P["close"]
    cols = list(C.columns)
    sec = np.array([str(ind.get(s, "")) for s in cols])
    r = C / C.shift(n) - 1
    sm = pd.DataFrame(np.nan, index=C.index, columns=cols)
    for g in np.unique(sec):
        if not g:
            continue
        m = sec == g
        if m.sum() < 3:
            continue
        sm.loc[:, m] = np.repeat(r.loc[:, m].mean(axis=1).values[:, None], m.sum(), axis=1)
    rel = (r - sm).rank(axis=1, pct=True)
    return rel.shift(1).values


def veto_mask(P, ind, reg5):
    """t×j bool — True = 후보에서 뺀다: 어제 국면이 약세(하락·폭락) · 어제 업종 안 20일 상대 강도 상위 20%."""
    rr = rel_rank(P, ind)
    rg = np.asarray(reg5).astype(str)
    weak = np.concatenate([[False], np.isin(rg[:-1], WEAK)])[:, None]
    return weak & (np.nan_to_num(rr, nan=0.0) >= TOP)
