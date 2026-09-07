/* ═══════════════════════════════════════════════════════════════════════════
   [V33.310] ★뒤진 바닥에서 온 변경이 게이트를 조용히 떨어뜨리는 것을 막는다★

   ■ 무슨 일이 있었나
     다른 도구(Codex)가 V33.305 브랜치 위에서 V33.309 를 만들었다. 그 바닥은
     V33.304 에서 갈라져 나온 것이라 ★V33.306·307·308 이 통째로 없다★.
     그 상태에서 만든 배포 스크립트는 "전체 check-*.mjs 를 돌린다" 고 말하지만,
     그 바닥의 게이트는 80종이고 지금 main 은 82종이다 — 없는 것을 돌릴 수는 없다.

   ■ 왜 이게 특히 위험한가 — ★자기 자신을 못 보는 구멍★
     게이트는 deploy.yml 에 한 줄씩 손으로 배선된다. 뒤진 deploy.yml 이 얹히면
     새 게이트 세 개(memo-modal · stage-cost · nnviz-switch)가 목록에서 사라진다.
     그런데 그 사라짐을 알아챌 사람이 바로 ★사라진 그 게이트들★ 이다.
     파일은 저장소에 그대로 남아 있으니 `ls tools/` 로도 티가 안 난다.
     이 저장소가 게이트 82종을 쌓아 온 이유가 통째로 무력해지는 경로다.

   ■ 규칙 둘
     ① tools/check-*.mjs 는 하나도 빠짐없이 deploy.yml 에 배선돼 있어야 한다.
        새 게이트를 만들고 배선을 잊는 사고도 같이 막는다.
     ② _BUILD_VER 는 ★뒤로 가지 않는다★. 직전 커밋보다 낮으면 뒤진 바닥이 얹힌
        것이다(V33.308 위에 V33.305 뭉치가 얹히는 바로 그 모양). 직전 커밋을 못
        읽는 환경(얕은 체크아웃)에서는 판정을 건너뛴다 — 없는 근거로 막지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const YML = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 게이트가 하나도 빠짐없이 배포 워크플로에 배선돼 있는가");
{
  const files = readdirSync(new URL("../tools", import.meta.url))
    .filter(f => /^check-.*\.mjs$/.test(f)).sort();
  const wired = new Set([...YML.matchAll(/tools\/(check-[a-z0-9-]+\.mjs)/g)].map(m => m[1]));
  const missing = files.filter(f => !wired.has(f));
  chk(files.length > 0, "게이트 " + files.length + "종을 찾았다", "게이트를 못 찾았다");
  chk(missing.length === 0,
    "게이트 " + files.length + "종이 전부 deploy.yml 에 있다",
    "★배선이 빠진 게이트: " + missing.join(", ") + " — 파일은 있는데 아무도 안 돌린다★");
  /* 반대편도 본다 — 없는 파일을 부르면 배포가 통째로 죽는다. */
  const ghost = [...wired].filter(w => !files.includes(w));
  chk(ghost.length === 0,
    "deploy.yml 이 없는 파일을 부르지 않는다",
    "★deploy.yml 이 없는 게이트를 부른다: " + ghost.join(", ") + " — 배포가 그 자리에서 죽는다★");

  /* 변이 — 배선 한 줄을 지우면 이 검사가 반드시 물어야 한다. */
  const victim = files[files.length - 1];
  const mutated = YML.replace(new RegExp("tools/" + victim.replace(/[.]/g, "\\.")), "tools/check-__none__.mjs");
  const mutWired = new Set([...mutated.matchAll(/tools\/(check-[a-z0-9-]+\.mjs)/g)].map(m => m[1]));
  chk(!mutWired.has(victim),
    "변이: 배선 한 줄을 지우면 이 검사가 그 게이트를 못 찾는다",
    "★변이를 넣어도 통과한다 — 이 검사는 아무것도 안 보고 있다★");
}

console.log("② 빌드 버전이 뒤로 가지 않는가 (뒤진 바닥이 얹혔다는 신호)");
{
  const verOf = (txt) => { const m = /const _BUILD_VER = "V33\.(\d+)";/.exec(txt); return m ? +m[1] : null; };
  const now = verOf(readFileSync(new URL("../src/index.js", import.meta.url), "utf8"));
  chk(now !== null, "지금 _BUILD_VER = V33." + now, "_BUILD_VER 를 못 읽는다");

  let prevTxt = null;
  try {
    prevTxt = execFileSync("git", ["show", "HEAD~1:src/index.js"], { cwd: ROOT, maxBuffer: 1 << 28 }).toString();
  } catch (e) { prevTxt = null; }

  if (prevTxt === null) {
    /* 얕은 체크아웃·최초 커밋 — 비교할 직전이 없다. 없는 근거로 막지 않는다. */
    console.log("  --   직전 커밋을 읽을 수 없어 건너뛴다(얕은 체크아웃이면 정상)");
  } else {
    const prev = verOf(prevTxt);
    if (prev === null) console.log("  --   직전 커밋에 _BUILD_VER 가 없어 건너뛴다");
    else chk(now >= prev,
      "V33." + prev + " → V33." + now + " — 버전이 뒤로 가지 않았다",
      "★V33." + prev + " → V33." + now + " 로 뒤로 갔다 — 뒤진 바닥의 변경이 얹혔다는 뜻이다★");
  }
}

console.log(fails ? "\n실패 " + fails + "건" : "\n전부 통과");
process.exit(fails ? 1 : 0);
