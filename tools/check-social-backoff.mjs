/* [V33.362] ★상대가 "그만" 이라고 하는데 30번을 끝까지 두드렸다★
 *
 *   실측(운영 스냅샷 2026-09-15 01:49):
 *     social.health.stocktwits : http 429 · done 12 · fail ★18★
 *     social.health.reddit     : http 403
 *     자가진단: "[SOCIAL] 모듈 실패 4건 반복 감지"
 *
 *   StockTwits 루프는 `if (!r.ok) { … break; }` 가 ★안쪽 페이지 루프만★ 끊었다.
 *   바깥 30종목 루프는 그대로 돌아, 막힌 뒤에도 18번을 더 두드렸다.
 *   그 18회가 전부 fetch 예산을 태웠다 — A-5 가 바로 그 예산 굶주림 문제였다.
 *   그리고 429 를 계속 두드리는 것은 차단을 푸는 방법이 아니라 늘리는 방법이다.
 *
 *   ★실제로 socialFetchStep 을 돌려서★ 확인한다(문자열 검사 아님).
 */
import { socialFetchStep, _socialBackoffMs, _socialBackoffLeftMs, SOCIAL } from "../src/index.js";

const SYMS = Array.from({ length: 60 }, (_, i) => "SY" + i);   // 미국 티커만(KR·선물 접미사 없음)

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

/* state 를 기억하는 가짜 D1 */
function fakeDB(seed) {
  const st = new Map(Object.entries(seed || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    st,
    get: (k) => { try { return JSON.parse(st.get(k)); } catch (e) { return null; } },
    prepare: (sql) => ({
      bind: (...b) => ({
        first: async () => { const v = st.get(b[0]); return v == null ? null : { v }; },
        all: async () => ({ results: [] }),
        run: async () => { if (/INSERT INTO state/.test(sql)) st.set(b[0], b[1]); return { meta: { last_row_id: 1 } }; }
      }),
      first: async () => null,
      /* socialFetchStep 은 daily: 키 목록으로 미국 유니버스를 만든다 — 그걸 준다.
         (안 주면 "[SOCIAL] 대상 없음" 으로 빠져 이 게이트가 통째로 헛돈다) */
      all: async () => (/'daily:'/.test(sql)
        ? { results: SYMS.map((x) => ({ k: "daily:" + x })) }
        : { results: [] })
    })
  };
}
function install({ stStatus, rdStatus, retryAfter }) {
  const calls = { st: 0, rd: 0 };
  globalThis.fetch = async function (url) {
    const u = String(url);
    if (u.indexOf("stocktwits.com") >= 0) {
      calls.st++;
      const okr = !stStatus || stStatus === 200;
      return { ok: okr, status: stStatus || 200,
               headers: { get: (k) => (k === "retry-after" ? (retryAfter || null) : null) },
               async json() { return { messages: [] }; }, async text() { return "{}"; } };
    }
    if (u.indexOf("reddit.com") >= 0) {
      calls.rd++;
      const okr = !rdStatus || rdStatus === 200;
      return { ok: okr, status: rdStatus || 200,
               headers: { get: () => null },
               async json() { return { data: { children: [] } }; }, async text() { return "{}"; } };
    }
    throw new Error("unexpected fetch " + u.slice(0, 50));
  };
  return calls;
}
const health = (db, id) => (db.get("social_health") || {})[id] || {};

// ── ① 429 를 만나면 그 회차를 ★접는다★ ───────────────────────────────────────
{
  const calls = install({ stStatus: 429 });
  const DB = fakeDB();
  const msg = await socialFetchStep(DB);
  ok(calls.st === 1,
     `429 를 받은 즉시 멈춘다 — StockTwits 호출 ${calls.st}회 (종전엔 ${SOCIAL.symsPerRound}종목을 끝까지 두드려 18회가 실패했다)`);
  ok(/백오프|429/.test(String(msg)), `반환 문장이 rate limit 을 말한다 — "${String(msg).slice(0, 70)}"`);
  const h = health(DB, "stocktwits");
  ok(h.until > Date.now(), `쉴 시각을 기록한다(${Math.round((h.until - Date.now()) / 60000)}분 뒤까지)`);
  ok(h.backoffMin === SOCIAL.backoffMin, `기본 백오프 ${h.backoffMin}분 (Retry-After 없음)`);
}

// ── ② 쉬라고 한 시간은 ★지킨다★ — 다음 회차가 아예 시작하지 않는다 ────────────
{
  const DB = fakeDB({ social_health: { stocktwits: { until: Date.now() + 15 * 60000 } } });
  const calls = install({ stStatus: 200 });
  const msg = await socialFetchStep(DB);
  ok(calls.st === 0, `백오프 중에는 StockTwits 를 ★한 번도★ 안 부른다 (${calls.st}회)`);
  ok(/백오프 대기/.test(String(msg)), `왜 안 했는지 말한다 — "${String(msg).slice(0, 50)}"`);
  ok(await _socialBackoffLeftMs(DB, "stocktwits") > 0, "남은 백오프를 읽어낸다(읽는 키와 쓰는 키가 맞는다)");
}

// ── ③ 백오프가 끝나면 ★스스로 재개한다★ ─────────────────────────────────────
{
  const DB = fakeDB({ social_health: { stocktwits: { until: Date.now() - 1000 } } });
  const calls = install({ stStatus: 200 });
  await socialFetchStep(DB);
  ok(calls.st > 0, `지난 백오프는 막지 않는다 — 재개해서 ${calls.st}회 호출`);
}

// ── ④ Retry-After 를 존중한다 ────────────────────────────────────────────────
{
  const DB = fakeDB();
  install({ stStatus: 429, retryAfter: "300" });
  await socialFetchStep(DB);
  const h = health(DB, "stocktwits");
  ok(h.backoffMin === 5, `Retry-After 300초 → ${h.backoffMin}분 (상대가 말해 준 시간을 쓴다)`);
}
{
  const H = (v) => ({ headers: { get: (k) => (k === "retry-after" ? v : null) } });
  ok(_socialBackoffMs(H("99999")) === SOCIAL.backoffMaxMin * 60000,
     `Retry-After 가 아무리 길어도 ${SOCIAL.backoffMaxMin}분에서 멈춘다(영원히 쉬지 않는다)`);
  ok(_socialBackoffMs(H("5")) === 60000, "너무 짧은 값도 최소 1분은 쉰다(즉시 재시도로 되돌아가지 않는다)");
  ok(_socialBackoffMs(H("nonsense")) === SOCIAL.backoffMin * 60000, "깨진 헤더는 기본값으로");
  ok(_socialBackoffMs({}) === SOCIAL.backoffMin * 60000, "헤더가 없는 응답도 안전하다");
  const fut = new Date(Date.now() + 45 * 60000).toUTCString();
  ok(Math.abs(_socialBackoffMs(H(fut)) - 45 * 60000) < 65000, "HTTP-date 형식도 읽는다");
}

// ── ⑤ Reddit 403 도 같은 규칙을 받는다 ───────────────────────────────────────
{
  const DB = fakeDB();
  const calls = install({ rdStatus: 403, stStatus: 200 });
  await socialFetchStep(DB);
  const h = health(DB, "reddit");
  ok(h.until > Date.now(), `Reddit 403 → ${Math.round((h.until - Date.now()) / 60000)}분 백오프`);
  const DB2 = fakeDB({ social_health: { reddit: { until: Date.now() + 10 * 60000 } } });
  const c2 = install({ rdStatus: 200, stStatus: 200 });
  await socialFetchStep(DB2);
  ok(c2.rd === 0, `Reddit 백오프 중에는 안 부른다 (${c2.rd}회)`);
  ok(c2.st > 0, "★한 소스의 백오프가 다른 소스를 막지 않는다★ — StockTwits 는 계속 돈다");
}

// ── ⑥ 정상일 때는 아무것도 안 바뀐다(회귀 없음) ───────────────────────────────
{
  const DB = fakeDB();
  const calls = install({ stStatus: 200, rdStatus: 200 });
  await socialFetchStep(DB);
  ok(calls.st === SOCIAL.symsPerRound,
     `정상이면 종전대로 ${calls.st}종목을 돈다(= symsPerRound ${SOCIAL.symsPerRound})`);
  ok(calls.rd === 1, "Reddit 은 종전대로 1회");
  ok(!(health(DB, "stocktwits").until > 0), "정상이면 백오프를 걸지 않는다");
  ok(!(health(DB, "reddit").until > 0), "Reddit 도 마찬가지");
}

console.log(fail ? "\n소셜 백오프 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   소셜 백오프 계약 통과");
process.exit(fail ? 1 : 0);
