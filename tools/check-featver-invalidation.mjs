/* ═══════════════════════════════════════════════════════════════════════════
   [V33.245] ★판이 올랐으면 도장은 무효다★ — featVer 상향이 재학습으로 이어지는가

   사용자 보고: "미학습 상태인거 왜 이렇게 많냐 수정해 뭔가 문제 생긴듯"
   상태덤프(V33.244, 2026-08-24T23:09Z)가 가리킨 것:
     samples.featVer 14 / featCount 69  ← 표본풀은 새 판으로 51.7만건 재구축 완료
     mind 13 · dnn 13 · gbdt 13, featVerOk:false, 전부 trained:false
     committee {mind:false, dnn:false, gbdt:false} → aiReady:false, RULE_FALLBACK

   모델이 없어진 게 아니다. V33.239 가 LUXML.featVer 를 13→14 로 올렸는데(하이킨아시
   4종, 65→69) ★그 판을 아무도 무효화하지 않아서★ 낡은 판의 모델이 그대로 남았고,
   읽는 쪽은 featVer 가 다르니 전부 null 로 돌려보냈다. 잠긴 문이 둘이었다:

     ① 야간 파이프라인 — _stg 는 ai_stage:<단계> 에 오늘 도장이 있으면 그냥 return.
        featVer 를 올린 그날 낮 12:18 에 이미 v13 으로 학습을 끝내 도장이 찍혀 있었다.
        도장을 지우는 장치는 있었다 — _PIPE_VER("배포 시 1회 강제 재실행"). 그런데
        ★손으로 적는 상수★ 라 V33.78 이후 160 빌드 넘게 방치돼 있었다. 손으로 적는
        상수는 결국 안 적힌다.
     ② 외부(Modal) 자동 재학습 — _luxAutoRetrainModal 은 trainedAt ★시각만★ 봤다.
        판을 올린 직후 외부 모델은 죄다 "10.8h 전 학습" 이라 freshestAge ≤ 14h 로
        '정상 — 트리거 불필요' 조기반환에 걸렸다. 위원회에 한 명도 못 들어가는 판인데,
        가장 재학습이 급한 순간에 자동 재학습이 가장 확실히 잠겼다.

   여기서 지키는 것:
     · _PIPE_VER 은 featVer 에서 ★파생★ 된다 — 사람의 기억에 기대지 않는다
     · 외부학습 신선도는 판이 맞는 모델만 센다(표기 없는 낡은 레코드는 '아니다')
     · 외부 trust 레코드는 자기 판을 적는다 — 안 적으면 위 판정이 못 돈다
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 배포 무효화 키가 featVer 에서 파생되는가");
{
  const i = S.indexOf("const _PIPE_VER");
  chk(i >= 0, "_PIPE_VER 선언을 찾았다", "_PIPE_VER 이 사라졌다 — 강제 재실행 장치 자체가 없다");
  const decl = S.slice(i, S.indexOf(";", i) + 1);
  chk(/LUXML\.featVer/.test(decl),
    "_PIPE_VER 이 LUXML.featVer 를 포함한다 — 판을 올리면 자동으로 값이 바뀐다",
    "_PIPE_VER 이 손으로 적는 상수다 — featVer 를 올려도 어제 도장이 살아남아 모델이 낡은 판에 갇힌다");
  chk(/LUXML\.featNames\.length/.test(decl),
    "차원 수도 키에 들어간다 — 판 번호를 안 올리고 피처만 늘려도 잡힌다",
    "차원만 바뀐 변경은 못 잡는다");
  // 판을 올렸을 때 키가 실제로 달라지는가 — 식을 떼어 두 판으로 계산해 본다
  const expr = decl.slice(decl.indexOf("=") + 1).replace(/;\s*$/, "");
  const mk = (fv, fn) => Function("LUXML", "FLOWML", "XALPHA", "STACKML", "MEMOML", "DUALHEAD", "STIN_FEATVER",
    "return (" + expr + ");")({ featVer: fv, featNames: { length: fn } }, { featVer: 3 }, { featVer: 3 },
    { featVer: 5 }, { featVer: 1 }, { featVer: 1 }, 5);
  chk(mk(13, 65) !== mk(14, 69),
    "13/65 → 14/69 에서 키가 실제로 달라진다 (" + mk(13, 65) + " ≠ " + mk(14, 69) + ")",
    "판을 올려도 키가 같다 — 강제 재실행이 안 걸린다");
  chk(mk(14, 69) === mk(14, 69), "같은 판이면 키도 같다 — 매 틱 재실행되지 않는다", "키가 불안정하다 — 파이프라인이 무한 재실행된다");
  // 그 키가 실제로 도장을 지우는 경로에 물려 있는가
  const use = S.slice(i, i + 1600);
  chk(/ai_pipeline_ver/.test(use) && /DELETE FROM state WHERE k >= 'ai_stage:'/.test(use),
    "키가 바뀌면 ai_stage:* 도장을 지운다",
    "키만 저장하고 도장을 안 지운다 — 값이 바뀌어도 파이프라인은 그대로 잠긴 채다");
}

console.log("② 외부학습 신선도가 판을 보는가");
{
  const fn = S.slice(S.indexOf("async function _luxAutoRetrainModal"), S.indexOf("const _TAG_LABEL_KO"));
  chk(fn.length > 200, "_luxAutoRetrainModal 을 찾았다", "함수를 못 찾았다 — 이 검사의 전제가 깨졌다");
  const loop = fn.slice(fn.indexOf('for (const k of ["mind_model"'), fn.indexOf("anyExt && !missingExt && !staleFV &&"));
  chk(/featVer/.test(loop),
    "신선도 집계가 featVer 를 본다",
    "trainedAt 만 본다 — 판을 올린 직후 낡은 모델 전부가 '신선' 으로 잡혀 재학습이 안 걸린다");
  chk(/o\.featVer !== _wantFV|o\.featVer !== LUXML\.featVer/.test(loop),
    "판이 다른 레코드는 신선도에서 제외한다(표기 없으면 '아니다')",
    "!== 비교가 없다 — 표기 없는 프로덕션 레코드가 그대로 통과한다(V33.231 과 같은 함정)");
  chk(!/o\.featVer\s*&&\s*o\.featVer !==/.test(loop),
    "'표기가 있을 때만' 로 약화돼 있지 않다",
    "o.featVer && o.featVer !== … 로 적혀 있다 — 표기 없는 낡은 레코드는 또 빠져나간다");

  // ── 수치 재현: 덤프 그대로(외부 5종, 10.8h 전, featVer 13, 원하는 판 14) ──
  const rec = ["dnn", "gbdt", "xgb", "lgb", "cat"].map(() => ({ source: "external", trainedAt: 0, featVer: 13 }));
  const now = 10.8 * 3600000, want = 14;
  const runOld = () => { let a = false, f = Infinity; for (const o of rec) { a = true; const g = (now - o.trainedAt) / 3600000; if (g < f) f = g; } return a && f <= 14; };
  const runNew = () => { let a = false, f = Infinity; for (const o of rec) { if (o.featVer !== want) continue; a = true; const g = (now - o.trainedAt) / 3600000; if (g < f) f = g; } return a && f <= 14; };
  chk(runOld() === true, "옛 판정 재현: 10.8h ≤ 14h → '정상, 트리거 불필요' (덤프와 일치)", "재현 실패 — 옛 판정이 원래 트리거했다면 원인 진단이 틀렸다");
  chk(runNew() === false, "새 판정: 판이 다르므로 신선한 모델 0 → 재학습 트리거", "새 판정도 조기반환한다 — 고쳐지지 않았다");
  // 판이 맞으면 예전처럼 조용해야 한다(헛트리거 금지)
  const ok = rec.map(o => ({ ...o, featVer: 14 }));
  const runOkNew = () => { let a = false, f = Infinity; for (const o of ok) { if (o.featVer !== want) continue; a = true; const g = (now - o.trainedAt) / 3600000; if (g < f) f = g; } return a && f <= 14; };
  chk(runOkNew() === true, "판이 맞고 신선하면 트리거하지 않는다 — 헛트리거 없음", "판이 맞는데도 매번 트리거한다 — Modal 을 8h 마다 헛돌린다");
}

console.log("③ 외부 trust 레코드가 자기 판을 적는가");
{
  // source:"external" 인 trust 객체는 featVer 를 함께 적어야 ②가 돈다.
  const sites = [...S.matchAll(/let trust = \{[^;]*?source: "external"[^;]*?\};/gs)];
  chk(sites.length >= 3, "외부 trust 생성 지점 " + sites.length + "곳을 찾았다", "외부 trust 생성 지점을 못 찾았다");
  let missing = 0;
  for (const m of sites) if (!/featVer:/.test(m[0])) missing++;
  chk(missing === 0,
    "모든 외부 trust 레코드가 featVer 를 적는다",
    missing + "곳이 featVer 를 안 적는다 — ② 의 판정이 '표기 없음 → 낙오' 로 떨어져 매번 재학습을 부른다");
}

console.log(fails ? "\n✗ featVer 무효화 검사 " + fails + "건 실패" : "\n✓ featVer 무효화 검사 통과");
process.exit(fails ? 1 : 0);
