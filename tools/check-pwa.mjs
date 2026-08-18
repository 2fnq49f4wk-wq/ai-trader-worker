// [V33.156] 설치형 앱(PWA) 계약.
//
//   ★가장 중요한 계약은 "빠르게" 가 아니라 "옛 화면을 되살리지 않는다" 다.★
//   이 저장소는 "배포는 성공했는데 화면이 그대로다" 를 여러 번 겪었고(V33.145 가 판 배너를
//   넣은 이유), 서비스워커는 그 문제를 증폭시키기 가장 쉬운 장치다 — 흔한 예제처럼
//   cache-first 로 index.html 을 캐시하면 앱이 영원히 옛 판을 띄우고 사용자는 지울 방법도 모른다.
//   그래서 여기서는 ★HTML·API 가 네트워크 우선인지★ 를 강제한다.
import { readFileSync, existsSync, statSync } from "node:fs";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };
const chk = (c, g, n) => c ? ok(g) : bad(n);
const pub = (f) => new URL("../public/" + f, import.meta.url);
const read = (f) => readFileSync(pub(f), "utf8");

// PNG IHDR 에서 실제 픽셀 크기를 읽는다 — 파일만 있고 크기가 틀리면 설치 배너가 안 뜬다.
function pngSize(f) {
  const b = readFileSync(pub(f));
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

// ── ① 매니페스트 ───────────────────────────────────────────────────────────
let man = null;
try { man = JSON.parse(read("manifest.webmanifest")); ok("manifest.webmanifest 가 유효한 JSON"); }
catch (e) { bad("manifest.webmanifest 를 읽거나 파싱할 수 없다: " + e.message); }
if (man) {
  chk(!!man.name && !!man.short_name, `이름이 있다(${man.name})`, "name/short_name 이 없다 — 설치 배너가 안 뜬다");
  chk(man.display === "standalone" || man.display === "fullscreen",
    `표시 모드 ${man.display} — 주소창 없이 앱처럼 열린다`, `display 가 "${man.display}" — 앱처럼 열리지 않는다`);
  chk(!!man.start_url && !!man.scope, `start_url ${man.start_url} · scope ${man.scope}`, "start_url/scope 가 없다");
  const ic = man.icons || [];
  chk(ic.some((i) => i.sizes === "192x192") && ic.some((i) => i.sizes === "512x512"),
    "192·512 아이콘이 선언돼 있다(안드로이드 설치 요건)", "192 또는 512 아이콘이 없다 — 설치가 안 된다");
  chk(ic.some((i) => String(i.purpose || "").includes("maskable")),
    "maskable 아이콘이 있다(안드로이드에서 잘리지 않는다)", "maskable 아이콘이 없다 — 아이콘 모서리가 잘린다");
  chk(!!man.theme_color && !!man.background_color, "theme/background 색이 있다", "테마·배경색이 없다 — 스플래시가 흰 화면이 된다");
}

// ── ② 아이콘 파일이 ★실제로★ 그 크기인가 ──────────────────────────────────
for (const [f, w] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-512.png", 512], ["apple-touch-icon.png", 180]]) {
  if (!existsSync(pub(f))) { bad(`${f} 가 없다`); continue; }
  const s = pngSize(f);
  if (!s) { bad(`${f} 가 PNG 가 아니다`); continue; }
  chk(s.w === w && s.h === w, `${f} ${s.w}×${s.h} (${(s.bytes / 1024).toFixed(1)}KB)`,
    `${f} 크기가 ${s.w}×${s.h} — 선언(${w}×${w})과 다르다`);
}

// ── ③ 문서 head 배선 ───────────────────────────────────────────────────────
const html = read("index.html");
chk(/<link rel="manifest" href="\/manifest\.webmanifest">/.test(html), "manifest 를 연결한다", "manifest 링크가 없다");
chk(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/.test(html), "iOS 홈화면 아이콘이 있다", "apple-touch-icon 이 없다 — iOS 에서 스크린샷이 아이콘이 된다");
chk(/apple-mobile-web-app-capable" content="yes"/.test(html), "iOS 에서 주소창 없이 열린다", "apple-mobile-web-app-capable 이 없다");
chk(/viewport-fit=cover/.test(html), "viewport-fit=cover — 노치·홈바 영역까지 쓴다", "viewport-fit=cover 가 없다 — 앱 모드에서 상하 검은 띠가 생긴다");
chk(/name="theme-color"[^>]*prefers-color-scheme: dark/.test(html) && /name="theme-color"[^>]*prefers-color-scheme: light/.test(html),
  "테마별 상태바 색을 각각 준다", "theme-color 가 테마별로 없다 — 상태바가 화면과 어긋난다");

// ── ④ ★서비스워커가 옛 화면을 되살리지 않는가★ (이 게이트의 핵심) ──────────
const sw = read("sw.js");
chk(/const isDoc = req\.mode === 'navigate'/.test(sw) && /const isApi = url\.pathname\.startsWith\('\/api\/'\)/.test(sw),
  "문서와 API 를 따로 판별한다", "문서/API 판별이 없다");
// 네트워크 우선: try{ fetch } → catch{ caches } 순서여야 한다. 반대면 옛 화면이 고착된다.
const docBranch = sw.slice(sw.indexOf("if (isDoc || isApi)"), sw.indexOf("// 그 외 정적 자산"));
chk(/const res = await fetch\(req\);/.test(docBranch) && docBranch.indexOf("await fetch(req)") < docBranch.indexOf("caches.match(req)"),
  "HTML·API 는 ★네트워크 우선★ — 캐시는 오프라인일 때만 꺼낸다",
  "HTML·API 가 캐시 우선이다 — 앱이 옛 판을 영원히 띄우고 사용자는 지울 방법이 없다");
chk(/self\.skipWaiting\(\)/.test(sw) && /clients\.claim\(\)/.test(sw),
  "새 워커가 즉시 인수한다(판 두 개가 도는 시간을 없앤다)", "skipWaiting/clients.claim 이 없다 — 새 판이 다음 실행까지 안 걸린다");
chk(/error: 'offline', offline: true/.test(sw),
  "오프라인 API 는 ★오프라인임을 밝힌다★ — 옛 값을 최신처럼 그리지 않는다",
  "오프라인일 때 API 가 옛 값을 조용히 돌려준다 — 화면이 낡은 수치를 최신으로 표시한다");
chk(/caches\.keys\(\)/.test(sw) && /caches\.delete\(k\)/.test(sw), "판이 바뀌면 옛 캐시를 지운다", "옛 캐시를 정리하지 않는다");

// ── ⑤ 등록이 메인 스크립트와 분리돼 있는가 ─────────────────────────────────
//   메인은 38만자 인라인 스크립트다. 거기서 예외가 나도 앱 설치는 되어야 하고,
//   등록이 실패해도 웹은 평소대로 돌아야 한다. 묶으면 하나가 다른 하나를 죽인다.
const headPart = html.slice(0, html.indexOf("</head>"));
chk(/navigator\.serviceWorker\.register\('\/sw\.js'/.test(headPart),
  "서비스워커 등록이 head 의 독립 스크립트에 있다(메인과 분리)",
  "등록이 메인 스크립트 안에 있다 — 메인이 죽으면 앱 설치도 죽는다");
chk(/location\.protocol !== 'https:' && location\.hostname !== 'localhost'/.test(headPart),
  "https/localhost 가 아니면 등록을 건너뛴다(file:// 로 열 때 콘솔 오염 없음)",
  "프로토콜 가드가 없다");

// ── ⑥ 판 배너가 서비스워커 캐시까지 비우는가 ───────────────────────────────
//   안 그러면 "새로고침을 눌렀는데 그대로" — 이 배너가 없애려던 바로 그 증상이 남는다.
chk(/if\(window\.caches && caches\.keys\)/.test(html) && /postMessage\('lux-skip-waiting'\)/.test(html),
  "판 배너가 캐시를 비우고 새 워커를 인수시킨다", "판 배너가 서비스워커 캐시를 그대로 둔다 — 눌러도 옛 화면이 남는다");

console.log(fails ? "\nPWA 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   PWA 계약 통과");
process.exit(fails ? 1 : 0);
