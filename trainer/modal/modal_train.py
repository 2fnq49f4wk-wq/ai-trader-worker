# ============================================================================
# LUX-DNN 학습기 — Modal.com 서버리스 (PC 꺼져도 매일 자동, 카드 불필요)
#   Modal 클라우드에서 cron 스케줄로 3M 딥넷을 완전학습해 Worker에 업로드한다.
#   Worker src/index.js 학습로직(_dnnTrainOne/mlDNNTrainNightly) 충실 복제.
#
# 배포:
#   pip install modal
#   modal setup                                   # GitHub 로그인(브라우저)
#   modal secret create lux-dnn BASE_URL=https://ai-trader-app.xxx.workers.dev TRAIN_KEY=<키>
#   modal deploy modal_train.py                   # 매일 자동 실행 등록(PC 꺼져도 동작)
#
# 즉시 1회 테스트:
#   modal run modal_train.py
# ============================================================================
import modal

app = modal.App("lux-dnn-trainer")

# torch/numpy/requests가 깔린 컨테이너 이미지(로컬 PC엔 설치 불필요 — Modal이 클라우드에서 빌드)
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch", "numpy", "requests",
    "xgboost", "lightgbm", "catboost"   # [V32.13] 부스팅 3종 위원회 멤버(트리→Worker 포맷 export)
)

# GPU를 쓰려면 아래 @app.function 에 gpu="T4" 추가. 3M은 CPU로도 수 분이라 기본 CPU(크레딧 절약).
# [V32.8] 학습이 전부 외부(Modal)로 이관돼 Worker 부담이 없으므로 재학습 주기를 하루 2회→4회로.
#   매 6시간: 00:10 / 06:10 / 12:10 / 18:10 UTC. 1회 ~15-20분(다운로드+DNN(T4)+GBDT+업로드)이라
#   6시간 간격이면 실행이 겹치지 않는다. 비용: T4 ~$0.59/hr × ~0.3h × 4회/일 × 30일 ≈ $21/월 <
#   Modal 무료 크레딧 $30/월. (무료 크레딧 소진 시 Modal은 카드 없으면 과금 없이 중지 → 안전.)
#   더 자주 원하면 GBDT를 CPU 전용 함수로 분리해 GPU 청구시간을 줄이면 됨.
CRON = modal.Cron("10 */6 * * *")  # 매 6시간(하루 4회): 00:10/06:10/12:10/18:10 UTC

# [성능강화] 외부 GPU가 학습을 맡으므로 Worker 추론비용 없이 학습 품질을 올린다.
#   에폭↑(수렴), 시드↑(앙상블 분산↓·신뢰하한↑). 구조(3M)는 유지 — Worker 매사이클 추론속도 보호.
EPOCHS_DEFAULT = 400   # 150→400 (조기종료가 과적합 차단, GPU라 시간 부담 없음)
SEEDS_OVERRIDE = 6     # 4→6 앙상블(로짓평균 안정화). 업로드~27MB·추론 6패스(허용범위)


# ══ [V33.350] ★작업이 예산을 넘겨 죽고, 뒤쪽 학습이 통째로 안 돌고 있었다.★ ═════════════
#   실측(2026-09-13 00:33 GitHub Actions run #114, 표본 1,053,656):
#       ① 표본 수집        4분 54초
#       ② DNN 6시드       32분 30초   ← ★예산의 54%★
#       ⑤ GBDT             8분 51초
#       ⑥ 부스터 3종       2분 23초
#       시장별(US·KR)      5분 58초
#       ⑦ MIND            4분 51초 지점에서 ★timeout 3600s 로 강제 종료★
#   그 뒤에 있는 단타·SEQ·MEMO·STACK 경계 통지는 ★한 번도 실행되지 않았다.★
#   그리고 Modal 이 작업을 죽이므로 GitHub Actions 는 빨간 실패로 끝난다 —
#   앞에서 성공적으로 올라간 GBDT·부스터·시장별 모델까지 "실패한 실행" 으로 뭻힌다.
#   (workflow_dispatch 실행 #107·108·109·112·113·114 가 전부 이 모양이다. push 실행은
#    modal deploy 만 하고 끝나서 초록이라 문제가 안 보였다.)
#
#   ★타임아웃을 늘리는 것은 답이 아니다.★ 크론이 6시간마다 도므로 지금도 하루 4 GPU-시간을
#   쓴다(T4). 3시간으로 늘리면 청구가 그만큼 느다. 표본은 앞으로도 계속 늘어난다.
#   → ★예산 안에서 끝나게 하고, 못 한 것을 다음 회차가 먼저 하게 한다.★
#     · 남은 시간이 그 단계의 예상 소요보다 적으면 ★건너뛴다★ (죽지 않는다).
#     · 무엇을 건너뛰었는지를 반환값과 로그에 남긴다 — 조용한 결손을 만들지 않는다.
#     · 다음 회차는 ★건너뛴 단계부터★ 돌다(회전). 그래서 어떤 단계도 굶지 않는다.
#     · 예상 소요는 ★실측을 적립★ 한다(modal.Dict). 처음엔 기본값, 돌수록 정확해진다.
JOB_TIMEOUT_S = 3600
JOB_MARGIN_S = 300          # 마무리·업로드·정리 여유 — 이만큼 남기고 새 단계를 시작하지 않는다
# 단계별 예상 소요(초) 기본값 — 위 실측에서 왔고, 실측이 쌓이면 그 값으로 대체된다.
STAGE_COST_DEFAULT = {"gbdt": 600, "boosters": 220, "markets": 450,
                      "mind": 900, "scalp": 300, "seq": 900, "memo": 600,
                      "ablate": 400}


# ══ [V33.377] ★회전은 굶주림을 못 막았다 — 실측이 그렇게 말한다.★ ═══════════════
#
#   run 35149059451 (2026-09-16), 실제 로그:
#     ⑤~⑩ 회전 — 지난 회차가 'mind' 에서 예산이 끊겼다. 거기부터 시작한다.
#     ⏭ mind 생략 — 남은 예산 630s < 예상 1469s (다음 회차가 먼저 한다)
#     ⏭ scalp 생략 · ⏭ seq 생략 · ⏭ gbdt 생략 · ⏭ markets 생략
#     ⚠️ 예산으로 생략 5단계 — 다음 회차가 'mind' 부터 시작한다
#
#   ★교착이다.★ 커서는 "예산에 끊긴 첫 단계" 를 가리키는데, 그 단계를 맨 앞에 놓아도
#   예산이 늘지는 않는다. mind 는 다음 회차에도 첫 번째로 잘리고, 커서는 또 mind 를
#   가리킨다 — 영원히. 화면의 "GBDT 학습 27.2시간 전" 이 그 결과다.
#
#   왜 예산이 없나: ①수집 571s + ②DNN 6시드 2036s = 2607s 로 3300s 중 79% 가 사라진다.
#   뒤 7단계가 나눠 쓸 것이 630s 뿐이라, 600s 를 넘는 단계는 ★구조적으로★ 못 돈다.
#
#   ※ 옛 게이트(check-trainer-budget)는 이 회전이 "6회차 안에 전 단계가 돈다" 고 확인해
#     줬다. 그 시뮬레이션이 손으로 적은 옛 비용(mind 900s·남은 예산 1034s)을 썼기 때문이다.
#     실측은 mind 1469s·남은 예산 630s 다. ★손으로 적은 숫자가 드리프트한 전형★ 이고,
#     그래서 초록불이 거짓이었다. 게이트도 같이 고친다.
#
#   → 커서를 버리고 ★굶은 정도★ 로 정한다. 두 가지를 같이 한다:
#     ① 순서: 마지막으로 성공한 지 오래된 단계부터 (커서가 아니라 측정값이다)
#     ② 예산: 굶은 단계가 있으면 ★DNN 이 시드를 양보한다.★ 지금 DNN 은 wDnn=0 으로
#        억제 중인데 예산의 79% 를 먹는다. 시드가 6→4 인 앙상블은 조금 시끄러울 뿐이고,
#        27시간 묵은 GBDT 보다 낫다. 상한을 둬서 DNN 이 죽지는 않게 한다.
STARVE = {
    "maxAgeS": 20 * 3600,     # 이보다 오래 못 돈 단계 = 굶었다(크론 6시간 → 3회차 놓친 것)
    "reserveCapFrac": 0.45,   # 예산의 이 비율을 넘게 DNN 에서 떼지 않는다
    "dnnMinSeeds": 2,         # 예약 때문에 시드가 이 밑으로 내려가진 않는다
    "topK": 2,                # 한 회차에 예약해 주는 굶은 단계 수(전부 예약하면 DNN 이 죽는다)
}


def _stage_ages(store, names, now=None):
    """단계별 '마지막으로 성공한 지 몇 초 지났나'. 한 번도 안 돌았으면 무한대."""
    import time as _t
    now = _t.time() if now is None else float(now)
    try:
        last = dict((store or {}).get("last_ok") or {})
    except Exception:
        last = {}
    out = {}
    for n in names:
        t = last.get(n)
        try:
            out[n] = float("inf") if not t else max(0.0, now - float(t))
        except Exception:
            out[n] = float("inf")
    return out


def _starve_order(names, ages):
    """오래 굶은 것부터. 동점이면 원래 순서 — 같은 입력이면 같은 순서여야 한다."""
    names = list(names)
    idx = {n: i for i, n in enumerate(names)}
    return sorted(names, key=lambda n: (-ages.get(n, 0.0), idx[n]))


def _starve_reserve(names, ages, costs, budget_s):
    """DNN 이 양보해야 할 초. 굶은 단계 중 ★가장 오래된 topK★ 만 본다.

    전부 예약하면 DNN 이 통째로 죽는다 — 그건 다른 방식의 같은 병이다.
    상한(reserveCapFrac)이 마지막 방어다."""
    hungry = [n for n in _starve_order(names, ages) if ages.get(n, 0.0) >= STARVE["maxAgeS"]]
    if not hungry:
        return 0
    need = sum(int(costs.get(n, 600)) for n in hungry[:int(STARVE["topK"])])
    try:
        cap = float(budget_s) * float(STARVE["reserveCapFrac"])
    except Exception:
        cap = 0.0
    return int(max(0, min(need, cap)))


def _stage_fits(left_s, need_s):
    """남은 예산으로 이 단계를 시작해도 되는가. 모자라면 ★죽지 말고 건너뛴다.★"""
    try:
        return float(left_s) >= float(need_s)
    except Exception:
        return False


def _next_cost(prev_s, observed_s):
    """다음 회차의 예상 소요 — 관측에 20% 여유. 추측이 아니라 실측을 적립한다."""
    try:
        return int(max(30, float(observed_s) * 1.2))
    except Exception:
        return int(prev_s or 600)


def _trainer_state():
    """회차 간에 남길 상태(회전 커서·단계 실측). 못 쓰면 None — 그때는 회전 없이 기본 순서."""
    try:
        return modal.Dict.from_name("lux-trainer-state", create_if_missing=True)
    except Exception as e:
        print("   상태 저장소 없음(회전·실측 비활성):", e)
        return None


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("lux-dnn")],  # BASE_URL, TRAIN_KEY
    schedule=CRON,
    timeout=JOB_TIMEOUT_S,
    gpu="T4",  # GPU 가속(20분→~2분). 12h마다 2분이라 월 크레딧 $1 수준(무료 $30 내).
)
def train_job(epochs: int = EPOCHS_DEFAULT, dry: bool = False,
              depth_sweep: bool = False, sweep_seeds: int = 2, target: str = "all"):
    import os, json, math, time, hashlib
    import numpy as np
    import requests
    import torch
    import torch.nn as nn

    BASE = os.environ["BASE_URL"].rstrip("/")
    KEY = os.environ["TRAIN_KEY"]
    HDR = {"x-train-key": KEY}
    if target not in ("all", "dnn", "seq", "mind", "memo", "boosters", "markets", "scalp"):
        raise ValueError("unknown training target")

    # [V33.350] 예산 시계 — 이 함수가 시작한 시각이 기준이다(모듈 로드 시각이 아니다).
    _T0 = time.time()
    _DEADLINE = _T0 + JOB_TIMEOUT_S - JOB_MARGIN_S

    def _left():
        return _DEADLINE - time.time()

    _store = _trainer_state()
    _costs = dict(STAGE_COST_DEFAULT)
    if _store is not None:
        try:
            _costs.update({k: v for k, v in (_store.get("stage_cost") or {}).items() if v and v > 0})
        except Exception:
            pass
    _ran, _skipped = [], []
    _last_ok = {}
    if _store is not None:
        try:
            _last_ok = dict(_store.get("last_ok") or {})
        except Exception:
            _last_ok = {}

    def _stage(name, fn):
        # 예산이 남아 있을 때만 돌린다. 못 돌리면 건너뛴 것을 기록한다.
        # 죽는 것과 건너뛰는 것은 다르다 — 죽으면 그때까지의 성공까지 실패로 뭻히고
        # 뒤 단계가 영원히 안 돈다. 건너뛰면 다음 회차가 그것부터 한다.
        need = _costs.get(name, 600)
        if not _stage_fits(_left(), need):
            _skipped.append(name)
            print(f"   ⏭ {name} 생략 — 남은 예산 {_left():.0f}s < 예상 {need:.0f}s (다음 회차가 먼저 한다)")
            return
        t_s = time.time()
        try:
            fn()
        except Exception as e:
            print(f"   {name} 예외(무시):", e)
        el = time.time() - t_s
        _ran.append(name)
        # [V33.377] ★언제 마지막으로 돌았는지를 적는다★ — 다음 회차의 순서·예약이 이 값으로
        #   정해진다. 커서 하나로는 교착이 났다(위 STARVE 주석의 실측 참조).
        _last_ok[name] = int(time.time())
        # 실측을 적립한다 — 다음 회차의 예상치가 추측이 아니라 관측이 된다(여유 20%).
        _costs[name] = _next_cost(_costs.get(name), el)
        print(f"   · {name} {el:.0f}s · 남은 예산 {_left():.0f}s")

    # ── 1) 표본 내려받기 ──
    def fetch_all():
        off, page, samples, cfg, fv, fn = 0, 20000, [], None, None, None
        anchor = 0  # [V11.1] 스냅샷 앵커 — 수집 중 신규 수확행이 OFFSET을 밀어 중복/누락되는 것 방지
        cur_ts = cur_id = 0   # [V33.12] 커서 페이지네이션 — OFFSET 누적 스캔(표본^2) 제거
        _seen_pages = set()   # [V33.365] 페이지 중복 탐지 — 아래 설명 참조
        while True:
            # [V33.365] ★offset 은 ★언제나★ 보낸다.★ 종전엔 if/else 라 커서를 한 번 받으면
            #   offset 을 영영 안 보냈는데, 워커의 R2 스냅샷 분기는 offset 으로 파트를 고른다.
            #   그래서 수집 도중 스냅샷이 신선해지면 이후 모든 페이지가 파트0(최근 2만행)만
            #   돌려줬다 — 1,123,768건을 받았지만 서로 다른 행은 2만건뿐이었다.
            #   D1 분기는 커서가 있으면 커서를 쓰므로(if curTs>0) 이 변경은 D1 동작을 안 바꾼다.
            params = {"key": KEY, "limit": page, "offset": off}
            if cur_ts:
                params["cursorTs"], params["cursorId"] = cur_ts, cur_id
            if anchor:
                params["beforeTs"] = anchor
            # [V33.12] D1 과부하로 export가 한 번 실패하면 학습 전체가 죽었다 — 지수백오프 재시도.
            j = None
            for attempt in range(5):
                try:
                    r = requests.get(BASE + "/api/ml-export", params=params, headers=HDR, timeout=180)
                    if r.status_code == 200:
                        j = r.json()
                        break
                    if r.status_code in (429, 500, 502, 503, 504) and attempt < 4:
                        wait = 5 * (2 ** attempt)
                        print(f"  export {r.status_code} — {wait}s 후 재시도({attempt+1}/4)")
                        time.sleep(wait)
                        continue
                    raise RuntimeError(f"export {r.status_code}: {r.text[:200]}")
                except requests.RequestException as e:
                    if attempt >= 4:
                        raise
                    wait = 5 * (2 ** attempt)
                    print(f"  export 통신오류({e}) — {wait}s 후 재시도({attempt+1}/4)")
                    time.sleep(wait)
            if j is None:
                raise RuntimeError("export 재시도 소진")
            if fv is not None and (j["featVer"] != fv or j["featNames"] != fn):
                raise ValueError("feature schema changed during export; discard mixed snapshot and retry")
            cfg, fv, fn = j["config"], j["featVer"], j["featNames"]
            anchor = j.get("anchorTs") or anchor
            got = j.get("samples", [])
            # [V33.365] ★같은 페이지가 두 번 오면 즉시 멈춘다.★ 위 중복수집 사고는 화면·로그
            #   어디에도 "중복" 이라는 말이 없이 valAcc 만 조용히 무너뜨렸다(유효표본 210/220,000).
            #   페이지 내용이 ★똑같으면★ 그건 오해의 여지가 없는 고장이다 — 오탐이 없다.
            #   덜 학습된 회차는 6시간 뒤 만회되지만, 복사본으로 학습한 모델은 승격돼 돈을 만진다.
            if got:
                _sig = hashlib.sha1(
                    repr((len(got), got[0].get("ts"), got[0].get("s"),
                          got[-1].get("ts"), got[-1].get("s"))).encode()).hexdigest()
                if _sig in _seen_pages:
                    raise RuntimeError(
                        f"export 가 같은 페이지를 다시 줬다(중복 {len(samples):,}건 수집 지점) — "
                        "R2 스냅샷 파트와 커서가 어긋난 상태다. 이 표본으로는 학습하지 않는다.")
                _seen_pages.add(_sig)
            samples.extend(got)
            total = j.get("total", len(samples))
            print(f"  내려받음 {len(samples)}/{total}")
            off += len(got)
            nxt_ts, nxt_id = j.get("nextCursorTs"), j.get("nextCursorId")
            if nxt_ts:
                cur_ts, cur_id = nxt_ts, nxt_id
            if len(got) < page or off >= total or not got:
                break
        return samples, cfg, fv, fn

    print("① 표본 수집")
    samples, cfg, featver, featnames = fetch_all()
    # ══ [V33.365] ★표본 위생 — 받은 건수가 아니라 '서로 다른 건수' 를 먼저 말한다.★ ══
    #   중복수집 사고는 "내려받음 1,123,768/1,123,768" 이라는 ★정상적으로 보이는★ 로그를 남겼다.
    #   고유도가 무너진 뒤에야 티가 났고, 그때는 이미 모델이 승격 심사를 받고 있었다.
    #   서로 다른 (ts,종목,라벨) 비율과 시간범위는 이 사고를 ★한 줄로★ 드러낸다.
    try:
        _key = {(s_.get("ts"), s_.get("s"), s_.get("y")) for s_ in samples}
        _tsv = [float(s_.get("ts") or 0) for s_ in samples]
        _spanD = (max(_tsv) - min(_tsv)) / 86400000.0 if _tsv else 0.0
        _ratio = len(_key) / max(1, len(samples))
        print(f"   [표본위생] 서로 다른 표본 {len(_key):,}/{len(samples):,} ({_ratio*100:.1f}%)"
              f" · 시간범위 {_spanD:.0f}일")
        if _ratio < 0.5 and len(samples) > 1000:
            raise RuntimeError(
                f"표본의 {(1-_ratio)*100:.0f}%가 중복이다({len(_key):,}종류가 {len(samples):,}건으로 왔다) — "
                "익스포트 페이지네이션이 어긋난 상태다. 이 표본으로는 학습하지 않는다.")
    except RuntimeError:
        raise
    except Exception as _e:
        print("   [표본위생] 산출 실패(무시):", _e)
    _set_mkt_cols(featnames)   # [V33.291] 시장 원핫 열 위치 — IC 에서 시장 고정효과를 빼는 데 쓴다
    if not samples:
        print("표본 0 — 종료"); return {"ok": False, "reason": "no samples"}

    # ── 2) 학습(Worker 로직 복제) ──
    D = len(featnames)
    hidden = list(cfg["hidden"])
    dims = [D] + hidden + [1]
    K = SEEDS_OVERRIDE or cfg.get("seeds", 4)   # [성능강화] 6시드 앙상블
    ep = max(epochs, cfg.get("epochs", 0))
    dropout = cfg.get("dropout", 0.42); l2 = cfg.get("l2", 9e-4)
    lr = cfg.get("lr", 0.0025); lr_floor = cfg.get("lrFloorFrac", 0.08)
    label_smooth = cfg.get("labelSmooth", 0.06); input_noise = cfg.get("inputNoise", 0.06)
    mixup_p = cfg.get("mixupP", 0.2); std_clip = cfg.get("stdClip", 6)
    val_frac = cfg.get("valFrac", 0.2); batch = cfg.get("batch", 32)
    embargo_ms = cfg.get("embargoDays", 6) * 86400000; hv_w = cfg.get("hvSrcWeight", 1.0)
    # [V33.341] 엠바고는 ★라벨 지평 이상★ 이어야 뜻이 있다 — 짧으면 그 차이만큼 그냥 샌다.
    try:
        _HORIZON_MS = float((cfg or {}).get("prediction", {}).get("horizonDays") or 10) * 86400000
    except Exception:
        _HORIZON_MS = 10 * 86400000
    globals()["_HORIZON_MS"] = _HORIZON_MS
    globals()["_EMBARGO_MS"] = max(float(embargo_ms), _HORIZON_MS)
    if _HORIZON_MS > embargo_ms:
        print(f"   ⚠️ 엠바고({embargo_ms/86400000:.0f}일)가 라벨 지평({_HORIZON_MS/86400000:.0f}일)보다 짧다"
              f" — 지평으로 올려 쓴다(그 차이만큼 경계에서 라벨이 샌다).")
    # [V33.341] 실거래 표본 가중 — 종전엔 이 값을 아예 안 읽어 라이브가 언제나 1.0 이었다.
    #   워커는 자체 학습기 다섯 곳에서 이 값을 쓰는데 Modal 로는 내려오지도 않았다.
    #   위원회에 앉는 모델은 전부 external 이므로, 그 설정은 위원회에 한 번도 닿은 적이 없다.
    live_w = float(cfg.get("liveSrcWeight", 1.0) or 1.0)
    hl_days = cfg.get("recencyHalfLifeDays", 45); rec_floor = cfg.get("recencyFloor", 0.35)

    # [V32.10 성능강화·적응형 정규화] ★모델 축소 없이 과적합 방지★ 노이즈 큰 금융 tabular에선 3M망이
    #   쉽게 과적합한다. 모델 크기는 유지(사용자 방침)하되 규제를 전반적으로 강화 — 특히 데이터가 많아도
    #   가벼운 규제로 내려가지 않게(종전 dropout 0.42는 너무 약했음). 규제↑ + 정제된 피처(65종) +
    #   데이터↑ 조합으로 큰 모델을 유지하면서 일반화를 지킨다.
    Nall = len([s for s in samples if isinstance(s.get("x"), list) and len(s["x"]) == D])
    # [V33.260] ★이 사다리는 손으로 쓴 값이고, 워커가 보낸 dropout·l2 를 매번 덮어써 왔다.★
    #   즉 워커의 DNN.dropout(0.42)·DNN.l2(9e-4)는 Modal 경로에서 한 번도 쓰인 적이 없는
    #   죽은 손잡이였다. 그리고 사다리 맨 윗칸은 표본 18만 시절에 쓴 것인데 지금은 51만이다 —
    #   규모가 3배가 됐는데 규제는 그대로다. 트리들이 같은 표본에서 53~54% 를 내는 동안
    #   이 망은 47.3% 였다. 과적합을 막는 값이 ★학습 자체를 막고 있었을 수 있다.★
    #   근거 없이 반대로 밀지는 않는다. 사다리를 ★기본값★ 으로 두고, 아래 스윕이 실제로
    #   재서 이긴 구성이 있으면 그것을 쓴다(측정이 없으면 종전 동작 그대로다).
    if Nall < 60000:      dropout, l2, mixup_p, input_noise = 0.62, 5e-3, 0.35, 0.12   # 데이터 기근 → 매우 강한 규제
    elif Nall < 150000:   dropout, l2, mixup_p, input_noise = 0.55, 3e-3, 0.30, 0.10   # 중간 → 강한 규제
    else:                 dropout, l2, mixup_p, input_noise = 0.50, 1.5e-3, 0.25, 0.08  # 데이터 충분해도 규제 유지(과적합 방지)
    _reg_base = dict(dropout=dropout, l2=l2, mixup_p=mixup_p, input_noise=input_noise)
    # [V11.1] 배치·에폭도 데이터 규모에 맞춤 — 300k×에폭400×배치32면 GPU로도 timeout(3600s) 초과.
    #   대용량일수록 배치↑(스텝수↓)·에폭↓(1에폭당 갱신이 이미 많음). 조기종료가 최적점을 잡음.
    if Nall >= 150000:    batch, ep = 256, min(ep, 120)
    elif Nall >= 60000:   batch, ep = 128, min(ep, 220)
    print(f"  적응형 규제: N={Nall} → dropout={dropout} l2={l2} mixup={mixup_p} noise={input_noise} batch={batch} epochs={ep}")

    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"② 학습 dev={dev} dims={'-'.join(map(str,dims))} seeds={K} epochs={ep} N={len(samples)}")

    samples = [s for s in samples if isinstance(s.get("x"), list) and len(s["x"]) == D]
    samples.sort(key=lambda s: s.get("ts", 0))
    N = len(samples)
    # ── [V33.247] 표본이 너무 적으면 ★여기서★ 멈춘다 ────────────────────────────
    #   아래 공통 전처리에 이런 줄이 있다:
    #       n_val = max(20, int(N * val_frac));  cut_ts = TS[N - n_val] - embargo_ms
    #   N 이 20 보다 작으면 TS[음수] 가 되어 IndexError 로 죽는다. 실제로 그렇게 죽었다:
    #       IndexError: index -12 is out of bounds for axis 0 with size 8
    #   개별 학습기에는 저마다 '표본 부족' 가드가 있지만(GBDT<400 · 부스팅<500 · FM<200)
    #   전부 이 줄 ★뒤★ 라 한 번도 도달하지 못했다. 가드가 크래시 지점보다 뒤에 있으면
    #   없는 것과 같다.
    #   그리고 크래시는 원인을 말해 주지 않는다 — 워크플로가 빨갛게 죽을 뿐이라, 표본이
    #   굶었다는 사실(워커의 R2 스냅샷이 total=8 로 굳어 있었다)을 알아내는 데 로그를
    #   여러 번 왕복해야 했다. 이유를 적고 정상 종료한다.
    _MIN_N = 200          # 가장 낮은 개별 문턱(FM)과 맞춘다 — 이보다 적으면 아무도 못 배운다
    if N < _MIN_N:
        print(f"   ⚠️ 표본 부족 {N}/{_MIN_N} — 학습을 건너뛴다.")
        print(f"      워커 /api/ml-export 가 featVer={featver} 로 이만큼만 내려줬다는 뜻이다.")
        print("      풀은 큰데 이 수가 작다면 R2 스냅샷이 낡아 굳은 것을 의심할 것")
        print("      (워커 로그의 '[ML-EXPORT] … R2 스냅샷 N파트/total=M' 이 실제 풀과 맞는지 본다).")
        return {"ok": False, "reason": "insufficient samples", "n": N, "featVer": featver}
    X = np.array([s["x"] for s in samples], dtype=np.float64)
    # ══ [V33.341] ★수확이 만들 수 없는 칸을 학습에서도 눌러 둔다★ ═══════════════════
    #   sigWeight · confluence · 전략원핫4 는 과거 봉에서 복원할 수 없다(규칙엔진 신호가
    #   없으므로). 그래서 표본의 80%(수확)에서 상수이고 ★라이브에서만★ 값이 튄다.
    #   표준화하면 라이브 한 건마다 이 칸들이 3σ 근처로 솟아, 망은 학습에서 본 적 없는
    #   자리에 매번 놓인다. 트리는 상수 칸을 안 쪼개서 무해하다 —
    #   그래서 같은 표본에서 트리 3종 52~54%, DNN 48.8%(동전 이하) 라는 비대칭이 나왔다.
    #   워커가 V33.341 부터 서빙에서 이 칸들을 중립으로 적으므로, 학습·검증도 같은 자리에
    #   서야 한다. 저장된 옛 표본에는 아직 라이브 값이 남아 있으니 ★여기서 눌러★ 맞춘다.
    #   (표본을 버리지 않는다 — 값만 규약에 맞춘다.)
    _lc_idx = list(cfg.get("liveCtxIdx") or [])
    _lc_val = list(cfg.get("liveCtxVal") or [])
    if cfg.get("liveCtxNeutral") and _lc_idx and len(_lc_idx) == len(_lc_val):
        _moved = 0
        for _k, _c in enumerate(_lc_idx):
            if 0 <= _c < X.shape[1]:
                _moved += int((X[:, _c] != _lc_val[_k]).sum())
                X[:, _c] = _lc_val[_k]
        print(f"   신호컨텍스트 중립화: {len(_lc_idx)}칸 고정 — 값이 바뀐 셀 {_moved}개")
        print("      (수확이 만들 수 없는 칸이라 학습·검증·서빙을 같은 분포 위에 세운다)")
    elif _lc_idx:
        print(f"   신호컨텍스트 중립화 꺼짐 — {len(_lc_idx)}칸이 라이브에서만 값을 갖는다(스큐 주의)")
    # [V33.78] ★라벨을 절대수익으로 재계산★ (사용자 지시)
    #   워커가 저장한 y 는 수집 당시 설정(alpha=지수 대비 초과수익)으로 매긴 값이다.
    #   라벨 정의를 절대수익으로 바꾸면 과거 표본을 통째로 버려야 할 것 같지만, pnl 이 함께
    #   저장돼 있어 여기서 다시 매기면 된다 — 17만 표본을 재수집 없이 새 정의로 그대로 쓴다.
    #   labelMode 는 워커 /api/ml-export-* 의 config 에서 내려온다(없으면 절대수익).
    _lm = "binary"
    try:
        _lm = str((cfg or {}).get("prediction", {}).get("target") or "binary")
    except Exception:
        _lm = "binary"
    if _lm == "binary" or _lm == "logreturn":
        Y = np.array([1.0 if float(s.get("pnl", 0.0)) > 0 else 0.0 for s in samples], dtype=np.float64)
        print(f"   라벨: 절대수익(pnl>0) 로 재계산 — 양성비율 {Y.mean():.3f}")
    else:
        Y = np.array([1.0 if s["y"] else 0.0 for s in samples], dtype=np.float64)
        print(f"   라벨: 워커 저장값({_lm}) 사용 — 양성비율 {Y.mean():.3f}")
    PNL = np.array([s.get("pnl", 0.0) for s in samples], dtype=np.float64)
    # [V33.76] 시장 라벨 — 워커가 이제 표본마다 m("us"/"kr"/"cm")을 내려준다.
    MKT = np.array([str(s.get("m") or "us") for s in samples])
    HV = np.array([1.0 if s.get("hv") else 0.0 for s in samples], dtype=np.float64)
    TS = np.array([s.get("ts", 0) for s in samples], dtype=np.float64)
    # [V33.115] 심볼 — 워커 /api/ml-export 가 s 로 내려준다(고유도 계산에 필요).
    SYM = np.array([str(s.get("s") or "") for s in samples])
    now = float(TS.max()) if N else time.time() * 1000

    # [V33.115] ★표준화 누출 수정★ — 종전엔 평균·표준편차를 ★검증분 포함 전체★ 로 계산한 뒤
    #   그 자로 검증분을 채점했다. 검증표본의 분포가 변환에 스며들어 검증성적이 실제보다 좋게 나온다.
    #   워커의 _miniLogisticTrain 에서도 같은 버그를 잡았다(V33.114) — 두 곳이 같은 실수를 했다.
    #   분할이 아래에서 정해지므로 여기서는 '검증 꼬리'를 미리 떼고 학습 구간만으로 잡는다.
    _nval0 = max(20, int(N * val_frac))
    _ntr0 = max(1, N - _nval0)
    mean = X[:_ntr0].mean(axis=0); std = X[:_ntr0].std(axis=0); std[std < 1e-6] = 1.0
    Xn = np.clip((X - mean) / std, -std_clip, std_clip)
    absp = np.abs(PNL); pnl_scale = np.median(absp) if len(absp) else 1.0
    pnl_scale = pnl_scale if pnl_scale > 1e-6 else 1.0
    days = np.maximum(0.0, (now - TS) / 86400000.0)
    recency = np.maximum(rec_floor, np.power(0.5, days / hl_days))
    # [V33.115] 고유도 가중 — 겹친 표본의 발언권을 동시성만큼 나눈다(과적합 완화).
    _hor_d = 10.0
    try:
        _hor_d = float((cfg or {}).get("prediction", {}).get("horizonDays") or 10)
    except Exception:
        _hor_d = 10.0
    # [V33.176] ★심볼이 안 오면 고유도가 조용히 무너진다 — 그 상태를 소리내어 말한다.★
    #   고유도는 같은 종목 안의 라벨 겹침만 센다. 심볼이 전부 빈 문자열이면 온 표본이 한
    #   바구니에 들어가 "모든 종목의 같은 날짜"가 서로 겹치는 것으로 계산된다.
    #   실제로 그랬다 — R2 스냅샷 행에 s 가 빠져 있어 유효표본이 183,948건 중 31건으로 나왔고,
    #   Wilson 하한이 24%로 무너져 DNN·GBDT 가 영원히 trustFloor 를 못 넘었다.
    #   숫자만 보면 "표본이 부족하다" 로 오해하게 된다. 원인을 화면이 직접 말해야 한다.
    _nsym = len(set(SYM.tolist())) if N else 0
    if _nsym <= 1 and N > 100:
        print(f"   ⚠️⚠️ 표본에 종목(s) 이 없다 — 고유도를 종목별로 잴 수 없다(고유 심볼 {_nsym}개).")
        print("        워커의 /api/ml-export(또는 R2 스냅샷)가 s 를 안 싣고 있다는 뜻이다.")
        print("        이 상태에서는 유효표본수가 실제의 수천분의 1로 나와 신뢰 게이트를 영원히 못 넘는다.")
        print("        → 고유도 보정을 ★건너뛰고★ 균등가중으로 학습한다(잘못된 축소보다 낫다).")
        UNIQ = np.ones(N, dtype=np.float64)
    else:
        UNIQ = _uniq_weights(TS, SYM, _hor_d * 86400000.0)
    print(f"   표본 고유도: 평균 {UNIQ.mean():.3f} · 유효 {UNIQ.sum():.0f}/{N} (라벨지평 {_hor_d:.0f}일, 종목 {_nsym}개)")
    # ══ [V33.350] ★후속 학습 단계를 ★한 곳에서만★ 정의한다.★ ═══════════════════════
    #   종전엔 같은 단계가 두 벌로 적혀 있었다 — target 별 복구 경로(V33.349)와 target="all"
    #   본 경로. MIND 의 하이퍼파라미터가 두 곳에 그대로 복사돼 있어, 한쪽만 고치면 조용히
    #   갈라진다(이 저장소가 세션 창·라벨 공급자에서 이미 겪은 그 모양이다).
    #   여기서 한 번 만들고 두 경로가 같은 것을 쓴다.
    _PLAN = [
        ("gbdt", lambda: _train_and_upload_gbdt(BASE, KEY, HDR, X, Y, TS, featver, D, UNIQ)),
        ("boosters", lambda: _train_and_upload_boosters(BASE, KEY, HDR, X, Y, TS, featver, D, PNL, UNIQ)),
        # [V33.76] ★미국장·한국장 분리학습★ (사용자 지시) — 거래시간·상하한가·세금·투자자구성이
        #   전부 달라 조건부가 아니라 별도 모델이 맞다. 표본이 충분한 시장만 올린다.
        ("markets", lambda: _train_per_market(BASE, KEY, HDR, MKT, X, Y, TS, PNL, featver, D, UNIQ)),
        # [V33.249] 위원장(MIND) — FM 47.9% 에서 ★트리★ 로 교체. gbdt 의 사본이 되면 안 되므로
        #   더 깊고(6) 더 느리게(0.02) 더 적게 뽑아(0.7) 다른 시드로 — 같은 학습기, 다른 관점.
        ("mind", lambda: _train_and_upload_gbdt(
            BASE, KEY, HDR, X, Y, TS, featver, D, UNIQ,
            endpoint="/api/mind-import", tag="MIND(tree)",
            hp={"eta": 0.02, "depth": 6, "sub": 0.7, "col": 0.7,
                "trees": 800, "minchild": 8.0, "seed": 77003, "algo": "gbdt-deep"})),
        # [V33.41] 장중 단타 — 표본 소스·라벨 지평·업로드 슬롯이 전부 위원회와 분리돼 있다.
        ("scalp", lambda: _train_and_upload_scalp(BASE, KEY, HDR, featver)),
        # [V33.267] SEQ(Transformer) — 같은 종목의 최근 L 봉을 순서대로 보는 유일한 위원.
        ("seq", lambda: _train_and_upload_seq(BASE, KEY, HDR, X, Y, TS, SYM, featver, D, UNIQ, cfg)),
        # [V33.305] MEMO(원형 기억) — 워커 CPU 에서 가장 무거웠던 학습. 여기선 창 제약이 없다.
        ("memo", lambda: _train_and_upload_memo(BASE, KEY, HDR, X, Y, TS, PNL, featver, D,
                                                featnames=featnames, cfg=cfg, SYM=SYM)),
        # [V33.380] 라벨 실험대 — ★아무것도 업로드하지 않는다.★ "성능이 안 나온다" 의 원인이
        #   모델인지 라벨인지를 같은 분할·같은 학습기로 재서 숫자로 답한다(_label_ablation 주석).
        ("ablate", lambda: _label_ablation(X, PNL, TS, SYM, MKT, featver, D,
                                           UNIQ=UNIQ, featnames=featnames)),
    ]
    _PLAN_BY = dict(_PLAN)
    # Codex V33.349: recover a timed-out tail stage without paying for DNN again.
    # Keep the existing one-hour resource limit and native schedule unchanged.
    # [V33.350] 정의는 위 _PLAN 한 곳에서만 — 여기서 다시 적지 않는다.
    if target not in ("all", "dnn"):
        if dry: return {"ok": True, "dry": True, "target": target, "n": N}
        _stage(target, _PLAN_BY[target])
        return {"ok": True, "target": target, "ran": _ran, "skipped": _skipped,
                "note": "inspect individual upload/admission results"}
    # ══ [V33.377] ★DNN 이 시드를 양보한다 — 뒤 단계가 굶지 않게.★ ═══════════════════
    #   실측: ①수집 571s + ②DNN 6시드 2036s 로 3300s 중 79% 가 사라지고, 뒤 7단계가
    #   630s 를 나눠 써야 했다. 600s 넘는 단계는 ★구조적으로★ 못 돈다(위 STARVE 주석).
    #   그리고 지금 DNN 은 wDnn=0 으로 억제 중이다 — 위원회에 한 표도 안 넣으면서
    #   예산의 79% 를 먹는다. 굶은 단계가 있으면 그만큼 미리 떼어 둔다.
    #   ※ 상한(reserveCapFrac)과 최소 시드(dnnMinSeeds)가 DNN 을 죽이지 않게 막는다.
    _DNN_RESERVE = _starve_reserve([n for n, _ in _PLAN],
                                   _stage_ages({"last_ok": _last_ok}, [n for n, _ in _PLAN]),
                                   _costs, JOB_TIMEOUT_S - JOB_MARGIN_S)
    if _DNN_RESERVE > 0:
        _hungry = [n for n, _ in _PLAN
                   if _stage_ages({"last_ok": _last_ok}, [n])[n] >= STARVE["maxAgeS"]]
        print(f"   [예산예약] 굶은 단계 {len(_hungry)}종({', '.join(_hungry)}) — "
              f"DNN 이 {_DNN_RESERVE}s 를 양보한다(시드 최소 {STARVE['dnnMinSeeds']}개는 지킨다)")
    mw = np.clip(absp / pnl_scale, 0.3, 3.0) * np.where(HV > 0, hv_w, live_w) * recency * UNIQ
    print(f"   출처 가중: 수확 ×{hv_w} · 실거래 ×{live_w} (수확 {int((HV > 0).sum())} · 실거래 {int((HV <= 0).sum())}건)")

    # [V33.341] 분할은 공용 헬퍼 한 곳에서 — 학습기마다 다른 자를 쓰지 않는다.
    #   (표본은 위에서 이미 ts 오름차순 정렬돼 있어 order 는 항등이다.)
    _ord, tr, cal, va, n_val, _emb = _split_ts(TS, val_frac, embargo_ms, min_val=20,
                                               horizon_ms=_HORIZON_MS, cal_frac=0.10, tag="DNN")
    print(f"   분할: 학습 {len(tr)} · 보정 {len(cal)} · 검증 {len(va)} · 엠바고 {_emb/86400000:.0f}일")
    # [V33.376] 이 자리에 있던 V33.366 진단은 _split_ts 안으로 옮겼다 —
    #   거기서 기간을 ★정하기★ 때문에, 재는 곳과 정하는 곳이 같아야 두 숫자가 안 갈린다.
    pos = Y[tr].sum()
    w_pos = len(tr) / (2 * pos) if pos > 0 else 1.0
    w_neg = len(tr) / (2 * (len(tr) - pos)) if (len(tr) - pos) > 0 else 1.0

    Xtr = torch.tensor(Xn[tr], dtype=torch.float32, device=dev)
    Ytr = torch.tensor(Y[tr], dtype=torch.float32, device=dev)
    Mtr = torch.tensor(mw[tr], dtype=torch.float32, device=dev)
    Xva = torch.tensor(Xn[va], dtype=torch.float32, device=dev)
    Yva = torch.tensor(Y[va], dtype=torch.float32, device=dev)
    # [V33.341] τ* 전용 보정 구간 — 학습에서 뺐고, 엠바고가 검증과 갈라 놓는다.
    _hasCal = len(cal) >= 50
    Xcal = torch.tensor(Xn[cal], dtype=torch.float32, device=dev) if _hasCal else None
    Ycal = Y[cal] if _hasCal else None

    # [V32.11] ★모델 축소 없이 강화 — BatchNorm★ 12층 평면 MLP는 정규화가 없어 깊이가 학습에 안 먹혔다
    #   (심층 degradation·기울기 불안정 → valAcc 정체의 구조적 원인). 각 은닉층에 BatchNorm을 넣어 깊은
    #   망이 '실제로' 학습되게 한다(용량 유지, 오히려 표현력 개방). 추론은 BN을 앞 선형층에 접어(fold)
    #   내보내므로 Worker의 평면 relu(Wx+b) 추론이 그대로 동일 결과를 낸다(추론측 변경 0).
    # [V33.204] ★깊이를 재서 결정한다 — 추측으로 정하지 않는다.★
    #   실측(2026-08-22): 10층 4,580,070 파라미터 모델이 valAcc 49.3% 로, 워커 폴백 2층(53.3%)보다
    #   낮았다. 그래서 신뢰 게이트가 외부 모델을 거부하고 워커가 자가학습으로 내려갔다(wDnn=0).
    #   "깊으면 좋다" 도 "얕으면 좋다" 도 이 데이터에서는 확인된 적이 없다 — 잰 적이 없으니까.
    #   → 같은 표본·같은 분할·같은 시드로 후보 깊이를 학습해 ★같은 자로★ 비교한다.
    #   비교 기준은 valAcc 가 아니라 ★유효표본 Wilson 하한(lb)★ 이다. 워커의 승격 게이트가
    #   보는 것이 그 값이고, 다른 자로 뽑으면 "여기선 이겼는데 저기선 떨어지는" 모델을 고르게 된다.
    def fit_arch(dims, tag="", reg=None):
        # [V33.260] 규제를 인자로 받는다 — 종전엔 바깥 지역변수를 캡처해서
        #   "같은 자로 비교" 를 규제 축으로는 아예 할 수 없었다(깊이만 바꿀 수 있었다).
        _r = reg or _reg_base
        dropout = _r["dropout"]; l2 = _r["l2"]
        mixup_p = _r["mixup_p"]; input_noise = _r["input_noise"]

        class MLP(nn.Module):
            def __init__(self):
                super().__init__()
                self.lins = nn.ModuleList([nn.Linear(dims[l], dims[l + 1]) for l in range(len(dims) - 1)])
                self.bns = nn.ModuleList([nn.BatchNorm1d(dims[l + 1]) for l in range(len(dims) - 2)])  # 은닉층만(출력층 제외)
                for lin in self.lins:
                    nn.init.kaiming_normal_(lin.weight, nonlinearity="relu"); nn.init.zeros_(lin.bias)
            def forward(self, x, train=True):
                n = len(self.lins)
                for i, lin in enumerate(self.lins):
                    x = lin(x)
                    if i < n - 1:
                        x = self.bns[i](x)                 # BatchNorm(선형 뒤·ReLU 앞) — 학습모드=배치통계, 평가모드=러닝통계
                        x = torch.relu(x)
                        if train and dropout > 0:
                            x = torch.nn.functional.dropout(x, p=dropout, training=True)
                return x

        def wilson_lb(acc, n, z=1.64):
            if n <= 0: return 0.0
            z2 = z * z; den = 1 + z2 / n; cen = acc + z2 / (2 * n)
            rad = z * math.sqrt((acc * (1 - acc) + z2 / (4 * n)) / n)
            return max(0.0, (cen - rad) / den)

        def one_seed(seed):
            torch.manual_seed(seed); np.random.seed(seed)
            net = MLP().to(dev)
            opt = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=l2)
            sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=ep, eta_min=lr * lr_floor)
            best, best_state, wait, patience = 1e9, None, 0, max(15, ep // 12)
            ntr = Xtr.shape[0]
            for e in range(ep):
                net.train(); perm = torch.randperm(ntr, device=dev)
                for bs in range(0, ntr, batch):
                    bi = perm[bs:bs + batch]
                    xb, yb, mb = Xtr[bi], Ytr[bi], Mtr[bi]
                    wc = torch.where(yb > 0.5, torch.tensor(w_pos, device=dev), torch.tensor(w_neg, device=dev))
                    if mixup_p > 0 and np.random.rand() < mixup_p and xb.shape[0] > 1:
                        lam = 0.2 + np.random.rand() * 0.6
                        j = torch.randperm(xb.shape[0], device=dev)
                        xb = lam * xb + (1 - lam) * xb[j]; yb = lam * yb + (1 - lam) * yb[j]
                        mb = lam * mb + (1 - lam) * mb[j]; wc = lam * wc + (1 - lam) * wc[j]
                    if input_noise > 0:
                        xb = xb + input_noise * torch.randn_like(xb)
                    ys = yb * (1 - label_smooth) + label_smooth / 2
                    logit = net(xb, True).squeeze(-1)
                    loss = nn.functional.binary_cross_entropy_with_logits(logit, ys, reduction="none")
                    loss = (loss * wc * mb).mean()
                    opt.zero_grad(); loss.backward()
                    torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0); opt.step()
                sched.step()
                net.eval()
                with torch.no_grad():
                    vl = nn.functional.binary_cross_entropy_with_logits(net(Xva, False).squeeze(-1), Yva).item()
                if vl < best - 1e-5:
                    best, wait = vl, 0
                    best_state = {k: v.detach().clone() for k, v in net.state_dict().items()}
                else:
                    wait += 1
                    if wait >= patience: break
            if best_state: net.load_state_dict(best_state)
            return net

        nets = []
        _seed_t0 = time.time()
        for sd in range(K):
            # [V33.350] ★시드를 하나 더 돌릴 예산이 없으면 거기서 멈춘다 — 죽지 않는다.★
            #   실측에서 DNN 6시드가 32분 30초(예산의 54%)를 먹었고, 표본은 계속 는다.
            #   예산을 넘기면 Modal 이 작업을 죽여 앙상블이 통째로 사라지고 뒤 단계도 다 날아간다.
            #   시드가 하나 적은 앙상블은 조금 더 시끄러울 뿐 여전히 쓸 수 있다 —
            #   ★모자란 앙상블이 없는 앙상블보다 낫다.★ 몇 개로 돌았는지는 seeds 로 올라간다.
            if sd > 0 and nets:
                _per = (time.time() - _seed_t0) / sd
                # [V33.377] 예약분은 ★없는 셈 치고★ 판단한다 — 단, 최소 시드까지는 양보하지 않는다
                #   (예약이 커도 DNN 이 통째로 사라지면 그건 같은 병의 반대 증상이다).
                _res = _DNN_RESERVE if len(nets) >= STARVE["dnnMinSeeds"] else 0
                if not _stage_fits(_left() - _res, _per * 1.15 + 240):   # 다음 시드 + 업로드/커밋 여유
                    print(f"  ⏭ 시드 {sd+1}/{K} 이후 생략 — 남은 예산 {_left():.0f}s"
                          + (f"(뒤 단계 예약 {_res}s 제외)" if _res else "")
                          + f" < 시드당 {_per:.0f}s (앙상블 {len(nets)}개로 진행)")
                    break
            t0 = time.time(); nets.append(one_seed(1000 + sd * 7))
            print(f"  {tag + ' ' if tag else ''}시드 {sd+1}/{K} ({time.time()-t0:.1f}s)")

        with torch.no_grad():
            zsum = torch.zeros(Xva.shape[0], device=dev)
            for net in nets:
                net.eval(); zsum += net(Xva, False).squeeze(-1)
            pva = torch.sigmoid(zsum / len(nets))
            # [V11.1 관측] 기저율·다수클래스 베이스라인·AUC — "정확도 낮음"이 모델 문제인지
            #   클래스 불균형/분포이동 문제인지 구분하는 진단 지표(로그 전용, 게이트엔 미사용).
            base = Yva.mean().item()
            majority = max(base, 1 - base)
            ys = Yva.cpu().numpy(); ps = pva.cpu().numpy()
            # [V33.291] 검증 행의 시장 — ★정규화 전 X★ 에서 읽는다(Xn 은 표준화돼 원핫이 0/1 이 아니다).
            _mk_va = _mkt_of_X(X[va])
            order = np.argsort(ps); ranks = np.empty_like(order, dtype=np.float64); ranks[order] = np.arange(1, len(ps) + 1)
            npos = ys.sum(); nneg = len(ys) - npos
            auc = float((ranks[ys > 0.5].sum() - npos * (npos + 1) / 2) / (npos * nneg)) if npos > 0 and nneg > 0 else 0.5

        # ── [V12.33 임계값 캘리브레이션] 31%형 겉보기 붕괴 수정 ──
        #   원인: 균형가중 학습 + 검증 라벨 쏠림 상황에서 고정 0.5 컷은 다수클래스보다 못한 정확도로 붕괴.
        #   해법: 균형정확도 최대 임계값 τ*를 찾아 각 시드망 마지막 층 bias에 -logit(τ*)로 굽는다
        #   → Worker의 0.5 기준 추론이 그대로 캘리브레이션 반영.
        # ── [V33.341] ★τ* 를 검증에서 고르지 않는다★ ─────────────────────────────
        #   종전엔 검증 앞 절반으로 τ* 를 고르고 뒤 절반으로만 채점했다. 정직하긴 했지만
        #   ★이 모델만 유효표본이 절반★ 이 된다. 승격 게이트는 Wilson 하한을 보므로
        #   표본이 절반이면 하한이 그만큼 내려간다 — 실측 DNN 유효표본 ≈690 · MIND ≈950 인데
        #   부스터는 ≈7,400 이었다. 같은 풀에서 10배 차이다.
        #   즉 "DNN 검증 미달" 의 상당 부분은 실력이 아니라 ★자의 길이★ 였다.
        #   → τ* 는 학습 구간의 꼬리(cal)에서 고른다. 학습에서 뺐으니 예측이 부풀지 않고,
        #     엠바고가 검증과 갈라 놓으니 누출도 없다. 검증은 ★전부★ 채점에 쓴다.
        _cal_src = None
        delta = 0.0   # [V33.378] τ* 로짓 시프트 — 아래 과적합 진단이 이 값을 되돌려 쓴다
        if _hasCal:
            with torch.no_grad():
                _zc = torch.zeros(Xcal.shape[0], device=dev)
                for net in nets:
                    net.eval(); _zc += net(Xcal, False).squeeze(-1)
                _cal_src = (torch.sigmoid(_zc / len(nets)).cpu().numpy(), Ycal)
        half = 0 if _cal_src is not None else max(20, len(ps) // 2)
        if _cal_src is not None or len(ps) - half >= 20:
            ps_c, ys_c = _cal_src if _cal_src is not None else (ps[:half], ys[:half])
            taus = np.unique(np.quantile(ps_c, np.linspace(0.05, 0.95, 37)))
            # [V12.42] 균형정확도→원(raw)정확도 기준으로 τ* 선택 변경 — Worker 신뢰게이트는 "원정확도
            #   Wilson 하한"으로 mind와 비교하는데, DNN만 균형정확도 τ*를 쓰면 게이트에서 구조적으로
            #   불리(60.3%로 표시되던 원인). MIND V12.39 캘리브레이션과 동일 기준으로 통일.
            def _rawacc(th):
                return float(((ps_c >= th) == (ys_c > 0.5)).mean())
            tau = float(taus[int(np.argmax([_rawacc(t) for t in taus]))])
            tau = min(max(tau, 1e-4), 1 - 1e-4)
            delta = math.log(tau / (1 - tau))
            with torch.no_grad():
                for net in nets:
                    net.lins[-1].bias.data -= float(delta)   # 임계값을 가중치에 영구 반영(업로드에 포함)
            psc = np.clip(ps, 1e-6, 1 - 1e-6)
            p_adj = 1.0 / (1.0 + np.exp(-(np.log(psc / (1 - psc)) - delta)))
            ys_t, p_t = ys[half:], p_adj[half:]
            acc = float(((p_t >= 0.5) == (ys_t > 0.5)).mean())
            n_eval = len(p_t)
            _p_ic, _y_ic = p_t, ys_t          # [V33.262] IC 도 ★같은 정직한 구간★ 으로 잰다
            _m_ic = _mk_va[half:] if _mk_va is not None else None   # [V33.291] 같은 구간의 시장
            # [V33.350] 문구 정정 — half=0 이면 τ* 는 검증이 아니라 ★보정(cal) 구간★ 에서 골랐다.
            #   종전 문장은 그때도 "검증 전반 0건으로 선택" 이라고 적어, 읽는 사람이
            #   "아무 데서도 안 골랐다" 로 읽게 만들었다(V33.341 이 τ* 를 학습 꼬리로 옮긴 뒤부터).
            _tau_src = (f"보정구간 {len(ps_c)}건" if half == 0 else f"검증 전반 {half}건")
            print(f"   캘리브레이션: τ*={tau:.3f} (logit 시프트 {delta:+.3f}) — {_tau_src}에서 선택, 검증 {n_eval}건으로 평가")
        else:
            acc = float(((ps >= 0.5) == (ys > 0.5)).mean()); n_eval = len(ps)
            _p_ic, _y_ic = ps, ys
            _m_ic = _mk_va   # [V33.291]
        # [V33.115] ★Wilson 하한을 유효표본수로 잰다★
        #   n_eval 은 ★명목★ 이다. 10일 지평 라벨은 같은 종목에서 겹치므로 독립 관측이 아니고,
        #   명목 n 으로 재면 하한이 실제보다 좁게(=낙관적으로) 나온다. 겹침의 역수를 합한
        #   유효표본수로 재야 "정확도 하한 X% 이상" 이라는 승격 게이트가 제 뜻을 가진다.
        _dnn_uw = UNIQ[va[len(va) - n_eval:]]
        _dnn_neff = max(8, int(round(float(_dnn_uw.sum()))))
        lb = wilson_lb(acc, _dnn_neff)
        if _dnn_neff < n_eval:
            print(f"   유효표본 {_dnn_neff}/{n_eval} (평균 고유도 {_dnn_uw.mean():.3f}) — 하한을 유효표본으로 산출 {lb:.4f}")
        # ══ [V33.359] ★고유도가 왜 그 값인지를 여기서 답하게 한다★ ═══════════════
        #   실측(2026-09-15 00:43): 유효표본이 7,379 → ★210★ 으로 한 회차 만에 무너졌고,
        #   그 탓에 accLB 가 문턱 아래로 떨어져 SEQ 가 위원회에서 빠지고 부스터 3종이
        #   전부 거절됐다. 그런데 트레이너 코드는 그 사이 한 줄도 안 바뀌었다 —
        #   즉 원인은 ★데이터★ 다. 그럼에도 로그에는 '평균 고유도' 한 숫자뿐이라
        #   무엇이 달라졌는지 밖에서 알 길이 없었다(또 추측하게 된다).
        #   고유도는 ★평가창이 며칠에 걸쳐 있는가★ 와 ★한 종목이 그 창에 몇 번 나오는가★
        #   두 가지로 결정된다. 그 둘을 직접 적는다 — 다음 회차 로그 한 줄이 답을 준다.
        try:
            _ev_ts = TS[va[len(va) - n_eval:]]
            _ev_sy = SYM[va[len(va) - n_eval:]] if SYM is not None else None
            _span_d = (float(_ev_ts.max()) - float(_ev_ts.min())) / 86400000.0
            _nsym = int(len(set(map(str, _ev_sy)))) if _ev_sy is not None else 0
            _per_sym = (n_eval / max(1, _nsym))
            print(f"   [고유도내역] 평가창 {_span_d:.1f}일 · 종목 {_nsym}개 · 종목당 {_per_sym:.1f}건"
                  f" · 평균동시성 {(n_eval / max(1, _dnn_neff)):.1f}건"
                  f" (지평 {_hor_d}일 — 창이 짧거나 종목당 건수가 많으면 고유도가 무너진다)")
        except Exception as _e:
            print(f"   [고유도내역] 산출 실패: {_e}")
        # [V32.9] ★과적합 진단★ 학습셋 정확도를 검증셋과 비교 — 격차가 크면 과적합(→데이터·규제 필요),
        #   격차가 작고 둘 다 낮으면 신호/피처 한계(→피처 품질·라벨 개선 필요). 캘리브레이션 반영 후 평가.
        try:
            with torch.no_grad():
                ztr = torch.zeros(Xtr.shape[0], device=dev)
                for net in nets:
                    net.eval(); ztr += net(Xtr, False).squeeze(-1)
                _ztr = (ztr / len(nets)).cpu().numpy()
                ptr = 1.0 / (1.0 + np.exp(-_ztr))
                ytr_np = Ytr.cpu().numpy()
            train_acc = float(((ptr >= 0.5) == (ytr_np > 0.5)).mean())
            gap = train_acc - acc
            # ══ [V33.378] ★진단이 세 번째 경우를 몰라서 엉뚱한 처방을 내고 있었다.★ ══════
            #   실측(run 35149059451): train 47.17% vs val 49.23% → 격차 ★-2.07%p★
            #   그런데 분기는 둘뿐이라 "과적합 낮음(→신호·피처·라벨 품질이 병목)" 이라고 답했다.
            #   격차가 ★음수★ 라는 것은 "과적합이 낮다" 가 아니라 ★학습집합조차 못 맞힌다★ 는 뜻이고
            #   (게다가 train 47.2% 는 다수클래스 기준선 50.8% 보다도 낮다), 처방이 정반대다:
            #   피처를 더 만들 일이 아니라 규제를 풀거나 보정 전이를 의심할 일이다.
            #
            #   ★그리고 그 음수가 진짜인지부터 가른다.★ τ* 는 ★보정구간★ 에서 정확도를 최대화하게
            #   골라 마지막 층 bias 에 영구 반영된다(위 캘리브레이션). 학습구간은 그 구간과
            #   양성비율이 다르므로, 같은 시프트를 학습구간에 걸면 정확도가 ★그 이유만으로★ 내려간다.
            #   시프트를 되돌린 값(train_raw)을 같이 찍으면 둘을 구분할 수 있다:
            #     · raw 도 낮다        → 진짜 과소적합(규제·용량·최적화 문제)
            #     · raw 는 높은데 낮다 → 보정 전이 문제(τ* 가 학습구간에 안 맞는 것)
            _tr_raw = float((((1.0 / (1.0 + np.exp(-(_ztr + float(delta))))) >= 0.5) == (ytr_np > 0.5)).mean())
            _maj = float(max(ytr_np.mean(), 1 - ytr_np.mean()))
            if gap > 0.05:
                verdict = "과적합 경향(→표본·종류·규제↑ 필요)"
            elif gap < -0.01:
                if _tr_raw - train_acc > 0.01:
                    verdict = (f"★보정 전이 문제★ — τ* 를 되돌리면 train {_tr_raw*100:.2f}% "
                               f"(→τ* 를 학습구간 분포까지 보고 고를 것)")
                else:
                    verdict = (f"★과소적합★ — 학습집합조차 못 맞힌다(다수클래스 {_maj*100:.1f}%) "
                               f"(→규제↓·용량·최적화. 피처를 더 만들 일이 아니다)")
            else:
                verdict = "과적합 낮음(→신호·피처·라벨 품질이 병목)"
            print(f"   [과적합진단] train {train_acc*100:.2f}%(τ*되돌림 {_tr_raw*100:.2f}%) "
                  f"vs val {acc*100:.2f}% → 격차 {gap*100:+.2f}%p — {verdict}")
        except Exception as _e:
            print("   [과적합진단] train acc 계산 실패:", _e)
        print(f"③ 앙상블 valAcc {acc*100:.2f}% (Wilson하한 {lb*100:.2f}%, n={n_eval})")
        print(f"   진단: 기저율(양성비율) {base*100:.1f}% | 다수클래스 베이스라인 {majority*100:.1f}% | AUC {auc:.3f}")
        if acc < majority - 0.02:
            print("   ⚠️ 정확도가 '전부 다수클래스 찍기'보다 낮음 — 분포이동(최근 시장≠과거 패턴) 또는 과적합 신호")
        if auc < 0.52:
            print("   ⚠️ AUC<0.52 — 현재 피처만으론 판별력 자체가 약함. 데이터 축적/피처 확장이 근본 해법")

        # [V33.262] ★블록 IC 를 DNN 도 낸다.★ 이 도구(_ic_block_fields)는 이미 있었고
        #   부스터·MIND 는 쓰는데 DNN 만 안 썼다. 그래서 DNN 은 '0.5 문턱 정확도' 라는
        #   ★이 저장소가 이미 깨진 자라고 판정한 것(V33.214)★ 하나로만 심사받고 있었다.
        #   순위를 맞히는 힘이 있어도 정확도가 동전 근처면 탈락한다 — 부스터였다면 통과했을 모델이.
        #   ★정확도를 잰 그 구간으로 IC 도 잰다.★ τ* 선택에 쓴 앞 절반에서 재면 그만큼
        #   낙관적으로 나온다 — 자를 하나 더 들이면서 그 자를 휘게 만들 이유가 없다.
        # [V33.366] 평가 구간의 ts 를 함께 넘겨 ★시간 기준 블록★ 의 정직한 t 도 기록한다.
        _ic_ts = None
        try: _ic_ts = TS[va[len(va) - n_eval:]]
        except Exception: _ic_ts = None
        _icf = _ic_block_fields(_p_ic, _y_ic, mkt=_m_ic, ts=_ic_ts,
                                horizon_ms=_hor_d * 86400000.0)   # [V33.291] 시장 고정효과 제거
        out = {"nets": nets, "acc": acc, "lb": lb, "n_eval": n_eval, "dims": list(dims),
               "auc": auc, "base": base, "majority": majority,
               # [V33.350] ★고유도 가중을 여기 실어 보낸다.★ 업로드부가 _dnn_uw 를 직접
               #   참조했는데 그건 이 함수의 지역변수라 매 회차 NameError 가 났다
               #   (실측 로그: "고유도 필드 생략: name '_dnn_uw' is not defined").
               #   그래서 valNEff·valUniq 가 한 번도 워커에 안 올라갔다 — 워커는 유효표본을
               #   모른 채 명목 valN(21만)만 받았다. 하한을 스스로 다시 재려면 그 값이 있어야 한다.
               "uw": _dnn_uw,
               "params": int(sum(dims[i] * dims[i+1] + dims[i+1] for i in range(len(dims)-1)))}
        out.update(_icf)
        if "valICt" in out:
            print(f"   블록IC {out['valICBlock']:.4f} t {out['valICt']:.2f} (K={out['valICK']}) — 정확도와 별개의 자")
            # [V33.366] ★같은 예측을 시간 기준 블록으로 다시 재면 얼마가 되는가★
            if "valICtHonest" in out:
                print(f"   [정직한IC] t {out['valICtHonest']:.2f} (블록 {out['valICBlkDays']:.0f}일"
                      f" ×{out['valICKHonest']}개 · 경계 {out['valICPurgeDays']:.0f}일 버림"
                      f" · 홀드아웃 {out['valICSpanDays']:.0f}일)"
                      f" — 게이트가 보는 t 와의 차 {out['valICtGap']:+.2f}"
                      f" (★게이트는 여전히 위의 t 로 판정한다 — 이 값은 기록이다★)")
            elif "valICHonestWhy" in out:
                print(f"   [정직한IC] 못 쟀다 — {out['valICHonestWhy']}"
                      f" (홀드아웃 {out.get('valICSpanDays', 0):.0f}일 · 블록 {out.get('valICBlkDays', 0):.0f}일 필요)")
        return out

    # ── [V33.204] 깊이 스윕 ───────────────────────────────────────────────────
    #   기본은 꺼져 있다. Modal 무료 크레딧이 이미 $21/$30 수준이라, 6시간마다 도는 정기 실행에서
    #   후보를 셋씩 학습하면 예산을 넘긴다. 스윕은 ★사람이 한 번 부를 때만★ 돈다.
    #   후보 순위는 적은 시드(빠르고 싸다)로 매기고, ★이긴 구성만★ 전체 시드로 다시 학습해 내보낸다.
    #   순위와 최종 모델을 같은 실행에서 만드는 것이 중요하다 — 표본이 하루만 달라져도
    #   "그때 이겼던 구성" 이 오늘도 이긴다는 보장이 없기 때문이다.
    # [V33.260] 워커가 스윕을 시킬 수 있다 — 신뢰 못 하는 상태일 때만 켜서 보낸다.
    #   정상일 때는 안 켜지므로 정기 실행의 추가 비용은 0 이다.
    _want_sweep = bool(cfg.get("archSweep"))
    if _want_sweep and not depth_sweep:
        print(f"②-S 워커 요청으로 스윕을 켠다 — 사유: {cfg.get('archSweepWhy') or '(미기재)'}")
    if depth_sweep or _want_sweep:
        # 깊이 축
        depth_cands = [
            ("10층(기본)", list(hidden)),
            ("6층",        [512, 256, 128, 96, 64, 32]),
            ("3층",        [256, 128, 64]),
            ("2층(워커폴백)", [128, 64]),
        ]
        # 규제 축 — 사다리값(현행) 대비 ★완화★ 만 후보로 둔다.
        #   방향에 근거가 있다: 같은 표본에서 트리는 53~54%, 이 망은 47.3% 다. 규제를 더 조이면
        #   이미 못 배우는 망을 더 못 배우게 할 뿐이다. 그래도 '완화가 낫다' 를 단정하지 않는다 —
        #   현행을 후보에 그대로 두고 ★같은 자로 붙인다.★ 현행이 이기면 현행이 남는다.
        def _reg(mul_do, mul_l2, mul_mix, mul_noise):
            return dict(dropout=round(_reg_base["dropout"] * mul_do, 4),
                        l2=_reg_base["l2"] * mul_l2,
                        mixup_p=round(_reg_base["mixup_p"] * mul_mix, 4),
                        input_noise=round(_reg_base["input_noise"] * mul_noise, 4))
        reg_cands = [
            ("규제 현행", dict(_reg_base)),
            ("규제 완화", _reg(0.5, 0.3, 0.4, 0.5)),
            ("규제 최소", _reg(0.2, 0.1, 0.0, 0.0)),
        ]
        _K_full = K
        K = max(1, int(sweep_seeds))
        print(f"②-S 구성 스윕 — 깊이 {len(depth_cands)}종 × 시드 {K} · 같은 표본/분할/시드")
        rank = []
        for tag, hid in depth_cands:
            t0 = time.time()
            r = fit_arch([D] + list(hid) + [1], tag)
            r["tag"] = tag; r["hidden"] = list(hid); r["reg"] = dict(_reg_base)
            r["secs"] = round(time.time() - t0, 1)
            rank.append(r)
            print(f"   · {tag:14s} dims={'-'.join(map(str,r['dims']))} 파라미터 {r['params']:,} "
                  f"valAcc {r['acc']*100:.2f}% 하한 {r['lb']*100:.2f}% AUC {r['auc']:.3f} ({r['secs']}s)")
        # ★깊이 승자 위에서만 규제를 흔든다.★ 전조합(4×3=12)은 예산을 넘긴다 —
        #   두 축을 곱해서 재는 대신, 이긴 깊이에 대해서만 규제를 재는 좌표하강이다.
        rank.sort(key=lambda r: (-r["lb"], -r["acc"], r["params"]))
        _dwin = rank[0]
        print(f"②-S 깊이 승자: {_dwin['tag']} (하한 {_dwin['lb']*100:.2f}%) — 이 깊이에서 규제를 잰다")
        for rtag, rcfg in reg_cands[1:]:      # '현행' 은 위에서 이미 쟀다
            t0 = time.time()
            r = fit_arch([D] + list(_dwin["hidden"]) + [1], rtag, reg=rcfg)
            r["tag"] = _dwin["tag"] + "+" + rtag; r["hidden"] = list(_dwin["hidden"]); r["reg"] = rcfg
            r["secs"] = round(time.time() - t0, 1)
            rank.append(r)
            print(f"   · {r['tag']:20s} do={rcfg['dropout']} l2={rcfg['l2']:.1e} "
                  f"mix={rcfg['mixup_p']} noise={rcfg['input_noise']} → "
                  f"valAcc {r['acc']*100:.2f}% 하한 {r['lb']*100:.2f}% AUC {r['auc']:.3f} ({r['secs']}s)")
        # ★하한(lb)으로 고른다★ — 워커 승격 게이트가 보는 값이다. 동률이면 valAcc, 그다음 작은 모델.
        rank.sort(key=lambda r: (-r["lb"], -r["acc"], r["params"]))
        win = rank[0]
        print(f"②-S 승자: {win['tag']} (하한 {win['lb']*100:.2f}%) — 2위 {rank[1]['tag']} "
              f"하한 {rank[1]['lb']*100:.2f}% · 차이 {(win['lb']-rank[1]['lb'])*100:+.2f}%p")
        if (win["lb"] - rank[1]["lb"]) < 0.005:
            print("   ⚠️ 1·2위 하한 차이가 0.5%p 미만 — 이 표본에서 둘을 가를 근거가 약하다"
                  "(다음 스윕에서 뒤집힐 수 있음). 작은 모델을 택했는지 위 정렬 규칙을 확인할 것.")
        hidden = win["hidden"]; dims = [D] + list(hidden) + [1]
        _reg_win = win.get("reg") or dict(_reg_base)
        K = _K_full
        print(f"② 승자 재학습 — dims={'-'.join(map(str,dims))} seeds={K} "
              f"do={_reg_win['dropout']} l2={_reg_win['l2']:.1e}")
        _fin = fit_arch(dims, win["tag"] + "/최종", reg=_reg_win)
        nets, acc, lb, n_eval = _fin["nets"], _fin["acc"], _fin["lb"], _fin["n_eval"]
        print(f"③ 앙상블 valAcc {acc*100:.2f}% (Wilson하한 {lb*100:.2f}%, n={n_eval}) — {win['tag']}")
        sweep_note = {"winner": win["tag"], "reg": _reg_win, "ranking": [
            {"tag": r["tag"], "dims": r["dims"], "params": r["params"],
             "valAcc": round(r["acc"], 4), "lb": round(r["lb"], 4), "auc": round(r["auc"], 4)}
            for r in rank]}
        # ★잰 값을 저장한다 — 이것이 없어서 V33.204 의 측정이 매번 버려졌다.★
        try:
            _ar = requests.post(BASE + "/api/dnn-arch", params={"key": KEY}, headers=HDR, timeout=60, json={
                "featVer": featver, "hidden": list(hidden), "lb": round(lb, 4), "acc": round(acc, 4),
                "auc": round(_fin.get("auc") or 0, 4), "n": int(Nall),
                "ranking": [{"tag": r["tag"], "lb": round(r["lb"], 4), "acc": round(r["acc"], 4)} for r in rank]})
            print(f"②-S 구성 저장 {_ar.status_code}: {str(_ar.text)[:160]}")
        except Exception as _e:
            print("②-S 구성 저장 실패(다음 학습은 기본값으로 돈다):", _e)
    else:
        _fin = fit_arch(dims)
        nets, acc, lb, n_eval = _fin["nets"], _fin["acc"], _fin["lb"], _fin["n_eval"]
        sweep_note = None

    # [V32.11] BatchNorm 접기(fold) — 각 은닉층 BN을 앞 선형층 가중치/바이어스에 흡수해
    #   Worker 평면 추론 relu(W'x+b')이 relu(BN(Wx+b))와 정확히 동일해진다.
    #   BN: y = gamma*(h-mean)/sqrt(var+eps)+beta = a*h + c,  a=gamma/sqrt(var+eps), c=beta-a*mean.
    #   h=Wx+b → y=(a*W)x+(a*b+c). 접힌 계수가 커질 수 있어 정밀도 4→5자리로 상향(정확도 보존).
    js_nets = []
    for net in nets:
        net.eval()
        Wl, bl = [], []
        L = len(net.lins)
        for i, lin in enumerate(net.lins):
            W = lin.weight.detach().cpu().numpy().astype(np.float64)   # (out,in)
            b = lin.bias.detach().cpu().numpy().astype(np.float64)     # (out,)
            if i < L - 1:   # 은닉층 → BN 접기
                bn = net.bns[i]
                gamma = bn.weight.detach().cpu().numpy().astype(np.float64)
                beta = bn.bias.detach().cpu().numpy().astype(np.float64)
                # ★V32.14: 지역변수 이름을 bn_* 로 — 상단의 피처표준화 mean/std(길이 65)를
                #   덮어써 업로드 시 "mean/std 차원 불일치" 400을 유발하던 버그 수정.
                bn_mean = bn.running_mean.detach().cpu().numpy().astype(np.float64)
                bn_var = bn.running_var.detach().cpu().numpy().astype(np.float64)
                a = gamma / np.sqrt(bn_var + bn.eps)
                W = W * a[:, None]
                b = a * b + (beta - a * bn_mean)
            Wl.append(np.round(W, 5).tolist())
            bl.append(np.round(b, 5).tolist())
        js_nets.append({"W": Wl, "b": bl, "dims": dims})

    if dry:
        print("--dry: 업로드 생략")
        return {"ok": True, "valAcc": acc, "uploaded": False, "depthSweep": sweep_note}

    # ── [V12.35] 분할 업로드: begin → net×K → commit ──
    #   6시드 앙상블은 ~37MB라 한 번에 보내면 Worker(메모리 128MB)가 request.json()에서 죽어 503.
    #   시드별로 쪼개 보내면 Worker는 회당 ~6MB만 파싱 → OOM 없이 6시드 그대로 반영.
    print("④ 업로드 (분할)")

    def _post(params, obj, what, to=300, retries=0, retry_delay=30):
        # [V32.3/V32.5] commit 단계는 Worker가 6시드(~37MB)를 조립·청크저장(~53청크)하는 무거운 작업이라
        #   실패 유형이 둘이다: (a) 응답 지연 → ReadTimeout, (b) D1 과부하 → HTTP 500 "D1 DB is overloaded".
        #   둘 다 일시적이므로 재시도한다. Worker의 commit은 멱등(스테이징 net 재조립·재저장, 또는 이미
        #   반영됐으면 200 반환)이라 재시도가 안전하다. 재시도 사이에 delay를 둬 D1 큐가 빠지게 한다.
        last = None
        for attempt in range(retries + 1):
            try:
                r = requests.post(BASE + "/api/dnn-import", params=params, headers=HDR,
                                  data=json.dumps(obj), timeout=to)
                if r.status_code == 200:
                    return r.json()
                body = r.text[:300]
                retriable = (r.status_code >= 500) and (("D1" in body) or ("overloaded" in body) or ("queued" in body))
                if retriable and attempt < retries:
                    last = RuntimeError(f"{what} {r.status_code}: {body}")
                    print(f"   {what} {r.status_code} D1 과부하 — {retry_delay}s 후 재시도 {attempt+1}/{retries}")
                    time.sleep(retry_delay)
                    continue
                raise RuntimeError(f"{what} {r.status_code}: {body}")
            except requests.exceptions.ReadTimeout as e:
                last = e
                if attempt < retries:
                    print(f"   {what} read timeout({to}s) — {retry_delay}s 후 재시도 {attempt+1}/{retries}")
                    time.sleep(retry_delay)
                    continue
        raise RuntimeError(f"{what} 재시도 {retries+1}회 모두 실패") from last

    # 1) begin — 메타(가중치 제외)만 전송 (D1 과부하 대비 재시도)
    # [V33.115] 고유도 필드 동봉 — 정확도를 잰 구간(검증 뒤절반)의 유효표본수를 함께 보낸다.
    #   워커가 valN(명목) 대신 valNEff 로 Wilson 하한을 재게 하려면 이 값이 있어야 한다.
    _dnn_meta = {"featVer": featver, "mean": mean.tolist(), "std": std.tolist(), "dims": dims,
                 "seeds": len(js_nets), "valAcc": round(acc, 4), "valAccLB": round(lb, 4),
                 "valN": n_eval, "n": N}
    # [V33.262] 블록 IC 를 함께 올린다 — 워커의 승격 판정에 ★정확도 말고 다른 자★ 가 하나 더 생겼다.
    #   부스터가 이미 쓰던 그 자다(같은 함수·같은 문턱). 없으면 워커는 정확도 경로만 본다.
    # [V33.292] accBase(무실력 정확도)도 같이 올린다 — 워커의 정확도 문턱 기준점이다.
    for _k in ("valICBlock", "valICIR", "valICt", "valICK", "accBase", "accBasePooled",
               "valICBlockPooled", "valICtPooled"):
        if _k in _fin:
            _dnn_meta[_k] = _fin[_k]
    try:
        _dnn_meta.update(_uniq_fields(_fin["uw"]))   # [V33.350] 지역변수 참조 → 반환값 참조
    except Exception as _e:
        print("   고유도 필드 생략:", _e)
    _post({"key": KEY, "stage": "begin"}, _dnn_meta, "begin", retries=3)
    # 2) net — 시드별 개별 전송(회당 ~6MB, 청크 D1 쓰기 → 과부하 시 재시도)
    for k, nt in enumerate(js_nets):
        _post({"key": KEY, "stage": "net", "i": k}, nt, f"net[{k}]", to=300, retries=3)
        print(f"   시드 {k+1}/{len(js_nets)} 업로드")
    # 3) commit — Worker가 조립·검증·게이트 (무거움: 넉넉한 타임아웃 + D1과부하/타임아웃 재시도)
    res = _post({"key": KEY, "stage": "commit"}, {}, "commit", to=600, retries=5, retry_delay=45)
    print("✅", json.dumps(res.get("trust", {}), ensure_ascii=False), res.get("note", ""))
    if target == "dnn": return {"ok": True, "target": target, "trust": res.get("trust")}
    # [V32.7] GBDT도 외부학습해 섀도우 업로드(같은 표본 재사용 — 추가 export 부하 0). 실패해도 DNN 결과엔 무영향.
    if not dry:
        # [V33.350] ★뒤쪽 단계를 목록으로 만들고 예산 안에서 회전시킨다.★
        #   종전엔 이 자리가 try/except 로 줄줄이 늘어서 있었고, 예산이 끝나면 Modal 이
        #   그 지점에서 작업을 ★죽였다★. 그러면 (1) 앞서 성공한 업로드까지 '실패한 실행' 으로
        #   뭻히고 (2) 뒤 단계는 매 회차 같은 자리에서 잘려 ★영원히 한 번도 안 돈다.★
        #   실측에서 MIND 이후(단타·SEQ·MEMO·STACK 경계)가 정확히 그 상태였다.
        #
        #   단계들은 서로 독립이다 — 각자 자기 모델을 따로 업로드하고, 위 DNN 결과에도
        #   서로에게도 영향을 주지 않는다(그래서 원래도 예외를 삼켰다). 순서를 바꿔도 된다.
        #   → 남은 예산이 모자라면 건너뛰고, ★다음 회차는 건너뛴 그 단계부터★ 시작한다.
        #     크론이 6시간마다 도니 하루면 모든 단계가 제 차례를 받는다.
        #   ※ STACK 경계 통지는 회전에 넣지 않는다 — 한 줄 POST 라 비용이 없고,
        #     이 회차가 무엇을 학습했든 홀드아웃 경계는 같기 때문이다.
        _plan = list(_PLAN)
        _byname = dict(_plan)
        # [V33.377] 커서가 아니라 ★굶은 정도★ 로 순서를 정한다(STARVE 주석의 실측 참조).
        _names0 = [n for n, _ in _plan]
        _ages = _stage_ages({"last_ok": _last_ok}, _names0)
        _order = _starve_order(_names0, _ages)
        _plan = [(n, _byname[n]) for n in _order]
        def _agetxt(a):
            return "한 번도" if a == float("inf") else f"{a/3600:.0f}h"
        print(f"⑤~⑩ 후속 학습 {len(_plan)}단계 · 남은 예산 {_left():.0f}s "
              f"(예상 합계 {sum(_costs.get(n, 600) for n, _ in _plan)}s)")
        print("   굶은 순서: " + " · ".join(f"{n}({_agetxt(_ages.get(n, 0.0))})" for n in _order))
        for _nm, _fn in _plan:
            _stage(_nm, _fn)

        # ── [V33.205] 홀드아웃 경계를 워커에 알린다 ─────────────────────────────
        #   위 모델들은 전부 ★시간순 뒤쪽★ 을 홀드아웃으로 떼고(V33.376 이후 그 크기는
        #   행 비율이 아니라 ★달력 기간★ 으로 정해진다) 퍼지·엠바고를 건 뒤
        #   앞쪽만으로 학습한다. 즉 방금 올린 모델들은 그 구간을 ★학습한 적이 없다★ —
        #   워커가 지금 모델로 그 구간을 채점하면 그게 out-of-fold 예측이고, STACK 이
        #   요구하는 값이 정확히 그것이다. ★모델이 아니라 경계 시각 하나만 보낸다.★
        try:
            #   이 회차가 실제로 다시 적합한 모델 이름(워커 _KEY 의 이름 규약).
            #   DNN 은 이 경로에서 항상 돌므로 언제나 포함된다.
            _STAGE2OOF = {"gbdt": "gbdt", "mind": "mind", "boosters": "boost"}
            _oof_models = ["dnn"] + [_STAGE2OOF[n] for n in _ran if n in _STAGE2OOF]
            _oof_min_ts = int(TS[N - n_val])          # 홀드아웃 첫 표본의 관측 시각
            #   (TS 는 표본을 ts 로 정렬한 뒤 만든 것이라 이 자리가 곧 홀드아웃 첫 표본이다 —
            #    check-stack-oof 가 그 정렬을 지킨다.)
            _r = requests.post(BASE + "/api/stack-oof-window", params={"key": KEY}, headers=HDR,
                               data=json.dumps({"featVer": featver, "minTs": _oof_min_ts,
                                                "n": int(n_val),
                                                # [V33.377] ★이 회차가 실제로 다시 학습한 것만 적는다.★
                                                #   종전엔 네 이름을 박아 보냈는데, 예산으로 gbdt·mind 가
                                                #   생략된 회차에도 "다시 학습했다" 고 주장한 셈이다.
                                                #   워커의 누출 방어는 그 주장을 믿고 판정한다 —
                                                #   거짓 주장이 통과하면 in-sample 구간을 out-of-fold 로
                                                #   채점하게 된다. 통과 못 해도 거짓말은 하지 않는다.
                                                "models": _oof_models}),
                               timeout=60)
            if _r.status_code == 200:
                print(f"⑪ STACK 홀드아웃 경계 통지 — minTs={_oof_min_ts} ({int(n_val)}건)")
            else:
                # 409 = 경계를 과거로 되돌리려 함(워커가 막는다). 실패해도 학습 결과엔 영향 없다.
                print(f"⑪ STACK 경계 통지 실패 {_r.status_code}: {_r.text[:200]}")
        except Exception as e:
            print("⑪ STACK 경계 통지 예외(무시):", e)

        # ── 회차 마무리 — 무엇을 했고 무엇을 못 했는지 ★남긴다★ ──
        if _skipped:
            print(f"⚠️ 예산으로 생략 {len(_skipped)}단계: {', '.join(_skipped)} "
                  f"— 다음 회차가 '{_skipped[0]}' 부터 시작한다")
        else:
            print(f"✅ 후속 학습 전 단계 완주({len(_ran)}단계) · 남은 예산 {_left():.0f}s")
        if _store is not None:
            try:
                _store["stage_cost"] = _costs
                _store["last_ok"] = _last_ok
                _store["last_run"] = {"ts": int(time.time()), "ran": _ran, "skipped": _skipped,
                                      "elapsed": int(time.time() - _T0), "n": int(N)}
            except Exception as e:
                print("   상태 저장 실패(다음 회차는 기본 순서):", e)
    return {"ok": True, "valAcc": acc, "trust": res.get("trust"), "depthSweep": sweep_note,
            "ran": _ran, "skipped": _skipped, "elapsed": int(time.time() - _T0)}


# ============================================================================
# [V32.7] GBDT 외부학습(섀도우) — Worker GBDT와 동일한 트리 포맷/추론식으로 학습해 /api/gbdt-import 로
#   업로드한다. Worker 추론: raw = bias + Σ eta·leaf, x[f] < t → left, score = sigmoid(raw),
#   leaf w = -G/(H+λ). 여기선 그 포맷을 그대로 산출한다(독립 모델 — Worker가 채점만 하면 됨).
#   기본 업로드는 섀도우(비활성) — Worker가 자체 표본으로 self-검증 후 수동 승격(?activate=1).
# ============================================================================
def _build_sequences(X, TS, SYM, L):
    """[V33.267] ★내보내기 형식을 안 바꾸고★ 시퀀스를 만든다.

    표본은 이미 (종목 s, 시각 ts) 를 갖고 있다. 같은 종목의 과거 표본을 시간순으로
    쌓으면 그대로 [L, D] 가 된다. 익스포트도 워커도 고칠 필요가 없다.

    ★미래를 보면 안 된다.★ 각 표본 i 의 시퀀스는 ts <= ts_i 인 같은 종목 표본들의
    마지막 L 개다(자기 자신 포함, 가장 최신이 맨 뒤). 정렬은 종목 안에서만 한다.
    앞이 모자라면 ★가장 오래된 행으로 채운다★ — 0 으로 채우면 표준화 후 '평균값 봉'
    이 되어 없는 과거를 지어내는 셈이고, 워커 추론도 같은 규칙을 쓴다.
    """
    import numpy as np
    N, D = X.shape
    order = np.lexsort((TS, SYM))            # 종목 → 시각 순
    seq_idx = np.empty((N, L), dtype=np.int64)
    start = 0
    while start < N:
        end = start
        cur = SYM[order[start]]
        while end < N and SYM[order[end]] == cur:
            end += 1
        grp = order[start:end]               # 이 종목의 표본(시각 오름차순)
        for k in range(len(grp)):
            lo = max(0, k - L + 1)
            win = grp[lo:k + 1]
            if len(win) < L:                 # 앞을 가장 오래된 행으로 채운다
                win = np.concatenate([np.full(L - len(win), win[0], dtype=np.int64), win])
            seq_idx[grp[k]] = win
        start = end
    return seq_idx


def _train_and_upload_seq(BASE, KEY, HDR, X, Y, TS, SYM, featver, D, UNIQ=None, cfg=None):
    """[V33.267] Transformer 인코더(시퀀스). 요청: DNN 을 Transformer 로 승급.

    비용을 재보고 골랐다 — L=16·d=32·1층·2헤드는 종목당 곱셈 약 19만 회로, 현행
    DNN(763,345×6시드 = 460만)보다 ★25배 싸다.★ 무거워서 못 쓰는 규모가 아니다.

    ★nn.TransformerEncoderLayer 를 쓰지 않는다.★ 그 모듈의 내부 규약(노름 위치·
    어텐션 스케일·바이어스 병합)을 역추적해 워커 JS 와 맞추는 것보다, 워커와 똑같은
    순서의 명시적 연산으로 짜는 편이 안전하다. 이 저장소는 학습·추론 불일치로
    여러 번 당했다(V32.11 BatchNorm 접기가 그 흔적이다).
    """
    import numpy as np, math, json, time, requests
    try:
        import torch, torch.nn as nn
    except Exception as e:
        print("⑨ SEQ 생략 — torch 없음:", e); return None

    C = (cfg or {}).get("seq") or {}
    if C.get("enabled") is False:
        print("⑨ SEQ 생략 — 워커가 껐다(SEQML.enabled=false)"); return None
    L = int(C.get("L", 16)); dm = int(C.get("d", 64)); Hh = int(C.get("heads", 4))
    NL = max(1, min(6, int(C.get("layers", 2))))
    ff = dm * int(C.get("ffMult", 4))
    N = len(Y)
    if N < 20000:
        print(f"⑨ SEQ 생략 — 표본 부족({N}/20000)"); return None
    if dm % Hh != 0:
        print(f"⑨ SEQ 생략 — d({dm}) 가 heads({Hh}) 로 안 나눠짐"); return None

    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    t0 = time.time()
    seq_idx = _build_sequences(X, TS, np.asarray(SYM), L)
    print(f"⑨ SEQ 시퀀스 조립 {N}×{L} ({time.time()-t0:.1f}s) — 익스포트 변경 0")

    # 표준화는 ★학습 구간에서만★ 구한다(검증 통계가 새면 그만큼 낙관적으로 나온다)
    # Codex V33.349 / B-2: SEQ uses the same embargo and exact row indices as other models.
    _order, _tri, _, _vai, n_val, _emb = _split_ts(TS, 0.2, _EMBARGO_MS, min_val=200, horizon_ms=_HORIZON_MS, tag="GBDT")
    _tri, _vai = _order[_tri], _order[_vai]  # indices into original X/sequence table
    tr_end = len(_tri)  # training count only, never a boundary into X
    mean = X[_tri].mean(axis=0); std = X[_tri].std(axis=0); std[std < 1e-9] = 1.0
    Xn = np.clip((X - mean) / std, -6, 6).astype(np.float32)

    class SeqBlock(nn.Module):
        """인코더 블록 하나 — 워커 JS 의 블록 하나와 ★연산 순서가 같다★."""
        def __init__(self, dm, Hh, ff):
            super().__init__()
            self.dm = dm; self.Hh = Hh
            self.ln1 = nn.LayerNorm(dm, eps=1e-5)
            self.q = nn.Linear(dm, dm); self.k = nn.Linear(dm, dm)
            self.v = nn.Linear(dm, dm); self.o = nn.Linear(dm, dm)
            self.ln2 = nn.LayerNorm(dm, eps=1e-5)
            self.f1 = nn.Linear(dm, ff); self.f2 = nn.Linear(ff, dm)
        def forward(self, h):
            a = self.ln1(h)
            B = a.shape[0]; L2 = a.shape[1]; dh = self.dm // self.Hh
            q = self.q(a).view(B, L2, self.Hh, dh).transpose(1, 2)   # [B,H,L,dh]
            k = self.k(a).view(B, L2, self.Hh, dh).transpose(1, 2)
            v = self.v(a).view(B, L2, self.Hh, dh).transpose(1, 2)
            sc = torch.matmul(q, k.transpose(-1, -2)) / math.sqrt(dh)
            w = torch.softmax(sc, dim=-1)
            ctx = torch.matmul(w, v).transpose(1, 2).reshape(B, L2, self.dm)
            h = h + self.o(ctx)
            h = h + self.f2(torch.relu(self.f1(self.ln2(h))))
            return h

    class SeqFormer(nn.Module):
        """[V33.271] 블록을 ★N개★ 쌓는다. 1층은 '시점끼리 한 번 본다' 가 전부라
           2단계 관계(A→B→C)를 못 쓴다 — 정보가 며칠에 걸쳐 퍼지는 걸 보라고 넣은
           모델이니 그 깊이가 본질에 가깝다."""
        def __init__(self, dm=None, Hh_=None, nl=None):
            super().__init__()
            dm = dm or globals().get("_dm_", 0)
            self.dm = dm
            self.win = nn.Linear(D, dm); self.pos = nn.Parameter(torch.zeros(L, dm))
            self.blocks = nn.ModuleList([SeqBlock(dm, Hh_, dm * int(C.get("ffMult", 4))) for _ in range(nl)])
            self.lnf = nn.LayerNorm(dm, eps=1e-5); self.head = nn.Linear(dm, 1)
            nn.init.normal_(self.pos, std=0.02)
        def forward(self, x):                      # x: [B, L, D]
            h = self.win(x) + self.pos             # [B,L,dm]
            for blk in self.blocks:
                h = blk(h)
            return self.head(self.lnf(h[:, -1, :])).squeeze(-1)

    Xt = torch.tensor(Xn, device=dev)
    Yt = torch.tensor(Y.astype(np.float32), device=dev)
    Si = torch.tensor(seq_idx, device=dev)
    tr = torch.tensor(_tri, device=dev); va = torch.tensor(_vai, device=dev)
    yva = Y[_vai]
    uw = UNIQ[_vai] if (UNIQ is not None and len(UNIQ) == N) else np.ones(len(yva))
    neff = max(8, int(round(float(uw.sum()))))
    ep = int(C.get("epochs", 12)); bs = 512
    pos = float(Y[_tri].sum()); wpos = tr_end / (2 * pos) if pos > 0 else 1.0
    wneg = tr_end / (2 * (tr_end - pos)) if (tr_end - pos) > 0 else 1.0

    def fit_seq(dm_, Hh_, nl_, tag=""):
        """한 구성을 학습하고 (하한, 정확도, 확률, 모델) 을 돌려준다."""
        net_ = SeqFormer(dm_, Hh_, nl_).to(dev)
        opt_ = torch.optim.AdamW(net_.parameters(), lr=1e-3, weight_decay=1e-2)
        for _e in range(ep):
            net_.train(); perm = tr[torch.randperm(tr_end, device=dev)]
            for b in range(0, tr_end, bs):
                bi = perm[b:b + bs]
                xb = Xt[Si[bi]]                    # [B,L,D] — 시퀀스 게더
                yb = Yt[bi]
                wc = torch.where(yb > 0.5, torch.tensor(wpos, device=dev), torch.tensor(wneg, device=dev))
                loss = (nn.functional.binary_cross_entropy_with_logits(net_(xb), yb, reduction="none") * wc).mean()
                opt_.zero_grad(); loss.backward()
                torch.nn.utils.clip_grad_norm_(net_.parameters(), 1.0)
                opt_.step()
        net_.eval()
        with torch.no_grad():
            pv_ = []
            for b in range(0, len(va), 1024):
                pv_.append(torch.sigmoid(net_(Xt[Si[va[b:b + 1024]]])).cpu().numpy())
            p_ = np.concatenate(pv_)
        a_ = float(((p_ >= 0.5) == (yva > 0.5)).mean())
        z = 1.64; z2 = z * z; den = 1 + z2 / neff; cen = a_ + z2 / (2 * neff)
        rad = z * math.sqrt((a_ * (1 - a_) + z2 / (4 * neff)) / neff)
        lb_ = max(0.0, (cen - rad) / den)
        npar = sum(pp.numel() for pp in net_.parameters())
        print(f"⑨{tag} d{dm_}·헤드{Hh_}·{nl_}층 ({npar:,}p) → valAcc {a_*100:.2f}% 하한 {lb_*100:.2f}%")
        return lb_, a_, p_, net_, npar

    # ── ★용량을 내가 고르지 않는다 — 재서 고른다.★ ────────────────────────────
    #   V33.267 은 d32·1층이었고 "이 과제에 충분하다" 는 근거가 없었다(그렇게 적었다).
    #   과소적합이 걱정이면 키우면 되지만, 키운 게 나은지도 재 봐야 아는 것이다.
    #   후보를 같은 표본·같은 분할로 학습해 ★유효표본 Wilson 하한★ 으로 겨룬다 —
    #   워커의 승격 게이트가 보는 것과 같은 자다. 이긴 구성을 /api/seq-arch 로 돌려주면
    #   워커가 다음부터 그 형상을 내려준다(DNNARCH 와 같은 배치).
    cands = [(dm, Hh, NL)]
    if C.get("sweep") is not False and N >= 60000:
        for c in [(dm, Hh, max(1, NL - 1)), (dm * 2 if dm <= 64 else dm, min(8, Hh * 2), NL),
                  (max(16, dm // 2), max(1, Hh // 2), NL)]:
            if c not in cands and c[0] % c[1] == 0:
                cands.append(c)
    best = None; table = []
    for (cd, ch, cl) in cands:
        try:
            r_ = fit_seq(cd, ch, cl, tag="-스윕" if len(cands) > 1 else "")
        except Exception as e:
            print(f"⑨ 후보 d{cd}·헤드{ch}·{cl}층 실패(건너뜀): {e}"); continue
        table.append({"d": cd, "heads": ch, "layers": cl, "accLB": round(r_[0], 4),
                      "acc": round(r_[1], 4), "params": int(r_[4])})
        if best is None or r_[0] > best[0]:
            best = r_; dm, Hh, NL = cd, ch, cl
    if best is None:
        print("⑨ SEQ 생략 — 후보를 하나도 학습하지 못했다"); return None
    if len(table) > 1:
        table.sort(key=lambda r: -r["accLB"])
        print("⑨ 스윕 순위: " + " | ".join(f"d{r['d']}h{r['heads']}x{r['layers']}층 {r['accLB']*100:.2f}%" for r in table))
        try:
            requests.post(BASE + "/api/seq-arch", params={"key": KEY}, headers=HDR, timeout=60,
                          data=json.dumps({"featVer": featver, "d": dm, "heads": Hh, "layers": NL,
                                           "table": table, "n": int(N)}))
        except Exception as e:
            print("⑨ seq-arch 업로드 예외(무시):", e)
    lb, acc, pva, net, nparam = best
    icf = _ic_block_fields(pva, yva, mkt=_mkt_of_X(X[_vai]), ts=TS[_vai],
                           horizon_ms=_HORIZON_MS)   # [V33.291/292 · V33.366]
    print(f"⑨ SEQ 채택 d{dm}·헤드{Hh}·{NL}층 valAcc {acc*100:.2f}% 하한 {lb*100:.2f}% (유효 {neff}/{len(yva)})"
          + (f" 블록IC {icf['valICBlock']:.4f} t {icf['valICt']:.2f}" if "valICt" in icf else ""))

    # ── 가중치를 워커 규약(row-major W[out][in])으로 내보낸다
    def W(m): return np.round(m.weight.detach().cpu().numpy().astype(np.float64), 6).tolist()
    def B_(m): return np.round(m.bias.detach().cpu().numpy().astype(np.float64), 6).tolist()
    def P(t): return np.round(t.detach().cpu().numpy().astype(np.float64), 6).tolist()
    blocks = [{"ln1g": P(bk_.ln1.weight), "ln1b": P(bk_.ln1.bias),
               "Wq": W(bk_.q), "bq": B_(bk_.q), "Wk": W(bk_.k), "bk": B_(bk_.k),
               "Wv": W(bk_.v), "bv": B_(bk_.v), "Wo": W(bk_.o), "bo": B_(bk_.o),
               "ln2g": P(bk_.ln2.weight), "ln2b": P(bk_.ln2.bias),
               "W1": W(bk_.f1), "b1": B_(bk_.f1), "W2": W(bk_.f2), "b2": B_(bk_.f2)}
              for bk_ in net.blocks]
    model = {"featVer": featver, "L": L, "D": int(D), "d": dm, "heads": Hh, "layers": len(blocks),
             "mean": np.round(mean, 6).tolist(), "std": np.round(std, 6).tolist(),
             "Win": W(net.win), "bin": B_(net.win), "pos": P(net.pos),
             "blocks": blocks,
             "lng": P(net.lnf.weight), "lnb": P(net.lnf.bias),
             "Wh": P(net.head.weight)[0], "bh": float(P(net.head.bias)[0])}

    # ★probe — 워커가 이 확률을 재현 못 하면 승격을 거부한다.★ 표준화 ★전★ 원본을 싣는다
    #   (워커가 자기 mean/std 로 표준화하는 경로까지 함께 검증해야 의미가 있다).
    rng = np.random.default_rng(7)
    pi = rng.choice(len(va), size=min(24, len(va)), replace=False)
    probe = []
    for i in pi:
        gi = seq_idx[_vai[int(i)]]
        probe.append({"x": X[gi].astype(np.float64).round(6).tolist(), "p": float(pva[int(i)])})

    payload = {"model": model, "valAcc": round(acc, 4), "valAccLB": round(lb, 4),
               "valN": int(len(yva)), "n": int(N), "featVer": featver, "probe": probe}
    payload.update(icf)
    try:
        r = requests.post(BASE + "/api/seq-import", params={"key": KEY}, headers=HDR,
                          data=json.dumps(payload), timeout=300)
        print(f"⑨ SEQ 업로드 {r.status_code}: {str(r.text)[:220]}")
    except Exception as e:
        print("⑨ SEQ 업로드 실패:", e)
    return {"acc": acc, "lb": lb}


def _train_and_upload_gbdt(BASE, KEY, HDR, X, Y, TS, featver, D, UNIQ=None,
                           endpoint="/api/gbdt-import", tag="GBDT", hp=None):
    """[V33.249] endpoint/tag/hp 를 받아 ★같은 학습기★ 를 위원장 슬롯에도 쓴다.
       코드를 복제하지 않는다 — 복제하면 한쪽만 고쳐지는 날이 반드시 온다."""
    import numpy as np, math, json, time, requests
    # [V32.9] GBDT 강화: 학습률↓+트리↑(저LR·다트리=일반화 향상, 표준 부스팅 정석) + 행/열 서브샘플
    #   (stochastic GBDT — 과적합↓·일반화↑). 표(tabular) 금융데이터엔 딥넷보다 GBDT가 보통 강함.
    # [V32.66] 부스터 강화: 학습률↓(0.04→0.03)·트리↑(400→600)·patience↑(30→50)
    #   저LR·다트리·조기중단 = 더 세밀한 그래디언트로 일반화↑(과적합은 early-stop+홀드아웃 게이트가 방어).
    ETA, MAXDEPTH, LAM, GAMMA, MINCHILD = 0.03, 4, 1.0, 0.1, 5.0
    MAXBINS, MAXTREES, PATIENCE, VALFRAC = 64, 600, 50, 0.2
    SUBSAMPLE, COLSAMPLE = 0.8, 0.8
    _seed = 12345
    if hp:
        # 위원장 슬롯은 ★다른 설정·다른 시드★ 로 돌린다 — 같은 값이면 gbdt_model 의 사본일 뿐이고
        # 위원회에 같은 의견이 두 표 들어간다. 다양성이 결합의 전제다.
        ETA = hp.get("eta", ETA); MAXDEPTH = hp.get("depth", MAXDEPTH)
        SUBSAMPLE = hp.get("sub", SUBSAMPLE); COLSAMPLE = hp.get("col", COLSAMPLE)
        MAXTREES = hp.get("trees", MAXTREES); MINCHILD = hp.get("minchild", MINCHILD)
        _seed = hp.get("seed", _seed)
    rng = np.random.default_rng(_seed)
    N = len(Y)
    if N < 400:
        print(f"{tag}: 표본 부족 {N} — 생략"); return
    # [V33.341] 엠바고 분할(공용 헬퍼) — 종전엔 경계를 안 비워 라벨 지평만큼 겹쳤다.
    order, _tri, _cali, _vai, nval, _emb = _split_ts(TS, VALFRAC, _EMBARGO_MS, min_val=200, horizon_ms=_HORIZON_MS, tag=tag)
    Xs = X[order].astype(np.float64); Ys = Y[order].astype(np.float64)
    Xtr, Ytr = Xs[_tri], Ys[_tri]
    Xva, Yva = Xs[_vai], Ys[_vai]
    print(f"   GBDT 분할: 학습 {len(_tri)} · 검증 {len(_vai)} · 엠바고 {_emb/86400000:.0f}일")
    # [V33.115] 검증구간 고유도 — 정렬 후 뒤 nval 개의 ★원본 인덱스★ 로 뽑아야 한다.
    UWva = _uw_pick(UNIQ, N, order[-nval:])
    Ntr = len(Ytr)
    if Ntr < 200:
        print(f"{tag}: train 부족 — 생략"); return
    pos = float(Ytr.sum()); neg = Ntr - pos
    wPos = Ntr / (2 * pos) if pos > 0 else 1.0
    wNeg = Ntr / (2 * neg) if neg > 0 else 1.0
    sw = np.where(Ytr > 0, wPos, wNeg)
    bias = math.log(max(1.0, pos) / max(1.0, neg))
    # 피처별 분위수 컷(≤63) — Worker _gbdtHistPrep과 동일 개념. bin = "x 이하인 컷 수"(searchsorted right).
    step = max(1, Ntr // 6000)
    edges = []
    for f in range(D):
        col = Xtr[::step, f]; col = col[np.isfinite(col)]
        if len(col) == 0:
            edges.append(np.array([])); continue
        qs = np.quantile(col, np.linspace(0, 1, MAXBINS + 1)[1:-1])
        edges.append(np.unique(qs))
    binsT = np.zeros((Ntr, D), dtype=np.int32)
    for f in range(D):
        if len(edges[f]):
            binsT[:, f] = np.searchsorted(edges[f], Xtr[:, f], side="right")

    def sigmoid(z): return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))

    def build(idx, depth, grad, hess, cols):
        G = float(grad[idx].sum()); H = float(hess[idx].sum())
        if depth >= MAXDEPTH or H < 2 * MINCHILD or len(idx) < 4:
            return {"w": float(-G / (H + LAM))}
        base = G * G / (H + LAM); best = None
        gi = grad[idx]; hi = hess[idx]
        for f in cols:                       # [V32.9] 열 서브샘플 — 이 트리에 배정된 피처만 탐색
            e = edges[f]
            if len(e) == 0: continue
            nb = len(e) + 1
            b = binsT[idx, f]
            gh = np.bincount(b, weights=gi, minlength=nb)
            hh = np.bincount(b, weights=hi, minlength=nb)
            GL = np.cumsum(gh)[:-1]; HL = np.cumsum(hh)[:-1]
            GR = G - GL; HR = H - HL
            with np.errstate(invalid="ignore", divide="ignore"):
                gain = 0.5 * (GL * GL / (HL + LAM) + GR * GR / (HR + LAM) - base) - GAMMA
            gain = np.where((HL >= MINCHILD) & (HR >= MINCHILD), gain, -1e18)
            if gain.size == 0: continue
            bi = int(np.argmax(gain))
            if gain[bi] > 1e-7 and (best is None or gain[bi] > best[0]):
                best = (float(gain[bi]), int(f), bi, float(e[bi]))
        if best is None:
            return {"w": float(-G / (H + LAM))}
        _, bf, bb, bt = best
        m = binsT[idx, bf] <= bb
        li, ri = idx[m], idx[~m]
        if len(li) == 0 or len(ri) == 0:
            return {"w": float(-G / (H + LAM))}
        return {"f": int(bf), "t": bt, "l": build(li, depth + 1, grad, hess, cols), "r": build(ri, depth + 1, grad, hess, cols)}

    def apply_tree(node, Xm):
        out = np.zeros(len(Xm))
        def rec(nd, idx):
            if "w" in nd:
                out[idx] = nd["w"]; return
            col = Xm[idx, nd["f"]]; lm = col < nd["t"]
            rec(nd["l"], idx[lm]); rec(nd["r"], idx[~lm])
        rec(node, np.arange(len(Xm)))
        return out

    raw = np.full(Ntr, bias); vraw = np.full(nval, bias)
    trees = []; best_vloss = 1e18; best_k = 0; wait = 0
    ncol = max(1, int(round(D * COLSAMPLE)))
    nrow = max(50, int(round(Ntr * SUBSAMPLE)))
    allrows = np.arange(Ntr)
    for k in range(MAXTREES):
        p = sigmoid(raw)
        grad = (p - Ytr) * sw
        hess = np.maximum(p * (1.0 - p) * sw, 1e-6)
        # [V32.9] stochastic GBDT — 트리마다 행/열 서브샘플(과적합↓·일반화↑). 트리는 서브셋으로 성장,
        #   raw 업데이트는 전체 행에 적용(표준 gradient boosting).
        ridx = allrows if nrow >= Ntr else rng.choice(Ntr, size=nrow, replace=False)
        cols = np.arange(D) if ncol >= D else rng.choice(D, size=ncol, replace=False)
        tree = build(ridx, 0, grad, hess, cols)
        trees.append(tree)
        raw = raw + ETA * apply_tree(tree, Xtr)
        vraw = vraw + ETA * apply_tree(tree, Xva)
        vp = np.clip(sigmoid(vraw), 1e-6, 1 - 1e-6)
        vloss = float(-np.mean(Yva * np.log(vp) + (1 - Yva) * np.log(1 - vp)))
        if vloss < best_vloss - 1e-5:
            best_vloss = vloss; best_k = len(trees); wait = 0
        else:
            wait += 1
            if wait >= PATIENCE: break
    if best_k > 0:
        trees = trees[:best_k]
    # 최종 트리로 val 정확도·Wilson 하한 재계산
    vraw = np.full(nval, bias)
    for t in trees:
        vraw = vraw + ETA * apply_tree(t, Xva)
    vacc = float(((sigmoid(vraw) >= 0.5).astype(np.float64) == Yva).mean())
    # [V33.115] 명목 nval 이 아니라 유효표본수로 Wilson 하한을 잰다(겹친 라벨은 독립 관측이 아니다).
    _neff = _neff_of(UWva)
    z = 1.96; nn = float(_neff); ph = vacc; denom = 1 + z * z / nn
    center = (ph + z * z / (2 * nn)) / denom
    half = (z * math.sqrt(ph * (1 - ph) / nn + z * z / (4 * nn * nn))) / denom
    vlb = max(0.0, center - half)
    # [V32.15] 변환정합성 probe — Worker가 라이브러리 확률을 재현하는지 검증할 (x, p) 표본.
    #   holdout val에서 최대 200행 추출(sigmoid(vraw)=이 트리앙상블의 확률).
    _vp = sigmoid(vraw)
    _pi = np.linspace(0, nval - 1, min(200, nval)).astype(int)
    probe = [{"x": Xva[i].tolist(), "p": float(_vp[i])} for i in _pi]
    model = {"trees": trees, "eta": ETA, "bias": float(bias), "valAcc": round(vacc, 4),
             "valAccLB": round(vlb, 4), "valN": int(nval), "n": int(N), "featVer": featver, "probe": probe}
    model.update(_uniq_fields(UWva))
    if hp and hp.get("algo"): model["algo"] = hp["algo"]
    print(f"{tag}: trees={len(trees)} valAcc={vacc:.3f} lb={vlb:.3f} (유효 {_neff}/{nval}) → 업로드(activate)")
    for attempt in range(4):
        try:
            # [V32.15] activate=1 — sane(변환정합)+trustFloor 통과 시 라이브 승격(DNN과 동일 정책).
            r = requests.post(BASE + endpoint, params={"key": KEY, "activate": "1"}, headers=HDR,
                              data=json.dumps(model), timeout=180)
            if r.status_code == 200:
                print(f"{tag} 업로드 OK:", json.dumps(r.json(), ensure_ascii=False)); return
            b = r.text[:300]
            if r.status_code >= 500 and (("D1" in b) or ("overloaded" in b) or ("queued" in b)) and attempt < 3:
                print(f"{tag} 업로드 D1 과부하 — 30s 후 재시도 {attempt+1}/3"); time.sleep(30); continue
            print(f"{tag} 업로드 실패:", r.status_code, b); return
        except requests.exceptions.ReadTimeout:
            if attempt < 3:
                print(f"{tag} 업로드 타임아웃 — 20s 후 재시도 {attempt+1}/3"); time.sleep(20); continue
    print(f"{tag} 업로드 최종 실패")


# ============================================================================
# [V32.13] 부스팅 3종(XGBoost·LightGBM·CatBoost) 위원회 멤버 — 표(tabular) 금융데이터의 주력.
#   각 라이브러리 트리를 Worker의 GBDT 스코어러 포맷 {trees:[{f,t,l,r}|{w}], eta, bias}로 변환해
#   업로드(섀도우). Worker 추론 변경 0(mlGBDTScore 재사용). bias는 라이브러리 raw margin과 트리합의
#   차이(상수)로 정합. 로컬 합성표본으로 변환 정합성 검증 완료(LGB/CAT 정확일치, XGB 99.9%).
# ============================================================================
# [V33.77] IC / RankIC — 퀀트 업계의 표준 평가지표.
#   왜 정확도를 버리는가: 10거래일 초과수익 예측에서 "좋은" 모델의 IC 는 0.02~0.08 이고
#   0.1 이상은 드물다. 이는 이진 정확도로 51~54% 에 해당한다. 즉 우리가 쓰던 정확도 척도는
#   좋은 모델과 쓸모없는 모델을 거의 구분하지 못하는 구간에 몰려 있다.
#   더 심각한 건 위원회 가중이다 — softmax(12*(acc−0.5)) 는 실력이 2~6배 차이나는 모델에도
#   55:45 ~ 57:43 을 준다(사실상 단순평균). IC 로 바꾸면 같은 차이가 86:14 ~ 98:2 가 된다.
#   랭킹 능력(어느 종목이 더 오를지)이 매매에서 실제로 쓰는 정보이므로 RankIC 를 함께 본다.
def _calc_ic(pred, y):
    import numpy as np
    try:
        p = np.asarray(pred, dtype=np.float64); t = np.asarray(y, dtype=np.float64)
        if len(p) < 30 or p.std() < 1e-12 or t.std() < 1e-12: return 0.0, 0.0
        ic = float(np.corrcoef(p, t)[0, 1])
        rp = np.argsort(np.argsort(p)).astype(np.float64)
        rt = np.argsort(np.argsort(t)).astype(np.float64)
        ric = float(np.corrcoef(rp, rt)[0, 1]) if rp.std() > 0 and rt.std() > 0 else 0.0
        return (0.0 if not np.isfinite(ic) else ic), (0.0 if not np.isfinite(ric) else ric)
    except Exception:
        return 0.0, 0.0


# [V33.91] ★IC 유의성 — 점추정 IC 는 위원회 가중의 근거가 되기엔 너무 흔들린다★
#   워커에서 실측했다: 진짜 IC 가 0 인 순수 잡음 모델이 raw IC ≥ 0.012 게이트를
#   ★43~49%★ 통과하고, 그중 최대 IC 는 0.5 까지 나온다. 위원회 가중이 exp(60×IC) 라
#   운 좋게 큰 IC 를 받은 잡음 모델 하나가 나머지 전원을 압도한다.
#   → 홀드아웃을 K 블록으로 나눠 블록별 IC 를 재고 ICIR = mean/std, t = ICIR×√K 를 함께 보낸다.
#     워커는 블록평균 IC ≥ 문턱 ★그리고★ t ≥ 1.65 일 때만 신뢰하고,
#     가중 입력으로는 blockIC × clamp(t/2, 0, 1) 을 쓴다(못 믿을 IC 는 0 쪽으로 수축).
#   이건 Qlib·Numerai·팩터 리서치가 공통으로 쓰는 표준 유의성 척도다.
# ============================================================================
# [V33.115] ★표본 고유도(average uniqueness) — de Prado, AFML 4장★
#   우리 표본은 라벨 구간이 겹친다. 수확은 ★매 봉★ 을 표본으로 만드는데(strideBars:1)
#   라벨 지평은 10일이라 이웃 표본끼리 결과 구간이 9/10 겹친다.
#   겹친 표본은 독립 관측이 아니다 — 같은 사건을 열 번 세는 것에 가깝다.
#     · 학습: 같은 패턴을 반복해 보고 과적합한다
#     · 통계: n 이 부풀어 Wilson 하한·IC 유의성이 과신한다
#   → 각 표본의 동시성(자기 라벨 구간과 겹치는 표본 수)의 역수를 가중으로 쓴다.
#     가중의 합이 ★유효표본수★ 이고, 평균이 평균 고유도다.
#   ★같은 종목 안에서만 센다★ — 다른 종목의 같은 기간은 상관은 있어도 같은 사건이 아니다.
#   (워커 _uniqWeights 와 같은 정의 — 두 곳이 갈리면 같은 모델을 서로 다른 자로 재게 된다)
def _uniq_weights(TS, SYM, span_ms):
    import numpy as np
    n = len(TS)
    w = np.ones(n, dtype=np.float64)
    if n < 2 or not (span_ms > 0):
        return w
    try:
        by = {}
        for i in range(n):
            by.setdefault(str(SYM[i]) if SYM is not None else "", []).append(i)
        for _k, idx in by.items():
            idx = sorted(idx, key=lambda j: TS[j])
            m = len(idx)
            lo = hi = 0
            for a in range(m):
                t0 = TS[idx[a]]
                while lo < m and TS[idx[lo]] < t0 - span_ms:
                    lo += 1
                while hi < m and TS[idx[hi]] <= t0 + span_ms:
                    hi += 1
                w[idx[a]] = 1.0 / max(1, hi - lo)
    except Exception:
        return np.ones(n, dtype=np.float64)
    return w


def _uniq_fields(w_val):
    """유효표본수·평균 고유도 — 워커의 신뢰 게이트가 이 값으로 Wilson 하한을 잰다."""
    import numpy as np
    try:
        a = np.asarray(w_val, dtype=np.float64)
        if a.size == 0:
            return {}
        n_eff = int(max(8, round(float(a.sum()))))
        return {"valNEff": n_eff, "valUniq": round(float(a.mean()), 4)}
    except Exception:
        return {}


def _uw_pick(UNIQ, n_total, idx):
    """train_job 이 한 번 계산한 고유도 벡터에서 검증구간만 뽑는다.

    고유도는 ★표본 전체★ 기준으로 쟀다 — 검증표본이 학습표본과 겹친 것도 세므로
    검증표본끼리만 셌을 때보다 유효 n 이 작게(=보수적으로) 나온다. 그게 맞다:
    학습구간과 라벨을 공유하는 검증표본은 독립 증거가 아니다.
    길이가 안 맞으면(호출측 변경·구버전) 조용히 균등가중으로 떨어뜨린다 — 고유도 보정이
    빠질 뿐 학습·업로드는 그대로 돈다.
    """
    import numpy as np
    idx = np.asarray(idx)
    try:
        if UNIQ is None:
            return np.ones(idx.size, dtype=np.float64)
        a = np.asarray(UNIQ, dtype=np.float64)
        if a.size != int(n_total):
            return np.ones(idx.size, dtype=np.float64)
        return a[idx]
    except Exception:
        return np.ones(idx.size, dtype=np.float64)


# ══ [V33.341] ★시간순 분할과 엠바고를 한 곳에서만 정한다★ ═══════════════════════
#   운영 감사 결과, 이 파일 안에서 검증 분할이 ★모델마다 달랐다★:
#     · DNN(train_job)        : 엠바고 있음(cut_ts = TS[N-n_val] - embargo_ms)
#     · GBDT · XGB/LGB/CAT · 시장별 · MIND(FM) · SCALP : ★엠바고 없음★ (Xs[:-nval])
#   라벨 지평이 10일인데 경계를 안 비우면, 경계 직전 학습표본의 결과 구간이 검증 구간과
#   겹친다(de Prado purging). 그 모델들이 바로 ★위원회에 앉아 실제 돈을 거는 모델들★ 이다.
#   즉 승격 게이트가 "정직하게 잰 모델(DNN)" 과 "겹쳐서 잰 모델(트리들)" 을 같은 문턱으로
#   비교해 왔다 — 문턱이 아니라 자가 달랐다.
#
#   그리고 엠바고 길이 자체도 어긋나 있었다: LUXML.embargoDays = 6 인데 지평은 10 이다.
#   V32.10 이 지평을 5→10 으로 올릴 때 엠바고는 따라가지 않았고, 주석은 아직도
#   "라벨 horizon(5일)" 이라고 적혀 있었다. 지평보다 짧은 엠바고는 그 차이만큼 그냥 샌다.
#   → 엠바고는 ★지평 이상★ 으로 강제한다. 여기 한 곳에서.
#
#   ※ 실측(시뮬레이션, 라벨지평 10일·표본 2.8만): 엠바고 0일과 10일의 검증정확도 차이는
#     0.14%p 였다. 크지 않다 — 이걸 "성능이 4%p 뛴다" 로 팔지 않는다. 고치는 이유는
#     ★같은 자로 재기 위해서★ 다. 모델마다 자가 다르면 그 위의 어떤 비교도 뜻이 없다.
# ══ [V33.376] ★홀드아웃을 '행의 20%' 가 아니라 ★달력 기간★ 으로 정한다.★ ══════════
#
#   G-2 가 남긴 진단: 위원 대부분이 못 드는 이유는 실력이 아니라 ★검정력★ 이었다.
#     · XGB t 1.36 · LGB 1.48 · CAT 1.14 — 전부 1.65 바로 아래다.
#     · 이유는 겹치지 않는 관측이 7~12개뿐이라는 것(`icDf 11`).
#     · t = ICIR × √K 다. K 가 작으면 ★진짜 실력이 있어도 t 가 안 선다.★
#
#   그리고 K 는 행 수가 아니라 ★기간★ 에서 나온다(정직한 블록 = 2×라벨지평).
#   그런데 분할은 기간을 한 번도 보지 않았다 — 행의 20% 를 떼고 끝이었다.
#   표본이 아무리 늘어도(I-2 고침으로 실제로 크게 는다) 같은 20% 면 K 는 그대로다.
#
#   ★문턱은 건드리지 않는다.★ (B-6: "문턱을 낮춰 수를 늘리지 말 것.")
#   늘리는 것은 ★관측 기간★ 이다 — G-2 가 적어 둔 바로 그 방향이다.
#   그리고 이건 공짜가 아니라 ★더 엄한 시험★ 이다: 홀드아웃을 늘리면 모델은 더 긴
#   기간에 걸쳐 ★일관되게★ 맞혀야 t 가 선다. 최근 몇 주만 맞히던 모델은 오히려 떨어진다.
#
#   ★비용도 정직하게 적는다.★ 홀드아웃은 시간축 ★뒤쪽★ 이다. 늘리면 학습이 그만큼
#   최근을 못 본다. 그래서 두 개의 상한을 건다:
#     · maxFrac — 행의 이 비율을 넘게 떼지 않는다.
#     · trainSpanMult — 학습 기간이 홀드아웃 기간의 이 배는 남아야 늘린다
#       (홀드아웃 기간 ≤ 전체 기간 / (1+배수) 와 같은 말이다).
#   둘 중 먼저 걸리는 쪽에서 멈추고, 목표에 못 닿았으면 ★로그가 그렇게 말한다.★
HOLDOUT = {
    "minBlocks": 12,       # 정직한 블록(2×지평) 목표 개수 → df 11
    "maxFrac": 0.33,       # 행 기준 상한
    "trainSpanMult": 2.0,  # 학습 기간 ≥ 2 × 홀드아웃 기간
}


def _holdout_rows(ts_s, nval, horizon_ms, min_blocks=None, max_frac=None):
    """정렬된 ts_s 에서 ★목표 기간★ 을 덮는 홀드아웃 행 수를 돌려준다.

    돌려주는 것: (행 수, 진단 dict). 절대 줄이지 않는다 — 기존 nval 이 하한이다.
    """
    import numpy as np
    n = len(ts_s)
    mb = HOLDOUT["minBlocks"] if min_blocks is None else min_blocks
    mf = HOLDOUT["maxFrac"] if max_frac is None else max_frac
    blk = 2.0 * float(horizon_ms or 0)
    info = {"blkMs": blk, "grew": False, "bound": "none", "target": mb}
    if not blk or not mb or n < 400:
        info["bound"] = "off"
        return nval, info
    total = float(ts_s[-1]) - float(ts_s[0])
    need = float(mb) * blk
    span_cap = total / (1.0 + float(HOLDOUT["trainSpanMult"]))   # 학습 기간을 지킨다
    want_span = min(need, span_cap)
    # ★한 행 더 잡는다.★ searchsorted 는 경계값 ★이상★ 인 첫 행을 주므로 그대로 쓰면
    #   덮은 기간이 목표보다 ★조금 모자란다★ — 그 조금 때문에 블록이 12개가 아니라 11개가 된다.
    _i = int(np.searchsorted(ts_s, float(ts_s[-1]) - want_span, side="left"))
    want = int(n - max(0, _i - 1))
    row_cap = int(n * mf)
    out = min(max(want, nval), max(nval, row_cap))
    info["grew"] = out > nval
    if want_span < need - 1e-9:   info["bound"] = "trainSpan"
    elif out < want:              info["bound"] = "rowCap"
    else:                         info["bound"] = "target"
    hs = float(ts_s[-1]) - float(ts_s[n - out])
    info["spanDays"] = hs / 86400000.0
    info["blocks"] = int(hs // blk) if blk else 0
    info["totalDays"] = total / 86400000.0
    return out, info


def _split_ts(TS, val_frac, embargo_ms, min_val=200, horizon_ms=0, cal_frac=0.0,
              min_blocks=None, max_frac=None, tag=""):
    """시간순 정렬 인덱스와 (학습, 보정, 검증) 인덱스를 돌려준다. 엠바고는 지평 이상으로 강제.

    ★보정(cal) 구간이 왜 필요한가★
      DNN 과 MIND 는 임계값 τ* 를 골라 마지막 층 bias 에 접어 넣는다(워커의 0.5 추론이
      그 보정을 그대로 쓰게 하려고). 그런데 종전엔 그 τ* 를 ★검증 앞 절반★ 에서 고르고
      ★뒤 절반★ 으로만 채점했다. 정직하긴 한데, 그 결과 이 둘만 유효표본이 절반이 된다.
      승격 게이트는 Wilson 하한을 보므로, 표본이 절반이면 하한이 그만큼 내려간다 —
      실측 비교: DNN 유효표본 ≈690 · MIND ≈950 vs XGB ≈7,400. ★같은 풀인데 10배 차이다.★
      그래서 "DNN 검증 미달" 의 상당 부분은 실력이 아니라 ★자의 길이★ 였다.
      → τ* 는 ★학습 구간의 꼬리★ 에서 고른다. 그 구간은 학습에서 빼므로 예측이 부풀지 않고,
        엠바고가 검증과 갈라 놓으므로 누출도 없다. 검증은 ★전부★ 채점에 쓴다.
    """
    import numpy as np
    n = len(TS)
    order = np.argsort(TS, kind="stable")
    ts_s = np.asarray(TS, dtype=np.float64)[order]
    nval = max(min_val, int(n * val_frac))
    nval = min(nval, max(1, n - 1))
    # [V33.376] 기간으로 한 번 더 본다 — 행 비율만으로는 K 가 통제되지 않는다.
    nval, _hi = _holdout_rows(ts_s, nval, horizon_ms, min_blocks, max_frac)
    nval = min(nval, max(1, n - 1))
    try:
        _t = ("[" + tag + "] ") if tag else ""
        if _hi.get("bound") != "off":
            _msg = (f"   {_t}[홀드아웃] {_hi['spanDays']:.0f}일 · {nval}건 → 정직한 블록 "
                    f"{_hi['blocks']}개 / 목표 {_hi['target']}개 (전체 {_hi['totalDays']:.0f}일)")
            if _hi["bound"] == "trainSpan":
                _msg += " — ★학습 기간을 지키느라 여기서 멈췄다(표본 기간이 더 쌓여야 한다).★"
            elif _hi["bound"] == "rowCap":
                _msg += f" — ★행 상한({HOLDOUT['maxFrac']:.0%})에서 멈췄다.★"
            elif _hi["blocks"] < _hi["target"]:
                _msg += " — ★블록이 목표에 못 미친다: IC 유의성이 구조적으로 불리하다.★"
            print(_msg)
    except Exception:
        pass
    emb = max(float(embargo_ms or 0), float(horizon_ms or 0))
    cut_ts = ts_s[n - nval] - emb
    idx = np.arange(n)
    tr_mask = (idx < n - nval) & (ts_s < cut_ts)
    if tr_mask.sum() < 60:
        # Codex V33.349: insufficient honest history is not permission to remove the embargo.
        raise ValueError("insufficient training history after embargo")
    tr = idx[tr_mask]
    cal = np.array([], dtype=int)
    if cal_frac and cal_frac > 0 and len(tr) > 400:
        ncal = int(len(tr) * cal_frac)
        ncal = max(50, min(ncal, len(tr) // 3))     # 학습을 1/3 넘게 떼지 않는다
        cal, tr = tr[-ncal:], tr[:-ncal]
    return order, tr, cal, idx[n - nval:], nval, emb


def _neff_of(w):
    import numpy as np
    try:
        return max(8, int(round(float(np.asarray(w, dtype=np.float64).sum()))))
    except Exception:
        return 8


# ── [V33.291] ★시장을 섞어 재면 시장 안 실력이 0 이어도 IC 가 나온다★ ─────────────
#   워커 _icBlockStats 주석과 같은 사고다. 몬테카를로(N=20,000, 시장 안 실력 정확히 0):
#       기저 US 0.55 / KR 0.45 → 섞어 잰 블록IC 0.0953 · t 13.27  ← 게이트를 그냥 통과한다
#       시장 평균을 빼면            블록IC 0.0058 · t  1.69
#   ★여기(파이썬)도 같이 고쳐야 한다.★ 워커만 고치면 외부 학습 모델(DNN·GBDT·부스터·단타)만
#   부풀린 자로 재는 ★비대칭★ 이 생긴다 — 이 저장소가 _importedICz 로 이미 한 번 막은 사고다.
#   시장은 피처행렬의 원핫에서 읽는다(워커 _mktOfVec 과 같은 규칙) — 별도 배관이 필요 없다.
_MKT_COLS = None

def _set_mkt_cols(featnames):
    """main 이 featNames 를 받은 직후 한 번 부른다."""
    global _MKT_COLS
    try:
        fn = list(featnames)
        _MKT_COLS = [(fn.index(n) if n in fn else -1) for n in ("mktUS", "mktKR", "mktCM")]
    except Exception:
        _MKT_COLS = None

def _mkt_of_X(Xva):
    """피처행렬 → 행별 시장 문자열. 못 읽으면 None(= 종전과 같은 계산)."""
    import numpy as np
    try:
        if _MKT_COLS is None: return None
        A = np.asarray(Xva, dtype=np.float64)
        if A.ndim != 2: return None
        if any((c < 0 or c >= A.shape[1]) for c in _MKT_COLS): return None
        out = np.full(A.shape[0], "", dtype=object)
        for nm, c in zip(("us", "kr", "cm"), _MKT_COLS):
            sel = (A[:, c] > 0.5) & (out == "")
            out[sel] = nm
        return out
    except Exception:
        return None

def _demean_by(a, b, mk):
    """시장별 평균을 빼고 이어 붙인다(고정효과 within 추정량). 4건 미만 그룹은 버린다."""
    import numpy as np
    if mk is None: return a, b
    A, B = [], []
    for g in set(mk.tolist()):
        sel = (mk == g)
        if int(sel.sum()) < 4: continue
        aa = a[sel]; bb = b[sel]
        A.append(aa - aa.mean()); B.append(bb - bb.mean())
    if not A: return a[:0], b[:0]
    return np.concatenate(A), np.concatenate(B)


def _no_skill_acc(y, mkt=None):
    """[V33.292] ★실력 없이 도달 가능한 정확도★ = Σ_m (n_m/N)·max(기저_m, 1−기저_m).
       워커 _noSkillAcc 과 같은 규칙(30건 미만 그룹은 0.5 로 본다).
       시장이 하나면 종전 다수클래스와 정확히 같다."""
    import numpy as np
    try:
        yy = np.asarray(y, dtype=np.float64)
        n = len(yy)
        if n <= 0: return None
        if mkt is None:
            groups = [np.ones(n, dtype=bool)]
        else:
            mk = np.asarray(mkt, dtype=object)
            if len(mk) < n: groups = [np.ones(n, dtype=bool)]
            else: groups = [(mk == g) for g in set(mk[:n].tolist())]
        # [V33.295] 그룹별로 ★자기 비율★ 을 쓴다(옌센이 그대로 성립한다). 표본이 너무 적어
        #   비율을 못 믿는 그룹은 ★가장 큰 그룹에 합친다★ — 합치는 것은 분할을 거칠게 만들
        #   뿐이라 부등식이 유지된다. 0.5 를 섞으면 기준점이 내려가 게이트가 느슨해진다
        #   (워커 _noSkillAcc 주석: 운영 실측이 그 불가능한 값을 잡아냈다).
        cnt = [(int(sel.sum()), sel) for sel in groups]
        cnt = [c for c in cnt if c[0] > 0]
        if not cnt: return None
        bi = max(range(len(cnt)), key=lambda i: cnt[i][0])
        merged = cnt[bi][1].copy()
        keep = []
        for i, (m, sel) in enumerate(cnt):
            if i == bi: continue
            if m < 8: merged = merged | sel
            else: keep.append((m, sel))
        keep.append((int(merged.sum()), merged))
        acc = 0.0; tot = 0
        for m, sel in keep:
            if m <= 0: continue
            r = float((yy[sel] > 0.5).mean())
            acc += m * max(r, 1.0 - r)
            tot += m
        return (acc / tot) if tot > 0 else None
    except Exception:
        return None


def _calc_ic_blocks(pred, y, K=5, mkt=None):
    import numpy as np
    try:
        p = np.asarray(pred, dtype=np.float64); t = np.asarray(y, dtype=np.float64)
        n = min(len(p), len(t))
        # [V33.291] ★블록 수 규칙을 워커와 맞춘다.★ 워커 _icBlockStats 는 V33.113 부터
        #   "표본이 많으면 블록을 더 쪼갠다"(k = max(K, min(12, n//200)))인데 여기만 K 고정 5 였다.
        #   같은 표본·같은 예측인데 두 언어가 다른 값을 냈다(실측 차 3.1e-4, df 4 vs 11).
        #   외부 모델과 내부 모델이 다른 자로 심사받는 것이라 그 자체가 비대칭이다.
        K = max(2, int(K))
        K = max(K, min(12, n // 200))
        bs = n // K
        if bs < 20: return None, None, None, 0
        mk = None
        if mkt is not None:
            mk = np.asarray(mkt, dtype=object)
            if len(mk) < n: mk = None
        ics = []
        for k in range(int(K)):
            a = p[k * bs:(k + 1) * bs]; b = t[k * bs:(k + 1) * bs]
            if mk is not None:
                a, b = _demean_by(a, b, mk[k * bs:(k + 1) * bs])
            if len(a) < 8: continue
            if a.std() < 1e-12 or b.std() < 1e-12: continue
            c = float(np.corrcoef(a, b)[0, 1])
            if np.isfinite(c): ics.append(c)
        if len(ics) < 2: return None, None, None, 0
        arr = np.asarray(ics, dtype=np.float64)
        m = float(arr.mean()); sd = float(arr.std(ddof=1))
        icir = (m / sd) if sd > 1e-9 else (9.0 if m > 0 else 0.0)
        return m, icir, icir * (len(ics) ** 0.5), len(ics)
    except Exception:
        return None, None, None, 0


# ══ [V33.366] ★블록 IC 의 t 가 얼마나 정직한가 — 실측으로 답한다★ ═══════════════
#   현재 규칙은 `K = max(K, min(12, n//200))` 로 ★표본 수★ 만 본다. 시간을 안 본다.
#   그래서 홀드아웃이 짧으면 블록 하나가 라벨 지평보다 짧아지고, 인접 블록이 같은 라벨
#   구간을 나눠 갖는다 — 블록 IC 끼리 상관이 생겨 표준편차가 작게 나오고 t 가 부풀려진다.
#
#   ★몬테카를로(실력을 정확히 0 으로 두고 오통과율을 잰다, 시행 800회)★
#     라벨지평 10일 · 예측 지속성 60일(실제 모델은 인접일 예측이 비슷하다)
#     [홀드아웃 140·300일]
#       블록  5일(0.5×지평) : 오통과 13.6~13.9%  vs 명목 5.2~5.5%  → ★2.5~2.7배★
#       블록 10일(1.0×지평) : 오통과  7.1~11.1% vs 명목 5.5~6.1%  → 1.3~1.8배
#       블록 20일(2.0×지평) : 오통과  5.9~ 8.6% vs 명목 6.1~7.5%  → 0.97~1.15배  ← 정직
#     ★경계에서 지평만큼 버리면★ 2.0×지평에서 0.90~0.97 배로 명목에 붙는다.
#     [★운영 실측 조건★ — 홀드아웃 70일 · K=12 → 블록 5.8일] 부풀림 ★1.6배★
#       (2.5배는 140일·K=28 구성의 값이다. 운영 지점은 그보다 작다 — 숫자를 섞지 말 것.)
#
#   ★정직해지면 검정력이 떨어진다 — 이것도 같이 말해야 한다.★
#     홀드아웃 70일에 2×지평 블록이면 K=3 뿐이고, df=2 에서 t 1.65 의 명목값은 12% 다.
#     즉 ★70일 홀드아웃으로는 잘 보정된 블록 IC 검정 자체가 불가능하다★ —
#     부풀린 자를 쓰거나 검정력이 없거나 둘 중 하나다.
#     → 진짜 해법은 ★관측 기간(홀드아웃 일수)을 늘리는 것★ 이다. 잣대가 아니다(G-2).
#   ※ 예측이 백색잡음이면(지속성 0) 블록 길이와 무관하게 명목값이 나온다 — 처음엔 그렇게
#     재서 "문제 없음" 이 나왔다. 실제 모델은 지속성이 0 이 아니므로 그 시험이 틀린 것이었다.
#
#   ★운영 실측이 바로 그 부풀림 구간이다★ — 홀드아웃 70일에 K=12 면 블록 5.8일(0.58×지평).
#   즉 지금 IC 게이트는 ★관대한★ 쪽으로 틀려 있다. 그런데도 부스터 3종이 t 1.14~1.48 로
#   떨어졌다는 것은, 참 유의성은 그보다 더 낮다는 뜻이다.
#
#   ★그래서 승격 판정은 바꾸지 않는다.★ 바꾸면 위원회가 더 비는데, 위원을 빼는 판단은
#   사람의 몫이다(G-2 에 그렇게 적혀 있다). V33.357 이 쓴 방식을 그대로 쓴다 —
#   ★정직한 값을 나란히 기록하고, 두 값이 어긋나는 폭을 보이게 한다.★ 판단은 그 다음이다.
def _calc_ic_blocks_time(pred, y, ts, horizon_ms, mkt=None, blk_mult=2.0):
    """블록을 ★시간★ 으로 자르고 경계에서 지평만큼 버린 IC 유의성."""
    import numpy as np
    try:
        p = np.asarray(pred, dtype=np.float64); t = np.asarray(y, dtype=np.float64)
        tv = np.asarray(ts, dtype=np.float64)
        n = min(len(p), len(t), len(tv))
        if n < 40 or not (horizon_ms > 0): return None
        p, t, tv = p[:n], t[:n], tv[:n]
        t0, t1 = float(tv.min()), float(tv.max())
        span = t1 - t0
        blk = max(float(blk_mult) * float(horizon_ms), 1.0)
        K = int(span // blk)
        if K < 2: return {"valICBlkDays": round(blk / 86400000.0, 1),
                          "valICSpanDays": round(span / 86400000.0, 1),
                          "valICHonestWhy": "홀드아웃이 짧아 독립 블록을 2개도 못 만든다"}
        mk = None
        if mkt is not None:
            mk = np.asarray(mkt, dtype=object)
            if len(mk) < n: mk = None
            else: mk = mk[:n]
        ics = []
        for k in range(K):
            lo = t0 + k * blk
            hi = lo + blk - float(horizon_ms)      # ★경계 버림★ — 겹친 라벨을 블록 밖으로
            m = (tv >= lo) & (tv < hi)
            a, b = p[m], t[m]
            if a.size < 8: continue
            if mk is not None: a, b = _demean_by(a, b, mk[m])
            if a.std() < 1e-12 or b.std() < 1e-12: continue
            c = float(np.corrcoef(a, b)[0, 1])
            if np.isfinite(c): ics.append(c)
        if len(ics) < 2:
            return {"valICBlkDays": round(blk / 86400000.0, 1),
                    "valICSpanDays": round(span / 86400000.0, 1),
                    "valICHonestWhy": "경계를 버리고 나니 쓸 수 있는 블록이 2개 미만이다"}
        arr = np.asarray(ics, dtype=np.float64)
        m_ = float(arr.mean()); sd = float(arr.std(ddof=1))
        icir = (m_ / sd) if sd > 1e-9 else (9.0 if m_ > 0 else 0.0)
        return {"valICBlockHonest": round(m_, 5), "valICtHonest": round(icir * (len(ics) ** 0.5), 3),
                "valICKHonest": int(len(ics)), "valICBlkDays": round(blk / 86400000.0, 1),
                "valICSpanDays": round(span / 86400000.0, 1),
                "valICPurgeDays": round(float(horizon_ms) / 86400000.0, 1)}
    except Exception:
        return None


def _ic_block_fields(pred, y, K=5, mkt=None, ts=None, horizon_ms=0):
    """모델 dict 에 그대로 합칠 블록 IC 필드.
       [V33.291] mkt 를 주면 게이트가 보는 값은 ★시장 고정효과를 뺀★ 값이 되고,
       섞어 잰 값은 valICBlockPooled/valICtPooled 로 따로 남는다(바뀐 폭을 봐야 한다).
       [V33.366] ts·horizon_ms 를 주면 ★시간 기준 블록★ 의 정직한 t 를 함께 낸다.
       ★승격 판정에는 쓰지 않는다★ — 기록만 한다(위 주석 참조)."""
    bic, icir, tv, k = _calc_ic_blocks(pred, y, K, mkt)
    if bic is None: return {}
    out = {"valICBlock": round(bic, 5), "valICIR": round(icir, 3),
           "valICt": round(tv, 3), "valICK": int(k)}
    # [V33.292] 정확도 게이트의 기준점도 같은 자리에서 낸다 — 두 자가 갈라지면 안 된다.
    _ab = _no_skill_acc(y, mkt)
    if _ab is not None:
        out["accBase"] = round(_ab, 4)
        _abp = _no_skill_acc(y, None)
        if _abp is not None: out["accBasePooled"] = round(_abp, 4)
    if mkt is not None:
        pb, _pi, pt, _pk = _calc_ic_blocks(pred, y, K, None)
        if pb is not None:
            out["valICBlockPooled"] = round(pb, 5)
            out["valICtPooled"] = round(pt, 3)
            out["mktFixed"] = True
    # [V33.366] 시간 기준(정직한) 블록 — 기록만. 두 t 가 얼마나 벌어지는지가 요점이다.
    if ts is not None and horizon_ms and horizon_ms > 0:
        _h = _calc_ic_blocks_time(pred, y, ts, horizon_ms, mkt)
        if _h:
            out.update(_h)
            if "valICtHonest" in _h:
                out["valICtGap"] = round(float(out["valICt"]) - float(_h["valICtHonest"]), 3)
    return out


# ============================================================================
# [V33.76] ★미국장·한국장 분리학습★ (사용자 지시)
#   두 시장은 거래시간(연속 vs 상하한가 ±30%), 세금(국내 증권거래세), 투자자 구성(외국인·기관
#   비중), 변동성 구조가 전부 다르다. 한 모델에 뭉치면 표본이 많은 쪽(미국)의 통계가 다른 쪽을
#   덮어쓴다. 시장별로 따로 학습해 각자의 조건을 배우게 한다.
#   업로드 이름: gbdt_us / gbdt_kr (워커는 "<이름>_<시장>" 이 있으면 그걸, 없으면 통합 모델 사용).
#   표본이 MIN_PER_MARKET 미만인 시장은 아예 올리지 않는다 — 적은 표본의 전용 모델은
#   통합 모델보다 나쁘다(과적합). 그때는 워커가 자동으로 통합 모델로 폴백한다.
MIN_PER_MARKET = 4000

def _train_per_market(BASE, KEY, HDR, MKT, X, Y, TS, PNL, featver, D, UNIQ=None):
    import numpy as np, json, time, requests, math

    if MKT is None or len(MKT) != len(Y):
        print("   시장 라벨 없음 — 분리학습 생략(워커가 아직 m 필드를 안 내려주는 구버전)"); return

    def _wilson(acc, n, z=1.64):
        if n <= 0: return 0.0
        z2 = z * z; den = 1 + z2 / n; cen = acc + z2 / (2 * n)
        rad = z * math.sqrt((acc * (1 - acc) + z2 / (4 * n)) / n)
        return max(0.0, (cen - rad) / den)

    def _upload(name, model):
        for attempt in range(4):
            try:
                r = requests.post(BASE + "/api/gbdt-import", params={"key": KEY, "name": name, "activate": "1"},
                                  headers=HDR, data=json.dumps(model), timeout=180)
                if r.status_code == 200:
                    print(f"   {name} 업로드 OK:", json.dumps(r.json(), ensure_ascii=False)); return True
                b = r.text[:200]
                if r.status_code >= 500 and (("D1" in b) or ("overloaded" in b)) and attempt < 3:
                    time.sleep(30); continue
                print(f"   {name} 업로드 실패:", r.status_code, b); return False
            except requests.exceptions.ReadTimeout:
                if attempt < 3: time.sleep(20); continue
        return False

    counts = {m: int((MKT == m).sum()) for m in sorted(set(MKT.tolist()))}
    print(f"   시장별 표본: {counts}")

    for mk in ("us", "kr"):
        sel = (MKT == mk)
        n = int(sel.sum())
        if n < MIN_PER_MARKET:
            print(f"   {mk.upper()}: 표본 {n} < {MIN_PER_MARKET} — 전용 모델 생략(통합 모델로 폴백)")
            continue
        Xm, Ym, TSm = X[sel], Y[sel], TS[sel]
        PNLm = PNL[sel] if PNL is not None and len(PNL) == len(Y) else None
    # [V33.341] 엠바고 분할(공용 헬퍼) — 종전엔 경계를 안 비워 라벨 지평만큼 겹쳤다.
        order, _tri, _cali, _vai, nval, _emb = _split_ts(TSm, 0.2, _EMBARGO_MS, min_val=200, horizon_ms=_HORIZON_MS, tag="시장별")
        Xs, Ys = Xm[order].astype(np.float64), Ym[order].astype(int)
        Xtr, Ytr = Xs[_tri], Ys[_tri]
        Xva, Yva = Xs[_vai], Ys[_vai]
        # [V33.115] 검증구간 고유도 — sel(부분집합) → order(정렬) 두 번 접혔으므로
        #   원본 인덱스로 되돌려서 뽑는다. 겹침은 같은 종목 안에서만 세므로 시장별로 나눠도 값이 같다.
        UWva = _uw_pick(UNIQ, len(Y), np.flatnonzero(sel)[order][-nval:])

        # 수익크기 가중(V33.75)을 시장별로 다시 산출 — 시장마다 변동성 스케일이 달라 공유하면 안 된다.
        Wtr = None
        if PNLm is not None:
            Ps = np.abs(PNLm[order])
            k = min(250, max(30, n // 10))
            loc = np.array([max(1e-6, np.median(Ps[max(0, i - k):i + 1])) for i in range(n)])
            W = 1.0 + np.clip(Ps / loc, 0.0, 4.0)
            W = W / W.mean()
            # Codex V33.346: weights must follow the same embargo indices as X/Y.
            Wtr = W[_tri]

        print(f"   ── {mk.upper()} 전용 모델 (표본 {n}, 검증 {nval}) ──")
        # ★A/B★ 단일 LGBM 과 DoubleEnsemble 을 나란히 학습해 이 시장의 홀드아웃에서 이긴 쪽만 쓴다.
        #   합성 검증에서 DoubleEnsemble 의 이득이 확인되지 않았으므로(위 주석 참고) 믿고 갈아끼우지
        #   않는다. 시장마다 데이터 성격이 다르니 시장별로 각자 판정하게 둔다.
        cand = []
        try:
            import lightgbm as lgb
            _p = {"objective": "binary", "max_depth": 4, "num_leaves": 16, "learning_rate": 0.03,
                  "feature_fraction": 0.8, "bagging_fraction": 0.8, "bagging_freq": 1,
                  "min_data_in_leaf": 20, "lambda_l2": 3.0, "verbose": -1}
            _d1 = lgb.Dataset(Xtr, label=Ytr, weight=Wtr)
            _d2 = lgb.Dataset(Xva, label=Yva, reference=_d1)
            _b = lgb.train(_p, _d1, num_boost_round=600, valid_sets=[_d2],
                           callbacks=[lgb.early_stopping(90, verbose=False)])
            _nit = _b.best_iteration or 600
            _pv = _b.predict(Xva, num_iteration=_nit)
            cand.append(("lgbm", lambda Z, _b=_b, _nit=_nit: _b.predict(Z, num_iteration=_nit),
                         [(_b, np.arange(Xtr.shape[1]))], _pv, _nit))
        except Exception as e:
            print("   단일 LGBM 실패:", e)
        de = _train_double_ensemble(Xtr, Ytr, Xva, Yva, Wbase=Wtr)
        if de is not None:
            _pv2 = de[0](Xva)
            cand.append(("double_ensemble", de[0], de[1], _pv2, None))
        if not cand:
            continue

        def _ic(pv):
            try:
                c = np.corrcoef(pv, Yva)[0, 1]
                return 0.0 if not np.isfinite(c) else float(c)
            except Exception:
                return 0.0
        for nm, _, _, pv, _ in cand:
            print(f"   {mk.upper()} 후보 {nm}: acc={float(((pv>=0.5).astype(int)==Yva).mean()):.4f} IC={_ic(pv):.4f}")
        algo, predict, subs, _pvbest, _ = max(cand, key=lambda c: _ic(c[3]))
        print(f"   {mk.upper()} 채택: {algo}")

        # 워커 트리 포맷으로 변환 — 서브모델들의 트리를 전부 이어붙이고 eta 로 평균을 낸다.
        #   워커 추론: raw = bias + Σ eta·leaf → sigmoid. 서브모델 평균은 eta = 1/K 로 표현된다.
        #   ★피처 인덱스 복원★ 서브모델마다 피처 부분집합을 쓰므로, 트리의 f 를 원래 인덱스로 되돌린다.
        def _conv(node, fmap):
            if "leaf_value" in node and "split_feature" not in node:
                return {"w": float(node["leaf_value"])}
            f = int(fmap[int(node["split_feature"])])
            return {"f": f, "t": float(node["threshold"]),
                    "l": _conv(node["left_child"], fmap), "r": _conv(node["right_child"], fmap)}
        trees, ok = [], True
        try:
            for bst, fi in subs:
                dump = bst.dump_model()
                nit = bst.best_iteration or len(dump["tree_info"])
                for t in dump["tree_info"][:nit]:
                    trees.append(_conv(t["tree_structure"], fi))
        except Exception as e:
            print(f"   {mk.upper()} 트리 변환 실패(생략):", e); ok = False
        if not ok or not trees:
            continue

        eta = 1.0 if algo == "lgbm" else 1.0 / max(1, len(subs))
        # bias 보정 — 변환식 출력과 라이브러리 확률의 로짓 차이를 검증셋 평균으로 맞춘다.
        def _wout(nd, x):
            while "w" not in nd:
                nd = nd["l"] if x[nd["f"]] < nd["t"] else nd["r"]
            return nd["w"]
        pva = np.clip(predict(Xva), 1e-6, 1 - 1e-6)
        margin = np.log(pva / (1 - pva))
        wr = np.array([eta * sum(_wout(t, x) for t in trees) for x in Xva])
        bias = float((margin - wr).mean())
        vacc = float(((pva >= 0.5).astype(int) == Yva).mean())
        _neff = _neff_of(UWva)
        vlb = _wilson(vacc, _neff)          # [V33.115] 명목 nval → 유효표본수
        pi = np.linspace(0, nval - 1, min(200, nval)).astype(int)
        probe = [{"x": Xva[i].tolist(), "p": float(pva[i])} for i in pi]
        _ic, _ric = _calc_ic(pva, Yva)
        model = {"trees": trees, "eta": eta, "bias": bias, "valAcc": round(vacc, 4),
                 "valAccLB": round(vlb, 4), "valN": int(nval), "n": int(n),
                 "featVer": featver, "probe": probe, "market": mk, "algo": algo,
                 "valIC": round(_ic, 5), "valRankIC": round(_ric, 5)}
        # [V33.366] 시장별 모델도 같은 자로 — 한 곳만 재면 비교가 안 된다.
        model.update(_ic_block_fields(pva, Yva, ts=TSm[order][-nval:], horizon_ms=_HORIZON_MS))
        model.update(_uniq_fields(UWva))
        print(f"   {mk.upper()}: trees={len(trees)} eta={eta:.3f} valAcc={vacc:.3f} lb={vlb:.3f}(유효 {_neff}/{nval}) IC={_ic:.4f} RankIC={_ric:.4f}"
              + (f" blockIC={model['valICBlock']:.4f} t={model['valICt']:.2f}" if "valICt" in model else " (블록 부족)"))
        _upload("gbdt_" + mk, model)


# ============================================================================
# [V33.76] DoubleEnsemble (Zhang·Li·Xu 2020, arXiv:2010.01265) — 우리 데이터형(정형 피처표)에
#   가장 잘 맞는 공개 모델. Microsoft Qlib 공식 벤치마크에서 Alpha158(정형 피처 158종) 기준
#   1위다: 연수익 11.58% / IR 1.34 / MDD −9.2%, 같은 데이터의 XGBoost 는 7.80% / IR 0.91.
#   우리 표본도 65차원 정형 피처표라 Alpha158 과 성격이 같아 그대로 이식할 수 있다.
#
#   원 논문의 두 축을 그대로 옮긴다:
#   ① 학습궤적 기반 표본 재가중(SR) — 금융데이터의 낮은 신호대잡음비 대응.
#      h1 = rank(−현재손실)   … 지금 잘 맞히는 표본
#      h2 = rank(loss_end / loss_start) … 학습하면서 개선된 표본
#      h  = α1·h1 + α2·h2 → B개 구간으로 나눠 구간평균 h로 가중
#      w  = 1 / (decay^k · h_avg + 0.1)
#      즉 "이미 쉬운 표본"과 "아무리 해도 안 되는 잡음 표본" 양쪽의 비중을 줄이고
#      경계에 있는 정보량 큰 표본에 집중한다.
#   ② 셔플 기반 피처선택(FS) — 피처 수가 많아질수록 커지는 과적합 대응.
#      g = mean(손실증가) / (std(손실증가)+eps) 로 피처 중요도를 재고, D개 구간으로 나눠
#      상위 구간일수록 높은 비율로 샘플링해 서브모델마다 다른 피처집합을 준다.
#
#   구현 메모: 원본은 매 서브모델마다 전체 재학습(K=6)이라 무겁다. 우리 크론 예산에 맞춰 K=4.
#
#   ★검증 결과와 그에 따른 운영 방침★ (합성 14,000표본×3seed, 구간별 신호소멸 데이터로 실측)
#     LGBM 단일          IC 0.2771 (기준)
#     현재구현(FS 켬)     IC 0.2698  −0.0072   ← 피처선택이 깎는다
#     decay=1.0          IC 0.2711  −0.0060
#     재가중만(FS 끔)     IC 0.2768  −0.0002   ← 재가중은 중립
#     배깅앙상블만        IC 0.2771  ±0.0000
#   즉 우리 합성 데이터에서는 이득이 확인되지 않았다. 원 논문의 Alpha158 은 158개 팩터가 서로
#   강하게 상관된 표라 셔플 기반 피처선택이 먹히지만, 우리 65차원은 이미 중복을 걷어낸 상태라
#   피처를 더 떨어뜨리면 손해만 난다. 그래서:
#     · 피처선택 하한(fs_floor)을 둬 최소 70%는 남긴다.
#     · ★기본값으로 쓰지 않는다★ — 시장별 학습에서 '단일 LGBM'과 나란히 학습해 그 시장의
#       홀드아웃에서 실제로 이긴 쪽만 업로드한다(아래 _train_per_market 의 A/B).
#     신뢰할 수 없는 개선을 믿고 갈아끼우지 않는다 — 그게 지난 두 달의 실패 패턴이었다.
def _train_double_ensemble(Xtr, Ytr, Xva, Yva, Wbase=None, K=4, bins_sr=10, bins_fs=5,
                           alpha1=1.0, alpha2=1.0, decay=1.0, fs_floor=0.70,
                           sample_ratios=(0.9, 0.85, 0.8, 0.75, 0.7)):
    """반환: (predict_proba(Xnew) -> np.ndarray, 서브모델 리스트, 정보 dict). lightgbm 없으면 None."""
    import numpy as np
    try:
        import lightgbm as lgb
    except Exception as e:
        print("   DoubleEnsemble 생략 — lightgbm 없음:", e); return None

    Ntr, Dfeat = Xtr.shape
    if Ntr < 800:
        print(f"   DoubleEnsemble 생략 — 표본 부족 {Ntr}"); return None

    def _rank_pct(v):
        # 백분위 순위 [0,1] — 논문의 rank(..., pct=True)
        o = np.argsort(np.argsort(v))
        return o / max(1, len(v) - 1)

    def _logloss(p, y):
        p = np.clip(p, 1e-6, 1 - 1e-6)
        return -(y * np.log(p) + (1 - y) * np.log(1 - p))

    params = {"objective": "binary", "max_depth": 4, "num_leaves": 16, "learning_rate": 0.03,
              "feature_fraction": 0.8, "bagging_fraction": 0.8, "bagging_freq": 1,
              "min_data_in_leaf": 20, "lambda_l2": 3.0, "verbose": -1}

    w = np.ones(Ntr) if Wbase is None else np.asarray(Wbase, dtype=np.float64).copy()
    w = w / w.mean()
    feat_idx = np.arange(Dfeat)
    subs = []          # (booster, 사용피처 인덱스)
    loss_curve_prev = None

    for k in range(K):
        ds = lgb.Dataset(Xtr[:, feat_idx], label=Ytr, weight=w)
        dv = lgb.Dataset(Xva[:, feat_idx], label=Yva, reference=ds)
        # 학습곡선을 얻기 위해 표본별 손실을 여러 시점에서 기록한다(논문의 loss curve).
        snaps, curve = [], []
        bst = lgb.train(params, ds, num_boost_round=400, valid_sets=[dv],
                        callbacks=[lgb.early_stopping(60, verbose=False)])
        best = bst.best_iteration or 400
        for it in range(max(1, best // 10), best + 1, max(1, best // 10)):
            curve.append(_logloss(bst.predict(Xtr[:, feat_idx], num_iteration=it), Ytr))
        if not curve:
            curve = [_logloss(bst.predict(Xtr[:, feat_idx], num_iteration=best), Ytr)]
        loss_curve_prev = np.vstack(curve)          # (시점, 표본)
        subs.append((bst, feat_idx.copy()))

        if k == K - 1:
            break

        # ── ① 학습궤적 기반 재가중 ──
        ens = np.mean([b.predict(Xtr[:, fi]) for b, fi in subs], axis=0)
        cur_loss = _logloss(ens, Ytr)
        n_edge = max(1, int(loss_curve_prev.shape[0] * 0.1))
        l_start = loss_curve_prev[:n_edge].mean(axis=0)
        l_end = loss_curve_prev[-n_edge:].mean(axis=0)
        h1 = _rank_pct(-cur_loss)
        h2 = _rank_pct(l_end / np.maximum(1e-6, l_start))
        h = alpha1 * h1 + alpha2 * h2
        bins = np.clip((h - h.min()) / max(1e-9, (h.max() - h.min())) * bins_sr, 0, bins_sr - 1e-9).astype(int)
        w_new = np.ones(Ntr)
        for b in range(bins_sr):
            m = bins == b
            if not m.any():
                continue
            w_new[m] = 1.0 / ((decay ** k) * h[m].mean() + 0.1)
        if Wbase is not None:
            w_new = w_new * (np.asarray(Wbase, dtype=np.float64))   # 수익크기 가중과 곱해 함께 반영
        w = w_new / w_new.mean()

        # ── ② 셔플 기반 피처선택 ──
        rng = np.random.default_rng(42 + k)
        base_loss = cur_loss
        g = np.zeros(Dfeat)
        probe = rng.choice(Ntr, size=min(2000, Ntr), replace=False)
        for f in range(Dfeat):
            Xp = Xtr[probe].copy()
            Xp[:, f] = Xp[rng.permutation(len(probe)), f]
            lp = np.mean([b.predict(Xp[:, fi]) for b, fi in subs], axis=0)
            d = _logloss(lp, Ytr[probe]) - base_loss[probe]
            g[f] = d.mean() / (d.std() + 1e-7)
        order_f = np.argsort(-g)                      # 중요한 피처부터
        chosen = []
        per = max(1, Dfeat // bins_fs)
        for bi in range(bins_fs):
            grp = order_f[bi * per: (bi + 1) * per] if bi < bins_fs - 1 else order_f[bi * per:]
            if len(grp) == 0:
                continue
            ratio = sample_ratios[min(bi, len(sample_ratios) - 1)]
            take = max(1, int(round(len(grp) * ratio)))
            chosen.extend(rng.choice(grp, size=take, replace=False).tolist())
        # 하한 — 최소 fs_floor 비율은 남긴다(실측: 과하게 떨어뜨리면 IC 가 깎였다).
        need = max(1, int(round(Dfeat * fs_floor)))
        if len(set(chosen)) < need:
            for f in order_f:
                if len(set(chosen)) >= need: break
                chosen.append(int(f))
        feat_idx = np.array(sorted(set(chosen))) if chosen else np.arange(Dfeat)

    def _predict(Xnew):
        import numpy as _np
        return _np.mean([b.predict(Xnew[:, fi]) for b, fi in subs], axis=0)

    pv = _predict(Xva)
    vacc = float(((pv >= 0.5).astype(int) == Yva).mean())
    print(f"   DoubleEnsemble: 서브모델 {len(subs)}개 valAcc={vacc:.3f} (최종 피처 {len(subs[-1][1])}/{Dfeat})")
    return _predict, subs, {"valAcc": vacc}


# ══ [V33.380] ★라벨 실험대 — "성능이 안 나온다" 의 원인을 ★재서★ 가른다.★ ═══════════
#
#   ★왜 필요한가 — 실측이 모델 문제가 아니라고 말한다.★
#   같은 표본·같은 파이프라인에서:
#       스윙(10일 sign(pnl))   DNN 49.3% · 부스터 52.2~52.5% · IC 0.003~0.032 · 고유도 0.033
#       단타(60분 삼중배리어)  57.0%(하한 56.0%) · IC 0.207 · 고유도 0.333
#   11층 MLP 와 부스팅 트리는 ★완전히 다른 모델족★ 인데 스윙에서 똑같이 작은 엣지로 수렴한다.
#   두 모델족이 같은 벽에 부딪히면 그 벽은 모델이 아니라 ★라벨·지평★ 이다.
#
#   그리고 스윙 라벨에는 짚을 수 있는 결함이 있다 — ★데드밴드가 없다.★
#   `sign(pnl)` 은 10일에 +0.02% 움직인 표본을 1, −0.02% 를 0 으로 놓는다. 둘은 경제적으로
#   같고 통계적으로 구분 불가능한데, 모델 용량의 상당분이 그 띠에서 소모된다.
#   그 띠가 표본의 몇 %인지에 따라 ★달성 가능한 정확도의 상한 자체★ 가 정해진다.
#
#   ★그래서 바꾸지 않고 잰다.★ (V33.260 이 깊이에 대해 한 것과 같은 규율:
#   "근거 없이 반대로 밀지는 않는다 — 스윕이 실제로 재서 이긴 구성이 있으면 그것을 쓴다".)
#   이 단계는 ★아무것도 업로드하지 않는다.★ 운영 라벨은 한 톨도 안 바뀐다.
#   같은 분할·같은 학습기로 후보 라벨을 각각 학습해 ★숫자만★ 로그에 남긴다.
#
#   ※ 정직하게 읽는 법: 데드밴드 후보는 ★모집단이 다르다★(애매한 띠를 뺀다). 정확도가 높게
#     나오는 것은 당연하고, 그 자체로 이겼다는 뜻이 아니다. 그래서 ★적용률(coverage)★ 을
#     반드시 같이 적는다 — "표본의 40% 만 판정하고 60% 맞힌다" 와 "전부 판정하고 52% 맞힌다"
#     중 무엇이 나은지는 ★기대수익★ 이 정하지, 정확도 한 숫자가 정하지 않는다.
def _label_ablation(X, PNL, TS, SYM, MKT, featver, D, UNIQ=None, featnames=None):
    import numpy as np, math
    try:
        import lightgbm as lgb
    except Exception as e:
        print("   [라벨실험] lightgbm 없음 — 생략:", e); return

    N = len(PNL)
    if N < 20000:
        print(f"   [라벨실험] 표본 부족 {N} — 생략"); return
    P = np.asarray(PNL, dtype=np.float64)
    Xa = np.asarray(X, dtype=np.float64)
    order, tri, _cal, vai, nval, _emb = _split_ts(TS, 0.2, _EMBARGO_MS, min_val=200,
                                                  horizon_ms=_HORIZON_MS, tag="라벨실험")
    Xs, Ps = Xa[order], P[order]
    TSs = np.asarray(TS, dtype=np.float64)[order]
    UWs = (np.asarray(UNIQ, dtype=np.float64)[order] if UNIQ is not None and len(UNIQ) == N
           else np.ones(N, dtype=np.float64))

    # 변동성 자 — atrPct 칸이 있으면 그걸 쓰고, 없으면 |pnl| 의 종목중앙값으로 대신한다.
    _atr = None
    try:
        if featnames and "atrPct" in list(featnames):
            _atr = np.abs(Xs[:, list(featnames).index("atrPct")].astype(np.float64))
            if not np.isfinite(_atr).all() or float(np.nanmedian(_atr)) <= 0:
                _atr = None
    except Exception:
        _atr = None

    _absmed = float(np.median(np.abs(Ps))) or 1e-9

    def _xs_demean(vals, ts):
        """같은 날의 중앙값을 뺀다 — 시장 공통성분(베타)을 지운다."""
        out = np.array(vals, dtype=np.float64)
        day = np.floor(ts / 86400000.0)
        for d in np.unique(day):
            m = day == d
            if m.sum() >= 5:
                out[m] = out[m] - np.median(out[m])
        return out

    # 후보들 — (이름, 라벨, 사용마스크, 한 줄 설명)
    cands = []
    cands.append(("A 운영(sign)", (Ps > 0).astype(np.float64), np.ones(N, dtype=bool),
                  "지금 쓰는 라벨. 데드밴드 없음"))
    for _mult, _tag in ((0.25, "0.25×"), (0.50, "0.50×")):
        thr = _mult * _absmed
        cands.append((f"B 데드밴드 {_tag}중앙", (Ps > 0).astype(np.float64), np.abs(Ps) >= thr,
                      f"|pnl| < {thr:.4f} 인 애매한 띠를 ★뺀다★"))
    _xs = _xs_demean(Ps, TSs)
    cands.append(("C 횡단면(당일중앙 차감)", (_xs > 0).astype(np.float64), np.ones(N, dtype=bool),
                  "시장 공통성분을 뺀 상대수익의 부호"))
    if _atr is not None:
        _z = Ps / np.maximum(_atr, 1e-6)
        _zthr = 0.25 * float(np.median(np.abs(_z)))
        cands.append(("D 변동성정규화+데드밴드", (_z > 0).astype(np.float64), np.abs(_z) >= _zthr,
                      "pnl/ATR% 로 재고 애매한 띠를 뺀다"))

    print("   ── [라벨실험] ★아무것도 업로드하지 않는다 — 운영 라벨은 그대로다★ ──")
    print(f"      {'후보':26s} {'적용률':>7s} {'다수클래스':>9s} {'valAcc':>8s} {'초과':>8s} {'IC':>8s} {'유효n':>8s}")
    base_excess = None
    for name, Yc, use, why in cands:
        try:
            tr = np.array([i for i in tri if use[i]], dtype=np.int64)
            va = np.array([i for i in vai if use[i]], dtype=np.int64)
            if tr.size < 5000 or va.size < 2000:
                print(f"      {name:26s} 표본 부족(학습 {tr.size} · 검증 {va.size}) — 생략"); continue
            ds = lgb.Dataset(Xs[tr], label=Yc[tr], weight=UWs[tr], free_raw_data=False)
            bst = lgb.train({"objective": "binary", "learning_rate": 0.05, "num_leaves": 31,
                             "min_data_in_leaf": 200, "feature_fraction": 0.8,
                             "bagging_fraction": 0.8, "bagging_freq": 1,
                             "verbose": -1, "seed": 7}, ds, num_boost_round=200)
            pv = bst.predict(Xs[va])
            yv = Yc[va]
            acc = float(((pv >= 0.5) == (yv > 0.5)).mean())
            maj = float(max(yv.mean(), 1 - yv.mean()))
            ic, _ = _calc_ic(pv, yv)
            neff = int(max(1, round(float(UWs[va].sum()))))
            cov = float(use.mean())
            exc = acc - maj
            if base_excess is None: base_excess = exc
            print(f"      {name:26s} {cov*100:6.1f}% {maj*100:8.1f}% {acc*100:7.1f}% "
                  f"{exc*100:+7.2f}%p {ic:8.4f} {neff:8d}   ← {why}")
        except Exception as e:
            print(f"      {name:26s} 실패(무시): {e}")
    print("      ★읽는 법★ 정확도 한 숫자로 비교하지 말 것 — 데드밴드 후보는 모집단이 다르다.")
    print("      비교할 것은 ★다수클래스 대비 초과(%p)★ 이고, 적용률이 낮으면 그만큼 기회가 준다.")
    print("      운영에 반영할지는 이 표를 보고 ★사람이★ 정한다(문턱을 낮추는 것과 다른 일이다).")


def _train_and_upload_boosters(BASE, KEY, HDR, X, Y, TS, featver, D, PNL=None, UNIQ=None):
    import numpy as np, math, json, time, requests, tempfile, os

    N = len(Y)
    if N < 500:
        print(f"부스팅: 표본 부족 {N} — 생략"); return
    # [V33.341] 엠바고 분할(공용 헬퍼) — 종전엔 경계를 안 비워 라벨 지평만큼 겹쳤다.
    order, _tri, _cali, _vai, nval, _emb = _split_ts(TS, 0.2, _EMBARGO_MS, min_val=200, horizon_ms=_HORIZON_MS, tag="부스팅")
    Xs = X[order].astype(np.float64); Ys = Y[order].astype(int)
    Xtr, Ytr = Xs[_tri], Ys[_tri]
    Xva, Yva = Xs[_vai], Ys[_vai]
    print(f"   부스팅 분할: 학습 {len(_tri)} · 검증 {len(_vai)} · 엠바고 {_emb/86400000:.0f}일")
    UWva = _uw_pick(UNIQ, N, order[-nval:])     # [V33.115] 검증구간 고유도

    # ── [V33.75] 변동성 스케일 크기가중 (Lim·Zohren·Roberts 2019 / Moskowitz·Ooi·Pedersen 2012) ──
    #   종전엔 모든 표본이 동일 가중이었다. +12% 날 거래와 +0.1% 날 거래를 똑같이 세면
    #   모델은 '자주 맞히는 법'을 배우지 '크게 버는 법'을 못 배운다. 실제로 우리 원장이 딱 그 모습이다
    #   (TREND 승률 64.4%·평균 +4.72%인데 금액은 −$204 — 맞히는 건 잘하고 크게 버는 걸 못한다).
    #   Deep Momentum Networks 는 손실함수를 Sharpe 로 바꿔 기존 대비 2배 이상 개선을 보고했다.
    #   부스팅 분류기에서 그 취지를 옮기는 표준 방법이 '수익 크기 ÷ 변동성' 표본가중이다.
    #   변동성으로 나누는 이유는 시계열 모멘텀의 vol-scaling 과 같다 — 고변동 구간의 큰 수익이
    #   가중을 독식하지 않게 해, 위험조정 후 기여가 큰 표본에 학습을 집중시킨다.
    Wtr = None; Wva = None
    try:
        if PNL is not None and len(PNL) == N:
            Ps = np.abs(np.asarray(PNL, dtype=np.float64)[order])
            # 국소 변동성 = 최근 250표본 |수익| 중앙값(로버스트). 0 방어.
            k = min(250, max(30, N // 10))
            loc = np.array([max(1e-6, np.median(Ps[max(0, i - k):i + 1])) for i in range(N)])
            raw = Ps / loc                                  # 변동성 대비 크기
            raw = np.clip(raw, 0.0, 4.0)                    # 이상치 상한
            W = 1.0 + raw                                   # [1.0, 5.0]
            W = W / W.mean()                                # 평균 1로 정규화(학습률 영향 제거)
            # Codex V33.346: old slices retained embargo rows and broke all three libraries.
            Wtr, Wva = W[_tri], W[_vai]
            print(f"   크기가중 적용: 평균 {W.mean():.2f} 최대 {W.max():.2f} (표본 {N})")
    except Exception as e:
        print("   크기가중 생략:", e); Wtr = None; Wva = None

    def _wout(n, x):
        while "w" not in n:
            n = n["l"] if x[n["f"]] < n["t"] else n["r"]
        return n["w"]
    def _fit_bias(trees, margin, Xref):
        wr = np.array([sum(_wout(t, x) for t in trees) for x in Xref])
        d = margin - wr
        return float(d.mean())
    def _wilson(acc, n, z=1.64):
        if n <= 0: return 0.0
        z2 = z * z; den = 1 + z2 / n; cen = acc + z2 / (2 * n)
        rad = z * math.sqrt((acc * (1 - acc) + z2 / (4 * n)) / n)
        return max(0.0, (cen - rad) / den)
    def _upload(name, model):
        for attempt in range(4):
            try:
                # [V32.15] activate=1 — Worker가 변환정합·trustFloor 통과분만 라이브 승격, 약한 건 섀도우 유지.
                r = requests.post(BASE + "/api/gbdt-import", params={"key": KEY, "name": name, "activate": "1"},
                                  headers=HDR, data=json.dumps(model), timeout=180)
                if r.status_code == 200:
                    print(f"{name} 업로드 OK:", json.dumps(r.json(), ensure_ascii=False)); return
                b = r.text[:200]
                if r.status_code >= 500 and (("D1" in b) or ("overloaded" in b) or ("queued" in b)) and attempt < 3:
                    print(f"{name} D1 과부하 재시도 {attempt+1}"); time.sleep(30); continue
                print(f"{name} 업로드 실패:", r.status_code, b); return
            except requests.exceptions.ReadTimeout:
                if attempt < 3: time.sleep(20); continue
        print(f"{name} 업로드 타임아웃")
    def _finish(name, trees, margin_full, proba_lib):
        bias = _fit_bias(trees, margin_full, Xva)
        # val 정확도(캘리브 없이 0.5 컷) + Wilson 하한
        _pred = (proba_lib >= 0.5).astype(int)
        vacc = float((_pred == Yva).mean())
        _neff = _neff_of(UWva)
        vlb = _wilson(vacc, _neff)          # [V33.115] 명목 nval → 유효표본수
        # [V33.75] 수익가중 정확도 — '맞힌 비율'이 아니라 '맞힌 것들이 얼마나 큰 건이었나'.
        #   승격 판정은 기존 vacc 로 유지하고(회귀 위험 차단) 지표만 함께 찍어 비교 가능하게 한다.
        vaccW = None
        try:
            if Wva is not None:
                vaccW = float(((_pred == Yva) * Wva).sum() / max(1e-9, Wva.sum()))
        except Exception:
            vaccW = None
        # [V32.15] 변환정합성 probe — Worker 추론이 라이브러리 proba를 재현하는지 검증할 (x, p) 표본.
        pi = np.linspace(0, nval - 1, min(200, nval)).astype(int)
        probe = [{"x": Xva[i].tolist(), "p": float(proba_lib[i])} for i in pi]
        _ic, _ric = _calc_ic(proba_lib, Yva)
        model = {"trees": trees, "eta": 1.0, "bias": bias, "valAcc": round(vacc, 4),
                 "valAccLB": round(vlb, 4), "valN": int(nval), "n": int(N), "featVer": featver, "probe": probe,
                 "valIC": round(_ic, 5), "valRankIC": round(_ric, 5)}
        model.update(_ic_block_fields(proba_lib, Yva, mkt=_mkt_of_X(Xva),
                                      ts=TS[order[-nval:]], horizon_ms=_HORIZON_MS))   # [V33.291 · V33.366]
        model.update(_uniq_fields(UWva))
        if vaccW is not None: model["valAccW"] = round(vaccW, 4)
        print(f"{name}: trees={len(trees)} valAcc={vacc:.3f} lb={vlb:.3f}(유효 {_neff}/{nval}) IC={_ic:.4f} RankIC={_ric:.4f}"
              + (f" blockIC={model['valICBlock']:.4f} t={model['valICt']:.2f}" if "valICt" in model else "")
              + (f" 수익가중acc={vaccW:.3f}" if vaccW is not None else "") + " → 업로드(activate)")
        _upload(name, model)

    # ── XGBoost ──
    try:
        import xgboost as xgb
        # [V32.15] 노이즈 큰 금융 holdout에서 depth5·patience30은 3~7트리에서 조기절단(≈랜덤)됐다.
        #   얕은트리(depth4)+강한 규제(min_child·λ↑)+더 큰 patience(60)로 신호가 드러날 시간을 준다.
        dtr = xgb.DMatrix(Xtr, label=Ytr, weight=Wtr); dva = xgb.DMatrix(Xva, label=Yva, weight=Wva)
        # [V32.66] 강화: eta 0.04→0.03, rounds 800→1000, patience 60→90(조기중단 지배) (저LR·다트리·조기중단)
        bst = xgb.train({"objective": "binary:logistic", "max_depth": 4, "eta": 0.03,
                         "lambda": 3.0, "min_child_weight": 8, "gamma": 0.1,
                         "subsample": 0.8, "colsample_bytree": 0.8, "base_score": 0.5},
                        dtr, num_boost_round=1000, evals=[(dva, "v")],
                        early_stopping_rounds=90, verbose_eval=False)
        def _pxgb(n):
            if "leaf" in n: return {"w": float(n["leaf"])}
            f = int(n["split"][1:]) if isinstance(n["split"], str) else int(n["split"])
            ch = {c["nodeid"]: c for c in n["children"]}
            return {"f": f, "t": float(n["split_condition"]), "l": _pxgb(ch[n["yes"]]), "r": _pxgb(ch[n["no"]])}
        # ★조기종료 정합★ get_dump는 전체 트리를 주지만 predict는 best_iteration까지만 쓴다 →
        #   업로드 트리와 라이브러리 확률을 같은 범위(best+1)로 맞춰야 probe(변환정합)가 통과한다.
        _bit = int(getattr(bst, "best_iteration", None) if getattr(bst, "best_iteration", None) is not None else len(bst.get_dump()) - 1)
        _rng = (0, _bit + 1)
        xt = [_pxgb(json.loads(d)) for d in bst.get_dump(dump_format="json")[:_bit + 1]]
        _finish("xgb", xt,
                bst.predict(xgb.DMatrix(Xva), output_margin=True, iteration_range=_rng),
                bst.predict(xgb.DMatrix(Xva), iteration_range=_rng))
    except Exception as e:
        print("XGB 실패(무시):", e)

    # ── LightGBM ──
    try:
        import lightgbm as lgb
        # [V32.15] 얕은트리(depth4·leaves16)+강한 규제(min_data 60)+patience 60 — 조기절단 방지.
        ltr = lgb.Dataset(Xtr, label=Ytr, weight=Wtr); lva = lgb.Dataset(Xva, label=Yva, weight=Wva, reference=ltr)
        # [V32.66] 강화: lr 0.04→0.03, rounds 800→1000, patience 60→90(조기중단 지배)
        lbst = lgb.train({"objective": "binary", "max_depth": 4, "num_leaves": 16,
                          "learning_rate": 0.03, "bagging_fraction": 0.8, "bagging_freq": 1,
                          "feature_fraction": 0.8, "min_data_in_leaf": 60, "lambda_l2": 3.0, "verbose": -1},
                         ltr, num_boost_round=1000, valid_sets=[lva],
                         callbacks=[lgb.early_stopping(90, verbose=False)])
        def _plgb(n):
            if "leaf_value" in n: return {"w": float(n["leaf_value"])}
            return {"f": int(n["split_feature"]), "t": float(n["threshold"]),
                    "l": _plgb(n["left_child"]), "r": _plgb(n["right_child"])}
        # ★조기종료 정합★ best_iteration까지만 추출·예측(업로드 트리 = 라이브러리 확률 범위 일치).
        _lbit = int(lbst.best_iteration or lbst.num_trees())
        lt = [_plgb(ti["tree_structure"]) for ti in lbst.dump_model(num_iteration=_lbit)["tree_info"]]
        _finish("lgb", lt,
                lbst.predict(Xva, raw_score=True, num_iteration=_lbit),
                lbst.predict(Xva, num_iteration=_lbit))
    except Exception as e:
        print("LGB 실패(무시):", e)

    # ── CatBoost (oblivious → 이진트리 확장) ──
    try:
        from catboost import CatBoostClassifier
        # [V32.15] depth4·lr0.04·l2 6·patience60 — 얕고 규제 강하게(3트리 조기절단 방지).
        # [V32.66] 강화: lr 0.04→0.03, iterations 800→1000, patience 60→90
        cb = CatBoostClassifier(depth=4, iterations=1000, learning_rate=0.03, l2_leaf_reg=6.0,
                                random_seed=42, verbose=0, early_stopping_rounds=90, use_best_model=True)
        cb.fit(Xtr, Ytr, sample_weight=Wtr, eval_set=(Xva, Yva))
        tf = tempfile.mktemp(suffix=".json"); cb.save_model(tf, format="json")
        cbj = json.load(open(tf)); os.remove(tf)
        ff = cbj["features_info"]["float_features"]
        fmap = {i: int(ff[i]["feature_index"]) for i in range(len(ff))}
        def _expand(splits, lv):
            Dp = len(splits)
            def rec(level, idx, mul):
                if level == Dp: return {"w": float(lv[idx])}
                s = splits[level]; f = fmap.get(s["float_feature_index"], s["float_feature_index"])
                return {"f": int(f), "t": float(s["border"]),
                        "l": rec(level + 1, idx, mul * 2), "r": rec(level + 1, idx + mul, mul * 2)}
            return rec(0, 0, 1)
        _all = cbj.get("oblivious_trees") or []
        ct = [_expand(tr["splits"], tr["leaf_values"]) for tr in _all if tr.get("splits")]
        # [V33.57] CatBoost 가 화면에 아예 안 뜨던 원인 추적용 진단.
        #   splits 가 없는 트리(상수 트리)만 나오면 ct 가 비어 업로드가 조용히 생략되고,
        #   그러면 cat_trust/_ext 가 만들어지지 않아 상태가 통째로 null 이 된다.
        print(f"   CatBoost 트리 {len(ct)}/{len(_all)} (splits 있는 것만 변환)")
        if ct:
            _finish("cat", ct, cb.predict(Xva, prediction_type="RawFormulaVal"), cb.predict_proba(Xva)[:, 1])
        else:
            print("   CatBoost 업로드 생략 — 변환 가능한 트리 0개"
                  + (" (전체 트리도 0개: 조기중단이 즉시 걸렸을 수 있음)" if not _all else ""))
    except Exception as e:
        import traceback
        print("CatBoost 실패(무시):", repr(e))
        traceback.print_exc()




# ============================================================================
# [V33.305] MEMO(원형 기억) 외부학습 — ★워커 CPU 에서 GPU 쪽으로 옮긴 것 중 가장 무거운 것★
#
#  왜 옮기나 (사용자 지시: "클라우드플레어로 학습이 필수인 애들 말고는 모달로 보내라")
#    워커 야간의 memoTrainNightly 는 k-means 를 돈다 — 표본 24,000 × 원형 128 × 축 75 ×
#    6반복 ≈ ★14억 회★ 다. 그래서 워커에서는 창을 24,000행(67일)으로 묶을 수밖에 없었고,
#    그 좁은 창이 V33.303 이 고친 "홀드아웃 13일" 문제의 뿌리이기도 하다.
#    여기서는 그 제약이 없다 — 표본을 훨씬 크게 잡을 수 있고, 워커 야간 예산도 그만큼 빈다.
#
#  ★같은 모델이어야 한다★ — 워커의 memoScore 가 이 원형책을 그대로 채점한다.
#    그래서 아래 _memo_fit / _memo_score 는 워커 memoTrainNightly / memoScore 의 ★식과
#    반올림까지★ 옮긴 것이다(원형 좌표 3자리·확률 4자리·가중 4자리).
#    tools/check-memo-modal.mjs 가 두 언어를 같은 모델·같은 벡터로 돌려 대조한다 —
#    이 저장소가 반복해 당한 '조용한 오염'은 언제나 두 구현이 갈라진 자리에서 났다.
# ============================================================================
MEMO_CFG = {
    "K": 128, "iters": 6, "neighbors": 8, "shrinkN": 40,
    "relNoiseZ": 2, "minTrain": 4000, "minHold": 400,
    # 워커는 24,000 이 상한이었다. 여기서는 그럴 이유가 없다 — 다만 무한정도 아니다
    # (k-means 는 O(n·K·D) 라 표본이 커지면 GPU 시간이 그대로 돈이다).
    "trainMax": 160000,
    "holdDays": 60,        # 워커 MEMOML.holdDays 와 같은 값 — 게이트가 이 둘을 대조한다
    "holdCap": 30000,      # 홀드아웃 채점은 싸다(거리 계산 1회) — 워커보다 넉넉히 본다
}


def _memo_fit(X, Y, PNL, MKT, cfg=None):
    """원형책을 만든다. X 는 ★학습구간만★ (홀드아웃은 절대 넣지 않는다).
       반환은 워커 memo_model 과 같은 모양의 dict."""
    import numpy as np
    c = dict(MEMO_CFG); c.update(cfg or {})
    Xtr = np.asarray(X, dtype=np.float64)
    Ytr = np.asarray(Y, dtype=np.float64)
    Ptr = np.asarray(PNL, dtype=np.float64)
    ntr, D = Xtr.shape
    if ntr < c["minTrain"]:
        return None, "학습표본 %d/%d 부족" % (ntr, c["minTrain"])

    mean = Xtr.mean(axis=0)
    std = Xtr.std(axis=0)
    std = np.where(std > 1e-6, std, 1.0)
    Z = np.clip((Xtr - mean) / std, -4.0, 4.0)

    # 관련도 가중(V33.273/274) — 잡음바닥 relNoiseZ/√ntr 을 뺀 |점이연 상관|.
    ybar = float(Ytr.mean())
    ysd = float(np.sqrt(max(ybar * (1.0 - ybar), 0.0)))
    mx = Z.mean(axis=0)
    sdx = np.sqrt(np.maximum((Z * Z).mean(axis=0) - mx * mx, 0.0))
    cov = ((Z * (Ytr - ybar)[:, None]).mean(axis=0))
    denom = sdx * ysd
    raw = np.where(denom > 1e-9, np.abs(cov / np.where(denom > 1e-9, denom, 1.0)), 0.0)
    rfloor = float(c["relNoiseZ"]) / np.sqrt(max(ntr, 2))
    r = np.maximum(0.0, raw - rfloor)
    rmax = float(r.max()) if r.size else 0.0
    if rmax > 1e-9:
        scale = np.round(r / rmax, 4)          # 워커: +(r/rmax).toFixed(4)
    else:
        scale = np.ones(D)
    Z = Z * scale
    ordv = list(map(int, np.argsort(-scale, kind="stable")))

    # 시장 칸막이 — 원핫에서 시장을 읽는다(워커 _mktOf 와 같은 규약: US 0 · KR 1 · CM 2 · 없음 3)
    mk = np.asarray(MKT, dtype=np.int64) if MKT is not None else np.full(ntr, -1, dtype=np.int64)
    books = []
    if MKT is not None:
        for m in (0, 1, 2):
            idx = np.nonzero(mk == m)[0]
            if idx.size >= 200:
                books.append((m, idx))
        covered = sum(int(i.size) for _, i in books)
        if not books or covered < 0.5 * ntr:
            books = [(-1, np.arange(ntr))]
    else:
        books = [(-1, np.arange(ntr))]

    base = float(Ytr.mean())
    protos = []
    bookinfo = []
    for m, idx in books:
        n = int(idx.size)
        K = int(min(n // 20, max(8, round(c["K"] * n / ntr))))
        if K < 8:
            continue
        Zb = Z[idx]
        C = Zb[[int(k * n // K) for k in range(K)]].copy()   # 워커: Z[idx[floor(k*n/K)]]
        assign = np.zeros(n, dtype=np.int64)
        for _ in range(int(c["iters"])):
            d2 = ((Zb[:, None, :] - C[None, :, :]) ** 2).sum(axis=2) if n * K * Zb.shape[1] < 6e8 \
                else _memo_chunk_dist(Zb, C)
            assign = d2.argmin(axis=1)
            for k in range(K):
                sel = assign == k
                if sel.any():
                    C[k] = Zb[sel].mean(axis=0)
        bm = float(Ytr[idx].mean())
        kept = 0
        for k in range(K):
            sel = idx[assign == k]
            nk = int(sel.size)
            if nk < 5:
                continue
            wr = float(Ytr[sel].mean())
            sh = nk / (nk + float(c["shrinkN"]))
            protos.append({
                "c": [float(round(v, 3)) for v in C[k]],      # 워커: +v.toFixed(3)
                "n": nk, "m": int(m),
                "p": float(round(bm + (wr - bm) * sh, 4)),
                "pnl": float(round(float(Ptr[sel].mean()), 3)),
            })
            kept += 1
        bookinfo.append({"m": int(m), "n": n, "k": kept, "base": float(round(bm, 4))})
    if len(protos) < 8:
        return None, "유효 원형 %d개" % len(protos)
    return {
        "protos": protos,
        "mean": [float(v) for v in mean], "std": [float(v) for v in std],
        "scale": [float(v) for v in scale], "ord": ordv,
        "base": float(round(base, 4)), "books": bookinfo,
        "n": int(ntr),
    }, None


def _memo_chunk_dist(Zb, C):
    """표본이 크면 (n,K,D) 를 한 번에 만들면 메모리가 터진다 — 조각내서 같은 값을 만든다."""
    import numpy as np
    n = Zb.shape[0]
    out = np.empty((n, C.shape[0]), dtype=np.float64)
    step = max(1, int(4e7 // max(1, C.shape[0] * C.shape[1])))
    for a in range(0, n, step):
        b = min(n, a + step)
        out[a:b] = ((Zb[a:b, None, :] - C[None, :, :]) ** 2).sum(axis=2)
    return out


def _memo_score(model, xrow, mkt_idx=None, neighbors=8):
    """★워커 memoScore 의 그대로 옮김★ — 표준화 → scale → 같은 시장 원형만 → 최근접 M개 →
       1/(1+d²) 가중 평균. 값이 갈라지면 게이트가 잡는다."""
    import numpy as np
    mean = np.asarray(model["mean"], dtype=np.float64)
    std = np.asarray(model["std"], dtype=np.float64)
    scale = np.asarray(model.get("scale") or np.ones(mean.size), dtype=np.float64)
    x = np.asarray(xrow, dtype=np.float64)
    z = np.clip((x - mean) / np.where(std != 0, std, 1.0), -4.0, 4.0) * scale
    P = model["protos"]
    sel = range(len(P))
    mi = model.get("mktIdx")
    if mi and len(mi) == 3:
        qm = 3
        for m in range(3):
            if float(x[mi[m]]) > 0.5:
                qm = m
                break
        s2 = [k for k in range(len(P)) if P[k].get("m") == qm]
        if not s2:
            s2 = [k for k in range(len(P)) if P[k].get("m") == -1]
        if s2:
            sel = s2
    M = max(1, int(neighbors))
    d2 = []
    for k in sel:
        c = np.asarray(P[k]["c"], dtype=np.float64)
        t = z - c
        d2.append((float(t @ t), k))
    if not d2:
        return None
    d2.sort(key=lambda e: e[0])
    ws = 0.0
    ps = 0.0
    for dd, k in d2[:M]:
        w = 1.0 / (1.0 + dd)
        ws += w
        ps += w * float(P[k]["p"])
    if ws <= 0:
        return None
    return float(min(max(ps / ws, 0.001), 0.999))


def _memo_score_all(model, Xh, MKTh, neighbors=8):
    """홀드아웃 전량 채점 — 위 _memo_score 와 ★같은 식★ 을 행렬로 한 번에 돈다."""
    import numpy as np
    mean = np.asarray(model["mean"], dtype=np.float64)
    std = np.asarray(model["std"], dtype=np.float64)
    scale = np.asarray(model.get("scale") or np.ones(mean.size), dtype=np.float64)
    Xh = np.asarray(Xh, dtype=np.float64)
    Z = np.clip((Xh - mean) / np.where(std != 0, std, 1.0), -4.0, 4.0) * scale
    P = model["protos"]
    C = np.asarray([p["c"] for p in P], dtype=np.float64)
    PM = np.asarray([p["m"] for p in P], dtype=np.int64)
    PP = np.asarray([p["p"] for p in P], dtype=np.float64)
    has_book = model.get("mktIdx") is not None and len(set(PM.tolist())) > 1
    M = max(1, int(neighbors))
    out = np.full(Z.shape[0], np.nan)
    groups = {}
    for i in range(Z.shape[0]):
        g = int(MKTh[i]) if (has_book and MKTh is not None) else -999
        groups.setdefault(g, []).append(i)
    for g, rows in groups.items():
        if has_book:
            keep = np.nonzero(PM == g)[0]
            if keep.size == 0:
                keep = np.nonzero(PM == -1)[0]
            if keep.size == 0:
                keep = np.arange(C.shape[0])
        else:
            keep = np.arange(C.shape[0])
        Cg = C[keep]
        Pg = PP[keep]
        idx = np.asarray(rows, dtype=np.int64)
        step = max(1, int(4e7 // max(1, Cg.shape[0] * Cg.shape[1])))
        for a in range(0, idx.size, step):
            b = min(idx.size, a + step)
            Zb = Z[idx[a:b]]
            d2 = ((Zb[:, None, :] - Cg[None, :, :]) ** 2).sum(axis=2)
            mm = min(M, Cg.shape[0])
            part = np.argpartition(d2, mm - 1, axis=1)[:, :mm]
            dd = np.take_along_axis(d2, part, axis=1)
            w = 1.0 / (1.0 + dd)
            pv = Pg[part]
            out[idx[a:b]] = np.clip((w * pv).sum(axis=1) / w.sum(axis=1), 0.001, 0.999)
    return out


def _train_and_upload_memo(BASE, KEY, HDR, X, Y, TS, PNL, featver, D, featnames=None, cfg=None,
                           SYM=None):
    # [V33.377] ★json·requests 가 빠져 있었다 — 그래서 MEMO 업로드가 ★한 번도★ 성공한 적이 없다.★
    #   실측(run 35149059451, 2026-09-16 21:37:47):
    #     MEMO 원형 128개 · 학습 160000행 · … · valAcc 50.2% · 블록IC 0.008 t 0.322 · probe 40건
    #     MEMO 업로드 예외: name 'requests' is not defined
    #   학습은 매 회차 멀쩡히 끝났고 마지막 POST 한 줄에서만 죽었다. 예외를 잡아 print 만 하고
    #   None 을 돌려주므로 회차는 '성공' 으로 끝났다 — 그래서 아무도 몰랐다.
    #   이 함수만 최상위 def 라 train_job 의 지역 import 를 클로저로 못 받는다(나머지 학습기는 받는다).
    import numpy as np, json, requests
    c = dict(MEMO_CFG)
    c.update(cfg or {})
    Xa = np.asarray(X, dtype=np.float64)
    Ya = np.asarray(Y, dtype=np.float64)
    Pa = np.asarray(PNL, dtype=np.float64) if PNL is not None else np.zeros(len(Y))
    Ta = np.asarray(TS, dtype=np.float64)
    order = np.argsort(Ta, kind="stable")
    Xa, Ya, Pa, Ta = Xa[order], Ya[order], Pa[order], Ta[order]

    day = 86400000.0
    hold_ms = float(c["holdDays"]) * day
    emb_ms = float((cfg or {}).get("horizonDays", 10)) * day
    ts_max = float(Ta.max())
    hold_from = ts_max - hold_ms
    train_hi = hold_from - emb_ms
    tr_idx = np.nonzero(Ta < train_hi)[0]
    ho_idx = np.nonzero(Ta >= hold_from)[0]
    if tr_idx.size > c["trainMax"]:
        tr_idx = tr_idx[-int(c["trainMax"]):]
    if ho_idx.size > c["holdCap"]:
        ho_idx = ho_idx[np.linspace(0, ho_idx.size - 1, int(c["holdCap"])).astype(np.int64)]
    if tr_idx.size < c["minTrain"] or ho_idx.size < c["minHold"]:
        print("MEMO 건너뜀 — 학습 %d · 홀드아웃 %d (이력이 %d일)"
              % (tr_idx.size, ho_idx.size, int((ts_max - float(Ta.min())) / day)))
        return None

    mcols = _set_mkt_cols(featnames) if featnames else None
    MK_all = _mkt_of_X(Xa) if mcols else None
    MKi = None
    if MK_all is not None:
        _map = {"us": 0, "kr": 1, "cm": 2}
        MKi = np.asarray([_map.get(str(v), 3) for v in MK_all], dtype=np.int64)

    model, why = _memo_fit(Xa[tr_idx], Ya[tr_idx], Pa[tr_idx],
                           MKi[tr_idx] if MKi is not None else None, c)
    if model is None:
        print("MEMO 학습 불가 —", why)
        return None
    model["mktIdx"] = list(mcols) if mcols else None
    model["luxFeatVer"] = int(featver)
    model["featVer"] = 1                       # 워커 MEMOML.featVer
    model["source"] = "external"
    model["purged"] = 0                        # 엠바고가 달력으로 이미 갈라 놓았다
    model["maxId"] = 0
    model["maxTs"] = int(ts_max)

    ph = _memo_score_all(model, Xa[ho_idx], MKi[ho_idx] if MKi is not None else None,
                         int(c["neighbors"]))
    ok = ~np.isnan(ph)
    ph, yh = ph[ok], Ya[ho_idx][ok]
    mkh = (MK_all[ho_idx][ok] if MK_all is not None else None)
    if ph.size < 200:
        print("MEMO 홀드아웃 채점 %d건 — 건너뜀" % ph.size)
        return None
    acc = float(((ph >= 0.5).astype(np.float64) == yh).mean())
    th = Ta[ho_idx][ok]
    # [V33.366] MEMO 도 같은 자로 — th 는 바로 아래에서 이미 쓰던 값이다(새로 만들지 않았다).
    icf = _ic_block_fields(ph.tolist(), yh.tolist(), 5, mkh, ts=th, horizon_ms=_HORIZON_MS)
    span_d = int(max(0, round((float(th.max()) - float(th.min())) / day)))
    eff = int(span_d // int((cfg or {}).get("horizonDays", 10)))
    model.update(icf)
    model["valAcc"] = round(acc, 4)
    model["valN"] = int(ph.size)
    # [V33.306] ★고유도 보정된 유효표본수를 함께 보낸다★ — 10일 라벨이 겹치므로 명목 n 은
    #   독립 증거 수가 아니다. 워커 _importedValN 이 이 값을 게이트에 쓴다(V33.115 의 자).
    try:
        _sy = np.asarray(SYM)[order][ho_idx][ok] if SYM is not None else None
        _uw = _uniq_weights(th, _sy, float((cfg or {}).get("horizonDays", 10)) * day)
        model.update(_uniq_fields(_uw))
    except Exception as _e:
        print("MEMO 고유도 계산 생략:", _e)
    model["valICspanD"] = span_d
    model["valICeff"] = eff
    model["valIC"] = icf.get("valICBlock")

    # ★정합 probe★ — 워커 memoScore 가 이 원형책을 그대로 재현하는지 업로드마다 확인한다.
    #   두 언어가 갈라지면 성적으로만 드러나는 조용한 오염이 된다(이 저장소가 반복해 당한 것).
    #   scalar 판(_memo_score)으로 만든다 — 워커와 ★더하는 순서까지★ 같게 하려는 것이다.
    _pi = np.linspace(0, ho_idx.size - 1, min(40, ho_idx.size)).astype(np.int64)
    model["probe"] = [{"x": [float(v) for v in Xa[ho_idx[i]]],
                       "p": _memo_score(model, Xa[ho_idx[i]], neighbors=int(c["neighbors"]))}
                      for i in _pi]
    model["probe"] = [q for q in model["probe"] if q["p"] is not None]

    print("MEMO 원형 %d개 · 학습 %d행 · 홀드아웃 %d행/%d일(관측 %d개) · valAcc %.1f%% · 블록IC %s t %s · probe %d건"
          % (len(model["protos"]), int(tr_idx.size), int(ph.size), span_d, eff, acc * 100,
             icf.get("valICBlock"), icf.get("valICt"), len(model["probe"])))
    try:
        r = requests.post(BASE + "/api/memo-import", params={"key": KEY, "activate": "1"},
                          headers=HDR, data=json.dumps(model), timeout=180)
        print("MEMO 업로드", r.status_code, r.text[:300])
        return r.status_code == 200
    except Exception as e:
        print("MEMO 업로드 예외:", e)
        return None

# ============================================================================
# [V32.16] MIND(FM=인수분해기계) 외부학습 — Worker의 _fmTrain은 CPU예산(20s) 안에 20에폭·
#   50k표본을 못 돌려 39~57% 오실레이션·미수렴이었다(코드 주석 다수). GPU/여유 CPU에서 멀티시드·
#   충분한 에폭으로 완전수렴시켜 업로드 → Worker는 추론(_fmRaw)만. Worker와 동일한 2차 FM 공식·
#   표준화(z=(x-mean)/std)·K=8을 그대로 써서 업로드 가중이 그대로 작동한다. MIND는 FM단독(experts=["fm"],
#   meta=항등)으로 조립돼 위원장(always-on)으로 즉시 가동. τ* 캘리브레이션을 b에 구워 0.5컷 정합.
def _train_and_upload_fm(BASE, KEY, HDR, X, Y, TS, PNL, featver, D, UNIQ=None):
    import numpy as np, math, json, time, requests
    N = len(Y)
    if N < 200:
        print(f"FM: 표본 부족 {N} — 생략"); return
    K = 8; L2W = 1e-3; L2V = 3e-3; EPOCHS = 80; SEEDS = 6
    # [V33.341] 엠바고 분할(공용 헬퍼) — 종전엔 경계를 안 비워 라벨 지평만큼 겹쳤다.
    order, _tri, _cali, _vai, _nv0, _emb = _split_ts(TS, 0.2, _EMBARGO_MS, min_val=60,
                                                     horizon_ms=_HORIZON_MS, cal_frac=0.10, tag="MIND")
    Xs = X[order].astype(np.float64); Ys = Y[order].astype(np.float64)
    Ps = np.abs(PNL[order].astype(np.float64))
    nval = len(_vai)
    # [V33.115] ★표준화 누출 수정★ — 종전엔 평균·표준편차를 검증분 포함 전체로 잡았다.
    #   MIND 는 이 mean/std 를 그대로 업로드해 워커 추론에 쓰므로, 검증분포가 스며들면
    #   검증성적이 부풀 뿐 아니라 그 편향이 라이브 추론까지 따라간다. 학습구간만으로 잡는다.
    #   (train_job·_miniLogisticTrain 에서 잡은 것과 같은 실수 — 세 곳이 같았다)
    # [V33.341] 학습구간은 이제 ★엠바고를 뺀★ 인덱스(_tri)다 — 경계 표본이 통계에도 안 섞인다.
    mean = Xs[_tri].mean(axis=0); std = Xs[_tri].std(axis=0); std[std < 1e-6] = 1.0
    Z = (Xs - mean) / std
    Z = np.clip(Z, -6, 6)
    Ztr, Ytr = Z[_tri], Ys[_tri]; Zva, Yva = Z[_vai], Ys[_vai]
    UWva = _uw_pick(UNIQ, N, order[_vai])       # [V33.115] 검증구간 고유도
    # 표본가중: |pnl| 중앙값 정규화(0.3~3.0) × 균형 클래스가중
    _Ptr = Ps[_tri]
    pscale = np.median(_Ptr) if np.median(_Ptr) > 1e-6 else 1.0
    mw = np.clip(_Ptr / pscale, 0.3, 3.0)
    pos = float(Ytr.sum()); ntr = len(Ytr)
    wpos = ntr / (2 * pos) if pos > 0 else 1.0
    wneg = ntr / (2 * (ntr - pos)) if (ntr - pos) > 0 else 1.0
    cw = np.where(Ytr > 0.5, wpos, wneg) * mw
    Ztr2 = Ztr ** 2

    def sigmoid(a): return 1.0 / (1.0 + np.exp(-np.clip(a, -30, 30)))
    def fm_raw(Zin, w, V, b):
        A = Zin @ V                       # (n,K)
        Bm = (Zin ** 2) @ (V ** 2)        # (n,K)
        return b + Zin @ w + 0.5 * np.sum(A * A - Bm, axis=1)

    def train_one(seed):
        rng = np.random.default_rng(seed)
        w = np.zeros(D); V = 0.01 * rng.standard_normal((D, K)); b = 0.0
        # Adam
        mw_, vw_ = np.zeros(D), np.zeros(D); mV, vV = np.zeros((D, K)), np.zeros((D, K))
        mb, vb = 0.0, 0.0; b1, b2, eps, lr = 0.9, 0.999, 1e-8, 0.02
        t = 0
        for ep in range(EPOCHS):
            A = Ztr @ V
            raw = b + Ztr @ w + 0.5 * np.sum(A * A - Ztr2 @ (V ** 2), axis=1)
            p = sigmoid(raw)
            dLds = (p - Ytr) * cw
            gb = dLds.mean()
            gw = Ztr.T @ dLds / ntr + L2W * w
            g2 = Ztr2.T @ dLds                    # (D,)
            G1 = Ztr.T @ (dLds[:, None] * A)      # (D,K)
            gV = G1 / ntr - V * (g2[:, None] / ntr) + L2V * V
            t += 1
            mb = b1 * mb + (1 - b1) * gb; vb = b2 * vb + (1 - b2) * gb * gb
            b -= lr * (mb / (1 - b1 ** t)) / (math.sqrt(vb / (1 - b2 ** t)) + eps)
            mw_ = b1 * mw_ + (1 - b1) * gw; vw_ = b2 * vw_ + (1 - b2) * gw * gw
            w -= lr * (mw_ / (1 - b1 ** t)) / (np.sqrt(vw_ / (1 - b2 ** t)) + eps)
            mV = b1 * mV + (1 - b1) * gV; vV = b2 * vV + (1 - b2) * gV * gV
            V -= lr * (mV / (1 - b1 ** t)) / (np.sqrt(vV / (1 - b2 ** t)) + eps)
        return w, V, b

    # ── [V33.341] ★시드 선택과 τ* 를 검증에서 떼어 낸다★ ──────────────────────
    #   종전엔 검증 앞절반으로 시드를 고르고 τ* 를 굽고, 뒤절반으로만 채점했다.
    #   정직하긴 했지만 ★이 모델만 유효표본이 절반★ 이 되어 Wilson 하한이 구조적으로
    #   낮게 나온다(실측 MIND ≈950 vs 부스터 ≈7,400 — 같은 풀에서 8배 차이).
    #   → 학습에서 뺀 보정 구간(cal)으로 고르고, 검증은 ★전부★ 채점에 쓴다.
    #     엠바고가 보정과 검증을 갈라 놓으므로 누출은 없다.
    _useCal = len(_cali) >= 50
    if _useCal:
        Zsel, Ysel = Z[_cali], Ys[_cali]
    else:
        _sn = max(20, nval // 2)
        Zsel, Ysel = Zva[:_sn], Yva[:_sn]
    best = None; best_bal = -1
    for s in range(SEEDS):
        w, V, b = train_one(s)
        praw = fm_raw(Zsel, w, V, b); up = sigmoid(praw) >= 0.5
        yv = Ysel > 0.5
        tp = np.sum(up & yv); fn = np.sum(~up & yv); tn = np.sum(~up & ~yv); fp = np.sum(up & ~yv)
        bal = 0.5 * ((tp / max(1, tp + fn)) + (tn / max(1, tn + fp)))
        if bal > best_bal: best_bal = bal; best = (w, V, b)
    w, V, b = best
    # τ* 캘리브레이션 — 보정 구간에서 정확도 최대 임계를 b에 구움(0.5컷 정합)
    fps = sigmoid(fm_raw(Zsel, w, V, b)); fsort = np.sort(fps)
    bt, bs = 0.5, -1
    for q in range(2, 37):
        tau = fsort[int((q / 38) * (len(fsort) - 1))]
        acc = np.mean((fps >= tau).astype(int) == (Ysel > 0.5).astype(int))
        if acc > bs: bs = acc; bt = tau
    bt = min(max(bt, 1e-4), 1 - 1e-4)
    b -= math.log(bt / (1 - bt))
    # 정직 홀드아웃 — 보정을 따로 뺐으면 검증 전체, 아니면 종전대로 뒤절반
    _hs = 0 if _useCal else max(20, nval // 2)
    hold = slice(_hs, nval)
    ph = sigmoid(fm_raw(Zva[hold], w, V, b))
    yh = Yva[hold] > 0.5
    vacc = float(np.mean((ph >= 0.5) == yh)); nh = int(nval - _hs)
    print(f"   MIND 채점 구간: {'검증 전체' if _useCal else '검증 뒤절반'} {nh}건"
          f" (τ*·시드선택 {'보정구간 ' + str(len(_cali)) + '건' if _useCal else '검증 앞절반'})")
    # [V33.115] 하한은 유효표본수로 — 채점에 쓴 구간의 고유도만 쓴다.
    _uwh = UWva[_hs:nval]
    _neff = _neff_of(_uwh)
    z16 = 1.64; den = 1 + z16 * z16 / _neff
    vlb = max(0.0, ((vacc + z16 * z16 / (2 * _neff)) - z16 * math.sqrt((vacc * (1 - vacc) + z16 * z16 / (4 * _neff)) / _neff)) / den)
    # 변환정합성 probe — Worker mlFMScore가 재현하는지(원본 x, 확률 p)
    pi = np.linspace(0, nval - 1, min(200, nval)).astype(int)
    probe = [{"x": Xs[-nval:][i].tolist(), "p": float(sigmoid(fm_raw(Z[-nval:][i:i+1], w, V, b))[0])} for i in pi]
    model = {"w": w.tolist(), "V": V.tolist(), "b": float(b), "K": K,
             "mean": mean.tolist(), "std": std.tolist(),
             "valAcc": round(vacc, 4), "valAccLB": round(vlb, 4), "valN": nh, "n": int(N),
             "featVer": featver, "probe": probe}
    model.update(_uniq_fields(_uwh))
    print(f"FM(MIND): K={K} seeds={SEEDS} valAcc={vacc:.3f} lb={vlb:.3f}(유효 {_neff}/{nh}) (sel균형 {best_bal:.3f}) → 업로드(activate)")
    for attempt in range(4):
        try:
            r = requests.post(BASE + "/api/fm-import", params={"key": KEY, "activate": "1"},
                              headers=HDR, data=json.dumps(model), timeout=180)
            if r.status_code == 200:
                print("FM(MIND) 업로드 OK:", json.dumps(r.json(), ensure_ascii=False)); return
            bdy = r.text[:200]
            if r.status_code >= 500 and (("D1" in bdy) or ("overloaded" in bdy) or ("queued" in bdy)) and attempt < 3:
                print(f"FM D1 과부하 재시도 {attempt+1}"); time.sleep(30); continue
            print("FM 업로드 실패:", r.status_code, bdy); return
        except requests.exceptions.ReadTimeout:
            if attempt < 3: time.sleep(20); continue
    print("FM 업로드 타임아웃")


def _train_and_upload_scalp(BASE, KEY, HDR, featver):
    """[V33.41] 장중(분봉) 단타 전용 모델.

    위원회(10일 지평)와 완전히 분리된 파이프라인이다:
      · 표본 소스가 다르다 — /api/ml-export-intraday (R2 전용, D1 미조회)
      · 라벨 지평이 다르다 — 5분봉 12개(60분), ±1.2% 배리어
      · 업로드 슬롯이 다르다 — /api/scalp-import → scalp_model/scalp_trust
    따라서 이 잡이 실패하거나 성능이 나빠도 스윙 성능에는 영향이 없다.
    """
    import numpy as np, math, json, time, requests
    from datetime import datetime, timedelta, timezone

    # 최근 며칠치 장중 표본을 모은다(하루 1개 엔드포인트 호출).
    KST = timezone(timedelta(hours=9))
    # [V33.46] 장중 미시구조 피처(ix)를 x 뒤에 이어붙여 학습한다.
    #   종전엔 x(일봉 피처 65차원)만 썼는데 라벨은 60분 뒤 수익이었다 — 하루짜리 정보로
    #   한 시간 뒤를 맞히라는 구조라 스윙 모델과 입력이 같았고, 단타로서 배울 게 거의 없었다.
    #   ix 스키마 버전(fv)이 서버와 다른 표본은 섞지 않는다(피처 인덱스 어긋남 방지).
    days, X, Y, TS, PNL, BAR, HM = 14, [], [], [], [], [], []
    SYM = []                                   # [V33.115] 고유도용 종목 — 겹침은 같은 종목 안에서만 센다
    MAE = []                                   # [V33.120] |최대역행| / 배리어폭 — 경로 품질
    ifeatver, ifeatn, ifeatnames = None, 0, []
    skipped_old = 0
    # [V33.255] ★일봉 피처 x 의 폭은 아무도 검사하지 않고 있었다.★
    #   ix 는 fv/ifeatn 으로 걸러내면서 x 는 그대로 통과시켰다. 그런데 R2 의 장중 표본은
    #   ★만들어진 시점의 LUXML.featVer 로 기록된다.★ featVer 가 65→69 로 오르면 같은 날짜
    #   버킷 안에 65칸짜리와 69칸짜리가 섞이고, np.array 가 그 자리에서 죽는다:
    #     ValueError: setting an array element with a sequence.
    #     The requested array has an inhomogeneous shape after 1 dimensions.
    #     The detected shape was (8293,) + inhomogeneous part.
    #   그래서 featVer 를 올릴 때마다 단타 학습이 조용히 멈췄다(스윙은 멀쩡하니 안 보인다).
    #   서버가 응답에 featNames 로 ★지금의 폭★ 을 알려주므로 그것에 맞추면 된다.
    xn = 0
    skipped_xdim = 0
    cal_fix = 0; cal_unfix = 0     # [V33.275] 서버가 되살린 옛 판 표본 수
    # [V33.72] 같은 (종목, 봉시각) 표본은 한 번만 쓴다.
    #   백필이 전 종목을 회전하며 도는데 야후 5분봉은 1개월 롤링 창이라, 워터마크가 없던
    #   시기에 만들어진 파일에는 같은 봉이 여러 번 들어있을 수 있다. 사본이 섞이면
    #   검증셋으로 새는 데다 그 구간에만 가중치가 쏠린다.
    seen_keys = set()
    dup_drop = 0
    for i in range(days):
        d = (datetime.now(KST) - timedelta(days=i)).strftime("%Y-%m-%d")
        # [V33.98] ★페이징★ — 백필이 하루에 수만 건을 만들면 한 번의 응답으로는 다 못 받는다.
        #   종전엔 첫 페이지만 받고 끝내서, 그 날 표본의 상당수를 아예 못 봤다.
        _page_samples = []
        _off = 0
        for _pg in range(20):
            try:
                r = requests.get(BASE + "/api/ml-export-intraday",
                                 params={"key": KEY, "day": d, "offset": _off},
                                 headers=HDR, timeout=120)
            except Exception:
                break
            if r.status_code != 200:
                break
            j = r.json()
            if ifeatver is None:
                ifeatver = j.get("ifeatVer"); ifeatn = int(j.get("ifeatN") or 0)
                ifeatnames = j.get("ifeatNames") or []
            if not xn:
                xn = len(j.get("featNames") or [])
            # [V33.275] 서버가 옛 판(달력 이전) 표본의 6칸을 되살려 보낸다 — 그 수를 합산해 보고한다.
            #   되살리기 자체는 ★서버에서★ 한다(라이브와 같은 _calFeats 를 쓴다). 여기서 다시
            #   구현하면 달력 계산이 JS·파이썬 두 곳에 살게 되고 언젠가 갈라진다.
            cal_fix += int(j.get("calBackfilled") or 0)
            cal_unfix += int(j.get("calUnfixable") or 0)
            _batch = j.get("samples", []) or []
            _page_samples.extend(_batch)
            if not j.get("hasMore"):
                break
            _off += int(j.get("pageSize") or len(_batch) or 1)
        try:
            for sm in _page_samples:
                x = sm.get("x")
                if not isinstance(x, list):
                    continue
                if xn and len(x) != xn:
                    skipped_xdim += 1     # 옛 featVer 로 기록된 표본 — 폭이 달라 섞을 수 없다
                    continue
                ix = sm.get("ix")
                if ifeatver and (not isinstance(ix, list) or len(ix) != ifeatn or sm.get("fv") != ifeatver):
                    skipped_old += 1     # 장중 피처 없는 구표본 — 차원이 달라 섞을 수 없다
                    continue
                k_dup = (sm.get("s") or "?", int(sm.get("ts") or 0))
                if k_dup[1] and k_dup in seen_keys:
                    dup_drop += 1
                    continue
                seen_keys.add(k_dup)
                X.append(x + (ix if ifeatver else []))
                Y.append(1 if sm.get("y") else 0)
                TS.append(sm.get("ts", 0))
                PNL.append(float(sm.get("pnl") or 0.0))
                SYM.append(str(sm.get("s") or ""))
                BAR.append(sm.get("bar") or "time")            # tp / sl / time — 어느 배리어로 끝났나
                HM.append(float(sm.get("hm") or 60.0))         # 결착까지 걸린 분
                # [V33.120] 경로 통계 — 최대 역행/순행(%). 배리어폭(b) 대비로 정규화해서 쓴다.
                #   레버리지를 걸 수 있는 표본이 어떤 것인지는 도착점이 아니라 경로가 말한다.
                _bw = float(sm.get("b") or 0.0)
                MAE.append(abs(float(sm.get("mae") or 0.0)) / _bw if _bw > 0 else 0.0)
        except Exception as e:
            print(f"  장중표본 {d} 수집 실패: {e}")
    N = len(Y)
    print(f"⑧ 단타(장중) 학습 — 표본 {N}건 / 최근 {days}일"
          + (f" (구스키마 {skipped_old}건 제외)" if skipped_old else "")
          + (f" (달력 소급복원 {cal_fix}건)" if cal_fix else "")
          + (f" (일봉피처 폭 불일치 {skipped_xdim}건 제외 / 기준 {xn}칸"
             + (f" · 복원불가 {cal_unfix}건" if cal_unfix else "") + ")" if skipped_xdim else "")
          + (f" (중복 {dup_drop}건 제외)" if dup_drop else "")
          + (f" / 장중피처 v{ifeatver}×{ifeatn}" if ifeatver else " / 장중피처 없음"))
    # [V33.98] 워커의 신뢰 문턱이 n>=3000 이다. 1500 에서 학습해 올리면 서버가 무조건
    #   "표본 부족" 으로 거부한다 — 학습 성공 → 신뢰 거부 churn 만 생긴다. 문턱을 맞춘다.
    if N < 3000:
        print(f"   표본 부족({N}/3000) — 생략. 더 쌓이면 자동으로 학습된다."); return

    # ★여기가 종전에 죽던 자리다.★ 위 필터를 뚫고도 폭이 어긋나면 역추적 불가능한
    #   ValueError 대신 무엇이 몇 칸이었는지를 남기고 멈춘다 — 다음 사람이 로그만 보고 안다.
    _w = sorted({len(r) for r in X})
    if len(_w) != 1:
        from collections import Counter
        print(f"   ✗ 표본 폭이 섞였다 {dict(Counter(len(r) for r in X))} — 기준 {xn}칸. 생략."); return
    X = np.array(X, dtype=np.float64); Y = np.array(Y, dtype=int); TS = np.array(TS)
    PNL = np.array(PNL, dtype=np.float64)
    BAR = np.array(BAR); HM = np.array(HM, dtype=np.float64)
    SYM = np.array(SYM); MAE = np.array(MAE, dtype=np.float64) if len(MAE) == len(Y) else None
    D = X.shape[1]
    bar_mix = {b: int((BAR == b).sum()) for b in ("tp", "sl", "time")}
    print(f"   배리어 결착: TP {bar_mix['tp']} / SL {bar_mix['sl']} / 시간만료 {bar_mix['time']}")
    order = np.argsort(TS)
    Xs, Ys, TSs, PNLs = X[order], Y[order], TS[order], PNL[order]
    BARs, HMs = BAR[order], HM[order]
    MAEs = MAE[order] if MAE is not None else None
    SYMs = SYM[order] if SYM.size == N else None
    nval = max(300, int(N * 0.25))
    Xva, Yva = Xs[-nval:], Ys[-nval:]
    # [V33.46] ★엠바고(purge)★ — 라벨 지평이 60분이라, 검증 시작 직전 60분 안의 학습표본은
    #   검증구간과 같은 가격움직임을 라벨로 공유한다(누출). 그만큼 잘라내야 검증 정확도가 정직하다.
    horizon_ms = 60 * 60 * 1000
    # [V33.115] ★고유도★ — 5분봉 표본이 60분 지평 라벨을 달고 있으니 같은 종목의 인접 12봉은
    #   거의 같은 가격움직임을 라벨로 공유한다. 검증 3,000건이 실제로는 몇백 건어치 증거일 수
    #   있고, 명목 n 으로 잰 Wilson 하한은 그만큼 낙관적이다. 겹침의 역수를 합해 유효 n 을 쓴다.
    UWva = _uniq_weights(TSs[-nval:], SYMs[-nval:] if SYMs is not None else None, horizon_ms)
    va_start = TSs[-nval]
    tr_mask = TSs[:-nval] < (va_start - horizon_ms)
    Xtr, Ytr, PNLtr = Xs[:-nval][tr_mask], Ys[:-nval][tr_mask], PNLs[:-nval][tr_mask]
    TStr, BARtr, HMtr = TSs[:-nval][tr_mask], BARs[:-nval][tr_mask], HMs[:-nval][tr_mask]
    print(f"   엠바고 적용 — 학습 {len(Ytr)}건(제외 {(~tr_mask).sum()}건) / 검증 {nval}건")
    if len(Ytr) < 800:
        print(f"   엠바고 후 학습표본 부족({len(Ytr)}/800) — 생략."); return
    pos_rate = float(Ys.mean())
    baseline = max(pos_rate, 1 - pos_rate)
    print(f"   양성비율 {pos_rate:.3f} / 다수클래스 베이스라인 {baseline:.3f}")

    # [V33.46] ★수익크기 가중★ — +0.05% 로 끝난 표본과 +3% 로 끝난 표본을 같은 무게로
    #   배우면 모델이 '거의 안 움직인 다수'에 맞춰진다. 단타에서 중요한 건 크게 움직인 쪽이다.
    Wtr = 1.0 + np.clip(np.abs(PNLtr), 0, 3.0) / 1.5     # 가중 [1.0, 3.0]

    # [V33.47→V33.115] ★평균 고유도 가중(de Prado AFML 4장)★
    #   종전 구현은 동시성을 ★전 종목에 걸쳐★ 셌다. 그런데 5분봉 표본은 매 시각 수백 종목이
    #   동시에 만들어지므로 conc 가 어느 표본이든 거의 같은 큰 수(≈종목수×12)로 나왔고,
    #   평균 1 정규화까지 거치면 가중이 사실상 균등해졌다 — 즉 ★거의 아무 일도 하지 않는 코드★
    #   였다. 게다가 로그의 "유효표본 ≈ N/동시성" 은 자릿수가 틀린 숫자를 찍고 있었다
    #   (표본 3만 건이 12건어치라는 뜻이 되는데, 그건 사실이 아니다).
    #   de Prado 의 고유도는 ★같은 상품(종목) 안에서★ 라벨 구간이 겹치는 정도다. 다른 종목의
    #   같은 시각은 상관이 있을 뿐 같은 사건이 아니고, 그건 상관구조로 다룰 문제지 표본가중이
    #   아니다. 워커 _uniqWeights·스윙 트레이너와 같은 정의(_uniq_weights)로 통일한다.
    try:
        SYMtr = SYMs[:-nval][tr_mask] if SYMs is not None else None
        uniq = _uniq_weights(TStr, SYMtr, horizon_ms)
        _conc = 1.0 / np.clip(uniq, 1e-9, None)
        Wtr = Wtr * np.clip(uniq / max(1e-9, uniq.mean()), 0.25, 4.0)
        print(f"   고유도 가중 — 종목내 평균 동시성 {_conc.mean():.1f}봉 · 평균 고유도 {uniq.mean():.3f}"
              f" (유효표본 ≈ {uniq.sum():.0f}/{len(TStr)}건)"
              + ("" if SYMtr is not None else "  ※종목 없음 — 균등가중 폴백"))
    except Exception as e:
        print(f"   고유도 가중 생략: {e}")

    # [V33.47] 배리어 결착 가중 — 배리어를 실제로 '친' 표본(TP/SL)이 시간만료보다 정보가 많다.
    #   시간만료는 "60분 동안 아무 일도 없었다"는 뜻이라 방향 라벨의 신뢰도가 낮다.
    #   또 빨리 결착될수록 신호가 강했다는 뜻이므로 소요시간의 역수로 가중을 더한다.
    try:
        hit = (BARtr != "time").astype(np.float64)
        speed = np.clip(60.0 / np.clip(HMtr, 5.0, 60.0), 1.0, 3.0)   # 빠를수록 최대 3배
        Wtr = Wtr * (0.6 + 0.4 * hit) * (1.0 + 0.3 * (speed - 1.0))
    except Exception as e:
        print(f"   배리어 가중 생략: {e}")

    # [V33.120] ★경로 품질 가중 — 레버리지를 걸 수 있는 표본에 학습을 집중시킨다★
    #   같은 '승리' 라도 역행 없이 곧장 올라간 건과, 손절 직전까지 밀렸다가 겨우 돌아온 건은
    #   전혀 다른 사건이다. 뒤엣것은 배수를 올리는 순간 손절로 바뀐다 — 레버리지 관점에서는
    #   승리가 아니다. |최대역행|/배리어폭 이 작은 표본을 더 무겁게 본다.
    #   (도착점만 보는 라벨로는 이 구분이 불가능하다. 그래서 워커가 mae 를 실어 보내게 했다)
    try:
        if MAEs is not None:
            _mtr = MAEs[:-nval][tr_mask]
            _q = np.clip(_mtr, 0.0, 1.5)
            Wpath = 1.0 + 0.6 * (1.0 - np.clip(_q, 0.0, 1.0))    # 역행 0 → ×1.6, 역행=배리어폭 → ×1.0
            Wtr = Wtr * Wpath
            print(f"   경로 품질 가중 — 역행/배리어폭 중앙 {np.median(_mtr):.3f} · 평균가중 {Wpath.mean():.3f}")
        else:
            print("   경로 품질 가중 생략 — 워커가 아직 mae 를 안 내려준다(구버전)")
    except Exception as e:
        print(f"   경로 품질 가중 생략: {e}")

    import lightgbm as lgb
    # 피처가 65 → 77 로 늘고 정보량이 실제로 커졌으므로 용량도 함께 키운다(과적합은 조기중단으로 통제).
    ltr = lgb.Dataset(Xtr, label=Ytr, weight=Wtr)
    lva = lgb.Dataset(Xva, label=Yva, reference=ltr)
    bst = lgb.train({"objective": "binary", "max_depth": 5, "num_leaves": 31,
                     "learning_rate": 0.04, "min_data_in_leaf": 30, "verbose": -1,
                     "feature_fraction": 0.75, "bagging_fraction": 0.8, "bagging_freq": 1,
                     "lambda_l2": 1.0},
                    ltr, num_boost_round=700, valid_sets=[lva],
                    callbacks=[lgb.early_stopping(80, verbose=False)])
    best = bst.best_iteration or 700

    # 무엇을 배웠는지 사람이 확인할 수 있게 상위 피처를 남긴다(장중 피처가 실제로 쓰이는지 검증).
    try:
        gains = bst.feature_importance(importance_type="gain", iteration=best)
        names = [f"f{i}" for i in range(D)]
        for k, nm in enumerate(ifeatnames or []):
            if D - ifeatn + k < D:
                names[D - ifeatn + k] = nm
        top = sorted(zip(names, gains), key=lambda t: -t[1])[:10]
        tot = float(sum(gains)) or 1.0
        print("   상위 피처: " + ", ".join(f"{n}({g/tot*100:.1f}%)" for n, g in top))
    except Exception as e:
        print(f"   피처 중요도 산출 실패: {e}")

    def _plgb(n):
        if "leaf_value" in n:
            return {"w": float(n["leaf_value"])}
        return {"f": int(n["split_feature"]), "t": float(n["threshold"]),
                "l": _plgb(n["left_child"]), "r": _plgb(n["right_child"])}
    trees = [_plgb(ti["tree_structure"]) for ti in bst.dump_model(num_iteration=best)["tree_info"]]

    # 워커 채점(mlGBDTScore)과 맞추기 위한 base 보정 — 라이브러리 margin 과 트리합의 차이를 상수로 흡수.
    def _wout(node, x):
        while "w" not in node:
            node = node["l"] if x[node["f"]] < node["t"] else node["r"]
        return node["w"]
    ref = Xva[:200]
    margin = bst.predict(ref, num_iteration=best, raw_score=True)
    wsum = np.array([sum(_wout(t, x) for t in trees) for x in ref])
    base = float((margin - wsum).mean())

    proba = bst.predict(Xva, num_iteration=best)
    acc = float(((proba >= 0.5).astype(int) == Yva).mean())
    # [V33.115] 하한은 ★유효표본수★ 로 잰다. 5분봉 검증 3,000건은 60분 지평 라벨이 겹쳐
    #   실제로는 그보다 훨씬 적은 독립 증거다 — 명목 n 으로 재던 하한은 그만큼 낙관적이었다.
    z = 1.64; n = len(Yva); _neff = _neff_of(UWva); z2 = z * z
    _nb = float(_neff)
    lb = max(0.0, ((acc + z2 / (2 * _nb)) - z * math.sqrt((acc * (1 - acc) + z2 / (4 * _nb)) / _nb)) / (1 + z2 / _nb))
    # [V33.97] ★단타 모델도 IC 를 보낸다★
    #   워커의 단타 신뢰 게이트는 종전에 정확도 하한 하나뿐이었다. Wilson 하한 특성상
    #   검증 2,000건이면 원시 정확도 55.3% 를 요구하는데, 60분 지평 배리어 라벨에서 그건
    #   사실상 불가능하다 — 그래서 학습이 성공해도 영원히 신뢰되지 않았다.
    #   GBDT 와 같은 IC 경로를 열어주려면 IC 와 그 유의성(블록 IC + t)을 함께 보내야 한다.
    _sic, _sric = _calc_ic(proba, Yva)
    print(f"   valAcc {acc:.4f} (하한 {lb:.4f}, 유효 n={_neff}/{n}) IC {_sic:.4f} RankIC {_sric:.4f} / 트리 {len(trees)}")

    # 변환정합 probe — 워커가 같은 확률을 재현하는지 검증(스윙과 동일한 안전장치)
    pi = np.linspace(0, len(Xva) - 1, min(200, len(Xva))).astype(int)
    probe = [{"x": Xva[i].tolist(), "p": float(proba[i])} for i in pi]

    model = {"featVer": featver, "ifeatVer": (ifeatver or 0),
             "trees": trees, "base": base, "lr": 1.0,
             "valAcc": round(acc, 4), "valAccLB": round(lb, 4), "valN": int(n), "n": int(N),
             "posRate": round(pos_rate, 4), "horizonBars": 12, "probe": probe,
             "valIC": round(_sic, 5), "valRankIC": round(_sric, 5)}
    # [V33.377] ★이 줄은 실행되는 순간 죽었다 — 두 군데가 틀렸다.★
    #   ① `_vai` 는 이 함수에 ★없다.★ 단타 분할은 `Xs[-nval:]` 슬라이스라 그런 이름이 없다
    #      (스윙 학습기들의 `_split_ts` 반환값 이름을 그대로 베껴 온 자리다).
    #      → `NameError: name '_vai' is not defined` 로 단타 업로드가 통째로 날아간다.
    #   ② 지평도 틀렸다. `_HORIZON_MS` 는 ★스윙의 10일★ 이고 단타 라벨은 ★60분★ 이다
    #      (바로 위 `horizon_ms`). 10일로 블록을 자르면 단타 홀드아웃(수일)에는 블록이
    #      한 개도 안 들어가 IC 유의성이 아예 산출되지 않는다.
    #   ★왜 몇 달을 몰랐나★ — 단타 단계가 예산에 밀려 ★한 번도 안 돌았다★(V33.377 굶주림).
    #   즉 굶주림을 고치는 순간 이 줄이 터진다. 같이 고친다.
    model.update(_ic_block_fields(proba, Yva, mkt=_mkt_of_X(Xva),
                                  ts=TSs[-nval:], horizon_ms=horizon_ms))   # [V33.291 · V33.366 · V33.377]
    model.update(_uniq_fields(UWva))
    if "valICt" in model:
        print(f"   blockIC {model['valICBlock']:.4f} t {model['valICt']:.2f} (유의성 게이트용)")
    for attempt in range(4):
        try:
            r = requests.post(BASE + "/api/scalp-import", params={"key": KEY},
                              headers=HDR, data=json.dumps(model), timeout=180)
            if r.status_code == 200:
                print("   단타모델 업로드 OK:", json.dumps(r.json(), ensure_ascii=False)); return
            b = r.text[:200]
            if r.status_code >= 500 and (("D1" in b) or ("overloaded" in b) or ("queued" in b)) and attempt < 3:
                print(f"   D1 과부하 재시도 {attempt+1}"); time.sleep(30); continue
            print("   단타모델 업로드 실패:", r.status_code, b); return
        except requests.exceptions.ReadTimeout:
            if attempt < 3: time.sleep(20); continue
    print("   단타모델 업로드 타임아웃")


@app.local_entrypoint()
def main(target: str = "all", depth_sweep: bool = False, sweep_seeds: int = 2):
    # `modal run modal_train.py` — 지금 즉시 1회 학습(스케줄과 별개)
    train_job.remote(target=target, depth_sweep=depth_sweep, sweep_seeds=sweep_seeds)
