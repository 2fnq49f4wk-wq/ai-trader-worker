// [V33.151] 증권사 목표가 개정(상향/하향) 계약.
//
//   ★왜 이 기능이 필요했나★ 종전에도 목표가는 받고 있었지만 쓰는 값은 upsidePct(상승여력)
//   ★수준★ 뿐이었다. 그런데 upsidePct = (목표가−주가)/주가 라서 ★주가가 움직이기만 해도 변한다★ —
//   증권사가 아무것도 안 했는데 숫자가 바뀐다. "증권사가 생각을 바꿨나" 는 목표가 자체를
//   시점 간 비교해야만 나온다. 이 게이트가 지키는 건 그 구분이다.
//
//   ★부호 규약★ averageAnalystRating 은 1=Strong Buy … 5=Sell 이라 ★값이 내려가면 상향★ 이다.
//   한 번만 뒤집고 그 뒤로는 만지지 않는다 — 두 번 뒤집으면 의미가 정반대가 되고,
//   그런 실수는 화면에서 티가 안 난다(그저 반대로 매매할 뿐이다).
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const grabFn = (name) => {
  let i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("함수를 못 찾았다: " + name);
  if (src.slice(i - 6, i) === "async ") i -= 6;
  let d = 0;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error("함수 끝을 못 찾았다: " + name);
};
const grabConst = (name) => {
  const i = src.indexOf("const " + name + " = {");
  if (i < 0) throw new Error("상수를 못 찾았다: " + name);
  return src.slice(i, src.indexOf("\n};", i) + 3);
};

const M = new vm.Script(`
function _num(v,d){ var n=Number(v); return isFinite(n)?n:d; }
function _clamp(v,a,b){ return v<a?a:(v>b?b:v); }
var STORE={};
async function getState(DB,k,d){ return (k in STORE)?STORE[k]:d; }
async function setState(DB,k,v){ STORE[k]=JSON.parse(JSON.stringify(v)); }
${grabConst("ANALYSTREV")}
${grabFn("analystRevScore")}
${grabFn("analystRevTrack")}
({ track: analystRevTrack, score: analystRevScore, cfg: ANALYSTREV, store: function(){ return STORE; } });
`).runInNewContext({ Math, Number, Array, isFinite, Date, JSON, Object, Promise });

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };
const chk = (c, good, ng) => c ? ok(good) : bad(ng);

// ── ① 점수의 방향과 포화 ──────────────────────────────────────────────────
chk(M.score(null) === null && M.score({ ev: [] }) === null,
  "근거가 없으면 null — 0(중립)이 아니라 '모른다' 다(0 은 팩터에 실린다)",
  "빈 입력이 0 을 돌려준다 — 근거 없는 중립이 실제 표로 들어간다");
chk(M.score({ ev: [{ t: 1, p: 3 }] }).score > 0 && M.score({ ev: [{ t: 1, p: -3 }] }).score < 0,
  "상향은 양수, 하향은 음수", "개정 방향과 점수 부호가 어긋난다");
{
  const steady = M.score({ ev: [{ t: 1, p: 2 }, { t: 2, p: 2 }, { t: 3, p: 2 }] }).score;
  const oneBig = M.score({ ev: [{ t: 1, p: 6 }] }).score;
  chk(steady > oneBig,
    `일관성을 크기보다 높게 본다(꾸준한 +2%×3 ${steady.toFixed(2)} > 한 번 +6% ${oneBig.toFixed(2)})`,
    "한 번 크게 올린 것이 꾸준한 상향보다 높게 평가된다 — 이상치 한 건이 지배한다");
  const mixed = M.score({ ev: [{ t: 1, p: 3 }, { t: 2, p: -3 }] }).score;
  chk(Math.abs(mixed) < 0.05, "상향·하향이 상쇄되면 0 근처", `혼조가 ${mixed} — 상쇄되지 않는다`);
  for (const p of [50, 200, -50, -200]) {
    const s = M.score({ ev: [{ t: 1, p: p }] }).score;
    if (!(s >= -1 && s <= 1)) bad(`극단 개정 ${p}% 에서 점수 ${s} — [-1,1] 을 벗어난다`);
  }
  ok("극단 개정(±200%)에서도 점수가 [-1,1] 안에 포화한다");
}

// ── ② ★부호 규약★ 등급은 낮을수록 좋다 ───────────────────────────────────
await (async () => {
  await M.track(null, null, { X: { tgt: 100, rating: 2.5, nOpinions: 20 } });          // 기준선
  await M.track(null, { X: { tgt: 100, rating: 2.5 } }, { X: { tgt: 100, rating: 1.5, nOpinions: 20 } });
  const up = M.store()["analyst_rev"].bySym.X;
  chk(up.dRating > 0 && M.score(up).score > 0,
    "등급 2.5→1.5(=상향)이 dRating 양수·점수 양수로 이어진다",
    `등급 상향이 음수로 기록된다(dRating ${up.dRating}) — 매매가 정반대로 간다`);
  await M.track(null, { Y: { tgt: 100, rating: 1.5 } }, { Y: { tgt: 100, rating: 3.0, nOpinions: 20 } });
  const dn = M.store()["analyst_rev"].bySym.Y;
  chk(dn.dRating < 0 && M.score(dn).score < 0,
    "등급 1.5→3.0(=하향)이 dRating 음수·점수 음수로 이어진다",
    `등급 하향이 양수로 기록된다(dRating ${dn.dRating})`);
})();

// ── ③ ★가격 독립성★ — 이 기능의 존재 이유 ────────────────────────────────
await (async () => {
  await M.track(null, { P: { tgt: 100, px: 50 } }, { P: { tgt: 100, px: 95, nOpinions: 20 } });
  const rec = M.store()["analyst_rev"].bySym.P;
  chk(!(rec.ev || []).length,
    "★주가가 90% 올라도 목표가가 그대로면 개정 0건★ — upsidePct 라면 여기서 크게 움직인다",
    "주가 변동만으로 개정 사건이 생긴다 — 수준과 개정을 구분하지 못한다");
})();

// ── ④ 데드밴드와 상태 크기 방어 ───────────────────────────────────────────
await (async () => {
  const db = M.cfg.deadbandPct;
  await M.track(null, { D: { tgt: 100 } }, { D: { tgt: 100 * (1 + (db * 0.9) / 100), nOpinions: 20 } });
  const under = ((M.store()["analyst_rev"].bySym.D || {}).ev || []).length;
  await M.track(null, { E: { tgt: 100 } }, { E: { tgt: 100 * (1 + (db * 1.5) / 100), nOpinions: 20 } });
  const over = ((M.store()["analyst_rev"].bySym.E || {}).ev || []).length;
  chk(under === 0 && over === 1,
    `데드밴드 ${db}% — 미만은 무시, 초과는 기록(반올림·환산 잡음이 사건으로 새지 않는다)`,
    `데드밴드가 동작하지 않는다(미만 ${under}건, 초과 ${over}건)`);
  for (let i = 0; i < 20; i++) {
    await M.track(null, { Z: { tgt: 100 + i * 10 } }, { Z: { tgt: 100 + (i + 1) * 10, nOpinions: 20 } });
  }
  const n = M.store()["analyst_rev"].bySym.Z.ev.length;
  chk(n <= M.cfg.maxEvents, `종목당 사건 보관 상한 ${M.cfg.maxEvents}건 (상태가 무한히 자라지 않는다) — 실제 ${n}건`,
    `사건이 ${n}건까지 쌓였다 — 상태 크기가 종목수×시간으로 폭발한다`);
})();

// ── ⑤ 사건에 '그 시점 점수' 가 박혀 있어야 계수 실측이 정직하다 ─────────────
await (async () => {
  await M.track(null, { S: { tgt: 100 } }, { S: { tgt: 110, nOpinions: 20 } });
  const ev = M.store()["analyst_rev"].bySym.S.ev;
  chk(ev.length && typeof ev[ev.length - 1].s === "number",
    "사건마다 그 시점 점수(s)를 남긴다 — 점수는 90일 창 전체로 계산돼 사후 재현이 불가능하다",
    "사건에 점수가 없다 — 계수 실측이 '지금 창' 으로 과거를 채점하게 되어 미래를 보는 셈이 된다");
})();

// ── ⑥ 소스 계약 — 계수는 상수가 아니라 실측이어야 한다 ─────────────────────
chk(/_coefShrink\(tval\)/.test(src.slice(src.indexOf("async function analystRevFitNightly"), src.indexOf("async function updateAnalystConsensus"))),
  "계수를 유의성으로 수축한다(유의하지 않으면 0) — 다른 계수들과 같은 원칙",
  "계수에 유의성 수축이 없다 — 잡음이 그대로 매매에 실린다");
chk(/const _kEff = _rk \? _num\(_rk\.kEff, 0\) : 0;[\s\S]{0,200}?if \(_kEff !== 0/.test(src),
  "미측정(kEff 0)이면 팩터를 아예 싣지 않는다 — 근거 없이 밀지 않는다",
  "미측정 상태에서도 팩터가 실린다 — 손으로 정한 상수와 다를 바 없다");
chk(/o\.tgt = \+tgt\.toFixed\(4\);/.test(src),
  "목표가 절대값을 저장한다 — upsidePct 만으로는 개정을 잴 수 없다",
  "목표가 절대값을 저장하지 않는다 — 주가 변동과 개정을 구분할 수 없다");

console.log(fails ? "\n목표가 개정 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   목표가 개정 계약 통과");
process.exit(fails ? 1 : 0);
