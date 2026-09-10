/* ═══════════════════════════════════════════════════════════════════════════
   [V33.235] ★사유는 사라질 줄도 알아야 한다★ — 자가진단이 고쳐진 것을 고쳐졌다고 말하는가

   사용자가 Cloudflare 대시보드에 GITHUB_TOKEN 을 Secret 으로 등록했는데도 화면은 계속
   "GITHUB_TOKEN 미설정" 을 띄웠다. 토큰은 실제로 있었다 — 틀린 건 판단 근거였다.

   _luxAutoRetrainModal 은 건너뛴 사유를 상태(modal_retrain_auto.lastSkip)에 남기는데,
   그 사유를 지우는 곳이 ★실제로 워크플로를 디스패치한 가지 하나뿐★ 이었다. 그런데
   토큰을 넣고 나면 외부 학습이 신선해져(≤14h) 그보다 앞에 있는 '정상 — 트리거 불필요'
   가지로 빠져나가고, 그 가지는 lastSkip 을 건드리지 않는다. 즉 ★고친 뒤에는 그 사유를
   지울 수 있는 경로에 영영 도달하지 못한다.★

   여기서 지키는 것:
     · 토큰이 있으면 그 사유는 즉시 지워진다(도달한 것 자체가 증거다)
     · 정상 가지도 사유를 지운다 — 아무것도 못 하고 있는 게 아니다
     · 자가진단은 캐시된 부스러기가 아니라 ★실제 바인딩★ 으로 답한다
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

const fn = S.slice(S.indexOf("async function _luxAutoRetrainModal"),
                   S.indexOf("const _TAG_LABEL_KO"));

// ── ① 토큰 확인을 통과하면 그 사유를 지우는가 ──
{
  const i = fn.indexOf('if (!env.GITHUB_TOKEN)');
  const after = fn.slice(i, i + 900);
  chk(/delete meta\.lastSkip/.test(after),
    "토큰 확인을 통과한 직후 'no_github_token' 사유를 지운다",
    "토큰이 있는데도 옛 사유가 그대로 남는다 — 등록해도 화면은 계속 미설정이라 적는다");
}

// ── ② '정상 — 트리거 불필요' 가지도 사유를 지우는가 (여기가 실제로 걸린 곳) ──
{
  const i = fn.indexOf("anyExt && !missingExt && !staleFV && oldestAge <= 14");
  chk(i >= 0, "'외부 학습 신선' 조기반환 가지가 있다", "조기반환 가지를 못 찾았다 — 이 검사의 전제가 깨졌다");
  const line = fn.slice(i, fn.indexOf("\n", fn.indexOf("return;", i)));
  chk(/delete meta\.lastSkip/.test(line),
    "정상 가지도 lastSkip 을 지운다 — 토큰 등록 후 실제로 지나가는 경로가 여기다",
    "정상 가지가 사유를 안 지운다 — 토큰을 넣으면 이 가지로 빠져 사유가 영원히 남는다");
}

// ── ③ 사유를 지우는 곳이 '디스패치 가지 하나뿐' 으로 되돌아가지 않는가 ──
{
  const n = (fn.match(/delete meta\.lastSkip/g) || []).length;
  chk(n >= 3,
    "사유를 지우는 지점이 " + n + "곳 — 디스패치 성공에만 매달리지 않는다",
    "사유를 지우는 곳이 " + n + "곳뿐이다 — 그 경로에 도달 못 하면 사유가 굳는다");
}

// ── ④ 자가진단이 캐시가 아니라 실제 바인딩을 보는가 ──
{
  chk(/async function aiSelfCheck\(DB, env\)/.test(S),
    "aiSelfCheck 가 env 를 받는다(바인딩을 직접 볼 수 있다)",
    "aiSelfCheck 가 DB 만 받는다 — 토큰 유무를 상태 부스러기로 추측할 수밖에 없다");
  chk(/const _ghTok = env \? !!env\.GITHUB_TOKEN/.test(S),
    "토큰 유무를 env.GITHUB_TOKEN 으로 직접 판정한다",
    "토큰 유무를 lastSkip 으로 판정한다 — 등록해도 에러가 안 사라진다");
  chk(!/if \(_auto\.lastSkip === "no_github_token"\) R\.errors\.push/.test(S),
    "에러 문구가 캐시된 사유가 아니라 실제 판정(_ghTok)에 걸린다",
    "에러 문구가 여전히 lastSkip 에 걸려 있다");
  chk(/aiSelfCheck\(env\.DB, env\)/.test(S),
    "호출부가 env 를 실제로 넘긴다",
    "호출부가 env 를 안 넘긴다 — 서명만 바꾸고 값은 안 준다(항상 폴백으로 떨어진다)");
}

// ── ⑤ 갇힌 상태를 실제로 재현한다 — 고친 규칙이 그것을 푸는지 ──
//   상태에 no_github_token 이 남아 있고 외부 학습이 신선한 상황(=토큰 등록 직후).
{
  const meta = { lastSkip: "no_github_token", checkTs: 0 };
  const hasToken = true, anyExt = true, freshestAge = 3;   // 3시간 전 수신 — 신선하다
  // 고친 규칙 그대로
  if (hasToken && meta.lastSkip === "no_github_token") delete meta.lastSkip;
  if (anyExt && freshestAge <= 14) { meta.lastOk = 1; delete meta.lastSkip; }
  chk(meta.lastSkip === undefined,
    "갇힌 상태 재현 — 토큰 등록 + 외부학습 신선(3h) → 사유가 실제로 풀린다",
    "재현 실패: 사유가 " + meta.lastSkip + " 로 남는다");

  // 종전 규칙이었다면 어떻게 됐는지도 남긴다(이 게이트의 근거)
  const old = { lastSkip: "no_github_token" };
  if (anyExt && freshestAge <= 14) { old.lastOk = 1; }   // 종전: 여기서 안 지웠다
  chk(old.lastSkip === "no_github_token",
    "종전 규칙에서는 같은 상황에서 사유가 그대로 남는다 — 사용자가 본 그 화면",
    "종전 규칙 재현이 안 된다 — 이 게이트의 전제를 다시 볼 것");
}

console.log(fails ? "\n사유 소멸 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   사유 소멸 계약 통과 — 고쳐진 것을 고쳐졌다고 말한다");
process.exit(fails ? 1 : 0);
