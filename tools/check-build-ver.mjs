/* ═══════════════════════════════════════════════════════════════════════════
   [V33.280] 배포 버전이 진실인가 — 화면이 "배포됐다" 는 사실만은 거짓말하면 안 된다.

   ■ 무엇이 있었나 (운영 스냅샷 2026-08-30T23:12Z)
       "build": "V33.272"
     그런데 그 응답 안에는 V33.273 이 넣은 groupTest 도, V33.274 의 "잡음바닥 0.0164 제거"
     도 들어 있었다. 즉 ★코드는 최신인데 버전 문자열만 일곱 번 배포 동안 멈춰 있었다.★
     그러면 "내 고침이 올라간 건가" 를 화면으로 확인할 방법이 없다 — 관측 화면이
     자기 자신에 대해 거짓을 말하는 것이라, 다른 모든 숫자의 신뢰도까지 같이 깎인다.

   ■ 규칙
     배포되는 두 파일(src/index.js · public/index.html)에 적힌 ★가장 높은 V33.NNN★ 이
     _BUILD_VER 와 같아야 한다. 이 저장소는 고칠 때마다 [V33.NNN] 주석을 남기므로,
     버전을 올리지 않고 코드를 고치면 이 검사가 반드시 문다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const HV = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

const m = /const _BUILD_VER = "(V33\.\d+)";/.exec(S);
chk(!!m, `_BUILD_VER 를 읽었다 (${m && m[1]})`, "_BUILD_VER 를 못 찾는다");

const maxOf = (txt) => {
  let hi = 0, who = null;
  for (const x of txt.matchAll(/V33\.(\d+)/g)) { const n = +x[1]; if (n > hi) { hi = n; who = x[0]; } }
  return { n: hi, s: who };
};
const a = maxOf(S), b = maxOf(HV);
const top = a.n >= b.n ? a : b;
const cur = m ? +m[1].slice(4) : 0;
console.log(`       소스 최신 언급 ${top.s} (src ${a.s} · html ${b.s}) vs _BUILD_VER ${m && m[1]}`);
chk(cur === top.n,
  `배포 버전이 소스 최신과 일치한다 (${m && m[1]})`,
  `★버전이 멈춰 있다 — 소스는 ${top.s} 인데 _BUILD_VER 는 ${m && m[1]} 다. ` +
  `코드를 고쳤으면 _BUILD_VER 도 올려야 화면이 사실을 말한다★`);

/* 판 표식은 ★세 곳★ 에 있다 — src 의 _BUILD_VER, html 의 meta, 그리고 코드 주석.
   셋이 갈라지면 "새 버전 있음" 배너가 거짓으로 뜨거나 영영 안 뜬다.
   (check-html-js.mjs 가 src↔html 을 이미 대조한다 — 여기서는 그 값이 ★최신인지★ 를 본다) */
{
  const mv = /<meta name="lux-build" content="(V33\.\d+)">/.exec(HV);
  chk(mv && mv[1] === (m && m[1]),
    `화면 판 표식도 같다 (${mv && mv[1]})`,
    `★화면 판 표식이 다르다 (html ${mv && mv[1]} vs src ${m && m[1]})★`);
}

/* 자가진단·화면이 그 값을 실제로 내보내는가 — 상수만 맞고 안 쓰면 소용없다. */
chk(/\bbuild\s*[:=]\s*_BUILD_VER\b/.test(S),
  "응답의 build 필드가 _BUILD_VER 를 그대로 내보낸다(손으로 적은 문자열이 아니다)",
  "build 필드가 _BUILD_VER 가 아닌 값을 쓴다 — 두 곳이 갈라진다");
chk(!/build\s*[:=]\s*["']V33\./.test(S),
  "버전을 손으로 적어 내보내는 곳이 없다", "★버전 문자열을 손으로 적은 곳이 있다 — 언젠가 갈라진다★");

console.log(fails === 0 ? "\n✓ 배포 버전 계약 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
