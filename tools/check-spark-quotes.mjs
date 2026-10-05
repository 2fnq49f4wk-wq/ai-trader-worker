/* [V33.478] ★spark 배치 시세 검사★ — v7 이 빈 배열을 줄 때 미국 시세가 종목당 1회 폴백(1종목/1회)으로
   떨어지던 것을 spark 배치(20종목/1회)로 메운다. ① 두 응답 모양을 같은 규칙(마지막 일봉=가격, 그 앞=전일종가)으로 읽는가
   ② batchQuotes 가 v7 다음 · 종목당 폴백 앞에서 부르고, 첫 묶음 0건이면 멈추는가 ③ 자가진단이 그 상태를 읽는가 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const near = (a, b) => Math.abs(a - b) < 1e-9;
console.log("① 파싱");
const full = { spark: { result: [
  { symbol: "AAPL", response: [{ meta: { chartPreviousClose: 90 }, indicators: { quote: [{ close: [95, null, 100, 110] }] } }] },
  { symbol: "ONE", response: [{ meta: { chartPreviousClose: 50 }, indicators: { quote: [{ close: [55] }] } }] },
  { symbol: "NIL", response: [{ meta: {}, indicators: { quote: [{ close: [null, 0] }] } }] } ] } };
const a = M.parseSparkQuotes(full, ["AAPL", "ONE", "NIL"]);
chk(a.AAPL && a.AAPL.price === 110 && a.AAPL.prevClose === 100 && near(a.AAPL.dayPct, 10), "정식형: 마지막=가격 · 그 앞=전일종가 · null 건너뜀", "★정식형 해석이 폴백과 다르다★ " + JSON.stringify(a.AAPL));
chk(a.ONE && a.ONE.price === 55 && a.ONE.prevClose === 50, "일봉 1개면 chartPreviousClose 를 전일종가로", "★일봉 1개 처리★ " + JSON.stringify(a.ONE));
chk(!a.NIL, "값이 없으면 지어내지 않는다", "★빈 종목에 가격을 만든다★");
const comp = { MSFT: { symbol: "MSFT", close: [400, 410], chartPreviousClose: 395 }, ZZZ: { close: [] } };
const b = M.parseSparkQuotes(comp, ["MSFT", "ZZZ", "GONE"]);
chk(b.MSFT && b.MSFT.price === 410 && b.MSFT.prevClose === 400, "압축형 {SYM:{close}} 도 같은 규칙", "★압축형 해석★ " + JSON.stringify(b.MSFT));
chk(!b.ZZZ && !b.GONE && Object.keys(M.parseSparkQuotes(null, ["A"])).length === 0, "빈 응답·없는 종목은 비운다", "★빈 응답에서 값이 생긴다★");
chk(M.SPARK_CHUNK <= 20, "묶음 ≤ 20(야후 spark 상한)", "★묶음이 상한을 넘는다★");
console.log("② 배선");
const i7 = S.indexOf('setState(opts.DB, "yahoo_v7"'), iS = S.indexOf("--- 1.5) [V33.478]"), iF = S.indexOf("--- 2) v7 으로 채워지지 않은 심볼만 v8 chart 로 폴백");
chk(i7 > 0 && iS > i7 && iF > iS, "v7 → spark → 종목당 폴백 순서", "★spark 가 제자리에 없다★");
const blk = S.slice(iS, iF);
chk(/if \(sparkGot > 0 && _ch\.length > 1\)/.test(blk), "첫 묶음 0건이면 나머지 묶음을 안 부른다(예산 낭비 1회)", "★spark 가 막혀도 계속 부른다★");
chk(/endsWith\("\.KS"\) \|\| s\.endsWith\("\.KQ"\)/.test(blk) && /!naverXV\[s\]/.test(blk), "한국 종목은 보내지 않는다(네이버가 1차)", "★한국 종목이 spark 로 샌다★");
chk(/isExtendedHoursWindow\("us"\)\) \? 40 : 0/.test(blk), "시간외 창엔 보강 몫 40 을 남긴다", "★spark 가 시간외 보강 예산을 먹는다★");
chk(/const SPARK_PATHS = \["v7\/finance\/spark", "v8\/finance\/spark"\]/.test(S) && /if \(Object\.keys\(got\)\.length\) \{ __sparkPath = pth; return got; \}/.test(S) && !/v8\/finance\/spark\?symbols=" \+/.test(S),
  "[V33.482] spark 경로: v7 먼저 · 0건이면 v8 · 통한 길 기억 (v8 404 실측)", "★spark 경로가 v8 하나에 박혀 있다★");
console.log("③ 자가진단");
chk(/getState\(DB, "yahoo_spark", null\)/.test(S) && /_spkOk \? "warn" : "error"/.test(S), "spark 가 메우면 경고, 못 메우면 오류", "★자가진단이 spark 상태를 안 읽는다★");
console.log(fails ? "\n✗ spark 배치 시세 검사 실패 " + fails : "\n✓ spark 배치 시세 검사 통과");
process.exit(fails ? 1 : 0);
