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
  const mk = () => ({ canvas: { width: 300, height: 100 }, createRadialGradient: () => grad, fillRect: nop, clearRect: nop, beginPath: nop, moveTo: nop, lineTo: nop, arc: nop, rect: nop, closePath: nop,
    fillText: nop, drawImage: nop, setTransform: nop, stroke: () => calls.stroke++, fill: () => calls.fill++, getContext: null });
  const ctx = mk(), small = { width: 300, height: 100, getContext: () => mk() };
  const r = NO.drawCore(ctx, sc, { yaw: .4, pitch: .3, zoom: 1, panX: 0, panY: 0, selected: 5, motion: true, spin: true, glow: true, small }, 1200, 400, 1.3);
  chk(r.lines === sc.la.length && calls.stroke <= 45 && calls.fill <= 20,
    "선 " + r.lines + "개를 획 " + calls.stroke + "번 · 채움 " + calls.fill + "번에(단계별로 묶어)", "★선마다 긋는다(획 " + calls.stroke + " · 채움 " + calls.fill + ")★");
  /* [V33.448] ★배율을 잃은 캔버스에서도 바르게★ — 아이폰 사파리 캡처: 그림이 왼쪽 위 2/3 에만, 나머지엔 옛 장면.
     캔버스 크기가 바뀌면 사파리가 배율(1.5)을 풀어 1배로 그렸고, 지우기도 1배 영역만 했다.
     배율이 풀린(단위 행렬) 가짜 캔버스(1.5배 크기)를 주고: 캔버스 전체를 지우는가 · 그리기 전에 1.5배를 다시 거는가. */
  {
    const T = { k: 1 }, clears = [], strokeK = [];
    const rc = Object.assign(mk(), { canvas: { width: 1800, height: 600 }, setTransform: (a) => { T.k = a; },
      clearRect: (x, y, w, h) => clears.push(w * T.k >= 1800 && h * T.k >= 600), stroke: () => strokeK.push(T.k) });
    NO.drawCore(rc, sc, { yaw: .4, pitch: .3, zoom: 1, panX: 0, panY: 0, selected: -1, motion: false, spin: false, glow: false, small: null }, 1200, 400, 0);
    chk(clears.some(Boolean) && strokeK.length && strokeK.every((k) => Math.abs(k - 1.5) < 1e-9),
      "배율이 풀린 캔버스도 전체를 지우고 1.5배로 다시 건다(왼쪽 위 2/3 결함 없음)",
      "★배율이 풀리면 일부만 지우거나 1배로 그린다(clear " + clears.join(",") + " · 배율 " + [...new Set(strokeK)].join(",") + ")★");
    const wm = src.slice(src.indexOf("function omWorkerMain("), src.indexOf("function mountCore("));
    chk(/if\(cv\.width!==cw\)cv\.width=cw/.test(wm) && /cost\*2\.5/.test(wm),
      "워커: 같은 크기면 캔버스를 다시 잡지 않는다 · 그리기 시간의 2.5배를 쉰다(느린 기기)",
      "★워커가 같은 크기에도 캔버스를 다시 잡거나 느린 기기에서 쉬지 않는다★");
    const mc = src.slice(src.indexOf("function mountCore("), src.indexOf("  let active=null;") > 0 ? src.length : src.length);
    chk(/addEventListener\('scroll',onScroll,\{capture:true,passive:true\}\)/.test(mc) && /removeEventListener\('scroll',onScroll,true\)/.test(mc) && /!scrolling/.test(mc),
      "페이지를 굴리는 동안은 그리지 않는다(스크롤에 양보 · 정리 때 떼어 냄)", "★스크롤 중에도 그린다(아이폰 끊김)★");
    // [V33.457] 아이폰·아이패드: 그리기 스레드 없이 정지 화면(끌 때만 밝은 선 · 손 떼면 한 번) — "OMNI 열고 스크롤하면 완전히 멈춘다"
    chk(/const IOS=config\.worker!==true&&/.test(mc) && /if\(!config\.noWorker&&!IOS&&typeof Worker/.test(mc) && /if\(IOS\)\{canvas\.dataset\.ios='1';v\.slow=true;\}/.test(mc),
      "아이폰·아이패드는 그리기 스레드를 띄우지 않고 정지 화면으로 시작(움직일 땐 밝은 선만)", "★아이폰에서 워커 OffscreenCanvas 로 계속 그린다(스크롤 멈춤 보고)★");
    // [V33.448] "옛날 디자인으로 보인다": ① 구조 응답(아이폰 5초)을 기다리는 동안 성긴 대표 연결 그림 ② 쉬었다 온 긴 간격 때문에 번짐·흐린 선을 끔
    chk(/localStorage\.getItem\(ck\)/.test(mc) && /function keep\(txt\)/.test(mc) && /stT=setTimeout\(\(\)=>start\(null\),10000\)/.test(mc) && /if\(st0\)start\(st0\)/.test(mc),
      "구조는 브라우저에 보관해 다음부터 바로 전부 · 처음엔 받을 때까지 기다린다(성긴 대체 그림을 먼저 띄우지 않는다)", "★구조를 받기 전에 대표 연결 그림을 띄운다★");
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    chk(/NeuralObservatory\.mount\(_ph,\{kind:'omni',data:d,cacheKey:_ovKey,expectAt:\(d\.importedAt\|\|d\.trainedAt\|\|null\)\}\)/.test(html)
        && /const atOk=j=>/.test(mc) && /if\(same\)keep\(txt\)/.test(mc),
      "화면이 학습 판 열쇠(cacheKey)와 판(expectAt)을 넘기고, 판이 다른 구조는 보관하지 않는다", "★판 대조 없이 구조를 보관한다 — 재학습 뒤 옛 구조가 남는다★");
    chk(/const OMNI_ST_STALE_MS = 7 \* 24 \* 3600000/.test(wsrc) && /age < OMNI_ST_STALE_MS/.test(wsrc),
      "구조 사본은 7일까지 먼저 주고 뒤에서 판 확인(첫 방문 9.5초 없앰)", "★구조 사본 창이 짧다 — 첫 방문이 D1 판 확인을 기다린다★");
    chk((wm.match(/iv<250/g) || []).length === 1 && (mc.match(/iv<250/g) || []).length === 1,
      "느림 판정에서 쉬었다 온 간격(>0.25초)은 뺀다(워커 · 대체 경로)", "★스크롤 멈춤·화면 밖 간격이 느림 판정에 섞인다★");
  }
  /* [V33.438] ★맑게(아크릴)★ — 사용자: "뿌연 느낌 말고 맑으면서 반투명하게". 뿌옇던 원인 둘을 다시 못 들이게:
     화면 전체를 덮는 광채(fillRect 0,0,W,H) 금지 · 번짐은 반 해상도(w/2) · 세기 ≤ .35. 아크릴 띠·유리 껍질이 있다. */
  const dc = src.slice(src.indexOf("function drawCore("), src.indexOf("function mountCore("));
  const ga = /ctx\.globalAlpha=([\d.]+);ctx\.drawImage\(sm/.exec(dc);
  chk(!/fillRect\(0,0,W,H\)/.test(dc) && /Math\.round\(w\/2\)/.test(src) && ga && +ga[1] <= .35 && /아크릴 띠/.test(dc) && /sc\.shells/.test(dc),
    "맑은 아크릴: 전면 광채 없음 · 번짐 반 해상도 · 세기 " + (ga ? ga[1] : "?") + " ≤ .35 · 아크릴 띠·유리 껍질", "★다시 뿌옇게 그린다★");
  /* [V33.439] ★사이트가 멈추지 않는다★ — 사용자: "OMNI 뇌 구조를 보면 사이트가 계속 멈춘다".
     그리기는 별도 스레드(OffscreenCanvas → Worker) · 워커 소스가 실제로 번역된다 · 대체 경로는 정지 화면으로 시작 ·
     움직이는 동안 흐린 단계 생략(lod) · 다시 그릴 때 감시 타이머를 거둔다. */
  const mc = src.slice(src.indexOf("function mountCore("), src.indexOf("  let active=null;"));
  /* 워커는 ★이 파일 자체★(같은 출처)로 — blob: 은 사이트 CSP(script-src 'self')가 막아 캔버스를 넘긴 뒤 빈칸이 된다.
     워커 안에서 읽히면 그리기 루프를 스스로 켠다 · 실패하거나 5초 안에 첫 장면이 없으면 새 캔버스로 메인 스레드 정지 화면. */
  const wsrc2 = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const csp = (/"script-src ([^"]*)"/.exec(wsrc2) || [])[1] || "";
  chk(/new Worker\(config\.workerUrl\|\|OM_SELF\)/.test(mc) && !/createObjectURL|new Blob\(/.test(src) && !/blob:/.test(csp.replace(/;.*$/, "")) &&
      /self instanceof WorkerGlobalScope\)omWorkerMain\(\)/.test(src) && /transferControlToOffscreen\(\)/.test(mc),
    "그리기는 별도 스레드 — 워커 = 이 파일(같은 출처 · CSP script-src 'self' 로 허용) · 워커 안에서 스스로 시작", "★메인 스레드에서 그리거나 CSP 가 막는 워커다★");
  chk(/function toMain\(why\)/.test(mc) && /canvas\.cloneNode\(false\)/.test(mc) && /wk\.onerror=\(\)=>toMain\('error'\)/.test(mc) && /toMain\('timeout'\)/.test(mc),
    "워커가 죽거나 5초 안에 첫 장면이 없으면 → 새 캔버스 · 메인 스레드 정지 화면", "★워커 실패 때 빈칸으로 남는다★");
  /* [V33.440] 운영 실측(ui-probe): 그림이 화면 밖이면 워커가 절전으로 안 그리는데, '5초 안에 첫 장면' 을 실패로 보고
     멀쩡한 워커를 끄고 메인 스레드로 떨어졌다(workerFail=timeout) — 그게 '멈춤 · 디자인과 다름' 이었다.
     → 워커는 init 을 받자마자 ready 를 보내고, 감시는 ready 만 기다린다. */
  chk(/sc=omniCore\(d,m\.st\|\|null\);postMessage\(\{type:'ready'\}\)/.test(src) && /if\(!alive\)toMain\('timeout'\)/.test(mc) && !/firstFrame/.test(mc),
    "워커 감시는 '살아 있다(ready)' 만 본다 — 화면 밖 절전을 실패로 보지 않는다", "★화면 밖이면 멀쩡한 워커를 끈다★");
  /* 실제 규모(신경망 111→128→64→5 · 나무 993)에서 하얗게 타지 않는다 — 총 노출(투명도×선분)이 시험 모델의 1.8배 이내 */
  { let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const gs = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / 1.2; };
    const mat = (r, c, k) => _omQ8(Array.from({ length: r }, () => Array.from({ length: c }, () => gs() * k * (rnd() < .1 ? 3 : 1))));
    const bigTrees = []; for (let t = 0; t < 993; t++) { const ns = 8 + Math.floor(rnd() * 12), row = [ns + 1, Math.round((.5 + rnd()) * 1e3)]; for (let q = 0; q < ns; q++) row.push(Math.floor(rnd() * TM.feats.length * .8)); bigTrees.push(row); }
    const big = Object.assign({}, st, { net: Object.assign({}, st.net, { sizes: [names.length, 128, 64, 5], mats: [mat(names.length, 128, .1), mat(128, 64, .12), mat(64, 5, .2)] }), trees: bigTrees });
    const expo = (scn) => { let segs = 0, e = 0; const c = mk(); c.beginPath = () => { segs = 0; }; c.lineTo = () => { segs++; };
      c.stroke = function () { const a = +(/,([\d.]+)\)$/.exec(this.strokeStyle || "") || [0, 0])[1]; e += a * segs; };
      NO.drawCore(c, scn, { yaw: .4, pitch: .3, zoom: 1, panX: 0, panY: 0, selected: -1, motion: false, spin: false, glow: false, small: null }, 1200, 400, 0); return e; };
    const scB = NO.omniCore(d, big), e0 = expo(sc), e1 = expo(scB);
    // 1200×400 화면 기준 절대 상한 2300(V33.440 실측 1953 · 하얗게 타던 V33.439 설정은 이 값을 크게 넘었다)
    chk(e1 <= 2300, "실제 규모(선 " + scB.la.length + "개) 총 노출 " + e1.toFixed(0) + " ≤ 2300 — 하얗게 타지 않는다(작은 모델 " + e0.toFixed(0) + ")",
      "★실제 규모에서 하얗게 탄다(" + e1.toFixed(0) + ")★");
    const c3 = mk(); const lodN = NO.drawCore(c3, scB, { yaw: .4, pitch: .3, zoom: 1, panX: 0, panY: 0, selected: -1, motion: false, spin: false, glow: false, small: null, lod: true }, 1200, 400, 0).drawn;
    chk(lodN <= 5000, "움직이는 중(lod)엔 모델 크기와 무관하게 ≤ 5,000줄 (실제 규모 " + lodN + ")", "★끄는 동안 선이 너무 많다(" + lodN + ")★"); }
  /* [V33.444] "OMNI 열면 사이트가 터진다" — 캔버스·스레드를 다시 그릴 때마다 새로 만들고 안 돌려줬다(아이폰 사파리 캔버스 메모리 한도).
     정리 때 캔버스 크기 0 · 워커 dispose → self.close · 크기 변화 모아서 · 보조 캔버스 재사용 · 메인은 선 없이 · 같은 판이면 그림 재사용. */
  { const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    chk(/type:'dispose'/.test(mc) && /m\.type==='dispose'/.test(src) && /self\.close\(\)/.test(src) && /canvas\.width=0;canvas\.height=0;/.test(mc) && /v\.small\.width=0/.test(mc),
      "그림을 치울 때 캔버스 메모리를 돌려주고(크기 0) 워커가 스스로 닫는다", "★버린 캔버스·스레드가 쌓인다★");
    chk(/rzT=setTimeout\(applySize,150\)/.test(mc) && /Math\.abs\(nw-rw\)<2/.test(mc) && /if\(v\.small\)\{if\(v\.small\.width!==sw\)/.test(src),
      "크기 변화는 모아서 한 번 · 2px 미만 무시 · 보조 캔버스 재사용", "★주소창이 들락날락할 때마다 캔버스를 다시 잡는다★");
    chk(/omniCore\(d,st,\{noLines:!!wk\}\)/.test(mc) && /type:'count'/.test(mc), "워커가 그리면 메인 스레드는 선 없이(개수는 워커가 센다)", "★메인이 선 3.7만 개를 다시 만든다★");
    chk(/_keep\.__omniLive && window\.__omniVolKey===_ovKey/.test(html) && /_ph\.replaceWith\(_keep\)/.test(html),
      "같은 학습 판이면 살아 있는 그림을 옮겨 붙인다(다시 만들지 않는다)", "★다시 렌더할 때마다 그림을 새로 만든다★");
    const scN = NO.omniCore(d, st, { noLines: true });
    chk(scN.n === sc.n && scN.la.length === 0 && sc.top.length > 0, "선 없는 장면도 점 번호가 같다(선택이 워커와 맞는다) · 흐르는 빛 선은 장면이 만든다", "★점 번호가 어긋난다★"); }
  chk(/let still=!wk;/.test(mc) && /motion:!reduced\.matches&&!still,spin:!reduced\.matches&&!still/.test(mc),
    "워커를 못 쓰면 정지 화면으로 시작(자동회전·흐르는 빛 끔)", "★대체 경로가 계속 그린다★");
  chk(/clearInterval\(gc\)/.test(mc) && /wk\.terminate\(\)/.test(mc), "다시 그릴 때 워커·감시 타이머를 거둔다", "★스레드·타이머가 쌓인다★");
  { const calls2 = { stroke: 0, fill: 0 }; const c2 = mk(); c2.stroke = () => calls2.stroke++;
    const full = NO.drawCore(c2, sc, { yaw: .4, pitch: .3, zoom: 1, panX: 0, panY: 0, selected: -1, motion: false, spin: false, glow: false, small: null }, 1200, 400, 0).drawn;
    const lod = NO.drawCore(c2, sc, { yaw: .4, pitch: .3, zoom: 1, panX: 0, panY: 0, selected: -1, motion: false, spin: false, glow: false, small: null, lod: true }, 1200, 400, 0).drawn;
    chk(full === sc.la.length && lod < full * .6, "멈춰 있으면 선 " + full + "개 전부 · 움직이는 중(lod)엔 " + lod + "개", "★lod 가 안 줄인다(" + lod + "/" + full + ")★"); }
  chk(!/자비스|JARVIS|Jarvis|울트론|Ultron|어벤저스|Avengers|이그드라실|Yggdrasil/.test(src),
    "영화·신화 이름을 소스·화면에 쓰지 않는다(형태만 빌린다)", "★고유 이름이 들어가 있다★");
  /* [V33.441] 구조 탭 응답이 느렸다(운영 10.0초 = 모델 요약 D1 9.3초) — R2 사본(1분 그대로 · 10분까지 먼저 주고 뒤에서 갱신) ·
     화면 '새로고침' 만 fresh=1 로 건너뛴다. 구조 전부도 R2 에 줄인 결과를 둔다. */
  { const h = wsrc.slice(wsrc.indexOf('if (path === "/api/nn-viz") {'), wsrc.indexOf('if (path === "/api/whatif")'));
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    chk(/const NNVIZ_CACHE = \{ freshMs: 60000, staleMs: 6 \* 3600000 \}/.test(wsrc) && /_R2v\.get\(_vKey\)/.test(h) && /ctx\.waitUntil\(_nnVizBuild\(\)/.test(h) && /get\("fresh"\) !== "1"/.test(h)
        && /refreshOnly===1\?'&fresh=1':''/.test(html) && /omni\/v" \+ OMNI_VER \+ "\/structure\.json"/.test(wsrc),
      "구조 탭 응답 R2 사본(1분·10분 SWR) · 새로고침만 fresh=1 · 구조 전부 R2 캐시", "★구조 탭 응답이 매번 D1 을 다시 읽는다★"); }
  /* [V33.443] 공통 SWR(swrJson)의 L2 가 caches.default 뿐이었다 — workers.dev 에선 저장이 안 된다(운영: /api/ai-mode 15초 초과로 끊김).
     R2 를 L2b 로(빌드 버전은 메타데이터로 확인). */
  chk(/R2c\.put\(rKey, str, \{ customMetadata: \{ at: String\(ts\), ver: _BUILD_VER \} \}\)/.test(wsrc) && /const g = await R2c\.get\(rKey\)/.test(wsrc) && /const same = md\.ver === _BUILD_VER;/.test(wsrc) && /if \(!same \|\| rAge > freshMs\)/.test(wsrc),
    "공통 SWR 의 공유 저장소가 R2 에도 있다(workers.dev 에서 동작)", "★공통 SWR 이 workers.dev 에서 공유 저장소 없이 D1 을 다시 친다★");
  chk(/path === "\/api\/omni-structure"/.test(wsrc) && /async function omniStructure\(DB, touch\)/.test(wsrc) && /omniStructure\(env\.DB, true\)/.test(wsrc) && /_omStructMemo\.key === key/.test(wsrc),
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
