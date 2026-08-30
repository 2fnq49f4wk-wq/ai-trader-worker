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

console.log("① 안개·초점이 실제로 앞뒤를 가르는가 — 화면 코드의 amp 식을 떼어 잰다");
{
  /* 식을 손으로 옮겨 적지 않는다 — index.html 의 그 줄을 그대로 떼어 돌린다. */
  const m = /var amp=function\(t\)\{([\s\S]*?)\n    \};/.exec(HV);
  chk(!!m, "amp(세기) 식을 화면 코드에서 떼어 왔다", "amp 식을 못 찾는다 — 검사가 헛돈다");
  if (m) {
    const L = 16;
    const mk = (row, focus) => {
      const _zc = []; for (let t = 0; t < L; t++) _zc.push(t * 10);   // 앞(t0) → 뒤(t15)
      const SQ3 = { row, focus };
      return new Function("_zc", "_zmn", "_zmx", "SQ3", "L",
        "return function(t){" + m[1] + "\n};")(_zc, 0, (L - 1) * 10, SQ3, L);
    };
    const a = mk(8, true);
    console.log(`       t0 ${a(0).toFixed(3)} · t8(선택) ${a(8).toFixed(3)} · t14 ${a(14).toFixed(3)} · t15(지금) ${a(15).toFixed(3)}`);
    // 안개: 선택·마지막을 뺀 나머지는 뒤로 갈수록 흐려져야 한다.
    const plain = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14];
    let mono = true;
    for (let i = 1; i < plain.length; i++) if (a(plain[i]) > a(plain[i - 1]) + 1e-9) mono = false;
    chk(mono, "뒤로 갈수록 흐려진다 — 깊이가 세기로 읽힌다", "★안개가 단조롭지 않다 — 앞뒤가 안 갈린다★");
    // 초점: 선택한 시점이 이웃보다 확실히 도드라져야 한다.
    chk(a(8) > a(7) * 1.8 && a(8) > a(9) * 1.8,
      `선택 시점이 이웃보다 확실히 도드라진다 (t8 ${a(8).toFixed(3)} vs t7 ${a(7).toFixed(3)})`,
      "선택 시점이 이웃과 구별되지 않는다 — 초점이 일을 안 한다");
    chk(a(15) > a(14) * 1.8, "'지금'(마지막 시점)도 항상 도드라진다 — 모델이 실제로 읽는 자리다",
      "마지막 시점이 묻힌다");
    // 끄면 종전 그림으로 — 안개만 남고 초점은 사라져야 한다.
    const b = mk(8, false);
    chk(Math.abs(b(8) - b(7)) < 0.08 && b(0) > b(14),
      "강조를 끄면 초점은 사라지고 안개만 남는다(종전 그림으로 되돌릴 수 있다)",
      "강조를 꺼도 그림이 안 돌아온다");
    // ★세기만 바꾼다★ — 눌린 카드도 0 이 아니어야 한다(없는 척하면 안 된다).
    let minA = 1; for (let t = 0; t < L; t++) minA = Math.min(minA, a(t));
    chk(minA > 0.1, `가장 눌린 시점도 ${minA.toFixed(3)} 으로 남는다 — 지우는 게 아니라 누르는 것이다`,
      `★어떤 시점이 사실상 사라진다(${minA.toFixed(3)}) — 없는 척하는 그림이 된다★`);
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
  chk(/spread: 1\.5, SPREAD_MIN: 0\.6, SPREAD_MAX: 3\.2/.test(HV),
    "펼침 배수와 범위가 있다(기본 1.5 — 종전보다 벌려 시작한다)", "펼침 설정이 없다");
  chk(/\* sq3Clamp\(isFinite\(SQ3\.spread\)\?SQ3\.spread:1\.5, SQ3\.SPREAD_MIN, SQ3\.SPREAD_MAX\)/.test(HV),
    "시점 간격이 펼침 배수를 실제로 곱한다", "펼침이 간격에 반영되지 않는다 — 버튼만 있고 효과가 없다");
  chk(/id="sq3SpIn"/.test(HV) && /id="sq3SpOut"/.test(HV) && /id="sq3Focus"/.test(HV),
    "펼침 ±·시점 강조 버튼이 화면에 있다", "조작 버튼이 없다");
  chk(/setSpread\(SQ3\.spread\*1\.25\)/.test(HV) && /sq3Need\(\); \};\n    var spI/.test(HV.replace(/\r/g, "")),
    "펼침도 프레임 병합으로 그린다(V33.276 규약)", "펼침이 직접 그린다");
  chk(/카드가 9 폭 × 46 높이면/.test(HV) && /cardH=46, cardW=13;/.test(HV),
    "카드 폭을 넓혔다 — 비스듬히 봐도 카드로 읽힌다", "카드가 여전히 실오라기다");
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
