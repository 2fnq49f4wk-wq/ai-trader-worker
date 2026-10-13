"""[V33.542] OMNI-Q 를 GitHub Actions(공개 저장소 → 무료 · 시간 무제한 · 4코어 16GB)에서 돌린다.
사용자 10/11: "학습을 클라우드플레어·유료 말고 무료로 외부에서". Modal 은 월 $30 크레딧(사용량 한도) — 무제한 무료가 아니다.
같은 omni_q.run 을 그대로 부른다(학습·관문·업로드 동일). 환경: BASE_URL, TRAIN_KEY, (선택) OMNIQ_LAB=1 · OMNIQ_MODE · OMNIQ_CACHE.
[V33.584] 학습은 금요일 한 번 · 평일은 캐시 모델로 채점만."""
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
# [V33.584] 학습은 금요일 한 번 — 평일 회차는 GHA 캐시의 금요일 모델로 그날 피처만 채점한다(omni_q.should_train).
#   연구 회차(OMNIQ_LAB=1)는 언제나 학습한다. OMNIQ_MODE=train/score 로 강제할 수 있다.
CACHE = os.environ.get("OMNIQ_CACHE") or os.path.expanduser("~/.omniq/models.pkl")
MODE = "train" if os.environ.get("OMNIQ_LAB") == "1" else (os.environ.get("OMNIQ_MODE") or "auto")
cache = omni_q.load_cache(CACHE)
cache.pop("_trained", None)
print("   · 모델 캐시 %s · 방식 %s" % ("있음(" + ",".join(k for k in cache if not k.startswith("_")) + ")" if cache else "없음", MODE))
omni_q.run(daily, mkt, omni.day_key_of_daily, BASE=BASE, HDR=HDR, upload=True, log=print, cache=cache, mode=MODE)
trained = bool(cache.pop("_trained", False))
if trained:
    omni_q.save_cache(CACHE, cache)
    print("   · 금요일 모델을 캐시에 저장 — 다음 금요일까지 평일 회차가 이 모델로 채점한다")
gho = os.environ.get("GITHUB_OUTPUT")
if gho:
    with open(gho, "a") as f:
        f.write("trained=%s\n" % ("true" if trained else "false"))
print("   · OMNI-Q(GitHub Actions) 끝 %.0fs" % (time.time() - t0))
