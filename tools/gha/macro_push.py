"""[V33.598] 미국 경제지표(CPI·근원 CPI·PPI·실업률·근원 PCE)를 GitHub Actions(무료)에서 받아 워커에 올린다.
왜: 워커에서 FRED CSV 가 실패하고(10/14 22:42Z) BLS 무키 API 는 공유 IP 하루 25회 한도에 걸린다 → 9월 CPI 를 하루 넘게 못 받았다.
GHA 러너는 회차마다 다른 IP 라 한도에 덜 걸리고, 큰 BLS 원본 파일도 받을 수 있다. 순서: BLS API → BLS 원본 파일 → FRED.
워커(/api/macro-push)는 관측월이 지금 값보다 새로울 때만 받는다(지어내지 않는다 · 되돌리지 않는다). 표준 라이브러리만 쓴다."""
import csv
import io
import json
import os
import sys
import urllib.request

BASE = os.environ["BASE_URL"].rstrip("/")
KEY = os.environ["TRAIN_KEY"]
UA = {"User-Agent": "ai-trader-worker macro sync (github actions) " + os.environ.get("CONTACT", "noreply@github.com")}
SER = {"cpi": ("CUUR0000SA0", "yoy", "cu"), "core_cpi": ("CUUR0000SA0L1E", "yoy", "cu"), "ppi": ("WPUFD4", "yoy", "wp"),
       "unemployment": ("LNS14000000", "level", "ln")}
FRED = {"cpi": "CPIAUCNS", "core_cpi": "CPILFENS", "ppi": "PPIFIS", "unemployment": "UNRATE", "core_pce": "PCEPILFE"}


def get(url, data=None, timeout=60, headers=None):
    req = urllib.request.Request(url, data=data, headers=dict(UA, **(headers or {})))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def bls_api():
    body = json.dumps({"seriesid": [v[0] for v in SER.values()], "startyear": "2025", "endyear": "2026"}).encode()
    j = json.loads(get("https://api.bls.gov/publicAPI/v2/timeseries/data/", body, headers={"Content-Type": "application/json"}))
    if j.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError("BLS API " + str(j.get("message"))[:120])
    out = {}
    for s in j["Results"]["series"]:
        rows = []
        for x in s["data"]:
            if not x["period"].startswith("M") or x["period"] == "M13":
                continue
            try:
                rows.append((x["year"] + "-" + x["period"][1:] + "-01", float(x["value"])))
            except ValueError:
                pass
        out[s["seriesID"]] = sorted(rows)
    return out


def fred(id_):
    t = get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + id_, timeout=60).decode()
    rows = []
    for r in csv.reader(io.StringIO(t)):
        if len(r) >= 2 and r[0][:2] in ("19", "20"):
            try:
                rows.append((r[0], float(r[1])))
            except ValueError:
                pass
    return rows


def value(kind, rows):
    if not rows:
        return None
    d, v = rows[-1]
    ym, mon = d[:7], int(d[5:7])
    if kind == "yoy":
        prev = dict((r[0][:7], r[1]) for r in rows).get(str(int(d[:4]) - 1) + d[4:7])
        if not prev:
            return None
        return {"value": "%.1f" % ((v / prev - 1) * 100), "asOf": "%s (%d월분)" % (ym, mon), "obsDate": d}
    return {"value": ("%.1f" % v), "asOf": "%s (%d월분)" % (ym, mon), "obsDate": d}


out, src = {}, {}
try:
    B = bls_api()
    for k, (sid, kind, _) in SER.items():
        v = value(kind, B.get(sid))
        if v:
            out[k] = dict(v, source="BLS " + sid, source_url="https://data.bls.gov/timeseries/" + sid)
    print("BLS API:", sorted(out))
except Exception as e:  # noqa: BLE001
    print("BLS API 실패:", e)
for k, id_ in FRED.items():
    if k in out:
        continue
    try:
        v = value("level" if k == "unemployment" else "yoy", fred(id_))
        if v:
            out[k] = dict(v, source="FRED " + id_, source_url="https://fred.stlouisfed.org/series/" + id_)
            print("FRED", k, v["asOf"], v["value"])
    except Exception as e:  # noqa: BLE001
        print("FRED 실패", k, e)
print(json.dumps(out, ensure_ascii=False))
if not out:
    sys.exit(1)
r = get(BASE + "/api/macro-push", json.dumps({"us": out}).encode(), headers={"Content-Type": "application/json", "x-train-key": KEY})
print("워커:", r.decode()[:400])
