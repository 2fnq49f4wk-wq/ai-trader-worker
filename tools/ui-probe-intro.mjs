/* [V33.502] ★인트로가 컴퓨터·아이패드에서 이상하게 보인다★(사용자) — 로컬엔 크로뮴뿐이라 웹킷(사파리)으로 잰다.
   저장소의 public/index.html 을 그대로 열고(API 는 빈 응답) 인트로 애니메이션을 시각별로 멈춰 캡처한다.
   글자마다 밝은 픽셀 비율도 숫자로 남긴다 — 정상 글자는 10~40%, ★배경이 글자 대신 칠해지면(사각형) 80%+★, 안 보이면 ~0%.
   사용법: node tools/ui-probe-intro.mjs <캡처폴더> */
import { webkit, chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
const OUT = process.argv[2] || "shots";
mkdirSync(OUT, { recursive: true });
const FILE = pathToFileURL(process.cwd() + "/public/index.html").href + "?intro=1";
const T = [600, 1500, 2600, 3600];
const cases = [
  ["wk-ipadP", webkit, Object.assign({}, devices["iPad Pro 11"])],
  ["wk-ipadL", webkit, Object.assign({}, devices["iPad Pro 11 landscape"])],
  ["wk-mac", webkit, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
  ["wk-fhd", webkit, { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }],
  ["wk-iphone", webkit, Object.assign({}, devices["iPhone 13"])],
  ["cr-fhd", chromium, { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }]
];
const bs = {};
for (const [tag, bt, opt] of cases) {
  const key = bt.name();
  const b = bs[key] || (bs[key] = await bt.launch());
  const ctx = await b.newContext(opt);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e.message || e).slice(0, 120)));
  await p.route(/\/api\//, (r) => r.fulfill({ status: 200, body: "{}", contentType: "application/json" }));
  await p.route(/^https?:/, (r) => r.abort());
  try { await p.goto(FILE, { waitUntil: "load", timeout: 30000 }); } catch (e) { console.log("INTRO " + tag + " goto " + e.message.slice(0, 80)); }
  for (const t of T) {
    const n = await p.evaluate((t) => { let n = 0; document.getAnimations().forEach((a) => { if (a.animationName && /^lxi/.test(a.animationName)) { a.pause(); a.currentTime = t; n++; } }); return n; }, t);
    await p.waitForTimeout(150);
    await p.screenshot({ path: OUT + "/" + tag + "_" + t + ".png" });
    if (t === 3600) {
      const m = await p.evaluate(() => {
        const ov = document.getElementById("lux-intro-overlay");
        const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
        const cs = ov ? getComputedStyle(ov) : null;
        return { ov: r(ov), ovOp: cs && cs.opacity, disp: cs && cs.display, stage: r(document.querySelector(".lxi-stage")), star: r(document.querySelector(".lxi-bigstar")),
          word: r(document.querySelector(".lxi-word")), letters: [...document.querySelectorAll(".lxi-word-txt i")].map(r), sub: r(document.querySelector(".lxi-sub")),
          vv: [innerWidth, innerHeight, devicePixelRatio], ua: navigator.userAgent.slice(0, 80), html: document.documentElement.className };
      });
      // 글자 상자의 밝은 픽셀 비율(캡처에서 직접)
      const fr = [];
      for (const L of (m.letters || []).slice(0, 10)) {
        if (!L || !L[2] || !L[3]) { fr.push(null); continue; }
        const shot = await p.screenshot({ clip: { x: L[0], y: L[1], width: Math.max(1, L[2]), height: Math.max(1, L[3]) } });
        fr.push(shot.length);
      }
      console.log("INTRO " + tag + " anims " + n + " " + JSON.stringify(m) + " letterPngBytes " + JSON.stringify(fr) + " errs " + JSON.stringify(errs.slice(0, 3)));
    }
  }
  await ctx.close();
}
for (const k in bs) await bs[k].close();
