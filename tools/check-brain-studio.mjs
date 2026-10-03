/* [V33.466] ★Brain Studio — '02 모델 구조' 한 화면★ 계약.
 *   사용자: "모델 구조창이 너무 복잡 · 정보가 여기저기 · 움직일 때 렉 · 스크롤 근본적으로".
 *   ① 번들(public/brain-studio.js)이 있고 window.BrainStudio.mount 를 낸다 · 외부 주소로 요청하지 않는다 · 소스와 맞다
 *   ② 스타일은 #brain-studio 안에서만(Preflight 끔 · important 범위) · 사이트 클래스와 안 부딪힌다(자체 클래스는 bs- 접두)
 *   ③ 손가락 기기: 화면 속 3D 는 터치를 받지 않는다(pointer-events:none) — 페이지 스크롤이 막힐 수 없다 · 조작은 전체 화면에서
 *   ④ 렉: 3D 는 WebGL — 장면마다 선 전체를 drawArrays 한 번 · 2D 캔버스로 선을 긋지 않는다 · 화면 밖·숨김이면 쉰다
 *   ⑤ 사이트 배선: '02 모델 구조' 가 처음 열릴 때 불러와 붙이고(bs-on) · 못 붙으면 옛 화면(openNnViz)으로 */
import { readFileSync, existsSync } from "node:fs";
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
console.log("① 번들");
const B = existsSync(new URL("../public/brain-studio.js", import.meta.url)) ? readFileSync(new URL("../public/brain-studio.js", import.meta.url), "utf8") : "";
chk(B.length > 50000 && B.length < 480000, "public/brain-studio.js " + Math.round(B.length / 1024) + "KB(< 470KB)", "★번들이 없거나 너무 크다(" + B.length + ")★");
chk(/BrainStudio/.test(B) && /\.mount\b|mount\(/.test(B), "window.BrainStudio.mount 를 낸다", "★BrainStudio.mount 가 없다★");
const urls = (B.match(/https?:\/\/[a-z0-9.\-]+/gi) || []).filter((u) => !/react\.dev|reactjs\.org|w3\.org/.test(u));
chk(urls.length === 0, "외부 주소 0(같은 출처 API 만)", "★외부 주소가 있다: " + [...new Set(urls)].join(" ") + "★");
for (const tag of ["bs-gl-inline", "모델마다 확률을 낸다", "uR1", "bsCache2_"]) chk(B.includes(tag), "번들이 소스와 맞다: " + tag, "★번들이 낡았다(" + tag + " 없음) — studio 에서 다시 빌드할 것★");
console.log("② 범위 한정 스타일");
const TW = readFileSync(new URL("../studio/tailwind.config.js", import.meta.url), "utf8"), CSS = readFileSync(new URL("../studio/src/index.css", import.meta.url), "utf8");
chk(/important:\s*":is\(#brain-studio,#bs-layer\)"/.test(TW) && /preflight:\s*false/.test(TW), "Tailwind: important #brain-studio·#bs-layer(전체 화면 층) · Preflight 끔", "★스튜디오 스타일이 사이트 전체에 퍼진다★");
const own = (CSS.match(/(?:#brain-studio|:is\(#brain-studio,#bs-layer\))\s+\.([a-z][\w-]*)/g) || []).map((m) => m.replace(/.*\./, ""));
chk(own.length > 0 && own.every((c) => c.startsWith("bs-")), "자체 클래스는 bs- 접두(" + [...new Set(own)].join(",") + ")", "★사이트 클래스와 부딪힐 이름: " + own.filter((c) => !c.startsWith("bs-")).join(",") + "★");
chk(!/className="[^"]*(?<![\w-])rail\b/.test(readFileSync(new URL("../studio/src/App.tsx", import.meta.url), "utf8")), "사이트의 .rail(사이드바)과 같은 이름을 쓰지 않는다", "★.rail 을 쓴다 — 사이트 사이드바 규칙에 숨는다★");
console.log("③ 스크롤");
chk(/@media \(pointer: coarse\) \{ #brain-studio \.bs-gl-inline canvas \{ pointer-events: none; \} \}/.test(CSS) && /bs-gl-inline canvas\s*\{\s*pointer-events:\s*none/.test(B),
  "손가락 기기: 화면 속 3D 는 터치를 받지 않는다", "★화면 속 3D 가 터치를 먹는다(스크롤 막힘)★");
const OS = readFileSync(new URL("../studio/src/views/OmniStage.tsx", import.meta.url), "utf8");
chk(/크게 보기/.test(OS) && /bs-gl-full/.test(OS) && /touch-action: none/.test(CSS), "조작은 '크게 보기' 전체 화면에서(그 안에서만 touch-action:none)", "★전체 화면 조작이 없다★");
console.log("④ 렉 — WebGL");
const GL = readFileSync(new URL("../studio/src/gl/omniGL.ts", import.meta.url), "utf8");
const fr = GL.slice(GL.indexOf("function frame("), GL.indexOf("function kick("));
chk(/getContext\("webgl"/.test(GL) && (fr.match(/gl\.drawArrays\(gl\.LINES, 0, nV\)/g) || []).length === 1 && !/stroke\(|lineTo\(/.test(fr),
  "장면마다 선 전체를 drawArrays 한 번 · 장면 안에서 2D 로 선을 긋지 않는다", "★장면마다 CPU 로 선을 긋는다★");
chk(/IntersectionObserver/.test(GL) && /document\.hidden/.test(fr) && /now - last < 31/.test(fr), "화면 밖·숨김이면 쉬고 · 화면 속 3D 는 초당 30장", "★보이지 않을 때도 그린다★");
chk(/failIfMajorPerformanceCaveat: true/.test(GL) && /spin: opts\.spin && !soft, motion: opts\.motion && !soft/.test(GL) && /ema > \(opts\.interactive \? 90 : 75\)\) \{ v\.spin = false; v\.motion = false;/.test(GL),
  "가속 없는 기기(소프트웨어 WebGL)는 정지 화면 · 장면 간격이 느리면 자동 움직임을 스스로 멈춘다", "★가속 없는 기기에서도 계속 돌린다(CI 휴대폰 흉내: 1.7초 굳음)★");
chk(/NO\.omniCore\(d, st && st\.ok \? st : null\)/.test(OS), "장면 데이터는 사이트의 omniCore 그대로(값을 지어내지 않는다)", "★장면을 따로 지어낸다★");
console.log("⑥ 모든 모델의 신경망");
const NS = readFileSync(new URL("../studio/src/gl/netScenes.ts", import.meta.url), "utf8"), DT = readFileSync(new URL("../studio/src/views/Detail.tsx", import.meta.url), "utf8");
const bn = NS.slice(NS.indexOf("export function buildNet"));
chk(["overview", "mind", "memo", "seq", "dualbull", "dualbear", "gbdt", "xgb", "lgb", "cat"].every((k) => bn.includes('"' + k + '"')), "OMNI 밖 10개(전체·MIND·트리 4·MEMO·SEQ·이중헤드 2)도 신경망 장면이 있다", "★신경망이 빠진 모델이 있다★");
chk(/buildNet\(model, d(, R)?\)/.test(DT) && /\{netView\}\{b\.structure\}/.test(DT) && /<ModelNet /.test(DT), "'구조' 탭 맨 위에 그 모델의 신경망", "★구조 탭에 신경망이 안 붙는다★");
chk(!/Math\.random/.test(NS), "신경망 장면은 응답 값으로만(난수 없음)", "★난수로 그린다★");
chk(/createOmniGL/.test(OS) && /export function ModelNet/.test(OS), "모든 모델이 같은 WebGL 엔진(장면마다 drawArrays 한 번)", "★다른 모델은 다른 그리기 경로★");
chk(/addEventListener\("scroll", onScroll/.test(GL) && /if \(scrolling\) \{ owed = true; return; \}/.test(fr), "페이지가 스크롤되는 동안 화면 속 그림은 멈춘다", "★스크롤 중에도 그린다★");
chk(/if \(owed \|\| v\.spin \|\| v\.motion\)/.test(GL), "스크롤이 멈춘 뒤엔 미뤄진 그리기·움직임이 있을 때만 다시 그린다(정지 화면 기기에서 매번 다시 그리면 0.9초씩 굳는다)", "★스크롤이 멈출 때마다 무조건 다시 그린다★");
chk(/opts\.interactive \? 2 : 1\.5/.test(GL), "화면 속 그림은 해상도 1.5배까지(전체 화면 2배)", "★화면 속 그림 해상도 상한이 없다★");
console.log("⑦ 노드 역할 · SEQ 블록");
const NR = readFileSync(new URL("../studio/src/views/NodeRoles.tsx", import.meta.url), "utf8");
chk(/role: Array\.from\(\{ length: n \}/.test(NS) && (NS.match(/S\.role\(/g) || []).length >= 15, "노드마다 역할 설명(입력·나무·전문가·머리·원형·채널·위원·출력)", "★노드 역할이 비었다★");
chk(/<NodeRoles sc=\{sc\} sel=\{sel\} onSel=\{setSel\} \/>/.test(OS) && /<NodeRoles sc=\{sc\} sel=\{sel\} onSel=\{onSel\} dark \/>/.test(OS) && /노드 역할<\/B>/.test(OS), "구조 탭과 '크게 보기' 모두 노드 역할 패널(크게 보기엔 '노드 역할' 버튼)", "★노드 역할 패널이 빠졌다★");
chk(/select\(id\) \{ if \(v\.sel === id\) return;/.test(GL) && /me\.current\?\.select\(sel\)/.test(OS), "노드를 고르면 그 연결만 밝게 — 한 번만 다시 그린다", "★선택이 그림에 안 닿는다★");
chk(/export function seqBlocks/.test(NS) && /<SeqBlocks d=\{d\} \/>/.test(DT) && /last\.forEach\(\(w, u\)/.test(NS), "SEQ 블록·헤드가 보는 봉(마지막 봉 기준 거리·집중도)", "★SEQ 블록 설명이 없다★");
chk(!/Math\.random/.test(NR), "역할 패널은 응답 값만", "★역할 패널이 값을 지어낸다★");
console.log("⑧ 휴대폰 크게 보기 · 작은 그림 조작");
chk(/createPortal\(/.test(OS) && /el\.id = "bs-layer"/.test(OS) && /z-index:2147483000/.test(OS), "크게 보기는 body 바로 아래 층(#bs-layer)에 — 사이트 머리·아래 탭 막대에 가리지 않는다", "★크게 보기가 페이지 안에 갇혀 사이트 막대에 가린다★");
chk(/height: "100dvh"/.test(OS), "크게 보기 높이 = 실제 보이는 화면(100dvh · 아이폰 주소창)", "★100vh 로 아래 버튼이 화면 밖★");
chk(/#brain-studio \.bs-gl-inline\.bs-touch canvas \{ pointer-events: auto; touch-action: none; \}/.test(CSS) && /손가락으로 돌리기/.test(OS), "작은 그림: '손가락으로 돌리기' 를 켤 때만 터치를 받는다(끄면 스크롤 그대로)", "★작은 그림 조작 스위치가 없다★");
chk(/onPick=\{setSel\} apiRef=\{api\}/.test(OS) && /<NodeRoles sc=\{sc\} sel=\{sel\} onSel=\{setSel\} \/>/.test(OS), "작은 그림에서도 눌러서 노드 고르기 · 노드 역할 패널 기본으로 보임", "★작은 그림에서 노드 역할을 못 본다★");
console.log("⑤ 사이트 배선");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), WU = readFileSync(new URL("../public/workspace-ui.js", import.meta.url), "utf8"), WL = readFileSync(new URL("../public/workspace-layout.css", import.meta.url), "utf8");
chk(/<div id="brain-studio" class="bs-mount"><\/div>/.test(H), "index.html 에 #brain-studio 자리", "★붙일 자리가 없다★");
chk(/sc\.src = '\/brain-studio\.js\?v='/.test(WU) && /if \(!ok && typeof window\.openNnViz === 'function'\) window\.openNnViz\(\);/.test(WU) && /brain\.classList\.add\('bs-on'\)/.test(WU),
  "'02 모델 구조' 를 열 때 불러와 붙이고 · 못 붙으면 옛 화면", "★배선이 틀렸다★");
chk(/#page-nnviz\.bs-on\[data-brain-view="models"\] :is\(#modelEvidence,#nnvStruct\) \{ display:none !important; \}/.test(WL), "붙으면 옛 검증 카드·옛 구조 창을 숨긴다", "★옛 화면과 새 화면이 겹친다★");
if (fails) { console.error("\n✗ Brain Studio 검사 실패 " + fails); process.exit(1); }
console.log("\n✓ Brain Studio 검사 통과");
