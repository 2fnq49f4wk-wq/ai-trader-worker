"""[V33.542] OMNI-Q 를 GitHub Actions(공개 저장소 → 무료 · 시간 무제한 · 4코어 16GB)에서 돌린다.
사용자 10/11: "학습을 클라우드플레어·유료 말고 무료로 외부에서". Modal 은 월 $30 크레딧(사용량 한도) — 무제한 무료가 아니다.
같은 omni_q.run 을 그대로 부른다(학습·관문·업로드 동일). 환경: BASE_URL, TRAIN_KEY, (선택) OMNIQ_LAB=1."""
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
omni_q.run(daily, mkt, omni.day_key_of_daily, BASE=BASE, HDR=HDR, upload=True, log=print)
print("   · OMNI-Q(GitHub Actions) 끝 %.0fs" % (time.time() - t0))
