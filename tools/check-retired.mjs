/* ═══════════════════════════════════════════════════════════════════════════
   [V33.422] ★퇴역 계약★ — 내보낸 위원이 어느 경로로도 되살아나지 않는가 (사용자 지시)

   사용자: "기존 필요없는 모델은 제거해". 넷을 내보냈다(DNN·FLOW·XALPHA·STACK) —
   전부 ★측정에서 잡음과 구별되지 않았고★ 이미 한 표도 못 얻고 있던 모델이다.

   "제거" 가 말뿐이 되는 길은 이 저장소에서 여러 번 났다: 이름은 지웠는데 경로가 남고,
   화면은 지웠는데 학습은 돌고, 코드는 지웠는데 게이트가 그걸 요구한다. 그래서 다섯을 본다.
     ① 명부(buildRoster)에 오르지 않는다 — 사이드바와 구조관측이 같이 사라진다
     ② 위원회에서 ★한 표도 못 얻는다★ — 배열이 완성된 자리에서 한 번 더 거른다
     ③ 학습 단계가 없다 — 야간·수동 파이프라인 어디에도
     ④ 코드가 없다 — 학습기·채점기·표본 적재가 전부 사라졌다
     ⑤ 트레이너가 목록을 손으로 안 적는다 — 워커 설정에서 받는다(두 곳에 살면 갈라진다)
   ①②는 ★실행해서★ 확인한다(글자만 보면 이름만 바꿔도 통과한다).
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import { RETIRED } from "./_retired.mjs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const TN = readFileSync(new URL("../.github/workflows/train-now.yml", import.meta.url), "utf8");
const TNOPT = (/^\s*options: \[(.*)\]\s*$/m.exec(TN) || [, ""])[1];
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + (bad || ok)); fails++; } };
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
function block(text, head) {
  const i = text.indexOf(head); if (i < 0) return "";
  let d = 0;
  for (let j = text.indexOf("{", i); j < text.length; j++) {
    if (text[j] === "{") d++; else if (text[j] === "}") { d--; if (d === 0) return text.slice(i, j + 1); }
  }
  return "";
}

console.log(`\n■ 퇴역 명부: ${RETIRED.join(" · ")}`);
chk(RETIRED.length > 0, "퇴역 명부를 읽었다", "RETIRED 를 못 읽었다 — 이 검사가 헛돈다");
chk(typeof M._retired === "function" && RETIRED.every((k) => M._retired(k)) && !M._retired("gbdt"),
  "_retired() 가 명부대로 답한다(퇴역은 true · 현역 GBDT 는 false)", "_retired 가 명부와 어긋난다");
for (const k of RETIRED)
  chk(typeof M._retiredWhy(k) === "string" && M._retiredWhy(k).length > 8,
    `${k}: 왜 내보냈는지 ★사유가 적혀 있다★ — "${M._retiredWhy(k).slice(0, 34)}…"`,
    `${k}: 사유가 없다 — 다음 사람이 "왜 지웠지" 를 물을 수 없다`);

console.log("\n■ ① 명부에 오르지 않는다 (사이드바·구조관측이 같이 사라진다)");
{
  const add = block(strip(S), "const add = function (key, name, role, o) {");
  chk(/if \(_retired\(key\)\) return null;/.test(add),
    "buildRoster 의 ★add 한 곳★ 에서 막는다 — 위원마다 따로 지울 자리가 없다",
    "★퇴역 판정이 add 안에 없다 — 어느 위원이 빠져나갈 수 있다★");
  const ros = block(strip(S), "async function buildRoster(DB) {");
  for (const k of RETIRED)
    chk(!new RegExp(`add\\("${k}"`).test(ros), `${k} 를 명부에 추가하는 줄이 없다`,
      `★${k} 를 아직 명부에 추가한다★`);
}

console.log("\n■ ② 위원회에서 한 표도 못 얻는다 (★실행으로★ 확인)");
{
  const dec = strip(block(S, "async function mlDeepDecide(DB, featVec, opts) {"));
  const iFilter = dec.indexOf("if (_retired(experts[_i].name))");
  const iLen = dec.indexOf("if (!experts.length) return null;");
  chk(iFilter > 0 && iLen > iFilter,
    "배열이 완성된 자리에서 ★한 번 더★ 거른다 — 새 경로가 생겨도 여기를 지난다",
    "★마지막 관문이 없다 — push 자리를 하나만 빼먹으면 퇴역 위원이 투표한다★");
  for (const k of RETIRED)
    chk(!new RegExp(`experts\\.push\\(\\{ name: "${k}"`).test(dec), `${k} 를 위원으로 넣는 줄이 없다`,
      `★${k} 를 아직 위원 배열에 넣는다★`);
  /* 관문을 ★돌려 본다★ — 글자만 보면 조건을 뒤집어도 통과한다(돌연변이가 그 틈으로 샌다). */
  const iFor = dec.lastIndexOf("for (", iFilter);
  let d = 0, end = iFor;
  for (let j = dec.indexOf("{", iFor); j < dec.length; j++) {
    if (dec[j] === "{") d++; else if (dec[j] === "}") { d--; if (d === 0) { end = j + 1; break; } }
  }
  const src = dec.slice(iFor, end);
  const experts = [{ name: "gbdt" }, ...RETIRED.map((k) => ({ name: k })), { name: "rule" }];
  const skipped = [];
  const fn = new Function("experts", "_retired", "_retiredWhy", "_skip",
    src + "\nreturn experts.map(function(e){ return e.name; });");
  const left = fn(experts, M._retired, M._retiredWhy, (n, w) => skipped.push(n));
  chk(left.join(",") === "gbdt,rule" && skipped.sort().join(",") === RETIRED.slice().sort().join(","),
    `관문을 실제로 돌렸다 — 남은 위원 [${left.join(", ")}] · 걸러진 위원 [${skipped.sort().join(", ")}]`,
    `★관문이 실제로는 안 거른다 — 남은 위원 [${left.join(", ")}]★`);
  chk(skipped.length === RETIRED.length,
    "걸러낸 위원마다 ★사유를 남긴다★(_skip) — 조용히 사라지지 않는다",
    "★사유 없이 사라진다 — 화면이 '왜 없나' 를 못 말한다★");
}

console.log("\n■ ③ 학습 단계가 없다 (야간·수동 파이프라인)");
{
  const T = strip(S);
  for (const [stage, owner] of Object.entries(
    Object.fromEntries((S.match(/const RETIRED_STAGES = \{[\s\S]*?\};/) || [""])[0]
      .matchAll(/([a-z]+): "([a-z]+)"/g) ? [...(S.match(/const RETIRED_STAGES = \{[\s\S]*?\};/) || [""])[0]
        .matchAll(/([a-z]+): "([a-z]+)"/g)].map((m) => [m[1], m[2]]) : []))) {
    chk(!new RegExp(`_stg\\("${stage}"`).test(T) && !new RegExp(`\\["${stage}", function`).test(T),
      `단계 "${stage}"(${owner}) 가 어느 파이프라인에도 없다`,
      `★단계 "${stage}" 가 아직 돈다 — ${owner} 는 퇴역했는데 학습 비용을 계속 쓴다★`);
  }
}

console.log("\n■ ④ 코드가 없다 (학습기·채점기·표본)");
{
  const GONE = ["mlDNNTrainNightly", "_dnnTrainOne", "mlDNNVizData", "mlDNNLoad", "mlDNNScore",
                "flowTrainNightly", "xalphaTrainNightly", "stackTrainNightly",
                "stackSampleBackfill", "stackLogSample", "flowLogSample", "xalphaLogSample",
                "altSampleBackfill"];
  const dead = GONE.filter((f) => new RegExp(`function ${f}\\s*\\(`).test(S));
  chk(dead.length === 0, `퇴역 모델의 함수 ${GONE.length}종이 전부 삭제됐다(껍데기도 안 남았다)`,
    `★아직 남아 있다: ${dead.join(", ")} — 안 부르는 코드는 다음 사람에게 '쓰는 코드' 로 보인다★`);
  for (const p of ["/api/dnn-import", "/api/dnn-arch", "/api/stack-oof-window", "/api/ai/resample"])
    chk(!S.includes(`path === "${p}"`), `엔드포인트 ${p} 가 없다`,
      `★${p} 가 아직 살아 있다 — 외부가 계속 올리고 비용만 쓴다★`);
}

console.log("\n■ ⑤ 목록이 ★한 곳★ 에만 산다");
{
  chk(/retired: Object\.keys\(RETIRED\)/.test(S),
    "워커가 트레이너에 퇴역 명부를 내려보낸다(_mlExportConfig)",
    "★트레이너가 퇴역을 모른다 — 퇴역한 모델을 계속 학습한다★");
  chk(/_RETIRED = set\(\(cfg or \{\}\)\.get\("retired"\) or \[\]\)/.test(PY),
    "트레이너가 그 값을 받아 쓴다(자기 목록을 따로 안 적는다)",
    "★트레이너에 목록이 따로 적혀 있다 — 두 곳이 언젠가 갈라진다★");
  chk(/if "dnn" in _RETIRED:/.test(PY) && /return _run_stages\(/.test(PY),
    "퇴역이면 DNN 학습을 건너뛰고 뒤 단계는 그대로 돈다",
    "★퇴역인데도 DNN 을 학습한다 — 회차 예산의 절반을 계속 쓴다★");
  for (const k of RETIRED) {
    chk(!new RegExp(`data-model="${k}"`).test(H), `화면 탭에 ${k} 가 없다`,
      `★${k} 탭이 남아 있다 — 눌러도 410 만 나온다★`);
    chk(!new RegExp(`\\['${k}',`).test(H), `사이드바 목록에 ${k} 가 없다`,
      `★사이드바에 ${k} 가 남아 있다★`);
    /* [V33.426] ★손으로 돌리는 목록도 명부다.★ 퇴역 이름이 여기 남아 있으면 골라도
       "모르는 단계" 로 끝난다 — 실제로 xalpha·flow·stack·stackbf 가 넉 달 남아 있었다. */
    chk(!new RegExp(`[\\[, ]${k}(bf)?[,\\]]`).test(TNOPT), `수동 실행 목록에 ${k} 가 없다`,
      `★수동 실행 목록에 ${k} 가 남아 있다 — 골라도 아무 일도 안 일어난다★`);
  }
  /* 그 목록의 이름은 ★워커의 _PIPE 에서 나온 것★ 이어야 한다(손으로 적으면 갈라진다). */
  {
    const i = S.indexOf("const _PIPE = ["), j = S.indexOf("\n      ];", i);
    const pipe = [...S.slice(i, j).matchAll(/\["([a-z0-9_]+)",/g)].map(function (m) { return m[1]; });
    const opts = TNOPT.split(",").map(function (z) { return z.trim(); }).filter(Boolean);
    const orphan = opts.filter(function (o) { return o !== "all" && pipe.indexOf(o) < 0; });
    chk(pipe.length > 0 && orphan.length === 0,
      `수동 실행 목록 ${opts.length}개가 전부 _PIPE 에 있다`,
      `★_PIPE 에 없는 단계를 고를 수 있다: ${orphan.join(", ")}★`);
  }
}

console.log(fails ? `\n✗ 퇴역 계약 ${fails}건 실패` : "\n✓ 퇴역 계약 통과 — 내보낸 위원이 되살아날 자리가 없다");
process.exit(fails ? 1 : 0);
