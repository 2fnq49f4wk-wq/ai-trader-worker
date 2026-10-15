"""[V33.542] OMNI-Q 를 GitHub Actions(공개 저장소 → 무료 · 시간 무제한 · 4코어 16GB)에서 돌린다.
사용자 10/11: "학습을 클라우드플레어·유료 말고 무료로 외부에서". Modal 은 월 $30 크레딧(사용량 한도) — 무제한 무료가 아니다.
같은 omni_q.run 을 그대로 부른다(학습·관문·업로드 동일). 환경: BASE_URL, TRAIN_KEY, (선택) OMNIQ_LAB=1 · OMNIQ_MODE · OMNIQ_CACHE.
[V33.585] 기본은 회차마다 학습 · 채점만(캐시 모델)은 선택지."""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("OMNI_THREADS", str(os.cpu_count() or 4))

import requests  # noqa: E402
import omni  # noqa: E402
import omni_q  # noqa: E402

BASE = os.environ["BASE_URL"].rstrip("/")
HDR = {"x-train-key": os.environ["TRAIN_KEY"]}
t0 = time.time()
r = requests.get(BASE + "/api/omni-bars-index", headers=HDR, timeout=60)
r.raise_for_status()
j = r.json()
ix = (j.get("index") or {}).get("s") or {}
syms = sorted(set(ix) | set(j.get("universe") or []))
mkt = {s: ((ix.get(s) or {}).get("m") or ("kr" if s.endswith((".KS", ".KQ")) else "us")) for s in syms}
daily = {}
for got in omni._get_bars(BASE, HDR, syms, "1d", print):
    daily.update(got)
print("   · 일봉 %d종목 수신 (%.0fs) · 코어 %s" % (len(daily), time.time() - t0, os.environ["OMNI_THREADS"]))
# [V33.585] 기본은 회차마다 학습(하루 2회 · 사용자 10/13 "내부 cpu 안 쓰는 학습은 일일 2회 유지").
#   OMNIQ_MODE=auto(금요일만 학습) · score(캐시 모델로 채점만)는 수동 선택지. 연구 회차(OMNIQ_LAB=1)는 언제나 학습.
CACHE = os.environ.get("OMNIQ_CACHE") or os.path.expanduser("~/.omniq/models.pkl")
MODE = "train" if os.environ.get("OMNIQ_LAB") == "1" else (os.environ.get("OMNIQ_MODE") or "train")
cache = omni_q.load_cache(CACHE)
cache.pop("_trained", None)
print("   · 모델 캐시 %s · 방식 %s" % ("있음(" + ",".join(k for k in cache if not k.startswith("_")) + ")" if cache else "없음", MODE))
# [V33.615] 실적(미국)·뉴스(한국) 이력 — OMNI-Q 피처와 매매법 선택 AI 가 같이 쓴다(한 번만 받는다)
EV = {"us": {}, "kr": {}}
try:
    EV["us"]["earn"] = omni.get_earn(BASE, HDR, [s for s in daily if mkt.get(s) == "us"], print)
except Exception as e:  # noqa: BLE001
    print("   ⚠️ 실적 이력 못 받음: %s" % e)
try:
    EV["kr"]["news"] = omni.get_news(BASE, HDR, [s for s in daily if mkt.get(s) == "kr"], print)
except Exception as e:  # noqa: BLE001
    print("   ⚠️ 뉴스 이력 못 받음: %s" % e)
omni_q.EVENTS = EV
# [V33.620] 거시·섹터 피처 — 미국 ETF(SPY·TLT·GLD·섹터 XL*·SMH) 일봉을 날짜 키로 · FRED 월별 거시(서프라이즈) + 연방기금금리
try:
    _etf = {}
    for s_ in ("SPY", "TLT", "GLD") + omni_q.SECTOR_ETFS:
        bd = daily.get(s_)
        if bd and bd.get("t") and bd.get("c"):
            _etf[s_] = {int(omni.day_key_of_daily(t)): float(c) for t, c in zip(bd["t"], bd["c"]) if c}
    omni_q.MACRO = {"etf": _etf, "fred": omni_q.fetch_fred(print)}
    print("   · 거시·섹터 ETF %d종" % len(_etf))
except Exception as e:  # noqa: BLE001
    print("   ⚠️ 거시 자료 못 받음: %s" % e)
omni_q.run(daily, mkt, omni.day_key_of_daily, BASE=BASE, HDR=HDR, upload=True, log=print, cache=cache, mode=MODE)
# [V33.594] 페어(PR_OU) — 같은 일봉으로 전 종목 공적분 페어 + 표본 밖 걷기 검증(워커 CPU 0). 실패해도 OMNI-Q 는 살린다.
try:
    import pairs_ext  # noqa: E402
    pairs_ext.run(daily, mkt, omni.day_key_of_daily, BASE=BASE, HDR=HDR, upload=True, log=print)
except Exception as e:  # noqa: BLE001
    print("   ⚠️ [페어] 실패: %s" % e)
# [V33.602] 매매법 선택 AI(Strategy-Router) — 도감 17종 표본 + 걷기 검증 · 그림자(주문 영향 없음). 실패해도 OMNI-Q 는 살린다.
try:
    import strategy_router  # noqa: E402
    ev = EV   # [V33.615] 위에서 한 번 받은 실적·뉴스
    strategy_router.run(daily, mkt, omni.day_key_of_daily, BASE=BASE, HDR=HDR, upload=True, log=print, omni_x=omni_q.LAST_X, events=ev)
except Exception as e:  # noqa: BLE001
    print("   ⚠️ [매매법AI] 실패: %s" % e)
# [V33.607] ★매매법 모의 시뮬(Playbook-Sim)★ — 과거 전 종목에 모든 매매법을 가상 적용 → 상황 칸별 성공확률·평균 표(일봉 + 5분 단타).
#   워커가 매 분 OMNI-Q 상위 종목의 지금 상황 칸을 계산해 이 표에서 매매법을 고른다. 5분봉은 거래대금 상위 PB_INTRA_N 종목만(시간).
try:
    import numpy as _np  # noqa: E402
    import playbook_sim  # noqa: E402
    import strategy_router as _sr  # noqa: E402
    PB_INTRA_N = int(os.environ.get("PB_INTRA_N", "150"))
    b5 = {}
    for _m in ("us", "kr"):
        liq = []
        for s_, bd in daily.items():
            if mkt.get(s_) != _m or not bd or not bd.get("c") or not bd.get("v") or s_.startswith("^"):
                continue
            c_, v_ = _np.asarray(bd["c"][-20:], dtype=float), _np.asarray(bd["v"][-20:], dtype=float)
            liq.append((float(_np.nanmean(c_ * v_)), s_))
        top = [s_ for _, s_ in sorted(liq, reverse=True)[:PB_INTRA_N]]
        t5 = time.time()
        for got in omni._get_bars(BASE, HDR, top, "5m", print):
            b5.update(got)
        print("   · [매매법시뮬] %s 5분봉 %d종목 수신 (%.0fs)" % (_m, sum(1 for s_ in top if s_ in b5), time.time() - t5))
    playbook_sim.run(daily, mkt, omni.day_key_of_daily, BASE=BASE, HDR=HDR, upload=True, log=print, bars5=b5,
                     ev_dates=sorted(set(_sr.FOMC) | set(_sr.CPI)), oos=omni_q.LAST_OOS)
except Exception as e:  # noqa: BLE001
    print("   ⚠️ [매매법시뮬] 실패: %s" % e)
trained = bool(cache.pop("_trained", False))
if trained:
    omni_q.save_cache(CACHE, cache)
    print("   · 금요일 모델을 캐시에 저장 — 다음 금요일까지 평일 회차가 이 모델로 채점한다")
gho = os.environ.get("GITHUB_OUTPUT")
if gho:
    with open(gho, "a") as f:
        f.write("trained=%s\n" % ("true" if trained else "false"))
print("   · OMNI-Q(GitHub Actions) 끝 %.0fs" % (time.time() - t0))
