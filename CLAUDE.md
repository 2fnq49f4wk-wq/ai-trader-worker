# 작업 지침 (사용자 지정)

## 브랜치·배포
- Claude와 Codex 모두 작업 전에 루트 `AGENTS.md`와 `AI_HANDOFF.md`를 읽는다.
- **항상 `main`에서 직렬로 작업한다.** 작업 전 `git pull --ff-only origin main`, 작업 후 검사·커밋·
  `git push origin main` 순서를 지킨다. push가 실패하면 `AI_HANDOFF.md`에 원인과 미푸시 커밋을 남긴다.
- `main` push 시 GitHub Actions `Deploy to Cloudflare Workers`가 프로덕션(Cloudflare Worker)에
  자동 배포한다. `trainer/modal/**` 변경 시 `Deploy Modal Trainer`가 Modal 학습기를 재배포한다.
- 배포 전 안전게이트: `node --check src/index.js` 통과 필수(구문오류 시 배포 차단).
- 토큰 소진·중단 가능성이 있으면 완성 전이라도 안전한 최소 단위로 커밋하되, `AI_HANDOFF.md`에
  미완료 상태·마지막 검증·다음 명령을 기록한다. 다른 AI는 그 커밋부터 이어서 작업한다.

## 한국주식 종목 추가 규칙
- 티커는 **네이버 기준**: KOSPI = `.KS`, KOSDAQ = `.KQ` (접미사 주의).
- 종목 추가 시 세 곳을 함께 갱신한다: `DEFAULT_KR`(유니버스), `NAME_MAP`(종목명),
  `MCAP_RANK`(시총순위 정적 폴백 — 실시간 시총은 `mcap_shares`의 가격×주식수).
- 상장폐지·피인수 종목은 넣지 않는다.
