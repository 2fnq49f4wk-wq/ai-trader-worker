// [V33.205] STACK 홀드아웃(OOF) 계약 게이트
//   STACK 은 "여러 모델을 하나로 통합" 하는 자리다 — 전문가 8명의 확률 8개 + 참여마스크 8개를
//   입력으로 받아 최종 확률을 내고, 투표를 ★통째로 대체★ 한다.
//   그런데 표본이 47.7일 동안 1,275건(≈27건/일)밖에 안 모여 퍼징 후 350/600 으로 대기 중이었다.
//   원인은 누출 방지 규칙이다: '전문가가 학습한 적 없는 행' 만 쓰는데, 그 기준선(stack_expert_epoch)이
//   ★매일 밤 현재로 갱신★ 되므로 하루치밖에 안 남는다.
//
//   그 규칙 자체는 옳다 — V33.104 가 실측으로 확인했다(in-sample 로 학습했더니 IC 0.566 · t 7.51
//   이라는 비현실적 수치가 나왔고, 그건 "전문가를 전적으로 믿어라" 를 배운 것이었다).
//   틀린 것은 그것이 ★유일한★ 누출없는 경로라고 본 것이다. 외부 학습기는 시간순 뒤쪽 20%를
//   홀드아웃으로 떼고 퍼지·엠바고를 건 뒤 앞쪽만으로 학습하므로, 업로드된 모델은 그 구간을
//   학습한 적이 없다 — 그 구간이 곧 out-of-fold 다(추가 GPU 비용 0).
//
//   이 게이트가 지키는 것은 하나다: ★그 문을 열되, 누출 쪽으로는 절대 안 열리게★.
import fs from "node:fs";
const src = fs.readFileSync("src/index.js", "utf8");
const py = fs.readFileSync("trainer/modal/modal_train.py", "utf8");
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };

// ── ① 경계는 앞으로만 간다 ★가장 중요★ ────────────────────────────────────
//   경계를 과거로 되돌리면 이미 학습에 쓰인 구간이 '누출없음' 으로 열린다 — V33.104 사고의 재발.
{
  const i = src.indexOf('path === "/api/stack-oof-window"');
  if (i < 0) no("STACK-OOF: 경계 수신 엔드포인트가 없다");
  else {
    const seg = src.slice(i, i + 2600);
    if (!/_mt < _pv/.test(seg))
      no("STACK-OOF: 경계가 과거로 되돌아가는 것을 막지 않는다 — 학습에 쓰인 구간이 열린다");
    else ok("경계는 단조 전진만 허용(과거로 되돌리면 409 로 거절)");
    if (!/_trainAuthed\(\)/.test(seg)) no("STACK-OOF: 경계 수신에 인증이 없다");
    else ok("경계 수신은 TRAIN_KEY 인증 필요");
    if (!/featVer 불일치/.test(seg)) no("STACK-OOF: featVer 를 확인하지 않는다 — 판이 다른 경계를 받는다");
    else ok("featVer 일치 확인");
    if (!/minTs 가 미래다/.test(seg)) no("STACK-OOF: 미래 시각을 거절하지 않는다");
    else ok("미래 시각 거절");
  }
}

// ── ② 에폭 경로를 대체하지 않고 '추가' 한다 ──────────────────────────────
//   에폭 경로는 신규 수확분(전문가가 아직 못 본 행)을 잡는다. 둘은 겹치지 않는 다른 구간이다.
{
  const i = src.indexOf("async function stackSampleBackfill");
  const seg = src.slice(i, i + 12000);
  if (!/stack_expert_epoch/.test(seg)) no("STACK-OOF: 에폭 경로가 사라졌다 — 신규 수확분을 못 잡는다");
  else ok("에폭 경로 유지(신규 수확분) + 홀드아웃 경로 추가");
  if (!/stack_oof_cursor/.test(seg))
    no("STACK-OOF: 홀드아웃 경로에 전용 커서가 없다 — 에폭 커서와 섞이면 신규분을 건너뛴다");
  else ok("홀드아웃 전용 커서(ts 와 id 의 순서가 다르므로 섞으면 안 된다)");
  if (!/if \(_src === "홀드아웃"\)/.test(seg))
    no("STACK-OOF: 읽은 경로에 따라 커서를 갈라 전진시키지 않는다");
  else ok("읽은 경로의 커서만 전진");
  // 홀드아웃 조회는 반드시 ts 하한을 건다 — id 만으로 뽑으면 과거 구간이 섞인다(소급표본은 ts 과거·id 큼).
  if (!/WHERE ts >= \? AND id > \? AND featver = \?/.test(seg))
    no("STACK-OOF: 홀드아웃 조회에 ts 하한이 없다 — 소급표본(ts 과거·id 큼)이 섞여 누출된다");
  else ok("홀드아웃 조회에 ts 하한(누출 구간 차단)");
}

// ── ③ 학습기가 보내는 경계가 실제 분할 경계와 같은가 ─────────────────────
{
  if (!/samples\.sort\(key=lambda s: s\.get\("ts", 0\)\)/.test(py))
    no("STACK-OOF: 학습기가 표본을 시간순 정렬하지 않는다 — TS[N-n_val] 이 경계가 아니다");
  else ok("학습기는 표본을 시간순 정렬한다");
  if (!/_oof_min_ts = int\(TS\[N - n_val\]\)/.test(py))
    no("STACK-OOF: 학습기가 보내는 경계가 홀드아웃 첫 표본의 ts 가 아니다");
  else ok("보내는 경계 = 홀드아웃 첫 표본의 ts (분할과 같은 식)");
  if (!/"\/api\/stack-oof-window"/.test(py)) no("STACK-OOF: 학습기가 경계를 보내지 않는다");
  else ok("학습기가 학습 후 경계를 통지한다");
  // 네 모델이 같은 분할 규칙을 쓰는지 — 하나라도 다르면 그 모델엔 누출이 남는다.
  const tails = py.match(/nval = max\(\d+, int\(N \* (VALFRAC|0\.2)\)\)/g) || [];
  if (tails.length < 3)
    no(`STACK-OOF: 외부 모델들이 같은 홀드아웃 비율을 쓰는지 확인 불가(${tails.length}건만 확인됨)`);
  else ok(`외부 모델 ${tails.length + 1}종이 같은 규칙(뒤쪽 20%)으로 홀드아웃을 뗀다`);
  if (!/VALFRAC = 64, 600, 50, 0\.2|VALFRAC = 0\.2|, 0\.2$/m.test(py) && !/MAXBINS, MAXTREES, PATIENCE, VALFRAC = 64, 600, 50, 0\.2/.test(py))
    no("STACK-OOF: GBDT 의 VALFRAC 이 0.2 가 아니다 — 다른 경계를 쓴다");
  else ok("GBDT VALFRAC = 0.2 (DNN·부스터·MIND 와 동일)");
}

// ── ④ 수치 재현 — 경계 규칙이 실제로 누출을 막는가 ────────────────────────
//   "ts >= minTs 인 행은 그 모델이 학습한 적이 없다" 가 성립해야 한다.
//   학습셋은 (인덱스 < N-n_val) AND (ts < 경계 - 엠바고) 이므로, 경계 이상 ts 는 학습셋에 있을 수 없다.
{
  const N = 5000, valFrac = 0.2, embargoMs = 6 * 86400000;
  const TS = [];
  let t = Date.UTC(2026, 0, 1);
  for (let i = 0; i < N; i++) { if (i % 40 === 0) t += 86400000; TS.push(t); }  // 하루에 40건(동률 다수)
  const nVal = Math.max(20, Math.floor(N * valFrac));
  const minTs = TS[N - nVal];
  const cutTs = minTs - embargoMs;
  // 학습셋 구성(학습기와 같은 식)
  const train = [];
  for (let i = 0; i < N; i++) if (i < N - nVal && TS[i] < cutTs) train.push(i);
  // 워커가 '누출없음' 으로 여는 집합
  const opened = [];
  for (let i = 0; i < N; i++) if (TS[i] >= minTs) opened.push(i);
  const trainSet = new Set(train);
  const leak = opened.filter((i) => trainSet.has(i));
  if (leak.length) no(`STACK-OOF: 경계 규칙이 학습셋 ${leak.length}건을 '누출없음' 으로 연다`);
  else ok(`경계 규칙 재현 — 열린 ${opened.length}건 중 학습셋과 겹치는 행 0건(동률 ts 다수 조건에서)`);
  /* 경계를 과거로 물리면 누출이 생겨야 한다 — 검사가 무의미하지 않다는 증명.
     ★엠바고(6일)보다 더 물려야 한다★: 그 안쪽은 학습셋에서 이미 잘려 있는 완충구간이라
     조금 물리는 것만으로는 학습셋에 닿지 않는다. 이 완충이 존재한다는 것 자체가
     '경계가 조금 흔들려도 바로 누출은 아니다' 를 뜻하지만, 단조 전진을 포기할 이유는 아니다 —
     아래처럼 엠바고를 넘겨 물리는 순간 학습셋이 통째로 열린다. */
  const badMin = minTs - 12 * 86400000;
  const openedBad = [];
  for (let i = 0; i < N; i++) if (TS[i] >= badMin) openedBad.push(i);
  const leakBad = openedBad.filter((i) => trainSet.has(i));
  if (!leakBad.length)
    no("STACK-OOF: 경계를 과거로 물려도 누출이 안 생긴다 — 재현이 계약을 증명하지 못한다");
  else ok(`경계를 12일(엠바고 6일 초과) 과거로 물리면 학습셋 ${leakBad.length}건이 열린다 — 단조 전진이 필요한 이유`);
}

// ── [V33.227] ★창이 보장한 모델만 채운다★ ────────────────────────────────────
/*  외부 학습기가 보내는 OOF 창은 models 목록을 함께 싣는다 —
    "ts >= minTs 구간을 ★이 모델들이★ 학습한 적 없다"(실측: dnn·gbdt·boost·mind).
    그런데 소급생성은 그 목록을 ★읽어만 놓고 쓰지 않아★ memo·rule 까지 채우고 있었다.
    memo 는 ml_samples 로 학습하고 학습창이 최근 구간이라, OOF 창 안의 행을 memo 로 채점하면
    in-sample 확률이 나온다. 그러면 STACK 이 부풀려진 확률에서 "memo 를 믿어라" 를 배운다.
    실측이 그 방향과 맞았다: 표본 6,331(t 1.73) → 6,931(t 0.91). 더할수록 나빠졌다. */
{
  const i2 = src.indexOf("async function stackSampleBackfill");
  const fn = i2 >= 0 ? src.slice(i2, src.indexOf("\n}\n", i2)) : "";
  if (!fn) no("STACK-OOF: 소급생성 함수를 찾지 못했다 — 검사가 헛돈다");
  else {
    if (!/_oofModels/.test(fn))
      no("STACK-OOF: 창의 models 목록을 읽지 않는다 — 보장 없는 슬롯까지 채우게 된다");
    else ok("창의 models 목록을 읽는다");
    const allow = (fn.match(/const _allow = function \(k\)[^\n]*\n/) || [""])[0];
    if (!/_src !== "홀드아웃"/.test(allow) || !/_oofModels\.indexOf\(k\) >= 0/.test(allow))
      no("STACK-OOF: 홀드아웃 경로에서 슬롯을 창의 목록으로 거르지 않는다");
    else ok("홀드아웃 경로는 창이 보장한 슬롯만 채운다(에폭 경로는 다른 기준이라 그대로)");
    // 채점되는 슬롯 전부가 _allow 를 지나야 한다 — 하나라도 빠지면 그 슬롯이 오염 통로다.
    const slots = ["mind", "dnn", "gbdt", "boost", "memo"];
    const missed = slots.filter(function (k) { return !new RegExp('_allow\\("' + k + '"\\)').test(fn); });
    if (missed.length) no("STACK-OOF: _allow 를 안 지나는 슬롯이 있다 — " + missed.join(", "));
    else ok("채점 슬롯 전부가 _allow 를 지난다(mind·dnn·gbdt·boost·memo)");
  }

  // 오염된 판과 섞이지 않게 판이 올라갔는가
  const fv = (src.match(/featVer:\s*(\d+),\s*\n\s*minTrainSamples:\s*600/) || [])[1];
  if (!(Number(fv) >= 5)) no("STACK-OOF: 오염 발견 후에도 STACKML.featVer 가 그대로다 — 옛 표본과 섞인다");
  else ok(`STACKML.featVer = ${fv} — 오염된 표본과 판이 갈렸다`);

  // 경로 태그가 남는가 — 다음엔 추측 대신 잴 수 있어야 한다
  if (!/src \|\| "live"/.test(src) || !/_src === "홀드아웃" \? "oof" : "epoch"/.test(src))
    no("STACK-OOF: 표본에 경로(src)를 남기지 않는다 — 어느 경로가 희석했는지 잴 수 없다");
  else ok("표본에 경로(live/epoch/oof)를 남긴다 — 경로별 IC 를 잴 수 있다");
}


// ── ⑤ ★판이 올라가면 홀드아웃 커서가 되감기는가★ ─────────────────────────────
//   [V33.228] V33.227 이 누출을 고치며 STACKML.featVer 를 4→5 로 올렸다. 옛 판 표본 6,931건은
//   학습에서 빠져 STACK 은 즉시 표본 0 이 됐는데, 홀드아웃 커서는 창 끝에 그대로 서 있었다.
//   소급생성은 "홀드아웃 구간도 소진" 만 반복하고, 새 판 표본은 에폭 경로의 하루 27건씩만
//   들어온다 — 문턱 600 까지 몇 주가 걸린다는 뜻이다(실측 samples 0).
//
//   되감기가 누출이 아닌 이유: 이 경로의 차단은 ts >= minTs 가 한다(단조 전진하는 창 경계).
//   커서는 사본을 막는 쪽수표일 뿐이다. 그래서 되감기 조건은 '판이 다르다' 가 아니라
//   ★지금 판으로 만든 홀드아웃 표본이 0★ 이다 — 0 이면 사본이 생길 수 없고,
//   1건이라도 있으면 이미 훑은 것이므로 절대 되감지 않는다.
//
//   정적 문구 검사로는 이 계약을 지킬 수 없다(커서 값이 답이다). 실제로 돌려서 ★홀드아웃
//   조회에 어떤 커서가 묶였는지★ 를 본다.
{
  const M = await import("../src/index.js");
  const FV = M.STACKML.featVer;
  const OOF_MIN = Date.now() - 30 * 86400000;

  function db(oofCursor, oofSampleCount) {
    const seen = { oofBind: null, epochBind: null };
    const state = {
      stack_expert_epoch: { id: 100 },
      stack_bf_cursor: { lastId: 5000, made: 6931 },
      stack_oof_window: { minTs: OOF_MIN, n: 6931, models: ["dnn", "gbdt", "boost", "mind"] },
      stack_oof_cursor: oofCursor
    };
    return {
      _seen: seen,
      prepare(sql) {
        const st = {
          _a: [],
          bind(...a) { st._a = a; return st; },
          async first() {
            if (/SELECT v FROM state WHERE k = \?/.test(sql)) {
              const v = state[st._a[0]];
              return v === undefined ? null : { v: JSON.stringify(v) };
            }
            if (/COUNT\(\*\) AS c FROM stack_samples/.test(sql)) return { c: oofSampleCount };
            if (/MAX\(id\) AS m FROM ml_samples/.test(sql)) return { m: 20000 };
            return null;
          },
          async all() {
            if (/FROM ml_samples WHERE ts >= \? AND id > \?/.test(sql)) { seen.oofBind = st._a.slice(); return { results: [] }; }
            if (/FROM ml_samples WHERE id > \?/.test(sql)) { seen.epochBind = st._a.slice(); return { results: [] }; }
            return { results: [] };
          },
          async run() { return { success: true }; }
        };
        return st;
      },
      async batch(a) { for (const x of a) await x.run(); return []; }
    };
  }

  // (a) 판 표기 없는 옛 커서 + 지금 판 홀드아웃 표본 0 → 되감아야 한다(프로덕션이 갇혀 있던 상태)
  {
    const d = db({ lastId: 9000 }, 0);
    await M.stackSampleBackfill(d, {});
    const b = d._seen.oofBind;
    if (b && b[1] === 0) ok("판 v" + FV + " 표본 0 · 옛 커서(9000) → 홀드아웃 커서를 0 으로 되감았다");
    else no("STACK-OOF: 판이 올라갔는데 커서가 " + (b ? b[1] : "?") + " 에 머문다 — 소급생성이 영영 막힌다");
    if (b && b[0] === OOF_MIN) ok("되감아도 창 경계(ts >= minTs)는 그대로다 — 누출 쪽은 안 열린다");
    else no("STACK-OOF: 되감으면서 창 경계까지 흔들렸다 — " + JSON.stringify(b));
  }

  // (b) 지금 판으로 이미 만든 홀드아웃 표본이 있으면 절대 되감지 않는다(사본 증식 차단)
  {
    const d = db({ lastId: 9000 }, 3);
    await M.stackSampleBackfill(d, {});
    const b = d._seen.oofBind;
    if (b && b[1] === 9000) ok("지금 판 표본이 이미 있으면 되감지 않는다(사본 증식 차단)");
    else no("STACK-OOF: 이미 훑은 판인데 커서를 되감았다 — 같은 행이 두 번 표본이 된다: " + JSON.stringify(b));
  }

  // (c) 커서에 지금 판이 적혀 있으면 표본 수와 무관하게 유지한다
  {
    const d = db({ lastId: 9000, fv: FV }, 0);
    await M.stackSampleBackfill(d, {});
    const b = d._seen.oofBind;
    if (b && b[1] === 9000) ok("커서에 지금 판이 적혀 있으면 그대로 이어간다");
    else no("STACK-OOF: 같은 판인데 커서를 되감았다: " + JSON.stringify(b));
  }

  // 앞으로를 위해 판 표기를 남기는가 — 이게 없으면 다음 판 변경 때 또 (a) 로 돌아간다
  {
    const i = src.indexOf("async function stackSampleBackfill");
    const seg = src.slice(i, i + 14000);
    if (/setState\(DB, "stack_oof_cursor", \{ lastId: lastId, fv: STACKML\.featVer/.test(seg))
      ok("홀드아웃 커서에 판(fv)을 함께 남긴다 — 다음 판 변경은 자동으로 판별된다");
    else no("STACK-OOF: 커서에 판 표기를 안 남긴다 — 다음 featVer 변경 때 같은 정지가 재발한다");
  }
}

if (bad) { console.error(`\nSTACK 홀드아웃 계약 위반 ${bad}건 — 배포 차단`); process.exit(1); }
console.log("  ok   STACK 홀드아웃 계약 통과 — 문을 열되 누출 쪽으로는 안 열린다");
