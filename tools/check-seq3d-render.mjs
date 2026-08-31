/* ═══════════════════════════════════════════════════════════════════════════
   [V33.287] SEQ 3D 를 ★실제로 그려 본다.★

   ■ 왜 이 검사가 필요한가
     V33.284 에서 축을 맞바꾸며(단계=깊이 / 시점=가로) 좌표 참조를 열두 곳 고쳤다.
     그런데 ★한 곳을 놓쳤다★ — 출력 단계의 `ST[3].x` 와 `pz`. 둘 다 그때 없앤 이름이라
     ReferenceError 가 나고 ★그림 전체가 안 그려졌다.★ 사용자가 "오류났다" 고 알려 줬다.

     기존 검사들은 전부 ★조각★ 만 봤다 — 사영 수학(check-seq3d), 조작 식(check-seq3d-touch),
     세기 식(check-viz-legibility). 조각은 다 멀쩡했는데 합쳐서 한 번 돌리는 검사가 없었다.
     그래서 "수식은 맞는데 화면이 비어 있는" 상태를 아무도 못 잡았다.

   ■ 이 검사가 하는 일
     화면 코드에서 렌더러 일체를 떼어 ★스텁 DOM 위에서 진짜로 한 장 그린다.★
     예외 없이 끝나는가 · 조각이 실제로 나오는가 · 다섯 단계와 시점 눈금이 다 들어갔는가 ·
     좌표에 NaN 이 없는가(있으면 브라우저는 조용히 아무것도 안 그린다).
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const HV = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
function grab(name) {
  const i = HV.indexOf("function " + name + "(");
  if (i < 0) return null;
  let dep = 0, st = -1;
  for (let j = i; j < HV.length; j++) {
    const c = HV[j];
    if (c === "{") { if (st < 0) st = j; dep++; }
    else if (c === "}") { dep--; if (dep === 0 && st >= 0) return HV.slice(i, j + 1); }
  }
  return null;
}
const NAMES = ["sq3Clamp", "sq3Proj", "sq3Quad", "sq3Esc", "sq3Stages", "sq3AttnOf", "sq3AttnRow", "sq3DrawPick", "sq3Draw"];
const parts = NAMES.map(grab);
chk(parts.every(Boolean), `렌더러 ${NAMES.length}개를 화면 코드에서 떼어 왔다`,
  `떼어오지 못한 함수가 있다: ${NAMES.filter((n, i) => !parts[i]).join(",")}`);
const src = parts.filter(Boolean).join("\n");

const L = 16, D = 75, dd = 32;
const grid = (r, c, f) => Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => f(i, j)));
const data = {
  kind: "seq", trained: true, L, d: dd, heads: 2, layers: 1, D, params: 56065,
  inputFeatures: Array.from({ length: D }, (_, i) => ({ name: "f" + i, role: "역할", strength: (i % 10) / 10 })),
  /* [V33.290] ★시점마다 다른 값★ 이어야 한다 — i 를 안 넣으면 16시점이 전부 같은 벡터라,
     '입력이 시점 축을 쓰는가' 를 물어도 아무것도 안 무는 검사가 된다(실제로 그랬다). */
  vizSeq: grid(L, D, (i, j) => ((i * 3 + j * 7) % 13) / 6 - 1),
  nodes: { proj: grid(L, dd, (i, j) => ((j * 5) % 11) / 5 - 1),
           byBlock: [{ attn: grid(L, dd, (i, j) => ((j * 3) % 7) / 3 - 1),
                       ffn: grid(L, dd, (i, j) => ((j * 9) % 17) / 8 - 1),
                       ffLive: Array.from({ length: L }, () => 20) }] },
  posStrength: Array.from({ length: L }, (_, i) => i / L),
  ffStrength: Array.from({ length: dd }, (_, i) => (i % 5) / 5),
  ffStrengthByBlock: [Array.from({ length: dd }, (_, i) => (i % 5) / 5)],
  attnByBlock: [[grid(L, L, () => 1 / L)]], ffHidden: 64, attnP: 0.53,
  trusted: true, w: 0.35, valAccLB: 0.5034
};
const mk = () => ({ innerHTML: "", style: {}, textContent: "", value: "",
  classList: { add() {}, remove() {}, toggle() {}, contains: () => true }, getAttribute: () => null,
  appendChild() {}, addEventListener() {}, querySelectorAll: () => [],
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 460 }) });
const els = { sq3Svg: mk(), sq3Pick: mk(), sq3Note: mk(), sq3Row: mk(), "page-nnviz": mk() };
globalThis.document = { getElementById: id => els[id] || mk(), querySelectorAll: () => [], createElement: mk };
globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};

function run(over) {
  els.sq3Svg.innerHTML = "";
  const SQ3 = Object.assign({
    yaw: -0.62, pitch: 0.30, spin: false, head: -1, row: L - 1, drag: null, raf: 0, data,
    dir: 1, YAW_MAX: 0.85, PITCH_MIN: 0.12, PITCH_MAX: 0.80, pick: null, cells: false,
    allFeat: false, ZMIN: 0.4, ZMAX: 16, spread: 1, SPREAD_MIN: 0.6, SPREAD_MAX: 3.2,
    focus: true, pivot: { x: 0, y: 0, z: 0 }, lastS: 1, mode: "rot", need: 0, busy: false,
    zoom: 1, panX: 0, panY: 0, blk: -1
  }, over || {});
  const f = new Function("SQ3", "SEQML", "sq3Need", "NNV_renderRoles",
    src + "\nreturn { draw: sq3Draw };");
  f(SQ3, { L: 16, trustFloor: 0.505 }, () => {}, () => {}).draw();
  return els.sq3Svg.innerHTML;
}

console.log("\n① 예외 없이 한 장 그려지는가 (V33.284 가 여기서 죽었다)");
let out = "";
try { out = run(); chk(true, "기본 상태에서 예외 없이 그렸다", ""); }
catch (e) { chk(false, "", `★그리다 죽는다 — ${e.constructor.name}: ${e.message}★`); }

console.log("\n② 실제로 조각이 나오는가 · 좌표가 성한가");
{
  const n = (out.match(/<path|<text|<circle/g) || []).length;
  console.log(`       조각 ${n}개`);
  chk(n > 200, `그림 조각이 ${n}개 나온다`, `조각이 ${n}개뿐이다 — 사실상 빈 화면이다`);
  /* ★NaN 이 좌표에 들어가면 브라우저는 조용히 아무것도 안 그린다★ — 예외도 안 난다.
     그래서 "오류는 없는데 화면이 빈" 상태가 되고, 그건 가장 찾기 어려운 종류다. */
  chk(!/NaN|Infinity|undefined/.test(out), "좌표·색에 NaN/undefined 가 없다",
    `★좌표에 NaN/undefined 가 있다 — 브라우저는 조용히 안 그린다: ${(out.match(/[^"]*(NaN|undefined)[^"]*/) || [])[0]}★`);
}

console.log("\n③ 다섯 단계와 시점 눈금이 다 들어갔는가");
{
  for (const nm of ["입력", "사영", "어텐션", "FFN", "출력"])
    chk(out.indexOf(nm) >= 0, `단계 '${nm}' 이 그려졌다`, `★단계 '${nm}' 이 빠졌다★`);
  const ticks = (out.match(/>t\d+/g) || []).length;
  chk(ticks >= 4, `시점 눈금이 ${ticks}개 있다(툴팁 없이도 축을 읽는다)`, `시점 눈금이 ${ticks}개뿐이다`);
  chk(/지금/.test(out), "'지금'(마지막 시점)이 표시된다", "'지금' 표시가 없다");
}

console.log("\n④ 상태를 바꿔도 안 죽는가 (실제로 눌러 보는 조합들)");
{
  const cases = [
    ["노드 낱개", { cells: true }],
    ["자동회전 중(가벼운 프레임)", { spin: true, busy: true }],
    ["피처 전체", { allFeat: true }],
    ["시점 선택 t0", { row: 0 }],
    ["헤드 0 선택", { head: 0 }],
    ["많이 확대·이동", { zoom: 8, pivot: { x: 120, y: 10, z: 40 } }],
    ["펼침 최대", { spread: 3.2 }],
    ["피처 눌림", { pick: { kind: "feat", i: 3 } }],
    ["노드 눌림", { pick: { kind: "node", stage: "ffn", t: 5, j: 2, blk: 0 } }],
    ["미학습", { data: Object.assign({}, data, { trained: false }) }]
  ];
  for (const [nm, ov] of cases) {
    try {
      const o = run(ov.data ? Object.assign({}, ov, { data: ov.data }) : ov);
      chk(!/NaN|undefined/.test(o), `${nm} — 그리고, 좌표도 성하다`, `★${nm} — 좌표에 NaN/undefined★`);
    } catch (e) { chk(false, "", `★${nm} — 죽는다: ${e.constructor.name}: ${e.message}★`); }
  }
}

/* ══ ⑤ [V33.290] ★단계가 서로 겹치지 않는가 — 눈이 아니라 자로 잰다★ ═══════════
   V33.284 는 축을 맞바꿨지만 깊이(zSpan)를 그대로 뒀다. 그래서 |yaw| < 0.62 에서
   다섯 단계가 서로 포개졌고, 자동회전은 매 주기 yaw 0 을 지나며 전부 한 장으로 뭉쳤다.
   "보기 불편하다" 를 세 번 듣고서야 잰 값이 이것이다 — 처음부터 쟀어야 했다.
   재는 양: 같은 시점에서 이웃 단계 중심 사이의 화면 간격 ÷ 카드 화면 폭.
   둘 다 맞춤배율에 비례하므로 이 ★비율은 배율과 무관★ 하다(확대해도 겹침은 안 풀린다). */
console.log("\n⑤ 단계가 겹치지 않는가 (자동회전이 도는 각도 전 구간)");
{
  const geo = ["sq3Clamp", "sq3Proj", "sq3Stages"].map(grab).join("\n");
  const G = new Function(geo + "\nreturn {sq3Proj:sq3Proj, sq3Stages:sq3Stages};")();
  const dsrc = grab("sq3Draw");
  const XSPAN = +(/xPitch = \((\d+)\/Math\.max\(1,L\)\)/.exec(dsrc) || [])[1];
  const CARDF = +(/cardW=Math\.max\(6, xPitch\*([\d.]+)\)/.exec(dsrc) || [])[1];
  const DIST  = +(/dist:(\d+)/.exec(dsrc) || [])[1];
  const YMIN  = +(/YAW_MIN: ([\d.]+)/.exec(HV) || [])[1];
  const YMAX  = +(/YAW_MAX: ([\d.]+)/.exec(HV) || [])[1];
  chk([XSPAN, CARDF, DIST, YMIN, YMAX].every(v => isFinite(v)),
    `기하 상수를 화면 코드에서 읽었다 (가로폭 ${XSPAN} · 카드비 ${CARDF} · 거리 ${DIST} · yaw ${YMIN}~${YMAX})`,
    "★기하 상수를 못 읽었다 — 이름이 바뀌었다면 이 검사부터 고쳐야 한다★");
  if ([XSPAN, CARDF, DIST, YMIN, YMAX].every(v => isFinite(v))) {
    const ST = G.sq3Stages({ L, d: dd, heads: 2, layers: 1, D }, -1);
    const xPitch = XSPAN / L, cardW = Math.max(6, xPitch * CARDF);
    const xOf = t => (t - (L - 1) / 2) * xPitch;
    const ratioAt = (yaw) => {
      const C = { yaw, pitch: 0.30, dist: DIST, s: 1, cx: 0, cy: 0 }, t = Math.floor(L / 2);
      let sep = 1e9;
      for (let i = 0; i + 1 < ST.length; i++) {
        const a = G.sq3Proj({ x: xOf(t), y: 0, z: ST[i].z }, C);
        const b = G.sq3Proj({ x: xOf(t), y: 0, z: ST[i + 1].z }, C);
        sep = Math.min(sep, Math.abs(b.X - a.X));
      }
      const p0 = G.sq3Proj({ x: xOf(t) - cardW, y: 0, z: ST[2].z }, C);
      const p1 = G.sq3Proj({ x: xOf(t) + cardW, y: 0, z: ST[2].z }, C);
      return sep / Math.abs(p1.X - p0.X);
    };
    let worst = 1e9, worstY = 0;
    for (let y = YMIN; y <= YMAX + 1e-9; y += 0.01) { const r = ratioAt(y); if (r < worst) { worst = r; worstY = y; } }
    console.log(`       자동회전 구간 ${YMIN}~${YMAX} 최악 비율 ${worst.toFixed(2)} (yaw ${worstY.toFixed(2)})` +
                ` · 기본각 0.62 → ${ratioAt(0.62).toFixed(2)}`);
    chk(worst >= 1,
      `자동회전이 도는 동안 단계가 ★한 번도 안 겹친다★ (최악 ${worst.toFixed(2)} ≥ 1)`,
      `★자동회전 중 yaw ${worstY.toFixed(2)} 에서 단계가 겹친다(비율 ${worst.toFixed(2)})★`);
    /* 손 조작은 어디든 갈 수 있으므로 겹치는 각도 자체는 존재해도 된다 — 다만
       ★자동으로는 거기 안 간다★ 는 것이 계약이다. 겹치는 각이 정말 있는지도 확인해 둔다
       (없다면 위 검사가 아무것도 안 무는 것이다 — 통과하는 검사가 곧 무는 검사는 아니다). */
    chk(ratioAt(0) < 0.2,
      `정면(yaw 0)은 여전히 깊이 축이 사라지는 각이다 (비율 ${ratioAt(0).toFixed(2)}) — 그래서 자동회전이 피한다`,
      "정면에서도 안 겹친다 — 위 검사가 아무것도 무는 게 없다는 뜻이므로 자를 다시 봐야 한다");
  }
}

/* ══ ⑥ 자동회전이 실제로 그 구간을 안 벗어나는가 — 식을 옮겨 적지 않고 ★돌려 본다★ ══ */
console.log("\n⑥ 자동회전이 겹치는 각도대로 안 내려가는가 (틱을 실제로 돌린다)");
{
  const tick = grab("sq3Tick");
  const body = /var step=function\(\)\{([\s\S]*?)\n      sq3Draw\(\);/.exec(tick);
  chk(!!body, "자동회전 갱신부를 떼어 왔다", "★자동회전 갱신부를 못 찾는다 — 검사가 헛돈다★");
  if (body) {
    const stepFn = new Function("SQ3", body[1] + "\nreturn SQ3.yaw;");
    for (const [nm, y0] of [["왼쪽에서 시작", -0.62], ["오른쪽에서 시작", 0.62],
                            ["겹치는 각에서 켰다", 0.05], ["정면에서 켰다", 0]]) {
      const SQ3 = { yaw: y0, dir: 1, spin: true, raf: 0, YAW_MAX: 0.85, YAW_MIN: 0.34 };
      let lo = 9, hi = -9, crossed = false, prev = SQ3.yaw;
      for (let i = 0; i < 3000; i++) {
        const y = stepFn(SQ3);
        if (i > 5) { lo = Math.min(lo, Math.abs(y)); hi = Math.max(hi, Math.abs(y)); }
        if (i > 5 && (y === 0 || (y * prev < 0))) crossed = true;
        prev = y;
      }
      chk(lo >= SQ3.YAW_MIN - 1e-6 && hi <= SQ3.YAW_MAX + 1e-6 && !crossed,
        `${nm} — |yaw| ${lo.toFixed(2)}~${hi.toFixed(2)} 안에서만 돈다(정면을 안 지난다)`,
        `★${nm} — |yaw| ${lo.toFixed(2)}~${hi.toFixed(2)}${crossed ? " · 정면을 지난다" : ""}★`);
    }
  }
}

/* ══ ⑦ [V33.290] ★입력 단계가 시점 축을 실제로 쓰는가★ ═══════════════════════
   종전 입력은 시점 전체를 가로지르는 슬래브 한 장이었고, 그 위에 그린 값은 |Win| —
   시점과 무관한 가중치 성질이다. 가로축이 '시점' 이라고 적어 놓고 그 위에 시간과 무관한
   양을 발랐던 것이다. 조각 수나 정규식으로는 이걸 못 잡는다(그때도 조각은 잔뜩 나왔다).
   ★표본을 한 시점만 바꿔 보고 그림이 달라지는지★ 로 묻는다 — 안 달라지면 안 쓰는 것이다. */
console.log("\n⑦ 입력이 시점마다 다른 값을 그리는가 (한 시점만 바꿔 본다)");
{
  const base = data.vizSeq.map(r => r.slice());
  const only0 = base.map(r => r.slice()); only0[0] = only0[0].map(v => -v * 0.5 - 0.3);
  const swap  = base.map(r => r.slice());
  const tmp = swap[0]; swap[0] = swap[L - 2]; swap[L - 2] = tmp;
  const draw = (vs, over) => run(Object.assign({ data: Object.assign({}, data, { vizSeq: vs }) }, over || {}));
  const a = draw(base), b = draw(only0), c = draw(swap);
  chk(a !== b, "표본의 t0 만 바꿔도 그림이 달라진다 — 입력이 ★그 시점의 값★ 을 그린다",
    "★t0 를 통째로 바꿔도 그림이 똑같다 — 입력이 시점 축을 안 쓰고 있다(슬래브 한 장)★");
  chk(a !== c, "두 시점을 맞바꾸면 그림이 달라진다 — 순서가 뜻을 갖는다",
    "★시점을 맞바꿔도 똑같다 — 가로축이 시간이라는 말이 그림과 안 맞는다★");
  // 표본이 없을 때는 종전 슬래브로 물러서야 한다 — 그때는 시점별로 보여 줄 값이 정말 없다.
  const noVS = run({ data: Object.assign({}, data, { vizSeq: null }) });
  chk(noVS.length > 1000 && !/NaN|undefined/.test(noVS),
    "표본이 없으면 종전 한 장짜리 입력으로 물러선다(빈 화면이 되지 않는다)",
    "★표본이 없을 때 입력 단계가 깨진다★");
  // 상위 24개로 줄였는가 — 75줄을 52 높이에 넣으면 한 줄이 0.7px 라 누를 수가 없다.
  chk(/IDX=IDX\.slice\(0,24\)/.test(HV) && /SQ3\.allFeat/.test(HV),
    "기본은 중요도 상위 24줄, '피처 N개' 를 켜면 전부 — 한 줄이 0.7px 가 되지 않는다",
    "입력 줄 수 제한이 없다 — 한 줄이 1px 아래면 읽지도 누르지도 못한다");
}

/* ══ ⑧ [V33.290] 다른 검사들이 ★식 문자열★ 로 확인하던 두 계약을 여기서 ★세어★ 확인한다 ══
   check-seq3d 와 check-seq3d-touch 는 `NB=IF?IF.length:24` 같은 표현을 정규식으로 찾고 있었다.
   입력 단계를 시점별로 다시 그리자 계약은 그대로인데 그 표현이 사라져 셋이 한꺼번에 깨졌다.
   조각을 찾는 검사는 코드를 고칠 때마다 같이 깨지고, 정작 깨져야 할 때는 안 깨진다.
   렌더 결과를 세는 쪽이 옳다 — 여기에 둔다. */
console.log("\n⑧ 계약을 세어 확인한다 — 낱개 피처 · 움직일 때 툴팁 정지");
{
  const o = run();
  const feats = new Set((o.match(/data-pick="feat:(\d+)"/g) || []).map(x => x));
  console.log(`       고를 수 있는 피처 ${feats.size}개 · 조각 ${(o.match(/<path/g) || []).length}개`);
  chk(feats.size >= 24, `피처가 낱개로 ${feats.size}개 그려져 각자 고를 수 있다`,
    `★피처를 고를 수 있는 자리가 ${feats.size}개뿐이다 — 묶여 있으면 '무엇이 세게 들어가나' 를 못 묻는다★`);
  const busy = run({ busy: true }), calm = run({ busy: false });
  const nb = (busy.match(/<title>/g) || []).length, nc = (calm.match(/<title>/g) || []).length;
  console.log(`       툴팁 — 움직이는 중 ${nb}개 · 멈춘 뒤 ${nc}개`);
  chk(nb === 0, "움직이는 동안에는 툴팁을 ★한 장도★ 안 만든다(그때 아무도 못 보는데 비용은 다 든다)",
    `★움직이는 중에도 툴팁을 ${nb}개 만든다 — 손가락이 화면을 앞질러 간다★`);
  chk(nc > 100, `멈추면 툴팁이 ${nc}개 살아난다(끄고 마는 게 아니라 미루는 것이다)`,
    `★멈춰도 툴팁이 ${nc}개뿐이다 — 관측을 아예 잃었다★`);
}

console.log(fails === 0 ? "\n✓ SEQ 3D 실렌더 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
