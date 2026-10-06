/* [V33.501] ★OMNI 섀도우 결정시각 정렬 — 사후채점 묶음이 실제로 찬다★
   운영 로그: "[OMNI-FWD] 묶음 3 채점 · 0행 · 봉없음 607" · 30m 표본 139 · 60m 136 에서 며칠째 정지.
   원인: 결정봉이 ★종목별 꼬리의 마지막★ 격자봉이라 꼬리 갱신 시각(≈18시간 회전)마다 흩어졌다 → 같은 시각 동료 20종목이 안 모인다.
   ① 고정 결정 시각: 세션 안 60·240분(미국 10:30·13:30 ET · 한국 10:00·13:00 KST) · 최근 두 세션 · 마지막(진행 중) 봉 제외 · 지표 회고 안
   ② ★정렬★: 꼬리를 서로 다른 때 받은 두 종목이 같은 결정시각을 낸다(종전 방식은 달랐다 — 대조)
   ③ 전진만: 모델 학습 시각 이전 결정은 안 낸다 · 30·60분 지평이 세션 안에서 끝난다(_omIntraOk)
   ④ 사후채점: 지평 + settleSec 이 지난 묶음만 · 봉이 coverMin 미만이면 라벨 보류 · 병렬 읽기 · 시간 예산 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + (bad || ok)); fails++; } };
function synth(mkt, nDays) {
  const b5 = M._obEmpty(); let px = 100; const days = [];
  let d = new Date(Date.UTC(2026, 8, 1));
  while (days.length < nDays) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) days.push(new Date(d)); d = new Date(d.getTime() + 86400000); }
  for (const day of days) {
    const dayT = Math.floor(day.getTime() / 1000);
    const off = mkt === "us" ? M._omUsOff(dayT + 12 * 3600) : 9;
    const openUtc = dayT + (mkt === "us" ? M.OMNI_CONSTS.openUs : M.OMNI_CONSTS.openKr) * 60 - off * 3600;
    for (let b = 0; b < 78; b++) { b5.t.push(openUtc + b * 300); b5.o.push(px); b5.h.push(px); b5.l.push(px); b5.c.push(px); b5.v.push(1000); px *= 1.0001; }
  }
  return b5;
}
const cut = (b, n) => { const o = M._obEmpty(); for (const k of Object.keys(o)) o[k] = b[k].slice(0, n); return o; };
const tailOf = (b, n) => M._obSliceTail(b, n);
console.log("① 고정 결정 시각");
for (const mkt of ["us", "kr"]) {
  const full = synth(mkt, 12), tl = tailOf(full, M.OMNI_SHADOW.tail5);
  const ds = M._omShadowDecisions(tl, mkt, 0);
  const open = mkt === "us" ? M.OMNI_CONSTS.openUs : M.OMNI_CONSTS.openKr;
  const mins = ds.map((i) => { const dt = new Date((tl.t[i] + (mkt === "us" ? M._omUsOff(tl.t[i]) : 9) * 3600) * 1000); return dt.getUTCHours() * 60 + dt.getUTCMinutes() - open; });
  chk(ds.length === 4 && mins.every((m) => m === 60 || m === 240) && ds.every((i) => i >= M.OMNI_CONSTS.hLook && i < tl.t.length - 1),
    mkt + " 최근 두 세션의 세션 안 60·240분 결정 4개 · 회고 안 · 진행중 봉 제외", mkt + " 결정 " + JSON.stringify(mins));
  chk(ds.every((i) => ["30m", "60m", "1d"].every((h) => M._omIntraOk(tl.t[i], mkt, h))), mkt + " 30·60분 지평이 세션 안에서 끝난다", mkt + " 장마감걸림");
}
console.log("② 정렬(꼬리를 다른 때 받은 두 종목)");
for (const mkt of ["us", "kr"]) {
  const full = synth(mkt, 12);
  const A = tailOf(cut(full, full.t.length - 3), M.OMNI_SHADOW.tail5);    // 장 마감 직전에 받은 꼬리
  const B = tailOf(cut(full, full.t.length - 40), M.OMNI_SHADOW.tail5);   // 장중(오후 초)에 받은 꼬리
  const tA = M._omShadowDecisions(A, mkt, 0).map((i) => A.t[i]), tB = M._omShadowDecisions(B, mkt, 0).map((i) => B.t[i]);
  const common = tA.filter((t) => tB.includes(t));
  chk(common.length >= 3, mkt + " 두 종목이 결정시각 " + common.length + "개를 공유한다(묶음이 찬다)", mkt + " 공유 " + common.length);
  const gA = A.t[M._omGridIndex(A)], gB = B.t[M._omGridIndex(B)];
  chk(gA !== gB, mkt + " 대조: 종전 방식(마지막 격자봉)은 두 종목의 결정시각이 달랐다", mkt + " 대조 실패 — 검사가 차이를 못 본다");
}
console.log("③ 전진만");
{
  const full = synth("us", 12), tl = tailOf(full, M.OMNI_SHADOW.tail5);
  const all = M._omShadowDecisions(tl, "us", 0), minT = tl.t[all[1]];
  const fw = M._omShadowDecisions(tl, "us", minT);
  chk(fw.length === 2 && fw.every((i) => tl.t[i] >= minT), "모델 학습 시각 이전 결정은 내지 않는다", "학습 이전 결정 " + JSON.stringify(fw));
}
console.log("④ 사후채점");
const seg = (a, b) => { const i = S.indexOf(a); return i < 0 ? "" : S.slice(i, S.indexOf(b, i + 10)); };
const res = seg("async function omniShadowResolve", "\nconst OMNI_FWD_SPAN");
const sc = seg("async function omniShadowScore", "\nasync function omniShadowResolve");
chk(/const decs = _omShadowDecisions\(b5, mkt, Math\.floor\(modelAt \/ 1000\)\)/.test(sc) && /for \(const i of decs\)/.test(sc), "채점이 고정 결정 시각을 쓴다(모델 학습 뒤만)", "채점 배선 없음");
chk(/nowS - sp\.sec - OMNI_SHADOW\.settleSec/.test(res) && /\(hz=\? AND tdec<=\?\)/.test(res), "지평 + settleSec 이 지난 묶음만 고른다", "settle 없음");
chk(/frs\.length \/ rows\.length < OMNI_SHADOW\.coverMin && !_late/.test(res) && /partial\+\+/.test(res), "봉이 덜 온 묶음은 라벨 보류(유예 절반 넘으면 있는 만큼)", "부분 라벨");
chk(/Promise\.all\(part\.map/.test(res) && /resolveBudgetMs/.test(res), "봉은 병렬로 · 시간 예산", "직렬/예산 없음");
chk(M.OMNI_SHADOW.settleSec >= 18 * 3600 && M.OMNI_SHADOW.settleSec < M.OMNI_SHADOW.graceSec, "settle(" + M.OMNI_SHADOW.settleSec / 3600 + "h) ≥ 꼬리 회전 18h · < 유예", "settle 범위");
if (fails) { console.log("\n✗ OMNI 섀도우 정렬 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ OMNI 섀도우 정렬 통과");
