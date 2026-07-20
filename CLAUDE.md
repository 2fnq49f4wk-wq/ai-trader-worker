# 작업 지침 (사용자 지정)

## 브랜치·배포
- **항상 `main` 브랜치에서 직접 작업하고 배포한다.** 별도 feature 브랜치나 PR 우회 없이
  main에 바로 커밋·푸시한다. (2026-07-20 사용자 지시)
- `main` push 시 GitHub Actions `Deploy to Cloudflare Workers`가 프로덕션(Cloudflare Worker)에
  자동 배포한다. `trainer/modal/**` 변경 시 `Deploy Modal Trainer`가 Modal 학습기를 재배포한다.
- 배포 전 안전게이트: `node --check src/index.js` 통과 필수(구문오류 시 배포 차단).

## 한국주식 종목 추가 규칙
- 티커는 **네이버 기준**: KOSPI = `.KS`, KOSDAQ = `.KQ` (접미사 주의).
- 종목 추가 시 세 곳을 함께 갱신한다: `DEFAULT_KR`(유니버스), `NAME_MAP`(종목명),
  `MCAP_RANK`(시총순위 정적 폴백 — 실시간 시총은 `mcap_shares`의 가격×주식수).
- 상장폐지·피인수 종목은 넣지 않는다.
