/* [V33.356] ★"재학습 대기" 가 거짓말이던 것을 막는다 (부스터 3종 합류 사유)★
 *
 *   실측(2026-09-14 23:09 상태 스냅샷) — 같은 응답 안에서 같은 모델을 두고 두 문장이 반대였다:
 *     committee.xgb.latestReceiptReason : "IC 경로 — 블록 유의성 t 1.36 < 1.65"  (featVer 17 · 0.4h 전)
 *     committee.xgb.reason              : "판 불일치(featVer 15 ≠ 17) — 재학습 대기"
 *   `_boosterAdmit` 이 `live || ext` 로 ★언제나 승격기록(live)을 먼저★ 봤기 때문이다.
 *   그 기록은 예전에 승격된 featVer 15 짜리고, 갓 온 featVer 17 은 ext 에 있었다.
 *   결과: 학습기는 6시간마다 멀쩡히 돌고 모델은 0.4시간 전에 도착해 ★유의성으로 거절★ 됐는데,
 *   화면은 "아직 재학습을 기다린다" 고 말했다. 그 문장을 믿으면 학습기를 고치러 간다.
 *   accLB 도 낡은 기록의 것(52.25%)을 찍어 갓 온 모델의 값(51.04%)과 달랐다.
 *
 *   이 게이트가 지키는 것 — 전부 ★_boosterAdmit 을 실제로 돌려서★ 본다:
 *     ① 갓 온 현재-판 모델이 거절된 상태에서 "재학습 대기" 라고 말하지 않는다
 *     ② 그 거절 사유(무엇이 막았는지)가 사유 문장에 실린다
 *     ③ 낡은 기록과 갓 온 기록의 숫자를 ★섞지 않는다★
 *     ④ ★판정(합류/불합류)은 하나도 안 바뀐다★ — 이건 사유만 고치는 변경이다
 *     ⑤ 진짜 판 불일치(갓 온 것이 없음)는 종전대로 "재학습 대기" 라고 말한다
 */
import { readFileSync } from "node:fs";
import { _boosterAdmit, latestExternalReceipt, LUXML, _accFloor, GBDT } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

const NOW = Date.now();
const WANT = LUXML.featVer;
const STALE = WANT - 2;

/* 운영 실측 그대로: 오래전 승격된 낡은 판 + 방금 도착해 거절된 현재 판 */
const staleLive = { featVer: STALE, gbdtAccLB: 0.5225, trusted: true, wGbdt: 0.4,
                    source: "external", trainedAt: NOW - 96 * 3600000 };
const freshExt = (lb, t) => ({ featVer: WANT, gbdtAccLB: lb, trusted: false, source: "external",
                               trainedAt: NOW - 0.4 * 3600000, valICt: t,
                               reason: "IC 경로 — 블록 유의성 t " + t.toFixed(2) + " < 1.65" });

// ── ① · ② · ③ 실제 3종(XGB t1.36 · LGB t1.48 · CAT t1.14) ──────────────────
for (const [nm, lb, t] of [["XGB", 0.5099, 1.36], ["LGB", 0.5104, 1.48], ["CAT", 0.5098, 1.14]]) {
  const a = _boosterAdmit(staleLive, freshExt(lb, t));
  ok(!/재학습 대기/.test(a.why),
     `${nm} — 갓 온 모델이 거절돼 있는데 "재학습 대기" 라고 말하지 않는다`);
  ok(a.why.indexOf(t.toFixed(2)) >= 0,
     `${nm} — 무엇이 막았는지가 사유에 실린다(블록 유의성 t ${t.toFixed(2)})`);
  ok(a.recentAccLB === lb && a.accLB === staleLive.gbdtAccLB,
     `${nm} — 낡은 기록 accLB ${(a.accLB * 100).toFixed(2)}% 와 갓 온 accLB ${(a.recentAccLB * 100).toFixed(2)}% 를 섞지 않는다`);
  ok(a.recentFeatVer === WANT && a.featVer === STALE,
     `${nm} — 두 기록의 featVer 를 각각 내보낸다(${a.featVer} · ${a.recentFeatVer})`);
}

// ── ④ ★판정은 하나도 안 바뀐다★ — 사유만 고치는 변경임을 실행으로 못 박는다 ──
//     고치기 전 판정을 여기서 그대로 재현해(합류 여부는 live 기준) 전 조합을 대조한다.
{
  let drift = 0, n = 0;
  const lbs = [0.40, 0.4899, 0.49, 0.5049, 0.505, 0.5225, 0.60];
  const ts = [null, -1, 0, 1.64, 1.65, 3.0];
  const fvs = [null, STALE, WANT];
  for (const lv of [null, "live"]) for (const fv of fvs) for (const lb of lbs) for (const t of ts) {
    const live = lv ? { featVer: fv, gbdtAccLB: lb, trusted: true, wGbdt: 0.4,
                        valICt: t, source: "external", trainedAt: NOW - 96 * 3600000 } : null;
    const ext = freshExt(0.5099, 1.36);
    const a = _boosterAdmit(live, ext);
    // 고치기 전 규칙(사유 보정 없음)으로 합류 여부를 직접 계산
    const tt = live || ext;
    const _fvOk = (tt == null) ? true : (tt.featVer == null ? true : tt.featVer === WANT);
    const _lb = tt ? (typeof tt.gbdtAccLB === "number" ? tt.gbdtAccLB : 0) : 0;
    const _icT = tt ? (typeof tt.valICt === "number" ? tt.valICt : null) : null;
    const _okEv = (_lb >= 0.505) || (_lb >= 0.49 && _icT != null && _icT >= 1.65);
    const before = !!(tt && _fvOk && !!live && tt.trusted && tt.gbdtAccLB != null && _okEv);
    n++;
    if (a.ok !== before) drift++;
  }
  ok(drift === 0, `합류 판정 ${n}조합 전수 대조 — 고치기 전과 달라진 경우 ${drift}건(사유만 바뀐다)`);
}

// ── ⑤ 진짜 판 불일치는 종전대로 말한다 ─────────────────────────────────────
{
  const a = _boosterAdmit(staleLive, null);
  ok(/재학습 대기/.test(a.why) && a.why.indexOf(String(STALE)) >= 0,
     `갓 온 것이 없으면 종전대로 "재학습 대기" — "${a.why}"`);
  ok(_boosterAdmit(null, null).why === "모델 없음", "기록이 아예 없으면 '모델 없음'");
  const good = { featVer: WANT, gbdtAccLB: 0.60, trusted: true, wGbdt: 0.5, trainedAt: NOW };
  ok(_boosterAdmit(good, null).ok === true && _boosterAdmit(good, null).why == null,
     "정상 승격 모델은 사유 없이 합류한다");
}

// ── ⑥ 낡은 수신분이 live 보다 오래됐으면 사유를 바꾸지 않는다 ────────────────
{
  const oldExt = { featVer: WANT, gbdtAccLB: 0.51, trusted: false,
                   trainedAt: NOW - 200 * 3600000, reason: "옛 거절" };
  const a = _boosterAdmit(staleLive, oldExt);
  ok(/재학습 대기/.test(a.why),
     "수신분이 승격기록보다 ★오래됐으면★ 그것으로 사유를 덮지 않는다(최신인 것만 말한다)");

  /* ★이 절은 _boosterAdmit 이 기대는 '계약' 을 직접 잰다.★
     _boosterAdmit 의 시간 비교(`rc.trainedAt > t.trainedAt`)는 사실
     latestExternalReceipt 의 계약 때문에 ★항상 참★ 이다 — t = live || ext 이므로
     rc !== t 가 되는 경우는 rc 가 더 새로울 때뿐이다. 돌연변이 검사에서 그 비교를 지워도
     게이트가 안 걸리는데, 그건 게이트의 구멍이 아니라 ★그 돌연변이가 동치(no-op)★ 이기
     때문이다. 지운 채로도 맞는 이유가 여기 있으므로, 기대는 그 계약을 여기서 못 박는다 —
     latestExternalReceipt 가 나중에 바뀌면 _boosterAdmit 이 조용히 틀려지기 때문이다. */
  let viol = 0, diff = 0, n = 0;
  const TT = [null, 100, 200, 300];
  for (const lt of TT) for (const et of TT) {
    const lv = lt == null ? null : { tag: "live", trainedAt: lt };
    const ex = et == null ? null : { tag: "ext", trainedAt: et };
    if (!lv && !ex) continue;
    const base = lv || ex;
    const rc = latestExternalReceipt(lv, ex);
    n++;
    if (rc !== base) { diff++; if (!(rc.trainedAt > base.trainedAt)) viol++; }
  }
  ok(viol === 0 && diff > 0,
     `계약: latestExternalReceipt 는 (live||ext) 와 다른 기록을 고를 땐 ★반드시 더 새로운 것★ ` +
     `— ${n}조합 중 다른 기록을 고른 ${diff}건, 위반 ${viol}건`);
  ok(latestExternalReceipt(staleLive, oldExt) === staleLive,
     "latestExternalReceipt 도 더 새로운 쪽(승격기록)을 고른다 — 두 함수가 같은 기록을 본다");
}

// ── ⑦ [V33.357 · G-2 1단계] ★문턱이 두 벌인 것을 기록으로 드러낸다★ ──────────
//   수신(승격) 때는 _accFloor(trustFloor, accBase) 로 무실력 기준선까지 올려 재는데
//   (실측 0.523), 읽기(투표) 때 _boosterAdmit 은 맨 상수 0.505 만 본다.
//   → 옛 규칙으로 승격된 모델이 낮은 바에서 계속 투표한다.
//   지금 맞추면 유일한 보조 위원(GBDT 51.12%)이 빠져 위원회가 빈다 — 그래서 아직 안 맞춘다.
//   대신 ★판정 근거를 기록하게 했는지★ 를 여기서 지킨다. 기록이 없으면 다음 사람도
//   "GBDT 가 어느 경로로 들어왔나" 를 또 추측으로 답하게 된다(이번 세션에 반복된 실패 부류).
{
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  for (const [k, why] of [["trust.accBase", "그때의 무실력 기준선"],
                          ["trust.accFloorUsed", "그때 실제로 쓴 정확도 문턱"],
                          ["trust.passedBy", "정확도로 들어왔나 IC로 들어왔나"]])
    ok(src.indexOf(k) >= 0, `승격 기록에 ${k} 를 남긴다 — ${why}`);

  /* 그리고 ★두 문턱이 실제로 다르다★ 는 것을 실행으로 못 박는다 —
     같아지는 날 이 절이 실패하고, 그때가 읽기 쪽을 맞출 수 있게 된 시점이다. */
  const recv = _accFloor(GBDT.trustFloor, 0.523);     // 수신 쪽 (실측 무실력 0.523)
  const read = GBDT.trustFloor;                        // 읽기 쪽
  ok(recv > read,
     `문턱이 아직 두 벌이다 — 수신 ${recv} vs 읽기 ${read} (G-2: 맞추면 GBDT 가 빠져 위원회가 빈다. ` +
     `accFloorUsed 가 쌓인 뒤 사람이 정한다)`);
  ok(_accFloor(GBDT.trustFloor, null) === GBDT.trustFloor,
     "무실력 기준선이 안 실려 오면 수신 문턱도 종전 상수 그대로(옛 업로드 호환)");
}

console.log(fail ? "\n부스터 사유 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   부스터 사유 계약 통과");
process.exit(fail ? 1 : 0);
