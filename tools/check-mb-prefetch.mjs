/* [V33.564] 한국 단타 분봉 선행 병렬 조회 계약 — ★판단 불변★ · 연결 수 상한 · 낡은 값 재조회 · 실패 그대로 전달
 *   ① 꺼낸 값이 같은 함수를 직접 부른 값과 같다(같은 인자) ② 동시 조회 ≤ conc ③ 받은 지 maxAgeMs 를 넘기면 null(호출부가 새로 받는다)
 *   ④ 실패는 같은 예외로 전달 · 안 쓴 실패는 처리 안 된 거부로 남지 않는다 ⑤ 배선: 한국만 · 단타 분봉 자리에서 같은 인자로 대체 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
let unhandled = 0; process.on("unhandledRejection", () => { unhandled++; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ① · ②
let live = 0, peak = 0, calls = [];
const fetcher = async (s) => { calls.push(s); live++; peak = Math.max(peak, live); await sleep(15); live--; if (s === "BAD") throw new Error("naver 500"); return { sym: s, closes: [1, 2, 3] }; };
const syms = Array.from({ length: 20 }, (_, i) => "S" + i).concat(["BAD"]);
const pre = M.mbPrefetchStart(syms, fetcher, { conc: 4, max: 80 });
const a = await pre.take("S3"), b = await fetcher("S3");
chk(JSON.stringify(a) === JSON.stringify(b), "꺼낸 값 = 같은 함수를 직접 부른 값(판단 불변)");
await sleep(150);
chk(peak <= 4 + 1, "동시 조회 ≤ conc(4) — 직접 부른 1건 제외", String(peak));
chk(pre.take("ZZZ") === null && pre.take("S3") === null, "없는 종목·이미 꺼낸 종목은 null(호출부가 직접 받는다)");
let err = null; try { await pre.take("BAD"); } catch (e) { err = e; }
chk(err && /naver 500/.test(err.message), "실패는 같은 예외로 전달(종전 try/catch 그대로)");
chk(calls.filter((x) => x === "S5").length === 1, "종목마다 한 번만 받는다");
// ③ 낡은 값
const pre2 = M.mbPrefetchStart(["A"], async () => ({ v: 1 }), { conc: 1, maxAgeMs: 5 });
await sleep(30);
chk(pre2.take("A") === null && pre2.stale === 1, "받은 지 maxAgeMs 를 넘긴 값은 버린다(신선도 그대로)");
// ④ 안 쓴 실패
M.mbPrefetchStart(["X"], async () => { throw new Error("x"); }, { conc: 1 });
await sleep(30);
chk(unhandled === 0, "안 꺼낸 실패가 처리 안 된 거부로 남지 않는다", String(unhandled));
chk(M.MBPRE.conc <= 5 && M.MBPRE.conc >= 1 && M.MBPRE.maxAgeMs <= 90000, "연결 4개 이하 남김(Workers 동시 6) · 60초 신선도", JSON.stringify(M.MBPRE));
// ⑤ 배선
chk(/MBPRE\.enabled && market === "kr" && \(__scalpLive \|\| __stinPend\) && isMarketOpen\("kr"\)/.test(S), "한국만 · 단타가 분봉을 볼 때만 · 장중만");
chk(/const _pre = __mbPre \? __mbPre\.take\(symbol\) : null;[\s\S]{0,120}return _pre \|\| fetchMinuteBars\(symbol, \{ interval: SCALP_BAR_MIN \+ "m", range: "2d" \}\)/.test(S) &&
    /function \(sym\) \{ return fetchMinuteBars\(sym, \{ interval: SCALP_BAR_MIN \+ "m", range: "2d" \}\); \}/.test(S),
    "단타 분봉 자리: 선행분 또는 같은 인자로 직접 조회(지갑 결제 _enrichRun 안 그대로)");
if (fails) { console.log("\n✗ 분봉 선행 조회 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 분봉 선행 조회 통과");
