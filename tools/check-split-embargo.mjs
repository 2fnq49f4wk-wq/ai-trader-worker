/* [V33.341] 검증 분할 — ★모델마다 다른 자로 재고 있지 않은가★
 *
 *   사용자 지시: "내부 탑재 ai 문제부터 해결해라 잡음이랑 구별 안되는거랑
 *   검증 성능 안나오는거 전부 해결시켜라".
 *
 *   감사에서 나온 것은 "모델이 약하다"가 아니라 ★자가 서로 달랐다★ 는 것이다.
 *
 *   ① 엠바고가 DNN 에만 있었다.
 *        DNN(train_job)                     : cut_ts = TS[N-n_val] − embargo  ← 비운다
 *        GBDT · XGB/LGB/CAT · 시장별 · MIND : Xs[:-nval]                      ← ★안 비운다★
 *      라벨 지평이 10일인데 경계를 안 비우면 경계 직전 학습표본의 결과 구간이 검증과 겹친다
 *      (de Prado purging). 그리고 안 비우던 그 모델들이 ★위원회에 앉아 실제 돈을 거는★ 모델들이다.
 *      승격 게이트는 "정직하게 잰 모델" 과 "겹쳐서 잰 모델" 을 같은 문턱으로 비교해 왔다.
 *
 *   ② 엠바고 길이 자체가 지평보다 짧았다.
 *        LUXML.embargoDays = 6 인데 AI_PARAMS.predictionHorizonDays = 10.
 *        V32.10 이 지평을 5→10 으로 올릴 때 엠바고는 안 따라갔고 주석만 "horizon(5일)" 로 남았다.
 *
 *   ③ 유효표본이 모델마다 달랐다 — ★같은 풀인데 10배★.
 *        DNN·MIND 는 τ* 를 검증 앞절반에서 고르고 뒤절반으로만 채점했다(유효 ≈690 / ≈950).
 *        부스터는 검증 전체로 채점했다(유효 ≈7,400). Wilson 하한은 표본 수에 직접 걸리므로,
 *        "DNN 검증 미달" 의 상당 부분은 실력이 아니라 자의 길이였다.
 *      → τ* 는 ★학습 구간의 꼬리★ 에서 고른다(학습에서 뺐으니 안 부풀고, 엠바고가 검증과 가른다).
 *
 *   ※ 정직하게: 엠바고 누출량은 실측 0.14%p 였다(시뮬레이션, 지평 10일·표본 2.8만).
 *     이걸 "성능이 뛴다" 로 팔지 않는다. 고치는 이유는 ★같은 자로 재기 위해서★ 다.
 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };

// ── ① 분할이 한 곳에서만 나오는가 ──────────────────────────────────────
{
  if (/^def _split_ts\(/m.test(PY)) ok("_split_ts — 시간순 분할·엠바고를 정하는 함수가 하나 있다");
  else bad("★분할 함수가 없다★ — 학습기마다 자기 방식으로 자르면 자가 갈린다");
  const calls = (PY.match(/_split_ts\(/g) || []).length - 1;   // 정의 1건 제외
  if (calls >= 5) ok(`학습기 ${calls}곳이 그 함수를 부른다(DNN·GBDT·부스터·시장별·MIND)`);
  else bad(`★${calls}곳만 공용 분할을 쓴다★ — 나머지는 자기 방식으로 자른다`);
  /* 옛 방식이 한 줄이라도 남아 있으면 그 학습기는 여전히 경계를 안 비운다. */
  const naked = (PY.match(/Xtr, Ytr, Xva, Yva = Xs\[:-nval\]/g) || []).length;
  if (naked === 0) ok("경계를 안 비우는 옛 분할(Xs[:-nval])이 남아 있지 않다");
  else bad(`★엠바고 없는 분할이 ${naked}곳 남아 있다★ — 그 모델은 라벨 지평만큼 겹쳐서 잰다`);
}

// ── ② 엠바고가 라벨 지평 이상인가 ──────────────────────────────────────
{
  const h = M.AI_PARAMS.predictionHorizonDays;
  const e = M.LUXML.embargoDays;
  if (e >= h) ok(`엠바고 ${e}일 ≥ 라벨 지평 ${h}일 — 경계에서 라벨이 새지 않는다`);
  else bad(`★엠바고 ${e}일 < 라벨 지평 ${h}일★ — 그 차이 ${h - e}일만큼 경계에서 그냥 샌다`);
  /* 손으로 적은 상수로 되돌아가면 다음에 지평이 바뀔 때 또 갈라진다. */
  if (/get embargoDays\(\)/.test(S)) ok("엠바고를 지평에서 파생시킨다 — 지평을 바꾸면 따라온다");
  else bad("★엠바고가 다시 손으로 적은 상수다★ — 지평이 바뀌면 조용히 어긋난다");
  if (/max\(float\(embargo_ms or 0\), float\(horizon_ms or 0\)\)/.test(PY))
    ok("트레이너도 지평 미만 엠바고를 지평으로 올려 쓴다(워커만 고치면 비대칭이 남는다)");
  else bad("★트레이너가 짧은 엠바고를 그대로 쓴다★");
}

// ── ③ τ* 를 검증에서 고르지 않는가 ─────────────────────────────────────
{
  if (/cal_frac=0\.10/.test(PY)) ok("DNN·MIND 가 학습 꼬리에서 보정 구간을 떼어 낸다");
  else bad("★보정 구간이 없다★ — τ* 를 검증에서 고르면 그 모델만 유효표본이 절반이 된다");
  if (/cal, tr = tr\[-ncal:\], tr\[:-ncal\]/.test(PY))
    ok("보정 구간은 ★학습에서 뺀다★ — 학습에 쓴 구간으로 τ* 를 고르면 τ* 가 부푼다");
  else bad("★보정 구간을 학습에서 빼지 않는다★ — τ* 가 낙관적으로 잡힌다");
  if (/half = 0 if _cal_src is not None else/.test(PY))
    ok("보정을 따로 뺐으면 DNN 이 ★검증 전체★ 로 채점받는다 — 부스터와 같은 자");
  else bad("★DNN 이 여전히 검증 뒤절반으로만 채점받는다★ — 유효표본 절반, 하한도 그만큼 낮다");
  if (/_hs = 0 if _useCal else/.test(PY))
    ok("MIND 도 같은 규칙으로 검증 전체를 쓴다");
  else bad("★MIND 만 다른 규칙으로 채점받는다★");
  /* 학습을 너무 많이 떼면 그것대로 성능이 무너진다 — 상한이 있는지 본다. */
  if (/min\(ncal, len\(tr\) \/\/ 3\)/.test(PY)) ok("보정 구간이 학습의 1/3 을 넘지 않는다");
  else bad("★보정 구간 상한이 없다★ — 학습이 통째로 줄어들 수 있다");
}

// ── ④ 출처 가중이 트레이너까지 닿는가 ──────────────────────────────────
{
  /* liveSrcWeight 는 워커 자체 학습기 다섯 곳이 쓰는데 Modal 로는 안 내려갔다.
     위원회에 앉는 모델은 전부 external 이므로, 그 설정은 위원회에 한 번도 닿은 적이 없다. */
  if (/liveSrcWeight: LUXML\.liveSrcWeight/.test(S)) ok("워커가 실거래 표본 가중을 트레이너에 내려보낸다");
  else bad("★liveSrcWeight 가 트레이너로 안 간다★ — 워커에만 있는 죽은 손잡이가 된다");
  if (/live_w = float\(cfg\.get\("liveSrcWeight"/.test(PY) && /np\.where\(HV > 0, hv_w, live_w\)/.test(PY))
    ok("트레이너가 그 값을 실제로 쓴다 — 종전엔 라이브가 언제나 1.0 이었다");
  else bad("★트레이너가 실거래 가중을 무시한다★");
}

// ── ⑤ 수확이 만들 수 없는 칸을 라이브에서도 안 만드는가 ────────────────
{
  /* ※ 이건 성능 주장이 아니라 위생이다. 시뮬레이션에서 이 칸들의 효과는 잡음 수준이었다
     (MLP 56.7% → 57.1%). 고치는 이유는 학습·검증·서빙이 같은 분포 위에 서야 하기 때문이다. */
  if (M.LUXML.liveCtxNeutral === true) ok("신호 컨텍스트 중립화가 켜져 있다");
  else bad("★중립화가 꺼져 있다★ — 수확 80% 에서 상수인 칸이 라이브에서만 값을 갖는다");
  /* [V33.370] 앵커를 ★글자★ 에서 ★뜻★ 으로 옮긴다.
     종전엔 `f.sigWeight = 1; f.confluence = 1;` 이라는 한 줄을 글자 그대로 찾았다.
     V33.370 이 그 여섯 줄을 단일 출처 표(_LIVE_ONLY_NEUTRAL) 루프로 접자 멀쩡한 코드가
     실패했다 — 이 저장소가 이미 여러 번 겪은 모양이다(V33.260 · check-market-fixed-effect).
     여기서 볼 것은 "그 줄이 있는가" 가 아니라 "생성기가 한 곳에서 중립화하는가" 다.
     값까지 맞는지는 check-live-only-feats 가 ★실제로 실행해★ 본다(거기가 본진이다). */
  if (/if \(LUXML\.liveCtxNeutral !== false\) \{[\s\S]{0,240}?_LIVE_ONLY_NEUTRAL/.test(S))
    ok("피처 생성기 한 곳에서 단일 출처 표로 덮어쓴다 — 수확·라이브·반사실이 전부 이 함수를 지난다");
  else bad("★중립화가 피처 생성기에 없다(또는 단일 출처 표를 안 쓴다)★");
  if (/liveCtxIdx: LUXML\.featNames\.reduce/.test(S))
    ok("중립화할 칸 위치를 ★세어서★ 내려보낸다 — featNames 가 바뀌어도 안 어긋난다");
  else bad("★칸 위치를 손으로 적었거나 안 내려보낸다★");
  if (/X\[:, _c\] = _lc_val\[_k\]/.test(PY))
    ok("트레이너가 저장된 옛 표본에서도 같은 칸을 눌러 맞춘다 — 표본을 버리지 않는다");
  else bad("★트레이너가 옛 표본을 안 맞춘다★ — 학습·검증이 서빙과 다른 분포에 선다");
}

if (fails) { console.error(`\n✗ 분할·엠바고 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 분할·엠바고 통과 — 모든 모델이 같은 자로 잰다");
