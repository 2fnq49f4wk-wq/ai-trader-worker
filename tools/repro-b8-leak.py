#!/usr/bin/env python3
# B-8 재현 — docs/OPEN-DEFECTS.md
#   수확 표본의 ts 가 "일봉 1개 = 달력 1일"(src/index.js 의 baseTs - (L-1-i)*86400000)로 찍히는 탓에
#   실거래 표본의 진짜 시계와 섞여 시간순 분할이 엉키고, 밀리초 엠바고가 진짜 겹침을 못 막는다.
#   분할 절차는 trainer/modal/modal_train.py 의 _split_ts 와 같다.
#   실행: python3 tools/repro-b8-leak.py
import numpy as np

D = 86400000.0
BARS_PER_YEAR = 252.0          # 실제 거래일
CAL_PER_YEAR = 365.0
NB, NS, STRIDE = 2400, 200, 8  # HARVEST.deepBars / 종목수 / entryLike 통과분 근사
N_LIVE, LIVE_DAYS = 12000, 365
VAL_FRAC, EMBARGO_D, HORIZON_D = 0.2, 6, 10

def build():
    rng = np.random.default_rng(0)
    stamp, real, src = [], [], []
    for _ in range(NS):
        for i in range(60, NB - HORIZON_D, STRIDE):
            bars_ago = NB - 1 - i
            stamp.append(-bars_ago * D)                              # 코드가 찍는 값(가짜 달력)
            real.append(-bars_ago * (CAL_PER_YEAR / BARS_PER_YEAR) * D)  # 진짜 달력
            src.append(1)
    for _ in range(N_LIVE):
        t = -rng.uniform(0, LIVE_DAYS) * D
        stamp.append(t); real.append(t); src.append(0)               # 실거래는 진짜 시계
    return np.array(stamp), np.array(real), np.array(src)

def main():
    stamp, real, src = build()
    n = len(stamp)
    order = np.argsort(stamp, kind="stable")            # _split_ts 와 같은 한 번의 전역 정렬
    ts_s, real_s, src_s = stamp[order], real[order], src[order]
    nval = min(max(200, int(n * VAL_FRAC)), n - 1)
    emb = max(EMBARGO_D, HORIZON_D) * D                 # _split_ts: max(embargo_ms, horizon_ms)
    idx = np.arange(n)
    cut = ts_s[n - nval] - emb
    tr = idx[(idx < n - nval) & (ts_s < cut)]
    va = idx[n - nval:]

    hv = src_s == 1
    err = (ts_s[hv] - real_s[hv]) / D
    print(f"표본 {n:,} (수확 {int(hv.sum()):,} / 실거래 {int((~hv).sum()):,}) · 학습 {len(tr):,} · 검증 {len(va):,}")
    print(f"수확 스탬프 오차(실제보다 최근으로 찍힌 일수): 중앙값 {np.median(err):.0f}일 · 최대 {err.max():.0f}일")

    tr_real = np.sort(real_s[tr])
    for name, m in (("수확(hv)", src_s[va] == 1), ("실거래/반사실", src_s[va] == 0)):
        rv = real_s[va][m]
        if not len(rv):
            continue
        fut = len(tr_real) - np.searchsorted(tr_real, rv, side="right")   # 그 표본의 실제 시점보다 미래인 학습표본
        anyf = int((fut > 0).sum())
        line = f"  {name}: 검증 {len(rv):,}건 · 미래 학습표본 보유 {anyf:,}건({anyf/len(rv)*100:.0f}%)"
        if anyf:
            lead = np.array([(tr_real[tr_real > r].max() - r) / D for r in rv[fut > 0][:2000]])
            line += (f" · 보유분 미래표본 중앙값 {np.median(fut[fut > 0]):,.0f}건"
                     f" · 내다보는 기간 중앙값 {np.median(lead):.0f}일/최대 {lead.max():.0f}일")
        print(line)
    print("\n※ 혼합 비율은 가정이다. 분할·엠바고 경로는 _split_ts 와 같다.")
    print("   ts 를 dd.days[i]*86400000 로 바꾸면 수확 쪽 오차가 0 이 되고 이 누출도 사라진다.")

if __name__ == "__main__":
    main()
