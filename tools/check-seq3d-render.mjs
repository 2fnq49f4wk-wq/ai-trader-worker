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
  vizSeq: grid(L, D, (i, j) => ((j * 7) % 13) / 6 - 1),
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
  classList: { add() {}, remove() {}, toggle() {} }, getAttribute: () => null,
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

console.log(fails === 0 ? "\n✓ SEQ 3D 실렌더 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
