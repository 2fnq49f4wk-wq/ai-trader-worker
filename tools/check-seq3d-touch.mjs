/* ═══════════════════════════════════════════════════════════════════════════
   [V33.276] SEQ 3D 관측 — 손가락 조작 계약.

   ■ 무엇이 잘못돼 있었나 (사용자 보고: "터치하면 역방향으로 움직인다")
     회전은 yaw += dx 였다. 그런데 이 사영에서 카메라를 향한 면의 화면X 는
     x' = cos(θ − yaw) 이고 그 면은 θ − yaw = −90° 이므로 dX/dyaw = sin(−90°) = −1 이다.
     ★오른쪽으로 끌면 앞면이 왼쪽으로 갔다.★ 마우스면 취향 논쟁이 되지만 화면을 직접
     만지는 터치에서는 그냥 고장이다.

   ■ 이 검사가 무는 것 — 방향은 눈으로만 확인하면 반드시 다시 뒤집힌다
     ① 화면 코드에서 ★실제 회전식을 떼어★ 사영에 넣고, 앞면이 손가락을 따라가는지 잰다
     ② 세로도 같이 — 아래로 끌면 꼭대기가 아래로 가는가
     ③ 두 손가락 확대(핀치)가 있는가 · 붙잡은 자리가 고정되는가(중앙만 늘리지 않는가)
     ④ 확대 계산이 ★한 곳★ 인가 (휠·핀치·더블탭이 따로 적히면 언젠가 서로 달라진다)
     ⑤ 브라우저가 핀치를 가로채지 않는가 (touch-action 은 상속되지 않는다)
     ⑥ 성능 — 입력마다 그리지 않고 프레임당 한 번으로 모으는가
     ⑦ 성능 — 움직이는 동안 툴팁을 안 만들되, 멈추면 되살아나는가
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

console.log("① 앞면이 손가락을 따라가는가 — 화면 코드의 회전식을 그대로 떼어 잰다");
{
  const F = new Function(grabFn("sq3Proj") + "\n" + grabFn("sq3Clamp")
    + "\nreturn { p: sq3Proj, c: sq3Clamp };")();
  // ★식을 손으로 옮겨 적지 않는다.★ index.html 에 실제로 있는 그 줄에서 부호와 계수를 읽는다.
  const mY = /SQ3\.yaw\s*=\s*sq3Clamp\(SQ3\.yaw\s*([+-])\s*dx\s*\*\s*([0-9.]+)/.exec(HV);
  const mP = /SQ3\.pitch\s*=\s*sq3Clamp\(SQ3\.pitch\s*([+-])\s*dy\s*\*\s*([0-9.]+)/.exec(HV);
  chk(!!mY && !!mP, `회전식을 화면 코드에서 읽었다 (yaw ${mY && mY[1]}dx·${mY && mY[2]} · pitch ${mP && mP[1]}dy·${mP && mP[2]})`,
    "회전식을 못 찾는다 — 검사가 헛돈다");
  if (mY && mP) {
    const sgnY = mY[1] === "-" ? -1 : 1, kY = parseFloat(mY[2]);
    const sgnP = mP[1] === "-" ? -1 : 1, kP = parseFloat(mP[2]);
    const base = { yaw: -0.62, pitch: 0.30, dist: 1100, s: 1, cx: 450, cy: 230 };
    // 지금 카메라를 향하고 있는 ★그 점★ — 손가락 아래 있다고 느끼는 면이다.
    /* 반지름은 ★실제 장면 크기★ 로 잡는다. 단위원으로 재면 카메라를 향한 점은 X 의
       극값 자리라 변위가 0.2px 수준이고, 그 미세한 값으로 방향을 판정하면 검사가
       부동소수 잡음에 흔들린다(처음에 실제로 그랬다). 무대 폭은 620 안팎이다. */
    const R = 200;
    let near = null;
    for (let a = 0; a < 360; a++) {
      const p = { x: R * Math.cos(a * Math.PI / 180), y: 0, z: R * Math.sin(a * Math.PI / 180) };
      const q = F.p(p, base);
      if (!near || q.z < near.q.z) near = { p, q };
    }
    const dx = 60;   // 오른쪽으로 60px 끌었다
    const after = F.p(near.p, Object.assign({}, base, { yaw: F.c(base.yaw + sgnY * dx * kY, -0.85, 0.85) }));
    console.log(`       오른쪽으로 ${dx}px → 앞면 화면X ${near.q.X.toFixed(1)} → ${after.X.toFixed(1)}`);
    chk(after.X > near.q.X + 5,
      "오른쪽으로 끌면 앞면도 ★오른쪽★ 으로 간다 — 손가락을 따라온다",
      `★앞면이 손가락 반대로 간다(${near.q.X.toFixed(1)} → ${after.X.toFixed(1)})★ — 사용자가 본 그 증상이다`);
    // 왼쪽도 대칭이어야 한다(한쪽만 맞으면 그건 우연이다)
    const left = F.p(near.p, Object.assign({}, base, { yaw: F.c(base.yaw - sgnY * dx * kY, -0.85, 0.85) }));
    chk(left.X < near.q.X - 5, "왼쪽으로 끌면 앞면도 왼쪽으로 간다(대칭이다)", "왼쪽 방향이 안 맞는다");

    console.log("\n② 세로 — 아래로 끌면 꼭대기가 아래로 가는가");
    const top0 = F.p({ x: 0, y: 100, z: 0 }, base);
    const top1 = F.p({ x: 0, y: 100, z: 0 }, Object.assign({}, base, { pitch: F.c(base.pitch + sgnP * 60 * kP, 0.12, 0.80) }));
    console.log(`       아래로 60px → 꼭대기 화면Y ${top0.Y.toFixed(1)} → ${top1.Y.toFixed(1)}`);
    chk(top1.Y > top0.Y, "아래로 끌면 꼭대기가 아래로 간다 — 손가락을 따라온다",
      "★세로가 손가락 반대로 간다★");
  }
}

console.log("\n③~④ 두 손가락 확대 — 있는가 · 붙잡은 자리를 고정하는가 · 한 곳에 적혀 있는가");
{
  chk(/_pinch\s*=\s*\{\s*d:\s*_tD\(e\.touches\)/.test(HV),
    "두 손가락을 잡으면 핀치 상태를 만든다", "핀치가 없다 — 두 손가락으로 확대할 수 없다");
  chk(/zoomAt\(SQ3\.zoom\s*\*\s*\(nd\s*\/\s*_pinch\.d\)/.test(HV),
    "손가락 사이 거리 비율만큼 확대한다(벌린 만큼 커진다)", "핀치가 거리 비율을 안 쓴다");
  chk(/SQ3\.panX\s*\+=\s*v\.x-v0\.x;\s*SQ3\.panY\s*\+=\s*v\.y-v0\.y;/.test(HV),
    "두 손가락 중심이 움직이면 장면도 같이 움직인다(확대와 이동을 동시에)", "두 손가락 이동이 없다");
  const za = /var zoomAt=function\(nz, vx, vy\)\{([\s\S]{0,320}?)\};/.exec(HV);
  chk(!!za && /SQ3\.panX = vx - \(vx-SQ3\.panX\)\*rf/.test(za[1]),
    "확대가 붙잡은 자리를 고정한다 — 중앙만 늘려 보려던 곳을 밀어내지 않는다",
    "확대 기준점 보정이 없다 — 확대하면 보던 곳이 화면 밖으로 나간다");
  // ★계산이 한 곳에만★ — 휠·핀치·더블탭이 따로 적히면 언젠가 서로 다르게 동작한다.
  const anchors = (HV.match(/\(vx-SQ3\.panX\)\*rf|\(mx - SQ3\.panX\)\*rf/g) || []).length;
  chk(anchors === 1, `확대 기준점 계산이 딱 한 곳이다(휠·핀치·더블탭이 같은 함수를 쓴다)`,
    `★확대 계산이 ${anchors}곳에 따로 있다 — 언젠가 서로 달라진다★`);
  chk(/if\(SQ3\.zoom>1\.2\)\{ SQ3\.panX=0; SQ3\.panY=0; setZoom\(1\); \}/.test(HV),
    "더블탭은 확대돼 있으면 화면맞춤으로 되돌린다(빠져나올 길이 있다)", "더블탭에 되돌리기가 없다");
  const zmax = /ZMAX:\s*([0-9.]+)/.exec(HV);
  chk(zmax && parseFloat(zmax[1]) >= 10,
    `확대 상한이 ${zmax ? zmax[1] : "?"}배까지 열려 있다 — 노드 낱개를 들여다볼 수 있다`,
    "확대 상한이 낮아 낱개를 못 본다");
}

console.log("\n⑤ 브라우저가 핀치를 가로채지 않는가 (touch-action 은 상속되지 않는다)");
{
  const css = /#page-nnviz \.sq3-wrap svg\{([\s\S]{0,400}?)\}/.exec(HV);
  chk(!!css && /touch-action:\s*none/.test(css[1]),
    "터치가 시작되는 ★svg 자체★ 에 touch-action:none 이 있다",
    "★svg 에 touch-action 이 없다 — 브라우저가 두 손가락을 페이지 확대로 가로챈다★");
  chk(/svg\.addEventListener\('touchmove',move,\{passive:false\}\)/.test(HV),
    "touchmove 가 preventDefault 할 수 있게 등록돼 있다", "touchmove 가 passive 라 스크롤을 못 막는다");
  chk(/svg\.addEventListener\('touchcancel',up\)/.test(HV),
    "touchcancel 도 잡는다 — 전화가 와도 드래그가 걸린 채 남지 않는다", "touchcancel 처리가 없다");
}

console.log("\n⑥~⑦ 성능 — 프레임당 한 번만 그리는가 · 움직일 때 툴팁을 안 만드는가");
{
  chk(/function sq3Need\(\)\{[\s\S]{0,240}requestAnimationFrame/.test(HV),
    "그리기를 프레임당 한 번으로 모으는 sq3Need 가 있다", "입력마다 즉시 그린다 — 손가락이 화면을 앞지른다");
  // 드래그·핀치·확대 경로가 직접 sq3Draw 를 부르면 병합이 무의미해진다.
  const moveFn = /var move=function\(e\)\{([\s\S]*?)\n    \/\* 손을 떼면/.exec(HV);
  chk(!!moveFn && !/sq3Draw\(\)/.test(moveFn[1]) && /sq3Need\(\)/.test(moveFn[1]),
    "드래그·핀치는 sq3Need 만 부른다(직접 그리지 않는다)", "드래그가 아직 직접 sq3Draw 를 부른다");
  chk(/if\(zv\) zv\.textContent=Math\.round\(SQ3\.zoom\*100\)\+'%'; sq3Need\(\);/.test(HV),
    "확대도 프레임 병합을 쓴다", "확대가 직접 그린다");
  chk(/var lite = SQ3\.busy \|\| SQ3\.spin;/.test(HV),
    "움직이는 중인지(lite)를 그리기가 안다", "lite 판정이 없다");
  chk(/\(lite\?'':'<title>'\+sq3Esc\(S\.name\)/.test(HV),
    "노드 낱개 툴팁(장당 1,536개)을 움직이는 동안 안 만든다", "가장 비싼 툴팁이 여전히 매 프레임 만들어진다");
  chk(/var ttl=\(IF&&!lite\)\?/.test(HV) && /\+\(lite\?'':'<title>t'\+t2/.test(HV),
    "입력 피처·시점 카드 툴팁도 같이 멈춘다", "일부 툴팁만 멈춘다 — 절반만 빨라진다");
  // ★멈추면 되살아나야 한다★ — 안 그러면 성능을 얻고 기능을 잃는다.
  chk(/if\(SQ3\.busy\)\{ SQ3\.busy=false; sq3Need\(\); \}/.test(HV),
    "손을 떼면 툴팁이 살아 있는 프레임을 다시 그린다", "★손을 떼도 툴팁이 안 돌아온다 — 기능을 잃는다★");
  chk(/if\(!SQ3\.spin\)\{ sq3Need\(\); return; \}/.test(HV),
    "자동회전이 멈출 때도 제대로 된 프레임을 한 장 그린다", "자동회전을 끄면 툴팁 없는 그림이 남는다");
}

console.log(fails === 0 ? "\n✓ SEQ 3D 조작·성능 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
