/* ═══════════════════════════════════════════════════════════════════════════
   [V33.403] XALPHA·FLOW 소급생성이 ★닿지 못하는 과거★ 를 말하게 한다

   ■ 구조적 사실 (고치는 게 아니라 알아야 하는 것)
     이 소급은 패널을 ★daily: 캐시(≈320봉)★ 로 만든다 — 배치당 D1 1회라는 의도된 비용 설계다
     (deep history 는 종목마다 R2 읽기라 워커 예산에 안 맞는다).
     그런데 ml_samples 는 ★2,320일★ 을 덮는다. 그 차이만큼의 과거 날짜는 우주가 얇아
     통째로 건너뛰고 ★커서는 전진한다★ — 그 행들의 XALPHA·FLOW 표본은 ★영구 손실★ 이다.

   ■ 그런데 두 가지가 더 나빴다
     ① 아무도 세지 않았다. 로그는 "건너뜀 N" 만 적어 '얼마나·언제까지 못 닿는지' 를 못 말했다.
        XALPHA 가 왜 굶는지 물을 때마다 추측이 됐다.
     ② ★닿지 않는 날짜가 배치 예산을 먹었다.★ 종전엔 가장 오래된 6일을 ★잘라 놓고★ 돌았다.
        ml_samples 의 id 는 ts 순이 아니라(판갈이 캐치업이 옛 봉을 나중에 적재한다)
        배치에 닿지 않는 옛 날짜만 6개 들어오면 ★그 회차는 0건을 만들고 끝난다.★
        예산은 '일을 얼마나 할까' 를 묶는 장치인데 ★일을 안 한 날짜★ 가 그것을 먹은 셈이다.

   ■ 고치면서 깨뜨리면 안 되는 것 (V33.187 의 규칙)
     "한 날짜는 반드시 끝낸다 = 커서는 반드시 전진한다 = 스윕은 반드시 끝난다."
     건너뛴 날짜도 lastId 를 올려야 한다. 안 그러면 영원히 제자리다(실측 정지 사고가 있었다).
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

const body = (name) => {
  const i = S.indexOf("async function " + name);
  if (i < 0) return "";
  let d = 0, k = S.indexOf("{", i), e = k;
  for (; e < S.length; e++) { const c = S[e]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
  return S.slice(k, e + 1);
};
const B = body("altSampleBackfill");
chk(B.length > 3000, "altSampleBackfill 본문 " + B.length + "자를 떼어냈다", "본문 추출이 깨졌다");

console.log("\n① ★닿지 않는 날짜가 배치 예산을 먹지 않는가★");
{
  const iBudget = B.indexOf("if (_dProc >= _bDates) break;");
  const iThin = B.indexOf("if (_snapN < 20) {");
  const iProc = B.indexOf("_dProc++;");
  chk(iBudget > 0, "예산 가드가 ★처리한 날짜(_dProc)★ 를 센다",
    "★예산 가드가 없거나 훑은 날짜를 센다 — 닿지 않는 날짜가 회차를 통째로 먹는다★");
  chk(iThin > 0 && iProc > iThin,
    "_dProc++ 가 ★도달 판정 뒤★ 에 온다 — 건너뛴 날짜는 예산에 안 들어간다",
    "★_dProc 를 도달 판정 앞에서 올린다 — 고치기 전과 같아진다★");
  chk(!/\.sort\(\)\.slice\(0, _bDates\)/.test(B),
    "가장 오래된 _bDates 일을 미리 잘라 놓지 않는다",
    "★여전히 미리 잘라 놓고 돈다 — 닿지 않는 날짜만 6개 들어오면 0건으로 끝난다★");
}

console.log("\n② ★커서는 여전히 반드시 전진하는가★ (V33.187 의 규칙을 안 깨뜨렸는가)");
{
  const iThin = B.indexOf("if (_snapN < 20) {");
  const blk = B.slice(iThin, iThin + 420);
  chk(/lastId = Math\.max\(lastId, r\.id\)/.test(blk),
    "건너뛴 날짜도 lastId 를 올린다 — 커서가 멈추지 않는다",
    "★건너뛴 날짜가 커서를 안 올린다 — 다음 회차가 같은 날짜를 또 집어 온다(영원히 제자리)★");
  chk(/_scanCapDays/.test(B), "훑는 날짜에 상한이 있다(우주 슬라이스도 공짜가 아니다)",
    "★상한 없이 훑는다 — 워커 시간예산을 넘길 수 있다★");
  chk(/if \(_dl && _dDone > 0 && Date\.now\(\) > _dl\) break;/.test(B),
    "마감시한은 종전 그대로다(한 날짜는 끝내고 본다)", "마감시한 규칙이 바뀌었다");
}

console.log("\n③ 훑기 상한이 실제로 유계인가 (식을 떼어 실행한다)");
{
  const m = /const _scanCapDays = ([^;]+);/.exec(B);
  chk(!!m, "상한 식을 떼어냈다", "상한 식을 못 찾는다");
  if (m) {
    const f = new Function("_daysAll", "_bDates", "return " + m[1].replace(/_daysAll\.length/g, "_daysAll") + ";");
    const rows = [[1000, 6], [3, 6], [1000, 1], [0, 6]];
    let bad = null;
    for (const [n, b] of rows) {
      const v = f(n, b);
      if (!(v <= n && v >= Math.min(n, b) && v <= Math.max(b * 10, b))) bad = n + "/" + b + "→" + v;
    }
    chk(bad === null,
      "날짜수·예산 조합에서 상한이 [min(n,b), b×10] 안에 있다 — " +
        rows.map(function (r) { return r[0] + "일×예산" + r[1] + "→" + f(r[0], r[1]); }).join(" · "),
      "★상한이 유계가 아니다: " + bad + "★");
  }
}

console.log("\n④ ★영구 손실을 소리내어 말하는가★");
{
  for (const k of ["_dayThin", "_lostRows", "_thinNewest", "_thinOldest", "_okOldest", "_snapMin", "_snapMax"])
    if (B.indexOf(k) < 0) { console.log("  FAIL ★" + k + " 를 세지 않는다★"); fails++; }
  console.log("  ok   닿은 날/못 닿은 날·손실 행수·우주폭을 전부 센다");
  chk(/영구손실/.test(B), "반환 문구가 ★영구손실★ 이라고 명시한다 — 커서가 전진해 다시 안 온다",
    "★손실을 '건너뜀' 으로만 적는다 — 되돌릴 수 있는 것처럼 읽힌다★");
  chk(/우주폭/.test(B) && /닿은 가장 오래된 날/.test(B),
    "우주 폭과 ★닿은 가장 오래된 날짜★ 를 적는다 — 천장이 어디인지 숫자로 말한다",
    "천장을 숫자로 말하지 않는다");
  chk(/XALPHA 실패내역/.test(B), "V33.178 의 패널부족 내역은 그대로 남아 있다(회귀 방지)",
    "★패널부족 내역이 사라졌다 — XALPHA 0건의 이유를 다시 못 말하게 된다★");
}

console.log("\n⑤ 시장 구분은 여전히 옳은가 (패널은 같은 시장 안에서만 순위를 낸다)");
{
  const pb = S.slice(S.indexOf("function xalphaBuildPanel"), S.indexOf("function xalphaBuildPanel") + 900);
  chk(/const isKR = \/\\\.\(KS\|KQ\)\$\/\.test\(sy\)/.test(pb) && /\(market === "kr"\) !== isKR\) continue/.test(pb),
    "패널이 .KS/.KQ 로 시장을 갈라 ★같은 시장 안에서만★ 순위를 낸다",
    "★패널이 시장을 안 가른다 — 미국과 한국을 한 분포에 넣고 순위를 낸다★");
  chk(M.XALPHA.minPanel >= 20, "minPanel " + M.XALPHA.minPanel + " — 얇은 패널의 순위는 정보가 아니라 잡음이다",
    "minPanel 이 낮아졌다 — 얇은 패널에서 순위를 낸다");
}

console.log(fails === 0 ? "\n✓ 소급 도달범위 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
