/* [V33.526] 리퀴드 메탈 테마 — 사용자: "사이트 디자인을 리퀴드 메탈 느낌으로". 보기 좋은 것만큼 ★가벼워야★ 한다(부하 금지 지시).
 *   ① 다크(기본) 전용 — 모든 규칙이 html:not([data-theme="light"]) 아래(라이트 테마 무영향)
 *   ② 상시 애니메이션은 바탕 1겹 + 로고뿐 · transform/background-position 만 · backdrop-filter 없음
 *   ③ prefers-reduced-motion 이면 멈춘다 · 바탕 광택은 클릭을 안 받고(pointer-events:none) 본문 아래(z-index:-1)
 *   ④ 상승/하락 색(--pos/--neg)은 건드리지 않는다 · index.html 이 맨 뒤에 같은 판(?v=)으로 싣는다 */
import { readFileSync } from "node:fs";
const C = readFileSync(new URL("../public/liquid-metal.css", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const V = (/const _BUILD_VER = "V([\d.]+)"/.exec(readFileSync(new URL("../src/index.js", import.meta.url), "utf8")) || [])[1];
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const body = C.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = body.split("}").map((r) => r.trim()).filter((r) => r.includes("{"));
const sels = [];
for (const r of rules) { const sel = r.slice(0, r.indexOf("{")).trim(); if (/^(@keyframes|@media|from|to|\d+%)/.test(sel) || sel === "") continue; sels.push(...sel.split(",").map((x) => x.trim()).filter(Boolean)); }
const bad = sels.filter((x) => !x.startsWith('html:not([data-theme="light"])') && !/^@media/.test(x));
chk(bad.length === 0, "모든 선택자가 다크 전용(라이트 테마 무영향) — " + sels.length + "개", bad.slice(0, 5).join(" | "));
chk(!/backdrop-filter/.test(body), "backdrop-filter 없음(스크롤 무거움 방지)");
const anims = (body.match(/animation:\s*[a-z-]+/g) || []).filter((a) => !/none$/.test(a));
chk(anims.length === 2 && /lm-flow/.test(anims.join()) && /lm-sheen/.test(anims.join()), "상시 애니메이션은 바탕·로고 2개뿐", anims.join(","));
const kf = [...body.matchAll(/@keyframes\s+([a-z-]+)\s*\{([\s\S]*?)\}\s*\}/g)];
chk(kf.length === 2 && kf.every((k) => !/(width|height|top|left|margin|padding|box-shadow|filter)\s*:/.test(k[2])), "키프레임은 transform/background-position 만(배치 다시 계산 없음)");
chk(/@media \(prefers-reduced-motion: reduce\)[\s\S]*body::before[\s\S]*animation: none !important/.test(body), "움직임 줄이기 설정이면 멈춘다");
chk(/body::before \{[\s\S]*?pointer-events: none;[\s\S]*?\}/.test(body) && /z-index: -1;/.test(body), "바탕 광택은 클릭 안 받고 본문 아래");
chk(!/--pos\s*:|--neg\s*:|--green\s*:|--red\s*:/.test(body), "상승/하락 색은 그대로");
const iLm = H.indexOf('<link rel="stylesheet" href="/liquid-metal.css?v=' + V + '">'), iMe = H.indexOf('<link rel="stylesheet" href="/model-evidence.css?v=');
chk(iLm > iMe && iMe > 0, "index.html 이 다른 스타일 뒤에 같은 판(?v=" + V + ")으로 싣는다", "위치/판 " + [iLm, iMe].join(","));
if (fails) { console.log("\n✗ 리퀴드 메탈 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 리퀴드 메탈 계약 통과");
