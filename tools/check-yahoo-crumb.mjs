/* [V33.566] 옛 야후 경로 crumb 자동 첨부 계약 — 운영 실측(/api/src-probe 10/12): v10 quoteSummary·v7 options 는 crumb 없으면 HTTP 401.
 *   ① crumb 없는 v10/v7 URL 에는 공유 인증(yahoo_auth)의 crumb 와 쿠키를 붙인다 ② 이미 crumb 가 있으면 건드리지 않는다
 *   ③ v8 chart(인증 불필요)에는 붙이지 않는다 ④ 인증을 못 얻으면 종전처럼 그대로 보낸다(예외 없음) */
const seen = [];
globalThis.fetch = async (u, init) => {   // 모듈 로드 전에 가짜 네트워크(감싸개가 이 함수를 원본으로 잡는다)
  seen.push({ u: String(u), cookie: init && init.headers && init.headers.Cookie });
  return new Response(JSON.stringify({ quoteSummary: { result: [{}] } }), { status: 200, headers: { "content-type": "application/json" } });
};
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const auth = { crumb: "CR/1", cookie: "A1=x; A3=y", ts: Date.now() };
const fakeDB = { prepare: () => ({ bind: (k) => ({ first: async () => (k === "yahoo_auth" ? { v: JSON.stringify(auth) } : null), all: async () => ({ results: [] }), run: async () => ({}) }) }) };
M._setYAuthDB(fakeDB);
M.resetFetchBudget && M.resetFetchBudget(50);
const last = () => seen[seen.length - 1];
await M.yahooFetch("https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=price");
chk(/[?&]crumb=CR%2F1/.test(last().u) && last().cookie === "A1=x; A3=y", "v10 quoteSummary: crumb·쿠키 자동 첨부", JSON.stringify(last()));
await M.yahooFetch("https://query1.finance.yahoo.com/v7/finance/options/AAPL");
chk(/options\/AAPL\?crumb=CR%2F1$/.test(last().u), "v7 options(쿼리 없음): ?crumb= 로 붙인다", last().u);
await M.yahooFetch("https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL&crumb=OLD");
chk((last().u.match(/crumb=/g) || []).length === 1 && /crumb=OLD/.test(last().u), "이미 crumb 가 있으면 그대로", last().u);
await M.yahooFetch("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d");
chk(!/crumb=/.test(last().u), "v8 chart 에는 붙이지 않는다", last().u);
M._setYAuthDB({ prepare: () => ({ bind: () => ({ first: async () => { throw new Error("d1 down"); } }) }) });
let threw = false; try { await M.yahooFetch("https://query1.finance.yahoo.com/v10/finance/quoteSummary/MSFT?modules=price"); } catch (e) { threw = true; }
chk(!threw, "인증을 못 얻어도 예외 없이 종전처럼 보낸다");
if (fails) { console.log("\n✗ 야후 crumb 자동 첨부 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 야후 crumb 자동 첨부 통과");
