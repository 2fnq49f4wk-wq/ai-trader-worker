/* ═══════════════════════════════════════════════════════════════════════════
   [V33.428] ★OMNI-NN — 워커 신경망이 학습기 신경망과 같은가★

   학습기(omni.py)는 한 몸통 · 다섯 머리 신경망을 numpy 로 배우고, 기준 채점기
   nn_score_row(double) 로 고정물(tools/fixtures/omni-nn.json)을 만든다. 워커는 그 식을
   JS 로 옮겼다(omniNnScore). 둘이 조용히 갈리면 섀도우 채점이 ★다른 모델★ 을 재게 된다.

     ① 고정물의 모든 행(장타 행 = 장중 칸 결측 포함)에서 워커 로짓 = 기준 로짓 (≤ 1e-12)
     ② 섞기: α=0 인 지평은 나무 그대로(신경망을 계산조차 안 한다) · α>0 은 (1−α)·나무 + α·신경망
     ③ 검증기: 모양이 틀린 신경망 · 범위 밖 α 는 모델째 거절 (대조: 멀쩡한 본문은 통과)
     ④ 배선: 업로드 검증 · 섀도우 채점이 ★같은 섞기 함수★ 를 쓴다(한쪽만 나무로 채점하면 안 된다)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const FX = JSON.parse(readFileSync(new URL("./fixtures/omni-nn.json", import.meta.url), "utf8"));
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 워커 순전파 = 학습기 기준 채점기");
{
  chk(FX.feats.join("|") === [...M.OMNI_FEATS, ...M.OMNI_HORIZONS.map((h) => "hz_" + h), ...M.OMNI_SETUPS.map((s) => "st_" + s)].join("|"),
    "고정물 칸 명세 = 워커 칸 명세 (" + FX.feats.length + "칸)", "★고정물이 다른 칸 명세로 만들어졌다 — 다시 만들 것★");
  let md = 0, nan = 0;
  for (let i = 0; i < FX.rows.length; i++) {
    const z = M.omniNnScore(FX.nn, FX.rows[i], FX.hz[i]);
    const d = Math.abs(z - FX.z[i]);
    if (!(d <= md)) md = d;
    if (FX.rows[i].some((v) => v === null)) nan++;
  }
  chk(md <= 1e-12 && FX.rows.length >= 200, "행 " + FX.rows.length + "(결측 포함 " + nan + ") 최대차 " + md.toExponential(1),
    "★워커 신경망이 학습기와 다르다 — 최대차 " + md + "★");
  chk(nan >= 50, "결측 행 " + nan + " — 결측표시 입력 경로를 실제로 탄다", "★결측 행이 " + nan + "뿐 — 결측표시 경로를 안 본다★");
  const hzs = new Set(FX.hz);
  chk(hzs.size === M.OMNI_HORIZONS.length, "다섯 머리 전부 검사(" + [...hzs].sort().join(",") + ")", "★검사하지 않은 머리가 있다★");
  /* 대조 — 머리를 바꾸면 값이 달라야 한다(머리 선택이 실제로 작동한다) */
  let diff = 0;
  for (let i = 0; i < 20; i++) if (M.omniNnScore(FX.nn, FX.rows[i], (FX.hz[i] + 1) % 5) !== FX.z[i]) diff++;
  chk(diff >= 18, "대조: 다른 머리로 채점하면 값이 바뀐다(" + diff + "/20)", "★머리 번호가 무시된다★");
}

console.log("\n② 섞기 — 지평별 α");
{
  const trees = [{ w: 0.25 }];
  const x = FX.rows[0], hz = FX.hz[0];
  const zn = M.omniNnScore(FX.nn, x, hz);
  const a0 = [0, 0, 0, 0, 0], a1 = [0, 0, 0, 0, 0];
  a1[hz] = 0.3;
  chk(M.omniBlendRaw({ trees, nn: FX.nn, alpha: a0 }, x, hz) === 0.25, "α=0 → 나무 그대로", "★α=0 인데 신경망이 섞였다★");
  chk(M.omniBlendRaw({ trees, nn: FX.nn, alpha: a1 }, x, hz) === (1 - 0.3) * 0.25 + 0.3 * zn,
    "α=0.3 → (1−α)·나무 + α·신경망 (학습기와 같은 식)", "★섞는 식이 학습기와 다르다★");
  chk(M.omniBlendRaw({ trees, nn: null, alpha: null }, x, hz) === 0.25, "신경망 없는 옛 모델 → 나무 그대로", "★옛 모델 채점이 깨졌다★");
}

console.log("\n③ 검증기 — 틀린 신경망은 모델째 거절");
{
  const D = FX.feats.length;
  const ok = M.omniNnValidate(FX.nn, [0, 0.5, 1, 0, 0], D);
  chk(ok === null, "멀쩡한 신경망 · α 통과", "★멀쩡한 본문을 거절했다: " + ok + "★");
  const cl = () => JSON.parse(JSON.stringify(FX.nn));
  const cases = [
    ["α 가 5개가 아니다", cl(), [0.5]],
    ["α 가 1 을 넘는다", cl(), [0, 0, 1.5, 0, 0]],
    ["입력 칸 번호가 범위 밖", Object.assign(cl(), { cols: [...FX.nn.cols.slice(0, -1), D + 3] }), [0, 0, 0, 0, 0]],
    ["척도 0", (() => { const n = cl(); n.sc[0] = 0; return n; })(), [0, 0, 0, 0, 0]],
    ["첫 층 행 수 ≠ 입력 수", (() => { const n = cl(); n.nets[0].W[0].pop(); return n; })(), [0, 0, 0, 0, 0]],
    ["가중치에 NaN", (() => { const n = cl(); n.nets[0].W[1][0][0] = NaN; return n; })(), [0, 0, 0, 0, 0]],
    ["머리 열 수 ≠ 5", (() => { const n = cl(); n.nets[0].Wh = n.nets[0].Wh.map((r) => r.slice(0, 4)); return n; })(), [0, 0, 0, 0, 0]],
    ["결측표시 칸이 범위 밖", Object.assign(cl(), { flags: [9999] }), [0, 0, 0, 0, 0]],
  ];
  for (const [nm, nn, al] of cases) {
    const e = M.omniNnValidate(nn, al, D);
    chk(typeof e === "string" && e.length > 0, "거절: " + nm + " (" + e + ")", "★통과시켰다: " + nm + "★");
  }
}

console.log("\n④ 배선 — 업로드 검증과 섀도우 채점이 같은 식을 쓴다");
{
  const fn = (name) => { const i = S.indexOf("function " + name + "("); return i < 0 ? "" : S.slice(i, S.indexOf("\n}\n", i)); };
  const v = fn("omniValidate"), sh = fn("omniShadowScore");
  chk(/omniBlendRaw\(M, pr\.x, hz\)/.test(v) && /omniNnValidate\(body\.nn, body\.alpha, D\)/.test(v),
    "업로드 검증: 신경망 모양 검사 + probe 를 섞인 식으로 재현", "★업로드 검증이 신경망을 안 본다 — 섞인 probe 를 나무로 재현하면 전부 거절된다★");
  chk(/omniBlendRaw\(M, omniDesign\(/.test(sh) && !/omniScoreRaw\(trees, omniDesign/.test(sh),
    "섀도우 채점: 섞인 식으로 채점(나무만 채점하는 옛 줄 없음)", "★섀도우 채점이 검증한 모델과 다른 식으로 잰다★");
  const imp = S.slice(S.indexOf('path === "/api/omni-import"'), S.indexOf('path === "/api/omni-status"'));
  chk(/nn: undefined/.test(imp) && /delete meta\.nn/.test(imp), "신경망 가중치는 메타(D1)에 안 싣는다 — R2 모델 파일에만",
    "★신경망 가중치가 D1 메타로 들어간다(행 크기 한도)★");
}

console.log("\n⑤ 신경망 보고서는 작게 — 가중치가 섞여 와도 메타(D1)가 부풀지 않는다");
{
  const big = { edgeB: { auc: 0.51 }, export: FX.nn, zHold: new Array(5000).fill(0.1), grid: [{ valAuc: 0.52 }] };
  const r = M._omNnRepSlim(big);
  chk(r && r.edgeB && r.grid && !("export" in r) && !("zHold" in r), "모르는 칸(가중치·홀드아웃 로짓)은 버리고 아는 칸만 남긴다",
    "★가중치가 메타로 샌다★");
  const huge = { grid: new Array(4000).fill({ valAuc: 0.5, cfg: { name: "x".repeat(20) } }) };
  chk(M._omNnRepSlim(huge) === null, "60KB 를 넘으면 통째로 버린다(없다고 말한다)", "★큰 보고서가 그대로 들어간다★");
  chk(M._omNnRepSlim(null) === null && M._omNnRepSlim([1]) === null, "빈 값·배열은 null", "★형식 검사 없음★");
}

console.log("\n⑥ 전진 교차검증 표 — 작게 · 숫자만");
{
  const c = M._omCvSlim({ pick: "G3", folds: 3, cuts: [1, 2, 3], junk: "x".repeat(5000),
    table: [{ name: "G0", why: "지금 구성", folds: [0.51, NaN, 0.52], mean: 0.515, extra: [1, 2, 3] },
            { name: "G3", why: "w".repeat(500), folds: [0.52, 0.53, 0.54], mean: 0.53, wins: 3 }] });
  chk(c && c.pick === "G3" && c.table.length === 2 && c.table[0].folds[1] === null && !("extra" in c.table[0]) &&
      c.table[1].why.length === 80 && !("junk" in c), "모르는 칸 버림 · NaN → null · 설명 80자", "★교차검증 표가 걸러지지 않는다★");
  chk(M._omCvSlim(null) === null && M._omCvSlim({ table: "x" }) === null, "형식이 아니면 null", "★형식 검사 없음★");
}

console.log("\n⑦ 홀로그램 구체 핵 — 껍질 순서 · 실제 연결 한 줄씩 · 지어낸 세기 없음 · 평소엔 가장 센 한 줄 · 구면 호");
{
  const src = readFileSync(new URL("../public/neural-observatory.js", import.meta.url), "utf8");
  const G = {}; new Function("globalThis", "window", src)(G, G);
  const NO = G.NeuralObservatory;
  const names = FX.nn.cols.map((c) => FX.feats[c]).concat(FX.nn.flags.map((j) => "결측:" + FX.feats[FX.nn.cols[j]]));
  const L = (n, sz) => ({ name: n, size: sz, strength: Array.from({ length: sz }, (_, i) => (i % 7) / 7) });
  const E0 = [], E1 = [], E2 = [];
  for (let k = 0; k < 64; k++) for (let q = 0; q < 3; q++) E0.push([(k * 7 + q * 13) % names.length, k, 0.2 + 0.1 * q, 1]);
  for (let k = 0; k < 32; k++) for (let q = 0; q < 3; q++) E1.push([(k * 5 + q * 11) % 64, k, 0.3, 1]);
  for (let k = 0; k < 5; k++) for (let q = 0; q < 6; q++) E2.push([(k * 3 + q * 5) % 32, k, 0.5, -1]);
  const nnViz = { layers: [Object.assign(L("입력", names.length), { names }), L("몸통 1", 64), L("몸통 2", 32),
                           { name: "지평 머리", size: 5, names: M.OMNI_HORIZONS, strength: [0.01, null, 0.02, 0.0, 0.03] }],
                  edges: [E0, E1, E2] };
  const d = { horizons: M.OMNI_HORIZONS, feats: M.OMNI_FEATS, nTrees: 73, seeds: 4, alpha: [0, 0, 0.5, 0, 0], nnViz,
              groups: [{ name: "일봉(장타)", share: 0.3 }, { name: "5분봉(단타)", share: 0.2 }],
              heads: M.OMNI_HORIZONS.map((h) => ({ hz: h, auc: 0.51 })) };
  const rad = (n) => Math.hypot(n.x, n.y, n.z);
  const mean = (a) => a.reduce((p, q) => p + q, 0) / Math.max(1, a.length);
  for (const [tag, dd] of [["신경망 있음", d], ["신경망 없음(옛 모델)", Object.assign({}, d, { nnViz: null, alpha: null })]]) {
    const sc = NO.omniScene(dd, { spread: 1 });
    const vis = sc.nodes.filter((n) => !n.hidden);
    const inputs = vis.filter((n) => n.kind === "input");
    const want = dd.nnViz ? names.length : M.OMNI_FEATS.length;
    chk(inputs.length === want, tag + ": 입력 " + inputs.length + "칸 전부 바깥 껍질에", "★입력이 빠졌다(" + inputs.length + "/" + want + ")★");
    const dangling = sc.edges.filter((e) => !sc.nodes[e.a] || !sc.nodes[e.b]).length;
    const nonfinite = sc.nodes.filter((n) => ![n.x, n.y, n.z].every(Number.isFinite)).length;
    const badV = sc.edges.filter((e) => !(e.v >= 0 && e.v <= 1)).length;
    chk(dangling === 0 && nonfinite === 0 && badV === 0, tag + ": 떠 있는 선 0 · 좌표 유한 · 선 세기 0~1",
      "★떠 있는 선 " + dangling + " · 비유한 " + nonfinite + " · 범위 밖 " + badV + "★");
    const invented = sc.nodes.filter((n) => (/나무 숲/.test(n.name) || n.hidden) && n.v != null).length +
                     (dd.nnViz ? 0 : inputs.filter((n) => n.v != null).length);
    chk(invented === 0, tag + ": 값 없는 점(고리 눈금 · 안내선 · 신경망 없는 입력)은 밝히지 않는다", "★지어낸 세기 " + invented + "★");
    chk(vis.filter((n) => /^위성 · .* 최종 확률$/.test(n.name)).length === 5, tag + ": 위성(지평별 최종 확률) 5개", "★위성 수가 틀렸다★");
    if (dd.nnViz) {
      const byLabel = (re) => mean(vis.filter((n) => re.test(n.label)).map(rad));
      const rIn = mean(inputs.map(rad)), r1 = byLabel(/^몸통 1$/), r2 = byLabel(/^몸통 2$/), r0 = byLabel(/^핵$/);
      chk(rIn > r1 && r1 > r2 && r2 > r0, "껍질 순서: 입력 " + rIn.toFixed(0) + " > 몸통1 " + r1.toFixed(0) + " > 몸통2 " + r2.toFixed(0) + " > 핵 " + r0.toFixed(0),
        "★껍질 순서가 틀렸다★");
      /* [V33.435] 평소엔 뉴런마다 가장 센 한 줄(핵으로 드는 선은 전부) · 나머지는 점을 누르면(detail).
         ★실제 연결은 하나도 빠지지 않는다★(전부 선으로 있다) · 합친 선 없음. */
      const all = sc.edges.filter((e) => e.strand && !/위성/.test(sc.nodes[e.b].name));
      const lines = all.filter((e) => !e.detail);
      const nnLines = nnViz.edges.reduce((a, es) => a + es.length, 0);
      const wantMain = nnViz.edges.slice(0, -1).reduce((a, es) => a + new Set(es.map((x) => x[1])).size, 0) + nnViz.edges[nnViz.edges.length - 1].length;
      chk(all.length === nnLines && !sc.edges.some((e) => e.bundle || e.ribbon), "실제 연결 " + nnLines + "개가 전부 한 줄씩 있다(합친 선 없음)",
        "★연결 수가 다르다(" + all.length + "/" + nnLines + ")★");
      chk(lines.length === wantMain, "평소 보이는 선 " + lines.length + "개 = 뉴런마다 가장 센 한 줄 + 핵으로 드는 선(나머지는 누르면)",
        "★평소 선 수가 틀렸다(" + lines.length + "/" + wantMain + ")★");
      /* 질서: 호는 구 한가운데를 가로지르지 않는다 — 경유점의 반지름이 두 끝 반지름 사이에 있다 */
      const cut = all.filter((e) => (e.path || []).slice(1, -1).some((id) => { const r = rad(sc.nodes[id]), ra = rad(sc.nodes[e.a]), rb = rad(sc.nodes[e.b]);
        return r < Math.min(ra, rb) - 1e-6 || r > Math.max(ra, rb) + 1e-6; })).length;
      chk(all.every((e) => Array.isArray(e.path) && e.path.length >= 3) && cut === 0, "실제 연결은 구면을 따라 휘는 호(구를 직선으로 가로지르지 않는다)",
        "★직선이거나 구 안쪽을 가로지르는 선 " + cut + "★");
      /* 무게중심 배치가 선을 짧게 만드는가 — 입력→몸통1 선의 평균 각도 차가 무작위 배치(≈90°)보다 한참 작아야 */
      const ang = (a, b) => { const u = [a.x, a.y, a.z], w = [b.x, b.y, b.z]; const d0 = u.reduce((p, x, k) => p + x * w[k], 0) / (rad(a) * rad(b)); return Math.acos(Math.max(-1, Math.min(1, d0))) * 180 / Math.PI; };
      const l0 = lines.filter((e) => sc.nodes[e.a].kind === "input");
      const mA = mean(l0.map((e) => ang(sc.nodes[e.a], sc.nodes[e.b])));
      chk(mA < 15, "평소 보이는 입력→몸통1 선 평균 각도 " + mA.toFixed(1) + "° — 가장 센 입력 바로 안쪽이라 바큇살처럼 짧다(무작위 ≈90°)",
        "★선이 구를 가로지른다(" + mA.toFixed(1) + "°)★");
    }
  }
  const eng = src.slice(src.indexOf("function draw("), src.indexOf("function tick("));
  const lw = /e\.strand\?\(focus\?([\d.]+):([\d.]+)\+([\d.]+)\*e\.v\)/.exec(eng);
  chk(lw && +lw[1] <= 1.5 && (+lw[2] + +lw[3]) <= 1.3 && /if\(n\.hidden\)continue;/.test(eng),
    "선이 가늘다(≤" + (lw ? (+lw[2] + +lw[3]).toFixed(2) : "?") + "px) · 숨은 점은 안 그린다", "★선이 굵거나 숨은 점을 그린다★");
  chk(!/자비스|JARVIS|Jarvis|울트론|Ultron|어벤저스|Avengers|이그드라실|Yggdrasil/.test(src),
    "영화·신화 이름을 소스·화면에 쓰지 않는다(형태만 빌린다)", "★고유 이름이 들어가 있다★");
  const sc = NO.omniScene(d, { spread: 1 });
  const nullHead = sc.nodes.find((n) => n.name === "핵 · 60분 머리");
  chk(nullHead && nullHead.v === null, "홀드아웃을 못 잰 머리는 흐리게(v=null)", "★못 잰 머리에 세기를 지어냈다★");
}

console.log("\n⑧ 섀도우 표시 — OMNI(섀도우)를 '판 불일치' 로 적지 않는다");
{
  /* [V33.435] 사용자 화면: 판도 맞고 학습도 된 OMNI 가 '모델 판 불일치' 로 떴다. 서버 rosterCls 는 state "shadow" 를
     내는데 화면의 글자 함수들이 shadow 를 몰라 맨 끝 갈래('판 불일치')로 떨어졌다. 세 곳 모두 shadow 갈래가 있어야 한다. */
  const ev = readFileSync(new URL("../public/model-evidence.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const tt = ev.slice(ev.indexOf("function tierText("), ev.indexOf("window.renderModelEvidence"));
  chk(/st==='shadow'/.test(tt) && tt.indexOf("st==='shadow'") < tt.lastIndexOf("return '모델 판 불일치'"),
    "모델 카드: shadow 갈래가 '모델 판 불일치' 보다 먼저", "★모델 카드가 섀도우를 판 불일치로 적는다★");
  const tag = html.slice(html.indexOf("    tag: function(key){"), html.indexOf("    chipCls: function(key)"));
  chk(/st === 'shadow'/.test(tag), "명부 글자(LUXR.tag): shadow 갈래 있음", "★LUXR.tag 가 섀도우를 판 불일치로 적는다★");
  chk(/shadow:'◌'/.test(html) && /shadow:'섀도우 — /.test(html), "명부 불·설명(GLYPH·COLOR·TXT)에 shadow 있음", "★명부 불에 shadow 가 없다★");
  const cm = html.slice(html.indexOf("var CMCLS"), html.indexOf("var CMCLS") + 1500);
  chk(/stt === 'shadow'/.test(cm), "위원 목록 글자: shadow 갈래 있음", "★위원 목록이 섀도우를 판 불일치로 적는다★");
}

console.log(fails ? "\n✗ OMNI-NN 검사 실패 " + fails : "\n✓ OMNI-NN 검사 통과");
process.exit(fails ? 1 : 0);
