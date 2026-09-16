/* [V33.369] 수동 배포 경로 계약
 *
 *   ★왜 필요한가★ 2026-09-15~16 러너 시간 고갈로 배포가 4판 연속 막혔다
 *   (runner_id 0 · steps 없음 = 러너가 배정된 적이 없다). 고친 코드가 운영에 못 갔다.
 *   그래서 CI 없이도 배포할 수 있는 길을 만들었다.
 *
 *   ★그 길이 CI 와 어긋나면 더 나쁘다.★ wrangler.toml 의 R2 바인딩은 저장소에 주석
 *   처리돼 있고 CI 가 배포 직전에 푼다. 수동 경로가 그걸 빠뜨리면 R2 없이 배포되고,
 *   V33.110 이후 R2 가 없으면 장중 표본 수집이 ★멈춘다★ — 조용히 우회하지 않는다.
 *   여기서 두 경로가 같은 일을 하는지 본다.
 */
import { readFileSync, statSync } from "node:fs";
const SH = readFileSync("tools/deploy-local.sh", "utf8");
const WF = readFileSync(".github/workflows/deploy.yml", "utf8");
const TOML = readFileSync("wrangler.toml", "utf8");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.log("  ✗ FAIL " + m); } };

ok((statSync("tools/deploy-local.sh").mode & 0o111) !== 0, "실행 권한이 있다");
ok(/^set -euo pipefail$/m.test(SH), "한 단계라도 실패하면 즉시 멈춘다(set -euo pipefail)");

// ── ① R2 처리가 CI 와 ★글자까지★ 같은가 ──────────────────────────────────────
const SEDS = [
  `-e 's/^# \\[\\[r2_buckets\\]\\]$/[[r2_buckets]]/'`,
  `-e 's/^# binding = "MODELS"$/binding = "MODELS"/'`,
  `-e 's/^# bucket_name = "ai-trader-models"$/bucket_name = "ai-trader-models"/'`,
];
for (const s of SEDS) {
  ok(WF.includes(s) && SH.includes(s), `R2 주석 해제 규칙이 CI 와 같다 — ${s.slice(6, 40)}…`);
}
for (const g of ['^\\[\\[r2_buckets\\]\\]', '^binding = "MODELS"', '^bucket_name = "ai-trader-models"']) {
  ok(SH.includes(g), `해제가 실제로 먹었는지 확인한다 — ${g}`);
}
/* ★진짜 불변식은 '주석이냐' 가 아니라 '배포될 때 R2 가 붙느냐' 다.★
   이 게이트의 첫 판은 "저장소에 주석 상태여야 한다" 고 단언했다가 실패했다 —
   V33.191 이 그 블록을 ★영구 해제해 커밋★ 했기 때문이다(CI 의 sed 는 지금 무동작).
   잘못된 것은 코드가 아니라 내 가정이었다. 불변식을 바로 적는다. */
{
  const active = /^\[\[r2_buckets\]\]$/m.test(TOML)
    && /^binding = "MODELS"$/m.test(TOML)
    && /^bucket_name = "ai-trader-models"$/m.test(TOML);
  const commented = /^# \[\[r2_buckets\]\]$/m.test(TOML);
  ok(active || commented,
     "wrangler.toml 의 R2 블록이 ★활성이거나, sed 로 풀 수 있는 주석 형태★ 다(둘 다 아니면 R2 없이 배포된다)");
  ok(active, "지금은 ★활성 상태로 커밋★ 돼 있다(V33.191) — sed 는 안전망으로만 남는다");
}
ok(SEDS.every(s => WF.includes(s)), "CI 의 안전망 sed 가 그대로 있다(누가 다시 주석 처리해도 붙는다)");
ok(/git checkout -- wrangler\.toml/.test(SH) && /trap restore EXIT/.test(SH),
   "★배포 뒤(실패해도) wrangler.toml 을 원복한다★ — 풀린 상태가 커밋되면 안 된다");

// ── ② 게이트 목록을 ★워크플로에서 읽는가★(손으로 적으면 언젠가 적게 돈다) ──────
ok(/\.github\/workflows\/deploy\.yml/.test(SH) && /grep -oE 'node tools\/check-/.test(SH),
   "★게이트 목록을 deploy.yml 에서 읽는다★ — 손으로 적으면 CI 보다 적게 돌게 된다");
ok(/\$\{#GATES\[@\]\}" -gt 0 \]/.test(SH) || /-gt 0 \]/.test(SH),
   "목록을 못 읽으면 배포하지 않는다(0종 통과를 '성공' 으로 읽지 않는다)");
ok(/게이트 실패 — 배포하지 않는다/.test(SH), "게이트가 하나라도 실패하면 배포하지 않는다");

// 실제로 그 정규식이 지금 워크플로에서 게이트를 뽑아내는가 — 헛돌지 않는지 직접 센다
{
  const found = new Set((WF.match(/node tools\/check-[A-Za-z0-9._-]+\.mjs/g) || []));
  console.log(`\n     워크플로에서 뽑히는 게이트: ${found.size}종`);
  ok(found.size >= 100, `수동 경로가 CI 와 같은 ${found.size}종을 돌린다`);
}
ok(/wrangler@latest deploy|wrangler deploy/.test(SH), "실제로 배포한다");

/* ★O-1 의 교훈 — '명령이 성공했다' 와 '그게 살아 있다' 는 다르다.★
   push 는 4판 연속 성공했는데 배포는 한 번도 안 됐고, 그걸 "배포 완료" 라고 보고했다.
   수동 경로는 ★서버에 물어봐서★ 확인해야 한다. 안 그러면 같은 착각을 반복한다. */
ok(/\/api\/selfcheck/.test(SH), "★배포 뒤 서버에 물어본다★(명령 성공을 배포 성공으로 읽지 않는다)");
ok(/_BUILD_VER/.test(SH), "기대하는 판을 소스에서 읽어 온다(손으로 적지 않는다)");
ok(/정말 올라갔다/.test(SH) && /반영되지 않았다/.test(SH), "확인 결과를 성공·실패 양쪽으로 말한다");
ok(/서버는 '\$\{GOT:-읽지 못함\}' 이라고 답한다[\s\S]{0,200}exit 1/.test(SH),
   "★판이 다르면 0 이 아닌 코드로 끝난다★ — 조용히 성공으로 넘어가지 않는다");

console.log(fail ? `\n✗ 수동 배포 경로 계약 ${fail}건 실패 (총 ${n})`
                 : `\n✓ 수동 배포 경로 계약 통과 (${n}개 단언)`);
process.exit(fail ? 1 : 0);
