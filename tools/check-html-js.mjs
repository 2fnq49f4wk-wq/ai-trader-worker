// [V33.61] public/index.html 의 인라인 <script> 문법 검사.
//   배경: 프론트는 단일 HTML 안에 인라인 스크립트로 들어있어 `node --check src/index.js` 로는
//   전혀 검증되지 않는다. 실제로 V33.60 에서 중괄호 하나가 어긋나 스크립트 전체가 죽고
//   우측 사이드바·AI두뇌 창이 통째로 사라졌는데, 배포 게이트는 그대로 통과했다.
//   → 배포 전에 인라인 스크립트도 반드시 파싱해 본다.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, idx = 0, bad = 0, checked = 0;
while ((m = re.exec(html)) !== null) {
  const code = m[1];
  idx++;
  if (!code.trim()) continue;
  const line = html.slice(0, m.index).split("\n").length;
  try {
    new vm.Script(code, { filename: `index.html:script#${idx}` });
    checked++;
    console.log(`  ok   script#${idx} (line ${line}, ${code.length.toLocaleString()} chars)`);
  } catch (e) {
    bad++;
    console.error(`  FAIL script#${idx} (line ${line}): ${e.message}`);
  }
}
console.log(`\ninline scripts: ${checked} ok, ${bad} failed`);
process.exit(bad ? 1 : 0);
