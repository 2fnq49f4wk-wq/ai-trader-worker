> ## ⚠️ 결함 목록 — `docs/OPEN-DEFECTS.md`
> 미해결 결함과 **V33.348 에서 고친 것**이 함께 정리돼 있다. 작업 전 반드시 확인할 것.
> - 미해결·치명: `A-1` 시간외 안전장치가 실제 경로에 안 걸림.
> - 고쳤지만 한 번 더 확인: `D-3` D1 재시도 매수 이중기록(과거 중복 행 조회 필요) ·
>   `D-2` 한국 매도세 연도별 · `C-3`·`C-4` D1 부하 · `B-7` 반사실 라벨 진입정렬 · `F-1`·`F-4`.
> - 고쳤지만 실효는 재수확 때: `B-8` 수확 표본 ts 가 가짜 달력(featVer 상향 시점은 사람이 정한다).
> - 고친 항목은 그 파일에 해결 표시 + 커밋해시를 남길 것.

# AI 작업 인계 상태

> 이 문서는 Claude Code와 Codex가 토큰 소진·세션 중단 후에도 커밋 경계에서 안전하게 이어가기 위한 체크포인트다.

## Current handoff

### [PERF] 전문가 대시보드 지수 카드·TOP MOVERS 첫 화면 단축 (에이전트 · 푸시 안 함 · _BUILD_VER 안 올림)
- 원인: 둘 다 pub/state.js(800KB · br 237KB · 시세 1,004종목)가 와서 파싱돼야 그려졌다(서버 응답은 빠름 · CDN HIT). 실측(Playwright, 1440x900): 빠른 망 콜드 1.4s·웜 0.7s(저장 사본) / 1.6Mbps·150ms 에서 2.8~3.6s.
- 수정: 크론 statePubWrite 가 같은 본문에서 지수 + 시장별 상·하위 후보(정규·시간외 각 20 · 93종목 · 28KB)만 뽑아 R2 `pub/f/dash_top.js` 에 1분마다 씀(R2 쓰기 +1/분 · 방문자 수와 무관). index.html 머리에서 `__earlyTop` 로 /api/state 와 동시에 받아, 전체 상태보다 먼저 오면 renderFvDeck({__partial:1}) 로 지수·TOP MOVERS 만 그림(시장폭·타이머·헤드라인은 전체 상태가 오면). 저장 사본이 그렸거나 전체 상태가 먼저면 무시. 전체 상태 도착 뒤 목록은 동일함을 확인.
- 실측(소스 HTML + 가짜 dash_top, 수정 전→후): 빠른 망 0.78~1.34s → 0.47~0.52s · 느린 망 2.8~3.6s → 1.3~1.5s. 라이브 확인은 배포 뒤 `window.__fvTopAt` 로(없으면 dash_top.js 미생성/CDN 실패).

### V33.810 — 사이드바 140px · 내용 높이만큼 떠 있는 패널(빈 공간 제거) · 글자 잘림 해소 · 배경 더 어둡게 + 거울 수면 달빛 기둥

### V33.809 — 어두운 테마 배경 호숫가 달밤(public/bg/lake-wide.jpg · lake-tall.jpg · 코드 렌더 · lux-navy.css 맨 끝)

### V33.808 — 흰·검·남색 팔레트·애플 유리(lux-navy.css) · 사이드바 모든 화면 동일 · 폭 132px · 한 화면에 전부(스크롤 없음) · AI 작동원리 남색 유리

### V33.807 — 종목 상세 패드·PC 2열(차트 44% + 시세·심리 패널) · 목록·상세 10~15% 축소(detail-v3c.css)

### V33.806 — 전문가 지수·TOP MOVERS 빠른 첫 표시(R2 pub/f/dash_top.js 28KB · __earlyTop 부분 렌더 · 확인 window.__fvTopAt)
### [UI4] 남색·흰·검정 팔레트 · 슬림 · 액체 유리+ · 사이드바 148px 고정 · AI 작동원리 유리 (에이전트 · 푸시 안 함 · _BUILD_VER 안 올림)
- 사이드바 버그 원인 = detail-v3b.css 의 html:has(#page-detail.active) .sidebar/.sb-* 규칙(종목 상세일 때만 글자 12.5px·색 변경) → 전부 삭제. 이제 어느 화면에서나 148px 동일(실측). 새 시트 public/lux-navy.css(사이드바 압축·유리 하이라이트·남색 알약) · AI 작동원리 유리 규칙(구조 그대로)도 lux-navy.css 뒤쪽에 합침. index.html 에 lux-glass.css 뒤 링크 1줄. 되돌리기 = 링크 제거.
- 팔레트: lux-polish/lux-glass 토큰을 남색으로(보라·청록 제거), mine.js·easy-dash.js 의 청록 #3DD6B5 → 남색 #9DB4E8. 반경 24→18/20→13 등 슬림화. 시세색·히트맵·상태색 유지.
- 통합자: 새 CSS ?v= 는 판 올릴 때 같이.

### V33.805 — 패드 종목 목록 이름 잘림 수정(detail-v3b.css) · sticky 탭 바 불투명

### V33.804 — 종목 상세 v3.1 배포(detail-v3.css/js · detail-v3b.css 가독성 · 컴팩트 머리 64px · 패드는 차트 아래 AI 분석). 남은 것: 영어 문구 일부 · 차트 눈금 글자(축소 렌더)

### V33.803 — 리퀴드 글래스 전 화면(public/lux-glass.css · 사이드바 유리 패널 · 알약 늘어남 모션). blur 는 탭바·드로어·모달·검색·토스트·로그인에만(스크롤 fps 때문). 되돌리기 = lux-glass.css 링크 제거

### [UI3] 리퀴드 글래스 전 화면 (에이전트 · 푸시 안 함 · _BUILD_VER 안 올림) — 되돌리기 = index.html 의 lux-glass.css 링크 1줄 제거
- 새 파일 public/lux-glass.css(lux-polish.css 뒤 마지막 시트 · 오로라 html::before 고정 그라데이션 · 떠 있는 사이드바(≥768px)/아래 탭/드로어 · 쉬운·전문가 대시보드 · MY · 모달·검색·토스트·로그인창). lux-motion.js: 알약 '늘어났다 자리잡기'(scaleX/Y 스트레치+스프링).
- 성능 실측(헤드리스): 스크롤 큰 카드·사이드바에 backdrop-filter 를 쓰면 데스크톱 60→22fps → 사이드바·쉬운 카드는 blur 없음, blur 는 아래 탭·드로어·모달·검색·토스트·로그인창만. 통합자: lux-glass.css ?v= 는 판 올릴 때 같이(현재 33.802).
- 라이트 모드는 index.html 의 !important 카드 규칙(:is(...) )을 이기려고 `html[data-theme=light] body :is(...)` + !important 로 덮었다. #page-detail 은 건드리지 않음(공용 토큰 --gl-* 만 공유).

### V33.802 — 새 디자인 배포(lux-polish.css · lux-motion.js + vendor/anime.min.js · 첫 방문 배너 #luxHero · 가입 전 3장 홍보). 되돌리기 = lux-polish.css 링크 제거

### [UI1] 테마 폴리시 · anime.js 모션 · 첫 방문 소개 배너 · 가입 홍보 슬라이드 (에이전트 · 푸시 안 함 · _BUILD_VER 안 올림)
- 새 파일: public/lux-polish.css(덧입힘 한 장 · 지우면 복구) · public/lux-motion.js(미끄럼 알약 표시기 사이드바/.m-tabbar · 페이지 전환 · 카드 등장 · 카운트업) · public/vendor/anime.min.js(v3.2.2 로컬).
- index.html: 머리 판정 스크립트(첫 방문·비로그인·앱 아님·봇 아님·?intro=0 아님, ?intro=hero 강제) + body 첫머리 #luxHero 인라인 배너 + 링크 2줄. mine.js: ask() 3번째 인자(arguments[2])=소개 건너뛰기 · 가입 소개 3장 자동 회전 슬라이드(gStart·gApp·gGuest·data-m 유지).
- 통합자: 새 파일 ?v= 는 판 올릴 때 같이(현재 33.801 로 적어 둠). 다음: 라이브 확인 · easy-dash 카운트업 실데이터 확인.

- [종목 상세 UI v3.3] (11/10 · 에이전트 · 푸시 안 함 · _BUILD_VER 안 올림) 새 `public/detail-v3c.css`(v3b 뒤, index.html 링크 1줄 — 되돌리기=링크 삭제). ≥901px 상세는 2열 그리드(왼 60% 차트 44vh → AI 분석 → 뉴스 → 재무 / 오른 40% 시세 데이터 → 심리·목표가 패널), 761~900 세로 패드는 차트 39vh → AI 분석 → 시세 데이터 → 정보 카드 2열(columns:2). 761px+ 에서 목록·상세 글자/여백/행 ~12% 축소(본문 13px·보조 12px 하한). 목록 행 102→80px · 한 화면 행 수 패드세로 12→21 · 패드가로 8→14 · 데스크톱 8→16. 폰은 그대로. 2열 차트는 SVG 가 축소 렌더돼 차트 글자를 키움. 통합자: detail-v3c.css ?v= 는 판 올릴 때 같이.
- [종목 상세 UI v3.1] (11/10 · 에이전트) 가독성 상향 · 컴팩트 히어로 · 패드 배치. 새 파일 `public/detail-v3b.css`(detail-v3.css 뒤에 덧입힘) — 카드 거의 불투명 · 글자색 변수(#page-detail 의 --t1/2/3 · --pos/--neg 상향) · 12px 미만 글자 제거 · 사이드바 상태 글자(html:has(#page-detail.active)) · luxmini-view.js 글자·대비 상향.
  히어로 한 줄 64px(폰 ~110px) — 시고저종 칩은 툴팁(title)로. 패드(761~1180px)는 #detailContent 를 flex column + .detail-main/.detail-left/.detail-below display:contents 로 풀어 차트 → AI 분석(#luxInfo) → 시세 데이터 · 뉴스 · 오른쪽 패널 · 재무 순.
  한계: 패드 세로(820)의 캔들 차트 눈금 숫자는 SVG 축소로 ~8px(축을 키우면 오른쪽이 잘림) · 폰 차트 글자 ~5px(원래 SVG 축소). 사이드바 초보자/전문가 토글 글자색은 JS 주입이라 못 건드림.
- [종목 상세 UI v3] (11/10 · 에이전트 · 판 번호·_BUILD_VER 는 통합자가 붙임 — 소스 표식 "[UI v3]") ★종목 상세 글래스 핀테크 리디자인★
  새 파일 `public/detail-v3.css`(전부 `#page-detail` 안으로 변수·선택자를 가둠 · index.html 에서 workspace-layout.css 뒤에 링크) · `public/detail-v3.js`(index.html 에서 stock-info.js 뒤에 defer).
  히어로: 라이브 점(장 상태) · 큰 가격 카운트업 · 그려지는 스파크라인(/api/chart 1y 1d — AI 분석 탭과 같은 주소라 캐시 공유) · 시세 칩 · 주문 버튼(mine.js 의 #mineDetailBar 를 #dv3Act 로 옮김 · id 그대로).
  패드/PC: 히어로 sticky(top=--dtop) + 스크롤 150px 넘으면 컴팩트(.dv3-compact) · 정보 탭 바는 그 아래 sticky. 폰: 히어로는 sticky 아님(탭 바 안 .lxh 가 압축 머리 역할) · --dtop 로직·html.lux-mfull 그대로.
  기간 탭(#detailTf)·정보 탭(.lxt)에 미끄러지는 알약(.dv3-tfpill · .lxpill) · 패널 페이드/슬라이드(.lxp) · 숫자 카운트업/막대 성장(window.dv3Motion — window.anime 있으면 v3·v4 API 로, 없으면 rAF/WAAPI · prefers-reduced-motion 이면 움직임 없음).
  AI 분석(stock-analysis.js): 판정 카드에 핵심 가격대 수평 막대(lvBar) · 시나리오 상승/하락 나란히 · 체크포인트 타임라인(ul.lxa-tl) · 차트에 그라데이션 면 · 애널리스트 매수 의견 링(ring; window.luxAnalysis._ring).
  정보 탭(stock-info.js): KPI/개요 타일에 아이콘 · KPI 맨 위 F-Score 링 · 밸류에이션 업종 중앙값 비교 막대(.pr.cmp). 검사: node --check 3종 · tools/check-build-ver.mjs · Playwright(폰 393x852·패드 820x1180 · 다크/라이트 · NVDA/005930.KS) 가로 넘침·콘솔 오류 0.
  ★주의★ detail-v3.js 의 MutationObserver 는 pill 에 class 를 다시 쓰면 무한 루프 — place() 안에서 이미 있는 class 는 add 하지 않는다. 다음 확인: 영문 모드(i18n) 에서 새 한글 문구(시간외·장중 · LIVE · 상승/하락 시나리오 아이콘 등) 영어 표 추가.

### V33.801 — 지수 위상 안전장치(regimePhase · 하락장 반등일 MELTUP 불가) · 게이트 check-regime-phase-sanity · 다음 확인: pb_regime 나이를 ts 대신 day 로 잴지

### V33.800 — 정식 국면 가중 투표(regimeCanon · REGIME_CANON_CFG · 사용자 승인 11/10) · 인버스 차선은 10년 대리 손익 음수 경고에도 사용자 지시로 그대로 유지(실전 성적으로 재판단)

- [위상 안전장치] (11/10 · 에이전트 · 판 번호·_BUILD_VER 는 통합자가 붙임 — 소스 표식 "[위상 안전장치]") ★지수 위상 안전장치 — 하락장 반등일 MELTUP 금지★
  증상: 라이브 /api/ai-mode 韓 phase MELTUP(정식 국면 원천 phase +2 ×1.4) 인데 같은 표 추세 'MA50 −17.1%'. 美도 MELTUP.
  1차 자료 확인: 입력은 맞았다 — 네이버 코스피 +4.49%·코스닥 +3.84%(11/10 12:07 KST 장중) = mkt_phase dayKr 4.07 · ^KS11/^KQ11/069500.KS /api/chart 같은 흐름
    (코스피 60일 고점 −26% · MA50 −17.1% · 5일 −7.2% · 20일 −13%). 지수 기호(^KS11·^KQ11) 정상 · 단위(%) 정상 · 美 자료 섞임 없음.
    美 11/9 4지수 평균 +2.6%(S&P +2.35 · 나스닥 +2.74) · 20일 평균 −2.0% · 나스닥 MA50 −4.5%.
  원인: analyzeMarketRegime 위상 분기 'today ≥ +2% → MELTUP'(V33.54 가 오늘 등락을 1급 신호로 올림)이 추세(MA50·20일·5일)를 전혀 안 봄 → 하루 반등 = 폭등.
    MELTUP 은 레버리지 천장 2.2 · 폭등 단타(레버리지 ETF) · 넓은 트레일·늦은 익절 · sizeMult 1.15 를 켠다.
  고침: ① 순수 함수 regimePhase(x) 로 분기 이동(워커·평가 도구·게이트가 같은 식) · 안전장치 —
          하락장 반등일(지수 평균 MA50 −5% 아래 · 5일 음수)은 MELTUP·TREND_UP 불가 → RANGE(guard bounce) ·
          그 밖에 MA50 −5% 아래 또는 20일 음수면 MELTUP 불가 → TREND_UP(guard belowMa50/neg20). vs50 은 이미 읽은 60봉 regimeFeat(추가 D1 0).
        ② regimeCanon: SURGE 는 MA50 −5% 아래 또는 20일 음수면 BULL 로(src surgeGuard).
        ③ mkt_phase 에 rawUs/rawKr·guardUs/guardKr·vs50Us/vs50Kr → /api/ai-mode phase → 화면 '오늘 지수 흐름' 에 '(폭등 → 보합 · 하락장 반등일 — 추세 아님)' · MA50 표시.
        ④ tools/eval-regime-canon.mjs 가 식 복제 대신 grab("regimePhase") (PHASE_OLD=1 이면 안전장치 전 raw 로 비교).
        ⑤ 게이트 tools/check-regime-phase-sanity.mjs(deploy.yml 등록) — 진짜 analyzeMarketRegime 에 11/10 지수 60봉 → 韓 옛 MELTUP ⇒ RANGE · 美 옛 MELTUP ⇒ TREND_UP 재현.
  지금 자료 전/후: 韓 위상 MELTUP → RANGE · 정식 국면 CRASH(점수 0.00) → CRASH(점수 −0.70 · 근거 override: 60일 고점 −27% · 5일 음수 — 그대로).
                  美 위상 MELTUP → TREND_UP · 정식 국면(특징 포함 재계산) NEUTRAL(−0.12) → BEAR(−0.33; 정식 문턱 −0.2) — 美 BEAR 면 인버스 차선 SH 6% 대상.
  10년 평가(2022~ 검증, 전→후): 美 위상 뒤집힘/년 143→139 · 정식 방향 55.4→55.7 · 거짓폭락 40→38.4% · 인버스 대리 Sharpe −0.64→−0.52 ·
                  韓 위상 지금국면 33.5→34.8 · 정식 방향 48.1→47.3(약간 약화) · 폭락일 179→182 · 놓침 0 유지. 대체로 중립 — 정확성 안전장치로 채택.
  남은 것: pb_regime.us day=20261106 인데 ts 는 11/10 업로드 시각 → regimeCanon 의 학습기 나이(ts 기준)가 실제보다 젊게 잡힘(美 pb CRASH 가중 0.24). 다음 국면 작업에서 day 기준 나이 검토.
  검사: node --check 통과 · check-regime-phase-sanity 통과 · bash tools/verify-gates.sh "228종 전부 통과"(check-walk-forward 포함).
- V33.797 국면 (11/9 · 국면 에이전트 · _BUILD_VER 안 올림) ★정식 국면 정확도 — 'min' → 가중 투표★
  원인: 11/9 美 지수 위상 MELTUP 인데 pb_regime 이 11/6 CRASH(3일 끈적임+하루 늦음) → 정식 CRASH → 인버스 차선이 폭등장에 인버스 매수.
  ① regimeCanon(phase, pb, ctx, feat, {market, prev}) — 원천 점수(−2…+2)×가중치 평균: 지수 위상 · 학습기(반감기 1일 · 4일 넘으면 제외) · 거시(ts 하루 넘으면 반감) ·
     추세(MA50 위치·5일 기울기) · 60일 고점 낙폭 · 20일 실현 변동성 · 직전 사이클 시장폭(__brLast · D1 0). 시장별 가중치·문턱 REGIME_CANON_CFG.
     안전장치: 오늘 −3% 이하 또는 낙폭 −15%+5일 하락 → CRASH · 오늘 지수 위상 CRASH 면 최소 BEAR · 낙폭 −6% 안 되는 CRASH 는 BEAR · 히스테리시스 0.2(__canonPrev 6h).
  ② regimeFeat(hists) — analyzeMarketRegime 이 이미 읽은 60봉으로 계산(regimes[m].feat). ai-mode 는 regime_snap:{m}.canon(매매가 쓴 값 · 2h) 우선(같은 getStates 질의).
  ③ 평가: node tools/eval-regime-canon.mjs <Yahoo 10y 일봉 폴더> [--tune] — 데이터 없으면 자체 시험(11/9 재현)만. 2016~21 맞춤 / 2022~ 검증.
     검증(2022~): US 지금국면 방향 42.2→55.4% · 뒤집힘/년 128→59 · 폭락일 139→130 · 거짓폭락 37→40% · 놓친 하락구간 0 · 첫 하락 감지 2.4→7.4일(느려짐).
                  KR 방향 42.7→48.1% · 폭락일 252→179(거짓 111→85일) · 뒤집힘 98→98 · 놓침 0 · 감지 1→1.8일. 앞 20일 방향은 KR 40.6→35.5(약화).
     ★발견: 어느 원천이든 'CRASH→−2x·BEAR→−1x' 인버스 대리 손익이 10년 모두 음수(Sharpe −0.3~−1.1, 평균회귀) — 인버스 차선 자체의 기대값 재검토 필요(차선 성적 배수로 줄어들기는 함).
  ⑤ 검사: verify-gates 226종 통과 · check-walk-forward 는 python ETIMEDOUT(동시 에이전트 부하 · 파이썬 무변경) — 한가할 때 단독 재실행.
  ④ 화면 '정식 국면' — 점수·신뢰·원천별 값과 가중치(%) 표시.
### V33.799 — 통합: KR 규칙 단타 퇴출(KR_RULE_SCALP_RETIRED) · 미국 AI 주도 스냅 퇴출(AI_ROUTE_RETIRE) · 신규 매매법 7종×2(정식 4·그림자 3, trainer playbook_sim NEW_PB_V798) — 다음 학습 회차 pbStat 음수면 그림자로

- V33.798(에이전트 · _BUILD_VER 안 올림) ★신규 매매법 7종 × 2시장 — 정식 2순위 4종씩 · 나머지 그림자★
  검증 trainer/research/newpb_eval.py(10년 일봉 · 하루 늦은 종가 진입 · 비용 미0.10/한0.30% · 앞 70% 에서 청산 5종 중 PF 로 고름 · 뒤 30% 판정).
  채택 = 판정 PF≥1.1 · n≥100 · 앞 PF≥1.0 · 판정 시장초과>0. 고른 청산 전부 손절 10% · 30일(NEW_EXIT_V798).
  美 정식 GAPGO_VOL(n347 PF1.56 승49.6 초과+1.03) · HI52_VOLBRK(2109 · 1.55 · 52.9 · +0.37) · VCP_BRK(2728 · 1.64 · 55.0 · +0.20) · INSIDE_BRK(3623 · 1.50 · 53.4 · +0.05)
     그림자 RSI2_UPTR(PF1.49 이지만 초과 −0.01) · FLUSH_RS(n78) · MA200_RECLAIM(PF1.03)
  韓 정식 HI52_VOLBRK(1811 · 1.58 · 37.9 · +1.36) · RSI2_UPTR(5908 · 1.46 · 39.3 · +0.77) · VCP_BRK(1438 · 1.58 · 38.7 · +1.06) · INSIDE_BRK(2129 · 1.42 · 37.9 · +0.82)
     그림자 GAPGO_VOL(PF1.20 초과 −0.17) · FLUSH_RS(PF1.04) · MA200_RECLAIM(PF0.99)
  배선: playbook_sim NEW_PB 에 정식 추가(2순위 · 기존 매매법 손 안 댐) · 그림자는 shadow_eval → body.daily.shadow → 워커 /api/playbook 저장·GET → 두뇌 매매법 표 '그림자' 표지(실전 매수 없음).
  한글 이름표 PlaybookDeck PB_NAMES · brain-studio.js 재빌드. ※ 판정 구간이 상승장이라 PF 는 부풀려짐 — 시장초과가 진짜 우위. 생존 편향 주의.
  다음: 다음 학습기 회차 로그 '[그림자매매법]' · pbStat 에서 신규 정식의 판정 전/판정(OMNI-Q 후보 거름 뒤) 확인 — 음수면 NEW_PB_V798 에서 빼 그림자로.
- V33.797-pb (11/9 · 버전 그대로 · 에이전트) 매매법 실적 점검 — 원장 포지션 단위(180일 · FIFO · 앞/뒤 절반=홀드아웃):
  美 core PF 0.62 끌어내린 것: RULE:SCALP SC_VWAP 76건 PF 0.53(뒤 0.35 · 관문 시험 중) · AI-SCALP 22건 0.41(시험) · ★AI:SNAP SN_RSI 14건 PF 0.22(앞 0.03/뒤 0.41)★ · AI-Q:TREND 12건 0.38(시험차선 대상 — V33.797 설계 유지).
  같은 SN_RSI 의 규칙 경로 RULE:SNAP 20건 PF 4.05(뒤 10.5) · AI:TREND 115건 1.11 · RULE:TREND TR_PULLBACK 76건 1.02(뒤 1.23) · TR_RS_LEADER 9건 2.5.
  조치: AI_ROUTE_RETIRE={us:[snap]} — 미국 AI 주도 경로에서 스냅 후보 제외(추세로 감). 규칙 스냅·한국 그대로. 화면: 두뇌 '매매 차선' 표에 '퇴출 매매법' 행 · /api/perf-gate retiredAiRoutes.
  남은 손실(관문이 이미 막음/시험): 韓 RULE:SCALP(다른 에이전트 범위) · 韓 AI:TREND 96건 PF 0.60(뒤 0.51 · 관문 시험) · cm CM-SWING 34건 0.59(뒤 1.08 회복 중). 백테스트로 새 규칙을 만들진 않음(홀드아웃 PF≥1.1 근거 없는 수정은 안 넣음).
  다음: 美 AI:TREND 건수·PF 가 스냅 퇴출 뒤 유지되는지 /api/perf-gate us:AI:TREND 확인.
- (11/9 · 에이전트 · 버전 안 올림 — 통합자가 올림) ★KR 규칙 단타 퇴출★ KR_RULE_SCALP_RETIRED(src/index.js SCALP 상수 옆) — `_ruleScalpOk` 가 저장 cfg usOnly 와 무관하게 한국 평시 규칙 단타(SC_VWAP·SC_PULLBACK·SC_MOMENTUM·SC_VBURST)를 막는다.
  진단: lanes kr:core:RULE:SCALP 40건(PF 0.397)은 전부 6/9~7/1 원장(그 뒤 usOnly=true 로 이미 0건 · 관문 probation n0). 손실 = 40분 시간컷(대개 −0.4~−1%) + 1.2~2.2% 손절이 정상 흔들림에 털림 + 왕복 비용 ~0.21%(매도세 0.18+수수료)가 +1.2% 익절의 1/6. 비용 빼도 총평균 음수.
  백테스트(네이버 1분봉 50종목 11/2~11/9 · 정규장만 · 비용 0.23% · 2폴드 3일/3일): 옛 규칙 학습 PF 1.21(n9) → 홀드아웃 PF 0(n5) · 전 6일 PF 0.56(n14) · 일봉 필터 없이 PF 0.60(n530).
    288 변형 중 양 폴드 PF≥1.1 은 11개 — 전부 '일봉 필터 끔 · 손절 2% · 시간컷 없음'이고 수익 대부분이 11/6 하루(갭하락 후 반등 41건 95%) · 일봉 필터를 켜면 6일 2건. 한 주·한 국면이라 채택 안 함.
  화면: 두뇌 '매매 차선' 표에 'KR 규칙 단타 퇴출' 행(ai-mode lanes.krScalp) · 신호 막대 라벨 SC_VWAP/SC_PULLBACK '(KR 퇴출)'. 패닉 인버스·폭등 레버리지·AI 단타·미국 단타는 그대로.
  되살리기: 다른 국면 포함 4주+ 분봉 홀드아웃 PF≥1.1 후 retired=false.
### V33.798 — 폰 상단 바 = 로고 + 초보자/전문가 전환만(#mTopSlim) · 검색은 아래 탭(data-search) · 메뉴·상태는 아래 '메뉴' 드로어

- V33.797 (11/9) ★사용자 명시 지시(모의 자금): "맞으면서 배운다" — 실적 관문 막힘·폭락 국면에도 AI 가 거래해 자료를 모으고 약한 곳은 크기로 고친다.★
  ※ 종전 '위험 관문 완화 금지' 선호를 이 범위에서 사용자가 덮어씀. 관문 판정 자체(perf_gate 막힘·시험·합산·문턱)는 그대로 — 막힌 매수를 ★작게★ 따로 들인다.
  ① 시험 차선(PROBE_LANE): 실적 관문이 막은 AI-Q·SROUTE·INV 매수 → 수량 ×0.3 × 차선 성적 배수 × 차선·신호 성적 배수 · 한 종목 ≤ 총자산 5% · 시험 차선 전체 ≤ 20% · 시장별 하루 4건.
     원장 reason 꼬리 ' · 시험차선' · meta.probe=1 · 그림자 원장(shadowRecord)은 그대로 기록. 크래시게이트 blockNew(개별주 롱)·일일 손실 한도·거래상태·리스크엔진은 그대로.
  ② 국면 인버스 차선(INV_LANE · runInverseLane · 꼬리 헤지 바로 뒤 같은 사이클): 정식 국면 CRASH → 美 SQQQ/SPXU/SOXS(5일 수익 가장 강한 것) · 韓 252670.KS/114800.KS · 총자산 12% ·
     BEAR → 美 SH · 韓 114800.KS(1x) · 6%. 한 번에 절반 · 동시 2 · 하루 2건 · 45분 간격. 청산 손절 1x−4/2x−6/3x−7% · 익절 +5/+8/+10% · 최대 10/5/4일 · 국면 NEUTRAL↑ 즉시 · BEAR 로 풀리면 레버리지 정리.
     전략 태그 hedge + meta.invLane(일반 매도 루프·꼬리 헤지가 안 건드림) · 원장 [INV][HEDGE] · ENTRY_ROUTES 에 INV 추가(check-loss-causes 갱신 — 사용자 승인) · 일일 손실 한도면 신규 없음 · 거래상태 HALTED/REDUCING 은 인버스만 면제(노출을 줄이는 매수).
     티커 확인: SQQQ·SPXU·SOXS·SH·114800.KS·252670.KS 전부 유니버스·NAME_MAP·MCAP_RANK 에 이미 있음(추가 없음).
  ③ 차선별 성적(perfGateLoad lanes · 같은 원장 질의): 시장:core/probe/inv · 시장:차선:꼬리표. 15건+ PF<0.8 → ×0.5 · PF<0.5 → ×0.35(막지 않음). /api/perf-gate 에 lanes.
  ④ 빈도: OMNI-Q 상한(사이클 2 · 하루 3)은 그대로 — 막힘이 풀린 효과로 하루 최대 OMNI 3 + 인버스 2 /시장. 비용: 막힌 매수에서만 포지션·현금 읽기 · 인버스는 평시 D1 0 · 화면 행 lane_view 30분 1회.
  ⑤ 화면: AI 두뇌 '정식 국면' 아래 '매매 차선 (맞으면서 배운다)' 표(차선 성적 · 축소 표시 · 국면별 배분) — ai-mode lanes(같은 getStates).
  ⑥ 학습기 변경 없음(근거 부족 — 시험 차선 15건+ 쌓이면 lanes 로 판단). 새 게이트 tools/check-probe-lane.mjs.
  다음: 배포 후 장중 로그 '[INV]'·'BUY 시험차선' · 원장 '시험차선' 꼬리 · 두뇌 차선 표 확인. 시험 차선이 15건+ PF<0.5 면 PROBE_LANE.mult 재검토.

### V33.796 — 링크 미리보기 카드(og:* · public/og-card.png 1200x630) · 가입 창 앞 소개 한 장(mine.js ask intro · 시작하기/로그인/앱 설치/구경)

### V33.795 — 회원가입 간단하게 · 유입 꼬리표 · /dev 공개 페이지
- 회원가입: 비밀번호 확인칸 없음 · 필수 동의 체크 1개(gAgree 하나에 약관·개인정보·만14세) · 가입 후 홈.
- 유입: 링크 ?r=xxx → POST /api/ref (기기·꼬리표당 하루 1번, 가입 때 ev=s) → state ref_stats:YYYY-MM-DD 1행 합산 · GET /api/ref-stats(14일 · 30분 SWR).
- public/dev.html(/dev) = 개발 설정 공개 페이지 · 아래 버튼 /?r=dev.
- AI 체험 매수(probation)·인버스 작업은 V33.797 로 완료·배포됨.


- V33.794 (11/9) ★독립 검토 남은 항목(에이전트)★
  ① 국면 원천 하나로: 원천이 셋이었다 — 지수 위상 analyzeMarketRegime().phase(RANGE/TREND_UP/MELTUP/TREND_DOWN/CRASH · mkt_phase) · 학습기 매매법 국면 pb_regime(SURGE/BULL/NEUTRAL/BEAR/CRASH) · 거시 mkt_context.regime(risk_on~risk_off).
     라이브 11/9: 美 위상 TREND_UP vs 매매법 CRASH(11/6 판) · 韓 TREND_DOWN vs CRASH. → regimeCanon(phase, pb, ctx) = 셋을 5단으로 옮겨 ★가장 방어적인 값★(학습기 국면은 4일 넘게 멈추면 제외).
     매매 경로 regimes[m].canon(사이클 · pb_regime 은 준비 묶음 getStates 에 끼움 · 추가 쿼리 0) · regime_snap 에 canon 저장 · 관문: 일일손실 반등 예외는 정식 국면 CRASH 면 안 열림(조이기만) ·
     화면: ai-mode phase.canonUs/canonKr(같은 함수 · 같은 질의에 mkt_context 추가) → 두뇌 '정식 국면 (매매·관문이 쓰는 값)' 표(근거 원천 표시). 기존 국면별 배수·문턱(phaseAdapt 등)은 그대로 위상을 쓴다(완화 없음).
  ② 겹친 크기 배수 기록: _szNote(signal, 이름, 배수) — 급락관문·시장전이·실적파급·국면·거시·섹터뉴스·뉴스예측·AI기본·변동성 + executeBuy 의 시간외·실적관문·OMNI잠정·매매법잠정·페어잠정·리스크엔진·예산.
     포지션 meta.szWhy · 원장 reason 꼬리 '· 크기 …'(같은 행 · 추가 쓰기 0) · 배수 2개 이상이 깎은 매수만 sz_stack 1행 갱신(매수 때만 · 요청 수 무관) · logEvery 6시간 1줄 '[크기배수]' · OMNI 명부 why 에 '겹친 크기 배수'.
  ③ 퇴역 위원회 야간 스캔(uniscan · mlUniverseScanNightly): 11/8 밤에도 656종목 위원회 추론 + 모델·일봉 읽기를 하고 있었다(소비처는 전부 꺼짐). → COMMITTEE_RETIRED 면 즉시 반환 · ai_picks:scan 을 한 번만 빈 retired 표지로 바꿈(리포트에 낡은 위원회 픽 안 남게) · 건강 점검 '스캔 낡음' 경고 제외 · AI 픽 시계 'OMNI-Q 순위 … (위원회 야간 스캔 정지)'.
  ④ state.twr: 이상 없음 — 입출금 0 이라 factor 1 · lastValue=초기자본이 정답(현금흐름 때만 갱신 · 마지막 구간은 화면이 실시간 평가액으로 마감). 원장 재계산 현금+보유(원가) 美 100,922(+0.9%) · 韓 94,377,500(−5.6%)와 일치. 고칠 것 없음.
  ⑤ 학습 변경: 적용 안 함 — OMNI-Q 실전 23건 · 그림자 라벨 0건(첫 7일 라벨 ~11/17)이라 홀드아웃 근거 없음. 그림자 7일 라벨 n≥30 이 되면 '막힌 후보 vs 체결분' 비교로 판단.
  다음: 배포 후 두뇌 '정식 국면' 표 · 다음 매수 원장 reason '크기' 꼬리 · 다음 밤 [SCAN] 정지 로그 확인.

### Threads 게시 워크플로 (V33.793 이후 · 코드 변경 없음)
- `.github/workflows/threads-post.yml`(수동 실행) + `tools/threads/post.py`. 토큰은 GitHub 비밀값 `THREADS_ACCESS_TOKEN`(장기 토큰 · 2027-01-08 경 만료 → 갱신 필요).
- 홍보 영상은 항상 패드 화면(820x1180) 기준으로 캡처한다(사용자 지시 2026-11-09).
- 글은 항상 살짝 어그로성 첫 줄(유인 멘트)을 넣는다. 2일에 1개 비용(AI·사이트) 관련 글을 자동 게시(예약 작업 · 사용자 지시 2026-11-09). 사실만 쓴다.
- 글 끝 문구는 글 종류별(사용자 11/9 승인): ① 개발·AI 팁·비용 → "이걸로 만든 사이트 직접 눌러봐 (가입 없이 구경 가능)" + https://lux-inv.com/?r=tNN (설정 공개 페이지 lux-inv.com/dev 도 가끔) ② AI 성적·실패담 → "AI 지금 뭐 사는지 실시간으로 보임" + https://lux-inv.com/?r=tNN ③ 광고 → "고딩이 만든 AI 모의주식 사이트 회원가입해서 수익률 경쟁해봐요" + https://lux-inv.com/?r=tNN. NN=글 번호. 유입은 /api/ref-stats(14일 · 방문 v · 가입 s). 이미지·영상 첨부 글은 게시 전 사용자 확인.
- text_file 비우고 돌리면 토큰 확인만, 채우면 글 게시. 글 원문은 `promo/threads/devlog-0N.txt`, 미디어는 `public/promo/`.

- (11/9) Threads 개발일지 홍보용 공개 파일 public/promo/(devlog1-server.jpg · devlog2-arch.jpg · devlog3-promo.mp4 · 광고 영상 v5 26.6초) — Threads API 는 공개 URL 미디어만 받는다. 코드 변경 없음(버전 그대로).
  Threads 토큰은 세션 스크래치패드에만(저장소에 넣지 않음) · 계정 @blauenacht08 · 앱 ID 1899137921249896.
- V33.793 (11/9) 폰 종목상세 탭 바 틈(사용자 아이폰 스크린샷 · ~10px 사이로 본문 비침) — V33.792 의 --dtop(버튼줄 높이)이 아이폰 사파리에선 기준이 달랐다.
  → 스크롤·리사이즈마다(rAF) 버튼줄 ★실제 아래 끝 − 스크롤 영역 위 끝★ 으로 --dtop · 탭 바 위 12px 를 같은 배경색 box-shadow 로 덮음 · 버튼줄 z-index 8(탭 바 6 위). 크로미움 실측 틈 0px. 웹킷은 이 환경에 없어 아이폰 재확인 필요.
- V33.792 (11/9) 사용자: "폰 종목상세 스크롤 UI 문제 · 폰은 MTS 처럼 간단 · 패드/PC 는 HTS 유지 · 초보자 대시보드 폰 디자인".
  ① 스크롤 문제: 정보 탭 바(#luxInfo .lxs sticky top 56px)가 위 버튼줄(page-header · 44px)보다 아래 붙어 그 틈으로 본문이 비쳤다 → 버튼줄 실제 높이를 --dtop 로(ResizeObserver) · 폰에서 top:var(--dtop).
  ② 폰(≤760px) MTS: 시세 데이터 표·관련 뉴스·오른쪽 패널(투표·시기별·목표가·패턴…)·재무 평가 표 숨김(탭이 같은 정보) · 보조지표/확대 버튼 숨김 · 기간 버튼 알약 가로 스크롤 · 차트 44vh(240~400px) · 맨 아래 '전체 데이터 보기' 토글(html.lux-mfull). CSS = workspace-layout.css 끝. 761px↑ 변화 없음.
     실측: 폰 상세 페이지 높이 6,212 → 3,205px.
  ③ 초보자 폰: 인기 종목 5개+더 보기 · 급등락 상승/하락 탭(각 5) · 칩 줄 가로 스크롤 · 카드 여백 정돈 — 2,905px(종전 3,524).
- V33.791 (11/9) ★독립 AI 검토(에이전트) → 수정★ 사용자: "AI 문제 없는지 확인 · 다른 에이전트가 객관 평가 · 문제점 수정".
  검토 요지: 6/3 이후 한국 −5.6%(KOSPI −41.9%) · 미국 +1.0%(SPY −2.5%) — 초과 성과는 거의 현금 보유 덕. 신규 두 경로 실전: OMNI-Q 美 12건 −1.50%(t −1.52) · 韓 11건 −0.48% · 매매법 AI 美 3건 −7.7%(11/04 손절).
  마지막 신규 매수 韓 10/22 · 美 10/27 — 실적 관문(합산 PF 0.51)이 OMNI-Q 를 막고 있다(설계대로).
  ★채택 안 함: '합산 막힘에 7일 뒤 시험 전이' — 위험 관문 완화(합산 판정은 의도적으로 완화 경로 없음) · 증거(23건 −1.0%)가 나쁨 → 대신 그림자 원장으로 잰다.★
  고친 것: ① 시간외 관문이 퇴역 위원회 확률(mlMindP ≥ 0.62)을 요구 → 위원회 퇴역 시 OMNI-Q 는 검증 통과 머리의 정식 발언(omq.mode speak)일 때만(더 엄격한 자기 기준 · 크기·세션 상한·실적 관문 그대로)
     ② 그림자 원장: 실적 관문이 막은 후보를 하루 종목당 1번 기록(shadow_led:날짜) → 7·28일 뒤 수익 라벨(shadow_stats · 하루 1회) → AI 두뇌 OMNI 행에 '막힌 후보 그림자 성적'
     ③ AI 픽 = OMNI-Q 순위(진입 문턱 이상 · 시장별 상위 8) — 퇴역 위원회 야간 스캔 픽(252990.KQ p 0.789 · 20일 −36%) 대신
     ④ OMNI 명부에 실적 관문 상태(美/韓 막힘·건수·평균·PF) ⑤ 학습 지연 = 평일 시간 기준(주말 거짓 경보) ⑥ LUX-Mini 배지 AUC 표기·'약한 우위'
     ⑦ 종가 대조가 매분 돌던 버그(90분 46회) — 마감 재수집을 한 호출에서만 ⑧ 반복 로그 묶음(시간외 차단 · FUND-GATE 6시간 · CRASH-GATE) — 로그 창 90분 → 며칠
  남은 것(다음): 국면 원천 하나로(pbRegime CRASH vs phase TREND_DOWN vs mktCtx caution) · 크기 배수 겹침 로그 · 퇴역 위원회 야간 스캔(ai.scan) 끄기 검토 · state.twr 멈춤 확인.
- V33.790 (11/8) 뉴스·환율 전면 재디자인 + LUX-POSITION 정리(에이전트 · artifact-design 원칙). CSS = workspace-layout.css 끝 luxMacroV2 블록(인라인은 check-load-speed HTML 220KB 한도 초과라 외부로).
  뉴스·환율: 4칸 분할 탭 · 섹터 분위기 칩 줄 · 기사 3줄+출처 도메인+N시간 전(renderNews _newsHost/_newsAgo) · 환율 타일 격자(폰 2열)+등락 막대 · 경제지표 다음 발표 세로 타임라인·D-day 칩 · 지표 표 → 행 카드.
  LUX-POSITION: 한글 제목 · 총자산 32px · 수익률 알약 · 투자/현금 막대+칩 · 보유 0 인 SCALP/SNAP 행 숨김 · HEAT·예산·설정은 details.pz-more '세부 설정 · 리스크 한도'(기본 닫힘) · 분할 탭.
  색: 두 화면의 한국식 색(--m2-up/dn)은 초보자 모드(html.lux-easy)에서만 — 전문가 화면은 사이트 전체와 같은 초록 상승/빨강 하락(종목 상세와 같은 규칙).
- V33.789 (11/8) 사용자: "데이터 신선도 전수 점검 · AI 분석 발전 · 종목상세 간결하게(지금 느낌 유지) · MY 디자인 개선".
  ① 신선도 점검(에이전트 · 일 19:27 UTC): 공개 피드 _pubAt 전부 0~6분 · fx·원자재·미국 시세는 주말 정지(합법) · KR/US/지수 원천 대조 일치. 고침 1건: /api/ai-picks ts 가 장중 시장별 픽 최댓값(17일 전)이라 야간 스캔 ts 를 max 로 합침.
     월요일 개장 뒤 fx·원자재 재갱신 확인 필요.
  ② AI 분석(에이전트 · stock-analysis.js): 핵심 요약 · 상승/하락 시나리오 + 손익비 · 애널리스트(/api/analyst) 목표가·분포·30일 의견 + 기술 관문 연결 · 시장 대비(SPY/코스피/코스닥 1년 일봉 세션 1회) · 거래량 세부 · 체크포인트(실적일 earnings.js) · 밸류에이션(KR 분기 PER 범위 · US PER/선행/PEG · 마진 추이) · 차트 목표/애널리스트 선.
     간결화(직접): 요약·시나리오·차트는 펼침 · 체크포인트·애널리스트·차트 근거·실적·밸류는 한 줄 미리보기 접기(details.lxa-f) · 목표가가 현재가와 ±60% 넘게 다르면 '급등락 전 목표가 섞였을 수 있음' 주의.
  ③ 종목 상세(직접): 'LUX-AI 종합 의견' → '투자심리 · 오늘의 투표'(위원회 퇴역 — '학습 표본 축적 중' 안내 제거 · 0표면 50:50 막대 대신 첫 표 안내) · 컨센서스 변화 '4일 전' 세로 줄바꿈 · 빈 '기술적 패턴' 제목 숨김.
  ④ MY(에이전트 · mine.js css 레이어): 간격 토큰 · 반투명 탭바 · 총자산 히어로 · 순위 1~3위 배지 · 성향 분할 버튼 · 빈 화면.
- V33.788 (11/7) 사용자: "금요일 미장 실시간 안 들어온 이유 · 다시는 안 일어나게 · 과금 낭비 실측 · 라이브 UI 점검".
  ① 금요일 원인(다시 확인): 크론은 금요일 내내 정상(분당 1회 · 하루 1,428회 · 목요일과 같음) · 장중~애프터 19:59 ET 까지 시세 정상(18:07 ET 거래 로그의 금요일 등락).
     20:00:19 ET 쓰기 1회가 야후 일봉(오늘 봉 빠짐)으로 557종을 하루 전 값으로 덮고 → 금 밤~주말엔 미국 시세 수집이 없어 굳음(V33.784 에서 원천 해석·되감기 거부·마감 재수집 수정).
     추가: usCloseAudit — 마감 재수집 직후 나스닥 공식 마감가로 큰 종목 40개 대조(0.3% 넘게 어긋나면 그 자리에서 고침 · WARN '[종가대조]') · 표본 20% 넘게 틀리면 전 종목(~28요청) 대조.
  ② 과금 실측(billing-probe · Cloudflare GraphQL): 지난 주기(10/7~11/6) 초과 $11.37 = D1 읽기 $11.23(10/8~16 누수 · 이미 수정 · 일 40억→1,700만 행) + CPU $0.14. 이번 주기 예상 CPU 42.2M ms(포함 30M) ≈ $0.24 · 나머지 포함량 안.
     낭비 제거: 위원회 퇴역 뒤 아무도 안 읽는 반사실 후보 INSERT(ml_candidates · 하루 11,733회 · 35k행) 중단.
  ③ 라이브 UI(390·1366 · 초보/전문 · 로그인 흉내 · 쓰기 차단): 가로 넘침 0 · 오류 0. 고침: 폰 상단 'US: …' 로 잘리던 손익 칩(전환 버튼 있으면 숨김) · 종목 상세 지수 카드/목록 색(초보자 모드 = 상승 빨강·하락 파랑) ·
     뉴스 17시간 묵음 — 섹터 뉴스 갱신이 장중 거래 사이클에만 있었다 → /api/news 가 2시간 넘게 묵었으면 뒤에서 갱신(크론 공개 사본 경로가 부름 · 주말·밤에도 2시간 주기).
- V33.787 (11/7) 데이마켓 원천 +OKX(에이전트 실측 · 토 오전): OKX 현물 X<심볼>-USDT 88종 유효(±15%·호가차 3% 필터 통과 · 불일치 0) 중 신규 9 → 합집합 ~137 → ~146.
  서버 ovnSweepAll 에 OKX tickers 1요청(야간에만) · 우선순위 hl>kraken>okx>gate>mexc · 브라우저 ovn-live.js OKX 공개 WS(bbo-tbt) · CSP wss://ws.okx.com.
  + 초보자 저장본 화면 실제로 보이게: 저장 때 ezCss 도 함께(선택자 #easyDash→#easyDashSnap) · easy-dash 의 숨김 규칙보다 구체적인 표시 규칙 · 해시 경로면 안 씀. 실측(상태 2.5초 지연 흉내): 0.6초에 전체 화면.
  미채택: Bitget(신규 ~4 · 응답 1.1MB) · LBank/BingX/KuCoin/Backpack(신규 0) · Phemex(스케일 불일치) · Bybit 403 · Binance 451 · Jupiter(신규 1).
- V33.786 (11/7) 사용자 요청 묶음: "항상 실시간 · 로딩 더 빠르게 · 화면에 보이는 데이터를 가장 먼저 · 초보자·MY 디자인 · 종목 차트·실적·분기 전망 분석(AI 예시 문장처럼)".
  ① 화면 먼저: index.html — 초보자 화면 저장본(luxEzSnap · 6시간 · 이 기기 localStorage)을 #easyDashSnap 에 문서 파싱 즉시 그림 → 새 시세가 온 진짜 화면이 그려지면 걷음(8초 상한).
     첫 2.5초(또는 상태 도착 전)엔 첫 화면에 안 쓰는 /api 피드(뉴스 116KB·거래 3000건·지도·스크리너 등)를 잠깐 보류 — 상태(341KB)가 대역을 먼저 쓴다(playbook·me·auth·state 는 즉시).
     실측(클라우드): 재방문 1.0초에 전체 화면 · 인트로는 하루 1회(4.2초)라 그대로.
  ② 종목 AI 분석: public/stock-analysis.js(브라우저 계산) · 종목 상세 정보 탭 맨 앞 'AI 분석'(기본 탭). 장기(200일선+기울기)·중기(60일 낙폭+50일선)·단기(20일선·RSI) 국면 문장 · 주도권(20일 상승/하락 거래량비+OBV) ·
     위 관문/아래 지지(120일 매물대 · 피벗 스윙 · 없으면 이평 회복 관문) · 실적(미: EPS 서프라이즈·이번 분기/올해 컨센서스·30일 전망 수정 · 한: 분기 매출·영업이익 YoY·다음 분기 컨센서스) · 업종 중앙값(표본 5 이상) · F-스코어 → '실적이 추세를 받쳐 주나' 한 줄.
     새 API /api/qearn(swrJson 6시간 · D1 0 · 미 yahoo quoteSummary earnings/earningsHistory/earningsTrend/defaultKeyStatistics/summaryDetail/financialData · 한 네이버 m.stock finance/quarter·annual). 영어 화면 번역은 아직(동적 문장).
  ③ 에이전트(디자인) — easy-dash.js(카드 테두리 제거·접는 카드·위계) · mine.js(총자산 위계 · 보유 한 줄 요약 + 'AI 의견' 펼침 · 코치/진단/AI 포트폴리오 접기) · en_19.tsv.
  (V33.785 한국 종가 수정은 이 판에 함께 배포.)
- V33.785 (11/7) ★한국 종가가 동시호가 전 값에 굳던 문제★ 사용자: "한국장 가격도 제대로 나오는지". 실측(토 01:05 KST): 446종 중 386종이 공식 종가와 다름 — 삼성 188,700(공식 193,500) · 하이닉스 1,132,000(1,176,000).
  원인: 장 밖(regFreeze)엔 저장 가격을 지키는데, 15:30~15:40 틈에 종가를 못 받으면 마감 동시호가(15:20~15:30) 전 값이 종가로 굳었다. 실측 60/60 — 장 닫힌 뒤(20:00~08:00·주말) 네이버 nv = 공식 종가(넥스트레이드 애프터 마지막과 다름).
  수정: applyKrOverMarket CLOSED → krClose · 병합에서 nv = 종가 · sv = 기준가로 다시 맞춤. krPostFillKey/usPostFillKey 주말에도 금요일 몫을 받게(놓친 날 자동 회복 · 받은 날은 키가 같아 안 돎) · KR 키 접미사 "c"(옛 판으로 이미 돈 날도 한 번 더).
- V33.784 (11/7) ★미국 시세 '목요일 값' 고정 수정★ 사용자: "미국장 가격 업데이트가 멈춘 것 같다 · 목요일 가격". 실측(금 21:08 ET): 미국 557종 전부 ts 20:00:19 ET 한 번의 쓰기로
  가격 = 목 종가 · 전일 종가 = 수 종가(NVDA 181.60/200.13 · 야후·나스닥 금 186.64/181.60 · SOXL 40.87 vs 45.97). 금요일 장중~애프터 19:59 까지는 정상이었다.
  원인: 애프터 끝 직후 원천 일봉에 오늘 봉이 없거나 종가가 빈 응답 → parseSparkQuotes 가 '배열 마지막 = 오늘' 로 읽어 하루 되감김. 그 뒤 금 밤~주말은 미국 시세 수집이 없어(야간 창 일~목) 그대로 굳음.
  수정 ① parseSparkQuotes: 마지막 '유효' 종가 봉 날짜 < meta.regularMarketTime 날짜면 meta.regularMarketPrice = 오늘 · 배열 마지막 = 전일 종가. ② refreshPriceShard 쓰기에 하루 되감기 거부
  (새 가격 = 저장 전일 종가 · 새 전일 종가 ≠ 저장 가격·전일 종가 → 안 씀 · 한·미 공통) · meta 가 옛 종가(배열 끝에서 둘째)와 같으면 안 믿음(HLT 야후 응답 깨짐 · 월요일 정규장에 자연 회복). ③ usPostFillKey: 거래일 20:10 ET 뒤(~04:00) 미국 샤드 한 바퀴 1회(krPostFill 과 같은 틀).
- V33.783 (11/6) ★에이전트 4종 결과 통합★ — 사용자 11/6 구조 지적(국면 단정 → 연쇄 오류 · 뒤늦은 국면 · 경직된 국면→전략 · 회전율 · 제안: HMM/GMM 확률 국면 섞기 · 메타 라벨 · 거시 선행 지표 · 국면 무관 위험 덧씌움)을 사전 등록 실험으로 객관 판정.
  ① 매매 AI(trainer/modal/regime_sleeve.py) — 채택 1건: 미국 폭락 국면 '반등 확인'(CRASH_CONFIRM us 0.01 · 신호 날 S&P500 +1% 초과일만 국면 전략 매수 · 판정 구간 거래당 12.28→12.66% · 4개 분기 시작 중 3개 우위 · 한국은 t 0.61 미달로 끔).
     미달(넣지 않음 · 문턱 안 낮춤): 메타 라벨 C1a/b · 상위 전략 앙상블 · 변동성 크기 · 시간 손절 · 최소 머묾 2·3일(한 D1 검증 7.60%/t3.59 → 판정 t1.55 미달) · 부드러운 국면(반감기 3일 섞기) · 거시 선행 다항 로지스틱(VIX·VIX/VIX3M·HYG/IEF·장단기차·UUP) · 위험 덧씌움 O1~O3(낙폭↓ 이나 샤프↓ · 미 O2 +0.05 < 기준 +0.10).
     측정: 국면 전환 연 26~30회 · 머묾 중앙 3일 · 한 판정 구간 전환 5일 안 진입 0.72% vs 그 밖 3.22%(검증 구간엔 차이 없음) · 한 회전 비용 끌림 연 ~9%p. 기존 crashGate·volTarget·leverageDecide·일일 손실 차단은 OMNI-Q·SROUTE 매수 둘 다에 이미 걸린다(빈틈 없음).
     다음 과제: OMNI-Q 표본 밖 점수로 메타 라벨 · 한국 최소 머묾 재검(표본 늘면). 실험 코드 scratchpad xlab(PREREG.md). 다음 학습 회차 뒤 /api/playbook markets.us.sleeve.cfg.crashConfirm===0.01 · kr null 확인. studio 번들 재빌드(PlaybookDeck '폭락 반등 확인' 줄).
     ※ studio `npm run build` 의 tsc 가 TS5101(baseUrl deprecated) 로 멈춘다 — 코드 오류 아님 · `npx vite build` 후 dist/brain-studio.js → public/ 복사.
  ② AI 전망 보정(public/outlook.js · outlook-weights.json · trainer/research/outlook_eval.py · check-outlook) — 규칙별 홀드아웃 가중치 · 미국 검증 통과 규칙 0 · 한국 약한 주의 규칙 5 · '긍정' 은 안 나온다(정직). 라벨에 과거 p/ex/n.
  ③ AI 코치(public/advisor.js · mine.js coachCard·advHoldHtml · en_18.tsv) — 규칙/템플릿 계좌 조언 · 질문 칩 · 보유 종목 조언(브라우저 계산 · 서버 0).
  ④ LUX-Mini(public/luxmini.js · luxmini.json 125KB · trainer/research/luxmini_train.py · check-luxmini) — 브라우저 LightGBM 머리 6개(한·미 × 5·20·120일). 검증 통과 = 한국 20일 · 미국 5일뿐 · AUC 0.51~0.53.
     화면: 새 public/luxmini-view.js — 종목 상세 개요 탭 맨 위 · MY 보유 카드(AI 전망 아래)에 '단기·중기·장기 n/10 라벨' 칩 · 펼치면 분위·과거 초과수익·근거 3줄 · 미달 머리는 점선 + '참고(검증 미달)'. 가중치는 처음 필요할 때 1회 · 'lux:luxmini' 이벤트로 다시 그림. 서버 CPU·요청 0.
- V33.782 (11/6) ★위원회·단타 엔진 완전 퇴역(사이클 CPU)★ 사용자: "AI 두뇌에 위원회 7개 중 6개 돌아간다 · 단타 엔진 · CPU 낭비 · 완전히 은퇴".
  실측: 학습·표본·야간 적합은 V33.634~712 에 이미 끔 · 외부 학습은 OMNI-Q·매매법 AI 2개뿐. 그런데 거래 사이클이 매분 시장마다 위원회 모델(MIND·앙상블·밴딧·가드·GBDT·SEQ·MEMO·이중헤드·후보 p분포)과
  단타 모델·신호 통계를 읽고, 반사실 후보 피처를 만들었다(신규 매수는 V33.649 부터 OMNI-Q·SROUTE 만이라 쓰는 곳 없음). → COMMITTEE_RETIRED/ENTRY_ROUTES_ONLY 로 전부 건너뜀.
  남긴 것: __idxCloses(변동성 타게팅) · __portStats(시장 거버너) · 낙폭 — 두 경로에도 쓰는 위험 관리. AI_EXIT 은 __aiReady=false 로 자연 정지(손절·트레일·EOD 갭 그대로).
  mlAiReadyState: 퇴역+두 경로면 모델 안 읽고 true(원자재·채권 슬리브 규칙 신규진입 차단 유지 · 종전과 같은 결과). 명부(buildRoster): OMNI 만 · /api/ai-mode alt.committeeRetired.
  화면: AI 두뇌 사이드바 '단타 엔진·스윙 표본·위원회' 칸 → '위원회 · 단타 엔진 퇴역' 한 줄 · 대시보드 AI 패널 위원회 줄도 퇴역 표기.
  게이트: check-walk-forward 는 에이전트 동시 실행(부하 10~24)에서 파이썬 하위 프로세스 시간 초과 → nice -15 단독 재실행 통과(코드 무관).
  에이전트(11/6 16:14Z 재개): 매매 AI 는 사용자 구조 비판(연쇄 오판·지행성·경직 매핑·회전율) 반영 — 위험 오버레이 → 확률 국면+히스테리시스 → 선행 매크로 피처 → 메타 라벨링 순.
- V33.781 (11/6) ★데이마켓 원천 4곳 · 실시간 3곳★ 사용자: "더 많은 종목 실시간". 실측(23:40 ET): 우리 미국 557 중 Hyperliquid 주식 시장 xyz·para·io 60 · Kraken xStocks 83 · Gate(X·ON 토큰) 43 · MEXC 91 → 합집합 134(종전 94).
  서버 ovnSweepAll(야간 2분): 4곳 수집 → 최신 가격(애프터 or 종가) ±15% 밖(코인 토큰 오짝: ELON→EL · GMX→GM · CFX→CF) · 호가차 3% 초과 버림 · Hyperliquid 우선 · 없으면 중간값 · 원천 하나+호가차>1.5% 면 안 씀.
     시세에 ovnSrc · ovnPair · ovnN 기록(saveQuote 보존). 시세 범위 읽기 1번/2분(야간만).
  브라우저 ovn-live.js: Hyperliquid allMids(xyz·para·io) + Kraken ws v2 ticker(bbo) + Gate spot.book_ticker — 서버가 고른 원천·코드대로 구독 · 2초 묶음 갱신. MEXC 만 있는 종목은 서버 2분 값(MEXC 는 브라우저 CORS 불가).
  CSP connect-src += wss://ws.kraken.com wss://api.gateio.ws.
- V33.780 (11/6) ★데이마켓(미국 야간 20:00~04:00 ET) 실시간 시세★ 사용자: "데이마켓 어떻게든 · 전 세계 무료 · 2분 말고 실시간".
  조사: 네이버·웹불 공개 시세엔 야간 값 없음 · Blue Ocean 원천은 유료(Alpaca 별도 계약·Databento·dxFeed·QUODD) · 증권사 내부 API(토스·로빈후드)는 봇 차단 우회라 안 씀.
  채택: ① Hyperliquid trade.xyz 주식 시장(공개 API · 143종 · Pyth 주식 시세 추종 · SOXL 24h 7.6억 달러) ② Kraken xStocks(공개 API · 177종 · 호가차 ≤3%만).
  브라우저 public/ovn-live.js: 야간·화면 보일 때만 wss://api.hyperliquid.xyz/ws allMids(dex xyz · ~5초) → 시세 객체에 ovn·가격·등락(전일 종가 대비)·dispSess='day' 덮고 'lux:quotes' 이벤트
     (TOP MOVERS·지도·종목 상세 목록·초보자·MY 가 다시 그림 · __lastQuotesArr 대입 순간에도 다시 얹음). CSP connect-src 에 wss://api.hyperliquid.xyz.
  서버: 야간 2분마다 hlOvnSweep(REST metaAndAssetCtxs · oraclePx) → 빈 종목만 krakenOvnSweep · 상품·지수 이름 막기(CL·GOLD…) · 정규 종가 ±35% 넘으면 버림 · saveQuote 가 ovn* 보존.
  applyDisplayOverMarket: 정규·프리 아니고 20분 안 ovn 이면 표시 가격 = ovn(등락 전일 종가 대비). 라이브 23:39 ET: SOXL 45.15(정규 종가 대비 +10.5%) · NVDA 185.2 — 0~5초 신선.
- V33.779 (11/6) ★TOP MOVERS 시간외 포함 전환 · 시세 직후 CDN 사본 · 사용량·애프터 가격 실측★
  TOP MOVERS 머리에 '정규장 | 시간외 포함'(lux-mv-ext · 기기별) — 시간외 포함 = 지금 가격 ÷ 전일 종가(q.price·dayPct · V33.777 기준) · 프리/애프터 이름표. 게이트가 잘라 실행하는 구간 밖에 설정 코드(typeof MVX 가드).
  지도·애프터 지연 실측(11/5 19:32~19:35 ET): 지도 = 받은 시세와 같음 · 시세가 1~2.5분 늦음(공개 사본을 거래 사이클 뒤에서만 씀) → extQuoteSweep 직후 statePubWrite 한 번 더(statePubEarly).
  사용량 실측(11/5 19:58Z): 최근 24h D1 읽기 1,680만(월 환산 포함량의 2%) · 쓰기 83.8만(50%) · CPU 188만 ms(월 환산 5,650만 = 포함 3,000만의 188% · 초과 약 $0.5/월 · 크론 trading 49~51%) · 요청 2.6%.
  SOXL 애프터 +6.66%(사용자 '실제 9%'): 네이버·야후 애프터 마감(20:00 ET) 43.59 와 같음. 야간(데이마켓 20:00~04:00 ET) 값은 네이버 원천에도 없음(ovn 0/557) — 원천 없이는 못 보여 줌.
  에이전트 4종(LUX-Mini·매매 AI·전망 보정·AI 코치)은 사용량 한도로 중단 · 작업본 .claude/worktrees/agent-* 에 남음(미통합).
- V33.778 (11/6) ★첫 화면 초보자 · AI 전망 엔진(단·중·장기) · MY 어시스트 · AI 실제 매수 표시 · AI 포트폴리오 현금/주식 · 종목 상세 목록 디자인★ 사용자 11/6 요청 1·3~7.
  ① 기본 모드 = 초보자(lux-dmode 가 'pro' 일 때만 전문가) · 머리 인라인 2곳(lux-easy · 폰 PC 축소 보기 끔) 같이.
  ③ public/outlook.js(새 파일 · 브라우저 계산 · 서버 0): 단기(RSI·5일·5/20일선·시장 투매·실적 임박) · 중기(50일선·20/50 배열·60일 지수 대비·매매법 AI 국면) · 장기(1년·5년·업종 구조표 THEME · 레버리지 감점).
     THEME 은 사람이 검토한 근거(2026-11 · 하이퍼스케일러 설비투자·HBM 전망) — 바뀌면 이 표만 고친다. 재무(실적 추정·PER)는 아직 없음(상태에 없음).
     초보자 대시보드 'AI 업종 전망'(미국 반도체·미국 빅테크·한국 반도체 · 시총 제곱근 가중 평균).
  ④ MY 보유 카드마다 'AI 전망 단기·중기·장기' (펼치면 근거) · 계좌 진단에 '주의 비중 단기 x% · 중기 y%' · 장기 부적합 상품 비중.
  ⑤ MY AI 추천·관심 목록: 'AI 보유 중'(상태 positions) · 'AI 매수함'(playbook recent · 30일) 배지 — pbSlim 에 recent 추가.
  ⑥ MY 홈 'AI 포트폴리오' 카드 — 서버 AI 모의계좌 현금·주식 비중 막대 + 상위 6종목(상태 cash·positions · window.__lastState 는 index.html api()·easy-dash 가 채움).
  ⑦ 종목 상세 목록(.detail-browse) CSS 재디자인(<style id=luxDbList>) — 둥근 카드 · 이름 크게 · 가격 본문 글꼴 · 등락 배지.
  영어: en_17.tsv + 사람이 쓴 문장은 [한,영] 쌍(luxOutlook.whyHtml → data-en).
- V33.777 (11/5) ★시간외 등락률 기준 통일 · 초보자 대시보드 재디자인 · 폰 상단 전환★ 사용자: "미국장 시간외 가격 등락률 값이 다르다 · 초보자 화면 유치 · 지도 넣어라 · 폰 메뉴 안 열고 전환".
  라이브 실측(11/5 18:21 ET · 네이버·야후 1분봉 대조): 애프터 가격은 정상(NVDA 179.30 vs 네이버 179.89 · 1분 안). 문제는 등락률 — applyDisplayOverMarket 이 POST 에서 dayPct = postPct(오늘 종가 대비 애프터만)라
  NVDA 가 하루 −10.4% 인데 −1.27% 로 보였고 MY(가격÷전일 종가)와 달랐다. → POST/POSTPOST/CLOSED(정규 외 · PRE 제외)는 dispPct = 표시 가격 ÷ 전일 종가. PRE 는 저장값이 전 거래일 것이라 prePct 가 이미 같은 기준.
  시장 지도 '시간외' 모드·시간외 칩(postPct·post÷regPrice)은 세션만의 변동 그대로. 게이트 check-state-quotes 통과.
  easy-dash.js 재디자인: 지수 카드(값·▲▼·차트) · 상승/하락/보합 종목 수 막대 · 시장 지도(제곱근 시총 트리맵 · 미/한 · 빨강 상승/파랑 하락) · 1년 전 투자 · 투자 용어 · 인기 종목 표(시간외 표시) · AI 관심 · 급등락 · 모의투자.
  폰: 상단 바(.m-appbar) 검색 버튼 앞에 '초보|전문' 스위치. 폰 넘침 수정(#easyDash min-width:0 · grid minmax(0,1fr) · table-layout fixed).
- V33.776 (11/5) ★초보자용 대시보드 + 사이드바 슬라이드 전환★ 사용자: "지금 화면은 전문가용으로 두고 주식 처음 하는 사람용 대시보드 하나 더 · 왼쪽 사이드바 슬라이드 전환".
  public/easy-dash.js(새 파일) — html.lux-easy 일 때 #page-dashboard 맨 앞 #easyDash 만 보이고 기존(전문가) 내용은 숨김(머리 인라인 CSS로 깜빡임 없음). 모드 = localStorage 'lux-dmode'(기기별 · 서버 쓰기 0).
  내용: 시장 날씨(지수 평균 등락 → 맑음~폭풍우 · 열림/시간외/닫힘) · 익숙한 회사 12곳(무슨 회사인지 한 줄 · 스파크라인 · 누르면 종목 상세) · 1년 전에 샀다면(ret1y) ·
  오늘의 용어 20개(날짜 순환) · AI가 눈여겨본 종목(playbook live q 상위 3 · 레버리지·인버스 제외) · 많이 움직인 회사(시총 상위 300 · ETF·레버리지 제외) · 모의투자 시작 CTA.
  전환 스위치: 사이드바 .sb-nav 맨 위 + 폰 메뉴(드로어) 맨 위 · 초보자 화면 오른쪽 위 '전문가 화면 →'. 폰: 초보자 화면은 PC 축소 보기(luxDz)를 끄고 원래 폰 크기.
  비용: 새 API 없음 · /api/state 는 관문(CDN) 그대로 · /api/playbook 을 PUB_FEEDS(180초)·PUBF 에 추가 → MY·초보자 화면 모두 CDN 에서(방문자 수와 무관). 영어: tools/i18n/en_17.tsv + 문장형은 data-en.
- V33.775 (11/5) ★운영 점검 — 헛도는 헤지·거짓 경보 정리★ 라이브 로그: KR 패닉으로 꼬리위험 헤지가 매 사이클 '목표 ₩1,415,663 → 1123주' 를 시도하지만
  V33.649(신규 매수 AI-Q·SROUTE 만)가 executeBuy 입구에서 막아 체결 0 · 로그 2줄/분만 남겼다. → 막힌 동안 시도 안 함(시간당 1회 알림 · 청산 경로 그대로). 헤지 허용 여부는 사용자 결정 대기.
  '[ST-INTRADAY] R2 미바인딩' ERROR 는 COMMITTEE_RETIRED 인 경우에도 나던 거짓 경보(R2 정상) → 분리. 헤지 로그 통화 표기 KR ₩.
  CDN state.js: 15분 무방문 뒤 쉬었다가 첫 방문(/api/state 폴백)에 1분 안 재개 — 설계대로 확인(05:23~05:37 공백 = 무방문).
  청구: 이번 주기(10/7~) D1 읽기 400억(포함 250억 · 초과 $15.2 확정) · 최근 24시간 2,280만(월 환산 7억) — 이미 고쳐진 과거 누수.
- V33.774 (11/5) ★MY 매도 의견 마무리 — 50일선 채움 · 영어 번역 숫자 자리 버그★ 라이브 확인(CDN state): 한국 ma50 310/446 채워짐 · 미국 0/558(장외라 평가 루프가 안 돎).
  → 일봉 갱신 경로(refresh daily indicators · merged)도 ma50 계산(같은 closes · 추가 I/O 0). 삼성전자 지금가 < 50일선이지만 '이탈 첫날'이 아니라 신호 없음 = 백테스트 정의대로.
  영어: 사전 빌드가 원문 틀의 숫자(20일선의 20)까지 {n} 으로 바꾸는데 번역 값엔 글자로 남아 '5일 −11.28%' → '5d 20%' 로 나왔다.
  tools/i18n/build.mjs alignNums() — 원문 숫자 순서대로 번역 값의 같은 숫자를 {n} 으로 맞춤(12건 해당 · 남은 2건 직접 수정). 계좌 진단·과거 성적 괄호·기준 손절/목표·'저장됨 시각' 을 span 으로 나눠 번역.
  라이브(로컬 mine/i18n 주입) 한·영 US/KR 계좌 화면 확인. 게이트 224종 통과.
- V33.683 (10/27) ★한국 매매법 — 상황별 작동 진단 + 공황 반등 바구니(관측)★ 사용자: "한국 매매법 성능 강화 · 어떤 상황에서도 그에 맞춰 작동".
  진단(실험실 10/15 일봉 · 매매법별 × 상태별 시장 대비 순초과 · 앞80/뒤20): 평시엔 추세형만 양쪽 양수(DUAL_MOM +0.87/+2.00 · HI52_NEAR +0.80/+1.46 · RS_LEADER +0.47/+0.46 · TREND_ALIGN +0.24/+0.85),
    평균회귀형은 모든 상태에서 음수(이미 PB_OFF 퇴출 · +TL 보조만). 공황 중엔 1순위 매매법 전부 음수 → 공황엔 쉬는 게 그 상황에 맞는 동작.
  시장 매수 검증: 등가중 우주 기준 공황 뒤 10일 +1.39%(t 4.2)/+1.55%(t 2.6) 였지만 ★실전 하루 늦춤 · 실제 ETF★ 로는 KODEX200 +0.09%(t 0.1) · KOSDAQ150 뒤20 음수 → 지수 ETF 안 씀.
  OMNI-Q 후보 바구니(공황 · 10일): 앞80 +3.1~3.5%(t 1.2~1.4) · 뒤20 +1.7~2.2%(t 0.8~0.9) — 양수지만 약함 → 학습기 panic_book() 이 회차마다 다시 재고 화면에 표시(관측만).
    사전 등록 규칙: 앞80% 바구니 거래 ≥ 20 · 평균 > 0 · t ≥ 2 그리고 뒤20% 평균 > 0 → ok. ★ok 가 처음 나오면 그때 워커 시험 매수 경로를 붙인다(지금은 매수 코드 없음 — 관측·표시만).★
  /api/playbook markets.*.panicBook · 화면 판단 흐름 '공황 반등 바구니' · 게이트 [V33.683].
- 10/27 사용자: "한국장 오늘 폭등했는데 매매법 AI 가 공황이라 쉰다 — 문제". ★확인 결과 설계대로(버그 아님)★: KOSPI 5,469→5,690(+4.0%) 실제 급반등.
  공황 = 폭락(등가중 하루 −2.5%↓·5일 −6%↓) 뒤 3거래일(CRASH rolling 3) 또는 60일 하락+20일 변동성 상위 20% — 10/26 폭락이라 10/28 까지 켜짐이 정의.
  근거(실험실 10/15 일봉 · 한국 10년): 공황 중 시장 +2%↑ 반등일 추세·모멘텀 매매법 평균 −0.91%(n 18,837 · 중앙 −2~−5% · 승률 26~36%) vs 평시 +0.10% — 모멘텀 붕괴(Daniel·Moskowitz) 그대로. 미국은 차이 작음(−0.04 vs −0.23).
  참고: 한국은 지금 판정 미통과·종전 기준도 미달이라 공황과 무관하게 시험 매수가 없다. 화면에 공황 정의·근거 문구만 추가(스튜디오 배지 툴팁 · 관측창).
- V33.682 (10/27) ★매매법 AI — 상한이 찰 때 OMNI-Q 순위 높은 후보부터★ 사용자: "매매법 AI 발전". 시뮬은 같은 날 안을 표 점수 순으로, 실전은 순회 순서(사실상 무작위)로 사서 서로 달랐다.
  학습기 PB_RANK 기본 omq(cand_rank = 고른 머리의 그날 백분위 · 하루 늦춤 → _pick 같은 날 순서) · 워커 매수 가능 후보(_hot)를 OMNI-Q 점수 내림차순으로 앞에 붙임.
  실험실(10/15 일봉 · 전진 시작 2025-06 가정 · V33.675 판 대비): 검증 1등 t 미 1.19→1.62 · 한 2.08→2.17 · 판정 월 맞춤 초과 미 −2.02→+1.42%p(t 1.04) · 한 −1.32→+0.49%p · 전진 주 맞춤 미 +0.61→+1.13 · 한 −0.86→+1.90. 아직 통과(달 t ≥ 2)는 아님.
  화면: 판단 흐름 '후보 선별' 에 순서 설명. 게이트 check-playbook [V33.682].

## 상태(게이트 계약)
- Status: complete
- Branch: main
- Last commit: git log -1 로 확인

> 예전 기록 전체(V33.79x 이전 · 'Modal 되살리기' 포함)는 `docs/AI_HANDOFF_ARCHIVE.md` — 통째로 읽지 말고 `grep` 으로 찾는다.
