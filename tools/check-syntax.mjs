// [V33.99] ★구문 게이트 재작성 — `node --check` 가 무력했다★
//
//   배포가 V33.82 부터 17커밋 연속 실패했는데, 그동안 게이트는 매번 "통과" 라고 했다.
//   원인: Node 22 의 `node --check` 는 ★`export` 가 있는 .js 파일의 구문오류를 삼킨다★.
//   2줄로 재현된다:
//       // e2.js
//       export default {};
//       const = = = ;
//     $ node --check e2.js   → exit 0   (통과!)
//     $ node --check e2.mjs  → exit 1   (정상)
//   확장자가 .js 라 CommonJS 로 먼저 파싱 → 실패 → ESM 재시도하는 경로에서 오류가 사라진다.
//   우리 src/index.js 는 정확히 그 조건(.js + export default)이라, 이 게이트는
//   ★단 한 번도 구문을 검사한 적이 없다★.
//
//   → 두 가지로 바꾼다.
//     ① .mjs 사본으로 node --check — 모듈로 확실히 파싱시킨다.
//     ② esbuild 파싱 — wrangler 가 실제 배포에 쓰는 것과 같은 파서.
//        게이트가 통과했는데 배포가 깨지는 일이 다시는 없어야 한다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const target = process.argv[2] || "src/index.js";
const src = fs.readFileSync(target, "utf8");
let bad = 0;

// ① .mjs 사본으로 모듈 파싱
const tmp = path.join(os.tmpdir(), "syntax-check-" + process.pid + ".mjs");
fs.writeFileSync(tmp, src);
try {
  execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  console.log("  ok   node --check (.mjs 모듈 파싱)");
} catch (e) {
  const msg = (e.stderr ? e.stderr.toString() : String(e)).split("\n").slice(0, 12).join("\n");
  console.error("  FAIL 구문오류 (모듈 파싱):\n" + msg);
  bad++;
} finally { try { fs.unlinkSync(tmp); } catch (e2) {} }

// ② esbuild — wrangler 가 쓰는 파서로 한 번 더. 여기서 통과해야 실제 배포가 된다.
try {
  // [Codex V33.314] npx.cmd cannot be execFileSync'ed on Windows; /dev/null is also POSIX-only.
  const { buildSync } = await import("esbuild");
  buildSync({ entryPoints: [target], bundle: true, format: "esm", write: false, logLevel: "silent" });
  console.log("  ok   esbuild 파싱 (wrangler 와 동일 파서)");
} catch (e) {
  const out = ((e.stderr ? e.stderr.toString() : "") + (e.stdout ? e.stdout.toString() : "") + String(e)).trim();
  if (e.code === 'ERR_MODULE_NOT_FOUND') {
    console.log("  WARN esbuild 미설치 — 이 검사는 건너뛴다(CI 에서는 반드시 설치할 것)");
  } else {
    console.error("  FAIL esbuild 파싱 실패:\n" + out.split("\n").slice(0, 14).join("\n"));
    bad++;
  }
}

// ③ 중괄호 균형을 독립적으로 한 번 더 — 파서가 또 우리를 속이면 이게 잡는다.
{
  let i = 0, n = src.length, prev = "", depth = 0, line = 1;
  const stack = [];
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { const j = src.indexOf("\n", i); i = j < 0 ? n : j; continue; }
    if (c === "/" && src[i + 1] === "*") { const j = src.indexOf("*/", i + 2); const seg = src.slice(i, j < 0 ? n : j + 2); line += (seg.match(/\n/g) || []).length; i = j < 0 ? n : j + 2; continue; }
    if (c === '"' || c === "'") { const q = c; i++; while (i < n) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) { i++; break; } if (src[i] === "\n") line++; i++; } prev = "x"; continue; }
    if (c === "`") { i++; let d2 = 0; while (i < n) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === "$" && src[i + 1] === "{") { d2++; i += 2; continue; } if (src[i] === "}" && d2 > 0) { d2--; i++; continue; } if (src[i] === "`" && d2 === 0) { i++; break; } if (src[i] === "\n") line++; i++; } prev = "x"; continue; }
    if (c === "/") {
      const isDiv = ")]}".includes(prev) || (prev && /[\w$]/.test(prev));
      if (!isDiv) { i++; let cls = false; while (i < n) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === "[") cls = true; else if (src[i] === "]") cls = false; else if (src[i] === "/" && !cls) { i++; break; } else if (src[i] === "\n") break; i++; } while (i < n && /[a-z]/.test(src[i])) i++; prev = "x"; continue; }
      prev = "/"; i++; continue;
    }
    if (c === "{") { depth++; stack.push(line); }
    else if (c === "}") { depth--; stack.pop(); }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  if (depth !== 0) {
    console.error(`  FAIL 중괄호 불균형: 최종 depth ${depth} · 안 닫힌 '{' 줄번호 ${JSON.stringify(stack.slice(0, 5))}`);
    bad++;
  } else console.log("  ok   중괄호 균형");
}

if (bad) { console.error(`\n구문 게이트 ${bad}건 실패 — 배포 차단`); process.exit(1); }
console.log("  ok   구문 게이트 통과");
