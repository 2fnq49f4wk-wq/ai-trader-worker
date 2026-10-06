/* [V33.503] ★인트로가 컴퓨터·아이패드에서 이상하게 보인다★(사용자) — 실측(크로뮴 실시간 · 분할 빌드 · 폰/아이패드/FHD/QHD):
   ① 입자를 메인 스크립트 끝에서 칠해 애니메이션 시작 250~600ms 뒤에 '툭' 생겼다 → 오버레이 바로 뒤 작은 인라인 스크립트(첫 프레임 전)
   ② 퇴장 페이드 동안 대시보드의 backdrop-filter 흐림 패널을 매 프레임 다시 계산 → 50ms+ 프레임 8~10개(폰 0) → 인트로 동안만 끈다
   ③ 큰 화면일수록 입자 층이 커졌다(반경 ~950px · 먼 별이 확대되는 성운 층 안) → 반경 상한 · 먼 별은 자기 층(.lxi-sky)
   ④ 표장이 720px 무대·46px 글자에 묶여 큰 화면에서 작았다 → 짧은 변 비례 상한
   ⑤ 다 쓴 효과는 퇴장 전에 접는다(lxi-flat) · 성운은 퇴장 전에 멈춘다 */
import { readFileSync } from "node:fs";
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const ovEnd = H.indexOf('<div class="intro-boot" id="luxBootProgress" hidden></div>');
const early = H.indexOf("★인트로 입자는 첫 프레임 전에 칠한다★");
const firstBig = (() => { const re = /<script>([\s\S]*?)<\/script>/g; let m; while ((m = re.exec(H))) { if (m[1].length >= 20000) return m.index; } return -1; })();
chk(ovEnd > 0 && early > ovEnd && early < firstBig && early - ovEnd < 400, "① 입자 칠하기가 오버레이 바로 뒤 · 첫 대형 스크립트보다 앞", "입자 위치 " + [ovEnd, early, firstBig]);
const blk = H.slice(H.lastIndexOf("<script>", early), H.indexOf("</script>", early));
chk(blk.length < 20000 && /var dz = _skipIntro \? null :/.test(blk) && /prefers-reduced-motion: reduce/.test(blk), "인라인 유지(<20KB · 분할 안 됨) · 오늘 본 날·동작 줄이기면 안 칠한다", "인라인 블록 " + blk.length);
chk(/var W = Math\.min\(250, VW \* 0\.48\)/.test(blk) && /\(VW - 4\)/.test(blk), "③ 반경은 설계 크기(250) · 먼 별은 화면 안", "반경 상한");
chk(!/var dz = _skipIntro \? null : document\.getElementById\('lxiDust'\);\s*if \(dz && !/.test(H.slice(firstBig)), "메인 스크립트에 옛 입자 칠하기가 남지 않는다(두 번 칠함 방지)", "옛 코드 잔존");
chk(/<div class="lxi-neb" aria-hidden="true"><\/div>\s*<div class="lxi-sky" aria-hidden="true"><div class="lxi-field" id="lxiField">/.test(H), "먼 별은 성운(확대) 밖 자기 층", "sky 층");
chk(/if \(!_skipIntro\) document\.documentElement\.classList\.add\('lux-introfx'\);/.test(blk) && /html\.lux-introfx \*\{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;\}/.test(H),
  "② 인트로 동안 흐림 끔", "흐림 끄기");
const rmN = (H.match(/classList\.remove\('lux-introfx'\)/g) || []).length;
chk(rmN >= 3, "② 걷는 모든 길(정상 · 15초 안전장치 · 최후 보루)에서 흐림을 되돌린다(" + rmN + ")", "되돌림 누락 " + rmN);
chk(/classList\.add\('lxi-flat'\); \}, 3700\);/.test(H) && /lxi-flat \*\{will-change:auto;\}/.test(H) && /animation:lxiNeb 3\.5s/.test(H), "⑤ 3.7초에 층 접기 · 성운 3.5초에 멈춤(퇴장 3.8초 전)", "접기");
chk(/clamp\(104px,min\(13vw,13vh\),176px\)/.test(H) && /font-size:clamp\(26px,min\(5vw,5\.6vh\),64px\)/.test(H), "④ 큰 화면 비례 상한(별 176 · 글자 64)", "크기");
chk(/setTimeout\(removeIntro, 4300\)/.test(H), "길이는 그대로(4.3초)", "길이 변경");
if (fails) { console.log("\n✗ 인트로 큰 화면 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 인트로 큰 화면 계약 통과");
