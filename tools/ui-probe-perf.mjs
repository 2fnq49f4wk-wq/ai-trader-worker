/* ★실제 사이트에서 '멈춤' 의 범인을 함수 단위로 찾는다★ — 사용자: "아직도 사이트가 멈춘다 · OMNI 로딩이 느리다 ·
 * 라이브 화면으로 직접 확인해라". 샌드박스는 운영 주소에 못 닿으므로 CI 브라우저로 운영 페이지를 그대로 연다.
 *   1) 크롬(휴대폰 흉내 · CPU 4배 느리게 = 보통 휴대폰): CPU 프로파일 → 자기 시간 상위 함수(파일:줄) · 긴 작업을 단계별로
 *   2) WebKit(아이폰 13): 16ms 타이머 간격으로 '화면이 굳은 구간' 을 단계별로(WebKit 은 longtask API 가 없다)
 *   3) 두 엔진 모두: 두뇌 관측을 누른 뒤 OMNI 가 ① 캔버스 ② 워커 준비 ③ 구조 전부 까지 걸린 시간
 *   4) 화면 캡처(작은 JPEG · 로그의 "IMG <이름> <조각>") — 사람이 보는 그대로를 확인
 * 읽기 전용(GET · 탭 전환만). 사용법: node tools/ui-probe-perf.mjs <url> */
import { chromium, webkit, devices } from "playwright";
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: node tools/ui-probe-perf.mjs <url>"); process.exit(2); }
const WANT_IMG = process.env.IMG === "1";
const LINES = [];
const out = (k, v) => { const l = "PERF " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)); LINES.push(l); console.log(l); };
// 페이지 안: 단계 표식 + 16ms 타이머로 굳은 구간(>80ms) 기록 + longtask(크롬)
const INIT = () => {
  window.__phase = "load"; window.__stalls = []; window.__lt = [];
  let prev = performance.now();
  setInterval(() => { const n = performance.now(), g = n - prev; if (g > 80) window.__stalls.push([window.__phase, Math.round(n), Math.round(g)]); prev = n; }, 16);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([window.__phase, Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true }); } catch (e) {}
};
// CPU 프로파일 요약: 자기 시간 상위 + ★포함 시간★ 상위(누가 부른 일인지 — 부팅처럼 한 함수가 여러 일을 부를 때)
function cpuReport(label, profile) {
  const dt = profile.timeDeltas || [], byId = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
  const key = (n) => { const cf = n.callFrame, url = (cf.url || "").replace(BASE, "").split("?")[0]; return (cf.functionName || "(anon)") + " " + (url || "-") + ":" + (cf.lineNumber + 1); };
  const skip = (n) => /^\((idle|program|root|garbage collector)\)$/.test(n.callFrame.functionName);
  const self = new Map(), incl = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const d = dt[i] || 0; let id = profile.samples[i], n = byId.get(id); if (!n || skip(n)) continue;
    self.set(key(n), (self.get(key(n)) || 0) + d);
    const seen = new Set();
    while (n) { if (!skip(n)) { const k = key(n); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + d); } } id = parent.get(id); n = id != null ? byId.get(id) : null; }
  }
  const fmt = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([x, us]) => Math.round(us / 1000) + "ms " + x);
  out(label + ".cpu_self", fmt(self, 20));
  out(label + ".cpu_incl", fmt(incl, 20));
  out(label + ".cpu_total_ms", Math.round([...self.values()].reduce((a, x) => a + x, 0) / 1000));
}
// [V33.462] 손가락으로 위로 밀었을 때 페이지가 실제로 스크롤되나(크롬 CDP 터치) — "OMNI 열고 스크롤하면 멈춘다" 의 실체가 이것이었다
async function touchSwipe(p, cdp, sel) {
  if (!cdp) return null;
  try {
    const el = await p.$(sel); if (!el) return { err: "no " + sel };
    await el.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(300);
    const bb = await el.boundingBox(); if (!bb) return { err: "no box" };
    const pos = () => p.evaluate(() => { const pg = document.querySelector(".page.active"); return (pg ? pg.scrollTop : 0) + (window.scrollY || 0); });
    const before = await pos();
    const X = Math.round(bb.x + bb.width / 2); let Y = Math.round(Math.min(bb.y + bb.height * 0.8, 780));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: X, y: Y }] });
    for (let i = 0; i < 12; i++) { Y -= 18; await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: X, y: Y }] }); await p.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(500);
    return { moved: Math.round((await pos()) - before), swipe: 216 };
  } catch (e) { return { err: String(e).slice(0, 120) }; }
}
async function omniTimes(p, t0) {
  // 캔버스 → 워커 준비 → 구조 전부(설명 문구에 '전부 한 줄씩')
  const r = { canvas: null, ready: null, full: null };
  const until = Date.now() + 30000;
  while (Date.now() < until && (r.canvas == null || r.ready == null || r.full == null)) {
    const s = await p.evaluate(() => {
      // [V33.466] Brain Studio(WebGL) 가 붙었으면 그쪽을 잰다 — 캔버스 · 그려짐(크기) · '전부 한 줄씩'
      const bs = document.querySelector("#brain-studio .bs-gl-inline");
      if (bs) { const c = bs.querySelector("canvas"), root = document.getElementById("brain-studio");
        return { c: !!c, ready: !!(c && c.width > 1), full: !!(root && /전부 한 줄씩/.test(root.textContent)) }; }
      const v = document.getElementById("omniVol"), c = v && v.querySelector("canvas"), o = v && v.querySelector("output");
      return { c: !!c, ready: !!(c && (c.dataset.ready || (c.dataset.mode === "main" && c.dataset.draws))), full: !!(o && /전부 한 줄씩/.test(o.textContent)) }; }).catch(() => ({}));
    const dt = Date.now() - t0;
    if (s.c && r.canvas == null) r.canvas = dt;
    if (s.ready && r.ready == null) r.ready = dt;
    if (s.full && r.full == null) r.full = dt;
    await p.waitForTimeout(50);
  }
  return r;
}
// 캡처: SHOTS_DIR 가 있으면 파일로(워크플로가 ui-probe-shots 가지에 올린다 — 로그 조각보다 가볍다) · 없으면 로그의 IMG 줄
const SHOTS = process.env.SHOTS_DIR || "";
async function shot(p, name) {
  if (!WANT_IMG) return;
  try { const buf = await p.screenshot({ type: "jpeg", quality: 55, fullPage: false });
    if (SHOTS) { (await import("node:fs")).writeFileSync(SHOTS + "/" + name + ".jpg", buf); out(name + ".img_kb", +(buf.length / 1024).toFixed(1)); return; }
    const b64 = buf.toString("base64");
    for (let i = 0; i < b64.length; i += 4000) console.log("IMG " + name + " " + b64.slice(i, i + 4000)); out(name + ".img_kb", +(buf.length / 1024).toFixed(1)); } catch (e) { out(name + ".img_err", String(e).slice(0, 120)); }
}
async function run(tag, eng, copts, throttle) {
  const b = await eng.launch();
  const ctx = await b.newContext(copts);
  await ctx.addInitScript(INIT);
  const p = await ctx.newPage();
  // 첫 15초 네트워크 폭포(주소 · 시작 · 걸린 시간) — 인트로가 무엇을 기다리는지
  const tNav = Date.now(), net = [];
  p.on("requestfinished", (rq) => { const u = rq.url().replace(BASE, ""); if (!/^\/api\/|\.js|\.css|fonts/.test(u)) return; const t = rq.timing();
    net.push([u.slice(0, 60), Math.round(t.startTime - tNav), Math.round(t.responseEnd)]); });
  p.on("requestfailed", (rq) => { net.push([rq.url().replace(BASE, "").slice(0, 60), -1, rq.failure() && rq.failure().errorText]); });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message.slice(0, 160))); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
  let cdp = null;
  if (throttle) { cdp = await ctx.newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle }); await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 500 }); await cdp.send("Profiler.start"); }
  const t0 = Date.now();
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  out(tag + ".dcl_ms", Date.now() - t0);
  await p.waitForLoadState("load", { timeout: 60000 }).catch(() => {});
  out(tag + ".load_ms", Date.now() - t0);
  // 인트로가 걷힐 때까지(최대 15초)
  await p.waitForFunction(() => window.__luxBootOpen, null, { timeout: 15000 }).catch(() => {});
  out(tag + ".boot", await p.evaluate(() => ({ open: window.__luxBootOpen || null, done: window.__luxBootDone || null })));
  if (cdp) { cpuReport(tag + ".load", (await cdp.send("Profiler.stop")).profile); await cdp.send("Profiler.start"); }
  await p.waitForTimeout(2000);
  out(tag + ".net_first", net.filter((x) => x[1] < 16000).sort((a, b) => (b[2] || 0) - (a[2] || 0)).slice(0, 25));
  await shot(p, tag + ".home");
  out(tag + ".swipe_map", await touchSwipe(p, cdp, "#fvHeatmap"));
  // 두뇌 관측(운영 보기)
  await p.evaluate(() => { window.__phase = "nnviz-open"; const n = document.querySelector('.nav-item[data-page="nnviz"]'); if (n) n.click(); });
  await p.waitForTimeout(5000);
  await shot(p, tag + ".nnviz");
  // 아래로 굴려 읽기(사람처럼) — 굴리는 동안 굳는가
  await p.evaluate(() => { window.__phase = "nnviz-scroll"; });
  for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 500).catch(() => {}); await p.waitForTimeout(250); }
  await p.waitForTimeout(1500);
  await shot(p, tag + ".nnviz-scrolled");
  // 모델 보기 → OMNI
  await p.evaluate(() => { window.__phase = "omni-open"; try { localStorage.setItem("bsModel", "omni"); } catch (e) {} if (window.luxBrainView) window.luxBrainView("models"); if (window.switchNnModel) window.switchNnModel("omni"); });
  const tw = Date.now();
  const ot = await omniTimes(p, tw);
  out(tag + ".omni_times", ot);
  if (ot.canvas == null) out(tag + ".omni_missing", await p.evaluate(() => { const st = document.getElementById("nnvStage");
    const tab = document.querySelector('#nnvTabs .nnv-tab.active'); const pg = document.getElementById("page-nnviz");
    return { stage: st ? st.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300) : null, activeTab: tab ? tab.getAttribute("data-model") : null,
             view: pg ? pg.getAttribute("data-brain-view") : null, hasSwitch: typeof window.switchNnModel, cache: (function(){ try { return !!localStorage.getItem("nnvCache_omni"); } catch (e) { return "err"; } })() }; }));
  const OV = await p.evaluate(() => document.querySelector("#brain-studio .bs-gl-inline") ? "#brain-studio .bs-gl-inline" : "#omniVol");
  out(tag + ".omni_host", OV);
  await p.evaluate((sel) => { const v = document.querySelector(sel); if (v) v.scrollIntoView({ block: "center" }); window.__phase = "omni-view"; }, OV);
  await p.waitForTimeout(4000);
  await shot(p, tag + ".omni");
  out(tag + ".swipe_omni", await touchSwipe(p, cdp, OV === "#omniVol" ? "#omniVol .nerve-viewport canvas" : OV));
  await p.evaluate(() => { window.__phase = "omni-scroll"; });
  for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, i % 2 ? -350 : 350).catch(() => {}); await p.waitForTimeout(200); }
  await p.waitForTimeout(1500);
  await p.evaluate((sel) => { const v = document.querySelector(sel); if (v) v.scrollIntoView({ block: "center" }); }, OV);
  await p.waitForTimeout(1200);
  await shot(p, tag + ".omni-after-scroll");
  const pg = await p.evaluate(() => {
    const byPhase = {}; for (const [ph, , g] of window.__stalls) { const o = byPhase[ph] || (byPhase[ph] = { n: 0, sum: 0, max: 0 }); o.n++; o.sum += g; o.max = Math.max(o.max, g); }
    const lt = {}; for (const [ph, , d] of window.__lt) { const o = lt[ph] || (lt[ph] = { n: 0, sum: 0, max: 0 }); o.n++; o.sum += d; o.max = Math.max(o.max, d); }
    const c = document.querySelector("#omniVol canvas"), g = document.querySelector("#brain-studio canvas");
    return { studio: !!document.querySelector("#brain-studio main"), gl: g ? g.width + "x" + g.height : null, stalls: byPhase, longtasks: lt, worst: window.__stalls.slice().sort((a, b) => b[2] - a[2]).slice(0, 8), canvas: c ? Object.assign({}, c.dataset) : null,
             build: (document.querySelector('meta[name="lux-build"]') || {}).content || null, dom: document.getElementsByTagName("*").length,
             heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null };
  });
  out(tag + ".page", pg);
  out(tag + ".errors", errs.slice(0, 10));
  if (cdp) cpuReport(tag + ".after", (await cdp.send("Profiler.stop")).profile);
  await b.close();
}
const iphone = Object.assign({}, devices["iPhone 13"]);
const pixel = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent };
await run("phone4x", chromium, pixel, 4);
await run("iphone", webkit, iphone, 0);
console.log("=== SUMMARY ===");
for (const l of LINES) console.log("SUMMARY " + l.slice(5, 3000));
