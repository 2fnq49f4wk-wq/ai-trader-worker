/* [V33.535] OMNI-Q 계약 — Qlib 표준 머리 · 실력 증명 관문(사용자 결정 10/08: 60% 정밀도 → 실력 증명)
 *   ① 관문 수학(파이썬 omni_q.py, 실제로 돌림): 귀무(실력 0)면 ①② 미달 · 심은 신호면 ① 통과 · ③ 장부 채점이 라벨과 같은 정의
 *   ② 워커: 발언 = 세 관문 모두 통과일 때만(학습기의 speak 표시를 그대로 믿지 않는다) · 낡은 점수(5일↑)·점수 없는 종목은 막지 않는다
 *   ③ 장부: 같은 날 덮어쓰기 금지(전진 기록의 정직성) · 상한 260
 *   ④ 배선: 좁히기만 — 신규 추세·스냅 진입의 하위 절반(< 0.5)만 OMNIQ_LOW 로 막는다 · 단타·보유 무관 · 정기 회차가 OMNI-Q 를 돌린다 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const T = new URL("../trainer/modal/", import.meta.url).pathname;
const MT = readFileSync(T + "modal_train.py", "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };

// ── 워커 ──
const G = (a, b, c) => ({ g1: { ok: a }, g2: { ok: b }, g3: { ok: c } });
chk(M.omniqSpeakOf(G(true, true, true)) && !M.omniqSpeakOf(G(true, true, false)) && !M.omniqSpeakOf(G(false, true, true)) && !M.omniqSpeakOf({}), "발언 = ①②③ 모두 통과일 때만");
const now = Date.UTC(2026, 9, 8);
const st = { speak: true, gate: G(true, true, true), trainedAt: now - 86400000, scores: { A: 0.2, B: 0.5, C: 0.9 } };
chk(M.omniqBlocks(st, "A", now) && !M.omniqBlocks(st, "B", now) && !M.omniqBlocks(st, "C", now) && !M.omniqBlocks(st, "Z", now), "하위 절반(<0.5)만 막는다 · 점수 없는 종목은 막지 않는다");
chk(!M.omniqBlocks(Object.assign({}, st, { trainedAt: now - 6 * 86400000 }), "A", now), "5일 넘은 점수로는 막지 않는다");
chk(!M.omniqBlocks(Object.assign({}, st, { speak: true, gate: G(true, true, false) }), "A", now), "speak 표시가 있어도 관문 ③ 미달이면 막지 않는다");
chk(!M.omniqBlocks(Object.assign({}, st, { speak: false }), "A", now) && !M.omniqBlocks(null, "A", now), "섀도우(발언 안 함)·점수 없음 → 무동작");
// [V33.543] 20일 머리 — 자기 관문(gate20) 셋 다 통과일 때만 heads.r20 하위 절반을 막는다
const st20 = { speak: false, gate: G(true, true, false), speak20: true, gate20: G(true, true, true), trainedAt: now - 3600000, scores: { A: 0.9 }, heads: { r20: { A: 0.3, B: 0.7 } } };
chk(M.omniqBlocks(st20, "A", now) && !M.omniqBlocks(st20, "B", now), "20일 머리 발언 중이면 20일 하위 절반만 막는다(5일 머리 섀도우여도)");
chk(!M.omniqBlocks(Object.assign({}, st20, { gate20: G(true, true, false) }), "A", now), "20일 머리도 ③ 미달이면 막지 않는다");
// [V33.558] 잠정 발언 + 자동 회수(사용자 결정 10/11) — ①②가 강하면(① t ≥ 5 · ② 전 구간 양수) ③ 전에도 좁히기 발언 · 실시간 평균 < 50%(10일+) · 30일 ③ 실패면 회수
const P = (t, folds, g3) => ({ g1: { ok: true, t: t }, g2: { ok: true, folds: folds }, g3: g3 || { days: 0, ok: false } });
const stP = (g) => ({ speak: false, gate: g, trainedAt: now - 3600000, scores: { A: 0.2, B: 0.8 } });
chk(M.omniqBlocks(stP(P(6.85, [0.003, 0.002, 0.002, 0.003])), "A", now) && !M.omniqBlocks(stP(P(6.85, [0.003, 0.002, 0.002, 0.003])), "B", now),
  "잠정 발언: ①②가 강하면 ③ 전에도 하위 절반만 막는다");
chk(!M.omniqProvOf(P(4.9, [0.003, 0.002, 0.002, 0.003])) && !M.omniqProvOf(P(9, [0.003, -0.001, 0.002, 0.003])) && !M.omniqProvOf({ g1: { ok: false, t: 9 }, g2: { ok: true, folds: [1, 1, 1] } }),
  "잠정 조건: ① t < 5 · ② 한 구간이라도 음수 · ① 미통과면 잠정 없음");
chk(M.omniqProvOf(P(9, [1, 1, 1, 1], { days: 9, mu: 0.4, ok: false })) && !M.omniqProvOf(P(9, [1, 1, 1, 1], { days: 10, mu: 0.49, ok: false })) && M.omniqProvOf(P(9, [1, 1, 1, 1], { days: 12, mu: 0.52, lb: 0.47, ok: false })),
  "자동 회수: 10일 이상 평균 < 50% 면 회수 · 10일 전엔 판단 안 함 · 평균 ≥ 50% 면 하한이 넓어도 유지");
chk(!M.omniqProvOf(P(9, [1, 1, 1, 1], { days: 30, mu: 0.51, lb: 0.49, ok: false })) && M.omniqProvOf(P(9, [1, 1, 1, 1], { days: 30, mu: 0.53, lb: 0.51, ok: true })),
  "30일 ③ 정식 시험 실패면 잠정도 회수");
chk(!M.omniqBlocks(Object.assign(stP(P(9, [1, 1, 1])), { trainedAt: now - 6 * 86400000 }), "A", now), "잠정이어도 낡은 점수(5일+)로는 막지 않는다");
chk(/omniq_picks20:/.test(S) && /url\.searchParams\.get\("h"\) === "20"/.test(S), "20일 머리 장부 · 학습기 채점용 조회(h=20)");
// [V33.684] ③ = 모의 시뮬레이션 · 맞춤 기준(사용자 10/27) — 워커가 숫자로 다시 판정 · 실시간 장부(맞춤)는 회수 장치 · 잠정 단계 없음
const REGS = [{ reg: "BULL", n: 400, mean: 0.004, t: 3 }, { reg: "BEAR", n: 120, mean: 0.001, t: 0.4 }, { reg: "CRASH", n: 40, mean: -0.01, t: -2.5 }];
const SIMG = (o) => Object.assign({ kind: "sim", ok: true, n: 900, mx: 0.004, early: { mN: 80, mx: 0.004, mT: 3.1, mWin: 50 }, lateMx: 0.002, needMonths: 24, needT: 2, byReg: REGS, regNow: "BULL", regMinN: 60 }, o || {});
const GS = (g3, live) => ({ g1: { ok: true, t: 9 }, g2: { ok: true, folds: [1, 1, 1, 1] }, g3: g3, g3live: live || null });
chk(M.omniqSpeakOf(GS(SIMG())) && !M.omniqSpeakOf(GS(SIMG({ early: { mN: 80, mx: 0.004, mT: 1.9 } }))) && !M.omniqSpeakOf(GS(SIMG({ lateMx: -0.001 }))) &&
    !M.omniqSpeakOf(GS(SIMG({ early: { mN: 20, mx: 0.004, mT: 3 } }))) && !M.omniqSpeakOf(GS(SIMG({ early: { mN: 80, mx: -0.001, mT: 3 } }))),
  "모의 ③: 앞 80% 24달+·초과>0·t≥2 · 뒤 20% 초과>0 — 학습기 ok 표시가 있어도 숫자가 미달이면 발언 안 함");
// [V33.685] 어떤 국면에서도 — 확실히 지는 국면(거래 ≥ 60 · t ≤ −2)이 있으면 미달 · 오늘 국면 초과 ≤ 0 이면 미달 · 표본 적은 국면은 막지 않는다 · 국면표 없으면 미달
chk(M.omniqSpeakOf(GS(SIMG())) && !M.omniqSpeakOf(GS(SIMG({ byReg: REGS.concat([{ reg: "NEUTRAL", n: 90, mean: -0.004, t: -2.1 }]) }))) &&
    !M.omniqSpeakOf(GS(SIMG({ regNow: "BEAR", byReg: [{ reg: "BULL", n: 400, mean: 0.004, t: 3 }, { reg: "BEAR", n: 120, mean: -0.0005, t: -0.3 }] }))) &&
    M.omniqSpeakOf(GS(SIMG({ regNow: "CRASH" }))) && !M.omniqSpeakOf(GS(SIMG({ byReg: undefined }))),
  "모의 ③ 국면: 확실히 지는 국면 · 오늘 국면 음수면 발언 안 함 · 표본 적은 국면(폭락 n40)은 전체 판정에 맡김 · 국면표 없으면 미달");
chk(!M.omniqSpeakOf(GS(SIMG(), { days: 10, mx: -0.001 })) && M.omniqSpeakOf(GS(SIMG(), { days: 9, mx: -0.01 })) && M.omniqSpeakOf(GS(SIMG(), { days: 30, mx: 0.001 })),
  "실시간 장부(맞춤 초과) 10일 이상 평균 < 0 이면 회수 · 10일 전엔 판단 안 함");
chk(!M.omniqProvOf(GS(SIMG({ ok: false, lateMx: -1 }))) && !M.omniqProvOf(GS(SIMG())), "모의 방식에선 잠정 단계 없음(통과=발언 · 미달=정식 시험 실패)");
const qvS = M.omniqView({ day: "20261027", trainedAt: now, scoredAt: now, speak: true, gate: GS(SIMG(), { days: 3, mx: 0.01 }), gate20: { g1: { ok: true }, g2: { ok: true }, g3: { days: 3, ok: false }, g3sim: SIMG({ ok: false, lateMx: -1 }) } }, now);
chk(qvS.state === "speak" && qvS.gate.g3.kind === "sim" && qvS.gate.g3live.days === 3 && qvS.gate20.g3sim && qvS.gate20.g3sim.ok === false,
  "omniqView: 모의 ③ · 실시간 장부 · 종전 방식 회차의 모의 측정(g3sim)을 화면에 싣는다", JSON.stringify(qvS.gate20));
let r = M.omniqPicksAppend([], "20261007", ["A", "B"], now);
r = M.omniqPicksAppend(r.picks, "20261007", ["X"], now + 1);
chk(!r.added && r.picks.length === 1 && r.picks[0].top.join() === "A,B", "같은 날 장부는 덮어쓰지 않는다");
let pk = []; for (let i = 0; i < 300; i++) pk = M.omniqPicksAppend(pk, String(20250000 + i), ["A"], now).picks;
chk(pk.length === M.OMNIQ.maxPicks && pk[0].day === String(20250000 + 300 - M.OMNIQ.maxPicks), "장부 상한(오래된 것부터 버림)");
const blk = S.slice(S.indexOf("/* [V33.535] ★OMNI-Q 하위 절반 차단★"), S.indexOf("let _spillMult = 1;"));
chk(/!heldSymbols\.has\(symbol\)/.test(blk) && /sr\.strategy === "scalp"/.test(blk) && /incBlock\("OMNIQ_LOW"\)/.test(blk), "배선: 신규 추세·스냅만 · 단타 남김 · 사유 OMNIQ_LOW");
chk(/omniqSpeakOf\(g\)/.test(S.slice(S.indexOf('path === "/api/omni-q" && request.method === "POST"'), S.indexOf('path === "/api/omni-q-picks"'))), "업로드: 발언을 워커가 세 관문에서 다시 판정");
const GW = readFileSync(new URL("../.github/workflows/omniq-gha.yml", import.meta.url), "utf8");
chk(/cron: "20 7 \* \* 1-5"/.test(GW) && /cron: "20 21 \* \* 1-5"/.test(GW) && /omniq_gha\.py/.test(GW) && /secrets\.TRAIN_KEY/.test(GW),
  "정기 OMNI-Q = GitHub Actions(무료) 평일 두 번 → 라이브 장부가 매일 쌓인다");
chk(!/if upload and not \(ksec or flow or news or rally or split or wf or earn\):\s*\n\s*_run_omniq\(\)/.test(MT), "Modal 정기 회차에서는 OMNI-Q 를 돌리지 않는다(크레딧 절약)");

// ── 학습기 관문 수학(실제 파이썬) ──
const py = `
import sys, json, numpy as np, pandas as pd
sys.path.insert(0, ${JSON.stringify(T)})
import omni_q as q
rng = np.random.default_rng(3)
D, S = 400, 120
def run(sig):
    ret = rng.normal(0, 0.02, (D, S))
    score = rng.normal(0, 1, (D, S))
    fwd = ret + sig * score * 0.02          # 점수가 다음 수익을 sig 만큼 설명
    y = pd.DataFrame(fwd).rank(axis=1, pct=True).values
    days = list(range(D))
    br = q.beat_rate(score.astype(np.float32), y, days)
    folds = [float(np.mean(q.decile_excess(score, fwd, days[i*80:(i+1)*80], 0.003))) for i in range(5)]
    g2 = q.gate2(folds)
    return br, q.gate1(br), g2[0]
b0, g10, g20 = run(0.0)
b1, g11, g21 = run(0.6)
# ③ 장부 채점: 라벨 순위가 높은 종목을 고른 장부는 승률 1, 낮은 종목은 0
C = pd.DataFrame(np.ones((40, 30)), index=[20260101 + i for i in range(40)], columns=["S%d" % j for j in range(30)])
yr = np.tile(np.linspace(0, 1, 30), (40, 1))
good = [{"day": str(20260101 + i), "top": ["S29", "S28", "S27"]} for i in range(35)]
bad = [{"day": str(20260101 + i), "top": ["S0", "S1", "S2"]} for i in range(35)]
few = good[:10]
dk = {str(k): i for i, k in enumerate(C.index)}
# DoubleEnsemble(Qlib DEnsemble 이식): 심은 신호를 배우고 · 하위 모델이 K 개 · 피처 선택으로 뒤 모델 피처가 줄어든다
rd = np.random.default_rng(9); Xd = rd.normal(size=(20000, 20)).astype(np.float32); yd = (0.3 * Xd[:, 0] + rd.normal(size=20000)).astype(np.float32)
dm = q.DoubleEnsemble(k=3, rounds=60).fit(Xd, yd); Xe = rd.normal(size=(5000, 20)).astype(np.float32)
de_chk = {"corr": float(np.corrcoef(dm.predict(Xe), 0.3 * Xe[:, 0])[0, 1]), "k": len(dm.models), "nf": [int(len(f)) for f in dm.feats]}
# 보유 띠: 같은 점수·같은 수익이면 띠 쪽 회전 비용이 통째 교체보다 작다(같거나) — 회전 억제가 실제로 일어난다
rs = np.random.default_rng(5); sc = rs.normal(0, 1, (200, 100)); sc = np.cumsum(sc, axis=0) * 0.2 + rs.normal(0, 1, (200, 100)); fw = rs.normal(0, 0.02, (200, 100))
full = q.decile_excess(sc, fw, list(range(200)), 0.01); band = q.decile_excess(sc, fw, list(range(200)), 0.01, band=0.25)
nocost_f = q.decile_excess(sc, fw, list(range(200)), 0.0); nocost_b = q.decile_excess(sc, fw, list(range(200)), 0.0, band=0.25)
cost_f = (np.sum(nocost_f) - np.sum(full)); cost_b = (np.sum(nocost_b) - np.sum(band))
print(json.dumps({"null": [b0, g10, g20], "sig": [b1, g11, g21],
                  "g3good": q.gate3(good, C, yr, dk), "g3bad": q.gate3(bad, C, yr, dk), "g3few": q.gate3(few, C, yr, dk), "costF": cost_f, "costB": cost_b, "de": de_chk}))
`;
// ── [V33.562] 화면 요약(omniqView): 상태는 매매 경로와 같은 술어 · 점수표는 싣지 않는다 · 화면 세 곳이 그 글을 쓴다 ──
{
  const gProv = { g1: { ok: true, t: 7.2, mu: 0.531, lb: 0.52 }, g2: { ok: true, folds: [0.01, 0.02, 0.005], pos: 3, need: 3 }, g3: { days: 2, mu: 0.6, ok: false }, fit: { kind: "정상 범위", inMu: 0.55, outMu: 0.53, gap: 0.02 } };
  const gWeak = { g1: { ok: true, t: 3.1 }, g2: { ok: true, folds: [0.01, -0.01, 0.02] }, g3: { days: 0, ok: false } };
  const qv = M.omniqView({ day: "2026-10-09", trainedAt: now - 3600000, n: 500, scores: { A: 0.1 }, heads: { r20: { A: 0.3 } }, speak: false, gate: gProv, gate20: gWeak, speak20: false }, now);
  chk(qv.state === "prov" && qv.state20 === "shadow" && qv.fresh === true, "omniqView: 잠정 발언/섀도우 = omniqProvOf 와 같은 판정", JSON.stringify([qv.state, qv.state20]));
  chk(qv.scores === undefined && qv.heads === undefined && qv.gate.fit.kind === "정상 범위" && qv.gate.g1.t === 7.2, "omniqView: 점수표 없음 · 관문/적합 진단 실림");
  const qs = M.omniqView({ day: "x", trainedAt: now, speak: true, gate: G(true, true, false) }, now);
  chk(qs.state === "shadow", "omniqView: speak 표시가 있어도 ③ 미통과면 발언 아님(워커가 다시 판정)");
  const qOld = M.omniqView({ day: "x", trainedAt: now - 6 * 86400000, gate: gProv }, now);
  chk(qOld.fresh === false, "omniqView: 5일 넘은 점수는 낡음 표시(매매 경로도 막지 않는다)");
  chk(/_alt\.omniQ = await omniqViewAll/.test(S) && /_ov\.omniQ = await omniqViewAll/.test(S) && /omniQ: await omniqViewAll\(DB\)/.test(S), "omniqViewAll 배선: 사이드바(ai-mode) · 지도(overview) · OMNI 탭");
  const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  chk(/window\.LUX_omq = /.test(H) && /omqNode\(d\.omniQ\)/.test(H) && /LUX_omq\.brief\(d\.omniQ\)/.test(H) && /sec\('OMNI-Q 순위모델'/.test(H) && /LUX_omq\.card\(d\.omniQ\)/.test(H),
      "화면: 한눈 요약 · 지도 칸 · 사이드바 섹션 · OMNI 탭 카드가 OMNI-Q 를 그린다");
  chk(!/arow\('flow'|arow\('xalpha'|arow\('stack'|mrow\('dnn'|am\('flow'|\['기존표본 소급'/.test(H), "화면: 퇴역 4종(DNN·FLOW·XALPHA·STACK) 행이 사이드바·대시보드에 남지 않는다");
}
let J = null;
try { J = JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim().split("\n").pop()); }
catch (e) { chk(false, "파이썬 실행", String(e).slice(0, 300)); }
if (J) {
  chk(J.null[1] === false && J.null[2] === false, "귀무(실력 0): ①② 미달", JSON.stringify(J.null[0]));
  chk(J.sig[1] === true && J.sig[0].lb > 0.5 && J.sig[0].t >= 3, "심은 신호: ① 통과(하한>50% · t≥3)", JSON.stringify(J.sig[0]));
  chk(J.de && J.de.corr > 0.5 && J.de.k === 3 && J.de.nf[2] < J.de.nf[0], "DoubleEnsemble: 심은 신호 학습 · 하위 모델 3 · 피처 선택으로 줄어듦", JSON.stringify(J.de));
  chk(J.costB < J.costF * 0.8, "보유 띠(10%→25%)가 회전 비용을 실제로 줄인다", JSON.stringify([J.costF, J.costB]));
  chk(J.g3good.ok === true && J.g3bad.ok === false && J.g3few.ok === false && J.g3few.days === 10, "③ 장부 채점: 좋은 장부 통과 · 나쁜 장부 미달 · 30일 미만 미달", JSON.stringify([J.g3good, J.g3bad, J.g3few]));
}
if (fails) { console.log("\n✗ OMNI-Q 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ OMNI-Q 계약 통과");
