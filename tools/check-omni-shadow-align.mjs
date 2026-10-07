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
// [V33.505] 고정 20h 대기 → 지평 + 15분 · 봉이 덜 온 묶음은 그 묶음만 쉰다(backoff) · 20h 지나면 있는 만큼
chk(/nowS - sp\.sec - OMNI_SHADOW\.minSettleSec/.test(res) && /\(hz=\? AND tdec<=\?\)/.test(res), "지평 + minSettleSec(15분) 이 지나면 묶음을 본다", "minSettle 없음");
chk(/frs\.length \/ rows\.length < OMNI_SHADOW\.coverMin && !_late/.test(res) && /waitMap\[wkey\] = nowS \+ OMNI_SHADOW\.backoffSec/.test(res) && /const _late = tdec < nowS - span\.sec - OMNI_SHADOW\.settleSec;/.test(res),
  "봉이 덜 온 묶음은 라벨 보류 + 그 묶음만 backoff · settle 지나면 있는 만큼", "부분 라벨/backoff");
chk(/Promise\.all\(part\.map/.test(res) && /resolveBudgetMs/.test(res), "봉은 병렬로 · 시간 예산", "직렬/예산 없음");
chk(M.OMNI_SHADOW.minSettleSec <= 30 * 60 && M.OMNI_SHADOW.settleSec < M.OMNI_SHADOW.graceSec && M.OMNI_SHADOW.backoffSec <= 2 * 3600 && M.OMNI_SHADOW.scanGroups > M.OMNI_SHADOW.batchGroups,
  "최소 대기 ≤30분 · 최대 대기(settle) < 유예 · backoff ≤2h · 훑는 묶음 > 처리 묶음", "대기 상수");
chk(M.OMNIBARS.refreshH["5m"] <= 6, "5분봉 재수집 ≤ 6h(장 마감 뒤 그날 봉이 채점에 들어온다)", "5분봉 refreshH " + M.OMNIBARS.refreshH["5m"]);
console.log("⑤ 막힘 재현(옛 봉없는 묶음 + 새 묶음 · 한 번에 1묶음)");
{
  const NOW = Math.floor(Date.now() / 1000);
  const base = M.OMNI_CONSTS.base;
  const tNew = Math.floor((NOW - 3600) / base) * base;               // 1시간 전 결정(30m 지평 + 15분 지남)
  const tOld = Math.floor((NOW - 2 * 86400) / base) * base;          // 이틀 전(정렬 전 · 봉 없음)
  const rows = []; let id = 1;
  for (let k = 0; k < 25; k++) rows.push({ id: id++, symbol: "OLD" + k, market: "us", tdec: tOld, hz: "30m", p: 0.6, ver: M.OMNI_VER, label: null });
  for (let k = 0; k < 25; k++) rows.push({ id: id++, symbol: "NEW" + k, market: "us", tdec: tNew, hz: "30m", p: k % 2 ? 0.7 : 0.3, ver: M.OMNI_VER, label: null });
  const store = new Map();
  const DB = { prepare: (sql) => { let a = []; const st = { sql, bind: (...x) => { a = x; st.args = x; return st; },
    first: async () => /SELECT v FROM state WHERE k = \?/.test(sql) && store.has(a[0]) ? { v: store.get(a[0]) } : null,
    all: async () => {
      if (/GROUP BY tdec, hz/.test(sql)) {
        const ver = a[0], cuts = {}; for (let i = 1; i + 1 < a.length - 2; i += 2) cuts[a[i]] = a[i + 1];
        const m = new Map();
        for (const r of rows) if (r.label === null && r.ver === ver && cuts[r.hz] != null && r.tdec <= cuts[r.hz]) { const k = r.tdec + "|" + r.hz; m.set(k, (m.get(k) || 0) + 1); }
        return { results: [...m].map(([k, n]) => ({ tdec: +k.split("|")[0], hz: k.split("|")[1], n })).filter((x) => x.n >= a[a.length - 2]).sort((x, y) => x.tdec - y.tdec).slice(0, a[a.length - 1]) };
      }
      if (/SELECT id, symbol, market, p FROM omni_shadow WHERE tdec=\?/.test(sql)) return { results: rows.filter((r) => r.tdec === a[0] && r.hz === a[1] && r.label === null) };
      return { results: [] }; },
    run: async () => { if (/INSERT INTO state/.test(sql)) store.set(a[0], a[1]); return { meta: { changes: 0 } }; } }; return st; },
    batch: async (sts) => { for (const st of sts) {
      if (/SET label=-1/.test(st.sql)) { const r = rows.find((x) => x.id === st.args[1]); if (r) r.label = -1; continue; }
      const [lab, fr, , rid] = st.args; const r = rows.find((x) => x.id === rid); if (r) { r.label = lab; r.fr = fr; } } return []; } };
  const R2 = { get: async (key) => {
    const m = /NEW(\d+)/.exec(key); if (!m) return null;
    const k = +m[1], t = [], c = [];
    for (let i = -10; i <= 10; i++) { t.push(tNew - base + i * base); c.push(100 * (1 + (i > 0 ? (k - 12) * 0.001 * i : 0))); }
    const body = JSON.stringify({ "5m": { t, c } });
    return { text: async () => body }; } };
  M._setR2ForTest(R2);
  const r1 = await M.omniShadowResolve(DB, { groups: 1 });
  const w1 = JSON.parse(store.get("omni_fwd_wait") || "{}");
  const oldClosed = rows.filter((r) => r.symbol.startsWith("OLD") && r.label === -1).length;
  chk(/못잼닫음 25/.test(r1) && oldClosed === 25 && !/채점 · 25행/.test(r1), "1회차: 늦었는데 봉이 하나도 없는 옛 묶음은 '못 잼(-1)' 으로 닫는다(성적엔 안 셈)", "1회차 " + r1);
  void w1;
  const r2 = await M.omniShadowResolve(DB, { groups: 1 });
  const lab = rows.filter((r) => r.symbol.startsWith("NEW") && (r.label === 0 || r.label === 1)).length;
  chk(lab >= 20 && /채점 · \d+행/.test(r2), "★2회차: 새 묶음을 채점한다(" + lab + "행)★ — 종전엔 같은 옛 묶음이 매번 자리를 먹었다", "2회차 " + r2 + " · 라벨 " + lab);
  // backoff: 지평 막 지난 묶음에 봉이 덜 왔으면 그 묶음만 쉬고 다음 틱엔 건너뛴다
  const tMid = tNew - 3 * base;
  for (let k = 0; k < 25; k++) rows.push({ id: id++, symbol: "MID" + k, market: "us", tdec: tMid, hz: "30m", p: 0.6, ver: M.OMNI_VER, label: null });
  const r3 = await M.omniShadowResolve(DB, { groups: 1 });
  const w3 = JSON.parse(store.get("omni_fwd_wait") || "{}");
  const r4 = await M.omniShadowResolve(DB, { groups: 1 });
  chk(/덜참보류 1/.test(r3) && w3["30m|" + tMid] > NOW && /봉대기 1/.test(r4), "봉이 덜 온 최근 묶음은 보류 + backoff → 다음 틱엔 건너뛴다", "backoff " + r3 + " / " + r4);
  M._setR2ForTest(null);
}
console.log("⑥ 수집기 — 채점 대기 종목 먼저(V33.507)");
{
  const col = seg("async function omniBarsCollect", "\n/* ═══");
  chk(/WHERE label IS NULL AND ver=\? AND hz IN \('30m','60m','1d'\)/.test(col) && /ORDER BY need DESC/.test(col), "라벨 안 달린 30m·60m·1d 결정의 종목을 최근 것부터 고른다", "우선 목록 질의");
  chk(/_num\(m5\.upd, 0\) >= \(_num\(r\.need, 0\) \+ 300\) \* 1000/.test(col), "지평이 끝난 뒤로 5분봉을 받은 적이 없는 종목만", "필요 조건");
  chk(/const cap = inHours \? 8 : Math\.max\(1, Math\.floor\(per \* 3 \/ 4\)\)/.test(col) && /for \(let k = inHours \? 0 : seq\.length; k < per; k\+\+\)/.test(col),
    "장외: 몫의 3/4 까지 · 장중: 커서 몫은 그대로 + 채점 대기 최대 8 — 커서 회전은 계속된다", "상한");
  chk(/const force = res === "5m" && prioSet\.has\(sym\);/.test(col) && /if \(!force && curVer && meta\.upd/.test(col), "우선 종목은 5분봉만 refreshH 를 건너뛴다(1일봉은 종전)", "강제 수집");
  chk(/nowMs - _num\(m5\.err, 0\) < 1800000/.test(col), "30분 안에 실패한 종목은 쉰다(같은 실패를 매 회차 두드리지 않게)", "실패 쉼");
}
if (fails) { console.log("\n✗ OMNI 섀도우 정렬 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ OMNI 섀도우 정렬 통과");
