// [V33.190] 남용 방어 · 다중 사용자 계약.
//
//   ★왜 손댔나★ 이 워커에는 요청 한도가 하나도 없었고, 가장 비싼 조회(/api/ai/selfcheck,
//   실측 5,976ms)는 캐시조차 없었다. 즉 새로고침 연타 한 번이 6초짜리 D1 작업을 그대로
//   만들어 냈다. D1 은 SQLite 한 인스턴스라 ★거래 사이클과 같은 큐★ 를 쓴다 —
//   화면이 느려지는 문제가 아니라 매매가 밀리는 문제다.
//
//   이 게이트가 지키는 것:
//     ① 한도가 라우팅보다 먼저 있는가(늦게 있으면 이미 D1 을 친 뒤다)
//     ② 프리플라이트(OPTIONS)를 한도에 넣지 않는가 — 브라우저가 자동으로 보내는 요청이다
//     ③ 한도기가 ★저장소를 안 쓰는가★ — 요청마다 D1 에 카운터를 쓰는 한도기는 그 자체가 공격 도구다
//     ④ 정상 사용자는 안 걸리고 폭주는 걸리는가(둘 다 모의로 확인 — 숫자를 눈대중하지 않는다)
//     ⑤ 비밀키 비교가 상수시간이고 실패가 별도로 세어지는가
//     ⑥ 캐시 콜드 경로가 단일비행인가 — 동시 접속에서 같은 것을 N번 만들지 않는가
//     ⑦ 가장 비싼 조회들이 캐시를 지나는가
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

// ── ① 순서: OPTIONS → 한도 → 라우팅 ────────────────────────────────────────
{
  const iOpt = code.indexOf('request.method === "OPTIONS"');
  const iRl = code.indexOf("const _rl = rateLimit(request, path, cors)");
  const iRoute = code.indexOf('if (path === "/api/ml-status")');
  chk(iOpt > 0 && iRl > iOpt, "프리플라이트(OPTIONS)는 한도 검사 앞에서 끝난다",
    "OPTIONS 가 한도 검사를 지난다 — 브라우저 자동 요청이 사용자 예산을 태운다");
  chk(iRl > 0 && iRoute > iRl, "한도 검사가 라우팅보다 먼저다 — 걸리면 D1 을 한 번도 안 친다",
    "한도 검사가 라우팅 뒤에 있다 — 이미 D1 을 친 뒤라 방어가 되지 않는다");
}

// ── ② 한도기가 저장소를 쓰지 않는가 ────────────────────────────────────────
{
  const i = src.indexOf("function rateLimit(request, path, cors) {");
  const j = src.indexOf("\n}", i);
  const body = src.slice(i, j);
  chk(i > 0 && !/await|env\.DB|getState|setState|prepare\(/.test(body),
    "한도기는 await·D1 을 쓰지 않는다(메모리 카운터) — 방어 자체가 부하를 만들지 않는다",
    "한도기가 저장소나 await 를 쓴다 — 요청마다 D1 을 치는 한도기는 그 자체가 공격 도구가 된다");
  chk(/maxKeys/.test(body), "IP 맵에 상한이 있다 — IP 를 바꿔가며 메모리를 부풀릴 수 없다",
    "IP 맵 상한이 없다 — 무작위 IP 로 맵을 키워 아이솔레이트 메모리를 태울 수 있다");
}

// ── ③~④ 실제로 돌려 본다 ──────────────────────────────────────────────────
const i0 = src.indexOf("const RATELIM = {");
const i1 = src.indexOf("async function handleRequest(");
const mod = src.slice(i0, i1);
const ctx = vm.createContext({ Math, Number, Map, Date, String, JSON, isFinite, Response, console });
new vm.Script(`
function _num(v,d){var n=Number(v);return isFinite(n)?n:d;}
${mod}
this.rateLimit=rateLimit; this.rateLimitAuthFail=rateLimitAuthFail; this._safeEq=_safeEq; this.RATELIM=RATELIM;
`).runInContext(ctx);
const { rateLimit, rateLimitAuthFail, _safeEq, RATELIM } = ctx;

const req = (path, ip, method) => ({
  method: method || "GET",
  headers: { get: (h) => (String(h).toLowerCase() === "cf-connecting-ip" ? ip : null) }
});
const CORS = { "Access-Control-Allow-Origin": "*" };
// 대시보드 부팅 1회가 실제로 치는 것들(스냅샷 sources + 프론트 부팅 경로에서 뽑았다)
const BOOT = ["/api/state", "/api/ml-status", "/api/ai-mode", "/api/selfcheck", "/api/ai/selfcheck",
  "/api/pipeline", "/api/indices", "/api/heatmap", "/api/events", "/api/ai-picks",
  "/api/commodities", "/api/trades?limit=50", "/api/audit", "/api/quotes", "/api/positions",
  "/api/news", "/api/cfg", "/api/logs"];
{
  ctx.globalThis && (ctx.globalThis.__rl = null);
  let blocked = 0;
  for (const p of BOOT) if (rateLimit(req(p, "1.1.1.1"), p.split("?")[0], CORS)) blocked++;
  chk(blocked === 0, `대시보드 부팅 1회(무거운 조회 포함 ${BOOT.length}건)는 한 건도 안 막힌다`,
    `정상 부팅에서 ${blocked}건이 429 다 — 사용자가 자기 대시보드에서 막힌다`);
  // 같은 IP 뒤의 여러 사람(CGNAT) — 부팅 8회가 한 창에 겹쳐도 통과해야 한다
  let blocked2 = 0;
  for (let u = 0; u < 7; u++) for (const p of BOOT) if (rateLimit(req(p, "1.1.1.1"), p.split("?")[0], CORS)) blocked2++;
  chk(blocked2 === 0, "같은 IP(CGNAT) 뒤에서 부팅 8회가 겹쳐도 안 막힌다",
    `CGNAT 8인 동시 접속에서 ${blocked2}건이 막힌다 — 이동통신 사용자가 서로를 막는다`);
}
{
  // 폭주는 반드시 막힌다
  ctx.globalThis && (ctx.globalThis.__rl = null);
  let blocked = 0, n = 400;
  for (let i = 0; i < n; i++) if (rateLimit(req("/api/ai/selfcheck", "9.9.9.9"), "/api/ai/selfcheck", CORS)) blocked++;
  chk(blocked > n * 0.5, `무거운 조회 ${n}연타 중 ${blocked}건이 429 로 끊긴다`,
    `폭주 ${n}건 중 ${blocked}건만 막힌다 — 한도가 사실상 없는 것과 같다`);
  // 한 IP 의 폭주가 다른 IP 를 막으면 안 된다(연대책임 금지)
  const other = rateLimit(req("/api/state", "8.8.8.8"), "/api/state", CORS);
  chk(!other, "한 IP 의 폭주가 다른 IP 를 막지 않는다",
    "다른 IP 까지 막힌다 — 공격자 하나가 전체 사용자를 끊을 수 있다");
}
{
  // 인증 실패 버킷 — 키 추측이 훨씬 빨리 끊긴다
  ctx.globalThis && (ctx.globalThis.__rl = null, ctx.globalThis.__rlAuth = null);
  const r = req("/api/ai/train-now", "7.7.7.7", "POST");
  for (let i = 0; i < RATELIM.authFailBudget; i++) rateLimitAuthFail(r);
  const out = rateLimit(r, "/api/ai/train-now", CORS);
  chk(!!out && out.status === 429, `키 실패 ${RATELIM.authFailBudget}회면 그 IP 는 잠긴다(429)`,
    "키를 반복해서 틀려도 계속 시도할 수 있다 — 추측 공격이 열려 있다");
}
{
  chk(_safeEq("abc", "abc") && !_safeEq("abc", "abd") && !_safeEq("abc", "abcd"),
    "상수시간 비교가 값·길이 차이를 정확히 가른다",
    "_safeEq 가 틀린 판정을 한다");
  chk(/if \(!_safeEq\(got, want\)\) \{\s*\n\s*rateLimitAuthFail\(request\);/.test(src),
    "TRAIN_KEY 비교가 상수시간이고, 실패는 곧바로 세어진다",
    "TRAIN_KEY 비교가 상수시간이 아니거나 실패가 안 세어진다");
}

// ── ⑤ 캐시 콜드 경로 단일비행 ──────────────────────────────────────────────
{
  const i = src.indexOf("const swrJson = async function (key, freshMs, staleMs, build) {");
  const j = src.indexOf("\n  };", i);
  const swr = src.slice(i, j + 4);
  chk(/const fk = "__f_" \+ key;/.test(swr) && /store\[fk\] = Promise\.resolve\(\)\.then\(build\)/.test(swr),
    "콜드 빌드가 단일비행이다 — 동시 접속이 같은 것을 여러 번 만들지 않는다",
    "콜드 경로에 단일비행 잠금이 없다 — 사용자 N명이 동시에 들어오면 D1 을 N번 친다");
  // 실제로 한 번만 부르는지 돌려서 확인한다
  const c2 = vm.createContext({ Promise, Date, JSON, Response, Request, Math, Number, console, setTimeout });
  c2.caches = { default: { match: async () => null, put: async () => {} } };
  c2._BUILD_VER = "TEST";
  c2.cors = {};
  c2.ctx = null;
  new vm.Script(`
    function _num(v,d){var n=Number(v);return isFinite(n)?n:d;}
    globalThis.__swr = {};
    var builds = 0;
    ${swr}
    this.run = async function(n){
      builds = 0;
      var ps = [];
      for (var i=0;i<n;i++) ps.push(swrJson("k", 1000, 5000, async function(){ builds++; await new Promise(function(r){setTimeout(r,5);}); return {v:1}; }));
      await Promise.all(ps);
      return builds;
    };
  `).runInContext(c2);
  const built = await c2.run(20);
  chk(built === 1, `콜드 아이솔레이트에 동시 20건이 들어와도 빌드는 ${built}회뿐이다`,
    `동시 20건에 빌드가 ${built}회 돈다 — 사용자가 늘수록 D1 부하가 그대로 곱해진다`);
}

// ── ⑥ 가장 비싼 조회가 캐시를 지나는가 ─────────────────────────────────────
{
  chk(/swrJson\("ai-selfcheck", \d+, \d+/.test(code),
    "/api/ai/selfcheck 가 캐시를 지난다 — 실측 5,976ms 짜리를 요청마다 새로 만들지 않는다",
    "/api/ai/selfcheck 가 아직 캐시 밖이다 — 이 워커에서 가장 비싼 조회다");
  chk(/swrJson\("pipeline", \d+, \d+/.test(code),
    "/api/pipeline 이 캐시를 지난다",
    "/api/pipeline 이 캐시 밖이다 — 사용자 수만큼 D1 을 친다");
  chk(/"cache-control": "public, max-age=" \+ _br/.test(src),
    "캐시 응답이 브라우저에도 신선도를 알려준다(반복 왕복 감소)",
    "응답에 cache-control 이 없다 — 화면이 같은 값을 계속 다시 물어본다");
}

// ── ⑦ [V33.193] 상태를 바꾸는 요청에 문이 있는가 (CSRF) ────────────────────
//   실측: POST 36개 중 TRAIN_KEY 를 요구하는 것은 10개뿐이고, 나머지 26개에는 아무 문이
//   없었다 — /api/reset · /api/cfg · /api/cash/add · /api/close · /api/reset_tickers 포함.
//   거기에 CORS 가 * 였으니, 사용자가 아무 사이트나 보는 동안 그 사이트가 이 워커로
//   JSON POST 를 보내 포트폴리오를 초기화할 수 있었다. 한도(V33.190)는 ★양★ 을 막는 장치라
//   한 번이면 끝나는 공격에는 소용이 없다.
{
  const i = src.indexOf("function mutationGuard(request, url, env) {");
  chk(i > 0, "상태변경 요청에 출처 검사(mutationGuard)가 있다",
    "상태를 바꾸는 요청에 아무 문이 없다 — 남의 사이트가 포트폴리오를 초기화할 수 있다");
  const iRl = code.indexOf("const _rl = rateLimit(request, path, cors)");
  const iMg = code.indexOf("const _mg = mutationGuard(request, url, env)");
  const iRoute = code.indexOf('if (path === "/api/ml-status")');
  chk(iMg > iRl && iRoute > iMg, "출처 검사가 라우팅보다 먼저다 — 통과 못 하면 아무 일도 안 일어난다",
    "출처 검사가 라우팅 뒤에 있다 — 이미 처리한 뒤라 방어가 되지 않는다");

  // 실제로 돌려 본다
  const j = src.indexOf("\n}", i);
  const mod2 = src.slice(i, j + 2);
  const c3 = vm.createContext({ URL, Math, Number, String, console });
  new vm.Script(`
    function _safeEq(a,b){var x=String(a==null?"":a),y=String(b==null?"":b);if(x.length!==y.length)return false;var d=0;for(var i=0;i<x.length;i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0;}
    function rateLimitAuthFail(){}
    ${mod2}
    this.mutationGuard = mutationGuard;
  `).runInContext(c3);
  const mg = c3.mutationGuard;
  const U = new URL("https://ai-trader-app.example.workers.dev/api/reset");
  const mk = (method, hdrs) => ({ method: method, headers: { get: (h) => hdrs[String(h).toLowerCase()] || null } });
  const ENV = { TRAIN_KEY: "s3cret-key-value" };

  chk(mg(mk("GET", {}), U, ENV) === null, "읽기(GET)는 아무 영향이 없다 — 대시보드는 그대로 공개 조회다",
    "GET 까지 막았다 — 화면이 통째로 죽는다");
  chk(mg(mk("POST", { origin: "https://ai-trader-app.example.workers.dev" }), U, ENV) === null,
    "자기 페이지에서 온 POST 는 통과한다(사이트 기능 무영향)",
    "동일 출처 POST 가 막힌다 — 설정 변경·청산 버튼이 전부 죽는다");
  chk(!!mg(mk("POST", { origin: "https://evil.example.com" }), U, ENV),
    "남의 사이트에서 온 POST 는 거절된다(CSRF 차단)",
    "교차 출처 POST 가 통과한다 — 아무 사이트나 포트폴리오를 초기화할 수 있다");
  chk(!!mg(mk("POST", {}), U, ENV),
    "출처가 없는 POST(curl)는 키 없이는 거절된다",
    "출처 없는 POST 가 그냥 통과한다 — 주소만 알면 누구나 초기화할 수 있다");
  /* ★완충장치★ — 이 문을 잘못 닫으면 화면의 모든 버튼이 죽는다. Origin 을 생략하는
     클라이언트(일부 사파리 경로)를 대비해 브라우저만 붙일 수 있는 표식 둘을 더 본다.
     둘 다 '동일 출처' 를 말할 때만 통과이고, curl 은 어느 것도 자동으로 붙이지 않는다. */
  chk(mg(mk("POST", { "sec-fetch-site": "same-origin" }), U, ENV) === null,
    "Sec-Fetch-Site: same-origin 이면 통과한다(브라우저만 붙일 수 있는 금지 헤더)",
    "동일 출처 표식을 무시한다 — Origin 을 생략하는 브라우저에서 버튼이 죽는다");
  chk(!!mg(mk("POST", { "sec-fetch-site": "cross-site" }), U, ENV),
    "Sec-Fetch-Site: cross-site 는 거절된다",
    "교차 출처 표식인데 통과한다");
  chk(mg(mk("POST", { referer: "https://ai-trader-app.example.workers.dev/" }), U, ENV) === null,
    "동일 호스트 Referer 도 통과한다(두 번째 완충장치)",
    "동일 호스트 Referer 를 안 본다");
  chk(!!mg(mk("POST", { referer: "https://evil.example.com/x" }), U, ENV),
    "남의 호스트 Referer 는 거절된다",
    "교차 출처 Referer 가 통과한다");
  // ★Origin 이 교차 출처로 확정되면 완충장치로 새면 안 된다★
  chk(!!mg(mk("POST", { origin: "https://evil.example.com", "sec-fetch-site": "same-origin" }), U, ENV),
    "Origin 이 교차 출처면 다른 표식이 있어도 거절된다(완충장치로 새지 않는다)",
    "교차 출처 Origin 인데 Sec-Fetch-Site 위조로 통과한다 — 완충장치가 구멍이 됐다");
  chk(mg(mk("POST", { "x-train-key": "s3cret-key-value" }), U, ENV) === null,
    "TRAIN_KEY 를 들고 오면 통과한다 — CI·스크립트 경로가 그대로 산다",
    "키를 들고 와도 막힌다 — 워크플로가 전부 깨진다");
  chk(!!mg(mk("POST", { "x-train-key": "wrong-length-x" }), U, ENV),
    "틀린 키는 거절된다",
    "틀린 키가 통과한다");
}

// ── ⑧ [V33.193] 나가는 응답에 보안 헤더가 붙는가 ───────────────────────────
{
  chk(/const SECHDR = \{/.test(src) && /function withSecurityHeaders\(res\)/.test(src),
    "보안 헤더 세트와 적용 함수가 있다",
    "보안 헤더가 없다 — 클릭재킹·MIME 스니핑이 열려 있다");
  for (const h of ["x-content-type-options", "x-frame-options", "referrer-policy",
                   "permissions-policy", "content-security-policy"]) {
    chk(new RegExp('"' + h + '"').test(src), "헤더 " + h + " 를 붙인다", "헤더 " + h + " 가 없다");
  }
  chk(/frame-ancestors 'self'/.test(src) && /object-src 'none'/.test(src),
    "CSP 가 frame-ancestors·object-src 를 잠근다",
    "CSP 에 frame-ancestors/object-src 잠금이 없다");
  // ★출구가 하나여야 한다★ — 정적 자산은 env.ASSETS 가 만들므로 handleRequest 안에서는 못 붙인다.
  chk(/return withSecurityHeaders\(_res\);/.test(src),
    "헤더를 워커의 단일 출구에서 붙인다 — 빠지는 경로가 생기지 않는다",
    "보안 헤더가 일부 경로에만 붙는다 — 정적 문서가 빠질 수 있다");
}

console.log(fails ? "\n남용 방어 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   남용 방어 · 다중 사용자 계약 통과");
process.exit(fails ? 1 : 0);
