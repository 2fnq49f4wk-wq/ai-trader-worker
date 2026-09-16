/* [V33.374] 피처 생존 계약 — ★선언 없이 조용히 죽은 피처를 잡는다★
 *
 *   ★왜 필요한가★ 기존 `check-live-only-feats` 는 ★선언된 목록(_LIVE_ONLY_FEATS)이
 *   6개인지★ 만 본다. 즉 "죽이기로 한 칸"은 지키지만, ★죽이기로 한 적 없는데 데이터가
 *   끊겨 상수가 된 칸★ 은 못 본다. 이 저장소가 F-2 에서 당한 것이 정확히 그 유형이다 —
 *   `mcap_shares` 를 존재한 적 없는 키로 읽어 `XR_FLOW` 가 V33.250 이래 0건 발동했고,
 *   아무 게이트도 울지 않았다. 피처는 조용히 죽는다.
 *
 *   ★운영과 같은 모양의 인자로 흔든다.★ 맥락(idxCloses·sectorCloses·xsPanel·obsTs)을
 *   안 넘기면 섹터·횡단면·달력 피처가 당연히 상수로 나와 ★게이트가 거짓 경보★ 를 낸다.
 *   (실제로 첫 감사에서 그렇게 나왔고, 호출부를 읽고서야 내 하네스 탓임을 알았다.)
 */
import { LUXML, mlBuildFeatures, _LIVE_ONLY_FEATS } from "../src/index.js";
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.log("  ✗ FAIL " + m); } };

const names = LUXML.featNames;
ok(names.length > 40, `featVer ${LUXML.featVer} · 피처 ${names.length}칸을 읽었다`);

/* 상수로 나와도 괜찮은 칸 — ★이유를 적는다.★ 이유 없이 목록에 넣지 않는다. */
const ALLOWED = {};
for (const nm of _LIVE_ONLY_FEATS) ALLOWED[nm] = "라이브 전용 — 수확이 만들 수 없어 의도적으로 중립화(V33.341·P-1)";
/* ★유효성 플래그는 '변하지 않는 것' 이 정상이다.★ fomcKnown 은 "이 달력값을 믿어도 되는가"
   를 말하는 칸이라, 표 안에서는 언제나 1 이어야 한다. 그러니 상수인 것은 건강함의 표시다 —
   ★다만 상수 0 이면 그때가 이상이다★(표가 만료돼 피처 셋이 통째로 죽은 것이다).
   그래서 여기서는 "변해야 한다" 가 아니라 ★"1 로 굳어 있어야 한다"★ 를 본다. */
ALLOWED.fomcKnown = "유효성 플래그 — 표 안에서는 항상 1 이 정상(아래에서 1 인지 따로 본다)";

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const ser = (n_, f) => Array.from({ length: n_ }, (_, i) => f(i));

/* ★운영 호출부(src/index.js 의 signal.mlFeat 자리)와 같은 인자 모양★ */
function makeCase(k) {
  const L = 260 + Math.floor(rnd() * 40);
  const drift = (rnd() - 0.5) * 0.5, vol = 0.5 + rnd() * 5;
  const closes = ser(L, (i) => 50 + i * drift + Math.sin(i / (3 + rnd() * 9)) * vol + rnd() * vol);
  // 지수도 종목만큼 흔들어야 한다 — 너무 매끄러우면 상대변동성이 상한에 붙어 상수가 된다
  const idxCloses = ser(L, (i) => 3000 + i * drift * 20 + Math.sin(i / (4 + rnd() * 7)) * vol * 40 + rnd() * vol * 30);
  const sectorCloses = ser(L, (i) => 100 + i * drift * 0.8 + Math.sin(i / 6) * vol * 0.6 + rnd() * vol);
  return {
    closes, idxCloses, sectorCloses,
    volumes: ser(L, () => 1e5 + rnd() * 9e6),
    opens: closes.map((c) => c * (0.97 + rnd() * 0.06)),
    highs: closes.map((c) => c * (1 + rnd() * 0.05)),
    lows: closes.map((c) => c * (1 - rnd() * 0.05)),
    xsPanel: { data: [{ r20: { m: (rnd() - 0.5) * 8, s: 1 + rnd() * 6 },
                        r5:  { m: (rnd() - 0.5) * 4, s: 1 + rnd() * 3 } }] },
    barsAgo: 0,
    price: closes[closes.length - 1] * (0.9 + rnd() * 0.2),
    prevClose: closes[closes.length - 2],
    dayPct: (rnd() - 0.5) * 12,
    regime: ["BULL", "BEAR", "NEUTRAL"][k % 3],
    market: ["us", "kr", "cm"][k % 3],
    strategy: ["trend", "scalp", "snap", "swing"][k % 4],
    sigWeight: rnd() * 3, confluence: Math.floor(rnd() * 5),
    ev: {},
    // ★달력 피처는 obsTs 에서 나온다★ — 안 넘기면 전부 0 이 되어 '죽은 칸' 으로 오인된다
    obsTs: Date.UTC(2026, k % 12, 1 + (k * 7) % 27, 14, 30),
  };
}

const rows = [];
for (let k = 0; k < 120; k++) { try { const r = mlBuildFeatures(makeCase(k)); if (r) rows.push(r); } catch (e) {} }
ok(rows.length >= 100, `운영 모양 인자로 표본 ${rows.length}/120 을 만들었다`);

const val = (r, i) => (Array.isArray(r) ? r[i] : r[names[i]]);
const constant = [], nonFinite = [];
names.forEach((nm, i) => {
  const vs = rows.map((r) => val(r, i));
  if (vs.some((v) => typeof v !== "number" || !isFinite(v))) nonFinite.push(nm);
  if (new Set(vs.map((v) => (typeof v === "number" ? v.toFixed(6) : String(v)))).size === 1) constant.push(nm);
});

console.log(`\n  — 인자를 ${rows.length}가지로 흔든 결과 —`);
console.log(`     값이 한 번도 안 변한 칸 ${constant.length}개 / ${names.length}칸`);
const unexpected = constant.filter((nm) => !(nm in ALLOWED));
for (const nm of constant) console.log(`       ${nm}${ALLOWED[nm] ? "  (" + ALLOWED[nm].slice(0, 28) + "…)" : "   ★예상 밖★"}`);

ok(nonFinite.length === 0,
   nonFinite.length ? `★NaN/Infinity 가 나오는 칸 ${nonFinite.length}개: ${nonFinite.join(", ")}★ — 표준화가 통째로 망가진다`
                    : "NaN·Infinity 를 내는 칸이 없다");
ok(unexpected.length === 0,
   unexpected.length ? `★선언 없이 죽은 피처 ${unexpected.length}칸: ${unexpected.join(", ")}★ — 데이터가 끊겼거나 배선이 빠졌다(F-2 유형)`
                     : `상수인 칸이 ${constant.length}개뿐이고 전부 ★이유가 적힌 것★ 이다`);

/* 유효성 플래그가 ★1 로★ 굳어 있는지 — 0 으로 굳었다면 달력 피처 셋이 죽은 것이다 */
{
  const i = names.indexOf("fomcKnown");
  const vs = rows.map((r) => val(r, i));
  const allOne = vs.every((v) => v === 1);
  ok(allOne, allOne ? "fomcKnown 이 전부 1 — 달력 표가 살아 있고 세 피처가 믿을 값이다"
                    : `★fomcKnown 이 0 으로 굳었다★ — FOMC 표가 만료돼 opex·fomc 피처가 죽었다`);
}

/* ★자가시험 — 이 검사가 정말 죽은 칸을 잡는가.★
   하네스가 헛돌면 "상수 0개" 라는 초록불이 거짓이 된다(그게 F-2 가 8일간 숨은 방식이다). */
{
  const alive = names.filter((nm) => !constant.includes(nm));
  ok(alive.length > names.length * 0.6,
     `살아 있는 칸이 ${alive.length}/${names.length} — 하네스가 실제로 피처를 흔들고 있다(전부 상수면 하네스 고장이다)`);
  // 일부러 죽은 칸 하나를 섞어 잡히는지 본다
  const fake = rows.map((r) => (Array.isArray(r) ? r.concat([42]) : Object.assign({}, r, { __dead: 42 })));
  const vs = fake.map((r) => (Array.isArray(r) ? r[r.length - 1] : r.__dead));
  ok(new Set(vs).size === 1, "자가시험: 일부러 심은 상수 칸은 상수로 판정된다");
}

console.log(fail ? `\n✗ 피처 생존 계약 ${fail}건 실패 (총 ${n})` : `\n✓ 피처 생존 계약 통과 (${n}개 단언)`);
process.exit(fail ? 1 : 0);
