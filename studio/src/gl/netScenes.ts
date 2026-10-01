/* Every model's network as one GPU line scene, in the same format NeuralObservatory.omniCore
 * returns for OMNI, so the one WebGL engine draws all eleven.
 *
 * Only measured values set brightness: tree split counts, MIND stacking weights, DUAL coefficients
 * and blend shares, MEMO prototype marks, SEQ projection weights / activations / attention.
 * Where the response does not say which exact node a line lands on (which tree a split sits in),
 * the line count is real and the placement is spread evenly — the caption says so. */

type Lbl = { id: number; text: string; from?: number };
export type NetScene = {
  n: number; P: Float32Array; kind: Uint8Array; val: Float32Array; name: string[];
  ring: Int16Array; ang: Float32Array; rings: any[];
  la: Int32Array; lb: Int32Array; ls: Float32Array; lk: Uint8Array; hi: Uint8Array; top: number[];
  groups: { label: string; kind: number; ids: number[] }[]; labels: Lbl[];
  shells: number[]; core: boolean; colorByAttr: true; alpha: [number, number, number]; yaw: number; zoom: number;
  tbody: []; bands: []; hz: [];
  info: { head: string; note: string; lines: number };
};

const fin = (v: any): v is number => typeof v === "number" && Number.isFinite(v);

function make() {
  const X: number[] = [], K: number[] = [], V: number[] = [], NM: string[] = [], C: number[] = [];
  const LA: number[] = [], LB: number[] = [], LS: number[] = [], LK: number[] = [];
  const groups: NetScene["groups"] = [], labels: Lbl[] = [];
  /* c = colour position on the dawn ramp: 0 = rose core (decision) … 1 = sky (raw inputs) */
  const pt = (x: number, y: number, z: number, k: number, v: number | null, nm: string, c: number) => { X.push(x, y, z); K.push(k); V.push(fin(v) ? v : NaN); NM.push(nm); C.push(c); return K.length - 1; };
  const ln = (a: number, b: number, s: number, k: number) => { if (!(s > 0)) return; LA.push(a); LB.push(b); LS.push(Math.min(1, s)); LK.push(k); };
  /* one layer = a sunflower disk of neurons facing the next layer (layers run along x) */
  const disk = (n: number, x: number, k: number, c: number, nm: (i: number) => string, v: (i: number) => number | null, rMax = 165) => {
    const ids: number[] = [], R = n <= 1 ? 0 : Math.min(rMax, 17 * Math.sqrt(n));
    for (let i = 0; i < n; i++) { const r = n <= 1 ? 0 : R * Math.sqrt((i + .5) / n), a = i * 2.39996323; ids.push(pt(x, Math.cos(a) * r, Math.sin(a) * r, k, v(i), nm(i), c)); }
    return ids;
  };
  function done(info: Omit<NetScene["info"], "lines">, opt: { shells?: number[]; core?: boolean; alpha?: [number, number, number]; yaw?: number; zoom?: number } = {}): NetScene {
    /* skeleton: for every neuron its strongest incoming 2 and outgoing 2 lines drawn crisp once more */
    const HI = new Uint8Array(LA.length), best = new Map<string, number[]>();
    const keep = (key: string, j: number, k: number) => { let a = best.get(key); if (!a) { a = []; best.set(key, a); }
      if (a.length < k) { a.push(j); return; } let lo = 0; for (let q = 1; q < a.length; q++) if (LS[a[q]] < LS[a[lo]]) lo = q; if (LS[j] > LS[a[lo]]) a[lo] = j; };
    for (let j = 0; j < LA.length; j++) { if (LK[j] > 2) continue; keep("b" + LB[j], j, 2); keep("a" + LA[j], j, 2); }
    for (const a of best.values()) for (const j of a) if (LS[j] > .25) HI[j] = 1;
    const idx: number[] = []; for (let j = 0; j < LA.length; j++) if (LK[j] <= 2) idx.push(j);
    idx.sort((a, b) => LS[b] - LS[a]);
    const n = K.length;
    return {
      n, P: new Float32Array(X), kind: Uint8Array.from(K), val: Float32Array.from(V), name: NM,
      ring: new Int16Array(n).fill(-1), ang: Float32Array.from(C), rings: [],
      la: Int32Array.from(LA), lb: Int32Array.from(LB), ls: Float32Array.from(LS), lk: Uint8Array.from(LK), hi: HI, top: idx.slice(0, 90),
      groups, labels, shells: opt.shells ?? [], core: opt.core ?? false, colorByAttr: true, alpha: opt.alpha ?? [.05, .9, 1.15], yaw: opt.yaw ?? .5, zoom: opt.zoom ?? 1.3,
      tbody: [], bands: [], hz: [], info: { ...info, lines: LA.length },
    };
  }
  /* label a layer at its highest neuron on screen (screen y grows downward) */
  const tag = (ids: number[], text: string) => { if (!ids.length) return; let b = ids[0]; for (const i of ids) if (X[i * 3 + 1] < X[b * 3 + 1]) b = i; labels.push({ id: b, text }); };
  return { pt, ln, disk, done, tag, groups, labels };
}

const norm = (a: number[]) => { let m = 0; for (const v of a) if (fin(v) && Math.abs(v) > m) m = Math.abs(v); return a.map((v) => (fin(v) && m > 0 ? Math.abs(v) / m : 0)); };
const featList = (d: any) => { const f = (d.inputFeatures && d.inputFeatures.length ? d.inputFeatures : d.topFeatures) || []; return f.filter((x: any) => x && x.name); };
const LX = (l: number, n: number) => (l - (n - 1) / 2) * Math.min(250, 620 / Math.max(1, n - 1));
const fname = (f: any) => f.name + (f.role ? " — " + f.role : "");

/* Boosted trees: inputs → trees → sum → probability. One line per real split. */
function trees(d: any) {
  const S = make(), F = featList(d), nT = Math.max(1, +d.nTrees || 1);
  const sv = norm(F.map((f: any) => f.strength || 0));
  const inp = S.disk(F.length, LX(0, 3), 0, 1, (i) => fname(F[i]), (i) => sv[i]);
  const tr = S.disk(nT, LX(1, 3), 1, .45, (i) => "나무 #" + (i + 1), () => null);
  const out = S.pt(LX(2, 3), 0, 0, 3, null, "승률 σ(Σ 나무)", 0);
  let cum = 0, total = 0;
  F.forEach((f: any, i: number) => { const k = Math.max(0, Math.round(f.splits || 0)); total += k;
    for (let q = 0; q < k; q++) S.ln(inp[i], tr[(cum + q) % nT], .25 + .75 * sv[i], 0); cum += k; });
  tr.forEach((t) => S.ln(t, out, .6, 2));
  S.groups.push({ label: "입력", kind: 0, ids: inp }, { label: "나무", kind: 1, ids: tr }, { label: "출력", kind: 3, ids: [out] });
  S.tag(inp, "입력 " + F.length); S.tag(tr, "나무 " + nT); S.labels.push({ id: out, text: "승률" });
  return S.done({ head: `입력 ${F.length} → 나무 ${nT} → 승률`, note: `선 하나 = 분기 하나(실제 ${total.toLocaleString("ko-KR")}개) · 밝기 = 입력 영향력 · 어느 나무에 붙는지는 고르게 배치` });
}

/* MIND: inputs → three experts → stacking weights → probability. */
function mind(d: any) {
  const S = make(), F = featList(d), E: any[] = d.experts || [];
  const sv = norm(F.map((f: any) => f.strength || 0)), ew = norm(E.map((e: any) => e.weight));
  const inp = S.disk(F.length, LX(0, 3), 0, 1, (i) => fname(F[i]), (i) => sv[i]);
  const ex: number[] = E.map((e: any, k: number) => S.pt(LX(1, 3), (k - (E.length - 1) / 2) * 90, 0, 1, e.weight, e.name + " · 결합 가중 " + (+e.weight).toFixed(3), .4));
  const out = S.pt(LX(2, 3), 0, 0, 3, null, "MIND 최종 확률(스태킹)", 0);
  inp.forEach((a, i) => ex.forEach((b) => S.ln(a, b, .15 + .85 * sv[i], 0)));
  ex.forEach((e, k) => S.ln(e, out, .2 + .8 * ew[k], 2));
  S.groups.push({ label: "입력", kind: 0, ids: inp }, { label: "전문가", kind: 1, ids: ex }, { label: "출력", kind: 3, ids: [out] });
  E.forEach((e: any, k: number) => S.labels.push({ id: ex[k], text: String(e.name).split("(")[0].trim(), from: out }));
  S.tag(inp, "입력 " + F.length); S.labels.push({ id: out, text: "확률" });
  return S.done({ head: `입력 ${F.length} → 전문가 ${E.length} → 스태킹`, note: "입력 선 밝기 = 입력 영향력 · 안쪽 선 밝기 = 스태킹 가중 |w|" });
}

/* DUAL: inputs → heads (linear · trees · MLP) → blend → the chosen head goes out. */
function dual(d: any) {
  const S = make(), F = featList(d), H: any[] = d.heads || [];
  const wv = norm(F.map((f: any) => f.w ?? 0));
  const inp = S.disk(F.length, LX(0, 4), 0, 1, (i) => fname(F[i]) + (fin(F[i].w) ? " · 계수 " + F[i].w.toFixed(3) : ""), (i) => F[i].w);
  const base = H.filter((h) => h.head !== "blend").length;
  let bi = 0;
  const hd = H.map((h) => { const nm = "머리 " + h.head + " · 정확도 " + (h.acc * 100).toFixed(1) + "% · IC 하한 " + h.icLB;
    return h.head === "blend" ? S.pt(LX(2, 4), 0, 0, 2, h.icLB, nm, .25) : S.pt(LX(1, 4), (bi++ - (base - 1) / 2) * 95, 0, 1, h.icLB, nm, .5); });
  const out = S.pt(LX(3, 4), 0, 0, 3, null, "최종 확률 — 고른 머리 " + String(d.head || "").toUpperCase(), 0);
  const idx = (h: string) => H.findIndex((x) => x.head === h);
  const lin = idx("lin"), gb = idx("gbdt"), bl = idx("blend");
  if (lin >= 0) inp.forEach((a, i) => S.ln(a, hd[lin], wv[i], 0));
  const nl = d.nl && d.nl.gbdt && d.nl.gbdt.top;
  if (gb >= 0 && nl) { const sh = norm(nl.map((t: any) => t.share)); nl.forEach((t: any, k: number) => { const i = F.findIndex((f: any) => f.name === t.name); if (i >= 0) S.ln(inp[i], hd[gb], .2 + .8 * sh[k], 0); }); }
  if (bl >= 0 && Array.isArray(d.blendW)) { const sh = norm(d.blendW.map((b: any) => b.share)); d.blendW.forEach((b: any, k: number) => { const h = idx(b.head); if (h >= 0) S.ln(hd[h], hd[bl], .3 + .7 * sh[k], 1); }); }
  H.forEach((h, k) => S.ln(hd[k], out, h.win || h.head === d.head ? 1 : .14, h.win || h.head === d.head ? 2 : 3));
  S.groups.push({ label: "입력", kind: 0, ids: inp }, { label: "머리", kind: 1, ids: hd }, { label: "출력", kind: 3, ids: [out] });
  S.tag(inp, "입력 " + F.length); S.labels.push({ id: out, text: "확률" });
  const col = S.pt(LX(1, 4), 0, 0, 6, null, "", .5);
  H.forEach((h, k) => S.labels.push({ id: hd[k], text: (h.win || h.head === d.head ? "✓ " : "") + h.head.toUpperCase(), from: h.head === "blend" ? undefined : col }));
  return S.done({ head: `입력 ${F.length} → 머리 ${H.length} → 고른 머리 1`, note: "LIN 선 = 표준화 계수 |w| · GBDT 선 = 분기 gain 비중(상위) · BLEND 선 = 섞는 비중 · MLP 는 입력별 값을 내지 않는다" });
}

/* MEMO: inputs → 128 remembered situations (their z-marks) → probability by win rate edge. */
function memo(d: any) {
  const S = make(), names: string[] = d.featNames || [], Pr: any[] = d.protos || [], base = fin(d.baseRate) ? d.baseRate : .5;
  const inp = S.disk(names.length, LX(0, 3), 0, 1, (i) => names[i], () => null);
  const at = new Map(names.map((n, i) => [n, inp[i]]));
  const edge = norm(Pr.map((p) => (fin(p.winRate) ? p.winRate - base : 0)));
  const pr = S.disk(Pr.length, LX(1, 3), 1, .45, (i) => "원형 #" + Pr[i].i + " · 승률 " + (Pr[i].winRate * 100).toFixed(1) + "% · " + Pr[i].n + "행", (i) => Pr[i].winRate);
  const out = S.pt(LX(2, 3), 0, 0, 3, null, "MEMO 확률(가까운 원형의 승률)", 0);
  let zm = 0; Pr.forEach((p) => (p.marks || []).forEach((m: any) => { if (Math.abs(m.z) > zm) zm = Math.abs(m.z); }));
  Pr.forEach((p, k) => { (p.marks || []).forEach((m: any) => { const a = at.get(m.name); if (a != null) S.ln(a, pr[k], zm ? Math.abs(m.z) / zm : 0, 0); }); S.ln(pr[k], out, .1 + .9 * edge[k], 2); });
  S.groups.push({ label: "입력", kind: 0, ids: inp }, { label: "원형", kind: 1, ids: pr }, { label: "출력", kind: 3, ids: [out] });
  S.tag(inp, "입력 " + names.length); S.tag(pr, "원형 " + Pr.length); S.labels.push({ id: out, text: "확률" });
  return S.done({ head: `입력 ${names.length} → 원형 ${Pr.length} → 확률`, note: "바깥 선 = 원형을 특징짓는 입력(|z|) · 안쪽 선 밝기 = 기준 승률과의 차이" });
}

/* SEQ: time runs left→right; each layer is a tube. Lines inside a time step are the real input
   projection weights (top 3 per neuron) and residual links lit by this sample's activations;
   arcs above a tube are the measured attention between bars. */
function seq(d: any) {
  const S = make(), L = d.L || 16, dd = d.d || 32, nd = d.nodes || {}, blocks: any[] = nd.byBlock || [], names: string[] = d.featNames || [];
  const roles: any[] = d.nodeRoles || [], X0 = -270, DX = 520 / Math.max(1, L - 1);
  const stages: { label: string; vals: number[][] | null; n: number; c: number }[] = [
    { label: "입력", vals: d.vizSeq || null, n: names.length || d.D || 80, c: 1 },
    { label: "사영", vals: nd.proj || null, n: dd, c: .8 },
  ];
  blocks.forEach((b, i) => { stages.push({ label: "어텐션 " + (i + 1), vals: b.attn || null, n: dd, c: .62 - i * .24 }); stages.push({ label: "FFN " + (i + 1), vals: b.ffn || null, n: dd, c: .52 - i * .24 }); });
  const NS = stages.length, Y = (s: number) => 165 - s * (330 / Math.max(1, NS - 1));
  const mx = stages.map((st) => { let m = 0; (st.vals || []).forEach((r) => (r || []).forEach((v: number) => { if (fin(v) && Math.abs(v) > m) m = Math.abs(v); })); return m || 1; });
  const ids: number[][][] = stages.map((st, s) => {
    const R = s === 0 ? 30 : 20, per: number[][] = [];
    for (let t = 0; t < L; t++) { const row: number[] = [];
      for (let i = 0; i < st.n; i++) { const a = Math.PI * 2 * i / st.n + t * .19, v = st.vals && st.vals[t] ? st.vals[t][i] : null;
        row.push(S.pt(X0 + t * DX, Y(s) + Math.cos(a) * R, Math.sin(a) * R, Math.min(s, 2), v, (s === 0 ? (names[i] || "입력 #" + i) : st.label + " · #" + i) + " · t" + t + (fin(v) ? " · 값 " + v.toFixed(2) : ""), st.c)); }
      per.push(row); }
    S.groups.push({ label: st.label, kind: Math.min(s, 2), ids: per.flat() });
    return per;
  });
  const act = (s: number, t: number, i: number) => { const r = stages[s].vals && stages[s].vals![t]; const v = r ? r[i] : null; return fin(v) ? Math.abs(v) / mx[s] : .3; };
  let wm = 0; roles.forEach((r) => (r.top || []).forEach((q: any) => { if (Math.abs(q.w) > wm) wm = Math.abs(q.w); }));
  for (let t = 0; t < L; t++) {
    roles.forEach((r) => { const j = r.j; if (ids[1][t][j] == null) return;
      (r.top || []).forEach((q: any) => { const a = ids[0][t][q.i]; if (a != null) S.ln(a, ids[1][t][j], (wm ? Math.abs(q.w) / wm : .5) * (.35 + .65 * act(1, t, j)), 0); }); });
    for (let s = 1; s < NS - 1; s++) for (let j = 0; j < dd; j++) S.ln(ids[s][t][j], ids[s + 1][t][j], .15 + .85 * act(s + 1, t, j), 1);
  }
  const out = S.pt(X0 + (L - 1) * DX + 45, Y(NS - 1) - 55, 0, 3, d.attnP ?? null, "출력 — 마지막 봉에서 오를 확률", 0);
  const outW = norm(roles.map((r) => r.out ?? 0));
  roles.forEach((r, k) => { const a = ids[NS - 1][L - 1][r.j]; if (a != null) S.ln(a, out, .15 + .85 * outW[k], 2); });
  /* attention arcs: query bar t looks at key bar u (u ≤ t), brightness = weight / row max (heads averaged) */
  (d.attnByBlock || []).forEach((heads: any[], b: number) => {
    const s = 2 + b * 2; if (!ids[s]) return;
    for (let t = 0; t < L; t++) {
      const row = Array.from({ length: L }, (_, u) => { let a = 0, c = 0; heads.forEach((h) => { const v = h && h[t] && h[t][u]; if (fin(v)) { a += v; c++; } }); return c ? a / c : 0; });
      const m = Math.max(...row) || 1;
      for (let u = 0; u < L; u++) { if (u === t || row[u] <= 0) continue;
        const q = row[u] / m; if (q < .35) continue;
        const x0 = X0 + u * DX, x1 = X0 + t * DX, h = 26 + Math.abs(t - u) * 7, y0 = Y(s), SEG = 8;
        let prev = ids[s][u][0];
        for (let k = 1; k <= SEG; k++) { const f = k / SEG, id = k === SEG ? ids[s][t][0] : S.pt(x0 + (x1 - x0) * f, y0 - Math.sin(Math.PI * f) * h, Math.sin(Math.PI * f) * h * .5, 6, null, "", .2);
          S.ln(prev, id, q * q, 2); prev = id; }
      }
    }
  });
  stages.forEach((st, s) => S.labels.push({ id: ids[s][0][0], text: st.label }));
  S.labels.push({ id: out, text: "출력" });
  return S.done({ head: `봉 ${L} × (입력 ${stages[0].n} → 사영 ${dd} → 블록 ${blocks.length}) → 출력`, note: "왼쪽 → 오른쪽이 시간 · 위 곡선 = 실제 어텐션(행 최대의 35% 이상) · 층 사이 선 = 사영 가중 상위 3 + 이 표본의 활성값" },
    { alpha: [.02, .7, 1.6], yaw: .45, zoom: .95 });
}

/* Whole committee: each member → the combiner, lit by its live state (server roster). */
const SHORT: Record<string, string> = { xgb: "XGB", lgb: "LGB", cat: "CAT", dual_bull: "강세", dual_bear: "약세", dual: "이중헤드" };
function overview(d: any) {
  const S = make(), R: any[] = d.roster || [], lit: Record<string, number> = { on: 1, prov: .6, bad: .12, shadow: .1 };
  const nIn = Math.max(1, +d.inputDim || 80);
  const inp = S.disk(nIn, LX(0, 4), 0, 1, (i) => "공통 입력 #" + i, () => null);
  const mem = R.map((r, k) => { const a = Math.PI * 2 * k / R.length - Math.PI / 2;
    return S.pt(LX(1, 4), Math.sin(a) * 150, Math.cos(a) * 150, 1, lit[r.state] ?? .05, r.name + " · " + (r.why || r.state), .55); });
  const hub = S.pt(LX(1, 4), 0, 0, 6, null, "", .5);
  const comb = S.pt(LX(2, 4), 0, 0, 2, null, "IC 가중 결합 → 보정", .25), out = S.pt(LX(3, 4), 0, 0, 3, null, "최종 확률", 0);
  R.forEach((r, k) => {
    const s = lit[r.state] ?? .05;
    if (r.key !== "omni") inp.forEach((a, i) => { if (i % 2 === k % 2) S.ln(a, mem[k], s * .45, 0); });
    S.ln(mem[k], comb, s, s >= .6 ? 2 : 3);
  });
  S.ln(comb, out, 1, 2);
  S.tag(inp, "입력 " + nIn);
  R.forEach((r, k) => S.labels.push({ id: mem[k], text: SHORT[r.key] || String(r.key).toUpperCase(), from: hub }));
  S.labels.push({ id: comb, text: "결합" }, { id: out, text: "확률" });
  return S.done({ head: `입력 ${nIn} → 위원 ${R.length} → IC 가중 결합·보정 → 확률`, note: "선 밝기 = 위원의 지금 상태(정식 > 잠정 > 보류·섀도우) · 입력 선은 공통 입력 벡터를 절반씩 솎아 그림 · OMNI 는 자기 분봉 입력이라 따로" }, { yaw: .35, zoom: 1.1 });
}

export function buildNet(model: string, d: any): NetScene | null {
  if (!d) return null;
  try {
    if (model === "overview") return (d.roster || []).length ? overview(d) : null;
    if (!d.trained) return null;
    if (model === "mind") return (d.experts || []).length ? mind(d) : null;
    if (model === "memo") return (d.protos || []).length ? memo(d) : null;
    if (model === "seq") return d.nodes && d.nodes.proj ? seq(d) : null;
    if (model === "dualbull" || model === "dualbear") return (d.heads || []).length ? dual(d) : null;
    if (["gbdt", "xgb", "lgb", "cat"].includes(model)) return d.nTrees ? trees(d) : null;
  } catch (e) { return null; }
  return null;
}
