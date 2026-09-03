/* ═══════════════════════════════════════════════════════════════════════════
   [V33.300] "블록 5개 미만이면 못 잰 것" 이라는 가드가 ★한 번도 발동한 적이 없다★.

   ■ 무엇이 어긋나 있었나
     ICGATE.minBlocks 주석: "홀드아웃 블록(★=서로 다른 날★)이 이보다 적으면 유의성 판정
     자체를 보류한다". 그런데 expertAdmit 이 센 값은 _icBlockStats 의 ★슬라이스 개수★ 이고
         k = Math.max(kWant(5), Math.min(12, floor(n / 200)))
     라 ★언제나 5 이상★ 이다 — 분기가 구조적으로 도달 불가능한 죽은 코드였다.

   ■ 왜 치명적인가 — 라벨 지평이 10일이다
     MEMO 운영 실측: 학습창 67일 → 홀드아웃 약 13일.
     13일 안에 10일짜리 라벨 구간은 ★1개★ 들어간다. 그런데 코드는 그 13일을 12조각으로
     잘라 "블록 12개" 로 보고하고 그 분산으로 t 를 만든다 — 재는 것은 실력이 아니라
     ★그 2주의 시장 방향★ 이다. MEMO 가 +0.0351 ↔ −0.0390 을 오간 것,
     신규 모델이 죄다 '잠정' 에 멈춘 것이 전부 여기서 나온다.

   ■ 고침 — 문턱은 안 건드린다. ★세는 대상★ 을 주석이 말하던 것으로 되돌린다
     겹치지 않는 관측 수 = 홀드아웃 달력기간 ÷ 라벨 지평.
     이 값이 minBlocks 아래면 '못 미쳤다' 가 아니라 ★'아직 못 쟀다'(pending)★ 로 판정한다.

   ■ 이 검사가 무는 것
     ① 종전 슬라이스 계산은 ★어떤 입력에서도★ 5 미만이 안 나온다(죽은 가드의 증명)
     ② 새 계산은 짧은 홀드아웃에서 실제로 5 미만이 된다
     ③ expertAdmit 이 그때 pending 을 내고, 사유가 '못 쟀다' 라고 말한다
     ④ 긴 홀드아웃은 종전과 똑같이 판정된다(무해성)
     ⑤ 구 모델 레코드(valICeff 없음)는 종전 동작 그대로(호환)
     ⑥ 문턱 상수는 하나도 안 바뀌었다
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const H = M.AI_PARAMS.predictionHorizonDays;
const MINB = M.ICGATE.minBlocks;

console.log("① 종전 슬라이스 계산은 5 미만이 나올 수 있는가 (죽은 가드의 증명)");
{
  // _icBlockStats 를 실제로 돌려, 어떤 홀드아웃 크기에서도 K 가 5 밑으로 안 가는지 본다.
  let minK = 1e9, minAt = 0, measured = 0;
  for (const n of [120, 200, 400, 800, 1500, 3000, 8000, 20000]) {
    const p = [], y = [];
    for (let i = 0; i < n; i++) { p.push((i * 37 % 100) / 100); y.push((i * 17 % 3) === 0 ? 1 : 0); }
    const st = M._icBlockStats(p, y, 5);
    if (st.K > 0) { measured++; if (st.K < minK) { minK = st.K; minAt = n; } }
  }
  console.log(`       홀드아웃 8종 크기에서 실제 K — 최솟값 ${minK} (n=${minAt})`);
  chk(minK >= MINB,
    `종전 계산은 ★어떤 크기에서도★ K ≥ ${MINB} 다(최소 ${minK}) — 가드가 발동할 수 없었다`,
    `종전 계산이 ${MINB} 미만을 낸다(${minK}) — 이 검사의 전제가 틀렸다`);
  chk(/const k = Math\.max\(kWant, Math\.min\(12, Math\.floor\(n \/ 200\)\)\);/.test(S),
    "그 이유가 코드에 그대로 있다 — Math.max(kWant=5, …) 이므로 하한이 5 다",
    "슬라이스 산식이 바뀌었다 — 이 검사를 다시 봐야 한다");
}

console.log("\n② 새 계산은 짧은 홀드아웃에서 실제로 모자란다고 말하는가");
{
  const rows = [[13, "MEMO 운영 실측(창 67일)"], [24, "창 120일"], [60, "창 300일"], [120, "창 600일"]];
  console.log(`       라벨 지평 ${H}일 · 판정에 필요한 관측 ${MINB}개 = ${MINB * H}일`);
  for (const [span, nm] of rows) {
    const eff = M._effBlocks(span, H * 86400000);
    console.log(`       홀드아웃 ${String(span).padStart(3)}일 → 겹치지않는관측 ${String(eff).padStart(2)}개  ${eff < MINB ? "★판정불가★" : "판정가능"}   ${nm}`);
  }
  chk(M._effBlocks(13, H * 86400000) < MINB,
    `MEMO 의 13일 홀드아웃은 관측 ${M._effBlocks(13, H * 86400000)}개 — 판정 불가로 잡힌다`,
    "13일 홀드아웃이 판정 가능으로 나온다 — 고침이 작동하지 않는다");
  chk(M._effBlocks(MINB * H, H * 86400000) >= MINB,
    `필요 기간(${MINB * H}일)을 채우면 판정 가능해진다 — 기다리면 열린다`,
    "필요 기간을 채워도 안 열린다");
  // 달력 기간 자체를 세는 함수도 확인한다(행 수가 아니라 ts 범위를 본다).
  const DAY = 86400000, T = [];
  for (let d = 0; d < 40; d++) for (let k = 0; k < 500; k++) T.push(1e12 + d * DAY);
  chk(M._holdSpanDays(T, 20000 - 6500, 20000) === 12,
    "홀드아웃 기간을 ★행 수가 아니라 달력★ 으로 센다(500종목×13일 = 12일 간격)",
    `달력 기간 계산이 틀렸다(${M._holdSpanDays(T, 20000 - 6500, 20000)})`);
}

console.log("\n③ expertAdmit 이 그때 pending 을 내고, 사유가 '못 쟀다' 라고 말하는가");
{
  const base = { valICBlock: 0.02, valICt: 2.0, valICdf: 11, tMinUsed: 2.69,
                 fwdReady: true, fwdIC: 0.01, fwdICt: 1.2, fwdN: 900, trusted: false };
  const short = M.expertAdmit(Object.assign({}, base, { valICeff: 1, valICspanD: 13 }));
  const long  = M.expertAdmit(Object.assign({}, base, { valICeff: 12, valICspanD: 130 }));
  console.log(`       13일  → tier ${short.tier} · ${String(short.why).slice(0, 72)}`);
  console.log(`       130일 → tier ${long.tier} · ${String(long.why).slice(0, 72)}`);
  chk(short.tier === "pending" && short.admit === false,
    "관측이 모자라면 pending 이다 — 못 잰 것을 잰 척하지 않는다",
    `★관측이 모자란데 ${short.tier} 로 합류한다 — 의미 없는 t 로 사이징에 표를 준다★`);
  chk(/못 쟀다/.test(short.why) && /지평/.test(short.why),
    "사유가 ★'못 미쳤다' 가 아니라 '아직 못 쟀다'★ 라고 말한다(처방이 다르다)",
    "사유가 여전히 '문턱 미달' 로 읽힌다 — 사람이 모델을 고치러 간다");
  chk(new RegExp(String(MINB * H)).test(short.why),
    `필요한 관측 기간(${MINB * H}일)을 사유에 적는다 — 무엇을 기다리면 되는지 보인다`,
    "얼마를 기다려야 하는지 안 적는다");
  chk(long.tier !== "pending",
    "관측이 충분하면 종전대로 t 로 판정한다", "충분한데도 pending 이다 — 과잉 차단");
}

console.log("\n④~⑥ 무해성 · 호환 · 완화금지");
{
  const base = { valICBlock: 0.02, valICt: 2.0, valICdf: 11, tMinUsed: 2.69,
                 fwdReady: true, fwdIC: 0.01, fwdICt: 1.2, fwdN: 900, trusted: false };
  const withEff = M.expertAdmit(Object.assign({}, base, { valICeff: 12, valICspanD: 130 }));
  const noEff   = M.expertAdmit(Object.assign({}, base));   // 구 모델 레코드
  chk(withEff.tier === noEff.tier && Math.abs(withEff.mult - noEff.mult) < 1e-9,
    `관측이 충분하면 새 판정과 종전 판정이 같다(${noEff.tier} ×${noEff.mult})`,
    `충분한데도 판정이 달라졌다(${withEff.tier} vs ${noEff.tier})`);
  chk(noEff.tier !== "pending",
    "구 모델 레코드(valICeff 없음)는 종전 동작 그대로 — 배포 직후 전원 pending 이 되지 않는다",
    "★구 레코드가 전부 pending 이 된다 — 배포 순간 위원회가 비어버린다★");
  chk(M.ICGATE.minBlocks === 5 && M.ICGATE.familyAlpha === 0.05 && M.ICGATE.forwardTMin === 1.0,
    "문턱 상수(minBlocks 5 · α 0.05 · 전진 t 1.0)는 하나도 안 바뀌었다 — 세는 대상만 고쳤다",
    "★문턱 상수가 바뀌었다 — 그러면 이 변경의 성격이 달라진다★");
  chk(/_useK = \(_eff != null\) \? _eff : _K/.test(S),
    "새 값이 있으면 그것으로, 없으면 종전 값으로 판정한다(단일 분기)",
    "판정 경로가 갈라져 있다");
}

console.log(fails === 0 ? "\n✓ 홀드아웃 검정력 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
