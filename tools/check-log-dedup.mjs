/* [V33.352 · E-1] 같은 문장이 수십 번 쌓여 ★새 사고를 묻는다★
 *
 *   실측(2026-09-11 01:31): TIME-CAP 43회 · MLOPS 23회 · 기타 13회가 같은 문장으로 쌓였다.
 *   로그 보존은 전체 1,500행 + ERROR/WARN 1,000행이다. 한 문장이 43줄을 먹으면
 *   그만큼 다른 사건이 밀려 사라진다. 선례가 있다 — 09-10 에 `[FETCH] 평가가능 0종목` 이
 *   21회 쌓이는 동안 진짜 원인은 전혀 다른 것(시간외 가드)이었고, 그 21줄이 판단을 흐렸다.
 *
 *   이 게이트가 지키는 것 — 전부 ★실제 log() 를 돌려서★ 본다:
 *     ① 같은 문장은 한 줄로 묶인다(횟수는 본문에 남는다)
 *     ② ★ts 는 첫 발생 그대로★ — 갱신하면 반복이 계속 맨 위를 차지해 고치려던 일이 도로 난다
 *     ③ ★새 문장은 언제나 새 줄★ — 묶음이 새 사건을 삼키면 안 된다
 *     ④ 창이 지나면 새 줄 — "아직도 난다" 가 시간축에 보여야 한다
 *     ⑤ 통계(__engineErrCount)는 줄 수가 아니라 ★사건 수★ 를 센다
 */
import { log, _logSig, _logSeen, LOG_DEDUP_MS, _engineErrSeen } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

/* 아주 작은 가짜 D1 — INSERT/UPDATE 를 그대로 재현한다(rowid 포함). */
function fakeDB() {
  const rows = [];
  let next = 1;
  return {
    rows,
    prepare(sql) {
      return { bind: (...b) => ({ run: async () => {
        if (/^INSERT INTO logs/.test(sql)) {
          const id = next++;
          rows.push({ id, ts: b[0], level: b[1], symbol: b[2], message: b[3] });
          return { meta: { last_row_id: id } };
        }
        if (/^UPDATE logs/.test(sql)) {
          /* ★계약을 DB 쪽에서 강제한다★ — 반복 로그는 message 만 고쳐야 한다.
             ts 를 건드리면 그 줄이 계속 맨 위로 올라와, 고치려던 일(새 사건이 묻힘)이 도로 난다.
             가짜 DB 가 이것을 받아 주면 게이트가 그 회귀를 못 잡는다(실제로 처음엔 못 잡았다). */
          if (/\bts\b/.test(sql)) throw new Error("로그 반복 갱신이 ts 를 건드린다: " + sql);
          const r = rows.find((x) => x.id === b[1]);
          if (r) r.message = b[0];
          return { meta: { changes: r ? 1 : 0 } };
        }
        throw new Error("unexpected sql: " + sql);
      } }) };
    }
  };
}
const reset = () => _logSeen.clear();

// ── ① 같은 문장 43회 → 한 줄 ──
{
  reset();
  const db = fakeDB();
  for (let i = 0; i < 43; i++) await log(db, "WARN", null, "[TIME-CAP] 사이클 예산 초과 " + (1 + i * 0.01).toFixed(2) + "s");
  ok(db.rows.length === 1, `같은 문장 43회 → 줄 ${db.rows.length}개 (종전엔 43줄이 쌓였다)`);
  ok(/×43/.test(db.rows[0].message), `본문에 횟수가 남는다: "${db.rows[0].message.slice(-24)}"`);
  ok(/최근/.test(db.rows[0].message), "본문이 '최근 언제' 를 말한다 — 지금도 나는지 알 수 있다");
}

// ── ② ts 는 첫 발생 그대로 ──
{
  reset();
  const db = fakeDB();
  await log(db, "WARN", null, "[MLOPS] 같은 경고");
  const first = db.rows[0].ts;
  await new Promise((r) => setTimeout(r, 25));
  await log(db, "WARN", null, "[MLOPS] 같은 경고");
  ok(db.rows[0].ts === first,
     "★반복해도 ts 를 갱신하지 않는다★ — 갱신하면 그 줄이 계속 맨 위를 차지해 새 사건을 밀어낸다");
}

// ── ③ ★새 문장은 언제나 새 줄★ (이게 이 고침의 목적이다) ──
{
  reset();
  const db = fakeDB();
  for (let i = 0; i < 30; i++) await log(db, "ERROR", null, "[FETCH] 평가가능 0종목(일봉결측)");
  await log(db, "ERROR", "NVDA", "[SELL] 손절 체결 실패 — 포지션이 남았다");
  ok(db.rows.length === 2, `반복 30회 + 새 사고 1건 → 줄 ${db.rows.length}개`);
  const fresh = db.rows[db.rows.length - 1];
  ok(/손절 체결 실패/.test(fresh.message) && fresh.ts >= db.rows[0].ts,
     "★새 사고가 반복 뒤에 그대로 남는다★ — 묻히지 않는다");
  // 심볼이 다르면 다른 사건이다
  await log(db, "ERROR", "AMD", "[SELL] 손절 체결 실패 — 포지션이 남았다");
  ok(db.rows.length === 3, "심볼이 다르면 다른 줄로 남는다(종목별 사고를 뭉치지 않는다)");
  // 레벨이 다르면 다른 사건이다
  await log(db, "WARN", "AMD", "[SELL] 손절 체결 실패 — 포지션이 남았다");
  ok(db.rows.length === 4, "레벨이 다르면 다른 줄로 남는다");
}

// ── ④ 숫자만 다른 문장은 같은 사건이다 / 말이 다르면 다른 사건이다 ──
{
  ok(_logSig("WARN", null, "[TIME-CAP] 1.2s") === _logSig("WARN", null, "[TIME-CAP] 9.9s"),
     "숫자만 다르면 같은 사건으로 묶는다");
  ok(_logSig("WARN", null, "[TIME-CAP] 초과") !== _logSig("WARN", null, "[TIME-CAP] 정상"),
     "말이 다르면 다른 사건이다");
  ok(_logSig("ERROR", "A", "x") !== _logSig("ERROR", "B", "x"), "심볼이 다르면 다른 사건이다");
  // 아주 긴 문장이 앞부분만 같다고 뭉치면 서로 다른 사고가 하나로 보인다 — 160자까지는 본다
  const a = "[X] " + "가".repeat(150) + " 원인 A";
  const b = "[X] " + "가".repeat(150) + " 원인 B";
  ok(_logSig("ERROR", null, a) !== _logSig("ERROR", null, b) || a.slice(0, 160) === b.slice(0, 160),
     "긴 문장도 창(160자) 안에서는 구분된다");
}

// ── ⑤ 창이 지나면 새 줄 ──
{
  reset();
  const db = fakeDB();
  await log(db, "WARN", null, "[LONG] 계속 나는 경고");
  const sig = _logSig("WARN", null, "[LONG] 계속 나는 경고");
  const e = _logSeen.get(sig);
  e.first = Date.now() - LOG_DEDUP_MS - 1;          // 창이 지난 상황을 만든다
  await log(db, "WARN", null, "[LONG] 계속 나는 경고");
  ok(db.rows.length === 2, `창(${LOG_DEDUP_MS / 60000}분)이 지나면 새 줄 — "아직도 난다" 가 시간축에 보인다`);
}

// ── ⑥ 묶음표가 무한히 자라지 않는다 ──
{
  reset();
  const db = fakeDB();
  for (let i = 0; i < 500; i++) {
    await log(db, "INFO", null, "[X" + i + "] 서로 다른 문장");
    const e = _logSeen.get(_logSig("INFO", null, "[X" + i + "] 서로 다른 문장"));
    if (e) e.first = Date.now() - LOG_DEDUP_MS - 1;   // 전부 창 밖으로 늙힌다
  }
  await log(db, "INFO", null, "[Y] 마지막");
  ok(_logSeen.size <= 401, `묶음표가 정리된다 — 항목 ${_logSeen.size}개`);
}

// ── ⑥-b ★통계는 줄 수가 아니라 사건 수★ ──
//    묶음을 넣으면서 여기를 같이 건드리면 화면의 "오늘 에러 N건" 이 조용히 줄어든다.
{
  reset();
  const db = fakeDB();
  const before = _engineErrSeen();
  for (let i = 0; i < 12; i++) await log(db, "ERROR", null, "[SAME] 같은 에러 " + i);
  const after = _engineErrSeen();
  ok(after - before === 12, `에러 12회 → 통계 +${after - before} (줄은 ${db.rows.length}개로 묶였다)`);
  ok(db.rows.length === 1, "같은 에러는 한 줄로 묶인다 — 통계와 줄 수는 다른 것을 센다");
  const b2 = _engineErrSeen();
  await log(db, "WARN", null, "[SAME] 같은 경고");
  ok(_engineErrSeen() === b2, "WARN 은 에러 통계에 안 들어간다(종전 동작)");
}

// ── ⑦ DB 가 던져도 로그 때문에 호출부가 죽지 않는다 ──
{
  reset();
  const bad = { prepare() { return { bind: () => ({ run: async () => { throw new Error("D1 down"); } }) }; } };
  let threw = false;
  try { await log(bad, "ERROR", null, "무엇이든"); } catch (e) { threw = true; }
  ok(!threw, "로그가 실패해도 예외를 밖으로 내보내지 않는다(종전 동작 유지)");
}

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
