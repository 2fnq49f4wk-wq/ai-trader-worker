/* [V33.498] ★배포 직전 분할 빌드 — 인라인 대형 스크립트·스타일을 내용 해시 파일로 떼어 낸다★
 * 사용자: "다른 도메인처럼 로딩 속도 압도적으로 빠르게". index.html 이 1.33MB(압축 390KB)이고 그중
 * 인라인 JS 794KB · CSS 411KB 가 ★매 방문마다★ 다시 내려왔다(서비스워커가 HTML 을 네트워크 우선으로 받는다).
 * 보통 사이트처럼 큰 코드는 /_b/<sha>.js|css 로 떼고 1년 불변 캐시(public/_headers) — 재방문은 작은 HTML 만 받는다.
 *
 * ★저장소의 public/index.html 은 그대로 원본이다★ — 게이트 170여 개가 그 텍스트를 읽는다.
 *   이 빌드는 CI 의 배포 단계에서 ★모든 게이트가 통과한 뒤★ 작업 사본에만 돈다(커밋되지 않는다).
 * 안전장치: 떼어 낸 조각을 원래 자리에 되돌려 붙이면 원본과 ★바이트 단위로 같아야★ 한다(아니면 실패 · 아무것도 쓰지 않는다).
 *   · 속성이 없는 <script>/<style> 만 뗀다(src·type·id 가 붙은 것은 그대로) · 작은 조각(<20KB)은 인라인 유지(부팅 임계 코드)
 *   · 스크립트는 같은 자리의 동기 <script src> 로 — 실행 순서·전역 스코프가 같다
 *   · CSS 는 @charset "UTF-8" 을 앞에 붙인다(한글 content 문자열 보호)
 * 사용법: node tools/build-split.mjs [원본 html=public/index.html] [출력 폴더=public]   (--check 면 쓰지 않고 검사만) */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";

export const SPLIT_MIN = 20000;
export function splitHtml(html) {
  const parts = [];
  // HTML 주석을 먼저 건너뛴다 — 주석 안의 "<style>" 글자(부팅 설명문에 있다)를 태그로 오인하지 않게
  const re = /<!--[\s\S]*?-->|<script>([\s\S]*?)<\/script>|<style>([\s\S]*?)<\/style>/g;
  let out = "", last = 0, m;
  while ((m = re.exec(html))) {
    if (m[1] === undefined && m[2] === undefined) continue;   // 주석
    const isJs = m[1] !== undefined;
    const body = isJs ? m[1] : m[2];
    if (Buffer.byteLength(body, "utf8") < SPLIT_MIN) continue;
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    const name = "_b/" + hash + (isJs ? ".js" : ".css");
    // 못 받으면(404·네트워크) 한 번만 통짜 원본(/full.html)으로 옮긴다 — 코드 없는 반쪽 화면을 남기지 않는다
    const tag = isJs ? '<script src="/' + name + '" onerror="__luxSplitFail()"></script>'
                     : '<link rel="stylesheet" href="/' + name + '" onerror="__luxSplitFail()">';
    out += html.slice(last, m.index) + tag;
    last = m.index + m[0].length;
    parts.push({ name, tag, isJs, body, orig: m[0], file: isJs ? body : '@charset "UTF-8";\n' + body });
  }
  out += html.slice(last);
  return { html: out, parts };
}
/* [V33.500] 분할 파일 실패 피난 — <head> 바로 뒤(어떤 분할 태그보다 앞)에 둔다. 세션당 한 번만 옮긴다(되돌이 방지). */
export const FALLBACK_JS = "<script>window.__luxSplitFail=function(){try{if(sessionStorage.getItem('luxFull'))return;sessionStorage.setItem('luxFull','1')}catch(e){}" +
  "location.replace('/full.html'+location.search+location.hash)}</script>";
export function withFallback(html) { return html.replace(/<head>/i, (h) => h + "\n" + FALLBACK_JS); }
export function joinBack(html, parts) {
  let s = html;
  for (const p of parts) {
    const i = s.indexOf(p.tag);
    if (i < 0) throw new Error("tag missing " + p.name);
    s = s.slice(0, i) + p.orig + s.slice(i + p.tag.length);
  }
  return s;
}

const isMain = process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const checkOnly = process.argv.includes("--check");
  const src = args[0] || "public/index.html", outDir = args[1] || dirname(src);
  const html = readFileSync(src, "utf8");
  if (/<!-- \[build-split\]/.test(html)) { console.log("이미 분할된 파일이다 — 건너뜀"); process.exit(0); }
  const r = splitHtml(html);
  if (joinBack(r.html, r.parts) !== html) { console.error("✗ 되돌려 붙인 결과가 원본과 다르다 — 쓰지 않는다"); process.exit(1); }
  const jsKB = r.parts.filter((p) => p.isJs).reduce((a, p) => a + p.body.length, 0) / 1024;
  const cssKB = r.parts.filter((p) => !p.isJs).reduce((a, p) => a + p.body.length, 0) / 1024;
  console.log("분할: 조각 " + r.parts.length + " (JS " + jsKB.toFixed(0) + "KB · CSS " + cssKB.toFixed(0) + "KB) · HTML " +
    (html.length / 1024).toFixed(0) + "KB → " + (r.html.length / 1024).toFixed(0) + "KB");
  if (checkOnly) process.exit(0);
  const bdir = join(outDir, "_b");
  if (existsSync(bdir)) rmSync(bdir, { recursive: true });
  mkdirSync(bdir, { recursive: true });
  for (const p of r.parts) writeFileSync(join(outDir, p.name), p.file);
  const stamp = "<!-- [build-split] " + r.parts.length + " parts · " + new Date().toISOString() + " -->\n";
  writeFileSync(join(outDir, "index.html"), withFallback(r.html).replace(/^<!DOCTYPE html>\n?/i, (d) => d + stamp));
  writeFileSync(join(outDir, "full.html"), html);   // 통짜 원본 — 분할 파일을 못 받을 때의 피난처
  console.log("✓ 피난처 full.html(통짜 원본) 기록");
  console.log("✓ " + bdir + " 에 " + r.parts.length + "개 · index.html 갱신");
}
