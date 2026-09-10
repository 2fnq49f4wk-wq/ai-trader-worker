"""Codex V33.346: all required external models must be current, not just the youngest."""
import json
import math
import sys

REQUIRED = ("mind", "dnn", "gbdt", "xgb", "lgb", "cat")

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
