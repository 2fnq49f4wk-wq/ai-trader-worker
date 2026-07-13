#!/usr/bin/env bash
# ============================================================================
# LUX-DNN 학습기 — Oracle Cloud Always Free VM 원클릭 설치
#   VM(ARM Ampere A1, 평생무료, 항상켜짐)에 파이썬+토치+트레이너+자동스케줄(systemd)을 구성.
#   당신 PC가 꺼져 있어도 매일 클라우드에서 3M 딥넷을 학습해 Worker에 업로드한다.
#
# 사용:  bash setup_oracle.sh
#   (train_dnn.py 가 이 스크립트와 같은 폴더 또는 상위 폴더에 있어야 함)
# ============================================================================
set -euo pipefail

APP_DIR=/opt/luxdnn
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "■ 1/6 시스템 패키지 설치"
sudo apt-get update -y
sudo apt-get install -y python3 python3-venv python3-pip git

echo "■ 2/6 앱 디렉터리 준비: $APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo chown "$USER":"$USER" "$APP_DIR"

# train_dnn.py 확보 — 같은 폴더 → 상위 폴더 순으로 탐색
if   [ -f "$SCRIPT_DIR/train_dnn.py" ];    then cp "$SCRIPT_DIR/train_dnn.py" "$APP_DIR/";
elif [ -f "$SCRIPT_DIR/../train_dnn.py" ]; then cp "$SCRIPT_DIR/../train_dnn.py" "$APP_DIR/";
else
  echo "  train_dnn.py 를 못 찾음 — GitHub에서 clone 시도"
  read -r -p "  GitHub 저장소 URL (예: https://github.com/2fnq49f4wk-wq/ai-trader-worker.git): " REPO
  git clone --depth 1 "$REPO" /tmp/luxrepo
  cp /tmp/luxrepo/trainer/train_dnn.py "$APP_DIR/"
fi

echo "■ 3/6 파이썬 가상환경 + 라이브러리(torch CPU/ARM, numpy, requests)"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip
"$APP_DIR/venv/bin/pip" install torch numpy requests

echo "■ 4/6 접속 설정"
read -r -p "  Worker URL (예: https://ai-trader-app.xxx.workers.dev): " BASE_URL
read -r -p "  TRAIN_KEY (wrangler secret put TRAIN_KEY 로 넣은 값): " TRAIN_KEY
read -r -p "  에폭 수 [기본 150]: " EPOCHS; EPOCHS="${EPOCHS:-150}"
cat > "$APP_DIR/luxdnn.env" <<EOF
BASE_URL=$BASE_URL
TRAIN_KEY=$TRAIN_KEY
EPOCHS=$EPOCHS
EOF
chmod 600 "$APP_DIR/luxdnn.env"

echo "■ 5/6 systemd 서비스 + 타이머(매일 자동 학습)"
sudo tee /etc/systemd/system/luxdnn-train.service >/dev/null <<EOF
[Unit]
Description=LUX-DNN nightly training (Oracle Cloud)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$USER
EnvironmentFile=$APP_DIR/luxdnn.env
ExecStart=$APP_DIR/venv/bin/python $APP_DIR/train_dnn.py --base \${BASE_URL} --key \${TRAIN_KEY} --epochs \${EPOCHS}
# 실패해도 VM은 계속 살아있고 다음 타이머에 재시도
TimeoutStartSec=3600
Nice=10
EOF

# 매일 18:10 UTC(미국장 마감 근처) + 최대 20분 랜덤 지연. 필요시 OnCalendar 수정.
sudo tee /etc/systemd/system/luxdnn-train.timer >/dev/null <<EOF
[Unit]
Description=LUX-DNN daily training timer

[Timer]
OnCalendar=*-*-* 18:10:00 UTC
RandomizedDelaySec=1200
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now luxdnn-train.timer

echo "■ 6/6 지금 1회 즉시 학습 실행(로그 확인용)"
sudo systemctl start luxdnn-train.service || true
echo
echo "✅ 완료. 이제 이 VM이 매일 자동으로 학습·업로드합니다 (당신 PC와 무관)."
echo "   다음 실행 예정:   systemctl list-timers luxdnn-train.timer"
echo "   실시간 로그:      journalctl -u luxdnn-train.service -f"
echo "   수동 즉시 실행:   sudo systemctl start luxdnn-train.service"
echo "   스케줄 변경:      sudo nano /etc/systemd/system/luxdnn-train.timer  (OnCalendar 수정 후 daemon-reload)"
