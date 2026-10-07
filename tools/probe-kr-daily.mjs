/* [V33.507] ★한국 일봉에 하루 +24% 같은 봉이 있다★(probe-exits BENCH: 069500·102110·005930 의 2026-07-28 −12~−13% · 07-31 +24~+27%).
   지수 ETF 가 하루 24% 는 비정상 — 우리 저장이 망가진 것인지(병합·수정주가) 출처(네이버)가 그렇게 주는 것인지 가른다.
   ① 네이버 일봉 API(지금) ② 우리 /api/chart(일봉 캐시) ③ 코스피 지수(네이버 siseJson) 를 같은 날짜로 나란히.
   사용법: node tools/probe-kr-daily.mjs <url> */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const out = (k, v) => console.log("KRD " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const H = { "User-Agent": "Mozilla/5.0", "Referer": "https://m.stock.naver.com/" };
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const from = new Date(Date.UTC(2026, 6, 20)), to = new Date(Date.UTC(2026, 7, 8));
for (const code of ["069500", "102110", "005930", "000660"]) {
  try {
    const r = await fetch("https://api.stock.naver.com/chart/domestic/item/" + code + "/day?startDateTime=" + ymd(from) + "0000&endDateTime=" + ymd(to) + "2359", { headers: H });
    const rows = await r.json();
    out("naver_" + code, (Array.isArray(rows) ? rows : []).map((x) => String(x.localDate || x.localDateTime || x.date || "").slice(0, 8) + ":" + x.closePrice + (x.openPrice ? "/o" + x.openPrice : "")).join(" "));
    if (Array.isArray(rows) && rows[0]) out("naver_keys_" + code, Object.keys(rows[0]));
  } catch (e) { out("naver_err_" + code, String(e.message || e).slice(0, 80)); }
  if (BASE) try {
    const r = await fetch(BASE + "/api/chart?symbol=" + code + ".KS&interval=1d&range=6mo", { headers: { "cache-control": "no-cache" } });
    const j = await r.json(); const c = j.candles || j.data || j;
    const arr = Array.isArray(c) ? c : [];
    const pick = arr.filter((x) => { const t = (x.t || x.time || x.ts || 0); const ms = t > 1e12 ? t : t * 1000; return ms >= from.getTime() && ms <= to.getTime() + 86400000; });
    out("ours_" + code, pick.map((x) => { const t = (x.t || x.time || x.ts || 0); const ms = t > 1e12 ? t : t * 1000; return new Date(ms).toISOString().slice(0, 10) + ":" + (x.c ?? x.close); }).join(" ") + (pick.length ? "" : " (keys " + (arr[0] ? Object.keys(arr[0]).join(",") : Object.keys(j).join(",")) + ")"));
  } catch (e) { out("ours_err_" + code, String(e.message || e).slice(0, 80)); }
}
for (const idx of ["KOSPI", "KPI200"]) {
  try {
    const r = await fetch("https://api.finance.naver.com/siseJson.naver?symbol=" + idx + "&requestType=1&startTime=" + ymd(from) + "&endTime=" + ymd(to) + "&timeframe=day", { headers: H });
    const t = await r.text();
    out("index_" + idx, t.replace(/\s+/g, " ").slice(0, 1200));
  } catch (e) { out("index_err_" + idx, String(e.message || e).slice(0, 80)); }
}
