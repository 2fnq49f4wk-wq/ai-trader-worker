@echo off
REM ── LUX-DNN 외부 GPU 학습 원클릭 (Windows) ──
REM 최초 1회: pip install torch numpy requests  (CUDA GPU면 pytorch.org에서 CUDA 빌드 권장)
REM BASE / KEY 를 본인 값으로 수정하세요.

set BASE=https://ai-trader-app.CHANGE-ME.workers.dev
set KEY=CHANGE-ME-TRAIN-KEY

python "%~dp0train_dnn.py" --base %BASE% --key %KEY% --epochs 150
pause
