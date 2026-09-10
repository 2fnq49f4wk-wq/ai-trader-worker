/* [V33.339] 시간외 시세 — ★회전이 실제로 돌고, 세션 딱지가 낡지 않는가★
 *
 *   2026-09-10 04:07 운영 스냅샷: "미국 시간외 시세가 안 들어온다 — 세션 표시 336종목 중
 *   값이 있는 건 2종목뿐". 원인은 두 겹이었다.
 *     ① 보강 커서가 extOffset: shard * 7 — ★샤드마다 상수★ 였다. 회전 상한(24종목)에 걸린
 *        뒤로는 사이클마다 ★같은 24종목★ 을 다시 물었고, 나머지 수백 종목은 차례가 없었다.
 *        가격 폴백은 상태에 저장한 커서(qp_rr)로 제대로 돌고 있었다 — 한쪽만 안 돌았다.
 *     ② mstate 를 야후 v7 이 줄 때만 갱신했다. v7 이 죽자 며칠 전 딱지가 그대로 굳었고,
 *        COALESCE 보존이 그걸 계속 지켰다 — 화면은 정규장 종가를 '장후 시세' 라 말한다.
 *        세션은 시각의 함수다(getUSEt = IANA, 서머타임 자동). 남에게 물을 일이 아니다.
 *
 *   무는 것: 커서가 상태에 저장돼 전진하는가 · 세션을 시계에서 얻는가 ·
 *            지난 세션 값을 이어받지 않는가 · 그 판정을 실제로 돌려 본다.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };

// ── ① 커서가 상수가 아니라 저장된 값인가 ───────────────────────────────
{
  if (/extOffset:\s*shard \* 7/.test(S))
    bad("★보강 커서가 shard 로만 정해진다★ — 사이클마다 같은 종목만 다시 묻는다");
  else ok("보강 커서가 shard 상수가 아니다");
  if (/const _extKey = "ext_rr:" \+ market;/.test(S) && /await getState\(DB, _extKey, 0\)/.test(S))
    ok("보강 커서를 상태(ext_rr:<시장>)에서 읽는다 — 사이클이 끊겨도 이어진다");
  else bad("★보강 커서가 저장되지 않는다★ — 워커가 재기동하면 처음으로 돌아간다");
  if (/setState\(DB, _extKey, \(_extOff \+ _tried\)/.test(S))
    ok("이번에 시도한 만큼 커서를 밀어 다음 사이클은 다른 종목을 본다");
  else bad("★커서를 전진시키지 않는다★ — 저장만 하고 같은 자리에 머문다");
  if (/Object\.defineProperty\(out, "__extTried"/.test(S))
    ok("시도 개수를 열거 불가 속성으로 실어 보낸다 — 종목 맵에 가짜 키가 섞이지 않는다");
  else bad("★시도 개수가 종목 맵에 평범한 키로 섞인다★ — for..in 호출부가 종목으로 오해한다");
}

// ── ② 세션을 시계에서 얻는가 ───────────────────────────────────────────
{
  if (/function usMarketStateNow\(/.test(S)) ok("usMarketStateNow — 미국 세션을 시각에서 정하는 함수가 있다");
  else bad("★세션을 시각에서 정하는 함수가 없다★ — 수집원이 죽으면 세션도 모른다");
  if (/function extKeepMaskUS\(/.test(S) && /function normalizeExtUS\(/.test(S))
    ok("지금 세션에서 살아 있는 필드를 정하는 규칙이 한 곳에 있다");
  else bad("★어느 시간외 필드가 아직 유효한지 정하는 곳이 없다★");
  /* 세션은 IANA 를 거치는 getUSEt 위에 세워야 한다 — 손으로 쓴 서머타임 규칙이면 3월·11월에 틀린다. */
  const i0 = S.indexOf("function usMarketStateNow(");
  const blk = S.slice(i0, i0 + 420);
  if (/getUSEt\(/.test(blk)) ok("세션 판정이 getUSEt(IANA·서머타임 자동) 위에 서 있다");
  else bad("★세션 판정이 getUSEt 를 안 쓴다★ — 서머타임 전환 주에 한 시간씩 어긋난다");
}

// ── ③ 지난 세션 값을 이어받지 않는가 ───────────────────────────────────
{
  if (/CASE WHEN \?12 = 1 THEN NULL ELSE COALESCE\(\?8/.test(S))
    ok("가격 샤드가 지난 세션 값을 COALESCE 로 지키지 않는다 — 세션이 바뀌면 지운다");
  else bad("★가격 샤드가 지난 세션의 시간외 값을 계속 보존한다★");
  const i0 = S.indexOf("async function saveQuote(DB, symbol, market, q)");
  const blk = S.slice(i0, i0 + 1800);
  if (/_keepExt\("pre", _mask\.pre\)/.test(blk) && /_keepExt\("post", _mask\.post\)/.test(blk))
    ok("saveQuote 의 이어받기도 지금 세션에서 살아 있는 필드로 제한된다");
  else bad("★saveQuote 가 지난 세션 값을 되살린다★ — 한쪽만 고치면 다른 쪽이 되돌린다");
  if (/_lack[\s\S]{0,700}return false;\s*\/\/ 시간외 창이 아닌 세션/.test(S))
    ok("시간외 창이 아닌 종목은 보강 대상에서 빠진다 — 회전 상한을 헛되이 쓰지 않는다");
  else bad("★세션이 아닌 종목까지 보강 대상에 넣는다★ — 상한이 엉뚱한 곳에 소진된다");
}

// ── ④ v7 사망 원인을 남기는가 ──────────────────────────────────────────
{
  if (/function _v7ErrTag\(/.test(S) && /err: v7Err,/.test(S))
    ok("v7 실패 사유(HTTP 상태·타임아웃)를 상태에 남긴다 — 인증/요청형태/과부하를 가른다");
  else bad("★v7 이 왜 죽었는지 아무 데도 안 남는다★ — 고칠 곳을 못 정한다");
  /* 낡은 단정이 ★사용자에게 나가는 문장★ 으로 남아 있는지만 본다 — 주석의 인용은 기록이다. */
  if (!/add\("error", "시세",[^\n]*못 만든다/.test(S) && /add\("error", "시세"[\s\S]{0,240}v8 분봉으로 계속 채운다/.test(S))
    ok("자가진단이 'v8 은 시간외를 못 만든다' 는 낡은 단정을 더는 사용자에게 말하지 않는다");
  else bad("★자가진단 문장이 자기 코드보다 낡았다★ — v8 분봉 보강 경로(fetchExtendedQuoteUS)가 이미 있다");
}

// ── ⑤ ★실제로 돌려 본다★ — 시각을 넣어 세션과 마스크를 확인한다 ────────
{
  const i0 = S.indexOf("function usMarketStateNow(");
  const i1 = S.indexOf("/* [V33.331] ★지금 이 시장이");
  if (i0 < 0 || i1 <= i0) bad("★세션 함수 본문을 못 잘라냈다 — 실행 검사를 못 한다★");
  else {
    /* getUSEt 대신 시험용 시계를 끼운다 — 이 검사가 보려는 건 '분 → 세션' 매핑이다. */
    const ctx = { console };
    vm.createContext(ctx);
    vm.runInContext("var __et = null; function getUSEt(){ return __et; }\n" + S.slice(i0, i1), ctx);
    const at = (day, min) => { ctx.__et = { day, totalMin: min }; return ctx.usMarketStateNow(); };
    const cases = [
      [3, 300, "CLOSED", "새벽 05:00 ET — 아직 장전 전"],
      [3, 420, "PRE", "장전 시작 04:00 ET"],
      [3, 569, "PRE", "장전 마지막 분"],
      [3, 570, "REGULAR", "정규장 개장 09:30 ET"],
      [3, 959, "REGULAR", "정규장 마지막 분"],
      [3, 960, "POST", "장후 시작 16:00 ET"],
      [3, 1199, "POST", "장후 마지막 분"],
      [3, 1200, "CLOSED", "장후 종료 20:00 ET"],
      [6, 700, "CLOSED", "토요일은 정규장 시각이어도 휴장"],
      [0, 1000, "CLOSED", "일요일은 장후 시각이어도 휴장"]
    ];
    let miss = 0;
    for (const [d, m, want, label] of cases) {
      const got = at(d, m);
      if (got !== want) { miss++; bad(`★세션 판정 어긋남★ ${label}: ${got} ≠ ${want}`); }
    }
    if (!miss) ok(`세션 경계 ${cases.length}곳이 전부 맞다 — 장전/정규장/장후/휴장이 분 단위로 갈린다`);
    const mask = (s) => ctx.extKeepMaskUS(s);
    if (mask("PRE").pre && !mask("PRE").post) ok("장전에는 pre 만 살아 있다 — 어제 장후는 지운다");
    else bad("★장전인데 어제 장후 값이 살아 있다★");
    if (!mask("REGULAR").pre && !mask("REGULAR").post) ok("정규장에는 둘 다 지운다 — 지금 값은 정규장 시세다");
    else bad("★정규장인데 시간외 값이 남는다★");
    if (mask("POST").post && !mask("POST").pre) ok("장후에는 post 만 살아 있다");
    else bad("★장후 마스크가 틀렸다★");
    if (mask("CLOSED").post) ok("휴장 중엔 마지막 장후 체결가를 그대로 둔다 — 그게 최신 체결이다");
    else bad("★휴장이 되자마자 장후 값을 지운다★ — 밤새 마지막 체결가가 사라진다");
    /* 정규장에 낡은 장후 값이 붙어 있으면 지워야 한다 — 스냅샷에서 벌어진 그 상황이다. */
    const q = { price: 10, mstate: "POST", post: 9.5, postPct: -5, pre: null, prePct: null };
    ctx.normalizeExtUS(q, "REGULAR");
    if (q.post === null && q.postPct === null) ok("정규장에 남아 있던 장후 값이 실제로 지워진다");
    else bad(`★낡은 장후 값이 안 지워진다★ (post=${q.post})`);
    const q2 = { price: 10 };
    ctx.normalizeExtUS(q2, "PRE");
    if (q2.mstate === "PRE") ok("수집원이 세션을 안 줘도 우리 시계가 찍어 준다");
    else bad(`★세션 딱지가 안 찍힌다★ (mstate=${q2.mstate})`);
  }
}

if (fails) { console.error(`check-extquote-rotation: ${fails} FAIL`); process.exit(1); }
console.log("check-extquote-rotation: OK");
