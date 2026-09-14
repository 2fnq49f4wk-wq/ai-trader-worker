/* [V33.351 · A-7] 휴장 중 남아 있는 시간외 값에 ★나이★ 가 없었다
 *
 *   extKeepMask 는 CLOSED 동안 장후 값을 ★일부러★ 유지한다(야후와 같은 규칙, 의도적).
 *   그래서 금요일 장후 값이 월요일 장전까지 3일간 화면에 남는데, 종전엔 그게
 *   ★지금 값처럼★ 보였다. 화면이 "장후 105.20 +0.8%" 라고만 말하면 보는 사람은
 *   그게 방금 값인 줄 안다. 거래는 신선도 가드(extTs, 7분)가 이미 막고 있으니
 *   이건 표시 문제다 — 그렇다고 작은 문제는 아니다.
 *   ★값을 지어내지 않는 것과 값의 나이를 숨기지 않는 것은 같은 원칙이다.★
 *
 *   문자열 검사로는 지킬 수 없다 — HTML 에서 함수를 잘라 ★실제로 실행★ 한다.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

const i = H.indexOf("function extAgeTxt(");
const j = H.indexOf("\n  }", i);
ok(i > 0 && j > i, "extAgeTxt 를 화면 코드에서 잘라냈다");
if (i < 0) { console.log("\n실패 1건"); process.exit(1); }
const ctx = vm.createContext({ Date, Math, isFinite });
vm.runInContext(H.slice(i, j + 4) + "\nglobalThis.f = extAgeTxt;", ctx);
const f = ctx.f;

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const ago = (min) => NOW - min * 60000;

// 신선하면 아무것도 안 붙는다 — 매번 붙으면 그게 잡음이다
ok(f(ago(0), NOW) === "", "방금 값 → 표시 없음");
ok(f(ago(19), NOW) === "", "19분 전 → 표시 없음(문턱 20분 안)");
// 낡으면 말한다
ok(f(ago(20), NOW) === "20분 전", `20분 전 → "${f(ago(20), NOW)}"`);
ok(f(ago(59), NOW) === "59분 전", `59분 전 → "${f(ago(59), NOW)}"`);
ok(f(ago(60), NOW) === "1시간 전", `60분 전 → "${f(ago(60), NOW)}"`);
ok(f(ago(23 * 60 + 59), NOW) === "23시간 전", `23시간 59분 전 → "${f(ago(23 * 60 + 59), NOW)}"`);
// ★금요일 장후 → 월요일 장전★ 이 이 결함의 실제 모습이다
ok(f(ago(3 * 24 * 60), NOW) === "3일 전", `3일 전 → "${f(ago(3 * 24 * 60), NOW)}" (금요일 장후가 월요일까지 남는 그 경우)`);

// 모르는 것은 모른다고 말한다
ok(f(0, NOW) === "시각미상", "extTs 가 0 → '시각미상'");
ok(f(null, NOW) === "시각미상", "extTs 가 없음 → '시각미상'");
ok(f(NaN, NOW) === "시각미상", "extTs 가 NaN → '시각미상'");
ok(f("abc", NOW) === "시각미상", "extTs 가 문자열 → '시각미상'");
// 시계 차이로 미래가 찍히면 조용히 넘어간다(틀린 숫자를 보여 주느니 안 보여 준다)
ok(f(NOW + 60000, NOW) === "", "미래 시각 → 표시 없음");

// 문턱은 인자로 바꿀 수 있다(장전/장후에 다른 기준을 쓰고 싶을 때)
ok(f(ago(10), NOW, 5) === "10분 전", "문턱을 5분으로 주면 10분 전도 말한다");

/* 배선 — 함수가 맞아도 카드가 안 쓰면 화면은 그대로다 */
const card = H.slice(H.indexOf("var extLine = ''"), H.indexOf("var extLine = ''") + 1400);
ok(/extAgeTxt\(q\.extTs\)/.test(card), "워치리스트 카드가 q.extTs 로 나이를 만든다");
const preOk = /장전 .*_ageTag/.test(card), postOk = /장후 .*_ageTag/.test(card);
ok(preOk && postOk, `장전·장후 두 줄 모두에 나이가 붙는다 (장전 ${preOk} · 장후 ${postOk})`);
ok(/\.wl-ext-age\{/.test(H), "나이 표시에 자기 스타일이 있다(값보다 흐리게)");

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
