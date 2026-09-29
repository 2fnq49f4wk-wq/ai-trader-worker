/* [V33.440] ★실제 사이트★ 에서 OMNI 구조 화면을 열어 잰다 — 사용자: "OMNI 를 보면 멈춘다 · 디자인처럼 안 보인다".
 * 샌드박스는 운영 주소에 못 닿고, 시험장(합성 데이터 · 작은 페이지)은 실제 페이지와 다르다. 그래서 운영 페이지 그대로:
 *   · 메인 스레드가 막힌 시간(longtask 합 · 10ms 타이머 최대 지연) · 콘솔 오류 · 페이지 예외
 *   · 캔버스 상태(mode = worker/main · draws · averageMs · workerFail)
 *   · /api/nn-viz?model=omni · /api/omni-structure 의 상태·크기·시간과 요약
 *   · 화면 캡처(JPEG base64 를 로그에 "IMG <이름> <조각>" 으로 — 아티팩트를 못 받는 곳에서도 읽히게)
 * 읽기 전용이다(GET 만 · 버튼은 탭 전환만). 사용법: node tools/ui-probe-omni.mjs <url> */
import { chromium } from "playwright";
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: node tools/ui-probe-omni.mjs <url>"); process.exit(2); }
const LINES = [];
const out = (k, v) => { const l = "PROBE " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)); LINES.push(l); console.log(l); };
const WANT_IMG = process.env.IMG === "1";
const b = await chromium.launch();
for (const [tag, vp] of [["desktop", { width: 1440, height: 900, deviceScaleFactor: 1 }], ["mobile", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
  const p = await ctx.newPage();
  const errs = [], nets = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.type() + ": " + m.text().slice(0, 200)); });
  p.on("requestfinished", async (rq) => {
    const u = rq.url();
    if (!/\/api\/(nn-viz\?model=omni|omni-structure)|neural-observatory\.js/.test(u)) return;
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
await b.close();
// 요약을 로그 끝에 한 번 더 — 로그 끝만 읽어도 전부 보이게
console.log("=== SUMMARY ===");
for (const l of LINES) console.log("SUMMARY " + l.slice(6, 1400));
