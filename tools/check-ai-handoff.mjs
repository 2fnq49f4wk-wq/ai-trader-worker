import { readFileSync } from "node:fs";

const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
const claude = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
const handoff = readFileSync(new URL("../AI_HANDOFF.md", import.meta.url), "utf8");
const deployGuide = readFileSync(new URL("../DEPLOY_WITH_CLAUDE.md", import.meta.url), "utf8");
const deployScript = readFileSync(new URL("./deploy-with-claude.sh", import.meta.url), "utf8");
const packageScript = readFileSync(new URL("./package-codex-delivery.sh", import.meta.url), "utf8");
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
check(claude.includes("git pull --ff-only origin main") && claude.includes("별도 배포 지시 없이는 push하지 않는다"),
  "Claude가 main을 먼저 동기화하고 기본적으로 push하지 않는다");
check(claude.includes("오래된 코드 바닥") && deployGuide.includes("origin/main의 최신 코드 위에서"),
  "Claude가 V33.309를 그대로 배포하지 않고 최신 main에서 다시 구현한다");
check(deployScript.includes("git fetch origin main")
    && deployScript.includes("git merge-base --is-ancestor origin/main HEAD")
    && deployScript.includes("git push origin main:main")
    && !/git rebase origin\/main/.test(deployScript)
    && !/push[^\n]*--force/.test(deployScript),
  "배포 도구가 최신 원격 기반이 아니면 중단하고 자동 rebase·force push하지 않는다");
check(agents.includes("결과는 검사·커밋한 뒤 변경 파일과 패치·체크섬을 담은 ZIP으로 전달한다")
    && deployScript.includes("AI의 직접 배포는 중지됐습니다")
    && packageScript.includes("changes.patch")
    && packageScript.includes("SHA256SUMS"),
  "사용자 지시대로 직접 배포를 막고 변경 결과를 ZIP과 체크섬으로 전달한다");
check(agents.includes("토큰이 부족해지거나 작업을 중단하기 전") && agents.includes("커밋"),
  "토큰 소진 전 커밋 체크포인트 규약이 있다");
check(/- Status: (complete|in_progress|blocked)/.test(handoff)
    && /- Branch: \S+/.test(handoff)
    && /- Last commit: .+/.test(handoff),
  "인계 문서에 상태·브랜치·마지막 커밋이 있다");
check(agents.includes("비밀키") && !/(sk-ant-|ghp_|github_pat_)/.test(handoff),
  "인계 문서가 비밀을 공유하지 않는 계약을 가진다");
check(/requireTrustedModel:\s*true/.test(src),
  "AI_PRIMARY는 검증된 DNN/GBDT 없이 신규 진입하지 않는다");
check(/EXTERNAL_LLM_DISABLED\s*=\s*true/.test(src)
    && /EXTERNAL_AI_API_DISABLED\s*=\s*true/.test(src),
  "의도적으로 비활성화한 Claude·외부 AI 정책을 유지한다");

console.log(failures ? `\nAI 인계 계약 위반 ${failures}건` : "\n  ok   AI 인계 계약 통과");
process.exit(failures ? 1 : 0);
