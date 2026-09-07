/* ═══════════════════════════════════════════════════════════════════════════
   [V33.311] Claude·Codex 공통 인계 계약 — 다른 도구의 손실 없이 이어받는가

   V33.305(codex/find-issues-with-embedded-ai-models)에서 가져왔다. 원본은
   requireTrustedModel:true 를 강제하는 항목을 갖고 있었는데, 그 값은 2026-07-22
   사용자 지시로 false 로 완화된 실매매 리스크 정책이다 — 이 검사가 임의로 그 값을
   강제하면 안 된다(사용자가 2026-09-07 재확인: false 유지). 그래서 그 항목은 빼고,
   나머지 "인계가 실제로 되는가" 계약만 옮겼다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";

const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
const claude = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
const handoff = readFileSync(new URL("../AI_HANDOFF.md", import.meta.url), "utf8");
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

let failures = 0;
function check(condition, message) {
  if (condition) console.log("  ok   " + message);
  else { console.error("  FAIL " + message); failures++; }
}

check(claude.includes("AGENTS.md") && claude.includes("AI_HANDOFF.md"),
  "Claude가 공통 규약과 인계 상태를 읽는다");
check(agents.includes("git status --short --branch") && agents.includes("git log -5 --oneline"),
  "새 AI가 실제 Git 상태를 먼저 확인한다");
check(agents.includes("`main`에서 직렬로 작업한다")
    && agents.includes("같은 작업 트리에서 두 AI를 동시에 실행하지 않는다"),
  "Claude와 Codex가 main에서 직렬로 인계한다");
check(claude.includes("git pull --ff-only origin main") && claude.includes("git push origin main"),
  "Claude가 main 동기화 순서를 따른다");
check(agents.includes("토큰이 부족해지거나 작업을 중단하기 전") && agents.includes("커밋"),
  "토큰 소진 전 커밋 체크포인트 규약이 있다");
check(/- Status: (complete|in_progress|blocked)/.test(handoff)
    && /- Branch: \S+/.test(handoff)
    && /- Last commit: .+/.test(handoff),
  "인계 문서에 상태·브랜치·마지막 커밋이 있다");
check(agents.includes("비밀키") && !/(sk-ant-|ghp_|github_pat_)/.test(handoff),
  "인계 문서가 비밀을 공유하지 않는 계약을 가진다");
/* [V33.311] requireTrustedModel 은 값 자체를 강제하지 않는다(실매매 리스크는 사용자
   결정 사항). 대신 ★값을 바꾸면 그 옆의 근거 주석도 같이 바꿔야 한다★ 는 것만 본다 —
   날짜 없는 조용한 플래그 뒤집기를 막는다(이번 사고가 정확히 그 모양이었다). */
{
  const m = /requireTrustedModel:\s*(true|false)/.exec(src);
  check(!!m, "requireTrustedModel 값을 읽었다" + (m ? ` (현재 ${m[1]})` : ""));
  const around = m ? src.slice(Math.max(0, m.index - 700), m.index) : "";
  check(/\d{4}-\d{2}-\d{2}/.test(around),
    "requireTrustedModel 옆에 날짜 있는 사용자 결정 근거가 있다 — 조용한 값 뒤집기를 막는다");
}
check(/EXTERNAL_LLM_DISABLED\s*=\s*true/.test(src)
    && /EXTERNAL_AI_API_DISABLED\s*=\s*true/.test(src),
  "의도적으로 비활성화한 Claude·외부 AI 정책을 유지한다");

console.log(failures ? `\nAI 인계 계약 위반 ${failures}건` : "\n  ok   AI 인계 계약 통과");
process.exit(failures ? 1 : 0);
