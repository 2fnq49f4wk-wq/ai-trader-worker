# -*- coding: utf-8 -*-
"""
[V33.420] OMNI 자가검사 — 합성 시장에서 학습기 전 과정을 돌린다(네트워크 없음).

  ① 합성 봉(미국·한국, 서머타임 경계 포함) → build_rows → 학습 → 홀드아웃 평가
  ② ★심은 신호를 찾는가★ — 5분봉 수익률에 자기상관을 심는다. 찾으면 30분 머리 AUC 가 0.5 를
     분명히 넘어야 한다. 반대로 신호를 끄면 ★못 찾아야★ 한다(발언 0 — 잡음에서 말하지 않는다).
  ③ 내보낸 나무(export_tree)를 기준 채점기(score_tree)로 채점한 값 = lgb.predict(raw_score)
     — 장타 행(장중 칸이 NaN)을 반드시 포함한다.
  ④ --fixture PATH 면 워커 JS 채점기 검사용 고정물(작은 모델 + 행 + 기대값)을 쓴다.

실행:  python3 omni_selftest.py            (검사)
       python3 omni_selftest.py --fixture ../../tools/fixtures/omni-model.json
"""
import math
import random
import sys
import datetime as dt

import omni

NSYM = 80        # 시장별 40종목 — PANEL_MIN(20) 을 넘겨야 횡단면 칸이 실제로 생긴다
RHO = 0.4          # 심는 5분봉 자기상관 — 원피처(m_r3) 하나로 AUC ≈ 0.58 이 나오는 세기


def _sessions(start, ndays, mkt):
    """거래일마다 정규장 5분봉 시작시각(UTC초) 목록."""
    d = start
    out = []
    while len(out) < ndays:
        if d.weekday() < 5:
            if mkt == "us":
                noon = int(dt.datetime(d.year, d.month, d.day, 12, tzinfo=dt.timezone.utc).timestamp())
                off = omni.us_offset_h(noon)
                o = int(dt.datetime(d.year, d.month, d.day, 9, 30, tzinfo=dt.timezone.utc).timestamp()) - off * 3600
            else:
                o = int(dt.datetime(d.year, d.month, d.day, 0, 0, tzinfo=dt.timezone.utc).timestamp())
            out.append((d, [o + k * 300 for k in range(78)]))
        d += dt.timedelta(days=1)
    return out


def make_symbol(rng, mkt, rho, ndays_i=70, ndays_d=900, drift_mom=0.0):
    """5분봉(최근 ndays_i 거래일)과 그와 ★일관된★ 일봉(과거 ndays_d 거래일, 끝 부분은 5분봉 합산)."""
    end = dt.date(2026, 9, 18)
    start_d = end - dt.timedelta(days=int(ndays_d * 7 / 5) + 10)
    sess = _sessions(start_d, ndays_d, mkt)
    px = 50.0 + rng.random() * 100
    bd = {k: [] for k in ("t", "o", "h", "l", "c", "v")}
    b5 = {k: [] for k in ("t", "o", "h", "l", "c", "v")}
    first_intra = len(sess) - ndays_i
    prev_r = 0.0
    dmom = 0.0
    for di, (d, ts) in enumerate(sess):
        gap = rng.gauss(0, 0.006) + drift_mom * dmom
        px *= math.exp(gap)
        o_day = px
        hi = lo = px
        vol_day = 0.0
        for t in ts:
            r = rho * prev_r + rng.gauss(0, 0.0018)
            prev_r = r
            o = px
            px *= math.exp(r)
            h = max(o, px) * math.exp(abs(rng.gauss(0, 0.0006)))
            l = min(o, px) * math.exp(-abs(rng.gauss(0, 0.0006)))
            v = float(int(1000 + rng.random() * 4000))
            hi, lo, vol_day = max(hi, h), min(lo, l), vol_day + v
            if di >= first_intra:
                for k, val in zip(("t", "o", "h", "l", "c", "v"), (t, o, h, l, px, v)):
                    b5[k].append(val)
        dmom = math.log(px / o_day)
        day_t = int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp())
        for k, val in zip(("t", "o", "h", "l", "c", "v"), (day_t, o_day, hi, lo, px, vol_day)):
            bd[k].append(val)
    # 수집 시점의 진행 중 봉을 흉내 낸 마지막 봉(build_rows 가 버려야 한다)
    for b in (b5, bd):
        for k in ("t", "o", "h", "l", "c", "v"):
            b[k].append(b[k][-1] + (300 if b is b5 and k == "t" else (86400 if k == "t" else 0)))
    return b5, bd


def synth(nsym, rho, seed):
    rng = random.Random(seed)
    data = {}
    for k in range(nsym):
        mkt = "us" if k % 2 == 0 else "kr"
        # [V33.425] ★종목마다 봉 수와 구멍이 다르게 만든다 — 실데이터가 그렇다.★
        #   예전 합성 시장은 모든 종목이 ★똑같은 격자★ 라, 결정시각을 '배열 끝에서 N봉마다' 로
        #   잡는 버그를 자가검사가 통째로 못 봤다(합성에서는 우연히 맞아떨어진다).
        #   구멍(거래정지·저유동)과 다른 이력 길이·수집 지연을 넣어 두면, 격자가 절대 시계에
        #   안 걸린 순간 횡단면 묶음이 무너지고 아래 검사가 바로 잡는다.
        b5, bd = make_symbol(rng, mkt, rho, ndays_i=70 - (k % 4), drift_mom=0.0)
        keep = [i for i in range(len(b5["t"]) - 1) if rng.random() > 0.015] + [len(b5["t"]) - 1]
        b5 = {f: [b5[f][i] for i in keep] for f in ("t", "o", "h", "l", "c", "v")}
        if k % 7 == 0:                      # 수집이 하루 늦은 종목 — 일봉 격자의 홀짝이 갈린다
            bd = {f: bd[f][:-1] for f in ("t", "o", "h", "l", "c", "v")}
        data["S%03d%s" % (k, ".KS" if mkt == "kr" else "")] = {"m": mkt, "5m": b5, "1d": bd}
    return data


def check_parity(bst, best, A, n=400, seed=3):
    """[V33.423] ★앙상블 정합★ — 여러 시드의 평균을 '잎/S 를 먹인 나무 합' 으로 옮겼다.
    그 변환이 맞는지 여기서 확인한다(틀리면 워커가 학습 때와 다른 확률을 낸다)."""
    import numpy as np
    trees = omni.export_model(bst)
    rng = np.random.default_rng(seed)
    # 장타 행(장중 NaN)과 장중 행을 둘 다 고른다
    d_ix = np.where(A["hz"] >= 3)[0]
    i_ix = np.where(A["hz"] < 3)[0]
    pick = np.concatenate([rng.choice(d_ix, min(n // 2, len(d_ix)), replace=False),
                           rng.choice(i_ix, min(n // 2, len(i_ix)), replace=False)])
    X = A["X"][pick]
    # 결측·0 경계도 억지로 넣는다(Zero/NaN missing_type 가지를 밟게)
    X2 = X.copy()
    X2[::7, 5] = float("nan")
    X2[::11, 27] = 0.0
    X = np.vstack([X, X2])
    ref = np.mean([b.predict(X, num_iteration=it, raw_score=True) for b, it in bst], axis=0)
    mine = np.array([omni.score_raw(trees, list(x)) for x in X])
    err = float(np.max(np.abs(ref - mine)))
    nan_rows = int(np.isnan(X).any(axis=1).sum())
    return trees, X, ref, err, nan_rows


class _Resp:
    def __init__(self, obj, code=200):
        import json
        self._o, self.status_code, self.text = obj, code, json.dumps(obj)[:200]

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def json(self):
        return self._o


PANEL_DAYS = 300   # 자가검사는 최근 300일 패널이면 충분하다(합성 이력은 900일 — 전부 만들면 느리다)


def _panels(data):
    return omni.build_panels({s: d.get("1d") for s, d in data.items()},
                             {s: d["m"] for s, d in data.items()}, max_days=PANEL_DAYS)


def fake_roundtrip(data):
    """requests 를 가짜 워커로 바꿔 run() 을 끝까지 돌린다. 워커 응답 모양(index.s[sym].m/5m/1d.n ·
    bars{sym:{t,o,h,l,c,v}})은 src/index.js 의 /api/omni-bars-index · /api/omni-bars 그대로다."""
    import json
    import requests
    fails = []
    sent = {}
    index = {s: {"m": d["m"], "5m": {"n": len(d["5m"]["t"])}, "1d": {"n": len(d["1d"]["t"])}}
             for s, d in data.items()}
    # 5분봉이 없는 종목 하나 — 장타 행은 만들어야 한다
    lone = sorted(index)[0]
    index[lone]["5m"] = None
    calls = {"5m": 0, "1d": 0}

    def fget(url, params=None, headers=None, timeout=None):
        if url.endswith("/api/omni-bars-index"):
            return _Resp({"ok": True, "baseSec": 300, "index": {"v": 1, "s": index}})
        res = params["res"]
        want = params["s"].split(",")
        if len(want) > 25:
            return _Resp({"error": "too many"}, 400)
        calls[res] += 1
        return _Resp({"ok": True, "res": res, "bars": {s: data[s][res] for s in want if s in data}})

    def fpost(url, params=None, headers=None, data=None, timeout=None, json=None):
        sent["url"], sent["body"] = url, data
        return _Resp({"ok": True})

    og, op = requests.get, requests.post
    obp = omni.build_panels
    requests.get, requests.post = fget, fpost
    #   왕복 검사에서도 패널 창을 줄인다 — 재는 것은 ★배선★ 이지 패널 크기가 아니다.
    omni.build_panels = lambda d, m, max_days=PANEL_DAYS: obp(d, m, PANEL_DAYS)
    try:
        pl = omni.run("http://w", "k", {"x-train-key": "k"}, upload=True, log=lambda *a: None)
    finally:
        requests.get, requests.post = og, op
        omni.build_panels = obp
    if not sent.get("body"):
        return ["가짜 워커 왕복: 업로드가 일어나지 않았다"]
    body = json.loads(sent["body"])          # allow_nan=False 로 만든 본문 — JS 가 읽을 수 있어야 한다
    if "NaN" in sent["body"]:
        fails.append("업로드 본문에 NaN 리터럴")
    if not sent["url"].endswith("/api/omni-import"):
        fails.append("업로드 경로가 다르다: " + sent["url"])
    if len(body.get("probe") or []) < 100 or not any(None in pr["x"] for pr in body["probe"]):
        fails.append("probe 가 없거나 장타(NaN) 행이 없다")
    if calls["5m"] < 2 or calls["1d"] < 1:
        fails.append("묶음 조회가 일어나지 않았다 %s" % calls)
    if body.get("nSym") != len(data):
        fails.append("5분봉 없는 종목의 장타 행이 빠졌다(nSym %s ≠ %d)" % (body.get("nSym"), len(data)))
    print("왕복: 5분봉 조회 %d · 일봉 조회 %d · 나무 %d · probe %d · 본문 %.1f MB" % (
        calls["5m"], calls["1d"], len(body["trees"]), len(body["probe"]), len(sent["body"]) / 1e6))
    return fails


def main():
    import json
    fixture = None
    if "--fixture" in sys.argv:
        fixture = sys.argv[sys.argv.index("--fixture") + 1]
    fails = []
    # ① 신호 있음
    data = synth(NSYM, RHO, 11)
    A, tot1, nsym = omni.build_dataset(data, panels=_panels(data))
    # [V33.423] ★새 능력이 실제로 켜져 있는가★ — 안 켜져 있으면 나머지 검사는 아무것도 확인 못 한다
    import numpy as _np
    _pi = [omni.FEATS.index(k) for k in omni.PANEL_FEATS]
    _fill = float(_np.isfinite(A["X"][:, _pi]).mean())
    print("패널 칸 채움 %.1f%% · 형식알파 %d칸 · 총 %d칸" % (
        _fill * 100, sum(1 for k in omni.FEATS if k.startswith("a_")), len(omni.FEATS)))
    if _fill < 0.5:
        fails.append("횡단면(패널) 칸이 대부분 비었다 %.1f%% — 랭크가 안 만들어졌다" % (_fill * 100))
    if sum(1 for k in omni.FEATS if k.startswith("a_")) < 9:
        fails.append("형식알파 칸이 모자라다")
    # [V33.425] ★횡단면 라벨이 실제로 켜졌는가★ — 안 켜지면(시각이 종목마다 어긋나면) 묶음이
    #   전부 작아 행이 통째로 사라지거나, 기본율이 다시 시기마다 흔들린다. 둘 다 여기서 잡는다.
    _xs = (tot1 or {}).get("xsec") or {}
    print("횡단면: 묶음 %d(쓴 묶음 %d) · %d행 → %d행 · 작은묶음 −%d · 동점 −%d" % (
        _xs.get("groups", 0), _xs.get("used", 0), _xs.get("was", 0), _xs.get("kept", 0),
        _xs.get("dropSmall", 0), _xs.get("dropTie", 0)))
    if _xs.get("used", 0) < 10:
        fails.append("횡단면 묶음이 안 만들어졌다(쓴 묶음 %s) — 종목 간 결정시각이 안 맞는다" % _xs.get("used"))
    # ★격자가 절대 시계에 걸려 있는가★ — 종목마다 봉 수·구멍·수집 지연이 다른데도 같은 시각에
    #   모여야 한다. 안 걸려 있으면 묶음이 잘게 부서져 ①남는 행이 급감하고 ②평균 묶음 크기가
    #   종목 수 근처에서 한 자릿수로 떨어진다. 둘 다 본다(하나만 보면 우회할 구멍이 남는다).
    _avg = _xs.get("kept", 0) / max(1, _xs.get("used", 0))
    _rate = _xs.get("kept", 0) / max(1, _xs.get("was", 1))
    print("횡단면 정렬: 평균 묶음 %.1f종목 (시장당 %d) · 남은 비율 %.1f%%" % (_avg, NSYM // 2, _rate * 100))
    if _rate < 0.8:
        fails.append("횡단면 라벨에서 행이 %.0f%% 만 남았다 — 결정시각이 종목마다 어긋난다" % (_rate * 100))
    if _avg < 0.6 * (NSYM // 2):
        fails.append("평균 묶음이 %.1f종목뿐이다(시장당 %d) — 격자가 절대 시계에 안 걸려 있다"
                     % (_avg, NSYM // 2))
    if _xs.get("kept", 0) + _xs.get("dropSmall", 0) + _xs.get("dropTie", 0) != _xs.get("was", -1):
        fails.append("횡단면 행 수지가 안 맞는다: %s" % _xs)
    for _k, _hz in enumerate(omni.HORIZONS):
        _ix = A["hz"] == _k
        if int(_ix.sum()) < 200:
            continue
        _b = float(A["y"][_ix].mean())
        if abs(_b - 0.5) > 0.01:
            fails.append("%s 기본율이 50%%가 아니다(%.2f%%) — 횡단면 라벨이 아니다" % (_hz, _b * 100))
    # 배리어가 못 정한 행(시간초과·동시타격·σ없음)도 ★표본에 남아야★ 한다 — 버리면 미래를 조건으로
    # 건 표본이 된다(실데이터에서 1,398,261행이 그렇게 사라지고 있었다).
    if int((A["yb"] == -1).sum()) == 0:
        fails.append("배리어가 못 정한 행이 전부 사라졌다 — 미래를 조건으로 건 표본이다")
    assert A is not None and nsym == NSYM, "표본 생성 실패"
    # 진행 중 봉을 버렸는가 — 어떤 행도 마지막(가짜) 봉 시각을 결정시각으로 쓰지 않는다
    last5 = max(d["5m"]["t"][-1] for d in data.values())
    if (A["td"] >= last5 + 300).any():
        fails.append("진행 중 봉을 버리지 않았다")
    # 30·60분 라벨이 세션을 넘지 않는다
    for hk, hz in enumerate(omni.HORIZONS[:2]):
        ix = A["hz"] == hk
        if ((A["te"][ix] - A["td"][ix]) > omni.MAX_SPAN_SEC[hz]).any():
            fails.append("%s 라벨이 세션을 넘었다" % hz)
    # [V33.421] 굵은 '일봉'(월 간격)은 장타 행을 만들지 않는다 · 라벨 σ 는 밤사이 갭을 안 먹는다
    s0 = sorted(data)[0]
    bdm = {k: v[::21] for k, v in data[s0]["1d"].items()}          # 21거래일마다 하나 = 월봉 흉내
    rows_m, st_m = omni.build_rows(s0, data[s0]["m"], data[s0]["5m"], bdm)
    if st_m.get("badDaily") != 1 or any(r[2] >= 3 for r in rows_m):
        fails.append("월 간격 '일봉' 을 걸러내지 못했다")
    b5g = {k: list(v) for k, v in data[s0]["5m"].items()}
    i0 = next(k for k in range(100, len(b5g["t"])) if b5g["t"][k] - b5g["t"][k - 1] > omni.BASE_SEC)
    base = omni.intra_sigma(b5g, i0 + 10)
    for k in range(i0, len(b5g["t"])):                              # 그 개장에 +30% 갭을 심는다
        for f in ("o", "h", "l", "c"):
            b5g[f][k] *= 1.3
    if abs(omni.intra_sigma(b5g, i0 + 10) - base) > 1e-12:
        fails.append("라벨 σ 가 밤사이 갭을 먹는다")
    C, tr, ho = omni.split_cutoff(A)
    if (A["te"][tr] >= C).any() or (A["td"][ho] < C).any():
        fails.append("분할 누수 — 학습 라벨이 절단점을 넘는다")
    m, rep = omni.train_model(A)
    assert m is not None, rep
    bst, best = m
    h30 = rep["heads"]["30m"]
    print("신호 있음:", omni.head_line("30m", h30))
    print("          ", omni.head_line("5d", rep["heads"]["5d"]))
    print("          ", omni.head_line("20d", rep["heads"]["20d"]))
    trees, X, ref, err, nan_rows = check_parity(bst, best, A)
    if rep.get("seeds", 1) < 2:
        fails.append("시드 앙상블이 꺼져 있다(seeds=%s)" % rep.get("seeds"))
    # [V33.424] ★지평 균형★ 과 ★나무 최소치★ — 실데이터에서 나무 2그루가 올라간 그 자리를 막는다
    if not rep.get("hzMult"):
        fails.append("지평 균형이 안 돌았다 — 자료 많은 지평이 모델을 통째로 가져간다")
    if len(trees) < omni.MIN_TREES:
        fails.append("나무 %d그루 < %d — 학습이 안 된 모델을 올릴 뻔했다" % (len(trees), omni.MIN_TREES))
    # [V33.425] 나무 총수는 시드 수에 속는다(시드 4 × 7라운드 = 28그루). 시드 하나의 라운드 수를 본다.
    _it = sorted(rep.get("iters") or [0])
    _md = _it[len(_it) // 2] if len(_it) % 2 else (_it[len(_it) // 2 - 1] + _it[len(_it) // 2]) / 2.0
    if _md < omni.MIN_ITERS:
        fails.append("라운드 중앙값 %.1f < %d — 조기종료가 즉시 멈췄다(시드별 %s)"
                     % (_md, omni.MIN_ITERS, _it))
    # 균형이 실제로 ★가중 합★ 을 맞췄는가(배수만 찍고 안 곱하면 이 검사가 잡는다)
    _Ab, _ = omni.balance_horizons(A, log=lambda *a: None)
    _sums = [float(_Ab["w"][_Ab["hz"] == k].sum()) for k in range(len(omni.HORIZONS))]
    _live = [v for v in _sums if v > 0]
    if _live and (max(_live) - min(_live)) > 1e-6 * max(_live):
        fails.append("지평별 가중 합이 안 맞는다: %s" % [round(v) for v in _sums])
    print("시드 %d · 불일치 %.4f · 나무 %d" % (rep.get("seeds", 1), rep.get("seedDisagree", 0), len(trees)))
    print("정합: 나무 %d · 행 %d (NaN 포함 %d) · 최대 오차 %.3g" % (len(trees), len(X), nan_rows, err))
    if err > 1e-9:
        fails.append("내보낸 나무 채점 ≠ LightGBM (%.3g)" % err)
    if nan_rows < 100:
        fails.append("정합 검사에 NaN 행이 너무 적다(%d)" % nan_rows)
    # ② 신호 없음 — 잡음에서 말하면 안 된다
    data0 = synth(NSYM, 0.0, 12)
    A0, _, _ = omni.build_dataset(data0, panels=_panels(data0))
    m0, rep0 = omni.train_model(A0)
    spoke = [hz for hz, h in rep0["heads"].items() if h.get("ok")]
    print("신호 없음:", omni.head_line("30m", rep0["heads"]["30m"]))
    if spoke:
        fails.append("잡음에서 발언했다: %s" % spoke)
    # [V33.425] ★심은 신호를 찾는가★ — 손으로 고른 상수 대신 ★같은 배관을 신호 없이 돌린 값★ 과 견준다.
    #   숫자 하나를 박아 두면 라벨 규약이 바뀔 때마다 그 숫자를 만지게 되고, 그건 문턱을 내리는 짓과
    #   구별이 안 된다. 잡음 회차가 기준선이면 기준선을 손으로 못 만진다.
    #   (횡단면 라벨로 바꾼 뒤 AUC 가 0.605 → 0.547 로 내려간 건 배관이 나빠져서가 아니다:
    #    ① 배리어가 정해진 행만 남기던 ★선택★ 이 없어져 조용한 행까지 다 들어왔고
    #    ② 라벨이 동료 중앙값과의 차라 동료 쪽 잡음이 얹힌다. 표본이 더 정직해진 대가다.
    #    n=24,040 에서 se(AUC)≈0.004 이므로 0.547 은 0.5 에서 11시그마다 — 못 찾은 게 아니다.)
    _a1 = h30.get("auc") or 0.0
    _a0 = (rep0["heads"]["30m"].get("auc") or 0.0)
    print("신호 판별: 있음 AUC %.3f vs 없음 AUC %.3f (차 %.3f)" % (_a1, _a0, _a1 - _a0))
    if not _a1 > 0.53:
        fails.append("심은 신호를 못 찾았다(30분 AUC %.3f)" % _a1)
    if not (_a1 - _a0) > 0.03:
        fails.append("신호 있음/없음이 안 갈린다(%.3f vs %.3f) — 배관이 신호를 못 나른다" % (_a1, _a0))
    if fixture:
        import numpy as np
        # 고정물은 작게: 원본 장타·장중 각 100행 + 결측·0 을 넣은 같은 수. 값은 유효숫자 10자리로
        # 줄인 ★다음에★ LightGBM 기대값을 계산한다(줄인 입력 그대로가 검사 입력이다).
        sub = np.r_[0:100, 200:300, 400:500, 600:700]
        Xf = np.array([[v if v != v else float("%.10g" % v) for v in x] for x in X[sub]])
        # 고정물은 ★첫 시드의 앞 nt 그루★ 만 쓴다 — 기대값도 같은 범위로 만든다(1/S 배수 포함).
        #   nt 를 ★그 시드가 실제로 만든 나무 수★ 로 잡는다. 평균 best 로 잡으면 시드마다 나무 수가
        #   달라 trees[:nt] 가 다음 시드로 넘어가고, 그러면 기대값과 안 맞는다.
        _b0, _it0 = bst[0]
        nt = min(60, _it0)
        small = {"feats": omni.MODEL_FEATS, "trees": trees[:nt], "rows": [], "raw": []}
        ref_s = _b0.predict(Xf, num_iteration=nt, raw_score=True) / len(bst)
        mine_s = np.array([omni.score_raw(small["trees"], list(x)) for x in Xf])
        assert float(np.max(np.abs(ref_s - mine_s))) < 1e-9
        small["rows"] = [[None if v != v else float(v) for v in x] for x in Xf]
        small["raw"] = [float(v) for v in ref_s]
        small["nanRows"] = int(np.isnan(Xf).any(axis=1).sum())
        # LightGBM 원본 덤프 몇 그루 — 게이트가 LightGBM 없이도 export_tree(변환기)를 검사한다
        dump = _b0.dump_model(num_iteration=nt)
        small["lgbDump"] = [t["tree_structure"] for t in dump["tree_info"][:8]]
        small["scale"] = 1.0 / len(bst)
        with open(fixture, "w", encoding="utf-8") as fh:
            json.dump(small, fh, separators=(",", ":"))
        print("고정물 저장:", fixture, "나무", nt, "행", len(small["rows"]), "NaN행", small["nanRows"])
    # ③ 워커 왕복 흉내 — 색인 → 묶음 조회 → 흘려 만들기 → 학습 → 업로드 본문(가짜 서버)
    fails += fake_roundtrip(data)
    if fails:
        print("❌ " + " · ".join(fails))
        sys.exit(1)
    print("✅ OMNI 자가검사 통과")


if __name__ == "__main__":
    main()
