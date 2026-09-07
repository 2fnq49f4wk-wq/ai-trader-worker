# AI 작업 인계 상태

> Claude Code와 Codex는 토큰 소진·세션 중단 뒤에도 이 문서와 Git 커밋을 기준으로 이어서 작업한다. 비밀키와 토큰은 기록하지 않는다.

## Current handoff

- Status: complete
- Owner: Codex
- Branch: main
- Last commit: HEAD (verify with `git log -1 --oneline`)
- Scope: V33.309 AI 작동 관제실을 Claude Code에서 안전하게 배포할 수 있는 인계 도구 추가

## Completed

- AI 작동 화면을 관제실 중심의 정보 계층, 연결 상태 바, 반응형 모바일 레이아웃으로 재설계했다.
- 판정 상태·최상위 신호·위원회 합류·스캔 최신성을 첫 화면에서 읽는 작동 요약을 추가했다.
- PICKS, COMMITTEE, PIPELINE 세 데이터 소스의 성공·대기·오류를 서로 구분해 표시한다.
- `/api/ai-mode`, `/api/pipeline`, `/api/ai-picks`의 HTTP 오류가 정상 데이터로 처리되거나 오래된 캐시에 가려지는 문제를 수정했다.
- 관측 API에 15초 타임아웃과 오류 로그를 추가해 무한 로딩 및 무음 실패를 막았다.
- AI 작동 관제실 계약 검사를 배포 CI에 추가했다.
- Claude API 및 Cloudflare Workers AI 비활성화 정책은 변경하지 않았다.
- Claude Code에서 한 명령으로 fetch·rebase·전체검사·main push를 수행하는 배포 스크립트와 안내서를 추가했다.

## Remaining work

- 라이브 사이트가 V33.308이라고 사용자에게 전달받았지만 로컬 HEAD는 V33.307이었다. 이 환경의 HTTPS 프록시가 GitHub CONNECT를 403으로 차단해 라이브 응답과 원격 V33.308 소스를 독립 검증하지 못했다.
- 이 작업의 빌드 표식은 충돌을 피하려고 다음 번호인 V33.309로 올렸다.
- 네트워크가 가능한 다음 담당자는 구현을 시작하기 전에 `git fetch origin main`, `git rebase origin/main`으로 원격 변경을 합치고 전체 검사를 다시 실행한다.
- rebase 충돌 시 `public/index.html`의 AI 두뇌 블록과 빌드 버전을 특히 확인한다. 원격 최신 UI를 무조건 덮어쓰지 않는다.
- 네트워크와 GitHub 인증이 가능한 Claude Code에서 `bash tools/deploy-with-claude.sh --push`를 실행한다.

## Validation

- `node tools/check-ai-ops-ui.mjs`
- `node tools/check-html-js.mjs`
- `node tools/check-build-ver.mjs`
- `node tools/check-ai-handoff.mjs`
- `node tools/check-model-evidence.mjs`
- `node tools/check-syntax.mjs`
- `git diff --check`

## Recovery notes

- UI와 읽기 전용 관측 요청만 변경했다. `wrangler.toml`, D1/R2 바인딩, cron, 주문 로직, 모델 업로드 경로는 변경하지 않았다.
- 연결 상태가 빨간색이면 캐시 화면이 있어도 해당 소스의 최신 요청이 실패했다는 뜻이다.
- `main` push는 프로덕션 Worker 자동 배포이므로 원격 rebase와 검증 없이 강제 push하지 않는다.
