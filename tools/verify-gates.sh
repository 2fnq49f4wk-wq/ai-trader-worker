#!/usr/bin/env bash
# ══ [V33.372] 게이트만 돌린다 — 배포 수단과 분리 ═══════════════════════════════
#   목적: GitHub Actions 없이 배포할 때도 ★CI 와 똑같은 검사★ 를 거치게 한다.
#   쓰는 곳 둘:
#     · tools/deploy-local.sh 의 1단계
#     · Cloudflare Workers Builds 의 "Build command"
#       (거기서 실패하면 Cloudflare 가 배포를 중단한다 — 그게 이 스크립트를 쓰는 이유다)
#
#   ★실행줄을 통째로 읽는다 — 이름만 뽑으면 안 된다.★
#     첫 판은 `node tools/check-…\.mjs` 만 뽑았다. 그런데 한 게이트는
#       run: node --experimental-sqlite tools/check-d1-scan.mjs
#     처럼 node 와 경로 사이에 플래그가 있다. 그 한 종이 ★조용히 빠져★ 135/136 만 돌았고,
#     "135종 전부 통과" 라는 초록불이 떴다. 적게 도는 줄 아무도 모르는 게 이 종류의 본질이다.
#     그래서 아래 ③ 에서 ★파일 수와 실행 수가 같은지★ 를 직접 센다.
set -uo pipefail
cd "$(dirname "$0")/.."

# [V33.372] 검사 대상 워크플로를 바꿔 끼울 수 있게 한다 — ★안전망을 시험하기 위해서다.★
#   "빠진 게이트가 있으면 멈춘다" 는 분기는 평소엔 안 걸려서, 지워도 아무 일이 없다
#   (돌연변이 시험에서 실제로 안 잡혔다). 게이트가 일부러 한 종을 뺀 사본을 물려
#   그 분기가 정말 멈추는지 확인한다.
WF="${VERIFY_GATES_WF:-.github/workflows/deploy.yml}"

# ① 실행줄 원문(플래그·인자 포함)을 그대로 뽑는다
mapfile -t GATES < <(grep -oE '^[[:space:]]*run:[[:space:]]*node[^|>]*tools/check-[A-Za-z0-9._-]+\.mjs[^#]*' "$WF" \
                     | sed -E 's/^[[:space:]]*run:[[:space:]]*//; s/[[:space:]]+$//' | sort -u)
if [ "${#GATES[@]}" -eq 0 ]; then
  echo "★게이트 목록을 못 읽었다 — 0종 통과를 성공으로 읽지 않는다.★"; exit 1
fi

# ② tools/ 의 게이트 파일 중 실행줄에 안 나타나는 것이 있으면 멈춘다
missing=()
for f in tools/check-*.mjs; do
  case " ${GATES[*]} " in *"$f"*) ;; *) missing+=("$f");; esac
done
if [ "${#missing[@]}" -ne 0 ]; then
  echo "★게이트 ${#missing[@]}종이 실행 목록에서 빠졌다 — 초록불이 거짓이 된다:★"
  printf '   %s\n' "${missing[@]}"
  exit 1
fi

echo "게이트 ${#GATES[@]}종 실행 (tools/ 파일 $(ls tools/check-*.mjs | wc -l)종 전부 포함)"

# ③ 목록만 확인하고 끝내는 모드 — ★재귀를 막는 유일한 방법이다.★
#    check-deploy-local 이 이 러너를 검사하는데, 그 러너가 게이트를 전부 돌리면
#    자기 자신을 다시 부른다(무한재귀). 그래서 검사 쪽은 이 모드만 쓴다.
if [ "${VERIFY_GATES_LIST_ONLY:-}" = "1" ]; then
  echo "(목록 확인 모드 — 게이트를 돌리지 않는다)"; exit 0
fi
fail=0; failed=()
for g in "${GATES[@]}"; do
  if ! eval "$g" >/dev/null 2>&1; then echo "  ✗ $g"; failed+=("$g"); fail=1; fi
done
if [ "$fail" != "0" ]; then
  echo "★${#failed[@]}종 실패 — 배포하면 안 된다.★ 자세히 보려면 위 명령을 그대로 실행할 것."
  exit 1
fi
echo "✅ ${#GATES[@]}종 전부 통과"
