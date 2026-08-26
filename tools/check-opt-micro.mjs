/* ═══════════════════════════════════════════════════════════════════════════
   [V33.264] 옵션 미시구조 — 시계를 돌리되, 돌리다 넘어지지 않게

   요청은 "gamma exposure · 0DTE · open interest · convexity · delta-gamma Taylor
   를 학습시켜라" 였다. 그런데 이 저장소에 이미 답의 절반이 적혀 있다:
       "과거 옵션데이터는 수확 불가 → ML 피처로 쓰면 분포불일치."
   야후는 ★현재 체인만★ 준다. 51만 과거 표본에 GEX 를 소급해 넣을 방법이 없다.
   지금 피처로 밀어 넣으면 모델은 "GEX 가 0 이 아니면 최근 데이터" 를 배운다 —
   학습이 아니라 오염이고, featVer 를 올려 51만을 재구축한 뒤에 알면 되돌리는 데 또 하루다.

   그래서 이 단계는 ★기록만★ 한다. 이 검사가 지키는 것은 두 가지다:
     ① 수학이 맞는가 — 답을 아는 값으로 검산한다(추정치를 눈으로 검토하지 않는다)
     ② 기록 단계가 학습을 건드리지 않는가, 그리고 실패해도 조용히 넘어가지 않는가
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const G = M._bsDeltaGamma;
/* ★함수 본문은 중괄호 균형으로 자른다.★ 처음엔 "A 선언 ~ B 선언" 으로 잘랐는데,
   읽는 쪽(optMicroLatest)을 파일에서 수집기보다 ★앞에★ 두자 그 구간이 빈 문자열이 되어
   다섯 검사가 한꺼번에 실패했다. 실제 코드는 멀쩡했다 — 자르는 법이 선언 순서에
   의존하고 있었을 뿐이다. 순서가 바뀌면 틀리는 검사는 계약이 아니라 우연이다. */
function fnBody(name) {
  const i = code.indexOf("async function " + name + "(");
  if (i < 0) return "";
  const j = code.indexOf("{", i);
  let d = 0, k = j;
  for (; k < code.length; k++) { const c = code[k]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
  return code.slice(j, k + 1);
}

console.log("① 그릭스 — 답을 아는 값으로 검산한다");
{
  const c = G(100, 100, 0.25, 0.2, true, 0.04), p = G(100, 100, 0.25, 0.2, false, 0.04);
  chk(c && p && Math.abs((c.delta - p.delta) - 1) < 1e-9,
    "풋콜 패리티: Δcall − Δput = 1 (오차 " + Math.abs((c.delta - p.delta) - 1).toExponential(1) + ")",
    "패리티가 안 맞는다 — 델타 부호·정의가 틀렸다");
  chk(Math.abs(c.gamma - p.gamma) < 1e-12, "감마는 콜·풋이 같다", "콜/풋 감마가 다르다 — 공식 오류");
  chk(G(200, 100, 0.25, 0.2, true, 0.04).delta > 0.99 && G(50, 100, 0.25, 0.2, true, 0.04).delta < 0.01,
    "딥ITM Δ→1 · 딥OTM Δ→0", "극단 행사가에서 델타가 수렴하지 않는다");

  // 해석해 vs 수치미분 — 식을 눈으로 검토하는 대신 미분해서 대조한다
  const N = (x) => { const s2 = x < 0 ? -1 : 1, a = Math.abs(x) / Math.SQRT2,
    t = 1 / (1 + 0.3275911 * a);
    return 0.5 * (1 + s2 * (1 - ((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-a*a))); };
  const px = (s0) => { const sig=0.25, T=0.3, K=105, r=0.04, sq=sig*Math.sqrt(T);
    const d1=(Math.log(s0/K)+(r+0.5*sig*sig)*T)/sq, d2=d1-sq;
    return s0*N(d1) - K*Math.exp(-r*T)*N(d2); };
  const h = 1e-4;
  const dNum = (px(100+h)-px(100-h))/(2*h), gNum = (px(100+h)-2*px(100)+px(100-h))/(h*h);
  const a = G(100, 105, 0.3, 0.25, true, 0.04);
  chk(Math.abs(a.delta-dNum) < 1e-4, "Δ 해석해 == 수치미분 (오차 " + Math.abs(a.delta-dNum).toExponential(1) + ")", "델타가 가격의 1차 미분이 아니다");
  chk(Math.abs(a.gamma-gNum) < 1e-4, "Γ 해석해 == 2차 수치미분 (오차 " + Math.abs(a.gamma-gNum).toExponential(1) + ")", "감마가 가격의 2차 미분이 아니다");

  // 0DTE 가 감마를 지배하는 이유가 수치로 나와야 한다
  const g0 = G(100, 100, 1/365, 0.2, true, 0.04).gamma, g30 = G(100, 100, 30/365, 0.2, true, 0.04).gamma;
  chk(g0 / g30 > 3, "만기 1일 감마가 30일의 " + (g0/g30).toFixed(1) + "배 — 0DTE 를 따로 세는 근거",
    "짧은 만기에서 감마가 커지지 않는다 — 0DTE 지표의 전제가 무너진다");

  // ★못 구한 것과 0 은 다르다★ — 0 으로 뭉개면 그 계약이 조용히 '감마 없음' 으로 합산된다
  /* ★각 가드를 실제로 ★도달하는★ 입력으로 시험한다.★ 처음엔 IV=0·T=0·S=0·K=0 만 넣었는데,
     그 넷은 전부 ★첫 번째★ 가드에서 걸러진다. 그래서 두 번째 가드(sq 언더플로)를 0 으로
     뭉개는 변이를 넣어도 검사가 통과했다 — 시험한 적 없는 줄이었다.
     sigma 를 아주 작지만 0 보다 크게 주면 첫 가드를 지나 sq 가 0 으로 언더플로한다. */
  for (const [args, lbl] of [[[100,100,0.25,0,true,0.04],"IV=0"],[[100,100,0,0.2,true,0.04],"T=0"],
                             [[0,100,0.25,0.2,true,0.04],"S=0"],[[100,0,0.25,0.2,true,0.04],"K=0"],
                             [[100,100,0.25,1e-300,true,0.04],"IV 언더플로(첫 가드를 지나 sq=0)"],
                             [[100,100,1e-300,0.2,true,0.04],"T 언더플로"],
                             [[100,100,0.25,Infinity,true,0.04],"IV=∞"],
                             [[NaN,100,0.25,0.2,true,0.04],"S=NaN"]])
    if (G.apply(null, args) !== null) { console.log("  FAIL " + lbl + " 에서 null 이 아니라 값을 돌려준다"); fails++; }
  console.log("  ok   못 구하는 입력 8종(각 가드를 실제로 도달하는 값)은 0 이 아니라 null 을 돌려준다");
}

console.log("\n② 체인 집계 — 부호와 규약");
{
  const now = Date.UTC(2026, 0, 15);
  const mk = (strike, oi, iv) => ({ strike, openInterest: oi, impliedVolatility: iv });
  const ex = (days, calls, puts) => ({ expirationMs: now + days * 86400000, calls, puts });

  // 콜만 있으면 GEX 양수, 풋만 있으면 음수 (딜러 롱콜감마 / 숏풋감마 규약)
  const onlyC = M.optMicroFromChain(100, [ex(30, [mk(100, 1000, 0.2)], [])], now, M.OPTMICRO);
  const onlyP = M.optMicroFromChain(100, [ex(30, [], [mk(100, 1000, 0.2)])], now, M.OPTMICRO);
  chk(onlyC && onlyC.gex > 0, "콜 OI 만 → GEX 양수", "콜만 있는데 GEX 가 양수가 아니다");
  chk(onlyP && onlyP.gex < 0, "풋 OI 만 → GEX 음수", "풋만 있는데 GEX 가 음수가 아니다");
  chk(Math.abs(onlyC.gex + onlyP.gex) < 1e-6,
    "같은 행사가·같은 OI 면 콜/풋 GEX 가 정확히 상쇄된다(감마는 같고 부호만 다르다)",
    "상쇄되지 않는다 — 감마 대칭 또는 부호 규약이 깨졌다");
  chk(onlyC.convexity > 0 && onlyP.convexity > 0 && Math.abs(onlyC.convexity - onlyP.convexity) < 1e-6,
    "convexity 는 방향 무관 총량이라 콜·풋이 같다", "convexity 가 부호를 타고 있다");

  // 0DTE 비중
  const both = M.optMicroFromChain(100, [ex(0.5, [mk(100, 300, 0.2)], []), ex(30, [mk(100, 700, 0.2)], [])], now, M.OPTMICRO);
  chk(both && Math.abs(both.dte0Share - 0.3) < 1e-9,
    "0DTE 비중 = 만기 1일 이내 OI / 전체 OI (300/1000 = " + both.dte0Share + ")",
    "0DTE 비중이 " + (both && both.dte0Share) + " — 300/1000 이어야 한다");
  chk(both.oiTotal === 1000 && both.oiCall === 1000 && both.oiPut === 0, "OI 합계가 맞는다", "OI 집계가 틀렸다");

  // 델타-감마 테일러: 상방/하방 비대칭이 감마 때문에 생긴다(둘 다 +½Γ(ΔS)² 를 받는다)
  chk(both.dgTaylorUp > 0 && both.dgTaylorUp > Math.abs(both.dgTaylorDn),
    "델타-감마 테일러 상방 " + both.dgTaylorUp.toFixed(0) + " · 하방 " + both.dgTaylorDn.toFixed(0) +
    " — 2차항 때문에 비대칭",
    "테일러가 대칭이다 — 감마 2차항이 안 들어갔다(그러면 델타만 쓴 것과 같다)");

  // 빈 입력·이상 입력에 던지지 않는다 (야간 단계가 이걸로 죽으면 안 된다)
  for (const [a, lbl] of [[[0, [], now, M.OPTMICRO], "spot 0"], [[100, null, now, M.OPTMICRO], "만기 null"],
                          [[100, [ex(30, [], [])], now, M.OPTMICRO], "계약 0"],
                          [[100, [ex(30, [mk(0, 0, 0)], [])], now, M.OPTMICRO], "전부 무효 계약"]]) {
    let r; try { r = M.optMicroFromChain.apply(null, a); }
    catch (e) { console.log("  FAIL " + lbl + " 에서 예외를 던진다: " + e.message); fails++; continue; }
    if (r !== null) { console.log("  FAIL " + lbl + " 에서 null 이 아니다"); fails++; }
  }
  console.log("  ok   빈/이상 입력에서 예외 없이 null 을 돌려준다(야간 단계가 이걸로 죽지 않는다)");
}

console.log("\n③ 기록 단계가 학습을 건드리지 않는가");
{
  chk(!/LUXML\.featVer\s*=|featVer:\s*15/.test(code.slice(code.indexOf("OPTMICRO"), code.indexOf("OPTMICRO") + 9000)),
    "featVer 를 올리지 않는다 — 51만 표본 재구축이 일어나지 않는다", "featVer 를 건드린다");
  const nb = fnBody("optMicroNightly");
  chk(!/ml_samples|INSERT INTO|LUXML\.featNames\.push/.test(nb),
    "표본 테이블에 쓰지 않는다(기록 전용)", "야간 수집기가 학습 표본을 건드린다");
  chk(/fetchBudgetLeft\(\) < _num\(C\.minBudgetReserve/.test(nb),
    "예산이 모자라면 시작조차 하지 않는다", "예산 가드 없이 fetch 한다 — 다른 단계 예산을 먹는다");
  chk(/catch \(e\) \{ notes\.push/.test(nb),
    "한 심볼이 죽어도 나머지를 계속한다", "심볼 하나가 죽으면 전체가 멈춘다");
  chk(/catch \(e\) \{ return "\[OPTX\] 실패: "/.test(nb),
    "어떤 예외도 문자열로 돌려준다 — 야간 파이프라인을 끊지 않는다", "예외가 밖으로 새어나간다");
  chk(/★아직 학습용 아님\(기록 단계\)★/.test(S),
    "로그가 '아직 학습용이 아님' 을 명시한다", "기록 단계임을 로그가 말하지 않는다 — 나중에 오해한다");
}

console.log("\n④ 쓰기만 하고 아무도 안 읽는 기록이 아닌가");
{
  chk(/async function optMicroLatest\(DB\)/.test(code) && /optMicroLatest\(DB\)/.test(code.replace("async function optMicroLatest(DB)", "")),
    "읽는 쪽이 있고 실제로 불린다", "쓰기만 하고 읽는 곳이 없다 — 죽은 기록이다");
  chk(/옵션 미시구조 기록 중/.test(S) && /promoteAt/.test(code),
    "화면이 누적 일수와 승격 문턱을 함께 말한다", "진행 상황이 화면에 안 나온다");
  chk(M.OPTMICRO.promoteMinDays >= 30,
    "승격 문턱이 숫자로 못 박혀 있다(" + M.OPTMICRO.promoteMinDays + "일)",
    "'충분히 쌓이면' 이라는 말만 있고 숫자가 없다 — 그러면 아무도 판단하지 않는다");
  const nb = fnBody("optMicroNightly");
  chk(/idx\.days\.length > keep/.test(nb), "오래된 기록을 잘라낸다(무한 증식 방지)", "기록이 무한히 쌓인다");
  chk(/setState\(DB, "optx:" \+ day, rec\)/.test(nb),
    "날짜 키로 저장한다 — 하루 여러 번 돌아도 그날 것만 갱신된다", "덮어쓰기 구조라 과거가 날아간다");
}

console.log(fails === 0 ? "\n✓ 옵션 미시구조 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
