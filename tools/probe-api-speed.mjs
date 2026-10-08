/* [V33.521] ★데이터 조회가 몇 ms 걸리고, 사용자가 몰리면 어떻게 되는가★ — 운영 API 를 읽기 전용(GET)으로 잰다.
 * 사용자: "사이트내 데이터 로딩속도 더 빠르게 · 도메인수준으로 · 더 많은 트래픽 처리할수 있게".
 * 화면 속도(ui-probe-speed)는 '폰에서 첫 숫자가 보이기까지' 만 본다 — 어느 API 가 늦은지, 동시 접속에서
 * 무너지는지는 안 보인다. 여기서 엔드포인트마다
 *   ① 연속 3회 TTFB(첫 바이트까지) · 크기(압축 후) · cache-control · 캐시 층(x-lux-c: l1/l2/r2/build)
 *   ② 동시 N회 몰아치기 — 중앙값·최댓값·실패 수 (단일비행·캐시가 실제로 받쳐 주는지)
 * 를 한 줄씩 남긴다(API 줄). 사용법: node tools/probe-api-speed.mjs <url> [동시수=24] */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const BURST = Math.max(1, Math.min(64, +(process.argv[3] || 24)));
if (!BASE) { console.error("usage: node tools/probe-api-speed.mjs <url> [burst]"); process.exit(2); }

// 대시보드가 부팅·폴링에서 치는 조회들(public/index.html 에서 뽑은 것) — 쓰기·관리 경로는 넣지 않는다.
const EPS = [
  "/api/state", "/api/indices", "/api/heatmap", "/api/trades?limit=50", "/api/trades?limit=3000",
  "/api/ai-mode", "/api/ai-picks", "/api/pipeline", "/api/events", "/api/commodities", "/api/bonds",
  "/api/fx", "/api/news", "/api/news-picks", "/api/logs?limit=1200", "/api/ml-status", "/api/diag",
  "/api/macro", "/api/econ", "/api/earnings", "/api/tick", "/api/chart?symbol=AAPL", "/api/chart?symbol=005930.KS",
  "/api/nn-viz?model=overview", "/api/version",
];

async function hit(p) {
  const t0 = performance.now();
  try {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 30000);
    const r = await fetch(BASE + p, { headers: { "accept-encoding": "gzip, br" }, signal: ac.signal });
    const tf = performance.now() - t0;
    const buf = await r.arrayBuffer(); clearTimeout(to);
    return { st: r.status, ttfb: Math.round(tf), tot: Math.round(performance.now() - t0), kb: Math.round(buf.byteLength / 1024),
      cc: r.headers.get("cache-control") || "-", layer: r.headers.get("x-lux-c") || "-", ce: r.headers.get("content-encoding") || "-" };
  } catch (e) { return { st: 0, ttfb: Math.round(performance.now() - t0), tot: Math.round(performance.now() - t0), kb: 0, cc: "-", layer: "-", err: String(e && e.name || e) }; }
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

const rows = [];
for (const p of EPS) {
  const seq = [];
  for (let i = 0; i < 3; i++) seq.push(await hit(p));
  const burst = await Promise.all(Array.from({ length: BURST }, () => hit(p)));
  const ok = burst.filter((b) => b.st >= 200 && b.st < 400);
  const row = { p, st: seq.map((s) => s.st).join("/"), seq: seq.map((s) => s.ttfb).join("/"), kb: seq[seq.length - 1].kb,
    layer: seq.map((s) => s.layer).join("/"), cc: seq[seq.length - 1].cc, ce: seq[seq.length - 1].ce,
    bMed: med(burst.map((b) => b.tot)), bMax: Math.max(...burst.map((b) => b.tot)), bFail: BURST - ok.length,
    bLayers: Object.entries(burst.reduce((m, b) => (m[b.layer] = (m[b.layer] || 0) + 1, m), {})).map(([k, v]) => k + "×" + v).join(",") };
  rows.push(row);
  console.log("API " + p.padEnd(30) + " st=" + row.st + " ttfb(ms)=" + row.seq + " kb=" + row.kb + " ce=" + row.ce +
    " layer=" + row.layer + " | burst" + BURST + " med=" + row.bMed + " max=" + row.bMax + " fail=" + row.bFail + " [" + row.bLayers + "] | cc=" + row.cc);
}
const slow = rows.filter((r) => +r.seq.split("/")[2] > 800 || r.bMax > 3000 || r.bFail > 0).map((r) => r.p);
console.log("API_SUMMARY slow_or_failing=" + (slow.length ? slow.join(",") : "none") +
  " · 3rd-hit median=" + med(rows.map((r) => +r.seq.split("/")[2])) + "ms · burst max of maxes=" + Math.max(...rows.map((r) => r.bMax)) + "ms");
