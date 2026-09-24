/* ═══════════════════════════════════════════════════════════════════════════
   [V33.427c] ★"못 읽었다" 를 "없다" 로 읽고 되쓰기★ 금지 검사

   getState(DB, K, 기본값) 은 D1 오류를 삼키고 ★기본값을 돌려준다★. 그 값을 고쳐서
   같은 K 에 다시 쓰면, D1 이 한 번 삐끗한 순간 그동안 쌓은 것이 기본값으로 덮인다:
     · V33.427b 수집기 — 색인을 못 읽고 '빈 색인' 으로 덮어 수백 종목의 봉을 지웠다(실사고)
     · 누적 입출금 · TWR · 고점 · 전진 원장 · 투표 · 학습 통계 — 같은 모양이 41곳 있었다

   이 검사가 막는 것:
     ① 정적 — "X = getState(DB, K, …)" 뒤에 같은 함수에서 "setState(DB, K, …X…)" 가 오면
        읽기는 ★엄격(4번째 인자 true)★ 이어야 한다. 예외는 아래 허용목록뿐이고,
        허용목록은 ★사유★ 를 달아야 하며 코드에서 사라진 항목이 남아 있으면 그것도 실패다.
     ② 동작 — 가짜 D1 에 읽기 실패를 심어, 돈·위험 한도·전진 성적이 ★덮이지 않음★ 을 실행으로 본다.
        대조군(읽기 성공)은 정상적으로 써야 한다 — "아무것도 안 해서 통과" 를 막는다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* ── 허용목록: 되써도 되는 곳. 키 표현(소스 그대로) → 사유 ──
   캐시(통째로 다시 만든다) · 커서(처음부터 다시 돌아도 잃는 것이 없다) · 분기가 달라 되쓰지 않는다 */
const ALLOW = {
  "_mlSnapStateKey(fv)": "스냅샷 빌드 진행표 — 잃으면 다시 뜬다(원본은 D1 표본)",
  "_extKey": "커서 — 시간외 보강 회전 위치",
  "qpRrKey": "커서 — 가격 폴백 회전 위치",
  "rrKey": "커서 — 일봉 회전 위치",
  "\"hist_off\"": "커서 — 딥이력 수확 오프셋",
  "\"daily:\" + symbol": "캐시 — 새로 받은 일봉으로 통째로 갈아 끼운다(병합 아님)",
  "ckey": "캐시 — 6시간짜리 베타 계수",
  "\"heat_longret\"": "캐시 — 장기수익률 히트맵",
  "\"sec_cik_map\"": "캐시 — SEC 티커→CIK 표",
  "\"quote:\" + y.symbol": "읽기와 쓰기가 다른 분기다(없을 때만 읽고, 새 값이 있을 때만 쓴다)",
};

function matchParen(src, i) {
  let d = 0, q = null;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === "\\") { k++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if ("([{".includes(c)) d++;
    else if (")]}".includes(c)) { d--; if (d === 0) return k; }
  }
  return -1;
}
function topArgs(s) {
  const out = []; let d = 0, q = null, cur = "";
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { cur += c; if (c === "\\") { cur += s[++k]; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; cur += c; continue; }
    if ("([{".includes(c)) d++; if (")]}".includes(c)) d--;
    if (c === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim()); return out;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/* 소스에서 "읽고-되쓰기" 쌍을 모두 찾는다. */
export function scanRmw(src) {
  const lineAt = (p) => src.slice(0, p).split("\n").length;
  const hits = [];
  const re = /([A-Za-z_$][\w$]*(?:\[[^\]\n]{1,40}\])?)\s*=\s*\(?\s*await\s+getState\(/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const end = matchParen(src, open);
    if (end < 0) continue;
    const a = topArgs(src.slice(open + 1, end));
    const v = m[1], key = a[1] || "", strict = a[3] === "true";
    const tail = src.slice(end, end + 15000);
    const fn = tail.search(/\n(?:async\s+)?function\s+[\w$]+\s*\(/);   // 다음 최상위 함수 전까지만
    const scope = fn >= 0 ? tail.slice(0, fn) : tail;
    const wre = new RegExp("setState\\(\\s*[\\w.]+\\s*,\\s*" + esc(key) + "\\s*,", "g");
    const vre = new RegExp("(^|[^\\w$.])" + esc(v) + "($|[^\\w$])");
    let w;
    while ((w = wre.exec(scope))) {
      const op = end + w.index + w[0].indexOf("(");
      const ed = matchParen(src, op);
      const val = topArgs(src.slice(op + 1, ed))[2] || "";
      if (vre.test(val)) { hits.push({ line: lineAt(m.index), key, v, strict }); break; }
    }
  }
  return hits;
}

console.log("① 정적 — 되쓰는 읽기는 엄격해야 한다(허용목록 제외)");
{
  const hits = scanRmw(S);
  chk(hits.length >= 30, "읽고-되쓰기 쌍 " + hits.length + "곳을 찾았다(스캐너가 살아 있다)",
    "★스캐너가 " + hits.length + "곳밖에 못 찾는다 — 정규식이 죽었다★");
  const loose = hits.filter((h) => !h.strict && !(h.key in ALLOW));
  for (const h of loose) console.log("       L" + h.line + " " + h.key + " → " + h.v);
  chk(loose.length === 0, "허용목록 밖의 느슨한 되쓰기 0곳",
    "★느슨한 읽기를 같은 키에 되쓴다 " + loose.length + "곳★ — getState(…, true) 로 읽고 실패하면 쓰지 말 것");
  const used = new Set(hits.filter((h) => !h.strict).map((h) => h.key));
  const stale = Object.keys(ALLOW).filter((k) => !used.has(k));
  chk(stale.length === 0, "허용목록 " + Object.keys(ALLOW).length + "항목 모두 실제 코드에 있다",
    "★허용목록에 코드에서 사라진 항목: " + stale.join(", ") + "★ — 지울 것(빈 허용이 새 구멍을 덮는다)");
  for (const k of Object.keys(ALLOW)) if (!ALLOW[k] || ALLOW[k].length < 4) { fails++; console.log("  FAIL 허용 사유가 비었다: " + k); }
  /* 스캐너 자체 대조군 — 합성 소스에서 잡아야 할 것을 잡는가 */
  const syn = "async function f(DB){\n const st = (await getState(DB, \"k1\", null)) || {};\n st.n++;\n await setState(DB, \"k1\", st);\n}\n" +
              "async function g(DB){\n const st = (await getState(DB, \"k2\", null, true)) || {};\n await setState(DB, \"k2\", Object.assign({}, st, {a:1}));\n}\n" +
              "async function h(DB){\n const st = await getState(DB, \"k3\", null);\n await setState(DB, \"k3\", { fresh: 1 });\n}\n";
  const sh = scanRmw(syn);
  chk(sh.length === 2 && !sh[0].strict && sh[0].key === "\"k1\"" && sh[1].strict,
    "합성 대조: 느슨 1 · 엄격(병합 쓰기) 1 · 새 값 쓰기는 안 셈",
    "★스캐너가 합성 소스를 잘못 읽는다: " + JSON.stringify(sh) + "★");
}

/* ── 가짜 D1 ── */
function fakeDB(o) {
  const st = new Map(Object.entries(o.state || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const log = { writes: [], sql: [], batches: 0 };
  const mkStmt = (sql) => {
    const s = { sql, args: [] };
    s.bind = (...a) => { s.args = a; return s; };
    s.first = async () => {
      log.sql.push(sql);
      if (/SELECT v FROM state WHERE k = \?/.test(sql)) {
        const k = s.args[0];
        if ((o.failRead || []).includes(k)) throw new Error("D1_ERROR: fake overload");
        return st.has(k) ? { v: st.get(k) } : null;
      }
      return o.first ? o.first(sql, s.args) : null;
    };
    s.all = async () => { log.sql.push(sql); return { results: o.all ? o.all(sql, s.args) : [] }; };
    s.run = async () => {
      log.sql.push(sql);
      if (/INSERT INTO state/.test(sql)) { log.writes.push(s.args[0]); st.set(s.args[0], s.args[1]); }
      return { meta: { changes: 0 } };
    };
    return s;
  };
  return {
    prepare: mkStmt,
    batch: async (arr) => {
      if (o.failBatch) throw new Error("D1_ERROR: batch fail");
      log.batches++;
      for (const s of arr) await s.run();
      return [];
    },
    _log: log, _get: (k) => (st.has(k) ? JSON.parse(st.get(k)) : undefined),
  };
}

const M = await import("../src/index.js");

console.log("\n② 고점 — 못 읽으면 ★덮지 않는다★(낙폭이 0 으로 지워지면 폭락장 게이트가 눈을 감는다)");
{
  const DB = fakeDB({ state: { "equity_peak:us": 1000 }, failRead: ["equity_peak:us"] });
  let threw = false; try { await M.updateEquityPeak(DB, "us", 800); } catch (e) { threw = true; }
  chk(threw && !DB._log.writes.includes("equity_peak:us"), "읽기 실패 → 던지고 고점 1000 을 그대로 둔다",
    "★읽기 실패인데 고점을 " + JSON.stringify(DB._get("equity_peak:us")) + " 로 덮었다★");
  const D2 = fakeDB({ state: { "equity_peak:us": 1000 } });
  const r = await M.updateEquityPeak(D2, "us", 800);
  chk(Math.abs(r.ddPct - 20) < 1e-9 && !D2._log.writes.length, "대조: 읽기 성공 → 낙폭 20% · 쓰기 없음",
    "★대조군이 틀렸다: " + JSON.stringify(r) + "★");
}

console.log("\n③ TWR — 못 읽으면 덮지 않는다 · 미리 읽은 값(pre)을 넘기면 다시 읽지 않는다");
{
  const cfg = { initialCashUS: 1000, initialCashKR: 1000000, markets: {} };
  const DB = fakeDB({ state: { "twr:us": { factor: 1.3, lastValue: 1200 } }, failRead: ["twr:us"] });
  let threw = false; try { await M.applyCashflowToTWR(DB, "us", 1300, 100, cfg); } catch (e) { threw = true; }
  chk(threw && !DB._log.writes.length, "읽기 실패 → 던지고 factor 1.3 을 지킨다",
    "★읽기 실패인데 TWR 을 " + JSON.stringify(DB._get("twr:us")) + " 로 덮었다★");
  const D2 = fakeDB({ state: {}, failRead: ["twr:us"] });
  let t = null; try { t = await M.applyCashflowToTWR(D2, "us", 1300, 100, cfg, { factor: 1.3, lastValue: 1200 }); } catch (e) { t = { err: String(e.message) }; }
  chk(t && Math.abs(t.factor - 1.3 * 1300 / 1200) < 1e-9 && D2._get("twr:us").lastValue === 1400,
    "pre 를 쓰면 읽지 않고 이어서 누적한다(factor " + (t && t.factor ? t.factor.toFixed(4) : "?") + ")",
    "★pre 를 무시했다: " + JSON.stringify(t) + "★");
  /* 엔드포인트: TWR 을 입출금 ★쓰기 전에★ 엄격히 읽는가 */
  const i0 = S.indexOf("if (path === \"/api/cash/add\"");
  const blk = S.slice(i0, S.indexOf("return Response.json({ ok: true, cash: newCash", i0));
  const pre = blk.indexOf("getState(env.DB, \"twr:us\", null, true)");
  const wr = blk.indexOf("setState(env.DB, \"deposits\", deposits)");
  chk(i0 > 0 && pre > 0 && wr > 0 && pre < wr && /applyCashflowToTWR\([^)]*_twrPre\.us\)/.test(blk),
    "입출금: TWR 을 쓰기 전에 엄격히 읽고 그 값을 넘긴다",
    "★입출금이 TWR 을 쓰기 뒤에 읽는다 — 읽기 실패 시 입출금만 반영된 반쪽 상태가 된다★");
  const j0 = S.indexOf("if (path === \"/api/reset_market\"");
  const rb = S.slice(j0, S.indexOf("return Response.json({ ok: true, market: mkt", j0));
  chk(j0 > 0 && rb.indexOf("\"deposits\", sleeveZeros(), true)") > 0 &&
      rb.indexOf("\"deposits\", sleeveZeros(), true)") < rb.indexOf("DELETE FROM positions"),
    "시장 리셋: 입출금을 ★지우기 전에★ 엄격히 읽는다",
    "★시장 리셋이 포지션을 지운 뒤에 읽는다 — 읽기 실패 시 반쪽 리셋★");
}

console.log("\n④ 투표 — 못 읽으면 세지 않는다");
{
  const DB = fakeDB({ state: { "crowd:AAPL": { buy: 40, sell: 3 } }, failRead: ["crowd:AAPL"] });
  let threw = false; try { await M.crowdVote(DB, "AAPL", "buy"); } catch (e) { threw = true; }
  chk(threw && DB._get("crowd:AAPL").buy === 40, "읽기 실패 → 표 40 을 지킨다",
    "★읽기 실패인데 표를 " + JSON.stringify(DB._get("crowd:AAPL")) + " 로 덮었다★");
  const D2 = fakeDB({ state: { "crowd:AAPL": { buy: 40, sell: 3 } } });
  const r = await M.crowdVote(D2, "AAPL", "buy");
  chk(r.votes.buy === 41, "대조: 읽기 성공 → 41표", "★대조군 " + JSON.stringify(r) + "★");
}

console.log("\n⑤ OMNI 전진 성적 — 못 읽으면 라벨도 달지 않는다 · 쓰기 실패한 묶음은 세지 않는다");
{
  const D0 = Date.UTC(2026, 0, 5) / 1000;                 // 월요일 00:00 UTC
  const N = 24;
  const tail = (k) => { const t = [], c = []; for (let d = 0; d < 10; d++) { t.push(D0 + d * 86400); c.push(100 * (1 + (k + 1) * 0.001 * d)); }
                        return { "1d": { t, o: c, h: c, l: c, c, v: c.map(() => 1) } }; };
  const R2 = { get: async (key) => { const m = /tail\/S(\d+)\.json$/.exec(key); if (!m) return null;
                                     const body = JSON.stringify(tail(+m[1])); return { text: async () => body }; } };
  M._setR2ForTest(R2);
  const tdec = D0 + 86400;
  const rows = Array.from({ length: N }, (_, i) => ({ id: i + 1, symbol: "S" + i, market: "us", p: i % 2 ? 0.7 : 0.3 }));
  const mkDB = (extra) => fakeDB(Object.assign({
    state: { omni_fwd: { ver: M.OMNI_VER, since: 1, byHz: { "5d": { n: 500, hits: 260, acc: 0.52 } }, n: 500, hits: 260 } },
    all: (sql) => /GROUP BY tdec, hz/.test(sql) ? [{ tdec, hz: "5d", n: N }]
                : /SELECT id, symbol, market, p FROM omni_shadow/.test(sql) ? rows : [],
  }, extra));
  const A = mkDB({ failRead: ["omni_fwd"] });
  const ra = await M.omniShadowResolve(A, {});
  const labA = A._log.sql.filter((q) => /UPDATE omni_shadow SET label/.test(q)).length;
  chk(/읽기 실패/.test(ra) && labA === 0 && !A._log.writes.includes("omni_fwd"),
    "읽기 실패 → 라벨 0건 · 성적 500건 그대로 (" + ra.slice(0, 40) + "…)",
    "★읽기 실패인데 라벨 " + labA + "건 · 성적=" + JSON.stringify(A._get("omni_fwd")) + "★");
  const B = mkDB({});
  const rb = await M.omniShadowResolve(B, {});
  const fb = B._get("omni_fwd");
  chk(fb && fb.byHz["5d"].n > 500 && fb.byHz["5d"].n <= 500 + N && fb.n === fb.byHz["5d"].n,
    "대조: 읽기 성공 → 500 에 이어서 " + (fb && fb.byHz["5d"].n) + "건", "★대조군이 이어 쌓지 않는다: " + rb + "★");
  const C = mkDB({ failBatch: true });
  const rc = await M.omniShadowResolve(C, {});
  const fc = C._get("omni_fwd");
  chk(fc && fc.byHz["5d"].n === 500 && /쓰기실패/.test(rc),
    "묶음 쓰기 실패 → 달리지 않은 라벨은 세지 않는다(500 그대로)",
    "★쓰기 실패한 라벨을 셌다(n=" + (fc && fc.byHz["5d"].n) + ") — 다음 틱에 두 번 센다★");
}

console.log("\n⑥ 대표 수정 자리가 엄격 읽기를 유지하는가(되돌림 방지)");
for (const [k, why] of [
  ["\"krhalt:state\"", "거래정지 상태"], ["\"deposits\"", "누적 입금"], ["\"outflows\"", "누적 출금"],
  ["\"mind_guard\"", "자기감시 관측창"], ["\"omni_fwd\"", "OMNI 전진 성적"], ["_lkey", "전진 원장"],
  ["FEATMIG.key", "표본 이관 진행"], ["_sKey", "시간외 세션 진입 한도"], ["\"mcap_shares\"", "주식수 표"],
]) {
  const rmw = scanRmw(S).filter((h) => h.key === k);
  chk(rmw.length > 0 && rmw.every((h) => h.strict), why + " (" + k + ") — 되쓰는 읽기 " + rmw.length + "곳 모두 엄격",
    "★" + why + " (" + k + ") 의 되쓰는 읽기가 느슨하다(또는 사라졌다: " + rmw.length + "곳)★");
}

console.log(fails ? "\n✗ 되쓰기 검사 실패 " + fails : "\n✓ 되쓰기 검사 통과");
process.exit(fails ? 1 : 0);
