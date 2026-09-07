#!/usr/bin/env bash
# Claude Code에서 Codex의 로컬 main을 원격 main에 안전하게 합치고 배포한다.
# main push가 곧 Cloudflare 프로덕션 배포이므로 force push는 의도적으로 지원하지 않는다.
set -Eeuo pipefail

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

echo "[2/5] 원격 V33.308 이후에 로컬 변경 재배치"
if ! git merge-base --is-ancestor origin/main HEAD; then
  git rebase origin/main || {
    cat >&2 <<'EOF'
ERROR: 자동 rebase 중 충돌이 발생했습니다.
  1. git status로 충돌 파일을 확인합니다.
  2. public/index.html은 원격 변경을 지우지 말고 V33.309 관제실 변경과 합칩니다.
  3. 해결 후 git add <파일> && git rebase --continue 를 실행합니다.
  4. 이 스크립트를 다시 실행합니다.
되돌리려면 git rebase --abort 를 실행하세요.
EOF
    exit 3
  }
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

