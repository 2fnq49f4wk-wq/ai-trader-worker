# LUX-DNN 외부 GPU 학습 (3M 파라미터)

Cloudflare Worker(순수 JS, CPU 300s)로는 3M 딥넷을 완전학습할 수 없어 **영원히 "학습 대기"** 상태였습니다.
이 폴더의 트레이너가 **PC의 GPU(또는 CPU / Colab)** 에서 완전학습한 뒤 가중치만 Worker에 업로드합니다.
Worker는 추론·저장만 담당 → 3M이 실제로 위원회에서 가동됩니다.

## 1회 준비

1. **TRAIN_KEY 시크릿 설정** (아무 긴 랜덤 문자열):
   ```
   cd C:\Users\thund\Downloads\_ghfix
   wrangler secret put TRAIN_KEY
   ```
   (미설정 시 export/import 엔드포인트는 503으로 차단 — 공개 노출 방지)

2. **파이썬 패키지**:
   ```
   pip install torch numpy requests
   ```
   NVIDIA GPU가 있으면 https://pytorch.org 에서 CUDA 빌드로 설치하면 훨씬 빠릅니다(수십 초). CPU도 수 분이면 됩니다.

## 학습 실행

```
python trainer/train_dnn.py --base https://ai-trader-app.<계정>.workers.dev --key <TRAIN_KEY> --epochs 150
```

또는 `run_train.bat` 의 BASE/KEY를 채우고 더블클릭.

동작:
1. `/api/ml-export` 로 수확표본 전량 + 하이퍼파라미터를 내려받음
2. GPU에서 4시드 앙상블 완전학습(표준화·클래스가중·표본가중·Mixup·라벨스무딩·AdamW·코사인LR — Worker 로직과 동일)
3. `/api/dnn-import` 로 가중치 업로드 → Worker가 mind 대비 검증성능으로 신뢰게이트 자동 평가

업로드 후 **AI 두뇌 관측** 화면에 `✅ 가동 중` 배너가 뜨고, valAcc가 mind를 넘으면 wDNN>0으로 실거래에 반영됩니다.

## Google Colab (GPU 무료)

로컬에 GPU가 없으면 Colab 새 노트북에서:
```python
!pip -q install torch numpy requests
!wget -q https://ai-trader-app.<계정>.workers.dev/  # (train_dnn.py 내용을 셀에 붙여넣거나 업로드)
!python train_dnn.py --base https://ai-trader-app.<계정>.workers.dev --key <TRAIN_KEY> --epochs 200
```
런타임 → 런타임 유형 변경 → GPU 선택.

## 주기적 재학습

수확표본이 계속 쌓이므로 **주 1~2회** 재실행하면 최신 시장에 적응합니다.
외부 업로드 모델이 가동 중이면 Worker의 야간 자가학습은 자동으로 생략됩니다(열등한 부분학습이 덮어쓰지 않도록).
