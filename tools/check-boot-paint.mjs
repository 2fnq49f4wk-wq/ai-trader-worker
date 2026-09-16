/* [V33.367] 접속 첫 화면 계약 — 흰 화면과 "인트로 뒤에 로딩되는 것"
 *
 *   ★고친 결함 ①★ 인트로 전에 흰 화면이 보였다. 브라우저는 <head> 의 렌더링 차단 자원을
 *   다 받기 전에는 아무것도 못 칠하는데, 배경색을 정하는 첫 <style> 앞에 차단 자원이 둘 있었다
 *   (동기 <script> 와 외부 오리진 폰트 스타일시트). 그동안 기본 흰색이 칠해졌다.
 *
 *   ★고친 결함 ②★ 인트로를 ★고정 4.2초★ 뒤에 무조건 걷었다. 준비 여부를 보지 않아
 *   인트로가 사라진 화면에 "로딩 중…" 이 남아 있었다.
 *
 *   ★문자열 검사로는 안 된다(V33.337).★ LUXBOOT 를 소스에서 잘라 ★실제로 돌려★,
 *   준비가 끝나야 열리는지 · 실패해도 열리는지 · 영영 안 끝나도 상한에서 열리는지 본다.
 */
import { readFileSync } from "node:fs";
const H = readFileSync("public/index.html", "utf8");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.log("  ✗ FAIL " + m); } };

// ── ① 첫 페인트를 막는 것이 배경색보다 앞에 없는가 ────────────────────────────
{
  /* ★주석을 먼저 걷어낸다.★ 이 게이트의 첫 판은 설명 주석 안에 예시로 적은
     `<script src=...>` · `<link ... fonts>` 를 ★실제 태그로 세어★ 멀쩡한 코드를 떨어뜨렸다.
     주석은 브라우저가 받지도 그리지도 않는다 — 세면 안 된다. */
  const head = H.slice(0, H.indexOf("</head>")).replace(/<!--[\s\S]*?-->/g, "");
  const bgAt = head.indexOf("html.lux-booting{background:");
  ok(bgAt > 0, "임계 배경색이 <head> 에 있다");
  const before = head.slice(0, bgAt);
  const syncScript = /<script(?![^>]*\b(defer|async|type=["']module)["']?)[^>]*\bsrc=/i.test(before);
  ok(!syncScript, "★배경색보다 앞에 동기 <script src> 가 없다★ (있으면 그동안 흰 화면이다)");
  const blockingCss = [...before.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi)]
    .filter(m => !/media=["']print["']/i.test(m[0]));
  ok(blockingCss.length === 0,
     `★배경색보다 앞에 렌더링 차단 스타일시트가 없다★ (지금 ${blockingCss.length}개)`);
  // 폰트는 비차단으로 받되, JS 없는 환경을 버리지 않는다
  ok(/fonts\.googleapis\.com[^>]*media="print"[^>]*onload="this\.media='all'/.test(head),
     "폰트 스타일시트를 비차단으로 받는다(media=print → onload)");
  ok(/<noscript><link[^>]*fonts\.googleapis\.com/.test(head), "JS 가 꺼져 있어도 폰트는 받는다(noscript)");
  ok(/<html lang="ko" class="lux-booting">/.test(H), "<html> 이 첫 바이트부터 부팅 상태를 들고 있다");
  ok(/neural-observatory\.js\?v=[\d.]+" defer><\/script>/.test(H), "무거운 외부 스크립트가 파싱을 안 막는다(defer)");
}
// 인트로가 걷힐 때 배경 고정을 푼다 — 안 풀면 라이트 테마 오버스크롤이 어두워진다
ok((H.match(/classList\.remove\('lux-booting'\)/g) || []).length >= 2,
   "인트로가 걷힐 때(그리고 최후 보루에서도) 배경 고정을 푼다");

// ── ② LUXBOOT 를 실제로 돌린다 ────────────────────────────────────────────────
const src = H.slice(H.indexOf("window.LUXBOOT = (function () {"), H.indexOf("/* 자원(이미지·스크립트·스타일)"));
ok(src.length > 200, "LUXBOOT 를 소스에서 잘라냈다");

function makeBoot() {
  const timers = [];
  let now = 0;
  const ctx = {
    Date: { now: () => now },
    document: { getElementById: () => null },
    setTimeout: (f, ms) => { timers.push({ at: now + (ms || 0), f }); return timers.length; },
    Promise,
  };
  const fn = new Function("Date", "document", "setTimeout", "Promise",
    src + "\n return window_LUXBOOT;").bind(null);
  // 소스는 window.LUXBOOT 에 대입한다 — window 를 흉내 내 그대로 받는다.
  const win = {};
  const f2 = new Function("Date", "document", "setTimeout", "Promise", "window",
    src + "\n return window.LUXBOOT;");
  const B = f2(ctx.Date, ctx.document, ctx.setTimeout, ctx.Promise, win);
  const advance = async (ms) => {
    const end = now + ms;
    while (true) {
      const due = timers.filter(t => t.at <= end && !t.ran).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at; due.ran = true; due.f();
      await Promise.resolve(); await Promise.resolve();
    }
    now = end;
    await Promise.resolve(); await Promise.resolve();
  };
  return { B, advance, now: () => now };
}

console.log("\n  — LUXBOOT 을 실제로 돌려 본 결과 —");
{ // 준비가 빨리 끝나도 애니메이션은 끝까지 보여준다
  const { B, advance } = makeBoot();
  let opened = -1;
  B.whenReady(() => { opened = 0; });
  B.need('데이터'); B.done('데이터');
  await advance(1000);
  ok(opened === -1, "준비가 1초 만에 끝나도 ★애니메이션을 자르지 않는다★");
  await advance(4000);
  ok(opened === 0, "최소시간(4.2초)이 지나면 연다");
}
{ // 준비가 늦으면 기다린다 — 여기가 핵심이다
  const { B, advance } = makeBoot();
  let opened = false;
  B.whenReady(() => { opened = true; });
  B.need('데이터'); B.need('두뇌');
  await advance(6000);
  ok(!opened, "★준비가 안 끝났으면 4.2초가 지나도 안 연다★ (종전엔 여기서 열려 '로딩 중…' 이 보였다)");
  B.done('데이터');
  await advance(100);
  ok(!opened, "일부만 끝난 것으로는 안 연다");
  B.done('두뇌');
  await advance(100);
  ok(opened, "전부 끝나면 연다");
}
{ // 실패해도 열려야 한다
  const { B, advance } = makeBoot();
  let opened = false;
  B.whenReady(() => { opened = true; });
  B.track('데이터', Promise.reject(new Error('네트워크 끊김')));
  await advance(5000);
  ok(opened, "★한 시스템이 실패해도 연다★ (성공이 아니라 '끝남' 을 센다)");
}
{ // 영영 안 끝나도 상한에서 열려야 한다
  const { B, advance } = makeBoot();
  let opened = null;
  B.whenReady((why) => { opened = why; });
  B.need('영영끝나지않음');
  await advance(11000);
  ok(opened === null, "상한 전에는 계속 기다린다");
  await advance(2000);
  ok(opened === 'cap', "★영영 안 끝나도 상한에서 연다★ (기다리다 못 여는 일은 없다)");
}
{ // 약속이 아닌 것을 넘겨도 멈추지 않는다(패널 로더는 반환값이 제각각이다)
  const { B, advance } = makeBoot();
  let opened = false;
  B.whenReady(() => { opened = true; });
  B.track('숫자', 42); B.track('널', null); B.track('예외', undefined);
  await advance(5000);
  ok(opened, "약속이 아닌 반환값(숫자·null·undefined)도 그 자리에서 끝난 것으로 센다");
}
{ // 같은 이름을 두 번 세지 않는다 — 폴링이 부팅을 다시 붙잡으면 안 된다
  const { B, advance } = makeBoot();
  let opened = false;
  B.whenReady(() => { opened = true; });
  B.need('데이터'); B.done('데이터'); B.done('데이터'); B.need('데이터');
  await advance(5000);
  ok(opened && B.state().total === 1 && B.state().done === 1,
     "같은 이름을 다시 등록·완료해도 한 번만 센다(10초 폴링이 부팅을 다시 붙잡지 않는다)");
}

// ── ③ 배선: 실제 시스템들이 등록돼 있는가 ─────────────────────────────────────
for (const [re, label] of [
  [/LUXBOOT\.track\('데이터', _p0\)/, "데이터(/api/state)"],
  [/_step\('파이프라인', loadPipeline\)/, "파이프라인"],
  [/_step\('뉴스', loadNews\)/, "뉴스"],
  [/LUXBOOT\.need\('두뇌'\)/, "두뇌 관측"],
  [/LUXBOOT\.done\('두뇌'\)/, "두뇌 관측 완료 신호"],
  [/LUXBOOT\.need\('자원'\)/, "자원(window load)"],
  [/document\.fonts\.ready\.then/, "글꼴"],
]) ok(re.test(H), `부팅 준비에 ${label} 이(가) 들어 있다`);
ok(/window\.__luxBootTracked/.test(H), "첫 회차만 센다(이후 폴링은 인트로와 무관하다)");
ok(/LUXBOOT\.whenReady\(removeIntro\)/.test(H), "인트로가 ★준비 완료★ 를 기다린다");
ok(!/setTimeout\(removeIntro, 4200\);\n/.test(H.replace(/else setTimeout\(removeIntro, 4200\);[^\n]*/, "")),
   "★고정 4.2초 제거★ 는 사라졌다(추적기가 없을 때의 후퇴 경로만 남는다)");

console.log(fail ? `\n✗ 접속 첫 화면 계약 ${fail}건 실패 (총 ${n})` : `\n✓ 접속 첫 화면 계약 통과 (${n}개 단언)`);
process.exit(fail ? 1 : 0);
