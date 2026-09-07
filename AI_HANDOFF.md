# AI 작업 인계 상태

> Claude Code와 Codex는 토큰 소진·세션 중단 뒤에도 이 문서와 Git 커밋을 기준으로 이어서 작업한다. 비밀키와 토큰은 기록하지 않는다.

## Current handoff

- Status: complete
- Owner: Codex
- Branch: main
- Last commit: HEAD (verify with `git log -1 --oneline`)
- Scope: 최신 원격 main 기반 재구현 전까지 오래된 V33.309 배포 차단

## Completed

- AI 작동 화면을 관제실 중심의 정보 계층, 연결 상태 바, 반응형 모바일 레이아웃으로 재설계했다.
- 판정 상태·최상위 신호·위원회 합류·스캔 최신성을 첫 화면에서 읽는 작동 요약을 추가했다.
- PICKS, COMMITTEE, PIPELINE 세 데이터 소스의 성공·대기·오류를 서로 구분해 표시한다.
- `/api/ai-mode`, `/api/pipeline`, `/api/ai-picks`의 HTTP 오류가 정상 데이터로 처리되거나 오래된 캐시에 가려지는 문제를 수정했다.
- 관측 API에 15초 타임아웃과 오류 로그를 추가해 무한 로딩 및 무음 실패를 막았다.
- AI 작동 관제실 계약 검사를 배포 CI에 추가했다.
- Claude API 및 Cloudflare Workers AI 비활성화 정책은 변경하지 않았다.
- 배포 스크립트가 원격 최신 이력이 빠진 로컬 변경을 자동 rebase하거나 push하지 않고 중단하도록 고쳤다.

## Remaining work

- Claude 실측상 원격 main은 V33.310(`dc24d58`)이며 이 로컬 V33.309 작업은 오래된 V33.304 계열에서 만들어졌다.
- Codex 환경은 Envoy allowlist에 `github.com`이 없어 fetch가 계속 CONNECT 403으로 실패한다.
- GitHub 접근이 가능한 다음 담당자는 `origin/main`에서 새 worktree를 만들고 최신 코드·83개 게이트를 기준으로 AI 작동화면을 다시 구현한다.
- 로컬 V33.309 커밋은 요구사항 참고용이다. 자동 rebase, 통째 cherry-pick, force push, 직접 배포를 하지 않는다.

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
