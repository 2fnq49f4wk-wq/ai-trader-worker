/* [V33.534] ★크론 CPU 를 로컬에서 진짜로 잰다★ (배포 게이트 아님 · 수동 실행)
 * 왜: 워커 안의 Date.now() 는 순수 계산 중엔 멈춘다(Cloudflare 스펙터 완화) — 단계 프로파일(_cronProf)은
 *   I/O 대기만 재고 CPU 는 못 본다(10/08 실측: 단계 합 16,130s vs Cloudflare CPU ~740s).
 *   그래서 실제 워커 코드를 Node 에서 돌리고 V8 CPU 프로파일로 '어느 함수가 CPU 를 먹나' 를 본다.
 * 구성: D1 = node:sqlite 어댑터 · R2 = 메모리 · 네트워크 = 모의(네이버 실시간 시세는 합성값, 나머지 404)
 *   · 일봉 = 종목마다 합성 320봉(운영과 같은 길이·스키마) · 시각 = 지정한 UTC 로 고정 이동.
 * [V33.538] --prod <dir>: tools/prod-state-dump.mjs 가 ★읽기만★ 해서 뜬 운영 state·보유·거래로 돈다(모델·설정 그대로) — 시각은 지금,
 *   R2 대형 모델은 CLOUDFLARE_API_TOKEN 이 있으면 Cloudflare API 로 읽는다(읽기 전용). 쓰기는 전부 로컬(sqlite·메모리)에만.
 * 사용법: node --cpu-prof --cpu-prof-dir=<dir> tools/cron-cpu-bench.mjs [--at 2026-10-08T02:00:00Z] [--cycles 3]
 *   출력: 사이클마다 걸린 시간 + 마지막에 자기시간(self) 상위 함수. 프로파일 파일은 --cpu-prof-dir 에. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const PROD = arg("prod", "");
const AT = Date.parse(arg("at", PROD ? new Date().toISOString() : "2026-10-08T02:00:00Z"));
const CYCLES = +arg("cycles", 3);
const PROF_FROM = +arg("prof-from", -1);   // 이 사이클부터 V8 CPU 프로파일(준비 사이클 제외)
const PROF_OUT = arg("prof-out", "");

// ── 시각 이동(진행은 실제 시계를 따른다) ──
const RealDate = Date, SHIFT = AT - RealDate.now();
class FDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + SHIFT); else super(...a); }
  static now() { return RealDate.now() + SHIFT; }
}
globalThis.Date = FDate;

// ── D1 어댑터 ──
const sql = new DatabaseSync(":memory:");
// 운영 D1 의 기본 표(워커 밖에서 처음 만든 것) — 나머지는 워커의 ensureSchema 가 만든다
sql.exec("CREATE TABLE state (k TEXT PRIMARY KEY, v TEXT, updated_ts INTEGER);" +
  "CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, level TEXT, symbol TEXT, message TEXT);" +
  "CREATE TABLE positions (symbol TEXT NOT NULL, strategy TEXT NOT NULL DEFAULT 'swing', market TEXT NOT NULL, qty REAL NOT NULL, avg_price REAL NOT NULL, opened_ts INTEGER NOT NULL, meta TEXT, PRIMARY KEY(symbol, strategy, market));" +
  "CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, market TEXT, symbol TEXT, side TEXT, qty REAL, price REAL, pnl REAL, pnl_pct REAL, reason TEXT);");
if (PROD) {   // 운영 상태 적재 — 운영 표에 로컬보다 많은 칸이 있으면 칸을 더한다
  const addCols = (t, row) => { const have = new Set(sql.prepare("PRAGMA table_info(" + t + ")").all().map((c) => c.name));
    for (const k of Object.keys(row)) if (!have.has(k)) sql.exec("ALTER TABLE " + t + " ADD COLUMN " + k); };
  const load = (t, rows) => { if (!rows.length) return; for (const r of rows.slice(0, 50)) addCols(t, r);
    sql.exec("BEGIN"); for (const r of rows) { const ks = Object.keys(r); sql.prepare("INSERT OR REPLACE INTO " + t + " (" + ks.join(",") + ") VALUES (" + ks.map(() => "?").join(",") + ")").run(...ks.map((k) => r[k])); } sql.exec("COMMIT"); };
  load("state", readFileSync(PROD + "/state.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  load("positions", JSON.parse(readFileSync(PROD + "/positions.json", "utf8")));
  load("trades", JSON.parse(readFileSync(PROD + "/trades.json", "utf8")));
}
const stCache = new Map();
const prep = (q) => { let s = stCache.get(q); if (!s) { s = sql.prepare(q); stCache.set(q, s); } return s; };
const conv = (a) => a.map((v) => v === undefined ? null : (typeof v === "boolean" ? (v ? 1 : 0) : v));
let d1Calls = 0;
function stmt(q, args) {
  return {
    bind: (...a) => stmt(q, conv(a)),
    all: async () => { d1Calls++; return { results: prep(q).all(...args), success: true, meta: {} }; },
    first: async (col) => { d1Calls++; const r = prep(q).get(...args); return r ? (col ? r[col] : r) : null; },
    run: async () => { d1Calls++; const r = prep(q).run(...args); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
    raw: async () => { d1Calls++; return prep(q).all(...args).map((o) => Object.values(o)); },
    _sync: () => { const s = prep(q); return s.reader ? { results: s.all(...args), success: true } : { success: true, meta: { changes: s.run(...args).changes } }; },
  };
}
const DB = {
  prepare: (q) => stmt(q, []),
  batch: async (ss) => { d1Calls++; return ss.map((s) => s._sync()); },
  exec: async (q) => { sql.exec(q); return { count: 1 }; },
};

// ── R2 ──
const r2 = new Map();
const obj = (k, v) => ({ key: k, size: v.length, uploaded: new RealDate(), httpMetadata: {}, customMetadata: {},
  text: async () => Buffer.from(v).toString("utf8"), json: async () => JSON.parse(Buffer.from(v).toString("utf8")),
  arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength),
  get body() { return new Response(v).body; } });
const toBuf = async (v) => typeof v === "string" ? Buffer.from(v) : (v instanceof ArrayBuffer ? Buffer.from(v) : (ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : Buffer.from(await new Response(v).arrayBuffer())));
const realFetch = globalThis.fetch;
const r2Remote = async (k) => {   // [V33.538] 운영 R2 읽기 전용(필요한 키만 · 한 번만)
  if (!PROD || r2.has(k) || r2Miss.has(k) || !process.env.CLOUDFLARE_API_TOKEN) return;
  try { const r = await realFetch("https://api.cloudflare.com/client/v4/accounts/" + process.env.CLOUDFLARE_ACCOUNT_ID + "/r2/buckets/ai-trader-models/objects/" + encodeURIComponent(k),
      { headers: { Authorization: "Bearer " + process.env.CLOUDFLARE_API_TOKEN } });
    if (r.ok) { r2.set(k, Buffer.from(await r.arrayBuffer())); r2Got++; } else r2Miss.add(k); } catch (e) { r2Miss.add(k); }
};
const r2Miss = new Set(); let r2Got = 0;
const MODELS = {
  get: async (k) => { await r2Remote(k); return r2.has(k) ? obj(k, r2.get(k)) : null; },
  head: async (k) => { await r2Remote(k); return r2.has(k) ? obj(k, r2.get(k)) : null; },
  put: async (k, v) => { r2.set(k, await toBuf(v)); return obj(k, r2.get(k)); },
  delete: async (k) => { for (const x of [].concat(k)) r2.delete(x); },
  list: async (o) => { const p = (o && o.prefix) || ""; const ks = [...r2.keys()].filter((k) => k.startsWith(p)).sort().slice(0, (o && o.limit) || 1000);
    return { objects: ks.map((k) => obj(k, r2.get(k))), truncated: false, delimitedPrefixes: [] }; },
};

// ── 유니버스 · 합성 시세/일봉 ──
const SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const arr = (name) => { const m = new RegExp("const " + name + " = \\[([\\s\\S]*?)\\];").exec(SRC); return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : []; };
const US = arr("DEFAULT_US"), KR = arr("DEFAULT_KR");
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const gauss = () => { const u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const LAST = {};
function synthDaily(sym, kr) {
  const T = 320, closes = [], highs = [], lows = [], opens = [], volumes = [], days = [];
  let p = kr ? 20000 + rnd() * 80000 : 20 + rnd() * 300; const d0 = Math.floor(AT / 86400000) - Math.round(T * 7 / 5);
  for (let i = 0, d = d0; i < T; i++) { d++; while (((d + 4) % 7) === 0 || ((d + 4) % 7) === 6) d++;   // 주말 건너뜀(1970-01-01=목)
    const o = p; p = Math.max(1, p * (1 + 0.0004 + 0.02 * gauss())); const hi = Math.max(o, p) * (1 + 0.006 * rnd()), lo = Math.min(o, p) * (1 - 0.006 * rnd());
    const r = (x) => kr ? Math.round(x) : +x.toFixed(2);
    opens.push(r(o)); closes.push(r(p)); highs.push(r(hi)); lows.push(r(lo)); volumes.push(Math.round(1e5 + rnd() * 5e6)); days.push(d); }
  LAST[sym] = closes[T - 1];
  return { closes, highs, lows, volumes, opens, days, prevClose: closes[T - 2], ts: Date.now() };
}

const stackCount = {}; let netCalls = 0; const netByHost = {}; let netByPat = {};
globalThis.fetch = async (u, init) => {
  const url = String(u && u.url ? u.url : u); netCalls++;
  const host = (/^https?:\/\/([^/]+)/.exec(url) || [])[1] || url.slice(0, 30); netByHost[host] = (netByHost[host] || 0) + 1;
  const pat = url.replace(/\?.*$/, "").replace(/[0-9]{6}(\.K[SQ])?|[A-Z][A-Z0-9.\-^=%]{0,9}(?=$|\/)/g, "*"); netByPat[pat] = (netByPat[pat] || 0) + 1;
  if (/finance\/spark\?/.test(url)) {   // [V33.538] 미국 배치 시세(spark) — 마지막 일봉 종가 주변 합성
    const syms = decodeURIComponent((/symbols=([^&]+)/.exec(url) || [])[1] || "").split(",").filter(Boolean);
    const o = {}; for (const sy of syms) { const last = LAST[sy] || 100; o[sy] = { close: [last, +(last * (1 + 0.01 * gauss())).toFixed(2)], chartPreviousClose: last }; }
    return Response.json(o);
  }
  if (url.includes("polling.finance.naver.com/api/realtime")) {
    if (process.env.BENCH_STACK && !/SERVICE_ITEM:[^&]*,/.test(url)) { const st = (new Error().stack.split("\n").slice(2, 6).map((l) => l.trim().replace(/\(.*src\/index\.js:/, "(:")).join(" < ")); stackCount[st] = (stackCount[st] || 0) + 1; }
    const codes = (/SERVICE_ITEM:([^&]+)/.exec(url) || [])[1].split(",");
    const datas = codes.map((cd) => { const s = KR.find((x) => x.startsWith(cd + ".")); const last = LAST[s] || 10000;
      const nv = Math.round(last * (1 + 0.01 * gauss())); return { cd, nv, sv: last, cv: nv - last, cr: (nv / last - 1) * 100, aq: 1e6, ms: "OPEN" }; });
    return Response.json({ result: { areas: [{ datas }] } });
  }
  return new Response("not mocked", { status: 404 });
};

const env = { DB, MODELS, AI: { run: async () => { throw new Error("no AI in bench"); } }, ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
const mod = await import("../src/index.js");
const worker = mod.default;

// 스키마는 워커가 스스로 만든다 — 첫 사이클 전에 한 번 요청을 흘려 ensureSchema 를 태운다.
const pend = [];
const ctx = { waitUntil: (p) => pend.push(Promise.resolve(p).catch(() => {})), passThroughOnException: () => {} };
await worker.fetch(new Request("https://bench.local/api/health"), env, ctx).catch(() => {});
await Promise.all(pend.splice(0));
if (PROD) {   // 운영 일봉의 마지막 종가를 합성 시세의 기준으로
  for (const r of sql.prepare("SELECT k, v FROM state WHERE k >= 'daily:' AND k < 'daily;'").all()) { try { const d = JSON.parse(r.v); if (d && d.closes && d.closes.length) LAST[r.k.slice(6)] = d.closes[d.closes.length - 1]; } catch (e) {} }
} else try {
  const ins = sql.prepare("INSERT OR REPLACE INTO state (k, v, updated_ts) VALUES (?, ?, 0)");
  sql.exec("BEGIN"); for (const s of US) ins.run("daily:" + s, JSON.stringify(synthDaily(s, false)));
  for (const s of KR) ins.run("daily:" + s, JSON.stringify(synthDaily(s, true))); sql.exec("COMMIT");
} catch (e) { console.error("seed fail (state 표 컬럼 확인):", e.message); process.exit(1); }
const dailyBytes = sql.prepare("SELECT SUM(LENGTH(v)) n FROM state WHERE k >= 'daily:' AND k < 'daily;'").get().n;
if (PROD) console.log("BENCH prod state " + sql.prepare("SELECT COUNT(*) n, SUM(LENGTH(v)) b FROM state").get().n + "행 · 보유 " + sql.prepare("SELECT COUNT(*) n FROM positions").get().n);
console.log("BENCH seed us=" + US.length + " kr=" + KR.length + " dailyJSON=" + (dailyBytes / 1e6).toFixed(1) + "MB at=" + new RealDate(AT).toISOString());

let insp = null;
const NO_PIPE = process.argv.includes("--no-pipeline");   // 야간 파이프라인(학습)을 '오늘 끝남' 으로 찍어 매분 일만 잰다
for (let c = 0; c < CYCLES; c++) {
  if (NO_PIPE && c >= 1) { sql.prepare("INSERT OR REPLACE INTO state (k, v, updated_ts) VALUES (?, ?, 0)").run("ai_trained_day", JSON.stringify(new Date().toISOString().slice(0, 10))); }
  if (c === PROF_FROM) { insp = new Session(); insp.connect(); await insp.post("Profiler.enable"); await insp.post("Profiler.setSamplingInterval", { interval: 200 }); await insp.post("Profiler.start"); }
  const t0 = performance.now(), cu0 = process.cpuUsage(); d1Calls = 0; netCalls = 0;
  await worker.scheduled({ scheduledTime: Date.now(), cron: "*/1 * * * *" }, env, ctx);
  await Promise.all(pend.splice(0));
  const cu = process.cpuUsage(cu0);
  if (c === CYCLES - 1) console.log("BENCH pat " + JSON.stringify(Object.entries(netByPat).sort((a, b) => b[1] - a[1]).slice(0, 25)));
  netByPat = {};
  if (PROD && c === 0) console.log("BENCH r2 운영에서 읽음 " + r2Got + " · 없음 " + r2Miss.size + " " + JSON.stringify([...r2Miss].slice(0, 10)));
  console.log("BENCH cycle " + c + " wall=" + Math.round(performance.now() - t0) + "ms cpu=" + Math.round((cu.user + cu.system) / 1000) + "ms d1=" + d1Calls + " net=" + netCalls + " " + JSON.stringify(netByHost));
}
try { const u = JSON.parse(sql.prepare("SELECT v FROM state WHERE k LIKE 'usage:%' ORDER BY k DESC LIMIT 1").get().v); const dd = Object.keys(u.days || {}).sort().pop(); const pb = (u.days[dd] || {}).pb || {};
  console.log("BENCH parse(kB, 전 사이클 합) " + Object.entries(pb).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => k + " " + Math.round(v)).join(" · ")); } catch (e) { console.log("BENCH parse n/a " + e.message); }
if (process.env.BENCH_STACK) console.log("BENCH stacks " + JSON.stringify(Object.entries(stackCount).sort((a, b) => b[1] - a[1]).slice(0, 8), null, 1));
if (insp) {
  const { profile } = await insp.post("Profiler.stop");
  if (PROF_OUT) writeFileSync(PROF_OUT, JSON.stringify(profile));
  const dt = []; for (let i = 0; i < profile.samples.length; i++) dt.push(profile.timeDeltas[i] || 0);
  const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (let i = 0; i < profile.samples.length; i++) { const n = byId.get(profile.samples[i]); const f = n.callFrame;
    const k = (f.functionName || "(anon)") + " " + (f.url.includes("src/index.js") ? ":" + (f.lineNumber + 1) : f.url.split("/").pop() + ":" + (f.lineNumber + 1)); self.set(k, (self.get(k) || 0) + dt[i]); }
  const tot = [...self.values()].reduce((a, b) => a + b, 0);
  console.log("BENCH prof total " + Math.round(tot / 1000) + "ms over " + (CYCLES - PROF_FROM) + " cycles");
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log("BENCH self " + (v / 1000).toFixed(0).padStart(6) + "ms " + (v / tot * 100).toFixed(1).padStart(5) + "% " + k);
}
const logs = sql.prepare("SELECT level, message FROM logs ORDER BY id DESC LIMIT 400").all();
for (const l of logs.filter((x) => /^(prefetch|\[EVAL|Done:|\[TIME-CAP|\[SCHED)/.test(x.message)).slice(0, 12)) console.log("BENCH log " + l.level + " " + l.message.slice(0, 300));
for (const l of logs.filter((x) => x.level === "ERROR").slice(0, 8)) console.log("BENCH err " + l.message.slice(0, 240));
