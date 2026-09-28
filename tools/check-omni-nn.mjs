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

console.log("\n⑦ 홀로그램 핵(V33.437 새 엔진) — 가중치·분기 전부 · 밝기 = 실제 |w| · 장식은 값 없음 · 색 하나 · 묶어 긋기");
{
  const src = readFileSync(new URL("../public/neural-observatory.js", import.meta.url), "utf8");
  const wsrc = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const G = {}; new Function("globalThis", "window", src)(G, G);
  const NO = G.NeuralObservatory;
  const grab = (s, name) => { const i = s.indexOf("function " + name + "("); let dd = 0; for (let k = s.indexOf("{", i); k < s.length; k++) { if (s[k] === "{") dd++; else if (s[k] === "}") { dd--; if (!dd) return s.slice(i, k + 1); } } return ""; };
  const g8 = globalThis.btoa ? {} : { btoa: (b) => Buffer.from(b, "binary").toString("base64") };
  const _omQ8 = new Function("btoa", grab(wsrc, "_omQ8") + "; return _omQ8;")(globalThis.btoa || g8.btoa);
  const _omTreeSummary = new Function(grab(wsrc, "_omTreeSummary") + "; return _omTreeSummary;")();
  const TM = JSON.parse(readFileSync(new URL("./fixtures/omni-model.json", import.meta.url), "utf8"));
  const nn = FX.nn, n0 = nn.nets[0], F = FX.feats;
  const names = nn.cols.map((c) => F[c]).concat(nn.flags.map((j) => "결측:" + F[nn.cols[j]]));
  const mats = n0.W.map(_omQ8).concat([_omQ8(n0.Wh)]);
  const trees = TM.trees.map(_omTreeSummary);
  const st = { ok: true, v: 3, feats: TM.feats, horizons: M.OMNI_HORIZONS, seeds: 4,
               net: { names, cols: nn.cols, sizes: [names.length].concat(n0.b.map((b) => b.length), [n0.bh.length]), mats, nets: nn.nets.length }, trees };
  const d = { horizons: M.OMNI_HORIZONS, feats: M.OMNI_FEATS, seeds: 4, heads: M.OMNI_HORIZONS.map((h) => ({ hz: h, auc: 0.51 })),
              nnViz: { layers: [{ name: "입력", size: names.length, names }, { name: "몸통 1", size: 64 }, { name: "몸통 2", size: 32 },
                                { name: "지평 머리", size: 5, strength: [0.01, null, 0.02, 0, 0.03] }],
                       edges: [[[0, 0, 0.5, 1], [1, 1, 0.3, -1]], [[0, 0, 0.4, 1]], [[0, 0, 0.9, 1], [1, 2, 0.2, 1]]] } };
  const sc = NO.omniCore(d, st);
  const cnt = (k) => sc.lk.reduce((a, x) => a + (x === k ? 1 : 0), 0);
  const params = mats.reduce((a, m) => a + m.r * m.c, 0), splits = trees.reduce((a, t) => a + t.length - 2, 0);
  chk(cnt(0) + cnt(1) + cnt(2) === params, "신경망 가중치 " + params + "개가 전부 한 줄씩 있다", "★가중치 선 " + (cnt(0) + cnt(1) + cnt(2)) + "/" + params + "★");
  chk(cnt(3) === splits, "나무 " + trees.length + "그루의 분기 " + splits + "개가 전부 그 입력까지 한 줄씩", "★분기 선 " + cnt(3) + "/" + splits + "★");
  const kc = (k) => sc.kind.reduce((a, x) => a + (x === k ? 1 : 0), 0);
  chk(kc(1) === 64 && kc(2) === 32 && kc(3) === 5 && kc(4) === trees.length && kc(0) >= names.length,
    "뉴런 전부: 입력 " + kc(0) + " · 몸통1 " + kc(1) + " · 몸통2 " + kc(2) + " · 머리 " + kc(3) + " · 나무 " + kc(4), "★뉴런 수가 틀렸다★");
  // 밝기 = 실제 |w| / 최대(첫 행렬 몇 칸을 원본과 대조 — int8 반올림 오차 ≤ 1/127)
  const W0 = n0.W[0]; let mx = 0; for (const row of W0) for (const x of row) mx = Math.max(mx, Math.abs(x));
  let worst = 0; const c0 = mats[0].c;
  for (let j = 0; j < Math.min(500, cnt(0)); j += 37) { const i = Math.floor(j / c0), k = j % c0; worst = Math.max(worst, Math.abs(sc.ls[j] - Math.abs(W0[i][k]) / mx)); }
  chk(worst <= 1 / 127 + 1e-6, "선 밝기 = 실제 |w|/최대 (최대 오차 " + worst.toFixed(4) + " ≤ 1/127)", "★선 밝기가 가중치와 다르다(" + worst + ")★");
  const bad = Array.from(sc.ls).filter((x) => !(x >= 0 && x <= 1)).length + Array.from(sc.la).concat(Array.from(sc.lb)).filter((i) => !(i >= 0 && i < sc.n)).length;
  chk(bad === 0, "선 세기 0~1 · 떠 있는 선 0", "★범위 밖 · 떠 있는 선 " + bad + "★");
  const decoV = sc.val.filter((x, i) => sc.kind[i] >= 5 && x === x).length;
  chk(decoV === 0, "장식(고리·홍채·빛줄기)과 분기 눈금은 값이 없다(NaN)", "★장식에 값을 지어냈다(" + decoV + ")★");
  chk(Number.isNaN(sc.val[sc.groups.find((g) => g.kind === 3).ids[1]]), "홀드아웃을 못 잰 머리는 값 없음(흐리게)", "★못 잰 머리에 값을 지어냈다★");
  // 구조를 못 받았을 때: 대표 연결(nnViz)만 · 분기선 없음 · 그 사실을 info 가 말한다
  const sf = NO.omniCore(d, null);
  chk(sf.lk.length >= 5 && !sf.info.full && sf.lk.filter((k) => k <= 2).length === 5 && !sf.lk.some((k) => k === 3),
    "구조를 못 받으면 대표 연결 5줄만(분기선 없음 · full=false)", "★대체 그림이 틀렸다★");
  // 색 하나 — 새 엔진 구간의 모든 색은 GOLD 하나에서
  const core = src.slice(src.indexOf("═══ [V33.437]"), src.indexOf("  let active=null;"));
  const colors = core.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+|#[0-9a-fA-F]{3,6}\b/g) || [];
  chk((core.match(/const GOLD='[\d,]+'/g) || []).length === 1 && colors.length === 0,
    "색은 금빛 하나(GOLD) — 다른 색 리터럴 0", "★색이 여럿이다: " + colors.join(" ") + "★");
  chk(/kind==='omni'\) return mountCore/.test(src) && !/omniScene/.test(src), "OMNI 는 새 엔진으로만(옛 구체 코드 없음)", "★옛 구체 코드가 남아 있다★");
  // 묶어 긋기 — 선이 1.8만 개여도 획 호출은 수십 번
  const calls = { stroke: 0, fill: 0 };
  const nop = () => {}, grad = { addColorStop: nop };
  const mk = () => ({ canvas: { width: 300, height: 100 }, createRadialGradient: () => grad, fillRect: nop, clearRect: nop, beginPath: nop, moveTo: nop, lineTo: nop, arc: nop, rect: nop,
    fillText: nop, drawImage: nop, setTransform: nop, stroke: () => calls.stroke++, fill: () => calls.fill++, getContext: null });
  const ctx = mk(), small = { width: 300, height: 100, getContext: () => mk() };
  const r = NO.drawCore(ctx, sc, { yaw: .4, pitch: .3, zoom: 1, panX: 0, panY: 0, selected: 5, motion: true, spin: true, glow: true, small }, 1200, 400, 1.3);
  chk(r.lines === sc.la.length && calls.stroke <= 45 && calls.fill <= 20,
    "선 " + r.lines + "개를 획 " + calls.stroke + "번 · 채움 " + calls.fill + "번에(단계별로 묶어)", "★선마다 긋는다(획 " + calls.stroke + " · 채움 " + calls.fill + ")★");
  chk(!/자비스|JARVIS|Jarvis|울트론|Ultron|어벤저스|Avengers|이그드라실|Yggdrasil/.test(src),
    "영화·신화 이름을 소스·화면에 쓰지 않는다(형태만 빌린다)", "★고유 이름이 들어가 있다★");
  chk(/path === "\/api\/omni-structure"/.test(wsrc) && /async function omniStructure\(DB\)/.test(wsrc) && /_omStructMemo\.key === key/.test(wsrc),
    "워커: 구조 전부 경로(/api/omni-structure) · 판이 같으면 메모리에서", "★구조 경로가 없다★");
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
