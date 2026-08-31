/* ═══════════════════════════════════════════════════════════════════════════
   [V33.288] MEMO — 시장 칸막이가 실제로 서 있는가, 그리고 그게 이득인가.

   ■ 무엇이 잘못돼 있었나
     V33.273/274 는 거리의 축마다 라벨 상관 |r_j| 를 재 그 크기로 눌렀다(관련도 가중 kNN).
     예측축에는 맞는 처방이다. 그런데 같은 자가 mktUS/mktKR/mktCM ★원핫★ 에도 걸렸다.
     시장 원핫은 라벨과의 marginal 상관이 거의 0 이라 잡음바닥(2/√ntr) 아래로 떨어지고,
     그러면 가중이 ★정확히 0★ 이 되어 거리에서 사라진다.
     → 삼성전자의 '가장 닮은 과거' 로 엔비디아의 어느 날이 뽑힐 수 있었다.

   ■ 고침
     시장은 무게를 줄 축이 아니라 ★칸막이★ 다. 원형책을 시장별로 세우고, 추론도 같은
     시장의 책만 뒤진다. 수축 목표도 그 시장의 기저로 바꾼다.
     ★해상도는 안 건드린다★ — K_m = K·n_m/ntr 이라 표본/원형 비도 총 원형 수도 종전과 같다.

   ■ 이 검사가 무는 것
     ① 자가 실제로 시장축을 0 으로 죽인다(주장한 원인이 재현되는가)
     ② 원형마다 시장표가 붙고, 채점이 ★절대★ 다른 시장 원형을 안 고른다
     ③ 구 모델(표 없음)은 종전대로 채점된다 — 전진검증 경로가 안 깨진다
     ④ 총 원형 수·표본당 원형 수가 종전과 같다(해상도 증설을 몰래 섞지 않았다)
     ⑤ ★이득 측정★ — 시장마다 예측 가능성이 다른 데이터에서
        칸막이 있는 모델 vs 혼합책 모델의 홀드아웃 IC/정확도를 직접 비교한다
     ⑥ ★비용 측정★ — 시장이 무의미한 데이터에서 칸막이가 얼마를 까먹는지도 적는다
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const D = M.LUXML.featNames.length;
const I_US = M.LUXML.featNames.indexOf("mktUS");
const I_KR = M.LUXML.featNames.indexOf("mktKR");
const I_CM = M.LUXML.featNames.indexOf("mktCM");

let _s = 20260831;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pearson = (a, b) => {
  const n = a.length; if (n < 3) return 0;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; sa += x * x; sb += y * y; }
  return (sa > 0 && sb > 0) ? sab / Math.sqrt(sa * sb) : 0;
};
const sd = (a) => { const n = a.length; let m = 0; for (const v of a) m += v; m /= n;
  let s = 0; for (const v of a) s += (v - m) * (v - m); return Math.sqrt(s / n); };

const mkDB = (rows) => {
  const st = new Map();
  return { st, DB: { prepare(sql) {
    const q = { args: [] };
    q.bind = function () { q.args = Array.from(arguments); return q; };
    q.all = async () => ({ results: /FROM ml_samples/.test(sql) ? rows.map(r => Object.assign({}, r)) : [] });
    q.first = async () => {
      if (/SELECT v FROM state/.test(sql)) { const v = st.get(q.args[0]); return v == null ? null : { v }; }
      return null;
    };
    q.run = async () => { if (/INSERT INTO state/.test(sql)) st.set(q.args[0], q.args[1]); return {}; };
    return q;
  } } };
};
const train = async (rows) => {
  const { st, DB } = mkDB(rows);
  const msg = await M.memoTrainNightly(DB);
  return { msg, model: JSON.parse(st.get("memo_model") || "null") };
};

/* ── 데이터: 시장마다 ★예측 가능성이 다르다★ ─────────────────────────────
   US 표본은 a축으로 잘 설명되고, KR 표본은 사실상 설명이 안 된다(잡음).
   기저승률은 두 시장이 같게 둔다 — 그래야 시장 원핫의 marginal |r| 이 0 이 되어
   관련도 가중이 그 축을 지우는 ★바로 그 조건★ 이 재현된다.
   혼합책은 이 상황에서 US 에서 배운 엣지를 한국 종목에 그대로 발라 버린다.       */
const SIG = 7;                              // 신호축(시장 원핫과 겹치지 않는 자리)
const N = 6000, DAY = 86400000, T0 = Date.parse("2023-01-01T00:00:00Z");
const rowsPart = [], rowsMix = [], mktOf = [];
for (let i = 0; i < N; i++) {
  const f = new Array(D);
  for (let j = 0; j < D; j++) f[j] = gauss();
  f[I_US] = 0; f[I_KR] = 0; f[I_CM] = 0;
  const isUS = (i % 2 === 0);
  f[isUS ? I_US : I_KR] = 1;
  mktOf.push(isUS ? 0 : 1);
  const pnl = isUS ? (1.6 * f[SIG] + 1.0 * gauss())    // 미국: a축이 설명한다
                   : (0.0 * f[SIG] + 2.0 * gauss());   // 한국: 이 축으로는 설명 안 된다
  const base = { id: i + 1, ts: T0 + i * DAY, label: pnl > 0 ? 1 : 0, pnl_pct: +pnl.toFixed(4) };
  rowsPart.push(Object.assign({ feat: JSON.stringify(f) }, base));
  const g = f.slice(); g[I_US] = 0; g[I_KR] = 0; g[I_CM] = 0;   // 원핫을 지운다 = 종전 혼합책
  rowsMix.push(Object.assign({ feat: JSON.stringify(g) }, base));
}
rowsPart.reverse(); rowsMix.reverse();      // 쿼리는 ORDER BY ts DESC

console.log("① 관련도 가중이 시장축을 0 으로 죽이는가 (주장한 원인의 재현)");
const A = await train(rowsPart);
console.log("       " + String(A.msg).slice(0, 200));
chk(!!(A.model && A.model.protos && A.model.protos.length >= 8),
  `학습 완료 — 원형 ${A.model ? A.model.protos.length : 0}개`, "학습이 원형을 못 만들었다: " + A.msg);
if (!A.model) { console.log("\n✗ " + (fails + 1) + "건 실패"); process.exit(1); }
{
  const sMkt = [I_US, I_KR, I_CM].map(j => A.model.scale[j]);
  console.log(`       시장축 가중 [${sMkt.map(v => v.toFixed(4)).join(", ")}] · 신호축 ${A.model.scale[SIG].toFixed(4)}`);
  chk(sMkt.every(v => v === 0),
    "시장 원핫 세 축의 가중이 정확히 0 이다 — 거리에 남아 있지 않다(그래서 칸막이가 필요하다)",
    `시장축이 가중을 갖는다 [${sMkt.join(", ")}] — 이 검사의 전제가 성립하지 않는다`);
}

console.log("\n② 원형마다 시장표가 붙고, 채점이 다른 시장 원형을 안 고르는가");
{
  chk(A.model.protos.every(p => p.m === 0 || p.m === 1 || p.m === 2 || p.m === -1),
    "모든 원형이 시장표(m)를 들고 있다", "시장표 없는 원형이 있다");
  chk(Array.isArray(A.model.mktIdx) && A.model.mktIdx.length === 3,
    `칸막이 인덱스가 모델에 실려 있다 [${A.model.mktIdx}] — 추론이 featNames 순서를 다시 안 읽는다`,
    "모델에 mktIdx 가 없다");
  chk(Array.isArray(A.model.books) && A.model.books.length >= 2,
    `시장책이 ${A.model.books ? A.model.books.length : 0}권 섰다 (${(A.model.books || []).map(b => b.m + ":" + b.k + "/" + b.n).join(" ")})`,
    "시장책이 갈리지 않았다");

  /* 결정적 최소사례 — 다른 시장 원형을 ★질의점 바로 위★ 에 두고, 같은 시장 원형은 멀리 둔다.
     거리만 보면 무조건 가까운 쪽이 뽑힌다. 칸막이가 서 있으면 먼 쪽이 뽑혀야 한다. */
  const vec = (pairs) => { const a = new Array(D).fill(0); pairs.forEach(([j, v]) => { a[j] = v; }); return a; };
  const probe = {
    mean: new Array(D).fill(0), std: new Array(D).fill(1), mktIdx: [I_US, I_KR, I_CM],
    protos: [{ c: vec([[SIG, 3.0]]), p: 0.90, n: 100, m: 0 },     // 같은 시장(US) · 멀다
             { c: vec([[SIG, 0.0]]), p: 0.10, n: 100, m: 1 }]     // 다른 시장(KR) · 질의점 위
  };
  const qUS = vec([[I_US, 1], [SIG, 0.0]]);
  const pUS = M.memoScore(probe, qUS);
  chk(pUS != null && Math.abs(pUS - 0.90) < 1e-9,
    `US 질의가 붙어 있는 KR 원형을 무시하고 먼 US 원형을 골랐다(p=${pUS})`,
    `★US 질의가 KR 원형을 골랐다(p=${pUS}) — 칸막이가 안 선다★`);
  const qKR = vec([[I_KR, 1], [SIG, 3.0]]);
  const pKR = M.memoScore(probe, qKR);
  chk(pKR != null && Math.abs(pKR - 0.10) < 1e-9,
    `KR 질의도 대칭으로 자기 시장 원형만 본다(p=${pKR})`,
    `★KR 질의가 US 원형을 골랐다(p=${pKR})★`);
  // 자기 시장 책이 아예 없으면 멈추면 안 된다 — 모듬책 → 전체 순으로 물러선다.
  const qCM = vec([[I_CM, 1], [SIG, 0.0]]);
  chk(M.memoScore(probe, qCM) != null,
    "자기 시장 책이 없는 질의도 채점된다(모듬책 → 전체 폴백) — 침묵하지 않는다",
    "★책이 없는 시장 질의가 null 을 낸다 — 그 시장은 MEMO 가 통째로 빠진다★");
  // 실제 학습 모델에서도 교차선택이 0 이어야 한다(원형 128개 전수).
  let cross = 0, tried = 0;
  for (let k = 0; k < A.model.protos.length; k++) {
    const p = A.model.protos[k];
    if (p.m !== 0 && p.m !== 1) continue;
    // 원형 자리를 원 공간으로 되돌려 질의로 삼는다(scale·std 역변환).
    const q = new Array(D);
    for (let j = 0; j < D; j++) {
      const sc = A.model.scale[j] || 0;
      const z = sc > 0 ? p.c[j] / sc : 0;
      q[j] = z * (A.model.std[j] || 1) + A.model.mean[j];
    }
    q[I_US] = p.m === 0 ? 1 : 0; q[I_KR] = p.m === 1 ? 1 : 0; q[I_CM] = 0;
    const got = M.memoScore(A.model, q);
    tried++;
    // 같은 시장 원형만으로 만들어진 값이어야 한다 — 전 원형 중 다른 시장이 이겼는지 직접 본다.
    const same = A.model.protos.filter(x => x.m === p.m);
    const lo = Math.min(...same.map(x => x.p)), hi = Math.max(...same.map(x => x.p));
    if (!(got >= lo - 1e-9 && got <= hi + 1e-9)) cross++;
  }
  chk(cross === 0, `학습 모델 전수 ${tried}건 재질의 — 교차시장 선택 0건`,
    `★교차시장 선택 ${cross}/${tried}건★`);
}

console.log("\n③ 구 모델(시장표 없음)이 종전대로 채점되는가 — 전진검증 경로");
{
  const legacy = Object.assign({}, A.model);
  delete legacy.mktIdx;
  legacy.protos = A.model.protos.map(p => { const q = Object.assign({}, p); delete q.m; return q; });
  const v = JSON.parse(rowsPart[0].feat);
  chk(M.memoScore(legacy, v) != null,
    "mktIdx 도 m 도 없는 구 모델이 예외 없이 채점된다(어제 모델을 오늘 채점한다)",
    "★구 모델 채점이 깨진다 — 전진검증이 통째로 멈춘다★");
}

console.log("\n④ 해상도를 몰래 늘리지 않았는가 — 총 원형 수·표본당 원형");
{
  const tot = A.model.protos.length;
  const per = A.model.n / tot;
  console.log(`       총 원형 ${tot} (K ${M.MEMOML.K}) · 표본/원형 ${per.toFixed(1)} · 학습표본 ${A.model.n}`);
  chk(tot <= M.MEMOML.K + 4,
    `총 원형 ${tot} ≤ K ${M.MEMOML.K}(+여유) — 책을 나눴을 뿐 개수를 안 늘렸다`,
    `★총 원형 ${tot} 이 K ${M.MEMOML.K} 를 크게 넘는다 — 칸막이에 해상도 증설이 섞였다★`);
  chk(/Math\.round\(MEMOML\.K \* n \/ ntr\)/.test(S),
    "K 를 책 크기에 비례 배분한다(표본/원형 비·수축 세기가 종전과 같다)",
    "K 배분이 비례가 아니다");
  chk(/bm \+ \(wr - bm\) \* sh/.test(S),
    "수축 목표가 ★그 시장의 기저★ 다 — 한국 기저로 미국 원형을 당기지 않는다",
    "수축이 아직 전체 기저를 쓴다");
  chk(M.MEMOML.K === 128 && M.MEMOML.neighbors === 8 && M.MEMOML.icFloor === 0.012
      && M.MEMOML.minTrainSamples === 4000,
    "K·이웃·icFloor·최소표본 전부 그대로(문턱 완화 없음)", "★MEMO 상수가 바뀌었다★");
}

console.log("\n⑤ 이득 — 시장마다 예측 가능성이 다를 때 혼합책과 직접 비교");
const B = await train(rowsMix);
{
  chk(!!(B.model && B.model.protos && B.model.protos.length >= 8),
    `혼합책 대조군 학습 완료 — 원형 ${B.model ? B.model.protos.length : 0}개`, "대조군 학습 실패: " + B.msg);
  // 홀드아웃(마지막 20%, 시간순 뒤쪽)을 두 모델에 ★같은 피처★ 로 물린다.
  const chrono = rowsPart.slice().reverse();
  const nval = Math.max(200, Math.floor(N * 0.2));
  const hold = chrono.slice(N - nval);
  const score = (m) => {
    const p = [], y = [], pm = [[], []], ym = [[], []];
    for (const r of hold) {
      const v = JSON.parse(r.feat);
      const s = M.memoScore(m, v);
      if (s == null) continue;
      const lab = r.pnl_pct > 0 ? 1 : 0;
      const mk = v[I_US] > 0.5 ? 0 : 1;
      p.push(s); y.push(lab); pm[mk].push(s); ym[mk].push(lab);
    }
    const accOf = (ps, ys) => ps.reduce((a, s, i) => a + ((s >= 0.5 ? 1 : 0) === ys[i] ? 1 : 0), 0) / Math.max(1, ps.length);
    return { ic: pearson(p, y), n: p.length, acc: accOf(p, y),
             accUS: accOf(pm[0], ym[0]), accKR: accOf(pm[1], ym[1]),
             icUS: pearson(pm[0], ym[0]), icKR: pearson(pm[1], ym[1]),
             sdUS: sd(pm[0]), sdKR: sd(pm[1]) };
  };
  const a = score(A.model), b = score(B.model);
  console.log(`       칸막이  IC ${a.ic.toFixed(4)} · 정확도 ${(a.acc * 100).toFixed(1)}%  (US ${a.icUS.toFixed(3)} / KR ${a.icKR.toFixed(3)})`);
  console.log(`       혼합책  IC ${b.ic.toFixed(4)} · 정확도 ${(b.acc * 100).toFixed(1)}%  (US ${b.icUS.toFixed(3)} / KR ${b.icKR.toFixed(3)})`);
  console.log(`       예측 산포 — 칸막이 US ${a.sdUS.toFixed(4)} KR ${a.sdKR.toFixed(4)} · 혼합책 US ${b.sdUS.toFixed(4)} KR ${b.sdKR.toFixed(4)}`);
  chk(a.ic > b.ic * 1.15,
    `칸막이가 혼합책을 이긴다 (IC ${b.ic.toFixed(4)} → ${a.ic.toFixed(4)}, ${((a.ic / Math.max(b.ic, 1e-9) - 1) * 100).toFixed(0)}%↑)`,
    `★칸막이가 이득이 없다 (IC ${b.ic.toFixed(4)} → ${a.ic.toFixed(4)}) — 이 변경의 근거가 없다★`);
  /* ★전체 정확도로는 이 개선을 못 잰다.★ 칸막이 모델은 설명 못 하는 시장에서 0.5 근처를
     내놓는데, 0.5 문턱 정확도는 그 '의견 없음' 을 동전던지기로 세어 버린다 —
     맞게 기권한 것과 틀리게 찍은 것이 같은 점수를 받는다. 그래서 ★설명 가능한 시장에서의
     정확도★ 를 본다(위원회 게이트가 보는 값도 정확도가 아니라 블록IC·t 다). */
  console.log(`       시장별 정확도 — 칸막이 US ${(a.accUS * 100).toFixed(1)}% KR ${(a.accKR * 100).toFixed(1)}% · 혼합책 US ${(b.accUS * 100).toFixed(1)}% KR ${(b.accKR * 100).toFixed(1)}%`);
  chk(a.accUS >= b.accUS - 0.005,
    `설명 가능한 시장(US) 정확도가 안 깎였다 (${(b.accUS * 100).toFixed(1)}% → ${(a.accUS * 100).toFixed(1)}%)`,
    `★US 정확도가 떨어졌다 (${(b.accUS * 100).toFixed(1)}% → ${(a.accUS * 100).toFixed(1)}%)★`);
  chk(a.icUS > b.icUS,
    `US 구간 IC 도 올라간다 (${b.icUS.toFixed(3)} → ${a.icUS.toFixed(3)}) — 한국 표본에 희석되지 않는다`,
    `US 구간 IC 가 안 올랐다 (${b.icUS.toFixed(3)} → ${a.icUS.toFixed(3)})`);
  /* ★핵심 손해의 모양★ — 혼합책은 "미국에서 배운 엣지" 를 한국 종목에 그대로 바른다.
     한국은 이 축으로 설명이 안 되는데도 예측이 크게 흔들린다(산포가 크다).
     칸막이는 그 시장에 대해 ★의견 없음★ 을 말할 수 있어야 한다. */
  chk(a.sdKR < b.sdKR,
    `칸막이는 설명 못 하는 시장에서 조용해진다(KR 예측 산포 ${b.sdKR.toFixed(4)} → ${a.sdKR.toFixed(4)})`,
    `★칸막이를 세워도 한국에 미국 엣지를 그대로 바른다(KR 산포 ${b.sdKR.toFixed(4)} → ${a.sdKR.toFixed(4)})★`);
}

console.log("\n⑥ 비용 — 시장이 무의미할 때 칸막이가 까먹는 몫(정직하게 적는다)");
{
  const rowsN = [], rowsNm = [];
  for (let i = 0; i < 7000; i++) {
    const f = new Array(D);
    for (let j = 0; j < D; j++) f[j] = gauss();
    f[I_US] = 0; f[I_KR] = 0; f[I_CM] = 0;
    f[(i % 2 === 0) ? I_US : I_KR] = 1;
    const pnl = 1.2 * f[SIG] + 1.0 * gauss();      // 두 시장이 ★같은★ 규칙을 따른다
    const base = { id: i + 1, ts: T0 + i * DAY, label: pnl > 0 ? 1 : 0, pnl_pct: +pnl.toFixed(4) };
    rowsN.push(Object.assign({ feat: JSON.stringify(f) }, base));
    const g = f.slice(); g[I_US] = 0; g[I_KR] = 0;
    rowsNm.push(Object.assign({ feat: JSON.stringify(g) }, base));
  }
  rowsN.reverse(); rowsNm.reverse();
  const P = await train(rowsN), Q = await train(rowsNm);
  const chrono = rowsN.slice().reverse(), hold = chrono.slice(7000 - 1400);
  const ic = (m) => { const p = [], y = [];
    for (const r of hold) { const v = JSON.parse(r.feat); const s = M.memoScore(m, v);
      if (s != null) { p.push(s); y.push(r.pnl_pct > 0 ? 1 : 0); } }
    return pearson(p, y); };
  chk(!!(P.model && Q.model), "두 대조군 모두 학습됐다", "대조군 학습 실패: " + P.msg + " / " + Q.msg);
  const ia = P.model ? ic(P.model) : 0, ib = Q.model ? ic(Q.model) : 0;
  console.log(`       시장 무관 데이터 — 칸막이 IC ${ia.toFixed(4)} · 혼합책 IC ${ib.toFixed(4)} (차 ${((ia - ib) * 100).toFixed(2)}%p)`);
  chk(ia > ib * 0.9,
    `시장이 무의미해도 손해가 10% 안이다 (${ib.toFixed(4)} → ${ia.toFixed(4)}) — 최악의 경우가 감당 가능하다`,
    `★시장이 무의미할 때 손해가 크다 (${ib.toFixed(4)} → ${ia.toFixed(4)})★`);
}

console.log("\n⑦ 근거가 코드에 남아 있는가");
{
  chk(/관련도 가중은 예측변수에 쓰는 것이지 분할변수에 쓰는 것이 아니다/.test(S),
    "왜 시장만 다르게 다루는지가 코드에 적혀 있다(예측변수 vs 분할변수)", "근거가 코드에 없다");
  chk(/시장책\[/.test(S), "시장책 구성이 야간 로그에 남는다 — 다음에 추측으로 안 답한다", "로그에 시장책이 없다");
}

console.log(fails === 0 ? "\n✓ MEMO 시장 칸막이 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
