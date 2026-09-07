# AI 작업 인계 상태

> 이 문서는 Claude Code와 Codex가 토큰 소진·세션 중단 후에도 커밋 경계에서 안전하게 이어가기 위한 체크포인트다.

## Current handoff

- Status: complete
- Owner: Codex
- Branch: work
- Last commit: HEAD (this change; verify with `git log -1 --oneline`)
- Scope: 대형모델 R2/D1 로딩 실패 관측성 추가

## Completed

- DNN/GBDT가 모두 미신뢰이면 AI_PRIMARY 신규 진입을 차단하도록 정책을 복원했다.
- Claude와 Codex가 같은 Git 커밋, 검사 결과, 남은 작업을 기준으로 인계하도록 공통 규약을 추가했다.
- Claude API 및 Cloudflare Workers AI 비활성화 정책은 변경하지 않았다.
- 대형모델 로딩 실패를 미학습과 구분하도록 원인·시각·누적 횟수를 메모리에 기록하고 `/api/r2-status`에 노출했다.

## Remaining work

- 검증구간 재사용 제거는 모델 승격 통계 의미를 바꾸므로 별도 변경으로 진행한다.

## Validation

- 새 담당자는 아래 명령을 다시 실행한다.
  - `node tools/check-ai-handoff.mjs`
  - `node tools/check-model-evidence.mjs`
  - `node tools/check-syntax.mjs`
  - `node tools/check-big-load-health.mjs`

## Recovery notes

- 이 변경으로 검증된 DNN/GBDT가 하나도 없으면 AI_PRIMARY 신규 진입은 줄거나 0이 될 수 있다.
- 규칙 기반 비상 운용은 `AI_PARAMS.autonomy.emergencyFallback` 경로를 사용한다.
- 운영 가용성을 이유로 `requireTrustedModel`을 다시 끄기 전에 모델 신뢰 상태와 차단 로그를 확인한다.
