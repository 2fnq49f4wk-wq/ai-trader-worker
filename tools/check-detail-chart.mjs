/* [V33.333] 종목상세 — 확대 시 y축 · DMA/스토캐스틱 표시 계약
 *
 *   사용자: "종목 상세에서 그래프 확대하면 등락율 차이가 잘 안보인다".
 *   원인은 줌이 아니라 ★y축을 누가 정하느냐★ 였다. 종전엔 캔들 + 보조선(MA·볼밴) 전체가
 *   범위를 정했다. 좁게 확대하면 MA120·MA200 은 화면 밖 먼 값에 머무는데 그 값까지
 *   범위에 넣느라, 캔들이 몇 픽셀로 짜부라져 1~2% 움직임이 평평한 선이 됐다.
 *   → 범위는 캔들이 정하고, 보조선은 제한적으로만 넓히며, 넘치면 잘라 그린다.
 *
 *   이 검사는 ★실제 스케일 계산 블록을 꺼내 돌려★ 그 성질을 못박는다.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };

const chartSrc = (function () {
  const a = H.indexOf("  function buildProChart(cs, opts) {");
  const b = H.indexOf("\n  function ", a + 60);
  if (a < 0 || b < 0) throw Error("buildProChart 를 못 찾았다");
  return H.slice(a, b);
})();

// ── ① y축 범위를 ★실제 코드로★ 계산해 본다 ─────────────────────────────
{
  const a = chartSrc.indexOf("    var pmin = Infinity, pmax = -Infinity, i;");
  const b = chartSrc.indexOf("    // 한 페이지에 차트가 둘 이상일", a);
  if (a < 0 || b < 0) throw Error("가격 스케일 블록을 못 찾았다");
  const src = chartSrc.slice(a, b);

  function scale(candles, maLevels, withMA) {
    const ctx = vm.createContext({
      Math, Infinity, isFinite, _pcClipSeq: 0,
      show: candles, n: candles.length,
      ind: { boll: false, ma: withMA },
      bU: [], bL: [],
      maArr: maLevels.map((v) => candles.map(() => v))
    });
    vm.runInContext(src + "\n globalThis.out = { pmin: pmin, pmax: pmax, pspan: pspan, baseC: baseC };", ctx);
    return ctx.out;
  }
  // 100 근처에서 ±1% 움직이는 좁은 구간 + 화면 밖 먼 MA200(=60)
  const tight = [];
  for (let i = 0; i < 40; i++) {
    const c = 100 + Math.sin(i / 4) * 1.0;
    tight.push({ o: c, h: c + 0.3, l: c - 0.3, c: c });
  }
  const noMA = scale(tight, [], false);
  const farMA = scale(tight, [60], true);          // MA200 이 40% 아래
  const nearMA = scale(tight, [99.5], true);       // 캔들 바로 옆 MA

  if (farMA.pspan < noMA.pspan * 1.3)
    ok(`화면 밖 MA(60)가 있어도 y범위가 캔들에 붙어 있다(폭 ${noMA.pspan.toFixed(2)} → ${farMA.pspan.toFixed(2)}) — 확대하면 캔들이 화면을 채운다`);
  else
    bad(`★먼 MA 가 y축을 끌어당긴다(폭 ${noMA.pspan.toFixed(2)} → ${farMA.pspan.toFixed(2)}) — 확대해도 캔들이 평평해진다★`);

  if (farMA.pmin > 90)
    ok(`아래쪽 한계가 ${farMA.pmin.toFixed(1)} 로 캔들 근처다 — MA 60 까지 늘어나지 않았다`);
  else
    bad(`y축 하한이 ${farMA.pmin.toFixed(1)} 까지 내려갔다 — 먼 보조선을 그대로 담고 있다`);

  if (nearMA.pmin < noMA.pmin + 0.01 && nearMA.pmin <= 99.5)
    ok("가까운 MA(99.5)는 종전대로 범위에 포함된다 — 보조선을 무조건 버리는 게 아니다");
  else
    bad("가까운 보조선까지 범위에서 빠졌다 — 보조선이 화면에서 잘려 보이게 된다");

  // 확대할수록 폭이 좁아져야 한다(= 등락이 크게 보인다)
  const wide = [];
  for (let i = 0; i < 200; i++) { const c = 100 + i * 0.2; wide.push({ o: c, h: c + 0.3, l: c - 0.3, c: c }); }
  const zoomOut = scale(wide, [], false);
  const zoomIn = scale(wide.slice(-20), [], false);
  if (zoomIn.pspan < zoomOut.pspan * 0.3)
    ok(`확대(200봉 → 20봉)하면 y폭이 ${zoomOut.pspan.toFixed(1)} → ${zoomIn.pspan.toFixed(1)} 로 좁아진다 — 같은 등락이 더 크게 보인다`);
  else
    bad("확대해도 y폭이 그대로다 — 줌이 세로 해상도를 못 바꾼다");

  if (noMA.baseC === tight[0].c) ok("구간 첫 봉 종가를 % 기준으로 잡는다");
  else bad("% 기준가(baseC)가 구간 첫 봉이 아니다");
}

// ── ② 넘치는 보조선은 지워지는 게 아니라 ★잘려서★ 그려진다 ──────────────
{
  const hasDef = /<clipPath id="' \+ _clipId \+ '">/.test(chartSrc);
  const uses = (chartSrc.match(/clip-path="url\(#' \+ _clipId/g) || []).length;
  if (hasDef && uses >= 2)
    ok(`가격 패널에 clip 을 정의하고 보조선 그룹 ${uses}곳에 적용한다 — 선이 사라지지 않고 화면 밖으로 나갈 뿐이다`);
  else bad(`clip 처리가 없다(정의 ${hasDef} · 적용 ${uses}) — 범위 밖 보조선이 패널을 뚫고 그려진다`);
  if (!/Math\.random/.test(chartSrc)) ok("차트 렌더에 난수가 없다 — 새로고침해도 같은 화면이 나온다");
  else bad("차트 렌더에 Math.random 이 있다 — 재현되지 않는 화면이 된다");
}

// ── ③ 우측 축이 % 를 함께 적는가 ────────────────────────────────────────
{
  if (/pc-axis2/.test(chartSrc) && /\(gv - baseC\) \/ baseC/.test(chartSrc))
    ok("우측 축에 구간 시작 대비 % 를 함께 적는다 — 확대했을 때 등락 폭을 숫자로도 읽는다");
  else bad("% 축 라벨이 없다 — 확대해도 '얼마나 움직였나'를 숫자로 못 읽는다");
  if (/\.pc-axis2\{/.test(H)) ok("% 라벨 스타일이 정의돼 있다");
  else bad("pc-axis2 스타일이 없다 — 라벨이 기본 검정으로 나온다");
}

// ── ④ 종목상세에 DMA·스토캐스틱이 붙는가 ────────────────────────────────
{
  const d = H.slice(H.indexOf("function renderDetailHeaderData()"), H.indexOf("function loadDetailTaExtra"));
  if (/add\('DMA\(10,50\)'/.test(d) && /add\('스토캐스틱\(14,3,3\)'/.test(d))
    ok("종목상세에 DMA·스토캐스틱 행이 있다");
  else bad("종목상세에 새 지표 행이 없다");
  if (/_tx === undefined/.test(d) && /_tx === null/.test(d))
    ok("로딩 중('…')과 값 없음('—')을 구분한다 — 없다고 행을 빼면 '이 종목엔 지표가 없다'로 읽힌다");
  else bad("로딩 중과 값 없음을 구분하지 않는다");
  if (/과매수/.test(d) && /과매도/.test(d) && /골든/.test(d))
    ok("과매수·과매도·골든/데드를 말로 적는다 — 숫자만 있으면 해석을 사용자가 해야 한다");
  else bad("지표 해석이 숫자뿐이다");
  const l = H.slice(H.indexOf("function loadDetailTaExtra"), H.indexOf("function loadDetailTaExtra") + 1200);
  if (/DTX\.inflight\[sym\]/.test(l) && /DTX\.cache\[sym\] = null/.test(l))
    ok("조회 실패를 null 로 확정하고 중복 요청을 막는다 — 무한 재조회로 서버를 두드리지 않는다");
  else bad("실패 시 무한 재조회 위험이 있다");
  if (/detailState\.symbol === sym/.test(l))
    ok("응답이 늦게 와도 지금 보고 있는 종목일 때만 다시 그린다 — 다른 종목 화면에 남의 지표를 덮지 않는다");
  else bad("늦게 온 응답이 다른 종목 화면을 덮어쓸 수 있다");
}

if (fails) { console.error(`\n✗ 종목상세 차트·지표 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 종목상세 계약 통과 — 확대하면 캔들이 화면을 채우고, 새 지표가 상세에 붙는다");
