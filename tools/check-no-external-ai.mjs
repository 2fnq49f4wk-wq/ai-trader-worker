// [V33.111] 외부 AI API 금지 — 정책을 기계가 강제한다.
//
//   사용자 지시(반복): "외부 ai api 사용이 있으면 안 된다".
//   지금은 스위치 두 개(EXTERNAL_LLM_DISABLED / EXTERNAL_AI_API_DISABLED)로 막혀 있는데,
//   ★스위치는 지워질 수 있고 새 호출은 스위치 없이 추가될 수 있다★.
//   실제로 V33.95 이전엔 "외부 LLM 은 막았지만 Roboflow·Workers AI 는 살아 있는" 상태였다 —
//   차단이 흩어져 있으면 하나를 막고 다 막았다고 착각한다.
//
//   이 게이트가 강제하는 것:
//     ① 알려진 외부 AI 호스트로의 fetch 는 반드시 차단 스위치 뒤에 있어야 한다
//     ② 차단 스위치 자체가 true 로 고정돼 있어야 한다
//     ③ 새로운 AI 호스트가 코드에 등장하면(목록 밖이라도) 눈에 띄게 보고한다

import fs from "node:fs";
const src = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const lines = src.split("\n");

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };

// ── ② 스위치가 true 인가 ─────────────────────────────────────────────────────
for (const flag of ["EXTERNAL_LLM_DISABLED", "EXTERNAL_AI_API_DISABLED"]) {
  const re = new RegExp("^const " + flag + "\\s*=\\s*(true|false)\\s*;", "m");
  const m = src.match(re);
  if (!m) bad(flag + " 선언을 찾지 못했다 — 차단 스위치가 사라졌다");
  else if (m[1] !== "true") bad(flag + " = " + m[1] + " — 외부 AI 가 열려 있다");
  else ok(flag + " = true");
}

// ── ①③ AI 호스트 fetch 는 스위치 뒤에 있어야 한다 ────────────────────────────
//   호스트 목록은 '알려진 것' 이고, 목록 밖 후보도 키워드로 훑어 보고한다.
const AI_HOSTS = [
  "api.anthropic.com", "api.openai.com", "generativelanguage.googleapis.com",
  "api.cohere.ai", "api.mistral.ai", "api-inference.huggingface.co",
  "roboflow.com", "api.replicate.com", "api.deepseek.com", "api.x.ai"
];
// 주석을 지운 사본 — 주석 속 URL 은 호출이 아니다.
// ★순진한 정규식으로 지우면 안 된다★: "https://api.anthropic.com" 의 `//` 를 줄주석 시작으로 보고
//   URL 을 통째로 지워 버린다. 실제로 이 게이트의 첫 판이 그 버그로 ★전부 통과★ 했다
//   — 검사기 자신의 파싱이 틀려서 조용히 통과하는 것이 이 저장소가 가장 여러 번 당한 실패다.
//   그래서 문자열·템플릿·정규식을 건너뛰는 스캐너로 지운다(줄 번호는 보존).
function stripComments(t) {
  let o = "", i = 0; const n = t.length; let prev = "";
  while (i < n) {
    const c = t[i];
    if (c === "/" && t[i + 1] === "/") { const j = t.indexOf("\n", i); const e = j < 0 ? n : j; for (; i < e; i++) o += " "; continue; }
    if (c === "/" && t[i + 1] === "*") { const j = t.indexOf("*/", i + 2); const e = j < 0 ? n : j + 2; for (; i < e; i++) o += (t[i] === "\n" ? "\n" : " "); continue; }
    if (c === '"' || c === "'") { const q = c; o += c; i++; while (i < n) { if (t[i] === "\\") { o += t[i] + (t[i + 1] || ""); i += 2; continue; } o += t[i]; if (t[i] === q) { i++; break; } i++; } prev = "x"; continue; }
    if (c === "`") { o += c; i++; while (i < n) { if (t[i] === "\\") { o += t[i] + (t[i + 1] || ""); i += 2; continue; } o += t[i]; if (t[i] === "`") { i++; break; } i++; } prev = "x"; continue; }
    if (c === "/") {
      const isDiv = ")]}".includes(prev) || (prev && /[\w$]/.test(prev));
      if (!isDiv) { o += c; i++; let cls = false; while (i < n) { if (t[i] === "\\") { o += t[i] + (t[i + 1] || ""); i += 2; continue; } o += t[i]; if (t[i] === "[") cls = true; else if (t[i] === "]") cls = false; else if (t[i] === "/" && !cls) { i++; break; } else if (t[i] === "\n") break; i++; } prev = "x"; continue; }
    }
    o += c; if (!/\s/.test(c)) prev = c; i++;
  }
  return o;
}
const noComment = stripComments(src);
const ncLines = noComment.split("\n");
if (noComment.split("\n").length !== src.split("\n").length) bad("주석 제거가 줄 수를 바꿨다 — 줄번호 보고가 어긋난다");

// ★함수 단위로 본다★ — fetch( 와 URL 이 다른 줄에 있거나 변수에 담겨 있으면
//   같은 줄만 보는 검사는 조용히 놓친다(실제로 Roboflow·Anthropic 이 그 형태다).
//   "본문에 AI 호스트 문자열이 있고 네트워크 호출을 하는 함수" 를 전부 잡는다.
const fns = [];
for (let i = 0; i < ncLines.length; i++) {
  const m = ncLines[i].match(/^(?:async )?function (\w+)\s*\(/);
  if (!m) continue;
  let j = i + 1;
  for (; j < ncLines.length; j++)
    if (/^(?:async )?function \w+\s*\(|^const \w+ = |^let \w+ = /.test(ncLines[j])) break;
  fns.push({ name: m[1], start: i, end: j, body: ncLines.slice(i, j).join("\n") });
}
const unguarded = [], guarded = [];
for (const f of fns) {
  const hitHost = AI_HOSTS.filter((h) => f.body.includes(h));
  const usesAI = /env\.AI\.run\s*\(/.test(f.body);
  if (!hitHost.length && !usesAI) continue;
  if (!/fetch\s*\(/.test(f.body) && !usesAI) continue;   // 문자열만 있고 호출은 없음
  const label = f.name + " @L" + (f.start + 1) + " [" + (hitHost.join(",") || "env.AI") + "]";
  // 차단 스위치가 ★본문 안★ 에 있어야 한다(어디에 있든 호출 전에 검사하는 구조라면 인정).
  if (/EXTERNAL_(LLM|AI_API)_DISABLED/.test(f.body)) guarded.push(label);
  else unguarded.push(label);
}
if (unguarded.length) {
  bad("차단 스위치 없이 외부 AI 를 호출하는 함수 " + unguarded.length + "개:\n    " + unguarded.join("\n    "));
} else if (!guarded.length) {
  bad("외부 AI 호출 지점을 하나도 못 찾았다 — 탐지가 깨졌을 가능성이 크다(코드가 정말 없어졌다면 이 검사도 지울 것)");
} else ok("외부 AI 호출 함수 " + guarded.length + "개 전부 차단 스위치 뒤:\n         " + guarded.join("\n         "));

// ③ 목록 밖 AI 후보 — 실패시키지 않고 보고만 한다(오탐으로 배포를 막지 않기 위해).
{
  const suspects = new Set();
  for (const m of noComment.matchAll(/https?:\/\/([a-z0-9.\-]+)/g)) {
    const h = m[1];
    if (AI_HOSTS.some((x) => h.includes(x))) continue;
    if (/(^|\.)(openai|anthropic|cohere|mistral|huggingface|replicate|together|groq|perplexity|deepseek)\./.test(h)) suspects.add(h);
  }
  if (suspects.size) console.log("  info 목록 밖 AI 후보 호스트 발견(확인 필요): " + [...suspects].join(", "));
  else ok("목록 밖 AI 호스트 없음");
}

console.log(fails ? "\n외부 AI 정책 위반 " + fails + "건" : "\n  ok   외부 AI 금지 정책 통과");
process.exit(fails ? 1 : 0);
