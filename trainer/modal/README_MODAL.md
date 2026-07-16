# LUX-DNN 클라우드 자동학습 — Modal.com (PC 꺼져도 매일 자동, 카드 불필요)

Modal 클라우드에서 매일 자동으로 3M 딥넷을 학습해 Worker에 업로드합니다.
당신 컴퓨터와 완전 무관하게 동작하고, GitHub 로그인만 하면 됩니다(카드 X). 월 $30 무료 크레딧이면
이 학습 부하로는 사실상 무제한입니다.

전체 5~10분, 한 번만 하면 이후 영구 자동.

---

## 사전: Worker에 TRAIN_KEY 넣기 (당신 PC에서 1회)
```
cd C:\Users\thund\Downloads\_ghfix
wrangler secret put TRAIN_KEY
```
아무 긴 랜덤 문자열 입력. 이 값을 아래 3단계에서 다시 씁니다.

---

## 1단계 — Modal 설치 & 로그인 (당신 PC PowerShell)
```
pip install modal
modal setup
```
`modal setup` 하면 브라우저가 열리고 **GitHub 계정으로 로그인** → 자동으로 토큰이 PC에 저장됩니다.
(카드·결제정보 요구 없음)

---

## 2단계 — 시크릿 등록 (Worker 주소 + 키를 Modal에 안전 보관)
```
modal secret create lux-dnn BASE_URL=https://ai-trader-app.xxx.workers.dev TRAIN_KEY=여기에_TRAIN_KEY
```
- `BASE_URL` = 당신 Worker 주소
- `TRAIN_KEY` = 위 사전단계에서 넣은 값

---

## 3단계 — 배포 (매일 자동 실행 등록)
```
cd C:\Users\thund\Downloads\_ghfix\trainer\modal
modal deploy modal_train.py
```
이걸로 끝. Modal이 **매일 18:10 UTC**(≈미국장 마감 후) 클라우드에서 학습·업로드를 자동 실행합니다.
**당신 PC는 꺼도 됩니다.**

---

## 즉시 1회 테스트 (선택)
```
modal run modal_train.py
```
바로 한 번 학습이 돌고 로그가 실시간으로 보입니다. 성공하면 사이트 **AI 두뇌 관측**에
`✅ 가동 중` 배너가 뜹니다.

## 관리
- 대시보드: https://modal.com/apps — 실행 이력·로그·다음 스케줄 확인
- 스케줄 변경: `modal_train.py`의 `CRON = modal.Cron("10 18 * * *")` 수정 후 `modal deploy` 다시
- GPU 쓰기: `@app.function(...)` 에 `gpu="T4"` 주석 해제 후 재배포 (CPU로도 충분, GPU는 크레딧 더 씀)

## 크레딧 걱정?
3M 학습 1회 = CPU 수 분. 하루 1회면 월 크레딧의 극히 일부만 씁니다. 무료 $30 크레딧 안에서
매일 돌려도 남습니다. 대시보드 Usage에서 실사용량 확인 가능.

---

## [V12.34] 재배포 자동화 — 이제 PC 없이 GitHub에서 처리됩니다

**1회 준비**: PC에서 `modal token new` 실행(또는 `~/.modal.toml`의 값 확인) 후,
GitHub 저장소 **Settings → Secrets and variables → Actions**에 등록:
- `MODAL_TOKEN_ID`
- `MODAL_TOKEN_SECRET`

이후:
- **자동 재배포** — `trainer/modal/` 파일이 main에 푸시되면 GitHub Actions가 자동으로 `modal deploy` 실행
- **수동 재배포 버튼** — GitHub → **Actions → "Deploy Modal Trainer" → Run workflow**
  (`run_now` 체크 시 배포 직후 학습 1회 즉시 실행 → 두뇌 페이지 정확도 바로 갱신)
