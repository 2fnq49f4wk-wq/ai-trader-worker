/* ═══════════════════════════════════════════════════════════════════════════
   [V33.430] 한국 종목 수급 이력 수집기 검사 — ★실행해서★ 본다(가짜 네이버 · 가짜 D1 · 가짜 R2).

   이 수집기를 쓴 세션은 네이버에 닿지 못했다(샌드박스 403). 그래서 응답 모양을 ★추정하지 않고
   검사하는★ 파서를 두 개 두었다. 여기서는 그 둘이
     ① 그럴듯한 JSON·HTML 을 읽고  ② 이상한 응답(칸 없음·숫자 아님)은 ★안 읽고★
     ③ 수집기가 V33.427b 의 교훈(못 읽은 것을 없다로 읽고 덮어쓰기)을 지키는지
     ④ JSON 이 날짜 넘기기를 무시하면 HTML 쪽 넘기기로 바꾸고, HTML 이 같은 쪽을 또 주면 멈추는지
   를 확인한다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* 거래일 목록(최근이 앞) */
const days = [];
{ let t = Date.UTC(2026, 8, 25); while (days.length < 400) { const d = new Date(t); if (d.getUTCDay() % 6) days.push(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()); t -= 86400000; } }
const fmtDot = (k) => String(k).slice(0, 4) + "." + String(k).slice(4, 6) + "." + String(k).slice(6, 8);

console.log("① 파서 — 그럴듯한 모양은 읽고, 이상한 모양은 안 읽는다");
{
  const j = days.slice(0, 3).map((d, i) => ({ itemCode: "005930", bizdate: String(d), foreignerPureBuyQuant: (i % 2 ? "-" : "+") + "1,234,567",
    foreignerHoldRatio: "52.10%", organPureBuyQuant: "-234,567", individualPureBuyQuant: "+1", accumulatedTradingVolume: "12,345,678" }));
  const p = M._ofParseJson(j);
  chk(p.rows.length === 3 && p.rows[0].f === 1234567 && p.rows[1].f === -1234567 && p.rows[0].o === -234567 && p.rows[0].h === 52.1 && p.rows[0].v === 12345678,
    "JSON: 날짜·외국인·기관·보유율·거래량 (+/−/쉼표/% 처리)", "★JSON 파싱이 틀렸다: " + JSON.stringify(p.rows[0]) + "★");
  const bad = M._ofParseJson([{ date: "x", foo: 1 }]);
  chk(bad.rows.length === 0, "JSON: 칸을 못 찾으면 한 행도 안 만든다(추정 안 함)", "★모르는 모양에서 행을 만들었다★");
  const html = "<table><tr><th>날짜</th></tr>" + days.slice(0, 2).map((d) =>
    "<tr onMouseOver=\"x\"><td class=\"tc\"><span class=\"tah p10 gray03\">" + fmtDot(d) + "</span></td>" +
    "<td class=\"num\"><span>76,600</span></td><td class=\"num\"><em>▲</em> 400</td><td class=\"num\">+0.52%</td>" +
    "<td class=\"num\">12,345,678</td><td class=\"num\"><span class=\"tah p11 nv01\">-234,567</span></td>" +
    "<td class=\"num\"><span class=\"tah p11 red01\">+1,234,567</span></td><td class=\"num\">3,100,000,000</td><td class=\"num\">52.10%</td></tr>").join("") + "</table>";
  const h = M._ofParseHtml(html);
  chk(h.rows.length === 2 && h.rows[0].d === days[0] && h.rows[0].f === 1234567 && h.rows[0].o === -234567 && h.rows[0].h === 52.1 && h.rows[0].v === 12345678,
    "HTML: 날짜 줄만 · 칸 위치(거래량·기관·외국인·보유율)", "★HTML 파싱이 틀렸다: " + JSON.stringify(h.rows[0]) + "★");
  chk(M._ofParseHtml("<tr><td>합계</td><td>1</td></tr>").rows.length === 0, "HTML: 날짜 아닌 줄은 버린다", "★날짜 아닌 줄을 읽었다★");
  chk(M._ofDay("2024.13.05") === null && M._ofDay("20240105") === 20240105 && M._ofNum("12a") === null,
    "날짜·숫자 검사(13월 · 글자 섞인 숫자 거절)", "★날짜/숫자 검사가 헐겁다★");
  const m = M._ofMerge({ d: [1, 2], f: [10, 20], o: [1, 2], h: [null, null], v: [null, null] }, [{ d: 2, f: 99, o: 9, h: 1, v: 5 }, { d: 3, f: 30, o: 3, h: null, v: null }], 10);
  chk(m.d.join() === "1,2,3" && m.f[1] === 99, "합치기: 날짜 오름차순 · 같은 날은 새 것", "★합치기가 틀렸다 " + JSON.stringify(m) + "★");
}

/* ── 가짜 D1 · R2 · 네이버 ── */
function fakeDB(o) {
  const st = new Map(Object.entries(o.state || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const writes = [];
  const mk = (sql) => { const s = { args: [] }; s.bind = (...a) => { s.args = a; return s; };
    s.first = async () => { if (/SELECT v FROM state/.test(sql)) { const k = s.args[0]; if ((o.failRead || []).includes(k)) throw new Error("D1 fake"); return st.has(k) ? { v: st.get(k) } : null; } return null; };
    s.run = async () => { if (/INSERT INTO state/.test(sql)) { writes.push(s.args[0]); st.set(s.args[0], s.args[1]); } return { meta: {} }; };
    s.all = async () => ({ results: [] }); return s; };
  return { prepare: mk, batch: async () => [], _w: writes, _get: (k) => st.has(k) ? JSON.parse(st.get(k)) : undefined,
           _set: (k, v) => st.set(k, JSON.stringify(v)) };
}
function fakeR2(o) {
  const m = new Map(Object.entries(o.files || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const puts = [];
  return { get: async (k) => { if ((o.failGet || []).includes(k)) throw new Error("R2 fake"); return m.has(k) ? { text: async () => m.get(k) } : null; },
           put: async (k, v) => { puts.push(k); m.set(k, v); }, _puts: puts, _get: (k) => m.has(k) ? JSON.parse(m.get(k)) : undefined };
}
/* mode: "json-paging" — JSON 이 bizdate 로 과거를 준다 · "json-stuck" — bizdate 무시(늘 최신) · "html-only" — JSON 404 */
function fakeNaver(mode, maxDays = 400) {
  const calls = { json: 0, html: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/trend?")) {
      calls.json++;
      if (mode === "html-only") return { ok: false, status: 404 };
      const bz = /bizdate=(\d+)/.exec(u);
      let start = 0;
      if (bz && mode === "json-paging") start = days.findIndex((d) => d <= +bz[1]);
      const rows = days.slice(start, Math.min(maxDays, start + 60)).map((d) => ({ bizdate: String(d), foreignerPureBuyQuant: "+100", organPureBuyQuant: "-50", foreignerHoldRatio: "10.00%", accumulatedTradingVolume: "1,000" }));
      return { ok: true, status: 200, json: async () => rows };
    }
    if (u.includes("frgn.naver")) {
      calls.html++;
      const pg = +/page=(\d+)/.exec(u)[1];
      const last = Math.ceil(maxDays / 20);
      const p = Math.min(pg, last);                      // 마지막 쪽을 넘기면 마지막 쪽을 또 준다(네이버처럼)
      const rows = days.slice((p - 1) * 20, Math.min(maxDays, p * 20));
      const html = rows.map((d) => "<tr><td>" + fmtDot(d) + "</td><td>1</td><td>1</td><td>1%</td><td>1,000</td><td>-50</td><td>+100</td><td>5</td><td>10.00%</td></tr>").join("");
      const bytes = new TextEncoder().encode(html);
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
    }
    return { ok: false, status: 404 };
  };
  return calls;
}
const R2KEY = (s) => M.OMNIFLOW.prefix + s + ".json";

console.log("\n② 수집기 — 못 읽은 색인·옛 파일은 ★덮지 않는다★");
{
  const DB = fakeDB({ failRead: ["omniflow_index"] });
  const R2 = fakeR2({}); M._setR2ForTest(R2); fakeNaver("json-paging");
  const r = await M.omniFlowCollect(DB, { perRun: 2 });
  chk(/색인 읽기 실패/.test(r) && !DB._w.includes("omniflow_index") && R2._puts.length === 0,
    "색인 못 읽음 → 아무것도 안 쓴다", "★색인을 못 읽었는데 썼다: " + r.slice(0, 80) + "★");
}

console.log("\n③ 백필 — JSON 날짜 넘기기 / 무시하면 HTML 로 / HTML 끝에서 멈춤");
for (const [mode, want] of [["json-paging", "json"], ["json-stuck", "html"], ["html-only", "html"]]) {
  const DB = fakeDB({}); const R2 = fakeR2({}); M._setR2ForTest(R2);
  const calls = fakeNaver(mode, 300);
  let r = "";
  for (let t = 0; t < 12; t++) {                                  // 여러 회차에 걸쳐 백필한다
    const ix = DB._get("omniflow_index");
    if (ix) for (const s in ix.s) ix.s[s].upd = 0;                // 신선도 무시(회차를 빨리 돌린다)
    if (ix) DB._set("omniflow_index", ix);
    r = await M.omniFlowCollect(DB, { perRun: 1 });
    DB._set("omniflow_cursor", { i: 0 });                          // 같은 종목만 계속
  }
  const sym = Object.keys(DB._get("omniflow_index").s)[0];
  const f = R2._get(R2KEY(sym)) || { d: [] };
  const ent = DB._get("omniflow_index").s[sym];
  chk(f.d.length === 300 && f.d[0] === days[299] && f.d[f.d.length - 1] === days[0] && ent.end === true,
    mode + ": 300일 전부(끝까지) · 오름차순 · 끝 표시 (json " + calls.json + " · html " + calls.html + "쪽)",
    "★" + mode + ": " + f.d.length + "행 · 끝 " + ent.end + " — 백필이 틀렸다: " + r.slice(0, 160) + "★");
}

console.log("\n④ 옛 파일을 못 읽으면 그 종목은 안 덮는다");
{
  const DB = fakeDB({}); fakeNaver("json-paging");
  const R2 = fakeR2({}); M._setR2ForTest(R2);
  await M.omniFlowCollect(DB, { perRun: 1 });
  const sym = Object.keys(DB._get("omniflow_index").s)[0];
  const before = R2._get(R2KEY(sym)).d.length;
  const R2b = fakeR2({ files: { [R2KEY(sym)]: R2._get(R2KEY(sym)) }, failGet: [R2KEY(sym)] }); M._setR2ForTest(R2b);
  const ix = DB._get("omniflow_index"); ix.s[sym].upd = 0; DB._set("omniflow_index", ix);
  DB._set("omniflow_cursor", { i: 0 });
  const r = await M.omniFlowCollect(DB, { perRun: 1 });
  chk(R2b._puts.length === 0 && /옛파일 못읽음 1/.test(r) && before > 0, "옛 파일 읽기 실패 → 쓰지 않음(" + before + "행 보존)",
    "★옛 파일을 못 읽었는데 덮었다: " + r.slice(0, 120) + "★");
}

console.log("\n⑤ 배선 — 매 틱 · 야간 단계 · 수동 실행 목록 · 학습기 엔드포인트(색인 503)");
{
  chk(/omniflow_lock/.test(S) && /\["omniflow", function \(DB\)/.test(S) && /_stg\("omniflow"/.test(S),
    "매 틱(잠금) + 야간 _PIPE + _stg", "★수집기가 어디서도 안 돈다★");
  const tn = readFileSync(new URL("../.github/workflows/train-now.yml", import.meta.url), "utf8");
  chk(/options: \[[^\]]*\bomniflow\b/.test(tn), "수동 실행 목록에 omniflow", "★손으로 돌릴 방법이 없다★");
  const ep = S.slice(S.indexOf('path === "/api/omni-flows-index"'), S.indexOf('path === "/api/ml-export-intraday"'));
  chk(/_ofIndexLoad\(env\.DB\)/.test(ep) && /status: 503/.test(ep) && /errs\.push\(sym\)/.test(ep),
    "학습기 엔드포인트: 색인 엄격(503) · 못 읽은 종목은 errs", "★엔드포인트가 못 읽음을 없음으로 준다★");
}

console.log(fails ? "\n✗ 수급 수집기 검사 실패 " + fails : "\n✓ 수급 수집기 검사 통과");
process.exit(fails ? 1 : 0);
