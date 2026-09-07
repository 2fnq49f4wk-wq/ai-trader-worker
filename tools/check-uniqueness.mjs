// [V33.115] 표본 고유도(de Prado AFML 4장) 계약 검증 — ★두 자가 갈리지 않는가★.
//
//   고유도는 이제 두 곳에서 계산된다:
//     · 워커      src/index.js              _uniqWeights()
//     · 트레이너  trainer/modal/modal_train.py  _uniq_weights()
//   같은 모델을 서로 다른 자로 재면 위원회 안에서 ★어느 쪽 모델만 관대하게★ 신뢰된다.
//   실제로 V33.114 직후가 그 상태였다 — 워커 자체학습만 유효표본수로 하한을 재고,
//   Modal 이 올린 DNN·GBDT·MIND·단타는 명목 n 그대로였다. 고유도 0.1 이면 표본이 10배
//   부풀고 Wilson 하한이 √10≈3.2배 좁아진다. 같은 성적이어도 외부 모델만 승격된다.
//
//   그래서 이 게이트는 세 가지를 못 박는다.
//     ① 워커 _uniqWeights 의 수식 계약(겹침 정의·종목 분리·유효표본수)
//     ② 트레이너 _uniq_weights 가 ★같은 입력에 같은 출력★ 을 내는가 (실제 파이썬 코드를 실행)
//     ③ 업로드 핸들러 4곳이 명목 valN 이 아니라 _importedValN 을 쓰는가 (회귀 차단)
//
//   ②는 numpy 없이도 돌아야 한다(러너에 numpy 가 없을 수 있다). 트레이너 함수가 쓰는
//   numpy 표면은 ones/float64 둘뿐이라, 최소 스텁을 주입해 ★실제 함수 본문★ 을 실행한다.
//   재구현으로 비교하면 재구현이 틀렸을 때 조용히 통과한다 — 그건 검사가 아니다.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { _uniqWeights, _wilsonLB, _importedValN, mlPoolUniqNightly, mlPoolUniqGet, _effN }
  from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const DAY = 86400000;

// ══ ① 워커 _uniqWeights 수식 계약 ══════════════════════════════════════════
{
  // (a) 같은 종목, 지평 안에 촘촘히 10개 → 전부 겹친다 → 유효표본 ≈ 1
  const ts = [], sy = [];
  for (let i = 0; i < 10; i++) { ts.push(i * DAY); sy.push("AAA"); }
  const w = _uniqWeights(ts, sy, 10 * DAY);
  const sum = w.reduce((a, b) => a + b, 0);
  if (near(sum, 1, 1e-6)) ok("겹친 10개(지평 10일) → 유효표본 " + sum.toFixed(2) + " (기대 1)");
  else bad("겹친 10개의 유효표본이 " + sum.toFixed(3) + " — 1 이어야 한다");

  // (b) 서로 다른 10종목이 같은 시각 → 같은 사건이 아니다 → 전부 고유
  const w2 = _uniqWeights(new Array(10).fill(0), Array.from({ length: 10 }, (_, i) => "S" + i), 10 * DAY);
  const s2 = w2.reduce((a, b) => a + b, 0);
  if (near(s2, 10)) ok("10종목 동시각 → 유효표본 10 (종목 간은 겹침으로 세지 않는다)");
  else bad("10종목 동시각의 유효표본이 " + s2 + " — 10 이어야 한다. 종목 분리가 깨졌다");

  // (c) 지평보다 멀리 떨어지면 전부 고유
  const w3 = _uniqWeights(Array.from({ length: 10 }, (_, i) => i * 100 * DAY), new Array(10).fill("AAA"), 10 * DAY);
  const s3 = w3.reduce((a, b) => a + b, 0);
  if (near(s3, 10)) ok("멀리 떨어진 10개 → 유효표본 10");
  else bad("멀리 떨어진 10개의 유효표본이 " + s3);

  // (d) 경계 — |Δt| == span 은 ★겹침★ 이다(라벨 구간 [t, t+H] 가 끝점에서 맞닿는다).
  //     여기가 뒤집히면 유효표본수가 지평 하나만큼 계통적으로 부풀거나 줄어든다.
  const wb = _uniqWeights([0, 10 * DAY], ["AAA", "AAA"], 10 * DAY);
  if (near(wb[0], 0.5) && near(wb[1], 0.5)) ok("경계 |Δt|=지평 → 겹침으로 센다(0.5/0.5)");
  else bad("경계 처리 불일치: " + JSON.stringify(wb) + " — [0.5,0.5] 이어야 한다");

  // (e) spanMs 가 0/음수면 보정하지 않는다(균등가중 폴백)
  const w0 = _uniqWeights([0, 1, 2], ["A", "A", "A"], 0);
  if (w0.every((v) => v === 1)) ok("지평 0 → 균등가중 폴백");
  else bad("지평 0 인데 가중이 바뀌었다: " + JSON.stringify(w0));
}

// ══ ② 유효표본수가 Wilson 하한을 실제로 좁히는가 ════════════════════════════
{
  const acc = 0.55;
  const lbNom = _wilsonLB(acc, 3000);
  const lbEff = _wilsonLB(acc, 300);
  if (lbEff < lbNom) ok("유효표본 300 의 하한 " + lbEff.toFixed(4) + " < 명목 3000 의 " + lbNom.toFixed(4));
  else bad("유효표본을 줄였는데 하한이 안 좁아진다 — _wilsonLB 가 n 을 안 쓴다");
  // 명목으로 재면 게이트를 통과하지만 유효로 재면 못 통과하는 구간이 실제로 존재해야
  // 이 보정이 의미가 있다(없다면 그냥 장식이다).
  if (lbNom >= 0.52 && lbEff < 0.52) ok("문턱 0.52 에서 판정이 갈린다 — 보정이 실제로 작동하는 구간");
  else console.log("  info 문턱 0.52 기준 판정: 명목 " + lbNom.toFixed(4) + " / 유효 " + lbEff.toFixed(4));
}

// ══ ③ _importedValN — 유효표본수 선택기 ════════════════════════════════════
{
  const a = _importedValN({ valN: 3000, valNEff: 280, valUniq: 0.0933 }, 30);
  if (a.n === 280 && a.raw === 3000 && near(a.uniq, 0.0933, 1e-6)) ok("valNEff 있으면 그걸 쓴다 (n=280, 명목 3000)");
  else bad("valNEff 선택 실패: " + JSON.stringify(a));

  const b = _importedValN({ valN: 3000 }, 30);          // 구 트레이너 — 필드 없음
  if (b.n === 3000 && b.uniq === null) ok("valNEff 없으면 명목으로 폴백(구 트레이너 호환)");
  else bad("구 트레이너 폴백 실패: " + JSON.stringify(b));

  const c = _importedValN({ valN: 500, valNEff: 9000 }, 30);   // 유효 > 명목 = 말이 안 된다
  if (c.n === 500) ok("유효 > 명목은 거부하고 명목을 쓴다(오염된 업로드 방어)");
  else bad("유효 > 명목을 그대로 받았다: " + JSON.stringify(c));

  const d = _importedValN({}, 30);
  if (d.n === 30) ok("필드가 아예 없으면 기본값");
  else bad("기본값 처리 실패: " + JSON.stringify(d));
}

// ══ ④ 업로드 핸들러가 명목 valN 으로 하한을 재지 않는가 ═════════════════════
//   회귀 차단용 — 새 업로드 경로가 생기면서 옛 관용구를 복사해 오면 여기서 걸린다.
{
  const src = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const badLines = [];
  src.split("\n").forEach((ln, i) => {
    // `const <x>N = Math.max(1, Math.floor(_num(body.valN, ...)))` = 명목을 직접 쓰는 옛 관용구
    if (/Math\.floor\(_num\(body\.valN,/.test(ln)) badLines.push((i + 1) + ": " + ln.trim());
  });
  if (!badLines.length) ok("업로드 핸들러에 명목 valN 직접 사용 없음");
  else bad("명목 valN 직접 사용 " + badLines.length + "곳 — _importedValN 을 써야 한다:\n    " + badLines.join("\n    "));

  const nUse = (src.match(/_importedValN\(/g) || []).length;
  // 정의 1 + export 1 + 사용 5(dnn stage/dnn 단발/scalp/gbdt/fm)
  if (nUse >= 6) ok("_importedValN 사용 " + nUse + "곳");
  else bad("_importedValN 사용이 " + nUse + "곳뿐 — 업로드 경로 일부가 빠졌다");
}

// ══ ⑤ 트레이너 _uniq_weights 가 워커와 ★같은 자★ 인가 ══════════════════════
//   실제 파이썬 함수 본문을 실행해 워커 결과와 원소별로 비교한다.
{
  const py = fs.readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
  if (!/def _uniq_weights\(/.test(py)) {
    bad("트레이너에 _uniq_weights 가 없다 — 고유도를 안 보내면 워커가 명목 n 으로 폴백한다");
  } else {
    const shim = `
import ast, json, sys
# Codex V33.314: file URLs are not native Windows paths; Korean source is UTF-8.
src = open(${JSON.stringify(fileURLToPath(new URL("../trainer/modal/modal_train.py", import.meta.url)))}, encoding="utf-8").read()
tree = ast.parse(src)
fns = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ("_uniq_weights", "_uniq_fields")]
mod = ast.Module(body=fns, type_ignores=[])
class _NP:                       # numpy 미설치 러너 대비 최소 스텁 — 함수 본문은 원문 그대로 실행된다
    float64 = float
    def ones(self, n, dtype=None): return [1.0] * n
    def asarray(self, a, dtype=None): return [float(x) for x in a]
g = {"np": _NP()}
import types
_m = types.ModuleType("numpy"); _m.ones = g["np"].ones; _m.float64 = float; _m.asarray = g["np"].asarray
sys.modules["numpy"] = _m
exec(compile(mod, "trainer", "exec"), g)
cases = json.loads(sys.stdin.read())
out = [list(g["_uniq_weights"](c["ts"], c["sym"], c["span"])) for c in cases]
print(json.dumps(out))
`;
    const DAYP = DAY;
    const cases = [
      { ts: Array.from({ length: 10 }, (_, i) => i * DAYP), sym: new Array(10).fill("AAA"), span: 10 * DAYP },
      { ts: new Array(10).fill(0), sym: Array.from({ length: 10 }, (_, i) => "S" + i), span: 10 * DAYP },
      { ts: [0, 10 * DAYP], sym: ["AAA", "AAA"], span: 10 * DAYP },
      // 뒤섞인 순서 + 종목 혼재 — 정렬·그룹화가 어긋나면 여기서 갈린다
      { ts: [5 * DAYP, 0, 100 * DAYP, 2 * DAYP, 1 * DAYP, 50 * DAYP],
        sym: ["A", "A", "A", "B", "A", "B"], span: 3 * DAYP }
    ];
    let pyOut = null;
    try {
      const r = execFileSync("python3", ["-c", shim], { input: JSON.stringify(cases), encoding: "utf8" });
      pyOut = JSON.parse(r);
    } catch (e) {
      bad("트레이너 _uniq_weights 실행 실패 — 두 자가 같은지 확인할 수 없다: " + String(e && e.message).slice(0, 300));
    }
    if (pyOut) {
      let mism = 0;
      cases.forEach((c, i) => {
        const jsW = _uniqWeights(c.ts, c.sym, c.span);
        const pw = pyOut[i];
        if (jsW.length !== pw.length) { mism++; bad("케이스 " + i + " 길이 불일치"); return; }
        for (let k = 0; k < jsW.length; k++) {
          if (!near(jsW[k], pw[k], 1e-9)) {
            mism++;
            bad("케이스 " + i + " [" + k + "] 워커 " + jsW[k] + " vs 트레이너 " + pw[k]);
            break;
          }
        }
      });
      if (!mism) ok("트레이너 _uniq_weights == 워커 _uniqWeights (" + cases.length + "케이스 원소별 일치)");
    }
  }

  // 트레이너가 실제로 valNEff 를 ★올리는가★ — 계산만 하고 안 보내면 워커는 명목으로 폴백한다.
  const nUpload = (py.match(/_uniq_fields\(/g) || []).length;
  if (nUpload >= 6) ok("트레이너가 _uniq_fields 를 " + nUpload + "곳에서 모델에 합친다");
  else bad("_uniq_fields 사용이 " + nUpload + "곳뿐 — 업로드 경로(DNN·GBDT·시장별·부스터·MIND·단타)에 빠진 곳이 있다");

  // 명목 nval 로 Wilson 하한을 재는 잔재가 남아있지 않은가
  const stale = [];
  py.split("\n").forEach((ln, i) => {
    if (/_wilson\((?:v)?acc, ?nval\)|z2 \/ \(2 \* n\)\) - z \* math\.sqrt\(\(acc/.test(ln)) stale.push((i + 1) + ": " + ln.trim());
  });
  if (!stale.length) ok("트레이너에 명목 n 기반 Wilson 하한 잔재 없음");
  else bad("명목 n 으로 하한을 재는 곳 " + stale.length + ":\n    " + stale.join("\n    "));
}

// ══ ⑥ 워커 자체학습 경로 — 풀 고유도(mlPoolUniqNightly/Get)와 _effN ═════════════
//   외부 업로드만 유효표본수로 재고 워커 자체학습은 명목으로 재면, 이번엔 ★반대 방향의★
//   비대칭이 생긴다(워커 모델만 관대). 같은 자를 쓰는지 여기서 못 박는다.
{
  // _effN 계약
  if (_effN(1000, 0.25) === 250) ok("_effN(1000, 0.25) = 250");
  else bad("_effN 계산이 틀렸다: " + _effN(1000, 0.25));
  if (_effN(1000, 1) === 1000) ok("고유도 1 이면 항등(보정 없음)");
  else bad("고유도 1 인데 값이 변했다: " + _effN(1000, 1));
  if (_effN(1000, 0.0001) === 8) ok("바닥 8 로 클램프 — 유효표본이 0 이 되지는 않는다");
  else bad("바닥 클램프 실패: " + _effN(1000, 0.0001));
  if (_effN(0, 0.5) === 0) ok("n=0 이면 0");
  else bad("n=0 처리 실패: " + _effN(0, 0.5));

  // 합성 ml_samples 로 야간 측정기를 실제로 돌린다 — 참값을 아는 자료에서 되찾는가.
  //   같은 종목 5개를 하루 간격으로 넣으면(지평 10일) 전부 겹치므로 평균 고유도 = 1/5.
  const SYMS = ["AAA", "BBB", "CCC", "DDD"], PER = 60;
  const rows = [];
  for (const s of SYMS) for (let i = 0; i < PER; i++) rows.push({ ts: i * DAY, symbol: s });
  const store = new Map();
  const db = {
    prepare(sql) {
      const st = { _a: [], bind(...a) { st._a = a; return st; },
        async first() {
          if (/SELECT v FROM state WHERE k = \?/.test(sql)) { const v = store.get(st._a[0]); return v === undefined ? null : { v }; }
          return null;
        },
        async all() { return /FROM ml_samples/.test(sql) ? { results: rows } : { results: [] }; },
        async run() { if (/INSERT INTO state/.test(sql)) store.set(st._a[0], st._a[1]); return {}; } };
      return st;
    },
    async batch(a) { for (const s of a) await s.run(); return []; }
  };
  const msg = await mlPoolUniqNightly(db);
  const saved = store.get("ml_pool_uniq") ? JSON.parse(store.get("ml_pool_uniq")) : null;
  if (!saved) bad("mlPoolUniqNightly 가 ml_pool_uniq 를 저장하지 않았다: " + msg);
  else {
    // 하루 간격 · 지평 10일 → 각 표본이 ±10일 창에서 최대 21개와 겹친다(끝단은 더 적다).
    // 종목마다 60개이므로 평균 고유도는 1/21 근방이어야 한다(끝단 효과로 조금 큼).
    const u = saved.uBar;
    if (u > 1 / 21 && u < 0.10) ok("풀 평균 고유도 " + u.toFixed(4) + " — 하루간격·지평10일의 이론값(≈1/21=0.048) 근방");
    else bad("풀 평균 고유도가 " + u + " — 1/21 근방이어야 한다 (겹침 정의가 어긋났다)");
    if (saved.n === rows.length) ok("측정 표본수 " + saved.n);
    else bad("표본수 불일치: " + saved.n + " vs " + rows.length);
    const got = await mlPoolUniqGet(db);
    if (near(got, u, 1e-9)) ok("mlPoolUniqGet 이 저장값을 그대로 돌려준다");
    else bad("Get 이 " + got + " 를 돌려줬다 (저장 " + u + ")");
  }

  // 오래된 값은 쓰지 않는다 — 표본 분포가 바뀐 뒤의 낡은 고유도로 하한을 깎으면 그건 측정이 아니다.
  store.set("ml_pool_uniq", JSON.stringify({ uBar: 0.05, ts: Date.now() - 400 * 3600000 }));
  const stale = await mlPoolUniqGet(db);
  if (stale === 1) ok("스태일(72h 초과) 고유도는 무시하고 1(보정 없음)");
  else bad("스태일 값을 그대로 썼다: " + stale);

  // 표본이 없으면 조용히 1 — 새 배포/새 계정에서 하한이 갑자기 깎이면 안 된다.
  store.clear();
  const none = await mlPoolUniqGet(db);
  if (none === 1) ok("측정값 없으면 1(종전과 동일 동작)");
  else bad("측정값이 없는데 " + none);
}

// ══ ⑦ 워커 자체학습 6종이 전부 유효표본수를 쓰는가 ═════════════════════════════
{
  const src = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  // 야간 파이프라인에 pooluniq 단계가 크론·수동 양쪽에 있는가(한쪽만 있으면 수동 실행 결과를 못 믿는다)
  const inCron = /_stg\("pooluniq"/.test(src);
  const inPipe = /\["pooluniq",/.test(src);
  if (inCron && inPipe) ok("pooluniq 단계가 크론·수동 파이프라인 양쪽에 등록됨");
  else bad("pooluniq 등록 누락 — 크론 " + inCron + " / 수동 " + inPipe);

  // 학습기들이 명목 길이를 그대로 Wilson 에 넣고 있지 않은가
  const raw = [];
  src.split("\n").forEach((ln, i) => {
    const m = ln.match(/_wilsonLB\([^,]+,\s*([A-Za-z_$][\w$.]*(?:\.length)?)\s*[,)]/);
    if (!m) return;
    const arg = m[1];
    // 명목 개수를 그대로 넘기는 관용구만 잡는다: `<배열>.length` 또는 `<집계>.n`.
    //   변수로 받은 값은 이름만으로 명목/유효를 알 수 없으므로 여기선 판정하지 않는다
    //   (그건 아래 ⑦-b 의 "자체학습기가 mlPoolUniqGet 을 부르는가" 로 잡는다).
    if (!/\.length$/.test(arg) && !/^[A-Za-z_$][\w$]*\.n$/.test(arg)) return;
    raw.push((i + 1) + ": " + ln.trim().slice(0, 120));
  });
  if (!raw.length) ok("Wilson 하한 호출이 전부 유효표본수 변수를 쓴다");
  else console.log("  info 명목 길이를 직접 넘기는 곳 " + raw.length + "곳(겹침 없는 표본이면 정상):\n    " + raw.join("\n    "));

  // 자체학습 4종이 실제로 풀 고유도를 조회하는가
  const need = ["mlTrainNightly", "mlBrainTrainNightly", "mlMindTrainNightly", "mlDNNTrainNightly", "mlGBDTTrainNightly"];
  const miss = [];
  for (const fn of need) {
    const at = src.indexOf("async function " + fn + "(");
    if (at < 0) { miss.push(fn + "(함수 없음)"); continue; }
    // 다음 최상위 함수 선언까지가 이 함수의 범위
    const nx = src.indexOf("\nasync function ", at + 10);
    const nx2 = src.indexOf("\nfunction ", at + 10);
    const end = Math.min(nx < 0 ? src.length : nx, nx2 < 0 ? src.length : nx2);
    if (!/mlPoolUniqGet\(/.test(src.slice(at, end))) miss.push(fn);
  }
  if (!miss.length) ok("자체학습 " + need.length + "종이 모두 풀 고유도를 조회한다");
  else bad("풀 고유도를 안 쓰는 자체학습기: " + miss.join(", ") + " — 이 모델만 명목 n 으로 관대하게 승격된다");
}

console.log(fails ? "\n고유도 계약 위반 " + fails + "건" : "\n  ok   고유도 계약 통과");
process.exit(fails ? 1 : 0);
