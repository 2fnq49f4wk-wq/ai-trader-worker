/* [V33.366] 파일 전달 계약 — "다운로드가 안 된다"
 *
 *   ★고친 결함★ 파일 저장 경로가 `a[download]` 하나뿐이었다. 이 화면을 실제로 쓰는 자리는
 *   iPhone·카카오톡 인앱(스냅샷 userAgent)이고, ★iOS WKWebView 는 download 속성을 무시한다.★
 *   탭해도 아무 일이 없는데 화면은 "다운로드 완료" 토스트를 띄웠다.
 *
 *   ★문자열 검사로는 안 된다(V33.337).★ 소스에서 전달 함수를 잘라 ★가짜 DOM 위에서 실제로
 *   실행★ 하고, iPhone·데스크톱 두 환경에서 무엇이 벌어지는지 본다.
 */
import { readFileSync } from "node:fs";
const H = readFileSync("public/index.html", "utf8");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.log("  ✗ FAIL " + m); } };

// ── ① 앵커 ────────────────────────────────────────────────────────────────────
ok(/function deliverFile\(text, filename, mime\)/.test(H), "전달 경로가 한 벌(deliverFile)로 모였다");
ok(/return deliverFile\('\\uFEFF' \+ csvText/.test(H), "로그 CSV 도 같은 경로를 쓴다(두 벌이면 한쪽만 고쳐진다)");
ok(/navigator\.canShare\(\{ files: \[new File\(\[blob\], filename/.test(H), "파일 공유 가능 여부를 실제로 물어본다");
ok(/if \(e && e\.name === 'AbortError'\) return;/.test(H), "사용자가 공유를 취소한 것을 '실패' 라 하지 않는다");
ok(/_how === 'sheet' \? \('수집 완료 — 저장 방법을 고르세요'/.test(H),
   "★시트를 띄웠으면 '다운로드 완료' 라 말하지 않는다★");
ok(/navigator\.maxTouchPoints/.test(H), "아이패드(데스크톱 UA 위장)도 iOS 로 본다");

// ── ② 동작: 소스를 잘라 가짜 DOM 위에서 실제로 돌린다 ──────────────────────────
function slice(startMark, endMark) {
  const a = H.indexOf(startMark), b = H.indexOf(endMark, a);
  if (a < 0 || b < 0) { console.log("  ✗ FAIL 소스에서 " + startMark + " 를 못 잘랐다"); process.exit(1); }
  return H.slice(a, b);
}
const CODE = slice("  function _isIOSLike() {", "  function downloadCSV(");

/* ★가짜 환경이 실제를 닮아야 시험이 뜻을 가진다.★
   iOS 인앱에서 a[download] 는 ★예외를 던지지 않는다 — 조용히 아무 일도 안 한다.★
   (이 게이트의 첫 판은 예외를 던지게 만들어, 결함을 되살리는 돌연변이를 놓쳤다.
    던지면 catch 가 시트로 후퇴해 '고쳐진 것처럼' 보였다 — 조용한 실패가 바로 이 결함의 본질이다.)
   dlMode: 'works' 내려받아진다 · 'silent' 아무 일도 안 난다(iOS) · 'throws' 예외 */
function makeEnv({ ios, canShareFiles, dlMode }) {
  const log = { anchorClicks: 0, saved: 0, sheetShown: false, shared: 0, buttons: [], toasts: [] };
  const el = () => {
    const e = { children: [], style: "", textContent: "", type: "", id: "", href: "", download: "",
                _h: {}, setAttribute(k, v) { if (k === "style") this.style = v; else this[k] = v; },
                appendChild(c) { this.children.push(c); return c; },
                removeChild(c) { this.children = this.children.filter(x => x !== c); },
                remove() { log.sheetShown = false; },
                addEventListener(k, f) { this._h[k] = f; },
                click() {
                  if (!this.download) return;
                  log.anchorClicks++;
                  if (dlMode === "throws") throw new Error("download 무시됨");
                  if (dlMode === "works") log.saved++;      // 파일이 ★실제로★ 손에 들어갔다
                  /* 'silent' 는 여기서 아무 것도 안 한다 — iOS 인앱의 실제 모습이다 */
                },
                focus() {}, setSelectionRange() {} };
    return e;
  };
  const body = el();
  const doc = {
    createElement: () => el(),
    getElementById: () => null,
    body,
    execCommand: () => true,
  };
  const nav = {
    userAgent: ios ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) KAKAOTALK"
                   : "Mozilla/5.0 (Windows NT 10.0) Chrome/120",
    platform: ios ? "iPhone" : "Win32", maxTouchPoints: ios ? 5 : 0,
  };
  if (canShareFiles) {
    nav.canShare = () => true;
    nav.share = () => { log.shared++; return { catch: () => {} }; };
  }
  const ctx = {
    navigator: nav, document: doc,
    Blob: class { constructor(p) { this.size = String(p[0] || "").length; } },
    File: class { constructor(p, name) { this.name = name; } },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    window: { open: () => ({}) },
    setTimeout: () => 0,
    toast: (m) => log.toasts.push(m),
  };
  const fn = new Function("navigator", "document", "Blob", "File", "URL", "window", "setTimeout", "toast",
    CODE + "\n return { deliverFile: deliverFile, _isIOSLike: _isIOSLike };");
  const api = fn(ctx.navigator, ctx.document, ctx.Blob, ctx.File, ctx.URL, ctx.window, ctx.setTimeout, ctx.toast);
  // 시트가 떴는지: body 에 붙은 마지막 요소의 id 로 판정
  const origAppend = body.appendChild.bind(body);
  body.appendChild = (c) => { if (c.id === "luxFileSheet") { log.sheetShown = true; log.buttons = c.children[0].children.filter(x => x.type === "button"); } return origAppend(c); };
  return { api, log, body };
}

console.log("\n  — 실제로 돌려 본 결과 —");
/** 파일이 ★실제로★ 사용자 손에 들어갔거나, 들어갈 길이 열렸는가. */
const delivered = (log) => log.saved > 0 || log.sheetShown;

{
  const { api, log } = makeEnv({ ios: false, canShareFiles: false, dlMode: "works" });
  const how = api.deliverFile("{}", "a.json", "application/json");
  console.log(`     데스크톱: ${how} · 저장됨 ${log.saved} · 시트 ${log.sheetShown}`);
  ok(how === "download" && log.saved === 1 && !log.sheetShown,
     "데스크톱은 ★종전 그대로★ 즉시 내려받는다(회귀 없음)");
}
{
  // ★사고가 났던 그 환경★ — iPhone 인앱: download 는 조용히 무시된다.
  const { api, log } = makeEnv({ ios: true, canShareFiles: true, dlMode: "silent" });
  const how = api.deliverFile("{}", "a.json", "application/json");
  console.log(`     iPhone 인앱: ${how} · 저장됨 ${log.saved} · 시트 ${log.sheetShown} · 버튼 ${log.buttons.length}개`);
  ok(delivered(log), "★iPhone 인앱에서 파일이 실제로 손에 들어간다★ (종전엔 빈손이었다)");
  ok(how === "sheet" && log.sheetShown, "a[download] 를 믿지 않고 전달 시트를 띄운다");
  ok(log.anchorClicks === 0, "★안 되는 길을 시도조차 하지 않는다★ — 조용히 실패할 자리를 없앤다");
  ok(log.buttons.length >= 3, "저장·복사·새창 등 길이 여러 개다(하나가 막혀도 남는다)");
  const sb = log.buttons.find(b => /파일로 저장/.test(b.textContent));
  ok(!!sb, "공유가 되면 '파일로 저장' 이 뜬다");
  if (sb) sb._h.click();
  ok(log.shared === 1, "★그 버튼 탭 안에서 share 가 불린다★(비동기 뒤라 새 제스처가 필요하다)");
}
{
  const { api, log } = makeEnv({ ios: true, canShareFiles: false, dlMode: "silent" });
  api.deliverFile("{}", "a.json", "application/json");
  console.log(`     iPhone(공유 API 없음): 버튼 ${log.buttons.length}개`);
  ok(delivered(log) && log.buttons.length >= 2, "공유를 못 해도 복사·새창 길은 남는다");
  ok(!log.buttons.some(b => /파일로 저장/.test(b.textContent)),
     "안 되는 길을 버튼으로 내놓지 않는다(눌러도 안 되는 버튼은 거짓말이다)");
  const cp = log.buttons.find(b => /복사/.test(b.textContent));
  ok(!!cp, "복사 버튼이 있다");
  if (cp) { cp._h.click(); ok(log.toasts.some(t => /복사했다/.test(t)), "복사가 실제로 동작한다"); }
  else ok(false, "복사가 실제로 동작한다");
}
{
  const { api, log } = makeEnv({ ios: false, canShareFiles: false, dlMode: "throws" });
  const how = api.deliverFile("{}", "a.json", "application/json");
  ok(how === "sheet" && delivered(log), "내려받기가 예외를 던지면 시트로 후퇴한다(빈손으로 끝나지 않는다)");
}

console.log(fail ? `\n✗ 파일 전달 계약 ${fail}건 실패 (총 ${n})` : `\n✓ 파일 전달 계약 통과 (${n}개 단언)`);
process.exit(fail ? 1 : 0);
