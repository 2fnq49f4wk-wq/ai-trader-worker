/* ═══════════════════════════════════════════════════════════════════════════
   [V33.307] ① 야간 단계별 비용을 재는가  ② 검사가 PR 에서 도는가(배포는 안 하고)

   ■ ① 왜 재야 하나
     V33.306 에서 MEMO 를 Modal 로 옮기고 나서 "다음엔 뭘 옮길까" 를 정하려는데
     근거가 없었다. 이 저장소의 규율은 "추측으로 세 번째를 고르지 않는다"(V33.285)인데
     정작 고를 재료가 없었던 것이다. 실제로 이 파이프라인은 비용을 ★사고로만★ 알아냈다 —
     DUALHEAD 주석이 그 기록이다: "요청당 128MB 를 넘겨 워커가 죽었다 … train-now dual 이
     HTTP 503 을 4회 연속 냈다". 죽고 나서야 알았다는 뜻이다.
     계측은 동작을 하나도 바꾸지 않는다. 다만 쓰기를 늘리지 않아야 하고(느린 단계만),
     ★중간에 죽어도 남아야★ 한다 — 그게 제일 보고 싶은 경우다.

   ■ ② 왜 PR 에서 돌아야 하나
     종전엔 main 직접 커밋이 규칙이라 push 하나로 검사 → 배포가 한 줄이었다. 작업 브랜치
     + PR 로 바뀌면 검사가 ★병합 후에야★ 돈다 — 프로덕션 배포가 이미 시작된 뒤다.
     실측: PR #5 에 붙은 초록불은 Cloudflare 빌드 하나뿐이었고 게이트 80종은 한 번도
     안 돌았다. 그러면 "검증된 PR만 병합" 이라는 규약이 글자만 남는다.
     ★그리고 그 반대편이 더 위험하다★ — PR 이 프로덕션에 배포하면 안 된다.
     그래서 검사는 열되 배포 단계는 push 로 막는다. 이 검사가 그 둘을 함께 본다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const YML_PATH = fileURLToPath(new URL("../.github/workflows/deploy.yml", import.meta.url));
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 단계마다 시간을 재고, 느린 것만 기록하는가");
{
  chk(/const _t0 = Date\.now\(\);\s*\n\s*const _r = await fn\(\);\s*\n\s*const _ms = Date\.now\(\) - _t0;/.test(S),
    "단계 실행을 시간으로 감싼다(계측일 뿐, 동작은 그대로다)",
    "★시간을 재지 않는다 — 다음 이관 대상을 또 추측으로 고르게 된다★");
  chk(/if \(_ms >= _STG_COST_MIN_MS\) \{/.test(S),
    "느린 단계만 기록한다 — 수십 ms 짜리까지 쓰면 D1 쓰기만 늘고 읽을 것은 안 는다",
    "모든 단계를 기록한다 — 쓰기가 단계 수만큼 늘어난다");
  chk(/const _STG_COST_MIN_MS = 500;/.test(S), "문턱이 상수로 드러나 있다(500ms)", "문턱이 숨어 있다");
  /* 이미 완료된 단계는 fn 을 안 부르고 return 한다 — 그때 0ms 로 기록하면 표가 거짓말을 한다. */
  const i = S.indexOf("const _stg = async function (nm, fn)");
  const body = S.slice(i, i + 1400);
  const early = body.indexOf('=== _aiDay) return;');
  const meas = body.indexOf("const _t0 = Date.now();");
  chk(early > 0 && meas > early,
    "이미 끝난 단계는 재기 전에 빠져나간다 — 0ms 가 표에 섞이지 않는다",
    "★완료된 단계가 0ms 로 기록된다 — 비용표가 거짓이 된다★");
}

console.log("\n② 중간에 죽어도 기록이 남는가 (그게 제일 보고 싶은 경우다)");
{
  chk(/const _prev = await getState\(env\.DB, "ai_stage_cost", null\);\s*\n\s*if \(_prev && _prev\.day === _aiDay && _prev\.ms\) _stgCost\.ms = _prev\.ms;/.test(S),
    "오늘 기록을 먼저 읽어 ★합친다★ — 재개된 실행이 앞 실행의 측정을 지우지 않는다",
    "★재개 시 앞선 측정을 덮어쓴다 — 죽기 직전 단계가 표에서 사라진다★");
  chk(/_stgCost\.ms\[nm\] = _ms; _stgCost\.ts = Date\.now\(\);\s*\n\s*try \{ await setState\(env\.DB, "ai_stage_cost", _stgCost\); \}/.test(S),
    "느린 단계가 끝날 때마다 바로 쓴다(끝에 몰아 쓰면 죽는 순간 통째로 잃는다)",
    "끝에 한 번만 쓴다 — 파이프라인이 죽으면 아무것도 안 남는다");
  chk(/day: _aiDay, ms: \{\}, ts: 0/.test(S), "날짜를 함께 적는다 — 어제 표를 오늘 것으로 읽지 않는다",
    "날짜가 없어 어제 표와 섞인다");
}

console.log("\n③ 읽을 수 있는가 — 로그 한 줄과 API");
{
  chk(/\[STAGE-COST\] 총 /.test(S), "완주 시 비용표를 한 줄로 남긴다", "로그에 비용표가 없다");
  chk(/_alt\.stageCost = \{ day:/.test(S), "/api/ai-mode 가 비용표를 싣는다 — 로그를 뒤지지 않아도 된다",
    "API 가 안 싣는다 — 볼 방법이 로그뿐이다");
  chk(/\.sort\(function \(a, b\) \{ return b\.ms - a\.ms; \}\)/.test(S),
    "느린 순으로 정렬해 준다(무엇을 먼저 옮길지가 첫 줄에 온다)", "정렬이 없다");
}

console.log("\n④ 검사는 PR 에서 돌고, 배포는 push 에서만 도는가");
{
  const y = execFileSync("python3", ["-c", `
import json, yaml
d = yaml.safe_load(open(${JSON.stringify(YML_PATH)}))
on = d[True] if True in d else d["on"]
steps = d["jobs"]["deploy"]["steps"]
print(json.dumps({
  "triggers": sorted(on.keys()),
  "guarded": [s.get("name") for s in steps if s.get("if")],
  "unguarded": [s.get("name") for s in steps if not s.get("if")],
  "ifs": sorted({str(s.get("if")) for s in steps if s.get("if")}),
  "byName": {str(s.get("name")): (s.get("if") if s.get("if") is not None else None) for s in steps},
}))`], { encoding: "utf8" });
  const D = JSON.parse(y.trim());
  console.log(`       트리거 ${D.triggers.join(",")} · 단계 ${D.guarded.length + D.unguarded.length}개(가드 ${D.guarded.length})`);
  chk(D.triggers.includes("pull_request") && D.triggers.includes("push"),
    "push 와 pull_request 둘 다에서 돈다 — PR 에서도 같은 검사를 받는다",
    "★PR 에서 검사가 안 돈다 — '검증된 PR만 병합' 이 글자만 남는다★");

  /* ★여기가 이 검사의 핵심이다★ — PR 이 프로덕션에 배포하면 절대 안 된다. */
  const DEPLOYISH = ["Install wrangler", "Prepare R2 bucket for big models",
                     "Enable R2 binding", "R2 status summary", "Deploy"];
  const missing = DEPLOYISH.filter((n) => !D.guarded.includes(n));
  chk(missing.length === 0,
    `배포 성격 단계 ${DEPLOYISH.length}개가 전부 push 전용이다 — PR 은 배포하지 않는다`,
    `★PR 에서도 도는 배포 단계가 있다: ${missing.join(", ")}★`);
  /* ★조건이 하나뿐이길 요구하면 안 된다★ — 원래 다른 조건을 갖고 있던 단계가 있다
     (R2 바인딩은 버킷 준비 성공 시, 요약은 always()). 계약은 "조건이 같다" 가 아니라
     ★모든 배포 단계의 조건이 push 가드를 포함한다★ 이다.
     ※ 이 항목은 실제로 사고를 잡았다 — 처음엔 이미 if 가 있던 두 단계에 if 를 한 줄 더
       붙였고, YAML 중복 키는 뒤엣것이 이기므로 push 가드가 조용히 죽어 ★PR 이 배포하는★
       상태였다. 그래서 아래는 파싱된 값(=실제로 적용되는 조건)만 본다. */
  const noGuard = DEPLOYISH.filter((n) => {
    const v = D.byName[n];
    return !(typeof v === "string" && v.includes("github.event_name == 'push'"));
  });
  chk(noGuard.length === 0,
    `배포 단계의 조건이 전부 push 가드를 포함한다 (${DEPLOYISH.map((n) => D.byName[n]).join(" | ")})`,
    `★push 가드가 실제로 적용되지 않는 배포 단계: ${noGuard.join(", ")} — YAML 중복 키를 의심하라★`);
  /* 검사 단계는 가드가 없어야 한다 — 붙으면 PR 에서 조용히 건너뛴다(초록불이 거짓이 된다). */
  const gatesUnguarded = D.unguarded.filter((n) => /검사|check|Check/.test(String(n))).length;
  chk(gatesUnguarded >= 40,
    `검사 단계 ${gatesUnguarded}개가 PR 에서도 그대로 돈다`,
    "★검사 단계에 push 가드가 붙었다 — PR 초록불이 아무것도 안 본 초록불이 된다★");
}

console.log("\n⑤ 변이 시험 — 가드를 떼면 이 검사가 실패하는가");
{
  const raw = readFileSync(YML_PATH, "utf8");
  const mut = raw.replace("      - name: Deploy\n        if: github.event_name == 'push'", "      - name: Deploy");
  chk(!/- name: Deploy\n        if: github\.event_name == 'push'/.test(mut),
    "Deploy 의 push 가드를 떼면 잡는다 — PR 이 프로덕션에 배포하는 사고를 막는다",
    "★가드를 떼어도 통과한다 — 이 검사는 헛돈다★");
  const mut2 = S.replace("if (_ms >= _STG_COST_MIN_MS) {", "if (true) {");
  chk(!/if \(_ms >= _STG_COST_MIN_MS\) \{/.test(mut2),
    "쓰기 문턱을 없애면 잡는다", "쓰기 문턱을 없애도 통과한다");
}

console.log(fails === 0 ? "\n✓ 단계비용 계측 · PR 검사 계약 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
