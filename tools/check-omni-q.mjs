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
let r = M.omniqPicksAppend([], "20261007", ["A", "B"], now);
r = M.omniqPicksAppend(r.picks, "20261007", ["X"], now + 1);
chk(!r.added && r.picks.length === 1 && r.picks[0].top.join() === "A,B", "같은 날 장부는 덮어쓰지 않는다");
let pk = []; for (let i = 0; i < 300; i++) pk = M.omniqPicksAppend(pk, String(20250000 + i), ["A"], now).picks;
chk(pk.length === M.OMNIQ.maxPicks && pk[0].day === String(20250000 + 300 - M.OMNIQ.maxPicks), "장부 상한(오래된 것부터 버림)");
const blk = S.slice(S.indexOf("/* [V33.535] ★OMNI-Q 하위 절반 차단★"), S.indexOf("let _spillMult = 1;"));
chk(/!heldSymbols\.has\(symbol\)/.test(blk) && /sr\.strategy === "scalp"/.test(blk) && /incBlock\("OMNIQ_LOW"\)/.test(blk), "배선: 신규 추세·스냅만 · 단타 남김 · 사유 OMNIQ_LOW");
chk(/omniqSpeakOf\(g\)/.test(S.slice(S.indexOf('path === "/api/omni-q" && request.method === "POST"'), S.indexOf('path === "/api/omni-q-picks"'))), "업로드: 발언을 워커가 세 관문에서 다시 판정");
chk(/_run_omniq\(\)/.test(MT) && /if upload and not \(ksec or flow or news or rally or split or wf or earn\):\s*\n\s*_run_omniq\(\)/.test(MT), "정기 회차(업로드)마다 OMNI-Q 갱신 → 라이브 장부가 쌓인다");

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
print(json.dumps({"null": [b0, g10, g20], "sig": [b1, g11, g21],
                  "g3good": q.gate3(good, C, yr, dk), "g3bad": q.gate3(bad, C, yr, dk), "g3few": q.gate3(few, C, yr, dk)}))
`;
let J = null;
try { J = JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim().split("\n").pop()); }
catch (e) { chk(false, "파이썬 실행", String(e).slice(0, 300)); }
if (J) {
  chk(J.null[1] === false && J.null[2] === false, "귀무(실력 0): ①② 미달", JSON.stringify(J.null[0]));
  chk(J.sig[1] === true && J.sig[0].lb > 0.5 && J.sig[0].t >= 3, "심은 신호: ① 통과(하한>50% · t≥3)", JSON.stringify(J.sig[0]));
  chk(J.g3good.ok === true && J.g3bad.ok === false && J.g3few.ok === false && J.g3few.days === 10, "③ 장부 채점: 좋은 장부 통과 · 나쁜 장부 미달 · 30일 미만 미달", JSON.stringify([J.g3good, J.g3bad, J.g3few]));
}
if (fails) { console.log("\n✗ OMNI-Q 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ OMNI-Q 계약 통과");
