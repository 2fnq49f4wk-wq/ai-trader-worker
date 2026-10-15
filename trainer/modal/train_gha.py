"""[V33.548] 위원회 학습 단계(train_job)를 GitHub Actions 러너(공개 저장소 → 무료 · 분 무제한 · 4코어 16GB)에서 돌린다.
사용자 10/11: "학습을 클라우드플레어·유료 말고 무료로 외부에서". Modal 은 월 $30 크레딧(사용량 한도)이라 무제한 무료가 아니다.
train_job 을 ★그대로★ 부른다(.local — Modal 클라우드 호출 없음): 표본 수집·학습·신뢰 관문·업로드가 Modal 회차와 같은 코드다.
modal.Dict(단계 실측 저장소)는 인증이 없어 열리지 않는다 → train_job 이 이미 '없으면 기본값' 으로 물러선다.
환경: BASE_URL, TRAIN_KEY, TRAIN_TARGET(단계 이름 · 기본 ablate — 아무것도 올리지 않는 실험대)."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import modal_train as mt  # noqa: E402

target = os.environ.get("TRAIN_TARGET") or "ablate"
# [V33.617] 위원회(AI_PRIMARY) 학습 퇴역 — FORCE_COMMITTEE=1 일 때만 돈다.
if os.environ.get("FORCE_COMMITTEE") != "1":
    print("   · [퇴역] 위원회 학습은 중단됨(V33.617 · OMNI-Q·매매법 AI 에 집중) — 강제로 돌리려면 FORCE_COMMITTEE=1")
    raise SystemExit(0)
# [V33.609] 위원회 모델 퇴역 — 미국·한국 둘 다 매매법 AI 가 주력(검증 통과 · 신선)이면 위원회 학습을 하지 않는다(워커 pbPrimaryOn 과 같은 판정).
try:
    import time as _t
    import requests as _rq
    _j = _rq.get(os.environ["BASE_URL"].rstrip("/") + "/api/playbook", timeout=30).json()
    _ok = lambda v: bool(v and v.get("pass", {}).get("daily") and (_t.time() * 1000 - (v.get("ts") or 0)) <= 36 * 3600 * 1000)  # noqa: E731
    if all(_ok((_j.get("markets") or {}).get(m)) for m in ("us", "kr")) and os.environ.get("FORCE_COMMITTEE") != "1":
        print("   · [퇴역] 매매법 AI 가 미·한 주력 — 위원회 학습 건너뜀(강제로 돌리려면 FORCE_COMMITTEE=1)")
        raise SystemExit(0)
except SystemExit:
    raise
except Exception as _e:  # noqa: BLE001
    print("   · 매매법 AI 상태 확인 실패(%s) — 종전대로 학습" % _e)
if target in ("all", "dnn"):
    raise SystemExit("GitHub Actions 러너엔 GPU 가 없다 — all·dnn 은 Modal 에서만(단계 이름을 고르라)")
fn = mt.train_job
run = getattr(fn, "local", None)
res = run(target=target) if callable(run) else fn(target=target)
print("   · train_gha 끝:", res)
