/* ═══════════════════════════════════════════════════════════════════════════
   [V33.407] AI 가 못 설 때 규칙엔진이 매수하면 안 된다 (청산은 그대로)

   ■ 사용자 관측 (2026-09-22)
     "rule 이랑 scalp 이 AI 없는 규칙 버전이 작동해서 처참한 성적 나왔다.
      규칙 모델은 AI 가 작동 못할 때 ★보유 주식이 폭락·폭등했을 때 매도하는 것 외에는★
      작동되지 않게 만들어줘."

   ■ 코드가 약속만 하고 있었다
     AI_PARAMS.autonomy.emergencyFallback 의 주석: "false 면 미준비 시 신규진입 관망".
     그런데 저장소 전체에서 ★이 키를 읽는 코드가 한 줄도 없었다.★ 동작을 약속하는 스위치가
     아무것도 안 하고 있었고, 그래서 AI 가 못 설 때마다 규칙엔진이 ★항상★ 신규매수를 했다.
     (check-dead-knobs 는 AI_PARAMS 를 '설명용 레지스트리' 로 통째 면제해 못 잡았다 —
      그 면제가 너무 넓었다. 같은 판에서 좁힌다.)

   ■ 이 검사가 지키는 경계 — ★진입만 막고 청산은 한 톨도 안 건드린다★
     이 경계를 잘못 넘으면 폭락장에서 ★팔지 못하는★ 시스템이 된다. 그게 최악이다.
     · 세 경로(메인·CM·대체시장)가 ★같은 함수★ 로 판단하는가 (각자 판단하면 갈라진다)
     · 차단이 청산 블록 ★뒤★ 에 오는가
     · scalp 도 같이 막는가 (AI 가동 시 scalp 를 살려 두는 전제는 "위원회가 최종 판단"인데,
       AI 가 못 서면 그 전제가 사라진다)
     · 조용히 막지 않는가 (몇 건 막았는지 로그가 말하는가)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 손잡이가 살아 있는가 (죽은 스위치였다)");
{
  const a = (M.AI_PARAMS && M.AI_PARAMS.autonomy) || {};
  chk(a.emergencyFallback === false,
    "기본값이 ★끔★ 이다 — 사용자 지시대로 AI 미가동 시 규칙 신규매수를 하지 않는다",
    "★기본값이 " + a.emergencyFallback + " 다 — 지시와 다른 쪽이 기본이면 지시를 안 쓴 것이다★");
  const reads = (S.match(/emergencyFallback/g) || []).length;
  chk(reads >= 2, "emergencyFallback 을 ★읽는 코드가 있다★(" + reads + "곳: 선언 + 판정)",
    "★선언만 있고 읽는 곳이 없다 — 동작을 약속하는 죽은 스위치다★");
}

console.log("\n② ★판정이 한 곳에만 사는가★ (세 경로가 각자 판단하면 갈라진다)");
{
  chk(typeof M.ruleEntryAllowed === "function", "ruleEntryAllowed 로 분리돼 있다(게이트가 돌려 볼 수 있다)",
    "★판정이 인라인이다 — 게이트는 '있는가' 만 보게 된다★");
  const uses = (S.match(/ruleEntryAllowed\(/g) || []).length;
  chk(uses >= 4, "정의 1 + 세 경로(메인·CM·대체시장) = " + uses + "곳이 같은 함수를 쓴다",
    "★" + uses + "곳뿐 — 어느 경로가 자기 판단을 하고 있다★");
  chk(/if \(!ruleEntryAllowed\(_aiReadyCM\)\) continue;/.test(S), "CM 경로가 그 함수를 쓴다", "★CM 경로가 종전 판정이다★");
  chk(/if \(!ruleEntryAllowed\(_aiReadyAlt\)\) continue;/.test(S), "대체시장 경로가 그 함수를 쓴다", "★대체시장 경로가 종전 판정이다★");
}

console.log("\n③ ★판정이 실제로 그렇게 도는가 — 실행해서 확인★");
{
  const A = M.AI_PARAMS.autonomy;
  const saved = A.emergencyFallback;
  try {
    A.emergencyFallback = false;
    chk(M.ruleEntryAllowed(false) === false,
      "AI 미가동 + 폴백 끔 → ★규칙 신규매수 금지★", "★AI 가 없는데 규칙이 매수한다(사용자가 막으라고 한 바로 그것)★");
    chk(M.ruleEntryAllowed(true) === false,
      "AI 가동 중 → 규칙 진입 금지(종전 동작 그대로)", "AI 가동 중인데 규칙 진입이 열린다");
    A.emergencyFallback = true;
    chk(M.ruleEntryAllowed(false) === true,
      "AI 미가동 + 폴백 ★명시적으로 켬★ → 허용(손잡이가 실제로 동작한다)",
      "★켜도 안 열린다 — 손잡이가 여전히 죽어 있다★");
    chk(M.ruleEntryAllowed(true) === false,
      "폴백을 켜도 AI 가동 중이면 규칙 진입은 여전히 금지",
      "★폴백 스위치가 AI 가동 중 동작까지 바꾼다 — 범위를 넘었다★");
  } finally { A.emergencyFallback = saved; }
}

console.log("\n④ ★청산은 한 톨도 안 건드렸는가★ — 이 경계를 넘으면 폭락장에 못 판다");
{
  // 메인 경로: 진입 후보를 비우는 곳이 ★청산 블록 뒤★ 에 있어야 한다
  const iExit = S.indexOf("const _mdx = await _phaseRun(\"decide\"");      // 청산 판단(매도 위원회)
  const iBlock = S.indexOf("__ruleEntryBlocked += stratResults.length;");
  chk(iExit > 0 && iBlock > iExit,
    "진입 차단이 ★청산 판단 뒤★ 에 온다 — 매도 경로를 지나친 뒤에만 막는다",
    "★진입 차단이 청산보다 앞에 있다 — 매도 경로를 건드릴 수 있다★");
  // CM·대체시장: continue 가 STEP 1(매도) 뒤에 있어야 한다
  const iCmSell = S.indexOf("=== STEP 2: swing 매수 신호 평가 ===");
  const iCmGate = S.indexOf("if (!ruleEntryAllowed(_aiReadyCM)) continue;");
  chk(iCmSell > 0 && iCmGate > iCmSell,
    "CM: 매수 차단이 ★매도 단계(STEP 1) 뒤★ 다 — 보유분 매도는 그대로 돈다",
    "★CM 매수 차단이 매도보다 앞이다 — 팔아야 할 때 못 판다★");
  // 차단은 ★진입 후보 배열★ 만 비운다 — 포지션·청산 상태를 건드리면 안 된다
  const blk = S.slice(iBlock - 220, iBlock + 220);
  chk(/stratResults = \[\];/.test(blk) && !/positions|sellDecision|heldSymbols\s*=/.test(blk),
    "차단은 진입 후보 배열만 비운다(포지션·매도 판단을 건드리지 않는다)",
    "★차단 블록이 포지션/매도 상태를 만진다★");
}

console.log("\n⑤ scalp 도 같이 막는가");
{
  const iFilter = S.indexOf('stratResults = stratResults.filter(function(sr){ return sr.strategy === "scalp"; });');
  const iBlock = S.indexOf("if (!__aiReady && !ruleEntryAllowed(__aiReady) && stratResults.length) {");
  chk(iFilter > 0 && iBlock > iFilter,
    "AI 미가동 차단이 scalp 보존 필터 ★뒤★ 에 와서 scalp 까지 비운다",
    "★scalp 가 빠져나간다 — 사용자가 지목한 두 경로 중 하나가 그대로 산다★");
  chk(!/stratResults = stratResults\.filter\(function\(sr\)\{ return sr\.strategy === "scalp"; \}\);[\s\S]{0,400}?return;/.test(S),
    "차단이 조기 return 으로 빠져나가지 않는다", "차단 경로가 중간에 끊긴다");
}

console.log("\n⑥ 조용히 막지 않는가");
chk(/__ruleEntryBlocked \+= stratResults\.length;/.test(S), "막은 건수를 센다", "★세지 않는다 — 로그가 영원히 0★");
chk(/AI 미가동으로 규칙 신규진입 " \+ __ruleEntryBlocked \+ "건 차단\(청산은 정상\)/.test(S),
  "사이클 로그가 ★몇 건 막았는지·청산은 정상인지★ 적는다",
  "★로그가 말하지 않는다 — '왜 거래가 없나' 를 다시 코드로 추적하게 된다★");

console.log("\n⑦ ★시장별 진입 깔때기★ — \"한국장 거래가 없다\" 가 한 줄로 답하는가");
{
  for (const k of ["__funCand", "__funTry", "__funBuy"]) {
    const inc = new RegExp(k + "\\+\\+|" + k + " \\+=").test(S);
    if (!inc) { console.log("  FAIL ★" + k + " 를 ★세는 곳이 없다★ — 로그가 영원히 0 을 찍는다"); fails++; }
  }
  console.log("  ok   평가 → 후보 → 신호 → 체결을 전부 ★센다★");
  chk(/깔때기 평가 " \+ evalProcessed \+ " → 후보종목 " \+ __funCand/.test(S),
    "[EVAL] 한 줄에 깔때기가 붙는다 — 시장별로 어디서 끊겼는지 바로 보인다",
    "★깔때기를 안 적는다 — 또 코드로 추적하게 된다★");
  chk(/후보 0 — 상류\(신호·AI픽·커버리지\)에서 끊겼다/.test(S) &&
      /후보는 있는데 체결 0 — 하류\(위원회·사전검사·예산\)에서 끊겼다/.test(S),
    "★상류·하류를 갈라 말한다★ — 처방이 정반대라 이 구분이 핵심이다",
    "어디서 끊겼는지 해석을 안 준다 — 숫자만 있으면 또 추측하게 된다");
  chk(/AI픽풀 " \+ __aiPickPool\.size/.test(S),
    "AI 픽 풀 크기도 같이 적는다(AI 가동 중엔 여기가 상류다)", "AI 픽 풀 크기를 안 적는다");
}

console.log(fails === 0 ? "\n✓ 규칙 진입 차단 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
