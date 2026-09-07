# Claude Code로 V33.309 배포하기

Codex 변경은 이 작업공간의 로컬 `main`에 커밋되어 있다. Claude Code가 **같은 저장소 폴더**를
열었다면 파일을 복사하거나 패치를 다시 만들 필요가 없다.

## Claude Code에 보낼 한 줄

> 루트 AGENTS.md와 AI_HANDOFF.md를 읽고 원격 최신 main을 fetch해. 로컬 V33.309가 최신 main을 포함하지 않으면 옛 커밋을 rebase·force push하지 말고, origin/main의 최신 코드 위에서 AI 관제실 요구사항을 다시 구현하고 최신 게이트를 전부 통과한 뒤 main에 push해.

## 직접 실행

```bash
cd /workspace/ai-trader-worker
bash tools/deploy-with-claude.sh --push
```

스크립트는 다음을 자동으로 수행한다.

1. 현재 브랜치가 `main`이고 작업 트리가 깨끗한지 확인한다.
2. `origin`이 공식 저장소인지 확인한다.
3. 원격 `main`을 fetch하고 현재 변경이 그 최신 이력을 바탕으로 만들어졌는지 검사한다.
4. AI 작동화면·모바일·빌드 버전·외부 AI 비활성화 정책 검사와 전체 `check-*.mjs` 검사를 실행한다.
5. 모든 검사가 통과한 경우에만 `main`을 push하여 Cloudflare 배포 워크플로를 시작한다.

스크립트에는 `--force`나 자동 rebase 경로가 없다. 원격이 더 최신이거나 이력이 갈라졌다면
오래된 UI를 배포하지 않고 중단한다.

## 원격이 더 최신인 경우

```bash
git fetch origin main
git worktree add ../ai-trader-worker-latest -b claude/ai-ops-latest origin/main
cd ../ai-trader-worker-latest
# 최신 public/index.html과 최신 검사들을 먼저 읽은 뒤 관제실을 다시 구현
```

옛 V33.309 커밋은 요구사항 참고용으로만 비교하고 통째로 cherry-pick하지 않는다.

## 배포 확인

GitHub Actions의 `Deploy to Cloudflare Workers`가 성공한 다음 사이트 설정의 AI 운영상태
스냅샷 또는 새 버전 배너에서 서버 `build`와 화면 판이 새 구현 버전으로 일치하는지 확인한다.
