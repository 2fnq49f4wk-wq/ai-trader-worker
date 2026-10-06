/* [V33.498] ★폰에서 정보가 빨리 뜬다★ — 사용자: "다른 도메인처럼 로딩 속도 압도적으로 빠르게".
   운영 실측(폰 속도 · run 37490734546): 재방문 문서가 서비스워커를 거쳐 1.3MB 를 다시 받으며 3.0초 · 인트로가 4.8초까지 덮음.
   ① 분할 빌드: 원본을 쪼개 되돌려 붙이면 바이트 단위로 같다 · 대형 인라인 JS/CSS 가 전부 떨어진다 · 순서 보존 · 부팅 임계 코드는 인라인 유지
   ② 불변 캐시: public/_headers 가 /_b/* 를 1년 immutable 로 · 배포 단계가 게이트 뒤·배포 직전에 분할한다
   ③ 인트로 하루 한 번: 머리 스크립트가 첫 페인트 전에 숨김 · ?intro=1 강제 · 숨긴 날엔 입자도 안 깐다
   ④ 상태 선출발: 머리에서 /api/state 를 보내고 첫 api('/api/state') 가 재사용(실패 시 다시 받음)
   ⑤ 서비스워커: 내비게이션 미리받기 · /_b/ 캐시 우선 · 판 갱신 */
import { readFileSync } from "node:fs";
import { splitHtml, joinBack, SPLIT_MIN } from "./build-split.mjs";
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const SW = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const HD = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
const DY = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 분할 빌드");
const r = splitHtml(H);
chk(joinBack(r.html, r.parts) === H, "쪼갠 것을 되돌려 붙이면 원본과 바이트 단위로 같다", "왕복 불일치");
const js = r.parts.filter((p) => p.isJs).length, css = r.parts.filter((p) => !p.isJs).length;
chk(js >= 3 && css >= 3, "대형 조각 JS " + js + " · CSS " + css + " 을 뗀다", "뗀 조각이 적다 JS " + js + " CSS " + css);
const leftBig = [...r.html.matchAll(/<script>([\s\S]*?)<\/script>|<style>([\s\S]*?)<\/style>/g)].filter((m) => Buffer.byteLength(m[1] || m[2] || "", "utf8") >= SPLIT_MIN).length;
chk(leftBig === 0 && r.html.length < 220000, "남은 HTML " + Math.round(r.html.length / 1024) + "KB · 대형 인라인 0", "대형 인라인 " + leftBig + " · HTML " + r.html.length);
const pos = r.parts.map((p) => r.html.indexOf(p.tag));
chk(pos.every((x, i) => x > 0 && r.html.split(r.parts[i].tag).length === 2 && (i === 0 || x > pos[i - 1])),
  "조각마다 같은 자리에 태그 하나 · 원래 순서 그대로", "태그 위치/순서 " + pos.join(","));
chk(/<script>[\s\S]{0,4000}luxIntroDay[\s\S]*?<\/script>/.test(r.html) && /window\.LUXBOOT = \(function/.test(r.html),
  "부팅 임계 코드(인트로 판단·상태 선출발·LUXBOOT)는 인라인으로 남는다", "임계 코드가 떨어져 나갔다");
chk(r.parts.every((p) => /^_b\/[0-9a-f]{16}\.(js|css)$/.test(p.name)) && r.parts.filter((p) => !p.isJs).every((p) => p.file.startsWith('@charset "UTF-8";')),
  "이름은 내용 해시 16자 · CSS 는 @charset UTF-8", "이름/문자셋 형식");

console.log("② 불변 캐시 · 배포 배선");
chk(/^\/_b\/\*\s*\n\s+Cache-Control: public, max-age=31536000, immutable/m.test(HD), "_headers: /_b/* 1년 immutable", "_headers 규칙 없음");
const iSplit = DY.indexOf("node tools/build-split.mjs public/index.html public"), iDeploy = DY.indexOf("run: wrangler deploy"), iLastGate = DY.lastIndexOf("node tools/check-");
chk(iSplit > 0 && iSplit > iLastGate && iSplit < iDeploy, "분할은 모든 게이트 뒤 · 배포 직전", "분할 위치 " + [iLastGate, iSplit, iDeploy].join(","));

const iSmoke = DY.indexOf("분할 빌드 연기 시험(실패하면 원본 재배포)");
chk(iSmoke > iDeploy && /git checkout -- public\/index\.html && rm -rf public\/_b && wrangler deploy/.test(DY.slice(iSmoke)) && /cmp -s \/tmp\/smoke\.bin "public\$f"/.test(DY.slice(iSmoke)),
  "배포 뒤 연기 시험 — /_b/ 파일이 200·내용 일치가 아니면 원본으로 즉시 재배포", "연기 시험/되돌림 없음");

console.log("③ 인트로 하루 한 번");
const head = H.slice(0, H.indexOf("</head>"));
chk(/html\.lux-nointro #lux-intro-overlay\{display:none!important\}/.test(head) && /localStorage\.getItem\('luxIntroDay'\) === day/.test(head) && /intro=1/.test(head),
  "머리에서(첫 페인트 전) 오늘 본 인트로를 숨긴다 · ?intro=1 강제", "인트로 판단이 머리에 없다");
chk(/var _skipIntro = document\.documentElement\.classList\.contains\('lux-nointro'\);/.test(H) && /var dz = _skipIntro \? null :/.test(H),
  "숨긴 날엔 오버레이를 바로 걷고 입자도 안 깐다", "건너뛰기 처리 없음");
chk(/setTimeout\(removeIntro, 4300\)/.test(H), "인트로를 트는 날은 종전대로 고정 4.3초", "고정 길이 변경");

console.log("④ 상태 선출발");
chk(/window\.__earlyState = fetch\('\/api\/state'/.test(head), "머리 스크립트가 /api/state 를 먼저 보낸다", "선출발 없음");
chk(/if \(path === '\/api\/state' && window\.__earlyState && !opts\.method\) \{\s*var _es = window\.__earlyState; window\.__earlyState = null;/.test(H),
  "첫 api('/api/state') 가 한 번만 재사용 · 실패하면 다시 받는다", "재사용 배선 없음");

console.log("⑤ 서비스워커");
chk(/navigationPreload\.enable\(\)/.test(SW) && /e\.preloadResponse/.test(SW), "내비게이션 미리받기(문서가 워커 기동과 동시에 출발)", "미리받기 없음");
chk(/url\.pathname\.startsWith\('\/_b\/'\)/.test(SW) && /const BUILD = 'b-immutable'/.test(SW) && /k !== BUILD/.test(SW), "/_b/ 캐시 우선 · 판이 바뀌어도 그 캐시는 지우지 않는다", "/_b/ 처리 없음");
chk(/const VER = 'lux-v33\.(49[89]|5\d\d)'/.test(SW), "서비스워커 판 갱신", "VER 그대로");
if (fails) { console.log("\n✗ 로딩 속도 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 로딩 속도 계약 통과");
