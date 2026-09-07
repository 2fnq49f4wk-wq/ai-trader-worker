#!/usr/bin/env bash
# Claude Code에서 Codex의 로컬 main을 원격 main에 안전하게 합치고 배포한다.
# main push가 곧 Cloudflare 프로덕션 배포이므로 force push는 의도적으로 지원하지 않는다.
set -Eeuo pipefail

if [[ "${1:-}" == "--push" ]]; then
  echo "ERROR: 사용자 정책에 따라 AI의 직접 배포는 중지됐습니다." >&2
  echo "ZIP 생성: bash tools/package-codex-delivery.sh <기준-ref> <이름>" >&2
  exit 4
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  echo "ERROR: Git 저장소 안에서 실행하세요." >&2
  exit 2
fi
cd "$ROOT"

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "ERROR: main 브랜치에서만 배포할 수 있습니다." >&2
  exit 2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: 작업 트리가 깨끗하지 않습니다. 먼저 변경을 검토하고 커밋하세요." >&2
  git status --short >&2
  exit 2
fi
if [[ "$(git remote get-url origin 2>/dev/null || true)" != "https://github.com/2fnq49f4wk-wq/ai-trader-worker.git" ]]; then
  echo "ERROR: origin이 공식 저장소를 가리키지 않습니다." >&2
  exit 2
fi

echo "[1/5] 원격 main 조회"
git fetch origin main

echo "[2/5] 원격 최신 main을 바탕으로 만든 변경인지 확인"
if ! git merge-base --is-ancestor origin/main HEAD; then
  cat >&2 <<'EOF'
ERROR: 원격 main에 이 작업공간에 없는 변경이 있습니다.
오래된 바닥에서 만든 UI 커밋을 자동 rebase하거나 그대로 배포하지 않습니다.

Claude Code 작업 순서:
  1. origin/main에서 깨끗한 새 브랜치/작업트리를 만듭니다.
  2. 현재 UI의 요구사항과 의도만 참고해 최신 코드 위에서 다시 구현합니다.
  3. 원격의 최신 check-*.mjs와 deploy.yml을 기준으로 전체 검사를 실행합니다.
  4. 검증된 결과만 main에 반영합니다.

현재 로컬 커밋을 force push하거나 기계적으로 rebase하지 마세요.
EOF
  exit 3
fi

echo "[3/5] V33.309 빌드 표식과 핵심 계약 검사"
node tools/check-build-ver.mjs
node tools/check-ai-ops-ui.mjs
node tools/check-html-js.mjs
node tools/check-mobile.mjs
node tools/check-viz-legibility.mjs
node tools/check-model-evidence.mjs
node tools/check-no-external-ai.mjs
git diff --check

echo "[4/5] 전체 배포 계약 검사"
for check in tools/check-*.mjs; do
  node "$check"
done

if [[ "${1:-}" != "--push" ]]; then
  echo "검사 완료. 실제 배포: bash tools/deploy-with-claude.sh --push"
  exit 0
fi

echo "[5/5] main push → GitHub Actions → Cloudflare 프로덕션 배포"
git push origin main:main
echo "배포 트리거 완료: $(git rev-parse --short HEAD)"
echo "GitHub Actions: https://github.com/2fnq49f4wk-wq/ai-trader-worker/actions/workflows/deploy.yml"
