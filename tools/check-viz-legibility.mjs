/* ═══════════════════════════════════════════════════════════════════════════
   [V33.278] 두 관측 화면의 ★읽힘★ 계약 — 사용자: "3d 보는거 아직 불편해 · dnn 디자인 개선".

   ■ SEQ 3D 가 안 읽히던 이유는 각도가 아니라 ★단서 부족★ 이었다
     16개 시점 카드가 전부 같은 세기로 그려지면, 원근으로 크기만 조금 다를 뿐 똑같이
     또렷하다 — 사람 눈은 그런 그림에서 앞뒤를 못 가른다(겹친 판 더미로 보인다).
     게다가 시점 번호가 ★툴팁에만★ 있었고, 툴팁은 손가락으로 돌리는 중엔 아예 없다
     (V33.276 이 성능 때문에 껐다). 즉 폰에서는 깊이의 뜻을 알 방법이 없었다.
       ① 안개 — 뒤로 갈수록 흐리게 (3D 를 3D 로 읽게 하는 가장 값싼 단서)
       ② 초점 — 보고 있는 시점만 제 세기로, 나머지는 눌러 "한 장 + 배경" 으로
       ③ 바닥 눈금 — 시점 번호를 그림 안에 항상
       ④ 펼침 — 겹치면 시점 축을 벌릴 수 있게(손에 맡긴다)
     ★세기만 바꾼다 — 자리도 값도 안 바꾼다.★ 안 보이게 하는 것과 없는 척하는 것은 다르다.

   ■ DNN 은 점 수천 개가 흩어져 있을 뿐이었다
     층 경계가 안 보였고(헤더 배지 하나뿐), 층 안 모든 뉴런이 ★같은 색★ 이라
     "어느 뉴런이 일하는가" 가 크기·투명도로만 말해졌다. 입력 75개 이름을 7px 로 전부
     적어 글자끼리 겹친 얼룩이 됐다.
     ※ 엣지는 ★건드리지 않는다★ — 과거에 사용자가 직접 "더 얇게·더 연하게" 요청한 곳이다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const HV = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
function grabFn(name) {
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

console.log("① 축 배치가 기하학적으로 가능한가 — 이게 안 되면 어떤 튜닝도 소용없다");
{
  /* ★두 번의 튜닝이 실패한 이유★ — 많은 축(시점 16)이 깊이에, 적은 축(단계 5)이 가로에
     있었다. 원근은 깊이를 압축하므로 그 배치는 반드시 겹친다. 계산으로 확인한다:
     깊이축이 화면 가로로 번지는 폭이 기둥 간격을 넘으면 서로 뭉갠다. */
  const L = 16, yaw = 0.62;
  const zSpan = /var zSpan = (\d+)/.exec(HV), xp = /var xPitch = \(620\/Math\.max\(1,L\)\)/.test(HV);
  chk(!!zSpan && xp, `단계는 깊이(${zSpan && zSpan[1]}), 시점은 가로다`, "축 배치를 못 찾는다");
  if (zSpan) {
    const stages = 5;
    const xPitch = 620 / L;                                   // 시점 한 칸의 화면 폭
    const smear = (+zSpan[1]) * Math.sin(yaw);                // 깊이가 가로로 번지는 폭
    // 종전 배치(시점이 깊이): 깊이 250 · 기둥 간격 155
    const oldSmear = 250 * Math.sin(yaw), oldGap = 620 / (stages - 1), oldPerStep = oldSmear / L;
    console.log(`       종전 — 시점 한 장 폭 ${oldPerStep.toFixed(1)} · 깊이번짐 ${oldSmear.toFixed(0)} vs 기둥간격 ${oldGap.toFixed(0)} (${(oldSmear / oldGap).toFixed(2)}배)`);
    console.log(`       지금 — 시점 한 장 폭 ${xPitch.toFixed(1)} · 깊이엔 단계 ${stages}장뿐(번짐 ${smear.toFixed(0)})`);
    chk(oldSmear / oldGap > 0.9,
      `종전 배치는 기둥끼리 겹쳤다(${(oldSmear / oldGap).toFixed(2)}배) — 튜닝으로는 못 고칠 문제였다`,
      "종전 배치가 안 겹친다 — 이 검사가 원인을 잘못 짚었다");
    chk(xPitch > oldPerStep * 3,
      `시점 한 장이 ${(xPitch / oldPerStep).toFixed(1)}배 넓어졌다 (${oldPerStep.toFixed(1)} → ${xPitch.toFixed(1)})`,
      `넓어지지 않았다 (${oldPerStep.toFixed(1)} → ${xPitch.toFixed(1)})`);
    chk(smear < xPitch * L * 0.6,
      `깊이엔 단계 ${stages}장뿐이라 안 겹친다(번짐 ${smear.toFixed(0)} < 무대 폭 ${(xPitch * L).toFixed(0)})`,
      "깊이가 여전히 무대를 넘어 번진다");
  }
}

console.log("\n①-b 안개는 단계를, 초점은 시점을 맡는가 (종전엔 둘 다 깊이라 싸웠다)");
{
  const fg = /var fogOf=function\(si\)\{([\s\S]*?)\n    \};/.exec(HV);
  const fc = /var focOf=function\(t\)\{(.*?)\};/.exec(HV);
  chk(!!fg && !!fc, "안개(단계)와 초점(시점) 식을 화면 코드에서 떼어 왔다", "식을 못 찾는다 — 검사가 헛돈다");
  if (fg && fc) {
    const nS = 5;
    const _sc = []; for (let i = 0; i < nS; i++) _sc.push(i * 10);
    const fog = new Function("_sc", "_smn", "_smx", "return function(si){" + fg[1] + "\n};")(_sc, 0, (nS - 1) * 10);
    const foc = new Function("SQ3", "L", "return function(t){" + fc[1] + "};")({ row: 8, focus: true }, 16);
    console.log(`       안개 앞단계 ${fog(0).toFixed(3)} → 뒤단계 ${fog(nS - 1).toFixed(3)} · 초점 t8 ${foc(8)} vs t7 ${foc(7)}`);
    let mono = true; for (let i = 1; i < nS; i++) if (fog(i) > fog(i - 1) + 1e-9) mono = false;
    chk(mono && fog(nS - 1) < fog(0), "뒤쪽 단계가 흐려진다 — 파이프라인이 층으로 읽힌다", "★안개가 단조롭지 않다★");
    chk(foc(8) > foc(7) * 1.8 && foc(15) > foc(14) * 1.8,
      "보고 있는 시점과 '지금'만 또렷하다", "초점이 시점을 안 가른다");
    chk(fog(nS - 1) > 0.2 && foc(0) > 0.2,
      "가장 눌린 것도 사라지지 않는다 — 지우는 게 아니라 누르는 것이다", "★어떤 것이 사실상 사라진다★");
    chk(/var amp=function\(t,si\)\{ return fogOf\(si==null\?0:si\)\*focOf\(t\); \};/.test(HV),
      "둘을 곱해 쓴다(담당이 갈려 서로 안 싸운다)", "안개와 초점이 한 축에 겹쳐 걸려 있다");
  }
}

console.log("\n② 세기만 바꾸는가 — 자리·값은 그대로인가");
{
  const draw = grabFn("sq3Draw") || "";
  chk(/fill="rgba\('\+baseRGB\+','\+baseA\.toFixed\(3\)\+'\)"/.test(draw),
    "카드 채움에만 세기를 곱한다", "카드 채움 배선을 못 찾는다");
  chk(!/zOf=function\(t\)\{ return \(t-\(L-1\)\/2\)\*zPitch\*amp/.test(draw),
    "자리(zOf)는 세기와 무관하다 — 눌렸다고 옮기지 않는다", "★세기가 자리를 바꾼다★");
  chk(/data-pick="step:'\+t2\+'"/.test(draw),
    "눌린 시점도 여전히 눌러서 고를 수 있다", "눌린 시점을 못 고른다 — 없는 척이 된다");
}

console.log("\n③ 바닥 시점 눈금 — 툴팁 없이도 깊이의 뜻이 보이는가");
{
  const draw = grabFn("sq3Draw") || "";
  chk(/>t'\+li2\+\(_now\?' 지금':''\)\+'<\/text>/.test(draw),
    "시점 번호를 그림 안에 그린다(툴팁이 아니라)", "시점 번호가 여전히 툴팁에만 있다");
  chk(/if\(li2%_every!==0 && li2!==L-1 && li2!==SQ3\.row\) continue;/.test(draw),
    "전부 적지 않는다 — 몇 칸마다 · 마지막 · 고른 것만(글자 더미 방지)", "눈금을 전부 적어 글자가 겹친다");
  // 눈금은 lite(움직이는 중)에도 살아 있어야 한다 — 그게 이 눈금을 넣은 이유다.
  const seg = draw.slice(draw.indexOf("바닥 시점 눈금"), draw.indexOf("어텐션 곡선"));
  chk(seg.length > 0 && !/lite/.test(seg),
    "★돌리는 중에도 눈금은 남는다★ — 툴팁을 끈 자리를 이것이 메운다", "눈금이 lite 에서 사라진다");
}

console.log("\n④ 펼침 — 겹치면 벌릴 수 있는가");
{
  chk(/spread: 1, SPREAD_MIN: 0\.6, SPREAD_MAX: 3\.2/.test(HV),
    "펼침 배수와 범위가 있다(기본 1 — 겹침이 없어져 응급수단이 아니게 됐다)", "펼침 설정이 없다");
  chk(/\* sq3Clamp\(isFinite\(SQ3\.spread\)\?SQ3\.spread:1, SQ3\.SPREAD_MIN, SQ3\.SPREAD_MAX\)/.test(HV),
    "시점 간격(가로)이 펼침 배수를 실제로 곱한다", "펼침이 간격에 반영되지 않는다 — 버튼만 있고 효과가 없다");
  chk(/id="sq3SpIn"/.test(HV) && /id="sq3SpOut"/.test(HV) && /id="sq3Focus"/.test(HV),
    "펼침 ±·시점 강조 버튼이 화면에 있다", "조작 버튼이 없다");
  chk(/setSpread\(SQ3\.spread\*1\.25\)/.test(HV) && /sq3Need\(\); \};\n    var spI/.test(HV.replace(/\r/g, "")),
    "펼침도 프레임 병합으로 그린다(V33.276 규약)", "펼침이 직접 그린다");
  chk(/var cardH=52, cardW=Math\.max\(6, xPitch\*0\.40\);/.test(HV),
    "카드 폭이 시점 간격에 따라간다 — 펼치면 카드도 같이 커진다(고정폭이 아니다)",
    "카드 폭이 여전히 고정이다");
}

console.log("\n④-b 시점 이동 — 옮긴 자리를 축으로 도는가 (초점 고정 해소)");
{
  const F = new Function(grabFn("sq3Proj") + "\nreturn sq3Proj;")();
  const base = { yaw: -0.62, pitch: 0.30, dist: 1100, s: 1, cx: 450, cy: 230 };
  const P = { x: 160, y: 0, z: 90 };            // 화면 오른쪽 뒤에 있는 어떤 점(보고 싶은 것)
  /* 피벗을 그 점에 두면 ★회전해도 그 점은 제자리★ 여야 한다 — 그게 "축을 옮겼다" 는 뜻이다. */
  const withP = y => F(P, Object.assign({}, base, { yaw: y, px: P.x, py: P.y, pz: P.z }));
  const noP   = y => F(P, Object.assign({}, base, { yaw: y }));
  const a0 = withP(base.yaw), a1 = withP(base.yaw + 0.45);
  const b0 = noP(base.yaw),   b1 = noP(base.yaw + 0.45);
  const movedWith = Math.hypot(a1.X - a0.X, a1.Y - a0.Y);
  const movedNo   = Math.hypot(b1.X - b0.X, b1.Y - b0.Y);
  console.log(`       회전 0.45rad — 축을 그 점에 두면 ${movedWith.toFixed(2)}px 이동 · 종전(중심 축)은 ${movedNo.toFixed(2)}px`);
  chk(movedWith < 0.001,
    "축을 옮긴 점은 회전해도 제자리다 — 보던 것이 달아나지 않는다",
    `★축을 옮겼는데도 그 점이 ${movedWith.toFixed(2)}px 움직인다 — 피벗이 안 먹는다★`);
  chk(movedNo > 20,
    `종전 방식은 같은 점이 ${movedNo.toFixed(0)}px 밀려난다 — 사용자가 말한 "초점 고정" 이 이것이다`,
    "종전 방식도 안 밀린다 — 이 검사가 원인을 잘못 짚었다");
  /* ★기존 계약은 그대로여야 한다★ — px/py/pz 없는 C 는 종전과 한 치도 달라지면 안 된다
     (check-seq3d.mjs 가 그 계약 위에서 원근·깊이·상하를 잰다). */
  const q = F({ x: 100, y: 40, z: -70 }, base);
  const q2 = F({ x: 100, y: 40, z: -70 }, Object.assign({}, base, { px: 0, py: 0, pz: 0 }));
  chk(q.X === q2.X && q.Y === q2.Y && q.z === q2.z,
    "피벗이 없으면(또는 0이면) 종전 사영과 완전히 같다 — 기존 계약 불변",
    "★피벗을 안 줘도 결과가 달라졌다 — 기존 검사들의 바탕이 흔들린다★");
  chk(/panWorld=function\(dxs, dys\)/.test(HV) && /SQ3\.pivot\.x -= wx\*cy;  SQ3\.pivot\.z -= wx\*sy;/.test(HV),
    "이동이 피벗을 월드에서 옮긴다(화면만 미는 게 아니다)", "이동이 여전히 화면만 민다");
  chk(/var C0=\{ yaw:C\.yaw, pitch:C\.pitch, dist:C\.dist, s:1, cx:0, cy:0 \};/.test(HV),
    "자동맞춤은 피벗 없이 액자를 잡는다 — 안 그러면 옮긴 만큼을 매 프레임 취소한다",
    "★맞춤이 피벗을 포함해 재서 이동이 상쇄된다★");
  chk(/id="sq3Mode"/.test(HV) && /id="sq3Center"/.test(HV),
    "손가락 하나 이동 모드와 중심 되돌리기 버튼이 있다", "이동 모드/되돌리기 버튼이 없다");
  chk(/SQ3\.pivot=\{x:0,y:0,z:0\};\n      SQ3\.yaw=-0\.62/.test(HV.replace(/\r/g, "")),
    "화면맞춤이 피벗도 되돌린다 — 안 그러면 '맞춤' 이 안 맞는다", "화면맞춤이 피벗을 남긴다");
}

console.log("\n⑤ DNN — 층이 묶여 보이는가 · 강도가 색으로 읽히는가");
{
  const dr = grabFn("NNV_drawSVG") || "";
  chk(/var bandBg='';/.test(dr) && /'\+bandBg\+nodes\+/.test(dr),
    "층마다 배경 판을 깔고 실제로 그린다 — 같은 층이 한 덩어리로 읽힌다", "층 배경이 없거나 안 그려진다");
  chk(/var nfill=mixHex\(dimC, fill, Math\.max\(0, Math\.min\(1, s\)\)\);/.test(dr),
    "뉴런 강도를 ★밝기★ 로도 말한다(크기·투명도만이 아니라)", "강도가 여전히 한 가지 채널로만 말해진다");
  chk(/fill="'\+nfill\+'"/.test(dr), "그 색을 실제로 칠한다", "램프를 계산만 하고 안 쓴다");
  chk(/col2\[k\]\.name && k<12/.test(dr),
    "입력 이름은 상위 12개만 적는다 — 75개를 7px 로 겹쳐 적던 얼룩을 없앤다", "입력 이름을 여전히 전부 적는다");
  chk(/뉴런 강도 약 → 강/.test(dr), "밝기의 뜻을 범례로 답한다(색으로 말하면 뜻도 있어야 한다)", "범례가 없다");
  /* ★엣지는 건드리지 않는다★ — V12.95 에서 사용자가 직접 "더 얇게·더 연하게" 요청한 곳이다.
     디자인 개선이라는 이름으로 지난 요청을 되돌리면 그건 개선이 아니라 무시다. */
  chk(/var op=\(0\.07\+0\.30\*e\.str\)\.toFixed\(3\), sw=\(0\.16\+0\.40\*e\.str\)\.toFixed\(2\);/.test(dr),
    "엣지 굵기·불투명도는 그대로다(과거 사용자 요청을 되돌리지 않았다)",
    "★엣지를 건드렸다 — V12.95 의 사용자 요청을 무시한 것이다★");
}

console.log(fails === 0 ? "\n✓ 관측 화면 읽힘 계약 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
