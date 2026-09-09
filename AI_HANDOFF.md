# AI 작업 인계 상태

> 이 문서는 Claude Code와 Codex가 토큰 소진·세션 중단 후에도 커밋 경계에서 안전하게 이어가기 위한 체크포인트다.

## Current handoff

- Status: complete locally; deployment must be checked against this exact HEAD after push.
- Owner: Claude
- Branch: main (direct main authorized; no PR)
- Last commit: HEAD / V33.327 (resolve with git log -1)
- Base: 7705ccc / V33.326 (같은 세션). 배포 성공·live build V33.326 확인 후 시작.
- Scope: 사용자 지시 — "다른 문제 없는지 확인하고 수정해". 프로덕션 자가진단(/api/selfcheck)이
  스스로 낸 warn 을 근거로 두 건을 고쳤다.

### Claude V33.327 — 2026-09-09

- **① 부가조회 지갑: 한 건이 사이클을 통째로 굶겼다** (`src/index.js`)
  자가진단 warn 3건 중 2건이 같은 사고를 가리켰다:
    `[EVAL-COST] KR 부가조회 6773/7200ms — scalp 6773ms · 느린종목 052690.KS:★7071ms★`
    `[EVAL-COST] KR 부가조회 7470/7200ms(★예산소진 14건 생략★)`
    `[TIME-CAP] ★72회 반복★ — KR 평가 35/446종목(8%) 후 중단`
  원인: `_enrichRun` 이 지갑을 ★쓰기 전 잔액★ 만 봤다. 한 번 시작한 조회는 얼마가 걸리든
  끝까지 기다렸다 — 한 종목이 7,071ms 를 쓰면 7,200ms 예산이 그 자리에서 끝난다.
  고침: 1건 상한(`ENRICH.perCallMs` 2,000ms)을 두고, 기다리는 시간은 ★남은 잔액과 상한 중
  작은 쪽★ 으로 한다. 넘으면 그 건만 포기하고 지갑이 비었을 때와 같은 `undefined` 를
  돌려준다(호출부가 이미 그 값을 다룬다). 값 근거: 같은 로그의 다른 느린 종목이
  1,278~1,579ms 라 2,000ms 는 정상 조회를 안 깎고 병적인 건만 끊는다.
  ★거래 확정 경로(`_phaseRun`)는 손대지 않았다★ — 거기에 상한을 걸면 "조회 실패 → 진입 차단"
  이라는 조용한 사고가 난다(코드 주석이 이미 경고하고 있던 지점).
  검증(실측): 새 게이트가 7,071ms 건을 2,003ms 에 끊고, 종전에 전부 생략되던 뒤 14종목이
  전부 조회되는 것을 확인. 상한 제거·거래경로에 상한 추가 두 회귀를 넣어 둘 다 잡히는 것도 확인.
- **② flow/xalpha/stack_samples 에 인덱스가 없었다** (`src/index.js`)
  `ml_samples` 에는 `idx_samples_fv_ts(featver, ts)` 가 있는데 나머지 셋에는 ★인덱스가
  하나도 없었다★(PK 뿐). 종전에도 `WHERE featver=? ORDER BY ts DESC LIMIT 40000` 이
  전체 스캔+정렬이었지만 질의가 하나라 넘어갔다. 그런데 V33.326 의 달력 분할은 칸마다
  범위 질의를 던져 ★질의가 13개★ 가 된다 — 인덱스가 없으면 그게 전부 풀스캔이 되어
  야간 예산을 태운다. 즉 이 인덱스는 V33.326 의 ★전제★ 다.
  인덱스를 필요로 하는 코드(`_miniLogisticTrain`)가 직접 `CREATE INDEX IF NOT EXISTS` 로
  보장한다(야간 1회, 있으면 no-op). 표 이름은 코드 상수지만 DDL 이라 `^[a-z_]+$` 로 한 번 더 좁혔다.
- **새 게이트** `tools/check-enrich-budget.mjs` (deploy.yml 배선): 소스에서 `_enrichRun` 을
  꺼내 ★실제로 돌려★ 7항목을 본다 — 병적인 건 절단, 뒤 종목 회복, 정상 조회 보존, 지갑 소진
  계약 유지, 오류 전파, ★거래 확정 경로에 상한 없음★, 잔액 우선.
- **기존 게이트 보수** (`tools/check-eval-cost.mjs`): 같은 함수를 떼어 돌리는 하네스에
  `_num`·`_enrich.timedOut` 이 없어 ReferenceError 로 죽었다. 빠진 것을 채워 ★계속 실제로
  돌게★ 두었다(문자열 검사로 후퇴하지 않았다).
- 남겨 둔 것(고치지 않고 보고만): `perf.scan.coverage 10%` 는 증분 스캔의 설계상 회전이라
  결함이 아니다. XALPHA 는 전진 IC 가 음수(-0.039)인데 `fwdReady=false` 라 조기 거부에
  안 걸린다 — 문턱 설계에 관한 판단이라 근거 없이 손대지 않았다.
- 검증: `node --check` 통과, 89종 게이트 전체 통과, `git diff --check` 통과.
- 학습·주문 트리거 없음, 정책 값 변경 없음, 시크릿 없음.

## Previous handoff — V33.326

- Owner: Claude
- Last commit: V33.326 (resolve with `git log`)
- Base: 9bb942b / V33.325. 작업 전 `git fetch origin main` 확인(뒤처짐 0).
- Scope: 사용자 지적 — "또 신규 위원들 작동 안하는데 원인 분석해서 수정해라".

### Claude V33.326 — 2026-09-09

- **원인(운영 실측으로 확정)**: worker-probe 로 프로덕션 `/api/ai-mode` 를 떠 보니 공용
  트레이너(`_miniLogisticTrain`)를 쓰는 위원이 ★전원★ 같은 자리에 걸려 있었다.
    FLOW 21일=관측 2개(t 5.46) · XALPHA 24일=2개(t 2.94) · STACK 38일=3개(t -0.88)
    · 이중헤드 강세 25일=2개(t 2.57) · 약세 25일=2개(t 4.92)  → 전부 tier=pending, mult=0
  t 가 5.46·4.92 로 충분히 유의한데도 합류를 못 한다 — 문턱 미달이 아니라 ★기간이 모자라
  판정 자체가 보류★ 됐다(expertAdmit 의 minBlocks=5 게이트).
  기간이 짧았던 이유는 홀드아웃을 '행의 마지막 20%' 로 잘랐기 때문이다. 수확이 한 날짜에
  전 종목을 쌓으므로 8,000행이 21일밖에 안 되고, 라벨 지평 10일 기준 겹치지 않는 관측이
  2개뿐이다. ★표에는 재료가 있는데 안 읽은 것★ — 창(40,000행)은 100일 넘게 덮는다.
- **왜 '또' 인가 — 반쪽만 고쳐져 있었다**: V33.303 이 MEMO 에 대해 정확히 같은 진단을 하고
  달력 고정으로 고쳤는데, 그 수정이 `MEMOML` 안에만 들어가 같은 병을 앓는 flow·xalpha·
  stack·이중헤드는 그대로 남았다. MEMO 는 지금 이 게이트에 안 걸린다(t -1.37 로 '못 미침'
  판정을 받는다) — 그게 대조군이다.
- **고침** (`src/index.js`): 공용 트레이너에도 같은 달력 홀드아웃을 넣었다. 홀드아웃 =
  가장 최근 `MINIHOLD.days()` 일을 12칸으로 나눠 균등추출(기간은 지키고 행은 holdCap 9000 으로
  묶음 — CPU·메모리 예산 불변), 학습 = 홀드아웃 시작 − 엠바고(지평 1회) 이전에서 최근
  window 행. 분할 경계는 행 비율이 아니라 ★시각(ts)★ 으로 잡는다(파싱 탈락이 있어 행 수로는
  못 맞춘다). 이력이 짧으면 종전 20% 로 물러서고 로그에 이유를 적는다.
- **기간을 상수로 박지 않았다**: `MINIHOLD.days()` 가 `minBlocks × 지평` 에서 계산한다.
  지평이 10→15 로 바뀌는 날 상수 60 은 조용히 부족해지고 위원들은 다시 대기로 돌아간다 —
  방금 겪은 그 사고다. 여유는 40% 로 잡았다: 칸별 균등추출이 ★가장 오래된 칸에서 한 칸 폭만큼
  기간을 깎기★ 때문에 20%(60일)로는 실측 55~58일, 관측이 정확히 5개로 문턱에 걸친다
  (행/일 380·1500·4000 세 밀도로 시뮬레이션해 확인). 70일이면 65~68일 → 관측 6개로 여유 1개.
  대가는 숨기지 않는다 — 배포 모델이 홀드아웃+엠바고(80일)만큼 오래된 구간에서 적합된다.
- **새 게이트** `tools/check-mini-holdout.mjs` (deploy.yml 배선 완료): 설정이 정말 minBlocks 를
  넘기는지 ★산수로★ 검증한다. ① 목표 기간 ② 칸 손실을 뺀 최악 기간에 ★여유 1개★ ③ 학습 몫
  ④ 공용 트레이너가 실제로 달력 분할을 하는지 ⑤ MEMO 와 설정이 갈라지지 않았는지.
  세 가지 되돌림(여유 1.2 로 축소 · 지평 15 로 변경 · 시각경계 삭제)을 실제로 넣어 ★전부
  잡히는 것을 확인★ 한 뒤 원복했다.
- **기존 게이트 강화** (`tools/check-holdout-anchor.mjs`): 이 판으로 `_calWhy = "이력 "` 이 두
  곳이 되면서, 변이 시험의 `String.replace`(첫 번째만 치환)가 헛돌게 됐다 — 계약을 다 지워도
  통과하는 상태였다. ★그 검사가 스스로 실패해서 알려줬다.★ `replaceAll` 로 바꿔 전부 지워야
  잡히도록 되돌렸다.
- 검증: `node --check` 통과, 88종 게이트 전체 통과, `git diff --check` 통과.
- 배포 후 확인할 것: 다음 야간 학습이 돌고 나서 worker-probe 로 `/api/ai-mode` 를 다시 떠,
  flow·xalpha·stack·이중헤드의 `valICspanD` 가 60일대로 오르고 `valICeff ≥ 5` 가 되는지,
  그리고 tier 가 pending 을 벗어나는지 본다. ★학습이 한 번 돌기 전에는 옛 레코드 그대로다.★
- 학습·주문 트리거 없음, 정책 값(requireTrustedModel 등) 변경 없음, 시크릿 없음.

## Previous handoff — V33.325

- Owner: Claude
- Last commit: V33.325 (resolve with `git log`)
- Base: b7b61a8 / V33.324 (Codex). 작업 전 `git fetch origin main` → 3커밋 뒤져 있어
  `git pull --ff-only` 로 맞춘 뒤 시작했다(CLAUDE.md 규칙).
- Scope: 사용자 지적 — "AI 두뇌 작동 로그가 오류난거 같은데 글씨가 세로로 쓰인다".

### Claude V33.325 — 2026-09-08

- **원인: 매달린 선택자(dangling selector) 하나.** `public/index.html` 인라인 CSS 에
  '스크롤 경계 페이드' 규칙이 있었고 선택자가 `#page-nnviz .nlv-feed, #page-nnviz .nlv-toplist`
  였다. 언젠가 `.nlv-toplist` 를 이 페이드에서 빼면서 ★선언 블록을 통째로 지우고
  `#page-nnviz .nlv-feed,` 만 쉼표째 남겼다.★ CSS 는 그 쉼표를 다음 규칙까지 이어 읽으므로,
  판정 로그가 바로 아래 "최우선 후보 카드" 규칙
  (`display:grid; grid-template-columns:repeat(3,1fr)`)을 그대로 물려받았다.
- **증상이 왜 '세로 글씨'였나(실측)**: `.nlv-feed` 가 3열 그리드가 되면서 로그 줄 하나하나가
  칸에 갇혀 `.nlv-line` 이 141×300px 이 됐고, 줄 안의 `58px 1fr` 에서 본문 칸이 36px 로
  짜부라져 글자가 한 자씩 세로로 쌓였다. 고친 뒤 같은 화면에서 줄 435×56px,
  본문 칸 330px, 트랙 `58px 329.5px` — 정상 가로 흐름.
- **고친 방법**: 매달린 선택자 한 줄을 지웠다. 페이드 마스크는 이미 선언이 사라진
  유물이고 현재 두뇌 콘솔은 평면·무채색 디자인이라 되살리지 않았다. 사고 경위를 그 자리에
  주석으로 남겼다.
- **재발 방지 게이트** (`tools/check-ai-ops-ui.mjs`): 인라인 `<style>` 을 중괄호 깊이를 세며
  훑어(@media 안쪽 포함) `.nlv-feed` 가 들어간 선택자 목록 중 `display:grid` 나
  `grid-template-columns` 를 선언하는 규칙이 있으면 실패시킨다. ★버그를 일부러 되살려
  게이트가 실제로 잡는 것을 확인한 뒤★ 원복했다(FAIL 메시지에 붙어버린 선택자를 그대로 출력).
- 검증: `node --check` 통과, 87종 게이트 전체 통과, `git diff --check` 통과.
  1366px·390px 두 폭에서 로그가 정상 가로 흐름이고 가로 오버플로 없음.
- 학습·주문 트리거 없음, 정책 값 변경 없음, 시크릿 없음.

## Previous handoff — V33.324

- Status: complete; V33.324 deployed and verified in the production browser.
- Owner: Codex
- Branch: main (direct main and live deployment explicitly requested)
- Last commit: HEAD / V33.324 (resolve with git log -1)
- Base: a5d8e14 / V33.323; origin/main was fetched and matched before work.
- Scope: delete existing DNN-family and SEQ visualization designs and implement new responsive living neural scenes.

### Codex V33.324 — 2026-09-09

- Deleted old SVG neural renderer, node tooltip/hit-test renderer, SEQ card geometry, animation/gesture renderer, and their dedicated styles (~1,100 HTML lines). Model payload/status/banner and admission logic remain in existing adapters.
- New `public/neural-observatory.js` + `.css`: independent Canvas engine. DNN has golden-angle neuron bodies and moving axon signals; SEQ has 3D helical time/stage bundles with perspective, camera orbit, pinch/drag/keyboard, zoom, fit, head/block/time and individual node selectors.
- Every DNN neuron retains its source index/value (live payload: 2,428). SEQ overview samples non-selected time slices for speed; selected time includes every dimension, and full-detail mode exposes all 2,737 nodes. Only measured attention carries numeric edge weights. Animation is explicitly marked illustrative, not live activation.
- DNN static raster cache; <=100 moving signals, 30fps scheduling, device pixel ratio capped at 1.5. Intersection/visibility observers stop hidden scenes; replacement mount disposes the prior renderer. Reduced-motion disables motion by default. Full-detail selection stops automatic rotation.
- New engine executable tests replace old SVG-shape assertions; retained server-side SEQ training/weight/probe checks. The new gate is wired into deploy.yml. Browser probe tests detail nodes, actual inspector data, head/block/time, zoom, keyboard fit, pause/resume and hidden-scene pause/resume.
- Browser: 390x844, 820x1180, 1366x900 observed without document horizontal overflow. SEQ overview average Canvas draw ~2.4ms; mixed full-detail interaction probe ~5.5ms in this browser (not a physical-device frame-rate guarantee). Screenshots in workspace `outputs/neural324-*`.
- Final validation: all 87 `tools/check-*.mjs` gates passed; after final mobile layout/cache adjustments, neural engine, inline JS, AI operations checks and `git diff --check` passed again. DNN cached average draw ~0.47ms. Narrow DNN uses a 3-column serpentine arrangement rather than shrinking all 12 layers into one tiny row.
- Live evidence: implementation commit `b5b5fa530969cdc5604364a3a8bef9405ef9f92a`; GitHub deployment run `34269735567` completed successfully. Production returned `lux-build=V33.324`. Production SEQ browser probe at 1366x900 passed detail/block/head/time/zoom/pause/hidden-resume; DNN at 390x844 rendered 2,428 neurons / 2,992 structural edges without horizontal overflow, average cached draw 0.64ms. No browser JS errors. Final screenshots: `outputs/neural324-live-seq.png`, `outputs/neural324-live-dnn-mobile.png`. This follow-up handoff commit changes documentation only.
- No training/order actions, model algorithm, binding or cron changes. Old shared status panels/sidebar remain outside this renderer scope.

## Previous handoff — V33.323

- Status: complete locally; deployment must be checked against this exact HEAD after push.
- Owner: Codex
- Branch: main (direct main authorized; no PR)
- Last commit: HEAD / V33.323 (resolve with git log -1)
- Base: abece41 / V33.322 from origin/main. User said they had edited brain observatory separately, so Codex fast-forwarded before applying this patch.
- Scope: 사용자 지시 — "최근 스캔에서 반사실 후보 보다가 갱신될 때 화면이 위로 올라가는 문제 해결, 모델 구조 인공신경망 디자인 완전 변경, SEQ 3D 구조관측 3D 모델링 변경, 렉 없이 살아움직이는 느낌".

### Codex V33.323 — 2026-09-08

- 최신 GitHub 코드 우선: 로컬 수정분을 stash 한 뒤 origin/main V33.322로 fast-forward, 충돌은 upstream V33.322 로직을 유지하고 이 UI 패치만 다시 얹었다.
- `public/workspace-ui.js`: 두뇌관측 모델 뷰 재렌더가 더 이상 `brain.scrollTop = 0`을 강제하지 않는다. 현재 window/page scroll과 page-local scroll을 저장했다가 기존 `openNnViz()` 재호출 후 복원해, 최근 스캔/반사실 후보를 보는 중 갱신이 화면을 맨 위로 끌어올리지 않게 했다.
- `public/index.html` + `public/workspace-layout.css`: DNN 신경망 관측은 기존 데이터, 노드 hit-test, 툴팁, 포커스 하이라이트, 4,500 edge cap을 유지하면서 흑백 slice deck, square layer plates, CSS-only signal flow로 다시 디자인했다.
- SEQ 3D 관측은 기존 projection/control/pick/data mapping은 유지하고 `.sq3-neural` wireframe stage와 가벼운 CSS pulse/flow로 다시 모델링했다. `prefers-reduced-motion`에서는 애니메이션이 꺼진다.
- `tools/check-ai-ops-ui.mjs`: 스크롤 보존 계약과 새 DNN/SEQ 렌더 훅을 회귀 검사에 추가했다.
- 검증: V33.323 기준 모든 `tools/check-*.mjs` 통과, `node --check src/index.js` 통과, `git diff --check --cached` 통과. 로컬 preview `127.0.0.1:8766`에서 V33.323 로드, DNN 2,428 nodes / 4,500 capped flow edges, SEQ 3D SVG stage 생성, document horizontal overflow 없음.
- 스크린샷: `outputs/brain-dnn-v33.316.png`, `outputs/brain-seq-v33.316.png`는 같은 시각 패치의 rebase 전 캡처다(최종 버전 번호만 V33.323으로 올라감).
- 학습·주문 트리거 없음, 정책 값/바인딩/크론 변경 없음, 다른 페이지 디자인 변경 없음.

## Previous handoff — V33.322

### Claude V33.322 — 2026-09-08

- **판정 깔때기만 한 단계 촘촘하게** (`public/workspace-layout.css`): 글자 크기는 그대로 두고
  여백·막대 두께만 줄였다 — `.nlv-funnel` 패딩 8px→5/6px, 행 간격 6px→3px, 막대 9px→8px,
  KPI 칸 패딩 5px→4px. 카드 머리글도 이 카드에서만 10px→7px 로 낮췄다(다른 카드 머리글은
  건드리지 않았다 — 실측으로 "실시간 스캔 종목" 머리글이 35px 로 유지되는 것 확인).
- 실측: `.nlv-funnel-wrap` 287px → 262px(-25px, 약 9%). 머리글 35→29, 본문 174→157,
  KPI 46→44. "아주 조금"이라는 요청에 맞춘 폭이며, 5개 행·수치·퍼센트는 그대로 읽힌다.
- 검증: `node --check` 통과, 86종 게이트 전체 통과, `git diff --check` 통과, 1366px 화면
  스크린샷으로 가독성 확인.
- 학습·주문 트리거 없음, 정책 값 변경 없음, 시크릿 없음.

## Previous handoff — V33.321

- Owner: Claude
- Last commit: V33.321 (resolve with `git log`)
- Base: V33.320 (같은 세션, 직전 커밋), 배포 run 34178419604 성공 확인 후 시작.
- Scope: 사용자가 실제 화면 캡처와 함께 "이걸 비율이 맞다 하는거냐? 다시 디자인해". V33.320 의
  가로 배치가 사용자 화면 폭에서 그대로 접혀 있었다 — 추측 말고 실측으로 원인을 잡고 재설계.

### Claude V33.321 — 2026-09-08

- **왜 V33.320 이 사용자 화면에서 안 먹혔나(실측)**: 헤드리스로 사용자 화면 폭(1366px)을
  재보니 `.nlv-core` 가 ★477px★ 이었다. V33.320 은 지표(156px)+근거(300px)=456px 를
  기준으로 나란히 두게 했는데, 패딩까지 더하면 477px 를 넘겨 ★그대로 세로로 접혔다★.
  접힌 카드는 722px 까지 길어지고, 옆 "판정 깔때기"는 내용이 287px 뿐인데 grid stretch 로
  같은 722px 로 늘어나 절반 이상이 검은 여백이 됐다 — 사용자가 캡처로 보여준 그 화면이다.
- **구조를 바꿨다(뉴스·환율 화면과 같은 원칙)**: 높이가 크게 다른 블록을 나란히 세우면
  반드시 한쪽이 빈다. `.nlv-hero` 를 1열로 바꿔 "실시간 스캔 종목"과 "판정 깔때기"가 각자
  제 줄에서 전체 폭을 쓰게 하고, 넓어진 폭 ★안에서★ 차트·지표·근거를 가로로 나눴다
  (새 래퍼 `.nlv-body`). 카드 높이 722px → 417px, 세 칸 높이는 서로 정확히 같다.
- **flex-grow 를 1 미만으로 두면 안 된다(실측으로 두 번 걸렀다)**: 지표 레일에 `flex:0 1`
  을 주니 좁은 화면에서 접힌 줄이 168px 에 머물러 135px 가 비었고, `0.5` 로 고쳐도 남는
  폭의 절반만 먹어 67px 가 비었다 — grow 합이 1 미만이면 남은 공간이 전부 분배되지 않는다.
  `flex:1` 로 두고, 넓은 화면에서 레일이 과하게 벌어지는 건 `@media (min-width:1200px)`
  에서만 `max-width:300px` 로 잡았다(접히는 폭에서 상한을 걸면 그 상한이 곧 빈칸이 된다).
- **반사실 후보 그리드 auto-fill → auto-fit**: auto-fill 은 항목이 모자라도 빈 트랙을 만들어
  4건만 있을 때 오른쪽이 배경색 그대로 남았다.
- 검증(실측): 390 / 768 / 1366 / 1920 네 폭에서 세 칸 폭 합이 줄 폭과 정확히 일치 —
  390 스택(303/303/303), 768(333+188 → 521), 1366(385+221+323=929),
  1920(560+300+623=1483). 전 폭 가로 오버플로 없음. 86종 게이트 전체 통과.
- 학습·주문 트리거 없음, 정책 값 변경 없음, 시크릿 없음.

## Previous handoff — V33.320

- Owner: Claude
- Last commit: V33.320 (resolve with `git log`)
- Base: V33.319 (같은 세션, 직전 커밋), 배포 run 34175414914 성공 확인 후 시작.
- Scope: 사용자 지시 — "카드 비율 다시 맞춰 그리고 작은 글씨로 해서 지표 옆에 쓰이게하고
  그래프 크기를 줄여". 실시간 스캔 종목 카드가 세로로만 길어진 것을 바로잡았다.

### Claude V33.320 — 2026-09-08

- **그래프 축소** (`public/index.html`): `drawLineChart` 의 viewBox 를 460×190(2.4:1) →
  460×124(3.7:1) 로 눕혔다. svg 가 `width:100%; height:auto` 라 그려지는 높이는 전적으로
  viewBox 비율이 정한다 — 카드 폭 550px 기준 약 227px → 약 148px. 폭은 그대로 다 쓰고
  높이만 줄어든다. 축 여백(padT 12→9, padB 18→15)도 함께 줄여 그래프가 눌리지 않게 했다.
  자리도 같이 줄였다: `.nlv-tp-chart` 의 `min-height:172px` → `0`(컴팩트 뷰의 150px 도 해제)
  — 안 줄이면 낮아진 그래프 아래에 빈 공간만 남는다.
- **지표를 세로 레일로, 판단 근거를 그 옆에** (`public/index.html`, `public/brain-console.css`):
  새 래퍼 `.nlv-detail`(flex)로 지표와 판단 근거를 나란히 놓고, 글자를 한 단계씩 줄였다.
  ★가로 타일을 세로 목록으로 바꾼 이유★: 9개를 가로 3열로 깔면 3줄(≈80px)에서 끝나 옆
  근거 칸(≈200px)보다 훨씬 짧고, 그 아래가 빈 검은 덩어리로 남았다(첫 시도에서 실제로 그랬다).
  한 줄에 하나씩 세우니 높이가 근거 칸과 맞아 빈 칸이 사라졌다.
  구분선도 '간격으로 컨테이너 배경 비추기'에서 셀 테두리로 바꿨다 — 남는 자리가 어두운
  선 색 그대로 드러나지 않게. 좁은 화면에서는 flex-wrap 으로 위아래로 돌아간다(모바일 확인).
- **주석 경계표 보존** (`public/index.html`): `tools/check-ai-ops-ui.mjs` 가 `// 종가 선 그래프`
  를 코드 구간 잘라내기 경계로 쓴다. 처음에 이 주석을 블록 주석으로 바꿨다가 게이트가
  함수를 못 찾아 실패했다 — 첫 줄을 원래 문구 그대로 되돌리고 설명은 아래에 덧붙였으며,
  그 사실을 주석에 적어 두어 다음 사람이 같은 데 걸리지 않게 했다.
- 검증: `node --check` 통과, 86종 게이트 전체 통과, `git diff --check` 통과. 헤드리스
  크로미움 확인 — 데스크톱(1600×1000)에서 지표 레일과 근거 칸 높이가 맞아 빈 칸 없음,
  모바일(390×844)에서 두 칸이 정상적으로 위아래로 쌓임(각 303px)이고 가로 오버플로 없음
  (scrollWidth == clientWidth), 그래프는 데스크톱 ≈148px · 모바일 75px 로 축소 확인.
- 학습·주문 트리거 없음, 정책 값 변경 없음, 시크릿 없음.

## Previous handoff — V33.319

- Owner: Claude
- Last commit: V33.319 (resolve with `git log`)
- Base: V33.318 (같은 세션, 직전 커밋), 배포 run 34174328087 성공 확인 후 시작.
- Scope: 사용자 지적 2건 — ① V33.318 로 넣은 스캔 지표가 화면에 안 보인다 ② 확률의 근거가
  무엇인지도 표시해 달라.

### Claude V33.319 — 2026-09-08

- **지표가 안 보이던 진짜 이유**: V33.318 은 야간 스캔이 픽에 `ta` 를 실어 보내게 했는데,
  ★스캔은 하루 한 번 돈다★. 배포 직후엔 저장된 픽이 전부 옛 코드가 만든 것이라 `ta` 가 없고,
  화면은 다음 밤까지 계속 비어 있었다. "다음 스캔부터 보입니다"라고 안내만 하고 끝낼 일이
  아니었다 — 기능을 넣고 아무것도 안 보이는 상태로 둔 것이다.
- **`/api/ta-explain?symbol=` 신규(읽기 전용)** (`src/index.js`): 지금 보고 있는 ★그 한
  종목만★ 즉석 계산한다. 새로 받아오지 않는다 — 이미 있는 일봉 캐시(`daily:<sym>`)와 지수
  캐시만 읽고, 없으면 없다고 답한다(지어내지 않는다). 숫자는 스캔이 쓰는 것과 같은 함수
  (`mlBuildFeatures` → `luxTaFromFeat`)로 만들어, 나중에 스캔이 채워 넣는 값과 어긋날 수 없다.
  응답: `ta`(9종) + `reasons`(taPredictDirection 이 점수를 쌓으며 남긴 근거 문자열) +
  `tf`(다기간 컨센서스 now/week/month/year) + `upProb`/`confidence`. SWR 60초 캐시.
- **지표 목록 단일화** (`src/index.js`): `LUX_TA_KEYS` + `luxTaFromFeat()` 를 만들어 스캔과
  즉석 조회가 ★같은 목록·같은 단위★ 를 쓰게 했다. 각자 목록을 들고 있으면 언젠가 갈라져
  같은 종목인데 두 화면 숫자가 달라진다.
- **판단 근거 패널** (`public/index.html`, `public/brain-console.css`): 사용자 요청("확률의
  근거가 된것이 뭔지도"). ★두 가지를 반드시 구분해 적는다★ —
    · 확률 `p` 는 위원회(신경망 합의)가 100여개 피처를 보고 낸 값이다. 어떤 한 지표가 p 를
      만들었다고 말할 수 없어서, "모델 합의 — 단일 지표가 아니라 피처 전체를 본 값"이라 적는다.
    · 랭크는 산수 그대로 분해된다: `p + 기술가중×tech + 대형주가중×blue` → `×(1+evTilt)`.
      가중치는 하드코딩하지 않고 서버가 `/api/ai-picks` 의 `rankWeights` 로 내려준 실제 엔진
      값을 쓴다(엔진 설정이 바뀌는 날 화면만 옛 수로 남지 않게).
    · `reasons` 는 ★기술 점수★ 의 근거이지 p 의 근거가 아니라서, 제목을 "기술 근거"로 못박았다.
  가산 항목은 `rankP` 가 있는 픽(= 엔진이 실제로 그 산수를 한 픽)에만 적는다 — 진입루프가
  만든 픽에는 랭크가 없으므로 합계 없는 숫자를 띄우지 않는다.
- 이미 저장된 픽도 `p`/`tech`/`blue`/`rankP` 를 갖고 있어, 랭크 분해는 ★야간 스캔을 기다리지
  않고 즉시★ 보인다. 지표는 ta-explain 이 채운다.
- 검증: `node --check` 통과, 86종 게이트 전체 통과, `git diff --check` 통과. 헤드리스
  크로미움에 ★ta 가 없는 픽★(배포 직후 실제 상황)을 주입해 확인 — 지표 9종이 즉석 조회로
  채워지고, 판단 근거가 p·기술가산·대형주가산·최종랭크·기술근거·다기간추세까지 렌더됨.
  일봉 캐시가 없는 경우(available:false)도 확인 — 지표 칸은 사유를 적고, 랭크 분해는 그대로.
- 학습·주문 트리거 없음, 정책 값 변경 없음, 시크릿 없음.

## Previous handoff — V33.318

- Owner: Claude
- Last commit: V33.318 (resolve with `git log`)
- Base: V33.317 (같은 세션, 직전 커밋), 배포 run 34172044453 성공 확인 후 시작.
- Scope: 사용자 지시 5건 — ① 지표&환율 화면 이름을 "뉴스·환율"로 ② 뉴스를 보려고 내리면
  반쪽이 비는 비율 문제 재설계 ③ 작동 화면에서 "위원회 구성" 제거 ④ 잘려 있던 "판정 깔때기"·
  "실시간 스캔 종목"을 완전하게 복구 ⑤ 실시간 스캔에 MACD 등 종목 지표 추가.

### Claude V33.318 — 2026-09-08

- **화면 이름 통일** (`public/index.html`): 좌측 네비·모바일 드로어·페이지 헤더를 전부
  "뉴스·환율"로 맞추고, 탭 순서도 전체 브리핑 → 뉴스 → 환율 → 경제지표로 바꿨다.
  V33.315에서 뉴스가 이 화면에 흡수됐는데 이름만 옛 이름이라 뉴스를 찾는 사람이 지나쳤다.
- **뉴스·환율 레이아웃 재설계** (`public/index.html`, `public/workspace-layout.css`):
  종전 `.market-grid` 는 2열이라 짧은 지표/환율 열과 긴 뉴스 열이 나란히 섰고, 뉴스를 읽으려
  내려가면 반대쪽 절반이 통째로 비었다. 세 블록(뉴스·경제지표·환율)은 길이 차가 커서 무엇을
  옆에 세워도 한쪽이 빈다 — 전부 제 줄에서 전체 폭을 쓰도록 세로로 쌓고, 남는 폭은 블록
  ★안에서★ 채운다(뉴스는 다단 그리드, 표는 5열/3열이 넓게 펴진다). 뉴스 카드는 DOM 순서도
  맨 앞으로 옮겨 화면 순서와 탭 순서를 맞췄다.
- **≥1600px 에서 페이지가 쪼그라들던 진짜 원인** (`public/workspace-layout.css`):
  `.page` 는 세로 flex 컨테이너(`.content`)의 아이템인데 `@media(min-width:1600px)` 에서
  `margin:0 auto` 가 걸린다. ★교차축 auto 마진은 flex 의 stretch 를 끈다★ — 그 순간 페이지는
  내용 폭(측정값 572px)으로 줄어든 뒤 가운데 정렬돼, 뉴스만 보는 뷰에서 양옆이 통째로 비었다.
  전체 브리핑에선 경제지표 표(min-width:520px)가 폭을 벌려 증상이 가려져 있었다.
  `#page-macro` 에 `width:100%` 를 주어 1720px 까지 채우고 그 이상에서만 가운데 정렬되는
  원래 의도로 되돌렸다(이 페이지에만 한정 — 다른 화면의 전역 레이아웃은 건드리지 않았다).
- **작동 화면에서 "위원회 구성" 제거** (`public/workspace-layout.css`): DOM 을 지우지 않고
  `data-brain-view="operations"` 에서만 감춘다 — `#nlvCommittee` 를 찾는 renderCommittee 가
  조용히 죽지 않게. 명부는 "02 모델 구조" 뷰에 그대로 있고, 맨 위 요약의 COMMITTEE 지표
  (`#opsCommittee`)도 그대로라 가동 인원은 계속 보인다.
- **잘린 패널 복구** (`public/workspace-layout.css`): V33.315~316 은 작동 화면을 100dvh 에
  맞추려고 `.nnviz-content` 에 높이를 고정하고 자식마다 max-height + overflow 를 걸었다.
  그래서 스캔 필름스트립은 `max-height:150px; overflow:hidden` 에 잘려 카드 아랫단이 사라졌고,
  판정 깔때기는 `minmax(170px,1fr)` 칸 안에서 스크롤 막대에 갇혔다. 높이 고정과 클램프를
  전부 걷어내 자연 높이로 흐르게 했다(페이지가 그냥 스크롤된다). 밀도(패딩·글자 크기)는 유지.
- **실시간 스캔 종목 지표** (`src/index.js`, `public/index.html`, `public/brain-console.css`):
  야간 스캔이 이미 `mlBuildFeatures` 로 구해 놓는 값을 픽에 실어 보낸다 — ★추가 계산·추가
  fetch 0★. 반환이 featNames 순서의 숫자 배열이라, 이름→위치 색인을 루프 밖에서 한 번 만들고
  픽마다 그 자리 값만 뽑아 `pk.ta` 로 붙였다(9종: rsi14·macdH·volSurge·ret5·ret20·atrPct·
  rs20·maStack·taUpProb, 40종목만 저장되므로 크기 부담 없음). 화면은 ★피처 정의 그대로의
  단위★ 로 적는다 — macdH 는 MACD 히스토그램을 가격 %로 정규화한 값이라 "원 MACD 값"이라
  적지 않고, volSurge 는 20일 평균 대비 배수로 적는다. 스캔 카드엔 MACD·RSI·거래량 3종,
  히어로엔 9종 전부를 타일로. 방향은 ★글자색★ 으로만 말한다(배경은 무채색 유지).
  옛 스캔 결과엔 `ta` 가 없으므로 "지표는 다음 야간 스캔부터 표시됩니다"로 정직하게 비운다.
- 검증: `node --check` 통과, 86종 게이트 전체 통과, `git diff --check` 통과. 헤드리스
  크로미움에 API 목업을 주입해(1600×1000 / 390×844) 다섯 건 모두 눈으로 확인 — 뉴스 3단
  전체 폭, 지표 타일 마지막 줄까지 채움, 필름스트립·깔때기 잘림 없음, 위원회 구성 사라짐,
  모바일 가로 오버플로 없음(scrollWidth == clientWidth).
- 학습·주문 트리거 없음, 정책 값 변경 없음, 시크릿 없음.

## Previous handoff — V33.317

- Owner: Claude
- Last commit: V33.317 (resolve with `git log`)
- Base: V33.316 (같은 세션, 직전 커밋), deployment verified live before this round started.
- Scope: V33.316 을 배포한 직후 사용자가 재지적 — "배경색 푸른색은 빼라 두뇌 관측에서 글자만
  색 넣고 다시 모노크롬화시켜 배경이랑 창 색은 그리고 최우선 후보 말고 실시간으로 스캔하는
  종목 그래프랑 확률 ai가 판단하는 정보 띄우라고." V33.316 은 배경 토큰(`--ops-bg0~3`,
  `--ops-line`, `--ops-panel`)까지 시안 색조로 물들여 화면 전체가 파랗게 보였다 — 이번엔
  표면(배경·테두리·창) 토큰만 순수 무채색으로 되돌리고, 상태를 나타내는 글자색(강조 토큰)은
  남겼다. 또한 히어로 카드("최우선 후보")가 위원회 랭크1위에 고정돼 있던 것을, 아래 필름스트립
  (AI 스캔 순회)이 지금 스포트라이트하는 실시간 스캔 대상을 그대로 따라가도록 다시 연결했다.

### Claude V33.317 — 2026-09-08

- **배경 모노크롬화** (`public/brain-console.css`): `--ops-bg0/1/2/3`, `--ops-line`,
  `--ops-line2`, `--ops-panel`, `--ops-panel-hi`, `--ops-ink*` 토큰을 순수 무채색(R=G=B에
  가까운 회색/검정/흰색)으로 재정의. 강조 토큰(`--ops-cyan/green/amber/red/purple`)은 그대로
  두되, 이걸 큰 배경 면에 칠하던 곳만 골라 고쳤다: `.nnv-tab.active` 는 시안으로 꽉 채우던
  배경 대신 회색 배경 + 시안 글자로, `.nlv-scancard.pass/watch/reject .stamp` 는 색이 채워진
  배지 대신 투명 배경 + 테두리(회색) + 색 있는 글자로 바꿔 "글자만 색, 배경은 무채색" 원칙을
  일관되게 적용했다. 계산된 배경색을 헤드리스 크로미움으로 확인(`.rail`/`.nlv-core`/
  `.nnviz-content` 모두 R≈G≈B).
- **히어로 = 실시간 스캔 대상** (`public/index.html`): "최우선 후보 <small>위원회 랭크 1위</small>"
  로 고정 표시하던 카드를 "실시간 스캔 종목"으로 바꾸고, `renderCore(d)`(committee 랭크1위를
  `rankedLivePicks(d)`로 뽑아 그리던 함수)를 `renderCoreFromScan()`으로 교체 — 필름스트립이
  관리하는 `SCAN.list`/`SCAN.idx`(지금 스포트라이트 중인 스캔 대상)를 그대로 그린다. 필름스트립
  스크롤이 자동으로 넘어갈 때마다(`scanHighlight()`), 스캔 카드를 클릭할 때마다 히어로도 함께
  갱신된다. `scanVerdict()`(통과/관찰/탈락)를 재사용해 필름스트립과 같은 어휘로 표시하므로,
  기권(탈락) 종목이 지금 스캔 대상이어도 감추지 않고 "탈락"이라 보여준다(첫 요청부터의 요구사항).
  committee 랭크1위 자체를 보여주는 자리는 이제 없다 — `opsTopName`/`opsTopSignal`(맨 위 요약
  배너)은 원래 로직 그대로 committee 기준을 유지한다(사용자가 지적한 건 히어로 카드였다).
- **회귀 테스트 갱신** (`tools/check-ai-ops-ui.mjs`): 옛 계약("요약과 차트가 같은 최상위 후보를
  고른다")을 새 계약("히어로는 위원회 랭크1위가 아니라 지금 스포트라이트 중인 스캔 대상을
  따라간다" + "기권 종목도 지금 스캔 중이면 탈락이라 표시하며 숨기지 않는다" + "스캔 결과가
  비어 있으면 억지로 종목을 지어내지 않는다")로 다시 썼다 — 옛 테스트를 지우기만 한 게 아니라
  새 동작을 검증하는 assert 로 교체했다.
- `_BUILD_VER`/`lux-build`/CSS·JS 쿼리스트링을 V33.317 로 함께 올림.
- 검증: `node --check src/index.js` 통과, 86종 게이트 전체 통과(`check-ai-ops-ui.mjs` 포함),
  헤드리스 크로미움 1600×1100/390×844 스크린샷으로 배경 무채색·레이아웃 정상·히어로 라벨
  변경 확인.
- 학습·주문 트리거 없음, 정책 값(`AI_PARAMS.requireTrustedModel` 등) 변경 없음, 시크릿 없음.

## Previous handoff — V33.316

- Owner: Claude
- Last commit: V33.316 (resolve with `git log`)
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

## Current handoff — V33.328 (구조·설계 감사: 게이트가 헛도는 경로와 규칙 사본 제거)

사용자 요청: "다른 문제도 전부 해결해 찾아서 설계상의 문제점도 전부 찾아 구조적인 문제랑".
증상 하나를 더 고치는 대신, ★이번 세션에 두 번 반복된 실패 부류★ 를 구조로 막았다.

### ① 게이트가 조용히 헛도는 경로 (tools/check-gate-anchors.mjs 신설)
같은 날 두 번 났다.
- `check-holdout-anchor` — 소스에 같은 문구가 두 곳이 되자 `String.replace` 가 첫 곳만 지웠다.
  돌연변이 시험이 아무것도 시험하지 않은 채 ★통과★ 했다.
- `check-eval-cost` — 꺼내 돌리던 함수가 `_num` 을 쓰기 시작하자 하네스가 ReferenceError 로
  죽고 문자열 대조로 조용히 주저앉았다.

대다수 게이트는 `indexOf` 앵커로 소스를 잘라 본다. 앵커가 리팩터링으로 사라지면
`indexOf` 가 -1 → `slice(-1, …)` 이 거의 빈 문자열 → ★부정 단언이 전부 참★ 이 된다.
초록불인데 아무것도 안 지킨다. 그 경로를 메타검사로 먼저 깬다.

- 대상: 게이트 44개 · 자르기 앵커 192개(직접 `indexOf` + `slice(a,b)` 도우미 경유 모두).
- 존재 여부를 묻는 형태(`indexOf(x) < 0` / `=== -1`)는 제외한다 — "없어야 한다" 는 정상 쓰임이다.
- 도우미 판정은 좁게: 본문이 ①제 매개변수를 그대로 `indexOf` 에 넣고 ②`slice/substring` 을 할 때만.
  느슨하게 잡았더니 `check(cond,'통과문구','실패문구')` 의 ★메시지★ 86건을 앵커로 착각했다.
- 이 메타검사 자신도 썩을 수 있어 ★자가시험★ 을 넣었다(가짜 게이트 원문으로 잡을 것/안 잡을 것 확인).
- 검증: `_phaseRun` 앵커를 지우자 메타검사가 정확히 그 게이트를 지목하고 실패했다. 복원 후 통과.

감사 중 나온 오탐 2건은 ★메타검사 쪽이 틀린 것★ 이었고 고쳤다:
`new URL('…')` 홑따옴표 미인식, 한글 앵커(`/[A-Za-z]/` 요구) 누락.

### ② 같은 규칙의 사본이 둘 (tools/check-single-source.mjs 신설)
"★또★ 신규 위원들 작동 안 한다" 의 뿌리는 V33.303 이 달력 홀드아웃을 MEMO 한 곳만 고친 것이었다.
같은 함정을 소스 전체에서 찾았다(10줄 이상 동일 블록 탐지).

- **SEC Form 4 파서** — 야간 갱신(`updateInsiderFeedNow`)과 `/api/insider` 의 `__buildInsider` 가
  같은 정규식·같은 묶음 규칙을 각자 한 벌씩 갖고 ★같은 키 `insider_feed`★ 에 썼다.
  그 키는 화면용이 아니라 PEAD·사이징(`sig.insiderNote`)과 AI 피처(`insiderBuy`)가 읽는 거래 입력이다.
  SEC 제목 형식이 바뀌면 고친 쪽이 채운 값을 못 고친 쪽이 곧바로 덮어써, 원인이 안 보이는 채로 피처가 0 이 된다.
  → `_secForm4Parse(xml, rev)` 한 곳으로 합쳤다.
  **동작 동일 확인**: 옛 파서를 git HEAD 에서 꺼내 새 파서와 5개 입력(묶음·4/A 정정·엔티티 디코드·
  빈 응답·55건→40 상한)에서 돌려 ★출력이 바이트까지 같음★ 을 확인했다.
- **시세 병합** — `saveQuoteCM` 과 `saveQuoteAlt` 가 필드 19개까지 똑같은 사본이었다
  (주석에도 "saveQuoteCM 일반화" 라고 적혀 있었다). 새 일봉지표를 한쪽에만 추가하면
  다른 슬리브만 그 지표를 영영 못 받는다. → `saveQuoteCM` 은 `saveQuoteAlt` 로 넘기게 했다.
  CM 호출자는 `q` 에 `symbol` 을 안 싣기에 여기서 채워 넘긴다(저장 키 종전과 동일).
  **동작 동일 확인**: 주석 제거 후 병합 규칙이 `market` 키 말고는 완전히 일치.

### ③ 게이트가 판 올릴 때마다 무관하게 깨지던 것 (check-ai-ops-ui.mjs)
`?v=33.327` 을 리터럴로 박아 둬서 판을 올릴 때마다 이 게이트가 깨졌다.
그렇게 깨지는 검사는 "게이트를 숫자만 고쳐 통과시키는" 습관을 만들고, 그 습관이 진짜 계약까지 무디게 만든다.
지켜야 할 것은 특정 숫자가 아니라 ★빌드 판과 캐시무효화가 함께 움직인다★ 는 것이라, `lux-build` 에서 읽게 했다.

### 검증
- `node --check src/index.js` 통과.
- 게이트 91개 전부 통과(신설 2개 포함, 실패 0).
- 새 게이트 2개를 `deploy.yml` 에 배선(`check-stale-base.mjs` 가 배선 누락을 잡는다).

### 일부러 손대지 않은 것 — ★사용자 판단이 필요하다★
**XALPHA 의 전진 IC 가 음수(-0.039)인데 조기 기각에 안 걸린다.** `fwdReady=false` 라
"아직 판단 못 함" 으로 분류돼, V33.326 이후엔 ×0.60 가중으로 ★방향이 반대인 신호★ 가
위원회에 들어올 수 있다. 이건 문턱 설계의 판단이고 실제 돈이 걸린 가중치라 임의로 안 바꿨다.
선택지: (ㄱ) `fwdReady` 와 무관하게 전진 IC 가 음수면 기각, (ㄴ) 표본이 찰 때까지 가중 0 으로 보류,
(ㄷ) 지금처럼 둔다. 지시를 주면 그대로 반영한다.
