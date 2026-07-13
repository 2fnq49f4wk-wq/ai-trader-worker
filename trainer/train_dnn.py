#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LUX-DNN 외부 GPU/CPU 학습기 (3M 파라미터)
──────────────────────────────────────────────────────────────────────────
Cloudflare Worker(순수 JS, CPU 300s)로는 3M 딥넷 완전학습이 불가능하므로,
이 스크립트가 사용자 PC의 GPU(또는 CPU / Google Colab)에서 완전학습한 뒤
가중치를 Worker로 업로드한다. Worker는 추론·저장만 담당.

동작:
  1) GET  {BASE}/api/ml-export   → 학습표본 + 하이퍼파라미터 내려받기
  2) 로컬에서 PyTorch로 K개 시드 앙상블 완전학습 (GPU 자동 사용)
  3) POST {BASE}/api/dnn-import  → 학습된 가중치 업로드 (신뢰게이트 자동 평가)

Worker의 src/index.js 학습 로직(_dnnTrainOne / mlDNNTrainNightly)을 충실히 복제:
  표준화(±stdClip 윈저화) · 클래스가중 · 표본가중(pnl·hv·시간감쇠) · 라벨스무딩 ·
  입력노이즈 · Mixup · Dropout · AdamW · 코사인 LR · 시드 앙상블(로짓평균) · Wilson 하한 ·
  엠바고 홀드아웃 분할. → 업로드 후 Worker 추론과 동일 분포.

사용법:
  pip install torch numpy requests
  python train_dnn.py --base https://ai-trader-app.<계정>.workers.dev --key <TRAIN_KEY>

옵션:
  --epochs N     (기본: 서버 config, 없으면 120) — GPU면 크게 잡아도 됨
  --seeds  K     (기본: 서버 config seeds=4)
  --cpu          GPU 무시하고 CPU 강제
  --dry          업로드 없이 학습·검증만
"""
import argparse, json, math, sys, time
import numpy as np

try:
    import requests
except ImportError:
    sys.exit("requests 필요: pip install requests")
try:
    import torch
    import torch.nn as nn
except ImportError:
    sys.exit("torch 필요: pip install torch  (CUDA GPU면 https://pytorch.org 에서 CUDA 빌드 설치)")


# ─────────────────────────────── 데이터 수집 ───────────────────────────────
def fetch_all(base, key):
    hdr = {"x-train-key": key}
    off, page, samples, cfg, featver, featnames = 0, 20000, [], None, None, None
    anchor = 0  # [V11.1] 스냅샷 앵커(수집 중 신규행 삽입에 의한 중복/누락 방지)
    while True:
        params = {"key": key, "limit": page, "offset": off}
        if anchor:
            params["beforeTs"] = anchor
        r = requests.get(base.rstrip("/") + "/api/ml-export",
                         params=params,
                         headers=hdr, timeout=180)
        if r.status_code != 200:
            sys.exit(f"export 실패 {r.status_code}: {r.text[:300]}")
        j = r.json()
        cfg = j["config"]; featver = j["featVer"]; featnames = j["featNames"]
        anchor = j.get("anchorTs") or anchor
        got = j.get("samples", [])
        samples.extend(got)
        total = j.get("total", len(samples))
        print(f"  내려받음 {len(samples)}/{total}")
        off += len(got)
        if len(got) < page or off >= total or not got:
            break
    return samples, cfg, featver, featnames


# ─────────────────────────────── 모델 ───────────────────────────────
class MLP(nn.Module):
    def __init__(self, dims, dropout):
        super().__init__()
        layers, self.lins = [], nn.ModuleList()
        for l in range(len(dims) - 1):
            self.lins.append(nn.Linear(dims[l], dims[l + 1]))
        self.dropout = dropout
        self.n = len(self.lins)
        # He 초기화(Worker의 _dnnHeInit과 동일 정신)
        for lin in self.lins:
            nn.init.kaiming_normal_(lin.weight, nonlinearity="relu")
            nn.init.zeros_(lin.bias)

    def forward(self, x, train=True):
        for i, lin in enumerate(self.lins):
            x = lin(x)
            if i < self.n - 1:
                x = torch.relu(x)
                if train and self.dropout > 0:
                    x = torch.nn.functional.dropout(x, p=self.dropout, training=True)
        return x  # 로짓(출력층 sigmoid 전)


def wilson_lb(acc, n, z=1.64):
    if n <= 0:
        return 0.0
    z2 = z * z
    den = 1 + z2 / n
    cen = acc + z2 / (2 * n)
    rad = z * math.sqrt((acc * (1 - acc) + z2 / (4 * n)) / n)
    return max(0.0, (cen - rad) / den)


# ─────────────────────────────── 학습 ───────────────────────────────
def train(samples, cfg, featnames, args):
    D = len(featnames)
    hidden = cfg["hidden"]
    dims = [D] + list(hidden) + [1]
    K = args.seeds or cfg.get("seeds", 4)
    epochs = args.epochs or cfg.get("epochs", 120)
    if epochs < cfg.get("epochs", 0):
        epochs = cfg.get("epochs", epochs)
    dropout = cfg.get("dropout", 0.42)
    l2 = cfg.get("l2", 9e-4)
    lr = cfg.get("lr", 0.0025)
    lr_floor = cfg.get("lrFloorFrac", 0.08)
    label_smooth = cfg.get("labelSmooth", 0.06)
    input_noise = cfg.get("inputNoise", 0.06)
    mixup_p = cfg.get("mixupP", 0.2)
    std_clip = cfg.get("stdClip", 6)
    val_frac = cfg.get("valFrac", 0.2)
    batch = cfg.get("batch", 32)
    embargo_ms = cfg.get("embargoDays", 6) * 86400000
    hv_w = cfg.get("hvSrcWeight", 1.0)
    hl_days = cfg.get("recencyHalfLifeDays", 45)
    rec_floor = cfg.get("recencyFloor", 0.35)

    dev = torch.device("cpu") if args.cpu or not torch.cuda.is_available() else torch.device("cuda")
    print(f"■ 디바이스: {dev} | dims {'-'.join(map(str,dims))} | 시드 {K} | 에폭 {epochs} | 표본 {len(samples)}")

    # ts 오름차순 정렬(Worker의 data와 동일: 오래된→최신)
    samples = [s for s in samples if isinstance(s.get("x"), list) and len(s["x"]) == D]
    samples.sort(key=lambda s: s.get("ts", 0))
    N = len(samples)
    if N < cfg.get("minTrainSamples", 500) and N < 500:
        print(f"⚠️ 표본 {N} — 적지만 진행(권장 500+)")
    X = np.array([s["x"] for s in samples], dtype=np.float64)
    Y = np.array([1.0 if s["y"] else 0.0 for s in samples], dtype=np.float64)
    PNL = np.array([s.get("pnl", 0.0) for s in samples], dtype=np.float64)
    HV = np.array([1.0 if s.get("hv") else 0.0 for s in samples], dtype=np.float64)
    TS = np.array([s.get("ts", 0) for s in samples], dtype=np.float64)
    now = float(TS.max()) if N else time.time() * 1000

    # 표준화(전체 기준) + ±std_clip 윈저화
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    std[std < 1e-6] = 1.0
    Xn = np.clip((X - mean) / std, -std_clip, std_clip)

    # 표본가중 mw = clip(|pnl|/pnlScale,0.3,3) * (hv?hv_w:1) * recencyW
    absp = np.abs(PNL)
    pnl_scale = np.median(absp) if len(absp) else 1.0
    pnl_scale = pnl_scale if pnl_scale > 1e-6 else 1.0
    days = np.maximum(0.0, (now - TS) / 86400000.0)
    recency = np.maximum(rec_floor, np.power(0.5, days / hl_days))
    mw = np.clip(absp / pnl_scale, 0.3, 3.0) * np.where(HV > 0, hv_w, 1.0) * recency

    # 엠바고 홀드아웃: val=최신 nVal, train=그 이전 & ts<cutTs
    n_val = max(20, int(N * val_frac))
    cut_ts = TS[N - n_val] - embargo_ms
    idx = np.arange(N)
    tr_mask = (idx < N - n_val) & (TS < cut_ts)
    if tr_mask.sum() < 60:
        tr_mask = idx < N - n_val
    tr = idx[tr_mask]
    va = idx[N - n_val:]
    print(f"  train {len(tr)} · val {len(va)} (엠바고 {cfg.get('embargoDays',6)}일)")

    # 클래스 가중
    pos = Y[tr].sum()
    w_pos = len(tr) / (2 * pos) if pos > 0 else 1.0
    w_neg = len(tr) / (2 * (len(tr) - pos)) if (len(tr) - pos) > 0 else 1.0

    Xtr = torch.tensor(Xn[tr], dtype=torch.float32, device=dev)
    Ytr = torch.tensor(Y[tr], dtype=torch.float32, device=dev)
    Mtr = torch.tensor(mw[tr], dtype=torch.float32, device=dev)
    Xva = torch.tensor(Xn[va], dtype=torch.float32, device=dev)
    Yva = torch.tensor(Y[va], dtype=torch.float32, device=dev)

    def one_seed(seed):
        torch.manual_seed(seed); np.random.seed(seed)
        net = MLP(dims, dropout).to(dev)
        opt = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=l2)
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs, eta_min=lr * lr_floor)
        best_loss, best_state, wait, patience = 1e9, None, 0, max(8, epochs // 8)
        ntr = Xtr.shape[0]
        for ep in range(epochs):
            net.train()
            perm = torch.randperm(ntr, device=dev)
            for bs in range(0, ntr, batch):
                bi = perm[bs:bs + batch]
                xb, yb, mb = Xtr[bi], Ytr[bi], Mtr[bi]
                wc = torch.where(yb > 0.5, torch.tensor(w_pos, device=dev), torch.tensor(w_neg, device=dev))
                # Mixup
                if mixup_p > 0 and np.random.rand() < mixup_p and xb.shape[0] > 1:
                    lam = 0.2 + np.random.rand() * 0.6
                    j = torch.randperm(xb.shape[0], device=dev)
                    xb = lam * xb + (1 - lam) * xb[j]
                    yb = lam * yb + (1 - lam) * yb[j]
                    mb = lam * mb + (1 - lam) * mb[j]
                    wc = lam * wc + (1 - lam) * wc[j]
                if input_noise > 0:
                    xb = xb + input_noise * torch.randn_like(xb)
                ys = yb * (1 - label_smooth) + label_smooth / 2
                logit = net(xb, train=True).squeeze(-1)
                # 가중 BCE
                loss = nn.functional.binary_cross_entropy_with_logits(logit, ys, reduction="none")
                loss = (loss * wc * mb).mean()
                opt.zero_grad(); loss.backward()
                torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
                opt.step()
            sched.step()
            # 검증 조기종료
            net.eval()
            with torch.no_grad():
                vlogit = net(Xva, train=False).squeeze(-1)
                vloss = nn.functional.binary_cross_entropy_with_logits(vlogit, Yva).item()
            if vloss < best_loss - 1e-5:
                best_loss, wait = vloss, 0
                best_state = {k: v.detach().clone() for k, v in net.state_dict().items()}
            else:
                wait += 1
                if wait >= patience:
                    break
        if best_state:
            net.load_state_dict(best_state)
        return net

    nets = []
    for sd in range(K):
        t0 = time.time()
        nets.append(one_seed(1000 + sd * 7))
        print(f"  시드 {sd+1}/{K} 완료 ({time.time()-t0:.1f}s)")

    # 앙상블 검증(로짓 평균)
    with torch.no_grad():
        zsum = torch.zeros(Xva.shape[0], device=dev)
        for net in nets:
            net.eval()
            zsum += net(Xva, train=False).squeeze(-1)
        zmean = zsum / len(nets)
        pred = (torch.sigmoid(zmean) >= 0.5).float()
        acc = (pred == Yva).float().mean().item()
    lb = wilson_lb(acc, len(va))
    print(f"■ 앙상블 검증 정확도 {acc*100:.2f}% (Wilson 하한 {lb*100:.2f}%, n={len(va)})")

    # JS 포맷으로 변환: net.W[l]=[out][in], net.b[l]=[out]
    js_nets = []
    for net in nets:
        Wl, bl = [], []
        for lin in net.lins:
            # 4자리 반올림 — Worker setBigState도 저장 시 4자리로 반올림하므로 무손실. POST 크기↓(~24MB→~18MB).
            Wl.append(np.round(lin.weight.detach().cpu().numpy(), 4).tolist())   # [out][in] — JS와 일치
            bl.append(np.round(lin.bias.detach().cpu().numpy(), 4).tolist())
        js_nets.append({"W": Wl, "b": bl, "dims": dims})

    payload = {
        "featVer": None,  # 호출부에서 채움
        "nets": js_nets,
        "mean": mean.tolist(),
        "std": std.tolist(),
        "dims": dims,
        "valAcc": round(acc, 4),
        "valAccLB": round(lb, 4),
        "valN": len(va),
        "n": N,
    }
    return payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="Worker URL, 예: https://ai-trader-app.xxx.workers.dev")
    ap.add_argument("--key", required=True, help="TRAIN_KEY (wrangler secret put TRAIN_KEY)")
    ap.add_argument("--epochs", type=int, default=0)
    ap.add_argument("--seeds", type=int, default=0)
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    print("① 표본 내려받는 중…")
    samples, cfg, featver, featnames = fetch_all(args.base, args.key)
    if not samples:
        sys.exit("표본 0 — 아직 수확 데이터가 없습니다.")
    print(f"   featVer={featver}, 표본 {len(samples)}, 피처 {len(featnames)}")

    print("② 학습 중…")
    payload = train(samples, cfg, featnames, args)
    payload["featVer"] = featver

    if args.dry:
        print("③ --dry: 업로드 생략. 검증 완료.")
        return

    print("③ 가중치 업로드 중…")
    r = requests.post(args.base.rstrip("/") + "/api/dnn-import",
                      params={"key": args.key}, headers={"x-train-key": args.key},
                      data=json.dumps(payload), timeout=300)
    if r.status_code != 200:
        sys.exit(f"업로드 실패 {r.status_code}: {r.text[:400]}")
    res = r.json()
    print("✅ 완료:", json.dumps(res.get("trust", {}), ensure_ascii=False))
    print("   ", res.get("note", ""))


if __name__ == "__main__":
    main()
