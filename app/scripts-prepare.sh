#!/usr/bin/env bash
# [V33.679] 빌드 준비(debug·release 공통) — 안드로이드 프로젝트 생성 · 아이콘 · Firebase(있으면) · 버전 번호 · 동기화
set -euo pipefail
cd "$(dirname "$0")"
npx cap add android
npm run assets || echo "아이콘 생성 실패 — 기본 아이콘으로 계속"
if [ -z "${GOOGLE_SERVICES_JSON:-}" ] && [ -f google-services.json ]; then
  GOOGLE_SERVICES_JSON="$(cat google-services.json)"   # 저장소의 app/google-services.json(공개 식별값 — APK 안에 들어가는 파일이라 비밀 아님)
fi
if [ -n "${GOOGLE_SERVICES_JSON:-}" ]; then
  echo "$GOOGLE_SERVICES_JSON" > android/app/google-services.json
  node -e 'const j=JSON.parse(require("fs").readFileSync("android/app/google-services.json","utf8"));const p=j.client.map(c=>c.client_info.android_client_info.package_name);if(!p.includes("app.luxengine.trader")){console.error("google-services.json 패키지 이름 불일치: "+p);process.exit(1)}'

  # 앱 사용자 에이전트에 'fcm' 을 붙여 사이트가 앱 푸시 버튼을 보이게 한다(Firebase 설정이 없는 빌드에서 register() 를 부르면 앱이 죽는다)
  node -e 'const f="capacitor.config.json",c=require("./"+f);c.appendUserAgent="LuxApp/1 fcm";require("fs").writeFileSync(f,JSON.stringify(c,null,2))'
  echo "Firebase 설정 포함 — 앱 푸시 켜짐"
else
  echo "GOOGLE_SERVICES_JSON 없음 — 앱 푸시 없이 빌드(웹 푸시는 사이트에서 그대로)"
fi
VC="${VERSION_CODE:-1}"
sed -i -E "s/versionCode [0-9]+/versionCode ${VC}/; s/versionName \"[^\"]*\"/versionName \"1.0.${VC}\"/" android/app/build.gradle
npx cap sync android
