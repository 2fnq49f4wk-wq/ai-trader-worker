/* [V33.493] ★시세가 화면에 뜨기까지 몇 초인가★ — 운영 페이지를 헤드리스로 열어 잰다(읽기 전용 · 클릭은 종목 열기만).
 * 사용자: "주식 가격 로딩 뜨는 거 더 정확하고 빨리". 처음 방문(저장소 비움) · 재방문(첫 화면 사본 있음) 두 번,
 * 폰(아이폰 크기) 기준으로 각 요소가 '값' 을 가질 때까지의 시간(ms, 페이지 열기부터)과 /api 응답 시간·크기를 남긴다.
 *   지수 줄(#fvIndexRow) · TOP MOVERS(#fvGainers 첫 줄 숫자) · 시총맵(#fvHeatmap svg) · 종목상세 현재가(#detailPrice) · 상세 시가표(#detailOhlc)
 * 사용법: node tools/ui-probe-prices.mjs <url> */
import { chromium, devices } from "playwright";
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: node tools/ui-probe-prices.mjs <url>"); process.exit(2); }
const out = (k, v) => console.log("UPX " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const b = await chromium.launch();
const ctx = await b.newContext(Object.assign({}, devices["iPhone 13"], { serviceWorkers: "block" }));
const probes = {
  index: () => { const e = document.getElementById("fvIndexRow"); return !!(e && !e.querySelector(".empty") && /\d/.test(e.textContent)); },
  movers: () => { const e = document.getElementById("fvGainers"); return !!(e && e.querySelector("tr") && /\d/.test(e.textContent)); },
  heatmap: () => { const e = document.getElementById("fvHeatmap"); return !!(e && e.querySelector("svg rect, svg path")); },
  introGone: () => !document.getElementById("lux-intro-overlay")
};
let T0 = 0;
for (const visit of ["first", "repeat"]) {
  const p = await ctx.newPage();
  const api = [];
  p.on("requestfinished", async (rq) => { const u = rq.url(); if (!/\/api\//.test(u)) return;
    const t = rq.timing(); let sz = null; try { const r = await rq.response(); sz = r ? (await r.body()).length : null; } catch (e) {}
    // 대기(브라우저 줄서기·연결) = requestStart · 서버(TTFB) = responseStart − requestStart · 받기 = responseEnd − responseStart · at = 페이지 열기 기준 출발 시각
    api.push({ path: u.replace(BASE, "").slice(0, 60), ms: Math.round(t.responseEnd), wait: Math.round(t.requestStart), ttfb: Math.round(t.responseStart - t.requestStart),
      at: Math.round(t.startTime - T0), kb: sz != null ? Math.round(sz / 1024) : null }); });
  if (visit === "first") await p.addInitScript(() => { try { if (!sessionStorage.getItem("__cleared")) { localStorage.clear(); sessionStorage.setItem("__cleared", "1"); } } catch (e) {} });
  const t0 = Date.now(); T0 = t0;
  await p.goto(BASE + "/", { waitUntil: "commit", timeout: 60000 });
  const hit = {};
  while (Date.now() - t0 < 25000 && Object.keys(hit).length < Object.keys(probes).length) {
    for (const [k, fn] of Object.entries(probes)) if (!hit[k]) { try { if (await p.evaluate(fn)) hit[k] = Date.now() - t0; } catch (e) {} }
    await p.waitForTimeout(100);
  }
  out("paint_" + visit, hit);
  // 첫 화면 사본이 얼마나 묵은 값이었나(재방문 시 즉시 보이는 시세의 나이)
  if (visit === "repeat") out("bootBundle", await p.evaluate(() => { try { const s = JSON.parse(localStorage.getItem("bootBundle") || "null"); return s && s.state ? { kb: Math.round(JSON.stringify(s).length / 1024), serverTimeAgoS: Math.round((Date.now() - s.state.serverTime) / 1000) } : null; } catch (e) { return String(e); } }));
  // 종목 상세 — TOP MOVERS 첫 줄 클릭
  if (visit === "repeat") {
    try {
      await p.waitForTimeout(600);
      const row = await p.$("#fvGainers [data-sym]");   // 상세는 더블탭/더블클릭으로 열린다(bindDblTapDetail)
      const sym = row ? await row.getAttribute("data-sym") : null;
      const t1 = Date.now();
      if (row) await row.dblclick();
      const dh = {};
      while (Date.now() - t1 < 15000 && Object.keys(dh).length < 2) {
        const st = await p.evaluate(() => ({ price: (document.getElementById("detailPrice") || {}).textContent || "", ohlc: !!(document.getElementById("detailOhlc") || {}).innerHTML }));
        if (!dh.price && /\d/.test(st.price)) dh.price = Date.now() - t1;
        if (!dh.ohlc && st.ohlc) dh.ohlc = Date.now() - t1;
        await p.waitForTimeout(100);
      }
      out("detail", Object.assign({ sym, shown: await p.evaluate(() => (document.getElementById("detailPrice") || {}).textContent) }, dh));
    } catch (e) { out("detail", { err: String(e).slice(0, 120) }); }
  }
  api.sort((a, b2) => b2.ms - a.ms);
  out("api_" + visit, api.slice(0, 14));
  out("api_count_" + visit, { n: api.length, over2s: api.filter((a) => a.ms > 2000).length, waitOver1s: api.filter((a) => a.wait > 1000).length, ttfbOver1s: api.filter((a) => a.ttfb > 1000).length });
  await p.close();
}
await b.close();
