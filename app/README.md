# LUX 네이티브 앱(Capacitor) — 앱 진화 2·3단계

화면은 워커 사이트(https://ai-trader-app.blauenacht08.workers.dev)를 그대로 띄운다 — 사이트를 고치면 앱도 바로 바뀐다(앱 재배포 불필요).
`www/` 는 인터넷이 끊겼을 때만 보이는 안내 화면. 플랫폼 폴더(android/·ios/)는 저장소에 두지 않고 빌드 때 `scripts-prepare.sh` 가 만든다.

## 앱 안에서만 켜지는 기능(사이트 index.html 의 네이티브 연결)
- 안드로이드 뒤로 버튼(메뉴 닫기 → 뒤로 → 앱 내림) · 검정 상태표시줄 · 스플래시
- 🔒 생체 잠금(지문·얼굴 — 앱 열 때 · 1분 넘게 나갔다 올 때)
- 🔔 체결 알림(FCM) — Firebase 설정이 들어간 빌드에서만(아래 ②)

## GitHub Actions
- `Build Android App` — 시험판 debug APK(계정 불필요). app/** 바뀌면 자동 · 수동 실행 가능. 결과물 `lux-android-debug`.
- `Release Android App` — Play 제출용 서명 AAB(+APK). 수동 실행. 아래 ③ 비밀값 필요. 결과물 `lux-android-release`.

## 사용자가 할 일(계정·키는 저장소에 넣지 않고 GitHub Secrets 에만)
① Google Play 개발자 계정(1회 $25) — play.google.com/console
② Firebase(앱 푸시, 무료) — console.firebase.google.com → 프로젝트 만들기 → Android 앱 추가(패키지 이름 `app.luxengine.trader`)
   - `google-services.json` 내려받기 → GitHub 저장소 Settings › Secrets › Actions 에 `GOOGLE_SERVICES_JSON`(파일 내용 그대로)
   - 프로젝트 설정 › 서비스 계정 › '새 비공개 키 생성' JSON → 비밀값 `FCM_SERVICE_ACCOUNT`(내용 그대로) — 배포 때 워커 비밀 FCM_SA 로 들어간다
③ 서명 키(업로드 키) — 내 컴퓨터에서 한 번(Java 필요):
   `keytool -genkeypair -v -keystore lux-upload.jks -alias lux -keyalg RSA -keysize 2048 -validity 10000`
   - `base64 -w0 lux-upload.jks`(맥: `base64 -i lux-upload.jks`) 결과 → 비밀값 `ANDROID_KEYSTORE_BASE64`
   - 비밀번호 → `ANDROID_KEYSTORE_PASSWORD` · `ANDROID_KEY_PASSWORD` · 별칭 `lux` → `ANDROID_KEY_ALIAS`
   - jks 파일과 비밀번호는 안전한 곳에 따로 보관(잃으면 Play 지원팀을 통해 업로드 키 재설정 필요)
④ Play Console 앱 만들기 → 내부 테스트 트랙에 AAB 업로드 → 스토어 등록정보(설명·스크린샷·아이콘 512) · 개인정보처리방침 URL
   `https://ai-trader-app.blauenacht08.workers.dev/privacy` · 콘텐츠 등급 · 데이터 보안 양식(수집: 푸시 토큰만) · 앱 카테고리 '금융' — '모의투자(실주문 아님)' 명시
⑤ iOS(선택): Apple 개발자 계정($99/년) + Mac(Xcode) 또는 클라우드 빌드 — 계정이 생기면 ios 빌드 워크플로를 붙인다.
