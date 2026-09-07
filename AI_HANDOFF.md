# AI 작업 인계 상태

> 이 문서는 Claude Code와 Codex가 토큰 소진·세션 중단 후에도 커밋 경계에서 안전하게 이어가기 위한 체크포인트다.

## Current handoff

- Status: complete locally; deployment must be checked against this exact HEAD after push.
- Owner: Claude
- Branch: main (direct main authorized; no PR)
- Last commit: HEAD / V33.316 (resolve with git log -1)
- Base: V33.315 (Codex, pulled via fast-forward `git pull --ff-only origin main`), deployment verified live.
- Scope: 사용자가 "코덱스로 고친 AI 두뇌가 물빠진색"이라 지적 — brain-console.css 의 의도적
  `filter:grayscale(1)` + 무채색 토큰을 되돌려 채도 있는 미션컨트롤 팔레트로 복원. 동시에
  "다른 퀀트 AI 처럼 스캔중인 종목을 순차적으로 차트+확률로 보여주고 탈락이면 탈락이라 표시,
  AI 반사실 후보도 보여달라"는 요청에 맞춰 두 개의 새 패널(AI 스캔 순회 필름스트립, AI 반사실
  후보 목록)을 추가. 마지막으로 "지표환율/뉴스 통합이 제대로 안 된 것 같다"는 지적을
  코드로 확인해 NEWS 내비게이션 중복 항목을 제거(진짜 원인은 통합 로직이 아니라 `showPage()`가
  `news`→`macro` 로 id 를 바꿔치기 하면서 내비 하이라이트가 어긋난 것이었음).

### Claude V33.316 — 2026-09-07

- **색 복원** (`public/brain-console.css`): 두 곳의 `filter:grayscale(1)` 을 제거하고, 다크/라이트
  토큰을 시안(`#3ecbff`)/그린(`#33e6a8`)/앰버(`#ffbe3d`)/레드(`#ff5c74`)/퍼플(`#a78bff`) 기반의
  채도 있는 팔레트로 재정의. `.nnv-health-source.ok/.error`, `.nlv-cm .cm-dot` 상태색, `.nlv-line
  .buy/.warn em`, `.nnv-tab.active` 를 잉크 반전 대신 시안 강조로 교체.
- **AI 스캔 순회** (`#nlvScanWrap`/`#nlvScanRail`): `/api/ai-picks` 의 전체 유니버스 스캔 배열을
  가로 필름스트립으로 순차 하이라이트(2.2초 간격, hover/reduced-motion 시 정지)하며 종목별
  미니 차트(`pickChart`)와 랭크 점수, `abstain`/랭크 임계값 기반 통과·관찰·탈락 스탬프를 표시.
  `rankP` 는 위원회 순위 점수이지 보정된 확률이 아니므로 "확률" 대신 "랭크"로 표기(Codex
  V33.314 의 구분을 그대로 따름).
- **AI 반사실 후보** (`#nlvCfWrap`): 신규 읽기 전용 엔드포인트 `/api/cf-candidates` (`src/index.js`)
  가 `ml_candidates` 테이블에서 아직 라벨링 안 된 표본 최근 16건 + 대기 총건수를 반환(30초/1시간
  SWR 캐시, feat 벡터는 응답에 포함하지 않음). 프런트는 종목·전략·진입가·경과시간을 카드로 표시.
- **NEWS 내비 중복 제거**: 데스크톱 `data-page="news"` 항목에 `report`/`whatif` 와 동일한 방식으로
  `display:none`, 모바일 `NAVS` 배열에서 `news` 항목 삭제. `지표&환율` 탭이 이미 뉴스를 흡수하고
  있어 두 항목이 공존하면 `showPage()`의 id 치환 때문에 NEWS 클릭 시 하이라이트가 어긋났음.
- **레이아웃**: `.nlv-scanwrap` 이 `#nnvLive` 의 2번째 자식으로 추가되며 컴팩트(768px+/650px+)
  operations 그리드의 3-트랙 가정이 깨졌던 것을 `grid-template-rows`에 트랙을 하나 추가해 수정,
  `.nnviz-content`의 `overflow:hidden`→`overflow-y:auto` 로 방어.
- 검증: `node --check src/index.js` 통과, 86종 게이트 전체 통과, 헤드리스 크로미움(CDP)으로
  1600×1000/800×700 스크린샷 확인 — `.rail` computed `filter:none`(그레이스케일 해제 확인),
  스캔/반사실 패널 DOM 존재·display 정상, 컴팩트 그리드 레이아웃 깨짐 없음. 실 백엔드가 없는
  로컬 정적 서버라 `/api/ai-picks`/`/api/cf-candidates` 응답은 404 로 처리되었고(정상적인 에러
  UI 로 표시됨), 실 데이터가 있는 프로덕션에서 카드 렌더링을 재확인할 필요는 남아 있음.
- 학습·주문 트리거 없음, `AI_PARAMS.requireTrustedModel`/`EXTERNAL_LLM_DISABLED`/
  `EXTERNAL_AI_API_DISABLED` 등 정책 값 변경 없음, 시크릿 없음.
- Push 후 GitHub Actions 배포 확인 필요 — 정확한 실행 run 과 실서비스 `lux-build`/`/api/selfcheck`
  의 `build` 필드가 V33.316 인지 확인할 것 (`tools/*` 워크플로 프로브 사용, 직접 HTTPS 불가 환경).

## Previous handoff — V33.315

- Owner: Codex
- Last commit: V33.315 (resolve with `git log`)
- Base: 4da5c84 / V33.314; its deployment run 34146231149 succeeded and live version was verified.
- Scope: compact brain workspace, rebuilt responsive model topology, unified indicators/FX/news.

### Codex V33.315 — 2026-09-08

- Added page-scoped workspace-layout.css and UI-only workspace-ui.js. Operations, models and research
  views retain existing DOM/actions and all 14 model tabs. Workstation operation view fits viewport;
  dense panel contents may scroll internally. Mobile uses a natural vertical flow.
- Replaced the fixed-width overview SVG with keyboard-operable model cards, actual dimensions/slots,
  server roster states and correct provisional STACK blending. Original model evidence remains in details.
- Removed brain-theme overrides affecting the left sidebar/global theme tokens. Other page designs untouched.
- Moved existing news controls into the macro page; original news and FX routes alias the integrated view.
  Added view and sector filters, preserving refresh controls, tables and source links.
- Fixed FX polling checking a nonexistent page-fx, avoided duplicate initial macro/FX refreshes,
  added active-page news refresh, and retained last good data with an error stamp on request failure.
- Restricted external news links to HTTP(S), added noopener/noreferrer, escaped fallback publication text.
- Added production-function regression cases to the existing wired check-ai-ops-ui.mjs.
- All 86 tools/check-*.mjs passed (Node 24, PYTHONUTF8=1); worker syntax and git diff --check passed.
- Browser: 390x844, 768x1024, 1024x768, 1440x900 without horizontal document overflow.
  Workstation operation container bottom stays inside viewport; DNN graph navigation and TECH filter tested.
  Read-only preview proxies selected live APIs; unrelated API 503 toasts in preview are intentional.
- No training/orders triggered, predictive-accuracy claim, policy change, bindings/cron change or secrets saved.
- Push auto-deploys through GitHub Actions; verify exact commit run and live lux-build V33.315,
  workspace-layout.css and workspace-ui.js. Actual live host is ai-trader-app.blauenacht08.workers.dev.
- Earlier trainer/data-history limitations below remain open. Comments tagged Codex identify changed code.

## Previous handoff — V33.314

- Status: complete (implementation and local validation; verify the deployment run for this commit)
- Owner: Codex
- Branch: `main` — user explicitly requested direct main work, no PR.
- Last commit: HEAD (V33.314; resolve with `git log -1 --oneline`)
- Base: `6c87c2a` / V33.313, fresh clone and `git fetch origin main` reconfirmed before commit.
- Scope: V33.314 — monochrome AI brain redesign, model loading recovery, truthful UI and portable validation.

### Codex changes — 2026-09-08

- `public/brain-console.css`: dedicated page-scoped black/white design, large mission header, section navigation,
  inverse decision panel, responsive summary and content grids, square model controls, readable committee tiles,
  restored model roles/weights, explicit connection status symbols, light theme and reduced-motion support.
  Existing renderer surfaces use grayscale to remove hard-coded blue from SVG/canvas without rewriting
  numerical renderers. Other pages retain their theme. Existing legacy CSS remains as the compatibility base;
  the versioned stylesheet is the final authority for the brain page.
- Preserved 14 model tabs, training/GitHub/refresh actions, candidate charts, log pause, pipeline folding,
  model visualizers, and sidebar asset/budget/open-symbol functions. Header actions now remain visible on mobile.
- `rankedLivePicks`: summary and main chart select the same highest-rank non-abstaining candidate without
  mutating server data. All-abstaining scans no longer invent a top candidate. `rankP` is a rank score, not a
  calibrated probability: display it as a decimal with an explicit label, separately from the chart's `p`.
- Committee summary now understands actual `buildRoster` states `on`/`prov` (old `live`/`provisional`
  comparison always counted zero), and still updates when no candidate is available.
- Chart request sequence guards cover late success, empty responses, errors, cached switches and cleared
  candidates. A previous request can no longer erase a newer chart. Non-2xx responses display an error.
- `getState` gained opt-in strict reads; legacy callers retain their fallback behavior. Large model metadata
  failures now record `meta_read_error`, D1 chunk failures `chunk_read_error`, and invalid chunk counts are
  rejected before allocation. Valid raw reads clear stale health errors; JSON corruption remains distinguished.
- SEQ trust/model I/O failures no longer cache null for five minutes. Next request can recover; successful
  loads and explicitly untrusted models retain caching, and no stale model is used to bypass admission.
- Regression cases were added to the already-wired `check-ai-ops-ui.mjs` and `check-big-load-health.mjs`.
  No CI gate was removed and no workflow wiring changed.
- `.gitattributes` standardizes source LF for Windows/CI source-extraction checks, excludes the legacy UTF-16
  `src/index 50.js` backup. `check-syntax.mjs` uses esbuild's API (no Windows `npx.cmd` or `/dev/null` issue).
  Python verification uses native paths and explicit UTF-8 for the affected fixtures. Ignore local node_modules.
- Implementation comments carry `[Codex V33.314]`; no credentials are saved in tracked files or git remotes.

### Verification and deployment

- All 86 `tools/check-*.mjs` gates passed locally with Node 24, Python 3.11 (`PYTHONUTF8=1`), esbuild 0.28.1;
  `node --check src/index.js` also passed. CI repeats its configured checks on Node 22.
- Reproduced storage failures/recovery, SEQ negative-cache recovery, rank selection, roster states, and chart
  races using the production functions. Existing SEQ inference, MEMO cross-language, holdout, model evidence,
  accounting and risk-policy contracts remain in the full suite.
- Chromium preview: 1440px desktop and 390px mobile, no horizontal document overflow, 14 model controls
  retained. Read-only production API preview verified matching summary/chart symbol, on/prov counts,
  MEMO structure render and pipeline folding. Also exercised connection-failure UI and light theme.
- Main push triggers `Deploy to Cloudflare Workers`. Check the run associated with this exact commit before
  assuming production is current; the live HTML meta `lux-build` and worker build should both be V33.314.
- No retraining or order was triggered during verification. No claim of increased predictive accuracy.
- No changes to `wrangler.toml`, D1/R2 bindings, cron, model upload paths, external-AI policy, or
  `AI_PARAMS.requireTrustedModel` (remains user-authorized `false`).
- Earlier data-history limitations and external-trainer holdout-calendar work described below remain open;
  this change fixes proven code defects, not statistical evidence that has not yet accumulated.

## Previous handoff — V33.313 (historical context)

- Status: complete
- Owner: Claude Code
- Branch: `main` (직접 작업 — 2026-09-07 사용자 지시 "항상 main에 작업")
- Last commit: HEAD (this change; verify with `git log -1 --oneline`)
- Scope: V33.313 — 작동 화면과 구조 관측을 한 창으로 합쳤다(사용자 지시: "아직도 기존의
  모습이 많이 보여서 수정하고 작동화면과 구조 관측을 합쳐줘 창을 완전히 새롭게 디자인해줘
  오른쪽 사이드바 필요하면 없애도 됨"). V33.312 는 작동 화면(.nlv-*)만 새로 그렸는데,
  구조 관측(#nnvStruct — DNN·트리·선형·MEMO·SEQ 렌더러)은 손 안 대서 여전히 옛 "Apple
  재질" 파랑 톤이었다 — 전환 모드일 땐 안 보이니 몰랐는데 이제 그게 사용자가 본 "옛 모습"
  이었다.
- Base: `main`(V33.310). V33.305~309 는 여전히 `codex/find-issues-with-embedded-ai-models`
  브랜치에만 있다 — 병합하지 않고 필요한 부분만 옮겨 왔다(아래 "가져온 것" 참고). 그 브랜치를
  그대로 rebase/merge 하지 않는다 — V33.306·307·308·310 이 없는 바닥이라 게이트가 80종뿐이고,
  얹으면 `check-stale-base.mjs` 가 막는다.

### V33.305~309 에서 가져온 것 / 가져오지 않은 것

- **가져옴**: `AGENTS.md`(도구 공통 규약), `CLAUDE.md`의 인계 순서 문구,
  `tools/check-big-load-health.mjs`(대형모델 로딩 실패를 '미학습'과 구분 — `_bigLoadMark`/
  `_bigLoadStatus`, `/api/r2-status`·`/api/scalp-status` 응답에 `bigLoads` 필드),
  `tools/check-ai-ops-ui.mjs`와 그 배선(연결 텔레메트리·NOW 브리핑·HTTP 오류 가시화 —
  `liveHealth`/`liveFetchJSON`/`renderOpsBrief`, `loadPicks`의 `r.ok` 확인).
- **가져오되 값은 바꿈**: `tools/check-ai-handoff.mjs` — 원본은 `requireTrustedModel:true` 를
  강제했다. 그 값은 2026-07-22 사용자 지시로 `false` 로 완화된 실매매 리스크 정책이라
  2026-09-07 재확인(사용자: "false 유지") 후 강제 조건을 뺐다. 대신 그 값 옆에 날짜 있는
  근거 주석이 있는지만 본다 — 조용한 값 뒤집기 자체를 막는다.
- **가져오지 않음**: `src/index.js`의 `requireTrustedModel: true` 자체(위 이유로 `false` 유지),
  `tools/check-model-evidence.mjs`의 `requireTrustedModel:true` 단정 추가분.

### AI 작동 관제실 재설계 (미션컨트롤 방향 — 사용자 요청 "완전히 새롭고 세련되게 spacex 느낌")

- 이 화면(`.nlv-*`)은 이미 짙은 남색(#060910~#090e1a) + 시안 발광(#38bdf8) + IBM Plex Mono
  계기 숫자로 그려져 있었다 — 그 색·글꼴을 그대로 물려받아 완성했다(전면 교체가 아니라
  기존 언어를 끝까지 미는 방향 — 이미 있던 걸 갈아엎는 게 더 위험하고 저렴했다).
- 헤더: eyebrow 라벨("LUX INTELLIGENCE · OPERATIONS/STRUCTURE")·제목·부제가 작동/구조
  화면 전환에 맞춰 텍스트를 바꾼다(`setBrainView`).
- 연결 텔레메트리 바(`#nnvHealthbar`) — PICKS/COMMITTEE/PIPELINE 세 소스를 독립 상태로,
  LED 점 + 몬 라벨. NOW/DECISION 브리핑(`.ops-brief`) — 판정·최상위 신호·위원회·스캔
  최신성을 코너 브래킷 카드로. 둘 다 작동 화면에서만 보이고 구조 관측에선 숨는다.
  격자 대기층(`.nnviz-content::after`)은 아래로 갈수록 옅어져 내용을 가리지 않는다.
  `prefers-reduced-motion` 대응 포함. 좁은 화면 전용 `@media` 는 두지 않았다
  (`check-mobile.mjs` 가 "폰 블록 뒤 좁은폭 규칙 금지"를 강제 — grid auto-fit로 대신 해결).
- 헤드리스 Chromium(CDP)으로 실제 렌더를 두 화면 다 확인했다: 라이브 뷰(연결 오류 상태 —
  백엔드 없는 오프라인 시험 환경이라 의도된 것)와 구조 뷰(제목·부제 전환, 코너 브래킷)
  모두 정상.

### V33.313 추가분 — 작동 화면 · 구조 관측을 한 창으로

- **왜 옛 모습이 남아 보였나**: V33.312 는 `.nlv-*`(작동 화면)만 새로 그렸다. 구조 관측
  (`#nnvStruct`)은 `--ap-tint`(파랑 #4a9eff) + 유리질감 블러 — "Apple 재질" 토큰 체계로
  그려져 있었다. 종전엔 BVIEW 로 둘을 전환해서 한쪽이 항상 안 보였으니 몰랐는데, 합치고
  보니 한 화면 안에 ★서로 다른 브랜드의 UI 둘★ 이 붙어 있는 게 드러났다.
- **합침**: `BVIEW` 전환을 없앴다. `#nnvLive`·`#nnvStruct` 를 늘 함께 보인다.
  `setBrainView()` 는 이제 인자 없이 부팅 1회만 불려 작동·구조 데이터를 같이 로드한다.
  `openNnViz()` 를 "구조 관측 모드일 때만" 통과시키던 게이트(`__luxViewGated` 래퍼)를
  없애고, 대신 헤더 새로고침이 둘 다 새로고침하도록 바꿨다(`__luxRefreshesBoth`).
  사이드바·모바일 바의 "작동 화면/구조 관측" 전환 버튼과 사이드바의 "지금 보는 모델"
  중복 목록(`railModelsSec`)을 없앴다 — 모델 선택은 화면 안 신경망 지도(`#nnvTabs`)
  하나로, 늘 보이니 전환할 이유가 없다.
- **재테마 — 규칙을 다시 쓰지 않고 토큰 값만 바꿨다**: 구조 관측 쪽 수백 개 규칙이 이미
  읽고 있던 공용 토큰(`--ap-tint`·`--ap-mat-*`·`--ap-hair`·`--ap-ink` 등)의 값을
  미션컨트롤 팔레트로 재정의했다 — 렌더러 로직은 한 줄도 안 건드리고 색만 바뀐다.
  사이드바(`.rail`)는 `#page-nnviz` 의 형제 요소라 그 토큰을 못 읽으므로, `.rail` 이
  실제로 쓰는 전역 토큰(`--s1`·`--s2`·`--bd`·`--t1~3`·`--acc`)을 `body:has(#page-nnviz.active)
  .rail{...}` 스코프 안에서만 다시 정의했다 — 대시보드 등 다른 화면은 전혀 안 바뀐다.
- **오른쪽 사이드바**: 완전히 없애지 않았다 — 열린 종목창·ALT ASSETS·BUDGET ALLOCATION 은
  대시보드에서 옮겨온 실데이터라, 지우면 그 화면 두 곳에서 조용히 사라진다. 대신 뜻을
  잃은 부분(뷰 전환 버튼·모델 중복 목록)만 걷어내고 나머지는 같은 팔레트로 재테마했다 —
  사용자가 "필요하면"(조건부)이라 했고, 데이터 손실 없이 "완전히 새롭게"를 더 안전하게
  만족하는 쪽을 골랐다.
- `tools/check-html-js.mjs` 의 V33.153 검사("모델 목록은 구조 관측 뷰에서만 보인다")는
  전제 자체가 사라져 업데이트했다 — 이제 `railModelsSec`·`#railViews` 가 ★없어야★ 통과한다.
- 헤드리스 Chromium(CDP)으로 데스크톱·모바일 두 폭에서 실제 렌더를 확인했다 — 구조 관측
  탭이 작동 화면과 같은 시안 톤으로 통일됐고, 사이드바도 같은 팔레트를 쓴다.

### V33.312 추가분 — AI 작동 관제실 전면 재설계

- 사용자 지시: "지금 화면 완전히 폐기하고 spacex 스타일로 전체 디자인 다시해." V33.311 은
  헤더·텔레메트리·NOW 브리핑만 새로 얹고 기존 `.nlv-*` 배색을 물려받아, 사용자 눈엔
  "장식만 추가된 옛 화면"이었다.
- ★안전 경계★ 실거래 화면이라 DOM 은 지우지 않았다 — id·class 는 그대로 두어
  렌더 함수(renderCore·renderFunnel·renderCommittee·renderKpi·renderPicksGraph 등)는
  손대지 않았다. "폐기"는 캐스케이드 마지막 위치(`</body>` 직전 `<style>`)에서 이 화면에
  걸리는 시각 규칙 전부를 다시 정의해, 위쪽 12000~13900행대의 옛 규칙이 눈에 보이는 효과를
  하나도 못 내게 만드는 방식으로 했다.
- 새로 그린 것: 배경(성근 별 + 공학 격자 + 수평선 발광, 이미지 없이 CSS 만), 헤더·텔레메트리·
  브리핑(코너 브래킷 카드), 히어로(최우선 후보·판정 깔때기 — 전 패널 4모서리 브래킷),
  위원회 구성(승무원 상태 타일 그리드로 재편), 엔진 판정 로그(터미널 스타일), 엔진 파이프라인
  (LED 시스템 체크리스트), AI 후보 종목 그리드. 색·글꼴 토큰(`--ops-*`)을 `#page-nnviz` 에
  선언해 전부 한 곳에서 통제한다.
- `tools/check-html-js.mjs` 가 실측으로 잡은 것: 위원회 카드에 리터럴 hex 색 1건
  (`.nlv-cm.prov .cs{color:#7fc4f0}`) — "재질 토큰으로만 칠해야 라이트 테마가 따로 안
  필요하다"는 기존 계약을 어겼다. 토큰(`--ops-cyan-soft`)으로 바꾸고, 라이트 전용
  `.nlv-cm` 덧칠도 제거해 토큰 재정의만으로 따라오게 고쳤다.
- 헤드리스 Chromium(CDP)으로 다크·라이트·구조 관측 세 상태를 실제로 렌더해 확인했다.
  라이트 테마에서 스크린샷이 계속 다크로 나오는 문제를 만났는데, `getComputedStyle` 로는
  매번 올바른 값(`rgba(255,255,255,.88)` 등)이 잡혀 코드가 아니라 ★헤드리스 SwiftShader
  소프트웨어 합성의 리페인트 무효화 버그★ 로 판단했다 — DOM 에 진단 배지 하나를 추가해
  강제로 리플로우를 일으키자 그 즉시 올바른 라이트 화면이 그려졌다(실사용 브라우저는
  속성 변경만으로 정상 리페인트한다). 원인이 우리 CSS가 아니라 테스트 도구 쪽임을 확인한
  뒤 방어적으로 넣었던 `isolation:isolate` 만 제거했다(용도가 불분명했던 선언이라 제거 자체가
  안전하다).

## Completed

- V33.301 위원 명부(buildRoster) 단일출처 — 사이드바·구조 관측·신경망 지도가 같은 배열을 읽는다.
- V33.302 tools/probe-pick.py — 워커 응답에서 키 이름으로 필드를 뽑는 진단 도구.
- V33.303 MEMO 홀드아웃을 달력(60일 = minBlocks 5 × 라벨지평 10일 + 여유)에 고정, 학습은
  엠바고 이전만. 전진표본 0의 이유(고를 행 없음/배치하한/라벨/NaN)를 구분해 기록.
- V33.304 평가 루프 FLOW 비용 — 피어 로그수익 사이클 캐시(WeakMap) + flowpos/flowopt를
  사이클당 질의 1회로 프리로드(D1 왕복 248회 → 1회). 값은 옛 구현과 비트 단위로 동일.
- V33.306 MEMO 외부학습 — trainer/modal/modal_train.py 에 `_memo_fit`/`_memo_score`/
  `_train_and_upload_memo` 추가, 워커에 `POST /api/memo-import` 추가.
  · 승격 조건: 판(luxFeatVer) 일치 + 형상 검사 + ★정합 probe★(트레이너 확률을 워커
    memoScore 가 재현) + 신뢰 판정은 워커 expertAdmit 이 한다.
  · 유효표본수는 `_importedValN`(고유도 보정)으로 받는다 — 외부 모델만 관대한 자로
    심사받지 않게 한다.
  · `memoTrainNightly` 는 그대로 남아 있고, 외부 모델이 30시간 이내로 신선할 때만 적합을
    건너뛴다. ★전진검증은 건너뛰기보다 앞에서 항상 돈다.★

### V33.310 추가분

- ★뒤진 바닥 사고.★ 다른 도구(Codex)가 `codex/find-issues-with-embedded-ai-models`
  (V33.305, V33.304 에서 분기) 위에서 V33.309 를 만들었다. 그 바닥엔 V33.306·307·308 이
  통째로 없다 — 게이트가 80종이고 지금 main 은 82종이다.
- ★왜 위험한가:★ 게이트는 deploy.yml 에 손으로 배선된다. 뒤진 deploy.yml 이 얹히면
  새 게이트가 목록에서 사라지는데, 그 사라짐을 알아챌 사람이 바로 사라진 그 게이트다.
  파일은 저장소에 남아 있어 `ls tools/` 로도 티가 안 난다.
- `tools/check-stale-base.mjs` — ① `tools/check-*.mjs` 전부가 deploy.yml 에 배선돼 있는가
  (반대로 없는 파일을 부르지 않는가도 함께 본다) ② `_BUILD_VER` 가 직전 커밋보다
  뒤로 가지 않았는가. 워크플로 체크아웃을 `fetch-depth: 2` 로 올려 ②가 CI 에서 실제로 돈다.
- CLAUDE.md 에 "작업 시작 전 최신 `main` 을 바닥으로 삼는다" 를 도구 공통 규칙으로 적었다.

#### 아직 사용자 판단이 필요한 것

- `AI_PARAMS.requireTrustedModel` — main 은 `false`(2026-07-22 사용자 지시로 완화),
  V33.305 브랜치는 `true`. 매수 여부를 가르는 운용 정책이라 임의로 바꾸지 않았다.
- V33.305 의 `AGENTS.md` · `tools/check-ai-handoff.mjs` 는 아직 main 에 없다.
  가져올 때 그 안의 CLAUDE.md 문구("main 에서 직접 편집하지 않는다")는
  2026-09-07 지시("항상 main 에 작업")와 충돌하므로 그대로 옮기면 안 된다.

### V33.308 추가분

- ★두뇌 관측에서 탭을 옮기면 다른 모델 그림이 나왔다(주로 DNN).★ 원인이 셋이었다:
  · openNnViz 를 부르는 자리가 다섯(탭 클릭 · 화면 전환 · showPage · resize · 새로고침)인데
    ★도착 순서대로 무조건 그렸다★. 제일 무거운 DNN 응답(21MB 청크)이 뒤늦게 와서 덮었다.
  · `NNV_render` 분기가 kind 를 보다가 아무 데도 안 걸리면 ★말없이 DNN 렌더러로 떨어졌다★.
    `mlDNNVizData` 만 kind 를 안 달고 있어서, 늦은 응답·옛 캐시·모르는 모델키 셋이 전부
    "DNN" 이라는 한 증상으로 나왔다.
  · `NNV.curKey` 를 응답이 온 뒤에 바꿔서, 캐시로 먼저 그린 첫 화면이 ★이전 모델의 합류
    상태★ 를 이름표로 달았다(V33.306 이후).
- 고침: 응답에 `reqModel`·`kind`(DNN 포함 전 경로) 를 새기고, 화면은 보낸 순서(`NNV.seq`)를
  세어 최신 요청의 응답만 그린다. 모델이 어긋나면 `NNV_render` 가 `false` 를 돌려주고
  아무것도 안 그린다 — 캐시에도 안 남긴다. `curKey` 는 요청을 보내는 순간 맞춘다.
- `tools/check-nnviz-switch.mjs` — 가짜 DOM·가짜 fetch 로 그 경합을 ★실제로 재현해★ 본다
  (느린 DNN → 빠른 MEMO). 변이(순서 표 제거 / kind 확인 제거)를 넣으면 실패한다.
  탭 목록 14개 키가 전부 서버 분기에 있는지도 본다 — 모르는 키는 기본값 DNN 으로 샌다.

### V33.307 추가분

- 야간 파이프라인 `_stg` 가 단계별 소요시간을 잰다. 느린 단계(≥500ms)만 `ai_stage_cost` 에
  ★오늘 기록과 합쳐★ 즉시 쓴다 — 파이프라인이 중간에 죽어도 남는다(그게 제일 보고 싶은
  경우다). 완주 시 `[STAGE-COST]` 한 줄, `/api/ai-mode` 의 `alt.stageCost` 로도 읽는다.
  → 다음 Modal 이관 대상은 이 표를 하룻밤 받아 보고 고른다. 추측으로 고르지 않는다.
- `deploy.yml` 이 `pull_request` 에서도 검사 80종을 돌린다. ★배포 성격 단계 5개는
  `github.event_name == 'push'` 로 막았다★ — PR 이 프로덕션에 배포하면 안 된다.
  주의: 이미 `if` 를 갖고 있던 단계(`Enable R2 binding`, `R2 status summary`)는 조건을
  ★합쳐서★ 걸어야 한다. 처음에 `if` 를 한 줄 더 붙였다가 YAML 중복 키로 push 가드가
  조용히 죽었고(뒤엣것이 이긴다), `tools/check-stage-cost.mjs` ④가 그것을 잡았다.

## Remaining work

- FLOW·XALPHA·STACK·DUAL 은 아직 워커 학습이다. ★V33.307 의 `alt.stageCost` 를 하룻밤
  받아 보고 대상을 고른다.★ 현재까지 기록으로 확인된 것:
  · DUAL — DUALHEAD 주석에 "요청당 128MB 를 넘겨 워커가 죽었다 · train-now dual 이 HTTP 503
    4회 연속" 이 남아 있다. 그래서 창을 60,000 → 20,000 으로 줄였다. 밖으로 옮기면 그 제약이
    풀린다. ★단, `DUALHEAD.nonlinear: true` 라 비선형 헤드 경합(lin/gbdt/mlp/blend)까지
    옮겨야 성능이 안 깎인다★ — 선형만 옮기면 그건 성능 저하다. 추측으로 하지 않는다.
  · STACK·FLOW·XALPHA — 각자 자기 표(stack/flow/xalpha_samples)로 학습하는데 Modal 은 지금
    `ml_samples` 만 내려받는다(`/api/ml-export`). 옮기려면 export 경로부터 필요하다.
- 외부(Modal) 업로드 모델(SEQ·DNN·GBDT·부스터)은 V33.300 의 "홀드아웃 기간이 모자라면
  못 쟀다" 가드를 거치지 않는다. 트레이너가 홀드아웃 달력기간을 함께 올려야 닫힌다.
- FLOW·XALPHA 는 표본 표 자체가 21일치라 판정 불가 상태다(코드 문제가 아니라 시간 문제).

## Validation

- 새 담당자는 아래 명령을 다시 실행한다.
  - `node tools/check-model-evidence.mjs`
  - `node tools/check-syntax.mjs src/index.js`
  - `node tools/check-memo-modal.mjs`   (두 언어 정합 — 파이썬을 실제로 돌린다)
  - `node tools/check-stage-cost.mjs`   (PR 이 배포하지 않는지 — YAML 을 실제로 파싱해 본다)
  - `node tools/check-flow-peer-cpu.mjs` (옛 구현과 값 대조)
  - `node tools/check-holdout-anchor.mjs`
  - `for f in tools/check-*.mjs; do node "$f" >/dev/null || echo "FAIL $f"; done`
- 이번 세션 실행 결과: 위 전부 통과(게이트 81종), `node --check src/index.js` 통과,
  `python3 -c compile(modal_train.py)` 통과.
- 실측 대조값: MEMO 정합 probe 40건 최대 차 1.11e-16 (허용 1e-6).

## Recovery notes

- `/api/memo-import` 는 probe 가 없거나 오차가 `MEMOML.probeMaxDiff`(1e-6)를 넘으면 저장하지
  않는다. Modal 쪽 식을 고치면 반드시 probe 오차를 다시 확인한다.
- 외부 MEMO 를 끄려면 `MEMOML.externalMaxAgeH` 를 0 으로 두면 된다 — 워커가 종전대로 학습한다.
- V33.303 이후 MEMO 원형책은 홀드아웃(60일)+엠바고(10일) 이전 구간에서 만들어진다.
  즉 배포되는 원형책이 그만큼 과거다. 잰 것과 배포한 것을 같게 하려는 의도적 선택이고,
  신선도까지 되찾으려면 측정용·배포용 두 번 적합해야 한다(예산 재설계 필요).
- 비밀키·토큰·Cloudflare secret 은 이 문서에 기록하지 않는다.
