# Claude Code로 V33.309 배포하기

Codex 변경은 이 작업공간의 로컬 `main`에 커밋되어 있다. Claude Code가 **같은 저장소 폴더**를
열었다면 파일을 복사하거나 패치를 다시 만들 필요가 없다.

## Claude Code에 보낼 한 줄

> 루트 AGENTS.md와 AI_HANDOFF.md를 읽고 `bash tools/deploy-with-claude.sh --push`를 실행해. 충돌이 나면 원격 V33.308 변경을 보존하면서 V33.309 AI 관제실 변경을 합치고, 검사를 다시 통과한 뒤 main에 push해.

## 직접 실행

```bash
cd /workspace/ai-trader-worker
bash tools/deploy-with-claude.sh --push
```

스크립트는 다음을 자동으로 수행한다.

1. 현재 브랜치가 `main`이고 작업 트리가 깨끗한지 확인한다.
2. `origin`이 공식 저장소인지 확인한다.
3. 원격 `main`을 fetch하고, 원격에만 있는 V33.308 변경이 있으면 로컬 커밋을 그 위로 rebase한다.
4. AI 작동화면·모바일·빌드 버전·외부 AI 비활성화 정책 검사와 전체 `check-*.mjs` 검사를 실행한다.
5. 모든 검사가 통과한 경우에만 `main`을 push하여 Cloudflare 배포 워크플로를 시작한다.

스크립트에는 `--force` 경로가 없다. 충돌 또는 검사 실패가 있으면 push하지 않고 중단한다.

## 충돌이 발생한 경우

```bash
git status
# 충돌 파일을 수정하되 원격 V33.308 변경과 V33.309 관제실 변경을 모두 보존
git add <해결한 파일>
git rebase --continue
bash tools/deploy-with-claude.sh --push
```

취소하려면 다음을 실행한다.

```bash
git rebase --abort
```

## 배포 확인

GitHub Actions의 `Deploy to Cloudflare Workers`가 성공한 다음 사이트 설정의 AI 운영상태
스냅샷 또는 새 버전 배너에서 서버 `build`와 화면 판이 모두 `V33.309`인지 확인한다.

