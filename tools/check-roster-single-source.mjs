/* ═══════════════════════════════════════════════════════════════════════════
   [V33.301] 위원 상태의 ★출처가 하나인가★ — 사이드바와 두뇌 관측이 갈라지지 않는가.

   ■ 무엇이 있었나 (사용자 화면 실측)
     오른쪽 사이드바는 위원 불이 꺼져 있는데, 가운데 '구조 관측' 은 켜져 있었다.
     같은 화면 안에서도 갈렸다 — FLOW '○ 잠정가동 ×0.60' / SEQ '● 잠정가동 ×0.17'.
     같은 등급(잠정)인데 색이 달랐다.

   ■ 왜 반복됐나
     V33.181 · V33.195 · V33.280 · V33.282 가 전부 같은 사고다. 그때마다 ★값 하나★ 를
     맞췄고 구조는 그대로 뒀다. 화면에는 "이 위원에 불이 들어오는가" 를 각자 답하는
     술어가 일곱 개 있었다:
       ① _memb[] 의 admit.admit         ② arow() 의 tier==='full'
       ③ SEQ 행의 trusted && mult>0     ④ 이중헤드 행의 both/live(+trusted 폴백)
       ⑤ am() 의 trusted/trained        ⑥ 신경망 지도의 tier
       ⑦ cmState() 의 committee/trusted/dualShift/admit 네 갈래
     일곱이 다른 답을 내는 것은 버그가 아니라 설계의 결과다.

   ■ 이 검사가 무는 것
     ① 서버에 명부가 하나 있고(buildRoster), 화면에 값을 주는 ★모든 응답★ 이 그것을 싣는가
     ② 화면에 합류 판정 술어가 다시 생기지 않았는가(정적 금지어)
     ③ ★실제로 돌려★ 사이드바(cmState)·신경망 지도(NNV_paintDots)·불(LUXR.dot)이
        같은 명부에서 ★글자 하나까지 같은 답★ 을 내는가
     ④ 갈라진 술어를 다시 넣으면 이 검사가 ★실패하는가★(변이 시험 — 검사가 살아 있는가)
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import { RETIRED } from "./_retired.mjs";
import vm from "node:vm";

const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const HV = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* 함수 본문을 ★중괄호를 세어★ 뽑는다 — 고정 길이 슬라이스는 리팩터 한 번에 거짓말이 된다
   (V33.299 에서 check-stack-oof 가 정확히 그렇게 헛돌았다). */
function fnBody(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return "";
  let j = src.indexOf("{", i);
  if (j < 0) return "";
  let d = 0;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (c === "{") d++;
    else if (c === "}") { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return src.slice(i);
}

console.log("① 서버 — 명부는 하나이고, 값을 주는 모든 응답이 그것을 싣는다");
{
  chk(typeof M.buildRoster === "function", "buildRoster 가 있다", "★명부를 만드는 함수가 없다★");
  chk(typeof M.rosterCls === "function" && typeof M.rosterTally === "function",
    "상태 규칙(rosterCls)과 좌석 집계(rosterTally)도 서버 한 곳에 있다",
    "상태 규칙·집계가 서버에 없다 — 화면이 다시 만들게 된다");
  chk(/roster: await buildRoster\(env\.DB\)/.test(S),
    "/api/ai-mode(사이드바)가 명부를 싣는다", "★사이드바 응답에 명부가 없다★");
  chk(/_ov\.roster = await buildRoster\(env\.DB\)/.test(S),
    "/api/nn-viz?model=overview(구조 관측)가 ★같은 함수★ 를 부른다", "★구조 관측이 명부를 안 쓴다★");
  chk(/data\.roster = await buildRoster\(env\.DB\)/.test(S),
    "모델별 탭 응답에도 명부를 싣는다(탭 글자와 탭 점이 같은 근거를 쓴다)",
    "모델 탭이 명부 없이 그려진다 — '합류 상태' 글자가 다시 따로 논다");
  chk(/_ov\.votingCount = _ov\.tally\.live/.test(S),
    "투표 인원수도 명부 집계에서 나온다(experts[] 를 따로 세지 않는다)",
    "인원수를 따로 센다 — 두 화면의 'n/m' 이 어긋난다");

  /* 명부는 ★한 번의 호출★ 로 만들어져야 한다. 두 엔드포인트가 각자 조립하면
     그 순간 다시 두 개의 자가 된다 — 이 저장소가 네 번 당한 그 모양이다. */
  const b = fnBody(S, "async function buildRoster(DB)");
  chk(b.length > 800, "buildRoster 본문을 찾았다", "buildRoster 본문을 못 찾는다");
  /* [V33.422] ★목록을 손으로 적지 않는다.★ 퇴역(RETIRED)으로 넷이 빠지자 손목록이
     "명부에 dnn 이 없다" 며 배포를 막았다 — 뜻과 무관한 실패다. 현역만 요구하고,
     ★퇴역한 이름이 남아 있지 않은지★ 도 같이 본다(양쪽으로 갈릴 자리를 없앤다). */
  for (const k of ["mind", "gbdt", "xgb", "memo", "seq", "rule", "omni", "dual_bull", "dual_bear", "dual"])
    chk(b.includes('"' + k + '"'), `명부가 ${k} 를 담는다`, `★명부에 ${k} 가 없다 — 그 위원은 어느 화면에도 못 나온다★`);
  for (const k of RETIRED)
    chk(!new RegExp(`add\\("${k}"`).test(b), `명부가 퇴역한 ${k} 를 담지 않는다`,
      `★퇴역한 ${k} 가 아직 명부에 있다★`);
  chk(/_boostersCached\(DB\)/.test(b),
    "부스터 가동 판정은 ★위원회가 실제로 쓰는 함수★ 로 한다(trusted 플래그가 아니다)",
    "부스터를 trusted 로만 본다 — V33.191 의 증거문턱을 화면이 모른다");
  chk((b.match(/expertAdmit\(/g) || []).length >= 2,
    "MEMO·이중헤드 합류는 expertAdmit 하나로 판정한다(퇴역 위원이 빠져 호출 수가 줄었다)",
    "합류 판정이 expertAdmit 을 안 쓴다");
}

console.log("\n② 화면 — 합류 판정 술어가 다시 생기지 않았는가");
const BANNED = [
  [/ico\(\s*(?:true|false|null)\s*\)/, "ico() 에 불리언을 넘긴다 — 불이 명부가 아닌 지역 판단에서 나온다"],
  [/\w+\s*&&\s*\w+\.admit\s*&&\s*\w+\.admit\.admit/, "화면이 admit.admit 으로 합류를 판정한다"],
  [/tier\s*===\s*'full'\s*\)\s*\?\s*true/, "화면이 tier 로 불을 켠다"],
  [/var cls = !e\.trained \? 'off'/, "신경망 지도가 experts[] 에서 상태를 다시 만든다"],
  [/q\.trusted\s*&&\s*has\(q\.mult\)/, "SEQ 행이 trusted 로 불을 켠다(다른 행과 규칙이 다르다)"],
  [/var aB\s*=\s*b\.admit/, "이중헤드 행이 admit 을 직접 읽는다"]
];
function scan(text) {
  return BANNED.filter(([re]) => re.test(text)).map(([, why]) => why);
}
{
  const hit = scan(HV);
  chk(hit.length === 0, "화면에 합류 판정 술어가 남아 있지 않다(금지어 " + BANNED.length + "종 전부 없음)",
    "★화면이 다시 판정한다: " + hit.join(" / ") + "★");
  chk(/window\.LUXR = R;/.test(HV), "명부 저장소(LUXR)가 한 번 정의된다", "LUXR 이 없다");
  chk((HV.match(/window\.LUXR = R;/g) || []).length === 1,
    "LUXR 정의가 하나뿐이다", "★LUXR 이 두 번 정의된다 — 어느 것이 이기는지 알 수 없다★");
  const nSet = (HV.match(/LUXR\.set\(/g) || []).length;
  chk(nSet >= 5, `명부를 받는 곳이 ${nSet} 군데다 — 응답이 오는 모든 경로가 같은 저장소를 채운다`,
    `명부를 받는 곳이 ${nSet} 군데뿐이다 — 어떤 화면은 빈 명부로 그린다`);
  const pd = fnBody(HV, "function NNV_paintDots(d)");
  chk(pd.includes("d.roster") && !pd.includes("d.experts"),
    "신경망 지도가 명부만 읽는다(experts[]/stack/dual 을 다시 해석하지 않는다)",
    "★신경망 지도가 아직 세 갈래를 각자 해석한다★");
  const cs = fnBody(HV, "function cmState(key, mode)");
  chk(cs.includes("LUXR.get(key)") && !cs.includes("mode.committee"),
    "사이드바 위원 판정(cmState)이 명부만 읽는다",
    "★cmState 가 아직 committee/trusted 를 본다★");
}

console.log("\n③ ★실제로 돌린다★ — 같은 명부로 세 화면이 같은 답을 내는가");
{
  const lux = HV.match(/\(function\(\)\{\s*var GLYPH[\s\S]*?window\.LUXR = R;\s*\}\)\(\);/);
  chk(!!lux, "LUXR 모듈을 뽑았다", "LUXR 모듈을 못 뽑는다");
  const cmcls = HV.match(/var CMCLS = \{[^}]*\};/);
  const cmst = fnBody(HV, "function cmState(key, mode)");
  const pdots = fnBody(HV, "function NNV_paintDots(d)");
  chk(!!cmcls && cmst.length > 100 && pdots.length > 100, "사이드바·지도 판정부를 뽑았다", "판정부를 못 뽑는다");

  /* 서버 명부를 ★그대로★ 넣는다 — rosterCls 로 state 를 매기므로 서버 규칙이 그대로 적용된다.
     한 등급씩 전부 태워, '잠정' 이 한쪽에서만 켜지는 그 사고를 재현할 수 있게 한다. */
  const raw = [
    { key: "mind", role: "chair", trained: true, featVerOk: true, tier: "full", mult: 1 },
    { key: "dnn", role: "expert", trained: true, featVerOk: true, tier: "reject", mult: 0 },
    { key: "gbdt", role: "expert", trained: false, featVerOk: true, tier: null, mult: 0 },
    { key: "xgb", role: "expert", trained: true, featVerOk: true, tier: "full", mult: 0.8 },
    { key: "lgb", role: "expert", trained: true, featVerOk: false, tier: "full", mult: 0.8 },
    { key: "cat", role: "expert", trained: true, featVerOk: true, tier: "pending", mult: 0 },
    { key: "flow", role: "expert", trained: true, featVerOk: true, tier: "provisional", mult: 0.6 },
    { key: "xalpha", role: "expert", trained: true, featVerOk: true, tier: "provisional", mult: 0.25 },
    { key: "memo", role: "expert", trained: true, featVerOk: true, tier: "reject", mult: 0 },
    { key: "seq", role: "expert", trained: true, featVerOk: true, tier: "provisional", mult: 0.17 },
    { key: "rule", role: "prior", trained: true, featVerOk: true, tier: "full", mult: 1 },
    { key: "stack", role: "combiner", trained: true, featVerOk: true, tier: "provisional", mult: 0.4 },
    { key: "dual_bull", role: "quadrant", trained: true, featVerOk: true, tier: "provisional", mult: 0.25 },
    { key: "dual_bear", role: "quadrant", trained: true, featVerOk: true, tier: "reject", mult: 0 },
    { key: "dual", role: "quadrant", trained: true, featVerOk: true, tier: "full", mult: 1 }
  ];
  const SEATS = { chair: 1, expert: 1 };
  const roster = raw.map((e) => Object.assign({}, e, { seat: !!SEATS[e.role], state: M.rosterCls(e) }));
  const tallySrv = M.rosterTally(roster);

  const keys = roster.map((e) => e.key);
  const harness = `
    var window = {};
    ${lux[0]}
    var LUXR = window.LUXR;
    ${cmcls[0]}
    ${cmst}
    var DOTS = ${JSON.stringify(keys.concat(["dualbull", "dualbear", "boost"]))};
    var painted = {};
    var document = { querySelectorAll: function(){
      return DOTS.map(function(k){
        return { getAttribute: function(){ return k; },
                 set className(v){ painted[k] = v.replace('nnv-tab-dot','').trim(); },
                 parentNode: { setAttribute: function(){} } };
      });
    } };
    ${pdots}
    LUXR.set(${JSON.stringify(roster)}, 'test');
    NNV_paintDots({ roster: ${JSON.stringify(roster)} });
    var out = { dot:{}, cm:{}, map:painted, tally: LUXR.tally() };
    ${JSON.stringify(keys)}.forEach(function(k){
      out.dot[k] = LUXR.state(k);
      out.cm[k] = cmState(k, {});
    });
    out;
  `;
  const R = new vm.Script(harness, { filename: "roster-parity" })
    .runInNewContext({ Date, Math, JSON, Number, String, Object, Array, isNaN, parseInt, parseFloat, console });

  const CMCLS = { on: "ok", prov: "prov", bad: "warn", off: "off" };
  let mismatch = [];
  for (const e of roster) {
    if (R.dot[e.key] !== e.state) mismatch.push(`${e.key}: 불 ${R.dot[e.key]} ≠ 명부 ${e.state}`);
    if (R.map[e.key] !== e.state) mismatch.push(`${e.key}: 지도 ${R.map[e.key]} ≠ 명부 ${e.state}`);
    if (R.cm[e.key].cls !== CMCLS[e.state]) mismatch.push(`${e.key}: 사이드바 ${R.cm[e.key].cls} ≠ 명부 ${e.state}`);
  }
  console.log("       " + roster.map((e) => e.key + "=" + e.state).join(" · "));
  chk(mismatch.length === 0,
    `위원 ${roster.length}명 전부 — 사이드바·신경망 지도·불이 ${"명부와 글자 하나까지 같다"}`,
    "★갈라졌다: " + mismatch.join(" / ") + "★");

  /* 잠정(prov)이 ★어느 화면에서도 켜져 있어야★ 한다 — 사용자가 본 사고가 정확히
     "잠정인데 한쪽만 ●" 였다. 등급이 실제로 표본에 들어 있는지도 함께 확인한다. */
  const provs = roster.filter((e) => e.state === "prov").map((e) => e.key);
  chk(provs.length >= 3, `잠정 등급이 ${provs.length}명 들어 있다(${provs.join(",")}) — 그 사고를 재현할 표본이다`,
    "잠정 등급이 표본에 없다 — 이 검사가 그 사고를 못 잡는다");
  chk(provs.every((k) => R.dot[k] === "prov" && R.map[k] === "prov" && R.cm[k].cls === "prov"),
    "잠정 위원은 세 화면 모두에서 잠정이다(한쪽만 ● 이던 그 상태가 불가능해졌다)",
    "★잠정 위원이 화면마다 다르게 보인다★");

  chk(R.tally.seats === tallySrv.seats && R.tally.on === tallySrv.on && R.tally.live === tallySrv.live,
    `좌석 집계가 서버와 같다 (${R.tally.on}+${R.tally.prov} / ${R.tally.seats})`,
    `★인원수가 서버(${tallySrv.on}/${tallySrv.seats})와 화면(${R.tally.on}/${R.tally.seats})에서 다르다★`);
  chk(R.map.dualbull === R.dot.dual_bull && R.map.dualbear === R.dot.dual_bear,
    `탭 철자(dualbull/dualbear)도 같은 명부 항목을 가리킨다 (${R.map.dualbull}/${R.map.dualbear})`,
    "탭 철자 별칭이 다른 값을 가리킨다");
  chk(R.map.boost === "on", "부스터 묶음 점은 셋 중 가장 밝은 상태를 따른다(XGB 가동 → boost 가동)",
    "부스터 묶음 점이 개별 부스터와 어긋난다");
}

console.log("\n④ 변이 시험 — 갈라진 술어를 다시 넣으면 이 검사가 실패하는가");
{
  const muts = [
    ["ico('seq')", "ico(true)", "SEQ 행에 불리언 불을 되돌린다"],
    ["var E = LUXR.get(key), ST = LUXR.state(key);", "var E = o.admit, ST = (E && E.tier === 'full') ? true : null;\n      var _z = m && m.admit && m.admit.admit;", "사이드바가 admit 을 다시 읽는다"]
  ];
  for (const [from, to, why] of muts) {
    if (!HV.includes(from)) { console.log("  FAIL 변이 대상을 못 찾는다: " + from); fails++; continue; }
    const caught = scan(HV.replace(from, to)).length > 0;
    chk(caught, `변이를 잡는다 — ${why}`, `★${why} 를 넣어도 검사가 통과한다 — 이 검사는 헛돈다★`);
  }
  const pdMut = fnBody(HV.replace("(d.roster||[]).forEach", "(d.experts||[]).forEach"), "function NNV_paintDots(d)");
  chk(pdMut.includes("d.experts"),
    "지도가 experts[] 로 돌아가면 ②의 구조 검사가 잡는다",
    "지도 구조 검사가 변이를 못 잡는다");
}

console.log(fails === 0 ? "\n✓ 명부 단일출처 검사 통과 — 두 화면이 갈라질 자리가 없다"
                        : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
