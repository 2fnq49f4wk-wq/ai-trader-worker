/* ═══════════════════════════════════════════════════════════════════════════
   [V33.405] |pnl| 크기 가중 — 실험대가 "실력의 절반을 먹는다" 고 쟀다

   ■ 측정 (2026-09-21 회차 라벨실험대 · 같은 표본·같은 분할·같은 학습기 LightGBM 200R)
       A  운영(sign) · 가중 = 고유도만          → 초과 ★+2.26%p★ · IC 0.0663
       A′ +운영전처리(표준화·±6σ)               → 초과  +2.40%p  · IC 0.0712
       A″ +운영가중(|pnl|·출처·최근성·고유도)   → 초과 ★+1.21%p★ · IC 0.0482
       A‴ +둘 다                                → 초과  +1.56%p  · IC 0.0593
       (운영 DNN 앙상블은 같은 회차에서 ★−0.71%p★)
     ★전처리는 무죄다★ — 오히려 +0.14%p 좋다. 깎아먹는 것은 ★가중★ 이다.

   ■ 그 가중 안에서 무엇이 범인인가 — 같은 로그가 나머지를 스스로 지운다
       [최근성] 학습표본의 ★100.0%★ 가 바닥에 붙어 있다        → recency 는 상수
       출처 가중: 수확 1,085,539 · ★실거래 68건★              → where(...) 도 사실상 상수
     ★상수 배수는 가중적합을 바꿀 수 없다★ — 그러므로 −1.05%p 는 |pnl| 크기 가중이다.
     추론이 아니라 산수다. 그래도 다음 회차가 'A⁗ +크기가중만' 으로 ★측정★ 해 확인한다.

   ■ 왜 해로운가
     이 모델의 일은 ★부호 분류★ 인데 크기 가중은 "많이 움직인 표본" 에 발언권을 몰아준다.
     크게 움직인 구간 = 변동성이 큰 구간 = ★가장 예측하기 어려운★ 구간이다.
     즉 가장 안 맞는 표본에 가장 큰 가중을 주고 있었다.

   ■ 조용히 망가지는 길 (이 검사가 무는 것)
     ① 손잡이가 죽는다 — `|| ` 로 내려보내면 false 가 기본값으로 덮인다(V33.396 AL-1).
     ② 트레이너가 `상수 or cfg` 로 단락시켜 설정을 안 읽는다(같은 사고).
     ③ 끈다고 해 놓고 실제로는 가중이 안 바뀐다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 워커가 유일한 출처이고 손잡이가 살아 있는가");
chk(M.LUXML.pnlWeight === false,
  "기본값이 ★끔★ 이다(LUXML.pnlWeight = false) — 실험대가 잰 방향",
  "★기본값이 " + M.LUXML.pnlWeight + " 다 — 측정과 다른 쪽이 기본이면 측정을 안 쓴 것이다★");
chk(/pnlWeight: LUXML\.pnlWeight === true,/.test(S),
  "불리언을 ★그대로★ 내려보낸다(=== true)",
  "★`||` 로 내려보낸다 — false 가 기본값으로 덮여 손잡이가 죽는다(AL-1 과 같은 함정)★");
chk(!/pnlWeight: LUXML\.pnlWeight \|\|/.test(S),
  "`LUXML.pnlWeight ||` 모양이 없다", "★|| 단락이 남아 있다★");

console.log("\n② 트레이너가 ★설정을 먼저★ 읽는가 (상수 단락 금지)");
chk(/_pw_cfg = \(cfg or \{\}\)\.get\("pnlWeight", None\)/.test(PY),
  "cfg.pnlWeight 를 직접 읽는다", "★설정을 안 읽는다 — 손잡이가 죽은 knob 이 된다★");
chk(/_pw_on = bool\(_pw_cfg\) if _pw_cfg is not None else False/.test(PY),
  "설정이 오면 그것을 쓰고, 안 오면 기본 끔 — 상수가 설정을 덮지 않는다",
  "★상수가 먼저라 설정이 버려진다(V33.396 AL-1 재발)★");
chk(!/(True|False|_PNL[A-Z_]*)\s+or\s+\(?cfg/.test(PY),
  "`상수 or cfg.get(...)` 단락 모양이 없다", "★단락 모양이 있다 — 오른쪽이 평가조차 안 된다★");
/* f-string 안에서는 "출처 " 와 "워커 설정(...)" 이 `{'` 으로 갈라져 있다 —
   붙어 있을 거라 가정한 첫 정규식이 멀쩡한 코드를 실패로 읽었다. 두 조각을 따로 본다. */
chk(/\[크기가중\]/.test(PY), "로그에 [크기가중] 줄이 있다", "★[크기가중] 줄이 없다★");
chk(/'워커 설정\(cfg\.pnlWeight\)'/.test(PY) && /'기본값\(설정 미수신\)'/.test(PY),
  "어느 값을 ★어디서★ 가져왔는지 로그가 말한다(설정 수신 / 미수신을 구분한다)",
  "★출처를 말하지 않는다 — 다음 회차에 무엇으로 돌았는지 못 되짚는다★");
chk(/켬.*끔|'켬' if _pw_on else/.test(PY), "켜짐/꺼짐을 로그가 적는다", "★상태를 안 적는다★");

console.log("\n③ ★끄면 실제로 가중이 바뀌는가 — 식을 떼어 실행한다★");
{
  const i = PY.indexOf("    if _pw_on:");
  const j = PY.indexOf("    mw = _wmag *", i);
  chk(i > 0 && j > i, "가중 분기를 떼어냈다", "분기를 못 찾는다 — 검사가 헛돈다");
  if (i > 0 && j > i) {
    // 분기가 정말 두 갈래인지 · 끔이 상수 1 인지
    const br = PY.slice(i, j);
    chk(/_wmag = np\.clip\(absp \/ pnl_scale, 0\.3, 3\.0\)/.test(br),
      "켜면 종전 그대로 clip(|pnl|/중앙값, 0.3, 3.0)", "★켠 쪽이 종전과 다르다 — 되돌릴 수 없다★");
    chk(/_wmag = np\.ones\(N, dtype=np\.float64\)/.test(br),
      "끄면 ★상수 1★ — 크기 가중이 사라진다", "★끈 쪽이 1 이 아니다 — 끄는 게 아니다★");
    chk(/mw = _wmag \* np\.where\(HV > 0, hv_w, live_w\) \* recency \* UNIQ/.test(PY),
      "나머지 인자(출처·최근성·고유도)는 ★건드리지 않았다★ — 한 번에 하나만 바꾼다",
      "★다른 인자까지 같이 바꿨다 — 무엇이 효과인지 다시 모르게 된다★");
  }
  // 실제 수치로 확인: 크기 가중은 분포를 얼마나 비트는가
  const pnl = [0.1, 0.3, 1.0, 2.5, 8.0, 20.0];
  const med = 1.75;                                   // 중앙값
  const on = pnl.map((v) => Math.min(3.0, Math.max(0.3, v / med)));
  const spread = Math.max(...on) / Math.min(...on);
  chk(spread >= 5,
    "크기 가중은 표본 간 발언권을 최대 " + spread.toFixed(1) + "배까지 벌린다(0.3~3.0 클립) — 작은 차이가 아니다",
    "크기 가중의 영향이 미미하다 — 이 고침의 근거가 약하다");
}

console.log("\n④ 다음 회차가 이 판단을 ★측정★ 으로 확인하는가");
chk(/A⁗ \+크기가중만/.test(PY), "실험대에 |pnl| 만 격리한 팔이 있다",
  "★격리 팔이 없다 — '나머지는 상수다' 를 영원히 산수로만 주장하게 된다★");
chk(/_PNLW = UWs \* np\.clip\(_ap \/ \(_sc if _sc > 1e-6 else 1\.0\), 0\.3, 3\.0\)/.test(PY),
  "그 팔이 ★고유도 × |pnl|★ 만 쓴다(출처·최근성 없음) — A 와의 차이가 곧 크기 가중의 값어치다",
  "★격리 팔이 다른 인자를 섞는다 — 격리가 아니다★");
{
  const iA = PY.indexOf('"A 운영(sign)"'), iW = PY.indexOf('A⁗ +크기가중만');
  chk(iA > 0 && iW > iA, "A(고유도만) 와 A⁗(고유도×|pnl|) 가 같은 표에 나란히 선다",
    "두 팔이 같은 표에 없다 — 비교가 안 된다");
}

console.log(fails === 0 ? "\n✓ 크기가중 손잡이 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
