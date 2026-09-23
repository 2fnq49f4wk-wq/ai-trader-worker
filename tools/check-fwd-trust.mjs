/* ═══════════════════════════════════════════════════════════════════════════
   [V33.410] ★배포된 모델의 '지금' 신뢰도 — 1단계: 재기만 한다★

   ■ 왜 필요한가
     위원회 지분은 wGbdt = σ(T·(gLB−0.5)) 다. 그 gLB 는 ★학습하던 밤에 얼어붙은★ 숫자고,
     배포된 뒤의 성적을 보는 곳이 ★한 군데도 없었다.★ 그래서 지분도 못 고치고, 다음
     재학습 때 현직을 살릴지도 못 정한다. V33.408 이 그 위험의 실물이다 —
     위원회 0.6677 을 쥔 하한 70.1% 가 실력이 아니라 산수였다.

   ■ 재료는 이미 있었고 ★배선이 거꾸로★ 였다
     icForwardCheck / fwd_ledger(V33.140·149·178)는 날짜별 비중첩 블록을 45일 누적한다.
     그런데 걸려 있던 곳은 지분이 가장 ★작은★ 잠정 위원뿐이고(flow·xalpha·stack·memo·듀얼),
     지분이 가장 ★큰★ GBDT·DNN 은 측정이 아예 없었다.

   ■ ★이 판의 계약 — 어떤 판정도 바꾸지 않는다★
     원장은 아직 한 줄도 없고 FWDLED.minDays 는 3 이다. 오늘 규칙을 만들면 3일치로
     현직을 죽일지 살릴지 정하게 된다 — 측정이 아니라 동전던지기다.
     이 검사는 그 경계를 ★계약으로 못 박는다★: 잰 값이 승격·지분·문턱에 닿으면 실패한다.
     (2단계에서 방향은 한쪽뿐이다 — ★강등과 존속만, 승격은 아니다.★
      안 그러면 "문턱을 낮춰 수를 늘리는" 장치가 된다. B-6 이 금지한 그것이다.)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
/* 주석·문자열을 지우는 도구 — 계약은 ★코드★ 에 대한 것이지 설명글에 대한 것이 아니다. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const noStr = (t) => t.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
const fn = (name) => {                        // 함수 본문만 잘라낸다(중괄호 균형)
  const i = S.indexOf("async function " + name + "(");
  if (i < 0) return "";
  let d = 0, st = S.indexOf("{", i);
  for (let k = st; k < S.length; k++) {
    if (S[k] === "{") d++;
    else if (S[k] === "}") { d--; if (!d) return S.slice(i, k + 1); }
  }
  return S.slice(i);
};
const GB = fn("mlGBDTTrainNightly");   // [V33.422] DNN 퇴역 — 학습기가 코드에서 사라졌다

console.log("① ★측정이 실제로 걸려 있는가★ — 지분이 큰 두 위원에게");
{
  for (const [nm, body, key] of [["GBDT", GB, "gbdt_model"]]) {
    chk(body.length > 1000, nm + " 학습 함수를 찾았다", "★" + nm + " 학습 함수를 못 찾는다 — 이 검사가 무의미해진다★");
    chk(new RegExp('icForwardCheck\\(DB, \\{[\\s\\S]{0,400}?stateKey: "' + key + '"').test(body),
      nm + " 가 전진검증을 ★자기 모델 키로★ 부른다(" + key + ")",
      "★" + nm + " 에 전진검증 배선이 없다 — 지분이 가장 큰 위원이 여전히 측정 밖이다★");
  }
}

console.log("\n② ★배포된 모델을 채점하는가★ — 방금 만든 모델이 아니라");
{
  // 전진검증 호출이 ★적합보다 앞★ 이어야 '지금 배포된 것' 을 잰다. 뒤면 자기가 만든 걸 잰다.
  const gi = GB.indexOf("icForwardCheck(DB, {"), gf = GB.indexOf("const model = _gbdtFit(");
  chk(gi > 0 && gf > gi,
    "GBDT: 전진검증이 ★적합보다 앞★ 에 있다 — 재는 대상이 지금 배포된 모델이다",
    "★GBDT 전진검증이 적합 뒤다 — 방금 만든 모델을 재게 된다(전진검증이 아니다)★");
  /* [V33.422] DNN 퇴역 — 학습기가 코드에서 사라졌다. 이 계약(전진검증이 저장보다 앞 · loadFn 이
     이미 읽어 둔 배포 모델을 넘긴다)은 GBDT 에 그대로 남아 있고 위에서 확인한다. */
  chk(/const prev = \(typeof o\.loadFn === "function"\) \? await o\.loadFn\(\) : await getState\(DB, o\.stateKey, null\);/.test(S),
    "icForwardCheck 가 loadFn 을 쓰고, 없으면 ★종전 getState★ 로 물러선다(회귀 안전)",
    "★loadFn 배선이 없거나 종전 경로를 깨뜨렸다★");
}

console.log("\n③ ★체크포인트를 남기는가★ — 없으면 전진검증은 영원히 null 이다");
{
  chk(/model\.ts = model\.trainedAt; model\.maxId = _ckMaxId; model\.maxTs = _ckMaxTs;/.test(GB),
    "GBDT 가 ts·maxId·maxTs 를 남긴다", "★GBDT 체크포인트가 없다 — 내일도 모레도 null 이다★");
  /* [V33.422] DNN 체크포인트 계약 삭제 — 퇴역. (그 경로 자체가 없어졌다.) */
}

console.log("\n④ ★재기만 하는가★ — 이 값이 어떤 판정에도 닿으면 안 된다(1단계의 계약)");
{
  /* 계약을 ★뺄셈★ 으로 잰다: 허용된 자리를 지우고 나서 fwdTrust 가 한 글자라도 남으면
     그건 아무도 승인하지 않은 읽기다. 문맥 창으로 훑으면 주석·대입 우변까지 걸려
     거짓양성이 나온다(첫 판이 그랬다) — 지우고 남는 것을 보는 편이 정확하다. */
  const allowed = (t, obj) => t
    // ① icForwardCheck 결과를 지역변수에 받는 자리(호출 인자 블록 포함)
    .replace(/_fwdTrust = await icForwardCheck\(DB, \{[\s\S]*?\}\);/g, " ")
    .replace(/let _fwdTrust = null;/g, " ")
    // ② 모델 레코드에 ★기록★ 하는 단 하나의 문장
    .replace(new RegExp(obj + "\\.fwdTrust\\s*=[\\s\\S]*?at: Date\\.now\\(\\) \\};", "g"), " ")
    // ③ 로그 한 줄
    .replace(new RegExp("_fwdTrustNote\\(" + obj + "\\.fwdTrust\\)", "g"), " ");
  for (const [nm, body, obj] of [["GBDT", GB, "model"]]) {
    const left = allowed(noStr(strip(body)), obj);
    const n = (left.match(/fwdTrust/g) || []).length;
    chk(n === 0,
      nm + ": 허용된 세 자리(측정·기록·표기)를 지우면 fwdTrust 가 ★한 글자도 안 남는다★",
      "★" + nm + " 가 승인되지 않은 자리에서 fwdTrust 를 " + n + "번 읽는다 — 1단계의 계약 위반이다: " +
      (left.match(/.{70}fwdTrust.{30}/) || ["?"])[0].replace(/\s+/g, " ") + "★");
  }
  /* 저장소 전체 — 판정을 만드는 식(문턱·지분·승격 플래그)이 이 값을 못 보게 한다.
     주석은 먼저 지운다(주석의 '승격' 이라는 낱말에 걸리면 검사가 잡음이 된다). */
  const SS = noStr(strip(S));
  const leak = [...SS.matchAll(/fwdTrust/g)]
    .map(m => SS.slice(Math.max(0, m.index - 160), m.index + 80).replace(/\s+/g, " "))
    .filter(c => /\btrusted\s*=|trustFloor|\bwGbdt\s*=|\bwDnn\s*=|\bpromote\b|accLB\s*=|dnnLB\s*=/.test(c));
  chk(leak.length === 0, "저장소 전체에서 fwdTrust 가 ★문턱·지분·승격·하한 어디에도 안 닿는다★",
    "★fwdTrust 가 판정 경로에 닿는다: " + leak.slice(0, 1).join("") + "★");
  // 그리고 2단계가 와도 ★올려 쓰는★ 방향은 없어야 한다 — 지금 미리 못 박는다
  chk(!/fwdTrust[\s\S]{0,120}(accLB|dnnLB|wGbdt|wDnn)\s*=\s*[^=]/.test(SS),
    "전진신뢰가 하한·지분을 ★올려 쓰는 식이 없다★(2단계에서도 강등·존속만 허용된다)",
    "★전진신뢰가 하한이나 지분을 올려 쓴다 — 문턱을 낮춰 수를 늘리는 장치가 된다★");
}

console.log("\n⑤ ★못 잰 것을 잰 것처럼 적지 않는가★ (표기 함수를 실제로 돌린다)");
{
  chk(/아직없음/.test(M._fwdTrustNote(null)), "원장이 없으면 ★아직없음★ 이라 적는다 — " + M._fwdTrustNote(null).trim(),
    "★없는 것을 숫자처럼 적는다★");
  const build = M._fwdTrustNote({ ic: null, t: null, n: 120, days: 1, ready: false, why: "날짜 부족" });
  chk(/쌓는중/.test(build) && !/블록IC/.test(build),
    "쌓는 중이면 ★쌓는중★ 이라 적고 IC 를 만들어 내지 않는다 — " + build.trim(),
    "★덜 쌓인 것을 잰 것처럼 적는다★");
  const done = M._fwdTrustNote({ ic: -0.0312, t: -1.4, n: 4200, days: 7, ready: true });
  chk(/블록IC -0\.0312/.test(done) && /t -1\.40/.test(done) && /재기만 함/.test(done),
    "다 재면 값과 함께 ★재기만 함(판정 불변)★ 을 같이 적는다 — " + done.trim(),
    "★값만 적고 '판정에 안 쓴다' 를 안 적는다 — 읽는 사람이 게이트 숫자로 오해한다★");
  chk(M.FWDLED.minDays >= 3, "최소 날짜 " + M.FWDLED.minDays + "일 ≥ 3 그대로(문턱 불변)",
    "★전진 원장 최소 날짜가 낮아졌다★");
  /* ★못 잰 자리의 기본값★ — 여기에 0 을 적으면 "IC 0 · t 0 · 다 잼" 이 되어, 화면도
     다음 작업자도 ★측정된 0★ 으로 읽는다. 없는 것은 null 이어야 하고 ready 는 false 여야 한다. */
  for (const [nm, body] of [["GBDT", GB]]) {
    const m = body.match(/: \{ ic: ([^,]+), t: ([^,]+), n: ([^,]+), days: ([^,]+), ready: ([^,]+),/);
    chk(m && m[1].trim() === "null" && m[2].trim() === "null" && m[5].trim() === "false",
      nm + ": 원장이 없을 때 ★null·ready false★ 로 적는다(0 이 아니다)",
      "★" + nm + " 가 못 잰 것을 " + (m ? "ic " + m[1] + " · t " + m[2] + " · ready " + m[5] : "?") +
      " 로 적는다 — 측정된 값처럼 읽힌다★");
  }
  // 두 로그 모두에 실려야 한다 — 안 실리면 사람이 볼 방법이 없다(측정만 하고 숨기는 꼴)
  chk(/_fwdTrustNote\(model\.fwdTrust\)/.test(GB), "GBDT 완료 로그에 전진신뢰가 실린다",
    "★GBDT 로그에 안 실린다 — 재기만 하고 아무도 못 본다★");
}

console.log(fails === 0 ? "\n✓ 전진신뢰도(1단계·측정전용) 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
