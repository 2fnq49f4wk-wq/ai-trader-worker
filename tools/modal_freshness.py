"""Codex V33.346: all required external models must be current, not just the youngest."""
import json
import math
import sys

# [V33.527] dnn 은 V33.422 에서 퇴역 — 워커 /api/ai/selfcheck 의 externalTrain 에 키 자체가 없다.
#   그런데 여기 남아 있어 나이가 늘 9999 → 워치독이 ★6시간마다 무조건 GPU 학습★ 을 돌렸다(10/06~10/08 정기 회차 전부 '학습 실행').
#   워커가 내보내는 키(_mm)와 같아야 한다 — check-recovery-provenance 가 대조한다.
REQUIRED = ("mind", "gbdt", "xgb", "lgb", "cat")

def oldest_required_age(payload):
    models = payload.get("externalTrain") or {}
    ages = []
    for name in REQUIRED:
        model = models.get(name) or {}
        age = model.get("ageH")
        if (model.get("external") is not True or model.get("trained") is not True
                or model.get("wantVer") is None or model.get("featVer") != model.get("wantVer")
                or isinstance(age, bool) or not isinstance(age, (int, float))
                or not math.isfinite(age) or age < 0):
            return 9999
        ages.append(age)
    return max(ages)

if __name__ == "__main__":
    try:
        print(oldest_required_age(json.load(sys.stdin)))
    except (ValueError, TypeError, AttributeError):
        print(9999)
