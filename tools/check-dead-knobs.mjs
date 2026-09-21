/* [V33.371] 죽은 설정 손잡이 계약
 *
 *   ★이 저장소가 반복해서 당한 유형이다★ — 설정은 정의돼 있는데 소비처가 없다.
 *     V33.341  liveSrcWeight   워커 다섯 곳이 쓰는데 트레이너로 안 내려가, 위원회엔 한 번도 안 닿았다
 *     V33.260  dropout · l2    학습기가 둘인데 설정 통로가 하나만 넓었다
 *     F-2      mcap_shares     존재한 적 없는 키로 읽어 XR_FLOW 가 V33.250 이래 0건 발동
 *   셋 다 "값을 바꿔도 아무 일이 없는" 상태였고, 셋 다 ★사고가 난 뒤에★ 발견됐다.
 *   손잡이가 죽은 것 자체보다, ★죽은 줄 모르고 돌린 기간★ 이 비싸다.
 *
 *   그래서 래칫을 건다: 지금의 죽은 목록을 ★이유와 함께★ 박아 두고,
 *     · 새로 죽은 손잡이가 생기면 실패한다(그게 이 게이트의 본업이다)
 *     · 목록에 있는 것이 다시 살아나면 실패한다(목록이 낡는 것도 거짓말이다)
 *   목록은 줄어들 수만 있다.
 */
import { readFileSync } from "node:fs";
const S = readFileSync("src/index.js", "utf8");
const EXTRA = readFileSync("public/index.html", "utf8") + readFileSync("trainer/modal/modal_train.py", "utf8");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.log("  ✗ FAIL " + m); } };

/* ★설명용 레지스트리★ — AI_PARAMS 는 스스로 그렇게 선언한다:
   "각 항목은 실제 구현부(참조)와 값이 일치하며, 코드가 직접 읽는 항목은 이 객체가 단일 출처다."
   즉 참조가 없는 것이 정상이고, 위험은 ★값이 구현부와 어긋나는 것★ 이다(다른 게이트의 일). */
const DOC_ONLY = new Set(["AI_PARAMS", "FEAT_ROLES", "SECTOR_NEWS_REP", "ROSTER_STATE_TXT", "EXT_BLOCK_TXT"]);

/* 지금 죽어 있는 것 — ★하나하나 확인하고 이유를 적었다.★ 이유 없이 목록에 넣지 않는다. */
const KNOWN = {
  "DEFAULT_CFG.sizingTargets":            "은퇴 — 한 거래 명목가 상한은 RISKENG(maxNotionalFrac 35% · maxGrossFrac 160% · maxAdvParticipation 5%)이 실제로 강제한다(11049~11071). 설정 화면에도 노출되지 않는다",
  "DEFAULT_CFG.soloSignalWeight":         "은퇴 — 단독신호 차단은 신호 자신의 soloBlock 플래그가 한다(12614)",
  "DEFAULT_CFG.confluenceBonus":          "은퇴 — 합류 보상은 signalTypeWeights/combW 경로로 옮겨졌다",
  "DEFAULT_CFG.allowMixedConfluence":     "은퇴 — 혼합 합류 허용 여부는 신호 선별(SIGPICK)과 combW 로 옮겨졌다",
  "DEFAULT_CFG.mixedConfluencePenalty":   "은퇴 — 혼합 합류 감점도 위와 같은 경로로 옮겨졌다(이 값은 아무 데도 안 곱해진다)",
  "DEFAULT_CFG.roundTripCostPct":         "미배선 — 왕복 거래비용은 feeUS/feeKR/krSellTax 로 개별 반영된다",
  "DEFAULT_CFG.volSpikeMult":             "은퇴 — 거래량 급증은 피처(volSurge)로 흡수됐다",
  "DEFAULT_CFG.cycleLockRefreshAt":       "미배선 — 사이클 락은 cycleLockTTL 만 쓴다",
  "DNN.techPriorW":                       "미배선 — 기술 프라이어는 위원회 밖(신호 가중)에서 반영된다",
  "ANALYSTREV.minOpinions":               "미배선 — 애널리스트 합의는 건수 필터 없이 평균만 쓴다",
  "RISKENG.reduceOnlyOnHalt":             "★한 번도 구현된 적 없다★ — 종목별 거래정지 감지 자체가 없다(KRHALT 는 시장 전체 서킷브레이커다). 이름만 있는 안전장치",
};

// ── 설정 객체와 키를 소스에서 뽑는다 ─────────────────────────────────────────
/* ★주석만 지우고 코드는 남겨야 한다.★ 첫 판은 `//` 를 무조건 주석으로 봐서
   "https://www.reddit.com/..." 안의 `//` 부터 줄 끝까지 지웠고, 그 뒤에 있던
   `SOCIAL.redditSubs` 가 함께 사라져 ★살아 있는 손잡이를 죽었다고★ 보고했다.
   URL 의 `//` 는 앞에 `:` 가 붙는다 — 그것만 비켜 간다. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
const objs = {};
for (const m of S.matchAll(/^const ([A-Z][A-Z0-9_]*) = \{/gm)) {
  let d = 0, i = m.index + m[0].length - 1;
  for (let j = i; j < S.length; j++) {
    if (S[j] === "{") d++;
    else if (S[j] === "}") { d--; if (d === 0) { objs[m[1]] = [i, j]; break; } }
  }
}
ok(Object.keys(objs).length > 50, `설정 객체 ${Object.keys(objs).length}개를 읽었다`);

const dead = [];
for (const [name, [a, b]] of Object.entries(objs)) {
  if (DOC_ONLY.has(name)) continue;
  const body = strip(S.slice(a, b + 1));
  const keys = [...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((x) => x[1]);
  // 객체 ★자신 안에서★ 쓰는 것도 산 것이다(SOCIAL.redditSubs 가 자기 url() 에서 쓰인다)
  const outside = strip(S.slice(0, a) + S.slice(b + 1)) + strip(EXTRA);
  const inside = body;
  for (const k of keys) {
    const re = new RegExp(`\\.${k}\\b|["']${k}["']`);
    const selfRe = new RegExp(`\\.${k}\\b`);
    if (re.test(outside) || selfRe.test(inside)) continue;
    dead.push(`${name}.${k}`);
  }
}

console.log(`\n  — 소비처가 없는 설정 키 ${dead.length}개 —`);
for (const d of dead) console.log(`     ${d}${KNOWN[d] ? "" : "   ★목록에 없음★"}`);

const added = dead.filter((d) => !(d in KNOWN));
const revived = Object.keys(KNOWN).filter((d) => dead.indexOf(d) < 0);
ok(added.length === 0,
   added.length ? `★새로 죽은 손잡이 ${added.length}개★: ${added.join(", ")} — 배선하거나, 이유를 적어 목록에 넣을 것`
                : "새로 죽은 손잡이가 없다");
ok(revived.length === 0,
   revived.length ? `목록에 있는데 다시 살아났다(목록이 낡았다): ${revived.join(", ")} — 목록에서 뺄 것`
                  : `목록의 ${Object.keys(KNOWN).length}개가 여전히 죽어 있다(목록이 사실과 맞다)`);

/* ★이 검사의 한계를 적어 둔다 — 모르는 척하지 않는다.★
   여기서 보는 것은 "그 키를 ★읽는 코드가 있는가★" 뿐이다.
   읽기는 하는데 그 값을 아무 데도 안 쓰는 경우(예: sizingTargetsByStrategy 는
   4679 의 설정 정제부가 읽어 상한을 깎지만, 깎은 값을 소비하는 사이징 코드가 없다)는
   여기서 '살아 있음' 으로 나온다. 그건 코드 흐름 분석이 필요해 이 게이트의 범위 밖이다. */
// 이유 없는 항목을 목록에 넣지 못하게 한다 — 목록이 쓰레기통이 되면 이 게이트가 무의미해진다
{
  const vague = Object.entries(KNOWN).filter(([, why]) => !why || why.length < 12);
  ok(vague.length === 0, `목록의 모든 항목에 이유가 적혀 있다 (${Object.keys(KNOWN).length}개)`);
}

/* ══ [V33.407] ★AI_PARAMS 면제가 너무 넓어 '죽은 스위치' 를 통째로 숨기고 있었다.★ ══════
   AI_PARAMS 는 스스로 "설명용 레지스트리" 라고 선언하고, 숫자 항목이 구현부 상수를 ★비추는★
   것은 실제로 정상이다. 그래서 DOC_ONLY 로 면제했다.
   그런데 ★불리언은 설명이 아니라 스위치다.★ 실제 사고:
     AI_PARAMS.autonomy.emergencyFallback — 주석은 "false 면 미준비 시 신규진입 관망" 이라고
     ★동작을 약속★ 하는데 읽는 코드가 한 줄도 없었다. AI 가 못 설 때 규칙엔진이 ★항상★
     신규매수를 했고, 사용자가 "AI 없는 규칙 버전이 작동해 처참한 성적" 으로 관측했다.
   → 숫자 면제는 그대로 두고, ★불리언만★ 읽히는지 본다. 안 읽히면 이유를 적어야 통과한다.
     (이유 없이 목록에 넣지 않는다 — 위 KNOWN 과 같은 규율) */
const BOOL_KNOWN = {
  /* 여기에 넣으려면 ★왜 안 읽혀도 되는지★ 를 적어야 한다. 하나하나 실물을 확인하고 적었다. */
  "ensembleDynamic": "표기용 — 자기 주석이 그렇게 말한다(\"동적가중은 항상 켜짐(소프트맥스 하드코딩) — 이 플래그로 못 끔\"). 구현이 무조건 켜져 있다",
  "krEnabled":       "표기용 — 한국어 감성은 ★무조건★ 돈다(SENTI_LEX 에 한글 항목이 있고 V12.76 이 조사/어미 접두 매칭을 넣었다). ⚠️ false 로 바꿔도 안 꺼진다 — 끄는 기능이 필요하면 sentimentScore 에 배선해야 한다",
  "gnnEnabled":      "미구현 — 종목간 동조화 GNN 은 이름만 있고 구현부가 없다. 기본 false 라 켜도 아무 일도 안 일어난다(켜는 순간 조용히 무시된다는 뜻이기도 하다)",
};
{
  const m = /const AI_PARAMS = \{/.exec(S);
  ok(!!m, "AI_PARAMS 를 찾았다");
  if (m) {
    let d = 0, i = m.index + m[0].length - 1, b = -1;
    for (let j = i; j < S.length; j++) { if (S[j] === "{") d++; else if (S[j] === "}") { d--; if (!d) { b = j; break; } } }
    const body = strip(S.slice(i, b + 1));
    const outside = strip(S.slice(0, i) + S.slice(b + 1));
    /* 불리언 리프만 뽑는다 — `키: true` / `키: false`. 주석은 이미 걷어냈다. */
    const bools = [];
    const re = /(^|[\{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(true|false)\s*(,|\}|$)/gm;
    let mm;
    while ((mm = re.exec(body)) !== null) if (bools.indexOf(mm[2]) < 0) bools.push(mm[2]);
    ok(bools.length >= 5, `AI_PARAMS 안의 불리언 스위치 ${bools.length}개를 뽑았다`);
    const dead = bools.filter(function (k) {
      if (BOOL_KNOWN[k]) return false;
      // 바깥에서 `.키` 로 읽거나 "키" 로 참조하면 살아 있다
      return !(new RegExp("\\." + k + "\\b|[\"']" + k + "[\"']").test(outside));
    });
    if (dead.length) for (const k of dead) console.log("       AI_PARAMS…" + k);
    ok(dead.length === 0,
      dead.length === 0
        ? "AI_PARAMS 의 불리언 스위치가 전부 ★읽힌다★ — 동작을 약속하고 아무것도 안 하는 스위치가 없다"
        : `★AI_PARAMS 에 읽히지 않는 불리언 스위치 ${dead.length}개 — 동작을 약속하고 아무것도 안 한다★`);
    // 목록이 낡는 것도 거짓말이다 — 이유를 적어 둔 키가 실제로 읽히면 목록에서 빼야 한다
    const stale = Object.keys(BOOL_KNOWN).filter(function (k) {
      return new RegExp("\\." + k + "\\b").test(outside);
    });
    ok(stale.length === 0, stale.length === 0
      ? "예외 목록이 사실과 맞다" : `★예외 목록의 ${stale.join(", ")} 은 이제 읽힌다 — 목록에서 빼야 한다★`);
  }
}

// 자가시험 — 이 검사가 실제로 죽은 키를 찾아내는가(헛돌지 않는가)
{
  const probe = "const _GATE_SELFTEST_OBJ = {\n  aliveKey: 1,\n  deadKey: 2\n};\nconst _x = _GATE_SELFTEST_OBJ.aliveKey;\n";
  const fake = S + probe;
  const m = /const (_GATE_SELFTEST_OBJ) = \{/.exec(fake);
  let d = 0, i = m.index + m[0].length - 1, b = -1;
  for (let j = i; j < fake.length; j++) { if (fake[j] === "{") d++; else if (fake[j] === "}") { d--; if (!d) { b = j; break; } } }
  const body = strip(fake.slice(i, b + 1));
  const outside = strip(fake.slice(0, i) + fake.slice(b + 1));
  const isDead = (k) => !(new RegExp(`\\.${k}\\b|["']${k}["']`).test(outside) || new RegExp(`\\.${k}\\b`).test(body));
  ok(isDead("deadKey") && !isDead("aliveKey"), "자가시험: 죽은 키는 잡고 산 키는 안 잡는다");
}

console.log(fail ? `\n✗ 죽은 손잡이 계약 ${fail}건 실패 (총 ${n})` : `\n✓ 죽은 손잡이 계약 통과 (${n}개 단언)`);
process.exit(fail ? 1 : 0);
