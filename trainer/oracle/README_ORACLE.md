# LUX-DNN 클라우드 자동학습 — Oracle Cloud 무료 VM (PC 꺼져도 동작)

당신 컴퓨터와 완전히 무관하게, **Oracle Cloud의 평생 무료 ARM VM**이 매일 자동으로 3M 딥넷을
학습해 Worker에 업로드합니다. 한도(무료 시간 제한) 개념이 없고 항상 켜져 있습니다.

전체 시간 ~20분(대부분 VM 생성 대기). 한 번만 하면 이후 영구 자동.

---

## 사전: Worker에 TRAIN_KEY 넣기 (당신 PC에서 1회)

```
cd C:\Users\thund\Downloads\_ghfix
wrangler secret put TRAIN_KEY
```
아무 긴 랜덤 문자열 입력(예: 비밀번호 생성기). 이 값을 아래 VM 설정에서 다시 씁니다.

---

## 1단계 — Oracle Cloud 가입 & 무료 VM 생성

1. https://www.oracle.com/cloud/free/ → **Start for free** 가입 (카드 확인은 있지만 Always Free는 과금 안 됨).
2. 콘솔 로그인 → 좌상단 메뉴 → **Compute → Instances → Create instance**.
3. 설정:
   - **Image**: Canonical **Ubuntu 22.04** (또는 24.04)
   - **Shape**: **Change shape → Ampere → VM.Standard.A1.Flex** (ARM, Always Free)
     - OCPU **2~4**, 메모리 **12~24GB** (Always Free 범위)
     - ※ "out of capacity" 뜨면 다른 가용 도메인(AD-2, AD-3) 선택하거나 잠시 후 재시도
   - **SSH keys**: "Generate a key pair for me" → **개인키 다운로드**(꼭 저장!)
4. **Create** → 1~2분 후 상태 Running. **Public IP** 메모.

---

## 2단계 — VM에 접속

Windows PowerShell에서 (다운받은 개인키 경로로):
```
ssh -i C:\경로\ssh-key.key ubuntu@<PUBLIC_IP>
```
(권한 오류 나면: 키 파일 우클릭 → 속성 → 보안에서 본인만 읽기 권한으로. 또는 `icacls`)

---

## 3단계 — 트레이너 설치 (VM 안에서, 한 줄씩)

저장소가 **공개(public)** 라면 가장 간단:
```
git clone --depth 1 https://github.com/2fnq49f4wk-wq/ai-trader-worker.git
cd ai-trader-worker/trainer/oracle
bash setup_oracle.sh
```

저장소가 **비공개** 면, 로컬 PC에서 `trainer` 폴더를 VM으로 복사 후 실행:
```
# (당신 PC PowerShell)
scp -i C:\경로\ssh-key.key -r C:\Users\thund\Downloads\_ghfix\trainer ubuntu@<PUBLIC_IP>:~/
# (VM 안)
cd ~/trainer/oracle && bash setup_oracle.sh
```

설치 스크립트가 물어보는 것:
- **Worker URL** — 예 `https://ai-trader-app.xxx.workers.dev`
- **TRAIN_KEY** — 위에서 넣은 값
- **에폭 수** — 그냥 엔터(기본 150)

끝나면 즉시 1회 학습이 돌고, 이후 **매일 18:10 UTC(≈미국장 마감 후)** 자동 실행됩니다.

---

## 확인 & 관리 (VM 안)

```
systemctl list-timers luxdnn-train.timer      # 다음 실행 예정 시각
journalctl -u luxdnn-train.service -f          # 실시간 학습 로그
sudo systemctl start luxdnn-train.service      # 지금 즉시 1회 학습
```

성공하면 사이트 **AI 두뇌 관측**에 `✅ 가동 중` 배너가 뜨고, 검증정확도가 mind를 넘으면
wDNN>0으로 실거래에 반영됩니다.

## 스케줄 바꾸기 (예: 하루 2번)
```
sudo nano /etc/systemd/system/luxdnn-train.timer
# OnCalendar=*-*-* 06,18:10:00 UTC  로 수정 후
sudo systemctl daemon-reload && sudo systemctl restart luxdnn-train.timer
```

## GPU를 원하면?
Always Free는 CPU만입니다. 3M 학습은 CPU로도 수 분이라 충분하지만, GPU가 꼭 필요하면
같은 `train_dnn.py`를 Oracle **유료 GPU 인스턴스**나 Modal/Colab에서 그대로 쓸 수 있습니다
(스크립트가 GPU 있으면 자동 사용). 지금 구성은 CPU 무료 VM 기준입니다.
