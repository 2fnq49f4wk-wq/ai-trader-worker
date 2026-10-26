# LUX 네이티브 앱(Capacitor) — 앱 진화 2단계

화면은 워커 사이트(https://ai-trader-app.blauenacht08.workers.dev)를 그대로 띄운다. 사이트를 고치면 앱도 바로 바뀐다(앱 재배포 불필요).
`www/` 는 인터넷이 끊겼을 때만 보이는 안내 화면이다.

- 안드로이드 시험판(APK): GitHub Actions `Build Android App` 을 돌리면 결과물(artifact)로 `app-debug.apk` 가 나온다 — 휴대폰에 내려받아 설치(출처를 알 수 없는 앱 허용).
- 플랫폼 폴더(android/·ios/)는 저장소에 두지 않는다 — 빌드 때마다 `npx cap add android` 로 새로 만든다(설정은 capacitor.config.json 하나).
- 스토어 출시(3단계)에 필요한 것: Google Play 개발자 계정($25 1회) · Apple 개발자 계정($99/년) + Mac(또는 클라우드 빌드) · 서명 키 · 네이티브 푸시(Firebase) · 개인정보처리방침.
