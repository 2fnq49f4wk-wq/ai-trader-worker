/* ═══════════════════════════════════════════════════════════════════════════
   [V33.262] DNN 만 깨진 자로 심사받고 있었다 — 그리고 층수는 화면이 잘못 셌다

   ■ 사용자 관찰: "dnn 은닉층 왜 4개로 줄었냐"
     설정은 V33.193 이후 한 번도 안 바뀌었다(은닉 10층). 화면이 dims.length 를 그대로
     "층" 이라고 불렀을 뿐이다. dims 는 [입력, 은닉…, 출력] 이라
        은닉 10층(GPU)  → dims 12개 → "12층"
        은닉  2층(폴백) → dims  4개 → ★"4층"★
     즉 그 "4" 는 층이 줄어서가 아니라 ★지금 실려 있는 게 워커 폴백★ 이라는 뜻이었다.
     숫자 하나가 두 가지를 동시에 감췄다 — 세는 법이 틀렸다는 것과, GPU 망이 없다는 것.

   ■ 그리고 진짜 문제: 승격 자가 DNN 에만 다르다
     V33.214 에서 "0.5 문턱 정확도" 는 모델을 가르는 자로 깨졌다고 판정했고,
     부스터(XGB·LGB·Cat)에는 두 갈래 길을 뒀다 — 정확도 길, 그리고 ★IC 길★.
     그런데 DNN 승격은 정확도 길 하나만 봤다. 부스터였으면 통과했을 모델이
     DNN 이라는 이유로 탈락한다. 운영이 정확히 그 상태였다(accLB 0.4727, wDnn 0,
     그러면서 6시간마다 GPU 는 계속 탄다).

   이 검사는 "문턱을 낮췄나" 를 묻는다. 낮추면 안 된다 — 같은 자를 대는 것이지
   무르게 하는 게 아니다. IC 길은 정확도 바닥을 여전히 요구하고 유의성이 하나 더 붙는다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const pyCode = PY.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");

console.log("① 은닉층은 그대로인가 (설정은 건드리지 않았다)");
{
  chk(M.DNN.hidden.length === 10, "DNN.hidden 은 은닉 10층 그대로 (" + M.DNN.hidden.length + "층)",
    "은닉층이 " + M.DNN.hidden.length + "층이다 — V33.193 사용자 지시값(10층)이 아니다");
  chk(M.DNNW.hidden.length === 2, "워커 폴백은 2층(별개 구조 — GPU 망과 혼동하면 안 된다)",
    "워커 폴백 구조가 바뀌었다: " + M.DNNW.hidden.length + "층");
  // ★라벨이 은닉층 수를 말하는가★ — dims.length 를 그대로 부르면 12층/4층으로 나온다
  chk(/dims\.length \+ "층 딥넷"/.test(code) === false,
    "화면 라벨이 dims.length 를 그대로 '층' 이라 부르지 않는다",
    "라벨이 여전히 dims.length — 은닉 10층이 '12층', 폴백 2층이 '4층' 으로 나온다");
  chk(/_hidN = Math\.max\(0, \(Array\.isArray\(dims\) \? dims\.length : 0\) - 2\)/.test(code),
    "은닉층 수 = dims.length − 2 (입력·출력 제외)", "은닉층 수를 입출력 제외로 세지 않는다");
  chk(/워커 폴백★ — GPU 망 미탑재/.test(S) && /fallback: _isFallback/.test(code),
    "폴백이 실려 있으면 화면이 그렇게 말한다(숫자로 눈치채게 하지 않는다)",
    "폴백 여부를 화면에 안 알린다 — 층수 숫자로만 눈치채야 한다");
}

console.log("\n② 승격 판정이 한 곳에만 있는가");
{
  const n = (code.match(/_dnnAdmit\(/g) || []).length;
  chk(n >= 3, "판정 함수를 두 업로드 경로가 모두 부른다(정의 1 + 호출 " + (n - 1) + ")",
    "_dnnAdmit 호출이 " + (n - 1) + "곳 — 경로가 따로 판정하면 언젠가 갈라진다");
  chk(!/if \(valAccLB >= DNN\.trustFloor\) \{/.test(code) && !/if \(dnnLB >= DNN\.trustFloor\) \{/.test(code),
    "옛 인라인 판정이 두 경로 모두에서 사라졌다", "인라인 판정이 남아 있다 — 규칙이 두 곳이다");
}

console.log("\n③ IC 길이 정확도 길보다 무르지 않은가 — 돌려서 본다");
{
  const A = M._dnnAdmit, mind = 0.52;
  const FLOOR = 0.505, ICFLOOR = 0.49, TMIN = 1.65;

  chk(A(FLOOR + 0.001, null, mind).trusted === true,
    "정확도 길: accLB ≥ " + FLOOR + " 이면 IC 없이도 승격", "정확도 길이 막혔다");
  chk(A(FLOOR - 0.001, null, mind).trusted === false,
    "정확도 길: 문턱 미만 + IC 미보고 → 거절", "IC 없이 문턱 아래인데 승격된다");

  // ★핵심★ IC 길은 정확도 바닥을 여전히 요구한다 — IC 가 아무리 높아도 바닥 아래는 거절
  chk(A(ICFLOOR - 0.001, 99, mind).trusted === false,
    "IC 길: 정확도 바닥(" + ICFLOOR + ") 미만이면 IC t 99 여도 거절 — 문턱을 낮춘 게 아니다",
    "★IC 만 높으면 정확도 바닥을 무시하고 통과한다 — 이건 자를 무르게 한 것이다★");
  chk(A(ICFLOOR + 0.005, TMIN - 0.05, mind).trusted === false,
    "IC 길: 유의성 미달(t < " + TMIN + ")이면 거절", "IC 유의성 없이 통과한다");
  chk(A(ICFLOOR + 0.005, TMIN + 0.15, mind).trusted === true,
    "IC 길: 바닥 통과 + 유의성 통과 → 승격", "두 조건을 다 넘겼는데 거절된다");

  // 지분은 다르다 — 근거의 종류가 다르면 발언권도 달라야 한다
  const ic = A(ICFLOOR + 0.005, TMIN + 0.15, mind);
  const ac = A(FLOOR + 0.001, null, mind);
  chk(ic.path === "ic" && ac.path === "acc", "어느 길로 들어왔는지 기록한다", "승격 경로를 기록하지 않는다");
  chk(ic.wDnn < ac.wDnn * 0.6,
    "IC 길로 들어온 모델은 잠정 지분만 받는다 (ic " + ic.wDnn + " vs acc " + ac.wDnn + ")",
    "IC 길과 정확도 길이 같은 지분을 받는다 — 근거가 다른데 발언권이 같다");

  // 운영 현재값은 IC 를 붙여도 통과하지 않아야 한다(0.4727 < 0.49)
  chk(A(0.4727, 3.10, mind).trusted === false,
    "운영 현재값 0.4727 은 IC t 3.10 을 붙여도 거절 — 이 변경은 현 모델을 밀어넣지 않는다",
    "★현재 실패 중인 모델이 이 변경으로 통과해버린다 — 고친 게 아니라 열어준 것이다★");
  chk(/정확도 바닥 .* 미달\(IC 값과 무관\)/.test(A(0.4727, 3.10, mind).why),
    "거절 사유가 ★실제로 막은 조건★ 을 지목한다(IC 를 탓하지 않는다)",
    "거절 사유가 엉뚱한 조건을 지목한다 — 그러면 엉뚱한 곳을 고치러 간다: " + A(0.4727, 3.10, mind).why);
}

console.log("\n④ 트레이너가 IC 를 실제로 재서 올리는가");
{
  /* [V33.291] 인자에 mkt 가 붙었다(시장 고정효과 제거). 계약은 "fit_arch 가 블록 IC 를 낸다"
     이므로 인자 목록까지 못 박지 않는다 — 못 박으면 고칠 때마다 계약이 아니라 숫자가 깨진다. */
  chk(/_icf = _ic_block_fields\(_p_ic, _y_ic/.test(pyCode),
    "fit_arch 가 블록 IC 를 낸다(이미 있던 도구 — DNN 만 안 쓰고 있었다)", "DNN 이 블록 IC 를 계산하지 않는다");
  chk(/_p_ic, _y_ic = p_t, ys_t/.test(pyCode) && /_p_ic, _y_ic = ps, ys/.test(pyCode),
    "IC 를 ★정확도를 잰 그 구간★ 으로 잰다(두 분기 모두)",
    "IC 평가 구간이 정확도와 다르다 — τ* 선택에 쓴 구간에서 재면 낙관적으로 나온다");
  /* [V33.292] 목록이 늘었다(accBase 등). 계약은 "IC 필드를 업로드 메타에 싣는다" 이므로
     목록 전체를 못 박지 않는다 — 못 박으면 필드를 더할 때마다 계약이 아니라 숫자가 깨진다. */
  chk(/for _k in \("valICBlock", "valICIR", "valICt", "valICK"/.test(pyCode),
    "업로드 메타에 IC 필드를 싣는다", "IC 를 계산만 하고 안 올린다 — 워커는 못 본다");
  // 커밋 단계에는 성적이 없다(V33.170 의 그 스코프 사고) → 스테이징에 담겨야 한다
  chk(/valICt: _num\(body\.valICt, null\), valICBlock:/.test(code),
    "begin 단계가 IC 를 스테이징에 담는다(커밋 body 에는 가중치만 온다)",
    "IC 가 스테이징에 안 담긴다 — 커밋 때 undefined 가 되어 IC 길이 영원히 안 열린다");
  chk(/const _icT = _num\(_vs\.valICt, null\)/.test(code),
    "커밋이 스테이징에서 IC 를 읽는다", "커밋이 body 에서 IC 를 읽으려 한다 — 거기엔 없다");
}

console.log(fails === 0 ? "\n✓ DNN 승격 판정 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
