/* [V33.446] ★두뇌 관측 화면 전체★ 를 탭마다 열어 메인 스레드 막힘을 잰다 — 사용자: "두뇌 관측하면 멈춘다".
 * OMNI 만 재던 ui-probe-omni 로는 다른 탭(개요 · 트리 · SEQ 3D · MEMO …)과 실시간 패널이 막는지를 못 본다.
 * 보기(운영 · 연구 · 모델)와 모델 탭 11개를 차례로 열고 각각 4초 동안:
 *   긴 작업 수·합·최대 · requestAnimationFrame 최대 간격(화면이 굳은 시간) · 오류.
 * 읽기 전용(GET · 탭 전환만). 사용법: node tools/ui-probe-tabs.mjs <url> */
import { chromium, webkit, devices } from "playwright";
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: node tools/ui-probe-tabs.mjs <url>"); process.exit(2); }
const MODELS = ["overview", "mind", "gbdt", "xgb", "lgb", "cat", "seq", "memo", "dualbull", "dualbear", "omni"];
const LINES = [];
const out = (k, v) => { const l = "TABS " + k + " " + JSON.stringify(v); LINES.push(l); console.log(l); };
const runs = [["desktop", chromium, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
              ["iphone", webkit, Object.assign({}, devices["iPhone 13"])]];
const measure = (p, ms) => p.evaluate((ms) => new Promise((res) => {
  const lt = []; let po = null;
  try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)); }); po.observe({ type: "longtask", buffered: false }); } catch (e) {}
  let last = performance.now(), maxGap = 0, frames = 0;
  const f = (t) => { maxGap = Math.max(maxGap, t - last); last = t; frames++; if (performance.now() - t0 < ms) requestAnimationFrame(f); };
  const t0 = performance.now(); requestAnimationFrame(f);
  setTimeout(() => { if (po) po.disconnect(); res({ longTasks: lt.length, longSum: lt.reduce((a, x) => a + x, 0), longMax: Math.max(0, ...lt),
    rafMaxGap: Math.round(maxGap), fps: +(frames / (ms / 1000)).toFixed(1), canvases: document.querySelectorAll("canvas").length }); }, ms + 50);
}), ms);
for (const [tag, eng, copts] of runs) {
  const b = await eng.launch();
  const ctx = await b.newContext(copts);
  const p = await ctx.newPage();
  const errs = []; let crashed = 0;
  p.on("pageerror", (e) => errs.push(e.message.slice(0, 160))); p.on("crash", () => crashed++);
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(3000);
  out(tag + ".home", await measure(p, 3000));
  await p.evaluate(() => { const n = document.querySelector('.nav-item[data-page="nnviz"]'); if (n) n.click(); });
  await p.waitForTimeout(2500);
  // [V33.446] 아래로 내려 읽는 사람의 화면이 ★되감기는지★ — 카드 줄 자동 넘김이 페이지를 끌어당기던 것(yanked>0 이면 되감김)
  await p.evaluate(() => window.luxBrainView && window.luxBrainView("operations"));
  await p.waitForTimeout(2500);
  out(tag + ".scrollhold", await p.evaluate(() => new Promise((res) => {
    const rail = document.getElementById("nlvScanRail");
    let sc = rail && rail.parentElement;
    while (sc && sc !== document.body) { const o = getComputedStyle(sc).overflowY; if ((o === "auto" || o === "scroll") && sc.scrollHeight > sc.clientHeight + 4) break; sc = sc.parentElement; }
    if (!sc || sc === document.body) sc = document.scrollingElement;
    const max = sc.scrollHeight - sc.clientHeight; sc.scrollTop = max; const at = sc.scrollTop;
    const cards = rail ? rail.querySelectorAll(".nlv-scancard").length : 0;
    setTimeout(() => res({ scroller: sc.id || sc.className || sc.tagName, max: Math.round(max), at: Math.round(at), after: Math.round(sc.scrollTop), yanked: Math.round(at - sc.scrollTop), cards }), 7000);
  })));
  for (const view of ["operations", "research", "models"]) {
    await p.evaluate((v) => window.luxBrainView && window.luxBrainView(v), view);
    await p.waitForTimeout(1500);
    out(tag + ".view." + view, await measure(p, 4000));
  }
  for (const m of MODELS) {
    const e0 = errs.length;
    await p.evaluate((m) => window.switchNnModel && window.switchNnModel(m), m);
    await p.waitForTimeout(2500);
    const r = await measure(p, 4000);
    r.newErrors = errs.slice(e0, e0 + 3);
    out(tag + ".model." + m, r);
  }
  out(tag + ".end", { crashed, errors: errs.length, sample: errs.slice(0, 5) });
  await b.close();
}
console.log("=== SUMMARY ===");
for (const l of LINES) console.log("SUMMARY " + l.slice(5, 900));
