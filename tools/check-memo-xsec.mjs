/* [V33.504] ★MEMO 상대 라벨 실험 — 고르는 건 내부 검증, 심사는 홀드아웃★
   운영 실측(10/06): MEMO 홀드아웃 블록IC −0.0127 · t −0.56 → reject(가중 0). 가설: 원형 승률이 군집에 모인 날들의
   시장 방향을 외운다. Modal 학습기가 abs(종전) · xsec(같은 날·시장 평균 대비)를 학습창 안 내부 검증으로 골라
   학습창 전체로 다시 적합하고, 그 모델만 홀드아웃으로 잰다 — 승격은 워커 게이트(종전 그대로)가 정한다. */
import { readFileSync } from "node:fs";
const P = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
chk(/def _memo_xsec_labels\(Y, TS, MKi, min_n=20\):/.test(P) && /out = Y - mu\[inv\] \+ float\(Y\.mean\(\)\)/.test(P) && /out\[cnt\[inv\] < int\(min_n\)\] = np\.nan/.test(P),
  "상대 라벨 = Y − 그날·시장 평균 + 전체 평균 · 표본 적은 날은 뺀다", "상대 라벨 정의");
const a = P.indexOf("── [V33.504] 라벨 변형 고르기"), b = P.indexOf("Ytr_fit = Ya[tr_idx] if lab != \"xsec\" else Yx_all[tr_idx]");
const sel = P.slice(a, b);
chk(a > 0 && b > a, "고르기 블록이 최종 적합 앞에 있다", "블록 위치");
chk(!/ho_idx/.test(sel), "★고르기에 홀드아웃(ho_idx)을 쓰지 않는다★", "홀드아웃 누출");
chk(/fit_i = tr_idx\[Ta\[tr_idx\] < in_from - emb_ms\]/.test(sel) && /val_i = tr_idx\[Ta\[tr_idx\] >= in_from\]/.test(sel), "내부 검증은 학습창 안 · 엠바고로 띄운다", "내부 분할");
chk(/"label": "auto"/.test(P) && /model\["label"\] = lab/.test(P) && /model\["labelInner"\] = inner or None/.test(P), "기본 auto · 고른 라벨과 내부 수치를 모델에 남긴다", "기록");
chk(/_bin = bool\(np\.all\(\(Ytr == 0\.0\) \| \(Ytr == 1\.0\)\)\)/.test(P) && /min\(0\.999, max\(0\.001, bm \+ \(wr - bm\) \* sh\)\)/.test(P), "연속 라벨용 관련도 표준편차 · 원형 p 는 [0.001,0.999]", "연속 라벨 처리");
chk(/icf = _ic_block_fields\(ph\.tolist\(\), yh\.tolist\(\)/.test(P), "홀드아웃 잣대는 종전 그대로(절대 라벨 yh 와 블록IC)", "잣대 변경");
if (fails) { console.log("\n✗ MEMO 상대 라벨 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ MEMO 상대 라벨 계약 통과");
