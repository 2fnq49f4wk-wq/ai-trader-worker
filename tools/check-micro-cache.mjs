/* [V33.496] ★공용 읽기 API 마이크로 캐시★ — 재방문 때 /api/news 등이 D1 줄서기로 2~9초 걸리던 것(운영 탐침 10/06).
   ① 무엇을 담나: 허용 목록의 GET 만 · force/run/refresh/nocache 우회 · 분봉 차트는 10초 · 일봉 차트 5분
   ② 담고 꺼내기: 200 JSON 만 · 오류·HTML 은 안 담음 · TTL 지나면 안 줌 · 캐시에서 나간 응답은 다시 안 담음 · 상한
   ③ 배선: 꺼내기는 남용 한도·읽기문(viewerGate) ★뒤★ · 담기는 응답 내보내기 전에 복제(본문 소비 전) */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const R = (u, m) => new Request("https://x.dev" + u, { method: m || "GET" });
const T = (u, m) => M._microTtl(R(u, m), new URL("https://x.dev" + u));

console.log("① 무엇을 담나");
chk(T("/api/news") === 60000 && T("/api/shard_meta") === 300000, "허용 목록 GET 은 TTL 이 있다", "TTL " + T("/api/news"));
chk(T("/api/state") === 0 && T("/api/trades?limit=50") === 0 && T("/api/positions") === 0, "상태·거래·포지션은 담지 않는다(자체 캐시 · 사용자 행동에 즉시 반응)", "담으면 안 되는 경로");
chk(T("/api/news", "POST") === 0, "POST 는 담지 않는다", "POST");
chk(T("/api/news?force=1") === 0 && T("/api/fx?run=1") === 0 && T("/api/chart?symbol=A&refresh=1") === 0, "force/run/refresh 는 우회", "우회 실패");
chk(T("/api/chart?symbol=AAPL&interval=1m&range=1d") === 10000 && T("/api/chart?symbol=AAPL&interval=1d&range=1y") === 300000,
  "분봉 차트 10초 · 일봉 5분", "차트 TTL " + T("/api/chart?symbol=AAPL&interval=1m&range=1d"));

console.log("② 담고 꺼내기");
const u1 = "/api/econ?x=" + Date.now();
const r1 = R(u1);
await M.microCachePut(r1, new Response(JSON.stringify({ a: 1 }), { status: 200, headers: { "content-type": "application/json" } }));
const hit = M.microCacheGet(r1, new URL(r1.url));
chk(hit && hit.headers.get("X-Micro-Cache") === "hit" && (await hit.json()).a === 1, "200 JSON 은 담고 다음 요청에 꺼낸다", "적중 실패");
const u2 = "/api/econ?y=" + Date.now();
await M.microCachePut(R(u2), new Response("err", { status: 500, headers: { "content-type": "application/json" } }));
await M.microCachePut(R(u2 + "&h"), new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
chk(!M.microCacheGet(R(u2), new URL("https://x.dev" + u2)) && !M.microCacheGet(R(u2 + "&h"), new URL("https://x.dev" + u2 + "&h")), "오류·HTML 은 담지 않는다", "잘못 담음");
const u3 = "/api/kr-halt?z=" + Date.now();
await M.microCachePut(R(u3), new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
const realNow = Date.now; Date.now = () => realNow() + 16000;
const stale = M.microCacheGet(R(u3), new URL("https://x.dev" + u3));
Date.now = realNow;
chk(!stale, "TTL(kr-halt 15초) 지나면 꺼내지 않는다", "묵은 사본을 줬다");
chk(M.MICRO_CACHE_TTL["/api/chart"] > 0 && /MICRO_CACHE_MAX = 300/.test(S) && /__microCache\.size > MICRO_CACHE_MAX/.test(S), "항목 상한 300", "상한 없음");
chk(/if \(response\.headers\.get\("X-Micro-Cache"\)\) return;/.test(S), "캐시에서 나간 응답은 다시 담지 않는다", "재적재");

console.log("③ 배선");
const hr = S.indexOf("async function handleRequest(request, env, ctx, _inner) {");
const body = S.slice(hr, hr + 6000);
const iRl = body.indexOf("const _rl = rateLimit("), iVg = body.indexOf("const _vg = viewerGate("), iMc = body.indexOf("const _mc = _inner ? null : microCacheGet(request, url);");
chk(iRl > 0 && iVg > iRl && iMc > iVg, "꺼내기는 남용 한도·읽기문 뒤(보안 경로 그대로)", "순서 " + [iRl, iVg, iMc].join(","));
const fe = S.indexOf("async fetch(request, env, ctx) {");
const fb = S.slice(fe, fe + 1500);
const iPut = fb.indexOf("microCachePut(request, _res)"), iSec = fb.indexOf("return withSecurityHeaders(_res);");
chk(iPut > 0 && iSec > iPut, "담기(복제)는 응답을 내보내기 전에 시작한다", "담기 위치 " + [iPut, iSec].join(","));
console.log("④ SWR 층(V33.523) — 실제 fetch 처리기를 느린 가짜 D1(300ms)·가짜 R2 로 부른다");
{
  const MP = new URL("../src/index.js", import.meta.url).href;
  let d1 = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stmt = (q) => ({ bind: () => stmt(q), all: async () => { d1++; await sleep(300); return { results: [] }; },
    first: async () => { d1++; await sleep(300); return /WHERE k/.test(q) ? { v: JSON.stringify({ usdkrw: 1400 }) } : null; }, run: async () => ({}), raw: async () => [] });
  const DB = { prepare: (q) => stmt(q), batch: async (a) => a.map(() => ({ results: [] })), exec: async () => ({}) };
  const _cs = globalThis.caches;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  const store = new Map();
  const R2 = { head: async () => null, put: async (k, v, o) => { store.set(k, { v, md: o.customMetadata }); },
    get: async (k) => { const e = store.get(k); return e ? { customMetadata: e.md, text: async () => e.v } : null; } };
  const env = { DB, MODELS: R2 };
  const call = async (Mx, path) => { const w = []; const t0 = Date.now(); const r = await Mx.default.fetch(new Request("https://x.test" + (path || "/api/fx")), env, { waitUntil: (p) => w.push(p) });
    await r.text(); const ms = Date.now() - t0; await Promise.all(w).catch(() => {}); return { st: r.status, c: r.headers.get("x-lux-c"), ms }; };
  const A = await import(MP + "?swr=a");
  d1 = 0;
  const burst = await Promise.all(Array.from({ length: 24 }, () => call(A)));
  const lay = burst.reduce((m, b) => (m[b.c] = (m[b.c] || 0) + 1, m), {});
  chk(d1 === 1 && lay.build === 1 && lay.join === 23 && burst.every((b) => b.st === 200), "동시 24회 → D1 1번(단일비행) · 나머지 23개는 같이 기다린다", "d1=" + d1 + " " + JSON.stringify(lay));
  d1 = 0; const h = await call(A);
  chk(h.c === "hit" && d1 === 0, "다음 요청은 메모리(hit) · D1 0", JSON.stringify(h) + " d1=" + d1);
  chk([...store.keys()].some((k) => k.startsWith("cache/micro/")), "R2 사본을 남긴다(다른 아이솔레이트가 쓴다)", [...store.keys()].join(","));
  const B = await import(MP + "?swr=b");
  d1 = 0; const b1 = await call(B);
  chk(b1.c === "r2" && d1 === 0, "새 아이솔레이트: R2 사본 · D1 0", JSON.stringify(b1) + " d1=" + d1);
  const C = await import(MP + "?swr=c");
  for (const [, e] of store) e.md = Object.assign({}, e.md, { at: String(Date.now() - 40000) });
  d1 = 0; const c1 = await call(C);
  chk(c1.c === "r2" && c1.ms < 250 && d1 === 1, "TTL 지난 사본: 즉시 주고(" + c1.ms + "ms) 뒤에서 새로 받는다(D1 1)", JSON.stringify(c1) + " d1=" + d1);
  const D = await import(MP + "?swr=d");
  for (const [, e] of store) e.md = Object.assign({}, e.md, { at: String(Date.now() - 7200000) });
  d1 = 0; const d4 = await call(D);
  chk(d4.c === "build" && d1 === 1, "staleMax 넘은 사본은 안 준다 — 직접 받는다", JSON.stringify(d4));
  const f = await call(D, "/api/fx?force=1");
  chk(f.c === null, "force 가 붙으면 캐시 층을 안 탄다", JSON.stringify(f));
  globalThis.caches = _cs;
}
chk(/if \(!_inner && _microTtl\(request, url\)\) \{\n    return await microSwr\(request, url, ctx, function \(\) \{ return handleRequest\(request, env, ctx, true\); \}\);/.test(S) &&
    S.indexOf("if (!_inner && _microTtl(request, url))") > S.indexOf("const _vg = viewerGate("),
  "SWR 층은 한도·읽기문 뒤 · 안쪽 호출은 한도를 두 번 세지 않는다", "배선");
console.log("⑤ 전수 대조(V33.526) — 화면이 부르는 /api/* GET 은 전부 캐시 층(swrJson·SWR 마이크로·자체 사본)을 탄다");
{
  const { readdirSync } = await import("node:fs");
  const pub = new URL("../public/", import.meta.url);
  let fe = "";
  for (const f of readdirSync(pub)) if (/\.(html|js)$/.test(f)) fe += readFileSync(new URL(f, pub), "utf8");
  const eps = [...new Set(fe.match(/\/api\/[a-zA-Z0-9\/_-]+/g) || [])];
  const mcSrc = (S.match(/const MICRO_CACHE_TTL = \{[\s\S]*?\};/) || [""])[0];
  /* 일부러 캐시하지 않는 것 — 이유를 같이 적는다 */
  const ALLOW = { "/api/cfg": "설정 — 바꾼 즉시 보여야 한다", "/api/build": "판 확인 — no-store 한 줄(D1 없음)", "/api/client-perf": "기기 기록(POST 위주)",
    "/api/state": "자체 L1/L2/R2 + 크론 사본", "/api/omni-structure": "자체 R2 사본(6시간)" };
  const miss = [];
  for (const e of eps) {
    const i = S.indexOf('path === "' + e + '"');
    if (i < 0) continue;                               // 접두 라우트·폐지 경로는 이 대조 밖
    const seg = S.slice(i, i + 2500);
    if (/swrJson\(/.test(seg) || mcSrc.includes('"' + e + '"') || /request\.method === "POST"/.test(seg.slice(0, 120)) || ALLOW[e]) continue;
    miss.push(e);
  }
  chk(miss.length === 0, "캐시 층 없는 화면 GET 0개(대조 " + eps.length + "경로)", "캐시 없음: " + miss.join(", "));
}
if (fails) { console.log("\n✗ 마이크로 캐시 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 마이크로 캐시 계약 통과");
