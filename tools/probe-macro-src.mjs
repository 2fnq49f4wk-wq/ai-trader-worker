/* [V33.561] 금융 지표 원천 실측 — FRED CSV(키 없음) · 네이버 금리 일별 시세. 각 원천의 마지막 관측일·값을 찍는다(읽기 전용). */
const out = (k, v) => console.log("MAC " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" };
const fred = ["CPIAUCSL", "CPILFESL", "PPIFIS", "PCEPILFE", "UNRATE", "DFEDTARL", "DFEDTARU", "DGS10", "DGS2", "DGS3MO",
  "IRSTCB01KRM156N", "KORCPIALLMINMEI", "CPALTT01KRM659N", "IRLTLT01KRM156N", "IR3TIB01KRM156N", "LRHUTTTTKRM156S", "PIEAMP01KRM661N"];
for (const id of fred) {
  try {
    const t = Date.now(); const r = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + id, { headers: UA, signal: AbortSignal.timeout(15000) });
    const txt = r.ok ? await r.text() : ""; const rows = txt.trim().split("\n").filter((l) => /^\d{4}-/.test(l)).filter((l) => !/,\.?$/.test(l) && !/,\s*$/.test(l));
    out("fred " + id, { http: r.status, ms: Date.now() - t, n: rows.length, last: rows.slice(-3) });
  } catch (e) { out("fred " + id, { err: String(e.message || e).slice(0, 80) }); }
}
for (const cd of ["IRR_GOVT03Y", "IRR_GOVT10Y", "IRR_CD91", "IRR_CALL"]) {
  try {
    const r = await fetch("https://finance.naver.com/marketindex/interestDailyQuote.naver?marketindexCd=" + cd, { headers: UA, signal: AbortSignal.timeout(15000) });
    const b = Buffer.from(await r.arrayBuffer()); const txt = new TextDecoder("euc-kr").decode(b);
    const m = [...txt.matchAll(/<td class="date">\s*([\d.]+)\s*<\/td>\s*<td class="num">\s*([\d.]+)\s*<\/td>/g)].slice(0, 3).map((x) => x[1] + "=" + x[2]);
    out("naver " + cd, { http: r.status, rows: m, len: txt.length });
  } catch (e) { out("naver " + cd, { err: String(e.message || e).slice(0, 80) }); }
}
// [V33.561] 한국 기준금리·물가 후보
const KRC = {
  bok_base: "https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643",
  naver_bond3y: "https://m.stock.naver.com/front-api/marketIndex/productDetail?category=bond&reutersCode=KR3YT%3DRR",
  naver_bond10y: "https://m.stock.naver.com/front-api/marketIndex/productDetail?category=bond&reutersCode=KR10YT%3DRR",
  naver_bondlist: "https://m.stock.naver.com/front-api/marketIndex/bondList",
  fred_krcpi2: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=KORCPALTT01CTGYM",
  fred_krbase: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=INTDSRKRM193N",
  fred_kr3y: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=IRSTCI01KRM156N",
  kosis_cpi_page: "https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_1J22003"
};
for (const [k, u] of Object.entries(KRC)) {
  try {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) });
    const txt = await r.text();
    let snip = "";
    if (k === "bok_base") { const m = [...txt.matchAll(/<td[^>]*>\s*(\d{4})\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>\s*([\d.]+)\s*<\/td>/g)].slice(0, 3).map((x) => x.slice(1).join("|")); snip = JSON.stringify(m); }
    else if (k.startsWith("fred")) { snip = JSON.stringify(txt.trim().split("\n").slice(-2)); }
    else snip = txt.slice(0, 300).replace(/\s+/g, " ");
    out("kr " + k, { http: r.status, len: txt.length, snip });
  } catch (e) { out("kr " + k, { err: String(e.message || e).slice(0, 80) }); }
}
// [V33.561] 네이버 국채 JSON 필드 · 한국 물가 후보
try {
  const r = await fetch("https://m.stock.naver.com/front-api/marketIndex/productDetail?category=bond&reutersCode=KR3YT%3DRR", { headers: UA });
  const j = await r.json(); const res = j.result || {};
  const flat = {}; for (const [k, v] of Object.entries(res)) if (v == null || typeof v !== "object") flat[k] = v;
  out("naver bond3y fields", flat);
} catch (e) { out("naver bond3y fields err", String(e.message || e)); }
for (const [k, u] of Object.entries({
  bok_main: "https://www.bok.or.kr/portal/main/main.do",
  naver_econ: "https://m.stock.naver.com/front-api/marketIndex/economicIndicator?countryCode=KOR",
  kosis_cpi_json: "https://kosis.kr/openapi/statisticsData.do?method=getList&format=json&jsonVD=Y&userStatsId=&orgId=101&tblId=DT_1J22003",
  index_go_cpi: "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1060"
})) {
  try {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) }); const t = await r.text();
    const i = t.indexOf("소비자물가"); out("krcpi " + k, { http: r.status, len: t.length, at: i, near: i >= 0 ? t.slice(Math.max(0, i - 120), i + 260).replace(/\s+/g, " ") : t.slice(0, 200).replace(/\s+/g, " ") });
  } catch (e) { out("krcpi " + k, { err: String(e.message || e).slice(0, 80) }); }
}
