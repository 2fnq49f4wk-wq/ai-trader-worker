/* [V33.332] DMA · 스토캐스틱 슬로우 계약 — ★수식이 아니라 성질을 검사한다★
 *
 *   지표는 숫자 하나를 맞히는 것보다 ★성질이 맞는지★ 가 중요하다:
 *     · 상승 추세에서 DMA 가 양수인가, 하락 추세에서 음수인가
 *     · 스토캐스틱 '슬로우'가 정말 평활돼 fast 보다 덜 흔들리는가 (이게 '스무딩'의 전부다)
 *     · 상하한가·거래정지로 고가=저가가 되면 0으로 나누지 않는가
 *   그리고 이 저장소에서 제일 중요한 것: ★새 지표가 기존 판단을 덮어쓰지 않는가.★
 *   가중치를 크게 넣으면 검증된 신호를 새 지표가 밀어낸다 — 지표는 늘리되 무게중심은 그대로 둔다.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };
function cut(a, b) {
  const i = S.indexOf(a), j = S.indexOf(b, i);
  if (i < 0 || j < 0) throw Error("소스에서 못 찾음: " + a.trim());
  return S.slice(i, j);
}

const ctx = vm.createContext({
  Math, Array, Infinity, Number, isFinite,
  _num: (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; }
});
vm.runInContext(cut("function getMA(h, p) {", "// [V84] EMA 시리즈") +
                cut("/* [V33.335] ★DMA — Displaced", "// [신규] N일 수익률 계산") +
                "\n globalThis.dma = getDisplacedMA; globalThis.st = getStochSlow;", ctx);

const up = [], dn = [];
for (let i = 0; i < 140; i++) { up.push(100 + i * 0.5 + Math.sin(i / 3) * 0.8); dn.push(170 - i * 0.5 + Math.sin(i / 3) * 0.8); }

// ── ① DMA — ★Displaced Moving Average★ (이동평균을 앞으로 민 선) ────────
{
  /* V33.332 는 '이동평균 차이'로 구현했었다 — 사용자가 말한 것은 Displaced MA 였다.
     이 검사는 정의 자체를 못박는다: 봉 i 의 값 = MA(n) 을 (i − shift) 에서 계산한 값. */
  const P = 20, SH = 5;
  const a = ctx.dma(up, P, SH), b = ctx.dma(dn, P, SH);
  const maAt = (arr, e, p) => { let s2 = 0; for (let i = e - p + 1; i <= e; i++) s2 += arr[i]; return s2 / p; };
  const want = maAt(up, up.length - 1 - SH, P);
  if (a && Math.abs(a.ma - want) < 1e-9)
    ok(`DMA 선이 ${SH}봉 전 MA(${P}) 와 정확히 같다 — 이동평균을 앞으로 민 선이다`);
  else bad(`Displaced MA 가 아니다: ${a && a.ma} (기대 ${want})`);

  const mut = up.slice(); mut[mut.length - 1] = 99999;
  if (ctx.dma(mut, P, SH).ma === a.ma)
    ok("현재 봉 종가를 바꿔도 선 값이 안 변한다 — 선이 미래·현재를 참조하지 않는다(누출 없음)");
  else bad("★선이 현재 봉을 쓴다 — 앞으로 민 선의 정의가 아니다★");

  if (a.pct > 0 && b.pct < 0)
    ok(`상승추세에선 가격이 선 위(+${a.pct.toFixed(2)}%), 하락추세에선 아래(${b.pct.toFixed(2)}%)`);
  else bad(`가격 위치 부호가 추세와 안 맞는다: ${a.pct} / ${b.pct}`);
  if (a.slope > 0 && b.slope < 0)
    ok(`선 기울기도 추세를 따른다(+${a.slope.toFixed(3)} / ${b.slope.toFixed(3)} %/봉)`);
  else bad("선 기울기 부호가 추세와 안 맞는다");

  // 가격 규모가 달라도 % 는 같아야 한다 — 종목을 섞어 보는 위원회의 전제다
  const big = up.map((x) => x * 1000);
  const a2 = ctx.dma(big, P, SH);
  if (a2 && Math.abs(a2.pct - a.pct) < 1e-9)
    ok("가격 규모가 1,000배여도 pct 는 같다 — %정규화라 종목 간 비교가 된다");
  else bad(`가격 규모에 따라 pct 가 달라진다: ${a.pct} vs ${a2 && a2.pct}`);

  // 돌파/이탈 — 바닥에서 반등하는 계열을 만들어 실제로 교차를 일으킨다
  const v = [];
  for (let i = 0; i < 90; i++) v.push(120 - i);
  for (let i = 0; i < 40; i++) v.push(30 + i * 1.6);
  let firstUp = null;
  for (let e = P + SH + 3; e <= v.length; e++) {
    const r = ctx.dma(v.slice(0, e), P, SH);
    if (r && r.cross > 0 && firstUp === null) firstUp = e;
  }
  if (firstUp !== null) ok(`하락 뒤 반등에서 가격의 상향돌파(+1)를 ${firstUp}번째 봉에서 잡는다`);
  else bad("돌파를 한 번도 못 잡는다 — cross 가 늘 0이면 그 신호는 없는 것과 같다");
  let firstDn = null;
  const w = [];
  for (let i = 0; i < 90; i++) w.push(30 + i);
  for (let i = 0; i < 40; i++) w.push(120 - i * 1.6);
  for (let e = P + SH + 3; e <= w.length; e++) {
    const r = ctx.dma(w.slice(0, e), P, SH);
    if (r && r.cross < 0 && firstDn === null) firstDn = e;
  }
  if (firstDn !== null) ok(`상승 뒤 꺾임에서 하향이탈(-1)을 ${firstDn}번째 봉에서 잡는다`);
  else bad("하향이탈을 못 잡는다");

  if (ctx.dma(up.slice(0, 15), P, SH) === null) ok("데이터가 모자라면 null — 없는 값을 지어내지 않는다");
  else bad("짧은 계열에서도 값을 만들어낸다");
}

// ── ② 스토캐스틱 슬로우 — '스무딩'이 실제로 되는가 ──────────────────────
{
  const a = ctx.st(null, null, up), b = ctx.st(null, null, dn);
  if (a && a.k > 80 && b && b.k < 20)
    ok(`상승추세 %K ${a.k.toFixed(0)}(과매수대), 하락추세 ${b.k.toFixed(0)}(과매도대) — 위치가 맞다`);
  else bad("스토캐스틱 위치가 추세와 안 맞는다");

  /* ★이 검사가 이 파일의 핵심★ — '슬로우'는 평활이 전부다.
     평활이 안 되면 fast 와 같아지고, 그러면 하루 노이즈로 과매수/과매도가 번갈아 켜진다. */
  const noisy = [];
  for (let i = 0; i < 220; i++) noisy.push(100 + Math.sin(i / 2) * 6 + (i % 3 === 0 ? 3 : -3));
  const F = [], K = [];
  for (let e = 60; e <= noisy.length; e++) {
    const r = ctx.st(null, null, noisy.slice(0, e));
    if (r) { F.push(r.kFast); K.push(r.k); }
  }
  const sd = (arr) => { const m = arr.reduce((x, y) => x + y, 0) / arr.length; return Math.sqrt(arr.reduce((x, y) => x + (y - m) ** 2, 0) / arr.length); };
  const sf = sd(F), sk = sd(K);
  if (sk < sf * 0.95) ok(`평활 확인: fast %K 변동 ${sf.toFixed(1)} → slow %K ${sk.toFixed(1)} 로 줄었다 — 이게 '스무딩'이다`);
  else bad(`★슬로우가 평활되지 않았다(${sf.toFixed(1)} → ${sk.toFixed(1)}) — fast 와 같으면 노이즈에 그대로 흔들린다★`);

  // 상하한가·거래정지: 고가 = 저가 → 0으로 나누는 자리
  const flat = ctx.st(null, null, new Array(80).fill(100));
  if (flat && flat.k === 50 && isFinite(flat.k))
    ok("가격이 한 값에 고정(상하한·거래정지)돼도 0으로 나누지 않고 중립 50 을 준다");
  else bad("고가=저가 구간에서 NaN/Infinity 가 나온다: " + JSON.stringify(flat));

  // 고가·저가가 있으면 그걸 쓰고, 없으면 종가로 근사한다(계산을 포기하지 않는다)
  const H = up.map((x) => x * 1.02), L = up.map((x) => x * 0.98);
  const withHL = ctx.st(H, L, up);
  if (withHL && withHL.k != null && withHL.k !== a.k)
    ok("고가·저가가 있으면 그 값을 쓴다(종가 근사와 결과가 다르다)");
  else bad("고가·저가를 줘도 결과가 같다 — 인자를 안 쓰고 있다");
  if (ctx.st(null, null, up.slice(0, 10)) === null) ok("데이터가 모자라면 null");
  else bad("짧은 계열에서도 값을 만들어낸다");
}

// ── ③ ★새 지표가 기존 판단을 덮어쓰지 않는가★ ──────────────────────────
{
  const t = cut("function taPredictDirection(bars, params) {", "\n/* [V33.319] 화면에 보여줄 지표 목록");
  const w = {};
  for (const m of t.matchAll(/(dmaW|dmaCrossW|stochW|stochCrossW):\s*([0-9.]+)/g)) w[m[1]] = Number(m[2]);
  const got = Object.keys(w).length;
  if (got === 4) ok(`새 지표 가중치 4종이 설정으로 빠져 있다(${Object.entries(w).map(([k, v]) => k + " " + v).join(", ")})`);
  else bad(`가중치가 설정으로 안 빠졌다(${got}/4) — 숫자가 코드에 박히면 조정할 때마다 로직을 건드려야 한다`);
  const maxNew = Math.max(...Object.values(w));
  if (maxNew <= 0.9) ok(`새 지표 최대 가중 ${maxNew} ≤ 기존 최대(MA기울기 0.9) — 검증된 신호를 밀어내지 않는다`);
  else bad(`★새 지표 가중(${maxNew})이 기존 최대 신호보다 크다 — 판단의 무게중심이 옮겨간다★`);
  if (/stochCrossW/.test(t) && w.stochCrossW > w.stochW)
    ok("스토캐스틱은 수준(과매수/과매도)보다 교차에 더 큰 가중 — 추세장에서 80 이상에 붙어 있어도 계속 거스르지 않는다");
  else bad("과매수/과매도 수준을 교차보다 크게 본다 — 상승 추세를 계속 거스르게 된다");
  if (/getDisplacedMA\(closes, T\.dmaPeriod, T\.dmaShift\)/.test(t) && /getStochSlow\(highs, lows, closes, T\.stochN/.test(t))
    ok("두 지표가 기술 컨센서스(taPredictDirection)에 실제로 배선돼 있다 — 계산만 하고 안 쓰는 게 아니다");
  else bad("지표를 만들어 두고 판단에 안 쓴다");
  if (/dmaPct: dmaR \? \+dmaR\.pct/.test(t) && /stochK: stR \?/.test(t))
    ok("components 에 실려 화면(/api/ta-explain)이 근거로 보여줄 수 있다");
  else bad("새 지표가 화면으로 안 내려간다 — '왜 그렇게 봤나'를 못 본다");
}

if (fails) { console.error(`\n✗ 지표 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 지표 계약 통과 — DMA·스토캐스틱 슬로우가 성질대로 동작하고, 기존 판단을 밀어내지 않는다");
