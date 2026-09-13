/* [V33.350 · A-10] 한국 시간외 값이 ★지난 세션 것이 살아남아★ 오늘 값인 척했다
 *
 *   배치 기록부의 마스크가 이랬다:
 *       const _mask = (market === "us") ? extKeepMaskUS(...) : { pre: true, post: true };
 *   즉 ★한국은 무엇도 지우지 않았다.★ 그런데 applyKrOverMarket 은 시간외 체결이 없으면
 *   mstate 만 PRE/POST 로 찍고 값은 안 넣는다(정상 — 없는 체결을 지어내지 않는다).
 *   그러면 SQL 의 COALESCE 가 ★어제 그 세션의 값★ 을 살려 둔다:
 *       오늘 08:10 KST, 아직 장전 체결 없음 → mstate=PRE · pre = 어제 08시대 가격
 *       화면(public/index.html:9726)은 mstate==='PRE' && pre>0 이면 "장전" 으로 표시한다
 *   V33.339 가 미국에서 고친 것과 같은 결함이고, 한국만 안 고쳐져 있었다.
 *   COALESCE 는 "새 값이 아직 안 왔다" 는 뜻이지 "지난 세션 값을 써라" 가 아니다.
 *
 *   문자열 검사로는 지킬 수 없다(V33.337 교훈) — ★시각을 넣어 함수를 실제로 불러★
 *   세션 판정과 마스크를 확인하고, 마스크로 COALESCE 를 재현해 하루를 돌려 본다.
 *
 *   ※ 정직하게: 이 마스크는 ★세션이 바뀔 때 지우는★ 방식이다. 정규장에 시세 기록이
 *     한 번이라도 돌면 지난 세션 값이 정리된다(그게 정상 운영이다). 워커가 하루 종일
 *     멈춰 있다가 다음 장전에 깨어나는 경우까지 막지는 못한다 — 그 경우는 extTs 신선도
 *     가드(거래)와 A-7(표시 나이)이 맡는 몫이다.
 */
import { krMarketStateNow, extKeepMaskKR, extKeepMaskUS, usMarketStateNow, extKeepMaskFor } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

// KST = UTC+9 (서머타임 없음). 2026-09-14 는 월요일, 09-12 는 토요일.
const KST = (d, h, m) => new Date(Date.UTC(2026, 8, d, h - 9, m));

for (const [d, h, m, want] of [
  [14, 7, 30, "CLOSED"], [14, 8, 0, "PRE"], [14, 8, 59, "PRE"],
  [14, 9, 0, "REGULAR"], [14, 15, 29, "REGULAR"],
  [14, 15, 30, "POST"], [14, 19, 59, "POST"], [14, 20, 0, "CLOSED"],
  [12, 11, 0, "CLOSED"],   // 토요일은 정규장 시각이어도 휴장
]) {
  const got = krMarketStateNow(KST(d, h, m));
  ok(got === want, `KST 09-${d} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} → ${got} (기대 ${want})`);
}

// 마스크: pre 는 장전 동안만, post 는 장후와 그 뒤 휴장 동안
const M = (s) => extKeepMaskKR(s);
ok(M("PRE").pre && !M("PRE").post, "PRE: pre 유지 · post 제거(어제 장후가 남으면 안 된다)");
ok(!M("REGULAR").pre && !M("REGULAR").post, "REGULAR: 둘 다 제거(정규장 중 시간외 값은 지난 것이다)");
ok(!M("POST").pre && M("POST").post, "POST: post 유지 · pre 제거(오늘 아침 장전가가 남으면 안 된다)");
ok(!M("CLOSED").pre && M("CLOSED").post, "CLOSED: post 유지(그날 마지막 체결가) · pre 제거");

// 미국과 같은 규칙인가 — 두 시장이 같은 화면에서 다른 규칙으로 말하면 안 된다
for (const st of ["PRE", "REGULAR", "POST", "CLOSED"]) {
  const a = extKeepMaskKR(st), b = extKeepMaskUS(st);
  ok(a.pre === b.pre && a.post === b.post, `${st}: 한국·미국 마스크가 같다 (pre ${a.pre}/${b.pre} · post ${a.post}/${b.post})`);
}

/* ★핵심★ 마스크로 SQL 의 COALESCE 를 재현해, 잔상이 실제로 지워지는지 본다.
   워커 SQL: post = CASE WHEN clrPost=1 THEN NULL ELSE COALESCE(새값, 기존값) END */
function writeQuote(stored, incoming, mask) {
  const clrPre = mask.pre ? 0 : 1, clrPost = mask.post ? 0 : 1;
  return {
    pre: clrPre ? null : (incoming.pre != null ? incoming.pre : stored.pre),
    post: clrPost ? null : (incoming.post != null ? incoming.post : stored.post)
  };
}
const 체결없음 = { pre: null, post: null };   // applyKrOverMarket 이 값 없이 mstate 만 찍은 경우

/* 하루를 실제로 돌려 본다 — 마스크는 ★세션이 바뀔 때 지우는 것★ 이라, 한 시점만 봐서는
   효과가 안 보인다. 어제 장전에 체결이 있었고 오늘 아침엔 아직 없는 상황을 재현한다. */
function 하루(mask) {
  let q = { pre: null, post: null };
  q = writeQuote(q, { pre: 71000, post: null }, mask("PRE"));       // 어제 08:30 장전 체결
  q = writeQuote(q, 체결없음, mask("REGULAR"));                      // 어제 정규장
  q = writeQuote(q, { pre: null, post: 70500 }, mask("POST"));      // 어제 16:00 장후 체결
  q = writeQuote(q, 체결없음, mask("CLOSED"));                       // 어제 밤
  const 밤 = { ...q };
  q = writeQuote(q, 체결없음, mask("PRE"));                          // ★오늘 08:10 — 아직 체결 없음★
  return { 밤: 밤, 오늘아침: q };
}
const 새것 = 하루(extKeepMaskKR);
const 옛것 = 하루(() => ({ pre: true, post: true }));   // 종전 한국 마스크

ok(새것.밤.post === 70500 && 새것.밤.pre === null,
   `어제 밤: 장후 ${새것.밤.post} 는 남고 아침 장전가는 지워져 있다(미국과 같다)`);
ok(새것.오늘아침.pre === null,
   `★오늘 08:10 장전, 체결 없음 → pre ${새것.오늘아침.pre}★ — 어제 값이 "장전" 으로 표시되지 않는다`);
ok(새것.오늘아침.post === null, "같은 시각 post 도 지워진다(어제 장후가 오늘 장전에 남지 않는다)");
ok(옛것.오늘아침.pre === 71000 && 옛것.오늘아침.post === 70500,
   `전제 확인 — 종전 마스크였다면 어제 값(장전 ${옛것.오늘아침.pre} · 장후 ${옛것.오늘아침.post})이 그대로 살아남는다`);

const 장후 = writeQuote({ pre: 71000, post: null }, { pre: null, post: 69800 }, extKeepMaskKR("POST"));
ok(장후.post === 69800 && 장후.pre === null, "장후에 새 체결이 오면 그 값이 들어가고 아침 장전가는 지워진다");

/* ★배선★ — 마스크 함수가 맞아도 기록부가 그걸 안 부르면 아무 소용이 없다.
   기록부는 extKeepMaskFor(market, mstate) 하나만 부르므로, 그 함수를 시장별로 확인한다
   (이 절이 없을 때 "기록부가 한국에 마스크를 안 씀" 돌연변이를 못 잡았다). */
const 한국 = extKeepMaskFor("kr", "PRE"), 미국 = extKeepMaskFor("us", "PRE");
ok(한국.pre === true && 한국.post === false, "기록부 배선: kr → 한국 마스크를 쓴다");
ok(미국.pre === true && 미국.post === false, "기록부 배선: us → 미국 마스크를 쓴다");
const 한국휴장 = extKeepMaskFor("kr", "REGULAR");
ok(한국휴장.pre === false && 한국휴장.post === false,
   "기록부 배선: kr 정규장에 지난 세션 값을 지운다(항상 유지로 되돌아가면 실패한다)");
for (const mk of ["cm", "bdus", "bdkr"]) {
  const m = extKeepMaskFor(mk, null);
  ok(m.pre === true && m.post === true, `${mk}: 시간외 개념이 없어 종전대로 아무것도 지우지 않는다`);
}

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
