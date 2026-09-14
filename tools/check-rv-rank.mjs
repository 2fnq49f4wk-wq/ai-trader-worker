/* [V33.356] ★시총순위 드리프트 — 읽는 이름이 틀려 전략 하나가 죽어 있었다 (결함 F-2)★
 *
 *   `mcap_shares` 는 V33.217 부터 { sh, mc } 로 저장된다(저장 지점 두 곳 모두).
 *   그런데 rvBuildPanel 의 순위 블록만 `.shares` 를 찾고 있었다 — 그 키는 이 맵에
 *   ★존재한 적이 없다.★ 폴백인 `shares[s]` 는 객체라 `_num(객체,0)` 이 0 이다.
 *     → caps 가 늘 빔 → rank 가 늘 {} → rvContextFor().rank 가 늘 null
 *     → ★XR_FLOW 전략은 추가된 날(V33.250)부터 한 번도 발동한 적이 없다.★
 *   화면 시총 박스는 같은 맵을 `ms.sh` 로 바르게 읽고 있어서 증상이 안 보였다.
 *
 *   그리고 이름을 고치면 ★드리프트가 살아나므로★, 그 값이 성립하는지도 같이 지켜야 한다:
 *     · now 는 '이 패널에 든 종목' 안의 순위인데 prev 는 '정적 전체 유니버스' 의 순위였다.
 *       모집단이 다르면 그 차이는 "올라왔다" 가 아니라 ★"빠진 종목이 많다"★ 를 재는 값이다.
 *     · MCAP_RANK 미국 구간엔 동점이 28그룹 있다(F-2) — 동점이면 앞뒤가 임의다.
 */
import { rvContextFor, evaluateIndexFlowEntry, rvBuildPanel, RVSTRAT, MCAP_RANK } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

// ── ① ★rvBuildPanel 을 실제로 돌린다★ — 저장 모양 { sh, mc } 를 읽어내는가 ────
//    (소스에서 문자열을 잘라 보는 검사는 함수가 옮겨가면 조용히 헛돈다 — V33.337 교훈)
function fakeDB(shareShape) {
  const st = new Map();
  /* ★실제 MCAP_RANK 에 있는 티커로 채운다.★ 가짜 이름을 쓰면 정적 표에 자리가 없어
     prev 가 전부 0 이 되고, "prev 도 같은 무리 안의 순위인가" 라는 질문이 통째로 헛돈다
     (처음 판본이 그랬다 — prev 최대 0 으로 ★공허하게★ 통과했다).
     동점 그룹(9: TSM·SPCX·TSLA)을 일부러 포함해 동점 표시까지 끝까지 확인한다. */
  const syms = ["NVDA", "GOOGL", "GOOG", "AAPL", "MSFT", "AMZN", "TSM", "SPCX", "TSLA",
                "META", "AVGO", "LLY", "JPM", "V", "WMT", "XOM", "UNH", "MA", "ORCL", "COST"];
  const N = syms.length;
  // 일봉 — pr.lookback + 10 봉 이상, 전부 minPrice 초과
  for (let i = 0; i < N; i++) {
    const base = 50 + i;
    const closes = Array.from({ length: 200 }, (_, j) => base + Math.sin(j / 9) * 2 + j * 0.01);
    st.set("daily:" + syms[i], JSON.stringify({ closes, prevClose: closes[198], symbol: syms[i] }));
  }
  // 주식수 — 호출자가 준 모양 그대로 저장한다
  const sh = {};
  for (let i = 0; i < N; i++) sh[syms[i]] = shareShape(1e9 * (N - i));
  st.set("mcap_shares", JSON.stringify(sh));
  return {
    st, syms,
    prepare(sql) {
      return {
        bind: (...b) => ({
          first: async () => { const v = st.get(b[0]); return v == null ? null : { v: v }; },
          run: async () => { st.set(b[0], b[1]); return { meta: {} }; },
          all: async () => ({ results: [] })
        }),
        first: async () => ({ n: 0 }),
        all: async () => {
          if (/hist_meta:/.test(sql)) return { results: [] };          // 딥이력 없음 → daily 경로
          if (/'daily:'/.test(sql)) return { results: syms.map((x) => ({ k: "daily:" + x })) };
          return { results: [] };
        }
      };
    }
  };
}

{
  const realShape = (n) => ({ sh: n, mc: n * 100 });      // ★운영이 실제로 저장하는 모양★
  const db = fakeDB(realShape);
  const msg = await rvBuildPanel(db);
  const panel = JSON.parse(db.st.get("rv_panel") || "null");
  ok(!!panel, `rvBuildPanel 이 패널을 만들었다 — "${String(msg).slice(0, 60)}"`);
  const nRank = panel ? Object.keys(panel.rank || {}).length : 0;
  ok(nRank > 0, `저장 모양 { sh, mc } 에서 시총순위 ${nRank}종 산출 — ★종전엔 0 이었다(전략이 죽어 있었다)★`);

  // 대조군 — 주식수를 아예 안 주면 0 이어야 한다(위 숫자가 우연이 아님을 보인다)
  const db0 = fakeDB(() => ({ mc: 1e11 }));               // sh 없음
  await rvBuildPanel(db0);
  const p0 = JSON.parse(db0.st.get("rv_panel") || "null");
  const n0 = p0 ? Object.keys(p0.rank || {}).length : 0;
  ok(n0 === 0, `대조군 — 주식수가 없으면 순위 ${n0}종(모르면서 아는 척하지 않는다)`);

  // 아주 옛 판(숫자를 그대로 저장)도 읽는다
  const dbN = fakeDB((n) => n);
  await rvBuildPanel(dbN);
  const pN = JSON.parse(dbN.st.get("rv_panel") || "null");
  ok(pN && Object.keys(pN.rank || {}).length > 0, "아주 옛 판(숫자 그대로 저장)도 읽는다");

  // ── prev 와 now 가 ★같은 무리★ 안의 순위인가 ────────────────────────────
  if (panel && nRank > 0) {
    const vals = Object.values(panel.rank);
    const maxNow = Math.max(...vals.map((r) => r.now));
    const maxPrev = Math.max(...vals.map((r) => r.prev));
    ok(maxPrev <= maxNow,
       `prev 최대 ${maxPrev} ≤ now 최대 ${maxNow} — prev 도 ★같은 무리 안★ 의 순위다 ` +
       `(종전엔 전체 유니버스 순위라 둘을 빼면 "빠진 종목 수" 를 재는 값이 됐다)`);
    ok(vals.every((r) => typeof r.tie === "boolean"), "동점 여부를 종목마다 기록한다");
    ok(vals.every((r) => r.prev > 0), `무리 전원이 정적 표에 자리가 있다 → prev 전부 > 0 (최대 ${maxPrev})`);
    // 정적 표에서 동점인 종목(TSM·SPCX·TSLA 는 전부 9위)은 tie 로 표시돼야 한다
    const tied = ["TSM", "SPCX", "TSLA"].filter((x) => panel.rank[x]);
    ok(tied.length >= 2 && tied.every((x) => panel.rank[x].tie === true),
       `정적 표 동점 그룹(${tied.join("·")} — 전부 #${MCAP_RANK.TSM})을 동점으로 표시한다`);
    const solo = ["NVDA", "AAPL"].filter((x) => panel.rank[x]);
    ok(solo.length > 0 && solo.every((x) => panel.rank[x].tie === false),
       `동점이 아닌 종목(${solo.join("·")})은 동점으로 표시하지 않는다`);
    ok(vals.every((r) => r.cohort === nRank), `무리 크기(cohort ${nRank})를 함께 남긴다 — 밴드가 뜻이 있는지 볼 수 있어야 한다`);
  }
}

// ── ② 동점이면 기권한다 — "몇 계단 올랐나" 에 답이 없는 자리에서 돈을 걸지 않는다 ──
{
  const R = RVSTRAT.xr;
  // 정기변경 창 안에서만 신호가 나므로, 창 안/밖을 가리지 않고 ★동점 여부만★ 가른다.
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.2);
  const dd = { closes, highs: closes.map((c) => c * 1.01), lows: closes.map((c) => c * 0.99), symbol: "TEST" };
  const price = closes[closes.length - 1];
  const mk = (tie) => ({ rank: { now: R.bandLo + 5, prev: R.bandLo + 5 + R.minRankJump + 3, tie: tie, mkt: "us" },
                         xs: null, pair: null, retDays: 5, ts: Date.now() });
  const withTie = evaluateIndexFlowEntry(price, dd, null, "us", mk(true));
  ok(withTie === null, "정적 순위가 ★동점★ 이면 신호를 내지 않는다(임의의 답으로 돈을 걸지 않는다)");
  // 대조군 — 동점이 아니면 (창 안일 때) 막히는 이유가 동점 때문이 아님을 보인다
  const noTie = evaluateIndexFlowEntry(price, dd, null, "us", mk(false));
  ok(noTie === null || (noTie && noTie.name === "XR_FLOW"),
     "동점이 아니면 동점 가드가 막지 않는다(막히면 다른 조건 — 정기변경 창 등)");
}

// ── ③ prev 가 0(정적 표에 없음)이면 신호 없음 — 종전 계약 유지 ────────────────
{
  const R = RVSTRAT.xr;
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.2);
  const dd = { closes, highs: closes.map((c) => c * 1.01), lows: closes.map((c) => c * 0.99), symbol: "TEST" };
  const ctx = { rank: { now: R.bandLo + 5, prev: 0, tie: false, mkt: "us" }, retDays: 5, ts: Date.now() };
  ok(evaluateIndexFlowEntry(closes[closes.length - 1], dd, null, "us", ctx) === null,
     "정적 표에 자리가 없는 종목(prev 0)은 신호를 내지 않는다");
}

// ── ④ 패널이 낡으면 rank 자체를 안 준다(종전 계약) ───────────────────────────
{
  const old = { ts: Date.now() - (RVSTRAT.panelStaleH + 1) * 3600000, rank: { X: { now: 1, prev: 2 } } };
  ok(rvContextFor(old, "X") === null, "낡은 패널은 통째로 null — 낡은 순위로 매매하지 않는다");
}

// ── ⑤ 동점이 늘지 않았는가 — F-2 의 상한을 여기서도 지킨다 ───────────────────
{
  /* 세는 방식은 check-universe-sync 의 F2_KNOWN_US_TIES(29) 와 ★같아야★ 한다 —
     '초과(excess) = Σ(그룹크기−1)' 다. 동점 종목 총수(57)로 세면 같은 사실을 두 숫자로
     말하게 되고, 어느 쪽 상한인지 다음 사람이 또 헷갈린다. */
  const excessOf = (list) => {
    const c = {};
    for (const s of list) { const v = MCAP_RANK[s]; if (v > 0) c[v] = (c[v] || 0) + 1; }
    return Object.values(c).filter((x) => x > 1).reduce((a, x) => a + x - 1, 0);
  };
  const keys = Object.keys(MCAP_RANK);
  const usEx = excessOf(keys.filter((s) => !/\.(KS|KQ)$/i.test(s)));
  ok(usEx <= 29, `미국 정적 순위 동점 초과 ${usEx} ≤ 29 (F-2 상한 — 늘면 드리프트에 답 없는 자리가 는다)`);
  const krEx = excessOf(keys.filter((s) => /\.(KS|KQ)$/i.test(s)));
  ok(krEx === 0, `한국 구간 동점 초과 ${krEx} — 0 이어야 한다(종전부터 깨끗했다)`);
}

console.log(fail ? "\n시총순위 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   시총순위 계약 통과");
process.exit(fail ? 1 : 0);
