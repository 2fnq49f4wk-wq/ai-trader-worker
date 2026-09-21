/* ═══════════════════════════════════════════════════════════════════════════
   [V33.406] 신규 위원이 전진검증을 ★구조적으로★ 못 모으고 있었다

   ■ 화면 실측 (2026-09-22 08:09 · 위원회 6/10)
       FLOW   합류 보류 · 홀드아웃 t −0.59 · 전진 표본 ★0/400★ · 고른 행 ★0★ < 배치하한 30
       XALPHA 합류 보류 · 홀드아웃 t −0.89 · 전진 표본 ★0/400★ · 고른 행 ★0★
       STACK  합류 보류 · 전진 0/400 · (기준 관측시각 2026-09-17 이후 · ★과거표본 3000건 제외★)
       MEMO   전진 표본 16,086/400        ← ml_samples 를 ★직접★ 읽는 쪽은 찬다
     STACK 의 "과거표본 3000건 제외" 가 결정적이다 — ★행은 만들어지는데 전부 과거★ 다.

   ■ 원인 (문턱이 아니라 생산 구조)
     전진검증 조건: `id > 체크포인트 AND ★ts > 학습셋 최대 관측시각★` (icForwardCheck).
     그런데 altSampleBackfill 은 원본 ml_samples 행의 ★과거 봉 날짜★ 를 물려준다
     (V33.173 이 퍼징을 고치려고 의도적으로 그렇게 했고, 그 고침 자체는 옳다).
     두 규칙이 만나면 ★새 표본의 ts 가 언제나 과거★ 라 전진창을 영원히 못 채운다.
     신선한 ts 를 내는 경로는 실거래 청산뿐인데 전 시스템 통틀어 ★68건★ 이다.

   ■ 고침 — 소급 커서(과거)와 프런티어(최근)를 경계 하나로 가른다
     · 프런티어: 최근 frontierDays 일, 자기 ts 워터마크로 새 행만. 수확이 매일 붙이는
       프런티어 봉이 곧바로 표본이 되어 ★ts 가 신선하다.★
     · 과거 커서: `ts < 경계` 만 본다 → 두 경로가 겹치지 않아 같은 행을 두 번 안 만든다.

   ■ 이 검사가 무는 것 (전부 조용히 망가지는 길)
     ① 프런티어 행이 과거 커서(lastId)를 올리면 ★안 만든 과거 행을 건너뛴다★(영구 손실).
        ml_samples 의 id 는 ts 순이 아니다 — 캐치업이 옛 봉을 나중에 적재한다.
     ② 프런티어를 id 커서로 거르면 최근 행의 id 가 이미 커서 아래일 때 조용히 안 만들어진다.
     ③ 과거 날짜가 예산을 먼저 먹으면 프런티어가 또 굶는다(지금 상태를 만든 구조).
     ④ 워터마크를 행 단위로 올리면 잘린 날의 잔여 행이 영영 안 만들어진다.
     ⑤ frontierMax 가 하루치보다 작으면 워터마크가 영원히 안 올라 ★교착★ 이 된다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const body = (name) => {
  const i = S.indexOf("async function " + name);
  if (i < 0) return "";
  let d = 0, k = S.indexOf("{", i), e = k;
  for (; e < S.length; e++) { const c = S[e]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
  return S.slice(k, e + 1);
};
const B = body("altSampleBackfill");
chk(B.length > 3000, "altSampleBackfill 본문 " + B.length + "자", "본문 추출이 깨졌다");

console.log("\n① 프런티어가 존재하고 ★자기 워터마크★ 로 도는가");
chk(/WHERE featver = \? AND ts > \? ORDER BY ts ASC LIMIT \?/.test(B),
  "최근 구간을 ★ts 워터마크★ 로 질의한다(id 커서가 아니다)",
  "★프런티어 질의가 없다 — 신선한 ts 표본이 안 생기고 전진검증은 영원히 0 이다★");
chk(/const _frFrom = Date\.now\(\) - Math\.max\(1, _num\(ALTBF\.frontierDays/.test(B),
  "경계가 '지금 − frontierDays' 로 정해진다", "경계가 없다");
chk(/fwdTs: _fwdTs,/.test(B), "워터마크를 상태에 저장한다", "★워터마크를 저장 안 한다 — 매 회차 같은 행을 다시 만든다★");

console.log("\n② ★과거 커서가 프런티어 구간을 건드리지 않는가★ (중복 생성 금지)");
chk(/WHERE id > \? AND featver = \? AND ts < \? ORDER BY id ASC LIMIT \?/.test(B),
  "과거 커서는 `ts < 경계` 만 본다 — 소유권이 갈린다",
  "★과거 커서가 프런티어 구간까지 본다 — 같은 행이 두 벌 만들어진다★");

console.log("\n③ ★프런티어 행이 과거 커서를 올리지 않는가★ (영구 손실 금지)");
chk(/if \(r\._fr\) \{ _frTsSeen = Math\.max\(_frTsSeen, _num\(r\.ts, 0\)\); \}\s*\n\s*else lastId = Math\.max\(lastId, r\.id\);/.test(B),
  "프런티어 행은 lastId 를 ★안 올린다★ — id 가 ts 순이 아니므로 올리면 과거 행을 건너뛴다",
  "★프런티어 행이 lastId 를 올린다 — 아직 안 만든 과거 행이 통째로 사라진다★");
chk(/for \(const r of _frRows\) \{ r\._fr = 1;/.test(B), "프런티어 행에 표식을 단다", "표식이 없다");

console.log("\n④ 프런티어가 id 커서에 막히지 않는가");
chk(/if \(XALPHA\.enabled && \(r\._fr \|\| _num\(r\.id, 0\) > xDone\)\)/.test(B),
  "XALPHA: 프런티어는 id 커서를 우회한다(자기 워터마크로 중복을 막는다)",
  "★프런티어가 id 커서에 걸린다 — 최근 행의 id 가 커서 아래면 조용히 안 만들어진다★");
chk(/if \(FLOWML\.enabled && \(r\._fr \|\| _num\(r\.id, 0\) > fDone\)\)/.test(B),
  "FLOW: 같은 우회", "★FLOW 가 id 커서에 걸린다★");

console.log("\n⑤ ★프런티어가 예산을 먼저 받는가★ (과거가 다 먹으면 지금 상태 그대로다)");
{
  const iFr = B.indexOf("const _frList = Object.keys(byDay).filter");
  const iAll = B.indexOf("const _daysAll = _frList.slice(0, _frCap).concat(_hiList);");
  chk(iFr > 0 && iAll > iFr, "프런티어 날짜를 앞에 세우고 과거를 뒤에 붙인다",
    "★날짜를 오래된 순으로만 세운다 — 과거가 예산을 다 먹는다★");
  chk(/_frCap = Math\.max\(1, Math\.min\(_num\(ALTBF\.frontierDateCap, 3\), _bDates\)\)/.test(B),
    "프런티어에도 상한이 있다 — 과거 소급이 굶지 않는다",
    "★프런티어 상한이 없다 — 이번엔 과거가 영영 안 돈다(반대 방향 고장)★");
}

console.log("\n⑥ ★워터마크를 날짜 경계로 올리는가★ · 교착을 말하는가");
chk(/const _dEnd = Date\.parse\(_lastDay \+ "T00:00:00Z"\) \+ 86400000 - 1;/.test(B),
  "워터마크를 ★날짜 끝★ 으로 올린다 — 잘린 날의 잔여 행을 잃지 않는다",
  "★행 단위로 올린다 — 같은 날짜의 나머지 행이 영영 안 만들어진다★");
chk(/_truncated \? [\s\S]{0,120}_frList\[_frList\.length - 1\]/.test(B) || /!_truncated \|\| k !== _frList\[_frList\.length - 1\]/.test(B),
  "질의가 잘렸으면 마지막 날짜는 미완으로 보고 올리지 않는다",
  "★잘렸는데도 마지막 날짜를 완결로 읽는다 — 그 날의 나머지를 잃는다★");
chk(/_fwdStuck/.test(B) && /프런티어 워터마크 정지/.test(B),
  "완결 날짜가 하나도 없으면 ★교착이라고 소리내어 말한다★",
  "★교착을 조용히 돈다 — V33.187 이 과거 커서에서 배운 것과 같은 사고다★");
{
  const cap = M.ALTBF ? M.ALTBF.frontierMax : null;
  chk(cap != null && cap >= 4000,
    "frontierMax " + cap + " ≥ 4000 — 하루치(유니버스 ~1,040종목)보다 넉넉해 교착이 안 난다",
    "★frontierMax 가 하루치보다 작을 수 있다(" + cap + ") — 워터마크가 영원히 안 오른다★");
}

console.log("\n⑦ 생산량을 ★프런티어 몫으로 따로★ 보고하는가 (0 이면 신규 위원은 영원히 보류다)");
chk(/★프런티어 XALPHA \+" \+ _frMadeX \+ " \/ FLOW \+" \+ _frMadeF/.test(B),
  "프런티어가 만든 수를 따로 적는다 — 전진검증을 채우는 것은 이 숫자뿐이다",
  "★전체 생산량만 적는다 — 그 중 몇 건이 신선한 ts 인지 알 수 없다★");
for (const k of ["_frMadeX++", "_frMadeF++"])
  if (B.indexOf(k) < 0) { console.log("  FAIL ★" + k + " 로 세는 곳이 없다 — 로그가 영원히 0 을 찍는다★"); fails++; }
console.log("  ok   프런티어 생산량을 ★세고 또 적는다★");

console.log(fails === 0 ? "\n✓ 프런티어 소급 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
