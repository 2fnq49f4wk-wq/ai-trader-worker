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


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("lux-dnn")],  # BASE_URL, TRAIN_KEY
    schedule=CRON,
    timeout=3600,
    gpu="T4",  # GPU 가속(20분→~2분). 12h마다 2분이라 월 크레딧 $1 수준(무료 $30 내).
)
def train_job(epochs: int = EPOCHS_DEFAULT, dry: bool = False):
    import os, json, math, time
    import numpy as np
    import requests
    import torch
    import torch.nn as nn

    BASE = os.environ["BASE_URL"].rstrip("/")
    KEY = os.environ["TRAIN_KEY"]
    HDR = {"x-train-key": KEY}

    # ── 1) 표본 내려받기 ──
    def fetch_all():
        off, page, samples, cfg, fv, fn = 0, 20000, [], None, None, None
        anchor = 0  # [V11.1] 스냅샷 앵커 — 수집 중 신규 수확행이 OFFSET을 밀어 중복/누락되는 것 방지
        cur_ts = cur_id = 0   # [V33.12] 커서 페이지네이션 — OFFSET 누적 스캔(표본^2) 제거
        while True:
            params = {"key": KEY, "limit": page}
            if cur_ts:
                params["cursorTs"], params["cursorId"] = cur_ts, cur_id
            else:
                params["offset"] = off
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
            cfg, fv, fn = j["config"], j["featVer"], j["featNames"]
            anchor = j.get("anchorTs") or anchor
            got = j.get("samples", [])
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
    hl_days = cfg.get("recencyHalfLifeDays", 45); rec_floor = cfg.get("recencyFloor", 0.35)

    # [V32.10 성능강화·적응형 정규화] ★모델 축소 없이 과적합 방지★ 노이즈 큰 금융 tabular에선 3M망이
    #   쉽게 과적합한다. 모델 크기는 유지(사용자 방침)하되 규제를 전반적으로 강화 — 특히 데이터가 많아도
    #   가벼운 규제로 내려가지 않게(종전 dropout 0.42는 너무 약했음). 규제↑ + 정제된 피처(65종) +
    #   데이터↑ 조합으로 큰 모델을 유지하면서 일반화를 지킨다.
    Nall = len([s for s in samples if isinstance(s.get("x"), list) and len(s["x"]) == D])
    if Nall < 60000:      dropout, l2, mixup_p, input_noise = 0.62, 5e-3, 0.35, 0.12   # 데이터 기근 → 매우 강한 규제
    elif Nall < 150000:   dropout, l2, mixup_p, input_noise = 0.55, 3e-3, 0.30, 0.10   # 중간 → 강한 규제
    else:                 dropout, l2, mixup_p, input_noise = 0.50, 1.5e-3, 0.25, 0.08  # 데이터 충분해도 규제 유지(과적합 방지)
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
    X = np.array([s["x"] for s in samples], dtype=np.float64)
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
    UNIQ = _uniq_weights(TS, SYM, _hor_d * 86400000.0)
    print(f"   표본 고유도: 평균 {UNIQ.mean():.3f} · 유효 {UNIQ.sum():.0f}/{N} (라벨지평 {_hor_d:.0f}일)")
    mw = np.clip(absp / pnl_scale, 0.3, 3.0) * np.where(HV > 0, hv_w, 1.0) * recency * UNIQ

    n_val = max(20, int(N * val_frac))
    cut_ts = TS[N - n_val] - embargo_ms
    idx = np.arange(N)
    tr_mask = (idx < N - n_val) & (TS < cut_ts)
    if tr_mask.sum() < 60:
        tr_mask = idx < N - n_val
    tr = idx[tr_mask]; va = idx[N - n_val:]
    pos = Y[tr].sum()
    w_pos = len(tr) / (2 * pos) if pos > 0 else 1.0
    w_neg = len(tr) / (2 * (len(tr) - pos)) if (len(tr) - pos) > 0 else 1.0

    Xtr = torch.tensor(Xn[tr], dtype=torch.float32, device=dev)
    Ytr = torch.tensor(Y[tr], dtype=torch.float32, device=dev)
    Mtr = torch.tensor(mw[tr], dtype=torch.float32, device=dev)
    Xva = torch.tensor(Xn[va], dtype=torch.float32, device=dev)
    Yva = torch.tensor(Y[va], dtype=torch.float32, device=dev)

    # [V32.11] ★모델 축소 없이 강화 — BatchNorm★ 12층 평면 MLP는 정규화가 없어 깊이가 학습에 안 먹혔다
    #   (심층 degradation·기울기 불안정 → valAcc 정체의 구조적 원인). 각 은닉층에 BatchNorm을 넣어 깊은
    #   망이 '실제로' 학습되게 한다(용량 유지, 오히려 표현력 개방). 추론은 BN을 앞 선형층에 접어(fold)
    #   내보내므로 Worker의 평면 relu(Wx+b) 추론이 그대로 동일 결과를 낸다(추론측 변경 0).
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
    for sd in range(K):
        t0 = time.time(); nets.append(one_seed(1000 + sd * 7))
        print(f"  시드 {sd+1}/{K} ({time.time()-t0:.1f}s)")

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
        order = np.argsort(ps); ranks = np.empty_like(order, dtype=np.float64); ranks[order] = np.arange(1, len(ps) + 1)
        npos = ys.sum(); nneg = len(ys) - npos
        auc = float((ranks[ys > 0.5].sum() - npos * (npos + 1) / 2) / (npos * nneg)) if npos > 0 and nneg > 0 else 0.5

    # ── [V12.33 임계값 캘리브레이션] 31%형 겉보기 붕괴 수정 ──
    #   원인: 균형가중 학습 + 검증 라벨 쏠림 상황에서 고정 0.5 컷은 다수클래스보다 못한 정확도로 붕괴.
    #   해법: 검증 앞 절반(캘리브레이션)에서 균형정확도 최대 임계값 τ*를 찾아 각 시드망 마지막 층
    #   bias에 -logit(τ*)로 굽는다 → Worker의 0.5 기준 추론이 그대로 캘리브레이션 반영.
    #   정확도는 τ* 선택에 쓰지 않은 '뒤 절반'에서 산출(정직한 홀드아웃).
    half = max(20, len(ps) // 2)
    if len(ps) - half >= 20:
        ps_c, ys_c = ps[:half], ys[:half]
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
        print(f"   캘리브레이션: τ*={tau:.3f} (logit 시프트 {delta:+.3f}) — 검증 전반 {half}건으로 선택, 후반 {n_eval}건으로 평가")
    else:
        acc = float(((ps >= 0.5) == (ys > 0.5)).mean()); n_eval = len(ps)
    # [V33.115] ★Wilson 하한을 유효표본수로 잰다★
    #   n_eval 은 ★명목★ 이다. 10일 지평 라벨은 같은 종목에서 겹치므로 독립 관측이 아니고,
    #   명목 n 으로 재면 하한이 실제보다 좁게(=낙관적으로) 나온다. 겹침의 역수를 합한
    #   유효표본수로 재야 "정확도 하한 X% 이상" 이라는 승격 게이트가 제 뜻을 가진다.
    _dnn_uw = UNIQ[va[len(va) - n_eval:]]
    _dnn_neff = max(8, int(round(float(_dnn_uw.sum()))))
    lb = wilson_lb(acc, _dnn_neff)
    if _dnn_neff < n_eval:
        print(f"   유효표본 {_dnn_neff}/{n_eval} (평균 고유도 {_dnn_uw.mean():.3f}) — 하한을 유효표본으로 산출 {lb:.4f}")
    # [V32.9] ★과적합 진단★ 학습셋 정확도를 검증셋과 비교 — 격차가 크면 과적합(→데이터·규제 필요),
    #   격차가 작고 둘 다 낮으면 신호/피처 한계(→피처 품질·라벨 개선 필요). 캘리브레이션 반영 후 평가.
    try:
        with torch.no_grad():
            ztr = torch.zeros(Xtr.shape[0], device=dev)
            for net in nets:
                net.eval(); ztr += net(Xtr, False).squeeze(-1)
            ptr = torch.sigmoid(ztr / len(nets)).cpu().numpy()
            ytr_np = Ytr.cpu().numpy()
        train_acc = float(((ptr >= 0.5) == (ytr_np > 0.5)).mean())
        gap = train_acc - acc
        verdict = "과적합 경향(→표본·종류·규제↑ 필요)" if gap > 0.05 else "과적합 낮음(→신호·피처·라벨 품질이 병목)"
        print(f"   [과적합진단] train {train_acc*100:.2f}% vs val {acc*100:.2f}% → 격차 {gap*100:+.2f}%p — {verdict}")
    except Exception as _e:
        print("   [과적합진단] train acc 계산 실패:", _e)
    print(f"③ 앙상블 valAcc {acc*100:.2f}% (Wilson하한 {lb*100:.2f}%, n={n_eval})")
    print(f"   진단: 기저율(양성비율) {base*100:.1f}% | 다수클래스 베이스라인 {majority*100:.1f}% | AUC {auc:.3f}")
    if acc < majority - 0.02:
        print("   ⚠️ 정확도가 '전부 다수클래스 찍기'보다 낮음 — 분포이동(최근 시장≠과거 패턴) 또는 과적합 신호")
    if auc < 0.52:
        print("   ⚠️ AUC<0.52 — 현재 피처만으론 판별력 자체가 약함. 데이터 축적/피처 확장이 근본 해법")

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
        print("--dry: 업로드 생략"); return {"ok": True, "valAcc": acc, "uploaded": False}

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
    try:
        _dnn_meta.update(_uniq_fields(_dnn_uw))
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
    # [V32.7] GBDT도 외부학습해 섀도우 업로드(같은 표본 재사용 — 추가 export 부하 0). 실패해도 DNN 결과엔 무영향.
    if not dry:
        print("⑤ GBDT 외부학습(섀도우)")
        try:
            _train_and_upload_gbdt(BASE, KEY, HDR, X, Y, TS, featver, D, UNIQ)
        except Exception as e:
            print("GBDT 학습/업로드 예외(무시):", e)
        print("⑥ 부스팅 3종(XGB·LGB·CatBoost) 외부학습(섀도우)")
        try:
            _train_and_upload_boosters(BASE, KEY, HDR, X, Y, TS, featver, D, PNL, UNIQ)
        except Exception as e:
            print("부스팅 학습/업로드 예외(무시):", e)
        # [V33.76] ★미국장·한국장 분리학습★ (사용자 지시)
        #   종전엔 두 시장 표본을 한 모델에 뭉쳐 학습했다. 피처에 mktUS/mktKR 원핫이 있긴 하나
        #   depth4 얕은 트리가 65개 피처 위에서 시장별 상호작용을 잡아내기는 사실상 불가능하다.
        #   두 시장은 거래시간·상하한가·세금·투자자구성·변동성 구조가 전부 다르므로 조건부가 아니라
        #   아예 별도 모델이 맞다. 표본이 충분한 시장만 전용 모델을 올리고, 부족하면 통합 모델을
        #   그대로 쓴다(워커가 <이름>_<시장> → <이름> 순으로 폴백).
        try:
            _train_per_market(BASE, KEY, HDR, MKT, X, Y, TS, PNL, featver, D, UNIQ)
        except Exception as e:
            print("시장별 분리학습 예외(무시):", e)
        print("⑦ MIND(FM) 외부학습 — 위원장 모델 GPU 완전수렴")
        try:
            _train_and_upload_fm(BASE, KEY, HDR, X, Y, TS, PNL, featver, D, UNIQ)
        except Exception as e:
            print("FM(MIND) 학습/업로드 예외(무시):", e)
        # [V33.41] 장중 단타 모델 — 표본 소스·라벨 지평·업로드 슬롯이 전부 위원회와 분리돼 있어
        #   여기서 실패해도 위 스윙 모델들에는 영향이 없다(그래서 맨 마지막에, 예외도 삼킨다).
        try:
            _train_and_upload_scalp(BASE, KEY, HDR, featver)
        except Exception as e:
            print("단타 학습/업로드 예외(무시):", e)
    return {"ok": True, "valAcc": acc, "trust": res.get("trust")}


# ============================================================================
# [V32.7] GBDT 외부학습(섀도우) — Worker GBDT와 동일한 트리 포맷/추론식으로 학습해 /api/gbdt-import 로
#   업로드한다. Worker 추론: raw = bias + Σ eta·leaf, x[f] < t → left, score = sigmoid(raw),
#   leaf w = -G/(H+λ). 여기선 그 포맷을 그대로 산출한다(독립 모델 — Worker가 채점만 하면 됨).
#   기본 업로드는 섀도우(비활성) — Worker가 자체 표본으로 self-검증 후 수동 승격(?activate=1).
# ============================================================================
def _train_and_upload_gbdt(BASE, KEY, HDR, X, Y, TS, featver, D, UNIQ=None):
    import numpy as np, math, json, time, requests
    # [V32.9] GBDT 강화: 학습률↓+트리↑(저LR·다트리=일반화 향상, 표준 부스팅 정석) + 행/열 서브샘플
    #   (stochastic GBDT — 과적합↓·일반화↑). 표(tabular) 금융데이터엔 딥넷보다 GBDT가 보통 강함.
    # [V32.66] 부스터 강화: 학습률↓(0.04→0.03)·트리↑(400→600)·patience↑(30→50)
    #   저LR·다트리·조기중단 = 더 세밀한 그래디언트로 일반화↑(과적합은 early-stop+홀드아웃 게이트가 방어).
    ETA, MAXDEPTH, LAM, GAMMA, MINCHILD = 0.03, 4, 1.0, 0.1, 5.0
    MAXBINS, MAXTREES, PATIENCE, VALFRAC = 64, 600, 50, 0.2
    SUBSAMPLE, COLSAMPLE = 0.8, 0.8
    rng = np.random.default_rng(12345)
    N = len(Y)
    if N < 400:
        print(f"GBDT: 표본 부족 {N} — 생략"); return
    order = np.argsort(TS)
    Xs = X[order].astype(np.float64); Ys = Y[order].astype(np.float64)
    nval = max(200, int(N * VALFRAC))
    Xtr, Ytr, Xva, Yva = Xs[:-nval], Ys[:-nval], Xs[-nval:], Ys[-nval:]
    # [V33.115] 검증구간 고유도 — 정렬 후 뒤 nval 개의 ★원본 인덱스★ 로 뽑아야 한다.
    UWva = _uw_pick(UNIQ, N, order[-nval:])
    Ntr = len(Ytr)
    if Ntr < 200:
        print("GBDT: train 부족 — 생략"); return
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
    print(f"GBDT: trees={len(trees)} valAcc={vacc:.3f} lb={vlb:.3f} (유효 {_neff}/{nval}) → 업로드(activate)")
    for attempt in range(4):
        try:
            # [V32.15] activate=1 — sane(변환정합)+trustFloor 통과 시 라이브 승격(DNN과 동일 정책).
            r = requests.post(BASE + "/api/gbdt-import", params={"key": KEY, "activate": "1"}, headers=HDR,
                              data=json.dumps(model), timeout=180)
            if r.status_code == 200:
                print("GBDT 업로드 OK:", json.dumps(r.json(), ensure_ascii=False)); return
            b = r.text[:300]
            if r.status_code >= 500 and (("D1" in b) or ("overloaded" in b) or ("queued" in b)) and attempt < 3:
                print(f"GBDT 업로드 D1 과부하 — 30s 후 재시도 {attempt+1}/3"); time.sleep(30); continue
            print("GBDT 업로드 실패:", r.status_code, b); return
        except requests.exceptions.ReadTimeout:
            if attempt < 3:
                print(f"GBDT 업로드 타임아웃 — 20s 후 재시도 {attempt+1}/3"); time.sleep(20); continue
    print("GBDT 업로드 최종 실패")


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


def _neff_of(w):
    import numpy as np
    try:
        return max(8, int(round(float(np.asarray(w, dtype=np.float64).sum()))))
    except Exception:
        return 8


def _calc_ic_blocks(pred, y, K=5):
    import numpy as np
    try:
        p = np.asarray(pred, dtype=np.float64); t = np.asarray(y, dtype=np.float64)
        n = min(len(p), len(t))
        bs = n // max(2, int(K))
        if bs < 20: return None, None, None, 0
        ics = []
        for k in range(int(K)):
            a = p[k * bs:(k + 1) * bs]; b = t[k * bs:(k + 1) * bs]
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


def _ic_block_fields(pred, y, K=5):
    """모델 dict 에 그대로 합칠 블록 IC 필드."""
    bic, icir, tv, k = _calc_ic_blocks(pred, y, K)
    if bic is None: return {}
    return {"valICBlock": round(bic, 5), "valICIR": round(icir, 3),
            "valICt": round(tv, 3), "valICK": int(k)}


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
        order = np.argsort(TSm)
        Xs, Ys = Xm[order].astype(np.float64), Ym[order].astype(int)
        nval = max(200, int(n * 0.2))
        Xtr, Ytr, Xva, Yva = Xs[:-nval], Ys[:-nval], Xs[-nval:], Ys[-nval:]
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
            Wtr = W[:-nval]

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
        model.update(_ic_block_fields(pva, Yva))
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


def _train_and_upload_boosters(BASE, KEY, HDR, X, Y, TS, featver, D, PNL=None, UNIQ=None):
    import numpy as np, math, json, time, requests, tempfile, os

    N = len(Y)
    if N < 500:
        print(f"부스팅: 표본 부족 {N} — 생략"); return
    order = np.argsort(TS)
    Xs = X[order].astype(np.float64); Ys = Y[order].astype(int)
    nval = max(200, int(N * 0.2))
    Xtr, Ytr, Xva, Yva = Xs[:-nval], Ys[:-nval], Xs[-nval:], Ys[-nval:]
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
            Wtr, Wva = W[:-nval], W[-nval:]
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
        model.update(_ic_block_fields(proba_lib, Yva))
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
    order = np.argsort(TS)
    Xs = X[order].astype(np.float64); Ys = Y[order].astype(np.float64)
    Ps = np.abs(PNL[order].astype(np.float64))
    nval = max(60, int(N * 0.2))
    # [V33.115] ★표준화 누출 수정★ — 종전엔 평균·표준편차를 검증분 포함 전체로 잡았다.
    #   MIND 는 이 mean/std 를 그대로 업로드해 워커 추론에 쓰므로, 검증분포가 스며들면
    #   검증성적이 부풀 뿐 아니라 그 편향이 라이브 추론까지 따라간다. 학습구간만으로 잡는다.
    #   (train_job·_miniLogisticTrain 에서 잡은 것과 같은 실수 — 세 곳이 같았다)
    mean = Xs[:-nval].mean(axis=0); std = Xs[:-nval].std(axis=0); std[std < 1e-6] = 1.0
    Z = (Xs - mean) / std
    Z = np.clip(Z, -6, 6)
    Ztr, Ytr = Z[:-nval], Ys[:-nval]; Zva, Yva = Z[-nval:], Ys[-nval:]
    UWva = _uw_pick(UNIQ, N, order[-nval:])     # [V33.115] 검증구간 고유도
    # 표본가중: |pnl| 중앙값 정규화(0.3~3.0) × 균형 클래스가중
    pscale = np.median(Ps[:-nval]) if np.median(Ps[:-nval]) > 1e-6 else 1.0
    mw = np.clip(Ps[:-nval] / pscale, 0.3, 3.0)
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

    # 멀티시드 — 검증 앞절반 균형정확도로 최고 선택(뒤절반은 정직측정 보존)
    selN = max(20, nval // 2)
    best = None; best_bal = -1
    for s in range(SEEDS):
        w, V, b = train_one(s)
        praw = fm_raw(Zva[:selN], w, V, b); up = sigmoid(praw) >= 0.5
        yv = Yva[:selN] > 0.5
        tp = np.sum(up & yv); fn = np.sum(~up & yv); tn = np.sum(~up & ~yv); fp = np.sum(up & ~yv)
        bal = 0.5 * ((tp / max(1, tp + fn)) + (tn / max(1, tn + fp)))
        if bal > best_bal: best_bal = bal; best = (w, V, b)
    w, V, b = best
    # τ* 캘리브레이션 — 앞절반에서 정확도 최대 임계를 b에 구움(0.5컷 정합)
    fps = sigmoid(fm_raw(Zva[:selN], w, V, b)); fsort = np.sort(fps)
    bt, bs = 0.5, -1
    for q in range(2, 37):
        tau = fsort[int((q / 38) * (len(fsort) - 1))]
        acc = np.mean((fps >= tau).astype(int) == (Yva[:selN] > 0.5).astype(int))
        if acc > bs: bs = acc; bt = tau
    bt = min(max(bt, 1e-4), 1 - 1e-4)
    b -= math.log(bt / (1 - bt))
    # 뒤절반 정직 홀드아웃 정확도 + Wilson 하한
    hold = slice(selN, nval)
    ph = sigmoid(fm_raw(Zva[hold], w, V, b))
    yh = Yva[hold] > 0.5
    vacc = float(np.mean((ph >= 0.5) == yh)); nh = int(nval - selN)
    # [V33.115] 하한은 유효표본수로 — 홀드아웃(뒤절반)에 해당하는 고유도만 쓴다.
    _uwh = UWva[selN:nval]
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
          + (f" (중복 {dup_drop}건 제외)" if dup_drop else "")
          + (f" / 장중피처 v{ifeatver}×{ifeatn}" if ifeatver else " / 장중피처 없음"))
    # [V33.98] 워커의 신뢰 문턱이 n>=3000 이다. 1500 에서 학습해 올리면 서버가 무조건
    #   "표본 부족" 으로 거부한다 — 학습 성공 → 신뢰 거부 churn 만 생긴다. 문턱을 맞춘다.
    if N < 3000:
        print(f"   표본 부족({N}/3000) — 생략. 더 쌓이면 자동으로 학습된다."); return

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
    model.update(_ic_block_fields(proba, Yva))
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
def main():
    # `modal run modal_train.py` — 지금 즉시 1회 학습(스케줄과 별개)
    train_job.remote()
