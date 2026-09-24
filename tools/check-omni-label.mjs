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

/* JS 함수 하나를 중괄호 균형으로 잘라 낸다 — 이름만 보면 다른 곳의 같은 글자에 속는다. */
function jsfn(text, head) {
  const i = text.indexOf(head);
  if (i < 0) return "";
  let d = 0;
  for (let j = text.indexOf("{", i); j >= 0 && j < text.length; j++) {
    if (text[j] === "{") d++;
    else if (text[j] === "}") { d--; if (d === 0) return text.slice(i, j + 1); }
  }
  return "";
}

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

// ③-3 ★실험 칸은 운영에 안 섞인다.★ 장중 횡단면(k_*)은 워커에 없는 칸이라, 그 회차 모델을
//   올리면 학습과 추론이 다른 칸을 본다 — 이 저장소가 반복해 당한 사고 그대로다.
//   그래서 ① 스위치가 꺼져 있으면 칸이 안 붙고 ② 켜진 회차는 업로드를 거부해야 한다.
chk(/^KSEC = os\.environ\.get\("OMNI_KSEC"\) == "1"$/m.test(PY),
    "장중 횡단면은 ★환경변수 스위치★ 로만 켜진다", "실험 칸이 기본으로 켜져 있다");
chk(/^if KSEC:\n    FEATS = FEATS \+ KSEC_FEATS$/m.test(PY),
    "스위치가 꺼지면 FEATS 가 안 늘어난다", "꺼진 상태에서도 칸이 붙는다 — 워커와 갈린다");
chk(run && /if KSEC:/.test(run) && /rep\["ok"\] = False/.test(run),
    "실험 회차는 ★업로드를 거부★ 한다",
    "★실험 모델이 운영으로 올라간다★ — 워커에 없는 칸을 보고 학습한 모델이다");

// ⑤ [V33.426] ★서빙 계약 — 여기까지 와야 "개발 끝" 이다.★
//   ㉠ 저장 경로가 판을 품는가 — 판 1(절대 라벨)·2·3(횡단면 라벨)이 같은 자리에 덮이면
//      model.prev 를 되살리는 순간 확률의 ★뜻★ 이 뒤섞인다(실제로 지금 prev 에 판 2가 있었다).
//   ㉡ 패널을 워커가 ★다시 만들지 않는가★ — 만들면 그 순간 가진 종목 집합이 학습 때와 달라
//      랭크가 갈린다(V33.423 이 장중 랭크를 포기한 바로 그 이유). 트레이너가 만든 걸 그대로 쓴다.
//   ㉢ 장타 머리(5·20일)를 ★장중 행으로 채점하지 않는가★ — 학습기는 장타 행의 장중 칸을 NaN 으로
//      두고 배웠다. 장중 값이 찬 행을 먹이면 그 머리가 한 번도 본 적 없는 모양이다.
//   ㉣ 사후채점이 학습기와 ★같은 라벨 규약★ 을 쓰는가(동료 중앙값 · 동점 버림 · 최소 동료 수).
chk(/r2Key: "omni\/v" \+ OMNI_VER \+ "\/model\.json"/.test(S),
    "모델 저장 경로가 ★OMNI_VER 에서 나온다★",
    "경로에 판이 손으로 박혀 있다 — 판을 올려도 자리가 안 갈라져 옛 판 위에 덮인다");
chk(!/"omni\/v1\//.test(S), "판 1 경로가 손으로 남아 있지 않다", "omni/v1/ 이 아직 코드에 박혀 있다");
const shadow = jsfn(S, "async function omniShadowScore");
chk(shadow.length > 0, "omniShadowScore() 가 있다", "★워커가 OMNI 로 아무것도 채점하지 않는다★");
chk(shadow && /R2\.get\(OMNI_MODEL\.r2Panel\)/.test(shadow) && !/omniBuildPanel\(/.test(shadow),
    "섀도우 채점이 ★트레이너가 준 패널★ 을 읽는다(직접 안 만든다)",
    "워커가 패널을 스스로 만든다 — 종목 집합이 학습 때와 달라 랭크가 갈린다");
/* [V33.426b] ★시간 예산★ — 종목 수로 자르면 워커가 죽는다(실측: 30종목에 3분 · 두 번 타임아웃).
   5분봉 파일 크기가 종목마다 들쭉날쭉해서 개수로는 못 맞춘다. */
chk(shadow && /Date\.now\(\) - nowMs > budgetMs/.test(shadow) && /ranOut = true; break;/.test(shadow),
    "섀도우 채점이 ★시간 예산★ 으로 끊는다(커서를 남기고 다음 회차가 잇는다)",
    "★종목 수로만 끊는다 — 5분봉이 큰 종목을 만나면 워커 호출이 통째로 타임아웃 난다★");
chk(/omniShadowScore\(DB, \{ perRun: 30, budgetMs: 45000 \}\)/.test(S) &&
    /omniShadowScore\(env\.DB, \{ perRun: 30, budgetMs: 45000 \}\)/.test(S),
    "예산을 ★크론·수동 둘 다★ 에 준다", "한쪽에만 줬다 — 다른 쪽이 또 죽는다");
chk(shadow && /일봉부족/.test(shadow), "장타 머리를 못 채점한 종목 수를 적는다", "못 채점한 걸 숨긴다");
chk(shadow && /if \(ageD > OMNI_MODEL\.panelMaxDays\)/.test(shadow),
    "패널이 낡으면 ★채점을 멈춘다★", "낡은 랭크로 낸 확률을 그대로 적는다 — 학습 때의 그 확률이 아니다");
chk(shadow && /for \(let hzi = 0; hzi < 3; hzi\+\+\)/.test(shadow) && /for \(let hzi = 3; hzi < OMNI_HORIZONS\.length; hzi\+\+\)/.test(shadow),
    "장중 머리(0~2)와 장타 머리(3~4)를 ★다른 행★ 으로 채점한다",
    "★장타 머리를 장중 행으로 채점한다★ — 학습기가 NaN 으로 둔 칸이 차 있다");
chk(shadow && /omniFeatures\(null, bd, null, mkt, true, j\)/.test(shadow),
    "장타 행은 dailyRow=true 로 만든다(장중 칸 NaN)", "장타 행이 장중 칸을 품는다");
chk(shadow && /b5\.t\[i\] \+ OMNI_CONSTS\.base/.test(shadow),
    "결정시각이 학습기와 같다(봉이 닫힌 시각)", "결정시각 규약이 학습기와 다르다");
const grid = jsfn(S, "function _omGridIndex");
chk(grid && /t\.length - 2/.test(grid) && /% \(OMNI_CONSTS\.base \* 6\)/.test(grid),
    "격자는 30분 절대 시계 · 마지막 봉은 버린다(진행 중일 수 있다)",
    "격자·진행중봉 규약이 학습기와 다르다");
const resolve = jsfn(S, "async function omniShadowResolve");
chk(resolve.length > 0, "omniShadowResolve() 가 있다", "적어만 두고 ★맞춰 보지 않는다★");
chk(resolve && /_omMed\(/.test(resolve) && /xsecMin/.test(resolve),
    "사후채점이 ★동료 중앙값★ 과 ★최소 동료 수★ 를 쓴다(학습기와 같은 규약)",
    "사후채점 라벨이 학습기와 다르다 — 다른 자로 잰 성적이다");
chk(resolve && /중앙값과 같다/.test(resolve) && /tie\+\+/.test(resolve),
    "중앙값과 같은 행은 버린다(학습기와 같다)", "동점을 한쪽으로 몰아 넣는다");
chk(/fwdAcc:/.test(S) && /fwdByHz:/.test(S) && /전진\(실시간\) 정확도/.test(H),
    "전진 성적이 ★화면까지★ 온다", "재 놓고 아무도 안 본다");

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
