/* [V33.375] 읽기 문(viewer gate) 계약 — ★실제로 요청을 물려 본다.★
 *
 *   ★왜 필요한가★ 2026-09-16 저장소를 공개로 돌렸다. mutationGuard(V33.193)는 쓰기만 막고,
 *   그 주석 자체가 "읽기(GET)에는 아무 영향이 없다" 라고 적고 있다. 주소를 아는 사람은
 *   보유종목·현금·체결이력을 그대로 읽을 수 있었다. 그래서 읽기 문을 달았다.
 *
 *   ★그런데 이 문은 사용자를 자기 화면에서 잠글 수 있는 종류의 코드다.★ 사용자는 폰에서만
 *   접속하고 로컬 복구 수단이 없다. 그래서 이 검사가 지키는 제1 불변식은 "잘 막느냐" 가
 *   아니라 ★VIEW_KEY 가 없으면 아무 일도 안 하느냐★ 다. 그 줄이 탈출구다.
 *
 *   문자열을 찾지 않는다 — Request 를 만들어 viewerGate 에 물리고 ★응답★ 을 본다.
 */
import { viewerGate, VIEWGATE, _cookieVal, _corsFor, mutationGuard, SECHDR } from "../src/index.js";
import { readFileSync } from "node:fs";
import vm from "node:vm";
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fails++; console.error("  ✗ FAIL " + m); } };

const HOST = "lux.example.workers.dev";
const KEY = "view-secret-0123456789";
const TKEY = "train-secret-9876543210";
const ENV_ON = { VIEW_KEY: KEY, TRAIN_KEY: TKEY };
const ENV_OFF = { TRAIN_KEY: TKEY };
const HTML = { accept: "text/html,application/xhtml+xml" };

function call(env, path, headers = {}, method = "GET") {
  const u = new URL("https://" + HOST + path);
  const req = new Request(u.toString(), { method, headers });
  return viewerGate(req, u, env);
}

// ── ① ★탈출구★ — VIEW_KEY 가 없으면 이 문은 존재하지 않는다 ──────────────────
{
  const paths = ["/", "/api/state", "/api/trades", "/api/ai-positions", "/api/download/ml", "/api/logs"];
  let allNull = true;
  for (const p of paths) {
    if (call(ENV_OFF, p, HTML) !== null) allNull = false;
    if (call(ENV_OFF, p, {}) !== null) allNull = false;
    if (call({}, p, HTML) !== null) allNull = false;
    if (call(undefined, p, HTML) !== null) allNull = false;
  }
  ok(allNull, "★VIEW_KEY 미설정이면 전 경로가 그대로 열린다★ — 배포해도 오늘과 같다(폰에서 잠기지 않는다)");
  ok(call({ VIEW_KEY: "" }, "/api/state", HTML) === null, "빈 문자열 VIEW_KEY 도 '미설정' 으로 읽는다(시크릿을 지우는 중간 상태)");
}

// ── ② 켜면 실제로 막는가 ───────────────────────────────────────────────────
{
  const r = call(ENV_ON, "/api/state", {});
  ok(r instanceof Response && r.status === 401, "키 없는 API 읽기를 401 로 막는다");
  const h = call(ENV_ON, "/", HTML);
  ok(h instanceof Response && h.status === 401, "키 없는 문서 요청도 막는다");
  ok(h && /text\/html/.test(h.headers.get("content-type") || ""), "문서에는 화면을, API 에는 JSON 을 준다");
  ok(r && /application\/json/.test(r.headers.get("content-type") || ""), "API 거절은 JSON 이다(화면이 HTML 을 파싱하려다 죽지 않는다)");
  ok(h && (h.headers.get("cache-control") || "").includes("no-store"), "거절을 캐시에 남기지 않는다");
}

// ── ③ 거절이 시스템 내부를 말하지 않는가 ────────────────────────────────────
{
  /* ★본문을 실제로 읽는다.★ 첫 판은 String(r.body) 로 봤는데 그건 스트림의 이름표라
     무엇을 넣어도 통과했다 — 돌연변이 시험에서 실제로 안 잡혔다. */
  const bodies = [];
  for (const [p, hd] of [["/", HTML], ["/api/state", {}]]) {
    const r = call(ENV_ON, p, hd);
    bodies.push(r ? await r.clone().text() : "");
  }
  ok(bodies.every((b) => b.length > 0), "거절 응답에 본문이 있다(빈 응답이면 아래 검사가 헛돈다)");
  const txt = JSON.stringify(bodies);
  ok(!/V\d+\.\d+/.test(txt) && !txt.includes(KEY) && !txt.includes(TKEY) && !/lux_view|X-View-Key/i.test(txt),
     "거절 화면이 판 번호도·키도·문의 이름도 말하지 않는다");
}

// ── ④ 키를 들고 오면 통과하는가 — 세 가지 길 전부 ──────────────────────────
{
  ok(call(ENV_ON, "/api/state", { "x-view-key": KEY }) === null, "헤더(X-View-Key)로 통과한다");
  ok(call(ENV_ON, "/api/state", { "x-train-key": TKEY }) === null, "★TRAIN_KEY 로도 통과한다★ — CI 진단 워크플로가 이 길로 읽는다");
  ok(call(ENV_ON, "/api/state", { "x-view-key": TKEY }) === null, "관리자 키는 어느 헤더로 와도 읽을 수 있다");
  ok(call(ENV_ON, "/api/state?k=" + KEY, {}) === null, "질의문자열(?k=)로 통과한다 — API 는 되돌려보내지 않는다");
  ok(call(ENV_ON, "/api/state", { cookie: "a=1; " + VIEWGATE.cookie + "=" + KEY + "; b=2" }) === null, "쿠키로 통과한다(두 번째부터 키가 필요 없다)");
  ok(call(ENV_ON, "/api/state", { cookie: VIEWGATE.cookie + "=" + encodeURIComponent(KEY) }) === null, "쿠키 값이 URL 인코딩돼 있어도 읽는다");
}

// ── ⑤ 틀린 키는 통과하지 못하는가 ──────────────────────────────────────────
{
  const bad = ["", " ", KEY + "x", KEY.slice(0, -1), KEY.toUpperCase(), "undefined", "null"];
  let blocked = true;
  for (const b of bad) {
    if (call(ENV_ON, "/api/state", { "x-view-key": b }) === null) blocked = false;
    if (call(ENV_ON, "/api/state", { cookie: VIEWGATE.cookie + "=" + b }) === null) blocked = false;
  }
  ok(blocked, `틀린 키 ${bad.length}종이 전부 막힌다(접두사·대소문자·빈 값 포함)`);
  ok(call(ENV_ON, "/api/state", { cookie: "lux_viewX=" + KEY }) === null ? false : true,
     "이름이 다른 쿠키를 우리 쿠키로 읽지 않는다");
}

// ── ⑥ 문서로 들어오면 쿠키를 심고 주소에서 키를 지우는가 ────────────────────
{
  const r = call(ENV_ON, "/?k=" + KEY + "&tab=ai", Object.assign({}, HTML, { "sec-fetch-mode": "navigate" }));
  ok(r instanceof Response && r.status === 302, "주소창으로 키를 들고 오면 되돌려보낸다");
  const loc = r ? r.headers.get("location") || "" : "";
  ok(!loc.includes(KEY) && !/[?&]k=/.test(loc), "★되돌려보낼 주소에 키가 없다★ — 어깨너머·기록에 안 남는다");
  ok(loc.includes("tab=ai"), "다른 질의문자열은 지우지 않는다(딥링크가 살아 있다)");
  const sc = r ? r.headers.get("set-cookie") || "" : "";
  ok(sc.startsWith(VIEWGATE.cookie + "="), "쿠키를 심는다");
  for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) {
    ok(sc.includes(attr), `쿠키에 ${attr} 가 있다`);
  }
  ok(/Max-Age=(\d+)/.test(sc) && Number(/Max-Age=(\d+)/.exec(sc)[1]) >= 60 * 60 * 24 * 30,
     "쿠키가 최소 30일은 산다 — 폰에서 매번 키를 치지 않는다");
  // API 가 ?k= 로 오면 302 가 아니라 통과여야 한다(fetch 가 리다이렉트를 따라가 이상해진다)
  ok(call(ENV_ON, "/api/state?k=" + KEY, {}) === null, "API 호출은 302 로 돌리지 않는다");
}

// ── ⑦ 쓰기 문(mutationGuard)을 대신하지 않는가 ─────────────────────────────
{
  /* 읽기 문을 달았다고 쓰기 문이 느슨해지면 안 된다. 키가 없는 상태(= 오늘)에서
     교차 출처 POST 가 여전히 막히는지 본다 — 이 검사가 그 회귀도 같이 잡는다. */
  const u = new URL("https://" + HOST + "/api/reset");
  const req = new Request(u.toString(), { method: "POST", headers: { origin: "https://evil.example.com" } });
  ok(typeof mutationGuard(req, u, ENV_OFF) === "string", "VIEW_KEY 가 없어도 교차 출처 쓰기는 그대로 막힌다");
}

// ── ⑧ 크롤러에게 명시적으로 말하는가 ───────────────────────────────────────
{
  const xr = SECHDR["x-robots-tag"] || "";
  ok(/noindex/.test(xr) && /nofollow/.test(xr), "모든 응답에 X-Robots-Tag: noindex 가 붙는다");
  ok(!("access-control-allow-origin" in SECHDR), "보안 헤더 표가 ACAO 를 되살리지 않는다");
}

// ── ⑨ 쿠키 파서가 실제로 동작하는가 ────────────────────────────────────────
{
  const mk = (c) => new Request("https://" + HOST + "/", { headers: c ? { cookie: c } : {} });
  ok(_cookieVal(mk("x=1; lux_view=abc; y=2"), "lux_view") === "abc", "가운데 쿠키를 읽는다");
  ok(_cookieVal(mk("lux_view=abc"), "lux_view") === "abc", "하나뿐인 쿠키를 읽는다");
  ok(_cookieVal(mk("lux_view2=abc"), "lux_view") === "", "접두사가 같은 다른 쿠키를 안 읽는다");
  ok(_cookieVal(mk(""), "lux_view") === "", "쿠키가 없어도 던지지 않는다");
  ok(_cookieVal(mk("badcookie"), "lux_view") === "", "= 가 없는 조각에도 안 죽는다");
}

// ── ⑩ CORS 가 아무 사이트에나 응답 본문을 넘기지 않는가 ────────────────────
{
  const u = new URL("https://" + HOST + "/api/state");
  const mk = (org) => new Request(u.toString(), { headers: org ? { origin: org } : {} });
  const same = _corsFor(mk("https://" + HOST), u);
  const evil = _corsFor(mk("https://evil.example.com"), u);
  const none = _corsFor(mk(""), u);
  ok(same["Access-Control-Allow-Origin"] === "https://" + HOST, "자기 출처에는 ACAO 를 준다(대시보드가 그대로 돈다)");
  ok(!("Access-Control-Allow-Origin" in evil),
     "★남의 사이트에는 ACAO 를 안 준다★ — 그 페이지의 스크립트가 /api/state 본문을 못 가져간다");
  ok(!("Access-Control-Allow-Origin" in none), "Origin 없는 요청(curl)에도 ACAO 를 뿌리지 않는다 — curl 은 어차피 CORS 와 무관하다");
  ok((same["Vary"] || "").includes("Origin"), "Vary: Origin 이 있다 — 캐시가 출처를 섞어 내보내지 않는다");
  ok(Object.values(same).every((v) => v !== "*") && Object.values(evil).every((v) => v !== "*"),
     "어느 경우에도 '*' 를 돌려주지 않는다");
}

// ── ⑪ 거절이 ★세어지는가★ — 키 추측을 반복하면 잠기는가 ────────────────────
{
  /* 실행해서 본다. rateLimitAuthFail 호출이 빠져도 응답은 똑같이 401 이라,
     응답만 보는 검사는 그 누락을 영원히 못 본다(이 저장소가 여러 번 겪은 모양이다). */
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const i0 = src.indexOf("const RATELIM = {");
  const i1 = src.indexOf("async function handleRequest(");
  const ctx = vm.createContext({ Math, Number, Map, Date, String, JSON, isFinite, Response, Request, Headers, URL, console, decodeURIComponent, encodeURIComponent, Object });
  new vm.Script(`
function _num(v,d){var n=Number(v);return isFinite(n)?n:d;}
${src.slice(i0, i1)}
this.rateLimit=rateLimit; this.viewerGate=viewerGate; this.RATELIM=RATELIM;
`).runInContext(ctx);
  ctx.globalThis && (ctx.globalThis.__rl = null, ctx.globalThis.__rlAuth = null);
  const u = new URL("https://" + HOST + "/api/state");
  for (let i = 0; i < ctx.RATELIM.authFailBudget; i++) {
    ctx.viewerGate(new Request(u.toString(), { headers: { "x-view-key": "wrong" + i, "cf-connecting-ip": "9.9.9.9" } }), u, ENV_ON);
  }
  const after = ctx.rateLimit({ method: "GET", headers: { get: (h) => (String(h).toLowerCase() === "cf-connecting-ip" ? "9.9.9.9" : null) } }, "/api/state", {});
  ok(!!after && after.status === 429,
     `★키를 ${ctx.RATELIM.authFailBudget}번 틀리면 그 IP 가 잠긴다★ — 거절이 세어지지 않으면 무한히 찍어볼 수 있다`);
  ctx.globalThis && (ctx.globalThis.__rl = null, ctx.globalThis.__rlAuth = null);
  ctx.viewerGate(new Request(u.toString(), { headers: { "x-view-key": KEY, "cf-connecting-ip": "8.8.8.8" } }), u, ENV_ON);
  const okPath = ctx.rateLimit({ method: "GET", headers: { get: (h) => (String(h).toLowerCase() === "cf-connecting-ip" ? "8.8.8.8" : null) } }, "/api/state", {});
  ok(!okPath, "맞는 키로 들어온 요청은 실패로 세지 않는다(정상 사용자가 스스로 잠기지 않는다)");
}

if (fails) { console.error(`\n✗ 읽기 문 계약 ${fails}건 실패 (총 ${n})`); process.exit(1); }
console.log(`\n✓ 읽기 문 계약 통과 (${n}개 단언) — 켜면 막고, ★안 켜면 아무 일도 안 한다★`);
