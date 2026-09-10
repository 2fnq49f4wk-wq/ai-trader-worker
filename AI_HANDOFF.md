# AI 작업 인계 상태

> 이 문서는 Claude Code와 Codex가 토큰 소진·세션 중단 후에도 커밋 경계에서 안전하게 이어가기 위한 체크포인트다.

## Current handoff

- Status: V33.329 ab4e950 deployed and live-verified; all four targeted retrains succeeded. Final evidence-panel sizing/docs commit requires its own deployment confirmation.
- Owner: Codex
- Branch: main (direct main authorized; no PR)
- Last commit: HEAD / V33.329 (resolve with git log -1)
- Base: f8251c4 / V33.328, fetched and fast-forwarded before edits; no concurrent upstream changes at final fetch.
- Scope: 사용자 요청 — 매매법/신규 모델 합류 문제 수정, 기존 틀 유지 디자인 개선.

### Codex V33.329 — 2026-09-09

- Detailed evidence and limits: `docs/CODEX-TRADING-AUDIT-V33.329.md`.
- Fixed AI_PRIMARY erasing scalp, contradictory snap routing and unvalidated bucket fallback. Reuses existing qualified setups and retains downstream risk gates. Records `meta.aiSetup` for audits. No model architecture or risk threshold changes.
- Fixed icForwardCheck id+ts cursor, legacy unverifiable ledger repair, and elapsed-time expiry. Forward statistics may drop after invalid/expired evidence is removed; do not relabel that as a model regression or force trusted=true.
- Added model-only monochrome evidence panel with server roster status/reasons, weights and measured validation values. Existing polling, no new network requests/timers, no sidebar/other page style changes. Keyed nodes preserve disclosures during refresh.
- Tests: all 92 `tools/check-*.mjs` passed with PYTHONUTF8=1, NODE_NO_WARNINGS=1. New real-function regression is wired into deploy.yml. `git diff --check` passed. Browser local checks 390x844 / 820x1180 / desktop1262: no horizontal overflow; 13 model cards render; native details remain open across refresh. Preview only proxies read-only allowlisted production APIs; nonallowlisted preview503s are not app failures.
- Deploy run34365326410 succeeded for ab4e950. Live browser build V33.329, 13 model cards; 390/820/1366px widths no overflow. Forced evidence refresh preserved same DOM node, open=true, focus=true, scrollDelta=0. Final tablet grid refined to two277.5px columns /586px panel height; phone remains312px single column. Full92 gates passed again after sizing refinement.
- Authorized serial retrains on deployed V33.329: XALPHA34365561250, DUAL34365640535, STACK34365908600, FLOW34365985009 — all success. Verified actual live model timestamps, not just workflow conclusions. DUAL bull/bear now provisional×0.25 with holdout t4.269/5.818 (was pending from25day/2effective blocks); genuine forward0/400 still required for full. FLOW/XALPHA/STACK now70day/7effective blocks but reject at t0.448/0.296/-0.934. Old FLOW/XALPHA unverifiable4000-row forward ledgers correctly reset to0. Model shape selection remains evidence-driven: STACK lin selected over gbdt/mlp/blend; none passed holdout. SEQ remains provisional; MEMO remains reject, not retrained in this targeted pass.
- ai-mode uses20s SWR and can return the prior snapshot immediately after training; re-read after refresh and compare model ts with training logs before claiming current state. Latest verified ts: FLOW1788965286885, XALPHA1788965059382, STACK1788965252443, DUAL bull1788965139961/bear1788965201838.
- No secret, binding, cron, schema migration, model upload route or manual order changes. Previous Claude work preserved below.

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

### V33.328 추가 — 표본 표 4종의 '구 판 정리' 누락
`ml_samples` 에만 구 featVer 정리가 있었다. `flow_samples`·`xalpha_samples`·`stack_samples`·
`ml_samples_st` 는 판이 올라가도 옛 행이 영영 남았다. 모든 조회가 `WHERE featver = 현재판` 이라
★학습에는 안 읽히지만★, 그 죽은 행이 D1 과 (featver, ts) 인덱스를 채워 새 표본이 자랄 자리를 잠식한다.
야간 수확 끝에 표당 5만행×2배치 정리를 추가했다 — 읽히지 않는 행만 지우므로 모델 동작은 안 바뀐다.
게이트는 ★표 목록에서★ 확인한다(새 표본 표를 만들며 정리를 빠뜨리면 걸린다).
`_altPrune` 에서 stack_samples 를 빼 보고 게이트가 지목하는지 확인했다.

### 확인했으나 손대지 않은 것(문제가 아니었다)
- `/api/reset` 이 `deposits` 를 `{us:0,kr:0}` 로만 심어 `cm` 이 빠지지만, 읽는 쪽이
  `typeof deposits[market] === "number" ? … : 0` 이라 리셋 직후 정답(0)과 같다. `twr:cm` 도
  `applyCashflowToTWR` 이 없으면 스스로 초기화한다. 증상이 없어 그대로 뒀다.
- 매도 원장 원자성은 V33.129 에서 이미 해결돼 있었다(`stmtRecordTradeIfPos` + 배치, 게이트 있음).
  매도 3경로 모두 이 경로를 쓴다 — 다시 손대지 않았다.

### V33.328 추가 — 슬리브별 초기자본 표가 세 벌이었고 ★둘이 틀렸다★
같은 표를 세 곳이 각자 갖고 있었다.
- `computeCashFromTrades` — 5종 전부 맞음(유일하게 옳았다).
- `applyCashflowToTWR` — `us/kr/cm` 삼항이라 **bdus·bdkr 이 cm($100,000)으로 떨어졌다**.
  bdkr 은 원화 ₩100,000,000 이다 — 통화가 다른데 1,000배 어긋난 값으로 TWR 이 시작된다.
- `auditAccounting` — 숫자를 통째로 박아(100000 / 100000000) `cfg` 를 아예 안 봤다.
  설정에서 초기자본을 바꾸면 `ASSET_INFLATE` 문턱이 같이 안 움직인다. 문턱을 넘으면
  자가치유가 현금 체크포인트를 지워 원장 전체를 다시 합산한다 — 매 사이클 그러면 CPU 를 태운다.

**지금은 둘 다 us/kr 로만 불려 증상이 없다.** 그래서 더 합쳐 둘 값어치가 있다 —
채권 슬리브가 그 경로에 들어오는 날 조용히 틀린 값이 나온다. `_initialCashFor(cfg, market)`
한 곳으로 합치고, `auditAccounting` 에 `cfg` 를 넘겼다(안 넘어오면 종전 값으로 폴백 — 동작 불변).
게이트는 함수를 실제로 돌려 슬리브 5종이 각자 제 금액을 받는지 확인하고,
TWR 초기화가 다시 삼항으로 돌아가면 실패한다.

## Current handoff — V33.330 (프리·애프터마켓 실측 점검)

사용자 요청: "주식들 등락율 정규장 끝나고 에프터마켓이랑 프리마켓이랑 제대로 작동하고 있는지 살펴봐라".

점검 시각이 마침 ★두 시간외가 동시에 열린 창★ 이었다 — 2026-09-09 19:45 ET(미국 애프터마켓)
= 2026-09-10 08:45 KST(한국 프리마켓). 프로덕션 `/api/state`·`/api/watchlist` 를 떠서 실측했다.

### 한국 프리마켓 — 정상
`mstate=PRE`, `prePct` 가 실제 체결이 있는 종목에 채워지고 `dayPct` 가 프리 값으로 덮인다.
`regPct=0`(정규장 미개장)도 맞다. 예: OCI −0.87 · NHN −1.21 · 넥스틴 +1.90 · 동화기업 −1.38.
체결이 없는 종목은 `prePct=None`·`dayPct=0` — 지어내지 않는다. 네이버 경로는 제대로 돈다.

### 미국 애프터마켓 — ★값이 안 들어온다★
같은 시각 미국 종목은 이랬다(quote ts 19:46 ET — 갱신은 2분 전, 즉 죽은 게 아니다):
```
GOOGL  mstate "POST"   post null   postPct null
       dispPct = regPct = -2.2786   ← 정규장 종가 등락 그대로
GOOG   mstate "POST"   post null   postPct null
```
세션 판정(POST)은 맞는데 가격이 없다. 표시 계층은 정상 동작해 정규장 값으로 떨어지는데,
그 결과 ★시간외에 크게 움직여도 "아무 일 없었다" 로 읽힌다★. 틀린 수치가 아니라 틀린 인상이라
눈으로 못 잡는다. 한국이 같은 시각 정상인 것이 대조군이다 — 표시가 아니라 미국 수집 경로 문제다.

**어느 경로가 값을 넣는지**: 미국 시간외는 v7 quote 의 `preMarket*`/`postMarket*` 에서만 온다.
v8 폴백(`fetchQuoteViaChart`)은 `meta.regularMarketPrice`(장 마감 후엔 정규장 종가)와
일봉 마지막 종가를 비교하는데 장후엔 두 값이 같아 ★구조적으로 시간외를 만들 수 없다★.
그런데 지금 mstate 가 "POST" 로 갱신돼 있다 = v7 이 응답은 하고 있다는 뜻이다
(v8 경로였다면 장중에 찍힌 "REGULAR" 가 그대로 남아 있어야 한다).
즉 **야후 v7 이 marketState 는 주면서 postMarketPrice 를 안 준다.**

### 고친 것
1. **`saveQuote` 가 시간외 5필드를 통째로 날렸다** — `setState` 로 quote 를 전부 덮어쓰는데
   필드 목록에 `mstate/pre/prePct/post/postPct` 가 없었다. 가격 샤드가 COALESCE 로 지켜 온
   값이 이 경로 한 번에 사라진다. 지금은 수동 `POST /api/refresh_quotes` 에서만 불려 증상이
   드물지만, 한 번 불리면 그 시장 전 종목의 시간외 표시가 다음 샤드 갱신까지 빈다.
   → 새 값이 있으면 쓰고 없으면 기존값을 이어받게 했다.
2. **`refreshQuotesOnly` 가 계산해 둔 값을 버렸다** — `fetchQuoteViaChart` 는 미국 시간외를
   이미 계산해 돌려주는데, 호출부가 손으로 필드를 골라 담느라 그게 빠졌다. → 그대로 넘긴다.
3. **감지기 신설(핵심)** — 이걸 오래 못 잡은 진짜 이유는 감지기가 없어서다.
   `v7Dead` 는 계산만 하고 ★한 번도 안 읽는다★ — 미국 수집원이 죽어도 아무 신호가 없다.
   자가진단에 "세션은 PRE/POST 라는데 그 값이 비었다" 를 넣었다(미국 20종목 이상이 같은
   세션인데 값 있는 종목이 10% 미만일 때만 warn — 표본이 적으면 우연으로 보고 넘긴다).

### 게이트
`tools/check-overmarket.mjs` 신설(deploy.yml 배선). 문자열 대조가 아니라 함수를 꺼내 돌린다:
표시 규칙 4종(프리/애프터/값없는POST/정규장) · 저장 경로 보존과 갱신 · 감지기 판정식 ·
한국 시간외 창과 네이버 하락부호(4·5). 되돌림 두 가지(보존 삭제·감지기 무력화)를 실제로
넣어 게이트가 지목하는 것을 확인한 뒤 원복했다. 게이트 93개 전부 통과.

### ★사용자 판단이 필요하다★ — 미국 시간외 가격을 실제로 되찾는 방법
지금 고친 것은 "값이 비면 지어내지 않고, 비었다는 사실을 소리 낸다" 까지다.
값 자체를 되찾으려면 수집원을 손대야 하고 그건 subrequest 예산이 든다:
- (ㄱ) v7 호출에 `fields=` 를 명시해 preMarket*/postMarket* 를 직접 요구한다 — 추가 호출 0.
  야후가 기본 필드셋을 줄인 것이라면 이걸로 해결된다. 가장 싸다.
- (ㄴ) 시간외에만 `interval=1m&range=1d&includePrePost=true` 차트를 보유·관심 종목에 한해
  돌린다 — 확실하지만 종목당 1 subrequest.
- (ㄷ) 그대로 두고 화면에 "시간외 시세 없음" 을 명시한다.
(ㄱ)을 먼저 시도하고 안 되면 (ㄴ)을 보유종목으로 좁히는 것을 권한다. 지시를 주면 그대로 한다.

## Current handoff — V33.331 (시간외 시세 복구 + 서머타임 자동화 + 시간외 거래)

사용자 지시: "실시간으로 에프터랑 프리 가격 들어오게 하고, 서머타임 적용 같은거도 자동으로
고려하게 하고, 거래도 정규장 뿐만 아니라 에프터랑 프리에서도 하게 만들어".

### ① 시간외 가격 — 두 겹으로 복구
V33.330 실측에서 미국은 `mstate=POST` 인데 `post` 가 전부 null 이었다. 원인은 두 가지였고 둘 다 고쳤다.
- **v7 에 안 물어봤다.** `fields=` 없이 호출하면 야후는 기본 필드셋만 주고, 그 기본셋이 계속
  좁아져 왔다. `preMarketPrice`·`postMarketPrice` 등을 ★명시적으로★ 요구한다.
  `fields=` 자체를 거부하는 환경을 대비해, 첫 배치가 0건이면 필드 없이 한 번 더 본 뒤에야
  v7 사망으로 판정한다(있는 길을 스스로 닫지 않는다).
- **v8 폴백은 구조적으로 시간외를 못 만든다.** 일봉엔 시간외 체결이 안 들어가고
  `meta.regularMarketPrice` 는 마감 후 정규장 종가라 "차이 없음"이 된다.
  → `fetchExtendedQuoteUS()` 신설: `interval=5m&range=1d&includePrePost=true` 분봉에서
  `currentTradingPeriod` 의 pre/post 구간에 속한 마지막 체결을 직접 뽑는다.
  프리는 전일종가 대비, 애프터는 정규장 종가 대비로 계산한다(야후 표기와 같은 규칙).
  종목당 1 subrequest 라 ①미국 시간외 창일 때만 ②값이 실제로 빈 종목만
  ③보유종목 우선·나머지는 회전하며 상한(기본 24)까지만 돌린다.

**관측**: `yahoo_v7` 상태를 기록하고 자가진단이 읽는다. 종전엔 `v7Dead` 를 계산만 하고
한 번도 안 읽어 1차 수집원이 죽어도 아무 신호가 없었다 — 이번 결측을 오래 못 본 이유다.
v7 사망은 곧 시간외 전면 결측이라 `error` 로 올린다.

### ② 서머타임 — 손계산에서 표준시 DB로
`getUSEtOffset` 은 "2007년 이후 미국 규칙(3월 2째 일요일~11월 1째 일요일)"을 코드로 옮긴
손계산이었다. 규칙이 바뀌면 조용히 틀린다(미국은 상시 서머타임 법안이 반복 발의된다).
→ `Intl.DateTimeFormat` 의 IANA 표준시 데이터(`America/New_York`)에 먼저 묻고,
실패할 때만 기존 손계산으로 내려간다. 포매터와 분 단위 결과를 캐시한다.
게이트가 2026~2028 봄·가을 전환 경계 9건을 실측 확인한다.

### ③ 시간외 거래 — fastWatch 가 집행한다
메인 사이클의 무거운 평가(일봉 라운드로빈·전종목 위원회)는 시간외에 돌리지 않는다.
대신 이미 보유종목만 도는 경량 경로(`runFastWatch`)를 시간외 집행기로 쓴다.
- **청산**: 시간외 체결가로 판단한다. 값이 없거나 가드에 걸리면 그 종목은 건너뛴다.
  ★정규장 가격으로 떨어지지 않는다★ — 그건 "16시 값으로 20시에 손절"이라 규칙이 거짓말을 한다.
- **진입**: 그날 위원회가 `minPickP`(0.62) 이상으로 본 종목에서만. 시간외에 새 판단을
  내리지 않는다. 크기는 `sizeMult`(0.5)배, 세션당 `maxNewPerSession`(2)종목까지.
- **가드**(`extTradePrice`): 값 없음 / 7분 초과 노후 / 변동 12% 초과 / 3달러 미만 → 거래 안 함.
- **정규장 상한을 그대로 지킨다**: 이 경로는 메인 루프 밖이라 동시보유(`maxConcurrent`)·현금·
  중복매수를 직접 센다. 보유 수를 못 세면 사지 않는다(모르면 쉰다).
- `fastWatch` 가 시간외 세션을 스스로 판정한다 — 메인 사이클이 한 번 걸러져
  `fastwatch:markets` 가 낡아도 시간외 감시가 쉬지 않는다(사고가 나는 시간대다).
- **되돌리기**: `cfg.extTrade.enabled=false` 로 통째로, `entries=false` 로 청산만,
  `us.post=false` 처럼 세션별로도 끌 수 있다. 게이트가 이 스위치들이 실제로 먹는지 확인한다.

### 게이트
`tools/check-ext-trading.mjs` 신설(deploy.yml 배선) — 함수를 꺼내 돌린다.
DST 경계 9건 · 세션 판정 9종 · 가격 가드 7종 · 분봉 추출 2종 · v7 필드 3종 · 집행 12종.
되돌림 세 가지(가격이 정규장으로 떨어짐 · 표준시 DB 조회 삭제 · 청산이 정규장 가격 사용)를
실제로 넣어 게이트가 지목하는 것을 확인한 뒤 원복했다. 게이트 94개 전부 통과.
기존 `check-order` 가 "yahoo_v7 을 쓰기만 하고 안 읽는다"를 잡아 줘서 자가진단 연결을 마쳤다.

### 배포 후 확인할 것
미국 애프터(16:00~20:00 ET)나 프리(07:00~09:30 ET)에 `/api/watchlist` 를 떠서
`post`/`postPct` 가 실제로 채워지는지 본다. 여전히 비면 v7 이 필드를 끝내 안 주는 것이므로
분봉 폴백이 도는지(`yahoo_v7.dead`, 자가진단 "시간외" 경고)로 갈라 본다.

## Current handoff — V33.332 (DMA·스토캐스틱 추가 + 시간외 전 종목 거래)

사용자 지시: "DMA 지표랑 스토캐스틱 스무딩 지표도 추가해라 / 에프터랑 프리 제대로 들고 오고
있는지 확인도 해 / 시간외 거래 전 종목에서 할 수 있게 만들어 정규장이랑 똑같이".

### ① 지표 두 개 추가
- **`getDMA(closes, 10, 50, 10)`** — 국내 HTS 표준형 **이동평균 차이**.
  DMA선 = MA(단기) − MA(장기), AMA선(시그널) = DMA선의 이동평균. 가격으로 나눠 %정규화한다
  (안 하면 30만원짜리와 3달러짜리를 같은 잣대로 못 본다 — 위원회는 종목을 섞어 본다).
  ※ 'DMA' 는 Displaced MA(이동평균을 N봉 밀어 놓은 것)를 뜻하기도 한다. 스토캐스틱과 같이
    쓰이는 지표라는 맥락으로 보아 **이동평균 차이** 로 구현했다. 다른 쪽을 의도했다면 알려 달라.
- **`getStochSlow(highs, lows, closes, 14, 3, 3)`** — 스토캐스틱 **슬로우(스무딩)**.
  Fast %K → 평활(kSmooth) = Slow %K → 평활(dSmooth) = Slow %D. 이 평활이 '스무딩'의 전부다.
  Fast 를 그대로 쓰면 하루 노이즈로 과매수/과매도가 번갈아 켜져 못 쓴다.
  고가·저가가 없으면 종가로 근사한다. 고가=저가(상하한·거래정지)면 0으로 안 나누고 중립 50.

**배선**: `taPredictDirection`(기술 컨센서스)에 넣었다. 가중치는 설정으로 뺐다
(`dmaW 0.4 · dmaCrossW 0.3 · stochW 0.25 · stochCrossW 0.45`).
**최대 0.45 로 기존 최대(MA기울기 0.9)보다 작게 잡았다** — 지표는 늘리되 판단의 무게중심은
옮기지 않는다. 스토캐스틱은 수준보다 교차에 큰 가중을 준다(추세장에선 80 이상에 계속 붙어
있으므로 단순 과매수를 크게 깎으면 상승 추세를 계속 거스른다).

**ML 피처 벡터에는 넣지 않았다.** 넣으면 `featVer` 가 올라가 학습표본이 전부 죽고 위원 전원이
처음부터 재학습한다(회복에 몇 주). 화면에는 `/api/ta-explain` 의 `extra` 로 따로 내려
TA 패널에 DMA·스토캐스틱 칸으로 붙는다. 피처 편입은 별도 판단이 필요하다.

### ② 프리·애프터 확인 — ★아직 확정 못 한다★
V33.331 배포가 **20:16 ET 에 끝났고 애프터마켓은 20:00 에 닫혔다.** 새 코드가 시간외에
한 번도 안 돌았다. 배포 직후 자가진단은 이렇게 말했다:
```
미국 시간외 시세가 안 들어온다 — 세션 표시 336종목 중 값이 있는 건 2종목뿐
```
0 → 2 로 늘긴 했지만 세션이 끝난 뒤의 잔상이라 근거가 못 된다.
**다음 미국 프리마켓(07:00~09:30 ET = 11:00~13:30 UTC)에 다시 떠서 확인해야 한다.**
확인 지점: `/api/watchlist` 의 `post`/`pre` 채움 비율, 자가진단 "시간외" 경고 소멸 여부,
`yahoo_v7.fields`(true 면 fields 지정이 먹은 것), `yahoo_v7.dead`.

### ③ 시간외 거래 — 전 종목으로 확대
종전엔 시간외에 메인 사이클이 `extOnly` 에서 통째로 빠져나가고, fastWatch 가 보는
"보유종목 + 그날 픽" 에만 거래가 걸렸다. 이제 **유니버스 전체를 정규장과 같은 경로로 평가·거래**한다.
- 시간외 세션이면 `extOnly` 에서 빠져나가지 않고 평가 루프를 그대로 돈다
  (위원회·게이트·히트·동시보유 전부 정규장과 동일하게 적용된다).
- **가격은 시간외 체결가**(`extTradePrice`). 값이 없거나 가드에 걸린 종목은 평가에서 뺀다 —
  시간외에 체결이 없는 종목이 대부분이라 이게 정상이고, 제외 개수를 prefetch 로그에 남긴다.
- `prevClose` 는 두 세션 모두 **전일 정규장 종가**를 쓴다 → `dayPct` 가 "어제 종가 대비 누적
  변동"이라는 평소 의미를 그대로 유지한다.
- **일봉 라운드로빈은 돌리지 않는다** — 시간외에 봉은 안 변한다. 회전 위치(`rr_idx`)도
  전진시키지 않는다(전진시키면 정규장 순회에 구멍이 난다). 캐시된 일봉으로 평가한다.
  이게 시간외 확대의 fetch 비용을 대부분 막아 준다.
- **fastWatch 의 픽 진입은 기본 off (`fastEntries: false`)** — 메인이 전 종목을 맡은 지금
  둘 다 켜면 같은 종목을 두 경로가 각각 사는 길이 된다(메인이 분 0에 사고, 같은 분의
  fastWatch 는 매수 전 포지션 스냅샷을 들고 또 산다). fastWatch 의 **청산**은 그대로 둔다 —
  분 단위보다 빠른 반응은 시간외에 더 필요하다.

**비용**: 시간외 거래 창은 미국 5.5h + 한국 5.5h/일이다. 평가가 그만큼 늘어난다.
일봉 fetch 를 뺐고 시간외 평가는 2분 주기(기존 `extOnly` 격분 스킵 유지)라 fetch 는 크게
안 늘지만 **CPU 는 늘어난다.** 사용량 가드(`isUsageShutdown`)가 최종 방어선이다.
며칠 `[EVAL-COST]`·사용량 지표를 보고 필요하면 시간외 평가 주기를 3~5분으로 늘리는 게 맞다.

### 게이트
- `tools/check-indicators.mjs` 신설 — 수식이 아니라 **성질**을 검사한다. 추세 방향과 부호,
  가격 1,000배에도 같은 %정규화, 골든/데드 교차를 실제 계열에서 잡아내는지, **슬로우가 정말
  평활되는지(fast 변동 29.5 → slow 22.7)**, 고가=저가에서 0으로 안 나누는지,
  그리고 **새 지표 가중이 기존 최대를 넘지 않는지**.
  ※ 처음엔 교차 검사 창을 e=100 부터 잡았는데 교차는 e=92 에 이미 있었다 — "신호가 없다"고
    잘못 읽을 뻔했다. 계산 가능한 전 구간(e=61~)을 훑도록 고쳤다.
- `check-ext-trading.mjs` 확장 — 메인 사이클의 시간외 전 종목 경로 5항목 추가.
- 게이트 95개 전부 통과.

## Current handoff — V33.334 (DMA·스토캐스틱 피처 통합 — ★표본을 버리지 않고★)

사용자 지시: "피처 통합하는데 이거 학습표본 안 죽게 기존에 있는 데이터로 dma 스토캐스틱
전부 계산해서 학습표본에 넣은다음에 학습시켜 모델들 안죽게 잘처리해봐".

### 무엇이 문제였나
이 저장소의 종전 방식은 **featVer 를 올리고 옛 표본을 버린 뒤 딥이력에서 재수확**이었다
(V33.239 65→69, V33.265 69→75 모두 그랬다). 되긴 하지만 **며칠 동안 위원 전원이 굶는다** —
표본이 0 에서 다시 자라기 때문이다. 이번엔 지우지 않고 **제자리 이관**한다.

가능한 이유: DMA·스토캐스틱은 **순수 OHLC 파생**이라 그 시점 값을 일봉 이력에서 정확히
되계산할 수 있다. 옵션 체인처럼 "지금만 알 수 있는" 값이 아니다.

### 피처 5종 (75 → 80, featVer 15 → 16)
`dmaPct` · `dmaGap` · `stochSlowK` · `stochSlowD` · `dsKnown`.
**반드시 featNames 의 꼬리에 붙였다** — 중간에 끼우면 앞 75칸 인덱스가 전부 밀려
기존 표본의 의미가 통째로 어긋난다(되돌릴 수 없다). `dsKnown` 은 **결측 표식**이다
(`fomcKnown` 과 같은 규율) — 이력을 못 찾은 표본은 중립값 + 0 으로 두어 모델이
"모른다"를 구분해 배우게 한다.

### 이관 (`mlFeatMigrate`)
- `ml_samples` · `ml_samples_st` 를 id 순으로 훑으며, 표본 `ts` 로 일봉 캐시의 `days`
  (에폭 이후 일수) 배열에서 봉 위치를 찾아 그 시점까지의 이력으로 지표를 되계산해 꼬리에 덧붙인다.
- 봉을 못 찾거나 이력이 61봉 미만이면 **버리지 않고** 중립 + `dsKnown=0`.
- **크론 매 분 9초씩** 민다(밤에 한 번이 아니라). featVer 를 올린 순간부터 학습은 새 판만
  보므로 이관이 늦을수록 위원이 굶는다. 끝나면 상태 1건만 읽고 즉시 빠져나온다.
- 소급 복원이 두 단계가 되어 `_calBackfillX` 를 `_featBackfillX(x, ts, dsVals)` 로 통합했다:
  D−11칸(달력·DS 둘 다 없음) → 달력 6 + DS 5, D−5칸 → DS 5. **한 함수가 두 경우를 다 안다** —
  판마다 복원기를 새로 만들면 "같은 규칙이 두 곳에 살다 한쪽만 고쳐지는" 사고가 재현된다.

### ★모델이 죽지 않게 한 세 가지 잠금★
1. **구판 정리 정지** — 야간 정리(`DELETE … WHERE featver != ?`)는 밤마다 30만 건을 지운다.
   이관 대상이 바로 그 행들이다. `mlFeatMigPending()` 을 먼저 물어보고, **모르면 안 지운다**.
   V33.328 의 alt 표 정리(`_altPrune`, ml_samples_st 포함)도 같은 조건에 걸었다.
2. **야간 학습 보류** — 이관 도중 학습하면 "지금까지 옮겨진 몇 만 건"만 보고 배운 뒤
   정확도가 낮게 나와 **신뢰게이트가 모델을 강등**시킨다. 데이터는 멀쩡한데 위원이 내려앉는다.
   기존 가중치를 그대로 두고 이관 완료 후 재개한다.
3. **Modal 트레이너는 손댈 필요 없었다** — `xn = len(featNames)` 로 서버가 알려주는 폭을
   따라간다(V33.255 설계). 80칸을 그대로 받는다.

### 게이트
`tools/check-featmig.mjs` 신설 — **가짜 DB 로 이관을 실제로 돌린다**. 표본 50건(이력 있음 40 +
없음 10)을 넣고: 전후 개수 동일 · 전부 featVer 16 · 전부 80칸 · 실측 40/중립 10 구분 · 완료 마감.
되돌림 두 가지(구판 정리 가드 무력화 · 새 칸을 앞에 붙이기)를 넣어 잡히는 것 확인.

기존 게이트 셋이 판갈이 부작용을 잡아 줘서 함께 고쳤다:
- `check-cal-backfill` — 달력이 더는 꼬리가 아니다. 위치 산수를 갱신하고, "달력까지 있는 판에
  달력을 두 번 붙이지 않는가" 검사를 추가했다.
- `check-calendar-feats` — featVer 15·75종을 **숫자로 박아** 두어 판이 오를 때마다 무관하게 깨졌다.
  "피처가 늘면 featVer 도 함께 오른다"는 **관계**로 바꿨다.
- `check-bandit-memo` — 피처가 75→80 이 되자 우연히 살아남는 잡음축이 하나 더 생겨 깨졌다.
  실제 가중은 0.02(신호축 1.00·0.81·0.74)로 잡음바닥은 멀쩡했다. **개수가 아니라 무게**로
  보도록 바꿨다(0.05 초과 잡음축 0개) — V33.273 사고(잡음축 0.2~0.5)는 이 잣대로 즉시 걸린다.

### 배포 후 확인
`[FEATMIG]` 로그로 진행을 본다. 완료되면 "★이관 완료★ featVer 16 — 구판 정리 재개" 가 한 번 찍힌다.
표본 총량이 이관 전후로 유지되는지(`/api/ml-status` 의 표본 수)를 확인할 것.
이관이 끝난 다음 밤부터 위원회가 80칸으로 다시 배운다.

## Current handoff — V33.335 (DMA 를 Displaced MA 로 바로잡음 + 이관 결함 3건 수정)

사용자: "displaced ma 말한거였는데 그리고 피쳐 문제 없는지 다시 확인해봐".
재점검에서 **실제 결함 3건**을 찾았다. 하나는 학습 데이터를 조용히 오염시킬 뻔했다.

### ① DMA 정의 교정 — 이동평균 차이 → **Displaced MA**
V33.332/334 는 국내 HTS 의 '이동평균 차이(DMA−AMA)'로 구현했었다. 사용자가 말한 것은
**이동평균선을 N봉 앞으로 민 선**이다.
- `getDisplacedMA(closes, 20, +5)`: 봉 i 의 값 = MA(20) 을 봉 (i−5) 에서 계산한 값.
- **앞(오른쪽)으로만 민다** — 뒤로 미는 변형은 미래를 참조하므로 학습에 쓰면 누출이다.
  게이트가 "현재 봉 종가를 바꿔도 선 값이 안 변한다"로 이 성질을 못박는다.
- 피처 이름도 정직하게 바꿨다: `dmaPct/dmaGap` → **`dispMaPct`**(가격이 선보다 몇 % 위/아래)
  · **`dispMaSlope`**(선 자체의 기울기 %/봉).

### ② ★표본의 ts 로 봉을 찾으면 안 됐다★ — 가장 위험했던 결함
수확 표본의 `ts` 는 실제 날짜가 아니다. 소스에 그렇게 적혀 있다:
```
// ts는 봉 시점 근사(일봉 1개=1일)로 역산
const ts = baseTs - (L - 1 - i) * 86400000;
```
주말·휴장을 세지 않으므로 **100봉 전 표본의 ts 는 실제 날짜보다 몇 주 앞선다.**
V33.334 의 이관은 그 ts 로 일봉을 찾았다 — 엉뚱한 봉의 지표를 `dsKnown=1`(실측)이라고
붙이게 된다. 중립으로 두는 것보다 나쁘다: 모델이 거짓을 진짜 관측값으로 배운다.

→ **내용으로 찾는다.** 저장된 벡터에 `dayPct·ret5·ret20` 이 들어 있고, 셋 다 종가만으로
정해지며 클램프도 없어 이력에서 그대로 재현된다. 세 값이 일치하는 봉이 그 봉이다.
둘 이상이 일치하면 애매하므로 쓰지 않는다(`-1` → 중립).
부수 효과로 **딥이력(hist:, 최대 2400봉)을 쓸 수 있게 됐다** — `days` 배열이 필요 없어졌기
때문이다. 종전 `daily:` 는 320봉(~15개월)뿐이라 오래된 표본을 대부분 못 덮었을 것이다.

### ③ 고가·저가가 어긋나면 스토캐스틱이 조용히 종가근사로 떨어졌다
`getStochSlow` 는 highs/lows 길이가 안 맞으면 종가로 대체한다. 그 값은 진짜 스토캐스틱과
**분포가 다르다** — 섞어서 학습하면 같은 칸에 다른 지표 둘을 밀어 넣는 셈이다.
→ 정렬이 안 맞으면 `dsKnown=0`. 실측이라고 하지 않는다.

### 그 밖에 확인하고 문제없던 것
- `mlBuildFeatures` 호출부 **12곳 전부** highs/lows 를 넘긴다 — 수확·라이브 스큐 없음.
- Modal 트레이너는 `xn = len(featNames)` 로 폭을 따라간다 — 손댈 필요 없음.
- 이관 종목 캐시에 상한(6종목)을 넣었다. 딥이력(2400봉×배열 3개)+앵커맵을 종목마다 들고
  있으면 한 호출에서 수십 MB 가 되어 아이솔레이트(128MB)를 위협한다. 행이 id 순이라
  같은 종목이 몰려 있어 작은 캐시로도 적중률이 높다.

### featVer 16 → 17, 전량 재각인
V33.334 가 붙인 값은 정의가 다르고 봉도 틀렸을 수 있으므로 **다시 각인해야 한다.**
`_featBackfillX` 가 이미 현재 폭인 벡터도 처리한다 — **값을 주면 꼬리를 갈아 끼우고,
안 주면 그대로 둔다**(내보내기 경로가 실값을 중립으로 덮어쓰지 않게).
이관 질의를 `featver <> 현재판` 으로 바꿔 15칸판·16칸판을 함께 처리한다.
구판 정리·야간 학습 정지는 V33.334 그대로 유지된다 — 재각인이 끝날 때까지 표본은 보존된다.

게이트 97개 전부 통과.

## Current handoff — V33.336 (차트 지표 버튼 + 3차 피처 점검)

사용자: "dma랑 스토캐스팅 스무딩선 종목 상세 그래프 위에 그려질수 있는 버튼 만들어
ma, boll지표 처럼 그리고 한번더 피쳐 점검해".

### ① 차트 지표 버튼 — DMA · STOCH
- **DMA** — 가격 패널에 ★점선★ 으로 그린다. 일반 MA 와 같은 실선이면 "MA 가 하나 더 있네"로
  읽히고 밀어놓은 선인 줄 모른다. 범례도 `DMA20+5` 로 적어 +5봉 이동을 못박는다.
  MA 와 같은 clip·y범위 규칙을 따른다 — 확대했을 때 먼 DMA 가 축을 끌지 않는다.
- **STOCH** — RSI·MACD 처럼 서브패널. %K(실선)·%D(점선), 20/50/80 밴드,
  과매수·과매도 구간을 옅게 칠했다.
- 기본은 **꺼짐** — 화면이 갑자기 복잡해지지 않게. 켰을 때만 계산한다(끈 지표를 매 프레임
  계산하면 드래그가 버벅인다). 지표 캐시 서명에 두 토글을 넣어 켜고 끌 때 옛 캐시를 안 쓴다.
- **게이트가 화면과 엔진을 교차 검증한다**: 설정(20,+5 / 14,3,3)이 서버 `DS_PARAMS` 와 같은지,
  화면이 그린 마지막 값이 서버 `getDisplacedMA`·`getStochSlow` 와 소수점까지 같은지.
  지표가 두 곳(브라우저·워커)에 구현돼 있어 갈라지기 쉬운 자리다.

### ② 3차 점검에서 찾은 것 — ★라이브 표본이 통째로 '모름'이 될 뻔했다★
V33.335 는 봉을 **내용 앵커**(dayPct·ret5·ret20)로 찾게 고쳤다. 그런데 다시 보니
**그 앵커는 수확 표본에만 맞는다**:
- 수확: `price = closes[L-1]` 로 ret5·ret20 을 계산한다 → 이력에서 그대로 재현된다.
- 라이브: `price = 그 순간의 호가` 로 계산한다 → **어떤 봉과도 안 맞는다.**

즉 라이브 표본은 전부 `dsKnown=0` 이 됐을 것이다. 하필 학습가중이 가장 높은
(`liveSrcWeight 1.5`) 표본들이다.

→ **두 갈래를 다 둔다.** 라이브 표본은 `ts` 가 진짜 날짜이므로(`Date.now()` 로 기록된다)
`daily:` 의 `days` 로 그 날 봉을 이진탐색해 찾는다. 표본이 이력보다 10일 이상 최근이면
쓰지 않는다(캐시가 낡았다는 뜻이라 엉뚱한 옛 봉을 붙이게 된다).
게이트에 라이브 표본 10건(앵커 불일치 + 진짜 ts)을 넣어 실제로 복구되는지 확인한다.
날짜 경로를 지우면 `0/10` 으로 즉시 걸린다.

### 점검하고 문제없던 것
- 앵커 세 값(`dayPct·ret5·ret20`)은 클램프가 없다 — `_mlStructFeats` 확인. 재현 가능.
- `sl(a, e)` 는 길이가 안 맞으면 `null` 을 준다 → `_hlOk` 가 그걸 받아 `dsKnown=0`.
  조용히 종가근사로 떨어지지 않는다(V33.335 에서 막은 경로가 실제로 작동).
- 딥이력(`hist:`)에는 `days` 가 없다. 그래서 앵커 경로는 딥이력, 날짜 경로는 `daily:` 로
  나눠 쓴다 — 두 배열의 인덱스가 다르므로 섞으면 안 된다.

게이트 97개 전부 통과.

## Current handoff — V33.337 (판 불일치·검증 미달 근본원인 — ★재시도할 기회가 없었다★)

사용자 화면(2026-09-10 10:35): 위원 좌석 **2/10**, **규칙엔진 비상운용**,
MIND·SEQ "판 불일치 — 재학습 대기", XGB·LGB·CAT "검증 미달 — 억제".

### 근본원인 두 가지 — 둘 다 V33.334~336 이 만든 것이다

**① `_stg` 가 "아직 준비 안 됨"에도 '오늘 완료' 도장을 찍었다.**
야간 파이프라인의 `_stg(nm, fn)` 은 함수가 무엇을 돌려주든 `ai_stage:<nm> = 오늘` 을 찍는다.
그래서 표본이 아직 모자라 물러난 단계는 **그날 다시 돌지 않는다.**
V33.334 가 `mlTrainNightly` 에 넣은 "이관 중 학습 보류"는 조용한 `return` 이었으므로
L1 이 그날 완료로 도장 찍혔고, MIND 도 `표본 N/M — 대기` 로 같은 길을 갔다.
→ **모델이 나쁜 게 아니라 다시 시도할 기회가 없었다.** 위원장이 빠지니 규칙엔진 비상운용.

이건 V33.334 만의 문제가 아니라 **원래 있던 함정**이다(V33.245 가 `_PIPE_VER` 로 featVer
바뀌면 도장을 지우게 해 뒀지만, 그 재실행 **한 번**이 표본 준비 전에 지나가면 끝이었다).

→ `_stg` 가 **"아직"과 "오늘 다 했음"을 구분**한다. 결과 문자열이 `⟳` 로 시작하면 완료 도장
대신 `<날짜>|wait|<시각>` 표식을 찍고, 12분 뒤 만료되면 같은 날 안에 스스로 다시 돈다.
표본 부족으로 물러나는 학습 단계 **12곳**(MIND·L1·BRAIN·GBDT·DNN·MEMO·BANDIT·SCAN·CAL 등)에
`⟳` 를 붙였다. "R2 없음"·"감성 없음" 처럼 **오늘은 할 일이 없는** 단계는 그대로 뒀다 —
그건 재시도해도 달라지지 않는다.

**② 이관이 ★오래된 표본부터★ 돌았다.**
학습은 최근 `trainWindow`(6만건)만 본다. 그런데 이관은 `id ASC` 라 **가장 오래된 것부터**
옮겼다 — 학습에 필요한 구간이 제일 마지막에 준비된다. 40만 건이면 몇 시간이고,
그동안 위원들은 "표본 부족"으로 대기한다.
→ `id DESC` 로 바꿨다. 몇 분 안에 학습창이 새 판으로 채워져 위원들이 곧바로 돌아온다.

### 외부 모델(SEQ·XGB·LGB·CAT)
`_luxAutoRetrainModal` 은 V33.245 부터 **현재 판과 일치하는 모델만 신선도에 센다** —
featVer 를 올리면 `anyExt=false` 가 되어 Modal 재학습을 스스로 건다.
다만 현재판 표본이 200건 미만이면 `insufficient_samples` 로 30분 뒤 재확인한다.
①②를 고치면 표본이 빨리 차므로 그 경로도 자연히 풀린다. **코드 수정은 필요 없었다.**

### 게이트에서 배운 것 — ★문장이 아니라 동작으로★
`_stg` 검사를 처음엔 "소스에 표식 문자열이 있는가"로 썼다. 그런데 분기를 `if(false)` 로
죽여도 문자열은 남아 **검사가 통과했다** — 헛도는 검사였다.
→ `_stg` 를 꺼내 **실제로 돌린다**: ⟳ 를 준 단계는 완료 도장이 안 찍히는가, 바로 다음 실행은
건너뛰는가, 표식이 만료되면 다시 도는가, 성공하면 그때 도장이 찍히는가, 완료된 단계는
그날 다시 안 도는가. 되돌림(분기 무력화)이 이제 즉시 잡힌다.
※ 추출 범위를 함수만 잡았다가 `_STG_RETRY_MS` 가 빠져 ReferenceError 가 `_stg` 자신의
  catch 에 삼켜졌다 — "재시도가 안 된다"로 잘못 읽을 뻔했다. 상수 선언까지 포함해 잘랐다.

`check-gate-anchors`(V33.328 메타검사)가 이번엔 **오탐**을 냈다: `indexOf(x) === 0` 은
자르기 앵커가 아니라 **접두사 검사**다. 제외 규칙에 추가하고 자가시험에도 넣었다.

게이트 97개 전부 통과.

## Current handoff — V33.338 (DNN 12층 → 4층 원인: 워커 폴백이 GPU 자리를 조용히 차지)

사용자: "dnn 또 12층에서 4층됐는데 수정해". **'또'** 가 핵심이다 — 판을 올릴 때마다 반복되는 구조다.

### 원인
- GPU 모델(Modal): `DNN.hidden = [640,512,384,256,192,128,96,64,48,32]` = **은닉 10층(총 12층)**,
  6시드·약 460만 파라미터.
- 워커 폴백: `DNNW.hidden = [128,64]` = **은닉 2층(총 4층)**, 넷당 1.7만 — GPU 망의 **1/46**.

featVer 를 올리면 외부 GPU 모델이 판 불일치로 빠지고, `mlDNNTrainNightly`(워커)가 새 판으로
자가학습해 **같은 자리(`dnn_model`/`dnn_trust`)를 차지한다.** 그런데 종전엔 그 사실이
**어디에도 안 적혔다** — 화면은 "DNN 정식 합류 · 신뢰 통과 ×0.69" 라고만 했고, 가중도 GPU 모델과
같은 식(MIND 와의 softmax)으로 계산됐다. 즉 **46배 작은 망이 실제 돈을 걸고 같은 목소리로 투표**했다.
사용자는 층수를 세어서 알아챘다 — 화면이 말해 줬어야 했다.

### 고친 것 세 가지
1. **폴백임을 기록한다** — `dnn_trust` 에 `source:"worker"` · `arch` · `hiddenLayers` · `params`.
   화면 이름도 "DNN (워커 폴백 · 은닉 2층)" 으로 바뀌고 tier 는 `provisional` 이 된다.
2. **가중을 깎는다** — `DNN.workerWeightMult = 0.5`. 0 으로 두면 판을 올릴 때마다 DNN 이 몇 시간
   통째로 빠지므로(V33.50 이 고친 '영구 학습대기'의 반대편 함정) 절반만 준다.
   이 저장소가 이미 쓰는 방식이다(`icPathWeightMult 0.35` · `fwdWeak 0.60`).
3. **12층을 빨리 되찾는다** — `_luxAutoRetrainModal` 의 8h 쿨다운을 **판당 한 번 건너뛴다**.
   종전엔 직전에 Modal 을 돌렸으면 쿨다운에 막혀, **가장 재학습이 급한 순간에 재학습이 가장
   확실히 잠겼다.** `meta.fvDispatched` 로 판별하고 **성공했을 때만 기록**한다(실패했는데
   기록하면 그 판에서 다시 시도할 길이 없어진다).

### ★게이트에서 진짜 버그를 찾았다 — 없는 위반 25건★
`.toLocaleString()` 한 줄을 추가하자 `check-pipeline-graph` 가 "순서 위반 25건"을 냈다.
코드가 아니라 **검사가 틀린 것**이었다:
`fnRanges()` 가 이름표를 `{}` 로 만들어, `R["toLocaleString"]` 이 **Object.prototype 의 메서드**를
돌려주며 "아는 함수" 로 잡혔다. 그러면 `ownChannels` 가 `R[fn][0]`·`[1]` 을 `undefined` 로 읽어
`lines.slice(undefined, undefined)` = **파일 전체**가 그 단계의 본문이 되고,
파일 안 모든 `setState` 가 그 단계의 산출물로 붙는다.
→ `Object.create(null)` 로 고치고, **자가시험**을 넣었다(toString·valueOf·constructor 등이
"아는 함수"로 잡히면 실패). `{}` 로 되돌리면 즉시 걸린다.
로그 문자열의 `toLocaleString()` 도 뺐다 — 같은 값이 환경에 따라 다르게 적힌다.

게이트 97개 전부 통과.

---

## V33.339 — 진단 스냅샷 처리: 판 불일치의 진짜 이름을 되찾고, 시간외 회전을 실제로 돌렸다

사용자가 운영 진단 스냅샷(`aistatus 2026-09-10T04:07:46Z`, 빌드 V33.338)을 올리며 "이거 해결해".
ERROR 1건 + WARN 7건이 있었고, 그중 **두 건은 증상 설명 자체가 틀려 있었다.**

### ① ★같은 세 모델을 두고 화면 세 곳이 다른 말을 했다★ (사용자가 앞서 지적한 "판 불일치")
스냅샷 실측:

| 보고처 | XGB 에 대해 |
|---|---|
| `aiMode.committee.xgb` | `trusted:true · promoted:true · w 0.4766` |
| `alt.roster.xgb` | `tier:"reject" · mult:0 · why "검증 미달 — 억제" · featVer **null**` |
| 실제 투표(`_boostersCached`) | **불참** — 위원회는 GBDT 한 명뿐(`committee.n = 1`) |
| 자가진단 | `XGB 미합류 accLB 51.46% (문턱 50.5%)` |

마지막 줄이 특히 나쁘다 — **문턱보다 높은 숫자를 미합류 사유로 적었다.** 그 문장을 믿으면
문턱을 만지러 간다. 진짜 이유는 넷 중 어디에도 없었다: XGB 21.5h · Cat 9.4h · LGB 3.5h 전
학습분이라 셋 다 `featVer 16` 이고, 판이 17 로 오른 건 그 뒤(V33.335, 01:14 UTC)다.
**판 불일치**였고 고칠 곳은 재학습이었다.

원인은 구조였다. 부스터 명단 행만 `featVerOk: true` 를 **박아 두고** 사유를 한 문장으로
뭉갰다 — 다른 위원(MIND·GBDT·FLOW·MEMO·SEQ)은 전부 "판 불일치 — 재학습 대기" 를 말할 수
있는데 **부스터 3종만 그 말을 할 수 없었다.** 그리고 `aiMode` 쪽은 `<nm>_trust.trusted`
(업로드 시점 도장)만 읽어, 그 뒤 판이 올라 실제로 빠진 모델을 계속 "가동 · w 0.4766" 이라 적었다.

→ `_boosterAdmit(live, ext)` 하나가 판정과 **사유**를 낸다. `_boostersCached` 가 그 함수를 부르고,
본문 확인까지 마친 결과를 `_boosterDiag(DB)` 로 내보낸다. 명단·`aiMode`·자가진단 **셋 다 그것만 읽는다.**
사유는 다섯 갈래로 갈린다: 모델 없음 / 판 불일치(16≠17) / 섀도우 미승격 / 승격 기록 미신뢰 /
검증 미달(실제 숫자와 함께). 스냅샷 값을 넣어 돌려 확인했다 — 세 보고처가 같은 문장을 낸다.

### ② ★committee_cal 이 featVer 15 에 박혀 있던 이유 — 준비 안 된 걸 '완료' 로 도장 찍었다★
경고: `committee_cal featVer 불일치(15≠17) — 확률 보정 무시 중`. 판이 15→16→17 로 올랐는데
보정은 15 에 머물렀다 = **두 판 동안 위원회 확률 보정이 통째로 꺼져 있었다**(읽는 쪽이 판
불일치 보정을 옳게 무시하므로).

`mlCalibrateCommittee` 의 이탈 경로 셋(`!mind` → `null`, 표본 <60, catch)이 **전부 재시도
신호(⟳)가 없었다.** 판이 오른 직후엔 새 판 표본이 아직 60건도 없다(이관 중) → "보정 대기" →
`_stg` 가 **오늘 할 일 끝**으로 도장 → 다음 UTC 자정까지 재시도 없음. 그 사이 판이 또 오르면 반복.
V33.337 이 12개 단계에 넣은 ⟳ 가 이 단계의 표본부족 경로만 비켜 갔다.
→ 셋 다 ⟳ 로 바꿨다. 같은 성질의 다른 단계 5곳도 함께(ANLREVK·CONFK·MIND-SHADOW·EXPREG·OPTX).

### ③ ★"세션 표시 336종목 중 값이 있는 건 2종목뿐" — 원인은 두 겹이었고 둘 다 우리 쪽이다★
- **회전이 안 돌았다.** 시간외 보강 커서가 `extOffset: shard * 7` — **샤드마다 상수**다.
  회전 상한(24종목)에 걸린 뒤로는 사이클마다 **같은 24종목**을 다시 물었고 나머지 수백 종목은
  차례가 오지 않았다. 가격 폴백은 상태에 저장한 커서(`qp_rr`)로 제대로 돌고 있었다 — **한쪽만 안 돌았다.**
  → `ext_rr:<시장>` 커서를 상태에 저장하고 시도한 만큼 전진시킨다.
- **세션 딱지가 굳었다.** `mstate` 를 야후 v7 이 줄 때만 갱신했다. v7 이 죽자 며칠 전 딱지가
  그대로 남고 `COALESCE` 보존이 그걸 계속 지켰다 — 화면은 **정규장 종가를 '장후 시세' 라고 말한다.**
  자가진단의 "336종목" 도 그 유령을 센 것이다.
  → 세션은 시각의 함수다(`getUSEt` = IANA, 서머타임 자동). `usMarketStateNow()` 로 우리가 찍고,
  `extKeepMaskUS()` 로 **지난 세션 값을 이어받지 않는다**(장전엔 어제 장후를, 정규장엔 둘 다 지운다.
  휴장 중엔 마지막 장후 체결가를 그대로 둔다 — 그게 최신 체결이다). 저장 경로 둘(`saveQuote`,
  가격 샤드 SQL) 다 같은 규칙을 지난다.

### ④ ERROR 문장이 자기 코드보다 낡아 있었다
`야후 v7 이 응답하지 않는다 — v8 폴백은 시간외를 못 만든다(시간외 시세 전면 결측)`.
**틀렸다.** V33.331 이 이미 v8 분봉(`includePrePost`)에서 프리·애프터를 만드는 경로
(`fetchExtendedQuoteUS`)를 넣었다. 진짜 손실은 다른 것이다 — v7 이 살아 있으면 50종목이
1 subrequest 인데 죽으면 **종목당 1 subrequest**(미국 558종목)가 되고, 그 예산 압박이 보강 회전을 느리게 한다.
→ 문장을 사실에 맞추고, `_v7ErrTag()` 로 **실패 사유(HTTP 상태·타임아웃·예산)** 를 상태에 남긴다.
인증(401/403)·요청형태(fields=)·과부하(429)는 처방이 전혀 다른데 종전엔 `dead:true` 뿐이었다.
덤으로 **지난번에 통한 방식을 기억한다**(fields 거부 환경에서 매 호출 버려지던 subrequest 하나 제거).
단 **사망 판정은 기억하지 않는다** — 야후가 되살아나며 필드셋을 복구할 길을 스스로 닫지 않는다.

### 게이트
- 신규 `check-committee-truth.mjs` — 판정 함수를 **실제로 돌려** 사유가 상황마다 갈리는지 본다
  (판 불일치 / 검증 미달 / 섀도우 / 없음 / 정상통과 / IC 경로). 돌연변이 3종으로 물리는 것 확인.
- 신규 `check-extquote-rotation.mjs` — 커서 저장·전진, 세션 경계 10곳, 마스크 4종, 낡은 값 삭제를 실행 검사.
- `check-overmarket.mjs` 를 세션 인식으로 확장하다가 **내 버그를 잡았다** — `saveQuote` 의 마스크
  기준을 `_keep("mstate")`(저장된 딱지)로 잡아 두어, 낡은 딱지가 스스로를 증명하는 순환이 생겼다.
  기준을 이번 조회값 또는 시계로 바꿨다.
- `check-model-evidence` · `check-ext-trading` 을 새 단일 출처에 맞춰 갱신(앵커 포함).

게이트 99개 전부 통과 · `node --check src/index.js` 통과.

### 남은 것(코드로 못 정하는 판단)
- **DNN accLB 45.66%** — 이번엔 워커 폴백이 아니라 **GPU 모델**(`source:"external"`, featVer 17,
  valAcc 48.8%)이 문턱 50.5% 에 못 미친 것이다. 즉 V33.338 의 진단은 맞았고, 지금은 모델 실력 문제다.
  억제는 정상 동작 — 고칠 대상은 학습 쪽이다.
- **XALPHA 전진 IC −0.039** 가 `fwdReady=false` 라 안 잡히는 건 여전히 열려 있다(문턱 설계 판단).
- **구버전 표본 505,728** 은 이관이 돌면서 줄어든다(324,821 / 832,676 = 39%).

---

## V33.340 — ★시간외 거래의 신선도 가드가 한 번도 걸린 적이 없었다★

V33.331~332 가 시간외 거래를 열면서 넣은 가드다. 설정에 `freshMs: 420000` 이 있고
주석도 "낡은 값으로는 거래하지 않는다" 라고 적혀 있었다. **그런데 작동한 적이 없다.**

```js
const _ts = _num(q.ts, 0);
if (_ts > 0 && (Date.now() - _ts) > freshMs) return null;   // ← _ts 는 언제나 0
```
`extTradePrice` 가 읽는 `q.ts` 는 **거래 경로의 quote 객체에 아예 없는 필드**다.
그 객체는 `fetchBatchQuotes` 가 만드는데(`{price, prevClose, dayPct, mstate, pre, post…}`),
`ts` 를 넣는 곳이 한 군데도 없다. 그래서 `_ts > 0` 이 항상 거짓 → 검사 통째로 건너뜀.
DB 에 저장된 행에는 `ts` 가 있지만 그건 **가격 샤드가 마지막으로 쓴 시각**이지 체결 시각이
아니다 — 그 값을 썼더라도 5시간 전 체결이 "방금"으로 통과한다.

실측: `extTradePrice({pre:100, prePct:1}, "pre", cfg)` → `100` 을 그대로 돌려준다.

### 왜 위험한가
얇은 종목은 프리마켓에 **04:05 에 한 번 찍고 09:00 까지 체결이 없다.**
`fetchExtendedQuoteUS` 는 "창 안의 마지막 체결"을 고르므로 그 04:05 값을 돌려주고,
그 값으로 **손절이 나가거나 신규 진입이 들어갔다.** 시간외 저유동성 구간에서
정확히 하면 안 되는 일이다.

### 고친 것
1. **값을 만드는 쪽이 체결 시각을 함께 싣는다** — `extTs`.
   v7 은 `preMarketTime`/`postMarketTime` 을 **명시적으로 요구**하고(안 물으면 안 준다 —
   V33.330 에서 배운 그대로), v8 분봉은 **고른 봉의 시각**을, 네이버는 폴링 호출 시각을 적는다.
2. **시각을 모르면 거래하지 않는다** — 이 저장소의 원칙 그대로다. 표시 경로
   (`applyDisplayOverMarket`)는 **건드리지 않았다**. 화면에 마지막 체결이 남는 것과
   그 값으로 돈을 거는 것은 다른 문제다.
3. **시각이 값과 함께 살고 죽는다** — `saveQuote` · 가격 샤드 SQL · `refreshQuotesOnly` ·
   `normalizeExtUS` 넷 다. 하나라도 빠지면 DB 를 거친 순간 시간외 거래가 통째로 막힌다.
4. **폴백의 추측을 측정으로 바꿨다** — `fetchQuoteViaChart` 는 두 개의 추측 위에 서 있었다:
   *"live 와 일봉 종가가 다르면 시간외 체결이다"* (마감 후 `meta.regularMarketPrice` 는 보통
   **정규장 종가**다 — 갈리는 건 대개 일봉 갱신 지연이지 시간외 체결이 아니다) 와
   *"정규장 5.5시간 전 안쪽이면 장전"* (야후가 창을 `currentTradingPeriod.pre/post` 로
   이미 주는데 손으로 다시 적었다 — 서머타임·조기폐장을 우리가 재계산하는 셈).
   → **체결 시각이 pre/post 창 안인가**를 재서 판정한다. 둘 다 아니면 아무것도 만들지 않는다.

### ★가드를 조이면서 새 침묵을 만들지 않았는가★
이게 이번에 가장 신경 쓴 부분이다. 수집원이 시각을 안 주기 시작하면 시간외 거래가
통째로 멈추는데, 증상은 **"오늘은 시간외 체결이 없었나 보다"와 구별되지 않는다** —
이 저장소가 반복해서 당한 함정이다(`v7Dead` 를 계산만 하고 안 읽던 것과 같은 모양).
→ `extTradePriceEx` 가 **막은 이유**를 함께 돌려주고(`noprice`/`nots`/`stale`/`bigmove`/`lowprice`),
메인 사이클이 이유별로 세어 로그와 `ext_block:<시장>` 상태에 남긴다.
자가진단은 **구성**을 본다: 체결없음이 대다수면 정상이고, **시각미상이 대다수면
시장이 조용한 게 아니라 우리 수집이 고장난 것**이라고 말한다.

### 게이트
신규 `check-ext-freshness.mjs` — 가드를 **실제로 돌려** 본다:
시각 없는 값·`q.ts` 만 있는 값·5시간 전·8분 전은 막히고, 1분 전은 통과하고,
초저가·과대변동 가드는 그대로 살아 있는지. **사유 이름표까지 못박는다** —
돌연변이 시험에서 시각미상 분기를 죽여도 낡은값 검사가 대신 막아 주므로
*가격만 보면 통과*했다. 그러면 수집 고장이 "낡은체결"로 보고돼 원인을 엉뚱한 데서 찾게 된다.
돌연변이 6종(가드 제거·`q.ts` 회귀·시각 위조·저장 누락·v7 필드 제거·사유 뒤바꿈) 전부 물린다.

게이트 100개 전부 통과 · `node --check src/index.js` 통과.

---

## V33.341 — 내부 AI: ★모델마다 다른 자로 재고 있었다★ (+ 시간외 체결비용)

사용자 지시: "내부 탑재 ai 문제부터 해결해라 잡음이랑 구별 안되는거랑 검증 성능 안나오는거
전부 해결시켜라 시간외 문제도 더 해결해라".

### ★먼저 — 틀린 가설 두 개를 세우고 버렸다★
증거 없이 고치지 않기 위해 둘 다 시뮬레이션으로 재고 접었다. 기록으로 남긴다.

1. **"수확/라이브 피처 스큐가 DNN 을 무너뜨린다"** — `sigWeight`·`confluence`·전략원핫4 는
   수확이 원리적으로 만들 수 없어 표본의 80%에서 상수이고 라이브에서만 값이 튄다.
   그럴듯했지만 **재 보니 아니었다**: 합성 실험(수확 80%/라이브 20%, 검증꼬리 라이브 55%)에서
   MLP 56.69% → 57.08%, **잡음 수준**. 이유도 분명하다 — 상수 칸은 그래디언트를 못 받아
   가중이 초기값(작음)에 머문다. 3σ 스파이크 × 작은 가중 = 작은 섭동이다.
   (중립화는 **위생 목적으로만** 넣었다. 성능 주장으로 팔지 않는다.)
2. **"엠바고 누락이 트리 성적을 부풀린다"** — 실측 **0.14%p**. 실재하지만 4%p 격차의 원인이 아니다.

### ★진짜로 찾은 것 — 자가 서로 달랐다★
문제는 "모델이 약하다"가 아니라 **같은 문턱을 서로 다른 자로 통과시키고 있었다**는 것이다.

| | 엠바고 | τ* 선택 | 채점 구간 | 유효표본(실측 역산) |
|---|---|---|---|---|
| DNN | 있음(6일) | **검증 앞절반** | **검증 뒤절반** | **≈690** |
| MIND(FM) | **없음** | **검증 앞절반** | **검증 뒤절반** | **≈950** |
| GBDT · XGB/LGB/CAT · 시장별 | **없음** | — | 검증 전체 | **≈7,400** |

**같은 풀인데 유효표본이 10배 차이다.** 승격 게이트는 Wilson 하한을 보므로 표본이 적으면
하한이 그만큼 내려간다 — 즉 **"DNN 검증 미달(accLB 45.66%)"의 상당 부분은 실력이 아니라
자의 길이였다.** 그리고 경계를 안 비운 모델들이 바로 **위원회에 앉아 실제 돈을 거는** 모델들이다.

추가로 **엠바고 길이 자체가 지평보다 짧았다**: `embargoDays = 6` 인데
`predictionHorizonDays = 10`. V32.10 이 지평을 5→10 으로 올릴 때 엠바고는 안 따라갔고
주석만 "라벨 horizon(5일)"로 남았다. 손으로 적은 숫자가 다른 손으로 적은 숫자를 못 따라갔다.

### 고친 것
1. **분할을 한 곳에서만 낸다** — `_split_ts()`. 학습기 5곳(DNN·GBDT·부스터·시장별·MIND)이
   전부 같은 함수를 부른다. 경계를 안 비우는 옛 분할(`Xs[:-nval]`)은 소스에서 사라졌다.
2. **엠바고를 지평에서 파생시킨다** — `LUXML.embargoDays` 는 이제 getter 로
   `max(6, ceil(horizonDays))`. 지평을 바꾸면 따라온다. 트레이너도 지평 미만이면 지평으로 올려 쓴다.
3. **τ* 를 검증에서 뗀다** — 학습 구간의 꼬리 10%를 보정 구간으로 떼어(학습에서 제외)
   거기서 τ* 와 시드를 고르고, **검증은 전부 채점에 쓴다.** DNN·MIND 의 유효표본이
   부스터와 같은 자로 돌아온다. 엠바고가 보정과 검증을 갈라 놓으므로 누출은 없다.
4. **죽은 손잡이 하나를 살렸다** — `liveSrcWeight: 1.5` 는 워커 자체 학습기 다섯 곳이 쓰는데
   `_mlExportConfig` 가 안 내려보내서 **Modal 은 그런 값이 있는 줄도 몰랐다**
   (`np.where(HV > 0, hv_w, 1.0)` — 라이브는 언제나 1.0). 위원회에 앉는 모델은 전부
   external 이므로, "실거래 표본을 우대한다"는 설정이 **위원회에는 한 번도 적용된 적이 없다.**
   V33.260 이 dropout·l2 에서 잡은 것과 같은 종류다 — 학습기가 둘인데 설정 통로가 하나만 넓었다.
5. **신호 컨텍스트 6종 중립화**(위생) — 수확이 못 만드는 칸을 라이브에서도 안 만든다.
   피처 생성기 한 곳에서 덮어쓰고, 트레이너는 저장된 옛 표본의 같은 칸도 눌러 맞춘다
   (**표본을 버리지 않는다 — 값만 규약에 맞춘다**).

### 시간외 — ★비용을 낮게 잡는 것은 수익을 지어내는 것과 같다★
`_slipRate(market, ts)` 는 `ts` 를 받으면서 **세율 적용 여부에만 쓰고 세션은 안 봤다.**
그래서 V33.332 가 시간외 거래를 전 종목으로 연 뒤에도 장전·장후 체결이 정규장과 똑같이
5bp(미국)·8bp(한국)로 기록된다. 시간외 호가는 그럴 수가 없다 — 마켓메이커 의무가 없고
장부가 얇다. 낮게 잡으면 셋이 한꺼번에 틀어진다: ①원장이 시간외를 실제보다 잘한 것으로 적고
②그 pnl 이 학습 라벨이 되어 모델이 "시간외가 유리하다"고 배우고 ③켈리가 부풀린 엣지 위에서
크기를 정한다.
→ `_extSessionAt(market, ts)` 로 **체결 시각의 세션**을 보고 ×3 을 건다.
**배수는 측정이 아니라 가정이라고 코드에 적어 뒀다.** 소급 적용하지 않는다
(시간외 거래를 연 판부터만 — 과거 원장을 조용히 다시 쓰면 현금 체크포인트와 어긋난다).
실측 확인: 정규장 5.0bp / 장전·장후 15.0bp / 심야·주말 5.0bp / KR 장후 24.0bp /
암호화폐 언제나 5.0bp / 2026-09-01 장후 5.0bp(소급 안 함).

### 게이트
신규 `check-split-embargo.mjs` — 분할 단일출처·엠바고≥지평·τ* 위치·보정구간 학습제외·
출처가중 전달·중립화 배선을 못박는다. 돌연변이 6종 전부 물린다.
기존 `check-stack-oof` 는 "같은 비율" 대신 **"같은 함수를 부르는가"** 로 강화했다 —
실제 문제는 비율이 아니라 엠바고였기 때문이다.

게이트 101개 전부 통과 · `node --check` · `ast.parse` 통과.

### 남은 것 — ★고치지 않고 보고한다★
- **DNN 은 여전히 은닉 10층이다.** V33.204 실측 기록: 10층 valAcc 49.3% vs 워커 폴백 2층 53.3%.
  이 저장소는 그 측정을 갖고도 10층을 기본값으로 둔다 — **사용자 지시**이기 때문이다
  (V33.193, 그리고 "dnn 또 12층에서 4층됐는데 수정해"). 스윕은 신뢰 실패 시에만 돌고
  승자를 `dnn_arch` 에 저장해 다음 학습이 쓴다. **깊이를 바꾸는 것은 코드가 아니라 사람이
  정할 문제라 손대지 않았다.** 이번 수정으로 자가 같아졌으니, 다음 학습의 숫자가
  "10층이 정말 나쁜가"에 대한 처음으로 공정한 답이 된다.
- XALPHA 전진 IC −0.039 가 `fwdReady=false` 라 안 잡히는 건 여전히 열려 있다(문턱 설계 판단).

---

## V33.342 — 프로덕션 실측이 드러낸 것: ★내 진단 문구 두 개가 틀렸고, 재시도를 허락하는 쪽이 없었다★

2026-09-10 11:41 UTC(미국 장전 07:41 ET) 자체 점검. `worker-probe` 로 실측했다.

### ★먼저 — V33.340 의 배선은 완벽히 작동했다★
```
US 시간외 거래가 시각 문제로 막히는 중 — 제외 556종목 중 시각미상 0 · 낡은체결 389
```
- **시각미상 0** — 값이 있는 종목은 전부 체결 시각(`extTs`)을 갖고 있다. 배선 성공.
- 그리고 v7 경고가 사라졌다 → **v7 이 살아나 `preMarketTime` 을 주고 있다**(V33.340 이 명시적으로 요구한 필드).
- **낡은체결 389** — 값은 있는데 마지막 체결이 7분보다 오래됐다.
  **이것이 장전의 실제 모습이다.** V33.340 이전이었다면 이 389종목 전부를
  "지금 값" 으로 거래했을 것이다.

### ★그런데 내가 그 정상 상태를 고장이라고 적어 놨다★
1. **자가진단 문구** — "체결이 없는 게 아니라 수집 경로가 체결 시각을 안 준다".
   **정확히 반대다.** 시각은 잘 들어오고 있었고(시각미상 0), 그 시각이 말해 준 사실은
   "장전엔 대부분 종목이 몇십 분째 체결이 없다" 는 것이다. 고장이 아니라 시장의 성질이다.
   → `nots` 우세(수집 고장, **warn**)와 `stale` 우세(정상, **info**)를 갈라 말하게 고쳤다.
   *고장을 정상으로 읽는 것도 나쁘지만, 정상을 고장으로 읽으면 멀쩡한 걸 고치러 간다.*
2. **`[FETCH] 평가가능 0종목(… 일봉결측)` ERROR ×15회** — 원인을 "일봉결측" 으로 **박아 뒀다**.
   같은 순간 일봉은 멀쩡했고 걸린 곳은 시간외 신선도 가드였다(평가 루프에서 시간외 가드가
   일봉 검사보다 **앞**에 있다). 시간외에 체결이 드문 건 정상인데 ERROR 로 15번 적으면
   **진짜 사고가 그 사이에 묻힌다.** → 시간외에는 실제 차단 구성을 적고 등급도 사실에 맞춘다.

### ★V33.337 이 고친 결함이 한 단계 위에 그대로 있었다★
`committee_cal featVer 불일치(15≠17)` 가 **V33.339 배포 5.5시간 뒤에도 그대로**였다.
보정 단계는 ⟳ 로 재시도를 정상적으로 요청하고 있었다. 문제는 **허락하는 쪽**이었다:

```js
await setState(env.DB, "ai_trained_day", _aiDay);   // ← 무조건
...
if (_aiLast !== _aiDay && !_aiLockFresh) { …파이프라인… }   // ← 도장 찍히면 그날 닫힘
```
V33.337 은 **단계**에 "다시 오겠다" 고 말할 권한을 줬는데, **파이프라인**은 끝에서
완주 도장을 무조건 찍는다. 도장이 찍히는 순간 그날은 닫히고, 대기 중인 단계는
다시 들어올 길이 없다. **말할 권한만 주고 문을 잠근 셈이다.**
그래서 두 판(15→16→17)에 걸쳐 위원회 확률 보정이 꺼져 있었다.

→ 완주 직전에 `ai_stage:*` 중 `<오늘>|wait|` 인 것을 세고, **하나라도 있으면 그날을 닫지 않는다.**
  `ai_pipe_partial` 로 6분 쿨다운 후 재진입해 **대기 단계만** 돌린다(끝난 단계는 자기 도장으로
  즉시 빠지므로 재진입이 싸다). 6시간 상한을 두되 **닫을 때 누가 못 끝냈는지 이름을 적는다** —
  조용히 닫으면 이 결함이 그대로 반복된다.

### 게이트
신규 `check-pipeline-resume.mjs` — **조건식을 소스에서 뽑아** 상태기계를 굴린다.
(조건을 게이트에 다시 적으면 소스가 바뀔 때 게이트만 옛 조건을 지킨다 — 통과해도 무의미해진다.)
정상 진입 / 완주 후 미진입(CPU 보호) / 쿨다운 / 6분 뒤 재개 / 락 존중 / 어제 기록 무시 6가지를
실제로 평가한다. 돌연변이 4종 전부 물린다.
`check-ext-trading` 의 신선도 시험이 아직 `q.ts` 를 쓰고 있어 **엉뚱한 것을 시험하고 있었다** —
`extTs` 로 고치고 "q.ts 는 체결 시각으로 인정하지 않는다" 를 한 줄 더 넣었다.

게이트 102개 전부 통과.

### 남은 것
- **신선도 문턱 7분이 장전에는 사실상 대부분을 막는다**(556종목 중 389 차단). 보수적이라
  실거래 안전 쪽으로는 옳지만, "시간외에도 정규장처럼 거래" 라는 목표와는 상충한다.
  더 나은 설계는 **체결 나이에 비례해 크기를 줄이는 것**(막느냐 마느냐의 이분법 대신)인데,
  이건 위험 정책 변경이라 사용자 판단이 필요하다 — **손대지 않고 보고한다.**
  이제 v7 이 `preMarketTime` 을 주므로 체결 나이 분포를 실제로 잴 수 있다.
- DNN 은 여전히 은닉 10층(사용자 지시). V33.341 로 자가 같아졌으니 다음 학습 숫자가 공정한 답이 된다.

---

## V33.343 — ★V33.342 는 이미 닫힌 문을 열지 못했다★ (내 수정의 구멍)

V33.342 배포 89분 뒤 실측. 두 개는 고쳐졌고 하나는 **내 수정에 구멍이 있었다.**

### 고쳐진 것 (실측 확인)
```
issues.2.level = info      ← warn 이었다
US 시간외 장전 — 제외 556종목 중 낡은체결 469 · 시각미상 0. 시간외엔 체결 자체가 드물어
대부분 종목의 마지막 체결이 오래됐다(정상). 가드가 그 값으로 거래하는 것을 막고 있다 — 신선도 문턱 7분
```
```
[FETCH] US 시간외 pre 평가가능 0종목(priced=556) — 체결없음 86 · 낡은체결 469 · 과대변동 1
        · 시간외에 체결이 드문 것은 정상이다(일봉과 무관)      ← INFO
```
`warnCnt` 7 → **6**. 문구가 사실에 맞고 등급도 맞다.

### ★안 고쳐진 것 — 그리고 원인은 내 코드였다★
`committee_cal featVer 불일치(15≠17)` 가 그대로였다. 로그를 봤더니:

**워커 로그 900줄에 `[SCHED]` 가 0줄.** 완주도 부분완주도 없다 — 파이프라인이 오늘
**한 번도 들어가지 않았다.**

V33.342 의 진입 게이트는 `ai_pipe_partial` 을 본다. 그런데 **그 값은 파이프라인 안에서만 써진다.**
배포 시점에 이미 오늘 도장이 찍혀 있으면:
- `_aiLast === _aiDay` → 첫 항 거짓
- `ai_pipe_partial` 없음 → `_resume` 거짓

**닭과 달걀이다.** 내 수정은 *다음 날부터* 효과가 있고, 이미 닫힌 오늘은 못 연다.
"재시도를 허락하는 쪽이 없었다" 를 고친다면서, 허락하는 쪽이 **자기가 열어야 볼 수 있는 기록**을
근거로 삼았다. 같은 모양의 실수를 한 단계 아래에서 반복한 것이다.

### 고친 것 — ★안 끝났다는 사실이 실제로 있는 곳을 본다★
`ai_pipe_partial` 은 쿨다운용 보조 상태일 뿐이다. 진실은 두 곳에 있다:
- **(A)** `ai_stage:*` 에 오늘의 `|wait|` 표식 — 단계가 스스로 그렇게 적었다.
- **(B)** 단계의 **산출물이 옛 판** — 이번 판에서는 끝난 적이 없다는 직접 증거.

**오늘의 실제 상황은 (B)다.** `calibrate` 는 V33.339 이전에 찍힌 완료 도장을 갖고 있어
(A)로는 안 잡힌다. 하지만 `committee_cal.featVer 15 ≠ 17` 이 말해 준다.
→ `_pipeOpenStages()` 가 둘 다 확인하고, (B)면 **그 단계의 완료 도장을 지운다**
(안 지우면 재진입해도 `_stg` 가 "오늘 완료"로 보고 그냥 빠진다).
**6분에 한 번만** 스캔한다 — 매분 도는 크론에 범위 스캔을 얹지 않는다.

`_STAGE_OUT_VER` 는 표다(현재 `calibrate ← committee_cal` 한 줄). 같은 성질의 단계가
생기면 한 줄을 더한다 — 규칙을 코드에 흩뿌리지 않는다.

### 게이트
`check-pipeline-resume` 를 확장했다. 조건식은 여전히 **소스에서 뽑아** 평가하고,
`_openStages` 를 주입해 **두 번째 문**을 따로 시험한다. 그리고 스캔 함수 자체를
**가짜 DB 로 실제로 돌린다**: (A) 대기 표식 발견 · (B) 옛 판 산출물 발견 + 도장 삭제 ·
판이 맞으면 무동작 · 6분 스로틀. 돌연변이 5종 전부 물린다.

게이트 102개 전부 통과.

### 곁가지 관측
- **MLOPS 열화 문턱**: 검증정확도가 48.2% → **50.0%** 로 올라왔다(문턱 50.5%). 아직 미달이지만
  V33.341 이후 처음 도는 학습은 아직 안 끝났다(자동 재학습 12.1h 전 트리거).
- 옛 `[FETCH] … 일봉결측` ERROR 가 21회로 집계되지만, 이는 자가진단이 **최근 12시간** 창을
  보기 때문이다(배포 전 발생분). 새 INFO 문구가 나오고 있으므로 새 경로가 도는 것은 확인됐다.

---

## V33.344 — ★관측할 수 없으면 고칠 수 없다★ (스캔 위치 + 파이프라인 상태 노출)

V33.343 배포 48분 뒤에도 `committee_cal` 은 15 였다. 원인을 쫓느라 프로덕션 로그를
**네 번** 긁었고, 그때마다 새로운 추측이 하나씩 늘었다. 그 자체가 결함이다.

### 실측으로 확정한 것
워커 로그 **2498줄 = 01:30~13:51 UTC, 12시간치** 를 받아 보니:
- `[SCHED]` **0줄** · `[CAL]` **0줄** (7줄은 SCALP 등 우연한 부분일치)
- 같은 창에 거래 사이클 로그는 가득하다(BUY/SIGNAL/BLOCK, 13:43~13:51)

→ **야간 파이프라인 블록의 뒷부분이 12시간 내내 한 번도 실행되지 않았다.**

### ★내 앞선 판단 하나를 정정한다★
V33.343 에서 나는 "[SCHED] 가 0줄 = 파이프라인이 한 번도 들어가지 않았다" 고 적었다.
**그건 과했다.** `[SCHED]` 는 파이프라인 ★끝★ 에서만 찍힌다 — 중간에 죽으면 들어갔어도 0줄이다.
없는 것을 근거로 "안 들어갔다" 를 단정한 것이고, 그 위에 다음 수정을 얹었다.

### 진짜 구조
야간 블록은 한 invocation 안에서 **수확 캐치업 → 반사실 → 딥이력 → … → 진입 게이트** 순으로 돈다.
앞의 무거운 일이 CPU·시간 예산을 먹으면 **뒤쪽은 도달하지 못한다.**
V33.343 의 스캔은 하필 그 뒤쪽(진입 게이트 바로 앞)에 있었다 — 장중 내내 굶었다.

→ **스캔을 블록 맨 앞으로 옮겼다.** D1 읽기 몇 번이라 값싸고, 6분 스로틀이 있다.
   결과를 `ai_pipe_partial` 에 남기면 **다음 틱의 진입 게이트가 그걸 보고 연다** —
   그 invocation 이 뒤까지 못 가도 상관없다.

### ★그리고 상태를 볼 수 있게 했다★
이 결함 하나를 쫓는 데 로그 네 번이 든 이유는 단순하다:
`ai_trained_day` 가 언제 찍혔는지, 어떤 단계가 대기 중인지, 스캔이 돌기는 했는지 —
**아무 데서도 볼 수 없었다.** 그러면 남는 건 추측이고, 추측으로 고치면 이 저장소가
여러 번 겪은 방식으로 실패한다(worker-logs 워크플로 주석이 같은 말을 한다).

→ `/api/selfcheck` 가 `pipe` 를 함께 돌려준다:
   `{ day, trainedDay, closed, stagesToday, stagesOld, waiting[], waitingN, partial, lastScanMin }`
그리고 **"닫혔는데 안 끝난 게 있다"** 는 조합을 경고로 소리 내게 했다 — 오늘의 사고가 정확히 그것이다.
다음부터는 조회 한 번으로 원인이 갈린다.

### 게이트
`check-pipeline-resume` 에 두 절을 더했다 — 스캔이 블록 맨 앞에 있는가, 상태가 노출되는가,
그 조합을 경고하는가. 게이트 102개 전부 통과.

### 아직 미해결 — 정직하게
`committee_cal` 은 **여전히 featVer 15** 다. 이번 수정이 실제로 문을 여는지는
**다음 크론 틱 이후에야** 확인된다. 그리고 확인 수단이 이제 로그 추측이 아니라
`selfcheck.pipe` 이므로, 다음 점검은 한 번의 조회로 끝난다.

---

## V33.345 — ★확률 보정 복구 확인★ + v7 문구 정정

### 결과: committee_cal 이 돌아왔다
V33.344 배포 30분 뒤 `/api/selfcheck` 한 번으로 확인:
```
pipe.day = 2026-09-10 · trainedDay = 2026-09-10 · closed = true
pipe.stagesToday = 45 · stagesOld = 0 · waitingN = 0 · lastScanMin = 2.9
```
- **`committee_cal featVer 불일치(15≠17)` 경고가 사라졌다** — 두 판 동안 꺼져 있던
  위원회 확률 보정이 다시 켜졌다.
- `stagesOld = 0` · `waitingN = 0` — 안 끝난 단계가 없다. 스캔은 2.9분 전에 돌았고
  열 것을 못 찾았다(= 정상).
- **`lastScanMin` 이 값을 갖는다는 것 자체가 V33.344 의 성과다** — 스캔이 굶지 않는
  자리로 옮겨져 실제로 돌고 있다.

### ★그리고 관측이 실제로 값을 했다★
V33.343 까지는 이 하나를 판단하려고 로그를 네 번 긁고도 못 갈랐다.
V33.344 이후에는 **조회 한 번**으로 끝났다. `pipe` 를 넣은 이유가 그것이고,
넣자마자 그 값을 했다.

### 곁가지 — 오늘 내가 쓴 문장 하나를 또 정정한다
새로 뜬 ERROR: `야후 v7(미국 시세 1차 수집원)이 응답하지 않는다` — **err 태그가 비어 있었다.**
`v7Err` 는 ★예외가 났을 때만★ 채워진다. 비어 있다는 것은 예외 없이 200 을 받았는데
종목을 하나도 못 준 경우다 — **통신 실패가 아니라 응답이 빈 것**이고, 처방이 다르다
(앞은 재시도·crumb 재발급, 뒤는 요청 형태·심볼 목록).
→ 두 경우를 갈라 적는다. 오늘 이 파일에서 반복해 고친 것과 같은 종류다.

### 남은 상태(참고)
- `errCnt 1 · warnCnt 6`. ERROR 는 v7 하나뿐이고, v7 은 오늘 아침엔 살아 있었다가
  다시 빈 응답을 주는 중이다(간헐적). v8 폴백이 받치고 있다.
- MLOPS 열화 **50.0% < 50.5%** — V33.341 의 자 교정 이후 첫 학습은 아직 안 끝났다
  (자동 재학습 13.8h 전 트리거). 미국 정규장 마감(00:00 UTC) 뒤 야간 파이프라인이
  새 자로 도는 것이 **DNN 층수에 대한 처음으로 공정한 답**이 된다.
