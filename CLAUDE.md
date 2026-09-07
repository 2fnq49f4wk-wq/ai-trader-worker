# 작업 지침 (사용자 지정)

## 브랜치·배포
- Claude와 Codex 모두 작업 전에 루트 `AGENTS.md`와 `AI_HANDOFF.md`를 읽는다.
- **항상 `main` 브랜치에서 직접 작업하고 배포한다.** 별도 feature 브랜치나 PR 우회 없이
  main에 바로 커밋·푸시한다. (2026-07-20 사용자 지시 / 2026-09-07 재확인)
- **작업 시작 전 반드시 최신 `main` 을 바닥으로 삼는다** (Claude·Codex 등 도구 공통):
  `git fetch origin main && git log --oneline -1 origin/main` 로 최신 판을 확인하고,
  로컬이 그보다 뒤져 있으면 `git pull --ff-only origin main` 으로 먼저 맞춘 뒤에 코드를 고친다.
  ※ 2026-09-07 사고: 다른 도구가 V33.304 에서 갈라진 옛 브랜치 위에서 V33.309 를 만들었다.
    그 바닥엔 V33.306·307·308 이 통째로 없어 게이트가 80종(현재 82종)뿐이었다.
    뒤진 바닥의 변경이 얹히면 새 게이트가 조용히 사라진다 —
    `tools/check-stale-base.mjs` 가 배선 누락과 버전 되감기를 막는다.
- 완료 후에는 검사 → 커밋 → `git push origin main` 순서를 지킨다. push가 실패하면
  `AI_HANDOFF.md`에 원인과 미푸시 커밋을 남긴다 — 다른 AI는 그 커밋부터 이어서 작업한다.
- 토큰 소진·중단 가능성이 있으면 완성 전이라도 안전한 최소 단위로 커밋하되, `AI_HANDOFF.md`에
  미완료 상태·마지막 검증·다음 명령을 기록한다.
- `main` push 시 GitHub Actions `Deploy to Cloudflare Workers`가 프로덕션(Cloudflare Worker)에
  자동 배포한다. `trainer/modal/**` 변경 시 `Deploy Modal Trainer`가 Modal 학습기를 재배포한다.
- 배포 전 안전게이트: `node --check src/index.js` 통과 필수(구문오류 시 배포 차단).

## 한국주식 종목 추가 규칙
- 티커는 **네이버 기준**: KOSPI = `.KS`, KOSDAQ = `.KQ` (접미사 주의).
- 종목 추가 시 세 곳을 함께 갱신한다: `DEFAULT_KR`(유니버스), `NAME_MAP`(종목명),
  `MCAP_RANK`(시총순위 정적 폴백 — 실시간 시총은 `mcap_shares`의 가격×주식수).
- 상장폐지·피인수 종목은 넣지 않는다.
