/* [V33.440] ★실제 사이트★ 에서 OMNI 구조 화면을 열어 잰다 — 사용자: "OMNI 를 보면 멈춘다 · 디자인처럼 안 보인다".
 * 샌드박스는 운영 주소에 못 닿고, 시험장(합성 데이터 · 작은 페이지)은 실제 페이지와 다르다. 그래서 운영 페이지 그대로:
 *   · 메인 스레드가 막힌 시간(longtask 합 · 10ms 타이머 최대 지연) · 콘솔 오류 · 페이지 예외
 *   · 캔버스 상태(mode = worker/main · draws · averageMs · workerFail)
 *   · /api/nn-viz?model=omni · /api/omni-structure 의 상태·크기·시간과 요약
 *   · 화면 캡처(JPEG base64 를 로그에 "IMG <이름> <조각>" 으로 — 아티팩트를 못 받는 곳에서도 읽히게)
 * 읽기 전용이다(GET 만 · 버튼은 탭 전환만). 사용법: node tools/ui-probe-omni.mjs <url> */
import { chromium, webkit, devices } from "playwright";
import zlib from "node:zlib";
// [V33.448] 캡처를 로그에 싣지 않고 ★밝기 격자★ 로 읽는다 — 사용자 캡처(아이폰): 그림이 왼쪽 위 2/3 에만 그려지고
//   나머지(ㄱ자)엔 옛 장면이 남아 있었다. PNG 를 풀어 3×3 칸마다 '켜진 픽셀' 비율을 낸다.
//   바른 그림: 가운데 칸이 가장 밝고 좌우·위아래가 비슷. 결함: 오른쪽 열·아래 행만 비거나(2/3) 거꾸로 꽉 찬다(옛 장면).
function pngGrid(buf, N = 3) {
  let o = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (o < buf.length) { const len = buf.readUInt32BE(o), type = buf.toString("ascii", o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (type === "IDAT") idat.push(d); else if (type === "IEND") break; o += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) { const a = i >= bpp ? row[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0; let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const p0 = a + b - c, pa = Math.abs(p0 - a), pb = Math.abs(p0 - b), pc = Math.abs(p0 - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[i] = v & 255; } }
  const lit = Array(N * N).fill(0), tot = Array(N * N).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * stride + x * bpp, L = px[i] * .3 + px[i + 1] * .59 + px[i + 2] * .11, c = Math.min(N - 1, Math.floor(y * N / h)) * N + Math.min(N - 1, Math.floor(x * N / w)); tot[c]++; if (L > 60) lit[c]++; }
  return { size: [w, h], lit: lit.map((v, i) => +(v / tot[i] * 100).toFixed(1)) };
}
async function gridOf(p) { try { const el = await p.$("#omniVol .nerve-viewport"); if (!el) return null; await el.scrollIntoViewIfNeeded().catch(() => {}); return pngGrid(await el.screenshot({ type: "png" })); } catch (e) { return { err: String(e).slice(0, 160) }; } }
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: node tools/ui-probe-omni.mjs <url>"); process.exit(2); }
const LINES = [];
const out = (k, v) => { const l = "PROBE " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)); LINES.push(l); console.log(l); };
const WANT_IMG = process.env.IMG === "1";
// [V33.444] 사용자: "OMNI 열면 사이트가 터진다" — 크롬만 재던 것을 ★아이폰 사파리(WebKit)★ 까지. 그리고 사람이 하듯 탭을 오가고
//   창 높이를 흔들어(주소창) 탭이 죽는지(crash) · 응답하는지 · 긴 작업이 있는지 본다.
const ENG = (process.env.ENGINES || "chromium,webkit").split(",");
const runs = [];
if (ENG.includes("chromium")) { runs.push(["desktop", chromium, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }]);
  runs.push(["mobile", chromium, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]); }
if (ENG.includes("webkit")) runs.push(["iphone", webkit, Object.assign({}, devices["iPhone 13"])]);
const browsers = {};
for (const [tag, eng, copts] of runs) {
  const bname = eng === webkit ? "webkit" : "chromium";
  const b = browsers[bname] || (browsers[bname] = await eng.launch());
  const ctx = await b.newContext(copts);
  // 처음부터 긴 작업을 모은다(탭을 여는 순간의 막힘까지)
  await ctx.addInitScript(() => { window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true }); } catch (e) {} });
  const p = await ctx.newPage();
  let crashed = 0; p.on("crash", () => { crashed++; });
  const errs = [], nets = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.type() + ": " + m.text().slice(0, 200)); });
  p.on("requestfinished", async (rq) => {
    const u = rq.url();
    if (!/\/api\/(nn-viz\?model=omni|omni-structure|ai-mode|pipeline)|neural-observatory\.js/.test(u)) return;
    try { const r = await rq.response(); const t = rq.timing(); const body = await r.body().catch(() => Buffer.alloc(0));
      const h = await r.allHeaders().catch(() => ({}));
      nets.push({ u: u.replace(BASE, ""), s: r.status(), kb: +(body.length / 1024).toFixed(1), ms: Math.round(t.responseEnd), sw: r.fromServiceWorker(), st: h["server-timing"] || null }); } catch (e) {}
  });
  const t0 = Date.now();
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  out(tag + ".load_ms", Date.now() - t0);
  await p.waitForTimeout(4000);
  // 구조 탭 → OMNI
  await p.evaluate(() => { const n = document.querySelector('.nav-item[data-page="nnviz"]'); if (n) n.click(); });
  await p.waitForTimeout(1500);
  // 구조 관측은 '모델' 보기에서만 보인다(운영 보기는 #nnvStruct 를 숨긴다) — 사용자가 하는 순서 그대로
  await p.evaluate(() => { if (typeof window.luxBrainView === "function") window.luxBrainView("models"); });
  await p.waitForTimeout(800);
  await p.evaluate(() => { if (typeof window.switchNnModel === "function") window.switchNnModel("omni"); });
  const tw = Date.now();
  await p.waitForSelector("#omniVol canvas", { state: "attached", timeout: 30000 }).catch(() => {});
  out(tag + ".omni_appear_ms", Date.now() - tw);
  await p.waitForTimeout(1000);
  // 그림이 화면 안에 오게(화면 밖이면 워커가 일부러 쉰다) — 숨은 조상이 있으면 그것도 적는다
  out(tag + ".visibility", await p.evaluate(() => { const v = document.getElementById("omniVol"); if (!v) return null; v.scrollIntoView({ block: "center" });
    let e = v, hid = null; while (e && e !== document.body) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") { hid = (e.id ? "#" + e.id : "") + "." + String(e.className).split(" ").join("."); break; } e = e.parentElement; }
    const r = v.getBoundingClientRect(); return { rect: [Math.round(r.width), Math.round(r.height)], hiddenBy: hid }; }));
  await p.waitForTimeout(1500);
  // 10초 동안 메인 스레드가 얼마나 막히나
  const jank = await p.evaluate(() => new Promise((res) => {
    let lt = 0, n = 0, maxGap = 0, prev = performance.now();
    let po = null; try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { lt += e.duration; n++; } }); po.observe({ type: "longtask", buffered: false }); } catch (e) {}
    const iv = setInterval(() => { const x = performance.now(); maxGap = Math.max(maxGap, x - prev - 10); prev = x; }, 10);
    setTimeout(() => { clearInterval(iv); if (po) po.disconnect(); res({ longTaskMs: Math.round(lt), longTasks: n, maxTimerDelayMs: Math.round(maxGap) }); }, 10000);
  }));
  out(tag + ".jank", jank);
  out(tag + ".grid.open", await gridOf(p));
  const st = await p.evaluate(() => {
    const vol = document.getElementById("omniVol"), c = vol && vol.querySelector("canvas");
    const r = vol ? vol.getBoundingClientRect() : null;
    return { hasVol: !!vol, volHtml: vol ? vol.innerHTML.slice(0, 160) : null, rect: r ? [Math.round(r.width), Math.round(r.height)] : null,
             canvas: c ? Object.assign({}, c.dataset, { cw: c.width, ch: c.height }) : null,
             info: vol ? (vol.querySelector("output") || {}).textContent : null,
             layers: vol ? Array.from(vol.querySelectorAll(".nerve-layers button")).map((x) => x.textContent) : null,
             build: (document.querySelector('meta[name="lux-build"]') || {}).content || null,
             script: (Array.from(document.scripts).find((s) => /neural-observatory/.test(s.src)) || {}).src || null,
             sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller) };
  });
  out(tag + ".state", st);
  out(tag + ".net", nets);
  out(tag + ".errors", errs.slice(0, 25));
  // 구조 응답 요약(같은 출처 fetch — 페이지 안에서)
  const sum = await p.evaluate(async () => {
    const o = {};
    try { const r = await fetch("/api/omni-structure"); const j = await r.json(); o.structure = { s: r.status, ok: j.ok, why: j.why || null, params: j.params, trees: (j.trees || []).length,
      splits: (j.trees || []).reduce((a, t) => a + t.length - 2, 0), sizes: j.net ? j.net.sizes : null, nets: j.net ? j.net.nets : null, feats: (j.feats || []).length }; } catch (e) { o.structure = String(e); }
    try { const r = await fetch("/api/nn-viz?model=omni"); const j = await r.json(); o.viz = { s: r.status, trained: j.trained, v: j.v, nTrees: j.nTrees, nnOn: j.nnOn, nnViz: !!j.nnViz,
      alpha: j.alpha, heads: (j.heads || []).map((h) => h.hz + ":" + h.auc) }; } catch (e) { o.viz = String(e); }
    return o;
  });
  out(tag + ".api", sum);
  // ── 부하: 탭 오가기 × 6 · 보기 전환 × 2 · 창 높이 흔들기 × 6 → 탭이 살아 있나 ──
  try {
    for (let i = 0; i < 6; i++) {
      await p.evaluate(() => window.switchNnModel && window.switchNnModel("gbdt")); await p.waitForTimeout(500);
      await p.evaluate(() => window.switchNnModel && window.switchNnModel("omni")); await p.waitForTimeout(900);
    }
    for (let i = 0; i < 2; i++) {
      await p.evaluate(() => window.luxBrainView && window.luxBrainView("operations")); await p.waitForTimeout(500);
      await p.evaluate(() => window.luxBrainView && window.luxBrainView("models")); await p.waitForTimeout(900);
    }
    const vs = p.viewportSize();
    for (let i = 0; i < 6; i++) { await p.setViewportSize({ width: vs.width, height: vs.height - (i % 2 ? 0 : 90) }); await p.waitForTimeout(250); }
    await p.waitForTimeout(3000);
    const alive = await Promise.race([p.evaluate(() => 1 + 1), new Promise((r) => setTimeout(() => r("timeout"), 5000))]);
    const after = await p.evaluate(() => { const c = document.querySelector("#omniVol canvas"); return { canvases: document.querySelectorAll("canvas").length,
      mode: c ? c.dataset.mode : null, ready: c ? c.dataset.ready || null : null, fail: c ? c.dataset.workerFail || null : null,
      longTasks: (window.__lt || []).length, longTaskMax: Math.max(0, ...(window.__lt || [])), longTaskSum: (window.__lt || []).reduce((a, x) => a + x, 0),
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null }; }).catch((e) => ({ err: String(e) }));
    out(tag + ".stress", Object.assign({ alive: alive === 2, crashed }, after));
    await p.evaluate(() => { const v = document.getElementById("omniVol"); if (v) v.scrollIntoView({ block: "center" }); });
    await p.waitForTimeout(1500);
    out(tag + ".grid.stress", await gridOf(p));
    // 사람이 하듯 페이지를 위아래로 굴린 뒤(주소창 · 스크롤) 다시 본다
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, i % 2 ? -400 : 400).catch(() => {}); await p.waitForTimeout(300); }
    await p.evaluate(() => { const v = document.getElementById("omniVol"); if (v) v.scrollIntoView({ block: "center" }); });
    await p.waitForTimeout(1500);
    out(tag + ".grid.scroll", await gridOf(p));
    out(tag + ".canvas", await p.evaluate(() => { const c = document.querySelector("#omniVol canvas"); return c ? Object.assign({}, c.dataset) : null; }));
  } catch (e) { out(tag + ".stress", { error: String(e).slice(0, 300), crashed }); }
  // 화면 캡처 — OMNI 3D 부분만(IMG=1 일 때만 — 로그가 커진다)
  if (WANT_IMG) try {
    const el = await p.$("#omniVol");
    const buf = el ? await el.screenshot({ type: "jpeg", quality: 55 }) : await p.screenshot({ type: "jpeg", quality: 45 });
    const b64 = buf.toString("base64");
    for (let i = 0; i < b64.length; i += 4000) console.log("IMG " + tag + " " + b64.slice(i, i + 4000));
    out(tag + ".img_kb", +(buf.length / 1024).toFixed(1));
  } catch (e) { out(tag + ".img_err", String(e)); }
  await ctx.close();
}
for (const k in browsers) await browsers[k].close();
// 요약을 로그 끝에 한 번 더 — 로그 끝만 읽어도 전부 보이게
console.log("=== SUMMARY ===");
for (const l of LINES) console.log("SUMMARY " + l.slice(6, 1400));
