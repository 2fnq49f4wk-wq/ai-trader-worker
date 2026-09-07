#!/usr/bin/env bash
# 커밋된 변경 파일·적용 패치·체크섬을 하나의 안전한 ZIP으로 만든다. 배포는 하지 않는다.
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$ROOT" ]] || { echo "ERROR: Git 저장소 안에서 실행하세요." >&2; exit 2; }
cd "$ROOT"

BASE="${1:-HEAD^}"
NAME="${2:-codex-delivery-$(git rev-parse --short HEAD)}"
OUT="${3:-$ROOT/deliverables/$NAME.zip}"
git rev-parse --verify "$BASE^{commit}" >/dev/null
[[ -z "$(git status --porcelain)" ]] || { echo "ERROR: 먼저 변경을 커밋하세요." >&2; exit 2; }
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "ERROR: ZIP 이름에는 영문·숫자·점·밑줄·하이픈만 사용하세요." >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PKG="$TMP/$NAME"
mkdir -p "$PKG/files" "$(dirname "$OUT")"

mapfile -d '' FILES < <(git diff --name-only --diff-filter=ACMRT -z "$BASE" HEAD)
[[ ${#FILES[@]} -gt 0 ]] || { echo "ERROR: $BASE..HEAD에 전달할 변경 파일이 없습니다." >&2; exit 2; }

for file in "${FILES[@]}"; do
  case "$file" in
    .env|.env.*|*.pem|*.key|*.p12|*.pfx|.wrangler/*|node_modules/*|.git/*)
      echo "ERROR: 비밀 또는 런타임 파일은 ZIP에 넣을 수 없습니다: $file" >&2; exit 3 ;;
  esac
  [[ -f "$file" ]] || continue
  mkdir -p "$PKG/files/$(dirname "$file")"
  cp -p "$file" "$PKG/files/$file"
done

git diff --binary "$BASE" HEAD > "$PKG/changes.patch"
git log --reverse --format='%H %s' "$BASE"..HEAD > "$PKG/COMMITS.txt"
{
  echo "Codex 변경 전달 패키지"
  echo "base=$BASE ($(git rev-parse "$BASE"))"
  echo "head=$(git rev-parse HEAD)"
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "주의: files/를 최신 저장소에 그대로 덮어쓰지 말고 changes.patch와 최신 코드를 비교하세요."
  echo "특히 기준 브랜치가 더 최신이면 요구사항을 최신 코드 위에서 다시 구현해야 합니다."
} > "$PKG/README.txt"
(cd "$PKG" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
(cd "$TMP" && zip -q -r "$OUT" "$NAME")
sha256sum "$OUT" > "$OUT.sha256"
echo "$OUT"
echo "$OUT.sha256"
