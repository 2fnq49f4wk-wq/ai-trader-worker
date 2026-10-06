/* [V33.498] ★폰에서 정보가 뜨기까지 몇 초인가★ — 운영 페이지를 '중급 폰 + 빠른 4G' 조건으로 연다(읽기 전용).
 * 사용자: "다른 도메인처럼 로딩 속도 압도적으로 빠르게 · 지금은 화면에 정보 뜨는 속도가 너무 늦다".
 * 첫 방문(저장소·캐시 비움) · 재방문(같은 브라우저) · 같은 날 세 번째 방문 — 각각
 *   문서 받기 끝(docEnd) · 첫 페인트(fcp) · 메인 스크립트 실행 끝(mainAt: TOP MOVERS 표가 생김) ·
 *   정보가 보이기 시작(visible: 인트로가 없거나 걷힘 + 지수/TOP MOVERS 에 숫자) · 전송량(KB, 압축 후)
 * 조건: CPU 4배 느리게 · 내려받기 9Mbps · 올리기 1.5Mbps · 지연 150ms (크롬 DevTools 'Fast 4G' 근사).
 * 사용법: node tools/ui-probe-speed.mjs <url> */
import { chromium, devices } from "playwright";
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: node tools/ui-probe-speed.mjs <url>"); process.exit(2); }
const out = (k, v) => console.log("SPD " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const b = await chromium.launch();
const ctx = await b.newContext(Object.assign({}, devices["iPhone 13"]));
const probe = () => {
  const ov = document.getElementById("lux-intro-overlay");
  const introUp = !!(ov && ov.isConnected && getComputedStyle(ov).display !== "none" && +getComputedStyle(ov).opacity > 0.05);
  const idx = document.getElementById("fvIndexRow"), mv = document.getElementById("fvGainers");
  const data = !!((idx && !idx.querySelector(".empty") && /\d/.test(idx.textContent)) || (mv && mv.querySelector("tr") && /\d/.test(mv.textContent)));
  const fcpE = performance.getEntriesByName("first-contentful-paint")[0];
  return { introUp, data, main: !!(mv && mv.querySelector("tr")), fcp: fcpE ? Math.round(fcpE.startTime) : null };
};
for (const visit of ["first", "repeat", "third"]) {
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  let bytes = 0; const big = [], reqs = new Map();
  cdp.on("Network.requestWillBeSent", (e) => { reqs.set(e.requestId, { u: e.request.url.replace(BASE, "").slice(0, 44), t0: e.timestamp }); });
  cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength || 0; const r = reqs.get(e.requestId); if (r) { r.t1 = e.timestamp; r.kb = Math.round((e.encodedDataLength || 0) / 1024); } });
  cdp.on("Network.responseReceived", (e) => { const u = e.response.url; if (/\.(js|css)(\?|$)|\/$|\.html/.test(u) && u.startsWith(BASE)) big.push({ u: u.replace(BASE, "").slice(0, 50), st: e.response.status, fromCache: !!(e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache) }); });
  await p.addInitScript(() => { window.__lt = { n: 0, sum: 0, max: 0, over200: 0 }; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { const t = window.__lt; t.n++; t.sum += e.duration; t.max = Math.max(t.max, e.duration); if (e.duration > 200) t.over200++; } }).observe({ type: "longtask", buffered: true }); } catch (e) {} });
  if (visit === "first") await p.addInitScript(() => { try { if (!sessionStorage.getItem("__c")) { localStorage.clear(); sessionStorage.setItem("__c", "1"); } } catch (e) {} });
  const t0 = Date.now();
  await p.goto(BASE + "/", { waitUntil: "commit", timeout: 90000 });
  const hit = {};
  while (Date.now() - t0 < 30000 && !(hit.visible && hit.data)) {
    try {
      const s = await p.evaluate(probe);
      const t = Date.now() - t0;
      if (s.fcp != null && hit.fcp == null) hit.fcp = s.fcp;
      if (s.main && hit.mainAt == null) hit.mainAt = t;
      if (s.data && hit.data == null) hit.data = t;
      if (!s.introUp && s.data && hit.visible == null) hit.visible = t;
    } catch (e) {}
    await p.waitForTimeout(100);
  }
  const nav = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { docEnd: Math.round(n.responseEnd), domInteractive: Math.round(n.domInteractive), dcl: Math.round(n.domContentLoadedEventEnd), docKB: Math.round((n.encodedBodySize || 0) / 1024) } : null; });
  out(visit, Object.assign({}, nav, hit, { totalKB: Math.round(bytes / 1024) }));
  out(visit + "_assets", big.slice(0, 12));
  // 요청 타임라인(페이지 열기 기준 출발·도착 ms · 압축 후 KB) — 정보가 늦게 뜨는 원인을 가른다
  const navT = [...reqs.values()].reduce((a, r) => Math.min(a, r.t0), Infinity);
  out(visit + "_reqs", [...reqs.values()].filter((r) => /^\/(api\/|_b\/|$)|\.js|\.css/.test(r.u)).map((r) => ({ u: r.u, s: Math.round((r.t0 - navT) * 1000), e: r.t1 ? Math.round((r.t1 - navT) * 1000) : null, kb: r.kb }))
    .sort((a, b2) => (b2.e || 1e9) - (a.e || 1e9)).slice(0, 18));
  out(visit + "_longtasks", await p.evaluate(() => { const t = window.__lt || {}; return { n: t.n, sumMs: Math.round(t.sum || 0), maxMs: Math.round(t.max || 0), over200: t.over200 }; }));
  await p.waitForTimeout(visit === "first" ? 6000 : 1500);   // 첫 방문 뒤 서비스워커가 자리 잡을 시간
  await p.close();
}
await b.close();
