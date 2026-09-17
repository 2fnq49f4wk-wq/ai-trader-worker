/* [V33.379] ★배포가 학습에 막혀 조용히 사라지지 않는가.★
 *
 *   ★왜★ 실측(2026-09-17). 04:30 에 시작된 학습(50분)이 `modal-training` 동시성 그룹을
 *   잡고 있는 동안 들어온 실행이 ★전부★ cancelled 됐다:
 *       35183524091 (a865c81 · V33.377 푸시)   → cancelled
 *       35183933828 (수동 target=memo)          → cancelled
 *       35184243721 (a865c81)                   → cancelled
 *       35184328375 (9425dce · V33.378 푸시)   → cancelled
 *   GitHub 는 `cancel-in-progress: false` 에서도 ★대기열을 하나만★ 유지한다 —
 *   뒤에 들어온 실행이 앞의 대기분을 밀어낸다.
 *
 *   결과: ★V33.377·V33.378 의 트레이너 고침이 Modal 에 한 번도 올라가지 않았다.★
 *   그 안에 MEMO 업로드 import 고침과 단타 `_vai` 고침이 들어 있다 —
 *   즉 "고쳤다" 고 커밋해 놓고 운영은 옛 코드로 돌고 있었다. O-1 과 같은 병이다.
 *   게다가 실행은 'cancelled' 로만 남아 ★실패로 안 보인다★(누가 취소한 것처럼 읽힌다).
 *
 *   불변식: ★`modal deploy` 를 하는 작업은 학습 직렬화 그룹에 들어가면 안 된다.★
 *   배포는 20초짜리 멱등 연산이고 학습을 기다릴 이유가 없다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const WF = ".github/workflows/";
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.error("  ✗ FAIL " + m); } };

/* YAML 을 정규식으로 읽지 않는다 — 들여쓰기 한 칸에 뜻이 바뀌는 형식이다.
   파이썬 yaml 로 파싱해 ★구조★ 를 본다. */
const out = JSON.parse(execFileSync("python3", ["-c", `
import yaml, json, os, sys
res = {}
for f in sorted(os.listdir(".github/workflows")):
    if not f.endswith(".yml"): continue
    d = yaml.safe_load(open(".github/workflows/" + f, encoding="utf-8"))
    jobs = {}
    for name, j in (d.get("jobs") or {}).items():
        txt = yaml.safe_dump(j, allow_unicode=True)
        jobs[name] = {
            "concurrency": j.get("concurrency"),
            "deploys": "modal deploy" in txt,
            "trains": ("modal run" in txt) or (".spawn()" in txt),
            "timeout": j.get("timeout-minutes"),
            "needs": j.get("needs"),
        }
    res[f] = {"concurrency": d.get("concurrency"), "jobs": jobs}
print(json.dumps(res, ensure_ascii=False))
`], { encoding: "utf8" }).trim());

console.log("");
for (const [f, w] of Object.entries(out)) {
  for (const [jn, j] of Object.entries(w.jobs)) {
    if (!j.deploys && !j.trains) continue;
    const grp = (j.concurrency && j.concurrency.group) || (w.concurrency && w.concurrency.group) || "—";
    console.log(`     ${f.padEnd(22)} ${jn.padEnd(14)} 배포:${j.deploys ? "O" : "-"} 학습:${j.trains ? "O" : "-"}  그룹:${grp}`);
  }
}
console.log("");

// ── ① 배포하는 작업이 학습 직렬화 그룹에 묶여 있지 않은가 ────────────────────
{
  const bad = [];
  for (const [f, w] of Object.entries(out)) {
    for (const [jn, j] of Object.entries(w.jobs)) {
      if (!j.deploys) continue;
      const grp = (j.concurrency && j.concurrency.group) || (w.concurrency && w.concurrency.group) || null;
      // 학습도 같이 하는 작업이면 어쩔 수 없다(워치독) — 배포 ★전용★ 작업이 묶인 것이 문제다.
      if (grp === "modal-training" && !j.trains) bad.push(`${f}:${jn}`);
    }
  }
  ok(bad.length === 0,
     bad.length ? `★배포 전용 작업이 학습 그룹에 묶여 있다★: ${bad.join(", ")} — 학습 중 푸시가 조용히 취소된다`
                : "배포 전용 작업이 학습 직렬화 그룹에 들어가 있지 않다 — 학습 중에도 항상 배포된다");
}

// ── ② modal-deploy 가 실제로 두 작업으로 갈려 있는가 ─────────────────────────
{
  const w = out["modal-deploy.yml"];
  ok(!!w, "modal-deploy.yml 을 읽었다");
  if (w) {
    const jn = Object.keys(w.jobs);
    ok(jn.length >= 2, `배포와 학습이 ★다른 작업★ 으로 갈려 있다 (${jn.join(", ")})`);
    const dep = Object.entries(w.jobs).find(([, j]) => j.deploys && !j.trains);
    const trn = Object.entries(w.jobs).find(([, j]) => j.trains);
    ok(!!dep, "배포만 하는 작업이 있다");
    ok(!!trn, "학습을 하는 작업이 있다");
    ok(dep && !(dep[1].concurrency), "배포 작업에 동시성 그룹이 없다");
    ok(trn && trn[1].concurrency && trn[1].concurrency.group === "modal-training",
       "학습 작업에는 직렬화 그룹이 그대로 있다 — ★직렬화를 잃어버리지 않았다★");
    ok(!w.concurrency, "워크플로 전체에 걸린 그룹은 없다(있으면 위 분리가 무의미하다)");
    ok(trn && Array.isArray(trn[1].needs) ? trn[1].needs.includes(dep[0]) : trn[1].needs === dep[0],
       "학습은 배포가 끝난 뒤에 돈다(옛 코드로 학습하지 않는다)");
    ok(dep && dep[1].timeout && dep[1].timeout <= 20,
       `배포 작업 상한이 ${dep[1].timeout}분 이하다 — 배포는 20초짜리다(학습 상한을 물려받지 않는다)`);
    ok(trn && trn[1].timeout && trn[1].timeout >= 60, `학습 작업 상한은 ${trn[1].timeout}분으로 넉넉하다`);
  }
}

// ── ③ 학습을 직렬화하는 두 워크플로가 ★같은 그룹★ 을 쓰는가 ─────────────────
{
  const groups = new Set();
  for (const [, w] of Object.entries(out)) {
    for (const [, j] of Object.entries(w.jobs)) {
      if (!j.trains) continue;
      const g = (j.concurrency && j.concurrency.group) || (w.concurrency && w.concurrency.group);
      if (g) groups.add(g);
    }
  }
  ok(groups.size === 1 && groups.has("modal-training"),
     `학습하는 작업 전부가 ★같은 그룹★ 을 쓴다 (${[...groups].join(", ") || "없음"}) — 갈리면 두 학습이 겹친다`);
}

if (fail) { console.error(`\n✗ 배포 차단 계약 ${fail}건 실패 (총 ${n})`); process.exit(1); }
console.log(`\n✓ 배포 차단 계약 통과 (${n}개 단언) — ★고친 코드가 학습에 막혀 사라지지 않는다★`);
