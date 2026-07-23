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
    "torch", "numpy", "requests"
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
        while True:
            params = {"key": KEY, "limit": page, "offset": off}
            if anchor:
                params["beforeTs"] = anchor
            r = requests.get(BASE + "/api/ml-export", params=params, headers=HDR, timeout=180)
            if r.status_code != 200:
                raise RuntimeError(f"export {r.status_code}: {r.text[:200]}")
            j = r.json()
            cfg, fv, fn = j["config"], j["featVer"], j["featNames"]
            anchor = j.get("anchorTs") or anchor
            got = j.get("samples", [])
            samples.extend(got)
            total = j.get("total", len(samples))
            print(f"  내려받음 {len(samples)}/{total}")
            off += len(got)
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
    Y = np.array([1.0 if s["y"] else 0.0 for s in samples], dtype=np.float64)
    PNL = np.array([s.get("pnl", 0.0) for s in samples], dtype=np.float64)
    HV = np.array([1.0 if s.get("hv") else 0.0 for s in samples], dtype=np.float64)
    TS = np.array([s.get("ts", 0) for s in samples], dtype=np.float64)
    now = float(TS.max()) if N else time.time() * 1000

    mean = X.mean(axis=0); std = X.std(axis=0); std[std < 1e-6] = 1.0
    Xn = np.clip((X - mean) / std, -std_clip, std_clip)
    absp = np.abs(PNL); pnl_scale = np.median(absp) if len(absp) else 1.0
    pnl_scale = pnl_scale if pnl_scale > 1e-6 else 1.0
    days = np.maximum(0.0, (now - TS) / 86400000.0)
    recency = np.maximum(rec_floor, np.power(0.5, days / hl_days))
    mw = np.clip(absp / pnl_scale, 0.3, 3.0) * np.where(HV > 0, hv_w, 1.0) * recency

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

    class MLP(nn.Module):
        def __init__(self):
            super().__init__()
            self.lins = nn.ModuleList([nn.Linear(dims[l], dims[l + 1]) for l in range(len(dims) - 1)])
            for lin in self.lins:
                nn.init.kaiming_normal_(lin.weight, nonlinearity="relu"); nn.init.zeros_(lin.bias)
        def forward(self, x, train=True):
            n = len(self.lins)
            for i, lin in enumerate(self.lins):
                x = lin(x)
                if i < n - 1:
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
    lb = wilson_lb(acc, n_eval)
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

    js_nets = []
    for net in nets:
        Wl, bl = [], []
        for lin in net.lins:
            Wl.append(np.round(lin.weight.detach().cpu().numpy(), 4).tolist())
            bl.append(np.round(lin.bias.detach().cpu().numpy(), 4).tolist())
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
    _post({"key": KEY, "stage": "begin"},
          {"featVer": featver, "mean": mean.tolist(), "std": std.tolist(), "dims": dims,
           "seeds": len(js_nets), "valAcc": round(acc, 4), "valAccLB": round(lb, 4), "valN": n_eval, "n": N},
          "begin", retries=3)
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
            _train_and_upload_gbdt(BASE, KEY, HDR, X, Y, TS, featver, D)
        except Exception as e:
            print("GBDT 학습/업로드 예외(무시):", e)
    return {"ok": True, "valAcc": acc, "trust": res.get("trust")}


# ============================================================================
# [V32.7] GBDT 외부학습(섀도우) — Worker GBDT와 동일한 트리 포맷/추론식으로 학습해 /api/gbdt-import 로
#   업로드한다. Worker 추론: raw = bias + Σ eta·leaf, x[f] < t → left, score = sigmoid(raw),
#   leaf w = -G/(H+λ). 여기선 그 포맷을 그대로 산출한다(독립 모델 — Worker가 채점만 하면 됨).
#   기본 업로드는 섀도우(비활성) — Worker가 자체 표본으로 self-검증 후 수동 승격(?activate=1).
# ============================================================================
def _train_and_upload_gbdt(BASE, KEY, HDR, X, Y, TS, featver, D):
    import numpy as np, math, json, time, requests
    # [V32.9] GBDT 강화: 학습률↓+트리↑(저LR·다트리=일반화 향상, 표준 부스팅 정석) + 행/열 서브샘플
    #   (stochastic GBDT — 과적합↓·일반화↑). 표(tabular) 금융데이터엔 딥넷보다 GBDT가 보통 강함.
    ETA, MAXDEPTH, LAM, GAMMA, MINCHILD = 0.04, 4, 1.0, 0.1, 5.0
    MAXBINS, MAXTREES, PATIENCE, VALFRAC = 64, 400, 30, 0.2
    SUBSAMPLE, COLSAMPLE = 0.8, 0.8
    rng = np.random.default_rng(12345)
    N = len(Y)
    if N < 400:
        print(f"GBDT: 표본 부족 {N} — 생략"); return
    order = np.argsort(TS)
    Xs = X[order].astype(np.float64); Ys = Y[order].astype(np.float64)
    nval = max(200, int(N * VALFRAC))
    Xtr, Ytr, Xva, Yva = Xs[:-nval], Ys[:-nval], Xs[-nval:], Ys[-nval:]
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
    z = 1.96; nn = float(nval); ph = vacc; denom = 1 + z * z / nn
    center = (ph + z * z / (2 * nn)) / denom
    half = (z * math.sqrt(ph * (1 - ph) / nn + z * z / (4 * nn * nn))) / denom
    vlb = max(0.0, center - half)
    model = {"trees": trees, "eta": ETA, "bias": float(bias), "valAcc": round(vacc, 4),
             "valAccLB": round(vlb, 4), "valN": int(nval), "n": int(N), "featVer": featver}
    print(f"GBDT: trees={len(trees)} valAcc={vacc:.3f} lb={vlb:.3f} → 업로드(섀도우)")
    for attempt in range(4):
        try:
            r = requests.post(BASE + "/api/gbdt-import", params={"key": KEY}, headers=HDR,
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


@app.local_entrypoint()
def main():
    # `modal run modal_train.py` — 지금 즉시 1회 학습(스케줄과 별개)
    train_job.remote()
