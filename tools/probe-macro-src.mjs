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
