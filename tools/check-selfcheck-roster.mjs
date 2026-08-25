/* ═══════════════════════════════════════════════════════════════════════════
   [V33.257] 위원회를 세는 자가 두 칸짜리였다

   운영 /api/ai/selfcheck 가 이렇게 말하고 있었다:

       "보조 모델 1종 위원회 합류"

   같은 응답의 externalTrain 에는 6종이 전부 trained·ageH 5 로 실려 있고
   XGB 0.5354 · LGB 0.5324 · Cat 0.5409 로 멀쩡했다. 세는 식이 이랬다:

       nTrusted = (DNN 신뢰 ? 1 : 0) + (GBDT 신뢰 ? 1 : 0)

   위원회에는 V32.65 부터 부스터 3종이, V33.251 부터 이중헤드가 들어간다.
   식은 그 전에 쓰였고 그대로 남았다. ★모델이 안 도는 게 아니라 자가 짧았다.★

   이것이 위험한 이유는 틀린 숫자 자체가 아니다 — 그 숫자를 보고
   ★멀쩡한 것을 고치러 들어가게★ 되기 때문이다. 이 저장소가 실제로
   여러 번 그렇게 시간을 썼다.

   그래서 이 검사는 "숫자가 맞나" 를 묻지 않는다(맞는 숫자는 내일 또 틀린다).
   ★보고가 위원회와 같은 함수를 쓰는가★ 를 묻는다. 명단을 손으로 적는 순간
   같은 사고가 다시 난다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

function bodyOf(fname) {
  const i = S.indexOf("\nasync function " + fname + "(");
  if (i < 0) return null;
  const j = S.indexOf("{", i);
  let d = 0, k = j;
  for (; k < S.length; k++) { const c = S[k]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
  return S.slice(j, k + 1);
}
const SC = bodyOf("aiSelfCheck");
if (SC == null) { console.log("  FAIL aiSelfCheck 를 찾지 못했다"); process.exit(1); }
const SCcode = SC.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

console.log("① 명단을 손으로 적지 않는가");
{
  chk(!/nTrusted\s*=\s*\(dnnT[^\n]*\)\s*\+\s*\(gT[^\n]*\)\s*;/.test(SCcode),
    "DNN+GBDT 두 칸짜리 합산식이 사라졌다", "두 칸짜리 합산식이 그대로다 — 부스터·이중헤드가 안 세진다");
  chk(/_boostersCached\(/.test(SCcode),
    "부스터는 위원회가 싣는 그 함수(_boostersCached)로 센다",
    "부스터를 자체 조건으로 센다 — 문턱이 바뀌면 보고와 실물이 갈라진다");
  chk(/dualHeadJudge\(/.test(SCcode),
    "이중헤드는 판정 함수(dualHeadJudge)를 직접 불러 확인한다",
    "이중헤드 조건을 자가진단이 따로 적고 있다");
  chk(/R\.committee\s*=/.test(SCcode) && /members/.test(SCcode),
    "누가 들어왔는지 이름으로 보고한다(숫자만 내지 않는다)", "명단을 이름으로 내지 않는다");
}

console.log("\n② 빠진 위원을 조용히 빠뜨리지 않는가");
{
  // 학습이 안 된 것과 문턱에서 걸린 것은 처방이 다르다 — 그 둘을 구분해 적어야 한다.
  chk(/DNN 미신뢰 accLB/.test(SC), "DNN 이 문턱에서 걸리면 accLB 와 함께 경고한다",
    "DNN 이 가중 0 인데 아무 말도 없다");
  chk(/미합류 accLB/.test(SC) && /for \(const nm of \["xgb", "lgb", "cat"\]\)/.test(SCcode),
    "부스터가 빠지면 어느 것이 몇 %로 걸렸는지 적는다", "빠진 부스터의 사유를 적지 않는다");
}

console.log("\n③ 우리가 흉내 낸 판정이 실제로 판별하는가 — 돌려서 본다");
{
  const D = M.LUXML.featNames.length;
  const FV = M.LUXML.featVer;
  const mk = (o) => Object.assign({
    featVer: FV, trusted: true, baseRate: 0.3,
    w: new Array(D).fill(0), b: 0, mean: new Array(D).fill(0), std: new Array(D).fill(1)
  }, o || {});
  const z = new Array(D).fill(0);

  chk(M.dualHeadJudge(mk(), mk(), z, {}) != null,
    "판·trusted 가 맞으면 이중헤드 쌍이 살아 있다고 판정한다", "정상 쌍인데 null 이 나온다 — 흉내가 틀렸다");
  chk(M.dualHeadJudge(mk({ trusted: false }), mk(), z, {}) == null,
    "한쪽이 미신뢰면 쌍 전체가 죽는다(둘은 쌍으로만 투표한다)", "미신뢰인데 살아 있다고 판정한다");
  chk(M.dualHeadJudge(mk({ featVer: FV - 1 }), mk(), z, {}) == null,
    "판(featVer)이 어긋나면 죽는다", "옛 판 모델이 위원회에 남는다");
  chk(M.dualHeadJudge(null, mk(), z, {}) == null,
    "한쪽이 없으면 죽는다", "짝이 없는데 살아 있다고 판정한다");
}

console.log("\n④ 위원회가 새 식구를 들이면 보고도 따라오는가");
{
  // 위원회 조립부가 부르는 로더 이름을 뽑아, 자가진단이 그것들을 전부 참조하는지 본다.
  // 새 모델군을 붙이고 보고를 잊으면 여기서 걸린다 — V32.65·V33.251 이 그랬다.
  const loaders = ["_boostersCached", "dualHeadJudge"];
  const missing = loaders.filter(n => !new RegExp("\\b" + n + "\\s*\\(").test(SCcode));
  chk(missing.length === 0,
    "위원회 로더 " + loaders.length + "종을 자가진단이 전부 부른다 (" + loaders.join(", ") + ")",
    "자가진단이 안 부르는 로더: " + missing.join(", ") + " → 그 위원들은 보고에서 사라진다");
}

console.log(fails === 0 ? "\n✓ 자가진단 명단 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
