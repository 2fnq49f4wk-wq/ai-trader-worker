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
const M = await import("../src/index.js");

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
      Math, Infinity, isFinite, _pcClipSeq: 0, dmaV: null,
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
  if (/add\('DMA\(20,\+5\)'/.test(d) && /add\('스토캐스틱\(14,3,3\)'/.test(d))
    ok("종목상세에 DMA·스토캐스틱 행이 있다");
  else bad("종목상세에 새 지표 행이 없다");
  if (/_tx === undefined/.test(d) && /_tx === null/.test(d))
    ok("로딩 중('…')과 값 없음('—')을 구분한다 — 없다고 행을 빼면 '이 종목엔 지표가 없다'로 읽힌다");
  else bad("로딩 중과 값 없음을 구분하지 않는다");
  if (/과매수/.test(d) && /과매도/.test(d) && /상향돌파/.test(d) && /기울기/.test(d))
    ok("과매수·과매도·상향돌파·기울기를 말로 적는다 — 숫자만 있으면 해석을 사용자가 해야 한다");
  else bad("지표 해석이 숫자뿐이다");
  const l = H.slice(H.indexOf("function loadDetailTaExtra"), H.indexOf("function loadDetailTaExtra") + 1200);
  if (/DTX\.inflight\[sym\]/.test(l) && /DTX\.cache\[sym\] = null/.test(l))
    ok("조회 실패를 null 로 확정하고 중복 요청을 막는다 — 무한 재조회로 서버를 두드리지 않는다");
  else bad("실패 시 무한 재조회 위험이 있다");
  if (/detailState\.symbol === sym/.test(l))
    ok("응답이 늦게 와도 지금 보고 있는 종목일 때만 다시 그린다 — 다른 종목 화면에 남의 지표를 덮지 않는다");
  else bad("늦게 온 응답이 다른 종목 화면을 덮어쓸 수 있다");
}

// ── ⑤ ★화면이 그리는 선과 엔진이 쓰는 값이 같은가★ ─────────────────────
{
  /* 지표가 두 곳(브라우저 JS · 워커 JS)에 각각 구현돼 있다. 이 저장소가 반복해 당한
     "같은 규칙이 두 곳에 살다 갈라지는" 사고의 자리다. 그래서 ★둘을 실제로 돌려 비교★ 한다.
     화면이 다른 선을 그리면 사용자는 엔진이 보지 않는 근거로 판단하게 된다. */
  const a = H.indexOf("  function _smaArr(v, p) {");
  const b = H.indexOf("\n  function bindCandleClick(box)");
  const ctx = vm.createContext({ Math, Array, Infinity, isFinite, Number, String, Date,
    fvFmtVol: (v) => String(v), fmtNum: (v, d) => Number(v).toFixed(d == null ? 2 : d), _pcIndCache: null });
  vm.runInContext(H.slice(a, b) + "\n globalThis.dm = _dispMaArr; globalThis.st = _stochSlowArr;"
    + "\n globalThis.PD = PC_DMA; globalThis.PS = PC_STO;", ctx);

  const closes = [], highs = [], lows = [];
  for (let i = 0; i < 260; i++) {
    const c = 100 + i * 0.27 + Math.sin(i / 6) * 3.4;
    closes.push(c); highs.push(c * 1.011); lows.push(c * 0.989);
  }
  // 설정이 서버와 같은가 — 화면만 20/5 를 쓰고 서버가 다른 값이면 두 선이 갈라진다.
  if (ctx.PD.p === M.DS_PARAMS.maPeriod && ctx.PD.sh === M.DS_PARAMS.maShift)
    ok(`DMA 설정이 서버와 같다(${ctx.PD.p}, +${ctx.PD.sh})`);
  else bad(`DMA 설정이 서버와 다르다: 화면 ${ctx.PD.p}/${ctx.PD.sh} vs 서버 ${M.DS_PARAMS.maPeriod}/${M.DS_PARAMS.maShift}`);
  if (ctx.PS.n === M.DS_PARAMS.stochN && ctx.PS.k === M.DS_PARAMS.stochK && ctx.PS.d === M.DS_PARAMS.stochD)
    ok(`스토캐스틱 설정이 서버와 같다(${ctx.PS.n},${ctx.PS.k},${ctx.PS.d})`);
  else bad("스토캐스틱 설정이 서버와 다르다");

  const line = ctx.dm(closes, ctx.PD.p, ctx.PD.sh);
  const srv = M.getDisplacedMA(closes, M.DS_PARAMS.maPeriod, M.DS_PARAMS.maShift);
  const last = line[line.length - 1];
  if (last != null && Math.abs(last - srv.ma) < 1e-9)
    ok(`화면의 DMA 마지막 값이 엔진과 일치한다(${last.toFixed(4)})`);
  else bad(`★화면과 엔진의 DMA 가 다르다: ${last} vs ${srv && srv.ma}★`);
  // 앞으로 민 선인가 — 마지막 봉을 바꿔도 선이 안 변해야 한다(미래 미참조)
  const mut = closes.slice(); mut[mut.length - 1] = 99999;
  const line2 = ctx.dm(mut, ctx.PD.p, ctx.PD.sh);
  if (line2[line2.length - 1] === last)
    ok("화면 DMA 도 현재 봉을 쓰지 않는다 — 앞으로 민 선의 정의를 지킨다");
  else bad("★화면 DMA 가 현재 봉을 쓴다 — 밀어놓은 선이 아니다★");

  const cs = ctx.st(highs, lows, closes, ctx.PS.n, ctx.PS.k, ctx.PS.d);
  const ss = M.getStochSlow(highs, lows, closes, M.DS_PARAMS.stochN, M.DS_PARAMS.stochK, M.DS_PARAMS.stochD);
  const ck = cs.k[cs.k.length - 1], cd = cs.d[cs.d.length - 1];
  if (ck != null && Math.abs(ck - ss.k) < 1e-9 && cd != null && Math.abs(cd - ss.d) < 1e-9)
    ok(`화면의 %K·%D 가 엔진과 일치한다(${ck.toFixed(2)} / ${cd.toFixed(2)})`);
  else bad(`★화면과 엔진의 스토캐스틱이 다르다: ${ck}/${cd} vs ${ss && ss.k}/${ss && ss.d}★`);
  // 평활이 실제로 되는가 — 슬로우가 fast 와 같으면 '스무딩'이 아니다
  const flat = ctx.st(null, null, new Array(120).fill(100), ctx.PS.n, ctx.PS.k, ctx.PS.d);
  if (flat.k[flat.k.length - 1] === 50)
    ok("가격이 고정(고가=저가)이어도 0으로 나누지 않고 중립 50 을 준다");
  else bad("고가=저가 구간에서 화면 스토캐스틱이 깨진다");
}

// ── ⑥ 버튼이 MA·BOLL 과 같은 방식으로 붙어 있는가 ───────────────────────
{
  if (/data-ind="dma"/.test(H) && /data-ind="stoch"/.test(H))
    ok("DMA·STOCH 버튼이 기존 지표 버튼과 같은 자리·같은 방식으로 있다");
  else bad("차트 지표 버튼이 없다");
  if (/ind: \{ ma: true, boll: true, vol: true, rsi: true, macd: false, dma: false, stoch: false \}/.test(H))
    ok("기본은 꺼짐 — 화면이 갑자기 복잡해지지 않고 사용자가 켤 때만 그린다");
  else bad("새 지표 기본값이 정해져 있지 않다");
  const cb = H.slice(H.indexOf("var _sig = cs.length"), H.indexOf("var end = Math.max(2, cs.length - off);"));
  if (/ind\.stoch \? 1 : 0/.test(cb) && /ind\.dma \? 1 : 0/.test(cb))
    ok("지표 캐시 서명에 두 토글이 들어간다 — 켜고 끌 때 옛 캐시를 다시 쓰지 않는다");
  else bad("★캐시 서명에 새 토글이 없다 — 버튼을 눌러도 그림이 안 바뀐다★");
  if (/dmaA = ind\.dma \?/.test(cb) && /stoA = ind\.stoch \?/.test(cb))
    ok("꺼져 있으면 계산하지 않는다 — 끈 지표를 매 프레임 계산하면 드래그가 버벅인다");
  else bad("끈 지표도 매 프레임 계산한다");
  if (/if \(dmaV\) for \(i = 0; i < n; i\+\+\) _grow\(dmaV\[i\]\);/.test(H))
    ok("DMA 도 MA 와 같은 제한 규칙으로 y범위에 들어간다 — 먼 DMA 가 축을 끌지 않는다");
  else bad("DMA 가 y범위 규칙 밖에 있다");
  if (/poly\(dmaV, PY, PC_DMA\.c, 1\.3, '5 3'\)/.test(H))
    ok("DMA 를 점선으로 그린다 — 일반 MA 와 눈으로 구분된다(밀어놓은 선임을 알 수 있다)");
  else bad("DMA 가 일반 MA 와 구분되지 않는다");
}

if (fails) { console.error(`\n✗ 종목상세 차트·지표 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 종목상세 계약 통과 — 확대하면 캔들이 화면을 채우고, 새 지표가 상세에 붙는다");
