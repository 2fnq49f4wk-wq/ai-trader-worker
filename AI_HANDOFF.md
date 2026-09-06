# AI 작업 인계 상태

> 이 문서는 Claude Code와 Codex가 토큰 소진·세션 중단 후에도 커밋 경계에서 안전하게 이어가기 위한 체크포인트다.

## Current handoff

- Status: complete
- Owner: Claude Code
- Branch: claude/ai-brain-visualization-sidebar-4shzpz
- Last commit: HEAD (this change; verify with `git log -1 --oneline`)
- Scope: V33.307 — 야간 단계별 비용 계측 + 검사를 PR 에서도 실행(배포는 push 전용)
- Base: `main`(V33.304) 위에 얹었다. 사용자의 V33.305(검증된 모델만 AI 자율진입 · AGENTS.md ·
  `tools/check-ai-handoff.mjs`)는 `codex/find-issues-with-embedded-ai-models` 에만 있고 아직
  `main` 에 없다 — 그래서 이 문서의 검증 목록에는 `check-ai-handoff.mjs` 를 넣지 않았다.
  V33.305 가 `main` 에 병합되면 그 줄을 되살린다. 버전 번호 305 는 그쪽이 쓰고 있으므로
  이 작업은 306 을 유지한다(304 → 306 의 빈칸은 의도적이다).

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
