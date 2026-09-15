# 결함 목록 (OPEN DEFECTS + 해결분)

## Codex continuation — V33.349 (implementation commit; resolve hash with git log)

- Verification 2026-09-12: implementation commit **b46024e**, Worker/Modal deployments successful (34665917663/34665917673). Live latest shadow receipts confirm feat17 XGB/LGB/CAT were rejected for block-IC t1.18/1.38/1.19 <1.65, not a missing feature upload. Corrected SEQ-only run34665970392 is in progress, outcome unverified. This does not resolve the remaining findings below or authorize B-8 migration.
- A-1: common `extBuyGuard` now runs inside `executeBuy`, not just fastWatch. Enforces entries switch, source quote/freshness, probability floor, 0.5 default quantity multiplier and per-session committed-symbol count. Count failures block buys; cycle lock remains the entry serialization mechanism. FastWatch passes a real signal object and only counts cash-confirmed fills. Regression executes the guard. Deployment verification pending.
- Additional live-confirmed quote defect: main evaluation writes erased session/price-time fields and replaced the regular anchor with the evaluation price. `quoteSessionFields` now carries the bundle through batch/evaluation/backfill writes. No synthesized timestamps.
- B-1: run34542208755 actually uploaded all three feat17 booster candidates (2026-09-11 00:15–00:16 UTC). They were saved as rejected shadows, not promoted: XGB LB0.5135, LGB0.5059, CAT0.5095, conversion maxdiff0.0082/0/0. Old active version15 records are not proof that training failed. Receipt diagnostics/recovery now include latest shadow trust. No gate relaxed. The full run timed out at3600s during MIND, so later SEQ/MEMO were NOT verified.
- B-2: SEQ preprocessing, standardization, labels, weights, IC groups and conversion probes use the same embargoed row indices. Synthetic shuffled-row execution confirms chronology. `_split_ts` now fails on insufficient honest history rather than silently dropping the embargo. Existing deployed SEQ still requires corrected retraining; do not call its old evidence repaired.
- Timeout recovery: added validated `target` selection to Modal CLI/workflow so SEQ/MIND/MEMO can be recovered without repeating DNN. One-hour resource limit and recurring schedule unchanged. Targeted-stage regression executes actual dispatch branch, including dry mode. Full recurring pipeline runtime is still an open capacity issue.
- E-2: confirmed money-path fail-open catch in `executeBuy` riskPreTradeCheck now logs ERROR and blocks purchase. Real-function regression throws the risk check and confirms no purchase. This is not a claim that all optional catches need removal.
- E-3: full-reset deposits now explicitly include us/kr/cm/bdus/bdkr; no reset was executed.
- F-3: verified NOT a defect. Nasdaq's own June26,2026 announcement identifies Space Exploration Technologies Corporation as Nasdaq:SPCX, joining Nasdaq100 July7. Keep the valid ticker: https://ir.nasdaq.com/news-releases/news-release-details/space-exploration-technologies-corporation-join-nasdaq-100 . Historical knowledge of private SpaceX must not override current official evidence.
- B-8 migration: requested user decision on preserving old data while rebuilding a new version; no data deletion/version invalidation performed yet. A-3/A-4 are risk/data assumptions, not authority to trade stale quotes or invent measured slippage. Keep safeguards until evidence supports a change.
- Open remainder: A-2/A-5/A-6/A-7/A-8/A-9/A-10, training timeout recovery, B-3/B-4/B-5/B-6, B-8 migration, C-1/C-2 live performance, D-1 accounting policy, E-1, F-2. Preserve original evidence below; items above are more recent.
- Post-Claude V33.348 observation: selfcheck took21,405ms (C-2 still open). Recent KR EVAL-COST733–1097ms/symbol, known work~7s but residual10–13s; no evidence that model inference alone explains it. Latest CF tick0 admitted/2608 immature, which is not evidence that the alignment fix failed. Further isolation needed; do not label performance fully repaired.

> **이 파일은 다음 작업자(Codex 포함)를 위한 단일 작업 목록이다.**
>
> - 기준: `main` **5943b26** 위에서 조사·수정 · 런타임 **V33.348**
> - 조사자: Claude (2026-09-10 ~ 09-11)
> - **코드에서 확인한 것만 적었다.** 확인 못 한 것은 "미확인"이라고 명시했다.
> - 마지막 절 `Z. 확인했으나 문제 아님` 을 먼저 보라 — 헛수고를 줄인다.

심각도: **치명**(실거래 손실 직결) · **중**(정확도·신뢰성 훼손) · **소**(위생·가독성)

---

## ★V33.348 에서 고친 것 — 그래도 한 번 더 확인할 것★

사용자 지시(2026-09-11): "원인 확실하고 고칠 수 있는건 고쳐봐 고친건 고쳤다고 쓰는데
그래도 한번더 확인하라고 적어". 아래는 **고쳤다고 적지만 재확인 대상**이다.
전부 ★실행으로★ 검증했고(문자열 검사 아님) 게이트를 새로 붙였다 — 그래도 실운영 수치로 한 번 더 볼 것.

| 항목 | 무엇이 틀렸었나 | 어떻게 고쳤나 | 게이트 | 다시 볼 것 |
|---|---|---|---|---|
| **D-3** 치명 | D1 재시도가 **매수 원장을 두 번** 적을 수 있었다 → 현금 이중차감 | `stmtRecordTrade` 를 자연키 조건부 INSERT 로 | `check-ledger-idempotent` | 기존 원장에 이미 생긴 중복 행이 있는지 **한 번 훑어볼 것**(아래 D-3) |
| **D-2** 중 | 한국 매도세가 2년째 법정세율과 다름(0.18% 고정) | 연도별 표 + 체결 연도(KST)로 선택 | `check-kr-selltax` | **연초마다 표가 그 해를 담는지 재확인.** 세법은 바뀐다 |
| **C-3** 중 | FLOW 일봉 전량(수 MB)을 매 사이클·매 시장 통째로 읽음 | 자른 결과를 10분 아이솔레이트 캐시 | `check-daily-bulk-cache` | 배포 후 `[EVAL-COST]`·사이클 시간이 실제로 줄었는지 |
| **C-4** 중 | export `total` COUNT 를 페이지마다 재실행 · `prefix LIKE` 전체 스캔 | 키 캐시 · 범위 스캔 | `check-daily-bulk-cache` | 학습 실행 중 D1 오류가 줄었는지 |
| **B-7** 중 | 반사실 라벨이 진입 시각을 무시(`entryTs` 미사용) | `days`+`_altBarIdx` 로 진입 정렬 | `check-cf-label-align` | `[CF]` 로그의 편입 건수가 늘었는지(폐기분이 살아난다) |
| **B-8** 치명 | 수확 표본 `ts` 가 가짜 달력(일봉 1개=1일) | `dd.days[i]` 로 진짜 날짜 | — | ★**코드만 고쳤다. 실효는 재수확 때**★ — 아래 B-8 참조 |
| **F-1** 소 | 미국 섹터 ETF 12종이 `NAME_MAP`·`MCAP_RANK` 에 없음 | 12종 추가(520~531) | `check-universe-sync` | 화면에서 이름이 뜨는지 |
| **F-4** 소 | 유니버스 3곳 규칙을 보는 게이트 없음 | 게이트 신설 | `check-universe-sync` | — |

게이트 **108종 전부 통과**. 새 게이트 5종은 전부 ★돌연변이 검사★ 를 통과했다
(고침을 되돌리거나 반대 방향으로 과하게 밀면 실패한다).

### V33.349~350 에서 더 고친 것

| 항목 | 요지 | 누가 | 게이트 |
|---|---|---|---|
| **B-9** 치명 | Modal 학습이 timeout 으로 죽어 **MIND 뒤 단계가 한 번도 안 돌았다** | V33.350 | `check-trainer-budget` |
| **A-1** 치명 | 시간외 안전장치 4개가 실제 경로에 안 걸림 → `executeBuy` 안 공통 가드로 | Codex V33.349 | `check-ext-trading` 외 |
| **B-2** 중 | SEQ 만 엠바고 없이 검증 → `_split_ts` 공용 | Codex V33.349 | `check-recovery-provenance` |
| **A-10** 소 | 한국만 시간외 잔상을 안 지움(어제 장전가가 오늘 "장전") | V33.350 | `check-ext-session-mask` |
| **E-3** 소 | `deposits` 표의 모양이 경로마다 다름 → `sleeveZeros()` 단일화 | Codex + V33.350 | — |

### V33.351 에서 더 고친 것

| 항목 | 요지 | 게이트 |
|---|---|---|
| **A-2** 중 | 세션 창이 여러 벌 → `MARKET_HOURS` + `marketSessionNow` 한 곳으로. **평범한 한 주 20,160분 전수 대조 차이 0건** | `check-session-windows` |
| **A-8** 중 | 조기폐장·지연개장을 몰랐다 → `MARKET_HOURS_SPECIAL` 표. **2026-11-19 수능 · 11-27·12-24 반장** | `check-session-windows` |
| **A-9** 중 | 미국 프리마켓 04:00~07:00(=17~20시 KST)을 통째로 버렸다 → 관측만 넓히고 거래는 07:00 유지 | `check-session-windows` |
| **A-7** 소 | 휴장 중 남은 시간외 값에 나이가 없어 3일 지난 값이 지금 값처럼 보였다 | `check-ext-age` |
| **E-1** 중 | 같은 문장 43회가 로그를 덮어 새 사고를 묻었다 → 묶되 `ts` 는 첫 발생 그대로 | `check-log-dedup` |
| **C-2** 소 | `/api/selfcheck` 가 98만 행을 요청당 3회 훑었다 → 이미 있던 공유 캐시로 0회 | `check-fwd-ledger` |
| **A-5** 중 | v7 이 죽으면 폴백이 예산을 다 먹어 시간외 보강이 **0종목** + 회전 커서가 안 해 본 종목을 건너뛰었다 | `check-ext-enrich-budget` |

### V33.354 에서 더 고친 것

| 항목 | 요지 | 게이트 |
|---|---|---|
| **D-1** 중 | `ETF_SYMBOLS` **집합 멤버십에 날짜가 없어** ETF 를 나중에 넣으면 과거 매도가 소급 비과세 → `ETF_TAX_MEMBER_FROM` + `_etfTaxExemptAt`. **git 200커밋 확인: 집합은 한 번도 안 바뀌었다 = 아직 안 터진 지뢰** | `check-ledger-retro` |
| **E-2** 소 | 빈 catch **1,045곳** 중 **돈 경로 13곳**을 읽어 **실패가 성공처럼 보이는 4곳**만 소리 내게 했다 | `check-ledger-retro` |

### V33.355 에서 더 고친 것

| 항목 | 요지 | 게이트 |
|---|---|---|
| **B-3** 중 | 잠정합류 경사로가 전진 IC 의 **부호를 아예 안 읽어**, 반대 방향 증거가 쌓일수록 가중이 **올라갔다**(n=399 에서 +0.039 와 −0.039 가 똑같이 ×0.599) → 부호가 방향을 정하게. **종전보다 배수가 오르는 경우 0건**(전수 대조) | `check-expert-admit` |
| **B-4** 소 | 죽은 입력 6칸을 지금은 못 뺀다(인덱스) → **featVer 가 올라가는 순간 배포를 막는 덫**을 놨다. 결함은 계속 열려 있다 | `check-live-only-feats` |

### V33.356 에서 더 고친 것

| 항목 | 요지 | 게이트 |
|---|---|---|
| **G-1** 중 | 부스터 3종이 **"재학습 대기"** 라고 말하는데, 실제로는 **현재 판 모델이 0.4시간 전 도착해 유의성으로 거절**돼 있었다. `live \|\| ext` 가 낡은 승격기록을 먼저 읽었다 → 사유를 최신 수신분으로. **합류 판정은 252조합 전수 대조 0건 변화** | `check-booster-reason` |
| **F-2** 소 | 동점을 따라가 보니 **드리프트가 계산된 적이 없었다** — `mcap_shares` 를 `.shares`(존재한 적 없는 키)로 읽어 **`XR_FLOW` 가 V33.250 이래 0건 발동**. 이름·모집단·동점을 함께 고침 | `check-rv-rank` |

### V33.357 에서 더 고친 것

| 항목 | 요지 | 게이트 |
|---|---|---|
| **A-6** 중 | V33.347 계측이 답을 줬다 — `result=0 keys=quoteResponse`(봉투 멀쩡·error 없음). 원인은 아직 미상이나, **배치 하나의 0건으로 v7 전체를 사망 판정**하던 구조를 고쳤다. 실측: 개별 폴백 **300회 → 50회** | `check-v7-batch` |
| **G-2** 중 | 1단계만 — 승격 기록에 `accBase`·`accFloorUsed`·`icTMinUsed`·`passedBy` 를 남긴다. **판정은 안 바꿨다** | `check-booster-reason` |

### V33.358 에서 더 고친 것

| 항목 | 요지 | 게이트 |
|---|---|---|
| **H-1** 소 | R2 집계가 **23일 전** 값인데 `"2,008,262초 전"` 으로 찍고, 그 날짜를 **"오늘 단타 수집"** 이라 부르며 초록으로 칠했다 → 나이를 사람이 읽는 표기로, 옛 집계는 '오늘' 이라 안 부른다 | `check-r2-age` |
| **F-3** — | **닫음.** 나스닥 공시(Codex) + **우리 자신의 `univ_health`(US 558/558 수신, `never` 0)** 두 갈래로 `SPCX` 유효 확인. 대신 **`BK`(51일)·`SATS`(16일)** 가 실명 후보로 나왔다 | `check-universe-sync` |

### V33.359 에서 더 고친 것

| 항목 | 요지 | 게이트 |
|---|---|---|
| **I-1** 치명 | `ml_samples` 112만행에서 **전수 정렬 3건**이 D1 CPU 한도를 넘겨 pooluniq·BDKR·CM·SCHED 가 **동시에** 쓰러졌다 → 계획 실측으로 범인 특정, **199→47ms · 11→0ms · 37→1ms** | `check-d1-scan` |
| **I-2** 중 | 유효표본 **7,379 → 210** 붕괴로 SEQ 가 빠지고 부스터 3종이 거절 — **원인 미확정.** 추측 대신 다음 회차가 답하도록 계측을 심었다 | `check-trainer-budget` |

### V33.360 에서 더 고친 것

| 항목 | 요지 | 게이트 |
|---|---|---|
| **J-1** 중 | 진단 문장이 **300자에서 잘려 결론만** 사라졌다(파일은 유효 JSON — 깨진 건 내용) → `_clipMid` 로 머리·꼬리 둘 다 보존 | `check-status-detail` |
| **J-2** 중 | 상태에 `d1Headroom`(며칠 남았나)·`poolWindow`(풀의 시간 창) 추가 — **추가 D1 쿼리 0** | `check-status-detail` |
| **J-3** 중 | 옛 featVer 승격 기록이 영원히 남아 `activeFeatVer` 가 **15** 로 보고됐다 → 야간 `retirefv` 은퇴 | `check-featver-retire` |
| **J-4** 중 | 표본 상한(120만)에 닿으면 **영구 삭제**됐다 → **R2 보관 후 삭제**, 보관 실패 시 안 지움 | `check-featver-retire` |
| **I-1 보강** | `_altPrune` 4표·`ml_candidates` 도 `featver != ?` → `<` (같은 전수 스캔 함정) | `check-featver-retire` |

**아직 안 고친 것**(원인이 확실하지 않거나, 정책·이관·사람의 결정이 필요하다):
`A-3`(신선도 이분법) · `A-4`(슬리피지 가정) · `A-6`(v7 빈 응답, 원인 미상) ·
`B-4`(덫은 놨다 — 제거는 featVer 상향 때) · `B-5` · `B-6` ·
`B-8`(코드는 고침, 재수확 시점은 사람이) · `C-1` · **`G-2`(문턱이 두 벌 — 2단계는 사람이)** ·
**`BK`·`SATS` 티커 확인**(F-3 에서 새로 나온 실명 후보 — 사람이 확인)

---

# A. 시간외 (Extended hours)

## A-1 · 치명 · ✅ 해결(Codex V33.349) · 확인 한번 더 · 시간외 안전장치 4개가 실제 경로에 안 걸려 있었다

**증거**
- 선언: `src/index.js:3640-3655` — `sizeMult: 0.5` · `maxNewPerSession: 2` · `entries: true` · `minPickP: 0.62`
- 참조 위치 **전수**:
  - `entries`/`fastEntries` → `src/index.js:21929`
  - `minPickP` → `src/index.js:21974`
  - `sizeMult`/`maxNewPerSession` → `src/index.js:22071`, `22095`
  → **넷 다 fastWatch 블록 안에서만 쓰인다.**
- 그 fastWatch 진입 블록은 기본 **꺼짐**: `fastEntries: false` (`src/index.js:3648`, V33.332 가 끔)
- 실제 시간외 진입 경로인 **메인 사이클**에서 `extSessMkt` 가 쓰이는 자리 **전수**:
  `19055-19056`(세션 판정) · `19073-19078`(일봉 스킵) · `19197-19198`(evPrice 교체) ·
  `19228`,`19234-19257`(로그·상태). **사이징·개수상한·entries 스위치 어디에도 안 쓰인다.**

**무엇이 문제인가**
- 시간외 신규 진입이 **정규장과 동일한 포지션 크기**로 나간다(얇은 호가인데 0.5배 축소 미적용).
- **세션당 신규 종목 수 상한이 없다.**
- `entries: false`("청산만 운용")로 바꿔도 **메인 사이클 진입은 안 멈춘다.**
- `minPickP` 문턱도 안 걸린다(메인 사이클 자체 게이트를 쓰며 더 낮을 수 있다).

**왜 중요한가** 설계 주석(`src/index.js:22056-22064`)이 약속한 보수성과 실제 동작이 다르다.
정규장 공통 게이트(위원회·동시보유·현금·재무)는 그대로 걸리므로 무제한은 아니지만,
**시간외 전용 추가 보수성이 전부 없다.**

**★고쳤다 (Codex V33.349) — 조사자가 코드로 확인했다★**
`extBuyGuard(DB, market, qty, price, signal, cfg, opts, now)` 를 만들어 **`executeBuy` 안에서**
부른다(`src/index.js:15508`). 메인 사이클이든 fastWatch 든 **모든 매수가 지나는 한 지점**이라,
"경로마다 따로 걸기" 보다 낫다. 거는 것:
- `entries === false` 면 진입 자체를 막는다(`entries_disabled`)
- 호가 검증 — `extTradePrice` 가 준 값과 진입가가 다르면 거부(`quote_unverified`)
- `minPickP`(0.62) 확률 문턱(`probability_floor`)
- `maxNewPerSession`(2) — **원장(`trades`)에서 세션 시작 이후 실제 체결된 종목 수**를 센다.
  시도 횟수나 fastWatch 카운터가 아니라 **커밋된 매수**를 세는 것이 맞다(`session_cap`).
  세는 데 실패하면 **진입을 막는다**(`session_count_unavailable`) — 모르면 안 한다.
- `sizeMult`(0.5) 로 수량 축소, 0 이 되면 거부(`size_zero`)

**★그래도 한 번 더 확인할 것★**
1. `maxNewPerSession` 카운트가 `COUNT(DISTINCT symbol)` 이라 **같은 종목 추가매수는 한 종목으로 센다.**
   의도된 것으로 보이지만(신규 "종목" 수 상한), 불타기가 상한을 우회하는지 실거래로 볼 것.
2. `startTs` 를 분 단위로 역산한다 — 세션 경계 직후 1분 이내 체결이 창에 들어오는지.
3. 이 가드는 `_extSessionAt(market, now)` 로 세션을 판정한다. **A-8(조기폐장)·A-2(창 4벌)는 그대로다** —
   반장 13:00~16:00 ET 에는 이 가드가 아예 안 걸린다(그 시간을 정규장으로 보기 때문).

---

## A-2 · ✅ 해결(V33.351) · 확인 한번 더 · 세션 창이 여러 벌로 흩어져 있었다

**증거**

| 창 | 중복 위치 |
|---|---|
| US pre 420–570 / post 960–1200 | `5339` · `5360-5362` · `5400-5401` · `11511-11512` |
| KR pre 480–540 / post 930–1200 | `5344` · `5407-5408` · `7438-7439` · `11518-11519` |

Codex V33.346 은 **시세 경로에만** NXT 실제 체결창을 반영했다(`src/index.js:7472-7473`):
`NXT executions stop at 08:50 and resume at 15:40`.
그런데 **거래 세션 판정**(`extTradeSession`, `5407-5408`)은 여전히 08:00–09:00 / 15:30–20:00 이다.

**무엇이 문제인가** 08:50–09:00 과 15:30–15:40 은 "거래 세션" 이라 부르면서 **체결은 불가능한 구간**이다.
지금은 시세 경로가 값을 안 주므로 결과적으로 막히지만, **두 층이 서로 다른 창을 들고 있다.**
또 KRX(비-NXT) 경로에는 venue 창 검사가 아예 없다(`7473` 조건은 `info === nxt` 일 때만).
KRX 실제 창은 장전 08:30–08:40, 장후 15:40–16:00, 시간외 단일가 16:00–18:00 로 우리 창보다 좁다.

**미확인** KRX 응답이 창 밖 시각에 낡은 값을 주는지는 실측하지 않았다(신선도 7분이 방어 중).

**★고쳤다 (V33.351) — 그래도 한 번 더 확인할 것★**
창을 **한 곳**으로 모았다:
```js
const MARKET_HOURS = {
  us: { pre: [420, 570], regular: [570, 960], post: [960, 1200], quoteTail: 10 },
  kr: { pre: [480, 540], regular: [540, 930], post: [930, 1200], quoteTail: 0 }
};
marketWindows(market, now) → 그날의 창   ·   marketSessionNow(market, now) → PRE/REGULAR/POST/CLOSED
```
이 한 곳을 보게 바꾼 함수(전부 `now` 를 받을 수 있게 해서 검사 가능해졌다):
`isMarketOpen` · `isTradingWindow` · `isQuoteRefreshWindow` · `isExtendedHoursWindow` ·
`minutesToClose` · `marketMinutesUntilClose` · `sessionElapsedFraction` · `isLLMTriggerWindow` ·
`usMarketStateNow` · `krMarketStateNow` · `extTradeSession` · `_extSessionAt` ·
`applyKrOverMarket` · `extBuyGuard`(세션 시작 분) · 장중 소급생성의 `_krSessionLive`.

**길이를 쓰던 계산도 같이 고쳤다** — `sessionElapsedFraction` 의 분모가 390 고정이었다.
반장은 210분, 수능일은 360분이다. 그 분모가 틀리면 당일봉 거래량 환산이 그만큼 어긋난다.

**게이트** `tools/check-session-windows.mjs`
- **평범한 한 주 20,160분 전수 대조** — 옛 리터럴을 게이트에 그대로 적어 두고 분 단위로 비교한다.
  차이 0건. 즉 **이 통합은 평범한 날 동작을 한 분도 바꾸지 않았다.**
- 세션 함수 7종이 **특례일에도** 같은 답을 준다(평범한 날만 보면 갈라진 함수를 못 잡는다 —
  A-2 가 정확히 그렇게 숨어 있었다. 처음에 평범한 날만 넣었더니 돌연변이를 놓쳤고, 그래서 넣었다).
- **경계 숫자가 표 밖에 다시 박히면 실패**시킨다(A-2 재발 방지). 크론 트리거 두 함수는
  세션이 아니라서 이름으로 명시해 제외했다.

**★그래도 한 번 더 확인할 것★**
1. NXT 실제 체결창(장전 08:00~08:50 · 장후 15:40~20:00)은 **아직 시세 경로에만** 반영돼 있다
   (`applyKrOverMarket` 의 `venueClosed`). 거래 세션 창은 KRX 기준 그대로다 —
   지금은 시세가 값을 안 줘서 결과적으로 막히지만, **두 층이 완전히 같아진 것은 아니다.**
2. KRX 실제 창(장전 08:30~08:40 · 장후 15:40~16:00 · 시간외 단일가 16:00~18:00)은
   우리 창보다 좁다. 좁히려면 `MARKET_HOURS` 한 곳만 고치면 된다 — **이제 그게 가능해졌다.**

---

## A-3 · 중 · 신선도 7분이 장전 종목의 84%를 막는다 — 이분법이라 크기 조절이 없다

**증거(실측)**
- 2026-09-11 01:31 `ext_block`: 제외 556 중 **낡은체결 469 · 체결없음 86 · 과대변동 1**
- 2026-09-10 11:41: 낡은체결 389 · 시각미상 0
- 판정: `extTradePriceEx` (`src/index.js:5424-5453`), `freshMs: 420000`

**무엇이 문제인가** 안전 쪽으로는 옳지만 사용자 지시("시간외에도 정규장처럼 거래")와 상충한다.
구조가 **막느냐/마느냐** 뿐이고 "오래된 체결이면 작게" 가 없다.

**지금은 가능해졌다** v7 `preMarketTime`/`postMarketTime` 과 v8 봉 시각이 들어오므로
**체결 나이 분포를 실제로 잴 수 있다.** 다만 나이 비례 축소는 **위험 정책 변경이라 사용자 판단 영역.**

---

## A-4 · 중 · 시간외 체결비용 ×3 은 측정이 아니라 가정이다

**증거** `EXT_SLIP_MULT = 3` (`src/index.js:11502`), `_slipRate` (`11524`).
정규장 US 5bp/KR 8bp → 시간외 US 15bp/KR 24bp.

**무엇이 문제인가** 코드 주석에 "가정" 이라 적어 뒀지만 그 값이 **원장·학습 라벨·켈리 사이징**에
그대로 들어간다. 실측 체결 데이터가 쌓이면 교체해야 한다.

---

## A-5 · ✅ 해결(V33.353) · 확인 한번 더 · v7 이 죽으면 시간외 보강이 ★0종목★ 이었다

**증거** 메인 사이클은 `fetchBatchQuotes` 의 in-memory 결과로 평가한다.
시간외 값 보강 상한 `extMax` 기본 **24** (`src/index.js:16423` 부근).
v7 이 살아 있으면 배치가 전 종목 pre/post 를 주지만, **죽으면 보강분 24종목만** 값을 갖는다.
**현재 v7 은 죽어 있다(A-6).** 즉 지금이 그 상태다(유니버스 US 558).

**★고쳐 보니 24보다 나빴다 — 0이었다★**
흐름은 `v7 배치 → (값 없는 종목) 분봉 폴백 → 시간외 보강` 이다.
폴백 루프가 예산을 **0 이 될 때까지** 썼다. v7 이 살아 있으면 폴백이 몇 종목뿐이라 문제가 없는데,
**v7 이 죽으면 전 종목이 폴백 대상**이 되어 예산 200 을 통째로 먹는다.
그러면 바로 뒤의 시간외 보강은 예산이 없어 **한 종목도 못 돌린다.**
★그리고 v7 이 죽었을 때가 바로 시간외 보강이 가장 필요한 때다.★
게이트로 재현했다 — 고치기 전 `ext 0회`, 고친 뒤 `ext 28회`(같은 예산 200).

**★고쳤다 (V33.353) — 예산은 안 늘렸다★**
- **몫을 먼저 뗀다**: 미국 시간외 창이면 40 을 남겨 두고 폴백을 멈춘다.
  같은 예산을 쓰되 **한쪽이 다 먹지 못하게** 한다. 못 받은 종목은 다음 사이클로
  (폴백에도 회전 커서가 있어 굶지 않는다).
- **상한 24 → `EXT_ENRICH_MAX = 120`**: 24 는 채울 종목이 수백인 날 회전 한 바퀴에
  20분 넘게 걸리게 했다. 실제 상한은 이 값이 아니라 **남은 예산**이다.
- **★같이 발견한 버그★ 회전 커서가 '하려던 수' 만큼 밀리고 있었다.**
  예산에 막혀 중간에 멈췄는데 `__extTried = _todo.length` 를 보고했다 —
  **안 해 본 종목까지 지나간 것으로 친다.** 그 종목들은 다음 사이클에도 차례가 안 오고,
  회전이 한 바퀴 돌 때마다 같은 구간이 계속 빠진다. 예산이 넉넉하던 시절엔 안 드러나다가
  빠듯해질수록 구멍이 커지는 종류다. → **실제로 시도한 수**를 센다.

**게이트** `tools/check-ext-enrich-budget.mjs` — 가짜 fetch 를 끼우고 **`fetchBatchQuotes` 를 실제로 돌린다.**
v7 사망 시 보강이 도는지 · v7 생존 시 낭비가 없는지 · 예산 바닥에서 멈추는지 ·
정규장엔 몫을 안 떼는지 · **커서가 실제 시도 수만큼만 미는지**. 돌연변이 4방향 전부 잡힌다.

**★그래도 한 번 더 확인할 것★**
1. 실제로 v7 이 죽은 사이클에서 `ext_block` 의 제외 사유 분포가 바뀌는지.
2. 예약 몫 40 이 정규장 폴백을 굶기지 않는지 — 시간외 창에만 걸리지만, 그 창에서
   폴백이 필요한 종목이 많으면 그쪽이 밀린다. `[FETCH] 시세 배치 전멸` 이 늘면 40 을 줄일 것.

---

## A-6 · 중 · ✅ 절반 해결(V33.357) · 확인 한번 더 · v7 이 200 을 주면서 종목을 0건 준다

**증거(실측 01:31)** `야후 v7이 ★응답은 하는데 종목을 하나도 안 준다★(예외 없음 · 파싱 0건)`.
V33.345 가 통신 실패와 빈 응답을 갈라 적게 했으므로 **빈 응답 확정**.
09-10 11:41 에는 살아 있었고 14:58 에 죽었다 — **간헐적**.

**무엇이 문제인가** `yahoo_v7` 상태에 `dead`·`fields`·`first`·`slices`·`err` 만 남고
**응답 본문을 안 남겨** 무엇이 비었는지(quoteResponse 없음 / result 빈 배열 / error 필드)를 모른다.

### ★진단 가능하게 만들었다 (V33.347)★
`_v7ShapeOf(j)` 가 **본문을 저장하지 않고** 최상위 키·`result` 길이·`error` 문자열만 요약해
`yahoo_v7.shape` 에 남기고, 자가진단 문장이 그 값을 함께 보여 준다.
실행 검증(5가지 입력이 전부 구분됨):
```
정상 0건    → result=0 keys=quoteResponse
에러 실림   → result=0 error={"code":"Unauthorized",...} keys=quoteResponse
스키마 변경 → keys=finance
본문 null   → null
HTML 응답   → string
```
### ★계측이 답을 줬다 (2026-09-14 23:09 운영 스냅샷)★

```
응답모양 result=0 keys=quoteResponse
```

**봉투는 멀쩡하고 `error` 도 없는데 배열만 비었다.** 위 표에 비추면:
- 스키마 변경 **아님**(그랬다면 `keys=finance`)
- 인증·쿼터 **아님**(그랬다면 `error={"code":"Unauthorized"...}`)
- 본문 손상 **아님**(`null`·`string` 아님)

남는 것은 **야후가 이 요청을 받아들이고도 줄 게 없다고 답한 경우** — 즉 요청 형태나
**심볼 목록** 쪽이다. (야후 호스트로의 아웃바운드가 이 조사 환경에서 막혀 있어
**"어떤 심볼이 배치를 오염시키는가" 는 실측으로 확인하지 못했다 — 단정하지 않는다.**)

### ★원인과 무관하게 확실한 구조 결함을 고쳤다 (V33.357)★

**증거** 종전 코드는 **첫 배치 하나**가 558종의 운명을 정했다.

```js
v7First = parseV7(await yahooFetch(v7Url(slices[0], v7Fields)));   // 첫 배치
if (v7First === 0) { v7Fields = !v7Prefer; ...같은 배치를 한 번 더... }
if (v7First === 0) v7Dead = true;        // ← 여기서 전 종목이 v8 폴백으로
```

`fields` 를 뒤집어 한 번 더 보긴 하지만 **같은 배치라 같은 심볼을 또 물어본 것뿐**이다.
그래서 **"v7 이 죽었다" 와 "이 배치에 야후가 못 알아먹는 심볼이 하나 있다" 를 구분할 길이 없었다.**
자가진단이 말하는 **"50종목/1회 → 1종목/1회"** 가 정확히 이것이다.

**고침** 죽었다고 선언하기 전에 **다른 배치**를 한 번 물어본다. 그게 오면 v7 은 살아 있고
문제는 그 배치에 있다 — 그 배치만 개별 폴백에 맡기고 나머지는 정상 속도로 받는다.
subrequest 1회를 더 쓰지만, 살아나면 폴백 수십 회를 아낀다.

**게이트로 잰 실제 효과**(`check-v7-batch` — `fetchBatchQuotes` 를 실제로 돌린다):

| 상황 | 종전 | 고친 뒤 |
|---|---|---|
| 300종 중 첫 배치만 0건 | v7 사망 판정 · **개별 폴백 300회** | v7 생존 · **개별 폴백 50회** (오염 배치만) |
| 전 배치 0건(진짜 사망) | 개별 폴백 300회 | 그대로 300회(회귀 없음) |
| 정상 | 배치 6회 | 배치 6회(군더더기 0) |

**그리고 의심 배치를 이름으로 남긴다** — F-3 이 요청한 관측이 이것이다
("지금은 죽은 티커가 조용히 예산만 태우고 아무 데도 안 남는다"). 자가진단이
`의심 구간 앞 10종: …` 을 찍어 준다. 돌연변이 7종 전부 잡는다.

**★그래도 한 번 더 확인할 것★**
- **절반만 고쳤다.** v7 이 왜 그 배치에 0건을 주는지는 **여전히 모른다.**
  배포 뒤 자가진단의 `의심 구간` 목록을 보고, 그 안에 상장폐지·티커변경이 있는지 확인할 것.
  같은 스냅샷에 **`BK`(51일 뒤처짐) · `SATS`(16일 뒤처짐)** 가 이미 잡혀 있고,
  **`SPCX`(F-3, 유니버스 index 5 — 첫 배치)** 도 미검증인 채로 있다.
- 진짜 v7 사망이면 종전처럼 동작한다 — **이 고침이 사망을 숨기지 않는다**(게이트가 그걸 잰다).

---

## A-7 · ✅ 해결(V33.351) · 휴장 중 남아 있는 시간외 값에 나이 표시가 없었다

**증거** `extKeepMaskUS`/`extKeepMaskKR` 은 CLOSED 동안 `post` 를 **일부러** 유지한다(야후와 같은 규칙).
금요일 장후 값이 월요일 장전까지 3일간 화면에 남는데, 종전엔 그게 **지금 값처럼** 보였다.
거래는 `extTs` 신선도 가드(7분)가 이미 막으므로 **표시 문제**다 — 그렇다고 작은 문제는 아니다.
화면이 "장후 105.20 +0.8%" 라고만 말하면 보는 사람은 그게 방금 값인 줄 안다.

**★고쳤다 (V33.351)★** `extAgeTxt(ts, now, freshMin)` 을 만들어 워치리스트 카드의 장전·장후 두 줄에 붙였다.
- 신선하면(기본 20분 이내) **아무것도 안 붙는다** — 매번 붙으면 그게 잡음이 된다.
- 낡으면 `20분 전` · `3시간 전` · **`3일 전`**(금요일 장후가 월요일까지 남는 그 경우).
- `extTs` 를 모르면 **`시각미상`** — 모르는 것을 아는 척하지 않는다.
- 시계 차이로 미래 시각이 오면 아무것도 안 붙인다(틀린 숫자를 보여 주느니 안 보여 준다).

★값을 지어내지 않는 것과 값의 나이를 숨기지 않는 것은 같은 원칙이다.★

**게이트** `tools/check-ext-age.mjs` — HTML 에서 함수를 잘라 **실제로 실행**한다.
문턱 경계(19분/20분) · 시간·일 단위 전환 · 알 수 없는 값 4종 · 미래 시각 ·
그리고 **배선**(카드가 `q.extTs` 로 나이를 만들고 두 줄 모두에 붙는가)까지.
돌연변이 4방향 전부 잡힌다.

---

## A-8 · ✅ 해결(V33.351) · ★날짜가 오면 확인★ · 조기폐장·지연개장을 시스템이 몰랐다

**증거 (코드)** 세션 창이 전부 고정 상수다. "오늘은 13:00 에 닫는다" 를 표현할 자리가 어디에도 없다.
- `isQuoteRefreshWindow("us")` `src/index.js:5322` → `totalMin >= 570 && < 970` (09:30~16:10 ET 고정)
- `usMarketStateNow` `src/index.js:5357-5364` → `570~960` 이면 무조건 `"REGULAR"`
- `isExtendedHoursWindow("us")` `src/index.js:5331-5346` · `extTradeSession` `5395` · `_extSessionAt` `11527`
  → 장후를 `960`(16:00) 부터로 본다
- `_usHolidaySet` `src/index.js:5148` 은 **휴장일만** 만든다. 조기폐장 개념이 없다.

**실제로 무슨 일이 벌어지나** — 미국 반장(13:00 ET 마감)은 연 3회쯤 온다.
가까운 것: **2026-11-27(추수감사절 다음날)** · **2026-12-24(성탄 전야)**.
그날 13:00~16:00 ET 에:
1. `regularOpen = true` → `extOnly = false` → **시간외 안전장치 경로를 안 탄다**(A-1 의 sizeMult·세션당 개수 제한도, 7분 신선도 가드도 없음).
2. `usMarketStateNow` 가 `"REGULAR"` 를 찍고 `normalizeExtUS`(`5375`)의 `keep.post = false` 가
   ★야후가 정확히 주고 있는 장후 체결가를 `null` 로 지운다.★
   즉 **얼어붙은 13:00 종가로 거래하면서, 유일하게 살아 있는 가격을 우리 손으로 버린다.**
3. `_slipRate`(`11501~`)는 그 체결을 정규장 5bp 로 기록한다 — 실제로는 장후 호가폭이다.
   A-4 와 같은 방향으로 원장이 낙관 편향되고, 그 pnl 이 학습 라벨이 된다.

**한국도 같은 종류가 있다 — 이쪽은 개장 시각이 밀린다**
- **수능일**(2026-11-19 예정) KRX 는 **10:00 개장 · 16:00 마감**. 현재 코드는 09:00~15:30 고정이라
  ① 09:00~10:00 을 정규장이라고 믿고(실제 휴장) ② 15:30~16:00 을 장후라고 믿는다(실제 정규장).
- **연초 개장일**(1월 첫 거래일) 10:00 개장. 같은 ①.
- 근거 코드: `isQuoteRefreshWindow("kr")` `5326-5327` · `isMarketOpen("kr")` `5288-5290` · `applyKrOverMarket` `7440-7442`.

**★고쳤다 (V33.351) — 날짜가 오면 반드시 확인할 것★**
A-2 를 먼저 통합했더니 이 수정은 **표 한 곳**으로 끝났다:
```js
const MARKET_HOURS_SPECIAL = {
  us: { "2026-11-27": { regular: [570, 780], post: [780, 1020], why: "추수감사절 다음날 반장" },
        "2026-12-24": { … }, "2027-07-02": { … }, … },
  kr: { "2026-11-19": { pre: [540, 600], regular: [600, 960], post: [960, 1260], why: "대학수학능력시험" },
        "2027-01-04": { pre: [480, 600], regular: [600, 930], … , why: "연초 개장일" }, … }
};
```
규칙으로 뽑을 수 있는 날(추수감사절 다음날)도 **적어 뒀다** — 규칙을 두 벌 만들면 그 둘이 갈라지고,
이 표는 사람이 읽고 확인할 수 있어야 한다. 부분 지정도 된다(나머지는 기본 창).

게이트가 확인하는 것: 반장 13:00 → 장후 · 15:30 → 장후 · 17:00 → 휴장 ·
`minutesToClose` 가 13:00 기준 · 정규장 시세창이 13:10 에 닫힘 ·
**14:00 ET 에 장후 체결가가 보존됨**(종전엔 REGULAR 로 보고 지웠다) ·
수능일 09:30 → 장전 · 15:45 → **정규장** · 16:00 → 장후 · LLM 트리거 창도 같이 밀림.
표의 형식·사유·순서와 "아직 오지 않은 특례일이 남아 있는가" 까지 본다.

**★날짜가 오면 반드시 확인할 것★**
1. **2026-11-19(수능)** · **2026-11-27(반장)** · **2026-12-24(반장)** — 그날 로그에서
   세션 전환 시각이 실제와 맞는지. 이 세 날이 이번 고침의 첫 시험이다.
2. **수능일은 매년 날짜가 바뀐다.** 2027-11-18 은 **추정**으로 넣은 것이다 —
   교육부 발표로 확정되면 고칠 것. 틀린 날짜가 표에 있으면 그날 조용히 틀린다.
3. **표에 없는 해가 오면 기본 창으로 돈다.** 게이트가 "아직 오지 않은 특례일" 개수를 세지만,
   그것만으로는 "그 해가 비었다" 를 못 잡는다. **연말에 다음 해를 채울 것.**
4. 미국 반장의 장후 종료(17:00 ET)는 브로커마다 다르다 — 우리 기준은 17:00 으로 잡았다.

---

## A-9 · ✅ 해결(V33.351) · 확인 한번 더 · 미국 프리마켓 04:00~07:00 을 통째로 버리고 있었다

**증거** `usMarketStateNow` `src/index.js:5359` → `totalMin >= 420`(07:00 ET) 부터만 `"PRE"`.
그 앞(04:00~07:00 ET)은 `"CLOSED"` 로 떨어지고,
`extKeepMaskUS`(`5369-5373`)가 `{ pre:false, post:true }` 를 주므로
`normalizeExtUS`(`5375-5385`)가 **야후가 준 `preMarketPrice` 를 `null` 로 지운다.**
`isExtendedHoursWindow`(`5334-5335`)·`extTradeSession`(`5404`)·`_extSessionAt`(`11530`) 도 전부 `420`.

**왜 문제인가**
- 미국 프리마켓 실제 개시는 **04:00 ET** 다(Nasdaq/NYSE Arca). 야후 `preMarketPrice` 도 그때부터 채워진다.
- 04:00~07:00 ET = **17:00~20:00 KST** — ★사용자가 화면을 실제로 보는 시간대★ 다.
  그 3시간 동안 화면에는 어제 종가만 남고 장전 시세가 없다.
- 실적·가이던스 발표가 몰리는 구간이기도 하다. A-1 이 말한 "위험은 시간외에 생기는데" 가
  여기서는 **관측조차 안 되는** 형태로 나타난다.
- 거래는 `extTradeSession` 이 null 이라 어차피 안 열린다 — 즉 **지금 손실은 관측·평가 쪽**이다.
  다만 프리마켓 창을 넓히면 A-1(안전장치 미배선)·A-3(7분 이분법)이 **먼저** 고쳐져 있어야 한다.

**★고쳤다 (V33.351) — 관측만 넓히고 거래는 그대로 뒀다★**
A-2 통합 덕에 창 표에 한 줄을 더하는 것으로 끝났다:
```js
us: { pre: [240, 570], preTrade: [420, 570], regular: [570, 960], post: [960, 1200], quoteTail: 10 }
```
- `pre`/`post` = **관측(시세·표시)** 창 · `preTrade`/`postTrade` = **거래 허용** 창.
- 04:00~07:00 ET 는 이제 `PRE` 로 보여서 `extKeepMaskUS` 가 장전 값을 **보존**한다.
- **거래는 여전히 07:00 부터.** 그 구간은 호가가 극도로 얇아 A-3(신선도 이분법)·
  A-4(슬리피지 ×3 은 가정)가 맞는지 아직 모른다. **보는 것과 돈을 거는 것은 다른 문제다.**
- 특례일에는 관측 창이 곧 거래 창이다 — 반장 13:00 장후는 '얇아서 미루는' 구간이 아니라
  그날의 정상 창이기 때문이다(게이트가 이것도 확인한다).

**fetch 비용을 그대로 두기 위해** 거래 창 밖의 시간외는 **6분 주기**로 본다(거래 창 안은 종전 2분).
관측 3시간을 늘리면서 회차는 90 → 30 으로 줄였다 — 화면에는 충분하고 예산(A-5)은 지킨다.

**★그래도 한 번 더 확인할 것★**
1. **04:00~07:00 ET = 17:00~20:00 KST** 에 화면에 장전 시세가 실제로 뜨는지.
2. fetch 예산(`__fetchBudget`)·사용량 가드가 늘어난 회차를 감당하는지 — 늘면 6분을 더 늘릴 것.
3. `preTrade` 를 04:00 로 넓힐지는 **A-3·A-4 를 재고 나서** 정할 일이다. 지금 넓히지 않았다.

---

## A-10 · ✅ 해결(V33.350) · 확인 한번 더 · 한국만 시간외 잔상을 안 지우고 있었다

**★처음 진단이 반만 맞았다 — 고치면서 정정한다★**
처음엔 "KR 은 장후가를 버린다" 고 적었는데, 코드를 더 따라가 보니 **반대**였다.
화면(`public/index.html:9694·9726`)은 `mstate==='CLOSED' && post>0` 이면 장후가를 보여 준다.
진짜 문제는 **한국이 아무것도 지우지 않는 것**이었다.

**증거 (코드)** 시세 배치 기록부(`src/index.js:16908` 부근):
```js
const _mask = (market === "us") ? extKeepMaskUS(...) : { pre: true, post: true };
```
★한국은 무엇도 지우지 않았다.★ 그런데 `applyKrOverMarket` 은 시간외 체결이 없으면
`mstate` 만 PRE/POST 로 찍고 값은 안 넣는다(정상 — 없는 체결을 지어내지 않는다).
그러면 SQL 의 `COALESCE` 가 **지난 세션 값을 살려 둔다**:
- 오늘 08:10 KST, 아직 장전 체결 없음 → `mstate=PRE` · `pre` = **어제 08시대 가격**
- 화면은 `mstate==='PRE' && pre>0` 이면 그걸 **"장전"** 이라고 표시한다

**V33.339 가 미국에서 고친 것과 정확히 같은 결함**이고, 한국만 안 고쳐져 있었다.
그때 남긴 문장이 여기에도 그대로 적용된다 — *"COALESCE 는 '새 값이 없으면 옛 값' 인데,
세션이 바뀌면 옛 값은 '아직 못 받은 값' 이 아니라 ★이미 끝난 값★ 이다."*

**★고쳤다 (V33.350) — 그래도 한 번 더 확인할 것★**
- `krMarketStateNow(now)` — KST 시계로 PRE/REGULAR/POST/CLOSED (주말 포함)
- `extKeepMaskKR(state)` — 미국과 **같은 규칙**: pre 는 장전에만, post 는 장후와 그 뒤 휴장에
- `extKeepMaskFor(market, mstate)` — 기록부가 **이 함수 하나만** 부른다.
  종전처럼 삼항식이 기록부 안에 박혀 있으면, 배선이 빠져도 마스크 함수만 보는 검사는 못 잡는다
  (실제로 돌연변이 검사가 "못 잡음" 을 내서 이렇게 뺐다).
- `cm`/`bdus`/`bdkr` 은 시간외 개념이 없어 종전대로 아무것도 지우지 않는다.

**게이트** `tools/check-ext-session-mask.mjs` — 시각을 넣어 함수를 실제로 부르고,
마스크로 `COALESCE` 를 재현해 **하루를 돌려 본다**(어제 장전 체결 → 정규장 → 장후 체결 →
밤 → 오늘 장전). 종전 마스크로 같은 하루를 돌리면 어제 값이 살아남는 것까지 대조로 보인다.
돌연변이 6방향(마스크 되돌리기 · CLOSED post 버리기 · 창 오류 · 주말 제거 · 배선 제거 · 과잉 삭제) 전부 잡힌다.

**★그래도 한 번 더 확인할 것★**
1. 이 마스크는 **세션이 바뀔 때 지우는** 방식이다. 정규장에 시세 기록이 한 번이라도 돌면
   지난 세션 값이 정리된다(정상 운영). **워커가 하루 종일 멈춰 있다가 다음 장전에 깨어나는
   경우까지는 못 막는다** — 그건 `extTs` 신선도 가드(거래)와 A-7(표시 나이)의 몫이다.
2. 화면에서 20시 이후 한국 종목의 "장후" 표시가 그대로 남는지(의도한 동작이다).
3. A-7 을 고칠 때 KR 정규화(`normalizeExtUS` 의 한국판)를 같이 만들면 자연스럽다.

---

# B. 내부 AI · 학습

## B-1 · 치명(수정됨, 결과 미확인) · 부스터 학습이 죽어 있었다

**원인** V33.341(Claude)이 분할을 `_tri` 로 바꾸면서 크기가중 `Wtr/Wva` 를 옛 연속 슬라이스로 뒀다.
길이 불일치 → `xgb.DMatrix(weight=Wtr)` 예외 → **XGB·LGB·CAT 학습 전멸.**
**수정** Codex `29437ef` (`W[_tri]` / `W[_vai]`).
**상태** 01:31 실측에서 세 모델 모두 **featVer 15**. 사용자 지시로 `modal-deploy.yml run_now=true`
를 2026-09-11 01:38 UTC 에 실행했으나 **결과 미확인.**

**다음 작업자가 확인할 것** XGB/LGB/CAT 이 featVer 17 로 올라왔는가, accLB 가 종전 대비 **내려갔는가**.
- 종전(featVer 15, 엠바고 없음): XGB `valAcc 0.5241` · LGB `0.5321` · CAT `0.5326`
- **내려가면** 종전 값이 경계 누출로 부풀어 있었다는 증거다.
- **그대로면** 이 데이터에서 엠바고 누출이 작다는 뜻이다(시뮬레이션 실측 0.14%p 와 일치).

---

## B-2 · ✅ 해결(Codex V33.349) · SEQ 만 엠바고 없이 검증받고 있었다

**증거** `trainer/modal/modal_train.py:833-835`, `882-883`:
```python
n_val = max(200, int(N * 0.2))
tr_end = N - n_val
tr = torch.arange(0, tr_end); va = torch.arange(tr_end, N)   # 경계에 공백 없음
```
V33.341 이 `_split_ts` 로 통일한 학습기는 **5곳**(DNN·GBDT·부스터·시장별·MIND)이고 **SEQ 는 빠졌다.**

**왜 중요한가** SEQ 는 09-10 스냅샷에서 `tier: provisional · mult 0.1838 · accLB 0.5084 · 블록IC t 5.27`
로 **실제 투표 중**이다. 라벨 지평 10일인데 경계를 안 비우므로 그 t 에 누출이 섞여 있다.

**참고** MEMO(`2189-2193`)·SCALP(`2554`)는 각자 자기 엠바고를 갖는다(정상).
즉 같은 개념의 구현이 **넷**으로 갈라져 있었다: `_split_ts` · MEMO · SCALP · SEQ(없음).

**★고쳤다 (Codex V33.349)★** SEQ 도 `_split_ts` 를 쓴다
(`trainer/modal/modal_train.py:972`): 같은 엠바고·같은 지평·같은 행 인덱스.
표준화(`mean`/`std`)도 **학습 구간에서만** 구한다 — 검증 통계가 새면 그만큼 낙관적으로 나온다.
`check-recovery-provenance` 가 **순서를 섞은 표본으로 실제 전처리를 돌려**
`TS[_tri].max() + 10일 < TS[_vai].min()` 과 학습 구간 표준화를 확인한다.
※ MEMO·SCALP 는 여전히 자기 분할을 쓴다 — **그 둘은 아직 열려 있다.**

---

## B-3 · 중 · ✅ 해결(V33.355) · 확인 한번 더 · 전진 IC 가 음수여도 표본이 모자라면 통째로 무시됐다

**증거** `expertAdmit` (`src/index.js`, 함수 상단):
```js
if (fwdReady && fwdIC != null && fwdIC <= ICGATE.forwardFloor) → reject
```
`fwdReady` 는 전진표본 ≥ `ICGATE.minForward`(400)일 때만 참이다.

**무엇이 문제인가** 그 미만이면 **측정된 음수 IC 를 버리고** 홀드아웃 증거만으로 잠정합류시킬 수 있다.
XALPHA 전진 IC **−0.039** 가 그 경우였다. **"부족한 증거" 와 "반대 방향 증거" 를 같이 취급한다.**

**★실행으로 재 봤더니 처음 진단보다 나빴다★** 이 문서는 "음수를 무시한다" 고만 적었는데,
실제로는 그 갈래가 `fwdIC` 의 **부호를 아예 읽지 않는다.** 고치기 전 실측:

```
음수 전진 IC −0.039 인 채로 표본만 늘렸을 때
  fwdN=  0 → ×0.25        fwdN=300 → ×0.5125
  fwdN=100 → ×0.3375      fwdN=399 → ×0.5991
  fwdN=200 → ×0.425       fwdN=400 → 제외(하드 리젝)
같은 표본에서 ★양수★ +0.039 → fwdN=399 에서 ×0.5991   ← 음수와 똑같다
```

두 가지가 더 드러났다.
1. **반대 방향 증거가 쌓일수록 가중이 커진다.** `fwdBase + fwdSpan×frac` 경사로가 표본 수만 보고
   부호를 안 보기 때문이다. 방향이 틀렸다는 증거를 더 모을수록 더 믿어 주는 셈이다.
2. **경계에 절벽이 있다.** 399 에서 ×0.599 → 400 에서 제외. 표본 한 건 차이로 0.6 이 0 이 된다.

그래서 이건 "문턱을 어디에 둘까" 하는 **설계 판단이 아니라** 경사로가 증거의 **방향을 안 읽는 결함**이다.

**어떻게 고쳤나 (V33.355)** 부호가 **이미 측정돼 있으면** 경사로의 방향을 그 부호가 정한다.

```js
const _fwdNeg = (fwdIC != null && fwdIC <= ICGATE.forwardFloor);
fwdMult = _fwdNeg ? _num(P.fwdBase, 0.25) * (1 - frac)
                  : _num(P.fwdBase, 0.25) + _num(P.fwdSpan, 0.35) * frac;
```

음수면 표본이 찰수록 0 으로 내려가 `minForward` 에서 하드 리젝과 **이어진다** — 절벽이 사라진다.
고친 뒤 실측: `−0.039` 는 n=0 에서 ×0.25 → n≈209 에서 `minAdmitMult`(0.12) 아래로 떨어져 **제외**,
n=400 의 하드 리젝까지 연속이다.

**★이 수정은 어느 경우에도 배수를 올리지 않는다★** — 전진 IC 8종 × 표본 58점을 종전 공식과
전수 대조해 **오른 경우 0건**을 확인했다. 즉 **없던 합류를 만들지 않는다**(순수하게 보수적).
부호가 **아직 측정 안 된 경우**(`fwdIC == null`)는 진짜 '부족한 증거' 라 **종전과 완전히 동일**하다 —
"못 쟀다" 를 "반대다" 로 바꿔 읽지 않는다.

**게이트** `check-expert-admit` 에 5절 추가(부호를 읽는가 · 단조 감소인가 · 경계가 이어지는가 ·
종전보다 오르지 않는가 · 미측정은 그대로인가). 돌연변이 5종을 전부 잡는다.

**★그래도 한 번 더 확인할 것★**
- 이건 **가중을 깎는** 변경이다. XALPHA 처럼 전진 IC 가 음수인 채 대기 중인 위원이 있으면
  **화면에서 사라지거나 배수가 내려간다.** 그게 의도다 — 하지만 **위원 수가 줄었는지 보라**(B-6 와 겹친다).
- `forwardFloor` 는 0 이다. IC 가 **정확히 0** 이면 음수 취급이다(`<=`). 의도한 것이지만 재확인할 것.

---

---

## B-4 · 소 · 신호 컨텍스트 6칸이 영구 상수다 — 다음 판에서 반드시 빼야 한다

**증거** `LUXML.liveCtxNeutral` (V33.341). `sigWeight`·`confluence`·`stratSwing/Day/Mom/MR`
가 모든 행에서 같은 값이다(80차원 중 6칸).

**무엇이 문제인가** featNames 중간이라 **지금 빼면 인덱스가 밀려 기존 표본이 통째로 어긋난다**(불가).
**다음 featVer 상향 때 함께 제거**해야 한다. 안 그러면 영구히 죽은 입력으로 남는다.

**⚠️ 덫을 놨다 (V33.355) — 결함 자체는 아직 열려 있다**
미룬 일은 잊힌다. 이 저장소가 이미 겪었다 — V12.47 의 전략 원핫 4칸은 구버전 전략명만 매칭해
**출처 무관 영구 0** 이었고, 아무도 모르는 채 여러 판을 지났다. 그래서 사람 기억 대신 게이트를 놨다.

`check-live-only-feats` 는 `LUXML.featVer` 가 **17 을 넘는 순간 배포를 막는다.** featVer 상향은
표본을 어차피 재각인하므로 **인덱스가 밀려도 되는 유일한 시점**이고, 그때 안 빼면 다음 판까지 또 남는다.
게이트는 ① 6칸이 실재하는지 ② 인자를 4가지로 흔들어도 정말 안 변하는지(대조군 포함, **실행으로**)
③ 죽은 칸이 6개에서 **늘지 않았는지** 를 함께 본다. 돌연변이 4종을 잡는다.

**덫에 걸렸을 때 할 일**(우회 금지 — `B4_FEATVER` 를 올리는 것은 오답이다):
`LUXML.featNames` 에서 6칸 제거 · `_LIVE_ONLY_FEATS` 비우기 ·
`mlBuildFeatures` 의 중립화 블록 제거 · `tools/check-live-only-feats.mjs` 의 `B4_FEATVER` 삭제.

**주의** 중립화의 성능 효과는 시뮬레이션에서 **잡음 수준**이었다(MLP 56.69%→57.08%). 위생 목적이다.

---

## B-5 · 소 · DNN 개선이 자 교정 덕인지 표본 덕인지 못 가른다

**증거(실측)** DNN accLB: **45.66%**(09-10 04:07) → **49.70%**(09-11 01:31), **+4.04%p**. 문턱 50.5%.
**단, 같은 기간 표본이 324,821 → 988,239(3배)로 늘었다**(featVer 이관 완료, `data.stale = 0`).

**무엇이 문제인가** 개선 원인을 **이 관측만으로는 못 가른다.** 가르는 유일한 관측은 **B-1 의 부스터 비교**다.

**주의** 은닉 10층은 **사용자 지시**다. 임의로 바꾸지 말 것.
V33.204 기록: "10층 49.3% vs 워커 폴백 2층 53.3%".

---

## B-6 · 소 · 위원회가 사실상 GBDT 한 명

**증거(실측 01:31)** `committee.n = 1` · MIND(위원장) `accLB 0.5052`(문턱 0.505 턱걸이) ·
GBDT `accLB 0.5110` · DNN 미달 · 부스터 3종 판 불일치.
**B-1 이 풀리면 최대 4명까지 회복 가능**하나 각자 문턱을 넘어야 한다. **문턱을 낮춰 수를 늘리지 말 것.**

---

## B-7 · ✅ 해결(V33.348) · 확인 한번 더 · 반사실 라벨이 진입 시각을 무시했다

**증거 (코드)** `mlLabelCandidates` 의 가격 공급자 두 곳(`src/index.js:47753` · `48563`)이 **똑같이** 이렇게 생겼다:

```js
async (sym, mkt, entryTs, horizon) => {          // ← entryTs 를 받아 놓고
  const dd = await getState(DB, "daily:" + sym, null);
  const n = Math.max(1, horizon || 5) + 2;
  return { closes: dd.closes.slice(-n), … };      // ← ★한 번도 쓰지 않는다★
}
```
`entryTs` 는 **선언만 되고 본문에서 참조되지 않는다**(두 곳 모두). 함수 자신의 주석(`47767`)은
`priceLookup(symbol, market, entryTs, horizon)` 이라고 시그니처를 약속해 두었다.
소비 쪽(`47813`)도 `seg = path.slice(-(c.horizon || 5))` 로 다시 뒤에서 자른다.
→ **라벨 구간 = 진입 시각과 무관하게 언제나 '오늘 기준 마지막 horizon봉'.**

**★핵심: 코드가 스스로 적어 둔 이유가 이미 낡았다★**
`47792` 주석: *"daily 캐시에는 dates 가 없어 진입 봉을 되찾을 방법이 없다 — 없는 것을 추측하지 않는다."*
**그 전제가 V33.217 에서 사라졌다.**
- `daily:` 캐시는 이제 `days`(봉별 에폭일수)를 담는다 — `getDailyCached`(`9617-9621`).
- `_dailyCacheOk`(`9606`)가 `days.length === closes.length` 를 **강제**한다. 없는 캐시는 낡은 것으로 쳐서 다시 받는다.
- 진입 시각으로 봉을 찾는 함수도 이미 있다 — `_altBarIdx(len, ts, nowTs, days)`(`30508`).
  같은 저장소의 다른 두 곳이 **이미 그렇게 쓰고 있다**: `analystRevFitNightly`(`8596` · `8600`) · `30637`.
  V33.217 이 그 자리에 남긴 말이 그대로 여기에도 적용된다:
  *"그 환산은 공휴일·휴장을 모른다 — 지평이 실제보다 길거나 짧은 구간의 수익률로 라벨을 만들게 된다."*

**무엇이 틀어지나**
1. **라벨 창이 밀린다.** 성숙 판정은 `_calDays(h) = ceil(h×7/5)+1` 에 `_alignSlack = 4`일 여유(`47796-47797`).
   지평 10일이면 창은 진입 후 **15~19 달력일**. 19일째에 라벨되면 실제 거래일은 약 13일이고,
   `slice(-10)` 은 **진입 후 4~13일 구간**을 재게 된다. 그런데 `exitPct` 는 `c.entry_price`(0일) 기준이다.
   → 트리플배리어의 손절·익절 판정 구간과 수익률 기준점이 **서로 다른 창**을 본다.
2. **멀쩡한 표본을 버린다.** 창 밖으로 늙은 후보는 `misaligned` 로 **DELETE**(`47803`).
   "틀린 라벨을 만드느니 버린다" 는 옳은 태도지만, **지금은 틀리지 않게 만들 수 있다.**
   버려진 만큼이 곧 표본 손실이고, 표본 부족은 B-5·B-6 이 못 갈리는 이유이기도 하다.
3. **지수(alpha) 창도 같다.** `idxCloses = ic.slice(-n)`(`47759` · `48569`)도 진입 정렬이 아니다.
   V12.97 이 `ie = ic[ic.length-1-horizon]` 로 한 번 고친 것은 **만기 기준 상대 정렬**일 뿐,
   그 만기 자체가 진입과 안 맞으면 같이 밀린다.
4. 사용자가 말한 **"잡음과 구별이 안 된다"** 와 방향이 같다 — 라벨 잡음은 모델이 이길 수 없는 종류다.

**고칠 때**
```js
async (sym, mkt, entryTs, horizon) => {
  const dd = await getState(DB, "daily:" + sym, null);
  if (!_dailyCacheOk(dd)) return null;                     // days 없으면 지어내지 않는다(종전 규율 유지)
  const i0 = _altBarIdx(dd.closes.length, entryTs, Date.now(), dd.days);   // 진입 봉
  if (!(i0 >= 0)) return null;
  return { closes: dd.closes.slice(i0 + 1, i0 + 1 + horizon), … };         // 진입 ★다음★ 봉부터 horizon봉
}
```
- 소비 쪽 `seg = path.slice(-(horizon))`(`47813`)은 **없애야 한다** — 공급자가 이미 정확한 창을 준다.
  남겨 두면 두 번 자르게 되고, 지금과 같은 종류의 조용한 어긋남이 다시 생긴다.
- `_alignSlack` 폐기 여부는 그 다음 문제다. 정렬이 정확해지면 `misaligned` 삭제 경로의 존재 이유가 사라진다.
- 지수 경로도 같은 `days` 기준으로 자를 것(`_mlLoadIndexCloses` 가 `days` 를 같이 주도록).
- **게이트**: "진입 정렬" 은 문자열로 검사하면 안 된다(V33.337 교훈).
  합성 `closes`/`days` 로 `priceLookup` 을 **실제로 호출해**, 진입 3일 뒤·17일 뒤 후보가 **같은 구간**을 받는지
  (= 받으면 실패) 확인하는 방식이어야 한다.

**★고쳤다 (V33.348) — 그래도 한 번 더 확인할 것★**
- 복붙돼 있던 공급자 두 곳을 `_cfPriceLookup(DB)` 하나로 합쳤다. 한쪽만 고치면 라벨이 갈린다.
- `_dailyCacheOk` → `_altBarIdx(len, entryTs, now, dd.days)` → `closes.slice(i0+1, i0+1+h)`.
  **진입 다음 봉부터 horizon봉**(진입 당일 종가는 이미 `entry_price` 다).
- 소비 쪽의 `seg = path.slice(-horizon)` 을 **없앴다** — 두 번 자르면 같은 어긋남이 다시 생긴다.
- 지수(alpha) 창도 같은 날짜로 자른다(`_mlLoadIndexClosesDated` 신설, 길이 horizon+1).
- `days` 없는 옛 캐시는 `null` → 라벨하지 않는다. 어긋난 라벨보다 없는 라벨이 낫다(종전 규율 유지).
- **`misaligned` 폐기 경로를 없앴다** — 창을 정확히 맞출 수 있으므로 버릴 이유가 사라졌다.
  16~20일 된 후보가 이제 **버려지지 않고 올바르게 라벨된다**(표본이 그만큼 늘어난다).

**게이트** `tools/check-cf-label-align.mjs` — 문자열이 아니라 **공급자를 실제로 호출**한다.
진입 봉 20/30/40/50 이 서로 다른 창을 받는지(끝정렬이면 전부 같다), 같은 진입은 언제 라벨해도
같은 창인지, 지수 창이 같은 날짜에 걸리는지, `days` 없으면 `null` 인지.
`days` 검사에는 **대조군**을 뒀다 — 같은 계열·같은 진입인데 `days` 만 있고 없고를 비교한다.
(처음엔 대조군 없이 썼는데, 그 경우 폴백이 어차피 범위 밖을 내서 가드를 빼도 결과가 같았다 —
돌연변이 검사가 "못 잡음" 을 내며 그걸 잡아 줬다.)
돌연변이 3방향(끝정렬 복원 · 진입 당일 포함 · `days` 가드 제거) 모두 실패로 잡힌다.

**★그래도 한 번 더 확인할 것★** `[CF] 반사실 라벨링 N건 편입` 의 N 이 실제로 늘었는지,
그리고 `days` 없는 옛 캐시 때문에 `null` 이 많아 편입이 되레 줄지 않는지.
후자면 daily 라운드로빈이 한 바퀴 돌 때까지 기다리면 된다(스키마가 자연히 새것으로 바뀐다).

---

## B-8 · 치명 · ⚠️ 코드는 고쳤으나 ★실효는 재수확 때★ · 수확 표본의 시각이 가짜 달력이다

**증거 (코드)** `src/index.js:41985`:
```js
// ts는 봉 시점 근사(일봉 1개=1일)로 역산 — 시간순 검증분할의 정합 유지
const ts = baseTs - (L - 1 - i) * 86400000;
```
**일봉 1개를 달력 1일로 센다.** 실제로는 1거래일 ≈ 1.448 달력일(365/252)이다.
바로 **두 줄 위**에서 같은 봉의 진짜 날짜를 이미 쓰고 있다 — V33.265 가 넣은 `obsTs`:
```js
obsTs: (Array.isArray(dd.days) && dd.days.length === closes.length && dd.days[i] != null)
         ? _num(dd.days[i], 0) * 86400000 : null,
```
V33.265 의 주석은 이 문제를 정확히 알아보고 **달력 피처만** 고친 뒤,
`ts` 에 대해서는 *"시간순 분할에는 단조롭기만 하면 되지만"* 이라고 적고 넘어갔다.
**★그 전제가 틀렸다.★** 단조로우면 충분한 것은 **원천이 하나일 때**뿐이다.

**왜 치명인가 — 두 원천이 서로 다른 시계를 쓴다**
- 수확(`hv`) 표본: 가짜 압축 시계. 2400봉(실제 9.5년)이 2400일(6.6년)로 찍힌다.
- 실거래·반사실 표본: 진짜 시계(`Date.now()`).
- 둘은 **같은 테이블(`ml_samples`)** 에 들어가고, 학습기는 **하나로 정렬**한다 —
  `_split_ts`(`trainer/modal/modal_train.py:1286`)의 `order = np.argsort(TS)` 한 번이 전부다.
- 엠바고도 **밀리초**로 잰다(`emb = max(embargo_ms, horizon_ms)`, `1305-1306`).
  ★가짜 시계 위에서 잰 엠바고는 진짜 시간의 겹침을 막지 못한다.★

**측정 (시뮬레이션)** 실제 분할 코드와 같은 절차로 돌렸다
(수확 200종목×2400봉을 stride 로 솎아 58,400건 + 최근 1년 실거래 12,000건, `val_frac=0.2`, 엠바고 10일):
```
수확 스탬프 오차   중앙값 527일 · 최대 1,049일   (표본이 실제보다 '최근'으로 찍힌다)
검증 14,080건 중 수확 6,000건
  → 그중 1,800건(30%)이 ★자기 실제 시점보다 미래인 학습 표본★ 을 갖는다
  → 앞을 내다보는 기간: 중앙값 49일 · 최대 96일
  → 그 표본 하나당 미래 학습 표본: 중앙값 1,655건 · 최대 3,124건
실거래/반사실 검증 표본: 미래 누출 0건 (진짜 시계라 정상)
```
※ 혼합 비율은 가정이다(실제 운영은 수확 비중이 더 높다). 자릿수를 보기 위한 시뮬레이션이고,
  **분할·엠바고 코드 경로 자체는 실제 것과 같다.**
※ **재현 가능하다** — `python3 tools/repro-b8-leak.py`. 믿지 말고 돌려 볼 것.

**이것이 설명하는 것**
- 사용자가 말한 **"검증 성능이 안 나온다"** 와 **"잡음과 구별이 안 된다"** 가 한 뿌리로 모인다.
  누출은 검증을 **부풀리고**, 부풀린 검증으로 고른 모델이 실제로는 아무것도 못 하면
  화면에는 정확히 그 두 증상으로 보인다.
- B-5(DNN 개선이 자 교정 덕인지 표본 덕인지)를 못 가르는 이유이기도 하다 —
  표본이 3배로 늘 때 늘어난 쪽이 대부분 수확이면, **누출량도 같이 늘었다.**
- `_recencyW`(`34246`)도 이 ts 를 쓴다. 오래된 수확 표본이 실제보다 최근으로 보여 가중이 더 붙는다
  (하한 0.35 라 영향은 작다 — 분할 쪽이 본체다).

**고칠 때**
```js
const _d = (Array.isArray(dd.days) && dd.days.length === closes.length && dd.days[i] != null)
             ? _num(dd.days[i], 0) * 86400000 : null;
const ts = _d != null ? _d : (baseTs - (L - 1 - i) * 86400000);   // days 없으면 종전 근사(옛 캐시)
```
`obsTs` 와 **같은 식**이다. 새로 계산할 것이 없다.

**★단, 그냥 바꾸면 더 나빠진다★**
기존 98만 표본은 가짜 시계로 찍혀 있다. 새 표본만 진짜 시계로 들어오면 **한 테이블에 두 시계**가 섞여
지금보다 정렬이 더 엉킨다. 그리고 `ts` 는 행만 보고는 되돌릴 수 없다(봉 인덱스가 없다).
→ **`featVer` 를 올려 전량 재수확**하는 경로가 맞다(이 저장소가 이미 여러 번 쓴 방식이다).
  재수확 예산·소요는 `HARVEST.rebuildTarget`(700,000) 캐치업 경로가 이미 감당하게 돼 있다.

**게이트** 문자열 검사로는 안 된다(V33.337 교훈).
합성 `closes`/`days`(휴장 구간을 일부러 포함)로 수확 한 종목을 **실제로 돌려**,
나온 표본의 `ts` 가 `days[i]` 와 일치하는지 · 연속 두 표본의 `ts` 간격이 **달력일**로 벌어지는지
(주말·연휴에서 3일 이상) 확인해야 한다. 1일 고정이면 실패다.

**⚠️ 코드는 고쳤다 (V33.348) — 그러나 ★아직 낫지 않았다★**
```js
const _dayTs = (Array.isArray(dd.days) && dd.days.length === closes.length && dd.days[i] != null)
                 ? _num(dd.days[i], 0) * 86400000 : null;
const ts = (_dayTs != null && _dayTs > 0) ? _dayTs : (baseTs - (L - 1 - i) * 86400000);
```
`obsTs` 와 같은 식이다. **하지만 이 한 줄만으로는 효과가 거의 없다** — 정직하게 적는다:

진행 중인 수확은 **프런티어 봉만** 더한다(`startI = lastEnd - missed + 1`). 그 자리에서는
가짜 시계와 진짜 시계가 거의 일치한다(오차는 `baseTs` 에서 과거로 누적된다).
**이미 적재된 98만 표본의 압축된 `ts` 는 그대로 남는다.**

**★남은 일 — 이건 사람이 정해야 한다★**
실효를 보려면 **`featVer` 를 올려 전량 재수확**해야 한다(`HARVEST.rebuildTarget` 700,000 캐치업
경로가 그 일을 하도록 이미 만들어져 있다). 그러면 **98만 표본이 한 번에 무효가 되고** 모델이
며칠 동안 얕은 표본으로 돌아간다. 실거래 계좌라 그 대가를 조사자가 임의로 치를 수 없다.
→ **사용자·Codex 가 시점을 정할 것.** 코드는 준비돼 있다.
→ 표본을 지키고 싶다면 대안이 있다: `strategy='hv'` 행만 지우고 수확 재개점(`hv_seen`)을
  초기화해 **수확만** 다시 돌린다. 실거래·반사실 표본(진짜 시계)은 그대로 보존된다.

**게이트** 아직 없다 — 재수확 시점을 정할 때 위 방식으로 같이 만들 것.

---

## B-9 · 치명 · ✅ 해결(V33.350) · 확인 한번 더 · 학습 작업이 예산을 넘겨 죽고, MIND 뒤 단계가 ★한 번도 안 돌고★ 있었다

**사용자 보고** "github에 modal 학습 push전부다 실패하고 있던데".

**증거 (GitHub Actions run #114, 2026-09-13 00:33 · 표본 1,053,656)** 3600s 예산의 소비:

| 단계 | 소요 | 누적 |
|---|---|---|
| ① 표본 수집 (1,053,656건) | 4분 54초 | 4:54 |
| ② DNN 6시드 | **32분 30초** ← ★예산의 54%★ | 37:24 |
| ④ 업로드 | 22초 | 37:46 |
| ⑤ GBDT | 8분 51초 | 46:37 |
| ⑥ 부스터 3종 | 2분 23초 | 49:00 |
| 시장별(US·KR) | 5분 58초 | 54:58 |
| ⑦ MIND | 4분 51초 지점에서 **`FunctionTimeoutError: hit its timeout of 3600s`** | **60:00** |

**두 가지가 동시에 깨져 있었다**
1. **뒤 단계가 구조적으로 굶었다.** MIND 뒤의 단타·SEQ·MEMO·STACK 경계 통지는 매 회차
   ★같은 자리에서 잘린다.★ 크론이 6시간마다 돌아도 영원히 같은 지점에서 죽으므로
   **한 번도 실행되지 않는다.** 시뮬레이션으로 확인했다(6회차 = 36시간):
   ```
   회전 없음: gbdt 6 · boosters 6 · scalp 6 · markets 0 · mind 0 · seq 0 · memo 0
   ```
2. **성공이 실패로 묻혔다.** 죽기 전에 GBDT·부스터·US/KR 모델은 정상 업로드됐는데
   (`activated: true`), Modal 이 작업을 죽이므로 워크플로는 빨간 실패로 끝난다.
   `workflow_dispatch` 실행 #107·108·109·112·113·114 가 전부 이 모양이다.
   `push` 실행은 `modal deploy` 만 하고 끝나 초록이라, 화면만 봐서는 문제가 안 보였다.

**고친 방법 — ★타임아웃을 늘리지 않았다★**
크론이 6시간마다 도므로 지금도 하루 4 GPU-시간(T4)을 쓴다. 3시간으로 늘리면 청구가 그만큼 늘고,
표본은 앞으로도 계속 는다. 늘리는 것은 문제를 뒤로 미루는 것이다.
- **예산 관문**(`_stage`) — 남은 시간이 그 단계의 예상 소요보다 적으면 **죽지 말고 건너뛴다.**
- **회전**(`_rotate_plan`) — 다음 회차는 **건너뛴 그 단계부터** 시작한다. 굶는 단계가 없어진다.
  ```
  회전 있음: gbdt 1 · boosters 3 · markets 1 · mind 1 · scalp 3 · seq 1 · memo 2  (굶은 단계 0)
  ```
- **실측 적립**(`_next_cost`) — 예상 소요를 추측이 아니라 관측 ×1.2 로 갱신한다(`modal.Dict`).
- **시드 단위 가드** — 다음 시드를 돌릴 예산이 없으면 거기서 멈추고 있는 앙상블로 진행한다.
  ★모자란 앙상블이 없는 앙상블보다 낫다★ — 종전엔 여기서 죽으면 앙상블이 통째로 사라졌다.
- **정의 단일화** — 단계 정의가 두 벌(`target` 복구 경로 · 본 경로)이라 MIND 하이퍼파라미터가
  복사돼 있었다. `_PLAN` 한 곳으로 합쳤다(이 저장소가 세션 창·라벨 공급자에서 겪은 그 사고 예방).
- **워크플로 요약** — 무엇을 돌리고 무엇을 건너뛰었는지 `$GITHUB_STEP_SUMMARY` 에 올린다.

**같이 잡힌 것 — 매 회차 나던 NameError**
로그의 `고유도 필드 생략: name '_dnn_uw' is not defined` 는 진짜 버그였다.
업로드부가 학습 함수의 **지역변수**를 참조했다. 그래서 `valNEff`·`valUniq` 가
**한 번도 워커에 올라간 적이 없다**(실측 응답 `"valUniq": null`). 반환 dict 에 실어 보내게 고쳤다.

**같이 정정한 문구** `캘리브레이션: … 검증 전반 0건으로 선택` — V33.341 이 τ* 를 보정(cal) 구간으로
옮긴 뒤 이 문장은 "아무 데서도 안 골랐다" 로 읽혔다. 실제 출처(보정구간 N건)를 적게 했다.

**게이트** `tools/check-trainer-budget.mjs` — 파이썬 헬퍼를 **실제로 실행**한다(문자열 검사 아님).
회전의 순열 보존 · 예산 판정 · 실측 적립 · **굶주림 시뮬레이션**(회전 없으면 굶는 단계가 생기고,
켜면 안 생긴다) · AST 로 7단계가 전부 관문을 지나는지 · `_dnn_uw` 누수 재발 방지.
돌연변이 7방향 전부 잡힌다. `check-recovery-provenance`(Codex)도 새 구조에 맞춰 갱신했다 —
이제 6개 target 각각이 자기 학습기 하나만 부르는 것까지 확인한다.

**★그래도 한 번 더 확인할 것★**
1. **다음 실행이 초록으로 끝나는지** — 그리고 요약에 `⏭ … 생략` 이 몇 개 뜨는지.
2. **modal.Dict 가 실제로 되는지** — 권한이 없으면 `상태 저장소 없음` 이 찍히고 **회전이 꺼진다.**
   그러면 굶주림이 그대로 남는다. 이 한 줄을 반드시 확인할 것.
3. **DNN 이 여전히 예산의 절반을 먹는다.** 그런데 이 판 실측은 `valAcc 49.98%` · `AUC 0.501` ·
   `블록IC -0.0023` — ★동전과 구별되지 않는다★(트레이너 자신이 "AUC<0.52 판별력 약함" 이라 찍는다).
   32분을 계속 여기 쓸지는 **사람이 정할 문제**다. 줄이려면 `SEEDS_OVERRIDE`(6) 나
   에폭(120)을 낮추면 된다 — 조사자가 임의로 바꾸지 않았다.
4. **실거래 표본이 35건뿐이다**(`수확 1,053,621 · 실거래 35`). B-7 고침으로 반사실 라벨이
   늘어야 하는데, 다음 학습 로그의 이 숫자로 확인된다.

---

# C. 성능 · 처리량

## C-1 · 중 · 종목당 평가 비용이 17배로 뛰고 커버리지가 무너졌다 (원인 미isolated)

**증거(실측, 같은 로그 계열)**

| 시각 | 종목당 평균 | KR 평가 | 한바퀴 |
|---|---|---|---|
| 09-10 04:07 | **100ms** | 86/447 (19%) | ~7사이클 |
| 09-10 11:41 | — | 47/335 (14%) | ~13사이클 |
| 09-11 01:31 | **1732ms** | 13/447 (3%) | **~90사이클** |

01:31 내역: `부가조회 5701/7200ms · SEQ 8종목 0ms — scalp 4755ms, flow 946ms ·
느린종목 130680.KS:1681ms, 443060.KS:2078ms, 039030.KQ:1702ms`

**계산** 13종목 × 1732ms ≈ 22.5초 중 부가조회는 5.7초다. **나머지 ~17초가 평가 자체**이고,
04:07 에는 그 몫이 종목당 ~14ms 였다.

**무엇이 문제인가** AI 가 한 사이클에 유니버스의 **3%** 만 본다. KR 6.5시간 세션이면 하루 몇 바퀴에 그친다.
`SCALPQ.perCallMs: 2000` 상한이 있지만 느린 종목이 1681~2078ms 라 **상한 바로 아래**여서 거의 안 걸린다.

### ★원인의 절반을 찾았다 (V33.347) — 계측이 문제 부분을 안 보고 있었다★

`_phase` 버킷은 여섯 개가 선언돼 있었지만(`scalp/flow/opt/intra/decide/news`)
**`decide` 와 `news` 는 한 번도 기록되지 않는 죽은 키**였고, 로그도 네 개만 찍었다:
```js
for (const _k of ["scalp", "flow", "opt", "intra"]) ...   // 종전
```
즉 **종목당 시간의 ~75%(22.5초 중 ~17초)가 통째로 계측 밖**이었다.
V33.172 가 이 계측을 넣을 때의 원인은 부가조회였고 그래서 거기만 쟀다 — **이번 원인은 거기가 아니다.**
재는 곳이 없으니 원인을 격리할 수가 없었던 것이다.

**V33.347 에서 한 것(계측만, 동작 변경 0)**
- 버킷 추가: `decide`(위원회 채점) · `feat`(피처 조립) · `sig`
- `mlDeepDecide` 두 호출 지점(주 경로·후보 경로)을 `_phaseRun("decide", …)` 로 감쌈
- 동기 작업용 `_phaseSync` 추가 → `mlBuildFeatures` 를 `feat` 로 계측
- 로그가 **모든 버킷 + `기타`(잔여 = 총시간 − 알려진 합)** 를 찍는다

**다음 작업자가 할 일** 배포 후 `[EVAL-COST]` 한 줄이면 범인이 나온다.
`decide` 가 크면 위원회 채점(모델 수·트리 수·MEMO 프로토타입)을 보고,
`기타` 가 여전히 크면 그 구간을 다시 쪼갠다. **더 이상 추측할 필요가 없다.**

**아직 미확정** 어느 구성요소가 커졌는지는 다음 사이클 로그로 확정된다.

---

## C-2 · ✅ 해결(V33.352) · 확인 한번 더 · `/api/selfcheck` 가 24~29초 걸렸다

**증거** 프로브 3회 전부 24~29s (09-10 11:41 / 13:21, 09-11 01:31).
SWR 캐시가 있어도 갱신 경로가 그만큼 D1 을 쓴다.
**주의** V33.344(Claude)가 `pipe` 조회(상태 3건 + `ai_stage:` 범위 스캔)를 추가해 **조금 더 늘렸다.**

**원인 (코드)** 한 요청 안에서 `ml_samples`(약 98만 행)를 **세 번** 훑고 있었다:
```sql
SELECT COUNT(*) FROM ml_samples WHERE featver=?                                  -- 총량
SELECT COUNT(*) FROM ml_samples WHERE featver=? AND COALESCE(ins_ts, ts)>=?      -- 24h
SELECT COUNT(*) FROM ml_samples WHERE featver=? AND COALESCE(ins_ts, ts)>=?      -- 7d
```
뒤 둘은 `COALESCE(ins_ts, ts)` 라 **인덱스를 못 탄다** — 그 구간을 행 단위로 계산한다.

**★그런데 이미 고쳐 놓은 함수가 있었다★** `_mlCountsCached` 는 `GROUP BY featver, strategy`
한 방으로 같은 값을 내고 60초 공유 캐시까지 갖고 있다. V12.130b 가 `/api/ml-status` 의
**100초 지연**을 고치며 만든 바로 그 함수다. **자가진단만 그걸 안 쓰고 자기 COUNT 를 따로 날렸다** —
C-3(FLOW 일봉)과 정확히 같은 모양이다: *처방은 있는데 새로 쓴 코드가 그걸 모른다.*

**★고쳤다 (V33.352) — 그래도 한 번 더 확인할 것★**
- 최근 유입(24h·7d)을 `_mlCountsCached` 안으로 옮겨 **`CASE` 합 한 번**으로 낸다(2 스캔 → 1).
- 자가진단은 그 캐시를 읽는다. **요청당 무거운 `ml_samples` 스캔 3회 → 0회**(캐시 적중 시).
- 재학습 디스패치(`_luxAutoRetrainModal`)의 COUNT 는 **되돌렸다** — 야간 1회 경로라
  캐시를 끌어오면 의존만 늘고 얻는 게 없다. 처음엔 그것까지 바꿨다가 게이트가 잡아 줘서 되돌렸다.
  (그 한 줄이 selfcheck 비용이라는 조사자의 읽기가 틀렸다.)

**게이트** `check-fwd-ledger` 의 `ins_ts` 검사를 **글자에서 행동으로** 바꿨다 —
`_mlCountsCached` 를 기록용 가짜 DB 로 돌려 **어떤 SQL 을 실제로 던지는지** 본다
(종전엔 소스에서 `COALESCE(ins_ts, ts)>=` 를 글자로 찾아, 띄어쓰기가 달라지자 깨졌다).

**★그래도 한 번 더 확인할 것★** 배포 뒤 `/api/selfcheck` 실측이 실제로 줄었는지.
안 줄면 병목은 `ml_samples` 가 아니라 다른 곳이다 — 남은 후보는 `logs` 400행 조회 2건과
`pipe` 의 `ai_stage:` 범위 스캔이다.

---

## C-3 · 중 · ✅ 해결(V33.348) · 확인 한번 더 · FLOW 일봉 전량을 매 사이클·매 시장 통째로 읽었다

**증거 (코드)** 시장 루프 안(`src/index.js` 19678 부근)에 이 한 줄이 캐시 없이 있었다:
```js
const _dr = await DB.prepare("SELECT k, v FROM state WHERE k >= 'daily:' AND k < 'daily;'").all();
```
`daily:` 전량 — 약 1,000종목 × 320~2,400봉 × 5배열(종가·시가·고가·저가·거래량)을 읽고
전부 `JSON.parse` 한 다음, **쓰는 것은 마지막 70봉뿐**이다. 수 MB 를 받아 수십 KB 를 쓰고 버린다.
그 자리 주석은 "사이클당 1회" 라고 적혀 있었지만 블록이 시장 루프 안이라 **시장 수만큼** 돈다.

**★같은 파일이 이미 같은 처방을 적어 뒀다★** — 450줄 위(19228)의 **똑같은 쿼리**에
V12.131 이 10분 아이솔레이트 캐시를 붙이며 이렇게 남겼다:
*"이 쿼리는 977종목의 일봉 전체(합계 수 MB)를 매 사이클·매 시장마다 D1에서 통째로 읽고
파싱했다 … prefetch 지연·D1 부하의 큰 축"*. 그 뒤에 **캐시 없는 복제본**이 여기 다시 들어왔다.
거래 사이클과 같은 D1 큐를 쓰므로 이것이 곧 `D1 DB is overloaded` 의 재료다.

**고친 방법** `flowDailyCacheLoad(DB)` 로 빼내고 **자른 결과(70봉)를** 10분 캐시했다 —
그래야 D1 왕복뿐 아니라 파싱 비용까지 같이 아낀다. 함수로 뺀 이유는 게이트가 **실제로 두 번 호출해**
왕복이 한 번인지 세기 위해서다(문자열 검사로는 지킬 수 없다).
신선도: 일봉은 하루 단위로 바뀌고 당일 마지막 봉만 장중에 움직인다. FLOW/XALPHA 는 60~70봉 창의
형식알파라 마지막 봉 10분 지연이 판정을 뒤집지 않는다(19228 과 같은 TTL).

**검증** `tools/check-daily-bulk-cache.mjs` — 2회 호출 → 왕복 1회, TTL 경과 후 → 2회,
지수(`^`) 제외, 70봉 절단 확인. 돌연변이(캐시 제거 · TTL 무시) 둘 다 잡힌다.

**★그래도 한 번 더 확인할 것★** 배포 뒤 사이클 시간과 `[EVAL-COST]` 의 `기타` 잔차가
실제로 줄었는지. C-1 의 미해명 잔차 일부가 여기였을 수 있다 — 줄지 않으면 C-1 은 여전히 열려 있다.

---

## C-4 · 중 · ✅ 해결(V33.348) · 확인 한번 더 · 학습 export 가 페이지마다 98만 행을 다시 셌다 + prefix LIKE 전체 스캔

**① `/api/ml-export` 의 `total`**
`SELECT COUNT(*) FROM ml_samples WHERE featver=? AND ts<=?` 를 **페이지마다** 실행했다.
그런데 `total` 은 `(featVer, anchorTs)` 가 같으면 **정의상 변하지 않는다** — `anchorTs` 가 집합을
고정하기 때문이다(그러라고 V11.1 이 앵커를 넣었다). 트레이너는 2만건씩 50여 페이지를 당겨가므로
**학습 1회당 98만 행 COUNT 를 50여 회** 돌린 셈이고, 그 시간 내내 거래 사이클과 같은 D1 큐를 썼다.
→ `mlExportTotalCached(DB, featVer, anchorTs)` 로 키 캐시. 같은 키면 같은 답이라 신선도 손실이 없다.

**② `univHealthNightly` 의 prefix LIKE**
```js
SELECT k, updated_ts FROM state WHERE k LIKE 'daily:%'
```
SQLite 의 LIKE 최적화는 기본 설정(대소문자 무시 LIKE)에서 **꺼져 있다.** 그래서 이 한 줄이
`state` 테이블 **전 행**(일봉 blob + `hist:`·`quote:`·`chart:` …)을 훑었다. 실제 쿼리계획으로 확인:
```
LIKE  → SCAN state
범위형 → SEARCH state USING INDEX sqlite_autoindex_state_1 (k>? AND k<?)
```
같은 파일의 다른 `daily:` 조회는 **전부** 범위형을 쓰고 있었다 — 여기만 빠져 있었다.
`':'` 다음 문자가 `';'` 이라 집합이 정확히 같다(게이트가 두 집합의 동일성도 확인한다).
→ 범위형으로 치환.

**검증** `tools/check-daily-bulk-cache.mjs` — 51회 요청 → COUNT 1회, `anchorTs` 가 바뀌면 2회.
쿼리계획 대조 + 집합 동일성 + "소스에 prefix LIKE 로 `state` 를 긁는 SELECT 가 없다" 까지 본다.
돌연변이(캐시 제거 · LIKE 복원) 둘 다 잡힌다.

**★그래도 한 번 더 확인할 것★** 다음 Modal 학습 실행 때 `export 5xx` 재시도 로그가
사라졌는지. 남아 있으면 병목이 COUNT 가 아니라 본문 페이지 쪽이다.

---

# D. 원장 · 비용

## D-1 · 중 · ✅ 해결(V33.354) · 확인 한번 더 · 비용 함수의 "데이터" 변경이 원장을 소급해서 다시 썼다

**증거** `computeCashFromTrades`(`src/index.js:11549`)는 과거 체결을 **매번 재생**하며
`_krSellTaxRate(cfg, symbol, market, ts)` 와 `_slipRate(market, ts)` 를 다시 부른다.
두 함수는 **규칙 변경**에 대해서는 시행일 상수를 둔다(`ETF_TAX_EXEMPT_FROM`, `EXT_SLIP_FROM`) — 좋다.
그런데 `ETF_SYMBOLS` **집합 자체**는 날짜가 없다.

**무엇이 문제인가** 어떤 종목을 `ETF_SYMBOLS` 에 **나중에 추가**하면, 시행일 이후의 **과거 매도 전부**가
비과세로 재계산되어 **현금 잔고가 소급해서 바뀐다.** 규칙은 날짜로 지켰는데 **집합 멤버십은 안 지켰다.**

**추가로** `cash_ckpt` 는 과거 구간을 얼려 두므로, 소급 변경이 **체크포인트 이전 구간에는 반영되지 않는다**
→ 같은 원장이 체크포인트를 기준으로 **두 규칙으로 계산된다.**

**★git 이력을 봤다(미확인 해소)★** 최근 **200 커밋** 동안 `ETF_SYMBOLS` 의 **내용은 한 번도 바뀌지 않았다**.
즉 ★지금까지 이 결함으로 실제 현금이 소급해서 틀어진 적은 없다★ — 터지지 않은 지뢰였다.
(그래서 심각도는 "중" 이고, 고친 것은 **앞으로 ETF 를 추가할 때**를 위한 것이다.)

**어떻게 고쳤나 (V33.354)** 집합 멤버십에도 **날짜를 붙일 자리**를 만들었다.

```js
const ETF_TAX_MEMBER_FROM = {
  // "종목코드.KS": Date.UTC(연, 월-1, 일),   ← 집합에 새로 넣은 날
};
function _etfTaxExemptAt(symbol, ts) {
  if (!symbol || !ETF_SYMBOLS.has(symbol)) return false;
  const from = ETF_TAX_MEMBER_FROM[symbol];
  if (from == null) return true;            // 처음부터 있던 28종 → 종전과 동일
  return (typeof ts === "number" && isFinite(ts) && ts > 0) ? ts >= from : false;
}
```

`_krSellTaxRate` 는 이제 `ETF_SYMBOLS.has(symbol)` 대신 `_etfTaxExemptAt(symbol, ts)` 를 부른다.
**기존 28종은 `ETF_TAX_MEMBER_FROM` 에 없으므로 `from == null` → 종전과 완전히 같은 값**이 나온다
(즉 이 수정 자체는 과거 현금을 **1원도 바꾸지 않는다**. 그게 요점이다).
앞으로 종목을 추가할 때 **추가한 날**을 같이 적으면, 그날 이전 매도는 과거대로 과세된 채 남는다.

**게이트** `check-ledger-retro` — 28종 **기준 명단(BASELINE)** 을 박아 두고
① 집합이 늘어났는데 `ETF_TAX_MEMBER_FROM` 에 날짜가 없으면 **실패**,
② 날짜가 미래거나 말이 안 되면 실패,
③ 시행일 전후로 세율이 실제로 갈리는지 **실행으로** 확인,
④ 같은 원장을 두 번 재생하면 같은 현금이 나오는지(회계 결정성) 확인한다.
돌연변이 4종(날짜 무시·집합 확대·시행일 뒤집기·경계 부등호)을 전부 잡는다.

**★그래도 한 번 더 확인할 것★**
- `cash_ckpt` 이전 구간은 여전히 **얼어 있다.** 이 수정은 "앞으로 소급이 안 생기게" 막은 것이지,
  **이미 얼어 있는 체크포인트를 검증한 것이 아니다.** 체크포인트 재계산은 D-3 중복행 정리와 함께 볼 것.
- 한국 ETF 를 새로 넣는 사람이 **`ETF_TAX_MEMBER_FROM` 에 날짜 적는 것을 잊으면** 게이트가 막는다 —
  막히면 우회하지 말고 **날짜를 적을 것**.

---

## D-2 · ✅ 해결(V33.348) · 확인 한번 더 · 한국 증권거래세율이 2년째 법정세율과 달랐다

**증거 (코드)** `src/index.js:3601` → `krSellTax: 0.0018` — **연도 구분 없는 단일 상수**.
`_krSellTaxRate`(`11481-11490`)는 `ts` 를 받지만 그 시각을 **ETF 면제 시행일(`ETF_TAX_EXEMPT_FROM`, `11470`)
판정에만** 쓰고, ★세율 자체는 언제 체결됐든 0.18%★ 를 돌려준다.

**증거 (법)** 증권거래세 + 농어촌특별세 합산 매도 세율은 해마다 바뀌었다:

| 체결 연도 | 코스피 | 코스닥 | 코드가 쓰는 값 |
|---|---|---|---|
| 2024 | 0.03% + 농특 0.15% = **0.18%** | **0.18%** | 0.18% ✔ |
| 2025 | 0.00% + 농특 0.15% = **0.15%** | **0.15%** | 0.18% ✘ (0.03%p 과대) |
| 2026~ | 0.05% + 농특 0.15% = **0.20%** | 0.20%(농특세 없음) = **0.20%** | 0.18% ✘ (0.02%p 과소) |

2026년분은 2025-12 개정으로 **2026-01-01 이후 양도분부터** 적용된다.
출처: [머니투데이 2025-12-30](https://www.mt.co.kr/stock/2025/12/30/2025123015472118920) ·
[연합 2025-12-01(코스피 0.05%·코스닥 0.20%)](https://news.nate.com/view/20251201n26338) ·
[2026 달라지는 것](https://news.nate.com/view/20251231n05425)

**무엇이 틀어지나**
1. **원장이 현금을 실제보다 많게 적는다.** 2026년 KR 매도마다 매도대금의 0.02% 가 덜 차감된다.
   현금은 `computeCashFromTrades` 로 재생되므로 이 오차는 **누적**된다.
2. **그 pnl 이 학습 라벨이 된다** — 비용을 낮게 잡는 것은 수익을 지어내는 것과 같다(`11493` 주석이
   스스로 한 말이다). 켈리·사이징이 부풀린 엣지 위에서 크기를 정한다.
3. 2025년 구간은 반대로 **과대** 계상이라, 두 오차가 서로 상쇄되지 않고 구간별로 부호가 다르다.

**고칠 때 — 구조는 이미 있다, 상수만 없다**
`ETF_TAX_EXEMPT_FROM` / `SLIPPAGE_FROM` / `EXT_SLIP_FROM` 과 **같은 시행일 규율**을 그대로 쓴다.
V33.87 이 세운 원칙("회계 규칙 변경은 소급하지 않는다")이 여기서도 답이다 — 실제 세법과도 같다.

```js
// 체결 시각의 연도로 세율을 고른다. 소급하지 않는다 — 체크포인트 유무와 무관하게 같은 답이 나와야 한다.
const KR_SELL_TAX_BY_YEAR = { 2024: 0.0018, 2025: 0.0015, 2026: 0.0020 };  // 이후 연도는 마지막 값 유지
```
`_krSellTaxRate` 안에서 `getKST(new Date(ts)).year` 로 고른다(UTC 연도가 아니다 — 12/31 체결이 밀린다).
`cfg.krSellTax` 는 **폴백/오버라이드**로만 남긴다.
※ 코스피/코스닥 합산세율이 2026 기준 둘 다 0.20% 라 시장 구분은 아직 불필요하지만,
  구성(거래세 vs 농특세)이 다르므로 앞으로 갈릴 수 있다 — `.KS`/`.KQ` 로 갈라 둘 자리는 만들어 두는 게 안전하다.
※ ETF 면제(`11488`)는 증권거래세 쪽 규정이라 그대로 위에 얹으면 된다.

**★고쳤다 (V33.348) — 그래도 한 번 더 확인할 것★**
```js
const KR_SELL_TAX_BY_YEAR = { 2023: 0.0020, 2024: 0.0018, 2025: 0.0015, 2026: 0.0020 };
```
`_krSellTaxRate` 가 `getKST(new Date(ts)).year` 로 고른다 — **UTC 가 아니다.**
UTC 로 재면 KST 12/31 밤 체결이 다음 해로 밀린다(게이트가 그 경계를 실제로 확인한다).
`cfg.krSellTax` 는 폴백으로만 남겼다(`ts` 가 없으면 종전 동작).
**소급하지 않는다** — 체결 시각의 연도로 고르므로 `cash_ckpt` 가 지워져 전 구간을 재생해도
같은 잔고가 나온다(V33.87 회계 결정성 원칙 그대로).
표 밖 연도는 **가장 가까운 끝 연도**로 잇는다 — 미래 연도가 0% 가 되면 그 해 내내 세금을 한 푼도
안 물게 된다. (처음엔 `_num(k,0)` 으로 키를 읽었는데 키가 문자열이라 전부 0 이 됐고,
2027년 케이스가 0% 를 내며 잡혔다. `parseInt` 로 고쳤다.)

**게이트** `tools/check-kr-selltax.mjs` — 함수를 실제로 호출한다. 연도별 값 · KST 연 경계 ·
표 밖 연도가 0% 가 아님 · 같은 `ts` 는 항상 같은 답(소급 없음) · USD 슬리브 무세금 · ETF 면제 시행일.
돌연변이 3방향(단일 상수 복원 · UTC 연도 · 표 밖 0%) 모두 잡힌다.

**★그래도 한 번 더 확인할 것★**
1. **연초마다 이 표가 그 해를 담고 있는지 다시 볼 것.** 세법은 바뀐다. 안 담고 있으면 가장 최근
   연도 값을 잇는데, 그게 맞다는 보장은 없다.
2. **과거 원장은 고치지 않았다**(소급 금지). 2025년 체결분은 0.03%p 과대, 2026년 체결분은
   0.02%p 과소로 이미 적혀 있고 그 오차가 현금 잔고에 남아 있다 —
   바로잡을지는 D-1(소급 정책)과 함께 판단할 것.

---

## D-3 · 치명 · ✅ 해결(V33.348) · 확인 한번 더 · D1 재시도가 매수 원장을 두 번 적을 수 있었다

**어떻게 찾았나** "오버로드 걸리는 문제 더 찾아서" 를 쫓다가 재시도 래퍼에서 나왔다.

**증거 (코드)** `wrapD1` / `__d1Attempt`(`src/index.js:9871` 부근)는 과부하성 오류에서
**모든** D1 호출을 최대 5회 재시도한다. 그 판정(`__d1IsOverload`)에 들어 있는 두 문자열이 문제다:
```
"network connection lost"
"storage operation exceeded timeout"
```
둘은 **결과를 모르는 실패**다 — 쓰기가 이미 커밋됐는데 응답만 유실됐을 수 있다. 그때 재시도하면
같은 `DB.batch([trade, position])` 가 두 번 돈다.

**매도는 원래 안전했다.** `stmtRecordTradeIfPos` 의 `EXISTS(포지션이 아직 기대수량인가)` 가
두 번째 실행에서 거짓이 되어 0행이 된다(V33.129 가 다른 이유로 만들어 둔 것이 여기서도 방어가 됐다).
**★매수만 맨 `INSERT` 였다.★**
- `positions` 는 절대 upsert(`stmtSavePosition`)라 두 번 써도 같은 값 → 멱등
- `trades` 는 맨 INSERT → **행이 하나 더 생긴다**

그런데 **현금은 원장 재생(`computeCashFromTrades`)으로 파생된다.** 즉 중복 행 하나가 그대로
**매수대금 이중차감**이다. 자산은 한 번 치인 수량인데 돈만 두 번 나간다 —
이 저장소가 반복해서 겪은 "조용히 사라지는 돈" 의 또 다른 입구다.
`isDuplicateRecentTrade`(120초 창)는 배치 **앞**에서 도는 검사라 이 재시도를 막지 못한다.

**고친 방법** 같은 자연키(`ts·market·symbol·side·qty·price`)가 이미 있으면 INSERT 하지 않는
조건부 INSERT 로 바꿨다. `ts` 는 재시도 전에 한 번 잡히므로(바인딩 고정) 중복 시도는 정확히 같은
키로 들어온다. 서로 다른 진짜 체결이 ms 단위로 전부 같을 수는 없다. 비용은 `idx_trades_ts` 를 타는
EXISTS 서브쿼리 1회. **매도 경로는 이미 조건부라 손대지 않았다**(중복 조건을 두 벌 두지 않는다).

**검증** `tools/check-ledger-idempotent.mjs` — 실제 SQLite 에 문장을 돌린다.
같은 자연키 재시도 2회 → 1행 유지 / 서로 다른 6가지 체결은 전부 기록 / 매도 조건부 동작 불변.
돌연변이 2방향(맨 INSERT 로 되돌리기 · 자연키에서 `ts` 빼기) 모두 실패로 잡힌다.

**★그래도 한 번 더 확인할 것★**
1. **이미 생긴 중복 행이 있을 수 있다.** 이 고침은 앞으로만 막는다.
   **손으로 SQL 을 칠 필요는 없게 해 뒀다** — `auditAccounting` 이 시장별 **1시간 스로틀**로
   같은 모양의 쿼리를 돌려, 있으면 `[AUDIT] … LEDGER_DUP(N건/초과 M행: …)` 으로 ERROR 를 남긴다.
   **★세기만 하고 지우지 않는다★** — 원장을 소급해 고치는 일은 현금 체크포인트와 얽혀 있어(D-1)
   자동으로 할 일이 아니다. 보이게만 하고 판단은 사람이 한다.
   직접 보려면:
   ```sql
   SELECT ts, market, symbol, side, qty, price, COUNT(*) c
   FROM trades GROUP BY ts, market, symbol, side, qty, price HAVING c > 1;
   ```
   나오면 **현금이 그만큼 잘못 파생돼 있다.** 지우기 전에 `cash_ckpt` 와의 관계를 볼 것
   (체크포인트 **이후** 구간만 재생에 반영된다 — 그 앞은 이미 굳은 값이라 지워도 안 돌아온다).
2. 다른 맨 INSERT 가 남아 있는지: `ml_samples`·`logs` 등은 중복돼도 돈이 아니라 잡음이지만,
   돈에 닿는 테이블이 `trades` 말고 또 있는지 한 번 훑을 것.

---

# E. 관측 · 운영

## E-1 · ✅ 해결(V33.352) · 확인 한번 더 · 반복 경고가 진짜 사고를 묻었다

**증거(실측 01:31)** TIME-CAP **43회** · MLOPS **23회** · 기타 **13회** 반복 집계.
**선례** 09-10 에 `[FETCH] 평가가능 0종목` ERROR 가 21회로 집계되는 동안 실제 원인은 전혀 다른 것이었다
(일봉이 아니라 시간외 가드). 같은 문장이 수십 번 쌓이면 **새 사고가 그 사이에 묻힌다.**
로그 보존은 전체 1,500행 + ERROR/WARN 1,000행이다. 한 문장이 43줄을 먹으면 그만큼 다른 사건이 밀려 사라진다.

**★고쳤다 (V33.352) — 묶되 지우지 않는다★**
`log()` 안에서 같은 문장을 10분 창으로 묶는다.
- **`ts` 는 첫 발생 그대로 둔다.** 갱신하면 그 줄이 계속 맨 위로 올라와 새 사건을 아래로 밀어낸다 —
  **고치려던 것과 같은 일이 된다.** 대신 본문에 `(×43 · 최근 12초 전)` 을 실어 "지금도 난다" 를 말한다.
- **새 문장은 언제나 새 줄.** 레벨·심볼·문장이 하나라도 다르면 다른 사건이다.
- 숫자는 자리표시(`#`)로 바꿔 묶는다 — `TIME-CAP 1.2s` 와 `1.5s` 는 같은 사건이다.
- 창이 지나면 새 줄을 만든다 — "아직도 난다" 가 시간축에 보여야 한다.
- **통계(`__engineErrCount`)는 건드리지 않는다** — 화면의 "오늘 에러 N건" 은 줄 수가 아니라 사건 수다.

**게이트** `tools/check-log-dedup.mjs` — 가짜 D1 에 **실제 `log()` 를 돌린다.**
43회 → 1줄 · `ts` 불변 · 반복 30회 뒤 새 사고가 그대로 남음 · 심볼/레벨 분리 · 창 만료 ·
묶음표 크기 제한 · DB 가 던져도 호출부가 안 죽음 · **통계는 사건 수**.
가짜 D1 이 `ts` 를 건드리는 UPDATE 를 **거부**한다 — 그렇게 하지 않으면 그 회귀를 못 잡는다
(실제로 처음엔 못 잡았고, 돌연변이 검사가 그걸 알려 줬다).

**★그래도 한 번 더 확인할 것★** 묶음은 아이솔레이트 메모리다. 아이솔레이트가 갈리면
그쪽에서 한 줄이 더 생긴다 — 정확성 문제가 아니라 절약폭 문제다.
화면에서 `(×N)` 이 실제로 보이는지, 그리고 **새 ERROR 가 반복 줄 위에 뜨는지** 확인할 것.

## E-2 · 소 · ✅ 해결(V33.354) · 확인 한번 더 · 조용히 삼키는 catch 중 ★실패가 성공처럼 보이는★ 4곳

**증거** 빈 catch 는 이제 **1,045곳**이다(`catch\s*(\(x\))?\s*{\s*}` 기준.
원래 적힌 922 는 `catch (e) {}` 한 가지 철자만 센 것이라 과소집계였다 — 같은 철자만 세면 지금도 917곳이다).
전부가 문제는 아니다 — 대부분은 **선택적 보강**(있으면 좋고 없어도 판단이 안 바뀌는 것)이다.

**★분류했다(미확인 해소)★** 1,045곳을 전수로 훑어 **돈이 움직이는 경로**만 골랐다.

| 구분 | 개수 | 처리 |
|---|---|---|
| 전체 빈 catch | **1,045** | — |
| 그중 **돈 경로**(매수·매도·현금·원장·감사) | **13** | 하나씩 읽음 |
| 그중 **실패가 성공처럼 보이는** 것 | **4** | ★고쳤다★ |
| 나머지 9곳 | 9 | 실패해도 **아무 것도 주장하지 않는다** → 그대로 둠 |

★숫자가 안 줄어든 이유★ 고친 뒤에도 빈 catch 는 **여전히 1,045곳**이다.
로그를 남기는 일 자체가 실패할 수 있어서 4곳 모두 `catch (e2) {}` 로 **한 겹 감쌌기** 때문이다
(빈 catch 4개가 사라지고 4개가 새로 생겼다). **숫자가 아니라 거짓말이 줄었다.**

판별 기준은 "삼켜도 되는가" 가 아니라 ★**삼키면 거짓말이 되는가**★ 로 잡았다.
즉 **감시자(watchdog)가 침묵하면 "이상 없음" 으로 읽히는** 것만 고쳤다.

**고친 4곳**

| 위치 | 삼켰을 때 무슨 거짓말이 되나 | 어떻게 고쳤나 |
|---|---|---|
| `verifyAfterTrade` | 체결 후 **대조 자체가 실패**했는데 "대조 통과" 와 구분이 안 됨 | catch 에서 `"체결 후 대조 자체가 실패"` ERROR |
| `auditAccounting` 자가치유 | 치유에 실패해도 **"자가치유 성공"** 로그를 찍고 있었다 | `let _healed` 플래그 — **정말 고쳤을 때만** 성공 로그 |
| `LEDGER_DUP` 중복 탐지 | 중복 검사가 죽으면 **"중복 없음"** 과 똑같이 보임 | `"원장 중복 검사 실패"` ERROR |
| 본전(break-even) 잠금 | 잠금 실패가 **"잠금 걸림"** 과 구분이 안 됨 | `"본전 잠금 실패"` ERROR |

**게이트** `check-ledger-retro` 가 이 4곳을 **실행으로** 본다 — 각 함수를 일부러 던지게 만들고
로그가 실제로 남는지 확인한다. 돌연변이 4종(각각 다시 침묵시키기 / 성공 로그를 무조건 찍기)을 전부 잡는다.

**★그래도 한 번 더 확인할 것★**
- 고친 것은 **로그를 남기게** 한 것이지, **실패를 막은** 것이 아니다.
  배포 뒤 이 4개 문구가 **실제로 뜨는지** 보라 — 뜬다면 그동안 조용히 실패하고 있었다는 뜻이다.
- 나머지 **9곳**은 "실패해도 아무 주장을 안 한다" 는 내 판단이다. **그 판단을 한 번 더 볼 것.**
- 1,045 중 **1,032곳은 아예 보지도 않았다**(돈 경로가 아니다). 선택적 보강을 시끄럽게 만들면 E-1(반복 로그)이 되살아난다.

## E-3 · ✅ 해결(Codex + V33.350) · `deposits` 표의 모양이 경로마다 달랐다

**증거** `deposits` 기본값이 경로마다 `{ us, kr }` · `{ us, kr, cm }` · 5슬리브로 갈려 있었다.
읽을 때 `deposits[market]` 가 undefined → 0 이라 **숫자는 같지만** 표의 **모양**이 경로마다 달라,
화면·리포트가 어떤 슬리브를 보여줄지가 "어느 코드를 지나왔는지" 에 달려 있었다.

**★고쳤다 (Codex + V33.350)★** Codex 가 전체 리셋(`26894`)을 5슬리브로 고쳤고,
V33.350 이 나머지 경로도 같은 모양으로 맞췄다:
```js
const SLEEVES = ["us", "kr", "cm", "bdus", "bdkr"];
function sleeveZeros() { const o = {}; for (const m of SLEEVES) o[m] = 0; return o; }
```
읽기·쓰기 7곳이 전부 `sleeveZeros()` 를 쓴다. **슬리브를 추가할 일이 생기면 한 줄만 고치면 된다.**

---

---

# F. 유니버스 위생 (CLAUDE.md 규칙 위반)

`CLAUDE.md` 는 **"종목 추가 시 세 곳을 함께 갱신한다: `DEFAULT_KR`(유니버스) · `NAME_MAP`(종목명) ·
`MCAP_RANK`(시총순위 정적 폴백)"** 을 못 박아 두었다. 실제로 지켜지는지 **실행으로** 검증했다
(`DEFAULT_US`(`src/index.js:107`) · `DEFAULT_KR`(`225`) · `NAME_MAP`(`405`) · `MCAP_RANK`(`1390`)
네 블록을 잘라 CJS 모듈로 만들어 노드에서 직접 읽었다 — 파일 문자열 검색이 아니다).

**깨끗한 것부터** — 아래는 **위반 0건**이다. 다시 파지 말 것:
`DEFAULT_US`(558종) · `DEFAULT_KR`(450종) 내부 중복 0 · 두 시장 교차 중복 0 ·
KR 접미사(`.KS`/`.KQ`) 누락 0 · US 목록에 KR 접미사 섞임 0 ·
`NAME_MAP`(996) / `MCAP_RANK`(996) 의 고아 항목(유니버스에 없는 키) 0 ·
`MCAP_RANK` 한국 구간 동점 0.

## F-1 · ✅ 해결(V33.348) · 확인 한번 더 · 미국 섹터 ETF 12종이 세 곳 규칙을 어겼다

**증거 (실행)** `DEFAULT_US ∪ DEFAULT_KR` 1,008종 중 아래 12종만 두 맵에 **동시에** 빠져 있다:
```
XLK XLV XLY XLI XLP XLU XLB XLC XLRE SOXX IBB DIA
```
`ETF_SYMBOLS`(`340`)·`ETF_TYPE`(`362`)에는 `// [추가] 미국 섹터/테마 ETF` 로 정상 등재돼 있다 —
**두 곳만 갱신하고 세 곳 규칙을 빠뜨린 전형적인 모양**이다.

**결과** ① 화면에 한글/영문 이름 없이 티커로만 뜬다(`NAME_MAP[sym] || sym`, `26042` 등 20곳).
② `MCAP_RANK[sym] || 99999`(`8138` · `20499` · `26043` · `28487` · `43017`)로 떨어져
**시총 최하위로 정렬**되고 우량주 보너스(`43015`, `pickBlueWeight`)에서 제외된다.
ETF 라 보너스 제외는 결과적으로 맞지만, **의도해서 그런 게 아니라 빠뜨려서 그렇다** — 값이 우연히 맞는 상태다.

**★고쳤다 (V33.348) — 그래도 한 번 더 확인할 것★**
12종에 한글 이름을 붙이고(`"XLK":"기술 섹터"` …) 순위를 **520~531** 로 이어 붙였다.
미국 ETF 는 이 저장소 관례대로 개별주 뒤(503~)에 놓는다 — **시총이 아니라 표시 순서**다
(SPY 503 · QQQ 504 … SH 519 와 같은 규칙).
**★그래도 한 번 더 확인할 것★** 화면 시총순 정렬에서 이 12종이 기대한 자리에 오는지.

## F-2 · 소 · ✅ 해결(V33.356) · 확인 한번 더 · `MCAP_RANK` 미국 구간은 순서가 아니다 — 동점 그룹 28개(초과 29) + 결번

**증거 (실행)** 미국 546종의 순위값에서 동점 28건:
```
9: SPCX·TSLA·TSM   22: CSCO·ASML   26: NFLX·SAP   28: BAC·NVO   30: KO·BABA
33: AMAT·TM   45: KLAC·SKHY   55: MCD·SONY   58: NEE·ARM   62: AMGN·MELI
66: STX·SPOT   68: TMO·SHOP   70: GILD·SE   75: DELL·MRVL   78: UBER·PDD
105: VRTX·NET  110: NOW·MSTR  140: SLB·SNOW  150: NOC·RBLX  160: DDOG·JD
190: FIX·ZS    210: DVN·TEAM  260: CCI·SOFI  300: HBAN·RIVN  310: AEE·OKTA
320: VRSN·MDB  330: TPR·DKNG  502: EPAM·RKLB
```
값 범위 1~519 에 546종이 들어가 있고 결번은 227·344 두 개뿐 — 즉 **동점으로 눌러 담았다**.
한국 구간(450종, 1~452)은 동점 0 으로 깨끗하다.

**결과** `rvPanel`(`13909`)이 `MCAP_RANK` 를 **"예전 순위(prev)"** 로 삼아
실시간 시총순위(`now`)와의 **드리프트**를 계산한다. 동점이면 그 드리프트가 종목마다 자의적으로 갈린다.
정적 폴백이 순서(strict order)가 아니면 "몇 계단 올랐나" 라는 질문 자체가 답이 없다.
UI 시총 정렬(`26043` · `28487`)도 같은 이유로 동점 구간이 임의 순서가 된다.

**왜 안 고쳤나 (V33.348)** 동점을 풀려면 누군가의 순위를 옮겨야 하는데, 그 순위는 **시총**이다.
예컨대 rank 9 의 `SPCX·TSLA·TSM` 중 둘을 빈 자리(227·344 또는 532~)로 옮기면
우량주 보너스(`43015`, 시장별 상한 US 120 내 로그감쇠)가 **실제로 달라진다** —
즉 **없는 시총을 지어내 매수 가중을 바꾸는 일**이 된다. 실거래 계좌에서 조사자가 할 일이 아니다.
→ 대신 `check-universe-sync` 에 상한을 박아 **늘어나지만 않게** 막았다(`F2_KNOWN_US_TIES = 29`).
→ 제대로 고치려면 실시간 시총(`mcap_shares` 의 가격×주식수)으로 한 번 전체를 재산출하는 것이 맞다.
  그 값이 이미 `rvPanel`(`13909`)에서 계산되고 있으니, 그것을 정적 표로 되돌려 쓰는 길이 있다.

### ★파고들었더니 더 큰 게 나왔다 (V33.356) — 전략 하나가 죽어 있었다★

동점을 고치려고 드리프트를 읽는 쪽을 따라갔더니, **드리프트가 애초에 계산된 적이 없었다.**

**① 읽는 이름이 틀렸다 — `sh` 인데 `.shares` 를 찾고 있었다**

```js
const sh = _num(shares[s] && (shares[s].shares != null ? shares[s].shares : shares[s]), 0);
```

`mcap_shares` 는 두 저장 지점 모두 **`{ sh, mc }`** 로 쓴다(V33.217부터). `.shares` 라는 키는
이 맵에 **존재한 적이 없다.** 폴백인 `shares[s]` 는 객체라 `_num(객체, 0)` → **0**.
→ `caps` 가 늘 비고 → `rank` 가 늘 `{}` → `rvContextFor().rank` 가 늘 `null`
→ **`XR_FLOW` 전략은 추가된 날(V33.250)부터 한 번도 발동한 적이 없다.**

git 으로 확인: 저장 `{sh, mc}` 는 **V33.217**, 이 읽기는 **V33.250**(이 전략 5종을 처음 넣은 판).
즉 **처음부터 틀린 이름으로 태어났다.** 화면 시총 박스는 같은 맵을 `ms.sh` 로 바르게 읽고 있어서
(watchlist) 증상이 어디에도 안 보였다.

**② 이름을 고치면 드리프트가 살아나므로, 그 값이 성립하는지도 같이 고쳐야 했다**

`now` 는 **이 패널에 든 종목**(주식수·가격이력이 둘 다 있는 것만) 안의 순위인데
`prev` 는 **정적 전체 유니버스**의 순위였다. 모집단이 다르면 `prev − now` 는
"올라왔다" 가 아니라 ★**"빠진 종목이 많다"**★ 를 재는 값이 된다 — 패널에 절반만 들면
전 종목이 일제히 순위가 뛴 것처럼 보이고, `minRankJump 12` 를 무더기로 통과한다.
→ `prev` 도 **같은 무리 안**에서 센다. 정적 표에 자리가 없으면 `prev = 0`(진입부가 거른다).

**③ 그리고 동점(F-2 본체)** — 같은 값이 둘 이상이면 앞뒤가 임의다. `tie` 로 표시하고
`evaluateIndexFlowEntry` 가 **기권**한다. **임의의 답으로 돈을 걸지 않는다.**

**게이트** `check-rv-rank` — **`rvBuildPanel` 을 가짜 D1 으로 실제로 돌린다**(문자열 검사 아님).
실제 티커(동점 그룹 `TSM·SPCX·TSLA` 포함)로 채워 ① 저장 모양에서 순위가 나오는지(대조군: 주식수를
빼면 0) ② `prev` 최대 ≤ `now` 최대(같은 무리) ③ 동점 그룹이 `tie` 로 찍히는지 ④ 진입부가 기권하는지
⑤ 동점 초과가 29를 안 넘는지. 돌연변이 5종 전부 잡는다.
※ 처음 판본은 가짜 티커를 써서 `prev` 가 전부 0 이었고 ②가 **공허하게 통과**했다 — 실제 티커로 바꿨다.

**★그래도 한 번 더 확인할 것★**
- ★**이 고침은 죽어 있던 진입 전략 하나를 살린다.**★ `XR_FLOW` 는 지금까지 0건 발동이었다.
  `[RV] … 시총순위 N` 이 0 이 아닌지 먼저 보고, **`XR_FLOW` 체결이 실제로 나기 시작하는지** 볼 것.
  원치 않으면 `rvStrat.xr.enabled: false` 로 끄면 된다 — 이 전략은 **실전 이력이 0건**이다.
- 밴드는 `bandLo 180 ~ bandHi 260` 인데 `now` 는 **무리 안의 순위**다. 무리가 200종보다 작으면
  그 밴드에 드는 종목이 없다. 패널에 `cohort` 를 같이 남겼으니 **그 숫자를 보고 밴드를 판단할 것.**

## F-3 · ✅ 닫음(V33.357) · `SPCX` 가 실제 거래 가능한 티커인지 검증되지 않았다 — 두 갈래 증거로 유효 확인

`DEFAULT_US`(`108`) · `NAME_MAP`(`407`, `"SpaceX"`) · `MCAP_RANK`(`1402`, 9위) ·
섹터맵(`2488`, INDUSTRIAL)에 **네 곳 모두** 들어 있다.
SpaceX 는 널리 알려진 비상장사이고 `SPCX` 는 과거 SPAC 티커였다 —
**조사자는 이 티커의 현재 상장 여부를 확인할 수단이 없었다.** 단정하지 않는다.

- 만약 유효하지 않다면: 매 사이클 시세 fetch 를 한 건씩 태우고(예산은 A-5 에서 이미 쪼들린다),
  `MCAP_RANK` 9위라 우량주 보너스 상위를 차지한다.
- `CLAUDE.md` 의 "상장폐지·피인수 종목은 넣지 않는다" 는 한국 종목 규칙으로 적혀 있지만
  **이유는 시장과 무관**하다.
- **같이 만들 것**: 유니버스에 "N일 연속 시세 0건" 종목을 기록하는 관측 하나.
  지금은 죽은 티커가 조용히 예산만 태우고 아무 데도 안 남는다(E-2 의 침묵하는 catch 와 같은 뿌리).

### ★닫는다 — 증거 두 갈래가 같은 답을 준다 (V33.357)★

**① 외부 출처(Codex 검증)** 나스닥 자신의 2026-06-26 공시가 Space Exploration Technologies
Corporation 을 **Nasdaq: SPCX** 로 지목하고 7월 7일 나스닥100 편입을 알렸다.
→ 학습 시점의 "SpaceX 는 비상장" 지식이 **현재의 공식 근거를 덮지 않는다.**

**② 우리 자신의 데이터** — 위 "같이 만들 것" 은 **이미 있었다**(`univHealthNightly`,
`UNIVHEALTH`). 운영 스냅샷(2026-09-14 23:09)의 `universe` 블록:

```
us : n 558 · ok 558 · staleN 2 · neverN 0 · pending 0
     stale = BK(51일 뒤처짐), SATS(16일 뒤처짐)
kr : n 450 · ok 450 · staleN 0 · neverN 0
```

`ok 558` 은 558종 **전부** `daily:` 행을 받았다는 뜻이다(`seen` 은 `daily:` 의 `updated_ts`).
즉 **야후가 `SPCX` 에 대해 일봉을 준다 — 존재하는 심볼이다.** `never` 목록에도 없다.
→ "매 사이클 fetch 예산을 헛되이 태운다" 는 걱정은 **해당 없음**으로 확정.

**★대신 진짜 후보 두 개가 이름으로 나왔다★**

| 티커 | 상태 | 해야 할 일 |
|---|---|---|
| `BK` | **51일** 뒤처짐 | 상장폐지·티커변경·합병 중 무엇인지 **사람이 확인**할 것 |
| `SATS` | **16일** 뒤처짐 | 동상 |

**조사자는 이 둘의 현재 상태를 확인할 수단이 없다**(이 환경에서 외부 시세·공시 접근이 막혀 있다).
`CLAUDE.md` 의 "상장폐지·피인수 종목은 넣지 않는다" 를 적용하려면 **먼저 사실 확인이 필요하고,
추측으로 유니버스를 건드리지 않는다.** 확인되면 `DEFAULT_US`·`NAME_MAP`·`MCAP_RANK` **세 곳**을
함께 고칠 것(`check-universe-sync` 가 그 규칙을 지킨다).
※ 낭비 규모는 558종 중 2종 = 사이클당 fetch 2건으로 작다. A-6 고침(폴백 300→50)에 비하면 미미하다.

## F-4 · ✅ 해결(V33.348) · 세 곳 규칙을 지키는지 보는 게이트가 없었다

게이트 103종 중 유니버스 정합성을 보는 것이 하나도 없다. F-1 이 그래서 남았다.
**`tools/check-universe-sync.mjs`** 로 위의 검사를 그대로 자동화할 수 있다 —
조사자가 쓴 추출 방식(네 블록을 잘라 CJS 로 만들어 `require`)이 그대로 게이트가 된다.
소스 문자열을 세는 방식은 V33.337 이 남긴 교훈대로 **하면 안 된다**. 검사 항목:
유니버스 내/교차 중복 · KR 접미사 · 두 맵 누락 · 두 맵 고아 · **시장 내 순위 동점**.

**★고쳤다 (V33.348)★** `tools/check-universe-sync.mjs` 신설.
소스 문자열을 세지 않는다(V33.337 교훈) — 네 블록을 잘라 CJS 로 만들어 노드에서 **실제로 읽고**
집합 연산으로 본다. 그래서 상수를 어떻게 다시 적어도 뜻이 지켜진다.
돌연변이 3방향(맵에서 한 종 빼기 ×2 · 동점 추가) 모두 잡힌다.

**F-2 는 아직 열려 있다** — 미국 구간 동점 29건(그룹 28개)은 그대로다. 게이트는 그 숫자를
상한으로 박아 **늘어나지만 않게** 막는다(`F2_KNOWN_US_TIES = 29`). 줄이면 그 상수도 같이 내릴 것.
순위를 임의로 재배정하지 않은 이유는 F-2 에 적었다 — 그건 없는 시총을 지어내는 일이다.

# J. 운용상태가 사실을 다 말하지 않는다

## J-1 · 중 · ✅ 해결(V33.360) · 확인 한번 더 · 진단 문장이 300자에서 잘려 ★결론만★ 사라졌다

**증거** 사용자 보고 "ai운용상태 파일들 깨지는거 같은데".
파일 자체는 **유효한 JSON 이었다**(5개 전부 파싱 확인). 깨진 것은 **내용**이다 —
운영 스냅샷(2026-09-15 01:49)에서 `note` 4개가 **정확히 300자**에서 잘려 있었다:

| 필드 | 잘린 끝 | 원문 |
|---|---|---|
| `flow.note` | …"잡음과 **구별**" | "잡음과 구별**되지 않는다**" |
| `xalpha.note` | …"**잡음과**" | 〃 |
| `stack.note` | …"실측 70일 **·**" | (엠바고·전진·결론이 통째로) |
| `memo.note` | …"→ 합류 " | "→ 합류 **보류 — …**" |

이 문장은 **앞에 '무엇을 학습했나'**(표본·홀드아웃·엠바고·시장분리), **맨 끝에 결론**
('→ 합류 보류 — 홀드아웃 t -0.39 < 1.65 …')을 적는 구조다.
그래서 **뒤에서 자르면 정확히 결론만 사라진다** — 그게 이 파일을 여는 이유인데.

**어떻게 고쳤나** `_clipMid(v, max)` — 상한을 900 으로 넉넉히 두고, 그래도 넘으면
**가운데를 접는다.** 머리(무엇을)와 꼬리(결론)를 둘 다 남기고 몇 자를 접었는지 적는다.
적용: `train_note` 2곳(300 → 900) · 자가진단 로그 표본(150 → 260).

**게이트** `check-status-detail` — `_clipMid` 를 **실행**해서 꼬리가 남는지 본다.
대조군으로 **종전 방식(뒤에서 자르기)이 결론을 잃는 것**을 나란히 보인다. 돌연변이 3종을 잡는다.

---

## J-2 · 중 · ✅ 해결(V33.360) · 확인 한번 더 · 상태가 "많다/적다" 를 사람 눈대중에 맡겼다

사용자 요청 "ai운용상태를 좀더 구체적으로 보이게". 세 블록을 **추가 D1 쿼리 0 으로** 실었다
(구체화한다고 부하를 늘리면 I-1 이 재발한다 — 게이트가 그걸 지킨다).

**① `d1Headroom`** — "D1 이 한계인가" 를 숫자로 답한다
`rows` · `mb` · `cap` · `leftRows` · **`daysLeft`**(7일 평균 유입으로 나눈 값) · `note`.
못 재면 `daysLeft: null` — 지어내지 않는다.

**② `poolWindow`** — 고유도가 **왜** 그 값인지의 절반 (I-2)
`windowDays` · `nSym` · `perSym` · `maxPerSym` · `conc`(평균 동시성) · `why`.
`pooluniq` 가 **이미 뽑아 온 같은 20,000행**으로 계산하므로 D1 비용이 0 이다.
창이 20일 미만이거나 종목당 40건을 넘으면 문장으로 지적한다.
고유도 계산이 **실패한 상태도 말한다** — 종전엔 `uBar=1` 로 조용히 떨어져 **보정이 꺼진 것을
아무도 몰랐다.**

**③ 옛 판 은퇴** — 아래 J-3.

---

## J-3 · 중 · ✅ 해결(V33.360) · 확인 한번 더 · 판이 지난 모델 기록이 ★영원히★ 남았다

**증거(운영 스냅샷)** 사용자 요청 "피쳐판 일치 안하는거도 수정해".

```
alt.roster.xgb    : featVer ★15★ · wantVer 17 · featVerOk false · state "off"
externalTrain.xgb : activeFeatVer ★15★ · 방금 온 것은 featVer 17(품질 게이트에 거절)
```

승격 기록(`<m>_trust`)이 옛 판에 얼어붙었고, 새 판은 섀도우에 쌓인다.
그러면 그 옛 기록은 **영원히 그 자리에 남는다** — featVer 가 다르면 피처 배열이 달라
**다시는 투표할 수 없는 모델**인데도. 남겨서 생기는 일:
- 화면이 "판 불일치(15 ≠ 17)" 를 계속 말한다 — **고칠 방법이 없는 사실**을 반복한다
- `activeFeatVer` 가 15 로 보고돼 "지금 무엇이 활성인가" 를 잘못 읽게 한다
- 본문(`<m>_model`)은 트리 수천 개짜리다 — 못 쓰는 모델이 R2/D1 자리를 계속 먹는다

**고침** 야간 `retirefv` 단계(학습기들 **앞**)가 `featVer < 현재판` 인 승격 기록과 본문
(R2 · D1 청크 · 메타 전부)을 지운다. **거래 동작은 한 톨도 안 바뀐다** — `_boosterAdmit` 이
이미 막고 있어 투표 경로에 못 들어가던 것이다. 바뀌는 건 "없는 걸 있다고 말하지 않는다" 뿐.

**안 건드리는 것**: 현재판 기록 · **판을 모르는 기록**(모르면 안 지운다) · **섀도우**(다음 승격 후보).

---

## J-4 · 중 · ✅ 해결(V33.360) · 확인 한번 더 · 표본 상한에 닿으면 ★영구 삭제★ 됐다

사용자 요청 "d1이 한계면 이거 r2에 옮기는것도 고려해봐".

**★먼저 정직하게 — D1 의 한계는 용량이 아니었다★**
- `ml_samples` 935MB · D1 상한은 그보다 훨씬 크다 → **용량은 문제가 아니다**
- 실제 한계는 **쿼리당 CPU** 였고 그건 I-1 에서 고쳤다
- 학습 읽기는 **이미 R2 스냅샷**으로 간다(V33.27·V33.176). 새로 옮길 게 아니다
- 깊은 `OFFSET` 도 의심해 재 봤으나 **평탄했다**(파트 0→19: 38ms→28ms) — 문제 아님

**★그런데 R2 가 정말 필요한 곳이 하나 있었다★**
총표본 **1,123,768** / 상한 **1,200,000**. **곧 닿는다.** 닿으면 종전엔 그냥 `DELETE` 였다.
수확 표본은 **그날의 시장 상태로 만들어진 것이라 다시 만들 수 없다.**
R2 는 조건검색을 못 해 '학습용 저장소' 는 못 되지만 **보관용으로는 정확히 맞다.**

→ 지울 행을 먼저 읽어 **`ml/archive/v17/<날짜>-<시작id>.json`** 으로 붓고, 그다음에 지운다.
  **R2 쓰기가 실패하면 지우지 않는다** — 보관을 못 했는데 원본을 버리면 안 된다.
  상한을 조금 넘긴 채로 두는 쪽이 되돌릴 수 없는 삭제보다 낫다(다음 밤에 재시도).
  R2 상태 화면이 **"표본 보관함"** 을 별도 그룹으로 센다.

**게이트** `check-featver-retire` — 은퇴를 **실제로 돌리고**(가짜 D1·R2), R2 쓰기가 DELETE 보다
**먼저**인지, 보관 실패 시 지우지 않는지까지 본다. 돌연변이 8종을 잡는다.
(그중 하나는 `const` 때문에 동치였고, 제대로 만든 판본은 잡혔다 — 그 사실도 기록해 둔다)

**★그래도 한 번 더 확인할 것★**
- 배포 뒤 `d1Headroom.daysLeft` 를 볼 것. **2주 미만이면 곧 보관이 시작된다.**
- 첫 보관이 일어나면 `[표본상한] … R2 로 N건 보관 후 D1 에서 N건 삭제` 로그가 뜬다.
  안 뜨고 **ERROR** 가 뜨면 R2 바인딩·용량 문제다(그때 표는 상한을 넘은 채로 자란다).
- 상한 자체(1,200,000)는 손으로 정한 값이다. 보관이 잦으면 올릴지 판단할 것.

---

# I. 표가 커지면서 D1 이 CPU 한도로 죽는다

## I-1 · 치명 · ✅ 해결(V33.359) · 확인 한번 더 · 전수 정렬 쿼리 3건이 D1 을 무너뜨렸다

**증거(운영 스냅샷 2026-09-15 01:49)** 자가진단 ERROR 6건 중 **4건이 같은 문구**였다:

```
[STAGE:pooluniq] D1_ERROR: D1 DB exceeded its CPU time limit and was reset.
[BDKR] / [CM] / [SCHED] alt bdus fail — 같은 문구
```

`ml_samples` 는 **1,123,768행 / 895.9MB** 다. 이 규모에서 한 쿼리가 D1 의 CPU 예산을
통째로 먹으면 **그 순간 다른 요청까지 큐에 적체돼** 무관한 곳(BDKR·CM)이 함께 쓰러진다.

**★쿼리 계획을 실제로 재서 범인을 특정했다★** (진짜 SQLite · 60,000행 · `ANALYZE` 후)

| 쿼리 | 종전 계획 | 종전 | 고친 뒤 |
|---|---|---|---|
| **pooluniq** `ORDER BY id DESC` | `USE TEMP B-TREE FOR ORDER BY` | **199ms** | `ORDER BY ts DESC` → **47ms** |
| **구판 정리** `featver != ?` | **`SCAN ml_samples`**(전수) | 11ms | `featver < ?` → **0ms** |
| **총량 폐기** `ORDER BY RANDOM()` | `USE TEMP B-TREE FOR ORDER BY` | 37ms | `ORDER BY ts ASC` → **1ms** |

인덱스는 `idx_samples_fv_ts(featver, ts)` 인데 **정렬을 `id` 로 걸어** 112만 행을 전부 읽어
임시 B-트리로 정렬한 뒤 2만 건만 취하고 있었다. 뜻으로도 `ts` 가 맞다 — 고유도는
**라벨 구간이 겹치는가**를 재는 것이라 '언제 적재됐나(id)' 가 아니라 '언제의 표본인가(ts)' 다.

`featver != ?` 는 인덱스를 못 탄다. featVer 는 되감기지 않으므로(`check-stale-base`)
`featver < ?` 와 **같은 집합**이고, 그쪽은 커버링 인덱스를 탄다.
지금은 구판 행이 없어 **한 건도 안 지우면서 매일 밤 전수 스캔만** 하고 있었다.

**`ORDER BY RANDOM()` 은 아직 안 터졌지만 곧 터진다** — `HARVEST.maxTotal` 1,200,000 에
현재 1,123,768 이다. 닿는 순간 폐기가 실패하고, 실패하면 표를 못 줄여 상한이 무의미해진다.
→ **오래된 것부터** 지운다. ★**이건 정책 변화다**★ — 종전은 무작위라 남는 표본의 시간
분포가 그대로였고, 이제는 풀이 최근으로 기운다. 원치 않으면 `HARVEST.maxTotal` 을 올려
폐기 자체를 미룰 것.

**게이트** `check-d1-scan` — **문자열을 보지 않는다.** 소스에서 SQL 과 인덱스 정의를 꺼내
**진짜 SQLite 에 `EXPLAIN QUERY PLAN`** 을 돌린다. `ml_samples` 를 건드리는 정렬 쿼리
**27건 전부**를 훑어 `TEMP B-TREE` 나 `SCAN` 이 나오면 배포를 막는다. 돌연변이 5종을 잡는다.

★**이 게이트를 만들며 배운 것 — 빈 표에서 재면 안 된다**★
첫 판본은 데이터 없이 쟀고, 멀쩡한 export 커서 5건을 **범인으로 오판**했다.
데이터를 넣고 `ANALYZE` 하니 `SEARCH … USING INTEGER PRIMARY KEY (rowid>?)` 로 멀쩡했다.
바인드도 컬럼에 맞게 채워야 한다 — 전부 같은 값으로 채우면 `ts >= ? AND ts < ?` 가
**빈 범위**가 되어 플래너가 딴 인덱스를 고른다(그래서 stackbf 커서도 한 번 오판했다).
게이트가 그 두 가지를 **자기 안에서 대조군으로 증명**한다.

**★그래도 한 번 더 확인할 것★**
- 배포 뒤 `D1_ERROR … CPU time limit` 가 **사라졌는지**. 남으면 범인이 `ml_samples` 밖에 있다.
- `[STAGE:pooluniq]` 가 성공해 `ml_pool_uniq` 가 실제 값으로 채워지는지
  (실패하면 `uBar=1` 로 떨어져 **고유도 보정이 통째로 꺼진다**).
- 표는 계속 큰다. **다음에 걸릴 곳은 `ml_samples` 가 아닌 다른 표일 수 있다.**

---

## I-2 · 중 · ⚠️ 원인 미확정 · 유효표본이 한 회차 만에 7,379 → ★210★ 으로 무너졌다

**증거(두 스냅샷 대조)**

| 모델 | 학습시각 | valAcc | 유효표본/원시 | 결과 |
|---|---|---|---|---|
| GBDT | 09-14 19:02 | 0.5226 | **7,377**/217,230 | 합류 중 |
| DNN | 09-15 00:43 | 0.5248 | **210**/220,000 | accLB 46.8% → 거절 |

같은 창에 **SEQ 가 위원회에서 빠졌다**(accLB 0.5538 → 0.4833, mult 0.656 → 0) 그리고
부스터 3종이 전부 거절됐다(valAcc 0.5194/0.5199/0.5194 → **0.4821/0.5101/0.4165**).

**무엇이 아닌지는 안다** — 트레이너 코드는 그 사이 **한 줄도 안 바뀌었다**(git 확인).
그 사이 바뀐 것은 **데이터**다: 표본이 1,086,153 → 1,123,768 로 **37,615건** 늘었다.

**★단정하지 않는다★** 고유도는 `_uniq_weights` 가 **종목 안에서** 라벨 구간 겹침을 세어
정한다. 시뮬레이션으로 범위는 좁혔다(종목 1,018 · 표본 220,000 · 지평 10일):

| 가정 | 유효표본 |
|---|---|
| 정상(종목별 1일 1봉, 216일치) | 10,868 ← **GBDT 의 7,377 과 같은 자리** |
| 종목 구분이 사라짐 | 11 |
| ts 가 전부 수확시각으로 몰림 | 1,018 |
| **실측** | **210** |

어느 가정도 정확히 210 을 주지 않는다. **그 값은 평가창이 시간적으로 압축됐을 때 나온다** —
DNN 은 유효표본을 **평가 구간(`n_eval`)에 대해서만** 세기 때문이다. 즉 **평가창이 며칠에
걸쳐 있는지**와 **한 종목이 그 창에 몇 번 나오는지**를 봐야 답이 나오는데, 로그에는
'평균 고유도' 한 숫자뿐이라 밖에서 알 길이 없었다.

**★추측으로 고치지 않고, 다음 회차가 답하게 했다 (V33.359)★**
트레이너가 DNN 학습에서 한 줄을 더 찍는다:

```
[고유도내역] 평가창 N일 · 종목 M개 · 종목당 K건 · 평균동시성 C건 (지평 10일 — …)
```

`check-trainer-budget` 이 그 네 값이 실제로 계산돼 찍히는지, 계산식이 맞는지,
그리고 **계측이 실패해도 학습을 죽이지 않는지**를 지킨다.

**다음 작업자가 할 일** 다음 Modal 회차 로그에서 그 한 줄을 읽으면 갈린다:
- **평가창이 짧다** → 수확이 한 시점에 몰린다(B-8 재수확과 함께 볼 것)
- **종목당 건수가 많다** → 한 종목이 같은 창에 여러 번 들어간다(stride·중복 수확)
- **종목 수가 적다** → 평가 구간이 일부 종목에 쏠렸다

**그 전까지는 원인 미상이다.** 문턱을 낮춰 통과시키는 것은 답이 아니다(B-6).

---

# H. 화면이 낡은 값을 지금 값처럼 보여준다

## H-1 · 소 · ✅ 해결(V33.358) · 확인 한번 더 · R2 집계가 ★23일 전★ 값인데 "오늘" 이라 부르고 있었다

**증거(운영 스냅샷 2026-09-14 23:09)**

```
alt.r2.ageSec        : 2008262          (= 23.2일)
alt.r2.v.today.day   : "2026-08-23"     ← 오늘은 09-14 다
alt.r2.v.today.files : 2 · pending: 432
```

화면은 이 값을 이렇게 그렸다:
- `"2,008,262초 전 집계"` — **사람이 23일로 읽을 수 있는 표기가 아니다**
- 그 아래 행을 **"오늘 단타 수집"** 이라 부르며 `files 2` 를 **초록(C.pos)** 으로 칠했다
  → **멈춘 수집이 돌고 있는 것처럼 읽힌다**

**원인** `r2_status_cache` 는 **`/api/r2-status` 를 누가 열었을 때만** 갱신된다.
`R2.list` 가 **Class A 과금**이라 주기 호출을 **일부러 안 한다 — 그 결정 자체는 옳다.**
문제는 `/api/ai-mode` 가 그 캐시를 **현재 상태처럼** 실어 보내고 화면이 그대로 믿은 것이다.

**어떻게 고쳤나 (V33.358)** 과금을 늘리지 않는다 — **표기만 정직하게** 만든다.
- 나이를 `extAgeTxt`(A-7 에서 만든 공용 함수)로 찍는다 → `"23일 전 집계"`
- 6시간 넘으면 **'옛 집계'** 로 보고 **"오늘" 이라 부르지 않는다.** 그 행의 제목이
  집계일(`2026-08-23`)이 되고, **초록으로 칠하지 않으며**, "지금 상태가 아니다" 를 문장으로 적는다
- 신선하면 **종전과 완전히 동일**하다(회귀 없음)

★**A-7 과 같은 원칙이다 — 값을 지어내지 않는 것과 값의 나이를 숨기지 않는 것은 같은 일이다.**★

**같이 잡힌 것 — 스코프 사고** 처음엔 R2 블록에서 `extAgeTxt` 를 그냥 불렀는데,
이 파일의 `<script>` 는 **IIFE 라 스코프가 막혀 있어** ReferenceError 가 났다.
`check-html-js` 가 잡아 줬다. **같은 로직을 그쪽에 복제하면 두 표기가 언젠가 갈라진다** —
이 저장소가 반복해 겪은 일이라, 이 파일의 기존 방식(`window.LUXR` · `window.llmRefresh` …)대로
`window.extAgeTxt` 로 **한 벌만** 내보낸다.

**게이트** `check-r2-age` — HTML 에서 `extAgeTxt` 를 잘라 **실제로 실행한다**.
실측 2,008,262초가 `"23일 전"` 으로 나오는지 · 옛 집계 분기에 '오늘' 이라는 말이 없는지 ·
초록으로 안 칠하는지 · 신선하면 종전대로인지 · **정의가 한 벌뿐인지**(복제 방지) ·
`window` 배선이 살아 있는지. 돌연변이 6종 전부 잡는다.

**★그래도 한 번 더 확인할 것★**
- 이건 **표기만** 고친 것이다. **R2 집계는 여전히 사람이 `/api/r2-status` 를 열어야 갱신된다.**
  화면의 오브젝트 수·용량이 최신이 필요하면 그 주소를 한 번 열 것(과금을 아끼려는 의도된 설계다).
- 문턱 6시간은 손으로 정한 값이다. 하루에 한 번도 안 여는 화면이면 항상 '옛 집계' 로 뜬다 —
  그게 사실이므로 맞지만, 거슬리면 문턱을 올릴 것.

---

# G. 모델 진단 — 화면이 말하는 이유가 실제 이유와 다르다

> 사용자 보고(2026-09-14): "또 모델들 대부분이 작동 안하고 있고".
> **실물을 먼저 확인했다: 모델은 정상적으로 학습되고 있다.** 외부 모델 **6/6 수신**,
> 나이 0.4~16시간(Cat 0.4h · LGB 0.4h · XGB 0.4h · DNN 0.5h · GBDT 4.1h · MIND 16.1h).
> V33.350 의 학습 예산 고침은 먹었다. 문제는 **학습이 아니라 진단 문장**이었다.

## G-1 · 중 · ✅ 해결(V33.356) · 확인 한번 더 · "재학습 대기" 가 거짓말이었다

**증거 — 같은 응답 안에서 같은 모델을 두고 두 문장이 서로 반대였다** (`/api/ai-mode`, 23:09)

```
committee.xgb.latestReceiptFeatVer : 17          ← 현재 판
committee.xgb.latestReceiptAt      : 0.4시간 전
committee.xgb.latestReceiptReason  : "IC 경로 — 블록 유의성 t 1.36 < 1.65"
committee.xgb.reason               : "판 불일치(모델 featVer 15 ≠ 현재 17) — 재학습 대기"   ←★거짓★
```

**원인** `_boosterAdmit(live, ext)` 첫 줄이 `const t = live || ext` 다.
`live`(=예전에 승격된 기록)를 **언제나 먼저** 보는데 그건 featVer **15** 짜리고,
방금 온 featVer **17** 은 `ext` 에 있다. 그래서 화면은
**이미 0.4시간 전에 도착해서 유의성으로 거절된 모델**을 두고 "아직 재학습을 기다린다" 고 말했다.
그 문장을 믿으면 **학습기를 고치러 간다 — 학습기는 6시간마다 멀쩡히 돌고 있었다.**
`accLB` 도 낡은 기록의 것(**52.25%**)을 찍어 갓 온 모델의 값(**51.04%**)과 달랐다.

바로 위 `_boosterAdmit` 의 V33.339 주석이 경고한 사고의 **거울상**이다 —
그때는 "문턱보다 높은 숫자를 미합류 사유로 적었다", 이번엔 "이미 온 것을 안 왔다고 적었다".

**어떻게 고쳤나** 막은 **판정은 그대로 두고**(낡은 live 가 투표하면 안 되는 건 종전 판단이 맞다)
**사유만** 지금 상태를 설명하는 기록으로 낸다. 낡은 기록과 갓 온 기록의 숫자를 **섞지 않고 둘 다** 내보낸다
(`recentAt` · `recentFeatVer` · `recentAccLB`). 고친 뒤:

> 재학습은 돌고 있다 — featVer 17 모델이 24분 전 도착했으나 승격 거절:
> IC 경로 — 블록 유의성 t 1.36 < 1.65 (그 모델 accLB 50.99%) ·
> 승격돼 있는 기록은 아직 featVer 15 라 투표하지 않는다

**게이트** `check-booster-reason` — `_boosterAdmit` 을 실제로 돌린다.
★**합류 판정 252조합 전수 대조에서 달라진 경우 0건**★ 을 함께 잰다(사유만 바뀌는 변경임을 못 박는다).
돌연변이 5종 중 4종을 잡고, 나머지 1종은 **동치(no-op)** 임을 `latestExternalReceipt` 의 계약
(15조합 전수)으로 증명해 그 계약 자체를 게이트에 넣었다.

**★그래도 한 번 더 확인할 것★** 이건 **문장만** 고친 것이다 — 부스터 3종은 **여전히 투표하지 않는다.**
왜 못 들어오는지는 아래 G-2 가 답한다.

---

## G-2 · 중 · ❌ 안 고침(고의) · 위원 대부분이 못 드는 진짜 이유 — 그리고 문턱이 두 벌이다

**실측 명부 15명 중 투표 중은 4명**(MIND · GBDT · SEQ ×0.66 · 이중헤드 ×0.33). 나머지가 막힌 이유:

| 위원 | 막은 것 | 숫자 |
|---|---|---|
| XGB · LGB · CAT | 블록 IC 유의성 | t **1.36 · 1.48 · 1.14** < 1.65 |
| DNN | 정확도 하한 | accLB **48.88%** < 50.5% |
| FLOW · XALPHA · STACK | 홀드아웃 t **음수** | −0.49 · −1.01 · −0.17 |
| MEMO | 홀드아웃 t ≈ 0 | 0.02 |

**★이건 고장이 아니라 게이트가 제 일을 하는 것이다.★** 부스터 3종의 정확도 하한은
50.98~51.04% 인데 **무실력 기준선(no-skill)이 ~52.3%** 다(`FLOW` 기록: "valAcc 47.5%(무실력 52.3%)").
즉 **상수만 찍어도 52.3%** 가 나오는 데이터라 정확도 경로가 닫히고, IC 경로로 가면 유의성이 모자란다.

**왜 유의성이 안 서나** 홀드아웃 70일 ÷ 라벨 지평 5일 − 엠바고 10일 → **겹치지 않는 관측 7~12개**
(`icDf 11` · `icDf 16`). 12개 블록으로 t 1.65 를 넘기려면 진짜 실력이 꽤 커야 한다.
그리고 고유도 가중이 **217,230행 → 유효 7,377행(uniq 0.034)** 으로 깎는다.

**→ 문턱을 낮추면 안 된다.** (B-6 에 이미 적혀 있다: "문턱을 낮춰 수를 늘리지 말 것.")
늘려야 할 것은 **관측 기간**이거나 **진짜 실력**이지 잣대가 아니다.

### ★그런데 잣대가 두 벌인 것은 발견했다 — 이건 진짜 결함이다★

| 어디 | 정확도 문턱 |
|---|---|
| **수신(승격) 시** `_accFloor(GBDT.trustFloor, body.accBase)` | `max(0.505, 무실력)` → 실측 **0.523** |
| **읽기(투표) 시** `_boosterAdmit` 의 `floor` | `GBDT.trustFloor` → **0.505** |

즉 **옛 규칙으로 승격된 모델은 낮은 바에서 계속 투표한다.** 같은 위원회에 두 잣대가 있는 셈이고,
V33.191 이 정확히 이 이유로 한 번 고쳤던 자리다.

**왜 지금 안 고쳤나 — ★고치면 위원회가 빈다★**
읽기 쪽에 무실력 문턱을 적용하면 지금 투표 중인 **GBDT(accLB 51.12%)가 52.3% 에 막혀 빠진다.**
그러면 보조 위원이 **0명**이 되고 사실상 MIND·SEQ·규칙엔진만 남는다.
GBDT 가 어느 경로로 승격됐는지(정확도인지 IC인지, 그때 `accBase` 가 실렸는지)는 승격 기록에
남아 있지 않아 **추측 없이는 못 가른다.** 실거래 계좌에서 조사자가 추측으로 위원을 뺄 일이 아니다.

**다음 작업자가 할 일**
1. ~~승격 시 `trust.accBase` 와 `trust.passedBy` 를 기록한다.~~ → **✅ V33.357 에서 했다.**
   이제 승격 기록에 `accBase`(그때의 무실력 기준선) · `accFloorUsed`(실제로 쓴 문턱) ·
   `icTMinUsed` · `passedBy`("acc"/"ic"/"acc+ic")가 남는다. **기록만 추가했고 승격 판정은 안 바꿨다.**
   `check-booster-reason` 이 이 네 기록과 "두 문턱이 아직 다르다" 를 함께 지킨다 —
   **두 문턱이 같아지는 날 그 절이 실패하고, 그때가 읽기 쪽을 맞출 수 있게 된 시점이다.**
2. 그 기록이 쌓인 뒤에야 읽기 쪽 문턱을 수신 쪽과 같게 맞춘다.
3. **그 순간 GBDT 가 빠질 수 있다** — 위원회가 비는 것을 감수할지는 **사람이 정한다.**

# Z. 확인했으나 문제 아님 (헛수고 방지)

- **POST 엔드포인트 인증** — POST 43개 중 TRAIN_KEY 요구는 일부지만,
  `mutationGuard`(`src/index.js:22352`)가 **라우팅 앞에서 전역으로** Origin/키를 검사한다(`22444`).
  CSRF 방어로 설계된 것이고 의도대로 동작한다. **구멍 아님.**
- **입출금 시 현금 체크포인트 무효화** — `26756`(입출금)·`26656`(시장 리셋)·`26632`(전체 리셋)에서
  전부 `cash_ckpt` 를 지운다. **누락 없음.**
- **`auditAccounting` 초기자본** — `_initialCashFor` 를 쓴다(`22155`). V33.328 에서 이미 단일화됨.
- **야간 파이프라인 재개** — 01:31 실측 `pipe.closed=false · stagesToday=44 · waitingN=1 ·
  stagesOld=0 · lastScanMin=94.5`. 대기 단계는 `⟳ [ANLREVK] 개정 원장 없음`(자료 없음, 정상).
  V33.342~344 의도대로 **동작 확인됨.**
- **committee_cal featVer** — 17 유지. 09-10 의 "15≠17 확률 보정 무시" 는 해소됨.
- **트리 모델 크기** — `max_depth 4` / `num_leaves 16` 고정. 표본 증가로 깊이가 커지지 않는다.
- **시간외 거래의 휴장일 차단** — 열려 있다. `usCanTrade`/`krCanTrade` 가 시간외 세션을 포함한 뒤
  (`src/index.js:18365-18366`) 그 상태로 `isMarketTradingDay` 를 거치고(`18369-18376`),
  결과가 `marketsToTrade` → `canTrade`(`18634`) → 진입·청산 게이트(`19883` · `20376`)까지 이어진다.
  **공휴일에 시간외 거래가 열리지 않는다.** (단 A-8 의 조기폐장은 '휴장' 이 아니라 별개 문제다.)
- **한국 음력 명절(설날·추석) 휴장 판정** — `_krHolidaySet`(`5166`)에 음력이 없는 것은 의도된 설계다.
  `_indexFreshOpen`(`5259`)이 KOSPI 지수의 마지막 거래일로 판정하고, 장전·장후 시각에는
  `isMarketOpen("kr")` 가 false 라 정상적으로 휴장(false)이 나온다. **구멍 아님.**
- **한국 ETF 매도세 면제가 실제로 한국 ETF 를 덮는가** — 덮는다. `ETF_SYMBOLS`(`340`)에
  `.KS` ETF 27종(069500·122630·252670·…)이 들어 있다. 미국 ETF 셋만 보고 판정하는 게 아니다.
- **유니버스 중복·접미사·고아 항목** — 실행 검증 결과 **전부 0건**이다(F 절 머리말 참조).
  `DEFAULT_US`/`DEFAULT_KR` 내부 중복 0 · 교차 중복 0 · `.KS`/`.KQ` 누락 0 ·
  `NAME_MAP`/`MCAP_RANK` 고아 0 · 한국 구간 순위 동점 0. **다시 파지 말 것.**

---

# Y. 조사자가 남기는 주의 — 내 작업 방식에서 드러난 구멍

1. **게이트가 하류 정합성을 안 봤다.** B-1 은 분할 함수는 맞고 **그 결과를 쓰는 코드**가 안 맞은 경우다.
   돌연변이 6종을 돌렸어도 못 잡았다. Codex 의 `check-recovery-provenance.mjs`
   (`assert Wtr == W[_tri]`, 실제 전처리 실행)가 옳은 방식이다.
2. **로그 부재를 근거로 단정했다.** "`[SCHED]` 0줄 = 파이프라인이 안 들어갔다" 는 과했다 —
   그 로그는 끝에서만 찍힌다. 상태를 노출(`pipe`)하고 나서야 한 번에 갈렸다.
3. **문구를 사실보다 먼저 썼다.** 시간외 "수집 경로가 시각을 안 준다"(실제 정상) ·
   `[FETCH] 일봉결측`(실제는 시간외 가드) · v7 "응답하지 않는다"(실제는 빈 응답) — 셋 다 자작·자수정.
