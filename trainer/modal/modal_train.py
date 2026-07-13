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
CRON = modal.Cron("10 6,18 * * *")  # 12시간마다: 06:10 + 18:10 UTC (하루 2회 학습)

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
        while True:
            r = requests.get(BASE + "/api/ml-export",
                             params={"key": KEY, "limit": page, "offset": off},
                             headers=HDR, timeout=120)
            if r.status_code != 200:
                raise RuntimeError(f"export {r.status_code}: {r.text[:200]}")
            j = r.json()
            cfg, fv, fn = j["config"], j["featVer"], j["featNames"]
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
        acc = ((torch.sigmoid(zsum / len(nets)) >= 0.5).float() == Yva).float().mean().item()
    lb = wilson_lb(acc, len(va))
    print(f"③ 앙상블 valAcc {acc*100:.2f}% (Wilson하한 {lb*100:.2f}%, n={len(va)})")

    js_nets = []
    for net in nets:
        Wl, bl = [], []
        for lin in net.lins:
            Wl.append(np.round(lin.weight.detach().cpu().numpy(), 4).tolist())
            bl.append(np.round(lin.bias.detach().cpu().numpy(), 4).tolist())
        js_nets.append({"W": Wl, "b": bl, "dims": dims})

    payload = {"featVer": featver, "nets": js_nets, "mean": mean.tolist(), "std": std.tolist(),
               "dims": dims, "valAcc": round(acc, 4), "valAccLB": round(lb, 4), "valN": len(va), "n": N}

    if dry:
        print("--dry: 업로드 생략"); return {"ok": True, "valAcc": acc, "uploaded": False}

    print("④ 업로드")
    r = requests.post(BASE + "/api/dnn-import", params={"key": KEY}, headers=HDR,
                      data=json.dumps(payload), timeout=300)
    if r.status_code != 200:
        raise RuntimeError(f"import {r.status_code}: {r.text[:300]}")
    res = r.json()
    print("✅", json.dumps(res.get("trust", {}), ensure_ascii=False), res.get("note", ""))
    return {"ok": True, "valAcc": acc, "trust": res.get("trust")}


@app.local_entrypoint()
def main():
    # `modal run modal_train.py` — 지금 즉시 1회 학습(스케줄과 별개)
    train_job.remote()
