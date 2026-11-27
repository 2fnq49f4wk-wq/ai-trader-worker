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

### V33.882 (2026-11-27) — 애플 방식: 떠 있는 메뉴가 실제 화면을 굴절 · 탭바 스크롤 축소
- 애플 발표(newsroom 2025-06, web-fetch 로 원문 확인): 유리는 앱 위 '기능 층'(컨트롤·탭바·사이드바) · "reflects and refracts its surroundings" · 스크롤하면 탭바 줄고 올리면 펴짐 · 움직임에 반응하는 하이라이트.
  우리와의 차이: 우리는 빈 배경 위 '콘텐츠 카드' 에 유리 → 뒤에 휠 게 없음. 셰이더 그림은 실제 화면을 못 읽음.
- 적용: 폰 아래 탭(.m-tabbar)·위 앱바(.m-appbar) = xenitV1/liquid-glass-skill refraction.js(MIT · public/vendor/liquid-refraction.js · 크롬 계열 backdrop-filter:url(#변위맵) 로 그 아래 지나가는 실제 화면을 실시간 굴절 · 사파리/파폭은 흐림 유지). 우리 수정 1곳: setProperty 에 'important'(사이트 CSS !important 흐림을 이기도록). .m-tabbar 는 WebGL 대상에서 뺌.
  폭 ≤900 에서만 lux-liquid.js 가 data-refract 붙이고 스크립트를 늦게 불러옴 · 탭바 스크롤 아래 → scale .9 · 위 → 원래(transform 만) · .is-refracting 일 때 채움 18~22%.
- 애플 공식 유리(SwiftUI glassEffect·UIKit UIGlassEffect)는 웹 브라우저에서 호출 불가. 가능한 길은 iOS 네이티브 앱(Capacitor iOS + 네이티브 탭바 플러그인) — app/README ⑤ 대로 애플 개발자 계정($99/년)·Mac 필요, 현재 iOS 껍데기 없음.

### V33.881 (2026-11-27) — 터치 햅틱(사용자가 보낸 스킬 2개 실제 받아 적용)
- 받은 것: haider-nawaz/liquid-glass-skill(SwiftUI .glassEffect · GlassEffectContainer · 마이그레이션) · zakisheriff/Claude-Liquid-Glass-Skill(SwiftUI/UIKit/RN 네이티브 유리 + 'Mandatory Haptics'). 둘 다 iOS 네이티브용 — 웹에 옮길 수 있는 규칙만 적용. 둘 다 LICENSE 파일 없음(코드 복사 안 함 · 규칙만).
- 적용: '모든 터치에 햅틱' — lux-liquid.js 앞부분: 버튼·탭·칩·카드·목록 pointerdown(마우스 제외) → 앱(Capacitor Plugins.Haptics.impact LIGHT) · 안드로이드 navigator.vibrate(8) · iOS 사파리는 웹 진동 API 없음(생략) · 60ms 연타 1회 · MY › 화면·유리 '터치할 때 진동' 끔(luxHaptic=off).

### V33.880 (2026-11-27) — 유리 = 맨 끝 1px 경계선 + 안쪽 굴절·무지개만(사용자 "띠 말고 끝에 경계선만 · 안쪽에서 빛 왜곡과 무지개")
- 셰이더: 렌즈 띠·그늘·틴트·반사 삭제. 카드 전체가 하나의 렌즈 — 이동량 = 법선 × bz×1.6×굴절 × u^2.2(u = 1 − 안쪽거리/짧은 반폭 · 가운데 0, 가장자리 최대, 기울기 연속) · 채널별 이동(무지개 uChr×.9×같은 곡선) · 맨 끝 exp(−d/.55) 선(빛 쪽 흰 · 다크 반대쪽 옅은 검) · 그림자 ×.35.

### V33.879 (2026-11-27) — 유리 본체 완전 투명 · 테두리만(사용자 "완전 투명하게 테두리만 · 블러 느낌 싫다")
- 셰이더: 렌즈 띠 안쪽(dIn > 1.4·bz)은 아무것도 안 그림(alpha 0 → 페이지 배경 그대로) · 띠→본체 alpha 부드럽게 이음 · 기본 흐림 0 · 틴트 0 · 확대 1. 테두리 굴절·무지개·빛·그림자만 남음. luxGlassP7.

### V33.878 (2026-11-27) — 유리 가장자리 회색 액자 제거 · Apple HIG 스킬(milistu/agent-skills apple-human-interface-guidelines · MIT)
- 원인(3배 확대): 가장자리 안쪽 광채 띠(exp(-dIn/(bz·.9)))가 15~20px 회색 액자 · 닫힌 링(바닥값 .10) · CSS .rg 원뿔 테두리와 겹침.
- 수정: 광채 띠 삭제 → 빛 쪽 곡면에만 좁은 반사(폭 베벨 ¼) · 링 바닥 0(빛 쪽만) · 렌즈 띠 9~16px(얇게) · 굴절 이동 0.6→1.1×띠 · CSS 테두리 .75→.55.
- HIG(materials-guidelines.md): '클리어 유리는 색이 풍부한 배경 위에서만' → 무늬 추가 없이 다크 오로라 색 덩이 알파 .24~.34 → .36~.48.
- 애플이 웹용 공식 리퀴드 글라스(코드)는 제공하지 않음 — 공식은 SwiftUI glassEffect / UIKit UIGlassEffect + HIG 문서뿐.

### V33.877 (2026-11-27) — 리퀴드 글라스 = V33.876 렌즈 판 + 배경 물결 없음 · 누름 반응
- 사용자: 배경 물결 '이상함' → 장면 rich 0(오로라만) · 이어 시험한 Midielhg 스킬의 얇은 렌즈판은 "다시 블러처럼" → ★V33.876 렌즈 셰이더(xenitV1 규칙 · 림 띠 14~28 · 굴절 1.5 · 무지개 .45 · 확대 1.06)로 되돌림★.
- affaan-m/everything-claude-code skills/liquid-glass-design(MIT · 사용자가 보낸 링크) 받아 적용: interactive = 누르면 스프링 눌림(.lg-g:active scale .992 · transform 만).
- 참고 스킬 3개 모두 스크래치에만(저장소에 넣지 않음): xenitV1/liquid-glass-skill · lzq20121022-tech/the-best-liquid-glass · Midielhg/real-web-liquid-glass. 저장 키 luxGlassP6.

### V33.876 (2026-11-27) — 리퀴드 글라스: 다운받은 스킬(xenitV1/liquid-glass-skill · MIT) 규칙으로 다시 · 투명 본체 · 조절 4종
- 사용자: "뒤가 투명하게 — 회색 빛" · "굴곡이 중간에 불연속 — 박스 접은 느낌" · "Refraction·rainbow·frost·light 4가지 조절" · "skill.md 다운받아 사용".
- 스킬(SKILL.md + references/materials.md '굴절과 림') 적용: 림 띠 = 모서리 반지름 ½(8~20px · 짧은 변 ⅓ 미만) · 최대 이동 0.6×띠 · 바깥선에서 가장 세고 띠 안쪽 끝 0 — 곡선 (1-t)² 라 기울기까지 이어져 접힘 없음 · 안쪽 거리는 둥근 SDF(rI=max(r,2bz)) · 림 빛 위왼쪽 최대·옆 옅음·아래오른쪽 다시 · 부드러운 안쪽 광채 · 반대편 옅은 그늘.
- 회색 막 제거: 틴트 다크 .02/라이트 .12 · 흰/회색 더하던 부피광·프레넬·스튜디오 환경 반사 삭제 · 9탭 frost.
- 평가 에이전트(리퀴드 글라스 평가) 지적 반영: 바깥 1px 윤곽·두 번째 반사선·라이트 남색 선·닫힌 림 고리 제거 · 베벨 상한 30→20px · 테마 전환 뒤 큰 판이 다크로 남던 것 — 지금 판에서 재현 안 됨(헤드리스).
- 조절 4종 = P.refraction(1)·chroma(무지개 .35)·blur(frost 2px)·spec(빛 1) — MY › 내 정보 › 화면 · 유리 슬라이더 · ?glass=debug · luxGlass.set. 저장 키 luxGlassP3(예전 값 무시).
- (같은 판 추가 · 사용자 "블러 말고 뒤가 보이고 렌즈처럼 왜곡") 두 번째 스킬 the-best-liquid-glass(MIT) recipes: '단색 위 유리는 굴절할 게 없다' → 배경 장면에 뚜렷한 물결 띠 4개(가장자리 ~5px) · 가운데 렌즈 확대 magnify 1.06 · 림 띠 14~28px · 굴절 1.5 · 무지개 .45 · frost .5px. 저장 키 luxGlassP4.
- 참고: 스킬은 'Apple 은 유리를 콘텐츠 카드가 아닌 기능층(바·사이드바·탭)에만' 이라고 한다 — 사용자가 카드 전체 유리를 원해 유지 중.

### V33.875 (2026-11-27) — 유리 경계: 선 없이 빛·그늘의 짝으로(사용자 "테두리 선이 너무 보임 · 흰/검 조합 · 안쪽 박스 선")
- 셰이더: 바깥 1px 윤곽(sh+=) 제거 · 안쪽 두 번째 반사선(bz*.55) 제거(박스 느낌 원인) · 테두리 1.3px 선 → 광원 쪽은 곡면 위로 번지는 흰 빛(폭 ≈ 베벨 ⅓) + 반대쪽은 어두운 굴절 그늘(+ 아주 얇은 반사광) — 선 없이 경계 인식.
- CSS 원뿔 테두리(.sp .rg) 1.25px·상시 옅은 빛 → 1px·광원 쪽 호만(나머지 0).

### V33.874 (2026-11-27) — 폰 검색 삭제 · 배경 보케 원 제거 · MY 화면·유리 설정
- 폰 아래 탭 '검색'(cmdk 열기) 삭제 · 폰(≤767) .cmdk-fab 숨김(사용자 "폰 메뉴 검색 렉 심함 — 삭제"). 데스크톱 검색은 그대로.
- lux-liquid 배경 장면의 보케 원 9개 제거(사용자 "배경에 이상한 원") — 빛 띠·오로라만.
- MY › 내 정보 › '화면 · 유리'(mine.js 가 window.luxGlassUI.html() 삽입 · lux-liquid.js 가 data-gl/data-glk 조작 받음): 유리 켜기/끄기(localStorage luxGlass) · 빛 따라 움직임(luxGlassMove) · 굴절·빛 반사·진하기·색 번짐·두께감 슬라이더(luxGlassP · change 때만 다시 그림) · 처음 값으로.

### V33.873 (2026-11-27) — 리퀴드 글라스 렌더 파이프라인: 배경 장면 → FBO → 굴절 샘플 · 광원 uniform · 튜닝 패널
- 진단(평면 블러처럼 보인 이유): ① 유리 뒤가 큰 그라데이션 몇 덩이뿐(휘어 보일 무늬 없음) ② 굴절 샘플이 수식 재계산(거칠기 단계 없음) ③ 셰이더 빛이 위왼쪽 고정.
- 지금(public/lux-liquid.js): 배경 '장면'(오로라 LAYERS + 빛 띠 2 + 보케 9 — RICH)을 워커 WebGL 이 ★화면 뒤 고정 캔버스 #lgBg(transferControlToOffscreen)★ 와 ★FBO(뷰포트 ½)★ 에 같은 셰이더로 그림 → 유리 판은 FBO 를 법선·베벨 곡률로 휜 UV 로 샘플(가운데 렌즈 확대 magnify · 베벨 굴절 refraction · 가장자리만 R/G/B 오프셋 chroma · 5탭 미세 흐림 blur).
  광원 uLt(마우스·기울기 → 멈추고 15° 넘게 바뀌면 보이는 판만 다시 그림 · 1.2s 에 한 번) → 스페큘러·프레넬 소프트박스·테두리 빛·반대편 두께 그늘·안쪽 두 번째 반사선. CSS 원뿔 테두리 빛(.sp)은 그대로 실시간.
  #lgBg 없으면(transferControlToOffscreen 미지원) 장면은 오로라만(rich 0 = CSS html::before 와 같음).
- 파라미터 P = {refraction 2.8, bevel .15, curve .62, chroma .14, blur 1.4, tint -1(다크 .14·라이트 .30), spec 1, magnify .92, rich 1} · luxGlass.set({...,light:각도}) · ?glass=debug 슬라이더 패널(값은 그 브라우저 localStorage luxGlassP).
- 실측(헤드리스 CPU 4배): 스크롤 p50/p95 데스크톱 16.7/33.4 · 폰 16.7/16.7 — 라이브와 같음 · 긴 작업 52→0ms.

### V33.872 (2026-11-26) — 유리 빛 층 다시(사용자 "조잡하다")
- 원인(확대 실측): V33.871 움직이는 빛의 '베벨 띠'(.gw · 폭 bz 고리 마스크)가 안쪽이 칼같이 잘려 카드마다 밝은 사각 띠·경계선 · 테두리 빛 덩이(220px 방사)가 얼룩처럼 보임.
- 지금: <lg-glass> shadow DOM .sp = 테두리 1.25px 고리(.rg) 하나에 conic-gradient(from --lga) — 빛 쪽 가장 밝고 둘레 따라 매끈하게 옅어지며 반대편 약한 반사 · 본체 광택(.sh)은 넓고 옅은 타원(가장자리 없음, --sx/--sy). 자식 없는 요소라 변수 바뀌면 그 요소만 다시 칠함. 셰이더 고정 림 .24→.10(빛 층이 대신).

### V33.871 (2026-11-26) — 유리: 큰 패널까지 · 본체 빛 · 기울기/마우스 따라 도는 빛(직접)
- 대상 판정: '자손 120개 넘으면 건너뜀' → relative 로 바꿔 ★실제로 기준이 바뀌는★ 절대배치 자손이 있을 때만 건너뜀 → 전문가 TOP MOVERS·S&P MAP·실적 달력 등 큰 패널도 유리(전문가 화면 그려진 판 11→24).
- 셰이더: 본체 shade() — 굴절된 배경이 비치고(틴트 .30→.20) · 위왼쪽에서 번지는 부피광 · 가장자리에서 스미는 빛 · 아래로 살짝 깊어짐. 베벨 완만(.85→.6) · 굴절 2.2→2.8 · 프레넬 .40→.22 · 테두리 빛은 빛 닿는 쪽 위주(고르게 두른 테 = '플라스틱 뚜껑') · 안쪽 어두운 선 제거.
- 움직이는 빛: <lg-glass> shadow DOM 안 .sp 층(테두리 1.6px 고리 + 베벨 띠 + 본체 광택)에서 빛 덩이가 transform 으로만 이동 · 데스크톱 마우스 위치 / 폰 deviceorientation(iOS 는 첫 터치 때 한 번 허락 요청 · 거절하면 다시 안 물음 · localStorage luxTilt) · prefers-reduced-motion 이면 정지. 풀 재사용 카드에 sp 를 같이 넘기던 버그 수정.
- 확인: 헤드리스 데스크톱·전문가·라이트·폰 오류 0. 실기기 기울기는 미확인.

### V33.870 (2026-11-26) — 폰 스크롤 · 사이드바 메뉴 전환 렉(에이전트 실측 · CPU 4배)
- 폰 종목 상세 스크롤: 목록 카드 60장 content-visibility:auto(V33.819)가 스크롤 중 배치·래스터 → 폰(≤760)만 visible · 다크 카드 바깥 그림자 흐림 40→14px(lux-glass2.css 끝). 메인 프레임 p95 42.8/14.7 → 7.4/7.5ms · 래스터 706/534 → 135/43ms. 대가: 폰 상세 진입 첫 그리기 +6~60ms.
- 메뉴 전환: lux-motion.js 화면 전환 anime → WAAPI(모양 동일 · 클릭 처리 341 → 28~39ms) · 사이드바 알약 메뉴 위치 기억. 패드 30쌍 긴 작업 7,236 → 3,227ms.
- 대시보드 5초 갱신: fvCommitCam 같은 viewBox 재기록 안 함 · renderFvDeck 지수 카드·시장폭·TOP MOVERS 같으면 안 씀(fvSetH) → 시총맵 재배치(폰 542ms/회) 없어짐.
- 남은 것: 메뉴 전환 첫 그리기 시장 ~200ms·AI 원리 ~250~330ms(renderNews·macroRenderTable·brain-studio) · 폰 전문가 전환 긴 작업 2.4~2.9s(textLength 가설은 틀림 — 첫 생성+대시보드 전체 배치).

### V33.869 (2026-11-26) — 리퀴드 글라스 WebGL(에이전트)
- public/lux-liquid.js·css 전면 교체: 웹 워커 OffscreenCanvas WebGL 하나가 카드마다 '유리 판'(SDF·베벨 법선·굴절+색분산·프레넬 반사·스페큘러·림·두께/바깥 그림자·다크/라이트 틴트)을 한 번 그려 ImageBitmap 으로 카드 맨 뒤 <lg-glass>(shadow DOM 캔버스 · z -1 · 여백 24px)에 붙임.
  다시 그림: 크기 변화·스크롤 멈춘 뒤 40px 넘게 움직임·테마·창 크기만 · 스크롤 중 0 · 유휴 시간 · 동시 폰 2/데스크톱 4 · 보이는 카드만 · 메모리 상한 폰 9M/데스크톱 16M px.
  배경 오로라: JS LAYERS 한 곳에서 셰이더 uniform 과 html.lg-gl::before CSS 를 같이 만든다. 그림 붙은 카드(.lg-g)는 CSS 배경·blur·테두리·그림자 걷음 · 폰 하단 탭은 CSS 흐림 유지+유리 그림.
  물러남: WebGL/워커/OffscreenCanvas 없음·컨텍스트 잃음 → 종전 CSS 유리 · localStorage luxGlass=off. V33.866 SVG 굴절·.lg-rim 삭제.
- 실측(헤드리스 swiftshader · CPU 4배): 데스크톱 12동작 긴 작업 21.2s/19.2s → 5.1s/5.0s · 폰 스크롤 p50/p95 16.7/16.8 그대로.
- 남은 것: static+자손 120개 넘는 큰 패널(TOP MOVERS 등)은 CSS 그대로 · 실기기 GPU 미확인 · 진단 window.luxGlass.stats 남김.

### V33.868 (2026-11-26) — 메뉴 전환 렉(에이전트 실측 · CPU 4배)
- 주범 lux-liquid.js(V33.866): ResizeObserver 안 읽기·쓰기 교차(강제 배치) 1,081ms → 0 · 대상마다 자손 전체 getComputedStyle 훑기 → '클래스+자식 구성' 단위 기억 · 크기 바뀌는 동안 굴절 내리고 멈춘 뒤 260ms 에 한 번 · 변위맵 384→256 · MutationObserver 는 대상 후보 노드만.
- 시총맵 첫 그리기를 setTimeout 0 으로(새 화면 먼저) · playbook-observatory orbitDraw 한 프레임 800줄씩 나눠 칠함.
- 전문가 전환 첫 화면: 데스크톱 879/1,644 → 269/346ms · 패드 837/624 → 104/96ms · 폰 첫 그리기 2.39 → 0.92s. AI 원리 진입 폰 최장 작업 859 → 188ms.
- 남은 것: 폰 전문가 전환 여전히 무거움(lux-dz 축소 보기 전체 재배치 274ms · 시총맵 SVG 글씨 textLength 956ms) · 시장 화면 openMacro/openFx/renderNews · 스크롤(헤드리스 33ms 중앙값) · WebGL 유리.

### V33.867 (2026-11-26) — 종목 상세 좌우 따로 스크롤 · 왼쪽 글씨 잘림 · UI 디테일(lux-detail.css)
- 종목 상세(≥901): 차트 아래 왼쪽 묶음 `#detailLCol`(정보 탭 #luxInfo · 뉴스 #detailNews(차트 옆에서 이리로 옮김) · 재무 · 전체 보기)이 오른쪽 `.detail-side` 처럼 sticky + 안에서 스크롤.
  좁은 화면은 display:contents(종전 order 그대로). 두 칸 높이는 index.html 의 fit()(V33.855) 이 함께 맞춤 — 페이지 맨 아래 여백 bp 만큼 줄여 끝까지 내리면 둘 다 top 112 에 붙음.
  두 칸 자리 = #detailContent::after(grid-row 8 · 높이 --lcol-h) — 두 칸이 짧아도 페이지가 차트만큼 내려가게. 패드(761~1180)의 max-height:none!important 는 setProperty important 로 이김. 정보 탭 줄(.lxs) sticky top 0.
  실측(헤드리스): 데스크톱 끝까지 내리면 L·R 둘 다 112+700 · 패드 112+620 · 폰 변화 없음.
- 왼쪽 글씨 잘림: #luxInfo 의 한 줄 말줄임(.li .t IR 제목·내부자 설명 · .lxh 머리 · span.p 실적 기간) → 줄바꿈.
- UI 디테일(에이전트): 새 `public/lux-detail.css` — 인기/AI 관심 종목 이름 칸 잘림(열폭) · 입력칸 글꼴 상속 · focus-visible · 버튼 눌림 · 표 행 호버/구분선 · tabular-nums · 모달 진입 모션 · 보유 배지 크기.

### V33.866 (2026-11-24) — 리퀴드 글라스: 블러 → 진짜 유리(굴절 + 빛 테두리)
- 새 파일 `public/lux-liquid.css` · `public/lux-liquid.js`(index.html 에서 lux-admin 다음에 로드).
- 굴절: 크기별 변위맵(둥근 사각형 가장자리 띠 · 볼록 렌즈 기울기)을 캔버스로 그려 SVG feDisplacementMap(R·G·B 세기 다르게 = 가장자리 분산)을 `backdrop-filter:url()` 로 건다.
  크롬 계열 데스크톱(포인터 fine · 폭 ≥900)만 · 대상은 사이드바·상단바·창·지수 카드(REFR_SEL). 스크롤 중엔 잠시 내려 놓고 180ms 뒤 복귀.
- ★프레임 가드★: 켠 뒤 1.5초 프레임 중앙값 >22ms 면 굴절 끄고 7일 기억(localStorage luxGlass=기한) — 헤드리스(GPU 없음) 실측 16.7→33~50ms 라 넣었다. `luxGlass=off` 로 수동 끔.
- 빛 테두리(.lg-rim): 모든 브라우저·폰 — 위·왼쪽 반사 · 아래 반사광 · 포인터 따라가는 반짝임. 폰 프레임 영향 0(실측 16.7/16.8ms).
- 배경 html::before 오로라 위에 작고 또렷한 빛 덩이 4개(고정 · 애니메이션 없음) — 유리가 휠 무늬.

### V33.865 (2026-11-23) — AI 자기 교정 패널 · perf-gate 캐시
- 두뇌관측(playbook-observatory.js) 깔때기 아래 'AI 자기 교정' 패널: 시장별 차선의 베이즈 사후(n·μ±sd·이길 확률·켈리 크기) + 호가창 보호 최근 집계 + 호가 알파(그늘 n/60).
  크기가 실제로 걸리는 차선(시험·인버스·매매법·정식 AI-Q/SROUTE)만 굵게, 나머지는 '참고 ×'로 흐리게(fxApplied).
- `/api/perf-gate` 비-fresh 요청은 swrJson("perfgate", 1분/15분) — 화면 5분 폴링이 사람 수만큼 D1 을 읽지 않게. `?fresh=1` 은 그대로 직접.
- 남은 일: 넓은손절(OMQ_STOP) 첫 실전 진입 확인 · 호가 알파 표본 60 도달 시 자동 켜짐 확인.

### V33.864 (2026-11-21) 폰 렉·첫 화면·아래 탭 버그 · AI 작동원리 렉 (에이전트가 고치다 사용 한도로 멈춤 → 직접 검증해 반영)
- 폰(≤760)·폰 전문가 축소(lux-dz)만: 앱바 로고 광택 애니메이션 끔(배경 위치 애니 = 매 프레임 전체 다시 그리기) · 본문 카드 흐림(backdrop-filter) 끔(유리 모양 유지 · 떠 있는 것만 흐림) · 닫힌 드로어 흐림 끔 · OMNI 회전 steps · 아래 탭바 높이 56px + 셸 아래 여백(홈바 안전영역) · 다시 온 사람 저장본 밀림(CLS) · 초보 대시보드 위 줄 폰에서 안 띄움(lux-glass2.css 끝).
- lux-motion.js: 사이드바 안 보이면 알약 안 단다(폰 배치 140ms) · 로그인 전 MY/AI 원리 탭 표시가 먼저 옮겨 가던 것.
- playbook-observatory.js: 4.5초 순회 = 카드 표시·순번·아래 판정 칸만 바꿈(stepStrip/scanHtml) · 30초 갱신에 내용 같으면 안 그림 · OMNI 점 고르기 = 보관한 기본 그림 위에 고른 선만(1.4~2.6초 → 수백 줄) · 선 묶음 4000→800.
- 실측(CPU 4배 · 긴 작업 합계): 폰 첫 접속 2,112→1,404ms · 폰 AI 원리 대기 10초 439→0 · 폰 포지션 432→237 · PC AI 원리 대기 305→0 · PC 첫 접속 1,250→1,323(잡음). 폰·PC 화면 깨짐 없음.

### V33.863 (2026-11-21) OMNI-Q 실전 손절 = 진입가 − 3×ATR(재난 하한 −15%) · EOD-GAP 끔 · 수량 1R 유지 · 손절 모의 화면 표시
- 근거(로컬 학습기 손절 모의 · 같은 선택 · 11년 일봉 · 퍼지 전진 5구간 · scratchpad/stopsim/run2.py 규칙 9개 비교): 맞춤 초과(t)
  · 현재(美 5%/2ATR · 韓 4%/1.7ATR · EOD): 美5 −0.01%(0.53) · 美20 +0.77%(0.61) · 韓5 +0.32%(2.06) · 韓20 −0.47%(−0.57)
  · ATR3만: 美5 +0.36%(2.34) · 美20 +2.54%(2.42) · 韓5 +0.46%(2.78) · 韓20 +1.39%(2.54) — 네 머리 모두 상위 · 재난 −15%만도 비슷 · EOD 끄면 같거나 조금 나음.
- 워커 executeBuy: signal.isOmniQ 면 손절 = max(진입 − 3×ATR, 진입×0.85) · 종전 손절거리 대비 수량 축소(_szNote '넓은손절' · 1R 금액 불변) · meta.stopOv 에 실어 _capStopPrice 가 안 좁힘 · meta.omq+stopOv 보유는 EOD-GAP 제외. OMQ_STOP 상수.
- 학습기 STOP_RULES 도 같은 자(pct .15 · atr 3 · EOD 끔)로 — stopSim 이 실전 규칙을 잰다(금요일 회차부터).
- 화면: studio OmniQ Gate '③ 실전 손절 넣은 모의(측정)' 칸 · OmniPerf 힌트 '실전 손절 넣으면' · Kpis 4칸 제한 → 8칸(관문 칸이 잘렸다). brain-studio.js 재빌드.
- 미반영: 폰 화면 에이전트(사용 한도로 중단)의 작업 중 변경 public/lux-glass2.css · lux-motion.js · playbook-observatory.js — 검증 전이라 이 판에 안 넣음.

### V33.861~862 (2026-11-21) 베이즈 켈리 크기(손실 차선 멈추지 않고 자기 교정) · 호가창 체결 보호 + 알파(근거 쌓이면 자동 켬) · OMNI-Q 손절 모의 측정
- 사용자(11/21): "멈추게 하지 말고 AI가 스스로 구조적으로 해결 · 퀀트처럼 · 호가창도 쓰게". 평가(라이브 30일): 美 OMNI_Q 10건 승률 20% −2.77% · 韓 19건 16% −3.10% · 美 SROUTE 신규 매매법 6건 전패 −8% · 韓 probe PF 0.09. 수익은 현금 91~93% 덕.
- 베이즈 켈리(LANE_BAYES · laneBayesPost/Attach/Mult · perfGateLoad 같은 질의·15분 캐시 안 · D1 추가 0): 차선→꼬리표→매매법 계층 정규-역감마 사후(사전 무게 8 · σ5% · 차선 사전 +1%). 크기 = (μ/σ²)÷기준 → [0.1,1] · 증거 없으면 ×1 · 음수면 ×0.1 학습 크기(최소 1주) — 멈추지 않는다. probeLaneCheck·executeBuy(OMNI-Q·SROUTE)·인버스(runInverseLane) 적용 · 종전 laneAdaptMult 는 상한. 원장 재생: KR −425,415 → −71,595원 · US −$1,420 → −$302(개선은 전부 크기 축소 — 진입 실력은 그대로). /api/perf-gate lanes[k].post {n,mu,sd,pPos,kellyMult} · /api/ai-mode lanes.bayes. check-perf-gate ⑥.
- 호가창(obAssess·obBuyCheck(qty)·_obFetchCycle 8종목/사이클·45초 기억·2.5초 제한·실패 시 그냥 산다): 체결 보호 즉시 — 매도호가 > 가격×(1+max(2틱,0.3%)) 이면 nochase · 간격 > max(3틱,0.6%) delay · 韓 근접 3단계 잔량 부족 shrink/delay · 30분 두 번 미룬 뒤엔 가격 상한만 · 인버스·국면단타 면제. 알파(imb → ×0.70~×1.15) = 그늘(결과 붙은 표본 0) · OB_EV_RULE(시장 n≥60 · 구간 ≥12 · 단조 · 차 ≥0.5%p · t≥2) 넘으면 자동 켬/못 미치면 자동 끔(6시간 재계산 · state ob_ev). 호출 위치를 크기 배수 뒤·위험 엔진 앞으로 옮김. /api/orderbook .ai · /api/orderbook-ai(swrJson 1분).
- OMNI-Q 학습기: sim_gate 에 stopSim(실전 손절 max(ATR×2.0/1.7, 5%/4%) + EOD-GAP 0.35R 일봉 근사) 측정 칸만 추가(판정 불변). 로컬 근사: 무손절 → 손절 mx 美5일 +0.41→−0.01% · 美20일 +3.40→+0.77% · 韓5일 +0.49→+0.32% · 韓20일 +2.15→−0.47%. 20일 머리 실력 대부분이 손절에서 사라짐 → 다음: 손절폭 8%/12%/ATR3/재난만 비교(STOP_RULES) 후 머리별 손절. 값은 다음 금요일 회차부터 /api/omni-status gate.g3.stopSim. 화면 칸은 다음 판(studio OmniQ Gate · OmniPerf).

### V33.860 (2026-11-21) 관리자 및 개발자 메뉴 · 인버스 차선 개장 직후 낡은 시세 진입 막기 · 국면 청산 30분 머묾
- 설정창 → '관리자 및 개발자 메뉴'(버튼·명령 팔레트·비밀번호 창 문구). public/lux-admin.js 가 창이 처음 열릴 때 섹션(.section-title)을 6개 탭(상태·AI 지시·계좌·종목·전략·위험 관리·학습·도구)으로 다시 담는다(입력 id·저장 로직 그대로) · lux-admin.css(유리 · 넓으면 카드 2열 · 폰 전체 화면).
- 인버스(runInverseLane): 시세 ts 는 '저장 시각'이라 30분 신선 검사를 통과해도 전일 종가일 수 있었다(#4583 11/10 09:00 252670.KS 128=전일 종가 · 그날 111~119 → −58.5만원 · #4641 −13.9만원). → 정규장 시작 5분 안 신규 진입 금지 + 진입 시세 ts ≥ 오늘 개장(invEntryQuoteOk). 'regime'·'delever' 청산은 자격 없는 국면이 30분 이어질 때만(invRegimeDefer · meta.invRegOff · 상태 바뀔 때만 1쓰기). 손절·익절·최대보유는 즉시. 원장 재생: 낡은 시세 진입 2건(−72만원) 차단.
- 통합 방식 메모: 여러 에이전트가 같은 작업 폴더를 고치는 중이라, 검사는 scratchpad/wt(git worktree --detach)에 이번 묶음만 얹어 돌리고 그 사본에서 커밋했다. check-walk-forward 는 기계가 바쁠 때 python ETIMEDOUT 로 떨어질 수 있다 — 단독으로 다시 돌리면 통과.

### V33.859 (2026-11-21) 미국 유니버스에 ANT(Anthropic) 추가 — 2026-11-19 나스닥 상장(나스닥 info·야후 chart 실측 · 11/20 종가 88.91 · 시총 약 1.2조$)
- DEFAULT_US(SPCX 다음) · NAME_MAP "Anthropic" · MCAP_RANK 9.5(정수 1~60 결번 0 · 동점 상한 29 안 늘림) · 섹터 TECH/US_TECH · 지도 '기술'. 일봉은 상장 3일치뿐 — 장기 지표는 쌓일 때까지 비어 있음(SPCX 선례).

### V33.858 (2026-11-17) 포지션 전체 보기 카드 원 그래프 목록: 종목 수익률 숨김 · 이름 칸 넓힘(나란히 두 칸에서 'Da…' 로 잘림 · 라이브 실측). 라이브 확인: 전체 페이지 3,529 → 1,052px · 합산 요약·접힘 정상.

### V33.857 (2026-11-17) 포지션 전체 보기에서 보유 목록을 펼친 카드는 한 줄 전체(:has(.pz-list)) — 나란히 두 칸이면 표가 비좁았다(라이브 실측).

### V33.856 (2026-11-17) 포지션 '전체' 한 장 · OMNI 푸른 홀로그램 · MY 한 화면 · 대시보드 촘촘
- LUX-POSITION 전체: #pzAll(index.html pzAllRender · window.__pzBook ← renderSummary/renderCommodities/renderAltPanel · 환율 window.__usdkrw ← 대시보드 FX USDKRW, 없으면 1400 대략) = 5계좌 원화 합산 · 원 그래프(종류별) 왼쪽 · 전 종목 목록 오른쪽 · 계좌 칩(누르면 그 탭). 미국·한국 카드 나란히(≥1100) · 보유 목록 기본 접힘(luxPzOpen2) · 채권·원자재 상세는 '대체' 탭.
- OMNI 코어(playbook-observatory.js orbitProject/orbitDraw): drawCore 대신 직접 투영 · 남색 빛무리 + 위도·경도 격자 + 가중치 선 7단(가산) + 뉴런 점 + HUD 고리. 나무 분기(lk 3 · 1.4만 줄)가 고리 사이를 가로질러 판처럼 보여 강한 것(ls≥.5)만 옅게. 노드 고르기·카드 그대로.
- MY(≥1100): .mhome 높이 = 화면 − 150px · 두 칸 각자 스크롤 · 글자·여백 축소 → 1440×900 · 1180×820 페이지 스크롤 0(실측).
- 전문가 대시보드(≥1000): 지수 카드·시장폭·표 줄·패널 머리·간격 축소 · 상승/하락 목록 470px 안 스크롤 → 1440×900 첫 화면에 실적·원자재·환율 줄까지.
- 주의: 버전 올릴 때 index.html 전체 's/33.xxx/…/g' 는 주석 속 [V33.xxx] 표식까지 바꾼다 → 'v=33.' 와 lux-build 만 바꿀 것.

### V33.855 (2026-11-17) eqh 복원이 안 돌던 것 — '현지 16시 뒤' 조건이 복원까지 막았다(ET 새벽 2시 실측 30분 동안 none). 복원은 장 닫힘이면 언제든 · 오늘 줄만 16시 뒤.

### V33.854 (2026-11-17) LUX-POSITION 한눈에 — 원 그래프 + 총자산 곡선
- 화면: index.html pzViz(calcSummary 의 hold[] · window.__eqh) → 카드 큰 숫자 아래 .pz-viz(원 그래프 = 종목별 평가액·현금 비중, 종목 수익률 · 곡선 = 날짜별 총자산 + 지금 값, 점선 = 시작 자본, 최대 낙폭). 배분 바는 숨김. CSS lux-glass2.css 끝.
- 서버: state "eqh:us|kr" = [[YYYY-MM-DD, 총자산]] 400일. 처음 한 번 eqhBackfill(trades + dtail days·closes 재생 · 입출금 0 · 수수료·세금·슬리피지 같은 함수) → 이후 eqhDaily(장 CLOSED·현지 16시 뒤 · 10분마다 검사 · 시장당 하루 1쓰기 · 휴장이면 줄 안 늘림). /api/state(buildStatePayload) 에 eqh 로 실림.
- 확인할 것: 배포 뒤 미국(장 닫힘) 먼저 채워짐 → /api/state 의 eqh.us 길이·첫날(6월) 확인. 한국은 16시 KST 뒤.

### V33.853 (2026-11-17) 스레드 링크 카드 공유 주소 /p/<이름>
- src/index.js '/p/' 경로(robots.txt 앞) · public/promo/share.json · robots 에 facebookexternalhit/meta-externalagent Allow /p/·/promo/ · tools/threads/post.py kind LINK. 자세한 쓰는 법은 아래 'Threads 게시 워크플로'.

### V33.852 (2026-11-17) 초 단위 시세 루프 = Durable Object(LiveQuotes) · 리퀴드 글라스 이어서
- 원인(V33.850 실측): cron 호출 안 waitUntil 루프가 같은 isolate 의 매매 사이클 CPU 에 막혀 live.js 가 10~40초 간격.
- 이제 src/index.js `export class LiveQuotes`(wrangler.toml [[durable_objects.bindings]] LIVEQ · migration v1-liveq new_sqlite_classes).
  cron → liveQuoteKick(방문 15분 안 · 장 열림일 때만) → DO fetch '/kick' = 2.5분 임대 연장 + 알람 없으면 켬.
  DO alarm: liveQuoteTick 한 번(한국 열림 5초 박자 · 미국은 두 번에 한 번=10초 · 미국만이면 10초) → 다음 알람. 임대 끝/두 장 닫힘이면 멈춤.
  미국 첫 조각 0행이면 5분 쉬고 인증 다시. 바인딩 없으면 옛 루프(liveQuoteLoop) 그대로.
  확인: GET /api/liveq → {until,n,writes,syms,usDeadUntil,alarm}.
- 주의: `wrangler deploy --dry-run` 은 [build] tools/build-split.mjs 를 돌려 public/index.html 을 쪼갠다 → 로컬에서 돌렸으면 `git checkout -- public/index.html && rm -rf public/_b`.
- 글라스: 종목상세 불투명 카드(detail-vcard/crowd/anl/fund · lxs/lxt · fp-qmj · tf · lxa-rg)·뉴스 섹터·포지션 버튼을 유리 한 벌로. 고정 가격 머리줄(detail-head)은 뒤 글자가 비쳐 .95 불투명 유지.

### V33.851 (2026-11-17) AI 작동원리 단순화 · 노드는 AI 코어에서 · 유리 카드 · 종목상세 오른쪽 칸 따로 스크롤
- V33.850 의 두 칸 배치 철회 → 매매법 AI(위) · OMNI 성능(아래) 한 줄.
- 두뇌 스튜디오 기본 = OMNI 성능 지표만(studio/src/views/OmniPerf.tsx · /api/omni-status · 시장별 5일/20일 머리 승률·하한·t·구간·모의 초과, '관문 자세히' 펼침). '전체 모델 구조 열기' 버튼으로 예전 App(전체) — main.tsx Root.
- #pbObs AI 코어(OMNI 구체) 클릭 → CSS 회전각 되돌려 가장 가까운 '묶음 뉴런' 선택 → 그 선만 밝게 다시 긋기 · 아래 NODE DOSSIER(묶음 칩·목록·이름/묶음/세기/닿은 선/역할 NODE_ROLE.omniRole). 선택 중엔 회전 멈춤.
- 유리 카드: lux-glass2.css 끝(#pbObs .k-panel/.ko-k/.k-card · .bs-perf/.bs-tile). 회전 그림 칸에는 backdrop-filter 를 두지 않는다.
- 종목상세: .detail-side(오른쪽, sticky·안쪽 스크롤) 높이를 '화면 안에 남은 높이' 로 맞춤(index.html IIFE · 스크롤/리사이즈/ResizeObserver 때 rAF 한 번). 실측: 전엔 칸 아래 447px 가 화면 밖이라 끝이 안 보였다.

### V33.850 (2026-11-17) AI 작동원리 — AI 코어 = OMNI 코어 · OMNI 렉 근본 원인 · 한 화면 두 칸
- 렉 실측(아이패드 가로·CPU 4배 느리게·소프트웨어 WebGL): 페이지 요소 1.4만 개인데 OMNI 가 매 장면 이름표·점 ~120개를 옮겨 PrePaint 가 페이지 전체를 훑었다(3초에 399ms).
  → studio/src/gl/omniGL.ts 그림 칸 `contain:strict` · 안쪽 그림 25fps(31→40ms). 재빌드 → public/brain-studio.js. check-brain-studio ④ 갱신.
- #pbObs 'AI 코어' 입자 구체(900점 30fps 메인 스레드) → OMNI 구조(/api/omni-structure · CDN 5분)를 한 번만 그려(drawCore+drawRest 쉬는 틈) CSS 로 회전 · 화면 밖이면 멈춤. 위성 = 뜬 신호/고른 매매법 점(DOM).
- 매매법 패널 4.5초 순회 다시 그리기는 패널이 화면 안일 때만(IntersectionObserver rootVis).
- 넓은 화면(≥1360px) 작동 화면 = 왼쪽 매매법 AI · 오른쪽 모델 구조, 각 칸 화면 높이 안 스크롤(lux-glass2.css 끝). #pbObs container query 로 좁은 칸 배치.
- 스튜디오 선택 칩(bg-ink text-bg) 글자 투명 → 진한 색 고정(lux-glass2.css).
- 라이브 실측(11/17 09:33 KST, 한국장): V33.850 배포·두 칸 배치·OMNI 코어 확인. pub/f/live.js 는 5초가 아니라 10~40초 간격으로 갱신 — data ts 와 _pubAt 이 21초 벌어짐 → 같은 isolate 의 매매 사이클 CPU 가 타이머를 막는 것으로 추정. 다음: 시세 루프를 매매 사이클과 다른 호출로 분리하는 방안 검토.
- 남은 일: V33.848 dtail CPU 효과(/api/usage stp.trading) 하루 뒤 비교.

- **V33.849** 사이드바: 나갔다 들어오면(뒤로 가기 캐시·탭 복귀) 선택 알약이 옛 자리에 남아 선택 메뉴가 검은 글자로 어긋나던 것 → pageshow·visibilitychange·사이드바 크기 관찰로 다시 잼(lux-motion Pill) · 접힌 사이드바 선택 칸이 아이콘 폭(22px)으로 줄던 것 align-self:stretch. MY: 종목 검색·관심을 AI 추천 위로 · 위 탭(홈·순위·내 정보) 유리 알약(520px 가운데). 리퀴드 글라스 더 투명(카드 흰 1~7% 그라데이션 · 위 테두리 빛 · 흐림은 사이드바·탭만). LUX-POSITION MY 처럼(카드 화면 폭 꽉 · 총액 44px 히어로 · 유리 알약 탭 · KPI 칸).
- **V33.848** ① ★일봉 짧은 사본 dtail:SYM(최근 400봉)★: 매분 매매 사이클이 원본 daily: 전체(종목당 최대 2,400봉 · 하루 파싱 ~8GB · CPU 의 절반)를 읽던 것을 사본 범위 읽기로 — 사본 없는 종목만 원본을 읽고 그때 사본을 만든다(한 번에 300 · 첫 며칠). 원본을 쓰는 3곳(getDailyCached · 일봉 샤드 · 사이클 묶음 쓰기)에서 사본도 같이 씀 · flowDailyCacheLoad 는 사본이 900종목 이상일 때만 사본 원문 사용(마지막 70봉). 원본은 차트·학습·소급 생성용으로 그대로. ② ★화면용 실시간 시세 한국 5초 · 미국 10초★: 크론 안 liveQuoteLoop(55초 동안 기다렸다 받기 · ctx.waitUntil) → R2 pub/f/live.js(DB 쓰기 0 · 화면 열림 15분 · 장 중만 · 미국 첫 묶음 0건이면 그 분 생략 · 요청 예산 250 남김) · 대시보드가 5초마다 CDN 사본을 받아 TOP MOVERS·지수·지도만 고침. ③ ★종목 상세 차트 마지막 막대 실시간★: orderbook.js 5초 체결가 → lux:obprice 이벤트 → 마지막 막대 종가·고저 · 분봉 새 막대(가격 바뀔 때만) · 일·주·월봉은 오늘 막대 있을 때만 · 한국 누적 거래량 차이. 배포 뒤 CPU(usage stp trading)·R2 쓰기·live.js 나이 실측 필요.
- **V33.847** ★MY 한 페이지★(사용자 11/16): 탭 홈·순위·내 정보 3개 — 관심·계좌는 홈 안(#mjWatch · #mjAcct · 옛 data-tab watch/acct 는 홈으로 와서 그 칸으로 스크롤). 총자산 카드에 자산 원 그래프(보유 종목 + 현금 비중 · SVG) + 수익률 곡선(prof.pf[mk].eqh 하루 1번 기록 · 최근 120일 · 하루 첫 기록만 서버 저장 persist — 1행 묶음 저장 규칙) · PC 2열(왼 = 총자산·계좌 상세 · 오른 = 시장·AI 추천·관심·AI 포트폴리오). 계좌 상세의 중복 총자산 카드는 숨김.
- **V33.846** ★AI 작동원리 01 작동 화면 + 02 모델 구조 한 페이지★(사용자 11/16): 탭 2개(01 작동 · 모델 구조 / 02 후보 · 로그) · 매매법 판정(#pbObs) 아래 '모델 구조' 머리 + Brain Studio(#brain-studio — 600px 앞에서 IntersectionObserver 로 늦게 불러옴) · luxBrainView('models') 는 01 로 가서 모델 칸으로 스크롤 · workspace-layout.css 224·186. 리퀴드 글라스 투명(#pbObs 패널·Brain Studio --bs-bg 반투명 + blur16). CPU 실측(에이전트 11/16): 11월 추정 24.5M/30M(82% · 실측 아님 cpuCalibration 0.01 추정) — trading 51%(dailyBulk 파싱 하루 ~8GB · 매분 새 아이솔레이트라 메모리 캐시 거의 안 맞음) · extSweep 16% · D1 쓰기 44% · 읽기 2% · 요청 0.4%. 일봉 캐시 10→60분(3곳 · 효과 작을 수 있음 — 다음: 종목별 짧은 꼬리 키로 파싱량 줄이기). Threads 개발일지 15 이미지 2장 캐러셀 게시.
- **V33.845** MY 홈 리뉴얼(사용자 11/16 참고: 한 화면 프리미엄 대시보드): 총자산 카드 히어로(청록·보라 빛) + KPI 4칸(주문 가능·주식 평가·평가손익·보유) · ≥1100px 벤토 2열(왼 = 총자산·AI 추천 · 오른 = 시장 국면·AI 포트폴리오, #mineRoot.mwide 1240px) · 폰은 세로 그대로(KPI 2×2). mine.js home() .mhome · 스타일 #mineV845.
- **V33.844** 사이드바 접기/펼치기 ★연속 모션★: 본문은 최종 폭으로 한 번만 배치 · 사이드바는 clip-path 로 가장자리 밀고 당김 · 본문은 같은 곡선 transform(합성기) · 접을 땐 넓은 배치 그대로 margin-right 음수로 자리만 줄였다가 끝에 아이콘 배치(lux-topbar.js · .lux-sbmv). ★리퀴드 글라스 투명도↑★(인스타 Glass Sidebar V2 참고): 사이드바·아래 탭 .78→.38 + blur22 saturate170 · 카드 흰 7%→1.5% 그라데이션 · 종목 상세 카드 .86→.5. Threads 개발일지 15 영상·글 초안(promo/threads/devlog-15.*) 사용자 확인 대기.
- **V33.843** AI 작동원리 01 작동 화면 맨 위를 ★오빗 배치★로(사용자 11/16 인스타 Orbit 대시보드): playbook-observatory.js brief() → 가운데 캔버스 입자 구체(900점 · 뜬 신호·고른 매매법이 많을수록 밝고 빠름 · 궤도 위성 = 뜬 신호 노랑/고른 매매법 초록) + 좌우 숫자 카드 4개 + 아래 판정 설명. 캔버스는 한 번 만들고 다시 그릴 때 자리만 옮김 · 보일 때만 30fps.
- **V33.842** ★종목 상세 리뉴얼(빈 공간·가독성 · 사용자 11/13)★ lux-glass2.css 끝: 머리줄 얇게 · AI 분석 접이 카드 전부 전체 폭(반폭 하나 남아 오른쪽 비던 것) · 빈 '기술적 패턴' 제목 숨김 · ★오른쪽 열 sticky(top 112 · 화면 높이 · 안에서 스크롤)★ — 왼쪽/오른쪽 길이 차이로 한쪽 아래가 통째로 비던 것 · 재무(#detailFund)는 왼쪽 열 1칸 세로(재무표 4개 연도 잘림 해소) · 업종 비교 행 이름|막대|백분위|값·중앙 한 줄|차이 · 작은 회색 글씨 12.5px·밝게.
- **V33.841** 라이브 확인(11/13 09:3x KST): 한국 호가는 네이버가 ★5단계★만 준다(10 아님) — 창 머리 글자를 받은 단계 수로. 실시간 체결가(polling) 삼성 213,000 +2.4% 정상.
- **V33.840** ① 호가창 = 종목 상세 차트 바로 옆(≥901 2열 격자 col2 row3 · 차트 높이에 맞춰 안에서 스크롤 · 매도↔매수 경계 가운데) — 그 칸에 있던 시세 데이터는 오른쪽 열(.detail-side) 맨 위로(orderbook.js host) · 폰은 차트 바로 아래. V33.838 이 screen.width(아이패드 사파리 834)로 판정해 패드 가로에서 맨 아래로 가던 것 수정. '호가' 탭(V33.839)은 뺐다(차트 옆과 중복). ② 재무분석: 왼쪽 반폭(273px 칸)에 갇혀 있던 #detailFund → 오른쪽 열 끝난 뒤 전체 폭(grid-row 8) · 재무표|평가 + 업종 비교 전체 폭. ③ 보고 있는 종목 실시간 체결가: /api/orderbook 같은 5초 묶음에 네이버 polling 체결가(한국) · 나스닥 lastSale(미국) — 추가 요청 없음. 전 종목 초단위는 안 함(크론 최소 1분 · 1,004종목을 초마다 받으면 원천 차단·DO 비용) — 사용자에게 설명. Threads 개발일지 13 게시.
- **V33.839** 종목 상세 정보 탭에 '호가'(AI 분석 다음 · stock-info.js TABS ob → luxOB.mount 로 호가·체결 창을 탭 안에 크게). Threads 개발일지 13 을 '월 7천원으로 사이트 만드는 법'(따라 하기 5단계 · 사용자 11/13 "6번 빼고") + 이미지 public/promo/devlog13-howto.png 로 바꿔 게시.
- **V33.838** ① 사이드바 접기 렉(아직 심각 — 사용자 11/13): 추적 결과 접을 때 문서 배치가 두 번(폭 변경 435ms + 지도 SVG 재생성 3천 개 317ms · 4배 감속)이고 첫 번째는 lux-motion 알약이 rAF 안에서 위치를 재 강제한 것 → 알약은 프레임 뒤(setTimeout)에서 재고, 지도는 폭이 35% 안쪽으로 바뀌면 늘려 보이고 4초 뒤 다시 그림(fvHostSize RO) · 패드~작은 PC 첫 화면 아래 덱 묶음 content-visibility:auto → 329+92ms. ② 사이드바 아이콘 가끔 안 보임: 선택 메뉴 아이콘은 진한 색이고 바탕은 움직이는 알약 — 알약이 자리 못 잡으면 안 보였다 → 알약 없을 때 선택 메뉴가 스스로 바탕(lux-glass2 끝). ③ /api/logs(대시보드 실시간 피드 · 탭마다 20초) 아이솔레이트 3초 캐시라 사람 수만큼 D1 → swrJson 15초(colo 공유). ④ ★호가·체결★: fetchOrderBook(한국 네이버 askingPrice 10단계 · 미국 나스닥 info 최우선 호가 + realtime-trades) · /api/orderbook(swrJson 5초) · 종목 상세 호가 창(public/orderbook.js · 보이는 동안만 5초) · 엔진 executeBuy 실제 매수 직전 obBuyCheck → signal.ob/meta.ob(imb·near·spread) + state ob_obs(최근 400) · ★OB_GATE_LIVE=false(관측만)★ — 2주 이상 쌓아 매도벽(near≥3 · imb≤0.25) 매수 성과를 에이전트로 검증한 뒤 켤 것. 미국 10단계 호가는 무료 원천 없음. 이 작업 환경 Node fetch 는 네이버 403(curl 200 · 워커는 기존에 같은 헤더로 네이버 사용 중) — 라이브에서 장중 확인 필요.
- **V33.837** ① 사이드바 접기 렉(사용자 11/13 아이패드 "매우 심각"): html 클래스 토글(문서 전체 스타일 재계산 ×3)·폭 0.3초 전환(매 프레임 배치·흐림)·끝의 resize 이벤트(지도·차트 전부 재그림)를 없앰 → 클래스는 nav.lux-mini 에만 · 폭 한 번에 · 사이드바 속만 0.2초 투명→보임(WAAPI). 선택 알약은 .sb-nav 에 lux-mini-n 토글로 다시 잼(lux-motion 관찰자). 로컬 토글 긴작업 ~100~150ms(전 200ms×3). ② 대시보드 큰 빈칸: 패드·PC 지도(#fvHeatmap) 330px 고정 → 칸 높이 채움(flex · 벤토도 stretch). ③ 실측 11/12: quote_us 24s · kr 33s · 애프터 558 중 479 · D1 읽기 1,922만/일(월 ~5.8억 · 포함 250억의 2%) · 쓰기 ~80만/일(월 ~2,400만 · 포함 5천만의 ~48%, 최대 state:quote 67만) · CPU ~104만 ms/일(월 ~3,100만 — 포함 3천만 살짝 넘음, 초과분 ~$0.02). ④ 전문가↔초보자 전환 렉·요금(사용자 11/13): 전환마다 /api/state·거래내역 재요청(refreshAll) → 마지막 수신 30초 넘었을 때만 · 초보자는 본 화면의 window.__lastState 재사용(요청 0) · 같은 데이터면 다시 안 그림 · 패드·PC 는 전문가 카드를 display:none 대신 content-visibility:hidden(높이 0)으로 숨겨 돌아올 때 배치 재사용(index.html 머리 스타일) · resize 재발송 폰만. 실측(4배 감속) 전문가 복귀 966→~220ms · 전환 API 요청 0건. ⑤ MY 보유 카드 글자 잘림(좁은 폰): 이름 줄바꿈 허용 · 수량/평단/현재 덩어리 줄바꿈 · MY 탭 고정 위치 top 0(위 틈으로 내용이 비치던 것). ⑥ Threads 개발일지 13 원문(promo/threads/devlog-13-post.txt · 이미지 public/promo/devlog13-cost.png) — 게시 전.
- **V33.836** 패드·PC 사이드바 접기/펼치기(사용자 11/12 인스타 영상처럼 "아이콘만"): 사이드바 맨 위 둥근 버튼(.lux-sbcol · lux-topbar.js 끝) → html.lux-sbmini(폭 68px · 로고·메뉴 아이콘·MAP 아이콘·KO/EN·☀/☾ · 시장 시계·초보자/전문가 전환은 숨김 · 메뉴 이름은 마우스 툴팁) · localStorage lux-sbmini 기억. 렉 방지: 사이드바 폭만 0.3초 전환하고 본문은 처음에 최종 폭으로 고정해 한 번만 배치(로컬 1회 긴작업 ~200ms). Threads 개발일지 12 게시 성공(run 18 — 토큰 차단 풀림).
- **V33.835** 폰 전문가 대시보드 드나들 때 "이상한 화면"(사용자 11/11 아이폰 15 Pro Max 사진 — 회색 뼈대 칸): 원래 디자인(축소 보기 lux-dz) 그대로 두고 뼈대(#luxDzSpin)를 안 그린다 → 폭 전환 동안 배경만 잠깐 → 0.2초 부드럽게 드러남. 가림을 html 클래스(lux-dzsw) 대신 main.content 인라인 opacity 로(html 클래스 토글마다 1만2천 요소 스타일 재계산이 두 번 더 돌았다). 실측(크롬 4배 감속): 남은 시간은 거의 전부 브라우저 배치(Layout 6,630개 815ms) — JS 는 0.1초 미만. 사용자가 "폰 전용 배치(한 줄/두 칸)는 하지 말고 원래 디자인 유지" 라고 해서 폰 네이티브 배치안은 버렸다.
- **V33.834** 패드·PC 대시보드 복귀 렉: 화면(.page)들을 main.content 의 같은 칸(grid 1/1)에 겹치고, 숨은 대시보드는 display:none 대신 content-visibility:hidden 으로 둬 다시 켤 때 6천 개 재배치를 안 한다(로컬 패드 CPU4× 복귀 1147ms → 54~95ms 긴작업). 대시보드 진입 pageFx 애니메이션 제거(중간 화면 원인). 사이드바 높이 100dvh(아이패드 사파리 하단 Light/Dark 잘림). 폰(lux-dz)은 그대로.
- **V33.833** ★미국 시간외 절반 누락의 진짜 원인(진단 V33.832 로 확인)★: 나스닥 시간외 배치 대상(_xm)이 "앞 단계가 pre 든 post 든 값을 줬으면 제외" 였다 — 프리마켓에 야후가 준 건 어제 애프터 값이라 뒤에서 세션 마스크로 지워지고, 오늘 프리값은 아무도 안 받았다(nqx: 558종 중 나스닥행 2~3종). → 지금 세션 필드(PRE=pre · POST=post)가 있을 때만 제외. V33.828~831 은 부수 개선(덮어쓰기 경쟁 · 동시 요청)이었다. 진단 nqx_dbg 는 그대로 둔다(묶음 3개 · 매분 1행).

- **V33.832** 진단: 시간외 나스닥 배치 묶음(첫 종목 키)별 결과를 state nqx_dbg:<첫종목> 에 남기고 /api/data-health 의 nqx 로 보인다(받은 수·요청·오류·남은 예산·빠진 종목 12개). V33.831(동시 3·재시도) 뒤에도 RTX·WFC·TMUS 프리값이 계속 비어 원인 확인용.

- **V33.831** 미국 시간외 값이 절반만 들어오던 ★진짜 원인★: 나스닥 시간외 배치를 동시 6요청 · 5초 제한으로 보냈는데, 나스닥은 몰리면 응답이 1~8초 → 다수 실패(실측 동시 14요청 중 8 실패 · 동시 3은 0 실패). 원본엔 RTX 등 프리 체결이 있는데 558 중 ~290만 값. → 동시 3 · 제한 9초 · 실패 묶음은 하나씩 한 번 더(요청 수 동일 · 실패분만 재시도).

- **V33.830** 폰 전문가 지도에서 확대 전 종목 이름이 안 보이던 것 — V33.824 의 축소 보기 글씨 기준(화면상 4px 미만 생략)을 원래(1.6/2.2)로 되돌림. 지도 글씨 배치 비용은 실측 17ms 로 작았다. 이름 있는 글씨 117 → 1053개.

- **V33.829** 시간외 값 지우기 ★경쟁★: 사이클은 시작 때 읽은 prevQ 로 행을 통째로 덮는데, 그 사이 가격 샤드(나스닥 배치)가 새 프리값을 쓰면 모른 채 지웠다(V33.828 의 JS 이어받기로는 못 막음 · 실측 06:00 ET RTX·WFC·TMUS 등 원본엔 프리 체결 있는데 558 중 282만). → 두 사이클 기록을 QUOTE_UPSERT_KEEP_EXT 로: 이번 행에 시간외가 없고 mstate 같으면 DB 에 있는 pre/post/extTs 를 json_set 으로 유지(쓰는 순간 · 추가 읽기/쓰기 0 · sqlite 3.45 로 동작 확인). 시세 자체는 이미 전 종목 매분(실측 quote ts 전부 1분 안) — 회전은 일봉 지표·폴백만. 폰 축소 보기 가림막: resize 뒤 80ms 대기 제거 · 상한 0.5→0.42s · 페이드 0.2→0.12s.

- **V33.828** 미국 시간외(프리·애프터) 값이 상위 종목에서 비던 것: 매분 매매 사이클의 quote 기록(시세 루프 26xxx · 평가 루프 27xxx)이 받은 bq 에 시간외가 없으면 quoteSessionFields 로 pre/post=null 을 덮어써, 가격 샤드(나스닥 배치)가 채운 값을 1분마다 지웠다. 실측 11/11 05:17 ET: 557종 중 192종만 프리값 · 상위 11종(NVDA~WMT) 0 · 나스닥 원본엔 NVDA 176.20. → quoteSessionFieldsKeep(q, prev, market): 이번 값이 비면 같은 세션 딱지의 직전 값을 잇는다(extKeepMaskFor 마스크 · 지난 세션 값은 안 이음). __cycPrevQ = prevQuoteMap.

- **V33.827** 폰 전문가 대시보드 드나들 때 가림막을 빈 배경+로딩 원 → 화면 모양 뼈대(#luxDzSpin 안 카드 6칸 · vw/vh 크기라 보기 폭 390↔1180 전환 앞뒤 같은 자리 · opacity 깜빡임은 합성기). 사용자 "중간에 이상한 화면 · 끊김" = 빈 가림막. 패드(iPad Pro 11 가로)는 중간 화면 없음(연속 캡처 확인). 스타일은 lux-glass2.css 끝.

- **V33.826** 폰 종목 상세 머리에 시간외(프리·애프터·데이마켓) 가격·등락률 다시 표시 — detail-v3b.css:162 가 폰(≤760)에서 .detail-ext 를 display:none 하고 있었다. lux-glass2 끝에서 .detail-px 를 2열 grid(가격·등락 / 시간외 줄 전체폭 오른쪽 정렬)로 — flex 100% 로 두면 가격 칸이 넓어져 종목명이 "N" 으로 잘렸다.

- **V33.825** 폰 전문가 대시보드 드나들 때 옛 배치·찌그러짐·깜빡임: ① showPage 가 보기 폭이 바뀔 이동(__luxDzWill)이면 가림막+로딩 표시(#luxDzSpin · 7vw)를 먼저 한 프레임 그린 뒤 rAF+setTimeout 으로 실제 전환 — 종전엔 누르자마자 배치가 시작돼 이전 화면에 1초+ 멈췄다 찌그러진 화면이 비쳤다. ② 가림막은 0.16초 고정 → resize 확인 후 80ms + 2프레임(최대 0.5초) · .content visibility:hidden. ③ V33.824 의 지도 늦게 붙이기(lux-dzlazy)는 지도 자리가 빈 채 보여 깜빡임 원인 → 제거. ④ 초보자↔전문가(setMode user)도 같은 가림막 후 전환 · refreshAll/resize 는 550ms 뒤로.

- **V33.824** 폰 종목 상세 → 전문가 대시보드 렉(CPU4배 실측 최장 1.3~1.5s → 0.3~0.6s): ① 아래 탭 표시가 전환 중 getBoundingClientRect 로 재며 강제 배치 2~3회(각 160~190ms) → 탭 크기·아이콘 자리는 조용할 때 한 번 재어 CSS 변수(--tp-l/tw/x/y/w/h), 누르면 --tp-i 만 바꿔 CSS transform 전환(0.65s · cubic-bezier(.45,.05,.25,1) · 느리고 부드럽게, 튀는 스프링 제거). ② 지도 ResizeObserver 가 숨김(0×0) → 복귀를 크기 변화로 보고 SVG 2천여 개를 새로 만들던 것 → 0 크기 무시. ③ 축소 보기에서 화면상 4px 미만 지도 글씨는 안 만듦(_thr). ④ 들어오는 첫 그리기는 지도 content-visibility:hidden(lux-dzlazy) 후 다음 프레임. 시험: 숨긴 페이지 content-visibility:hidden 방식은 더 느려 되돌림.

- **V33.823** 폰 아래 탭 표시 렉: anime.js 는 메인 스레드에서 매 프레임 갱신 → 화면 전환(배치) 동안 멈췄다 튐. 탭 click 캡처에서 ★즉시★ 출발 + Web Animations(transform 만 · 합성기)로 이동 · 곡선은 anime spring 과 같은 감쇠 스프링+늘어남 키프레임 · 200/760ms 뒤 다시 재서 자리 맞춤(축소 보기 배율 변화). Threads: 11/10 22:57 부터 "API access blocked"(OAuthException 200) — 마지막 성공 11/9 17:12 UTC(그날 3시간에 9번 게시 · 8·9번은 같은 초 중복) → 메타 자동 제재 가능성 · 앱 대시보드 확인 필요(코드로 못 풂).

- **V33.822** 사이드바 화면 아래까지 꽉(높이 100vh-16 · 메뉴 칸 space-evenly · 버튼 최대 60/74px) + 남는 높이에 시장 시계(.lux-sbstat · 뉴욕/서울 시각·장 상태·LIVE — 맨 위 줄 글자를 5초마다 옮겨 적음 · 높이 760 이하면 숨김). 종목 상세: V33.821 의 시세 값 줄바꿈이 4~5줄로 늘어 차트 아래가 비던 것 → 한 줄 고정 + 긴 값은 두 칸 합침(detail-v3.js widen → .dv-w · grid dense) · 901~1366 글자 한 단계 줄임. 전문가 벤토(5:7)는 1381px 이상만(패드 가로에서 TOP MOVERS 등락 잘림·지도 눌림).

- **V33.821** ① 폰 전문가 대시보드에 사이드바가 보이던 것: V33.820 사이드바 규칙(min-width:761)이 폰 축소 보기(lux-dz · 폭 1000~1180)에도 걸렸다 → 전부 `html:not(.lux-dz)` 로 한정. ② 사이드바 높이는 내용만큼(빈 공간 제거) · 패드(761~1179)는 폭 150. ③ 종목 상세 패드 세로 비율·잘림: 도구줄 줄바꿈 · 팩터 이름/증권사 요약/시세 값 줄바꿈. ④ 메뉴 전환 렉: luxDz 가 화면 바꿀 때 innerHeight 를 읽어 강제 배치(폰 CPU4배 646ms) → 미리 잰 `__luxVH` 사용 · 대시보드 복귀 시 목록/지도 재그리기는 전환 뒤로·지도 30초 캐시 · 대시보드 아래 묶음 content-visibility. ⑤ 폰 아래 탭 표시 이동을 anime.js(스프링 + 늘어남, 사이드바 알약과 같은 방식)로.

- **V33.820** 패드·PC 사이드바 다시(오리지널 별 로고 + LUX-INV + powered by Blauenacht · 폭 178 · 화면 높이 꽉 · 아래 도구 칸 `.lux-sbtools` = MAP · 한국어/EN · Light/Dark). lux-topbar.js 는 이제 디자인 시트 뒤에서 ★동기★ 실행(화면 드러나기 전에 상단 줄을 옮겨 카드 밀림 없음) · AUTO-TUNE 줄은 카드 묶음 아래로 · 상단 줄 한 줄 고정 · 지수 줄/시장폭 줄 자리 미리 잡기(로딩 중 카드 크기 변함 CLS 0.6 → 0.07). 폰 아래 탭 미끄럼 표시 `.lux-tpill`(화면 좌표 ÷ 탭바 배율 · CSS 전환). 종목 상세: 시세 데이터 등락 숫자 색 복구 · 숫자 뒤 빨강/초록 사각형 제거(상세 머리 등락 · TOP MOVERS 칸 워시) · 머리 줄이기(dv3-compact) 끔 = 맨 위로 올 때 튕김 제거 · 패드 가로/PC 2열에서 왼쪽은 정보탭→뉴스→재무 위로 붙여 쌓기(빈 공간 1100px → 0). 개발일지 12 제목·쉬운 말·링크 없음으로 다시.

- **V33.819** 전문가 대시보드 → 종목 상세 전환 렉(폰 CPU 4배 느리게 실측 298ms → 122ms): ① showPage(detail) 의 목록/머리 렌더를 다음 그리기 뒤로(rAF+setTimeout) ② 상세 목록 첫 표시 60 → 30개(더 보기 +30) ③ 상세 목록 카드 content-visibility:auto. Threads 개발일지 12(깃허브↔클라우드플레어 연결법) 글·이미지 `promo/threads/devlog-12.*` — 사용자가 직접 올림(11번도 직접 올림).

- **V33.818** 즐겨찾기 폐지 → 종목 상세 정렬 "관심"(이 기기에서 최근 연 종목 10개 · localStorage `lux-recent-v1` · 서버로 안 보냄). 원인: 즐겨찾기가 공용 `cfg.usFavorites/krFavorites` 한 곳에 저장돼 모든 방문자가 공유했고, 상태 폴링마다 서버 값으로 덮어써 취소가 안 됐다 → 화면은 cfg 를 안 읽고 `POST /api/favorites` 는 410. 첫 화면(소개 배너) 렉: 흐린 큰 원 애니메이션·칩/카드 backdrop·칩 무한 흔들기 끔 · 버튼 지연 등장 없앰 · 배너 뒤 사이트는 visibility:hidden. 전체 다크 색감을 소개 배너 그라데이션(청록·남보라·파랑 빛 · #0b0f17→#0a0d14) + 강조 청록→파랑으로(lux-glass2.css 끝).

- **V33.817** 폰 아래 메뉴 전환 찌그러짐 가림 · 폰 상단 LUX-INV 복구 · 링크 미리보기 메타 앞으로. 전문가 모드 폰은 대시보드만 보기 폭 1000~1180(luxDz) ↔ 다른 화면 device-width 로 바뀌어 한쪽으로 찌그러졌다 돌아왔다 → `__luxDzSw()` 가 폭 바꾸는 순간 `.content` 를 160ms 가렸다 보여 줌(폭 전환 자체는 PC 배치 때문에 유지). `#mTopSlim` 이 `.m-ab-mid` 대신 `.m-ab-sub` 만 숨김 → 로고 옆 LUX-INV 보임. og/twitter 메타를 `<head>` 맨 앞으로 + og:image:secure_url/type/alt · charset 도 맨 앞.

### [UI7] 글래시 V30 · 다크 테크 · 그레이니 배경 · 벤토 (에이전트 · 푸시 안 함 · _BUILD_VER 안 올림)
- 새 시트 public/lux-glass2.css(lux-navy.css 뒤 링크 1줄 · 되돌리기 = 링크 제거). 두꺼운 유리 카드(blur 는 지수 카드·사이드바 등 몇 곳만) · 파랑 #1f6bff→#3b82f6 활성 알약/주요 버튼 · 사이드바 로고 줄+파란 알약. 다크 배경 = 호수 그림 대신 CSS 남색 그라데이션 + html::after feTurbulence 곡물(고정 1개) · 라이트 = 청백 + 파란 물결 + 곡물.
- 벤토: #easyDash(≥761px 12칸/패드 6칸, 폰은 기존) · 전문가 .fv-deck(≥1101px 12칸) — display:contents + grid-column 만(JS 없음). 아이콘 사각형 스탯 카드는 DOM 변경이 필요해 안 함(타일 머리 파란 점으로 대체).
- 실측(Playwright 1440/820/393 · 라이트/다크 · 초보/전문 · 5화면): 가로 넘침 0 · 사이드바 글자 잘림 0 · 콘솔 오류 0 · HTML 215KB.
### [UI6] 종목 상세 아래쪽 촘촘히 · 가독성 · 스크롤 (에이전트 · 푸시 안 함 · _BUILD_VER 안 올림)
- 새 public/detail-v3d.css(lux-navy.css 뒤 링크): ≥901px 왼쪽=차트→AI 분석(2열 카드, 열린 칸은 전체폭) / 오른쪽=시세 데이터→패널→뉴스, 재무는 아래 전체폭 3열 · 패드 세로=AI 분석 2열·재무 2열 · 상세 안 backdrop-filter 전부 제거 · 스티키 머리·탭·제목줄 불투명(스크롤 글자 비침 수정) · 흐린 글자(opacity) 제거 · 하한 13px.
- 스크롤 렉: index.html 의 --dtop fit()(스크롤마다 getBoundingClientRect 강제 레이아웃, 4x 스로틀 프로파일 246ms)을 ≥761px 에서 스크롤 땐 안 돌리고 폰은 120ms 1번 · detail-v3.js onScroll 은 위치방식/top 값 캐시. 데스크톱 fps 는 헤드리스 소프트 렌더라 차이 작음(57→57), 폰 janky 프레임 5~12→1.
- 총 스크롤 높이 NVDA 전→후: 데스크톱 3825→2962 · 패드 세로 5532→5173 · 패드 가로 4056→3158 · 폰 3713→3346. 최소 대비 다크 5.5 · 라이트 4.7(국장 목록 '시각미상' 3.2 는 목록 칸, 미수정).
- 통합자: detail-v3d.css ?v= 는 판 올릴 때 같이. index.html 은 220000 바이트 한도 코앞(220,0xx 아님: 통과)이라 인라인 늘리지 말 것.

### [PERF] 전문가 대시보드 지수 카드·TOP MOVERS 첫 화면 단축 (에이전트 · 푸시 안 함 · _BUILD_VER 안 올림)
- 원인: 둘 다 pub/state.js(800KB · br 237KB · 시세 1,004종목)가 와서 파싱돼야 그려졌다(서버 응답은 빠름 · CDN HIT). 실측(Playwright, 1440x900): 빠른 망 콜드 1.4s·웜 0.7s(저장 사본) / 1.6Mbps·150ms 에서 2.8~3.6s.
- 수정: 크론 statePubWrite 가 같은 본문에서 지수 + 시장별 상·하위 후보(정규·시간외 각 20 · 93종목 · 28KB)만 뽑아 R2 `pub/f/dash_top.js` 에 1분마다 씀(R2 쓰기 +1/분 · 방문자 수와 무관). index.html 머리에서 `__earlyTop` 로 /api/state 와 동시에 받아, 전체 상태보다 먼저 오면 renderFvDeck({__partial:1}) 로 지수·TOP MOVERS 만 그림(시장폭·타이머·헤드라인은 전체 상태가 오면). 저장 사본이 그렸거나 전체 상태가 먼저면 무시. 전체 상태 도착 뒤 목록은 동일함을 확인.
- 실측(소스 HTML + 가짜 dash_top, 수정 전→후): 빠른 망 0.78~1.34s → 0.47~0.52s · 느린 망 2.8~3.6s → 1.3~1.5s. 라이브 확인은 배포 뒤 `window.__fvTopAt` 로(없으면 dash_top.js 미생성/CDN 실패).

### V33.816 — 소개 문구 신뢰형으로("AI가 분석을 돕는 모의투자") · og-card3.png

### V33.815 — 스모크 글라스(다크 카드 중성 회흑 반투명) · 링크 미리보기 배너 새로(og-card2.png · 큰 글씨 + 실제 화면 2장) · Threads 개발일지 11

### V33.814 — 종목 상세 기간 버튼·정보 탭: 떠다니는 알약 대신 선택 버튼 자체를 파랗게(흰 글자 안 보이던 것)

### V33.813 — 폰 아래 탭: 떠다니는 알약 제거 → 활성 아이콘 자체를 파랗게(아이폰 위치 오류) · 폰 화면 전환 애니 끔 · 페이지 관찰 범위 축소 · 배경 거의 검정

### V33.812 — 사이드바 = 로고 + 메뉴(+초보/전문 전환)만 · 엔진·장 상태·자동 운용·도구 버튼은 대시보드 맨 위 줄(lux-topbar.js 가 요소를 옮김 · id 그대로)

### V33.811 — 리퀴드 글래스 V30 · 벤토 대시보드 · 다크테크 그레이니 배경(lux-glass2.css) · TOP MOVERS 높이 0 버그 수정 · 종목 상세 스크롤 렉(--dtop fit 강제 레이아웃 제거) · 아래쪽 재배치(detail-v3d.css · 스크롤 높이 PC 3825→2962) · 대비 4.7:1 이상

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
- ★(사용자 11/26) Threads 는 이제 '오늘의 주식 이슈' 매일 1개 · ★전문 뉴스 기사체(~했다·리드+번호 항목+출처 · 형식 예시 promo/threads/issue-example.txt) · 맨 끝 줄에 https://lux-inv.com/?r=iYYMMDD★(19:37 KST 예약 작업 · 종전 2일마다 개발일지 대체 · 사용자가 그만하라고 할 때까지)★: 빅테크 AI/사업 소식 · FOMC/연준 · 유명 기업 상장 중 하나를 골라 ★반드시 비용과 연결★(AI 투자액·전기료·금리→빚·밸류에이션·공모가·구독료 등). 1차 자료나 주요 언론 2곳 이상으로 숫자 확인 · 매수/매도 추천·목표가·수익 보장 금지. 원문 promo/threads/issue-YYYYMMDD.txt · 카드 share.json "iYYMMDD"(?r=iYYMMDD) · topic 주식.
- ★말투 규칙(사용자 11/25 "광고글처럼 쓰지 마 · 거부감 없게") — 아래 '어그로 첫 줄'·'글 끝 문구' 규칙보다 우선★: 친구한테 경험 털어놓듯 · 실패·삽질·몰랐던 것 위주 · 정보가 주인공, 사이트 자랑 안 함. 금지: 직접 눌러봐·가입·지금 바로·꼭·무조건·손해 보는 중 같은 압박/낚시 문구, 본문에서 사이트 이름·주소 부르기, 과장. 첫 줄은 실제 있었던 일이나 숫자. 끝은 홍보 대신 짧은 소감·질문. 주소는 본문에 안 쓰고 링크 카드(?r=tNN)로만.
- ★조회수 규칙(사용자 11/25 · 14일 유입 t15~t19 글당 방문 2~10 · 가입 0)★: 매 글을 ① 돈(원 단위 실제 금액 — 월 서버비·AI 구독료·아낀 돈 · 확인된 수치만 · 달러는 원 환산) 또는 ② 일반인도 따라 하는 바이브코딩(코딩 몰라도 AI한테 말로 시켜 만드는 단계 · 실제로 한 지시 문장 예시 · 막힌 순간과 푼 법) 중 하나 이상에 엮는다. 개발 용어는 쉬운 말로. 첫 줄은 금액 숫자나 '코딩 몰라도' 류 + 궁금증. 보고 때 /api/ref-stats 를 주제 유형별로 비교.
- 글은 항상 살짝 어그로성 첫 줄(유인 멘트)을 넣는다. 2일에 1개 비용(AI·사이트) 관련 글을 자동 게시(예약 작업 · 사용자 지시 2026-11-09). 사실만 쓴다.
- 글 끝 문구는 글 종류별(사용자 11/9 승인): ① 개발·AI 팁·비용 → "이걸로 만든 사이트 직접 눌러봐 (가입 없이 구경 가능)" + https://lux-inv.com/?r=tNN (설정 공개 페이지 lux-inv.com/dev 도 가끔) ② AI 성적·실패담 → "AI 지금 뭐 사는지 실시간으로 보임" + https://lux-inv.com/?r=tNN ③ 광고 → "고딩이 만든 AI 모의주식 사이트 회원가입해서 수익률 경쟁해봐요" + https://lux-inv.com/?r=tNN. NN=글 번호. 유입은 /api/ref-stats(14일 · 방문 v · 가입 s). 이미지·영상 첨부 글은 게시 전 사용자 확인.
- ★(V33.853 · 사용자 11/17) 다음 글부터 '링크 카드' 방식★: 스레드는 사진에 링크를 못 건다 → kind LINK(글 + link_attachment). media_url = https://lux-inv.com/p/<이름>.
  공유 주소 = public/promo/share.json 한 줄 {title, desc, img(가로 1200x630 권장), w, h, to:"/?r=tNN"} → 워커가 og 태그 + 바로 이동. 새 그림을 쓰면 게시 전 사용자 확인, 그림 없으면 img "/og-card3.png".
  ★글은 500자 이하★(Threads API 'Param text must be at most 500 characters' — 11/17 devlog-16 첫 시도 실패). 게시 전 python3 로 len 확인.
  글 끝 주소 줄은 그대로 두되 카드가 같은 곳(?r=tNN)으로 간다. 게시 전 `curl -A facebookexternalhit/1.1 https://lux-inv.com/p/<이름>` 로 og:image 확인.
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
