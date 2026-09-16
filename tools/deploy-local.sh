#!/usr/bin/env bash
# ══ [V33.369] CI 가 죽었을 때 쓰는 ★수동 배포★ 경로 ═══════════════════════════════
#   2026-09-15~16, GitHub Actions 러너 시간이 고갈돼 배포가 4판 연속 막혔다
#   (작업 상세: runner_id 0 · steps 없음 = 러너가 배정된 적이 없다).
#   그동안 V33.365(I-2 표본 복사본 고침)·366(다운로드)·367(흰 화면)이 커밋만 되고
#   운영에는 V33.364 가 남아 있었다. ★고친 코드가 운영에 못 가면 안 고친 것과 같다.★
#
#   ★R2 바인딩★ CI 는 배포 직전에 wrangler.toml 의 R2 주석을 sed 로 푼다. 지금은
#     V33.191 이 그 블록을 ★영구 해제해 커밋★ 했으므로 그 sed 는 무동작이다 —
#     즉 손으로 배포해도 R2 는 붙는다. 그래도 같은 sed·같은 확인을 그대로 둔다:
#     누군가 다시 주석 처리하는 날 두 경로가 갈리면 안 되고, R2 없이 배포되면
#     V33.110 이후 장중 표본 수집이 ★조용히 우회하지 않고 멈추기★ 때문이다.
#     (이 주석의 첫 판은 "주석 처리돼 있다" 고 단정했는데 사실이 아니었다 —
#      check-deploy-local 이 잡아 줬다. 확인 없이 위험을 적지 않는다.)
#
#   쓰는 법:  bash tools/deploy-local.sh
#   필요:     Cloudflare 로그인(최초 1회 `npx wrangler login`) · Node 22
set -euo pipefail
cd "$(dirname "$0")/.."

restore() { git checkout -- wrangler.toml 2>/dev/null || true; }
trap restore EXIT

echo "① 게이트 — CI 와 ★같은 목록★ 을 워크플로에서 읽어 돌린다(적게 돌면 그게 구멍이다)"
mapfile -t GATES < <(grep -oE 'node tools/check-[A-Za-z0-9._-]+\.mjs' .github/workflows/deploy.yml | sort -u)
[ "${#GATES[@]}" -gt 0 ] || { echo "★게이트 목록을 못 읽었다 — 중단★"; exit 1; }
fail=0
for g in "${GATES[@]}"; do
  if ! $g >/dev/null 2>&1; then echo "   ✗ $g"; fail=1; fi
done
[ "$fail" = "0" ] || { echo "★게이트 실패 — 배포하지 않는다★"; exit 1; }
echo "   ✅ ${#GATES[@]}종 통과"

echo "② R2 바인딩 활성화 — CI(deploy.yml 'Enable R2 binding')와 ★같은 sed·같은 확인★"
sed -i \
  -e 's/^# \[\[r2_buckets\]\]$/[[r2_buckets]]/' \
  -e 's/^# binding = "MODELS"$/binding = "MODELS"/' \
  -e 's/^# bucket_name = "ai-trader-models"$/bucket_name = "ai-trader-models"/' \
  wrangler.toml
grep -q '^\[\[r2_buckets\]\]' wrangler.toml      || { echo "★R2 주석 해제 실패★"; exit 1; }
grep -q '^binding = "MODELS"' wrangler.toml       || { echo "★binding 해제 실패★"; exit 1; }
grep -q '^bucket_name = "ai-trader-models"' wrangler.toml || { echo "★bucket_name 해제 실패★"; exit 1; }
echo "   ✅ R2 바인딩 활성 확인 — 이게 없으면 장중 표본 수집이 멈춘다"

echo "③ 배포"
npx --yes wrangler@latest deploy 2>&1 | tee /tmp/lux-deploy.log

echo "④ wrangler.toml 원복 — 저장소 상태를 손대지 않고 되돌린다"
restore

# ══ ⑤ ★'명령이 성공했다' 와 '그게 살아 있다' 는 다르다★ ════════════════════════
#   O-1 의 교훈이 정확히 이것이다 — push 는 4판 연속 성공했는데 배포는 한 번도 안 됐고,
#   나는 그걸 "배포 완료" 라고 세 번 보고했다. 여기서는 ★서버에 물어봐서★ 확인한다.
WANT=$(grep -oE '^const _BUILD_VER = "[^"]+"' src/index.js | grep -oE 'V[0-9.]+')
URL=$(grep -oE 'https://[A-Za-z0-9._-]+\.workers\.dev' /tmp/lux-deploy.log | head -1)
echo "⑤ 배포 확인 — 이 판이 정말 서버에서 도는가 (기대 ${WANT})"
if [ -z "$URL" ]; then
  echo "   ⚠️ 배포 출력에서 주소를 못 찾았다. 화면의 빌드 배너로 직접 확인할 것(기대 ${WANT})."
  exit 0
fi
GOT=$(curl -fsS --max-time 20 "$URL/api/selfcheck" 2>/dev/null \
      | grep -oE '"build"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE 'V[0-9.]+' | head -1)
if [ "$GOT" = "$WANT" ]; then
  echo "   ✅ 서버가 ${GOT} 로 응답한다 — ★정말 올라갔다.★"
else
  echo "   🔴 서버는 '${GOT:-읽지 못함}' 이라고 답한다 — 기대 ${WANT}."
  echo "      배포 명령은 끝났지만 ★반영되지 않았다.★ 위 wrangler 출력을 확인할 것."
  exit 1
fi
