// [V33.119] 레버리지 결정기 계약 검증.
//
//   leverageDecide 는 ★실제 베팅 크기를 곱하는★ 함수다. 여기가 틀리면 손실이 그대로 배가된다.
//   그래서 "식이 그럴듯한가"가 아니라 ★답을 아는 입력에서 그 답이 나오는가★ 로 검사한다.
//
//   구조는 Freqtrade 의 leverage() 콜백을 옮긴 것이고, 규칙 자체는 공개 엔진·논문에서 왔다:
//     · 변동성 타게팅        AQR TSMOM / Deep Momentum Networks (Lim·Zohren·Roberts 2019)
//     · 총노출 테이퍼        Passivbot wallet_exposure_limit
//     · 드로다운 디리스크    CTA 표준
//   여기에 우리 고유의 문지기를 하나 더 뒀다: ★효율비(ER)★.
//   "많이 올랐다"가 아니라 "부드럽게 오르는가"로 천장을 연다. 같은 +3% 라도 한 방향으로
//   밀어올린 날과 ±3% 를 오간 날은 다른 사건이고, 후자에 레버리지를 걸면 그건 추격이다.

import { leverageDecide, DEFAULT_CFG, RISKENG,
         scalpMaeMult, SCALPMAE } from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-3 : e);

const SC = DEFAULT_CFG.scalpLeverage;
const SW = DEFAULT_CFG.swingLeverage;
// 기본 입력 — 평시·중립. 여기서 하나씩만 바꿔가며 영향을 격리한다.
const base = {
  cfg: SC, isScalp: true, phase: "RANGE", er: 0.20,
  realVolPct: 15, targetVolPct: 15, kelly: null, modelTrusted: false,
  ddPct: 0, grossFrac: 0.2, grossCapFrac: RISKENG.maxGrossFrac
};
const L = (over) => leverageDecide(Object.assign({}, base, over));

// ══ ① 변동성 타게팅 — 크기 ∝ 목표/실현 ═════════════════════════════════════
{
  if (near(L({}).mult, 1)) ok("실현 = 목표 → 배수 1 (중립)");
  else bad("실현=목표인데 배수가 " + L({}).mult);

  // 실현변동성이 목표의 2배 → 절반으로 줄여야 목표 위험이 된다.
  const hi = L({ realVolPct: 30 });
  if (near(hi.mult, 0.5, 0.01)) ok("실현 30% vs 목표 15% → ×" + hi.mult + " (위험 절반으로 축소)");
  else bad("실현 2배인데 배수가 " + hi.mult + " (기대 0.5)");

  // 실현이 목표의 절반이어도 ★평시에는★ 천장 1.2 를 안 넘는다.
  const lo = L({ realVolPct: 7.5 });
  if (near(lo.mult, SC.ceilBase, 0.01)) ok("실현 7.5% (목표의 절반) · RANGE → ×" + lo.mult + " (평시 천장 " + SC.ceilBase + " 유지)");
  else bad("평시인데 천장을 넘었다: " + lo.mult);

  // 축소 방향은 하한(floor)까지만
  const vlo = L({ realVolPct: 200 });
  if (near(vlo.mult, SC.floor, 0.01)) ok("극단 변동성 → 하한 " + SC.floor + " 에서 멈춘다");
  else bad("하한이 안 걸렸다: " + vlo.mult);
}

// ══ ② ★폭등 천장은 '추세의 질'이 연다★ ═════════════════════════════════════
//   이게 이번 변경의 핵심이다. 같은 MELTUP 이라도 거친 상승엔 안 열린다.
{
  // 실현 5% vs 목표 15% → 이론상 ×3.0 을 원한다. 천장이 실제로 구속되는 구간이라야
  //   "천장이 얼마나 열렸나"를 잴 수 있다(비율이 천장보다 낮으면 비율이 답이 되어 버린다).
  const quiet = { realVolPct: 5 };

  const rough = L(Object.assign({}, quiet, { phase: "MELTUP", er: 0.20 }));
  if (near(rough.mult, SC.ceilBase, 0.01))
    ok("MELTUP 이지만 ER 0.20 < " + SC.erMin + " → ×" + rough.mult + " (거친 상승엔 천장 안 엶)");
  else bad("거친 MELTUP 에 천장이 열렸다: " + rough.mult + " — 추격이 된다");

  const smooth = L(Object.assign({}, quiet, { phase: "MELTUP", er: 0.50 }));
  if (near(smooth.mult, SC.ceilMeltup, 0.01))
    ok("MELTUP + ER 0.50 → ×" + smooth.mult + " (천장 " + SC.ceilMeltup + " 개방)");
  else bad("부드러운 MELTUP 에서 배수가 " + smooth.mult + " (기대 " + SC.ceilMeltup + ")");

  // 중간 ER 은 선형 — 계단이 아니라 경사로여야 한다(문턱 근처에서 배수가 튀지 않게).
  const mid = L(Object.assign({}, quiet, { phase: "MELTUP", er: 0.40 }));
  const want = SC.ceilBase + (SC.ceilMeltup - SC.ceilBase) * 0.5;
  if (near(mid.mult, want, 0.02)) ok("ER 0.40 (문턱과 만개의 중간) → ×" + mid.mult + " 선형 보간");
  else bad("ER 중간값에서 " + mid.mult + " (기대 " + want.toFixed(2) + ") — 계단형이면 문턱에서 배수가 튄다");

  // TREND_UP 은 MELTUP 보다 낮은 천장
  const tu = L(Object.assign({}, quiet, { phase: "TREND_UP", er: 0.50 }));
  if (tu.mult < smooth.mult && near(tu.mult, SC.ceilTrend, 0.01))
    ok("TREND_UP + ER 0.50 → ×" + tu.mult + " < MELTUP " + smooth.mult);
  else bad("TREND_UP 천장이 " + tu.mult + " (기대 " + SC.ceilTrend + ")");

  // ★하락 국면에서는 아무리 조용해도 안 연다★
  for (const ph of ["CRASH", "TREND_DOWN", "RANGE"]) {
    const d = L(Object.assign({}, quiet, { phase: ph, er: 0.60 }));
    if (near(d.mult, SC.ceilBase, 0.01)) ok(ph + " + ER 0.60 → ×" + d.mult + " (상승국면이 아니면 천장 안 엶)");
    else bad(ph + " 에서 천장이 열렸다: " + d.mult);
  }
}

// ══ ③ 단타 엣지(켈리) — 측정된 양의 엣지에만 열린다 ═══════════════════════
{
  const q = { realVolPct: 15, phase: "RANGE" };   // 변동성 중립 → 켈리 영향만 본다
  if (near(L(Object.assign({}, q, { kelly: 0.20, modelTrusted: false })).mult, 1))
    ok("모델 미신뢰 → 켈리가 좋아도 배수 1 (규칙엔진 단타엔 안 건다)");
  else bad("모델 미신뢰인데 배수가 올랐다");

  if (near(L(Object.assign({}, q, { kelly: -0.18, modelTrusted: true })).mult, 1))
    ok("음수 켈리 → 배수 1 (손실을 배가하지 않는다)");
  else bad("음수 켈리에 배수가 올랐다");

  const k20 = L(Object.assign({}, q, { kelly: 0.20, modelTrusted: true }));
  if (near(k20.mult, SC.maxMult, 0.01)) ok("켈리 0.20 · 모델신뢰 → ×" + k20.mult + " (maxMult)");
  else bad("켈리 0.20 에서 " + k20.mult + " (기대 " + SC.maxMult + ")");

  // 장타는 켈리 증폭을 쓰지 않는다(표본 축이 다르고 갭 위험이 비대칭)
  const sw = leverageDecide(Object.assign({}, base, { cfg: SW, isScalp: false, kelly: 0.30, modelTrusted: true }));
  if (near(sw.mult, 1)) ok("장타: 켈리 0.30 이어도 배수 1 (변동성 타게팅만 쓴다)");
  else bad("장타에 켈리 증폭이 걸렸다: " + sw.mult);
}

// ══ ④ 드로다운·총노출은 ★증폭분만★ 깎는다 ═════════════════════════════════
//   전부 곱하면 기본 1배까지 깎여 '레버리지 조절'이 아니라 '거래 축소'가 된다.
//   축소는 이미 crashGate·gapRisk·volTarget 이 담당한다. 여기 책임은 1 초과분이다.
{
  const strong = { realVolPct: 5, phase: "MELTUP", er: 0.50 };   // 천장 ×2.2 가 구속되는 상황
  const full = L(strong);
  const half = L(Object.assign({}, strong, { ddPct: SC.ddCut / 2 }));
  const wantHalf = 1 + (full.mult - 1) * 0.5;
  if (near(half.mult, wantHalf, 0.02)) ok("DD 절반 → 증폭분만 절반 (×" + full.mult + " → ×" + half.mult + ")");
  else bad("DD 절반에서 " + half.mult + " (기대 " + wantHalf.toFixed(2) + ")");

  const gone = L(Object.assign({}, strong, { ddPct: SC.ddCut * 2 }));
  if (near(gone.mult, 1, 0.01)) ok("DD 한도 초과 → ×1 (증폭 전부 소멸, 그러나 거래 자체는 막지 않는다)");
  else bad("DD 초과에서 " + gone.mult);

  // 총노출 테이퍼 — 한도의 taperFrom 까지는 영향 없고, 그 위에서 선형으로 준다.
  const cap = RISKENG.maxGrossFrac;
  const belowTaper = L(Object.assign({}, strong, { grossFrac: cap * (SC.taperFrom - 0.05) }));
  if (near(belowTaper.mult, full.mult, 0.01)) ok("총노출 " + ((SC.taperFrom - 0.05) * 100).toFixed(0) + "% < 테이퍼 시작점 → 영향 없음");
  else bad("테이퍼 시작 전인데 배수가 깎였다: " + belowTaper.mult);

  const atCap = L(Object.assign({}, strong, { grossFrac: cap }));
  if (near(atCap.mult, 1, 0.01)) ok("총노출 = 한도 → ×1 (증폭 소멸 — 절벽 대신 도착)");
  else bad("한도에서 " + atCap.mult);

  // ★경사로 중간★ — 끝점(시작 전·한도)만 보면 테이퍼를 통째로 지워도 통과한다.
  //   실제로 주입시험에서 그렇게 통과했다. '절벽이 아니라 경사로'라는 주장은 중간값이 증명한다.
  const uMid = (SC.taperFrom + 1) / 2;
  const midT = L(Object.assign({}, strong, { grossFrac: cap * uMid }));
  const wantMid = 1 + (full.mult - 1) * 0.5;     // 중간점의 테이퍼 계수는 정확히 0.5
  if (near(midT.mult, wantMid, 0.02))
    ok("총노출 " + (uMid * 100).toFixed(0) + "% of 한도 → ×" + midT.mult + " (증폭분 절반 — 절벽 아닌 경사로)");
  else bad("테이퍼 중간에서 " + midT.mult + " (기대 " + wantMid.toFixed(2) + ") — 테이퍼가 실제로 안 걸린다");

  // 단조성 — 노출이 늘수록 배수가 줄어야 한다(중간에 뒤집히면 사이징이 진동한다)
  let prev = Infinity, mono = true;
  for (let u = SC.taperFrom; u <= 1.0001; u += 0.05) {
    const m = L(Object.assign({}, strong, { grossFrac: cap * u })).mult;
    if (m > prev + 1e-9) mono = false;
    prev = m;
  }
  if (mono) ok("총노출 대비 배수 단조감소 (사이징 진동 없음)");
  else bad("총노출이 늘었는데 배수가 커지는 구간이 있다");
}

// ══ ⑤ 안전 상한·폴백 ═══════════════════════════════════════════════════════
{
  // 어떤 조합으로도 hardCap 을 못 넘는다
  const wild = L({ realVolPct: 1.5, phase: "MELTUP", er: 0.95, kelly: 0.40, modelTrusted: true, ddPct: 0, grossFrac: 0 });
  if (wild.mult <= SC.hardCap + 1e-9) ok("최대 조합 → ×" + wild.mult + " ≤ hardCap " + SC.hardCap);
  else bad("hardCap 을 넘었다: " + wild.mult);
  const wildSw = leverageDecide({ cfg: SW, isScalp: false, phase: "MELTUP", er: 0.95, realVolPct: 1.5, targetVolPct: 15, ddPct: 0, grossFrac: 0, grossCapFrac: RISKENG.maxGrossFrac });
  if (wildSw.mult <= SW.hardCap + 1e-9) ok("장타 최대 조합 → ×" + wildSw.mult + " ≤ hardCap " + SW.hardCap);
  else bad("장타 hardCap 초과: " + wildSw.mult);
  // ★장타 천장이 단타보다 낮아야 한다★ — 갭 위험이 비대칭이라는 설계 판단(V33.82)을 계약으로 못 박는다.
  if (SW.hardCap < SC.hardCap) ok("장타 hardCap " + SW.hardCap + " < 단타 " + SC.hardCap + " (오버나이트 갭 비대칭 반영)");
  else bad("장타 레버리지 상한이 단타 이상이다 — 갭 위험 설계와 어긋난다");

  // 입력이 없으면 조용히 1 (기능 정지 없음)
  if (near(leverageDecide({ cfg: SC, isScalp: true }).mult, 1)) ok("입력 없음 → ×1 폴백");
  else bad("빈 입력 폴백 실패");
  if (near(leverageDecide(null).mult, 1)) ok("null 입력 → ×1 폴백");
  else bad("null 폴백 실패");
  if (near(leverageDecide({ cfg: { enabled: false }, isScalp: true, realVolPct: 5, targetVolPct: 15 }).mult, 1))
    ok("enabled:false → ×1 (스위치가 실제로 끈다)");
  else bad("비활성인데 배수가 바뀐다");

  // posMult 는 단타에서만, 그리고 배수가 열린 만큼만
  const p = L({ realVolPct: 7.5, phase: "MELTUP", er: 0.50, kelly: 0.20, modelTrusted: true });
  if (p.posMult > 1 && p.posMult <= SC.concMult + 1e-9) ok("집중도 배수 ×" + p.posMult + " ≤ concMult " + SC.concMult);
  else bad("집중도 배수가 " + p.posMult);
  const p0 = L({ realVolPct: 30 });
  if (near(p0.posMult, 1)) ok("배수가 안 열리면 집중도도 그대로 1");
  else bad("배수가 1 이하인데 집중도가 " + p0.posMult);
}

// ══ ⑥ 배선 회귀 — 인라인 계산으로 되돌아가지 않았는가 ══════════════════════
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  // 호출부만 센다 — 정의(function leverageDecide(o))와 export 는 제외해야 '배선됐는가'를 묻는 게 된다.
  const nCall = (src.match(/leverageDecide\(\{/g) || []).length;
  if (nCall >= 2) ok("leverageDecide 호출부 " + nCall + "곳 (단타·장타)");
  else bad("leverageDecide 호출부가 " + nCall + "곳뿐 — 인라인 계산으로 회귀했다");
  if (/function leverageDecide\(/.test(src)) ok("순수함수로 분리돼 있다(합성입력으로 시험 가능)");
  else bad("leverageDecide 정의를 못 찾았다");
  // 단타가 변동성 축소를 반영하는가(종전 `_scLev > 1` 조건이면 축소가 통째로 빠진다)
  if (/if \(_scLev !== 1\)/.test(src)) ok("단타가 1 미만 배수(변동성 축소)도 반영한다");
  else bad("`_scLev > 1` 로 회귀 — 단타만 변동성 스로틀이 빠진다");
  // 이중계산 방지: 단타는 volTarget 블록에서 sizeScale 을 곱하지 않아야 한다
  if (/단타는 아래 전용 게이트\(leverageDecide\)가 변동성까지 함께 본다/.test(src))
    ok("단타 이중 변동성 계산 방지 주석·분기 유지");
  else bad("volTarget 과 leverageDecide 가 같은 변동성으로 두 번 깎을 수 있다");
}

// ══ ⑦ [V33.120] 경로 문지기(MAE) — '가는 길을 견디는가' ═══════════════════
//   켈리는 평균적으로 버는지를 본다. 방향을 맞혀도 먼저 손절에 닿으면 레버리지는
//   손실만 배가한다 — 그건 도착점 통계에 안 보이고 경로(MAE)에만 보인다.
{
  // ★hardCap 에 물리지 않는 시나리오를 쓴다.★ 켈리까지 얹으면 raw 가 4.4 라 상한 2.5 에
  //   붙어버리고, 그러면 계수를 절반으로 깎아도 결과가 그대로 2.5 다 — 효과가 안 보인다.
  //   (처음에 그렇게 써서 게이트가 잡았다. 상한에 물린 지점은 비교 대상이 될 수 없다)
  const strong = { realVolPct: 5, phase: "MELTUP", er: 0.50 };
  const full = L(strong).mult;

  const blocked = L(Object.assign({}, strong, { maeMult: 0, maeNote: "역행 0.90" }));
  if (near(blocked.mult, 1, 0.01)) ok("MAE 차단(계수 0) → ×1 (증폭 전부 소멸, 거래 자체는 막지 않는다)");
  else bad("MAE 차단인데 배수가 " + blocked.mult);

  const half = L(Object.assign({}, strong, { maeMult: 0.5 }));
  const wantHalf = 1 + (full - 1) * 0.5;
  if (near(half.mult, wantHalf, 0.02)) ok("MAE 계수 0.5 → 증폭분 절반 (×" + full + " → ×" + half.mult + ")");
  else bad("MAE 0.5 에서 " + half.mult + " (기대 " + wantHalf.toFixed(2) + ")");

  const free = L(Object.assign({}, strong, { maeMult: 1 }));
  if (near(free.mult, full, 0.01)) ok("MAE 계수 1 → 제한 없음(종전과 동일)");
  else bad("MAE 1 인데 배수가 달라졌다");

  // 장타는 이 문지기를 쓰지 않는다 — 손절폭이 ATR 기반으로 훨씬 넓어 지배적 실패모드가 아니다.
  const sw = leverageDecide({ cfg: SW, isScalp: false, phase: "MELTUP", er: 0.5,
    realVolPct: 5, targetVolPct: 15, ddPct: 0, grossFrac: 0, grossCapFrac: RISKENG.maxGrossFrac, maeMult: 0 });
  if (sw.mult > 1) ok("장타는 MAE 문지기 미적용 → ×" + sw.mult);
  else bad("장타에 MAE 문지기가 걸렸다: " + sw.mult);

  // ── 비율 → 계수 사상 ──
  const mkDB = (v) => ({
    prepare(sql) {
      const st = { _a: [], bind(...a) { st._a = a; return st; },
        async first() {
          if (/SELECT v FROM state WHERE k = \?/.test(sql) && st._a[0] === "scalp_mae")
            return v === null ? null : { v: JSON.stringify(v) };
          return null;
        },
        async all() { return { results: [] }; }, async run() { return {}; } };
      return st;
    }
  });
  const now = Date.now();
  const rdy = (ratio, over) => Object.assign({ ready: true, ratio: ratio, ts: now,
    freeBelow: SCALPMAE.freeBelow, blockAt: SCALPMAE.blockAt }, over || {});

  const lo = await scalpMaeMult(mkDB(rdy(0.40)));
  if (near(lo.mult, 1)) ok("역행/손절폭 0.40 ≤ " + SCALPMAE.freeBelow + " → 계수 1 (여유 충분)");
  else bad("여유 구간에서 계수가 " + lo.mult);

  const hi = await scalpMaeMult(mkDB(rdy(0.90)));
  if (near(hi.mult, 0)) ok("역행/손절폭 0.90 ≥ " + SCALPMAE.blockAt + " → 계수 0 (경로가 손절폭을 못 견딘다)");
  else bad("차단 구간에서 계수가 " + hi.mult);

  const mid = await scalpMaeMult(mkDB(rdy((SCALPMAE.freeBelow + SCALPMAE.blockAt) / 2)));
  if (near(mid.mult, 0.5, 0.02)) ok("중간 역행 → 계수 " + mid.mult + " (선형 — 문턱에서 튀지 않는다)");
  else bad("중간 구간 계수가 " + mid.mult + " (기대 0.5)");

  // 단조성 — 역행이 커질수록 계수가 줄어야 한다
  let prev = Infinity, mono = true;
  for (let r = 0.3; r <= 1.0001; r += 0.05) {
    const m = (await scalpMaeMult(mkDB(rdy(r)))).mult;
    if (m > prev + 1e-9) mono = false;
    prev = m;
  }
  if (mono) ok("역행 대비 계수 단조감소");
  else bad("역행이 커졌는데 계수가 커지는 구간이 있다");

  // ★모르면 종전과 같게★ — 측정 전·스태일·없음은 전부 1
  if (near((await scalpMaeMult(mkDB(null))).mult, 1)) ok("측정값 없음 → 계수 1 (종전 동작)");
  else bad("측정값이 없는데 계수가 1 이 아니다");
  if (near((await scalpMaeMult(mkDB({ ready: false, ts: now }))).mult, 1)) ok("ready:false → 계수 1");
  else bad("ready:false 처리 실패");
  const stale = await scalpMaeMult(mkDB(rdy(0.95, { ts: now - (SCALPMAE.staleH + 10) * 3600000 })));
  if (near(stale.mult, 1)) ok("스태일(" + SCALPMAE.staleH + "h 초과) → 계수 1 (낡은 측정으로 문을 닫지 않는다)");
  else bad("스태일 값을 그대로 썼다: " + stale.mult);
}

// ══ ⑧ MAE 배선 회귀 ════════════════════════════════════════════════════════
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  if (/mae: \+mae\.toFixed\(3\), mfe: \+mfe\.toFixed\(3\)/.test(src)) ok("백필 라벨이 MAE/MFE 를 담는다(미래 경로 정확값)");
  else bad("백필이 MAE/MFE 를 안 담는다 — 분포를 잴 표본이 안 쌓인다");
  if (/mae: _num\(it\.mae, 0\), mfe: _num\(it\.mfe, 0\), src: "live"/.test(src)) ok("라이브 라벨도 MAE/MFE 를 담고 src 로 구분한다");
  else bad("라이브 라벨에 MAE/MFE·src 가 없다");
  if (/if \(sm\.src === "live"\) \{ nLive\+\+; continue; \}/.test(src))
    ok("분포 적합이 라이브 표본을 제외한다(1분 관측은 고저를 못 봐 MAE 과소추정)");
  else bad("과소추정된 라이브 MAE 가 분포에 섞인다 — 낙관적으로 문이 열린다");
  if (/_stg\("scalpmae"/.test(src) && /\["scalpmae",/.test(src)) ok("scalpmae 단계가 크론·수동 양쪽에 등록됨");
  else bad("scalpmae 파이프라인 등록 누락");
  if (/maeMult: _num\(_st\.maeMult, 1\)/.test(src)) ok("매수 경로가 MAE 계수를 결정기에 넘긴다");
  else bad("MAE 계수가 결정기까지 안 간다 — 측정만 하고 안 쓰는 코드가 된다");
}

console.log(fails ? "\n레버리지 계약 위반 " + fails + "건" : "\n  ok   레버리지 계약 통과");
process.exit(fails ? 1 : 0);
