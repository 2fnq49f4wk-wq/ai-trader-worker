/* [V33.498] ★폰에서 정보가 빨리 뜬다★ — 사용자: "다른 도메인처럼 로딩 속도 압도적으로 빠르게".
   운영 실측(폰 속도 · run 37490734546): 재방문 문서가 서비스워커를 거쳐 1.3MB 를 다시 받으며 3.0초 · 인트로가 4.8초까지 덮음.
   ① 분할 빌드: 원본을 쪼개 되돌려 붙이면 바이트 단위로 같다 · 대형 인라인 JS/CSS 가 전부 떨어진다 · 순서 보존 · 부팅 임계 코드는 인라인 유지
   ② 불변 캐시: public/_headers 가 /_b/* 를 1년 immutable 로 · 배포 단계가 게이트 뒤·배포 직전에 분할한다
   ③ 인트로 하루 한 번: 머리 스크립트가 첫 페인트 전에 숨김 · ?intro=1 강제 · 숨긴 날엔 입자도 안 깐다
   ④ 상태 선출발: 머리에서 /api/state 를 보내고 첫 api('/api/state') 가 재사용(실패 시 다시 받음)
   ⑤ 서비스워커: 내비게이션 미리받기 · /_b/ 캐시 우선 · 판 갱신 */
import { readFileSync } from "node:fs";
import { splitHtml, joinBack, SPLIT_MIN, withFallback, FALLBACK_JS } from "./build-split.mjs";
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

{
  const fh = withFallback(r.html);
  // 빌드 산출물(소스에 없는 글자)을 찾는다 — 앵커 검사 대상이 아니므로 글자를 조립해 쓴다
  const FN = ["__lux", "SplitFail"].join(""), ONERR = "onerror=" + JSON.stringify(FN + "()");
  const iFb = fh.indexOf("window." + FN), iFirstPart = fh.indexOf(ONERR);
  chk(r.parts.every((p) => p.tag.includes(ONERR)) && iFb > 0 && iFb < iFirstPart && /location\.replace\('\/full\.html'/.test(FALLBACK_JS) && /sessionStorage\.getItem\('luxFull'\)/.test(FALLBACK_JS),
    "분할 파일을 못 받으면 세션당 한 번 통짜 원본(/full.html)으로 피난 — 피난 함수가 모든 분할 태그보다 앞", "피난 배선 없음/순서");
}

console.log("② 불변 캐시 · 배포 배선");
chk(/^\/_b\/\*\s*\n\s+Cache-Control: public, max-age=31536000, immutable/m.test(HD), "_headers: /_b/* 1년 immutable", "_headers 규칙 없음");
const iSplit = DY.indexOf("node tools/build-split.mjs public/index.html public"), iDeploy = DY.indexOf("run: wrangler deploy"), iLastGate = DY.lastIndexOf("node tools/check-");
chk(iSplit > 0 && iSplit > iLastGate && iSplit < iDeploy, "분할은 모든 게이트 뒤 · 배포 직전", "분할 위치 " + [iLastGate, iSplit, iDeploy].join(","));

const iSmoke = DY.indexOf("분할 빌드 연기 시험(실패하면 원본 재배포)");
chk(iSmoke > iDeploy && /git checkout -- public\/index\.html && rm -rf public\/_b && wrangler deploy/.test(DY.slice(iSmoke)) && /cmp -s \/tmp\/smoke\.bin "public\$f"/.test(DY.slice(iSmoke)),
  "배포 뒤 연기 시험 — /_b/ 파일이 200·내용 일치가 아니면 원본으로 즉시 재배포", "연기 시험/되돌림 없음");
chk(/for t in 1 2 3 4 5 6 7 8; do/.test(DY.slice(iSmoke)) && /\/full\.html/.test(DY.slice(iSmoke)), "엣지 전파 지연은 파일마다 ~70초 다시 묻는다 · 피난처 /full.html 도 확인", "재시도/피난처 확인 없음");

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

console.log("⑤ 저장된 화면 사본으로 즉시 그리기(V33.499)");
{
  const iPre = H.indexOf("if (!document.querySelector('.page.active')) {"), iFirst = H.indexOf("    refreshAll();\n", iPre), iShow = H.indexOf("showPage(_lp);");
  chk(iPre > 0 && iFirst > iPre && iFirst - iPre < 900 && iShow > iFirst,
    "첫 refreshAll 전에 시작 페이지를 활성 표시 — 사본(bootBundle)이 대시보드 칸을 바로 그린다(로컬: 상태 8초 지연에도 0.2초)", "시작 페이지 선표시 없음/순서 " + [iPre, iFirst, iShow].join(","));
}

console.log("⑥ 서비스워커");
chk(/navigationPreload\.enable\(\)/.test(SW) && /e\.preloadResponse/.test(SW), "내비게이션 미리받기(문서가 워커 기동과 동시에 출발)", "미리받기 없음");
chk(/url\.pathname\.startsWith\('\/_b\/'\)/.test(SW) && /const BUILD = 'b-immutable'/.test(SW) && /k !== BUILD/.test(SW), "/_b/ 캐시 우선 · 판이 바뀌어도 그 캐시는 지우지 않는다", "/_b/ 처리 없음");
chk(/const VER = 'lux-v33\.(49[89]|5\d\d)'/.test(SW), "서비스워커 판 갱신", "VER 그대로");
console.log("⑦ 캐시 층 표시(V33.521) — 운영 측정이 느린 원인을 추측 없이 가른다");
{
  const SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const a = SRC.indexOf("const swrJson = async function"), b = SRC.indexOf("// === [개선] /api/state 통합 응답 ===", a);
  const f = a > 0 && b > a ? SRC.slice(a, b) : "";
  chk(f && !/headers: jhdr \}/.test(f) && ["l1", "l1s", "l2"].every((l) => f.includes('jh("' + l + '")')) && /jh\(rAge < staleMs \? "r2" : "r2old"\)/.test(f) && /jh\(_lay\)/.test(f) && /_lay = "build"/.test(f),
    "swrJson 응답은 전부 x-lux-c(l1·l1s·l2·r2·build·join) 를 단다", "층 표시가 빠진 swrJson 응답이 있다");
  // [V33.545] 한동안 방문이 없던 뒤 첫 요청이 콜드 빌드를 기다리지 않는다(24시간 안 R2 사본을 먼저 주고 뒤에서 갱신) · 읽기 화면 현금 60초 기억
  chk(/const HARD_STALE = Math\.max\(staleMs, 86400000\)/.test(f) && /rAge < HARD_STALE/.test(f),
    "swrJson: 24시간 안 사본은 먼저 준다(밤새 방문 없던 뒤 첫 화면이 73초 기다리던 것)", "★오래된 사본을 버리고 콜드 빌드를 기다린다★");
  chk(/_cashForRead\(env\.DB, cfg\),   \/\/ \[V33\.545\]/.test(SRC) && /async function _cashForRead/.test(SRC),
    "원자재 화면: 현금은 60초 기억(5개 시장 원장 재계산이 30초 시간초과를 냈다)", "★읽기 화면이 매번 원장 전체를 다시 계산한다★");
  // [V33.546] microSwr: 빌드가 이미 돌아도 R2 사본을 먼저 본다 · 24시간 안 오래된 사본이 있으면 빌드는 12초까지만 기다린다
  const ma = SRC.indexOf("async function microSwr("), mf = ma > 0 ? SRC.slice(ma, ma + 6000) : "";
  chk(mf && !/if \(R2 && !__mcInflight\.has\(key\)\)/.test(mf) && /age <= 86400000/.test(mf) && /"r2old"/.test(mf) && /setTimeout\(function \(\) \{ r\(null\); \}, 12000\)/.test(mf),
    "microSwr: 진행 중 빌드가 있어도 사본 먼저 · 오래된 사본이면 12초 뒤 사본으로(실적·뉴스 30초 멈춤)", "★빌드 진행 중이면 사본을 건너뛰고 빌드를 기다린다★");
  // [V33.547] /api/state 관심종목: 짝과 같은 값의 두 번째 이름은 빼고 보낸다 — 화면이 그 이름을 읽기 시작하면 이 줄이 막는다
  {
    const { readdirSync } = await import("node:fs");
    const pub = new URL("../public/", import.meta.url);
    const CL = readdirSync(pub).filter((f) => /\.(html|js)$/.test(f) && f !== "sw.js").map((f) => readFileSync(new URL(f, pub), "utf8")).join("\n");
    const used = ["dailyRsi", "dailyMa", "dailyAtr", "dispPrice", "dispPct"].filter((k) => new RegExp("\\b" + k + "\\b").test(CL));
    const M = await import("../src/index.js");
    const o = JSON.parse(JSON.stringify({ w: [{ price: 1.5, dispPrice: 1.5, dayPct: 2, dispPct: 3, rsi: 50, dailyRsi: 50 }], cfg: { dailyMa: 5 } }, M._stateNumTrim));
    chk(!used.length && o.w[0].dispPrice === undefined && o.w[0].dailyRsi === undefined && o.w[0].dispPct === 3 && o.cfg.dailyMa === 5,
      "/api/state: 같은 값 두 번째 이름(dailyRsi·dailyMa·dailyAtr·dispPrice·dispPct)은 뺀다 · 값이 다르면 그대로", "화면이 읽는 이름: " + used.join(",") + " · " + JSON.stringify(o));
  }
  // [V33.547] /api/kr-halt: 매 요청 D1 쓰기 금지 — 쓸 이유(날 바뀜·문턱·새 발동·60초 묵음)가 있을 때만
  {
    const ka = SRC.indexOf("async function krHaltSnapshot("), kf = ka > 0 ? SRC.slice(ka, ka + 4000) : "";
    chk(/if \(_rwKh && _need\) await setState\(DB, "krhalt:state", st\)/.test(kf) && /nowTs - \(prev\.ts \|\| 0\) < 60000/.test(kf) && !/if \(_rwKh\) await setState/.test(kf),
      "kr-halt: 평소엔 1분에 한 번만 상태를 쓴다(요청마다 쓰던 ~1s 빌드)", "★GET 마다 D1 쓰기★");
  }
  // [V33.549] 부팅 중 강제 레이아웃 금지(운영 프로파일: 지도 clientWidth 792~881ms/회 · 시장탭 scrollTop 253ms · 레일 폭 777ms(데스크톱))
  {
    const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const WU = readFileSync(new URL("../public/workspace-ui.js", import.meta.url), "utf8");
    const ra = H.indexOf("function renderFvHeatmapInto(host)"), rf = ra > 0 ? H.slice(ra, H.indexOf("function fvFmtPct", ra)) : "";
    chk(rf && !/host\.clientWidth|host\.clientHeight|getComputedStyle\(host\)/.test(rf) && /fvHostSize\(host\)/.test(rf) && /new ResizeObserver/.test(H.slice(H.indexOf("function fvHostSize"), ra)),
      "지도: 크기를 재지 않고 ResizeObserver 로 받는다(렌더마다 문서 전체 강제 레이아웃 제거)", "★renderFvHeatmapInto 가 크기를 직접 읽는다★");
    chk(rf && !/setAttribute\('data-tip'/.test(rf) && /g\.__tip \? fvTipHtml\(/.test(H) && /function fvSA\(el, k, v\)/.test(H),
      "지도: 툴팁은 올렸을 때만 만든다 · 같은 값은 DOM 에 다시 쓰지 않는다", "★렌더마다 전 타일 툴팁·속성을 다시 쓴다★");
    chk(/if \(!init\) market\.scrollTop = 0;/.test(WU) && /luxMarketView\(market\.getAttribute\('data-market-view'\) \|\| 'all', true\)/.test(WU),
      "시장 탭: 처음 붙일 때 scrollTop 을 쓰지 않는다", "★부팅 중 scrollTop 쓰기★");
    // [V33.552] 멈춤 기록 비컨은 화면 크기를 미리 읽어 둔 값으로 보낸다 · 부팅 첫 showPage 는 scrollTop 을 안 읽는다
    const sd = H.slice(H.indexOf("function send(force) {"), H.indexOf("document.addEventListener('scroll'", H.indexOf("function send(force) {")));
    chk(sd && /vp: vpStr,/.test(sd) && !/innerWidth/.test(sd) && /if\(pg && showPage\.__shown\) requestAnimationFrame/.test(H),
      "비컨·첫 페이지 표시가 부팅 중 레이아웃을 강제하지 않는다", "★send 가 innerWidth 를 읽거나 첫 showPage 가 scrollTop 을 읽는다★");
    const rw = H.slice(H.indexOf("function railWidthVar(){"), H.indexOf("function railGate("));
    chk(/RAIL\.__ro = new ResizeObserver/.test(rw) && /else if \(shown\) w = Math\.round\(RAIL\.el\.getBoundingClientRect/.test(rw),
      "레일 폭: ResizeObserver(없는 브라우저만 직접 잼)", "★레일 폭을 부팅 중 직접 잰다★");
  }
  // [V33.551] /api/chart: 사본(일봉 6h·분봉 5m) 먼저 + 뒤에서 새로 · 네이버 요청 6초 상한(005930.KS 30초 시간초과)
  {
    const ca = SRC.indexOf('if (path === "/api/chart") {'), cf = ca > 0 ? SRC.slice(ca, SRC.indexOf("// === [V58 신규] 경제지표 캘린더", ca)) : "";
    chk(/const __stale = intraday \? 5 \* 60 \* 1000 : 6 \* 3600 \* 1000/.test(cf) && /__chartInflight/.test(cf) && (cf.match(/headers: naverHdr, signal: AbortSignal\.timeout\(6000\)/g) || []).length === 2 && !/headers: naverHdr \}/.test(cf),
      "차트: 묵은 사본 먼저(뒤에서 새로 · 키당 하나) · 네이버 요청 6초 상한", "★차트가 외부 응답을 기다린다★");
  }
  const sa = SRC.indexOf("const FRESH_MS = 12000, USABLE_MS = 150000;"), sb = SRC.indexOf("[V12.126] ★500 에러 방지★", sa);
  const st = sa > 0 && sb > sa ? SRC.slice(sa, sb) : "";
  chk(st && ["l1", "l1s", "l2", "r2", "build"].every((l) => st.includes('"x-lux-c": "' + l + '"')),
    "/api/state 도 층마다 x-lux-c 를 단다", "/api/state 층 표시 누락");
  chk(/node tools\/probe-api-speed\.mjs/.test(readFileSync(new URL("../.github/workflows/ui-probe.yml", import.meta.url), "utf8")),
    "운영 점검(speed)이 API 별 속도·동시 접속을 잰다", "probe-api-speed 가 운영 점검에 없다");
}
if (fails) { console.log("\n✗ 로딩 속도 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 로딩 속도 계약 통과");
