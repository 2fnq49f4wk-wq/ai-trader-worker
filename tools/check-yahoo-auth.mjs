/* [V33.361 · A-6] ★v7 이 빈 배열을 주는 마지막 미관측 지점 — cookie·crumb 악수★
 *
 *   v7 quote 는 2023년부터 cookie + crumb 를 요구한다. crumb 없이 나가면 야후는
 *   ★예외도 오류도 없이 빈 배열★ 을 준다 — 우리가 실측한 `result=0 keys=quoteResponse` 다.
 *   그런데 `getYahooAuth` 는 실패해도 `catch (e) {}` 로 ★아무 것도 남기지 않았다.★
 *   두 v7 경로 모두 `if (auth && auth.crumb)` 라 crumb 이 없으면 조용히 빼고 나간다.
 *   즉 A-6 을 볼 때 ★이 자리를 의심할 근거 자체가 없었다.★
 *
 *   ※ 이 게이트는 "v7 을 고쳤다" 고 주장하지 않는다(야후로 나갈 수 없어 실제 응답을 못 봤다).
 *     지키는 것은 ★다음 사이클이 답할 수 있는 상태★ 다.
 *
 *   그리고 쿠키 파싱에 진짜 위험이 하나 있었다: Workers 의 headers.get("set-cookie") 는
 *   여러 Set-Cookie 를 ", " 로 이어 붙인 한 문자열을 준다. `.split(";")[0]` 만 하면
 *   ★첫 쿠키만★ 남는다. 그 파싱을 ★실행해서★ 잰다.
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const fn = src.slice(src.indexOf("async function getYahooAuth(DB) {"),
                     src.indexOf("async function", src.indexOf("async function getYahooAuth(DB) {") + 40));

// ── ① 실패가 기록되는가 ──────────────────────────────────────────────────────
{
  ok(/yahoo_auth_probe/.test(fn), "악수 결과를 yahoo_auth_probe 에 남긴다");
  for (const [k, why] of [["httpCookie", "쿠키 요청의 HTTP 상태"], ["httpCrumb", "crumb 요청의 HTTP 상태"],
                          ["cookieN", "쿠키 개수"], ["crumbLen", "crumb 길이"], ["err", "무엇이 틀렸나"]])
    ok(fn.indexOf(k) >= 0, `  · ${k} — ${why}`);
  ok(/if \(!_probe\.ok\)/.test(fn) && /\[야후인증\]/.test(fn),
     "실패하면 WARN 을 남긴다(종전엔 catch 가 통째로 삼켰다)");
  ok(/성공이든 실패든 남긴다/.test(fn), "성공일 때도 기록한다 — '인증은 정상' 을 말할 수 있어야 원인에서 뺀다");
  ok(!/catch \(e\) \{ \/\* 실패 시 기존값 유지/.test(fn), "옛 침묵 catch 가 사라졌다");
  ok(/return __yahooAuth;/.test(fn), "실패해도 직전 인증으로 계속 버틴다(동작을 안 바꾼다)");
}

// ── ② 자가진단이 v7 오류 ★같은 줄★ 에 인증 상태를 붙이는가 ────────────────────
{
  const i = src.indexOf("야후 v7(미국 시세 1차 수집원)이 ★응답은 하는데");
  const blk = src.slice(i, i + 1800);
  ok(/yahoo_auth_probe/.test(blk), "v7 ERROR 문장이 인증 기록을 함께 읽는다");
  ok(/인증은 정상/.test(blk) && /인증 악수 실패/.test(blk),
     "정상·실패 두 경우를 모두 말한다(정상이면 '원인은 인증이 아니다' 로 후보를 줄인다)");
}

// ── ③ ★쿠키 파싱을 실행해서 잰다★ — 여러 Set-Cookie 가 합쳐져 와도 살아남는가 ──
{
  /* 소스의 폴백 분리 정규식을 그대로 꺼내 쓴다(두 벌이 되면 갈라진다). */
  const m = /_raw\.split\((\/[^/]+\/)\)/.exec(fn);
  ok(!!m, "폴백 쿠키 분리 정규식을 소스에서 찾았다");
  if (m) {
    const re = eval(m[1]);
    // Workers 가 실제로 주는 모양: 여러 Set-Cookie 가 ", " 로 이어진 한 문자열
    const raw = "A1=d=AQ; Expires=Tue, 15 Sep 2027 00:00:00 GMT; Path=/, A3=d=AQB; Expires=Tue, 15 Sep 2027 00:00:00 GMT; Path=/";
    const parsed = raw.split(re).map((c) => String(c).split(";")[0])
                      .filter((c) => c && c.indexOf("=") > 0).join("; ");
    ok(/A1=/.test(parsed) && /A3=/.test(parsed),
       `합쳐진 Set-Cookie 에서 쿠키 2개를 모두 살린다 → "${parsed}"`);
    // 대조군 — 종전 방식은 첫 쿠키만 남는다
    const oldWay = raw.split(";")[0];
    ok(/A1=/.test(oldWay) && !/A3=/.test(oldWay),
       `대조군 — 종전 \`.split(";")[0]\` 은 첫 쿠키만 남긴다 → "${oldWay}"`);
    // 날짜 안의 쉼표(", 15 Sep") 에서 쪼개지면 안 된다
    ok(parsed.split("; ").length === 2,
       `Expires 안의 쉼표에서 잘못 쪼개지지 않는다(조각 ${parsed.split("; ").length}개)`);
  }
  /* ★있다는 것과 닿는다는 것은 다르다.★ 첫 판본은 문자열만 찾아서,
     조건을 `if (false)` 로 막는 돌연변이를 놓쳤다 — 진짜 typeof 검사인지 본다. */
  ok(/if \(typeof r1\.headers\.getSetCookie === "function"\) \{/.test(fn),
     "표준 getSetCookie() 경로가 ★실제로 닿는 조건★ 으로 열려 있다(상수로 막혀 있지 않다)");
  ok(/_all\.map\(function \(c\) \{ return String\(c\)\.split\(";"\)\[0\]; \}\)/.test(fn),
     "그 경로가 쿠키를 낱개로 받아 이름=값만 모은다");
}

// ── ④ 두 v7 경로가 ★같은 방식★ 으로 crumb 을 붙이는가 ────────────────────────
{
  const n = (src.match(/if \(auth && auth\.crumb\) url \+= "&crumb="/g) || []).length;
  ok(n >= 2, `v7 URL 을 만드는 곳 ${n}군데가 같은 방식으로 crumb 을 붙인다(한쪽만 붙이면 한쪽만 죽는다)`);
}

console.log(fail ? "\n야후 인증 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   야후 인증 계약 통과");
process.exit(fail ? 1 : 0);
