/* ═══════════════════════════════════════════════════════════════════════════
   [V33.425] ★OMNI 라벨 계약★ — "배리어는 라벨이 아니다" 를 구조로 못 박는다.

   실측이 두 번 말했다(2026-09-23 · 1,008종목 · 1,735,157행):
     30m AUC 0.492 · 60m 0.488 · 1d 0.502 — 0.5 ★아래로★ 4~6시그마.
     홀드아웃 기본율 30m 48.2% · 60m 47.3% · 1d 44.6% — 학습 구간과 딴판.
   모델이 배운 건 종목 고르기가 아니라 ★그 시절의 시장 방향★ 이었다. 절대 등락 라벨에는
   아무도 예측 못 하는 공통성분이 통째로 들어 있어, 기본율이 시기마다 흔들리고 검증손실이
   첫 라운드부터 나빠진다(조기종료가 7~8라운드에서 멈췄다).

   그래서 라벨을 ★같은 시각·같은 시장 동료들과 견준 상대★ 로 바꿨다. 되돌아갈 수 있는 길이
   세 군데 있고, 셋 다 ★조용히★ 돌아간다 — 그걸 여기서 막는다.
     ① 횡단면 라벨러가 ★두 데이터셋 경로 모두★ 에 배선돼 있는가
        (스트리밍 경로에만 걸면 자가검사는 통과하고 실데이터만 옛 라벨로 돈다 — 최악의 조합)
     ② 배리어 판정이 ★진단 함수 안에서만★ 불리는가 = 행을 버리는 자리로 안 돌아갔는가
     ③ 업로드 관문이 ★홀드아웃 성적★ 을 직접 보는가 (나무 총수·라운드 수는 대리지표다 —
        전자는 시드 수에 속고, 후자는 ★실력 있는 약한 신호를 거절했다★. 둘 다 버렸다)
   그리고 워커가 확률의 ★뜻★ 을 저장·표시하는지도 본다 — 뜻이 바뀐 채 옛 설명이 남으면
   화면이 거짓말을 한다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const PY = readFileSync(new URL("../trainer/modal/omni.py", import.meta.url), "utf8");
const ST = readFileSync(new URL("../trainer/modal/omni_selftest.py", import.meta.url), "utf8");
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + (bad || ok)); fails++; } };

/* 파이썬 최상위 def 블록을 들여쓰기로 잘라 낸다 — 이름만 보지 않고 ★그 함수 안★ 을 본다. */
function pyfn(text, name) {
  const re = new RegExp("^def " + name + "\\(", "m");
  const m = re.exec(text);
  if (!m) return "";
  const rest = text.slice(m.index);
  const lines = rest.split("\n");
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i];
    if (L.trim() && !/^\s/.test(L)) break;
    out.push(L);
  }
  return out.join("\n");
}

// ① 두 데이터셋 경로 모두가 횡단면 라벨러를 부른다
for (const fn of ["build_dataset", "build_dataset_stream"]) {
  const b = pyfn(PY, fn);
  chk(b && /xsec_label\(/.test(b), fn + " 이 횡단면 라벨러를 부른다",
      fn + " 가 옛 라벨(배리어) 그대로 나간다 — 경로 하나만 고치면 자가검사는 통과하고 실데이터가 틀린다");
}
chk(/^def xsec_label\(/m.test(PY), "xsec_label() 이 존재한다", "★횡단면 라벨러가 사라졌다★");

// ② 배리어 판정은 진단 함수 안에서만 — 행을 버리는 자리로 돌아가지 않았다
const diag = pyfn(PY, "_barrier_diag");
chk(diag.length > 0, "_barrier_diag() 진단 함수가 있다");
const nAll = (PY.match(/\bbarrier_outcome\(/g) || []).length;      // 정의 1 + 호출들
const nDiag = (diag.match(/\bbarrier_outcome\(/g) || []).length;    // 진단 안의 호출
chk(nAll === 2 && nDiag === 1, "barrier_outcome() 이 _barrier_diag() 안에서만 불린다(정의 1 + 호출 1)",
    "배리어 판정이 진단 밖에서도 불린다(전체 " + nAll + " · 진단 " + nDiag + ") — 라벨로 되돌아간 자리다");
const rows = pyfn(PY, "build_rows");
chk(rows && !/\bbarrier_outcome\(/.test(rows), "build_rows() 가 배리어로 직접 라벨을 만들지 않는다",
    "★build_rows 가 다시 배리어로 라벨을 만든다★");
chk(rows && !/stats\["to"\]\[hz\] \+= 1\s*\n\s*continue/.test(rows) && !/if y is None:/.test(rows),
    "build_rows() 가 시간초과·동시타격 행을 버리지 않는다",
    "★시간초과 행을 다시 버린다★ — 미래를 조건으로 건 표본이 된다(실측 1,398,261행)");

// ③ 업로드 관문은 홀드아웃 성적을 ★직접★ 본다(대리지표를 안 쓴다)
chk(/^def holdout_edge\(/m.test(PY), "holdout_edge() 가 있다", "업로드 관문이 사라졌다");
const run = pyfn(PY, "run");
chk(run && /not _edge\["ok"\]/.test(run) && /rep\["ok"\] = False/.test(run),
    "업로드 관문이 ★홀드아웃 실력★ 으로 실제로 거절한다",
    "홀드아웃 성적을 재 놓고 거절에 안 쓴다 — V33.424 의 나무 2그루가 그렇게 올라갔다");
const edge = pyfn(PY, "holdout_edge");
chk(edge && /max\(3\.0 \* se, 0\.005\)/.test(edge),
    "문턱이 ★시그마와 효과크기 둘 다★ 를 본다",
    "시그마만 보면 같은 날 행끼리 상관 때문에 se 가 과소평가돼 잡음이 통과한다");
chk(run && !/MIN_ITERS/.test(run) && !/MIN_TREES/.test(run),
    "대리지표(나무 수·라운드 수)가 관문에서 빠졌다",
    "대리지표가 아직 관문에 남아 있다 — 실력 있는 약한 신호를 또 거절한다");
chk(/holdout_edge\(rep\["heads"\]\)/.test(ST) && /holdout_edge\(rep0\["heads"\]\)/.test(ST),
    "자가검사가 관문을 ★양쪽으로★ 확인한다(신호는 통과 · 잡음은 보류)",
    "관문이 아무것도 안 막아도 자가검사가 모른다");
chk(/기본율이 50%%가 아니다|기본율이 50/.test(ST), "자가검사가 지평별 기본율 50% 를 확인한다",
    "라벨이 조용히 절대 등락으로 돌아가도 자가검사가 모른다");

// ③-2 ★결정시각 격자는 절대 시계에 걸려야 한다.★ '배열 끝에서 N봉마다' 로 돌아가면 종목마다
//   봉 수·구멍·수집 지연이 달라 결정시각이 어긋나고, 횡단면 묶음이 통째로 안 만들어진다
//   (그러면 라벨이 조용히 대부분의 행을 버린다 — 성능이 안 나오는 것과 구별이 안 된다).
chk(rows && !/range\(i0, n, INTRA_STEP\)/.test(rows) && !/range\(j0, n, DAILY_STEP\)/.test(rows),
    "결정시각 격자가 ★배열 끝 기준★ 이 아니다",
    "★격자가 다시 배열 끝에 걸렸다★ — 종목 간 결정시각이 어긋나 횡단면 묶음이 부서진다");
chk(rows && /b5\["t"\]\[i\] % \(INTRA_STEP \* BASE_SEC\)/.test(rows),
    "장중 격자를 절대 시계(t % 30분)로 잡는다", "장중 격자가 절대 시계에 안 걸려 있다");
chk(rows && /\(bd2\["t"\]\[j\] \/\/ 86400\) % DAILY_STEP/.test(rows),
    "장타 격자를 날짜로 잡는다", "장타 격자가 종목마다 홀짝이 갈린다");
chk(/rng\.random\(\) > 0\.015/.test(ST) && /ndays_i=70 - \(k % 4\)/.test(ST),
    "자가검사 합성 시장이 종목마다 다른 봉 수·구멍을 만든다",
    "합성 시장이 전부 같은 격자다 — 격자 버그를 자가검사가 못 본다(이 버그가 실제로 그렇게 숨었다)");
chk(/_avg < 0\.6 \* \(NSYM/.test(ST) && /_rate < 0\.8/.test(ST),
    "자가검사가 평균 묶음 크기와 남은 비율을 둘 다 확인한다",
    "묶음이 잘게 부서져도 자가검사가 모른다");

// ④ 워커·화면이 확률의 뜻을 지어내지 않는다
chk(/const OMNI_VER = 3;/.test(S), "워커 OMNI_VER 가 3(라벨 규약이 바뀐 판)이다",
    "라벨 뜻이 바뀌었는데 판이 그대로다 — 옛 모델이 새 뜻으로 읽힌다");
const pv = /^OMNI_VER = (\d+)/m.exec(PY);
chk(pv && pv[1] === "3", "학습기 OMNI_VER 가 워커와 같다", "학습기와 워커의 판이 갈렸다");
chk(/label:\s*\(typeof body\.label === "string"\)/.test(S), "업로드 메타에 라벨 규약을 저장한다",
    "확률의 뜻이 저장되지 않는다");
chk(/label: \(m && m\.label\) \|\| null/.test(S), "구조관측이 라벨 규약을 내보낸다",
    "화면이 뜻을 읽을 길이 없다");
chk(/LBLTXT/.test(H) && /동료 대비 상대/.test(H), "화면이 라벨 규약을 그대로 적는다",
    "★화면이 아직 '오를 확률' 이라고 말한다★");

console.log(fails ? "\n✗ OMNI 라벨 계약 " + fails + "건 실패" : "\n✓ OMNI 라벨 계약 통과");
process.exit(fails ? 1 : 0);
