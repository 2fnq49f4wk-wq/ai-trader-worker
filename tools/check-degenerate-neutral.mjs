/* ═══════════════════════════════════════════════════════════════════════════
   [V33.399] 퇴화칸 자동 중립화 — "가르칠 분산이 없는 칸"을 측정으로 찾아 끈다

   V33.341 은 ★수확이 만들 수 없는 칸★(sigWeight·confluence·전략원핫)을 손으로 적어
   중립화했다. 진단은 옳았고 목록은 손이었다 — 새 칸이 같은 병에 걸리면 조용히 빠진다.
   실제로 빠졌다. 2026-09-20 회차 [분포이동] 이 찍은 포화 상위는 전부 손목록 밖이었다:
     fomcTo(15.9%) · fomcSince(13.8%) · opexQuad(13.5%) · opexToNext(12.9%) · sectorBeta(11.7%)

   이 고침이 조용히 망가지는 길은 셋이고, 셋 다 예외를 안 던진다:
     ① ★Xn 만 0 으로 덮는 구현★ — 학습·검증은 중립인데 서빙(워커)은 실값을 넣는다.
        그러면 고치려던 train/serve 스큐를 ★내가 만든다.★ σ 로 해야 업로드에 실려
        워커까지 같은 자를 쓴다.
     ② 기준을 ★or★ 로 느슨하게 풀면 멀쩡한 희소 플래그(fomcKnown 같은)가 꺼진다.
        "없는 신호를 지우는 것" 과 "있는 신호를 지우는 것" 의 경계가 여기다.
     ③ 분할(tr/va) 전에 재면 검증행이 기준에 섞여 누출이 된다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 중립화 블록이 존재하고 분할 뒤에 있는가");
const i0 = PY.indexOf("[퇴화칸]");
const iSplit = PY.indexOf('horizon_ms=_HORIZON_MS, cal_frac=0.10, tag="DNN"');
chk(i0 > 0, "퇴화칸 블록이 있다", "★퇴화칸 중립화가 사라졌다 — 포화 칸이 다시 ±6σ 로 들어간다★");
chk(iSplit > 0 && i0 > iSplit,
  "분할(_split_ts, DNN) 뒤에서 잰다 — 학습행만으로 판정한다",
  "★분할보다 앞에서 잰다 — 검증행이 기준에 섞여 누출이다★");
// 블록 본문만 떼어낸다(다음 진단 머리글 전까지)
const bEnd = PY.indexOf("[퇴화칸] 못 했다", i0);
const B = PY.slice(PY.lastIndexOf("try:", i0 - 400), bEnd > 0 ? bEnd + 200 : i0 + 3000);

console.log("\n② ★σ 로 중립화하는가 — Xn 만 덮으면 서빙이 갈라진다★");
chk(/std\[[A-Za-z_]\w*\]\s*=\s*1e9/.test(B),
  "std[j] = 1e9 — 업로드되는 자 자체를 바꾼다(워커도 같은 자를 쓴다)",
  "★σ 를 안 바꾼다 — 중립화가 트레이너 안에서만 일어난다★");
chk(/Xn\s*=\s*np\.clip\(\(X - mean\) \/ std/.test(B),
  "바꾼 σ 로 Xn 을 다시 만든다", "★σ 만 바꾸고 Xn 을 안 고친다 — 학습은 옛 값으로 돈다★");
chk(!/Xn\[[^\]]*\]\s*=/.test(B) && !/Xn\[:,\s*[A-Za-z_]\w*\]\s*=/.test(B),
  "Xn 의 칸을 직접 0 으로 덮지 않는다",
  "★Xn 을 직접 덮는다 — 학습·검증만 중립이고 서빙은 실값이다(스큐를 새로 만든다)★");

console.log("\n③ 기준은 둘 다(and) — 하나라도 or 면 멀쩡한 희소 플래그가 꺼진다");
chk(/_mode\s*>=\s*0\.90\s+and\s+float\(_satv\[j\]\)\s*>=\s*0\.05/.test(B),
  "학습 최빈 ≥90% ★그리고★ 검증 포화 ≥5% 일 때만 끈다",
  "★기준이 느슨하다(or 이거나 한쪽만) — 가르칠 분산이 있는 칸까지 꺼진다★");
chk(/_satv\s*=\s*\(np\.abs\(Xn\[va\]\)\s*>=\s*std_clip/.test(B),
  "포화는 ★검증행★ 에서 잰다(실제로 튀고 있는지)",
  "포화를 학습행에서 잰다 — 튀는 쪽을 안 보고 있다");
chk(/X\[tr\]\[:,\s*j\]/.test(B),
  "최빈 비율은 ★학습행★ 원값에서 잰다(누출 없음)",
  "최빈을 전체행/표준화값에서 잰다 — 누출이거나 자가 틀렸다");

console.log("\n④ ★서빙 정합 — 워커가 σ=1e9 를 같은 뜻으로 읽는가(실행해서 확인)★");
{
  const D = M.LUXML.featNames.length;
  const mean = new Array(D).fill(0), std = new Array(D).fill(1);
  const j = M.LUXML.featNames.indexOf("fomcTo") >= 0 ? M.LUXML.featNames.indexOf("fomcTo") : 0;
  std[j] = 1e9;
  const a = new Array(D).fill(0); a[j] = 0;
  const b = new Array(D).fill(0); b[j] = 45;
  const za = M._dnnStdVec(a, mean, std), zb = M._dnnStdVec(b, mean, std);
  chk(Math.abs(za[j]) < 1e-6 && Math.abs(zb[j]) < 1e-6,
    "σ=1e9 인 칸은 워커에서 값이 0 이든 45 든 z≈0 — 서빙도 같이 중립이다",
    "★워커가 σ=1e9 를 중립으로 안 읽는다(z=" + zb[j] + ") — 학습과 서빙이 갈라진다★");
  chk(za.every((v, k) => k === j ? true : v === zb[k]),
    "다른 칸은 손대지 않는다", "중립화가 다른 칸까지 바꾼다");
  // 1e-6 가드에 걸려 1 로 되돌아가면 중립이 아니라 ★원값 통과★ 가 된다 — 그 반대도 막는다
  const std2 = new Array(D).fill(1); std2[j] = 0;
  const z2 = M._dnnStdVec(b, mean, std2);
  chk(Math.abs(z2[j]) > 1e-6,
    "σ=0 은 (종전대로) 1 로 대체돼 값이 통과한다 — 중립화는 σ=0 이 아니라 ★큰 σ★ 여야 한다",
    "σ=0 처리가 바뀌었다 — 중립화 방식을 σ=0 으로 바꾸면 조용히 원값이 통과한다");
}

console.log("\n⑤ 달력 진단이 다음 회차에 답을 주는가");
chk(PY.indexOf("[달력결측]") > 0 && /fomcKnown=0 비율/.test(PY),
  "[달력결측] 이 학습·검증의 fomcKnown=0 비율을 찍는다 — 표 커버리지 고침이 먹혔는지 확인할 숫자",
  "★확인할 숫자가 없다 — '고쳤다' 를 말로만 하게 된다★");
chk(PY.indexOf("[달력분포]") > 0,
  "[달력분포] 가 학습구간의 σ·최빈비율을 칸별로 찍는다", "달력 칸의 학습분포를 안 찍는다");

console.log(fails === 0 ? "\n✓ 퇴화칸 중립화 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
