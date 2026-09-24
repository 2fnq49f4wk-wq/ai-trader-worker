/* ═══════════════════════════════════════════════════════════════════════════
   [V33.427] ★OMNI 서빙 정합 — 실제로 계산해서 본다(글자만 보지 않는다).★

   ① 꼬리 파일로 낸 피처 = 전체 파일로 낸 피처
      섀도우 채점은 이제 수 MB 전체 파일 대신 ★꼬리★(최근 5분봉 480 · 일봉 330)만 읽는다.
      꼬리가 피처 창보다 짧으면 값이 조용히 달라진다 — 오류는 안 나고 숫자만 틀린다.
      그래서 긴 합성 시계열에서 ★둘 다 계산해★ 칸마다 같은지 본다(장중 행 · 장타 행 · 미국 · 한국).
      ★대조★: 일부러 짧은 꼬리(120)로 내면 값이 ★달라져야★ 한다 — 안 달라지면 이 검사는 눈이 먼 것이다.

   ② 장 마감에 걸린 장중 지평을 채점하지 않는다 = 학습기가 그 행을 안 만든다
      학습기 규칙: 30·60분 라벨은 t[i+nb] − t[i] ≤ nb×300+60 일 때만 행을 만든다(같은 세션).
      워커는 미래 봉 없이 판정해야 하므로 ★세션 안 분★ 으로 판정한다(_omIntraOk).
      두 규칙이 ★모든 격자봉에서★ 같은 답을 내는지 합성 세션으로 전수 대조한다.
   ═══════════════════════════════════════════════════════════════════════════ */
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + (bad || ok)); fails++; } };

/* 결정적 난수 — 검사가 매번 같은 시계열을 본다. */
let _s = 20260924;
const rnd = () => { _s = (_s * 1103515245 + 12345) % 2147483648; return _s / 2147483648; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/* 합성 시장 — 평일마다 정규장 78봉(미국 현지 09:30 · 한국 09:00), 일봉은 현지 날짜 00:00 UTC. */
function synth(mkt, nDays5, nDaysD) {
  const b5 = M._obEmpty(), bd = M._obEmpty();
  let px = 50 + rnd() * 100;
  const days = [];
  let d = new Date(Date.UTC(2023, 0, 2));
  while (days.length < nDaysD) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(new Date(d));
    d = new Date(d.getTime() + 86400000);
  }
  const first5 = days.length - nDays5;
  days.forEach(function (day, k) {
    const dayT = Math.floor(day.getTime() / 1000);
    const openLocalMin = mkt === "us" ? M.OMNI_CONSTS.openUs : M.OMNI_CONSTS.openKr;
    const off = mkt === "us" ? M._omUsOff(dayT + 12 * 3600) : 9;
    const openUtc = dayT + openLocalMin * 60 - off * 3600;
    const o0 = px; let hi = px, lo = px, vol = 0;
    for (let b = 0; b < 78; b++) {
      const o = px; px *= Math.exp(gauss() * 0.002);
      const h = Math.max(o, px) * (1 + Math.abs(gauss()) * 0.0005), l = Math.min(o, px) * (1 - Math.abs(gauss()) * 0.0005);
      const v = 1000 + Math.floor(rnd() * 4000);
      hi = Math.max(hi, h); lo = Math.min(lo, l); vol += v;
      if (k >= first5) { b5.t.push(openUtc + b * 300); b5.o.push(o); b5.h.push(h); b5.l.push(l); b5.c.push(px); b5.v.push(v); }
    }
    bd.t.push(dayT); bd.o.push(o0); bd.h.push(hi); bd.l.push(lo); bd.c.push(px); bd.v.push(vol);
  });
  return { b5, bd };
}
const same = (a, b) => a.length === b.length && a.every(function (x, k) {
  const y = b[k]; return (x !== x && y !== y) || x === y;
});
const diffCols = (a, b) => a.map(function (x, k) { const y = b[k]; return ((x !== x && y !== y) || x === y) ? null : M.OMNI_FEATS[k]; }).filter(Boolean);

console.log("■ ① 꼬리 = 전체 (실제로 둘 다 계산한다)");
for (const mkt of ["us", "kr"]) {
  const { b5, bd } = synth(mkt, 60, 900);
  const T5 = M._obSliceTail(b5, M.OMNI_SHADOW.tail5), TD = M._obSliceTail(bd, M.OMNI_SHADOW.tailD);
  const iF = M._omGridIndex(b5), iT = M._omGridIndex(T5);
  chk(iF != null && iT != null && b5.t[iF] === T5.t[iT], mkt + " 격자봉이 같다(" + (iF != null ? b5.t[iF] : "—") + ")",
      mkt + " 꼬리와 전체가 다른 결정봉을 고른다");
  const fF = M.omniFeatures(b5, bd, iF, mkt, false, null), fT = M.omniFeatures(T5, TD, iT, mkt, false, null);
  const dI = diffCols(fF.x, fT.x);
  chk(dI.length === 0 && fF.setup === fT.setup, mkt + " 장중 행 " + fF.x.length + "칸 전부 같다",
      mkt + " ★꼬리로 낸 장중 피처가 다르다★: " + dI.slice(0, 6).join(","));
  const jF = bd.t.length - 2, jT = TD.t.length - 2;
  const gF = M.omniFeatures(null, bd, null, mkt, true, jF), gT = M.omniFeatures(null, TD, null, mkt, true, jT);
  const dD = diffCols(gF.x, gT.x);
  chk(dD.length === 0 && gF.setup === gT.setup, mkt + " 장타 행 전부 같다",
      mkt + " ★꼬리로 낸 장타 피처가 다르다★: " + dD.slice(0, 6).join(","));
  /* 대조 — 짧은 꼬리는 달라야 한다(검사가 차이를 볼 수 있다는 증거). */
  const S5 = M._obSliceTail(b5, 120), SD = M._obSliceTail(bd, 120);
  const iS = M._omGridIndex(S5);
  const fS = iS == null ? null : M.omniFeatures(S5, SD, iS, mkt, false, null);
  chk(!fS || !same(fF.x, fS.x), mkt + " 대조: 짧은 꼬리(120)는 값이 달라진다 — 검사가 눈을 뜨고 있다",
      mkt + " 짧은 꼬리도 같다고 나온다 — 이 검사는 아무것도 못 본다");
}

console.log("\n■ ② 장 마감 규칙 = 학습기 span 규칙 (모든 격자봉 전수 대조)");
for (const mkt of ["us", "kr"]) {
  const { b5 } = synth(mkt, 40, 60);
  let n = 0, bad = [];
  for (let i = 60; i < b5.t.length - 13; i++) {
    if (b5.t[i] % 1800 !== 0) continue;
    for (const [hz, nb] of [["30m", 6], ["60m", 12]]) {
      const trainer = (b5.t[i + nb] - b5.t[i]) <= nb * 300 + 60;       // omni.py MAX_SPAN_SEC
      const worker = M._omIntraOk(b5.t[i], mkt, hz);
      n++;
      if (trainer !== worker) bad.push(hz + "@" + new Date(b5.t[i] * 1000).toISOString().slice(11, 16));
    }
  }
  chk(n > 500 && bad.length === 0, mkt + " 격자봉 " + n + "건에서 워커 = 학습기",
      mkt + " ★규칙이 갈린다★ " + bad.length + "건: " + bad.slice(0, 5).join(" "));
  chk(M._omIntraOk(b5.t[0], mkt, "1d") === true, mkt + " 1일은 세션을 넘어도 잰다(학습기와 같다)");
}

console.log(fails ? "\n✗ OMNI 서빙 정합 " + fails + "건 실패" : "\n✓ OMNI 서빙 정합 통과");
process.exit(fails ? 1 : 0);
